"""Producción › Conteo inventario mensual: cada área reporta cada mes cuánto tiene de cada material
en cada bodega (103 Bienes, 200 Servicio), los discos dañados, las fotos de evidencia y las novedades."""
from datetime import datetime, date
from sqlalchemy import String, Integer, Date, DateTime, Float, ForeignKey, Text, Boolean, LargeBinary, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .database import Base


class ConteoBodega(Base):
    __tablename__ = "conteo_bodegas"

    id: Mapped[int] = mapped_column(primary_key=True)
    codigo: Mapped[str] = mapped_column(String(20))        # 103
    nombre: Mapped[str] = mapped_column(String(60))        # BIENES
    prefijo: Mapped[str] = mapped_column(String(10))       # B  (B-MATP6-...)
    orden: Mapped[int] = mapped_column(Integer, default=0)
    activo: Mapped[bool] = mapped_column(Boolean, default=True)


class ConteoMaterial(Base):
    __tablename__ = "conteo_materiales"

    id: Mapped[int] = mapped_column(primary_key=True)
    codigo: Mapped[str] = mapped_column(String(30))        # MATP6
    descripcion: Mapped[str] = mapped_column(String(200))  # Incisal Enhancer 1.5 DPLB10
    orden: Mapped[int] = mapped_column(Integer, default=0)
    activo: Mapped[bool] = mapped_column(Boolean, default=True)


class ConteoReporte(Base):
    """Un conteo por área y mes (si se vuelve a enviar, se corrige el mismo)."""
    __tablename__ = "conteo_reportes"
    __table_args__ = (UniqueConstraint("area", "anio", "mes", name="uq_conteo_area_mes"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    fecha_reporte: Mapped[date] = mapped_column(Date)
    anio: Mapped[int] = mapped_column(Integer)
    mes: Mapped[int] = mapped_column(Integer)              # 1..12
    area: Mapped[str] = mapped_column(String(100))
    responsable_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    responsable_email: Mapped[str] = mapped_column(String(150), default="")  # correo Zoho de quien reporta
    novedad: Mapped[str] = mapped_column(Text, default="")
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    actualizado_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    actualizado_por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)

    responsable = relationship("Empleado", foreign_keys=[responsable_id])
    actualizado_por = relationship("Empleado", foreign_keys=[actualizado_por_id])
    lineas = relationship("ConteoLinea", back_populates="reporte", cascade="all, delete-orphan")
    evidencias = relationship("ConteoEvidencia", back_populates="reporte", cascade="all, delete-orphan")


class ConteoLinea(Base):
    """Cantidad contada de un material en una bodega (tipo CONTEO) o discos dañados de la bodega (tipo DANADO)."""
    __tablename__ = "conteo_lineas"

    id: Mapped[int] = mapped_column(primary_key=True)
    reporte_id: Mapped[int] = mapped_column(ForeignKey("conteo_reportes.id"), index=True)
    bodega_id: Mapped[int] = mapped_column(ForeignKey("conteo_bodegas.id"))
    material_id: Mapped[int | None] = mapped_column(ForeignKey("conteo_materiales.id"), nullable=True)
    tipo: Mapped[str] = mapped_column(String(10), default="CONTEO")  # CONTEO | DANADO
    cantidad: Mapped[float] = mapped_column(Float, default=0)

    reporte = relationship("ConteoReporte", back_populates="lineas")


class ConteoEvidencia(Base):
    """Foto (o PDF) de evidencia de un material; sin material = evidencia de los discos dañados."""
    __tablename__ = "conteo_evidencias"

    id: Mapped[int] = mapped_column(primary_key=True)
    reporte_id: Mapped[int] = mapped_column(ForeignKey("conteo_reportes.id"), index=True)
    material_id: Mapped[int | None] = mapped_column(ForeignKey("conteo_materiales.id"), nullable=True)
    nombre: Mapped[str] = mapped_column(String(200), default="")
    tipo_mime: Mapped[str] = mapped_column(String(80), default="image/jpeg")
    tamano: Mapped[int] = mapped_column(Integer, default=0)
    datos: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)  # no se carga salvo que se pida
    creado_por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    reporte = relationship("ConteoReporte", back_populates="evidencias")
