"""Mural de Design (13-oct-2026): avisos importantes que se comparten en otros canales, pegados en una pared.

- Quien edita (MURAL_EDITORES) sube los avisos como borrador, les pone título, los ordena y los publica.
- Lo publicado lo ve todo el que tiene el módulo Design; mientras no haya nada publicado, el botón Mural solo lo ve
  quien edita.
- Las imágenes llegan ya comprimidas (WebP) desde el navegador, así que pesan poco en la base (≈150 KB cada una).
"""
import json
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy import func
from sqlalchemy.orm import Session

from .models import Empleado
from .models_design import DesignMuralAviso

MURAL_EDITORES = {"rosember@nuviasmiles.com"}
MAX_IMAGEN = 6 * 1024 * 1024       # tamaño completo ya comprimido
MAX_MINIATURA = 600 * 1024
TIPOS = {"image/webp", "image/jpeg", "image/png"}
DIAS_NUEVO = 7                      # cinta "Nuevo" en los avisos publicados hace menos de una semana
_SEMILLA = Path(__file__).resolve().parent / "seed_data" / "mural"


def es_editor(user: Empleado | None) -> bool:
    return bool(user) and (user.email or "").strip().lower() in MURAL_EDITORES


# ¿Hay algo publicado? Se consulta en cada página de Design (botón del menú), así que se guarda unos segundos en memoria.
_cache = {"t": 0.0, "v": False}
_lock = threading.Lock()


def hay_publicados(db: Session | None = None) -> bool:
    if time.monotonic() - _cache["t"] < 30:
        return _cache["v"]
    from .database import SessionLocal
    propia = db is None
    db = db or SessionLocal()
    try:
        v = db.query(DesignMuralAviso.id).filter(DesignMuralAviso.publicado.is_(True),
                                                 DesignMuralAviso.eliminado.is_(False)).first() is not None
    finally:
        if propia:
            db.close()
    _cache.update(t=time.monotonic(), v=v)
    return v


def _invalidar():
    _cache["t"] = 0.0


def ve_mural(user: Empleado | None) -> bool:
    """Botón Mural del menú: quien edita siempre; el resto de Design cuando ya hay avisos publicados."""
    if not user:
        return False
    return es_editor(user) or (user.tiene_modulo("design_schedule") and hay_publicados())


# ---------- Carga inicial (los posters que entregó Rosember el 13-oct-2026, como borrador) ----------

_sembrado = False


def _manifiesto() -> list[dict]:
    man = _SEMILLA / "avisos.json"
    return json.loads(man.read_text(encoding="utf-8")) if man.exists() else []


def _fecha_fija(semilla: str) -> datetime | None:
    """Fecha de publicación pedida para un aviso de la carga inicial (p. ej. el de morfologías: 7-sep-2026, el día
    en que se compartió). Se guarda a mediodía UTC para que en Colombia se vea ese mismo día."""
    if not semilla:
        return None
    for a in _manifiesto():
        if a["clave"] == semilla and a.get("publicadoEn"):
            return datetime.fromisoformat(a["publicadoEn"]).replace(hour=12)
    return None


def _ajustar_semillas(db: Session) -> None:
    """Cambios pedidos después de la carga inicial: título nuevo (solo si nadie lo cambió a mano) y fecha fija."""
    man = {a["clave"]: a for a in _manifiesto()}
    for av in db.query(DesignMuralAviso).filter(DesignMuralAviso.semilla.in_(list(man)), DesignMuralAviso.eliminado.is_(False)):
        a = man[av.semilla]
        if av.titulo in a.get("titulo_antes", []):
            av.titulo = a["titulo"]
        f = _fecha_fija(av.semilla)
        if f and av.publicado and av.publicado_en != f:
            av.publicado_en = f
    db.commit()


