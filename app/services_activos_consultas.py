"""Módulo Activos › Design: consultas de lectura (listados, filtros, fichas, dashboard). Separado de
services_activos.py (que tiene las escrituras) igual que el proyecto original separaba
consultas.py de gestion_activos.py.

Nota sobre "salud" de un equipo: el proyecto original la calculaba con un CASE de SQL
(`_SALUD`) cuyo detalle exacto no se migró; aquí se reconstruye con una regla equivalente y
documentada (ver `salud_equipo`). Si alguna vez no coincide con lo que la gente de TI espera ver,
ese es el punto a ajustar."""
from datetime import date, datetime, timedelta
from sqlalchemy import func, or_
from sqlalchemy.orm import Session
from .models import Empleado
from .models_activos import (ActivosArea, ActivosPerfil, ActivosEquipo, ActivosDongle, ActivosHistorialAsignacion,
                             ActivosMantenimiento, ActivosJornadaMantenimiento, ActivosActaEntrega)
from .services_activos_mantenimiento import _conteo_servicios, estado_jornada, _equipos_del_grupo

DIAS_AVISO_SOLICITUD = 7
DIAS_ALERTA_MANTENIMIENTO = 30


# ---------- Helpers de dominio (equivalentes a la vista v_usuarios y al CASE de salud) ----------

def _area_y_padre(db: Session, id_area_id: int | None) -> tuple[str | None, str | None]:
    """(área mostrada, departamento) -- si el área tiene padre, ella misma es el "departamento" y el
    padre es el "área"; si no tiene padre, es un área principal sin departamento."""
    if id_area_id is None:
        return "Sin área", None
    a = db.get(ActivosArea, id_area_id)
    if not a:
        return "Sin área", None
    if a.id_area_padre is None:
        return a.nombre_area, None
    padre = db.get(ActivosArea, a.id_area_padre)
    return (padre.nombre_area if padre else a.nombre_area), a.nombre_area


def cargo_efectivo(empleado: Empleado, area: str | None, departamento: str | None) -> str:
    cargo = (empleado.cargo or "").strip()
    if cargo:
        return cargo
    au, du = (area or "").upper(), (departamento or "").upper()
    if au == "DESIGN" and du == "N2":
        return "N2"
    if au == "DESIGN" and du == "N3":
        return "DESIGNER"
    if au == "FACE" or du == "FACE":
        return "FACE DESIGNER"
    return ""


def mostrar_dongles(area: str | None, departamento: str | None) -> bool:
    return not ((area or "").upper() == "DESIGN" and (departamento or "").upper() == "N2")


def situacion_dongle(equipo: ActivosEquipo, tiene_dongle: bool, requiere_exocad: bool) -> str:
    if equipo.empleado_id is None:
        return "NO_APLICA"
    if tiene_dongle:
        return "TIENE"
    return "FALTA" if requiere_exocad else "SIN_REQUERIR"


def salud_equipo(db: Session, asset_tag: str, estado: str) -> str:
    """OPTIMO / NOVEDADES / EN_MANTENIMIENTO / SIN_REVISION."""
    if estado == "MANTENIMIENTO":
        return "EN_MANTENIMIENTO"
    correctivo_abierto = db.query(ActivosMantenimiento.id_mantenimiento).filter(
        ActivosMantenimiento.asset_tag == asset_tag, ActivosMantenimiento.tipo_mantenimiento == "CORRECTIVO",
        ActivosMantenimiento.estado_mantenimiento.in_(("PROGRAMADO", "EN_PROCESO"))).first()
    if correctivo_abierto:
        return "NOVEDADES"
    algun_servicio = db.query(ActivosMantenimiento.id_mantenimiento).filter(
        ActivosMantenimiento.asset_tag == asset_tag, ActivosMantenimiento.estado_mantenimiento == "COMPLETADO").first()
    return "OPTIMO" if algun_servicio else "SIN_REVISION"


def _requiere_exocad(db: Session, id_area_id: int | None) -> bool:
    if id_area_id is None:
        return False
    a = db.get(ActivosArea, id_area_id)
    return bool(a and a.requiere_exocad)


# ---------- Resumen / dashboard ----------

