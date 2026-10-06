/* Nuvia Office: utilidades compartidas (servidor, bibliotecas, íconos, menús, diálogos, descargas). */
(function() {
  'use strict';
  var NV = window.NV = window.NV || {};

  NV.esc = function(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  NV.$ = function(sel, raiz) { return (raiz || document).querySelector(sel); };
  NV.$$ = function(sel, raiz) { return Array.prototype.slice.call((raiz || document).querySelectorAll(sel)); };

  // ---------- Servidor ----------
  NV.api = function(url, opts) {
    opts = opts || {};
    var init = {method: opts.method || (opts.json !== undefined ? 'POST' : 'GET'), headers: {}, credentials: 'same-origin'};
    if (opts.json !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.json); }
    return fetch(url, init).catch(function() {
      throw new Error('Se perdió la conexión con el servidor. Revisa tu internet e intenta de nuevo.');
    }).then(function(r) {
      return r.text().then(function(t) {
        var d = null; try { d = t ? JSON.parse(t) : null; } catch (e) {}
        if (!r.ok) {
          var err = new Error((d && (typeof d.detail === 'string' ? d.detail : null)) || ('El servidor respondió con un error (' + r.status + ').'));
          err.status = r.status; err.datos = d; throw err;
        }
        return d;
      });
    });
  };

  // ---------- Bibliotecas (se cargan solo cuando se necesitan) ----------
  var scripts = {};
  NV.cargarScript = function(url) {
    if (!scripts[url]) scripts[url] = new Promise(function(ok, mal) {
      var s = document.createElement('script'); s.src = url; s.async = true;
      s.onload = function() { ok(); };
      s.onerror = function() { delete scripts[url]; mal(new Error('No se pudo cargar un componente (' + url.split('/').slice(-1)[0] + '). Revisa tu conexión.')); };
      document.head.appendChild(s);
    });
    return scripts[url];
  };
  var CDN = {
    tinymce: 'https://cdn.jsdelivr.net/npm/tinymce@7.9.3/tinymce.min.js',
    jszip: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
    docx: 'https://unpkg.com/docx@9.8.1/dist/index.umd.cjs',
    docxPreview: 'https://cdn.jsdelivr.net/npm/docx-preview@0.3.5/dist/docx-preview.min.js',
    pdfmake: 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.10/pdfmake.min.js',
    htmlToPdfmake: 'https://cdn.jsdelivr.net/npm/html-to-pdfmake@2.5.13/browser.js',
    pdfjs: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    pdfjsWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
    pdflib: 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js',
    pptxgen: 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js'
  };
  NV.CDN = CDN;
  NV.lib = {
    tinymce: function() { return NV.cargarScript(CDN.tinymce).then(function() { return window.tinymce; }); },
    jszip: function() { return NV.cargarScript(CDN.jszip).then(function() { return window.JSZip; }); },
    // docx (crear .docx) y docx-preview (leer .docx) usan el mismo nombre global "docx": se guarda cada uno aparte.
    docx: function() {
      if (NV._docxLib) return Promise.resolve(NV._docxLib);
      var previo = window.docx;
      return NV.cargarScript(CDN.docx).then(function() {
        if (!NV._docxLib) { NV._docxLib = window.docx; window.docx = previo; }
        return NV._docxLib;
      });
    },
    docxPreview: function() {
      if (NV._docxPreview) return Promise.resolve(NV._docxPreview);
      return NV.lib.jszip().then(function() {
        var previo = window.docx;
        return NV.cargarScript(CDN.docxPreview).then(function() {
          if (!NV._docxPreview) { NV._docxPreview = window.docx; window.docx = previo; }
          return NV._docxPreview;
        });
      });
    },
    pdfmake: function() {
      return NV.cargarScript(CDN.pdfmake).then(function() { return NV.cargarScript(CDN.htmlToPdfmake); })
        .then(function() { return {pdfMake: window.pdfMake, htmlToPdfmake: window.htmlToPdfmake}; });
    },
    pdfjs: function() {
      return NV.cargarScript(CDN.pdfjs).then(function() {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.pdfjsWorker; return window.pdfjsLib;
      });
    },
    pdflib: function() { return NV.cargarScript(CDN.pdflib).then(function() { return window.PDFLib; }); }
  };

  // ---------- Íconos (Fluent UI, MIT; ver iconos.js) ----------
  NV.icono = function(nombre, tam) {
    var svg = (window.NV_ICONOS || {})[nombre];
    var cls = 'nv-ic' + (tam === 'g' ? ' g' : tam === 'p' ? ' p' : '');
    if (!svg) return '<svg class="' + cls + '" viewBox="0 0 24 24"></svg>';
    return svg.replace('<svg ', '<svg class="' + cls + '" aria-hidden="true" ');
  };

  // ---------- Avisos ----------
  NV.toast = function(msg, error) {
    var t = document.createElement('div'); t.className = 'nv-toast' + (error ? ' error' : ''); t.setAttribute('role', error ? 'alert' : 'status');
    t.textContent = msg; document.body.appendChild(t);
    setTimeout(function() { t.remove(); }, error ? 7000 : 3500);
  };
  var cargaEl = null;
  NV.cargando = function(texto, progreso) {
    if (texto === false) { if (cargaEl) { cargaEl.remove(); cargaEl = null; } return; }
    if (!cargaEl) {
      cargaEl = document.createElement('div'); cargaEl.className = 'nv-cargando'; cargaEl.setAttribute('role', 'status');
      cargaEl.innerHTML = '<div class="nv-spin"></div><div class="t"></div><div class="nv-progreso nv-oculto"><div></div></div>';
      document.body.appendChild(cargaEl);
    }
    cargaEl.querySelector('.t').textContent = texto || 'Cargando…';
    var pr = cargaEl.querySelector('.nv-progreso');
    if (progreso == null) pr.classList.add('nv-oculto');
    else { pr.classList.remove('nv-oculto'); pr.firstChild.style.width = Math.round(progreso * 100) + '%'; }
  };

  // ---------- Diálogos ----------
  // NV.dialogo({titulo, html, ancho, botones:[{texto, prim, valor, accion(dlg) -> false para no cerrar}], alAbrir(dlg)}) -> Promise(valor)
  NV.dialogo = function(o) {
    return new Promise(function(resolver) {
      var fondo = document.createElement('div'); fondo.className = 'nv-fondo-dlg';
      var dlg = document.createElement('div'); dlg.className = 'nv-dlg'; dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-modal', 'true');
      if (o.ancho) dlg.style.width = o.ancho + 'px';
      var idT = 'nvdlg' + Math.random().toString(36).slice(2);
      dlg.setAttribute('aria-labelledby', idT);
      dlg.innerHTML = '<div class="nv-dlg-h"><span id="' + idT + '"></span><button type="button" aria-label="Cerrar">' + NV.icono('dismiss', 'p') + '</button></div>' +
        '<div class="nv-dlg-c"></div><div class="nv-dlg-p"></div>';
      dlg.querySelector('#' + idT).textContent = o.titulo || '';
      var c = dlg.querySelector('.nv-dlg-c'); c.innerHTML = o.html || '';
      var previo = document.activeElement;
      function cerrar(valor) {
        fondo.remove(); document.removeEventListener('keydown', tecla, true);
        try { if (previo && previo.focus) previo.focus(); } catch (e) {}
        resolver(valor);
      }
      var botones = o.botones || [{texto: 'Aceptar', prim: true, valor: true}];
      var pie = dlg.querySelector('.nv-dlg-p');
      botones.forEach(function(b) {
        var el = document.createElement('button'); el.type = 'button'; el.className = 'nv-btn' + (b.prim ? ' prim' : ''); el.textContent = b.texto;
        el.onclick = function() {
          var r = b.accion ? b.accion(dlg) : (b.valor !== undefined ? b.valor : true);
          if (r === false) return;
          if (r && typeof r.then === 'function') {
            el.disabled = true;
            r.then(function(v) { if (v !== false) cerrar(v === undefined ? true : v); else el.disabled = false; },
                   function(e) { el.disabled = false; NV.toast(e.message || String(e), true); });
            return;
          }
          cerrar(r);
        };
        pie.appendChild(el);
      });
      if (!botones.length) pie.remove();
      dlg.querySelector('.nv-dlg-h button').onclick = function() { cerrar(null); };
      function tecla(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(null); }
        else if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON' && !e.target.isContentEditable) {
          var prim = pie.querySelector('.nv-btn.prim'); if (prim) { e.preventDefault(); prim.click(); }
        }
      }
      document.addEventListener('keydown', tecla, true);
      fondo.appendChild(dlg); document.body.appendChild(fondo);
      fondo.addEventListener('mousedown', function(e) { if (e.target === fondo) fondo._abajo = true; });
      if (o.alAbrir) o.alAbrir(dlg, cerrar);
      setTimeout(function() {
        var f = c.querySelector('[autofocus], input, select, textarea') || pie.querySelector('.nv-btn.prim');
        if (f) { f.focus(); if (f.select && f.type === 'text') f.select(); }
      }, 30);
    });
  };
  NV.alerta = function(titulo, texto) {
    return NV.dialogo({titulo: titulo, html: '<p style="margin:0;line-height:1.5">' + NV.esc(texto).replace(/\n/g, '<br>') + '</p>'});
  };
  NV.confirmar = function(titulo, texto, si, no) {
    return NV.dialogo({titulo: titulo, html: '<p style="margin:0;line-height:1.5">' + NV.esc(texto).replace(/\n/g, '<br>') + '</p>',
      botones: [{texto: si || 'Aceptar', prim: true, valor: true}, {texto: no || 'Cancelar', valor: false}]}).then(function(v) { return !!v; });
  };
  NV.preguntar = function(titulo, etiqueta, valor) {
    return NV.dialogo({titulo: titulo, html: '<div class="nv-campo"><label for="nvPreg">' + NV.esc(etiqueta) + '</label><input type="text" id="nvPreg" value="' + NV.esc(valor || '') + '"></div>',
      botones: [{texto: 'Aceptar', prim: true, accion: function(d) { return d.querySelector('#nvPreg').value; }}, {texto: 'Cancelar', valor: null}]});
  };

  // ---------- Menús emergentes ----------
  // items: [{texto, icono, atajo, accion, on, deshabilitado, sep, titulo, html (nodo personalizado), sub}]
  var menuAbierto = null;
  NV.cerrarMenu = function() { if (menuAbierto) { menuAbierto.cerrar(); } };
  NV.menu = function(ancla, items, opts) {
    NV.cerrarMenu(); opts = opts || {};
    var m = document.createElement('div'); m.className = 'nv-menu'; m.setAttribute('role', 'menu');
    if (opts.ancho) m.style.minWidth = opts.ancho + 'px';
    items.forEach(function(it) {
      if (!it) return;
      if (it.sep) { var s = document.createElement('div'); s.className = 'nv-menu-sep'; m.appendChild(s); return; }
      if (it.titulo) { var t = document.createElement('div'); t.className = 'nv-menu-tit'; t.textContent = it.titulo; m.appendChild(t); return; }
      if (it.nodo) { m.appendChild(it.nodo); return; }
      var b = document.createElement('button'); b.type = 'button'; b.className = 'nv-menu-item' + (it.on ? ' on' : ''); b.setAttribute('role', 'menuitem');
      b.innerHTML = '<span class="ico">' + (it.icono && !it.on ? NV.icono(it.icono, 'p') : '') + '</span><span class="txt"></span>' +
        (it.atajo ? '<span class="atajo">' + NV.esc(it.atajo) + '</span>' : '') + (it.sub ? '<span class="atajo">›</span>' : '');
      b.querySelector('.txt').textContent = it.texto;
      if (it.estilo) b.querySelector('.txt').setAttribute('style', it.estilo);
      if (it.deshabilitado) b.disabled = true;
      b.onclick = function(e) {
        e.stopPropagation();
        if (it.sub) { NV.menu(b, it.sub, {lado: true, padre: menuAbierto}); return; }
        NV.cerrarMenu(); if (it.accion) it.accion();
      };
      m.appendChild(b);
    });
    document.body.appendChild(m);
    var r = ancla.getBoundingClientRect ? ancla.getBoundingClientRect() : {left: ancla.x, top: ancla.y, bottom: ancla.y, right: ancla.x, width: 0};
    var x = opts.lado ? r.right : r.left, y = opts.lado ? r.top : r.bottom + 2;
    var w = m.offsetWidth, h = m.offsetHeight;
    if (x + w > innerWidth - 4) x = Math.max(4, (opts.lado ? r.left - w : innerWidth - w - 4));
    if (y + h > innerHeight - 4) y = Math.max(4, (opts.lado ? innerHeight - h - 4 : r.top - h - 2));
    m.style.left = x + 'px'; m.style.top = y + 'px';
    var anterior = opts.padre || null;
    var obj = {el: m, cerrar: function() {
      m.remove(); document.removeEventListener('mousedown', fuera, true); document.removeEventListener('keydown', tecla, true);
      if (menuAbierto === obj) menuAbierto = null;
      if (anterior && !opts.mantenerPadre) anterior.cerrar();
    }};
    function fuera(e) { if (!m.contains(e.target) && !(anterior && anterior.el.contains(e.target)) && e.target !== ancla && !(ancla.contains && ancla.contains(e.target))) obj.cerrar(); }
    function tecla(e) {
      var botones = NV.$$('.nv-menu-item:not(:disabled)', m), i = botones.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); obj.cerrar(); if (ancla.focus) ancla.focus(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); (botones[i + 1] || botones[0]).focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); (botones[i - 1] || botones[botones.length - 1]).focus(); }
    }
    setTimeout(function() { document.addEventListener('mousedown', fuera, true); document.addEventListener('keydown', tecla, true); }, 0);
    if (anterior) { anterior.cerrar = (function(c) { return function() { obj.el.remove(); c(); }; })(anterior.cerrar); }
    menuAbierto = obj;
    if (opts.foco !== false) { var pb = m.querySelector('.nv-menu-item:not(:disabled)'); if (pb && opts.teclado) pb.focus(); }
    return obj;
  };

  // ---------- Archivos ----------
  NV.descargar = function(blob, nombre) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombre;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function() { URL.revokeObjectURL(a.href); }, 60000);
  };
  NV.nombreArchivo = function(titulo, ext) {
    return (String(titulo || 'Documento').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Documento') + '.' + ext;
  };
  NV.elegirArchivos = function(accept, multiple) {
    return new Promise(function(ok) {
      var i = document.createElement('input'); i.type = 'file'; i.accept = accept || ''; i.multiple = !!multiple; i.style.display = 'none';
      i.onchange = function() { ok(Array.prototype.slice.call(i.files || [])); i.remove(); };
      document.body.appendChild(i); i.click();
    });
  };
  NV.leerArchivo = function(f, como) {
    return new Promise(function(ok, mal) {
      var r = new FileReader(); r.onload = function() { ok(r.result); }; r.onerror = function() { mal(new Error('No se pudo leer el archivo.')); };
      if (como === 'texto') r.readAsText(f); else if (como === 'url') r.readAsDataURL(f); else r.readAsArrayBuffer(f);
    });
  };
  NV.extension = function(nombre) { var m = /\.([a-z0-9]+)$/i.exec(nombre || ''); return m ? m[1].toLowerCase() : ''; };
  NV.sinExtension = function(nombre) { return String(nombre || '').replace(/\.[a-z0-9]+$/i, ''); };
  // Reduce imágenes muy grandes (fotos de celular) para que el documento no pese de más.
  NV.imagenADataUrl = function(file, maxLado) {
    maxLado = maxLado || 1800;
    return NV.leerArchivo(file, 'url').then(function(url) {
      if (/^data:image\/(svg|gif)/.test(url)) return url;
      return new Promise(function(ok) {
        var img = new Image();
        img.onload = function() {
          var w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, maxLado / Math.max(w, h));
          if (k >= 1 && file.size < 1.5e6) { ok(url); return; }
          var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
          var ctx = c.getContext('2d');
          var png = /^data:image\/png/.test(url);
          if (!png) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
          ctx.drawImage(img, 0, 0, c.width, c.height);
          ok(c.toDataURL(png ? 'image/png' : 'image/jpeg', 0.9));
        };
        img.onerror = function() { ok(url); };
        img.src = url;
      });
    });
  };
  NV.dataUrlABytes = function(url) {
    var b64 = url.split(',')[1] || '', bin = atob(b64), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  };
  NV.fechaCorta = function(iso) {
    if (!iso) return '';
    var d = new Date(iso), hoy = new Date();
    if (d.toDateString() === hoy.toDateString()) return 'Hoy, ' + d.toLocaleTimeString('es-CO', {hour: 'numeric', minute: '2-digit'});
    var ayer = new Date(hoy); ayer.setDate(hoy.getDate() - 1);
    if (d.toDateString() === ayer.toDateString()) return 'Ayer, ' + d.toLocaleTimeString('es-CO', {hour: 'numeric', minute: '2-digit'});
    return d.toLocaleDateString('es-CO', {day: 'numeric', month: 'short', year: 'numeric'});
  };
  NV.tamano = function(b) { return b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round((b || 0) / 1024)) + ' KB'; };
  NV.iniciales = function(n) { return String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(function(p) { return p[0]; }).join('').toUpperCase(); };

  // ---------- Fuentes: nombres de Office con su equivalente libre (misma métrica) para pantalla y PDF ----------
  NV.FUENTES = [
    {n: 'Calibri', css: 'Calibri, Carlito, sans-serif', pdf: 'Carlito'},
    {n: 'Calibri Light', css: '"Calibri Light", Carlito, sans-serif', pdf: 'Carlito'},
    {n: 'Cambria', css: 'Cambria, Caladea, serif', pdf: 'Caladea'},
    {n: 'Aptos', css: 'Aptos, "Open Sans", sans-serif', pdf: 'OpenSans'},
    {n: 'Arial', css: 'Arial, Arimo, Helvetica, sans-serif', pdf: 'Arimo'},
    {n: 'Arial Black', css: '"Arial Black", Arimo, sans-serif', pdf: 'Arimo', negrita: true},
    {n: 'Book Antiqua', css: '"Book Antiqua", Palatino, Gelasio, serif', pdf: 'Gelasio'},
    {n: 'Century Gothic', css: '"Century Gothic", Montserrat, sans-serif', pdf: 'Montserrat'},
    {n: 'Comic Sans MS', css: '"Comic Sans MS", "Comic Neue", cursive', pdf: 'Arimo'},
    {n: 'Courier New', css: '"Courier New", Cousine, monospace', pdf: 'Cousine'},
    {n: 'Garamond', css: 'Garamond, Gelasio, serif', pdf: 'Gelasio'},
    {n: 'Georgia', css: 'Georgia, Gelasio, serif', pdf: 'Gelasio'},
    {n: 'Gill Sans MT', css: '"Gill Sans MT", "Gill Sans", Lato, sans-serif', pdf: 'Lato'},
    {n: 'Helvetica', css: 'Helvetica, Arimo, Arial, sans-serif', pdf: 'Arimo'},
    {n: 'Lato', css: 'Lato, sans-serif', pdf: 'Lato'},
    {n: 'Montserrat', css: 'Montserrat, sans-serif', pdf: 'Montserrat'},
    {n: 'Open Sans', css: '"Open Sans", sans-serif', pdf: 'OpenSans'},
    {n: 'Roboto', css: 'Roboto, sans-serif', pdf: 'Roboto'},
    {n: 'Segoe UI', css: '"Segoe UI", "Open Sans", sans-serif', pdf: 'OpenSans'},
    {n: 'Tahoma', css: 'Tahoma, Arimo, sans-serif', pdf: 'Arimo'},
    {n: 'Times New Roman', css: '"Times New Roman", Tinos, Times, serif', pdf: 'Tinos'},
    {n: 'Trebuchet MS', css: '"Trebuchet MS", "Open Sans", sans-serif', pdf: 'OpenSans'},
    {n: 'Tw Cen MT', css: '"Tw Cen MT", Montserrat, sans-serif', pdf: 'Montserrat'},
    {n: 'Verdana', css: 'Verdana, "Open Sans", sans-serif', pdf: 'OpenSans'}
  ];
  NV.fuentePorNombre = function(n) {
    n = String(n || '').split(',')[0].replace(/["']/g, '').trim().toLowerCase();
    for (var i = 0; i < NV.FUENTES.length; i++) if (NV.FUENTES[i].n.toLowerCase() === n) return NV.FUENTES[i];
    var libres = {carlito: 'Calibri', caladea: 'Cambria', arimo: 'Arial', tinos: 'Times New Roman', cousine: 'Courier New', gelasio: 'Georgia'};
    if (libres[n]) return NV.fuentePorNombre(libres[n]);
    return null;
  };
  NV.cssFuente = function(n) { var f = NV.fuentePorNombre(n); return f ? f.css : (n ? '"' + n + '", sans-serif' : 'Calibri, Carlito, sans-serif'); };
  NV.FUENTES_GOOGLE = 'https://fonts.googleapis.com/css2?family=Carlito:ital,wght@0,400;0,700;1,400;1,700&family=Caladea:ital,wght@0,400;0,700;1,400;1,700' +
    '&family=Arimo:ital,wght@0,400;0,700;1,400;1,700&family=Tinos:ital,wght@0,400;0,700;1,400;1,700&family=Cousine:ital,wght@0,400;0,700;1,400;1,700' +
    '&family=Gelasio:ital,wght@0,400;0,700;1,400;1,700&family=Roboto:ital,wght@0,400;0,700;1,400;1,700&family=Open+Sans:ital,wght@0,400;0,700;1,400;1,700' +
    '&family=Lato:ital,wght@0,400;0,700;1,400;1,700&family=Montserrat:ital,wght@0,400;0,700;1,400;1,700&family=Comic+Neue:wght@400;700&display=swap';

  // Unidades
  NV.cmAPx = function(cm) { return cm * 96 / 2.54; };
  NV.pxACm = function(px) { return px * 2.54 / 96; };
  NV.ptAPx = function(pt) { return pt * 96 / 72; };
  NV.pxAPt = function(px) { return px * 72 / 96; };
  // Convierte un largo CSS (px, pt, cm, mm, in, em) a puntos.
  NV.aPt = function(v, base) {
    if (v == null || v === '') return null;
    var m = /^(-?[\d.]+)\s*(px|pt|cm|mm|in|em|rem|%)?$/.exec(String(v).trim());
    if (!m) return null;
    var n = parseFloat(m[1]), u = m[2] || 'px';
    return u === 'pt' ? n : u === 'px' ? n * 0.75 : u === 'cm' ? n * 72 / 2.54 : u === 'mm' ? n * 72 / 25.4 : u === 'in' ? n * 72 :
      (u === 'em' || u === 'rem') ? n * (base || 11) : u === '%' ? n / 100 * (base || 11) : null;
  };
})();
