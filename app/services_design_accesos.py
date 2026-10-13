"""Accesos automáticos de los equipos de Design (pedido por Rosember el 12-oct-2026).

Quien está en un equipo activo de Design (como diseñador o manager) necesita el módulo "design_schedule" en su perfil
de empleado para poder entrar; antes había que marcarlo a mano en Administración y se olvidaba (p. ej. Juan Camilo,
N6). Los permisos de Comments, Pre-Approved, etc. ya salen solos del equipo.

- Automático: al agregar a alguien a un equipo, al nombrar manager o al reactivar un equipo, se le da el módulo.
  Al manager además el rol "aprobador" de Design (menú Gestión), solo si no tiene un rol de Design puesto a mano
  y no es ya aprobador o admin.
- Revisión de los que ya existen: una vez (revisar_una_vez) y a pedido desde Parámetros (revisar).
Nunca quita accesos: solo agrega los que faltan.
"""
import json
import logging
from sqlalchemy import event
from sqlalchemy.orm import Session
from .models import Empleado
from .models_design import DesignTeam, DesignTeamDesigner, DesignArea, DesignRolUsuario, DesignConexionRegla

log = logging.getLogger(__name__)
MODULO = "design_schedule"
ROLES_GESTION = ("aprobador", "admin", "superadmin")
MARCA = "accesos_equipos_2026_10_12"
_revisado = {"ok": False}


def _dar_acceso(session: Session, emp: Empleado | None, es_manager: bool, por: str, res: dict) -> None:
    if not emp or not emp.activo:
        return
    if MODULO not in emp.modulos_lista and emp.rol not in ("admin", "superadmin"):
        nuevos = ",".join(emp.modulos_lista + [MODULO])
        if len(nuevos) <= 100:   # la columna de módulos es de 100 caracteres
            emp.modulos = nuevos
            res["modulo"].append(emp.nombre_completo)
        else:
            res["sinEspacio"].append(emp.nombre_completo)
    if es_manager and emp.rol not in ROLES_GESTION:
        with session.no_autoflush:
            ya = session.get(DesignRolUsuario, emp.id)
        if ya is None:
            session.add(DesignRolUsuario(empleado_id=emp.id, rol="aprobador", asignado_por=por))
            res["aprobador"].append(emp.nombre_completo)


def _vacio() -> dict:
    return {"modulo": [], "aprobador": [], "sinEspacio": []}


# ---------- Automático: al guardar cambios en los equipos ----------

@event.listens_for(Session, "before_flush")
def _al_guardar(session, contexto, instancias):
    try:
        res = _vacio()
        with session.no_autoflush:
            for obj in list(session.new) + list(session.dirty):
                if isinstance(obj, DesignTeamDesigner) and obj.empleado_id:
                    t = obj.team or session.get(DesignTeam, obj.team_id)
                    if t is None or t.activo:
                        _dar_acceso(session, session.get(Empleado, obj.empleado_id), False, "Automático (equipo de Design)", res)
                elif isinstance(obj, DesignTeam) and obj.activo:
                    if obj.manager_id:
                        _dar_acceso(session, session.get(Empleado, obj.manager_id), True, "Automático (manager de equipo)", res)
                    if obj in session.dirty:   # equipo reactivado: también sus diseñadores
                        for d in obj.designers:
                            _dar_acceso(session, d.empleado, False, "Automático (equipo de Design)", res)
        if res["modulo"] or res["aprobador"]:
            log.info("Accesos de Design dados automáticamente: %s", res)
    except Exception:  # noqa: BLE001  (nunca debe impedir guardar el equipo)
        log.exception("accesos de Design: no se pudo dar el acceso automático")


# ---------- Revisión de los que ya existen ----------