def obtener_resumen(db: Session) -> dict:
    activos = ActivosEquipo.retirado.is_(False)
    equipos = db.query(func.count(ActivosEquipo.asset_tag)).filter(activos).scalar() or 0
    en_uso = db.query(func.count(ActivosEquipo.asset_tag)).filter(activos, ActivosEquipo.estado == "EN USO").scalar() or 0
    stock = db.query(func.count(ActivosEquipo.asset_tag)).filter(activos, ActivosEquipo.estado == "STOCK").scalar() or 0
    mantenimiento = db.query(func.count(ActivosEquipo.asset_tag)).filter(activos, ActivosEquipo.estado == "MANTENIMIENTO").scalar() or 0
    dongles = db.query(func.count(ActivosDongle.id_dongle)).scalar() or 0
    disponibles = db.query(func.count(ActivosDongle.id_dongle)).filter(ActivosDongle.estado_dongle == "DISPONIBLE").scalar() or 0
    filas = listar_equipos(db)
    sin_dongle = sum(1 for f in filas if f["situacion_dongle"] == "FALTA")
    sin_requerir = sum(1 for f in filas if f["situacion_dongle"] == "SIN_REQUERIR" and f.get("dongle"))
    return {"equipos": equipos, "en_uso": en_uso, "stock": stock, "mantenimiento": mantenimiento,
           "dongles": dongles, "dongles_disponibles": disponibles, "equipos_sin_dongle": sin_dongle,
           "dongles_sin_requerir": sin_requerir}


# ---------- Equipos ----------

def listar_equipos(db: Session, busqueda: str = "", area: str | None = None, departamento: str | None = None,
                   estado: str | None = None, tipo: str | None = None, dongle: str | None = None) -> list[dict]:
    q = db.query(ActivosEquipo).filter(ActivosEquipo.retirado.is_(False))
    if estado:
        q = q.filter(ActivosEquipo.estado == estado)
    if tipo:
        q = q.filter(ActivosEquipo.tipo_equipo == tipo)
    equipos = q.order_by(ActivosEquipo.asset_tag).all()
    empleado_ids = [e.empleado_id for e in equipos if e.empleado_id]
    empleados = {e.id: e for e in db.query(Empleado).filter(Empleado.id.in_(empleado_ids or [0])).all()}
    perfiles = {p.empleado_id: p for p in db.query(ActivosPerfil).filter(ActivosPerfil.empleado_id.in_(empleado_ids or [0])).all()}
    dongles_por_equipo = {d.asset_tag_asignado: d for d in db.query(ActivosDongle).filter(ActivosDongle.asset_tag_asignado.isnot(None)).all()}
    out = []
    for e in equipos:
        emp = empleados.get(e.empleado_id) if e.empleado_id else None
        perfil = perfiles.get(e.empleado_id) if e.empleado_id else None
        a, d = _area_y_padre(db, perfil.id_area_id if perfil else None)
        dongle_obj = dongles_por_equipo.get(e.asset_tag)
        requiere = _requiere_exocad(db, perfil.id_area_id if perfil else None)
        fila = {"asset_tag": e.asset_tag, "tipo_equipo": e.tipo_equipo, "marca": e.marca, "modelo": e.modelo_referencia,
               "serial_number": e.serial_number, "sistema_operativo": e.sistema_operativo, "estado": e.estado,
               "usuario": emp.nombre_completo if emp else None, "area": a, "departamento": d,
               "dongle": dongle_obj.numero_dongle if dongle_obj else None,
               "situacion_dongle": situacion_dongle(e, dongle_obj is not None, requiere)}
        if busqueda:
            texto = " ".join(str(v) for v in (fila["asset_tag"], fila["serial_number"], fila["usuario"], fila["modelo"], fila["marca"]) if v).lower()
            if busqueda.lower() not in texto:
                continue
        if area and (fila["area"] or "").upper() != area.upper():
            continue
        if departamento and (fila["departamento"] or "").upper() != departamento.upper():
            continue
        if dongle and fila["situacion_dongle"] != dongle:
            continue
        out.append(fila)
    return out


