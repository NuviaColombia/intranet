from fastapi import APIRouter, Request, Depends
from ..concurrencia import RutaGeneral
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Empleado
from ..auth import require_modulo
from ..acceso_produccion import submodulos_de, es_admin
from ..main_templates import templates

router = APIRouter(route_class=RutaGeneral)  # tope de concurrencia: app/concurrencia.py


@router.get("/inventario")
def inventario(request: Request, user: Empleado = Depends(require_modulo("custodia")), db: Session = Depends(get_db)):
    mis = None if es_admin(user) else submodulos_de(db, user)   # None = todos (administrador)
    return templates.TemplateResponse(request, "inventario.html", {
        "user": user, "es_portal": True, "es_inventario": True, "mis_submodulos": mis,
        "sin_acceso_sub": request.query_params.get("error") == "sin_acceso_submodulo"})
