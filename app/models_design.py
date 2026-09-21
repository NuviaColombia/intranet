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


class DesignPreApprovedSheet(Base):
    """Una hoja de 'cambios pre-aprobados' por doctor, dueña de un diseñador/manager."""
    __tablename__ = "design_preapproved_sheets"

    id: Mapped[int] = mapped_column(primary_key=True)
    area_id: Mapped[int] = mapped_column(ForeignKey("design_areas.id"))
    nombre: Mapped[str] = mapped_column(String(150), default="")
    titulo: Mapped[str] = mapped_column(String(150), default="Pre-approved changes")
    changes_label: Mapped[str] = mapped_column(String(100), default="Changes")
    orden: Mapped[int] = mapped_column(Integer, default=0)

    area = relationship("DesignArea")
    centros = relationship("DesignPreApprovedCentro", back_populates="sheet",
                           order_by="DesignPreApprovedCentro.orden", cascade="all, delete-orphan")
    doctores = relationship("DesignPreApprovedDoctor", back_populates="sheet",
                            order_by="DesignPreApprovedDoctor.orden", cascade="all, delete-orphan")
    filas = relationship("DesignPreApprovedFila", back_populates="sheet",
                         order_by="DesignPreApprovedFila.orden", cascade="all, delete-orphan")


class DesignPreApprovedCentro(Base):
    """Encabezado agrupador de columnas de doctores (con colspan) sobre una hoja."""
    __tablename__ = "design_preapproved_centros"

    id: Mapped[int] = mapped_column(primary_key=True)
    sheet_id: Mapped[int] = mapped_column(ForeignKey("design_preapproved_sheets.id"))
    nombre: Mapped[str] = mapped_column(String(150), default="")
    span: Mapped[int] = mapped_column(Integer, default=1)
    orden: Mapped[int] = mapped_column(Integer, default=0)

    sheet = relationship("DesignPreApprovedSheet", back_populates="centros")


class DesignPreApprovedDoctor(Base):
    __tablename__ = "design_preapproved_doctores"

    id: Mapped[int] = mapped_column(primary_key=True)
    sheet_id: Mapped[int] = mapped_column(ForeignKey("design_preapproved_sheets.id"))
    nombre: Mapped[str] = mapped_column(String(150), default="")
    orden: Mapped[int] = mapped_column(Integer, default=0)

    sheet = relationship("DesignPreApprovedSheet", back_populates="doctores")


class DesignPreApprovedFila(Base):
    """Una fila de criterio (Cantilever, VDO, etc.) dentro de una hoja."""
    __tablename__ = "design_preapproved_filas"

    id: Mapped[int] = mapped_column(primary_key=True)
    sheet_id: Mapped[int] = mapped_column(ForeignKey("design_preapproved_sheets.id"))
    criterio: Mapped[str] = mapped_column(String(150), default="")
    orden: Mapped[int] = mapped_column(Integer, default=0)

    sheet = relationship("DesignPreApprovedSheet", back_populates="filas")
    celdas = relationship("DesignPreApprovedCelda", back_populates="fila", cascade="all, delete-orphan")


class DesignPreApprovedCelda(Base):
    """Valor de una fila×doctor específico."""
    __tablename__ = "design_preapproved_celdas"

    id: Mapped[int] = mapped_column(primary_key=True)
    fila_id: Mapped[int] = mapped_column(ForeignKey("design_preapproved_filas.id"))
    doctor_id: Mapped[int] = mapped_column(ForeignKey("design_preapproved_doctores.id"))
    valor: Mapped[str] = mapped_column(Text, default="")

    fila = relationship("DesignPreApprovedFila", back_populates="celdas")
    doctor = relationship("DesignPreApprovedDoctor")


# ---------------------------------------------------------------------------
# Papelera: registro de borrados en paneles estructurales (Pre-Approved, y lo
# que se sume después: Protocols, Canvas), con snapshot suficiente para
# restaurar. No cubre acciones del día a día (crear/borrar órdenes).
# ---------------------------------------------------------------------------

class DesignTrash(Base):
    __tablename__ = "design_trash"

    id: Mapped[int] = mapped_column(primary_key=True)
    modulo: Mapped[str] = mapped_column(String(30))  # pa-sheet | pa-centro | pa-doctor | pa-fila
    etiqueta: Mapped[str] = mapped_column(String(255))
    payload: Mapped[str] = mapped_column(Text)  # JSON: snapshot para restaurar
    eliminado_por: Mapped[str] = mapped_column(String(150), default="")
    eliminado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


# ---------------------------------------------------------------------------
# Favoritos: accesos rápidos por empleado a equipos y hojas de Pre-Approved.
# A diferencia de la herramienta original (favoritos en localStorage del
# navegador, sin cuentas reales), aquí quedan por empleado en la base de
# datos: siguen disponibles desde cualquier dispositivo con su sesión Zoho.
# ---------------------------------------------------------------------------

class DesignFavorito(Base):
    __tablename__ = "design_favoritos"

    id: Mapped[int] = mapped_column(primary_key=True)
    empleado_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"))
    tipo: Mapped[str] = mapped_column(String(20))  # "team" | "preapproved" | "protocolo"
    team_id: Mapped[int] = mapped_column(ForeignKey("design_teams.id"), nullable=True)
    preapproved_sheet_id: Mapped[int] = mapped_column(ForeignKey("design_preapproved_sheets.id"), nullable=True)
    protocolo_id: Mapped[int] = mapped_column(ForeignKey("design_protocolos.id"), nullable=True)
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


