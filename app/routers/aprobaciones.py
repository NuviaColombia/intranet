from fastapi import APIRouter, Request, Depends, Form, HTTPException
from ..concurrencia import RutaGeneral
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Empleado, Aprobacion, Solicitud
from ..auth import get_current_user
from ..services import resolver_aprobacion, pendientes_de, pendientes_soporte, decidir_soporte, es_aprobador_soporte
from ..tokens import leer_token
from ..main_templates import templates

router = APIRouter(route_class=RutaGeneral)  # tope de concurrencia: app/concurrencia.py


@router.get("/aprobaciones")
def bandeja(request: Request, user: Empleado = Depends(get_current_user),
                  db: Session = Depends(get_db)):
    pendientes = pendientes_de(db, user)
    historial = (db.query(Aprobacion).filter(Aprobacion.aprobador_id == user.id,
                                             Aprobacion.decision != "pendiente")
                 .order_by(Aprobacion.decidida_en.desc()).limit(30).all())
    es_pamela = es_aprobador_soporte(user)
    historial_soporte = []
    if es_pamela:
        historial_soporte = (db.query(Solicitud)
                             .filter(Solicitud.soporte_decidido_por_id == user.id,
                                     Solicitud.soporte_decision != "pendiente")
                             .order_by(Solicitud.soporte_decidido_en.desc()).limit(30).all())
    return templates.TemplateResponse(request, "aprobaciones.html",
                                      {"user": user, "pendientes": pendientes,
                                       "historial": historial,
                                       "es_aprobador_soporte": es_pamela,
                                       "pendientes_soporte": pendientes_soporte(db) if es_pamela else [],
                                       "historial_soporte": historial_soporte,
                                       "msg": request.query_params.get("msg")})


@router.post("/aprobaciones/soporte/{sol_id}")
async def decidir_soporte_endpoint(sol_id: int, user: Empleado = Depends(get_current_user),
                                   db: Session = Depends(get_db), decision: str = Form(...),
                                   comentario: str = Form("")):
    if not es_aprobador_soporte(user):
        raise HTTPException(403, "Solo People (o superadmin) puede validar el soporte de un permiso.")
    sol = db.get(Solicitud, sol_id)
    if not sol or decision not in ("aprobado", "rechazado"):
        return RedirectResponse("/aprobaciones?msg=Acción inválida.", status_code=303)
    msg = decidir_soporte(db, sol, user, decision, comentario)
    return RedirectResponse(f"/aprobaciones?msg={msg}", status_code=303)


@router.post("/aprobaciones/{apr_id}")
async def decidir(apr_id: int, user: Empleado = Depends(get_current_user),
                  db: Session = Depends(get_db), decision: str = Form(...),
                  comentario: str = Form("")):
    apr = db.get(Aprobacion, apr_id)
    if not apr or apr.aprobador_id != user.id or decision not in ("aprobada", "rechazada"):
        return RedirectResponse("/aprobaciones?msg=Acción inválida.", status_code=303)
    msg = resolver_aprobacion(db, apr, decision, comentario, actor=user.email)
    return RedirectResponse(f"/aprobaciones?msg={msg}", status_code=303)


@router.get("/aprobar-email/{token}")
async def aprobar_desde_correo(token: str, request: Request, db: Session = Depends(get_db)):
    """Aprobación con un clic desde el correo (token firmado, sin login)."""
    datos = leer_token(token)
    if not datos:
        return templates.TemplateResponse(request, "resultado_email.html",
                                          {"user": None, "ok": False,
                                           "msg": "El enlace es inválido o expiró (validez: 7 días)."})
    apr = db.get(Aprobacion, datos["a"])
    if not apr:
        return templates.TemplateResponse(request, "resultado_email.html",
                                          {"user": None, "ok": False, "msg": "Aprobación no encontrada."})
    msg = resolver_aprobacion(db, apr, datos["d"], comentario="(decidido desde el correo)",
                              actor=apr.aprobador.email)
    return templates.TemplateResponse(request, "resultado_email.html",
                                      {"user": None, "ok": True, "msg": msg,
                                       "solicitud": apr.solicitud})
