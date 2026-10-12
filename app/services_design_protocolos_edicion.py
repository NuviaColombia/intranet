"""
Editar protocolos en Nuvia Office y publicarlos como versión nueva (pedido por Rosember el 12-oct-2026).

* Borrador: cada protocolo puede tener una presentación de Nuvia Office (DesignProtocoloBorrador). Se arma la primera
  vez desde el PDF publicado (una diapositiva por página) o desde el PowerPoint original (.pptx). Lo editan los admins;
  si un admin abre el borrador de otro, queda compartido con él para editar.
* Publicar: el editor exporta el borrador a PDF y lo sube por partes (como cualquier PDF de Protocols); aquí ese PDF
  pasa a ser el vigente, sube la versión (v1.0 → v1.1, o la que escriba el admin), se actualiza el texto del buscador
  y se guarda en el historial. El PDF anterior no se borra: queda en el historial (y se puede restaurar).
"""
import json
import re
from datetime import datetime

from sqlalchemy import func
from sqlalchemy.orm import Session

from .models import Empleado
from .models_design import (DesignProtocolo, DesignProtocoloArchivo, DesignProtocoloPagina, DesignProtocoloVersion,
                            DesignProtocoloBorrador, DesignOfficeDoc, DesignOfficeCompartido)
from . import services_design as sd
from . import services_design_office as sof


def siguiente_version(v: str) -> str:
    m = re.match(r"^\s*v?(\d+)(?:\.(\d+))?", v or "", re.I)
    return f"v{int(m.group(1))}.{int(m.group(2) or 0) + 1}" if m else "v1.1"


def _info(p: DesignProtocolo) -> dict:
    return {"id": p.id, "titulo": p.titulo, "version": p.version, "siguiente": siguiente_version(p.version)}


# ---------- Borrador ----------

def borrador(db: Session, protocolo_id: int) -> DesignOfficeDoc | None:
    b = db.get(DesignProtocoloBorrador, protocolo_id)
    if not b:
        return None
    doc = db.get(DesignOfficeDoc, b.doc_id)
    if not doc or doc.eliminado_en:  # lo borraron en Nuvia Office: el protocolo queda sin borrador
        db.delete(b)
        db.commit()
        return None
    return doc


def _dar_acceso(db: Session, doc: DesignOfficeDoc, user: Empleado) -> None:
    """Todos los admins editan el borrador: si no es el dueño, queda compartido con él para editar."""
    if doc.propietario_id == user.id:
        return
    c = (db.query(DesignOfficeCompartido)
         .filter(DesignOfficeCompartido.doc_id == doc.id, DesignOfficeCompartido.empleado_id == user.id).first())
    if c:
        c.puede_editar = True
    else:
        db.add(DesignOfficeCompartido(doc_id=doc.id, empleado_id=user.id, puede_editar=True))
    db.commit()


def estado_borrador(db: Session, protocolo_id: int, user: Empleado) -> dict:
    p = db.get(DesignProtocolo, protocolo_id)
    if not p:
        raise KeyError(protocolo_id)
    doc = borrador(db, protocolo_id)
    if doc:
        _dar_acceso(db, doc, user)
    return {"protocolo": _info(p), "docId": doc.id if doc else None,
            "actualizado": (doc.actualizado_en.isoformat() + "Z") if doc and doc.actualizado_en else None,
            "actualizadoPor": doc.actualizado_por if doc else ""}


