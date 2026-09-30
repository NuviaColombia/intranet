"""Lógica de Producción › Conteo inventario mensual (ver models_conteo.py)."""
from datetime import datetime, date, timedelta
from sqlalchemy.orm import Session
from .models import Empleado
from .models_conteo import ConteoBodega, ConteoMaterial, ConteoReporte, ConteoLinea, ConteoEvidencia
from .formato import nombre_propio

MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre",
         "Noviembre", "Diciembre"]
BODEGAS_INICIALES = [("103", "BIENES", "B"), ("200", "SERVICIO", "S")]
MATERIALES_INICIALES = [("MATP6", "Incisal Enhancer 1.5 DPLB10"), ("MATP9", "Tissue"), ("MATP15", "Glaze Stain Liquid"),
                        ("MATP16", "Glaze paste"), ("MATP20", "Miyo"), ("MATP23", "Bonding Illusion o Ziradd"),
                        ("MATP27", "Disco de Zirconia"), ("MATP53", "Ceramic spheres ZR Pink (DPCG07)"),
                        ("MATP54", "ZIR Bonder DPCG08"), ("MATP55", "Bonder Liquid DPCG05")]
TIPOS_EVIDENCIA = ("image/jpeg", "image/png", "image/webp", "application/pdf")
MAX_EVIDENCIA = 5 * 1024 * 1024  # 5 MB por archivo (las fotos se comprimen en el navegador antes de subir)


def hoy_colombia() -> date:
    return (datetime.utcnow() - timedelta(hours=5)).date()


def es_admin(user: Empleado) -> bool:
    return user.rol in ("admin", "superadmin")


def asegurar_catalogo(db: Session) -> None:
    """La primera vez: las bodegas y materiales del formulario anterior (se editan en Parámetros)."""
    if db.query(ConteoBodega).count() == 0:
        for i, (codigo, nombre, prefijo) in enumerate(BODEGAS_INICIALES, start=1):
            db.add(ConteoBodega(codigo=codigo, nombre=nombre, prefijo=prefijo, orden=i))
    if db.query(ConteoMaterial).count() == 0:
        for i, (codigo, desc) in enumerate(MATERIALES_INICIALES, start=1):
            db.add(ConteoMaterial(codigo=codigo, descripcion=desc, orden=i))
    db.commit()


def bodegas_activas(db: Session) -> list[ConteoBodega]:
    return db.query(ConteoBodega).filter(ConteoBodega.activo.is_(True)).order_by(ConteoBodega.orden, ConteoBodega.codigo).all()


def materiales_activos(db: Session) -> list[ConteoMaterial]:
    return db.query(ConteoMaterial).filter(ConteoMaterial.activo.is_(True)).order_by(ConteoMaterial.orden, ConteoMaterial.codigo).all()


def etiqueta(bodega: ConteoBodega, material: ConteoMaterial) -> str:
    return f"{bodega.prefijo}-{material.codigo}-{material.descripcion}"


def area_de(user: Empleado) -> str:
    """Área con la que reporta: la asignada en Producción (Parámetros › Accesos de Cambio de custodia)."""
    return (user.area_custodia or "").strip().upper()


def puede_editar(user: Empleado, r: ConteoReporte) -> bool:
    return es_admin(user) or r.responsable_id == user.id or (area_de(user) and area_de(user) == r.area)


def serializar(r: ConteoReporte, con_lineas: bool = True) -> dict:
    d = {
        "id": r.id, "fechaReporte": r.fecha_reporte.isoformat(), "anio": r.anio, "mes": r.mes,
        "mesNombre": MESES[r.mes - 1], "area": r.area,
        "responsable": nombre_propio(r.responsable.nombre_completo) if r.responsable else "",
        "responsableEmail": r.responsable_email, "novedad": r.novedad or "",
        "creadoEn": (r.creado_en - timedelta(hours=5)).strftime("%d/%m/%Y %I:%M %p") if r.creado_en else "",
        "actualizadoEn": (r.actualizado_en - timedelta(hours=5)).strftime("%d/%m/%Y %I:%M %p") if r.actualizado_en else "",
        "actualizadoPor": nombre_propio(r.actualizado_por.nombre_completo) if r.actualizado_por else "",
        "evidencias": [{"id": e.id, "materialId": e.material_id, "nombre": e.nombre, "tipo": e.tipo_mime, "tamano": e.tamano}
                       for e in r.evidencias],
    }
    if con_lineas:
        d["conteo"] = {f"{l.bodega_id}:{l.material_id}": l.cantidad for l in r.lineas if l.tipo == "CONTEO"}
        d["danados"] = {str(l.bodega_id): l.cantidad for l in r.lineas if l.tipo == "DANADO"}
    return d


