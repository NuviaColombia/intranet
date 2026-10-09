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


def enviar_canal(canal: str, texto: str, cliente: httpx.Client | None = None) -> tuple[bool, str]:
    """Publica `texto` en el canal (Unique Name) con el bot. Nunca lanza: devuelve (ok, detalle) para ver qué respondió Zoho."""
    if not configurado():
        return False, "Falta configurar el token de Cliq en Render (DESIGN_CLIQ_WEBHOOK_TOKEN o DESIGN_CLIQ_REFRESH_TOKEN)."
    if not canal or not texto:
        return False, "Falta el canal o el texto."
    propio = cliente is None
    cliente = cliente or httpx.Client(timeout=12)
    try:
        base = f"https://cliq.zoho.{_region()}/api/v2/channelsbyname/{canal}/message"
        params, headers = {"bot_unique_name": bot()}, {}
        if os.getenv("DESIGN_CLIQ_WEBHOOK_TOKEN"):
            params["zapikey"] = os.getenv("DESIGN_CLIQ_WEBHOOK_TOKEN")
        else:
            headers["Authorization"] = f"Zoho-oauthtoken {_access_token(cliente)}"
        r = cliente.post(base, params=params, headers=headers, json={"text": texto})
        if r.status_code in (200, 201, 204):
            return True, "Enviado."
        return False, f"Cliq respondió {r.status_code}: {r.text[:300]}"
    except Exception as e:  # noqa: BLE001  nunca debe romper la página que lo dispara
        return False, f"{type(e).__name__}: {e}"[:300]
    finally:
        if propio:
            cliente.close()


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


def avisar_cambio_si_corresponde(db: Session, hoy: date) -> bool:
    """Si hoy (o en los últimos días de la semana del cambio) hubo cambio de turno y todavía no se avisó, lo publica en el
    canal una sola vez. No hay tarea programada: se revisa cuando alguien abre Inicio o consulta Support Time. La marca
    (tipo "sistema") evita avisar dos veces, aunque dos personas entren a la vez. Devuelve True si lanzó el aviso."""
    from . import services_design_support as ss
    from .models_design import DesignConexionRegla
    if not configurado():
        return False
    c = ss.config(db)
    if not ss.listo(c):
        return False
    ult = ss.proximo_cambio(c, hoy) - timedelta(days=7 * max(1, c.semanas))   # el cambio más reciente (hoy o antes)
    if ult < c.ref_fecha or (hoy - ult).days > 6:   # antes de la fecha de referencia no hubo cambio; pasada la semana ya no se avisa
        return False
    clave = f"support_cambio_{ult.isoformat()}"
    if db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == "sistema", DesignConexionRegla.clave == clave).first():
        return False
    try:
        db.add(DesignConexionRegla(tipo="sistema", clave=clave, creado_por="Sistema"))
        db.commit()   # la marca va primero: si otra petición llegó antes, esta falla y no repite el aviso
    except IntegrityError:
        db.rollback()
        return False
    texto = aviso_cambio_turno(ss.estado(db, hoy), ss.fecha_txt(ult))

    def _enviar():
        ok, detalle = enviar_canal(canal_support(), texto)
        log.info("Aviso de cambio de turno de Support → %s: %s", "ok" if ok else "falló", detalle)
    threading.Thread(target=_enviar, daemon=True).start()   # no demora la página que lo disparó
    return True
