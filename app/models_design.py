"""Módulo Design Schedule: horario de producción del equipo de diseño (N3, N6, Face, N2, Support).

Puerto de una herramienta previa en HTML/localStorage sin backend real ni cuentas de usuario
(una sola contraseña compartida). Aquí cada equipo/orden queda en base de datos real y las
acciones quedan asociadas al usuario que las hizo (login con Zoho ya existente en la app).
"""
from datetime import date, datetime
from sqlalchemy import String, Integer, Date, DateTime, Float, ForeignKey, Text, Boolean, LargeBinary, UniqueConstraint
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


# ⚠️ ORIGEN DE DATOS DE DESIGN — validar con Rosember antes de cambiar (ver app/services_design_origenes.py y CLAUDE.md).
# Equipos (Parámetros › Equipos) = origen de los managers y diseñadores del Schedule; sus cambios llegan a Openings.
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
    tabla: Mapped[str] = mapped_column(String(20), default="principal")  # principal | nightguard | material (N6)

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
    critico: Mapped[str] = mapped_column(String(300), default="")   # N3 (varios ítems separados por «; »)
    arco: Mapped[str] = mapped_column(String(10), default="")       # Removable Denture: Upper | Lower | Both

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

    # N6 · Material Change (tabla "material"): dos etapas en la misma fila. Bite design usa las horas y el QC de arriba;
    # Zirconia design usa estas. La etapa activa va en `etapa`.
    z_hora_inicio: Mapped[str] = mapped_column(String(10), default="")
    z_s_hold: Mapped[str] = mapped_column(String(10), default="")
    z_f_hold: Mapped[str] = mapped_column(String(10), default="")
    z_hold_minutos: Mapped[float] = mapped_column(Float, default=0)
    z_hora_fin: Mapped[str] = mapped_column(String(10), default="")
    z_qc: Mapped[bool] = mapped_column(Boolean, default=False)
    z_qc_reporte: Mapped[str] = mapped_column(Text, default="")
    # N6 desde el 29-oct-2026 (Rosember, 28-oct-2026): más etapas en la misma fila, con las mismas horas, QC y total.
    # x_ = «Zirconia» (la segunda de Over Ti-bar) y n_ = «Nightguard design» (Material Change y Over Ti-bar).
    x_hora_inicio: Mapped[str] = mapped_column(String(10), default="")
    x_s_hold: Mapped[str] = mapped_column(String(10), default="")
    x_f_hold: Mapped[str] = mapped_column(String(10), default="")
    x_hold_minutos: Mapped[float] = mapped_column(Float, default=0)
    x_hora_fin: Mapped[str] = mapped_column(String(10), default="")
    x_qc: Mapped[bool] = mapped_column(Boolean, default=False)
    x_qc_reporte: Mapped[str] = mapped_column(Text, default="")
    n_hora_inicio: Mapped[str] = mapped_column(String(10), default="")
    n_s_hold: Mapped[str] = mapped_column(String(10), default="")
    n_f_hold: Mapped[str] = mapped_column(String(10), default="")
    n_hold_minutos: Mapped[float] = mapped_column(Float, default=0)
    n_hora_fin: Mapped[str] = mapped_column(String(10), default="")
    n_qc: Mapped[bool] = mapped_column(Boolean, default=False)
    n_qc_reporte: Mapped[str] = mapped_column(Text, default="")

    # N3 · Cirugías (pedido por Rosember el 13-oct-2026): tiempo de articulación. Las dos horas se escriben a mano; el
    # total (RTD − START) se calcula en pantalla. Pasadas las 2 h se cuenta en el Dashboard › Articulación.
    art_start: Mapped[str] = mapped_column(String(10), default="")
    art_rtd: Mapped[str] = mapped_column(String(10), default="")
    # Área Training: de qué equipo (manager) vino el caso cuando lo pasaron desde N3 (solo informativo)
    origen_equipo: Mapped[str] = mapped_column(String(150), default="")
    # Aprobaciones lentas (13-oct-2026): hora (UTC) en que la orden pasó a Approved y hora en que se marcó su QC.
    # Se anotan solas (services_design_aprobacion); las órdenes anteriores no las tienen.
    aprobada_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    qc_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Tiempo de diseño con hora real (27-oct-2026, autorizado por Rosember; orden 244834): las horas del horario se guardan sin
    # fecha y un Hold de varios días se medía mal. Desde el primer «Initiated» se suman los tramos reales en Initiated: minutos
    # ya cerrados y desde cuándo corre el tramo abierto (UTC). Sin valor = orden anterior o con horas corregidas a mano:
    # su Total sigue saliendo de las horas visibles. No se muestran en el Schedule.
    diseno_min: Mapped[float | None] = mapped_column(Float, nullable=True)
    diseno_desde: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    orden_visual: Mapped[int] = mapped_column(Integer, default=0)
    # Día para el que se creó la orden; no cambia cuando pasa al día siguiente (Hold, Ready to design). Así N3/N2
    # Producción cuenta solo las órdenes nuevas del día (services_design_produccion).
    fecha_creada: Mapped[date | None] = mapped_column(Date, nullable=True)

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


class DesignFaqHoja(Base):
    """Hoja de Comments N2 / Face Design (FACE, NEW FACE, N2, FACE MANAGER QUESTIONS...).
    `columnas` es un JSON [{"k": clave, "l": título}] con el orden de las columnas visibles:
    las claves fijas son campos de DesignFaq y las propias ("c1", "c2"...) van en DesignFaq.extras."""
    __tablename__ = "design_faq_hojas"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(150), default="")
    area_id: Mapped[int | None] = mapped_column(ForeignKey("design_areas.id"), nullable=True)
    columnas: Mapped[str] = mapped_column(Text, default="[]")
    orden: Mapped[int] = mapped_column(Integer, default=0)


class DesignFaq(Base):
    """Fila de una hoja de Comments N2 / Face Design: situación, cómo proceder y template."""
    __tablename__ = "design_faq"

    id: Mapped[int] = mapped_column(primary_key=True)
    area_id: Mapped[int] = mapped_column(ForeignKey("design_areas.id"))
    hoja_id: Mapped[int | None] = mapped_column(ForeignKey("design_faq_hojas.id"), nullable=True)
    seccion: Mapped[str] = mapped_column(String(150), default="")
    situacion: Mapped[str] = mapped_column(Text, default="")
    producto: Mapped[str] = mapped_column(String(150), default="")
    como_proceder: Mapped[str] = mapped_column(Text, default="")
    plantilla: Mapped[str] = mapped_column(Text, default="")
    ejemplos: Mapped[str] = mapped_column(Text, default="")
    extras: Mapped[str] = mapped_column(Text, default="{}")
    orden: Mapped[int] = mapped_column(Integer, default=0)

    area = relationship("DesignArea")


class DesignComentarioTemplate(Base):
    """Plantilla de nota del generador de comentarios N3: las 11 fijas del formato
    original (es_fija=1, no editables/borrables) más las que agregue el equipo.
    Compartida por todo el equipo; favorito es por empleado."""
    __tablename__ = "design_comentario_templates"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(150))
    texto: Mapped[str] = mapped_column(Text)
    es_fija: Mapped[int] = mapped_column(Integer, default=0)
    orden: Mapped[int] = mapped_column(Integer, default=0)
    creado_por: Mapped[str] = mapped_column(String(150), default="")
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    # Dueño (28-oct-2026, autorizado por Rosember): cada diseñador tiene sus propias plantillas. NULL = plantillas base (las
    # que había hasta ese día): no se listan, solo sirven para la copia que recibe cada persona la primera vez.
    empleado_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True, index=True)


