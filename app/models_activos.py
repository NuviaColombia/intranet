"""Módulo Activos › Design: inventario de hardware de TI (equipos, dongles ExoCAD, mantenimientos,
grupos de trabajo, actas de entrega). Migrado desde un proyecto aparte (FastAPI + SQLite crudo, sin
ORM) hacia esta plataforma -- ver docs/wiki/activos.md para las reglas de negocio y las decisiones
de la migración (qué se dejó igual y qué se simplificó a propósito).

Los "usuarios" del inventario original se unifican aquí con `Empleado` (ActivosPerfil es una
extensión 1:1, no una tabla de personas aparte): el nombre y el correo son siempre los de Empleado;
ActivosPerfil solo guarda lo que es propio del inventario (JumpCloud, grupo de trabajo, avatar,
alta/baja como custodio de hardware -- independiente de si la persona sigue activa en People)."""
from datetime import datetime, date
from sqlalchemy import String, Integer, Date, DateTime, Float, ForeignKey, Text, Boolean, CheckConstraint, UniqueConstraint, Index
from sqlalchemy.orm import Mapped, mapped_column
from .database import Base


class ActivosArea(Base):
    """Jerarquía de 2 niveles (área principal -> departamento) vía id_area_padre. Nunca más de 2
    niveles: un área que ya tiene departamentos propios no puede convertirse en departamento de otra
    (se valida en services_activos, no aquí)."""
    __tablename__ = "activos_areas"

    id_area: Mapped[int] = mapped_column(primary_key=True)
    nombre_area: Mapped[str] = mapped_column(String(150), unique=True)
    aplica_software_diseno: Mapped[bool] = mapped_column(Boolean, default=False)
    requiere_exocad: Mapped[bool] = mapped_column(Boolean, default=False)   # departamentos que deben tener dongle
    id_area_padre: Mapped[int | None] = mapped_column(ForeignKey("activos_areas.id_area"), nullable=True)


class ActivosPerfil(Base):
    """Extensión de Empleado para quienes son custodios de hardware. No todo Empleado tiene fila
    aquí -- solo se crea para quien de verdad aparece en el inventario. `retirado` es el alta/baja
    como custodio de hardware, una acción propia de Activos (no se dispara solo al desactivar a
    alguien en People)."""
    __tablename__ = "activos_perfiles"

    empleado_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"), primary_key=True)
    jumpcloud_username: Mapped[str | None] = mapped_column(String(150), nullable=True)
    id_area_id: Mapped[int | None] = mapped_column(ForeignKey("activos_areas.id_area"), nullable=True)
    id_lider_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True, index=True)  # líder del grupo de trabajo
    personaje: Mapped[str | None] = mapped_column(String(1), nullable=True)  # M | F | N (avatar)
    personaje_variante: Mapped[int] = mapped_column(Integer, default=0)
    personaje_piel: Mapped[int | None] = mapped_column(Integer, nullable=True)
    retirado: Mapped[bool] = mapped_column(Boolean, default=False)
    fecha_retiro: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    motivo_retiro: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        CheckConstraint("personaje IN ('M','F','N')", name="ck_activos_perfil_personaje"),
        CheckConstraint("personaje_variante BETWEEN 0 AND 99", name="ck_activos_perfil_variante"),
        CheckConstraint("personaje_piel IS NULL OR personaje_piel BETWEEN 0 AND 5", name="ck_activos_perfil_piel"),
    )


