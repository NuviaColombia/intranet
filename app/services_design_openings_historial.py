"""
Historial de cambios de Openings (pedido por Rosember el 12-oct-2026: "alguien borró Portland, ¿quién fue?").
No se borra nunca (a diferencia de la Papelera, que se limpia a los 15 días).

Se registra desde la base de datos (evento before_flush de SQLAlchemy) y no desde cada ruta: así queda TODO cambio a
Openings, venga de la tabla de Parámetros, de mover centros en Pre-Approved (Cambios) o de cambiar el manager de un
equipo, sin tocar el código protegido de services_design_origenes.py. Quién hizo el cambio sale de la sesión de la
petición (dependencia marcar_quien del router de Design); si no hay sesión, queda "Sistema".
"""
import contextvars
import json
from datetime import datetime

from fastapi import Request
from sqlalchemy import event, inspect as sa_inspect
from sqlalchemy.orm import Session

from .models_design import DesignOpeningsFila, DesignOpeningsColumna, DesignOpeningsHistorial

QUIEN: contextvars.ContextVar[str] = contextvars.ContextVar("openings_quien", default="")


async def marcar_quien(request: Request) -> None:
    """Dependencia del router de Design: deja anotado el correo de quien hace la petición (para el historial)."""
    try:
        QUIEN.set(request.session.get("user_email") or "")
    except Exception:
        QUIEN.set("")


def _json(t):
    try:
        return json.loads(t or "{}") or {}
    except ValueError:
        return {}


def _anterior(obj, attr):
    h = sa_inspect(obj).attrs[attr].history
    return h.deleted[0] if h.deleted else None


@event.listens_for(Session, "before_flush")
def _registrar(session, flush_context, instances):
    quien, ahora, nuevos = QUIEN.get() or "Sistema", datetime.utcnow(), []
    for o in list(session.dirty):
        if isinstance(o, DesignOpeningsFila) and session.is_modified(o, include_collections=False):
            viejo = _anterior(o, "datos")
            if viejo is None:
                continue
            a, b = _json(viejo), _json(o.datos)
            centro = (b.get("centro") or a.get("centro") or "").strip()
            for k in sorted(set(a) | set(b)):
                va, vb = str(a.get(k, "") or ""), str(b.get(k, "") or "")
                if va != vb:
                    nuevos.append(DesignOpeningsHistorial(hoja_id=o.hoja_id, fila_id=o.id, centro=centro[:150], columna=k[:60],
                                                          accion="celda", antes=va, despues=vb, por=quien[:150], fecha=ahora))
        elif isinstance(o, DesignOpeningsColumna) and session.is_modified(o, include_collections=False):
            viejo = _anterior(o, "titulo")
            if viejo is not None and viejo != o.titulo:
                nuevos.append(DesignOpeningsHistorial(hoja_id=o.hoja_id, columna=o.clave[:60], accion="columna_renombrada",
                                                      antes=viejo or "", despues=o.titulo or "", por=quien[:150], fecha=ahora))
    for o in list(session.new):
        if isinstance(o, DesignOpeningsFila):
            d = _json(o.datos)
            nuevos.append(DesignOpeningsHistorial(hoja_id=o.hoja_id, centro=(d.get("centro") or "")[:150], accion="fila_nueva",
                                                  despues=json.dumps(d, ensure_ascii=False) if d else "", por=quien[:150], fecha=ahora))
        elif isinstance(o, DesignOpeningsColumna):
            nuevos.append(DesignOpeningsHistorial(hoja_id=o.hoja_id, columna=(o.clave or "")[:60], accion="columna_nueva",
                                                  despues=o.titulo or "", por=quien[:150], fecha=ahora))
    for o in list(session.deleted):
        if isinstance(o, DesignOpeningsFila):
            d = _json(o.datos)
            nuevos.append(DesignOpeningsHistorial(hoja_id=o.hoja_id, fila_id=o.id, centro=(d.get("centro") or "")[:150], accion="fila_eliminada",
                                                  antes=json.dumps(d, ensure_ascii=False), por=quien[:150], fecha=ahora))
        elif isinstance(o, DesignOpeningsColumna):
            nuevos.append(DesignOpeningsHistorial(hoja_id=o.hoja_id, columna=(o.clave or "")[:60], accion="columna_eliminada",
                                                  antes=o.titulo or "", por=quien[:150], fecha=ahora))
    for h in nuevos:
        session.add(h)


def listar(db: Session, q: str = "", limite: int = 300, antes_de: int | None = None) -> dict:
    from .models import Empleado
    from . import services_design as sd
    H, C, _F = sd._openings_modelos()
    titulos = {c.clave: c.titulo for c in db.query(C).all()}
    qy = db.query(DesignOpeningsHistorial)
    if antes_de:
        qy = qy.filter(DesignOpeningsHistorial.id < antes_de)
    filas = qy.order_by(DesignOpeningsHistorial.id.desc()).limit(min(max(limite, 1), 1000) * (4 if q else 1)).all()
    if q:
        n = sd._normalizar_texto(q)
        filas = [f for f in filas if n in sd._normalizar_texto(" ".join([f.centro or "", f.antes or "", f.despues or "", f.por or "",
                                                                          titulos.get(f.columna, f.columna or "")]))][:limite]
    correos = {f.por for f in filas if "@" in (f.por or "")}
    nombres = {e.email: e.nombre_completo for e in db.query(Empleado).filter(Empleado.email.in_(correos or ["-"]))}
    return {"cambios": [{"id": f.id, "fecha": f.fecha.isoformat() + "Z", "accion": f.accion, "centro": f.centro,
                         "columna": titulos.get(f.columna, f.columna or ""), "antes": f.antes, "despues": f.despues,
                         "por": nombres.get(f.por, f.por)} for f in filas],
            "mas": len(filas) >= limite}
