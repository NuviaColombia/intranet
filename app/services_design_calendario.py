"""Calendario de Design (19-oct-2026): integrado desde la app independiente «Calendario Colombia» (Node.js) del
escritorio de Rosember. La interfaz (static/design/calendario/app.js) es la misma; aquí vive lo que antes hacía su
servidor, con los usuarios, equipos y roles de la intranet en lugar de cuentas propias.

Quién ve y hace qué (pedido por Rosember):
- Admin: ve y edita todo; puede crear eventos generales (sin equipo, los ve todo Design) y de cualquier equipo.
- Aprobadores (y quien está a cargo): ven lo de sus equipos y lo general; crean, editan y asignan solo en sus equipos.
- Diseñadores: solo ven lo de su equipo y lo general; si les asignan una tarea pueden cambiar su estado (hecha).
- Ausencias: salen solas de People (solicitudes aprobadas o pendientes). Los aprobadores pueden poner vacaciones
  ESTIMADAS de su gente; cuando People aprueba unas vacaciones que se cruzan con esas fechas, la estimada se borra sola.
  Un mes antes del inicio de una estimada, le llega un push al manager: la persona debe enviar el formato a People.
Los avisos en vivo van por el bus de Design ({t:'cal'}, sin datos: cada pantalla vuelve a pedir lo que puede ver).
"""
import json
import logging
import re
import threading
import time as _time
import unicodedata
from datetime import date, datetime, timedelta

from sqlalchemy import and_, exists, func, or_
from sqlalchemy.orm import Session, joinedload, selectinload

from .models import Empleado, Solicitud, TipoPermiso
from .models_design import (DesignCalActividad, DesignCalAsignado, DesignCalComentario, DesignCalEtiqueta, DesignCalEvento,
                            DesignCalEventoEtiqueta, DesignCalVacacionEstimada, DesignTeam, DesignTeamDesigner)
from . import services_design as sd

log = logging.getLogger(__name__)

PALETA = ["#4f46e5", "#3b82f6", "#0ea5e9", "#14b8a6", "#10b981", "#84cc16", "#eab308", "#f59e0b", "#f97316", "#ef4444",
          "#ec4899", "#a855f7", "#64748b"]
ETIQUETAS_INICIALES = [("Reunión", "#3b82f6"), ("Entrega", "#ef4444"), ("Capacitación", "#8b5cf6"), ("Cumpleaños", "#ec4899"),
                       ("Auditoría", "#f59e0b"), ("Personal", "#10b981")]
REPETICIONES = ("none", "daily", "weekly", "monthly", "yearly")
ESTADOS = ("pending", "in_progress", "done")
PRIORIDADES = ("low", "normal", "high")
VISIBILIDADES = ("public", "private")
SENSIBLES = {"incapacidad", "calamidad"}   # su motivo solo lo ven la persona y los admins; el resto ve «Ausencia»
ESTADOS_PEOPLE = {"aprobada": "approved", "pendiente_1": "pending", "pendiente_2": "pending", "pendiente_soporte": "pending"}
DIAS_RECORDATORIO = 30
_RE_HORA = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
_RE_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")


class ErrorCal(Exception):
    def __init__(self, status: int, mensaje: str):
        super().__init__(mensaje)
        self.status, self.mensaje = status, mensaje


