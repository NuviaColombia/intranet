"""Acceso por sección (pestaña) dentro de cada submódulo: Cambio de custodia, Seguimiento de consumo y Caja menor.

Se configura por persona en los Parámetros de cada módulo (Producción › Parámetros y Caja menor › Parámetros).
Si a una persona no se le ha configurado nada, ve todas las secciones (como hasta ahora). Los administradores
siempre ven todas. Además de ocultar las pestañas, las acciones de cada sección se bloquean en el servidor.
"""
from datetime import datetime
from fastapi import HTTPException
from sqlalchemy import String, Text, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, Session
from .database import Base
from .models import Empleado

# Secciones de cada submódulo, en el orden de la barra: (slug de la pestaña, nombre)
SECCIONES = {
    "custodia": [("nueva-orden", "Nueva orden"), ("registro", "Nuevo registro"), ("aprobaciones", "Aprobaciones/Firmas"),
                 ("existencias", "Dashboard"), ("activas", "Estado órdenes"), ("consulta", "Consulta traslado")],
    "consumo": [("entrega", "Entrega de insumos"), ("consulta", "Consulta"), ("jornada", "Jornada diaria"),
                ("reportes", "Reportes")],
    "conteo": [("nuevo", "Conteo del mes"), ("validacion", "Validación"), ("reportes", "Reportes")],
    "caja": [("recibo", "Nuevo recibo"), ("consulta", "Consulta"), ("legalizar", "Legalizar"), ("fms", "Historial FM"),
             ("arqueo", "Arqueo rápido"), ("firmas", "Firmas")],
}
NOMBRE_MODULO = {"custodia": "Cambio de custodia", "consumo": "Seguimiento de consumo", "caja": "Caja menor",
                 "conteo": "Conteo inventario mensual"}


class SeccionAcceso(Base):
    """Secciones permitidas a una persona en un submódulo (si no hay fila, tiene todas)."""
    __tablename__ = "accesos_secciones"
    __table_args__ = (UniqueConstraint("empleado_id", "modulo", name="uq_acceso_seccion"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    empleado_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"), index=True)
    modulo: Mapped[str] = mapped_column(String(30))       # clave de SECCIONES
    secciones: Mapped[str] = mapped_column(Text, default="")  # slugs permitidos, separados por coma
    actualizado_por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    actualizado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


def _es_admin(user: Empleado) -> bool:
    return user.rol in ("admin", "superadmin")


def todas(modulo: str) -> list[str]:
    return [s for s, _ in SECCIONES[modulo]]


def secciones_de(db: Session, user: Empleado, modulo: str) -> list[str]:
    """Slugs de las secciones que la persona puede usar en el submódulo, en el orden de la barra."""
    if _es_admin(user):
        return todas(modulo)
    fila = db.query(SeccionAcceso).filter(SeccionAcceso.empleado_id == user.id, SeccionAcceso.modulo == modulo).first()
    if not fila:
        return todas(modulo)
    permitidas = set((fila.secciones or "").split(","))
    return [s for s in todas(modulo) if s in permitidas]


def configuracion(db: Session, modulo: str) -> dict[int, list[str]]:
    """{empleado_id: [secciones]} de quienes tienen secciones restringidas (para la página de Parámetros)."""
    return {f.empleado_id: [s for s in todas(modulo) if s in set((f.secciones or "").split(","))]
            for f in db.query(SeccionAcceso).filter(SeccionAcceso.modulo == modulo)}


def guardar(db: Session, empleado_id: int, modulo: str, secciones: list[str], admin: Empleado) -> str | None:
    """Guarda las secciones permitidas. Todas marcadas = sin restricción (se borra la fila)."""
    if modulo not in SECCIONES:
        return "Módulo desconocido."
    elegidas = [s for s in todas(modulo) if s in set(secciones)]
    if not elegidas:
        return "No se guardó: deja al menos una sección. Para que no entre, usa «Quitar acceso»."
    fila = db.query(SeccionAcceso).filter(SeccionAcceso.empleado_id == empleado_id, SeccionAcceso.modulo == modulo).first()
    if len(elegidas) == len(todas(modulo)):
        if fila:
            db.delete(fila)
    else:
        if not fila:
            fila = SeccionAcceso(empleado_id=empleado_id, modulo=modulo)
            db.add(fila)
        fila.secciones, fila.actualizado_por_id, fila.actualizado_en = ",".join(elegidas), admin.id, datetime.utcnow()
    db.commit()
    return None


def quitar(db: Session, empleado_id: int, modulo: str) -> None:
    """Al quitar el acceso al submódulo se borra también su configuración de secciones."""
    db.query(SeccionAcceso).filter(SeccionAcceso.empleado_id == empleado_id, SeccionAcceso.modulo == modulo).delete()


def exigir(db: Session, user: Empleado, modulo: str, *secciones: str) -> None:
    """Bloquea la acción si la persona no tiene ninguna de esas secciones del submódulo."""
    if any(s in secciones_de(db, user, modulo) for s in secciones):
        return
    nombres = dict(SECCIONES[modulo])
    raise HTTPException(403, f"No tienes acceso a la sección {' / '.join(nombres[s] for s in secciones)} de "
                             f"{NOMBRE_MODULO[modulo]}. Pídeselo a un administrador (Parámetros › Accesos).")
