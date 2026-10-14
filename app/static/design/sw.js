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

self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || '/design/inicio';
  e.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(function(lista) {
    for (var i = 0; i < lista.length; i++) {   // si la intranet ya está abierta, la usa
      var c = lista[i];
      if (c.url.indexOf(self.location.origin) === 0 && 'focus' in c) { c.navigate(url); return c.focus(); }
    }
    return self.clients.openWindow(url);
  }));
});
