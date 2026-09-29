"""Lógica de negocio del módulo Design Schedule."""
import json
import re
import unicodedata
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, and_, or_
from .models import Empleado, Solicitud, TipoPermiso
from .models_design import (DesignArea, DesignTeam, DesignTeamDesigner, DesignCatalogo,
                            DesignAusenciaTipo, DesignOrden, DesignBreak, DesignComentarioHistorial,
                            DesignFaq, DesignPreApprovedSheet, DesignPreApprovedCentro,
                            DesignPreApprovedDoctor, DesignPreApprovedFila, DesignPreApprovedCelda,
                            DesignPerfCriterio, DesignPerfSheet, DesignPerfEmpleado, DesignPerfCelda,
                            DesignPerfGanador, DesignPerfSeleccionFila, DesignPerfSeleccionCelda,
                            DesignTrash, DesignFavorito, DesignProtocolo, DesignCanvasDoc,
                            DesignComentarioTemplate, DesignFaqHoja, DesignProtocoloArea,
                            DesignProtocoloArchivo, DesignProtocoloPagina, FORMATO_DUAL)

CAMPOS_ORDEN = [
    "orden", "paciente", "centro", "producto", "designer_id", "designer_prestado",
    "hora_inicio", "hora_inicio_diseno", "hora_fin", "hold_minutos",
    "esferas", "critico", "s_hold", "f_hold",
    "etapa", "solicitado_por", "situacion", "solucion", "clasificacion", "soporte",
    "estado", "qc", "qc_reporte", "notas",
]


def lunes_de(fecha: date) -> date:
    return fecha - timedelta(days=fecha.weekday())


# Orden de presentación de las áreas en toda la UI de Design Schedule. Se aplica en código
# (no en la columna `orden` de la BD); áreas que no estén aquí van al final por su `orden`.
ORDEN_AREAS_UI = ["Face Design", "N2 Demodenture", "N3 Prosthetic", "N6 Material Changes", "Support"]


def ordenar_areas(areas: list[DesignArea]) -> list[DesignArea]:
    def clave(a: DesignArea):
        pos = ORDEN_AREAS_UI.index(a.nombre) if a.nombre in ORDEN_AREAS_UI else len(ORDEN_AREAS_UI)
        return (pos, a.orden or 0)
    return sorted(areas, key=clave)


def areas_disponibles(db: Session) -> list[DesignArea]:
    return ordenar_areas(db.query(DesignArea).filter(DesignArea.activo == 1).all())


def equipos_de_area(db: Session, area_id: int) -> list[DesignTeam]:
    return (db.query(DesignTeam).options(joinedload(DesignTeam.designers).joinedload(DesignTeamDesigner.empleado),
                                        joinedload(DesignTeam.manager))
            .filter(DesignTeam.area_id == area_id, DesignTeam.activo == 1)
            .order_by(DesignTeam.orden).all())


def puede_ver_equipo(user: Empleado, team: DesignTeam) -> bool:
    """Admins/superadmins ven todos los equipos; un aprobador (manager) solo el/los suyos."""
    if user.rol in ("admin", "superadmin"):
        return True
    return team.manager_id == user.id


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


# Solo se auto-rellenan los tipos de permiso de People que corresponden a un día completo
# fuera de la oficina (no citas/diligencias por horas). Mapea el nombre del tipo en People
# al nombre equivalente del catálogo de ausencias de Design Schedule.
MAPEO_PERMISO_A_AUSENCIA_DESIGN = {
    "Vacaciones": "Vacaciones",
    "Calamidad doméstica": "Calamidad doméstica",
    "Licencia de luto": "Licencia por luto",
    "Permiso personal": "Permiso personal",
}


def _permisos_aprobados_del_dia(db: Session, empleado_ids: list[int], fecha: date) -> dict[int, str]:
    """{empleado_id: nombre_ausencia_design} para permisos de día completo aprobados en People que cubren `fecha`."""
    if not empleado_ids:
        return {}
    filas = (db.query(Solicitud.empleado_id, TipoPermiso.nombre)
            .join(TipoPermiso, Solicitud.tipo_id == TipoPermiso.id)
            .filter(Solicitud.empleado_id.in_(empleado_ids), Solicitud.estado == "aprobada",
                    Solicitud.fecha_inicio <= fecha, Solicitud.fecha_fin >= fecha,
                    Solicitud.hora_inicio.is_(None), Solicitud.hora_fin.is_(None)).all())
    resultado = {}
    for empleado_id, nombre_tipo in filas:
        ausencia = MAPEO_PERMISO_A_AUSENCIA_DESIGN.get(nombre_tipo)
        if ausencia:
            resultado[empleado_id] = ausencia
    return resultado


def filtro_orden_completa():
    """Una orden solo cuenta (contadores, Dashboard, vista de todas las áreas) si tiene centro, producto y
    diseñador. Las filas a medio llenar siguen guardadas y visibles en el horario del equipo.
    El frontend usa el mismo criterio en dsOrdenCompleta()."""
    return and_(func.coalesce(DesignOrden.centro, "") != "", func.coalesce(DesignOrden.producto, "") != "",
                or_(DesignOrden.designer_id.isnot(None), func.coalesce(DesignOrden.designer_prestado, "") != ""))


# ---------- Cierre diario del horario (hora Colombia) ----------
# El día D se cierra a las 5:00 am (Colombia) del día siguiente: desde ese momento nadie puede editar sus
# órdenes ni sus tiempos libres; solo el checkbox de QC sigue editable hasta las 5:00 am de D+2.
# Al cierre, las órdenes en "Hold" pasan al siguiente día hábil (lunes a viernes) del mismo equipo.
ZONA_COLOMBIA = timezone(timedelta(hours=-5))  # Colombia no usa horario de verano
HORA_CIERRE = 5
ESTADO_HOLD = "Hold"
# Solo se trasladan las órdenes en Hold a partir de esta fecha (las anteriores se quedan en su día).
TRASLADO_HOLD_DESDE = date(2026, 9, 22)


def ahora_colombia() -> datetime:
    return datetime.now(ZONA_COLOMBIA)


def _limite(fecha: date, dias_despues: int) -> datetime:
    return datetime.combine(fecha + timedelta(days=dias_despues), time(HORA_CIERRE), ZONA_COLOMBIA)


def dia_cerrado(fecha: date, ahora: datetime | None = None) -> bool:
    return (ahora or ahora_colombia()) >= _limite(fecha, 1)


def qc_editable(fecha: date, ahora: datetime | None = None) -> bool:
    return (ahora or ahora_colombia()) < _limite(fecha, 2)


def qc_editable_hasta(fecha: date) -> datetime:
    return _limite(fecha, 2)


def siguiente_dia_habil(fecha: date) -> date:
    d = fecha + timedelta(days=1)
    while d.weekday() >= 5:  # sábado / domingo -> lunes
        d += timedelta(days=1)
    return d


def ultimo_dia_cerrado(ahora: datetime | None = None) -> date:
    """El día más reciente ya cerrado: D está cerrado si ahora >= D+1 05:00."""
    return ((ahora or ahora_colombia()) - timedelta(hours=HORA_CIERRE)).date() - timedelta(days=1)


_traslado_hecho_hasta: date | None = None  # evita repetir la consulta en cada petición del mismo proceso


def trasladar_holds(db: Session, ahora: datetime | None = None) -> int:
    """Mueve al siguiente día hábil abierto las órdenes en Hold de días ya cerrados. Se ejecuta al leer el
    horario (no hay tarea programada en el servidor), así que ocurre en la primera consulta después de las
    5:00 am. Es idempotente: si dos peticiones lo corren a la vez, el resultado es el mismo."""
    global _traslado_hecho_hasta
    cerrado_hasta = ultimo_dia_cerrado(ahora)
    if _traslado_hecho_hasta == cerrado_hasta:
        return 0
    ordenes = (db.query(DesignOrden)
               .filter(DesignOrden.estado == ESTADO_HOLD, DesignOrden.fecha >= TRASLADO_HOLD_DESDE,
                       DesignOrden.fecha <= cerrado_hasta)
               .order_by(DesignOrden.fecha, DesignOrden.orden_visual, DesignOrden.id).all())
    for o in ordenes:
        destino = siguiente_dia_habil(o.fecha)
        while destino <= cerrado_hasta:  # si nadie abrió el horario varios días, llega al primer día abierto
            destino = siguiente_dia_habil(destino)
        max_visual = (db.query(func.max(DesignOrden.orden_visual))
                      .filter(DesignOrden.team_id == o.team_id, DesignOrden.fecha == destino,
                              DesignOrden.tabla == o.tabla).scalar())
        o.fecha = destino
        o.orden_visual = (max_visual or 0) + 1  # queda al final de las órdenes de ese día
        db.flush()
    db.commit()
    _traslado_hecho_hasta = cerrado_hasta
    return len(ordenes)


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
    trasladar_holds(db)
    ordenes = (db.query(DesignOrden).options(joinedload(DesignOrden.designer))
              .filter(DesignOrden.team_id == team.id, DesignOrden.fecha == fecha)
              .order_by(DesignOrden.orden_visual, DesignOrden.id).all())
    breaks = db.query(DesignBreak).filter(DesignBreak.team_id == team.id, DesignBreak.fecha == fecha).all()
    principal = [serializar_orden(o) for o in ordenes if o.tabla == "principal"]
    nightguard = [serializar_orden(o) for o in ordenes if o.tabla == "nightguard"]
    # Diseñadores con su empleado en una sola consulta (team.designers haría una consulta por diseñador).
    designers = (db.query(DesignTeamDesigner).options(joinedload(DesignTeamDesigner.empleado))
                 .filter(DesignTeamDesigner.team_id == team.id).order_by(DesignTeamDesigner.orden).all())

    permisos = _permisos_aprobados_del_dia(db, [d.empleado_id for d in designers], fecha)
    breaks_out = []
    vistos = set()
    for b in breaks:
        data = serializar_break(b)
        if not data["tipoAusencia"] and permisos.get(b.empleado_id):
            data["tipoAusencia"] = permisos[b.empleado_id]
            data["ausenciaAutomatica"] = True
        breaks_out.append(data)
        vistos.add(b.empleado_id)
    for empleado_id, ausencia in permisos.items():
        if empleado_id in vistos:
            continue
        breaks_out.append({
            "id": None, "empleadoId": empleado_id, "tipoAusencia": ausencia,
            "almuerzoInicio": "", "almuerzoFin": "", "break1Inicio": "", "break1Fin": "",
            "break2Inicio": "", "break2Fin": "", "ausenciaAutomatica": True,
        })

    return {
        "principal": principal, "nightguard": nightguard,
        "breaks": breaks_out,
        "designers": [{"id": d.empleado_id, "nombre": d.empleado.nombre_completo} for d in designers],
        "cerrado": dia_cerrado(fecha), "qcEditable": qc_editable(fecha),
        "qcEditableHasta": qc_editable_hasta(fecha).isoformat(),
    }


