/* Nuvia PowerPoint: modelo, dibujo de diapositivas y edición sobre el lienzo (seleccionar, mover con guías,
   cambiar tamaño, girar, editar texto), miniaturas, notas, deshacer/rehacer y guardado automático.
   La cinta está en ppt_cinta.js; .pptx en ppt_pptx.js; la presentación con diapositivas y el PDF en ppt_show.js. */
(function() {
  'use strict';
  var NV = window.NV, P = NV.ppt, esc = NV.esc;
  P.pres = null; P.doc = null;
  P.est = {actual: 0, sel: [], editando: null, zoom: 0, vista: 'normal', notas: true, guardado: true, guardando: false, pendiente: false,
           autoguardado: true, soloLectura: false, cuadricula: false, guias: true};
  var hist = [], histI = -1;

  // ---------- Recursos (imágenes guardadas una sola vez) ----------
  P.recurso = function(dataUrl) {
    var r = P.pres.recursos = P.pres.recursos || {};
    for (var k in r) if (r[k] === dataUrl) return 'res:' + k;
    var id = Math.random().toString(36).slice(2, 10); r[id] = dataUrl; return 'res:' + id;
  };
  P.src = function(s) { if (s && s.indexOf('res:') === 0) return (P.pres.recursos || {})[s.slice(4)] || ''; return s || ''; };
  function podarRecursos() {
    var usados = {}, txt = JSON.stringify(P.pres.diapositivas) + JSON.stringify(P.pres.disenos) + JSON.stringify(P.pres.tema || {});
    (txt.match(/res:[a-z0-9]+/g) || []).forEach(function(r) { usados[r.slice(4)] = 1; });
    Object.keys(P.pres.recursos || {}).forEach(function(k) { if (!usados[k]) delete P.pres.recursos[k]; });
  }

  // ---------- Dibujo ----------
  P.cssFuente = function(n) { return NV.cssFuente(n || P.tema(P.pres).cuerpo).replace(/"/g, "'"); };
  // Dibuja una diapositiva a tamaño real (1 punto = 1 px). opts: {modo: 'editor'|'mini'|'show', numero}
  P.render = function(diap, opts) {
    opts = opts || {};
    var pres = P.pres, tam = pres.tam, d = P.diseno(pres, diap.diseno);
    var cont = document.createElement('div'); cont.className = 'nvp-diap'; cont.style.width = tam.w + 'px'; cont.style.height = tam.h + 'px';
    cont.style.background = P.fondoCss(diap.fondo || d.fondo, pres);
    if (!diap.fondo || !diap.fondo.ocultarAdornos) (d.adornos || []).forEach(function(e) { cont.appendChild(P.renderElemento(e, {modo: 'fijo'})); });
    var pie = pres.pie || {}, num = opts.numero || (pres.diapositivas.indexOf(diap) + 1);
    if (!(pie.noEnTitulo && diap.diseno === 'titulo')) {
      var col = P.tema(pres).claroSobreOscuro ? 'rgba(255,255,255,.75)' : '#8c8c8c', tp = tam.h - 38;
      var pz = function(txt, x, w2, al) { var p2 = document.createElement('div'); p2.className = 'nvp-pie'; p2.style.cssText = 'left:' + x + 'px;top:' + tp + 'px;width:' + w2 + 'px;text-align:' + al + ';color:' + col + ';font-family:' + P.cssFuente(); p2.textContent = txt; cont.appendChild(p2); };
      if (pie.fecha) pz(pie.fechaFija || NV.fechas.formatear(pie.formatoFecha), 40, 200, 'left');
      if (pie.texto) pz(pie.texto, tam.w / 2 - 200, 400, 'center');
      if (pie.numero) pz(String(num), tam.w - 140, 100, 'right');
    }
    diap.elementos.forEach(function(e) { cont.appendChild(P.renderElemento(e, opts)); });
    if (opts.modo !== 'mini') requestAnimationFrame(function() { autoajustar(cont); });
    else autoajustar(cont);
    return cont;
  };
  function textoVacio(html) { return !html || !String(html).replace(/<br\s*\/?>/g, '').replace(/<[^>]+>/g, '').replace(/&nbsp;| /g, ' ').trim(); }
  P.textoVacio = textoVacio;
  P.renderElemento = function(e, opts) {
    opts = opts || {};
    var st = e.estilo || {}, el = document.createElement('div');
    el.className = 'nvp-el nvp-' + e.tipo + (e.marcador ? ' nvp-marcador' : '');
    el.setAttribute('data-id', e.id);
    el.style.cssText = 'left:' + e.x + 'px;top:' + e.y + 'px;width:' + e.w + 'px;height:' + e.h + 'px;' + (e.rot ? 'transform:rotate(' + e.rot + 'deg);' : '') +
      (st.opacidad != null && st.opacidad < 1 ? 'opacity:' + st.opacidad + ';' : '');
    if (opts.modo === 'fijo') el.style.pointerEvents = 'none';
    var conTexto = e.tipo === 'texto' || e.tipo === 'forma';
    if (e.tipo === 'forma' || (e.tipo === 'texto' && (st.relleno || st.borde))) {
      if (e.tipo === 'forma') {
        var img = document.createElement('img'); img.className = 'nvp-forma-img'; img.alt = ''; img.draggable = false;
        img.src = NV.word.svgForma(e.forma || 'rect', st.relleno || 'none', st.borde || 'none', st.grosor || 1, '', null, Math.max(4, Math.round(e.w)), Math.max(4, Math.round(e.h)));
        if (st.sombra) img.style.filter = 'drop-shadow(3px 4px 4px rgba(0,0,0,.35))';
        el.appendChild(img);
      } else {
        el.style.background = st.relleno && st.relleno !== 'none' ? st.relleno : '';
        if (st.borde && st.borde !== 'none') el.style.border = (st.grosor || 1) + 'px solid ' + st.borde;
        if (st.sombra) el.style.boxShadow = '3px 4px 8px rgba(0,0,0,.3)';
      }
    }
    if (conTexto) {
      var t = document.createElement('div'); t.className = 'nvp-txt';
      t.style.cssText = 'justify-content:' + ({top: 'flex-start', middle: 'center', bottom: 'flex-end'}[st.valign || (e.tipo === 'forma' ? 'middle' : 'top')]) + ';padding:' + (st.pad != null ? st.pad : 5) + 'px ' + (st.padH != null ? st.padH : 7) + 'px;';
      var inn = document.createElement('div'); inn.className = 'nvp-txt-in';
      inn.style.cssText = 'font-family:' + P.cssFuente(st.fuente) + ';font-size:' + (st.fs || 18) + 'px;color:' + (P.color(P.pres, st.color) || (P.tema(P.pres).claroSobreOscuro ? P.tema(P.pres).c.o1 : (e.tipo === 'forma' ? '#FFFFFF' : P.tema(P.pres).c.o1))) +
        ';text-align:' + (st.align || (e.tipo === 'forma' ? 'center' : 'left')) + ';' + (st.negrita ? 'font-weight:bold;' : '') + (st.cursiva ? 'font-style:italic;' : '') +
        (st.subrayado ? 'text-decoration:underline;' : '') + (st.interlineado ? 'line-height:' + st.interlineado + ';' : '') + (st.sombraTexto ? 'text-shadow:2px 2px 3px rgba(0,0,0,.4);' : '') +
        (st.vinetas ? '' : '') + (st.columnas > 1 ? 'column-count:' + st.columnas + ';column-gap:20px;' : '');
      var html = NV.fechas.actualizarHtml(e.html || '');
      if (textoVacio(html) && e.marcador && opts.modo === 'editor') {
        inn.innerHTML = '<span class="nvp-prompt">' + esc(P.TEXTOS_MARCADOR[e.marcador] || '') + '</span>';
      } else inn.innerHTML = html;
      t.appendChild(inn); el.appendChild(t);
    }
    if (e.tipo === 'imagen') {
      var s = P.src(e.src);
      if (s) {
        var im = document.createElement('img'); im.src = s; im.alt = e.alt || ''; im.draggable = false; im.className = 'nvp-img';
        im.style.objectFit = e.ajuste || 'fill';
        if (st.borde && st.borde !== 'none') im.style.border = (st.grosor || 2) + 'px solid ' + st.borde;
        if (st.radio) im.style.borderRadius = st.radio;
        if (st.sombra) im.style.boxShadow = '4px 4px 10px rgba(0,0,0,.4)';
        if (st.filtro) im.style.filter = st.filtro;
        el.appendChild(im);
      } else if (opts.modo === 'editor') {
        el.innerHTML = '<div class="nvp-img-vacia" data-insertar-img="' + e.id + '">' + NV.icono('image_add', 'g') + '<span>' + esc(P.TEXTOS_MARCADOR.imagen) + '</span></div>';
      }
    }
    if (e.tipo === 'tabla') el.appendChild(renderTabla(e, opts));
    if (e.tipo === 'grafico') {
      var gi = document.createElement('img'); gi.className = 'nvp-img'; gi.alt = 'Gráfico'; gi.draggable = false;
      gi.src = e._png || (e._png = NV.word.dibujarGrafico(e.grafico, Math.round(e.w), Math.round(e.h)));
      el.appendChild(gi);
    }
    if (e.tipo === 'linea') {
      var sv = '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 ' + e.w + ' ' + Math.max(1, e.h) + '" preserveAspectRatio="none" style="overflow:visible">' +
        '<line x1="0" y1="' + (e.invertida ? e.h : 0) + '" x2="' + e.w + '" y2="' + (e.invertida ? 0 : e.h) + '" stroke="' + (P.color(P.pres, st.borde) || '#000') + '" stroke-width="' + (st.grosor || 2) + '"' +
        (st.guiones ? ' stroke-dasharray="6 4"' : '') + '/>' + (st.flecha ? '<polygon points="' + puntaFlecha(e) + '" fill="' + (P.color(P.pres, st.borde) || '#000') + '"/>' : '') + '</svg>';
      el.innerHTML = sv;
    }
    if (e.vinculo && opts.modo === 'show') { el.style.cursor = 'pointer'; el.setAttribute('data-vinculo', e.vinculo); }
    return el;
  };
  function puntaFlecha(e) {
    var x2 = e.w, y2 = e.invertida ? 0 : e.h, x1 = 0, y1 = e.invertida ? e.h : 0, a = Math.atan2(y2 - y1, x2 - x1), L = 12 + (e.estilo.grosor || 2) * 2, W2 = 6 + (e.estilo.grosor || 2);
    return [x2, y2, x2 - L * Math.cos(a) + W2 * Math.sin(a), y2 - L * Math.sin(a) - W2 * Math.cos(a), x2 - L * Math.cos(a) - W2 * Math.sin(a), y2 - L * Math.sin(a) + W2 * Math.cos(a)].map(function(v) { return v.toFixed(1); }).join(' ');
  }
  function renderTabla(e, opts) {
    var t = e.tabla, tb = document.createElement('table'); tb.className = 'nvp-tabla';
    var st = e.estilo || {}, ac = P.color(P.pres, t.color || 'a1');
    tb.style.fontFamily = P.cssFuente(st.fuente); tb.style.fontSize = (st.fs || 16) + 'px';
    var total = (t.anchos || []).reduce(function(s, x) { return s + x; }, 0) || 1;
    t.filas.forEach(function(fila, fi) {
      var tr = document.createElement('tr');
      if (t.altos && t.altos[fi]) tr.style.height = t.altos[fi] + 'px';
      fila.forEach(function(c, ci) {
        if (c.oculta) return;
        var td = document.createElement('td'); td.setAttribute('data-f', fi); td.setAttribute('data-c', ci);
        if (c.cs > 1) td.colSpan = c.cs; if (c.rs > 1) td.rowSpan = c.rs;
        if (t.anchos) td.style.width = (t.anchos[ci] / total * 100).toFixed(2) + '%';
        var enc = t.encabezado !== false && fi === 0, banda = t.bandas !== false && fi > 0 && fi % 2 === 1;
        var fondo = c.fondo || (enc ? ac : banda ? mezclar(ac, 0.8) : mezclar(ac, 0.9));
        td.style.background = fondo; td.style.color = c.color || (enc ? '#FFFFFF' : '#000000'); if (enc) td.style.fontWeight = 'bold';
        td.style.border = '1px solid ' + (t.borde || '#FFFFFF'); td.style.textAlign = c.align || 'left'; td.style.verticalAlign = c.valign || 'middle';
        td.innerHTML = NV.fechas.actualizarHtml(c.html || '') || (opts.modo === 'editor' ? '' : '');
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    return tb;
  }
  function mezclar(hex, k) {
    if (!hex || hex[0] !== '#') return hex;
    var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    var f = function(c) { return Math.round(c + (255 - c) * k); };
    return '#' + [f(r), f(g), f(b)].map(function(x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }
  P.mezclar = mezclar;
  // Como PowerPoint: si el texto no cabe en el cuadro, se reduce (autoajuste) en lugar de salirse.
  function autoajustar(raiz) {
    Array.prototype.forEach.call(raiz.querySelectorAll('.nvp-texto .nvp-txt, .nvp-forma .nvp-txt'), function(t) {
      var inn = t.firstChild; if (!inn) return;
      var id = t.parentNode.getAttribute('data-id'), e = buscarEl(id);
      if (e && e.estilo && e.estilo.autoajuste === false) return;
      inn.style.zoom = ''; inn.style.width = '';
      var disp = t.clientHeight - (parseFloat(t.style.paddingTop) || 0) * 2;
      if (disp <= 0 || !inn.scrollHeight) return;
      var r = Math.min(1, disp / inn.scrollHeight);
      if (r < 0.995 && r > 0.3) { inn.style.zoom = r.toFixed(3); var r2 = Math.min(1, disp / (inn.scrollHeight * r)); if (r2 < 0.99) inn.style.zoom = (r * r2).toFixed(3); }
    });
  }
  function buscarEl(id) {
    if (!P.pres) return null;
    for (var i = 0; i < P.pres.diapositivas.length; i++) { var e = P.pres.diapositivas[i].elementos.filter(function(x) { return x.id === id; })[0]; if (e) return e; }
    return null;
  }
  P.buscarEl = buscarEl;
  P.diap = function() { return P.pres.diapositivas[P.est.actual]; };
  P.seleccionados = function() { var d = P.diap(); return d ? d.elementos.filter(function(e) { return P.est.sel.indexOf(e.id) >= 0; }) : []; };

  // ---------- Interfaz ----------
  P.construir = function() {
    var v = NV.$('#nvVistaPpt');
    v.innerHTML = '<header class="nv-titulo">' +
      '<span class="nv-app-ico" id="nvpAppIco" title="Inicio de Nuvia Office" role="button" tabindex="0" aria-label="Inicio de Nuvia Office">P</span><span class="nv-app-nombre">Nuvia PowerPoint</span>' +
      '<span class="nv-autoguardado"><span>Autoguardado</span><button type="button" class="nv-switch on" id="nvpAuto" role="switch" aria-checked="true" aria-label="Autoguardado"></button></span>' +
      '<div class="nv-qat"><button type="button" id="nvpGuardar" title="Guardar (Ctrl+S)" aria-label="Guardar">' + NV.icono('save') + '</button>' +
      '<button type="button" id="nvpDeshacer" title="Deshacer (Ctrl+Z)" aria-label="Deshacer">' + NV.icono('arrow_undo') + '</button>' +
      '<button type="button" id="nvpRehacer" title="Rehacer (Ctrl+Y)" aria-label="Rehacer">' + NV.icono('arrow_redo') + '</button>' +
      '<button type="button" id="nvpDesdePrincipio" title="Desde el principio (F5)" aria-label="Iniciar presentación">' + NV.icono('slide_play') + '</button></div>' +
      '<div class="nv-doc-titulo"><button type="button" id="nvpTitulo" title="Cambiar el nombre">Presentación</button><span class="nv-estado" id="nvpEstado">· Guardado</span></div>' +
      '<div class="nv-buscar-cmd"><span>' + NV.icono('search', 'p') + '</span><input type="search" id="nvpBuscarCmd" placeholder="Buscar (Alt+Q)" aria-label="Buscar comandos" autocomplete="off"><div class="nv-buscar-res nv-oculto" id="nvpBuscarRes"></div></div>' +
      '<div class="nv-titulo-der"><button type="button" class="nv-btn-compartir" id="nvpCompartir">' + NV.icono('share', 'p') + 'Compartir</button>' +
      '<span class="nv-avatar">' + NV.iniciales((NV.usuario || {}).nombre) + '</span></div></header>' +
      '<div class="nvp-banda-plantilla nv-oculto" id="nvpBanda"></div>' +
      '<nav class="nv-tabs" id="nvpTabs" role="tablist"></nav><div class="nv-cinta" id="nvpCinta"></div>' +
      '<div class="nv-trabajo" id="nvpTrabajo"><aside class="nvp-minis" id="nvpMinis" aria-label="Diapositivas" tabindex="0"></aside>' +
      '<div class="nvp-centro"><div class="nvp-lienzo" id="nvpLienzo"><div class="nvp-escena" id="nvpEscena"></div><div class="nvp-sel-capa" id="nvpCapa"></div></div>' +
      '<div class="nvp-notas" id="nvpNotasCaja"><div class="nvp-notas-ed" id="nvpNotas" contenteditable="true" data-placeholder="Haga clic para agregar notas" aria-label="Notas del orador"></div></div></div>' +
      '<div class="nvp-clasificador nv-oculto" id="nvpClasificador"></div></div>' +
      '<footer class="nv-estado-barra"><button type="button" id="nvpEstDiap">Diapositiva 1 de 1</button><button type="button" id="nvpEstIdioma">Español (Colombia)</button><span class="esp"></span>' +
      '<button type="button" id="nvpBtnNotas" class="on" title="Notas">' + NV.icono('note', 'p') + 'Notas</button>' +
      '<button type="button" data-pvista="normal" class="on" title="Normal" aria-label="Normal">' + NV.icono('slide_text', 'p') + '</button>' +
      '<button type="button" data-pvista="clasificador" title="Clasificador de diapositivas" aria-label="Clasificador de diapositivas">' + NV.icono('grid', 'p') + '</button>' +
      '<button type="button" data-pvista="lectura" title="Vista de lectura" aria-label="Vista de lectura">' + NV.icono('book_open', 'p') + '</button>' +
      '<button type="button" id="nvpEstShow" title="Presentación con diapositivas" aria-label="Presentación con diapositivas">' + NV.icono('slide_play', 'p') + '</button>' +
      '<span class="nv-zoom"><button type="button" id="nvpZoomMenos" aria-label="Alejar">−</button><input type="range" id="nvpZoomRango" min="10" max="400" step="5" value="100" aria-label="Zoom">' +
      '<button type="button" id="nvpZoomMas" aria-label="Acercar">+</button><button type="button" id="nvpZoomTxt" style="min-width:46px">Ajustar</button>' +
      '<button type="button" id="nvpAjustar" title="Ajustar la diapositiva a la ventana actual" aria-label="Ajustar a la ventana">' + NV.icono('arrow_maximize', 'p') + '</button></span></footer>';
    conectar();
  };
  function conectar() {
    NV.$('#nvpAppIco').onclick = function() { P.guardar().then(function() { P.doc = null; NV.inicio.mostrar(); }); };
    var sw = NV.$('#nvpAuto');
    sw.onclick = function() { P.est.autoguardado = !P.est.autoguardado; sw.classList.toggle('on', P.est.autoguardado); if (P.est.autoguardado) P.guardar(); pintarGuardado(); };
    NV.$('#nvpGuardar').onclick = function() { P.guardar(true).then(function() { NV.toast(P.doc && P.doc.esPlantilla ? 'Plantilla guardada.' : 'Presentación guardada.'); }); };
    NV.$('#nvpDeshacer').onclick = function() { P.deshacer(); };
    NV.$('#nvpRehacer').onclick = function() { P.rehacer(); };
    NV.$('#nvpDesdePrincipio').onclick = function() { P.show.iniciar(0); };
    NV.$('#nvpEstShow').onclick = function() { P.show.iniciar(P.est.actual); };
    NV.$('#nvpTitulo').onclick = function() { P.renombrar(); };
    NV.$('#nvpCompartir').onclick = function() { if (P.doc && P.doc.esPlantilla) NV.toast('Las plantillas las ven todos los usuarios de Nuvia Office.'); else NV.compartir(P.doc.id); };
    NV.$('#nvpBtnNotas').onclick = function() { P.est.notas = !P.est.notas; NV.$('#nvpNotasCaja').classList.toggle('nv-oculto', !P.est.notas); this.classList.toggle('on', P.est.notas); P.ajustarZoom(); };
    NV.$$('[data-pvista]').forEach(function(b) { b.onclick = function() { P.vista(b.getAttribute('data-pvista')); }; });
    NV.$('#nvpZoomRango').oninput = function() { P.zoom(+this.value); };
    NV.$('#nvpZoomMenos').onclick = function() { P.zoom(Math.max(10, Math.round(escala() * 100) - 10)); };
    NV.$('#nvpZoomMas').onclick = function() { P.zoom(Math.round(escala() * 100) + 10); };
    NV.$('#nvpZoomTxt').onclick = function() { P.cinta && P.cinta.dlgZoom(); };
    NV.$('#nvpAjustar').onclick = function() { P.zoom(0); };
    NV.$('#nvpEstDiap').onclick = function() { P.cinta && P.cinta.irA(); };
    NV.$('#nvpEstIdioma').onclick = function(e) { P.cinta && P.cinta.menuIdioma(e.currentTarget); };
    window.addEventListener('resize', function() { if (NV.vistaActual === 'ppt') { posicionar(); P.ajustarZoom(); } });
    // notas
    var notas = NV.$('#nvpNotas');
    notas.addEventListener('input', function() { var d = P.diap(); if (d && !P.est.soloLectura) { d.notas = notas.innerHTML; P.cambio(true); } });
    // lienzo
    var lienzo = NV.$('#nvpLienzo');
    lienzo.addEventListener('mousedown', mouseAbajo);
    lienzo.addEventListener('dblclick', dobleClic);
    lienzo.addEventListener('click', function(e) { var b = e.target.closest('[data-insertar-img]'); if (b) P.cinta.imagenEnMarcador(b.getAttribute('data-insertar-img')); });
    lienzo.addEventListener('contextmenu', function(e) { if (P.est.editando) return; e.preventDefault(); P.cinta && P.cinta.menuContextual(e); });
    document.addEventListener('keydown', teclado, true);
    document.addEventListener('paste', pegarSistema);
    // miniaturas
    var minis = NV.$('#nvpMinis');
    minis.addEventListener('click', function(e) { var m = e.target.closest('[data-i]'); if (m) P.ir(+m.dataset.i); });
    minis.addEventListener('contextmenu', function(e) { var m = e.target.closest('[data-i]'); e.preventDefault(); if (m) P.ir(+m.dataset.i); P.cinta && P.cinta.menuMinis(e); });
    var arr = null;
    minis.addEventListener('dragstart', function(e) { var m = e.target.closest('[data-i]'); if (m) { arr = +m.dataset.i; e.dataTransfer.effectAllowed = 'move'; } });
    minis.addEventListener('dragover', function(e) { if (arr !== null) { e.preventDefault(); var m = e.target.closest('[data-i]'); NV.$$('.nvp-mini', minis).forEach(function(x) { x.classList.toggle('sobre', x === m); }); } });
    minis.addEventListener('drop', function(e) { e.preventDefault(); var m = e.target.closest('[data-i]'); if (m && arr !== null) P.moverDiapositiva(arr, +m.dataset.i); arr = null; });
    minis.addEventListener('dragend', function() { arr = null; NV.$$('.nvp-mini', minis).forEach(function(x) { x.classList.remove('sobre'); }); });
    minis.addEventListener('keydown', function(e) {
      if (P.est.editando || e.target !== minis) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); P.ir(Math.min(P.pres.diapositivas.length - 1, P.est.actual + 1)); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); P.ir(Math.max(0, P.est.actual - 1)); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && !P.est.soloLectura) { e.preventDefault(); P.eliminarDiapositiva(); }
      else if (e.key === 'Enter' && !P.est.soloLectura) { e.preventDefault(); P.nuevaDiapositiva(); }
    });
    // ajusta el área de trabajo bajo la cinta
    posicionar();
  }
  function posicionar() {
    var t = NV.$('#nvpTrabajo'); if (!t) return;
    var c = NV.$('#nvpCinta'), arriba = c && !c.classList.contains('contraida') ? c.getBoundingClientRect().bottom : NV.$('#nvpTabs').getBoundingClientRect().bottom;
    if (document.body.classList.contains('nvp-lectura')) arriba = NV.$('#nvVistaPpt .nv-titulo').getBoundingClientRect().bottom;
    t.style.top = arriba + 'px';
  }
  P.posicionar = posicionar;

  // ---------- Abrir ----------
  P.abrirPorId = function(id) {
    NV.cargando('Abriendo presentación…');
    return NV.api('/design/api/office/docs/' + id).then(function(d) { NV.cargando(false); return P.abrir(d); })
      .catch(function(e) { NV.cargando(false); NV.toast('No se pudo abrir: ' + e.message, true); });
  };
  P.abrir = function(d) {
    var pres; try { pres = typeof d.contenido === 'string' && d.contenido ? JSON.parse(d.contenido) : null; } catch (x) { pres = null; }
    if (!pres || !pres.diapositivas) pres = P.nueva('office');
    P.doc = d; P.pres = pres;
    P.est.soloLectura = d.permiso === 'ver'; P.est.guardado = true; P.est.actual = 0; P.est.sel = []; P.est.editando = null;
    P.historialReset();
    document.body.classList.add('nv-ppt');
    NV.mostrarVista('ppt');
    if (!NV.$('#nvpTabs').children.length) { P.cinta.construir(); }
    document.title = d.titulo + ' - Nuvia PowerPoint';
    try { history.replaceState(null, '', '/design/office?' + (d.esPlantilla ? 'plantilla=' : 'doc=') + d.id); } catch (x) {}
    NV.$('#nvpTitulo').textContent = d.titulo;
    var banda = NV.$('#nvpBanda');
    banda.classList.toggle('nv-oculto', !d.esPlantilla);
    if (d.esPlantilla) banda.innerHTML = NV.icono('document_one_page', 'p') + ' Estás editando la plantilla <b>' + esc(d.titulo) + '</b>. Los cambios los verán todos al crear presentaciones nuevas.';
    pintarGuardado();
    P.cinta.mostrarTab('inicio');
    setTimeout(function() { posicionar(); P.ajustarZoom(); P.pintarTodo(); }, 0);
    return Promise.resolve();
  };

  // ---------- Pintar ----------
  var esc0 = 1;
  function escala() { return esc0; }
  P.escala = escala;
  P.ajustarZoom = function() { if (!P.est.zoom) P.zoom(0, true); else P.zoom(P.est.zoom, true); };
  P.zoom = function(z, sinGuardar) {
    var lienzo = NV.$('#nvpLienzo'); if (!lienzo || !P.pres) return;
    if (!sinGuardar) P.est.zoom = z;
    var tam = P.pres.tam, aw = lienzo.clientWidth - 60, ah = lienzo.clientHeight - 40;
    esc0 = z ? z / 100 : Math.max(0.1, Math.min(aw / tam.w, ah / tam.h));
    var esc = NV.$('#nvpEscena'), capa = NV.$('#nvpCapa');
    var W = tam.w * esc0, H = tam.h * esc0, L = Math.max(30, (lienzo.clientWidth - W) / 2), T = Math.max(20, (lienzo.clientHeight - H) / 2);
    esc.style.cssText = 'left:' + L + 'px;top:' + T + 'px;width:' + W + 'px;height:' + H + 'px';
    capa.style.cssText = 'left:' + L + 'px;top:' + T + 'px;width:' + W + 'px;height:' + H + 'px';
    var inner = esc.firstChild; if (inner) inner.style.transform = 'scale(' + esc0 + ')';
    lienzo.style.setProperty('--nvp-ancho', (L * 2 + W) + 'px');
    NV.$('#nvpZoomRango').value = Math.round(esc0 * 100);
    NV.$('#nvpZoomTxt').textContent = P.est.zoom ? Math.round(esc0 * 100) + '%' : 'Ajustar';
    pintarSeleccion();
  };
  P.pintarTodo = function() { P.pintarEscena(); P.pintarMinis(); P.pintarNotas(); P.estado(); };
  P.pintarEscena = function() {
    var esc = NV.$('#nvpEscena'), d = P.diap(); if (!d) return;
    esc.innerHTML = '';
    var r = P.render(d, {modo: 'editor'}); r.style.transformOrigin = '0 0'; r.style.transform = 'scale(' + esc0 + ')';
    if (P.est.cuadricula) r.classList.add('nvp-cuadricula');
    esc.appendChild(r);
    if (P.est.editando) { var el = r.querySelector('[data-id="' + P.est.editando + '"]'); if (el) activarEdicion(el, null, true); else P.est.editando = null; }
    pintarSeleccion();
  };
  P.pintarMinis = function() {
    var m = NV.$('#nvpMinis'); if (!m || !P.pres) return;
    var tam = P.pres.tam, k = 168 / tam.w;
    m.innerHTML = '';
    P.pres.diapositivas.forEach(function(d, i) {
      var c = document.createElement('div'); c.className = 'nvp-mini' + (i === P.est.actual ? ' on' : '') + (d.oculta ? ' oculta' : ''); c.setAttribute('data-i', i); c.draggable = !P.est.soloLectura;
      c.setAttribute('role', 'option'); c.setAttribute('aria-label', 'Diapositiva ' + (i + 1));
      var marco = document.createElement('div'); marco.className = 'nvp-mini-marco'; marco.style.width = (tam.w * k) + 'px'; marco.style.height = (tam.h * k) + 'px';
      var r = P.render(d, {modo: 'mini', numero: i + 1}); r.style.transformOrigin = '0 0'; r.style.transform = 'scale(' + k + ')';
      marco.appendChild(r);
      c.innerHTML = '<span class="nvp-mini-n">' + (i + 1) + (d.transicion && d.transicion.tipo !== 'ninguna' ? '<br>★' : '') + '</span>';
      c.appendChild(marco); m.appendChild(c);
    });
    var on = m.querySelector('.nvp-mini.on'); if (on && on.scrollIntoViewIfNeeded) on.scrollIntoViewIfNeeded(false);
  };
  P.pintarMini = function(i) {  // solo una miniatura (al editar)
    var m = NV.$('#nvpMinis .nvp-mini[data-i="' + i + '"] .nvp-mini-marco'); if (!m) return P.pintarMinis();
    var tam = P.pres.tam, k = 168 / tam.w, r = P.render(P.pres.diapositivas[i], {modo: 'mini', numero: i + 1});
    r.style.transformOrigin = '0 0'; r.style.transform = 'scale(' + k + ')'; m.innerHTML = ''; m.appendChild(r);
  };
  P.pintarNotas = function() { var n = NV.$('#nvpNotas'), d = P.diap(); if (n && d && document.activeElement !== n) { n.innerHTML = d.notas || ''; n.contentEditable = !P.est.soloLectura; } };
  P.estado = function() {
    var e = NV.$('#nvpEstDiap'); if (e && P.pres) e.textContent = 'Diapositiva ' + (P.est.actual + 1) + ' de ' + P.pres.diapositivas.length;
    var u = NV.$('#nvpDeshacer'), r = NV.$('#nvpRehacer');
    if (u) u.disabled = P.est.soloLectura || histI <= 0; if (r) r.disabled = P.est.soloLectura || histI >= hist.length - 1;
    if (P.cinta) P.cinta.refrescar();
  };
  P.ir = function(i) {
    if (!P.pres || i < 0 || i >= P.pres.diapositivas.length) return;
    salirEdicion();
    P.est.actual = i; P.est.sel = [];
    P.pintarEscena(); P.pintarNotas();
    NV.$$('#nvpMinis .nvp-mini').forEach(function(m) { m.classList.toggle('on', +m.dataset.i === i); });
    var on = NV.$('#nvpMinis .nvp-mini.on'); if (on && on.scrollIntoViewIfNeeded) on.scrollIntoViewIfNeeded(false);
    P.estado();
  };

  // ---------- Selección ----------
  function pintarSeleccion() {
    var capa = NV.$('#nvpCapa'); if (!capa) return;
    capa.innerHTML = '';
    if (P.est.soloLectura || P.est.vista !== 'normal') return;
    var s = esc0;
    P.seleccionados().forEach(function(e) {
      var c = document.createElement('div'); c.className = 'nvp-caja' + (P.est.editando === e.id ? ' editando' : '');
      c.style.cssText = 'left:' + (e.x * s) + 'px;top:' + (e.y * s) + 'px;width:' + (e.w * s) + 'px;height:' + (e.h * s) + 'px;' + (e.rot ? 'transform:rotate(' + e.rot + 'deg);' : '');
      c.setAttribute('data-id', e.id);
      if (P.est.sel.length === 1 && !e.bloqueado) {
        var hs = e.tipo === 'linea' ? ['nw', 'se'] : ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
        hs.forEach(function(h) { var x = document.createElement('span'); x.className = 'nvp-h ' + h; x.setAttribute('data-h', h); c.appendChild(x); });
        if (e.tipo !== 'linea') { var rt = document.createElement('span'); rt.className = 'nvp-h rot'; rt.setAttribute('data-h', 'rot'); rt.title = 'Girar'; rt.innerHTML = NV.icono('arrow_rotate_clockwise', 'p'); c.appendChild(rt); }
      }
      capa.appendChild(c);
    });
  }
  P.pintarSeleccion = pintarSeleccion;
  P.seleccionar = function(ids, agregar) {
    if (!agregar) P.est.sel = [];
    (ids || []).forEach(function(id) { if (P.est.sel.indexOf(id) < 0) P.est.sel.push(id); });
    pintarSeleccion(); P.cinta && P.cinta.refrescar();
  };
  function puntoDiap(ev) { var r = NV.$('#nvpEscena').getBoundingClientRect(); return {x: (ev.clientX - r.left) / esc0, y: (ev.clientY - r.top) / esc0}; }
  function elementoEn(ev) {
    var t = ev.target.closest('.nvp-caja') || ev.target.closest('#nvpEscena .nvp-el');
    if (t) return buscarEl(t.getAttribute('data-id'));
    // el clic cae en la capa de selección: busca el elemento debajo por coordenadas
    var p = puntoDiap(ev), d = P.diap(); if (!d) return null;
    for (var i = d.elementos.length - 1; i >= 0; i--) { var e = d.elementos[i]; if (p.x >= e.x && p.x <= e.x + e.w && p.y >= e.y && p.y <= e.y + Math.max(e.h, 6)) return e; }
    return null;
  }
  function mouseAbajo(ev) {
    if (ev.button !== 0 || !P.pres) return;
    if (P.est.editando) {  // clic dentro del texto que se edita: deja editar
      if (ev.target.closest('[contenteditable="true"]')) return;
      salirEdicion();
    }
    if (P.est.soloLectura || P.est.vista !== 'normal') return;
    var h = ev.target.closest('.nvp-h');
    var e = h ? buscarEl(h.parentNode.getAttribute('data-id')) : elementoEn(ev);
    if (!e) {  // arrastrar en vacío: selección por recuadro
      if (!ev.shiftKey) P.seleccionar([]);
      marquesina(ev); return;
    }
    if (ev.target.closest('[data-insertar-img]')) return;
    ev.preventDefault();
    if (ev.shiftKey || ev.ctrlKey) { if (P.est.sel.indexOf(e.id) >= 0) P.est.sel.splice(P.est.sel.indexOf(e.id), 1); else P.est.sel.push(e.id); pintarSeleccion(); P.cinta.refrescar(); return; }
    var yaSel = P.est.sel.indexOf(e.id) >= 0;
    if (!yaSel) P.seleccionar([e.id]);
    if (h) { arrastrar(ev, h.getAttribute('data-h')); return; }
    // clic en un texto ya seleccionado → editar (como PowerPoint)
    var esTexto = e.tipo === 'texto' || e.tipo === 'forma';
    if (yaSel && esTexto && P.est.sel.length === 1 && !e.bloqueado) { esperarClicEdicion(ev, e); return; }
    if (esTexto && e.marcador && P.textoVacio(e.html)) { esperarClicEdicion(ev, e); return; }
    arrastrar(ev, 'mover');
  }
  function esperarClicEdicion(ev, e) {  // si no se arrastra, entra a editar
    var x0 = ev.clientX, y0 = ev.clientY, movio = false;
    var mover = function(m) { if (!movio && Math.hypot(m.clientX - x0, m.clientY - y0) > 4) { movio = true; quitar(); arrastrar(ev, 'mover'); } };
    var soltar = function(u) { quitar(); if (!movio) editar(e.id, u); };
    var quitar = function() { document.removeEventListener('mousemove', mover); document.removeEventListener('mouseup', soltar); };
    document.addEventListener('mousemove', mover); document.addEventListener('mouseup', soltar);
  }
  function dobleClic(ev) {
    if (P.est.soloLectura || P.est.editando) return;
    var e = elementoEn(ev); if (!e) return;
    if (e.tipo === 'texto' || e.tipo === 'forma') editar(e.id, ev);
    else if (e.tipo === 'grafico') P.cinta.dlgGrafico(e);
    else if (e.tipo === 'tabla') editarTabla(e, ev);
    else if (e.tipo === 'imagen') P.cinta.imagenEnMarcador(e.id);
  }
  function marquesina(ev) {
    var capa = NV.$('#nvpCapa'), p0 = puntoDiap(ev), caja = document.createElement('div'); caja.className = 'nvp-marquesina'; capa.appendChild(caja);
    var mover = function(m) {
      var p = puntoDiap(m), x = Math.min(p0.x, p.x), y = Math.min(p0.y, p.y), w = Math.abs(p.x - p0.x), h = Math.abs(p.y - p0.y);
      caja.style.cssText = 'left:' + x * esc0 + 'px;top:' + y * esc0 + 'px;width:' + w * esc0 + 'px;height:' + h * esc0 + 'px';
      caja._r = {x: x, y: y, w: w, h: h};
    };
    var soltar = function() {
      document.removeEventListener('mousemove', mover); document.removeEventListener('mouseup', soltar);
      var r = caja._r; caja.remove();
      if (r && r.w > 3 && r.h > 3) P.seleccionar(P.diap().elementos.filter(function(e) { return e.x >= r.x && e.y >= r.y && e.x + e.w <= r.x + r.w && e.y + e.h <= r.y + r.h; }).map(function(e) { return e.id; }), ev.shiftKey);
    };
    document.addEventListener('mousemove', mover); document.addEventListener('mouseup', soltar);
  }
  // Mover, cambiar tamaño y girar con guías inteligentes (bordes y centros de la diapositiva y de otros objetos).
  function arrastrar(ev, modo) {
    var p0 = puntoDiap(ev), sel = P.seleccionados().filter(function(e) { return !e.bloqueado; }); if (!sel.length) return;
    var orig = sel.map(function(e) { return {e: e, x: e.x, y: e.y, w: e.w, h: e.h, rot: e.rot || 0}; }), movido = false;
    var d = P.diap(), tam = P.pres.tam, otros = d.elementos.filter(function(e) { return sel.indexOf(e) < 0; });
    var xs = [0, tam.w / 2, tam.w], ys = [0, tam.h / 2, tam.h];
    otros.forEach(function(o) { xs.push(o.x, o.x + o.w / 2, o.x + o.w); ys.push(o.y, o.y + o.h / 2, o.y + o.h); });
    var capa = NV.$('#nvpCapa');
    var mover = function(m) {
      var p = puntoDiap(m), dx = p.x - p0.x, dy = p.y - p0.y;
      if (!movido && Math.hypot(dx, dy) * esc0 < 3) return;
      movido = true;
      NV.$$('.nvp-guia', capa).forEach(function(g) { g.remove(); });
      if (modo === 'mover') {
        var b = caja(orig.map(function(o) { return {x: o.x + dx, y: o.y + dy, w: o.w, h: o.h}; }));
        if (P.est.guias && !m.altKey) {
          var umbral = 6 / esc0, sx = ajuste([b.x, b.x + b.w / 2, b.x + b.w], xs, umbral), sy = ajuste([b.y, b.y + b.h / 2, b.y + b.h], ys, umbral);
          if (sx) { dx += sx.d; guia('v', sx.v); } if (sy) { dy += sy.d; guia('h', sy.v); }
        }
        if (m.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        orig.forEach(function(o) { o.e.x = Math.round(o.x + dx); o.e.y = Math.round(o.y + dy); });
      } else if (modo === 'rot') {
        var o = orig[0], cx = o.x + o.w / 2, cy = o.y + o.h / 2, a = Math.atan2(p.y - cy, p.x - cx) * 180 / Math.PI + 90;
        if (m.shiftKey) a = Math.round(a / 15) * 15;
        o.e.rot = Math.round(((a % 360) + 360) % 360);
        if (o.e.rot < 2 || o.e.rot > 358) o.e.rot = 0;
      } else {
        var o2 = orig[0], e2 = o2.e, x = o2.x, y = o2.y, w = o2.w, h = o2.h;
        if (/e/.test(modo)) w = Math.max(4, o2.w + dx); if (/s/.test(modo)) h = Math.max(4, o2.h + dy);
        if (/w/.test(modo)) { w = Math.max(4, o2.w - dx); x = o2.x + o2.w - w; }
        if (/n/.test(modo)) { h = Math.max(4, o2.h - dy); y = o2.y + o2.h - h; }
        var prop = (e2.tipo === 'imagen' || e2.tipo === 'grafico') ? !m.shiftKey : m.shiftKey;
        if (prop && modo.length === 2) { var r = o2.w / o2.h; if (w / h > r) w = h * r; else h = w / r; if (/w/.test(modo)) x = o2.x + o2.w - w; if (/n/.test(modo)) y = o2.y + o2.h - h; }
        if (e2.tipo === 'linea') { w = o2.w + (modo === 'se' ? dx : -dx); h = o2.h + (modo === 'se' ? dy : -dy); if (modo === 'nw') { x = o2.x + dx; y = o2.y + dy; } if (w < 0 || h < 0) {} }
        e2.x = Math.round(x); e2.y = Math.round(y); e2.w = Math.round(Math.max(e2.tipo === 'linea' ? 0 : 4, w)); e2.h = Math.round(Math.max(e2.tipo === 'linea' ? 0 : 4, h));
        if (e2.tipo === 'grafico') delete e2._png;
      }
      P.pintarEscenaLigera(sel);
      pintarSeleccion();
    };
    var soltar = function() {
      document.removeEventListener('mousemove', mover); document.removeEventListener('mouseup', soltar);
      NV.$$('.nvp-guia', capa).forEach(function(g) { g.remove(); });
      if (movido) { P.pintarEscena(); P.cambio(); }
    };
    document.addEventListener('mousemove', mover); document.addEventListener('mouseup', soltar);
    function guia(t, v) { var g = document.createElement('div'); g.className = 'nvp-guia ' + t; if (t === 'v') g.style.left = v * esc0 + 'px'; else g.style.top = v * esc0 + 'px'; capa.appendChild(g); }
  }
  function caja(lista) {
    var x0 = Math.min.apply(null, lista.map(function(o) { return o.x; })), y0 = Math.min.apply(null, lista.map(function(o) { return o.y; }));
    var x1 = Math.max.apply(null, lista.map(function(o) { return o.x + o.w; })), y1 = Math.max.apply(null, lista.map(function(o) { return o.y + o.h; }));
    return {x: x0, y: y0, w: x1 - x0, h: y1 - y0};
  }
  P.caja = caja;
  function ajuste(valores, objetivos, umbral) {
    var mejor = null;
    valores.forEach(function(v) { objetivos.forEach(function(o) { var d = o - v; if (Math.abs(d) <= umbral && (!mejor || Math.abs(d) < Math.abs(mejor.d))) mejor = {d: d, v: o}; }); });
    return mejor;
  }
  // repinta solo los elementos que se mueven (más fluido)
  P.pintarEscenaLigera = function(lista) {
    var raiz = NV.$('#nvpEscena .nvp-diap'); if (!raiz) return;
    lista.forEach(function(e) {
      var viejo = raiz.querySelector('[data-id="' + e.id + '"]'); if (!viejo) return;
      if (viejo.style.width === e.w + 'px' && viejo.style.height === e.h + 'px' && !e.rot === !viejo.style.transform) {
        viejo.style.left = e.x + 'px'; viejo.style.top = e.y + 'px'; if (e.rot) viejo.style.transform = 'rotate(' + e.rot + 'deg)';
      } else viejo.replaceWith(P.renderElemento(e, {modo: 'editor'}));
    });
  };

  // ---------- Editar texto ----------
  function editar(id, ev) {
    var el = NV.$('#nvpEscena .nvp-el[data-id="' + id + '"]'); if (!el) return;
    P.est.editando = id; P.est.sel = [id];
    activarEdicion(el, ev);
    pintarSeleccion(); P.cinta.refrescar();
  }
  P.editar = editar;
  function activarEdicion(el, ev, mantener) {
    var e = buscarEl(el.getAttribute('data-id')), inn = el.querySelector('.nvp-txt-in'); if (!inn || !e) return;
    if (inn.querySelector('.nvp-prompt')) inn.innerHTML = e.estilo && e.estilo.vinetas ? '<ul><li><br></li></ul>' : '<p><br></p>';
    inn.style.zoom = ''; inn.style.width = '';
    inn.contentEditable = 'true'; inn.spellcheck = true; inn.lang = P.pres.idioma || 'es-CO';
    el.classList.add('editando');
    if (!mantener) {
      inn.focus();
      var r = null;
      if (ev && document.caretRangeFromPoint) { try { r = document.caretRangeFromPoint(ev.clientX, ev.clientY); } catch (x) {} }
      if (!r || !inn.contains(r.startContainer)) { r = document.createRange(); r.selectNodeContents(inn); r.collapse(false); }
      var s = getSelection(); s.removeAllRanges(); s.addRange(r);
    }
    inn.oninput = function() { e.html = limpiarHtml(inn.innerHTML); P.cambio(true); };
    inn.onkeyup = inn.onmouseup = function() { P.cinta && P.cinta.refrescar(); };
  }
  function limpiarHtml(h) { return String(h || '').replace(/ contenteditable="[^"]*"/g, ''); }
  function salirEdicion() {
    if (!P.est.editando) return;
    var id = P.est.editando, el = NV.$('#nvpEscena .nvp-el[data-id="' + id + '"]'), e = buscarEl(id);
    P.est.editando = null;
    if (el && e) {
      var inn = el.querySelector('.nvp-txt-in');
      if (inn) { e.html = P.textoVacio(inn.innerHTML) && !inn.querySelector('img') ? '' : limpiarHtml(inn.innerHTML); inn.contentEditable = 'false'; }
      el.classList.remove('editando');
      el.replaceWith(P.renderElemento(e, {modo: 'editor'}));
      var raiz = NV.$('#nvpEscena .nvp-diap'); if (raiz) autoajustar(raiz);
    }
    window.getSelection().removeAllRanges();
    P.pintarMini(P.est.actual); pintarSeleccion();
  }
  P.salirEdicion = salirEdicion;
  P.editable = function() { return P.est.editando ? NV.$('#nvpEscena .nvp-el[data-id="' + P.est.editando + '"] .nvp-txt-in') : null; };
  function editarTabla(e, ev) {
    var el = NV.$('#nvpEscena .nvp-el[data-id="' + e.id + '"]'); if (!el) return;
    var td = ev && ev.target.closest ? ev.target.closest('td') : null;
    if (!td) { var p = document.elementFromPoint(ev.clientX, ev.clientY); td = p && p.closest ? p.closest('td') : null; }
    P.est.editando = e.id;
    NV.$$('td', el).forEach(function(c) {
      c.contentEditable = 'true';
      c.oninput = function() { var cel = e.tabla.filas[+c.dataset.f][+c.dataset.c]; cel.html = c.innerHTML; P.cambio(true); };
      c.onfocus = function() { P.est.celda = [+c.dataset.f, +c.dataset.c]; P.cinta.refrescar(); };
    });
    el.classList.add('editando');
    (td || el.querySelector('td')).focus();
    pintarSeleccion(); P.cinta.refrescar();
  }
  P.editarTabla = editarTabla;

  // ---------- Teclado ----------
  function teclado(ev) {
    if (NV.vistaActual !== 'ppt' || !P.pres || document.querySelector('.nv-fondo-dlg') || P.show.activo()) return;
    var k = ev.key, c = ev.ctrlKey || ev.metaKey, s = ev.shiftKey;
    var enInput = ev.target.matches('input,select,textarea') || ev.target.id === 'nvpNotas';
    var hacer = function(fn) { ev.preventDefault(); ev.stopPropagation(); fn(); };
    if (c && !s && (k === 's' || k === 'S' || k === 'g' || k === 'G')) return hacer(function() { P.guardar(true).then(function() { NV.toast('Guardado.'); }); });
    if (k === 'F5') return hacer(function() { P.show.iniciar(s ? P.est.actual : 0); });
    if (c && (k === 'p' || k === 'P')) return hacer(function() { NV.backstage.abrir('imprimir'); });
    if (ev.altKey && (k === 'q' || k === 'Q')) return hacer(function() { NV.$('#nvpBuscarCmd').focus(); });
    if (enInput) return;
    if (P.est.editando) {
      if (k === 'Escape') return hacer(function() { var id = P.est.editando; salirEdicion(); P.seleccionar([id]); });
      if (c && P.cinta && P.cinta.atajosTexto(ev)) { ev.preventDefault(); return; }
      if (k === 'Tab' && !c && !ev.altKey) {  // como PowerPoint: en una viñeta cambia el nivel; fuera de lista, tabulación
        ev.preventDefault();
        var s0 = getSelection(), nodo = s0.anchorNode && (s0.anchorNode.nodeType === 3 ? s0.anchorNode.parentNode : s0.anchorNode);
        if (nodo && nodo.closest && nodo.closest('li')) document.execCommand(s ? 'outdent' : 'indent');
        else if (!s) document.execCommand('insertText', false, '        ');
        var ed = P.editable(), e0 = buscarEl(P.est.editando); if (ed && e0) { e0.html = limpiarHtml(ed.innerHTML); P.cambio(true); }
        return;
      }
      return;
    }
    if (P.est.soloLectura) return;
    if (c && !s && (k === 'z' || k === 'Z')) return hacer(P.deshacer);
    if (c && (k === 'y' || k === 'Y' || (s && (k === 'z' || k === 'Z')))) return hacer(P.rehacer);
    if (c && (k === 'm' || k === 'M')) return hacer(function() { P.nuevaDiapositiva(); });
    if (document.activeElement && document.activeElement.closest && document.activeElement.closest('.nv-cinta,.nv-tabs,.nv-titulo')) return;
    var sel = P.seleccionados();
    if (c && (k === 'a' || k === 'A')) return hacer(function() { P.seleccionar(P.diap().elementos.map(function(e) { return e.id; })); });
    if (c && (k === 'c' || k === 'C') && sel.length) return hacer(function() { P.copiar(false); });
    if (c && (k === 'x' || k === 'X') && sel.length) return hacer(function() { P.copiar(true); });
    if (c && (k === 'd' || k === 'D') && sel.length) return hacer(function() { P.duplicar(); });
    if (c && (k === 'v' || k === 'V')) { return; }  // lo maneja el evento paste (también trae imágenes del sistema)
    if ((k === 'Delete' || k === 'Backspace') && sel.length) return hacer(function() { P.eliminarSeleccion(); });
    if (k === 'Escape' && sel.length) return hacer(function() { P.seleccionar([]); });
    if (k === 'Tab' && P.diap().elementos.length) return hacer(function() {
      var el = P.diap().elementos, i = sel.length ? el.indexOf(sel[0]) : -1; i = (i + (s ? -1 : 1) + el.length) % el.length; P.seleccionar([el[i].id]);
    });
    if (/^Arrow/.test(k) && sel.length) return hacer(function() {
      var paso = s ? 10 : 1, dx = k === 'ArrowLeft' ? -paso : k === 'ArrowRight' ? paso : 0, dy = k === 'ArrowUp' ? -paso : k === 'ArrowDown' ? paso : 0;
      sel.forEach(function(e) { e.x += dx; e.y += dy; }); P.pintarEscenaLigera(sel); pintarSeleccion(); P.cambio(true);
    });
    if (/^Arrow|^Page/.test(k) && !sel.length) return hacer(function() { P.ir(P.est.actual + (k === 'ArrowDown' || k === 'ArrowRight' || k === 'PageDown' ? 1 : -1)); });
    if ((k === 'Enter' || k === 'F2') && sel.length === 1 && (sel[0].tipo === 'texto' || sel[0].tipo === 'forma')) return hacer(function() { editar(sel[0].id); });
    // escribir con un cuadro de texto seleccionado reemplaza el texto (como PowerPoint)
    if (sel.length === 1 && k.length === 1 && !c && !ev.altKey && (sel[0].tipo === 'texto' || sel[0].tipo === 'forma')) {
      ev.preventDefault(); sel[0].html = ''; P.pintarEscena(); editar(sel[0].id);
      document.execCommand('insertText', false, k);
    }
  }

  // ---------- Portapapeles de objetos ----------
  var porta = null;
  P.copiar = function(cortar) {
    var sel = P.seleccionados(); if (!sel.length) return;
    porta = JSON.stringify({nuvia: 'ppt', recursos: P.pres.recursos ? sel.reduce(function(m, e) { if (e.src && e.src.indexOf('res:') === 0) m[e.src.slice(4)] = P.pres.recursos[e.src.slice(4)]; return m; }, {}) : {}, elementos: sel});
    try { navigator.clipboard.writeText(porta).catch(function() {}); } catch (x) {}
    if (cortar) P.eliminarSeleccion();
  };
  P.pegar = function(texto) {
    var datos = null; try { datos = JSON.parse(texto || porta || ''); } catch (x) {}
    if (!datos || datos.nuvia !== 'ppt') return false;
    Object.keys(datos.recursos || {}).forEach(function(k) { P.pres.recursos = P.pres.recursos || {}; if (!P.pres.recursos[k]) P.pres.recursos[k] = datos.recursos[k]; });
    var ids = [];
    datos.elementos.forEach(function(e) { e.id = P.uid(); e.x += 12; e.y += 12; delete e.marcador; P.diap().elementos.push(e); ids.push(e.id); });
    porta = JSON.stringify(Object.assign(datos, {elementos: datos.elementos}));
    P.pintarEscena(); P.seleccionar(ids); P.cambio();
    return true;
  };
  function pegarSistema(ev) {
    if (NV.vistaActual !== 'ppt' || P.est.editando || P.est.soloLectura || ev.target.closest('input,textarea,#nvpNotas,[contenteditable="true"]')) return;
    var cd = ev.clipboardData; if (!cd) return;
    var t = cd.getData('text/plain');
    if (t && P.pegar(t)) { ev.preventDefault(); return; }
    var img = Array.prototype.filter.call(cd.items || [], function(i) { return /^image\//.test(i.type); })[0];
    if (img) { ev.preventDefault(); NV.imagenADataUrl(img.getAsFile()).then(function(u) { P.cinta.insertarImagenUrl(u); }); return; }
    if (porta && !t) { ev.preventDefault(); P.pegar(); return; }
    if (t) { ev.preventDefault(); P.cinta.insertarTexto(esc(t).replace(/\n/g, '<br>')); }
  }
  P.duplicar = function() { P.copiar(false); P.pegar(); };
  P.eliminarSeleccion = function() {
    var d = P.diap(), sel = P.est.sel.slice();
    d.elementos = d.elementos.filter(function(e) {
      if (sel.indexOf(e.id) < 0) return true;
      if (e.marcador && (!P.textoVacio(e.html) || (e.tipo === 'imagen' && e.src))) { e.html = ''; if (e.tipo === 'imagen') { e.src = ''; e.vacia = true; } return true; }  // como PowerPoint: borra el contenido y queda el marcador
      return false;
    });
    P.est.sel = []; P.pintarEscena(); P.cambio();
  };

  // ---------- Diapositivas ----------
  P.nuevaDiapositiva = function(disenoId) {
    if (P.est.soloLectura) return;
    salirEdicion();
    var act = P.diap(), id = disenoId || (act && act.diseno === 'titulo' ? 'tituloObjetos' : act ? act.diseno : 'tituloObjetos');
    if (!P.pres.disenos.some(function(d) { return d.id === id; })) id = P.pres.disenos[Math.min(1, P.pres.disenos.length - 1)].id;
    var d = P.diapositivaDesdeDiseno(P.pres, id);
    P.pres.diapositivas.splice(P.est.actual + 1, 0, d);
    P.cambio(); P.pintarMinis(); P.ir(P.est.actual + 1);
  };
  P.duplicarDiapositiva = function() {
    var d = JSON.parse(JSON.stringify(P.diap())); d.id = P.uid('d'); d.elementos.forEach(function(e) { e.id = P.uid(); });
    P.pres.diapositivas.splice(P.est.actual + 1, 0, d); P.cambio(); P.pintarMinis(); P.ir(P.est.actual + 1);
  };
  P.eliminarDiapositiva = function() {
    if (P.pres.diapositivas.length <= 1) { NV.toast('La presentación debe tener al menos una diapositiva.'); return; }
    P.pres.diapositivas.splice(P.est.actual, 1);
    P.est.actual = Math.min(P.est.actual, P.pres.diapositivas.length - 1);
    P.cambio(); P.pintarTodo();
  };
  P.moverDiapositiva = function(de, a) {
    if (de === a || P.est.soloLectura) return;
    var d = P.pres.diapositivas.splice(de, 1)[0]; P.pres.diapositivas.splice(a, 0, d);
    P.est.actual = a; P.cambio(); P.pintarTodo();
  };

  // ---------- Historial ----------
  var tHist = null;
  P.cambio = function(agrupar) {  // registra un cambio (agrupar = escritura continua)
    if (P.est.soloLectura) return;
    clearTimeout(tHist);
    var registrar = function() {
      var todo = foto();
      if (hist[histI] === todo) return;
      hist = hist.slice(0, histI + 1); hist.push(todo); if (hist.length > 60) hist.shift(); histI = hist.length - 1;
      P.estado();
    };
    if (agrupar) tHist = setTimeout(registrar, 600); else registrar();
    P.est.guardado = false; pintarGuardado();
    clearTimeout(tGuardar); if (P.est.autoguardado) tGuardar = setTimeout(function() { P.guardar(); }, 1500);
    if (!agrupar) { P.pintarMini(P.est.actual); P.cinta && P.cinta.refrescar(); }
    else { clearTimeout(P._tMini); P._tMini = setTimeout(function() { P.pintarMini(P.est.actual); }, 400); }
  };
  P.deshacer = function() {
    if (P.est.editando) { document.execCommand('undo'); return; }
    if (histI <= 0) return; histI--; restaurarSnap(hist[histI]);
  };
  P.rehacer = function() {
    if (P.est.editando) { document.execCommand('redo'); return; }
    if (histI >= hist.length - 1) return; histI++; restaurarSnap(hist[histI]);
  };
  // Foto del estado para deshacer (sin las imágenes, que se guardan aparte y no cambian)
  var CLAVES = ['diapositivas', 'disenos', 'tema', 'temaId', 'tam', 'pie'];
  function foto() { var o = {}; CLAVES.forEach(function(k) { o[k] = P.pres[k]; }); return JSON.stringify(o); }
  function restaurarSnap(txt) {
    var o; try { o = JSON.parse(txt); } catch (x) { return; }
    CLAVES.forEach(function(k) { if (o[k] !== undefined) P.pres[k] = o[k]; });
    if (P.ajustarZoom) P.ajustarZoom();
    P.est.sel = []; P.est.editando = null; P.est.actual = Math.min(P.est.actual, P.pres.diapositivas.length - 1);
    P.pintarTodo(); P.est.guardado = false; pintarGuardado();
    clearTimeout(tGuardar); if (P.est.autoguardado) tGuardar = setTimeout(function() { P.guardar(); }, 1500);
  }
  P.historialReset = function() { hist = [foto()]; histI = 0; };

  // ---------- Guardar ----------
  var tGuardar = null;
  function pintarGuardado() {
    var e = NV.$('#nvpEstado'); if (!e) return;
    e.textContent = P.est.soloLectura ? '· Solo lectura' : P.est.guardando ? '· Guardando…' : P.est.guardado ? '· Guardado' : (P.est.autoguardado ? '· Guardando…' : '· Sin guardar');
  }
  P.pintarGuardado = pintarGuardado;
  P.guardar = function(forzar) {
    clearTimeout(tGuardar);
    if (!P.doc || P.est.soloLectura) return Promise.resolve();
    if (P.est.guardando) { P.est.pendiente = true; return Promise.resolve(); }
    if (P.est.guardado && !forzar) return Promise.resolve();
    if (P.est.editando) { var inn = P.editable(), e = buscarEl(P.est.editando); if (inn && e) e.html = limpiarHtml(inn.innerHTML); }
    podarRecursos();
    P.est.guardando = true; P.est.guardado = true; pintarGuardado();
    var cuerpo = {version: P.doc.version, titulo: P.doc.titulo, contenido: JSON.stringify(P.pres), ajustes: {tipo: 'ppt'}};
    if (forzar === 'forzar') cuerpo.forzar = true;
    var url = P.doc.esPlantilla ? '/design/api/office/plantillas/' + P.doc.id : '/design/api/office/docs/' + P.doc.id;
    var miniatura = P.doc.esPlantilla ? P.show.miniatura(0).catch(function() { return null; }) : Promise.resolve(null);
    return miniatura.then(function(m) {
      if (m) cuerpo.miniatura = m;
      return NV.api(url, {json: cuerpo});
    }).then(function(r) { P.doc.version = r.version; }).catch(function(e) {
      P.est.guardado = false;
      if (e.status === 409) {
        return NV.dialogo({titulo: 'Conflicto al guardar', html: '<p style="line-height:1.5;margin:0">' + esc(e.message) + '</p>', ancho: 460,
          botones: [{texto: 'Guardar mi versión', prim: true, valor: 'mia'}, {texto: 'Abrir la otra versión', valor: 'otra'}, {texto: 'Cancelar', valor: null}]}).then(function(v) {
          if (v === 'mia') { P.est.guardando = false; return P.guardar('forzar'); }
          if (v === 'otra') { P.est.guardado = true; return P.doc.esPlantilla ? NV.plantillas.editar(P.doc.id) : P.abrirPorId(P.doc.id); }
        });
      }
      NV.toast('No se guardó: ' + e.message, true);
    }).then(function() {
      P.est.guardando = false; pintarGuardado();
      if (P.est.pendiente) { P.est.pendiente = false; if (!P.est.guardado) P.guardar(); }
    });
  };
  window.addEventListener('beforeunload', function(e) { if (P.doc && !P.est.guardado && !P.est.soloLectura) { P.guardar(); e.preventDefault(); e.returnValue = ''; } });
  P.renombrar = function() {
    if (!P.doc || P.est.soloLectura) return Promise.resolve();
    return NV.preguntar('Cambiar nombre', 'Nombre:', P.doc.titulo).then(function(t) {
      t = (t || '').trim(); if (!t || t === P.doc.titulo) return;
      P.doc.titulo = t; NV.$('#nvpTitulo').textContent = t; document.title = t + ' - Nuvia PowerPoint'; P.est.guardado = false; return P.guardar();
    });
  };

  // ---------- Vistas ----------
  P.vista = function(v) {
    salirEdicion();
    if (v === 'lectura') { P.show.iniciar(P.est.actual, {ventana: true}); return; }
    P.est.vista = v;
    NV.$$('[data-pvista]').forEach(function(b) { b.classList.toggle('on', b.getAttribute('data-pvista') === v); });
    var cl = NV.$('#nvpClasificador'), centro = NV.$('#nvVistaPpt .nvp-centro'), minis = NV.$('#nvpMinis');
    cl.classList.toggle('nv-oculto', v !== 'clasificador'); centro.classList.toggle('nv-oculto', v === 'clasificador'); minis.classList.toggle('nv-oculto', v === 'clasificador');
    if (v === 'clasificador') pintarClasificador();
    else { P.ajustarZoom(); P.pintarEscena(); }
    P.cinta && P.cinta.refrescar();
  };
  function pintarClasificador() {
    var cl = NV.$('#nvpClasificador'), tam = P.pres.tam, k = 240 / tam.w; cl.innerHTML = '';
    P.pres.diapositivas.forEach(function(d, i) {
      var c = document.createElement('div'); c.className = 'nvp-clas' + (i === P.est.actual ? ' on' : '') + (d.oculta ? ' oculta' : ''); c.draggable = !P.est.soloLectura; c.setAttribute('data-i', i);
      var marco = document.createElement('div'); marco.className = 'nvp-mini-marco'; marco.style.width = tam.w * k + 'px'; marco.style.height = tam.h * k + 'px';
      var r = P.render(d, {modo: 'mini', numero: i + 1}); r.style.transformOrigin = '0 0'; r.style.transform = 'scale(' + k + ')'; marco.appendChild(r);
      c.appendChild(marco); var n = document.createElement('div'); n.className = 'nvp-clas-n'; n.textContent = (i + 1) + (d.transicion && d.transicion.tipo !== 'ninguna' ? '  ★' : ''); c.appendChild(n);
      cl.appendChild(c);
    });
    var arr = null;
    cl.onclick = function(e) { var c = e.target.closest('[data-i]'); if (c) { P.est.actual = +c.dataset.i; NV.$$('.nvp-clas', cl).forEach(function(x) { x.classList.toggle('on', x === c); }); P.estado(); } };
    cl.ondblclick = function(e) { var c = e.target.closest('[data-i]'); if (c) { P.est.actual = +c.dataset.i; P.vista('normal'); } };
    cl.ondragstart = function(e) { var c = e.target.closest('[data-i]'); if (c) arr = +c.dataset.i; };
    cl.ondragover = function(e) { if (arr !== null) e.preventDefault(); };
    cl.ondrop = function(e) { e.preventDefault(); var c = e.target.closest('[data-i]'); if (c && arr !== null) { P.moverDiapositiva(arr, +c.dataset.i); pintarClasificador(); } arr = null; };
  }
})();
