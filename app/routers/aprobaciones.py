from fastapi import APIRouter, Request, Depends, Form
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Empleado, Solicitud, Aprobacion
from ..auth import get_current_user
from ..services import resolver_aprobacion
from ..tokens import leer_token
from ..main_templates import templates

router = APIRouter()


def _pendientes_de(db: Session, user: Empleado):
    """Aprobaciones que están activas en el nivel que le corresponde al usuario."""
    aps = (db.query(Aprobacion).join(Solicitud)
           .filter(Aprobacion.aprobador_id == user.id, Aprobacion.decision == "pendiente",
                   Solicitud.estado.in_(["pendiente_1", "pendiente_2"]))
           .order_by(Solicitud.creada_en).all())
    return [a for a in aps
            if (a.solicitud.estado == "pendiente_1" and a.nivel == 1)
            or (a.solicitud.estado == "pendiente_2" and a.nivel == 2)]


@router.get("/aprobaciones")
async def bandeja(request: Request, user: Empleado = Depends(get_current_user),
                  db: Session = Depends(get_db)):
    pendientes = _pendientes_de(db, user)
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