def revisar(db: Session, por: str = "Sistema") -> dict:
    """Da el acceso que falte a todos los diseñadores y managers de los equipos activos. Devuelve a quién."""
    res = _vacio()
    equipos = db.query(DesignTeam).join(DesignArea).filter(DesignTeam.activo == 1, DesignArea.activo == 1).all()
    for t in equipos:
        if t.manager_id:
            _dar_acceso(db, db.get(Empleado, t.manager_id), True, f"{por} (manager de equipo)", res)
        for d in t.designers:
            _dar_acceso(db, d.empleado, False, f"{por} (equipo de Design)", res)
    for k in res:
        res[k] = sorted(set(res[k]))
    db.commit()
    return res


def revisar_una_vez(db: Session) -> None:
    if _revisado["ok"]:
        return
    try:
        if not db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == "sistema", DesignConexionRegla.clave == MARCA).first():
            res = revisar(db, "Revisión inicial")
            db.add(DesignConexionRegla(tipo="sistema", clave=MARCA, creado_por="Sistema", valor=json.dumps(res, ensure_ascii=False)))
            db.commit()
        _revisado["ok"] = True
    except Exception:  # noqa: BLE001
        db.rollback()
        log.exception("accesos de Design: falló la revisión inicial")


def estado(db: Session) -> dict:
    """Para Parámetros: qué hizo la revisión inicial y quién sigue sin acceso (debería ser nadie)."""
    fila = db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == "sistema", DesignConexionRegla.clave == MARCA).first()
    inicial = json.loads(fila.valor) if fila and fila.valor else None
    faltan = set()
    for t in db.query(DesignTeam).join(DesignArea).filter(DesignTeam.activo == 1, DesignArea.activo == 1).all():
        gente = [d.empleado for d in t.designers] + ([db.get(Empleado, t.manager_id)] if t.manager_id else [])
        for e in gente:
            if e and e.activo and not e.tiene_modulo(MODULO):
                faltan.add(e.nombre_completo)
    return {"revisionInicial": inicial, "fechaRevision": fila.creado_en.isoformat() if fila else None, "sinAcceso": sorted(faltan)}

from datetime import datetime  # noqa: E402

# ---------- Inhabilitar el acceso a la plataforma (pedido por Rosember el 13-oct-2026) ----------
# Una persona que se va (p. ej. renunció un diseñador): sale de sus equipos y ya no puede entrar a la plataforma, pero
# NO se borra nada: su nombre sigue en las órdenes, el Dashboard y los registros del Schedule. Se puede reactivar.
def esta_inhabilitado(db: Session, empleado_id: int | None) -> bool:
    if not empleado_id:
        return False
    from .models_design import DesignInhabilitado
    r = db.get(DesignInhabilitado, empleado_id)
    return bool(r and r.activo)


_CACHE_INH = {"t": 0.0, "ids": frozenset()}


def ids_inhabilitados(db: Session) -> frozenset:
    """Todos los inhabilitados, con caché de 30 s (se usa al armar cada orden del Schedule)."""
    import time
    from .models_design import DesignInhabilitado
    if time.time() - _CACHE_INH["t"] > 30:
        _CACHE_INH["ids"] = frozenset(r[0] for r in db.query(DesignInhabilitado.empleado_id).filter(DesignInhabilitado.activo == 1))
        _CACHE_INH["t"] = time.time()
    return _CACHE_INH["ids"]


def inhabilitados_ids(db: Session, ids) -> set[int]:
    from .models_design import DesignInhabilitado
    ids = [i for i in set(ids) if i]
    if not ids:
        return set()
    return {r[0] for r in db.query(DesignInhabilitado.empleado_id).filter(DesignInhabilitado.empleado_id.in_(ids), DesignInhabilitado.activo == 1)}


