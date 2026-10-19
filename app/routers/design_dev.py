"""Development (19-oct-2026): control de proyectos y protocolos (ver services_design_dev). Página /design/development y
la API /design/api/dev/* con el contrato de control-proyectos/docs/api.md (errores {message, details})."""
import json
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, Response
from sqlalchemy.orm import Session

from .. import services_design as sd
from .. import services_design_dev as sdv
from ..auth import get_current_user
from ..database import get_db
from ..main_templates import templates
from ..models import Empleado
from .design_schedule import _RutaDesign

router = APIRouter(route_class=_RutaDesign)

ve_development = sdv.tiene_acceso   # lo usa el menú (main_templates)
_ESTATICOS = Path(__file__).resolve().parent.parent / "static" / "design" / "development"
DEV_V = str(int(max((_ESTATICOS / f).stat().st_mtime for f in ("domain.js", "api.js", "app.js", "development.css"))))


def _acceso(user: Empleado = Depends(get_current_user)) -> Empleado:
    if not sdv.tiene_acceso(user):
        raise HTTPException(403, "Development es solo para admins, Luis Felipe Blaschke y Paul Andion.")
    return user


def _r(fn, *args):
    """Ejecuta la operación y traduce ErrorDev al formato que espera el frontend."""
    try:
        return fn(*args)
    except sdv.ErrorDev as e:
        return JSONResponse({"message": e.message, "details": e.details}, status_code=e.status)


async def _json(request: Request) -> dict:
    try:
        d = await request.json()
    except ValueError:
        raise HTTPException(400, "Petición mal formada")
    if not isinstance(d, dict):
        raise HTTPException(400, "Petición mal formada")
    return d


@router.get("/design/development")
def pagina(request: Request, user: Empleado = Depends(get_current_user)):
    if not sdv.tiene_acceso(user):
        return Response(status_code=307, headers={"Location": "/design"})
    return templates.TemplateResponse(request, "design_development.html", {
        "user": user, "es_design": True, "dev_v": DEV_V, "dev_usuario": sdv._nombre(user)})


@router.get("/design/api/dev/people")
def api_personas(user: Empleado = Depends(_acceso), db: Session = Depends(get_db)):
    return sdv.personas(db)


@router.get("/design/api/dev/space")
def api_espacio(user: Empleado = Depends(_acceso), db: Session = Depends(get_db)):
    return {"used": sdv.espacio_usado(db), "limit": sdv.TOPE_TOTAL}


# ---------- Proyectos ----------

@router.get("/design/api/dev/projects")
def api_listar(user: Empleado = Depends(_acceso), db: Session = Depends(get_db)):
    return sdv.listar(db)


@router.post("/design/api/dev/projects")
async def api_crear(request: Request, user: Empleado = Depends(_acceso), db: Session = Depends(get_db)):
    return _r(sdv.crear, db, user, await _json(request))


@router.patch("/design/api/dev/projects/{pid}")
async def api_editar(pid: str, request: Request, user: Empleado = Depends(_acceso), db: Session = Depends(get_db)):
    return _r(sdv.editar, db, user, pid, await _json(request))


@router.delete("/design/api/dev/projects/{pid}")
def api_eliminar(pid: str, user: Empleado = Depends(_acceso), db: Session = Depends(get_db)):
    return _r(sdv.eliminar, db, user, pid)


@router.post("/design/api/dev/projects/{pid}/transitions")
async def api_etapa(pid: str, request: Request, user: Empleado = Depends(_acceso), db: Session = Depends(get_db)):
    d = await _json(request)
    return _r(sdv.cambiar_etapa, db, user, pid, str(d.get("to") or ""), str(d.get("reason") or ""))


@router.put("/design/api/dev/projects/{pid}/gates/{clave}")
async def api_control(pid: str, clave: str, request: Request, user: Empleado = Depends(_acceso), db: Session = Depends(get_db)):
    d = await _json(request)
    return _r(sdv.marcar_control, db, user, pid, clave, bool(d.get("done")))


@router.post("/design/api/dev/projects/{pid}/notes")
async def api_nota(pid: str, request: Request, user: Empleado = Depends(_acceso), db: Session = Depends(get_db)):
    d = await _json(request)
    return _r(sdv.nota, db, user, pid, str(d.get("text") or ""))


# ---------- Riesgos ----------

@router.post("/design/api/dev/projects/{pid}/risks")
async def api_riesgo_nuevo(pid: str, request: Request, user: Empleado = Depends(_acceso), db: Session = Depends(get_db)):
    return _r(sdv.guardar_riesgo, db, user, pid, await _json(request))


