from datetime import date, time
from fastapi import APIRouter, Request, Depends, Form, UploadFile, File, HTTPException
from ..concurrencia import RutaGeneral
from fastapi.responses import RedirectResponse, Response
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Empleado, Solicitud, TipoPermiso
from ..auth import get_current_user
from ..services import (crear_solicitud, saldo_disponible, auditar, config_actual, HORAS_SEMANA,
                        subir_soporte, es_aprobador_soporte)
from ..main_templates import templates

router = APIRouter(route_class=RutaGeneral)  # tope de concurrencia: app/concurrencia.py


@router.get("/solicitudes")
def mis_solicitudes(request: Request, user: Empleado = Depends(get_current_user),
                          db: Session = Depends(get_db)):
    sols = (db.query(Solicitud).filter(Solicitud.empleado_id == user.id)
            .order_by(Solicitud.creada_en.desc()).all())
    return templates.TemplateResponse(request, "solicitudes.html",
                                      {"user": user, "solicitudes": sols,
                                       "msg": request.query_params.get("msg")})


@router.get("/solicitudes/nueva")
async def nueva_solicitud_form(request: Request, user: Empleado = Depends(get_current_user),
                               db: Session = Depends(get_db)):
    tipos = db.query(TipoPermiso).filter(TipoPermiso.activo == 1).all()
    anio = date.today().year
    saldos = {t.id: saldo_disponible(db, user, t, anio) for t in tipos}
    sabado_habil = bool(config_actual(db).sabado_habil)
    return templates.TemplateResponse(request, "nueva_solicitud.html",
                                      {"user": user, "tipos": tipos, "saldos": saldos,
                                       "sabado_habil": sabado_habil, "horas_semana": HORAS_SEMANA,
                                       "error": request.query_params.get("error")})


@router.post("/solicitudes/nueva")
async def nueva_solicitud(user: Empleado = Depends(get_current_user), db: Session = Depends(get_db),
                          tipo_id: int = Form(...), fecha_inicio: date = Form(...),
                          fecha_fin: date = Form(...), motivo: str = Form(""),
                          hora_inicio: str = Form(""), hora_fin: str = Form("")):
    tipo = db.get(TipoPermiso, tipo_id)
    if not tipo:
        return RedirectResponse("/solicitudes/nueva?error=Tipo de permiso inválido", status_code=303)
    hi = time.fromisoformat(hora_inicio) if hora_inicio else None
    hf = time.fromisoformat(hora_fin) if hora_fin else None
    sol, error = crear_solicitud(db, user, tipo, fecha_inicio, fecha_fin, motivo, hi, hf)
    if error:
        return RedirectResponse(f"/solicitudes/nueva?error={error}", status_code=303)
    return RedirectResponse(f"/solicitudes?msg=Solicitud %23{sol.id} creada. Se notificó a tu aprobador.",
                            status_code=303)


@router.post("/solicitudes/{sol_id}/soporte")
async def api_subir_soporte(sol_id: int, archivo: UploadFile = File(...),
                            user: Empleado = Depends(get_current_user), db: Session = Depends(get_db)):
    sol = db.get(Solicitud, sol_id)
    if not sol:
        return RedirectResponse("/solicitudes?msg=Solicitud no encontrada.", status_code=303)
    datos = await archivo.read()
    error = subir_soporte(db, sol, user, archivo.filename or "soporte", (archivo.content_type or "").lower(), datos)
    msg = error or "Soporte anexado. Queda pendiente de validación de People."
    return RedirectResponse(f"/solicitudes?msg={msg}", status_code=303)


@router.get("/solicitudes/{sol_id}/soporte")
def api_ver_soporte(sol_id: int, user: Empleado = Depends(get_current_user), db: Session = Depends(get_db)):
    sol = db.get(Solicitud, sol_id)
    if not sol or not sol.soporte_subido_en:
        raise HTTPException(404, "No hay soporte anexado.")
    propio = sol.empleado_id == user.id
    es_su_aprobador = any(a.aprobador_id == user.id for a in sol.aprobaciones)
    mismo_admin = user.rol in ("admin", "superadmin") and (user.rol == "superadmin" or sol.empleado.empresa == user.empresa)
    if not (propio or es_su_aprobador or mismo_admin or es_aprobador_soporte(user)):
        raise HTTPException(404, "No hay soporte anexado.")
    return Response(sol.soporte_datos, media_type=sol.soporte_tipo_mime or "application/octet-stream",
                    headers={"Content-Disposition": f'inline; filename="{sol.soporte_nombre}"',
                            "Cache-Control": "private, max-age=3600"})


@router.post("/solicitudes/{sol_id}/cancelar")
async def cancelar(sol_id: int, user: Empleado = Depends(get_current_user),
                   db: Session = Depends(get_db)):
    sol = db.get(Solicitud, sol_id)
    if sol and sol.empleado_id == user.id and sol.estado in ("pendiente_1", "pendiente_2"):
        sol.estado = "cancelada"
        auditar(db, user.email, "Solicitud cancelada por el empleado", solicitud_id=sol.id,
                empleado_id=sol.empleado_id)
        db.commit()
    return RedirectResponse("/solicitudes?msg=Solicitud cancelada.", status_code=303)
