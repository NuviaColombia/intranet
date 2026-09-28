"""Módulo Caja menor Nuvia: cajas configurables (Contabilidad, Mantenimiento, ...), recibos de caja menor,
formatos de reembolso (FM) y arqueos rápidos. Reemplaza la app de Google Apps Script "Recibo de Caja Menor"."""
from datetime import datetime, date
from sqlalchemy import String, Integer, Date, DateTime, Float, ForeignKey, Text, UniqueConstraint, Index
from sqlalchemy.orm import backref, Mapped, mapped_column, relationship
from .database import Base


class CajaMenor(Base):
    __tablename__ = "caja_menor_cajas"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(100), unique=True)          # ej. CONTABILIDAD
    prefijo: Mapped[str] = mapped_column(String(10))                       # ej. CONT
    ciudad: Mapped[str] = mapped_column(String(100), default="GALAPA")
    fondo: Mapped[float] = mapped_column(Float, default=1000000)           # fondo permanente
    responsable: Mapped[str] = mapped_column(String(150), default="")      # nombre del responsable (para mostrar)
    responsable_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)  # la persona en People
    consecutivo_inicial: Mapped[int] = mapped_column(Integer, default=1)   # primer recibo si no hay registros
    fm_siguiente: Mapped[int] = mapped_column(Integer, default=1)          # número del próximo FM
    icono: Mapped[str] = mapped_column(String(10), default="💵")
    orden: Mapped[int] = mapped_column(Integer, default=0)
    activo: Mapped[int] = mapped_column(Integer, default=1)


