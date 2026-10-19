"""Calendario de Design (19-oct-2026): página /design/calendario y su API /design/api/calendario/* (mismas rutas y
respuestas que el servidor de la app original «Calendario Colombia», para reutilizar su interfaz).
La lógica y los permisos están en services_design_calendario. Se incluye desde routers/design_schedule.py."""
from datetime import date
from pathlib import Path

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response
from sqlalchemy.orm import Session

from .. import services_design_calendario as scal
from ..database import get_db
from ..main_templates import templates
from ..models import Empleado
from ..auth import get_current_user
from .design_schedule import _RutaDesign, _sin_acceso_simulando, _usuario_efectivo

router = APIRouter(route_class=_RutaDesign)
API = "/design/api/calendario"
_ESTATICOS = Path(__file__).resolve().parent.parent / "static" / "design" / "calendario"


def _version() -> str:
    try:
        return str(int(max((_ESTATICOS / f).stat().st_mtime for f in ("app.js", "calendario.css", "holidays.js", "api.js"))))
    except OSError:
        return "0"


CAL_V = _version()
scal.arrancar_recordatorios()   # push de 1 mes antes de unas vacaciones estimadas (hilo en segundo plano)

def _usuario(request: Request, user: Empleado = Depends(get_current_user), db: Session = Depends(get_db)) -> Empleado:
    """Quien tiene Design, o las personas de People que ven el Calendario (Pamela Manzur y Nicol Ardila)."""
    if scal.es_people_calendario(user):
        return user
    u = _usuario_efectivo(request, user, db)
    if not u.tiene_modulo("design_schedule"):
        _sin_acceso_simulando(request, u)
        raise HTTPException(status_code=307, headers={"Location": "/?error=sin_acceso"})
    return u


def _r(fn):
    """Errores de la lógica -> {error} con su código (como la app original)."""
    try:
        return fn()
    except scal.ErrorCal as e:
        return JSONResponse({"error": e.mensaje}, status_code=e.status)


def _fecha(v: str) -> date:
    try:
        return date.fromisoformat(v[:10])
    except (TypeError, ValueError):
        raise scal.ErrorCal(400, "Parámetros from/to inválidos (AAAA-MM-DD)")


@router.get("/design/calendario")
def pagina(request: Request, user: Empleado = Depends(_usuario), db: Session = Depends(get_db)):
    # Desde People (sin Design) se ve con la barra de People; con Design, con la de Design
    return templates.TemplateResponse(request, "design_calendario.html", {"user": user, "es_design": user.tiene_modulo("design_schedule"),
                                                                          "cal_v": CAL_V})


@router.get(API + "/me")
def api_me(user: Empleado = Depends(_usuario), db: Session = Depends(get_db)):
    return scal.yo(db, user)


@router.get(API + "/users")
def api_users(user: Empleado = Depends(_usuario), db: Session = Depends(get_db)):
    return scal.personas(db, user)


@router.get(API + "/tags")
def api_tags(user: Empleado = Depends(_usuario), db: Session = Depends(get_db)):
    return scal.etiquetas(db)


@router.post(API + "/tags")
def api_tag_crear(datos: dict = Body(...), user: Empleado = Depends(_usuario), db: Session = Depends(get_db)):
    return _r(lambda: scal.crear_etiqueta(db, user, datos.get("name"), datos.get("color")))


@router.patch(API + "/tags/{tag_id}")
def api_tag_editar(tag_id: int, datos: dict = Body(...), user: Empleado = Depends(_usuario), db: Session = Depends(get_db)):
    return _r(lambda: scal.editar_etiqueta(db, user, tag_id, datos))


@router.delete(API + "/tags/{tag_id}")
def api_tag_eliminar(tag_id: int, user: Empleado = Depends(_usuario), db: Session = Depends(get_db)):
    return _r(lambda: (scal.eliminar_etiqueta(db, user, tag_id), {"ok": True})[1])


@router.get(API + "/events")
def api_eventos(desde: str = Query(..., alias="from"), hasta: str = Query(..., alias="to"), user: Empleado = Depends(_usuario),
                db: Session = Depends(get_db)):
    return _r(lambda: scal.eventos(db, user, _fecha(desde), _fecha(hasta)))


