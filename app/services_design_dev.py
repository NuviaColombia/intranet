"""Development (Rosember, 19-oct-2026): control de proyectos y protocolos, integrado desde Desktop\\control-proyectos.

- Quién: solo admins + Luis Felipe Blaschke y Paul Andion (DEV_ESPECIALES). Todos los que entran pueden editar.
- Etapas: Propuesta → Aprobado → En desarrollo → En pruebas (QA) → Lanzado, más Pausado. Para entrar a una etapa hay que
  cumplir sus controles y los de las anteriores; retroceder o pausar pide motivo (queda en la bitácora).
- Responsables (de proyectos y riesgos): personas activas de Nuvia Design; uno principal y, si se quiere, personas de
  apoyo (DesignDevApoyo, máx. MAX_APOYO).
- Idioma: la página puede verse en inglés (cookie cp_lang=en); los mensajes del servidor se traducen con traducir().
- Evidencias: imágenes ya comprimidas en el navegador, ≤ 1 MB y máx. 20 por proyecto (la base de Supabase tiene 500 MB);
  tope total TOPE_TOTAL. Sin URLs firmadas: se sirven por la ruta del proyecto solo a quien tiene acceso.
- El frontend (static/design/development) aplica las mismas reglas para avisar antes; aquí está la autoridad.
Las reglas vienen de control-proyectos/docs/reglas-de-negocio.md.
"""
import hashlib
import json
import re
from datetime import date, datetime

from sqlalchemy import func
from sqlalchemy.orm import Session

from . import services_design as sd
from .models import EMPRESA_DESIGN, Empleado
from .models_design import (DesignDevApoyo, DesignDevEvento, DesignDevEvidencia, DesignDevPost, DesignDevPostMarca, DesignDevProyecto,
                            DesignDevRiesgo)

DEV_ESPECIALES = {"luisblaschke@nuviasmiles.com", "paul.andion@nuviasmiles.com"}

ESTADOS = {"propuesta": "Propuesta", "aprobado": "Aprobado", "desarrollo": "En desarrollo", "qa": "En pruebas (QA)",
           "lanzado": "Lanzado", "pausado": "Pausado"}
FLUJO = ["propuesta", "aprobado", "desarrollo", "qa", "lanzado"]
TIPOS = ["Desarrollo", "Mejora", "Protocolo"]
PRIORIDADES = {"critica": "Crítica", "alta": "Alta", "media": "Media", "baja": "Baja"}
ESTADOS_RIESGO = {"abierto": "Abierto", "mitigando": "Mitigando", "cerrado": "Cerrado"}
CATEGORIAS = {"guia", "practicas", "recurso", "anuncio"}
# (clave, título, exige evidencia, automático)
CONTROLES = {
    "aprobado": [("obj", "Objetivo y KPI de éxito definidos", False, False),
                 ("alc", "Alcance y criterios de aceptación escritos", False, False),
                 ("sponsor", "Aprobación del solicitante / sponsor", False, False),
                 ("auto_risk", "Al menos 1 riesgo identificado", False, True)],
    "desarrollo": [("dis", "Diseño técnico revisado", False, False),
                   ("est", "Estimación validada por el equipo", False, False),
                   ("dep", "Dependencias e impactos identificados", False, False)],
    "qa": [("tests", "Pruebas automatizadas pasando", True, False),
           ("cr", "Code review aprobado", True, False),
           ("env", "Entorno de QA con datos de prueba", False, False)],
    "lanzado": [("rb", "Plan de rollback documentado y probado", True, False),
                ("proto", "Protocolo actualizado y aprobado", False, False),
                ("bk", "Backup / migración verificada", True, False),
                ("com", "Comunicación a usuarios afectados", False, False),
                ("auto_crit", "Sin riesgos críticos abiertos (puntaje ≥ 15)", False, True)],
}
CONTROL = {c[0]: {"t": c[1], "ev": c[2], "auto": c[3], "etapa": e} for e, lista in CONTROLES.items() for c in lista}
CAMPOS = {"name": "Nombre", "type": "Tipo", "owner": "Responsable", "priority": "Prioridad", "startDate": "Inicio",
          "dueDate": "Fecha objetivo", "progress": "Avance", "protocol": "Protocolo", "description": "Descripción"}

MAX_APOYO = 10
MAX_EVIDENCIA = 1024 * 1024            # 1 MB ya comprimida
MAX_EVIDENCIAS_PROYECTO = 20
TOPE_TOTAL = 150 * 1024 * 1024         # todas las evidencias juntas (la base completa tiene 500 MB)
TIPOS_IMAGEN = {"image/png", "image/jpeg", "image/webp", "image/gif"}
FIRMAS = {"image/png": b"\x89PNG", "image/jpeg": b"\xff\xd8\xff", "image/gif": b"GIF8"}


class ErrorDev(Exception):
    """Error con el contrato de la API del proyecto: {message, details} y el código HTTP."""

    def __init__(self, status: int, message: str, details: list[str] | None = None):
        super().__init__(message)
        self.status, self.message, self.details = status, message, details or []


def tiene_acceso(user: Empleado | None) -> bool:
    if not user or not getattr(user, "activo", 1):
        return False
    from .invitados import es_invitado   # invitados (Parameters › Invitados): lo ven, sin poder cambiar nada
    return sd.es_admin(user) or (user.email or "").strip().lower() in DEV_ESPECIALES or es_invitado(user)


def _iso(dt: datetime | None) -> str:
    return (dt or datetime.utcnow()).strftime("%Y-%m-%dT%H:%M:%S") + "Z"


def _codigo(pid: int) -> str:
    return f"PRJ-{pid:03d}"


def _nombre(user: Empleado) -> str:
    return " ".join(w.capitalize() for w in (user.nombre_completo or "").split()) or (user.email or "")


