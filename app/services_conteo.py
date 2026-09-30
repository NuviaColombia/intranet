"""Lógica de Producción › Conteo inventario mensual (ver models_conteo.py).

Flujo de cada área y mes: el manager guarda un BORRADOR y lo ENVÍA con su firma → los validadores hacen su propio
conteo a ciegas (no ven el del manager hasta guardar el suyo) → el sistema compara → el validador VALIDA (firma y
queda cerrado) o DEVUELVE con observación (el manager corrige y reenvía)."""
import calendar
from datetime import datetime, date, timedelta
from sqlalchemy.orm import Session
from .models import Empleado
from .models_conteo import (ConteoBodega, ConteoMaterial, ConteoMaterialArea, ConteoValidador, ConteoConfig, ConteoReporte,
                            ConteoLinea, ConteoEvidencia, ConteoAviso, ConteoDocumento, ConteoManagerArea,
                            BORRADOR, ENVIADO, DEVUELTO, VALIDADO)
from .formato import nombre_propio

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
CONFIG_INICIAL = {"tolerancia": "0", "dia_limite": "3"}
DIAS_RECORDATORIO_ANTES = 3  # los últimos 3 días del mes también se recuerda


def hoy_colombia() -> date:
    return (datetime.utcnow() - timedelta(hours=5)).date()


def _hora(m: datetime | None) -> str:
    return (m - timedelta(hours=5)).strftime("%d/%m/%Y %I:%M %p") if m else ""


def es_admin(user: Empleado) -> bool:
    return user.rol in ("admin", "superadmin")


def es_validador(db: Session, user: Empleado) -> bool:
    return db.query(ConteoValidador).filter(ConteoValidador.empleado_id == user.id).first() is not None


def puede_validar(db: Session, user: Empleado) -> bool:
    return es_admin(user) or es_validador(db, user)


def asegurar_catalogo(db: Session) -> None:
    """La primera vez: las bodegas, materiales y ajustes del formulario anterior (se editan en Parámetros)."""
    if db.query(ConteoBodega).count() == 0:
        for i, (codigo, nombre, prefijo, activa) in enumerate(BODEGAS_INICIALES, start=1):
            db.add(ConteoBodega(codigo=codigo, nombre=nombre, prefijo=prefijo, orden=i, activo=activa))
    if db.query(ConteoMaterial).count() == 0:
        for i, (codigo, desc) in enumerate(MATERIALES_INICIALES, start=1):
            db.add(ConteoMaterial(codigo=codigo, descripcion=desc, orden=i))
    for clave, valor in CONFIG_INICIAL.items():
        if not db.get(ConteoConfig, clave):
            db.add(ConteoConfig(clave=clave, valor=valor))
    db.commit()


def config(db: Session) -> dict:
    c = {k: v for k, v in CONFIG_INICIAL.items()}
    c.update({x.clave: x.valor for x in db.query(ConteoConfig)})
    try:
        tol = max(float(c["tolerancia"]), 0)
    except ValueError:
        tol = 0.0
    try:
        dia = min(max(int(c["dia_limite"]), 0), 28)
    except ValueError:
        dia = 3
    return {"tolerancia": tol, "dia_limite": dia}


def fecha_limite(db: Session, anio: int, mes: int) -> date:
    """Último día para enviar el conteo del mes: el «día límite» del mes siguiente (0 = último día del mismo mes)."""
    dia = config(db)["dia_limite"]
    if dia == 0:
        return date(anio, mes, calendar.monthrange(anio, mes)[1])
    sig = date(anio + (mes == 12), 1 if mes == 12 else mes + 1, 1)
    return sig.replace(day=dia)


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


def area_de(user: Empleado) -> str:
    """Área con la que reporta: la asignada en Producción (Parámetros › Accesos de Cambio de custodia)."""
    return (user.area_custodia or "").strip().upper()


def manager_de_area(db: Session, area: str) -> Empleado | None:
    x = db.query(ConteoManagerArea).filter(ConteoManagerArea.area == (area or "").strip().upper()).first()
    return x.empleado if x and x.empleado and x.empleado.activo else None


