"""Evaluación de desempeño (People): "Evalúa a tu jefe" (360°) y "Evalúa a tu equipo", más el
documento de Plan de mejora por líder -- ver app/services_evaluacion.py."""
import asyncio
from datetime import date, datetime
from fastapi import APIRouter, Request, Depends, Form, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from ..concurrencia import RutaGeneral
from ..database import get_db, SessionLocal
from ..models import Empleado
from ..models_evaluacion import EvaluacionCiclo, PlanMejora, Evaluacion360Respuesta, EvaluacionEquipoRespuesta
from ..auth import get_current_user, require_admin
from .. import services_evaluacion as se
from ..main_templates import templates

router = APIRouter(route_class=RutaGeneral)  # tope de concurrencia: app/concurrencia.py

REVISION_CADA_S = 6 * 3600  # cada 6 horas: suficiente para abrir el ciclo el día que toque y
                            # respetar el reenvío de recordatorios cada DIAS_ENTRE_RECORDATORIOS días


def _redir(url: str, msg: str = "", error: str = "") -> RedirectResponse:
    qs = ""
    if msg:
        qs = f"?msg={msg}"
    elif error:
        qs = f"?error={error}"
    return RedirectResponse(url + qs, status_code=303)


@router.get("/evaluacion-desempeno")
def landing(request: Request, user: Empleado = Depends(get_current_user), db: Session = Depends(get_db)):
    ciclo = se.ciclo_actual(db)
    jefes = equipo = []
    pend = {"jefes": [], "equipo": []}
    if ciclo:
        jefes = se.jefes_a_evaluar(user)
        equipo = se.equipo_a_evaluar(db, user)
        pend = se.pendientes(db, user, ciclo)
    return templates.TemplateResponse(request, "evaluacion_desempeno.html", {
        "user": user, "ciclo": ciclo, "jefes": jefes, "equipo": equipo, "pend": pend,
        "tiene_equipo": se.tiene_equipo(db, user),
        "msg": request.query_params.get("msg"), "error": request.query_params.get("error"),
    })


# ---------- Evalúa a tu jefe ----------

@router.get("/evaluacion-desempeno/jefe")
def form_jefe(request: Request, user: Empleado = Depends(get_current_user), db: Session = Depends(get_db)):
    ciclo = se.ciclo_actual(db)
    if not ciclo:
        return _redir("/evaluacion-desempeno", error="Todavía no hay un ciclo de evaluación abierto.")
    jefes = se.jefes_a_evaluar(user)
    if not jefes:
        return _redir("/evaluacion-desempeno", error="No tienes jefes asignados para evaluar.")
    respuestas = {r.evaluado_id: r for r in
                 db.query(Evaluacion360Respuesta).filter_by(ciclo_id=ciclo.id, evaluador_id=user.id)}
    return templates.TemplateResponse(request, "evaluacion_desempeno_jefe.html", {
        "user": user, "ciclo": ciclo, "jefes": jefes, "respuestas": respuestas,
        "competencias": list(enumerate(se.COMPETENCIAS_360, start=1)),
        "msg": request.query_params.get("msg"), "error": request.query_params.get("error"),
    })


@router.post("/evaluacion-desempeno/jefe/{jefe_id}")
async def guardar_jefe(jefe_id: int, request: Request, user: Empleado = Depends(get_current_user),
                       db: Session = Depends(get_db)):
    ciclo = se.ciclo_actual(db)
    jefe = db.get(Empleado, jefe_id)
    if not ciclo or not jefe:
        return _redir("/evaluacion-desempeno/jefe", error="Ciclo o jefe inválido.")
    form = await request.form()
    try:
        calificaciones = [int(form.get(f"comp_{i}", 0)) for i in range(1, len(se.COMPETENCIAS_360) + 1)]
    except ValueError:
        return _redir("/evaluacion-desempeno/jefe", error="Calificaciones inválidas.")
    _, error = se.guardar_360(db, ciclo, user, jefe, calificaciones)
    if error:
        return _redir("/evaluacion-desempeno/jefe", error=error)
    return _redir("/evaluacion-desempeno/jefe", msg=f"Evaluación de {jefe.nombre_completo} guardada.")