def listar_equipos_retirados(db: Session, busqueda: str = "") -> list[dict]:
    q = db.query(ActivosEquipo).filter(ActivosEquipo.retirado.is_(True)).order_by(ActivosEquipo.fecha_retiro.desc())
    out = []
    for e in q.all():
        if busqueda and busqueda.lower() not in f"{e.asset_tag} {e.serial_number} {e.motivo_retiro or ''}".lower():
            continue
        out.append({"asset_tag": e.asset_tag, "tipo_equipo": e.tipo_equipo, "marca": e.marca, "modelo": e.modelo_referencia,
                    "serial_number": e.serial_number, "sistema_operativo": e.sistema_operativo,
                    "motivo_retiro": e.motivo_retiro, "fecha_retiro": e.fecha_retiro, "observaciones": e.observaciones})
    return out


def listar_historial_equipo(db: Session, asset_tag: str) -> list[dict]:
    filas = db.query(ActivosHistorialAsignacion).filter(
        ActivosHistorialAsignacion.tipo_activo == "EQUIPO", ActivosHistorialAsignacion.asset_tag == asset_tag
    ).order_by(ActivosHistorialAsignacion.fecha_inicio.desc()).all()
    empleados = {e.id: e for e in db.query(Empleado).filter(
        Empleado.id.in_([f.empleado_id for f in filas if f.empleado_id] or [0])).all()}
    return [{"fecha_inicio": f.fecha_inicio, "fecha_fin": f.fecha_fin, "motivo": f.motivo,
            "usuario": empleados[f.empleado_id].nombre_completo if f.empleado_id in empleados else None} for f in filas]


def listar_mantenimientos_equipo(db: Session, asset_tag: str) -> list[dict]:
    return listar_mantenimientos(db, asset_tag=asset_tag)


def obtener_contexto_acta_equipo(db: Session, asset_tag: str) -> dict:
    e = db.query(ActivosEquipo).filter(ActivosEquipo.asset_tag == asset_tag, ActivosEquipo.retirado.is_(False),
                                       ActivosEquipo.estado == "EN USO", ActivosEquipo.empleado_id.isnot(None)).first()
    if not e:
        raise LookupError(f"El equipo {asset_tag} no está asignado a nadie en este momento.")
    emp = db.get(Empleado, e.empleado_id)
    perfil = db.get(ActivosPerfil, e.empleado_id)
    a, d = _area_y_padre(db, perfil.id_area_id if perfil else None)
    dongle = db.query(ActivosDongle).filter(ActivosDongle.asset_tag_asignado == asset_tag).first()
    return {"asset_tag": e.asset_tag, "marca": e.marca, "modelo": e.modelo_referencia, "serial_number": e.serial_number,
           "sistema_operativo": e.sistema_operativo,
           "usuario": {"id_usuario": emp.id, "nombre_completo": emp.nombre_completo, "area": a, "departamento": d},
           "dongle": {"numero_dongle": dongle.numero_dongle} if dongle else None}


def obtener_ficha_equipo(db: Session, asset_tag: str) -> dict:
    e = db.get(ActivosEquipo, asset_tag)
    if not e:
        raise LookupError(f"No existe el equipo {asset_tag}.")
    emp = db.get(Empleado, e.empleado_id) if e.empleado_id else None
    perfil = db.get(ActivosPerfil, e.empleado_id) if e.empleado_id else None
    a, d = _area_y_padre(db, perfil.id_area_id if perfil else None)
    integrantes_a_cargo = 0
    if perfil:
        integrantes_a_cargo = db.query(func.count(ActivosPerfil.empleado_id)).filter(
            ActivosPerfil.id_lider_id == e.empleado_id, ActivosPerfil.retirado.is_(False)).scalar() or 0
    dongle = db.query(ActivosDongle).filter(ActivosDongle.asset_tag_asignado == asset_tag).first()
    actas = db.query(ActivosActaEntrega).filter(ActivosActaEntrega.asset_tag == asset_tag).order_by(ActivosActaEntrega.fecha.desc()).all()
    return {
        "equipo": {"asset_tag": e.asset_tag, "tipo_equipo": e.tipo_equipo, "marca": e.marca, "modelo": e.modelo_referencia,
                  "serial_number": e.serial_number, "sistema_operativo": e.sistema_operativo, "estado": e.estado,
                  "retirado": e.retirado, "usuario": emp.nombre_completo if emp else None, "area": a, "departamento": d,
                  "procesador": e.procesador, "memoria_ram": e.memoria_ram, "almacenamiento": e.almacenamiento,
                  "salud": salud_equipo(db, asset_tag, e.estado), "integrantes_a_cargo": integrantes_a_cargo},
        "dongle": {"numero_dongle": dongle.numero_dongle, "version_exocad_compatible": dongle.version_exocad_compatible} if dongle else None,
        "historial": listar_historial_equipo(db, asset_tag),
        "mantenimientos": listar_mantenimientos(db, asset_tag=asset_tag),
        "actas": [{"id_acta": a_.id_acta, "fecha": a_.fecha, "tipo_acta": a_.tipo_acta, "observaciones": a_.observaciones} for a_ in actas],
    }