def firmas_completas(r: ConteoReporte) -> bool:
    """Las 3 firmas del conteo: quien lo carga, el manager del área y el testigo."""
    return bool(r.enviado_en and r.manager_firmado_en and r.testigo_firmado_en)


def rol_firmante(user: Empleado, r: ConteoReporte) -> str:
    """"manager" / "testigo" si a esta persona le falta firmar el conteo (enviado)."""
    if r.estado != ENVIADO:
        return ""
    if r.manager_firma_id == user.id and not r.manager_firmado_en:
        return "manager"
    if r.testigo_id == user.id and not r.testigo_firmado_en:
        return "testigo"
    return ""


def firmar_conteo(db: Session, user: Empleado, r: ConteoReporte) -> str | None:
    """Firma del manager del área o del testigo: queda su correo Zoho (el de la sesión) y la fecha y hora."""
    rol = rol_firmante(user, r)
    if not rol:
        return "Este conteo no tiene una firma pendiente a tu nombre."
    if rol == "manager":
        r.manager_firma_email, r.manager_firmado_en = user.email or "", datetime.utcnow()
    else:
        r.testigo_email, r.testigo_firmado_en = user.email or "", datetime.utcnow()
    # Si quien firma también era la otra firma pendiente (ej. testigo = manager), no aplica: se eligen distintos
    db.commit()
    return None


def rechazar_firma(db: Session, user: Empleado, r: ConteoReporte, observacion: str) -> str | None:
    """El manager o el testigo no firma: el conteo vuelve a quien lo cargó con la observación."""
    rol = rol_firmante(user, r)
    if not rol:
        return "Este conteo no tiene una firma pendiente a tu nombre."
    obs = (observacion or "").strip()
    if len(obs) < 5:
        return "Escribe la observación (mínimo 5 caracteres): qué se debe corregir."
    quien = "manager del área" if rol == "manager" else "testigo"
    r.estado, r.devuelto_por_id, r.devuelto_en = DEVUELTO, user.id, datetime.utcnow()
    r.observacion = f"No firmó el {quien} ({nombre_propio(user.nombre_completo)}): {obs[:900]}"
    db.commit()
    return None


def puede_editar(user: Empleado, r: ConteoReporte) -> bool:
    return es_admin(user) or r.responsable_id == user.id or bool(area_de(user) and area_de(user) == r.area)


def _cantidades(r: ConteoReporte, tipo: str, tipo_danado: str) -> tuple[dict, dict]:
    conteo = {f"{l.bodega_id}:{l.material_id}": l.cantidad for l in r.lineas if l.tipo == tipo}
    danados = {str(l.bodega_id): l.cantidad for l in r.lineas if l.tipo == tipo_danado}
    return conteo, danados


def comparacion(db: Session, r: ConteoReporte) -> dict:
    """Material por material: conteo del manager, de validación, diferencia y si está dentro de la tolerancia."""
    tol = config(db)["tolerancia"]
    man, man_d = _cantidades(r, "CONTEO", "DANADO")
    val, val_d = _cantidades(r, "VCONTEO", "VDANADO")
    filas, diferencias = {}, 0
    claves = set(man) | set(val) | {f"{b}:danados" for b in set(man_d) | set(val_d)}
    for k in claves:
        if k.endswith(":danados"):
            b = k.split(":")[0]
            m, v = man_d.get(b, 0), val_d.get(b, 0)
        else:
            m, v = man.get(k, 0), val.get(k, 0)
        dif = round(v - m, 2)
        ok = abs(dif) <= tol + 1e-9
        diferencias += 0 if ok else 1
        filas[k] = {"manager": m, "validacion": v, "diferencia": dif, "ok": ok}
    return {"filas": filas, "diferencias": diferencias, "tolerancia": tol}


