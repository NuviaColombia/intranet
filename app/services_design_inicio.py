"""Página de Inicio de Design (/design/inicio): editor tipo WordPress para admins (borrador, publicar, historial),
biblioteca de medios (imágenes y videos cortos) y muro interno de publicaciones."""
import os
import json
from datetime import datetime
from sqlalchemy.orm import Session
from .models import Empleado
import secrets
from datetime import timedelta
from .models_design import DesignInicioPagina, DesignInicioVersion, DesignInicioMedio, DesignInicioMedioParte, DesignInicioMuro

MAX_VERSIONES = 30
MAX_IMAGEN = 10 * 1024 * 1024
MAX_VIDEO = 100 * 1024 * 1024
PARTE = 4 * 1024 * 1024          # los videos se suben y se guardan en pedazos de este tamaño
MAX_ENVIO_DIRECTO = 8 * 1024 * 1024   # subida de un solo envío (imágenes y videos muy cortos): más grande va por partes
MAX_CONTENIDO = 5 * 1024 * 1024  # el JSON de la página (las imágenes van aparte, como medios)
TIPOS_IMAGEN = {"image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml"}
TIPOS_VIDEO = {"video/mp4", "video/webm", "video/quicktime", "video/ogg"}  # los que Chrome y Edge reproducen sin convertir
# algunos equipos envían el video sin tipo (o como "octet-stream"): se reconoce por la extensión
EXT_VIDEO = {".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".ogv": "video/ogg", ".ogg": "video/ogg"}
VIDEO_NO_VISIBLE = (".avi", ".wmv", ".mkv", ".flv", ".3gp", ".mpg", ".mpeg")


class Conflicto(Exception):
    def __init__(self, pagina: DesignInicioPagina):
        self.pagina = pagina


def es_editor(user: Empleado) -> bool:
    return user.rol in ("admin", "superadmin")


def _pagina(db: Session) -> DesignInicioPagina:
    p = db.query(DesignInicioPagina).order_by(DesignInicioPagina.id).first()
    if not p:
        p = DesignInicioPagina(borrador="", publicado="", version=1)
        db.add(p)
        db.commit()
        db.refresh(p)
    return p


def _cargar(txt: str):
    try:
        v = json.loads(txt or "")
        return v if isinstance(v, dict) else None
    except (ValueError, TypeError):
        return None


def publicada(db: Session) -> dict | None:
    return _cargar(_pagina(db).publicado)


def estado(db: Session) -> dict:
    p = _pagina(db)
    return {"contenido": _cargar(p.borrador) or _cargar(p.publicado), "version": p.version,
            "actualizadoEn": p.actualizado_en.isoformat() if p.actualizado_en else None, "actualizadoPor": p.actualizado_por,
            "publicadoEn": p.publicado_en.isoformat() if p.publicado_en else None, "publicadoPor": p.publicado_por,
            "hayCambios": (p.borrador or "") not in ("", p.publicado or "")}


def _validar(contenido: dict) -> str:
    if not isinstance(contenido, dict) or not isinstance(contenido.get("secciones", []), list):
        raise ValueError("Contenido de página no válido.")
    txt = json.dumps(contenido, ensure_ascii=False)
    if len(txt.encode()) > MAX_CONTENIDO:
        raise ValueError("La página es demasiado grande. Sube las imágenes a la biblioteca en vez de pegarlas.")
    return txt


def guardar_borrador(db: Session, user: Empleado, contenido: dict, version: int, forzar: bool = False) -> DesignInicioPagina:
    """Guarda solo si nadie guardó antes (la versión se compara y se sube en una sola operación: dos admins que
    guardan al mismo tiempo no se pisan; el segundo recibe Conflicto y su editor combina los cambios)."""
    p = _pagina(db)
    txt = _validar(contenido)
    q = db.query(DesignInicioPagina).filter(DesignInicioPagina.id == p.id)
    if not forzar:
        q = q.filter(DesignInicioPagina.version == version)
    n = q.update({DesignInicioPagina.borrador: txt, DesignInicioPagina.version: DesignInicioPagina.version + 1,
                  DesignInicioPagina.actualizado_en: datetime.utcnow(), DesignInicioPagina.actualizado_por: user.nombre_completo},
                 synchronize_session=False)
    db.commit()
    db.refresh(p)
    if not n:
        raise Conflicto(p)
    return p


def publicar(db: Session, user: Empleado) -> DesignInicioPagina:
    p = _pagina(db)
    contenido = p.borrador or p.publicado
    if not _cargar(contenido):
        raise ValueError("No hay nada para publicar.")
    p.publicado = contenido
    p.publicado_en = datetime.utcnow()
    p.publicado_por = user.nombre_completo
    db.add(DesignInicioVersion(contenido=contenido, publicado_por=user.nombre_completo))
    db.flush()
    viejas = db.query(DesignInicioVersion.id).order_by(DesignInicioVersion.id.desc()).offset(MAX_VERSIONES).all()
    if viejas:
        db.query(DesignInicioVersion).filter(DesignInicioVersion.id.in_([v.id for v in viejas])).delete(synchronize_session=False)
    db.commit()
    return p


def descartar(db: Session, user: Empleado) -> DesignInicioPagina:
    """El borrador vuelve a ser igual a lo publicado."""
    p = _pagina(db)
    p.borrador = p.publicado or ""
    p.version += 1
    p.actualizado_en = datetime.utcnow()
    p.actualizado_por = user.nombre_completo
    db.commit()
    return p


def versiones(db: Session) -> list[dict]:
    return [{"id": v.id, "publicadoEn": v.publicado_en.isoformat(), "publicadoPor": v.publicado_por}
            for v in db.query(DesignInicioVersion).order_by(DesignInicioVersion.id.desc()).all()]


def restaurar_version(db: Session, user: Empleado, version_id: int) -> DesignInicioPagina:
    v = db.get(DesignInicioVersion, version_id)
    if not v:
        raise KeyError(version_id)
    p = _pagina(db)
    p.borrador = v.contenido
    p.version += 1
    p.actualizado_en = datetime.utcnow()
    p.actualizado_por = user.nombre_completo
    db.commit()
    return p


# ---------- Medios ----------

def medio_resumen(m: DesignInicioMedio) -> dict:
    return {"id": m.id, "tipo": m.tipo, "nombre": m.nombre, "mime": m.mime, "tamano": m.tamano, "ancho": m.ancho, "alto": m.alto,
            "url": f"/design/inicio/medio/{m.id}", "creadoPor": m.creado_por, "creadoEn": m.creado_en.isoformat()}


def medios(db: Session) -> list[dict]:
    return [medio_resumen(m) for m in db.query(DesignInicioMedio).order_by(DesignInicioMedio.id.desc()).all()]


def medio_crear(db: Session, user: Empleado, nombre: str, mime: str, datos: bytes, ancho: int = 0, alto: int = 0) -> DesignInicioMedio:
    mime = (mime or "").lower().split(";")[0].strip()
    ext = os.path.splitext((nombre or "").lower())[1]
    if ext in VIDEO_NO_VISIBLE:
        raise ValueError(f"Los videos {ext.upper()[1:]} no se pueden ver en el navegador. Conviértelo a MP4 o pega el enlace de YouTube, Vimeo o WorkDrive.")
    if mime not in TIPOS_IMAGEN and mime not in TIPOS_VIDEO and ext in EXT_VIDEO:
        mime = EXT_VIDEO[ext]
    if mime in TIPOS_IMAGEN:
        tipo, limite = "imagen", MAX_IMAGEN
    elif mime in TIPOS_VIDEO:
        tipo, limite = "video", MAX_VIDEO
    else:
        raise ValueError("Formato no admitido. Imágenes: JPG, PNG, WEBP, GIF o SVG. Videos: MP4, WEBM, MOV u OGG.")
    if not datos:
        raise ValueError("El archivo está vacío.")
    if len(datos) > limite:
        raise ValueError(f"El archivo supera {limite // (1024 * 1024)} MB. Para videos largos pega el enlace de YouTube, Vimeo o WorkDrive.")
    if tipo == "video" and len(datos) > MAX_ENVIO_DIRECTO:
        raise ValueError("Los videos de más de 8 MB se suben por partes (vuelve a cargar la página e inténtalo de nuevo).")
    m = DesignInicioMedio(tipo=tipo, nombre=(nombre or "archivo")[:255], mime=mime, tamano=len(datos), datos=datos,
                          ancho=max(0, int(ancho or 0)), alto=max(0, int(alto or 0)), creado_por=user.nombre_completo)
    db.add(m)
    db.commit()
    db.refresh(m)
    return m


def medio_eliminar(db: Session, medio_id: int) -> bool:
    m = db.get(DesignInicioMedio, medio_id)
    if not m:
        return False
    db.query(DesignInicioMedioParte).filter(DesignInicioMedioParte.medio_id == medio_id).delete(synchronize_session=False)
    db.delete(m)
    db.commit()
    return True


# ---------- Videos por partes ----------

def _tipo_video(nombre: str, mime: str) -> str:
    mime = (mime or "").lower().split(";")[0].strip()
    ext = os.path.splitext((nombre or "").lower())[1]
    if ext in VIDEO_NO_VISIBLE:
        raise ValueError(f"Los videos {ext.upper()[1:]} no se pueden ver en el navegador. Conviértelo a MP4 o pega el enlace de YouTube, Vimeo o WorkDrive.")
    if mime not in TIPOS_VIDEO and ext in EXT_VIDEO:
        mime = EXT_VIDEO[ext]
    if mime not in TIPOS_VIDEO:
        raise ValueError("Formato no admitido. Videos: MP4, WEBM, MOV u OGG.")
    return mime


def subida_iniciar(db: Session, nombre: str, mime: str, tamano: int) -> dict:
    """Empieza la subida de un video por partes. Devuelve la clave de la subida y el tamaño de cada parte."""
    _tipo_video(nombre, mime)
    if tamano <= 0:
        raise ValueError("El archivo está vacío.")
    if tamano > MAX_VIDEO:
        raise ValueError(f"El video supera {MAX_VIDEO // (1024 * 1024)} MB. Recórtalo o pega el enlace de YouTube, Vimeo o WorkDrive.")
    # subidas que quedaron a medias hace más de un día: se borran
    viejo = datetime.utcnow() - timedelta(days=1)
    db.query(DesignInicioMedioParte).filter(DesignInicioMedioParte.medio_id.is_(None), DesignInicioMedioParte.creado_en < viejo).delete(synchronize_session=False)
    db.commit()
    return {"subida": secrets.token_hex(16), "parte": PARTE, "partes": -(-tamano // PARTE)}


def subida_parte(db: Session, subida: str, n: int, datos: bytes) -> None:
    if not subida or len(subida) > 40 or n < 0 or n * PARTE >= MAX_VIDEO:
        raise ValueError("Parte no válida.")
    if not datos or len(datos) > PARTE:
        raise ValueError("Parte no válida.")
    # si la parte se reenvía (reintento), reemplaza la anterior
    db.query(DesignInicioMedioParte).filter(DesignInicioMedioParte.subida == subida, DesignInicioMedioParte.medio_id.is_(None), DesignInicioMedioParte.n == n).delete(synchronize_session=False)
    db.add(DesignInicioMedioParte(subida=subida, n=n, tamano=len(datos), datos=datos))
    db.commit()


def subida_fin(db: Session, user: Empleado, subida: str, nombre: str, mime: str, ancho: int = 0, alto: int = 0) -> DesignInicioMedio:
    mime = _tipo_video(nombre, mime)
    partes = db.query(DesignInicioMedioParte.id, DesignInicioMedioParte.n, DesignInicioMedioParte.tamano).filter(
        DesignInicioMedioParte.subida == subida, DesignInicioMedioParte.medio_id.is_(None)).order_by(DesignInicioMedioParte.n).all()
    if not partes:
        raise ValueError("No llegó ninguna parte del video.")
    if [p.n for p in partes] != list(range(len(partes))):
        raise ValueError("Faltan partes del video; vuelve a subirlo.")
    if any(p.tamano != PARTE for p in partes[:-1]):
        raise ValueError("Las partes del video no están completas; vuelve a subirlo.")
    total = sum(p.tamano for p in partes)
    if total > MAX_VIDEO:
        raise ValueError(f"El video supera {MAX_VIDEO // (1024 * 1024)} MB.")
    m = DesignInicioMedio(tipo="video", nombre=(nombre or "video")[:255], mime=mime, tamano=total, datos=b"",
                          ancho=max(0, int(ancho or 0)), alto=max(0, int(alto or 0)), creado_por=user.nombre_completo)
    db.add(m)
    db.flush()
    db.query(DesignInicioMedioParte).filter(DesignInicioMedioParte.subida == subida, DesignInicioMedioParte.medio_id.is_(None)).update({"medio_id": m.id}, synchronize_session=False)
    db.commit()
    db.refresh(m)
    return m


def medio_por_partes(db: Session, medio_id: int) -> bool:
    return db.query(DesignInicioMedioParte.id).filter(DesignInicioMedioParte.medio_id == medio_id).first() is not None


def medio_leer(db: Session, medio_id: int, ini: int, fin: int) -> bytes:
    """Bytes [ini, fin] de un video guardado por partes: solo se leen las partes que hacen falta."""
    n0, n1 = ini // PARTE, fin // PARTE
    out = []
    for p in db.query(DesignInicioMedioParte.n, DesignInicioMedioParte.datos).filter(
            DesignInicioMedioParte.medio_id == medio_id, DesignInicioMedioParte.n >= n0, DesignInicioMedioParte.n <= n1).order_by(DesignInicioMedioParte.n):
        d = bytes(p.datos); base = p.n * PARTE
        out.append(d[max(0, ini - base):max(0, fin - base + 1)])
    return b"".join(out)


# ---------- Muro ----------

def muro_resumen(x: DesignInicioMuro) -> dict:
    return {"id": x.id, "titulo": x.titulo, "texto": x.texto, "imagen": x.imagen, "fijado": bool(x.fijado),
            "creadoPor": x.creado_por, "creadoEn": x.creado_en.isoformat(), "editadoEn": x.editado_en.isoformat() if x.editado_en else None}


def muro(db: Session, limite: int = 50) -> list[dict]:
    q = (db.query(DesignInicioMuro).filter(DesignInicioMuro.activo == 1)
         .order_by(DesignInicioMuro.fijado.desc(), DesignInicioMuro.creado_en.desc()).limit(max(1, min(limite, 200))))
    return [muro_resumen(x) for x in q.all()]


def _imagen_valida(v: str) -> str:
    v = (v or "").strip()
    if not v or v.startswith("medio:") or v.startswith("https://"):
        return v[:300]
    raise ValueError("La imagen debe ser de la biblioteca o una dirección https.")


def muro_guardar(db: Session, user: Empleado, datos: dict, post_id: int | None = None) -> DesignInicioMuro:
    titulo, texto = (datos.get("titulo") or "").strip()[:200], (datos.get("texto") or "").strip()
    if not titulo and not texto:
        raise ValueError("Escribe un título o un texto.")
    x = db.get(DesignInicioMuro, post_id) if post_id else DesignInicioMuro(creado_por=user.nombre_completo)
    if post_id and (not x or not x.activo):
        raise KeyError(post_id)
    x.titulo, x.texto, x.imagen, x.fijado = titulo, texto[:20000], _imagen_valida(datos.get("imagen")), 1 if datos.get("fijado") else 0
    if post_id:
        x.editado_en = datetime.utcnow()
    db.add(x)
    db.commit()
    db.refresh(x)
    return x


def muro_eliminar(db: Session, post_id: int) -> bool:
    x = db.get(DesignInicioMuro, post_id)
    if not x or not x.activo:
        return False
    x.activo = 0
    db.commit()
    return True


# ---------- En vivo ----------
# Quién está en el editor (en memoria: el servidor corre en un solo proceso). {empleado_id: {...}}
_presencia: dict[int, dict] = {}
PRESENCIA_SEG = 15


def vivo(db: Session) -> dict:
    """Huellas para que la página abierta se actualice sola: lo publicado y el muro."""
    from sqlalchemy import func
    p = _pagina(db)
    m = db.query(func.count(DesignInicioMuro.id), func.max(DesignInicioMuro.id), func.max(DesignInicioMuro.editado_en)).filter(DesignInicioMuro.activo == 1).one()
    return {"pub": p.publicado_en.isoformat() if p.publicado_en else "", "muro": f"{m[0]}-{m[1]}-{m[2]}"}


def presencia(db: Session, user: Empleado, seleccion: str = "") -> dict:
    ahora = datetime.utcnow()
    _presencia[user.id] = {"id": user.id, "nombre": " ".join((user.nombres or "").split()[:1] + (user.apellidos or "").split()[:1]) or user.nombre_completo,
                           "sel": (seleccion or "")[:60], "visto": ahora}
    for k in [k for k, v in _presencia.items() if (ahora - v["visto"]).total_seconds() > PRESENCIA_SEG]:
        _presencia.pop(k, None)
    p = _pagina(db)
    return {"version": p.version, "actualizadoPor": p.actualizado_por,
            "editores": [{"id": v["id"], "nombre": v["nombre"], "sel": v["sel"]} for v in _presencia.values() if v["id"] != user.id]}


def salir_editor(user: Empleado) -> None:
    _presencia.pop(user.id, None)
