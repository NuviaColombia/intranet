"""Módulo Activos: solicitudes de mantenimiento de managers de equipo (líderes de grupo), con
aprobación de un técnico. Flujo de 4 pasos (ver docs/wiki/activos.md):

  solicitar (manager) -> aceptar (aprobador) -> marcar realizado (aprobador) -> confirmar (manager)

Cada paso reutiliza las funciones ya existentes de equipos/mantenimientos -- no se duplica ninguna
regla de negocio aquí, solo se orquesta la transición y se guarda el rastro de quién hizo cada cosa."""
from datetime import date, datetime
from sqlalchemy.orm import Session
from .models import Empleado
from .models_activos import ActivosPerfil, ActivosEquipo, ActivosSolicitudMantenimiento
from .services_activos import NoEncontrado, Conflicto, _texto, _obligatorio, auditar
from .services_activos import asignar_equipo, actualizar_estado_equipo
from .services_activos_mantenimiento import _equipos_del_grupo, registrar_mantenimiento, actualizar_mantenimiento

# Quién puede aceptar una solicitud y marcar el mantenimiento como realizado -- hoy, una sola
# persona (pedido por Oscar el 26-oct-2026). Un superadmin siempre puede, como respaldo.
APROBADORES_MANTENIMIENTO = {"yostynguerrero@nuviasmiles.com"}


def es_manager_equipos(db: Session, empleado_id: int) -> bool:
    """¿Es líder de al menos un grupo de trabajo de Activos? (misma definición que usa listar_grupos)."""
    return db.query(ActivosPerfil.empleado_id).filter(
        ActivosPerfil.id_lider_id == empleado_id, ActivosPerfil.retirado.is_(False)).first() is not None


def puede_aprobar_mantenimiento(user: Empleado) -> bool:
    return user.rol == "superadmin" or (user.email or "").strip().lower() in APROBADORES_MANTENIMIENTO


def _equipos_disponibles(db: Session, user: Empleado) -> list[str]:
    """Equipos para los que `user` puede pedir mantenimiento: los de su propio grupo, o todos si ya
    tiene acceso completo a Activos (para que el técnico/admin también pueda usar este flujo)."""
    if user.tiene_modulo("activos"):
        return [t for (t,) in db.query(ActivosEquipo.asset_tag).filter(ActivosEquipo.retirado.is_(False)).all()]
    return _equipos_del_grupo(db, user.id)


def listar_equipos_solicitables(db: Session, user: Empleado) -> list[dict]:
    tags = _equipos_disponibles(db, user)
    equipos = db.query(ActivosEquipo).filter(ActivosEquipo.asset_tag.in_(tags or [""])).all()
    empleados = {e.id: e for e in db.query(Empleado).filter(
        Empleado.id.in_([e.empleado_id for e in equipos if e.empleado_id] or [0])).all()}
    return [{"asset_tag": e.asset_tag, "tipo_equipo": e.tipo_equipo, "marca": e.marca, "modelo": e.modelo_referencia,
            "estado": e.estado, "usuario": empleados[e.empleado_id].nombre_completo if e.empleado_id in empleados else None}
            for e in sorted(equipos, key=lambda x: x.asset_tag)]


def _solicitud(db: Session, id_: int) -> ActivosSolicitudMantenimiento:
    s = db.get(ActivosSolicitudMantenimiento, id_)
    if not s:
        raise NoEncontrado(f"No existe la solicitud #{id_}.")
    return s


def listar_solicitudes(db: Session, user: Empleado) -> list[dict]:
    q = db.query(ActivosSolicitudMantenimiento)
    if not puede_aprobar_mantenimiento(user):
        tags_grupo = set(_equipos_disponibles(db, user))
        solicitudes = [s for s in q.all() if s.solicitado_por_id == user.id or s.asset_tag in tags_grupo]
    else:
        solicitudes = q.all()
    solicitudes.sort(key=lambda s: s.fecha_solicitud, reverse=True)
    ids_empleados = set()
    for s in solicitudes:
        ids_empleados.update(x for x in (s.solicitado_por_id, s.aceptado_por_id, s.empleado_original_id) if x)
    empleados = {e.id: e for e in db.query(Empleado).filter(Empleado.id.in_(ids_empleados or [0])).all()}
    nombre = lambda eid: empleados[eid].nombre_completo if eid in empleados else None
    return [{"id": s.id, "asset_tag": s.asset_tag, "descripcion": s.descripcion, "estado": s.estado,
            "solicitado_por": nombre(s.solicitado_por_id), "solicitado_por_id": s.solicitado_por_id,
            "fecha_solicitud": s.fecha_solicitud, "aceptado_por": nombre(s.aceptado_por_id),
            "fecha_aceptado": s.fecha_aceptado, "notas_realizado": s.notas_realizado, "fecha_realizado": s.fecha_realizado,
            "fecha_confirmado": s.fecha_confirmado, "motivo_rechazo": s.motivo_rechazo,
            "empleado_original": nombre(s.empleado_original_id),
            "puede_aceptar": puede_aprobar_mantenimiento(user) and s.estado == "SOLICITADO",
            "puede_marcar_realizado": puede_aprobar_mantenimiento(user) and s.estado == "ACEPTADO",
            "puede_confirmar": s.solicitado_por_id == user.id and s.estado == "REALIZADO",
            "puede_rechazar": puede_aprobar_mantenimiento(user) and s.estado == "SOLICITADO"} for s in solicitudes]