def resumen_todas_areas(db: Session, user: Empleado, fecha: date) -> list[dict]:
    """Vista "todas las áreas": áreas, equipos visibles para `user` y sus órdenes del día, en 3 consultas
    (antes: 1 petición por área + 1 por equipo desde el navegador)."""
    trasladar_holds(db)
    areas = areas_disponibles(db)
    teams = (db.query(DesignTeam)
             .filter(DesignTeam.area_id.in_([a.id for a in areas]), DesignTeam.activo == 1)
             .order_by(DesignTeam.orden).all())
    teams = [t for t in teams if puede_ver_equipo(user, t)]
    ordenes = []
    if teams:
        ordenes = (db.query(DesignOrden).options(joinedload(DesignOrden.designer))
                   .filter(DesignOrden.team_id.in_([t.id for t in teams]), DesignOrden.fecha == fecha,
                           DesignOrden.tabla.in_(["principal", "nightguard"]), filtro_orden_completa())
                   .order_by(DesignOrden.orden_visual, DesignOrden.id).all())
    por_team: dict[int, list[DesignOrden]] = {}
    for o in ordenes:
        por_team.setdefault(o.team_id, []).append(o)

    def ordenes_de(team_id: int) -> list[dict]:
        # Mismo orden que la vista de equipo: primero "principal", luego "nightguard".
        lista = por_team.get(team_id, [])
        return [serializar_orden(o) for o in lista if o.tabla == "principal"] +                [serializar_orden(o) for o in lista if o.tabla == "nightguard"]

    return [{"id": a.id, "nombre": a.nombre, "formato": a.formato,
             "teams": [{"id": t.id, "nombre": t.nombre, "ordenes": ordenes_de(t.id)}
                       for t in teams if t.area_id == a.id]}
            for a in areas]


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
    trasladar_holds(db)
    q = (db.query(DesignOrden).options(joinedload(DesignOrden.designer), joinedload(DesignOrden.team))
         .filter(filtro_orden_completa()))
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

        # Reporte de QC = hallazgos anotados al marcar QC; solo cuenta si el QC sigue marcado.
        if f.qc and (f.qc_reporte or "").strip():
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


# ---------- Comments N3: plantillas de notas personalizadas ----------

def cmt_templates_listar(db: Session) -> list[DesignComentarioTemplate]:
    return db.query(DesignComentarioTemplate).order_by(DesignComentarioTemplate.orden).all()


def cmt_template_crear(db: Session, nombre: str, texto: str, creado_por: str = "") -> DesignComentarioTemplate:
    orden = db.query(DesignComentarioTemplate).count() + 1
    t = DesignComentarioTemplate(nombre=nombre.strip() or "Sin título", texto=texto, orden=orden,
                                 creado_por=creado_por)
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


def cmt_template_editar(db: Session, template_id: int, nombre: str, texto: str) -> DesignComentarioTemplate | None:
    t = db.get(DesignComentarioTemplate, template_id)
    if not t or t.es_fija:
        return None
    t.nombre = nombre.strip() or t.nombre
    t.texto = texto
    db.commit()
    return t


def cmt_template_eliminar(db: Session, template_id: int, eliminado_por: str = "") -> bool:
    t = db.get(DesignComentarioTemplate, template_id)
    if not t or t.es_fija:
        return False
    payload = {"template": {"nombre": t.nombre, "texto": t.texto, "creado_por": t.creado_por}}
    _trash_registrar(db, "cmt-template", f'Plantilla de nota: "{t.nombre}"', payload, eliminado_por)
    db.query(DesignFavorito).filter(DesignFavorito.tipo == "cmt_template",
                                    DesignFavorito.cmt_template_id == template_id).delete()
    db.delete(t)
    db.commit()
    return True


# ---------- Comments N2 / Face: hojas FAQ ----------
# Cada hoja tiene sus columnas (JSON). Las claves fijas son campos de DesignFaq; las columnas
# propias ("c1", "c2"...) se guardan en DesignFaq.extras. La sección agrupa filas contiguas.

FAQ_CAMPOS_FIJOS = ("situacion", "producto", "como_proceder", "plantilla", "ejemplos")
FAQ_COLUMNAS_BASE = [{"k": "situacion", "l": "Situación"}, {"k": "producto", "l": "Producto"},
                     {"k": "como_proceder", "l": "Cómo proceder"}, {"k": "plantilla", "l": "Template"},
                     {"k": "ejemplos", "l": "Ejemplos"}]


def _json(texto, defecto):
    try:
        v = json.loads(texto or "")
        return v if isinstance(v, type(defecto)) else defecto
    except (ValueError, TypeError):
        return defecto


def faq_columnas(h: DesignFaqHoja) -> list[dict]:
    return _json(h.columnas, [])


def _faq_fila_dict(f: DesignFaq) -> dict:
    d = {"id": f.id, "seccion": f.seccion or ""}
    for c in FAQ_CAMPOS_FIJOS:
        d[c] = getattr(f, c) or ""
    d.update({k: str(v) for k, v in _json(f.extras, {}).items()})
    return d


def _faq_filas(db: Session, hoja_id: int) -> list[DesignFaq]:
    return (db.query(DesignFaq).filter(DesignFaq.hoja_id == hoja_id)
            .order_by(DesignFaq.orden, DesignFaq.id).all())


def faq_hojas(db: Session) -> list[dict]:
    hojas = db.query(DesignFaqHoja).order_by(DesignFaqHoja.orden, DesignFaqHoja.id).all()
    return [{"id": h.id, "nombre": h.nombre} for h in hojas]


def faq_hoja_detalle(db: Session, hoja_id: int) -> dict | None:
    h = db.get(DesignFaqHoja, hoja_id)
    if not h:
        return None
    return {"id": h.id, "nombre": h.nombre, "columnas": faq_columnas(h),
            "filas": [_faq_fila_dict(f) for f in _faq_filas(db, h.id)]}


def _faq_area_por_defecto(db: Session) -> int | None:
    a = (db.query(DesignArea).filter(DesignArea.nombre == "Face Design").first()
         or db.query(DesignArea).order_by(DesignArea.orden).first())
    return a.id if a else None


def faq_hoja_crear(db: Session, nombre: str, duplicar_de: int | None = None) -> DesignFaqHoja | None:
    origen = db.get(DesignFaqHoja, duplicar_de) if duplicar_de else None
    if duplicar_de and not origen:
        return None
    orden = (db.query(func.max(DesignFaqHoja.orden)).scalar() or 0) + 1
    h = DesignFaqHoja(nombre=(nombre or "").strip()[:150] or "Nueva hoja", orden=orden,
                      area_id=origen.area_id if origen else _faq_area_por_defecto(db),
                      columnas=origen.columnas if origen else json.dumps(FAQ_COLUMNAS_BASE, ensure_ascii=False))
    db.add(h)
    db.flush()
    if origen:
        for f in _faq_filas(db, origen.id):
            db.add(DesignFaq(area_id=f.area_id, hoja_id=h.id, seccion=f.seccion, situacion=f.situacion,
                             producto=f.producto, como_proceder=f.como_proceder, plantilla=f.plantilla,
                             ejemplos=f.ejemplos, extras=f.extras, orden=f.orden))
    else:
        db.add(DesignFaq(area_id=h.area_id, hoja_id=h.id, seccion="Nueva sección", orden=1))
    db.commit()
    db.refresh(h)
    return h


def faq_hoja_renombrar(db: Session, hoja_id: int, nombre: str) -> bool:
    h = db.get(DesignFaqHoja, hoja_id)
    if not h or not (nombre or "").strip():
        return False
    h.nombre = nombre.strip()[:150]
    db.commit()
    return True


