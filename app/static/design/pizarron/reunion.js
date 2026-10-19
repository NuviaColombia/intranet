/* Pizarrón › Reunión en vivo (Rosember, 19-oct-2026): cámara y micrófono entre 2 y 6 personas, directo entre PCs.
   Se agrega a «Más herramientas» del pizarrón sin tocar su archivo (lo inyecta routers/design_pizarron.py).
   Servidor: routers/design_reunion.py (crea la sala, dice quién está, pasa los mensajes de conexión, los estados de
   micrófono / cámara / mano y las acciones de quien organiza). Cada persona se conecta con cada una de las demás.

   Cómo se ve (pedido por Rosember): escenario grande con quien tiene la palabra (cambia solo cuando otra persona habla;
   se puede fijar a alguien con 📌) y un carrusel con las demás cámaras. Mano levantada, iconos de micrófono y cámara.
   Quien organiza (👑) puede silenciar a una persona o a todas, bajarle la mano o sacarla; como en Google Meet, activar
   el micrófono de nuevo solo lo hace cada persona. Enlace de invitación: /design/pizarron?reunion=CODIGO */
(function () {
  'use strict';
  var API = '/design/api/reunion/';
  // Servidores públicos para que dos PCs se encuentren a través de sus routers. En redes de empresa muy cerradas puede
  // hacer falta además un servidor TURN (se agrega aquí cuando se contrate).
  var ICE = [{urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302']}, {urls: 'stun:stun.cloudflare.com:3478'}];
  var UMBRAL_VOZ = 0.03;     // volumen (0-1) a partir del cual alguien está hablando
  var MIN_HABLA_MS = 500;    // tiene que hablar al menos medio segundo para pasar al escenario (no salta con cada ruido)
  var R = null;              // reunión actual
  var panel = null, modo = 'normal', fijado = null, foco = null;
  var audioCtx = null, medidor = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; }); }
  function post(url, body) {
    return fetch(url, {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body || {})})
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.detail || ('Error ' + r.status)); return d; }); });
  }
  function aviso(txt) {
    var t = document.createElement('div'); t.className = 'rv-aviso'; t.textContent = txt; document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 4000);
  }
  function api(ruta, cuerpo) { return post(API + encodeURIComponent(R.codigo) + ruta, Object.assign({peer: R.peer}, cuerpo || {})); }

  // ---------- Estilos ----------
  var css = document.createElement('style');
  css.textContent = [
    '#rvPanel{position:fixed;right:16px;bottom:72px;z-index:2147482000;width:min(620px,calc(100vw - 32px));background:rgba(28,31,38,.97);color:#f2f2ef;',
    ' border:1px solid #3a3f4a;border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.4);font:13px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow:hidden;display:flex;flex-direction:column}',
    '#rvPanel.rv-grande{left:24px!important;top:84px!important;right:24px;bottom:72px;width:auto}',
    '#rvPanel .rv-cab{display:flex;align-items:center;gap:8px;padding:8px 10px;background:#2a2e37;cursor:move;user-select:none}',
    '#rvPanel .rv-cab b{flex:1}#rvPanel .rv-codigo{font:700 13px ui-monospace,Consolas,monospace;letter-spacing:.06em;background:#1c1f26;border-radius:6px;padding:2px 8px}',
    '#rvPanel .rv-manos{background:#f59e0b;color:#1c1f26;border-radius:999px;padding:1px 8px;font-weight:700}',
    '#rvPanel button{font:inherit;color:inherit;background:#3a3f4a;border:0;border-radius:10px;padding:7px 11px;cursor:pointer;white-space:nowrap}',
    '#rvPanel button:hover,#rvPanel button:focus-visible{background:#4a505d;outline:none}#rvPanel button.rv-off{background:#991b1b}',
    '#rvPanel button.rv-on{background:#f59e0b;color:#1c1f26}#rvPanel button.rv-prim{background:#f97316;color:#fff}#rvPanel button.rv-salir{background:#b91c1c;color:#fff}',
    '#rvPanel .rv-cuerpo{padding:10px;display:flex;flex-direction:column;gap:8px;min-height:0;flex:1}',
    '#rvPanel .rv-escenario{position:relative;flex:1;min-height:0;display:flex}',
    '#rvPanel:not(.rv-grande) .rv-escenario{aspect-ratio:16/9;flex:none}',
    '#rvPanel .rv-escenario .rv-tile{flex:1;aspect-ratio:auto}',
    '#rvPanel .rv-tira{display:flex;gap:8px;overflow-x:auto;scroll-behavior:smooth;padding-bottom:2px;scrollbar-width:thin}',
    '#rvPanel .rv-tira:empty{display:none}#rvPanel .rv-tira .rv-tile{flex:0 0 132px;aspect-ratio:4/3}',
    '#rvPanel.rv-grande .rv-tira .rv-tile{flex-basis:180px}',
    '#rvPanel .rv-tile{position:relative;background:#111318;border-radius:12px;overflow:hidden;cursor:pointer;outline:3px solid transparent;outline-offset:-3px;transition:outline-color .2s}',
    '#rvPanel .rv-tile.habla{outline-color:#22c55e}#rvPanel .rv-tile video{width:100%;height:100%;object-fit:cover;display:block;background:#111318}',
    '#rvPanel .rv-escenario .rv-tile video{object-fit:contain}#rvPanel .rv-tile.yo video{transform:scaleX(-1)}',
    '#rvPanel .rv-nombre{position:absolute;left:6px;bottom:6px;display:flex;gap:4px;align-items:center;background:rgba(0,0,0,.6);border-radius:6px;padding:2px 7px;font-size:12px;max-width:calc(100% - 12px)}',
    '#rvPanel .rv-nombre span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '#rvPanel .rv-sincam{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#1c1f26}',
    '#rvPanel .rv-inicial{width:56px;height:56px;border-radius:50%;background:#3b82f6;display:flex;align-items:center;justify-content:center;font:700 22px system-ui;color:#fff}',
    '#rvPanel .rv-escenario .rv-inicial{width:96px;height:96px;font-size:38px}',
    '#rvPanel .rv-badges{position:absolute;right:6px;top:6px;display:flex;gap:4px}#rvPanel .rv-badges span{background:rgba(0,0,0,.6);border-radius:6px;padding:1px 6px;font-size:12px}',
    '#rvPanel .rv-badges .rv-mano{background:#f59e0b;color:#1c1f26;font-weight:700;animation:rvMano 1s ease-in-out 3}',
    '@keyframes rvMano{50%{transform:rotate(-14deg) scale(1.12)}}',
    '#rvPanel .rv-acc{position:absolute;left:6px;top:6px;display:none;gap:4px}#rvPanel .rv-tile:hover .rv-acc,#rvPanel .rv-tile:focus-within .rv-acc{display:flex}',
    '#rvPanel .rv-acc button{padding:2px 7px;font-size:12px;background:rgba(0,0,0,.65)}#rvPanel .rv-acc button:hover{background:#4a505d}',
    '#rvPanel .rv-barra{display:flex;gap:6px;flex-wrap:wrap;align-items:center}#rvPanel .rv-esp{flex:1}',
    '#rvPanel input{font:inherit;width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid #3a3f4a;background:#1c1f26;color:#f2f2ef;text-transform:uppercase;letter-spacing:.08em}',
    '#rvPanel .rv-fila{display:flex;gap:8px}#rvPanel .rv-sub{color:#9aa0ac;font-size:12px;margin:0}',
    '#rvPanel .rv-err{color:#fca5a5;font-size:12px;min-height:16px}#rvPanel.rv-min .rv-cuerpo{display:none}',
    '.rv-aviso{position:fixed;left:50%;top:84px;transform:translateX(-50%);z-index:2147483001;background:#1c1f26;color:#f2f2ef;border-radius:10px;',
    ' padding:9px 14px;font:13px system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.3)}',
    '@media (prefers-reduced-motion: reduce){#rvPanel .rv-badges .rv-mano{animation:none}}'
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
    el.addEventListener('pointerdown', function (e) {
      if (!e.target.closest('.rv-cab') || e.target.closest('button') || modo === 'grande') return;
      var r = el.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY, l0 = r.left, t0 = r.top;
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
      panel.className = '';
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
    panel.classList.toggle('rv-grande', modo === 'grande');
    panel.innerHTML =
      '<div class="rv-cab"><span>📹</span><b>Reunión en vivo</b><span class="rv-manos" id="rvManos" hidden></span>' +
      '<span class="rv-codigo" title="Código de la reunión">' + esc(R.codigo) + '</span>' +
      '<button type="button" data-rv="grande" title="' + (modo === 'grande' ? 'Ventana pequeña' : 'Ver en grande') + '">' + (modo === 'grande' ? '⤡' : '⤢') + '</button>' +
      '<button type="button" data-rv="min" aria-label="Minimizar" title="Minimizar">—</button></div>' +
      '<div class="rv-cuerpo"><div class="rv-escenario" id="rvEscenario"></div><div class="rv-tira" id="rvTira" aria-label="Cámaras"></div>' +
      '<div class="rv-barra" id="rvBarra"></div><p class="rv-sub" id="rvInfo"></p></div>';
    acomodar();
    barra();
  }
  // Botones de abajo (se repintan al cambiar el micrófono, la cámara o la mano)
  function barra() {
    var el = panel && panel.querySelector('#rvBarra');
    if (!el || !R) return;
    var mic = R.estado.mic, cam = R.estado.cam, mano = !!R.estado.mano;
    el.innerHTML =
      '<button type="button" data-rv="mic" class="' + (mic ? '' : 'rv-off') + '" title="Micrófono">' + (mic ? '🎤' : '🔇') + ' Micrófono</button>' +
      '<button type="button" data-rv="cam" class="' + (cam ? '' : 'rv-off') + '" title="Cámara">' + (cam ? '📷' : '🚫') + ' Cámara</button>' +
      '<button type="button" data-rv="mano" class="' + (mano ? 'rv-on' : '') + '" title="' + (mano ? 'Bajar la mano' : 'Levantar la mano') + '">✋ ' + (mano ? 'Bajar mano' : 'Levantar mano') + '</button>' +
      '<button type="button" data-rv="invitar" title="Copiar enlace de invitación">🔗 Invitar</button>' +
      (R.anfitrion ? '<button type="button" data-rv="mutear_todos" title="Silenciar a todos (cada uno puede volver a activar su micrófono)">🔇 Silenciar a todos</button>' : '') +
      '<span class="rv-esp"></span><button type="button" class="rv-salir" data-rv="salir">Salir</button>';
    info();
  }
  function info() {
    var el = panel && panel.querySelector('#rvInfo');
    if (!el || !R) return;
    var n = Object.keys(R.pcs).length + 1;
    el.textContent = (n === 1 ? 'Esperando a que alguien entre con el código ' + R.codigo + '…' : n + ' personas en la reunión (máximo ' + R.max + ').') +
      (R.anfitrion ? ' 👑 Organizas esta reunión.' : '') + (fijado ? ' 📌 Escenario fijado.' : '');
    var manos = personas().filter(function (p) { return p.estado.mano; }).length;
    var m = panel.querySelector('#rvManos');
    if (m) { m.hidden = !manos; m.textContent = '✋ ' + manos; m.title = manos + ' mano(s) levantada(s)'; }
  }

  // ---------- Personas y recuadros ----------
  function personas() {   // yo primero, luego los demás
    if (!R) return [];
    return [R.yo].concat(Object.keys(R.pcs).map(function (k) { return R.pcs[k]; }));
  }
  function inicial(n) { return (String(n || '?').trim()[0] || '?').toUpperCase(); }
  function nuevoTile(p) {
    var d = document.createElement('div');
    d.className = 'rv-tile' + (p.yo ? ' yo' : '');
    d.dataset.peer = p.id;
    d.tabIndex = 0;
    var v = document.createElement('video'); v.autoplay = true; v.playsInline = true; if (p.yo) v.muted = true;
    if (p.stream) v.srcObject = p.stream;
    var sin = document.createElement('div'); sin.className = 'rv-sincam';
    var ini = document.createElement('div'); ini.className = 'rv-inicial'; ini.textContent = inicial(p.nombre); sin.appendChild(ini);
    var nm = document.createElement('div'); nm.className = 'rv-nombre';
    var badges = document.createElement('div'); badges.className = 'rv-badges';
    var acc = document.createElement('div'); acc.className = 'rv-acc';
    d.append(v, sin, nm, badges, acc);
    p.tile = d;
    actualizarTile(p);
    return d;
  }
  function actualizarTile(p) {
    var d = p.tile; if (!d) return;
    var e = p.estado || {};
    var hayVideo = !!(p.stream && p.stream.getVideoTracks().some(function (t) { return t.readyState === 'live' && (p.yo ? t.enabled : true); }));
    d.querySelector('.rv-sincam').hidden = e.cam !== false && hayVideo;
    d.querySelector('.rv-nombre').innerHTML = (p.anfitrion ? '<b title="Organiza la reunión">👑</b>' : '') +
      (e.mic === false ? '<b title="Micrófono apagado">🔇</b>' : '') + '<span>' + esc(p.yo ? p.nombre + ' (tú)' : p.nombre) + '</span>';
    var orden = manoOrden(p);
    var b = '';
    if (orden) b += '<span class="rv-mano" title="Levantó la mano">✋ ' + orden + '</span>';
    if (!p.yo && p.pc && p.pc.connectionState !== 'connected') b += '<span>' + (p.pc.connectionState === 'failed' ? 'sin conexión' : 'conectando…') + '</span>';
    if (fijado === p.id) b += '<span title="Fijado en el escenario">📌</span>';
    d.querySelector('.rv-badges').innerHTML = b;
    var a = '<button type="button" data-fijar="' + p.id + '">' + (fijado === p.id ? '📌 Soltar' : '📌 Fijar') + '</button>';
    if (R && R.anfitrion && !p.yo) {
      if (e.mic !== false) a += '<button type="button" data-mod="silenciar" data-para="' + p.id + '" title="Silenciar a ' + esc(p.nombre) + '">🔇</button>';
      if (e.mano) a += '<button type="button" data-mod="bajar_mano" data-para="' + p.id + '" title="Bajar la mano">✋⬇</button>';
      a += '<button type="button" data-mod="sacar" data-para="' + p.id + '" title="Sacar de la reunión">🚪</button>';
    }
    d.querySelector('.rv-acc').innerHTML = a;
  }
  function manoOrden(p) {
    if (!p.estado || !p.estado.mano) return 0;
    var manos = personas().filter(function (x) { return x.estado && x.estado.mano; }).map(function (x) { return x.estado.mano; }).sort(function (a, b) { return a - b; });
    return manos.indexOf(p.estado.mano) + 1;
  }
  // Escenario: lo fijado; si no, quien tiene la palabra; si no hay nadie más, yo
  function acomodar() {
    if (!panel || !R) return;
    var esc_ = panel.querySelector('#rvEscenario'), tira = panel.querySelector('#rvTira');
    if (!esc_ || !tira) return;
    var lista = personas();
    if (fijado && !lista.some(function (p) { return p.id === fijado; })) fijado = null;
    var otros = lista.filter(function (p) { return !p.yo; });
    var elegido = fijado || (foco && lista.some(function (p) { return p.id === foco; }) ? foco : null) || (otros[0] ? otros[0].id : 'yo');
    lista.forEach(function (p) {
      if (!p.tile) nuevoTile(p);
      var destino = p.id === elegido ? esc_ : tira;
      if (p.tile.parentNode !== destino) {
        destino.appendChild(p.tile);
        var v = p.tile.querySelector('video'); if (v && v.srcObject) v.play().catch(function () {});
      }
    });
    lista.forEach(actualizarTile);
    info();
  }

  // ---------- Quién habla (volumen de cada micrófono) ----------
  function medir(p) {
    if (!p.stream || !p.stream.getAudioTracks().length) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(function () {});
      var an = audioCtx.createAnalyser(); an.fftSize = 512;
      audioCtx.createMediaStreamSource(p.stream).connect(an);
      p.analizador = an; p.buf = new Float32Array(an.fftSize); p.hablaDesde = 0; p.ultimaVoz = 0;
    } catch (e) { /* sin audio no hay detección de quién habla */ }
  }
  function nivel(p) {
    if (!p.analizador) return 0;
    if (p.yo ? !R.estado.mic : p.estado.mic === false) return 0;
    p.analizador.getFloatTimeDomainData(p.buf);
    var s = 0; for (var i = 0; i < p.buf.length; i++) s += p.buf[i] * p.buf[i];
    return Math.sqrt(s / p.buf.length);
  }
  function revisarVoces() {
    if (!R) return;
    var ahora = Date.now(), mejor = null, mejorNivel = 0;
    personas().forEach(function (p) {
      var n = nivel(p), habla = n > UMBRAL_VOZ;
      if (habla) { if (!p.hablaDesde) p.hablaDesde = ahora; p.ultimaVoz = ahora; } else if (ahora - (p.ultimaVoz || 0) > 400) p.hablaDesde = 0;
      var activo = !!p.hablaDesde && ahora - p.hablaDesde >= MIN_HABLA_MS;
      if (p.tile) p.tile.classList.toggle('habla', !!p.hablaDesde);
      if (activo && !p.yo && n > mejorNivel) { mejor = p; mejorNivel = n; }
    });
    // El escenario cambia a quien tiene la palabra (las demás personas; yo me veo en la tira)
    if (mejor && foco !== mejor.id) {
      var actual = R.pcs[foco];
      var actualHabla = actual && actual.hablaDesde && Date.now() - actual.ultimaVoz < 300;
      if (!actualHabla) { foco = mejor.id; if (!fijado) acomodar(); }
    }
  }

  // ---------- Medios ----------
  function medios() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.resolve(new MediaStream());
    return navigator.mediaDevices.getUserMedia({video: {width: {ideal: 1280}, height: {ideal: 720}}, audio: {echoCancellation: true, noiseSuppression: true}})
      .catch(function () { return navigator.mediaDevices.getUserMedia({audio: true}).then(function (s) { aviso('No se pudo usar la cámara: entras solo con micrófono.'); return s; }); })
      .catch(function () { aviso('Sin cámara ni micrófono: entras solo a ver y escuchar.'); return new MediaStream(); });
  }

  // ---------- Entrar / crear / salir ----------
  function error(txt) { var e = panel && panel.querySelector('#rvErr'); if (e) e.textContent = txt; else aviso(txt); }
  function crear() { post(API + 'crear').then(function (d) { entrar(d.codigo); }).catch(function (e) { error(e.message); }); }
  function entrar(codigo) {
    codigo = (codigo || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{3}-?[A-Z0-9]{4}$/.test(codigo)) { error('Escribe el código completo, ej. K7M-4QPX.'); return; }
    if (codigo.indexOf('-') < 0) codigo = codigo.slice(0, 3) + '-' + codigo.slice(3);
    if (R) return;
    medios().then(function (local) {
      return post(API + encodeURIComponent(codigo) + '/entrar').then(function (d) {
        var estado = {mic: local.getAudioTracks().length > 0, cam: local.getVideoTracks().length > 0, mano: 0};
        R = {codigo: d.codigo, peer: d.peer, nombre: d.nombre, max: d.max, anfitrion: d.anfitrion, pcs: {}, local: local, estado: estado};
        R.yo = {id: 'yo', yo: true, nombre: d.nombre, stream: local, estado: estado, anfitrion: d.anfitrion};
        foco = null; fijado = null;
        medir(R.yo);
        pintar();
        enviarEstado();
        conectarEventos();
        d.otros.forEach(function (o) { nuevaConexion(o, true); });   // yo llamo a los que ya estaban
        medidor = setInterval(revisarVoces, 120);
      }).catch(function (e) { local.getTracks().forEach(function (t) { t.stop(); }); throw e; });
    }).catch(function (e) { error(e.message); });
  }
  function salir(silencioso, motivo) {
    if (!R) return;
    var r = R; R = null;
    clearInterval(medidor);
    try { r.es && r.es.close(); } catch (e) {}
    Object.keys(r.pcs).forEach(function (k) { try { r.pcs[k].pc.close(); } catch (e) {} });
    r.local.getTracks().forEach(function (t) { t.stop(); });
    var cuerpo = JSON.stringify({peer: r.peer});
    if (silencioso && navigator.sendBeacon) navigator.sendBeacon(API + encodeURIComponent(r.codigo) + '/salir', new Blob([cuerpo], {type: 'application/json'}));
    else post(API + encodeURIComponent(r.codigo) + '/salir', {peer: r.peer}).catch(function () {});
    if (!silencioso) { cerrarPanel(); aviso(motivo || 'Saliste de la reunión.'); }
  }
  addEventListener('pagehide', function () { salir(true); });

  function enviarEstado() {
    if (!R) return;
    api('/estado', {mic: R.estado.mic, cam: R.estado.cam, mano: !!R.estado.mano})
      .then(function (d) { if (R) { R.estado.mano = d.mano; acomodar(); } }).catch(function () {});
  }
  function conectarEventos() {
    var es = new EventSource(API + encodeURIComponent(R.codigo) + '/eventos?peer=' + encodeURIComponent(R.peer));
    R.es = es;
    es.onmessage = function (e) {
      var m; try { m = JSON.parse(e.data); } catch (x) { return; }
      if (!R) return;
      if (m.t === 'llego') { nuevaConexion(m, false); aviso('👋 ' + m.nombre + ' entró a la reunión'); }
      else if (m.t === 'salio') quitar(m.peer, true);
      else if (m.t === 'senal') senal(m.de, m.datos);
      else if (m.t === 'estado') {
        var x = R.pcs[m.peer]; if (!x) return;
        var levanto = m.mano && !x.estado.mano;
        x.estado = {mic: m.mic, cam: m.cam, mano: m.mano};
        if (levanto) aviso('✋ ' + x.nombre + ' levantó la mano');
        acomodar();
      } else if (m.t === 'moderar') moderado(m);
    };
    es.onerror = function () { if (es.readyState === 2 && R) salir(false, 'Se perdió la conexión con la reunión.'); };
  }
  function moderado(m) {
    if (m.accion === 'silenciar') {
      var t = R.local.getAudioTracks()[0];
      if (t && t.enabled) { t.enabled = false; R.estado.mic = false; enviarEstado(); barra(); }
      aviso('🔇 ' + m.por + ' silenció tu micrófono. Puedes activarlo cuando te toque hablar.');
    } else if (m.accion === 'bajar_mano') {
      if (R.estado.mano) { R.estado.mano = 0; enviarEstado(); barra(); }
      aviso('✋ ' + m.por + ' bajó tu mano.');
    } else if (m.accion === 'sacar') {
      salir(false, '🚪 ' + m.por + ' te sacó de la reunión.');
    }
  }

  // ---------- Conexión con cada persona (WebRTC) ----------
  function enviar(para, datos) { if (R) api('/senal', {para: para, datos: datos}).catch(function () {}); }
  function nuevaConexion(o, llamo) {
    var id = o.peer;
    if (!R || R.pcs[id]) return R && R.pcs[id];
    var pc = new RTCPeerConnection({iceServers: ICE});
    var remoto = new MediaStream();
    var x = {id: id, pc: pc, nombre: o.nombre || 'Participante', anfitrion: !!o.anfitrion, stream: remoto,
             estado: {mic: o.mic !== false, cam: o.cam !== false, mano: o.mano || 0}, pend: []};
    R.pcs[id] = x;
    R.local.getTracks().forEach(function (t) { pc.addTrack(t, R.local); });
    if (!R.local.getAudioTracks().length) pc.addTransceiver('audio', {direction: 'recvonly'});
    if (!R.local.getVideoTracks().length) pc.addTransceiver('video', {direction: 'recvonly'});
    pc.ontrack = function (ev) {
      if (remoto.getTracks().indexOf(ev.track) < 0) remoto.addTrack(ev.track);
      if (ev.track.kind === 'audio' && !x.analizador) medir(x);
      var v = x.tile && x.tile.querySelector('video'); if (v) { v.srcObject = remoto; v.play().catch(function () {}); }
      actualizarTile(x);
    };
    pc.onicecandidate = function (ev) { if (ev.candidate) enviar(id, {candidato: ev.candidate.toJSON()}); };
    pc.onconnectionstatechange = function () { if (x.tile) x.tile.dataset.estado = pc.connectionState; actualizarTile(x); };
    acomodar();
    if (llamo) {
      pc.createOffer().then(function (of) { return pc.setLocalDescription(of); })
        .then(function () { enviar(id, {sdp: pc.localDescription.toJSON()}); });
    }
    return x;
  }
  function senal(de, d) {
    var x = R.pcs[de] || nuevaConexion({peer: de}, false);
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
    if (x.tile) x.tile.remove();
    delete R.pcs[id];
    if (foco === id) foco = null;
    if (fijado === id) fijado = null;
    acomodar();
    if (avisar) aviso(x.nombre + ' salió de la reunión');
  }

  // ---------- Botones ----------
  document.addEventListener('click', function (e) {
    if (!panel || !panel.contains(e.target)) return;
    var fj = e.target.closest('[data-fijar]');
    if (fj) { fijado = fijado === fj.dataset.fijar ? null : fj.dataset.fijar; acomodar(); return; }
    var md = e.target.closest('[data-mod]');
    if (md && R) {
      var p = R.pcs[md.dataset.para], ac = md.dataset.mod;
      if (ac === 'sacar' && !confirm('¿Sacar a ' + (p ? p.nombre : 'esta persona') + ' de la reunión?')) return;
      api('/moderar', {para: md.dataset.para, accion: ac}).then(function () {
        if (ac === 'silenciar' && p) aviso('🔇 Silenciaste a ' + p.nombre);
      }).catch(function (er) { aviso(er.message); });
      return;
    }
    var tl = e.target.closest('#rvTira .rv-tile');
    if (tl && !e.target.closest('button')) { fijado = tl.dataset.peer; acomodar(); return; }   // clic en una cámara: al escenario
    var b = e.target.closest('[data-rv]');
    if (!b) return;
    var a = b.dataset.rv;
    if (a === 'cerrar') cerrarPanel();
    else if (a === 'crear') crear();
    else if (a === 'unirse') entrar(panel.querySelector('#rvCodigo').value);
    else if (a === 'min') panel.classList.toggle('rv-min');
    else if (a === 'grande') { modo = modo === 'grande' ? 'normal' : 'grande'; if (modo === 'grande') { panel.style.left = ''; panel.style.top = ''; } pintar(); }
    else if (a === 'salir') salir(false);
    else if (a === 'mano') { R.estado.mano = R.estado.mano ? 0 : 1; enviarEstado(); barra(); }
    else if (a === 'mutear_todos') {
      api('/moderar', {accion: 'silenciar_todos'}).then(function (d) { aviso('🔇 Silenciaste a ' + d.personas + ' persona(s)'); }).catch(function (er) { aviso(er.message); });
    } else if (a === 'mic' || a === 'cam') {
      var tipo = a === 'mic' ? 'audio' : 'video';
      var t = R && R.local.getTracks().filter(function (x) { return x.kind === tipo; })[0];
      if (!t) { aviso(tipo === 'audio' ? 'No hay micrófono disponible.' : 'No hay cámara disponible.'); return; }
      t.enabled = !t.enabled;
      R.estado[a] = t.enabled;
      enviarEstado(); barra(); acomodar();
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
  window.DSReunion = {
    abrir: abrirPanel, entrar: entrar, salir: salir,
    estado: function () { return R ? {codigo: R.codigo, personas: Object.keys(R.pcs).length + 1, foco: foco, fijado: fijado, anfitrion: R.anfitrion} : null; }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
