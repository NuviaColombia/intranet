from fastapi import APIRouter, Request, Depends
from ..models import Empleado
from ..auth import require_modulo
from ..main_templates import templates

router = APIRouter()


@router.get("/inventario")
async def inventario(request: Request, user: Empleado = Depends(require_modulo("custodia"))):
    return templates.TemplateResponse(request, "inventario.html", {"user": user, "es_portal": True, "es_inventario": True})
