"""Planificación de managers y centros (Parámetros › Openings › Planificación, pedido por Rosember el 13-oct-2026).

Es un BORRADOR: guarda solo lo que se quiere cambiar y no toca Openings hasta que alguien pulsa "Publicar" y confirma.
Al publicar, cada cambio entra a Openings por la misma ruta que una celda editada a mano (historial, Pre-Approved y
Schedule se actualizan igual). Si un centro cambió en Openings después de planear, ese cambio no se pisa: queda en el
borrador y se reporta como conflicto.
"""
import json
import unicodedata
from datetime import datetime

from sqlalchemy.orm import Session

from .models_design import DesignPlanificacion, DesignOpeningsFila
from . import services_design as sd
from . import services_design_origenes as so

# Columnas de Openings que se pueden planear: el manager de cada área.
PLAN_COLS = ("manager_n3", "manager_n6", "manager_n2", "manager_face")
MAX_TEXTO = 500
SIN = "N/A"   # así se escribe "sin manager" en Openings (igual que el resto de la pantalla)


def _clave(v: str) -> str:
    """Compara nombres sin tildes, mayúsculas ni espacios; los valores de "sin manager" son todos iguales."""
    t = unicodedata.normalize("NFD", v or "")
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    t = " ".join(t.split()).strip().lower()
    return "" if t in so.SIN_MANAGER else t


def leer(db: Session) -> dict:
    row = db.get(DesignPlanificacion, 1)
    try:
        return json.loads(row.cambios or "{}") if row else {}
    except ValueError:
        return {}


def _guardar(db: Session, cambios: dict, por: str) -> None:
    row = db.get(DesignPlanificacion, 1)
    if not row:
        row = DesignPlanificacion(id=1)
        db.add(row)
    row.cambios = json.dumps(cambios, ensure_ascii=False)
    row.actualizado_por = (por or "")[:150]
    row.actualizado_en = datetime.utcnow()
    db.commit()


def _valor_openings(db: Session, fila_id: int, clave: str) -> str | None:
    f = db.get(DesignOpeningsFila, fila_id)
    if not f:
        return None
    return json.loads(f.datos or "{}").get(clave, "") or ""


def mover(db: Session, fila_id: int, clave: str, valor: str, por: str) -> dict:
    """Planea que el centro `fila_id` pase a `valor` en la columna `clave`. Si vuelve a su valor de Openings, el cambio se quita."""
    if clave not in PLAN_COLS:
        raise ValueError("Esa columna no se puede planear.")
    actual = _valor_openings(db, fila_id, clave)
    if actual is None:
        raise KeyError(fila_id)
    nuevo = " ".join((valor or "").split())[:MAX_TEXTO] or SIN
    cambios = leer(db)
    fila = cambios.get(str(fila_id), {})
    if _clave(nuevo) == _clave(actual):
        fila.pop(clave, None)
    else:
        # "antes" es el valor que tenía Openings cuando empezó el cambio (para detectar choques al publicar)
        antes = fila[clave]["antes"] if clave in fila else actual
        fila[clave] = {"antes": antes, "nuevo": nuevo}
    if fila:
        cambios[str(fila_id)] = fila
    else:
        cambios.pop(str(fila_id), None)
    _guardar(db, cambios, por)
    return cambios


def descartar(db: Session, por: str) -> dict:
    _guardar(db, {}, por)
    return {}


def publicar(db: Session, por: str) -> dict:
    """Aplica el borrador a Openings. Lo que cambió en Openings desde que se planeó no se pisa: queda como conflicto."""
    cambios = leer(db)
    aplicados, conflictos, quedan = [], [], {}
    for fid, por_fila in cambios.items():
        for clave, d in por_fila.items():
            actual = _valor_openings(db, int(fid), clave)
            if actual is None:   # la fila se quitó de Openings: el cambio ya no tiene a qué aplicarse
                conflictos.append({"fila": int(fid), "clave": clave, "motivo": "El centro ya no está en Openings."})
                continue
            if _clave(actual) != _clave(d.get("antes", "")):
                conflictos.append({"fila": int(fid), "clave": clave, "motivo": f"Cambió en Openings mientras planeabas (ahora dice «{actual or 'vacío'}»).",
                                   "nuevo": d.get("nuevo", "")})
                quedan.setdefault(fid, {})[clave] = d
                continue
            if _clave(d.get("nuevo", "")) == _clave(actual):
                continue
            sd.openings_guardar_celda(db, int(fid), clave, d["nuevo"])
            aplicados.append({"fila": int(fid), "clave": clave, "antes": actual, "nuevo": d["nuevo"]})
    pa = so.tras_cambio_openings(db, por) if aplicados else None   # Pre-Approved se reordena igual que al editar Openings
    _guardar(db, quedan, por)
    return {"aplicados": aplicados, "conflictos": conflictos,
            "pa": [a for x in pa["areas"] for a in x["acciones"]] if pa else None}
