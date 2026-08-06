"""Certificado laboral autogenerado por el propio empleado."""
from datetime import date
from fastapi import APIRouter, Request, Depends, Form
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Empleado
from ..auth import get_current_user
from ..services import auditar
from ..main_templates import templates
from ..logos import logo_para

MESES_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
           "agosto", "septiembre", "octubre", "noviembre", "diciembre"]


def fecha_larga_es(d: date) -> str:
    return f"{d.day} de {MESES_ES[d.month - 1]} de {d.year}"


router = APIRouter()

FIRMANTE_NOMBRE = "Pamela Manzur"
FIRMANTE_CARGO = "Directora de People"
CORREO_VERIFICACION = "pamela.manzurroca@nuviasmiles.com"


@router.get("/certificaciones")
async def certificaciones_form(request: Request, user: Empleado = Depends(get_current_user)):
    return templates.TemplateResponse(request, "certificaciones.html",
                                      {"user": user, "error": request.query_params.get("error")})


@router.post("/certificaciones/generar")
async def generar_certificado(request: Request, user: Empleado = Depends(get_current_user),
                              db: Session = Depends(get_db),
                              dirigido_a: str = Form("A quien interese"), motivo: str = Form("")):
    if not user.fecha_inicio_empresa:
        return RedirectResponse(
            "/certificaciones?error=Tu fecha de inicio en la empresa no está registrada. "
            "Pídele a RRHH que la complete antes de generar el certificado.", status_code=303)

    auditar(db, user.email, "Certificado laboral generado", motivo.strip() or "-", empleado_id=user.id)
    db.commit()
    return templates.TemplateResponse(request, "certificado.html",
                                      {"user": user,
                                       "dirigido_a": dirigido_a.strip() or "A quien interese",
                                       "motivo": motivo.strip(),
                                       "hoy_fmt": fecha_larga_es(date.today()),
                                       "fecha_inicio_fmt": fecha_larga_es(user.fecha_inicio_empresa),
                                       "logo": logo_para(user.empresa),
                                       "firmante_nombre": FIRMANTE_NOMBRE,
                                       "firmante_cargo": FIRMANTE_CARGO,
                                       "correo_verificacion": CORREO_VERIFICACION})