class DesignPreApprovedSheet(Base):
    """Una hoja de 'cambios pre-aprobados' por doctor, dueña de un diseñador/manager."""
    __tablename__ = "design_preapproved_sheets"

    id: Mapped[int] = mapped_column(primary_key=True)
    area_id: Mapped[int] = mapped_column(ForeignKey("design_areas.id"))
    nombre: Mapped[str] = mapped_column(String(150), default="")
    titulo: Mapped[str] = mapped_column(String(150), default="Pre-approved changes")
    changes_label: Mapped[str] = mapped_column(String(100), default="Changes")
    orden: Mapped[int] = mapped_column(Integer, default=0)
    # Anchos de columna guardados por hoja (JSON): {"crit": px, "<doctor_id>": px}.
    anchos: Mapped[str] = mapped_column(Text, default="{}")

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


class DesignPreApprovedFoto(Base):
    """Foto en una celda de Pre-Approved (doctor × criterio). Va por el NOMBRE del criterio (criterio_clave) y no por la
    fila: así sigue al doctor cuando cambia de hoja (Openings / Cambios), igual que sus valores."""
    __tablename__ = "design_preapproved_fotos"

    id: Mapped[int] = mapped_column(primary_key=True)
    doctor_id: Mapped[int] = mapped_column(ForeignKey("design_preapproved_doctores.id"), index=True)
    criterio_clave: Mapped[str] = mapped_column(String(150), default="")
    nombre: Mapped[str] = mapped_column(String(255), default="")
    tipo: Mapped[str] = mapped_column(String(50), default="image/png")
    tamano: Mapped[int] = mapped_column(Integer, default=0)
    huella: Mapped[str] = mapped_column(String(40), default="")  # sha1: la misma foto no se repite en una celda
    orden: Mapped[int] = mapped_column(Integer, default=0)
    datos: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)
    creado_por: Mapped[str] = mapped_column(String(150), default="")
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


# ---------------------------------------------------------------------------
# Papelera: registro de borrados en paneles estructurales (Pre-Approved, y lo
# que se sume después: Canvas, Comments…), con snapshot suficiente para
# restaurar. No cubre acciones del día a día (crear/borrar órdenes).
# ---------------------------------------------------------------------------

# ⚠️ ORIGEN DE DATOS DE DESIGN — validar con Rosember antes de cambiar (ver app/services_design_origenes.py y CLAUDE.md).
# Openings = base de datos de asignación de centros a los equipos (Schedule y Pre-Approved salen de aquí).
class DesignOpeningsHoja(Base):
    """Openings / distribución de centros de Design (Parámetros). Se cargó de la hoja 2026 del Excel
    'Openings Distribucion 2026'; desde entonces todo se edita aquí."""
    __tablename__ = "design_openings_hojas"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(100), default="2026")
    titulo: Mapped[str] = mapped_column(String(200), default="")
    subtitulo: Mapped[str] = mapped_column(String(200), default="")
    actualizado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class DesignOpeningsColumna(Base):
    """Columna de la hoja: `clave` es fija (para conectarla después con otros datos); `titulo` se puede cambiar."""
    __tablename__ = "design_openings_columnas"

    id: Mapped[int] = mapped_column(primary_key=True)
    hoja_id: Mapped[int] = mapped_column(ForeignKey("design_openings_hojas.id"))
    clave: Mapped[str] = mapped_column(String(60))
    titulo: Mapped[str] = mapped_column(String(150), default="")
    orden: Mapped[int] = mapped_column(Integer, default=0)


class DesignOpeningsFila(Base):
    """Fila (un centro). `datos` es JSON {clave_columna: texto}."""
    __tablename__ = "design_openings_filas"

    id: Mapped[int] = mapped_column(primary_key=True)
    hoja_id: Mapped[int] = mapped_column(ForeignKey("design_openings_hojas.id"))
    orden: Mapped[int] = mapped_column(Integer, default=0)
    datos: Mapped[str] = mapped_column(Text, default="{}")


class DesignOpeningsHistorial(Base):
    """Historial de cambios de Openings: quién cambió qué celda, fila o columna y cuándo. No se borra nunca
    (services_design_openings_historial: se registra solo, venga el cambio de donde venga)."""
    __tablename__ = "design_openings_historial"

    id: Mapped[int] = mapped_column(primary_key=True)
    hoja_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fila_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    centro: Mapped[str] = mapped_column(String(150), default="")
    columna: Mapped[str] = mapped_column(String(60), default="")   # clave de la columna
    accion: Mapped[str] = mapped_column(String(30), default="celda")  # celda | fila_nueva | fila_eliminada | columna_*
    antes: Mapped[str] = mapped_column(Text, default="")
    despues: Mapped[str] = mapped_column(Text, default="")
    por: Mapped[str] = mapped_column(String(150), default="")       # correo de quien lo hizo (o "Sistema")
    fecha: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class DesignFestivo(Base):
    """Festivo de la empresa: las órdenes en Hold no pasan a este día (se saltan, como sábados y domingos)."""
    __tablename__ = "design_festivos"

    fecha: Mapped[date] = mapped_column(Date, primary_key=True)
    nombre: Mapped[str] = mapped_column(String(100), default="")
    creado_por: Mapped[str] = mapped_column(String(150), default="")


class DesignDelegacion(Base):
    """Diseñador que queda a cargo del Schedule de su equipo por unas fechas (cuando el manager no está): mientras
    dure, puede lo mismo que el manager en ese Schedule (no en Gestión). Uno por equipo; lo da el manager o un admin."""
    __tablename__ = "design_delegaciones"

    team_id: Mapped[int] = mapped_column(ForeignKey("design_teams.id"), primary_key=True)
    empleado_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"))
    desde: Mapped[date] = mapped_column(Date)
    hasta: Mapped[date] = mapped_column(Date)
    asignado_por: Mapped[str] = mapped_column(String(150), default="")
    asignado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    empleado = relationship("Empleado")


