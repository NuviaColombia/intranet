"""Módulo Design Schedule: horario de producción del equipo de diseño (N3, N6, Face, N2, Support).

Puerto de una herramienta previa en HTML/localStorage sin backend real ni cuentas de usuario
(una sola contraseña compartida). Aquí cada equipo/orden queda en base de datos real y las
acciones quedan asociadas al usuario que las hizo (login con Zoho ya existente en la app).
"""
from datetime import date, datetime
from sqlalchemy import String, Integer, Date, DateTime, Float, ForeignKey, Text, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .database import Base

# Formatos de tabla de órdenes por área (definen qué campos aplican).
FORMATO_DUAL = "dual"        # N3 / N6: dos tablas (Cirugías + Nightguards)
FORMATO_SINGLE = "single"    # Face Design: una tabla estilo "Cirugías"
FORMATO_N2 = "n2"            # N2 Demodenture: una tabla con S.Hold/F.Hold
FORMATO_SUPPORT = "support"  # Support: ticket de soporte, sin horas/QC


class DesignArea(Base):
    __tablename__ = "design_areas"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(100), unique=True)
    formato: Mapped[str] = mapped_column(String(20))
    orden: Mapped[int] = mapped_column(Integer, default=0)
    activo: Mapped[int] = mapped_column(Integer, default=1)

    teams = relationship("DesignTeam", back_populates="area")


class DesignTeam(Base):
    __tablename__ = "design_teams"

    id: Mapped[int] = mapped_column(primary_key=True)
    area_id: Mapped[int] = mapped_column(ForeignKey("design_areas.id"))
    nombre: Mapped[str] = mapped_column(String(150))
    manager_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    orden: Mapped[int] = mapped_column(Integer, default=0)
    activo: Mapped[int] = mapped_column(Integer, default=1)

    area = relationship("DesignArea", back_populates="teams")
    manager = relationship("Empleado", foreign_keys=[manager_id])
    designers = relationship("DesignTeamDesigner", back_populates="team",
                             order_by="DesignTeamDesigner.orden", cascade="all, delete-orphan")


class DesignTeamDesigner(Base):
    """Diseñadores asignados a un equipo (empleados reales de Nuvia Design)."""
    __tablename__ = "design_team_designers"

    id: Mapped[int] = mapped_column(primary_key=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("design_teams.id"))
    empleado_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"))
    orden: Mapped[int] = mapped_column(Integer, default=0)

    team = relationship("DesignTeam", back_populates="designers")
    empleado = relationship("Empleado")


class DesignCatalogo(Base):
    """Centros, productos y estados disponibles por área (editables desde Parámetros)."""
    __tablename__ = "design_catalogos"

    id: Mapped[int] = mapped_column(primary_key=True)
    area_id: Mapped[int] = mapped_column(ForeignKey("design_areas.id"))
    tipo: Mapped[str] = mapped_column(String(20))  # centro | producto | estado
    valor: Mapped[str] = mapped_column(String(150))
    orden: Mapped[int] = mapped_column(Integer, default=0)
    activo: Mapped[int] = mapped_column(Integer, default=1)

    area = relationship("DesignArea")


class DesignAusenciaTipo(Base):
    """Catálogo compartido de tipos de ausencia (Vacaciones, Incapacidad, etc.) para Tiempos libres."""
    __tablename__ = "design_ausencia_tipos"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(100), unique=True)
    orden: Mapped[int] = mapped_column(Integer, default=0)
    activo: Mapped[int] = mapped_column(Integer, default=1)


