"""Centro de avisos (Cliq) · Rosember, 20-oct-2026: página /design/avisos para los admins de Design. Ver services_design_avisos."""
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import services_design as sd
from .. import services_design_avisos as sa
from ..database import get_db
from ..main_templates import templates
from ..models import Empleado
from ..models_design import DesignCliqMensaje
from .design_schedule import _RutaDesign, require_admin

class _RutaAvisos(_RutaDesign):
    """Si algo falla sin control, la pantalla (solo admins) muestra la causa en vez de «error 500» y queda en el log."""

    def get_route_handler(self):
        original = super().get_route_handler()

        async def manejar(request):
            try:
                return await original(request)
            except HTTPException:
                raise
            except Exception as e:  # noqa: BLE001
                import logging
                from fastapi.responses import JSONResponse
                logging.getLogger("design.avisos").exception("Centro de avisos: %s %s", request.method, request.url.path)
                return JSONResponse({"detail": f"Error del servidor ({type(e).__name__}): {e}"[:500]}, status_code=500)
        return manejar


router = APIRouter(route_class=_RutaAvisos)
_ESTATICOS = Path(__file__).resolve().parent.parent / "static" / "design" / "avisos"
AVISOS_V = str(int(max((_ESTATICOS / f).stat().st_mtime for f in ("avisos.js", "avisos.css"))))


def _ahora():
    return sd.ahora_colombia().replace(tzinfo=None)


@router.get("/design/avisos")
def pagina_avisos(request: Request, user: Empleado = Depends(require_admin)):
    return templates.TemplateResponse(request, "design_avisos.html", {"user": user, "es_design": True, "avisos_v": AVISOS_V})


@router.get("/design/api/avisos")
def api_avisos(user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    return sa.todo(db)


@router.get("/design/api/avisos/historial")
def api_historial(mensaje_id: int | None = None, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    return sa.historial(db, mensaje_id)


class DestinoIn(BaseModel):
    tipo: str = "canal"
    valor: str = ""


class GrupoIn(BaseModel):
    id: int | None = None
    nombre: str = ""
    destinos: list[DestinoIn] = []


@router.post("/design/api/avisos/grupos")
def api_guardar_grupo(payload: GrupoIn, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    try:
        sa.guardar_grupo(db, payload.model_dump(), user.nombre_completo)
    except ValueError as e:
        db.rollback()
        raise HTTPException(400, str(e))
    return sa.todo(db)


@router.post("/design/api/avisos/grupos/{grupo_id}/eliminar")
def api_eliminar_grupo(grupo_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    sa.eliminar_grupo(db, grupo_id)
    return sa.todo(db)


class MensajeIn(BaseModel):
    id: int | None = None
    nombre: str = ""
    activo: bool = True
    bot: str = ""
    texto: str = ""
    disparador: str = "manual"
    progTipo: str = "una"
    progFecha: str = ""
    progHora: str = ""
    progDias: list[int] = []
    saltarFestivos: bool = True
    grupos: list[int] = []


@router.post("/design/api/avisos/mensajes")
def api_guardar_mensaje(payload: MensajeIn, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    try:
        m = sa.guardar_mensaje(db, payload.model_dump(), user.nombre_completo)
    except ValueError as e:
        db.rollback()
        raise HTTPException(400, str(e))
    return {**sa.todo(db), "guardado": m.id}


class ActivoIn(BaseModel):
    activo: bool


@router.post("/design/api/avisos/mensajes/{mensaje_id}/activo")
def api_activo(mensaje_id: int, payload: ActivoIn, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    if not sa.activar(db, mensaje_id, payload.activo, user.nombre_completo):
        raise HTTPException(404, "Ese mensaje ya no existe.")
    return sa.todo(db)


@router.post("/design/api/avisos/mensajes/{mensaje_id}/eliminar")
def api_eliminar_mensaje(mensaje_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    err = sa.eliminar_mensaje(db, mensaje_id)
    if err:
        raise HTTPException(400, err)
    return sa.todo(db)


@router.post("/design/api/avisos/mensajes/{mensaje_id}/duplicar")
def api_duplicar(mensaje_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    c = sa.duplicar(db, mensaje_id, user.nombre_completo)
    if not c:
        raise HTTPException(404, "Ese mensaje ya no existe.")
    return {**sa.todo(db), "guardado": c.id}


class VistaIn(BaseModel):
    texto: str = ""


@router.post("/design/api/avisos/vista-previa")
def api_vista_previa(payload: VistaIn, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    """El texto con las variables llenas con los valores de este momento (como saldría si se enviara ahora)."""
    return {"texto": sa.armar(payload.texto[:4000], sa.valores(db, _ahora()))}


class EnviarIn(BaseModel):
    prueba: bool = False   # True: solo a mí, por mensaje directo del bot


@router.post("/design/api/avisos/mensajes/{mensaje_id}/enviar")
def api_enviar(mensaje_id: int, payload: EnviarIn, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    m = db.get(DesignCliqMensaje, mensaje_id)
    if not m:
        raise HTTPException(404, "Ese mensaje ya no existe.")
    if payload.prueba:
        if not user.email:
            raise HTTPException(400, "Tu usuario no tiene correo: no se puede enviar la prueba.")
        res = sa.enviar(db, m, _ahora(), "prueba", user.nombre_completo, solo=("persona", user.email))
    else:
        if not sa._ids(m.grupos):
            raise HTTPException(400, "Este mensaje no tiene grupos: elige a dónde se envía.")
        res = sa.enviar(db, m, _ahora(), "manual", user.nombre_completo)
        if not res:
            raise HTTPException(400, "Los grupos de este mensaje no tienen canales ni personas.")
    return {"resultados": res}


class ProbarIn(BaseModel):
    tipo: str = "canal"
    valor: str = ""


@router.post("/design/api/avisos/probar-destino")
def api_probar_destino(payload: ProbarIn, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    if not payload.valor.strip():
        raise HTTPException(400, "Escribe el canal o el correo.")
    return sa.probar_destino(db, payload.tipo, payload.valor[:200], user.nombre_completo)


@router.post("/design/api/avisos/historial/{envio_id}/reintentar")
def api_reintentar(envio_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    r = sa.reintentar(db, envio_id, user.nombre_completo)
    if r is None:
        raise HTTPException(404, "Ese envío ya no existe.")
    return r