def faq_hoja_eliminar(db: Session, hoja_id: int, eliminado_por: str = "") -> str:
    """'ok' | 'no-existe' | 'ultima' (debe quedar al menos una hoja)."""
    h = db.get(DesignFaqHoja, hoja_id)
    if not h:
        return "no-existe"
    if db.query(DesignFaqHoja).count() <= 1:
        return "ultima"
    filas = _faq_filas(db, h.id)
    payload = {"hoja": {"nombre": h.nombre, "area_id": h.area_id, "columnas": faq_columnas(h), "orden": h.orden},
               "filas": [_faq_fila_dict(f) for f in filas]}
    _trash_registrar(db, "faq-hoja", f'Hoja Comments N2 / Face: "{h.nombre}"', payload, eliminado_por)
    for f in filas:
        db.delete(f)
    db.delete(h)
    db.commit()
    return "ok"


def faq_columna_agregar(db: Session, hoja_id: int, titulo: str) -> dict | None:
    h = db.get(DesignFaqHoja, hoja_id)
    if not h or not (titulo or "").strip():
        return None
    cols = faq_columnas(h)
    usados = {c["k"] for c in cols}
    n = 1
    while f"c{n}" in usados:
        n += 1
    col = {"k": f"c{n}", "l": titulo.strip()[:100]}
    cols.append(col)
    h.columnas = json.dumps(cols, ensure_ascii=False)
    db.commit()
    return col


def faq_columna_renombrar(db: Session, hoja_id: int, clave: str, titulo: str) -> bool:
    h = db.get(DesignFaqHoja, hoja_id)
    if not h or not (titulo or "").strip():
        return False
    cols = faq_columnas(h)
    for c in cols:
        if c["k"] == clave:
            c["l"] = titulo.strip()[:100]
            h.columnas = json.dumps(cols, ensure_ascii=False)
            db.commit()
            return True
    return False


def _faq_valor(f: DesignFaq, clave: str) -> str:
    if clave in FAQ_CAMPOS_FIJOS:
        return getattr(f, clave) or ""
    return str(_json(f.extras, {}).get(clave, ""))


def _faq_poner(f: DesignFaq, clave: str, valor: str) -> None:
    if clave in FAQ_CAMPOS_FIJOS:
        setattr(f, clave, valor)
        return
    ex = _json(f.extras, {})
    if valor:
        ex[clave] = valor
    else:
        ex.pop(clave, None)
    f.extras = json.dumps(ex, ensure_ascii=False)


def faq_columna_eliminar(db: Session, hoja_id: int, clave: str, eliminado_por: str = "") -> bool:
    """Quita la columna de la hoja y borra su contenido; queda en la Papelera para restaurarla."""
    h = db.get(DesignFaqHoja, hoja_id)
    if not h:
        return False
    cols = faq_columnas(h)
    idx = next((i for i, c in enumerate(cols) if c["k"] == clave), None)
    if idx is None:
        return False
    valores = {}
    for f in _faq_filas(db, h.id):
        v = _faq_valor(f, clave)
        if v:
            valores[str(f.id)] = v
            _faq_poner(f, clave, "")
    payload = {"hoja_id": h.id, "indice": idx, "columna": cols[idx], "valores": valores}
    _trash_registrar(db, "faq-col", f'Columna "{cols[idx]["l"]}" de la hoja "{h.nombre}"', payload, eliminado_por)
    del cols[idx]
    h.columnas = json.dumps(cols, ensure_ascii=False)
    db.commit()
    return True


def faq_fila_crear(db: Session, hoja_id: int, seccion: str, despues_de: int | None = None) -> DesignFaq | None:
    """Crea una fila al final de la hoja o justo después de `despues_de` (corre las siguientes)."""
    h = db.get(DesignFaqHoja, hoja_id)
    if not h:
        return None
    filas = _faq_filas(db, h.id)
    pos = len(filas)
    if despues_de:
        pos = next((i + 1 for i, f in enumerate(filas) if f.id == despues_de), pos)
    for i, f in enumerate(filas):
        f.orden = i + 1 if i < pos else i + 2
    nueva = DesignFaq(area_id=h.area_id or _faq_area_por_defecto(db), hoja_id=h.id,
                      seccion=(seccion or "").strip()[:150], orden=pos + 1)
    db.add(nueva)
    db.commit()
    db.refresh(nueva)
    return nueva


def faq_fila_actualizar(db: Session, fila_id: int, clave: str, valor: str) -> DesignFaq | None:
    f = db.get(DesignFaq, fila_id)
    if not f or not f.hoja_id:
        return None
    h = db.get(DesignFaqHoja, f.hoja_id)
    if clave not in FAQ_CAMPOS_FIJOS and clave not in {c["k"] for c in faq_columnas(h)}:
        return None
    _faq_poner(f, clave, valor or "")
    db.commit()
    return f


def faq_seccion_renombrar(db: Session, hoja_id: int, fila_ids: list[int], nombre: str) -> int:
    """Renombra la sección de las filas indicadas (el grupo visible), no otras con el mismo nombre."""
    filas = (db.query(DesignFaq).filter(DesignFaq.hoja_id == hoja_id, DesignFaq.id.in_(fila_ids or [0])).all())
    for f in filas:
        f.seccion = (nombre or "").strip()[:150]
    db.commit()
    return len(filas)


def faq_fila_eliminar(db: Session, fila_id: int, eliminado_por: str = "") -> bool:
    f = db.get(DesignFaq, fila_id)
    if not f or not f.hoja_id:
        return False
    h = db.get(DesignFaqHoja, f.hoja_id)
    payload = {"hoja_id": f.hoja_id, "orden": f.orden, "area_id": f.area_id, "fila": _faq_fila_dict(f)}
    texto = (f.situacion or f.seccion or "(fila)")[:80]
    _trash_registrar(db, "faq-fila", f'Situación "{texto}" de la hoja "{h.nombre if h else ""}"', payload, eliminado_por)
    db.delete(f)
    db.commit()
    return True


def _faq_fila_desde_dict(fila: DesignFaq, d: dict) -> None:
    fila.seccion = d.get("seccion", "")
    extras = {}
    for k, v in d.items():
        if k in ("id", "seccion"):
            continue
        if k in FAQ_CAMPOS_FIJOS:
            setattr(fila, k, v)
        elif v:
            extras[k] = v
    fila.extras = json.dumps(extras, ensure_ascii=False)


def _trash_restaurar_faq_hoja(db: Session, payload: dict) -> bool:
    h = payload.get("hoja") or {}
    hoja = DesignFaqHoja(nombre=h.get("nombre", "Hoja restaurada"), area_id=h.get("area_id"),
                         columnas=json.dumps(h.get("columnas", []), ensure_ascii=False),
                         orden=(db.query(func.max(DesignFaqHoja.orden)).scalar() or 0) + 1)
    db.add(hoja)
    db.flush()
    for i, d in enumerate(payload.get("filas", []), start=1):
        fila = DesignFaq(area_id=hoja.area_id or _faq_area_por_defecto(db), hoja_id=hoja.id, orden=i)
        _faq_fila_desde_dict(fila, d)
        db.add(fila)
    return True


def _trash_restaurar_faq_fila(db: Session, payload: dict) -> bool:
    h = db.get(DesignFaqHoja, payload.get("hoja_id") or 0)
    if not h:
        return False
    orden = payload.get("orden") or 0
    for f in _faq_filas(db, h.id):
        if f.orden >= orden:
            f.orden += 1
    fila = DesignFaq(area_id=payload.get("area_id") or h.area_id or _faq_area_por_defecto(db), hoja_id=h.id, orden=orden)
    _faq_fila_desde_dict(fila, payload.get("fila") or {})
    db.add(fila)
    return True


def _trash_restaurar_faq_col(db: Session, payload: dict) -> bool:
    h = db.get(DesignFaqHoja, payload.get("hoja_id") or 0)
    col = payload.get("columna") or {}
    if not h or not col.get("k"):
        return False
    cols = faq_columnas(h)
    if any(c["k"] == col["k"] for c in cols):
        return False
    cols.insert(min(payload.get("indice", len(cols)), len(cols)), col)
    h.columnas = json.dumps(cols, ensure_ascii=False)
    for fila_id, valor in (payload.get("valores") or {}).items():
        f = db.get(DesignFaq, int(fila_id))
        if f and f.hoja_id == h.id:
            _faq_poner(f, col["k"], valor)
    return True


