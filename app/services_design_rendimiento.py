"""Diagnóstico de rendimiento (admins, /design/diagnostico/rendimiento): mide en producción lo que la simulación de
150 personas (19-oct-2026) solo podía suponer. Lo que más pesa al abrir el Schedule es la demora de cada consulta a la base
(Render -> Supabase): con 30 ms por consulta, 150 personas entrando a la vez esperaban 15-20 s; con 5 ms, menos de 1 s.
Solo lee: no cambia nada."""
import os
import statistics
import threading
import time

from sqlalchemy import text
from sqlalchemy.orm import Session

from .database import engine
from . import services_design_vivo as sv

_INICIO = time.time()


def _memoria_mb():
    """Memoria del proceso (Linux, como en Render). En otro sistema, None."""
    try:
        with open("/proc/self/status") as f:
            for linea in f:
                if linea.startswith("VmRSS:"):
                    return round(int(linea.split()[1]) / 1024)
    except OSError:
        return None


def medir(db: Session, veces: int = 15) -> dict:
    tiempos = []
    for _ in range(veces):
        t = time.perf_counter()
        db.execute(text("SELECT 1"))
        tiempos.append((time.perf_counter() - t) * 1000)
    ms = statistics.median(tiempos)
    cpu = time.process_time()
    vivo = time.time() - _INICIO
    try:
        carga = [round(x, 2) for x in os.getloadavg()]
    except (AttributeError, OSError):
        carga = None
    # Una apertura del Schedule hace ~55 consultas y solo 8 peticiones de Design van a la vez (DESIGN_CONCURRENCIA)
    abrir_s = 55 * ms / 1000
    llegada_150_s = 150 * abrir_s / max(1, int(os.getenv("DESIGN_CONCURRENCIA", "8")))
    if ms < 8:
        veredicto = ("bien", "La base responde rápido: la demora de red no es un problema.")
    elif ms < 20:
        veredicto = ("regular", "Demora media: en la hora de entrada (todos a la vez) las páginas pueden tardar varios segundos.")
    else:
        veredicto = ("mal", "Demora alta: la base y el servidor parecen estar en regiones distintas. Con 150 personas entrando a la vez "
                            "las páginas tardan mucho. Conviene poner Render y Supabase en la misma región.")
    return {
        "dbMs": round(ms, 1), "dbMinMs": round(min(tiempos), 1), "dbMaxMs": round(max(tiempos), 1), "veredicto": veredicto,
        "abrirS": round(abrir_s, 1), "llegada150S": round(llegada_150_s), "pool": engine.pool.status(),
        "poolUso": getattr(engine.pool, "checkedout", lambda: None)(), "vivo": sv.conexiones(),
        "concurrencia": int(os.getenv("DESIGN_CONCURRENCIA", "8")), "memMb": _memoria_mb(), "hilos": threading.active_count(),
        "cpuPct": round(cpu / vivo * 100, 1) if vivo > 0 else None, "encendidoMin": round(vivo / 60), "carga": carga,
    }
