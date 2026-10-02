from datetime import datetime, date, time
from sqlalchemy import String, Integer, Date, DateTime, Time, ForeignKey, Text, Float, LargeBinary, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .database import Base

MODULOS_DISPONIBLES = [("people", "People"), ("compras", "Compras"), ("sst", "SST"), ("custodia", "Producción (Cambio de custodia)"),
                       ("design_schedule", "Design Schedule"), ("caja_menor", "Caja menor Nuvia")]
MODULOS_VALIDOS = {m for m, _ in MODULOS_DISPONIBLES}


class Empleado(Base):
    __tablename__ = "empleados"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombres: Mapped[str] = mapped_column(String(100))
    apellidos: Mapped[str] = mapped_column(String(100))
    fecha_nacimiento: Mapped[date | None] = mapped_column(Date, nullable=True)
    fecha_inicio_empresa: Mapped[date | None] = mapped_column(Date, nullable=True)
    empresa: Mapped[str] = mapped_column(String(100))
    cargo: Mapped[str] = mapped_column(String(100))
    area: Mapped[str] = mapped_column(String(100))
    identificacion: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    email: Mapped[str] = mapped_column(String(150), unique=True, index=True)
    num_aprobaciones: Mapped[int] = mapped_column(Integer, default=1)  # 1 o 2
    rol: Mapped[str] = mapped_column(String(20), default="empleado")  # empleado | aprobador | admin | superadmin
    activo: Mapped[int] = mapped_column(Integer, default=1)
    dias_vacaciones: Mapped[float] = mapped_column(Float, default=0)  # saldo acumulado disponible
    modulos: Mapped[str] = mapped_column(String(100), default="people")  # slugs separados por coma
    area_custodia: Mapped[str] = mapped_column(String(100), default="")  # áreas de Producción (máx. 2, separadas por coma)
    salario: Mapped[float | None] = mapped_column(Float, nullable=True, default=None)

    aprobador1_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    aprobador2_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)

    aprobador1 = relationship("Empleado", remote_side=[id], foreign_keys=[aprobador1_id])
    aprobador2 = relationship("Empleado", remote_side=[id], foreign_keys=[aprobador2_id])

    @property
    def nombre_completo(self):
        return f"{self.nombres} {self.apellidos}"

    @property
    def areas_custodia(self) -> list[str]:
        """Áreas de Producción asignadas (máx. 2), en mayúscula. La primera es la principal (área de salida por defecto)."""
        return [a.strip().upper() for a in (self.area_custodia or "").split(",") if a.strip()][:2]

    def tiene_area(self, area: str | None) -> bool:
        return bool(area) and area.strip().upper() in self.areas_custodia

    @property
    def modulos_lista(self) -> list[str]:
        return [m for m in (self.modulos or "").split(",") if m]

    def tiene_modulo(self, modulo: str) -> bool:
        return self.rol in ("admin", "superadmin") or modulo in self.modulos_lista

    @property
    def es_superadmin(self) -> bool:
        return self.rol == "superadmin"


class TipoPermiso(Base):
    __tablename__ = "tipos_permiso"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(100), unique=True)
    dias_anuales: Mapped[float | None] = mapped_column(Float, nullable=True)  # None = sin límite
    activo: Mapped[int] = mapped_column(Integer, default=1)
    es_vacaciones: Mapped[int] = mapped_column(Integer, default=0)  # usa el saldo acumulado del empleado
    permite_horas: Mapped[int] = mapped_column(Integer, default=1)  # permite solicitar por horas si es el mismo día
    requiere_soporte: Mapped[int] = mapped_column(Integer, default=0)  # necesita adjuntar un documento que valide People


class Empresa(Base):
    __tablename__ = "empresas"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(150), unique=True)
    activo: Mapped[int] = mapped_column(Integer, default=1)


class Area(Base):
    __tablename__ = "areas"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(150), unique=True)
    activo: Mapped[int] = mapped_column(Integer, default=1)


class Configuracion(Base):
    __tablename__ = "configuracion"

    id: Mapped[int] = mapped_column(primary_key=True)
    sabado_habil: Mapped[int] = mapped_column(Integer, default=0)  # 0 = sábado no es día hábil (default)


