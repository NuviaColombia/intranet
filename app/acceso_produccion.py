"""Acceso por submódulo de Producción (Cambio de custodia, Seguimiento de consumo, ...).

El módulo Producción se da con el permiso "custodia" de People; qué submódulos puede usar cada
persona se configura en Producción › Parámetros (tabla produccion_accesos). Los administradores
entran a todos."""
from datetime import datetime
from fastapi import Depends, HTTPException
from sqlalchemy import String, Integer, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, Session
from .database import Base, get_db
from .models import Empleado
from .auth import require_modulo

MODULO_PRODUCCION = "custodia"   # permiso del módulo en People (nombre histórico)


class ProduccionAcceso(Base):
    __tablename__ = "produccion_accesos"
    __table_args__ = (UniqueConstraint("empleado_id", "submodulo", name="uq_produccion_acceso"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    empleado_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"), index=True)
    submodulo: Mapped[str] = mapped_column(String(40))          # slug de SUBMODULOS_PRODUCCION
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


def es_admin(user: Empleado) -> bool:
    return user.rol in ("admin", "superadmin")


def submodulos_de(db: Session, user: Empleado) -> set[str]:
    return {a.submodulo for a in db.query(ProduccionAcceso).filter(ProduccionAcceso.empleado_id == user.id)}


def tiene_submodulo(db: Session, user: Empleado, slug: str) -> bool:
    if es_admin(user):
        return True
    return user.tiene_modulo(MODULO_PRODUCCION) and db.query(ProduccionAcceso.id).filter(
        ProduccionAcceso.empleado_id == user.id, ProduccionAcceso.submodulo == slug).first() is not None


def ids_con_submodulo(db: Session, slug: str) -> set[int]:
    return {a.empleado_id for a in db.query(ProduccionAcceso).filter(ProduccionAcceso.submodulo == slug)}


def require_submodulo(slug: str):
    """Dependencia: módulo Producción + acceso al submódulo (Producción › Parámetros)."""
    def checker(user: Empleado = Depends(require_modulo(MODULO_PRODUCCION)), db: Session = Depends(get_db)) -> Empleado:
        if not tiene_submodulo(db, user, slug):
            raise HTTPException(status_code=307, headers={"Location": "/inventario?error=sin_acceso_submodulo"})
        return user
    return checker


def asegurar_tabla_y_migrar(engine, SessionLocal) -> None:
    """Crea la tabla y, la primera vez, da Cambio de custodia a quienes ya tenían el módulo Producción."""
    from sqlalchemy import inspect
    if inspect(engine).has_table("produccion_accesos"):
        return  # ya existe: la migración inicial se hizo antes
    try:
        ProduccionAcceso.__table__.create(bind=engine)
    except Exception as e:  # otro proceso la acaba de crear (y migra)
        print(f"Producción: tabla produccion_accesos ya creada ({type(e).__name__}).")
        return
    db = SessionLocal()
    try:
        for e in db.query(Empleado).all():
            if MODULO_PRODUCCION in e.modulos_lista:
                db.add(ProduccionAcceso(empleado_id=e.id, submodulo="custodia"))
        db.commit()
    except Exception as ex:
        db.rollback()
        print(f"Producción: no se pudieron migrar los accesos: {ex}")
    finally:
        db.close()
