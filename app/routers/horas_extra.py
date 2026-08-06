"""Solicitud y aprobación de horas extra: los aprobadores las piden para sus empleados a cargo,
y los admins las aprueban o rechazan."""
from datetime import date
from fastapi import APIRouter, Request, Depends, Form
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Empleado, HoraExtra
from ..auth import get_current_user, require_admin
from ..services import empleados_a_cargo, crear_horas_extra, resolver_horas_extra
from ..main_templates import templates

router = APIRouter()


@router.get("/horas-extra")
async def horas_extra_home(request: Request, user: Empleado = Depends(get_current_user),
                           db: Session = Depends(get_db)):
    if user.rol == "admin":
        a_cargo = db.query(Empleado).filter(Empleado.activo == 1).order_by(Empleado.apellidos).all()
    else:
        a_cargo = empleados_a_cargo(db, user)
    mis_solicitudes = (db.query(HoraExtra).filter(HoraExtra.solicitante_id == user.id)
                       .order_by(HoraExtra.creada_en.desc()).all())

    pendientes_aprobar, historial_admin = [], []
    if user.rol == "admin":
        pendientes_aprobar = (db.query(HoraExtra).filter(HoraExtra.estado == "pendiente")
                              .order_by(HoraExtra.creada_en).all())
        historial_admin = (db.query(HoraExtra).filter(HoraExtra.estado != "pendiente")
                           .order_by(HoraExtra.decidida_en.desc()).limit(100).all())

    return templates.TemplateResponse(request, "horas_extra.html",
                                      {"user": user, "a_cargo": a_cargo,
                                       "mis_solicitudes": mis_solicitudes,
                                       "pendientes_aprobar": pendientes_aprobar,
                                       "historial_admin": historial_admin,
                                       "msg": request.query_params.get("msg"),
                                       "error": request.query_params.get("error")})


@router.post("/horas-extra/nueva")
async def nueva_horas_extra(user: Empleado = Depends(get_current_user), db: Session = Depends(get_db),
                            empleado_id: int = Form(...), fecha: date = Form(...),
                            horas: float = Form(...), motivo: str = Form("")):
    empleado = db.get(Empleado, empleado_id)
    if not empleado:
        return RedirectResponse("/horas-extra?error=Empleado inválido.", status_code=303)
    he, error = crear_horas_extra(db, user, empleado, fecha, horas, motivo)
    if error:
        return RedirectResponse(f"/horas-extra?error={error}", status_code=303)
    if user.rol == "admin":
        msg = f"Horas extra registradas y aprobadas para {empleado.nombre_completo}."
    else:
        msg = f"Solicitud de horas extra para {empleado.nombre_completo} enviada a los administradores."
    return RedirectResponse(f"/horas-extra?msg={msg}", status_code=303)


@router.post("/horas-extra/{he_id}")
async def decidir_horas_extra(he_id: int, admin: Empleado = Depends(require_admin),
                              db: Session = Depends(get_db),
                              decision: str = Form(...), comentario: str = Form("")):
    he = db.get(HoraExtra, he_id)
    if not he or decision not in ("aprobada", "rechazada"):
        return RedirectResponse("/horas-extra?error=Solicitud inválida.", status_code=303)
    msg = resolver_horas_extra(db, he, decision, comentario, admin)
    return RedirectResponse(f"/horas-extra?msg={msg}", status_code=303)
