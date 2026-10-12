/* Nuvia Office · Protocolos (pedido por Rosember el 12-oct-2026): editar un protocolo de Design y publicarlo.
   - /design/office?protocolo=ID&desde=pdf|pptx[&reemplazar=1]: arma el borrador (una diapositiva por página del PDF
     publicado, con la página de fondo; o el PowerPoint original) y lo abre. El borrador se guarda solo, como siempre.
   - Al abrir el borrador sale una banda con "Publicar nueva versión": exporta a PDF, lo sube por partes y lo deja como
     la versión vigente del protocolo (services_design_protocolos_edicion.py). Solo admins (los que editan Protocols). */
(function() {
  'use strict';
  var NV = window.NV, P = NV.ppt, esc = NV.esc;
  var R = NV.protocolo = {};
  var ANCHO = 960, PX_IMAGEN = 1920;

  function textoDeHtml(h) { var d = document.createElement('div'); d.innerHTML = h || ''; return (d.innerText || d.textContent || '').replace(/\s+/g, ' ').trim(); }

  // ---------- Armar el borrador ----------
  function presDesdePdf(pid, progreso) {
    return NV.lib.pdfjs().then(function(pdfjs) {
      return pdfjs.getDocument({url: '/design/api/protocolos/' + pid + '/pdf?a=' + Date.now(), isEvalSupported: false}).promise;
    }).then(function(pdf) {
      return pdf.getPage(1).then(function(p1) {
        var vp = p1.getViewport({scale: 1}), alto = Math.round(ANCHO * vp.height / vp.width);
        var pres = P.nueva('office');
        pres.tam = {id: 'protocolo', n: 'Tamaño del protocolo', w: ANCHO, h: alto};
        pres.disenos = P.disenosBase(pres.tema, pres.tam);
        pres.diapositivas = [];
        var i = 0;
        var sig = function() {
          if (++i > pdf.numPages) return pres;
          if (progreso) progreso((i - 1) / pdf.numPages, 'Página ' + i + ' de ' + pdf.numPages);
          return pdf.getPage(i).then(function(pg) {
            var v0 = pg.getViewport({scale: 1}), esc0 = PX_IMAGEN / v0.width, vp2 = pg.getViewport({scale: esc0});
            var c = document.createElement('canvas'); c.width = Math.round(vp2.width); c.height = Math.round(vp2.height);
            var ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
            return pg.render({canvasContext: ctx, viewport: vp2}).promise.then(function() { return pg.getTextContent(); }).then(function(tc) {
              var d = P.diapositivaDesdeDiseno(pres, 'blanco');
              d.elementos = [];
              d.fondo = {tipo: 'imagen', src: P.recursoEn(pres, c.toDataURL('image/jpeg', 0.86)), ajuste: 'contain'};
              d.textoPdf = tc.items.map(function(x) { return x.str; }).join(' ').replace(/\s+/g, ' ').trim();  // para el buscador al publicar
              pres.diapositivas.push(d);
              c.width = c.height = 0; pg.cleanup && pg.cleanup();
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