def guardar_reporte(db: Session, user: Empleado, datos: dict) -> ConteoReporte | str:
    """Crea el conteo del área y mes, o lo corrige si ya existe (queda quién y cuándo lo actualizó)."""
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
    bodegas = {b.id for b in bodegas_activas(db)}
    materiales = {m.id for m in materiales_activos(db)}
    lineas = []
    for l in datos.get("lineas") or []:
        try:
            b, m, c = int(l.get("bodega_id")), int(l.get("material_id")), float(l.get("cantidad") or 0)
        except (TypeError, ValueError):
            return "Las cantidades deben ser números."
        if c < 0:
            return "Las cantidades no pueden ser negativas."
        if b in bodegas and m in materiales:
            lineas.append(ConteoLinea(bodega_id=b, material_id=m, tipo="CONTEO", cantidad=round(c, 2)))
    for l in datos.get("danados") or []:
        try:
            b, c = int(l.get("bodega_id")), float(l.get("cantidad") or 0)
        except (TypeError, ValueError):
            return "Las cantidades de discos dañados deben ser números."
        if c < 0:
            return "Las cantidades no pueden ser negativas."
        if b in bodegas:
            lineas.append(ConteoLinea(bodega_id=b, material_id=None, tipo="DANADO", cantidad=round(c, 2)))
    r = db.query(ConteoReporte).filter(ConteoReporte.area == area, ConteoReporte.anio == anio, ConteoReporte.mes == mes).first()
    if r and not puede_editar(user, r):
        return (f"El conteo de {MESES[mes - 1]} {anio} de {nombre_propio(area)} ya lo reportó "
                f"{nombre_propio(r.responsable.nombre_completo) if r.responsable else 'otra persona'}.")
    if r:
        r.lineas.clear()
        r.actualizado_en, r.actualizado_por_id = datetime.utcnow(), user.id
    else:
        r = ConteoReporte(area=area, anio=anio, mes=mes, responsable_id=user.id, responsable_email=user.email or "")
        db.add(r)
    r.fecha_reporte, r.novedad = fecha, str(datos.get("novedad") or "").strip()[:2000]
    r.lineas.extend(lineas)
    db.commit()
    db.refresh(r)
    return r


def agregar_evidencia(db: Session, user: Empleado, r: ConteoReporte, material_id: int | None, nombre: str,
                      tipo: str, datos: bytes) -> ConteoEvidencia | str:
    if not puede_editar(user, r):
        return "No puedes agregar evidencias a este conteo."
    if tipo not in TIPOS_EVIDENCIA:
        return "Solo se aceptan fotos (JPG, PNG, WEBP) o PDF."
    if not datos:
        return "El archivo está vacío."
    if len(datos) > MAX_EVIDENCIA:
        return "El archivo pesa más de 5 MB."
    if material_id and not db.get(ConteoMaterial, material_id):
        return "Material no encontrado."
    e = ConteoEvidencia(reporte_id=r.id, material_id=material_id or None, nombre=(nombre or "evidencia")[:200],
                        tipo_mime=tipo, tamano=len(datos), datos=datos, creado_por_id=user.id)
    db.add(e)
    db.commit()
    return e


def consolidado(db: Session, anio: int, mes: int, areas_config: list[str]) -> dict:
    """Todo el mes: cada reporte, la suma por bodega y material, y las áreas que aún no reportan."""
    reportes = (db.query(ConteoReporte).filter(ConteoReporte.anio == anio, ConteoReporte.mes == mes)
                .order_by(ConteoReporte.area).all())
    bodegas, materiales = bodegas_activas(db), materiales_activos(db)
    totales: dict[str, float] = {}
    for r in reportes:
        for l in r.lineas:
            clave = f"{l.bodega_id}:{l.material_id}" if l.tipo == "CONTEO" else f"{l.bodega_id}:danados"
            totales[clave] = round(totales.get(clave, 0) + l.cantidad, 2)
    reportadas = {r.area for r in reportes}
    return {
        "anio": anio, "mes": mes, "mesNombre": MESES[mes - 1],
        "bodegas": [{"id": b.id, "codigo": b.codigo, "nombre": b.nombre, "prefijo": b.prefijo} for b in bodegas],
        "materiales": [{"id": m.id, "codigo": m.codigo, "descripcion": m.descripcion} for m in materiales],
        "reportes": [serializar(r) for r in reportes],
        "totales": totales,
        "pendientes": [a for a in areas_config if a not in reportadas],
    }