# ---------- Dongles ----------

def listar_dongles(db: Session, busqueda: str = "") -> list[dict]:
    equipos = {e.asset_tag: e for e in db.query(ActivosEquipo).all()}
    out = []
    for d in db.query(ActivosDongle).order_by(ActivosDongle.numero_dongle).all():
        if busqueda and busqueda.lower() not in f"{d.numero_dongle} {d.serial_number or ''} {d.modulos or ''}".lower():
            continue
        out.append({"numero_dongle": d.numero_dongle, "serial_number": d.serial_number,
                    "version_exocad_compatible": d.version_exocad_compatible, "modulos": d.modulos,
                    "estado_dongle": d.estado_dongle, "equipo": d.asset_tag_asignado,
                    "equipo_tipo": equipos[d.asset_tag_asignado].tipo_equipo if d.asset_tag_asignado in equipos else None})
    return out


# ---------- Usuarios (perfiles de Activos) ----------

def listar_usuarios(db: Session, busqueda: str = "", area: str | None = None, departamento: str | None = None) -> list[dict]:
    perfiles = db.query(ActivosPerfil).filter(ActivosPerfil.retirado.is_(False)).all()
    ids = [p.empleado_id for p in perfiles]
    empleados = {e.id: e for e in db.query(Empleado).filter(Empleado.id.in_(ids or [0])).all()}
    equipos_por_empleado: dict[int, list[str]] = {}
    for tag, eid in db.query(ActivosEquipo.asset_tag, ActivosEquipo.empleado_id).filter(
            ActivosEquipo.empleado_id.in_(ids or [0]), ActivosEquipo.retirado.is_(False)).all():
        equipos_por_empleado.setdefault(eid, []).append(tag)
    out = []
    for p in perfiles:
        emp = empleados.get(p.empleado_id)
        if not emp:
            continue
        a, d = _area_y_padre(db, p.id_area_id)
        lider = empleados.get(p.id_lider_id) or (db.get(Empleado, p.id_lider_id) if p.id_lider_id else None)
        fila = {"id_usuario": emp.id, "nombre_completo": emp.nombre_completo, "jumpcloud_username": p.jumpcloud_username,
               "cargo": cargo_efectivo(emp, a, d), "area": a, "departamento": d, "id_area": p.id_area_id,
               "id_lider": p.id_lider_id, "lider": lider.nombre_completo if lider else None,
               "personaje": p.personaje, "personaje_variante": p.personaje_variante, "personaje_piel": p.personaje_piel,
               "equipos": equipos_por_empleado.get(emp.id, [])}
        fila["equipos_asignados"] = len(fila["equipos"])
        if busqueda and busqueda.lower() not in f"{emp.nombre_completo} {p.jumpcloud_username or ''} {a or ''}".lower():
            continue
        if area and (a or "").upper() != area.upper():
            continue
        if departamento and (d or "").upper() != departamento.upper():
            continue
        out.append(fila)
    return out


def listar_usuarios_retirados(db: Session, busqueda: str = "") -> list[dict]:
    perfiles = db.query(ActivosPerfil).filter(ActivosPerfil.retirado.is_(True)).order_by(ActivosPerfil.fecha_retiro.desc()).all()
    empleados = {e.id: e for e in db.query(Empleado).filter(Empleado.id.in_([p.empleado_id for p in perfiles] or [0])).all()}
    out = []
    for p in perfiles:
        emp = empleados.get(p.empleado_id)
        if not emp:
            continue
        a, d = _area_y_padre(db, p.id_area_id)
        if busqueda and busqueda.lower() not in f"{emp.nombre_completo} {p.motivo_retiro or ''}".lower():
            continue
        out.append({"id_usuario": emp.id, "nombre_completo": emp.nombre_completo, "cargo": cargo_efectivo(emp, a, d),
                    "area": a, "departamento": d, "fecha_retiro": p.fecha_retiro, "motivo_retiro": p.motivo_retiro})
    return out