class ActivosEquipo(Base):
    """asset_tag es una clave natural (texto), no autoincremental -- así se identifican en etiquetas
    físicas y en las actas de entrega."""
    __tablename__ = "activos_equipos"

    asset_tag: Mapped[str] = mapped_column(String(40), primary_key=True)
    serial_number: Mapped[str] = mapped_column(String(100), unique=True)
    tipo_equipo: Mapped[str] = mapped_column(String(20))         # Laptop | Mini PC | Maquinaria | Equipos de oficina | Otros
    marca: Mapped[str | None] = mapped_column(String(80), nullable=True)
    modelo_referencia: Mapped[str | None] = mapped_column(String(120), nullable=True)
    sistema_operativo: Mapped[str | None] = mapped_column(String(80), nullable=True)
    version_exocad_instalada: Mapped[str] = mapped_column(String(40), default="N/A")
    estado: Mapped[str] = mapped_column(String(20), default="STOCK")   # EN USO | STOCK | MANTENIMIENTO
    fecha_ingreso: Mapped[date] = mapped_column(Date, default=date.today)
    empleado_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True, index=True)  # custodio actual
    observaciones: Mapped[str | None] = mapped_column(Text, nullable=True)
    retirado: Mapped[bool] = mapped_column(Boolean, default=False)
    fecha_retiro: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    motivo_retiro: Mapped[str | None] = mapped_column(Text, nullable=True)
    procesador: Mapped[str | None] = mapped_column(String(120), nullable=True)
    memoria_ram: Mapped[str | None] = mapped_column(String(40), nullable=True)
    almacenamiento: Mapped[str | None] = mapped_column(String(40), nullable=True)
    # Si no aplica, el equipo siempre queda en situación de dongle "NO_APLICA" sin importar el área de
    # su dueño (pedido por Oscar el 27-oct-2026, junto con los tipos Maquinaria/Equipos de oficina/Otros
    # -- esos tipos normalmente no necesitan licencia ExoCAD).
    aplica_dongle: Mapped[bool] = mapped_column(Boolean, default=True)

    __table_args__ = (
        CheckConstraint("tipo_equipo IN ('Laptop','Mini PC','Maquinaria','Equipos de oficina','Otros')", name="ck_activos_equipo_tipo"),
        CheckConstraint("estado IN ('EN USO','STOCK','MANTENIMIENTO')", name="ck_activos_equipo_estado"),
        Index("ix_activos_equipos_retirado", "retirado", "asset_tag"),
    )


class ActivosDongle(Base):
    """Licencia física ExoCAD. Máximo un dongle activo por equipo (UNIQUE en asset_tag_asignado;
    la regla de "no asignar un segundo dongle al mismo equipo" también se valida en el servicio para
    dar un mensaje claro antes de chocar con la restricción)."""
    __tablename__ = "activos_dongles"

    id_dongle: Mapped[int] = mapped_column(primary_key=True)
    numero_dongle: Mapped[str] = mapped_column(String(60), unique=True)
    version_exocad_compatible: Mapped[str] = mapped_column(String(40), default="N/A")
    asset_tag_asignado: Mapped[str | None] = mapped_column(ForeignKey("activos_equipos.asset_tag"), nullable=True, unique=True)
    estado_dongle: Mapped[str] = mapped_column(String(20), default="DISPONIBLE")  # EN USO | DISPONIBLE | MANTENIMIENTO
    serial_number: Mapped[str | None] = mapped_column(String(100), nullable=True, unique=True)  # None (nunca '') si no hay dato
    modulos: Mapped[str | None] = mapped_column(Text, nullable=True)   # texto libre, no es una lista estructurada

    __table_args__ = (
        CheckConstraint("estado_dongle IN ('EN USO','DISPONIBLE','MANTENIMIENTO')", name="ck_activos_dongle_estado"),
    )


class ActivosHistorialAsignacion(Base):
    """Único lugar donde queda registro de quién tuvo cada equipo/dongle y cuándo. fecha_fin NULL =
    periodo todavía abierto (asignación vigente)."""
    __tablename__ = "activos_historial_asignaciones"

    id_asignacion: Mapped[int] = mapped_column(primary_key=True)
    tipo_activo: Mapped[str] = mapped_column(String(10))   # EQUIPO | DONGLE
    asset_tag: Mapped[str | None] = mapped_column(ForeignKey("activos_equipos.asset_tag"), nullable=True)
    id_dongle: Mapped[int | None] = mapped_column(ForeignKey("activos_dongles.id_dongle"), nullable=True)
    empleado_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    fecha_inicio: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    fecha_fin: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    motivo: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        CheckConstraint("tipo_activo IN ('EQUIPO','DONGLE')", name="ck_activos_historial_tipo"),
        CheckConstraint("asset_tag IS NOT NULL OR id_dongle IS NOT NULL", name="ck_activos_historial_activo"),
        Index("ix_activos_historial_equipo_abierta", "tipo_activo", "asset_tag", "fecha_fin"),
        Index("ix_activos_historial_dongle", "id_dongle"),
    )


