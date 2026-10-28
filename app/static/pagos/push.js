/* Notificaciones push de Accounts Payable (Pagos): tarjeta simple para activarlas en este navegador.
   Versión recortada de /static/design/push.js (misma lógica de suscripción, sin la campana flotante
   ni el popover -- aquí solo importa para quien aprueba, no para toda la intranet). El service worker
   es /pagos/sw.js; el servidor guarda la suscripción (services_design_push) y envía los avisos. */
(function() {
  'use strict';
  var caja = document.getElementById('apPushBox');
  if (!caja) return;
  var soportado = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', function(ev) {
    var d = ev.data || {};
    if (d.tipo === 'nvAbrir' && typeof d.url === 'string' && d.url.indexOf(location.origin + '/') === 0) location.href = d.url;
  });
  var reg = null, sub = null, ocupado = false;

  function b64aBytes(s) {
    var p = '='.repeat((4 - s.length % 4) % 4), b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) out[i] = b.charCodeAt(i); return out;
  }
  function api(url, cuerpo) {
    return fetch(url, {method: cuerpo ? 'POST' : 'GET', credentials: 'same-origin', headers: cuerpo ? {'Content-Type': 'application/json'} : {}, body: cuerpo ? JSON.stringify(cuerpo) : undefined})
      .then(function(r) { return r.json().catch(function() { return {}; }).then(function(d) { if (!r.ok) throw new Error(d.detail || ('Error ' + r.status)); return d; }); });
  }
  function navegador() {
    var u = navigator.userAgent, n = /Edg\//.test(u) ? 'Edge' : /Chrome\//.test(u) ? 'Chrome' : /Firefox\//.test(u) ? 'Firefox' : /Safari\//.test(u) ? 'Safari' : 'Navegador';
    var so = /Windows/.test(u) ? 'Windows' : /Android/.test(u) ? 'Android' : /Mac OS/.test(u) ? 'Mac' : '';
    return n + (so ? ' · ' + so : '');
  }

  function registrar() {
    return navigator.serviceWorker.register('/pagos/sw.js', {scope: '/pagos/'}).then(function(r) { reg = r; return navigator.serviceWorker.ready; });
  }
  function activar() {
    return Notification.requestPermission().then(function(p) {
      if (p !== 'granted') throw new Error(p === 'denied' ? 'Bloqueaste las notificaciones.' : 'No se dio el permiso.');
      return Promise.all([registrar(), api('/pagos/api/push/clave')]);
    }).then(function(r) {
      return reg.pushManager.getSubscription().then(function(s) {
        return s || reg.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: b64aBytes(r[1].publica)});
      });
    }).then(function(s) {
      sub = s;
      return api('/pagos/api/push/suscribir', {subscription: s.toJSON(), navegador: navegador()});
    });
  }

  function pintar(msg) {
    var html;
    if (!soportado) {
      html = '<p class="pg-muted" style="margin:0">Este navegador no permite notificaciones. Usa Chrome, Edge o Firefox.</p>';
    } else if (Notification.permission === 'denied') {
      html = '<p class="pg-muted" style="margin:0">Bloqueaste las notificaciones para la intranet. Para activarlas, toca el candado 🔒 junto a la dirección, cambia Notificaciones a Permitir y recarga.</p>';
    } else if (sub && Notification.permission === 'granted') {
      html = '<span class="pg-ok" style="margin:0">🔔 Notificaciones activas en este navegador</span> <button type="button" class="btn gris mini" data-a="prueba">Enviar prueba</button>';
    } else {
      html = '<button type="button" class="btn mini" data-a="activar">🔔 Activar notificaciones de pagos pendientes</button>';
    }
    caja.innerHTML = html + (msg ? '<div class="pg-muted" style="margin-top:4px">' + msg + '</div>' : '');
    var b = caja.querySelector('[data-a]');
    if (b) b.onclick = function() { accion(b.dataset.a, b); };
  }

  function accion(a, b) {
    if (ocupado) return; ocupado = true; if (b) b.disabled = true;
    var p = a === 'activar'
      ? activar().then(function() { pintar('¡Listo! Te enviamos una notificación de prueba.'); return api('/pagos/api/push/prueba', {}); })
      : api('/pagos/api/push/prueba', {}).then(function(r) { pintar('Enviada a ' + r.enviados + ' navegador' + (r.enviados === 1 ? '' : 'es') + '.'); });
    p.catch(function(err) {
      var m = err && err.name === 'NotAllowedError' ? 'El navegador no permitió activarlas.' : (err && err.message) || 'No se pudo completar.';
      pintar(m);
    }).then(function() { ocupado = false; if (b) b.disabled = false; });
  }

  pintar();
  if (!soportado) return;
  navigator.serviceWorker.getRegistration('/pagos/').then(function(r) {
    if (!r) return null;
    reg = r; return r.pushManager.getSubscription();
  }).then(function(s) { sub = s || null; pintar(); }).catch(function() {});
})();
