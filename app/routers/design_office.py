"""Rutas de Nuvia Office (Design › Herramientas). Solo aprobadores y admins de Design (require_design_manager).
Se incluye desde routers/design_schedule.py (mismo router, mismo cupo de concurrencia)."""
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


@router.get("/design/office")
def pagina_office(request: Request, user: Empleado = Depends(require_design_manager)):
    return templates.TemplateResponse(request, "design_office.html", {"user": user, "es_design": True})


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