class DesignRolUsuario(Base):
    """Rol de una persona solo dentro de Design (empleado | aprobador | admin). Reemplaza su rol de People
    únicamente en las páginas y APIs de Design; People y los demás módulos no cambian. Sin fila = igual que People."""
    __tablename__ = "design_roles_usuario"

    empleado_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"), primary_key=True)
    rol: Mapped[str] = mapped_column(String(20))
    asignado_por: Mapped[str] = mapped_column(String(150), default="")
    asignado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class DesignInhabilitado(Base):
    """Personas a las que se les inhabilitó el acceso a la plataforma desde Parámetros › Equipos (p. ej. renunció un diseñador).
    No se borra nada: la persona sigue existiendo (su nombre queda en las órdenes, el Dashboard y los registros del
    Schedule) pero no puede entrar. `activo` = 1 mientras esté inhabilitada; al reactivarla queda en 0 con quién y cuándo."""
    __tablename__ = "design_inhabilitados"

    empleado_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    activo: Mapped[int] = mapped_column(Integer, default=1)
    motivo: Mapped[str] = mapped_column(Text, default="")
    equipos: Mapped[str] = mapped_column(Text, default="")   # equipos de los que salió (texto, para el registro)
    por: Mapped[str] = mapped_column(String(150), default="")
    fecha: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    reactivado_por: Mapped[str] = mapped_column(String(150), default="")
    reactivado_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class DesignPlanificacion(Base):
    """Borrador de Parámetros › Openings › Planificación: solo los cambios planeados (no toca Openings hasta publicar).
    Una sola fila (id=1). `cambios` = {"<fila_id>": {"<columna>": {"antes": str, "nuevo": str}}}."""
    __tablename__ = "design_planificacion"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    cambios: Mapped[str] = mapped_column(Text, default="{}")
    actualizado_por: Mapped[str] = mapped_column(String(150), default="")
    actualizado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class DesignCopiaFace(Base):
    """Orden de N2 copiada desde Face al marcar su QC (13-oct-2026). Si después se desmarca el QC en Face, queda
    "pendiente" hasta que el manager de N2 decida: "borrada" (se borra la orden de N2) o "mantenida"."""
    __tablename__ = "design_copias_face"

    n2_orden_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    face_orden_id: Mapped[int] = mapped_column(Integer, index=True)
    estado: Mapped[str] = mapped_column(String(20), default="activa")   # activa | pendiente | mantenida | borrada
    face_equipo: Mapped[str] = mapped_column(String(150), default="")
    desmarcada_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    decidida_por: Mapped[str] = mapped_column(String(150), default="")
    creada_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class DesignCambioDigital(Base):
    """Cambio que pide el doctor (DOC) o el laboratorio (LAB) sobre un caso: Dashboard › Cambios digitales (13-oct-2026)."""
    __tablename__ = "design_cambios_digitales"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    fecha: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    orden: Mapped[str] = mapped_column(String(40), default="", index=True)
    paciente: Mapped[str] = mapped_column(String(200), default="")
    centro: Mapped[str] = mapped_column(String(120), default="", index=True)
    doctor: Mapped[str] = mapped_column(String(200), default="")
    producto: Mapped[str] = mapped_column(String(200), default="")
    tipo_cambio: Mapped[str] = mapped_column(String(120), default="", index=True)
    detalle: Mapped[str] = mapped_column(Text, default="")
    origen: Mapped[str] = mapped_column(String(10), default="")   # DOC | LAB
    creado_por: Mapped[str] = mapped_column(String(150), default="")
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    actualizado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class DesignPreferencia(Base):
    """Preferencias de cada persona en Design (por ahora el modo oscuro). Por defecto, claro."""
    __tablename__ = "design_preferencias"

    empleado_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tema: Mapped[str] = mapped_column(String(10), default="claro")  # claro | oscuro
    actualizado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class DesignConexionRegla(Base):
    """Decisiones de Parámetros › Conexión con los equipos que no son un dato de otra tabla:
    historico (persona que ya no es manager), aceptado_general (está en DESIGN MANAGERS sin ser manager),
    hoja_manager (hoja de Desempeño → área + manager; también decide qué hoja ve el aprobador) y
    pa_manager (hoja de Pre-Approved → equipo)."""
    __tablename__ = "design_conexion_reglas"
    __table_args__ = (UniqueConstraint("tipo", "clave", name="uq_design_conexion_regla"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    tipo: Mapped[str] = mapped_column(String(30))
    clave: Mapped[str] = mapped_column(String(200))
    valor: Mapped[str] = mapped_column(Text, default="")
    creado_por: Mapped[str] = mapped_column(String(150), default="")
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


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
    tipo: Mapped[str] = mapped_column(String(20))  # "team" | "preapproved" | "cmt_template"
    team_id: Mapped[int] = mapped_column(ForeignKey("design_teams.id"), nullable=True)
    preapproved_sheet_id: Mapped[int] = mapped_column(ForeignKey("design_preapproved_sheets.id"), nullable=True)
    # Protocols se retiró el 21-oct-2026 (Rosember): la columna queda (ya existe en la base) pero sin llave foránea y sin uso.
    protocolo_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cmt_template_id: Mapped[int] = mapped_column(ForeignKey("design_comentario_templates.id"), nullable=True)
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


# Protocols (DesignProtocolo, sus áreas, archivos PDF, versiones, borradores, miniaturas y páginas) se retiró el
# 21-oct-2026 (Rosember): las tablas design_protocolo* se borran al arrancar (ver main.design_retirar_protocolos).


class DesignInicioPagina(Base):
    """Página de Inicio de Design (/design/inicio) armada con el editor (solo admins). Una sola fila:
    `borrador` es lo que se está editando y `publicado` lo que ven todos. Ambos en JSON (secciones y bloques)."""
    __tablename__ = "design_inicio_pagina"

    id: Mapped[int] = mapped_column(primary_key=True)
    borrador: Mapped[str] = mapped_column(Text, default="")
    publicado: Mapped[str] = mapped_column(Text, default="")
    version: Mapped[int] = mapped_column(Integer, default=1)  # del borrador (dos editores a la vez no se pisan)
    actualizado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    actualizado_por: Mapped[str] = mapped_column(String(150), default="")
    publicado_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    publicado_por: Mapped[str] = mapped_column(String(150), default="")


class DesignInicioVersion(Base):
    """Cada publicación de la página de Inicio (para volver a una anterior)."""
    __tablename__ = "design_inicio_versiones"

    id: Mapped[int] = mapped_column(primary_key=True)
    contenido: Mapped[str] = mapped_column(Text, deferred=True)
    publicado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    publicado_por: Mapped[str] = mapped_column(String(150), default="")


class DesignInicioMedio(Base):
    """Imágenes y videos cortos (mp4) subidos para la página de Inicio."""
    __tablename__ = "design_inicio_medios"

    id: Mapped[int] = mapped_column(primary_key=True)
    tipo: Mapped[str] = mapped_column(String(10), default="imagen")  # imagen | video
    nombre: Mapped[str] = mapped_column(String(255), default="")
    mime: Mapped[str] = mapped_column(String(60), default="")
    tamano: Mapped[int] = mapped_column(Integer, default=0)
    ancho: Mapped[int] = mapped_column(Integer, default=0)
    alto: Mapped[int] = mapped_column(Integer, default=0)
    datos: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)
    creado_por: Mapped[str] = mapped_column(String(150), default="")
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class DesignInicioMedioParte(Base):
    """Pedazos (4 MB) de los videos de la página de Inicio. Se suben y se leen por partes para no cargar
    el video entero en la memoria del servidor. Mientras se sube, medio_id está vacío (solo tiene la clave de la subida)."""
    __tablename__ = "design_inicio_medio_partes"

    id: Mapped[int] = mapped_column(primary_key=True)
    subida: Mapped[str] = mapped_column(String(40), index=True)
    medio_id: Mapped[int | None] = mapped_column(Integer, index=True, nullable=True)
    n: Mapped[int] = mapped_column(Integer, default=0)
    tamano: Mapped[int] = mapped_column(Integer, default=0)
    datos: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class DesignInicioMuro(Base):
    """Publicaciones del muro interno de la página de Inicio (anuncios, logros, cumpleaños…). Las hacen los admins."""
    __tablename__ = "design_inicio_muro"

    id: Mapped[int] = mapped_column(primary_key=True)
    titulo: Mapped[str] = mapped_column(String(200), default="")
    texto: Mapped[str] = mapped_column(Text, default="")
    imagen: Mapped[str] = mapped_column(String(300), default="")  # "medio:ID" o dirección https
    fijado: Mapped[int] = mapped_column(Integer, default=0)
    activo: Mapped[int] = mapped_column(Integer, default=1)
    creado_por: Mapped[str] = mapped_column(String(150), default="")
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    editado_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class DesignInicioMuroBloque(Base):
    """En qué bloque de Novedades (id del bloque en la página de Inicio) se hizo cada publicación del muro: cada bloque
    muestra solo las suyas. Las publicaciones sin fila (anteriores a esto) salen en el primer bloque de la página."""
    __tablename__ = "design_inicio_muro_bloque"

    post_id: Mapped[int] = mapped_column(ForeignKey("design_inicio_muro.id"), primary_key=True)
    bloque_id: Mapped[str] = mapped_column(String(40), index=True)


class DesignQcCatalogo(Base):
    """Lista de hallazgos de QC de un área: títulos generales con hallazgos preestablecidos. Una fila con `hallazgo`
    vacío es un título sin hallazgos todavía. Borrar un hallazgo lo desactiva (no cambia los reportes ya guardados)."""
    __tablename__ = "design_qc_catalogo"

    id: Mapped[int] = mapped_column(primary_key=True)
    area_id: Mapped[int] = mapped_column(ForeignKey("design_areas.id"), index=True)
    titulo: Mapped[str] = mapped_column(String(200))
    hallazgo: Mapped[str] = mapped_column(String(300), default="")
    tabla: Mapped[str] = mapped_column(String(20), default="")            # "" = todas | principal | nightguard
    producto_clave: Mapped[str] = mapped_column(String(30), default="")   # "" = cualquiera | nightguard | tc (según el producto de la fila)
    orden: Mapped[int] = mapped_column(Integer, default=0)
    activo: Mapped[int] = mapped_column(Integer, default=1)


class DesignSupportConfig(Base):
    """Turnos rotativos de las dos personas de Support (Parámetros › Support Time). Una sola fila (id 1). Desde la
    fecha de referencia, la persona `ref_turno1` ("a" o "b") está en el turno 1 y la otra en el 2; cada `semanas`
    semanas intercambian. Horas en formato 24 h ("07:00")."""
    __tablename__ = "design_support_config"

    id: Mapped[int] = mapped_column(primary_key=True)
    turno1_nombre: Mapped[str] = mapped_column(String(40), default="Diurno")
    turno1_inicio: Mapped[str] = mapped_column(String(5), default="07:00")
    turno1_fin: Mapped[str] = mapped_column(String(5), default="16:40")
    turno2_nombre: Mapped[str] = mapped_column(String(40), default="Nocturno")
    turno2_inicio: Mapped[str] = mapped_column(String(5), default="21:00")
    turno2_fin: Mapped[str] = mapped_column(String(5), default="07:00")
    dias: Mapped[str] = mapped_column(String(20), default="0,1,2,3,4")   # días de la semana (0 = lunes)
    persona_a_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    persona_b_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    ref_fecha: Mapped[date | None] = mapped_column(Date, nullable=True)
    ref_turno1: Mapped[str] = mapped_column(String(1), default="a")
    semanas: Mapped[int] = mapped_column(Integer, default=4)
    # Grupos de Cliq (Unique Name, uno por línea) donde el bot avisa quién queda en Support al empezar cada turno (20-oct-2026)
    cliq_canales: Mapped[str] = mapped_column(Text, default="")
    actualizado_por: Mapped[str] = mapped_column(String(150), default="")
    actualizado_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class DesignSupportCobertura(Base):
    """Alguien (de cualquier equipo de Design) que cubre un turno de Support entre dos fechas ("Dejar a cargo" en el
    Schedule de Support). Mientras dure, edita el Schedule de Support y el turno aparece cubierto por esa persona."""
    __tablename__ = "design_support_coberturas"

    id: Mapped[int] = mapped_column(primary_key=True)
    turno: Mapped[int] = mapped_column(Integer)   # 1 o 2
    empleado_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"))
    desde: Mapped[date] = mapped_column(Date)
    hasta: Mapped[date] = mapped_column(Date)
    asignado_por: Mapped[str] = mapped_column(String(150), default="")
    asignado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    empleado = relationship("Empleado")


class DesignTrainingProgreso(Base):
    """Avance de una persona en Training: una fila por lección (completada y mejor puntaje del quiz). Las claves
    especiales "_ultima" (dónde se quedó, en `dato`) y "_examen" (mejor puntaje del examen final) usan la misma tabla."""
    __tablename__ = "design_training_progreso"

    empleado_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"), primary_key=True)
    leccion_id: Mapped[str] = mapped_column(String(60), primary_key=True)
    completada: Mapped[int] = mapped_column(Integer, default=0)
    puntaje: Mapped[int] = mapped_column(Integer, default=0)
    dato: Mapped[str] = mapped_column(String(200), default="")
    actualizado_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class DesignTrainingModelo(Base):
    """Modelo 3D (GLB, STL, OBJ o PLY) que un admin sube a un espacio (slot) de una lección de Training. Uno por espacio.
    `anotaciones` = pines con texto bilingüe sobre el modelo (JSON)."""
    __tablename__ = "design_training_modelos"

    id: Mapped[int] = mapped_column(primary_key=True)
    slot: Mapped[str] = mapped_column(String(60), index=True)
    nombre: Mapped[str] = mapped_column(String(200), default="")
    formato: Mapped[str] = mapped_column(String(10), default="")
    tamano: Mapped[int] = mapped_column(Integer, default=0)
    datos: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)
    anotaciones: Mapped[str] = mapped_column(Text, default="[]")
    subido_por: Mapped[str] = mapped_column(String(150), default="")
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class DesignTrainingModulo(Base):
    """Módulo de Training editado desde el editor (como la página de Inicio): `borrador` es lo que se está editando y
    `publicado` lo que ven todos (JSON del módulo completo). Si no hay fila, vale el archivo de static/training/data/.
    `eliminado` = el módulo se quitó del curso al publicar."""
    __tablename__ = "design_training_modulos"

    id: Mapped[int] = mapped_column(primary_key=True)
    modulo: Mapped[str] = mapped_column(String(60), unique=True, index=True)
    borrador: Mapped[str] = mapped_column(Text, default="")
    publicado: Mapped[str] = mapped_column(Text, default="")
    eliminado: Mapped[int] = mapped_column(Integer, default=0)
    version: Mapped[int] = mapped_column(Integer, default=1)
    actualizado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    actualizado_por: Mapped[str] = mapped_column(String(150), default="")
    publicado_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    publicado_por: Mapped[str] = mapped_column(String(150), default="")


