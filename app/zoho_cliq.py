"""Envío de mensajes directos (DM) por Zoho Cliq, vía API con OAuth (self-client con refresh token).

Reemplaza el enfoque anterior (Bot + Incoming Webhook + Deluge), que resultó no ser confiable:
zoho.cliq.postToUser no entregaba el mensaje de forma consistente y tampoco devolvía el error
real. Con OAuth directo vemos la respuesta/error real de la API si algo falla.
"""
import httpx
from . import config

_token_cache = {"access_token": None, "expires_at": 0}


def _access_token() -> str:
    import time
    if _token_cache["access_token"] and time.time() < _token_cache["expires_at"] - 60:
        return _token_cache["access_token"]
    r = httpx.post(f"{config.ZOHO_ACCOUNTS_URL}/oauth/v2/token", data={
        "grant_type": "refresh_token",
        "refresh_token": config.ZOHO_CLIQ_REFRESH_TOKEN,
        "client_id": config.ZOHO_CLIQ_CLIENT_ID,
        "client_secret": config.ZOHO_CLIQ_CLIENT_SECRET,
    }, timeout=20)
    r.raise_for_status()
    data = r.json()
    _token_cache["access_token"] = data["access_token"]
    _token_cache["expires_at"] = time.time() + int(data.get("expires_in", 3600))
    return _token_cache["access_token"]


def enviar_cliq(email: str, texto: str) -> bool:
    """Envía un DM de Cliq al usuario `email`. Devuelve False (sin lanzar) si no está configurado."""
    if not (config.ZOHO_CLIQ_REFRESH_TOKEN and email):
        print(f"[CLIQ deshabilitado] Para: {email} | Texto: {texto}")
        return False
    try:
        r = httpx.post(
            f"https://cliq.zoho.com/api/v2/buddies/{email}/message",
            headers={"Authorization": f"Zoho-oauthtoken {_access_token()}"},
            json={"text": texto},
            timeout=20,
        )
        r.raise_for_status()
        return True
    except Exception as e:
        detalle = e.response.text if isinstance(e, httpx.HTTPStatusError) else str(e)
        print(f"[CLIQ error] {email}: {detalle}")
        return False
