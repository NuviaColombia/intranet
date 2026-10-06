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
from .auth import require_modulo, get_current_user

MODULO_PRODUCCION = "custodia"   # permiso del módulo en People (nombre histórico)
EMPRESA_PRODUCCION = "Nuvia Smiles Colombia SAS"  # Producción (Custodia, Consumo) es exclusivo de esta empresa


class ProduccionAcceso(Base):
    __tablename__ = "produccion_accesos"
    __table_args__ = (UniqueConstraint("empleado_id", "submodulo", name="uq_produccion_acceso"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    empleado_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"), index=True)
    submodulo: Mapped[str] = mapped_column(String(40))          # slug de SUBMODULOS_PRODUCCION
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ProduccionAdmin(Base):
    """Administradores de Producción: entran con todos los permisos a todos los submódulos de Producción y a sus
    Parámetros, sin ser administradores del resto de la intranet. Los asigna un administrador en
    Producción › Parámetros › General."""
    __tablename__ = "produccion_admins"

    empleado_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"), primary_key=True)
    asignado_por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    asignado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


def es_admin_produccion(user: Empleado | None) -> bool:
    """¿Está en la lista de administradores de Producción? (se consulta una vez por petición y se recuerda)."""
    if user is None or not getattr(user, "id", None):
        return False
    guardado = user.__dict__.get("_admin_produccion")
    if guardado is None:
        from .database import SessionLocal
        db = SessionLocal()
        try:
            guardado = bool(user.activo) and db.get(ProduccionAdmin, user.id) is not None
        except Exception:  # la tabla aún no existe (primer arranque)
            guardado = False
        finally:
            db.close()
        user.__dict__["_admin_produccion"] = guardado
    return guardado


def es_admin(user: Empleado) -> bool:
    """Superadmin administra todo; un admin normal solo si es de Nuvia Smiles -- Producción
    (Custodia, Consumo) es exclusivo de esa empresa, igual que SST. Además, los administradores de Producción."""
    if user.rol == "superadmin":
        return True
    return (user.rol == "admin" and user.empresa == EMPRESA_PRODUCCION) or es_admin_produccion(user)


def require_admin_produccion(user: Empleado = Depends(get_current_user)) -> Empleado:
    """Parámetros de Producción: administradores de la intranet o administradores de Producción."""
    if user.rol not in ("admin", "superadmin") and not es_admin_produccion(user):
        raise HTTPException(403, "Requiere ser administrador (de la intranet o de Producción).")
    return user


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
