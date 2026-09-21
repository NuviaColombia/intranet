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


@router.get("/design/dashboard")
async def pagina_dashboard(request: Request, user: Empleado = Depends(require_modulo("design_schedule")),
                           db: Session = Depends(get_db)):
    areas = sd.areas_disponibles(db)
    return templates.TemplateResponse(request, "design_dashboard.html",
                                      {"user": user, "areas": areas, "es_design": True})


@router.get("/design/comments")
async def pagina_comments(request: Request, user: Empleado = Depends(require_modulo("design_schedule")),
                          db: Session = Depends(get_db)):
    areas = sd.areas_disponibles(db)
    return templates.TemplateResponse(request, "design_comments.html",
                                      {"user": user, "areas": areas, "es_design": True})


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


# ---------- API: Dashboard ----------

@router.get("/design/api/dashboard")
async def api_dashboard(area_id: int | None = None, team_id: int | None = None, designer_id: int | None = None,
                        producto: str = "", estado: str = "", qc: str = "",
                        fecha_desde: str = "", fecha_hasta: str = "",
                        user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    fd = date.fromisoformat(fecha_desde) if fecha_desde else None
    fh = date.fromisoformat(fecha_hasta) if fecha_hasta else None
    return sd.dashboard_query(db, area_id, team_id, designer_id, producto, estado, qc, fd, fh)


@router.get("/design/api/buscar")
async def api_buscar(q: str, user: Empleado = Depends(require_modulo("design_schedule")),
                     db: Session = Depends(get_db)):
    return sd.buscar_ordenes(db, q)


# ---------- API: Comments N3 (historial) ----------

@router.get("/design/api/comentarios/historial")
async def api_historial_comentarios(user: Empleado = Depends(require_modulo("design_schedule")),
                                    db: Session = Depends(get_db)):
    return sd.historial_comentarios(db)


class HistorialComentarioIn(BaseModel):
    paciente: str = ""
    orden: str = ""
    campos: dict


@router.post("/design/api/comentarios/historial")
async def api_guardar_historial(payload: HistorialComentarioIn,
                                user: Empleado = Depends(require_modulo("design_schedule")),
                                db: Session = Depends(get_db)):
    sd.guardar_historial_comentario(db, user, payload.paciente, payload.orden, payload.campos)
    return {"mensaje": "Guardado en historial."}


@router.post("/design/api/comentarios/historial/{historial_id}/eliminar")
async def api_eliminar_historial(historial_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                                 db: Session = Depends(get_db)):
    if not sd.eliminar_historial_comentario(db, historial_id):
        raise HTTPException(404, "No encontrado.")
    return {"mensaje": "Eliminado."}


# ---------- API: FAQ (Comments N2 / Face) ----------

@router.get("/design/api/faq")
async def api_faq(area_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                  db: Session = Depends(get_db)):
    filas = sd.faq_de_area(db, area_id)
    return [{"id": f.id, "seccion": f.seccion, "situacion": f.situacion, "producto": f.producto,
            "comoProceder": f.como_proceder, "plantilla": f.plantilla, "ejemplos": f.ejemplos} for f in filas]


@router.post("/design/api/faq")
async def api_crear_faq(area_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                        db: Session = Depends(get_db)):
    f = sd.crear_faq(db, area_id)
    return {"id": f.id}


class FaqIn(BaseModel):
    seccion: str = ""
    situacion: str = ""
    producto: str = ""
    comoProceder: str = ""
    plantilla: str = ""
    ejemplos: str = ""


@router.post("/design/api/faq/{faq_id}")
async def api_actualizar_faq(faq_id: int, payload: FaqIn,
                             user: Empleado = Depends(require_modulo("design_schedule")),
                             db: Session = Depends(get_db)):
    f = sd.actualizar_faq(db, faq_id, {
        "seccion": payload.seccion, "situacion": payload.situacion, "producto": payload.producto,
        "como_proceder": payload.comoProceder, "plantilla": payload.plantilla, "ejemplos": payload.ejemplos,
    })
    if not f:
        raise HTTPException(404, "No encontrado.")
    return {"mensaje": "Actualizado."}


@router.post("/design/api/faq/{faq_id}/eliminar")
async def api_eliminar_faq(faq_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                           db: Session = Depends(get_db)):
    if not sd.eliminar_faq(db, faq_id):
        raise HTTPException(404, "No encontrado.")
    return {"mensaje": "Eliminado."}


# ---------- Página: Pre-Approved ----------

@router.get("/design/preapproved")
async def pagina_preapproved(request: Request, user: Empleado = Depends(require_modulo("design_schedule")),
                             db: Session = Depends(get_db)):
    areas = sd.areas_disponibles(db)
    return templates.TemplateResponse(request, "design_preapproved.html",
                                      {"user": user, "areas": areas, "es_design": True})


# ---------- API: Pre-Approved ----------

@router.get("/design/api/preapproved/sheets")
async def api_preapproved_sheets(area_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                                 db: Session = Depends(get_db)):
    return [{"id": s.id, "nombre": s.nombre} for s in sd.preapproved_sheets(db, area_id)]


@router.get("/design/api/preapproved/sheets/{sheet_id}")
async def api_preapproved_detalle(sheet_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                                  db: Session = Depends(get_db)):
    detalle = sd.preapproved_detalle(db, sheet_id)
    if not detalle:
        raise HTTPException(404, "Hoja no encontrada.")
    return detalle


@router.post("/design/api/preapproved/sheets")
async def api_crear_preapproved_sheet(area_id: int, nombre: str = "",
                                      user: Empleado = Depends(require_modulo("design_schedule")),
                                      db: Session = Depends(get_db)):
    s = sd.crear_preapproved_sheet(db, area_id, nombre)
    return {"id": s.id, "nombre": s.nombre}


class PreApprovedSheetIn(BaseModel):
    nombre: str = ""
    titulo: str = ""
    changesLabel: str = ""


@router.post("/design/api/preapproved/sheets/{sheet_id}")
async def api_actualizar_preapproved_sheet(sheet_id: int, payload: PreApprovedSheetIn,
                                           user: Empleado = Depends(require_modulo("design_schedule")),
                                           db: Session = Depends(get_db)):
    s = sd.actualizar_preapproved_sheet(db, sheet_id, {"nombre": payload.nombre, "titulo": payload.titulo,
                                                       "changes_label": payload.changesLabel})
    if not s:
        raise HTTPException(404, "No encontrada.")
    return {"mensaje": "Actualizado."}


@router.post("/design/api/preapproved/sheets/{sheet_id}/eliminar")
async def api_eliminar_preapproved_sheet(sheet_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                                         db: Session = Depends(get_db)):
    if not sd.eliminar_preapproved_sheet(db, sheet_id, user.nombre_completo):
        raise HTTPException(404, "No encontrada.")
    return {"mensaje": "Eliminada."}


@router.post("/design/api/preapproved/sheets/{sheet_id}/centros")
async def api_agregar_centro(sheet_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                             db: Session = Depends(get_db)):
    c = sd.preapproved_agregar_centro(db, sheet_id)
    return {"id": c.id}


class CentroIn(BaseModel):
    nombre: str = ""
    span: int = 1


@router.post("/design/api/preapproved/centros/{centro_id}")
async def api_actualizar_centro(centro_id: int, payload: CentroIn,
                                user: Empleado = Depends(require_modulo("design_schedule")),
                                db: Session = Depends(get_db)):
    sd.preapproved_actualizar_centro(db, centro_id, payload.nombre, payload.span)
    return {"mensaje": "Actualizado."}


@router.post("/design/api/preapproved/centros/{centro_id}/eliminar")
async def api_eliminar_centro(centro_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                              db: Session = Depends(get_db)):
    if not sd.preapproved_eliminar_centro(db, centro_id, user.nombre_completo):
        raise HTTPException(404, "No encontrado.")
    return {"mensaje": "Eliminado."}


@router.post("/design/api/preapproved/sheets/{sheet_id}/doctores")
async def api_agregar_doctor(sheet_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                             db: Session = Depends(get_db)):
    d = sd.preapproved_agregar_doctor(db, sheet_id)
    return {"id": d.id}


class NombreIn(BaseModel):
    nombre: str = ""


@router.post("/design/api/preapproved/doctores/{doctor_id}")
async def api_renombrar_doctor(doctor_id: int, payload: NombreIn,
                               user: Empleado = Depends(require_modulo("design_schedule")),
                               db: Session = Depends(get_db)):
    sd.preapproved_renombrar_doctor(db, doctor_id, payload.nombre)
    return {"mensaje": "Actualizado."}


@router.post("/design/api/preapproved/doctores/{doctor_id}/eliminar")
async def api_eliminar_doctor(doctor_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                              db: Session = Depends(get_db)):
    if not sd.preapproved_eliminar_doctor(db, doctor_id, user.nombre_completo):
        raise HTTPException(404, "No encontrado.")
    return {"mensaje": "Eliminado."}


@router.post("/design/api/preapproved/sheets/{sheet_id}/filas")
async def api_agregar_fila(sheet_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                           db: Session = Depends(get_db)):
    f = sd.preapproved_agregar_fila(db, sheet_id)
    return {"id": f.id}


@router.post("/design/api/preapproved/filas/{fila_id}")
async def api_renombrar_fila(fila_id: int, payload: NombreIn,
                             user: Empleado = Depends(require_modulo("design_schedule")),
                             db: Session = Depends(get_db)):
    sd.preapproved_renombrar_fila(db, fila_id, payload.nombre)
    return {"mensaje": "Actualizado."}


@router.post("/design/api/preapproved/filas/{fila_id}/eliminar")
async def api_eliminar_fila(fila_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                            db: Session = Depends(get_db)):
    if not sd.preapproved_eliminar_fila(db, fila_id, user.nombre_completo):
        raise HTTPException(404, "No encontrada.")
    return {"mensaje": "Eliminada."}


class CeldaIn(BaseModel):
    filaId: int
    doctorId: int
    valor: str = ""


@router.post("/design/api/preapproved/celdas")
async def api_guardar_celda(payload: CeldaIn, user: Empleado = Depends(require_modulo("design_schedule")),
                            db: Session = Depends(get_db)):
    sd.preapproved_guardar_celda(db, payload.filaId, payload.doctorId, payload.valor)
    return {"mensaje": "Guardado."}


# ---------- Desempeño (solo administradores: datos sensibles de RR.HH.) ----------

@router.get("/design/perf")
async def pagina_perf(request: Request, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    sheets = sd.perf_sheets(db)
    return templates.TemplateResponse(request, "design_perf.html",
                                      {"user": user, "sheets": sheets, "es_design": True})


@router.get("/design/api/perf/sheets")
async def api_perf_sheets(user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    return [{"id": s.id, "nombre": s.nombre, "tipo": s.tipo} for s in sd.perf_sheets(db)]


@router.get("/design/api/perf/sheets/{sheet_id}/eval")
async def api_perf_detalle_eval(sheet_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    detalle = sd.perf_detalle_eval(db, sheet_id)
    if not detalle:
        raise HTTPException(404, "Hoja no encontrada")
    return detalle


class PerfCeldaIn(BaseModel):
    empleadoId: int
    criterioId: int
    mesIndice: int
    nivel: str = ""
    puntaje: float = 0


@router.post("/design/api/perf/celdas")
async def api_perf_guardar_celda(payload: PerfCeldaIn, user: Empleado = Depends(require_admin),
                                 db: Session = Depends(get_db)):
    sd.perf_guardar_celda(db, payload.empleadoId, payload.criterioId, payload.mesIndice,
                          payload.nivel, payload.puntaje)
    return {"mensaje": "Guardado."}


class PerfNotaIn(BaseModel):
    nota: str = ""


@router.post("/design/api/perf/empleados/{empleado_id}/nota")
async def api_perf_guardar_nota(empleado_id: int, payload: PerfNotaIn, user: Empleado = Depends(require_admin),
                                db: Session = Depends(get_db)):
    sd.perf_guardar_nota(db, empleado_id, payload.nota)
    return {"mensaje": "Guardado."}


@router.get("/design/api/perf/sheets/{sheet_id}/seleccion")
async def api_perf_detalle_seleccion(sheet_id: int, user: Empleado = Depends(require_admin),
                                     db: Session = Depends(get_db)):
    detalle = sd.perf_detalle_seleccion(db, sheet_id)
    if not detalle:
        raise HTTPException(404, "Hoja no encontrada")
    return detalle


class PerfGanadorMesIn(BaseModel):
    mesIndice: int
    nombre: str = ""


@router.post("/design/api/perf/ganadores/{ganador_id}")
async def api_perf_guardar_ganador(ganador_id: int, payload: PerfGanadorMesIn, user: Empleado = Depends(require_admin),
                                   db: Session = Depends(get_db)):
    sd.perf_guardar_ganador_mes(db, ganador_id, payload.mesIndice, payload.nombre)
    return {"mensaje": "Guardado."}


class PerfCeldaSeleccionIn(BaseModel):
    mesIndice: int
    persona: str = ""
    puntaje: str = ""
    nota: str = ""


@router.post("/design/api/perf/filas/{fila_id}/celdas")
async def api_perf_guardar_celda_seleccion(fila_id: int, payload: PerfCeldaSeleccionIn,
                                           user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    sd.perf_guardar_celda_seleccion(db, fila_id, payload.mesIndice, payload.persona, payload.puntaje, payload.nota)
    return {"mensaje": "Guardado."}


# ---------- Papelera ----------

@router.get("/design/papelera")
async def pagina_papelera(request: Request, user: Empleado = Depends(require_modulo("design_schedule"))):
    return templates.TemplateResponse(request, "design_papelera.html", {"user": user, "es_design": True})


@router.get("/design/api/papelera")
async def api_papelera_listar(user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    return [{"id": t.id, "modulo": t.modulo, "etiqueta": t.etiqueta, "eliminado_por": t.eliminado_por,
            "eliminado_en": t.eliminado_en.strftime("%d/%m/%Y %H:%M")} for t in sd.trash_listar(db)]


@router.post("/design/api/papelera/{trash_id}/restaurar")
async def api_papelera_restaurar(trash_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                                 db: Session = Depends(get_db)):
    if not sd.trash_restaurar(db, trash_id):
        raise HTTPException(400, "No se pudo restaurar (el destino cambió demasiado o ya no existe).")
    return {"mensaje": "Restaurado."}


@router.post("/design/api/papelera/{trash_id}/eliminar")
async def api_papelera_eliminar(trash_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                                db: Session = Depends(get_db)):
    if not sd.trash_eliminar_permanente(db, trash_id):
        raise HTTPException(404, "No encontrado.")
    return {"mensaje": "Eliminado del historial."}


@router.post("/design/api/papelera/vaciar")
async def api_papelera_vaciar(user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    sd.trash_vaciar(db)
    return {"mensaje": "Historial vaciado."}


# ---------- Favoritos ----------

@router.get("/design/favoritos")
async def pagina_favoritos(request: Request, user: Empleado = Depends(require_modulo("design_schedule"))):
    return templates.TemplateResponse(request, "design_favoritos.html", {"user": user, "es_design": True})


@router.get("/design/api/favoritos")
async def api_favoritos(user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    return sd.favoritos_de(db, user.id)


@router.get("/design/api/favoritos/activos")
async def api_favoritos_activos(user: Empleado = Depends(require_modulo("design_schedule")),
                                db: Session = Depends(get_db)):
    activos = sd.favoritos_activos(db, user.id)
    return {"teams": list(activos["teams"]), "preapproved": list(activos["preapproved"])}


@router.post("/design/api/favoritos/team/{team_id}/toggle")
async def api_favorito_toggle_team(team_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                                   db: Session = Depends(get_db)):
    return {"favorito": sd.favorito_toggle_team(db, user.id, team_id)}


@router.post("/design/api/favoritos/preapproved/{sheet_id}/toggle")
async def api_favorito_toggle_preapproved(sheet_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                                          db: Session = Depends(get_db)):
    return {"favorito": sd.favorito_toggle_preapproved(db, user.id, sheet_id)}