# ---------- Personas (responsables) ----------

def personas(db: Session) -> list[dict]:
    """Personas activas de Nuvia Design, para los desplegables de responsable."""
    filas = (db.query(Empleado.id, Empleado.nombres, Empleado.apellidos)
             .filter(Empleado.activo == 1, Empleado.empresa == EMPRESA_DESIGN).all())
    from .invitados import CARGO_INVITADO
    invitados = {i for (i,) in db.query(Empleado.id).filter(Empleado.cargo == CARGO_INVITADO)}
    out = [{"id": str(i), "name": " ".join(w.capitalize() for w in f"{n or ''} {a or ''}".split())} for i, n, a in filas
           if i not in invitados]
    return sorted(out, key=lambda p: sd._normalizar_texto(p["name"]))


def _persona(db: Session, pid) -> Empleado | None:
    try:
        e = db.get(Empleado, int(pid))
    except (TypeError, ValueError):
        return None
    return e if e and e.activo and e.empresa == EMPRESA_DESIGN else None


# ---------- Serialización (mismo formato que usa el frontend) ----------

def _riesgo_dict(r: DesignDevRiesgo, apoyo: dict) -> dict:
    return {"id": str(r.id), "title": r.titulo, "prob": r.probabilidad, "impact": r.impacto, "mitigation": r.mitigacion or "",
            "owner": r.responsable, "ownerId": str(r.responsable_id or ""), "support": apoyo.get(("r", r.id), []),
            "status": r.estado, "createdAt": _iso(r.creado_en)}


def _apoyos(db: Session, tipo: str, ids: list[int]) -> dict:
    out: dict = {}
    if ids:
        for a in (db.query(DesignDevApoyo).filter(DesignDevApoyo.tipo == tipo, DesignDevApoyo.ref_id.in_(ids))
                  .order_by(DesignDevApoyo.id)):
            out.setdefault((tipo, a.ref_id), []).append({"id": str(a.empleado_id), "name": a.nombre})
    return out


def _nombre_de(e: Empleado) -> str:
    return " ".join(w.capitalize() for w in (e.nombre_completo or "").split())


def _guardar_apoyo(db: Session, tipo: str, ref_id: int, ids, principal_id) -> tuple[list[str], list[str]]:
    """Reemplaza las personas de apoyo. Devuelve (nombres antes, nombres después) para la bitácora."""
    antes = [a.nombre for a in db.query(DesignDevApoyo).filter(DesignDevApoyo.tipo == tipo, DesignDevApoyo.ref_id == ref_id)
             .order_by(DesignDevApoyo.id)]
    vistos, nuevos = set(), []
    for x in (ids or []):
        e = _persona(db, x)
        if e and e.id != principal_id and e.id not in vistos:
            vistos.add(e.id)
            nuevos.append(e)
    nuevos = nuevos[:MAX_APOYO]
    db.query(DesignDevApoyo).filter(DesignDevApoyo.tipo == tipo, DesignDevApoyo.ref_id == ref_id).delete(synchronize_session=False)
    for e in nuevos:
        db.add(DesignDevApoyo(tipo=tipo, ref_id=ref_id, empleado_id=e.id, nombre=_nombre_de(e)))
    return antes, [_nombre_de(e) for e in nuevos]


def _apoyo_valido(d: dict) -> list[str]:
    ids = d.get("supportIds")
    if ids is None:
        return []
    if not isinstance(ids, list):
        return ["Personas de apoyo inválidas"]
    return [f"Máximo {MAX_APOYO} personas de apoyo"] if len(ids) > MAX_APOYO else []


def _evidencia_dict(e: DesignDevEvidencia) -> dict:
    return {"id": str(e.id), "stage": e.etapa, "gate": e.control or "", "caption": e.descripcion,
            "dataUrl": f"/design/api/dev/projects/{e.proyecto_id}/evidence/{e.id}/file", "mime": e.tipo,
            "w": e.ancho, "h": e.alto, "size": e.peso, "name": e.nombre_archivo, "by": e.subido_por, "at": _iso(e.creado_en)}


def _proyectos_dicts(db: Session, proyectos: list[DesignDevProyecto]) -> list[dict]:
    ids = [p.id for p in proyectos]
    riesgos, evid, log = {}, {}, {}
    apoyo = _apoyos(db, "p", ids)
    if ids:
        filas = db.query(DesignDevRiesgo).filter(DesignDevRiesgo.proyecto_id.in_(ids)).order_by(DesignDevRiesgo.id).all()
        apoyo.update(_apoyos(db, "r", [r.id for r in filas]))
        for r in filas:
            riesgos.setdefault(r.proyecto_id, []).append(_riesgo_dict(r, apoyo))
        for e in db.query(DesignDevEvidencia).filter(DesignDevEvidencia.proyecto_id.in_(ids)).order_by(DesignDevEvidencia.id):
            evid.setdefault(e.proyecto_id, []).append(_evidencia_dict(e))
        for v in db.query(DesignDevEvento).filter(DesignDevEvento.proyecto_id.in_(ids)).order_by(DesignDevEvento.id):
            log.setdefault(v.proyecto_id, []).append({"id": str(v.id), "ts": _iso(v.creado_en), "user": v.usuario,
                                                       "msg": v.mensaje, "kind": v.tipo})
    return [{"id": str(p.id), "code": _codigo(p.id), "name": p.nombre, "type": p.tipo, "owner": p.responsable,
             "ownerId": str(p.responsable_id or ""), "support": apoyo.get(("p", p.id), []),
             "priority": p.prioridad, "status": p.estado,
             "startDate": p.inicio.isoformat(), "dueDate": p.objetivo.isoformat(), "progress": p.avance,
             "protocol": p.protocolo or "", "description": p.descripcion or "", "checklist": _controles(p),
             "risks": riesgos.get(p.id, []), "evidence": evid.get(p.id, []), "log": log.get(p.id, []),
             "createdAt": _iso(p.creado_en), "updatedAt": _iso(p.actualizado_en)} for p in proyectos]


