"""Lógica de Producción › Conteo inventario mensual (ver models_conteo.py).

Flujo de cada área y mes: el manager guarda un BORRADOR y lo ENVÍA con su firma (firma 1) → firman el Director de
Producción (firma 2) y un testigo (firma 3): cualquiera de la lista de testigos de Parámetros (no se elige en el formulario).
Antes de firmar, el Director y el testigo hacen el SEGUNDO CONTEO (la cifra oficial; se compara con la del manager) → con las 3 firmas el conteo queda EN FIRME
(estado VALIDADO en la base) y se guarda el PDF del reporte. Si el Director o el testigo no están de acuerdo, lo
rechazan con una observación (DEVUELTO). Solo el Director de Producción o un administrador pueden anular las firmas
para que se corrija y se vuelva a firmar. Se puede enviar en cualquier momento (sin fecha límite)."""
import calendar
from datetime import datetime, date, timedelta
from sqlalchemy import func
from sqlalchemy.orm import Session
from .models import Empleado
from .models_conteo import (ConteoBodega, ConteoMaterial, ConteoMaterialArea, ConteoConfig, ConteoReporte, ConteoLinea,
                            ConteoEvidencia, ConteoAviso, ConteoDocumento, ConteoTestigo,
                            BORRADOR, ENVIADO, DEVUELTO, VALIDADO, ANULADO)
from .formato import nombre_propio

EN_FIRME = VALIDADO  # nombre del estado final en pantalla: «En firme»
MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre",
         "Noviembre", "Diciembre"]
# (código, nombre, prefijo, activa): Bienes 103 queda desactivada (lo de bienes se entrega a depósito); se activa en Parámetros
BODEGAS_INICIALES = [("103", "BIENES", "B", False), ("200", "SERVICIO", "S", True)]
MATERIALES_INICIALES = [("MATP6", "Incisal Enhancer 1.5 DPLB10"), ("MATP9", "Tissue"), ("MATP15", "Glaze Stain Liquid"),
                        ("MATP16", "Glaze paste"), ("MATP20", "Miyo"), ("MATP23", "Bonding Illusion o Ziradd"),
                        ("MATP27", "Disco de Zirconia"), ("MATP53", "Ceramic spheres ZR Pink (DPCG07)"),
                        ("MATP54", "ZIR Bonder DPCG08"), ("MATP55", "Bonder Liquid DPCG05")]
TIPOS_EVIDENCIA = ("image/jpeg", "image/png", "image/webp", "application/pdf")
MAX_EVIDENCIA = 5 * 1024 * 1024  # 5 MB por archivo (las fotos se comprimen en el navegador antes de subir)
DIAS_RECORDATORIO = 3  # se recuerda los últimos 3 días del mes y los primeros 3 del mes siguiente


def hoy_colombia() -> date:
    return (datetime.utcnow() - timedelta(hours=5)).date()


def _hora(m: datetime | None) -> str:
    return (m - timedelta(hours=5)).strftime("%d/%m/%Y %I:%M %p") if m else ""


def es_admin(user: Empleado) -> bool:
    from .acceso_produccion import es_admin_produccion
    return user.rol in ("admin", "superadmin") or es_admin_produccion(user)


def asegurar_catalogo(db: Session) -> None:
    """La primera vez: las bodegas y materiales del formulario anterior (se editan en Parámetros)."""
    if db.query(ConteoBodega).count() == 0:
        for i, (codigo, nombre, prefijo, activa) in enumerate(BODEGAS_INICIALES, start=1):
            db.add(ConteoBodega(codigo=codigo, nombre=nombre, prefijo=prefijo, orden=i, activo=activa))
    if db.query(ConteoMaterial).count() == 0:
        for i, (codigo, desc) in enumerate(MATERIALES_INICIALES, start=1):
            db.add(ConteoMaterial(codigo=codigo, descripcion=desc, orden=i))
    db.commit()


def bodegas_activas(db: Session) -> list[ConteoBodega]:
    return db.query(ConteoBodega).filter(ConteoBodega.activo.is_(True)).order_by(ConteoBodega.orden, ConteoBodega.codigo).all()


def materiales_activos(db: Session, area: str | None = None) -> list[ConteoMaterial]:
    """Materiales activos; con área, solo los que cuenta esa área (sin áreas configuradas = todas)."""
    mats = db.query(ConteoMaterial).filter(ConteoMaterial.activo.is_(True)).order_by(ConteoMaterial.orden, ConteoMaterial.codigo).all()
    if not area:
        return mats
    por_mat: dict[int, set[str]] = {}
    for x in db.query(ConteoMaterialArea):
        por_mat.setdefault(x.material_id, set()).add(x.area)
    return [m for m in mats if not por_mat.get(m.id) or area.strip().upper() in por_mat[m.id]]


def areas_de_material(db: Session) -> dict[int, list[str]]:
    salida: dict[int, list[str]] = {}
    for x in db.query(ConteoMaterialArea).order_by(ConteoMaterialArea.area):
        salida.setdefault(x.material_id, []).append(x.area)
    return salida


def areas_de(user: Empleado) -> list[str]:
    """Áreas con las que reporta el manager: las asignadas en Producción (Parámetros › Accesos de Cambio de custodia, máx. 2)."""
    return user.areas_custodia


def area_de(user: Empleado) -> str:
    """Área principal del manager (la primera asignada)."""
    return (areas_de(user) or [""])[0]


def director_produccion(db: Session) -> Empleado | None:
    """Director de Producción (Parámetros): segunda firma de todos los conteos."""
    c = db.get(ConteoConfig, "director_id")
    e = db.get(Empleado, int(c.valor)) if c and str(c.valor or "").isdigit() else None
    return e if e and e.activo else None


def testigos(db: Session) -> list[Empleado]:
    return sorted((t.empleado for t in db.query(ConteoTestigo).all() if t.empleado and t.empleado.activo),
                  key=lambda e: e.nombre_completo)


def puede_anular(db: Session, user: Empleado) -> bool:
    """Anular las firmas (para corregir y volver a firmar): el Director de Producción o un administrador."""
    d = director_produccion(db)
    return es_admin(user) or bool(d and d.id == user.id)


def testigos_posibles(db: Session, r: ConteoReporte) -> list[Empleado]:
    """Quienes pueden firmar como testigo este conteo: la lista de Parámetros, sin quien lo cargó ni el Director."""
    return [t for t in testigos(db) if t.id not in (r.responsable_id, r.manager_firma_id)]


def firmas_completas(r: ConteoReporte) -> bool:
    """Las 3 firmas del conteo: el manager que lo carga, el Director de Producción y el testigo."""
    return bool(r.enviado_en and r.manager_firmado_en and r.testigo_firmado_en)


