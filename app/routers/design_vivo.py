"""Design en vivo: una conexión por pestaña (Server-Sent Events) que recibe avisos cuando algo cambia.
Ver services_design_vivo. Se incluye desde routers/design_schedule.py.

La conexión NO retiene una conexión de la base de datos: el usuario se verifica con una sesión propia que se cierra
antes de empezar a transmitir (con Depends(get_db) cada pestaña abierta ocuparía una de las 15 del pool)."""
import asyncio
from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from ..database import SessionLocal
from ..models import Empleado
from .. import services_design_vivo as sv

router = APIRouter()
LATIDO_S = 25        # comentario cada 25 s: mantiene viva la conexión a través del proxy de Render
VIDA_MAX_S = 30 * 60  # se reabre cada 30 min (el navegador reconecta solo): limpia conexiones olvidadas


def _puede(email: str) -> bool:
    from ..auth import correo_bloqueado
    if correo_bloqueado(email):
        return False
    db = SessionLocal()
    try:
        u = db.query(Empleado).filter(Empleado.email == email, Empleado.activo == 1).first()
        from ..auth import acceso_inhabilitado
        return bool(u and u.tiene_modulo("design_schedule") and not acceso_inhabilitado(db, u.id, u.rol))
    finally:
        db.close()


def _email_de(request: Request) -> str | None:
    return request.session.get("user_email")


@router.get("/design/api/vivo")
async def api_vivo(request: Request):
    email = _email_de(request)
    if not email:
        raise HTTPException(401, "Sesión vencida.")
    if not await run_in_threadpool(_puede, email):
        raise HTTPException(403, "Sin acceso a Design.")
    cola = sv.suscribir()

    async def flujo():
        try:
            yield "retry: 4000\n\n"            # si se cae, el navegador reintenta a los 4 s
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
