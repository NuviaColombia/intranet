/* Design en vivo: UNA conexión por pestaña con el servidor (Server-Sent Events, /design/api/vivo). Cuando algo
   cambia, el servidor manda un aviso corto y aquí se reparte como evento 'ds:vivo' del documento:
     {t:'dia', team, fecha}  órdenes o tiempos libres de un equipo y día (team 0 = cualquiera)
     {t:'asig', id}          casos de una persona (id 0 = revisar todos)
     {t:'pa'}                Pre-Approved      {t:'inicio', que:'pub'|'muro'}   página de Inicio
     {t:'reconectado'}       se (re)abrió la conexión: cada pantalla revisa una vez por si se perdió algo
   Cada pantalla decide si el aviso le toca. window.DSVivo.conectado dice si hay conexión: si no la hay, las
   pantallas vuelven a consultar cada pocos segundos como antes. Una pestaña oculta más de 1 min cierra la conexión. */
(function() {
  'use strict';
  if (window.DSVivo) return;
  var es = null, conectado = false, tOculto = null, tReintento = null;
  window.DSVivo = { get conectado() { return conectado; } };
  function disparar(a) { try { document.dispatchEvent(new CustomEvent('ds:vivo', {detail: a})); } catch (e) {} }
  function abrir() {
    if (es || !window.EventSource || document.hidden) return;
    es = new EventSource('/design/api/vivo');
    es.onmessage = function(e) {
      var lista; try { lista = JSON.parse(e.data); } catch (x) { return; }
      (Array.isArray(lista) ? lista : [lista]).forEach(function(a) {
        if (a && a.t === 'hola') { conectado = true; disparar({t: 'reconectado'}); } else if (a) disparar(a);
      });
    };
    es.onerror = function() {
      conectado = false;
      if (es && es.readyState === 2) {   // cerrada del todo (p. ej. sesión vencida): se reintenta más tarde
        es = null; clearTimeout(tReintento); tReintento = setTimeout(abrir, 30000);
      }  // si no, EventSource reconecta sola
    };
  }
  function cerrar() { if (es) { es.close(); es = null; } conectado = false; }
  document.addEventListener('visibilitychange', function() {
    if (document.hidden) { clearTimeout(tOculto); tOculto = setTimeout(cerrar, 60000); }
    else { clearTimeout(tOculto); abrir(); }
  });
  window.addEventListener('pagehide', cerrar);
  abrir();
})();
