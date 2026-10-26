/* Esc = acceso directo al Schedule (Rosember, 27-oct-2026).
   En cualquier pantalla de Design (Calendario, Parámetros, Centro de avisos, Training, Office, Mural, Development, reportes…)
   Esc te lleva al Schedule, SALVO que esa Esc ya haya servido para otra cosa, porque hay pantallas con su propio Esc de
   varios niveles (Training: lección → módulo; ventanas y menús que se cierran; un campo que se deja de editar…). Para
   respetarlas sin tocar cada pantalla, se mira qué pasó DESPUÉS de que los demás atendieron la tecla: si alguno cerró o
   abrió algo (cambió la pantalla), movió el foco, cambió la dirección o canceló el evento, no se navega.
   - Escribiendo en un campo: la primera Esc solo sale del campo (no se pierde lo escrito); la segunda va al Schedule.
   - El Schedule (/design) ya cierra sus paneles con Esc, y el Pizarrón tiene su propio Esc (vuelve al Schedule): no se tocan. */
(function () {
  'use strict';
  var ruta = location.pathname.replace(/\/+$/, '');
  if (ruta === '/design' || ruta.indexOf('/design/pizarron') === 0) return;

  var ATRIBUTOS = {'class': 1, hidden: 1, open: 1, style: 1, 'aria-hidden': 1, 'aria-expanded': 1};
  var TIPOS_TEXTO = /^(text|search|email|url|tel|number|password|date|datetime-local|time|month|week)?$/i;

  function escribiendo(a) {
    if (!a || a === document.body) return false;
    if (a.isContentEditable || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT') return true;
    return a.tagName === 'INPUT' && TIPOS_TEXTO.test(a.getAttribute('type') || '');
  }
  function visible(el) { return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length)); }

  window.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || e.repeat || e.isComposing) return;
    if (document.fullscreenElement) return;   // Esc sale de pantalla completa
    var menu = document.querySelector('.nav-drop-menu.open');
    if (menu) { menu.classList.remove('open'); return; }   // un menú de la barra abierto: Esc solo lo cierra

    var foco = document.activeElement, escribia = escribiendo(foco), url = location.href, cambios = 0;
    var obs = new MutationObserver(function (lista) {
      lista.forEach(function (m) {
        // solo cambios reales: volver a poner el mismo valor (p. ej. un hidden en algo ya oculto) no es haber atendido la tecla
        if (m.type === 'attributes') { if (ATRIBUTOS[m.attributeName] && m.target.getAttribute(m.attributeName) !== m.oldValue) cambios++; return; }
        if (m.type === 'childList') {   // solo si entran o salen elementos (no el texto de un reloj que se actualiza solo)
          var nodos = [].slice.call(m.addedNodes).concat([].slice.call(m.removedNodes));
          if (nodos.some(function (n) { return n.nodeType === 1; })) cambios++;
        }
      });
    });
    obs.observe(document.documentElement, {childList: true, subtree: true, attributes: true, attributeOldValue: true});

    // después de que los demás atendieron la tecla (también lo asíncrono: un cambio de #, un render)
    setTimeout(function () {
      obs.disconnect();
      if (e.defaultPrevented) return;                          // alguien la usó
      if (escribia) {                                           // primera Esc: sale del campo y ya
        try { if (document.activeElement === foco) foco.blur(); } catch (x) {}
        return;
      }
      if (cambios || location.href !== url || document.activeElement !== foco) return;   // cerró/abrió algo, cambió de lugar o de foco
      var dialogos = [].slice.call(document.querySelectorAll('dialog[open], [aria-modal="true"]'));
      if (dialogos.some(visible)) return;                       // hay una ventana abierta que no se cerró con Esc
      location.href = '/design';
    }, 80);
  }, true);
})();