class DesignTrainingVersion(Base):
    """Cada publicación de un módulo de Training (para volver a una anterior)."""
    __tablename__ = "design_training_versiones"

    id: Mapped[int] = mapped_column(primary_key=True)
    modulo: Mapped[str] = mapped_column(String(60), index=True)
    contenido: Mapped[str] = mapped_column(Text, deferred=True)
    publicado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    publicado_por: Mapped[str] = mapped_column(String(150), default="")


class DesignPushSuscripcion(Base):
    """Navegador de una persona que aceptó recibir notificaciones push (Web Push). Una persona puede tener varias
    (computador, celular...). Se borra sola cuando el servicio de push responde que ya no existe."""
    __tablename__ = "design_push_suscripciones"

    id: Mapped[int] = mapped_column(primary_key=True)
    empleado_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"), index=True)
    endpoint: Mapped[str] = mapped_column(Text)
    p256dh: Mapped[str] = mapped_column(String(200), default="")
    auth: Mapped[str] = mapped_column(String(100), default="")
    navegador: Mapped[str] = mapped_column(String(200), default="")
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    ultimo_envio: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    fallos: Mapped[int] = mapped_column(Integer, default=0)


class DesignInicioReaccion(Base):
    """Reacción con emoji de una persona a una publicación del muro (una fila por persona y emoji; reaccionar otra vez la quita)."""
    __tablename__ = "design_inicio_reacciones"
    __table_args__ = (UniqueConstraint("post_id", "empleado_id", "emoji", name="uq_design_inicio_reaccion"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    post_id: Mapped[int] = mapped_column(ForeignKey("design_inicio_muro.id"), index=True)
    empleado_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"))
    emoji: Mapped[str] = mapped_column(String(16))
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class DesignFotoPerfil(Base):
    """Foto de perfil de Zoho de un empleado de Design (se toma al iniciar sesión; solo para quien tiene el
    módulo Design Schedule). Se muestra junto al nombre en la barra superior de Design."""
    __tablename__ = "design_fotos_perfil"

    empleado_id: Mapped[int] = mapped_column(Integer, primary_key=True)  # sin llave foránea: tabla aparte
    tipo: Mapped[str] = mapped_column(String(40), default="")
    datos: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True, deferred=True)
    origen: Mapped[str] = mapped_column(String(300), default="")
    error: Mapped[str] = mapped_column(Text, default="")
    actualizado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


# ---------------------------------------------------------------------------
# Canvas: hojas de trabajo con marcos de foto (plantillas de arcos dentales,
# angulación de implantes) + capa de anotaciones (formas, flechas, texto,
# lápiz, resaltador). Cada hoja es de un área (compartida por el equipo que
# la usa), no personal — igual que Pre-Approved. [Desde el 9-oct-2026 cada hoja
# es de su dueño (empleado_id): cada persona ve y edita solo las suyas.] Las imágenes se guardan como
# data-URL embebidas en el JSON de "frames" (igual que hacía la herramienta
# original en localStorage; aquí no hay límite de 5-10MB del navegador).
# ---------------------------------------------------------------------------

class DesignCanvasDoc(Base):
    __tablename__ = "design_canvas_docs"

    id: Mapped[int] = mapped_column(primary_key=True)
    area_id: Mapped[int] = mapped_column(ForeignKey("design_areas.id"))
    # Dueño de la hoja: cada diseñador trabaja la suya. NULL = hojas compartidas de antes (ya no se listan).
    empleado_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True, index=True)
    nombre: Mapped[str] = mapped_column(String(150), default="Hoja")
    template_id: Mapped[str] = mapped_column(String(30), default="")
    titulo: Mapped[str] = mapped_column(String(150), default="")
    titulo_color: Mapped[str] = mapped_column(String(20), default="#d10a11")
    w: Mapped[int] = mapped_column(Integer, default=1080)
    h: Mapped[int] = mapped_column(Integer, default=1080)
    frames: Mapped[str] = mapped_column(Text, default="[]")     # JSON: [{id,x,y,w,h,img,free?}]
    elements: Mapped[str] = mapped_column(Text, default="[]")   # JSON: anotaciones (formas/texto/etc.)
    orden: Mapped[int] = mapped_column(Integer, default=0)
    creado_por: Mapped[str] = mapped_column(String(150), default="")
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    actualizado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    area = relationship("DesignArea")


