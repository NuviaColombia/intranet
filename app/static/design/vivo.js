/* Design en vivo: UNA conexión por pestaña con el servidor (Server-Sent Events, /design/api/vivo). Cuando algo
   cambia, el servidor manda un aviso corto y aquí se reparte como evento 'ds:vivo' del documento:
     {t:'dia', team, fecha}  órdenes o tiempos libres de un equipo y día (team 0 = cualquiera)
     {t:'asig', id}          casos de una persona (id 0 = revisar todos)
     {t:'ord', team, fecha, o:[órdenes], x:[ids]}  el cambio de las órdenes de un equipo y día (solo las que puede ver esa persona)
     {t:'cfg'}               equipos, catálogos, festivos...   {t:'cambios'}  Cambios digitales   {t:'ayuda'}  Solicitar ayuda
     {t:'gv'}                marcas nuevas de GeoVictoria (Seguimiento)
     {t:'op'}                Openings (Parámetros)   {t:'pa'}   Pre-Approved      {t:'inicio', que:'pub'|'muro'}   página de Inicio
     {t:'reconectado', primera}  se (re)abrió la conexión: cada pantalla revisa una vez por si se perdió algo
                             (primera: true = la conexión al abrir la página; quien acaba de cargar sus datos la ignora)
   Cada pantalla decide si el aviso le toca. window.DSVivo.conectado dice si hay conexión: si no la hay, las
   pantallas vuelven a consultar cada pocos segundos como antes. Una pestaña oculta más de 1 min cierra la conexión. */
(function() {
  'use strict';
  if (window.DSVivo) return;
  var es = null, conectado = false, tOculto = null, tReintento = null, primera = true, holaEn = 0;
  window.DSVivo = { get conectado() { return conectado; }, get holaEn() { return holaEn; } };   // holaEn: cuándo quedó conectada
  function disparar(a) { try { document.dispatchEvent(new CustomEvent('ds:vivo', {detail: a})); } catch (e) {} }
  function abrir() {
    if (es || !window.EventSource || document.hidden) return;
    es = new EventSource('/design/api/vivo');
    es.onmessage = function(e) {
      var lista; try { lista = JSON.parse(e.data); } catch (x) { return; }
      (Array.isArray(lista) ? lista : [lista]).forEach(function(a) {
        if (a && a.t === 'hola') {
          conectado = true; holaEn = Date.now();
          // Al volver la conexión (p. ej. tras publicar una versión nueva) cada pantalla espera un tiempo distinto antes de
          // pedir datos: así 150 personas no los piden en el mismo segundo (auditoría 19-oct-2026).
          // `primera`: es la conexión al abrir la página; quien acaba de cargar sus datos no necesita volver a pedirlos.
          var esPrimera = primera, espera = primera ? Math.random() * 1000 : 500 + Math.random() * 6000; primera = false;
          setTimeout(function() { disparar({t: 'reconectado', primera: esPrimera}); }, espera);
        } else if (a) disparar(a);
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
