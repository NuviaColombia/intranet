"""Lógica de negocio del módulo Design Schedule."""
import json
from datetime import date, datetime, timedelta
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from .models import Empleado
from .models_design import (DesignArea, DesignTeam, DesignTeamDesigner, DesignCatalogo,
                            DesignAusenciaTipo, DesignOrden, DesignBreak, DesignComentarioHistorial,
                            DesignFaq, DesignPreApprovedSheet, DesignPreApprovedCentro,
                            DesignPreApprovedDoctor, DesignPreApprovedFila, DesignPreApprovedCelda,
                            DesignPerfCriterio, DesignPerfSheet, DesignPerfEmpleado, DesignPerfCelda,
                            DesignPerfGanador, DesignPerfSeleccionFila, DesignPerfSeleccionCelda,
                            DesignTrash, DesignFavorito, DesignProtocolo, DesignCanvasDoc, FORMATO_DUAL)

CAMPOS_ORDEN = [
    "orden", "paciente", "centro", "producto", "designer_id", "designer_prestado",
    "hora_inicio", "hora_inicio_diseno", "hora_fin", "hold_minutos",
    "esferas", "critico", "s_hold", "f_hold",
    "etapa", "solicitado_por", "situacion", "solucion", "clasificacion", "soporte",
    "estado", "qc", "qc_reporte", "notas",
]


def lunes_de(fecha: date) -> date:
    return fecha - timedelta(days=fecha.weekday())


def areas_disponibles(db: Session) -> list[DesignArea]:
    return db.query(DesignArea).filter(DesignArea.activo == 1).order_by(DesignArea.orden).all()


def equipos_de_area(db: Session, area_id: int) -> list[DesignTeam]:
    return (db.query(DesignTeam).options(joinedload(DesignTeam.designers).joinedload(DesignTeamDesigner.empleado),
                                        joinedload(DesignTeam.manager))
            .filter(DesignTeam.area_id == area_id, DesignTeam.activo == 1)
            .order_by(DesignTeam.orden).all())


def catalogo(db: Session, area_id: int, tipo: str) -> list[str]:
    return [c.valor for c in db.query(DesignCatalogo)
            .filter(DesignCatalogo.area_id == area_id, DesignCatalogo.tipo == tipo, DesignCatalogo.activo == 1)
            .order_by(DesignCatalogo.orden).all()]


def agregar_valor_catalogo(db: Session, area_id: int, tipo: str, valor: str) -> None:
    valor = valor.strip()
    if not valor:
        return
    existe = (db.query(DesignCatalogo)
             .filter(DesignCatalogo.area_id == area_id, DesignCatalogo.tipo == tipo,
                     DesignCatalogo.valor == valor).first())
    if existe:
        if not existe.activo:
            existe.activo = 1
            db.commit()
        return
    orden = db.query(DesignCatalogo).filter(DesignCatalogo.area_id == area_id,
                                            DesignCatalogo.tipo == tipo).count() + 1
    db.add(DesignCatalogo(area_id=area_id, tipo=tipo, valor=valor, orden=orden))
    db.commit()


def ausencias_disponibles(db: Session) -> list[str]:
    return [a.nombre for a in db.query(DesignAusenciaTipo).filter(DesignAusenciaTipo.activo == 1)
            .order_by(DesignAusenciaTipo.orden).all()]


def serializar_orden(o: DesignOrden) -> dict:
    return {
        "id": o.id, "tabla": o.tabla, "orden": o.orden, "paciente": o.paciente,
        "centro": o.centro, "producto": o.producto,
        "designerId": o.designer_id, "designerNombre": o.designer.nombre_completo if o.designer else "",
        "designerPrestado": o.designer_prestado,
        "horaInicio": o.hora_inicio, "horaInicioDiseno": o.hora_inicio_diseno, "horaFin": o.hora_fin,
        "holdMinutos": o.hold_minutos, "esferas": o.esferas, "critico": o.critico,
        "sHold": o.s_hold, "fHold": o.f_hold,
        "etapa": o.etapa, "solicitadoPor": o.solicitado_por, "situacion": o.situacion,
        "solucion": o.solucion, "clasificacion": o.clasificacion, "soporte": o.soporte,
        "estado": o.estado, "qc": o.qc, "qcReporte": o.qc_reporte, "notas": o.notas,
        "ordenVisual": o.orden_visual,
    }


def serializar_break(b: DesignBreak) -> dict:
    return {
        "id": b.id, "empleadoId": b.empleado_id, "tipoAusencia": b.tipo_ausencia,
        "almuerzoInicio": b.almuerzo_inicio, "almuerzoFin": b.almuerzo_fin,
        "break1Inicio": b.break1_inicio, "break1Fin": b.break1_fin,
        "break2Inicio": b.break2_inicio, "break2Fin": b.break2_fin,
    }


def datos_dia(db: Session, team: DesignTeam, fecha: date) -> dict:
    ordenes = (db.query(DesignOrden).options(joinedload(DesignOrden.designer))
              .filter(DesignOrden.team_id == team.id, DesignOrden.fecha == fecha)
              .order_by(DesignOrden.orden_visual, DesignOrden.id).all())
    breaks = db.query(DesignBreak).filter(DesignBreak.team_id == team.id, DesignBreak.fecha == fecha).all()
    principal = [serializar_orden(o) for o in ordenes if o.tabla == "principal"]
    nightguard = [serializar_orden(o) for o in ordenes if o.tabla == "nightguard"]
    return {
        "principal": principal, "nightguard": nightguard,
        "breaks": [serializar_break(b) for b in breaks],
        "designers": [{"id": d.empleado_id, "nombre": d.empleado.nombre_completo} for d in team.designers],
    }