def listar(db: Session) -> list[dict]:
    return _proyectos_dicts(db, db.query(DesignDevProyecto).order_by(DesignDevProyecto.id.desc()).all())


def uno(db: Session, pid: int) -> dict:
    return _proyectos_dicts(db, [_buscar(db, pid)])[0]


def _buscar(db: Session, pid) -> DesignDevProyecto:
    try:
        p = db.get(DesignDevProyecto, int(pid))
    except (TypeError, ValueError):
        p = None
    if not p:
        raise ErrorDev(404, "Proyecto no encontrado")
    return p


def _controles(p: DesignDevProyecto) -> dict:
    try:
        d = json.loads(p.controles or "{}")
        return {k: bool(v) for k, v in d.items() if k in CONTROL}
    except ValueError:
        return {}


def _evento(db: Session, p: DesignDevProyecto, user: Empleado, mensaje: str, tipo: str) -> None:
    db.add(DesignDevEvento(proyecto_id=p.id, empleado_id=user.id, usuario=_nombre(user), tipo=tipo, mensaje=mensaje[:4000]))
    p.actualizado_en = datetime.utcnow()


# ---------- Reglas (las mismas de domain.js) ----------

def _riesgos(db: Session, p: DesignDevProyecto) -> list[DesignDevRiesgo]:
    return db.query(DesignDevRiesgo).filter(DesignDevRiesgo.proyecto_id == p.id).all()


def _n_evidencias(db: Session, p: DesignDevProyecto, control: str) -> int:
    return db.query(func.count(DesignDevEvidencia.id)).filter(DesignDevEvidencia.proyecto_id == p.id,
                                                              DesignDevEvidencia.control == control).scalar() or 0


def _control_cumplido(db: Session, p: DesignDevProyecto, clave: str, checklist: dict) -> bool:
    if clave == "auto_risk":
        return len(_riesgos(db, p)) > 0
    if clave == "auto_crit":
        return not any(r.estado != "cerrado" and r.probabilidad * r.impacto >= 15 for r in _riesgos(db, p))
    return bool(checklist.get(clave))


def controles_faltantes(db: Session, p: DesignDevProyecto, destino: str) -> list[str]:
    if destino in ("pausado", "propuesta"):
        return []
    checklist = _controles(p)
    out = []
    for etapa in FLUJO[1:FLUJO.index(destino) + 1]:
        for clave, titulo, _ev, _auto in CONTROLES[etapa]:
            if not _control_cumplido(db, p, clave, checklist):
                out.append(f"{ESTADOS[etapa]}: {titulo}")
    return out


def _pide_motivo(desde: str, hacia: str) -> bool:
    if hacia == "pausado":
        return True
    if desde == "pausado":
        return False
    return FLUJO.index(hacia) < FLUJO.index(desde)


_FECHA = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _limpiar_proyecto(db: Session, d: dict, base: dict) -> tuple[dict, list[str]]:
    """Valida los campos editables (sobre `base`, los valores actuales). Devuelve (campos limpios, errores)."""
    v = dict(base)
    for k in ("name", "type", "priority", "startDate", "dueDate", "protocol", "description"):
        if k in d:
            v[k] = str(d.get(k) or "").strip()
    if "progress" in d:
        try:
            v["progress"] = int(float(d.get("progress")))
        except (TypeError, ValueError):
            v["progress"] = -1
    errores = []
    if "ownerId" in d or "owner" in d:
        e = _persona(db, d.get("ownerId") or "")
        v["ownerId"], v["owner"] = (e.id, " ".join(w.capitalize() for w in (e.nombre_completo or "").split())) if e else (None, "")
    if len(v.get("name", "")) < 3:
        errores.append("El nombre debe tener al menos 3 caracteres")
    if v.get("type") not in TIPOS:
        errores.append("Tipo inválido")
    if not v.get("ownerId"):
        errores.append("El responsable es obligatorio (persona activa de Nuvia Design)")
    if v.get("priority") not in PRIORIDADES:
        errores.append("Prioridad inválida")
    ini, fin = v.get("startDate", ""), v.get("dueDate", "")
    if not _FECHA.match(ini):
        errores.append("Fecha de inicio inválida")
    if not _FECHA.match(fin):
        errores.append("Fecha objetivo inválida")
    elif _FECHA.match(ini) and fin < ini:
        errores.append("La fecha objetivo no puede ser anterior al inicio")
    if not 0 <= v.get("progress", 0) <= 100:
        errores.append("El avance debe estar entre 0 y 100")
    if v.get("type") == "Protocolo" and not v.get("protocol"):
        errores.append("Un proyecto tipo Protocolo debe indicar el protocolo vinculado")
    if len(v.get("name", "")) > 200 or len(v.get("protocol", "")) > 200 or len(v.get("description", "")) > 5000:
        errores.append("Texto demasiado largo")
    if not errores:
        try:
            date.fromisoformat(ini), date.fromisoformat(fin)
        except ValueError:
            errores.append("Fecha inválida")
    return v, errores


def _valores(p: DesignDevProyecto) -> dict:
    return {"name": p.nombre, "type": p.tipo, "ownerId": p.responsable_id, "owner": p.responsable, "priority": p.prioridad,
            "startDate": p.inicio.isoformat(), "dueDate": p.objetivo.isoformat(), "progress": p.avance,
            "protocol": p.protocolo or "", "description": p.descripcion or ""}


