"""Notificaciones push de Pagos: service worker y suscripción propios, en /pagos/ (no se reutiliza el
de Design porque su alcance está fijado a /design/ -- Service-Worker-Allowed). El envío usa
services_design_push, que no es específico de Design: solo vive en ese archivo por dónde se usó primero.
Ver docs/wiki/caja_menor.md, sección Pagos."""
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Empleado
from ..auth import require_modulo
from .. import services_design_push as sp

router = APIRouter()
require_pagos = require_modulo("caja_menor")
_SW = Path(__file__).resolve().parent.parent / "static" / "pagos" / "sw.js"


@router.get("/pagos/sw.js")
def service_worker():
    return Response(_SW.read_text(encoding="utf-8"), media_type="application/javascript",
                    headers={"Cache-Control": "no-cache", "Service-Worker-Allowed": "/pagos/"})


@router.get("/pagos/manifest.webmanifest")
def manifest():
    return {"name": "Pagos Nuvia", "short_name": "Pagos", "start_url": "/pagos", "scope": "/pagos/",
            "display": "standalone", "background_color": "#1A365D", "theme_color": "#1A365D",
            "icons": [{"src": "/static/design/push-icono.png", "sizes": "192x192", "type": "image/png"}]}


@router.get("/pagos/api/push/clave")
def api_clave(user: Empleado = Depends(require_pagos), db: Session = Depends(get_db)):
    return {"publica": sp.claves(db)["publica"], "misNavegadores": sp.mis_suscripciones(db, user)}


class SuscripcionIn(BaseModel):
    subscription: dict
    navegador: str = Field("", max_length=200)


@router.post("/pagos/api/push/suscribir")
def api_suscribir(payload: SuscripcionIn, user: Empleado = Depends(require_pagos), db: Session = Depends(get_db)):
    try:
        sp.suscribir(db, user, payload.subscription, payload.navegador)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True, "misNavegadores": sp.mis_suscripciones(db, user)}


class EndpointIn(BaseModel):
    endpoint: str = Field(max_length=2000)


@router.post("/pagos/api/push/desuscribir")
def api_desuscribir(payload: EndpointIn, user: Empleado = Depends(require_pagos), db: Session = Depends(get_db)):
    sp.desuscribir(db, user, payload.endpoint)
    return {"ok": True, "misNavegadores": sp.mis_suscripciones(db, user)}


@router.post("/pagos/api/push/prueba")
def api_prueba(user: Empleado = Depends(require_pagos), db: Session = Depends(get_db)):
    r = sp.enviar(db, [user.id], "🔔 Notificaciones activas", "Así te llegarán los avisos de Pagos.", "/pagos", "prueba")
    if not r["enviados"]:
        raise HTTPException(400, "No se pudo entregar: " + ("este usuario no tiene notificaciones activadas." if r["sinSuscripcion"] else "el servicio de notificaciones del navegador no respondió."))
    return r