def crear_orden(db: Session, user: Empleado, team_id: int, fecha: date, tabla: str, datos: dict) -> DesignOrden:
    max_visual = (db.query(DesignOrden.orden_visual)
                 .filter(DesignOrden.team_id == team_id, DesignOrden.fecha == fecha, DesignOrden.tabla == tabla)
                 .order_by(DesignOrden.orden_visual.desc()).first())
    siguiente_visual = (max_visual[0] + 1) if max_visual else 1
    o = DesignOrden(team_id=team_id, fecha=fecha, tabla=tabla, creado_por_id=user.id, orden_visual=siguiente_visual)
    for campo in CAMPOS_ORDEN:
        if campo in datos:
            setattr(o, campo, datos[campo])
    db.add(o)
    db.commit()
    db.refresh(o)
    return o


def actualizar_orden(db: Session, orden_id: int, datos: dict) -> DesignOrden | None:
    o = db.get(DesignOrden, orden_id)
    if not o:
        return None
    for campo in CAMPOS_ORDEN:
        if campo in datos:
            setattr(o, campo, datos[campo])
    db.commit()
    db.refresh(o)
    return o


def eliminar_orden(db: Session, orden_id: int) -> bool:
    o = db.get(DesignOrden, orden_id)
    if not o:
        return False
    db.delete(o)
    db.commit()
    return True


def guardar_break(db: Session, team_id: int, empleado_id: int, fecha: date, datos: dict) -> DesignBreak:
    b = (db.query(DesignBreak)
        .filter(DesignBreak.team_id == team_id, DesignBreak.empleado_id == empleado_id,
                DesignBreak.fecha == fecha).first())
    if not b:
        b = DesignBreak(team_id=team_id, empleado_id=empleado_id, fecha=fecha)
        db.add(b)
    for campo in ("tipo_ausencia", "almuerzo_inicio", "almuerzo_fin",
                  "break1_inicio", "break1_fin", "break2_inicio", "break2_fin"):
        if campo in datos:
            setattr(b, campo, datos[campo])
    db.commit()
    db.refresh(b)
    return b


# ---------- Dashboard ----------

def dashboard_query(db: Session, area_id: int | None = None, team_id: int | None = None,
                    designer_id: int | None = None, producto: str = "", estado: str = "",
                    qc: str = "", fecha_desde: date | None = None, fecha_hasta: date | None = None) -> dict:
    q = db.query(DesignOrden).options(joinedload(DesignOrden.designer), joinedload(DesignOrden.team))
    if team_id:
        q = q.filter(DesignOrden.team_id == team_id)
    elif area_id:
        q = q.join(DesignTeam, DesignOrden.team_id == DesignTeam.id).filter(DesignTeam.area_id == area_id)
    if designer_id:
        q = q.filter(DesignOrden.designer_id == designer_id)
    if producto:
        q = q.filter(DesignOrden.producto == producto)
    if estado:
        q = q.filter(DesignOrden.estado == estado)
    if qc == "si":
        q = q.filter(DesignOrden.qc.is_(True))
    elif qc == "no":
        q = q.filter(DesignOrden.qc.is_(False))
    if fecha_desde:
        q = q.filter(DesignOrden.fecha >= fecha_desde)
    if fecha_hasta:
        q = q.filter(DesignOrden.fecha <= fecha_hasta)
    filas = q.order_by(DesignOrden.fecha.desc()).all()

    por_designer: dict[int, dict] = {}
    por_producto: dict[str, int] = {}
    qc_reportes, sin_qc = [], []
    for f in filas:
        nombre_d = f.designer.nombre_completo if f.designer else (f.designer_prestado or "Sin asignar")
        clave = f.designer_id or f"libre:{nombre_d}"
        if clave not in por_designer:
            por_designer[clave] = {"designerId": f.designer_id, "nombre": nombre_d, "casos": 0, "duracionMin": 0}
        por_designer[clave]["casos"] += 1
        por_designer[clave]["duracionMin"] += _duracion_minutos(f.hora_inicio, f.hora_fin)

        if f.producto:
            por_producto[f.producto] = por_producto.get(f.producto, 0) + 1

        if f.qc_reporte.strip():
            qc_reportes.append({"ordenId": f.id, "orden": f.orden, "paciente": f.paciente,
                               "fecha": f.fecha.isoformat(), "qcReporte": f.qc_reporte, "designerNombre": nombre_d})
        if not f.qc and "approv" in (f.estado or "").lower():
            sin_qc.append({"ordenId": f.id, "orden": f.orden, "paciente": f.paciente,
                          "fecha": f.fecha.isoformat(), "estado": f.estado, "designerNombre": nombre_d})

    return {
        "totalCasos": len(filas),
        "porDesigner": sorted(por_designer.values(), key=lambda d: -d["casos"]),
        "porProducto": sorted([{"producto": p, "casos": c} for p, c in por_producto.items()],
                              key=lambda d: -d["casos"]),
        "qcReportes": qc_reportes,
        "sinQc": sin_qc,
    }