def _aplicar(p: DesignDevProyecto, v: dict) -> None:
    p.nombre, p.tipo, p.prioridad = v["name"], v["type"], v["priority"]
    p.responsable_id, p.responsable = v["ownerId"], v["owner"]
    p.inicio, p.objetivo = date.fromisoformat(v["startDate"]), date.fromisoformat(v["dueDate"])
    p.avance, p.protocolo, p.descripcion = v["progress"], v["protocol"], v["description"]


# ---------- Proyectos ----------

def crear(db: Session, user: Empleado, d: dict) -> dict:
    base = {"name": "", "type": "", "ownerId": None, "owner": "", "priority": "", "startDate": "", "dueDate": "",
            "progress": 0, "protocol": "", "description": ""}
    v, errores = _limpiar_proyecto(db, {**d, "progress": 0}, base)
    errores += _apoyo_valido(d)
    if errores:
        raise ErrorDev(422, "Datos inválidos", errores)
    p = DesignDevProyecto(estado="propuesta", controles="{}")
    _aplicar(p, v)
    db.add(p)
    db.flush()
    _guardar_apoyo(db, "p", p.id, d.get("supportIds"), p.responsable_id)
    _evento(db, p, user, 'Proyecto creado en estado "Propuesta"', "create")
    db.commit()
    return uno(db, p.id)


def editar(db: Session, user: Empleado, pid, d: dict) -> dict:
    p = _buscar(db, pid)
    antes = _valores(p)
    if p.estado == "lanzado":
        d = {k: x for k, x in d.items() if k != "progress"}
    v, errores = _limpiar_proyecto(db, d, antes)
    errores += _apoyo_valido(d)
    if errores:
        raise ErrorDev(422, "Datos inválidos", errores)
    cambios = []
    if "supportIds" in d or v.get("ownerId") != antes.get("ownerId"):
        ids = d.get("supportIds") if "supportIds" in d else [a["id"] for a in _apoyos(db, "p", [p.id]).get(("p", p.id), [])]
        ap_antes, ap_despues = _guardar_apoyo(db, "p", p.id, ids, v.get("ownerId"))
        if ap_antes != ap_despues:
            cambios.append(f"Apoyo: {', '.join(ap_antes) or '—'} → {', '.join(ap_despues) or '—'}")
    for k, etiqueta in CAMPOS.items():
        if str(antes.get(k)) != str(v.get(k)):
            fmt = (lambda x: PRIORIDADES.get(x, x)) if k == "priority" else (lambda x: f"{x}%") if k == "progress" else \
                  (lambda x: "(texto)") if k == "description" else (lambda x: x or "—")
            cambios.append(f"{etiqueta}: {fmt(antes.get(k))} → {fmt(v.get(k))}")
    if cambios:
        _aplicar(p, v)
        _evento(db, p, user, "Editado: " + " · ".join(cambios), "edit")
    db.commit()
    return uno(db, p.id)


def cambiar_etapa(db: Session, user: Empleado, pid, hacia: str, motivo: str) -> dict:
    p = _buscar(db, pid)
    if hacia not in ESTADOS:
        raise ErrorDev(400, "Estado inválido")
    if p.estado == hacia:
        return uno(db, p.id)
    faltan = controles_faltantes(db, p, hacia)
    if faltan:
        raise ErrorDev(409, f'No se puede pasar a "{ESTADOS[hacia]}": faltan controles', faltan)
    motivo = (motivo or "").strip()
    if _pide_motivo(p.estado, hacia) and len(motivo) < 5:
        raise ErrorDev(422, "Este cambio requiere un motivo (mín. 5 caracteres)")
    desde = p.estado
    p.estado = hacia
    if hacia == "lanzado":
        p.avance = 100
    _evento(db, p, user, f"Etapa: {ESTADOS[desde]} → {ESTADOS[hacia]}" + (f". Motivo: {motivo[:500]}" if motivo else ""), "status")
    db.commit()
    return uno(db, p.id)


def marcar_control(db: Session, user: Empleado, pid, clave: str, hecho: bool) -> dict:
    p = _buscar(db, pid)
    g = CONTROL.get(clave)
    if not g or g["auto"]:
        raise ErrorDev(400, "Control no editable")
    if p.estado != "pausado" and not hecho and FLUJO.index(p.estado) >= FLUJO.index(g["etapa"]):
        raise ErrorDev(409, "No puedes desmarcar un control de una etapa ya superada. Regresa el proyecto de etapa primero.")
    if hecho and g["ev"] and not _n_evidencias(db, p, clave):
        raise ErrorDev(409, f'"{g["t"]}" requiere evidencia. Adjunta al menos un screenshot o foto vinculada a este control.')
    c = _controles(p)
    if bool(c.get(clave)) == bool(hecho):
        return uno(db, p.id)
    c[clave] = bool(hecho)
    p.controles = json.dumps(c)
    _evento(db, p, user, f"{'Control completado' if hecho else 'Control desmarcado'}: {g['t']}", "gate")
    db.commit()
    return uno(db, p.id)


def nota(db: Session, user: Empleado, pid, texto: str) -> dict:
    p = _buscar(db, pid)
    texto = (texto or "").strip()
    if len(texto) < 3:
        raise ErrorDev(422, "La nota es muy corta")
    _evento(db, p, user, "Nota: " + texto[:2000], "note")
    db.commit()
    return uno(db, p.id)


