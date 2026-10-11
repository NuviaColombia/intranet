"""Training de Design: plataforma de aprendizaje interactiva y bilingüe (ES/EN) sobre los protocolos y el lenguaje de Nuvia.
- Contenido: archivos JSON por módulo en app/static/training/data/ (formato en el propio JSON; ver validación en el contenido).
- Avance de cada persona (lecciones completadas y puntajes de los quizzes) en design_training_progreso.
- Modelos 3D (STL / GLB / OBJ / PLY) que suben los admins a "espacios" (slots) de las lecciones: design_training_modelos.
"""
import json
import re
import unicodedata
from datetime import datetime
from pathlib import Path
from sqlalchemy import func
from sqlalchemy.orm import Session
from .models import Empleado
from .models_design import DesignTrainingProgreso, DesignTrainingModelo, DesignConexionRegla, DesignTrainingModulo, DesignTrainingVersion

# Mientras se revisa, Training lo ven solo los admins. Para abrirlo a todos los de Design: True aquí y quitar la
# condición de admin en el enlace del menú (templates/base.html).
ABIERTO_A_TODOS = False

DATOS = Path(__file__).resolve().parent / "static" / "training" / "data"
FORMATOS = {"glb": "model/gltf-binary", "stl": "model/stl", "obj": "text/plain", "ply": "application/octet-stream", "html": "text/html; charset=utf-8"}
MODELOS_BASE = Path(__file__).resolve().parent / "static" / "training" / "models"   # modelos que viajan con la aplicación (se pueden reemplazar subiendo otro)
# Visores de casos (HTML) incluidos que NO van en /static (son casos reales, aunque sin nombre ni número de orden): se sirven
# comprimidos y solo a quien puede ver Training. Archivo <espacio>.html.gz
PRIVADOS = Path(__file__).resolve().parent / "training_privado"
SLOTS_FIJOS = [{"slot": "laboratorio-visor", "tipo": "visor", "titulo": {"es": "Visor de un caso real (Laboratorio 3D)", "en": "Real case viewer (3D lab)"},
                "modulo": "", "moduloTitulo": {"es": "Laboratorio 3D", "en": "3D lab"}, "leccion": "", "leccionTitulo": {"es": "Laboratorio 3D", "en": "3D lab"}}]
MAX_MODELO = 60 * 1024 * 1024
RE_SLOT = re.compile(r"^[a-z0-9][a-z0-9-]{2,58}$")
_cache: dict = {"firma": None, "base": {}, "datos": None, "clave": None}


def es_admin(user: Empleado) -> bool:
    return user.rol in ("admin", "superadmin")


def puede_ver(user: Empleado) -> bool:
    return ABIERTO_A_TODOS or es_admin(user)


# ---------- Contenido ----------