def listar_empleados_disponibles(db: Session, busqueda: str = "") -> list[dict]:
    """Empleados de Nuvia Design que todavía no están registrados como custodios de hardware en
    Activos (para el selector de "+ Registrar usuario" -- ahí no se escribe un nombre nuevo, se
    elige a alguien que ya existe en People)."""
    from .models import EMPRESA_DESIGN
    ya_registrados = {p.empleado_id for p in db.query(ActivosPerfil.empleado_id).filter(ActivosPerfil.retirado.is_(False)).all()}
    q = db.query(Empleado).filter(Empleado.activo == 1, Empleado.empresa == EMPRESA_DESIGN)
    out = []
    for e in q.order_by(Empleado.nombres).all():
        if e.id in ya_registrados:
            continue
        if busqueda and busqueda.lower() not in f"{e.nombre_completo} {e.cargo}".lower():
            continue
        out.append({"id_usuario": e.id, "nombre_completo": e.nombre_completo, "cargo": e.cargo})
    return out


def obtener_perfil(db: Session, empleado_id: int) -> dict:
    p = db.get(ActivosPerfil, empleado_id)
    if not p or p.retirado:
        raise LookupError(f"No existe un custodio de hardware activo con id {empleado_id}.")
    emp = db.get(Empleado, empleado_id)
    a, d = _area_y_padre(db, p.id_area_id)
    return {"id_usuario": emp.id, "nombre_completo": emp.nombre_completo, "jumpcloud_username": p.jumpcloud_username,
           "cargo": emp.cargo, "cargo_sugerido": cargo_efectivo(emp, a, d), "id_area": p.id_area_id, "area": a, "departamento": d,
           "id_lider": p.id_lider_id, "personaje": p.personaje, "personaje_variante": p.personaje_variante,
           "personaje_piel": p.personaje_piel}


def obtener_activos_usuario(db: Session, empleado_id: int) -> dict:
    p = db.get(ActivosPerfil, empleado_id)
    if not p or p.retirado:
        raise LookupError(f"No existe un custodio de hardware activo con id {empleado_id}.")
    emp = db.get(Empleado, empleado_id)
    a, d = _area_y_padre(db, p.id_area_id)
    equipos = db.query(ActivosEquipo).filter(ActivosEquipo.empleado_id == empleado_id, ActivosEquipo.retirado.is_(False)).all()
    dongles = db.query(ActivosDongle).filter(ActivosDongle.asset_tag_asignado.in_([e.asset_tag for e in equipos] or [""])).all()
    return {"usuario": {"id_usuario": emp.id, "nombre_completo": emp.nombre_completo, "area": a, "departamento": d,
                       "mostrar_dongles": mostrar_dongles(a, d)},
           "equipos": [{"asset_tag": e.asset_tag, "tipo_equipo": e.tipo_equipo, "marca": e.marca, "modelo": e.modelo_referencia,
                       "estado": e.estado} for e in equipos],
           "dongles": [{"numero_dongle": d_.numero_dongle, "equipo": d_.asset_tag_asignado} for d_ in dongles]}


def listar_actas_usuario(db: Session, empleado_id: int) -> list[dict]:
    actas = db.query(ActivosActaEntrega, ActivosEquipo).join(
        ActivosEquipo, ActivosEquipo.asset_tag == ActivosActaEntrega.asset_tag
    ).filter(ActivosActaEntrega.empleado_id == empleado_id).order_by(ActivosActaEntrega.fecha.desc()).all()
    return [{"id_acta": a.id_acta, "asset_tag": a.asset_tag, "id_usuario": a.empleado_id, "fecha": a.fecha,
            "tipo_acta": a.tipo_acta, "observaciones": a.observaciones, "tipo_equipo": e.tipo_equipo,
            "marca": e.marca, "modelo": e.modelo_referencia, "serial_number": e.serial_number} for a, e in actas]