class DesignOrden(Base):
    """Una orden/caso dentro del horario de un equipo, en un día puntual."""
    __tablename__ = "design_ordenes"

    id: Mapped[int] = mapped_column(primary_key=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("design_teams.id"))
    fecha: Mapped[date] = mapped_column(Date)
    tabla: Mapped[str] = mapped_column(String(20), default="principal")  # principal | nightguard

    orden: Mapped[str] = mapped_column(String(50), default="")
    paciente: Mapped[str] = mapped_column(String(150), default="")
    centro: Mapped[str] = mapped_column(String(150), default="")
    producto: Mapped[str] = mapped_column(String(150), default="")
    designer_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    designer_prestado: Mapped[str] = mapped_column(String(150), default="")  # nombre libre, diseñador de otro equipo

    hora_inicio: Mapped[str] = mapped_column(String(10), default="")
    hora_inicio_diseno: Mapped[str] = mapped_column(String(10), default="")
    hora_fin: Mapped[str] = mapped_column(String(10), default="")
    hold_minutos: Mapped[float] = mapped_column(Float, default=0)

    esferas: Mapped[str] = mapped_column(String(20), default="")    # N3
    critico: Mapped[str] = mapped_column(String(50), default="")    # N3

    s_hold: Mapped[str] = mapped_column(String(10), default="")     # N2
    f_hold: Mapped[str] = mapped_column(String(10), default="")     # N2

    etapa: Mapped[str] = mapped_column(String(100), default="")           # Support
    solicitado_por: Mapped[str] = mapped_column(String(150), default="")  # Support
    situacion: Mapped[str] = mapped_column(String(150), default="")       # Support
    solucion: Mapped[str] = mapped_column(Text, default="")               # Support
    clasificacion: Mapped[str] = mapped_column(String(100), default="")   # Support
    soporte: Mapped[str] = mapped_column(String(150), default="")         # Support

    estado: Mapped[str] = mapped_column(String(100), default="")
    qc: Mapped[bool] = mapped_column(Boolean, default=False)
    qc_reporte: Mapped[str] = mapped_column(Text, default="")
    notas: Mapped[str] = mapped_column(Text, default="")

    orden_visual: Mapped[int] = mapped_column(Integer, default=0)

    creado_por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    actualizado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    team = relationship("DesignTeam")
    designer = relationship("Empleado", foreign_keys=[designer_id])
    creado_por = relationship("Empleado", foreign_keys=[creado_por_id])


class DesignBreak(Base):
    """Tiempos libres (almuerzo/descansos/ausencia) de un diseñador en un día puntual."""
    __tablename__ = "design_breaks"

    id: Mapped[int] = mapped_column(primary_key=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("design_teams.id"))
    empleado_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"))
    fecha: Mapped[date] = mapped_column(Date)

    tipo_ausencia: Mapped[str] = mapped_column(String(100), default="")
    almuerzo_inicio: Mapped[str] = mapped_column(String(10), default="")
    almuerzo_fin: Mapped[str] = mapped_column(String(10), default="")
    break1_inicio: Mapped[str] = mapped_column(String(10), default="")
    break1_fin: Mapped[str] = mapped_column(String(10), default="")
    break2_inicio: Mapped[str] = mapped_column(String(10), default="")
    break2_fin: Mapped[str] = mapped_column(String(10), default="")

    team = relationship("DesignTeam")
    empleado = relationship("Empleado")


class DesignComentarioHistorial(Base):
    """Historial del generador de comentarios N3 (se guarda al 'Limpiar'; se purga a los 2 días)."""
    __tablename__ = "design_comentarios_historial"

    id: Mapped[int] = mapped_column(primary_key=True)
    paciente: Mapped[str] = mapped_column(String(150), default="")
    orden: Mapped[str] = mapped_column(String(50), default="")
    campos: Mapped[str] = mapped_column(Text, default="{}")  # JSON de los CMT_FIELDS
    creado_por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    creado_por = relationship("Empleado")


class DesignFaq(Base):
    """Hoja de preguntas frecuentes / cómo proceder (Comments N2 / Face Design)."""
    __tablename__ = "design_faq"

    id: Mapped[int] = mapped_column(primary_key=True)
    area_id: Mapped[int] = mapped_column(ForeignKey("design_areas.id"))
    seccion: Mapped[str] = mapped_column(String(150), default="")
    situacion: Mapped[str] = mapped_column(String(200), default="")
    producto: Mapped[str] = mapped_column(String(150), default="")
    como_proceder: Mapped[str] = mapped_column(Text, default="")
    plantilla: Mapped[str] = mapped_column(Text, default="")
    ejemplos: Mapped[str] = mapped_column(Text, default="")
    orden: Mapped[int] = mapped_column(Integer, default=0)

    area = relationship("DesignArea")
