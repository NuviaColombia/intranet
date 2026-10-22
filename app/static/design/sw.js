/* Service worker de Nuvia Design: SOLO recibe notificaciones push y abre la página al hacer clic.
   No guarda páginas en caché ni intercepta peticiones (la intranet funciona exactamente igual con o sin él).
   Se sirve en /design/sw.js (alcance: /design/). El aviso llega como JSON: {titulo, cuerpo, url, etiqueta, fijo}.
   `fijo`: el aviso se queda en pantalla hasta que la persona lo cierre con la X (o lo abra). */
self.addEventListener('install', function() { self.skipWaiting(); });
self.addEventListener('activate', function(e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', function(e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = {cuerpo: e.data ? e.data.text() : ''}; }
  var opciones = {
    body: d.cuerpo || '',
    icon: '/static/design/push-icono.png',
    badge: '/static/design/push-icono.png',
    data: {url: d.url || '/design/inicio'},
    tag: d.etiqueta || undefined,
    renotify: !!d.etiqueta,
    requireInteraction: !!d.fijo
  };
  e.waitUntil(self.registration.showNotification(d.titulo || 'Nuvia Design', opciones));
});

// Al tocar el aviso se abre su página (p. ej. el Mural en ese aviso). 22-oct-2026: antes, si la intranet estaba abierta en
// otra página (fuera de /design/ o cargada antes del service worker), navigate() fallaba y no pasaba nada. Ahora: se usa
// una pestaña de la intranet ya abierta (navigate; si no se puede, se le pide a la página que cambie sola con un mensaje);
// si no hay ninguna, se abre una nueva.
self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  var url = new URL((e.notification.data && e.notification.data.url) || '/design/inicio', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(function(lista) {
    var deDesign = function(c) { try { return new URL(c.url).pathname.indexOf('/design') === 0; } catch (err) { return false; } };
    var propias = lista.filter(function(c) { return c.url.indexOf(self.location.origin) === 0; });
    propias.sort(function(a, b) { return deDesign(b) - deDesign(a); });   // primero una pestaña de Design
    var c = propias[0];
    if (!c || !deDesign(c)) return self.clients.openWindow(url);   // fuera de Design: pestaña nueva
    var enfocar = function(x) { return x && 'focus' in x ? x.focus() : null; };
    var porMensaje = function() { c.postMessage({tipo: 'nvAbrir', url: url}); return enfocar(c); };
    if (!('navigate' in c)) return porMensaje();
    return c.navigate(url).then(function(n) { return n ? enfocar(n) : porMensaje(); }, porMensaje)
      .catch(function() { return self.clients.openWindow(url); });
  }));
});
