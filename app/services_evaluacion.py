"""Evaluación de desempeño (People): lógica de negocio.

Dos formularios, basados en la estructura de aprobadores que ya existe en People
(Empleado.aprobador1_id/aprobador2_id):
- "Evalúa a tu jefe" -> Evaluacion360Respuesta, una por cada aprobador vigente (Sección 2 del Excel
  "Plan_Mejora_Lideres_NuviaSmiles": 12 competencias, 1-5 cada una).
- "Evalúa a tu equipo" -> EvaluacionEquipoRespuesta, una por cada persona a cargo (Sección 4 del
  Excel: 3 conceptos, 1-5 cada uno, más una observación libre).

El "Plan de mejora" (PlanMejora + sus filas hijas) es el documento completo del Excel para un líder
en un ciclo dado: la Sección 2 (resultados 360, siempre anónimos: solo promedio y conteo, nunca el
evaluador) y la Sección 4 (lo que su jefe respondió sobre él) se calculan en vivo; las Secciones 1,
3, 5, 6 y 7 se guardan en PlanMejora y sus tablas hijas.

Aplica a todas las empresas (Smiles y Design) -- Design ya tiene su propio "Desempeño" aparte dentro
de Design Schedule (ver app/services_design.py, funciones perf_*), que no tiene relación con esto.
"""
from datetime import date, datetime, timedelta
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from .models import Empleado
from .models_evaluacion import (EvaluacionCiclo, Evaluacion360Respuesta, EvaluacionEquipoRespuesta,
                                PlanMejora, PlanMejoraCompetenciaNota, PlanMejoraAccion,
                                PlanMejoraSeguimiento, EvaluacionRecordatorioEnviado)
from .services import empleados_a_cargo, es_aprobador_soporte
from .zoho_mail import enviar_correo
from .zoho_cliq import enviar_cliq, boton_enlace
from . import config

COMPETENCIAS_360 = [
    "Comunicación de instrucciones y objetivos claros",
    "Información oportuna sobre cambios",
    "Escucha activa de opiniones y preocupaciones",
    "Delegación y confianza en el equipo",
    "Evita microgestión / supervisión excesiva",
    "Ambiente seguro para errores y aprendizaje",
    "Retroalimentación constructiva y oportuna",
    "Interés por el crecimiento profesional",
    "Provisión de recursos y herramientas",
    "Toma de decisiones firme y basada en datos",
    "Visión inspiradora que motiva al equipo",
    "Asume responsabilidad ante los resultados",
]
NIVELES_360 = {1: "Crítico", 2: "Bajo", 3: "Regular", 4: "Bueno", 5: "Excelente"}
PRIORIDADES = ("Alta", "Media", "Baja")

# clave (nombre de columna en EvaluacionEquipoRespuesta), título, descripción -- texto literal del Excel
ASPECTOS_EQUIPO = [
    ("calif_inteligencia_emocional", "Inteligencia emocional y manejo de conflictos",
     "Capacidad para regular emociones bajo presión, mediar conflictos y mantener un tono respetuoso "
     "ante situaciones difíciles."),
    ("calif_equidad", "Equidad y trato consistente con el equipo",
     "Aplicación de los mismos criterios y oportunidades a todos los colaboradores, sin favoritismos "
     "ni diferenciación por afinidad personal."),
    ("calif_cumplimiento_objetivos", "Cumplimiento de objetivos y resultados medibles",
     "Logro de KPIs del área, ejecución de planes en tiempos definidos y aporte a los resultados "
     "estratégicos del grupo Nuvia Smiles."),
]
MESES_CICLO = {11: "Noviembre", 5: "Mayo"}
DIAS_ENTRE_RECORDATORIOS = 7
N_ACCIONES = 6
N_SEGUIMIENTOS = 6


# ---------- Ciclos ----------

def ciclo_actual(db: Session) -> EvaluacionCiclo | None:
    return db.query(EvaluacionCiclo).order_by(EvaluacionCiclo.id.desc()).first()


