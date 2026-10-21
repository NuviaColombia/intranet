"""Avisos de Design a canales de Zoho Cliq, enviados por el bot "Anuncios Design".
Vive dentro de Design y es independiente de los mensajes directos del resto de la plataforma (no usa su refresh token).

Variables de entorno (Render):
  DESIGN_CLIQ_BOT            Unique Name del bot (por defecto: anunciosdesign).
  DESIGN_CLIQ_CANAL_SUPPORT  Unique Name del canal donde se avisa el cambio de turno de Support
                             (por defecto: supportnuviacolombiacom).
Permiso de Zoho (una de las dos formas; si no hay ninguna, los avisos simplemente no se envían):
  DESIGN_CLIQ_WEBHOOK_TOKEN  Token de webhook de Cliq (Bots y herramientas › Tokens de webhook).
  DESIGN_CLIQ_REFRESH_TOKEN  Refresh token con los permisos ZohoCliq.Webhooks.CREATE y ZohoCliq.BotMessages.CREATE;
                             usa el mismo Client ID / Secret del Self Client (ZOHO_CLIQ_CLIENT_ID / _SECRET).
Nunca se escriben tokens en el código ni en el repositorio."""
import logging
import os
import threading
import time
from datetime import date, timedelta
import httpx
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

log = logging.getLogger("design.cliq")
_TOKEN: dict = {"v": "", "hasta": 0.0}


def _region() -> str:
    return os.getenv("ZOHO_REGION", "com")


def bot() -> str:
    return (os.getenv("DESIGN_CLIQ_BOT") or "anunciosdesign").strip()


def canal_support() -> str:
    return (os.getenv("DESIGN_CLIQ_CANAL_SUPPORT") or "supportnuviacolombiacom").strip()


def configurado() -> bool:
    return bool(os.getenv("DESIGN_CLIQ_WEBHOOK_TOKEN") or (os.getenv("DESIGN_CLIQ_REFRESH_TOKEN") and os.getenv("ZOHO_CLIQ_CLIENT_ID")
                                                          and os.getenv("ZOHO_CLIQ_CLIENT_SECRET")))


def _access_token(cliente: httpx.Client) -> str:
    """Access token de Zoho a partir del refresh token (se guarda unos 50 minutos)."""
    if _TOKEN["v"] and time.time() < _TOKEN["hasta"]:
        return _TOKEN["v"]
    r = cliente.post(f"https://accounts.zoho.{_region()}/oauth/v2/token", data={
        "refresh_token": os.getenv("DESIGN_CLIQ_REFRESH_TOKEN", ""), "client_id": os.getenv("ZOHO_CLIQ_CLIENT_ID", ""),
        "client_secret": os.getenv("ZOHO_CLIQ_CLIENT_SECRET", ""), "grant_type": "refresh_token"})
    tok = (r.json() or {}).get("access_token") if r.status_code == 200 else None
    if not tok:
        raise RuntimeError(f"Zoho no entregó el access token ({r.status_code}): {r.text[:200]}")
    _TOKEN["v"], _TOKEN["hasta"] = tok, time.time() + 3000
    return tok


def _publicar(url: str, cuerpo: dict, bot_nombre: str | None, cliente: httpx.Client | None) -> tuple[bool, str]:
    if not configurado():
        return False, "Falta configurar el token de Cliq en Render (DESIGN_CLIQ_WEBHOOK_TOKEN o DESIGN_CLIQ_REFRESH_TOKEN)."
    propio = cliente is None
    cliente = cliente or httpx.Client(timeout=12)
    try:
        params, headers = {"bot_unique_name": (bot_nombre or "").strip() or bot()}, {}
        if os.getenv("DESIGN_CLIQ_WEBHOOK_TOKEN"):
            params["zapikey"] = os.getenv("DESIGN_CLIQ_WEBHOOK_TOKEN")
        else:
            headers["Authorization"] = f"Zoho-oauthtoken {_access_token(cliente)}"
        r = cliente.post(url, params=params, headers=headers, json=cuerpo)
        if r.status_code in (200, 201, 204):
            return True, "Enviado."
        return False, f"Cliq respondió {r.status_code}: {r.text[:300]}"
    except Exception as e:  # noqa: BLE001  nunca debe romper la página que lo dispara
        return False, f"{type(e).__name__}: {e}"[:300]
    finally:
        if propio:
            cliente.close()


def enviar_canal(canal: str, texto: str, cliente: httpx.Client | None = None, bot_nombre: str | None = None) -> tuple[bool, str]:
    """Publica `texto` en el canal (Unique Name) con el bot. Nunca lanza: devuelve (ok, detalle) para ver qué respondió Zoho."""
    if not canal or not texto:
        return False, "Falta el canal o el texto."
    return _publicar(f"https://cliq.zoho.{_region()}/api/v2/channelsbyname/{canal}/message", {"text": texto}, bot_nombre, cliente)


def enviar_persona(correo: str, texto: str, cliente: httpx.Client | None = None, bot_nombre: str | None = None) -> tuple[bool, str]:
    """Mensaje directo del bot a una persona (correo de Zoho). Centro de avisos, 20-oct-2026."""
    if not correo or not texto:
        return False, "Falta el correo o el texto."
    b = (bot_nombre or "").strip() or bot()
    return _publicar(f"https://cliq.zoho.{_region()}/api/v2/bots/{b}/message", {"text": texto, "userids": correo}, b, cliente)


# ---------- Aviso: cambio de turno de Support ----------

def aviso_cambio_turno(st: dict, fecha_txt: str) -> str:
    """Mensaje del cambio de turno: quién queda en cada turno y el próximo cambio (st = services_design_support.estado)."""
    lineas = [f"🔄 *Cambio de turno de Support* — {fecha_txt}"]
    for p in sorted(st["personas"], key=lambda x: x["turnoActual"]["n"]):
        t = p["turnoActual"]
        extra = f" (cubre {p['cubierto']['nombre']} hasta el {p['cubierto']['hasta'][8:10]}/{p['cubierto']['hasta'][5:7]})" if p.get("cubierto") else ""
        lineas.append(f"• {t['nombre']} ({t['horaTxt']}): {p['nombre']}{extra}")
    if st.get("proximoCambioTxt"):
        lineas.append(f"Próximo cambio: {st['proximoCambioTxt']}")
    return "\n".join(lineas)
