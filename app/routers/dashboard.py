from datetime import date
from fastapi import APIRouter, Request, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from ..database import get_db
from ..models import Empleado, Solicitud, TipoPermiso
from ..auth import require_modulo, empresa_filtro
from ..services import saldo_disponible, pendientes_de
from ..main_templates import templates

router = APIRouter()


@router.get("/panel")
async def home(request: Request, user: Empleado = Depends(require_modulo("people")),
               db: Session = Depends(get_db)):
    anio = date.today().year
    tipos = db.query(TipoPermiso).filter(TipoPermiso.activo == 1).all()
    saldos = [(t, saldo_disponible(db, user, t, anio)) for t in tipos]
    pendientes_aprobar = len(pendientes_de(db, user))

    metricas = None
    if user.rol in ("admin", "superadmin"):
        empresa_propia = empresa_filtro(user)
        q_sol = db.query(Solicitud.estado, func.count()).join(Empleado, Solicitud.empleado_id == Empleado.id)
        q_area = (db.query(Empleado.area, func.count())
                 .join(Solicitud, Solicitud.empleado_id == Empleado.id)
                 .filter(Solicitud.estado == "aprobada"))
        q_emp = db.query(func.count(Empleado.id)).filter(Empleado.activo == 1)
        if empresa_propia is not None:
            q_sol = q_sol.filter(Empleado.empresa == empresa_propia)
            q_area = q_area.filter(Empleado.empresa == empresa_propia)
            q_emp = q_emp.filter(Empleado.empresa == empresa_propia)
        por_estado = dict(q_sol.group_by(Solicitud.estado).all())
        por_area = q_area.group_by(Empleado.area).order_by(func.count().desc()).all()
        metricas = {
            "pendientes": por_estado.get("pendiente_1", 0) + por_estado.get("pendiente_2", 0),
            "aprobadas": por_estado.get("aprobada", 0),
            "rechazadas": por_estado.get("rechazada", 0),
            "empleados": q_emp.scalar(),
            "por_area": por_area,
        }
    return templates.TemplateResponse(request, "dashboard.html",
                                      {"user": user, "saldos": saldos, "anio": anio,
                                       "pendientes_aprobar": pendientes_aprobar,
                                       "metricas": metricas})
