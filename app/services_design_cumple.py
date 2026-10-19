"""Cumpleaños (Rosember, 19-oct-2026): la pieza «¡Feliz Cumpleaños!» de Canva generada sola con los datos de People.

- Quién: personas activas de Nuvia Design con fecha de nacimiento (las mismas del Calendario). Nombre en la pieza:
  primer nombre + primer apellido; cargo: el de People. Sin foto de perfil NO hay anuncio (se avisa en Formatos Canva).
- Anuncio: la primera vez que cada persona entra a la plataforma ese día (cualquier módulo), a pantalla completa y
  animado; si cumplen varias, carrusel. Se cierra con Esc o con la X. «Ya lo vio» se guarda en la base (DesignCumpleVisto).
- La pieza se dibuja en el navegador (static/design/cumple/cumple.js) sobre el fondo de la plantilla original.
"""
import time
from datetime import date, timedelta

from sqlalchemy.orm import Session

from .models import EMPRESA_DESIGN, Empleado
from .models_design import DesignCumpleVisto, DesignFotoPerfil
from . import services_design as sd

_CACHE: dict = {}   # fecha -> (momento, personas): la lista del día se calcula una vez por minuto


def _dia_en(anio: int, nac: date) -> date:
    try:
        return date(anio, nac.month, nac.day)
    except ValueError:   # 29 de febrero en un año que no es bisiesto
        return date(anio, 2, 28)


def nombre_corto(nombres: str, apellidos: str) -> str:
    """«Cristian Andrés» + «Guzmán Pérez» → «Cristian Guzmán» (como en las piezas de Canva)."""
    n = (nombres or "").split()
    a = (apellidos or "").split()
    return " ".join(x for x in (n[0] if n else "", a[0] if a else "") if x)


def _con_foto(db: Session, ids: list[int]) -> set[int]:
    if not ids:
        return set()
    return {i for (i,) in db.query(DesignFotoPerfil.empleado_id).filter(DesignFotoPerfil.empleado_id.in_(ids), DesignFotoPerfil.datos.isnot(None))}


def personas_entre(db: Session, desde: date, hasta: date) -> list[dict]:
    """Cumpleaños entre dos fechas (incluidas), ordenados por fecha. Incluye si tiene foto de perfil."""
    gente = (db.query(Empleado.id, Empleado.nombres, Empleado.apellidos, Empleado.cargo, Empleado.fecha_nacimiento)
             .filter(Empleado.activo == 1, Empleado.fecha_nacimiento.isnot(None), Empleado.empresa == EMPRESA_DESIGN).all())
    out = []
    for eid, nombres, apellidos, cargo, nac in gente:
        for anio in range(desde.year, hasta.year + 1):
            dia = _dia_en(anio, nac)
            if desde <= dia <= hasta:
                out.append({"id": eid, "fecha": dia.isoformat(), "nombre": nombre_corto(nombres, apellidos),
                            "nombreCompleto": f"{nombres or ''} {apellidos or ''}".strip(), "cargo": (cargo or "").strip()})
    fotos = _con_foto(db, [p["id"] for p in out])
    for p in out:
        p["tieneFoto"] = p["id"] in fotos
        p["foto"] = f"/cumple/foto/{p['id']}" if p["tieneFoto"] else None
    return sorted(out, key=lambda p: (p["fecha"], sd._normalizar_texto(p["nombre"])))


def de_hoy(db: Session, hoy: date | None = None) -> list[dict]:
    """Quienes cumplen hoy y tienen foto de perfil (sin foto no se anuncia)."""
    hoy = hoy or sd.ahora_colombia().date()
    c = _CACHE.get(hoy)
    if c and time.monotonic() - c[0] < 60:
        return c[1]
    lista = [p for p in personas_entre(db, hoy, hoy) if p["tieneFoto"]]
    _CACHE.clear()
    _CACHE[hoy] = (time.monotonic(), lista)
    return lista


_VISTOS: set = set()   # (empleado_id, fecha) ya confirmados: no se vuelve a consultar la base en cada página


def ya_visto(db: Session, user: Empleado, hoy: date | None = None) -> bool:
    hoy = hoy or sd.ahora_colombia().date()
    if (user.id, hoy) in _VISTOS:
        return True
    if db.get(DesignCumpleVisto, (user.id, hoy)) is None:
        return False
    if len(_VISTOS) > 5000:
        _VISTOS.clear()
    _VISTOS.add((user.id, hoy))
    return True


def hay_anuncio(user: Empleado) -> bool:
    """Para base.html (cada página): ¿le falta a esta persona ver el anuncio de hoy? Barato: la lista del día va en
    caché un minuto y «ya lo vio» en memoria; solo abre una sesión de base si hace falta."""
    if not user or not getattr(user, "id", None):
        return False
    hoy = sd.ahora_colombia().date()
    if (user.id, hoy) in _VISTOS:
        return False
    c = _CACHE.get(hoy)
    if c and time.monotonic() - c[0] < 60 and not c[1]:
        return False
    from .database import SessionLocal
    with SessionLocal() as db:
        return bool(de_hoy(db, hoy)) and not ya_visto(db, user, hoy)


def pendiente(db: Session, user: Empleado) -> list[dict]:
    """El anuncio que le falta ver hoy a esta persona (vacío si no hay cumpleaños o ya lo vio)."""
    if not user:
        return []
    lista = de_hoy(db)
    if not lista or ya_visto(db, user):
        return []
    return lista


def marcar_visto(db: Session, user: Empleado) -> None:
    hoy = sd.ahora_colombia().date()
    if not ya_visto(db, user, hoy):
        db.add(DesignCumpleVisto(empleado_id=user.id, fecha=hoy))
        try:
            db.commit()
        except Exception:   # dos pestañas a la vez: ya quedó marcado por la otra
            db.rollback()
    _VISTOS.add((user.id, hoy))


def proximo_con_foto(db: Session, desde: date | None = None) -> list[dict]:
    """Para probar: el cumpleaños con foto más próximo (y los de ese mismo día)."""
    desde = desde or sd.ahora_colombia().date()
    for p in personas_entre(db, desde, desde + timedelta(days=366)):
        if p["tieneFoto"]:
            return [x for x in personas_entre(db, date.fromisoformat(p["fecha"]), date.fromisoformat(p["fecha"])) if x["tieneFoto"]]
    return []


def foto_permitida(db: Session, user: Empleado, empleado_id: int) -> bool:
    """La foto de perfil de alguien solo se entrega para su pieza: si cumple hoy, o a un admin (Formatos Canva / prueba)."""
    if sd.es_admin(user):
        return True
    return any(p["id"] == empleado_id for p in de_hoy(db))