def faq_sembrar(db: Session, ruta_seed: Path) -> None:
    """Idempotente. Filas antiguas sin hoja (de la versión por área) van a una hoja "<área> (anterior)".
    Si no hay ninguna hoja, carga las 4 del formato original (FACE, NEW FACE, N2, FACE MANAGER QUESTIONS)."""
    huerfanas = db.query(DesignFaq).filter(DesignFaq.hoja_id.is_(None)).order_by(DesignFaq.orden, DesignFaq.id).all()
    hojas_nuevas = db.query(DesignFaqHoja).count() == 0
    orden = db.query(func.max(DesignFaqHoja.orden)).scalar() or 0
    if hojas_nuevas and ruta_seed.exists():
        areas = {a.nombre: a.id for a in db.query(DesignArea).all()}
        with open(ruta_seed, encoding="utf-8") as fh:
            datos = json.load(fh)
        for hd in datos:
            orden += 1
            h = DesignFaqHoja(nombre=hd["nombre"], area_id=areas.get(hd.get("area")) or _faq_area_por_defecto(db),
                              columnas=json.dumps(hd["columnas"], ensure_ascii=False), orden=orden)
            db.add(h)
            db.flush()
            for i, d in enumerate(hd["filas"], start=1):
                fila = DesignFaq(area_id=h.area_id, hoja_id=h.id, orden=i)
                _faq_fila_desde_dict(fila, d)
                db.add(fila)
    if huerfanas:
        por_area = {}
        for f in huerfanas:
            por_area.setdefault(f.area_id, []).append(f)
        for area_id, filas in por_area.items():
            area = db.get(DesignArea, area_id)
            orden += 1
            h = DesignFaqHoja(nombre=f"{area.nombre if area else 'Hoja'} (anterior)", area_id=area_id,
                              columnas=json.dumps(FAQ_COLUMNAS_BASE, ensure_ascii=False), orden=orden)
            db.add(h)
            db.flush()
            for i, f in enumerate(filas, start=1):
                f.hoja_id, f.orden = h.id, i


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
        "anchos": _json(s.anchos, {}),
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
        if datos.get(campo) is not None:
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
    """Crea el centro al final con `span` doctores nuevos ("Dr. ") debajo."""
    span = max(1, min(span or 1, 30))
    orden = (db.query(func.max(DesignPreApprovedCentro.orden))
             .filter(DesignPreApprovedCentro.sheet_id == sheet_id).scalar() or 0) + 1
    c = DesignPreApprovedCentro(sheet_id=sheet_id, nombre=(nombre or "").strip()[:150], span=span, orden=orden)
    db.add(c)
    ult = (db.query(func.max(DesignPreApprovedDoctor.orden))
           .filter(DesignPreApprovedDoctor.sheet_id == sheet_id).scalar() or 0)
    for k in range(span):
        db.add(DesignPreApprovedDoctor(sheet_id=sheet_id, nombre="Dr. ", orden=ult + k + 1))
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
    doctores = _pac_doctores_del_centro(db, c)
    payload = {"sheet_id": c.sheet_id, "nombre": c.nombre, "span": c.span, "doctores": [
        {"nombre": d.nombre, "celdas": [{"fila_id": x.fila_id, "valor": x.valor} for x in
                                        db.query(DesignPreApprovedCelda).filter(DesignPreApprovedCelda.doctor_id == d.id)]}
        for d in doctores]}
    _trash_registrar(db, "pa-centro", f"Centro Pre-Approved: {c.nombre}", payload, eliminado_por)
    for d in doctores:
        db.query(DesignPreApprovedCelda).filter(DesignPreApprovedCelda.doctor_id == d.id).delete()
        db.delete(d)
    db.delete(c)
    db.commit()
    return True


def preapproved_agregar_doctor(db: Session, sheet_id: int, nombre: str = "") -> DesignPreApprovedDoctor:
    """Agrega el doctor al final, dentro del último centro (o crea uno sin nombre si no hay)."""
    orden = (db.query(func.max(DesignPreApprovedDoctor.orden))
             .filter(DesignPreApprovedDoctor.sheet_id == sheet_id).scalar() or 0) + 1
    d = DesignPreApprovedDoctor(sheet_id=sheet_id, nombre=nombre or "Dr. ", orden=orden)
    db.add(d)
    centros = _pac_centros_ordenados(db, sheet_id)
    if centros:
        centros[-1].span += 1
    else:
        db.add(DesignPreApprovedCentro(sheet_id=sheet_id, nombre="", span=1, orden=1))
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
    orden_docs = [x.id for x in _pac_doctores_ordenados(db, d.sheet_id)]
    dentro = orden_docs.index(d.id) < sum(c.span for c in _pac_centros_ordenados(db, d.sheet_id))
    centro = _pac_centro_de_doctor(db, d.sheet_id, d.id) if dentro else None
    payload = {"sheet_id": d.sheet_id, "nombre": d.nombre,
              "celdas": [{"fila_id": c.fila_id, "valor": c.valor} for c in celdas],
              "centro_id": centro.id if centro else None, "centro_nombre": centro.nombre if centro else ""}
    _trash_registrar(db, "pa-doctor", f"Doctor Pre-Approved: {d.nombre}", payload, eliminado_por)
    db.query(DesignPreApprovedCelda).filter(DesignPreApprovedCelda.doctor_id == doctor_id).delete()
    db.delete(d)
    if centro:
        centro.span -= 1
        if centro.span <= 0:
            db.delete(centro)
    db.commit()
    return True


def preapproved_guardar_ancho(db: Session, sheet_id: int, clave: str, px: int | None) -> bool:
    s = db.get(DesignPreApprovedSheet, sheet_id)
    if not s:
        return False
    anchos = _json(s.anchos, {})
    if px:
        anchos[str(clave)[:20]] = max(60, min(int(px), 800))
    else:
        anchos.pop(str(clave), None)
    s.anchos = json.dumps(anchos)
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
# Pre-Approved "Cambios": mover o intercambiar doctores/centros entre hojas
# (managers) de una misma área. Los valores viajan emparejados por NOMBRE de
# criterio (no por posición), para no corromper datos cuando dos managers
# tienen criterios distintos; lo que no tiene coincidencia en el destino se
# descarta y se informa como "unmatched", igual que en la herramienta original.
# ---------------------------------------------------------------------------