# ---------------------------------------------------------------------------
# Desempeño (Performance): evaluaciones mensuales por equipo + "empleado del
# mes". Visible para aprobadores y administradores (datos sensibles de RR.HH.).
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


# ---------------------------------------------------------------------------
# Nuvia Office (Herramientas): documentos tipo Word y presentaciones tipo PowerPoint de cada persona.
# Solo aprobadores y admins de Design. El contenido va en HTML (Word) o JSON (presentaciones).
# ---------------------------------------------------------------------------

class DesignOfficeDoc(Base):
    __tablename__ = "design_office_docs"

    id: Mapped[int] = mapped_column(primary_key=True)
    tipo: Mapped[str] = mapped_column(String(10), default="word")  # word | ppt
    titulo: Mapped[str] = mapped_column(String(255), default="Documento")
    contenido: Mapped[str] = mapped_column(Text, default="", deferred=True)  # no se carga en las listas
    ajustes: Mapped[str] = mapped_column(Text, default="{}", deferred=True)  # página, márgenes, encabezado…
    version: Mapped[int] = mapped_column(Integer, default=1)  # para avisar si otra ventana guardó antes
    tamano: Mapped[int] = mapped_column(Integer, default=0)
    propietario_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"), index=True)
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    actualizado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    actualizado_por: Mapped[str] = mapped_column(String(150), default="")
    eliminado_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)  # en "Eliminados" (se puede restaurar)

    propietario = relationship("Empleado")


class DesignOfficePlantilla(Base):
    """Plantillas de Nuvia Office (Word y PowerPoint). Las cargan y modifican los admins; todos las usan.
    Las fechas marcadas como campo "Fecha de hoy" se muestran siempre con la fecha del día."""
    __tablename__ = "design_office_plantillas"

    id: Mapped[int] = mapped_column(primary_key=True)
    tipo: Mapped[str] = mapped_column(String(10), default="word")  # word | ppt
    titulo: Mapped[str] = mapped_column(String(255), default="Plantilla")
    descripcion: Mapped[str] = mapped_column(String(500), default="")
    contenido: Mapped[str] = mapped_column(Text, default="", deferred=True)
    ajustes: Mapped[str] = mapped_column(Text, default="{}", deferred=True)
    miniatura: Mapped[str] = mapped_column(Text, default="", deferred=True)  # imagen pequeña (data URL)
    version: Mapped[int] = mapped_column(Integer, default=1)
    tamano: Mapped[int] = mapped_column(Integer, default=0)
    orden: Mapped[int] = mapped_column(Integer, default=0)
    creado_por: Mapped[str] = mapped_column(String(150), default="")
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    actualizado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    actualizado_por: Mapped[str] = mapped_column(String(150), default="")


