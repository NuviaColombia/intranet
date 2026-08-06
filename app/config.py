import os
from dotenv import load_dotenv

load_dotenv()

SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-inseguro")
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
