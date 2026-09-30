"""Copia de archivos a Zoho WorkDrive (API v1 con OAuth: self-client con refresh token).

Configuración en Render (variables de entorno, nunca en el código):
  ZOHO_WORKDRIVE_REFRESH_TOKEN  refresh token con el alcance WorkDrive.files.ALL
  ZOHO_WORKDRIVE_CARPETA_ID     id de la carpeta raíz de WorkDrive donde se guardan los archivos
  ZOHO_WORKDRIVE_CLIENT_ID / ZOHO_WORKDRIVE_CLIENT_SECRET  (si no se ponen, usa las de Cliq)
Si falta algo, no se sube nada y queda pendiente (la intranet sigue guardando el archivo)."""
import os
import time
import httpx
from . import config

REFRESH_TOKEN = os.getenv("ZOHO_WORKDRIVE_REFRESH_TOKEN", "")
CARPETA_RAIZ = os.getenv("ZOHO_WORKDRIVE_CARPETA_ID", "").strip()
CLIENT_ID = os.getenv("ZOHO_WORKDRIVE_CLIENT_ID", "") or config.ZOHO_CLIQ_CLIENT_ID
CLIENT_SECRET = os.getenv("ZOHO_WORKDRIVE_CLIENT_SECRET", "") or config.ZOHO_CLIQ_CLIENT_SECRET
API = f"https://www.zohoapis.{config.ZOHO_REGION}/workdrive/api/v1"

_token = {"valor": None, "vence": 0}
_carpetas: dict[tuple[str, str], str] = {}  # (padre, nombre) -> id, para no buscarlas cada vez


def configurado() -> bool:
    return bool(REFRESH_TOKEN and CARPETA_RAIZ and CLIENT_ID and CLIENT_SECRET)


def _access_token() -> str:
    if _token["valor"] and time.time() < _token["vence"] - 60:
        return _token["valor"]
    r = httpx.post(f"{config.ZOHO_ACCOUNTS_URL}/oauth/v2/token", data={
        "grant_type": "refresh_token", "refresh_token": REFRESH_TOKEN, "client_id": CLIENT_ID, "client_secret": CLIENT_SECRET,
    }, timeout=20)
    r.raise_for_status()
    datos = r.json()
    if "access_token" not in datos:
        raise RuntimeError(f"Zoho no devolvió token: {datos.get('error', datos)}")
    _token["valor"], _token["vence"] = datos["access_token"], time.time() + int(datos.get("expires_in", 3600))
    return _token["valor"]


def _cabeceras() -> dict:
    return {"Authorization": f"Zoho-oauthtoken {_access_token()}", "Accept": "application/vnd.api+json"}


def _limpiar(nombre: str) -> str:
    """Nombre válido para WorkDrive (sin / \\ : * ? " < > |)."""
    for ch in '/\\:*?"<>|':
        nombre = nombre.replace(ch, "-")
    return " ".join(nombre.split())[:200] or "archivo"


def carpeta(padre: str, nombre: str) -> str:
    """Id de la subcarpeta `nombre` dentro de `padre`; la crea si no existe."""
    nombre = _limpiar(nombre)
    clave = (padre, nombre.lower())
    if clave in _carpetas:
        return _carpetas[clave]
    r = httpx.get(f"{API}/files/{padre}/files", headers=_cabeceras(), params={"filter[type]": "folder", "page[limit]": 200}, timeout=30)
    r.raise_for_status()
    for f in r.json().get("data", []):
        if str(f.get("attributes", {}).get("name", "")).strip().lower() == nombre.lower():
            _carpetas[clave] = f["id"]
            return f["id"]
    r = httpx.post(f"{API}/files", headers={**_cabeceras(), "Content-Type": "application/vnd.api+json"},
                   json={"data": {"attributes": {"name": nombre, "parent_id": padre}, "type": "files"}}, timeout=30)
    r.raise_for_status()
    _carpetas[clave] = r.json()["data"]["id"]
    return _carpetas[clave]


def subir(ruta: list[str], nombre: str, datos: bytes, tipo: str) -> str:
    """Sube el archivo a CARPETA_RAIZ/ruta[0]/ruta[1]/... y devuelve su id en WorkDrive."""
    padre = CARPETA_RAIZ
    for parte in ruta:
        padre = carpeta(padre, parte)
    r = httpx.post(f"{API}/upload", headers=_cabeceras(),
                   data={"parent_id": padre, "filename": _limpiar(nombre), "override-name-exist": "true"},
                   files={"content": (_limpiar(nombre), datos, tipo)}, timeout=120)
    r.raise_for_status()
    info = r.json().get("data", [{}])
    info = info[0] if isinstance(info, list) else info
    return str(info.get("attributes", {}).get("resource_id") or info.get("id") or "")


def a_papelera(archivo_id: str) -> None:
    """Manda un archivo a la papelera de WorkDrive (se puede recuperar desde allá)."""
    r = httpx.patch(f"{API}/files/{archivo_id}", headers={**_cabeceras(), "Content-Type": "application/vnd.api+json"},
                    json={"data": {"attributes": {"status": "51"}, "type": "files"}}, timeout=30)
    r.raise_for_status()