def _pac_normalizar(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def _pac_valores_doctor(db: Session, doctor_id: int) -> dict[str, str]:
    filas = (db.query(DesignPreApprovedCelda, DesignPreApprovedFila.criterio)
            .join(DesignPreApprovedFila, DesignPreApprovedCelda.fila_id == DesignPreApprovedFila.id)
            .filter(DesignPreApprovedCelda.doctor_id == doctor_id).all())
    return {_pac_normalizar(criterio): celda.valor for celda, criterio in filas if (celda.valor or "").strip()}


def _pac_aplicar_valores(db: Session, doctor_id: int, sheet_id: int, valores: dict[str, str]) -> int:
    """Escribe `valores` (clave = criterio normalizado) en las celdas de doctor_id dentro de
    sheet_id, alineando por nombre de criterio. Devuelve cuántos valores no encontraron fila."""
    filas = db.query(DesignPreApprovedFila).filter(DesignPreApprovedFila.sheet_id == sheet_id).all()
    mapa = {_pac_normalizar(f.criterio): f for f in filas}
    sin_match = 0
    for criterio_norm, valor in valores.items():
        fila = mapa.get(criterio_norm)
        if fila:
            preapproved_guardar_celda(db, fila.id, doctor_id, valor)
        else:
            sin_match += 1
    return sin_match


def _pac_doctores_ordenados(db: Session, sheet_id: int) -> list[DesignPreApprovedDoctor]:
    return (db.query(DesignPreApprovedDoctor).filter(DesignPreApprovedDoctor.sheet_id == sheet_id)
            .order_by(DesignPreApprovedDoctor.orden, DesignPreApprovedDoctor.id).all())


def _pac_centros_ordenados(db: Session, sheet_id: int) -> list[DesignPreApprovedCentro]:
    return (db.query(DesignPreApprovedCentro).filter(DesignPreApprovedCentro.sheet_id == sheet_id)
            .order_by(DesignPreApprovedCentro.orden, DesignPreApprovedCentro.id).all())


def _pac_centro_de_doctor(db: Session, sheet_id: int, doctor_id: int) -> DesignPreApprovedCentro | None:
    doctores = _pac_doctores_ordenados(db, sheet_id)
    centros = _pac_centros_ordenados(db, sheet_id)
    idx = next((i for i, d in enumerate(doctores) if d.id == doctor_id), None)
    if idx is None:
        return None
    acumulado = 0
    for c in centros:
        if idx < acumulado + c.span:
            return c
        acumulado += c.span
    return centros[-1] if centros else None


def _pac_posicion_centro(db: Session, centro: DesignPreApprovedCentro) -> int:
    acumulado = 0
    for c in _pac_centros_ordenados(db, centro.sheet_id):
        if c.id == centro.id:
            return acumulado
        acumulado += c.span
    return acumulado


def _pac_doctores_del_centro(db: Session, centro: DesignPreApprovedCentro) -> list[DesignPreApprovedDoctor]:
    inicio = _pac_posicion_centro(db, centro)
    return _pac_doctores_ordenados(db, centro.sheet_id)[inicio:inicio + centro.span]


def _pac_insertar_doctor(db: Session, doctor: DesignPreApprovedDoctor, sheet_dst_id: int,
                         centro_dst_id: int | None, nombre_centro_si_nuevo: str) -> None:
    """Ubica `doctor` (ya con sheet_id = sheet_dst_id) en la posición del centro destino
    (o crea un centro nuevo al final) y renumera doctores/centros de la hoja destino."""
    if centro_dst_id is None:
        centros = _pac_centros_ordenados(db, sheet_dst_id)
        nuevo = DesignPreApprovedCentro(sheet_id=sheet_dst_id, nombre=nombre_centro_si_nuevo, span=1,
                                        orden=len(centros) + 1)
        db.add(nuevo)
        db.flush()
        insert_at = len(_pac_doctores_ordenados(db, sheet_dst_id)) - 1  # doctor ya está en la hoja, sin insertar aún
    else:
        centro = db.get(DesignPreApprovedCentro, centro_dst_id)
        span_original = centro.span
        centro.span = span_original + 1
        acumulado = 0
        insert_at = 0
        for c in _pac_centros_ordenados(db, sheet_dst_id):
            if c.id == centro_dst_id:
                acumulado += span_original
                insert_at = acumulado
                break
            acumulado += c.span

    doctores = [d for d in _pac_doctores_ordenados(db, sheet_dst_id) if d.id != doctor.id]
    doctores.insert(insert_at, doctor)
    for i, d in enumerate(doctores, start=1):
        d.orden = i


def pac_mover_doctor(db: Session, doctor_id: int, sheet_dst_id: int, centro_dst_id: int | None) -> dict:
    doctor = db.get(DesignPreApprovedDoctor, doctor_id)
    if not doctor:
        return {"error": "Doctor no encontrado."}
    sheet_src_id = doctor.sheet_id
    if sheet_src_id == sheet_dst_id:
        return {"error": "Elige un manager de destino distinto."}
    if db.query(DesignPreApprovedDoctor).filter(DesignPreApprovedDoctor.sheet_id == sheet_src_id).count() <= 1:
        return {"error": "El manager origen no puede quedar sin doctores."}

    valores = _pac_valores_doctor(db, doctor_id)
    centro_origen = _pac_centro_de_doctor(db, sheet_src_id, doctor_id)
    nombre_centro_origen = centro_origen.nombre if centro_origen else ""

    db.query(DesignPreApprovedCelda).filter(DesignPreApprovedCelda.doctor_id == doctor_id).delete()
    if centro_origen:
        centro_origen.span -= 1
        if centro_origen.span <= 0:
            db.delete(centro_origen)

    doctor.sheet_id = sheet_dst_id
    db.flush()
    _pac_insertar_doctor(db, doctor, sheet_dst_id, centro_dst_id, nombre_centro_origen)
    sin_match = _pac_aplicar_valores(db, doctor_id, sheet_dst_id, valores)
    db.commit()
    return {"unmatched": sin_match}


def pac_mover_centro(db: Session, centro_id: int, sheet_dst_id: int, centro_dst_id: int | None) -> dict:
    centro = db.get(DesignPreApprovedCentro, centro_id)
    if not centro:
        return {"error": "Centro no encontrado."}
    sheet_src_id = centro.sheet_id
    if sheet_src_id == sheet_dst_id:
        return {"error": "Elige un manager de destino distinto."}
    if db.query(DesignPreApprovedCentro).filter(DesignPreApprovedCentro.sheet_id == sheet_src_id).count() <= 1:
        return {"error": "El manager origen no puede quedar sin centros."}

    doctores_bloque = _pac_doctores_del_centro(db, centro)
    valores_por_doctor = {d.id: _pac_valores_doctor(db, d.id) for d in doctores_bloque}
    nombre_centro = centro.nombre

    ids = [d.id for d in doctores_bloque]
    if ids:
        db.query(DesignPreApprovedCelda).filter(DesignPreApprovedCelda.doctor_id.in_(ids)).delete(synchronize_session=False)
    db.delete(centro)
    db.flush()

    if centro_dst_id is None:
        centros_dst = _pac_centros_ordenados(db, sheet_dst_id)
        nuevo = DesignPreApprovedCentro(sheet_id=sheet_dst_id, nombre=nombre_centro, span=len(doctores_bloque),
                                        orden=len(centros_dst) + 1)
        db.add(nuevo)
        db.flush()
        insert_at = len(_pac_doctores_ordenados(db, sheet_dst_id))
    else:
        centro_dst = db.get(DesignPreApprovedCentro, centro_dst_id)
        span_original = centro_dst.span
        centro_dst.span = span_original + len(doctores_bloque)
        acumulado = 0
        insert_at = 0
        for c in _pac_centros_ordenados(db, sheet_dst_id):
            if c.id == centro_dst_id:
                acumulado += span_original
                insert_at = acumulado
                break
            acumulado += c.span

    for d in doctores_bloque:
        d.sheet_id = sheet_dst_id
    doctores = [d for d in _pac_doctores_ordenados(db, sheet_dst_id) if d.id not in ids]
    doctores[insert_at:insert_at] = doctores_bloque
    for i, d in enumerate(doctores, start=1):
        d.orden = i
    db.flush()

    unmatched = 0
    for d in doctores_bloque:
        unmatched += _pac_aplicar_valores(db, d.id, sheet_dst_id, valores_por_doctor[d.id])
    db.commit()
    return {"unmatched": unmatched}


def pac_intercambiar_doctor(db: Session, doctor_a_id: int, doctor_b_id: int) -> dict:
    a = db.get(DesignPreApprovedDoctor, doctor_a_id)
    b = db.get(DesignPreApprovedDoctor, doctor_b_id)
    if not a or not b:
        return {"error": "Doctor no encontrado."}
    if a.sheet_id == b.sheet_id:
        return {"error": "Para intercambiar elige dos managers distintos."}

    valores_a = _pac_valores_doctor(db, doctor_a_id)
    valores_b = _pac_valores_doctor(db, doctor_b_id)
    sheet_a_id, sheet_b_id = a.sheet_id, b.sheet_id
    a.nombre, b.nombre = b.nombre, a.nombre

    db.query(DesignPreApprovedCelda).filter(
        DesignPreApprovedCelda.doctor_id.in_([doctor_a_id, doctor_b_id])).delete(synchronize_session=False)
    db.flush()

    unmatched = _pac_aplicar_valores(db, doctor_a_id, sheet_a_id, valores_b)
    unmatched += _pac_aplicar_valores(db, doctor_b_id, sheet_b_id, valores_a)
    db.commit()
    return {"unmatched": unmatched}


def pac_intercambiar_centro(db: Session, centro_a_id: int, centro_b_id: int) -> dict:
    a = db.get(DesignPreApprovedCentro, centro_a_id)
    b = db.get(DesignPreApprovedCentro, centro_b_id)
    if not a or not b:
        return {"error": "Centro no encontrado."}
    if a.sheet_id == b.sheet_id:
        return {"error": "Para intercambiar elige dos managers distintos."}

    sheet_a_id, sheet_b_id = a.sheet_id, b.sheet_id
    doctores_a = _pac_doctores_del_centro(db, a)
    doctores_b = _pac_doctores_del_centro(db, b)
    valores_a = [_pac_valores_doctor(db, d.id) for d in doctores_a]
    valores_b = [_pac_valores_doctor(db, d.id) for d in doctores_b]
    nombres_a = [d.nombre for d in doctores_a]
    nombres_b = [d.nombre for d in doctores_b]
    nombre_centro_a, nombre_centro_b = a.nombre, b.nombre

    ids_borrar = [d.id for d in doctores_a] + [d.id for d in doctores_b]
    if ids_borrar:
        db.query(DesignPreApprovedCelda).filter(
            DesignPreApprovedCelda.doctor_id.in_(ids_borrar)).delete(synchronize_session=False)

    pos_a = _pac_posicion_centro(db, a)
    pos_b = _pac_posicion_centro(db, b)
    for d in doctores_a + doctores_b:
        db.delete(d)
    db.flush()

    nuevos_en_a = [DesignPreApprovedDoctor(sheet_id=sheet_a_id, nombre=n, orden=0) for n in nombres_b]
    nuevos_en_b = [DesignPreApprovedDoctor(sheet_id=sheet_b_id, nombre=n, orden=0) for n in nombres_a]
    for d in nuevos_en_a + nuevos_en_b:
        db.add(d)
    db.flush()

    resto_a = _pac_doctores_ordenados(db, sheet_a_id)
    resto_a[pos_a:pos_a] = nuevos_en_a
    for i, d in enumerate(resto_a, start=1):
        d.orden = i

    resto_b = _pac_doctores_ordenados(db, sheet_b_id)
    resto_b[pos_b:pos_b] = nuevos_en_b
    for i, d in enumerate(resto_b, start=1):
        d.orden = i

    a.nombre, a.span = nombre_centro_b, len(nuevos_en_a)
    b.nombre, b.span = nombre_centro_a, len(nuevos_en_b)
    db.flush()

    unmatched = 0
    for d, valores in zip(nuevos_en_a, valores_b):
        unmatched += _pac_aplicar_valores(db, d.id, sheet_a_id, valores)
    for d, valores in zip(nuevos_en_b, valores_a):
        unmatched += _pac_aplicar_valores(db, d.id, sheet_b_id, valores)
    db.commit()
    return {"unmatched": unmatched}


# ---------------------------------------------------------------------------
# Desempeño (Performance) — acceso restringido a aprobadores y administradores (RR.HH.).
# ---------------------------------------------------------------------------

def perf_criterios(db: Session) -> list[DesignPerfCriterio]:
    return db.query(DesignPerfCriterio).order_by(DesignPerfCriterio.orden).all()


def perf_sheets(db: Session) -> list[DesignPerfSheet]:
    return db.query(DesignPerfSheet).order_by(DesignPerfSheet.orden).all()


# Porcentaje de cada nivel de calificación. Todos los criterios pesan igual y un criterio sin calificar
# cuenta como 0 %. El frontend usa la misma tabla (PF_PCT) para recalcular al instante.
PERF_PORCENTAJE_NIVEL = {"ALTO": 100, "SOBRESALIENTE": 95, "MEDIO": 50, "BAJO": 0, "": 0}


def perf_totales(celdas: dict, criterio_ids: list[int], n_meses: int) -> tuple[list[float], float]:
    """(total de cada mes, total general) como fracción 0-1. Total general = promedio de los meses que tienen
    al menos un criterio calificado (los meses sin calificar no cuentan)."""
    totales, calificados = [], []
    for m in range(n_meses):
        niveles = [(celdas.get(f"{cid}_{m}") or {}).get("nivel", "") for cid in criterio_ids]
        total = (sum(PERF_PORCENTAJE_NIVEL.get(n, 0) for n in niveles) / len(criterio_ids) / 100) if criterio_ids else 0
        totales.append(total)
        if any(niveles):
            calificados.append(total)
    return totales, (sum(calificados) / len(calificados) if calificados else 0)


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
                "nivel": c.nivel, "puntaje": PERF_PORCENTAJE_NIVEL.get(c.nivel, 0)}
    meses = json.loads(sheet.meses or "[]")
    criterio_ids = [c.id for c in criterios]
    salida = []
    for e in empleados:
        # Los totales se calculan siempre; los importados de Excel (e.totales_mes / e.total) ya no se usan.
        celdas = celdas_por_emp.get(e.id, {})
        totales, total = perf_totales(celdas, criterio_ids, len(meses))
        salida.append({"id": e.id, "nombre": e.nombre, "nota": e.nota, "total": total,
                       "totalesMes": totales, "celdas": celdas})
    return {
        "id": sheet.id, "nombre": sheet.nombre, "tipo": sheet.tipo, "meses": meses,
        "criterios": [{"id": c.id, "nombre": c.nombre} for c in criterios],
        "empleados": salida,
    }


