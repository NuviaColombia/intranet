"""Lógica de negocio del módulo Design Schedule."""
import json
from datetime import date, datetime, timedelta
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from .models import Empleado
from .models_design import (DesignArea, DesignTeam, DesignTeamDesigner, DesignCatalogo,
                            DesignAusenciaTipo, DesignOrden, DesignBreak, DesignComentarioHistorial,
                            DesignFaq, FORMATO_DUAL)

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