def _duracion_minutos(inicio: str, fin: str) -> float:
    if not inicio or not fin:
        return 0
    try:
        h1, m1 = [int(x) for x in inicio.split(":")]
        h2, m2 = [int(x) for x in fin.split(":")]
        mins = (h2 * 60 + m2) - (h1 * 60 + m1)
        return mins if mins > 0 else 0
    except (ValueError, IndexError):
        return 0


def buscar_ordenes(db: Session, texto: str) -> list[dict]:
    texto = texto.strip().upper()
    if not texto:
        return []
    filas = (db.query(DesignOrden).options(joinedload(DesignOrden.team).joinedload(DesignTeam.area))
            .filter((DesignOrden.orden.ilike(f"%{texto}%")) | (DesignOrden.paciente.ilike(f"%{texto}%")))
            .order_by(DesignOrden.fecha.desc()).limit(50).all())
    return [{"ordenId": f.id, "orden": f.orden, "paciente": f.paciente, "fecha": f.fecha.isoformat(),
            "area": f.team.area.nombre, "equipo": f.team.nombre, "teamId": f.team_id} for f in filas]


# ---------- Comments N3: historial ----------

def historial_comentarios(db: Session) -> list[dict]:
    limite = datetime.utcnow() - timedelta(days=2)
    db.query(DesignComentarioHistorial).filter(DesignComentarioHistorial.creado_en < limite).delete()
    db.commit()
    filas = (db.query(DesignComentarioHistorial)
            .filter(DesignComentarioHistorial.creado_en >= limite)
            .order_by(DesignComentarioHistorial.creado_en.desc()).all())
    return [{"id": h.id, "paciente": h.paciente, "orden": h.orden, "campos": json.loads(h.campos),
            "creadoEn": h.creado_en.isoformat()} for h in filas]


def guardar_historial_comentario(db: Session, user: Empleado, paciente: str, orden: str, campos: dict) -> None:
    db.add(DesignComentarioHistorial(paciente=paciente, orden=orden, campos=json.dumps(campos),
                                     creado_por_id=user.id))
    db.commit()


def eliminar_historial_comentario(db: Session, historial_id: int) -> bool:
    h = db.get(DesignComentarioHistorial, historial_id)
    if not h:
        return False
    db.delete(h)
    db.commit()
    return True


# ---------- Comments N2 / Face: FAQ ----------

def faq_de_area(db: Session, area_id: int) -> list[DesignFaq]:
    return db.query(DesignFaq).filter(DesignFaq.area_id == area_id).order_by(DesignFaq.orden).all()


def crear_faq(db: Session, area_id: int) -> DesignFaq:
    orden = db.query(DesignFaq).filter(DesignFaq.area_id == area_id).count() + 1
    f = DesignFaq(area_id=area_id, orden=orden)
    db.add(f)
    db.commit()
    db.refresh(f)
    return f


def actualizar_faq(db: Session, faq_id: int, datos: dict) -> DesignFaq | None:
    f = db.get(DesignFaq, faq_id)
    if not f:
        return None
    for campo in ("seccion", "situacion", "producto", "como_proceder", "plantilla", "ejemplos"):
        if campo in datos:
            setattr(f, campo, datos[campo])
    db.commit()
    db.refresh(f)
    return f


def eliminar_faq(db: Session, faq_id: int) -> bool:
    f = db.get(DesignFaq, faq_id)
    if not f:
        return False
    db.delete(f)
    db.commit()
    return True


# ---------- Pre-Approved ----------

def preapproved_sheets(db: Session, area_id: int) -> list[DesignPreApprovedSheet]:
    return (db.query(DesignPreApprovedSheet).filter(DesignPreApprovedSheet.area_id == area_id)
            .order_by(DesignPreApprovedSheet.orden).all())


def preapproved_detalle(db: Session, sheet_id: int) -> dict | None:
    s = db.get(DesignPreApprovedSheet, sheet_id)
    if not s:
        return None
    doctores = s.doctores
    celdas_por_fila = {}
    for fila in s.filas:
        celdas_por_fila[fila.id] = {c.doctor_id: c.valor for c in fila.celdas}
    return {
        "id": s.id, "nombre": s.nombre, "titulo": s.titulo, "changesLabel": s.changes_label,
        "centros": [{"id": c.id, "nombre": c.nombre, "span": c.span} for c in s.centros],
        "doctores": [{"id": d.id, "nombre": d.nombre} for d in doctores],
        "filas": [{"id": f.id, "criterio": f.criterio,
                  "valores": {str(did): celdas_por_fila.get(f.id, {}).get(did, "") for did in [d.id for d in doctores]}}
                 for f in s.filas],
    }


def crear_preapproved_sheet(db: Session, area_id: int, nombre: str) -> DesignPreApprovedSheet:
    orden = db.query(DesignPreApprovedSheet).filter(DesignPreApprovedSheet.area_id == area_id).count() + 1
    s = DesignPreApprovedSheet(area_id=area_id, nombre=nombre.strip() or f"Hoja {orden}", orden=orden)
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


def actualizar_preapproved_sheet(db: Session, sheet_id: int, datos: dict) -> DesignPreApprovedSheet | None:
    s = db.get(DesignPreApprovedSheet, sheet_id)
    if not s:
        return None
    for campo in ("nombre", "titulo", "changes_label"):
        if campo in datos:
            setattr(s, campo, datos[campo])
    db.commit()
    db.refresh(s)
    return s