def perf_guardar_celda(db: Session, empleado_id: int, criterio_id: int, mes_indice: int,
                       nivel: str, puntaje: float) -> None:
    c = (db.query(DesignPerfCelda)
        .filter(DesignPerfCelda.empleado_id == empleado_id, DesignPerfCelda.criterio_id == criterio_id,
                DesignPerfCelda.mes_indice == mes_indice).first())
    if not c:
        c = DesignPerfCelda(empleado_id=empleado_id, criterio_id=criterio_id, mes_indice=mes_indice)
        db.add(c)
    c.nivel = nivel if nivel in PERF_PORCENTAJE_NIVEL else ""
    c.puntaje = PERF_PORCENTAJE_NIVEL[c.nivel]  # el porcentaje sale del nivel; no se edita a mano
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

def _trash_registrar(db: Session, modulo: str, etiqueta: str, payload: dict, eliminado_por: str) -> DesignTrash:
    t = DesignTrash(modulo=modulo, etiqueta=etiqueta, payload=json.dumps(payload, ensure_ascii=False),
                    eliminado_por=eliminado_por or "Sistema")
    db.add(t)
    return t


def trash_listar(db: Session) -> list[DesignTrash]:
    return db.query(DesignTrash).order_by(DesignTrash.eliminado_en.desc()).all()


def trash_eliminar_permanente(db: Session, trash_id: int) -> bool:
    t = db.get(DesignTrash, trash_id)
    if not t:
        return False
    db.delete(t)
    db.flush()
    pr_limpiar_archivos_huerfanos(db)
    db.commit()
    return True


def trash_vaciar(db: Session) -> None:
    db.query(DesignTrash).delete()
    db.flush()
    pr_limpiar_archivos_huerfanos(db)
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
    orden = (db.query(func.max(DesignPreApprovedCentro.orden))
             .filter(DesignPreApprovedCentro.sheet_id == sheet_id).scalar() or 0) + 1
    doctores = payload.get("doctores")
    if doctores is None:  # borrados antes de este cambio: solo el encabezado
        db.add(DesignPreApprovedCentro(sheet_id=sheet_id, nombre=payload.get("nombre", ""),
                                       span=payload.get("span") or 1, orden=orden))
        return True
    db.add(DesignPreApprovedCentro(sheet_id=sheet_id, nombre=payload.get("nombre", ""), span=max(1, len(doctores)), orden=orden))
    ult = (db.query(func.max(DesignPreApprovedDoctor.orden))
           .filter(DesignPreApprovedDoctor.sheet_id == sheet_id).scalar() or 0)
    for k, doc in enumerate(doctores or [{"nombre": "Dr. ", "celdas": []}], start=1):
        d = DesignPreApprovedDoctor(sheet_id=sheet_id, nombre=doc.get("nombre", ""), orden=ult + k)
        db.add(d)
        db.flush()
        for c in doc.get("celdas", []):
            if db.get(DesignPreApprovedFila, c.get("fila_id")):
                db.add(DesignPreApprovedCelda(fila_id=c["fila_id"], doctor_id=d.id, valor=c.get("valor", "")))
    return True


def _trash_restaurar_pa_doctor(db: Session, payload: dict) -> bool:
    sheet_id = payload.get("sheet_id")
    if not db.get(DesignPreApprovedSheet, sheet_id):
        return False
    orden = (db.query(func.max(DesignPreApprovedDoctor.orden))
             .filter(DesignPreApprovedDoctor.sheet_id == sheet_id).scalar() or 0) + 1
    d = DesignPreApprovedDoctor(sheet_id=sheet_id, nombre=payload.get("nombre", ""), orden=orden)
    db.add(d)
    db.flush()
    if "centro_id" in payload:  # vuelve a su centro (o a uno nuevo con su nombre si ya no existe)
        centro = db.get(DesignPreApprovedCentro, payload.get("centro_id") or 0)
        _pac_insertar_doctor(db, d, sheet_id, centro.id if centro and centro.sheet_id == sheet_id else None,
                             payload.get("centro_nombre", ""))
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
    nuevo = DesignProtocolo(area_id=area_id, titulo=p.get("titulo", ""), descripcion=p.get("descripcion", ""),
                            contenido=p.get("contenido", ""), version=p.get("version") or "v1.0",
                            creado_por=p.get("creado_por", ""))
    db.add(nuevo)
    db.flush()
    _pr_poner_areas(db, nuevo.id, payload.get("areas") or ([area_id] if area_id else []))
    arch = db.get(DesignProtocoloArchivo, payload.get("archivo_id") or 0)
    if arch and arch.protocolo_id is None:
        arch.protocolo_id = nuevo.id
    _pr_poner_paginas(db, nuevo.id, payload.get("paginas") or [])
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


def _trash_restaurar_cmt_template(db: Session, payload: dict) -> bool:
    t = payload.get("template") or {}
    if not t.get("nombre") or not t.get("texto"):
        return False
    orden = db.query(DesignComentarioTemplate).count() + 1
    db.add(DesignComentarioTemplate(nombre=t["nombre"], texto=t["texto"], orden=orden,
                                    creado_por=t.get("creado_por", "")))
    return True