def crear_borrador(db: Session, protocolo_id: int, user: Empleado, contenido: str, reemplazar: bool = False) -> DesignOfficeDoc:
    p = db.get(DesignProtocolo, protocolo_id)
    if not p:
        raise KeyError(protocolo_id)
    viejo = borrador(db, protocolo_id)
    if viejo and not reemplazar:
        _dar_acceso(db, viejo, user)
        return viejo
    doc = sof.crear(db, user, "ppt", f"Protocolo · {p.titulo}", contenido, {"tipo": "ppt"})
    b = db.get(DesignProtocoloBorrador, protocolo_id)
    if b:  # el borrador anterior sigue en Nuvia Office de su dueño; el protocolo usa el nuevo
        b.doc_id, b.creado_por, b.creado_en = doc.id, user.nombre_completo, datetime.utcnow()
    else:
        db.add(DesignProtocoloBorrador(protocolo_id=protocolo_id, doc_id=doc.id, creado_por=user.nombre_completo))
    db.commit()
    return doc


def protocolo_de_doc(db: Session, doc_id: int) -> dict | None:
    """Si el documento es el borrador de un protocolo (Nuvia Office muestra la banda con Publicar)."""
    b = db.query(DesignProtocoloBorrador).filter(DesignProtocoloBorrador.doc_id == doc_id).first()
    p = db.get(DesignProtocolo, b.protocolo_id) if b else None
    return _info(p) if p else None


# ---------- Publicar e historial ----------

def _textos(db: Session, protocolo_id: int) -> list[str]:
    return [x.texto for x in db.query(DesignProtocoloPagina).filter(DesignProtocoloPagina.protocolo_id == protocolo_id)
            .order_by(DesignProtocoloPagina.pagina)]


def _registrar_inicial(db: Session, p: DesignProtocolo, arch: DesignProtocoloArchivo | None) -> None:
    """La primera vez que se publica, la versión que había entra al historial."""
    if not arch or db.query(DesignProtocoloVersion.id).filter(DesignProtocoloVersion.protocolo_id == p.id).first():
        return
    db.add(DesignProtocoloVersion(protocolo_id=p.id, version=p.version or "v1.0", archivo_id=arch.id,
                                  paginas=json.dumps(_textos(db, p.id), ensure_ascii=False), nota="Versión inicial",
                                  publicado_por=p.creado_por or "", publicado_en=p.creado_en or datetime.utcnow()))
    db.flush()


def publicar(db: Session, protocolo_id: int, archivo_id: int, textos: list[str], version: str, nota: str, por: str) -> DesignProtocolo:
    p = db.get(DesignProtocolo, protocolo_id)
    if not p:
        raise KeyError(protocolo_id)
    a = db.get(DesignProtocoloArchivo, archivo_id)
    if not a or a.protocolo_id is not None:
        raise ValueError("La subida no existe o ya terminó.")
    if sd.pr_archivo_largo(db, archivo_id) != a.tamano:
        raise ValueError("El PDF no llegó completo; vuelve a publicar.")
    inicio = db.query(func.substr(DesignProtocoloArchivo.datos, 1, 4)).filter(DesignProtocoloArchivo.id == archivo_id).scalar()
    if bytes(inicio or b"") != b"%PDF":
        raise ValueError("El archivo no es un PDF.")
    actual = sd.protocolo_archivo(db, p.id)
    _registrar_inicial(db, p, actual)
    if actual:
        actual.protocolo_id = None  # queda en el historial
    a.protocolo_id = p.id
    a.paginas = len(textos or [])
    a.nombre = (re.sub(r'[\\/:*?"<>|]+', " ", p.titulo).strip()[:200] or "protocolo") + ".pdf"
    v = sd.pr_limpiar_texto(version or "").strip()[:20] or siguiente_version(p.version)
    p.version = v
    sd._pr_poner_paginas(db, p.id, textos)
    db.add(DesignProtocoloVersion(protocolo_id=p.id, version=v, archivo_id=a.id, paginas=json.dumps(textos or [], ensure_ascii=False),
                                  nota=sd.pr_limpiar_texto(nota or "").strip()[:500], publicado_por=por or ""))
    db.commit()
    db.refresh(p)
    return p


