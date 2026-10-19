from pathlib import Path
from fastapi.templating import Jinja2Templates
from .logos import logo_para, logos_disponibles
from .database import SessionLocal
from .aprobaciones_globales import resumen_pendientes
from .formato import nombre_propio, SIGLAS, MINUSCULAS
from .produccion import SUBMODULOS_PRODUCCION, resumen_submodulos_produccion
from .sst import puede_sst
from .acceso_secciones import SECCIONES

templates = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))
templates.env.globals["logo_empresa"] = logo_para
templates.env.globals["logos_disponibles"] = logos_disponibles
templates.env.filters["nombre_propio"] = nombre_propio
templates.env.globals["formato_siglas"] = SIGLAS
templates.env.globals["formato_minusculas"] = MINUSCULAS
templates.env.globals["submodulos_produccion"] = SUBMODULOS_PRODUCCION
templates.env.globals["resumen_submodulos_produccion"] = resumen_submodulos_produccion
templates.env.globals["secciones_acceso"] = SECCIONES
from .acceso_produccion import es_admin_produccion  # noqa: E402
templates.env.globals["es_admin_produccion"] = es_admin_produccion


def _resumen_aprobaciones(user):
    if not user or user.rol not in ("aprobador", "admin", "superadmin"):
        return None
    db = SessionLocal()
    try:
        return resumen_pendientes(db, user)
    finally:
        db.close()


templates.env.globals["resumen_aprobaciones"] = _resumen_aprobaciones


def _tema_design(user) -> str:
    """Modo de Design de la persona: 'oscuro' o 'claro' (por defecto claro)."""
    if not user:
        return "claro"
    from .models_design import DesignPreferencia
    db = SessionLocal()
    try:
        p = db.get(DesignPreferencia, user.id)
        return "oscuro" if p and p.tema == "oscuro" else "claro"
    except Exception:
        return "claro"
    finally:
        db.close()


templates.env.globals["tema_design"] = _tema_design


def _ve_mural(user) -> bool:
    from .routers.design_mural import ve_mural
    return ve_mural(user)


templates.env.globals["ve_mural"] = _ve_mural


def _ve_calendario_people(user) -> bool:
    """People: Pamela Manzur y Nicol Ardila tienen el Calendario de Design en su menú (Rosember, 19-oct-2026)."""
    from .services_design_calendario import es_people_calendario
    return es_people_calendario(user)


templates.env.globals["ve_calendario_people"] = _ve_calendario_people


def _version_oscuro() -> str:
    """Versión de las hojas del modo oscuro (cambia con su contenido: el navegador no usa una copia vieja)."""
    import hashlib
    from pathlib import Path
    h = hashlib.md5()
    for n in ("oscuro_auto.css", "oscuro.css", "push.js", "vivo.js", "asignaciones.js"):
        try:
            h.update((Path(__file__).resolve().parent / "static" / "design" / n).read_bytes())
        except OSError:
            pass
    return h.hexdigest()[:10]


templates.env.globals["ds_estaticos_v"] = _version_oscuro()
templates.env.globals["puede_sst"] = puede_sst