def serializar(db: Session, r: ConteoReporte, user: Empleado | None = None) -> dict:
    """Datos del conteo. A un validador no se le muestran las cantidades del manager hasta que guarda su conteo."""
    ciego = bool(user and es_validador(db, user) and r.estado == ENVIADO and not r.validacion_guardada_en
                 and r.responsable_id != user.id)
    man, man_d = _cantidades(r, "CONTEO", "DANADO")
    val, val_d = _cantidades(r, "VCONTEO", "VDANADO")
    return {
        "id": r.id, "fechaReporte": r.fecha_reporte.isoformat(), "anio": r.anio, "mes": r.mes,
        "mesNombre": MESES[r.mes - 1], "area": r.area, "estado": r.estado,
        "responsable": nombre_propio(r.responsable.nombre_completo) if r.responsable else "",
        "responsableEmail": r.responsable_email, "novedad": r.novedad or "",
        "creadoEn": _hora(r.creado_en), "actualizadoEn": _hora(r.actualizado_en),
        "actualizadoPor": nombre_propio(r.actualizado_por.nombre_completo) if r.actualizado_por else "",
        "enviadoEn": _hora(r.enviado_en), "enviadoEmail": r.enviado_email or "",
        "validacionPor": nombre_propio(r.validacion_por.nombre_completo) if r.validacion_por else "",
        "validacionGuardadaEn": _hora(r.validacion_guardada_en),
        "validadoPor": nombre_propio(r.validado_por.nombre_completo) if r.validado_por else "",
        "validadoEn": _hora(r.validado_en), "validadoEmail": r.validado_email or "",
        "devueltoPor": nombre_propio(r.devuelto_por.nombre_completo) if r.devuelto_por else "",
        "devueltoEn": _hora(r.devuelto_en), "observacion": r.observacion or "",
        "ciego": ciego,
        "managerFirma": {"id": r.manager_firma_id, "nombre": nombre_propio(r.manager_firma.nombre_completo) if r.manager_firma else "",
                         "email": r.manager_firma_email or "", "en": _hora(r.manager_firmado_en)},
        "testigo": {"id": r.testigo_id, "nombre": nombre_propio(r.testigo.nombre_completo) if r.testigo else "",
                    "email": r.testigo_email or "", "en": _hora(r.testigo_firmado_en)},
        "firmasCompletas": firmas_completas(r),
        "conteo": {} if ciego else man, "danados": {} if ciego else man_d,
        "vconteo": val, "vdanados": val_d,
        "comparacion": None if ciego or not r.validacion_guardada_en else comparacion(db, r),
        "acta": next(({"id": d.id, "nombre": d.nombre, "workdrive": d.workdrive_estado} for d in
                      db.query(ConteoDocumento).filter_by(tipo="ACTA", reporte_id=r.id)), None),
        "evidencias": [{"id": e.id, "materialId": e.material_id, "etapa": e.etapa, "nombre": e.nombre, "tipo": e.tipo_mime,
                        "tamano": e.tamano, "workdrive": e.workdrive_estado or "PENDIENTE"} for e in r.evidencias],
    }


def _leer_lineas(db: Session, datos: dict, area: str, tipo: str, tipo_danado: str) -> list[ConteoLinea] | str:
    bodegas = {b.id for b in bodegas_activas(db)}
    materiales = {m.id for m in materiales_activos(db, area)}
    lineas = []
    for l in datos.get("lineas") or []:
        try:
            b, m, c = int(l.get("bodega_id")), int(l.get("material_id")), float(l.get("cantidad") or 0)
        except (TypeError, ValueError):
            return "Las cantidades deben ser números."
        if c < 0:
            return "Las cantidades no pueden ser negativas."
        if b in bodegas and m in materiales:
            lineas.append(ConteoLinea(bodega_id=b, material_id=m, tipo=tipo, cantidad=round(c, 2)))
    for l in datos.get("danados") or []:
        try:
            b, c = int(l.get("bodega_id")), float(l.get("cantidad") or 0)
        except (TypeError, ValueError):
            return "Las cantidades de discos dañados deben ser números."
        if c < 0:
            return "Las cantidades no pueden ser negativas."
        if b in bodegas:
            lineas.append(ConteoLinea(bodega_id=b, material_id=None, tipo=tipo_danado, cantidad=round(c, 2)))
    return lineas


