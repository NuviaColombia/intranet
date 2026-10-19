"""Design en vivo por aviso del servidor (Server-Sent Events) en lugar de preguntar cada pocos segundos.

Cada pestaña de Design abre UNA conexión liviana (/design/api/vivo) y espera. Cuando se guarda algo que otros están
viendo (órdenes y tiempos libres del Schedule, hojas de Pre-Approved, la página de Inicio y su muro, equipos, catálogos,
delegaciones, copias Face → N2...) se envía un aviso corto y únicamente las pantallas afectadas reaccionan.

Los cambios se detectan en un solo lugar: los eventos de SQLAlchemy (after_flush → se anotan; after_commit → se
avisan; si hay rollback no se avisa nada). Así no hay que tocar cada ruta que guarda. Si la conexión se cae, el
navegador vuelve a consultar cada tanto (ver static/design/vivo.js).
El servidor corre en un solo proceso: los suscriptores viven en memoria.

Auditoría del 19-oct-2026 (con 150 personas, cada guardado hacía que todos los compañeros pidieran el día completo):
- Órdenes: el aviso lleva la ORDEN CAMBIADA ({t:'ord'}), así las pantallas actualizan solo esa fila sin consultar la
  base. Un trabajador en segundo plano (un solo hilo, agrupa cambios seguidos) arma el cambio una vez por guardado.
  Se envía además el aviso de siempre ({t:'dia', p:1}) para las pestañas que aún tengan el JavaScript anterior.
- Quién recibe qué: cada conexión conoce los equipos que su dueño puede ver (administradores: todos; managers y quien
  está a cargo: los suyos; diseñadores: solo sus propias órdenes). Los avisos con datos solo llegan a quien los puede ver.
- Equipos, catálogos, festivos, delegaciones, permisos y copias Face → N2 pendientes también avisan.
"""
import asyncio
import json
import logging
import queue
import threading
import time
from datetime import date
from sqlalchemy import event, inspect
from sqlalchemy.orm import Session, joinedload
from .models_design import (DesignOrden, DesignBreak, DesignPreApprovedSheet, DesignPreApprovedCentro, DesignPreApprovedDoctor,
                            DesignPreApprovedFila, DesignPreApprovedCelda, DesignPreApprovedFoto, DesignInicioPagina, DesignInicioMuro, DesignInicioReaccion,
                            DesignOpeningsHoja, DesignOpeningsColumna, DesignOpeningsFila, DesignCopiaFace, DesignDelegacion,
                            DesignPermisoEdicion, DesignTeam, DesignTeamDesigner, DesignCatalogo, DesignAusenciaTipo, DesignFestivo,
                            DesignArea, DesignCambioDigital, DesignCalEvento, DesignCalVacacionEstimada)
from .models import Solicitud

log = logging.getLogger(__name__)
MAX_COLA = 300              # una pestaña que no lee (colgada) no acumula memoria: los avisos de más se descartan
PRE_APPROVED = (DesignPreApprovedSheet, DesignPreApprovedCentro, DesignPreApprovedDoctor, DesignPreApprovedFila, DesignPreApprovedCelda,
                DesignPreApprovedFoto)
CONFIGURACION = (DesignTeam, DesignTeamDesigner, DesignCatalogo, DesignAusenciaTipo, DesignFestivo, DesignArea)
LOTE_S = 0.12               # los guardados seguidos del mismo equipo y día se juntan en un solo aviso


class _Sub:
    """Una conexión abierta y lo que su dueño puede ver (se usa para no mandar datos a quien no corresponde)."""
    __slots__ = ("loop", "cola", "uid", "ver_todo", "gest", "training")

    def __init__(self, loop, cola, perfil):
        self.loop, self.cola = loop, cola
        self.actualizar(perfil)

    def actualizar(self, perfil):
        p = perfil or {}
        self.uid = p.get("uid")
        self.ver_todo = bool(p.get("ver_todo"))                 # administrador: ve todos los equipos
        self.gest = frozenset(p.get("gest") or ())              # equipos que maneja (manager, a cargo, Support)
        self.training = frozenset(p.get("training") or ())      # Training lo ve todo el mundo

    def ve_equipo(self, team: int) -> bool:
        return self.ver_todo or team in self.gest or team in self.training


_subs: set = set()          # {_Sub}
_lock = threading.Lock()
PERFIL_FN = None            # la pone routers/design_vivo.py: perfil_de(db, empleado_id, equipos) -> dict


def suscribir(perfil: dict | None = None) -> asyncio.Queue:
    cola: asyncio.Queue = asyncio.Queue(maxsize=MAX_COLA)
    with _lock:
        _subs.add(_Sub(asyncio.get_running_loop(), cola, perfil))
    return cola


