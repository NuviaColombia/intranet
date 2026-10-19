"""Pizarrón › Reunión en vivo (Rosember, 19-oct-2026): cámara y micrófono entre 2 y 6 personas, directo entre PCs
(WebRTC). La intranet solo hace de «presentador»: crea la sala con un código, dice quién está y pasa los mensajes
para que los navegadores se conecten entre sí. El video y el audio NO pasan por el servidor.

- Salas en memoria (un solo proceso uvicorn, como el resto de lo «en vivo»): si el servidor se reinicia, la reunión
  se corta y hay que crear otra. Se borran solas al quedar vacías.
- Entran quienes pueden abrir el Pizarrón (services_design_training.puede_ver) y conocen el código.
- La conexión de mensajes (SSE) no ocupa conexión de la base ni cupo de Design (como routers/design_vivo.py).
- Redes de empresa muy cerradas pueden necesitar un servidor TURN de respaldo (no incluido; ver ICE en reunion.js).
"""
import asyncio
import json
import random
import secrets
import threading
import time
from collections import deque

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..database import SessionLocal
from ..models import Empleado
from .. import services_design_training as st
from .design_schedule import require_modulo

router = APIRouter()   # sin cupo de Design: la conexión de mensajes queda abierta toda la reunión
MAX_PERSONAS = 6
LETRAS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"   # sin 0/O ni 1/I/L, que se confunden
VIDA_SALA_S = 12 * 3600
_lock = threading.Lock()
_salas: dict[str, dict] = {}
_intentos: dict[int, deque] = {}


def _codigo() -> str:
    while True:
        c = "".join(secrets.choice(LETRAS) for _ in range(3)) + "-" + "".join(secrets.choice(LETRAS) for _ in range(4))
        if c not in _salas:
            return c


def _limpiar() -> None:
    ahora = time.time()
    for c in [c for c, s in _salas.items() if (not s["peers"] and ahora - s["vacia_desde"] > 600) or ahora - s["creada"] > VIDA_SALA_S]:
        _salas.pop(c, None)


def _puede(user: Empleado = Depends(require_modulo("design_schedule"))) -> Empleado:
    if not st.puede_ver(user):
        raise HTTPException(403, "El Pizarrón todavía no está disponible para tu usuario.")
    return user


def _enviar(peer: dict, msg: dict) -> None:
    peer["cola"].append(json.dumps(msg, separators=(",", ":")))


def _sala(codigo: str, user: Empleado) -> dict:
    codigo = (codigo or "").strip().upper()
    s = _salas.get(codigo)
    if not s:
        hist = _intentos.setdefault(user.id, deque(maxlen=10))
        hist.append(time.time())
        if len(hist) == 10 and time.time() - hist[0] < 300:
            raise HTTPException(429, "Demasiados códigos incorrectos. Espera unos minutos.")
        raise HTTPException(404, "No hay ninguna reunión con ese código (o ya terminó).")
    return s


def _peer(s: dict, peer_id: str, user: Empleado) -> dict:
    p = s["peers"].get(peer_id)
    if not p or p["uid"] != user.id:
        raise HTTPException(404, "Ya no estás en esta reunión.")
    return p


@router.post("/design/api/reunion/crear")
def api_crear(user: Empleado = Depends(_puede)):
    with _lock:
        _limpiar()
        c = _codigo()
        _salas[c] = {"anfitrion": user.id, "creada": time.time(), "vacia_desde": time.time(), "peers": {}}
    return {"codigo": c}


@router.post("/design/api/reunion/{codigo}/entrar")
def api_entrar(codigo: str, user: Empleado = Depends(_puede)):
    with _lock:
        s = _sala(codigo, user)
        if len(s["peers"]) >= MAX_PERSONAS:
            raise HTTPException(409, f"La reunión está llena (máximo {MAX_PERSONAS} personas).")
        pid = secrets.token_urlsafe(9)
        yo = {"uid": user.id, "nombre": user.nombre_completo, "cola": deque(maxlen=500), "visto": time.time()}
        otros = [{"peer": k, "nombre": p["nombre"]} for k, p in s["peers"].items()]
        for p in s["peers"].values():
            _enviar(p, {"t": "llego", "peer": pid, "nombre": yo["nombre"]})
        s["peers"][pid] = yo
    return {"peer": pid, "codigo": codigo.strip().upper(), "nombre": yo["nombre"], "otros": otros,
            "anfitrion": s["anfitrion"] == user.id, "max": MAX_PERSONAS}