def eliminar(db: Session, user: Empleado, pid) -> dict:
    p = _buscar(db, pid)
    if p.estado not in ("propuesta", "pausado"):
        raise ErrorDev(409, "Solo se pueden eliminar proyectos en Propuesta o Pausado")
    rids = [r.id for r in _riesgos(db, p)]
    db.query(DesignDevApoyo).filter(DesignDevApoyo.tipo == "p", DesignDevApoyo.ref_id == p.id).delete(synchronize_session=False)
    if rids:
        db.query(DesignDevApoyo).filter(DesignDevApoyo.tipo == "r", DesignDevApoyo.ref_id.in_(rids)).delete(synchronize_session=False)
    for m in (DesignDevRiesgo, DesignDevEvidencia, DesignDevEvento):
        db.query(m).filter(m.proyecto_id == p.id).delete(synchronize_session=False)
    db.query(DesignDevPost).filter(DesignDevPost.proyecto_id == p.id).update({"proyecto_id": None}, synchronize_session=False)
    db.delete(p)
    db.commit()
    return {"ok": True}


# ---------- Riesgos ----------

def guardar_riesgo(db: Session, user: Empleado, pid, d: dict, riesgo_id=None) -> dict:
    p = _buscar(db, pid)
    try:
        prob, imp = int(d.get("prob")), int(d.get("impact"))
    except (TypeError, ValueError):
        prob = imp = 0
    titulo, mitig = str(d.get("title") or "").strip(), str(d.get("mitigation") or "").strip()
    estado = d.get("status")
    resp = _persona(db, d.get("ownerId") or "")
    errores = []
    if len(titulo) < 3:
        errores.append("Describe el riesgo (mín. 3 caracteres)")
    if not 1 <= prob <= 5:
        errores.append("Probabilidad entre 1 y 5")
    if not 1 <= imp <= 5:
        errores.append("Impacto entre 1 y 5")
    if estado not in ESTADOS_RIESGO:
        errores.append("Estado de riesgo inválido")
    if prob * imp >= 15 and not mitig:
        errores.append("Los riesgos críticos (≥15) requieren plan de mitigación")
    if not resp:
        errores.append("Asigna un responsable al riesgo")
    if len(titulo) > 300 or len(mitig) > 3000:
        errores.append("Texto demasiado largo")
    errores += _apoyo_valido(d)
    if errores:
        raise ErrorDev(422, "Riesgo inválido", errores)
    nombre = " ".join(w.capitalize() for w in (resp.nombre_completo or "").split())
    if riesgo_id:
        r = db.get(DesignDevRiesgo, int(riesgo_id)) if str(riesgo_id).isdigit() else None
        if not r or r.proyecto_id != p.id:
            raise ErrorDev(404, "Riesgo no encontrado")
        r.titulo, r.probabilidad, r.impacto, r.mitigacion, r.estado = titulo, prob, imp, mitig, estado
        r.responsable_id, r.responsable = resp.id, nombre
        _guardar_apoyo(db, "r", r.id, d.get("supportIds"), resp.id)
        _evento(db, p, user, f'Riesgo actualizado: "{titulo}" (P{prob}×I{imp}={prob * imp}, {estado})', "risk")
    else:
        r = DesignDevRiesgo(proyecto_id=p.id, titulo=titulo, probabilidad=prob, impacto=imp, mitigacion=mitig,
                            estado=estado, responsable_id=resp.id, responsable=nombre)
        db.add(r)
        db.flush()
        _guardar_apoyo(db, "r", r.id, d.get("supportIds"), resp.id)
        _evento(db, p, user, f'Riesgo registrado: "{titulo}" (puntaje {prob * imp})', "risk")
    db.commit()
    return uno(db, p.id)


def eliminar_riesgo(db: Session, user: Empleado, pid, riesgo_id) -> dict:
    p = _buscar(db, pid)
    r = db.get(DesignDevRiesgo, int(riesgo_id)) if str(riesgo_id).isdigit() else None
    if not r or r.proyecto_id != p.id:
        raise ErrorDev(404, "Riesgo no encontrado")
    if r.estado != "cerrado":
        raise ErrorDev(409, "Solo se pueden eliminar riesgos cerrados. Ciérralo primero para conservar la trazabilidad.")
    db.query(DesignDevApoyo).filter(DesignDevApoyo.tipo == "r", DesignDevApoyo.ref_id == r.id).delete(synchronize_session=False)
    db.delete(r)
    _evento(db, p, user, f'Riesgo eliminado: "{r.titulo}"', "risk")
    db.commit()
    return uno(db, p.id)


# ---------- Evidencias ----------

def espacio_usado(db: Session) -> int:
    return int(db.query(func.coalesce(func.sum(DesignDevEvidencia.peso), 0)).scalar() or 0)


def _control_valido(etapa: str, control: str) -> bool:
    return not control or any(c[0] == control and not c[3] for c in CONTROLES.get(etapa, []))


def _tipo_real(datos: bytes) -> str | None:
    for t, firma in FIRMAS.items():
        if datos.startswith(firma):
            return t
    if datos[:4] == b"RIFF" and datos[8:12] == b"WEBP":
        return "image/webp"
    return None


