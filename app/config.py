import os
from dotenv import load_dotenv

load_dotenv()

SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-inseguro")
if SECRET_KEY in ("", "dev-secret-inseguro") and os.getenv("RENDER"):
    # Con la clave por defecto cualquiera podría falsificar cookies de sesión. No se bloquea el arranque para no
    # tumbar la intranet, pero queda como alerta visible en el log de Render.
    print("ALERTA DE SEGURIDAD: falta (o está vacía) la variable SECRET_KEY en Render; la sesión usa una clave conocida. "
          "Configúrala en Environment.", flush=True)
BASE_URL = os.getenv("BASE_URL", "http://localhost:8000").rstrip("/")
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./permisos.db")

ZOHO_REGION = os.getenv("ZOHO_REGION", "com")
ZOHO_ACCOUNTS_URL = f"https://accounts.zoho.{ZOHO_REGION}"
ZOHO_MAIL_API = f"https://mail.zoho.{ZOHO_REGION}"

ZOHO_CLIENT_ID = os.getenv("ZOHO_CLIENT_ID", "")
ZOHO_CLIENT_SECRET = os.getenv("ZOHO_CLIENT_SECRET", "")

ZOHO_MAIL_CLIENT_ID = os.getenv("ZOHO_MAIL_CLIENT_ID", "")
ZOHO_MAIL_CLIENT_SECRET = os.getenv("ZOHO_MAIL_CLIENT_SECRET", "")
ZOHO_MAIL_REFRESH_TOKEN = os.getenv("ZOHO_MAIL_REFRESH_TOKEN", "")
MAIL_FROM = os.getenv("MAIL_FROM", "")

ADMIN_EMAILS = [e.strip().lower() for e in os.getenv("ADMIN_EMAILS", "").split(",") if e.strip()]

ZOHO_CLIQ_CLIENT_ID = os.getenv("ZOHO_CLIQ_CLIENT_ID", "")
ZOHO_CLIQ_CLIENT_SECRET = os.getenv("ZOHO_CLIQ_CLIENT_SECRET", "")
ZOHO_CLIQ_REFRESH_TOKEN = os.getenv("ZOHO_CLIQ_REFRESH_TOKEN", "")
# Nombre único del bot de Cliq que envía TODOS los mensajes de la intranet (ej. "Nuvia Colombia Bot")
ZOHO_CLIQ_BOT = os.getenv("ZOHO_CLIQ_BOT", "").strip()
