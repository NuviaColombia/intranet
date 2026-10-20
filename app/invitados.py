"""Invitados de solo lectura (Rosember, 20-oct-2026). Se administran en Design › Parameters › Invitados.

Un invitado entra con su cuenta de Zoho y ve todo Design como si fuera administrador, pero no puede cambiar nada en
ninguna parte de la plataforma: cualquier petición que no sea de lectura (POST, PUT, PATCH, DELETE) se rechaza en
auth.get_current_user. Para que el inicio de sesión lo reconozca necesita su fila en `empleados`; agregar() la crea
(cargo «Invitado (solo lectura)», empresa Nuvia Design, sin fecha de nacimiento ni equipo). Quitar a un invitado lo
deja inactivo (no puede entrar) sin borrar nada.
"""
import re
import time
from datetime import datetime

from sqlalchemy.orm import Session

from .models import EMPRESA_DESIGN, Empleado

INICIALES = {"jhonatan@nuviasmiles.com": "Jhonatan"}   # el primero, pedido por Rosember el 20-oct-2026
CARGO_INVITADO = "Invitado (solo lectura)"
# Peticiones que sí puede hacer aunque no sean de lectura: no cambian datos de nadie más (sus avisos push, su modo
# oscuro, marcar como visto el anuncio de cumpleaños).
_PERMITIDAS = ("/design/api/push/suscribir", "/design/api/push/desuscribir", "/design/api/preferencias/tema",
               "/cumple/api/visto")
MSG_SOLO_LECTURA = "Entraste como invitado: puedes ver todo, pero no hacer cambios."
_CACHE: dict = {"t": 0.0, "v": None}
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[a-z]{2,}$", re.I)


def _activos() -> set[str]:
    """Correos de los invitados activos (se lee de la base cada 20 s: se consulta en cada clic)."""
    if _CACHE["v"] is not None and time.monotonic() - _CACHE["t"] < 20:
        return _CACHE["v"]
    from .database import SessionLocal
    from .models_design import DesignInvitado
    db = SessionLocal()
    try:
        v = {e for (e,) in db.query(DesignInvitado.email).filter(DesignInvitado.activo.is_(True))}
    except Exception:  # noqa: BLE001  tabla aún no creada (primer arranque)
        v = set()
    finally:
        db.close()
    _CACHE["t"], _CACHE["v"] = time.monotonic(), v
    return v


def _invalidar():
    _CACHE["v"] = None


def es_invitado(user) -> bool:
    return bool(user) and (getattr(user, "email", "") or "").strip().lower() in _activos()


def peticion_permitida(metodo: str, ruta: str) -> bool:
    return metodo in ("GET", "HEAD", "OPTIONS") or any(ruta.startswith(p) for p in _PERMITIDAS)


def listar(db: Session) -> list[dict]:
    from .models_design import DesignInvitado
    return [{"email": x.email, "nombre": x.nombre, "activo": bool(x.activo), "creadoPor": x.creado_por,
             "creadoEn": x.creado_en.strftime("%d/%m/%Y") if x.creado_en else ""}
            for x in db.query(DesignInvitado).order_by(DesignInvitado.activo.desc(), DesignInvitado.nombre)]


def agregar(db: Session, email: str, nombre: str, por: str) -> str | None:
    """Da acceso de invitado. Devuelve el mensaje de error, o None si quedó."""
    from .models_design import DesignInvitado
    email, nombre = (email or "").strip().lower(), " ".join((nombre or "").split())[:150]
    if not _EMAIL.match(email):
        return "Escribe un correo válido (el de su cuenta de Zoho)."
    if len(nombre) < 2:
        return "Escribe el nombre del invitado."
    e = db.query(Empleado).filter(Empleado.email == email).first()
    if e and e.cargo != CARGO_INVITADO:
        return f"{email} ya es de un empleado de la plataforma ({e.nombre_completo}); no se puede volver invitado."
    partes = nombre.split()
    if not e:
        e = Empleado(nombres=partes[0], apellidos=" ".join(partes[1:]) or "Invitado", email=email, rol="empleado", activo=1,
                     empresa=EMPRESA_DESIGN, cargo=CARGO_INVITADO, area="Invitado",
                     identificacion=("INV-" + email.split("@")[0])[:30], modulos="design_schedule",
                     dias_vacaciones=0, num_aprobaciones=1)
        if db.query(Empleado.id).filter(Empleado.identificacion == e.identificacion).first():
            e.identificacion = ("INV-" + email.replace("@", "-"))[:30]
        db.add(e)
        db.flush()
    else:
        e.activo, e.rol, e.modulos, e.empresa = 1, "empleado", "design_schedule", EMPRESA_DESIGN
    x = db.get(DesignInvitado, email)
    if not x:
        x = DesignInvitado(email=email)
        db.add(x)
    x.nombre, x.activo, x.empleado_id, x.creado_por, x.creado_en = nombre, True, e.id, por, datetime.utcnow()
    db.commit()
    _invalidar()
    return None


def quitar(db: Session, email: str) -> bool:
    """Le quita el acceso: queda inactivo (no puede entrar). No borra nada."""
    from .models_design import DesignInvitado
    x = db.get(DesignInvitado, (email or "").strip().lower())
    if not x:
        return False
    x.activo = False
    e = db.query(Empleado).filter(Empleado.email == x.email, Empleado.cargo == CARGO_INVITADO).first()
    if e:
        e.activo = 0
    db.commit()
    _invalidar()
    return True


def asegurar_invitados(db: Session) -> None:
    """Al arrancar: los invitados iniciales (una sola vez; si después los quitan, no vuelven)."""
    from .models_design import DesignInvitado
    for email, nombre in INICIALES.items():
        if not db.get(DesignInvitado, email):
            agregar(db, email, nombre + " Invitado", "Sistema")
