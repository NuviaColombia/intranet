"""Nuvia Office (Design › Herramientas): documentos (Word) y presentaciones (PowerPoint) guardados en la plataforma.

Cada documento es de quien lo crea; se puede compartir con otros aprobadores y admins de Design para ver o
editar. Al guardar se envía la versión que se tenía: si otra ventana guardó antes, se avisa (409) en vez de
pisar el cambio. Eliminar lo manda a "Eliminados" (se puede restaurar); el dueño lo puede borrar del todo.
"""
import json
from datetime import datetime
from sqlalchemy.orm import Session, undefer
from .models import Empleado
from .models_design import DesignOfficeDoc, DesignOfficeCompartido

TIPOS = ("word", "ppt")
MAX_BYTES = 40 * 1024 * 1024  # 40 MB por documento (imágenes incluidas)
ROLES_OFFICE = ("aprobador", "admin", "superadmin")


class SinPermiso(Exception):
    pass


class Conflicto(Exception):
    def __init__(self, doc: DesignOfficeDoc):
        self.doc = doc


def _iso(d: datetime | None) -> str | None:
    return (d.isoformat() + "Z") if d else None


def permiso(db: Session, doc: DesignOfficeDoc, user: Empleado) -> str | None:
    """'dueño' | 'editar' | 'ver' | None."""
    if doc.propietario_id == user.id:
        return "dueño"
    c = (db.query(DesignOfficeCompartido)
         .filter(DesignOfficeCompartido.doc_id == doc.id, DesignOfficeCompartido.empleado_id == user.id).first())
    if not c or doc.eliminado_en:
        return None
    return "editar" if c.puede_editar else "ver"


def resumen(doc: DesignOfficeDoc, permiso_: str) -> dict:
    return {"id": doc.id, "tipo": doc.tipo, "titulo": doc.titulo, "version": doc.version, "tamano": doc.tamano or 0,
            "propietario": doc.propietario.nombre_completo if doc.propietario else "",
            "propietarioId": doc.propietario_id, "creadoEn": _iso(doc.creado_en), "actualizadoEn": _iso(doc.actualizado_en),
            "actualizadoPor": doc.actualizado_por, "eliminadoEn": _iso(doc.eliminado_en), "permiso": permiso_}


def listar(db: Session, user: Empleado) -> dict:
    propios = (db.query(DesignOfficeDoc).filter(DesignOfficeDoc.propietario_id == user.id)
               .order_by(DesignOfficeDoc.actualizado_en.desc()).all())
    comp = {c.doc_id: c for c in db.query(DesignOfficeCompartido).filter(DesignOfficeCompartido.empleado_id == user.id)}
    compartidos = (db.query(DesignOfficeDoc).filter(DesignOfficeDoc.id.in_(list(comp) or [0]), DesignOfficeDoc.eliminado_en.is_(None))
                   .order_by(DesignOfficeDoc.actualizado_en.desc()).all())
    return {"mios": [resumen(d, "dueño") for d in propios if not d.eliminado_en],
            "eliminados": [resumen(d, "dueño") for d in propios if d.eliminado_en],
            "compartidos": [resumen(d, "editar" if comp[d.id].puede_editar else "ver") for d in compartidos]}


def obtener(db: Session, doc_id: int, user: Empleado) -> tuple[DesignOfficeDoc, str]:
    doc = (db.query(DesignOfficeDoc).options(undefer(DesignOfficeDoc.contenido), undefer(DesignOfficeDoc.ajustes))
           .filter(DesignOfficeDoc.id == doc_id).first())
    if not doc:
        raise KeyError(doc_id)
    p = permiso(db, doc, user)
    if not p:
        raise SinPermiso()
    return doc, p


def completo(db: Session, doc: DesignOfficeDoc, p: str) -> dict:
    d = resumen(doc, p)
    d["contenido"] = doc.contenido or ""
    try:
        d["ajustes"] = json.loads(doc.ajustes or "{}")
    except ValueError:
        d["ajustes"] = {}
    if p == "dueño":
        d["compartido"] = [{"empleadoId": c.empleado_id, "nombre": c.empleado.nombre_completo if c.empleado else "",
                            "puedeEditar": bool(c.puede_editar)}
                           for c in db.query(DesignOfficeCompartido).filter(DesignOfficeCompartido.doc_id == doc.id)]
    return d


def _tamano(contenido: str, ajustes: str) -> int:
    return len((contenido or "").encode("utf-8")) + len((ajustes or "").encode("utf-8"))