def guardar_reporte(db: Session, user: Empleado, datos: dict, enviar: bool = False) -> ConteoReporte | str:
    """El manager guarda su conteo (borrador) o lo envía con su firma. Enviado ya no se cambia, salvo que lo devuelvan."""
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
    if not es_admin(user) and area_de(user):
        area = area_de(user)  # cada manager reporta su área asignada
    if not area:
        return "Elige el área."
    r = db.query(ConteoReporte).filter(ConteoReporte.area == area, ConteoReporte.anio == anio, ConteoReporte.mes == mes).first()
    if r and not puede_editar(user, r):
        return (f"El conteo de {MESES[mes - 1]} {anio} de {nombre_propio(area)} ya lo está haciendo "
                f"{nombre_propio(r.responsable.nombre_completo) if r.responsable else 'otra persona'}.")
    if r and r.estado == ENVIADO:
        return "Este conteo ya se envió y está en validación: no se puede cambiar (si hay algo mal, el validador lo devuelve)."
    if r and r.estado == VALIDADO:
        return "Este conteo ya fue validado y quedó cerrado."
    limite = fecha_limite(db, anio, mes)
    if hoy_colombia() > limite and not es_admin(user):
        return (f"El plazo para el conteo de {MESES[mes - 1]} {anio} cerró el {limite.strftime('%d/%m/%Y')}. "
                "Pide a un administrador que lo registre.")
    lineas = _leer_lineas(db, datos, area, "CONTEO", "DANADO")
    if isinstance(lineas, str):
        return lineas
    if r:
        for l in [l for l in r.lineas if l.tipo in ("CONTEO", "DANADO")]:
            r.lineas.remove(l)
        r.actualizado_en, r.actualizado_por_id = datetime.utcnow(), user.id
    else:
        r = ConteoReporte(area=area, anio=anio, mes=mes, responsable_id=user.id, responsable_email=user.email or "",
                          estado=BORRADOR)
        db.add(r)
    r.fecha_reporte, r.novedad = fecha, str(datos.get("novedad") or "").strip()[:2000]
    r.lineas.extend(lineas)
    if enviar:
        manager = manager_de_area(db, area)
        if not manager:
            db.rollback()
            return (f"Falta asignar el manager de {nombre_propio(area)} en Parámetros › Managers por área: "
                    "es quien firma el conteo del área.")
        try:
            testigo = db.get(Empleado, int(datos.get("testigo_id") or 0))
        except (TypeError, ValueError):
            testigo = None
        if not testigo or not testigo.activo:
            db.rollback()
            return "Elige el testigo del conteo (la persona que estuvo presente)."
        if testigo.id in (user.id, manager.id):
            db.rollback()
            return "El testigo debe ser una persona distinta a quien carga el conteo y al manager del área."
        ahora = datetime.utcnow()
        r.estado, r.enviado_en, r.enviado_email = ENVIADO, ahora, user.email or ""
        r.manager_firma_id, r.testigo_id = manager.id, testigo.id
        r.testigo_email = r.testigo_firmado_en = None
        if manager.id == user.id:  # quien carga es el manager del área: su firma queda puesta al enviar
            r.manager_firma_email, r.manager_firmado_en = user.email or "", ahora
        else:
            r.manager_firma_email = r.manager_firmado_en = None
        # Si lo devolvieron y lo reenvía, el validador vuelve a contar a ciegas
        for l in [l for l in r.lineas if l.tipo in ("VCONTEO", "VDANADO")]:
            r.lineas.remove(l)
        r.validacion_guardada_en = r.validacion_por_id = None
    db.commit()
    db.refresh(r)
    return r