def _archivos() -> dict:
    """Módulos base (archivos JSON de static/training/data), por id. Se vuelven a leer solo si cambió algún archivo."""
    archivos = sorted(DATOS.glob("*.json")) if DATOS.exists() else []
    firma = tuple((a.name, a.stat().st_mtime_ns) for a in archivos)
    if _cache["firma"] != firma:
        base = {}
        for a in archivos:
            try:
                d = json.loads(a.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue   # un archivo dañado no tumba el resto de la plataforma
            if d.get("id"):
                base[d["id"]] = d
        _cache["firma"], _cache["base"], _cache["datos"] = firma, base, None
    return _cache["base"]


def _cargar(txt: str):
    try:
        v = json.loads(txt or "")
        return v if isinstance(v, dict) else None
    except (ValueError, TypeError):
        return None


def _combinar(modulos_por_id: dict) -> dict:
    modulos, por_termino = [], {}
    for d in modulos_por_id.values():
        d = dict(d)
        for g in d.pop("glosario", []) or []:
            if not g.get("id"):
                continue
            tt = g.get("termino") or {}
            clave = ((tt.get("es") or "").strip().lower(), (tt.get("en") or "").strip().lower())
            previo = por_termino.get(clave)
            largo = len((g.get("def") or {}).get("es", ""))
            if previo is None or largo > len((previo.get("def") or {}).get("es", "")):   # mismo término en varios módulos: gana la definición más completa
                por_termino[clave] = {**g, "modulo": d.get("id")}
        modulos.append(d)
    glosario = list(por_termino.values())
    modulos.sort(key=lambda m: (m.get("orden", 99), m.get("id", "")))
    glosario.sort(key=lambda g: (g.get("termino", {}).get("es") or "").lower())
    return {"modulos": modulos, "glosario": glosario}


def contenido(db: Session | None = None, borrador: bool = False) -> dict:
    """Todos los módulos (ordenados) y el glosario combinado. Los módulos editados en el editor (design_training_modulos)
    reemplazan al archivo: lo publicado para todos; con borrador=True (vista del editor), lo que se está editando."""
    base = _archivos()
    if db is None:
        if _cache.get("datos") is None or _cache.get("clave") != "archivos":
            _cache["datos"], _cache["clave"] = _combinar(base), "archivos"
        return _cache["datos"]
    filas = db.query(DesignTrainingModulo.id, DesignTrainingModulo.modulo, DesignTrainingModulo.version, DesignTrainingModulo.publicado_en,
                     DesignTrainingModulo.eliminado).all()
    clave = tuple((f.modulo, f.version if borrador else str(f.publicado_en), f.eliminado) for f in filas)
    ck = ("b" if borrador else "p", clave)
    if not borrador and _cache.get("datos") is not None and _cache.get("clave") == ck:
        return _cache["datos"]
    por_id = dict(base)
    for f in db.query(DesignTrainingModulo).all():
        if borrador and f.borrador:
            d = _cargar(f.borrador)
            if d and d.get("_eliminado"):
                por_id.pop(f.modulo, None)
                continue
        else:
            d = None
        if d is None:
            if f.eliminado:
                por_id.pop(f.modulo, None)
                continue
            d = _cargar(f.publicado)
        if d:
            d["id"] = f.modulo
            por_id[f.modulo] = d
    datos = _combinar(por_id)
    if not borrador:
        _cache["datos"], _cache["clave"] = datos, ck
    return datos


def slots_del_contenido(db: Session | None = None) -> list[dict]:
    """Los espacios de modelos 3D que piden las lecciones (para la pantalla de administración), incluidos los del borrador."""
    out, vistos = [], set()
    for m in contenido(db, borrador=db is not None)["modulos"]:
        for l in m.get("lecciones", []):
            for p in l.get("pasos", []):
                if p.get("t") in ("modelo3d", "visor") and p.get("slot") not in vistos:
                    vistos.add(p["slot"])
                    out.append({"slot": p["slot"], "tipo": p["t"], "titulo": p.get("titulo"), "modulo": m.get("id"), "moduloTitulo": m.get("titulo"),
                                "leccion": l.get("id"), "leccionTitulo": l.get("titulo")})
    return out


# ---------- Avance ----------

def progreso(db: Session, user: Empleado) -> dict:
    filas = db.query(DesignTrainingProgreso).filter(DesignTrainingProgreso.empleado_id == user.id).all()
    return {f.leccion_id: {"completada": bool(f.completada), "puntaje": f.puntaje, "dato": f.dato or "",
                           "actualizado": f.actualizado_en.isoformat() if f.actualizado_en else ""} for f in filas}


def guardar_progreso(db: Session, user: Empleado, leccion_id: str, completada: bool | None, puntaje: int | None, dato: str | None) -> dict:
    """Guarda el avance de una lección (o de las claves especiales "_ultima" y "_examen"). El puntaje solo sube (se guarda el mejor)."""
    if not re.fullmatch(r"[a-z0-9_-]{1,60}", leccion_id or ""):
        raise ValueError("Lección no válida.")
    f = db.get(DesignTrainingProgreso, (user.id, leccion_id)) or DesignTrainingProgreso(empleado_id=user.id, leccion_id=leccion_id)
    if completada is not None:
        f.completada = 1 if (completada or f.completada) else 0   # una lección completada no se "des-completa"
    if puntaje is not None:
        f.puntaje = max(f.puntaje or 0, max(0, min(100, int(puntaje))))
    if dato is not None:
        f.dato = dato[:200]
    f.actualizado_en = datetime.utcnow()
    db.add(f)
    db.commit()
    return {"completada": bool(f.completada), "puntaje": f.puntaje, "dato": f.dato or ""}


def resumen_equipo(db: Session) -> list[dict]:
    """Admins: avance de cada persona (lecciones completadas, promedio de quizzes y examen final)."""
    lecciones = {l["id"] for m in contenido(db)["modulos"] for l in m.get("lecciones", [])}
    por_persona: dict[int, dict] = {}
    for f in db.query(DesignTrainingProgreso).all():
        d = por_persona.setdefault(f.empleado_id, {"completadas": 0, "puntajes": [], "examen": None, "ultima": None})
        if f.leccion_id == "_examen":
            d["examen"] = f.puntaje
        elif f.leccion_id in lecciones and f.completada:
            d["completadas"] += 1
            if f.puntaje:
                d["puntajes"].append(f.puntaje)
        d["ultima"] = max(filter(None, [d["ultima"], f.actualizado_en]), default=None)
    out = []
    for e in db.query(Empleado).filter(Empleado.activo == 1).order_by(Empleado.apellidos).all():
        if not e.tiene_modulo("design_schedule"):
            continue
        d = por_persona.get(e.id, {"completadas": 0, "puntajes": [], "examen": None, "ultima": None})
        out.append({"id": e.id, "nombre": e.nombre_completo, "completadas": d["completadas"], "total": len(lecciones),
                    "promedio": round(sum(d["puntajes"]) / len(d["puntajes"])) if d["puntajes"] else None,
                    "examen": d["examen"], "ultima": d["ultima"].isoformat() if d["ultima"] else ""})
    return out


# ---------- Líderes de área (tarjeta del manager en cada módulo) ----------
# Se guardan en design_conexion_reglas (tipo "training_lider", clave = área, valor = JSON): sin tabla nueva.
AREAS_LIDER = ["face", "n2", "n3", "n6", "support"]
TIPO_LIDER = "training_lider"


def lideres(db: Session) -> dict:
    """{área: {empleadoId, nombre, foto, cargo: {es, en}} | None} con la persona que lidera cada área."""
    filas = {r.clave: r for r in db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == TIPO_LIDER).all()}
    out = {}
    for a in AREAS_LIDER:
        r, d = filas.get(a), None
        if r:
            try:
                d = json.loads(r.valor or "{}")
            except ValueError:
                d = None
        e = db.get(Empleado, d.get("empleadoId")) if d and d.get("empleadoId") else None
        out[a] = ({"empleadoId": e.id, "nombre": e.nombre_completo, "foto": f"/design/api/foto/{e.id}",
                   "cargo": {"es": str((d.get("cargo") or {}).get("es", ""))[:80], "en": str((d.get("cargo") or {}).get("en", ""))[:80]}} if e else None)
    return out


