"""Permisos temporales para editar días cerrados del Schedule (13-oct-2026).

Normalmente un día se cierra a las 5:00 am del día siguiente (services_design.dia_cerrado). Desde Parámetros › Equipos
un admin puede abrirle a una persona un rango de días anteriores por un tiempo (p. ej. "esta semana, hasta mañana").
El permiso es de esa persona: los demás siguen viendo esos días cerrados.
"""
import time
from datetime import date, datetime, timedelta

from sqlalchemy.orm import Session, joinedload

from . import services_design as sd
from .models import Empleado
from .models_design import DesignPermisoEdicion

MAX_DIAS_ATRAS = 62      # no se abren días de hace más de dos meses
MAX_DURACION_DIAS = 31   # el permiso dura como mucho un mes

_cache = {"t": 0.0, "v": None}


def _ahora() -> datetime:
    return sd.ahora_colombia().replace(tzinfo=None)


def _vigentes(db: Session) -> list[tuple[int, date, date, datetime]]:
    """(empleado, desde, hasta, vence) de los permisos que no han vencido. Se guarda unos segundos en memoria porque se
    consulta en cada guardado del Schedule."""
    if _cache["v"] is not None and time.monotonic() - _cache["t"] < 20:
        return _cache["v"]
    v = [(p.empleado_id, p.desde, p.hasta, p.vence_en) for p in
         db.query(DesignPermisoEdicion).filter(DesignPermisoEdicion.revocado.is_(False),
                                               DesignPermisoEdicion.vence_en > _ahora()).all()]
    _cache.update(t=time.monotonic(), v=v)
    return v


def _invalidar() -> None:
    _cache["v"] = None


def permiso_para(db: Session, user: Empleado | None, fecha: date) -> datetime | None:
    """Hasta cuándo puede `user` editar `fecha` (un día cerrado) por un permiso; None si no tiene."""
    if not user:
        return None
    ahora = _ahora()
    hasta = [v for (e, d, h, v) in _vigentes(db) if e == user.id and d <= fecha <= h and v > ahora]
    return max(hasta) if hasta else None


def dia_cerrado_para(db: Session, user: Empleado | None, fecha: date) -> bool:
    """Como sd.dia_cerrado, pero un día cerrado queda abierto para quien tiene un permiso vigente que lo cubre."""
    return sd.dia_cerrado(fecha) and permiso_para(db, user, fecha) is None


# ---------- Parámetros › Equipos (solo admins; el router lo valida) ----------

def listar(db: Session) -> list[dict]:
    ahora = _ahora()
    ps = (db.query(DesignPermisoEdicion).options(joinedload(DesignPermisoEdicion.empleado))
          .filter(DesignPermisoEdicion.revocado.is_(False), DesignPermisoEdicion.vence_en > ahora)
          .order_by(DesignPermisoEdicion.vence_en).all())
    return [{"id": p.id, "empleadoId": p.empleado_id, "nombre": p.empleado.nombre_completo if p.empleado else "",
             "desde": p.desde.isoformat(), "hasta": p.hasta.isoformat(), "venceEn": p.vence_en.isoformat(timespec="minutes"),
             "motivo": p.motivo, "por": p.creado_por} for p in ps]


def crear(db: Session, empleado_id: int, desde: date, hasta: date, vence_en: datetime, por: str, motivo: str = "") -> dict:
    e = db.get(Empleado, empleado_id)
    if not e or not e.activo or not e.tiene_modulo("design_schedule"):
        raise ValueError("Esa persona no existe o no tiene acceso a Design.")
    hoy, ahora = sd.ahora_colombia().date(), _ahora()
    if desde > hasta:
        raise ValueError("La fecha inicial no puede ser posterior a la final.")
    if hasta >= hoy:
        raise ValueError("Solo se abren días anteriores a hoy (hoy todavía se puede editar).")
    if (hoy - desde).days > MAX_DIAS_ATRAS:
        raise ValueError(f"Solo se pueden abrir días de los últimos {MAX_DIAS_ATRAS} días.")
    if vence_en <= ahora:
        raise ValueError("El permiso debe vencer más adelante que ahora.")
    if vence_en > ahora + timedelta(days=MAX_DURACION_DIAS):
        raise ValueError(f"El permiso puede durar como mucho {MAX_DURACION_DIAS} días.")
    p = DesignPermisoEdicion(empleado_id=e.id, desde=desde, hasta=hasta, vence_en=vence_en,
                             motivo=(motivo or "").strip()[:200], creado_por=por)
    db.add(p)
    db.commit()
    _invalidar()
    return {"id": p.id, "nombre": e.nombre_completo}


def quitar(db: Session, permiso_id: int) -> bool:
    p = db.get(DesignPermisoEdicion, permiso_id)
    if not p or p.revocado:
        return False
    p.revocado = True
    db.commit()
    _invalidar()
    return True
