"""Guarda las secciones que cada persona puede usar en Cambio de custodia, Seguimiento de consumo y Caja menor
(formulario «Secciones» de las pestañas de Accesos en Parámetros). Solo administradores."""
from urllib.parse import quote
from fastapi import APIRouter, Depends, Form, HTTPException
from ..concurrencia import RutaGeneral
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Empleado
from ..auth import get_current_user
from ..formato import nombre_propio
from .. import acceso_secciones as acs

router = APIRouter(route_class=RutaGeneral)  # tope de concurrencia: app/concurrencia.py
VOLVER_PERMITIDO = ("/inventario/parametros", "/caja-menor/parametros")


@router.post("/parametros/secciones")
def guardar_secciones(user: Empleado = Depends(get_current_user), db: Session = Depends(get_db),
                      empleado_id: int = Form(...), modulo: str = Form(...), secciones: list[str] = Form([]),
                      volver: str = Form("/inventario/parametros")):
    from ..acceso_produccion import es_admin_produccion
    if user.rol not in ("admin", "superadmin") and not (modulo in ("custodia", "consumo", "conteo") and es_admin_produccion(user)):
        raise HTTPException(403, "Requiere ser administrador.")
    if not volver.startswith(VOLVER_PERMITIDO):
        volver = "/inventario/parametros"
    persona = db.get(Empleado, empleado_id)
    error = "No se guardó: persona no encontrada." if not persona else acs.guardar(db, empleado_id, modulo, secciones, user)
    msg = error or f"Secciones de {nombre_propio(persona.nombre_completo)} en {acs.NOMBRE_MODULO[modulo]} guardadas."
    separador = "&" if "?" in volver else "?"
    return RedirectResponse(f"{volver}{separador}msg={quote(msg)}", status_code=303)
