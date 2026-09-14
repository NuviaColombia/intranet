from pathlib import Path
from fastapi.templating import Jinja2Templates
from .logos import logo_para, logos_disponibles
from .database import SessionLocal
from .aprobaciones_globales import resumen_pendientes

templates = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))
templates.env.globals["logo_empresa"] = logo_para
templates.env.globals["logos_disponibles"] = logos_disponibles


def _resumen_aprobaciones(user):
    if not user or user.rol not in ("aprobador", "admin"):
        return None
    db = SessionLocal()
    try:
        return resumen_pendientes(db, user)
    finally:
        db.close()


templates.env.globals["resumen_aprobaciones"] = _resumen_aprobaciones