def lider_guardar(db: Session, user: Empleado, area: str, empleado_id: int, cargo_es: str, cargo_en: str) -> None:
    if area not in AREAS_LIDER:
        raise ValueError("Área no válida.")
    if not db.get(Empleado, empleado_id):
        raise ValueError("La persona no existe.")
    valor = json.dumps({"empleadoId": empleado_id, "cargo": {"es": (cargo_es or "").strip()[:80], "en": (cargo_en or "").strip()[:80]}}, ensure_ascii=False)
    r = db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == TIPO_LIDER, DesignConexionRegla.clave == area).first()
    if r:
        r.valor, r.creado_por = valor, user.nombre_completo
    else:
        db.add(DesignConexionRegla(tipo=TIPO_LIDER, clave=area, valor=valor, creado_por=user.nombre_completo))
    db.commit()


def lider_quitar(db: Session, area: str) -> bool:
    n = db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == TIPO_LIDER, DesignConexionRegla.clave == area).delete()
    db.commit()
    return bool(n)


def candidatos_lider(db: Session) -> list[dict]:
    """Personas de Design que se pueden elegir como líder de un área (empleados activos con el módulo)."""
    return sorted(({"id": e.id, "nombre": e.nombre_completo} for e in db.query(Empleado).filter(Empleado.activo == 1).all() if e.tiene_modulo("design_schedule")),
                  key=lambda x: x["nombre"].lower())


