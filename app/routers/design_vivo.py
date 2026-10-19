"""Design en vivo: una conexión por pestaña (Server-Sent Events) que recibe avisos cuando algo cambia.
Ver services_design_vivo. Se incluye desde routers/design_schedule.py.

La conexión NO retiene una conexión de la base de datos: el usuario se verifica con una sesión propia que se cierra
antes de empezar a transmitir (con Depends(get_db) cada pestaña abierta ocuparía una de las 15 del pool)."""
import asyncio
import random
from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from ..database import SessionLocal
from ..models import Empleado
from .. import services_design_vivo as sv

router = APIRouter()
LATIDO_S = 25        # comentario cada 25 s: mantiene viva la conexión a través del proxy de Render
VIDA_MAX_S = 30 * 60  # se reabre cada 30 min (el navegador reconecta solo): limpia conexiones olvidadas


def perfil_de(db, empleado_id: int, equipos=None) -> dict:
    """Qué puede ver esta persona, para mandarle solo los avisos con datos que le corresponden: administradores, todos los
    equipos; managers (y quien está a cargo), los suyos; diseñadores, solo sus propias órdenes (Training lo ve todo el mundo)."""
    from .. import services_design as sd
    from ..models_design import DesignTeam
    from .design_schedule import _aplicar_rol_design
    from sqlalchemy.orm import joinedload
    e = _aplicar_rol_design(db, db.get(Empleado, empleado_id))   # incluye el rol que solo tiene en Design
    if equipos is None:
        equipos = db.query(DesignTeam).options(joinedload(DesignTeam.area), joinedload(DesignTeam.designers)).filter(DesignTeam.activo == 1).all()
    return {"uid": e.id, "ver_todo": sd.es_admin(e),
            "gest": {t.id for t in equipos if sd.gestiona_equipo(e, t)},
            "training": {t.id for t in equipos if sd.es_training(t)}}


sv.PERFIL_FN = perfil_de


def _acceso(email: str) -> dict | None:
    """El perfil de quien se conecta, o None si no tiene acceso a Design."""
    from ..auth import correo_bloqueado
    if correo_bloqueado(email):
        return None
    db = SessionLocal()
    try:
        u = db.query(Empleado).filter(Empleado.email == email, Empleado.activo == 1).first()
        from ..auth import acceso_inhabilitado
        if not (u and u.tiene_modulo("design_schedule") and not acceso_inhabilitado(db, u.id, u.rol)):
            return None
        try:
            return perfil_de(db, u.id)
        except Exception:  # noqa: BLE001  (sin perfil: solo recibe lo suyo; el respaldo de 90 s lo mantiene al día)
            import logging
            logging.getLogger(__name__).exception("vivo: no se pudo armar el perfil de %s", u.id)
            return {"uid": u.id, "ver_todo": False, "gest": set(), "training": set()}
    finally:
        db.close()


def _email_de(request: Request) -> str | None:
    return request.session.get("user_email")


@router.get("/design/api/vivo")
async def api_vivo(request: Request):
    email = _email_de(request)
    if not email:
        raise HTTPException(401, "Sesión vencida.")
    perfil = await run_in_threadpool(_acceso, email)
    if not perfil:
        raise HTTPException(403, "Sin acceso a Design.")
    cola = sv.suscribir(perfil)

    async def flujo():
        try:
            # Si se cae (p. ej. al publicar una versión nueva), el navegador reintenta entre 3 y 15 s: cada conexión espera un tiempo
            # distinto, para que 150 personas no reconecten y pidan datos en el mismo segundo (auditoría 19-oct-2026).
            yield f"retry: {random.randint(3000, 15000)}\n\n"
            yield 'data: [{"t":"hola"}]\n\n'
            loop = asyncio.get_running_loop()
            fin = loop.time() + VIDA_MAX_S
            while loop.time() < fin:
                try:
                    datos = await asyncio.wait_for(cola.get(), timeout=LATIDO_S)
                    yield f"data: {datos}\n\n"
                except asyncio.TimeoutError:
                    if await request.is_disconnected():
                        break
                    yield ": latido\n\n"
        finally:
            sv.desuscribir(cola)

    return StreamingResponse(flujo(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", "Connection": "keep-alive"})