def obtener_firma_acta(db: Session, id_acta: int) -> str | None:
    a = db.get(ActivosActaEntrega, id_acta)
    return a.firma_base64 if a else None


# ---------- Áreas ----------

def listar_areas(db: Session, busqueda: str = "") -> list[dict]:
    areas = db.query(ActivosArea).all()
    por_id = {a.id_area: a for a in areas}
    conteo_usuarios: dict[int, int] = {}
    for (id_area, n) in db.query(ActivosPerfil.id_area_id, func.count(ActivosPerfil.empleado_id)).filter(
            ActivosPerfil.retirado.is_(False)).group_by(ActivosPerfil.id_area_id).all():
        if id_area is not None:
            conteo_usuarios[id_area] = n
    conteo_departamentos: dict[int, int] = {}
    for (padre, n) in db.query(ActivosArea.id_area_padre, func.count(ActivosArea.id_area)).filter(
            ActivosArea.id_area_padre.isnot(None)).group_by(ActivosArea.id_area_padre).all():
        conteo_departamentos[padre] = n
    out = []
    for a in sorted(areas, key=lambda x: (x.id_area_padre or x.id_area, x.id_area_padre is None, x.nombre_area)):
        padre = por_id.get(a.id_area_padre) if a.id_area_padre else None
        fila = {"id_area": a.id_area, "nombre_area": a.nombre_area, "id_area_padre": a.id_area_padre,
               "area": padre.nombre_area if padre else a.nombre_area, "departamento": a.nombre_area if padre else None,
               "aplica_software_diseno": a.aplica_software_diseno, "requiere_exocad": a.requiere_exocad,
               "usuarios_registrados": conteo_usuarios.get(a.id_area, 0), "departamentos": conteo_departamentos.get(a.id_area, 0)}
        if busqueda and busqueda.lower() not in a.nombre_area.lower():
            continue
        out.append(fila)
    return out


# ---------- Mantenimientos ----------

def listar_mantenimientos(db: Session, estado: str | None = None, fecha_desde: date | None = None,
                          fecha_hasta: date | None = None, asset_tag: str = "") -> list[dict]:
    if fecha_desde and fecha_hasta and fecha_desde > fecha_hasta:
        raise ValueError("La fecha 'desde' no puede ser posterior a la fecha 'hasta'.")
    q = db.query(ActivosMantenimiento)
    if estado:
        q = q.filter(ActivosMantenimiento.estado_mantenimiento == estado)
    if fecha_desde:
        q = q.filter(ActivosMantenimiento.fecha_programada >= fecha_desde)
    if fecha_hasta:
        q = q.filter(ActivosMantenimiento.fecha_programada <= fecha_hasta)
    if asset_tag:
        q = q.filter(ActivosMantenimiento.asset_tag.ilike(f"%{asset_tag}%"))
    filas = q.order_by(ActivosMantenimiento.fecha_programada.desc()).all()
    equipos = {e.asset_tag: e for e in db.query(ActivosEquipo).filter(
        ActivosEquipo.asset_tag.in_([f.asset_tag for f in filas] or [""])).all()}
    empleados = {e.id: e for e in db.query(Empleado).filter(
        Empleado.id.in_([equipos[f.asset_tag].empleado_id for f in filas if f.asset_tag in equipos and equipos[f.asset_tag].empleado_id] or [0])).all()}
    out = []
    for f in filas:
        e = equipos.get(f.asset_tag)
        emp = empleados.get(e.empleado_id) if e and e.empleado_id else None
        out.append({"id_mantenimiento": f.id_mantenimiento, "asset_tag": f.asset_tag,
                    "tipo_equipo": e.tipo_equipo if e else None, "marca": e.marca if e else None, "modelo": e.modelo_referencia if e else None,
                    "tipo_mantenimiento": f.tipo_mantenimiento, "estado_mantenimiento": f.estado_mantenimiento,
                    "fecha_programada": f.fecha_programada, "fecha_realizada": f.fecha_realizada,
                    "descripcion_falla": f.descripcion_falla, "acciones_realizadas": f.acciones_realizadas,
                    "responsable": f.responsable, "id_jornada": f.id_jornada,
                    "estado_equipo": e.estado if e else None, "usuario": emp.nombre_completo if emp else None})
    return out