def rol_firmante(db: Session, user: Empleado, r: ConteoReporte) -> str:
    """"manager" (= Director de Producción) / "testigo" si a esta persona le toca firmar el conteo enviado.
    Testigo: cualquiera de la lista de Parámetros (el primero que firma queda como testigo)."""
    if r.estado != ENVIADO:
        return ""
    if r.manager_firma_id == user.id and not r.manager_firmado_en:
        return "manager"
    if not r.testigo_firmado_en and user.id in {t.id for t in testigos_posibles(db, r)}:
        return "testigo"
    return ""


def es_firmante(db: Session, user: Empleado, r: ConteoReporte) -> bool:
    """Puede ver el conteo para firmarlo (o lo firmó): Director, testigo que firmó o cualquiera de la lista de testigos."""
    return user.id in (r.manager_firma_id, r.testigo_id, r.responsable_id) or user.id in {t.id for t in testigos(db)}


def tiene_segundo(r: ConteoReporte) -> bool:
    return r.segundo_en is not None


def _quedar_en_firme(r: ConteoReporte) -> None:
    if firmas_completas(r) and tiene_segundo(r) and r.estado == ENVIADO:
        r.estado, r.validado_en = EN_FIRME, datetime.utcnow()


def firmar_conteo(db: Session, user: Empleado, r: ConteoReporte) -> str | None:
    """Firma del Director de Producción o del testigo: queda su correo Zoho (el de la sesión) y la fecha y hora.
    Con las 3 firmas el conteo queda en firme."""
    rol = rol_firmante(db, user, r)
    if not rol:
        return "Este conteo no tiene una firma pendiente a tu nombre."
    if not tiene_segundo(r):
        return "Primero registren el segundo conteo (Director de Producción y área contable) y después firmen."
    if rol == "manager":
        r.manager_firma_email, r.manager_firmado_en = user.email or "", datetime.utcnow()
    else:  # el testigo que firma queda registrado como el testigo del conteo
        r.testigo_id, r.testigo_email, r.testigo_firmado_en = user.id, user.email or "", datetime.utcnow()
    _quedar_en_firme(r)
    db.commit()
    return None


def rechazar_firma(db: Session, user: Empleado, r: ConteoReporte, observacion: str) -> str | None:
    """El Director o el testigo no firma: el conteo vuelve al manager con la observación."""
    rol = rol_firmante(db, user, r)
    if not rol:
        return "Este conteo no tiene una firma pendiente a tu nombre."
    obs = (observacion or "").strip()
    if len(obs) < 5:
        return "Escribe la observación (mínimo 5 caracteres): qué se debe corregir."
    quien = "Director de Producción" if rol == "manager" else "área contable"
    r.estado, r.devuelto_por_id, r.devuelto_en = DEVUELTO, user.id, datetime.utcnow()
    r.observacion = f"No firmó el {quien} ({nombre_propio(user.nombre_completo)}): {obs[:900]}"
    _borrar_firmas(r)
    db.commit()
    return None


def puede_segundo_conteo(db: Session, user: Empleado, r: ConteoReporte) -> bool:
    """El segundo conteo lo registra el Director de Producción o un testigo de la lista, mientras espera firmas."""
    if r.estado != ENVIADO or user.id == r.responsable_id:  # quien cargó el conteo no hace el segundo conteo
        return False
    return user.id == r.manager_firma_id or user.id == r.testigo_id or user.id in {t.id for t in testigos_posibles(db, r)}


def guardar_segundo_conteo(db: Session, user: Empleado, r: ConteoReporte, datos: dict) -> str | None:
    """Guarda (o corrige) el segundo conteo. Si alguien ya había firmado, su firma se borra: debe firmar lo nuevo."""
    if not puede_segundo_conteo(db, user, r):
        return "Solo el Director de Producción o el área contable (que no hayan cargado este conteo) registran el segundo conteo de un conteo enviado."
    lineas = _leer_lineas(db, datos, r.area, segundo=True)
    if isinstance(lineas, str):
        return lineas
    for l in [l for l in r.lineas if l.tipo in ("VCONTEO", "VDANADO")]:
        r.lineas.remove(l)
    r.lineas.extend(lineas)
    r.segundo_por_id, r.segundo_en = user.id, datetime.utcnow()
    auto = r.manager_firma_id == r.responsable_id  # el Director cargó el conteo: su firma de Director se mantiene
    if r.manager_firmado_en and not auto and r.manager_firma_id != user.id:
        r.manager_firma_email = r.manager_firmado_en = None
    if r.testigo_firmado_en and r.testigo_id != user.id:
        r.testigo_id = r.testigo_email = r.testigo_firmado_en = None
    if r.manager_firma_id == user.id and not auto:
        r.manager_firma_email = r.manager_firmado_en = None  # vuelve a firmar con lo nuevo
    if r.testigo_id == user.id:
        r.testigo_email = r.testigo_firmado_en = None
    db.commit()
    return None


def comparacion(r: ConteoReporte, bodegas, materiales) -> dict:
    """Manager vs segundo conteo, material por material."""
    c1, d1 = cantidades(r)
    c2, d2 = cantidades(r, segundo=True)
    filas = {}
    for b in bodegas:
        for m in materiales:
            k = f"{b.id}:{m.id}"
            filas[k] = {"manager": c1.get(k, 0), "segundo": c2.get(k, 0), "diferencia": round(c2.get(k, 0) - c1.get(k, 0), 2)}
        k = f"{b.id}:danados"
        filas[k] = {"manager": d1.get(str(b.id), 0), "segundo": d2.get(str(b.id), 0),
                    "diferencia": round(d2.get(str(b.id), 0) - d1.get(str(b.id), 0), 2)}
    return {"filas": filas, "diferencias": sum(1 for f in filas.values() if f["diferencia"])}


def _borrar_firmas(r: ConteoReporte) -> None:
    for l in [l for l in r.lineas if l.tipo in ("VCONTEO", "VDANADO")]:  # el segundo conteo se vuelve a hacer
        r.lineas.remove(l)
    r.segundo_por_id = r.segundo_en = None
    r.enviado_en = r.enviado_email = None
    r.manager_firma_email = r.manager_firmado_en = None
    r.testigo_id = r.testigo_email = r.testigo_firmado_en = None
    r.validado_en = None


