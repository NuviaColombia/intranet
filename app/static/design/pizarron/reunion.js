/* Pizarrón › Reunión en vivo (Rosember, 19-oct-2026): cámara y micrófono entre 2 y 6 personas, directo entre PCs.
   Se agrega a «Más herramientas» del pizarrón sin tocar su archivo (lo inyecta routers/design_pizarron.py).
   Servidor: routers/design_reunion.py (solo crea la sala, dice quién está y pasa los mensajes de conexión).
   Cada persona se conecta con cada una de las demás (malla): por eso el máximo es 6.
   Enlace de invitación: /design/pizarron?reunion=CODIGO */
(function () {
  'use strict';
  var API = '/design/api/reunion/';
  // Servidores públicos para que dos PCs se encuentren a través de sus routers. En redes de empresa muy cerradas puede
  // hacer falta además un servidor TURN (se agrega aquí cuando se contrate).
  var ICE = [{urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302']}, {urls: 'stun:stun.cloudflare.com:3478'}];
  var R = null;   // reunión actual: {codigo, peer, nombre, es, pcs: {peerId: {pc, nombre, tile, pend}}, local}
  var panel = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; }); }
  function post(url, body) {
    return fetch(url, {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body || {})})
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.detail || ('Error ' + r.status)); return d; }); });
  }
  function aviso(txt) {
    var t = document.createElement('div'); t.className = 'rv-aviso'; t.textContent = txt; document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 4000);
  }

  // ---------- Estilos ----------
  var css = document.createElement('style');
  css.textContent = [
    '#rvPanel{position:fixed;right:16px;bottom:72px;z-index:2147482000;width:min(560px,calc(100vw - 32px));background:rgba(35,38,45,.96);color:#f2f2ef;',
    ' border:1px solid #3a3f4a;border-radius:14px;box-shadow:0 14px 40px rgba(0,0,0,.35);font:13px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow:hidden}',
    '#rvPanel .rv-cab{display:flex;align-items:center;gap:8px;padding:8px 10px;background:#2e323b;cursor:move;user-select:none}',
    '#rvPanel .rv-cab b{flex:1}#rvPanel .rv-codigo{font:700 13px ui-monospace,Consolas,monospace;letter-spacing:.06em;background:#23262d;border-radius:6px;padding:2px 8px}',
    '#rvPanel button{font:inherit;color:inherit;background:#3a3f4a;border:0;border-radius:8px;padding:6px 10px;cursor:pointer}',
    '#rvPanel button:hover,#rvPanel button:focus-visible{background:#4a505d;outline:none}#rvPanel button.rv-off{background:#7f1d1d}',
    '#rvPanel button.rv-prim{background:#f97316;color:#fff}#rvPanel button.rv-salir{background:#b91c1c;color:#fff}',
    '#rvPanel .rv-cuerpo{padding:10px}#rvPanel .rv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px}',
    '#rvPanel .rv-tile{position:relative;background:#111318;border-radius:10px;overflow:hidden;aspect-ratio:4/3}',
    '#rvPanel .rv-tile video{width:100%;height:100%;object-fit:cover;display:block;background:#111318}',
    '#rvPanel .rv-tile.yo video{transform:scaleX(-1)}',
    '#rvPanel .rv-nombre{position:absolute;left:6px;bottom:6px;background:rgba(0,0,0,.55);border-radius:6px;padding:2px 7px;font-size:12px}',
    '#rvPanel .rv-sincam{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:30px;color:#9aa0ac}',
    '#rvPanel .rv-estado{position:absolute;right:6px;top:6px;background:rgba(0,0,0,.55);border-radius:6px;padding:1px 6px;font-size:11px}',
    '#rvPanel .rv-barra{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;align-items:center}#rvPanel .rv-esp{flex:1}',
    '#rvPanel input{font:inherit;width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid #3a3f4a;background:#23262d;color:#f2f2ef;text-transform:uppercase;letter-spacing:.08em}',
    '#rvPanel .rv-fila{display:flex;gap:8px;margin-top:8px}#rvPanel .rv-sub{color:#9aa0ac;font-size:12px;margin:6px 0 0}',
    '#rvPanel .rv-err{color:#fca5a5;font-size:12px;margin-top:6px;min-height:16px}',
    '#rvPanel.rv-min .rv-cuerpo{display:none}',
    '.rv-aviso{position:fixed;left:50%;top:84px;transform:translateX(-50%);z-index:2147483001;background:#23262d;color:#f2f2ef;border-radius:10px;',
    ' padding:9px 14px;font:13px system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.3)}'
  ].join('\n');
  document.head.appendChild(css);

  // ---------- Panel ----------
  function abrirPanel() {
    if (panel) { panel.classList.remove('rv-min'); return; }
    panel = document.createElement('div');
    panel.id = 'rvPanel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Reunión en vivo');
    document.body.appendChild(panel);
    arrastrable(panel);
    pintar();
  }
  function cerrarPanel() { if (panel) { panel.remove(); panel = null; } }
  function arrastrable(el) {
    var x0, y0, l0, t0;
    el.addEventListener('pointerdown', function (e) {
      if (!e.target.closest('.rv-cab') || e.target.closest('button')) return;
      var r = el.getBoundingClientRect(); x0 = e.clientX; y0 = e.clientY; l0 = r.left; t0 = r.top;
      el.style.left = l0 + 'px'; el.style.top = t0 + 'px'; el.style.right = 'auto'; el.style.bottom = 'auto';
      function mover(ev) { el.style.left = Math.max(0, Math.min(innerWidth - 80, l0 + ev.clientX - x0)) + 'px'; el.style.top = Math.max(0, Math.min(innerHeight - 40, t0 + ev.clientY - y0)) + 'px'; }
      function soltar() { removeEventListener('pointermove', mover); removeEventListener('pointerup', soltar); }
      addEventListener('pointermove', mover); addEventListener('pointerup', soltar);
    });
  }

  function pintar() {
    if (!panel) return;
    if (!R) {
      var pre = new URLSearchParams(location.search).get('reunion') || '';
      panel.innerHTML =
        '<div class="rv-cab"><span>📹</span><b>Reunión en vivo</b><button type="button" data-rv="cerrar" aria-label="Cerrar">✕</button></div>' +
        '<div class="rv-cuerpo">' +
        '<button type="button" class="rv-prim" data-rv="crear">＋ Crear reunión</button>' +
        '<p class="rv-sub">Te da un código para invitar (de 2 a 6 personas). El video va directo entre los computadores.</p>' +
        '<div class="rv-fila"><input id="rvCodigo" placeholder="Código, ej. K7M-4QPX" maxlength="8" value="' + esc(pre) + '" aria-label="Código de la reunión"><button type="button" data-rv="unirse">Unirme</button></div>' +
        '<div class="rv-err" id="rvErr"></div></div>';
      var inp = panel.querySelector('#rvCodigo');
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') entrar(inp.value); });
      return;
    }
    var micOn = pista('audio'), camOn = pista('video');
    panel.innerHTML =
      '<div class="rv-cab"><span>📹</span><b>Reunión en vivo</b><span class="rv-codigo" title="Código de la reunión">' + esc(R.codigo) + '</span>' +
      '<button type="button" data-rv="min" aria-label="Minimizar" title="Minimizar">—</button></div>' +
      '<div class="rv-cuerpo"><div class="rv-grid" id="rvGrid"></div>' +
      '<div class="rv-barra">' +
      '<button type="button" data-rv="mic" class="' + (micOn ? '' : 'rv-off') + '" title="Micrófono">' + (micOn ? '🎤 Micrófono' : '🔇 Micrófono') + '</button>' +
      '<button type="button" data-rv="cam" class="' + (camOn ? '' : 'rv-off') + '" title="Cámara">' + (camOn ? '📷 Cámara' : '🚫 Cámara') + '</button>' +
      '<button type="button" data-rv="invitar" title="Copiar enlace de invitación">🔗 Invitar</button>' +
      '<span class="rv-esp"></span><button type="button" class="rv-salir" data-rv="salir">Salir</button></div>' +
      '<p class="rv-sub" id="rvInfo"></p></div>';
    var grid = panel.querySelector('#rvGrid');
    grid.appendChild(tile('yo', R.nombre + ' (tú)', R.local, true));
    Object.keys(R.pcs).forEach(function (k) { var x = R.pcs[k]; grid.appendChild(x.tile); });
    info();
  }
  function info() {
    var el = panel && panel.querySelector('#rvInfo');
    if (!el || !R) return;
    var n = Object.keys(R.pcs).length + 1;
    el.textContent = n === 1 ? 'Esperando a que alguien entre con el código ' + R.codigo + '…' : n + ' personas en la reunión (máximo ' + R.max + ').';
  }
  function pista(tipo) {
    var t = R && R.local && R.local.getTracks().filter(function (x) { return x.kind === tipo; })[0];
    return !!(t && t.enabled);
  }
  function tile(id, nombre, stream, yo) {
    var d = document.createElement('div');
    d.className = 'rv-tile' + (yo ? ' yo' : '');
    d.dataset.peer = id;
    var v = document.createElement('video'); v.autoplay = true; v.playsInline = true; if (yo) v.muted = true;
    if (stream) v.srcObject = stream;
    var sin = document.createElement('div'); sin.className = 'rv-sincam'; sin.textContent = '👤';
    var nm = document.createElement('span'); nm.className = 'rv-nombre'; nm.textContent = nombre;
    var es = document.createElement('span'); es.className = 'rv-estado'; es.textContent = yo ? '' : 'conectando…'; if (yo) es.hidden = true;
    d.append(v, sin, nm, es);
    var revisar = function () { sin.hidden = !!(v.srcObject && v.srcObject.getVideoTracks().some(function (t) { return t.enabled && t.readyState === 'live'; })); };
    revisar(); v.addEventListener('loadedmetadata', revisar); setInterval(revisar, 1500);
    return d;
  }

  // ---------- Medios ----------
  function medios() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.resolve(new MediaStream());
    return navigator.mediaDevices.getUserMedia({video: {width: {ideal: 640}, height: {ideal: 480}}, audio: {echoCancellation: true, noiseSuppression: true}})
      .catch(function () { return navigator.mediaDevices.getUserMedia({audio: true}).then(function (s) { aviso('No se pudo usar la cámara: entras solo con micrófono.'); return s; }); })
      .catch(function () { aviso('Sin cámara ni micrófono: entras solo a ver y escuchar.'); return new MediaStream(); });
  }

  // ---------- Entrar / crear / salir ----------
  function error(txt) { var e = panel && panel.querySelector('#rvErr'); if (e) e.textContent = txt; else aviso(txt); }
  function crear() {
    post(API + 'crear').then(function (d) { entrar(d.codigo); }).catch(function (e) { error(e.message); });
  }
  function entrar(codigo) {
    codigo = (codigo || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{3}-?[A-Z0-9]{4}$/.test(codigo)) { error('Escribe el código completo, ej. K7M-4QPX.'); return; }
    if (codigo.indexOf('-') < 0) codigo = codigo.slice(0, 3) + '-' + codigo.slice(3);
    if (R) return;
    medios().then(function (local) {
      return post(API + encodeURIComponent(codigo) + '/entrar').then(function (d) {
        R = {codigo: d.codigo, peer: d.peer, nombre: d.nombre, max: d.max, pcs: {}, local: local};
        pintar();
        conectarEventos();
        d.otros.forEach(function (o) { nuevaConexion(o.peer, o.nombre, true); });   // yo llamo a los que ya estaban
      }).catch(function (e) { local.getTracks().forEach(function (t) { t.stop(); }); throw e; });
    }).catch(function (e) { error(e.message); });
  }
  function salir(silencioso) {
    if (!R) return;
    var r = R; R = null;
    try { r.es && r.es.close(); } catch (e) {}
    Object.keys(r.pcs).forEach(function (k) { try { r.pcs[k].pc.close(); } catch (e) {} });
    r.local.getTracks().forEach(function (t) { t.stop(); });
    var cuerpo = JSON.stringify({peer: r.peer});
    if (silencioso && navigator.sendBeacon) navigator.sendBeacon(API + encodeURIComponent(r.codigo) + '/salir', new Blob([cuerpo], {type: 'application/json'}));
    else post(API + encodeURIComponent(r.codigo) + '/salir', {peer: r.peer}).catch(function () {});
    if (!silencioso) { cerrarPanel(); aviso('Saliste de la reunión.'); }
  }
  addEventListener('pagehide', function () { salir(true); });

  function conectarEventos() {
    var es = new EventSource(API + encodeURIComponent(R.codigo) + '/eventos?peer=' + encodeURIComponent(R.peer));
    R.es = es;
    es.onmessage = function (e) {
      var m; try { m = JSON.parse(e.data); } catch (x) { return; }
      if (!R) return;
      if (m.t === 'llego') { nuevaConexion(m.peer, m.nombre, false); aviso('👋 ' + m.nombre + ' entró a la reunión'); }
      else if (m.t === 'salio') quitar(m.peer, true);
      else if (m.t === 'senal') senal(m.de, m.datos);
    };
    es.onerror = function () {
      if (es.readyState === 2 && R) { aviso('Se perdió la conexión con la reunión.'); salir(false); }
    };
  }

  // ---------- Conexión con cada persona (WebRTC) ----------
  function enviar(para, datos) {
    if (!R) return;
    post(API + encodeURIComponent(R.codigo) + '/senal', {peer: R.peer, para: para, datos: datos}).catch(function () {});
  }
  function nuevaConexion(id, nombre, llamo) {
    if (!R || R.pcs[id]) return R && R.pcs[id];
    var pc = new RTCPeerConnection({iceServers: ICE});
    var remoto = new MediaStream();
    var x = {pc: pc, nombre: nombre, tile: tile(id, nombre, remoto, false), pend: []};
    R.pcs[id] = x;
    R.local.getTracks().forEach(function (t) { pc.addTrack(t, R.local); });
    if (!R.local.getAudioTracks().length) pc.addTransceiver('audio', {direction: 'recvonly'});
    if (!R.local.getVideoTracks().length) pc.addTransceiver('video', {direction: 'recvonly'});
    pc.ontrack = function (ev) {
      if (remoto.getTracks().indexOf(ev.track) < 0) remoto.addTrack(ev.track);
      var v = x.tile.querySelector('video'); v.srcObject = remoto; v.play().catch(function () {});
    };
    pc.onicecandidate = function (ev) { if (ev.candidate) enviar(id, {candidato: ev.candidate.toJSON()}); };
    pc.onconnectionstatechange = function () {
      var es = x.tile.querySelector('.rv-estado'), st = pc.connectionState;
      es.hidden = st === 'connected';
      es.textContent = st === 'failed' ? 'sin conexión' : st === 'disconnected' ? 'reconectando…' : 'conectando…';
      x.tile.dataset.estado = st;
    };
    var grid = panel && panel.querySelector('#rvGrid');
    if (grid) grid.appendChild(x.tile);
    info();
    if (llamo) {
      pc.createOffer().then(function (o) { return pc.setLocalDescription(o); })
        .then(function () { enviar(id, {sdp: pc.localDescription.toJSON()}); });
    }
    return x;
  }
  function senal(de, d) {
    var x = R.pcs[de] || nuevaConexion(de, 'Participante', false);
    var pc = x.pc;
    if (d.sdp) {
      pc.setRemoteDescription(d.sdp).then(function () {
        x.pend.splice(0).forEach(function (c) { pc.addIceCandidate(c).catch(function () {}); });
        if (d.sdp.type === 'offer') {
          return pc.createAnswer().then(function (a) { return pc.setLocalDescription(a); })
            .then(function () { enviar(de, {sdp: pc.localDescription.toJSON()}); });
        }
      }).catch(function (e) { console.warn('reunión: no se pudo conectar con', x.nombre, e); });
    } else if (d.candidato) {
      if (pc.remoteDescription) pc.addIceCandidate(d.candidato).catch(function () {});
      else x.pend.push(d.candidato);
    }
  }
  function quitar(id, avisar) {
    var x = R && R.pcs[id];
    if (!x) return;
    try { x.pc.close(); } catch (e) {}
    x.tile.remove();
    delete R.pcs[id];
    info();
    if (avisar) aviso(x.nombre + ' salió de la reunión');
  }

  // ---------- Botones ----------
  document.addEventListener('click', function (e) {
    var b = e.target.closest('#rvPanel [data-rv]');
    if (!b) return;
    var a = b.dataset.rv;
    if (a === 'cerrar') cerrarPanel();
    else if (a === 'crear') crear();
    else if (a === 'unirse') entrar(panel.querySelector('#rvCodigo').value);
    else if (a === 'min') panel.classList.toggle('rv-min');
    else if (a === 'salir') salir(false);
    else if (a === 'mic' || a === 'cam') {
      var tipo = a === 'mic' ? 'audio' : 'video';
      var t = R && R.local.getTracks().filter(function (x) { return x.kind === tipo; })[0];
      if (!t) { aviso(tipo === 'audio' ? 'No hay micrófono disponible.' : 'No hay cámara disponible.'); return; }
      t.enabled = !t.enabled;
      pintar();
    } else if (a === 'invitar') {
      var url = location.origin + '/design/pizarron?reunion=' + encodeURIComponent(R.codigo);
      var listo = function () { aviso('Enlace copiado: ' + url); };
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(url).then(listo, function () { prompt('Copia el enlace:', url); });
      else prompt('Copia el enlace:', url);
    }
  });

  // ---------- «Más herramientas» del pizarrón ----------
  function agregarAlMenu() {
    var list = document.getElementById('moreList');
    if (!list || document.getElementById('rvMenu')) return !!list;
    var row = document.createElement('div');
    row.className = 'more-item'; row.id = 'rvMenu';
    var btn = document.createElement('button'); btn.className = 'tbtn'; btn.textContent = '📹'; btn.title = 'Reunión en vivo: cámara y micrófono';
    var sp = document.createElement('span'); sp.textContent = 'Reunión en vivo (cámara)';
    row.append(btn, sp);
    row.onclick = function () { if (typeof window.closePops === 'function') window.closePops(); abrirPanel(); };
    list.insertBefore(row, list.firstChild);
    return true;
  }
  function iniciar() {
    if (!agregarAlMenu()) { setTimeout(iniciar, 300); return; }
    if (new URLSearchParams(location.search).get('reunion')) abrirPanel();   // llegó por un enlace de invitación
  }
  window.DSReunion = {abrir: abrirPanel, entrar: entrar, salir: salir, estado: function () { return R ? {codigo: R.codigo, personas: Object.keys(R.pcs).length + 1} : null; }};
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