class Solicitud(Base):
    __tablename__ = "solicitudes"

    id: Mapped[int] = mapped_column(primary_key=True)
    empleado_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"))
    tipo_id: Mapped[int] = mapped_column(ForeignKey("tipos_permiso.id"))
    fecha_inicio: Mapped[date] = mapped_column(Date)
    fecha_fin: Mapped[date] = mapped_column(Date)
    dias: Mapped[float] = mapped_column(Float)
    motivo: Mapped[str] = mapped_column(Text, default="")
    hora_inicio: Mapped[time | None] = mapped_column(Time, nullable=True)
    hora_fin: Mapped[time | None] = mapped_column(Time, nullable=True)
    # pendiente_1 | pendiente_2 | pendiente_soporte | aprobada | rechazada | cancelada
    estado: Mapped[str] = mapped_column(String(20), default="pendiente_1", index=True)
    creada_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Soporte documental (incapacidad, certificado de defunción, etc.) para los tipos que lo requieren
    # (TipoPermiso.requiere_soporte): se puede anexar en cualquier momento, independiente de si el jefe
    # ya decidió; la solicitud no queda "aprobada" hasta que el jefe apruebe Y People valide el soporte.
    soporte_nombre: Mapped[str] = mapped_column(String(200), default="")
    soporte_tipo_mime: Mapped[str] = mapped_column(String(80), default="")
    soporte_tamano: Mapped[int] = mapped_column(Integer, default=0)
    soporte_datos: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True, deferred=True)
    soporte_subido_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    soporte_decision: Mapped[str] = mapped_column(String(20), default="pendiente")  # pendiente | aprobado | rechazado
    soporte_decidido_por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    soporte_decidido_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    soporte_comentario: Mapped[str] = mapped_column(Text, default="")

    empleado = relationship("Empleado", foreign_keys=[empleado_id])
    tipo = relationship("TipoPermiso")
    aprobaciones = relationship("Aprobacion", back_populates="solicitud", order_by="Aprobacion.nivel")
    soporte_decidido_por = relationship("Empleado", foreign_keys=[soporte_decidido_por_id])

    ESTADOS = {
        "pendiente_1": "Pendiente 1ª aprobación",
        "pendiente_2": "Pendiente 2ª aprobación",
        "pendiente_soporte": "Pendiente de soporte (People)",
        "aprobada": "Aprobada",
        "rechazada": "Rechazada",
        "cancelada": "Cancelada",
    }

    @property
    def estado_texto(self):
        return self.ESTADOS.get(self.estado, self.estado)

    @property
    def consecutivo(self) -> str:
        return f"PER-{self.id:04d}"

    @property
    def requiere_soporte(self) -> bool:
        return bool(self.tipo.requiere_soporte)

    @property
    def soporte_pendiente_subir(self) -> bool:
        return self.requiere_soporte and not self.soporte_subido_en and self.estado not in ("rechazada", "cancelada")

    @property
    def soporte_pendiente_revisar(self) -> bool:
        return self.requiere_soporte and bool(self.soporte_subido_en) and self.soporte_decision == "pendiente"


class Aprobacion(Base):
    __tablename__ = "aprobaciones"
    __table_args__ = (UniqueConstraint("solicitud_id", "nivel"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    solicitud_id: Mapped[int] = mapped_column(ForeignKey("solicitudes.id"))
    aprobador_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"))
    nivel: Mapped[int] = mapped_column(Integer)  # 1 o 2
    decision: Mapped[str] = mapped_column(String(20), default="pendiente")  # pendiente | aprobada | rechazada
    comentario: Mapped[str] = mapped_column(Text, default="")
    decidida_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    solicitud = relationship("Solicitud", back_populates="aprobaciones")
    aprobador = relationship("Empleado", foreign_keys=[aprobador_id])


class HoraExtra(Base):
    __tablename__ = "horas_extra"

    id: Mapped[int] = mapped_column(primary_key=True)
    empleado_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"))
    solicitante_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"))
    fecha: Mapped[date] = mapped_column(Date)
    horas: Mapped[float] = mapped_column(Float)
    motivo: Mapped[str] = mapped_column(Text, default="")
    # pendiente | aprobada | rechazada
    estado: Mapped[str] = mapped_column(String(20), default="pendiente", index=True)
    creada_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    decidida_por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    decidida_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    comentario: Mapped[str] = mapped_column(Text, default="")

    empleado = relationship("Empleado", foreign_keys=[empleado_id])
    solicitante = relationship("Empleado", foreign_keys=[solicitante_id])
    decidida_por = relationship("Empleado", foreign_keys=[decidida_por_id])

    ESTADOS = {"pendiente": "Pendiente", "aprobada": "Aprobada", "rechazada": "Rechazada"}

    @property
    def consecutivo(self) -> str:
        return f"HE-{self.id:04d}"

    @property
    def estado_texto(self):
        return self.ESTADOS.get(self.estado, self.estado)


class Auditoria(Base):
    __tablename__ = "auditoria"

    id: Mapped[int] = mapped_column(primary_key=True)
    solicitud_id: Mapped[int | None] = mapped_column(ForeignKey("solicitudes.id"), nullable=True)
    empleado_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    actor: Mapped[str] = mapped_column(String(150))
    accion: Mapped[str] = mapped_column(String(200))
    detalle: Mapped[str] = mapped_column(Text, default="")
    fecha: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    empleado = relationship("Empleado", foreign_keys=[empleado_id])