def anular_firmas(db: Session, user: Empleado, r: ConteoReporte, motivo: str) -> str | None:
    """Director de Producción o administrador, mientras espera firmas: anula las firmas para que el manager corrija
    y se vuelva a firmar. En firme (3 firmas) ya no se anulan firmas: se anula el reporte completo."""
    if not puede_anular(db, user):
        return "Solo el Director de Producción o un administrador pueden anular las firmas del conteo."
    if r.estado == EN_FIRME:
        return "Este conteo ya está en firme (3 firmas): no se anulan las firmas, se debe anular el reporte completo."
    if r.estado != ENVIADO:
        return "Este conteo no tiene firmas para anular."
    motivo = (motivo or "").strip()
    if len(motivo) < 5:
        return "Escribe el motivo (mínimo 5 caracteres): qué se debe corregir."
    r.estado, r.devuelto_por_id, r.devuelto_en = DEVUELTO, user.id, datetime.utcnow()
    r.observacion = f"Firmas anuladas por {nombre_propio(user.nombre_completo)}: {motivo[:900]}"
    _borrar_firmas(r)
    db.commit()
    quitar_acta(db, r)  # el PDF firmado deja de valer; se genera otro cuando vuelva a quedar en firme
    return None


def anular_reporte(db: Session, user: Empleado, r: ConteoReporte, motivo: str) -> str | None:
    """Director de Producción o administrador: anula por completo un reporte en firme. Se borran las cantidades,
    el segundo conteo, las firmas, los soportes y el PDF; el manager debe volver a realizarlo desde cero."""
    if not puede_anular(db, user):
        return "Solo el Director de Producción o un administrador pueden anular el reporte."
    if r.estado != EN_FIRME:
        return "Solo se anula el reporte completo cuando está en firme. Si espera firmas, usa «Anular firmas»."
    motivo = (motivo or "").strip()
    if len(motivo) < 5:
        return "Escribe el motivo (mínimo 5 caracteres): por qué se anula el reporte."
    _borrar_firmas(r)
    for l in list(r.lineas):
        r.lineas.remove(l)
    for e in list(r.evidencias):
        _papelera_workdrive(e.workdrive_id)
        r.evidencias.remove(e)
    r.novedad = ""
    r.estado, r.devuelto_por_id, r.devuelto_en = ANULADO, user.id, datetime.utcnow()
    r.observacion = f"Reporte anulado por {nombre_propio(user.nombre_completo)}: {motivo[:900]}"
    db.commit()
    quitar_acta(db, r)
    return None


def faltan_firmas(r: ConteoReporte) -> list[str]:
    return (([] if tiene_segundo(r) else ["Segundo conteo"]) + ([] if r.manager_firmado_en else ["Director de Producción"])
            + ([] if r.testigo_firmado_en else ["Área contable"]))


def pendientes_por_validar(db: Session, user: Empleado) -> list[dict]:
    """Conteos enviados que esperan firmas (de cualquier mes), con lo que falta y si a esta persona le toca firmar."""
    salida = []
    for r in (db.query(ConteoReporte).filter(ConteoReporte.estado == ENVIADO)
              .order_by(ConteoReporte.anio.desc(), ConteoReporte.mes.desc(), ConteoReporte.area)):
        d = serializar(db, r, user)
        d["faltan"], d["miFirma"] = faltan_firmas(r), rol_firmante(db, user, r) or ("segundo" if puede_segundo_conteo(db, user, r) else "")
        d["puedeVer"] = es_firmante(db, user, r) or es_admin(user)
        salida.append(d)
    return salida


def migrar_flujo_anterior(db: Session) -> int:
    """Conteos del flujo anterior con las 3 firmas y el conteo físico del validador (= segundo conteo) que quedaron
    «en validación»: pasan a en firme. Los que no tienen segundo conteo siguen en Pendientes por validar."""
    n = 0
    for r in db.query(ConteoReporte).filter(ConteoReporte.estado == ENVIADO):
        if firmas_completas(r) and tiene_segundo(r):
            r.estado, r.validado_en = EN_FIRME, r.validado_en or max(r.manager_firmado_en, r.testigo_firmado_en)
            n += 1
    db.commit()
    return n


def ve_pendientes(db: Session, user: Empleado) -> bool:
    """Pestaña «Pendientes por validar»: el Director de Producción, los testigos y los administradores."""
    d = director_produccion(db)
    return es_admin(user) or bool(d and d.id == user.id) or user.id in {t.id for t in testigos(db)}


def ve_consulta(db: Session, user: Empleado) -> bool:
    """Pestaña «Consulta» (conteos firmados): el Director de Producción, el área contable y los administradores."""
    d = director_produccion(db)
    return es_admin(user) or bool(d and d.id == user.id) or puede_cargar_contable(db, user)


def puede_cargar_contable(db: Session, user: Empleado) -> bool:
    """Cargan la existencia contable del mes: las personas del área contable (Parámetros) y los administradores."""
    return es_admin(user) or user.id in {t.id for t in testigos(db)}


def contable_del_mes(db: Session, anio: int, mes: int) -> dict:
    """{"bodega:material" o "bodega:danados": {cantidad, por, en}} de la existencia contable cargada."""
    from .models_conteo import ConteoContable
    salida = {}
    for c in db.query(ConteoContable).filter_by(anio=anio, mes=mes):
        clave = f"{c.bodega_id}:{c.material_id if c.material_id else 'danados'}"
        salida[clave] = {"cantidad": c.cantidad, "en": _hora(c.actualizado_en),
                         "por": nombre_propio(c.actualizado_por.nombre_completo) if c.actualizado_por else ""}
    return salida


def _clave_firma_contable(anio: int, mes: int) -> str:
    return f"contable_firma_{anio}_{mes:02d}"


def firma_contable(db: Session, anio: int, mes: int) -> dict | None:
    """Quién guardó y firmó la existencia contable del mes (después ya no se edita, salvo que la reabran)."""
    c = db.get(ConteoConfig, _clave_firma_contable(anio, mes))
    if not c or not c.valor:
        return None
    try:
        eid, iso = c.valor.split("|", 1)
        e = db.get(Empleado, int(eid))
        momento = datetime.fromisoformat(iso)
    except (ValueError, TypeError):
        return None
    return {"por": nombre_propio(e.nombre_completo) if e else "", "email": (e.email or "") if e else "", "en": _hora(momento)}


def _firmar_contable(db: Session, user: Empleado, anio: int, mes: int) -> None:
    c = db.get(ConteoConfig, _clave_firma_contable(anio, mes)) or ConteoConfig(clave=_clave_firma_contable(anio, mes))
    c.valor = f"{user.id}|{datetime.utcnow().isoformat(timespec='seconds')}"
    db.add(c)


def reabrir_contable(db: Session, user: Empleado, anio: int, mes: int) -> str | None:
    """Director de Producción o administrador: quita la firma para que el área contable corrija y vuelva a guardar."""
    if not puede_anular(db, user):
        return "Solo el Director de Producción o un administrador reabren la existencia contable."
    c = db.get(ConteoConfig, _clave_firma_contable(anio, mes))
    if not c or not c.valor:
        return "La existencia contable de este mes no está firmada."
    db.delete(c)
    db.commit()
    return None