def eliminar_preapproved_sheet(db: Session, sheet_id: int, eliminado_por: str = "") -> bool:
    s = db.get(DesignPreApprovedSheet, sheet_id)
    if not s:
        return False
    payload = {"area_id": s.area_id, "orden": s.orden, "detalle": preapproved_detalle(db, sheet_id)}
    _trash_registrar(db, "pa-sheet", f"Hoja Pre-Approved: {s.nombre}", payload, eliminado_por)
    db.delete(s)
    db.commit()
    return True


def preapproved_agregar_centro(db: Session, sheet_id: int, nombre: str = "", span: int = 1) -> DesignPreApprovedCentro:
    orden = db.query(DesignPreApprovedCentro).filter(DesignPreApprovedCentro.sheet_id == sheet_id).count() + 1
    c = DesignPreApprovedCentro(sheet_id=sheet_id, nombre=nombre, span=span, orden=orden)
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


def preapproved_actualizar_centro(db: Session, centro_id: int, nombre: str, span: int) -> None:
    c = db.get(DesignPreApprovedCentro, centro_id)
    if c:
        c.nombre = nombre
        c.span = max(1, span)
        db.commit()


def preapproved_eliminar_centro(db: Session, centro_id: int, eliminado_por: str = "") -> bool:
    c = db.get(DesignPreApprovedCentro, centro_id)
    if not c:
        return False
    payload = {"sheet_id": c.sheet_id, "nombre": c.nombre, "span": c.span}
    _trash_registrar(db, "pa-centro", f"Centro Pre-Approved: {c.nombre}", payload, eliminado_por)
    db.delete(c)
    db.commit()
    return True


def preapproved_agregar_doctor(db: Session, sheet_id: int, nombre: str = "") -> DesignPreApprovedDoctor:
    orden = db.query(DesignPreApprovedDoctor).filter(DesignPreApprovedDoctor.sheet_id == sheet_id).count() + 1
    d = DesignPreApprovedDoctor(sheet_id=sheet_id, nombre=nombre, orden=orden)
    db.add(d)
    db.commit()
    db.refresh(d)
    return d


def preapproved_renombrar_doctor(db: Session, doctor_id: int, nombre: str) -> None:
    d = db.get(DesignPreApprovedDoctor, doctor_id)
    if d:
        d.nombre = nombre
        db.commit()


def preapproved_eliminar_doctor(db: Session, doctor_id: int, eliminado_por: str = "") -> bool:
    d = db.get(DesignPreApprovedDoctor, doctor_id)
    if not d:
        return False
    celdas = db.query(DesignPreApprovedCelda).filter(DesignPreApprovedCelda.doctor_id == doctor_id).all()
    payload = {"sheet_id": d.sheet_id, "nombre": d.nombre,
              "celdas": [{"fila_id": c.fila_id, "valor": c.valor} for c in celdas]}
    _trash_registrar(db, "pa-doctor", f"Doctor Pre-Approved: {d.nombre}", payload, eliminado_por)
    db.query(DesignPreApprovedCelda).filter(DesignPreApprovedCelda.doctor_id == doctor_id).delete()
    db.delete(d)
    db.commit()
    return True


def preapproved_agregar_fila(db: Session, sheet_id: int, criterio: str = "") -> DesignPreApprovedFila:
    orden = db.query(DesignPreApprovedFila).filter(DesignPreApprovedFila.sheet_id == sheet_id).count() + 1
    f = DesignPreApprovedFila(sheet_id=sheet_id, criterio=criterio, orden=orden)
    db.add(f)
    db.commit()
    db.refresh(f)
    return f


def preapproved_renombrar_fila(db: Session, fila_id: int, criterio: str) -> None:
    f = db.get(DesignPreApprovedFila, fila_id)
    if f:
        f.criterio = criterio
        db.commit()


def preapproved_eliminar_fila(db: Session, fila_id: int, eliminado_por: str = "") -> bool:
    f = db.get(DesignPreApprovedFila, fila_id)
    if not f:
        return False
    celdas = db.query(DesignPreApprovedCelda).filter(DesignPreApprovedCelda.fila_id == fila_id).all()
    payload = {"sheet_id": f.sheet_id, "criterio": f.criterio,
              "celdas": [{"doctor_id": c.doctor_id, "valor": c.valor} for c in celdas]}
    _trash_registrar(db, "pa-fila", f"Criterio Pre-Approved: {f.criterio}", payload, eliminado_por)
    db.delete(f)
    db.commit()
    return True


def preapproved_guardar_celda(db: Session, fila_id: int, doctor_id: int, valor: str) -> None:
    c = (db.query(DesignPreApprovedCelda)
        .filter(DesignPreApprovedCelda.fila_id == fila_id, DesignPreApprovedCelda.doctor_id == doctor_id).first())
    if not c:
        c = DesignPreApprovedCelda(fila_id=fila_id, doctor_id=doctor_id, valor=valor)
        db.add(c)
    else:
        c.valor = valor
    db.commit()


# ---------------------------------------------------------------------------
# Desempeño (Performance) — acceso restringido a administradores (RR.HH.).
# ---------------------------------------------------------------------------

def perf_criterios(db: Session) -> list[DesignPerfCriterio]:
    return db.query(DesignPerfCriterio).order_by(DesignPerfCriterio.orden).all()


def perf_sheets(db: Session) -> list[DesignPerfSheet]:
    return db.query(DesignPerfSheet).order_by(DesignPerfSheet.orden).all()