class CajaAcceso(Base):
    """Qué empleados pueden usar cada caja (los administradores entran a todas)."""
    __tablename__ = "caja_menor_accesos"
    __table_args__ = (UniqueConstraint("caja_id", "empleado_id", name="uq_caja_acceso"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    caja_id: Mapped[int] = mapped_column(ForeignKey("caja_menor_cajas.id"))
    empleado_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"))

    caja = relationship("CajaMenor")
    empleado = relationship("Empleado")


class CajaAutorizador(Base):
    """Personas que autorizan (firman "Aprobado por") los recibos de cada caja."""
    __tablename__ = "caja_menor_autorizadores"
    __table_args__ = (UniqueConstraint("caja_id", "empleado_id", name="uq_caja_autorizador"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    caja_id: Mapped[int] = mapped_column(ForeignKey("caja_menor_cajas.id"))
    empleado_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"))

    caja = relationship("CajaMenor")
    empleado = relationship("Empleado")


class CajaSupervisor(Base):
    """Personas que supervisan (dan el visto bueno "Supervisado por") los FM de cada caja."""
    __tablename__ = "caja_menor_supervisores"
    __table_args__ = (UniqueConstraint("caja_id", "empleado_id", name="uq_caja_supervisor"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    caja_id: Mapped[int] = mapped_column(ForeignKey("caja_menor_cajas.id"))
    empleado_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"))

    caja = relationship("CajaMenor")
    empleado = relationship("Empleado")


class CajaFM(Base):
    """Formato de reembolso de caja menor (legalización de un grupo de recibos) con su arqueo."""
    __tablename__ = "caja_menor_fms"
    __table_args__ = (UniqueConstraint("caja_id", "numero", name="uq_caja_fm_numero"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    caja_id: Mapped[int] = mapped_column(ForeignKey("caja_menor_cajas.id"), index=True)
    numero: Mapped[int] = mapped_column(Integer)                           # FM<numero>
    fecha_legalizacion: Mapped[date] = mapped_column(Date)
    responsable: Mapped[str] = mapped_column(String(150), default="")
    fondo: Mapped[float] = mapped_column(Float, default=0)
    valor_en_caja: Mapped[float] = mapped_column(Float, default=0)         # efectivo contado
    ajuste: Mapped[float] = mapped_column(Float, default=0)                # ajuste al peso
    total_pagos: Mapped[float] = mapped_column(Float, default=0)           # suma recibos + ajuste
    desglose: Mapped[str] = mapped_column(Text, default="{}")              # JSON {denominación: cantidad}
    estado: Mapped[str] = mapped_column(String(20), default="VIGENTE")     # VIGENTE | ANULADO
    creado_por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    creado_por_texto: Mapped[str] = mapped_column(String(150), default="")  # usuario original (importados)
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    anulado_por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    anulado_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    motivo_anulacion: Mapped[str | None] = mapped_column(Text, nullable=True)
    supervisado_por: Mapped[str] = mapped_column(String(150), default="")   # quien da el visto bueno
    supervisado_por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True, index=True)
    supervision_email: Mapped[str | None] = mapped_column(String(150), nullable=True)  # correo Zoho con el que firmó
    supervisado_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)   # UTC
    # "Elaborado por": lo firma el responsable de la caja (si él mismo legaliza, queda firmado al legalizar)
    elaborado_por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True, index=True)
    elaboracion_email: Mapped[str | None] = mapped_column(String(150), nullable=True)
    elaborado_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)     # UTC
    # Reembolso: mientras tesorería no reembolse el FM, su dinero sigue "por fuera" de la caja (cuenta en el arqueo)
    reembolsado_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reembolsado_por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    # Último aviso por Cliq pidiendo firma (elaboración o visto bueno): 1 enviado, 0 falló
    aviso_ok: Mapped[int | None] = mapped_column(Integer, nullable=True)
    aviso_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    caja = relationship("CajaMenor")
    creado_por = relationship("Empleado", foreign_keys=[creado_por_id])
    anulado_por = relationship("Empleado", foreign_keys=[anulado_por_id])
    recibos = relationship("CajaRecibo", back_populates="fm", order_by="CajaRecibo.consecutivo.desc()")


class CajaRecibo(Base):
    __tablename__ = "caja_menor_recibos"
    __table_args__ = (UniqueConstraint("caja_id", "consecutivo", name="uq_caja_recibo_consecutivo"),
                      Index("ix_caja_recibos_caja_estado", "caja_id", "estado"),
                      Index("ix_caja_recibos_fecha", "fecha"))

    id: Mapped[int] = mapped_column(primary_key=True)
    caja_id: Mapped[int] = mapped_column(ForeignKey("caja_menor_cajas.id"))
    consecutivo: Mapped[int] = mapped_column(Integer)
    ciudad: Mapped[str] = mapped_column(String(100), default="")
    fecha: Mapped[date] = mapped_column(Date)
    identificacion: Mapped[str] = mapped_column(String(50), default="")
    pagado_a: Mapped[str] = mapped_column(String(200), default="")
    valor: Mapped[float] = mapped_column(Float, default=0)
    valor_letras: Mapped[str] = mapped_column(String(300), default="")
    concepto: Mapped[str] = mapped_column(Text, default="")
    numero_factura: Mapped[str] = mapped_column(String(100), default="")
    anexo: Mapped[int] = mapped_column(Integer, default=0)                 # "VER ANEXO" en la firma
    autorizado_por: Mapped[str] = mapped_column(String(150), default="")   # quien firma "Aprobado por"
    autorizado_por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True, index=True)
    firma_email: Mapped[str | None] = mapped_column(String(150), nullable=True)  # correo Zoho con el que firmó
    firmado_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)  # UTC
    aviso_ok: Mapped[int | None] = mapped_column(Integer, nullable=True)       # último aviso por Cliq: 1 enviado, 0 falló
    aviso_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    estado: Mapped[str] = mapped_column(String(20), default="ACTIVO")      # ACTIVO | LEGALIZADO | ANULADO
    fm_id: Mapped[int | None] = mapped_column(ForeignKey("caja_menor_fms.id"), nullable=True, index=True)
    creado_por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    creado_por_texto: Mapped[str] = mapped_column(String(150), default="")
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    editado_por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    editado_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    anulado_por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    anulado_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    motivo_anulacion: Mapped[str | None] = mapped_column(Text, nullable=True)

    caja = relationship("CajaMenor")
    fm = relationship("CajaFM", back_populates="recibos")
    creado_por = relationship("Empleado", foreign_keys=[creado_por_id])
    anulado_por = relationship("Empleado", foreign_keys=[anulado_por_id])


class CajaArqueo(Base):
    """Arqueo rápido: fondo = efectivo contado + recibos pendientes (activos)."""
    __tablename__ = "caja_menor_arqueos"
    __table_args__ = (UniqueConstraint("caja_id", "consecutivo", name="uq_caja_arqueo_consecutivo"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    caja_id: Mapped[int] = mapped_column(ForeignKey("caja_menor_cajas.id"), index=True)
    consecutivo: Mapped[int] = mapped_column(Integer)                      # ARQ-<consecutivo>
    fecha: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    responsable: Mapped[str] = mapped_column(String(150), default="")
    fondo: Mapped[float] = mapped_column(Float, default=0)
    recibos_pendientes: Mapped[float] = mapped_column(Float, default=0)
    efectivo_contado: Mapped[float] = mapped_column(Float, default=0)
    estado: Mapped[str] = mapped_column(String(20), default="CUADRADO")    # CUADRADO | FALTANTE | SOBRANTE
    diferencia: Mapped[float] = mapped_column(Float, default=0)
    desglose: Mapped[str] = mapped_column(Text, default="{}")
    creado_por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    creado_por_texto: Mapped[str] = mapped_column(String(150), default="")

    caja = relationship("CajaMenor")
    creado_por = relationship("Empleado", foreign_keys=[creado_por_id])


class CajaObservacion(Base):
    """Observación de quien debe firmar (recibo o FM): pide una corrección antes de firmar.
    Queda atendida cuando el responsable corrige el documento o cuando el firmante firma."""
    __tablename__ = "caja_menor_observaciones"

    id: Mapped[int] = mapped_column(primary_key=True)
    recibo_id: Mapped[int | None] = mapped_column(ForeignKey("caja_menor_recibos.id"), nullable=True, index=True)
    fm_id: Mapped[int | None] = mapped_column(ForeignKey("caja_menor_fms.id"), nullable=True, index=True)
    autor_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"))
    texto: Mapped[str] = mapped_column(Text)
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    atendida_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    atendida_por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)

    autor = relationship("Empleado", foreign_keys=[autor_id])
    atendida_por = relationship("Empleado", foreign_keys=[atendida_por_id])
    recibo = relationship("CajaRecibo", backref=backref("observaciones", lazy="selectin", order_by="CajaObservacion.id"))
    fm = relationship("CajaFM", backref=backref("observaciones", lazy="selectin", order_by="CajaObservacion.id"))
