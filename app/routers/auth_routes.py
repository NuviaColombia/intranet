from fastapi import APIRouter, Request, Depends
from fastapi import HTTPException
from fastapi.responses import RedirectResponse, Response
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Empleado
from ..auth import zoho_login_url, zoho_get_email, get_current_user
from ..main_templates import templates

router = APIRouter()


@router.get("/login")
def login(request: Request):
    error = request.query_params.get("error")
    mensajes = {
        "no_registrado": "Tu correo de Zoho no está registrado como empleado. Contacta al administrador.",
        "zoho": "Error al autenticar con Zoho. Intenta de nuevo.",
    }
    return templates.TemplateResponse(request, "login.html",
                                      {"error": mensajes.get(error), "user": None})


@router.get("/auth/zoho")
def auth_zoho():
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
    volver_a = request.session.pop("volver_a", "") or "/"
    if not volver_a.startswith("/") or volver_a.startswith("//") or "\\" in volver_a:
        volver_a = "/"  # solo rutas internas de la intranet
    return RedirectResponse(volver_a)


@router.get("/logout")
def logout(request: Request):
    request.session.clear()
    return RedirectResponse("/login")


@router.get("/mi-foto")
def mi_foto(user: Empleado = Depends(get_current_user), db: Session = Depends(get_db)):
    """Foto de perfil de Zoho de la persona con sesión (barra de arriba). 404 si no hay: se muestran sus iniciales."""
    from ..models_design import DesignFotoPerfil
    f = db.get(DesignFotoPerfil, user.id)
    if not f or not f.datos:
        raise HTTPException(404, "Sin foto.")
    return Response(f.datos, media_type=f.tipo or "image/jpeg", headers={"Cache-Control": "private, max-age=3600"})