def guardar_validacion(db: Session, user: Empleado, r: ConteoReporte, datos: dict, decision: str = "") -> str | None:
    """Conteo del validador (a ciegas). decision: "" guarda y compara · "validar" firma y cierra · "devolver" con observación."""
    if not puede_validar(db, user):
        return "Solo los validadores (Parámetros › Validadores) pueden validar el conteo."
    if r.estado != ENVIADO:
        return {"BORRADOR": "El manager todavía no ha enviado este conteo.", "DEVUELTO": "Este conteo está devuelto al manager.",
                "VALIDADO": "Este conteo ya fue validado."}.get(r.estado, "Este conteo no está para validar.")
    if r.responsable_id == user.id and not es_admin(user):
        return "Quien hizo el conteo no puede validarlo."
    if datos.get("lineas") is not None or datos.get("danados") is not None:
        lineas = _leer_lineas(db, datos, r.area, "VCONTEO", "VDANADO")
        if isinstance(lineas, str):
            return lineas
        for l in [l for l in r.lineas if l.tipo in ("VCONTEO", "VDANADO")]:
            r.lineas.remove(l)
        r.lineas.extend(lineas)
        r.validacion_por_id, r.validacion_guardada_en = user.id, datetime.utcnow()
    if decision and not r.validacion_guardada_en:
        return "Primero guarda tu conteo de validación."
    if decision == "validar" and not firmas_completas(r):
        faltan = [x for x, ok in (("el manager del área", r.manager_firmado_en), ("el testigo", r.testigo_firmado_en)) if not ok]
        return f"Todavía no se puede validar: falta la firma de {' y '.join(faltan)}."
    if decision == "validar":
        r.estado, r.validado_por_id, r.validado_en, r.validado_email = VALIDADO, user.id, datetime.utcnow(), user.email or ""
        r.observacion = None
    elif decision == "devolver":
        obs = str(datos.get("observacion") or "").strip()
        if len(obs) < 5:
            return "Escribe la observación (mínimo 5 caracteres): qué debe revisar el manager."
        r.estado, r.devuelto_por_id, r.devuelto_en, r.observacion = DEVUELTO, user.id, datetime.utcnow(), obs[:1000]
    db.commit()
    return None


def reabrir(db: Session, user: Empleado, r: ConteoReporte) -> str | None:
    if not es_admin(user):
        return "Solo un administrador puede reabrir un conteo validado."
    r.estado, r.validado_en, r.validado_por_id, r.validado_email = DEVUELTO, None, None, None
    r.observacion = f"Reabierto por {nombre_propio(user.nombre_completo)}."
    r.devuelto_por_id, r.devuelto_en = user.id, datetime.utcnow()
    db.commit()
    quitar_acta(db, r)  # el acta firmada deja de valer; se genera otra al validar de nuevo
    return None


def agregar_evidencia(db: Session, user: Empleado, r: ConteoReporte, material_id: int | None, nombre: str,
                      tipo: str, datos: bytes, etapa: str = "MANAGER") -> ConteoEvidencia | str:
    if etapa == "VALIDACION":
        if not puede_validar(db, user) or r.estado != ENVIADO:
            return "No puedes agregar evidencias de validación a este conteo."
    elif not puede_editar(user, r) or r.estado in (ENVIADO, VALIDADO):
        return "No puedes agregar evidencias a este conteo (ya se envió)."
    if tipo not in TIPOS_EVIDENCIA:
        return "Solo se aceptan fotos (JPG, PNG, WEBP) o PDF."
    if not datos:
        return "El archivo está vacío."
    if len(datos) > MAX_EVIDENCIA:
        return "El archivo pesa más de 5 MB."
    if material_id and not db.get(ConteoMaterial, material_id):
        return "Material no encontrado."
    e = ConteoEvidencia(reporte_id=r.id, material_id=material_id or None, nombre=(nombre or "evidencia")[:200], etapa=etapa,
                        tipo_mime=tipo, tamano=len(datos), datos=datos, creado_por_id=user.id)
    db.add(e)
    db.commit()
    return e