def sembrar_una_vez(db: Session) -> None:
    global _sembrado
    if _sembrado:
        return
    with _lock:
        if _sembrado:
            return
        ya = {s for (s,) in db.query(DesignMuralAviso.semilla).filter(DesignMuralAviso.semilla != "").all()}
        orden = (db.query(func.max(DesignMuralAviso.orden)).scalar() or 0)
        for a in _manifiesto():
            if a["clave"] in ya:
                continue
            orden += 1
            full = (_SEMILLA / f"{a['clave']}.webp").read_bytes()
            db.add(DesignMuralAviso(titulo=a["titulo"], ancho=a["ancho"], alto=a["alto"], tamano=len(full),
                                    datos=full, miniatura=(_SEMILLA / f"{a['clave']}_mini.webp").read_bytes(),
                                    orden=orden, semilla=a["clave"]))
        db.commit()
        _ajustar_semillas(db)
        _sembrado = True


# ---------- Consulta ----------

def _json(a: DesignMuralAviso, ahora: datetime) -> dict:
    v = int((a.actualizado_en or a.creado_en).timestamp())
    return {"id": a.id, "titulo": a.titulo, "ancho": a.ancho, "alto": a.alto, "publicado": bool(a.publicado),
            "publicadoEn": (a.publicado_en.isoformat() + "Z") if a.publicado_en else "",
            "nuevo": bool(a.publicado and a.publicado_en and ahora - a.publicado_en < timedelta(days=DIAS_NUEVO)),
            "mini": f"/design/api/mural/{a.id}/imagen?t=mini&v={v}", "full": f"/design/api/mural/{a.id}/imagen?v={v}"}


def listar(db: Session, user: Empleado) -> dict:
    q = db.query(DesignMuralAviso).filter(DesignMuralAviso.eliminado.is_(False))
    editor = es_editor(user)
    if not editor:
        q = q.filter(DesignMuralAviso.publicado.is_(True))
    ahora = datetime.utcnow()
    # Del más nuevo al más viejo según la fecha de publicación; los borradores (solo los ve quien edita) van primero.
    avisos = sorted(q.all(), key=lambda a: (a.publicado, -(a.publicado_en or a.creado_en).timestamp(), a.id))
    items = [_json(a, ahora) for a in avisos]
    return {"editor": editor, "items": items, "borradores": sum(1 for x in items if not x["publicado"])}


def imagen(db: Session, user: Empleado, aviso_id: int, mini: bool) -> tuple[bytes, str] | None:
    a = db.get(DesignMuralAviso, aviso_id)
    if not a or a.eliminado or not (a.publicado or es_editor(user)):
        return None
    datos = (a.miniatura or a.datos) if mini else a.datos
    return (datos, "image/webp" if mini else a.mime) if datos else None


# ---------- Edición (solo quien edita; el router lo valida) ----------