class ActivosJornadaMantenimiento(Base):
    """Solicitud de mantenimiento programada para un grupo de trabajo completo. Sin columna
    `estado`: anulada/cerrada/vencida/abierta se calculan en Python a partir de fecha_anulacion y de
    si quedan mantenimientos PROGRAMADO/EN_PROCESO (igual que el sistema original).
    id_jornada_origen encadena una jornada recurrente con la que la generó automáticamente."""
    __tablename__ = "activos_jornadas_mantenimiento"

    id_jornada: Mapped[int] = mapped_column(primary_key=True)
    id_lider_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"), index=True)
    tipo_mantenimiento: Mapped[str] = mapped_column(String(20))   # PREVENTIVO | CORRECTIVO
    fecha_programada: Mapped[date] = mapped_column(Date)
    responsable: Mapped[str] = mapped_column(String(150))
    descripcion: Mapped[str] = mapped_column(Text, default="")
    id_jornada_origen: Mapped[int | None] = mapped_column(ForeignKey("activos_jornadas_mantenimiento.id_jornada"), nullable=True, unique=True)
    fecha_creacion: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    frecuencia_meses: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fecha_anulacion: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    motivo_anulacion: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        CheckConstraint("tipo_mantenimiento IN ('PREVENTIVO','CORRECTIVO')", name="ck_activos_jornada_tipo"),
        CheckConstraint("frecuencia_meses IS NULL OR frecuencia_meses BETWEEN 1 AND 24", name="ck_activos_jornada_frecuencia"),
    )


class ActivosMantenimiento(Base):
    """Servicio técnico de un equipo (individual, o como parte de una jornada de grupo).
    PREVENTIVO nunca mueve el equipo de estado/usuario; solo CORRECTIVO lo hace, y solo vuelve a
    stock al completar si se pide explícitamente (ver services_activos_mantenimiento)."""
    __tablename__ = "activos_mantenimientos"

    id_mantenimiento: Mapped[int] = mapped_column(primary_key=True)
    asset_tag: Mapped[str] = mapped_column(ForeignKey("activos_equipos.asset_tag", ondelete="RESTRICT"))
    tipo_mantenimiento: Mapped[str] = mapped_column(String(20))
    estado_mantenimiento: Mapped[str] = mapped_column(String(20))   # PROGRAMADO | EN_PROCESO | COMPLETADO | CANCELADO
    fecha_programada: Mapped[date] = mapped_column(Date)
    fecha_realizada: Mapped[date | None] = mapped_column(Date, nullable=True)
    descripcion_falla: Mapped[str] = mapped_column(Text, default="")
    acciones_realizadas: Mapped[str] = mapped_column(Text, default="")
    costo: Mapped[float] = mapped_column(Float, default=0)
    responsable: Mapped[str] = mapped_column(String(150), default="")
    id_jornada: Mapped[int | None] = mapped_column(ForeignKey("activos_jornadas_mantenimiento.id_jornada"), nullable=True, index=True)

    __table_args__ = (
        CheckConstraint("tipo_mantenimiento IN ('PREVENTIVO','CORRECTIVO')", name="ck_activos_mant_tipo"),
        CheckConstraint("estado_mantenimiento IN ('PROGRAMADO','EN_PROCESO','COMPLETADO','CANCELADO')", name="ck_activos_mant_estado"),
        CheckConstraint("costo >= 0", name="ck_activos_mant_costo"),
        Index("ix_activos_mant_equipo_fecha", "asset_tag", "fecha_programada"),
        Index("ix_activos_mant_estado_fecha", "estado_mantenimiento", "fecha_programada"),
    )