def _ciclo_de(db: Session, anio: int, mes: int, etiqueta: str) -> EvaluacionCiclo:
    existente = db.query(EvaluacionCiclo).filter_by(anio=anio, mes=mes).first()
    if existente:
        return existente
    ciclo = EvaluacionCiclo(anio=anio, mes=mes, etiqueta=etiqueta)
    db.add(ciclo)
    try:
        db.commit()
    except IntegrityError:  # otro proceso lo creó en paralelo
        db.rollback()
        return db.query(EvaluacionCiclo).filter_by(anio=anio, mes=mes).first()
    db.refresh(ciclo)
    return ciclo


def abrir_ciclo_si_corresponde(db: Session, hoy: date) -> EvaluacionCiclo | None:
    """Idempotente: si `hoy` cae en noviembre o mayo, asegura que exista el ciclo de ese (año, mes)."""
    if hoy.month not in MESES_CICLO:
        return None
    return _ciclo_de(db, hoy.year, hoy.month, f"{MESES_CICLO[hoy.month]} {hoy.year}")


# ---------- Quién evalúa a quién ----------

def jefes_a_evaluar(empleado: Empleado) -> list[Empleado]:
    """Los aprobadores vigentes de `empleado` (deduplicados, solo activos) -- son "su jefe" para
    efectos de "Evalúa a tu jefe"."""
    vistos: dict[int, Empleado] = {}
    for jefe in (empleado.aprobador1, empleado.aprobador2):
        if jefe and jefe.activo and jefe.id not in vistos:
            vistos[jefe.id] = jefe
    return list(vistos.values())


def equipo_a_evaluar(db: Session, empleado: Empleado) -> list[Empleado]:
    """Las personas de las que `empleado` es aprobador -- "su equipo" para "Evalúa a tu equipo"."""
    return empleados_a_cargo(db, empleado)


def tiene_equipo(db: Session, empleado: Empleado) -> bool:
    return bool(equipo_a_evaluar(db, empleado))


def lideres_activos(db: Session) -> list[Empleado]:
    """Empleados activos que son aprobador1 o aprobador2 de al menos un empleado activo."""
    ids_aprobadores = {r[0] for r in db.query(Empleado.aprobador1_id).filter(Empleado.activo == 1,
                                                                             Empleado.aprobador1_id.isnot(None))}
    ids_aprobadores |= {r[0] for r in db.query(Empleado.aprobador2_id).filter(Empleado.activo == 1,
                                                                              Empleado.aprobador2_id.isnot(None))}
    if not ids_aprobadores:
        return []
    return (db.query(Empleado).filter(Empleado.id.in_(ids_aprobadores), Empleado.activo == 1)
            .order_by(Empleado.apellidos).all())


# ---------- Guardar respuestas ----------

def _validar_calificaciones(valores: list[int], n: int) -> str | None:
    if len(valores) != n:
        return f"Se esperaban {n} calificaciones."
    if any(not isinstance(v, int) or v < 1 or v > 5 for v in valores):
        return "Cada calificación debe ser un número entero de 1 a 5."
    return None


def guardar_360(db: Session, ciclo: EvaluacionCiclo, evaluador: Empleado, evaluado: Empleado,
                calificaciones: list[int]) -> tuple[Evaluacion360Respuesta | None, str | None]:
    if evaluado.id not in {j.id for j in jefes_a_evaluar(evaluador)}:
        return None, "Esa persona no es uno de tus jefes."
    error = _validar_calificaciones(calificaciones, len(COMPETENCIAS_360))
    if error:
        return None, error
    r = (db.query(Evaluacion360Respuesta)
         .filter_by(ciclo_id=ciclo.id, evaluador_id=evaluador.id, evaluado_id=evaluado.id).first())
    if not r:
        r = Evaluacion360Respuesta(ciclo_id=ciclo.id, evaluador_id=evaluador.id, evaluado_id=evaluado.id)
        db.add(r)
    for i, valor in enumerate(calificaciones, start=1):
        setattr(r, f"comp_{i}", valor)
    r.actualizado_en = datetime.utcnow()
    db.commit()
    db.refresh(r)
    return r, None


