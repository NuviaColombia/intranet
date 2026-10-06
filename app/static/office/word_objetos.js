/* Nuvia Word: tablas, imágenes, formas, gráficos, tabla de contenido, notas al pie y columnas. */
(function() {
  'use strict';
  var NV = window.NV, W = NV.word, esc = NV.esc;
  function ed() { return W.ed(); }
  function listo() { return ed() && !W.est.soloLectura; }
  function cambio() { W.marcarCambio(); W.paginar(); setTimeout(function() { if (W.cinta) W.cinta.refrescar(); }, 0); }
  W.colorPluma = '#000000';

  // ---------- Tablas ----------
  W.enTabla = function() { var e = ed(); return !!(e && e.dom.getParent(e.selection.getNode(), 'table')); };
  function tablaActual() { var e = ed(); return e && e.dom.getParent(e.selection.getNode(), 'table'); }
  function celdasSel() {
    var e = ed(), t = tablaActual(); if (!t) return [];
    var c = e.dom.getParent(e.selection.getNode(), 'td,th');
    var sel = NV.$$('td[data-mce-selected],th[data-mce-selected]', t);
    // varias celdas seleccionadas (arrastrando) → todas; si el cursor está en otra celda, solo esa
    if (sel.length > 1 && (!c || sel.indexOf(c) >= 0)) return sel;
    return c ? [c] : sel;
  }
  W.celdasSel = celdasSel;
  W.insertarTabla = function(filas, cols) {
    if (!listo()) return;
    var b = '1px solid #000', marca = 'nvt' + Date.now(), h = '<table style="border-collapse:collapse;width:100%" data-nv-estilo="cuadricula" data-nv-nueva="' + marca + '"><tbody>';
    for (var f = 0; f < filas; f++) {
      h += '<tr>';
      for (var c = 0; c < cols; c++) h += '<td style="border:' + b + ';width:' + (100 / cols).toFixed(2) + '%"><br></td>';
      h += '</tr>';
    }
    h += '</tbody></table><p><br data-mce-bogus="1"></p>';
    var e = ed(); e.focus(); e.insertContent(h);
    var t = e.getBody().querySelector('table[data-nv-nueva="' + marca + '"]');  // como Word: el cursor queda en la primera celda
    if (t) { t.removeAttribute('data-nv-nueva'); var td = t.querySelector('td'); if (td) { e.selection.setCursorLocation(td, 0); e.nodeChanged(); } }
    cambio();
  };
  W.textoATabla = function() {
    var e = ed(); if (!listo()) return;
    var bloques = W.bloquesSeleccionados().filter(function(b) { return b.nodeName === 'P'; });
    if (!bloques.length) { NV.toast('Selecciona los párrafos que quieres convertir (separa las columnas con tabulaciones, punto y coma o comas).'); return; }
    var sep = /\t/.test(bloques[0].textContent) ? '\t' : /;/.test(bloques[0].textContent) ? ';' : ',';
    var filas = bloques.map(function(b) { return b.textContent.split(sep); }), cols = Math.max.apply(null, filas.map(function(f) { return f.length; }));
    var h = '<table style="border-collapse:collapse;width:100%" data-nv-estilo="cuadricula"><tbody>' + filas.map(function(f) {
      var r = '<tr>'; for (var i = 0; i < cols; i++) r += '<td style="border:1px solid #000">' + esc((f[i] || '').trim()) + '</td>'; return r + '</tr>';
    }).join('') + '</tbody></table>';
    e.undoManager.transact(function() {
      var tmp = e.getDoc().createElement('div'); tmp.innerHTML = h;
      bloques[0].parentNode.insertBefore(tmp.firstChild, bloques[0]);
      bloques.forEach(function(b) { b.remove(); });
    });
    cambio();
  };
  W.opcionesTabla = function(t) {
    var o = {enc: true, tot: false, bandas: true, primCol: true, ultCol: false, colBandas: false};
    if (!t) return o;
    try { Object.assign(o, JSON.parse(t.getAttribute('data-nv-opc') || '{}')); } catch (e) {}
    return o;
  };
  var MAPA_OPC = {nvTEnc: 'enc', nvTTot: 'tot', nvTBandas: 'bandas', nvTPrimCol: 'primCol', nvTUltCol: 'ultCol', nvTColBandas: 'colBandas'};
  W.opcionTabla = function(id, on) {
    var t = tablaActual(); if (!t || !listo()) return;
    var o = W.opcionesTabla(t); o[MAPA_OPC[id]] = on;
    t.setAttribute('data-nv-opc', JSON.stringify(o));
    W.estiloTabla(t.getAttribute('data-nv-estilo') || 'cuadricula');
  };
  function aclarar(hex, k) {
    var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    var f = function(c) { return Math.round(c + (255 - c) * k); };
    return '#' + [f(r), f(g), f(b)].map(function(x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }
  // Estilos de tabla: se aplican como estilos en línea (así se ven igual en el .docx y en el PDF).
  function reglaEstilo(id, o) {
    var t = W.tema(), a1 = t.acentos[0], a2 = t.acentos[1];
    var R = {
      cuadricula: {borde: '1px solid #000', enc: {}, banda: null},
      normal: {borde: '', enc: {}, banda: null},
      clara: {borde: '1px solid #BFBFBF', enc: {'font-weight': 'bold'}, banda: null},
      enc1: {borde: '1px solid ' + aclarar(a1, 0.4), enc: {'background-color': a1, color: '#FFFFFF', 'font-weight': 'bold'}, banda: aclarar(a1, 0.8)},
      enc2: {borde: '1px solid ' + aclarar(a2, 0.4), enc: {'background-color': a2, color: '#FFFFFF', 'font-weight': 'bold'}, banda: aclarar(a2, 0.8)},
      lista: {borde: null, horiz: '1px solid ' + a1, enc: {'font-weight': 'bold', 'border-bottom': '1.5pt solid ' + a1}, banda: null},
      bandas: {borde: '1px solid #FFFFFF', enc: {'background-color': a1, color: '#FFFFFF', 'font-weight': 'bold'}, banda: aclarar(a1, 0.6), fondo: aclarar(a1, 0.8)},
      sencilla: {borde: '1px solid #BFBFBF', enc: {'font-weight': 'bold', 'background-color': '#F2F2F2'}, banda: '#F2F2F2'}
    };
    return R[id] || R.cuadricula;
  }
  W.miniTabla = function(id) {
    var r = reglaEstilo(id, {}), h = '<span style="display:grid;grid-template-columns:repeat(4,1fr);width:46px;height:38px;gap:0">';
    for (var f = 0; f < 5; f++) for (var c = 0; c < 4; c++) {
      var bg = f === 0 ? (r.enc['background-color'] || '#fff') : (r.banda && f % 2 === 1 ? r.banda : (r.fondo || '#fff'));
      var bd = r.borde ? 'border:' + r.borde.replace(/\d+(\.\d+)?(pt|px)/, '0.5px') : (r.horiz ? 'border-bottom:0.5px solid ' + W.tema().acentos[0] : 'border:0.5px dotted #ddd');
      h += '<i style="display:block;background:' + bg + ';' + bd + '"></i>';
    }
    return h + '</span>';
  };
  W.estiloTabla = function(id) {
    var e = ed(), t = tablaActual(); if (!t || !listo()) return;
    var o = W.opcionesTabla(t), r = reglaEstilo(id, o);
    e.undoManager.transact(function() {
      t.setAttribute('data-nv-estilo', id);
      var filas = NV.$$('tr', t);
      filas.forEach(function(tr, fi) {
        var esEnc = o.enc && fi === 0, esTot = o.tot && fi === filas.length - 1 && fi > 0;
        NV.$$('td,th', tr).forEach(function(td, ci, todas) {
          ['border', 'border-top', 'border-bottom', 'border-left', 'border-right', 'background-color', 'color', 'font-weight'].forEach(function(p) { td.style.removeProperty(p); });
          if (r.borde) td.style.border = r.borde;
          if (r.horiz) { td.style.borderTop = r.horiz; td.style.borderBottom = r.horiz; }
          if (r.fondo) td.style.backgroundColor = r.fondo;
          var bandaF = o.bandas && r.banda && !esEnc && ((fi - (o.enc ? 1 : 0)) % 2 === 0);
          var bandaC = o.colBandas && r.banda && ci % 2 === 0;
          if (bandaF || bandaC) td.style.backgroundColor = r.banda;
          if ((o.primCol && ci === 0) || (o.ultCol && ci === todas.length - 1)) td.style.fontWeight = 'bold';
          if (esEnc) Object.keys(r.enc).forEach(function(p) { td.style.setProperty(p, r.enc[p]); });
          if (esTot) { td.style.fontWeight = 'bold'; td.style.borderTop = '1.5pt double ' + (r.horiz ? W.tema().acentos[0] : '#000'); }
          if (!td.getAttribute('style')) td.removeAttribute('style');
        });
      });
    });
    cambio();
  };
  W.sombrearCeldas = function(c) {
    if (!listo()) return; var cs = celdasSel(); if (!cs.length) return;
    ed().undoManager.transact(function() { cs.forEach(function(td) { td.style.backgroundColor = c || ''; }); }); cambio();
  };
  W.bordesCeldas = function(tipo) {
    if (!listo()) return; var cs = celdasSel(); if (!cs.length) return;
    var est = (NV.$('#nvBordeEstilo') || {}).value || 'solid', gro = (NV.$('#nvBordeGrosor') || {}).value || '1';
    var b = est === 'none' ? 'none' : (gro + 'pt ' + est + ' ' + W.colorPluma);
    var t = tablaActual(), todas = NV.$$('td,th', t);
    var setB = function(td, lados) { lados.forEach(function(l) { td.style['border' + l] = b; }); };
    ed().undoManager.transact(function() {
      if (tipo === 'ninguno') { cs.forEach(function(td) { td.style.border = 'none'; }); return; }
      if (tipo === 'todos') { cs.forEach(function(td) { setB(td, ['Top', 'Bottom', 'Left', 'Right']); }); return; }
      var lim = limites(cs);
      cs.forEach(function(td) {
        var p = posCelda(td), l = [];
        if (tipo === 'sup' && p.f === lim.f0) l.push('Top');
        if (tipo === 'inf' && p.f2 === lim.f1) l.push('Bottom');
        if (tipo === 'izq' && p.c === lim.c0) l.push('Left');
        if (tipo === 'der' && p.c2 === lim.c1) l.push('Right');
        if (tipo === 'ext') { if (p.f === lim.f0) l.push('Top'); if (p.f2 === lim.f1) l.push('Bottom'); if (p.c === lim.c0) l.push('Left'); if (p.c2 === lim.c1) l.push('Right'); }
        if (tipo === 'int') { if (p.f > lim.f0) l.push('Top'); if (p.f2 < lim.f1) l.push('Bottom'); if (p.c > lim.c0) l.push('Left'); if (p.c2 < lim.c1) l.push('Right'); }
        setB(td, l);
      });
    });
    cambio();
  };
  function posCelda(td) {
    var tr = td.parentNode, f = Array.prototype.indexOf.call(tr.parentNode.children, tr), c = Array.prototype.indexOf.call(tr.children, td);
    return {f: f, c: c, f2: f + (td.rowSpan || 1) - 1, c2: c + (td.colSpan || 1) - 1};
  }
  function limites(cs) {
    var l = {f0: 1e9, f1: -1, c0: 1e9, c1: -1};
    cs.forEach(function(td) { var p = posCelda(td); l.f0 = Math.min(l.f0, p.f); l.f1 = Math.max(l.f1, p.f2); l.c0 = Math.min(l.c0, p.c); l.c1 = Math.max(l.c1, p.c2); });
    return l;
  }
  W.seleccionarTabla = function(q) {
    var e = ed(), t = tablaActual(); if (!t) return;
    var td = e.dom.getParent(e.selection.getNode(), 'td,th');
    if (q === 'tabla') { e.selection.select(t); return; }
    if (q === 'celda' && td) { e.selection.select(td, true); return; }
    var objetivo = q === 'fila' ? NV.$$('td,th', td.parentNode) : NV.$$('tr', t).map(function(tr) { return tr.children[posCelda(td).c]; }).filter(Boolean);
    NV.$$('[data-mce-selected]', t).forEach(function(x) { x.removeAttribute('data-mce-selected'); });
    objetivo.forEach(function(x) { x.setAttribute('data-mce-selected', '1'); });
    var r = e.getDoc().createRange(); r.setStartBefore(objetivo[0]); r.setEndAfter(objetivo[objetivo.length - 1]); e.selection.setRng(r);
  };
  W.vaciarCeldas = function() { if (!listo()) return; ed().undoManager.transact(function() { celdasSel().forEach(function(td) { td.innerHTML = '<br>'; }); }); cambio(); };
  W.dividirTabla = function() {
    var e = ed(), t = tablaActual(); if (!t || !listo()) return;
    var tr = e.dom.getParent(e.selection.getNode(), 'tr'); if (!tr || tr === t.rows[0]) { NV.toast('Ubica el cursor en la fila donde empieza la segunda tabla.'); return; }
    e.undoManager.transact(function() {
      var nueva = t.cloneNode(false), tb = e.getDoc().createElement('tbody'); nueva.appendChild(tb);
      var sig; while ((sig = tr.nextSibling)) tb.appendChild(sig);
      tb.insertBefore(tr, tb.firstChild);
      var p = e.getDoc().createElement('p'); p.innerHTML = '<br>';
      t.parentNode.insertBefore(p, t.nextSibling); p.parentNode.insertBefore(nueva, p.nextSibling);
    });
    cambio();
  };
  W.distribuir = function(que) {
    var t = tablaActual(); if (!t || !listo()) return;
    ed().undoManager.transact(function() {
      if (que === 'cols') { var n = t.rows[0] ? t.rows[0].cells.length : 1; NV.$$('td,th', t).forEach(function(td) { td.style.width = (100 / n * (td.colSpan || 1)).toFixed(2) + '%'; }); }
      else { var h = Math.max.apply(null, NV.$$('tr', t).map(function(r) { return r.offsetHeight; })); NV.$$('tr', t).forEach(function(r) { r.style.height = NV.pxACm(h).toFixed(2) + 'cm'; }); }
    });
    cambio();
  };
  W.tamCelda = function(que, cm) {
    var e = ed(), td = e.dom.getParent(e.selection.getNode(), 'td,th'); if (!td || !listo()) return;
    e.undoManager.transact(function() {
      if (que === 'alto') td.parentNode.style.height = cm + 'cm';
      else { var c = posCelda(td).c; NV.$$('tr', tablaActual()).forEach(function(tr) { if (tr.children[c]) tr.children[c].style.width = cm + 'cm'; }); }
    });
    cambio();
  };
  W.alinearCeldas = function(v, h) {
    if (!listo()) return;
    ed().undoManager.transact(function() { celdasSel().forEach(function(td) { td.style.verticalAlign = v; td.style.textAlign = h; NV.$$('p', td).forEach(function(p) { p.style.textAlign = ''; }); }); }); cambio();
  };
  W.repetirEncabezado = function() {
    var e = ed(), t = tablaActual(); if (!t || !listo()) return;
    var thead = t.querySelector('thead');
    e.undoManager.transact(function() {
      if (thead) { var tb = t.querySelector('tbody') || t; while (thead.lastChild) tb.insertBefore(thead.lastChild, tb.firstChild); thead.remove(); NV.toast('La fila de título ya no se repite.'); }
      else { var th = e.getDoc().createElement('thead'); t.insertBefore(th, t.firstChild); th.appendChild(t.querySelector('tr')); NV.toast('La primera fila se repetirá en cada página (al imprimir y en PDF/Word).'); }
    });
    cambio();
  };
  W.tablaATexto = function() {
    var e = ed(), t = tablaActual(); if (!t || !listo()) return;
    e.undoManager.transact(function() {
      var h = NV.$$('tr', t).map(function(tr) { return '<p>' + NV.$$('td,th', tr).map(function(c) { return esc(c.textContent.trim()); }).join('\t') + '</p>'; }).join('');
      var tmp = e.getDoc().createElement('div'); tmp.innerHTML = h;
      while (tmp.firstChild) t.parentNode.insertBefore(tmp.firstChild, t);
      t.remove();
    });
    cambio();
  };
  W.ordenarTabla = function(col, desc, tipo, conEnc) {
    var e = ed(), t = tablaActual(); if (!t || !listo()) return;
    var cuerpo = t.querySelector('tbody') || t, filas = NV.$$('tr', cuerpo).filter(function(tr) { return tr.parentNode === cuerpo; });
    var enc = conEnc && !t.querySelector('thead') ? filas.shift() : null;
    var val = function(tr) { var c = tr.children[col]; var s = c ? c.textContent.trim() : ''; return tipo === 'numero' ? (parseFloat(s.replace(/[^\d,.-]/g, '').replace(',', '.')) || 0) : tipo === 'fecha' ? (Date.parse(s) || 0) : s.toLowerCase(); };
    filas.sort(function(a, b) { var x = val(a), y = val(b); var r = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'es'); return desc ? -r : r; });
    e.undoManager.transact(function() { if (enc) cuerpo.appendChild(enc); filas.forEach(function(f) { cuerpo.appendChild(f); }); });
    if (t.getAttribute('data-nv-estilo')) W.estiloTabla(t.getAttribute('data-nv-estilo'));
    cambio();
  };

  // ---------- Imágenes ----------
  function imagenActual() { var e = ed(), n = e && e.selection.getNode(); return n && n.nodeName === 'IMG' ? n : null; }
  W.estiloImagen = function(id) {
    var im = imagenActual(); if (!im || !listo()) return;
    var s = W.cinta.ESTILOS_IMG.filter(function(x) { return x.id === id; })[0]; if (!s) return;
    ed().undoManager.transact(function() {
      ['border', 'box-shadow', 'border-radius'].forEach(function(p) { im.style.removeProperty(p); });
      if (s.css) s.css.split(';').forEach(function(d) { var i = d.indexOf(':'); if (i > 0) im.style.setProperty(d.slice(0, i).trim(), d.slice(i + 1).trim()); });
      im.setAttribute('data-nv-estilo', id);
    });
    cambio();
  };
  W.bordeImagen = function(c) { var im = imagenActual(); if (!im || !listo()) return; im.style.border = c ? '2px solid ' + c : ''; cambio(); };
  W.ajusteImagen = function(k) {
    var im = imagenActual(); if (!im || !listo()) return;
    ed().undoManager.transact(function() {
      ['float', 'display', 'margin', 'margin-left', 'margin-right'].forEach(function(p) { im.style.removeProperty(p); });
      if (k === 'izq') { im.style.float = 'left'; im.style.margin = '0 12pt 6pt 0'; }
      else if (k === 'der') { im.style.float = 'right'; im.style.margin = '0 0 6pt 12pt'; }
      else if (k === 'centro') { im.style.display = 'block'; im.style.marginLeft = 'auto'; im.style.marginRight = 'auto'; }
    });
    cambio();
  };
  W.tamImagen = function(que, cm) {
    var im = imagenActual(); if (!im || !listo() || !(cm > 0)) return;
    var px = NV.cmAPx(cm), prop = im.getAttribute('data-nv-libre') !== '1', r = (im.naturalWidth || im.width) / (im.naturalHeight || im.height || 1);
    ed().undoManager.transact(function() {
      if (que === 'ancho') { im.style.width = cm + 'cm'; im.setAttribute('width', Math.round(px)); if (prop) { im.style.height = (cm / r).toFixed(2) + 'cm'; im.setAttribute('height', Math.round(px / r)); } }
      else { im.style.height = cm + 'cm'; im.setAttribute('height', Math.round(px)); if (prop) { im.style.width = (cm * r).toFixed(2) + 'cm'; im.setAttribute('width', Math.round(px * r)); } }
      im.style.maxWidth = '100%';
    });
    cambio();
  };
  // Los cambios de color y giro se hacen sobre los píxeles (así quedan iguales en Word y en el PDF).
  function reprocesar(im, fn) {
    if (!im.getAttribute('data-nv-original')) im.setAttribute('data-nv-original', im.src.length < 3e6 ? im.src : '');
    var img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = function() {
      try {
        var c = document.createElement('canvas'), r = fn(c, img);
        var png = /^data:image\/png/.test(im.src) || /svg/.test(im.src);
        var url = c.toDataURL(png ? 'image/png' : 'image/jpeg', 0.92);
        ed().undoManager.transact(function() {
          im.src = url; im.setAttribute('data-mce-src', url);
          if (r && r.swap) { var w = im.style.width, h = im.style.height; im.style.width = h; im.style.height = w; var aw = im.getAttribute('width'), ah = im.getAttribute('height'); if (aw) im.setAttribute('height', aw); if (ah) im.setAttribute('width', ah); }
        });
        cambio();
      } catch (e) { NV.toast('No se pudo modificar esta imagen (viene de otro sitio). Descárgala e insértala desde tu equipo.', true); }
    };
    img.src = im.src;
  }
  W.filtroImagen = function(f) {
    var im = imagenActual(); if (!im || !listo()) return;
    reprocesar(im, function(c, img) { c.width = img.naturalWidth; c.height = img.naturalHeight; var x = c.getContext('2d'); x.filter = f; x.drawImage(img, 0, 0); });
  };
  W.girarImagen = function(g) {
    var im = imagenActual(); if (!im || !listo()) return;
    reprocesar(im, function(c, img) {
      var w = img.naturalWidth, h = img.naturalHeight, x = c.getContext('2d');
      if (g === 90 || g === -90) { c.width = h; c.height = w; x.translate(h / 2, w / 2); x.rotate(g * Math.PI / 180); x.drawImage(img, -w / 2, -h / 2); return {swap: true}; }
      c.width = w; c.height = h;
      if (g === 'h') { x.translate(w, 0); x.scale(-1, 1); } else { x.translate(0, h); x.scale(1, -1); }
      x.drawImage(img, 0, 0);
    });
  };
  W.recortarImagen = function(im, rec) {  // rec en fracciones {x,y,w,h}
    reprocesar(im, function(c, img) {
      var sx = img.naturalWidth * rec.x, sy = img.naturalHeight * rec.y, sw = img.naturalWidth * rec.w, sh = img.naturalHeight * rec.h;
      c.width = Math.max(1, Math.round(sw)); c.height = Math.max(1, Math.round(sh));
      c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
      var ancho = parseFloat(im.style.width) || NV.pxACm(im.width);
      setTimeout(function() { im.style.width = (ancho * rec.w).toFixed(2) + 'cm'; im.style.height = 'auto'; im.removeAttribute('height'); im.setAttribute('width', Math.round(NV.cmAPx(ancho * rec.w))); W.paginar(); }, 0);
    });
  };
  W.restablecerImagen = function() {
    var im = imagenActual(); if (!im || !listo()) return;
    var o = im.getAttribute('data-nv-original');
    ed().undoManager.transact(function() {
      if (o) { im.src = o; im.setAttribute('data-mce-src', o); im.removeAttribute('data-nv-original'); }
      ['border', 'box-shadow', 'border-radius', 'filter'].forEach(function(p) { im.style.removeProperty(p); });
    });
    cambio();
  };

  // ---------- Formas (SVG) ----------
  W.FORMAS = {
    rect: {n: 'Rectángulo'}, redondeado: {n: 'Rectángulo redondeado'}, elipse: {n: 'Elipse'}, triangulo: {n: 'Triángulo'},
    rombo: {n: 'Rombo'}, pentagono: {n: 'Pentágono'}, hexagono: {n: 'Hexágono'}, estrella: {n: 'Estrella de 5 puntas'},
    flechaDer: {n: 'Flecha derecha'}, flechaIzq: {n: 'Flecha izquierda'}, flechaArr: {n: 'Flecha arriba'}, flechaAba: {n: 'Flecha abajo'},
    linea: {n: 'Línea'}, lineaFlecha: {n: 'Línea con flecha'}, llamada: {n: 'Llamada rectangular'}, nube: {n: 'Nube'},
    corazon: {n: 'Corazón'}, rayo: {n: 'Rayo'}, cruz: {n: 'Cruz'}, marco: {n: 'Marco'}, cilindro: {n: 'Cilindro'},
    chevron: {n: 'Cheurón'}, pergamino: {n: 'Cinta'}, circuloFlecha: {n: 'Flecha circular'}
  };
  W.svgForma = function(k, relleno, borde, grosor, texto, colorTexto, ancho, alto) {
    ancho = ancho || 100; alto = alto || 100;
    var w = ancho, h = alto, g = grosor || 1, s = 'fill="' + (relleno || 'none') + '" stroke="' + (borde || 'none') + '" stroke-width="' + g + '" stroke-linejoin="round"';
    var p = g / 2 + 1, iw = w - 2 * p, ih = h - 2 * p, cx = w / 2, cy = h / 2;
    var pts = function(arr) { return '<polygon ' + s + ' points="' + arr.map(function(q) { return (p + q[0] * iw).toFixed(1) + ',' + (p + q[1] * ih).toFixed(1); }).join(' ') + '"/>'; };
    var forma = {
      rect: '<rect ' + s + ' x="' + p + '" y="' + p + '" width="' + iw + '" height="' + ih + '"/>',
      redondeado: '<rect ' + s + ' x="' + p + '" y="' + p + '" width="' + iw + '" height="' + ih + '" rx="' + Math.min(iw, ih) * 0.16 + '"/>',
      elipse: '<ellipse ' + s + ' cx="' + cx + '" cy="' + cy + '" rx="' + iw / 2 + '" ry="' + ih / 2 + '"/>',
      triangulo: pts([[0.5, 0], [1, 1], [0, 1]]), rombo: pts([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]),
      pentagono: pts([[0.5, 0], [1, 0.38], [0.81, 1], [0.19, 1], [0, 0.38]]), hexagono: pts([[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]]),
      estrella: pts([[0.5, 0], [0.61, 0.35], [0.98, 0.35], [0.68, 0.57], [0.79, 0.91], [0.5, 0.7], [0.21, 0.91], [0.32, 0.57], [0.02, 0.35], [0.39, 0.35]]),
      flechaDer: pts([[0, 0.3], [0.6, 0.3], [0.6, 0], [1, 0.5], [0.6, 1], [0.6, 0.7], [0, 0.7]]),
      flechaIzq: pts([[1, 0.3], [0.4, 0.3], [0.4, 0], [0, 0.5], [0.4, 1], [0.4, 0.7], [1, 0.7]]),
      flechaArr: pts([[0.3, 1], [0.3, 0.4], [0, 0.4], [0.5, 0], [1, 0.4], [0.7, 0.4], [0.7, 1]]),
      flechaAba: pts([[0.3, 0], [0.3, 0.6], [0, 0.6], [0.5, 1], [1, 0.6], [0.7, 0.6], [0.7, 0]]),
      linea: '<line x1="' + p + '" y1="' + cy + '" x2="' + (w - p) + '" y2="' + cy + '" stroke="' + (borde || relleno || '#000') + '" stroke-width="' + Math.max(2, g) + '"/>',
      lineaFlecha: '<line x1="' + p + '" y1="' + cy + '" x2="' + (w - p - 10) + '" y2="' + cy + '" stroke="' + (borde || relleno || '#000') + '" stroke-width="' + Math.max(2, g) + '"/><polygon fill="' + (borde || relleno || '#000') + '" points="' + (w - p) + ',' + cy + ' ' + (w - p - 14) + ',' + (cy - 7) + ' ' + (w - p - 14) + ',' + (cy + 7) + '"/>',
      llamada: pts([[0, 0], [1, 0], [1, 0.72], [0.45, 0.72], [0.25, 1], [0.28, 0.72], [0, 0.72]]),
      nube: '<path ' + s + ' d="M' + (w * 0.25) + ',' + (h * 0.8) + ' a' + (w * 0.17) + ',' + (h * 0.17) + ' 0 0 1 0,-' + (h * 0.34) + ' a' + (w * 0.2) + ',' + (h * 0.2) + ' 0 0 1 ' + (w * 0.3) + ',-' + (h * 0.2) + ' a' + (w * 0.18) + ',' + (h * 0.18) + ' 0 0 1 ' + (w * 0.3) + ',' + (h * 0.14) + ' a' + (w * 0.15) + ',' + (h * 0.18) + ' 0 0 1 0,' + (h * 0.4) + ' z"/>',
      corazon: '<path ' + s + ' d="M' + cx + ',' + (h * 0.9) + ' C' + (w * 0.05) + ',' + (h * 0.55) + ' ' + (w * 0.05) + ',' + (h * 0.12) + ' ' + cx + ',' + (h * 0.3) + ' C' + (w * 0.95) + ',' + (h * 0.12) + ' ' + (w * 0.95) + ',' + (h * 0.55) + ' ' + cx + ',' + (h * 0.9) + ' z"/>',
      rayo: pts([[0.55, 0], [0.15, 0.55], [0.45, 0.55], [0.35, 1], [0.85, 0.4], [0.55, 0.4], [0.7, 0]]),
      cruz: pts([[0.35, 0], [0.65, 0], [0.65, 0.35], [1, 0.35], [1, 0.65], [0.65, 0.65], [0.65, 1], [0.35, 1], [0.35, 0.65], [0, 0.65], [0, 0.35], [0.35, 0.35]]),
      marco: '<path ' + s + ' fill-rule="evenodd" d="M' + p + ',' + p + 'h' + iw + 'v' + ih + 'h-' + iw + 'z M' + (p + iw * 0.15) + ',' + (p + ih * 0.15) + 'v' + (ih * 0.7) + 'h' + (iw * 0.7) + 'v-' + (ih * 0.7) + 'z"/>',
      cilindro: '<path ' + s + ' d="M' + p + ',' + (h * 0.15) + ' A' + (iw / 2) + ',' + (h * 0.12) + ' 0 0 1 ' + (w - p) + ',' + (h * 0.15) + ' V' + (h * 0.85) + ' A' + (iw / 2) + ',' + (h * 0.12) + ' 0 0 1 ' + p + ',' + (h * 0.85) + ' Z"/><path fill="none" stroke="' + (borde || '#000') + '" stroke-width="' + g + '" d="M' + p + ',' + (h * 0.15) + ' A' + (iw / 2) + ',' + (h * 0.12) + ' 0 0 0 ' + (w - p) + ',' + (h * 0.15) + '"/>',
      chevron: pts([[0, 0], [0.7, 0], [1, 0.5], [0.7, 1], [0, 1], [0.3, 0.5]]),
      pergamino: pts([[0, 0.2], [0.15, 0.2], [0.15, 0], [0.85, 0], [0.85, 0.2], [1, 0.2], [0.9, 0.5], [1, 0.8], [0.85, 0.8], [0.85, 1], [0.15, 1], [0.15, 0.8], [0, 0.8], [0.1, 0.5]]),
      circuloFlecha: '<path fill="none" stroke="' + (relleno || borde || '#000') + '" stroke-width="' + Math.max(6, g * 4) + '" d="M' + (w * 0.8) + ',' + (h * 0.3) + ' A' + (w * 0.35) + ',' + (h * 0.35) + ' 0 1 0 ' + (w * 0.85) + ',' + (h * 0.55) + '"/><polygon fill="' + (relleno || borde || '#000') + '" points="' + (w * 0.66) + ',' + (h * 0.22) + ' ' + (w * 0.95) + ',' + (h * 0.12) + ' ' + (w * 0.9) + ',' + (h * 0.42) + '"/>'
    }[k] || '';
    var txt = texto ? '<text x="' + cx + '" y="' + (cy + (k === 'llamada' ? -h * 0.14 : 0)) + '" font-family="Calibri, Carlito, Arial, sans-serif" font-size="' + Math.max(10, Math.min(w, h) * 0.14) + '" fill="' + (colorTexto || '#fff') +
      '" text-anchor="middle" dominant-baseline="middle">' + esc(texto) + '</text>' : '';
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' + forma + txt + '</svg>';
    return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
  };
  // Las formas se insertan como imagen PNG (con su definición guardada para volver a editarlas con doble clic).
  W.insertarForma = function(o, reemplazar) {
    var e = ed(); if (!listo()) return;
    var esc2 = 2, w = Math.round(NV.cmAPx(o.ancho)), h = Math.round(NV.cmAPx(o.alto));
    var img = new Image();
    img.onload = function() {
      var c = document.createElement('canvas'); c.width = w * esc2; c.height = h * esc2;
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      var url = c.toDataURL('image/png');
      var html = '<img src="' + url + '" alt="' + esc(W.FORMAS[o.forma].n + (o.texto ? ': ' + o.texto : '')) + '" data-nv-forma="' + esc(JSON.stringify(o)) + '" style="width:' + o.ancho + 'cm;height:' + o.alto + 'cm" width="' + w + '" height="' + h + '">';
      e.focus();
      if (reemplazar) { e.undoManager.transact(function() { e.dom.setOuterHTML(reemplazar, html); }); } else e.insertContent(html);
      cambio();
    };
    img.src = W.svgForma(o.forma, o.relleno, o.borde, o.grosor, o.texto, o.colorTexto, w, h);
  };

  // ---------- Gráficos (se dibujan como imagen y guardan sus datos para editarlos con doble clic) ----------
  W.dibujarGrafico = function(g, w, h) {
    var c = document.createElement('canvas'), k = 2; c.width = w * k; c.height = h * k;
    var x = c.getContext('2d'); x.scale(k, k); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
    var col = W.tema().acentos, series = g.series, cats = g.categorias;
    x.font = '600 15px Calibri, Carlito, Arial'; x.fillStyle = '#404040'; x.textAlign = 'center';
    var top = 12;
    if (g.titulo) { x.fillText(g.titulo, w / 2, 22); top = 34; }
    x.font = '12px Calibri, Carlito, Arial';
    var leyendaH = series.length > 1 || g.tipo === 'circular' ? 22 : 0;
    if (g.tipo === 'circular') {
      var datos = series[0] ? series[0].valores : [], tot = datos.reduce(function(s, v) { return s + Math.max(0, +v || 0); }, 0) || 1;
      var r = Math.min(w, h - top - leyendaH) / 2 - 10, cx = w / 2, cy = top + (h - top - leyendaH) / 2, a = -Math.PI / 2;
      datos.forEach(function(v, i) {
        var ang = Math.max(0, +v || 0) / tot * Math.PI * 2;
        x.beginPath(); x.moveTo(cx, cy); x.arc(cx, cy, r, a, a + ang); x.closePath(); x.fillStyle = col[i % col.length]; x.fill();
        x.strokeStyle = '#fff'; x.lineWidth = 1.5; x.stroke();
        if (ang > 0.25) { var m = a + ang / 2; x.fillStyle = '#fff'; x.font = 'bold 12px Calibri, Carlito, Arial'; x.fillText(Math.round(v / tot * 100) + '%', cx + Math.cos(m) * r * 0.62, cy + Math.sin(m) * r * 0.62 + 4); }
        a += ang;
      });
      leyenda(cats.map(function(cn, i) { return [cn, col[i % col.length]]; }));
      return c.toDataURL('image/png');
    }
    var izq = 44, der = 14, abajo = 28 + leyendaH, alto = h - top - abajo, ancho = w - izq - der;
    var todos = []; series.forEach(function(s) { s.valores.forEach(function(v) { todos.push(+v || 0); }); });
    var max = Math.max.apply(null, todos.concat([0])), min = Math.min.apply(null, todos.concat([0]));
    var paso = escalaPaso((max - min) || 1), vmax = Math.ceil(max / paso) * paso, vmin = Math.floor(min / paso) * paso;
    if (vmax === vmin) vmax = vmin + paso;
    var horiz = g.tipo === 'barras';
    var yv = function(v) { return top + alto - (v - vmin) / (vmax - vmin) * alto; };
    var xv = function(v) { return izq + (v - vmin) / (vmax - vmin) * ancho; };
    x.strokeStyle = '#D9D9D9'; x.lineWidth = 1; x.fillStyle = '#595959'; x.textAlign = horiz ? 'center' : 'right';
    for (var v = vmin; v <= vmax + 1e-9; v += paso) {
      x.beginPath();
      if (horiz) { x.moveTo(xv(v), top); x.lineTo(xv(v), top + alto); x.stroke(); x.fillText(fmt(v), xv(v), top + alto + 14); }
      else { x.moveTo(izq, yv(v)); x.lineTo(izq + ancho, yv(v)); x.stroke(); x.fillText(fmt(v), izq - 6, yv(v) + 4); }
    }
    var n = cats.length || 1, grupo = (horiz ? alto : ancho) / n;
    x.textAlign = horiz ? 'right' : 'center';
    cats.forEach(function(cn, i) {
      if (horiz) x.fillText(String(cn).slice(0, 10), izq - 4, top + grupo * (i + 0.5) + 4);
      else x.fillText(String(cn).slice(0, 14), izq + grupo * (i + 0.5), top + alto + 16);
    });
    if (g.tipo === 'lineas') {
      series.forEach(function(s, si) {
        x.strokeStyle = col[si % col.length]; x.lineWidth = 2.5; x.beginPath();
        s.valores.forEach(function(v2, i) { var px = izq + grupo * (i + 0.5), py = yv(+v2 || 0); if (i) x.lineTo(px, py); else x.moveTo(px, py); });
        x.stroke();
        s.valores.forEach(function(v2, i) { x.beginPath(); x.fillStyle = col[si % col.length]; x.arc(izq + grupo * (i + 0.5), yv(+v2 || 0), 3.5, 0, Math.PI * 2); x.fill(); });
      });
    } else {
      var bw = grupo * 0.7 / series.length;
      series.forEach(function(s, si) {
        x.fillStyle = col[si % col.length];
        s.valores.forEach(function(v2, i) {
          v2 = +v2 || 0;
          if (horiz) { var y0 = top + grupo * i + grupo * 0.15 + bw * si; x.fillRect(Math.min(xv(0), xv(v2)), y0, Math.abs(xv(v2) - xv(0)), bw - 2); }
          else { var x0 = izq + grupo * i + grupo * 0.15 + bw * si; x.fillRect(x0, Math.min(yv(0), yv(v2)), bw - 2, Math.abs(yv(v2) - yv(0))); }
        });
      });
    }
    if (series.length > 1) leyenda(series.map(function(s, i) { return [s.nombre, col[i % col.length]]; }));
    return c.toDataURL('image/png');
    function leyenda(items) {
      x.font = '12px Calibri, Carlito, Arial'; x.textAlign = 'left';
      var tot = items.reduce(function(s, it) { return s + x.measureText(it[0]).width + 26; }, 0), px = (w - tot) / 2, py = h - 10;
      items.forEach(function(it) { x.fillStyle = it[1]; x.fillRect(px, py - 9, 10, 10); x.fillStyle = '#404040'; x.fillText(it[0], px + 14, py); px += x.measureText(it[0]).width + 26; });
    }
    function escalaPaso(r) { var e2 = Math.pow(10, Math.floor(Math.log10(r / 5))), f = r / 5 / e2; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * e2; }
    function fmt(v2) { return Math.abs(v2) >= 1000 ? (v2 / 1000).toLocaleString('es-CO', {maximumFractionDigits: 1}) + ' k' : v2.toLocaleString('es-CO', {maximumFractionDigits: 2}); }
  };
  W.insertarGrafico = function(g, reemplazar) {
    var e = ed(); if (!listo()) return;
    var w = 560, h = 320, url = W.dibujarGrafico(g, w, h);
    var html = '<img src="' + url + '" alt="Gráfico: ' + esc(g.titulo || g.tipo) + '" data-nv-grafico="' + esc(JSON.stringify(g)) + '" style="width:15cm;height:8.57cm" width="' + Math.round(NV.cmAPx(15)) + '" height="' + Math.round(NV.cmAPx(8.57)) + '">';
    e.focus();
    if (reemplazar) e.undoManager.transact(function() { e.dom.setOuterHTML(reemplazar, html); }); else e.insertContent(html);
    cambio();
  };

  // ---------- Tabla de contenido ----------
  function titulosDoc() {
    var e = ed(), b = e.getBody(), P = NV.cmAPx(W.dim().h) + 24;
    return NV.$$('h1,h2,h3', b).filter(function(h) { return !h.closest('.nv-toc') && h.textContent.trim(); }).map(function(h, i) {
      if (!h.id) h.id = 'nv-t-' + Date.now().toString(36) + i;
      var top = h.offsetTop; var bl = h; while (bl.parentNode && bl.parentNode !== b) bl = bl.parentNode;
      return {id: h.id, n: +h.nodeName[1], t: h.textContent.trim(), p: W.numPagina(Math.floor(bl.offsetTop / P) + (W.aj.numInicio || 1))};
    });
  }
  function htmlTOC(titulo) {
    var lista = titulosDoc();
    var h = '<div class="nv-toc" contenteditable="false" data-nv-toc="' + esc(titulo) + '"><p class="nv-toc-t">' + esc(titulo) + '</p>';
    if (!lista.length) h += '<p><i>No se encontraron entradas de tabla de contenido. Aplica los estilos Título 1, Título 2 o Título 3 a los títulos del documento.</i></p>';
    lista.forEach(function(t) {
      h += '<p class="n' + t.n + '"><a href="#' + t.id + '">' + esc(t.t) + '</a><span class="nv-toc-p"></span><span>' + t.p + '</span></p>';
    });
    return h + '</div>';
  }
  W.insertarTOC = function(titulo) {
    var e = ed(); if (!listo()) return;
    var vieja = e.getBody().querySelector('.nv-toc');
    e.undoManager.transact(function() {
      if (vieja) { e.dom.setOuterHTML(vieja, htmlTOC(titulo)); return; }
      e.insertContent(htmlTOC(titulo) + '<p><br data-mce-bogus="1"></p>');
    });
    cambio(); setTimeout(function() { W.paginarYa(); W.actualizarTOC(true); }, 50);
  };
  W.actualizarTOC = function(silencio) {
    var e = ed(), t = e && e.getBody().querySelector('.nv-toc'); if (!t) return false;
    W.paginarYa();
    var nuevo = htmlTOC(t.getAttribute('data-nv-toc') || 'Contenido');
    if (t.outerHTML !== nuevo) { e.undoManager.transact(function() { e.dom.setOuterHTML(t, nuevo); }); cambio(); }
    return true;
  };
  W.insertarTablaIlustraciones = function() {
    var e = ed(), caps = NV.$$('p.nv-Caption', e.getBody()); if (!caps.length) { NV.toast('No hay títulos de figuras o tablas. Usa Insertar título.'); return; }
    var P = NV.cmAPx(W.dim().h) + 24, b = e.getBody();
    var h = '<div class="nv-toc" contenteditable="false" data-nv-toc="Tabla de ilustraciones"><p class="nv-toc-t">Tabla de ilustraciones</p>' + caps.map(function(c, i) {
      if (!c.id) c.id = 'nv-cap-' + Date.now().toString(36) + i;
      var bl = c; while (bl.parentNode && bl.parentNode !== b) bl = bl.parentNode;
      return '<p class="n1"><a href="#' + c.id + '">' + esc(c.textContent.trim()) + '</a><span class="nv-toc-p"></span><span>' + (Math.floor(bl.offsetTop / P) + 1) + '</span></p>';
    }).join('') + '</div><p><br data-mce-bogus="1"></p>';
    e.insertContent(h); cambio();
  };

  // ---------- Notas al pie y al final (se listan al final del documento; en Word quedan como notas reales) ----------
  W.insertarNota = function(tipo) {
    var e = ed(); if (!listo()) return;
    var cls = tipo === 'final' ? 'nv-notas-final' : 'nv-notas-pie';
    var b = e.getBody(), lista = b.querySelector('.' + cls);
    var n = NV.$$('sup.nv-nota[data-tipo="' + tipo + '"]', b).length + 1;
    var id = 'nv-n' + tipo[0] + Date.now().toString(36);
    e.undoManager.transact(function() {
      e.insertContent('<sup class="nv-nota" data-tipo="' + tipo + '" data-nota="' + id + '"><a href="#' + id + '">' + (tipo === 'final' ? romanoMin(n) : n) + '</a></sup>');
      if (!lista) {
        var div = e.getDoc().createElement('div'); div.className = 'nv-notas ' + cls;
        div.innerHTML = '<hr><ol' + (tipo === 'final' ? ' style="list-style-type:lower-roman"' : '') + '></ol>';
        if (tipo === 'pie' && b.querySelector('.nv-notas-final')) b.insertBefore(div, b.querySelector('.nv-notas-final')); else b.appendChild(div);
        lista = div;
      }
      var li = e.getDoc().createElement('li'); li.id = id; li.innerHTML = '&nbsp;';
      lista.querySelector('ol').appendChild(li);
      renumerarNotas(tipo);
      e.selection.setCursorLocation(li, 0); li.scrollIntoView({block: 'center'});
    });
    cambio();
  };
  function romanoMin(n) { var v = [10, 9, 5, 4, 1], s = ['x', 'ix', 'v', 'iv', 'i'], r = ''; for (var i = 0; i < v.length; i++) while (n >= v[i]) { r += s[i]; n -= v[i]; } return r; }
  function renumerarNotas(tipo) {
    var e = ed(), b = e.getBody(), refs = NV.$$('sup.nv-nota[data-tipo="' + tipo + '"]', b), ol = b.querySelector('.nv-notas-' + (tipo === 'final' ? 'final' : 'pie') + ' ol');
    if (!ol) return;
    refs.forEach(function(r, i) {
      var a = r.querySelector('a'); if (a) a.textContent = tipo === 'final' ? romanoMin(i + 1) : String(i + 1);
      var li = e.getDoc().getElementById(r.getAttribute('data-nota')); if (li) ol.appendChild(li);
    });
  }
  W.renumerarNotas = function() { renumerarNotas('pie'); renumerarNotas('final'); };

  // ---------- Columnas (como una sección continua de Word) ----------
  W.columnas = function(n, extra, linea) {
    var e = ed(); if (!listo()) return;
    var bl = W.bloquesSeleccionados().map(function(b) { while (b.parentNode && b.parentNode !== e.getBody()) b = b.parentNode; return b; });
    bl = bl.filter(function(b, i) { return bl.indexOf(b) === i && b !== e.getBody(); });
    var unico = bl.length === 1 && bl[0].classList && bl[0].classList.contains('nv-cols') ? bl[0] : null;
    if (!unico && bl.length <= 1 && e.selection.isCollapsed()) {  // sin selección: todo el documento, como Word
      bl = Array.prototype.filter.call(e.getBody().children, function(x) { return !x.hasAttribute('data-mce-bogus'); });
    }
    e.undoManager.transact(function() {
      var cont = unico || bl.filter(function(x) { return x.classList && x.classList.contains('nv-cols'); })[0];
      if (n === 1) {
        NV.$$('.nv-cols', e.getBody()).filter(function(c) { return bl.indexOf(c) >= 0 || c === unico; }).forEach(function(c) { while (c.firstChild) c.parentNode.insertBefore(c.firstChild, c); c.remove(); });
        return;
      }
      if (!cont) {
        cont = e.getDoc().createElement('div'); cont.className = 'nv-cols';
        bl[0].parentNode.insertBefore(cont, bl[0]);
        bl.forEach(function(b) { if (b.classList && b.classList.contains('nv-cols')) { while (b.firstChild) cont.appendChild(b.firstChild); b.remove(); } else cont.appendChild(b); });
      }
      cont.style.columnCount = n;
      cont.style.columnWidth = '';
      cont.classList.toggle('linea', !!linea);
      cont.setAttribute('data-nv-cols', extra || '');
      if (extra === 'izq' || extra === 'der') { cont.style.columnCount = 2; }
    });
    cambio();
  };

  // ---------- Selección de texto con formato similar ----------
  W.seleccionarSimilar = function() {
    var e = ed(), n = e.selection.getNode(); if (n.nodeType !== 1) n = n.parentNode;
    var cs = e.getWin().getComputedStyle(n), clave = [cs.fontFamily, cs.fontSize, cs.fontWeight, cs.fontStyle, cs.color].join('|');
    var iguales = NV.$$('p,h1,h2,h3,h4,h5,h6,li', e.getBody()).filter(function(p) { var c = e.getWin().getComputedStyle(p); return [c.fontFamily, c.fontSize, c.fontWeight, c.fontStyle, c.color].join('|') === clave; });
    if (!iguales.length) return;
    var r = e.getDoc().createRange(); r.setStartBefore(iguales[0]); r.setEndAfter(iguales[iguales.length - 1]); e.selection.setRng(r);
    NV.toast(iguales.length + ' párrafos con formato similar (se seleccionó del primero al último).');
  };
})();
