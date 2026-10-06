/* Nuvia Word ⇄ Microsoft Word (.docx).
   Exportar: el HTML del documento se convierte con la biblioteca "docx" (estilos de Word reales: Título 1, Cita…,
   listas numeradas, tablas, imágenes, encabezado/pie con números de página, notas al pie, tabla de contenido).
   Importar: "docx-preview" dibuja el .docx y de ahí se toma el HTML con sus estilos en línea. */
(function() {
  'use strict';
  var NV = window.NV, X = NV.docx = {};

  // ---------- Utilidades ----------
  function hex(c) {
    if (!c) return null;
    c = String(c).trim();
    if (/^#[0-9a-f]{6}$/i.test(c)) return c.slice(1).toUpperCase();
    if (/^#[0-9a-f]{3}$/i.test(c)) return (c[1] + c[1] + c[2] + c[2] + c[3] + c[3]).toUpperCase();
    var m = /rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\)/.exec(c);
    if (m) { if (m[4] !== undefined && +m[4] === 0) return null; return [m[1], m[2], m[3]].map(function(x) { return ('0' + (+x).toString(16)).slice(-2); }).join('').toUpperCase(); }
    var nombres = {black: '000000', white: 'FFFFFF', red: 'FF0000', blue: '0000FF', green: '008000', yellow: 'FFFF00', gray: '808080', grey: '808080', orange: 'FFA500', purple: '800080', navy: '000080', silver: 'C0C0C0', maroon: '800000', teal: '008080', aqua: '00FFFF', fuchsia: 'FF00FF', lime: '00FF00', olive: '808000'};
    return nombres[c.toLowerCase()] || null;
  }
  X.hex = hex;
  var RESALTE = {'FFFF00': 'yellow', '00FF00': 'green', '00FFFF': 'cyan', 'FF00FF': 'magenta', '0000FF': 'blue', 'FF0000': 'red', '000080': 'darkBlue',
    '008080': 'darkCyan', '008000': 'darkGreen', '800080': 'darkMagenta', '800000': 'darkRed', '808000': 'darkYellow', '808080': 'darkGray', 'C0C0C0': 'lightGray', '000000': 'black'};
  function pt(v, base) { return NV.aPt(v, base); }
  function twip(v, base) { var p = pt(v, base); return p == null ? null : Math.round(p * 20); }
  function estilos(el) {  // estilo en línea como objeto
    var o = {}, s = el.getAttribute && el.getAttribute('style');
    if (!s) return o;
    s.split(';').forEach(function(d) { var i = d.indexOf(':'); if (i > 0) o[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).trim(); });
    return o;
  }
  function familia(f) {
    if (!f) return null;
    var n = f.split(',')[0].replace(/["']/g, '').trim(), fu = NV.fuentePorNombre(n);
    return fu ? fu.n : n;
  }
  function idMarcador(id) { var s = String(id || '').replace(/[^A-Za-z0-9_]/g, '_'); if (!/^[A-Za-z]/.test(s)) s = 'm_' + s; return s.slice(0, 40); }
  function temaDe(aj) { var T = NV.word.TEMAS; return T[aj.tema] || aj.temaPersonalizado || T.office; }

  // Imágenes: SVG, WebP o direcciones web se pasan a PNG/JPEG antes de crear el .docx o el PDF.
  X.prepararImagenes = function(raiz) {
    var imgs = Array.prototype.slice.call(raiz.querySelectorAll('img'));
    return Promise.all(imgs.map(function(im) {
      var src = im.getAttribute('src') || '';
      if (/^data:image\/(png|jpe?g)/i.test(src)) return medir(im, src);
      return new Promise(function(ok) {
        var img = new Image(); img.crossOrigin = 'anonymous';
        img.onload = function() {
          try {
            var w = img.naturalWidth || 300, h = img.naturalHeight || 150, k = /svg/.test(src) ? 2 : 1;
            var c = document.createElement('canvas'); c.width = w * k; c.height = h * k;
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            var u = c.toDataURL('image/png'); im.setAttribute('src', u);
            if (!im.getAttribute('width') && !estilos(im).width) { im.setAttribute('width', w); im.setAttribute('height', h); }
            medir(im, u).then(ok);
          } catch (e) { im.remove(); ok(); }
        };
        img.onerror = function() { im.remove(); ok(); };
        img.src = src;
      });
    }));
    function medir(im, src) {
      return new Promise(function(ok) {
        if (im.getAttribute('data-nw')) { ok(); return; }
        var img = new Image(); img.onload = function() { im.setAttribute('data-nw', img.naturalWidth); im.setAttribute('data-nh', img.naturalHeight); ok(); }; img.onerror = function() { ok(); }; img.src = src;
      });
    }
  };
  // Tamaño de una imagen en píxeles (96 ppp), limitado al ancho útil de la página.
  X.tamImagen = function(im, maxW) {
    var st = estilos(im), nw = +im.getAttribute('data-nw') || 300, nh = +im.getAttribute('data-nh') || 150;
    var w = st.width && !/%|auto/.test(st.width) ? pt(st.width) / 0.75 : (+im.getAttribute('width') || null);
    var h = st.height && !/%|auto/.test(st.height) ? pt(st.height) / 0.75 : (+im.getAttribute('height') || null);
    if (st.width && /%$/.test(st.width)) w = maxW * parseFloat(st.width) / 100;
    if (!w && !h) { w = nw; h = nh; } else if (!w) w = h * nw / nh; else if (!h) h = w * nh / nw;
    if (maxW && w > maxW) { h = h * maxW / w; w = maxW; }
    return {w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h))};
  };

  // ---------- Exportar a .docx ----------
  X.exportar = function(html, aj, titulo, autor) {
    return NV.lib.docx().then(function(D) {
      var cont = document.createElement('div'); cont.innerHTML = html;
      return X.prepararImagenes(cont).then(function() { return construir(D, cont, aj, titulo, autor); });
    });
  };
  function construir(D, cont, aj, titulo, autor) {
    var T = temaDe(aj), esp = NV.word.ESPACIADOS[aj.espaciado] || NV.word.ESPACIADOS.normal;
    var dm = (function() { var t = NV.word.TAMANOS[aj.pagina.tam] || {w: aj.pagina.ancho || 21.59, h: aj.pagina.alto || 27.94}; return {w: t.w, h: t.h}; })();
    var m = aj.pagina.margenes, horiz = aj.pagina.orient === 'h';
    var anchoUtilCm = (horiz ? dm.h : dm.w) - m.izq - m.der, anchoUtilPx = NV.cmAPx(anchoUtilCm), anchoUtilTw = Math.round(anchoUtilCm / 2.54 * 1440);
    var numeraciones = [], refsNum = {}, instancia = 0, notas = {}, nNota = 0;
    // notas al pie
    var listaNotas = cont.querySelector('.nv-notas-pie');
    Array.prototype.forEach.call(cont.querySelectorAll('sup.nv-nota[data-tipo="pie"]'), function(s) {
      var li = listaNotas ? listaNotas.querySelector('[id="' + s.getAttribute('data-nota') + '"]') : null;
      nNota++; s.setAttribute('data-n', nNota);
      notas[nNota] = {children: li ? bloquesDe(li.childNodes, {}) : [new D.Paragraph('')]};
      if (!notas[nNota].children.length) notas[nNota].children = [new D.Paragraph('')];
    });
    if (listaNotas) listaNotas.remove();

    function refLista(ordenada, tipo, inicio) {
      var clave = (ordenada ? 'o' : 'u') + '|' + (tipo || '') + '|' + (inicio || 1);
      if (refsNum[clave]) return refsNum[clave];
      var ref = 'nv-lista-' + numeraciones.length, niveles = [];
      for (var l = 0; l < 9; l++) {
        var fmt, txt;
        if (ordenada) {
          var t = l === 0 && tipo ? tipo : ['decimal', 'lower-alpha', 'lower-roman'][l % 3];
          fmt = {'decimal': D.LevelFormat.DECIMAL, 'lower-alpha': D.LevelFormat.LOWER_LETTER, 'upper-alpha': D.LevelFormat.UPPER_LETTER, 'lower-roman': D.LevelFormat.LOWER_ROMAN, 'upper-roman': D.LevelFormat.UPPER_ROMAN}[t] || D.LevelFormat.DECIMAL;
          txt = '%' + (l + 1) + (t === 'lower-alpha' ? ')' : '.');
        } else {
          fmt = D.LevelFormat.BULLET;
          var ch = l === 0 && tipo ? ({disc: '●', circle: '○', square: '■'}[tipo] || tipo.replace(/["']/g, '')) : ['●', '○', '■'][l % 3];
          txt = ch;
        }
        niveles.push({level: l, format: fmt, text: txt, alignment: D.AlignmentType.LEFT, start: l === 0 ? (inicio || 1) : 1,
          style: {paragraph: {indent: {left: 720 * (l + 1), hanging: 360}}}});
      }
      numeraciones.push({reference: ref, levels: niveles});
      refsNum[clave] = ref; return ref;
    }

    // ----- texto (runs) -----
    function runsDe(nodos, f, ctx) {
      var out = [];
      Array.prototype.forEach.call(nodos, function(n) {
        if (n.nodeType === 3) {
          var t = n.data.replace(/[\r\n]+/g, ' ');
          if (!t) return;
          if (ctx.colapsar !== false) t = t.replace(/\s+/g, ' ');
          out.push(new D.TextRun(Object.assign({text: t.replace(/\t/g, '    ')}, opcRun(f))));
          return;
        }
        if (n.nodeType !== 1) return;
        var tag = n.nodeName, st = estilos(n), g = Object.assign({}, f);
        if (st.display === 'none') return;
        if (tag === 'BR') { out.push(new D.TextRun(Object.assign({text: '', break: 1}, opcRun(f)))); return; }
        if (tag === 'IMG') { var ir = imagen(n); if (ir) out.push(ir); return; }
        if (tag === 'SUP' && n.classList.contains('nv-nota') && n.getAttribute('data-n')) { out.push(new D.FootnoteReferenceRun(+n.getAttribute('data-n'))); return; }
        if (n.getAttribute('data-campo') === 'pagina') { out.push(new D.TextRun(Object.assign({children: [D.PageNumber.CURRENT]}, opcRun(f)))); return; }
        if (n.getAttribute('data-campo') === 'paginas') { out.push(new D.TextRun(Object.assign({children: [D.PageNumber.TOTAL_PAGES]}, opcRun(f)))); return; }
        if (n.getAttribute('data-campo') === 'fecha') { out.push(new D.TextRun(Object.assign({text: new Date().toLocaleDateString('es-CO')}, opcRun(f)))); return; }
        if (n.getAttribute('data-campo') === 'hoy') {  // "Fecha de hoy" → campo DATE de Word (Word también lo actualiza al abrir)
          var fmt = n.getAttribute('data-formato') || '{d} de {mes} de {aaaa}', txtHoy = NV.fechas.formatear(fmt);
          var g2 = Object.assign({}, f); aplicarCss(g2, estilos(n), n);
          if (D.SimpleField) out.push(new D.SimpleField('DATE \\@ "' + NV.fechas.formatoWord(fmt) + '"', txtHoy));
          else out.push(new D.TextRun(Object.assign({text: txtHoy}, opcRun(g2))));
          return;
        }
        if (n.classList.contains('nv-salto-col')) { out.push(new D.ColumnBreak()); return; }
        if (tag === 'STRONG' || tag === 'B') g.bold = true;
        if (tag === 'EM' || tag === 'I' || tag === 'CITE' || tag === 'DFN') g.italics = true;
        if (tag === 'U' || tag === 'INS') g.underline = {type: 'single'};
        if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') g.strike = true;
        if (tag === 'SUB') g.subScript = true;
        if (tag === 'SUP') g.superScript = true;
        if (tag === 'CODE' || tag === 'KBD' || tag === 'SAMP') g.font = 'Courier New';
        if (tag === 'MARK') g.highlight = 'yellow';
        if (tag === 'SMALL') g.size = Math.round((g.size || 22) * 0.83);
        aplicarCss(g, st, n);
        var cls = (n.getAttribute('class') || '');
        var cs = /nv-(SubtleEmphasis|IntenseEmphasis|SubtleReference|IntenseReference|BookTitle)/.exec(cls); if (cs) g.style = cs[1];
        if (/nv-sombra|nv-wa1|nv-wa4/.test(cls)) g.shadow = true;
        if (/nv-contorno|nv-wa2/.test(cls)) g.outline = true;
        if (/nv-wa[1-4]/.test(cls)) { g.bold = true; g.color = g.color || hex(temaDe(aj).acentos[0]); }
        var hijos = runsDe(n.childNodes, g, ctx);
        if (tag === 'A' && n.getAttribute('href')) {
          var href = n.getAttribute('href');
          if (!hijos.length) return;
          if (href.charAt(0) === '#') out.push(new D.InternalHyperlink({anchor: idMarcador(href.slice(1)), children: hijos}));
          else out.push(new D.ExternalHyperlink({link: href, children: hijos.map(function(r) { return r; })}));
          return;
        }
        if (tag === 'A' && n.id && !n.getAttribute('href')) { out.push(new D.Bookmark({id: idMarcador(n.id), children: hijos.length ? hijos : [new D.TextRun('')]})); return; }
        Array.prototype.push.apply(out, hijos);
      });
      return out;
    }
    function aplicarCss(g, st, n) {
      if (st['font-weight']) g.bold = /bold|[6-9]00/.test(st['font-weight']);
      if (st['font-style']) g.italics = st['font-style'] === 'italic' || st['font-style'] === 'oblique';
      var td = (st['text-decoration'] || '') + ' ' + (st['text-decoration-line'] || '');
      if (/underline/.test(td)) {
        var est = st['text-decoration-style'] || (/double|dotted|dashed|wavy/.exec(td) || [''])[0];
        g.underline = {type: {double: 'double', dotted: 'dotted', dashed: 'dash', wavy: 'wave'}[est] || (st['text-decoration-thickness'] ? 'thick' : 'single')};
        var uc = hex(st['text-decoration-color']); if (uc) g.underline.color = uc;
      } else if (/none/.test(td)) g.underline = undefined;
      if (/line-through/.test(td)) { if (/double/.test(st['text-decoration-style'] || td)) g.doubleStrike = true; else g.strike = true; }
      if (st.color) { var c = hex(st.color); if (c) g.color = c; }
      var bg = hex(st['background-color'] || st.background);
      if (bg) { if (RESALTE[bg]) { g.highlight = RESALTE[bg]; g.shading = undefined; } else { g.shading = {type: D.ShadingType.CLEAR, color: 'auto', fill: bg}; g.highlight = undefined; } }
      if (st['font-family']) g.font = familia(st['font-family']);
      if (st['font-size']) { var p = pt(st['font-size'], (g.size || 22) / 2); if (p) g.size = Math.round(p * 2); }
      if (st['font-variant'] === 'small-caps') g.smallCaps = true;
      if (st['text-transform'] === 'uppercase') g.allCaps = true;
      if (st['letter-spacing']) { var ls = twip(st['letter-spacing']); if (ls) g.characterSpacing = ls; }
      if (st['vertical-align'] === 'super') g.superScript = true;
      if (st['vertical-align'] === 'sub') g.subScript = true;
    }
    function opcRun(f) {
      var o = {};
      ['bold', 'italics', 'underline', 'strike', 'doubleStrike', 'superScript', 'subScript', 'color', 'highlight', 'shading', 'font', 'size', 'smallCaps', 'allCaps', 'characterSpacing', 'style', 'shadow', 'outline'].forEach(function(k) {
        if (f[k] !== undefined && f[k] !== null && f[k] !== false) o[k] = f[k];
      });
      return o;
    }
    function imagen(im, flotante) {
      var src = im.getAttribute('src') || '';
      var mt = /^data:image\/(png|jpe?g|gif|bmp)/i.exec(src); if (!mt) return null;
      var t = X.tamImagen(im, anchoUtilPx), st = estilos(im);
      var o = {type: mt[1].toLowerCase() === 'jpeg' ? 'jpg' : mt[1].toLowerCase(), data: NV.dataUrlABytes(src), transformation: {width: t.w, height: t.h},
               altText: {title: im.getAttribute('alt') || 'Imagen', description: im.getAttribute('alt') || '', name: 'Imagen'}};
      if (st.float === 'left' || st.float === 'right') {
        o.floating = {horizontalPosition: {relative: D.HorizontalPositionRelativeFrom.COLUMN, align: st.float === 'left' ? D.HorizontalPositionAlign.LEFT : D.HorizontalPositionAlign.RIGHT},
          verticalPosition: {relative: D.VerticalPositionRelativeFrom.PARAGRAPH, offset: 0},
          wrap: {type: D.TextWrappingType.SQUARE, side: D.TextWrappingSide.BOTH_SIDES}, margins: {left: 114300, right: 114300, top: 0, bottom: 57150}};
      }
      return new D.ImageRun(o);
    }

    // ----- párrafos -----
    var ESTILO_CLASE = {'nv-Title': 'Title', 'nv-Subtitle': 'Subtitle', 'nv-Quote': 'Quote', 'nv-IntenseQuote': 'IntenseQuote', 'nv-NoSpacing': 'NoSpacing', 'nv-ListParagraph': 'ListParagraph', 'nv-Caption': 'Caption'};
    function bordeDe(v) {
      if (!v || /none|hidden/.test(v)) return null;
      var w = (/([\d.]+)(px|pt)/.exec(v) || []), est = /double/.test(v) ? D.BorderStyle.DOUBLE : /dotted/.test(v) ? D.BorderStyle.DOTTED : /dashed/.test(v) ? D.BorderStyle.DASHED : D.BorderStyle.SINGLE;
      var p = w[1] ? (w[2] === 'px' ? +w[1] * 0.75 : +w[1]) : 0.75;
      var col = hex((/(#[0-9a-f]{3,6}|rgba?\([^)]+\)|\b[a-z]+$)/i.exec(v) || [])[0]) || '000000';
      return {style: est, size: Math.max(2, Math.round(p * 8)), color: col, space: 1};
    }
    function opcParrafo(el, ctx) {
      var st = estilos(el), o = {};
      var al = st['text-align'] || (el.getAttribute('align') || '');
      if (al) o.alignment = {left: D.AlignmentType.LEFT, start: D.AlignmentType.LEFT, center: D.AlignmentType.CENTER, right: D.AlignmentType.RIGHT, end: D.AlignmentType.RIGHT, justify: D.AlignmentType.JUSTIFIED}[al];
      var sp = {};
      if (st['margin-top'] != null) { var a = twip(st['margin-top']); if (a != null && a >= 0) sp.before = a; }
      if (st['margin-bottom'] != null) { var b = twip(st['margin-bottom']); if (b != null && b >= 0) sp.after = b; }
      if (st.margin && sp.before == null) { var mm = st.margin.split(/\s+/); var t0 = twip(mm[0]), b0 = twip(mm[2] || mm[0]); if (t0 != null) sp.before = Math.max(0, t0); if (b0 != null) sp.after = Math.max(0, b0); }
      if (st['line-height']) {
        var lh = st['line-height'];
        if (/^[\d.]+$/.test(lh)) { sp.line = Math.round(240 * parseFloat(lh)); sp.lineRule = D.LineRuleType.AUTO; }
        else if (/%$/.test(lh)) { sp.line = Math.round(2.4 * parseFloat(lh)); sp.lineRule = D.LineRuleType.AUTO; }
        else { var lt = twip(lh); if (lt) { sp.line = lt; sp.lineRule = D.LineRuleType.EXACT; } }
      }
      if (Object.keys(sp).length) o.spacing = sp;
      var ind = {}, ml = twip(st['margin-left'] || st['padding-left']), mr = twip(st['margin-right']), ti = twip(st['text-indent']);
      if (ml) ind.left = ml; if (mr) ind.right = mr;
      if (ti > 0) ind.firstLine = ti; if (ti < 0) { ind.hanging = -ti; ind.left = (ind.left || 0); }
      if (ctx.sangria) ind.left = (ind.left || 0) + ctx.sangria;
      if (Object.keys(ind).length) o.indent = ind;
      var bg = hex(st['background-color'] || st.background); if (bg) o.shading = {type: D.ShadingType.CLEAR, color: 'auto', fill: bg};
      var bd = {};
      ['top', 'bottom', 'left', 'right'].forEach(function(l) { var x = bordeDe(st['border-' + l] || st.border); if (x) bd[l] = x; });
      if (Object.keys(bd).length) o.border = bd;
      if (st['break-before'] === 'page' || st['page-break-before'] === 'always') o.pageBreakBefore = true;
      if (st['break-after'] === 'avoid') o.keepNext = true;
      var tag = el.nodeName;
      if (/^H[1-6]$/.test(tag)) o.heading = D.HeadingLevel['HEADING_' + tag[1]];
      var cls = el.getAttribute('class') || '';
      Object.keys(ESTILO_CLASE).forEach(function(k) { if (cls.split(/\s+/).indexOf(k) >= 0) { if (k === 'nv-Title') o.heading = D.HeadingLevel.TITLE; else o.style = ESTILO_CLASE[k]; } });
      if (/nv-capital/.test(cls)) o.style = o.style || undefined;
      return o;
    }
    function parrafo(el, ctx, extra) {
      var f = Object.assign({}, ctx.run || {});
      var st = estilos(el); aplicarCss(f, st, el);
      if (el.nodeName === 'TH') f.bold = true;
      var kids = runsDe(soloInline(el), f, ctx);
      if (el.id && /^H[1-6]$/.test(el.nodeName) && kids.length) kids = [new D.Bookmark({id: idMarcador(el.id), children: kids})];
      var o = Object.assign(opcParrafo(el, ctx), extra || {}, {children: kids});
      if (ctx.alineacion && !o.alignment) o.alignment = ctx.alineacion;
      return new D.Paragraph(o);
    }
    function soloInline(el) { return Array.prototype.filter.call(el.childNodes, function(n) { return !(n.nodeType === 1 && /^(UL|OL|TABLE|DIV|P|H[1-6]|BLOCKQUOTE)$/.test(n.nodeName)); }); }
    function tieneBloques(el) { return Array.prototype.some.call(el.children, function(n) { return /^(P|H[1-6]|UL|OL|TABLE|DIV|BLOCKQUOTE|HR|SECTION|ARTICLE|FIGURE)$/.test(n.nodeName); }); }

    function bloquesDe(nodos, ctx) {
      var out = [], suelto = [];
      var vaciar = function() {
        if (!suelto.length) return;
        var tmp = document.createElement('p'); suelto.forEach(function(n) { tmp.appendChild(n.cloneNode(true)); });
        if (tmp.textContent.trim() || tmp.querySelector('img,br')) out.push(parrafo(tmp, ctx));
        suelto = [];
      };
      Array.prototype.forEach.call(nodos, function(n) {
        if (n.nodeType === 3) { if (n.data.trim()) suelto.push(n); return; }
        if (n.nodeType !== 1) return;
        var tag = n.nodeName, cls = n.getAttribute('class') || '', st = estilos(n);
        if (st.display === 'none') return;
        if (!/^(P|H[1-6]|DIV|UL|OL|TABLE|HR|BLOCKQUOTE|SECTION|ARTICLE|FIGURE|PRE|LI)$/.test(tag)) { suelto.push(n); return; }
        vaciar();
        if (/nv-salto/.test(cls) && !/nv-salto-col/.test(cls)) { out.push(new D.Paragraph({children: [new D.PageBreak()]})); return; }
        if (/nv-toc/.test(cls)) {
          var tt = n.getAttribute('data-nv-toc') || 'Contenido';
          out.push(new D.Paragraph({text: tt, style: 'TOCHeading', spacing: {before: 240, after: 120}}));
          out.push(new D.TableOfContents(tt, {hyperlink: true, headingStyleRange: '1-3'}));
          return;
        }
        if (/nv-notas/.test(cls) && /nv-notas-pie/.test(cls)) return;
        if (tag === 'HR') { out.push(new D.Paragraph({children: [], border: {bottom: {style: D.BorderStyle.SINGLE, size: 6, color: 'A0A0A0', space: 1}}})); return; }
        if (tag === 'UL' || tag === 'OL') { lista(n, ctx, 0, out); return; }
        if (tag === 'TABLE') { out.push(tabla(n, ctx)); if (ctx.celda !== true) out.push(new D.Paragraph({children: [], spacing: {after: 0}})); return; }
        if (tag === 'PRE') { n.textContent.split('\n').forEach(function(l) { out.push(new D.Paragraph({children: [new D.TextRun({text: l, font: 'Courier New', size: 20})], spacing: {after: 0}})); }); return; }
        if (/nv-cuadro/.test(cls)) { out.push(cuadro(n, ctx)); return; }
        if ((tag === 'DIV' || tag === 'BLOCKQUOTE' || tag === 'SECTION' || tag === 'ARTICLE' || tag === 'FIGURE') && tieneBloques(n)) {
          var c2 = Object.assign({}, ctx);
          if (tag === 'BLOCKQUOTE') c2.sangria = (c2.sangria || 0) + 720;
          if (st['text-align']) c2.alineacion = {center: D.AlignmentType.CENTER, right: D.AlignmentType.RIGHT, justify: D.AlignmentType.JUSTIFIED}[st['text-align']];
          Array.prototype.push.apply(out, bloquesDe(n.childNodes, c2));
          return;
        }
        var c3 = tag === 'BLOCKQUOTE' ? Object.assign({}, ctx, {sangria: (ctx.sangria || 0) + 720}) : ctx;
        out.push(parrafo(n, c3));
        // listas o tablas anidadas dentro de un párrafo/div
        Array.prototype.forEach.call(n.children, function(h) {
          if (h.nodeName === 'UL' || h.nodeName === 'OL') lista(h, ctx, 0, out);
          else if (h.nodeName === 'TABLE') out.push(tabla(h, ctx));
        });
      });
      vaciar();
      return out;
    }
    function lista(el, ctx, nivel, out) {
      var ord = el.nodeName === 'OL', st = estilos(el);
      var tipo = st['list-style-type'] || el.getAttribute('type') && ({'1': 'decimal', a: 'lower-alpha', A: 'upper-alpha', i: 'lower-roman', I: 'upper-roman'})[el.getAttribute('type')] || '';
      var ref = refLista(ord, tipo, +el.getAttribute('start') || 1);
      var inst = ++instancia;
      Array.prototype.forEach.call(el.children, function(li) {
        if (li.nodeName !== 'LI') { if (li.nodeName === 'UL' || li.nodeName === 'OL') lista(li, ctx, nivel + 1, out); return; }
        var interior = li.querySelector(':scope > p');
        var base = interior && li.children.length && Array.prototype.every.call(li.children, function(c) { return /^(P|UL|OL)$/.test(c.nodeName); }) ? null : li;
        if (base) out.push(parrafo(li, ctx, {numbering: {reference: ref, level: Math.min(8, nivel), instance: inst}}));
        else {
          var primero = true;
          Array.prototype.forEach.call(li.children, function(c) {
            if (c.nodeName === 'P') { out.push(parrafo(c, ctx, primero ? {numbering: {reference: ref, level: Math.min(8, nivel), instance: inst}} : {indent: {left: 720 * (nivel + 1)}})); primero = false; }
          });
        }
        Array.prototype.forEach.call(li.children, function(c) { if (c.nodeName === 'UL' || c.nodeName === 'OL') lista(c, ctx, nivel + 1, out); });
      });
    }
    function anchoDe(v, total) {
      if (!v) return null;
      if (/%$/.test(v)) return Math.round(total * parseFloat(v) / 100);
      var t = twip(v); return t;
    }
    function tabla(el, ctx) {
      var filas = Array.prototype.filter.call(el.querySelectorAll('tr'), function(tr) { return tr.closest('table') === el; });
      var stT = estilos(el), total = anchoDe(stT.width, ctx.anchoTw || anchoUtilTw) || (ctx.anchoTw || anchoUtilTw);
      if (total > (ctx.anchoTw || anchoUtilTw)) total = ctx.anchoTw || anchoUtilTw;
      var nCols = 0;
      filas.forEach(function(tr) { var n = 0; Array.prototype.forEach.call(tr.children, function(td) { n += td.colSpan || 1; }); nCols = Math.max(nCols, n); });
      nCols = Math.max(1, nCols);
      var anchos = [], primera = filas[0];
      if (primera) {
        var i = 0;
        Array.prototype.forEach.call(primera.children, function(td) {
          var w = anchoDe(estilos(td).width, total) || anchoDe(td.getAttribute('width') && (td.getAttribute('width') + (/%/.test(td.getAttribute('width')) ? '' : 'px')), total);
          var span = td.colSpan || 1;
          for (var k = 0; k < span; k++) anchos[i++] = w ? Math.round(w / span) : null;
        });
      }
      var libres = anchos.filter(function(x) { return !x; }).length, usado = anchos.reduce(function(s, x) { return s + (x || 0); }, 0);
      for (var j = 0; j < nCols; j++) if (!anchos[j]) anchos[j] = Math.max(300, Math.round((total - usado) / Math.max(1, libres || nCols)));
      var suma = anchos.reduce(function(s, x) { return s + x; }, 0); if (suma > total) anchos = anchos.map(function(x) { return Math.round(x * total / suma); });
      var esEnc = function(tr) { return tr.parentNode && tr.parentNode.nodeName === 'THEAD'; };
      var rows = filas.map(function(tr) {
        var col = 0;
        var celdas = Array.prototype.map.call(tr.children, function(td) {
          var st = estilos(td), span = td.colSpan || 1, w = 0;
          for (var k = 0; k < span; k++) w += anchos[col + k] || 0;
          col += span;
          var hijos = bloquesDe(td.childNodes, Object.assign({}, ctx, {celda: true, anchoTw: w, run: td.nodeName === 'TH' ? {bold: true} : {},
            alineacion: st['text-align'] ? {center: D.AlignmentType.CENTER, right: D.AlignmentType.RIGHT, justify: D.AlignmentType.JUSTIFIED, left: D.AlignmentType.LEFT}[st['text-align']] : undefined}));
          if (!hijos.length) hijos = [new D.Paragraph('')];
          var o = {children: hijos, width: {size: w, type: D.WidthType.DXA}};
          if (span > 1) o.columnSpan = span;
          if ((td.rowSpan || 1) > 1) o.rowSpan = td.rowSpan;
          var bg = hex(st['background-color'] || st.background); if (bg) o.shading = {type: D.ShadingType.CLEAR, color: 'auto', fill: bg};
          var va = st['vertical-align']; if (va) o.verticalAlign = {top: D.VerticalAlign.TOP, middle: D.VerticalAlign.CENTER, bottom: D.VerticalAlign.BOTTOM}[va];
          var bds = {}, nada = {style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF'};
          ['top', 'bottom', 'left', 'right'].forEach(function(l) {
            var raw = st['border-' + l] || st.border;
            var b = bordeDe(raw);
            bds[l] = b || (raw && /none|0px/.test(raw) ? nada : (el.getAttribute('border') && el.getAttribute('border') !== '0' ? {style: D.BorderStyle.SINGLE, size: 4, color: '000000'} : nada));
          });
          o.borders = bds;
          if (st.padding) { var p = st.padding.split(/\s+/).map(function(x) { return twip(x) || 0; }); o.margins = {top: p[0], right: p[1] != null ? p[1] : p[0], bottom: p[2] != null ? p[2] : p[0], left: p[3] != null ? p[3] : (p[1] != null ? p[1] : p[0])}; }
          return new D.TableCell(o);
        });
        var ro = {children: celdas, tableHeader: esEnc(tr)};
        var h = twip(estilos(tr).height); if (h) ro.height = {value: h, rule: D.HeightRule.ATLEAST};
        return new D.TableRow(ro);
      });
      if (!rows.length) rows = [new D.TableRow({children: [new D.TableCell({children: [new D.Paragraph('')]})]})];
      var o = {rows: rows, width: {size: total, type: D.WidthType.DXA}, columnWidths: anchos, layout: D.TableLayoutType.FIXED};
      var mlT = stT['margin-left'] === 'auto' && stT['margin-right'] === 'auto'; if (mlT || el.getAttribute('align') === 'center') o.alignment = D.AlignmentType.CENTER;
      return new D.Table(o);
    }
    function cuadro(el, ctx) {  // cuadro de texto → tabla de una celda (se ve igual en Word)
      var st = estilos(el), w = anchoDe(st.width, ctx.anchoTw || anchoUtilTw) || (ctx.anchoTw || anchoUtilTw);
      var bg = hex(st['background-color'] || st.background), bd = bordeDe(st.border || '1px solid #000');
      var lados = {};
      ['top', 'bottom', 'left', 'right'].forEach(function(l) { var b = st['border-' + l] ? bordeDe(st['border-' + l]) : (st.border === '0' || /border:\s*0/.test(el.getAttribute('style') || '') ? null : bd); lados[l] = b || {style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF'}; });
      var run = {}; if (st.color) run.color = hex(st.color);
      var hijos = bloquesDe(el.childNodes, Object.assign({}, ctx, {celda: true, anchoTw: w, run: run}));
      if (!hijos.length) hijos = [new D.Paragraph('')];
      var cell = {children: hijos, borders: lados, width: {size: w, type: D.WidthType.DXA}, margins: {top: 80, bottom: 80, left: 140, right: 140}};
      if (bg) cell.shading = {type: D.ShadingType.CLEAR, color: 'auto', fill: bg};
      var o = {rows: [new D.TableRow({children: [new D.TableCell(cell)]})], width: {size: w, type: D.WidthType.DXA}, columnWidths: [w]};
      if (st.float === 'right') o.alignment = D.AlignmentType.RIGHT;
      if (st.float === 'right' || st.float === 'left') o.float = {horizontalAnchor: D.TableAnchorType.MARGIN, relativeHorizontalPosition: st.float === 'right' ? D.RelativeHorizontalPosition.RIGHT : D.RelativeHorizontalPosition.LEFT,
        verticalAnchor: D.TableAnchorType.TEXT, overlap: D.OverlapType.NEVER, leftFromText: 180, rightFromText: 180, bottomFromText: 120};
      return new D.Table(o);
    }

    // ----- secciones (las columnas son secciones continuas, como en Word) -----
    var pagNum = {start: aj.numInicio || 1};
    var fmtNum = {'i': D.NumberFormat.LOWER_ROMAN, 'I': D.NumberFormat.UPPER_ROMAN, 'a': D.NumberFormat.LOWER_LETTER, 'A': D.NumberFormat.UPPER_LETTER}[aj.formatoNum];
    if (fmtNum) pagNum.formatType = fmtNum;
    var page = {size: {width: Math.round(dm.w / 2.54 * 1440), height: Math.round(dm.h / 2.54 * 1440), orientation: horiz ? D.PageOrientation.LANDSCAPE : D.PageOrientation.PORTRAIT},
      margin: {top: Math.round(m.sup / 2.54 * 1440), bottom: Math.round(m.inf / 2.54 * 1440), left: Math.round(m.izq / 2.54 * 1440), right: Math.round(m.der / 2.54 * 1440),
               header: Math.round((aj.distEnc || 1.25) / 2.54 * 1440), footer: Math.round((aj.distPie || 1.25) / 2.54 * 1440)},
      pageNumbers: pagNum};
    if (aj.bordePagina && aj.bordePagina.estilo) {
      var bp = aj.bordePagina, bs = {style: {double: D.BorderStyle.DOUBLE, dotted: D.BorderStyle.DOTTED, dashed: D.BorderStyle.DASHED}[bp.estilo] || D.BorderStyle.SINGLE, size: Math.round((bp.grosor || 1) * 8), color: hex(bp.color) || '000000', space: 24};
      page.borders = {pageBorderTop: bs, pageBorderBottom: bs, pageBorderLeft: bs, pageBorderRight: bs, pageBorders: {display: D.PageBorderDisplay.ALL_PAGES, offsetFrom: D.PageBorderOffsetFrom.TEXT}};
    }
    function zona(htmlZ) {
      if (!htmlZ) return null;
      var d = document.createElement('div'); d.innerHTML = htmlZ;
      var b = bloquesDe(d.childNodes, {anchoTw: anchoUtilTw}); return b.length ? b : null;
    }
    var headers = {}, footers = {};
    var enc = zona(aj.encabezado), pie = zona(aj.pie);
    if (enc) headers.default = new D.Header({children: enc});
    if (pie) footers.default = new D.Footer({children: pie});
    if (aj.primeraDistinta) {
      headers.first = new D.Header({children: zona(aj.encabezadoPrimera) || [new D.Paragraph('')]});
      footers.first = new D.Footer({children: zona(aj.piePrimera) || [new D.Paragraph('')]});
    }
    var secciones = [], actual = [], primera = true;
    var cerrar = function(cols, extra) {
      if (!actual.length && !primera) return;
      var props = {page: page};
      if (!primera) props.type = D.SectionType.CONTINUOUS;
      if (primera && aj.primeraDistinta) props.titlePage = true;
      if (cols) props.column = {count: cols.n, space: 720, separate: !!cols.linea, equalWidth: true};
      var s = {properties: props, children: actual.length ? actual : [new D.Paragraph('')]};
      if (primera) { s.headers = headers; s.footers = footers; }
      secciones.push(s); actual = []; primera = false;
    };
    Array.prototype.forEach.call(cont.childNodes, function(n) {
      if (n.nodeType === 1 && n.classList.contains('nv-cols')) {
        cerrar(null);
        actual = bloquesDe(n.childNodes, {anchoTw: anchoUtilTw});
        cerrar({n: parseInt(n.style.columnCount, 10) || 2, linea: n.classList.contains('linea')});
        return;
      }
      Array.prototype.push.apply(actual, bloquesDe([n], {anchoTw: anchoUtilTw}));
    });
    cerrar(null);

    var hT = hex(T.h), hT3 = hex(T.h3), ac = hex(T.acentos[0]);
    var linea = Math.round(240 * esp.linea);
    var docOpts = {
      creator: autor || 'Nuvia Office', title: titulo || 'Documento', description: 'Creado con Nuvia Office', lastModifiedBy: autor || 'Nuvia Office',
      features: {updateFields: !!cont.querySelector('.nv-toc')},
      styles: {
        default: {
          document: {run: {font: T.cuerpo, size: 22}, paragraph: {spacing: {before: esp.antes * 20, after: esp.despues * 20, line: linea, lineRule: D.LineRuleType.AUTO}}},
          heading1: {run: {font: T.titulos, size: 32, color: hT}, paragraph: {spacing: {before: 240, after: 0}, keepNext: true}},
          heading2: {run: {font: T.titulos, size: 26, color: hT}, paragraph: {spacing: {before: 40, after: 0}, keepNext: true}},
          heading3: {run: {font: T.titulos, size: 24, color: hT3}, paragraph: {spacing: {before: 40, after: 0}, keepNext: true}},
          heading4: {run: {font: T.titulos, size: 22, color: hT, italics: true}, paragraph: {spacing: {before: 40, after: 0}, keepNext: true}},
          heading5: {run: {font: T.titulos, size: 22, color: hT}, paragraph: {spacing: {before: 40, after: 0}}},
          heading6: {run: {font: T.titulos, size: 22, color: hT3}, paragraph: {spacing: {before: 40, after: 0}}},
          title: {run: {font: T.titulos, size: 56, characterSpacing: -10}, paragraph: {spacing: {after: 0, line: 240}}},
          hyperlink: {run: {color: '0563C1', underline: {type: 'single'}}},
          listParagraph: {paragraph: {indent: {left: 720}}}
        },
        paragraphStyles: [
          {id: 'Subtitle', name: 'Subtitle', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: {color: '5A5A5A', characterSpacing: 15}, paragraph: {spacing: {after: 160}}},
          {id: 'Quote', name: 'Quote', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: {italics: true, color: '404040'}, paragraph: {alignment: D.AlignmentType.CENTER, spacing: {before: 200, after: 160}, indent: {left: 864, right: 864}}},
          {id: 'IntenseQuote', name: 'Intense Quote', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: {italics: true, color: ac},
           paragraph: {alignment: D.AlignmentType.CENTER, spacing: {before: 360, after: 360}, indent: {left: 864, right: 864}, border: {top: {style: D.BorderStyle.SINGLE, size: 4, color: ac, space: 10}, bottom: {style: D.BorderStyle.SINGLE, size: 4, color: ac, space: 10}}}},
          {id: 'NoSpacing', name: 'No Spacing', basedOn: 'Normal', quickFormat: true, paragraph: {spacing: {before: 0, after: 0, line: 240}}},
          {id: 'Caption', name: 'caption', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: {italics: true, size: 18, color: hex(T.oscuro)}, paragraph: {spacing: {after: 200}}},
          {id: 'TOCHeading', name: 'TOC Heading', basedOn: 'Heading1', next: 'Normal', quickFormat: true, run: {font: T.titulos, size: 32, color: hT}}
        ],
        characterStyles: [
          {id: 'SubtleEmphasis', name: 'Subtle Emphasis', basedOn: 'DefaultParagraphFont', quickFormat: true, run: {italics: true, color: '404040'}},
          {id: 'IntenseEmphasis', name: 'Intense Emphasis', basedOn: 'DefaultParagraphFont', quickFormat: true, run: {italics: true, color: ac}},
          {id: 'SubtleReference', name: 'Subtle Reference', basedOn: 'DefaultParagraphFont', quickFormat: true, run: {smallCaps: true, color: '5A5A5A'}},
          {id: 'IntenseReference', name: 'Intense Reference', basedOn: 'DefaultParagraphFont', quickFormat: true, run: {smallCaps: true, bold: true, color: ac, characterSpacing: 5}},
          {id: 'BookTitle', name: 'Book Title', basedOn: 'DefaultParagraphFont', quickFormat: true, run: {bold: true, italics: true, characterSpacing: 5}}
        ]
      },
      numbering: {config: numeraciones.length ? numeraciones : [{reference: 'nv-vacia', levels: [{level: 0, format: D.LevelFormat.DECIMAL, text: '%1.', alignment: D.AlignmentType.LEFT}]}]},
      footnotes: notas,
      sections: secciones
    };
    if (aj.colorPagina && hex(aj.colorPagina)) docOpts.background = {color: hex(aj.colorPagina)};
    var doc = new D.Document(docOpts);
    return D.Packer.toBlob(doc);
  }

  // ---------- Importar un .docx ----------
  X.importar = function(buffer) {
    return NV.lib.docxPreview().then(function(P) {
      var host = document.createElement('div'), estilos2 = document.createElement('div');
      // fuente base = la predeterminada de Word (si el .docx no dice otra cosa); así no se cuela la fuente de la pantalla
      host.style.cssText = 'position:fixed;left:-30000px;top:0;width:1200px;visibility:hidden;font-family:Calibri,Carlito,sans-serif;font-size:11pt;color:#000;line-height:normal';
      document.body.appendChild(estilos2); document.body.appendChild(host);
      return P.renderAsync(buffer, host, estilos2, {className: 'nvdx', inWrapper: false, ignoreWidth: false, ignoreHeight: false, ignoreFonts: false,
        breakPages: true, ignoreLastRenderedPageBreak: true, renderHeaders: true, renderFooters: true, renderFootnotes: true, renderEndnotes: true,
        useBase64URL: true, experimental: true, trimXmlDeclaration: true, debug: false})
        .then(function() {
          // docx-preview pone la dirección de las imágenes después de terminar: se espera a que todas la tengan
          return new Promise(function(ok) {
            var t0 = Date.now();
            (function mirar() {
              var faltan = Array.prototype.filter.call(host.querySelectorAll('img'), function(i) { return !i.getAttribute('src'); }).length;
              if (!faltan || Date.now() - t0 > 8000) ok(); else setTimeout(mirar, 60);
            })();
          });
        }).then(function() {
          var r = convertir(host);
          host.remove(); estilos2.remove();
          return camposEncPie(buffer, r);
        }, function(e) { host.remove(); estilos2.remove(); throw new Error('No se pudo leer el archivo de Word (' + (e && e.message || e) + ').'); });
    });
  };
  // docx-preview no dibuja los campos de número de página del encabezado/pie: se leen del .docx y se agregan.
  function camposEncPie(buffer, r) {
    return NV.lib.jszip().then(function(JSZip) { return JSZip.loadAsync(buffer); }).then(function(zip) {
      var leer = function(pref) {
        var fs = Object.keys(zip.files).filter(function(n) { return new RegExp('^word/' + pref + '\\d*\\.xml$').test(n); });
        return Promise.all(fs.map(function(n) { return zip.file(n).async('string'); })).then(function(xs) { return xs.join(''); });
      };
      return Promise.all([leer('header'), leer('footer')]).then(function(x) {
        [['encabezado', x[0]], ['pie', x[1]]].forEach(function(par) {
          var z = par[0], xml = par[1] || '', h = r.ajustes[z] || '';
          if (/data-campo=/.test(h)) return;
          var pag = /instrText[^>]*>\s*PAGE\b/.test(xml) || /fldSimple[^>]*instr="\s*PAGE\b/.test(xml);
          var tot = /instrText[^>]*>\s*NUMPAGES\b/.test(xml) || /fldSimple[^>]*instr="\s*NUMPAGES\b/.test(xml);
          if (!pag && !tot) return;
          var campos = (pag ? '<span data-campo="pagina">#</span>' : '') + (pag && tot ? ' de ' : '') + (tot ? '<span data-campo="paginas">#</span>' : '');
          if (/<\/p>\s*$/.test(h)) h = h.replace(/<\/p>\s*$/, campos + '</p>'); else h = (h || '') + '<p>' + campos + '</p>';
          r.ajustes[z] = h;
        });
        return r;
      });
    }).catch(function() { return r; });
  }
  var INLINE = ['font-family', 'font-size', 'font-weight', 'font-style', 'color', 'background-color', 'text-decoration-line', 'text-decoration-style', 'text-decoration-color', 'vertical-align', 'font-variant-caps', 'text-transform', 'letter-spacing'];
  var BLOQUE = ['text-align', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right', 'text-indent', 'line-height', 'padding-left', 'background-color',
                'border-top', 'border-bottom', 'border-left', 'border-right'];
  function convertir(host) {
    var secs = host.querySelectorAll('section.nvdx');
    var aj = NV.word.ajustesPredeterminados();
    var s0 = secs[0];
    if (s0) {
      // docx-preview escribe el tamaño de la hoja en pt (p. ej. "595.3pt"); se convierte según la unidad
      var aCm = function(v) { var p = NV.aPt(v); return p == null ? null : p / 72 * 2.54; };
      var cs = getComputedStyle(s0), w = aCm(s0.style.width) || NV.pxACm(s0.offsetWidth), h = aCm(s0.style.minHeight) || aCm(s0.style.height) || 27.94;
      var tam = Object.keys(NV.word.TAMANOS).filter(function(k) { var t = NV.word.TAMANOS[k]; return (Math.abs(t.w - w) < 0.3 && Math.abs(t.h - h) < 0.3) || (Math.abs(t.w - h) < 0.3 && Math.abs(t.h - w) < 0.3); })[0];
      if (tam) { aj.pagina.tam = tam; aj.pagina.orient = w > h ? 'h' : 'v'; } else if (w > 5 && h > 5) { aj.pagina.tam = 'personalizado'; aj.pagina.ancho = Math.min(w, h); aj.pagina.alto = Math.max(w, h); aj.pagina.orient = w > h ? 'h' : 'v'; }
      var cm = function(v) { var x = NV.pxACm(parseFloat(v) || 0); return Math.round(x * 100) / 100; };
      aj.pagina.margenes = {sup: cm(cs.paddingTop) || 2.54, inf: cm(cs.paddingBottom) || 2.54, izq: cm(cs.paddingLeft) || 2.54, der: cm(cs.paddingRight) || 2.54};
      var hd = s0.querySelector('header'), ft = s0.querySelector('footer');
      if (hd && hd.textContent.trim() || hd && hd.querySelector('img')) aj.encabezado = limpiar(hd, true);
      if (ft && ft.textContent.trim() || ft && ft.querySelector('img')) aj.pie = limpiar(ft, true);
    }
    // docx-preview parte el documento donde hay saltos de página explícitos; se unen con un salto de Nuvia Word.
    var html = Array.prototype.map.call(secs, function(s) { var art = s.querySelector('article') || s; return limpiar(art, false); }).join('<div class="nv-salto"></div>');
    return {html: html || '<p><br></p>', ajustes: aj};
  }
  // Copia el HTML de docx-preview con los estilos calculados en línea y quita sus clases.
  function limpiar(raiz, zona) {
    var salida = document.createElement('div');
    copiarHijos(raiz, salida, null);
    var h = salida.innerHTML;
    h = h.replace(/<span>([^<]*)<\/span>/g, '$1');
    return h;
  }
  function copiarHijos(origen, destino, padreCs) {
    Array.prototype.forEach.call(origen.childNodes, function(n) {
      if (n.nodeType === 3) { destino.appendChild(document.createTextNode(n.data)); return; }
      if (n.nodeType !== 1) return;
      var tag = n.nodeName.toLowerCase();
      if (/^(style|script|header|footer)$/.test(tag)) return;
      var cs = getComputedStyle(n);
      if (cs.display === 'none') return;
      var cls = n.getAttribute('class') || '';
      var nuevoTag = tag;
      if (tag === 'p') {
        var mh = /heading(\d)/i.exec(cls); if (mh && +mh[1] <= 6) nuevoTag = 'h' + mh[1];
        if (/\btitle\b|nvdx_title/i.test(cls) && !/subtitle/i.test(cls)) nuevoTag = 'p';
      }
      if (/^(section|article)$/.test(tag)) nuevoTag = 'div';
      if (tag === 'a' && !n.getAttribute('href') && !n.id) { copiarHijos(n, destino, cs); return; }
      var el = document.createElement(nuevoTag);
      if (/\bnvdx_title\b|_title\b/i.test(cls) && tag === 'p' && !/subtitle/i.test(cls)) el.className = 'nv-Title';
      if (/subtitle/i.test(cls) && tag === 'p') el.className = 'nv-Subtitle';
      if (/intensequote/i.test(cls)) el.className = 'nv-IntenseQuote'; else if (/quote/i.test(cls) && tag === 'p') el.className = 'nv-Quote';
      ['href', 'src', 'alt', 'colspan', 'rowspan', 'id', 'start'].forEach(function(a) { if (n.getAttribute(a) != null) el.setAttribute(a, n.getAttribute(a)); });
      var st = [];
      if (nuevoTag === 'ul' || nuevoTag === 'ol') {  // listas creadas al importar: solo el tipo de viñeta/número (el formato va en cada párrafo)
        if (n.style.listStyleType) el.setAttribute('style', 'list-style-type:' + n.style.listStyleType);
        destino.appendChild(el); copiarHijos(n, el, null); return;
      }
      if (nuevoTag === 'li') { destino.appendChild(el); copiarHijos(n, el, null); return; }
      var esBloque = /^(p|h\d|div|li|td|th|table|ul|ol|tr)$/.test(nuevoTag);
      INLINE.forEach(function(p) {
        var v = cs.getPropertyValue(p);
        if (!v) return;
        if (padreCs && padreCs.getPropertyValue(p) === v && !esBloque) return;
        if (p === 'background-color' && /rgba\(0, 0, 0, 0\)|transparent/.test(v)) return;
        if (p === 'text-decoration-line' && v === 'none') return;
        if ((p === 'text-decoration-style' || p === 'text-decoration-color') && cs.textDecorationLine === 'none') return;
        if (p === 'vertical-align' && /baseline|top|middle|bottom/.test(v) && !/^t[dh]$/.test(nuevoTag)) return;
        if (p === 'font-weight' && (v === '400' || v === 'normal') && !(padreCs && padreCs.fontWeight !== v)) return;
        if (p === 'font-style' && v === 'normal' && !(padreCs && padreCs.fontStyle !== v)) return;
        if (p === 'font-variant-caps' && v === 'normal') return;
        if (p === 'text-transform' && v === 'none') return;
        if (p === 'letter-spacing' && v === 'normal') return;
        if (p === 'font-size') v = (Math.round(NV.pxAPt(parseFloat(v)) * 2) / 2) + 'pt';
        if (p === 'text-decoration-line') { st.push('text-decoration:' + v); return; }
        if (p === 'font-variant-caps') { st.push('font-variant:' + v); return; }
        st.push(p + ':' + v);
      });
      if (esBloque) {
        BLOQUE.forEach(function(p) {
          var v = cs.getPropertyValue(p); if (!v) return;
          if (/^margin|^padding|text-indent/.test(p)) { var px = parseFloat(v) || 0; if (!px) { if (/^margin-(top|bottom)/.test(p) && /^(p|h\d|li)$/.test(nuevoTag)) st.push(p + ':0pt'); return; } v = (Math.round(NV.pxAPt(px) * 10) / 10) + 'pt'; }
          if (p === 'line-height') { if (v === 'normal') return; var fs = parseFloat(cs.fontSize) || 14.67; v = String(Math.round(parseFloat(v) / fs * 100) / 100); }
          if (p === 'text-align' && (v === 'start' || v === 'left')) return;
          if (p === 'background-color' && /rgba\(0, 0, 0, 0\)|transparent/.test(v)) return;
          if (/^border/.test(p)) { if (/none|0px/.test(v) || /^0px/.test(v)) return; v = v.replace(/(\d+(\.\d+)?)px/, function(m, x) { return (Math.round(+x * 0.75 * 100) / 100) + 'pt'; }); }
          st.push(p + ':' + v);
        });
        if (nuevoTag === 'table') { st.push('border-collapse:collapse'); var tw = n.style.width || (n.offsetWidth ? NV.pxACm(n.offsetWidth).toFixed(2) + 'cm' : ''); if (tw) st.push('width:' + tw); }
        if (/^t[dh]$/.test(nuevoTag)) { var cw = n.style.width; if (cw) st.push('width:' + cw); st.push('vertical-align:' + cs.verticalAlign); var pd = ['top', 'right', 'bottom', 'left'].map(function(l) { return (Math.round(NV.pxAPt(parseFloat(cs.getPropertyValue('padding-' + l)) || 0) * 10) / 10) + 'pt'; }).join(' '); st.push('padding:' + pd); }
      }
      if (nuevoTag === 'img') {
        // docx-preview marca los datos como "application/octet-stream": se pone el tipo real según los primeros bytes
        var src0 = el.getAttribute('src') || '';
        if (/^data:application\/octet-stream;base64,/.test(src0)) {
          var b64 = src0.slice(src0.indexOf(',') + 1, src0.indexOf(',') + 12);
          var tipo = /^iVBOR/.test(b64) ? 'image/png' : /^\/9j\//.test(b64) ? 'image/jpeg' : /^R0lGOD/.test(b64) ? 'image/gif' : /^Qk/.test(b64) ? 'image/bmp' : /^PHN2Zy|^PD94/.test(b64) ? 'image/svg+xml' : 'image/png';
          el.setAttribute('src', 'data:' + tipo + src0.slice(src0.indexOf(';')));
        }
        var cont0 = n.parentNode && n.parentNode.style && n.parentNode.style.width ? n.parentNode : null;  // tamaño en el contenedor (pt)
        var w2 = (n.style.width && !/%/.test(n.style.width) ? n.style.width : '') || (cont0 ? cont0.style.width : '') || (n.width ? n.width + 'px' : '');
        var h2 = (n.style.height && !/%/.test(n.style.height) ? n.style.height : '') || (cont0 ? cont0.style.height : '') || (n.height ? n.height + 'px' : '');
        if (w2) st.push('width:' + w2); if (h2) st.push('height:' + h2);
        if (cs.float && cs.float !== 'none') st.push('float:' + cs.float);
      }
      if (st.length) el.setAttribute('style', st.join(';'));
      destino.appendChild(el);
      // listas de docx-preview: párrafos con viñeta dibujada por CSS → ul/ol reales
      copiarHijos(n, el, cs);
      if (/^p$/.test(nuevoTag) && !el.textContent.trim() && !el.querySelector('img,br')) el.appendChild(document.createElement('br'));
    });
    agruparListas(destino);
  }
  function agruparListas(cont) {
    // docx-preview marca los párrafos numerados con clases "nvdx-num-<id>-<nivel>"; aquí ya no hay clases, así que se
    // reconocen por el marcador ::before que quedó en el original. Se hace en una pasada aparte (ver marcarListas).
  }
  // Antes de limpiar: convierte los párrafos numerados de docx-preview en <ul>/<ol> (por su marcador ::before).
  var limpiarOrig = limpiar;
  limpiar = function(raiz, zona) {
    marcarListas(raiz);
    return limpiarOrig(raiz, zona);
  };
  function marcarListas(raiz) {
    var ps = Array.prototype.slice.call(raiz.querySelectorAll('p[class*="-num-"]'));
    var actual = null, clave = null;
    ps.forEach(function(p) {
      var m = /-num-(\d+)-(\d+)/.exec(p.className); if (!m) return;
      var antes = getComputedStyle(p, '::before').content || '';
      var ord = /counter\(/.test(antes) && !/"[•●○■▪◦➢✓◆–\-·]"/.test(antes);
      var tipo = ord ? ((/lower-alpha|lower-latin/.test(antes) && 'lower-alpha') || (/upper-alpha|upper-latin/.test(antes) && 'upper-alpha') || (/lower-roman/.test(antes) && 'lower-roman') || (/upper-roman/.test(antes) && 'upper-roman') || 'decimal') : 'disc';
      var nivel = +m[2], k = m[1];
      var prev = p.previousElementSibling;
      if (!actual || clave !== k || prev !== actual.ultimo) {
        actual = {raiz: document.createElement(ord ? 'ol' : 'ul'), pila: [], ultimo: null};
        actual.raiz.style.listStyleType = tipo;
        p.parentNode.insertBefore(actual.raiz, p);
        actual.pila = [actual.raiz]; clave = k;
      }
      while (actual.pila.length - 1 < nivel) {
        var ult = actual.pila[actual.pila.length - 1].lastElementChild || actual.pila[actual.pila.length - 1].appendChild(document.createElement('li'));
        var sub = document.createElement(ord ? 'ol' : 'ul'); ult.appendChild(sub); actual.pila.push(sub);
      }
      while (actual.pila.length - 1 > nivel) actual.pila.pop();
      var li = document.createElement('li');
      var sinMarca = p.cloneNode(true); sinMarca.className = sinMarca.className.replace(/\S*-num-\S*/g, '');
      sinMarca.style.marginLeft = '0'; sinMarca.style.textIndent = '0'; sinMarca.style.paddingLeft = '0';
      li.appendChild(sinMarca);
      actual.pila[actual.pila.length - 1].appendChild(li);
      actual.ultimo = actual.raiz;
      p.remove();
      actual.ultimo = actual.raiz.nextElementSibling === null ? actual.raiz : actual.raiz;
      actual._marca = li;
    });
    // corrige "ultimo": dos listas seguidas del mismo número quedan juntas
  }
})();