def desuscribir(cola: asyncio.Queue) -> None:
    with _lock:
        for x in [x for x in _subs if x.cola is cola]:
            _subs.discard(x)


def conexiones() -> int:
    with _lock:
        return len(_subs)


def _poner(cola: asyncio.Queue, datos: str) -> None:
    try:
        cola.put_nowait(datos)
    except asyncio.QueueFull:
        pass


def _enviar(sub: _Sub, datos: str) -> None:
    try:
        sub.loop.call_soon_threadsafe(_poner, sub.cola, datos)
    except RuntimeError:   # el loop de esa conexión ya se cerró
        with _lock:
            _subs.discard(sub)


def _destinos() -> list:
    with _lock:
        return list(_subs)


def publicar(avisos: list[dict]) -> None:
    """Envía los avisos (solo identificadores, ningún dato) a todas las conexiones abiertas. Desde cualquier hilo."""
    if not avisos:
        return
    datos = json.dumps(avisos, separators=(",", ":"))
    for sub in _destinos():
        _enviar(sub, datos)


def publicar_dia(team: int, fecha: str, uids=(), training: bool = False) -> None:
    """Aviso «volver a pedir el día» solo a quien ve ese equipo (y a los diseñadores `uids` afectados). fecha '*' = cualquier día."""
    datos = json.dumps([{"t": "dia", "team": team, "fecha": fecha}], separators=(",", ":"))
    for sub in _destinos():
        if training or sub.ve_equipo(team) or (sub.uid is not None and sub.uid in uids):
            _enviar(sub, datos)


def publicar_a(uids, avisos: list[dict]) -> None:
    """Avisos solo para esas personas (p. ej. un permiso para editar días anteriores)."""
    datos = json.dumps(avisos, separators=(",", ":"))
    for sub in _destinos():
        if sub.uid is not None and sub.uid in uids:
            _enviar(sub, datos)


def publicar_ord(team: int, fecha: str, ordenes: list[dict], borradas: list[int], des_por_orden: dict, training: bool) -> None:
    """El cambio de las órdenes de un equipo y día. Administradores y managers reciben todas; un diseñador, solo las suyas
    (las que tenía o las que ahora tiene). Va con el aviso de siempre ({t:'dia', p:1}) para pestañas con JavaScript anterior."""
    for sub in _destinos():
        if training or sub.ve_equipo(team):
            o, x = ordenes, borradas
        else:
            if sub.uid is None:
                continue
            o = [d for d in ordenes if sub.uid in des_por_orden.get(d["id"], ())]
            x = [i for i in borradas if sub.uid in des_por_orden.get(i, ())]
            if not o and not x:
                continue
        _enviar(sub, json.dumps([{"t": "ord", "team": team, "fecha": fecha, "o": o, "x": x}, {"t": "dia", "team": team, "fecha": fecha, "p": 1}],
                                separators=(",", ":")))


# ---------- Trabajador en segundo plano: arma los cambios una sola vez y recalcula perfiles ----------

_cola_trabajo: "queue.Queue" = queue.Queue()
_hilo = None


def _arrancar() -> None:
    global _hilo
    with _lock:
        if _hilo is not None and _hilo.is_alive():
            return
        _hilo = threading.Thread(target=_bucle, daemon=True, name="design-vivo")
        _hilo.start()


def _encolar(item) -> None:
    _arrancar()
    _cola_trabajo.put(item)


def _bucle() -> None:
    while True:
        lote = [_cola_trabajo.get()]
        time.sleep(LOTE_S)   # junta los guardados seguidos
        try:
            while True:
                lote.append(_cola_trabajo.get_nowait())
        except queue.Empty:
            pass
        try:
            _procesar(lote)
        except Exception:  # noqa: BLE001  (avisar nunca debe tumbar el hilo)
            log.exception("vivo: falló el trabajo en segundo plano")


def _unir(grupos: dict, nuevos: dict) -> None:
    for clave, g in nuevos.items():
        d = grupos.setdefault(clave, {"ids": set(), "des": {}, "brk": set(), "refrescar": False})
        d["ids"] |= g["ids"]
        d["brk"] |= g["brk"]
        d["refrescar"] = d["refrescar"] or g["refrescar"]
        for oid, s in g["des"].items():
            d["des"].setdefault(oid, set()).update(s)