def versiones(db: Session, protocolo_id: int) -> list[dict]:
    actual = sd.protocolo_archivo(db, protocolo_id)
    filas = (db.query(DesignProtocoloVersion).filter(DesignProtocoloVersion.protocolo_id == protocolo_id)
             .order_by(DesignProtocoloVersion.publicado_en.desc(), DesignProtocoloVersion.id.desc()).all())
    tam = {a.id: (a.tamano, a.paginas) for a in db.query(DesignProtocoloArchivo.id, DesignProtocoloArchivo.tamano, DesignProtocoloArchivo.paginas)
           .filter(DesignProtocoloArchivo.id.in_([f.archivo_id for f in filas] or [0]))}
    vigente = next((f.id for f in filas if actual and f.archivo_id == actual.id), None)
    return [{"id": f.id, "version": f.version, "nota": f.nota, "publicadoPor": f.publicado_por,
             "publicadoEn": f.publicado_en.isoformat() + "Z" if f.publicado_en else None,
             "tamano": tam.get(f.archivo_id, (0, 0))[0], "paginas": tam.get(f.archivo_id, (0, 0))[1],
             "vigente": f.id == vigente, "disponible": f.archivo_id in tam} for f in filas]


def version_archivo(db: Session, version_id: int):
    v = db.get(DesignProtocoloVersion, version_id)
    if not v:
        return None, None
    a = (db.query(DesignProtocoloArchivo.id, DesignProtocoloArchivo.nombre, DesignProtocoloArchivo.tamano)
         .filter(DesignProtocoloArchivo.id == v.archivo_id).first())
    return v, a


def restaurar_version(db: Session, version_id: int, por: str) -> DesignProtocolo:
    v = db.get(DesignProtocoloVersion, version_id)
    p = db.get(DesignProtocolo, v.protocolo_id) if v else None
    if not v or not p:
        raise KeyError(version_id)
    arch = db.get(DesignProtocoloArchivo, v.archivo_id)
    if not arch:
        raise ValueError("El PDF de esa versión ya no existe.")
    actual = sd.protocolo_archivo(db, p.id)
    if actual and actual.id == arch.id:
        raise ValueError("Esa versión ya es la vigente.")
    _registrar_inicial(db, p, actual)
    if actual:
        actual.protocolo_id = None
    arch.protocolo_id = p.id
    try:
        textos = json.loads(v.paginas or "[]")
    except ValueError:
        textos = []
    nueva = siguiente_version(p.version)
    p.version = nueva
    sd._pr_poner_paginas(db, p.id, textos)
    db.add(DesignProtocoloVersion(protocolo_id=p.id, version=nueva, archivo_id=arch.id, paginas=v.paginas or "[]",
                                  nota=f"Restaurada desde {v.version}", publicado_por=por or ""))
    db.commit()
    db.refresh(p)
    return p


def borrar_version(db: Session, version_id: int) -> None:
    """Quita una versión anterior del historial y borra su PDF si nadie más lo usa (para liberar espacio)."""
    from .models_design import DesignProtocoloMiniatura
    v = db.get(DesignProtocoloVersion, version_id)
    if not v:
        raise KeyError(version_id)
    actual = sd.protocolo_archivo(db, v.protocolo_id)
    if actual and actual.id == v.archivo_id:
        raise ValueError("La versión vigente no se puede borrar.")
    archivo_id = v.archivo_id
    db.delete(v)
    db.flush()
    otros = db.query(DesignProtocoloVersion.id).filter(DesignProtocoloVersion.archivo_id == archivo_id).first()
    a = db.get(DesignProtocoloArchivo, archivo_id)
    if a and not otros and a.protocolo_id is None:
        db.query(DesignProtocoloMiniatura).filter(DesignProtocoloMiniatura.archivo_id == archivo_id).delete()
        db.delete(a)
    db.commit()


def archivos_en_historial(db: Session) -> set[int]:
    """PDFs que no se deben borrar aunque no tengan protocolo: los del historial de versiones."""
    return {r[0] for r in db.query(DesignProtocoloVersion.archivo_id)}