class DesignOfficeCompartido(Base):
    __tablename__ = "design_office_compartidos"
    __table_args__ = (UniqueConstraint("doc_id", "empleado_id", name="uq_design_office_compartido"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    doc_id: Mapped[int] = mapped_column(ForeignKey("design_office_docs.id"), index=True)
    empleado_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"), index=True)
    puede_editar: Mapped[bool] = mapped_column(Boolean, default=False)

    empleado = relationship("Empleado")


# ---------------------------------------------------------------------------
# Textos seguros para Postgres, sin tocar el esquema: al asignar un texto a cualquier columna de
# estos modelos se quitan los caracteres de control (p. ej. NUL, que Postgres rechaza) y se recorta
# al largo de la columna String(n) (antes un texto más largo daba error 500 y se perdía la edición).
# ---------------------------------------------------------------------------
from .texto_seguro import instalar_limpieza as _instalar_limpieza  # noqa: E402


for _cls in list(globals().values()):
    if isinstance(_cls, type) and issubclass(_cls, Base) and _cls is not Base and _cls.__module__ == __name__ \
            and hasattr(_cls, "__table__"):
        _instalar_limpieza(_cls)


class DesignMuralAviso(Base):
    """Mural (13-oct-2026): avisos importantes (posters) pegados en la pared de concreto. Se suben como borrador y al
    publicarlos los ve todo el que tiene Design. Las imágenes llegan ya comprimidas en WebP desde el navegador:
    `datos` (tamaño completo, para leer) y `miniatura` (≈640 px, para la pared). Al eliminar se vacían los datos y la
    fila queda marcada (así un aviso de la carga inicial, `semilla`, no vuelve a aparecer)."""
    __tablename__ = "design_mural_avisos"

    id: Mapped[int] = mapped_column(primary_key=True)
    titulo: Mapped[str] = mapped_column(String(200), default="")
    mime: Mapped[str] = mapped_column(String(40), default="image/webp")
    ancho: Mapped[int] = mapped_column(Integer, default=0)
    alto: Mapped[int] = mapped_column(Integer, default=0)
    tamano: Mapped[int] = mapped_column(Integer, default=0)
    datos: Mapped[bytes | None] = mapped_column(LargeBinary, deferred=True, nullable=True)
    miniatura: Mapped[bytes | None] = mapped_column(LargeBinary, deferred=True, nullable=True)
    publicado: Mapped[bool] = mapped_column(Boolean, default=False)
    publicado_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    orden: Mapped[int] = mapped_column(Integer, default=0)
    eliminado: Mapped[bool] = mapped_column(Boolean, default=False)
    semilla: Mapped[str] = mapped_column(String(40), default="")
    creado_por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    actualizado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class DesignPermisoEdicion(Base):
    """Permiso temporal para que una persona edite días ya cerrados de su Schedule (13-oct-2026, Parámetros › Equipos).
    Abre los días entre `desde` y `hasta` solo para esa persona, hasta `vence_en` (hora de Colombia, sin zona).
    Al quitarlo se marca `revocado` (queda como registro de quién lo dio)."""
    __tablename__ = "design_permisos_edicion"

    id: Mapped[int] = mapped_column(primary_key=True)
    empleado_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"), index=True)
    desde: Mapped[date] = mapped_column(Date)
    hasta: Mapped[date] = mapped_column(Date)
    vence_en: Mapped[datetime] = mapped_column(DateTime)
    motivo: Mapped[str] = mapped_column(String(200), default="")
    revocado: Mapped[bool] = mapped_column(Boolean, default=False)
    creado_por: Mapped[str] = mapped_column(String(150), default="")
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    empleado = relationship("Empleado")


class DesignAyudaSolicitud(Base):
    """Solicitar ayuda (19-oct-2026): un aprobador de N3 pide un diseñador libre a los demás aprobadores de N3.
    estado: abierta | atendida | sin_disponibles | cancelada | vencida. Una sola ayuda por solicitud: al elegir un
    diseñador se cierra. `siguio_sugerencia` dice si quien respondió eligió al que el sistema sugería (menos casos en el mes)."""
    __tablename__ = "design_ayuda_solicitudes"

    id: Mapped[int] = mapped_column(primary_key=True)
    solicitante_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"), index=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("design_teams.id"))
    area_id: Mapped[int] = mapped_column(ForeignKey("design_areas.id"))
    fecha: Mapped[date] = mapped_column(Date, index=True)            # día de Colombia en que se pidió
    creada_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    vence_en: Mapped[datetime] = mapped_column(DateTime)
    estado: Mapped[str] = mapped_column(String(20), default="abierta")
    n_aprobadores: Mapped[int] = mapped_column(Integer, default=0)   # a cuántos aprobadores se les avisó
    n_libres: Mapped[int] = mapped_column(Integer, default=0)        # cuántos diseñadores libres había en total
    elegido_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    elegido_por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    elegido_team_id: Mapped[int | None] = mapped_column(Integer, nullable=True)   # equipo de donde salió el diseñador
    sugerido_id: Mapped[int | None] = mapped_column(Integer, nullable=True)       # el sugerido a quien respondió
    siguio_sugerencia: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    atendida_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    orden_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)   # la orden para la que se pide ayuda (se le asigna el diseñador)
    asignada: Mapped[bool | None] = mapped_column(Boolean, nullable=True)             # ¿se pudo poner al diseñador en esa orden?

    solicitante = relationship("Empleado", foreign_keys=[solicitante_id])
    elegido = relationship("Empleado", foreign_keys=[elegido_id])
    elegido_por = relationship("Empleado", foreign_keys=[elegido_por_id])
    team = relationship("DesignTeam", foreign_keys=[team_id])


class DesignAyudaOferta(Base):
    """Lo que se le ofreció a cada aprobador en una solicitud: sus diseñadores libres (JSON) y el sugerido."""
    __tablename__ = "design_ayuda_ofertas"

    id: Mapped[int] = mapped_column(primary_key=True)
    solicitud_id: Mapped[int] = mapped_column(ForeignKey("design_ayuda_solicitudes.id"), index=True)
    aprobador_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"), index=True)
    libres: Mapped[str] = mapped_column(Text, default="[]")   # [{id, nombre, casos, equipoId}] ordenado: el primero es el sugerido
    sugerido_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    aprobador = relationship("Empleado", foreign_keys=[aprobador_id])


# ---------- Calendario (19-oct-2026): integrado desde la app independiente «Calendario Colombia» ----------
# Admin ve y edita todo; aprobadores, lo de sus equipos (crean y asignan); diseñadores solo ven lo de su equipo y
# marcan como hechas sus tareas. team_id vacío = evento general (solo lo crea un admin; lo ve todo Design).
# Ver services_design_calendario.py.

class DesignCalEvento(Base):
    __tablename__ = "design_cal_eventos"

    id: Mapped[int] = mapped_column(primary_key=True)
    team_id: Mapped[int | None] = mapped_column(ForeignKey("design_teams.id", ondelete="SET NULL"), nullable=True, index=True)
    titulo: Mapped[str] = mapped_column(String(140))
    descripcion: Mapped[str] = mapped_column(Text, default="")
    ubicacion: Mapped[str] = mapped_column(String(200), default="")
    fecha_inicio: Mapped[date] = mapped_column(Date, index=True)
    fecha_fin: Mapped[date] = mapped_column(Date, index=True)
    hora_inicio: Mapped[str | None] = mapped_column(String(5), nullable=True)   # HH:MM; vacío si es de todo el día
    hora_fin: Mapped[str | None] = mapped_column(String(5), nullable=True)
    todo_el_dia: Mapped[bool] = mapped_column(Boolean, default=True)
    repeticion: Mapped[str] = mapped_column(String(10), default="none")        # none | daily | weekly | monthly | yearly
    repetir_hasta: Mapped[date | None] = mapped_column(Date, nullable=True)
    excepciones: Mapped[str] = mapped_column(Text, default="[]")              # ocurrencias eliminadas de una serie (JSON)
    estado: Mapped[str] = mapped_column(String(12), default="pending")         # pending | in_progress | done
    prioridad: Mapped[str] = mapped_column(String(8), default="normal")        # low | normal | high
    visibilidad: Mapped[str] = mapped_column(String(8), default="public")      # public | private
    color: Mapped[str | None] = mapped_column(String(7), nullable=True)
    creado_por: Mapped[int] = mapped_column(ForeignKey("empleados.id"))
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    actualizado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    team = relationship("DesignTeam")
    etiquetas = relationship("DesignCalEventoEtiqueta", cascade="all, delete-orphan")
    asignados = relationship("DesignCalAsignado", cascade="all, delete-orphan")
    comentarios = relationship("DesignCalComentario", cascade="all, delete-orphan")


class DesignCalEtiqueta(Base):
    __tablename__ = "design_cal_etiquetas"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(40), unique=True)
    color: Mapped[str] = mapped_column(String(7))
    creado_por: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class DesignCalEventoEtiqueta(Base):
    __tablename__ = "design_cal_evento_etiquetas"

    evento_id: Mapped[int] = mapped_column(ForeignKey("design_cal_eventos.id", ondelete="CASCADE"), primary_key=True)
    etiqueta_id: Mapped[int] = mapped_column(ForeignKey("design_cal_etiquetas.id", ondelete="CASCADE"), primary_key=True)