def perf_detalle_eval(db: Session, sheet_id: int) -> dict | None:
    sheet = db.get(DesignPerfSheet, sheet_id)
    if not sheet or sheet.tipo != "eval":
        return None
    criterios = perf_criterios(db)
    empleados = (db.query(DesignPerfEmpleado)
        .filter(DesignPerfEmpleado.sheet_id == sheet_id)
        .order_by(DesignPerfEmpleado.orden).all())
    celdas_por_emp: dict[int, dict] = {}
    if empleados:
        emp_ids = [e.id for e in empleados]
        for c in db.query(DesignPerfCelda).filter(DesignPerfCelda.empleado_id.in_(emp_ids)).all():
            celdas_por_emp.setdefault(c.empleado_id, {})[f"{c.criterio_id}_{c.mes_indice}"] = {
                "nivel": c.nivel, "puntaje": c.puntaje}
    return {
        "id": sheet.id, "nombre": sheet.nombre, "tipo": sheet.tipo,
        "meses": json.loads(sheet.meses or "[]"),
        "criterios": [{"id": c.id, "nombre": c.nombre} for c in criterios],
        "empleados": [{
            "id": e.id, "nombre": e.nombre, "nota": e.nota, "total": e.total,
            "totalesMes": json.loads(e.totales_mes or "[]"),
            "celdas": celdas_por_emp.get(e.id, {}),
        } for e in empleados],
    }


def perf_guardar_celda(db: Session, empleado_id: int, criterio_id: int, mes_indice: int,
                       nivel: str, puntaje: float) -> None:
    c = (db.query(DesignPerfCelda)
        .filter(DesignPerfCelda.empleado_id == empleado_id, DesignPerfCelda.criterio_id == criterio_id,
                DesignPerfCelda.mes_indice == mes_indice).first())
    if not c:
        c = DesignPerfCelda(empleado_id=empleado_id, criterio_id=criterio_id, mes_indice=mes_indice)
        db.add(c)
    c.nivel = nivel
    c.puntaje = puntaje or 0
    db.commit()


def perf_guardar_nota(db: Session, empleado_id: int, nota: str) -> None:
    e = db.get(DesignPerfEmpleado, empleado_id)
    if e:
        e.nota = nota
        db.commit()


def perf_detalle_seleccion(db: Session, sheet_id: int) -> dict | None:
    sheet = db.get(DesignPerfSheet, sheet_id)
    if not sheet or sheet.tipo != "seleccion":
        return None
    ganadores = (db.query(DesignPerfGanador).filter(DesignPerfGanador.sheet_id == sheet_id)
        .order_by(DesignPerfGanador.orden).all())
    filas = (db.query(DesignPerfSeleccionFila).filter(DesignPerfSeleccionFila.sheet_id == sheet_id)
        .order_by(DesignPerfSeleccionFila.orden).all())
    filas_out = []
    for f in filas:
        celdas = {c.mes_indice: {"persona": c.persona, "puntaje": c.puntaje, "nota": c.nota}
                  for c in db.query(DesignPerfSeleccionCelda).filter(DesignPerfSeleccionCelda.fila_id == f.id).all()}
        filas_out.append({"id": f.id, "evaluador": f.evaluador, "celdas": celdas})
    return {
        "id": sheet.id, "nombre": sheet.nombre, "tipo": sheet.tipo,
        "meses": json.loads(sheet.meses or "[]"),
        "ganadores": [{"id": g.id, "categoria": g.categoria,
                       "ganadoresMes": json.loads(g.ganadores_mes or "[]")} for g in ganadores],
        "filas": filas_out,
    }


def perf_guardar_ganador_mes(db: Session, ganador_id: int, mes_indice: int, nombre: str) -> None:
    g = db.get(DesignPerfGanador, ganador_id)
    if not g:
        return
    valores = json.loads(g.ganadores_mes or "[]")
    while len(valores) <= mes_indice:
        valores.append("")
    valores[mes_indice] = nombre
    g.ganadores_mes = json.dumps(valores, ensure_ascii=False)
    db.commit()


def perf_guardar_celda_seleccion(db: Session, fila_id: int, mes_indice: int,
                                 persona: str, puntaje: str, nota: str) -> None:
    c = (db.query(DesignPerfSeleccionCelda)
        .filter(DesignPerfSeleccionCelda.fila_id == fila_id,
                DesignPerfSeleccionCelda.mes_indice == mes_indice).first())
    if not c:
        c = DesignPerfSeleccionCelda(fila_id=fila_id, mes_indice=mes_indice)
        db.add(c)
    c.persona = persona
    c.puntaje = puntaje
    c.nota = nota
    db.commit()


# ---------------------------------------------------------------------------
# Papelera (Trash)
# ---------------------------------------------------------------------------

def _trash_registrar(db: Session, modulo: str, etiqueta: str, payload: dict, eliminado_por: str) -> None:
    db.add(DesignTrash(modulo=modulo, etiqueta=etiqueta, payload=json.dumps(payload, ensure_ascii=False),
                       eliminado_por=eliminado_por or "Sistema"))


def trash_listar(db: Session) -> list[DesignTrash]:
    return db.query(DesignTrash).order_by(DesignTrash.eliminado_en.desc()).all()


def trash_eliminar_permanente(db: Session, trash_id: int) -> bool:
    t = db.get(DesignTrash, trash_id)
    if not t:
        return False
    db.delete(t)
    db.commit()
    return True


def trash_vaciar(db: Session) -> None:
    db.query(DesignTrash).delete()
    db.commit()


