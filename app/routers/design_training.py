"""Training de Design: página, contenido, avance y modelos 3D. Se incluye desde routers/design_schedule.py (mismo router)."""
from pathlib import Path
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
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
def api_contenido(borrador: int = 0, user: Empleado = Depends(_visible), db: Session = Depends(get_db)):
    """Lo publicado. Los admins con ?borrador=1 ven además lo que están editando (sin publicar) y el estado de cada módulo."""
    if borrador and st.es_admin(user):
        return {**st.contenido(db, borrador=True), "editor": st.editor_resumen(db)}
    return st.contenido(db)


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


@router.get("/design/api/training/lideres")
def api_lideres(user: Empleado = Depends(_visible), db: Session = Depends(get_db)):
    return st.lideres(db)


class LiderIn(BaseModel):
    empleadoId: int
    cargoEs: str = Field("", max_length=80)
    cargoEn: str = Field("", max_length=80)


@router.post("/design/api/training/lideres/{area}")
def api_lider_guardar(area: str, payload: LiderIn, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    try:
        st.lider_guardar(db, user, area, payload.empleadoId, payload.cargoEs, payload.cargoEn)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return st.lideres(db)


@router.post("/design/api/training/lideres/{area}/quitar")
def api_lider_quitar(area: str, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    st.lider_quitar(db, area)
    return st.lideres(db)


@router.get("/design/api/training/modelos")
def api_modelos(user: Empleado = Depends(_visible), db: Session = Depends(get_db)):
    return st.modelos(db)


@router.get("/design/training/modelo/{slot}")
def api_modelo(slot: str, user: Empleado = Depends(_visible), db: Session = Depends(get_db)):
    m = st.modelo_datos(db, slot)
    if not m:
        incluido = st.visor_incluido(slot)
        if incluido:
            # ya viene comprimido y con el script de pestañas; se entrega tal cual (el navegador lo descomprime)
            return FileResponse(incluido, media_type="text/html; charset=utf-8", headers={
                "Content-Encoding": "gzip", "Cache-Control": "private, max-age=86400",
                "Content-Security-Policy": "sandbox allow-scripts allow-same-origin allow-downloads allow-modals"})
        raise HTTPException(404, "Ese espacio todavía no tiene modelo.")
    if m[1].startswith("text/html"):
        # Visor de caso exportado (HTML autónomo): se aísla (sandbox) y se le agrega la selección de pestaña por #rx / #changes
        cuerpo = m[0]
        i = cuerpo.rfind(b"</body>")
        extra = (b"<script>(function(){function go(){var c=(location.hash||'').slice(1);if(!c)return;var b=document.querySelector('button[data-context=\"'+c+'\"]');"
                 b"if(b)b.click();}window.addEventListener('load',function(){setTimeout(go,900);});window.addEventListener('hashchange',go);})();</script>")
        cuerpo = cuerpo[:i] + extra + cuerpo[i:] if i >= 0 else cuerpo + extra
        return Response(cuerpo, media_type=m[1], headers={"Cache-Control": "private, max-age=3600",
                                                          "Content-Security-Policy": "sandbox allow-scripts allow-same-origin allow-downloads allow-modals"})
    return Response(m[0], media_type=m[1], headers={"Cache-Control": "private, max-age=86400"})


@router.get("/design/api/training/admin")
def api_admin(user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    """Admins: espacios de modelos que piden las lecciones (con su estado) y el avance de cada persona."""
    subidos = {m["slot"]: m for m in st.modelos(db)}
    slots = [{**s, "modelo": subidos.get(s["slot"])} for s in st.slots_del_contenido(db) + st.SLOTS_FIJOS]
    return {"slots": slots, "equipo": st.resumen_equipo(db), "lideres": st.lideres(db), "candidatos": st.candidatos_lider(db)}


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


# ---------- Editor de contenido (admins): borrador, publicar, descartar e historial por módulo ----------

class ModuloIn(BaseModel):
    contenido: dict
    version: int = 0
    forzar: bool = False


class NuevoModuloIn(BaseModel):
    tituloEs: str = Field("", max_length=120)
    tituloEn: str = Field("", max_length=120)
    seccion: str = Field(max_length=20)
    area: str = Field("", max_length=20)


@router.get("/design/api/training/editor/{modulo}")
def api_editor_modulo(modulo: str, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    try:
        return st.editor_modulo(db, modulo)
    except KeyError:
        raise HTTPException(404, "Ese módulo no existe.")


@router.post("/design/api/training/editor/{modulo}")
def api_editor_guardar(modulo: str, payload: ModuloIn, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    try:
        f = st.editor_guardar(db, user, modulo, payload.contenido, payload.version, payload.forzar)
    except st.Conflicto as c:
        return JSONResponse(status_code=409, content={"detail": f"{c.fila.actualizado_por or 'Otra persona'} guardó cambios en este módulo "
                                                                "después de que lo abriste.", "version": c.fila.version})
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"version": f.version, "actualizadoEn": f.actualizado_en.isoformat()}


@router.post("/design/api/training/editor/{modulo}/publicar")
def api_editor_publicar(modulo: str, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    try:
        f = st.editor_publicar(db, user, modulo)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"publicadoEn": f.publicado_en.isoformat(), "publicadoPor": f.publicado_por, "version": f.version}


@router.post("/design/api/training/editor/{modulo}/descartar")
def api_editor_descartar(modulo: str, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    st.editor_descartar(db, user, modulo)
    return {"ok": True}


@router.post("/design/api/training/editor/{modulo}/eliminar")
def api_editor_eliminar(modulo: str, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    try:
        f = st.editor_eliminar(db, user, modulo)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"version": f.version}


@router.get("/design/api/training/editor/{modulo}/versiones")
def api_editor_versiones(modulo: str, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    return st.editor_versiones(db, modulo)


@router.post("/design/api/training/editor/{modulo}/versiones/{version_id}/restaurar")
def api_editor_restaurar(modulo: str, version_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    try:
        f = st.editor_restaurar(db, user, modulo, version_id)
    except KeyError:
        raise HTTPException(404, "Esa versión no existe.")
    return {"version": f.version}


@router.post("/design/api/training/editor-nuevo")
def api_editor_nuevo(payload: NuevoModuloIn, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    try:
        return {"id": st.editor_nuevo(db, user, payload.tituloEs, payload.tituloEn, payload.seccion, payload.area)}
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/design/api/training/imagenes")
def api_imagenes(user: Empleado = Depends(require_admin)):
    """Imágenes de referencia incluidas (de los protocolos) para la biblioteca del editor."""
    return st.imagenes_incluidas()