class DesignCalAsignado(Base):
    __tablename__ = "design_cal_asignados"

    evento_id: Mapped[int] = mapped_column(ForeignKey("design_cal_eventos.id", ondelete="CASCADE"), primary_key=True)
    empleado_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"), primary_key=True, index=True)


class DesignCalComentario(Base):
    __tablename__ = "design_cal_comentarios"

    id: Mapped[int] = mapped_column(primary_key=True)
    evento_id: Mapped[int] = mapped_column(ForeignKey("design_cal_eventos.id", ondelete="CASCADE"), index=True)
    empleado_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"))
    texto: Mapped[str] = mapped_column(Text)
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class DesignCalActividad(Base):
    __tablename__ = "design_cal_actividad"

    id: Mapped[int] = mapped_column(primary_key=True)
    empleado_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    accion: Mapped[str] = mapped_column(String(40))
    evento_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    team_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    titulo: Mapped[str] = mapped_column(String(140))
    privado: Mapped[bool] = mapped_column(Boolean, default=False)
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class DesignCalVacacionEstimada(Base):
    """Vacaciones que el aprobador estima (aún sin aprobar en People). Se borran solas cuando People aprueba unas
    vacaciones de esa persona que se cruzan con estas fechas. Un mes antes del inicio llega un push al manager para que
    la persona envíe el formato de vacaciones a People."""
    __tablename__ = "design_cal_vacaciones_estimadas"

    id: Mapped[int] = mapped_column(primary_key=True)
    empleado_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"), index=True)
    team_id: Mapped[int | None] = mapped_column(ForeignKey("design_teams.id", ondelete="SET NULL"), nullable=True)
    fecha_inicio: Mapped[date] = mapped_column(Date)
    fecha_fin: Mapped[date] = mapped_column(Date)
    notas: Mapped[str] = mapped_column(String(300), default="")
    creado_por: Mapped[int] = mapped_column(ForeignKey("empleados.id"))
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    recordado_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)   # cuándo se envió el push de 1 mes antes

    empleado = relationship("Empleado", foreign_keys=[empleado_id])


class DesignTeamColores(Base):
    """Colores de diseñadores y centros de un equipo (Rosember, 19-oct-2026). Antes vivían solo en el navegador del
    manager; ahora son del equipo: los ven sus diseñadores y quien abra ese Schedule, hasta que el manager los cambie.
    datos = {"d": {empleado_id: color}, "c": {centro: color}, "p": {producto: color}, "e": {estado: color}} con las claves de color de schedule.js (DS_COLORES)."""
    __tablename__ = "design_team_colores"

    team_id: Mapped[int] = mapped_column(ForeignKey("design_teams.id", ondelete="CASCADE"), primary_key=True)
    datos: Mapped[str] = mapped_column(Text, default="{}")
    actualizado_por: Mapped[str] = mapped_column(String(150), default="")
    actualizado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class DesignCumpleVisto(Base):
    """Anuncio de cumpleaños del día (Rosember, 19-oct-2026): sale la primera vez que cada persona entra a la plataforma
    ese día; esta fila dice que ya lo vio (así no vuelve a salir aunque entre desde otro computador)."""
    __tablename__ = "design_cumple_vistos"

    empleado_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    fecha: Mapped[date] = mapped_column(Date, primary_key=True)
    visto_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


# ---------- Development (Rosember, 19-oct-2026): control de proyectos y protocolos (Desktop\control-proyectos) ----------
# Solo admins + Luis Felipe Blaschke y Paul Andion. Reglas en services_design_dev.py. Sin llaves foráneas a empleados
# (como el resto de Design): se guarda el id y el nombre del momento.

class DesignDevProyecto(Base):
    __tablename__ = "design_dev_proyectos"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(200))
    tipo: Mapped[str] = mapped_column(String(20))                 # Desarrollo | Mejora | Protocolo
    responsable_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    responsable: Mapped[str] = mapped_column(String(150), default="")
    prioridad: Mapped[str] = mapped_column(String(10))            # critica | alta | media | baja
    estado: Mapped[str] = mapped_column(String(12), default="propuesta")
    inicio: Mapped[date] = mapped_column(Date)
    objetivo: Mapped[date] = mapped_column(Date)
    avance: Mapped[int] = mapped_column(Integer, default=0)
    protocolo: Mapped[str] = mapped_column(String(200), default="")
    descripcion: Mapped[str] = mapped_column(Text, default="")
    controles: Mapped[str] = mapped_column(Text, default="{}")   # JSON {clave: true}
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    actualizado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class DesignDevRiesgo(Base):
    __tablename__ = "design_dev_riesgos"

    id: Mapped[int] = mapped_column(primary_key=True)
    proyecto_id: Mapped[int] = mapped_column(Integer, index=True)
    titulo: Mapped[str] = mapped_column(String(300))
    probabilidad: Mapped[int] = mapped_column(Integer)
    impacto: Mapped[int] = mapped_column(Integer)
    mitigacion: Mapped[str] = mapped_column(Text, default="")
    responsable_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    responsable: Mapped[str] = mapped_column(String(150), default="")
    estado: Mapped[str] = mapped_column(String(12), default="abierto")
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class DesignDevEvidencia(Base):
    """Screenshots y fotos ya comprimidas en el navegador (≤ 1 MB, máx. 20 por proyecto: la base tiene 500 MB)."""
    __tablename__ = "design_dev_evidencias"

    id: Mapped[int] = mapped_column(primary_key=True)
    proyecto_id: Mapped[int] = mapped_column(Integer, index=True)
    etapa: Mapped[str] = mapped_column(String(12))
    control: Mapped[str] = mapped_column(String(20), default="")
    descripcion: Mapped[str] = mapped_column(String(200))
    tipo: Mapped[str] = mapped_column(String(20))
    datos: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True, deferred=True)
    peso: Mapped[int] = mapped_column(Integer, default=0)      # bytes
    ancho: Mapped[int] = mapped_column(Integer, default=0)
    alto: Mapped[int] = mapped_column(Integer, default=0)
    nombre_archivo: Mapped[str] = mapped_column(String(200), default="")
    sha256: Mapped[str] = mapped_column(String(64), default="")
    subido_por: Mapped[str] = mapped_column(String(150), default="")
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class DesignDevEvento(Base):
    """Bitácora: solo se agregan filas (nunca se editan ni se borran, salvo al eliminar el proyecto)."""
    __tablename__ = "design_dev_eventos"

    id: Mapped[int] = mapped_column(primary_key=True)
    proyecto_id: Mapped[int] = mapped_column(Integer, index=True)
    empleado_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    usuario: Mapped[str] = mapped_column(String(150), default="")
    tipo: Mapped[str] = mapped_column(String(12))
    mensaje: Mapped[str] = mapped_column(Text)
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class DesignDevPost(Base):
    __tablename__ = "design_dev_posts"

    id: Mapped[int] = mapped_column(primary_key=True)
    titulo: Mapped[str] = mapped_column(String(200))
    cuerpo: Mapped[str] = mapped_column(Text)
    categoria: Mapped[str] = mapped_column(String(12))
    proyecto_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fijado: Mapped[bool] = mapped_column(Boolean, default=False)
    enlaces: Mapped[str] = mapped_column(Text, default="[]")     # JSON [{label, url}]
    autor_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    autor: Mapped[str] = mapped_column(String(150), default="")
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    actualizado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class DesignDevPostMarca(Base):
    """Leído / útil de cada persona en cada post (tipo = 'leido' | 'util')."""
    __tablename__ = "design_dev_post_marcas"

    post_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    empleado_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tipo: Mapped[str] = mapped_column(String(6), primary_key=True)
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class DesignDevApoyo(Base):
    """Personas de apoyo de un proyecto (tipo 'p') o de un riesgo (tipo 'r'), además del responsable principal."""
    __tablename__ = "design_dev_apoyos"

    id: Mapped[int] = mapped_column(primary_key=True)
    tipo: Mapped[str] = mapped_column(String(1))
    ref_id: Mapped[int] = mapped_column(Integer, index=True)
    empleado_id: Mapped[int] = mapped_column(Integer)
    nombre: Mapped[str] = mapped_column(String(150), default="")