_TRASH_RESTAURADORES = {
    "pa-sheet": _trash_restaurar_pa_sheet,
    "pa-centro": _trash_restaurar_pa_centro,
    "pa-doctor": _trash_restaurar_pa_doctor,
    "pa-fila": _trash_restaurar_pa_fila,
    "protocol": _trash_restaurar_protocolo,
    "cv-doc": _trash_restaurar_cv_doc,
    "cmt-template": _trash_restaurar_cmt_template,
    "faq-hoja": _trash_restaurar_faq_hoja,
    "faq-fila": _trash_restaurar_faq_fila,
    "faq-col": _trash_restaurar_faq_col,
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


def favorito_toggle_cmt_template(db: Session, empleado_id: int, template_id: int) -> bool:
    existente = (db.query(DesignFavorito)
        .filter(DesignFavorito.empleado_id == empleado_id, DesignFavorito.tipo == "cmt_template",
                DesignFavorito.cmt_template_id == template_id).first())
    if existente:
        db.delete(existente)
        db.commit()
        return False
    db.add(DesignFavorito(empleado_id=empleado_id, tipo="cmt_template", cmt_template_id=template_id))
    db.commit()
    return True


def favoritos_activos(db: Session, empleado_id: int) -> dict:
    favs = db.query(DesignFavorito).filter(DesignFavorito.empleado_id == empleado_id).all()
    return {
        "teams": {f.team_id for f in favs if f.tipo == "team"},
        "preapproved": {f.preapproved_sheet_id for f in favs if f.tipo == "preapproved"},
        "protocolos": {f.protocolo_id for f in favs if f.tipo == "protocolo"},
        "cmtTemplates": {f.cmt_template_id for f in favs if f.tipo == "cmt_template"},
    }


# ---------------------------------------------------------------------------
# Protocols: biblioteca de SOPs
# ---------------------------------------------------------------------------

PR_MAX_BYTES = 60 * 1024 * 1024  # 60 MB por PDF


def pr_norm(texto: str) -> str:
    """Minúsculas y sin tildes, carácter por carácter (misma longitud que el original)."""
    return "".join((unicodedata.normalize("NFD", c)[:1] or c).lower() for c in (texto or ""))


def _pr_areas_ids(db: Session, protocolo_id: int) -> list[int]:
    return [r.area_id for r in db.query(DesignProtocoloArea).filter(DesignProtocoloArea.protocolo_id == protocolo_id)]


def _pr_visibles(db: Session, area_id: int | None):
    """Protocolos que se ven en el área: los marcados para ella y los generales (sin áreas)."""
    q = db.query(DesignProtocolo)
    if area_id:
        marcados = db.query(DesignProtocoloArea.protocolo_id).filter(DesignProtocoloArea.area_id == area_id)
        con_areas = db.query(DesignProtocoloArea.protocolo_id)
        q = q.filter(or_(DesignProtocolo.id.in_(marcados), ~DesignProtocolo.id.in_(con_areas)))
    return q


def pr_resumen(db: Session, p: DesignProtocolo, areas_por_id: dict | None = None) -> dict:
    areas_por_id = areas_por_id or {a.id: a.nombre for a in db.query(DesignArea).all()}
    arch = (db.query(DesignProtocoloArchivo.id, DesignProtocoloArchivo.nombre, DesignProtocoloArchivo.tamano,
                     DesignProtocoloArchivo.paginas)
            .filter(DesignProtocoloArchivo.protocolo_id == p.id).first())
    ids = _pr_areas_ids(db, p.id)
    return {"id": p.id, "titulo": p.titulo, "descripcion": p.descripcion, "version": p.version,
            "creadoPor": p.creado_por, "areas": [{"id": i, "nombre": areas_por_id.get(i, "")} for i in ids],
            "tieneArchivo": bool(arch), "archivo": arch.nombre if arch else "", "tamano": arch.tamano if arch else 0,
            "paginas": arch.paginas if arch else 0, "archivoId": arch.id if arch else None}


def protocolos_listar(db: Session, area_id: int | None = None) -> list[dict]:
    areas_por_id = {a.id: a.nombre for a in db.query(DesignArea).all()}
    return [pr_resumen(db, p, areas_por_id)
            for p in _pr_visibles(db, area_id).order_by(func.lower(DesignProtocolo.titulo)).all()]


def _pr_fragmento(texto: str, norm: str, palabras: list[str], largo: int = 90) -> str:
    pos = min([i for i in (norm.find(w) for w in palabras) if i >= 0] or [0])
    ini = max(0, pos - largo // 2)
    fin = min(len(texto), pos + largo)
    frag = " ".join(texto[ini:fin].split())
    return ("…" if ini > 0 else "") + frag + ("…" if fin < len(texto) else "")


def protocolos_buscar(db: Session, area_id: int | None, q: str, protocolo_id: int | None = None,
                      limite: int = 120) -> dict:
    """Diapositivas donde aparecen TODAS las palabras buscadas (sin distinguir mayúsculas ni tildes),
    solo de los protocolos visibles en el área. Los protocolos de texto (sin PDF) se buscan en su contenido."""
    palabras = [w for w in pr_norm(q).split() if len(w) >= 2]
    if not palabras:
        return {"resultados": [], "total": 0}
    visibles = _pr_visibles(db, area_id)
    if protocolo_id:
        visibles = visibles.filter(DesignProtocolo.id == protocolo_id)
    protos = {p.id: p for p in visibles.all()}
    if not protos:
        return {"resultados": [], "total": 0}
    qp = db.query(DesignProtocoloPagina).filter(DesignProtocoloPagina.protocolo_id.in_(list(protos)))
    for w in palabras:
        qp = qp.filter(DesignProtocoloPagina.texto_norm.like(f"%{w}%"))
    paginas = qp.order_by(DesignProtocoloPagina.protocolo_id, DesignProtocoloPagina.pagina).all()
    total = len(paginas)
    res = [{"protocoloId": pg.protocolo_id, "titulo": protos[pg.protocolo_id].titulo, "pagina": pg.pagina,
            "fragmento": _pr_fragmento(pg.texto, pg.texto_norm, palabras)} for pg in paginas[:limite]]
    con_pdf = {r[0] for r in db.query(DesignProtocoloArchivo.protocolo_id)
               .filter(DesignProtocoloArchivo.protocolo_id.in_(list(protos)))}
    for p in protos.values():  # protocolos de texto, sin PDF
        if p.id in con_pdf:
            continue
        texto = f"{p.titulo}\n{p.descripcion}\n{p.contenido}"
        norm = pr_norm(texto)
        if all(w in norm for w in palabras):
            total += 1
            res.append({"protocoloId": p.id, "titulo": p.titulo, "pagina": 0,
                        "fragmento": _pr_fragmento(texto, norm, palabras)})
    orden = {pid: pr_norm(p.titulo) for pid, p in protos.items()}
    res.sort(key=lambda r: (orden[r["protocoloId"]], r["pagina"]))
    return {"resultados": res, "total": total, "palabras": palabras}


def protocolo_detalle(db: Session, protocolo_id: int) -> DesignProtocolo | None:
    return db.get(DesignProtocolo, protocolo_id)


def protocolo_archivo(db: Session, protocolo_id: int) -> DesignProtocoloArchivo | None:
    return db.query(DesignProtocoloArchivo).filter(DesignProtocoloArchivo.protocolo_id == protocolo_id).first()


def _pr_poner_areas(db: Session, protocolo_id: int, area_ids: list[int]) -> None:
    validas = {a.id for a in db.query(DesignArea).all()}
    db.query(DesignProtocoloArea).filter(DesignProtocoloArea.protocolo_id == protocolo_id).delete()
    for a in dict.fromkeys(area_ids or []):
        if a in validas:
            db.add(DesignProtocoloArea(protocolo_id=protocolo_id, area_id=a))


def _pr_poner_paginas(db: Session, protocolo_id: int, textos: list[str]) -> None:
    db.query(DesignProtocoloPagina).filter(DesignProtocoloPagina.protocolo_id == protocolo_id).delete()
    for i, t in enumerate(textos or [], start=1):
        t = str(t or "")[:20000]
        db.add(DesignProtocoloPagina(protocolo_id=protocolo_id, pagina=i, texto=t, texto_norm=pr_norm(t)))


def protocolo_crear_pdf(db: Session, titulo: str, area_ids: list[int], nombre_archivo: str, datos: bytes,
                        textos: list[str], version: str = "v1.0", creado_por: str = "") -> DesignProtocolo:
    p = DesignProtocolo(area_id=(area_ids[0] if len(area_ids or []) == 1 else None),
                        titulo=(titulo or "").strip()[:255] or nombre_archivo or "Protocolo sin título",
                        descripcion="", contenido="", version=(version or "v1.0")[:20], creado_por=creado_por)
    db.add(p)
    db.flush()
    db.add(DesignProtocoloArchivo(protocolo_id=p.id, nombre=(nombre_archivo or "")[:255], tamano=len(datos),
                                  paginas=len(textos or []), datos=datos))
    _pr_poner_areas(db, p.id, area_ids)
    _pr_poner_paginas(db, p.id, textos)
    db.commit()
    db.refresh(p)
    return p


def protocolo_actualizar(db: Session, protocolo_id: int, titulo: str | None, area_ids: list[int] | None,
                         version: str | None) -> DesignProtocolo | None:
    p = db.get(DesignProtocolo, protocolo_id)
    if not p:
        return None
    if titulo is not None and titulo.strip():
        p.titulo = titulo.strip()[:255]
    if version is not None:
        p.version = (version or "v1.0")[:20]
    if area_ids is not None:
        _pr_poner_areas(db, p.id, area_ids)
        p.area_id = area_ids[0] if len(area_ids) == 1 else None
    db.commit()
    return p


def protocolo_crear(db: Session, area_id: int | None, titulo: str, descripcion: str, contenido: str,
                    version: str = "v1.0", creado_por: str = "", area_ids: list[int] | None = None) -> DesignProtocolo:
    area_ids = area_ids if area_ids is not None else ([area_id] if area_id else [])
    p = DesignProtocolo(area_id=(area_ids[0] if len(area_ids) == 1 else None), titulo=titulo.strip() or "Protocolo sin título",
                        descripcion=descripcion, contenido=contenido, version=version or "v1.0",
                        creado_por=creado_por)
    db.add(p)
    db.flush()
    _pr_poner_areas(db, p.id, area_ids)
    db.commit()
    db.refresh(p)
    return p


def protocolo_eliminar(db: Session, protocolo_id: int, eliminado_por: str = "") -> bool:
    p = db.get(DesignProtocolo, protocolo_id)
    if not p:
        return False
    arch = protocolo_archivo(db, p.id)
    paginas = (db.query(DesignProtocoloPagina).filter(DesignProtocoloPagina.protocolo_id == p.id)
               .order_by(DesignProtocoloPagina.pagina).all())
    payload = {"protocolo": {"area_id": p.area_id, "titulo": p.titulo, "descripcion": p.descripcion,
                             "contenido": p.contenido, "version": p.version, "creado_por": p.creado_por},
               "areas": _pr_areas_ids(db, p.id), "archivo_id": arch.id if arch else None,
               "paginas": [x.texto for x in paginas]}
    _trash_registrar(db, "protocol", f'Protocolo: "{p.titulo}"', payload, eliminado_por)
    if arch:
        arch.protocolo_id = None  # el PDF se conserva mientras esté en la Papelera
    db.query(DesignProtocoloPagina).filter(DesignProtocoloPagina.protocolo_id == p.id).delete()
    db.query(DesignProtocoloArea).filter(DesignProtocoloArea.protocolo_id == p.id).delete()
    db.query(DesignFavorito).filter(DesignFavorito.tipo == "protocolo", DesignFavorito.protocolo_id == protocolo_id).delete()
    db.flush()
    db.delete(p)
    db.commit()
    return True


def pr_limpiar_archivos_huerfanos(db: Session) -> None:
    """PDFs de protocolos borrados cuya entrada de Papelera ya no existe (vaciada o eliminada)."""
    en_papelera = set()
    for t in db.query(DesignTrash).filter(DesignTrash.modulo == "protocol"):
        aid = _json(t.payload, {}).get("archivo_id")
        if aid:
            en_papelera.add(aid)
    q = db.query(DesignProtocoloArchivo).filter(DesignProtocoloArchivo.protocolo_id.is_(None))
    if en_papelera:
        q = q.filter(~DesignProtocoloArchivo.id.in_(en_papelera))
    q.delete(synchronize_session=False)


def protocolos_migrar_areas(db: Session) -> None:
    """Idempotente: protocolos creados antes de tener varias áreas pasan su área única a la tabla de áreas."""
    con_areas = {r[0] for r in db.query(DesignProtocoloArea.protocolo_id)}
    for p in db.query(DesignProtocolo).filter(DesignProtocolo.area_id.isnot(None)):
        if p.id not in con_areas:
            db.add(DesignProtocoloArea(protocolo_id=p.id, area_id=p.area_id))


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


def canvas_eliminar_doc(db: Session, doc_id: int, eliminado_por: str = "", empleado_id: int | None = None) -> int | None:
    """Envía la hoja a la Papelera y devuelve el id de esa entrada (para "Deshacer"), o None si no existe."""
    d = db.get(DesignCanvasDoc, doc_id)
    if not d:
        return None
    payload = {"area_id": d.area_id, "orden": d.orden, "doc": canvas_serializar(d), "eliminado_por_id": empleado_id}
    t = _trash_registrar(db, "cv-doc", f'Hoja de Canvas "{d.nombre}"', payload, eliminado_por)
    db.delete(d)
    db.commit()
    return t.id


CANVAS_DESHACER_MINUTOS = 10


def canvas_deshacer_eliminar(db: Session, trash_id: int, empleado_id: int) -> str:
    """'Deshacer' tras borrar una hoja de Canvas: cualquier persona puede recuperar SU propia hoja
    recién borrada (hasta 10 min); lo demás sigue en la Papelera, que es solo para líderes.
    Devuelve 'ok' | 'no-existe' | 'ajena' | 'vencido' | 'error'."""
    t = db.get(DesignTrash, trash_id)
    if not t or t.modulo != "cv-doc":
        return "no-existe"
    if _json(t.payload, {}).get("eliminado_por_id") != empleado_id:
        return "ajena"
    if datetime.utcnow() - t.eliminado_en > timedelta(minutes=CANVAS_DESHACER_MINUTOS):
        return "vencido"
    return "ok" if trash_restaurar(db, trash_id) else "error"


# ---------------------------------------------------------------------------
# Importar equipos desde Desempeño: los 16 "equipos" de las hojas de evaluación
# (más "DESIGN MANAGERS", que no tiene equipo propio) ya reflejan la estructura
# real área→manager→diseñadores. Esto cruza esos nombres contra los Empleado ya
# registrados en People (no crea empleados nuevos: nunca se inventan datos de
# identificación de personas reales) y arma/confirma los DesignTeam.
# ---------------------------------------------------------------------------

# Mapeo hoja de Desempeño -> (área de Design Schedule, nombre completo del manager).
# Verificado a mano contra la hoja "DESIGN MANAGERS" (que lista los managers de
# cada equipo) para resolver casos ambiguos como los dos "Paula" (Parra vs. De la
# Torre, esta última identificada por el sufijo "Dlt" = "De la Torre").
SHEET_MANAGER_MAP = {
    "N6 Marlene": ("N6 Material Changes", "Marlene Aguirre"),
    "N2 Daniel": ("N2 Demodenture", "Daniel Valencia"),
    "N2 Heiner": ("N2 Demodenture", "Heiner Cañon"),
    "N2 Samuel": ("N2 Demodenture", "Samuel Ortega"),
    "N2 Gleider": ("N2 Demodenture", "Gleider Garcia"),
    "N2 Dariana": ("N2 Demodenture", "Dariana Ortega"),
    "Face Nicole": ("Face Design", "Nicole de la Hoz"),
    "Face Juliana": ("Face Design", "Juliana Molinares"),
    "N3 Paula": ("N3 Prosthetic", "Paula Parra"),
    "N3 Vanesa": ("N3 Prosthetic", "Vanesa Gutierrez"),
    "N3 David": ("N3 Prosthetic", "David Paredes"),
    "N3 Luisa": ("N3 Prosthetic", "Luisa Ortiz"),
    "N3 Paula Dlt": ("N3 Prosthetic", "Paula de la Torre"),
    "N3 Paola T": ("N3 Prosthetic", "Paola Tuiran"),
    "N3 Mauricio": ("N3 Prosthetic", "Mauricio Folliaco"),
    "N3 Julio": ("N3 Prosthetic", "Julio Hernandez Florez"),
}


def _normalizar_texto(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode("ascii")
    return re.sub(r"\s+", " ", s).strip().lower()


def _palabras(s: str) -> set:
    return set(_normalizar_texto(s).split())


def _buscar_empleado_por_nombre(nombre_buscado: str, empleados: list[Empleado]) -> Empleado | None:
    """Empareja por CONJUNTO de palabras (tolera 'Apellido Nombre' vs 'Nombre Apellido').
    Solo devuelve un match si hay suficiente superposición; nunca inventa un empleado."""
    palabras_buscadas = _palabras(nombre_buscado)
    if not palabras_buscadas:
        return None
    mejor, mejor_score = None, 0.0
    for e in empleados:
        palabras_emp = _palabras(e.nombre_completo)
        if not palabras_emp:
            continue
        if palabras_buscadas == palabras_emp:
            return e  # coincidencia exacta de palabras -- corta inmediatamente
        interseccion = palabras_buscadas & palabras_emp
        union = palabras_buscadas | palabras_emp
        score = len(interseccion) / len(union) if union else 0
        if palabras_buscadas <= palabras_emp or palabras_emp <= palabras_buscadas:
            score = max(score, 0.75)
        if score > mejor_score:
            mejor_score, mejor = score, e
    return mejor if mejor_score >= 0.6 else None


def importar_equipos_desde_desempeno(db: Session, aplicar: bool = False) -> dict:
    seed_path = Path(__file__).resolve().parent / "seed_data" / "design_perf.json"
    with open(seed_path, encoding="utf-8") as f:
        perf_data = json.load(f)

    empleados_design = (db.query(Empleado)
                        .filter(Empleado.empresa == "Nuvia Design Colombia SAS", Empleado.activo == 1).all())

    resultado = {"equipos": [], "sinMapeo": []}
    for sheet in perf_data.get("sheets", []):
        nombre_sheet = sheet.get("name", "")
        mapeo = SHEET_MANAGER_MAP.get(nombre_sheet)
        if not mapeo:
            resultado["sinMapeo"].append(nombre_sheet)
            continue
        area_nombre, manager_nombre = mapeo
        area = db.query(DesignArea).filter(DesignArea.nombre == area_nombre).first()
        manager_emp = _buscar_empleado_por_nombre(manager_nombre, empleados_design)

        miembros_info = []
        vistos = set()
        for emp_data in sheet.get("employees", []):
            nombre_raw = emp_data.get("n", "")
            clave = _normalizar_texto(nombre_raw)
            if not clave or clave in vistos:
                continue  # evita duplicados dentro de la misma hoja (p.ej. un nombre repetido)
            vistos.add(clave)
            match = _buscar_empleado_por_nombre(nombre_raw, empleados_design)
            miembros_info.append({"nombreOriginal": nombre_raw, "empleadoId": match.id if match else None,
                                  "empleadoNombre": match.nombre_completo if match else None})

        equipo_existente = None
        if area and manager_emp:
            equipo_existente = (db.query(DesignTeam)
                                .filter(DesignTeam.area_id == area.id, DesignTeam.manager_id == manager_emp.id)
                                .first())

        creado = False
        agregados = 0
        if aplicar and area and manager_emp:
            team = equipo_existente
            if not team:
                orden = db.query(DesignTeam).filter(DesignTeam.area_id == area.id).count() + 1
                team = DesignTeam(area_id=area.id, nombre=manager_emp.nombre_completo, orden=orden,
                                  manager_id=manager_emp.id)
                db.add(team)
                db.flush()
                creado = True
            ids_actuales = {d.empleado_id for d in db.query(DesignTeamDesigner)
                            .filter(DesignTeamDesigner.team_id == team.id).all()}
            orden_d = len(ids_actuales) + 1
            for m in miembros_info:
                if m["empleadoId"] and m["empleadoId"] not in ids_actuales:
                    db.add(DesignTeamDesigner(team_id=team.id, empleado_id=m["empleadoId"], orden=orden_d))
                    ids_actuales.add(m["empleadoId"])
                    agregados += 1
                    orden_d += 1
            db.commit()

        resultado["equipos"].append({
            "hoja": nombre_sheet, "area": area_nombre, "areaEncontrada": bool(area),
            "managerBuscado": manager_nombre,
            "managerEncontrado": manager_emp.nombre_completo if manager_emp else None,
            "managerId": manager_emp.id if manager_emp else None,
            "equipoYaExistia": bool(equipo_existente),
            "equipoCreado": creado,
            "miembros": miembros_info,
            "miembrosAgregados": agregados,
        })
    return resultado
