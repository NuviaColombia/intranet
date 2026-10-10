"""Training de Design: plataforma de aprendizaje interactiva y bilingüe (ES/EN) sobre los protocolos y el lenguaje de Nuvia.
- Contenido: archivos JSON por módulo en app/static/training/data/ (formato en el propio JSON; ver validación en el contenido).
- Avance de cada persona (lecciones completadas y puntajes de los quizzes) en design_training_progreso.
- Modelos 3D (STL / GLB / OBJ / PLY) que suben los admins a "espacios" (slots) de las lecciones: design_training_modelos.
"""
import json
import re
from datetime import datetime
from pathlib import Path
from sqlalchemy import func
from sqlalchemy.orm import Session
from .models import Empleado
from .models_design import DesignTrainingProgreso, DesignTrainingModelo

# Mientras se revisa, Training lo ven solo los admins. Para abrirlo a todos los de Design: True aquí y quitar la
# condición de admin en el enlace del menú (templates/base.html).
ABIERTO_A_TODOS = False

DATOS = Path(__file__).resolve().parent / "static" / "training" / "data"
FORMATOS = {"glb": "model/gltf-binary", "stl": "model/stl", "obj": "text/plain", "ply": "application/octet-stream"}
MAX_MODELO = 60 * 1024 * 1024
RE_SLOT = re.compile(r"^[a-z0-9][a-z0-9-]{2,58}$")
_cache: dict = {"firma": None, "datos": None}


def es_admin(user: Empleado) -> bool:
    return user.rol in ("admin", "superadmin")


def puede_ver(user: Empleado) -> bool:
    return ABIERTO_A_TODOS or es_admin(user)


# ---------- Contenido ----------

def contenido() -> dict:
    """Todos los módulos (ordenados) y el glosario combinado. Se vuelve a leer solo si cambió algún archivo."""
    archivos = sorted(DATOS.glob("*.json")) if DATOS.exists() else []
    firma = tuple((a.name, a.stat().st_mtime_ns) for a in archivos)
    if _cache["firma"] == firma and _cache["datos"] is not None:
        return _cache["datos"]
    modulos, por_termino = [], {}
    for a in archivos:
        try:
            d = json.loads(a.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue   # un archivo dañado no tumba el resto de la plataforma
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
    datos = {"modulos": modulos, "glosario": glosario}
    _cache["firma"], _cache["datos"] = firma, datos
    return datos


def slots_del_contenido() -> list[dict]:
    """Los espacios de modelos 3D que piden las lecciones (para la pantalla de administración)."""
    out, vistos = [], set()
    for m in contenido()["modulos"]:
        for l in m.get("lecciones", []):
            for p in l.get("pasos", []):
                if p.get("t") == "modelo3d" and p.get("slot") not in vistos:
                    vistos.add(p["slot"])
                    out.append({"slot": p["slot"], "titulo": p.get("titulo"), "modulo": m.get("id"), "moduloTitulo": m.get("titulo"),
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
    lecciones = {l["id"] for m in contenido()["modulos"] for l in m.get("lecciones", [])}
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
    return out


def modelo_guardar(db: Session, user: Empleado, slot: str, nombre: str, datos: bytes) -> dict:
    if not RE_SLOT.match(slot or ""):
        raise ValueError("El espacio del modelo no es válido.")
    ext = (nombre.rsplit(".", 1)[-1] if "." in nombre else "").lower()
    if ext not in FORMATOS:
        raise ValueError("Formato no admitido. Usa GLB, STL, OBJ o PLY (un solo archivo).")
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