# ---------- Modelos 3D ----------

def modelos(db: Session) -> list[dict]:
    q = db.query(DesignTrainingModelo.slot, DesignTrainingModelo.nombre, DesignTrainingModelo.formato, DesignTrainingModelo.tamano,
                 DesignTrainingModelo.anotaciones, DesignTrainingModelo.subido_por, DesignTrainingModelo.creado_en).all()
    out = []
    for s, n, f, t, a, por, en in q:
        try:
            anot = json.loads(a or "[]")
        except ValueError:
            anot = []
        out.append({"slot": s, "nombre": n, "formato": f, "tamano": t, "anotaciones": anot, "subidoPor": por or "",
                    "creadoEn": en.isoformat() if en else "", "url": f"/design/training/modelo/{s}?v={int(en.timestamp()) if en else 0}"})
    # modelos incluidos en la aplicación (static/training/models/<espacio>.glb) que nadie ha reemplazado
    if MODELOS_BASE.exists():
        for a in sorted(MODELOS_BASE.glob("*.glb")):
            if a.stem not in {m["slot"] for m in out}:
                anot = []
                lado = a.with_suffix(".json")
                if lado.exists():
                    try:
                        anot = json.loads(lado.read_text(encoding="utf-8"))
                    except ValueError:
                        anot = []
                out.append({"slot": a.stem, "nombre": a.name, "formato": "glb", "tamano": a.stat().st_size, "anotaciones": anot, "subidoPor": "Nuvia",
                            "creadoEn": "", "url": f"/static/training/models/{a.name}?v={int(a.stat().st_mtime)}", "incluido": True})
    for a in sorted(PRIVADOS.glob("*.html.gz")) if PRIVADOS.exists() else []:
        slot = a.name[:-len(".html.gz")]
        if slot not in {m["slot"] for m in out}:
            out.append({"slot": slot, "nombre": slot + ".html", "formato": "html", "tamano": a.stat().st_size, "anotaciones": [], "subidoPor": "Nuvia",
                        "creadoEn": "", "url": f"/design/training/modelo/{slot}?v={int(a.stat().st_mtime)}", "incluido": True})
    return out


def visor_incluido(slot: str) -> Path | None:
    """Visor HTML incluido (comprimido) de un espacio, si existe y nadie subió otro."""
    a = PRIVADOS / f"{slot}.html.gz"
    return a if RE_SLOT.match(slot or "") and a.exists() else None


def modelo_guardar(db: Session, user: Empleado, slot: str, nombre: str, datos: bytes) -> dict:
    if not RE_SLOT.match(slot or ""):
        raise ValueError("El espacio del modelo no es válido.")
    ext = (nombre.rsplit(".", 1)[-1] if "." in nombre else "").lower()
    if ext not in FORMATOS:
        raise ValueError("Formato no admitido. Usa GLB, STL, OBJ, PLY o HTML (un solo archivo).")
    if not datos:
        raise ValueError("El archivo está vacío.")
    if len(datos) > MAX_MODELO:
        raise ValueError(f"El archivo pesa más de {MAX_MODELO // (1024 * 1024)} MB. Redúcelo o simplifica la malla.")
    previo = db.query(DesignTrainingModelo).filter(DesignTrainingModelo.slot == slot).first()
    anot = previo.anotaciones if previo else "[]"   # al reemplazar el archivo se conservan las anotaciones (puede que cambien de lugar)
    if previo:
        db.delete(previo)
        db.flush()
    db.add(DesignTrainingModelo(slot=slot, nombre=nombre[:200], formato=ext, tamano=len(datos), datos=datos, anotaciones=anot,
                                subido_por=user.nombre_completo, creado_en=datetime.utcnow()))
    db.commit()
    return {"slot": slot, "formato": ext, "tamano": len(datos)}