def _contable_bloqueada(db: Session, anio: int, mes: int) -> str | None:
    f = firma_contable(db, anio, mes)
    if f:
        return (f"La existencia contable de este mes ya se guardó y firmó ({f['por']} · {f['en']}): no se puede editar. "
                "Para corregirla, el Director de Producción o un administrador debe reabrirla.")
    return None


def soportes_contables(db: Session, anio: int, mes: int) -> list[dict]:
    from .models_conteo import ConteoContableSoporte as CS
    return [{"id": x.id, "nombre": x.nombre, "tipo": x.tipo_mime, "en": _hora(x.creado_en),
             "por": nombre_propio(x.creado_por.nombre_completo) if x.creado_por else ""}
            for x in db.query(CS).filter_by(anio=anio, mes=mes).order_by(CS.id)]


def agregar_soporte_contable(db: Session, user: Empleado, anio: int, mes: int, nombre: str, tipo: str, datos: bytes) -> str | None:
    from .models_conteo import ConteoContableSoporte as CS
    if not puede_cargar_contable(db, user):
        return "Solo el área contable (o un administrador) carga el soporte contable."
    bloqueo = _contable_bloqueada(db, anio, mes)
    if bloqueo:
        return bloqueo
    if tipo not in TIPOS_EVIDENCIA:
        return "Solo se aceptan imágenes (pantallazo, JPG, PNG) o PDF."
    if not datos:
        return "El archivo está vacío."
    if len(datos) > MAX_EVIDENCIA:
        return "El archivo pesa más de 5 MB."
    db.add(CS(anio=anio, mes=mes, nombre=(nombre or "soporte contable")[:200], tipo_mime=tipo, tamano=len(datos),
              datos=datos, creado_por_id=user.id))
    db.commit()
    return None


def guardar_contable_lote(db: Session, user: Empleado, anio: int, mes: int, valores: dict) -> str | None:
    """Botón Guardar: guarda de una vez las existencias contables del mes ({clave: cantidad}; vacío = quitar)
    y queda firmada por quien la guardó (correo, fecha y hora). Después ya no se edita."""
    if not puede_cargar_contable(db, user):
        return "Solo el área contable (o un administrador) carga la existencia contable."
    bloqueo = _contable_bloqueada(db, anio, mes)
    if bloqueo:
        return bloqueo
    if not any(str(v or "").strip() for v in (valores or {}).values()):
        return "Escribe al menos una existencia contable antes de guardar."
    for clave, valor in (valores or {}).items():
        error = guardar_contable(db, user, anio, mes, clave, valor)
        if error:
            return error
    _firmar_contable(db, user, anio, mes)
    db.commit()
    return None


def guardar_contable(db: Session, user: Empleado, anio: int, mes: int, clave: str, valor) -> str | None:
    """Guarda (o borra, si viene vacío) la existencia contable de un material en una bodega."""
    from .models_conteo import ConteoContable
    if not puede_cargar_contable(db, user):
        return "Solo el área contable (o un administrador) carga la existencia contable."
    bloqueo = _contable_bloqueada(db, anio, mes)
    if bloqueo:
        return bloqueo
    try:
        bodega, mat = clave.split(":")
        bodega_id = int(bodega)
        material_id = None if mat == "danados" else int(mat)
    except (ValueError, AttributeError):
        return "Material o bodega no válidos."
    if not db.get(ConteoBodega, bodega_id) or (material_id and not db.get(ConteoMaterial, material_id)):
        return "Material o bodega no válidos."
    texto = str(valor if valor is not None else "").strip().replace(",", ".")
    fila = (db.query(ConteoContable).filter_by(anio=anio, mes=mes, bodega_id=bodega_id)
            .filter(ConteoContable.material_id.is_(None) if material_id is None else ConteoContable.material_id == material_id).first())
    if texto == "":
        if fila:
            db.delete(fila)
            db.commit()
        return None
    try:
        cantidad = round(float(texto), 2)
    except ValueError:
        return "La existencia contable debe ser un número (se aceptan decimales, ej. 12.5)."
    if cantidad < 0:
        return "La existencia contable no puede ser negativa."
    if not fila:
        fila = ConteoContable(anio=anio, mes=mes, bodega_id=bodega_id, material_id=material_id)
        db.add(fila)
    fila.cantidad, fila.actualizado_por_id, fila.actualizado_en = cantidad, user.id, datetime.utcnow()
    db.commit()
    return None


def corregir_responsables(db: Session) -> list[int]:
    """Conteos enviados cuyo responsable quedó con quien lo creó antes y no con quien lo envió (antes no se actualizaba):
    el responsable pasa a ser quien lo envió (su correo es el de la firma 1)."""
    ids = []
    for r in db.query(ConteoReporte).filter(ConteoReporte.estado.in_([ENVIADO, EN_FIRME]), ConteoReporte.enviado_email.isnot(None)):
        correo = (r.enviado_email or "").strip().lower()
        if not correo or correo == (r.responsable_email or "").strip().lower():
            continue
        quien = db.query(Empleado).filter(func.lower(Empleado.email) == correo).first()
        if quien and quien.id != r.responsable_id:
            r.responsable_id, r.responsable_email = quien.id, quien.email or ""
            ids.append(r.id)
    db.commit()
    return ids


def invalidar_segundos_del_responsable(db: Session) -> list[int]:
    """Conteos que esperan firmas cuyo segundo conteo lo registró quien cargó el conteo (antes se permitía):
    ese segundo conteo queda sin efecto y lo hacen de nuevo el Director y el área contable."""
    ids = []
    for r in db.query(ConteoReporte).filter(ConteoReporte.estado == ENVIADO, ConteoReporte.segundo_en.isnot(None)):
        if r.segundo_por_id and r.segundo_por_id == r.responsable_id:
            for l in [l for l in r.lineas if l.tipo in ("VCONTEO", "VDANADO")]:
                r.lineas.remove(l)
            r.segundo_por_id = r.segundo_en = None
            if r.manager_firma_id != r.responsable_id:  # la firma del Director (si no es quien cargó) se hizo sobre ese segundo conteo
                r.manager_firma_email = r.manager_firmado_en = None
            r.testigo_email = r.testigo_firmado_en = None
            ids.append(r.id)
    db.commit()
    return ids


def puede_editar(user: Empleado, r: ConteoReporte) -> bool:
    return es_admin(user) or r.responsable_id == user.id or r.area in areas_de(user)


def cantidades(r: ConteoReporte, segundo: bool = False) -> tuple[dict, dict]:
    t_cont, t_dan = ("VCONTEO", "VDANADO") if segundo else ("CONTEO", "DANADO")
    conteo = {f"{l.bodega_id}:{l.material_id}": l.cantidad for l in r.lineas if l.tipo == t_cont}
    danados = {str(l.bodega_id): l.cantidad for l in r.lineas if l.tipo == t_dan}
    return conteo, danados