# ---------- Evalúa a tu equipo ----------

@router.get("/evaluacion-desempeno/equipo")
def form_equipo(request: Request, user: Empleado = Depends(get_current_user), db: Session = Depends(get_db)):
    ciclo = se.ciclo_actual(db)
    if not ciclo:
        return _redir("/evaluacion-desempeno", error="Todavía no hay un ciclo de evaluación abierto.")
    equipo = se.equipo_a_evaluar(db, user)
    if not equipo:
        return _redir("/evaluacion-desempeno", error="No tienes personas a cargo para evaluar.")
    respuestas = {r.empleado_id: r for r in
                 db.query(EvaluacionEquipoRespuesta).filter_by(ciclo_id=ciclo.id, jefe_id=user.id)}
    return templates.TemplateResponse(request, "evaluacion_desempeno_equipo.html", {
        "user": user, "ciclo": ciclo, "equipo": equipo, "respuestas": respuestas,
        "aspectos": se.ASPECTOS_EQUIPO,
        "msg": request.query_params.get("msg"), "error": request.query_params.get("error"),
    })


@router.post("/evaluacion-desempeno/equipo/{empleado_id}")
async def guardar_equipo(empleado_id: int, request: Request, user: Empleado = Depends(get_current_user),
                         db: Session = Depends(get_db)):
    ciclo = se.ciclo_actual(db)
    miembro = db.get(Empleado, empleado_id)
    if not ciclo or not miembro:
        return _redir("/evaluacion-desempeno/equipo", error="Ciclo o persona inválida.")
    form = await request.form()
    try:
        calificaciones = [int(form.get(clave, 0)) for clave, _, _ in se.ASPECTOS_EQUIPO]
    except ValueError:
        return _redir("/evaluacion-desempeno/equipo", error="Calificaciones inválidas.")
    observacion = form.get("observacion", "")
    _, error = se.guardar_equipo(db, ciclo, user, miembro, calificaciones, observacion)
    if error:
        return _redir("/evaluacion-desempeno/equipo", error=error)
    return _redir("/evaluacion-desempeno/equipo", msg=f"Evaluación de {miembro.nombre_completo} guardada.")


# ---------- Plan de mejora (documento completo) ----------

@router.get("/evaluacion-desempeno/plan/{lider_id}")
def ver_plan(lider_id: int, request: Request, ciclo_id: int | None = None,
            user: Empleado = Depends(get_current_user), db: Session = Depends(get_db)):
    lider = db.get(Empleado, lider_id)
    if not lider:
        raise HTTPException(404, "Empleado no encontrado.")
    if not se.puede_ver_plan(user, lider):
        raise HTTPException(403, "No tienes acceso al plan de mejora de esta persona.")
    ciclo_actual = se.ciclo_actual(db)
    ciclo = db.get(EvaluacionCiclo, ciclo_id) if ciclo_id else ciclo_actual
    if not ciclo:
        return _redir("/evaluacion-desempeno", error="Todavía no hay un ciclo de evaluación abierto.")
    es_actual = bool(ciclo_actual and ciclo.id == ciclo_actual.id)
    plan = se.plan_obtener_o_crear(db, lider, ciclo) if es_actual else se.plan_obtener(db, lider, ciclo)
    ciclos_con_plan = (db.query(EvaluacionCiclo).join(PlanMejora, PlanMejora.ciclo_id == EvaluacionCiclo.id)
                      .filter(PlanMejora.lider_id == lider.id).order_by(EvaluacionCiclo.id.desc()).all())
    return templates.TemplateResponse(request, "evaluacion_desempeno_plan.html", {
        "user": user, "lider": lider, "ciclo": ciclo, "es_actual": es_actual, "plan": plan,
        "ciclos_con_plan": ciclos_con_plan,
        "resultado_360": se.promedio_360(db, ciclo, lider),
        "aspectos_equipo": se.aspectos_equipo_sobre(db, ciclo, lider) if ciclo else [],
        "aspectos": se.ASPECTOS_EQUIPO,
        "puede_editar": es_actual and se.puede_editar_plan(user, lider),
        "puede_firmar_lider": se.puede_firmar("lider", user, lider),
        "puede_firmar_jefe": se.puede_firmar("jefe", user, lider),
        "puede_firmar_rrhh": se.puede_firmar("rrhh", user, lider),
        "prioridades": se.PRIORIDADES,
        "msg": request.query_params.get("msg"), "error": request.query_params.get("error"),
    })


