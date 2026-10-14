"""Notificaciones push de Design: service worker, claves, suscribirse / desuscribirse, prueba y estado (Parámetros).
Se incluye desde routers/design_schedule.py (mismo router). El envío está en services_design_push.enviar."""
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Empleado
from .. import services_design_push as sp
from .design_schedule import require_modulo, require_admin, _RutaDesign

router = APIRouter(route_class=_RutaDesign)
_SW = Path(__file__).resolve().parent.parent / "static" / "design" / "sw.js"


@router.get("/design/sw.js")
def service_worker():
    """El service worker vive en /design/ para que su alcance sea solo Design (no toca el resto de la intranet).
    Es código sin datos: no pide sesión (el navegador lo actualiza en segundo plano)."""
    return Response(_SW.read_text(encoding="utf-8"), media_type="application/javascript",
                    headers={"Cache-Control": "no-cache", "Service-Worker-Allowed": "/design/"})


@router.get("/design/manifest.webmanifest")
def manifest():
    """Para iPhone/iPad: los avisos push solo llegan si la intranet se agrega a la pantalla de inicio."""
    return {"name": "Nuvia Design", "short_name": "Nuvia Design", "start_url": "/design/inicio", "scope": "/design/",
            "display": "standalone", "background_color": "#0f172a", "theme_color": "#0f172a",
            "icons": [{"src": "/static/design/push-icono.png", "sizes": "192x192", "type": "image/png"}]}


@router.get("/design/api/push/clave")
def api_clave(user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    return {"publica": sp.claves(db)["publica"], "misNavegadores": sp.mis_suscripciones(db, user)}


class SuscripcionIn(BaseModel):
    subscription: dict
    navegador: str = Field("", max_length=200)


@router.post("/design/api/push/suscribir")
def api_suscribir(payload: SuscripcionIn, request: Request, user: Empleado = Depends(require_modulo("design_schedule")),
                  db: Session = Depends(get_db)):
    if getattr(request.state, "design_real", None):
        # Simulando: este navegador es del admin; no se suscribe a nombre de la persona simulada
        raise HTTPException(409, "Mientras simulas a otra persona no se activan notificaciones.")
    try:
        sp.suscribir(db, user, payload.subscription, payload.navegador)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True, "misNavegadores": sp.mis_suscripciones(db, user)}


class EndpointIn(BaseModel):
    endpoint: str = Field(max_length=2000)


@router.post("/design/api/push/desuscribir")
def api_desuscribir(payload: EndpointIn, user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    sp.desuscribir(db, user, payload.endpoint)
    return {"ok": True, "misNavegadores": sp.mis_suscripciones(db, user)}


@router.post("/design/api/push/prueba")
def api_prueba(user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    """Notificación de prueba a todos los navegadores de quien la pide."""
    r = sp.enviar(db, [user.id], "🔔 Notificaciones activas", "Así te llegarán los avisos de Nuvia Design.", "/design/inicio", "prueba")
    if not r["enviados"]:
        raise HTTPException(400, "No se pudo entregar: " + ("este usuario no tiene notificaciones activadas." if r["sinSuscripcion"] else "el servicio de notificaciones del navegador no respondió."))
    return r


@router.post("/design/api/push/ejemplo-face-n2")
def api_ejemplo_face_n2(user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    """Admins: se envían a sí mismos el aviso que recibe el manager de N2 cuando llega una orden aprobada en Face
    (mismo texto y fijo hasta cerrarlo), para ver cómo se ve."""
    r = sp.enviar(db, [user.id], "Nueva orden aprobada en Face",
                  "12345 · Paciente de ejemplo · Oklahoma · Full Mouth\nYa está en tu Schedule de N2 de hoy (equipo de ejemplo).",
                  "/design", "ejemplo-face-n2", fijo=True)
    if not r["enviados"]:
        raise HTTPException(400, "No se pudo entregar: " + ("este usuario no tiene notificaciones activadas." if r["sinSuscripcion"] else "el servicio de notificaciones del navegador no respondió."))
    return r


@router.get("/design/api/push/estado")
def api_estado(user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    return sp.estado(db)