def cantidades_finales(r: ConteoReporte) -> tuple[dict, dict]:
    """La cifra oficial: el segundo conteo (Director y testigo) si ya se hizo; si no, la del manager."""
    return cantidades(r, segundo=True) if tiene_segundo(r) else cantidades(r)


def serializar(db: Session, r: ConteoReporte, user: Empleado | None = None) -> dict:
    conteo, danados = cantidades(r)
    seg, seg_d = cantidades(r, segundo=True)
    acta = db.query(ConteoDocumento).filter_by(tipo="ACTA", reporte_id=r.id).first()
    return {
        "id": r.id, "fechaReporte": r.fecha_reporte.isoformat(), "anio": r.anio, "mes": r.mes,
        "mesNombre": MESES[r.mes - 1], "area": r.area, "estado": r.estado,
        "responsable": nombre_propio(r.responsable.nombre_completo) if r.responsable else "",
        "responsableEmail": r.responsable_email, "novedad": r.novedad or "",
        "creadoEn": _hora(r.creado_en), "actualizadoEn": _hora(r.actualizado_en),
        "actualizadoPor": nombre_propio(r.actualizado_por.nombre_completo) if r.actualizado_por else "",
        "enviadoEn": _hora(r.enviado_en), "enviadoEmail": r.enviado_email or "",
        "managerFirma": {"id": r.manager_firma_id, "nombre": nombre_propio(r.manager_firma.nombre_completo) if r.manager_firma else "",
                         "email": r.manager_firma_email or "", "en": _hora(r.manager_firmado_en)},
        "testigo": {"id": r.testigo_id, "nombre": nombre_propio(r.testigo.nombre_completo) if r.testigo else "",
                    "email": r.testigo_email or "", "en": _hora(r.testigo_firmado_en)},
        "firmasCompletas": firmas_completas(r), "enFirmeEn": _hora(r.validado_en),
        "devueltoPor": nombre_propio(r.devuelto_por.nombre_completo) if r.devuelto_por else "",
        "devueltoEn": _hora(r.devuelto_en), "observacion": r.observacion or "",
        "conteo": conteo, "danados": danados,
        "tieneSegundo": tiene_segundo(r), "segundo": seg, "segundoDanados": seg_d, "segundoEn": _hora(r.segundo_en),
        "segundoPor": nombre_propio(r.segundo_por.nombre_completo) if r.segundo_por else "",
        "comparacion": comparacion(r, bodegas_activas(db), materiales_activos(db, r.area)) if tiene_segundo(r) else None,
        "acta": {"id": acta.id, "nombre": acta.nombre, "workdrive": acta.workdrive_estado} if acta else None,
        "evidencias": [{"id": e.id, "materialId": e.material_id, "nombre": e.nombre, "tipo": e.tipo_mime,
                        "tamano": e.tamano, "workdrive": e.workdrive_estado or "PENDIENTE"} for e in r.evidencias],
    }


def _leer_lineas(db: Session, datos: dict, area: str, segundo: bool = False) -> list[ConteoLinea] | str:
    """Cantidades con decimales (ej. 12.5 o 12,5 discos). segundo=True: las del segundo conteo."""
    t_cont, t_dan = ("VCONTEO", "VDANADO") if segundo else ("CONTEO", "DANADO")
    bodegas = {b.id for b in bodegas_activas(db)}
    materiales = {m.id for m in materiales_activos(db, area)}

    def numero(v) -> float:
        return float(str(v if v is not None else 0).strip().replace(",", ".") or 0)

    lineas = []
    for l in datos.get("lineas") or []:
        try:
            b, m, c = int(l.get("bodega_id")), int(l.get("material_id")), numero(l.get("cantidad"))
        except (TypeError, ValueError):
            return "Las cantidades deben ser números (se aceptan decimales, ej. 12.5)."
        if c < 0:
            return "Las cantidades no pueden ser negativas."
        if b in bodegas and m in materiales:
            lineas.append(ConteoLinea(bodega_id=b, material_id=m, tipo=t_cont, cantidad=round(c, 2)))
    for l in datos.get("danados") or []:
        try:
            b, c = int(l.get("bodega_id")), numero(l.get("cantidad"))
        except (TypeError, ValueError):
            return "Las cantidades de discos dañados deben ser números (se aceptan decimales, ej. 12.5)."
        if c < 0:
            return "Las cantidades no pueden ser negativas."
        if b in bodegas:
            lineas.append(ConteoLinea(bodega_id=b, material_id=None, tipo=t_dan, cantidad=round(c, 2)))
    return lineas


def guardar_reporte(db: Session, user: Empleado, datos: dict, enviar: bool = False) -> ConteoReporte | str:
    """El manager guarda su conteo (borrador) o lo envía con su firma (el Director y los testigos salen de Parámetros). Enviado ya no se cambia, salvo que lo
    rechacen o el Director/administrador anule las firmas. Se puede enviar en cualquier momento."""
    try:
        fecha = date.fromisoformat(str(datos.get("fecha") or ""))
    except ValueError:
        return "Elige la fecha del reporte."
    if fecha > hoy_colombia():
        return "La fecha del reporte no puede ser futura."
    try:
        anio, mes = int(datos.get("anio") or 0), int(datos.get("mes") or 0)
    except (TypeError, ValueError):
        return "Elige el mes del reporte."
    if not (1 <= mes <= 12) or not (2020 <= anio <= 2100):
        return "Elige el mes del reporte."
    area = str(datos.get("area") or "").strip().upper()
    if not es_admin(user) and areas_de(user) and area not in areas_de(user):
        area = area_de(user)  # cada manager reporta una de sus áreas asignadas (máx. 2)
    if not area:
        return "Elige el área."
    r = db.query(ConteoReporte).filter(ConteoReporte.area == area, ConteoReporte.anio == anio, ConteoReporte.mes == mes).first()
    if r and not puede_editar(user, r):
        return (f"El conteo de {MESES[mes - 1]} {anio} de {nombre_propio(area)} ya lo está haciendo "
                f"{nombre_propio(r.responsable.nombre_completo) if r.responsable else 'otra persona'}.")
    if r and r.estado == ENVIADO:
        return ("Este conteo ya se envió y está esperando las firmas: no se puede cambiar. Si hay algo mal, "
                "el Director o el área contable lo rechazan, o el Director de Producción anula las firmas.")
    if r and r.estado == EN_FIRME:
        return "Este conteo quedó en firme con las 3 firmas. Si hay un error, el Director de Producción o un administrador anula el reporte completo y se realiza de nuevo."
    lineas = _leer_lineas(db, datos, area)
    if isinstance(lineas, str):
        return lineas
    if r:
        for l in list(r.lineas):
            r.lineas.remove(l)
        r.actualizado_en, r.actualizado_por_id = datetime.utcnow(), user.id
        # El responsable (firma 1, «Cargado por») es quien carga el conteo ahora, no quien lo creó antes
        # (ej. un conteo anulado o devuelto que vuelve a hacer otro manager del área)
        r.responsable_id, r.responsable_email = user.id, user.email or ""
    else:
        r = ConteoReporte(area=area, anio=anio, mes=mes, responsable_id=user.id, responsable_email=user.email or "",
                          estado=BORRADOR)
        db.add(r)
    r.fecha_reporte, r.novedad = fecha, str(datos.get("novedad") or "").strip()[:2000]
    r.lineas.extend(lineas)
    if enviar:
        director = director_produccion(db)
        if not director:
            db.rollback()
            return "Falta asignar el Director de Producción en Parámetros › Director y área contable: es la segunda firma del conteo."
        if not [t for t in testigos(db) if t.id not in (user.id, director.id)]:
            db.rollback()
            return ("Falta asignar el área contable en Parámetros › Director y área contable (personas distintas a quien carga "
                    "el conteo y al Director de Producción): una de ellas acompaña el conteo y firma.")
        ahora = datetime.utcnow()
        r.estado, r.enviado_en, r.enviado_email = ENVIADO, ahora, user.email or ""
        r.segundo_por_id = r.segundo_en = None  # el segundo conteo se hace sobre lo enviado
        r.manager_firma_id = director.id
        r.testigo_id = r.testigo_email = r.testigo_firmado_en = None  # firma cualquiera de la lista de testigos
        if director.id == user.id:  # quien carga es el Director: su firma de Director queda puesta al enviar
            r.manager_firma_email, r.manager_firmado_en = user.email or "", ahora
        else:
            r.manager_firma_email = r.manager_firmado_en = None
        r.observacion = None
    db.commit()
    db.refresh(r)
    return r


