"""Rutas de Nuvia Office (Design › Herramientas). Solo aprobadores y admins de Design (require_design_manager).
Se incluye desde routers/design_schedule.py (mismo router, mismo cupo de concurrencia)."""
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Empleado
from ..main_templates import templates
from .. import services_design_office as so
from .design_schedule import require_design_manager, _RutaDesign

router = APIRouter(route_class=_RutaDesign)


def _doc_o_error(fn):
    try:
        return fn()
    except KeyError:
        raise HTTPException(404, "El documento no existe.")
    except so.SinPermiso:
        raise HTTPException(403, "No tienes permiso sobre este documento.")
    except ValueError as e:
        raise HTTPException(400, str(e))


_ESTATICOS = Path(__file__).resolve().parent.parent / "static" / "office"


def _version_estaticos() -> str:
    """Versión de los archivos de Nuvia Office (la fecha del más reciente): así el navegador nunca usa una copia vieja."""
    try:
        return str(int(max(f.stat().st_mtime for f in _ESTATICOS.iterdir() if f.is_file())))
    except (OSError, ValueError):
        return "1"


@router.get("/design/office")
def pagina_office(request: Request, user: Empleado = Depends(require_design_manager)):
    return templates.TemplateResponse(request, "design_office.html", {"user": user, "es_design": True, "version": _version_estaticos(),
                                                                      "admin_plantillas": so.puede_administrar_plantillas(user)})


