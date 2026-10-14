"""Notificaciones push (Web Push) de Design: avisos del sistema operativo aunque la intranet esté cerrada.

- Cada navegador que acepta se guarda en design_push_suscripciones (una persona puede tener varios).
- Claves VAPID: las variables de entorno DESIGN_PUSH_VAPID_PRIVATE (PEM o base64url) y DESIGN_PUSH_VAPID_PUBLIC. Si no
  están, se generan una sola vez y quedan en design_conexion_reglas (tipo sistema, clave push_vapid).
- enviar(empleado_ids, titulo, cuerpo, url) es la única puerta para mandar avisos: las reglas de qué se envía y a quién
  se agregan después (pedido por Rosember el 12-oct-2026: por ahora solo el sistema).
"""
import base64
import json
import logging
import os
import threading
from datetime import datetime
from sqlalchemy.orm import Session
from .models import Empleado
from .models_design import DesignPushSuscripcion, DesignConexionRegla

log = logging.getLogger(__name__)
CONTACTO = os.environ.get("DESIGN_PUSH_CONTACTO", "mailto:rosember@nuviasmiles.com")
MAX_FALLOS = 5          # tras estos fallos seguidos (sin ser "ya no existe") se deja de intentar
_claves = {"v": None}


def _b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def claves(db: Session) -> dict:
    """{"publica": base64url para el navegador, "privada_pem": bytes}. Del entorno o generadas una vez y guardadas."""
    if _claves["v"]:
        return _claves["v"]
    from py_vapid import Vapid01
    from cryptography.hazmat.primitives import serialization
    priv_env, pub_env = os.environ.get("DESIGN_PUSH_VAPID_PRIVATE", "").strip(), os.environ.get("DESIGN_PUSH_VAPID_PUBLIC", "").strip()
    if priv_env and pub_env:
        v = Vapid01.from_pem(priv_env.encode()) if "BEGIN" in priv_env else Vapid01.from_raw(priv_env.encode())
        _claves["v"] = {"publica": pub_env, "privada_pem": v.private_pem(), "origen": "entorno"}
        return _claves["v"]
    fila = db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == "sistema", DesignConexionRegla.clave == "push_vapid").first()
    if not fila:
        v = Vapid01()
        v.generate_keys()
        pub = _b64url(v.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))
        fila = DesignConexionRegla(tipo="sistema", clave="push_vapid", creado_por="Sistema",
                                   valor=json.dumps({"publica": pub, "privada_pem": v.private_pem().decode()}))
        db.add(fila)
        try:
            db.commit()
        except Exception:   # otro proceso las generó al mismo tiempo: se usan esas
            db.rollback()
            fila = db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == "sistema", DesignConexionRegla.clave == "push_vapid").first()
    d = json.loads(fila.valor)
    _claves["v"] = {"publica": d["publica"], "privada_pem": d["privada_pem"].encode(), "origen": "base de datos"}
    return _claves["v"]


def suscribir(db: Session, user: Empleado, sub: dict, navegador: str = "") -> DesignPushSuscripcion:
    endpoint = str(sub.get("endpoint") or "").strip()
    llaves = sub.get("keys") or {}
    if not endpoint.startswith("https://") or not llaves.get("p256dh") or not llaves.get("auth"):
        raise ValueError("Suscripción inválida.")
    if len(endpoint) > 2000:
        raise ValueError("Suscripción inválida.")
    s = db.query(DesignPushSuscripcion).filter(DesignPushSuscripcion.endpoint == endpoint).first()
    if not s:
        s = DesignPushSuscripcion(endpoint=endpoint)
        db.add(s)
    s.empleado_id, s.p256dh, s.auth, s.navegador, s.fallos = user.id, str(llaves["p256dh"])[:200], str(llaves["auth"])[:100], (navegador or "")[:200], 0
    db.commit()
    return s


def desuscribir(db: Session, user: Empleado, endpoint: str) -> bool:
    n = db.query(DesignPushSuscripcion).filter(DesignPushSuscripcion.endpoint == endpoint, DesignPushSuscripcion.empleado_id == user.id).delete()
    db.commit()
    return bool(n)


def mis_suscripciones(db: Session, user: Empleado) -> int:
    return db.query(DesignPushSuscripcion).filter(DesignPushSuscripcion.empleado_id == user.id).count()