def _procesar(lote: list) -> None:
    from .database import SessionLocal
    grupos: dict = {}
    perfiles_de: set | None = set()
    for tipo, dato in lote:
        if tipo == "dia":
            _unir(grupos, dato)
        elif tipo == "perfiles":
            perfiles_de = None if (dato is None or perfiles_de is None) else perfiles_de | set(dato)
    db = SessionLocal()
    try:
        if perfiles_de is None or perfiles_de:
            _refrescar_perfiles(db, perfiles_de)   # primero: un manager nuevo debe recibir ya sus avisos
        for (team, fecha), g in grupos.items():
            _procesar_grupo(db, team, fecha, g)
    finally:
        db.close()


def _procesar_grupo(db: Session, team: int, fecha: str, g: dict) -> None:
    from . import services_design as sd
    audiencia = set().union(*g["des"].values()) | g["brk"] if (g["des"] or g["brk"]) else set()
    t = db.query(DesignTeam).options(joinedload(DesignTeam.area)).filter(DesignTeam.id == team).first() if team else None
    training = bool(t and sd.es_training(t))
    # copias, delegación, tiempos libres y cambios en bloque: no hay una orden que llevar, la pantalla vuelve a pedir el día
    if g["refrescar"] or fecha == "*" or not g["ids"]:
        publicar_dia(team, fecha, audiencia, training)
        return
    try:
        vivas = {o.id: o for o in db.query(DesignOrden).options(joinedload(DesignOrden.designer)).filter(DesignOrden.id.in_(g["ids"])).all()}
        ordenes, borradas = [], []
        for oid in g["ids"]:
            o = vivas.get(oid)
            if o is not None and o.team_id == team and o.fecha.isoformat() == fecha:
                ordenes.append(sd.serializar_orden(o))
            else:
                borradas.append(oid)   # se borró o se movió a otro equipo / día
        publicar_ord(team, fecha, ordenes, borradas, g["des"], training)
    except Exception:  # noqa: BLE001  (si no se pudo armar el cambio, que las pantallas pidan el día como siempre)
        log.exception("vivo: no se pudo armar el cambio de las órdenes")
        publicar_dia(team, fecha, audiencia, training)
        return
    if g["brk"]:   # además cambiaron tiempos libres: esos sí se piden completos
        publicar_dia(team, fecha, g["brk"], training)


def _refrescar_perfiles(db: Session, uids: set | None) -> None:
    """Recalcula qué puede ver cada conexión (cambió un equipo, un manager, una delegación...)."""
    if PERFIL_FN is None:
        return
    subs = [s for s in _destinos() if s.uid is not None and (uids is None or s.uid in uids)]
    if not subs:
        return
    equipos = (db.query(DesignTeam).options(joinedload(DesignTeam.area), joinedload(DesignTeam.designers)).filter(DesignTeam.activo == 1).all())
    por_uid: dict = {}
    for s in subs:
        if s.uid not in por_uid:
            try:
                por_uid[s.uid] = PERFIL_FN(db, s.uid, equipos)
            except Exception:  # noqa: BLE001
                log.exception("vivo: no se pudo recalcular el perfil de %s", s.uid)
                por_uid[s.uid] = None
        if por_uid[s.uid] is not None:
            s.actualizar(por_uid[s.uid])


def refrescar_perfiles(uids=None) -> None:
    """Pide recalcular los perfiles (uids=None: todos). Se hace en segundo plano."""
    _encolar(("perfiles", None if uids is None else set(uids)))


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


def _info(session: Session) -> dict:
    return session.info.setdefault("ds_vivo", {"dia": {}, "otros": set(), "perfiles": set(), "perfiles_todos": False, "a": []})


def _grupo(info: dict, team: int, fecha: str) -> dict:
    return info["dia"].setdefault((int(team), fecha), {"ids": set(), "des": {}, "brk": set(), "refrescar": False})


