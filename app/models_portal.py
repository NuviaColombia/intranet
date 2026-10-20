"""Página principal del portal (/) armada con el editor tipo WordPress (solo superadmins): borrador,
publicar, historial, biblioteca de medios y muro interno. Mismo diseño que la página de Inicio de
Design (models_design.py: DesignInicioPagina/Version/Medio/Muro), copiado aparte para no tocar el
editor que usa el equipo de Design todos los días."""
from datetime import datetime
from sqlalchemy import String, Integer, DateTime, Text, LargeBinary, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from .database import Base


class PortalInicioPagina(Base):
    """Página principal (/) armada con el editor. Una sola fila: `borrador` es lo que se está
    editando y `publicado` lo que ven todos. Ambos en JSON (secciones y bloques)."""
    __tablename__ = "portal_inicio_pagina"

    id: Mapped[int] = mapped_column(primary_key=True)
    borrador: Mapped[str] = mapped_column(Text, default="")
    publicado: Mapped[str] = mapped_column(Text, default="")
    version: Mapped[int] = mapped_column(Integer, default=1)  # del borrador (dos editores a la vez no se pisan)
    actualizado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    actualizado_por: Mapped[str] = mapped_column(String(150), default="")
    publicado_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    publicado_por: Mapped[str] = mapped_column(String(150), default="")


class PortalInicioVersion(Base):
    """Cada publicación de la página principal (para volver a una anterior)."""
    __tablename__ = "portal_inicio_versiones"

    id: Mapped[int] = mapped_column(primary_key=True)
    contenido: Mapped[str] = mapped_column(Text, deferred=True)
    publicado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    publicado_por: Mapped[str] = mapped_column(String(150), default="")


class PortalInicioMedio(Base):
    """Imágenes y videos cortos (mp4) subidos para la página principal."""
    __tablename__ = "portal_inicio_medios"

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


class PortalInicioMedioParte(Base):
    """Pedazos (4 MB) de los videos de la página principal. Se suben y se leen por partes para no
    cargar el video entero en la memoria del servidor. Mientras se sube, medio_id está vacío."""
    __tablename__ = "portal_inicio_medio_partes"

    id: Mapped[int] = mapped_column(primary_key=True)
    subida: Mapped[str] = mapped_column(String(40), index=True)
    medio_id: Mapped[int | None] = mapped_column(Integer, index=True, nullable=True)
    n: Mapped[int] = mapped_column(Integer, default=0)
    tamano: Mapped[int] = mapped_column(Integer, default=0)
    datos: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class PortalInicioMuro(Base):
    """Publicaciones del muro interno de la página principal (anuncios, logros…). Las hacen los
    superadmins."""
    __tablename__ = "portal_inicio_muro"

    id: Mapped[int] = mapped_column(primary_key=True)
    titulo: Mapped[str] = mapped_column(String(200), default="")
    texto: Mapped[str] = mapped_column(Text, default="")
    imagen: Mapped[str] = mapped_column(String(300), default="")  # "medio:ID" o dirección https
    fijado: Mapped[int] = mapped_column(Integer, default=0)
    activo: Mapped[int] = mapped_column(Integer, default=1)
    creado_por: Mapped[str] = mapped_column(String(150), default="")
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    editado_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class PortalInicioMuroBloque(Base):
    """En qué bloque de Novedades (id del bloque en la página) se hizo cada publicación del muro:
    cada bloque muestra solo las suyas. Las publicaciones sin fila salen en el primer bloque."""
    __tablename__ = "portal_inicio_muro_bloque"

    post_id: Mapped[int] = mapped_column(ForeignKey("portal_inicio_muro.id"), primary_key=True)
    bloque_id: Mapped[str] = mapped_column(String(40), index=True)


class PortalInicioReaccion(Base):
    """Reacción con emoji de una persona a una publicación del muro (una fila por persona y emoji;
    reaccionar otra vez la quita)."""
    __tablename__ = "portal_inicio_reacciones"
    __table_args__ = (UniqueConstraint("post_id", "empleado_id", "emoji", name="uq_portal_inicio_reaccion"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    post_id: Mapped[int] = mapped_column(ForeignKey("portal_inicio_muro.id"), index=True)
    empleado_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"))
    emoji: Mapped[str] = mapped_column(String(16))
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
