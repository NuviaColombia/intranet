/* Nuvia Office · Protocolos (pedido por Rosember el 12-oct-2026): editar un protocolo de Design y publicarlo.
   - /design/office?protocolo=ID&desde=pdf|pptx[&reemplazar=1]: arma el borrador (una diapositiva editable por página
     del PDF publicado: textos y fotos sueltos sobre el fondo; o el PowerPoint original) y lo abre. Se guarda solo.
   - Al abrir el borrador sale una banda con "Publicar nueva versión": exporta a PDF, lo sube por partes y lo deja como
     la versión vigente del protocolo (services_design_protocolos_edicion.py). Solo admins (los que editan Protocols). */
(function() {
  'use strict';
  var NV = window.NV, P = NV.ppt, esc = NV.esc;
  var R = NV.protocolo = {};
  var ANCHO = 960, PX_IMAGEN = 1920;

  function textoDeHtml(h) { var d = document.createElement('div'); d.innerHTML = h || ''; return (d.innerText || d.textContent || '').replace(/\s+/g, ' ').trim(); }

  // ---------- Armar el borrador desde el PDF: diapositivas EDITABLES ----------
  // Cada página: el fondo (formas y colores) es la página dibujada SIN texto ni fotos; los textos pasan a cuadros de texto
  // en su lugar (con su tamaño, color, negrita y alineación) y las fotos a imágenes que se pueden mover, cambiar o borrar.
  // Una página sin texto (escaneada) queda completa de fondo.
  var GENERICAS = /^(sans-serif|serif|monospace)$/i;
  function fuenteDe(nombre, familia) {
    var n = String(nombre || '').replace(/^[A-Z]{6}\+/, '').replace(/[-,](Bold|Italic|Regular|Light|Medium|Semibold|SemiBold|Black|Oblique|MT|PS).*$/i, '').replace(/MT$|PS$/, '');
    var lista = NV.FUENTES || [], k = n.toLowerCase().replace(/[^a-z]/g, '');
    var f = lista.filter(function(x) { var xk = x.n.toLowerCase().replace(/[^a-z]/g, ''); return k && (xk === k || k.indexOf(xk) === 0); })[0];
    if (f) return f.n;
    return /serif/i.test(familia || '') && !/sans/i.test(familia || '') ? 'Cambria' : 'Arial';
  }
  function dibujar(pg, vp, rects, conTexto) {
    // Dibuja la página sin fotos (las que se sacan aparte) y, si conTexto es false, también sin texto.
    var c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    var ctx = c.getContext('2d', {willReadFrequently: true}); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    if (!conTexto) { ctx.fillText = function() {}; ctx.strokeText = function() {}; }
    var di = ctx.drawImage.bind(ctx);
    ctx.drawImage = function(src) {
      var a = arguments, dx, dy, dw, dh;
      if (a.length >= 9) { dx = a[5]; dy = a[6]; dw = a[7]; dh = a[8]; } else if (a.length >= 5) { dx = a[1]; dy = a[2]; dw = a[3]; dh = a[4]; } else { dx = a[1]; dy = a[2]; dw = src.width; dh = src.height; }
      var m = ctx.getTransform(), xs = [], ys = [];
      [[dx, dy], [dx + dw, dy], [dx, dy + dh], [dx + dw, dy + dh]].forEach(function(p) { xs.push(m.a * p[0] + m.c * p[1] + m.e); ys.push(m.b * p[0] + m.d * p[1] + m.f); });
      var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
      var es = rects.some(function(r) { var t = Math.max(4, 0.03 * Math.max(r.w, r.h)); return Math.abs(x0 - r.x) < t && Math.abs(y0 - r.y) < t && Math.abs(x1 - (r.x + r.w)) < t && Math.abs(y1 - (r.y + r.h)) < t; });
      if (es) return;  // es una foto: va como imagen aparte
      return di.apply(null, a);
    };
    return pg.render({canvasContext: ctx, viewport: vp}).promise.then(function() { return c; });
  }
  function colorTexto(cCon, cSin, x, y, w, h) {
    // El color del texto: los píxeles que cambian entre la página con texto y sin texto (los más distintos).
    x = Math.max(0, Math.floor(x)); y = Math.max(0, Math.floor(y)); w = Math.min(cCon.width - x, Math.ceil(w)); h = Math.min(cCon.height - y, Math.ceil(h));
    if (w < 1 || h < 1) return null;
    var a = cCon.getContext('2d', {willReadFrequently: true}).getImageData(x, y, w, h).data, b = cSin.getContext('2d', {willReadFrequently: true}).getImageData(x, y, w, h).data, px = [];
    for (var i = 0; i < a.length; i += 4) {
      var d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      if (d > 90) px.push([d, a[i], a[i + 1], a[i + 2]]);
    }
    if (!px.length) return null;
    px.sort(function(p, q) { return q[0] - p[0]; });
    var top = px.slice(0, Math.max(1, Math.ceil(px.length * 0.35))), r = 0, g = 0, bl = 0;
    top.forEach(function(p) { r += p[1]; g += p[2]; bl += p[3]; });
    var hx = function(v) { return ('0' + Math.round(v / top.length).toString(16)).slice(-2); };
    return '#' + hx(r) + hx(g) + hx(bl);
  }
  function bloquesDeTexto(tc, pg, vp1) {
    var fuentes = {};
    tc.items.forEach(function(it) {
      if (!it.fontName || fuentes[it.fontName]) return;
      var nombre = ''; try { var fo = pg.commonObjs.get(it.fontName); nombre = (fo && (fo.name || fo.loadedName)) || ''; } catch (e) {}
      var fam = (tc.styles[it.fontName] || {}).fontFamily || '';
      fuentes[it.fontName] = {fuente: fuenteDe(nombre, fam), negrita: /bold|black|heavy|semibold|demi/i.test(nombre), cursiva: /italic|oblique/i.test(nombre)};
    });
    var items = tc.items.filter(function(it) { return it.str && it.str.trim() && Math.abs(it.transform[1]) < 0.01; }).map(function(it) {
      var t = it.transform, h = Math.hypot(t[2], t[3]) || Math.abs(t[3]) || 10;
      return {s: it.str, x: t[4], y: vp1.height - t[5], w: it.width, h: h, f: fuentes[it.fontName] || {fuente: 'Arial'}};
    });
    items.sort(function(a, b) { return Math.abs(a.y - b.y) < Math.min(a.h, b.h) * 0.5 ? a.x - b.x : a.y - b.y; });
    // líneas: misma base y sin un hueco grande entre palabras (un hueco grande separa columnas)
    var lineas = [];
    items.forEach(function(it) {
      var l = lineas.filter(function(x) { return Math.abs(x.y - it.y) < Math.min(x.h, it.h) * 0.5 && it.x - x.x1 < Math.max(x.h, it.h) * 1.6 && it.x - x.x1 > -x.h; }).pop();
      if (l) { l.items.push(it); l.x1 = Math.max(l.x1, it.x + it.w); l.h = Math.max(l.h, it.h); }
      else lineas.push({y: it.y, h: it.h, x0: it.x, x1: it.x + it.w, items: [it]});
    });
    lineas.sort(function(a, b) { return a.y - b.y || a.x0 - b.x0; });
    // bloques: líneas seguidas con el mismo tamaño de letra, poca separación y que se cruzan en horizontal
    var bloques = [];
    lineas.forEach(function(l) {
      var b = bloques.filter(function(x) {
        var u = x.lineas[x.lineas.length - 1], sep = l.y - u.y;
        return Math.abs(u.h - l.h) <= Math.max(1, l.h * 0.15) && sep > 0 && sep < l.h * 1.9 && l.x0 < x.x1 && l.x1 > x.x0;
      }).pop();
      if (b) { b.lineas.push(l); b.x0 = Math.min(b.x0, l.x0); b.x1 = Math.max(b.x1, l.x1); }
      else bloques.push({lineas: [l], x0: l.x0, x1: l.x1});
    });
    return bloques;
  }
  function htmlDeLinea(l) {
    var html = '', prev = null;
    l.items.forEach(function(it) {
      var t = esc(it.s);
      if (prev && it.x - (prev.x + prev.w) > it.h * 0.15 && !/\s$/.test(prev.s) && !/^\s/.test(it.s)) t = ' ' + t;
      if (it.f.negrita) t = '<b>' + t + '</b>';
      if (it.f.cursiva) t = '<i>' + t + '</i>';
      html += t; prev = it;
    });
    return '<p>' + html.replace(/<\/b><b>/g, '').replace(/<\/i><i>/g, '') + '</p>';
  }
  function presDesdePdf(pid, progreso) {
    return NV.lib.pdfjs().then(function(pdfjs) {
      return pdfjs.getDocument({url: '/design/api/protocolos/' + pid + '/pdf?a=' + Date.now(), isEvalSupported: false}).promise.then(function(pdf) { return {pdfjs: pdfjs, pdf: pdf}; });
    }).then(function(o) {
      var pdfjs = o.pdfjs, pdf = o.pdf;
      return pdf.getPage(1).then(function(p1) {
        var v1 = p1.getViewport({scale: 1}), alto = Math.round(ANCHO * v1.height / v1.width);
        var pres = P.nueva('office');
        pres.tam = {id: 'protocolo', n: 'Tamaño del protocolo', w: ANCHO, h: alto};
        pres.disenos = P.disenosBase(pres.tema, pres.tam);
        pres.diapositivas = [];
        var i = 0;
        var sig = function() {
          if (++i > pdf.numPages) return pres;
          if (progreso) progreso((i - 1) / pdf.numPages, 'Página ' + i + ' de ' + pdf.numPages);
          return pdf.getPage(i).then(function(pg) {
            var vp1 = pg.getViewport({scale: 1}), k = ANCHO / vp1.width, kPx = PX_IMAGEN / vp1.width, vp2 = pg.getViewport({scale: kPx});
            return Promise.all([pg.getTextContent(), pg.getOperatorList()]).then(function(r) {
              var tc = r[0], imgs = NV.pdf.extraerImagenes(pdfjs, pg, r[1], vp1, true);
              return Promise.all(imgs.map(function(im) { return im.url.then(function(u) { im.dataUrl = u; return im; }); })).then(function(lista) {
                lista = lista.filter(function(im) { return im.dataUrl && im.w > 6 && im.h > 6; });
                var rects = lista.map(function(im) { return {x: im.x * kPx, y: im.y * kPx, w: im.w * kPx, h: im.h * kPx}; });
                var bloques = bloquesDeTexto(tc, pg, vp1);
                return dibujar(pg, vp2, rects, false).then(function(cSin) {
                  return (bloques.length ? dibujar(pg, vp2, rects, true) : Promise.resolve(null)).then(function(cCon) {
                    var d = P.diapositivaDesdeDiseno(pres, 'blanco');
                    d.elementos = [];
                    d.fondo = {tipo: 'imagen', src: P.recursoEn(pres, cSin.toDataURL('image/jpeg', 0.88)), ajuste: 'contain'};
                    lista.forEach(function(im) {  // las fotos, en su lugar
                      d.elementos.push({id: P.uid(), tipo: 'imagen', x: im.x * k, y: im.y * k, w: im.w * k, h: im.h * k, rot: 0,
                                        src: P.recursoEn(pres, im.dataUrl), ajuste: 'fill', estilo: {}});
                    });
                    bloques.forEach(function(b) {  // los textos, en su lugar
                      var l0 = b.lineas[0], ln = b.lineas[b.lineas.length - 1], fs = l0.h;
                      var gap = b.lineas.length > 1 ? (ln.y - l0.y) / (b.lineas.length - 1) : fs * 1.2;
                      var top = l0.y - fs * 0.92, alto2 = (ln.y - l0.y) + fs * 1.25;
                      var cen = b.lineas.every(function(l) { return Math.abs((l.x0 + l.x1) / 2 - (b.x0 + b.x1) / 2) < fs * 0.6; }) && b.lineas.some(function(l) { return Math.abs(l.x0 - b.x0) > fs; });
                      var der = !cen && b.lineas.length > 1 && b.lineas.every(function(l) { return Math.abs(l.x1 - b.x1) < fs * 0.4; }) && b.lineas.some(function(l) { return Math.abs(l.x0 - b.x0) > fs; });
                      var color = cCon ? colorTexto(cCon, cSin, b.x0 * kPx, top * kPx, (b.x1 - b.x0) * kPx, alto2 * kPx) : null;
                      var holgura = (b.x1 - b.x0) * 0.08 + fs * 0.6;   // las letras de la web pueden ser un poco más anchas que las del PDF
                      d.elementos.push({id: P.uid(), tipo: 'texto', x: (b.x0 - (cen ? holgura / 2 : der ? holgura : 0)) * k, y: top * k,
                                        w: (b.x1 - b.x0 + holgura) * k, h: alto2 * k, rot: 0,
                                        html: b.lineas.map(htmlDeLinea).join(''),
                                        estilo: {fs: Math.round(fs * k * 10) / 10, fuente: l0.items[0].f.fuente, color: color || '#000000', align: cen ? 'center' : der ? 'right' : 'left',
                                                 valign: 'top', pad: 0, padH: 0, interlineado: Math.max(0.9, Math.min(2.5, Math.round(gap / fs * 100) / 100))}});
                    });
                    if (!bloques.length) d.textoPdf = tc.items.map(function(x) { return x.str; }).join(' ').replace(/\s+/g, ' ').trim();
                    pres.diapositivas.push(d);
                    cSin.width = cSin.height = 0; if (cCon) cCon.width = cCon.height = 0; pg.cleanup && pg.cleanup();
                  });
                });
              });
            });
          }).then(sig);
        };
        return sig();
      });
    });
  }
  function presDesdePptx() {
    return new Promise(function(ok, mal) {
      NV.dialogo({titulo: 'PowerPoint original del protocolo', ancho: 460,
        html: '<p style="margin:0 0 10px;line-height:1.5">Elige el archivo .pptx del protocolo (por ejemplo, exportado desde Zoho Show). Así todo el texto queda editable.</p>' +
              '<input type="file" id="nvPrPptx" accept=".pptx,.ppsx,.potx">',
        botones: [{texto: 'Usar este archivo', prim: true, accion: function(dlg) {
          var f = dlg.querySelector('#nvPrPptx').files[0];
          if (!f) { NV.toast('Elige un archivo .pptx.', true); return false; }
          return f;
        }}, {texto: 'Cancelar', valor: null}]
      }).then(function(f) {
        if (!f) { mal(new Error('cancelado')); return; }
        NV.cargando('Leyendo ' + f.name + '…');
        NV.leerArchivo(f).then(function(b) { return P.pptx.importar(b, function(x, t) { NV.cargando('Leyendo presentación… ' + t, x); }); }).then(ok, mal);
      });
    });
  }
  R.iniciar = function(pid, desde, reemplazar) {
    NV.cargando('Abriendo el protocolo…');
    return NV.api('/design/api/protocolos/' + pid + '/borrador').then(function(st) {
      if (st.docId && !reemplazar) return NV.api('/design/api/office/docs/' + st.docId).then(function(d) { NV.cargando(false); return P.abrir(d); });
      var armar = desde === 'pptx' ? (NV.cargando(false), presDesdePptx())
        : presDesdePdf(pid, function(x, t) { NV.cargando('Preparando las diapositivas… ' + t, x); });
      return armar.then(function(pres) {
        NV.cargando('Guardando el borrador…');
        return NV.api('/design/api/protocolos/' + pid + '/borrador', {json: {contenido: JSON.stringify(pres), reemplazar: !!reemplazar}});
      }).then(function(r) { return NV.api('/design/api/office/docs/' + r.docId); }).then(function(d) { NV.cargando(false); return P.abrir(d); });
    }).catch(function(e) {
      NV.cargando(false);
      if (e && e.message === 'cancelado') { NV.inicio.mostrar(); return; }
      NV.toast('No se pudo abrir el protocolo: ' + (e.message || e), true); NV.inicio.mostrar();
    });
  };

  // ---------- Banda del borrador ----------
  function pintarBanda() {
    var d = P.doc, banda = NV.$('#nvpBanda'); if (!d || !d.protocolo || !banda) return;
    var pr = d.protocolo;
    banda.classList.remove('nv-oculto'); banda.classList.add('nvp-banda-protocolo');
    banda.innerHTML = NV.icono('document_one_page', 'p') + '<span>Borrador del protocolo <b></b> · publicado: <b></b>. Los cambios se guardan solos; nadie los ve hasta que publiques.</span>' +
      '<button type="button" class="nv-btn prim" id="nvPrPublicar">Publicar nueva versión</button>' +
      '<a class="nv-btn" href="/design?panel=protocols" target="_blank" rel="noopener">Ver en Protocols</a>';
    var b = banda.querySelectorAll('b'); b[0].textContent = pr.titulo; b[1].textContent = pr.version;
    banda.querySelector('#nvPrPublicar').onclick = R.publicar;
  }
  var abrirOrig = P.abrir;
  P.abrir = function(d) {
    return abrirOrig(d).then(function() { var banda = NV.$('#nvpBanda'); if (banda) banda.classList.remove('nvp-banda-protocolo'); if (d.protocolo) pintarBanda(); });
  };

  // ---------- Publicar ----------
  // Texto de cada diapositiva publicada (las ocultas no van al PDF): el de la página original + el de los cuadros.
  R.textos = function(pres) {
    return pres.diapositivas.filter(function(s) { return !s.oculta; }).map(function(s) {
      var t = [s.textoPdf || ''];
      (s.elementos || []).forEach(function(e) { if (e.html) t.push(textoDeHtml(e.html)); });
      return t.join(' ').replace(/\s+/g, ' ').trim();
    });
  };
  function subir(blob, nombre, progreso) {
    return NV.api('/design/api/protocolos/subida', {json: {nombre: nombre, tamano: blob.size}}).then(function(r) {
      var parte = r.parte, offset = 0;
      var sig = function(intento) {
        if (offset >= blob.size) return r.archivoId;
        if (progreso) progreso(offset / blob.size);
        return fetch('/design/api/protocolos/subida/' + r.archivoId + '/parte?offset=' + offset, {method: 'POST', credentials: 'same-origin',
          headers: {'Content-Type': 'application/octet-stream'}, body: blob.slice(offset, offset + parte)})
          .then(function(x) { return x.json().then(function(j) { if (!x.ok) throw new Error(j.detail || 'No se pudo subir el PDF.'); return j; }); })
          .then(function(j) { offset = j.recibido; return sig(0); }, function(e) {
            if (intento < 3) return new Promise(function(ok) { setTimeout(ok, 1500 * (intento + 1)); }).then(function() { return sig(intento + 1); });
            throw e;
          });
      };
      return sig(0);
    });
  }
  R.publicar = function() {
    var pr = P.doc && P.doc.protocolo; if (!pr) return;
    if (!P.pres.diapositivas.some(function(s) { return !s.oculta; })) { NV.toast('No hay diapositivas visibles para publicar.', true); return; }
    NV.dialogo({titulo: 'Publicar nueva versión', ancho: 480,
      html: '<p style="margin:0 0 12px;line-height:1.5">El protocolo <b></b> quedará con este contenido para todos (las diapositivas ocultas no se publican). La versión anterior queda en el historial.</p>' +
            '<label class="nv-lbl" for="nvPrVer">Versión</label><input type="text" id="nvPrVer" maxlength="20" style="width:120px;margin:4px 0 12px">' +
            '<label class="nv-lbl" for="nvPrNota">¿Qué cambió? (opcional)</label><textarea id="nvPrNota" maxlength="500" rows="3" style="width:100%;box-sizing:border-box;margin-top:4px"></textarea>' +
            '<p id="nvPrEspacio" style="font-size:12px;color:#4b5563;margin:10px 0 0;line-height:1.4"></p>',
      alAbrir: function(dlg) {
        dlg.querySelector('b').textContent = pr.titulo; dlg.querySelector('#nvPrVer').value = pr.siguiente;
        NV.api('/design/api/protocolos/espacio').then(function(e) {  // cada versión guarda su PDF: se muestra el espacio usado
          var el = dlg.querySelector('#nvPrEspacio'); if (!el || e.baseBytes == null) return;
          var mb = function(x) { return (x / 1048576).toFixed(0) + ' MB'; };
          el.textContent = 'Base de datos: ' + mb(e.baseBytes) + ' usados (PDF de protocolos: ' + mb(e.pdfBytes) + '). Las versiones viejas se pueden borrar del historial en Protocols para liberar espacio.';
          if (e.baseBytes > 450 * 1048576) el.style.color = '#b91c1c';
        }).catch(function() {});
      },
      botones: [{texto: 'Publicar', prim: true, accion: function(dlg) {
        var v = dlg.querySelector('#nvPrVer').value.trim();
        if (!v) { NV.toast('Escribe la versión.', true); return false; }
        return {version: v, nota: dlg.querySelector('#nvPrNota').value.trim()};
      }}, {texto: 'Cancelar', valor: null}]
    }).then(function(op) {
      if (!op) return;
      var textos = R.textos(P.pres);
      NV.cargando('Guardando el borrador…');
      return P.guardar().then(function() {
        if (!P.est.guardado) throw new Error('El borrador no se pudo guardar. Revisa la conexión e intenta de nuevo.');
        return P.show.pdf(function(x, t) { NV.cargando('Creando el PDF… ' + t, x); }, false);
      }).then(function(blob) {
        NV.cargando('Subiendo el PDF…', 0);
        return subir(blob, pr.titulo + '.pdf', function(x) { NV.cargando('Subiendo el PDF…', x); });
      }).then(function(archivoId) {
        NV.cargando('Publicando…');
        return NV.api('/design/api/protocolos/' + pr.id + '/publicar', {json: {archivoId: archivoId, paginas: textos, version: op.version, nota: op.nota}});
      }).then(function(r) {
        NV.cargando(false);
        pr.version = r.version; pr.siguiente = R.siguiente(r.version); pintarBanda();
        NV.toast('Protocolo publicado: ' + r.titulo + ' ' + r.version + '.');
      }).catch(function(e) { NV.cargando(false); NV.toast('No se publicó: ' + (e.message || e), true); });
    });
  };
  R.siguiente = function(v) { var m = /^\s*v?(\d+)(?:\.(\d+))?/i.exec(v || ''); return m ? 'v' + (+m[1]) + '.' + ((+(m[2] || 0)) + 1) : 'v1.1'; };
})();
