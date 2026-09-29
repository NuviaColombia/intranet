"""Acceso al módulo SST (control de inventario de EPP), exclusivo de Nuvia Smiles Colombia SAS.

El acceso base ("todos los Managers y administradores") se decide por `rol`, no por
`Empleado.modulos` -- así nadie necesita que se le asigne el módulo a mano cada vez que alguien
cambia de rol en People. Compras y Coordinación SST son capacidades adicionales, fijas por
persona, guardadas en `sst_accesos` (mismo espíritu que `acceso_produccion.py` para Producción)."""
from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session
from .database import get_db
from .models import Empleado
from .auth import get_current_user
from .models_sst import SstAcceso

EMPRESA_SST = "Nuvia Smiles Colombia SAS"


def es_admin_sst(user: Empleado) -> bool:
    return user.rol in ("admin", "superadmin")


def es_manager_sst(user: Empleado) -> bool:
    return user.rol in ("aprobador", "admin", "superadmin")


def roles_sst_de(db: Session, empleado_id: int) -> set[str]:
    return {a.rol_sst for a in db.query(SstAcceso).filter(SstAcceso.empleado_id == empleado_id)}


def es_compras_sst(db: Session, user: Empleado) -> bool:
    if es_admin_sst(user):
        return True
    return "compras" in roles_sst_de(db, user.id)


def es_coordinador_sst(db: Session, user: Empleado) -> bool:
    if es_admin_sst(user):
        return True
    return "coordinador" in roles_sst_de(db, user.id)


def tiene_acceso_sst(db: Session, user: Empleado) -> bool:
    if user.empresa != EMPRESA_SST and not es_admin_sst(user):
        return False
    if es_manager_sst(user):
        return True
    return bool(roles_sst_de(db, user.id))


def puede_sst(user: Empleado | None) -> bool:
    """Global de Jinja para la tarjeta de /: abre su propia sesión, igual que resumen_aprobaciones."""
    if not user:
        return False
    from .database import SessionLocal
    db = SessionLocal()
    try:
        return tiene_acceso_sst(db, user)
    finally:
        db.close()


def require_sst(user: Empleado = Depends(get_current_user), db: Session = Depends(get_db)) -> Empleado:
    if not tiene_acceso_sst(db, user):
        raise HTTPException(status_code=307, headers={"Location": "/?error=sin_acceso"})
    return user


def require_sst_compras(user: Empleado = Depends(require_sst), db: Session = Depends(get_db)) -> Empleado:
    if not es_compras_sst(db, user):
        raise HTTPException(403, "Requiere acceso de Compras en SST.")
    return user


def require_sst_coordinador(user: Empleado = Depends(require_sst), db: Session = Depends(get_db)) -> Empleado:
    if not es_coordinador_sst(db, user):
        raise HTTPException(403, "Requiere acceso de Coordinación SST.")
    return user