class ActivosActaEntrega(Base):
    """Acta digital de entrega (firma dibujada, PNG en data URI). Se archiva validando en el
    momento que la asignación equipo-persona siga vigente (protección contra condiciones de carrera
    si el equipo se reasignó mientras se llenaba el formulario)."""
    __tablename__ = "activos_actas_entrega"

    id_acta: Mapped[int] = mapped_column(primary_key=True)
    asset_tag: Mapped[str] = mapped_column(ForeignKey("activos_equipos.asset_tag", ondelete="RESTRICT"))
    empleado_id: Mapped[int] = mapped_column(ForeignKey("empleados.id", ondelete="RESTRICT"))
    fecha: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    tipo_acta: Mapped[str] = mapped_column(String(20), default="ENTREGA")   # ENTREGA | DEVOLUCION
    firma_base64: Mapped[str] = mapped_column(Text)   # data:image/png;base64,....
    observaciones: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        CheckConstraint("tipo_acta IN ('ENTREGA','DEVOLUCION')", name="ck_activos_acta_tipo"),
        Index("ix_activos_actas_empleado_fecha", "empleado_id", "fecha"),
    )


class ActivosAuditoria(Base):
    """Registro simple de quién hizo qué y cuándo. Reemplaza el "respaldo completo restaurable" del
    sistema original: Activos comparte la misma base Postgres que el resto de la plataforma, así que
    no tiene sentido (ni es seguro) poder restaurar solo sus tablas a un punto anterior -- la
    recuperación ante desastres queda a nivel de los respaldos de la base de datos (Supabase), no
    por módulo."""
    __tablename__ = "activos_auditoria"

    id: Mapped[int] = mapped_column(primary_key=True)
    accion: Mapped[str] = mapped_column(String(100))
    descripcion: Mapped[str] = mapped_column(Text)
    empleado_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    fecha: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class ActivosSolicitudMantenimiento(Base):
    """Un manager de equipo (líder de grupo) pide mantenimiento para un equipo de su grupo; un
    aprobador (hoy, Yostin) la acepta y hace el trabajo; el propio manager confirma al final que
    quedó bien. No es el mismo flujo que "Servicio individual"/"Programar por grupo" (pensado para
    quien ya tiene acceso completo a Activos) -- ver docs/wiki/activos.md.

    Cada transición reutiliza las funciones ya existentes de mantenimientos/equipos (ver
    services_activos_solicitudes.py); `id_mantenimiento` es el servicio técnico real que se crea al
    aceptar, para que quede en el mismo historial que el resto de mantenimientos."""
    __tablename__ = "activos_solicitudes_mantenimiento"

    id: Mapped[int] = mapped_column(primary_key=True)
    asset_tag: Mapped[str] = mapped_column(ForeignKey("activos_equipos.asset_tag", ondelete="RESTRICT"))
    solicitado_por_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"))
    empleado_original_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    descripcion: Mapped[str] = mapped_column(Text)
    estado: Mapped[str] = mapped_column(String(20), default="SOLICITADO")
    id_mantenimiento: Mapped[int | None] = mapped_column(ForeignKey("activos_mantenimientos.id_mantenimiento"), nullable=True)
    fecha_solicitud: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    aceptado_por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    fecha_aceptado: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    notas_realizado: Mapped[str | None] = mapped_column(Text, nullable=True)
    fecha_realizado: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    fecha_confirmado: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    motivo_rechazo: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        CheckConstraint("estado IN ('SOLICITADO','ACEPTADO','REALIZADO','CONFIRMADO','RECHAZADO')",
                        name="ck_activos_solicitud_estado"),
        Index("ix_activos_solicitud_asset_tag", "asset_tag"),
        Index("ix_activos_solicitud_solicitante", "solicitado_por_id"),
    )
