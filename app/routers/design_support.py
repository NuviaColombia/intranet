"""Support Time: turnos rotativos de Support (Parámetros), su bloque en la página de Inicio y las coberturas de turno
("Dejar a cargo" en el Schedule de Support). Se incluye desde routers/design_schedule.py (mismo router)."""
from datetime import date
from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Empleado
from .. import services_design as sd
from .. import services_design_support as ss
from .design_schedule import require_modulo, require_admin, _RutaDesign

router = APIRouter(route_class=_RutaDesign)


def _puede_cubrir(user: Empleado) -> bool:
    """Dejar a alguien cubriendo un turno de Support: admins y aprobadores."""
    return user.rol in ("aprobador", "admin", "superadmin")


@router.get("/design/api/support-time")
def api_support_time(user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    """Quién está en cada turno hoy, su horario, el próximo cambio y las coberturas (para la página de Inicio y el Schedule)."""
    return {**ss.estado(db, sd.ahora_colombia().date()), "puedeCubrir": _puede_cubrir(user)}


@router.post("/design/parametros/support-time")
async def guardar_support_time(request: Request, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    f = await request.form()
    datos = {k: f.get(k) for k in ("persona_a", "persona_b", "semanas", "ref_fecha", "ref_turno1", "turno1_nombre", "turno1_inicio",
                                   "turno1_fin", "turno2_nombre", "turno2_inicio", "turno2_fin")}
    datos["dias"] = f.getlist("dias")
    err = ss.guardar_config(db, datos, user.nombre_completo)
    msg = err or "Support Time guardado: la rotación se aplica sola."
    return RedirectResponse(f"/design/parametros?msg={msg}&st=1", status_code=303)


class CoberturaIn(BaseModel):
    turno: int
    empleadoId: int
    desde: date
    hasta: date


@router.get("/design/api/support-time/candidatos")
def api_candidatos(user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    """Personas de Design que pueden cubrir un turno (cualquier equipo), sin las dos de Support."""
    if not _puede_cubrir(user):
        raise HTTPException(403, "Solo aprobadores y admins dejan a alguien a cargo.")
    c = ss.config(db)
    from .design_schedule import NUVIA_DESIGN
    lista = (db.query(Empleado).filter(Empleado.empresa == NUVIA_DESIGN, Empleado.activo == 1).all())
    return sorted(({"id": e.id, "nombre": e.nombre_completo} for e in lista if e.id not in (c.persona_a_id, c.persona_b_id)),
                  key=lambda x: sd._normalizar_texto(x["nombre"]))


@router.post("/design/api/support-time/cobertura")
def api_cobertura(payload: CoberturaIn, user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    if not _puede_cubrir(user):
        raise HTTPException(403, "Solo aprobadores y admins dejan a alguien a cargo.")
    hoy = sd.ahora_colombia().date()
    err = ss.agregar_cobertura(db, payload.turno, payload.empleadoId, payload.desde, payload.hasta, user.nombre_completo, hoy)
    if err:
        raise HTTPException(400, err)
    return {**ss.estado(db, hoy), "puedeCubrir": True}


@router.post("/design/api/support-time/cobertura/{cobertura_id}/quitar")
def api_cobertura_quitar(cobertura_id: int, user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    if not _puede_cubrir(user):
        raise HTTPException(403, "Solo aprobadores y admins quitan una cobertura.")
    if not ss.quitar_cobertura(db, cobertura_id):
        raise HTTPException(404, "La cobertura no existe.")
    return {**ss.estado(db, sd.ahora_colombia().date()), "puedeCubrir": True}
