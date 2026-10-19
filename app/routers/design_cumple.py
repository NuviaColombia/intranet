"""Cumpleaños (Rosember, 19-oct-2026): anuncio del día para todo el que entra a la plataforma y
Parameters › Formatos Canva › Cumpleaños (piezas generadas, descarga y prueba). Lógica en services_design_cumple.
Se incluye desde routers/design_schedule.py."""
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from .. import services_design as sd
from .. import services_design_cumple as scu
from ..auth import get_current_user
from ..database import get_db
from ..main_templates import templates
from ..models import Empleado
from ..models_design import DesignFotoPerfil
from .design_schedule import require_admin

router = APIRouter()


@router.get("/cumple/api/hoy")
def api_hoy(user: Empleado = Depends(get_current_user), db: Session = Depends(get_db)):
    """Lo que esta persona debe ver hoy (vacío si nadie cumple, no hay foto o ya lo vio)."""
    return {"personas": scu.pendiente(db, user)}


@router.post("/cumple/api/visto")
def api_visto(user: Empleado = Depends(get_current_user), db: Session = Depends(get_db)):
    scu.marcar_visto(db, user)
    return {"ok": True}


@router.get("/cumple/foto/{empleado_id}")
def api_foto(empleado_id: int, request: Request, user: Empleado = Depends(get_current_user), db: Session = Depends(get_db)):
    if not scu.foto_permitida(db, user, empleado_id):
        raise HTTPException(404, "Sin foto.")
    f = db.get(DesignFotoPerfil, empleado_id)
    if not f or not f.datos:
        raise HTTPException(404, "Sin foto.")
    return sd.respuesta_foto(request, f.datos, f.tipo)


@router.get("/cumple/api/prueba")
def api_prueba(user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    """Para probar en la propia cuenta: el cumpleaños con foto más próximo (no marca nada como visto)."""
    return {"personas": scu.proximo_con_foto(db)}


@router.get("/design/parametros/formatos/cumpleanos")
def pagina_formatos_cumple(request: Request, mes: str = Query("", max_length=7), user: Empleado = Depends(require_admin),
                           db: Session = Depends(get_db)):
    """Parameters › Formatos Canva › Cumpleaños: las piezas del mes, generadas con los datos del Calendario (People)."""
    hoy = sd.ahora_colombia().date()
    try:
        inicio = date.fromisoformat((mes or hoy.strftime("%Y-%m")) + "-01")
    except ValueError:
        inicio = hoy.replace(day=1)
    sig = (inicio.replace(day=28) + timedelta(days=4)).replace(day=1)
    personas = scu.personas_entre(db, inicio, sig - timedelta(days=1))
    ant = (inicio - timedelta(days=1)).replace(day=1)
    return templates.TemplateResponse(request, "design_formatos_cumple.html", {
        "user": user, "es_design": True, "personas": personas, "mes": inicio, "hoy": hoy.isoformat(),
        "mes_ant": ant.strftime("%Y-%m"), "mes_sig": sig.strftime("%Y-%m"), "v": _version()})


def _version() -> str:
    from pathlib import Path
    base = Path(__file__).resolve().parent.parent / "static" / "design" / "cumple"
    try:
        return str(int(max((base / f).stat().st_mtime for f in ("cumple.js", "fondo.jpg", "cursiva.png"))))
    except OSError:
        return "1"


CUMPLE_V = _version()
templates.env.globals["cumple_v"] = CUMPLE_V
