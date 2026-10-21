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


# ---------- Aviso: Support en turno (al empezar cada turno, en los grupos de Parámetros › Support Time) ----------
# Pedido por Rosember el 20-oct-2026: los grupos deben saber qué Support está en turno ahora. Nombre, turno y horario
# (como la tarjeta de Inicio, sin días ni próximo cambio). Solo los días del turno (Parámetros › Support Time)
# que no son festivos. Lo revisa un hilo cada minuto (arrancar_avisos_turno); la marca en design_conexion_reglas evita
# repetirlo aunque Render tenga dos instancias.
VENTANA_TURNO_MIN = 30   # si el servidor estaba reiniciando a la hora exacta, avisa dentro de esta media hora


def canales_turno(texto: str | None) -> list[str]:
    vistos, out = set(), []
    for x in (texto or "").replace(",", "\n").splitlines():
        x = x.strip().lstrip("#").strip()
        if x and x.lower() not in vistos:
            vistos.add(x.lower())
            out.append(x)
    return out


def aviso_en_turno(st: dict, n: int) -> str | None:
    """Texto del aviso para el turno `n` (st = services_design_support.estado)."""
    p = next((x for x in st.get("personas") or [] if x["turnoActual"]["n"] == n), None)
    if not p:
        return None
    t = p["turnoActual"]
    if p.get("cubierto"):
        h = p["cubierto"]["hasta"]
        quien = f"*{p['cubierto']['nombre']}* — {t['nombre']} (cubre a {p['nombre']} hasta el {h[8:10]}/{h[5:7]})"
    else:
        quien = f"*{p['nombre']}* — {t['nombre']}"
    # Rosember, 20-oct-2026: título «Support Designer en turno»; sin los días ni la línea del próximo cambio
    return "\n".join(["🛟 *Support Designer en turno*", quien, f"🕘 {t['horaTxt']}"])


def texto_en_turno(db: Session, ahora) -> str | None:
    from . import services_design_support as ss
    d = ss.en_turno(db, ahora)
    return aviso_en_turno(ss.estado(db, ahora.date()), d["turno"]) if d else None


def enviar_a_grupos(canales: list[str], texto: str) -> list[dict]:
    out = []
    with httpx.Client(timeout=12) as cliente:
        for k in canales:
            ok, det = enviar_canal(k, texto, cliente)
            out.append({"canal": k, "ok": ok, "detalle": det})
    return out


def avisar_turno_si_corresponde(db: Session, ahora) -> int | None:
    """Si acaba de empezar un turno de Support (hace menos de VENTANA_TURNO_MIN) y no se ha avisado, lo publica en los
    grupos. Devuelve el turno avisado, o None."""
    from . import services_design as sd
    from . import services_design_support as ss
    from .models_design import DesignConexionRegla
    c = ss.config(db)
    canales = canales_turno(c.cliq_canales)
    if not (canales and configurado() and ss.listo(c)):
        return None
    minuto = ahora.hour * 60 + ahora.minute
    for n in (1, 2):
        ini = ss._min(c.turno1_inicio if n == 1 else c.turno2_inicio)
        if ini is None or not 0 <= minuto - ini < VENTANA_TURNO_MIN:
            continue
        hoy = ahora.date()
        dias = {int(x) for x in (c.dias or "").split(",") if x.strip().isdigit()}
        if hoy.weekday() not in dias or hoy in sd.festivos(db):
            return None
        clave = f"support_en_turno_{hoy.isoformat()}_{n}"
        if db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == "sistema", DesignConexionRegla.clave == clave).first():
            return None
        try:
            db.add(DesignConexionRegla(tipo="sistema", clave=clave, creado_por="Sistema"))
            db.commit()   # la marca primero: la otra instancia de Render (si hay) ya no lo repite
        except IntegrityError:
            db.rollback()
            return None
        texto = aviso_en_turno(ss.estado(db, hoy), n)
        if texto:
            for r in enviar_a_grupos(canales, texto):
                log.info("Support en turno → %s: %s", r["canal"], r["detalle"])
        return n
    return None


_hilo_turno = {"t": None}


def arrancar_avisos_turno() -> None:
    """Hilo que cada minuto revisa si empezó un turno de Support (no hay tareas programadas en el servidor)."""
    if _hilo_turno["t"] is not None or os.getenv("DESIGN_SIN_AVISOS_TURNO"):
        return

    def _bucle():
        from . import services_design as sd
        from .database import SessionLocal
        while True:
            time.sleep(60)
            db = SessionLocal()
            try:
                avisar_turno_si_corresponde(db, sd.ahora_colombia())
            except Exception:  # noqa: BLE001  un fallo nunca debe detener el hilo
                db.rollback()
                log.exception("Support en turno: no se pudo revisar el aviso")
            finally:
                db.close()
    _hilo_turno["t"] = threading.Thread(target=_bucle, daemon=True, name="design-support-turno")
    _hilo_turno["t"].start()