def _trash_restaurar_pa_sheet(db: Session, payload: dict) -> bool:
    area_id = payload.get("area_id")
    det = payload.get("detalle") or {}
    if not area_id or not db.get(DesignArea, area_id) or not det:
        return False
    orden = db.query(DesignPreApprovedSheet).filter(DesignPreApprovedSheet.area_id == area_id).count() + 1
    s = DesignPreApprovedSheet(area_id=area_id, nombre=det.get("nombre", ""), titulo=det.get("titulo", ""),
                               changes_label=det.get("changesLabel", ""), orden=payload.get("orden") or orden)
    db.add(s)
    db.flush()
    for j, c in enumerate(det.get("centros", []), start=1):
        db.add(DesignPreApprovedCentro(sheet_id=s.id, nombre=c.get("nombre", ""), span=c.get("span") or 1, orden=j))
    doctor_map = {}
    for j, doc in enumerate(det.get("doctores", []), start=1):
        d = DesignPreApprovedDoctor(sheet_id=s.id, nombre=doc.get("nombre", ""), orden=j)
        db.add(d)
        db.flush()
        doctor_map[doc["id"]] = d.id
    for j, fila in enumerate(det.get("filas", []), start=1):
        f = DesignPreApprovedFila(sheet_id=s.id, criterio=fila.get("criterio", ""), orden=j)
        db.add(f)
        db.flush()
        for old_doc_id_str, valor in (fila.get("valores") or {}).items():
            if not valor:
                continue
            new_doc_id = doctor_map.get(int(old_doc_id_str))
            if new_doc_id:
                db.add(DesignPreApprovedCelda(fila_id=f.id, doctor_id=new_doc_id, valor=valor))
    return True


def _trash_restaurar_pa_centro(db: Session, payload: dict) -> bool:
    sheet_id = payload.get("sheet_id")
    if not db.get(DesignPreApprovedSheet, sheet_id):
        return False
    orden = db.query(DesignPreApprovedCentro).filter(DesignPreApprovedCentro.sheet_id == sheet_id).count() + 1
    db.add(DesignPreApprovedCentro(sheet_id=sheet_id, nombre=payload.get("nombre", ""),
                                   span=payload.get("span") or 1, orden=orden))
    return True


def _trash_restaurar_pa_doctor(db: Session, payload: dict) -> bool:
    sheet_id = payload.get("sheet_id")
    if not db.get(DesignPreApprovedSheet, sheet_id):
        return False
    orden = db.query(DesignPreApprovedDoctor).filter(DesignPreApprovedDoctor.sheet_id == sheet_id).count() + 1
    d = DesignPreApprovedDoctor(sheet_id=sheet_id, nombre=payload.get("nombre", ""), orden=orden)
    db.add(d)
    db.flush()
    for c in payload.get("celdas", []):
        if db.get(DesignPreApprovedFila, c.get("fila_id")):
            db.add(DesignPreApprovedCelda(fila_id=c["fila_id"], doctor_id=d.id, valor=c.get("valor", "")))
    return True


def _trash_restaurar_pa_fila(db: Session, payload: dict) -> bool:
    sheet_id = payload.get("sheet_id")
    if not db.get(DesignPreApprovedSheet, sheet_id):
        return False
    orden = db.query(DesignPreApprovedFila).filter(DesignPreApprovedFila.sheet_id == sheet_id).count() + 1
    f = DesignPreApprovedFila(sheet_id=sheet_id, criterio=payload.get("criterio", ""), orden=orden)
    db.add(f)
    db.flush()
    for c in payload.get("celdas", []):
        if db.get(DesignPreApprovedDoctor, c.get("doctor_id")):
            db.add(DesignPreApprovedCelda(fila_id=f.id, doctor_id=c["doctor_id"], valor=c.get("valor", "")))
    return True


def _trash_restaurar_protocolo(db: Session, payload: dict) -> bool:
    p = payload.get("protocolo") or {}
    if not p:
        return False
    area_id = p.get("area_id")
    if area_id and not db.get(DesignArea, area_id):
        area_id = None
    db.add(DesignProtocolo(area_id=area_id, titulo=p.get("titulo", ""), descripcion=p.get("descripcion", ""),
                           contenido=p.get("contenido", ""), version=p.get("version") or "v1.0",
                           creado_por=p.get("creado_por", "")))
    return True


def _trash_restaurar_cv_doc(db: Session, payload: dict) -> bool:
    area_id = payload.get("area_id")
    doc = payload.get("doc") or {}
    if not area_id or not db.get(DesignArea, area_id) or not doc:
        return False
    orden = payload.get("orden") or (db.query(DesignCanvasDoc).filter(DesignCanvasDoc.area_id == area_id).count() + 1)
    db.add(DesignCanvasDoc(area_id=area_id, nombre=doc.get("nombre", "Hoja"), template_id=doc.get("templateId", ""),
                           titulo=doc.get("titulo", ""), titulo_color=doc.get("tituloColor") or "#d10a11",
                           w=doc.get("w") or 1080, h=doc.get("h") or 1080,
                           frames=json.dumps(doc.get("frames", []), ensure_ascii=False),
                           elements=json.dumps(doc.get("elements", []), ensure_ascii=False),
                           orden=orden, creado_por=doc.get("creadoPor", "")))
    return True