def agregar_evidencia(db: Session, user: Empleado, r: ConteoReporte, material_id: int | None, nombre: str,
                      tipo: str, datos: bytes) -> ConteoEvidencia | str:
    if not puede_editar(user, r) or r.estado in (ENVIADO, EN_FIRME):
        return "No puedes agregar soportes a este conteo (ya se envió)."
    if tipo not in TIPOS_EVIDENCIA:
        return "Solo se aceptan fotos (JPG, PNG, WEBP) o PDF."
    if not datos:
        return "El archivo está vacío."
    if len(datos) > MAX_EVIDENCIA:
        return "El archivo pesa más de 5 MB."
    if material_id and not db.get(ConteoMaterial, material_id):
        return "Material no encontrado."
    e = ConteoEvidencia(reporte_id=r.id, material_id=material_id or None, nombre=(nombre or "soporte")[:200],
                        tipo_mime=tipo, tamano=len(datos), datos=datos, creado_por_id=user.id)
    db.add(e)
    db.commit()
    return e


def quitar_evidencia(db: Session, user: Empleado, e: ConteoEvidencia) -> str | None:
    if not puede_editar(user, e.reporte) or e.reporte.estado in (ENVIADO, EN_FIRME):
        return "Este soporte ya no se puede quitar: el conteo se envió."
    _papelera_workdrive(e.workdrive_id)  # también sale de WorkDrive (queda en su papelera)
    db.delete(e)
    db.commit()
    return None


# ---------------- Copia de los soportes en Zoho WorkDrive ----------------

def ruta_workdrive(db: Session, e: ConteoEvidencia) -> tuple[list[str], str]:
    """Carpetas y nombre del archivo: «2026-09 Septiembre» / «Milling» /
    «Conteo inventario mensual - Milling - Septiembre 2026 - S-MATP16-Glaze paste - 12.jpg»."""
    r = e.reporte
    mes = f"{r.anio}-{r.mes:02d} {MESES[r.mes - 1]}"
    area = nombre_propio(r.area)
    if e.material_id:
        m = db.get(ConteoMaterial, e.material_id)
        b = bodegas_activas(db)
        prefijo = b[0].prefijo + "-" if len(b) == 1 else ""
        item = f"{prefijo}{m.codigo}-{m.descripcion}" if m else "Material"
    else:
        item = "Disco de zirconia - DAÑADOS"
    ext = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "application/pdf": ".pdf"}.get(e.tipo_mime, "")
    return [mes, area], f"Conteo inventario mensual - {area} - {MESES[r.mes - 1]} {r.anio} - {item} - {e.id}{ext}"


def copiar_a_workdrive(evidencia_id: int) -> bool:
    """Sube un soporte a WorkDrive. Si falla o no está configurado, queda PENDIENTE/ERROR y se reintenta después."""
    from . import zoho_workdrive as wd
    from .database import SessionLocal
    if not wd.configurado():
        return False
    db = SessionLocal()
    try:
        e = db.get(ConteoEvidencia, evidencia_id)
        if not e or e.workdrive_estado == "OK":
            return False
        ruta, nombre = ruta_workdrive(db, e)
        try:
            e.workdrive_id = wd.subir(ruta, nombre, e.datos, e.tipo_mime)
            e.workdrive_estado, e.workdrive_error = "OK", None
        except Exception as ex:
            detalle = getattr(getattr(ex, "response", None), "text", "") or str(ex)
            e.workdrive_estado, e.workdrive_error = "ERROR", detalle[:300]
            print(f"[Conteo] No se pudo copiar a WorkDrive el soporte #{e.id}: {detalle[:200]}")
        e.workdrive_en = datetime.utcnow()
        db.commit()
        return e.workdrive_estado == "OK"
    finally:
        db.close()


def reintentar_workdrive(limite: int = 50) -> int:
    """Copia los soportes y PDF que faltan (pendientes o con error). Devuelve cuántos quedaron copiados."""
    from . import zoho_workdrive as wd
    from .database import SessionLocal
    if not wd.configurado():
        return 0
    db = SessionLocal()
    try:
        ids = [x for (x,) in db.query(ConteoEvidencia.id).filter(ConteoEvidencia.workdrive_estado != "OK")
               .order_by(ConteoEvidencia.id).limit(limite)]
        docs = [x for (x,) in db.query(ConteoDocumento.id).filter(ConteoDocumento.workdrive_estado != "OK").limit(limite)]
    finally:
        db.close()
    return sum(1 for i in ids if copiar_a_workdrive(i)) + sum(1 for i in docs if copiar_documento_workdrive(i))