@router.patch("/design/api/dev/projects/{pid}/risks/{rid}")
async def api_riesgo_editar(pid: str, rid: str, request: Request, user: Empleado = Depends(_acceso), db: Session = Depends(get_db)):
    return _r(sdv.guardar_riesgo, db, user, pid, await _json(request), rid)


@router.delete("/design/api/dev/projects/{pid}/risks/{rid}")
def api_riesgo_eliminar(pid: str, rid: str, user: Empleado = Depends(_acceso), db: Session = Depends(get_db)):
    return _r(sdv.eliminar_riesgo, db, user, pid, rid)


# ---------- Evidencias ----------

@router.post("/design/api/dev/projects/{pid}/evidence")
async def api_evidencias(pid: str, files: list[UploadFile] = File(...), meta: str = Form("[]"),
                         user: Empleado = Depends(_acceso), db: Session = Depends(get_db)):
    try:
        datos_meta = json.loads(meta)
    except ValueError:
        datos_meta = None
    if not isinstance(datos_meta, list) or not all(isinstance(m, dict) for m in datos_meta) or len(files) > 20:
        return JSONResponse({"message": "Petición mal formada", "details": []}, status_code=400)
    archivos = []
    for f in files:
        archivos.append(await f.read(sdv.MAX_EVIDENCIA + 1))
    return _r(sdv.agregar_evidencias, db, user, pid, archivos, datos_meta)


@router.patch("/design/api/dev/projects/{pid}/evidence/{eid}")
async def api_evidencia_editar(pid: str, eid: str, request: Request, user: Empleado = Depends(_acceso), db: Session = Depends(get_db)):
    return _r(sdv.editar_evidencia, db, user, pid, eid, await _json(request))


@router.delete("/design/api/dev/projects/{pid}/evidence/{eid}")
def api_evidencia_eliminar(pid: str, eid: str, user: Empleado = Depends(_acceso), db: Session = Depends(get_db)):
    return _r(sdv.eliminar_evidencia, db, user, pid, eid)


@router.get("/design/api/dev/projects/{pid}/evidence/{eid}/file")
def api_evidencia_archivo(pid: str, eid: str, request: Request, user: Empleado = Depends(_acceso), db: Session = Depends(get_db)):
    try:
        datos, tipo = sdv.archivo_evidencia(db, pid, eid)
    except sdv.ErrorDev as e:
        raise HTTPException(e.status, e.message)
    return sd.respuesta_foto(request, datos, tipo)


# ---------- Posts ----------

@router.get("/design/api/dev/posts")
def api_posts(user: Empleado = Depends(_acceso), db: Session = Depends(get_db)):
    return sdv.listar_posts(db, user)


@router.post("/design/api/dev/posts")
async def api_post_nuevo(request: Request, user: Empleado = Depends(_acceso), db: Session = Depends(get_db)):
    return _r(sdv.guardar_post, db, user, await _json(request))


@router.patch("/design/api/dev/posts/{post_id}")
async def api_post_editar(post_id: str, request: Request, user: Empleado = Depends(_acceso), db: Session = Depends(get_db)):
    return _r(sdv.guardar_post, db, user, await _json(request), post_id)


@router.delete("/design/api/dev/posts/{post_id}")
def api_post_eliminar(post_id: str, user: Empleado = Depends(_acceso), db: Session = Depends(get_db)):
    r = _r(sdv.eliminar_post, db, post_id)
    return r if isinstance(r, JSONResponse) else Response(status_code=204)


@router.put("/design/api/dev/posts/{post_id}/{tipo}")
def api_post_marcar(post_id: str, tipo: str, user: Empleado = Depends(_acceso), db: Session = Depends(get_db)):
    return _marca(db, user, post_id, tipo, True)


@router.delete("/design/api/dev/posts/{post_id}/{tipo}")
def api_post_desmarcar(post_id: str, tipo: str, user: Empleado = Depends(_acceso), db: Session = Depends(get_db)):
    return _marca(db, user, post_id, tipo, False)


def _marca(db: Session, user: Empleado, post_id: str, tipo: str, valor: bool):
    t = {"read": "leido", "useful": "util"}.get(tipo)
    if not t:
        raise HTTPException(404, "No encontrado")
    return _r(sdv.marcar_post, db, user, post_id, t, valor)


@router.get("/design/api/dev/export")
def api_exportar(user: Empleado = Depends(_acceso), db: Session = Depends(get_db)):
    return sdv.exportar(db, user)
