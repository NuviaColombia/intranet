/* Nuvia PowerPoint ⇄ Microsoft PowerPoint (.pptx / .potx).
   Exportar con PptxGenJS (texto, formas, imágenes, tablas, gráficos nativos, fondos, notas, número de diapositiva) y luego
   se agregan las transiciones al XML. Importar: se lee el .pptx (patrón, diseños, tema, marcadores, formas, imágenes,
   tablas, gráficos, grupos, fondos, notas y transiciones). */
(function() {
  'use strict';
  var NV = window.NV, P = NV.ppt, X = P.pptx = {};
  NV.CDN.pptxgen = 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js';
  NV.lib.pptxgen = function() { return NV.cargarScript(NV.CDN.pptxgen).then(function() { return window.PptxGenJS; }); };
  var IN = function(pt) { return pt / 72; };
  function hex6(c) { var h = NV.docx.hex(c); return h || '000000'; }

  // ---------- Exportar ----------
  var FORMA_PPTX = {rect: 'rect', redondeado: 'roundRect', elipse: 'ellipse', triangulo: 'triangle', rombo: 'diamond', pentagono: 'pentagon', hexagono: 'hexagon', estrella: 'star5',
    flechaDer: 'rightArrow', flechaIzq: 'leftArrow', flechaArr: 'upArrow', flechaAba: 'downArrow', llamada: 'wedgeRectCallout', nube: 'cloud', corazon: 'heart', rayo: 'lightningBolt',
    cruz: 'plus', marco: 'frame', cilindro: 'can', chevron: 'chevron', pergamino: 'ribbon2', circuloFlecha: 'circularArrow'};
  X.exportar = function(pres, titulo, autor) {
    var tmp = JSON.parse(JSON.stringify(pres));
    return prepararImagenes(tmp).then(function() { return NV.lib.pptxgen(); }).then(function(PG) {
      var pp = new PG(), tam = tmp.tam;
      pp.defineLayout({name: 'NV', width: IN(tam.w), height: IN(tam.h)}); pp.layout = 'NV';
      pp.title = titulo || 'Presentación'; pp.author = autor || 'Nuvia Office'; pp.company = 'Nuvia Office'; pp.subject = titulo || '';
      pp.theme = {headFontFace: P.tema(tmp).titulos, bodyFontFace: P.tema(tmp).cuerpo};
      var maestros = {}, pie = tmp.pie || {};
      tmp.disenos.forEach(function(d) {
        var objs = [];
        (d.adornos || []).forEach(function(e) { var o = objetoMaestro(pp, e, tmp); if (o) objs.push(o); });
        var m = {title: 'NV_' + d.id, objects: objs};
        var bg = fondoPptx(d.fondo || P.tema(tmp).fondo); if (bg) m.background = bg;
        if (pie.numero && !(pie.noEnTitulo && d.id === 'titulo')) m.slideNumber = {x: IN(tam.w - 140), y: IN(tam.h - 38), w: IN(100), h: IN(24), color: '8C8C8C', fontSize: 12, align: 'right'};
        pp.defineSlideMaster(m); maestros[d.id] = m.title;
      });
      tmp.diapositivas.forEach(function(s, i) {
        var sl = pp.addSlide({masterName: maestros[s.diseno] || undefined});
        if (s.fondo) { var bg = fondoPptx(s.fondo); if (bg) sl.background = bg; }
        if (!(pie.noEnTitulo && s.diseno === 'titulo')) {
          if (pie.fecha) sl.addText(pie.fechaFija || NV.fechas.formatear(pie.formatoFecha), {x: IN(40), y: IN(tam.h - 38), w: IN(200), h: IN(24), fontSize: 12, color: '8C8C8C'});
          if (pie.texto) sl.addText(pie.texto, {x: IN(tam.w / 2 - 200), y: IN(tam.h - 38), w: IN(400), h: IN(24), fontSize: 12, color: '8C8C8C', align: 'center'});
        }
        s.elementos.forEach(function(e) { try { agregar(pp, sl, e, tmp); } catch (x) { console.warn('elemento no exportado', x); } });
        if (s.notas) sl.addNotes(textoPlano(s.notas));
      });
      return pp.write({outputType: 'arraybuffer'}).then(function(buf) { return posproceso(buf, tmp); });
    });
  };
  function textoPlano(html) { var d = document.createElement('div'); d.innerHTML = String(html || '').replace(/<\/(p|div|li)>/g, '$&\n').replace(/<br\s*\/?>/g, '\n'); return d.textContent.replace(/\n{3,}/g, '\n\n').trim(); }
  function fondoPptx(f) {
    if (!f) return null;
    if (f.tipo === 'color') return {color: hex6(f.color)};
    if ((f.tipo === 'imagen' || f.tipo === 'degradado') && f._png) return {data: f._png};
    if (f.tipo === 'degradado') return {color: hex6(f.desde)};
    return null;
  }
  function objetoMaestro(pp, e, pres) {
    var st = e.estilo || {};
    if (e.tipo === 'forma' && (e.forma || 'rect') === 'rect' && !e.rot) {
      var o = {x: IN(e.x), y: IN(e.y), w: IN(e.w), h: IN(e.h)};
      if (st.relleno && st.relleno !== 'none') o.fill = {color: hex6(P.color(pres, st.relleno))};
      if (st.borde && st.borde !== 'none') o.line = {color: hex6(P.color(pres, st.borde)), width: st.grosor || 1};
      return {rect: o};
    }
    if (e.tipo === 'imagen' && e._png) return {image: {x: IN(e.x), y: IN(e.y), w: IN(e.w), h: IN(e.h), data: e._png}};
    if (e._png) return {image: {x: IN(e.x), y: IN(e.y), w: IN(e.w), h: IN(e.h), data: e._png}};
    if (e.tipo === 'texto' && e.html) return {text: {text: textoPlano(e.html), options: {x: IN(e.x), y: IN(e.y), w: IN(e.w), h: IN(e.h), fontSize: (st.fs || 18), color: hex6(P.color(pres, st.color) || '#000')}}};
    return null;
  }
  // HTML de un cuadro → fragmentos de texto de PptxGenJS (párrafos, viñetas, formato por fragmento, vínculos).
  function fragmentos(html, base, pres) {
    var d = document.createElement('div'); d.innerHTML = NV.fechas.actualizarHtml(html || '');
    var out = [], parrafos = [];
    var recorrer = function(nodo, lista, nivel) {
      Array.prototype.forEach.call(nodo.childNodes, function(n) {
        if (n.nodeType === 1 && /^(UL|OL)$/.test(n.nodeName)) { recorrer(n, n.nodeName, nivel + 1); return; }
        if (n.nodeType === 1 && /^(P|DIV|LI|H\d)$/.test(n.nodeName) && Array.prototype.some.call(n.children, function(c) { return /^(UL|OL)$/.test(c.nodeName); })) {
          var solo = document.createElement(n.nodeName); Array.prototype.forEach.call(n.childNodes, function(c) { if (!(c.nodeType === 1 && /^(UL|OL)$/.test(c.nodeName))) solo.appendChild(c.cloneNode(true)); });
          parrafos.push({el: solo, lista: n.nodeName === 'LI' ? lista : null, nivel: nivel});
          Array.prototype.forEach.call(n.children, function(c) { if (/^(UL|OL)$/.test(c.nodeName)) recorrer(c, c.nodeName, nivel + 1); });
          return;
        }
        if (n.nodeType === 1 && /^(P|DIV|LI|H\d)$/.test(n.nodeName)) { parrafos.push({el: n, lista: n.nodeName === 'LI' ? lista : null, nivel: nivel}); return; }
        if (n.nodeType === 3 && !n.data.trim()) return;
        var p = document.createElement('p'); p.appendChild(n.cloneNode(true)); parrafos.push({el: p, lista: null, nivel: nivel});
      });
    };
    recorrer(d, null, 0);
    if (!parrafos.length) return [{text: '', options: {}}];
    parrafos.forEach(function(pa, i) {
      var opP = {}, al = pa.el.style && pa.el.style.textAlign;
      if (al) opP.align = al === 'justify' ? 'justify' : al;
      if (pa.lista === 'UL') opP.bullet = true; else if (pa.lista === 'OL') opP.bullet = {type: 'number'};
      if (pa.lista && pa.nivel > 1) opP.indentLevel = pa.nivel - 1;
      var runs = [];
      var r = function(n, f) {
        Array.prototype.forEach.call(n.childNodes, function(c) {
          if (c.nodeType === 3) { if (c.data) runs.push({text: c.data.replace(/ /g, ' '), options: Object.assign({}, f)}); return; }
          if (c.nodeType !== 1) return;
          if (c.nodeName === 'BR') { runs.push({text: '', options: Object.assign({}, f, {breakLine: true})}); return; }
          var g = Object.assign({}, f), s = c.style || {};
          if (/^(B|STRONG)$/.test(c.nodeName) || /bold|[6-9]00/.test(s.fontWeight)) g.bold = true;
          if (/^(I|EM)$/.test(c.nodeName) || s.fontStyle === 'italic') g.italic = true;
          if (c.nodeName === 'U' || /underline/.test(s.textDecoration)) g.underline = {style: 'sng'};
          if (/^(S|STRIKE|DEL)$/.test(c.nodeName) || /line-through/.test(s.textDecoration)) g.strike = 'sngStrike';
          if (c.nodeName === 'SUP') g.superscript = true; if (c.nodeName === 'SUB') g.subscript = true;
          if (s.color) g.color = hex6(s.color); if (c.getAttribute && c.getAttribute('color')) g.color = hex6(c.getAttribute('color'));
          if (s.fontSize) { var px = parseFloat(s.fontSize); if (px) g.fontSize = /pt$/.test(s.fontSize) ? px : px; }
          if (s.fontFamily) g.fontFace = (NV.fuentePorNombre(s.fontFamily) || {n: s.fontFamily.split(',')[0].replace(/["']/g, '')}).n;
          if (s.backgroundColor && !/transparent|rgba\(0, 0, 0, 0\)/.test(s.backgroundColor)) g.highlight = hex6(s.backgroundColor);
          if (c.nodeName === 'A' && c.getAttribute('href')) g.hyperlink = {url: c.getAttribute('href')};
          r(c, g);
        });
      };
      r(pa.el, {});
      if (!runs.length) runs.push({text: '', options: {}});
      runs.forEach(function(x, k) { if (k === 0) Object.assign(x.options, opP); });
      if (i < parrafos.length - 1) runs[runs.length - 1].options.breakLine = true;
      Array.prototype.push.apply(out, runs);
    });
    return out;
  }
  function agregar(pp, sl, e, pres) {
    var st = e.estilo || {}, pos = {x: IN(e.x), y: IN(e.y), w: IN(Math.max(1, e.w)), h: IN(Math.max(1, e.h))};
    if (e.rot) pos.rotate = e.rot;
    var link = e.vinculo ? (/^#\d+$/.test(e.vinculo) ? {slide: +e.vinculo.slice(1)} : {url: e.vinculo}) : null;
    if (e.tipo === 'texto' || e.tipo === 'forma') {
      if (e.tipo === 'texto' && e.marcador && P.textoVacio(e.html)) return;
      var op = Object.assign({}, pos, {fontFace: st.fuente || P.tema(pres).cuerpo, fontSize: st.fs || 18, color: hex6(P.color(pres, st.color) || (e.tipo === 'forma' ? '#FFFFFF' : P.tema(pres).c.o1)),
        align: st.align || (e.tipo === 'forma' ? 'center' : 'left'), valign: st.valign || (e.tipo === 'forma' ? 'middle' : 'top'), bold: !!st.negrita, italic: !!st.cursiva,
        underline: st.subrayado ? {style: 'sng'} : undefined, margin: [5, 7, 5, 7].map(function(v) { return v; }), fit: st.autoajuste === false ? 'none' : 'shrink', isTextBox: e.tipo === 'texto'});
      if (st.interlineado) op.lineSpacingMultiple = st.interlineado;
      if (st.sombraTexto) op.shadow = {type: 'outer', blur: 3, offset: 2, angle: 45, color: '000000', opacity: 0.4};
      if (st.columnas > 1) op.columns = st.columnas;
      if (e.tipo === 'forma') {
        op.shape = pp.ShapeType[FORMA_PPTX[e.forma] || 'rect'] || FORMA_PPTX[e.forma] || 'rect';
        if (st.relleno && st.relleno !== 'none') op.fill = {color: hex6(P.color(pres, st.relleno)), transparency: st.opacidad != null ? Math.round((1 - st.opacidad) * 100) : 0};
        if (st.borde && st.borde !== 'none') op.line = {color: hex6(P.color(pres, st.borde)), width: st.grosor || 1};
        if (st.sombra) op.shadow = {type: 'outer', blur: 6, offset: 4, angle: 45, color: '000000', opacity: 0.35};
      } else {
        if (st.relleno && st.relleno !== 'none') op.fill = {color: hex6(P.color(pres, st.relleno))};
        if (st.borde && st.borde !== 'none') op.line = {color: hex6(P.color(pres, st.borde)), width: st.grosor || 1};
      }
      if (link) op.hyperlink = link;
      sl.addText(e.html ? fragmentos(e.html, st, pres) : '', op);
      return;
    }
    if (e.tipo === 'imagen') {
      var src = P.srcDe ? P.srcDe(pres, e.src) : e.src; src = e._png || src;
      if (!src) return;
      var oi = Object.assign({}, pos, {data: src, altText: e.alt || ''});
      if (e.ajuste === 'cover' && e._nat) oi.sizing = {type: 'cover', w: pos.w, h: pos.h};
      if (e.ajuste === 'contain' && e._nat) oi.sizing = {type: 'contain', w: pos.w, h: pos.h};
      if (st.radio === '50%') oi.rounding = true;
      if (link) oi.hyperlink = link;
      sl.addImage(oi); return;
    }
    if (e.tipo === 'linea') {
      var ol = Object.assign({}, pos, {line: {color: hex6(P.color(pres, st.borde) || '#000'), width: st.grosor || 2, dashType: st.guiones ? 'dash' : 'solid', endArrowType: st.flecha ? 'triangle' : undefined}});
      if (e.invertida) ol.flipV = true;
      ol.h = Math.max(ol.h, 0.001);
      sl.addShape(pp.ShapeType.line, ol); return;
    }
    if (e.tipo === 'tabla') {
      var t = e.tabla, ac = hex6(P.color(pres, t.color || 'a1')), total = t.anchos.reduce(function(s, x) { return s + x; }, 0) || 1;
      var filas = t.filas.map(function(f, fi) {
        return f.filter(function(c) { return !c.oculta; }).map(function(c) {
          var enc = t.encabezado !== false && fi === 0, banda = t.bandas !== false && fi > 0 && fi % 2 === 1;
          var o = {fill: {color: hex6(c.fondo || (enc ? '#' + ac : banda ? P.mezclar('#' + ac, 0.8) : P.mezclar('#' + ac, 0.9)))}, color: hex6(c.color || (enc ? '#FFFFFF' : '#000000')), bold: enc, align: c.align || 'left', valign: 'middle'};
          if (c.cs > 1) o.colspan = c.cs; if (c.rs > 1) o.rowspan = c.rs;
          return {text: textoPlano(c.html) || '', options: o};
        });
      });
      sl.addTable(filas, {x: pos.x, y: pos.y, w: pos.w, colW: t.anchos.map(function(a) { return pos.w * a / total; }), fontFace: st.fuente || P.tema(pres).cuerpo, fontSize: st.fs || 16,
        border: {type: 'solid', color: hex6(t.borde || '#FFFFFF'), pt: 1}, autoPage: false});
      return;
    }
    if (e.tipo === 'grafico') {
      var g = e.grafico, tipo = g.tipo === 'circular' ? pp.ChartType.pie : g.tipo === 'lineas' ? pp.ChartType.line : pp.ChartType.bar;
      var datos = g.series.map(function(s) { return {name: s.nombre, labels: g.categorias, values: s.valores.map(function(v) { return +v || 0; })}; });
      var oc = Object.assign({}, pos, {showLegend: g.series.length > 1 || g.tipo === 'circular', legendPos: 'b', showTitle: !!g.titulo, title: g.titulo || '', titleFontSize: 16,
        chartColors: P.tema(pres).c.a.map(function(c) { return c.slice(1); }), barDir: g.tipo === 'barras' ? 'bar' : 'col', barGrouping: 'clustered', showPercent: g.tipo === 'circular', catAxisLabelFontSize: 11, valAxisLabelFontSize: 11});
      if (g.tipo === 'circular') datos = datos.slice(0, 1);
      sl.addChart(tipo, datos, oc);
    }
  }
  // Pasa a PNG lo que PowerPoint no lee bien (SVG, imágenes con filtros, formas como adornos de patrón, fondos degradados)
  function prepararImagenes(pres) {
    var tareas = [], srcDe = function(s) { return s && s.indexOf('res:') === 0 ? (pres.recursos || {})[s.slice(4)] : s; };
    P.srcDe = function(p, s) { return s && s.indexOf('res:') === 0 ? (p.recursos || {})[s.slice(4)] : s; };
    var aPng = function(url, w, h, filtro) {
      return new Promise(function(ok) {
        var img = new Image(); img.onload = function() {
          try { var c = document.createElement('canvas'), k = Math.min(3, Math.max(1, 1200 / Math.max(w, h))); c.width = Math.round((w || img.naturalWidth) * k); c.height = Math.round((h || img.naturalHeight) * k);
            var x = c.getContext('2d'); if (filtro) x.filter = filtro; x.drawImage(img, 0, 0, c.width, c.height); ok(c.toDataURL('image/png')); } catch (e) { ok(null); } };
        img.onerror = function() { ok(null); }; img.src = url;
      });
    };
    var gradiente = function(f, w, h) { var c = document.createElement('canvas'); c.width = Math.round(w); c.height = Math.round(h); var x = c.getContext('2d'), a = (f.angulo || 90) * Math.PI / 180;
      var g = x.createLinearGradient(w / 2 - Math.sin(a) * w / 2, h / 2 + Math.cos(a) * h / 2, w / 2 + Math.sin(a) * w / 2, h / 2 - Math.cos(a) * h / 2); g.addColorStop(0, f.desde); g.addColorStop(1, f.hasta); x.fillStyle = g; x.fillRect(0, 0, w, h); return c.toDataURL('image/png'); };
    var todos = [];
    pres.disenos.forEach(function(d) { (d.adornos || []).forEach(function(e) { todos.push({e: e, maestro: true}); }); if (d.fondo) todos.push({f: d.fondo}); });
    if (P.tema(pres).fondo) todos.push({f: P.tema(pres).fondo});
    pres.diapositivas.forEach(function(s) { s.elementos.forEach(function(e) { todos.push({e: e}); }); if (s.fondo) todos.push({f: s.fondo}); });
    todos.forEach(function(t) {
      if (t.f) {
        if (t.f.tipo === 'degradado') t.f._png = gradiente(t.f, pres.tam.w, pres.tam.h);
        if (t.f.tipo === 'imagen' && t.f.src) tareas.push(aPng(srcDe(t.f.src), pres.tam.w, pres.tam.h).then(function(u) { t.f._png = u; }));
        return;
      }
      var e = t.e, st = e.estilo || {};
      if (e.tipo === 'imagen') {
        var s = srcDe(e.src); if (!s) return;
        if (/^data:image\/svg/.test(s) || st.filtro || !/^data:image\/(png|jpe?g|gif)/.test(s)) tareas.push(aPng(s, e.w, e.h, st.filtro).then(function(u) { e._png = u; }));
        else e._png = s;
        tareas.push(new Promise(function(ok) { var i = new Image(); i.onload = function() { e._nat = [i.naturalWidth, i.naturalHeight]; ok(); }; i.onerror = ok; i.src = s; }));
      }
      if (t.maestro && e.tipo === 'forma' && ((e.forma || 'rect') !== 'rect' || e.rot)) tareas.push(aPng(NV.word.svgForma(e.forma, P.color(pres, st.relleno) || 'none', P.color(pres, st.borde) || 'none', st.grosor || 1, '', null, Math.round(e.w), Math.round(e.h)), e.w, e.h).then(function(u) { e._png = u; }));
    });
    return Promise.all(tareas);
  }
  var TRANS_XML = {cortar: '<p:cut/>', desvanecer: '<p:fade/>', empujar: '<p:push dir="{d}"/>', barrido: '<p:wipe dir="{d}"/>', dividir: '<p:split orient="vert" dir="out"/>',
    revelar: '<p:pull dir="{d}"/>', cubrir: '<p:cover dir="{d}"/>', zoom: '<p:zoom/>', girar: '<p:wheel spokes="1"/>'};
  function posproceso(buf, pres) {
    return NV.lib.jszip().then(function(JSZip) { return JSZip.loadAsync(buf); }).then(function(zip) {
      var tareas = pres.diapositivas.map(function(s, i) {
        var ruta = 'ppt/slides/slide' + (i + 1) + '.xml', f = zip.file(ruta); if (!f) return null;
        return f.async('string').then(function(xml) {
          var t = s.transicion || {}, av = s.avance || {};
          if (s.oculta) xml = xml.replace(/<p:sld /, '<p:sld show="0" ');
          if ((t.tipo && t.tipo !== 'ninguna') || av.seg != null) {
            var dir = {izq: 'l', der: 'r', arriba: 'u', abajo: 'd'}[t.dir || 'izq'] || 'l', dur = t.dur || 0.7;
            var spd = dur < 0.5 ? 'fast' : dur > 1 ? 'slow' : 'med';
            var at = ' spd="' + spd + '"' + (av.clic === false ? ' advClick="0"' : '') + (av.seg != null ? ' advTm="' + Math.round(av.seg * 1000) + '"' : '');
            var trx = '<p:transition' + at + '>' + (TRANS_XML[t.tipo] || '').replace('{d}', dir) + '</p:transition>';
            if (/<\/p:clrMapOvr>/.test(xml)) xml = xml.replace('</p:clrMapOvr>', '</p:clrMapOvr>' + trx);
            else xml = xml.replace(/<\/p:cSld>/, '</p:cSld>' + trx);
          }
          zip.file(ruta, xml);
        });
      });
      return Promise.all(tareas).then(function() { return zip.generateAsync({type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'}); });
    });
  }

  // ---------- Importar ----------
  var EMU = 12700;
  var NS = {p: 'http://schemas.openxmlformats.org/presentationml/2006/main', a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
            r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', c: 'http://schemas.openxmlformats.org/drawingml/2006/chart'};
  function hijos(n, ns, nombre) { var o = []; if (!n) return o; for (var c = n.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && c.localName === nombre && (!ns || c.namespaceURI === NS[ns])) o.push(c); return o; }
  function hijo(n, ns, nombre) { return hijos(n, ns, nombre)[0] || null; }
  function camino(n, pasos) { pasos.split('/').forEach(function(p) { if (n) { var q = p.split(':'); n = hijo(n, q[0], q[1]); } }); return n; }
  function todos(n, nombre) { return n ? Array.prototype.slice.call(n.getElementsByTagNameNS('*', nombre)) : []; }
  function parse(xml) { return new DOMParser().parseFromString(xml, 'application/xml'); }
  function dir(ruta) { return ruta.slice(0, ruta.lastIndexOf('/') + 1); }
  function resolver(base, rel) { if (rel.charAt(0) === '/') return rel.slice(1); var partes = (dir(base) + rel).split('/'), out = []; partes.forEach(function(p) { if (p === '..') out.pop(); else if (p !== '.') out.push(p); }); return out.join('/'); }
  X.importar = function(buffer, progreso) {
    var zip, cache = {}, medios = {};
    var leer = function(ruta) { if (!cache[ruta]) { var f = zip.file(ruta); cache[ruta] = f ? f.async('string').then(parse) : Promise.resolve(null); } return cache[ruta]; };
    var rels = function(ruta) {
      var r = dir(ruta) + '_rels/' + ruta.slice(ruta.lastIndexOf('/') + 1) + '.rels';
      return leer(r).then(function(doc) { var m = {}; if (doc) todos(doc, 'Relationship').forEach(function(x) { m[x.getAttribute('Id')] = {destino: x.getAttribute('TargetMode') === 'External' ? x.getAttribute('Target') : resolver(ruta, x.getAttribute('Target')), tipo: x.getAttribute('Type').split('/').pop(), externo: x.getAttribute('TargetMode') === 'External'}; }); return m; });
    };
    var medio = function(ruta) {
      if (!medios[ruta]) {
        var f = zip.file(ruta);
        medios[ruta] = f ? f.async('base64').then(function(b) {
          var ext = ruta.split('.').pop().toLowerCase(), mime = {png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', bmp: 'image/bmp', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff'}[ext];
          return mime ? 'data:' + mime + ';base64,' + b : null;  // EMF/WMF no se pueden mostrar en el navegador
        }) : Promise.resolve(null);
      }
      return medios[ruta];
    };
    return NV.lib.jszip().then(function(JSZip) { return JSZip.loadAsync(buffer); }).then(function(z) {
      zip = z;
      return Promise.all([leer('ppt/presentation.xml'), rels('ppt/presentation.xml')]);
    }).then(function(r) {
      var presXml = r[0], presRels = r[1];
      if (!presXml) throw new Error('El archivo no es una presentación de PowerPoint válida.');
      var sz = todos(presXml, 'sldSz')[0], w = Math.round(+sz.getAttribute('cx') / EMU), h = Math.round(+sz.getAttribute('cy') / EMU);
      var ids = todos(presXml, 'sldId').map(function(s) { return presRels[s.getAttributeNS(NS.r, 'id')].destino; });
      var maestrosR = todos(presXml, 'sldMasterId').map(function(s) { return presRels[s.getAttributeNS(NS.r, 'id')].destino; });
      var tam = {id: 'personalizado', n: 'Personalizado', w: w, h: h};
      Object.keys(P.TAMANOS).forEach(function(k) { var t = P.TAMANOS[k]; if (Math.abs(t.w / t.h - w / h) < 0.01) { tam.id = k; tam.n = t.n; } });
      var ctx = {zip: zip, leer: leer, rels: rels, medio: medio, tam: tam, w: w, h: h, pres: {recursos: {}}};
      // escalar a 960 de ancho (1 punto = 1 px en Nuvia) manteniendo la proporción
      var k = tam.id === 'personalizado' || w !== (P.TAMANOS[tam.id] || {}).w ? (P.TAMANOS[tam.id] ? P.TAMANOS[tam.id].w / w : 1) : 1;
      ctx.k = k; tam.w = Math.round(w * k); tam.h = Math.round(h * k);
      return cargarMaestro(ctx, maestrosR[0]).then(function(m) {
        ctx.maestro = m;
        var pres = {version: 1, tam: tam, tema: m.tema, temaId: 'importado', disenos: [], diapositivas: [], recursos: ctx.pres.recursos, pie: {numero: false, fecha: false, formatoFecha: '{dd}/{mm}/{aaaa}', texto: '', noEnTitulo: true}, idioma: 'es-CO'};
        ctx.pres = pres;
        // todos los diseños del patrón (para "Nueva diapositiva")
        return Promise.all(m.disenos.map(function(ruta) { return cargarDiseno(ctx, ruta); })).then(function(dis) {
          pres.disenos = dis.filter(Boolean);
          var i = 0;
          var sig = function() {
            if (i >= ids.length) return pres;
            if (progreso) progreso((i + 1) / ids.length, 'Diapositiva ' + (i + 1) + ' de ' + ids.length);
            return cargarDiapositiva(ctx, ids[i++]).then(function(s) { if (s) pres.diapositivas.push(s); return sig(); });
          };
          return sig();
        });
      });
    }).then(function(pres) {
      if (!pres.diapositivas.length) pres.diapositivas.push(P.diapositivaDesdeDiseno(pres, pres.disenos[0] ? pres.disenos[0].id : 'blanco'));
      // fechas escritas en el texto → se devuelven para que se elijan cuáles quedan como "Fecha de hoy"
      return pres;
    });
  };
  function cargarMaestro(ctx, ruta) {
    return Promise.all([ctx.leer(ruta), ctx.rels(ruta)]).then(function(r) {
      var doc = r[0], rl = r[1], temaR = Object.keys(rl).map(function(k) { return rl[k]; }).filter(function(x) { return x.tipo === 'theme'; })[0];
      return ctx.leer(temaR ? temaR.destino : '').then(function(tdoc) {
        var tema = leerTema(tdoc);
        var m = {ruta: ruta, doc: doc, rels: rl, tema: tema, disenos: todos(doc, 'sldLayoutId').map(function(s) { return rl[s.getAttributeNS(NS.r, 'id')].destino; }),
                 clrMap: atributos(todos(doc, 'clrMap')[0]), txStyles: camino(doc.documentElement, 'p:txStyles')};
        ctx.tema = tema; ctx.clrMap = m.clrMap;
        m.marcadores = marcadoresDe(doc);
        return fondoDe(ctx, doc, rl).then(function(f) { m.fondo = f; tema.fondo = f || {tipo: 'color', color: tema.c.c1}; return elementosDe(ctx, camino(doc.documentElement, 'p:cSld/p:spTree'), rl, {soloAdornos: true}); })
          .then(function(ad) { m.adornos = ad; return m; });
      });
    });
  }
  function atributos(n) { var o = {}; if (n) Array.prototype.forEach.call(n.attributes, function(a) { o[a.localName] = a.value; }); return o; }
  function leerTema(tdoc) {
    var t = {n: 'Plantilla', titulos: 'Calibri Light', cuerpo: 'Calibri', c: {o1: '#000000', c1: '#FFFFFF', o2: '#44546A', c2: '#E7E6E6', a: ['#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47']}, esquema: {}};
    if (!tdoc) return t;
    var cs = todos(tdoc, 'clrScheme')[0];
    if (cs) Array.prototype.forEach.call(cs.children, function(c) {
      var v = c.firstElementChild; if (!v) return;
      var col = '#' + (v.getAttribute('lastClr') || v.getAttribute('val') || '000000');
      t.esquema[c.localName] = col;
    });
    var e = t.esquema;
    t.c = {o1: e.dk1 || '#000000', c1: e.lt1 || '#FFFFFF', o2: e.dk2 || '#44546A', c2: e.lt2 || '#E7E6E6', a: [e.accent1, e.accent2, e.accent3, e.accent4, e.accent5, e.accent6].map(function(x, i) { return x || t.c.a[i]; })};
    var mj = todos(tdoc, 'majorFont')[0], mn = todos(tdoc, 'minorFont')[0];
    if (mj) { var l = hijo(mj, 'a', 'latin'); if (l && l.getAttribute('typeface')) t.titulos = l.getAttribute('typeface'); }
    if (mn) { var l2 = hijo(mn, 'a', 'latin'); if (l2 && l2.getAttribute('typeface')) t.cuerpo = l2.getAttribute('typeface'); }
    return t;
  }
  // Color DrawingML (srgbClr, schemeClr, sysClr, prstClr) con lumMod/lumOff/tint/shade
  function colorDe(ctx, n) {
    if (!n) return null;
    var c = n.firstElementChild || n; if (!c) return null;
    var base = null, nombre = c.localName;
    if (nombre === 'srgbClr') base = '#' + c.getAttribute('val');
    else if (nombre === 'sysClr') base = '#' + (c.getAttribute('lastClr') || c.getAttribute('val') === 'window' && 'FFFFFF' || '000000');
    else if (nombre === 'prstClr') base = {black: '#000000', white: '#FFFFFF', red: '#FF0000', blue: '#0000FF', green: '#008000', yellow: '#FFFF00', gray: '#808080'}[c.getAttribute('val')] || '#000000';
    else if (nombre === 'schemeClr') {
      var v = c.getAttribute('val'), map = ctx.clrMap || {}, e = ctx.tema.esquema;
      var real = {bg1: map.bg1 || 'lt1', tx1: map.tx1 || 'dk1', bg2: map.bg2 || 'lt2', tx2: map.tx2 || 'dk2'}[v] || v;
      if (real === 'phClr') real = ctx.phClr || 'accent1';
      base = e[real] || '#000000';
    } else return null;
    var rgb = [parseInt(base.slice(1, 3), 16), parseInt(base.slice(3, 5), 16), parseInt(base.slice(5, 7), 16)], alfa = 1;
    Array.prototype.forEach.call(c.children, function(m) {
      var val = +m.getAttribute('val') / 100000;
      if (m.localName === 'lumMod' || m.localName === 'lumOff') {
        var hsl = aHsl(rgb); if (m.localName === 'lumMod') hsl[2] *= val; else hsl[2] += val; hsl[2] = Math.max(0, Math.min(1, hsl[2])); rgb = deHsl(hsl);
      } else if (m.localName === 'tint') rgb = rgb.map(function(x) { return Math.round(x + (255 - x) * (1 - val)); });
      else if (m.localName === 'shade') rgb = rgb.map(function(x) { return Math.round(x * val); });
      else if (m.localName === 'alpha') alfa = val;
    });
    var hx = '#' + rgb.map(function(x) { return ('0' + Math.max(0, Math.min(255, x)).toString(16)).slice(-2); }).join('').toUpperCase();
    return alfa < 1 ? 'rgba(' + rgb.join(',') + ',' + alfa.toFixed(2) + ')' : hx;
  }
  function aHsl(c) { var r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), h = 0, s = 0, l = (mx + mn) / 2;
    if (mx !== mn) { var d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; } return [h, s, l]; }
  function deHsl(x) { var h = x[0], s = x[1], l = x[2]; if (!s) return [l, l, l].map(function(v) { return Math.round(v * 255); });
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q, f = function(t) { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map(function(v) { return Math.round(v * 255); }); }
  function rellenoDe(ctx, spPr, rl) {
    if (!spPr) return Promise.resolve(undefined);
    if (hijo(spPr, 'a', 'noFill')) return Promise.resolve('none');
    var s = hijo(spPr, 'a', 'solidFill'); if (s) return Promise.resolve(colorDe(ctx, s));
    var g = hijo(spPr, 'a', 'gradFill');
    if (g) { var gs = todos(g, 'gs'); if (gs.length) { var c1 = colorDe(ctx, gs[0]), c2 = colorDe(ctx, gs[gs.length - 1]), lin = todos(g, 'lin')[0], ang = lin ? (+lin.getAttribute('ang') / 60000 + 90) : 180; return Promise.resolve({degradado: true, desde: c1, hasta: c2, angulo: ang}); } }
    var bf = hijo(spPr, 'a', 'blipFill') || hijo(spPr, 'p', 'blipFill');
    if (bf) { var bl = hijo(bf, 'a', 'blip'), id = bl && bl.getAttributeNS(NS.r, 'embed'); if (id && rl[id]) return ctx.medio(rl[id].destino).then(function(u) { return u ? {imagen: u} : undefined; }); }
    return Promise.resolve(undefined);
  }
  function fondoDe(ctx, doc, rl) {
    var bg = camino(doc.documentElement, 'p:cSld/p:bg'); if (!bg) return Promise.resolve(null);
    var bgPr = hijo(bg, 'p', 'bgPr');
    if (bgPr) return rellenoDe(ctx, bgPr, rl).then(function(f) { return fondoObj(ctx, f); });
    var ref = hijo(bg, 'p', 'bgRef'); if (ref) { var c = colorDe(ctx, ref); return Promise.resolve(c ? {tipo: 'color', color: c} : null); }
    return Promise.resolve(null);
  }
  function fondoObj(ctx, f) {
    if (!f || f === 'none') return null;
    if (typeof f === 'string') return {tipo: 'color', color: f};
    if (f.degradado) return {tipo: 'degradado', desde: f.desde, hasta: f.hasta, angulo: f.angulo};
    if (f.imagen) return {tipo: 'imagen', src: P.recursoEn(ctx.pres || {recursos: {}}, f.imagen), ajuste: 'cover'};
    return null;
  }
  P.recursoEn = function(pres, url) {
    if (!pres.recursos) pres.recursos = {};
    for (var k in pres.recursos) if (pres.recursos[k] === url) return 'res:' + k;
    var id = Math.random().toString(36).slice(2, 10); pres.recursos[id] = url; return 'res:' + id;
  };
  // Marcadores (placeholders) de un patrón o diseño: tipo/idx → posición y estilo de texto
  function marcadoresDe(doc) {
    var out = [];
    todos(doc, 'sp').forEach(function(sp) {
      var ph = todos(sp, 'ph')[0]; if (!ph) return;
      var x = todos(sp, 'xfrm')[0], off = x && hijo(x, 'a', 'off'), ext = x && hijo(x, 'a', 'ext');
      out.push({tipo: ph.getAttribute('type') || 'body', idx: ph.getAttribute('idx') || '', xfrm: off && ext ? {x: +off.getAttribute('x'), y: +off.getAttribute('y'), w: +ext.getAttribute('cx'), h: +ext.getAttribute('cy')} : null, sp: sp});
    });
    return out;
  }
  function buscarMarcador(lista, tipo, idx) {
    tipo = tipo || 'body';
    var porIdx = idx ? lista.filter(function(m) { return m.idx === idx; })[0] : null;
    if (porIdx) return porIdx;
    var equiv = function(t) { return t === 'ctrTitle' ? 'title' : t === 'subTitle' || t === 'obj' ? 'body' : t; };
    return lista.filter(function(m) { return equiv(m.tipo) === equiv(tipo); })[0] || null;
  }
  var ROL = {title: 'titulo', ctrTitle: 'titulo', subTitle: 'subtitulo', body: 'cuerpo', obj: 'cuerpo', pic: 'imagen', tbl: 'cuerpo', chart: 'cuerpo', media: 'cuerpo', clipArt: 'imagen'};
  function cargarDiseno(ctx, ruta) {
    return Promise.all([ctx.leer(ruta), ctx.rels(ruta)]).then(function(r) {
      var doc = r[0], rl = r[1]; if (!doc) return null;
      var cSld = camino(doc.documentElement, 'p:cSld'), nombre = cSld && cSld.getAttribute('name') || 'Diseño';
      var tipo = doc.documentElement.getAttribute('type') || '';
      var lista = marcadoresDe(doc), d = {id: 'ly' + ruta.replace(/\D+/g, ''), nombre: traducirDiseno(nombre, tipo), ruta: ruta, importado: true, marcadores: [], adornos: []};
      lista.forEach(function(m) {
        if (/^(dt|ftr|sldNum)$/.test(m.tipo)) return;
        var mm = buscarMarcador(ctx.maestro.marcadores, m.tipo, m.idx), xf = m.xfrm || (mm && mm.xfrm);
        if (!xf) return;
        var est = estiloMarcador(ctx, m.sp, mm && mm.sp, m.tipo);
        d.marcadores.push(Object.assign({rol: ROL[m.tipo] || 'cuerpo', x: Math.round(xf.x / EMU * ctx.k), y: Math.round(xf.y / EMU * ctx.k), w: Math.round(xf.w / EMU * ctx.k), h: Math.round(xf.h / EMU * ctx.k), _tipo: m.tipo, _idx: m.idx}, est));
      });
      ctx.disenoActual = {lista: lista};
      return fondoDe(ctx, doc, rl).then(function(f) {
        d.fondo = f || ctx.maestro.fondo;
        var mostrarMaestro = doc.documentElement.getAttribute('showMasterSp') !== '0';
        return elementosDe(ctx, camino(doc.documentElement, 'p:cSld/p:spTree'), rl, {soloAdornos: true}).then(function(ad) {
          d.adornos = (mostrarMaestro ? ctx.maestro.adornos : []).concat(ad);
          d._mostrarMaestro = mostrarMaestro; d._lista = lista;
          return d;
        });
      });
    });
  }
  function traducirDiseno(n, tipo) {
    var t = {title: 'Diapositiva de título', obj: 'Título y objetos', secHead: 'Encabezado de sección', twoObj: 'Dos objetos', twoTxTwoObj: 'Comparación', titleOnly: 'Solo el título',
             blank: 'En blanco', objTx: 'Contenido con título', picTx: 'Imagen con título'}[tipo];
    return /^(Title|Section|Two|Comparison|Blank|Content|Picture)/.test(n) && t ? t : n;
  }
  // Estilo de texto de un marcador (tamaño, fuente, color, alineación, anclaje) siguiendo la herencia diseño → patrón → txStyles
  function estiloMarcador(ctx, sp, spMaestro, tipo) {
    var tit = tipo === 'title' || tipo === 'ctrTitle', estilos = ctx.maestro.txStyles, nivel1 = estilos ? camino(estilos, (tit ? 'p:titleStyle' : 'p:bodyStyle') + '/a:lvl1pPr') : null;
    var buscar = function(fn) { var v = null; [sp, spMaestro].forEach(function(s) { if (v === null && s) { var lst = todos(s, 'lvl1pPr')[0]; if (lst) v = fn(lst); } }); if (v === null && nivel1) v = fn(nivel1); return v; };
    var defRPr = function(l) { return hijo(l, 'a', 'defRPr'); };
    var sz = buscar(function(l) { var d = defRPr(l); return d && d.getAttribute('sz') ? +d.getAttribute('sz') / 100 : null; });
    var bold = buscar(function(l) { var d = defRPr(l); return d && d.getAttribute('b') ? d.getAttribute('b') === '1' : null; });
    var col = buscar(function(l) { var d = defRPr(l), f = d && hijo(d, 'a', 'solidFill'); return f ? colorDe(ctx, f) : null; });
    var fuente = buscar(function(l) { var d = defRPr(l), lt = d && hijo(d, 'a', 'latin'); return lt ? lt.getAttribute('typeface') : null; });
    var algn = buscar(function(l) { return l.getAttribute('algn') || null; });
    var bu = buscar(function(l) { return hijo(l, 'a', 'buNone') ? false : (hijo(l, 'a', 'buChar') || hijo(l, 'a', 'buAutoNum')) ? true : null; });
    var anchor = null; [sp, spMaestro].forEach(function(s) { if (!anchor && s) { var bp = todos(s, 'bodyPr')[0]; if (bp && bp.getAttribute('anchor')) anchor = bp.getAttribute('anchor'); } });
    var resF = function(f) { if (!f) return null; if (f === '+mj-lt') return ctx.tema.titulos; if (f === '+mn-lt') return ctx.tema.cuerpo; return f; };
    return {fs: Math.round((sz || (tit ? 44 : 28)) * ctx.k), negrita: !!bold, color: col, fuente: resF(fuente) || (tit ? ctx.tema.titulos : ctx.tema.cuerpo),
            align: {l: 'left', ctr: 'center', r: 'right', just: 'justify'}[algn] || 'left', valign: {t: 'top', ctr: 'middle', b: 'bottom'}[anchor] || (tit ? 'middle' : 'top'), vinetas: bu !== false && !tit && tipo !== 'subTitle'};
  }
  function cargarDiapositiva(ctx, ruta) {
    return Promise.all([ctx.leer(ruta), ctx.rels(ruta)]).then(function(r) {
      var doc = r[0], rl = r[1]; if (!doc) return null;
      var lyR = Object.keys(rl).map(function(k) { return rl[k]; }).filter(function(x) { return x.tipo === 'slideLayout'; })[0];
      var diseno = lyR ? ctx.pres.disenos.filter(function(d) { return d.ruta === lyR.destino; })[0] : null;
      diseno = diseno || ctx.pres.disenos[0];
      var s = {id: P.uid('d'), diseno: diseno ? diseno.id : 'blanco', fondo: null, oculta: doc.documentElement.getAttribute('show') === '0', notas: '', transicion: leerTransicion(doc), avance: leerAvance(doc), elementos: []};
      ctx.disenoActual = diseno;
      return fondoDe(ctx, doc, rl).then(function(f) {
        if (f) s.fondo = f;
        if (doc.documentElement.getAttribute('showMasterSp') === '0' && s.fondo) s.fondo.ocultarAdornos = true;
        return elementosDe(ctx, camino(doc.documentElement, 'p:cSld/p:spTree'), rl, {diseno: diseno});
      }).then(function(els) {
        s.elementos = els;
        var nR = Object.keys(rl).map(function(k) { return rl[k]; }).filter(function(x) { return x.tipo === 'notesSlide'; })[0];
        if (!nR) return s;
        return ctx.leer(nR.destino).then(function(nd) {
          if (nd) { var cuerpo = todos(nd, 'sp').filter(function(sp) { var ph = todos(sp, 'ph')[0]; return ph && ph.getAttribute('type') === 'body'; })[0];
            if (cuerpo) s.notas = todos(cuerpo, 'p').map(function(p) { return '<p>' + NV.esc(todos(p, 't').map(function(t) { return t.textContent; }).join('')) + '</p>'; }).join(''); }
          return s;
        });
      });
    });
  }
  function leerTransicion(doc) {
    var t = todos(doc, 'transition')[0]; if (!t) return {tipo: 'ninguna', dur: 0.7};
    var e = t.firstElementChild, n = e ? e.localName : '', dirA = e ? e.getAttribute('dir') : '';
    var tipo = {fade: 'desvanecer', push: 'empujar', wipe: 'barrido', split: 'dividir', pull: 'revelar', cover: 'cubrir', zoom: 'zoom', wheel: 'girar', cut: 'cortar', dissolve: 'desvanecer', randomBar: 'barrido', blinds: 'barrido', checker: 'desvanecer', circle: 'zoom', diamond: 'zoom', plus: 'zoom', wedge: 'girar', strips: 'barrido', newsflash: 'girar'}[n] || (n ? 'desvanecer' : 'ninguna');
    var spd = t.getAttribute('spd'), dur = t.getAttributeNS('http://schemas.microsoft.com/office/powerpoint/2010/main', 'dur');
    return {tipo: tipo, dur: dur ? +dur / 1000 : spd === 'fast' ? 0.5 : spd === 'slow' ? 1 : 0.7, dir: {l: 'izq', r: 'der', u: 'arriba', d: 'abajo'}[dirA] || 'izq'};
  }
  function leerAvance(doc) { var t = todos(doc, 'transition')[0]; if (!t) return {clic: true, seg: null}; var tm = t.getAttribute('advTm'); return {clic: t.getAttribute('advClick') !== '0', seg: tm ? +tm / 1000 : null}; }

  // Elementos de un árbol de formas (sp, pic, graphicFrame, grpSp, cxnSp)
  function elementosDe(ctx, arbol, rl, op, grupo) {
    if (!arbol) return Promise.resolve([]);
    var tareas = [];
    Array.prototype.forEach.call(arbol.children, function(n) {
      var ln = n.localName;
      if (ln === 'sp') tareas.push(forma(ctx, n, rl, op, grupo));
      else if (ln === 'pic') tareas.push(imagen(ctx, n, rl, op, grupo));
      else if (ln === 'cxnSp') tareas.push(conector(ctx, n, op, grupo));
      else if (ln === 'graphicFrame') tareas.push(marcoGrafico(ctx, n, rl, op, grupo));
      else if (ln === 'grpSp') {
        var gp = camino(n, 'p:grpSpPr/a:xfrm'); var g = transGrupo(gp, grupo);
        tareas.push(elementosDe(ctx, n, rl, op, g));
      }
      else if (ln === 'AlternateContent') { var ch = hijo(n, null, 'Choice') || hijo(n, null, 'Fallback'); if (ch) tareas.push(elementosDe(ctx, ch, rl, op, grupo)); }
    });
    return Promise.all(tareas).then(function(r) { var out = []; r.forEach(function(x) { if (Array.isArray(x)) Array.prototype.push.apply(out, x); else if (x) out.push(x); }); return out; });
  }
  function transGrupo(xfrm, padre) {
    if (!xfrm) return padre || null;
    var off = hijo(xfrm, 'a', 'off'), ext = hijo(xfrm, 'a', 'ext'), cOff = hijo(xfrm, 'a', 'chOff'), cExt = hijo(xfrm, 'a', 'chExt');
    if (!off || !ext || !cOff || !cExt) return padre || null;
    var g = {ox: +off.getAttribute('x'), oy: +off.getAttribute('y'), sx: (+ext.getAttribute('cx') || 1) / (+cExt.getAttribute('cx') || 1), sy: (+ext.getAttribute('cy') || 1) / (+cExt.getAttribute('cy') || 1), cx: +cOff.getAttribute('x'), cy: +cOff.getAttribute('y')};
    if (padre) g.padre = padre;
    return g;
  }
  function aplicarGrupo(g, x, y, w, h) {
    while (g) { x = g.ox + (x - g.cx) * g.sx; y = g.oy + (y - g.cy) * g.sy; w *= g.sx; h *= g.sy; g = g.padre; }
    return {x: x, y: y, w: w, h: h};
  }
  function posicion(ctx, n, ph, grupo) {
    var xfrm = todos(n, 'xfrm')[0], off = xfrm && hijo(xfrm, 'a', 'off'), ext = xfrm && hijo(xfrm, 'a', 'ext'), rot = 0, flipH = false, flipV = false, b;
    if (off && ext) { b = {x: +off.getAttribute('x'), y: +off.getAttribute('y'), w: +ext.getAttribute('cx'), h: +ext.getAttribute('cy')}; rot = +(xfrm.getAttribute('rot') || 0) / 60000; flipH = xfrm.getAttribute('flipH') === '1'; flipV = xfrm.getAttribute('flipV') === '1'; }
    else if (ph) {  // marcador sin posición propia: la del diseño o del patrón
      var listaD = ctx.disenoActual && ctx.disenoActual._lista || [], m = buscarMarcador(listaD, ph.getAttribute('type'), ph.getAttribute('idx')) || buscarMarcador(ctx.maestro.marcadores, ph.getAttribute('type'), ph.getAttribute('idx'));
      if (m && !m.xfrm) m = buscarMarcador(ctx.maestro.marcadores, ph.getAttribute('type'), ph.getAttribute('idx'));
      if (m && m.xfrm) b = Object.assign({}, m.xfrm);
    }
    if (!b) return null;
    if (grupo) b = aplicarGrupo(grupo, b.x, b.y, b.w, b.h);
    var k = ctx.k;
    return {x: Math.round(b.x / EMU * k), y: Math.round(b.y / EMU * k), w: Math.round(b.w / EMU * k), h: Math.round(b.h / EMU * k), rot: Math.round(rot), flipH: flipH, flipV: flipV};
  }
  var GEOM = {rect: 'rect', roundRect: 'redondeado', snip1Rect: 'rect', ellipse: 'elipse', triangle: 'triangulo', rtTriangle: 'triangulo', diamond: 'rombo', pentagon: 'pentagono', homePlate: 'chevron',
    hexagon: 'hexagono', star5: 'estrella', star4: 'estrella', star6: 'estrella', rightArrow: 'flechaDer', leftArrow: 'flechaIzq', upArrow: 'flechaArr', downArrow: 'flechaAba',
    wedgeRectCallout: 'llamada', wedgeRoundRectCallout: 'llamada', cloud: 'nube', cloudCallout: 'nube', heart: 'corazon', lightningBolt: 'rayo', plus: 'cruz', frame: 'marco', can: 'cilindro',
    chevron: 'chevron', ribbon2: 'pergamino', ribbon: 'pergamino', circularArrow: 'circuloFlecha', flowChartProcess: 'rect', flowChartAlternateProcess: 'redondeado', flowChartDecision: 'rombo',
    flowChartConnector: 'elipse', parallelogram: 'rect', trapezoid: 'rect', octagon: 'hexagono', donut: 'elipse', round2SameRect: 'redondeado', round1Rect: 'redondeado'};
  function forma(ctx, sp, rl, op, grupo) {
    var nv = camino(sp, 'p:nvSpPr/p:nvPr'), ph = nv && hijo(nv, 'p', 'ph');
    if (op.soloAdornos && ph) return Promise.resolve(null);  // en patrón/diseño los marcadores no son adornos
    if (ph && /^(dt|ftr|sldNum)$/.test(ph.getAttribute('type') || '') && !todos(sp, 't').some(function(t) { return t.textContent.trim(); })) return Promise.resolve(null);
    var pos = posicion(ctx, sp, ph, grupo); if (!pos) return Promise.resolve(null);
    var spPr = hijo(sp, 'p', 'spPr'), geom = spPr && hijo(spPr, 'a', 'prstGeom'), prst = geom ? geom.getAttribute('prst') : 'rect';
    var estiloRef = hijo(sp, 'p', 'style'), fillRef = estiloRef && hijo(estiloRef, 'a', 'fillRef'), lnRef = estiloRef && hijo(estiloRef, 'a', 'lnRef'), fontRef = estiloRef && hijo(estiloRef, 'a', 'fontRef');
    return rellenoDe(ctx, spPr, rl).then(function(rel) {
      var ln = spPr && hijo(spPr, 'a', 'ln'), borde, grosor;
      if (ln) { if (hijo(ln, 'a', 'noFill')) borde = 'none'; else { var lf = hijo(ln, 'a', 'solidFill'); if (lf) borde = colorDe(ctx, lf); } if (ln.getAttribute('w')) grosor = +ln.getAttribute('w') / EMU; }
      if (rel === undefined && fillRef && +fillRef.getAttribute('idx') > 0) rel = colorDe(ctx, fillRef);
      if (borde === undefined && lnRef && +lnRef.getAttribute('idx') > 0) borde = colorDe(ctx, lnRef);
      var txBody = hijo(sp, 'p', 'txBody'), texto = txBody && todos(txBody, 't').some(function(t) { return t.textContent.trim(); });
      var esTexto = !geom || prst === 'rect' && (!rel || rel === 'none') && (!borde || borde === 'none');
      var mm = ph ? buscarMarcador(ctx.maestro.marcadores, ph.getAttribute('type'), ph.getAttribute('idx')) : null;
      var lyM = ph && ctx.disenoActual && ctx.disenoActual._lista ? buscarMarcador(ctx.disenoActual._lista, ph.getAttribute('type'), ph.getAttribute('idx')) : null;
      var base = ph ? estiloMarcador(ctx, lyM && lyM.sp, mm && mm.sp, ph.getAttribute('type') || 'body') : {fs: Math.round(18 * ctx.k), fuente: ctx.tema.cuerpo, align: 'left', valign: esTexto ? 'top' : 'middle', color: fontRef ? colorDe(ctx, fontRef) : null};
      var bp = txBody && hijo(txBody, 'a', 'bodyPr');
      if (bp && bp.getAttribute('anchor')) base.valign = {t: 'top', ctr: 'middle', b: 'bottom'}[bp.getAttribute('anchor')] || base.valign;
      var e = {id: P.uid(), tipo: esTexto ? 'texto' : 'forma', forma: GEOM[prst] || 'rect', x: pos.x, y: pos.y, w: pos.w, h: pos.h, rot: pos.rot, html: '',
               estilo: {fs: base.fs, fuente: base.fuente, align: base.align, valign: base.valign, color: base.color, negrita: base.negrita, vinetas: base.vinetas}};
      if (ph) e.marcador = ROL[ph.getAttribute('type') || 'body'] || 'cuerpo';
      if (rel && rel !== 'none') { if (typeof rel === 'string') e.estilo.relleno = rel; else if (rel.degradado) e.estilo.relleno = rel.desde; else if (rel.imagen) { e.tipo = 'imagen'; e.src = P.recursoEn(ctx.pres || ctx, rel.imagen); e.ajuste = 'cover'; } }
      if (borde && borde !== 'none') { e.estilo.borde = borde; e.estilo.grosor = Math.max(0.5, Math.round((grosor || 0.75) * ctx.k * 10) / 10); }
      if (bp) { var ins = ['lIns', 'tIns'].map(function(a) { return bp.getAttribute(a); }); if (ins[0] != null) e.estilo.padH = Math.round(+ins[0] / EMU * ctx.k); if (ins[1] != null) e.estilo.pad = Math.round(+ins[1] / EMU * ctx.k); if (bp.getAttribute('numCol') > 1) e.estilo.columnas = +bp.getAttribute('numCol'); }
      if (bp && hijo(bp, 'a', 'noAutofit')) e.estilo.autoajuste = false;
      if (txBody) e.html = textoHtml(ctx, txBody, e.estilo, ph);
      if (op.soloAdornos && e.tipo === 'texto' && !texto && (!e.estilo.relleno) && !e.estilo.borde) return null;
      if (!ph && e.tipo === 'texto' && !texto && !e.estilo.relleno && !e.estilo.borde) return null;
      var hl = todos(sp, 'hlinkClick')[0]; if (hl) { var hid = hl.getAttributeNS(NS.r, 'id'); if (hid && rl[hid] && rl[hid].externo) e.vinculo = rl[hid].destino; }
      if (op.soloAdornos) e.bloqueado = true;
      return e;
    });
  }
  // Párrafos y fragmentos de texto → HTML (viñetas por nivel, formato por fragmento, campos de fecha y número)
  function textoHtml(ctx, txBody, est, ph) {
    var parrafos = hijos(txBody, 'a', 'p'), html = [], listaAbierta = null, nivelLista = 0;
    var cerrar = function() { while (nivelLista > 0) { html.push('</' + listaAbierta + '>'); nivelLista--; } listaAbierta = null; };
    parrafos.forEach(function(p) {
      var pPr = hijo(p, 'a', 'pPr'), lvl = pPr && pPr.getAttribute('lvl') ? +pPr.getAttribute('lvl') : 0;
      var algn = pPr && pPr.getAttribute('algn'), runs = [];
      Array.prototype.forEach.call(p.children, function(r) {
        if (r.localName === 'br') { runs.push('<br>'); return; }
        if (r.localName !== 'r' && r.localName !== 'fld') return;
        var t = hijo(r, 'a', 't'), txt = t ? t.textContent : '';
        var rPr = hijo(r, 'a', 'rPr'), css = [], abre = '', cierra = '';
        if (rPr) {
          if (rPr.getAttribute('sz')) { var sz = Math.round(+rPr.getAttribute('sz') / 100 * ctx.k); if (sz !== est.fs) css.push('font-size:' + sz + 'px'); }
          if (rPr.getAttribute('b') === '1') { abre += '<strong>'; cierra = '</strong>' + cierra; }
          if (rPr.getAttribute('i') === '1') { abre += '<em>'; cierra = '</em>' + cierra; }
          if (rPr.getAttribute('u') && rPr.getAttribute('u') !== 'none') { abre += '<u>'; cierra = '</u>' + cierra; }
          if (rPr.getAttribute('strike') && rPr.getAttribute('strike') !== 'noStrike') css.push('text-decoration:line-through');
          if (rPr.getAttribute('baseline') && +rPr.getAttribute('baseline') > 0) { abre += '<sup>'; cierra = '</sup>' + cierra; }
          if (rPr.getAttribute('baseline') && +rPr.getAttribute('baseline') < 0) { abre += '<sub>'; cierra = '</sub>' + cierra; }
          var f = hijo(rPr, 'a', 'solidFill'); if (f) { var c = colorDe(ctx, f); if (c) css.push('color:' + c); }
          var lt = hijo(rPr, 'a', 'latin'); if (lt && lt.getAttribute('typeface')) { var tf = lt.getAttribute('typeface'); tf = tf === '+mj-lt' ? ctx.tema.titulos : tf === '+mn-lt' ? ctx.tema.cuerpo : tf; if (tf !== est.fuente) css.push('font-family:' + NV.cssFuente(tf).replace(/"/g, "'")); }
          var hl = hijo(rPr, 'a', 'highlight'); if (hl) { var hc = colorDe(ctx, hl); if (hc) css.push('background-color:' + hc); }
        }
        var contenido = NV.esc(txt);
        if (r.localName === 'fld') {
          var ft = r.getAttribute('type') || '';
          if (/^datetime/.test(ft)) contenido = NV.fechas.span({datetime1: '{dd}/{mm}/{aaaa}', datetime2: '{dia:Cap}, {d} de {mes} de {aaaa}', datetime3: '{d} de {mes} de {aaaa}', datetime4: '{mes:Cap} {d} de {aaaa}'}[ft] || '{dd}/{mm}/{aaaa}');
          else if (ft === 'slidenum') contenido = '<span data-campo="numdiap">' + NV.esc(txt) + '</span>';
        }
        runs.push(abre + (css.length ? '<span style="' + css.join(';') + '">' + contenido + '</span>' : contenido) + cierra);
      });
      var interior = runs.join('') || '<br>';
      var bu = pPr && (hijo(pPr, 'a', 'buChar') ? 'ul' : hijo(pPr, 'a', 'buAutoNum') ? 'ol' : hijo(pPr, 'a', 'buNone') ? 'no' : null);
      var conVineta = bu === 'ul' || bu === 'ol' || (bu === null && est.vinetas && ph);
      var estP = algn ? ' style="text-align:' + ({l: 'left', ctr: 'center', r: 'right', just: 'justify'}[algn] || 'left') + '"' : '';
      if (conVineta && interior !== '<br>') {
        var tag = bu === 'ol' ? 'ol' : 'ul';
        if (listaAbierta !== tag) { cerrar(); listaAbierta = tag; }
        while (nivelLista < lvl + 1) { html.push('<' + tag + '>'); nivelLista++; }
        while (nivelLista > lvl + 1) { html.push('</' + tag + '>'); nivelLista--; }
        html.push('<li' + estP + '>' + interior + '</li>');
      } else { cerrar(); html.push('<p' + estP + '>' + interior + '</p>'); }
    });
    cerrar();
    var h = html.join('');
    return P.textoVacio(h) ? '' : h;
  }
  function imagen(ctx, pic, rl, op, grupo) {
    var nv = camino(pic, 'p:nvPicPr/p:nvPr'), ph = nv && hijo(nv, 'p', 'ph');
    var pos = posicion(ctx, pic, ph, grupo); if (!pos) return Promise.resolve(null);
    var bf = hijo(pic, 'p', 'blipFill'), bl = bf && hijo(bf, 'a', 'blip'), id = bl && bl.getAttributeNS(NS.r, 'embed');
    if (!id || !rl[id]) return Promise.resolve(null);
    var cr = bf && hijo(bf, 'a', 'srcRect');
    return ctx.medio(rl[id].destino).then(function(u) {
      if (!u) return null;
      var recorte = cr ? {l: +(cr.getAttribute('l') || 0) / 100000, t: +(cr.getAttribute('t') || 0) / 100000, r: +(cr.getAttribute('r') || 0) / 100000, b: +(cr.getAttribute('b') || 0) / 100000} : null;
      var listo = recorte && (recorte.l || recorte.t || recorte.r || recorte.b) ? recortar(u, recorte) : Promise.resolve(u);
      return listo.then(function(u2) {
        var desc = camino(pic, 'p:nvPicPr/p:cNvPr');
        var e = {id: P.uid(), tipo: 'imagen', src: P.recursoEn(ctx.pres || ctx, u2), x: pos.x, y: pos.y, w: pos.w, h: pos.h, rot: pos.rot, estilo: {}, alt: desc ? desc.getAttribute('descr') || '' : '', ajuste: 'fill'};
        if (ph && !op.soloAdornos) e.marcador = 'imagen';
        if (op.soloAdornos) e.bloqueado = true;
        return e;
      });
    });
  }
  function recortar(url, r) {
    return new Promise(function(ok) {
      var img = new Image(); img.onload = function() {
        try { var W = img.naturalWidth, H = img.naturalHeight, sx = W * r.l, sy = H * r.t, sw = W * (1 - r.l - r.r), sh = H * (1 - r.t - r.b);
          var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(sw)); c.height = Math.max(1, Math.round(sh)); c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
          ok(c.toDataURL(/png|gif|svg/.test(url.slice(0, 30)) ? 'image/png' : 'image/jpeg', 0.92)); } catch (e) { ok(url); } };
      img.onerror = function() { ok(url); }; img.src = url;
    });
  }
  function conector(ctx, cx, op, grupo) {
    var pos = posicion(ctx, cx, null, grupo); if (!pos) return Promise.resolve(null);
    var ln = todos(cx, 'ln')[0], col = ln && hijo(ln, 'a', 'solidFill') ? colorDe(ctx, hijo(ln, 'a', 'solidFill')) : null, ref = todos(cx, 'lnRef')[0];
    if (!col && ref) col = colorDe(ctx, ref);
    var e = {id: P.uid(), tipo: 'linea', x: pos.x, y: pos.y, w: pos.w, h: pos.h, rot: pos.rot, invertida: pos.flipV !== pos.flipH, estilo: {borde: col || '#000000', grosor: ln && ln.getAttribute('w') ? Math.max(0.75, +ln.getAttribute('w') / EMU) : 1.5, flecha: !!(ln && hijo(ln, 'a', 'tailEnd') && hijo(ln, 'a', 'tailEnd').getAttribute('type') !== 'none'), guiones: !!(ln && hijo(ln, 'a', 'prstDash') && hijo(ln, 'a', 'prstDash').getAttribute('val') !== 'solid')}};
    if (op.soloAdornos) e.bloqueado = true;
    return Promise.resolve(e);
  }
  function marcoGrafico(ctx, gf, rl, op, grupo) {
    var pos = posicion(ctx, gf, null, grupo); if (!pos) return Promise.resolve(null);
    var tbl = todos(gf, 'tbl')[0];
    if (tbl) {
      var anchos = todos(tbl, 'gridCol').map(function(g) { return +g.getAttribute('w') / EMU; });
      var filas = hijos(tbl, 'a', 'tr').map(function(tr) {
        return hijos(tr, 'a', 'tc').map(function(tc) {
          var tb = hijo(tc, 'a', 'txBody'), tcPr = hijo(tc, 'a', 'tcPr'), sf = tcPr && hijo(tcPr, 'a', 'solidFill');
          var c = {html: tb ? textoHtml(ctx, tb, {fs: Math.round(16 * ctx.k)}, null) : ''};
          if (sf) c.fondo = colorDe(ctx, sf);
          if (tc.getAttribute('gridSpan')) c.cs = +tc.getAttribute('gridSpan'); if (tc.getAttribute('rowSpan')) c.rs = +tc.getAttribute('rowSpan');
          if (tc.getAttribute('hMerge') === '1' || tc.getAttribute('vMerge') === '1') c.oculta = true;
          var rp = todos(tc, 'rPr')[0], f = rp && hijo(rp, 'a', 'solidFill'); if (f) c.color = colorDe(ctx, f);
          return c;
        });
      });
      var tp = todos(tbl, 'tblPr')[0];
      var e = {id: P.uid(), tipo: 'tabla', x: pos.x, y: pos.y, w: pos.w, h: pos.h, rot: 0, estilo: {fs: Math.round(16 * ctx.k)},
               tabla: {filas: filas, anchos: anchos, color: 'a1', encabezado: !tp || tp.getAttribute('firstRow') === '1', bandas: !tp || tp.getAttribute('bandRow') === '1'}};
      if (filas.some(function(f) { return f.some(function(c) { return c.fondo; }); })) { e.tabla.encabezado = false; e.tabla.bandas = false; e.tabla.borde = '#BFBFBF'; filas.forEach(function(f) { f.forEach(function(c) { if (!c.fondo) c.fondo = '#FFFFFF'; }); }); }
      return Promise.resolve(e);
    }
    var ch = todos(gf, 'chart')[0], cid = ch && ch.getAttributeNS(NS.r, 'id');
    if (cid && rl[cid]) return ctx.leer(rl[cid].destino).then(function(cd) {
      if (!cd) return null;
      var tipoN = ['barChart', 'bar3DChart', 'lineChart', 'line3DChart', 'pieChart', 'pie3DChart', 'doughnutChart', 'areaChart'].filter(function(t) { return todos(cd, t).length; })[0] || 'barChart';
      var bd = todos(cd, 'barDir')[0];
      var tipo = /pie|doughnut/.test(tipoN) ? 'circular' : /line|area/.test(tipoN) ? 'lineas' : bd && bd.getAttribute('val') === 'bar' ? 'barras' : 'columnas';
      var series = todos(cd, 'ser').map(function(s, i) {
        var nombre = todos(hijo(s, 'c', 'tx'), 'v')[0], vals = todos(hijo(s, 'c', 'val'), 'pt').map(function(p) { return +todos(p, 'v')[0].textContent || 0; });
        return {nombre: nombre ? nombre.textContent : 'Serie ' + (i + 1), valores: vals};
      });
      var primera = todos(cd, 'ser')[0], cats = primera ? todos(hijo(primera, 'c', 'cat'), 'pt').map(function(p) { return todos(p, 'v')[0].textContent; }) : [];
      var tit = todos(todos(cd, 'title')[0], 't').map(function(t) { return t.textContent; }).join('');
      if (!series.length) return null;
      return {id: P.uid(), tipo: 'grafico', x: pos.x, y: pos.y, w: pos.w, h: pos.h, rot: 0, estilo: {}, grafico: {tipo: tipo, titulo: tit, categorias: cats.length ? cats : series[0].valores.map(function(v, i) { return 'Categoría ' + (i + 1); }), series: series}};
    });
    return Promise.resolve(null);
  }

  // ---------- Fechas en la presentación (para plantillas) ----------
  X.buscarFechas = function(pres) {
    var res = [];
    pres.diapositivas.forEach(function(s, si) { s.elementos.forEach(function(e) {
      if (!e.html) return; var d = document.createElement('div'); d.innerHTML = e.html;
      NV.fechas.buscar(d).forEach(function(f) { res.push({e: e, raiz: d, f: f, texto: f.texto, contexto: 'Diapositiva ' + (si + 1) + ': ' + NV.fechas.contexto(f)}); });
    }); });
    return res;
  };
  X.convertirFechas = function(lista, elegidas) {
    var porRaiz = new Map();
    lista.forEach(function(x, i) { if (elegidas.indexOf(i) < 0) return; if (!porRaiz.has(x.raiz)) porRaiz.set(x.raiz, {e: x.e, fs: []}); porRaiz.get(x.raiz).fs.push(x.f); });
    porRaiz.forEach(function(v, raiz) { NV.fechas.convertir(raiz, v.fs); v.e.html = raiz.innerHTML; });
  };
})();