def _plan_editable(db: Session, user: Empleado, lider_id: int) -> tuple[Empleado, PlanMejora] | RedirectResponse:
    lider = db.get(Empleado, lider_id)
    ciclo = se.ciclo_actual(db)
    if not lider or not ciclo or not se.puede_editar_plan(user, lider):
        return _redir("/evaluacion-desempeno", error="No puedes editar este plan de mejora.")
    return lider, se.plan_obtener_o_crear(db, lider, ciclo)


@router.post("/evaluacion-desempeno/plan/{lider_id}/fortalezas")
async def plan_fortalezas(lider_id: int, user: Empleado = Depends(get_current_user), db: Session = Depends(get_db),
                          fortalezas: str = Form(""), areas_mejora: str = Form(""),
                          periodo_plan: str = Form(""), fecha_inicio_plan: str = Form("")):
    resultado = _plan_editable(db, user, lider_id)
    if isinstance(resultado, RedirectResponse):
        return resultado
    _, plan = resultado
    plan.fortalezas = fortalezas.strip()
    plan.areas_mejora = areas_mejora.strip()
    plan.periodo_plan = periodo_plan.strip()
    plan.fecha_inicio_plan = date.fromisoformat(fecha_inicio_plan) if fecha_inicio_plan else None
    db.commit()
    return _redir(f"/evaluacion-desempeno/plan/{lider_id}", msg="Guardado.")


@router.post("/evaluacion-desempeno/plan/{lider_id}/competencia/{indice}")
async def plan_competencia(lider_id: int, indice: int, user: Empleado = Depends(get_current_user),
                           db: Session = Depends(get_db), hallazgo: str = Form(""), prioridad: str = Form("")):
    resultado = _plan_editable(db, user, lider_id)
    if isinstance(resultado, RedirectResponse):
        return resultado
    _, plan = resultado
    nota = next((n for n in plan.notas_competencias if n.indice == indice), None)
    if not nota:
        return _redir(f"/evaluacion-desempeno/plan/{lider_id}", error="Competencia inválida.")
    nota.hallazgo = hallazgo.strip()
    nota.prioridad = prioridad if prioridad in se.PRIORIDADES else ""
    db.commit()
    return _redir(f"/evaluacion-desempeno/plan/{lider_id}", msg="Guardado.")


@router.post("/evaluacion-desempeno/plan/{lider_id}/accion/{numero}")
async def plan_accion(lider_id: int, numero: int, user: Empleado = Depends(get_current_user),
                      db: Session = Depends(get_db), area_mejora: str = Form(""), accion: str = Form(""),
                      responsable: str = Form(""), recursos: str = Form(""), indicador: str = Form(""),
                      fecha_inicio: str = Form(""), fecha_fin: str = Form("")):
    resultado = _plan_editable(db, user, lider_id)
    if isinstance(resultado, RedirectResponse):
        return resultado
    _, plan = resultado
    fila = next((a for a in plan.acciones if a.numero == numero), None)
    if not fila:
        return _redir(f"/evaluacion-desempeno/plan/{lider_id}", error="Fila inválida.")
    fila.area_mejora, fila.accion = area_mejora.strip(), accion.strip()
    fila.responsable, fila.recursos, fila.indicador = responsable.strip(), recursos.strip(), indicador.strip()
    fila.fecha_inicio = date.fromisoformat(fecha_inicio) if fecha_inicio else None
    fila.fecha_fin = date.fromisoformat(fecha_fin) if fecha_fin else None
    db.commit()
    return _redir(f"/evaluacion-desempeno/plan/{lider_id}", msg="Guardado.")


