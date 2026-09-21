"""Login con Zoho OAuth (OpenID Connect) y manejo de sesión."""
import httpx
from fastapi import Request, HTTPException, Depends
from sqlalchemy.orm import Session
from . import config
from .database import get_db
from .models import Empleado

AUTH_URL = f"{config.ZOHO_ACCOUNTS_URL}/oauth/v2/auth"
TOKEN_URL = f"{config.ZOHO_ACCOUNTS_URL}/oauth/v2/token"
USERINFO_URL = f"{config.ZOHO_ACCOUNTS_URL}/oauth/v2/userinfo"
SCOPES = "openid email profile"
REDIRECT_URI = f"{config.BASE_URL}/auth/callback"


def zoho_login_url() -> str:
    from urllib.parse import urlencode
    params = {
        "response_type": "code",
        "client_id": config.ZOHO_CLIENT_ID,
        "scope": SCOPES,
        "redirect_uri": REDIRECT_URI,
        "access_type": "online",
        "prompt": "consent",
    }
    return f"{AUTH_URL}?{urlencode(params)}"


async def zoho_get_email(code: str) -> str:
    """Intercambia el code por un access token y devuelve el email del usuario."""
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(TOKEN_URL, data={
            "grant_type": "authorization_code",
            "code": code,
            "client_id": config.ZOHO_CLIENT_ID,
            "client_secret": config.ZOHO_CLIENT_SECRET,
            "redirect_uri": REDIRECT_URI,
        })
        r.raise_for_status()
        tokens = r.json()
        if "access_token" not in tokens:
            raise HTTPException(400, f"Zoho no devolvió token: {tokens}")
        ui = await client.get(USERINFO_URL, headers={
            "Authorization": f"Zoho-oauthtoken {tokens['access_token']}"
        })
        ui.raise_for_status()
        email = ui.json().get("email", "").lower()
        if not email:
            raise HTTPException(400, "No se pudo obtener el correo desde Zoho.")
        return email


def get_current_user(request: Request, db: Session = Depends(get_db)) -> Empleado:
    email = request.session.get("user_email")
    if not email:
        raise HTTPException(status_code=307, headers={"Location": "/login"})
    user = db.query(Empleado).filter(Empleado.email == email, Empleado.activo == 1).first()
    if not user:
        request.session.clear()
        raise HTTPException(status_code=307, headers={"Location": "/login?error=no_registrado"})
    return user


def require_admin(user: Empleado = Depends(get_current_user)) -> Empleado:
    if user.rol != "admin":
        raise HTTPException(403, "Requiere rol de administrador.")
    return user


def require_modulo(modulo: str):
    def checker(user: Empleado = Depends(get_current_user)) -> Empleado:
        if not user.tiene_modulo(modulo):
            raise HTTPException(status_code=307, headers={"Location": "/?error=sin_acceso"})
        return user
    return checker


def require_design_manager(user: Empleado = Depends(get_current_user)) -> Empleado:
    """Dashboard y Papelera de Design Schedule: equivalente a 'Tools Managers' en la
    herramienta original (protegido por la clave maestra) -- aquí, aprobadores y admins."""
    if not user.tiene_modulo("design_schedule"):
        raise HTTPException(status_code=307, headers={"Location": "/?error=sin_acceso"})
    if user.rol not in ("aprobador", "admin"):
        raise HTTPException(403, "Requiere rol de aprobador o administrador.")
    return user
