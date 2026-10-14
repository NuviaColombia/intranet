/* Notificaciones push de Nuvia Design: campana 🔔 en la barra (todas las páginas de Design) para activarlas,
   probarlas o desactivarlas en este navegador. El service worker es /design/sw.js; el servidor guarda la
   suscripción (services_design_push) y envía los avisos. */
(function() {
  'use strict';
  var nav = document.querySelector('nav a[href="/design"]');
  if (!nav) return;
  var soportado = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  var esIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var instalada = window.matchMedia && matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  var reg = null, sub = null, ocupado = false;

  var css = document.createElement('style');
  css.textContent = '.ds-push{position:relative;display:inline-flex;align-items:center;margin-left:4px}' +
    '.ds-push-btn{background:none;border:0;cursor:pointer;font-size:17px;line-height:1;padding:4px 6px;border-radius:8px;color:inherit;opacity:.9}' +
    '.ds-push-btn:hover,.ds-push-btn:focus-visible{background:rgba(255,255,255,.12);opacity:1}' +
    '.ds-push-pop{position:absolute;top:calc(100% + 10px);left:50%;transform:translateX(-50%);z-index:10060;width:300px;background:#fff;color:#1f2937;' +
    'border-radius:14px;box-shadow:0 18px 40px -12px rgba(0,0,0,.45);padding:14px 16px;font-size:13.5px;line-height:1.45;text-align:left}' +
    '.ds-push-pop h4{margin:0 0 6px;font-size:15px;color:#111827}.ds-push-pop p{margin:0 0 10px;color:#4b5563}' +
    '.ds-push-pop .acc{display:flex;gap:8px;flex-wrap:wrap}.ds-push-pop button.b{border:0;border-radius:9px;padding:8px 12px;font:inherit;font-weight:700;cursor:pointer}' +
    '.ds-push-pop .b1{background:#1d4ed8;color:#fff}.ds-push-pop .b1:hover{background:#1e40af}.ds-push-pop .b2{background:#f1f5f9;color:#1f2937}.ds-push-pop .b2:hover{background:#e2e8f0}' +
    '.ds-push-pop .ok{color:#047857;font-weight:700}.ds-push-pop .mal{color:#b91c1c}.ds-push-pop .res{margin-top:8px;font-size:12.5px}';
  document.head.appendChild(css);

  var caja = document.createElement('span'); caja.className = 'ds-push';
  var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'ds-push-btn';
  var pop = document.createElement('div'); pop.className = 'ds-push-pop'; pop.hidden = true; pop.setAttribute('role', 'dialog');
  pop.style.display = 'none';
  caja.appendChild(btn); caja.appendChild(pop);
  var extras = document.getElementById('dsNavExtras');  // junto al modo oscuro, antes de la foto (base.html)
  if (extras) extras.insertBefore(caja, extras.firstChild); else nav.parentNode.insertBefore(caja, nav.nextSibling);

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
    var so = /Windows/.test(u) ? 'Windows' : /Android/.test(u) ? 'Android' : esIOS ? 'iPhone/iPad' : /Mac OS/.test(u) ? 'Mac' : '';
    return n + (so ? ' · ' + so : '');
  }

  function pintarBoton() {
    var activo = !!sub && Notification.permission === 'granted';
    btn.textContent = activo ? '🔔' : '🔕';
    btn.title = activo ? 'Notificaciones activas en este navegador' : 'Activar notificaciones';
    btn.setAttribute('aria-label', btn.title);
  }
  function abrir(html) { pop.innerHTML = html; pop.hidden = false; pop.style.display = ''; }
  function cerrar() { pop.hidden = true; pop.style.display = 'none'; }
  // Admins: botón para ver el aviso de "orden de Face → N2" tal como le llega al manager de N2
  var esAdmin = !!(document.getElementById('dsNavExtras') && document.getElementById('dsNavExtras').dataset.admin);
  function pintarPop(msg) {
    var res = msg ? '<div class="res ' + (msg.ok ? 'ok' : 'mal') + '"></div>' : '';
    var html;
    if (!soportado) {
      html = '<h4>Notificaciones</h4><p>' + (esIOS && !instalada
        ? 'En iPhone/iPad primero agrega la intranet a la pantalla de inicio: botón Compartir → <b>Agregar a inicio</b>. Ábrela desde ese ícono y activa aquí las notificaciones.'
        : 'Este navegador no permite notificaciones. Usa Chrome, Edge o Firefox.') + '</p>';
    } else if (Notification.permission === 'denied') {
      html = '<h4>Notificaciones bloqueadas</h4><p>Las bloqueaste para la intranet. Para activarlas, toca el candado 🔒 junto a la dirección, cambia <b>Notificaciones</b> a <b>Permitir</b> y recarga la página.</p>';
    } else if (sub && Notification.permission === 'granted') {
      html = '<h4><span class="ok">✓</span> Notificaciones activas</h4><p>Este navegador recibirá los avisos de Nuvia Design aunque la intranet esté cerrada.</p>' +
        '<div class="acc"><button type="button" class="b b1" data-a="prueba">Enviarme una prueba</button><button type="button" class="b b2" data-a="quitar">Desactivar</button></div>' +
        (esAdmin ? '<div class="acc"><button type="button" class="b b2" data-a="ejemplo">Ejemplo: orden de Face → N2</button></div>' : '') + res;
    } else {
      html = '<h4>🔔 Notificaciones de Design</h4><p>Recibe avisos en este computador o celular aunque la intranet esté cerrada. Puedes desactivarlas cuando quieras.</p>' +
        '<div class="acc"><button type="button" class="b b1" data-a="activar">Activar notificaciones</button></div>' + res;
    }
    abrir(html);
    if (msg) pop.querySelector('.res').textContent = msg.texto;
    pop.querySelectorAll('[data-a]').forEach(function(b) { b.onclick = function(e) { e.stopPropagation(); accion(b.dataset.a, b); }; });
  }

  function registrar() {
    return navigator.serviceWorker.register('/design/sw.js', {scope: '/design/'}).then(function(r) { reg = r; return navigator.serviceWorker.ready; });
  }
  function activar() {
    return Notification.requestPermission().then(function(p) {
      if (p !== 'granted') throw new Error(p === 'denied' ? 'Bloqueaste las notificaciones.' : 'No se dio el permiso.');
      return Promise.all([registrar(), api('/design/api/push/clave')]);
    }).then(function(r) {
      return reg.pushManager.getSubscription().then(function(s) {
        return s || reg.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: b64aBytes(r[1].publica)});
      });
    }).then(function(s) {
      sub = s;
      return api('/design/api/push/suscribir', {subscription: s.toJSON(), navegador: navegador()});
    });
  }
  function accion(a, b) {
    if (ocupado) return; ocupado = true; if (b) b.disabled = true;
    var p;
    if (a === 'activar') p = activar().then(function() { pintarBoton(); pintarPop({ok: true, texto: '¡Listo! Te enviamos una notificación de prueba.'}); return api('/design/api/push/prueba', {}); });
    else if (a === 'ejemplo') p = api('/design/api/push/ejemplo-face-n2', {}).then(function() { pintarPop({ok: true, texto: 'Enviado. Se queda en pantalla hasta que lo cierres con la X.'}); });
    else if (a === 'prueba') p = api('/design/api/push/prueba', {}).then(function(r) { pintarPop({ok: true, texto: 'Enviada a ' + r.enviados + ' navegador' + (r.enviados === 1 ? '' : 'es') + '. Debe aparecer en unos segundos.'}); });
    else p = (sub ? api('/design/api/push/desuscribir', {endpoint: sub.endpoint}).then(function() { return sub.unsubscribe(); }) : Promise.resolve())
      .then(function() { sub = null; pintarBoton(); pintarPop({ok: true, texto: 'Desactivadas en este navegador.'}); });
    p.catch(function(err) {
      var m = err && err.name === 'NotAllowedError' ? 'El navegador no permitió activarlas. Revisa que las notificaciones estén permitidas para la intranet (candado 🔒 junto a la dirección).'
        : err && err.name === 'AbortError' ? 'El servicio de notificaciones del navegador no respondió. Intenta de nuevo en un momento.'
        : (err && err.message) || 'No se pudo completar.';
      pintarBoton(); pintarPop({ok: false, texto: m});
    })
     .then(function() { ocupado = false; if (b) b.disabled = false; });
  }

  btn.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); if (!pop.hidden) { cerrar(); return; } pintarPop(); });
  document.addEventListener('click', function(e) { if (!caja.contains(e.target)) cerrar(); });
  document.addEventListener('keydown', function(e) { if (e.key === 'Escape') cerrar(); });

  pintarBoton();
  if (!soportado) return;
  // si ya las había activado: se recupera la suscripción y se confirma con el servidor (por si cambió)
  navigator.serviceWorker.getRegistration('/design/').then(function(r) {
    if (!r) return null;
    reg = r; return r.pushManager.getSubscription();
  }).then(function(s) {
    sub = s || null; pintarBoton();
    if (s && Notification.permission === 'granted') api('/design/api/push/suscribir', {subscription: s.toJSON(), navegador: navegador()}).catch(function() {});
  }).catch(function() {});
})();
