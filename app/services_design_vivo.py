"""Design en vivo por aviso del servidor (Server-Sent Events) en lugar de preguntar cada pocos segundos.

Cada pestaña de Design abre UNA conexión liviana (/design/api/vivo) y espera. Cuando se guarda algo que otros están
viendo (órdenes y tiempos libres del Schedule, hojas de Pre-Approved, la página de Inicio y su muro) se envía un aviso
corto (solo identificadores, ningún dato) y únicamente las pantallas afectadas piden los datos nuevos.

Los cambios se detectan en un solo lugar: los eventos de SQLAlchemy (after_flush → se anotan; after_commit → se
avisan; si hay rollback no se avisa nada). Así no hay que tocar cada ruta que guarda. Si la conexión se cae, el
navegador vuelve a consultar cada tanto (ver static/design/vivo.js).
El servidor corre en un solo proceso: los suscriptores viven en memoria.
"""
import asyncio
import json
import logging
import threading
from datetime import date
from sqlalchemy import event, inspect
from sqlalchemy.orm import Session
from .models_design import (DesignOrden, DesignBreak, DesignPreApprovedSheet, DesignPreApprovedCentro, DesignPreApprovedDoctor,
                            DesignPreApprovedFila, DesignPreApprovedCelda, DesignPreApprovedFoto, DesignInicioPagina, DesignInicioMuro, DesignInicioReaccion,
                            DesignOpeningsHoja, DesignOpeningsColumna, DesignOpeningsFila)

log = logging.getLogger(__name__)
_subs: set = set()          # {(loop, cola)}
_lock = threading.Lock()
MAX_COLA = 300              # una pestaña que no lee (colgada) no acumula memoria: los avisos de más se descartan
PRE_APPROVED = (DesignPreApprovedSheet, DesignPreApprovedCentro, DesignPreApprovedDoctor, DesignPreApprovedFila, DesignPreApprovedCelda,
                DesignPreApprovedFoto)


def suscribir() -> asyncio.Queue:
    cola: asyncio.Queue = asyncio.Queue(maxsize=MAX_COLA)
    with _lock:
        _subs.add((asyncio.get_running_loop(), cola))
    return cola


def desuscribir(cola: asyncio.Queue) -> None:
    with _lock:
        for x in [x for x in _subs if x[1] is cola]:
            _subs.discard(x)


def _poner(cola: asyncio.Queue, datos: str) -> None:
    try:
        cola.put_nowait(datos)
    except asyncio.QueueFull:
        pass


def publicar(avisos: list[dict]) -> None:
    """Envía los avisos a todas las conexiones abiertas. Se puede llamar desde cualquier hilo."""
    if not avisos:
        return
    datos = json.dumps(avisos, separators=(",", ":"))
    with _lock:
        destinos = list(_subs)
    for loop, cola in destinos:
        try:
            loop.call_soon_threadsafe(_poner, cola, datos)
        except RuntimeError:   # el loop de esa conexión ya se cerró
            with _lock:
                _subs.discard((loop, cola))


# ---------- Detección de cambios (eventos de SQLAlchemy) ----------

def _valores(obj, attr: str) -> list:
    """Valor actual y anterior de un atributo (si cambió en este flush)."""
    h = inspect(obj).attrs[attr].history
    vals = list(h.added or []) + list(h.deleted or []) + list(h.unchanged or [])
    if not vals:
        vals = [getattr(obj, attr, None)]
    return vals


def _fecha(v) -> str:
    return v.isoformat() if isinstance(v, date) else str(v or "")


def _anotar(session: Session, obj, borrado: bool) -> None:
    avisos = session.info.setdefault("ds_vivo", set())
    if isinstance(obj, (DesignOrden, DesignBreak)):
        for team in _valores(obj, "team_id"):
            for f in _valores(obj, "fecha"):
                if team and f:
                    avisos.add(("dia", int(team), _fecha(f)))
        if isinstance(obj, DesignOrden):
            ids = {i for i in _valores(obj, "designer_id") if i}
            for i in ids:
                avisos.add(("asig", int(i), ""))
            if (obj.designer_prestado or "").strip():
                avisos.add(("asig", 0, ""))   # prestado por nombre: cada pestaña revisa la suya
    elif isinstance(obj, PRE_APPROVED):
        avisos.add(("pa", 0, ""))
    elif isinstance(obj, (DesignOpeningsHoja, DesignOpeningsColumna, DesignOpeningsFila)):
        avisos.add(("op", 0, ""))
    elif isinstance(obj, DesignInicioPagina):
        avisos.add(("inicio", 0, "pub"))
    elif isinstance(obj, (DesignInicioMuro, DesignInicioReaccion)):
        avisos.add(("inicio", 0, "muro"))


@event.listens_for(Session, "after_flush")
def _al_flush(session, contexto):
    try:
        for obj in session.new:
            _anotar(session, obj, False)
        for obj in session.dirty:
            if session.is_modified(obj, include_collections=False):
                _anotar(session, obj, False)
        for obj in session.deleted:
            _anotar(session, obj, True)
    except Exception:  # noqa: BLE001  (avisar nunca debe impedir guardar)
        log.exception("vivo: no se pudo anotar el cambio")


@event.listens_for(Session, "do_orm_execute")
def _al_ejecutar(estado):
    """Cambios en bloque (query(...).update() / .delete()), que no pasan por after_flush."""
    if not (estado.is_update or estado.is_delete):
        return
    try:
        avisos = estado.session.info.setdefault("ds_vivo", set())
        for m in estado.all_mappers:
            if m.class_ in PRE_APPROVED:
                avisos.add(("pa", 0, ""))
            elif m.class_ in (DesignOpeningsHoja, DesignOpeningsColumna, DesignOpeningsFila):
                avisos.add(("op", 0, ""))
            elif m.class_ in (DesignOrden, DesignBreak):
                avisos.add(("dia", 0, ""))   # sin equipo ni fecha: todas las pantallas del Schedule revisan
                avisos.add(("asig", 0, ""))
            elif m.class_ in (DesignInicioMuro, DesignInicioReaccion):
                avisos.add(("inicio", 0, "muro"))
            elif m.class_ is DesignInicioPagina:
                avisos.add(("inicio", 0, "pub"))
    except Exception:  # noqa: BLE001
        log.exception("vivo: no se pudo anotar el cambio en bloque")


@event.listens_for(Session, "after_commit")
def _al_commit(session):
    avisos = session.info.pop("ds_vivo", None)
    if not avisos:
        return
    out = []
    for tipo, num, texto in sorted(avisos, key=str):
        if tipo == "dia":
            out.append({"t": "dia", "team": num, "fecha": texto})
        elif tipo == "asig":
            out.append({"t": "asig", "id": num})
        elif tipo == "pa":
            out.append({"t": "pa"})
        elif tipo == "op":
            out.append({"t": "op"})
        elif tipo == "inicio":
            out.append({"t": "inicio", "que": texto})
    publicar(out)


@event.listens_for(Session, "after_rollback")
def _al_rollback(session):
    session.info.pop("ds_vivo", None)
