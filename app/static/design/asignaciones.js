/* Número de casos asignados sin iniciar junto a "Design Schedule" en la barra (todas las páginas de Design).
   Cuenta los casos de la persona en "Ready to design" o "Hold" (ver mis_asignaciones en services_design.py).
   No se muestra mientras la persona está viendo el Schedule; si llega un caso nuevo, avisa con un mensaje. */
(function() {
  'use strict';
  var enlace = document.querySelector('nav a[href="/design"]');
  if (!enlace) return;
  var CADA = 45000, datos = null, ultimo = null, pidiendo = false;
  var CLAVE = 'dsAsigVistos';   // casos que ya se avisaron (por pestaña), para no repetir el aviso

  var css = document.createElement('style');
  css.textContent = '.ds-asig-badge{margin-left:2px;vertical-align:1px}.ds-asig-badge.pulso{animation:dsAsigPulso 1.2s ease-out 2}' +
    '@keyframes dsAsigPulso{0%{box-shadow:0 0 0 0 rgba(220,38,38,.7)}100%{box-shadow:0 0 0 10px rgba(220,38,38,0)}}' +
    '.ds-asig-aviso{position:fixed;right:18px;bottom:18px;z-index:10050;display:flex;align-items:center;gap:10px;max-width:min(460px,calc(100vw - 36px));' +
    'padding:12px 14px;border-radius:14px;background:#1b2140;color:#fff;font-size:14px;box-shadow:0 14px 34px -10px rgba(0,0,0,.55);animation:dsAsigEntra .25s ease-out;transition:opacity .5s,transform .5s}' +
    '.ds-asig-aviso.sale{opacity:0;transform:translateY(8px)}@keyframes dsAsigEntra{from{opacity:0;transform:translateY(10px)}}' +
    '.ds-asig-ico{font-size:20px}.ds-asig-txt{flex:1}.ds-asig-ir{color:#fff;background:#2f98d5;padding:6px 10px;border-radius:9px;text-decoration:none;font-weight:700;white-space:nowrap}' +
    '.ds-asig-ir:hover{background:#1d6fb0}.ds-asig-x{background:none;border:0;color:#cbd5e1;font-size:20px;cursor:pointer;padding:0 2px;line-height:1}';
  document.head.appendChild(css);

  var badge = document.createElement('span');
  badge.className = 'badge-alertas ds-asig-badge';
  badge.hidden = true;
  enlace.appendChild(document.createTextNode(' '));
  enlace.appendChild(badge);

  // ¿Está viendo el Schedule? (página /design sin ningún panel encima: Comments, Pre-Approved, Canvas…)
  function viendoSchedule() {
    return location.pathname.replace(/\/+$/, '') === '/design' && !document.querySelector('.ds-overlay.open');
  }

  function pintar() {
    var n = datos ? datos.total : 0;
    badge.hidden = !n || viendoSchedule();
    if (badge.hidden) return;
    badge.textContent = n > 99 ? '99+' : String(n);
    var partes = [];
    if (datos.ready) partes.push(datos.ready + ' en Ready to design');
    if (datos.hold) partes.push(datos.hold + ' en Hold');
    enlace.title = 'Tienes ' + n + (n === 1 ? ' caso asignado' : ' casos asignados') + ' sin iniciar (' + partes.join(', ') + ')';
    enlace.setAttribute('aria-label', 'Design Schedule. ' + enlace.title);
  }

  function vistos() { try { return JSON.parse(sessionStorage.getItem(CLAVE) || '[]'); } catch (e) { return []; } }
  function guardarVistos(ids) { try { sessionStorage.setItem(CLAVE, JSON.stringify(ids)); } catch (e) {} }

  function avisar(nuevos) {
    if (!nuevos.length || viendoSchedule()) return;
    var t = document.getElementById('dsAsigAviso');
    if (t) t.remove();
    t = document.createElement('div');
    t.id = 'dsAsigAviso'; t.className = 'ds-asig-aviso'; t.setAttribute('role', 'status');
    var primero = nuevos[0];
    var txt = nuevos.length === 1
      ? 'Tienes un caso asignado en ' + primero.estado + ': ' + (primero.orden || 'sin número') + (primero.paciente ? ' · ' + primero.paciente : '')
      : 'Tienes ' + nuevos.length + ' casos nuevos asignados sin iniciar';
    t.innerHTML = '<span class="ds-asig-ico">📋</span><span class="ds-asig-txt"></span><a class="ds-asig-ir" href="/design">Ir al Schedule</a><button type="button" class="ds-asig-x" aria-label="Cerrar">×</button>';
    t.querySelector('.ds-asig-txt').textContent = txt;
    t.querySelector('.ds-asig-x').onclick = function() { t.remove(); };
    document.body.appendChild(t);
    setTimeout(function() { if (t.isConnected) t.classList.add('sale'); }, 12000);
    setTimeout(function() { if (t.isConnected) t.remove(); }, 12600);
    badge.classList.remove('pulso'); void badge.offsetWidth; badge.classList.add('pulso');
  }

  function cargar() {
    if (pidiendo || document.hidden) return;
    pidiendo = true;
    fetch('/design/api/mis-asignaciones', {credentials: 'same-origin'})
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(d) {
        if (!d) return;
        datos = d;
        var ids = d.ordenes.map(function(o) { return o.id; });
        var antes = vistos();
        // avisa de los casos que esta pestaña todavía no había avisado (al abrirla, los pendientes; después, los nuevos)
        avisar(d.ordenes.filter(function(o) { return antes.indexOf(o.id) < 0; }));
        guardarVistos(ids);
        ultimo = d.total;
        pintar();
      })
      .catch(function() {})
      .then(function() { pidiendo = false; });
  }

  cargar();
  setInterval(cargar, CADA);
  setInterval(pintar, 1500);   // abre o cierra paneles del Schedule sin recargar la página
  document.addEventListener('visibilitychange', function() { if (!document.hidden) cargar(); });
  // si cierra un panel del Schedule o cambia de estado un caso, se vuelve a contar enseguida
  document.addEventListener('ds:asignaciones', cargar);
})();
