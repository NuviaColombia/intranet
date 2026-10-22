"""Mural (13-oct-2026): avisos importantes pegados en una pared de concreto (ver services_design_mural)."""
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import services_design_mural as smu
from ..database import get_db
from ..main_templates import templates
from ..models import Empleado
from .design_schedule import _RutaDesign, require_modulo

router = APIRouter(route_class=_RutaDesign)

ve_mural = smu.ve_mural   # lo usa el menú (main_templates)
_ESTATICOS = Path(__file__).resolve().parent.parent / "static" / "design" / "mural"
# Versión de mural.js / mural.css para que el navegador tome los cambios después de cada despliegue
MURAL_V = str(int(max((_ESTATICOS / f).stat().st_mtime for f in ("mural.js", "mural.css"))))


def _lector(user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)) -> Empleado:
    smu.sembrar_una_vez(db)
    if not smu.ve_mural(user):
        raise HTTPException(status_code=307, headers={"Location": "/design"})
    return user


def _editor(user: Empleado = Depends(require_modulo("design_schedule"))) -> Empleado:
    if not smu.es_editor(user):
        raise HTTPException(403, "Solo quien administra el Mural puede cambiarlo.")
    return user


@router.get("/design/mural")
def pagina_mural(request: Request, user: Empleado = Depends(_lector)):
    return templates.TemplateResponse(request, "design_mural.html", {
        "user": user, "es_design": True, "mural_editor": smu.es_editor(user), "mural_v": MURAL_V})


@router.get("/design/api/mural")
def api_listar(user: Empleado = Depends(_lector), db: Session = Depends(get_db)):
    return smu.listar(db, user)


@router.get("/design/api/mural/{aviso_id}/imagen")
def api_imagen(aviso_id: int, t: str = "", user: Empleado = Depends(_lector), db: Session = Depends(get_db)):
    r = smu.imagen(db, user, aviso_id, t == "mini")
    if not r:
        raise HTTPException(404, "Ese aviso no existe o no está publicado.")
    # La URL lleva la versión (?v=), así que el navegador la puede guardar mucho tiempo.
    return Response(r[0], media_type=r[1], headers={"Cache-Control": "private, max-age=604800, immutable"})


@router.post("/design/api/mural")
async def api_subir(archivo: UploadFile = File(...), mini: UploadFile | None = File(None), titulo: str = Form(""),
                    ancho: int = Form(0), alto: int = Form(0), user: Empleado = Depends(_editor),
                    db: Session = Depends(get_db)):
    datos = await archivo.read(smu.MAX_IMAGEN + 1)
    m = await mini.read(smu.MAX_MINIATURA + 1) if mini else None
    try:
        return smu.subir(db, user, titulo, datos, m, ancho, alto)
    except ValueError as e:
        raise HTTPException(400, str(e))


class EditarIn(BaseModel):
    titulo: str | None = None
    publicado: bool | None = None


@router.post("/design/api/mural/{aviso_id:int}")
def api_editar(aviso_id: int, body: EditarIn, user: Empleado = Depends(_editor), db: Session = Depends(get_db)):
    try:
        return smu.editar(db, aviso_id, body.titulo, body.publicado, quien=user)
    except LookupError as e:
        raise HTTPException(404, str(e))


@router.post("/design/api/mural/publicar")
def api_publicar(user: Empleado = Depends(_editor), db: Session = Depends(get_db)):
    n = smu.publicar_borradores(db, quien=user)
    return {"publicados": n, "mensaje": f"{n} aviso(s) publicado(s)." if n else "No había borradores por publicar."}


class OrdenIn(BaseModel):
    ids: list[int]


class PushIn(BaseModel):
    prueba: bool = True


@router.post("/design/api/mural/push")
def api_push(body: PushIn, user: Empleado = Depends(_editor), db: Session = Depends(get_db)):
    """Push de los avisos «Nuevo» (22-oct-2026): prueba = solo a quien administra el Mural; si no, a todo Design."""
    r = smu.avisar_nuevos(db, user, body.prueba)
    if not r["avisos"]:
        return {**r, "mensaje": "No hay avisos con la cinta «Nuevo» para avisar."}
    if body.prueba:
        msg = (f"Te envié {r['avisos']} push de prueba." if r["enviados"] else
               "No te llegó ningún push: activa las notificaciones (🔔) en este navegador y vuelve a probar.")
    else:
        msg = f"{r['avisos']} aviso(s) enviados a {r['personas']} persona(s) con acceso a Design ({r['enviados']} notificaciones entregadas)."
    return {**r, "mensaje": msg}


@router.post("/design/api/mural/orden")
def api_orden(body: OrdenIn, user: Empleado = Depends(_editor), db: Session = Depends(get_db)):
    smu.ordenar(db, body.ids)
    return {"ok": True}


@router.post("/design/api/mural/{aviso_id:int}/eliminar")
def api_eliminar(aviso_id: int, user: Empleado = Depends(_editor), db: Session = Depends(get_db)):
    try:
        smu.eliminar(db, aviso_id)
    except LookupError as e:
        raise HTTPException(404, str(e))
    return {"mensaje": "Aviso eliminado."}