def _firma(datos: bytes) -> str | None:
    if datos[:4] == b"RIFF" and datos[8:12] == b"WEBP":
        return "image/webp"
    if datos[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if datos[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    return None


def subir(db: Session, user: Empleado, titulo: str, datos: bytes, mini: bytes | None, ancho: int, alto: int) -> dict:
    if not datos or len(datos) > MAX_IMAGEN:
        raise ValueError("La imagen está vacía o pesa más de 6 MB.")
    mime = _firma(datos)
    if mime not in TIPOS:
        raise ValueError("Solo se aceptan imágenes JPG, PNG o WebP.")
    if mini is not None and (len(mini) > MAX_MINIATURA or _firma(mini) not in TIPOS):
        mini = None
    orden = (db.query(func.max(DesignMuralAviso.orden)).scalar() or 0) + 1
    a = DesignMuralAviso(titulo=(titulo or "").strip()[:200] or "Aviso", mime=mime, ancho=max(0, ancho), alto=max(0, alto),
                         tamano=len(datos), datos=datos, miniatura=mini, orden=orden, creado_por_id=user.id)
    db.add(a)
    db.commit()
    return _json(a, datetime.utcnow())


def _aviso(db: Session, aviso_id: int) -> DesignMuralAviso:
    a = db.get(DesignMuralAviso, aviso_id)
    if not a or a.eliminado:
        raise LookupError("Ese aviso ya no existe.")
    return a


# ---------- Push al publicar (Rosember, 22-oct-2026) ----------
# Cada aviso que se publica manda un push a todas las personas con acceso a Design (menos a quien lo publica): uno por
# aviso, que se queda en pantalla hasta que lo cierren (fijo). Al tocarlo abre el Mural en ese aviso.

def destinatarios(db: Session) -> list[int]:
    return [e.id for e in db.query(Empleado).filter(Empleado.activo == 1) if e.tiene_modulo("design_schedule")]


def _push(db: Session, avisos: list[DesignMuralAviso], ids: list[int], segundo_plano: bool) -> dict:
    from . import services_design_push as sp
    total = {"avisos": 0, "enviados": 0, "fallidos": 0, "sinSuscripcion": 0, "personas": len(set(ids))}
    for a in avisos:
        args = (ids, "📌 Nuevo en el Mural", f"{a.titulo} · tócalo para verlo", f"/design/mural?aviso={a.id}", f"mural-{a.id}")
        total["avisos"] += 1
        if segundo_plano:
            sp.enviar_en_segundo_plano(*args, fijo=True)
            continue
        r = sp.enviar(db, *args, fijo=True)
        for k in ("enviados", "fallidos"):
            total[k] += r[k]
        total["sinSuscripcion"] = r["sinSuscripcion"]
    return total


def avisar_publicados(db: Session, avisos: list[DesignMuralAviso], quien: Empleado | None) -> None:
    if not avisos:
        return
    ids = [i for i in destinatarios(db) if not quien or i != quien.id]
    _push(db, avisos, ids, segundo_plano=True)


def avisar_nuevos(db: Session, user: Empleado, prueba: bool) -> dict:
    """Push de los avisos publicados que aún tienen la cinta «Nuevo»: prueba = solo a quien lo pide; si no, a todo Design."""
    ahora = datetime.utcnow()
    avisos = [a for a in db.query(DesignMuralAviso).filter(DesignMuralAviso.eliminado.is_(False), DesignMuralAviso.publicado.is_(True))
              if a.publicado_en and ahora - a.publicado_en < timedelta(days=DIAS_NUEVO)]
    avisos.sort(key=lambda a: a.publicado_en)
    ids = [user.id] if prueba else [i for i in destinatarios(db) if i != user.id]
    return _push(db, avisos, ids, segundo_plano=False)


def editar(db: Session, aviso_id: int, titulo: str | None = None, publicado: bool | None = None, quien: Empleado | None = None) -> dict:
    a = _aviso(db, aviso_id)
    nuevo_publicado = False
    if titulo is not None:
        a.titulo = titulo.strip()[:200] or a.titulo
    if publicado is not None and bool(publicado) != bool(a.publicado):
        a.publicado = bool(publicado)
        a.publicado_en = (_fecha_fija(a.semilla) or datetime.utcnow()) if publicado else None
        nuevo_publicado = bool(publicado)
    db.commit()
    _invalidar()
    if nuevo_publicado:
        avisar_publicados(db, [a], quien)
    return _json(a, datetime.utcnow())


def publicar_borradores(db: Session, quien: Empleado | None = None) -> int:
    ahora = datetime.utcnow()
    n = 0
    nuevos = []
    for a in db.query(DesignMuralAviso).filter(DesignMuralAviso.eliminado.is_(False), DesignMuralAviso.publicado.is_(False)):
        a.publicado, a.publicado_en = True, _fecha_fija(a.semilla) or ahora
        nuevos.append(a)
        n += 1
    db.commit()
    _invalidar()
    avisar_publicados(db, nuevos, quien)
    return n


def ordenar(db: Session, ids: list[int]) -> None:
    pos = {i: n for n, i in enumerate(ids, 1)}
    for a in db.query(DesignMuralAviso).filter(DesignMuralAviso.id.in_(list(pos))):
        a.orden = pos[a.id]
    db.commit()


def eliminar(db: Session, aviso_id: int) -> None:
    """Vacía las imágenes (libera el espacio) y deja la fila marcada como eliminada."""
    a = _aviso(db, aviso_id)
    a.eliminado, a.publicado, a.datos, a.miniatura = True, False, None, None
    db.commit()
    _invalidar()
