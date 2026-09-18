"""Rutas del módulo Design Schedule: horario del equipo de diseño y su administración."""
from datetime import date
from fastapi import APIRouter, Request, Depends, Form, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Empleado
from ..models_design import DesignArea, DesignTeam, DesignTeamDesigner, DesignCatalogo, DesignAusenciaTipo
from ..auth import require_modulo, require_admin
from ..main_templates import templates
from .. import services_design as sd

router = APIRouter()

NUVIA_DESIGN = "Nuvia Design Colombia SAS"


# ---------- Páginas ----------

@router.get("/design")
async def pagina(request: Request, user: Empleado = Depends(require_modulo("design_schedule")),
                 db: Session = Depends(get_db)):
    return templates.TemplateResponse(request, "design_schedule.html",
                                      {"user": user, "es_design": True})


@router.get("/design/parametros")
async def parametros(request: Request, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    areas = db.query(DesignArea).order_by(DesignArea.orden).all()
    teams = (db.query(DesignTeam).order_by(DesignTeam.orden).all())
    candidatos = (db.query(Empleado).filter(Empleado.empresa == NUVIA_DESIGN, Empleado.activo == 1)
                 .order_by(Empleado.apellidos).all())
    ausencias = db.query(DesignAusenciaTipo).order_by(DesignAusenciaTipo.orden).all()
    catalogos = (db.query(DesignCatalogo).order_by(DesignCatalogo.area_id, DesignCatalogo.tipo,
                                                   DesignCatalogo.orden).all())
    return templates.TemplateResponse(request, "design_parametros.html",
                                      {"user": user, "areas": areas, "teams": teams, "candidatos": candidatos,
                                       "ausencias": ausencias, "catalogos": catalogos, "es_design": True,
                                       "msg": request.query_params.get("msg")})


# ---------- Parámetros: equipos ----------

@router.post("/design/parametros/equipos")
async def crear_equipo(user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                       area_id: int = Form(...), nombre: str = Form(...), manager_id: str = Form("")):
    orden = db.query(DesignTeam).filter(DesignTeam.area_id == area_id).count() + 1
    db.add(DesignTeam(area_id=area_id, nombre=nombre.strip(), orden=orden,
                      manager_id=int(manager_id) if manager_id else None))
    db.commit()
    return RedirectResponse("/design/parametros?msg=Equipo creado.", status_code=303)


@router.post("/design/parametros/equipos/{team_id}/toggle")
async def toggle_equipo(team_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    t = db.get(DesignTeam, team_id)
    if t:
        t.activo = 0 if t.activo else 1
        db.commit()
    return RedirectResponse("/design/parametros", status_code=303)


@router.post("/design/parametros/equipos/{team_id}/designers")
async def agregar_designer(team_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                           empleado_id: int = Form(...)):
    ya_existe = (db.query(DesignTeamDesigner)
                .filter(DesignTeamDesigner.team_id == team_id, DesignTeamDesigner.empleado_id == empleado_id)
                .first())
    if not ya_existe:
        orden = db.query(DesignTeamDesigner).filter(DesignTeamDesigner.team_id == team_id).count() + 1
        db.add(DesignTeamDesigner(team_id=team_id, empleado_id=empleado_id, orden=orden))
        db.commit()
    return RedirectResponse("/design/parametros?msg=Diseñador agregado.", status_code=303)


@router.post("/design/parametros/designers/{registro_id}/quitar")
async def quitar_designer(registro_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    r = db.get(DesignTeamDesigner, registro_id)
    if r:
        db.delete(r)
        db.commit()
    return RedirectResponse("/design/parametros", status_code=303)


# ---------- Parámetros: catálogos ----------

@router.post("/design/parametros/catalogos")
async def crear_valor_catalogo(user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                               area_id: int = Form(...), tipo: str = Form(...), valor: str = Form(...)):
    sd.agregar_valor_catalogo(db, area_id, tipo, valor)
    return RedirectResponse("/design/parametros?msg=Valor agregado.", status_code=303)


@router.post("/design/parametros/catalogos/{cat_id}/toggle")
async def toggle_catalogo(cat_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    c = db.get(DesignCatalogo, cat_id)
    if c:
        c.activo = 0 if c.activo else 1
        db.commit()
    return RedirectResponse("/design/parametros", status_code=303)


@router.post("/design/parametros/ausencias")
async def crear_ausencia(user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                         nombre: str = Form(...)):
    nombre = nombre.strip()
    if nombre and not db.query(DesignAusenciaTipo).filter(DesignAusenciaTipo.nombre == nombre).first():
        orden = db.query(DesignAusenciaTipo).count() + 1
        db.add(DesignAusenciaTipo(nombre=nombre, orden=orden))
        db.commit()
    return RedirectResponse("/design/parametros?msg=Tipo de ausencia agregado.", status_code=303)


@router.post("/design/parametros/ausencias/{aus_id}/toggle")
async def toggle_ausencia(aus_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    a = db.get(DesignAusenciaTipo, aus_id)
    if a:
        a.activo = 0 if a.activo else 1
        db.commit()
    return RedirectResponse("/design/parametros", status_code=303)


# ---------- API: lectura ----------

@router.get("/design/api/areas")
async def api_areas(user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    return [{"id": a.id, "nombre": a.nombre, "formato": a.formato} for a in sd.areas_disponibles(db)]


@router.get("/design/api/teams")
async def api_teams(area_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                    db: Session = Depends(get_db)):
    equipos = sd.equipos_de_area(db, area_id)
    return [{"id": t.id, "nombre": t.nombre, "manager": t.manager.nombre_completo if t.manager else "",
            "designers": [{"id": d.empleado_id, "nombre": d.empleado.nombre_completo} for d in t.designers]}
            for t in equipos]


@router.get("/design/api/catalogo")
async def api_catalogo(area_id: int, tipo: str, user: Empleado = Depends(require_modulo("design_schedule")),
                       db: Session = Depends(get_db)):
    return sd.catalogo(db, area_id, tipo)


@router.get("/design/api/ausencias")
async def api_ausencias(user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    return sd.ausencias_disponibles(db)


@router.get("/design/api/dia")
async def api_dia(team_id: int, fecha: str, user: Empleado = Depends(require_modulo("design_schedule")),
                  db: Session = Depends(get_db)):
    team = db.get(DesignTeam, team_id)
    if not team:
        raise HTTPException(404, "Equipo no encontrado.")
    return sd.datos_dia(db, team, date.fromisoformat(fecha))


# ---------- API: escritura ----------

class OrdenIn(BaseModel):
    teamId: int
    fecha: str
    tabla: str = "principal"
    orden: str = ""
    paciente: str = ""
    centro: str = ""
    producto: str = ""
    designerId: int | None = None
    designerPrestado: str = ""
    horaInicio: str = ""
    horaInicioDiseno: str = ""
    horaFin: str = ""
    holdMinutos: float = 0
    esferas: str = ""
    critico: str = ""
    sHold: str = ""
    fHold: str = ""
    etapa: str = ""
    solicitadoPor: str = ""
    situacion: str = ""
    solucion: str = ""
    clasificacion: str = ""
    soporte: str = ""
    estado: str = ""
    qc: bool = False
    qcReporte: str = ""
    notas: str = ""


def _datos_desde_in(payload: OrdenIn) -> dict:
    return {
        "orden": payload.orden.strip().upper(), "paciente": payload.paciente.strip(),
        "centro": payload.centro.strip(), "producto": payload.producto.strip(),
        "designer_id": payload.designerId, "designer_prestado": payload.designerPrestado.strip(),
        "hora_inicio": payload.horaInicio, "hora_inicio_diseno": payload.horaInicioDiseno,
        "hora_fin": payload.horaFin, "hold_minutos": payload.holdMinutos,
        "esferas": payload.esferas, "critico": payload.critico,
        "s_hold": payload.sHold, "f_hold": payload.fHold,
        "etapa": payload.etapa, "solicitado_por": payload.solicitadoPor, "situacion": payload.situacion,
        "solucion": payload.solucion, "clasificacion": payload.clasificacion, "soporte": payload.soporte,
        "estado": payload.estado, "qc": payload.qc, "qc_reporte": payload.qcReporte, "notas": payload.notas,
    }


@router.post("/design/api/ordenes")
async def api_crear_orden(payload: OrdenIn, user: Empleado = Depends(require_modulo("design_schedule")),
                          db: Session = Depends(get_db)):
    o = sd.crear_orden(db, user, payload.teamId, date.fromisoformat(payload.fecha), payload.tabla,
                       _datos_desde_in(payload))
    return sd.serializar_orden(o)


@router.post("/design/api/ordenes/{orden_id}")
async def api_actualizar_orden(orden_id: int, payload: OrdenIn,
                               user: Empleado = Depends(require_modulo("design_schedule")),
                               db: Session = Depends(get_db)):
    o = sd.actualizar_orden(db, orden_id, _datos_desde_in(payload))
    if not o:
        raise HTTPException(404, "Orden no encontrada.")
    return sd.serializar_orden(o)


@router.post("/design/api/ordenes/{orden_id}/eliminar")
async def api_eliminar_orden(orden_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                             db: Session = Depends(get_db)):
    if not sd.eliminar_orden(db, orden_id):
        raise HTTPException(404, "Orden no encontrada.")
    return {"mensaje": "Eliminada."}


class BreakIn(BaseModel):
    teamId: int
    empleadoId: int
    fecha: str
    tipoAusencia: str = ""
    almuerzoInicio: str = ""
    almuerzoFin: str = ""
    break1Inicio: str = ""
    break1Fin: str = ""
    break2Inicio: str = ""
    break2Fin: str = ""


@router.post("/design/api/breaks")
async def api_guardar_break(payload: BreakIn, user: Empleado = Depends(require_modulo("design_schedule")),
                            db: Session = Depends(get_db)):
    b = sd.guardar_break(db, payload.teamId, payload.empleadoId, date.fromisoformat(payload.fecha), {
        "tipo_ausencia": payload.tipoAusencia,
        "almuerzo_inicio": payload.almuerzoInicio, "almuerzo_fin": payload.almuerzoFin,
        "break1_inicio": payload.break1Inicio, "break1_fin": payload.break1Fin,
        "break2_inicio": payload.break2Inicio, "break2_fin": payload.break2Fin,
    })
    return sd.serializar_break(b)
