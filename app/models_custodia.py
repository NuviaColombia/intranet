"""Módulo Custodia: control de traslados de material entre áreas de producción."""
from datetime import datetime, date, time
from sqlalchemy import String, Integer, Date, Time, DateTime, Float, ForeignKey, Text, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .database import Base


class CustodiaTraslado(Base):
    """Cabecera de un traslado (un registro = lo que antes compartía un CONSECUTIVO)."""
    __tablename__ = "custodia_traslados"

    id: Mapped[int] = mapped_column(primary_key=True)  # = antiguo CONSECUTIVO
    colaborador: Mapped[str] = mapped_column(String(150))
    id_colaborador: Mapped[str] = mapped_column(String(50), default="")
    area_creacion: Mapped[str] = mapped_column(String(100))
    fecha: Mapped[date] = mapped_column(Date)
    hora: Mapped[time] = mapped_column(Time)
    usuario: Mapped[str] = mapped_column(String(100), default="")
    area_salida: Mapped[str] = mapped_column(String(100))
    area_entrada: Mapped[str] = mapped_column(String(100))
    motivo: Mapped[str] = mapped_column(String(100))

    creado_por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    confirmado_entrada: Mapped[bool] = mapped_column(Boolean, default=False)
    confirmado_por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    confirmado_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    anulado: Mapped[bool] = mapped_column(Boolean, default=False)
    anulado_por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    anulado_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    creado_por = relationship("Empleado", foreign_keys=[creado_por_id])
    confirmado_por = relationship("Empleado", foreign_keys=[confirmado_por_id])
    anulado_por = relationship("Empleado", foreign_keys=[anulado_por_id])

    ordenes = relationship("CustodiaOrdenLinea", back_populates="traslado", order_by="CustodiaOrdenLinea.id")
    resumen = relationship("CustodiaResumen", back_populates="traslado")
    discos = relationship("CustodiaDiscos", back_populates="traslado")
    op = relationship("CustodiaOP", back_populates="traslado")

    @property
    def estado_texto(self) -> str:
        if self.anulado:
            return "Anulado"
        return "Completado" if self.confirmado_entrada else "Pendiente entrada"


class CustodiaOrdenLinea(Base):
    """Una orden/PO individual dentro de un traslado (un traslado puede mover varias órdenes)."""
    __tablename__ = "custodia_ordenes"

    id: Mapped[int] = mapped_column(primary_key=True)
    traslado_id: Mapped[int] = mapped_column(ForeignKey("custodia_traslados.id"))
    numero_orden: Mapped[str] = mapped_column(String(50), index=True)
    cantidad_discos: Mapped[float] = mapped_column(Float)

    traslado = relationship("CustodiaTraslado", back_populates="ordenes")


class CustodiaResumen(Base):
    __tablename__ = "custodia_resumen"

    id: Mapped[int] = mapped_column(primary_key=True)
    traslado_id: Mapped[int] = mapped_column(ForeignKey("custodia_traslados.id"))
    orden: Mapped[str] = mapped_column(String(50), default="")
    descripcion: Mapped[str] = mapped_column(String(200), default="")
    paciente: Mapped[str] = mapped_column(String(150), default="")
    total: Mapped[float] = mapped_column(Float, default=0)
    verificado_salida: Mapped[bool] = mapped_column(Boolean, default=False)
    verificado_entrada: Mapped[bool] = mapped_column(Boolean, default=False)

    traslado = relationship("CustodiaTraslado", back_populates="resumen")


class CustodiaDiscos(Base):
    __tablename__ = "custodia_discos"

    id: Mapped[int] = mapped_column(primary_key=True)
    traslado_id: Mapped[int] = mapped_column(ForeignKey("custodia_traslados.id"))
    detalle_protesis: Mapped[str] = mapped_column(String(200), default="")
    cant_paciente: Mapped[float] = mapped_column(Float, default=0)
    cant_discos: Mapped[float] = mapped_column(Float, default=0)

    traslado = relationship("CustodiaTraslado", back_populates="discos")


class CustodiaFactorDisco(Base):
    """Catálogo de tipos de prótesis y su factor de conversión a cantidad de discos."""
    __tablename__ = "custodia_factores_discos"

    id: Mapped[int] = mapped_column(primary_key=True)
    detalle: Mapped[str] = mapped_column(String(200), unique=True)
    factor: Mapped[float] = mapped_column(Float)
    orden: Mapped[int] = mapped_column(Integer, default=0)
    activo: Mapped[int] = mapped_column(Integer, default=1)


class CustodiaArea(Base):
    """Áreas de producción disponibles para salida/entrada/creación (antes una lista fija en Python)."""
    __tablename__ = "custodia_areas"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(100), unique=True)
    orden: Mapped[int] = mapped_column(Integer, default=0)
    activo: Mapped[int] = mapped_column(Integer, default=1)
    # False para áreas que no cuentan como ubicación de inventario (ej. EMPAQUE)
    es_inventario: Mapped[int] = mapped_column(Integer, default=1)


class CustodiaMotivo(Base):
    """Motivos de traslado disponibles (antes una lista fija en Python)."""
    __tablename__ = "custodia_motivos"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(100), unique=True)
    orden: Mapped[int] = mapped_column(Integer, default=0)
    activo: Mapped[int] = mapped_column(Integer, default=1)


class CustodiaOP(Base):
    __tablename__ = "custodia_op"

    id: Mapped[int] = mapped_column(primary_key=True)
    traslado_id: Mapped[int] = mapped_column(ForeignKey("custodia_traslados.id"))
    orden: Mapped[str] = mapped_column(String(50), default="")
    op: Mapped[str] = mapped_column(String(50), default="")
    descripcion: Mapped[str] = mapped_column(String(200), default="")
    tipo: Mapped[str] = mapped_column(String(100), default="")
    usuario: Mapped[str] = mapped_column(String(100), default="")
    observaciones: Mapped[str] = mapped_column(Text, default="")

    traslado = relationship("CustodiaTraslado", back_populates="op")