def crear_solicitud(db: Session, actor: Empleado, asset_tag: str, descripcion: str) -> ActivosSolicitudMantenimiento:
    asset_tag = _obligatorio(asset_tag, "Selecciona un equipo.")
    descripcion = _obligatorio(descripcion, "Describe el problema o lo que necesita el equipo.")
    if asset_tag not in _equipos_disponibles(db, actor):
        raise Conflicto("Ese equipo no pertenece a tu grupo de trabajo.")
    equipo = db.get(ActivosEquipo, asset_tag)
    if not equipo or equipo.retirado:
        raise NoEncontrado(f"No existe el equipo {asset_tag}.")
    pendiente = db.query(ActivosSolicitudMantenimiento.id).filter(
        ActivosSolicitudMantenimiento.asset_tag == asset_tag,
        ActivosSolicitudMantenimiento.estado.in_(("SOLICITADO", "ACEPTADO", "REALIZADO"))).first()
    if pendiente:
        raise Conflicto(f"El equipo {asset_tag} ya tiene una solicitud de mantenimiento en curso (#{pendiente[0]}).")
    s = ActivosSolicitudMantenimiento(asset_tag=asset_tag, solicitado_por_id=actor.id, empleado_original_id=equipo.empleado_id,
                                      descripcion=descripcion, estado="SOLICITADO")
    db.add(s)
    auditar(db, actor, "Solicitud de mantenimiento", f"{actor.nombre_completo} pidió mantenimiento para {asset_tag}.")
    db.commit()
    db.refresh(s)
    return s


def aceptar_solicitud(db: Session, actor: Empleado, id_: int) -> ActivosSolicitudMantenimiento:
    if not puede_aprobar_mantenimiento(actor):
        raise Conflicto("No tienes permiso para aceptar solicitudes de mantenimiento.")
    s = _solicitud(db, id_)
    if s.estado != "SOLICITADO":
        raise Conflicto(f"La solicitud #{id_} ya no está pendiente de aceptar (estado: {s.estado}).")
    m = registrar_mantenimiento(db, actor, {"asset_tag": s.asset_tag, "tipo_mantenimiento": "CORRECTIVO",
                                            "estado_mantenimiento": "EN_PROCESO", "fecha_programada": date.today(),
                                            "descripcion_falla": s.descripcion, "responsable": actor.nombre_completo})
    s.id_mantenimiento, s.estado, s.aceptado_por_id, s.fecha_aceptado = m.id_mantenimiento, "ACEPTADO", actor.id, datetime.utcnow()
    auditar(db, actor, "Aceptar solicitud de mantenimiento", f"Solicitud #{id_} ({s.asset_tag}) aceptada por {actor.nombre_completo}.")
    db.commit()
    db.refresh(s)
    return s


def marcar_realizado(db: Session, actor: Empleado, id_: int, notas: str | None = None) -> ActivosSolicitudMantenimiento:
    if not puede_aprobar_mantenimiento(actor):
        raise Conflicto("No tienes permiso para marcar un mantenimiento como realizado.")
    s = _solicitud(db, id_)
    if s.estado != "ACEPTADO":
        raise Conflicto(f"La solicitud #{id_} no está aceptada (estado: {s.estado}).")
    actualizar_mantenimiento(db, actor, s.id_mantenimiento, {"estado_mantenimiento": "COMPLETADO",
                                                             "acciones_realizadas": _texto(notas) or ""}, devolver_stock=False)
    s.estado, s.notas_realizado, s.fecha_realizado = "REALIZADO", _texto(notas), datetime.utcnow()
    auditar(db, actor, "Mantenimiento realizado", f"Solicitud #{id_} ({s.asset_tag}) marcada como realizada por {actor.nombre_completo}.")
    db.commit()
    db.refresh(s)
    return s


def confirmar_solicitud(db: Session, actor: Empleado, id_: int) -> ActivosSolicitudMantenimiento:
    s = _solicitud(db, id_)
    if s.solicitado_por_id != actor.id and actor.rol != "superadmin":
        raise Conflicto("Solo quien hizo la solicitud puede confirmar que el mantenimiento quedó bien.")
    if s.estado != "REALIZADO":
        raise Conflicto(f"La solicitud #{id_} todavía no está marcada como realizada (estado: {s.estado}).")
    if s.empleado_original_id:
        asignar_equipo(db, actor, s.asset_tag, s.empleado_original_id, "Mantenimiento confirmado por el manager.")
    else:
        actualizar_estado_equipo(db, actor, s.asset_tag, "STOCK", "Mantenimiento confirmado por el manager.")
    s.estado, s.fecha_confirmado = "CONFIRMADO", datetime.utcnow()
    auditar(db, actor, "Confirmar mantenimiento", f"Solicitud #{id_} ({s.asset_tag}) confirmada por {actor.nombre_completo}.")
    db.commit()
    db.refresh(s)
    return s


def rechazar_solicitud(db: Session, actor: Empleado, id_: int, motivo: str) -> ActivosSolicitudMantenimiento:
    if not puede_aprobar_mantenimiento(actor):
        raise Conflicto("No tienes permiso para rechazar solicitudes de mantenimiento.")
    motivo = _obligatorio(motivo, "El motivo es obligatorio.")
    s = _solicitud(db, id_)
    if s.estado != "SOLICITADO":
        raise Conflicto(f"La solicitud #{id_} ya no está pendiente (estado: {s.estado}).")
    s.estado, s.motivo_rechazo = "RECHAZADO", motivo
    auditar(db, actor, "Rechazar solicitud de mantenimiento", f"Solicitud #{id_} ({s.asset_tag}) rechazada. {motivo}")
    db.commit()
    db.refresh(s)
    return s
