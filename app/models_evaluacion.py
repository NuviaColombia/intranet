"""Evaluación de desempeño (People): 360° al jefe + evaluación individual del equipo, y el
documento de Plan de Mejora por líder -- ver app/services_evaluacion.py y docs/wiki/permisos.md."""
from datetime import date, datetime
from sqlalchemy import String, Integer, Date, DateTime, Text, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .database import Base


class EvaluacionCiclo(Base):
    """Una ventana de evaluación (noviembre o mayo de un año dado). Se abre sola, una vez."""
    __tablename__ = "evaluacion_ciclos"
    __table_args__ = (UniqueConstraint("anio", "mes"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    anio: Mapped[int] = mapped_column(Integer)
    mes: Mapped[int] = mapped_column(Integer)  # 5 (mayo) u 11 (noviembre)
    etiqueta: Mapped[str] = mapped_column(String(30))  # "Noviembre 2026"
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Evaluacion360Respuesta(Base):
    """Lo que un miembro del equipo respondió sobre uno de sus jefes (Sección 2 del Excel)."""
    __tablename__ = "evaluacion_360_respuestas"
    __table_args__ = (UniqueConstraint("ciclo_id", "evaluador_id", "evaluado_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    ciclo_id: Mapped[int] = mapped_column(ForeignKey("evaluacion_ciclos.id"))
    evaluador_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"))
    evaluado_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"))
    comp_1: Mapped[int] = mapped_column(Integer)
    comp_2: Mapped[int] = mapped_column(Integer)
    comp_3: Mapped[int] = mapped_column(Integer)
    comp_4: Mapped[int] = mapped_column(Integer)
    comp_5: Mapped[int] = mapped_column(Integer)
    comp_6: Mapped[int] = mapped_column(Integer)
    comp_7: Mapped[int] = mapped_column(Integer)
    comp_8: Mapped[int] = mapped_column(Integer)
    comp_9: Mapped[int] = mapped_column(Integer)
    comp_10: Mapped[int] = mapped_column(Integer)
    comp_11: Mapped[int] = mapped_column(Integer)
    comp_12: Mapped[int] = mapped_column(Integer)
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    actualizado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    evaluador = relationship("Empleado", foreign_keys=[evaluador_id])
    evaluado = relationship("Empleado", foreign_keys=[evaluado_id])


class EvaluacionEquipoRespuesta(Base):
    """Lo que un jefe respondió sobre un miembro de su equipo (Sección 4 del Excel)."""
    __tablename__ = "evaluacion_equipo_respuestas"
    __table_args__ = (UniqueConstraint("ciclo_id", "jefe_id", "empleado_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    ciclo_id: Mapped[int] = mapped_column(ForeignKey("evaluacion_ciclos.id"))
    jefe_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"))
    empleado_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"))
    calif_inteligencia_emocional: Mapped[int] = mapped_column(Integer)
    calif_equidad: Mapped[int] = mapped_column(Integer)
    calif_cumplimiento_objetivos: Mapped[int] = mapped_column(Integer)
    observacion: Mapped[str] = mapped_column(Text, default="")
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    actualizado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    jefe = relationship("Empleado", foreign_keys=[jefe_id])
    empleado = relationship("Empleado", foreign_keys=[empleado_id])


class PlanMejora(Base):
    """El documento "Plan de mejora" de un líder para un ciclo (Secciones 1, 3, 5, 6, 7 del Excel;
    las Secciones 2 y 4 se calculan en vivo desde Evaluacion360Respuesta/EvaluacionEquipoRespuesta)."""
    __tablename__ = "evaluacion_planes_mejora"
    __table_args__ = (UniqueConstraint("lider_id", "ciclo_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    lider_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"))
    ciclo_id: Mapped[int] = mapped_column(ForeignKey("evaluacion_ciclos.id"))
    periodo_plan: Mapped[str] = mapped_column(String(100), default="")
    fecha_inicio_plan: Mapped[date | None] = mapped_column(Date, nullable=True)
    fortalezas: Mapped[str] = mapped_column(Text, default="")
    areas_mejora: Mapped[str] = mapped_column(Text, default="")
    firma_lider_nombre: Mapped[str] = mapped_column(String(150), default="")
    firma_lider_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    firma_jefe_nombre: Mapped[str] = mapped_column(String(150), default="")
    firma_jefe_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    firma_rrhh_nombre: Mapped[str] = mapped_column(String(150), default="")
    firma_rrhh_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    lider = relationship("Empleado", foreign_keys=[lider_id])
    ciclo = relationship("EvaluacionCiclo")
    notas_competencias = relationship("PlanMejoraCompetenciaNota", order_by="PlanMejoraCompetenciaNota.indice",
                                      cascade="all, delete-orphan")
    acciones = relationship("PlanMejoraAccion", order_by="PlanMejoraAccion.numero", cascade="all, delete-orphan")
    seguimientos = relationship("PlanMejoraSeguimiento", order_by="PlanMejoraSeguimiento.mes_indice",
                                cascade="all, delete-orphan")


class PlanMejoraCompetenciaNota(Base):
    """Hallazgo principal y prioridad por cada una de las 12 competencias (Sección 2, columnas
    que no se calculan solas). `indice` va de 1 a 12, en el orden de COMPETENCIAS_360."""
    __tablename__ = "evaluacion_plan_competencia_notas"
    __table_args__ = (UniqueConstraint("plan_id", "indice"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("evaluacion_planes_mejora.id"))
    indice: Mapped[int] = mapped_column(Integer)
    hallazgo: Mapped[str] = mapped_column(Text, default="")
    prioridad: Mapped[str] = mapped_column(String(10), default="")  # "", "Alta", "Media", "Baja"


class PlanMejoraAccion(Base):
    """Una fila del plan de acción (Sección 5). `numero` va de 1 a 6 (filas fijas del Excel)."""
    __tablename__ = "evaluacion_plan_acciones"
    __table_args__ = (UniqueConstraint("plan_id", "numero"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("evaluacion_planes_mejora.id"))
    numero: Mapped[int] = mapped_column(Integer)
    area_mejora: Mapped[str] = mapped_column(Text, default="")
    accion: Mapped[str] = mapped_column(Text, default="")
    responsable: Mapped[str] = mapped_column(String(150), default="")
    recursos: Mapped[str] = mapped_column(Text, default="")
    fecha_inicio: Mapped[date | None] = mapped_column(Date, nullable=True)
    fecha_fin: Mapped[date | None] = mapped_column(Date, nullable=True)
    indicador: Mapped[str] = mapped_column(Text, default="")


class PlanMejoraSeguimiento(Base):
    """Una fila de seguimiento mensual (Sección 6). `mes_indice` va de 1 a 6 (filas fijas del Excel)."""
    __tablename__ = "evaluacion_plan_seguimientos"
    __table_args__ = (UniqueConstraint("plan_id", "mes_indice"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("evaluacion_planes_mejora.id"))
    mes_indice: Mapped[int] = mapped_column(Integer)
    avances: Mapped[str] = mapped_column(Text, default="")
    dificultades: Mapped[str] = mapped_column(Text, default="")
    ajustes: Mapped[str] = mapped_column(Text, default="")
    porcentaje_avance: Mapped[int | None] = mapped_column(Integer, nullable=True)


class EvaluacionRecordatorioEnviado(Base):
    """Marca de "ya se le avisó a esta persona en este ciclo" (evita reenvíos duplicados)."""
    __tablename__ = "evaluacion_recordatorios_enviados"

    ciclo_id: Mapped[int] = mapped_column(ForeignKey("evaluacion_ciclos.id"), primary_key=True)
    empleado_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"), primary_key=True)
    enviado_en: Mapped[datetime] = mapped_column(DateTime)