def _norm(t: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", (t or "").lower()) if unicodedata.category(c) != "Mn")


def color_de(clave) -> str:
    h = 0
    for ch in str(clave):
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return PALETA[h % len(PALETA)]


def _sql_dt(d: datetime | None) -> str:
    return (d or datetime.utcnow()).strftime("%Y-%m-%d %H:%M:%S")   # como datetime('now') de SQLite: la pantalla lo lee como UTC


# ---------------------------------------------------------------------------------------------------------------
# Perfil: qué equipos ve y maneja cada persona
# ---------------------------------------------------------------------------------------------------------------

def _equipos_activos(db: Session) -> list[DesignTeam]:
    return sd.memo_sesion(db, "cal_equipos", lambda: (db.query(DesignTeam).options(joinedload(DesignTeam.area), joinedload(DesignTeam.designers),
                                                                                   joinedload(DesignTeam.manager))
                                                       .filter(DesignTeam.activo == 1).order_by(DesignTeam.orden).all()))


def perfil(db: Session, user: Empleado) -> dict:
    def calcular():
        equipos = _equipos_activos(db)
        admin = sd.es_admin(user)
        gest = {t.id for t in equipos if admin or sd.gestiona_equipo(user, t)}
        como_designer = sd.equipos_como_designer(db, user)
        ver = gest | {t.id for t in equipos if t.id in como_designer}
        return {"uid": user.id, "admin": admin, "gest": gest, "ver": ver, "equipos": equipos}
    return sd.memo_sesion(db, ("cal_perfil", user.id), calcular)


def miembros(team: DesignTeam) -> set[int]:
    ids = {d.empleado_id for d in team.designers}
    if team.manager_id:
        ids.add(team.manager_id)
    return ids


def _equipo_de(p: dict, team_id: int | None) -> DesignTeam | None:
    return next((t for t in p["equipos"] if t.id == team_id), None)


def puede_crear(p: dict) -> bool:
    return p["admin"] or bool(p["gest"])


def puede_editar(p: dict, ev: DesignCalEvento) -> bool:
    if p["admin"]:
        return True
    return ev.team_id is not None and ev.team_id in p["gest"]


def _filtro_visible(p: dict):
    """Eventos que esta persona puede ver (admins: todos)."""
    if p["admin"]:
        return None
    uid = p["uid"]
    asignado = exists().where(and_(DesignCalAsignado.evento_id == DesignCalEvento.id, DesignCalAsignado.empleado_id == uid))
    del_alcance = or_(DesignCalEvento.team_id.is_(None), DesignCalEvento.team_id.in_(p["ver"] or {-1}))
    propio = or_(DesignCalEvento.creado_por == uid, asignado)
    publico_o_propio = or_(DesignCalEvento.visibilidad == "public", propio,
                           DesignCalEvento.team_id.in_(p["gest"] or {-1}))   # el aprobador ve también lo privado de su equipo
    return and_(or_(del_alcance, propio), publico_o_propio)


def puede_ver(p: dict, ev: DesignCalEvento) -> bool:
    if p["admin"]:
        return True
    uid = p["uid"]
    propio = ev.creado_por == uid or any(a.empleado_id == uid for a in ev.asignados)
    del_alcance = ev.team_id is None or ev.team_id in p["ver"]
    return (del_alcance or propio) and (ev.visibilidad == "public" or propio or ev.team_id in p["gest"])


# ---------------------------------------------------------------------------------------------------------------
# Datos para la pantalla (mismo formato que la app original)
# ---------------------------------------------------------------------------------------------------------------

def yo(db: Session, user: Empleado) -> dict:
    p = perfil(db, user)
    gestion = [t for t in p["equipos"] if t.id in p["gest"]]
    return {"id": user.id, "name": user.nombre_completo, "email": user.email, "color": color_de(user.id),
            "role": "admin" if p["admin"] else "member", "puedeCrear": puede_crear(p), "admin": p["admin"],
            "equipos": [{"id": t.id, "nombre": t.nombre, "area": t.area.nombre if t.area else "", "miembros": sorted(miembros(t))} for t in gestion]}


def personas(db: Session, user: Empleado) -> list[dict]:
    """Personas de los equipos que esta persona ve (admins: todo Design), con sus equipos."""
    p = perfil(db, user)
    equipos_de: dict[int, list[int]] = {}
    for t in p["equipos"]:
        if p["admin"] or t.id in p["ver"]:
            for e in miembros(t):
                equipos_de.setdefault(e, []).append(t.id)
    equipos_de.setdefault(user.id, [])
    filas = db.query(Empleado).filter(Empleado.id.in_(list(equipos_de)), Empleado.activo == 1).all()
    out = [{"id": e.id, "name": e.nombre_completo, "email": e.email, "color": color_de(e.id), "role": "member", "team_ids": equipos_de.get(e.id, [])}
           for e in filas]
    return sorted(out, key=lambda x: _norm(x["name"]))


def serializar(db: Session, p: dict, eventos: list[DesignCalEvento]) -> list[dict]:
    if not eventos:
        return []
    ids = [e.id for e in eventos]
    comentarios = dict(db.query(DesignCalComentario.evento_id, func.count(DesignCalComentario.id))
                       .filter(DesignCalComentario.evento_id.in_(ids)).group_by(DesignCalComentario.evento_id).all())
    nombres = {t.id: t.nombre for t in p["equipos"]}
    out = []
    for e in eventos:
        out.append({
            "id": e.id, "title": e.titulo, "description": e.descripcion or "", "location": e.ubicacion or "",
            "start_date": e.fecha_inicio.isoformat(), "end_date": e.fecha_fin.isoformat(),
            "start_time": e.hora_inicio, "end_time": e.hora_fin, "all_day": bool(e.todo_el_dia),
            "recurrence": e.repeticion, "recurrence_until": e.repetir_hasta.isoformat() if e.repetir_hasta else None,
            "exdates": json.loads(e.excepciones or "[]"), "status": e.estado, "priority": e.prioridad, "visibility": e.visibilidad,
            "color": e.color, "created_by": e.creado_por, "created_at": _sql_dt(e.creado_en), "updated_at": _sql_dt(e.actualizado_en),
            "tag_ids": [x.etiqueta_id for x in e.etiquetas], "assignee_ids": [x.empleado_id for x in e.asignados],
            "comment_count": comentarios.get(e.id, 0), "team_id": e.team_id,
            "team_name": nombres.get(e.team_id, "") if e.team_id else "General (todo Design)", "can_edit": puede_editar(p, e),
        })
    return out


def _consulta(db: Session, p: dict):
    q = db.query(DesignCalEvento).options(selectinload(DesignCalEvento.etiquetas), selectinload(DesignCalEvento.asignados))
    f = _filtro_visible(p)
    return q.filter(f) if f is not None else q


def eventos(db: Session, user: Empleado, desde: date, hasta: date) -> list[dict]:
    p = perfil(db, user)
    q = _consulta(db, p).filter(DesignCalEvento.fecha_inicio <= hasta).filter(or_(
        and_(DesignCalEvento.repeticion == "none", DesignCalEvento.fecha_fin >= desde),
        and_(DesignCalEvento.repeticion != "none",
             or_(DesignCalEvento.repetir_hasta.is_(None), DesignCalEvento.repetir_hasta >= desde - timedelta(days=400)))))
    filas = q.order_by(DesignCalEvento.fecha_inicio, DesignCalEvento.todo_el_dia.desc(), DesignCalEvento.hora_inicio).all()
    return serializar(db, p, filas)


def buscar(db: Session, user: Empleado, texto: str) -> list[dict]:
    texto = (texto or "").strip()[:100]
    if len(texto) < 2:
        return []
    p = perfil(db, user)
    like = f"%{texto}%"
    filas = (_consulta(db, p).filter(or_(DesignCalEvento.titulo.ilike(like), DesignCalEvento.descripcion.ilike(like), DesignCalEvento.ubicacion.ilike(like)))
             .order_by(DesignCalEvento.fecha_inicio.desc()).limit(50).all())
    return serializar(db, p, filas)


def mis_tareas(db: Session, user: Empleado) -> list[dict]:
    p = perfil(db, user)
    filas = (db.query(DesignCalEvento).options(selectinload(DesignCalEvento.etiquetas), selectinload(DesignCalEvento.asignados))
             .join(DesignCalAsignado, and_(DesignCalAsignado.evento_id == DesignCalEvento.id, DesignCalAsignado.empleado_id == user.id))
             .filter(DesignCalEvento.estado != "done").order_by(DesignCalEvento.fecha_inicio, DesignCalEvento.hora_inicio).limit(30).all())
    return serializar(db, p, filas)


def evento(db: Session, user: Empleado, evento_id: int) -> tuple[DesignCalEvento, dict]:
    p = perfil(db, user)
    e = db.query(DesignCalEvento).options(selectinload(DesignCalEvento.etiquetas), selectinload(DesignCalEvento.asignados)).get(evento_id)
    if not e or not puede_ver(p, e):
        raise ErrorCal(404, "Evento no encontrado")
    return e, p


# ---------------------------------------------------------------------------------------------------------------
# Crear / editar / eliminar
# ---------------------------------------------------------------------------------------------------------------

def _fecha(v, campo: str) -> date:
    try:
        return date.fromisoformat(str(v)[:10])
    except (TypeError, ValueError):
        raise ErrorCal(400, f"Fecha de {campo} inválida")


def _texto(v, campo: str, maximo: int, requerido: bool = False) -> str:
    s = ("" if v is None else str(v)).strip()
    if requerido and not s:
        raise ErrorCal(400, f'El campo "{campo}" es obligatorio')
    if len(s) > maximo:
        raise ErrorCal(400, f'El campo "{campo}" supera {maximo} caracteres')
    return s


def _uno_de(v, campo: str, opciones) -> str:
    if v not in opciones:
        raise ErrorCal(400, f'Valor inválido para "{campo}"')
    return v


def _ids(v) -> list[int]:
    if v is None:
        return []
    if not isinstance(v, list):
        raise ErrorCal(400, "Se esperaba una lista")
    out = []
    for x in v:
        try:
            n = int(x)
        except (TypeError, ValueError):
            continue
        if n > 0 and n not in out:
            out.append(n)
    return out


def _normalizar(datos: dict, base: DesignCalEvento | None) -> dict:
    g = lambda k, por_defecto=None: datos[k] if k in datos else por_defecto   # noqa: E731
    b = lambda campo: getattr(base, campo) if base else None   # noqa: E731
    todo_dia = g("all_day", b("todo_el_dia") if base else True)
    out = {
        "titulo": _texto(g("title", b("titulo")), "título", 140, requerido=True),
        "descripcion": _texto(g("description", b("descripcion")), "descripción", 5000),
        "ubicacion": _texto(g("location", b("ubicacion")), "ubicación", 200),
        "fecha_inicio": _fecha(g("start_date", b("fecha_inicio")), "inicio"),
        "todo_el_dia": bool(todo_dia),
        "repeticion": _uno_de(g("recurrence", b("repeticion") or "none") or "none", "repetición", REPETICIONES),
        "estado": _uno_de(g("status", b("estado") or "pending") or "pending", "estado", ESTADOS),
        "prioridad": _uno_de(g("priority", b("prioridad") or "normal") or "normal", "prioridad", PRIORIDADES),
        "visibilidad": _uno_de(g("visibility", b("visibilidad") or "public") or "public", "visibilidad", VISIBILIDADES),
        "color": g("color", b("color")) or None,
    }
    out["fecha_fin"] = _fecha(g("end_date", b("fecha_fin")) or out["fecha_inicio"].isoformat(), "fin")
    if out["fecha_fin"] < out["fecha_inicio"]:
        raise ErrorCal(400, "La fecha de fin no puede ser anterior al inicio")
    out["hora_inicio"] = out["hora_fin"] = None
    if not out["todo_el_dia"]:
        hi, hf = g("start_time", b("hora_inicio")) or "", g("end_time", b("hora_fin")) or ""
        if not _RE_HORA.match(hi):
            raise ErrorCal(400, "Hora de inicio inválida")
        if not _RE_HORA.match(hf):
            raise ErrorCal(400, "Hora de fin inválida")
        if out["fecha_inicio"] == out["fecha_fin"] and hf < hi:
            raise ErrorCal(400, "La hora de fin debe ser posterior al inicio")
        out["hora_inicio"], out["hora_fin"] = hi, hf
    hasta = g("recurrence_until", b("repetir_hasta"))
    out["repetir_hasta"] = None
    if out["repeticion"] != "none" and hasta:
        out["repetir_hasta"] = _fecha(hasta, "repetir hasta")
        if out["repetir_hasta"] < out["fecha_inicio"]:
            raise ErrorCal(400, '"Repetir hasta" debe ser posterior al inicio')
    if out["color"] and not _RE_COLOR.match(out["color"]):
        raise ErrorCal(400, "Color inválido")
    return out


def _equipo_valido(db: Session, p: dict, team_id) -> int | None:
    if team_id in (None, "", 0, "0"):
        if not p["admin"]:
            raise ErrorCal(400, "Elige el equipo del evento.")
        return None
    try:
        tid = int(team_id)
    except (TypeError, ValueError):
        raise ErrorCal(400, "Equipo inválido")
    if tid not in p["gest"]:
        raise ErrorCal(403, "Solo puedes crear y asignar en tus equipos.")
    return tid


def _asignables(db: Session, p: dict, team_id: int | None) -> set[int]:
    if team_id is None:   # evento general (admin): cualquiera de Design
        return {e for t in p["equipos"] for e in miembros(t)}
    t = _equipo_de(p, team_id)
    return miembros(t) if t else set()


def _relaciones(db: Session, p: dict, ev: DesignCalEvento, etiquetas, asignados) -> None:
    if etiquetas is not None:
        validas = {i for (i,) in db.query(DesignCalEtiqueta.id).filter(DesignCalEtiqueta.id.in_(etiquetas or [-1]))}
        ev.etiquetas = [DesignCalEventoEtiqueta(etiqueta_id=i) for i in etiquetas if i in validas]
    if asignados is not None:
        permitidos = _asignables(db, p, ev.team_id)
        fuera = [i for i in asignados if i not in permitidos]
        if fuera:
            raise ErrorCal(400, "Solo puedes asignar a personas del equipo del evento.")
        ev.asignados = [DesignCalAsignado(empleado_id=i) for i in asignados]


def _actividad(db: Session, user: Empleado, accion: str, ev: DesignCalEvento) -> None:
    db.add(DesignCalActividad(empleado_id=user.id, accion=accion, evento_id=ev.id, team_id=ev.team_id, titulo=ev.titulo,
                              privado=ev.visibilidad == "private"))


def _push(ids, titulo: str, cuerpo: str, ev: DesignCalEvento, etiqueta: str) -> None:
    """Notificación push (las mismas de Design: services_design_push). El calendario ya no tiene campana propia."""
    ids = sorted({i for i in ids if i})
    if not ids:
        return
    try:
        from . import services_design_push as spush
        spush.enviar_en_segundo_plano(ids, titulo, cuerpo, url=f"/design/calendario?fecha={ev.fecha_inicio.isoformat()}", etiqueta=etiqueta)
    except Exception:  # noqa: BLE001  (un push que falla nunca impide guardar)
        log.exception("calendario: no se pudo enviar el push")


def _cuando(ev: DesignCalEvento) -> str:
    dia = ev.fecha_inicio.strftime("%d/%m/%Y")
    if not ev.todo_el_dia and ev.hora_inicio:
        return f"{dia} · {ev.hora_inicio}"
    return dia if ev.fecha_fin == ev.fecha_inicio else f"{dia} al {ev.fecha_fin:%d/%m/%Y}"


def _push_asignados(ev: DesignCalEvento, antes: set[int], actor: Empleado) -> None:
    """A quien acaban de asignar (no a quien asigna)."""
    nuevos = {a.empleado_id for a in ev.asignados} - antes - {actor.id}
    _push(nuevos, f"📅 Te asignaron: {ev.titulo}", f"{_cuando(ev)} · lo asignó {actor.nombre_completo}.", ev, f"cal-asig-{ev.id}")


def avisar() -> None:
    try:
        from . import services_design_vivo as sv
        sv.publicar([{"t": "cal"}])
    except Exception:  # noqa: BLE001
        log.exception("calendario: no se pudo avisar en vivo")


def crear(db: Session, user: Empleado, datos: dict) -> dict:
    p = perfil(db, user)
    if not puede_crear(p):
        raise ErrorCal(403, "Solo los aprobadores y los administradores crean eventos.")
    campos = _normalizar(datos, None)
    ev = DesignCalEvento(**campos, team_id=_equipo_valido(db, p, datos.get("team_id")), creado_por=user.id)
    db.add(ev)
    db.flush()
    _relaciones(db, p, ev, _ids(datos.get("tag_ids")), _ids(datos.get("assignee_ids")))
    _actividad(db, user, "created", ev)
    db.commit()
    avisar()
    _push_asignados(ev, set(), user)
    return serializar(db, p, [ev])[0]


def actualizar(db: Session, user: Empleado, evento_id: int, datos: dict) -> dict:
    ev, p = evento(db, user, evento_id)
    editor = puede_editar(p, ev)
    asignado = any(a.empleado_id == user.id for a in ev.asignados)
    antes, estado_antes = {a.empleado_id for a in ev.asignados}, ev.estado
    claves = set(datos)
    if not editor:
        # Las personas asignadas (diseñadores) solo cambian el estado de su tarea
        if not asignado or claves - {"status"}:
            raise ErrorCal(403, "No tienes permiso para editar este evento")
        ev.estado = _uno_de(datos.get("status"), "estado", ESTADOS)
    else:
        campos = _normalizar(datos, ev)
        for k, v in campos.items():
            setattr(ev, k, v)
        if "team_id" in datos:
            ev.team_id = _equipo_valido(db, p, datos.get("team_id"))
        _relaciones(db, p, ev, _ids(datos["tag_ids"]) if "tag_ids" in datos else None,
                    _ids(datos["assignee_ids"]) if "assignee_ids" in datos else None)
    ev.actualizado_en = datetime.utcnow()
    solo_estado = claves == {"status"}
    _actividad(db, user, f"status:{ev.estado}" if solo_estado else "updated", ev)
    db.commit()
    avisar()
    db.refresh(ev)
    _push_asignados(ev, antes, user)
    if ev.estado == "done" and estado_antes != "done" and ev.creado_por != user.id:
        _push([ev.creado_por], f"✅ {user.nombre_completo} completó «{ev.titulo}»", _cuando(ev), ev, f"cal-hecho-{ev.id}")
    return serializar(db, p, [ev])[0]


def eliminar(db: Session, user: Empleado, evento_id: int, ocurrencia: str | None) -> None:
    ev, p = evento(db, user, evento_id)
    if not puede_editar(p, ev):
        raise ErrorCal(403, "Solo el aprobador del equipo o un administrador puede eliminarlo")
    if ocurrencia and ev.repeticion != "none":
        _fecha(ocurrencia, "ocurrencia")
        ex = sorted(set(json.loads(ev.excepciones or "[]")) | {ocurrencia[:10]})
        ev.excepciones = json.dumps(ex)
        ev.actualizado_en = datetime.utcnow()
        _actividad(db, user, "deleted_occurrence", ev)
    else:
        _actividad(db, user, "deleted", ev)
        db.delete(ev)
    db.commit()
    avisar()


# ---------- Comentarios y actividad ----------

def comentarios(db: Session, user: Empleado, evento_id: int) -> list[dict]:
    ev, _ = evento(db, user, evento_id)
    filas = (db.query(DesignCalComentario, Empleado).join(Empleado, Empleado.id == DesignCalComentario.empleado_id)
             .filter(DesignCalComentario.evento_id == ev.id).order_by(DesignCalComentario.creado_en, DesignCalComentario.id).all())
    return [{"id": c.id, "body": c.texto, "created_at": _sql_dt(c.creado_en), "user_id": e.id, "user_name": e.nombre_completo,
             "user_color": color_de(e.id)} for c, e in filas]


def comentar(db: Session, user: Empleado, evento_id: int, texto: str) -> None:
    ev, _ = evento(db, user, evento_id)
    db.add(DesignCalComentario(evento_id=ev.id, empleado_id=user.id, texto=_texto(texto, "comentario", 2000, requerido=True)))
    _actividad(db, user, "commented", ev)
    db.commit()
    avisar()


def actividad(db: Session, user: Empleado) -> list[dict]:
    p = perfil(db, user)
    q = db.query(DesignCalActividad, Empleado).outerjoin(Empleado, Empleado.id == DesignCalActividad.empleado_id)
    if not p["admin"]:
        q = q.filter(or_(DesignCalActividad.team_id.is_(None), DesignCalActividad.team_id.in_(p["ver"] or {-1})),
                     or_(DesignCalActividad.privado.is_(False), DesignCalActividad.empleado_id == user.id))
    return [{"id": a.id, "action": a.accion, "event_id": a.evento_id, "title": a.titulo, "created_at": _sql_dt(a.creado_en),
             "user_id": a.empleado_id, "user_name": e.nombre_completo if e else "", "user_color": color_de(a.empleado_id or 0)}
            for a, e in q.order_by(DesignCalActividad.id.desc()).limit(40).all()]


# ---------- Etiquetas (compartidas por todo Design) ----------

def sembrar_etiquetas(db: Session) -> None:
    if not db.query(DesignCalEtiqueta.id).first():
        for n, c in ETIQUETAS_INICIALES:
            db.add(DesignCalEtiqueta(nombre=n, color=c))
        db.commit()


def etiquetas(db: Session) -> list[dict]:
    sembrar_etiquetas(db)
    uso = dict(db.query(DesignCalEventoEtiqueta.etiqueta_id, func.count()).group_by(DesignCalEventoEtiqueta.etiqueta_id).all())
    return [{"id": t.id, "name": t.nombre, "color": t.color, "created_by": t.creado_por, "usage": uso.get(t.id, 0)}
            for t in sorted(db.query(DesignCalEtiqueta).all(), key=lambda t: _norm(t.nombre))]


def _etiqueta_dict(t: DesignCalEtiqueta) -> dict:
    return {"id": t.id, "name": t.nombre, "color": t.color, "created_by": t.creado_por, "usage": 0}


def crear_etiqueta(db: Session, user: Empleado, nombre, color) -> dict:
    p = perfil(db, user)
    if not puede_crear(p):
        raise ErrorCal(403, "Solo los aprobadores y los administradores crean etiquetas.")
    nombre = _texto(nombre, "nombre", 40, requerido=True)
    if db.query(DesignCalEtiqueta).filter(func.lower(DesignCalEtiqueta.nombre) == nombre.lower()).first():
        raise ErrorCal(409, "Ya existe una etiqueta con ese nombre")
    t = DesignCalEtiqueta(nombre=nombre, color=color if _RE_COLOR.match(color or "") else PALETA[len(nombre) % len(PALETA)], creado_por=user.id)
    db.add(t)
    db.commit()
    avisar()
    return _etiqueta_dict(t)


def _etiqueta_editable(db: Session, user: Empleado, etiqueta_id: int) -> DesignCalEtiqueta:
    t = db.get(DesignCalEtiqueta, etiqueta_id)
    if not t:
        raise ErrorCal(404, "Etiqueta no encontrada")
    if t.creado_por != user.id and not sd.es_admin(user):
        raise ErrorCal(403, "Solo quien creó la etiqueta o un administrador puede cambiarla")
    return t


def editar_etiqueta(db: Session, user: Empleado, etiqueta_id: int, datos: dict) -> dict:
    t = _etiqueta_editable(db, user, etiqueta_id)
    if "name" in datos:
        nombre = _texto(datos["name"], "nombre", 40, requerido=True)
        if db.query(DesignCalEtiqueta).filter(func.lower(DesignCalEtiqueta.nombre) == nombre.lower(), DesignCalEtiqueta.id != t.id).first():
            raise ErrorCal(409, "Ya existe una etiqueta con ese nombre")
        t.nombre = nombre
    if "color" in datos:
        if not _RE_COLOR.match(datos["color"] or ""):
            raise ErrorCal(400, "Color inválido")
        t.color = datos["color"]
    db.commit()
    avisar()
    return _etiqueta_dict(t)


def eliminar_etiqueta(db: Session, user: Empleado, etiqueta_id: int) -> None:
    t = _etiqueta_editable(db, user, etiqueta_id)
    db.query(DesignCalEventoEtiqueta).filter(DesignCalEventoEtiqueta.etiqueta_id == t.id).delete(synchronize_session=False)
    db.delete(t)
    db.commit()
    avisar()


# ---------------------------------------------------------------------------------------------------------------
# Ausencias: People (solicitudes) + vacaciones estimadas por el aprobador
# ---------------------------------------------------------------------------------------------------------------

_TIPOS = [("calamidad", ("calamidad", "emergencia")), ("incapacidad", ("incapacidad", "enfermedad", "eps", "arl", "hospital", "medic")),
          ("licencia", ("licencia", "maternidad", "paternidad", "luto", "matrimonio")), ("vacaciones", ("vacacion", "descanso")),
          ("permiso", ("permiso", "cita", "diligencia", "compensatorio", "remoto", "estudio"))]


def tipo_de(nombre: str, es_vacaciones: bool = False) -> str:
    if es_vacaciones:
        return "vacaciones"
    n = _norm(nombre)
    for tipo, palabras in _TIPOS:
        if any(w in n for w in palabras):
            return tipo
    return "permiso"


def _alcance_personas(p: dict) -> dict[int, DesignTeam]:
    """{empleado_id: su primer equipo dentro de lo que esta persona ve}."""
    out: dict[int, DesignTeam] = {}
    for t in p["equipos"]:
        if p["admin"] or t.id in p["ver"]:
            for e in miembros(t):
                out.setdefault(e, t)
    return out


def _vacaciones_confirmadas(db: Session, empleado_id: int, desde: date, hasta: date) -> bool:
    return bool(db.query(Solicitud.id).join(TipoPermiso, TipoPermiso.id == Solicitud.tipo_id)
                .filter(Solicitud.empleado_id == empleado_id, Solicitud.estado == "aprobada", Solicitud.fecha_inicio <= hasta,
                        Solicitud.fecha_fin >= desde,
                        or_(TipoPermiso.es_vacaciones == 1, func.lower(TipoPermiso.nombre).like("%vacacion%"))).first())


def limpiar_confirmadas(db: Session) -> int:
    """Borra las vacaciones estimadas que People ya aprobó (unas vacaciones aprobadas de esa persona se cruzan con ellas)."""
    borradas = 0
    for v in db.query(DesignCalVacacionEstimada).all():
        if _vacaciones_confirmadas(db, v.empleado_id, v.fecha_inicio, v.fecha_fin):
            db.add(DesignCalActividad(empleado_id=None, accion="estimate_confirmed", evento_id=None, team_id=v.team_id,
                                      titulo=f"Vacaciones de {v.empleado.nombre_completo if v.empleado else 'la persona'} aprobadas en People"))
            db.delete(v)
            borradas += 1
    if borradas:
        db.commit()
        avisar()
    return borradas


def ausencias(db: Session, user: Empleado, desde: date, hasta: date) -> list[dict]:
    p = perfil(db, user)
    alcance = _alcance_personas(p)
    alcance.setdefault(user.id, None)
    ids = list(alcance)
    filas = (db.query(Solicitud, TipoPermiso, Empleado).join(TipoPermiso, TipoPermiso.id == Solicitud.tipo_id)
             .join(Empleado, Empleado.id == Solicitud.empleado_id)
             .filter(Solicitud.empleado_id.in_(ids), Solicitud.estado.in_(list(ESTADOS_PEOPLE)), Solicitud.fecha_inicio <= hasta,
                     Solicitud.fecha_fin >= desde).order_by(Solicitud.fecha_inicio).all())
    out = []
    for s, tp, e in filas:
        tipo = tipo_de(tp.nombre, bool(tp.es_vacaciones))
        privilegiado = p["admin"] or e.id == user.id
        t = alcance.get(e.id)
        out.append({"id": s.id, "external_id": f"Solicitud {s.id}", "person_name": e.nombre_completo, "person_email": e.email,
                    "team": t.nombre if t else "", "type": "ausencia" if (tipo in SENSIBLES and not privilegiado) else tipo,
                    "type_name": tp.nombre if (privilegiado or tipo not in SENSIBLES) else "", "status": ESTADOS_PEOPLE[s.estado],
                    "start_date": s.fecha_inicio.isoformat(), "end_date": s.fecha_fin.isoformat(),
                    "start_time": s.hora_inicio.strftime("%H:%M") if s.hora_inicio else None,
                    "end_time": s.hora_fin.strftime("%H:%M") if s.hora_fin else None,
                    "notes": (s.motivo or "") if privilegiado else "", "source": "people", "user_id": e.id, "user_color": color_de(e.id),
                    "person_key": (e.email or str(e.id)).lower()})
    estimadas = (db.query(DesignCalVacacionEstimada).options(joinedload(DesignCalVacacionEstimada.empleado))
                 .filter(DesignCalVacacionEstimada.empleado_id.in_(ids), DesignCalVacacionEstimada.fecha_inicio <= hasta,
                         DesignCalVacacionEstimada.fecha_fin >= desde).all())
    for v in estimadas:
        e = v.empleado
        if not e:
            continue
        t = alcance.get(e.id)
        out.append({"id": -v.id, "estimada_id": v.id, "external_id": "Estimada por el aprobador", "person_name": e.nombre_completo,
                    "person_email": e.email, "team": t.nombre if t else "", "type": "vacaciones", "type_name": "Vacaciones estimadas",
                    "status": "estimated", "start_date": v.fecha_inicio.isoformat(), "end_date": v.fecha_fin.isoformat(),
                    "start_time": None, "end_time": None, "notes": v.notas or "", "source": "estimada", "user_id": e.id,
                    "user_color": color_de(e.id), "person_key": (e.email or str(e.id)).lower(),
                    "can_manage": puede_estimar(db, p, e.id), "reminded": bool(v.recordado_en)})
    return out


def personas_ausencias(db: Session, user: Empleado) -> list[dict]:
    """Filas de la vista Equipo: la gente de los equipos que esta persona ve, agrupada por equipo."""
    p = perfil(db, user)
    alcance = _alcance_personas(p)
    if not alcance:
        alcance = {user.id: None}
    emps = {e.id: e for e in db.query(Empleado).filter(Empleado.id.in_(list(alcance)), Empleado.activo == 1).all()}
    orden_equipo = {t.id: i for i, t in enumerate(p["equipos"])}
    out = []
    for eid, t in alcance.items():
        e = emps.get(eid)
        if not e:
            continue
        out.append({"person_key": (e.email or str(e.id)).lower(), "person_name": e.nombre_completo, "person_email": e.email,
                    "team": t.nombre if t else "", "team_id": t.id if t else None, "user_id": e.id, "user_color": color_de(e.id),
                    "_o": (orden_equipo.get(t.id, 999) if t else 999, _norm(e.nombre_completo))})
    out.sort(key=lambda x: x.pop("_o"))
    return out


def puede_estimar(db: Session, p: dict, empleado_id: int) -> bool:
    if p["admin"]:
        return True
    return any(empleado_id in miembros(t) for t in p["equipos"] if t.id in p["gest"])


def _equipo_para(p: dict, empleado_id: int) -> int | None:
    for t in p["equipos"]:
        if (p["admin"] or t.id in p["gest"]) and empleado_id in miembros(t):
            return t.id
    return None


def guardar_estimada(db: Session, user: Empleado, datos: dict, estimada_id: int | None = None) -> dict:
    p = perfil(db, user)
    if estimada_id:
        v = db.get(DesignCalVacacionEstimada, estimada_id)
        if not v or not puede_estimar(db, p, v.empleado_id):
            raise ErrorCal(404, "Vacaciones estimadas no encontradas")
        empleado_id = v.empleado_id
    else:
        try:
            empleado_id = int(datos.get("empleado_id"))
        except (TypeError, ValueError):
            raise ErrorCal(400, "Elige a la persona")
        if not puede_estimar(db, p, empleado_id):
            raise ErrorCal(403, "Solo puedes estimar vacaciones de personas de tus equipos.")
        v = DesignCalVacacionEstimada(empleado_id=empleado_id, creado_por=user.id, team_id=_equipo_para(p, empleado_id))
        db.add(v)
    desde, hasta = _fecha(datos.get("start_date"), "inicio"), _fecha(datos.get("end_date") or datos.get("start_date"), "fin")
    if hasta < desde:
        raise ErrorCal(400, "La fecha de fin no puede ser anterior al inicio")
    if _vacaciones_confirmadas(db, empleado_id, desde, hasta):
        raise ErrorCal(409, "People ya aprobó vacaciones de esta persona en esas fechas: no hace falta estimarlas.")
    if estimada_id and (v.fecha_inicio != desde):
        v.recordado_en = None   # cambió la fecha: el recordatorio de 1 mes antes vuelve a correr
    v.fecha_inicio, v.fecha_fin = desde, hasta
    v.notas = _texto(datos.get("notes"), "notas", 300)
    db.commit()
    avisar()
    return {"ok": True, "id": v.id}


def eliminar_estimada(db: Session, user: Empleado, estimada_id: int) -> None:
    p = perfil(db, user)
    v = db.get(DesignCalVacacionEstimada, estimada_id)
    if not v or not puede_estimar(db, p, v.empleado_id):
        raise ErrorCal(404, "Vacaciones estimadas no encontradas")
    db.delete(v)
    db.commit()
    avisar()


# ---------- Recordatorio: un mes antes de unas vacaciones estimadas ----------

def recordar_estimadas(db: Session, hoy: date | None = None) -> list[int]:
    """Push al manager (y a quien las estimó) cuando faltan 30 días o menos para unas vacaciones estimadas que People aún
    no ha aprobado. Se envía una sola vez por estimada (si cambia la fecha de inicio, vuelve a enviarse)."""
    from . import services_design_push as spush
    hoy = hoy or sd.ahora_colombia().date()
    limpiar_confirmadas(db)
    pendientes = (db.query(DesignCalVacacionEstimada).options(joinedload(DesignCalVacacionEstimada.empleado))
                  .filter(DesignCalVacacionEstimada.recordado_en.is_(None), DesignCalVacacionEstimada.fecha_inicio >= hoy,
                          DesignCalVacacionEstimada.fecha_inicio <= hoy + timedelta(days=DIAS_RECORDATORIO)).all())
    enviadas = []
    for v in pendientes:
        e = v.empleado
        if not e:
            continue
        managers = {t.manager_id for t in _equipos_activos(db) if t.manager_id and e.id in miembros(t) and t.manager_id != e.id}
        destino = sorted(managers | {v.creado_por})
        dias = (v.fecha_inicio - hoy).days
        cuando = "hoy" if dias == 0 else ("mañana" if dias == 1 else f"en {dias} días")
        spush.enviar_en_segundo_plano(
            destino, f"🌴 Vacaciones estimadas de {e.nombre_completo}",
            f"Empiezan {cuando} ({v.fecha_inicio:%d/%m/%Y}). Recuerda que debe enviar el formato de vacaciones a People para que las agenden con tiempo.",
            url=f"/design/calendario?vista=team&fecha={v.fecha_inicio.isoformat()}", etiqueta=f"cal-vac-{v.id}")
        v.recordado_en = datetime.utcnow()
        enviadas.append(v.id)
    if enviadas:
        db.commit()
    return enviadas


_hilo = {"t": None}
CADA_S = 30 * 60


def arrancar_recordatorios() -> None:
    """Hilo en segundo plano (un solo proceso): cada 30 min revisa los recordatorios y las estimadas ya aprobadas."""
    if _hilo["t"] is not None:
        return

    def bucle():
        _time.sleep(60)
        while True:
            from .database import SessionLocal
            db = SessionLocal()
            try:
                recordar_estimadas(db)
            except Exception:  # noqa: BLE001
                log.exception("calendario: falló la revisión de recordatorios")
            finally:
                db.close()
            _time.sleep(CADA_S)

    _hilo["t"] = threading.Thread(target=bucle, daemon=True, name="design-calendario")
    _hilo["t"].start()


# ---------- Exportar (.ics) ----------

def ics(db: Session, user: Empleado) -> str:
    p = perfil(db, user)
    filas = _consulta(db, p).order_by(DesignCalEvento.fecha_inicio).all()
    esc = lambda s: str(s).replace("\\", "\\\\").replace("\n", "\\n").replace(",", "\\,").replace(";", "\\;")   # noqa: E731
    d = lambda x: x.isoformat().replace("-", "")   # noqa: E731
    frec = {"daily": "DAILY", "weekly": "WEEKLY", "monthly": "MONTHLY", "yearly": "YEARLY"}
    sello = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    lineas = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Nuvia Design//Calendario//ES", "CALSCALE:GREGORIAN", "X-WR-TIMEZONE:America/Bogota"]
    for e in filas:
        lineas += ["BEGIN:VEVENT", f"UID:design-cal-{e.id}@nuvia", f"DTSTAMP:{sello}", f"SUMMARY:{esc(e.titulo)}"]
        if e.todo_el_dia:
            lineas += [f"DTSTART;VALUE=DATE:{d(e.fecha_inicio)}", f"DTEND;VALUE=DATE:{d(e.fecha_fin + timedelta(days=1))}"]
        else:
            lineas += [f"DTSTART;TZID=America/Bogota:{d(e.fecha_inicio)}T{e.hora_inicio.replace(':', '')}00",
                       f"DTEND;TZID=America/Bogota:{d(e.fecha_fin)}T{e.hora_fin.replace(':', '')}00"]
        if e.repeticion != "none":
            lineas.append(f"RRULE:FREQ={frec[e.repeticion]}" + (f";UNTIL={d(e.repetir_hasta)}" if e.repetir_hasta else ""))
        if e.descripcion:
            lineas.append(f"DESCRIPTION:{esc(e.descripcion)}")
        if e.ubicacion:
            lineas.append(f"LOCATION:{esc(e.ubicacion)}")
        lineas.append("END:VEVENT")
    lineas.append("END:VCALENDAR")
    return "\r\n".join(lineas)