# ---------------------------------------------------------------------------
# Protocols: biblioteca de SOPs en tarjetas, buscable por texto/área. Se
# cargan a mano o extrayendo el texto de un PDF (pdf.js, en el navegador —
# el archivo no se sube al servidor, igual que en la herramienta original).
# ---------------------------------------------------------------------------

class DesignProtocolo(Base):
    __tablename__ = "design_protocolos"

    id: Mapped[int] = mapped_column(primary_key=True)
    area_id: Mapped[int] = mapped_column(ForeignKey("design_areas.id"), nullable=True)
    titulo: Mapped[str] = mapped_column(String(255))
    descripcion: Mapped[str] = mapped_column(String(500), default="")
    contenido: Mapped[str] = mapped_column(Text, default="")
    version: Mapped[str] = mapped_column(String(20), default="v1.0")
    orden: Mapped[int] = mapped_column(Integer, default=0)
    creado_por: Mapped[str] = mapped_column(String(150), default="")
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    area = relationship("DesignArea")


# ---------------------------------------------------------------------------
# Desempeño (Performance): evaluaciones mensuales por equipo + "empleado del
# mes". Visible solo para administradores (datos sensibles de RR.HH.).
# ---------------------------------------------------------------------------

class DesignPerfCriterio(Base):
    __tablename__ = "design_perf_criterios"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(200), unique=True)
    orden: Mapped[int] = mapped_column(Integer, default=0)


class DesignPerfSheet(Base):
    __tablename__ = "design_perf_sheets"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(150))
    tipo: Mapped[str] = mapped_column(String(20))  # "eval" | "seleccion"
    meses: Mapped[str] = mapped_column(Text, default="[]")  # JSON: 12 etiquetas (ej. "Ene 2025")
    orden: Mapped[int] = mapped_column(Integer, default=0)

    empleados = relationship("DesignPerfEmpleado", back_populates="sheet", cascade="all, delete-orphan")
    ganadores = relationship("DesignPerfGanador", back_populates="sheet", cascade="all, delete-orphan")
    filas_seleccion = relationship("DesignPerfSeleccionFila", back_populates="sheet", cascade="all, delete-orphan")


class DesignPerfEmpleado(Base):
    __tablename__ = "design_perf_empleados"

    id: Mapped[int] = mapped_column(primary_key=True)
    sheet_id: Mapped[int] = mapped_column(ForeignKey("design_perf_sheets.id"))
    nombre: Mapped[str] = mapped_column(String(150))
    nota: Mapped[str] = mapped_column(Text, default="")
    total: Mapped[float] = mapped_column(Float, default=0)
    totales_mes: Mapped[str] = mapped_column(Text, default="[]")  # JSON: 12 floats (total por mes)
    orden: Mapped[int] = mapped_column(Integer, default=0)

    sheet = relationship("DesignPerfSheet", back_populates="empleados")
    celdas = relationship("DesignPerfCelda", back_populates="empleado", cascade="all, delete-orphan")


class DesignPerfCelda(Base):
    __tablename__ = "design_perf_celdas"

    id: Mapped[int] = mapped_column(primary_key=True)
    empleado_id: Mapped[int] = mapped_column(ForeignKey("design_perf_empleados.id"))
    criterio_id: Mapped[int] = mapped_column(ForeignKey("design_perf_criterios.id"))
    mes_indice: Mapped[int] = mapped_column(Integer)  # 0-11
    nivel: Mapped[str] = mapped_column(String(20), default="")  # ALTO | MEDIO | BAJO | ""
    puntaje: Mapped[float] = mapped_column(Float, default=0)

    empleado = relationship("DesignPerfEmpleado", back_populates="celdas")
    criterio = relationship("DesignPerfCriterio")


class DesignPerfGanador(Base):
    """Ganador de 'empleado del mes' por categoría (hoja tipo 'seleccion')."""
    __tablename__ = "design_perf_ganadores"

    id: Mapped[int] = mapped_column(primary_key=True)
    sheet_id: Mapped[int] = mapped_column(ForeignKey("design_perf_sheets.id"))
    categoria: Mapped[str] = mapped_column(String(150))
    orden: Mapped[int] = mapped_column(Integer, default=0)
    ganadores_mes: Mapped[str] = mapped_column(Text, default="[]")  # JSON: 12 nombres (uno por mes)

    sheet = relationship("DesignPerfSheet", back_populates="ganadores")


class DesignPerfSeleccionFila(Base):
    """Fila de un evaluador dentro de la hoja de selección (uno por mánager/líder)."""
    __tablename__ = "design_perf_seleccion_filas"

    id: Mapped[int] = mapped_column(primary_key=True)
    sheet_id: Mapped[int] = mapped_column(ForeignKey("design_perf_sheets.id"))
    evaluador: Mapped[str] = mapped_column(String(150), default="")
    orden: Mapped[int] = mapped_column(Integer, default=0)

    sheet = relationship("DesignPerfSheet", back_populates="filas_seleccion")
    celdas = relationship("DesignPerfSeleccionCelda", back_populates="fila", cascade="all, delete-orphan")


class DesignPerfSeleccionCelda(Base):
    __tablename__ = "design_perf_seleccion_celdas"

    id: Mapped[int] = mapped_column(primary_key=True)
    fila_id: Mapped[int] = mapped_column(ForeignKey("design_perf_seleccion_filas.id"))
    mes_indice: Mapped[int] = mapped_column(Integer)
    persona: Mapped[str] = mapped_column(String(150), default="")
    puntaje: Mapped[str] = mapped_column(String(20), default="")  # texto: puede ser "N/a" o número
    nota: Mapped[str] = mapped_column(Text, default="")

    fila = relationship("DesignPerfSeleccionFila", back_populates="celdas")