def obtener_mantenimiento(db: Session, id_mantenimiento: int) -> dict:
    filas = [f for f in listar_mantenimientos(db) if f["id_mantenimiento"] == id_mantenimiento]
    if not filas:
        raise LookupError(f"No existe el mantenimiento #{id_mantenimiento}.")
    return filas[0]


# ---------- Grupos y jornadas ----------

def listar_grupos(db: Session) -> list[dict]:
    lideres = db.query(ActivosPerfil).filter(ActivosPerfil.empleado_id.in_(
        db.query(ActivosPerfil.id_lider_id).filter(ActivosPerfil.id_lider_id.isnot(None), ActivosPerfil.retirado.is_(False)).distinct()
    )).all()
    out = []
    for lp in lideres:
        emp = db.get(Empleado, lp.empleado_id)
        if not emp:
            continue
        a, d = _area_y_padre(db, lp.id_area_id)
        integrantes = db.query(func.count(ActivosPerfil.empleado_id)).filter(
            ActivosPerfil.id_lider_id == lp.empleado_id, ActivosPerfil.retirado.is_(False)).scalar() or 0
        equipos = _equipos_del_grupo(db, lp.empleado_id)
        ultima = db.query(func.max(ActivosJornadaMantenimiento.fecha_programada)).filter(
            ActivosJornadaMantenimiento.id_lider_id == lp.empleado_id).scalar()
        saludes = [salud_equipo(db, tag, db.get(ActivosEquipo, tag).estado) for tag in equipos]
        if "EN_MANTENIMIENTO" in saludes:
            salud = "EN_MANTENIMIENTO"
        elif "NOVEDADES" in saludes:
            salud = "NOVEDADES"
        elif "SIN_REVISION" in saludes and saludes:
            salud = "SIN_REVISION"
        else:
            salud = "OPTIMO"
        out.append({"id_lider": lp.empleado_id, "lider": emp.nombre_completo, "cargo": cargo_efectivo(emp, a, d),
                    "area": a, "departamento": d, "integrantes": integrantes, "equipos": len(equipos),
                    "ultima_jornada": ultima, "salud": salud})
    return out


def obtener_grupo(db: Session, id_lider: int) -> dict:
    lp = db.get(ActivosPerfil, id_lider)
    if not lp or lp.retirado:
        raise LookupError(f"No existe un grupo activo para el líder #{id_lider}.")
    emp = db.get(Empleado, id_lider)
    integrantes_p = db.query(ActivosPerfil).filter(ActivosPerfil.id_lider_id == id_lider, ActivosPerfil.retirado.is_(False)).all()
    empleados_i = {e.id: e for e in db.query(Empleado).filter(Empleado.id.in_([p.empleado_id for p in integrantes_p] or [0])).all()}
    equipos = _equipos_del_grupo(db, id_lider)
    novedades = db.query(ActivosMantenimiento).filter(
        ActivosMantenimiento.asset_tag.in_(equipos or [""]), ActivosMantenimiento.tipo_mantenimiento == "CORRECTIVO",
        ActivosMantenimiento.estado_mantenimiento.in_(("PROGRAMADO", "EN_PROCESO"))).all()
    return {"lider": emp.nombre_completo, "id_lider": id_lider,
           "integrantes": [{"id_usuario": p.empleado_id, "nombre_completo": empleados_i[p.empleado_id].nombre_completo}
                           for p in integrantes_p if p.empleado_id in empleados_i],
           "equipos": [{"asset_tag": t, "salud": salud_equipo(db, t, db.get(ActivosEquipo, t).estado)} for t in equipos],
           "novedades": [{"asset_tag": n.asset_tag, "descripcion_falla": n.descripcion_falla} for n in novedades]}


