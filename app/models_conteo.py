"""Producción › Conteo inventario mensual: cada área (su manager) cuenta cada mes cuánto tiene de cada material
en cada bodega (103 Bienes, 200 Servicio), los discos dañados, con fotos de evidencia y novedades; después un
validador hace su propio conteo (a ciegas), el sistema compara y el validador valida o devuelve."""
from datetime import datetime, date
from sqlalchemy import String, Integer, Date, DateTime, Float, ForeignKey, Text, Boolean, LargeBinary, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .database import Base

# Estados del conteo de un área en un mes
BORRADOR, ENVIADO, DEVUELTO, VALIDADO = "BORRADOR", "ENVIADO", "DEVUELTO", "VALIDADO"


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


class ConteoMaterialArea(Base):
    """Áreas que cuentan un material. Un material sin filas aquí lo cuentan todas las áreas."""
    __tablename__ = "conteo_material_areas"
    __table_args__ = (UniqueConstraint("material_id", "area", name="uq_conteo_material_area"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    material_id: Mapped[int] = mapped_column(ForeignKey("conteo_materiales.id"), index=True)
    area: Mapped[str] = mapped_column(String(100))


class ConteoValidador(Base):
    """Personas que hacen el conteo de validación (ven todas las áreas)."""
    __tablename__ = "conteo_validadores"

    id: Mapped[int] = mapped_column(primary_key=True)
    empleado_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"), unique=True)
    empleado = relationship("Empleado")


class ConteoTestigo(Base):
    """Personas que pueden firmar como testigo del conteo (tercera firma). El Director de Producción
    (segunda firma) se guarda en ConteoConfig (clave director_id)."""
    __tablename__ = "conteo_testigos"

    id: Mapped[int] = mapped_column(primary_key=True)
    empleado_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"), unique=True)
    empleado = relationship("Empleado")


class ConteoConfig(Base):
    """Ajustes del submódulo: tolerancia de diferencia y día límite para enviar el conteo."""
    __tablename__ = "conteo_config"

    clave: Mapped[str] = mapped_column(String(40), primary_key=True)
    valor: Mapped[str] = mapped_column(String(100), default="")


class ConteoReporte(Base):
    """Un conteo por área y mes: el del manager y, encima, el de validación."""
    __tablename__ = "conteo_reportes"
    __table_args__ = (UniqueConstraint("area", "anio", "mes", name="uq_conteo_area_mes"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    fecha_reporte: Mapped[date] = mapped_column(Date)
    anio: Mapped[int] = mapped_column(Integer)
    mes: Mapped[int] = mapped_column(Integer)              # 1..12
    area: Mapped[str] = mapped_column(String(100))
    estado: Mapped[str] = mapped_column(String(20), default=BORRADOR)
    responsable_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    responsable_email: Mapped[str] = mapped_column(String(150), default="")  # correo Zoho de quien reporta
    novedad: Mapped[str] = mapped_column(Text, default="")
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    actualizado_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    actualizado_por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    # Firma 1: quien carga el conteo (al enviarlo)
    enviado_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    enviado_email: Mapped[str | None] = mapped_column(String(150), nullable=True)
    # Firma 2: Director de Producción (Parámetros) · Firma 3: testigo del conteo (de la lista de testigos; se elige al enviar)
    manager_firma_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    manager_firma_email: Mapped[str | None] = mapped_column(String(150), nullable=True)
    manager_firmado_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    testigo_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    testigo_email: Mapped[str | None] = mapped_column(String(150), nullable=True)
    testigo_firmado_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Conteo de validación
    validacion_por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    validacion_guardada_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    validado_por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    validado_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    validado_email: Mapped[str | None] = mapped_column(String(150), nullable=True)
    devuelto_por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    devuelto_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    observacion: Mapped[str | None] = mapped_column(Text, nullable=True)  # por qué se devolvió

    responsable = relationship("Empleado", foreign_keys=[responsable_id])
    actualizado_por = relationship("Empleado", foreign_keys=[actualizado_por_id])
    validacion_por = relationship("Empleado", foreign_keys=[validacion_por_id])
    validado_por = relationship("Empleado", foreign_keys=[validado_por_id])
    devuelto_por = relationship("Empleado", foreign_keys=[devuelto_por_id])
    manager_firma = relationship("Empleado", foreign_keys=[manager_firma_id])
    testigo = relationship("Empleado", foreign_keys=[testigo_id])
    lineas = relationship("ConteoLinea", back_populates="reporte", cascade="all, delete-orphan")
    evidencias = relationship("ConteoEvidencia", back_populates="reporte", cascade="all, delete-orphan")


class ConteoLinea(Base):
    """Cantidad de un material en una bodega. tipo: CONTEO / DANADO (manager) · VCONTEO / VDANADO (validación)."""
    __tablename__ = "conteo_lineas"

    id: Mapped[int] = mapped_column(primary_key=True)
    reporte_id: Mapped[int] = mapped_column(ForeignKey("conteo_reportes.id"), index=True)
    bodega_id: Mapped[int] = mapped_column(ForeignKey("conteo_bodegas.id"))
    material_id: Mapped[int | None] = mapped_column(ForeignKey("conteo_materiales.id"), nullable=True)
    tipo: Mapped[str] = mapped_column(String(10), default="CONTEO")
    cantidad: Mapped[float] = mapped_column(Float, default=0)

    reporte = relationship("ConteoReporte", back_populates="lineas")


class ConteoEvidencia(Base):
    """Foto (o PDF) de evidencia de un material; sin material = discos dañados. etapa: MANAGER | VALIDACION."""
    __tablename__ = "conteo_evidencias"

    id: Mapped[int] = mapped_column(primary_key=True)
    reporte_id: Mapped[int] = mapped_column(ForeignKey("conteo_reportes.id"), index=True)
    material_id: Mapped[int | None] = mapped_column(ForeignKey("conteo_materiales.id"), nullable=True)
    etapa: Mapped[str] = mapped_column(String(12), default="MANAGER")
    nombre: Mapped[str] = mapped_column(String(200), default="")
    tipo_mime: Mapped[str] = mapped_column(String(80), default="image/jpeg")
    tamano: Mapped[int] = mapped_column(Integer, default=0)
    datos: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)  # no se carga salvo que se pida
    creado_por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    # Copia en Zoho WorkDrive (carpeta raíz / Mes Año / Área / archivo)
    workdrive_estado: Mapped[str] = mapped_column(String(12), default="PENDIENTE")  # PENDIENTE | OK | ERROR
    workdrive_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    workdrive_error: Mapped[str | None] = mapped_column(String(300), nullable=True)
    workdrive_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    reporte = relationship("ConteoReporte", back_populates="evidencias")


class ConteoAviso(Base):
    """Recordatorios de Cliq ya enviados (uno por persona y día) para no repetirlos."""
    __tablename__ = "conteo_avisos"
    __table_args__ = (UniqueConstraint("empleado_id", "fecha", name="uq_conteo_aviso_dia"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    empleado_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"))
    fecha: Mapped[date] = mapped_column(Date)


class ConteoDocumento(Base):
    """PDF firmado generado por el sistema: el acta de un área (al validarse) o el consolidado del mes."""
    __tablename__ = "conteo_documentos"

    id: Mapped[int] = mapped_column(primary_key=True)
    tipo: Mapped[str] = mapped_column(String(12))                  # ACTA | CONSOLIDADO
    reporte_id: Mapped[int | None] = mapped_column(ForeignKey("conteo_reportes.id"), nullable=True, index=True)
    anio: Mapped[int] = mapped_column(Integer)
    mes: Mapped[int] = mapped_column(Integer)
    area: Mapped[str] = mapped_column(String(100), default="")
    nombre: Mapped[str] = mapped_column(String(250))
    datos: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    workdrive_estado: Mapped[str] = mapped_column(String(12), default="PENDIENTE")
    workdrive_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    workdrive_error: Mapped[str | None] = mapped_column(String(300), nullable=True)
    workdrive_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
