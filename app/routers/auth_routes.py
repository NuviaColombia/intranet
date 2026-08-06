from fastapi import APIRouter, Request, Depends
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Empleado
from ..auth import zoho_login_url, zoho_get_email
from ..main_templates import templates

router = APIRouter()


@router.get("/login")
async def login(request: Request):
    error = request.query_params.get("error")
    mensajes = {
        "no_registrado": "Tu correo de Zoho no está registrado como empleado. Contacta al administrador.",
        "zoho": "Error al autenticar con Zoho. Intenta de nuevo.",
    }
    return templates.TemplateResponse(request, "login.html",
                                      {"error": mensajes.get(error), "user": None})


@router.get("/auth/zoho")
async def auth_zoho():
    return RedirectResponse(zoho_login_url())


@router.get("/auth/callback")
async def auth_callback(request: Request, code: str = "", db: Session = Depends(get_db)):
    if not code:
        return RedirectResponse("/login?error=zoho")
    try:
        email = await zoho_get_email(code)
    except Exception:
        return RedirectResponse("/login?error=zoho")
    user = db.query(Empleado).filter(Empleado.email == email, Empleado.activo == 1).first()
    if not user:
        return RedirectResponse("/login?error=no_registrado")
    request.session["user_email"] = email
    return RedirectResponse("/")


@router.get("/logout")
async def logout(request: Request):
    request.session.clear()
    return RedirectResponse("/login")
