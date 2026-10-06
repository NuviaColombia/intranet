/* Nuvia Office ⇄ PDF.
   - Documento → PDF con texto real (seleccionable), páginas, encabezado/pie con números, marca de agua y tabla de contenido.
   - Imágenes (PNG/JPG/…) → PDF, una por página.
   - PDF → documento editable (texto con tamaños, negritas y párrafos; imágenes en su lugar; páginas escaneadas como imagen). */
(function() {
  'use strict';
  var NV = window.NV, PDF = NV.pdf = {};
  var G = 'https://fonts.gstatic.com/s/';
  // Fuentes con la misma métrica que las de Office (Carlito = Calibri, Caladea = Cambria, Arimo = Arial, Tinos = Times, Cousine = Courier).
  var FUENTES_PDF = {
    Carlito: ['carlito/v4/3Jn9SDPw3m-pk039PDA.ttf', 'carlito/v4/3Jn4SDPw3m-pk039BIykaX0.ttf', 'carlito/v4/3Jn_SDPw3m-pk039DDKBSQ.ttf', 'carlito/v4/3Jn6SDPw3m-pk039DDK59XglVg.ttf'],
    Caladea: ['caladea/v10/kJEzBugZ7AAjhybUjR8.ttf', 'caladea/v10/kJE2BugZ7AAjhybUtaNY39o.ttf', 'caladea/v10/kJExBugZ7AAjhybUvR19_w.ttf', 'caladea/v10/kJE0BugZ7AAjhybUvR1FQ98SrA.ttf'],
    Arimo: ['arimo/v36/P5sfzZCDf9_T_3cV7NCUECyoxNk37cxsBw.ttf', 'arimo/v36/P5sfzZCDf9_T_3cV7NCUECyoxNk3CstsBw.ttf', 'arimo/v36/P5sdzZCDf9_T_10c3i9MeUcyat4iJY-ERBrE.ttf', 'arimo/v36/P5sdzZCDf9_T_10c3i9MeUcyat4iJY9jQxrE.ttf'],
    Tinos: ['tinos/v26/buE4poGnedXvwgX8.ttf', 'tinos/v26/buE1poGnedXvwj1AW0Fp.ttf', 'tinos/v26/buE2poGnedXvwjX-fmE.ttf', 'tinos/v26/buEzpoGnedXvwjX-Rt1s0Co.ttf'],
    Cousine: ['cousine/v31/d6lIkaiiRdih4SpPzSM.ttf', 'cousine/v31/d6lNkaiiRdih4SpP9Z8K6T4.ttf', 'cousine/v31/d6lKkaiiRdih4SpP_SEvyQ.ttf', 'cousine/v31/d6lPkaiiRdih4SpP_SEXdTvM1w.ttf'],
    Gelasio: ['gelasio/v14/cIfiMaFfvUQxTTqS3iKJkLGbI41wQL8Ilycs.ttf', 'gelasio/v14/cIfiMaFfvUQxTTqS3iKJkLGbI41wQL_vkCcs.ttf', 'gelasio/v14/cIfsMaFfvUQxTTqS9Cu7b2nySBfeR6rA1M9v8zQ.ttf', 'gelasio/v14/cIfsMaFfvUQxTTqS9Cu7b2nySBfeR6rA1Cho8zQ.ttf'],
    Roboto: ['roboto/v51/KFOMCnqEu92Fr1ME7kSn66aGLdTylUAMQXC89YmC2DPNWubEbWmT.ttf', 'roboto/v51/KFOMCnqEu92Fr1ME7kSn66aGLdTylUAMQXC89YmC2DPNWuYjammT.ttf',
             'roboto/v51/KFOKCnqEu92Fr1Mu53ZEC9_Vu3r1gIhOszmOClHrs6ljXfMMLoHQiA8.ttf', 'roboto/v51/KFOKCnqEu92Fr1Mu53ZEC9_Vu3r1gIhOszmOClHrs6ljXfMMLmbXiA8.ttf'],
    OpenSans: ['opensans/v44/memSYaGs126MiZpBA-UvWbX2vVnXBbObj2OVZyOOSr4dVJWUgsjZ0C4n.ttf', 'opensans/v44/memSYaGs126MiZpBA-UvWbX2vVnXBbObj2OVZyOOSr4dVJWUgsg-1y4n.ttf',
               'opensans/v44/memQYaGs126MiZpBA-UFUIcVXSCEkx2cmqvXlWq8tWZ0Pw86hd0Rk8ZkaVc.ttf', 'opensans/v44/memQYaGs126MiZpBA-UFUIcVXSCEkx2cmqvXlWq8tWZ0Pw86hd0RkyFjaVc.ttf'],
    Lato: ['lato/v25/S6uyw4BMUTPHvxk.ttf', 'lato/v25/S6u9w4BMUTPHh6UVew8.ttf', 'lato/v25/S6u8w4BMUTPHjxswWw.ttf', 'lato/v25/S6u_w4BMUTPHjxsI5wqPHA.ttf'],
    Montserrat: ['montserrat/v31/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCtr6Ew-.ttf', 'montserrat/v31/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCuM70w-.ttf',
                 'montserrat/v31/JTUFjIg1_i6t8kCHKm459Wx7xQYXK0vOoz6jq6R9aX8.ttf', 'montserrat/v31/JTUFjIg1_i6t8kCHKm459Wx7xQYXK0vOoz6jq0N6aX8.ttf']
  };
  function fuentePdf(n) {
    if (!n) return null;
    if (FUENTES_PDF[n]) return n;
    var f = NV.fuentePorNombre(n) || NV.fuentePorNombre(String(n).replace(/([a-z])([A-Z])/g, '$1 $2'));
    return f ? f.pdf : null;
  }
  function registrarFuentes(pdfMake, usadas) {
    var fonts = {};
    Object.keys(usadas).forEach(function(n) { var u = FUENTES_PDF[n]; if (u) fonts[n] = {normal: G + u[0], bold: G + u[1], italics: G + u[2], bolditalics: G + u[3]}; });
    pdfMake.fonts = fonts;
  }
  function cm2pt(c) { return c * 72 / 2.54; }

  // ---------- Documento → PDF ----------
  PDF.exportarDoc = function(html, aj, titulo, autor) {
    return NV.lib.pdfmake().then(function(L) {
      var cont = document.createElement('div'); cont.innerHTML = html;
      return NV.docx.prepararImagenes(cont).then(function() { return generar(L, cont, aj, titulo, autor); });
    });
  };
  function generar(L, cont, aj, titulo, autor) {
    var T = NV.word.TEMAS[aj.tema] || aj.temaPersonalizado || NV.word.TEMAS.office, esp = NV.word.ESPACIADOS[aj.espaciado] || NV.word.ESPACIADOS.normal;
    var t = NV.word.TAMANOS[aj.pagina.tam] || {w: aj.pagina.ancho || 21.59, h: aj.pagina.alto || 27.94};
    var W = t.w, H = t.h; if (aj.pagina.orient === 'h') { var x = W; W = H; H = x; }
    var m = aj.pagina.margenes, anchoUtil = cm2pt(W - m.izq - m.der);
    var cuerpoF = fuentePdf(T.cuerpo) || 'Carlito', titF = fuentePdf(T.titulos) || cuerpoF;
    var usadas = {}; usadas[cuerpoF] = 1; usadas[titF] = 1;
    // Marcadores para elementos que pdfmake maneja de forma propia.
    Array.prototype.forEach.call(cont.querySelectorAll('.nv-salto'), function(s) { s.outerHTML = '<p>@@NVSALTO@@</p>'; });
    var tocTit = null;
    Array.prototype.forEach.call(cont.querySelectorAll('.nv-toc'), function(s) { tocTit = s.getAttribute('data-nv-toc') || 'Contenido'; s.outerHTML = '<p>@@NVTOC@@</p>'; });
    Array.prototype.forEach.call(cont.querySelectorAll('.nv-cuadro'), function(c) {  // cuadro → tabla de una celda
      var st = c.getAttribute('style') || '', tb = document.createElement('table');
      tb.setAttribute('style', 'width:' + ((/width:\s*([\d.]+%)/.exec(st) || [])[1] || '100%'));
      tb.innerHTML = '<tbody><tr><td style="border:' + ((/border:\s*0/.test(st)) ? 'none' : '1px solid #000') + ';' + (/background[^;]*/.exec(st) || [''])[0] + ';padding:4pt 7pt">' + c.innerHTML + '</td></tr></tbody>';
      c.replaceWith(tb);
    });
    Array.prototype.forEach.call(cont.querySelectorAll('img'), function(im) {
      var tam = NV.docx.tamImagen(im, anchoUtil / 0.75);
      im.setAttribute('width', Math.round(tam.w * 0.75)); im.setAttribute('height', Math.round(tam.h * 0.75));
      im.style.width = ''; im.style.height = '';
    });
    var hc = T.h, d0 = {
      b: {bold: true}, strong: {bold: true}, u: {decoration: 'underline'}, s: {decoration: 'lineThrough'}, em: {italics: true}, i: {italics: true},
      h1: {font: titF, fontSize: 16, bold: false, color: hc, marginTop: 12, marginBottom: 0}, h2: {font: titF, fontSize: 13, bold: false, color: hc, marginTop: 2, marginBottom: 0},
      h3: {font: titF, fontSize: 12, bold: false, color: T.h3, marginTop: 2, marginBottom: 0}, h4: {font: titF, fontSize: 11, bold: false, italics: true, color: hc, marginTop: 2, marginBottom: 0},
      h5: {font: titF, fontSize: 11, bold: false, color: hc}, h6: {font: titF, fontSize: 11, bold: false, color: T.h3},
      a: {color: '#0563C1', decoration: 'underline'}, p: {margin: [0, esp.antes, 0, esp.despues]},
      ul: {marginBottom: esp.despues, marginLeft: 6}, ol: {marginBottom: esp.despues, marginLeft: 6}, li: {marginLeft: 0},
      table: {marginBottom: 6}, th: {bold: true, fillColor: null}, td: {}
    };
    var contenido = L.htmlToPdfmake(cont.innerHTML, {window: window, defaultStyles: d0, tableAutoSize: true, removeExtraBlanks: true,
      ignoreStyles: ['line-height'], replaceText: function(t) { return t.replace(/ /g, ' '); }});
    var clases = {'nv-Title': {font: titF, fontSize: 28, characterSpacing: -0.5, margin: [0, 0, 0, 0]}, 'nv-Subtitle': {color: '#5A5A5A', characterSpacing: 0.75},
      'nv-Quote': {italics: true, color: '#404040', alignment: 'center', margin: [43, 10, 43, 10]}, 'nv-IntenseQuote': {italics: true, color: T.acentos[0], alignment: 'center', margin: [43, 18, 43, 18]},
      'nv-NoSpacing': {margin: [0, 0, 0, 0]}, 'nv-Caption': {italics: true, fontSize: 9, color: T.oscuro}, 'nv-SubtleEmphasis': {italics: true, color: '#404040'},
      'nv-IntenseEmphasis': {italics: true, color: T.acentos[0]}, 'nv-BookTitle': {bold: true, italics: true}, 'nv-IntenseReference': {bold: true, color: T.acentos[0]}, 'nv-SubtleReference': {color: '#5A5A5A'}};
    // Recorre el contenido: fuentes, saltos, tabla de contenido, títulos y estilos de clase.
    var recorrer = function(n) {
      if (Array.isArray(n)) { for (var i = 0; i < n.length; i++) { var r = recorrer(n[i]); if (r !== undefined) n[i] = r; } return; }
      if (!n || typeof n !== 'object') return;
      if (n.text === '@@NVSALTO@@' || (Array.isArray(n.text) && n.text.length === 1 && n.text[0] && n.text[0].text === '@@NVSALTO@@')) return {text: '', pageBreak: 'after'};
      if (n.text === '@@NVTOC@@' || (Array.isArray(n.text) && n.text.length === 1 && n.text[0] && n.text[0].text === '@@NVTOC@@')) {
        return {toc: {title: {text: tocTit, font: titF, fontSize: 16, color: hc, margin: [0, 12, 0, 6]}, numberStyle: {}, textMargin: [0, 0, 0, 4]}};
      }
      if (n.font) { var f = fuentePdf(n.font); if (f) { n.font = f; usadas[f] = 1; } else delete n.font; }
      var est = n.style ? [].concat(n.style) : [];
      est.forEach(function(s) {
        var c = clases[s]; if (c) Object.keys(c).forEach(function(k) { if (n[k] === undefined || k === 'font') n[k] = c[k]; });
        var mh = /^html-h([1-3])$/.exec(s); if (mh && n.text) { n.tocItem = true; n.tocStyle = {fontSize: 11}; n.tocMargin = [(+mh[1] - 1) * 11, 0, 0, 0]; }
      });
      if (n.font) usadas[n.font] = 1;
      ['text', 'stack', 'ul', 'ol', 'columns'].forEach(function(k) { if (n[k] && typeof n[k] === 'object') recorrer(n[k]); });
      if (n.table && n.table.body) n.table.body.forEach(function(fila) { recorrer(fila); });
    };
    recorrer(contenido);
    var zona = function(h, pag, total) {
      if (!h) return null;
      var c = L.htmlToPdfmake(NV.word.camposHtml(h, pag, total), {window: window, defaultStyles: d0, removeExtraBlanks: true});
      recorrer(c); return c;
    };
    var ml = cm2pt(m.izq), mr = cm2pt(m.der), mt = cm2pt(m.sup), mb = cm2pt(m.inf), de = cm2pt(aj.distEnc || 1.25), dp = cm2pt(aj.distPie || 1.25);
    var dd = {
      pageSize: {width: cm2pt(W), height: cm2pt(H)}, pageMargins: [ml, mt, mr, mb],
      info: {title: titulo || 'Documento', author: autor || 'Nuvia Office', creator: 'Nuvia Office', producer: 'Nuvia Office'},
      defaultStyle: {font: cuerpoF, fontSize: 11, lineHeight: Math.max(1, esp.linea * 0.97), color: '#000000'},
      content: contenido,
      header: function(pag, total) { if (aj.primeraDistinta && pag === 1) { var h1 = zona(aj.encabezadoPrimera, pag, total); return h1 ? {stack: h1, margin: [ml, de, mr, 0]} : null; } var h = zona(aj.encabezado, pag, total); return h ? {stack: h, margin: [ml, de, mr, 0]} : null; },
      footer: function(pag, total) { if (aj.primeraDistinta && pag === 1) { var p1 = zona(aj.piePrimera, pag, total); return p1 ? {stack: p1, margin: [ml, Math.max(0, mb - dp - 14), mr, 0]} : null; } var p = zona(aj.pie, pag, total); return p ? {stack: p, margin: [ml, Math.max(0, mb - dp - 14), mr, 0]} : null; },
      background: function() {
        var cv = [];
        if (aj.colorPagina) cv.push({type: 'rect', x: 0, y: 0, w: cm2pt(W), h: cm2pt(H), color: aj.colorPagina});
        var bp = aj.bordePagina;
        if (bp && bp.estilo) cv.push({type: 'rect', x: 24, y: 24, w: cm2pt(W) - 48, h: cm2pt(H) - 48, lineWidth: bp.grosor || 1, lineColor: bp.color || '#000', dash: bp.estilo === 'dashed' ? {length: 4} : bp.estilo === 'dotted' ? {length: 1, space: 2} : undefined});
        return cv.length ? {canvas: cv} : null;
      }
    };
    if (aj.marcaAgua && aj.marcaAgua.texto) {
      var mf = fuentePdf(aj.marcaAgua.fuente || 'Calibri') || cuerpoF; usadas[mf] = 1;
      dd.watermark = {text: aj.marcaAgua.texto, color: aj.marcaAgua.color || '#BFBFBF', opacity: 0.35, bold: true, font: mf};
    }
    registrarFuentes(L.pdfMake, usadas);
    return new Promise(function(ok, mal) {
      try { L.pdfMake.createPdf(dd).getBlob(function(b) { ok(b); }); } catch (e) { mal(e); }
    });
  }

  // ---------- Imágenes → PDF ----------
  PDF.TAMANOS = {a4: [595.28, 841.89], carta: [612, 792], oficio: [612, 1008]};
  PDF.imagenesAPdf = function(archivos, o, progreso) {
    o = o || {};
    return NV.lib.pdflib().then(function(PL) {
      return PL.PDFDocument.create().then(function(doc) {
        doc.setTitle(o.titulo || 'Imágenes'); doc.setCreator('Nuvia Office'); doc.setProducer('Nuvia Office');
        var i = 0;
        var siguiente = function() {
          if (i >= archivos.length) return doc.save();
          var f = archivos[i++]; if (progreso) progreso(i / archivos.length, f.name);
          return aBytesImagen(f).then(function(img) {
            var emb = img.tipo === 'png' ? doc.embedPng(img.bytes) : doc.embedJpg(img.bytes);
            return emb.then(function(im) {
              var w = im.width, h = im.height, margen = o.margen === 'grande' ? 56 : o.margen === 'pequeno' ? 20 : 0;
              var pw, ph;
              if (o.tam === 'imagen' || !PDF.TAMANOS[o.tam]) { pw = w * 0.75 + margen * 2; ph = h * 0.75 + margen * 2; }
              else {
                pw = PDF.TAMANOS[o.tam][0]; ph = PDF.TAMANOS[o.tam][1];
                var hz = o.orient === 'h' || (o.orient !== 'v' && w > h);
                if (hz) { var t = pw; pw = ph; ph = t; }
              }
              var pag = doc.addPage([pw, ph]), aw = pw - margen * 2, ah = ph - margen * 2;
              var k = o.tam === 'imagen' ? 0.75 : Math.min(aw / w, ah / h);
              if (o.ajuste === 'llenar' && o.tam !== 'imagen') k = Math.max(aw / w, ah / h);
              var dw = w * k, dh = h * k;
              pag.drawImage(im, {x: (pw - dw) / 2, y: (ph - dh) / 2, width: dw, height: dh});
            });
          }).then(siguiente);
        };
        return siguiente();
      });
    }).then(function(bytes) { return new Blob([bytes], {type: 'application/pdf'}); });
  };
  // Cualquier formato de imagen que el navegador abra (PNG, JPG, WEBP, GIF, BMP, HEIC si el equipo lo soporta) se lleva a PNG/JPG.
  function aBytesImagen(f) {
    var tipo = (f.type || '').toLowerCase(), ext = NV.extension(f.name);
    if (tipo === 'image/png' || ext === 'png') return NV.leerArchivo(f).then(function(b) { return {tipo: 'png', bytes: new Uint8Array(b)}; });
    if (tipo === 'image/jpeg' || ext === 'jpg' || ext === 'jpeg') return NV.leerArchivo(f).then(function(b) { return {tipo: 'jpg', bytes: corregirJpg(new Uint8Array(b))}; });
    return NV.leerArchivo(f, 'url').then(function(url) {
      return new Promise(function(ok, mal) {
        var img = new Image();
        img.onload = function() {
          var c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
          var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0);
          ok({tipo: 'jpg', bytes: NV.dataUrlABytes(c.toDataURL('image/jpeg', 0.92))});
        };
        img.onerror = function() { mal(new Error('No se pudo abrir la imagen "' + f.name + '".')); };
        img.src = url;
      });
    });
  }
  function corregirJpg(b) { return b; }

  // ---------- Unir y combinar PDF (para "Documento → PDF" de varios archivos) ----------
  PDF.unir = function(blobs) {
    return NV.lib.pdflib().then(function(PL) {
      return PL.PDFDocument.create().then(function(doc) {
        return blobs.reduce(function(p, b) {
          return p.then(function() { return b.arrayBuffer(); }).then(function(buf) { return PL.PDFDocument.load(buf, {ignoreEncryption: true}); })
            .then(function(src) { return doc.copyPages(src, src.getPageIndices()); }).then(function(pags) { pags.forEach(function(pg) { doc.addPage(pg); }); });
        }, Promise.resolve()).then(function() { return doc.save(); });
      });
    }).then(function(bytes) { return new Blob([bytes], {type: 'application/pdf'}); });
  };

  // ---------- PDF → documento editable ----------
  PDF.aDocumento = function(buffer, opciones, progreso) {
    opciones = opciones || {};
    return NV.lib.pdfjs().then(function(pdfjs) {
      return pdfjs.getDocument({data: new Uint8Array(buffer), isEvalSupported: false}).promise.then(function(pdf) {
        var paginas = [], n = pdf.numPages, aj = NV.word.ajustesPredeterminados(), i = 0;
        var siguiente = function() {
          if (i >= n) return null;
          i++; if (progreso) progreso(i / n, 'Página ' + i + ' de ' + n);
          return pdf.getPage(i).then(function(pg) { return leerPagina(pdfjs, pg, i, opciones, aj); }).then(function(h) { paginas.push(h); pdf.cleanup && i % 10 === 0 && pdf.cleanup(); return siguiente(); });
        };
        return siguiente().then(function() {
          // Encabezado/pie: la misma línea (sin contar los números) arriba/abajo en la mayoría de las páginas, o en un PDF de una página
          var norm = function(t) { return String(t || '').replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().toLowerCase(); };
          var decidir = function(clave) {
            var con = paginas.filter(function(pg) { return pg[clave]; });
            if (!con.length) return null;
            var t0 = norm(con[0][clave].texto), iguales = con.filter(function(pg) { return norm(pg[clave].texto) === t0; }).length;
            return (n === 1 || iguales >= Math.max(2, Math.ceil(n * 0.5))) ? con[0][clave] : null;
          };
          var enc = decidir('enc'), pie = decidir('pie');
          var campo = function(z, i) {  // el número de la página pasa a ser un campo (cambia solo en cada página)
            var h = z.html;
            if (/\d/.test(z.texto)) {
              var num = String(i + 1), re = new RegExp('(^|[^\\d])' + num + '(?!\\d)');
              if (re.test(h.replace(/<[^>]+>/g, ''))) h = h.replace(re, '$1<span data-campo="pagina">#</span>');
              h = h.replace(/(de|of)\s+(<[^>]+>)*\s*\d+/i, function(m) { return m.replace(/\d+$/, '<span data-campo="paginas">#</span>'); });
            }
            return '<p style="text-align:' + z.al + '">' + h + '</p>';
          };
          if (enc) aj.encabezado = campo(enc, 0);
          if (pie) aj.pie = campo(pie, 0);
          var cuerpo = paginas.map(function(pg) {  // las líneas que no se repiten vuelven al cuerpo
            var h = pg.html || '';
            if (pg.enc && !enc) h = '<p>' + pg.enc.html + '</p>' + h;
            if (pg.pie && !pie) h += '<p>' + pg.pie.html + '</p>';
            return h;
          });
          return {html: cuerpo.join('<div class="nv-salto"></div>'), ajustes: aj, paginas: n};
        });
      });
    });
  };
  function leerPagina(pdfjs, pg, num, op, aj) {
    var vp = pg.getViewport({scale: 1});
    if (num === 1) {  // tamaño de la página del PDF → tamaño del documento
      var wcm = vp.width / 72 * 2.54, hcm = vp.height / 72 * 2.54;
      var tam = Object.keys(NV.word.TAMANOS).filter(function(k) { var t = NV.word.TAMANOS[k]; return (Math.abs(t.w - Math.min(wcm, hcm)) < 0.4 && Math.abs(t.h - Math.max(wcm, hcm)) < 0.4); })[0];
      if (tam) aj.pagina.tam = tam; else { aj.pagina.tam = 'personalizado'; aj.pagina.ancho = Math.round(Math.min(wcm, hcm) * 100) / 100; aj.pagina.alto = Math.round(Math.max(wcm, hcm) * 100) / 100; }
      aj.pagina.orient = wcm > hcm ? 'h' : 'v';
    }
    return Promise.all([pg.getTextContent({includeMarkedContent: false}), op.imagenes !== false ? pg.getOperatorList() : Promise.resolve(null)]).then(function(r) {
      var tc = r[0], ops = r[1];
      var fuentes = {};
      tc.items.forEach(function(it) {
        if (!it.fontName || fuentes[it.fontName]) return;
        var nombre = ''; try { var fo = pg.commonObjs.get(it.fontName); nombre = (fo && (fo.name || fo.loadedName)) || ''; } catch (e) {}
        var est = tc.styles[it.fontName] || {};
        fuentes[it.fontName] = {n: nombre, fam: est.fontFamily || '', negrita: /bold|black|heavy|semibold|demi/i.test(nombre), cursiva: /italic|oblique/i.test(nombre)};
      });
      // Líneas de texto
      var items = tc.items.filter(function(it) { return it.str !== undefined; }).map(function(it) {
        var t = it.transform, alto = Math.hypot(t[2], t[3]) || Math.abs(t[3]) || 10;
        return {s: it.str, x: t[4], y: vp.height - t[5], w: it.width, h: alto, f: fuentes[it.fontName] || {}, eol: it.hasEOL};
      }).filter(function(it) { return it.s.length; });
      items.sort(function(a, b) { return Math.abs(a.y - b.y) < Math.min(a.h, b.h) * 0.5 ? a.x - b.x : a.y - b.y; });
      var lineas = [];
      items.forEach(function(it) {
        var l = lineas[lineas.length - 1];
        if (l && Math.abs(l.y - it.y) < Math.max(2, Math.min(l.h, it.h) * 0.5)) { l.items.push(it); l.h = Math.max(l.h, it.h); l.x1 = Math.max(l.x1, it.x + it.w); }
        else lineas.push({y: it.y, h: it.h, x0: it.x, x1: it.x + it.w, items: [it]});
      });
      // Imágenes en su posición vertical
      var imagenes = [], vinetas = [];
      if (ops) { imagenes = extraerImagenes(pdfjs, pg, ops, vp); vinetas = imagenes.vinetas || []; }
      return Promise.all(imagenes.map(function(im) { return im.url.then(function(u) { im.dataUrl = u; return im; }); })).then(function(imgs) {
        imgs = imgs.filter(function(im) { return im.dataUrl && im.w > 12 && im.h > 12; });
        // Página escaneada (sin texto): se inserta la página completa como imagen
        if (!lineas.length) {
          return renderPagina(pg, vp).then(function(u) { return {html: '<p style="text-align:center;margin:0"><img src="' + u + '" alt="Página ' + num + '" style="width:100%"></p>'}; });
        }
        // márgenes izquierdos frecuentes
        var tamCuerpo = moda(lineas.map(function(l) { return Math.round(l.h); }));
        // Encabezado y pie: líneas solas muy arriba o muy abajo de la página (se confirman en aDocumento si se repiten)
        var enc = null, pie = null;
        var alin = function(l) { var c = (l.x0 + l.x1) / 2; return Math.abs(c - vp.width / 2) < 20 ? 'center' : l.x0 > vp.width * 0.55 ? 'right' : 'left'; };
        if (lineas.length > 1 && lineas[0].y < vp.height * 0.09 && lineas[1].y - lineas[0].y > lineas[0].h * 1.6) {
          var l0 = lineas.shift(); enc = {texto: l0.items.map(function(i) { return i.s; }).join(' ').trim(), html: runs(l0.items), al: alin(l0), y: l0.y};
        }
        if (lineas.length > 1 && lineas[lineas.length - 1].y > vp.height * 0.91 && lineas[lineas.length - 1].y - lineas[lineas.length - 2].y > lineas[lineas.length - 1].h * 1.6) {
          var lz = lineas.pop(); pie = {texto: lz.items.map(function(i) { return i.s; }).join(' ').trim(), html: runs(lz.items), al: alin(lz), y: lz.y};
        }
        // márgenes de la página (sin contar encabezado y pie)
        var xs = lineas.map(function(l) { return Math.round(l.x0); }).sort(function(a, b) { return a - b; }), margenIzq = xs[Math.floor(xs.length * 0.1)] || 72;
        var anchoTexto = Math.max.apply(null, lineas.map(function(l) { return l.x1; })) - margenIzq;
        if (num === 1) {
          var cmDe = function(pt) { return Math.round(pt / 72 * 2.54 * 100) / 100; };
          aj.pagina.margenes.izq = Math.max(0.5, Math.min(5, cmDe(margenIzq)));
          aj.pagina.margenes.der = Math.max(0.5, Math.min(5, cmDe(vp.width - margenIzq - anchoTexto)));
          var top = lineas[0].y - lineas[0].h; aj.pagina.margenes.sup = Math.max(0.5, Math.min(5, cmDe(top)));
          if (enc) { aj.distEnc = Math.max(0.3, cmDe(enc.y - lineas[0].h)); aj.pagina.margenes.sup = Math.max(aj.pagina.margenes.sup, aj.distEnc + 0.8); }
          if (pie) { aj.distPie = Math.max(0.3, cmDe(vp.height - pie.y)); aj.pagina.margenes.inf = Math.max(aj.distPie + 0.8, Math.min(5, aj.pagina.margenes.inf)); }
        }
        // Celdas de cada línea: grupos de palabras separados por un espacio grande (columnas de una tabla)
        lineas.forEach(function(l) {
          var segs = [], s = null, prevX = null, cortar = false;
          l.items.forEach(function(it) {
            var blanco = !it.s.trim();
            if (blanco) { if (it.w > Math.max(10, it.h * 1.3)) cortar = true; return; }  // un "espacio" muy ancho separa columnas
            if (!s || cortar || it.x - prevX > Math.max(10, it.h * 1.3)) { s = {x0: it.x, x1: it.x + it.w, items: []}; segs.push(s); }
            s.items.push(it); s.x1 = Math.max(s.x1, it.x + it.w); prevX = it.x + it.w; cortar = false;
          });
          l.segs = segs;
          l.texto = l.items.map(function(i) { return i.s; }).join(' ').replace(/\s+/g, ' ').trim();
          l.vineta = vinetas.some(function(v) { return v.x < l.x0 && l.x0 - v.x < 24 && Math.abs(v.y - (l.y - l.h * 0.35)) < l.h * 0.8; });
        });
        var alinea = function(a, b) { return a.segs.length === b.segs.length && a.segs.every(function(s, i) { var c = b.segs[i]; return Math.abs(s.x0 - c.x0) < 14 || Math.abs(s.x1 - c.x1) < 14; }); };
        // Bloques: tablas (2+ filas con las mismas columnas), elementos de lista y párrafos
        var bloques = [], par = null, ESVINETA = /^[•●○■▪◦➢✓◆\-–]\s*/, ESNUM = /^(\d{1,3}|[a-zA-Z]|[ivxIVX]{1,4})[.)]\s+/;
        for (var k = 0; k < lineas.length; k++) {
          var l = lineas[k], prev = lineas[k - 1];
          if (l.segs.length >= 2 && !ESNUM.test(l.texto)) {  // ¿empieza una tabla?
            var fin = k; while (fin + 1 < lineas.length && alinea(lineas[fin + 1], l) && lineas[fin + 1].y - lineas[fin].y < l.h * 5) fin++;
            if (fin > k) { bloques.push({tabla: lineas.slice(k, fin + 1), y: l.y, h: l.h, x0: l.x0, x1: Math.max.apply(null, lineas.slice(k, fin + 1).map(function(x) { return x.x1; })), lineas: lineas.slice(k, fin + 1)}); par = null; k = fin; continue; }
          }
          var vin = ESVINETA.test(l.texto) || l.vineta, nume = ESNUM.test(l.texto);
          var sep = prev ? l.y - prev.y : 0;
          var nuevo = !par || par.tabla || vin || nume || sep > l.h * 1.75 || Math.abs(l.h - par.h) > 1.2 || (l.x0 - margenIzq > 18 && prev && prev.x1 < margenIzq + anchoTexto * 0.8) ||
                      (prev && prev.x1 < margenIzq + anchoTexto * 0.6);
          if (par && par.lista && !vin && !nume && l.x0 > par.x0 + 6 && sep <= l.h * 1.75) nuevo = false;  // segunda línea de un elemento de lista
          if (nuevo) { par = {lineas: [], h: l.h, y: l.y, x0: l.x0, x1: l.x1, lista: vin ? 'ul' : nume ? 'ol' : null}; bloques.push(par); }
          par.lineas.push(l); par.x0 = Math.min(par.x0, l.x0); par.x1 = Math.max(par.x1, l.x1);
        }
        var html = [];
        var colocar = function(hastaY) {
          while (imgs.length && imgs[0].y <= hastaY) {
            var im = imgs.shift(), wcm = Math.min(im.w / 72 * 2.54, (vp.width - 2 * margenIzq) / 72 * 2.54);
            var centro = Math.abs((im.x + im.w / 2) - vp.width / 2) < vp.width * 0.1;
            html.push('<p style="margin:0 0 6pt;' + (centro ? 'text-align:center' : '') + '"><img src="' + im.dataUrl + '" alt="" style="width:' + wcm.toFixed(2) + 'cm;height:auto"></p>');
          }
        };
        imgs.sort(function(a, b) { return a.y - b.y; });
        var listaAbierta = null;
        var cerrarLista = function() { if (listaAbierta) { html.push('</' + listaAbierta + '>'); listaAbierta = null; } };
        bloques.forEach(function(b, k) {
          colocar(b.y - b.h);
          if (b.tabla) {
            cerrarLista();
            var n = b.tabla[0].segs.length, ancho = (b.x1 - b.x0) || 1;
            var cols = b.tabla[0].segs.map(function(s, i) { var sig = b.tabla[0].segs[i + 1]; return ((sig ? sig.x0 : b.x1) - s.x0) / ancho * 100; });
            html.push('<table style="border-collapse:collapse;width:' + Math.min(100, Math.round(ancho / anchoTexto * 100)) + '%"><tbody>' + b.tabla.map(function(fila, fi) {
              return '<tr>' + fila.segs.map(function(s, i) {
                var t = runs(s.items).replace(/\s{2,}/g, ' ').trim(), num = /^[\d.,%$\s-]+$/.test(s.items.map(function(x) { return x.s; }).join(''));
                return '<td style="border:1px solid #000;width:' + cols[i].toFixed(1) + '%' + (num ? ';text-align:right' : '') + (fi === 0 && todoNegritaSeg(s) ? ';font-weight:bold' : '') + '">' + (t || '<br>') + '</td>';
              }).join('') + '</tr>';
            }).join('') + '</tbody></table><p style="margin:0"><br></p>');
            return;
          }
          if (b.lista) {
            if (listaAbierta !== b.lista) { cerrarLista(); listaAbierta = b.lista; html.push('<' + b.lista + ' style="margin:0 0 6pt">'); }
            var tl = b.lineas.map(function(l) { return runs(l.items); }).join(' ').replace(/\s{2,}/g, ' ').trim()
              .replace(b.lista === 'ul' ? /^((?:<[^>]+>)*)[•●○■▪◦➢✓◆\-–]\s*/ : /^((?:<[^>]+>)*)(\d{1,3}|[a-zA-Z]|[ivxIVX]{1,4})[.)]\s*/, '$1');
            html.push('<li>' + tl + '</li>');
            return;
          }
          cerrarLista();
          var texto = b.lineas.map(function(l, j) {
            var t = runs(l.items);
            var fin = l.items[l.items.length - 1].s;
            return t + (j < b.lineas.length - 1 ? (/-$/.test(fin) ? '' : ' ') : '');
          }).join('').replace(/\s{2,}/g, ' ').trim();
          if (!texto) return;
          var pt = Math.round(b.h * 0.9 * 2) / 2, centro = Math.abs(((b.x0 + b.x1) / 2) - vp.width / 2) < 12 && (b.x1 - b.x0) < anchoTexto * 0.85;
          var derecha = !centro && b.x0 > vp.width * 0.55;
          var sangria = b.x0 - margenIzq > 10 && !centro ? Math.round((b.x0 - margenIzq) / 72 * 2.54 * 100) / 100 : 0;
          var sig = bloques[k + 1], despues = sig ? Math.max(0, Math.round(((sig.y - sig.h) - b.lineas[b.lineas.length - 1].y) * 0.8)) : 6;
          var estilo = 'margin:0 0 ' + Math.min(24, despues) + 'pt' + (sangria ? ' ' + sangria + 'cm' : '') + ';' + (centro ? 'text-align:center;' : derecha ? 'text-align:right;' : (b.lineas.length > 2 ? 'text-align:justify;' : ''));
          var tag = 'p', base = tamCuerpo * 0.9, plano = texto.replace(/<[^>]+>/g, '');
          if (pt >= base * 1.55 && plano.length < 120) tag = 'h1';
          else if (pt >= base * 1.15 && plano.length < 140) tag = 'h2';
          else if (b.lineas.length === 1 && plano.length < 90 && todoNegrita(b) && pt >= base * 1.05 && !/[.:;,]$/.test(plano)) tag = 'h3';  // línea corta, sola y en negrita: título
          if (tag !== 'p') texto = texto.replace(/<\/?strong>/g, '');
          var tama = Math.abs(pt - tamCuerpo * 0.9) > 0.6 ? 'font-size:' + pt + 'pt;' : '';
          html.push('<' + tag + ' style="' + estilo + (tag === 'p' ? tama : 'font-size:' + pt + 'pt;') + '">' + texto + '</' + tag + '>');
        });
        cerrarLista();
        colocar(1e9);
        return {html: html.join(''), enc: enc, pie: pie};
      });
    });
    function todoNegritaSeg(s) { return s.items.every(function(it) { return it.f.negrita || !it.s.trim(); }); }
    // Une en un solo tramo las palabras seguidas que tienen el mismo formato (fuente, negrita, cursiva).
    function runs(its) {
      var tramos = [], prevX = null;
      its.forEach(function(it) {
        var f = it.f, clave = familiaDe(f.n) + '|' + !!f.negrita + '|' + !!f.cursiva, t = it.s;
        var espacio = prevX !== null && it.x - prevX > it.h * 0.2 && !/^\s/.test(t);
        var ult = tramos[tramos.length - 1];
        if (ult && ult.clave === clave) ult.t += (espacio && !/\s$/.test(ult.t) ? ' ' : '') + t;
        else { if (ult && espacio && !/\s$/.test(ult.t)) ult.t += ' '; tramos.push({clave: clave, f: f, t: t}); }
        prevX = it.x + it.w;
      });
      return tramos.map(function(tr) {
        var s = NV.esc(tr.t), fam = familiaDe(tr.f.n);
        if (tr.f.negrita) s = '<strong>' + s + '</strong>';
        if (tr.f.cursiva) s = '<em>' + s + '</em>';
        return fam ? '<span style="font-family:' + fam + '">' + s + '</span>' : s;
      }).join('');
    }
    function todoNegrita(b) { return b.lineas.every(function(l) { return l.items.every(function(it) { return it.f.negrita || !it.s.trim(); }); }); }
  }
  function familiaDe(n) {
    n = String(n || '').replace(/^[A-Z]{6}\+/, '').replace(/[-,](Bold|Italic|Oblique|Regular|Black|Semibold|Light|Medium|BoldItalic|BoldOblique|Roman|MT|PS|PSMT).*$/i, '').replace(/MT$|PSMT$|PS$/, '');
    var limpio = n.replace(/([a-z])([A-Z])/g, '$1 $2').trim(), f = NV.fuentePorNombre(limpio) || NV.fuentePorNombre(n);
    if (f) return f.css.replace(/"/g, "'");
    if (/times/i.test(n)) return NV.cssFuente('Times New Roman').replace(/"/g, "'");
    if (/arial|helvet/i.test(n)) return NV.cssFuente('Arial').replace(/"/g, "'");
    if (/courier/i.test(n)) return NV.cssFuente('Courier New').replace(/"/g, "'");
    return '';
  }
  function moda(a) { var c = {}, best = a[0] || 11, max = 0; a.forEach(function(x) { c[x] = (c[x] || 0) + 1; if (c[x] > max) { max = c[x]; best = x; } }); return best; }
  function renderPagina(pg, vp) {
    var k = Math.min(2, 1600 / vp.width), v2 = pg.getViewport({scale: k}), c = document.createElement('canvas');
    c.width = Math.round(v2.width); c.height = Math.round(v2.height);
    var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    return pg.render({canvasContext: x, viewport: v2}).promise.then(function() { return c.toDataURL('image/jpeg', 0.85); });
  }
  // Recorre las operaciones de dibujo para ubicar las imágenes (con su matriz de transformación).
  function extraerImagenes(pdfjs, pg, ops, vp) {
    var O = pdfjs.OPS, pila = [], ctm = [1, 0, 0, 1, 0, 0], res = [];
    res.vinetas = [];  // viñetas dibujadas (puntos o cuadritos rellenos pequeños)
    var RELLENOS = [O.fill, O.eoFill, O.fillStroke, O.eoFillStroke, O.closeFillStroke, O.closeEOFillStroke];
    var mult = function(a, b) { return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]]; };
    for (var i = 0; i < ops.fnArray.length; i++) {
      var fn = ops.fnArray[i], args = ops.argsArray[i];
      if (fn === O.save) pila.push(ctm.slice());
      else if (fn === O.restore) ctm = pila.pop() || [1, 0, 0, 1, 0, 0];
      else if (fn === O.transform) ctm = mult(ctm, args);
      else if (fn === O.constructPath && args && args[2] && [1, 2, 3].some(function(k) { return RELLENOS.indexOf(ops.fnArray[i + k]) >= 0; })) {
        // minMax = [minX, maxX, minY, maxY]; pdf.js no cuenta las curvas, así que un punto redondo puede medir 0
        var mm = args[2], sub = args[0] || [];
        var curva = sub.indexOf(O.curveTo) >= 0 || sub.indexOf(O.curveTo2) >= 0 || sub.indexOf(O.curveTo3) >= 0, rect = sub.indexOf(O.rectangle) >= 0;
        var ax = ctm[0] * mm[0] + ctm[2] * mm[2] + ctm[4], ay = ctm[1] * mm[0] + ctm[3] * mm[2] + ctm[5],
            bx = ctm[0] * mm[1] + ctm[2] * mm[3] + ctm[4], by = ctm[1] * mm[1] + ctm[3] * mm[3] + ctm[5];
        var pw = Math.abs(bx - ax), ph = Math.abs(by - ay);
        if ((curva || rect) && pw < 8 && ph < 8 && Math.abs(pw - ph) < 2.5 && sub.length <= 12) res.vinetas.push({x: (ax + bx) / 2, y: vp.height - (ay + by) / 2});
      }
      else if (fn === O.paintImageXObject || fn === O.paintJpegXObject || fn === O.paintInlineImageXObject) {
        var w = Math.hypot(ctm[0], ctm[1]), h = Math.hypot(ctm[2], ctm[3]), x = ctm[4], y = vp.height - (ctm[5] + h);
        (function(nombre, inline, w, h, x, y) {
          res.push({x: x, y: y, w: w, h: h, url: new Promise(function(ok) {
            var dibujar = function(img) {
              try {
                if (!img) { ok(null); return; }
                var c = document.createElement('canvas'), cx = c.getContext('2d');
                if (img.bitmap) { c.width = img.bitmap.width; c.height = img.bitmap.height; cx.drawImage(img.bitmap, 0, 0); }
                else if (img.data && img.width) {
                  c.width = img.width; c.height = img.height;
                  var id = cx.createImageData(img.width, img.height), d = img.data, px = img.width * img.height;
                  if (d.length === px * 4) id.data.set(d);
                  else if (d.length === px * 3) { for (var k = 0, j = 0; k < px; k++) { id.data[j++] = d[k * 3]; id.data[j++] = d[k * 3 + 1]; id.data[j++] = d[k * 3 + 2]; id.data[j++] = 255; } }
                  else if (d.length === px) { for (var q = 0, z = 0; q < px; q++) { id.data[z++] = d[q]; id.data[z++] = d[q]; id.data[z++] = d[q]; id.data[z++] = 255; } }
                  else { ok(null); return; }
                  cx.putImageData(id, 0, 0);
                } else { ok(null); return; }
                if (c.width * c.height > 4e6) { var k2 = Math.sqrt(4e6 / (c.width * c.height)), c2 = document.createElement('canvas'); c2.width = Math.round(c.width * k2); c2.height = Math.round(c.height * k2); c2.getContext('2d').drawImage(c, 0, 0, c2.width, c2.height); c = c2; }
                ok(c.toDataURL('image/jpeg', 0.88));
              } catch (e) { ok(null); }
            };
            if (inline) { dibujar(nombre); return; }
            try { var o = pg.objs.get(nombre); dibujar(o); } catch (e) { pg.objs.get(nombre, dibujar); }
          })});
        })(fn === O.paintInlineImageXObject ? args[0] : args[0], fn === O.paintInlineImageXObject, w, h, x, y);
      }
    }
    return res;
  }
})();
