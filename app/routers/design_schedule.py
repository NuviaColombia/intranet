"""Rutas del módulo Design Schedule: horario del equipo de diseño y su administración."""
import asyncio
import os
import re
import weakref
from datetime import date
from typing import Literal
from fastapi import APIRouter, Request, Depends, Form, HTTPException
from fastapi.routing import APIRoute
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import RedirectResponse, Response, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Empleado
from ..models_design import (DesignArea, DesignTeam, DesignTeamDesigner, DesignCatalogo, DesignAusenciaTipo, DesignOrden,
                             DesignPerfSheet, DesignPerfEmpleado, DesignPerfSeleccionFila)
from ..auth import require_modulo, require_admin, require_design_manager
from ..main_templates import templates
from .. import services_design as sd

# Tope de peticiones de Design usando la base a la vez. Sin él, un pico (p. ej. 130 personas abriendo el
# horario al inicio del turno) trababa el servidor: las peticiones que esperaban conexión del pool (5 + 10,
# compartido con todos los módulos) ocupaban los 40 hilos de FastAPI, y las que ya tenían conexión no
# conseguían hilo para terminar y devolverla -> 30 s de espera y error 500. Aquí la espera ocurre antes de
# tomar hilo o conexión, así que Design nunca agota ni los hilos ni el pool de los demás módulos.
# Se puede ajustar con la variable de entorno DESIGN_CONCURRENCIA (debe quedar por debajo del tamaño del pool).
DESIGN_CONCURRENCIA = max(1, int(os.getenv("DESIGN_CONCURRENCIA", "8")))
_cupos_por_loop: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Semaphore]" = weakref.WeakKeyDictionary()


def _cupos_design() -> asyncio.Semaphore:
    loop = asyncio.get_running_loop()  # uno por event loop (las pruebas crean varios)
    sem = _cupos_por_loop.get(loop)
    if sem is None:
        sem = _cupos_por_loop[loop] = asyncio.Semaphore(DESIGN_CONCURRENCIA)
    return sem


class _RutaDesign(APIRoute):
    def get_route_handler(self):
        original = super().get_route_handler()

        async def handler(request: Request):
            async with _cupos_design():
                return await original(request)
        return handler


router = APIRouter(route_class=_RutaDesign)

NUVIA_DESIGN = "Nuvia Design Colombia SAS"


# ---------- Páginas ----------

@router.get("/design")
def pagina(request: Request, user: Empleado = Depends(require_modulo("design_schedule")),
                 db: Session = Depends(get_db)):
    # Áreas y tipos de ausencia van dentro de la página: son 2 peticiones menos por persona al abrir el horario.
    areas = sd.areas_disponibles(db)
    inicio = {"areas": [{"id": a.id, "nombre": a.nombre, "formato": a.formato} for a in areas],
              "ausencias": sd.ausencias_disponibles(db)}
    # `areas` también llena el filtro de Área del Dashboard (desde que Design es una sola página salía vacío).
    return templates.TemplateResponse(request, "design_schedule.html",
                                      {"user": user, "es_design": True, "ds_inicio": inicio, "areas": areas})


def _redirigir_a_panel(request: Request, panel: str) -> RedirectResponse:
    """Las antiguas páginas independientes (Dashboard, Comments, etc.) ahora son paneles
    superpuestos dentro de /design, igual que en la herramienta original. Se conservan estas
    rutas como redirects (por si hay enlaces guardados) que abren el panel correspondiente."""
    qs = request.url.query
    destino = f"/design?panel={panel}" + (f"&{qs}" if qs else "")
    return RedirectResponse(destino, status_code=303)


@router.get("/design/dashboard")
def pagina_dashboard(request: Request, user: Empleado = Depends(require_design_manager)):
    return _redirigir_a_panel(request, "dashboard")


@router.get("/design/comments")
def pagina_comments(request: Request, user: Empleado = Depends(require_modulo("design_schedule"))):
    return _redirigir_a_panel(request, "comments")


