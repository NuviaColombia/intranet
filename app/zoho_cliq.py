"""Envío de mensajes directos (DM) por Zoho Cliq, vía el Incoming Webhook de un Bot.

El webhook solo reenvía el JSON al handler del Bot en Cliq (escrito en Deluge), que es quien
llama a zoho.cliq.postToUser(email, texto) -- ver instrucciones de configuración en el README.
"""
import httpx
from . import config


def enviar_cliq(email: str, texto: str) -> bool:
    """Envía un DM de Cliq al usuario `email`. Devuelve False (sin lanzar) si no está configurado."""
    if not (config.CLIQ_BOT_WEBHOOK_URL and email):
        print(f"[CLIQ deshabilitado] Para: {email} | Texto: {texto}")
        return False
    try:
        r = httpx.post(config.CLIQ_BOT_WEBHOOK_URL, json={"email": email, "text": texto}, timeout=20)
        r.raise_for_status()
        return True
    except Exception as e:
        print(f"[CLIQ error] {email}: {e}")
        return False
