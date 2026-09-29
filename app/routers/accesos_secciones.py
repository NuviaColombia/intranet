"""Guarda las secciones que cada persona puede usar en Cambio de custodia, Seguimiento de consumo y Caja menor
(formulario «Secciones» de las pestañas de Accesos en Parámetros). Solo administradores."""
from urllib.parse import quote
from fastapi import APIRouter, Depends, Form
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Empleado
from ..auth import require_admin
from ..formato import nombre_propio
from .. import acceso_secciones as acs

router = APIRouter()
VOLVER_PERMITIDO = ("/inventario/parametros", "/caja-menor/parametros")


@router.post("/parametros/secciones")
def guardar_secciones(user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                      empleado_id: int = Form(...), modulo: str = Form(...), secciones: list[str] = Form([]),
                      volver: str = Form("/inventario/parametros")):
    if not volver.startswith(VOLVER_PERMITIDO):
        volver = "/inventario/parametros"
    persona = db.get(Empleado, empleado_id)
    error = "No se guardó: persona no encontrada." if not persona else acs.guardar(db, empleado_id, modulo, secciones, user)
    msg = error or f"Secciones de {nombre_propio(persona.nombre_completo)} en {acs.NOMBRE_MODULO[modulo]} guardadas."
    separador = "&" if "?" in volver else "?"
    return RedirectResponse(f"{volver}{separador}msg={quote(msg)}", status_code=303)
