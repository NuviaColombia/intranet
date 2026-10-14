"""Mural (13-oct-2026): sección nueva de Design, por ahora en construcción y visible solo para Rosember."""
from fastapi import APIRouter, Depends, HTTPException, Request

from ..auth import get_current_user
from ..main_templates import templates
from ..models import Empleado
from .design_schedule import _RutaDesign

router = APIRouter(route_class=_RutaDesign)

# Quién ve el Mural mientras se construye (correo de la sesión real, no el de una simulación).
MURAL_EMAILS = {"rosember@nuviasmiles.com"}


def ve_mural(user: Empleado | None) -> bool:
    return bool(user) and (user.email or "").strip().lower() in MURAL_EMAILS


def _solo_mural(user: Empleado = Depends(get_current_user)) -> Empleado:
    if not ve_mural(user):
        raise HTTPException(status_code=307, headers={"Location": "/?error=sin_acceso"})
    return user


@router.get("/design/mural")
def pagina_mural(request: Request, user: Empleado = Depends(_solo_mural)):
    return templates.TemplateResponse(request, "design_mural.html", {"user": user, "es_design": True})