def _enviar_una(s: DesignPushSuscripcion, cuerpo: str, privada_pem: bytes) -> str:
    """'ok' | 'borrar' (la suscripción ya no existe) | 'error'"""
    from pywebpush import webpush, WebPushException
    from py_vapid import Vapid02   # RFC 8292 ("vapid t=..., k=..."): lo exige Apple (iPhone); Chrome y Firefox también lo aceptan
    try:
        webpush(subscription_info={"endpoint": s.endpoint, "keys": {"p256dh": s.p256dh, "auth": s.auth}}, data=cuerpo,
                vapid_private_key=Vapid02.from_pem(privada_pem), vapid_claims={"sub": CONTACTO}, ttl=3600, timeout=10)
        return "ok"
    except WebPushException as e:
        codigo = getattr(getattr(e, "response", None), "status_code", None)
        if codigo in (404, 410):
            return "borrar"
        log.warning("push falló (%s): %s", codigo, str(e)[:200])
        return "error"
    except Exception as e:  # noqa: BLE001
        log.warning("push falló: %s", str(e)[:200])
        return "error"


def enviar(db: Session, empleado_ids: list[int], titulo: str, cuerpo: str = "", url: str = "/design/inicio", etiqueta: str = "",
           fijo: bool = False) -> dict:
    """Envía un aviso a todos los navegadores suscritos de esas personas. Devuelve {enviados, fallidos, borrados, sinSuscripcion}.
    `fijo`: el aviso se queda en pantalla hasta que la persona lo cierre (no se oculta solo a los segundos).
    Es síncrono: para avisos desde una petición normal usar enviar_en_segundo_plano."""
    ids = sorted({int(i) for i in empleado_ids if i})
    subs = db.query(DesignPushSuscripcion).filter(DesignPushSuscripcion.empleado_id.in_(ids), DesignPushSuscripcion.fallos < MAX_FALLOS).all() if ids else []
    datos = json.dumps({"titulo": (titulo or "Nuvia Design")[:120], "cuerpo": (cuerpo or "")[:300], "url": url if str(url).startswith("/") else "/design/inicio",
                        "etiqueta": (etiqueta or "")[:60], "fijo": bool(fijo)}, ensure_ascii=False)
    privada = claves(db)["privada_pem"]
    res = {"enviados": 0, "fallidos": 0, "borrados": 0, "sinSuscripcion": len(set(ids) - {s.empleado_id for s in subs})}
    for s in subs:
        r = _enviar_una(s, datos, privada)
        if r == "ok":
            s.ultimo_envio, s.fallos = datetime.utcnow(), 0
            res["enviados"] += 1
        elif r == "borrar":
            db.delete(s)
            res["borrados"] += 1
        else:
            s.fallos = (s.fallos or 0) + 1
            res["fallidos"] += 1
    db.commit()
    return res


def enviar_en_segundo_plano(empleado_ids: list[int], titulo: str, cuerpo: str = "", url: str = "/design/inicio", etiqueta: str = "",
                            fijo: bool = False) -> None:
    """Igual que enviar(), sin hacer esperar a quien provocó el aviso (hilo aparte con su propia sesión de BD)."""
    from .database import SessionLocal

    def correr():
        db = SessionLocal()
        try:
            enviar(db, empleado_ids, titulo, cuerpo, url, etiqueta, fijo)
        except Exception:  # noqa: BLE001
            log.exception("push en segundo plano")
        finally:
            db.close()
    threading.Thread(target=correr, daemon=True).start()


def estado(db: Session) -> dict:
    """Para Parámetros (admins): cuántos navegadores y personas tienen avisos activados."""
    from sqlalchemy import func
    total = db.query(func.count(DesignPushSuscripcion.id)).scalar() or 0
    personas = db.query(func.count(func.distinct(DesignPushSuscripcion.empleado_id))).scalar() or 0
    filas = (db.query(Empleado.nombres, Empleado.apellidos, func.count(DesignPushSuscripcion.id))
             .join(DesignPushSuscripcion, DesignPushSuscripcion.empleado_id == Empleado.id)
             .group_by(Empleado.id, Empleado.nombres, Empleado.apellidos).order_by(Empleado.nombres).all())
    return {"navegadores": total, "personas": personas, "origenClaves": claves(db)["origen"],
            "lista": [{"nombre": f"{n} {a}".strip(), "navegadores": c} for n, a, c in filas]}
