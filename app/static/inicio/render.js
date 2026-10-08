/* Página de Inicio de Design: dibuja la página (secciones, columnas, posición libre y bloques).
   Se usa para verla publicada y dentro del editor (modo 'editar' agrega marcas para seleccionar y arrastrar). */
(function() {
  'use strict';
  var NVI = window.NVI = window.NVI || {};

  // ---------- Utilidades ----------
  NVI.uid = function(p) { return (p || 'x') + Math.random().toString(36).slice(2, 9); };
  NVI.esc = function(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  NVI.clon = function(o) { return JSON.parse(JSON.stringify(o)); };
  NVI.src = function(s) {
    s = String(s || '').trim();
    if (/^medio:\d+$/.test(s)) return '/design/inicio/medio/' + s.slice(6);
    if (/^(https:\/\/|data:image\/|\/)/.test(s)) return s;
    return '';
  };
  NVI.url = function(u) {
    u = String(u || '').trim();
    if (!u) return '';
    if (/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(u)) return u;
    return 'https://' + u;
  };
  // HTML del texto enriquecido: solo etiquetas y estilos seguros
  var ETIQ = {P: 1, BR: 1, B: 1, STRONG: 1, I: 1, EM: 1, U: 1, S: 1, A: 1, UL: 1, OL: 1, LI: 1, SPAN: 1, DIV: 1, H2: 1, H3: 1, H4: 1, BLOCKQUOTE: 1, SUB: 1, SUP: 1};
  var ESTILOS = ['color', 'background-color', 'font-size', 'font-weight', 'font-style', 'text-decoration', 'text-align', 'font-family'];
  NVI.limpiar = function(html) {
    var t = document.createElement('template'); t.innerHTML = String(html || '');
    (function rec(n) {
      Array.prototype.slice.call(n.childNodes).forEach(function(c) {
        if (c.nodeType === 3) return;
        if (c.nodeType !== 1 || !ETIQ[c.nodeName]) {
          if (c.nodeType === 1 && !/^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED)$/.test(c.nodeName)) { rec(c); while (c.firstChild) n.insertBefore(c.firstChild, c); }
          n.removeChild(c); return;
        }
        Array.prototype.slice.call(c.attributes).forEach(function(a) {
          var nm = a.name.toLowerCase();
          if (nm === 'style') {
            var st = c.style, nuevo = ESTILOS.map(function(p) { var v = st.getPropertyValue(p); return v && !/url\(|expression/i.test(v) ? p + ':' + v : ''; }).filter(Boolean).join(';');
            if (nuevo) c.setAttribute('style', nuevo); else c.removeAttribute('style');
          } else if (nm === 'href' && c.nodeName === 'A') {
            var h = NVI.url(a.value); if (!h || /^javascript:/i.test(h)) c.removeAttribute('href'); else c.setAttribute('href', h);
          } else if (nm !== 'target') c.removeAttribute(a.name);
        });
        if (c.nodeName === 'A') { c.setAttribute('rel', 'noopener'); if (c.getAttribute('target') !== '_self') c.setAttribute('target', '_blank'); }
        rec(c);
      });
    })(t.content);
    return t.innerHTML;
  };
  NVI.video = function(src, o) {
    o = o || {}; src = String(src || '').trim();
    var q = function(extra) { var p = []; if (o.autoplay) p.push('autoplay=1'); if (o.silencio || o.autoplay) p.push('mute=1', 'muted=1'); if (o.repetir) p.push('loop=1'); if (o.controles === false) p.push('controls=0'); return (extra || []).concat(p).join('&'); };
    var m = src.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{6,})/);
    if (m) return {tipo: 'iframe', url: 'https://www.youtube-nocookie.com/embed/' + m[1] + '?' + q(['rel=0', 'modestbranding=1'].concat(o.repetir ? ['playlist=' + m[1]] : []))};
    m = src.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    if (m) return {tipo: 'iframe', url: 'https://player.vimeo.com/video/' + m[1] + '?' + q(['dnt=1'])};
    if (/^medio:\d+$/.test(src) || /\.(mp4|m4v|webm|mov|ogv|ogg)(\?|$)/i.test(src)) return {tipo: 'video', url: NVI.src(src) || src};
    if (/^https:\/\//.test(src)) return {tipo: 'iframe', url: src};
    return null;
  };
  var FUENTES = ['Inter', 'Poppins', 'Montserrat', 'Lato', 'Roboto', 'Open Sans', 'Nunito', 'Raleway', 'Playfair Display', 'Merriweather', 'Oswald', 'DM Sans', 'Bebas Neue', 'Creepster', 'Mountains of Christmas'];
  // letras decorativas que solo traen uno o dos grosores: se piden sin la lista de grosores (si no, Google las rechaza)
  var DECORATIVAS = {'Bebas Neue': '', 'Creepster': '', 'Mountains of Christmas': ':wght@400;700'};
  NVI.FUENTES = FUENTES;
  var cargadas = {};
  NVI.cargarFuente = function(f) {
    if (!f || cargadas[f] || FUENTES.indexOf(f) < 0) return;
    cargadas[f] = 1;
    var l = document.createElement('link'); l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(f).replace(/%20/g, '+') + (f in DECORATIVAS ? DECORATIVAS[f] : ':ital,wght@0,300;0,400;0,600;0,700;0,800;1,400') + '&display=swap';
    document.head.appendChild(l);
  };
  // Paleta de Nuvia: azul noche #1a1449, índigo #252772 y azul claro #2f98d5
  NVI.PALETA = {noche: '#1a1449', indigo: '#252772', azul: '#2f98d5', azulSuave: '#e8f4fb', indigoSuave: '#eef0fa'};
  NVI.TEMA_BASE = {fuenteTitulos: 'Poppins', fuenteTexto: 'Inter', primario: '#252772', secundario: '#1a1449', acento: '#2f98d5', fondo: '#ffffff', texto: '#1a1449', radio: 14};
  function h(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  NVI.h = h;
  NVI.placeholder = function(texto, c1, c2) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + (c1 || '#2f98d5') + '"/><stop offset="1" stop-color="' + (c2 || '#252772') + '"/></linearGradient></defs>' +
      '<rect width="1200" height="700" fill="url(#g)"/><g fill="#fff" opacity=".9"><circle cx="460" cy="290" r="46"/><path d="M300 520l170-170 120 120 90-90 220 140z"/></g>' +
      '<text x="600" y="610" font-family="Arial" font-size="40" fill="#fff" text-anchor="middle" opacity=".95">' + NVI.esc(texto || 'Imagen de ejemplo') + '</text></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  };

  // Encuadre de una foto: qué parte se ve (x, y en %) y cuánto se acerca (z). Se guarda junto a la foto como <campo>Enc.
  NVI.enc = function(e) {
    e = e || {}; var x = isFinite(+e.x) && e.x !== '' && e.x != null ? Math.max(0, Math.min(100, +e.x)) : 50, y = isFinite(+e.y) && e.y !== '' && e.y != null ? Math.max(0, Math.min(100, +e.y)) : 50;
    return {x: x, y: y, z: Math.max(1, Math.min(4, +e.z || 1)), pos: x + '% ' + y + '%'};
  };
  NVI.aplicarEnc = function(el, e, fondo) {
    var q = NVI.enc(e);
    if (fondo) el.style.backgroundPosition = q.pos; else el.style.objectPosition = q.pos;
    el.classList.add('nvi-enc'); el.style.setProperty('--nvi-z', q.z); el.style.setProperty('--nvi-o', q.pos);
    return q;
  };

  // ---------- Bloques ----------
  // Cada bloque: n (nombre), ic (ícono), d() (valores por defecto), campos (para el panel del editor), r(p, ctx) → elemento
  var D = NVI.BLOQUES = {};
  var ALINEAR = {tipo: 'select', k: 'alinear', l: 'Alineación', ops: [['left', 'Izquierda'], ['center', 'Centro'], ['right', 'Derecha']]};
  D.titulo = {n: 'Título', ic: 'H', g: 'Texto',
    d: function() { return {html: 'Escribe un título', nivel: 'h2', tamano: 0, color: '', alinear: 'left', peso: '700'}; },
    campos: [{tipo: 'select', k: 'nivel', l: 'Tipo', ops: [['h1', 'Título principal (H1)'], ['h2', 'Título (H2)'], ['h3', 'Subtítulo (H3)'], ['h4', 'Subtítulo pequeño (H4)']]},
      {tipo: 'numero', k: 'tamano', l: 'Tamaño (px, 0 = automático)', min: 0, max: 120}, {tipo: 'select', k: 'peso', l: 'Grosor', ops: [['400', 'Normal'], ['600', 'Seminegrita'], ['700', 'Negrita'], ['800', 'Extra negrita']]},
      {tipo: 'color', k: 'color', l: 'Color'}, ALINEAR],
    r: function(p) { var e = h(p.nivel || 'h2', 'nvi-titulo nvi-rich', NVI.limpiar(p.html)); e.style.textAlign = p.alinear; e.style.fontWeight = p.peso || ''; if (p.color) e.style.color = p.color; if (+p.tamano) e.style.fontSize = p.tamano + 'px'; return e; }};
  D.texto = {n: 'Texto', ic: '¶', g: 'Texto',
    d: function() { return {html: '<p>Escribe aquí el texto. Haz doble clic para editarlo y usa la barra para dar formato.</p>', tamano: 0, color: '', alinear: 'left', interlineado: 1.6}; },
    campos: [{tipo: 'numero', k: 'tamano', l: 'Tamaño (px, 0 = automático)', min: 0, max: 60}, {tipo: 'numero', k: 'interlineado', l: 'Interlineado', min: 1, max: 3, paso: 0.1}, {tipo: 'color', k: 'color', l: 'Color'}, ALINEAR],
    r: function(p) { var e = h('div', 'nvi-texto nvi-rich', NVI.limpiar(p.html)); e.style.textAlign = p.alinear; if (p.color) e.style.color = p.color; if (+p.tamano) e.style.fontSize = p.tamano + 'px'; e.style.lineHeight = p.interlineado || 1.6; return e; }};
  D.imagen = {n: 'Imagen', ic: '🖼', g: 'Medios',
    d: function() { return {src: NVI.placeholder('Tu imagen'), alt: '', ancho: 100, alto: 0, proporcion: '', ajuste: 'cover', radio: 12, sombra: false, enlace: '', pie: '', alinear: 'center', ampliar: true}; },
    campos: [{tipo: 'medio', k: 'src', l: 'Imagen', acepta: 'imagen', encuadre: true}, {tipo: 'texto', k: 'alt', l: 'Descripción (accesibilidad)'}, {tipo: 'rango', k: 'ancho', l: 'Ancho (%)', min: 10, max: 100},
      {tipo: 'select', k: 'proporcion', l: 'Forma', ops: [['', 'Original'], ['16/9', 'Horizontal 16:9'], ['4/3', 'Horizontal 4:3'], ['1/1', 'Cuadrada'], ['3/4', 'Vertical 3:4'], ['9/16', 'Vertical 9:16']]},
      {tipo: 'numero', k: 'alto', l: 'Alto (px, 0 = automático)', min: 0, max: 1200}, {tipo: 'select', k: 'ajuste', l: 'Ajuste', ops: [['cover', 'Rellenar (recorta)'], ['contain', 'Completa']]},
      {tipo: 'numero', k: 'radio', l: 'Esquinas redondeadas (px)', min: 0, max: 200}, {tipo: 'check', k: 'sombra', l: 'Sombra'}, {tipo: 'texto', k: 'pie', l: 'Pie de foto'},
      {tipo: 'select', k: 'efecto', l: 'Efecto de la foto', ops: [['', 'Ninguno'], ['zoom', 'Acercar al pasar el mouse'], ['lento', 'Zoom lento continuo'], ['brillo', 'Destello al pasar el mouse'],
        ['confeti', '🎉 Confeti que sale de la foto'], ['globos', '🎈 Globos que salen de detrás'], ['brillos', '✨ Brillos dorados alrededor']]},
      {tipo: 'url', k: 'enlace', l: 'Enlace al hacer clic (opcional)'}, {tipo: 'check', k: 'ampliar', l: 'Ampliar al hacer clic (si no tiene enlace)'}, ALINEAR],
    r: function(p, ctx) {
      var f = h('figure', 'nvi-imagen'); f.style.textAlign = p.alinear;
      var img = h('img'); img.src = NVI.src(p.src) || NVI.placeholder(); img.alt = p.alt || ''; img.loading = 'lazy';
      img.style.width = (p.ancho || 100) + '%'; img.style.borderRadius = (p.radio || 0) + 'px'; img.setAttribute('data-enc', 'src');
      if (+p.alto) { img.style.height = p.alto + 'px'; img.style.objectFit = p.ajuste || 'cover'; }
      else if (p.proporcion) { img.style.aspectRatio = p.proporcion; img.style.objectFit = p.ajuste || 'cover'; }
      var q = NVI.aplicarEnc(img, p.srcEnc);
      if (p.sombra) img.style.boxShadow = '0 12px 30px rgba(15,23,42,.18)';
      // con efecto, la foto va dentro de un marco que recorta el zoom
      var FIESTA = {confeti: 1, globos: 1, brillos: 1}, fiesta = FIESTA[p.efecto];
      if ((p.efecto && !fiesta) || q.z > 1) { var mv = h('span', 'nvi-img-mv' + (p.efecto && !fiesta ? ' nvi-img-' + p.efecto : '')); mv.style.width = img.style.width; mv.style.borderRadius = img.style.borderRadius; mv.style.boxShadow = img.style.boxShadow; img.style.width = '100%'; img.style.boxShadow = ''; mv.appendChild(img); }
      var nodo = mv || img;
      if (p.enlace && ctx.modo !== 'editar') { var a = h('a'); a.href = NVI.url(p.enlace); if (!/^\//.test(a.getAttribute('href'))) { a.target = '_blank'; a.rel = 'noopener'; } a.appendChild(nodo); nodo = a; }
      else if (p.ampliar && ctx.modo !== 'editar') { img.style.cursor = 'zoom-in'; img.onclick = function() { NVI.lightbox([{src: img.src, titulo: p.pie}], 0); }; }
      // celebración: la foto va en un contenedor que deja salir el confeti o los globos por fuera
      if (fiesta) { var fx = h('span', 'nvi-img-fx'); fx.style.width = (mv || img).style.width; (mv || img).style.width = '100%'; fx.appendChild(nodo); nodo = fx; if (ctx.modo !== 'editar' && NVI.fx) NVI.fx.foto(fx, p.efecto); }
      f.appendChild(nodo);
      if (p.pie) f.appendChild(h('figcaption', '', NVI.esc(p.pie)));
      return f;
    }};
  D.botones = {n: 'Botones', ic: '▭', g: 'Texto',
    d: function() { return {items: [{texto: 'Ir a Design Schedule', url: '/design', estilo: 'solido', nueva: false}], alinear: 'left', tamano: 'm'}; },
    campos: [{tipo: 'lista', k: 'items', l: 'Botones', nuevo: {texto: 'Botón', url: '', estilo: 'solido', nueva: false}, titulo: 'texto',
      campos: [{tipo: 'texto', k: 'texto', l: 'Texto'}, {tipo: 'url', k: 'url', l: 'Enlace'}, {tipo: 'select', k: 'estilo', l: 'Estilo', ops: [['solido', 'Sólido'], ['borde', 'Con borde'], ['suave', 'Suave'], ['blanco', 'Blanco'], ['enlace', 'Solo texto']]}, {tipo: 'check', k: 'nueva', l: 'Abrir en otra pestaña'}]},
      {tipo: 'select', k: 'tamano', l: 'Tamaño', ops: [['s', 'Pequeño'], ['m', 'Mediano'], ['l', 'Grande']]}, ALINEAR],
    r: function(p, ctx) {
      var w = h('div', 'nvi-botones nvi-t-' + (p.tamano || 'm')); w.style.justifyContent = {left: 'flex-start', center: 'center', right: 'flex-end'}[p.alinear] || 'flex-start';
      (p.items || []).forEach(function(b) { var a = h('a', 'nvi-btn nvi-btn-' + (b.estilo || 'solido'), NVI.esc(b.texto || 'Botón')); if (ctx.modo !== 'editar') { a.href = NVI.url(b.url) || '#'; if (b.nueva) { a.target = '_blank'; a.rel = 'noopener'; } } w.appendChild(a); });
      return w;
    }};
  D.video = {n: 'Video', ic: '▶', g: 'Medios',
    d: function() { return {src: '', proporcion: '16/9', autoplay: false, silencio: false, repetir: false, controles: true, radio: 14, portada: ''}; },
    campos: [{tipo: 'medio', k: 'src', l: 'Video: enlace (YouTube, Vimeo, WorkDrive) o archivo (MP4, WEBM, MOV u OGG)', acepta: 'video', permiteUrl: true},
      {tipo: 'select', k: 'proporcion', l: 'Proporción', ops: [['16/9', 'Panorámico 16:9'], ['4/3', 'Clásico 4:3'], ['1/1', 'Cuadrado'], ['9/16', 'Vertical 9:16']]},
      {tipo: 'check', k: 'autoplay', l: 'Reproducir solo (sin sonido)'}, {tipo: 'check', k: 'repetir', l: 'Repetir'}, {tipo: 'check', k: 'controles', l: 'Mostrar controles'},
      {tipo: 'numero', k: 'radio', l: 'Esquinas redondeadas (px)', min: 0, max: 60}, {tipo: 'medio', k: 'portada', l: 'Imagen de portada (solo videos subidos)', acepta: 'imagen'}],
    r: function(p, ctx) {
      var w = h('div', 'nvi-video'); w.style.aspectRatio = p.proporcion || '16/9'; w.style.borderRadius = (p.radio || 0) + 'px';
      var v = NVI.video(p.src, p);
      if (!v) { w.classList.add('vacio'); w.innerHTML = '<span>▶</span><small>Pega el enlace del video o sube un archivo de video</small>'; return w; }
      if (v.tipo === 'video') { var el = h('video'); el.src = v.url; el.controls = p.controles !== false; el.playsInline = true; el.preload = 'metadata'; if (p.autoplay && ctx.modo !== 'editar') { el.autoplay = true; el.muted = true; } if (p.repetir) el.loop = true; if (p.portada) el.poster = NVI.src(p.portada); w.appendChild(el); }
      else { var f = h('iframe'); f.src = v.url; f.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media'; f.allowFullscreen = true; f.loading = 'lazy'; f.title = 'Video'; w.appendChild(f); if (ctx.modo === 'editar') w.appendChild(h('div', 'nvi-tapa')); }
      return w;
    }};
  D.carrusel = {n: 'Carrusel', ic: '⇆', g: 'Medios',
    d: function() { return {items: [{src: NVI.placeholder('Diapositiva 1', '#2f98d5', '#1a1449'), titulo: 'Bienvenidos a Design', texto: 'Escribe un mensaje para esta imagen', enlace: ''},
      {src: NVI.placeholder('Diapositiva 2', '#252772', '#1a1449'), titulo: 'Logros del equipo', texto: '', enlace: ''}, {src: NVI.placeholder('Diapositiva 3', '#2f98d5', '#252772'), titulo: 'Novedades', texto: '', enlace: ''}],
      estilo: '', visibles: 1, velocidad: 'normal', alto: 420, intervalo: 5, efecto: 'deslizar', flechas: true, puntos: true, oscurecer: 35, radio: 16, ajuste: 'cover'}; },
    campos: [{tipo: 'lista', k: 'items', l: 'Diapositivas', titulo: 'titulo', masivo: 'src', nuevo: {src: '', titulo: '', texto: '', enlace: ''},
      campos: [{tipo: 'medio', k: 'src', l: 'Imagen', acepta: 'imagen', encuadre: true}, {tipo: 'texto', k: 'titulo', l: 'Título'}, {tipo: 'area', k: 'texto', l: 'Texto'}, {tipo: 'url', k: 'enlace', l: 'Enlace (opcional)'}]},
      {tipo: 'select', k: 'estilo', l: 'Estilo del carrusel', ops: [['', 'Clásico'], ['coverflow', 'Cover Flow 3D (Apple)'], ['tira', 'Foto grande + tira de miniaturas'], ['fluye', 'Fila que fluye (efecto Dock)']]},
      {tipo: 'numero', k: 'visibles', l: 'Fotos visibles a la vez', min: 1, max: 8, si: ['estilo', ['', 'fluye']]},
      {tipo: 'select', k: 'velocidad', l: 'Velocidad', ops: [['lenta', 'Lenta'], ['normal', 'Normal'], ['rapida', 'Rápida']], si: ['estilo', ['fluye']]},
      {tipo: 'numero', k: 'alto', l: 'Alto (px)', min: 150, max: 1000}, {tipo: 'numero', k: 'intervalo', l: 'Cambiar cada (segundos, 0 = manual)', min: 0, max: 30, si: ['estilo', ['', 'coverflow', 'tira']]},
      {tipo: 'select', k: 'efecto', l: 'Efecto', ops: [['deslizar', 'Deslizar'], ['fundido', 'Fundido']], si: ['estilo', ['']]}, {tipo: 'rango', k: 'oscurecer', l: 'Oscurecer la imagen (%) para leer el texto', min: 0, max: 80, si: ['estilo', ['', 'tira']]},
      {tipo: 'select', k: 'ajuste', l: 'Ajuste', ops: [['cover', 'Rellenar (recorta)'], ['contain', 'Completa']], si: ['estilo', ['']]}, {tipo: 'numero', k: 'radio', l: 'Esquinas redondeadas (px)', min: 0, max: 60},
      {tipo: 'check', k: 'flechas', l: 'Flechas', si: ['estilo', ['', 'coverflow']]}, {tipo: 'check', k: 'puntos', l: 'Puntos', si: ['estilo', ['', 'coverflow']]}, {tipo: 'check', k: 'zoomLento', l: 'Zoom lento en las fotos', si: ['estilo', ['', 'tira']]}],
    r: function(p, ctx) {
      if (p.estilo && NVI.CARRUSELES && NVI.CARRUSELES[p.estilo]) return NVI.CARRUSELES[p.estilo](p, ctx);
      var items = p.items && p.items.length ? p.items : [{src: NVI.placeholder('Agrega diapositivas')}];
      // varias fotos a la vez (solo al deslizar): cada una ocupa su parte del ancho
      var vis = p.efecto === 'fundido' ? 1 : Math.max(1, Math.min(8, items.length, +p.visibles || 1)), GAP = 12;
      var w = h('div', 'nvi-carrusel nvi-ef-' + (p.efecto || 'deslizar') + (vis > 1 ? ' nvi-car-varias' : '')); w.style.height = (p.alto || 420) + 'px'; w.style.borderRadius = (p.radio || 0) + 'px';
      var pista = h('div', 'nvi-car-pista'); w.appendChild(pista);
      items.forEach(function(it, i) {
        var s = h('div', 'nvi-car-slide' + (i ? '' : ' on')), fo = s; if (vis > 1) { s.style.width = 'calc((100% - ' + (vis - 1) * GAP + 'px) / ' + vis + ')'; s.style.borderRadius = Math.min(14, p.radio || 0) + 'px'; s.style.overflow = 'hidden'; }
        if (p.zoomLento || NVI.enc(it.srcEnc).z > 1) { fo = h('div', 'nvi-car-fondo' + (p.zoomLento ? ' lento' : '')); s.appendChild(fo); }
        NVI.aplicarEnc(fo, it.srcEnc, true); s.setAttribute('data-enc', 'items.' + i + '.src');
        fo.style.backgroundImage = 'url("' + (NVI.src(it.src) || NVI.placeholder()).replace(/"/g, '%22') + '")'; fo.style.backgroundSize = p.ajuste || 'cover';
        var capa = h('div', 'nvi-car-capa'); capa.style.background = 'linear-gradient(0deg, rgba(0,0,0,' + ((p.oscurecer || 0) / 100 + 0.15) + '), rgba(0,0,0,' + ((p.oscurecer || 0) / 200) + '))'; s.appendChild(capa);
        if (it.titulo || it.texto) { var t = h('div', 'nvi-car-txt'); if (it.titulo) t.appendChild(h('h3', '', NVI.esc(it.titulo))); if (it.texto) t.appendChild(h('p', '', NVI.esc(it.texto))); s.appendChild(t); }
        if (it.enlace && ctx.modo !== 'editar') { s.style.cursor = 'pointer'; s.onclick = function() { var u = NVI.url(it.enlace); if (/^\//.test(u)) location.href = u; else window.open(u, '_blank', 'noopener'); }; }
        pista.appendChild(s);
      });
      var actual = 0, n = items.length, puntos = [], pasos = n - vis + 1;
      var ir = function(i) {
        actual = i >= pasos ? 0 : i < 0 ? pasos - 1 : i;
        Array.prototype.forEach.call(pista.children, function(s, k) { s.classList.toggle('on', vis > 1 ? k >= actual && k < actual + vis : k === actual);
          s.style.transform = p.efecto === 'fundido' ? '' : vis > 1 ? 'translateX(calc(' + (k - actual) + ' * (100% + ' + GAP + 'px)))' : 'translateX(' + ((k - actual) * 100) + '%)'; });
        puntos.forEach(function(d, k) { d.classList.toggle('on', k === actual); });
      };
      if (pasos > 1 && p.flechas !== false) { var a1 = h('button', 'nvi-car-flecha izq', '‹'), a2 = h('button', 'nvi-car-flecha der', '›'); a1.type = a2.type = 'button'; a1.setAttribute('aria-label', 'Anterior'); a2.setAttribute('aria-label', 'Siguiente'); a1.onclick = function(e) { e.stopPropagation(); ir(actual - 1); }; a2.onclick = function(e) { e.stopPropagation(); ir(actual + 1); }; w.appendChild(a1); w.appendChild(a2); }
      if (pasos > 1 && p.puntos !== false) { var ds = h('div', 'nvi-car-puntos'); items.slice(0, pasos).forEach(function(it, i) { var d = h('button'); d.type = 'button'; d.setAttribute('aria-label', 'Diapositiva ' + (i + 1)); d.onclick = function(e) { e.stopPropagation(); ir(i); }; puntos.push(d); ds.appendChild(d); }); w.appendChild(ds); }
      ir(0);
      if (pasos > 1 && +p.intervalo > 0 && ctx.modo !== 'editar') {
        var pausa = false; w.addEventListener('mouseenter', function() { pausa = true; }); w.addEventListener('mouseleave', function() { pausa = false; });
        var t = setInterval(function() { if (!w.isConnected) { clearInterval(t); return; } if (!pausa && !document.hidden) ir(actual + 1); }, p.intervalo * 1000);
      }
      return w;
    }};
  D.galeria = {n: 'Galería', ic: '▦', g: 'Medios',
    d: function() { return {items: [1, 2, 3, 4, 5, 6].map(function(i) { return {src: NVI.placeholder('Foto ' + i, ['#2f98d5', '#252772', '#1a1449', '#2f98d5', '#252772', '#1a1449'][i - 1], ['#252772', '#1a1449', '#2f98d5', '#1a1449', '#2f98d5', '#252772'][i - 1]), titulo: ''}; }), columnas: 3, espacio: 10, radio: 12, alto: 200}; },
    campos: [{tipo: 'lista', k: 'items', l: 'Fotos', titulo: 'titulo', masivo: 'src', nuevo: {src: '', titulo: ''}, campos: [{tipo: 'medio', k: 'src', l: 'Imagen', acepta: 'imagen', encuadre: true}, {tipo: 'texto', k: 'titulo', l: 'Título (opcional)'}]},
      {tipo: 'numero', k: 'columnas', l: 'Columnas', min: 1, max: 6}, {tipo: 'numero', k: 'alto', l: 'Alto de cada foto (px)', min: 80, max: 600}, {tipo: 'numero', k: 'espacio', l: 'Espacio entre fotos (px)', min: 0, max: 40}, {tipo: 'numero', k: 'radio', l: 'Esquinas redondeadas (px)', min: 0, max: 60},
      {tipo: 'select', k: 'entrada', l: 'Las fotos aparecen', ops: [['', 'Todas a la vez'], ['zoom', 'Una a una, acercándose'], ['subir', 'Una a una, subiendo']]}],
    r: function(p, ctx) {
      var w = h('div', 'nvi-galeria'); w.style.gridTemplateColumns = 'repeat(' + (p.columnas || 3) + ', 1fr)'; w.style.gap = (p.espacio || 0) + 'px';
      var lista = (p.items || []).map(function(it) { return {src: NVI.src(it.src) || NVI.placeholder(), titulo: it.titulo, enc: it.srcEnc}; });
      lista.forEach(function(it, i) { var f = h('figure'); var img = h('img'); img.src = it.src; img.alt = it.titulo || ''; img.loading = 'lazy'; img.style.height = (p.alto || 200) + 'px'; img.style.borderRadius = (p.radio || 0) + 'px'; NVI.aplicarEnc(img, it.enc); img.setAttribute('data-enc', 'items.' + i + '.src'); f.style.borderRadius = img.style.borderRadius; f.appendChild(img); if (it.titulo) f.appendChild(h('figcaption', '', NVI.esc(it.titulo))); if (ctx.modo !== 'editar') { f.onclick = function() { NVI.lightbox(lista, i); }; if (p.entrada) { f.classList.add('nvi-anim', 'nvi-anim-' + p.entrada); f.style.transitionDelay = (i % 12) * 90 + 'ms'; NVI.observarAnim(f); } } w.appendChild(f); });
      return w;
    }};
  D.tarjetas = {n: 'Tarjetas', ic: '▤', g: 'Diseño',
    d: function() { return {items: [{icono: '📅', imagen: '', titulo: 'Design Schedule', texto: 'Organiza y sigue las órdenes del día.', enlace: '/design', textoEnlace: 'Abrir'},
      {icono: '📋', imagen: '', titulo: 'Protocols', texto: 'Consulta los protocolos de cada área.', enlace: '/design?panel=protocols', textoEnlace: 'Ver'},
      {icono: '💬', imagen: '', titulo: 'Comments', texto: 'Genera los comentarios de cada caso.', enlace: '/design?panel=comments', textoEnlace: 'Ir'}], columnas: 3, estilo: 'sombra', alinear: 'left', colorIcono: ''}; },
    campos: [{tipo: 'lista', k: 'items', l: 'Tarjetas', titulo: 'titulo', nuevo: {icono: '⭐', imagen: '', titulo: 'Nueva tarjeta', texto: '', enlace: '', textoEnlace: ''},
      campos: [{tipo: 'texto', k: 'icono', l: 'Ícono (emoji)'}, {tipo: 'medio', k: 'imagen', l: 'O una imagen', acepta: 'imagen', encuadre: true}, {tipo: 'texto', k: 'titulo', l: 'Título'}, {tipo: 'area', k: 'texto', l: 'Texto'},
        {tipo: 'url', k: 'enlace', l: 'Enlace'}, {tipo: 'texto', k: 'textoEnlace', l: 'Texto del enlace'}]},
      {tipo: 'numero', k: 'columnas', l: 'Columnas', min: 1, max: 4}, {tipo: 'select', k: 'estilo', l: 'Estilo', ops: [['sombra', 'Con sombra'], ['borde', 'Con borde'], ['plano', 'Plano'], ['color', 'De color'], ['vidrio', 'Vidrio (sobre fondos)']]}, ALINEAR],
    r: function(p, ctx) {
      var w = h('div', 'nvi-tarjetas nvi-tj-' + (p.estilo || 'sombra')); w.style.gridTemplateColumns = 'repeat(' + (p.columnas || 3) + ', 1fr)';
      (p.items || []).forEach(function(it, i) {
        var c = h(it.enlace && ctx.modo !== 'editar' ? 'a' : 'div', 'nvi-tarjeta'); c.style.textAlign = p.alinear;
        if (it.enlace && ctx.modo !== 'editar') { c.href = NVI.url(it.enlace); if (!/^\//.test(c.getAttribute('href'))) { c.target = '_blank'; c.rel = 'noopener'; } }
        if (it.imagen) { var mc = h('div', 'nvi-tj-marco'), im = h('img', 'nvi-tj-img'); im.src = NVI.src(it.imagen); im.alt = ''; im.loading = 'lazy'; NVI.aplicarEnc(im, it.imagenEnc); mc.setAttribute('data-enc', 'items.' + i + '.imagen'); mc.appendChild(im); c.appendChild(mc); } else if (it.icono) c.appendChild(h('div', 'nvi-tj-ico', NVI.esc(it.icono)));
        var b = h('div', 'nvi-tj-cuerpo'); if (it.titulo) b.appendChild(h('h3', '', NVI.esc(it.titulo))); if (it.texto) b.appendChild(h('p', '', NVI.esc(it.texto)));
        if (it.enlace && it.textoEnlace) b.appendChild(h('span', 'nvi-tj-link', NVI.esc(it.textoEnlace) + ' →'));
        c.appendChild(b); w.appendChild(c);
      });
      return w;
    }};
  D.cifras = {n: 'Cifras', ic: '#', g: 'Diseño',
    d: function() { return {items: [{numero: 120, prefijo: '', sufijo: '+', etiqueta: 'Casos diarios'}, {numero: 5, prefijo: '', sufijo: '', etiqueta: 'Áreas'}, {numero: 98, prefijo: '', sufijo: '%', etiqueta: 'Aprobados con QC'}], color: '', animar: true}; },
    campos: [{tipo: 'lista', k: 'items', l: 'Cifras', titulo: 'etiqueta', nuevo: {numero: 0, prefijo: '', sufijo: '', etiqueta: 'Nueva cifra'},
      campos: [{tipo: 'numero', k: 'numero', l: 'Número'}, {tipo: 'texto', k: 'prefijo', l: 'Antes del número (ej. $)'}, {tipo: 'texto', k: 'sufijo', l: 'Después (ej. %, +)'}, {tipo: 'texto', k: 'etiqueta', l: 'Etiqueta'}]},
      {tipo: 'color', k: 'color', l: 'Color de los números'}, {tipo: 'check', k: 'animar', l: 'Contar al aparecer'}],
    r: function(p, ctx) {
      var w = h('div', 'nvi-cifras'); w.style.gridTemplateColumns = 'repeat(' + Math.max(1, Math.min(6, (p.items || []).length)) + ', 1fr)';
      (p.items || []).forEach(function(it) {
        var c = h('div', 'nvi-cifra'), n = h('b'); if (p.color) n.style.color = p.color;
        var fin = +it.numero || 0, txt = function(v) { return NVI.esc(it.prefijo || '') + Math.round(v).toLocaleString('es-CO') + NVI.esc(it.sufijo || ''); };
        n.innerHTML = txt(p.animar && ctx.modo !== 'editar' ? 0 : fin); c.appendChild(n); c.appendChild(h('span', '', NVI.esc(it.etiqueta || ''))); w.appendChild(c);
        if (p.animar && ctx.modo !== 'editar' && 'IntersectionObserver' in window) {
          var io = new IntersectionObserver(function(es) { if (!es[0].isIntersecting) return; io.disconnect(); var t0 = performance.now(); (function paso(t) { var k = Math.min(1, (t - t0) / 1400); n.innerHTML = txt(fin * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(paso); })(t0); });
          io.observe(c);
        } else n.innerHTML = txt(fin);
      });
      return w;
    }};
  D.cita = {n: 'Cita / testimonio', ic: '❝', g: 'Diseño',
    d: function() { return {texto: 'El trabajo en equipo divide las tareas y multiplica el éxito.', autor: 'Equipo Design', cargo: 'Nuvia Design Colombia', foto: '', estilo: 'tarjeta'}; },
    campos: [{tipo: 'area', k: 'texto', l: 'Texto'}, {tipo: 'texto', k: 'autor', l: 'Autor'}, {tipo: 'texto', k: 'cargo', l: 'Cargo'}, {tipo: 'medio', k: 'foto', l: 'Foto', acepta: 'imagen'},
      {tipo: 'select', k: 'estilo', l: 'Estilo', ops: [['tarjeta', 'Tarjeta'], ['grande', 'Grande centrada'], ['linea', 'Con línea al lado']]}],
    r: function(p) {
      var w = h('figure', 'nvi-cita nvi-cita-' + (p.estilo || 'tarjeta'));
      w.appendChild(h('blockquote', '', NVI.esc(p.texto || '')));
      var pie = h('figcaption'); if (p.foto) { var im = h('img'); im.src = NVI.src(p.foto); im.alt = ''; pie.appendChild(im); }
      pie.appendChild(h('span', '', '<b>' + NVI.esc(p.autor || '') + '</b>' + (p.cargo ? '<small>' + NVI.esc(p.cargo) + '</small>' : ''))); w.appendChild(pie);
      return w;
    }};
  D.acordeon = {n: 'Preguntas (acordeón)', ic: '☰', g: 'Diseño',
    d: function() { return {items: [{titulo: '¿Cómo inicio mi día en el Schedule?', texto: 'Abre Design Schedule, elige tu equipo y revisa las órdenes asignadas.'}, {titulo: '¿Dónde encuentro los protocolos?', texto: 'En Herramientas › Protocols, filtrados por tu área.'}], abrirPrimero: true}; },
    campos: [{tipo: 'lista', k: 'items', l: 'Preguntas', titulo: 'titulo', nuevo: {titulo: 'Nueva pregunta', texto: ''}, campos: [{tipo: 'texto', k: 'titulo', l: 'Pregunta'}, {tipo: 'area', k: 'texto', l: 'Respuesta'}]},
      {tipo: 'check', k: 'abrirPrimero', l: 'Primera abierta'}],
    r: function(p) {
      var w = h('div', 'nvi-acordeon');
      (p.items || []).forEach(function(it, i) { var d = h('details'); if (i === 0 && p.abrirPrimero) d.open = true; d.appendChild(h('summary', '', NVI.esc(it.titulo || ''))); d.appendChild(h('div', 'nvi-ac-txt', NVI.esc(it.texto || '').replace(/\n/g, '<br>'))); w.appendChild(d); });
      return w;
    }};
  D.cuenta = {n: 'Cuenta regresiva', ic: '⏱', g: 'Diseño',
    d: function() { var f = new Date(Date.now() + 7 * 864e5); f.setHours(9, 0, 0, 0); return {titulo: 'Próximo evento', fecha: f.toISOString().slice(0, 16), textoFin: '¡Llegó el día!', color: ''}; },
    campos: [{tipo: 'texto', k: 'titulo', l: 'Título'}, {tipo: 'fecha', k: 'fecha', l: 'Fecha y hora'}, {tipo: 'texto', k: 'textoFin', l: 'Texto cuando termine'}, {tipo: 'color', k: 'color', l: 'Color de los números'}],
    r: function(p) {
      var w = h('div', 'nvi-cuenta'); if (p.titulo) w.appendChild(h('div', 'nvi-cu-tit', NVI.esc(p.titulo)));
      var cajas = h('div', 'nvi-cu-cajas'); w.appendChild(cajas);
      var meta = new Date(p.fecha || Date.now()).getTime();
      var pintar = function() {
        var s = Math.max(0, Math.floor((meta - Date.now()) / 1000));
        if (!s) { cajas.innerHTML = '<div class="nvi-cu-fin">' + NVI.esc(p.textoFin || '') + '</div>'; return false; }
        var v = [[Math.floor(s / 86400), 'días'], [Math.floor(s % 86400 / 3600), 'horas'], [Math.floor(s % 3600 / 60), 'min'], [s % 60, 'seg']];
        cajas.innerHTML = v.map(function(x) { return '<div><b' + (p.color ? ' style="color:' + NVI.esc(p.color) + '"' : '') + '>' + String(x[0]).padStart(2, '0') + '</b><span>' + x[1] + '</span></div>'; }).join('');
        return true;
      };
      if (pintar()) { var t = setInterval(function() { if (!w.isConnected || !pintar()) clearInterval(t); }, 1000); }
      return w;
    }};
  D.muro = {n: 'Muro interno', ic: '📰', g: 'Interactivo',
    d: function() { return {titulo: 'Novedades del equipo', cantidad: 6, estilo: 'tarjetas', columnas: 2, mostrarAutor: true}; },
    campos: [{tipo: 'texto', k: 'titulo', l: 'Título'}, {tipo: 'numero', k: 'cantidad', l: 'Publicaciones a mostrar', min: 1, max: 50},
      {tipo: 'select', k: 'estilo', l: 'Estilo', ops: [['tarjetas', 'Tarjetas'], ['lista', 'Lista'], ['destacado', 'Destacado (la primera grande)']]}, {tipo: 'numero', k: 'columnas', l: 'Columnas (tarjetas)', min: 1, max: 4},
      {tipo: 'check', k: 'mostrarAutor', l: 'Mostrar autor y fecha'}, {tipo: 'nota', l: 'Las publicaciones se agregan desde la página publicada (botón "Nueva publicación" que ven los admins), sin tener que volver a publicar la página.'}],
    r: function(p, ctx) {
      var w = h('div', 'nvi-muro'), cab = h('div', 'nvi-muro-cab');
      if (p.titulo) cab.appendChild(h('h3', '', NVI.esc(p.titulo)));
      w.appendChild(cab); var cont = h('div', 'nvi-muro-lista nvi-muro-' + (p.estilo || 'tarjetas')); cont.style.setProperty('--cols', p.columnas || 2); w.appendChild(cont);
      cont.innerHTML = '<div class="nvi-muro-vacio">Cargando publicaciones…</div>';
      NVI.cargarMuro(p, cont, cab, ctx);
      NVI._muros.push({p: p, cont: cont, cab: cab, ctx: ctx});
      return w;
    }};
  D.embed = {n: 'Página incrustada', ic: '⧉', g: 'Interactivo',
    d: function() { return {url: '', alto: 520, borde: true, radio: 12}; },
    campos: [{tipo: 'url', k: 'url', l: 'Dirección (https://…) de la página o formulario'}, {tipo: 'numero', k: 'alto', l: 'Alto (px)', min: 100, max: 2000}, {tipo: 'check', k: 'borde', l: 'Borde'}, {tipo: 'numero', k: 'radio', l: 'Esquinas redondeadas (px)', min: 0, max: 40},
      {tipo: 'nota', l: 'Funciona con Google Forms, Zoho Forms, mapas, calendarios y páginas que permiten mostrarse dentro de otras. Algunas páginas lo bloquean.'}],
    r: function(p, ctx) {
      var w = h('div', 'nvi-embed'); w.style.height = (p.alto || 520) + 'px'; w.style.borderRadius = (p.radio || 0) + 'px'; if (p.borde) w.classList.add('borde');
      var u = NVI.url(p.url);
      if (!/^https:\/\//.test(u)) { w.classList.add('vacio'); w.innerHTML = '<span>⧉</span><small>Pega la dirección https de la página a mostrar</small>'; return w; }
      var f = h('iframe'); f.src = u; f.loading = 'lazy'; f.title = 'Página incrustada'; f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox'); f.allow = 'fullscreen; clipboard-write';
      w.appendChild(f); if (ctx.modo === 'editar') w.appendChild(h('div', 'nvi-tapa'));
      return w;
    }};
  D.separador = {n: 'Separador', ic: '—', g: 'Diseño',
    d: function() { return {estilo: 'solid', color: '#2f98d5', grosor: 2, ancho: 100, alinear: 'center'}; },
    campos: [{tipo: 'select', k: 'estilo', l: 'Estilo', ops: [['solid', 'Línea'], ['dashed', 'Guiones'], ['dotted', 'Puntos'], ['double', 'Doble']]}, {tipo: 'color', k: 'color', l: 'Color'}, {tipo: 'numero', k: 'grosor', l: 'Grosor (px)', min: 1, max: 12}, {tipo: 'rango', k: 'ancho', l: 'Ancho (%)', min: 5, max: 100}, ALINEAR],
    r: function(p) { var w = h('div', 'nvi-sep'); w.style.justifyContent = {left: 'flex-start', center: 'center', right: 'flex-end'}[p.alinear] || 'center'; var l = h('hr'); l.style.borderTop = (p.grosor || 2) + 'px ' + (p.estilo || 'solid') + ' ' + (p.color || '#e5e7eb'); l.style.width = (p.ancho || 100) + '%'; w.appendChild(l); return w; }};
  D.espacio = {n: 'Espacio', ic: '↕', g: 'Diseño', d: function() { return {alto: 40}; }, campos: [{tipo: 'numero', k: 'alto', l: 'Alto (px)', min: 4, max: 400}],
    r: function(p, ctx) { var e = h('div', 'nvi-espacio' + (ctx.modo === 'editar' ? ' ed' : '')); e.style.height = (p.alto || 40) + 'px'; return e; }};

  // Estilo común de cualquier bloque (caja)
  NVI.CAMPOS_CAJA = [{tipo: 'color', k: 'fondo', l: 'Fondo de la caja'}, {tipo: 'numero', k: 'relleno', l: 'Relleno interior (px)', min: 0, max: 120}, {tipo: 'numero', k: 'radio', l: 'Esquinas redondeadas (px)', min: 0, max: 80},
    {tipo: 'check', k: 'sombra', l: 'Sombra'}, {tipo: 'numero', k: 'margenAbajo', l: 'Espacio debajo (px)', min: 0, max: 200},
    {tipo: 'rango', k: 'ancho', l: 'Ancho de la caja (%)', min: 10, max: 100}, {tipo: 'select', k: 'alinearCaja', l: 'Ubicación de la caja', ops: [['center', 'Centro'], ['left', 'Izquierda'], ['right', 'Derecha']]},
    {tipo: 'numero', k: 'alto', l: 'Alto mínimo de la caja (px, 0 = automático)', min: 0, max: 2000},
    {tipo: 'select', k: 'animacion', l: 'Animación al aparecer', ops: [['', 'Ninguna'], ['subir', 'Subir'], ['aparecer', 'Aparecer'], ['zoom', 'Acercar'], ['izq', 'Desde la izquierda'], ['der', 'Desde la derecha'], ['flotar', 'Aparecer y flotar']]},
    {tipo: 'numero', k: 'retraso', l: 'Retraso de la animación (ms)', min: 0, max: 3000, paso: 100},
    {tipo: 'check', k: 'ocultarMovil', l: 'Ocultar en celulares'}];

  // w: ancho en % (o null si no cambió); hh: alto en px (o null); ref: medidas al empezar (para la galería)
  NVI.ALTO_PROPIO = {carrusel: 1, embed: 1, imagen: 1, galeria: 1, espacio: 1, video: 1};
  NVI.tamanoBloque = function(b, w, hh, ref) {
    var p = b.p = b.p || {}, e = b.estilo = b.estilo || {}, t = b.tipo;
    if (w != null) {
      if (t === 'imagen' || t === 'separador') p.ancho = w;
      else if (t !== 'espacio') { if (w >= 100) delete e.ancho; else e.ancho = w; }
    }
    if (hh != null) {
      if (t === 'imagen') { p.alto = hh; p.proporcion = ''; }
      else if (t === 'carrusel' || t === 'embed' || t === 'espacio') p.alto = hh;
      else if (t === 'galeria') p.alto = Math.max(60, Math.round((ref && ref.galAlto || p.alto || 200) * hh / Math.max(1, ref && ref.h || hh)));
      else if (t !== 'video' && t !== 'separador') e.alto = hh;   // el video sigue su proporción
    }
  };
  NVI.bloque = function(b, ctx) {
    var def = D[b.tipo];
    var caja = h('div', 'nvi-blk nvi-b-' + b.tipo); caja.setAttribute('data-blk', b.id);
    var e = b.estilo || {};
    if (e.fondo) caja.style.background = e.fondo; if (+e.relleno) caja.style.padding = e.relleno + 'px'; if (+e.radio) caja.style.borderRadius = e.radio + 'px';
    if (+e.ancho && +e.ancho < 100) { caja.style.width = e.ancho + '%'; caja.style.marginLeft = e.alinearCaja === 'left' ? '0' : 'auto'; caja.style.marginRight = e.alinearCaja === 'right' ? '0' : 'auto'; }
    if (+e.alto) caja.style.minHeight = e.alto + 'px';
    if (e.sombra) caja.style.boxShadow = '0 10px 30px rgba(15,23,42,.12)'; caja.style.marginBottom = (e.margenAbajo != null && e.margenAbajo !== '' ? e.margenAbajo : 16) + 'px';
    if (e.ocultarMovil) caja.classList.add('nvi-ocultar-movil');
    if (e.animacion && ctx.modo !== 'editar') { caja.classList.add('nvi-anim', 'nvi-anim-' + e.animacion); if (+e.retraso) caja.style.transitionDelay = e.retraso + 'ms'; NVI.observarAnim(caja); }
    try { caja.appendChild(def ? def.r(b.p || {}, ctx) : h('div', 'nvi-desconocido', 'Bloque no disponible')); }
    catch (err) { caja.appendChild(h('div', 'nvi-desconocido', 'No se pudo mostrar este bloque')); }
    return caja;
  };
  var ioAnim = null;
  NVI.observarAnim = function(el) {
    if (!('IntersectionObserver' in window)) { el.classList.add('visto'); return; }
    ioAnim = ioAnim || new IntersectionObserver(function(es) { es.forEach(function(x) { if (x.isIntersecting) { x.target.classList.add('visto'); ioAnim.unobserve(x.target); } }); }, {threshold: 0.12});
    ioAnim.observe(el);
  };

  // ---------- Secciones ----------
  NVI.CAMPOS_SECCION = [
    {tipo: 'select', k: 'fondoTipo', l: 'Fondo', ops: [['ninguno', 'Sin fondo'], ['color', 'Color'], ['degradado', 'Degradado'], ['imagen', 'Imagen'], ['video', 'Video (de fondo)']]},
    {tipo: 'color', k: 'fondo', l: 'Color de fondo', si: ['fondoTipo', ['color', 'degradado']]}, {tipo: 'color', k: 'fondo2', l: 'Segundo color', si: ['fondoTipo', ['degradado']]},
    {tipo: 'numero', k: 'angulo', l: 'Ángulo del degradado (°)', min: 0, max: 360, si: ['fondoTipo', ['degradado']]},
    {tipo: 'check', k: 'animarFondo', l: 'Degradado en movimiento', si: ['fondoTipo', ['degradado']]},
    {tipo: 'medio', k: 'imagen', l: 'Imagen de fondo', acepta: 'imagen', encuadre: true, si: ['fondoTipo', ['imagen']]}, {tipo: 'medio', k: 'video', l: 'Video de fondo', acepta: 'video', si: ['fondoTipo', ['video']]},
    {tipo: 'rango', k: 'oscurecer', l: 'Oscurecer el fondo (%)', min: 0, max: 85, si: ['fondoTipo', ['imagen', 'video']]}, {tipo: 'check', k: 'fijo', l: 'Efecto paralaje (imagen fija)', si: ['fondoTipo', ['imagen']]},
    {tipo: 'color', k: 'colorTexto', l: 'Color del texto'}, {tipo: 'select', k: 'ancho', l: 'Ancho del contenido', ops: [['normal', 'Normal (1200 px)'], ['estrecho', 'Estrecho (860 px)'], ['ancho', 'Ancho (1500 px)'], ['completo', 'Toda la pantalla']]},
    {tipo: 'numero', k: 'padArriba', l: 'Espacio arriba (px)', min: 0, max: 300}, {tipo: 'numero', k: 'padAbajo', l: 'Espacio abajo (px)', min: 0, max: 300},
    {tipo: 'numero', k: 'alto', l: 'Alto mínimo (px, 0 = según el contenido)', min: 0, max: 1400}, {tipo: 'numero', k: 'espacio', l: 'Espacio entre columnas (px)', min: 0, max: 80},
    {tipo: 'select', k: 'alinearV', l: 'Alinear el contenido', ops: [['start', 'Arriba'], ['center', 'Al centro'], ['end', 'Abajo']]},
    {tipo: 'select', k: 'forma', l: 'Borde inferior decorativo', ops: [['', 'Recto'], ['ola', 'Ola'], ['diagonal', 'Diagonal'], ['curva', 'Curva']]},
    {tipo: 'select', k: 'decoracion', l: 'Decoración animada', ops: [['', 'Ninguna'], ['murcielagos', 'Murciélagos 🦇'], ['calabazas', 'Calabazas y hojas 🎃'], ['fantasmas', 'Fantasmas 👻'], ['nieve', 'Nieve ❄'], ['navidad', 'Estrellas y regalos 🎄'], ['confeti', 'Confeti 🎉'],
      ['confeti3d', '✨ Confeti en el aire (3D)'], ['globos', '✨ Globos que suben'], ['fuegos', '✨ Fuegos artificiales'], ['brillos', '✨ Brillos dorados'], ['fiesta', '✨ Fiesta: confeti y globos']]},
    {tipo: 'check', k: 'ocultarMovil', l: 'Ocultar en celulares'}];
  // figuras de cada decoración y cómo se mueven (caer, volar o subir)
  NVI.DECORACION = {murcielagos: {f: ['🦇'], mov: 'volar', n: 9}, calabazas: {f: ['🎃', '🍂', '🍁', '🍂'], mov: 'caer', n: 14}, fantasmas: {f: ['👻', '🕸', '👻', '🕯'], mov: 'subir', n: 10},
    nieve: {f: ['❄', '❅', '•', '❆', '•'], mov: 'caer', n: 26}, navidad: {f: ['⭐', '🎁', '❄', '🔔', '✨', '🎄'], mov: 'caer', n: 16}, confeti: {f: ['🎉', '✨', '🎊', '⭐', '🥂'], mov: 'caer', n: 18}};
  NVI.decoracion = function(tipo) {
    var d = NVI.DECORACION[tipo]; if (!d) return null;
    var w = h('div', 'nvi-deco nvi-deco-' + d.mov); w.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < d.n; i++) {
      // posiciones y tiempos fijos por número (no aleatorios), para que la página se vea igual cada vez
      var s = h('span', '', d.f[i % d.f.length]), dur = 9 + (i * 7) % 10;
      s.style.left = ((i * 37 + 11) % 100) + '%'; s.style.top = d.mov === 'volar' ? (8 + (i * 23) % 70) + '%' : '';
      s.style.fontSize = (tipo === 'nieve' ? 10 + (i * 5) % 16 : 16 + (i * 7) % 20) + 'px';
      s.style.animationDuration = dur + 's'; s.style.animationDelay = (-(i * 2.3) % dur).toFixed(1) + 's';
      s.style.opacity = (0.55 + ((i * 13) % 45) / 100).toFixed(2);
      w.appendChild(s);
    }
    return w;
  };
  NVI.estiloSeccion = function() { return {fondoTipo: 'ninguno', fondo: '#ffffff', fondo2: '#252772', angulo: 135, imagen: '', video: '', oscurecer: 40, fijo: false, colorTexto: '', ancho: 'normal', padArriba: 56, padAbajo: 56, alto: 0, espacio: 28, alinearV: 'start', forma: '', ocultarMovil: false}; };
  // Ancho de diseño de una sección libre (el contenido de cada ancho, sin los márgenes de los lados)
  NVI.anchoLibre = function(ancho) { return {estrecho: 804, ancho: 1444, completo: 1440}[ancho] || 1144; };
  // La sección libre se ve igual en cualquier pantalla: se dibuja a su ancho de diseño y se reduce en proporción.
  // En tablets y celulares (página de 820 px o menos) los elementos van uno debajo del otro.
  NVI.ajustarLibre = function(lib) {
    var cont = lib.parentNode, pag = lib.closest('.nvi-pagina'); if (!cont || !pag) return;
    var WD = +lib.getAttribute('data-wd') || 1144, alto = parseFloat(lib.style.height) || 0;
    if (pag.clientWidth <= 820) { lib.style.transform = ''; lib.style.marginBottom = ''; lib.style.marginRight = ''; return; }
    var cs = getComputedStyle(cont), disp = cont.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), k = Math.min(1, disp / WD);
    lib.style.transform = k < 0.999 ? 'scale(' + k + ')' : ''; lib.style.transformOrigin = '0 0';
    lib.style.marginBottom = k < 0.999 ? -(alto * (1 - k)) + 'px' : ''; lib.style.marginRight = k < 0.999 ? -(WD * (1 - k)) + 'px' : '';
  };
  // Empuje hacia abajo en secciones libres: compara el alto de cada bloque con el que tenía al diseñarlo (hd)
  NVI.flujoLibre = function(lib, els, alto) {
    var calc = function() {
      var pag = lib.closest('.nvi-pagina'); if (!pag) return;
      var L = els.map(function(el) { var c = lib.querySelector('[data-el="' + el.id + '"]'); return c ? {el: el, c: c, y: +el.y || 0, x0: +el.x || 0, x1: (+el.x || 0) + (+el.w || 30), hd: +el.h || +el.hd || 0, ha: c.offsetHeight, mov: 0} : null; }).filter(Boolean);
      if (pag.clientWidth <= 820) { L.forEach(function(a) { a.c.style.top = a.y + 'px'; }); lib.style.height = alto + 'px'; return; }
      L.sort(function(a, b) { return a.y - b.y; });
      L.forEach(function(a, i) {
        var crece = a.hd ? Math.max(0, a.ha - a.hd) : 0, base = a.y + (a.hd || a.ha);
        if (!crece && !a.mov) return;
        for (var j = i + 1; j < L.length; j++) { var b = L[j]; if (b.y >= base - 2 && b.x0 < a.x1 - 0.5 && a.x0 < b.x1 - 0.5) b.mov = Math.max(b.mov, a.mov + crece); }
      });
      var extra = 0;
      L.forEach(function(a) { a.c.style.top = (a.y + a.mov) + 'px'; extra = Math.max(extra, a.mov + Math.max(0, a.ha - (a.hd || a.ha))); });
      var nuevo = alto + extra + 'px'; if (lib.style.height !== nuevo) { lib.style.height = nuevo; NVI.ajustarLibre(lib); }
    };
    var t = 0, pedir = function() { cancelAnimationFrame(t); t = requestAnimationFrame(calc); };
    if ('ResizeObserver' in window) { var ro = new ResizeObserver(pedir); requestAnimationFrame(function() { Array.prototype.forEach.call(lib.children, function(c) { ro.observe(c); }); }); }
    pedir();
  };
  NVI.seccion = function(s, ctx, tema) {
    var e = Object.assign(NVI.estiloSeccion(), s.estilo || {});
    var sec = h('section', 'nvi-sec nvi-sec-' + (s.tipo || 'columnas') + (e.ocultarMovil ? ' nvi-ocultar-movil' : '')); sec.setAttribute('data-sec', s.id);
    if (e.fondoTipo === 'color') sec.style.background = e.fondo;
    if (e.fondoTipo === 'degradado') { sec.style.background = 'linear-gradient(' + (e.angulo || 135) + 'deg,' + e.fondo + ',' + e.fondo2 + (e.animarFondo ? ',' + e.fondo : '') + ')'; if (e.animarFondo) sec.classList.add('nvi-fondo-mov'); }
    if (e.fondoTipo === 'imagen' && e.imagen) {
      var urlF = 'url("' + NVI.src(e.imagen).replace(/"/g, '%22') + '")', qf = NVI.enc(e.imagenEnc);
      // acercada: va en una capa aparte para poder agrandarla sin agrandar la sección (con paralaje no se puede acercar)
      if (qf.z > 1 && !e.fijo) { var capaF = h('div', 'nvi-sec-img'); capaF.style.backgroundImage = urlF; NVI.aplicarEnc(capaF, e.imagenEnc, true); sec.appendChild(capaF); }
      else { sec.style.backgroundImage = urlF; sec.style.backgroundSize = 'cover'; sec.style.backgroundPosition = qf.pos; if (e.fijo) sec.style.backgroundAttachment = 'fixed'; }
    }
    if (e.fondoTipo === 'video' && e.video) { var v = h('video', 'nvi-sec-video'); v.src = NVI.src(e.video); v.muted = true; v.loop = true; v.playsInline = true; v.autoplay = ctx.modo !== 'editar'; sec.appendChild(v); }
    if ((e.fondoTipo === 'imagen' || e.fondoTipo === 'video') && +e.oscurecer) { var cp = h('div', 'nvi-sec-capa'); cp.style.background = 'rgba(0,0,0,' + (e.oscurecer / 100) + ')'; sec.appendChild(cp); }
    if (e.decoracion) {
      var fxT = NVI.fx && NVI.fx.TIPOS_SECCION[e.decoracion];
      var dc = fxT ? NVI.fx.capa(fxT) : NVI.decoracion(e.decoracion); if (dc) sec.appendChild(dc);
    }
    if (e.colorTexto) { sec.style.color = e.colorTexto; sec.style.setProperty('--nvi-texto-sec', e.colorTexto); }
    sec.style.paddingTop = (e.padArriba || 0) + 'px'; sec.style.paddingBottom = (e.padAbajo || 0) + (e.forma ? 50 : 0) + 'px';
    if (+e.alto) sec.style.minHeight = e.alto + 'px';
    var int = h('div', 'nvi-sec-in nvi-w-' + (e.ancho || 'normal')); sec.appendChild(int);
    if (s.tipo === 'libre') {
      int.classList.add('nvi-libre'); int.style.height = (+e.alto || 480) + 'px'; sec.style.minHeight = '';
      var lib = int, WD = NVI.anchoLibre(e.ancho);
      // el contenido va en una capa de ancho fijo (el de diseño) que se reduce en pantallas más chicas
      lib = h('div', 'nvi-libre nvi-libre-capa'); lib.style.width = WD + 'px'; lib.style.height = int.style.height; lib.setAttribute('data-wd', WD); int.classList.remove('nvi-libre'); int.style.height = ''; int.appendChild(lib);
      if ('ResizeObserver' in window) new ResizeObserver(function() { NVI.ajustarLibre(lib); }).observe(int);
      requestAnimationFrame(function() { NVI.ajustarLibre(lib); });
      // en celular se apilan en orden de arriba hacia abajo
      (s.elementos || []).slice().sort(function(a, b) { return (a.y || 0) - (b.y || 0) || (a.x || 0) - (b.x || 0); }).forEach(function(el) {
        var c = h('div', 'nvi-libre-el'); c.setAttribute('data-el', el.id);
        c.style.left = (el.x || 0) + '%'; c.style.top = (el.y || 0) + 'px'; c.style.width = (el.w || 30) + '%'; if (+el.h) c.style.height = el.h + 'px'; c.style.zIndex = el.z || 1;
        c.appendChild(NVI.bloque(el.bloque, ctx)); lib.appendChild(c);
      });
      // en la página: si un bloque crece (muro con más publicaciones, acordeón abierto...) empuja hacia abajo lo que tiene debajo
      if (ctx.modo !== 'editar') NVI.flujoLibre(lib, s.elementos || [], +e.alto || 480);
    } else {
      var fila = h('div', 'nvi-fila'); fila.style.gap = (e.espacio != null ? e.espacio : 28) + 'px'; fila.style.alignItems = e.alinearV === 'center' ? 'center' : e.alinearV === 'end' ? 'end' : 'start';
      if (e.alinearV && e.alinearV !== 'start' && +e.alto) int.style.alignSelf = 'stretch';
      (s.columnas || []).forEach(function(col) {
        var c = h('div', 'nvi-col'); c.setAttribute('data-col', col.id); c.style.gridColumn = 'span ' + (col.ancho || 12);
        (col.bloques || []).forEach(function(b) { c.appendChild(NVI.bloque(b, ctx)); });
        fila.appendChild(c);
      });
      int.appendChild(fila);
      if (e.alinearV === 'center' && +e.alto) { sec.style.display = 'flex'; sec.style.flexDirection = 'column'; sec.style.justifyContent = 'center'; }
    }
    if (e.forma) { var f = h('div', 'nvi-forma nvi-forma-' + e.forma); f.innerHTML = {ola: '<svg viewBox="0 0 1440 80" preserveAspectRatio="none"><path d="M0,40 C240,90 480,0 720,30 C960,60 1200,10 1440,40 L1440,80 L0,80 Z"/></svg>',
      diagonal: '<svg viewBox="0 0 1440 80" preserveAspectRatio="none"><path d="M0,80 L1440,0 L1440,80 Z"/></svg>', curva: '<svg viewBox="0 0 1440 80" preserveAspectRatio="none"><path d="M0,80 Q720,-40 1440,80 Z"/></svg>'}[e.forma] || '';
      f.querySelector('path') && f.querySelector('path').setAttribute('fill', 'var(--nvi-fondo)'); sec.appendChild(f); }
    return sec;
  };

  // ---------- Página ----------
  NVI.render = function(pag, cont, ctx) {
    ctx = ctx || {modo: 'ver'};
    var tema = Object.assign({}, NVI.TEMA_BASE, (pag && pag.tema) || {});
    NVI.cargarFuente(tema.fuenteTitulos); NVI.cargarFuente(tema.fuenteTexto);
    cont.innerHTML = '';
    var raiz = h('div', 'nvi-pagina'); raiz.style.setProperty('--nvi-primario', tema.primario); raiz.style.setProperty('--nvi-secundario', tema.secundario);
    raiz.style.setProperty('--nvi-acento', tema.acento); raiz.style.setProperty('--nvi-fondo', tema.fondo); raiz.style.setProperty('--nvi-texto', tema.texto);
    raiz.style.setProperty('--nvi-radio', (tema.radio || 0) + 'px'); raiz.style.setProperty('--nvi-f-tit', "'" + tema.fuenteTitulos + "', system-ui, sans-serif"); raiz.style.setProperty('--nvi-f-txt', "'" + tema.fuenteTexto + "', system-ui, sans-serif");
    ((pag && pag.secciones) || []).forEach(function(s) { raiz.appendChild(NVI.seccion(s, ctx, tema)); });
    cont.appendChild(raiz);
    return raiz;
  };

  // Celebración al abrir la página: una vez por sesión de cada persona
  NVI.celebrarAlAbrir = function(tipo, siempre) {
    if (!tipo || !NVI.fx) return;
    var k = 'nvi-celebrado-' + tipo;
    if (!siempre) { try { if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k, '1'); } catch (e) {} }
    setTimeout(function() { NVI.fx.celebrar(tipo); }, 500);
  };

  // ---------- Ampliar imágenes ----------
  NVI.lightbox = function(lista, i) {
    var bg = h('div', 'nvi-lb'); bg.tabIndex = -1;
    var pintar = function() { bg.innerHTML = '<button type="button" class="nvi-lb-x" aria-label="Cerrar">✕</button>' + (lista.length > 1 ? '<button type="button" class="nvi-lb-f izq" aria-label="Anterior">‹</button><button type="button" class="nvi-lb-f der" aria-label="Siguiente">›</button>' : '') +
      '<figure><img src="' + NVI.esc(lista[i].src) + '" alt="">' + (lista[i].titulo ? '<figcaption>' + NVI.esc(lista[i].titulo) + '</figcaption>' : '') + '</figure>'; };
    var cerrar = function() { bg.remove(); document.removeEventListener('keydown', tecla); };
    var tecla = function(e) { if (e.key === 'Escape') cerrar(); if (e.key === 'ArrowRight') { i = (i + 1) % lista.length; pintar(); } if (e.key === 'ArrowLeft') { i = (i - 1 + lista.length) % lista.length; pintar(); } };
    bg.onclick = function(e) { if (e.target.closest('.nvi-lb-f.der')) { i = (i + 1) % lista.length; pintar(); } else if (e.target.closest('.nvi-lb-f.izq')) { i = (i - 1 + lista.length) % lista.length; pintar(); } else if (!e.target.closest('img')) cerrar(); };
    document.addEventListener('keydown', tecla); pintar(); document.body.appendChild(bg); bg.focus();
  };

  // ---------- Muro ----------
  function fecha(iso) { var d = new Date(/Z|[+-]\d\d:\d\d$/.test(iso) ? iso : iso + 'Z'); return isNaN(d) ? '' : d.toLocaleDateString('es-CO', {day: 'numeric', month: 'long', year: 'numeric'}); }
  NVI._muros = [];
  // En vivo: vuelve a cargar los muros que están en pantalla (cuando hay publicaciones nuevas)
  NVI.refrescarMuros = function() {
    NVI._muros = NVI._muros.filter(function(m) { return m.cont.isConnected; });
    NVI._muros.forEach(function(m) { NVI.cargarMuro(m.p, m.cont, m.cab, m.ctx); });
  };
  // Página publicada abierta: cada 5 s pregunta si se publicó otra versión o cambió el muro, y se actualiza sola
  NVI.vivoVer = function(cont, huella) {
    var actual = huella || {}, andando = false;
    var tick = function() {
      if (andando || document.hidden || document.querySelector('.nvi-dlg-bg, .nvi-lb')) return;
      andando = true;
      fetch('/design/api/inicio/vivo', {credentials: 'same-origin'}).then(function(r) { return r.ok ? r.json() : null; }).then(function(v) {
        if (!v) return;
        if (v.pub !== actual.pub) return fetch('/design/api/inicio/publicada', {credentials: 'same-origin'}).then(function(r) { return r.json(); }).then(function(d) {
          var y = window.scrollY; actual = {pub: d.pub, muro: d.muro};
          var vacia = document.querySelector('.nvi-vacia'); if (vacia && d.contenido) vacia.remove();
          NVI._muros = []; if (d.contenido) NVI.render(d.contenido, cont, {modo: 'ver'}); window.scrollTo(0, y);
          NVI.avisoVivo('La página se actualizó');
        });
        if (v.muro !== actual.muro) { actual.muro = v.muro; NVI.refrescarMuros(); }
      }).catch(function() {}).then(function() { andando = false; });
    };
    setInterval(tick, 5000);
    document.addEventListener('visibilitychange', function() { if (!document.hidden) tick(); });
  };
  NVI.avisoVivo = function(txt) {
    var a = h('div', 'nvi-vivo-aviso', '↻ ' + NVI.esc(txt)); document.body.appendChild(a);
    setTimeout(function() { a.classList.add('on'); }, 20); setTimeout(function() { a.classList.remove('on'); setTimeout(function() { a.remove(); }, 400); }, 3500);
  };
  NVI.cargarMuro = function(p, cont, cab, ctx) {
    fetch('/design/api/inicio/muro?limite=' + (p.cantidad || 6), {credentials: 'same-origin'}).then(function(r) { return r.json(); }).then(function(d) {
      var lista = d.publicaciones || [];
      if (d.puedePublicar && ctx.modo !== 'editar' && !cab.querySelector('.nvi-muro-nueva')) {
        var bn = h('button', 'nvi-muro-nueva', '+ Nueva publicación'); bn.type = 'button'; bn.onclick = function() { NVI.dialogoMuro(null, function() { NVI.cargarMuro(p, cont, cab, ctx); }); }; cab.appendChild(bn);
      }
      if (!lista.length) { cont.innerHTML = '<div class="nvi-muro-vacio">' + (ctx.modo === 'editar' ? 'Aquí saldrán las publicaciones del muro (se agregan desde la página publicada).' : 'Todavía no hay publicaciones.') + '</div>'; return; }
      cont.innerHTML = '';
      lista.forEach(function(x) {
        var a = h('article', 'nvi-post' + (x.fijado ? ' fijado' : ''));
        if (x.imagen) { var im = h('img'); im.src = NVI.src(x.imagen); im.alt = ''; im.loading = 'lazy'; im.onclick = function() { NVI.lightbox([{src: im.src, titulo: x.titulo}], 0); }; a.appendChild(im); }
        var b = h('div', 'nvi-post-c');
        if (x.fijado) b.appendChild(h('span', 'nvi-post-fijo', '📌 Fijada'));
        if (x.titulo) b.appendChild(h('h4', '', NVI.esc(x.titulo)));
        if (x.texto) b.appendChild(h('p', '', NVI.esc(x.texto).replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')));
        if (p.mostrarAutor !== false) b.appendChild(h('small', 'nvi-post-meta', NVI.esc(x.creadoPor) + ' · ' + fecha(x.creadoEn)));
        if (d.puedePublicar && ctx.modo !== 'editar') {
          var acc = h('div', 'nvi-post-acc'), be = h('button', '', 'Editar'), bb = h('button', '', 'Eliminar'); be.type = bb.type = 'button';
          be.onclick = function() { NVI.dialogoMuro(x, function() { NVI.cargarMuro(p, cont, cab, ctx); }); };
          bb.onclick = function() { if (!confirm('¿Eliminar la publicación "' + (x.titulo || 'sin título') + '"?')) return; fetch('/design/api/inicio/muro/' + x.id + '/eliminar', {method: 'POST', credentials: 'same-origin'}).then(function() { NVI.cargarMuro(p, cont, cab, ctx); }); };
          acc.appendChild(be); acc.appendChild(bb); b.appendChild(acc);
        }
        a.appendChild(b); cont.appendChild(a);
      });
    }).catch(function() { cont.innerHTML = '<div class="nvi-muro-vacio">No se pudo cargar el muro.</div>'; });
  };
  NVI.MAX_VIDEO_MB = 100;
  NVI.subirMedio = function(archivo, progreso) {
    var ext = ((archivo.name || '').match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase();
    if (/^\.(avi|wmv|mkv|flv|3gp|mpe?g)$/.test(ext)) return Promise.reject(new Error('Los videos ' + ext.slice(1).toUpperCase() + ' no se pueden ver en el navegador. Conviértelo a MP4 o pega el enlace de YouTube, Vimeo o WorkDrive.'));
    var esVideo = /^video\//.test(archivo.type) || /^\.(mp4|m4v|webm|mov|ogv|ogg)$/.test(ext), lim = NVI.MAX_VIDEO_MB * 1024 * 1024;
    if (esVideo && archivo.size > lim) {
      // más pesado que el límite: se ofrece recortarlo (el tramo queda limitado a lo que cabe)
      if (NVI.recortarVideo) return NVI.recortarVideo(archivo, lim).then(function(f) { return NVI.subirVideoPorPartes(f, progreso); });
      return Promise.reject(new Error('"' + archivo.name + '" pesa ' + Math.round(archivo.size / 1048576) + ' MB; el máximo es ' + NVI.MAX_VIDEO_MB + ' MB. Para videos largos pega el enlace de YouTube, Vimeo o WorkDrive.'));
    }
    // los videos se suben por partes de 4 MB: el servidor nunca tiene el video entero en memoria
    if (esVideo && NVI.subirVideoPorPartes) return NVI.subirVideoPorPartes(archivo, progreso);
    return NVI.prepararImagen(archivo).then(function(r) {
      var fd = new FormData(); fd.append('archivo', r.archivo, r.archivo.name); fd.append('ancho', r.ancho || 0); fd.append('alto', r.alto || 0);
      return new Promise(function(ok, mal) {
        var x = new XMLHttpRequest(); x.open('POST', '/design/api/inicio/medios');
        x.upload.onprogress = function(e) { if (progreso && e.lengthComputable) progreso(e.loaded / e.total); };
        x.onload = function() { var d = {}; try { d = JSON.parse(x.responseText); } catch (e) {} if (x.status >= 200 && x.status < 300) ok(d); else mal(new Error(d.detail || ('Error ' + x.status))); };
        x.onerror = function() { mal(new Error('Sin conexión')); }; x.send(fd);
      });
    });
  };
  // Imágenes grandes: se reducen a máximo 2400 px (más livianas); GIF y SVG se suben tal cual
  NVI.prepararImagen = function(f) {
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return Promise.resolve({archivo: f});
    return new Promise(function(ok) {
      var u = URL.createObjectURL(f), img = new Image();
      img.onload = function() {
        var w = img.naturalWidth, hh = img.naturalHeight, k = Math.min(1, 2400 / Math.max(w, hh));
        if (k === 1 && f.size < 1.5e6) { URL.revokeObjectURL(u); ok({archivo: f, ancho: w, alto: hh}); return; }
        var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(hh * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u);
        var tipo = f.type === 'image/png' ? 'image/png' : 'image/jpeg';
        c.toBlob(function(b) { ok({archivo: new File([b], f.name.replace(/\.\w+$/, '') + (tipo === 'image/png' ? '.png' : '.jpg'), {type: tipo}), ancho: c.width, alto: c.height}); }, tipo, 0.86);
      };
      img.onerror = function() { URL.revokeObjectURL(u); ok({archivo: f}); };
      img.src = u;
    });
  };
  NVI.dialogoMuro = function(x, alGuardar) {
    var bg = h('div', 'nvi-dlg-bg'), img = x ? x.imagen : '';
    bg.innerHTML = '<div class="nvi-dlg" role="dialog" aria-modal="true" aria-label="Publicación del muro"><h3>' + (x ? 'Editar publicación' : 'Nueva publicación') + '</h3>' +
      '<label>Título<input type="text" maxlength="200" data-c="titulo"></label><label>Texto<textarea rows="6" data-c="texto"></textarea></label>' +
      '<div class="nvi-dlg-img"><div class="nvi-dlg-prev"></div><button type="button" class="nvi-b2" data-a="img">Agregar imagen</button><button type="button" class="nvi-b2" data-a="quitar">Quitar imagen</button></div>' +
      '<label class="nvi-chk"><input type="checkbox" data-c="fijado"> Fijar arriba</label><p class="nvi-dlg-err"></p>' +
      '<div class="nvi-dlg-bot"><button type="button" class="nvi-b2" data-a="cancelar">Cancelar</button><button type="button" class="nvi-b1" data-a="guardar">Publicar</button></div></div>';
    var q = function(s) { return bg.querySelector(s); };
    q('[data-c=titulo]').value = x ? x.titulo : ''; q('[data-c=texto]').value = x ? x.texto : ''; q('[data-c=fijado]').checked = !!(x && x.fijado);
    var prev = function() { q('.nvi-dlg-prev').innerHTML = img ? '<img src="' + NVI.esc(NVI.src(img)) + '" alt="">' : '<span>Sin imagen</span>'; q('[data-a=quitar]').style.display = img ? '' : 'none'; };
    prev();
    bg.onclick = function(e) {
      var a = e.target.closest('[data-a]'); if (!a) { if (e.target === bg) bg.remove(); return; }
      if (a.dataset.a === 'cancelar') bg.remove();
      if (a.dataset.a === 'quitar') { img = ''; prev(); }
      if (a.dataset.a === 'img') { var i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.onchange = function() { if (!i.files[0]) return; a.textContent = 'Subiendo…'; NVI.subirMedio(i.files[0]).then(function(m) { img = 'medio:' + m.id; prev(); a.textContent = 'Cambiar imagen'; }).catch(function(er) { q('.nvi-dlg-err').textContent = er.message; a.textContent = 'Agregar imagen'; }); }; i.click(); }
      if (a.dataset.a === 'guardar') {
        a.disabled = true;
        fetch('/design/api/inicio/muro' + (x ? '/' + x.id : ''), {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({titulo: q('[data-c=titulo]').value, texto: q('[data-c=texto]').value, imagen: img, fijado: q('[data-c=fijado]').checked})})
          .then(function(r) { return r.json().then(function(d) { if (!r.ok) throw new Error(d.detail || 'No se pudo publicar.'); return d; }); })
          .then(function() { bg.remove(); alGuardar && alGuardar(); }).catch(function(er) { q('.nvi-dlg-err').textContent = er.message; a.disabled = false; });
      }
    };
    document.body.appendChild(bg); q('[data-c=titulo]').focus();
  };
})();
