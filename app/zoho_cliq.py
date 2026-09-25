"""Envío de mensajes por Zoho Cliq desde el bot de la empresa ("Nuvia Colombia Bot").

Todos los mensajes de la intranet (People, Producción, etc.) salen SOLO desde el bot configurado en
ZOHO_CLIQ_BOT (nombre único del bot en Cliq), vía la API de Cliq con OAuth (self-client con refresh
token). Nunca se envían como mensaje directo de una persona: si el bot no está configurado o Zoho
rechaza el envío, el mensaje no se manda por otro medio y queda registrado en el log para corregirlo.

Requisito de Cliq: un bot solo puede escribir a los usuarios suscritos a él.
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


def enviar_cliq_varios(emails: list[str], texto: str) -> bool:
    """Envía un mensaje del bot a varios usuarios en una sola llamada. Devuelve False (sin lanzar)
    si el bot no está configurado o Zoho rechaza el envío."""
    emails = [e for e in emails if e]
    if not emails:
        return False
    if not (config.ZOHO_CLIQ_BOT and config.ZOHO_CLIQ_REFRESH_TOKEN):
        print(f"[CLIQ bot] Falta configurar ZOHO_CLIQ_BOT (o la conexión de Cliq); mensaje no enviado a: "
              f"{', '.join(emails)} | Texto: {texto}")
        return False
    try:
        r = httpx.post(
            f"https://cliq.zoho.com/api/v2/bots/{config.ZOHO_CLIQ_BOT}/message",
            headers={"Authorization": f"Zoho-oauthtoken {_access_token()}"},
            json={"text": texto, "userids": ",".join(emails)},
            timeout=20,
        )
        r.raise_for_status()
        return True
    except Exception as e:
        detalle = e.response.text if isinstance(e, httpx.HTTPStatusError) else str(e)
        print(f"[CLIQ bot {config.ZOHO_CLIQ_BOT}] no se pudo enviar a {', '.join(emails)}: {detalle}")
        return False


def enviar_cliq(email: str, texto: str) -> bool:
    """Envía un mensaje del bot al usuario `email` (misma firma de antes para los módulos que lo usan)."""
    return enviar_cliq_varios([email], texto)