_TRASH_RESTAURADORES = {
    "pa-sheet": _trash_restaurar_pa_sheet,
    "pa-centro": _trash_restaurar_pa_centro,
    "pa-doctor": _trash_restaurar_pa_doctor,
    "pa-fila": _trash_restaurar_pa_fila,
    "protocol": _trash_restaurar_protocolo,
    "cv-doc": _trash_restaurar_cv_doc,
}


def trash_restaurar(db: Session, trash_id: int) -> bool:
    t = db.get(DesignTrash, trash_id)
    if not t:
        return False
    restaurador = _TRASH_RESTAURADORES.get(t.modulo)
    if not restaurador:
        return False
    payload = json.loads(t.payload)
    try:
        ok = restaurador(db, payload)
    except Exception:
        db.rollback()
        return False
    if ok:
        db.delete(t)
        db.commit()
    else:
        db.rollback()
    return ok


# ---------------------------------------------------------------------------
# Favoritos
# ---------------------------------------------------------------------------

def favoritos_de(db: Session, empleado_id: int) -> list[dict]:
    favs = (db.query(DesignFavorito).filter(DesignFavorito.empleado_id == empleado_id)
           .order_by(DesignFavorito.creado_en.desc()).all())
    out = []
    huerfanos = []
    for f in favs:
        if f.tipo == "team":
            t = db.get(DesignTeam, f.team_id)
            if not t:
                huerfanos.append(f.id)
                continue
            out.append({"id": f.id, "tipo": "team", "etiqueta": t.area.nombre + " — " + t.nombre,
                       "areaId": t.area_id, "teamId": t.id})
        elif f.tipo == "preapproved":
            s = db.get(DesignPreApprovedSheet, f.preapproved_sheet_id)
            if not s:
                huerfanos.append(f.id)
                continue
            out.append({"id": f.id, "tipo": "preapproved", "etiqueta": "Pre-Approved — " + s.nombre,
                       "areaId": s.area_id, "sheetId": s.id})
        elif f.tipo == "protocolo":
            p = db.get(DesignProtocolo, f.protocolo_id)
            if not p:
                huerfanos.append(f.id)
                continue
            out.append({"id": f.id, "tipo": "protocolo", "etiqueta": "Protocolo — " + p.titulo,
                       "protocoloId": p.id})
    if huerfanos:
        db.query(DesignFavorito).filter(DesignFavorito.id.in_(huerfanos)).delete(synchronize_session=False)
        db.commit()
    return out


def favorito_toggle_team(db: Session, empleado_id: int, team_id: int) -> bool:
    existente = (db.query(DesignFavorito)
        .filter(DesignFavorito.empleado_id == empleado_id, DesignFavorito.tipo == "team",
                DesignFavorito.team_id == team_id).first())
    if existente:
        db.delete(existente)
        db.commit()
        return False
    db.add(DesignFavorito(empleado_id=empleado_id, tipo="team", team_id=team_id))
    db.commit()
    return True


def favorito_toggle_preapproved(db: Session, empleado_id: int, sheet_id: int) -> bool:
    existente = (db.query(DesignFavorito)
        .filter(DesignFavorito.empleado_id == empleado_id, DesignFavorito.tipo == "preapproved",
                DesignFavorito.preapproved_sheet_id == sheet_id).first())
    if existente:
        db.delete(existente)
        db.commit()
        return False
    db.add(DesignFavorito(empleado_id=empleado_id, tipo="preapproved", preapproved_sheet_id=sheet_id))
    db.commit()
    return True


def favorito_toggle_protocolo(db: Session, empleado_id: int, protocolo_id: int) -> bool:
    existente = (db.query(DesignFavorito)
        .filter(DesignFavorito.empleado_id == empleado_id, DesignFavorito.tipo == "protocolo",
                DesignFavorito.protocolo_id == protocolo_id).first())
    if existente:
        db.delete(existente)
        db.commit()
        return False
    db.add(DesignFavorito(empleado_id=empleado_id, tipo="protocolo", protocolo_id=protocolo_id))
    db.commit()
    return True


def favoritos_activos(db: Session, empleado_id: int) -> dict:
    favs = db.query(DesignFavorito).filter(DesignFavorito.empleado_id == empleado_id).all()
    return {
        "teams": {f.team_id for f in favs if f.tipo == "team"},
        "preapproved": {f.preapproved_sheet_id for f in favs if f.tipo == "preapproved"},
        "protocolos": {f.protocolo_id for f in favs if f.tipo == "protocolo"},
    }


# ---------------------------------------------------------------------------
# Protocols: biblioteca de SOPs
# ---------------------------------------------------------------------------

def protocolos_listar(db: Session, area_id: int | None = None, q: str = "") -> list[DesignProtocolo]:
    query = db.query(DesignProtocolo)
    if area_id:
        query = query.filter(DesignProtocolo.area_id == area_id)
    if q:
        like = f"%{q.lower()}%"
        query = query.filter(func.lower(DesignProtocolo.titulo + " " + DesignProtocolo.descripcion + " " +
                                        DesignProtocolo.contenido).like(like))
    return query.order_by(DesignProtocolo.creado_en.desc()).all()


def protocolo_detalle(db: Session, protocolo_id: int) -> DesignProtocolo | None:
    return db.get(DesignProtocolo, protocolo_id)


def protocolo_crear(db: Session, area_id: int | None, titulo: str, descripcion: str, contenido: str,
                    version: str = "v1.0", creado_por: str = "") -> DesignProtocolo:
    p = DesignProtocolo(area_id=area_id, titulo=titulo.strip() or "Protocolo sin título",
                        descripcion=descripcion, contenido=contenido, version=version or "v1.0",
                        creado_por=creado_por)
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


