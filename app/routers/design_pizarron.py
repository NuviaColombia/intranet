"""Training › Pizarrón (19-oct-2026): el pizarrón digital de Luis (app/design_pizarron/pizarron.html), montado en la
plataforma según la fase 0 de su «Plan de integración de Pizarrón a plataforma Nuvia Colombia».

- Es la misma aplicación (un solo HTML). Las librerías que cargaba de cdnjs ahora salen de nuestro servidor
  (static/design/pizarron/vendor, mismas versiones, verificadas con las huellas SRI de cdnjs).
- Va como página propia a pantalla completa (no en iframe: la intranet manda X-Frame-Options DENY a todo).
  Al servirla se agrega un botón para volver a la intranet; el archivo del pizarrón no se toca, así que una versión
  nueva de Luis se monta reemplazando el archivo y cambiando las direcciones de cdnjs por las de vendor.
- Política de seguridad (CSP) solo para esta página.
- Los tableros siguen guardándose en el navegador de cada persona (IndexedDB), como en la versión independiente.
  Las salas en vivo (LiveKit), subtítulos y tablero compartido son las fases 1 a 5 del plan: aún no.
- Lo ven las mismas personas que Training (services_design_training.puede_ver).
"""
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse

from ..models import Empleado
from .. import services_design_training as st
from .design_schedule import require_modulo, _RutaDesign

router = APIRouter(route_class=_RutaDesign)
ARCHIVO = Path(__file__).resolve().parent.parent / "design_pizarron" / "pizarron.html"
REUNION_JS = Path(__file__).resolve().parent.parent / "static" / "design" / "pizarron" / "reunion.js"

CSP = "; ".join([
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",                     # la app es un solo HTML con su código adentro
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",                    # imágenes pegadas o enlazadas desde la web
    "media-src 'self' data: blob:",                         # grabación de pantalla y videos del tablero
    "connect-src 'self' data: blob:",
    "worker-src 'self' blob:",                              # pdf.js
    "frame-src https: blob: data:",                         # tarjeta «Web» (búsqueda embebida) y documentos
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'self'",
])

# Botón para volver a la intranet (abajo al centro, discreto: a los lados están el mini-mapa y el zoom del pizarrón)
VOLVER = """
<a href="/design/training" id="nvVolver" title="Volver a la intranet (Training)" aria-label="Volver a la intranet">‹ Intranet</a>
<style>
  #nvVolver{position:fixed;left:50%;transform:translateX(-50%);bottom:12px;z-index:2147483000;font:600 12px system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
    color:#f2f2ef;background:rgba(35,38,45,.88);border:1px solid #3a3f4a;border-radius:999px;padding:6px 12px;text-decoration:none;
    box-shadow:0 4px 14px rgba(0,0,0,.25);opacity:.75;transition:opacity .15s}
  #nvVolver:hover,#nvVolver:focus-visible{opacity:1;outline:none}
</style>
"""


def _visible(user: Empleado = Depends(require_modulo("design_schedule"))) -> Empleado:
    if not st.puede_ver(user):
        raise HTTPException(403, "El Pizarrón todavía no está disponible para tu usuario.")
    return user


@router.get("/design/pizarron")
def pagina_pizarron(user: Empleado = Depends(_visible)):
    html = ARCHIVO.read_text(encoding="utf-8")
    i = html.rfind("</body>")
    try:
        v = str(int(REUNION_JS.stat().st_mtime))
    except OSError:
        v = "1"
    extra = VOLVER + f'<script src="/static/design/pizarron/reunion.js?v={v}"></script>\n'   # Reunión en vivo (routers/design_reunion.py)
    html = html[:i] + extra + html[i:] if i >= 0 else html + extra
    return HTMLResponse(html, headers={"Content-Security-Policy": CSP, "Cache-Control": "no-cache"})