def agregar_evidencias(db: Session, user: Empleado, pid, archivos: list[bytes], meta: list[dict]) -> dict:
    p = _buscar(db, pid)
    errores = []
    if not archivos or len(archivos) != len(meta):
        raise ErrorDev(422, "Evidencias inválidas", ["No hay imágenes para guardar"])
    ya = db.query(func.count(DesignDevEvidencia.id)).filter(DesignDevEvidencia.proyecto_id == p.id).scalar() or 0
    if ya + len(archivos) > MAX_EVIDENCIAS_PROYECTO:
        errores.append(f"Máximo {MAX_EVIDENCIAS_PROYECTO} evidencias por proyecto (hay {ya})")
    if espacio_usado(db) + sum(len(a) for a in archivos) > TOPE_TOTAL:
        errores.append("Se llenó el espacio para evidencias de Development. Elimina evidencias antiguas.")
    tipos = []
    for i, (datos, m) in enumerate(zip(archivos, meta)):
        n = f"Imagen {i + 1}"
        etapa, control, desc = m.get("stage"), m.get("gate") or "", str(m.get("caption") or "").strip()
        if etapa not in FLUJO:
            errores.append(f"{n}: etapa inválida")
        elif not _control_valido(etapa, control):
            errores.append(f"{n}: el control no pertenece a la etapa elegida")
        if len(desc) < 3:
            errores.append(f"{n}: escribe una descripción de qué demuestra (mín. 3 caracteres)")
        t = _tipo_real(datos or b"")
        tipos.append(t)
        if t not in TIPOS_IMAGEN:
            errores.append(f"{n}: archivo inválido (PNG, JPG, WEBP o GIF)")
        elif len(datos) > MAX_EVIDENCIA:
            errores.append(f"{n}: supera 1 MB después de optimizar")
    if errores:
        raise ErrorDev(422, "Evidencias inválidas", errores)
    for datos, m, t in zip(archivos, meta, tipos):
        desc = str(m.get("caption")).strip()[:200]
        control = m.get("gate") or ""
        db.add(DesignDevEvidencia(proyecto_id=p.id, etapa=m["stage"], control=control, descripcion=desc, tipo=t, datos=datos,
                                  peso=len(datos), ancho=int(m.get("w") or 0), alto=int(m.get("h") or 0),
                                  nombre_archivo=str(m.get("name") or "")[:200], sha256=hashlib.sha256(datos).hexdigest(),
                                  subido_por=_nombre(user)))
        _evento(db, p, user, f"Evidencia agregada en {ESTADOS[m['stage']]}"
                + (f" ({CONTROL[control]['t']})" if control else "") + f": {desc}", "evidence")
    db.commit()
    return uno(db, p.id)


def _evidencia(db: Session, p: DesignDevProyecto, ev_id) -> DesignDevEvidencia:
    e = db.get(DesignDevEvidencia, int(ev_id)) if str(ev_id).isdigit() else None
    if not e or e.proyecto_id != p.id:
        raise ErrorDev(404, "Evidencia no encontrada")
    return e


def _unica_de_control_marcado(db: Session, p: DesignDevProyecto, e: DesignDevEvidencia) -> dict | None:
    g = CONTROL.get(e.control or "")
    if g and g["ev"] and _controles(p).get(e.control) and _n_evidencias(db, p, e.control) == 1:
        return g
    return None


def editar_evidencia(db: Session, user: Empleado, pid, ev_id, d: dict) -> dict:
    p = _buscar(db, pid)
    e = _evidencia(db, p, ev_id)
    etapa, control, desc = d.get("stage"), d.get("gate") or "", str(d.get("caption") or "").strip()
    errores = []
    if etapa not in FLUJO:
        errores.append("Etapa inválida")
    elif not _control_valido(etapa, control):
        errores.append("El control no pertenece a la etapa elegida")
    if len(desc) < 3:
        errores.append("La descripción debe tener al menos 3 caracteres")
    if errores:
        raise ErrorDev(422, "Datos inválidos", errores)
    if e.control and e.control != control:
        g = _unica_de_control_marcado(db, p, e)
        if g:
            raise ErrorDev(409, f'Es la única evidencia de "{g["t"]}" (control marcado). Agrega otra antes de moverla.')
    e.etapa, e.control, e.descripcion = etapa, control, desc[:200]
    _evento(db, p, user, f"Evidencia actualizada: {desc} → {ESTADOS[etapa]}" + (f" ({CONTROL[control]['t']})" if control else ""),
            "evidence")
    db.commit()
    return uno(db, p.id)


def eliminar_evidencia(db: Session, user: Empleado, pid, ev_id) -> dict:
    p = _buscar(db, pid)
    e = _evidencia(db, p, ev_id)
    g = _unica_de_control_marcado(db, p, e)
    if g:
        raise ErrorDev(409, f'No se puede eliminar: es la única evidencia de "{g["t"]}", que ya está marcado. Agrega otra evidencia primero.')
    db.delete(e)
    _evento(db, p, user, f"Evidencia eliminada: {e.descripcion}", "evidence")
    db.commit()
    return uno(db, p.id)


def archivo_evidencia(db: Session, pid, ev_id) -> tuple[bytes, str]:
    p = _buscar(db, pid)
    e = _evidencia(db, p, ev_id)
    return e.datos or b"", e.tipo


# ---------- Posts ----------

def _valid_url(u: str) -> bool:
    return bool(re.match(r"^https?://[^\s/$.?#][^\s]*$", u or "", re.I))


def _host(u: str) -> str:
    m = re.match(r"^https?://([^/:?#]+)", u or "", re.I)
    return (m.group(1) if m else u).removeprefix("www.")


def listar_posts(db: Session, user: Empleado) -> list[dict]:
    posts = db.query(DesignDevPost).order_by(DesignDevPost.id.desc()).all()
    marcas = db.query(DesignDevPostMarca.post_id, DesignDevPostMarca.empleado_id, DesignDevPostMarca.tipo).all()
    out = []
    for x in posts:
        mias = {t for (pid, eid, t) in marcas if pid == x.id and eid == user.id}
        try:
            enlaces = json.loads(x.enlaces or "[]")
        except ValueError:
            enlaces = []
        out.append({"id": str(x.id), "title": x.titulo, "body": x.cuerpo, "category": x.categoria,
                    "projectId": str(x.proyecto_id or ""), "pinned": bool(x.fijado), "links": enlaces, "author": x.autor,
                    "createdAt": _iso(x.creado_en), "read": "leido" in mias or x.autor_id == user.id,
                    "useful": sum(1 for (pid, _e, t) in marcas if pid == x.id and t == "util"), "usefulMine": "util" in mias})
    return out


