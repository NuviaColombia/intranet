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
    dias_alerta: Mapped[int] = mapped_column(Integer, default=0)          # alerta si un frasco lleva más días abierto (0 = sin alerta)
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
    prueba: Mapped[int] = mapped_column(Integer, default=0)               # 1 = hecha en modo pruebas (no cuenta en lo real)
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
    tecnico_actual_id: Mapped[int | None] = mapped_column(ForeignKey("consumo_tecnicos.id"), nullable=True)  # si se trasladó

    entrega = relationship("ConsumoEntrega", back_populates="frascos")
    tecnico_actual = relationship("ConsumoTecnico", foreign_keys=[tecnico_actual_id])
    traslados = relationship("ConsumoTraslado", order_by="ConsumoTraslado.id", back_populates="frasco")

    @property
    def tecnico_id_actual(self) -> int:
        """Quién tiene hoy el frasco: el de la entrega, o a quien se le trasladó."""
        return self.tecnico_actual_id or self.entrega.tecnico_id

    @property
    def tecnico_vigente(self):
        return self.tecnico_actual if self.tecnico_actual_id else self.entrega.tecnico
    materia = relationship("ConsumoMateria")
    # registros: todos (también los anulados, para el historial); jornadas: solo los vigentes (acumulados y reportes)
    registros = relationship("ConsumoJornada", back_populates="frasco", order_by="ConsumoJornada.registrado_en")
    jornadas = relationship("ConsumoJornada", viewonly=True, order_by="ConsumoJornada.fecha",
                            primaryjoin="and_(ConsumoFrasco.id == ConsumoJornada.frasco_id, ConsumoJornada.estado != 'ANULADO')")


class ConsumoJornada(Base):
    """Registro de la jornada de un frasco: arcos por tipo (JSON {tipo_id: cantidad}) y gotas usadas.
    Puede haber varios por frasco y día. Quien lo guarda no lo modifica: para corregir, el técnico solicita
    la anulación (con observación) y el manager del área la aprueba o la rechaza."""
    __tablename__ = "consumo_jornadas"

    id: Mapped[int] = mapped_column(primary_key=True)
    frasco_id: Mapped[int] = mapped_column(ForeignKey("consumo_frascos.id"), index=True)
    fecha: Mapped[date] = mapped_column(Date, index=True)
    tecnico_id: Mapped[int | None] = mapped_column(ForeignKey("consumo_tecnicos.id"), nullable=True)  # quién produjo
    arcos: Mapped[str] = mapped_column(Text, default="{}")
    total: Mapped[float] = mapped_column(Float, default=0)
    gotas: Mapped[float] = mapped_column(Float, default=0)                # materias que se miden por gotas usadas en el día
    consumido: Mapped[int] = mapped_column(Integer, default=0)            # este registro marcó el frasco como consumido
    observacion: Mapped[str] = mapped_column(Text, default="")
    estado: Mapped[str] = mapped_column(String(20), default="ACTIVO")     # ACTIVO | SOLICITADA (anulación) | ANULADO
    registrado_por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    registrado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    solicitud_motivo: Mapped[str | None] = mapped_column(Text, nullable=True)
    solicitado_por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    solicitado_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    respuesta: Mapped[str | None] = mapped_column(Text, nullable=True)   # por qué el manager rechazó la solicitud
    anulado_por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    anulado_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    motivo_anulacion: Mapped[str | None] = mapped_column(Text, nullable=True)

    frasco = relationship("ConsumoFrasco", back_populates="registros")
    tecnico = relationship("ConsumoTecnico", foreign_keys=[tecnico_id])
    registrado_por = relationship("Empleado", foreign_keys=[registrado_por_id])
    solicitado_por = relationship("Empleado", foreign_keys=[solicitado_por_id])
    anulado_por = relationship("Empleado", foreign_keys=[anulado_por_id])


class ConsumoTraslado(Base):
    """Traslado de un frasco en uso de un técnico a otro (incapacidad, retiro, cambio de área...)."""
    __tablename__ = "consumo_traslados"

    id: Mapped[int] = mapped_column(primary_key=True)
    frasco_id: Mapped[int] = mapped_column(ForeignKey("consumo_frascos.id"), index=True)
    de_tecnico_id: Mapped[int] = mapped_column(ForeignKey("consumo_tecnicos.id"))
    a_tecnico_id: Mapped[int] = mapped_column(ForeignKey("consumo_tecnicos.id"))
    motivo: Mapped[str] = mapped_column(Text, default="")
    por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    frasco = relationship("ConsumoFrasco", back_populates="traslados")
    de_tecnico = relationship("ConsumoTecnico", foreign_keys=[de_tecnico_id])
    a_tecnico = relationship("ConsumoTecnico", foreign_keys=[a_tecnico_id])
    por = relationship("Empleado")


class ConsumoApertura(Base):
    """Solicitud de un técnico para registrar la jornada de un día anterior; el manager del área abre (o no) ese día.
    Un día aprobado queda abierto para ese técnico hasta el final del día en que se aprobó."""
    __tablename__ = "consumo_aperturas"

    id: Mapped[int] = mapped_column(primary_key=True)
    tecnico_id: Mapped[int] = mapped_column(ForeignKey("consumo_tecnicos.id"), index=True)
    fecha: Mapped[date] = mapped_column(Date)                              # día que se quiere registrar
    motivo: Mapped[str] = mapped_column(Text, default="")
    estado: Mapped[str] = mapped_column(String(20), default="SOLICITADA")  # SOLICITADA | APROBADA | RECHAZADA
    prueba: Mapped[int] = mapped_column(Integer, default=0)
    solicitado_por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    solicitado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    resuelto_por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    resuelto_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    respuesta: Mapped[str | None] = mapped_column(Text, nullable=True)
    abierto_hasta: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)  # UTC

    tecnico = relationship("ConsumoTecnico")
    solicitado_por = relationship("Empleado", foreign_keys=[solicitado_por_id])
    resuelto_por = relationship("Empleado", foreign_keys=[resuelto_por_id])

