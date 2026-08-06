from fastapi import APIRouter, Request, Depends
from ..models import Empleado
from ..auth import get_current_user
from ..main_templates import templates

router = APIRouter()

MENSAJES_ERROR = {"sin_acceso": "No tienes acceso a ese módulo. Contacta al administrador."}


@router.get("/")
async def portal(request: Request, user: Empleado = Depends(get_current_user)):
    error = request.query_params.get("error")
    return templates.TemplateResponse(request, "portal.html",
                                      {"user": user, "es_portal": True,
                                       "error": MENSAJES_ERROR.get(error)})