class SenalIn(BaseModel):
    peer: str = Field(max_length=40)
    para: str = Field(max_length=40)
    datos: dict


@router.post("/design/api/reunion/{codigo}/senal")
def api_senal(codigo: str, payload: SenalIn, user: Empleado = Depends(_puede)):
    """Pasa un mensaje de conexión (oferta, respuesta o candidato) de un navegador a otro de la misma sala."""
    if len(json.dumps(payload.datos)) > 60000:
        raise HTTPException(413, "Mensaje demasiado grande.")
    with _lock:
        s = _sala(codigo, user)
        _peer(s, payload.peer, user)
        destino = s["peers"].get(payload.para)
        if destino:
            _enviar(destino, {"t": "senal", "de": payload.peer, "datos": payload.datos})
    return {"ok": True}


def _sacar(s: dict, peer_id: str) -> None:
    if s["peers"].pop(peer_id, None) is not None:
        for p in s["peers"].values():
            _enviar(p, {"t": "salio", "peer": peer_id})
        if not s["peers"]:
            s["vacia_desde"] = time.time()


class SalirIn(BaseModel):
    peer: str = Field(max_length=40)


@router.post("/design/api/reunion/{codigo}/salir")
def api_salir(codigo: str, payload: SalirIn, user: Empleado = Depends(_puede)):
    with _lock:
        s = _salas.get(codigo.strip().upper())
        if s and payload.peer in s["peers"] and s["peers"][payload.peer]["uid"] == user.id:
            _sacar(s, payload.peer)
    return {"ok": True}


def _quizas_sacar(s: dict, peer_id: str, fin: float) -> None:
    with _lock:
        p = s["peers"].get(peer_id)
        if p and p["visto"] <= fin:
            _sacar(s, peer_id)


def _usuario_stream(email: str | None) -> Empleado | None:
    """Verifica la sesión con una conexión de la base que se cierra antes de transmitir."""
    if not email:
        return None
    from ..auth import acceso_inhabilitado, correo_bloqueado
    if correo_bloqueado(email):
        return None
    db = SessionLocal()
    try:
        u = db.query(Empleado).filter(Empleado.email == email, Empleado.activo == 1).first()
        if not (u and u.tiene_modulo("design_schedule") and not acceso_inhabilitado(db, u.id, u.rol)):
            return None
        from .design_schedule import _aplicar_rol_design
        u = _aplicar_rol_design(db, u)
        if not st.puede_ver(u):
            return None
        db.expunge(u)
        return u
    finally:
        db.close()


@router.get("/design/api/reunion/{codigo}/eventos")
async def api_eventos(codigo: str, peer: str, request: Request):
    """Mensajes para este navegador: quién llega, quién sale y los mensajes de conexión que le mandan los demás."""
    from fastapi.concurrency import run_in_threadpool
    user = await run_in_threadpool(_usuario_stream, request.session.get("user_email"))
    if not user:
        raise HTTPException(401, "Sesión vencida.")
    with _lock:
        s = _sala(codigo, user)
        p = _peer(s, peer, user)

    async def flujo():
        ultimo = time.time()
        try:
            yield f"retry: {random.randint(1500, 4000)}\n\n"
            yield 'data: {"t":"hola"}\n\n'
            while True:
                with _lock:
                    if _salas.get(codigo.strip().upper()) is not s or peer not in s["peers"]:
                        break
                    p["visto"] = time.time()
                    lote = list(p["cola"]); p["cola"].clear()
                for m in lote:
                    yield f"data: {m}\n\n"
                if time.time() - ultimo > 20:
                    ultimo = time.time()
                    if await request.is_disconnected():
                        break
                    yield ": latido\n\n"
                await asyncio.sleep(0.08 if not lote else 0.02)
        finally:
            # Se cortó la conexión de mensajes: si en 6 s no vuelve (el navegador reconecta solo), sale de la sala
            fin = time.time()
            threading.Timer(6, _quizas_sacar, args=(s, peer, fin)).start()

    return StreamingResponse(flujo(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", "Connection": "keep-alive"})
