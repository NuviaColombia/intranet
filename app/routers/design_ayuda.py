"""Solicitar ayuda (19-oct-2026): un aprobador de N3 pide un diseñador libre a los demás aprobadores de N3.
La lógica está en services_design_ayuda. Se incluye desde routers/design_schedule.py (mismo router)."""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import services_design_ayuda as say
from ..database import get_db
from ..models import Empleado
from .design_schedule import _RutaDesign, _fecha, require_admin, require_design_manager

router = APIRouter(route_class=_RutaDesign)


@router.get("/design/api/ayuda/estado")
def api_ayuda_estado(user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    """Para el aprobador: si puede pedir ayuda, el estado de su solicitud de hoy y las solicitudes que le piden responder."""
    return say.estado(db, user)


@router.post("/design/api/ayuda/solicitar")
def api_ayuda_solicitar(user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    try:
        return say.solicitar(db, user)
    except PermissionError as ex:
        raise HTTPException(403, str(ex))


@router.post("/design/api/ayuda/{solicitud_id}/cancelar")
def api_ayuda_cancelar(solicitud_id: int, user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    try:
        return say.cancelar(db, user, solicitud_id)
    except LookupError as ex:
        raise HTTPException(404, str(ex))


class ElegirIn(BaseModel):
    empleadoId: int


@router.post("/design/api/ayuda/{solicitud_id}/elegir")
def api_ayuda_elegir(solicitud_id: int, payload: ElegirIn, user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    try:
        return say.elegir(db, user, solicitud_id, payload.empleadoId)
    except LookupError as ex:
        raise HTTPException(404, str(ex))
    except PermissionError as ex:
        raise HTTPException(403, str(ex))
    except ValueError as ex:
        raise HTTPException(409, str(ex))


@router.get("/design/api/dashboard/ayudas")
def api_dashboard_ayudas(desde: str = Query(..., max_length=10), hasta: str = Query(..., max_length=10),
                         user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    """Dashboard › Ayudas (solo admins): solicitudes de ayuda y si los aprobadores siguen la sugerencia del sistema."""
    d, h = _fecha(desde), _fecha(hasta)
    if h < d or (h - d).days > 400:
        raise HTTPException(400, "Revisa el periodo (desde, hasta).")
    return say.reporte(db, d, h)