def protocolo_eliminar(db: Session, protocolo_id: int, eliminado_por: str = "") -> bool:
    p = db.get(DesignProtocolo, protocolo_id)
    if not p:
        return False
    payload = {"protocolo": {"area_id": p.area_id, "titulo": p.titulo, "descripcion": p.descripcion,
                             "contenido": p.contenido, "version": p.version, "creado_por": p.creado_por}}
    _trash_registrar(db, "protocol", f'Protocolo: "{p.titulo}"', payload, eliminado_por)
    db.query(DesignFavorito).filter(DesignFavorito.tipo == "protocolo", DesignFavorito.protocolo_id == protocolo_id).delete()
    db.delete(p)
    db.commit()
    return True


# ---------------------------------------------------------------------------
# Canvas
# ---------------------------------------------------------------------------

def canvas_serializar(d: DesignCanvasDoc) -> dict:
    return {
        "id": d.id, "areaId": d.area_id, "nombre": d.nombre, "templateId": d.template_id,
        "titulo": d.titulo, "tituloColor": d.titulo_color, "w": d.w, "h": d.h,
        "frames": json.loads(d.frames or "[]"), "elements": json.loads(d.elements or "[]"),
        "orden": d.orden, "creadoPor": d.creado_por,
    }


def canvas_docs(db: Session, area_id: int) -> list[dict]:
    docs = (db.query(DesignCanvasDoc).filter(DesignCanvasDoc.area_id == area_id)
           .order_by(DesignCanvasDoc.orden).all())
    return [canvas_serializar(d) for d in docs]


def canvas_doc(db: Session, doc_id: int) -> dict | None:
    d = db.get(DesignCanvasDoc, doc_id)
    return canvas_serializar(d) if d else None


def canvas_crear_doc(db: Session, area_id: int, nombre: str, template_id: str, titulo: str,
                     frames: list, creado_por: str = "") -> DesignCanvasDoc:
    orden = db.query(DesignCanvasDoc).filter(DesignCanvasDoc.area_id == area_id).count() + 1
    d = DesignCanvasDoc(area_id=area_id, nombre=nombre or "Hoja", template_id=template_id or "",
                       titulo=titulo or "", frames=json.dumps(frames or [], ensure_ascii=False),
                       orden=orden, creado_por=creado_por)
    db.add(d)
    db.commit()
    db.refresh(d)
    return d


def canvas_guardar_doc(db: Session, doc_id: int, datos: dict) -> DesignCanvasDoc | None:
    d = db.get(DesignCanvasDoc, doc_id)
    if not d:
        return None
    if "nombre" in datos:
        d.nombre = datos["nombre"] or d.nombre
    if "titulo" in datos:
        d.titulo = datos["titulo"]
    if "tituloColor" in datos:
        d.titulo_color = datos["tituloColor"] or d.titulo_color
    if "w" in datos and datos["w"]:
        d.w = int(datos["w"])
    if "h" in datos and datos["h"]:
        d.h = int(datos["h"])
    if "frames" in datos:
        d.frames = json.dumps(datos["frames"], ensure_ascii=False)
    if "elements" in datos:
        d.elements = json.dumps(datos["elements"], ensure_ascii=False)
    db.commit()
    return d


def canvas_renombrar_doc(db: Session, doc_id: int, nombre: str) -> bool:
    d = db.get(DesignCanvasDoc, doc_id)
    if not d:
        return False
    d.nombre = nombre.strip() or d.nombre
    db.commit()
    return True


def canvas_duplicar_doc(db: Session, doc_id: int) -> DesignCanvasDoc | None:
    d = db.get(DesignCanvasDoc, doc_id)
    if not d:
        return None
    orden = db.query(DesignCanvasDoc).filter(DesignCanvasDoc.area_id == d.area_id).count() + 1
    copia = DesignCanvasDoc(area_id=d.area_id, nombre=d.nombre + " (copia)", template_id=d.template_id,
                            titulo=d.titulo, titulo_color=d.titulo_color, w=d.w, h=d.h,
                            frames=d.frames, elements=d.elements, orden=orden, creado_por=d.creado_por)
    db.add(copia)
    db.commit()
    db.refresh(copia)
    return copia


def canvas_mover_doc(db: Session, doc_id: int, target_id: int) -> bool:
    d = db.get(DesignCanvasDoc, doc_id)
    t = db.get(DesignCanvasDoc, target_id)
    if not d or not t or d.area_id != t.area_id:
        return False
    docs = (db.query(DesignCanvasDoc).filter(DesignCanvasDoc.area_id == d.area_id)
           .order_by(DesignCanvasDoc.orden).all())
    docs = [x for x in docs if x.id != d.id]
    idx = next((i for i, x in enumerate(docs) if x.id == t.id), len(docs))
    docs.insert(idx, d)
    for i, x in enumerate(docs, start=1):
        x.orden = i
    db.commit()
    return True


def canvas_eliminar_doc(db: Session, doc_id: int, eliminado_por: str = "") -> bool:
    d = db.get(DesignCanvasDoc, doc_id)
    if not d:
        return False
    payload = {"area_id": d.area_id, "orden": d.orden, "doc": canvas_serializar(d)}
    _trash_registrar(db, "cv-doc", f'Hoja de Canvas "{d.nombre}"', payload, eliminado_por)
    db.delete(d)
    db.commit()
    return True
