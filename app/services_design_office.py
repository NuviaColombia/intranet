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


# ---------------------------------------------------------------------------
# Plantillas (Word y PowerPoint): las administran los admins; todos las usan para crear documentos.
# ---------------------------------------------------------------------------
from .models_design import DesignOfficePlantilla  # noqa: E402

ROLES_ADMIN_PLANTILLAS = ("admin", "superadmin")
MAX_MINIATURA = 400 * 1024


def puede_administrar_plantillas(user: Empleado) -> bool:
    return user.rol in ROLES_ADMIN_PLANTILLAS


def plantilla_resumen(p: DesignOfficePlantilla, con_miniatura: bool = True) -> dict:
    d = {"id": p.id, "tipo": p.tipo, "titulo": p.titulo, "descripcion": p.descripcion or "", "version": p.version,
         "tamano": p.tamano or 0, "orden": p.orden or 0, "creadoPor": p.creado_por, "actualizadoEn": _iso(p.actualizado_en),
         "actualizadoPor": p.actualizado_por, "esPlantilla": True}
    if con_miniatura:
        d["miniatura"] = p.miniatura or ""
    return d


def plantillas_listar(db: Session) -> list[dict]:
    q = (db.query(DesignOfficePlantilla).options(undefer(DesignOfficePlantilla.miniatura))
         .order_by(DesignOfficePlantilla.tipo, DesignOfficePlantilla.orden, DesignOfficePlantilla.titulo))
    return [plantilla_resumen(p) for p in q]


def plantillas_huella(db: Session) -> str:
    """Huella liviana de las plantillas (sin miniaturas): si cambia, las galerías abiertas vuelven a pedir la lista."""
    import hashlib
    filas = db.query(DesignOfficePlantilla.id, DesignOfficePlantilla.version, DesignOfficePlantilla.titulo,
                     DesignOfficePlantilla.descripcion, DesignOfficePlantilla.actualizado_en).order_by(DesignOfficePlantilla.id).all()
    return hashlib.md5(repr([tuple(f) for f in filas]).encode()).hexdigest()[:16]


def plantilla_obtener(db: Session, pid: int) -> DesignOfficePlantilla:
    p = (db.query(DesignOfficePlantilla).options(undefer(DesignOfficePlantilla.contenido), undefer(DesignOfficePlantilla.ajustes),
                                                 undefer(DesignOfficePlantilla.miniatura))
         .filter(DesignOfficePlantilla.id == pid).first())
    if not p:
        raise KeyError(pid)
    return p


def plantilla_completa(p: DesignOfficePlantilla, user: Empleado) -> dict:
    d = plantilla_resumen(p)
    d["contenido"] = p.contenido or ""
    try:
        d["ajustes"] = json.loads(p.ajustes or "{}")
    except ValueError:
        d["ajustes"] = {}
    d["permiso"] = "dueño" if puede_administrar_plantillas(user) else "ver"
    d["propietario"] = p.creado_por
    return d


def plantilla_crear(db: Session, user: Empleado, tipo: str, titulo: str, descripcion: str, contenido: str,
                    ajustes: dict | None, miniatura: str) -> DesignOfficePlantilla:
    if not puede_administrar_plantillas(user):
        raise SinPermiso()
    if tipo not in TIPOS:
        raise ValueError("Tipo de plantilla no válido.")
    aj = json.dumps(ajustes or {}, ensure_ascii=False)
    t = _tamano(contenido, aj)
    if t > MAX_BYTES:
        raise ValueError("La plantilla supera 40 MB. Reduce el tamaño de las imágenes.")
    ahora = datetime.utcnow()
    p = DesignOfficePlantilla(tipo=tipo, titulo=(titulo or "").strip()[:255] or "Plantilla", descripcion=(descripcion or "")[:500],
                              contenido=contenido or "", ajustes=aj, miniatura=(miniatura or "")[:MAX_MINIATURA], version=1, tamano=t,
                              creado_por=user.nombre_completo, creado_en=ahora, actualizado_en=ahora, actualizado_por=user.nombre_completo)
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


def plantilla_guardar(db: Session, pid: int, user: Empleado, version: int, titulo: str | None, descripcion: str | None,
                      contenido: str | None, ajustes: dict | None, miniatura: str | None, forzar: bool = False) -> DesignOfficePlantilla:
    if not puede_administrar_plantillas(user):
        raise SinPermiso()
    p = plantilla_obtener(db, pid)
    if not forzar and version != p.version:
        raise Conflicto(p)
    if titulo is not None:
        p.titulo = titulo.strip()[:255] or p.titulo
    if descripcion is not None:
        p.descripcion = descripcion[:500]
    if contenido is not None:
        p.contenido = contenido
    if ajustes is not None:
        p.ajustes = json.dumps(ajustes, ensure_ascii=False)
    if miniatura is not None:
        p.miniatura = miniatura[:MAX_MINIATURA]
    t = _tamano(p.contenido, p.ajustes)
    if t > MAX_BYTES:
        db.rollback()
        raise ValueError("La plantilla supera 40 MB. Reduce el tamaño de las imágenes.")
    p.tamano = t
    p.version = (p.version or 0) + 1
    p.actualizado_en = datetime.utcnow()
    p.actualizado_por = user.nombre_completo
    db.commit()
    db.refresh(p)
    return p


def plantilla_eliminar(db: Session, pid: int, user: Empleado) -> None:
    if not puede_administrar_plantillas(user):
        raise SinPermiso()
    db.delete(plantilla_obtener(db, pid))
    db.commit()


def plantilla_usar(db: Session, pid: int, user: Empleado, titulo: str | None = None) -> DesignOfficeDoc:
    """Crea un documento de la persona a partir de la plantilla (las fechas "de hoy" siguen siendo campos)."""
    p = plantilla_obtener(db, pid)
    try:
        aj = json.loads(p.ajustes or "{}")
    except ValueError:
        aj = {}
    aj["plantillaId"] = p.id
    return crear(db, user, p.tipo, (titulo or p.titulo)[:255], p.contenido, aj)
