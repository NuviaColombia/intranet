"""Lógica de negocio del módulo Design Schedule."""
from datetime import date, timedelta
from sqlalchemy.orm import Session, joinedload
from .models import Empleado
from .models_design import (DesignArea, DesignTeam, DesignTeamDesigner, DesignCatalogo,
                            DesignAusenciaTipo, DesignOrden, DesignBreak, FORMATO_DUAL)

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