def quitar_evidencia(db: Session, user: Empleado, e: ConteoEvidencia) -> str | None:
    r = e.reporte
    if e.etapa == "VALIDACION":
        if not puede_validar(db, user) or r.estado != ENVIADO:
            return "Esta evidencia ya no se puede quitar."
    elif not puede_editar(user, r) or r.estado in (ENVIADO, VALIDADO):
        return "Esta evidencia ya no se puede quitar: el conteo se envió."
    if e.workdrive_id:  # también sale de WorkDrive (queda en su papelera)
        from . import zoho_workdrive as wd
        try:
            wd.a_papelera(e.workdrive_id)
        except Exception as ex:
            print(f"[Conteo] No se pudo mandar a la papelera de WorkDrive la evidencia #{e.id}: {ex}")
    db.delete(e)
    db.commit()
    return None


# ---------------- Copia de las evidencias en Zoho WorkDrive ----------------

def ruta_workdrive(db: Session, e: ConteoEvidencia) -> tuple[list[str], str]:
    """Carpetas y nombre del archivo: «2026-09 Septiembre» / «Milling» /
    «Conteo inventario mensual - Milling - Septiembre 2026 - S-MATP16-Glaze paste (manager) - 12.jpg»."""
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
    etapa = "validación" if e.etapa == "VALIDACION" else "manager"
    ext = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "application/pdf": ".pdf"}.get(e.tipo_mime, "")
    nombre = f"Conteo inventario mensual - {area} - {MESES[r.mes - 1]} {r.anio} - {item} ({etapa}) - {e.id}{ext}"
    return [mes, area], nombre


def copiar_a_workdrive(evidencia_id: int) -> bool:
    """Sube una evidencia a WorkDrive. Si falla o no está configurado, queda PENDIENTE/ERROR y se reintenta después."""
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
            print(f"[Conteo] No se pudo copiar a WorkDrive la evidencia #{e.id}: {detalle[:200]}")
        e.workdrive_en = datetime.utcnow()
        db.commit()
        return e.workdrive_estado == "OK"
    finally:
        db.close()


def reintentar_workdrive(limite: int = 50) -> int:
    """Copia las evidencias que faltan (pendientes o con error). Devuelve cuántas quedaron copiadas."""
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


def cantidad_final(r: ConteoReporte) -> tuple[dict, dict]:
    """Lo que vale del conteo: la validación si ya se validó; si no, lo del manager."""
    if r.estado == VALIDADO and r.validacion_guardada_en:
        return _cantidades(r, "VCONTEO", "VDANADO")
    return _cantidades(r, "CONTEO", "DANADO")