def _post(db: Session, post_id) -> DesignDevPost:
    x = db.get(DesignDevPost, int(post_id)) if str(post_id).isdigit() else None
    if not x:
        raise ErrorDev(404, "Publicación no encontrada")
    return x


def guardar_post(db: Session, user: Empleado, d: dict, post_id=None) -> dict:
    enlaces = [{"label": str(l.get("label") or "").strip()[:150], "url": str(l.get("url") or "").strip()[:1000]}
               for l in (d.get("links") or []) if isinstance(l, dict)]
    enlaces = [l for l in enlaces if l["label"] or l["url"]]
    titulo, cuerpo, cat = str(d.get("title") or "").strip(), str(d.get("body") or "").strip(), d.get("category")
    proyecto = str(d.get("projectId") or "")
    errores = []
    if len(titulo) < 3:
        errores.append("El título debe tener al menos 3 caracteres")
    if len(cuerpo) < 10:
        errores.append("El contenido debe tener al menos 10 caracteres")
    if cat not in CATEGORIAS:
        errores.append("Categoría inválida")
    proy = None
    if proyecto:
        proy = db.get(DesignDevProyecto, int(proyecto)) if proyecto.isdigit() else None
        if not proy:
            errores.append("El proyecto vinculado no existe")
    if len(enlaces) > 10:
        errores.append("Máximo 10 enlaces por publicación")
    for i, l in enumerate(enlaces):
        if not _valid_url(l["url"]):
            errores.append(f"Enlace {i + 1}: la URL debe empezar por http:// o https://")
        elif not l["label"]:
            l["label"] = _host(l["url"])
    if len(titulo) > 200 or len(cuerpo) > 20000:
        errores.append("Texto demasiado largo")
    if errores:
        raise ErrorDev(422, "Publicación inválida", errores)
    if post_id:
        x = _post(db, post_id)
        x.actualizado_en = datetime.utcnow()
    else:
        x = DesignDevPost(autor_id=user.id, autor=_nombre(user))
        db.add(x)
        if proy:
            _evento(db, proy, user, f'Publicación vinculada: "{titulo}"', "note")
    x.titulo, x.cuerpo, x.categoria, x.fijado = titulo, cuerpo, cat, bool(d.get("pinned"))
    x.proyecto_id, x.enlaces = (proy.id if proy else None), json.dumps(enlaces, ensure_ascii=False)
    db.commit()
    return next(p for p in listar_posts(db, user) if p["id"] == str(x.id))


def marcar_post(db: Session, user: Empleado, post_id, tipo: str, valor: bool) -> dict:
    x = _post(db, post_id)
    m = db.get(DesignDevPostMarca, (x.id, user.id, tipo))
    if valor and not m:
        db.add(DesignDevPostMarca(post_id=x.id, empleado_id=user.id, tipo=tipo))
    elif not valor and m:
        db.delete(m)
    db.commit()
    return {"ok": True}


def eliminar_post(db: Session, post_id) -> None:
    x = _post(db, post_id)
    db.query(DesignDevPostMarca).filter(DesignDevPostMarca.post_id == x.id).delete(synchronize_session=False)
    db.delete(x)
    db.commit()


def exportar(db: Session, user: Empleado) -> dict:
    """Respaldo en JSON (sin las imágenes: solo sus datos)."""
    return {"version": 1, "exportedAt": _iso(None), "projects": listar(db), "posts": listar_posts(db, user)}


# ---------- Inglés (cookie cp_lang=en): los mensajes del servidor se traducen al responder ----------
EN_ESTADOS = {"Propuesta": "Proposal", "Aprobado": "Approved", "En desarrollo": "In development",
              "En pruebas (QA)": "In testing (QA)", "Lanzado": "Launched", "Pausado": "Paused"}