def modelo_datos(db: Session, slot: str) -> tuple[bytes, str] | None:
    m = db.query(DesignTrainingModelo).filter(DesignTrainingModelo.slot == slot).first()
    return (bytes(m.datos), FORMATOS.get(m.formato, "application/octet-stream")) if m else None


def modelo_eliminar(db: Session, slot: str) -> bool:
    n = db.query(DesignTrainingModelo).filter(DesignTrainingModelo.slot == slot).delete()
    db.commit()
    return bool(n)


def anotaciones_guardar(db: Session, slot: str, lista: list) -> list:
    """Pines con texto bilingüe sobre el modelo: [{"p":[x,y,z],"titulo":{es,en},"texto":{es,en}}]."""
    m = db.query(DesignTrainingModelo).filter(DesignTrainingModelo.slot == slot).first()
    if not m:
        raise KeyError(slot)
    limpia = []
    for a in (lista or [])[:40]:
        p = a.get("p")
        if not (isinstance(p, list) and len(p) == 3 and all(isinstance(x, (int, float)) for x in p)):
            continue
        t, x = a.get("titulo") or {}, a.get("texto") or {}
        limpia.append({"p": [round(float(v), 4) for v in p],
                       "titulo": {"es": str(t.get("es", ""))[:80], "en": str(t.get("en", ""))[:80]},
                       "texto": {"es": str(x.get("es", ""))[:400], "en": str(x.get("en", ""))[:400]}})
    m.anotaciones = json.dumps(limpia, ensure_ascii=False)
    db.commit()
    return limpia


# ---------- Editor de contenido (como la página de Inicio: borrador, publicar e historial) ----------

MAX_CONTENIDO = 4 * 1024 * 1024
MAX_VERSIONES = 30   # por módulo


class Conflicto(Exception):
    def __init__(self, fila: DesignTrainingModulo):
        self.fila = fila


def _fila(db: Session, modulo: str, crear: bool = False) -> DesignTrainingModulo | None:
    f = db.query(DesignTrainingModulo).filter(DesignTrainingModulo.modulo == modulo).first()
    if not f and crear:
        f = DesignTrainingModulo(modulo=modulo, borrador="", publicado="", version=1)
        db.add(f)
        db.commit()
        db.refresh(f)
    return f


def _fecha(d):
    return d.isoformat() if d else None


def editor_resumen(db: Session) -> dict:
    """Estado de cada módulo para el editor: si tiene cambios sin publicar, quién publicó, de dónde sale (archivo o editor)."""
    base, out = _archivos(), {}
    filas = {f.modulo: f for f in db.query(DesignTrainingModulo).all()}
    for mid in set(base) | set(filas):
        f = filas.get(mid)
        borr = _cargar(f.borrador) if f else None
        out[mid] = {"version": f.version if f else 0, "hayCambios": bool(f and f.borrador and f.borrador != (f.publicado or "")),
                    "enArchivo": mid in base, "publicado": bool(f and (f.publicado or f.eliminado)) or mid in base,
                    "eliminado": bool(f and f.eliminado), "eliminarPendiente": bool(borr and borr.get("_eliminado")),
                    "publicadoEn": _fecha(f.publicado_en) if f else None, "publicadoPor": f.publicado_por if f else "",
                    "actualizadoEn": _fecha(f.actualizado_en) if f else None, "actualizadoPor": f.actualizado_por if f else ""}
    return out


def editor_modulo(db: Session, modulo: str) -> dict:
    """Lo que el editor abre: el borrador, si no lo publicado, si no el archivo."""
    f = _fila(db, modulo)
    d = None
    if f:
        d = _cargar(f.borrador) or (None if f.eliminado else _cargar(f.publicado))
    if d is None or d.get("_eliminado"):
        base = _archivos()
        d = json.loads(json.dumps(base[modulo])) if modulo in base else None
    if d is None:
        raise KeyError(modulo)
    d["id"] = modulo
    return {"contenido": d, "version": f.version if f else 0}


