"""Módulo Custodia: control de traslados de material entre áreas de producción."""
from datetime import datetime, date, time
from sqlalchemy import String, Integer, Date, Time, DateTime, Float, ForeignKey, Text, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .database import Base


AREA_QC_FINAL = "QC FINAL"
AREA_DIR_PRODUCCION = "DIR PRODUCCIÓN"


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
    # Salidas de QC FINAL: además de salida y entrada, las firma obligatoriamente DIR PRODUCCIÓN
    dir_firmado_por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    dir_firmado_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    anulado: Mapped[bool] = mapped_column(Boolean, default=False)
    anulado_por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    anulado_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    motivo_anulacion: Mapped[str | None] = mapped_column(Text, nullable=True)  # obligatorio al anular

    creado_por = relationship("Empleado", foreign_keys=[creado_por_id])
    confirmado_por = relationship("Empleado", foreign_keys=[confirmado_por_id])
    dir_firmado_por = relationship("Empleado", foreign_keys=[dir_firmado_por_id])
    anulado_por = relationship("Empleado", foreign_keys=[anulado_por_id])

    ordenes = relationship("CustodiaOrdenLinea", back_populates="traslado", order_by="CustodiaOrdenLinea.id")
    resumen = relationship("CustodiaResumen", back_populates="traslado")
    discos = relationship("CustodiaDiscos", back_populates="traslado")
    op = relationship("CustodiaOP", back_populates="traslado")

    @property
    def requiere_firma_dir(self) -> bool:
        """Lo que sale de QC FINAL lo firma también DIR PRODUCCIÓN (si va a DIR, su recibido ya es esa firma)."""
        salida, entrada = (self.area_salida or "").strip().upper(), (self.area_entrada or "").strip().upper()
        return salida == AREA_QC_FINAL and entrada != AREA_DIR_PRODUCCION

    @property
    def pendiente_dir(self) -> bool:
        return self.requiere_firma_dir and not self.dir_firmado_en and not self.anulado

    @property
    def completo(self) -> bool:
        return not self.anulado and bool(self.confirmado_entrada) and not self.pendiente_dir

    @property
    def estado_texto(self) -> str:
        if self.anulado:
            return "Anulado"
        faltan = ([] if self.confirmado_entrada else ["entrada"]) + (["DIR Producción"] if self.pendiente_dir else [])
        return "Completado" if not faltan else "Pendiente " + " y ".join(faltan)


class CustodiaOrdenLinea(Base):
    """Una orden/PO individual dentro de un traslado (un traslado puede mover varias órdenes)."""
    __tablename__ = "custodia_ordenes"

    id: Mapped[int] = mapped_column(primary_key=True)
    traslado_id: Mapped[int] = mapped_column(ForeignKey("custodia_traslados.id"))
    numero_orden: Mapped[str] = mapped_column(String(50), index=True)
    cantidad_discos: Mapped[float] = mapped_column(Float)
    # Si la cantidad se tomó del Stock del área de salida y se le asignó este número de orden:
    # en el área de salida descuenta de "orden_origen" (ej. STOCK) y en la de entrada suma a numero_orden.
    orden_origen: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    # Orden nueva que sale de DIR Producción: el material entra y sale de DIR Producción en el mismo
    # registro (se suma y se resta), para que su existencia no quede en negativo.
    ingreso_directo: Mapped[bool] = mapped_column(Boolean, default=False)

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
    # Horas en el área antes de marcar una orden como advertencia/crítica en "Ubicación actual"
    alerta_horas_advertencia: Mapped[int] = mapped_column(Integer, default=24)
    alerta_horas_critica: Mapped[int] = mapped_column(Integer, default=48)


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



class CustodiaStockDescripcion(Base):
    """Movimientos del Stock por descripción (la del Resumen general, ej. NDZ-B1-A10-N) en cada área.
    INICIAL: asignado en Parámetros · ENTRADA: llega al Stock de un área (cuenta al confirmar la entrada) ·
    SALIDA: sale del Stock (cantidad negativa). Si el traslado se anula, sus movimientos dejan de contar."""
    __tablename__ = "custodia_stock_descripciones"

    id: Mapped[int] = mapped_column(primary_key=True)
    traslado_id: Mapped[int | None] = mapped_column(ForeignKey("custodia_traslados.id"), nullable=True, index=True)
    area: Mapped[str] = mapped_column(String(100))
    descripcion: Mapped[str] = mapped_column(String(200))
    cantidad: Mapped[float] = mapped_column(Float)          # + entra, - sale
    tipo: Mapped[str] = mapped_column(String(20))           # INICIAL | ENTRADA | SALIDA
    creado_por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    traslado = relationship("CustodiaTraslado")
    creado_por = relationship("Empleado", foreign_keys=[creado_por_id])
