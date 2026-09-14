from fastapi import APIRouter, Request, Depends, Form
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Empleado, Aprobacion
from ..auth import get_current_user
from ..services import resolver_aprobacion, pendientes_de
from ..tokens import leer_token
from ..main_templates import templates

router = APIRouter()


@router.get("/aprobaciones")
async def bandeja(request: Request, user: Empleado = Depends(get_current_user),
                  db: Session = Depends(get_db)):
    pendientes = pendientes_de(db, user)
    historial = (db.query(Aprobacion).filter(Aprobacion.aprobador_id == user.id,
                                             Aprobacion.decision != "pendiente")
                 .order_by(Aprobacion.decidida_en.desc()).limit(30).all())
    return templates.TemplateResponse(request, "aprobaciones.html",
                                      {"user": user, "pendientes": pendientes,
                                       "historial": historial,
                                       "msg": request.query_params.get("msg")})


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
