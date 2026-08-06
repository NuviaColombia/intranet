"""Envío de correos vía API de Zoho Mail (self-client con refresh token)."""
import sys
import time
import httpx
from . import config

try:  # evita UnicodeEncodeError al imprimir emojis en consolas con codificación no-UTF8 (ej. Windows/cp1252)
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

_token_cache = {"access_token": None, "expires_at": 0}
_account_id_cache = {"id": None}


def _access_token() -> str:
    if _token_cache["access_token"] and time.time() < _token_cache["expires_at"] - 60:
        return _token_cache["access_token"]
    r = httpx.post(f"{config.ZOHO_ACCOUNTS_URL}/oauth/v2/token", data={
        "grant_type": "refresh_token",
        "refresh_token": config.ZOHO_MAIL_REFRESH_TOKEN,
        "client_id": config.ZOHO_MAIL_CLIENT_ID,
        "client_secret": config.ZOHO_MAIL_CLIENT_SECRET,
    }, timeout=20)
    r.raise_for_status()
    data = r.json()
    _token_cache["access_token"] = data["access_token"]
    _token_cache["expires_at"] = time.time() + int(data.get("expires_in", 3600))
    return _token_cache["access_token"]


def _account_id() -> str:
    if _account_id_cache["id"]:
        return _account_id_cache["id"]
    r = httpx.get(f"{config.ZOHO_MAIL_API}/api/accounts",
                  headers={"Authorization": f"Zoho-oauthtoken {_access_token()}"}, timeout=20)
    r.raise_for_status()
    _account_id_cache["id"] = str(r.json()["data"][0]["accountId"])
    return _account_id_cache["id"]


def enviar_correo(para: str, asunto: str, html: str) -> bool:
    """Envía un correo. Devuelve False (sin lanzar) si Zoho Mail no está configurado."""
    if not (config.ZOHO_MAIL_REFRESH_TOKEN and config.MAIL_FROM):
        print(f"[MAIL deshabilitado] Para: {para} | Asunto: {asunto}")
        return False
    try:
        r = httpx.post(
            f"{config.ZOHO_MAIL_API}/api/accounts/{_account_id()}/messages",
            headers={"Authorization": f"Zoho-oauthtoken {_access_token()}"},
            json={
                "fromAddress": config.MAIL_FROM,
                "toAddress": para,
                "subject": asunto,
                "content": html,
                "mailFormat": "html",
            },
            timeout=30,
        )
        r.raise_for_status()
        return True
    except Exception as e:
        print(f"[MAIL error] {para}: {e}")
        return False