def listar_jornadas(db: Session, estado: str | None = None) -> list[dict]:
    jornadas = db.query(ActivosJornadaMantenimiento).order_by(ActivosJornadaMantenimiento.fecha_programada.desc()).all()
    empleados = {e.id: e for e in db.query(Empleado).filter(Empleado.id.in_([j.id_lider_id for j in jornadas] or [0])).all()}
    out = []
    for j in jornadas:
        conteo = _conteo_servicios(db, j.id_jornada)
        total = sum(conteo.values())
        completados = conteo.get("COMPLETADO", 0)
        cancelados = conteo.get("CANCELADO", 0)
        pendientes = total - completados - cancelados
        siguiente = db.query(ActivosJornadaMantenimiento).filter(ActivosJornadaMantenimiento.id_jornada_origen == j.id_jornada).first()
        fila = {"id_jornada": j.id_jornada, "id_lider": j.id_lider_id,
               "lider": empleados[j.id_lider_id].nombre_completo if j.id_lider_id in empleados else None,
               "tipo_mantenimiento": j.tipo_mantenimiento, "fecha_programada": j.fecha_programada, "responsable": j.responsable,
               "descripcion": j.descripcion, "id_jornada_origen": j.id_jornada_origen, "frecuencia_meses": j.frecuencia_meses,
               "fecha_anulacion": j.fecha_anulacion, "motivo_anulacion": j.motivo_anulacion,
               "total": total, "completados": completados, "cancelados": cancelados, "pendientes": pendientes,
               "id_jornada_siguiente": siguiente.id_jornada if siguiente else None,
               "fecha_siguiente": siguiente.fecha_programada if siguiente else None,
               "estado": estado_jornada(j, conteo)}
        if estado and fila["estado"] != estado:
            continue
        out.append(fila)
    return out


def obtener_jornada(db: Session, id_jornada: int) -> dict:
    coincidencias = [j for j in listar_jornadas(db) if j["id_jornada"] == id_jornada]
    if not coincidencias:
        raise LookupError(f"No existe la solicitud #{id_jornada}.")
    fila = coincidencias[0]
    fila["mantenimientos"] = [m for m in listar_mantenimientos(db) if m["id_jornada"] == id_jornada]
    return fila


def obtener_estado_mantenimiento(db: Session) -> dict:
    jornadas = listar_jornadas(db)
    hoy = date.today()
    grupos = listar_grupos(db)
    grupos_sin_programar = sum(1 for g in grupos if g["equipos"] > 0 and not any(
        j["id_lider"] == g["id_lider"] and j["estado"] in ("ABIERTA", "VENCIDA") for j in jornadas))
    abiertas = [j for j in jornadas if j["estado"] == "ABIERTA"]
    vencidas = [j for j in jornadas if j["estado"] == "VENCIDA"]
    proximas = [j for j in abiertas if 0 <= (j["fecha_programada"] - hoy).days <= DIAS_AVISO_SOLICITUD]
    completados_mes = db.query(func.count(ActivosMantenimiento.id_mantenimiento)).filter(
        ActivosMantenimiento.estado_mantenimiento == "COMPLETADO", ActivosMantenimiento.fecha_realizada >= hoy.replace(day=1)).scalar() or 0
    novedades = db.query(func.count(ActivosMantenimiento.id_mantenimiento)).filter(
        ActivosMantenimiento.tipo_mantenimiento == "CORRECTIVO",
        ActivosMantenimiento.estado_mantenimiento.in_(("PROGRAMADO", "EN_PROCESO"))).scalar() or 0
    equipos_en_mantenimiento = db.query(func.count(ActivosEquipo.asset_tag)).filter(ActivosEquipo.estado == "MANTENIMIENTO").scalar() or 0
    mantenimientos_vencidos = db.query(func.count(ActivosMantenimiento.id_mantenimiento)).filter(
        ActivosMantenimiento.estado_mantenimiento.in_(("PROGRAMADO", "EN_PROCESO")), ActivosMantenimiento.fecha_programada < hoy).scalar() or 0
    saludes = [g["salud"] for g in grupos]
    salud = "EN_MANTENIMIENTO" if "EN_MANTENIMIENTO" in saludes else ("NOVEDADES" if "NOVEDADES" in saludes else "OPTIMO")
    return {"salud": salud, "completados_mes": completados_mes, "jornadas_abiertas": abiertas, "jornadas_proximas": proximas,
           "dias_aviso_solicitud": DIAS_AVISO_SOLICITUD, "jornadas_vencidas": vencidas, "novedades": novedades,
           "mantenimientos_vencidos": mantenimientos_vencidos, "equipos_en_mantenimiento": equipos_en_mantenimiento,
           "dias_alerta_mantenimiento": DIAS_ALERTA_MANTENIMIENTO, "grupos_sin_programar": grupos_sin_programar}