EN_CONTROLES = {
    "Objetivo y KPI de éxito definidos": "Goal and success KPI defined",
    "Alcance y criterios de aceptación escritos": "Scope and acceptance criteria written",
    "Aprobación del solicitante / sponsor": "Requester / sponsor approval",
    "Al menos 1 riesgo identificado": "At least 1 risk identified",
    "Diseño técnico revisado": "Technical design reviewed",
    "Estimación validada por el equipo": "Estimate validated by the team",
    "Dependencias e impactos identificados": "Dependencies and impacts identified",
    "Pruebas automatizadas pasando": "Automated tests passing",
    "Code review aprobado": "Code review approved",
    "Entorno de QA con datos de prueba": "QA environment with test data",
    "Plan de rollback documentado y probado": "Rollback plan documented and tested",
    "Protocolo actualizado y aprobado": "Protocol updated and approved",
    "Backup / migración verificada": "Backup / migration verified",
    "Comunicación a usuarios afectados": "Affected users notified",
    "Sin riesgos críticos abiertos (puntaje ≥ 15)": "No open critical risks (score ≥ 15)",
}
EN_EXACTO = {
    "Asigna un responsable al riesgo": "Assign an owner to the risk",
    "Categoría inválida": "Invalid category",
    "Control no editable": "This check can't be edited",
    "Datos inválidos": "Invalid data",
    "Describe el riesgo (mín. 3 caracteres)": "Describe the risk (at least 3 characters)",
    "El avance debe estar entre 0 y 100": "Progress must be between 0 and 100",
    "El contenido debe tener al menos 10 caracteres": "Content must be at least 10 characters",
    "El control no pertenece a la etapa elegida": "That check doesn't belong to the selected stage",
    "El nombre debe tener al menos 3 caracteres": "Name must be at least 3 characters",
    "El proyecto vinculado no existe": "The linked project doesn't exist",
    "El responsable es obligatorio (persona activa de Nuvia Design)": "An owner is required (an active Nuvia Design employee)",
    "El título debe tener al menos 3 caracteres": "Title must be at least 3 characters",
    "Estado de riesgo inválido": "Invalid risk status",
    "Estado inválido": "Invalid status",
    "Este cambio requiere un motivo (mín. 5 caracteres)": "This change needs a reason (at least 5 characters)",
    "Etapa inválida": "Invalid stage",
    "Evidencia no encontrada": "Evidence not found",
    "Evidencias inválidas": "Invalid evidence",
    "Fecha de inicio inválida": "Invalid start date",
    "Fecha inválida": "Invalid date",
    "Fecha objetivo inválida": "Invalid target date",
    "Impacto entre 1 y 5": "Impact must be between 1 and 5",
    "La descripción debe tener al menos 3 caracteres": "Description must be at least 3 characters",
    "La fecha objetivo no puede ser anterior al inicio": "The target date can't be before the start date",
    "La nota es muy corta": "The note is too short",
    "Los riesgos críticos (≥15) requieren plan de mitigación": "Critical risks (≥15) require a mitigation plan",
    "Máximo 10 enlaces por publicación": "Up to 10 links per post",
    "No puedes desmarcar un control de una etapa ya superada. Regresa el proyecto de etapa primero.":
        "You can't uncheck a check from a stage the project already passed. Move the project back first.",
    "Personas de apoyo inválidas": "Invalid support people",
    "Prioridad inválida": "Invalid priority",
    "Probabilidad entre 1 y 5": "Probability must be between 1 and 5",
    "Proyecto no encontrado": "Project not found",
    "Publicación inválida": "Invalid post",
    "Publicación no encontrada": "Post not found",
    "Riesgo inválido": "Invalid risk",
    "Riesgo no encontrado": "Risk not found",
    "Se llenó el espacio para evidencias de Development. Elimina evidencias antiguas.":
        "Development's evidence storage is full. Delete old evidence first.",
    "Solo se pueden eliminar proyectos en Propuesta o Pausado": "Only projects in Proposal or Paused can be deleted",
    "Solo se pueden eliminar riesgos cerrados. Ciérralo primero para conservar la trazabilidad.":
        "Only closed risks can be deleted. Close it first to keep the audit trail.",
    "Texto demasiado largo": "Text is too long",
    "Tipo inválido": "Invalid type",
    "Un proyecto tipo Protocolo debe indicar el protocolo vinculado": "A Protocol project must name the linked protocol",
    "No hay imágenes para guardar": "There are no images to save",
    "Petición mal formada": "Malformed request",
    "Development es solo para admins, Luis Felipe Blaschke y Paul Andion.":
        "Development is only for admins, Luis Felipe Blaschke and Paul Andion.",
}
_EN_REGEX = [
    (re.compile(r"^Enlace (\d+): la URL debe empezar por http:// o https://$"), r"Link \1: the URL must start with http:// or https://"),
    (re.compile(r"^Máximo (\d+) personas de apoyo$"), r"Up to \1 support people"),
    (re.compile(r"^Máximo (\d+) evidencias por proyecto \(hay (\d+)\)$"), r"Up to \1 evidence items per project (there are \2)"),
    (re.compile(r"^Imagen (\d+): archivo inválido \(PNG, JPG, WEBP o GIF\)$"), r"Image \1: invalid file (PNG, JPG, WEBP or GIF)"),
    (re.compile(r"^Imagen (\d+): el control no pertenece a la etapa elegida$"), r"Image \1: that check doesn't belong to the selected stage"),
    (re.compile(r"^Imagen (\d+): escribe una descripción de qué demuestra \(mín\. 3 caracteres\)$"),
     r"Image \1: describe what it shows (at least 3 characters)"),
    (re.compile(r"^Imagen (\d+): etapa inválida$"), r"Image \1: invalid stage"),
    (re.compile(r"^Imagen (\d+): supera 1 MB después de optimizar$"), r"Image \1: over 1 MB after optimizing"),
]


def _en_control(t: str) -> str:
    return EN_CONTROLES.get(t, t)


def traducir(msg: str) -> str:
    """Mensaje del servidor en inglés (si no se conoce, queda igual)."""
    if msg in EN_EXACTO:
        return EN_EXACTO[msg]
    for rx, en in _EN_REGEX:
        if rx.match(msg):
            return rx.sub(en, msg)
    m = re.match(r'^No se puede pasar a "(.+)": faltan controles$', msg)
    if m:
        return f'Can\'t move to "{EN_ESTADOS.get(m.group(1), m.group(1))}": checks missing'
    m = re.match(r"^(" + "|".join(re.escape(k) for k in EN_ESTADOS) + r"): (.+)$", msg)
    if m and m.group(2) in EN_CONTROLES:
        return f"{EN_ESTADOS[m.group(1)]}: {EN_CONTROLES[m.group(2)]}"
    m = re.match(r'^"(.+)" requiere evidencia\. Adjunta al menos un screenshot o foto vinculada a este control\.$', msg)
    if m:
        return f'"{_en_control(m.group(1))}" requires evidence. Attach at least one screenshot or photo linked to this check.'
    m = re.match(r'^Es la única evidencia de "(.+)" \(control marcado\)\. Agrega otra antes de moverla\.$', msg)
    if m:
        return f'It\'s the only evidence for "{_en_control(m.group(1))}" (checked). Add another one before moving it.'
    m = re.match(r'^No se puede eliminar: es la única evidencia de "(.+)", que ya está marcado\. Agrega otra evidencia primero\.$', msg)
    if m:
        return f'Can\'t delete: it\'s the only evidence for "{_en_control(m.group(1))}", which is already checked. Add another one first.'
    return msg