def estado_workdrive(db: Session) -> dict:
    from sqlalchemy import func
    from . import zoho_workdrive as wd
    cuenta = dict(db.query(ConteoEvidencia.workdrive_estado, func.count(ConteoEvidencia.id)).group_by(ConteoEvidencia.workdrive_estado).all())
    ultimo_error = (db.query(ConteoEvidencia.workdrive_error).filter(ConteoEvidencia.workdrive_estado == "ERROR")
                    .order_by(ConteoEvidencia.workdrive_en.desc()).limit(1).scalar())
    return {"configurado": wd.configurado(), "ok": cuenta.get("OK", 0), "pendientes": cuenta.get("PENDIENTE", 0) + cuenta.get(None, 0),
            "errores": cuenta.get("ERROR", 0), "ultimoError": ultimo_error or ""}


# ---------------- Reportes del mes ----------------

def consolidado(db: Session, anio: int, mes: int, areas_config: list[str], user: Empleado | None = None) -> dict:
    """Todo el mes, separado por área: cada conteo (los borradores no se muestran), la suma y las áreas que faltan."""
    reportes = (db.query(ConteoReporte).filter(ConteoReporte.anio == anio, ConteoReporte.mes == mes)
                .order_by(ConteoReporte.area).all())
    visibles, totales = [], {}
    for r in reportes:
        d = serializar(db, r, user)
        oculto = r.estado == BORRADOR
        conteo, danados = ({}, {}) if oculto else cantidades_finales(r)
        d["final"], d["finalDanados"], d["oculto"] = conteo, danados, oculto
        if r.estado != EN_FIRME:  # el total del mes es lo ya firmado (en firme)
            conteo, danados = {}, {}
        for k, v in conteo.items():
            totales[k] = round(totales.get(k, 0) + v, 2)
        for b, v in danados.items():
            totales[f"{b}:danados"] = round(totales.get(f"{b}:danados", 0) + v, 2)
        visibles.append(d)
    enviadas = {r.area for r in reportes if r.estado in (ENVIADO, EN_FIRME)}
    return {
        "anio": anio, "mes": mes, "mesNombre": MESES[mes - 1],
        "bodegas": [{"id": b.id, "codigo": b.codigo, "nombre": b.nombre, "prefijo": b.prefijo} for b in bodegas_activas(db)],
        "materiales": [{"id": m.id, "codigo": m.codigo, "descripcion": m.descripcion} for m in materiales_activos(db)],
        "reportes": visibles, "totales": totales,
        "contable": contable_del_mes(db, anio, mes), "puedeCargarContable": bool(user and puede_cargar_contable(db, user)),
        "soportesContables": soportes_contables(db, anio, mes), "contableFirma": firma_contable(db, anio, mes),
        "puedeReabrirContable": bool(user and puede_anular(db, user)),
        "pendientes": [a for a in areas_config if a not in enviadas],
        "enFirme": sum(1 for r in reportes if r.estado == EN_FIRME),
    }


# ---------------- PDF firmados (acta del área y consolidado del mes) ----------------

def _guardar_documento(db: Session, tipo: str, anio: int, mes: int, area: str, nombre: str, datos: bytes,
                       reporte_id: int | None) -> ConteoDocumento:
    """Guarda (o reemplaza) el PDF; si ya estaba en WorkDrive, el anterior va a la papelera y se sube el nuevo."""
    q = db.query(ConteoDocumento).filter_by(tipo=tipo, anio=anio, mes=mes)
    q = q.filter_by(reporte_id=reporte_id) if tipo == "ACTA" else q
    for viejo in q.all():
        _papelera_workdrive(viejo.workdrive_id)
        db.delete(viejo)
    doc = ConteoDocumento(tipo=tipo, anio=anio, mes=mes, area=area, nombre=nombre, datos=datos, reporte_id=reporte_id)
    db.add(doc)
    db.commit()
    return doc


def _papelera_workdrive(archivo_id: str | None) -> None:
    if not archivo_id:
        return
    from . import zoho_workdrive as wd
    try:
        wd.a_papelera(archivo_id)
    except Exception as ex:
        print(f"[Conteo] No se pudo mandar a la papelera de WorkDrive {archivo_id}: {ex}")


def generar_acta(db: Session, r: ConteoReporte) -> ConteoDocumento:
    from .pdf_conteo import acta_area
    datos = acta_area(r, bodegas_activas(db), materiales_activos(db, r.area), MESES)
    nombre = f"Conteo inventario mensual - {nombre_propio(r.area)} - {MESES[r.mes - 1]} {r.anio} - Reporte en firme.pdf"
    return _guardar_documento(db, "ACTA", r.anio, r.mes, r.area, nombre, datos, r.id)


def generar_consolidado(db: Session, anio: int, mes: int, areas_config: list[str]) -> ConteoDocumento:
    from .pdf_conteo import consolidado_mes
    reportes = db.query(ConteoReporte).filter_by(anio=anio, mes=mes).order_by(ConteoReporte.area).all()
    esperando = sorted(r.area for r in reportes if r.estado in (ENVIADO, DEVUELTO))
    con_envio = {r.area for r in reportes if r.estado in (ENVIADO, EN_FIRME, DEVUELTO)}
    datos = consolidado_mes(anio, mes, reportes, bodegas_activas(db), lambda area: materiales_activos(db, area),
                            {r.id: cantidades_finales(r) for r in reportes}, esperando, MESES,
                            [a for a in areas_config if a not in con_envio])
    nombre = f"Conteo inventario mensual - {MESES[mes - 1]} {anio} - Consolidado en firme.pdf"
    return _guardar_documento(db, "CONSOLIDADO", anio, mes, "", nombre, datos, None)


def documentos_en_firme(reporte_id: int, areas_config: list[str]) -> None:
    """En segundo plano, apenas el conteo queda en firme (3 firmas): PDF del reporte del área y consolidado del mes
    actualizado, guardados y copiados a la carpeta de WorkDrive."""
    from .database import SessionLocal
    db = SessionLocal()
    try:
        r = db.get(ConteoReporte, reporte_id)
        if not r or r.estado != EN_FIRME:
            return
        ids = [generar_acta(db, r).id, generar_consolidado(db, r.anio, r.mes, areas_config).id]
    except Exception as ex:  # un PDF fallido nunca debe afectar las firmas
        print(f"[Conteo] Error generando los PDF del conteo #{reporte_id}: {ex}")
        return
    finally:
        db.close()
    for i in ids:
        copiar_documento_workdrive(i)


def actualizar_consolidado(anio: int, mes: int, areas_config: list[str]) -> None:
    """En segundo plano, después de anular firmas: si ya había consolidado del mes, se rehace sin esa área."""
    from .database import SessionLocal
    db = SessionLocal()
    try:
        if not db.query(ConteoDocumento).filter_by(tipo="CONSOLIDADO", anio=anio, mes=mes).first():
            return
        doc_id = generar_consolidado(db, anio, mes, areas_config).id
    except Exception as ex:
        print(f"[Conteo] Error actualizando el consolidado {mes}/{anio}: {ex}")
        return
    finally:
        db.close()
    copiar_documento_workdrive(doc_id)