@router.get(API + "/events/search")
def api_buscar(q: str = Query("", max_length=100), user: Empleado = Depends(_usuario), db: Session = Depends(get_db)):
    return scal.buscar(db, user, q)


@router.get(API + "/my-tasks")
def api_mis_tareas(user: Empleado = Depends(_usuario), db: Session = Depends(get_db)):
    return scal.mis_tareas(db, user)


@router.post(API + "/events")
def api_crear(datos: dict = Body(...), user: Empleado = Depends(_usuario), db: Session = Depends(get_db)):
    return _r(lambda: scal.crear(db, user, datos))


@router.get(API + "/events/{evento_id}")
def api_evento(evento_id: int, user: Empleado = Depends(_usuario), db: Session = Depends(get_db)):
    def ver():
        ev, p = scal.evento(db, user, evento_id)
        return scal.serializar(db, p, [ev])[0]
    return _r(ver)


@router.put(API + "/events/{evento_id}")
@router.patch(API + "/events/{evento_id}")
def api_actualizar(evento_id: int, datos: dict = Body(...), user: Empleado = Depends(_usuario), db: Session = Depends(get_db)):
    return _r(lambda: scal.actualizar(db, user, evento_id, datos))


@router.delete(API + "/events/{evento_id}")
def api_eliminar(evento_id: int, occurrence: str = Query("", max_length=10), user: Empleado = Depends(_usuario), db: Session = Depends(get_db)):
    return _r(lambda: (scal.eliminar(db, user, evento_id, occurrence or None), {"ok": True})[1])


@router.get(API + "/events/{evento_id}/comments")
def api_comentarios(evento_id: int, user: Empleado = Depends(_usuario), db: Session = Depends(get_db)):
    return _r(lambda: scal.comentarios(db, user, evento_id))


@router.post(API + "/events/{evento_id}/comments")
def api_comentar(evento_id: int, datos: dict = Body(...), user: Empleado = Depends(_usuario), db: Session = Depends(get_db)):
    return _r(lambda: (scal.comentar(db, user, evento_id, datos.get("body")), {"ok": True})[1])


@router.get(API + "/activity")
def api_actividad(user: Empleado = Depends(_usuario), db: Session = Depends(get_db)):
    return scal.actividad(db, user)


@router.get(API + "/absences")
def api_ausencias(desde: str = Query(..., alias="from"), hasta: str = Query(..., alias="to"), user: Empleado = Depends(_usuario),
                  db: Session = Depends(get_db)):
    scal.limpiar_confirmadas(db)
    return _r(lambda: scal.ausencias(db, user, _fecha(desde), _fecha(hasta)))


@router.get(API + "/absences/people")
def api_ausencias_personas(user: Empleado = Depends(_usuario), db: Session = Depends(get_db)):
    return scal.personas_ausencias(db, user)


@router.get(API + "/absences/status")
def api_ausencias_estado(user: Empleado = Depends(_usuario)):
    return {"pull": {"label": "People (intranet)", "last_ok": None, "intranet": True}, "push": {"enabled": False}}


@router.post(API + "/estimates")
def api_estimada_crear(datos: dict = Body(...), user: Empleado = Depends(_usuario), db: Session = Depends(get_db)):
    return _r(lambda: scal.guardar_estimada(db, user, datos))


@router.put(API + "/estimates/{estimada_id}")
def api_estimada_editar(estimada_id: int, datos: dict = Body(...), user: Empleado = Depends(_usuario), db: Session = Depends(get_db)):
    return _r(lambda: scal.guardar_estimada(db, user, datos, estimada_id))


@router.delete(API + "/estimates/{estimada_id}")
def api_estimada_eliminar(estimada_id: int, user: Empleado = Depends(_usuario), db: Session = Depends(get_db)):
    return _r(lambda: (scal.eliminar_estimada(db, user, estimada_id), {"ok": True})[1])


@router.get(API + "/export.ics")
def api_ics(user: Empleado = Depends(_usuario), db: Session = Depends(get_db)):
    return Response(scal.ics(db, user), media_type="text/calendar; charset=utf-8",
                    headers={"Content-Disposition": 'attachment; filename="calendario-design.ics"'})