def guardar_equipo(db: Session, ciclo: EvaluacionCiclo, jefe: Empleado, empleado: Empleado,
                   calificaciones: list[int], observacion: str) -> tuple[EvaluacionEquipoRespuesta | None, str | None]:
    if empleado.id not in {e.id for e in equipo_a_evaluar(db, jefe)}:
        return None, "Esa persona no está a tu cargo."
    error = _validar_calificaciones(calificaciones, len(ASPECTOS_EQUIPO))
    if error:
        return None, error
    r = (db.query(EvaluacionEquipoRespuesta)
         .filter_by(ciclo_id=ciclo.id, jefe_id=jefe.id, empleado_id=empleado.id).first())
    if not r:
        r = EvaluacionEquipoRespuesta(ciclo_id=ciclo.id, jefe_id=jefe.id, empleado_id=empleado.id)
        db.add(r)
    for (clave, _, _), valor in zip(ASPECTOS_EQUIPO, calificaciones):
        setattr(r, clave, valor)
    r.observacion = (observacion or "").strip()
    r.actualizado_en = datetime.utcnow()
    db.commit()
    db.refresh(r)
    return r, None


# ---------- Resultados (anónimos) ----------

def promedio_360(db: Session, ciclo: EvaluacionCiclo, lider: Empleado) -> dict:
    """Promedio por competencia y conteo de evaluadores. Nunca selecciona evaluador_id: el
    anonimato es real a nivel de consulta, no solo de presentación."""
    columnas = [getattr(Evaluacion360Respuesta, f"comp_{i}") for i in range(1, 13)]
    fila = (db.query(func.count(Evaluacion360Respuesta.id), *[func.avg(c) for c in columnas])
            .filter(Evaluacion360Respuesta.ciclo_id == ciclo.id, Evaluacion360Respuesta.evaluado_id == lider.id)
            .first())
    n = fila[0] or 0
    promedios = [float(v) if v is not None else None for v in fila[1:]]
    competencias = [{"nombre": nombre, "promedio": p, "nivel": NIVELES_360.get(round(p)) if p else None}
                    for nombre, p in zip(COMPETENCIAS_360, promedios)]
    validos = [p for p in promedios if p is not None]
    promedio_general = sum(validos) / len(validos) if validos else None
    return {"n_evaluadores": n, "competencias": competencias, "promedio_general": promedio_general}


def aspectos_equipo_sobre(db: Session, ciclo: EvaluacionCiclo, lider: Empleado) -> list[EvaluacionEquipoRespuesta]:
    """Lo que el/los jefe(s) de `lider` respondieron sobre él/ella en este ciclo (Sección 4 de SU plan)."""
    return (db.query(EvaluacionEquipoRespuesta)
            .filter_by(ciclo_id=ciclo.id, empleado_id=lider.id).all())


def pendientes(db: Session, empleado: Empleado, ciclo: EvaluacionCiclo) -> dict:
    ya_360 = {r.evaluado_id for r in
             db.query(Evaluacion360Respuesta.evaluado_id)
             .filter_by(ciclo_id=ciclo.id, evaluador_id=empleado.id)}
    ya_equipo = {r.empleado_id for r in
                db.query(EvaluacionEquipoRespuesta.empleado_id)
                .filter_by(ciclo_id=ciclo.id, jefe_id=empleado.id)}
    return {
        "jefes": [j for j in jefes_a_evaluar(empleado) if j.id not in ya_360],
        "equipo": [e for e in equipo_a_evaluar(db, empleado) if e.id not in ya_equipo],
    }


# ---------- Permisos sobre el Plan de mejora ----------

def puede_ver_plan(user: Empleado, lider: Empleado) -> bool:
    return (user.id == lider.id or user.id in {j.id for j in jefes_a_evaluar(lider)}
            or user.rol in ("admin", "superadmin") or es_aprobador_soporte(user))