def resumen_baja(db: Session, empleado_id: int) -> dict:
    """Lo que pasaría al inhabilitar a esta persona (para mostrarlo antes de confirmar)."""
    from datetime import date
    from .models import Empleado
    from .models_design import DesignTeam, DesignTeamDesigner, DesignOrden, DesignSupportConfig
    from . import services_design as sd
    e = db.get(Empleado, empleado_id)
    if not e:
        raise KeyError(empleado_id)
    equipos = [t.nombre for t in db.query(DesignTeam).join(DesignTeamDesigner, DesignTeamDesigner.team_id == DesignTeam.id)
               .filter(DesignTeamDesigner.empleado_id == empleado_id)]
    manager_de = [t.nombre for t in db.query(DesignTeam).filter(DesignTeam.manager_id == empleado_id, DesignTeam.activo == 1)]
    c = db.query(DesignSupportConfig).first()
    en_support = bool(c and empleado_id in (c.persona_a_id, c.persona_b_id))
    hoy = sd.ahora_colombia().date()
    abiertos = (db.query(DesignOrden).filter(DesignOrden.designer_id == empleado_id, DesignOrden.fecha >= hoy)
                .filter(sd.func.lower(sd.func.trim(DesignOrden.estado)).in_(["ready to design", "hold", "dr authorization", "changes", "initiated", "re-initiated",
                                                                              "order entered", "pickup received", "bite ready", "changes ready"])).count())
    return {"id": e.id, "nombre": e.nombre_completo, "email": e.email, "rol": e.rol, "equipos": equipos, "managerDe": manager_de,
            "enSupport": en_support, "casosAbiertos": abiertos, "yaInhabilitado": esta_inhabilitado(db, empleado_id)}


def inhabilitar(db: Session, empleado_id: int, por: str, motivo: str = "") -> dict:
    """Lo saca de todos sus equipos y bloquea su acceso. Devuelve el resumen. Lanza ValueError si no se puede."""
    from .models_design import DesignInhabilitado, DesignTeamDesigner, DesignPushSuscripcion
    r = resumen_baja(db, empleado_id)
    if r["rol"] in ("admin", "superadmin"):
        raise ValueError("Un administrador no se inhabilita desde aquí.")
    if r["managerDe"]:
        raise ValueError(f"Es manager de {', '.join(r['managerDe'])}: cambia el manager del equipo antes de inhabilitarlo.")
    if r["enSupport"]:
        raise ValueError("Es una de las personas de Support Time: cámbiala en Parámetros › Support Time antes de inhabilitarlo.")
    h = db.get(DesignInhabilitado, empleado_id)
    if not h:
        h = DesignInhabilitado(empleado_id=empleado_id)
        db.add(h)
    h.activo, h.motivo, h.equipos, h.por, h.fecha = 1, (motivo or "").strip()[:1000], ", ".join(r["equipos"]), por, datetime.utcnow()
    h.reactivado_por, h.reactivado_en = "", None
    db.query(DesignTeamDesigner).filter(DesignTeamDesigner.empleado_id == empleado_id).delete(synchronize_session=False)
    db.query(DesignPushSuscripcion).filter(DesignPushSuscripcion.empleado_id == empleado_id).delete(synchronize_session=False)
    db.commit()
    _CACHE_INH["t"] = 0.0
    return r


def reactivar(db: Session, empleado_id: int, por: str) -> bool:
    """Le devuelve el acceso (no lo vuelve a poner en ningún equipo: eso se hace en Equipos)."""
    from .models_design import DesignInhabilitado
    h = db.get(DesignInhabilitado, empleado_id)
    if not h or not h.activo:
        return False
    h.activo, h.reactivado_por, h.reactivado_en = 0, por, datetime.utcnow()
    db.commit()
    _CACHE_INH["t"] = 0.0
    return True


def listar_inhabilitados(db: Session) -> list[dict]:
    from .models import Empleado
    from .models_design import DesignInhabilitado
    out = []
    for h in db.query(DesignInhabilitado).filter(DesignInhabilitado.activo == 1).order_by(DesignInhabilitado.fecha.desc()).all():
        e = db.get(Empleado, h.empleado_id)
        out.append({"id": h.empleado_id, "nombre": e.nombre_completo if e else f"#{h.empleado_id}", "email": e.email if e else "",
                    "motivo": h.motivo, "equipos": h.equipos, "por": h.por, "fecha": h.fecha.isoformat() + "Z"})
    return out
