"""Producción › Seguimiento de consumo: entrega de materias primas (frascos) a los técnicos y
rendimiento diario (arcos por tipo de producto) hasta que cada frasco se consume.
Reemplaza la app de Google Apps Script "Sistema de Control de Producción"."""
from datetime import datetime, date
from sqlalchemy import String, Integer, Date, DateTime, Float, ForeignKey, Text, Boolean, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .database import Base


class ConsumoMateria(Base):
    """Catálogo de materias primas que se entregan por frasco (Parámetros)."""
    __tablename__ = "consumo_materias"

    id: Mapped[int] = mapped_column(primary_key=True)
    descripcion: Mapped[str] = mapped_column(String(150))
    presentacion: Mapped[str] = mapped_column(String(80), default="")     # ej. Frasco
    contenido: Mapped[str] = mapped_column(String(80), default="")        # ej. 100 g
    area: Mapped[str] = mapped_column(String(100), default="")            # área de producción que la usa
    mide_arcos: Mapped[bool] = mapped_column(Boolean, default=True)       # False = líquido: no registra arcos
    medida: Mapped[str] = mapped_column(String(20), default="")           # arcos | gotas | consumo ("" = según mide_arcos)
    orden: Mapped[int] = mapped_column(Integer, default=0)
    activo: Mapped[int] = mapped_column(Integer, default=1)


class ConsumoTipo(Base):
    """Tipos de producto que se cuentan en la jornada (ej. Tipo 5, Tipo 4, Tipo 7)."""
    __tablename__ = "consumo_tipos"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(60), unique=True)
    orden: Mapped[int] = mapped_column(Integer, default=0)
    activo: Mapped[int] = mapped_column(Integer, default=1)


class ConsumoTecnico(Base):
    """Técnicos (de People) a los que se les entregan frascos, con su área."""
    __tablename__ = "consumo_tecnicos"
    __table_args__ = (UniqueConstraint("empleado_id", name="uq_consumo_tecnico"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    empleado_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"))
    area: Mapped[str] = mapped_column(String(100), default="")
    activo: Mapped[int] = mapped_column(Integer, default=1)

    empleado = relationship("Empleado")


class ConsumoManager(Base):
    """Managers del submódulo y el área que manejan (entregan y registran jornadas de esa área)."""
    __tablename__ = "consumo_managers"
    __table_args__ = (UniqueConstraint("empleado_id", name="uq_consumo_manager"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    empleado_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"))
    area: Mapped[str] = mapped_column(String(100), default="")

    empleado = relationship("Empleado")


class ConsumoEntrega(Base):
    """Entrega de frascos de un manager a un técnico (consecutivo = id)."""
    __tablename__ = "consumo_entregas"

    id: Mapped[int] = mapped_column(primary_key=True)
    fecha: Mapped[date] = mapped_column(Date)
    hora: Mapped[str] = mapped_column(String(5), default="")
    area: Mapped[str] = mapped_column(String(100), default="")
    manager_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    tecnico_id: Mapped[int] = mapped_column(ForeignKey("consumo_tecnicos.id"))
    observaciones: Mapped[str] = mapped_column(Text, default="")
    estado: Mapped[str] = mapped_column(String(20), default="ACTIVO")     # ACTIVO | ANULADO
    creado_por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    anulado_por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    anulado_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    motivo_anulacion: Mapped[str | None] = mapped_column(Text, nullable=True)

    manager = relationship("Empleado", foreign_keys=[manager_id])
    tecnico = relationship("ConsumoTecnico")
    anulado_por = relationship("Empleado", foreign_keys=[anulado_por_id])
    frascos = relationship("ConsumoFrasco", back_populates="entrega", order_by="ConsumoFrasco.id")


class ConsumoFrasco(Base):
    """Cada frasco entregado, con su lote, referencia y número de serie propios."""
    __tablename__ = "consumo_frascos"

    id: Mapped[int] = mapped_column(primary_key=True)
    entrega_id: Mapped[int] = mapped_column(ForeignKey("consumo_entregas.id"), index=True)
    materia_id: Mapped[int] = mapped_column(ForeignKey("consumo_materias.id"))
    lote: Mapped[str] = mapped_column(String(60), default="")
    ref: Mapped[str] = mapped_column(String(60), default="")
    serie: Mapped[str] = mapped_column(String(60), default="")
    estado: Mapped[str] = mapped_column(String(20), default="EN_USO")     # EN_USO | CONSUMIDO
    consumido_en: Mapped[date | None] = mapped_column(Date, nullable=True)

    entrega = relationship("ConsumoEntrega", back_populates="frascos")
    materia = relationship("ConsumoMateria")
    jornadas = relationship("ConsumoJornada", back_populates="frasco", order_by="ConsumoJornada.fecha")


class ConsumoJornada(Base):
    """Rendimiento de un frasco en un día: arcos por tipo (JSON {tipo_id: cantidad}). Uno por frasco y día."""
    __tablename__ = "consumo_jornadas"
    __table_args__ = (UniqueConstraint("frasco_id", "fecha", name="uq_consumo_jornada"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    frasco_id: Mapped[int] = mapped_column(ForeignKey("consumo_frascos.id"), index=True)
    fecha: Mapped[date] = mapped_column(Date, index=True)
    arcos: Mapped[str] = mapped_column(Text, default="{}")
    total: Mapped[float] = mapped_column(Float, default=0)
    gotas: Mapped[float] = mapped_column(Float, default=0)                # materias que se miden por gotas usadas en el día
    registrado_por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    registrado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    frasco = relationship("ConsumoFrasco", back_populates="jornadas")
    registrado_por = relationship("Empleado")