@router.post("/evaluacion-desempeno/plan/{lider_id}/seguimiento/{mes_indice}")
async def plan_seguimiento(lider_id: int, mes_indice: int, user: Empleado = Depends(get_current_user),
                           db: Session = Depends(get_db), avances: str = Form(""), dificultades: str = Form(""),
                           ajustes: str = Form(""), porcentaje_avance: str = Form("")):
    resultado = _plan_editable(db, user, lider_id)
    if isinstance(resultado, RedirectResponse):
        return resultado
    _, plan = resultado
    fila = next((s for s in plan.seguimientos if s.mes_indice == mes_indice), None)
    if not fila:
        return _redir(f"/evaluacion-desempeno/plan/{lider_id}", error="Mes inválido.")
    fila.avances, fila.dificultades, fila.ajustes = avances.strip(), dificultades.strip(), ajustes.strip()
    fila.porcentaje_avance = int(porcentaje_avance) if porcentaje_avance.strip() else None
    db.commit()
    return _redir(f"/evaluacion-desempeno/plan/{lider_id}", msg="Guardado.")


@router.post("/evaluacion-desempeno/plan/{lider_id}/firmar")
async def plan_firmar(lider_id: int, user: Empleado = Depends(get_current_user), db: Session = Depends(get_db),
                      cual: str = Form(...)):
    lider = db.get(Empleado, lider_id)
    ciclo = se.ciclo_actual(db)
    if not lider or not ciclo or cual not in ("lider", "jefe", "rrhh") or not se.puede_firmar(cual, user, lider):
        return _redir("/evaluacion-desempeno", error="No puedes firmar este plan.")
    plan = se.plan_obtener_o_crear(db, lider, ciclo)
    setattr(plan, f"firma_{cual}_nombre", user.nombre_completo)
    setattr(plan, f"firma_{cual}_en", datetime.utcnow())
    db.commit()
    return _redir(f"/evaluacion-desempeno/plan/{lider_id}", msg="Firma registrada.")


# ---------- Resultados (RR.HH.) ----------

@router.get("/evaluacion-desempeno/resultados")
def resultados(request: Request, ciclo_id: int | None = None, user: Empleado = Depends(require_admin),
               db: Session = Depends(get_db)):
    ciclo_actual = se.ciclo_actual(db)
    ciclo = db.get(EvaluacionCiclo, ciclo_id) if ciclo_id else ciclo_actual
    filas = []
    if ciclo:
        for lider in se.lideres_activos(db):
            filas.append({"lider": lider, "resultado": se.promedio_360(db, ciclo, lider),
                         "plan": se.plan_obtener(db, lider, ciclo)})
    todos_ciclos = db.query(EvaluacionCiclo).order_by(EvaluacionCiclo.id.desc()).all()
    return templates.TemplateResponse(request, "evaluacion_desempeno_resultados.html", {
        "user": user, "ciclo": ciclo, "filas": filas, "todos_ciclos": todos_ciclos,
    })


@router.on_event("startup")
async def iniciar() -> None:
    async def ciclo():
        while True:
            await asyncio.sleep(REVISION_CADA_S)
            try:
                await run_in_threadpool(_revisar_y_recordar)
            except Exception as e:  # un fallo nunca debe detener la intranet
                print(f"Evaluación de desempeño: error en el revisor: {e}")
    asyncio.create_task(ciclo())


def _revisar_y_recordar() -> None:
    db = SessionLocal()
    try:
        ciclo = se.abrir_ciclo_si_corresponde(db, date.today()) or se.ciclo_actual(db)
        if ciclo:
            n = se.enviar_recordatorios(db, ciclo)
            if n:
                print(f"Evaluación de desempeño: recordatorio enviado a {n} persona(s) ({ciclo.etiqueta}).")
    finally:
        db.close()
