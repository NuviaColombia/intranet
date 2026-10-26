"""Activos: solicitud/aprobación de mantenimiento para managers de equipo (líderes de grupo), sin
acceso al resto del inventario -- ver docs/wiki/activos.md. Página y endpoints separados de
routers/activos.py a propósito: un manager nunca tiene ni la posibilidad de llamar los ~45
endpoints de la app completa, no es solo que la UI se lo oculte."""
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from ..concurrencia import RutaGeneral
from ..database import get_db
from ..models import Empleado
from ..auth import get_current_user
from ..main_templates import templates
from .. import services_activos_solicitudes as ss

router = APIRouter(route_class=RutaGeneral)


def require_activos_manager(user: Empleado = Depends(get_current_user), db: Session = Depends(get_db)) -> Empleado:
    if not (user.tiene_modulo("activos") or ss.es_manager_equipos(db, user.id)):
        raise HTTPException(status_code=307, headers={"Location": "/?error=sin_acceso"})
    return user


def _manejar(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except ss.NoEncontrado as e:
        raise HTTPException(404, str(e))
    except ss.Conflicto as e:
        raise HTTPException(409, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/activos/mantenimiento")
def pagina_solicitudes(request: Request, user: Empleado = Depends(require_activos_manager)):
    return templates.TemplateResponse(request, "activos_mantenimiento.html",
                                      {"user": user, "es_activos": True, "puede_aprobar": ss.puede_aprobar_mantenimiento(user)})


@router.get("/activos/mantenimiento/api/equipos")
def api_equipos_solicitables(user: Empleado = Depends(require_activos_manager), db: Session = Depends(get_db)):
    return ss.listar_equipos_solicitables(db, user)


@router.get("/activos/mantenimiento/api/solicitudes")
def api_solicitudes(user: Empleado = Depends(require_activos_manager), db: Session = Depends(get_db)):
    return ss.listar_solicitudes(db, user)


class SolicitudEntrada(BaseModel):
    asset_tag: str
    descripcion: str = Field(max_length=2000)


@router.post("/activos/mantenimiento/api/solicitudes", status_code=201)
def api_solicitud_crear(payload: SolicitudEntrada, user: Empleado = Depends(require_activos_manager), db: Session = Depends(get_db)):
    s = _manejar(ss.crear_solicitud, db, user, payload.asset_tag, payload.descripcion)
    return {"mensaje": "Solicitud enviada.", "id": s.id}


@router.post("/activos/mantenimiento/api/solicitudes/{id}/aceptar")
def api_solicitud_aceptar(id: int, user: Empleado = Depends(require_activos_manager), db: Session = Depends(get_db)):
    _manejar(ss.aceptar_solicitud, db, user, id)
    return {"mensaje": "Solicitud aceptada. El equipo queda en mantenimiento."}


class RealizadoEntrada(BaseModel):
    notas: str | None = Field(default=None, max_length=2000)


@router.post("/activos/mantenimiento/api/solicitudes/{id}/realizado")
def api_solicitud_realizado(id: int, payload: RealizadoEntrada, user: Empleado = Depends(require_activos_manager), db: Session = Depends(get_db)):
    _manejar(ss.marcar_realizado, db, user, id, payload.notas)
    return {"mensaje": "Mantenimiento marcado como realizado. Falta que el manager lo confirme."}


@router.post("/activos/mantenimiento/api/solicitudes/{id}/confirmar")
def api_solicitud_confirmar(id: int, user: Empleado = Depends(require_activos_manager), db: Session = Depends(get_db)):
    _manejar(ss.confirmar_solicitud, db, user, id)
    return {"mensaje": "Mantenimiento confirmado. El equipo vuelve a estar en uso."}


class RechazoEntrada(BaseModel):
    motivo: str


@router.post("/activos/mantenimiento/api/solicitudes/{id}/rechazar")
def api_solicitud_rechazar(id: int, payload: RechazoEntrada, user: Empleado = Depends(require_activos_manager), db: Session = Depends(get_db)):
    _manejar(ss.rechazar_solicitud, db, user, id, payload.motivo)
    return {"mensaje": "Solicitud rechazada."}
