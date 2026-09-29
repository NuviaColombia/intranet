"""Módulo SST: control de inventario de EPP (elementos de protección personal) de Nuvia Smiles.

Sin tabla de saldo cacheado: el stock de cada ítem se deriva sumando SstIngreso (aprobados) y
restando SstSolicitudLinea (de solicitudes entregadas), igual que hace Custodia con sus traslados."""
from datetime import datetime, date
from sqlalchemy import String, Integer, Float, Date, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .database import Base

UNIDADES_CONTEO = ("PACK", "UND", "GALON")
ROLES_SST = ("compras", "coordinador")


class SstItem(Base):
    """Catálogo de EPP. `presentacion` = unidades reales por paquete (1 si no aplica)."""
    __tablename__ = "sst_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(150), unique=True)
    unidad_conteo: Mapped[str] = mapped_column(String(20), default="UND")
    presentacion: Mapped[int] = mapped_column(Integer, default=1)
    orden: Mapped[int] = mapped_column(Integer, default=0)
    activo: Mapped[int] = mapped_column(Integer, default=1)


class SstAcceso(Base):
    """Rol fijo de una persona dentro de SST (compras registra ingresos, coordinador aprueba/entrega)."""
    __tablename__ = "sst_accesos"
    __table_args__ = (UniqueConstraint("empleado_id", "rol_sst", name="uq_sst_acceso"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    empleado_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"), index=True)
    rol_sst: Mapped[str] = mapped_column(String(20))
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    empleado = relationship("Empleado", foreign_keys=[empleado_id])


class SstIngreso(Base):
    """Un ingreso de inventario registrado por Compras, pendiente de aprobación de Coordinación SST."""
    __tablename__ = "sst_ingresos"

    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("sst_items.id"))
    cantidad_ingresada: Mapped[float] = mapped_column(Float)
    unidad_usada: Mapped[str] = mapped_column(String(20))
    cantidad_unidades: Mapped[float] = mapped_column(Float)
    fecha: Mapped[date] = mapped_column(Date)
    estado: Mapped[str] = mapped_column(String(20), default="pendiente")  # pendiente|aprobado|rechazado

    registrado_por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    resuelto_por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    resuelto_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    motivo_rechazo: Mapped[str] = mapped_column(String(300), default="")
    notas: Mapped[str] = mapped_column(String(300), default="")

    item = relationship("SstItem")
    registrado_por = relationship("Empleado", foreign_keys=[registrado_por_id])
    resuelto_por = relationship("Empleado", foreign_keys=[resuelto_por_id])

    @property
    def consecutivo(self) -> str:
        return f"EPP-E-{self.id:04d}"


class SstSolicitud(Base):
    """Cabecera de una solicitud de EPP de un manager; se entrega o rechaza como un todo."""
    __tablename__ = "sst_solicitudes"

    id: Mapped[int] = mapped_column(primary_key=True)
    solicitante_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"))
    fecha_solicitud: Mapped[date] = mapped_column(Date)
    estado: Mapped[str] = mapped_column(String(20), default="pendiente")  # pendiente|entregada|rechazada

    entregado_por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    entregado_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    motivo_rechazo: Mapped[str] = mapped_column(String(300), default="")
    notas: Mapped[str] = mapped_column(String(300), default="")

    solicitante = relationship("Empleado", foreign_keys=[solicitante_id])
    entregado_por = relationship("Empleado", foreign_keys=[entregado_por_id])
    lineas = relationship("SstSolicitudLinea", back_populates="solicitud", cascade="all, delete-orphan")

    @property
    def consecutivo(self) -> str:
        return f"EPP-S-{self.id:04d}"


class SstSolicitudLinea(Base):
    __tablename__ = "sst_solicitud_lineas"

    id: Mapped[int] = mapped_column(primary_key=True)
    solicitud_id: Mapped[int] = mapped_column(ForeignKey("sst_solicitudes.id"))
    item_id: Mapped[int] = mapped_column(ForeignKey("sst_items.id"))
    cantidad_solicitada: Mapped[float] = mapped_column(Float)
    unidad_usada: Mapped[str] = mapped_column(String(20))
    cantidad_unidades: Mapped[float] = mapped_column(Float)

    solicitud = relationship("SstSolicitud", back_populates="lineas")
    item = relationship("SstItem")
