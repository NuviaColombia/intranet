"""Training › Pizarrón (19-oct-2026): el pizarrón digital de Luis (app/design_pizarron/pizarron.html), montado en la
plataforma según la fase 0 de su «Plan de integración de Pizarrón a plataforma Nuvia Colombia».

- Es la misma aplicación (un solo HTML). Las librerías que cargaba de cdnjs ahora salen de nuestro servidor
  (static/design/pizarron/vendor, mismas versiones, verificadas con las huellas SRI de cdnjs).
- /design/pizarron es una página de la intranet con la barra de arriba; el pizarrón va dentro en un iframe
  (/design/pizarron/app, la única ruta que se deja enmarcar, y solo por la misma intranet). Esc vuelve a la página
  anterior cuando no hay nada abierto en el pizarrón (Rosember, 19-oct-2026); desde el 27-oct-2026 va siempre al Schedule
  (Esc es el acceso directo al Schedule en todo Design). Lo agrega ESC_JS al servir el archivo.
  El archivo del pizarrón no se toca, así que una versión nueva de Luis se monta reemplazando el archivo y cambiando
  las direcciones de cdnjs por las de vendor.
- Política de seguridad (CSP) solo para esta página.
- Los tableros siguen guardándose en el navegador de cada persona (IndexedDB), como en la versión independiente.
  Las salas en vivo (LiveKit), subtítulos y tablero compartido son las fases 1 a 5 del plan: aún no.
- Lo ven las mismas personas que Training (services_design_training.puede_ver).
"""
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse

from ..main_templates import templates

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

# Dentro del iframe: si alguien abre /design/pizarron/app suelto, pasa a la página con la barra; Esc vuelve atrás.
# Esc primero cierra lo que esté abierto (menús, paneles, selección, presentación, texto en edición: eso lo hace el
# pizarrón con su propio Esc); solo si no hay nada abierto vuelve. Antes guarda lo pendiente (guarda 1,2 s después).
ESC_JS = """
<script>
(function () {
  if (window.top === window) { location.replace('/design/pizarron' + location.search); return; }
  function ocupado() {
    var b = document.body, a = document.activeElement;
    if (b.classList.contains('presenting')) return true;
    if (a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT' || a.tagName === 'SELECT' || a.isContentEditable)) return true;
    if (document.querySelector('.pop.show, .panel.show, #lassobar.show, #connPop.show, .stlfocus')) return true;
    try { if (selObj || lassoSel || linkFirst || connRelink) return true; } catch (e) {}
    return false;
  }
  async function guardarPendiente() {
    var espera = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    try { clearTimeout(dirtyT); await Promise.race([doSave(), espera(2500)]); } catch (e) {}   // nunca deja a la persona esperando
    for (var i = 0; i < 25; i++) { try { if (!saving) break; } catch (e) { break; } await espera(100); }
  }
  async function volver() {
    var r = window.DSReunion && window.DSReunion.estado && window.DSReunion.estado();
    if (r && !confirm('Estás en una reunión en vivo. ¿Salir del Pizarrón? Saldrás de la reunión.')) return;
    if (r) try { window.DSReunion.salir(true); } catch (e) {}
    await guardarPendiente();
    if (window.parent.nvVolverPizarron) window.parent.nvVolverPizarron(); else window.top.location.href = '/design';
  }
  // En captura: se decide antes de que el pizarrón cierre lo que tenga abierto con el mismo Esc
  window.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || e.repeat) return;
    if (document.getElementById('rvPanel') && document.activeElement && document.activeElement.closest && document.activeElement.closest('#rvPanel')) return;
    var abiertos = document.querySelectorAll('.pop.show, .panel.show');
    if (abiertos.length) {   // menús y paneles del pizarrón: Esc los cierra (él no lo hace) y no se sale
      e.preventDefault();
      try { closePops(); } catch (x) {}
      abiertos.forEach(function (el) { el.classList.remove('show'); });
      return;
    }
    if (ocupado()) return;
    e.preventDefault(); volver();
  }, true);
  window.nvVolver = volver;
})();
</script>
"""


def _visible(user: Empleado = Depends(require_modulo("design_schedule"))) -> Empleado:
    if not st.puede_ver(user):
        raise HTTPException(403, "El Pizarrón todavía no está disponible para tu usuario.")
    return user


@router.get("/design/pizarron")
def pagina_pizarron(request: Request, user: Empleado = Depends(_visible)):
    """La página con la barra de la intranet; el pizarrón va dentro (ver /design/pizarron/app)."""
    return templates.TemplateResponse(request, "design_pizarron.html", {"user": user, "es_design": True,
                                                                        "consulta": request.url.query})


@router.get("/design/pizarron/app")
def app_pizarron(user: Empleado = Depends(_visible)):
    html = ARCHIVO.read_text(encoding="utf-8")
    i = html.rfind("</body>")
    try:
        v = str(int(REUNION_JS.stat().st_mtime))
    except OSError:
        v = "1"
    extra = ESC_JS + f'<script src="/static/design/pizarron/reunion.js?v={v}"></script>\n'   # Reunión en vivo (routers/design_reunion.py)
    html = html[:i] + extra + html[i:] if i >= 0 else html + extra
    # única ruta de la intranet que se deja enmarcar, y solo por la misma intranet (frame-ancestors 'self' en la CSP)
    return HTMLResponse(html, headers={"Content-Security-Policy": CSP, "Cache-Control": "no-cache", "X-Frame-Options": "SAMEORIGIN"})
