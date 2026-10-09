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
    Compartida por todo el equipo (como Protocols); favorito es por empleado."""
    __tablename__ = "design_comentario_templates"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(150))
    texto: Mapped[str] = mapped_column(Text)
    es_fija: Mapped[int] = mapped_column(Integer, default=0)
    orden: Mapped[int] = mapped_column(Integer, default=0)
    creado_por: Mapped[str] = mapped_column(String(150), default="")
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


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


# ---------------------------------------------------------------------------
# Papelera: registro de borrados en paneles estructurales (Pre-Approved, y lo
# que se sume después: Protocols, Canvas), con snapshot suficiente para
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
    tipo: Mapped[str] = mapped_column(String(20))  # "team" | "preapproved" | "protocolo" | "cmt_template"
    team_id: Mapped[int] = mapped_column(ForeignKey("design_teams.id"), nullable=True)
    preapproved_sheet_id: Mapped[int] = mapped_column(ForeignKey("design_preapproved_sheets.id"), nullable=True)
    protocolo_id: Mapped[int] = mapped_column(ForeignKey("design_protocolos.id"), nullable=True)
    cmt_template_id: Mapped[int] = mapped_column(ForeignKey("design_comentario_templates.id"), nullable=True)
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


class DesignProtocoloArea(Base):
    """Áreas en las que se ve un protocolo (uno puede compartirse entre varias).
    Un protocolo sin filas aquí es "General" y se ve en todas las áreas."""
    __tablename__ = "design_protocolo_areas"

    id: Mapped[int] = mapped_column(primary_key=True)
    protocolo_id: Mapped[int] = mapped_column(ForeignKey("design_protocolos.id"), index=True)
    area_id: Mapped[int] = mapped_column(ForeignKey("design_areas.id"))


class DesignProtocoloArchivo(Base):
    """PDF original del protocolo (diapositivas de Zoho Show). protocolo_id queda en NULL
    mientras el protocolo está en la Papelera, para poder restaurarlo con su archivo."""
    __tablename__ = "design_protocolo_archivos"

    id: Mapped[int] = mapped_column(primary_key=True)
    protocolo_id: Mapped[int | None] = mapped_column(ForeignKey("design_protocolos.id"), nullable=True, index=True)
    nombre: Mapped[str] = mapped_column(String(255), default="")
    tamano: Mapped[int] = mapped_column(Integer, default=0)
    paginas: Mapped[int] = mapped_column(Integer, default=0)
    datos: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)  # no se carga salvo que se pida
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


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


class DesignProtocoloMiniatura(Base):
    """Imagen pequeña de la primera diapositiva de un PDF de Protocols, para las tarjetas (así no se abre el
    PDF para cada tarjeta). La genera el navegador la primera vez que alguien ve el protocolo.
    Va por archivo_id (sin llave foránea: se borra junto con el archivo)."""
    __tablename__ = "design_protocolo_miniaturas"

    archivo_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tipo: Mapped[str] = mapped_column(String(30), default="image/jpeg")
    datos: Mapped[bytes] = mapped_column(LargeBinary)
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class DesignProtocoloPagina(Base):
    """Texto de cada diapositiva/página del PDF, para el buscador. texto_norm es el mismo
    texto en minúsculas y sin tildes (misma longitud, para ubicar la coincidencia)."""
    __tablename__ = "design_protocolo_paginas"

    id: Mapped[int] = mapped_column(primary_key=True)
    protocolo_id: Mapped[int] = mapped_column(ForeignKey("design_protocolos.id"), index=True)
    pagina: Mapped[int] = mapped_column(Integer)
    texto: Mapped[str] = mapped_column(Text, default="")
    texto_norm: Mapped[str] = mapped_column(Text, default="")


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