def crear(db: Session, user: Empleado, tipo: str, titulo: str, contenido: str, ajustes: dict | None) -> DesignOfficeDoc:
    if tipo not in TIPOS:
        raise ValueError("Tipo de documento no válido.")
    aj = json.dumps(ajustes or {}, ensure_ascii=False)
    t = _tamano(contenido, aj)
    if t > MAX_BYTES:
        raise ValueError("El documento supera 40 MB. Reduce el tamaño de las imágenes.")
    ahora = datetime.utcnow()
    doc = DesignOfficeDoc(tipo=tipo, titulo=(titulo or "").strip()[:255] or ("Presentación" if tipo == "ppt" else "Documento"),
                          contenido=contenido or "", ajustes=aj, version=1, tamano=t, propietario_id=user.id,
                          creado_en=ahora, actualizado_en=ahora, actualizado_por=user.nombre_completo)
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return doc


def guardar(db: Session, doc_id: int, user: Empleado, version: int, titulo: str | None, contenido: str | None,
            ajustes: dict | None, forzar: bool = False) -> DesignOfficeDoc:
    doc, p = obtener(db, doc_id, user)
    if p not in ("dueño", "editar") or doc.eliminado_en:
        raise SinPermiso()
    if not forzar and version != doc.version:
        raise Conflicto(doc)
    if titulo is not None:
        doc.titulo = titulo.strip()[:255] or doc.titulo
    if contenido is not None:
        doc.contenido = contenido
    if ajustes is not None:
        doc.ajustes = json.dumps(ajustes, ensure_ascii=False)
    t = _tamano(doc.contenido, doc.ajustes)
    if t > MAX_BYTES:
        db.rollback()
        raise ValueError("El documento supera 40 MB. Reduce el tamaño de las imágenes.")
    doc.tamano = t
    doc.version = (doc.version or 0) + 1
    doc.actualizado_en = datetime.utcnow()
    doc.actualizado_por = user.nombre_completo
    db.commit()
    db.refresh(doc)
    return doc


def eliminar(db: Session, doc_id: int, user: Empleado) -> None:
    doc, p = obtener(db, doc_id, user)
    if p != "dueño":
        raise SinPermiso()
    doc.eliminado_en = datetime.utcnow()
    db.commit()


def restaurar(db: Session, doc_id: int, user: Empleado) -> None:
    doc, p = obtener(db, doc_id, user)
    if p != "dueño":
        raise SinPermiso()
    doc.eliminado_en = None
    db.commit()


def borrar_definitivo(db: Session, doc_id: int, user: Empleado) -> None:
    doc, p = obtener(db, doc_id, user)
    if p != "dueño":
        raise SinPermiso()
    db.query(DesignOfficeCompartido).filter(DesignOfficeCompartido.doc_id == doc.id).delete()
    db.delete(doc)
    db.commit()


def duplicar(db: Session, doc_id: int, user: Empleado) -> DesignOfficeDoc:
    doc, _ = obtener(db, doc_id, user)
    try:
        aj = json.loads(doc.ajustes or "{}")
    except ValueError:
        aj = {}
    return crear(db, user, doc.tipo, ("Copia de " + doc.titulo)[:255], doc.contenido, aj)


def personas(db: Session, user: Empleado) -> list[dict]:
    """Con quién se puede compartir: aprobadores y admins activos con acceso a Design (sin la propia persona)."""
    out = []
    for e in (db.query(Empleado).filter(Empleado.activo == 1, Empleado.id != user.id, Empleado.rol.in_(ROLES_OFFICE))
              .order_by(Empleado.nombres, Empleado.apellidos)):
        if e.tiene_modulo("design_schedule"):
            out.append({"id": e.id, "nombre": e.nombre_completo, "email": e.email})
    return out


def compartir(db: Session, doc_id: int, user: Empleado, empleado_id: int, puede_editar: bool) -> None:
    doc, p = obtener(db, doc_id, user)
    if p != "dueño":
        raise SinPermiso()
    if empleado_id not in {x["id"] for x in personas(db, user)}:
        raise ValueError("Solo se puede compartir con aprobadores y admins de Design.")
    c = (db.query(DesignOfficeCompartido)
         .filter(DesignOfficeCompartido.doc_id == doc.id, DesignOfficeCompartido.empleado_id == empleado_id).first())
    if c:
        c.puede_editar = bool(puede_editar)
    else:
        db.add(DesignOfficeCompartido(doc_id=doc.id, empleado_id=empleado_id, puede_editar=bool(puede_editar)))
    db.commit()


def dejar_de_compartir(db: Session, doc_id: int, user: Empleado, empleado_id: int) -> None:
    doc, p = obtener(db, doc_id, user)
    if p != "dueño":
        raise SinPermiso()
    db.query(DesignOfficeCompartido).filter(DesignOfficeCompartido.doc_id == doc.id,
                                            DesignOfficeCompartido.empleado_id == empleado_id).delete()
    db.commit()