def consolidado(db: Session, anio: int, mes: int, areas_config: list[str], user: Empleado | None = None) -> dict:
    """Todo el mes: cada conteo enviado o validado, la suma por bodega y material, y las áreas que faltan."""
    reportes = (db.query(ConteoReporte).filter(ConteoReporte.anio == anio, ConteoReporte.mes == mes)
                .order_by(ConteoReporte.area).all())
    bodegas, materiales = bodegas_activas(db), materiales_activos(db)
    visibles, totales = [], {}
    validador = bool(user and es_validador(db, user))
    for r in reportes:
        d = serializar(db, r, user)
        oculto = r.estado == BORRADOR or (validador and r.estado == ENVIADO and not r.validacion_guardada_en)
        conteo, danados = ({}, {}) if oculto else cantidad_final(r)
        d["final"], d["finalDanados"], d["oculto"] = conteo, danados, oculto
        for k, v in conteo.items():
            totales[k] = round(totales.get(k, 0) + v, 2)
        for b, v in danados.items():
            totales[f"{b}:danados"] = round(totales.get(f"{b}:danados", 0) + v, 2)
        visibles.append(d)
    enviadas = {r.area for r in reportes if r.estado != BORRADOR}
    return {
        "anio": anio, "mes": mes, "mesNombre": MESES[mes - 1], "fechaLimite": fecha_limite(db, anio, mes).strftime("%d/%m/%Y"),
        "bodegas": [{"id": b.id, "codigo": b.codigo, "nombre": b.nombre, "prefijo": b.prefijo} for b in bodegas],
        "materiales": [{"id": m.id, "codigo": m.codigo, "descripcion": m.descripcion} for m in materiales],
        "reportes": visibles, "totales": totales,
        "pendientes": [a for a in areas_config if a not in enviadas],
        "validados": sum(1 for r in reportes if r.estado == VALIDADO),
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
    datos = acta_area(r, bodegas_activas(db), materiales_activos(db, r.area), comparacion(db, r), MESES)
    nombre = f"Conteo inventario mensual - {nombre_propio(r.area)} - {MESES[r.mes - 1]} {r.anio} - Acta firmada.pdf"
    return _guardar_documento(db, "ACTA", r.anio, r.mes, r.area, nombre, datos, r.id)


def generar_consolidado(db: Session, anio: int, mes: int, areas_config: list[str]) -> ConteoDocumento:
    from .pdf_conteo import consolidado_mes
    reportes = db.query(ConteoReporte).filter_by(anio=anio, mes=mes).order_by(ConteoReporte.area).all()
    por_validar = sorted(r.area for r in reportes if r.estado in (ENVIADO, DEVUELTO))  # esperando validación o corrección
    con_envio = {r.area for r in reportes if r.estado != BORRADOR}
    finales = {r.id: cantidad_final(r) for r in reportes}
    comparaciones = {r.id: comparacion(db, r) for r in reportes if r.estado == VALIDADO}
    datos = consolidado_mes(anio, mes, reportes, bodegas_activas(db), lambda area: materiales_activos(db, area), comparaciones,
                            finales, por_validar, MESES, [a for a in areas_config if a not in con_envio])
    nombre = f"Conteo inventario mensual - {MESES[mes - 1]} {anio} - Consolidado firmado.pdf"
    return _guardar_documento(db, "CONSOLIDADO", anio, mes, "", nombre, datos, None)


def documentos_al_validar(reporte_id: int, areas_config: list[str]) -> None:
    """En segundo plano, después de validar: acta del área + consolidado del mes actualizado, y copia en WorkDrive."""
    from .database import SessionLocal
    db = SessionLocal()
    try:
        r = db.get(ConteoReporte, reporte_id)
        if not r or r.estado != VALIDADO:
            return
        acta = generar_acta(db, r)
        cons = generar_consolidado(db, r.anio, r.mes, areas_config)
        ids = [acta.id, cons.id]
    except Exception as ex:  # un PDF fallido nunca debe afectar la validación
        print(f"[Conteo] Error generando los PDF del conteo #{reporte_id}: {ex}")
        return
    finally:
        db.close()
    for i in ids:
        copiar_documento_workdrive(i)


def quitar_acta(db: Session, r: ConteoReporte) -> None:
    for d in db.query(ConteoDocumento).filter_by(tipo="ACTA", reporte_id=r.id).all():
        _papelera_workdrive(d.workdrive_id)
        db.delete(d)
    db.commit()


def copiar_documento_workdrive(documento_id: int) -> bool:
    """Sube el PDF a WorkDrive: el acta en «Mes Año / Área», el consolidado en «Mes Año»."""
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
    """evento: enviado (a validadores) · devuelto / validado (al manager). Corre en segundo plano."""
    from . import config as cfg
    from .database import SessionLocal
    db = SessionLocal()
    try:
        r = db.get(ConteoReporte, reporte_id)
        if not r:
            return
        url = f"{cfg.BASE_URL}/conteo?tab={'validacion' if evento == 'firmado' else 'nuevo'}"
        if evento == "enviado":  # a quienes les falta firmar: manager del área y testigo
            url = f"{cfg.BASE_URL}/conteo/firma/{r.id}"
            destinos = ([r.manager_firma.email] if r.manager_firma and not r.manager_firmado_en else []) + \
                       ([r.testigo.email] if r.testigo and not r.testigo_firmado_en else [])
            texto = (f"✍️ *Conteo de inventario pendiente de tu firma*\n{_resumen(r)}\n"
                     f"Cargado por: {nombre_propio(r.responsable.nombre_completo) if r.responsable else '—'}\n"
                     f"Revísalo y fírmalo (o recházalo con una observación) en: {url}")
            _enviar(destinos, texto, url)
            if not firmas_completas(r):
                return
            evento = "firmado"
            url = f"{cfg.BASE_URL}/conteo?tab=validacion"
        if evento == "firmado":  # con las 3 firmas pasa a los validadores
            destinos = [v.empleado.email for v in db.query(ConteoValidador).all() if v.empleado and v.empleado.activo]
            texto = (f"📋 *Conteo de inventario para validar* (ya tiene las 3 firmas)\n{_resumen(r)}\n"
                     f"Cargado por: {nombre_propio(r.responsable.nombre_completo) if r.responsable else '—'}\n"
                     f"Haz tu conteo de validación en: {url}")
        elif evento == "devuelto":
            destinos = [r.responsable.email if r.responsable else ""]
            texto = (f"↩️ *Tu conteo de inventario fue devuelto*\n{_resumen(r)}\n"
                     f"Observación: {r.observacion}\nCorrígelo y envíalo de nuevo en: {url}")
        elif evento == "validado":
            destinos = [r.responsable.email if r.responsable else ""]
            texto = (f"✅ *Tu conteo de inventario fue validado*\n{_resumen(r)}\n"
                     f"Validado por: {nombre_propio(r.validado_por.nombre_completo) if r.validado_por else '—'}")
        else:
            return
        _enviar(destinos, texto, url)
    except Exception as ex:  # un aviso fallido nunca debe afectar el conteo
        print(f"[Conteo] Error enviando aviso ({evento}) del conteo #{reporte_id}: {ex}")
    finally:
        db.close()


def enviar_recordatorios(hoy: date | None = None) -> int:
    """Una vez al día, desde 3 días antes de fin de mes hasta la fecha límite: a los managers con acceso cuya área
    no ha enviado el conteo. Devuelve cuántos recordatorios envió."""
    from . import config as cfg
    from .database import SessionLocal
    from .acceso_produccion import ProduccionAcceso
    hoy = hoy or hoy_colombia()
    db = SessionLocal()
    enviados = 0
    try:
        # ¿De qué mes toca recordar? El actual (últimos días) o el anterior (hasta la fecha límite)
        ultimo = calendar.monthrange(hoy.year, hoy.month)[1]
        candidatos = []
        if hoy.day > ultimo - DIAS_RECORDATORIO_ANTES:
            candidatos.append((hoy.year, hoy.month))
        ant = (hoy.replace(day=1) - timedelta(days=1))
        if hoy <= fecha_limite(db, ant.year, ant.month):
            candidatos.append((ant.year, ant.month))
        if not candidatos:
            return 0
        ids = {a.empleado_id for a in db.query(ProduccionAcceso).filter(ProduccionAcceso.submodulo == "conteo")}
        for e in db.query(Empleado).filter(Empleado.id.in_(ids or [0]), Empleado.activo == 1).all():
            area = area_de(e)
            if not area or db.query(ConteoAviso).filter_by(empleado_id=e.id, fecha=hoy).first():
                continue
            faltan = []
            for anio, mes in candidatos:
                r = db.query(ConteoReporte).filter_by(area=area, anio=anio, mes=mes).first()
                if not r or r.estado in (BORRADOR, DEVUELTO):
                    faltan.append((anio, mes))
            if not faltan:
                continue
            anio, mes = faltan[0]
            texto = (f"🔔 *Recordatorio: conteo de inventario de {MESES[mes - 1]} {anio}*\n"
                     f"Área: {nombre_propio(area)} · Plazo: {fecha_limite(db, anio, mes).strftime('%d/%m/%Y')}\n"
                     f"Envíalo en: {cfg.BASE_URL}/conteo")
            if _enviar([e.email], texto, f"{cfg.BASE_URL}/conteo"):
                enviados += 1
            db.add(ConteoAviso(empleado_id=e.id, fecha=hoy))
            db.commit()
    finally:
        db.close()
    return enviados
