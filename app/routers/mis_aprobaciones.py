"""Bandeja unificada de aprobaciones pendientes de todos los módulos (People, Horas extra,
Custodia), enlazada desde el contador de la barra superior."""
from fastapi import APIRouter, Request, Depends, Form
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Empleado, Aprobacion, HoraExtra
from ..models_custodia import CustodiaTraslado
from ..auth import get_current_user
from ..services import resolver_aprobacion, resolver_horas_extra
from .. import services_custodia as sc
from ..aprobaciones_globales import resumen_pendientes
from ..main_templates import templates

router = APIRouter()


@router.get("/mis-aprobaciones")
async def bandeja(request: Request, user: Empleado = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.rol not in ("aprobador", "admin", "superadmin"):
        return RedirectResponse("/", status_code=303)
    resumen = resumen_pendientes(db, user)
    return templates.TemplateResponse(request, "mis_aprobaciones.html",
                                      {"user": user, "items": resumen["items"],
                                       "msg": request.query_params.get("msg")})


@router.post("/mis-aprobaciones/permiso/{apr_id}")
async def decidir_permiso(apr_id: int, user: Empleado = Depends(get_current_user), db: Session = Depends(get_db),
                          decision: str = Form(...), comentario: str = Form("")):
    apr = db.get(Aprobacion, apr_id)
    if not apr or apr.aprobador_id != user.id or decision not in ("aprobada", "rechazada"):
        return RedirectResponse("/mis-aprobaciones?msg=Acción inválida.", status_code=303)
    msg = resolver_aprobacion(db, apr, decision, comentario, actor=user.email)
    return RedirectResponse(f"/mis-aprobaciones?msg={msg}", status_code=303)


@router.post("/mis-aprobaciones/horas-extra/{he_id}")
async def decidir_horas(he_id: int, user: Empleado = Depends(get_current_user), db: Session = Depends(get_db),
                        decision: str = Form(...), comentario: str = Form("")):
    if user.rol not in ("admin", "superadmin"):
        return RedirectResponse("/mis-aprobaciones?msg=Requiere rol de administrador.", status_code=303)
    he = db.get(HoraExtra, he_id)
    if not he or decision not in ("aprobada", "rechazada"):
        return RedirectResponse("/mis-aprobaciones?msg=Solicitud inválida.", status_code=303)
    msg = resolver_horas_extra(db, he, decision, comentario, user)
    return RedirectResponse(f"/mis-aprobaciones?msg={msg}", status_code=303)


@router.post("/mis-aprobaciones/custodia/{traslado_id}")
async def confirmar_custodia(traslado_id: int, user: Empleado = Depends(get_current_user),
                             db: Session = Depends(get_db)):
    traslado = db.get(CustodiaTraslado, traslado_id)
    if not traslado:
        return RedirectResponse("/mis-aprobaciones?msg=Traslado no encontrado.", status_code=303)
    error = sc.confirmar_entrada(db, traslado, user)
    msg = error or "Entrada confirmada."
    return RedirectResponse(f"/mis-aprobaciones?msg={msg}", status_code=303)
