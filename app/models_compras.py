"""Módulo Compras: control de inventario de Items (réplica de SST -- ver app/models_sst.py --
pero con SKU, clasificación y, por ahora, acceso exclusivo de superadmin).

Sin tabla de saldo cacheado: el stock de cada ítem se deriva sumando CompraIngreso (aprobados) y
restando CompraSolicitudLinea (de solicitudes entregadas), igual que SST."""
from datetime import datetime, date
from sqlalchemy import String, Integer, Float, Date, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .database import Base

UNIDADES_CONTEO = ("PACK", "UND", "GALON")
CATEGORIAS_COMPRAS = ("Aseo y Cafetería", "Tecnología", "Otros")


class CompraItem(Base):
    """Catálogo de items de Compras. `presentacion` = unidades reales por paquete (1 si no aplica)."""
    __tablename__ = "compras_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(150), unique=True)
    sku: Mapped[str] = mapped_column(String(50), default="")
    categoria: Mapped[str] = mapped_column(String(30), default="Otros")
    unidad_conteo: Mapped[str] = mapped_column(String(20), default="UND")
    presentacion: Mapped[int] = mapped_column(Integer, default=1)
    orden: Mapped[int] = mapped_column(Integer, default=0)
    activo: Mapped[int] = mapped_column(Integer, default=1)


class CompraIngreso(Base):
    """Un ingreso de inventario, pendiente de aprobación (hoy, de otro superadmin)."""
    __tablename__ = "compras_ingresos"

    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("compras_items.id"))
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

    item = relationship("CompraItem")
    registrado_por = relationship("Empleado", foreign_keys=[registrado_por_id])
    resuelto_por = relationship("Empleado", foreign_keys=[resuelto_por_id])

    @property
    def consecutivo(self) -> str:
        return f"ITEM-E-{self.id:04d}"


class CompraSolicitud(Base):
    """Cabecera de una solicitud de items; se entrega o rechaza como un todo."""
    __tablename__ = "compras_solicitudes"

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
    lineas = relationship("CompraSolicitudLinea", back_populates="solicitud", cascade="all, delete-orphan")

    @property
    def consecutivo(self) -> str:
        return f"ITEM-S-{self.id:04d}"


class CompraSolicitudLinea(Base):
    __tablename__ = "compras_solicitud_lineas"

    id: Mapped[int] = mapped_column(primary_key=True)
    solicitud_id: Mapped[int] = mapped_column(ForeignKey("compras_solicitudes.id"))
    item_id: Mapped[int] = mapped_column(ForeignKey("compras_items.id"))
    cantidad_solicitada: Mapped[float] = mapped_column(Float)
    unidad_usada: Mapped[str] = mapped_column(String(20))
    cantidad_unidades: Mapped[float] = mapped_column(Float)

    solicitud = relationship("CompraSolicitud", back_populates="lineas")
    item = relationship("CompraItem")
