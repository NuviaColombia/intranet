"""Caché en memoria, de corta duración, para las consultas más pesadas del dashboard de Activos
(`listar_grupos`, `obtener_estado_mantenimiento` en `services_activos_consultas.py`) -- ver
"Caché del dashboard" en docs/wiki/activos.md.

Es deliberadamente simple: un TTL corto, más una invalidación explícita desde `auditar()`
(`services_activos.py`), que ya se llama en cada escritura del módulo (equipos, mantenimientos,
grupos, solicitudes...). El TTL es la red de seguridad real, no la invalidación: Render tiene
autoscaling activado para este servicio (hasta 2 instancias), y una escritura en una instancia NO
invalida la caché en memoria de la otra -- por eso el TTL se mantiene corto a propósito."""
import time
from threading import Lock

TTL_SEGUNDOS = 20
_valores: dict[str, tuple[float, object]] = {}
_candado = Lock()


def cacheado(clave: str, calcular, ttl: float = TTL_SEGUNDOS):
    """Devuelve el valor cacheado para `clave` si tiene menos de `ttl` segundos; si no, lo calcula
    con `calcular()`, lo guarda y lo devuelve. `calcular()` debe devolver solo tipos simples (dict,
    list, str, int, date...) -- nunca objetos ORM atados a la sesión que lo calculó."""
    ahora = time.monotonic()
    with _candado:
        entrada = _valores.get(clave)
        if entrada and ahora - entrada[0] < ttl:
            return entrada[1]
    valor = calcular()
    with _candado:
        _valores[clave] = (ahora, valor)
    return valor


def invalidar() -> None:
    with _candado:
        _valores.clear()
