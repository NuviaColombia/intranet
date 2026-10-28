from fastapi import APIRouter, Request, Depends
from ..concurrencia import RutaGeneral
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Empleado
from ..auth import require_modulo_o_admin
from ..acceso_produccion import submodulos_de, es_admin, MODULO_PRODUCCION
from ..main_templates import templates

router = APIRouter(route_class=RutaGeneral)  # tope de concurrencia: app/concurrencia.py


@router.get("/inventario")
def inventario(request: Request, user: Empleado = Depends(require_modulo_o_admin(MODULO_PRODUCCION)), db: Session = Depends(get_db)):
    # Entrar a esta pantalla ya no exige autorización explícita para admin/superadmin (require_modulo_o_admin,
    # ver app/auth.py) -- pero eso no les da acceso real a los submódulos: "mis_submodulos" solo se salta con
    # la lista completa si además tienen el permiso "custodia" (autorizados a entrar en Producción › Parámetros).
    # Si no, ven las tarjetas de los submódulos, pero en gris ("Sin acceso"), igual que un empleado sin permisos.
    mis = None if user.tiene_modulo(MODULO_PRODUCCION) and es_admin(user) else submodulos_de(db, user)
    return templates.TemplateResponse(request, "inventario.html", {
        "user": user, "es_portal": True, "es_inventario": True, "mis_submodulos": mis,
        "sin_acceso_sub": request.query_params.get("error") == "sin_acceso_submodulo"})
