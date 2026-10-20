"""Login con Zoho OAuth (OpenID Connect) y manejo de sesión."""
import logging
import httpx
from fastapi import Request, HTTPException, Depends
from sqlalchemy.orm import Session
from . import config
from .database import get_db
from .models import Empleado

log = logging.getLogger(__name__)

AUTH_URL = f"{config.ZOHO_ACCOUNTS_URL}/oauth/v2/auth"
TOKEN_URL = f"{config.ZOHO_ACCOUNTS_URL}/oauth/v2/token"
USERINFO_URL = f"{config.ZOHO_ACCOUNTS_URL}/oauth/v2/userinfo"

# Correos que no pueden entrar a la intranet aunque estén registrados (pedido por Rosember el 12-oct-2026).
# Se suman los de la variable de entorno CORREOS_BLOQUEADOS (separados por coma) para bloquear sin cambiar código.
import os as _os
CORREOS_BLOQUEADOS = {"yeison.torres@nuvia.app"}


def correo_bloqueado(email: str) -> bool:
    e = (email or "").strip().lower()
    extra = {x.strip().lower() for x in _os.environ.get("CORREOS_BLOQUEADOS", "").split(",") if x.strip()}
    return bool(e) and (e in CORREOS_BLOQUEADOS or e in extra)


def acceso_inhabilitado(db, empleado_id: int, rol: str = "") -> bool:
    """¿Se le inhabilitó el acceso desde Design (Parámetros › Equipos)? Si la consulta falla, se bloquea a todos menos a
    administradores (así una falla de la base no deja entrar a alguien que ya no trabaja con nosotros) y queda registrado."""
    try:
        from .models_design import DesignInhabilitado
        h = db.get(DesignInhabilitado, empleado_id)
        return bool(h and h.activo)
    except Exception:
        log.exception("No se pudo revisar si la persona %s está inhabilitada en Design", empleado_id)
        return rol not in ("admin", "superadmin")


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
        try:  # foto de perfil de Zoho para la barra de arriba de todos los módulos (si algo falla, el login sigue igual)
            from .services_design import foto_design_al_iniciar
            await foto_design_al_iniciar(client, tokens["access_token"], ui.json(), email)
        except Exception:  # noqa: BLE001
            pass
        return email


# Simulación (13-oct-2026): un admin ve la intranet como otra persona. Dentro de Design la maneja su propio router
# (puede editar y queda registrado). Fuera de Design se ve todo como esa persona pero SOLO LECTURA.
SIM_KEY = "design_simular_id"


def _es_admin_real(db, user: Empleado) -> bool:
    """¿Puede simular? Admin o superadmin en People, o admin en Design (rol solo de Design)."""
    if user.rol in ("admin", "superadmin"):
        return True
    try:
        from .models_design import DesignRolUsuario
        r = db.get(DesignRolUsuario, user.id)
        return bool(r and r.rol == "admin")
    except Exception:
        log.exception("No se pudo revisar el rol de Design de %s", user.id)
        return False


def puede_simular_a(db, real: Empleado, otro: Empleado) -> bool:
    """El superadmin simula a cualquiera; un admin, solo a personas de su misma empresa y nunca a un superadmin."""
    if not _es_admin_real(db, real) or not otro or not otro.activo or otro.id == real.id:
        return False
    if real.rol == "superadmin":
        return True
    return otro.rol != "superadmin" and (otro.empresa or "") == (real.empresa or "")


def _simulado_fuera_de_design(request: Request, db, real: Empleado) -> Empleado | None:
    sid = request.session.get(SIM_KEY)
    if not sid or request.url.path.startswith("/design"):
        return None
    otro = db.get(Empleado, sid)
    if not puede_simular_a(db, real, otro) or acceso_inhabilitado(db, otro.id, otro.rol):
        request.session.pop(SIM_KEY, None)
        return None
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        raise HTTPException(403, f"Estás viendo la intranet como {otro.nombre_completo}: fuera de Design solo se puede ver. "
                                 "Sal de la simulación para hacer cambios.")
    request.state.sim_real = real
    return otro


def get_current_user(request: Request, db: Session = Depends(get_db)) -> Empleado:
    email = request.session.get("user_email")
    if email and correo_bloqueado(email):   # bloqueado: se cierra su sesión en el siguiente clic
        request.session.clear()
        raise HTTPException(status_code=307, headers={"Location": "/login?error=bloqueado"})
    if not email:
        # Recuerda a qué página quería entrar (p. ej. el enlace de un aviso de Cliq) para volver ahí después del login
        if request.method == "GET" and "/api/" not in request.url.path:
            request.session["volver_a"] = request.url.path + (f"?{request.url.query}" if request.url.query else "")
        raise HTTPException(status_code=307, headers={"Location": "/login"})
    user = db.query(Empleado).filter(Empleado.email == email, Empleado.activo == 1).first()
    if not user:
        request.session.clear()
        raise HTTPException(status_code=307, headers={"Location": "/login?error=no_registrado"})
    if acceso_inhabilitado(db, user.id, user.rol):   # inhabilitado desde Design › Parámetros › Equipos (p. ej. renunció)
        request.session.clear()
        raise HTTPException(status_code=307, headers={"Location": "/login?error=bloqueado"})
    from .invitados import es_invitado, peticion_permitida, MSG_SOLO_LECTURA
    if es_invitado(user) and not peticion_permitida(request.method, request.url.path):
        raise HTTPException(403, MSG_SOLO_LECTURA)   # invitado: en toda la plataforma solo puede ver (app/invitados.py)
    return _simulado_fuera_de_design(request, db, user) or user


def require_admin(user: Empleado = Depends(get_current_user)) -> Empleado:
    if user.rol not in ("admin", "superadmin"):
        raise HTTPException(403, "Requiere rol de administrador.")
    return user


def require_superadmin(user: Empleado = Depends(get_current_user)) -> Empleado:
    if user.rol != "superadmin":
        raise HTTPException(403, "Requiere rol de superadmin.")
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
    if user.rol not in ("aprobador", "admin", "superadmin"):
        raise HTTPException(403, "Requiere rol de aprobador o administrador.")
    return user


def puede_administrar_empresa(user: Empleado, empresa: str) -> bool:
    """Un superadmin administra ambas empresas; un admin/aprobador solo la suya."""
    return user.rol == "superadmin" or user.empresa == empresa


def empresa_filtro(user: Empleado) -> str | None:
    """Empresa por la que se debe filtrar una consulta: None = sin filtro (superadmin ve todo)."""
    return None if user.rol == "superadmin" else user.empresa
