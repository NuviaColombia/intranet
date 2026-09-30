"""Tope de peticiones usando la base de datos a la vez, por grupo de rutas.

Sin tope, un pico (p. ej. 130 personas entrando al inicio del turno) trababa el servidor: las peticiones que
esperaban conexión del pool (5 + 10) ocupaban los 40 hilos de FastAPI y las que ya tenían conexión no conseguían
hilo para terminar y devolverla -> 30 s de espera y error 500. Con el tope, la espera ocurre antes de tomar hilo o
conexión. Design Schedule tiene su propio grupo (DESIGN_CONCURRENCIA, 8) y el resto de módulos comparte otro
(CONCURRENCIA_GENERAL, 6): 14 en total, por debajo de las 15 conexiones del pool.
"""
import asyncio
import os
import weakref

from fastapi import Request
from fastapi.routing import APIRoute


def clase_con_cupo(capacidad: int) -> type[APIRoute]:
    """Clase de ruta para APIRouter(route_class=...): las rutas del router comparten `capacidad` cupos."""
    capacidad = max(1, capacidad)
    por_loop: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Semaphore]" = weakref.WeakKeyDictionary()

    def cupos() -> asyncio.Semaphore:
        loop = asyncio.get_running_loop()  # uno por event loop (las pruebas crean varios)
        sem = por_loop.get(loop)
        if sem is None:
            sem = por_loop[loop] = asyncio.Semaphore(capacidad)
        return sem

    class RutaConCupo(APIRoute):
        def get_route_handler(self):
            original = super().get_route_handler()

            async def handler(request: Request):
                async with cupos():
                    return await original(request)
            return handler

    RutaConCupo.capacidad = capacidad
    return RutaConCupo


# Grupo compartido por todos los módulos salvo Design Schedule (que tiene el suyo) y el login.
RutaGeneral = clase_con_cupo(int(os.getenv("CONCURRENCIA_GENERAL", "6")))