def puede_editar_plan(user: Empleado, lider: Empleado) -> bool:
    """El líder puede VER su plan pero no editar fortalezas/plan de acción/seguimiento -- eso lo
    escribe su jefe o RR.HH., igual que en el Excel. El líder solo puede firmar."""
    return user.id in {j.id for j in jefes_a_evaluar(lider)} or user.rol in ("admin", "superadmin") \
        or es_aprobador_soporte(user)


def puede_firmar(cual: str, user: Empleado, lider: Empleado) -> bool:
    if cual == "lider":
        return user.id == lider.id or user.rol == "superadmin"
    if cual == "jefe":
        return user.id in {j.id for j in jefes_a_evaluar(lider)} or user.rol == "superadmin"
    if cual == "rrhh":
        return es_aprobador_soporte(user)
    return False


# ---------- El documento ----------

def plan_obtener(db: Session, lider: Empleado, ciclo: EvaluacionCiclo) -> PlanMejora | None:
    return db.query(PlanMejora).filter_by(lider_id=lider.id, ciclo_id=ciclo.id).first()


def plan_obtener_o_crear(db: Session, lider: Empleado, ciclo: EvaluacionCiclo) -> PlanMejora:
    plan = plan_obtener(db, lider, ciclo)
    if plan:
        return plan
    plan = PlanMejora(lider_id=lider.id, ciclo_id=ciclo.id, periodo_plan=ciclo.etiqueta)
    db.add(plan)
    db.flush()
    for i in range(1, len(COMPETENCIAS_360) + 1):
        db.add(PlanMejoraCompetenciaNota(plan_id=plan.id, indice=i))
    for i in range(1, N_ACCIONES + 1):
        db.add(PlanMejoraAccion(plan_id=plan.id, numero=i))
    for i in range(1, N_SEGUIMIENTOS + 1):
        db.add(PlanMejoraSeguimiento(plan_id=plan.id, mes_indice=i))
    db.commit()
    db.refresh(plan)
    return plan


# ---------- Recordatorios automáticos (noviembre y mayo) ----------

def _texto_pendientes(nombre: str, pend: dict) -> str:
    partes = []
    if pend["jefes"]:
        partes.append(f"evaluar a {len(pend['jefes'])} jefe(s)")
    if pend["equipo"]:
        partes.append(f"evaluar a {len(pend['equipo'])} persona(s) de tu equipo")
    return (f"📋 Hola {nombre}, tienes evaluaciones de desempeño pendientes: {' y '.join(partes)}. "
           f"Puedes hacerlas en {config.BASE_URL}/evaluacion-desempeno")


def enviar_recordatorios(db: Session, ciclo: EvaluacionCiclo, forzar: bool = False) -> int:
    """Un recordatorio (Cliq + correo) a cada empleado activo que tenga algo pendiente en este
    ciclo, sin repetirlo antes de DIAS_ENTRE_RECORDATORIOS días. Devuelve a cuántos se les envió."""
    limite = datetime.utcnow() - timedelta(days=DIAS_ENTRE_RECORDATORIOS)
    enviados = 0
    for e in db.query(Empleado).filter(Empleado.activo == 1).order_by(Empleado.apellidos):
        if not e.email:
            continue
        pend = pendientes(db, e, ciclo)
        if not pend["jefes"] and not pend["equipo"]:
            continue
        marca = db.get(EvaluacionRecordatorioEnviado, (ciclo.id, e.id))
        if marca and not forzar and marca.enviado_en > limite:
            continue
        from .formato import nombre_propio
        texto = _texto_pendientes(nombre_propio(e.nombres or e.nombre_completo), pend)
        enviar_cliq(e.email, texto, [boton_enlace("📋 Ir a evaluar", f"{config.BASE_URL}/evaluacion-desempeno")])
        enviar_correo(e.email, "[People] Evaluación de desempeño pendiente",
                      f"<p style='font-family:sans-serif'>{texto}</p>")
        if marca:
            marca.enviado_en = datetime.utcnow()
        else:
            db.add(EvaluacionRecordatorioEnviado(ciclo_id=ciclo.id, empleado_id=e.id, enviado_en=datetime.utcnow()))
        db.commit()
        enviados += 1
    return enviados