def _validar_estructura(modulo: str, contenido: dict) -> str:
    if not isinstance(contenido, dict) or not isinstance(contenido.get("lecciones", []), list):
        raise ValueError("Contenido de módulo no válido.")
    txt = json.dumps({**contenido, "id": modulo}, ensure_ascii=False)
    if len(txt.encode()) > MAX_CONTENIDO:
        raise ValueError("El módulo es demasiado grande. Sube las imágenes a la biblioteca en vez de pegarlas.")
    return txt


def editor_guardar(db: Session, user: Empleado, modulo: str, contenido: dict, version: int, forzar: bool = False) -> DesignTrainingModulo:
    """Guarda el borrador solo si nadie guardó antes (versión comparada en una sola operación, como Inicio)."""
    if not RE_SLOT.match(modulo or ""):
        raise ValueError("Identificador de módulo inválido.")
    txt = _validar_estructura(modulo, contenido)
    f = _fila(db, modulo, crear=True)
    q = db.query(DesignTrainingModulo).filter(DesignTrainingModulo.id == f.id)
    if not forzar and version:
        q = q.filter(DesignTrainingModulo.version == version)
    n = q.update({DesignTrainingModulo.borrador: txt, DesignTrainingModulo.version: DesignTrainingModulo.version + 1,
                  DesignTrainingModulo.actualizado_en: datetime.utcnow(), DesignTrainingModulo.actualizado_por: user.nombre_completo},
                 synchronize_session=False)
    db.commit()
    db.refresh(f)
    if not n:
        raise Conflicto(f)
    return f


def editor_publicar(db: Session, user: Empleado, modulo: str) -> DesignTrainingModulo:
    from .services_design_training_validar import validar_modulo
    f = _fila(db, modulo)
    if not f or not f.borrador:
        raise ValueError("No hay cambios para publicar en este módulo.")
    d = _cargar(f.borrador)
    if d is None:
        raise ValueError("El borrador está dañado; descártalo.")
    if d.get("_eliminado"):
        f.eliminado, f.publicado = 1, ""
    else:
        errores = validar_modulo({**d, "id": modulo}, editor=True)
        otras = {l["id"]: m["id"] for m in contenido(db)["modulos"] if m["id"] != modulo for l in m.get("lecciones", [])}
        errores += [f"la lección {l.get('id')} ya existe en el módulo {otras[l.get('id')]}" for l in d.get("lecciones", []) if l.get("id") in otras]
        if errores:
            raise ValueError("Revisa antes de publicar: " + "; ".join(errores[:6]) + (f" (y {len(errores) - 6} más)" if len(errores) > 6 else ""))
        f.eliminado, f.publicado = 0, f.borrador
    f.borrador = ""
    f.version += 1
    f.publicado_en, f.publicado_por = datetime.utcnow(), user.nombre_completo
    db.add(DesignTrainingVersion(modulo=modulo, contenido=f.publicado or json.dumps({"_eliminado": True}), publicado_por=user.nombre_completo))
    db.flush()
    viejas = (db.query(DesignTrainingVersion.id).filter(DesignTrainingVersion.modulo == modulo)
              .order_by(DesignTrainingVersion.id.desc()).offset(MAX_VERSIONES).all())
    if viejas:
        db.query(DesignTrainingVersion).filter(DesignTrainingVersion.id.in_([v.id for v in viejas])).delete(synchronize_session=False)
    db.commit()
    return f


def editor_descartar(db: Session, user: Empleado, modulo: str) -> None:
    """El borrador se borra: el módulo vuelve a lo publicado (o al archivo). Un módulo nuevo sin publicar desaparece."""
    f = _fila(db, modulo)
    if not f:
        return
    if not f.publicado and not f.eliminado and not f.publicado_en:
        db.delete(f)
    else:
        f.borrador, f.version = "", f.version + 1
        f.actualizado_en, f.actualizado_por = datetime.utcnow(), user.nombre_completo
    db.commit()


def editor_eliminar(db: Session, user: Empleado, modulo: str) -> DesignTrainingModulo:
    """Marca el módulo para quitarlo del curso; se quita de verdad al publicar."""
    return editor_guardar(db, user, modulo, {"_eliminado": True, "lecciones": []}, 0, forzar=True)


