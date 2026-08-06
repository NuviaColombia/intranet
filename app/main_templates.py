from pathlib import Path
from fastapi.templating import Jinja2Templates
from .logos import logo_para, logos_disponibles

templates = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))
templates.env.globals["logo_empresa"] = logo_para
templates.env.globals["logos_disponibles"] = logos_disponibles