class DesignInvitado(Base):
    """Invitados de solo lectura (Parameters › Invitados, 20-oct-2026): entran con Zoho, ven todo Design y no cambian nada.
    Su fila en `empleados` (cargo «Invitado (solo lectura)») la crea app/invitados.agregar."""
    __tablename__ = "design_invitados"

    email: Mapped[str] = mapped_column(String(150), primary_key=True)
    nombre: Mapped[str] = mapped_column(String(150), default="")
    activo: Mapped[bool] = mapped_column(Boolean, default=True)
    empleado_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    creado_por: Mapped[str] = mapped_column(String(150), default="")
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)



class DesignCopiaRD(Base):
    """Removable Denture (20-oct-2026): copia de una orden de N3 / N6 cuyo producto dice «Removable». La original la sigue
    trabajando su equipo; Nestor diseña la removable en la copia (estado y horas propios). Orden, paciente, centro y
    producto se copian siempre de la original (services_design.sincronizar_copia_rd)."""
    __tablename__ = "design_copias_rd"

    rd_orden_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    origen_orden_id: Mapped[int] = mapped_column(Integer, index=True)
    origen_team_id: Mapped[int] = mapped_column(Integer)
    creada_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


# ---------- Centro de avisos (Cliq) · Rosember, 20-oct-2026 ----------
# Qué envía el bot, a dónde y qué ha enviado. Lo administran los admins de Design (/design/avisos). Ver services_design_avisos.

class DesignCliqGrupo(Base):
    """Un grupo de destinos con nombre (p. ej. «Managers N3»): canales de Cliq y personas (mensaje directo del bot)."""
    __tablename__ = "design_cliq_grupos"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(120))
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    actualizado_por: Mapped[str] = mapped_column(String(150), default="")


class DesignCliqDestino(Base):
    """Un destino del grupo: tipo «canal» (Unique Name del canal) o «persona» (correo de Zoho)."""
    __tablename__ = "design_cliq_destinos"

    id: Mapped[int] = mapped_column(primary_key=True)
    grupo_id: Mapped[int] = mapped_column(ForeignKey("design_cliq_grupos.id"), index=True)
    tipo: Mapped[str] = mapped_column(String(10), default="canal")
    valor: Mapped[str] = mapped_column(String(200))
    orden: Mapped[int] = mapped_column(Integer, default=0)


class DesignCliqMensaje(Base):
    """Un mensaje del bot: texto con variables, cuándo se envía y a qué grupos.
    disparador: «turno_support» (al empezar cada turno), «cambio_support» (el día de la rotación, a prog_hora),
    «programado» (prog_tipo «una» = prog_fecha + prog_hora; «semanal» = prog_dias + prog_hora) o «manual».
    `sistema` marca los que la plataforma ya enviaba antes del Centro (no se borran, solo se pausan)."""
    __tablename__ = "design_cliq_mensajes"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(120))
    activo: Mapped[bool] = mapped_column(Boolean, default=True)
    bot: Mapped[str] = mapped_column(String(100), default="")   # vacío = el bot por defecto (DESIGN_CLIQ_BOT)
    texto: Mapped[str] = mapped_column(Text, default="")
    disparador: Mapped[str] = mapped_column(String(20), default="manual")
    prog_tipo: Mapped[str] = mapped_column(String(10), default="una")
    prog_fecha: Mapped[date | None] = mapped_column(Date, nullable=True)
    prog_hora: Mapped[str] = mapped_column(String(5), default="")
    prog_dias: Mapped[str] = mapped_column(String(20), default="")
    saltar_festivos: Mapped[bool] = mapped_column(Boolean, default=True)
    grupos: Mapped[str] = mapped_column(String(400), default="")   # ids de DesignCliqGrupo separados por coma
    sistema: Mapped[str | None] = mapped_column(String(40), nullable=True, unique=True)
    orden: Mapped[int] = mapped_column(Integer, default=0)
    actualizado_por: Mapped[str] = mapped_column(String(150), default="")
    actualizado_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class DesignCliqEnvio(Base):
    """Historial: una fila por destino de cada envío (también los fallidos, con lo que respondió Cliq)."""
    __tablename__ = "design_cliq_envios"

    id: Mapped[int] = mapped_column(primary_key=True)
    mensaje_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    mensaje_nombre: Mapped[str] = mapped_column(String(120), default="")
    grupo_nombre: Mapped[str] = mapped_column(String(120), default="")
    tipo: Mapped[str] = mapped_column(String(10), default="canal")
    destino: Mapped[str] = mapped_column(String(200), default="")
    bot: Mapped[str] = mapped_column(String(100), default="")
    texto: Mapped[str] = mapped_column(Text, default="")
    ok: Mapped[bool] = mapped_column(Boolean, default=False)
    detalle: Mapped[str] = mapped_column(String(400), default="")
    origen: Mapped[str] = mapped_column(String(20), default="auto")   # auto | manual | prueba | reintento
    por: Mapped[str] = mapped_column(String(150), default="Sistema")
    en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class DesignReporte(Base):
    """Dashboard › Reportes (Rosember, 21-oct-2026): reportes en PDF subidos a mano (p. ej. el de fallas de dicom2stl).
    Los reportes mensuales de la plataforma no se guardan: se arman al abrirlos (services_design_reportes)."""
    __tablename__ = "design_reportes"

    id: Mapped[int] = mapped_column(primary_key=True)
    titulo: Mapped[str] = mapped_column(String(200), default="")
    mes: Mapped[str] = mapped_column(String(7), index=True)   # 2026-10
    nombre_archivo: Mapped[str] = mapped_column(String(200), default="")
    tam: Mapped[int] = mapped_column(Integer, default=0)
    datos: Mapped[bytes] = mapped_column(LargeBinary)
    subido_por: Mapped[str] = mapped_column(String(150), default="")
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