def editor_versiones(db: Session, modulo: str) -> list[dict]:
    return [{"id": v.id, "publicadoEn": v.publicado_en.isoformat(), "publicadoPor": v.publicado_por}
            for v in db.query(DesignTrainingVersion).filter(DesignTrainingVersion.modulo == modulo).order_by(DesignTrainingVersion.id.desc()).all()]


def editor_restaurar(db: Session, user: Empleado, modulo: str, version_id: int) -> DesignTrainingModulo:
    """La versión elegida vuelve como borrador (hay que publicarla para que la vean todos)."""
    v = db.get(DesignTrainingVersion, version_id)
    if not v or v.modulo != modulo:
        raise KeyError(version_id)
    d = _cargar(v.contenido) or {"_eliminado": True}
    return editor_guardar(db, user, modulo, d if not d.get("_eliminado") else {"_eliminado": True, "lecciones": []}, 0, forzar=True)


def _slug(txt: str) -> str:
    txt = unicodedata.normalize("NFD", txt or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", txt).strip("-")[:40] or "modulo"


def editor_nuevo(db: Session, user: Empleado, titulo_es: str, titulo_en: str, seccion: str, area: str = "") -> str:
    """Módulo nuevo (borrador con una lección de ejemplo). Devuelve su id."""
    from .services_design_training_validar import SECCIONES, AREAS
    if seccion not in SECCIONES:
        raise ValueError("Sección inválida.")
    if seccion == "area" and area not in AREAS:
        raise ValueError("Elige el área del módulo.")
    titulo_es, titulo_en = (titulo_es or "").strip()[:120], (titulo_en or "").strip()[:120]
    if not (titulo_es or titulo_en):
        raise ValueError("Escribe el título del módulo.")
    existentes = set(_archivos()) | {f.modulo for f in db.query(DesignTrainingModulo.modulo).all()}
    base = "c-" + _slug(titulo_es or titulo_en)
    mid, n = base, 2
    while mid in existentes:
        mid, n = f"{base}-{n}", n + 1
    orden = {"intro": 1, "area": 10, "biblioteca": 40}[seccion]
    t_es, t_en = titulo_es or titulo_en, titulo_en or titulo_es
    d = {"id": mid, "orden": orden, "seccion": seccion, "icono": "📘", "titulo": {"es": t_es, "en": t_en},
         "resumen": {"es": "Describe en una frase de qué trata este módulo.", "en": "Describe in one sentence what this module is about."},
         "lecciones": [{"id": mid + "-l1", "titulo": {"es": "Primera lección", "en": "First lesson"}, "minutos": 5, "pasos": [
             {"t": "texto", "titulo": {"es": "Título del paso", "en": "Step title"},
              "cuerpo": {"es": "Escribe aquí el contenido.", "en": "Write the content here."}}]}],
         "glosario": []}
    if seccion == "area":
        d["area"] = area
    editor_guardar(db, user, mid, d, 0, forzar=True)
    return mid


IMAGENES = Path(__file__).resolve().parent / "static" / "training" / "img"


def imagenes_incluidas() -> list[dict]:
    """Imágenes de referencia que viajan con la aplicación (sacadas de los protocolos), para la biblioteca del editor.
    img/pies.json (opcional): {"<ruta relativa>": {"pie": {es, en}, "fuente": "..."}}."""
    if not IMAGENES.exists():
        return []
    try:
        pies = json.loads((IMAGENES / "pies.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        pies = {}
    out = []
    for a in sorted(IMAGENES.rglob("*")):
        if a.suffix.lower() not in (".webp", ".jpg", ".jpeg", ".png", ".svg") or not a.is_file():
            continue
        rel = a.relative_to(IMAGENES).as_posix()
        extra = pies.get(rel) or {}
        out.append({"src": f"/static/training/img/{rel}", "nombre": a.stem.replace("-", " "), "grupo": a.parent.name if a.parent != IMAGENES else "",
                    **({"pie": extra["pie"]} if extra.get("pie") else {}), **({"fuente": extra["fuente"]} if extra.get("fuente") else {})})
    return out
