/* Editor de la página de Inicio de Design (solo admins): bloques y secciones arrastrables, posición libre,
   edición de texto en el lugar, panel de propiedades, plantillas, biblioteca de medios, deshacer/rehacer,
   vista previa por dispositivo, guardado automático del borrador, historial y publicar. */
(function() {
  'use strict';
  var NVI = window.NVI, h = NVI.h, esc = NVI.esc, D = NVI.BLOQUES;
  var E = NVI.ed = {convertidas: {}, pag: null, version: 0, sel: null, hist: [], histI: -1, previa: false, disp: 'escritorio', editando: null, guardando: false, pendiente: false};

  function api(url, body) {
    var o = {credentials: 'same-origin', headers: {}};
    if (body !== undefined) { o.method = 'POST'; o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(body); }
    return fetch(url, o).then(function(r) { return r.json().catch(function() { return {}; }).then(function(d) { if (!r.ok) { var e = new Error(d.detail || ('Error ' + r.status)); e.status = r.status; e.datos = d; throw e; } return d; }); });
  }
  function aviso(txt, error) {
    var t = document.getElementById('nviAviso'); if (!t) { t = h('div', 'nvi-ed-aviso'); t.id = 'nviAviso'; document.body.appendChild(t); }
    t.textContent = txt; t.classList.toggle('error', !!error); t.classList.add('on'); clearTimeout(t._t); t._t = setTimeout(function() { t.classList.remove('on'); }, 3200);
  }
  E.aviso = aviso;

  // ---------- Búsquedas en la página ----------
  function secPor(id) { return (E.pag.secciones || []).filter(function(s) { return s.id === id; })[0]; }
  function colPor(id) { var r = null; E.pag.secciones.forEach(function(s) { (s.columnas || []).forEach(function(c) { if (c.id === id) r = {sec: s, col: c}; }); }); return r; }
  function blkPor(id) {
    var r = null;
    E.pag.secciones.forEach(function(s) {
      (s.columnas || []).forEach(function(c) { (c.bloques || []).forEach(function(b, i) { if (b.id === id) r = {sec: s, col: c, blk: b, lista: c.bloques, i: i}; }); });
      (s.elementos || []).forEach(function(el, i) { if (el.bloque.id === id) r = {sec: s, el: el, blk: el.bloque, lista: s.elementos, i: i}; });
    });
    return r;
  }
  function nuevosIds(o) {  // al duplicar
    if (Array.isArray(o)) { o.forEach(nuevosIds); return o; }
    if (o && typeof o === 'object') { if (o.id) o.id = NVI.uid(o.id.charAt(0)); Object.keys(o).forEach(function(k) { if (k !== 'id') nuevosIds(o[k]); }); }
    return o;
  }

  // ---------- Historial (deshacer / rehacer) y guardado automático ----------
  var tHist = null, tGuardar = null, tPintar = null;
  var ABIERTOS = typeof WeakSet === 'function' ? new WeakSet() : {has: function() { return false; }, add: function() {}, delete: function() {}};   // filas abiertas del panel
  E.cambio = function(sinRepintar) {
    if (!sinRepintar) { clearTimeout(tPintar); tPintar = setTimeout(function() { E.pintar(); }, 120); }
    // lo que se escribe en un campo o en el texto se agrupa en un solo paso; borrar, duplicar, mover, etc. es un paso cada uno
    clearTimeout(tHist);
    var a = document.activeElement;
    if (E.editando || (a && a.closest && a.closest('#nviProps') && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) tHist = setTimeout(registrar, 500); else registrar();
    marcarSinGuardar(); clearTimeout(tGuardar); tGuardar = setTimeout(E.guardar, 1400);
  };
  function registrar() { var f = JSON.stringify(E.pag); if (E.hist[E.histI] === f) return; E.hist = E.hist.slice(0, E.histI + 1); E.hist.push(f); if (E.hist.length > 80) E.hist.shift(); E.histI = E.hist.length - 1; botonesHist(); }
  function restaurar(f) { E.pag = JSON.parse(f); E.sel = null; E.pintar(); marcarSinGuardar(); clearTimeout(tGuardar); tGuardar = setTimeout(E.guardar, 800); botonesHist(); }
  E.deshacer = function() { registrar(); if (E.histI > 0) { E.histI--; restaurar(E.hist[E.histI]); } };
  E.rehacer = function() { if (E.histI < E.hist.length - 1) { E.histI++; restaurar(E.hist[E.histI]); } };
  function botonesHist() { var u = document.getElementById('nviUndo'), r = document.getElementById('nviRedo'); if (u) u.disabled = E.histI <= 0; if (r) r.disabled = E.histI >= E.hist.length - 1; }
  function marcarSinGuardar() { E.sinGuardar = true; estado('Guardando…'); }
  function estado(t) { var e = document.getElementById('nviEstado'); if (e) e.textContent = t; }
  E.guardar = function(forzar) {
    clearTimeout(tGuardar);
    if (!E.sinGuardar && !forzar) return Promise.resolve();
    if (E.guardando) { E.pendiente = true; return Promise.resolve(); }
    E.guardando = true; E.sinGuardar = false; estado('Guardando…');
    var enviado = E.limpiarTemp(E.pag);
    return api('/design/api/inicio/borrador', {contenido: enviado, version: E.version, forzar: forzar === 'forzar'}).then(function(r) {
      E.version = r.version; E.base = JSON.stringify(enviado); E.reintentos = 0;
      estado('Borrador guardado · cambios sin publicar'); E.hayCambios = true; pintarPublicar();
    }).catch(function(e) {
      E.sinGuardar = true;
      if (e.status === 409) {
        // Otro admin guardó antes: se combinan los cambios (sección por sección) y se vuelve a guardar solo
        E.reintentos = (E.reintentos || 0) + 1;
        if (E.reintentos <= 3) return api('/design/api/inicio/borrador').then(function(d) { combinarCon(d); E.guardando = false; return E.guardar(); });
        E.reintentos = 0;
        return dialogo('Otra persona guardó cambios', '<p>' + esc(e.message) + '</p><p>¿Qué quieres hacer?</p>', [{t: 'Guardar mi versión', v: 'mia', p: true}, {t: 'Cargar la otra versión', v: 'otra'}]).then(function(v) {
          E.guardando = false;
          if (v === 'mia') return E.guardar('forzar');
          if (v === 'otra') return cargar();
        });
      }
      estado('No se guardó: ' + e.message); aviso('No se guardó: ' + e.message, true);
    }).then(function() { E.guardando = false; if (E.pendiente) { E.pendiente = false; if (E.sinGuardar) E.guardar(); } });
  };

  // ---------- Edición en vivo entre admins ----------
  // Combinar: base = lo último que se sincronizó, mio = lo que tengo, suyo = lo que guardó otro admin.
  // Por sección: si solo uno la cambió gana ese cambio; si ambos, gana el mío. Igual con el estilo de la página.
  // Una sección que solo pasé de columnas a libre (sin tocarla) no cuenta como cambio mío al combinar con otro admin.
  // Se compara sin el alto anotado (hd), que cada editor mide por su lado.
  var sinHd = function(x) { return JSON.stringify(x, function(k, v) { return k === 'hd' ? undefined : v; }); };
  function cambioMio(m, b, id) { var jm = sinHd(m); return jm !== sinHd(b) && jm !== E.convertidas[id]; }
  function combinar(base, mio, suyo) {
    var J = JSON.stringify, mapa = function(p) { var m = {}; ((p && p.secciones) || []).forEach(function(x) { m[x.id] = x; }); return m; };
    var B = mapa(base), M = mapa(mio), T = mapa(suyo), res = {};
    Object.keys(M).concat(Object.keys(T)).forEach(function(id) {
      if (id in res) return;
      var b = B[id], m = M[id], t = T[id];
      if (m && t) res[id] = b && cambioMio(m, b, id) ? m : t;
      else if (m) { if (!b || cambioMio(m, b, id)) res[id] = m; }      // la agregué yo, o él la borró pero yo la cambié
      else if (t) { if (!b || J(t) !== J(b)) res[id] = t; }      // la agregó él, o yo la borré pero él la cambió
    });
    var ids = function(p) { return ((p && p.secciones) || []).map(function(x) { return x.id; }); };
    var oB = ids(base), oM = ids(mio), oT = ids(suyo);
    var mioMovio = J(oM.filter(function(i) { return oB.indexOf(i) >= 0; })) !== J(oB.filter(function(i) { return oM.indexOf(i) >= 0; }));
    var prim = mioMovio ? oM : oT, seg = mioMovio ? oT : oM, orden = prim.filter(function(i) { return res[i]; });
    seg.forEach(function(i, k) { if (!res[i] || orden.indexOf(i) >= 0) return; var antes = seg.slice(0, k).reverse().filter(function(x) { return orden.indexOf(x) >= 0; })[0]; orden.splice(antes ? orden.indexOf(antes) + 1 : 0, 0, i); });
    return {tema: base && J(mio.tema) !== J(base.tema) ? mio.tema : (suyo.tema || mio.tema), secciones: orden.map(function(i) { return res[i]; })};
  }
  function combinarCon(d) {
    var suyo = d.contenido || NVI.PLANTILLA_VACIA(), base = E.base ? JSON.parse(E.base) : null;
    var mio = E.limpiarTemp(E.pag), hayMio = !base || JSON.stringify(mio) !== E.base;
    E.pag = hayMio && base ? combinar(base, mio, suyo) : suyo;
    E.version = d.version; E.base = JSON.stringify(suyo); E.hayCambios = d.hayCambios; E.publicadoEn = d.publicadoEn;
    if (E.sel && E.sel.tipo === 'bloque' && !blkPor(E.sel.id)) E.sel = null;
    if (E.sel && E.sel.tipo === 'seccion' && !secPor(E.sel.id)) E.sel = null;
    registrar(); E.pintar(); pintarPublicar();
    if (d.actualizadoPor) destello(d.actualizadoPor);
    return hayMio;
  }
  function destello(quien) {
    var e = document.getElementById('nviVivoCambio'); if (!e) return;
    e.textContent = '↻ Cambios de ' + quien.split(' ')[0]; e.classList.add('on'); clearTimeout(e._t); e._t = setTimeout(function() { e.classList.remove('on'); }, 3500);
  }
  function ocupado() {
    var a = document.activeElement;
    return E.editando || E.guardando || E.sinGuardar || document.body.classList.contains('nvi-arrastrando') || document.body.classList.contains('nvi-arrastrando-mouse') ||
      document.querySelector('.nvi-dlg-bg, #nviMenu') || (a && a.closest && a.closest('#nviProps') && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
  }
  var vivoAndando = false;
  function vivoTick() {
    if (vivoAndando || document.hidden || !E.pag) return;
    vivoAndando = true;
    var sel = E.sel && (E.sel.tipo === 'bloque' || E.sel.tipo === 'seccion') ? E.sel.id : '';
    api('/design/api/inicio/presencia', {sel: sel}).then(function(r) {
      E.otros = r.editores || []; pintarOtros();
      if (r.version !== E.version && !ocupado()) return api('/design/api/inicio/borrador').then(function(d) { if (!ocupado() && d.version !== E.version) combinarCon(d); });
    }).catch(function() {}).then(function() { vivoAndando = false; });
  }
  var COLORES_OTROS = ['#db2777', '#059669', '#d97706', '#7c3aed', '#0891b2'];
  function pintarOtros() {
    var cont = document.getElementById('nviOtros'); if (!cont) return;
    cont.innerHTML = (E.otros || []).map(function(o, i) { return '<span class="nvi-ed-otro-chip" style="background:' + COLORES_OTROS[i % 5] + '" title="' + esc(o.nombre) + ' también está editando">' + esc(o.nombre.split(' ').map(function(x) { return x.charAt(0); }).join('').slice(0, 2).toUpperCase()) + '</span>'; }).join('') +
      ((E.otros || []).length ? '<span class="nvi-ed-otro-txt">' + esc(E.otros.map(function(o) { return o.nombre.split(' ')[0]; }).join(', ')) + ' también ' + (E.otros.length > 1 ? 'están' : 'está') + ' editando</span>' : '');
    document.querySelectorAll('#nviLienzo .nvi-ed-otro').forEach(function(x) { x.classList.remove('nvi-ed-otro'); x.removeAttribute('data-otro'); x.style.removeProperty('--otro'); });
    (E.otros || []).forEach(function(o, i) {
      if (!o.sel) return;
      var el = document.querySelector('#nviLienzo [data-blk="' + o.sel + '"], #nviLienzo [data-sec="' + o.sel + '"]');
      if (el) { el.classList.add('nvi-ed-otro'); el.setAttribute('data-otro', o.nombre.split(' ')[0]); el.style.setProperty('--otro', COLORES_OTROS[i % 5]); }
    });
  }
  E.vivo = function() {
    setInterval(vivoTick, 3000);
    document.addEventListener('visibilitychange', function() { if (!document.hidden) vivoTick(); });
    window.addEventListener('pagehide', function() { try { fetch('/design/api/inicio/presencia', {method: 'POST', credentials: 'same-origin', keepalive: true, headers: {'Content-Type': 'application/json'}, body: JSON.stringify({salir: true})}); } catch (e) {} });
  };
  window.addEventListener('beforeunload', function(e) { if (E.sinGuardar) { E.guardar(); e.preventDefault(); e.returnValue = ''; } });

  // ---------- Ventanas ----------
  function dialogo(titulo, html, botones, ancho) {
    return new Promise(function(ok) {
      var bg = h('div', 'nvi-dlg-bg'), d = h('div', 'nvi-dlg'); if (ancho) d.style.width = 'min(' + ancho + 'px, 100%)';
      d.innerHTML = '<h3>' + esc(titulo) + '</h3><div class="nvi-dlg-c">' + html + '</div><div class="nvi-dlg-bot"></div>';
      var bot = d.querySelector('.nvi-dlg-bot');
      (botones || [{t: 'Aceptar', v: true, p: true}]).concat([{t: 'Cancelar', v: null}]).forEach(function(b) {
        if (b.v === null && botones && botones.some(function(x) { return x.v === null; })) return;
        var x = h('button', b.p ? 'nvi-b1' : 'nvi-b2', esc(b.t)); x.type = 'button'; x.onclick = function() { bg.remove(); ok(b.v); }; bot.appendChild(x);
      });
      bg.appendChild(d); bg.addEventListener('mousedown', function(e) { if (e.target === bg) { bg.remove(); ok(null); } });
      document.body.appendChild(bg); var p = bot.querySelector('.nvi-b1'); if (p) p.focus();
      ok.dlg = d;
    });
  }
  E.dialogo = dialogo;

  // ---------- Interfaz ----------
  var BLOQUES_ORDEN = ['titulo', 'texto', 'botones', 'imagen', 'video', 'carrusel', 'galeria', 'tarjetas', 'cifras', 'cita', 'acordeon', 'cuenta', 'muro', 'embed', 'separador', 'espacio'];
  var SECCIONES = [['libre', 'Sección en blanco'], ['libre-baja', 'Sección baja'], ['libre-alta', 'Sección alta']];
  E.iniciar = function() {
    document.body.classList.add('nvi-editando');
    var raiz = h('div', 'nvi-ed'); raiz.id = 'nviEd';
    raiz.innerHTML =
      '<header class="nvi-ed-barra">' +
        '<div class="nvi-ed-grupo"><span class="nvi-ed-marca">✎ Editor de Inicio</span>' +
          '<button type="button" data-ac="plantillas">▦ Plantillas</button><button type="button" data-ac="tema">🎨 Estilo de la página</button><button type="button" data-ac="medios">🖼 Medios</button></div>' +
        '<div class="nvi-ed-grupo"><button type="button" id="nviUndo" data-ac="deshacer" title="Deshacer (Ctrl+Z)">↶</button><button type="button" id="nviRedo" data-ac="rehacer" title="Rehacer (Ctrl+Y)">↷</button>' +
          '<span class="nvi-ed-disp"><button type="button" data-disp="escritorio" class="on" title="Computador">🖥</button><button type="button" data-disp="tablet" title="Tablet">▭</button><button type="button" data-disp="movil" title="Celular">📱</button></span></div>' +
        '<div class="nvi-ed-grupo der"><span class="nvi-ed-otros" id="nviOtros"></span><span class="nvi-ed-vivo-cambio" id="nviVivoCambio"></span><span class="nvi-ed-estado" id="nviEstado">Cargando…</span><button type="button" data-ac="historial">🕘 Historial</button>' +
          '<button type="button" data-ac="descartar" id="nviDescartar" title="Volver a lo que está publicado">Descartar cambios</button>' +
          '<button type="button" data-ac="previa" id="nviPrevia">👁 Vista previa</button><button type="button" data-ac="publicar" class="nvi-ed-publicar" id="nviPublicar">Publicar</button>' +
          '<button type="button" data-ac="salir" title="Salir del editor">✕</button></div>' +
      '</header>' +
      '<aside class="nvi-ed-izq"><div class="nvi-ed-tabs"><button type="button" data-tab="bloques" class="on">Bloques</button><button type="button" data-tab="secciones">Secciones</button></div>' +
        '<div class="nvi-ed-pal" data-pal="bloques">' + BLOQUES_ORDEN.map(function(k) { return '<div class="nvi-ed-item" draggable="true" data-nuevo="' + k + '" title="Arrastra a la página o haz clic para agregarlo"><span>' + D[k].ic + '</span>' + esc(D[k].n) + '</div>'; }).join('') + '</div>' +
        '<div class="nvi-ed-pal" data-pal="secciones" hidden>' + SECCIONES.map(function(s) {
          return '<div class="nvi-ed-item sec" data-nueva-sec="' + s[0] + '" title="Clic para agregarla al final (o usa el + entre secciones)"><span class="nvi-ed-mini">' +
            (s[2] ? s[2].map(function(a) { return '<i style="flex:' + a + '"></i>'; }).join('') : '<i class="libre"></i>') + '</span>' + esc(s[1]) + '</div>';
        }).join('') + '<p class="nvi-ed-ayuda">En "Posición libre" mueves cada elemento con el mouse donde quieras y le cambias el tamaño desde la esquina.</p></div>' +
        '<p class="nvi-ed-ayuda">Clic en cualquier elemento de la página para cambiarlo a la derecha. Doble clic en un texto para escribir.</p></aside>' +
      '<main class="nvi-ed-centro" id="nviCentro"><div class="nvi-ed-marco" id="nviMarco"><div id="nviLienzo"></div></div></main>' +
      '<aside class="nvi-ed-der" id="nviProps"></aside>';
    document.body.appendChild(raiz);
    posicionar(); window.addEventListener('resize', posicionar);
    raiz.querySelector('.nvi-ed-barra').addEventListener('click', accionBarra);
    raiz.querySelectorAll('.nvi-ed-tabs button').forEach(function(b) { b.onclick = function() { raiz.querySelectorAll('.nvi-ed-tabs button').forEach(function(x) { x.classList.toggle('on', x === b); }); raiz.querySelectorAll('[data-pal]').forEach(function(p) { p.hidden = p.dataset.pal !== b.dataset.tab; }); }; });
    raiz.querySelectorAll('[data-nuevo]').forEach(function(it) {
      it.addEventListener('dragstart', function(e) { e.dataTransfer.setData('text/nvi-nuevo', it.dataset.nuevo); e.dataTransfer.effectAllowed = 'copy'; document.body.classList.add('nvi-arrastrando'); });
      it.addEventListener('dragend', finArrastre);
      it.addEventListener('click', function() { agregarBloqueClic(it.dataset.nuevo); });
    });
    raiz.querySelectorAll('[data-nueva-sec]').forEach(function(it) { it.onclick = function() { agregarSeccion(it.dataset.nuevaSec, E.pag.secciones.length); }; });
    var lienzo = document.getElementById('nviLienzo');
    lienzo.addEventListener('click', clicLienzo);
    lienzo.addEventListener('dblclick', dobleClic);
    lienzo.addEventListener('dragover', sobreLienzo);
    lienzo.addEventListener('drop', soltarLienzo);
    lienzo.addEventListener('mousedown', mouseLibre);
    document.addEventListener('keydown', teclado);
    cargar().then(function() { E.vivo(); });
  };
  function posicionar() { var nav = document.querySelector('body > nav'), e = document.getElementById('nviEd'); if (e) e.style.top = (nav ? nav.getBoundingClientRect().bottom : 0) + 'px'; }
  function cargar() {
    estado('Cargando…');
    return api('/design/api/inicio/borrador').then(function(d) {
      E.version = d.version; E.hayCambios = d.hayCambios; E.publicadoEn = d.publicadoEn;
      E.pag = d.contenido || null; E.base = d.contenido ? JSON.stringify(d.contenido) : null;
      E.hist = []; E.histI = -1;
      if (!E.pag) { E.pag = NVI.PLANTILLA_VACIA(); registrar(); E.pintar(); estado('Página nueva'); abrirPlantillas(true); }
      else { registrar(); E.pintar(); estado(d.hayCambios ? 'Borrador con cambios sin publicar' : 'Igual a lo publicado'); }
      pintarPublicar();
    }).catch(function(e) { estado('No se pudo cargar'); aviso(e.message, true); });
  }
  function pintarPublicar() { var d = document.getElementById('nviDescartar'); if (d) d.style.display = E.hayCambios && E.publicadoEn ? '' : 'none'; }

  function accionBarra(e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.disp) { E.disp = b.dataset.disp; document.querySelectorAll('.nvi-ed-disp button').forEach(function(x) { x.classList.toggle('on', x === b); }); document.getElementById('nviMarco').className = 'nvi-ed-marco disp-' + E.disp; return; }
    var ac = b.dataset.ac;
    if (ac === 'deshacer') E.deshacer();
    if (ac === 'rehacer') E.rehacer();
    if (ac === 'plantillas') abrirPlantillas(false);
    if (ac === 'tema') { E.sel = {tipo: 'tema'}; pintarProps(); E.pintar(); }
    if (ac === 'medios') E.biblioteca(null, null);
    if (ac === 'previa') { E.previa = !E.previa; document.body.classList.toggle('nvi-previa', E.previa); b.textContent = E.previa ? '✎ Volver a editar' : '👁 Vista previa'; E.pintar(); if (E.previa && E.pag.tema && E.pag.tema.alAbrir) NVI.celebrarAlAbrir(E.pag.tema.alAbrir, true); }
    if (ac === 'historial') abrirHistorial();
    if (ac === 'descartar') dialogo('Descartar cambios', '<p>El borrador vuelve a quedar igual a lo que está publicado. Los cambios sin publicar se pierden.</p>', [{t: 'Descartar', v: 1, p: true}]).then(function(v) {
      if (!v) return; clearTimeout(tGuardar); E.sinGuardar = false; api('/design/api/inicio/descartar', {}).then(function() { cargar(); aviso('Se descartaron los cambios.'); });
    });
    if (ac === 'publicar') publicar();
    if (ac === 'salir') E.guardar().then(function() { location.href = '/design/inicio'; });
  }
  function publicar() {
    dialogo('Publicar la página', '<p>Todos los que entran a Design verán esta versión de la página de Inicio.</p><p style="color:#64748b;font-size:13px">La versión anterior queda en el Historial por si necesitas volver a ella.</p>', [{t: 'Publicar', v: 1, p: true}]).then(function(v) {
      if (!v) return;
      var b = document.getElementById('nviPublicar'); b.disabled = true; b.textContent = 'Publicando…';
      E.guardar(true).then(function() { return api('/design/api/inicio/publicar', {}); }).then(function(r) {
        E.hayCambios = false; E.publicadoEn = r.publicadoEn; pintarPublicar(); estado('Publicada');
        dialogo('¡Página publicada!', '<p>La página de Inicio ya está actualizada para todos.</p>', [{t: 'Ver la página', v: 'ver', p: true}, {t: 'Seguir editando', v: 'seguir'}]).then(function(x) { if (x === 'ver') location.href = '/design/inicio'; });
      }).catch(function(e) { aviso('No se publicó: ' + e.message, true); }).then(function() { b.disabled = false; b.textContent = 'Publicar'; });
    });
  }

  // ---------- Dibujar en modo edición ----------
  E.pintar = function() {
    var lienzo = document.getElementById('nviLienzo'); if (!lienzo || !E.pag) return;
    if (E.editando) return;  // no redibujar mientras se escribe en un texto
    var y = document.getElementById('nviCentro').scrollTop;
    NVI.render(E.pag, lienzo, {modo: E.previa ? 'ver' : 'editar'});
    // todas las secciones son de posición libre: las que vienen en columnas (plantillas, páginas anteriores) se convierten aquí
    if (!E.previa && pasarALibre(lienzo)) NVI.render(E.pag, lienzo, {modo: 'editar'});
    if (!E.previa) { decorar(lienzo); pintarOtros(); }
    document.getElementById('nviCentro').scrollTop = y;
    // si la persona está escribiendo en el panel de la derecha no se redibuja (perdería el cursor a la primera letra)
    if (!E.previa && !escribiendoEnPanel()) pintarProps();
  };
  // Mide dónde quedó cada bloque y lo pasa a posición libre en el mismo lugar. Se mide con la página a su ancho de diseño.
  var esperaFotos = 0;
  function pasarALibre(lienzo) {
    var pend = (E.pag.secciones || []).filter(function(s) { return s.tipo !== 'libre'; });
    if (!pend.length) { esperaFotos = 0; return false; }
    var pagEl = lienzo.querySelector('.nvi-pagina'); if (!pagEl) return false;
    // las fotos sin cargar todavía no tienen su alto: se espera un momento (máx. 3 s)
    var faltan = pend.some(function(s) { var se = pagEl.querySelector('[data-sec="' + s.id + '"]'); return se && Array.prototype.some.call(se.querySelectorAll('img'), function(i) { return !i.complete; }); });
    if (faltan && esperaFotos < 20) { esperaFotos++; setTimeout(E.pintar, 150); return false; }
    esperaFotos = 0;
    var ancho0 = pagEl.style.width;
    pend.forEach(function(s) {
      var e = s.estilo || {}, WD = NVI.anchoLibre(e.ancho);
      pagEl.style.width = (e.ancho === 'completo' ? WD : WD + 56) + 'px';
      var secEl = pagEl.querySelector('[data-sec="' + s.id + '"]'); if (!secEl) return;
      var inner = secEl.querySelector('.nvi-sec-in'), cs = getComputedStyle(inner), cse = getComputedStyle(secEl), R = inner.getBoundingClientRect(), RS = secEl.getBoundingClientRect();
      var left0 = R.left + parseFloat(cs.paddingLeft), ancho = R.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), top0 = RS.top + parseFloat(cse.paddingTop);
      var alto = RS.height - parseFloat(cse.paddingTop) - parseFloat(cse.paddingBottom), els = [];
      (s.columnas || []).forEach(function(c) { (c.bloques || []).forEach(function(b) {
        var bEl = secEl.querySelector('[data-blk="' + b.id + '"]'); if (!bEl) return;
        var r = bEl.getBoundingClientRect();
        if (b.estilo) { delete b.estilo.ancho; delete b.estilo.alinearCaja; }   // el ancho ahora lo da el elemento
        els.push({id: 'e' + b.id, x: Math.round((r.left - left0) / ancho * 1000) / 10, y: Math.round(r.top - top0), w: Math.round(r.width / ancho * 1000) / 10, h: 0, hd: Math.round(r.height), z: 1, bloque: b});
      }); });
      s.tipo = 'libre'; s.elementos = els; delete s.columnas;
      e.alto = Math.max(els.length ? 60 : 300, Math.round(alto)); s.estilo = e;
      E.convertidas[s.id] = sinHd(s);   // así quedó al convertirla (para combinar con otro admin)
    });
    pagEl.style.width = ancho0;
    // no es un cambio de la persona: se reemplaza el último paso del historial en vez de agregar uno
    if (E.histI >= 0) E.hist[E.histI] = JSON.stringify(E.pag);
    marcarSinGuardar(); clearTimeout(tGuardar); tGuardar = setTimeout(E.guardar, 1400);
    return true;
  }
  function anotarAltos(s, inner) {
    var poner = function() {
      var cambio = false;
      (s.elementos || []).forEach(function(el) { if (+el.h) return; var c = inner.querySelector('[data-el="' + el.id + '"]'); if (!c || !c.isConnected) return; var v = c.offsetHeight; if (v && Math.abs((+el.hd || 0) - v) > 1) { el.hd = v; cambio = true; } });
      // no es un cambio de la persona: se actualiza el último paso del historial y se guarda con el borrador
      if (cambio) { if (E.histI >= 0) E.hist[E.histI] = JSON.stringify(E.pag); E.sinGuardar = true; clearTimeout(tGuardar); tGuardar = setTimeout(E.guardar, 1400); }
    };
    requestAnimationFrame(poner);
    if ('ResizeObserver' in window) { var t = 0, ro = new ResizeObserver(function() { clearTimeout(t); t = setTimeout(function() { if (inner.isConnected) poner(); else ro.disconnect(); }, 300); }); Array.prototype.forEach.call(inner.querySelectorAll('.nvi-libre-el'), function(c) { ro.observe(c); }); }
  }
  function escribiendoEnPanel() {
    var a = document.activeElement;
    return !!(a && a.closest && a.closest('#nviProps') && /^(INPUT|TEXTAREA)$/.test(a.tagName) && !/^(checkbox|radio|range|color|file)$/.test(a.type || ''));
  }
  function botonera(acciones) { return '<span class="nvi-ed-bot">' + acciones.map(function(a) { return '<button type="button" data-hacer="' + a[0] + '" title="' + esc(a[2]) + '">' + a[1] + '</button>'; }).join('') + '</span>'; }
  function decorar(lienzo) {
    var pag = lienzo.querySelector('.nvi-pagina');
    if (!E.pag.secciones.length) { var v = h('div', 'nvi-ed-vacio', '<p>La página está vacía.</p><button type="button" class="nvi-b1" data-mas-sec="0">+ Agregar sección</button> <button type="button" class="nvi-b2" data-plantillas="1">Usar una plantilla</button>'); pag.appendChild(v); }
    pag.querySelectorAll('.nvi-sec').forEach(function(secEl, i) {
      var s = secPor(secEl.dataset.sec); if (!s) return;
      secEl.classList.add('nvi-ed-sec'); if (E.sel && E.sel.tipo === 'seccion' && E.sel.id === s.id) secEl.classList.add('sel');
      var bar = h('div', 'nvi-ed-secbar', '<b>' + 'Sección' + '</b>' + botonera([['subir', '↑', 'Subir la sección'], ['bajar', '↓', 'Bajar la sección'], ['dupsec', '⧉', 'Duplicar la sección'], ['ajustes', '⚙', 'Ajustes de la sección'], ['borrarsec', '🗑', 'Eliminar la sección']]));
      bar.setAttribute('data-sec-bar', s.id); secEl.appendChild(bar);
      var mas = h('button', 'nvi-ed-mas', '+'); mas.type = 'button'; mas.title = 'Agregar una sección aquí'; mas.setAttribute('data-mas-sec', i + 1); secEl.appendChild(mas);
      if (i === 0) { var mas0 = h('button', 'nvi-ed-mas arriba', '+'); mas0.type = 'button'; mas0.title = 'Agregar una sección arriba'; mas0.setAttribute('data-mas-sec', 0); secEl.appendChild(mas0); }
      if (s.tipo === 'libre') {
        var inner = secEl.querySelector('.nvi-libre'); inner.classList.add('nvi-ed-libre'); inner.setAttribute('data-libre', s.id);
        anotarAltos(s, inner);
        var asa = h('div', 'nvi-ed-alto', '⇕'); asa.title = 'Arrastra para cambiar el alto de la sección'; asa.setAttribute('data-alto', s.id); inner.appendChild(asa);
      }
    });
    pag.querySelectorAll('.nvi-col').forEach(function(c) {
      c.classList.add('nvi-ed-col');
      if (!c.querySelector('.nvi-blk')) { var z = h('div', 'nvi-ed-zona', '<span>+</span>Arrastra un bloque aquí o haz clic'); z.setAttribute('data-zona', c.dataset.col); c.appendChild(z); }
    });
    pag.querySelectorAll('.nvi-blk').forEach(function(bEl) {
      var r = blkPor(bEl.dataset.blk); if (!r) return;
      bEl.classList.add('nvi-ed-blk'); if (E.sel && E.sel.tipo === 'bloque' && E.sel.id === r.blk.id) bEl.classList.add('sel');
      var acc = r.el ? [['frente', '⬆', 'Traer al frente'], ['atras', '⬇', 'Enviar atrás'], ['dup', '⧉', 'Duplicar'], ['borrar', '🗑', 'Eliminar']]
                     : [['mover', '✥', 'Arrastra para moverlo'], ['dup', '⧉', 'Duplicar'], ['borrar', '🗑', 'Eliminar']];
      var bar = h('div', 'nvi-ed-blkbar', '<b>' + esc((D[r.blk.tipo] || {}).n || r.blk.tipo) + '</b>' + botonera(acc));
      bEl.appendChild(bar);
      var mv = bar.querySelector('[data-hacer="mover"]');
      if (mv) {
        bEl.setAttribute('draggable', 'false');
        mv.setAttribute('draggable', 'true');
        mv.addEventListener('dragstart', function(e) { e.dataTransfer.setData('text/nvi-mover', r.blk.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setDragImage(bEl, 20, 20);
          // la barra con la manija se oculta un instante después: si desaparece en el mismo dragstart, Chrome cancela el arrastre
          mv._t = setTimeout(function() { document.body.classList.add('nvi-arrastrando'); bEl.classList.add('moviendo'); }, 0); });
        mv.addEventListener('dragend', function() { clearTimeout(mv._t); bEl.classList.remove('moviendo'); finArrastre(); });
      }
      if (!r.el) { var rc = h('span', 'nvi-ed-rsz nvi-ed-rsz-col'); rc.title = 'Arrastra para cambiar el ancho y el alto'; bEl.appendChild(rc); }
      if (r.el) { ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach(function(dd) { var rs = h('span', 'nvi-ed-rsz'); rs.setAttribute('data-dir', dd); rs.title = 'Arrastra para cambiar el tamaño' + (dd.length === 2 ? ' (Shift: mantiene la proporción)' : ''); bEl.parentNode.appendChild(rs); }); bEl.parentNode.classList.add('nvi-ed-el'); if (E.sel && E.sel.id === r.blk.id) bEl.parentNode.classList.add('sel'); }
    });
  }

  // ---------- Clics en la página ----------
  function clicLienzo(e) {
    if (E.previa) return;
    var t = e.target;
    var bot = t.closest('[data-hacer]');
    if (bot) { e.preventDefault(); e.stopPropagation(); hacer(bot.dataset.hacer, bot); return; }
    if (t.closest('[data-mas-sec]')) { menuSecciones(t.closest('[data-mas-sec]'), +t.closest('[data-mas-sec]').dataset.masSec); return; }
    if (t.closest('[data-plantillas]')) { abrirPlantillas(false); return; }
    var z = t.closest('[data-zona]'); if (z) { menuBloques(z, function(tipo) { var c = colPor(z.dataset.zona); var b = NVI.nuevoBloque(tipo); c.col.bloques.push(b); E.sel = {tipo: 'bloque', id: b.id}; E.cambio(); }); return; }
    if (t.closest('a')) e.preventDefault();
    if (E.editando && t.closest('[contenteditable=true]')) return;
    var b = t.closest('[data-blk]');
    if (b) { seleccionar({tipo: 'bloque', id: b.dataset.blk}); return; }
    var s = t.closest('[data-sec]');
    if (s) { seleccionar({tipo: 'seccion', id: s.dataset.sec}); return; }
    seleccionar(null);
  }
  function seleccionar(sel) {
    E.sel = sel;
    document.querySelectorAll('#nviLienzo .sel').forEach(function(x) { x.classList.remove('sel'); });
    if (sel && sel.tipo === 'bloque') { var b = document.querySelector('#nviLienzo [data-blk="' + sel.id + '"]'); if (b) { b.classList.add('sel'); if (b.parentNode.classList.contains('nvi-ed-el')) b.parentNode.classList.add('sel'); } }
    if (sel && sel.tipo === 'seccion') { var s = document.querySelector('#nviLienzo [data-sec="' + sel.id + '"]'); if (s) s.classList.add('sel'); }
    pintarProps();
  }
  function hacer(ac, bot) {
    var secId = bot.closest('[data-sec-bar]') ? bot.closest('[data-sec-bar]').dataset.secBar : null;
    if (secId) {
      var i = E.pag.secciones.findIndex(function(s) { return s.id === secId; }), lista = E.pag.secciones;
      if (ac === 'subir' && i > 0) { lista.splice(i - 1, 0, lista.splice(i, 1)[0]); E.cambio(); }
      if (ac === 'bajar' && i < lista.length - 1) { lista.splice(i + 1, 0, lista.splice(i, 1)[0]); E.cambio(); }
      if (ac === 'dupsec') { var c = nuevosIds(NVI.clon(lista[i])); lista.splice(i + 1, 0, c); E.sel = {tipo: 'seccion', id: c.id}; E.cambio(); }
      if (ac === 'ajustes') seleccionar({tipo: 'seccion', id: secId});
      if (ac === 'borrarsec') dialogo('Eliminar sección', '<p>¿Eliminar esta sección y todo lo que tiene? (Puedes deshacer con Ctrl+Z.)</p>', [{t: 'Eliminar', v: 1, p: true}]).then(function(v) { if (v) { lista.splice(i, 1); E.sel = null; E.cambio(); } });
      return;
    }
    var bEl = bot.closest('[data-blk]'), r = bEl && blkPor(bEl.dataset.blk); if (!r) return;
    if (ac === 'dup') { var cp = nuevosIds(NVI.clon(r.el || r.blk)); if (r.el) { cp.x = Math.min(90, cp.x + 3); cp.y += 24; } r.lista.splice(r.i + 1, 0, cp); E.sel = {tipo: 'bloque', id: (cp.bloque || cp).id}; E.cambio(); }
    if (ac === 'borrar') { r.lista.splice(r.i, 1); E.sel = null; E.cambio(); }
    if (ac === 'frente' && r.el) { r.el.z = Math.max.apply(null, r.sec.elementos.map(function(x) { return x.z || 1; })) + 1; E.cambio(); }
    if (ac === 'atras' && r.el) { r.sec.elementos.forEach(function(x) { x.z = (x.z || 1) + 1; }); r.el.z = 1; E.cambio(); }
  }
  function menuFlotante(ancla, html, alClic) {
    cerrarMenu();
    var m = h('div', 'nvi-ed-menu', html); m.id = 'nviMenu'; document.body.appendChild(m);
    var r = ancla.getBoundingClientRect(); m.style.left = Math.max(8, Math.min(window.innerWidth - m.offsetWidth - 8, r.left + r.width / 2 - m.offsetWidth / 2)) + 'px';
    m.style.top = (r.bottom + 6 + m.offsetHeight > window.innerHeight ? Math.max(8, r.top - m.offsetHeight - 6) : r.bottom + 6) + 'px';
    m.onclick = function(e) { var x = e.target.closest('[data-v]'); if (x) { cerrarMenu(); alClic(x.dataset.v); } };
    setTimeout(function() { document.addEventListener('mousedown', fueraMenu, true); }, 0);
  }
  function fueraMenu(e) { var m = document.getElementById('nviMenu'); if (m && !m.contains(e.target)) cerrarMenu(); }
  function cerrarMenu() { var m = document.getElementById('nviMenu'); if (m) m.remove(); document.removeEventListener('mousedown', fueraMenu, true); }
  function menuBloques(ancla, alElegir) {
    menuFlotante(ancla, '<div class="nvi-ed-menu-tit">Agregar bloque</div><div class="nvi-ed-menu-g">' + BLOQUES_ORDEN.map(function(k) { return '<button type="button" data-v="' + k + '"><span>' + D[k].ic + '</span>' + esc(D[k].n) + '</button>'; }).join('') + '</div>', alElegir);
  }
  function menuSecciones(ancla, pos) {
    menuFlotante(ancla, '<div class="nvi-ed-menu-tit">Agregar sección</div><div class="nvi-ed-menu-g sec">' + SECCIONES.map(function(s) {
      return '<button type="button" data-v="' + s[0] + '"><span class="nvi-ed-mini">' + (s[2] ? s[2].map(function(a) { return '<i style="flex:' + a + '"></i>'; }).join('') : '<i class="libre"></i>') + '</span>' + esc(s[1]) + '</button>';
    }).join('') + '</div>', function(v) { agregarSeccion(v, pos); });
  }
  function agregarSeccion(tipo, pos) { var s = NVI.nuevaSeccion(tipo); E.pag.secciones.splice(pos, 0, s); E.sel = {tipo: 'seccion', id: s.id}; E.cambio(); setTimeout(function() { var el = document.querySelector('#nviLienzo [data-sec="' + s.id + '"]'); if (el) el.scrollIntoView({behavior: 'smooth', block: 'center'}); }, 200); }
  function agregarBloqueClic(tipo) {
    // en la columna del bloque/sección elegido; si no, en la última sección de columnas (o en una nueva)
    var b = NVI.nuevoBloque(tipo), sec = null;
    if (E.sel && E.sel.tipo === 'bloque') { var r = blkPor(E.sel.id); if (r) sec = r.sec || null; }
    if (!sec && E.sel && E.sel.tipo === 'seccion') sec = secPor(E.sel.id) || null;
    if (!sec || sec.tipo !== 'libre') sec = E.pag.secciones.filter(function(x) { return x.tipo === 'libre'; }).pop();
    if (!sec) { sec = NVI.nuevaSeccion('libre'); sec.elementos = []; E.pag.secciones.push(sec); }
    // queda debajo del último elemento de la sección, y la sección crece si hace falta
    var inner = document.querySelector('#nviLienzo [data-libre="' + sec.id + '"]'), fondo = 0;
    (sec.elementos || []).forEach(function(el) { var c = inner && inner.querySelector('[data-el="' + el.id + '"]'); fondo = Math.max(fondo, (el.y || 0) + (c ? c.offsetHeight : (+el.h || 60))); });
    sec.elementos.push({id: NVI.uid('e'), x: 5, y: Math.round(fondo ? fondo + 24 : 30), w: tipo === 'titulo' || tipo === 'texto' ? 60 : 50, h: 0, z: 5, bloque: b});
    sec.estilo.alto = Math.max(+sec.estilo.alto || 480, Math.round((fondo ? fondo + 24 : 30) + 320));
    E.sel = {tipo: 'bloque', id: b.id}; E.cambio();
    setTimeout(function() { var el = document.querySelector('#nviLienzo [data-blk="' + b.id + '"]'); if (el) el.scrollIntoView({behavior: 'smooth', block: 'center'}); }, 200);
  }

  // ---------- Arrastrar y soltar bloques ----------
  var ind = null;
  function finArrastre() { document.body.classList.remove('nvi-arrastrando'); if (ind) { ind.remove(); ind = null; } document.querySelectorAll('.nvi-ed-col.sobre, .nvi-ed-libre.sobre').forEach(function(x) { x.classList.remove('sobre'); }); }
  function posicionEnColumna(colEl, y) {
    var hijos = Array.prototype.filter.call(colEl.children, function(x) { return x.classList.contains('nvi-blk'); }), i = hijos.length;
    for (var k = 0; k < hijos.length; k++) { var r = hijos[k].getBoundingClientRect(); if (y < r.top + r.height / 2) { i = k; break; } }
    return {i: i, hijos: hijos};
  }
  function sobreLienzo(e) {
    var tipos = e.dataTransfer.types; if (tipos.indexOf('text/nvi-nuevo') < 0 && tipos.indexOf('text/nvi-mover') < 0) return;
    var colEl = e.target.closest('.nvi-ed-col'), libreEl = e.target.closest('.nvi-ed-libre');
    document.querySelectorAll('.nvi-ed-col.sobre, .nvi-ed-libre.sobre').forEach(function(x) { if (x !== colEl && x !== libreEl) x.classList.remove('sobre'); });
    if (libreEl && tipos.indexOf('text/nvi-nuevo') >= 0) { e.preventDefault(); libreEl.classList.add('sobre'); if (ind) { ind.remove(); ind = null; } return; }
    if (!colEl) { if (ind) { ind.remove(); ind = null; } return; }
    e.preventDefault(); colEl.classList.add('sobre');
    var p = posicionEnColumna(colEl, e.clientY);
    if (!ind) { ind = h('div', 'nvi-ed-ind'); }
    if (p.i < p.hijos.length) colEl.insertBefore(ind, p.hijos[p.i]); else colEl.appendChild(ind);
  }
  function soltarLienzo(e) {
    var nuevo = e.dataTransfer.getData('text/nvi-nuevo'), mover = e.dataTransfer.getData('text/nvi-mover');
    if (!nuevo && !mover) return;
    e.preventDefault();
    var libreEl = e.target.closest('.nvi-ed-libre');
    if (libreEl && nuevo) {
      var s = secPor(libreEl.dataset.libre), r = libreEl.getBoundingClientRect(), b = NVI.nuevoBloque(nuevo);
      s.elementos.push({id: NVI.uid('e'), x: Math.max(0, Math.min(80, Math.round((e.clientX - r.left) / r.width * 1000) / 10)), y: Math.max(0, Math.round((e.clientY - r.top) / escalaDe(libreEl))), w: 35, h: 0, z: 10, bloque: b});
      crecerSeccion(s, libreEl);
      E.sel = {tipo: 'bloque', id: b.id}; finArrastre(); E.cambio(); return;
    }
    var colEl = e.target.closest('.nvi-ed-col'); if (!colEl) { finArrastre(); return; }
    var c = colPor(colEl.dataset.col), p = posicionEnColumna(colEl, e.clientY), idx = p.i;
    if (nuevo) { var nb = NVI.nuevoBloque(nuevo); c.col.bloques.splice(idx, 0, nb); E.sel = {tipo: 'bloque', id: nb.id}; }
    else {
      var o = blkPor(mover); if (!o || !o.col) { finArrastre(); return; }
      if (o.col === c.col && o.i < idx) idx--;
      o.lista.splice(o.i, 1); c.col.bloques.splice(idx, 0, o.blk); E.sel = {tipo: 'bloque', id: o.blk.id};
    }
    finArrastre(); E.cambio();
  }

  // Tamaño de un bloque en columnas: se arrastra la esquina de abajo a la derecha
  function refrescarBloque(bEl, blk) {
    var nb = NVI.bloque(blk, {modo: 'editar'}), viejo = null;
    Array.prototype.forEach.call(bEl.children, function(x) { if (!viejo && !x.classList.contains('nvi-ed-blkbar') && !x.classList.contains('nvi-ed-rsz') && !x.classList.contains('nvi-ed-medida')) viejo = x; });
    var clases = bEl.className; bEl.style.cssText = nb.style.cssText; bEl.className = clases;
    if (viejo && nb.firstElementChild) bEl.replaceChild(nb.firstElementChild, viejo);
  }
  function medida(bEl, txt) { var m = bEl.querySelector('.nvi-ed-medida'); if (!m) { m = h('span', 'nvi-ed-medida'); bEl.appendChild(m); } m.textContent = txt; }
  function tamanoCol(e, rz) {
    e.preventDefault(); e.stopPropagation();
    var bEl = rz.closest('[data-blk]'), r = bEl && blkPor(bEl.dataset.blk); if (!r) return;
    if (!(E.sel && E.sel.id === r.blk.id)) { E.sel = {tipo: 'bloque', id: r.blk.id}; document.querySelectorAll('#nviLienzo .nvi-ed-blk.sel').forEach(function(x) { x.classList.remove('sel'); }); bEl.classList.add('sel'); pintarProps(); }
    var col = bEl.parentNode, cw = col.getBoundingClientRect().width || 1, R = bEl.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY;
    var p = r.blk.p || {}, h0 = (r.blk.tipo === 'carrusel' || r.blk.tipo === 'embed' || r.blk.tipo === 'espacio') ? (+p.alto || R.height) : r.blk.tipo === 'imagen' ? ((bEl.querySelector('img') || bEl).getBoundingClientRect().height) : R.height;
    var w0 = r.blk.tipo === 'imagen' ? (+p.ancho || 100) : R.width / cw * 100, ref = {h: h0, galAlto: +p.alto || 200}, movio = false, raf = 0;
    arrastre(function(ev) {
      var dx = ev.clientX - x0, dy = ev.clientY - y0; if (!movio && Math.abs(dx) + Math.abs(dy) < 3) return; movio = true;
      var w = Math.abs(dx) > 3 ? Math.max(10, Math.min(100, Math.round(w0 + dx / cw * 100))) : null, hh = Math.abs(dy) > 3 ? Math.max(40, Math.round(h0 + dy)) : null;
      NVI.tamanoBloque(r.blk, w, hh, ref);
      if (!raf) raf = requestAnimationFrame(function() { raf = 0; refrescarBloque(bEl, r.blk); medida(bEl, (w != null ? w : Math.round(w0)) + '% × ' + (hh != null ? hh : Math.round(h0)) + ' px'); });
    }, function() { if (movio) E.cambio(); });
  }
  // ---------- Posición libre: mover, cambiar tamaño (8 agarraderas) y alto de la sección ----------
  // La sección libre se diseña a un ancho fijo y se reduce en pantallas más chicas: escala = ancho en pantalla / ancho real
  function escalaDe(inner) { var w = inner.offsetWidth; return w ? inner.getBoundingClientRect().width / w : 1; }
  // si un elemento queda más abajo que el borde de su sección, la sección crece
  function crecerSeccion(s, inner) {
    var fondo = 0;
    (s.elementos || []).forEach(function(el) { var c = inner && inner.querySelector('[data-el="' + el.id + '"]'); fondo = Math.max(fondo, (el.y || 0) + (c ? c.offsetHeight : (+el.h || 60))); });
    if (fondo + 24 > (+s.estilo.alto || 480)) s.estilo.alto = Math.round(fondo + 24);
  }
  function mouseLibre(e) {
    if (E.previa || e.button !== 0) return;
    var rzc = e.target.closest('.nvi-ed-rsz-col'); if (rzc) { tamanoCol(e, rzc); return; }
    var alto = e.target.closest('[data-alto]');
    if (alto) {
      e.preventDefault(); var s = secPor(alto.dataset.alto), inner = alto.parentNode, y0 = e.clientY, a0 = inner.offsetHeight, k = escalaDe(inner), cen = document.getElementById('nviCentro'), sc0 = cen.scrollTop;
      arrastre(function(ev) { var v = Math.max(120, Math.round(a0 + (ev.clientY - y0 + cen.scrollTop - sc0) / k)); inner.style.height = v + 'px'; s.estilo.alto = v; NVI.ajustarLibre(inner); }, function() { E.cambio(); });
      return;
    }
    var elEl = e.target.closest('.nvi-ed-el'); if (!elEl) return;
    if (e.target.closest('.nvi-ed-blkbar') || (E.editando && e.target.closest('[contenteditable=true]'))) return;
    var r = blkPor(elEl.querySelector('[data-blk]').dataset.blk); if (!r || !r.el) return;
    var inner = elEl.parentNode, R = inner.getBoundingClientRect(), k = escalaDe(inner), Wi = inner.offsetWidth || 1;
    var x0 = e.clientX, y0 = e.clientY, o = Object.assign({}, r.el), rsz = e.target.closest('.nvi-ed-rsz'), dir = rsz ? (rsz.getAttribute('data-dir') || 'se') : '';
    if (!rsz && e.detail > 1) return;  // doble clic: editar texto
    e.preventDefault();
    if (!(E.sel && E.sel.id === r.blk.id)) { E.sel = {tipo: 'bloque', id: r.blk.id}; document.querySelectorAll('#nviLienzo .nvi-ed-el.sel, #nviLienzo .nvi-ed-blk.sel').forEach(function(x) { x.classList.remove('sel'); }); elEl.classList.add('sel'); var bk0 = elEl.querySelector('.nvi-ed-blk'); if (bk0) bk0.classList.add('sel'); pintarProps(); }
    var centro = document.getElementById('nviCentro'), sc0 = centro.scrollTop;
    var movio = false, h0 = o.h || elEl.offsetHeight, wpx0 = o.w / 100 * Wi, prop = wpx0 / Math.max(1, h0), ref = {h: h0, galAlto: +(r.blk.p || {}).alto || 200}, secEl = elEl.closest('.nvi-sec'), raf = 0;
    if (!rsz) secEl.classList.add('nvi-ed-fuera');   // mientras se mueve puede salir de su sección (para pasarlo a otra)
    arrastre(function(ev) {
      var dx = ev.clientX - x0, dy = ev.clientY - y0 + (centro.scrollTop - sc0); if (!movio && Math.abs(dx) + Math.abs(dy) < 3) return; movio = true;
      var dxp = dx / R.width * 100, dyp = dy / k;   // horizontal en %, vertical en px reales
      if (rsz) {
        var x = o.x, y = o.y, w = o.w, hh = h0;
        if (dir.indexOf('e') >= 0) w = o.w + dxp;
        if (dir.indexOf('w') >= 0) { w = o.w - dxp; x = o.x + dxp; }
        if (dir.indexOf('s') >= 0) hh = h0 + dyp;
        if (dir.indexOf('n') >= 0) { hh = h0 - dyp; y = o.y + dyp; }
        // Shift en una esquina: mantiene la proporción
        if (ev.shiftKey && dir.length === 2) { var nh = w / 100 * Wi / prop; if (dir.indexOf('n') >= 0) y = o.y + (h0 - nh); hh = nh; }
        if (w < 4) { if (dir.indexOf('w') >= 0) x -= 4 - w; w = 4; }
        if (hh < 30) { if (dir.indexOf('n') >= 0) y -= 30 - hh; hh = 30; }
        r.el.x = Math.round(x * 2) / 2; r.el.w = Math.round(w * 2) / 2; r.el.y = Math.round(y);
        elEl.style.left = r.el.x + '%'; elEl.style.width = r.el.w + '%'; elEl.style.top = r.el.y + 'px';
        // en una esquina el alto solo cambia si de verdad se movió hacia arriba o abajo (si no, queda automático)
        var cambiaAlto = (dir.length === 1 ? (dir === 'n' || dir === 's') : Math.abs(dyp) > 3) || (ev.shiftKey && dir.length === 2);
        if (NVI.ALTO_PROPIO[r.blk.tipo]) {   // el alto lo lleva el propio bloque (así el carrusel o la foto crecen de verdad)
          if (r.blk.tipo === 'imagen') r.blk.p.ancho = 100;
          if (cambiaAlto) NVI.tamanoBloque(r.blk, null, Math.round(hh), ref);
          r.el.h = 0; elEl.style.height = '';
          if (!raf) raf = requestAnimationFrame(function() { raf = 0; var bk = elEl.querySelector('[data-blk]'); if (bk) refrescarBloque(bk, r.blk); });
        } else if (cambiaAlto) { r.el.h = Math.round(hh); elEl.style.height = r.el.h + 'px'; }
        medida(elEl, Math.round(r.el.w / 100 * Wi) + ' × ' + Math.round(cambiaAlto ? hh : elEl.offsetHeight) + ' px');
      } else {
        // movimiento libre: solo se evita que se pierda del todo por los lados
        r.el.x = Math.max(-o.w + 5, Math.min(95, Math.round((o.x + dxp) * 2) / 2));
        r.el.y = Math.max(-60, Math.round(o.y + dyp));
        elEl.style.left = r.el.x + '%'; elEl.style.top = r.el.y + 'px';
      }
    }, function(ev) {
      secEl.classList.remove('nvi-ed-fuera');
      if (!movio) return;
      if (!rsz && ev) pasarASeccion(r, elEl, ev, x0, y0);
      var s2 = blkPor(r.blk.id); if (s2 && s2.sec) crecerSeccion(s2.sec, document.querySelector('#nviLienzo [data-libre="' + s2.sec.id + '"]'));
      E.cambio();
    });
  }
  // Soltar un elemento sobre otra sección: se muda a esa sección en el punto donde se soltó
  function pasarASeccion(r, elEl, ev, x0, y0) {
    var destino = null;
    (document.elementsFromPoint ? document.elementsFromPoint(ev.clientX, ev.clientY) : []).some(function(x) { var l = x.closest && x.closest('.nvi-ed-libre'); if (l && l !== elEl.parentNode && !elEl.contains(l)) { destino = l; return true; } return false; });
    if (!destino) return;
    var s2 = secPor(destino.dataset.libre); if (!s2 || s2 === r.sec) return;
    var R2 = destino.getBoundingClientRect(), k2 = escalaDe(destino), er = elEl.getBoundingClientRect();
    var i = r.sec.elementos.indexOf(r.el); if (i < 0) return;
    r.sec.elementos.splice(i, 1);
    r.el.x = Math.max(-r.el.w + 5, Math.min(95, Math.round((er.left - R2.left) / R2.width * 200) / 2));
    r.el.y = Math.max(0, Math.round((er.top - R2.top) / k2));
    s2.elementos = s2.elementos || []; s2.elementos.push(r.el);
    crecerSeccion(s2, destino);
  }
  // Arrastre con el mouse. Si el puntero se acerca al borde de arriba o de abajo del lienzo, este se desplaza solo
  // (así se puede llevar un elemento a una sección que no se ve) y el elemento sigue al mouse.
  function arrastre(mover, soltar) {
    var centro = document.getElementById('nviCentro'), ultimo = null;
    var mov = function(ev) { ultimo = ev; mover(ev); };
    var t = setInterval(function() {
      if (!ultimo || !centro) return;
      var r = centro.getBoundingClientRect(), v = 0, m = 60;
      if (ultimo.clientY > r.bottom - m) v = Math.min(m, ultimo.clientY - (r.bottom - m)); else if (ultimo.clientY < r.top + m) v = -Math.min(m, (r.top + m) - ultimo.clientY);
      if (!v) return;
      var antes = centro.scrollTop; centro.scrollTop += Math.round(v / 2.5); if (centro.scrollTop !== antes) mover(ultimo);
    }, 16);
    var up = function(ev) { clearInterval(t); document.removeEventListener('mousemove', mov); document.removeEventListener('mouseup', up); document.body.classList.remove('nvi-arrastrando-mouse'); soltar(ev); };
    document.body.classList.add('nvi-arrastrando-mouse');
    document.addEventListener('mousemove', mov); document.addEventListener('mouseup', up);
  }

  // ---------- Escribir texto en el lugar ----------
  function dobleClic(e) {
    if (E.previa) return;
    var rich = e.target.closest('.nvi-rich'); if (!rich) return;
    var bEl = rich.closest('[data-blk]'), r = blkPor(bEl.dataset.blk); if (!r || (r.blk.tipo !== 'titulo' && r.blk.tipo !== 'texto')) return;
    e.preventDefault();
    E.editando = r.blk.id; seleccionar({tipo: 'bloque', id: r.blk.id});
    rich.contentEditable = 'true'; rich.classList.add('nvi-ed-escribiendo'); rich.focus();
    var rg = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
    if (rg && rich.contains(rg.startContainer)) { var s = getSelection(); s.removeAllRanges(); s.addRange(rg); }
    var barra = barraTexto(rich);
    var terminar = function() {
      rich.removeEventListener('blur', alSalir); barra.remove(); rich.contentEditable = 'false';
      var nuevo = NVI.limpiar(rich.innerHTML);
      E.editando = null;
      if (nuevo !== r.blk.p.html) { r.blk.p.html = nuevo; E.cambio(); } else E.pintar();
    };
    var alSalir = function() { setTimeout(function() { if (document.activeElement && barra.contains(document.activeElement)) return; if (E.editando === r.blk.id) terminar(); }, 120); };
    rich.addEventListener('blur', alSalir);
    rich.addEventListener('keydown', function(ev) { if (ev.key === 'Escape') { ev.preventDefault(); rich.blur(); } });
  }
  function barraTexto(rich) {
    var b = h('div', 'nvi-ed-tbar');
    b.innerHTML = [['bold', '<b>N</b>', 'Negrita (Ctrl+B)'], ['italic', '<i>K</i>', 'Cursiva (Ctrl+I)'], ['underline', '<u>S</u>', 'Subrayado'], ['strikeThrough', '<s>T</s>', 'Tachado'],
      ['insertUnorderedList', '•≡', 'Viñetas'], ['insertOrderedList', '1≡', 'Numeración'], ['link', '🔗', 'Enlace'], ['color', '<span style="border-bottom:3px solid #e11d48">A</span>', 'Color del texto'],
      ['mas', 'A+', 'Texto más grande'], ['menos', 'A−', 'Texto más pequeño'], ['removeFormat', '⌫', 'Quitar formato'], ['listo', 'Listo', 'Terminar de escribir']].map(function(x) {
        return '<button type="button" data-cmd="' + x[0] + '" title="' + x[2] + '">' + x[1] + '</button>';
      }).join('') + '<input type="color" data-color hidden>';
    document.body.appendChild(b);
    var r = rich.getBoundingClientRect(); b.style.left = Math.max(8, Math.min(window.innerWidth - b.offsetWidth - 8, r.left)) + 'px'; b.style.top = Math.max(60, r.top - b.offsetHeight - 8) + 'px';
    var guardada = null;
    b.addEventListener('mousedown', function(e) { var s = getSelection(); if (s.rangeCount) guardada = s.getRangeAt(0).cloneRange(); if (!e.target.closest('input')) e.preventDefault(); });
    var volver = function() { rich.focus(); if (guardada) { var s = getSelection(); s.removeAllRanges(); s.addRange(guardada); } };
    var tam = function(k) { volver(); document.execCommand('styleWithCSS', false, true); var s = getSelection(); if (!s.rangeCount || s.isCollapsed) return; var px = parseFloat(getComputedStyle(s.anchorNode.nodeType === 3 ? s.anchorNode.parentNode : s.anchorNode).fontSize) || 16;
      document.execCommand('fontSize', false, '7'); rich.querySelectorAll('font[size="7"]').forEach(function(f) { var sp = document.createElement('span'); sp.style.fontSize = Math.round(px * k) + 'px'; sp.innerHTML = f.innerHTML; f.replaceWith(sp); }); };
    b.onclick = function(e) {
      var x = e.target.closest('[data-cmd]'); if (!x) return; var c = x.dataset.cmd;
      if (c === 'listo') { rich.blur(); return; }
      if (c === 'link') { var u = prompt('Dirección del enlace (https://… o /design…):', 'https://'); volver(); if (u) document.execCommand('createLink', false, NVI.url(u)); return; }
      if (c === 'color') { var ci = b.querySelector('[data-color]'); ci.onchange = function() { volver(); document.execCommand('styleWithCSS', false, true); document.execCommand('foreColor', false, ci.value); }; ci.click(); return; }
      if (c === 'mas') return tam(1.2);
      if (c === 'menos') return tam(0.84);
      volver(); document.execCommand(c, false, null);
    };
    return b;
  }

  // ---------- Panel de propiedades ----------
  function pintarProps() {
    var p = document.getElementById('nviProps'); if (!p) return;
    var sel = E.sel, cuerpo = h('div', 'nvi-ed-props');
    if (sel && sel.tipo === 'tema') {
      E.pag.tema = Object.assign({}, NVI.TEMA_BASE, E.pag.tema || {});
      cuerpo.appendChild(h('h3', '', 'Estilo de la página'));
      cuerpo.appendChild(h('p', 'nvi-ed-ayuda', 'Colores y letras de toda la página. Los bloques pueden tener su propio color.'));
      formulario(cuerpo, [{tipo: 'select', k: 'fuenteTitulos', l: 'Letra de los títulos', ops: NVI.FUENTES.map(function(f) { return [f, f]; })}, {tipo: 'select', k: 'fuenteTexto', l: 'Letra del texto', ops: NVI.FUENTES.map(function(f) { return [f, f]; })},
        {tipo: 'color', k: 'primario', l: 'Color principal (botones, enlaces)'}, {tipo: 'color', k: 'secundario', l: 'Color secundario'}, {tipo: 'color', k: 'acento', l: 'Color de acento'},
        {tipo: 'color', k: 'fondo', l: 'Fondo de la página'}, {tipo: 'color', k: 'texto', l: 'Color del texto'}, {tipo: 'numero', k: 'radio', l: 'Redondeo de esquinas (px)', min: 0, max: 40},
        {tipo: 'select', k: 'alAbrir', l: 'Celebración al abrir la página', ops: [['', 'Ninguna'], ['confeti', '🎉 Lluvia de confeti'], ['globos', '🎈 Globos que suben'], ['fuegos', '🎆 Fuegos artificiales'], ['fiesta', '✨ Fiesta: confeti y globos']]},
        {tipo: 'nota', l: 'Cada persona la ve una vez al entrar (por sesión). Pruébala con Vista previa.'}], E.pag.tema);
    } else if (sel && sel.tipo === 'bloque' && blkPor(sel.id)) {
      var r = blkPor(sel.id), def = D[r.blk.tipo];
      cuerpo.appendChild(h('h3', '', '<span class="nvi-ed-ic">' + def.ic + '</span> ' + esc(def.n)));
      if (r.blk.tipo === 'titulo' || r.blk.tipo === 'texto') cuerpo.appendChild(h('p', 'nvi-ed-ayuda', 'Doble clic en el texto de la página para escribir y darle formato.'));
      formulario(cuerpo, def.campos, r.blk.p);
      if (r.el) {
        var pos = h('details', 'nvi-ed-det'); pos.open = true; pos.innerHTML = '<summary>Posición y tamaño</summary>'; cuerpo.appendChild(pos);
        formulario(pos, [{tipo: 'numero', k: 'x', l: 'Desde la izquierda (%)', min: -10, max: 100, paso: 0.5}, {tipo: 'numero', k: 'y', l: 'Desde arriba (px)', min: -40, max: 3000}, {tipo: 'numero', k: 'w', l: 'Ancho (%)', min: 4, max: 100, paso: 0.5}, {tipo: 'numero', k: 'h', l: 'Alto (px, 0 = automático)', min: 0, max: 3000}, {tipo: 'numero', k: 'z', l: 'Capa (más alto = adelante)', min: 1, max: 99}], r.el);
      }
      var caja = h('details', 'nvi-ed-det'); caja.innerHTML = '<summary>Caja y animación</summary>'; cuerpo.appendChild(caja);
      r.blk.estilo = r.blk.estilo || {}; formulario(caja, NVI.CAMPOS_CAJA, r.blk.estilo);
      var acc = h('div', 'nvi-ed-acc', '<button type="button" class="nvi-b2" data-p="dup">⧉ Duplicar</button><button type="button" class="nvi-b2 rojo" data-p="borrar">🗑 Eliminar</button>');
      acc.onclick = function(e) { var x = e.target.closest('[data-p]'); if (!x) return; if (x.dataset.p === 'borrar') { r.lista.splice(r.i, 1); E.sel = null; E.cambio(); } else { var cp = nuevosIds(NVI.clon(r.el || r.blk)); if (r.el) { cp.x = Math.min(90, cp.x + 3); cp.y += 24; } r.lista.splice(r.i + 1, 0, cp); E.sel = {tipo: 'bloque', id: (cp.bloque || cp).id}; E.cambio(); } };
      cuerpo.appendChild(acc);
    } else if (sel && sel.tipo === 'seccion' && secPor(sel.id)) {
      var s = secPor(sel.id); s.estilo = Object.assign(NVI.estiloSeccion(), s.estilo || {});
      cuerpo.appendChild(h('h3', '', s.tipo === 'libre' ? '▢ Sección libre' : '▤ Sección'));
      if (s.tipo !== 'libre') {
        var cols = h('div', 'nvi-ed-cols'); cols.innerHTML = '<label class="nvi-ed-l">Columnas</label><div class="nvi-ed-presets">' + SECCIONES.filter(function(x) { return x[2]; }).map(function(x) {
          return '<button type="button" data-preset="' + x[2].join(',') + '" title="' + esc(x[1]) + '" class="' + (x[2].join(',') === s.columnas.map(function(c) { return c.ancho; }).join(',') ? 'on' : '') + '"><span class="nvi-ed-mini">' + x[2].map(function(a) { return '<i style="flex:' + a + '"></i>'; }).join('') + '</span></button>';
        }).join('') + '</div><p class="nvi-ed-ayuda">Ancho de cada columna (de 12):</p>' + s.columnas.map(function(c, i) {
          return '<div class="nvi-ed-colfila">Columna ' + (i + 1) + ' <input type="number" min="1" max="12" value="' + c.ancho + '" data-ancho="' + i + '"> <button type="button" class="nvi-b2" data-quitar-col="' + i + '" title="Quitar columna (sus bloques pasan a la anterior)"' + (s.columnas.length < 2 ? ' disabled' : '') + '>✕</button></div>';
        }).join('') + '<button type="button" class="nvi-b2" data-add-col="1"' + (s.columnas.length >= 6 ? ' disabled' : '') + '>+ Agregar columna</button>';
        cols.onclick = function(e) {
          var pr = e.target.closest('[data-preset]');
          if (pr) { var an = pr.dataset.preset.split(',').map(Number); while (s.columnas.length < an.length) s.columnas.push({id: NVI.uid('c'), ancho: 12, bloques: []}); while (s.columnas.length > an.length) { var q = s.columnas.pop(); s.columnas[s.columnas.length - 1].bloques = s.columnas[s.columnas.length - 1].bloques.concat(q.bloques); } s.columnas.forEach(function(c, i) { c.ancho = an[i]; }); E.cambio(); }
          var qc = e.target.closest('[data-quitar-col]'); if (qc && s.columnas.length > 1) { var i = +qc.dataset.quitarCol, ql = s.columnas.splice(i, 1)[0]; s.columnas[Math.max(0, i - 1)].bloques = s.columnas[Math.max(0, i - 1)].bloques.concat(ql.bloques); E.cambio(); }
          if (e.target.closest('[data-add-col]')) { s.columnas.push({id: NVI.uid('c'), ancho: Math.max(1, Math.floor(12 / (s.columnas.length + 1))), bloques: []}); E.cambio(); }
        };
        cols.onchange = function(e) { var a = e.target.closest('[data-ancho]'); if (a) { s.columnas[+a.dataset.ancho].ancho = Math.max(1, Math.min(12, +a.value || 12)); E.cambio(); } };
        cuerpo.appendChild(cols);
      } else cuerpo.appendChild(h('p', 'nvi-ed-ayuda', 'Arrastra los elementos con el mouse a donde quieras, incluso a otra sección. Las esquinas y los lados cambian su tamaño (con Shift en una esquina se mantiene la proporción). El alto de la sección se cambia con la manija ⇕ de abajo; también crece sola si bajas un elemento. En celulares los elementos se acomodan uno debajo del otro.'));
      formulario(cuerpo, NVI.CAMPOS_SECCION.filter(function(c) { return !(s.tipo === 'libre' && (c.k === 'espacio' || c.k === 'alinearV')); }).map(function(c) { return c.k === 'alto' && s.tipo === 'libre' ? Object.assign({}, c, {l: 'Alto de la sección (px)', min: 120}) : c; }), s.estilo);
    } else {
      cuerpo.appendChild(h('h3', '', 'Inicio de Design'));
      cuerpo.appendChild(h('div', 'nvi-ed-ayuda', '<p><b>Cómo funciona</b></p><ol><li>Arrastra bloques desde la izquierda y suéltalos donde quieras (o haz clic para agregarlos).</li><li>Mueve cualquier elemento arrastrándolo, incluso a otra sección. Cambia su tamaño desde las esquinas o los lados (con Shift mantiene la proporción).</li><li>Haz clic en un elemento para cambiarlo aquí.</li><li>Doble clic en títulos y textos para escribir.</li><li>Con <b>+</b> entre secciones agregas otra sección.</li><li>Todo se guarda solo como borrador; nadie lo ve hasta que le das <b>Publicar</b>.</li></ol>'));
      var bt = h('button', 'nvi-b2', '🎨 Estilo de la página'); bt.type = 'button'; bt.onclick = function() { E.sel = {tipo: 'tema'}; pintarProps(); }; cuerpo.appendChild(bt);
    }
    var y = p.scrollTop; p.innerHTML = ''; p.appendChild(cuerpo); p.scrollTop = y;
  }
  function formulario(cont, campos, obj) {
    (campos || []).forEach(function(c) {
      if (c.si && c.si[1].indexOf(obj[c.si[0]] == null ? '' : obj[c.si[0]]) < 0) return;
      cont.appendChild(campo(c, obj, function(redibujarPanel) { E.cambio(); if (redibujarPanel) setTimeout(pintarProps, 0); }));
    });
  }
  function campo(c, obj, cambio) {
    var w = h('div', 'nvi-ed-campo nvi-ed-c-' + c.tipo), id = NVI.uid('f');
    var lbl = function() { return '<label class="nvi-ed-l" for="' + id + '">' + esc(c.l) + '</label>'; };
    var v = obj[c.k];
    var dependen = NVI.CAMPOS_SECCION.some(function(x) { return x.si && x.si[0] === c.k; });
    if (c.tipo === 'nota') { w.innerHTML = '<p class="nvi-ed-ayuda">' + esc(c.l) + '</p>'; return w; }
    if (c.tipo === 'texto' || c.tipo === 'url') {
      w.innerHTML = lbl() + '<input type="text" id="' + id + '"' + (c.tipo === 'url' ? ' placeholder="https://… o /design…"' : '') + '>'; var i = w.querySelector('input'); i.value = v == null ? '' : v;
      i.oninput = function() { obj[c.k] = i.value; cambio(); };
    } else if (c.tipo === 'area') {
      w.innerHTML = lbl() + '<textarea id="' + id + '" rows="3"></textarea>'; var ta = w.querySelector('textarea'); ta.value = v || ''; ta.oninput = function() { obj[c.k] = ta.value; cambio(); };
    } else if (c.tipo === 'numero') {
      w.innerHTML = lbl() + '<input type="number" id="' + id + '"' + (c.min != null ? ' min="' + c.min + '"' : '') + (c.max != null ? ' max="' + c.max + '"' : '') + ' step="' + (c.paso || 1) + '">'; var n = w.querySelector('input'); n.value = v == null ? '' : v;
      n.oninput = function() { var x = parseFloat(n.value); obj[c.k] = isNaN(x) ? 0 : x; cambio(); };
    } else if (c.tipo === 'rango') {
      w.innerHTML = lbl() + '<div class="nvi-ed-rango"><input type="range" id="' + id + '" min="' + c.min + '" max="' + c.max + '"><span></span></div>'; var rg = w.querySelector('input'), sp = w.querySelector('span');
      rg.value = v == null ? c.min : v; sp.textContent = rg.value; rg.oninput = function() { obj[c.k] = +rg.value; sp.textContent = rg.value; cambio(); };
    } else if (c.tipo === 'select') {
      w.innerHTML = lbl() + '<select id="' + id + '">' + c.ops.map(function(o) { return '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>'; }).join('') + '</select>'; var s = w.querySelector('select'); s.value = v == null ? c.ops[0][0] : v;
      s.onchange = function() { obj[c.k] = s.value; cambio(dependen || c.k === 'fondoTipo'); };
    } else if (c.tipo === 'check') {
      w.innerHTML = '<label class="nvi-ed-chk"><input type="checkbox" id="' + id + '"> ' + esc(c.l) + '</label>'; var k = w.querySelector('input'); k.checked = !!v; k.onchange = function() { obj[c.k] = k.checked; cambio(); };
    } else if (c.tipo === 'color') {
      w.innerHTML = lbl() + '<div class="nvi-ed-color"><input type="color" id="' + id + '"><input type="text" maxlength="30" placeholder="automático"><button type="button" title="Quitar el color (automático)">✕</button></div>';
      var ci = w.querySelector('input[type=color]'), ct = w.querySelector('input[type=text]'), cx = w.querySelector('button');
      var pon = function(x) { ct.value = x || ''; if (/^#[0-9a-f]{6}$/i.test(x || '')) ci.value = x; };
      pon(v); ci.oninput = function() { obj[c.k] = ci.value; ct.value = ci.value; cambio(); }; ct.onchange = function() { obj[c.k] = ct.value.trim(); pon(obj[c.k]); cambio(); }; cx.onclick = function() { obj[c.k] = ''; pon(''); cambio(); };
    } else if (c.tipo === 'fecha') {
      w.innerHTML = lbl() + '<input type="datetime-local" id="' + id + '">'; var f = w.querySelector('input'); f.value = v || ''; f.onchange = function() { obj[c.k] = f.value; cambio(); };
    } else if (c.tipo === 'medio') {
      w.innerHTML = lbl() + '<div class="nvi-ed-medio"><div class="nvi-ed-medio-prev"></div><div class="nvi-ed-medio-acc"><button type="button" class="nvi-b2" data-m="elegir">Elegir…</button>' + (c.encuadre ? '<button type="button" class="nvi-b2" data-m="ajustar" title="Elige qué parte de la foto se ve y cuánto se acerca">✥ Ajustar</button>' : '') + '<button type="button" class="nvi-b2" data-m="quitar">Quitar</button></div></div>' +
        (c.permiteUrl || c.acepta === 'imagen' ? '<input type="text" class="nvi-ed-medio-url" placeholder="' + (c.acepta === 'video' ? 'o pega el enlace (YouTube, Vimeo, WorkDrive…)' : 'o pega la dirección https de la imagen') + '">' : '');
      var prev = w.querySelector('.nvi-ed-medio-prev'), uin = w.querySelector('.nvi-ed-medio-url');
      var pintar = function() {
        var val = obj[c.k] || '', src = NVI.src(val);
        if (!val) prev.innerHTML = '<span>Sin ' + (c.acepta === 'video' ? 'video' : 'imagen') + '</span>';
        else if (c.acepta === 'video' && !/^medio:/.test(val)) prev.innerHTML = '<span>🔗 ' + esc(val.slice(0, 40)) + '</span>';
        else if (c.acepta === 'video') prev.innerHTML = '<span>🎬 Video subido</span>';
        else prev.innerHTML = '<img src="' + esc(src || val) + '" alt="">';
        if (uin) uin.value = /^(medio:|data:)/.test(val) ? '' : val;
        var aj = w.querySelector('[data-m=ajustar]'); if (aj) aj.hidden = !val;
      };
      pintar();
      w.querySelector('[data-m=elegir]').onclick = function() { E.biblioteca(c.acepta, function(val) { obj[c.k] = val; delete obj[c.k + 'Enc']; pintar(); cambio(); }); };
      w.querySelector('[data-m=quitar]').onclick = function() { obj[c.k] = ''; delete obj[c.k + 'Enc']; pintar(); cambio(); };
      if (c.encuadre) w.querySelector('[data-m=ajustar]').onclick = function() { ajustarFoto(obj, c.k, cambio); };
      if (uin) uin.onchange = function() { var u = uin.value.trim(); if (u && !/^https:\/\//.test(u) && !/youtu|vimeo/.test(u)) { aviso('La dirección debe empezar por https://', true); return; } obj[c.k] = u; pintar(); cambio(); };
    } else if (c.tipo === 'lista') {
      var lista = obj[c.k] = obj[c.k] || [];
      w.innerHTML = '<label class="nvi-ed-l">' + esc(c.l) + ' (' + lista.length + ')</label>';
      lista.forEach(function(it, i) {
        var d = h('details', 'nvi-ed-item-lista'); d.open = ABIERTOS.has(it) || !!it._abierto; delete it._abierto;
        var tit = it[c.titulo] || (c.l.replace(/s$/, '') + ' ' + (i + 1));
        d.innerHTML = '<summary><span>' + esc(String(tit).slice(0, 40)) + '</span><span class="nvi-ed-mini-acc"><button type="button" data-l="arriba" title="Subir">↑</button><button type="button" data-l="abajo" title="Bajar">↓</button><button type="button" data-l="dup" title="Duplicar">⧉</button><button type="button" data-l="borrar" title="Eliminar">✕</button></span></summary>';
        d.addEventListener('toggle', function() { if (d.open) ABIERTOS.add(it); else ABIERTOS.delete(it); });
        var cuerpoI = h('div', 'nvi-ed-item-c'); d.appendChild(cuerpoI);
        (c.campos || []).forEach(function(sc) { cuerpoI.appendChild(campo(sc, it, function(redib) { if (sc.k === c.titulo) d.querySelector('summary span').textContent = String(it[c.titulo] || '').slice(0, 40); cambio(redib); })); });
        d.querySelector('.nvi-ed-mini-acc').onclick = function(e) {
          var x = e.target.closest('[data-l]'); if (!x) return; e.preventDefault();
          if (x.dataset.l === 'arriba' && i > 0) lista.splice(i - 1, 0, lista.splice(i, 1)[0]);
          if (x.dataset.l === 'abajo' && i < lista.length - 1) lista.splice(i + 1, 0, lista.splice(i, 1)[0]);
          if (x.dataset.l === 'dup') lista.splice(i + 1, 0, NVI.clon(it));
          if (x.dataset.l === 'borrar') lista.splice(i, 1);
          cambio(true);
        };
        w.appendChild(d);
      });
      var add = h('button', 'nvi-b2 nvi-ed-add', '+ Agregar'); add.type = 'button'; add.onclick = function() { var n = NVI.clon(c.nuevo || {}); ABIERTOS.add(n); lista.push(n); cambio(true); }; w.appendChild(add);
      // varias fotos de una vez (carrusel y galería): se marcan en la biblioteca o se suben juntas
      if (c.masivo) { var addV = h('button', 'nvi-b2 nvi-ed-add nvi-ed-add-varias', '🖼 Agregar varias fotos'); addV.type = 'button';
        addV.onclick = function() { E.biblioteca('imagen', function(vals) { (vals || []).forEach(function(v) { var n = NVI.clon(c.nuevo || {}); n[c.masivo] = v; lista.push(n); }); if (vals && vals.length) { cambio(true); aviso(vals.length === 1 ? 'Se agregó 1 foto.' : 'Se agregaron ' + vals.length + ' fotos.'); } }, {varios: true}); };
        w.appendChild(addV); }
    }
    return w;
  }
  // _abierto solo sirve en el panel: no se guarda
  var guardarOrig = JSON.stringify;
  E.limpiarTemp = function(o) { return JSON.parse(guardarOrig(o, function(k, v) { return k === '_abierto' ? undefined : v; })); };

  // ---------- Biblioteca de medios ----------
  E.biblioteca = function(acepta, alElegir, opc) {
    opc = opc || {}; var varios = !!(opc.varios && alElegir), marcadas = [];
    var bg = h('div', 'nvi-dlg-bg'), d = h('div', 'nvi-dlg nvi-ed-bib'); bg.appendChild(d);
    d.innerHTML = '<h3>Biblioteca de medios</h3><div class="nvi-ed-bib-barra"><button type="button" class="nvi-b1" data-b="subir">⬆ Subir ' + (acepta === 'video' ? 'video (MP4, WEBM, MOV u OGG, hasta 100 MB)' : acepta === 'imagen' ? 'imágenes' : 'imágenes o videos') + '</button>' +
      '<span class="nvi-ed-bib-prog"></span><span style="flex:1"></span>' + (varios ? '<button type="button" class="nvi-b1" data-b="usar" disabled>Agregar las marcadas</button>' : '') + '<button type="button" class="nvi-b2" data-b="cerrar">Cerrar</button></div><p class="nvi-ed-ayuda">' + (varios ? 'Haz clic en las fotos para marcarlas (en el orden que quieras) o sube varias juntas; luego pulsa Agregar.' : alElegir ? 'Haz clic en un archivo para usarlo.' : 'Aquí quedan las imágenes y videos que subes para la página.') + ' Las imágenes grandes se reducen solas para que la página cargue rápido.</p><div class="nvi-ed-bib-grid">Cargando…</div>';
    var grid = d.querySelector('.nvi-ed-bib-grid'), prog = d.querySelector('.nvi-ed-bib-prog');
    // número de orden sobre cada foto marcada
    var pintarMarcas = function() {
      if (!varios) return;
      grid.querySelectorAll('.nvi-ed-bib-item').forEach(function(c) { var k = marcadas.indexOf(+c.getAttribute('data-id')); c.classList.toggle('marcada', k >= 0); var b = c.querySelector('.marca'); if (!b) { b = h('span', 'marca'); c.appendChild(b); } b.textContent = k >= 0 ? k + 1 : ''; });
      var u = d.querySelector('[data-b=usar]'); u.disabled = !marcadas.length; u.textContent = marcadas.length ? 'Agregar ' + marcadas.length + (marcadas.length === 1 ? ' foto' : ' fotos') : 'Agregar las marcadas';
    };
    var cargarL = function() {
      api('/design/api/inicio/medios').then(function(l) {
        l = l.filter(function(m) { return !acepta || acepta === 'ambos' || m.tipo === acepta; });
        grid.innerHTML = l.length ? '' : '<p class="nvi-ed-ayuda">Todavía no hay archivos. Sube el primero.</p>';
        l.forEach(function(m) {
          var c = h('div', 'nvi-ed-bib-item'); c.title = m.nombre;
          c.innerHTML = (m.tipo === 'video' ? '<video src="' + m.url + '#t=0.5" muted preload="metadata"></video><span class="tipo">🎬</span>' : '<img src="' + m.url + '" alt="" loading="lazy">') +
            '<div class="nom">' + esc(m.nombre) + '<small>' + (m.tamano / 1048576).toFixed(1) + ' MB</small></div><button type="button" class="borrar" title="Eliminar de la biblioteca">🗑</button>';
          c.querySelector('.borrar').onclick = function(e) { e.stopPropagation(); if (!confirm('¿Eliminar "' + m.nombre + '" de la biblioteca? Si la página lo usa, dejará de verse.')) return; api('/design/api/inicio/medios/' + m.id + '/eliminar', {}).then(cargarL).catch(function(er) { aviso(er.message, true); }); };
          c.setAttribute('data-id', m.id);
          c.onclick = function() { if (varios) { var k = marcadas.indexOf(m.id); if (k >= 0) marcadas.splice(k, 1); else marcadas.push(m.id); pintarMarcas(); } else if (alElegir) { bg.remove(); alElegir('medio:' + m.id); } else NVI.lightbox([{src: m.url, titulo: m.nombre}], 0); };
          grid.appendChild(c);
        });
        pintarMarcas();
      }).catch(function(e) { grid.textContent = 'No se pudo cargar: ' + e.message; });
    };
    d.onclick = function(e) {
      var b = e.target.closest('[data-b]'); if (!b) return;
      if (b.dataset.b === 'cerrar') bg.remove();
      if (b.dataset.b === 'usar' && marcadas.length) { bg.remove(); alElegir(marcadas.map(function(id) { return 'medio:' + id; })); }
      if (b.dataset.b === 'subir') {
        var i = document.createElement('input'); i.type = 'file'; i.multiple = true; var VID = 'video/mp4,video/webm,video/quicktime,video/ogg,.mp4,.m4v,.webm,.mov,.ogv'; i.accept = acepta === 'video' ? VID : acepta === 'imagen' ? 'image/*' : 'image/*,' + VID;
        i.onchange = function() {
          var fs = Array.prototype.slice.call(i.files), hechos = 0, ultimo = null;
          var sig = function() {
            if (!fs.length) { prog.textContent = hechos ? '✓ ' + hechos + ' archivo(s) subidos' : ''; cargarL(); if (!varios && alElegir && ultimo && hechos === 1) { bg.remove(); alElegir('medio:' + ultimo.id); } return; }
            var f = fs.shift(); prog.textContent = 'Subiendo ' + f.name + '…';
            NVI.subirMedio(f, function(x) { prog.textContent = 'Subiendo ' + f.name + '… ' + Math.round(x * 100) + '%'; }).then(function(m) { hechos++; ultimo = m; if (varios) marcadas.push(m.id); sig(); }).catch(function(er) { aviso(f.name + ': ' + er.message, true); sig(); });
          };
          sig();
        };
        i.click();
      }
    };
    bg.addEventListener('mousedown', function(e) { if (e.target === bg) bg.remove(); });
    document.body.appendChild(bg); cargarL();
  };


  // ---------- Ajustar foto: qué parte se ve dentro de su marco y cuánto se acerca ----------
  // Busca en la página el marco donde se ve esa foto (para usar su misma forma en la ventana)
  function marcoDeFoto(obj, k) {
    var lz = document.getElementById('nviLienzo'), sel = E.sel; if (!lz || !sel) return null;
    if (sel.tipo === 'seccion') { var s = secPor(sel.id); return s && s.estilo === obj ? lz.querySelector('[data-sec="' + sel.id + '"]') : null; }
    var r = blkPor(sel.id); if (!r) return null;
    var p = r.blk.p, ruta = obj === p ? k : null;
    if (!ruta) Object.keys(p).forEach(function(key) { var i = Array.isArray(p[key]) ? p[key].indexOf(obj) : -1; if (i >= 0) ruta = key + '.' + i + '.' + k; });
    return ruta ? lz.querySelector('[data-blk="' + sel.id + '"] [data-enc="' + ruta + '"]') : null;
  }
  function ajustarFoto(obj, k, cambio) {
    var src = NVI.src(obj[k]) || obj[k]; if (!src) return;
    var marco = marcoDeFoto(obj, k), r = E.sel && E.sel.tipo === 'bloque' ? blkPor(E.sel.id) : null;
    var esImagen = r && r.blk.tipo === 'imagen' && obj === r.blk.p, original = obj[k + 'Enc'] ? NVI.clon(obj[k + 'Enc']) : null, forma0 = esImagen ? obj.proporcion : null;
    var q = NVI.enc(obj[k + 'Enc']), nat = 0;
    // todo lo que se haga en esta ventana queda como un solo paso de deshacer
    clearTimeout(tHist); registrar(); var h0 = E.histI;
    var unPaso = function() { E.hist = E.hist.slice(0, h0 + 1); E.histI = h0; };
    var bg = h('div', 'nvi-dlg-bg'), d = h('div', 'nvi-dlg nvi-ed-ajus'); bg.appendChild(d);
    d.innerHTML = '<h3>Ajustar foto</h3><p class="nvi-ed-ayuda">Arrastra la foto para elegir qué parte se ve. Usa el deslizador o la rueda del mouse para acercarla.</p>' +
      (esImagen ? '<div class="nvi-ed-ajus-formas">Forma: ' + [['', 'Original'], ['16/9', '16:9'], ['4/3', '4:3'], ['1/1', 'Cuadrada'], ['3/4', '3:4'], ['9/16', '9:16']].map(function(f) { return '<button type="button" data-forma="' + f[0] + '">' + f[1] + '</button>'; }).join('') + '</div>' : '') +
      '<div class="nvi-ed-ajus-zona"><div class="nvi-ed-ajus-marco"><img alt="" draggable="false"></div></div>' +
      '<p class="nvi-ed-ajus-nota" hidden>Con la forma original se ve la foto completa: acércala o elige otra forma para recortarla.</p>' +
      '<div class="nvi-ed-ajus-zoom"><span>🔍 Acercar</span><input type="range" min="1" max="4" step="0.05"><b></b></div>' +
      '<div class="nvi-dlg-bot"><button type="button" class="nvi-b2" data-a="centrar">Centrar</button><span style="flex:1"></span><button type="button" class="nvi-b2" data-a="cancelar">Cancelar</button><button type="button" class="nvi-b1" data-a="listo">Listo</button></div>';
    var mEl = d.querySelector('.nvi-ed-ajus-marco'), img = mEl.querySelector('img'), rng = d.querySelector('input[type=range]'), zb = d.querySelector('.nvi-ed-ajus-zoom b'), nota = d.querySelector('.nvi-ed-ajus-nota');
    var proporcion = function() {
      // la página se vuelve a dibujar con cada cambio: se busca el marco de nuevo para medir el que está en pantalla
      var m2 = marcoDeFoto(obj, k); if (m2 && m2.isConnected) marco = m2;
      if (esImagen) { if (+obj.alto && marco) return marco.offsetWidth / Math.max(1, marco.offsetHeight); if (obj.proporcion) { var a = obj.proporcion.split('/'); return +a[0] / +a[1]; } return nat || 16 / 9; }
      return marco && marco.offsetHeight ? marco.offsetWidth / marco.offsetHeight : 16 / 9;
    };
    var pintar = function() {
      var ar = proporcion(), maxW = Math.min(640, window.innerWidth - 80), maxH = window.innerHeight * 0.5, w = maxW, hh = w / ar;
      if (hh > maxH) { hh = maxH; w = hh * ar; }
      mEl.style.width = Math.round(w) + 'px'; mEl.style.height = Math.round(hh) + 'px';
      img.style.objectPosition = q.pos; img.style.transformOrigin = q.pos; img.style.transform = 'scale(' + q.z + ')';
      rng.value = q.z; zb.textContent = Math.round(q.z * 100) + '%';
      d.querySelectorAll('[data-forma]').forEach(function(b) { b.classList.toggle('on', (obj.proporcion || '') === b.dataset.forma); });
      nota.hidden = !(esImagen && !obj.proporcion && !+obj.alto && q.z === 1);
    };
    var guardar = function() { obj[k + 'Enc'] = {x: Math.round(q.x * 10) / 10, y: Math.round(q.y * 10) / 10, z: Math.round(q.z * 100) / 100}; if (q.x === 50 && q.y === 50 && q.z === 1) delete obj[k + 'Enc']; cambio(); };
    var fijar = function(x, y, z) { q = NVI.enc({x: x, y: y, z: z}); pintar(); };
    img.onload = function() { nat = img.naturalWidth / Math.max(1, img.naturalHeight); pintar(); };
    img.src = src;
    // arrastrar la foto: se mueve con el mouse (o el dedo) dentro del marco
    var ini = null;
    mEl.addEventListener('pointerdown', function(e) { e.preventDefault(); mEl.setPointerCapture(e.pointerId); ini = {x: e.clientX, y: e.clientY, qx: q.x, qy: q.y}; mEl.classList.add('moviendo'); });
    mEl.addEventListener('pointermove', function(e) {
      if (!ini) return;
      var W = mEl.clientWidth, H = mEl.clientHeight, a = nat || W / H;
      var dw = Math.max(W, H * a), dh = Math.max(H, W / a);           // tamaño de la foto cubriendo el marco
      var ox = dw - W + W * (q.z - 1), oy = dh - H + H * (q.z - 1);  // cuánto sobra para mover
      fijar(ox > 0.5 ? ini.qx - (e.clientX - ini.x) / ox * 100 : q.x, oy > 0.5 ? ini.qy - (e.clientY - ini.y) / oy * 100 : q.y, q.z);
    });
    var soltar = function() { if (!ini) return; ini = null; mEl.classList.remove('moviendo'); guardar(); };
    mEl.addEventListener('pointerup', soltar); mEl.addEventListener('pointercancel', soltar);
    var tRueda = null;
    mEl.addEventListener('wheel', function(e) { e.preventDefault(); fijar(q.x, q.y, q.z - e.deltaY * 0.0015); clearTimeout(tRueda); tRueda = setTimeout(guardar, 300); }, {passive: false});
    rng.oninput = function() { fijar(q.x, q.y, +rng.value); }; rng.onchange = guardar;
    d.onclick = function(e) {
      var f = e.target.closest('[data-forma]'); if (f) { obj.proporcion = f.dataset.forma; if (+obj.alto) obj.alto = 0; pintar(); cambio(); return; }
      var b = e.target.closest('[data-a]'); if (!b) return;
      if (b.dataset.a === 'centrar') { fijar(50, 50, 1); guardar(); }
      if (b.dataset.a === 'cancelar') { if (original) obj[k + 'Enc'] = original; else delete obj[k + 'Enc']; if (esImagen) obj.proporcion = forma0; unPaso(); bg.remove(); cambio(); botonesHist(); }
      if (b.dataset.a === 'listo') { unPaso(); registrar(); bg.remove(); pintarProps(); }
    };
    document.body.appendChild(bg); pintar();
  }

  // ---------- Plantillas ----------
  function abrirPlantillas(inicial) {
    var bg = h('div', 'nvi-dlg-bg'), d = h('div', 'nvi-dlg nvi-ed-pl'); bg.appendChild(d);
    d.innerHTML = '<h3>Plantillas</h3><p class="nvi-ed-ayuda">' + (inicial ? 'Empieza con una plantilla y cámbiala a tu gusto (textos, imágenes, colores y orden).' : 'Usar una plantilla reemplaza la página del borrador (puedes deshacer con Ctrl+Z). También puedes agregar solo sus secciones al final.') + '</p><div class="nvi-ed-pl-grid"></div><div class="nvi-dlg-bot"><button type="button" class="nvi-b2" data-cerrar>' + (inicial ? 'Empezar en blanco' : 'Cerrar') + '</button></div>';
    var grid = d.querySelector('.nvi-ed-pl-grid');
    NVI.PLANTILLAS.forEach(function(pl) {
      var c = h('div', 'nvi-ed-pl-item'), mini = h('div', 'nvi-ed-pl-mini'), escena = h('div', 'nvi-ed-pl-escena');
      mini.appendChild(escena); c.appendChild(mini);
      c.appendChild(h('div', 'nvi-ed-pl-info', '<b>' + esc(pl.nombre) + '</b><p>' + esc(pl.descripcion) + '</p><div><button type="button" class="nvi-b1" data-usar>Usar plantilla</button>' + (inicial ? '' : ' <button type="button" class="nvi-b2" data-agregar>Agregar sus secciones</button>') + '</div>'));
      NVI.render(pl.crear(), escena, {modo: 'editar'});
      c.querySelector('[data-usar]').onclick = function() { E.pag = pl.crear(); E.sel = null; bg.remove(); E.cambio(); aviso('Plantilla "' + pl.nombre + '" lista. Ahora cámbiala a tu gusto.'); };
      var ag = c.querySelector('[data-agregar]'); if (ag) ag.onclick = function() { E.pag.secciones = E.pag.secciones.concat(pl.crear().secciones); bg.remove(); E.cambio(); aviso('Se agregaron las secciones al final.'); };
      grid.appendChild(c);
    });
    d.querySelector('[data-cerrar]').onclick = function() { bg.remove(); };
    document.body.appendChild(bg);
  }

  // ---------- Historial de publicaciones ----------
  function abrirHistorial() {
    api('/design/api/inicio/versiones').then(function(l) {
      var html = l.length ? '<div class="nvi-ed-hist">' + l.map(function(v, i) {
        var f = new Date(v.publicadoEn + (/Z|[+-]\d\d:\d\d$/.test(v.publicadoEn) ? '' : 'Z'));
        return '<div class="nvi-ed-hist-f"><span><b>' + f.toLocaleString('es-CO', {dateStyle: 'medium', timeStyle: 'short'}) + '</b>' + (i === 0 ? ' <em>(publicada ahora)</em>' : '') + '<small>' + esc(v.publicadoPor) + '</small></span><button type="button" class="nvi-b2" data-v="' + v.id + '">Cargar en el borrador</button></div>';
      }).join('') + '</div>' : '<p class="nvi-ed-ayuda">Todavía no se ha publicado ninguna versión.</p>';
      var bg = h('div', 'nvi-dlg-bg'), d = h('div', 'nvi-dlg'); bg.appendChild(d);
      d.innerHTML = '<h3>Historial de publicaciones</h3><p class="nvi-ed-ayuda">Carga una versión anterior en el borrador para revisarla; se ve en la página cuando la publiques.</p>' + html + '<div class="nvi-dlg-bot"><button type="button" class="nvi-b2" data-cerrar>Cerrar</button></div>';
      d.onclick = function(e) {
        if (e.target.closest('[data-cerrar]')) bg.remove();
        var b = e.target.closest('[data-v]'); if (!b) return;
        E.guardar().then(function() { return api('/design/api/inicio/versiones/' + b.dataset.v + '/restaurar', {}); }).then(function() { bg.remove(); return cargar(); }).then(function() { aviso('Versión cargada en el borrador. Publica para que la vean todos.'); }).catch(function(er) { aviso(er.message, true); });
      };
      document.body.appendChild(bg);
    }).catch(function(e) { aviso(e.message, true); });
  }

  // ---------- Teclado ----------
  function teclado(e) {
    if (document.querySelector('.nvi-dlg-bg') || E.editando) return;
    var enCampo = e.target.closest && e.target.closest('input, textarea, select, [contenteditable=true]');
    var c = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (E.previa) { if (c && k === 's') e.preventDefault(); return; }   // en vista previa el teclado no edita la página
    if (c && k === 'z' && !e.shiftKey && !enCampo) { e.preventDefault(); E.deshacer(); }
    else if (c && (k === 'y' || (k === 'z' && e.shiftKey)) && !enCampo) { e.preventDefault(); E.rehacer(); }
    else if (c && k === 's') { e.preventDefault(); E.guardar(true).then(function() { aviso('Borrador guardado.'); }); }
    else if (enCampo) return;
    else if ((e.key === 'Delete' || e.key === 'Backspace') && E.sel && E.sel.tipo === 'bloque') { var r = blkPor(E.sel.id); if (r) { e.preventDefault(); r.lista.splice(r.i, 1); E.sel = null; E.cambio(); } }
    else if (c && k === 'd' && E.sel && E.sel.tipo === 'bloque') { e.preventDefault(); var r2 = blkPor(E.sel.id); if (r2) { var cp = nuevosIds(NVI.clon(r2.el || r2.blk)); r2.lista.splice(r2.i + 1, 0, cp); E.sel = {tipo: 'bloque', id: (cp.bloque || cp).id}; E.cambio(); } }
    else if (e.key === 'Escape') seleccionar(null);
    else if (/^Arrow/.test(e.key) && E.sel && E.sel.tipo === 'bloque') { var r3 = blkPor(E.sel.id); if (r3 && r3.el) { e.preventDefault(); var paso = e.shiftKey ? 10 : 1; if (e.key === 'ArrowLeft') r3.el.x -= paso / 2; if (e.key === 'ArrowRight') r3.el.x += paso / 2; if (e.key === 'ArrowUp') r3.el.y -= paso; if (e.key === 'ArrowDown') r3.el.y += paso; E.cambio(); } }
  }

})();
