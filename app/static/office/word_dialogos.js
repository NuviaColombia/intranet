/* Nuvia Word: cuadros de diálogo y paneles (navegación / búsqueda). */
(function() {
  'use strict';
  var NV = window.NV, W = NV.word, esc = NV.esc;
  var D = W.dialogos = {}, P = W.paneles = {};
  function ed() { return W.ed(); }
  function listo() { return ed() && !W.est.soloLectura; }
  function cambio() { W.marcarCambio(); W.paginar(); setTimeout(function() { if (W.cinta) W.cinta.refrescar(); }, 0); }
  function v(d, id) { var el = d.querySelector('#' + id); return el ? (el.type === 'checkbox' ? el.checked : el.value) : null; }
  function num(d, id) { var x = parseFloat(String(v(d, id)).replace(',', '.')); return isNaN(x) ? null : x; }
  function opts(lista, sel) { return lista.map(function(o) { var val = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o; return '<option value="' + esc(val) + '"' + (String(val) === String(sel) ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join(''); }

  // ---------- Fuente ----------
  D.fuente = function() {
    if (!listo()) return;
    var e = ed(), n = e.selection.getNode(); if (n.nodeType !== 1) n = n.parentNode;
    var cs = e.getWin().getComputedStyle(n), f = NV.fuentePorNombre(cs.fontFamily), tam = Math.round(NV.pxAPt(parseFloat(cs.fontSize)) * 2) / 2;
    var estilo = (cs.fontWeight >= 600 ? 'b' : '') + (cs.fontStyle === 'italic' ? 'i' : '');
    var html = '<div class="nv-filas3"><div class="nv-campo"><label for="dfF">Fuente</label><select id="dfF">' + opts(NV.FUENTES.map(function(x) { return x.n; }), f ? f.n : '') + '</select></div>' +
      '<div class="nv-campo"><label for="dfE">Estilo</label><select id="dfE">' + opts([['', 'Normal'], ['i', 'Cursiva'], ['b', 'Negrita'], ['bi', 'Negrita Cursiva']], estilo) + '</select></div>' +
      '<div class="nv-campo"><label for="dfT">Tamaño</label><input type="number" id="dfT" step="0.5" min="1" value="' + tam + '"></div></div>' +
      '<div class="nv-filas3"><div class="nv-campo"><label for="dfC">Color de fuente</label><input type="color" id="dfC" value="' + rgbAHex(cs.color) + '" style="width:100%;height:32px"></div>' +
      '<div class="nv-campo"><label for="dfS">Subrayado</label><select id="dfS">' + opts([['', '(ninguno)'], ['solid', 'Sencillo'], ['double', 'Doble'], ['dotted', 'Punteado'], ['dashed', 'Discontinuo'], ['wavy', 'Ondulado']], /underline/.test(cs.textDecorationLine) ? cs.textDecorationStyle : '') + '</select></div>' +
      '<div class="nv-campo"><label for="dfEsp">Espaciado (pto)</label><input type="number" id="dfEsp" step="0.5" value="' + (parseFloat(cs.letterSpacing) ? NV.pxAPt(parseFloat(cs.letterSpacing)).toFixed(1) : 0) + '"></div></div>' +
      '<fieldset><legend>Efectos</legend><div class="nv-filas3">' +
      '<label class="nv-chk"><input type="checkbox" id="dfTach"' + (/line-through/.test(cs.textDecorationLine) ? ' checked' : '') + '> Tachado</label>' +
      '<label class="nv-chk"><input type="checkbox" id="dfSup"' + (cs.verticalAlign === 'super' ? ' checked' : '') + '> Superíndice</label>' +
      '<label class="nv-chk"><input type="checkbox" id="dfSub"' + (cs.verticalAlign === 'sub' ? ' checked' : '') + '> Subíndice</label>' +
      '<label class="nv-chk"><input type="checkbox" id="dfVers"' + (cs.fontVariant === 'small-caps' ? ' checked' : '') + '> Versalitas</label>' +
      '<label class="nv-chk"><input type="checkbox" id="dfMay"' + (cs.textTransform === 'uppercase' ? ' checked' : '') + '> Mayúsculas</label>' +
      '<label class="nv-chk"><input type="checkbox" id="dfOcu"> Oculto</label></div></fieldset>' +
      '<div style="border:1px solid #e1dfdd;border-radius:4px;padding:14px;text-align:center;font-size:18px" id="dfVista">AaBbYyZz</div>';
    NV.dialogo({titulo: 'Fuente', html: html, ancho: 560, alAbrir: function(d) {
      var vista = function() {
        var x = d.querySelector('#dfVista'), fu = NV.fuentePorNombre(v(d, 'dfF'));
        x.style.fontFamily = fu ? fu.css : ''; x.style.fontWeight = /b/.test(v(d, 'dfE')) ? 'bold' : ''; x.style.fontStyle = /i/.test(v(d, 'dfE')) ? 'italic' : '';
        x.style.color = v(d, 'dfC'); x.style.textDecoration = (v(d, 'dfS') ? 'underline ' + v(d, 'dfS') : '') + (v(d, 'dfTach') ? ' line-through' : '');
        x.style.fontVariant = v(d, 'dfVers') ? 'small-caps' : ''; x.style.textTransform = v(d, 'dfMay') ? 'uppercase' : '';
        x.style.letterSpacing = (num(d, 'dfEsp') || 0) + 'pt';
      };
      d.addEventListener('input', vista); d.addEventListener('change', vista); vista();
    }, botones: [{texto: 'Aceptar', prim: true, accion: function(d) {
      e.focus();
      e.undoManager.transact(function() {
        var fu = NV.fuentePorNombre(v(d, 'dfF')); if (fu) e.execCommand('FontName', false, fu.css.replace(/"/g, ''));
        if (num(d, 'dfT')) e.execCommand('FontSize', false, num(d, 'dfT') + 'pt');
        var es = v(d, 'dfE');
        if (/b/.test(es) !== e.queryCommandState('Bold')) e.execCommand('Bold');
        if (/i/.test(es) !== e.queryCommandState('Italic')) e.execCommand('Italic');
        e.execCommand('ForeColor', false, v(d, 'dfC'));
        var st = {};
        var deco = [];
        if (v(d, 'dfS')) deco.push('underline'); if (v(d, 'dfTach')) deco.push('line-through');
        st['text-decoration'] = deco.join(' ') || 'none';
        if (v(d, 'dfS')) st['text-decoration-style'] = v(d, 'dfS');
        st['font-variant'] = v(d, 'dfVers') ? 'small-caps' : 'normal';
        st['text-transform'] = v(d, 'dfMay') ? 'uppercase' : 'none';
        if (num(d, 'dfEsp')) st['letter-spacing'] = num(d, 'dfEsp') + 'pt';
        if (v(d, 'dfOcu')) st.display = 'none';
        e.formatter.register('nvFuenteDlg', {inline: 'span', styles: st}); e.formatter.apply('nvFuenteDlg');
        if (v(d, 'dfSup') !== e.queryCommandState('Superscript')) e.execCommand('Superscript');
        if (v(d, 'dfSub') !== e.queryCommandState('Subscript')) e.execCommand('Subscript');
      });
      cambio(); return true;
    }}, {texto: 'Cancelar', valor: null}]});
  };
  function rgbAHex(c) { var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c || ''); return m ? '#' + [m[1], m[2], m[3]].map(function(x) { return ('0' + (+x).toString(16)).slice(-2); }).join('') : '#000000'; }
  W.rgbAHex = rgbAHex;

  // ---------- Párrafo ----------
  D.parrafo = function() {
    if (!listo()) return;
    var e = ed(), b = e.dom.getParent(e.selection.getNode(), e.dom.isBlock) || e.getBody().firstChild, cs = e.getWin().getComputedStyle(b);
    var fs = parseFloat(cs.fontSize) || 14.67, lh = cs.lineHeight === 'normal' ? 1.15 : parseFloat(cs.lineHeight) / fs;
    var ti = parseFloat(cs.textIndent) || 0;
    var html = '<fieldset><legend>General</legend><div class="nv-filas2"><div class="nv-campo"><label for="dpA">Alineación</label><select id="dpA">' +
      opts([['left', 'Izquierda'], ['center', 'Centrada'], ['right', 'Derecha'], ['justify', 'Justificada']], cs.textAlign === 'start' ? 'left' : cs.textAlign) + '</select></div>' +
      '<div class="nv-campo"><label for="dpN">Nivel de esquema</label><select id="dpN">' + opts([['p', 'Texto independiente'], ['h1', 'Nivel 1'], ['h2', 'Nivel 2'], ['h3', 'Nivel 3'], ['h4', 'Nivel 4']], /^H\d$/.test(b.nodeName) ? b.nodeName.toLowerCase() : 'p') + '</select></div></div></fieldset>' +
      '<fieldset><legend>Sangría</legend><div class="nv-filas2"><div class="nv-campo"><label for="dpI">Izquierda (cm)</label><input type="number" step="0.1" id="dpI" value="' + NV.pxACm(parseFloat(cs.marginLeft) || 0).toFixed(2) + '"></div>' +
      '<div class="nv-campo"><label for="dpD">Derecha (cm)</label><input type="number" step="0.1" id="dpD" value="' + NV.pxACm(parseFloat(cs.marginRight) || 0).toFixed(2) + '"></div>' +
      '<div class="nv-campo"><label for="dpE">Especial</label><select id="dpE">' + opts([['', '(ninguna)'], ['primera', 'Primera línea'], ['francesa', 'Francesa']], ti > 0 ? 'primera' : ti < 0 ? 'francesa' : '') + '</select></div>' +
      '<div class="nv-campo"><label for="dpEv">En (cm)</label><input type="number" step="0.1" id="dpEv" value="' + NV.pxACm(Math.abs(ti) || NV.cmAPx(1.27)).toFixed(2) + '"></div></div></fieldset>' +
      '<fieldset><legend>Espaciado</legend><div class="nv-filas2"><div class="nv-campo"><label for="dpAn">Anterior (pto)</label><input type="number" step="6" min="0" id="dpAn" value="' + Math.round(NV.pxAPt(parseFloat(cs.marginTop) || 0)) + '"></div>' +
      '<div class="nv-campo"><label for="dpPo">Posterior (pto)</label><input type="number" step="6" min="0" id="dpPo" value="' + Math.round(NV.pxAPt(parseFloat(cs.marginBottom) || 0)) + '"></div>' +
      '<div class="nv-campo"><label for="dpIn">Interlineado</label><select id="dpIn">' + opts([['1', 'Sencillo'], ['1.15', '1,15'], ['1.5', '1,5 líneas'], ['2', 'Doble'], ['multiple', 'Múltiple'], ['exacto', 'Exacto (pto)']],
        [1, 1.15, 1.5, 2].indexOf(Math.round(lh * 100) / 100) >= 0 ? String(Math.round(lh * 100) / 100) : 'multiple') + '</select></div>' +
      '<div class="nv-campo"><label for="dpInV">En</label><input type="number" step="0.01" min="0.5" id="dpInV" value="' + (Math.round(lh * 100) / 100) + '"></div></div>' +
      '<label class="nv-chk"><input type="checkbox" id="dpSalto"' + (cs.breakBefore === 'page' || cs.pageBreakBefore === 'always' ? ' checked' : '') + '> Salto de página anterior</label>' +
      '<label class="nv-chk"><input type="checkbox" id="dpJunto"' + (cs.breakAfter === 'avoid' ? ' checked' : '') + '> Conservar con el siguiente</label></fieldset>';
    NV.dialogo({titulo: 'Párrafo', html: html, ancho: 520, botones: [{texto: 'Aceptar', prim: true, accion: function(d) {
      e.focus();
      var st = {'text-align': v(d, 'dpA'), 'margin-left': num(d, 'dpI') + 'cm', 'margin-right': num(d, 'dpD') + 'cm',
                'margin-top': num(d, 'dpAn') + 'pt', 'margin-bottom': num(d, 'dpPo') + 'pt'};
      var esp = v(d, 'dpE'), ev = num(d, 'dpEv') || 0;
      st['text-indent'] = esp === 'primera' ? ev + 'cm' : esp === 'francesa' ? (-ev) + 'cm' : '';
      if (esp === 'francesa') st['padding-left'] = ev + 'cm'; else st['padding-left'] = '';
      var il = v(d, 'dpIn'), ilv = num(d, 'dpInV') || 1;
      st['line-height'] = il === 'exacto' ? ilv + 'pt' : il === 'multiple' ? String(ilv) : il;
      st['break-before'] = v(d, 'dpSalto') ? 'page' : ''; st['page-break-before'] = v(d, 'dpSalto') ? 'always' : '';
      st['break-after'] = v(d, 'dpJunto') ? 'avoid' : '';
      e.undoManager.transact(function() {
        var nivel = v(d, 'dpN');
        W.bloquesSeleccionados().forEach(function(bl) {
          if (bl === e.getBody()) return;
          if (nivel && bl.nodeName.toLowerCase() !== nivel && /^(P|H\d)$/.test(bl.nodeName)) bl = e.dom.rename(bl, nivel);
          e.dom.setStyles(bl, st);
        });
      });
      cambio(); return true;
    }}, {texto: 'Cancelar', valor: null}]});
  };

  // ---------- Configurar página ----------
  D.pagina = function(pestana) {
    if (!listo()) return;
    var a = W.aj, m = a.pagina.margenes, t = W.TAMANOS[a.pagina.tam], dm = W.dim();
    var html = '<fieldset><legend>Márgenes (cm)</legend><div class="nv-filas2">' +
      ['sup|Superior', 'inf|Inferior', 'izq|Izquierdo', 'der|Derecho'].map(function(x) { var p = x.split('|'); return '<div class="nv-campo"><label for="dg' + p[0] + '">' + p[1] + '</label><input type="number" step="0.1" min="0" id="dg' + p[0] + '" value="' + m[p[0]] + '"></div>'; }).join('') +
      '</div><div class="nv-campo"><label for="dgOr">Orientación</label><select id="dgOr">' + opts([['v', 'Vertical'], ['h', 'Horizontal']], a.pagina.orient) + '</select></div></fieldset>' +
      '<fieldset><legend>Papel</legend><div class="nv-filas3"><div class="nv-campo"><label for="dgTam">Tamaño del papel</label><select id="dgTam">' +
      opts(Object.keys(W.TAMANOS).map(function(k) { return [k, W.TAMANOS[k].n]; }).concat([['personalizado', 'Tamaño personalizado']]), t ? a.pagina.tam : 'personalizado') + '</select></div>' +
      '<div class="nv-campo"><label for="dgAn">Ancho (cm)</label><input type="number" step="0.1" id="dgAn" value="' + (t ? t.w : a.pagina.ancho) + '"></div>' +
      '<div class="nv-campo"><label for="dgAl">Alto (cm)</label><input type="number" step="0.1" id="dgAl" value="' + (t ? t.h : a.pagina.alto) + '"></div></div></fieldset>' +
      '<fieldset><legend>Diseño</legend><div class="nv-filas2"><div class="nv-campo"><label for="dgDE">Encabezado desde el borde (cm)</label><input type="number" step="0.1" id="dgDE" value="' + (a.distEnc || 1.25) + '"></div>' +
      '<div class="nv-campo"><label for="dgDP">Pie de página desde el borde (cm)</label><input type="number" step="0.1" id="dgDP" value="' + (a.distPie || 1.25) + '"></div></div>' +
      '<label class="nv-chk"><input type="checkbox" id="dgPri"' + (a.primeraDistinta ? ' checked' : '') + '> Primera página diferente (sin encabezado ni pie)</label></fieldset>';
    NV.dialogo({titulo: 'Configurar página', html: html, ancho: 540, alAbrir: function(d) {
      d.querySelector('#dgTam').addEventListener('change', function() { var tt = W.TAMANOS[this.value]; if (tt) { d.querySelector('#dgAn').value = tt.w; d.querySelector('#dgAl').value = tt.h; } });
      if (pestana === 'papel') d.querySelector('#dgTam').focus();
    }, botones: [{texto: 'Aceptar', prim: true, accion: function(d) {
      W.cambiarAjustes(function(x) {
        ['sup', 'inf', 'izq', 'der'].forEach(function(k) { var n = num(d, 'dg' + k); if (n !== null) x.pagina.margenes[k] = Math.max(0, n); });
        x.pagina.orient = v(d, 'dgOr');
        var tam = v(d, 'dgTam');
        if (tam === 'personalizado') { x.pagina.tam = 'personalizado'; x.pagina.ancho = num(d, 'dgAn') || 21.59; x.pagina.alto = num(d, 'dgAl') || 27.94; }
        else x.pagina.tam = tam;
        x.distEnc = num(d, 'dgDE') || 1.25; x.distPie = num(d, 'dgDP') || 1.25; x.primeraDistinta = v(d, 'dgPri');
      });
      return true;
    }}, {texto: 'Cancelar', valor: null}]});
  };

  // ---------- Encabezado y pie de página ----------
  D.encabezadoPie = function(zona) {
    if (!listo()) return;
    zona = zona || 'encabezado';
    var a = W.aj, nombre = zona === 'pie' ? 'Pie de página' : 'Encabezado';
    var barra = '<div style="display:flex;gap:2px;flex-wrap:wrap;margin-bottom:6px" id="deBarra">' +
      [['bold', 'N', 'font-weight:bold'], ['italic', 'K', 'font-style:italic'], ['underline', 'S', 'text-decoration:underline']].map(function(x) {
        return '<button type="button" class="nv-b" data-ex="' + x[0] + '" title="' + x[0] + '"><span style="' + x[2] + ';font-family:Georgia">' + x[1] + '</span></button>';
      }).join('') +
      '<button type="button" class="nv-b" data-ex="justifyLeft" title="Izquierda">' + NV.icono('text_align_left') + '</button><button type="button" class="nv-b" data-ex="justifyCenter" title="Centro">' + NV.icono('text_align_center') + '</button>' +
      '<button type="button" class="nv-b" data-ex="justifyRight" title="Derecha">' + NV.icono('text_align_right') + '</button>' +
      '<select class="nv-sel" id="deTam" title="Tamaño"><option value="">Tamaño</option>' + [8, 9, 10, 11, 12, 14, 16, 18, 24].map(function(s) { return '<option value="' + s + '">' + s + '</option>'; }).join('') + '</select>' +
      '<input type="color" id="deCol" title="Color" value="#000000" style="width:30px;height:26px;border:1px solid #c8c6c4;border-radius:3px;padding:1px">' +
      '<button type="button" class="nv-b" data-campo="pagina">' + NV.icono('number_symbol', 'p') + 'Nº de página</button>' +
      '<button type="button" class="nv-b" data-campo="paginas">Nº de páginas</button>' +
      '<button type="button" class="nv-b" data-campo="fecha">' + NV.icono('calendar_ltr', 'p') + 'Fecha</button>' +
      '<button type="button" class="nv-b" data-campo="titulo">Título</button>' +
      '<button type="button" class="nv-b" data-campo="imagen">' + NV.icono('image', 'p') + 'Imagen / logo</button></div>';
    var editor = function(id, val) { return '<div id="' + id + '" contenteditable="true" style="border:1px solid #c8c6c4;border-radius:4px;min-height:70px;padding:8px;font-family:' + NV.cssFuente(W.tema().cuerpo).replace(/"/g, "'") + ';font-size:11pt;outline:none">' + (val || '<p><br></p>') + '</div>'; };
    var html = barra + '<div class="nv-campo"><label>' + nombre + '</label>' + editor('deTxt', a[zona]) + '</div>' +
      (a.primeraDistinta ? '<div class="nv-campo"><label>' + nombre + ' de la primera página</label>' + editor('deTxt1', a[zona + 'Primera']) + '</div>' : '') +
      '<label class="nv-chk"><input type="checkbox" id="dePri"' + (a.primeraDistinta ? ' checked' : '') + '> Primera página diferente</label>' +
      '<p style="font-size:12.5px;color:#605e5c;margin:8px 0 0">Los campos de número de página se completan solos en cada página, en el PDF y en Word.</p>';
    NV.dialogo({titulo: nombre, html: html, ancho: 640, alAbrir: function(d) {
      var activo = d.querySelector('#deTxt');
      NV.$$('[contenteditable]', d).forEach(function(x) { x.addEventListener('focus', function() { activo = x; }); });
      d.querySelector('#deBarra').addEventListener('mousedown', function(ev) { if (ev.target.closest('button')) ev.preventDefault(); });
      d.querySelector('#deBarra').addEventListener('click', function(ev) {
        var b = ev.target.closest('button'); if (!b) return;
        activo.focus();
        if (b.dataset.ex) { document.execCommand(b.dataset.ex); return; }
        var c = b.dataset.campo;
        if (c === 'imagen') {
          NV.elegirArchivos('image/*').then(function(fs) { if (!fs[0]) return; NV.imagenADataUrl(fs[0], 600).then(function(u) { activo.focus(); document.execCommand('insertHTML', false, '<img src="' + u + '" style="height:1.2cm;width:auto" alt="Logo">'); }); });
          return;
        }
        if (c === 'titulo') { document.execCommand('insertText', false, W.doc.titulo); return; }
        document.execCommand('insertHTML', false, '<span data-campo="' + c + '" style="background:#e8e8e8">' + {pagina: '#', paginas: '##', fecha: new Date().toLocaleDateString('es-CO')}[c] + '</span>&nbsp;');
      });
      d.querySelector('#deTam').addEventListener('change', function() {
        activo.focus(); document.execCommand('fontSize', false, '7');
        NV.$$('font[size="7"]', activo).forEach(function(f) { var s = document.createElement('span'); s.style.fontSize = this.value + 'pt'; s.innerHTML = f.innerHTML; f.replaceWith(s); }, this);
      });
      d.querySelector('#deCol').addEventListener('input', function() { activo.focus(); document.execCommand('foreColor', false, this.value); });
    }, botones: [{texto: 'Aceptar', prim: true, accion: function(d) {
      var limpiar = function(h) { h = (h || '').replace(/ style="background:#e8e8e8"/g, '').replace(/<span data-campo="(pagina|paginas|fecha)"[^>]*>[^<]*<\/span>/g, function(m, c) { return '<span data-campo="' + c + '">#</span>'; }); return /^(<p>)?(<br>)?(<\/p>)?$/.test(h.trim()) ? '' : h; };
      W.cambiarAjustes(function(x) {
        x[zona] = limpiar(d.querySelector('#deTxt').innerHTML);
        var p1 = d.querySelector('#deTxt1'); if (p1) x[zona + 'Primera'] = limpiar(p1.innerHTML);
        x.primeraDistinta = v(d, 'dePri');
      });
      return true;
    }}, {texto: 'Cancelar', valor: null}]});
  };
  D.formatoNumPagina = function() {
    var a = W.aj;
    NV.dialogo({titulo: 'Formato de los números de página', ancho: 400, html:
      '<div class="nv-campo"><label for="dnF">Formato de número</label><select id="dnF">' + opts([['1', '1, 2, 3…'], ['i', 'i, ii, iii…'], ['I', 'I, II, III…'], ['a', 'a, b, c…'], ['A', 'A, B, C…']], a.formatoNum || '1') + '</select></div>' +
      '<div class="nv-campo"><label for="dnI">Iniciar en</label><input type="number" min="0" id="dnI" value="' + (a.numInicio || 1) + '"></div>',
      botones: [{texto: 'Aceptar', prim: true, accion: function(d) { W.cambiarAjustes(function(x) { x.formatoNum = v(d, 'dnF'); x.numInicio = parseInt(v(d, 'dnI'), 10) || 1; }); return true; }}, {texto: 'Cancelar', valor: null}]});
  };

  // ---------- Bordes ----------
  D.bordesSombreado = function() {
    if (!listo()) return;
    NV.dialogo({titulo: 'Bordes y sombreado', ancho: 460, html:
      '<div class="nv-filas3"><div class="nv-campo"><label for="dbE">Estilo</label><select id="dbE">' + opts([['solid', 'Continuo'], ['dashed', 'Discontinuo'], ['dotted', 'Punteado'], ['double', 'Doble']], 'solid') + '</select></div>' +
      '<div class="nv-campo"><label for="dbG">Ancho</label><select id="dbG">' + opts([['0.5', '½ pto'], ['1', '1 pto'], ['1.5', '1½ pto'], ['2.25', '2¼ pto'], ['3', '3 pto'], ['4.5', '4½ pto']], '1') + '</select></div>' +
      '<div class="nv-campo"><label for="dbC">Color</label><input type="color" id="dbC" value="#000000" style="width:100%;height:32px"></div></div>' +
      '<div class="nv-campo"><label for="dbV">Valor</label><select id="dbV">' + opts([['cuadro', 'Cuadro'], ['inf', 'Solo abajo'], ['sup', 'Solo arriba'], ['supinf', 'Arriba y abajo'], ['ninguno', 'Ninguno']], 'cuadro') + '</select></div>' +
      '<div class="nv-campo"><label for="dbS">Sombreado (relleno)</label><input type="color" id="dbS" value="#ffffff" style="width:80px;height:32px"> <label class="nv-chk" style="display:inline-flex"><input type="checkbox" id="dbSN" checked> Sin relleno</label></div>',
      botones: [{texto: 'Aceptar', prim: true, accion: function(d) {
        var b = v(d, 'dbG') + 'pt ' + v(d, 'dbE') + ' ' + v(d, 'dbC'), t = v(d, 'dbV');
        var st = {border: '', 'border-top': '', 'border-bottom': '', padding: ''};
        if (t === 'cuadro') { st.border = b; st.padding = '1pt 4pt'; } else if (t === 'inf') st['border-bottom'] = b; else if (t === 'sup') st['border-top'] = b;
        else if (t === 'supinf') { st['border-top'] = b; st['border-bottom'] = b; }
        st['background-color'] = v(d, 'dbSN') ? '' : v(d, 'dbS');
        ed().focus(); W.estiloBloques(st); return true;
      }}, {texto: 'Cancelar', valor: null}]});
  };
  D.bordesPagina = function() {
    if (!listo()) return;
    var bp = W.aj.bordePagina || {estilo: 'solid', grosor: 1, color: '#000000'};
    NV.dialogo({titulo: 'Bordes de página', ancho: 420, html:
      '<div class="nv-campo"><label for="dbpV">Valor</label><select id="dbpV">' + opts([['ninguno', 'Ninguno'], ['cuadro', 'Cuadro']], W.aj.bordePagina ? 'cuadro' : 'ninguno') + '</select></div>' +
      '<div class="nv-filas3"><div class="nv-campo"><label for="dbpE">Estilo</label><select id="dbpE">' + opts([['solid', 'Continuo'], ['dashed', 'Discontinuo'], ['dotted', 'Punteado'], ['double', 'Doble']], bp.estilo) + '</select></div>' +
      '<div class="nv-campo"><label for="dbpG">Ancho</label><select id="dbpG">' + opts([['0.5', '½ pto'], ['1', '1 pto'], ['1.5', '1½ pto'], ['3', '3 pto'], ['4.5', '4½ pto'], ['6', '6 pto']], String(bp.grosor)) + '</select></div>' +
      '<div class="nv-campo"><label for="dbpC">Color</label><input type="color" id="dbpC" value="' + bp.color + '" style="width:100%;height:32px"></div></div>',
      botones: [{texto: 'Aceptar', prim: true, accion: function(d) {
        W.cambiarAjustes(function(x) { x.bordePagina = v(d, 'dbpV') === 'ninguno' ? null : {estilo: v(d, 'dbpE'), grosor: +v(d, 'dbpG'), color: v(d, 'dbpC')}; }); return true;
      }}, {texto: 'Cancelar', valor: null}]});
  };
  D.marcaAgua = function() {
    var ma = W.aj.marcaAgua || {texto: 'CONFIDENCIAL', color: '#BFBFBF', fuente: 'Calibri'};
    NV.dialogo({titulo: 'Marca de agua impresa', ancho: 420, html:
      '<div class="nv-campo"><label for="dmT">Texto</label><input type="text" id="dmT" value="' + esc(ma.texto) + '" maxlength="40"></div>' +
      '<div class="nv-filas2"><div class="nv-campo"><label for="dmF">Fuente</label><select id="dmF">' + opts(NV.FUENTES.map(function(x) { return x.n; }), ma.fuente || 'Calibri') + '</select></div>' +
      '<div class="nv-campo"><label for="dmC">Color</label><input type="color" id="dmC" value="' + ma.color + '" style="width:100%;height:32px"></div></div>',
      botones: [{texto: 'Aceptar', prim: true, accion: function(d) {
        var t = v(d, 'dmT').trim(); W.cambiarAjustes(function(x) { x.marcaAgua = t ? {texto: t, color: v(d, 'dmC'), fuente: v(d, 'dmF')} : null; }); return true;
      }}, {texto: 'Cancelar', valor: null}]});
  };
  D.columnas = function() {
    NV.dialogo({titulo: 'Columnas', ancho: 380, html:
      '<div class="nv-campo"><label for="dcN">Número de columnas</label><input type="number" min="1" max="6" id="dcN" value="2"></div>' +
      '<label class="nv-chk"><input type="checkbox" id="dcL"> Línea entre columnas</label>' +
      '<p style="font-size:12.5px;color:#605e5c">Se aplica al texto seleccionado (o a todo el documento si no hay selección).</p>',
      botones: [{texto: 'Aceptar', prim: true, accion: function(d) { W.columnas(Math.max(1, Math.min(6, parseInt(v(d, 'dcN'), 10) || 1)), '', v(d, 'dcL')); return true; }}, {texto: 'Cancelar', valor: null}]});
  };

  // ---------- Insertar ----------
  D.insertarTabla = function() {
    NV.dialogo({titulo: 'Insertar tabla', ancho: 340, html:
      '<div class="nv-filas2"><div class="nv-campo"><label for="dtC">Número de columnas</label><input type="number" min="1" max="63" id="dtC" value="5"></div>' +
      '<div class="nv-campo"><label for="dtF">Número de filas</label><input type="number" min="1" max="500" id="dtF" value="2"></div></div>',
      botones: [{texto: 'Aceptar', prim: true, accion: function(d) { W.insertarTabla(Math.max(1, Math.min(500, +v(d, 'dtF') || 2)), Math.max(1, Math.min(63, +v(d, 'dtC') || 5))); return true; }}, {texto: 'Cancelar', valor: null}]});
  };
  D.vinculo = function() {
    var e = ed(), a = e.dom.getParent(e.selection.getNode(), 'a[href]'), txt = a ? a.textContent : e.selection.getContent({format: 'text'});
    var marcadores = NV.$$('[id]', e.getBody()).filter(function(x) { return /^(H[1-6]|A)$/.test(x.nodeName) || x.classList.contains('mce-item-anchor'); });
    NV.dialogo({titulo: a ? 'Editar vínculo' : 'Insertar vínculo', ancho: 480, html:
      '<div class="nv-campo"><label for="dvT">Texto que se mostrará</label><input type="text" id="dvT" value="' + esc(txt) + '"></div>' +
      '<div class="nv-campo"><label for="dvU">Dirección</label><input type="text" id="dvU" value="' + esc(a ? a.getAttribute('href') : '') + '" placeholder="https://… o correo@ejemplo.com"></div>' +
      (marcadores.length ? '<div class="nv-campo"><label for="dvM">O un lugar de este documento</label><select id="dvM"><option value="">—</option>' + marcadores.map(function(m) { return '<option value="#' + esc(m.id) + '">' + esc((m.textContent || m.id).slice(0, 60)) + '</option>'; }).join('') + '</select></div>' : '') +
      '<label class="nv-chk"><input type="checkbox" id="dvN"' + (!a || a.target === '_blank' ? ' checked' : '') + '> Abrir en una ventana nueva</label>',
      alAbrir: function(d) { var m = d.querySelector('#dvM'); if (m) m.onchange = function() { if (m.value) d.querySelector('#dvU').value = m.value; }; d.querySelector('#dvU').focus(); },
      botones: [{texto: 'Aceptar', prim: true, accion: function(d) {
        var u = v(d, 'dvU').trim(), t = v(d, 'dvT');
        if (!u) { if (a) { e.focus(); e.execCommand('unlink'); cambio(); } return true; }
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u)) u = 'mailto:' + u; else if (!/^(https?:|mailto:|tel:|#)/i.test(u)) u = 'https://' + u;
        e.focus();
        var tgt = v(d, 'dvN') && u[0] !== '#' ? ' target="_blank" rel="noopener"' : '';
        if (a) { e.dom.setAttribs(a, {href: u, target: tgt ? '_blank' : null}); if (t && t !== a.textContent) a.textContent = t; }
        else e.insertContent('<a href="' + esc(u) + '"' + tgt + '>' + esc(t || u) + '</a>');
        cambio(); return true;
      }}, a ? {texto: 'Quitar vínculo', accion: function() { e.focus(); e.execCommand('unlink'); cambio(); return true; }} : null, {texto: 'Cancelar', valor: null}].filter(Boolean)});
  };
  D.marcador = function() {
    var e = ed();
    NV.preguntar('Marcador', 'Nombre del marcador (sin espacios):', '').then(function(n) {
      n = String(n || '').trim().replace(/\s+/g, '_').replace(/[^\w\-]/g, '');
      if (!n) return;
      e.focus(); e.insertContent('<a id="' + esc(n) + '"></a>'); cambio(); NV.toast('Marcador "' + n + '" agregado. Úsalo desde Vínculo o Referencia cruzada.');
    });
  };
  D.referenciaCruzada = function() {
    var e = ed(), lista = NV.$$('h1,h2,h3,h4,p.nv-Caption,a[id]', e.getBody()).filter(function(x) { return x.textContent.trim() || x.id; });
    if (!lista.length) { NV.toast('No hay títulos, descripciones ni marcadores a los cuales hacer referencia.'); return; }
    NV.dialogo({titulo: 'Referencia cruzada', ancho: 480, html: '<div class="nv-campo"><label for="drR">Para qué elemento</label><select id="drR" size="8" style="height:auto">' +
      lista.map(function(x, i) { return '<option value="' + i + '"' + (i ? '' : ' selected') + '>' + esc((x.textContent.trim() || 'Marcador ' + x.id).slice(0, 70)) + '</option>'; }).join('') + '</select></div>' +
      '<div class="nv-campo"><label for="drQ">Insertar referencia a</label><select id="drQ">' + opts([['texto', 'Texto del elemento'], ['pagina', 'Número de página']], 'texto') + '</select></div>',
      botones: [{texto: 'Insertar', prim: true, accion: function(d) {
        var x = lista[+v(d, 'drR')]; if (!x) return false;
        if (!x.id) x.id = 'nv-ref-' + Date.now().toString(36);
        var t = v(d, 'drQ') === 'pagina' ? String(W.numPagina(Math.floor(x.offsetTop / (NV.cmAPx(W.dim().h) + 24)) + 1)) : x.textContent.trim();
        e.focus(); e.insertContent('<a href="#' + x.id + '">' + esc(t) + '</a>'); cambio(); return true;
      }}, {texto: 'Cerrar', valor: null}]});
  };
  D.fechaHora = function() {
    var d0 = new Date(), loc = W.aj.idioma || 'es-CO';
    var fm = [d0.toLocaleDateString(loc), d0.toLocaleDateString(loc, {weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'}), d0.toLocaleDateString(loc, {day: 'numeric', month: 'long', year: 'numeric'}),
      d0.toISOString().slice(0, 10), d0.toLocaleDateString(loc, {month: 'long', year: 'numeric'}), d0.toLocaleTimeString(loc, {hour: 'numeric', minute: '2-digit'}),
      d0.toLocaleString(loc, {dateStyle: 'short', timeStyle: 'short'})];
    NV.dialogo({titulo: 'Fecha y hora', ancho: 380, html: '<div class="nv-campo"><label for="dfh">Formatos disponibles</label><select id="dfh" size="7" style="height:auto">' +
      fm.map(function(f, i) { return '<option' + (i ? '' : ' selected') + '>' + esc(f) + '</option>'; }).join('') + '</select></div>',
      botones: [{texto: 'Aceptar', prim: true, accion: function(d) { ed().focus(); ed().insertContent(esc(v(d, 'dfh'))); cambio(); return true; }}, {texto: 'Cancelar', valor: null}]});
  };
  D.lineaFirma = function() {
    NV.dialogo({titulo: 'Configuración de firma', ancho: 420, html:
      '<div class="nv-campo"><label for="dsN">Firmante sugerido</label><input type="text" id="dsN" placeholder="Nombre completo"></div>' +
      '<div class="nv-campo"><label for="dsC">Cargo del firmante sugerido</label><input type="text" id="dsC" placeholder="Cargo"></div>' +
      '<div class="nv-campo"><label for="dsI">Identificación (opcional)</label><input type="text" id="dsI" placeholder="C.C."></div>',
      botones: [{texto: 'Aceptar', prim: true, accion: function(d) {
        var h = '<p style="margin-top:36pt;margin-bottom:0">______________________________</p><p style="margin:0"><b>' + esc(v(d, 'dsN') || '[Nombre]') + '</b></p>' +
          (v(d, 'dsC') ? '<p style="margin:0">' + esc(v(d, 'dsC')) + '</p>' : '') + (v(d, 'dsI') ? '<p style="margin:0">C.C. ' + esc(v(d, 'dsI')) + '</p>' : '') + '<p><br></p>';
        ed().focus(); ed().insertContent(h); cambio(); return true;
      }}, {texto: 'Cancelar', valor: null}]});
  };
  D.titulo = function() {
    var e = ed(), n = e.selection.getNode(), esImg = n.nodeName === 'IMG', enTabla = W.enTabla();
    NV.dialogo({titulo: 'Título', ancho: 420, html:
      '<div class="nv-campo"><label for="dtR">Rótulo</label><select id="dtR">' + opts(['Figura', 'Tabla', 'Ecuación', 'Gráfico', 'Ilustración'], enTabla ? 'Tabla' : 'Figura') + '</select></div>' +
      '<div class="nv-campo"><label for="dtT">Texto del título</label><input type="text" id="dtT" placeholder="Descripción"></div>' +
      '<div class="nv-campo"><label for="dtP">Posición</label><select id="dtP">' + opts([['abajo', 'Debajo del elemento seleccionado'], ['arriba', 'Encima del elemento seleccionado']], enTabla ? 'arriba' : 'abajo') + '</select></div>',
      botones: [{texto: 'Aceptar', prim: true, accion: function(d) {
        var r = v(d, 'dtR'), cnt = NV.$$('p.nv-Caption', e.getBody()).filter(function(c) { return c.textContent.indexOf(r + ' ') === 0; }).length + 1;
        var h = '<p class="nv-Caption">' + esc(r) + ' ' + cnt + (v(d, 'dtT') ? ': ' + esc(v(d, 'dtT')) : '') + '</p>';
        e.focus();
        var obj = esImg ? e.dom.getParent(n, e.dom.isBlock) : enTabla ? e.dom.getParent(n, 'table') : null;
        if (obj) {
          var tmp = e.getDoc().createElement('div'); tmp.innerHTML = h;
          e.undoManager.transact(function() { if (v(d, 'dtP') === 'arriba') obj.parentNode.insertBefore(tmp.firstChild, obj); else obj.parentNode.insertBefore(tmp.firstChild, obj.nextSibling); });
        } else e.insertContent(h);
        cambio(); return true;
      }}, {texto: 'Cancelar', valor: null}]});
  };
  D.forma = function(k, editar) {
    var o = editar ? JSON.parse(editar.getAttribute('data-nv-forma')) : {forma: k, relleno: W.tema().acentos[0], borde: '#2F528F', grosor: 1, texto: '', colorTexto: '#FFFFFF', ancho: 4, alto: k === 'linea' || k === 'lineaFlecha' ? 0.6 : 3};
    NV.dialogo({titulo: (editar ? 'Editar forma: ' : 'Insertar forma: ') + W.FORMAS[o.forma].n, ancho: 520, html:
      '<div style="display:flex;gap:16px"><div style="flex:1"><div class="nv-filas2"><div class="nv-campo"><label for="doR">Relleno</label><input type="color" id="doR" value="' + (o.relleno || '#ffffff') + '" style="width:100%;height:32px"></div>' +
      '<div class="nv-campo"><label for="doB">Contorno</label><input type="color" id="doB" value="' + (o.borde || '#000000') + '" style="width:100%;height:32px"></div>' +
      '<div class="nv-campo"><label for="doG">Grosor del contorno</label><select id="doG">' + opts([['0', 'Sin contorno'], ['1', '1 pto'], ['2', '2 pto'], ['3', '3 pto'], ['5', '5 pto']], String(o.grosor)) + '</select></div>' +
      '<div class="nv-campo"><label for="doSR">&nbsp;</label><label class="nv-chk" style="margin:4px 0"><input type="checkbox" id="doSR"' + (o.relleno === 'none' ? ' checked' : '') + '> Sin relleno</label></div>' +
      '<div class="nv-campo"><label for="doAn">Ancho (cm)</label><input type="number" step="0.1" min="0.2" id="doAn" value="' + o.ancho + '"></div>' +
      '<div class="nv-campo"><label for="doAl">Alto (cm)</label><input type="number" step="0.1" min="0.2" id="doAl" value="' + o.alto + '"></div></div>' +
      '<div class="nv-filas2"><div class="nv-campo"><label for="doT">Texto dentro de la forma</label><input type="text" id="doT" value="' + esc(o.texto || '') + '"></div>' +
      '<div class="nv-campo"><label for="doCT">Color del texto</label><input type="color" id="doCT" value="' + (o.colorTexto || '#ffffff') + '" style="width:100%;height:32px"></div></div></div>' +
      '<div style="width:140px;display:flex;align-items:center;justify-content:center;background:#f3f2f1;border-radius:6px"><img id="doVista" alt="Vista previa" style="max-width:120px;max-height:120px"></div></div>',
      alAbrir: function(d) {
        var vista = function() {
          var an = num(d, 'doAn') || 4, al = num(d, 'doAl') || 3, k2 = Math.min(110 / an, 110 / al);
          d.querySelector('#doVista').src = W.svgForma(o.forma, v(d, 'doSR') ? 'none' : v(d, 'doR'), +v(d, 'doG') ? v(d, 'doB') : 'none', +v(d, 'doG') || 1, v(d, 'doT'), v(d, 'doCT'), Math.round(an * k2), Math.round(al * k2));
        };
        d.addEventListener('input', vista); d.addEventListener('change', vista); vista();
      },
      botones: [{texto: 'Aceptar', prim: true, accion: function(d) {
        W.insertarForma({forma: o.forma, relleno: v(d, 'doSR') ? 'none' : v(d, 'doR'), borde: +v(d, 'doG') ? v(d, 'doB') : 'none', grosor: +v(d, 'doG') || 1,
          texto: v(d, 'doT'), colorTexto: v(d, 'doCT'), ancho: Math.max(0.2, num(d, 'doAn') || 4), alto: Math.max(0.2, num(d, 'doAl') || 3)}, editar);
        return true;
      }}, {texto: 'Cancelar', valor: null}]});
  };
  D.grafico = function(editar) {
    var g = editar ? JSON.parse(editar.getAttribute('data-nv-grafico')) :
      {tipo: 'columnas', titulo: 'Título del gráfico', categorias: ['Categoría 1', 'Categoría 2', 'Categoría 3', 'Categoría 4'],
       series: [{nombre: 'Serie 1', valores: [4.3, 2.5, 3.5, 4.5]}, {nombre: 'Serie 2', valores: [2.4, 4.4, 1.8, 2.8]}, {nombre: 'Serie 3', valores: [2, 2, 3, 5]}]};
    var tabla = function() {
      var h = '<table style="border-collapse:collapse;font-size:13px" id="dgrT"><tr><td style="border:1px solid #c8c6c4;background:#f3f2f1;padding:2px 4px"></td>';
      g.series.forEach(function(s, i) { h += '<td style="border:1px solid #c8c6c4;padding:0"><input data-s="' + i + '" value="' + esc(s.nombre) + '" style="width:90px;border:0;padding:4px;font-weight:600;background:#f3f2f1"></td>'; });
      h += '</tr>';
      g.categorias.forEach(function(c, r) {
        h += '<tr><td style="border:1px solid #c8c6c4;padding:0"><input data-c="' + r + '" value="' + esc(c) + '" style="width:110px;border:0;padding:4px;background:#f3f2f1"></td>';
        g.series.forEach(function(s, i) { h += '<td style="border:1px solid #c8c6c4;padding:0"><input data-v="' + r + ',' + i + '" value="' + (s.valores[r] == null ? '' : s.valores[r]) + '" style="width:90px;border:0;padding:4px;text-align:right"></td>'; });
        h += '</tr>';
      });
      return h + '</table>';
    };
    var leer = function(d) {
      NV.$$('input[data-s]', d).forEach(function(i) { g.series[+i.dataset.s].nombre = i.value; });
      NV.$$('input[data-c]', d).forEach(function(i) { g.categorias[+i.dataset.c] = i.value; });
      NV.$$('input[data-v]', d).forEach(function(i) { var p = i.dataset.v.split(','); g.series[+p[1]].valores[+p[0]] = parseFloat(String(i.value).replace(',', '.')) || 0; });
      g.tipo = v(d, 'dgrTipo'); g.titulo = v(d, 'dgrTit');
    };
    NV.dialogo({titulo: editar ? 'Editar gráfico' : 'Insertar gráfico', ancho: 820, html:
      '<div class="nv-filas2"><div class="nv-campo"><label for="dgrTipo">Tipo</label><select id="dgrTipo">' + opts([['columnas', 'Columnas agrupadas'], ['barras', 'Barras agrupadas'], ['lineas', 'Líneas con marcadores'], ['circular', 'Circular']], g.tipo) + '</select></div>' +
      '<div class="nv-campo"><label for="dgrTit">Título del gráfico</label><input type="text" id="dgrTit" value="' + esc(g.titulo) + '"></div></div>' +
      '<div style="display:flex;gap:16px;align-items:flex-start"><div><div style="font-size:13px;font-weight:600;margin-bottom:4px">Datos</div><div id="dgrDatos" style="max-height:260px;overflow:auto">' + tabla() + '</div>' +
      '<div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap"><button type="button" class="nv-btn" id="dgrFila">+ Categoría</button><button type="button" class="nv-btn" id="dgrSerie">+ Serie</button>' +
      '<button type="button" class="nv-btn" id="dgrQF">− Categoría</button><button type="button" class="nv-btn" id="dgrQS">− Serie</button></div></div>' +
      '<img id="dgrVista" alt="Vista previa del gráfico" style="width:360px;border:1px solid #e1dfdd;border-radius:4px"></div>',
      alAbrir: function(d) {
        var vista = function() { leer(d); d.querySelector('#dgrVista').src = W.dibujarGrafico(g, 560, 320); };
        var redibujar = function() { d.querySelector('#dgrDatos').innerHTML = tabla(); vista(); };
        d.addEventListener('input', vista); d.addEventListener('change', vista);
        d.querySelector('#dgrFila').onclick = function() { leer(d); g.categorias.push('Categoría ' + (g.categorias.length + 1)); g.series.forEach(function(s) { s.valores.push(0); }); redibujar(); };
        d.querySelector('#dgrSerie').onclick = function() { leer(d); g.series.push({nombre: 'Serie ' + (g.series.length + 1), valores: g.categorias.map(function() { return 0; })}); redibujar(); };
        d.querySelector('#dgrQF').onclick = function() { leer(d); if (g.categorias.length > 1) { g.categorias.pop(); g.series.forEach(function(s) { s.valores.pop(); }); redibujar(); } };
        d.querySelector('#dgrQS').onclick = function() { leer(d); if (g.series.length > 1) { g.series.pop(); redibujar(); } };
        vista();
      },
      botones: [{texto: 'Aceptar', prim: true, accion: function(d) { leer(d); W.insertarGrafico(g, editar); return true; }}, {texto: 'Cancelar', valor: null}]});
  };
  D.textoAlt = function() {
    var e = ed(), im = e.selection.getNode(); if (im.nodeName !== 'IMG') return;
    NV.dialogo({titulo: 'Texto alternativo', ancho: 420, html: '<p style="margin-top:0;font-size:13px;line-height:1.5">Describe la imagen para las personas que usan lector de pantalla.</p>' +
      '<div class="nv-campo"><textarea id="dta" rows="4">' + esc(im.getAttribute('alt') || '') + '</textarea></div><label class="nv-chk"><input type="checkbox" id="dtaD"> Marcar como decorativa</label>',
      botones: [{texto: 'Aceptar', prim: true, accion: function(d) { e.dom.setAttrib(im, 'alt', v(d, 'dtaD') ? '' : v(d, 'dta')); cambio(); return true; }}, {texto: 'Cancelar', valor: null}]});
  };
  D.recortar = function() {
    var e = ed(), im = e.selection.getNode(); if (im.nodeName !== 'IMG' || !listo()) { NV.toast('Selecciona una imagen.'); return; }
    var rec = {x: 0.1, y: 0.1, w: 0.8, h: 0.8};
    NV.dialogo({titulo: 'Recortar imagen', ancho: 620, html: '<p style="margin-top:0;font-size:13px">Arrastra el recuadro o sus esquinas para elegir la parte que se conserva.</p>' +
      '<div id="drcC" style="position:relative;display:inline-block;max-width:100%;user-select:none"><img src="' + im.src + '" alt="" style="max-width:560px;max-height:420px;display:block">' +
      '<div id="drcR" style="position:absolute;border:2px solid #fff;outline:1px solid #000;box-shadow:0 0 0 9999px rgba(0,0,0,.45);cursor:move"><span data-h="se" style="position:absolute;right:-6px;bottom:-6px;width:12px;height:12px;background:#fff;border:1px solid #000;cursor:nwse-resize"></span><span data-h="nw" style="position:absolute;left:-6px;top:-6px;width:12px;height:12px;background:#fff;border:1px solid #000;cursor:nwse-resize"></span></div></div>',
      alAbrir: function(d) {
        var c = d.querySelector('#drcC'), r = d.querySelector('#drcR');
        var pintar = function() { r.style.left = rec.x * 100 + '%'; r.style.top = rec.y * 100 + '%'; r.style.width = rec.w * 100 + '%'; r.style.height = rec.h * 100 + '%'; };
        pintar();
        r.addEventListener('mousedown', function(ev) {
          ev.preventDefault();
          var h = ev.target.dataset.h, x0 = ev.clientX, y0 = ev.clientY, r0 = Object.assign({}, rec), W0 = c.offsetWidth, H0 = c.offsetHeight;
          var mover = function(m) {
            var dx = (m.clientX - x0) / W0, dy = (m.clientY - y0) / H0;
            if (h === 'se') { rec.w = Math.max(0.05, Math.min(1 - r0.x, r0.w + dx)); rec.h = Math.max(0.05, Math.min(1 - r0.y, r0.h + dy)); }
            else if (h === 'nw') { var nx = Math.max(0, Math.min(r0.x + r0.w - 0.05, r0.x + dx)), ny = Math.max(0, Math.min(r0.y + r0.h - 0.05, r0.y + dy)); rec.w = r0.w + r0.x - nx; rec.h = r0.h + r0.y - ny; rec.x = nx; rec.y = ny; }
            else { rec.x = Math.max(0, Math.min(1 - r0.w, r0.x + dx)); rec.y = Math.max(0, Math.min(1 - r0.h, r0.y + dy)); }
            pintar();
          };
          var soltar = function() { document.removeEventListener('mousemove', mover); document.removeEventListener('mouseup', soltar); };
          document.addEventListener('mousemove', mover); document.addEventListener('mouseup', soltar);
        });
      },
      botones: [{texto: 'Recortar', prim: true, accion: function() { W.recortarImagen(im, rec); return true; }}, {texto: 'Cancelar', valor: null}]});
  };

  // ---------- Tablas ----------
  D.margenesCelda = function() {
    var t = ed().dom.getParent(ed().selection.getNode(), 'table'); if (!t || !listo()) return;
    NV.dialogo({titulo: 'Opciones de tabla', ancho: 380, html: '<p style="margin-top:0;font-size:13px">Márgenes predeterminados de las celdas (cm)</p><div class="nv-filas2">' +
      ['Superior|0', 'Inferior|0', 'Izquierdo|0.19', 'Derecho|0.19'].map(function(x, i) { var p = x.split('|'); return '<div class="nv-campo"><label for="dmc' + i + '">' + p[0] + '</label><input type="number" step="0.05" min="0" id="dmc' + i + '" value="' + p[1] + '"></div>'; }).join('') + '</div>',
      botones: [{texto: 'Aceptar', prim: true, accion: function(d) {
        var p =(num(d, 'dmc0') || 0) + 'cm ' + (num(d, 'dmc3') || 0) + 'cm ' + (num(d, 'dmc1') || 0) + 'cm ' + (num(d, 'dmc2') || 0) + 'cm';
        ed().undoManager.transact(function() { NV.$$('td,th', t).forEach(function(td) { td.style.padding = p; }); }); cambio(); return true;
      }}, {texto: 'Cancelar', valor: null}]});
  };
  D.ordenarTabla = function() {
    var t = ed().dom.getParent(ed().selection.getNode(), 'table'); if (!t || !listo()) return;
    var n = t.rows[0] ? t.rows[0].cells.length : 1, enc = t.rows[0] ? NV.$$('td,th', t.rows[0]).map(function(c, i) { return c.textContent.trim() || 'Columna ' + (i + 1); }) : [];
    NV.dialogo({titulo: 'Ordenar', ancho: 420, html:
      '<label class="nv-chk"><input type="checkbox" id="doE" checked> La lista tiene fila de encabezado</label>' +
      '<div class="nv-filas3"><div class="nv-campo"><label for="doC">Ordenar por</label><select id="doC">' + enc.map(function(x, i) { return '<option value="' + i + '">' + esc(x) + '</option>'; }).join('') + '</select></div>' +
      '<div class="nv-campo"><label for="doT">Tipo</label><select id="doT">' + opts([['texto', 'Texto'], ['numero', 'Número'], ['fecha', 'Fecha']], 'texto') + '</select></div>' +
      '<div class="nv-campo"><label for="doD">Orden</label><select id="doD">' + opts([['asc', 'Ascendente'], ['desc', 'Descendente']], 'asc') + '</select></div></div>',
      botones: [{texto: 'Aceptar', prim: true, accion: function(d) { W.ordenarTabla(+v(d, 'doC'), v(d, 'doD') === 'desc', v(d, 'doT'), v(d, 'doE')); return true; }}, {texto: 'Cancelar', valor: null}]});
  };
  D.ordenar = function() {
    var e = ed(); if (!listo()) return;
    if (W.enTabla()) { D.ordenarTabla(); return; }
    NV.dialogo({titulo: 'Ordenar texto', ancho: 380, html: '<div class="nv-filas2"><div class="nv-campo"><label for="dotT">Tipo</label><select id="dotT">' + opts([['texto', 'Texto'], ['numero', 'Número']], 'texto') + '</select></div>' +
      '<div class="nv-campo"><label for="dotD">Orden</label><select id="dotD">' + opts([['asc', 'Ascendente'], ['desc', 'Descendente']], 'asc') + '</select></div></div>',
      botones: [{texto: 'Aceptar', prim: true, accion: function(d) {
        var bl = W.bloquesSeleccionados().filter(function(b) { return b !== e.getBody(); });
        if (bl.length < 2) { NV.toast('Selecciona los párrafos o elementos de lista que quieres ordenar.'); return true; }
        var num2 = v(d, 'dotT') === 'numero', desc = v(d, 'dotD') === 'desc', padre = bl[0].parentNode, ancla = bl[bl.length - 1].nextSibling;
        var orden = bl.slice().sort(function(a, b) {
          var x = a.textContent.trim(), y = b.textContent.trim();
          var r = num2 ? (parseFloat(x.replace(',', '.')) || 0) - (parseFloat(y.replace(',', '.')) || 0) : x.localeCompare(y, 'es', {sensitivity: 'base'});
          return desc ? -r : r;
        });
        e.undoManager.transact(function() { orden.forEach(function(b) { padre.insertBefore(b, ancla); }); });
        cambio(); return true;
      }}, {texto: 'Cancelar', valor: null}]});
  };

  // ---------- Buscar y reemplazar ----------
  D.reemplazar = function(avanzada) {
    var e = ed(); if (!e) return;
    var sr = e.plugins.searchreplace, sel = e.selection.getContent({format: 'text'});
    NV.dialogo({titulo: 'Buscar y reemplazar', ancho: 480, html:
      '<div class="nv-campo"><label for="drB">Buscar</label><input type="text" id="drB" value="' + esc(sel.length < 80 ? sel : '') + '"></div>' +
      (avanzada === true ? '' : '<div class="nv-campo"><label for="drRe">Reemplazar con</label><input type="text" id="drRe"></div>') +
      '<div style="display:flex;gap:18px"><label class="nv-chk"><input type="checkbox" id="drM"> Coincidir mayúsculas y minúsculas</label><label class="nv-chk"><input type="checkbox" id="drP"> Solo palabras completas</label></div>' +
      '<p id="drMsg" style="font-size:13px;color:#605e5c;min-height:18px;margin:6px 0 0"></p>',
      alAbrir: function(d) {
        var buscado = null, total = 0;
        // Devuelve {n: coincidencias, nueva: si se acaba de buscar (ya quedó seleccionada la primera)}
        var buscar = function() {
          var q = v(d, 'drB'); if (!q) return {n: 0};
          var clave = q + '|' + v(d, 'drM') + '|' + v(d, 'drP');
          if (buscado !== clave) { sr.done(false); total = sr.find(q, v(d, 'drM'), v(d, 'drP')); buscado = clave; d.querySelector('#drMsg').textContent = total ? total + ' coincidencias.' : 'No se encontró "' + q + '".'; return {n: total, nueva: true}; }
          return {n: total};
        };
        d._buscar = buscar; d._reset = function() { buscado = null; };
        d.addEventListener('input', function(ev) { if (ev.target.id === 'drB') { buscado = null; sr.done(false); } });
      },
      botones: [
        {texto: 'Buscar siguiente', accion: function(d) { var r = d._buscar(); if (r.n && !r.nueva) sr.next(); return false; }},
        avanzada === true ? null : {texto: 'Reemplazar', accion: function(d) {
          if (W.est.soloLectura) return false; var r = d._buscar(); if (!r.n) return false;
          if (!r.nueva) { sr.replace(v(d, 'drRe'), true, false); d._reset(); cambio(); }  // la primera vez solo selecciona, como Word
          return false;
        }},
        avanzada === true ? null : {texto: 'Reemplazar todos', prim: true, accion: function(d) {
          if (W.est.soloLectura) return false; d._reset(); var r = d._buscar(); if (!r.n) return false;
          sr.replace(v(d, 'drRe'), true, true); sr.done(false); cambio();
          d.querySelector('#drMsg').textContent = 'Se realizaron ' + r.n + ' reemplazo' + (r.n === 1 ? '' : 's') + '.'; d._reset(); return false;
        }},
        {texto: 'Cerrar', accion: function() { sr.done(false); return true; }}
      ].filter(Boolean)}).then(function() { try { sr.done(false); } catch (x) {} });
  };
  D.irA = function() {
    NV.dialogo({titulo: 'Ir a', ancho: 360, html: '<div class="nv-campo"><label for="dia">Número de página (de 1 a ' + (W.paginas || 1) + ')</label><input type="number" min="1" max="' + (W.paginas || 1) + '" id="dia" value="1"></div>',
      botones: [{texto: 'Ir a', prim: true, accion: function(d) { W.irAPagina(parseInt(v(d, 'dia'), 10) || 1); return true; }}, {texto: 'Cerrar', valor: null}]});
  };
  W.irAPagina = function(n) {
    var e = ed(), b = e.getBody(), P = NV.cmAPx(W.dim().h) + 24, y = (n - 1) * P;
    var bl = Array.prototype.filter.call(b.children, function(x) { return x.offsetTop >= y - 2; })[0];
    if (bl) { e.selection.setCursorLocation(bl, 0); e.getWin().scrollTo(0, (bl.offsetTop - 30) * W.est.zoom / 100); }
    e.focus(); W.actualizarEstado();
  };

  // ---------- Otros ----------
  D.contarPalabras = function() {
    if (!ed()) return;
    var c = W.contar(), f = function(n) { return n.toLocaleString('es-CO'); };
    NV.dialogo({titulo: 'Contar palabras', ancho: 360, html: '<table class="nv-info-tabla" style="width:100%"><tr><td>Páginas</td><td style="text-align:right">' + f(c.paginas) + '</td></tr>' +
      '<tr><td>Palabras</td><td style="text-align:right">' + f(c.palabras) + '</td></tr><tr><td>Caracteres (sin espacios)</td><td style="text-align:right">' + f(c.sinEspacios) + '</td></tr>' +
      '<tr><td>Caracteres (con espacios)</td><td style="text-align:right">' + f(c.caracteres) + '</td></tr><tr><td>Párrafos</td><td style="text-align:right">' + f(c.parrafos) + '</td></tr>' +
      (c.seleccion ? '<tr><td>Palabras seleccionadas</td><td style="text-align:right">' + f(c.seleccion) + '</td></tr>' : '') + '</table>', botones: [{texto: 'Cerrar', prim: true, valor: true}]});
  };
  D.zoom = function() {
    NV.dialogo({titulo: 'Zoom', ancho: 360, html: '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">' +
      [200, 100, 75, 'ancho', 'pagina', 'varias'].map(function(z) { var t = {ancho: 'Ancho de página', pagina: 'Una página', varias: 'Varias páginas'}[z] || z + '%'; return '<label class="nv-chk"><input type="radio" name="dz" value="' + z + '"' + (z === W.est.zoom ? ' checked' : '') + '> ' + t + '</label>'; }).join('') +
      '</div><div class="nv-campo" style="margin-top:8px"><label for="dzP">Porcentaje</label><input type="number" min="10" max="500" id="dzP" value="' + W.est.zoom + '"></div>',
      alAbrir: function(d) { d.addEventListener('change', function(ev) { if (ev.target.name === 'dz' && !isNaN(+ev.target.value)) d.querySelector('#dzP').value = ev.target.value; }); },
      botones: [{texto: 'Aceptar', prim: true, accion: function(d) {
        var r = d.querySelector('input[name=dz]:checked');
        if (r && isNaN(+r.value)) W.zoomAjustar(r.value); else W.zoom(num(d, 'dzP') || 100);
        return true;
      }}, {texto: 'Cancelar', valor: null}]});
  };
  D.atajos = function() {
    var at = [['Ctrl+S o Ctrl+G', 'Guardar'], ['Ctrl+P', 'Imprimir'], ['Ctrl+O', 'Abrir'], ['Ctrl+Z / Ctrl+Y', 'Deshacer / Rehacer'], ['Ctrl+B', 'Negrita'], ['Ctrl+I', 'Cursiva'],
      ['Ctrl+U', 'Subrayado'], ['Ctrl+= / Ctrl+Mayús++', 'Subíndice / Superíndice'], ['Ctrl+Espacio', 'Borrar formato de caracteres'], ['Ctrl+Mayús+> / <', 'Aumentar / disminuir fuente'],
      ['Ctrl+] / Ctrl+[', 'Aumentar / disminuir 1 punto'], ['Ctrl+D', 'Fuente…'], ['Mayús+F3', 'Cambiar mayúsculas y minúsculas'], ['Ctrl+L / E / R / J', 'Alinear izquierda / centro / derecha / justificar'],
      ['Ctrl+1 / 2 / 5', 'Interlineado sencillo / doble / 1,5'], ['Ctrl+M / Ctrl+Mayús+M', 'Aumentar / disminuir sangría'], ['Ctrl+Alt+1 / 2 / 3', 'Título 1 / 2 / 3'],
      ['Ctrl+Mayús+N', 'Estilo Normal'], ['Ctrl+Mayús+L', 'Viñetas'], ['Ctrl+Mayús+C / V', 'Copiar / pegar formato'], ['Ctrl+K', 'Vínculo'], ['Ctrl+Enter', 'Salto de página'],
      ['Ctrl+F', 'Buscar'], ['Ctrl+H', 'Reemplazar'], ['Ctrl+*', 'Mostrar marcas de formato'], ['Ctrl+Alt+F / D', 'Nota al pie / al final'], ['F7', 'Ortografía'],
      ['Ctrl+F1', 'Contraer la cinta'], ['Alt+Q', 'Buscar un comando'], ['F11', 'Pantalla completa']];
    NV.dialogo({titulo: 'Atajos de teclado', ancho: 560, html: '<table class="nv-info-tabla">' + at.map(function(a) { return '<tr><td style="white-space:nowrap"><b>' + esc(a[0]) + '</b></td><td style="color:#323130">' + esc(a[1]) + '</td></tr>'; }).join('') + '</table>' +
      '<p style="font-size:12.5px;color:#605e5c">Algunos atajos de Word en español (como Ctrl+N para negrita) los reserva el navegador; por eso se usan los equivalentes internacionales.</p>',
      botones: [{texto: 'Cerrar', prim: true, valor: true}]});
  };

  // ---------- Panel de navegación (títulos y búsqueda) ----------
  P.navegacion = function(abrir, modo) {
    var p = NV.$('#nvPanelNav');
    W.est.nav = abrir === undefined ? p.classList.contains('nv-oculto') : !!abrir;
    p.classList.toggle('nv-oculto', !W.est.nav);
    if (W.cinta) W.cinta.refrescar();
    W.paginar(); if (W.regla) setTimeout(W.regla, 50);
    if (!W.est.nav) { try { ed().plugins.searchreplace.done(false); } catch (x) {} return; }
    var c = p.querySelector('.nv-panel-c');
    c.innerHTML = '<div class="nv-campo" style="margin-bottom:8px"><input type="text" id="nvNavQ" placeholder="Buscar en el documento" aria-label="Buscar en el documento"></div>' +
      '<div class="nv-tabs-lista"><button type="button" data-t="titulos" class="on">Títulos</button><button type="button" data-t="res">Resultados</button></div><div id="nvNavC"></div>';
    var q = c.querySelector('#nvNavQ'), cont = c.querySelector('#nvNavC'), modoAct = 'titulos';
    var pintarTitulos = function() {
      var hs = NV.$$('h1,h2,h3,h4', ed().getBody()).filter(function(h) { return h.textContent.trim() && !h.closest('.nv-toc'); });
      cont.innerHTML = hs.length ? hs.map(function(h, i) { return '<div class="nv-nav-item n' + h.nodeName[1] + '" data-i="' + i + '">' + esc(h.textContent.trim()) + '</div>'; }).join('') :
        '<p class="nv-vacio">Aplica estilos de título (Título 1, Título 2…) para crear un esquema del documento.</p>';
      cont.onclick = function(ev) { var it = ev.target.closest('[data-i]'); if (!it) return; var h = hs[+it.dataset.i]; ed().selection.setCursorLocation(h, 0); ed().getWin().scrollTo(0, (h.offsetTop - 40) * W.est.zoom / 100); ed().focus(); };
    };
    var pintarRes = function() {
      var t = q.value.trim(), sr = ed().plugins.searchreplace; sr.done(false);
      if (!t) { cont.innerHTML = '<p class="nv-vacio">Escribe una palabra para buscarla en el documento.</p>'; return; }
      var n = sr.find(t, false, false);
      var marcas = NV.$$('.mce-match-marker', ed().getBody());
      cont.innerHTML = '<p style="font-size:13px;font-weight:600">' + n + ' resultado' + (n === 1 ? '' : 's') + '</p>' + marcas.slice(0, 200).map(function(m, i) {
        var bl = ed().dom.getParent(m, ed().dom.isBlock), txt = bl ? bl.textContent : m.textContent, k = txt.toLowerCase().indexOf(t.toLowerCase());
        var frag = txt.slice(Math.max(0, k - 30), k) + '<mark>' + esc(txt.substr(k, t.length)) + '</mark>' + esc(txt.slice(k + t.length, k + t.length + 40));
        return '<div class="nv-res-buscar" data-i="' + i + '">' + (k > 30 ? '…' : '') + esc(txt.slice(Math.max(0, k - 30), k)) + frag.slice(frag.indexOf('<mark>')) + '…</div>';
      }).join('');
      cont.onclick = function(ev) { var it = ev.target.closest('[data-i]'); if (!it) return; var m = marcas[+it.dataset.i]; if (m) { m.scrollIntoView({block: 'center'}); ed().selection.select(m); } };
    };
    var cambiarModo = function(m) { modoAct = m; NV.$$('.nv-tabs-lista button', c).forEach(function(b) { b.classList.toggle('on', b.dataset.t === m); }); if (m === 'titulos') { ed().plugins.searchreplace.done(false); pintarTitulos(); } else pintarRes(); };
    c.querySelector('.nv-tabs-lista').onclick = function(ev) { var b = ev.target.closest('button'); if (b) cambiarModo(b.dataset.t); };
    var tq = null;
    q.addEventListener('input', function() { clearTimeout(tq); tq = setTimeout(function() { cambiarModo(q.value.trim() ? 'res' : 'titulos'); }, 250); });
    q.addEventListener('keydown', function(ev) { if (ev.key === 'Enter') { ev.preventDefault(); try { ed().plugins.searchreplace.next(); } catch (x) {} } if (ev.key === 'Escape') P.navegacion(false); });
    cambiarModo(modo === 'buscar' ? 'res' : 'titulos');
    if (modo === 'buscar') { var sel = ed().selection.getContent({format: 'text'}); if (sel && sel.length < 60) { q.value = sel; cambiarModo('res'); } setTimeout(function() { q.focus(); q.select(); }, 30); }
  };
})();