def _anotar(session: Session, obj, borrado: bool) -> None:
    info = _info(session)
    otros = info["otros"]
    if isinstance(obj, DesignOrden):
        teams = [t for t in _valores(obj, "team_id") if t]
        fechas = [f for f in _valores(obj, "fecha") if f]
        des = {int(i) for i in _valores(obj, "designer_id") if i}
        for team in teams:
            for f in fechas:
                g = _grupo(info, team, _fecha(f))
                g["ids"].add(obj.id)
                g["des"].setdefault(obj.id, set()).update(des)
        for i in des:
            otros.add(("asig", i, ""))
        if (obj.designer_prestado or "").strip():
            otros.add(("asig", 0, ""))   # prestado por nombre: cada pestaña revisa la suya
    elif isinstance(obj, DesignBreak):
        for team in [t for t in _valores(obj, "team_id") if t]:
            for f in [f for f in _valores(obj, "fecha") if f]:
                g = _grupo(info, team, _fecha(f))
                g["brk"].update(int(i) for i in _valores(obj, "empleado_id") if i)
    elif isinstance(obj, PRE_APPROVED):
        otros.add(("pa", 0, ""))
    elif isinstance(obj, (DesignOpeningsHoja, DesignOpeningsColumna, DesignOpeningsFila)):
        otros.add(("op", 0, ""))
    elif isinstance(obj, DesignInicioPagina):
        otros.add(("inicio", 0, "pub"))
    elif isinstance(obj, (DesignInicioMuro, DesignInicioReaccion)):
        otros.add(("inicio", 0, "muro"))
    elif isinstance(obj, DesignCopiaFace):
        # Copia Face → N2 pendiente de decisión (o decidida): la pantalla del manager de N2 no se enteraba
        n2 = session.get(DesignOrden, obj.n2_orden_id)
        if n2 is not None:
            _grupo(info, n2.team_id, _fecha(n2.fecha))["refrescar"] = True
        else:
            otros.add(("dia", 0, ""))
    elif isinstance(obj, DesignDelegacion):
        _grupo(info, obj.team_id, "*")["refrescar"] = True   # «a cargo»: cualquier día de ese equipo
        info["perfiles"].update(i for i in _valores(obj, "empleado_id") if i)   # el nuevo a cargo debe poder ver el equipo
    elif isinstance(obj, DesignPermisoEdicion):
        info["a"].append(({int(obj.empleado_id)}, {"t": "dia", "team": 0, "fecha": ""}))   # sus días cerrados cambian de estado
    elif isinstance(obj, CONFIGURACION):
        otros.add(("cfg", 0, ""))   # equipos, catálogos, festivos...: las pantallas recargan listas
        info["perfiles_todos"] = True
    elif isinstance(obj, DesignCambioDigital):
        otros.add(("cambios", 0, ""))
    elif isinstance(obj, (Solicitud, DesignCalEvento, DesignCalVacacionEstimada)):
        # Calendario: una solicitud de People nueva, aprobada, rechazada o cancelada cambia las ausencias que se ven
        otros.add(("cal", 0, ""))


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
        otros = _info(estado.session)["otros"]
        for m in estado.all_mappers:
            if m.class_ in PRE_APPROVED:
                otros.add(("pa", 0, ""))
            elif m.class_ in (DesignOpeningsHoja, DesignOpeningsColumna, DesignOpeningsFila):
                otros.add(("op", 0, ""))
            elif m.class_ in (DesignOrden, DesignBreak):
                otros.add(("dia", 0, ""))   # sin equipo ni fecha: todas las pantallas del Schedule revisan
                otros.add(("asig", 0, ""))
            elif m.class_ in (DesignInicioMuro, DesignInicioReaccion):
                otros.add(("inicio", 0, "muro"))
            elif m.class_ is DesignInicioPagina:
                otros.add(("inicio", 0, "pub"))
            elif m.class_ in CONFIGURACION:
                otros.add(("cfg", 0, ""))
            elif m.class_ is Solicitud:
                otros.add(("cal", 0, ""))
    except Exception:  # noqa: BLE001
        log.exception("vivo: no se pudo anotar el cambio en bloque")


@event.listens_for(Session, "after_commit")
def _al_commit(session):
    info = session.info.pop("ds_vivo", None)
    if not info:
        return
    out = []
    for tipo, num, texto in sorted(info["otros"], key=str):
        if tipo == "dia":
            out.append({"t": "dia", "team": num, "fecha": texto})
        elif tipo == "asig":
            if num:
                publicar_a({num}, [{"t": "asig", "id": num}])   # el contador de casos de una persona solo lo necesita ella
            else:
                out.append({"t": "asig", "id": 0})              # sin persona (prestado por nombre, cambios en bloque): todos revisan
        elif tipo in ("pa", "op", "cfg", "cambios", "cal"):
            out.append({"t": tipo})
        elif tipo == "inicio":
            out.append({"t": "inicio", "que": texto})
    publicar(out)
    for uids, aviso in info["a"]:
        publicar_a(uids, [aviso])
    if info["perfiles_todos"]:
        refrescar_perfiles(None)
    elif info["perfiles"]:
        refrescar_perfiles(info["perfiles"])
    if info["dia"]:
        _encolar(("dia", info["dia"]))   # el hilo arma el cambio de las órdenes y lo manda a quien corresponde


@event.listens_for(Session, "after_rollback")
def _al_rollback(session):
    session.info.pop("ds_vivo", None)
