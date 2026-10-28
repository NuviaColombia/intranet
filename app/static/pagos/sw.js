/* Service worker de Pagos: SOLO recibe notificaciones push y abre la página al hacer clic.
   No guarda páginas en caché ni intercepta peticiones. Se sirve en /pagos/sw.js (alcance: /pagos/).
   El aviso llega como JSON: {titulo, cuerpo, url, etiqueta, fijo}. Igual que /design/sw.js, pero con
   alcance propio -- ver docs/wiki/caja_menor.md. */
self.addEventListener('install', function() { self.skipWaiting(); });
self.addEventListener('activate', function(e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', function(e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = {cuerpo: e.data ? e.data.text() : ''}; }
  var opciones = {
    body: d.cuerpo || '',
    icon: '/static/design/push-icono.png',
    badge: '/static/design/push-icono.png',
    data: {url: d.url || '/pagos'},
    tag: d.etiqueta || undefined,
    renotify: !!d.etiqueta,
    requireInteraction: !!d.fijo
  };
  e.waitUntil(self.registration.showNotification(d.titulo || 'Pagos Nuvia', opciones));
});

self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  var url = new URL((e.notification.data && e.notification.data.url) || '/pagos', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(function(lista) {
    var dePagos = function(c) { try { return new URL(c.url).pathname.indexOf('/pagos') === 0; } catch (err) { return false; } };
    var propias = lista.filter(function(c) { return c.url.indexOf(self.location.origin) === 0; });
    propias.sort(function(a, b) { return dePagos(b) - dePagos(a); });
    var c = propias[0];
    if (!c || !dePagos(c)) return self.clients.openWindow(url);
    var enfocar = function(x) { return x && 'focus' in x ? x.focus() : null; };
    var porMensaje = function() { c.postMessage({tipo: 'nvAbrir', url: url}); return enfocar(c); };
    if (!('navigate' in c)) return porMensaje();
    return c.navigate(url).then(function(n) { return n ? enfocar(n) : porMensaje(); }, porMensaje)
      .catch(function() { return self.clients.openWindow(url); });
  }));
});