@router.get("/design/api/office/docs")
def api_listar(user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    return so.listar(db, user)


class DocNuevoIn(BaseModel):
    tipo: str = "word"
    titulo: str = Field("", max_length=255)
    contenido: str = ""
    ajustes: dict | None = None


@router.post("/design/api/office/docs")
def api_crear(payload: DocNuevoIn, user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    doc = _doc_o_error(lambda: so.crear(db, user, payload.tipo, payload.titulo, payload.contenido, payload.ajustes))
    return so.completo(db, doc, "dueño")


@router.get("/design/api/office/docs/{doc_id}")
def api_obtener(doc_id: int, user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    doc, p = _doc_o_error(lambda: so.obtener(db, doc_id, user))
    return so.completo(db, doc, p)


class DocGuardarIn(BaseModel):
    version: int
    titulo: str | None = Field(None, max_length=255)
    contenido: str | None = None
    ajustes: dict | None = None
    forzar: bool = False


@router.post("/design/api/office/docs/{doc_id}")
def api_guardar(doc_id: int, payload: DocGuardarIn, user: Empleado = Depends(require_design_manager),
                db: Session = Depends(get_db)):
    try:
        doc = _doc_o_error(lambda: so.guardar(db, doc_id, user, payload.version, payload.titulo, payload.contenido,
                                              payload.ajustes, payload.forzar))
    except so.Conflicto as c:
        return JSONResponse(status_code=409, content={
            "detail": f"{c.doc.actualizado_por or 'Otra ventana'} guardó este documento después de que lo abriste.",
            "version": c.doc.version, "actualizadoPor": c.doc.actualizado_por})
    return so.resumen(doc, so.permiso(db, doc, user))


@router.post("/design/api/office/docs/{doc_id}/eliminar")
def api_eliminar(doc_id: int, user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    _doc_o_error(lambda: so.eliminar(db, doc_id, user))
    return {"ok": True}


@router.post("/design/api/office/docs/{doc_id}/restaurar")
def api_restaurar(doc_id: int, user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    _doc_o_error(lambda: so.restaurar(db, doc_id, user))
    return {"ok": True}


@router.post("/design/api/office/docs/{doc_id}/borrar")
def api_borrar(doc_id: int, user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    _doc_o_error(lambda: so.borrar_definitivo(db, doc_id, user))
    return {"ok": True}


@router.post("/design/api/office/docs/{doc_id}/duplicar")
def api_duplicar(doc_id: int, user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    doc = _doc_o_error(lambda: so.duplicar(db, doc_id, user))
    return so.resumen(doc, "dueño")


@router.get("/design/api/office/personas")
def api_personas(user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    return so.personas(db, user)


class CompartirIn(BaseModel):
    empleadoId: int
    puedeEditar: bool = False


@router.post("/design/api/office/docs/{doc_id}/compartir")
def api_compartir(doc_id: int, payload: CompartirIn, user: Empleado = Depends(require_design_manager),
                  db: Session = Depends(get_db)):
    _doc_o_error(lambda: so.compartir(db, doc_id, user, payload.empleadoId, payload.puedeEditar))
    doc, p = so.obtener(db, doc_id, user)
    return so.completo(db, doc, p)["compartido"]


@router.post("/design/api/office/docs/{doc_id}/compartir/{empleado_id}/quitar")
def api_dejar_de_compartir(doc_id: int, empleado_id: int, user: Empleado = Depends(require_design_manager),
                           db: Session = Depends(get_db)):
    _doc_o_error(lambda: so.dejar_de_compartir(db, doc_id, user, empleado_id))
    doc, p = so.obtener(db, doc_id, user)
    return so.completo(db, doc, p)["compartido"]


# ---------- Plantillas (solo los admins las cargan, modifican y borran; todos las usan) ----------
class PlantillaIn(BaseModel):
    tipo: str = "word"
    titulo: str = Field("", max_length=255)
    descripcion: str = Field("", max_length=500)
    contenido: str = ""
    ajustes: dict | None = None
    miniatura: str = ""


class PlantillaGuardarIn(BaseModel):
    version: int
    titulo: str | None = Field(None, max_length=255)
    descripcion: str | None = Field(None, max_length=500)
    contenido: str | None = None
    ajustes: dict | None = None
    miniatura: str | None = None
    forzar: bool = False


@router.get("/design/api/office/plantillas")
def api_plantillas(user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    return {"plantillas": so.plantillas_listar(db), "puedeAdministrar": so.puede_administrar_plantillas(user), "huella": so.plantillas_huella(db)}


@router.get("/design/api/office/plantillas/huella")
def api_plantillas_huella(user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    """Las galerías abiertas preguntan cada pocos segundos si alguien creó, cambió o borró una plantilla."""
    return {"huella": so.plantillas_huella(db)}


@router.get("/design/api/office/plantillas/{pid}")
def api_plantilla(pid: int, user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    p = _doc_o_error(lambda: so.plantilla_obtener(db, pid))
    return so.plantilla_completa(p, user)


@router.post("/design/api/office/plantillas")
def api_plantilla_crear(payload: PlantillaIn, user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    p = _doc_o_error(lambda: so.plantilla_crear(db, user, payload.tipo, payload.titulo, payload.descripcion, payload.contenido,
                                                payload.ajustes, payload.miniatura))
    return so.plantilla_completa(p, user)


@router.post("/design/api/office/plantillas/{pid}")
def api_plantilla_guardar(pid: int, payload: PlantillaGuardarIn, user: Empleado = Depends(require_design_manager),
                          db: Session = Depends(get_db)):
    try:
        p = _doc_o_error(lambda: so.plantilla_guardar(db, pid, user, payload.version, payload.titulo, payload.descripcion,
                                                      payload.contenido, payload.ajustes, payload.miniatura, payload.forzar))
    except so.Conflicto as c:
        return JSONResponse(status_code=409, content={
            "detail": f"{c.doc.actualizado_por or 'Otra persona'} guardó esta plantilla después de que la abriste.", "version": c.doc.version})
    return so.plantilla_resumen(p, con_miniatura=False)


@router.post("/design/api/office/plantillas/{pid}/eliminar")
def api_plantilla_eliminar(pid: int, user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    _doc_o_error(lambda: so.plantilla_eliminar(db, pid, user))
    return {"ok": True}


class UsarPlantillaIn(BaseModel):
    titulo: str | None = Field(None, max_length=255)


@router.post("/design/api/office/plantillas/{pid}/usar")
def api_plantilla_usar(pid: int, payload: UsarPlantillaIn, user: Empleado = Depends(require_design_manager),
                       db: Session = Depends(get_db)):
    doc = _doc_o_error(lambda: so.plantilla_usar(db, pid, user, payload.titulo))
    return so.completo(db, doc, "dueño")