def quitar_acta(db: Session, r: ConteoReporte) -> None:
    for d in db.query(ConteoDocumento).filter_by(tipo="ACTA", reporte_id=r.id).all():
        _papelera_workdrive(d.workdrive_id)
        db.delete(d)
    db.commit()


def copiar_documento_workdrive(documento_id: int) -> bool:
    """Sube el PDF a WorkDrive: el del área en «Mes Año / Área», el consolidado en «Mes Año»."""
    from . import zoho_workdrive as wd
    from .database import SessionLocal
    if not wd.configurado():
        return False
    db = SessionLocal()
    try:
        d = db.get(ConteoDocumento, documento_id)
        if not d or d.workdrive_estado == "OK":
            return False
        ruta = [f"{d.anio}-{d.mes:02d} {MESES[d.mes - 1]}"] + ([nombre_propio(d.area)] if d.tipo == "ACTA" else [])
        try:
            d.workdrive_id = wd.subir(ruta, d.nombre, d.datos, "application/pdf")
            d.workdrive_estado, d.workdrive_error = "OK", None
        except Exception as ex:
            detalle = getattr(getattr(ex, "response", None), "text", "") or str(ex)
            d.workdrive_estado, d.workdrive_error = "ERROR", detalle[:300]
        d.workdrive_en = datetime.utcnow()
        db.commit()
        return d.workdrive_estado == "OK"
    finally:
        db.close()


# ---------------- Avisos por Cliq (bot) ----------------

def _enviar(emails: list[str], texto: str, url: str = "") -> bool:
    from .zoho_cliq import enviar_cliq_varios, boton_enlace
    emails = list(dict.fromkeys(e for e in emails if e))
    if not emails:
        return False
    return bool(enviar_cliq_varios(emails, texto, [boton_enlace("📋 Abrir conteo", url)] if url else None))


def _resumen(r: ConteoReporte) -> str:
    return f"{nombre_propio(r.area)} · {MESES[r.mes - 1]} {r.anio}"


def notificar(reporte_id: int, evento: str) -> None:
    """enviado (a Director y testigo) · en_firme / devuelto (al manager). Corre en segundo plano."""
    from . import config as cfg
    from .database import SessionLocal
    db = SessionLocal()
    try:
        r = db.get(ConteoReporte, reporte_id)
        if not r:
            return
        if evento == "enviado":  # a quienes les falta firmar: Director de Producción y todos los testigos de la lista
            url = f"{cfg.BASE_URL}/conteo/firma/{r.id}"
            destinos = ([r.manager_firma.email] if r.manager_firma and not r.manager_firmado_en else []) + \
                       ([t.email for t in testigos_posibles(db, r)] if not r.testigo_firmado_en else [])
            texto = (f"✍️ *Conteo de inventario pendiente de tu firma*\n{_resumen(r)}\n"
                     f"Cargado por: {nombre_propio(r.responsable.nombre_completo) if r.responsable else '—'}\n"
                     f"Hagan el segundo conteo, regístrenlo y firmen (o recházalo con una observación) en: {url}\n"
                     f"(Área contable: basta con la firma de una persona.)")
        elif evento == "en_firme":
            url = f"{cfg.BASE_URL}/conteo"
            destinos = [r.responsable.email if r.responsable else ""]
            texto = f"✅ *Tu conteo de inventario quedó en firme* (3 firmas)\n{_resumen(r)}\nEl PDF firmado ya está en la carpeta."
        elif evento == "anulado":
            url = f"{cfg.BASE_URL}/conteo"
            destinos = [r.responsable.email if r.responsable else ""]
            texto = (f"🚫 *Tu conteo de inventario fue anulado*\n{_resumen(r)}\n{r.observacion}\n"
                     f"Debes realizarlo de nuevo (conteo, soportes y envío) en: {url}")
        elif evento == "devuelto":
            url = f"{cfg.BASE_URL}/conteo"
            destinos = [r.responsable.email if r.responsable else ""]
            texto = (f"↩️ *Tu conteo de inventario volvió para corregir*\n{_resumen(r)}\n"
                     f"{r.observacion}\nCorrígelo y envíalo de nuevo en: {url}")
        else:
            return
        _enviar(destinos, texto, url)
    except Exception as ex:  # un aviso fallido nunca debe afectar el conteo
        print(f"[Conteo] Error enviando aviso ({evento}) del conteo #{reporte_id}: {ex}")
    finally:
        db.close()


def enviar_recordatorios(hoy: date | None = None) -> int:
    """Una vez al día, los últimos 3 días del mes y los primeros 3 del mes siguiente: a los managers con acceso
    cuya área no ha enviado el conteo. Devuelve cuántos recordatorios envió."""
    from . import config as cfg
    from .database import SessionLocal
    from .acceso_produccion import ProduccionAcceso
    hoy = hoy or hoy_colombia()
    db = SessionLocal()
    enviados = 0
    try:
        ultimo = calendar.monthrange(hoy.year, hoy.month)[1]
        candidatos = []
        if hoy.day > ultimo - DIAS_RECORDATORIO:
            candidatos.append((hoy.year, hoy.month))
        if hoy.day <= DIAS_RECORDATORIO:
            ant = hoy.replace(day=1) - timedelta(days=1)
            candidatos.append((ant.year, ant.month))
        if not candidatos:
            return 0
        ids = {a.empleado_id for a in db.query(ProduccionAcceso).filter(ProduccionAcceso.submodulo == "conteo")}
        for e in db.query(Empleado).filter(Empleado.id.in_(ids or [0]), Empleado.activo == 1).all():
            if not areas_de(e) or db.query(ConteoAviso).filter_by(empleado_id=e.id, fecha=hoy).first():
                continue
            faltan = []
            for area_e in areas_de(e):  # cada una de sus áreas (máx. 2)
                for anio, mes in candidatos:
                    r = db.query(ConteoReporte).filter_by(area=area_e, anio=anio, mes=mes).first()
                    if not r or r.estado in (BORRADOR, DEVUELTO, ANULADO):
                        faltan.append((area_e, anio, mes))
            if not faltan:
                continue
            area, anio, mes = faltan[0]
            texto = (f"🔔 *Recordatorio: conteo de inventario de {MESES[mes - 1]} {anio}*\n"
                     f"Área: {nombre_propio(area)}\nEnvíalo en: {cfg.BASE_URL}/conteo")
            if _enviar([e.email], texto, f"{cfg.BASE_URL}/conteo"):
                enviados += 1
            db.add(ConteoAviso(empleado_id=e.id, fecha=hoy))
            db.commit()
    finally:
        db.close()
    return enviados
