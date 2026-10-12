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
