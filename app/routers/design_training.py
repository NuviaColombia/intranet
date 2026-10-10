"""Training de Design: página, contenido, avance y modelos 3D. Se incluye desde routers/design_schedule.py (mismo router)."""
from pathlib import Path
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Empleado
from ..main_templates import templates
from .. import services_design_training as st
from .design_schedule import require_modulo, require_admin, _RutaDesign

router = APIRouter(route_class=_RutaDesign)

_ESTATICOS = Path(__file__).resolve().parent.parent / "static" / "training"


def _version() -> str:
    try:
        return str(int(max(f.stat().st_mtime for f in _ESTATICOS.rglob("*") if f.is_file() and "data" not in f.parts)))
    except (OSError, ValueError):
        return "1"


def _visible(user: Empleado = Depends(require_modulo("design_schedule"))) -> Empleado:
    if not st.puede_ver(user):
        raise HTTPException(403, "Training todavía no está disponible para tu usuario.")
    return user


@router.get("/design/training")
def pagina_training(request: Request, user: Empleado = Depends(_visible)):
    return templates.TemplateResponse(request, "design_training.html", {
        "user": user, "es_design": True, "version": _version(), "es_admin": st.es_admin(user)})


@router.get("/design/api/training/contenido")
def api_contenido(user: Empleado = Depends(_visible)):
    return st.contenido()


@router.get("/design/api/training/progreso")
def api_progreso(user: Empleado = Depends(_visible), db: Session = Depends(get_db)):
    return st.progreso(db, user)


class ProgresoIn(BaseModel):
    leccion: str = Field(max_length=60)
    completada: bool | None = None
    puntaje: int | None = None
    dato: str | None = Field(default=None, max_length=200)


@router.post("/design/api/training/progreso")
def api_progreso_guardar(payload: ProgresoIn, user: Empleado = Depends(_visible), db: Session = Depends(get_db)):
    try:
        return st.guardar_progreso(db, user, payload.leccion, payload.completada, payload.puntaje, payload.dato)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/design/api/training/modelos")
def api_modelos(user: Empleado = Depends(_visible), db: Session = Depends(get_db)):
    return st.modelos(db)


@router.get("/design/training/modelo/{slot}")
def api_modelo(slot: str, user: Empleado = Depends(_visible), db: Session = Depends(get_db)):
    m = st.modelo_datos(db, slot)
    if not m:
        raise HTTPException(404, "Ese espacio todavía no tiene modelo.")
    return Response(m[0], media_type=m[1], headers={"Cache-Control": "private, max-age=86400"})


@router.get("/design/api/training/admin")
def api_admin(user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    """Admins: espacios de modelos que piden las lecciones (con su estado) y el avance de cada persona."""
    subidos = {m["slot"]: m for m in st.modelos(db)}
    slots = [{**s, "modelo": subidos.get(s["slot"])} for s in st.slots_del_contenido()]
    return {"slots": slots, "equipo": st.resumen_equipo(db)}


@router.post("/design/api/training/modelos")
async def api_modelo_subir(slot: str = Form(...), archivo: UploadFile = File(...), user: Empleado = Depends(require_admin),
                           db: Session = Depends(get_db)):
    datos = await archivo.read(st.MAX_MODELO + 1)
    try:
        return st.modelo_guardar(db, user, slot.strip(), archivo.filename or "modelo", datos)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/design/api/training/modelos/{slot}/eliminar")
def api_modelo_eliminar(slot: str, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    if not st.modelo_eliminar(db, slot):
        raise HTTPException(404, "Ese espacio no tiene modelo.")
    return {"ok": True}


class AnotacionesIn(BaseModel):
    anotaciones: list[dict] = Field(default_factory=list, max_length=40)


@router.post("/design/api/training/modelos/{slot}/anotaciones")
def api_anotaciones(slot: str, payload: AnotacionesIn, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    try:
        return {"anotaciones": st.anotaciones_guardar(db, slot, payload.anotaciones)}
    except KeyError:
        raise HTTPException(404, "Sube primero el modelo.")