@router.get("/design/parametros")
def parametros(request: Request, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    areas = sd.ordenar_areas(db.query(DesignArea).all())
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


# ---------- Parámetros: importar equipos desde Desempeño ----------

@router.get("/design/api/parametros/importar-equipos-preview")
def api_importar_equipos_preview(user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    return sd.importar_equipos_desde_desempeno(db, aplicar=False)


@router.post("/design/api/parametros/importar-equipos")
def api_importar_equipos_aplicar(user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    return sd.importar_equipos_desde_desempeno(db, aplicar=True)


# ---------- Parámetros: equipos ----------

@router.post("/design/parametros/equipos")
def crear_equipo(user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                       area_id: int = Form(...), nombre: str = Form(...), manager_id: str = Form("")):
    orden = db.query(DesignTeam).filter(DesignTeam.area_id == area_id).count() + 1
    db.add(DesignTeam(area_id=area_id, nombre=nombre.strip(), orden=orden,
                      manager_id=int(manager_id) if manager_id else None))
    db.commit()
    return RedirectResponse("/design/parametros?msg=Equipo creado.", status_code=303)


@router.post("/design/parametros/equipos/{team_id}/toggle")
def toggle_equipo(team_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    t = db.get(DesignTeam, team_id)
    if t:
        t.activo = 0 if t.activo else 1
        db.commit()
    return RedirectResponse("/design/parametros", status_code=303)


@router.post("/design/parametros/equipos/{team_id}/designers")
def agregar_designer(team_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
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
def quitar_designer(registro_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    r = db.get(DesignTeamDesigner, registro_id)
    if r:
        db.delete(r)
        db.commit()
    return RedirectResponse("/design/parametros", status_code=303)


# ---------- Parámetros: catálogos ----------

@router.post("/design/parametros/catalogos")
def crear_valor_catalogo(user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                               area_id: int = Form(...), tipo: str = Form(...), valor: str = Form(...)):
    sd.agregar_valor_catalogo(db, area_id, tipo, valor)
    return RedirectResponse("/design/parametros?msg=Valor agregado.", status_code=303)


@router.post("/design/parametros/catalogos/{cat_id}/toggle")
def toggle_catalogo(cat_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    c = db.get(DesignCatalogo, cat_id)
    if c:
        c.activo = 0 if c.activo else 1
        db.commit()
    return RedirectResponse("/design/parametros", status_code=303)


@router.post("/design/parametros/ausencias")
def crear_ausencia(user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                         nombre: str = Form(...)):
    nombre = nombre.strip()
    if nombre and not db.query(DesignAusenciaTipo).filter(DesignAusenciaTipo.nombre == nombre).first():
        orden = db.query(DesignAusenciaTipo).count() + 1
        db.add(DesignAusenciaTipo(nombre=nombre, orden=orden))
        db.commit()
    return RedirectResponse("/design/parametros?msg=Tipo de ausencia agregado.", status_code=303)


@router.post("/design/parametros/ausencias/{aus_id}/toggle")
def toggle_ausencia(aus_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    a = db.get(DesignAusenciaTipo, aus_id)
    if a:
        a.activo = 0 if a.activo else 1
        db.commit()
    return RedirectResponse("/design/parametros", status_code=303)


# ---------- API: lectura ----------

def _verificar_equipo(db: Session, user: Empleado, team_id: int) -> DesignTeam:
    team = db.get(DesignTeam, team_id)
    if not team:
        raise HTTPException(404, "Equipo no encontrado.")
    if not sd.gestiona_equipo(user, team) and team_id not in sd.equipos_como_designer(db, user):
        raise HTTPException(403, "No tienes acceso a este equipo.")
    return team


SOLO_MANAGER = "Solo el manager del equipo o un administrador puede crear o eliminar órdenes."


@router.get("/design/api/areas")
def api_areas(user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    return _areas_json(db)


def _areas_json(db: Session) -> list[dict]:
    return [{"id": a.id, "nombre": a.nombre, "formato": a.formato} for a in sd.areas_disponibles(db)]


@router.get("/design/api/teams")
def api_teams(area_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                    db: Session = Depends(get_db)):
    ids_designer = sd.equipos_como_designer(db, user)
    equipos = [t for t in sd.equipos_de_area(db, area_id) if sd.puede_ver_equipo(user, t, ids_designer)]

    def designers(t):
        ds = t.designers if sd.gestiona_equipo(user, t) else [d for d in t.designers if d.empleado_id == user.id]
        return [{"id": d.empleado_id, "nombre": d.empleado.nombre_completo} for d in ds]
    return [{"id": t.id, "nombre": t.nombre, "manager": t.manager.nombre_completo if t.manager else "",
            "designers": designers(t)} for t in equipos]


@router.get("/design/api/catalogo")
def api_catalogo(area_id: int, tipo: str, user: Empleado = Depends(require_modulo("design_schedule")),
                       db: Session = Depends(get_db)):
    return sd.catalogo(db, area_id, tipo)


@router.get("/design/api/catalogos")
def api_catalogos(area_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                  db: Session = Depends(get_db)):
    """Todos los catálogos del área en una sola petición ({tipo: [valores]}); antes era una por columna."""
    return sd.catalogos_de_area(db, area_id)


@router.get("/design/api/ausencias")
def api_ausencias(user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    return sd.ausencias_disponibles(db)


def _fecha(texto: str) -> date:
    try:
        return date.fromisoformat(str(texto)[:10])
    except ValueError:
        raise HTTPException(400, "Fecha inválida.")


@router.get("/design/api/dia")
def api_dia(team_id: int, fecha: str, user: Empleado = Depends(require_modulo("design_schedule")),
                  db: Session = Depends(get_db)):
    team = _verificar_equipo(db, user, team_id)
    return sd.datos_dia(db, team, _fecha(fecha), None if sd.gestiona_equipo(user, team) else user.id)


@router.get("/design/api/todas-areas")
def api_todas_areas(fecha: str, user: Empleado = Depends(require_modulo("design_schedule")),
                          db: Session = Depends(get_db)):
    return sd.resumen_todas_areas(db, user, _fecha(fecha))


# ---------- API: escritura ----------

class OrdenIn(BaseModel):
    teamId: int
    fecha: str
    tabla: Literal["principal", "nightguard"] = "principal"
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


DIA_CERRADO = "Este día ya se cerró (5:00 am del día siguiente) y no se puede editar."


@router.post("/design/api/ordenes")
def api_crear_orden(payload: OrdenIn, user: Empleado = Depends(require_modulo("design_schedule")),
                          db: Session = Depends(get_db)):
    if not sd.gestiona_equipo(user, _verificar_equipo(db, user, payload.teamId)):
        raise HTTPException(403, SOLO_MANAGER)
    if sd.dia_cerrado(_fecha(payload.fecha)):
        raise HTTPException(403, DIA_CERRADO)
    datos = _datos_desde_in(payload)
    if sd.orden_repetida(db, payload.teamId, _fecha(payload.fecha), datos["orden"]):
        raise HTTPException(400, _msg_repetida(datos["orden"]))
    o = sd.crear_orden(db, user, payload.teamId, _fecha(payload.fecha), payload.tabla, datos)
    return sd.serializar_orden(o)


def _msg_repetida(orden: str) -> str:
    return f'Ya existe una orden con el número "{orden}" en este día. Usa un número distinto.'


@router.get("/design/api/prestables")
def api_prestables(team_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                   db: Session = Depends(get_db)):
    """Diseñador prestado ("Others"): los otros equipos de la misma área con sus diseñadores."""
    team = _verificar_equipo(db, user, team_id)
    if not sd.gestiona_equipo(user, team):
        raise HTTPException(403, "Solo el manager del equipo asigna diseñadores.")
    return sd.equipos_prestables(db, team)


@router.get("/design/api/support/autocompletar")
def api_support_autocompletar(team_id: int, orden: str, user: Empleado = Depends(require_modulo("design_schedule")),
                              db: Session = Depends(get_db)):
    """Support: paciente, centro, producto y diseñador del caso, tomados del horario donde ya existe la orden."""
    team = _verificar_equipo(db, user, team_id)
    if team.area.formato != "support":
        raise HTTPException(400, "Solo disponible en Support.")
    return sd.autocompletar_support(db, orden) or {}


class LoteIn(BaseModel):
    teamId: int
    fecha: str
    tabla: Literal["principal", "nightguard"] = "principal"
    filas: list[dict] = []  # cada fila con los mismos campos de OrdenIn (vacía = orden en blanco)


MAX_LOTE = 100


# Va antes de /design/api/ordenes/{orden_id} para que "lote" no se tome como un id.
@router.post("/design/api/ordenes/lote")
def api_crear_ordenes_lote(payload: LoteIn, user: Empleado = Depends(require_modulo("design_schedule")),
                                 db: Session = Depends(get_db)):
    """Crea varias órdenes de una vez: "+ Agregar orden" con cantidad, pegar un bloque con filas nuevas y
    deshacer una eliminación. Devuelve las órdenes creadas en el mismo orden."""
    if not sd.gestiona_equipo(user, _verificar_equipo(db, user, payload.teamId)):
        raise HTTPException(403, SOLO_MANAGER)
    fecha = _fecha(payload.fecha)
    if sd.dia_cerrado(fecha):
        raise HTTPException(403, DIA_CERRADO)
    if not 1 <= len(payload.filas) <= MAX_LOTE:
        raise HTTPException(400, f"Se pueden crear entre 1 y {MAX_LOTE} órdenes por vez.")
    try:
        validadas = [OrdenIn.model_validate({**fila, "teamId": payload.teamId, "fecha": payload.fecha, "tabla": payload.tabla})
                     for fila in payload.filas]
    except ValueError as e:
        raise HTTPException(400, f"Hay filas con datos inválidos: {str(e)[:200]}")
    vistos = set()
    for datos in validadas:  # número repetido: contra el día y dentro del mismo lote
        n = datos.orden.strip().upper()
        if n and (n in vistos or sd.orden_repetida(db, payload.teamId, fecha, n)):
            raise HTTPException(400, _msg_repetida(n))
        vistos.add(n)
    creadas = []
    for datos in validadas:
        creadas.append(sd.serializar_orden(sd.crear_orden(db, user, payload.teamId, fecha, payload.tabla,
                                                         _datos_desde_in(datos))))
    return creadas


@router.post("/design/api/ordenes/{orden_id}")
def api_actualizar_orden(orden_id: int, payload: OrdenIn,
                               user: Empleado = Depends(require_modulo("design_schedule")),
                               db: Session = Depends(get_db)):
    orden_existente = db.get(DesignOrden, orden_id)
    if not orden_existente:
        raise HTTPException(404, "Orden no encontrada.")
    team = db.get(DesignTeam, orden_existente.team_id)
    solo_propia = not sd.gestiona_equipo(user, team)
    if solo_propia:
        # Un diseñador edita sus órdenes: las de su equipo y las de otro equipo que se lo pidió prestado.
        propia = orden_existente.designer_id == user.id and (
            team.id in sd.equipos_como_designer(db, user) or sd.es_orden_prestada_a(db, orden_existente, user))
        if not propia:
            raise HTTPException(403, "Solo puedes editar las órdenes que tienes asignadas.")
    if sd.dia_cerrado(orden_existente.fecha):
        # Día cerrado: solo el QC (checkbox + reporte de hallazgos), y solo hasta las 5:00 am de D+2.
        # El resto de campos se ignora.
        if not sd.qc_editable(orden_existente.fecha):
            raise HTTPException(403, DIA_CERRADO)
        o = sd.actualizar_orden(db, orden_id, {"qc": payload.qc, "qc_reporte": payload.qcReporte})
        return sd.serializar_orden(o)
    datos = _datos_desde_in(payload)
    if (datos["orden"] != (orden_existente.orden or "").strip().upper()
            and sd.orden_repetida(db, orden_existente.team_id, orden_existente.fecha, datos["orden"], orden_id)):
        raise HTTPException(400, _msg_repetida(datos["orden"]))
    if solo_propia:  # un diseñador edita su fila pero no la reasigna
        datos["designer_id"] = orden_existente.designer_id
        datos["designer_prestado"] = orden_existente.designer_prestado
    o = sd.actualizar_orden(db, orden_id, datos)
    return sd.serializar_orden(o)


@router.post("/design/api/ordenes/{orden_id}/eliminar")
def api_eliminar_orden(orden_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                             db: Session = Depends(get_db)):
    orden_existente = db.get(DesignOrden, orden_id)
    if not orden_existente:
        raise HTTPException(404, "Orden no encontrada.")
    if not sd.gestiona_equipo(user, _verificar_equipo(db, user, orden_existente.team_id)):
        raise HTTPException(403, SOLO_MANAGER)
    if sd.dia_cerrado(orden_existente.fecha):
        raise HTTPException(403, DIA_CERRADO)
    sd.eliminar_orden(db, orden_id)
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
def api_guardar_break(payload: BreakIn, user: Empleado = Depends(require_modulo("design_schedule")),
                            db: Session = Depends(get_db)):
    team = _verificar_equipo(db, user, payload.teamId)
    if not sd.gestiona_equipo(user, team) and payload.empleadoId != user.id:
        raise HTTPException(403, "Solo puedes registrar tus propios tiempos libres.")
    if sd.dia_cerrado(_fecha(payload.fecha)):
        raise HTTPException(403, DIA_CERRADO)
    b = sd.guardar_break(db, payload.teamId, payload.empleadoId, _fecha(payload.fecha), {
        "tipo_ausencia": payload.tipoAusencia,
        "almuerzo_inicio": payload.almuerzoInicio, "almuerzo_fin": payload.almuerzoFin,
        "break1_inicio": payload.break1Inicio, "break1_fin": payload.break1Fin,
        "break2_inicio": payload.break2Inicio, "break2_fin": payload.break2Fin,
    })
    return sd.serializar_break(b)


# ---------- API: Dashboard ----------

@router.get("/design/api/dashboard")
def api_dashboard(area_id: int | None = None, team_id: int | None = None, designer_id: int | None = None,
                        producto: str = "", estado: str = "", qc: str = "",
                        fecha_desde: str = "", fecha_hasta: str = "",
                        user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    fd = _fecha(fecha_desde) if fecha_desde else None
    fh = _fecha(fecha_hasta) if fecha_hasta else None
    return sd.dashboard_query(db, area_id, team_id, designer_id, producto, estado, qc, fd, fh, user)


@router.get("/design/api/buscar")
def api_buscar(q: str, user: Empleado = Depends(require_modulo("design_schedule")),
                     db: Session = Depends(get_db)):
    return sd.buscar_ordenes(db, q, user)


# ---------- API: Comments N3 (historial) ----------

@router.get("/design/api/comentarios/historial")
def api_historial_comentarios(user: Empleado = Depends(require_modulo("design_schedule")),
                                    db: Session = Depends(get_db)):
    return sd.historial_comentarios(db)


class HistorialComentarioIn(BaseModel):
    paciente: str = ""
    orden: str = ""
    campos: dict


@router.post("/design/api/comentarios/historial")
def api_guardar_historial(payload: HistorialComentarioIn,
                                user: Empleado = Depends(require_modulo("design_schedule")),
                                db: Session = Depends(get_db)):
    sd.guardar_historial_comentario(db, user, payload.paciente, payload.orden, payload.campos)
    return {"mensaje": "Guardado en historial."}


@router.post("/design/api/comentarios/historial/{historial_id}/eliminar")
def api_eliminar_historial(historial_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                                 db: Session = Depends(get_db)):
    if not sd.eliminar_historial_comentario(db, historial_id):
        raise HTTPException(404, "No encontrado.")
    return {"mensaje": "Eliminado."}


# ---------- API: Comments N3 (plantillas de notas personalizadas) ----------

@router.get("/design/api/comentarios/templates")
def api_cmt_templates_listar(user: Empleado = Depends(require_modulo("design_schedule")),
                                   db: Session = Depends(get_db)):
    return [{"id": t.id, "nombre": t.nombre, "texto": t.texto, "esFija": bool(t.es_fija)}
           for t in sd.cmt_templates_listar(db)]


class CmtTemplateIn(BaseModel):
    nombre: str
    texto: str


@router.post("/design/api/comentarios/templates")
def api_cmt_template_crear(payload: CmtTemplateIn, user: Empleado = Depends(require_modulo("design_schedule")),
                                 db: Session = Depends(get_db)):
    t = sd.cmt_template_crear(db, payload.nombre, payload.texto, user.nombre_completo)
    return {"id": t.id, "nombre": t.nombre, "texto": t.texto}


@router.post("/design/api/comentarios/templates/{template_id}")
def api_cmt_template_editar(template_id: int, payload: CmtTemplateIn,
                                  user: Empleado = Depends(require_modulo("design_schedule")),
                                  db: Session = Depends(get_db)):
    t = sd.cmt_template_editar(db, template_id, payload.nombre, payload.texto)
    if not t:
        raise HTTPException(404, "No encontrada.")
    return {"id": t.id, "nombre": t.nombre, "texto": t.texto}


@router.post("/design/api/comentarios/templates/{template_id}/eliminar")
def api_cmt_template_eliminar(template_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                                    db: Session = Depends(get_db)):
    if not sd.cmt_template_eliminar(db, template_id, user.nombre_completo):
        raise HTTPException(404, "No encontrada.")
    return {"mensaje": "Eliminada."}


@router.post("/design/api/favoritos/cmt-template/{template_id}/toggle")
def api_favorito_toggle_cmt_template(template_id: int,
                                           user: Empleado = Depends(require_modulo("design_schedule")),
                                           db: Session = Depends(get_db)):
    return {"favorito": sd.favorito_toggle_cmt_template(db, user.id, template_id)}


# ---------- API: FAQ (Comments N2 / Face): hojas ----------
# Leen todos los del módulo; editan solo los roles por encima del diseñador.

FAQ_ROLES_EDITAN = ("aprobador", "admin", "superadmin")


def _faq_editor(user: Empleado) -> None:
    if user.rol not in FAQ_ROLES_EDITAN:
        raise HTTPException(403, "Solo líderes y administradores pueden editar esta información.")


@router.get("/design/api/faq/hojas")
def api_faq_hojas(user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    return {"hojas": sd.faq_hojas(db), "puedeEditar": user.rol in FAQ_ROLES_EDITAN}


@router.get("/design/api/faq/hojas/{hoja_id}")
def api_faq_hoja(hoja_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                       db: Session = Depends(get_db)):
    d = sd.faq_hoja_detalle(db, hoja_id)
    if not d:
        raise HTTPException(404, "Hoja no encontrada.")
    return d


class FaqHojaIn(BaseModel):
    nombre: str = ""
    duplicarDe: int | None = None


@router.post("/design/api/faq/hojas")
def api_faq_hoja_crear(payload: FaqHojaIn, user: Empleado = Depends(require_modulo("design_schedule")),
                             db: Session = Depends(get_db)):
    _faq_editor(user)
    h = sd.faq_hoja_crear(db, payload.nombre, payload.duplicarDe)
    if not h:
        raise HTTPException(404, "Hoja no encontrada.")
    return {"id": h.id}


@router.post("/design/api/faq/hojas/{hoja_id}/renombrar")
def api_faq_hoja_renombrar(hoja_id: int, payload: FaqHojaIn,
                                 user: Empleado = Depends(require_modulo("design_schedule")),
                                 db: Session = Depends(get_db)):
    _faq_editor(user)
    if not sd.faq_hoja_renombrar(db, hoja_id, payload.nombre):
        raise HTTPException(400, "Escribe un nombre.")
    return {"mensaje": "Renombrada."}


@router.post("/design/api/faq/hojas/{hoja_id}/eliminar")
def api_faq_hoja_eliminar(hoja_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                                db: Session = Depends(get_db)):
    _faq_editor(user)
    r = sd.faq_hoja_eliminar(db, hoja_id, user.nombre_completo)
    if r == "ultima":
        raise HTTPException(400, "Debe quedar al menos una hoja.")
    if r != "ok":
        raise HTTPException(404, "Hoja no encontrada.")
    return {"mensaje": "Enviada a la Papelera."}


class FaqColumnaIn(BaseModel):
    titulo: str


@router.post("/design/api/faq/hojas/{hoja_id}/columnas")
def api_faq_columna_agregar(hoja_id: int, payload: FaqColumnaIn,
                                  user: Empleado = Depends(require_modulo("design_schedule")),
                                  db: Session = Depends(get_db)):
    _faq_editor(user)
    col = sd.faq_columna_agregar(db, hoja_id, payload.titulo)
    if not col:
        raise HTTPException(400, "Escribe un nombre para la columna.")
    return col


@router.post("/design/api/faq/hojas/{hoja_id}/columnas/{clave}")
def api_faq_columna_renombrar(hoja_id: int, clave: str, payload: FaqColumnaIn,
                                    user: Empleado = Depends(require_modulo("design_schedule")),
                                    db: Session = Depends(get_db)):
    _faq_editor(user)
    if not sd.faq_columna_renombrar(db, hoja_id, clave, payload.titulo):
        raise HTTPException(400, "No se pudo renombrar la columna.")
    return {"mensaje": "Renombrada."}


@router.post("/design/api/faq/hojas/{hoja_id}/columnas/{clave}/eliminar")
def api_faq_columna_eliminar(hoja_id: int, clave: str, user: Empleado = Depends(require_modulo("design_schedule")),
                                   db: Session = Depends(get_db)):
    _faq_editor(user)
    if not sd.faq_columna_eliminar(db, hoja_id, clave, user.nombre_completo):
        raise HTTPException(404, "Columna no encontrada.")
    return {"mensaje": "Enviada a la Papelera."}


class FaqFilaNuevaIn(BaseModel):
    seccion: str = ""
    despuesDe: int | None = None


@router.post("/design/api/faq/hojas/{hoja_id}/filas")
def api_faq_fila_crear(hoja_id: int, payload: FaqFilaNuevaIn,
                             user: Empleado = Depends(require_modulo("design_schedule")),
                             db: Session = Depends(get_db)):
    _faq_editor(user)
    f = sd.faq_fila_crear(db, hoja_id, payload.seccion, payload.despuesDe)
    if not f:
        raise HTTPException(404, "Hoja no encontrada.")
    return {"id": f.id}


class FaqSeccionIn(BaseModel):
    filas: list[int]
    nombre: str


@router.post("/design/api/faq/hojas/{hoja_id}/seccion")
def api_faq_seccion_renombrar(hoja_id: int, payload: FaqSeccionIn,
                                    user: Empleado = Depends(require_modulo("design_schedule")),
                                    db: Session = Depends(get_db)):
    _faq_editor(user)
    return {"filas": sd.faq_seccion_renombrar(db, hoja_id, payload.filas, payload.nombre)}


class FaqCeldaIn(BaseModel):
    campo: str
    valor: str = ""


@router.post("/design/api/faq/filas/{fila_id}")
def api_faq_fila_actualizar(fila_id: int, payload: FaqCeldaIn,
                                  user: Empleado = Depends(require_modulo("design_schedule")),
                                  db: Session = Depends(get_db)):
    _faq_editor(user)
    if not sd.faq_fila_actualizar(db, fila_id, payload.campo, payload.valor):
        raise HTTPException(404, "No encontrado.")
    return {"mensaje": "Actualizado."}


@router.post("/design/api/faq/filas/{fila_id}/eliminar")
def api_faq_fila_eliminar(fila_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                                db: Session = Depends(get_db)):
    _faq_editor(user)
    if not sd.faq_fila_eliminar(db, fila_id, user.nombre_completo):
        raise HTTPException(404, "No encontrado.")
    return {"mensaje": "Enviada a la Papelera."}


# ---------- Página: Pre-Approved ----------

@router.get("/design/preapproved")
def pagina_preapproved(request: Request, user: Empleado = Depends(require_modulo("design_schedule"))):
    return _redirigir_a_panel(request, "preapproved")


# ---------- API: Pre-Approved ----------
# Leen todos los del módulo; editan solo los roles por encima del diseñador (como Comments N2 / Face).

def _pa_editor(user: Empleado) -> None:
    if user.rol not in FAQ_ROLES_EDITAN:
        raise HTTPException(403, "Solo líderes y administradores pueden editar el Pre-Approved.")


@router.get("/design/api/preapproved/sheets")
def api_preapproved_sheets(area_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                                 db: Session = Depends(get_db)):
    return [{"id": s.id, "nombre": s.nombre} for s in sd.preapproved_sheets(db, area_id)]


@router.get("/design/api/preapproved/sheets/{sheet_id}")
def api_preapproved_detalle(sheet_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                                  db: Session = Depends(get_db)):
    detalle = sd.preapproved_detalle(db, sheet_id)
    if not detalle:
        raise HTTPException(404, "Hoja no encontrada.")
    detalle["puedeEditar"] = user.rol in FAQ_ROLES_EDITAN
    return detalle


@router.post("/design/api/preapproved/sheets")
def api_crear_preapproved_sheet(area_id: int, nombre: str = "",
                                      user: Empleado = Depends(require_modulo("design_schedule")),
                                      db: Session = Depends(get_db)):
    _pa_editor(user)
    s = sd.crear_preapproved_sheet(db, area_id, nombre)
    return {"id": s.id, "nombre": s.nombre}


class PreApprovedSheetIn(BaseModel):
    nombre: str | None = None
    titulo: str | None = None
    changesLabel: str | None = None


@router.post("/design/api/preapproved/sheets/{sheet_id}")
def api_actualizar_preapproved_sheet(sheet_id: int, payload: PreApprovedSheetIn,
                                           user: Empleado = Depends(require_modulo("design_schedule")),
                                           db: Session = Depends(get_db)):
    _pa_editor(user)
    s = sd.actualizar_preapproved_sheet(db, sheet_id, {"nombre": payload.nombre, "titulo": payload.titulo,
                                                       "changes_label": payload.changesLabel})
    if not s:
        raise HTTPException(404, "No encontrada.")
    return {"mensaje": "Actualizado."}


@router.post("/design/api/preapproved/sheets/{sheet_id}/eliminar")
def api_eliminar_preapproved_sheet(sheet_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                                         db: Session = Depends(get_db)):
    _pa_editor(user)
    if not sd.eliminar_preapproved_sheet(db, sheet_id, user.nombre_completo):
        raise HTTPException(404, "No encontrada.")
    return {"mensaje": "Eliminada."}


@router.post("/design/api/preapproved/sheets/{sheet_id}/centros")
def api_agregar_centro(sheet_id: int, nombre: str = "", doctores: int = 1,
                             user: Empleado = Depends(require_modulo("design_schedule")),
                             db: Session = Depends(get_db)):
    _pa_editor(user)
    c = sd.preapproved_agregar_centro(db, sheet_id, nombre, doctores)
    return {"id": c.id}


class CentroIn(BaseModel):
    nombre: str = ""
    span: int = 1


@router.post("/design/api/preapproved/centros/{centro_id}")
def api_actualizar_centro(centro_id: int, payload: CentroIn,
                                user: Empleado = Depends(require_modulo("design_schedule")),
                                db: Session = Depends(get_db)):
    _pa_editor(user)
    sd.preapproved_actualizar_centro(db, centro_id, payload.nombre, payload.span)
    return {"mensaje": "Actualizado."}


@router.post("/design/api/preapproved/centros/{centro_id}/eliminar")
def api_eliminar_centro(centro_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                              db: Session = Depends(get_db)):
    _pa_editor(user)
    if not sd.preapproved_eliminar_centro(db, centro_id, user.nombre_completo):
        raise HTTPException(404, "No encontrado.")
    return {"mensaje": "Eliminado."}


@router.post("/design/api/preapproved/sheets/{sheet_id}/doctores")
def api_agregar_doctor(sheet_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                             db: Session = Depends(get_db)):
    _pa_editor(user)
    d = sd.preapproved_agregar_doctor(db, sheet_id)
    return {"id": d.id}


class NombreIn(BaseModel):
    nombre: str = ""


@router.post("/design/api/preapproved/doctores/{doctor_id}")
def api_renombrar_doctor(doctor_id: int, payload: NombreIn,
                               user: Empleado = Depends(require_modulo("design_schedule")),
                               db: Session = Depends(get_db)):
    _pa_editor(user)
    sd.preapproved_renombrar_doctor(db, doctor_id, payload.nombre)
    return {"mensaje": "Actualizado."}


@router.post("/design/api/preapproved/doctores/{doctor_id}/eliminar")
def api_eliminar_doctor(doctor_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                              db: Session = Depends(get_db)):
    _pa_editor(user)
    if not sd.preapproved_eliminar_doctor(db, doctor_id, user.nombre_completo):
        raise HTTPException(404, "No encontrado.")
    return {"mensaje": "Eliminado."}


@router.post("/design/api/preapproved/sheets/{sheet_id}/filas")
def api_agregar_fila(sheet_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                           db: Session = Depends(get_db)):
    _pa_editor(user)
    f = sd.preapproved_agregar_fila(db, sheet_id)
    return {"id": f.id}


@router.post("/design/api/preapproved/filas/{fila_id}")
def api_renombrar_fila(fila_id: int, payload: NombreIn,
                             user: Empleado = Depends(require_modulo("design_schedule")),
                             db: Session = Depends(get_db)):
    _pa_editor(user)
    sd.preapproved_renombrar_fila(db, fila_id, payload.nombre)
    return {"mensaje": "Actualizado."}


@router.post("/design/api/preapproved/filas/{fila_id}/eliminar")
def api_eliminar_fila(fila_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                            db: Session = Depends(get_db)):
    _pa_editor(user)
    if not sd.preapproved_eliminar_fila(db, fila_id, user.nombre_completo):
        raise HTTPException(404, "No encontrada.")
    return {"mensaje": "Eliminada."}


class CeldaIn(BaseModel):
    filaId: int
    doctorId: int
    valor: str = ""


@router.post("/design/api/preapproved/celdas")
def api_guardar_celda(payload: CeldaIn, user: Empleado = Depends(require_modulo("design_schedule")),
                            db: Session = Depends(get_db)):
    _pa_editor(user)
    sd.preapproved_guardar_celda(db, payload.filaId, payload.doctorId, payload.valor)
    return {"mensaje": "Guardado."}


class AnchoIn(BaseModel):
    clave: str
    px: int | None = None


@router.post("/design/api/preapproved/sheets/{sheet_id}/anchos")
def api_preapproved_ancho(sheet_id: int, payload: AnchoIn, user: Empleado = Depends(require_modulo("design_schedule")),
                                db: Session = Depends(get_db)):
    _pa_editor(user)
    if not sd.preapproved_guardar_ancho(db, sheet_id, payload.clave, payload.px):
        raise HTTPException(404, "Hoja no encontrada.")
    return {"mensaje": "Guardado."}


# ---------- Pre-Approved "Cambios": mover/intercambiar doctores y centros entre managers ----------

class PACMoverDoctorIn(BaseModel):
    doctorId: int
    sheetDestinoId: int
    centroDestinoId: int | None = None


class PACMoverCentroIn(BaseModel):
    centroId: int
    sheetDestinoId: int
    centroDestinoId: int | None = None


class PACIntercambiarDoctorIn(BaseModel):
    doctorAId: int
    doctorBId: int


class PACIntercambiarCentroIn(BaseModel):
    centroAId: int
    centroBId: int


def _pac_respuesta(resultado: dict) -> dict:
    if "error" in resultado:
        raise HTTPException(400, resultado["error"])
    return resultado


@router.post("/design/api/preapproved/cambios/mover-doctor")
def api_pac_mover_doctor(payload: PACMoverDoctorIn, user: Empleado = Depends(require_design_manager),
                               db: Session = Depends(get_db)):
    return _pac_respuesta(sd.pac_mover_doctor(db, payload.doctorId, payload.sheetDestinoId, payload.centroDestinoId))


@router.post("/design/api/preapproved/cambios/mover-centro")
def api_pac_mover_centro(payload: PACMoverCentroIn, user: Empleado = Depends(require_design_manager),
                               db: Session = Depends(get_db)):
    return _pac_respuesta(sd.pac_mover_centro(db, payload.centroId, payload.sheetDestinoId, payload.centroDestinoId))


@router.post("/design/api/preapproved/cambios/intercambiar-doctor")
def api_pac_intercambiar_doctor(payload: PACIntercambiarDoctorIn,
                                      user: Empleado = Depends(require_design_manager),
                                      db: Session = Depends(get_db)):
    return _pac_respuesta(sd.pac_intercambiar_doctor(db, payload.doctorAId, payload.doctorBId))


@router.post("/design/api/preapproved/cambios/intercambiar-centro")
def api_pac_intercambiar_centro(payload: PACIntercambiarCentroIn,
                                      user: Empleado = Depends(require_design_manager),
                                      db: Session = Depends(get_db)):
    return _pac_respuesta(sd.pac_intercambiar_centro(db, payload.centroAId, payload.centroBId))


# ---------- Desempeño (aprobadores y admins: equivalente a "Tools Managers") ----------

@router.get("/design/perf")
def pagina_perf(request: Request, user: Empleado = Depends(require_design_manager)):
    return _redirigir_a_panel(request, "perf")


@router.get("/design/api/perf/sheets")
def api_perf_sheets(user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    return [{"id": s.id, "nombre": s.nombre, "tipo": s.tipo} for s in sd.perf_sheets(db) if sd.perf_sheet_visible(user, s)]


def _perf_sheet(db: Session, user: Empleado, sheet_id: int) -> DesignPerfSheet:
    sheet = db.get(DesignPerfSheet, sheet_id)
    if not sheet:
        raise HTTPException(404, "Hoja no encontrada")
    if not sd.perf_sheet_visible(user, sheet):
        raise HTTPException(403, "Solo puedes ver la evaluación de tu equipo.")
    return sheet


NO_CALIFICA = "Solo puedes calificar a los diseñadores de tu equipo (nunca a ti mismo)."


@router.get("/design/api/perf/sheets/{sheet_id}/eval")
def api_perf_detalle_eval(sheet_id: int, user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    _perf_sheet(db, user, sheet_id)
    detalle = sd.perf_detalle_eval(db, sheet_id)
    if not detalle:
        raise HTTPException(404, "Hoja no encontrada")
    for e in detalle["empleados"]:
        e["editable"] = sd.perf_puede_calificar(user, db.get(DesignPerfEmpleado, e["id"]))
    return detalle


def _perf_empleado_calificable(db: Session, user: Empleado, empleado_id: int) -> None:
    emp = db.get(DesignPerfEmpleado, empleado_id)
    if not emp:
        raise HTTPException(404, "Persona no encontrada.")
    if not sd.perf_puede_calificar(user, emp):
        raise HTTPException(403, NO_CALIFICA)


class PerfCeldaIn(BaseModel):
    empleadoId: int
    criterioId: int
    mesIndice: int = Field(ge=0, lt=60)
    nivel: str = ""
    puntaje: float = 0


@router.post("/design/api/perf/celdas")
def api_perf_guardar_celda(payload: PerfCeldaIn, user: Empleado = Depends(require_design_manager),
                                 db: Session = Depends(get_db)):
    _perf_empleado_calificable(db, user, payload.empleadoId)
    sd.perf_guardar_celda(db, payload.empleadoId, payload.criterioId, payload.mesIndice,
                          payload.nivel, payload.puntaje)
    return {"mensaje": "Guardado."}


class PerfNotaIn(BaseModel):
    nota: str = ""


@router.post("/design/api/perf/empleados/{empleado_id}/nota")
def api_perf_guardar_nota(empleado_id: int, payload: PerfNotaIn, user: Empleado = Depends(require_design_manager),
                                db: Session = Depends(get_db)):
    _perf_empleado_calificable(db, user, empleado_id)
    sd.perf_guardar_nota(db, empleado_id, payload.nota)
    return {"mensaje": "Guardado."}


@router.get("/design/api/perf/sheets/{sheet_id}/seleccion")
def api_perf_detalle_seleccion(sheet_id: int, user: Empleado = Depends(require_design_manager),
                                     db: Session = Depends(get_db)):
    _perf_sheet(db, user, sheet_id)
    detalle = sd.perf_detalle_seleccion(db, sheet_id)
    if not detalle:
        raise HTTPException(404, "Hoja no encontrada")
    detalle["ganadoresEditables"] = sd.es_admin(user)
    for f in detalle["filas"]:
        f["editable"] = sd.perf_puede_editar_fila_seleccion(user, db.get(DesignPerfSeleccionFila, f["id"]))
    return detalle


class PerfGanadorMesIn(BaseModel):
    mesIndice: int = Field(ge=0, lt=60)
    nombre: str = ""


@router.post("/design/api/perf/ganadores/{ganador_id}")
def api_perf_guardar_ganador(ganador_id: int, payload: PerfGanadorMesIn, user: Empleado = Depends(require_design_manager),
                                   db: Session = Depends(get_db)):
    if not sd.es_admin(user):
        raise HTTPException(403, "El empleado del mes lo registra un administrador.")
    sd.perf_guardar_ganador_mes(db, ganador_id, payload.mesIndice, payload.nombre)
    return {"mensaje": "Guardado."}


class PerfCeldaSeleccionIn(BaseModel):
    mesIndice: int = Field(ge=0, lt=60)
    persona: str = ""
    puntaje: str = ""
    nota: str = ""


@router.post("/design/api/perf/filas/{fila_id}/celdas")
def api_perf_guardar_celda_seleccion(fila_id: int, payload: PerfCeldaSeleccionIn,
                                           user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    fila = db.get(DesignPerfSeleccionFila, fila_id)
    if not fila:
        raise HTTPException(404, "Fila no encontrada.")
    if not sd.perf_puede_editar_fila_seleccion(user, fila):
        raise HTTPException(403, "Solo puedes editar tu propia fila de evaluador.")
    sd.perf_guardar_celda_seleccion(db, fila_id, payload.mesIndice, payload.persona, payload.puntaje, payload.nota)
    return {"mensaje": "Guardado."}


# ---------- Papelera ----------

@router.get("/design/papelera")
def pagina_papelera(request: Request, user: Empleado = Depends(require_design_manager)):
    return _redirigir_a_panel(request, "papelera")


@router.get("/design/api/papelera")
def api_papelera_listar(user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    return [{"id": t.id, "modulo": t.modulo, "etiqueta": t.etiqueta, "eliminado_por": t.eliminado_por,
            "eliminado_en": t.eliminado_en.strftime("%d/%m/%Y %H:%M")} for t in sd.trash_listar(db)]


@router.post("/design/api/papelera/{trash_id}/restaurar")
def api_papelera_restaurar(trash_id: int, user: Empleado = Depends(require_design_manager),
                                 db: Session = Depends(get_db)):
    if not sd.trash_restaurar(db, trash_id):
        raise HTTPException(400, "No se pudo restaurar (el destino cambió demasiado o ya no existe).")
    return {"mensaje": "Restaurado."}


@router.post("/design/api/papelera/{trash_id}/eliminar")
def api_papelera_eliminar(trash_id: int, user: Empleado = Depends(require_admin),
                                db: Session = Depends(get_db)):
    if not sd.trash_eliminar_permanente(db, trash_id):
        raise HTTPException(404, "No encontrado.")
    return {"mensaje": "Eliminado del historial."}


@router.post("/design/api/papelera/vaciar")
def api_papelera_vaciar(user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    sd.trash_vaciar(db)
    return {"mensaje": "Historial vaciado."}


# ---------- Favoritos ----------

@router.get("/design/favoritos")
def pagina_favoritos(request: Request, user: Empleado = Depends(require_modulo("design_schedule"))):
    return _redirigir_a_panel(request, "favoritos")


@router.get("/design/api/favoritos")
def api_favoritos(user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    return sd.favoritos_de(db, user.id)


@router.get("/design/api/favoritos/activos")
def api_favoritos_activos(user: Empleado = Depends(require_modulo("design_schedule")),
                                db: Session = Depends(get_db)):
    activos = sd.favoritos_activos(db, user.id)
    return {"teams": list(activos["teams"]), "preapproved": list(activos["preapproved"]),
           "protocolos": list(activos["protocolos"]), "cmtTemplates": list(activos["cmtTemplates"])}


@router.post("/design/api/favoritos/team/{team_id}/toggle")
def api_favorito_toggle_team(team_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                                   db: Session = Depends(get_db)):
    if team_id not in sd.favoritos_activos(db, user.id)["teams"]:
        _verificar_equipo(db, user, team_id)  # solo se marcan equipos que la persona puede ver (quitar, siempre)
    return {"favorito": sd.favorito_toggle_team(db, user.id, team_id)}


@router.post("/design/api/favoritos/preapproved/{sheet_id}/toggle")
def api_favorito_toggle_preapproved(sheet_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                                          db: Session = Depends(get_db)):
    return {"favorito": sd.favorito_toggle_preapproved(db, user.id, sheet_id)}


@router.post("/design/api/favoritos/protocolo/{protocolo_id}/toggle")
def api_favorito_toggle_protocolo(protocolo_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                                        db: Session = Depends(get_db)):
    return {"favorito": sd.favorito_toggle_protocolo(db, user.id, protocolo_id)}


# ---------- Protocols ----------

@router.get("/design/protocols")
def pagina_protocols(request: Request, user: Empleado = Depends(require_modulo("design_schedule"))):
    return _redirigir_a_panel(request, "protocols")


def _pr_editor(user: Empleado) -> None:
    if user.rol not in FAQ_ROLES_EDITAN:
        raise HTTPException(403, "Solo líderes y administradores pueden subir o editar protocolos.")


@router.get("/design/api/protocolos")
def api_protocolos_listar(area_id: int = 0, user: Empleado = Depends(require_modulo("design_schedule")),
                                db: Session = Depends(get_db)):
    return {"protocolos": sd.protocolos_listar(db, area_id or None), "puedeEditar": user.rol in FAQ_ROLES_EDITAN}


@router.get("/design/api/protocolos/buscar")
def api_protocolos_buscar(q: str = "", area_id: int = 0, protocolo_id: int = 0, solo: str = "",
                                user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    ids = [int(x) for x in solo.split(",") if x.strip().isdigit()]
    return sd.protocolos_buscar(db, area_id or None, q, protocolo_id or None, protocolo_ids=ids or None)


@router.get("/design/api/protocolos/espacio")
def api_protocolos_espacio(user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    _pr_editor(user)
    return sd.pr_espacio(db)


@router.get("/design/api/protocolos/{protocolo_id}")
def api_protocolo_detalle(protocolo_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                                db: Session = Depends(get_db)):
    p = sd.protocolo_detalle(db, protocolo_id)
    if not p:
        raise HTTPException(404, "No encontrado.")
    d = sd.pr_resumen(db, p)
    d["contenido"] = p.contenido
    return d


@router.get("/design/api/protocolos/{protocolo_id}/pdf")
def api_protocolo_pdf(protocolo_id: int, request: Request, user: Empleado = Depends(require_modulo("design_schedule")),
                            db: Session = Depends(get_db)):
    """Sirve el PDF por rangos (el visor pide solo las partes que necesita) o completo en streaming,
    leyendo de la base de datos de a 1 MB para no cargar archivos grandes en memoria."""
    a = sd.pr_archivo_info(db, protocolo_id)
    if not a:
        raise HTTPException(404, "Este protocolo no tiene PDF.")
    archivo_id, total = a.id, int(a.tamano or 0)
    nombre = (a.nombre or "protocolo.pdf").replace('"', "").encode("ascii", "ignore").decode() or "protocolo.pdf"
    base = {"Accept-Ranges": "bytes", "Cache-Control": "private, max-age=86400", "ETag": f'"pr{archivo_id}-{total}"',
            "Content-Disposition": f'inline; filename="{nombre}"'}
    rango = request.headers.get("range", "")
    m = re.match(r"bytes=(\d*)-(\d*)$", rango.strip())
    if m and total:
        ini = int(m.group(1)) if m.group(1) else max(0, total - int(m.group(2) or 0))
        fin = min(int(m.group(2)), total - 1) if (m.group(1) and m.group(2)) else total - 1
        fin = min(fin, ini + 2 * 1024 * 1024 - 1)  # el cliente pide el resto en otra petición (RFC 9110)
        if ini >= total or fin < ini:
            return Response(status_code=416, headers={"Content-Range": f"bytes */{total}"})
        datos = sd.pr_archivo_trozo(db, archivo_id, ini, fin - ini + 1)
        return Response(content=datos, status_code=206, media_type="application/pdf",
                        headers={**base, "Content-Range": f"bytes {ini}-{fin}/{total}", "Content-Length": str(len(datos))})

    def trozos():
        from ..database import SessionLocal
        s2 = SessionLocal()
        try:
            pos = 0
            while pos < total:
                d = sd.pr_archivo_trozo(s2, archivo_id, pos, 1024 * 1024)
                if not d:
                    break
                yield d
                pos += len(d)
        finally:
            s2.close()
    return StreamingResponse(trozos(), media_type="application/pdf", headers={**base, "Content-Length": str(total)})


class PdfNuevoIn(BaseModel):
    nombre: str = ""
    tamano: int


@router.post("/design/api/protocolos/subida")
def api_protocolo_subida_iniciar(payload: PdfNuevoIn, user: Empleado = Depends(require_modulo("design_schedule")),
                                       db: Session = Depends(get_db)):
    _pr_editor(user)
    if payload.tamano <= 0 or payload.tamano > sd.PR_MAX_BYTES:
        raise HTTPException(413, f"El PDF debe pesar menos de {sd.PR_MAX_BYTES // (1024 * 1024)} MB.")
    a = sd.pr_subida_iniciar(db, payload.nombre, payload.tamano)
    return {"archivoId": a.id, "parte": sd.PR_PARTE_MAX - 1024 * 1024}


@router.post("/design/api/protocolos/subida/{archivo_id}/parte")
async def api_protocolo_subida_parte(archivo_id: int, offset: int, request: Request,
                                     user: Empleado = Depends(require_modulo("design_schedule")),
                                     db: Session = Depends(get_db)):
    _pr_editor(user)
    if int(request.headers.get("content-length") or 0) > sd.PR_PARTE_MAX:
        raise HTTPException(413, "Parte del archivo inválida.")
    datos = await request.body()
    if not datos or len(datos) > sd.PR_PARTE_MAX:
        raise HTTPException(413, "Parte del archivo inválida.")
    try:
        largo = await run_in_threadpool(sd.pr_subida_parte, db, archivo_id, offset, datos)
    except ValueError as e:
        raise HTTPException(409, str(e))
    if largo is None:
        raise HTTPException(404, "La subida no existe o ya terminó.")
    return {"recibido": largo}


class PdfFinalizarIn(BaseModel):
    titulo: str = ""
    areas: list[int] = []
    version: str = "v1.0"
    paginas: list[str] = []


@router.post("/design/api/protocolos/subida/{archivo_id}/finalizar")
def api_protocolo_subida_finalizar(archivo_id: int, payload: PdfFinalizarIn,
                                         user: Empleado = Depends(require_modulo("design_schedule")),
                                         db: Session = Depends(get_db)):
    _pr_editor(user)
    if not payload.areas:
        raise HTTPException(400, "Elige al menos un área.")
    try:
        p = sd.pr_subida_finalizar(db, archivo_id, payload.titulo, payload.areas, payload.paginas,
                                   payload.version, user.nombre_completo)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"id": p.id}


class ProtocoloEditIn(BaseModel):
    titulo: str | None = None
    areas: list[int] | None = None
    version: str | None = None


@router.post("/design/api/protocolos/{protocolo_id}")
def api_protocolo_actualizar(protocolo_id: int, payload: ProtocoloEditIn,
                                   user: Empleado = Depends(require_modulo("design_schedule")),
                                   db: Session = Depends(get_db)):
    _pr_editor(user)
    if payload.areas is not None and not payload.areas:
        raise HTTPException(400, "Elige al menos un área.")
    if not sd.protocolo_actualizar(db, protocolo_id, payload.titulo, payload.areas, payload.version):
        raise HTTPException(404, "No encontrado.")
    return {"mensaje": "Actualizado."}


class ProtocoloIn(BaseModel):
    areaId: int | None = None
    areas: list[int] | None = None
    titulo: str
    descripcion: str = ""
    contenido: str = ""
    version: str = "v1.0"


@router.post("/design/api/protocolos")
def api_protocolo_crear(payload: ProtocoloIn, user: Empleado = Depends(require_modulo("design_schedule")),
                              db: Session = Depends(get_db)):
    _pr_editor(user)
    p = sd.protocolo_crear(db, payload.areaId, payload.titulo, payload.descripcion, payload.contenido,
                           payload.version, user.nombre_completo, payload.areas)
    return {"id": p.id}


@router.post("/design/api/protocolos/{protocolo_id}/eliminar")
def api_protocolo_eliminar(protocolo_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                                 db: Session = Depends(get_db)):
    _pr_editor(user)
    if not sd.protocolo_eliminar(db, protocolo_id, user.nombre_completo):
        raise HTTPException(404, "No encontrado.")
    return {"mensaje": "Enviado a la Papelera."}


# ---------- Canvas ----------

@router.get("/design/canvas")
def pagina_canvas(request: Request, user: Empleado = Depends(require_modulo("design_schedule"))):
    return _redirigir_a_panel(request, "canvas")


@router.get("/design/api/canvas/docs")
def api_canvas_docs(area_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                          db: Session = Depends(get_db)):
    return sd.canvas_docs(db, area_id)


@router.get("/design/api/canvas/docs/{doc_id}")
def api_canvas_doc(doc_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                         db: Session = Depends(get_db)):
    d = sd.canvas_doc(db, doc_id)
    if not d:
        raise HTTPException(404, "No encontrada.")
    return d


class CanvasCrearIn(BaseModel):
    areaId: int
    nombre: str = "Hoja"
    templateId: str = ""
    titulo: str = ""
    frames: list = []


@router.post("/design/api/canvas/docs")
def api_canvas_crear(payload: CanvasCrearIn, user: Empleado = Depends(require_modulo("design_schedule")),
                           db: Session = Depends(get_db)):
    d = sd.canvas_crear_doc(db, payload.areaId, payload.nombre, payload.templateId, payload.titulo,
                            payload.frames, user.nombre_completo)
    return sd.canvas_serializar(d)


class CanvasGuardarIn(BaseModel):
    nombre: str | None = None
    titulo: str | None = None
    tituloColor: str | None = None
    w: int | None = None
    h: int | None = None
    frames: list | None = None
    elements: list | None = None


@router.post("/design/api/canvas/docs/{doc_id}")
def api_canvas_guardar(doc_id: int, payload: CanvasGuardarIn,
                             user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    datos = {k: v for k, v in payload.model_dump().items() if v is not None}
    d = sd.canvas_guardar_doc(db, doc_id, datos)
    if not d:
        raise HTTPException(404, "No encontrada.")
    return {"mensaje": "Guardado."}


@router.post("/design/api/canvas/docs/{doc_id}/renombrar")
def api_canvas_renombrar(doc_id: int, payload: NombreIn, user: Empleado = Depends(require_modulo("design_schedule")),
                               db: Session = Depends(get_db)):
    if not sd.canvas_renombrar_doc(db, doc_id, payload.nombre):
        raise HTTPException(404, "No encontrada.")
    return {"mensaje": "Renombrada."}


@router.post("/design/api/canvas/docs/{doc_id}/duplicar")
def api_canvas_duplicar(doc_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                              db: Session = Depends(get_db)):
    d = sd.canvas_duplicar_doc(db, doc_id)
    if not d:
        raise HTTPException(404, "No encontrada.")
    return sd.canvas_serializar(d)


class CanvasMoverIn(BaseModel):
    targetId: int


@router.post("/design/api/canvas/docs/{doc_id}/mover")
def api_canvas_mover(doc_id: int, payload: CanvasMoverIn, user: Empleado = Depends(require_modulo("design_schedule")),
                           db: Session = Depends(get_db)):
    if not sd.canvas_mover_doc(db, doc_id, payload.targetId):
        raise HTTPException(400, "No se pudo mover.")
    return {"mensaje": "Movida."}


@router.post("/design/api/canvas/docs/{doc_id}/eliminar")
def api_canvas_eliminar(doc_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                              db: Session = Depends(get_db)):
    trash_id = sd.canvas_eliminar_doc(db, doc_id, user.nombre_completo, user.id)
    if not trash_id:
        raise HTTPException(404, "No encontrada.")
    return {"mensaje": "Eliminada.", "papeleraId": trash_id}


@router.post("/design/api/canvas/deshacer/{trash_id}")
def api_canvas_deshacer(trash_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                              db: Session = Depends(get_db)):
    r = sd.canvas_deshacer_eliminar(db, trash_id, user.id)
    if r == "ok":
        return {"mensaje": "Hoja restaurada."}
    mensajes = {"no-existe": "La hoja ya no está en la Papelera.", "ajena": "Solo quien borró la hoja puede deshacerlo.",
                "vencido": "Pasó el tiempo para deshacer; pídele a un líder que la restaure desde la Papelera.",
                "error": "No se pudo restaurar la hoja."}
    raise HTTPException(400, mensajes.get(r, "No se pudo restaurar la hoja."))
