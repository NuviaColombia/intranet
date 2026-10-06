/* Nuvia Word: acciones de la cinta y sus menús desplegables. */
(function() {
  'use strict';
  var NV = window.NV, W = NV.word, C = W.cinta, esc = NV.esc;
  var A = W.acciones = {};
  function ed() { return W.ed(); }
  function foco() { var e = ed(); if (e) e.focus(); return e; }
  function listo() { return ed() && !W.est.soloLectura; }
  function cmd(c, v, ui) { if (!listo()) return; var e = foco(); e.execCommand(c, ui || false, v); cambio(); }
  function cambio() { W.marcarCambio(); W.paginar(); setTimeout(function() { C.refrescar(); }, 0); }
  function fase3(nombre) { return function() { NV.alerta(nombre, nombre + ' llega en la fase 3 de Nuvia Office (revisión avanzada), junto con comentarios, control de cambios, ecuaciones y bibliografía.'); }; }
  function insertar(html) { if (!listo()) return; foco().insertContent(html); cambio(); }

  // ---------- Colores (paleta de Office) ----------
  function mezclar(hex, k) {  // k>0 aclara, k<0 oscurece
    var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    var f = function(c) { return Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k)); };
    return '#' + [f(r), f(g), f(b)].map(function(x) { return ('0' + Math.max(0, Math.min(255, x)).toString(16)).slice(-2); }).join('').toUpperCase();
  }
  W.coloresTema = function() {
    var t = W.tema();
    return ['#FFFFFF', '#000000', t.claro, t.oscuro].concat(t.acentos);
  };
  var ESTANDAR = ['#C00000', '#FF0000', '#FFC000', '#FFFF00', '#92D050', '#00B050', '#00B0F0', '#0070C0', '#002060', '#7030A0'];
  var RESALTADOS = [['#FFFF00', 'Amarillo'], ['#00FF00', 'Verde brillante'], ['#00FFFF', 'Turquesa'], ['#FF00FF', 'Rosa'], ['#0000FF', 'Azul'],
    ['#FF0000', 'Rojo'], ['#000080', 'Azul oscuro'], ['#008080', 'Verde azulado'], ['#008000', 'Verde'], ['#800080', 'Violeta'],
    ['#800000', 'Rojo oscuro'], ['#808000', 'Amarillo oscuro'], ['#808080', 'Gris 50%'], ['#C0C0C0', 'Gris 25%'], ['#000000', 'Negro']];
  C.RESALTADOS = RESALTADOS;
  // Menú de colores: tema (con tonos), estándar, sin color/automático y "Más colores".
  W.menuColores = function(ancla, alElegir, opts) {
    opts = opts || {};
    var cont = document.createElement('div'); cont.className = 'nv-paleta';
    var base = W.coloresTema(), filas = '<div class="nv-menu-tit" style="padding:2px 0 6px">Colores del tema</div><div class="nv-paleta-fila sep">';
    base.forEach(function(c) { filas += '<button type="button" data-c="' + c + '" style="background:' + c + '" title="' + c + '"></button>'; });
    filas += '</div>';
    var tonos = [[-0.05, 0.8], [-0.15, 0.6], [-0.25, 0.4], [-0.35, -0.25], [-0.5, -0.5]];
    tonos.forEach(function(par, i) {
      filas += '<div class="nv-paleta-fila' + (i === 4 ? ' sep' : '') + '">';
      base.forEach(function(c, j) {
        var k = j === 0 ? par[0] : j === 1 ? [0.5, 0.35, 0.25, 0.15, 0.05][i] : par[1];
        var col = mezclar(c, k);
        filas += '<button type="button" data-c="' + col + '" style="background:' + col + '" title="' + col + '"></button>';
      });
      filas += '</div>';
    });
    filas += '<div class="nv-menu-tit" style="padding:2px 0 6px">Colores estándar</div><div class="nv-paleta-fila sep">';
    ESTANDAR.forEach(function(c) { filas += '<button type="button" data-c="' + c + '" style="background:' + c + '" title="' + c + '"></button>'; });
    cont.innerHTML = filas + '</div>';
    var items = [];
    if (opts.automatico) items.push({texto: opts.automatico, icono: 'color', accion: function() { alElegir(''); }});
    items.push({nodo: cont});
    items.push({sep: true});
    items.push({texto: 'Más colores…', icono: 'color', accion: function() {
      var i = document.createElement('input'); i.type = 'color'; i.value = '#1F4E79';
      i.style.cssText = 'position:fixed;left:-100px;top:0'; document.body.appendChild(i);
      i.addEventListener('change', function() { alElegir(i.value.toUpperCase()); i.remove(); });
      i.click();
    }});
    var m = NV.menu(ancla, items, {ancho: 236});
    cont.addEventListener('click', function(e) { var b = e.target.closest('[data-c]'); if (b) { NV.cerrarMenu(); alElegir(b.dataset.c); } });
    return m;
  };

  // ---------- Portapapeles ----------
  A.pegar = function() {
    if (!listo()) return;
    if (!navigator.clipboard || !navigator.clipboard.read) { NV.toast('Usa Ctrl+V para pegar.'); return; }
    navigator.clipboard.read().then(function(items) {
      var it = items[0]; if (!it) return;
      var tipo = it.types.indexOf('text/html') >= 0 ? 'text/html' : it.types.indexOf('text/plain') >= 0 ? 'text/plain' : it.types.filter(function(t) { return /^image\//.test(t); })[0];
      if (!tipo) return;
      return it.getType(tipo).then(function(blob) {
        if (/^image\//.test(tipo)) return NV.imagenADataUrl(blob).then(function(u) { insertar('<img src="' + u + '" alt="">'); });
        return blob.text().then(function(t) { insertar(tipo === 'text/html' ? t : esc(t).replace(/\n/g, '<br>')); });
      });
    }).catch(function() { NV.toast('El navegador no permitió pegar desde aquí. Usa Ctrl+V.'); });
  };
  A.pegarTexto = function() {
    if (!listo()) return;
    if (!navigator.clipboard || !navigator.clipboard.readText) { NV.toast('Usa Ctrl+Mayús+V para pegar solo texto.'); return; }
    navigator.clipboard.readText().then(function(t) { insertar(esc(t).replace(/\r?\n/g, '<br>')); }).catch(function() { NV.toast('El navegador no permitió pegar. Usa Ctrl+Mayús+V.'); });
  };
  A.menuPegar = function(b) {
    NV.menu(b, [{texto: 'Mantener formato de origen', icono: 'clipboard_paste', accion: A.pegar},
                {texto: 'Mantener solo texto', icono: 'clipboard_text_ltr', accion: A.pegarTexto},
                {sep: true}, {texto: 'Pegar con Ctrl+V conserva negritas, colores, tablas e imágenes', deshabilitado: true}]);
  };
  function copiarSeleccion(cortar) {
    var e = foco(); if (!e) return;
    var html = e.selection.getContent(), txt = e.selection.getContent({format: 'text'});
    if (!html) return;
    var hecho = function() { if (cortar && listo()) { e.execCommand('Delete'); cambio(); } };
    if (navigator.clipboard && window.ClipboardItem) {
      navigator.clipboard.write([new ClipboardItem({'text/html': new Blob([html], {type: 'text/html'}), 'text/plain': new Blob([txt], {type: 'text/plain'})})])
        .then(hecho).catch(function() { try { e.getDoc().execCommand(cortar ? 'cut' : 'copy'); } catch (x) { NV.toast('Usa Ctrl+' + (cortar ? 'X' : 'C') + '.'); } });
    } else { try { e.getDoc().execCommand(cortar ? 'cut' : 'copy'); } catch (x) { NV.toast('Usa Ctrl+' + (cortar ? 'X' : 'C') + '.'); } }
  }
  A.cortar = function() { copiarSeleccion(true); };
  A.copiar = function() { copiarSeleccion(false); };
  // Copiar formato (brocha): un clic lo aplica una vez; doble clic lo deja activo hasta Esc.
  var PROPS_BROCHA = ['font-family', 'font-size', 'font-weight', 'font-style', 'text-decoration-line', 'color', 'background-color', 'font-variant', 'letter-spacing'];
  A.brochaCopiar = function() {
    var e = ed(); if (!e) return;
    var n = e.selection.getNode(); if (n.nodeType !== 1) n = n.parentNode;
    var cs = e.getWin().getComputedStyle(n), est = {};
    PROPS_BROCHA.forEach(function(p) { est[p] = cs.getPropertyValue(p); });
    var blq = e.dom.getParent(n, e.dom.isBlock), bcs = blq ? e.getWin().getComputedStyle(blq) : null;
    C._brocha = {inline: est, bloque: bcs ? {'text-align': bcs.textAlign, 'line-height': bcs.lineHeight, 'margin-top': bcs.marginTop, 'margin-bottom': bcs.marginBottom} : null,
                 nombre: blq ? blq.nodeName : 'P'};
    C.refrescar();
  };
  A.brochaPegar = function() {
    var e = ed(), br = C._brocha; if (!listo() || !br) return;
    e.undoManager.transact(function() {
      if (!e.selection.isCollapsed()) {
        var st = {};
        Object.keys(br.inline).forEach(function(p) {
          var v = br.inline[p];
          if (p === 'background-color' && /rgba\(0, 0, 0, 0\)|transparent/.test(v)) return;
          if (p === 'text-decoration-line') { if (v && v !== 'none') st['text-decoration'] = v; return; }
          st[p] = v;
        });
        e.formatter.register('nvBrocha', {inline: 'span', styles: st});
        e.formatter.remove('bold'); e.formatter.remove('italic'); e.formatter.remove('underline');
        e.formatter.apply('nvBrocha');
      }
      if (br.bloque) W.bloquesSeleccionados().forEach(function(b) { e.dom.setStyles(b, br.bloque); });
    });
    if (!C._brochaFija) C._brocha = null;
    cambio();
  };
  A.brocha = function(b, v, ev) {
    if (C._brocha) { C._brocha = null; C._brochaFija = false; C.refrescar(); return; }
    A.brochaCopiar(); C._brochaFija = ev && ev.detail >= 2;
    var e = ed(); if (!e) return;
    var h = function() { if (C._brocha) { A.brochaPegar(); } if (!C._brocha) e.off('mouseup', h); };
    e.on('mouseup', h);
  };

  // ---------- Fuente ----------
  A.negrita = function() { cmd('Bold'); };
  A.cursiva = function() { cmd('Italic'); };
  A.subrayado = function() { cmd('Underline'); };
  A.tachado = function() { cmd('Strikethrough'); };
  A.subindice = function() { cmd('Subscript'); };
  A.superindice = function() { cmd('Superscript'); };
  A.borrarFormato = function() { cmd('RemoveFormat'); };
  A.fuente = function(b, nombre) {
    if (!listo() || !nombre) return;
    var f = NV.fuentePorNombre(nombre);
    cmd('FontName', f ? f.css.replace(/"/g, '') : nombre);
  };
  A.tamano = function(b, v) {
    var n = parseFloat(String(v).replace(',', '.'));
    if (!listo() || !(n >= 1 && n <= 1638)) { C.refrescar(); return; }
    cmd('FontSize', n + 'pt');
  };
  var TAMS = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
  A.agrandar = function() { var t = C.tamanoActual(), s = TAMS.filter(function(x) { return x > t; })[0] || Math.round(t + 10); A.tamano(null, s); };
  A.achicar = function() { var t = C.tamanoActual(), s = TAMS.filter(function(x) { return x < t; }).pop() || Math.max(1, t - 1); A.tamano(null, s); };
  A.tamanoPaso = function(d) { A.tamano(null, Math.max(1, C.tamanoActual() + d)); };
  A.menuFuente = function(b) {
    var t = W.tema(), items = [{titulo: 'Fuentes del tema'},
      {texto: t.titulos + ' (Títulos)', estilo: 'font-family:' + NV.cssFuente(t.titulos), accion: function() { A.fuente(null, t.titulos); }},
      {texto: t.cuerpo + ' (Cuerpo)', estilo: 'font-family:' + NV.cssFuente(t.cuerpo), accion: function() { A.fuente(null, t.cuerpo); }},
      {sep: true}, {titulo: 'Todas las fuentes'}];
    NV.FUENTES.forEach(function(f) { items.push({texto: f.n, estilo: 'font-family:' + f.css + ';font-size:14px', accion: function() { A.fuente(null, f.n); }}); });
    NV.menu(b.closest('.nv-combo') || b, items, {ancho: 230});
  };
  A.menuTamano = function(b) {
    NV.menu(b.closest('.nv-combo') || b, TAMS.map(function(s) { return {texto: String(s), accion: function() { A.tamano(null, s); }}; }), {ancho: 80});
  };
  var MAYUS = {
    oracion: function(t) { return t.toLowerCase().replace(/(^\s*|[.!?¡¿]\s+)(\p{L})/gu, function(m, a, l) { return a + l.toUpperCase(); }); },
    minus: function(t) { return t.toLowerCase(); }, mayus: function(t) { return t.toUpperCase(); },
    titulo: function(t) { return t.toLowerCase().replace(/(^|[\s\u0000\-(])(\p{L})/gu, function(m, a, l) { return a + l.toUpperCase(); }); },
    alternar: function(t) { return t.split('').map(function(c) { var u = c.toUpperCase(); return c === u ? c.toLowerCase() : u; }).join(''); }
  };
  A.menuMayus = function(b) {
    var it = function(t, k) { return {texto: t, accion: function() { if (listo()) W.transformarTexto(MAYUS[k]); }}; };
    NV.menu(b, [it('Tipo oración.', 'oracion'), it('minúsculas', 'minus'), it('MAYÚSCULAS', 'mayus'), it('Poner En Mayúsculas Cada Palabra', 'titulo'), it('tIPO iNVERSO', 'alternar')]);
  };
  var cicloMayus = 0;
  A.mayusCiclo = function() { if (!listo()) return; cicloMayus = (cicloMayus + 1) % 3; W.transformarTexto(MAYUS[['mayus', 'minus', 'titulo'][cicloMayus]]); };
  A.menuSubrayado = function(b) {
    var it = function(t, f, css) {
      return {texto: t, estilo: 'text-decoration:underline;' + css, accion: function() {
        if (!listo()) return; var e = foco();
        ['underline', 'subDoble', 'subPunteado', 'subDiscontinuo', 'subOndulado', 'subGrueso'].forEach(function(x) { e.formatter.remove(x); });
        e.formatter.apply(f); cambio();
      }};
    };
    NV.menu(b, [it('Subrayado sencillo', 'underline', ''), it('Subrayado doble', 'subDoble', 'text-decoration-style:double'),
      it('Subrayado grueso', 'subGrueso', 'text-decoration-thickness:2px'), it('Subrayado de puntos', 'subPunteado', 'text-decoration-style:dotted'),
      it('Subrayado discontinuo', 'subDiscontinuo', 'text-decoration-style:dashed'), it('Subrayado ondulado', 'subOndulado', 'text-decoration-style:wavy'),
      {sep: true}, {texto: 'Color de subrayado…', icono: 'color', accion: function() {
        W.menuColores(b, function(c) { if (!listo()) return; var e = foco(); e.formatter.register('subColor', {inline: 'span', styles: {'text-decoration': 'underline', 'text-decoration-color': c || 'currentColor'}}); e.formatter.apply('subColor'); cambio(); }, {automatico: 'Automático'});
      }}]);
  };
  A.menuEfectos = function(b) {
    var ap = function(f) { return function() { if (!listo()) return; var e = foco(); e.formatter.toggle(f); cambio(); }; };
    NV.menu(b, [{texto: 'Sombra', estilo: 'text-shadow:1px 1px 2px rgba(0,0,0,.5)', accion: ap('sombra')},
                {texto: 'Contorno', estilo: 'color:#fff;-webkit-text-stroke:1px #000;font-weight:bold', accion: ap('contorno')},
                {texto: 'Resplandor', estilo: 'text-shadow:0 0 5px #FFC000', accion: ap('resplandor')},
                {sep: true}, {texto: 'Versalitas', estilo: 'font-variant:small-caps', accion: ap('versalitas')},
                {texto: 'Todo en mayúsculas', accion: ap('todoMayus')}, {texto: 'Tachado doble', estilo: 'text-decoration:line-through double', accion: ap('tachadoDoble')},
                {sep: true}, {texto: 'Quitar efectos', accion: function() { if (!listo()) return; var e = foco(); ['sombra', 'contorno', 'resplandor', 'versalitas', 'todoMayus', 'tachadoDoble'].forEach(function(f) { e.formatter.remove(f); }); cambio(); }}]);
  };
  var ultResaltar = '#FFFF00', ultColor = '#C00000', ultSombreado = '#FFFF00';
  function pintarBarras() {
    var r = NV.$('#nvBarraResaltar'), c = NV.$('#nvBarraColor'), s = NV.$('#nvBarraSombreado');
    if (r) r.style.background = ultResaltar || 'transparent'; if (c) c.style.background = ultColor; if (s) s.style.background = ultSombreado || 'transparent';
  }
  C.pintarBarras = pintarBarras;
  var refrescarOrig = C.refrescar;
  C.refrescar = function(f) { refrescarOrig(f); pintarBarras(); };
  A.resaltar = function() { cmd('HiliteColor', ultResaltar || 'transparent'); };
  A.menuResaltar = function(b) {
    var cont = document.createElement('div'); cont.className = 'nv-paleta';
    var h = '';
    for (var i = 0; i < 15; i += 5) {
      h += '<div class="nv-paleta-fila">' + RESALTADOS.slice(i, i + 5).map(function(x) { return '<button type="button" style="width:28px;height:22px;background:' + x[0] + '" data-c="' + x[0] + '" title="' + x[1] + '"></button>'; }).join('') + '</div>';
    }
    cont.innerHTML = h;
    NV.menu(b, [{nodo: cont}, {sep: true}, {texto: 'Sin color', accion: function() { ultResaltar = ''; cmd('HiliteColor', 'transparent'); pintarBarras(); }}], {ancho: 180});
    cont.addEventListener('click', function(e) { var x = e.target.closest('[data-c]'); if (x) { NV.cerrarMenu(); ultResaltar = x.dataset.c; cmd('HiliteColor', ultResaltar); pintarBarras(); } });
  };
  A.colorFuente = function() { cmd('ForeColor', ultColor); };
  A.menuColorFuente = function(b) {
    W.menuColores(b, function(c) { if (c) ultColor = c; if (!c) { if (!listo()) return; foco().formatter.remove('forecolor'); cambio(); } else cmd('ForeColor', c); pintarBarras(); }, {automatico: 'Automático'});
  };

  // ---------- Párrafo ----------
  A.vinetas = function() { cmd('InsertUnorderedList', {'list-style-type': 'disc'}); };
  A.numeracion = function() { cmd('InsertOrderedList', {'list-style-type': 'decimal'}); };
  function muestraLista(tipo, ord) {
    var marca = function(i) {
      if (!ord) return {disc: '●', circle: '○', square: '■', '\'➢\'': '➢', '\'✓\'': '✓', '\'◆\'': '◆', '\'–\'': '–'}[tipo] || '●';
      var n = i + 1;
      return ({decimal: n + '.', 'decimal-paren': n + ')', 'lower-alpha': 'abc'[i] + ')', 'upper-alpha': 'ABC'[i] + '.', 'lower-roman': ['i', 'ii', 'iii'][i] + '.', 'upper-roman': ['I', 'II', 'III'][i] + '.'})[tipo];
    };
    return '<span style="display:inline-block;width:62px;border:1px solid #ccc;padding:3px 4px;font-size:10px;line-height:1.5;background:#fff">' +
      [0, 1, 2].map(function(i) { return '<span style="display:flex;gap:4px;align-items:center"><b style="font-weight:normal;width:14px">' + marca(i) + '</b><i style="flex:1;height:2px;background:#bbb"></i></span>'; }).join('') + '</span>';
  }
  A.menuVinetas = function(b) {
    var tipos = [['disc', 'Círculo'], ['circle', 'Círculo vacío'], ['square', 'Cuadrado'], ['\'➢\'', 'Flecha'], ['\'✓\'', 'Marca de verificación'], ['\'◆\'', 'Rombo'], ['\'–\'', 'Guion']];
    var cont = document.createElement('div'); cont.className = 'nv-paleta'; cont.style.display = 'grid'; cont.style.gridTemplateColumns = 'repeat(4, 72px)'; cont.style.gap = '6px';
    cont.innerHTML = tipos.map(function(t) { return '<button type="button" data-t="' + esc(t[0]) + '" title="' + t[1] + '" style="width:70px;height:auto;border:1px solid transparent;background:none;padding:2px">' + muestraLista(t[0]) + '</button>'; }).join('');
    NV.menu(b, [{titulo: 'Biblioteca de viñetas'}, {nodo: cont}, {sep: true}, {texto: 'Sin viñetas', accion: function() { if (ed().queryCommandState('InsertUnorderedList')) cmd('InsertUnorderedList'); }}], {ancho: 330});
    cont.addEventListener('click', function(e) {
      var x = e.target.closest('[data-t]'); if (!x) return; NV.cerrarMenu();
      var t = x.dataset.t;
      if (/^'/.test(t)) {  // viñeta con símbolo: list-style-type con texto
        cmd('InsertUnorderedList', {'list-style-type': 'disc'});
        var e2 = ed(), ul = e2.dom.getParent(e2.selection.getNode(), 'ul'); if (ul) { e2.dom.setStyle(ul, 'list-style-type', t.replace(/'/g, '"')); cambio(); }
      } else cmd('InsertUnorderedList', {'list-style-type': t});
    });
  };
  A.menuNumeracion = function(b) {
    var tipos = [['decimal', '1. 2. 3.'], ['lower-alpha', 'a) b) c)'], ['upper-alpha', 'A. B. C.'], ['lower-roman', 'i. ii. iii.'], ['upper-roman', 'I. II. III.']];
    var cont = document.createElement('div'); cont.className = 'nv-paleta'; cont.style.display = 'grid'; cont.style.gridTemplateColumns = 'repeat(3, 72px)'; cont.style.gap = '6px';
    cont.innerHTML = tipos.map(function(t) { return '<button type="button" data-t="' + t[0] + '" title="' + t[1] + '" style="width:70px;height:auto;border:1px solid transparent;background:none;padding:2px">' + muestraLista(t[0], true) + '</button>'; }).join('');
    NV.menu(b, [{titulo: 'Biblioteca de numeración'}, {nodo: cont}, {sep: true},
      {texto: 'Establecer valor de numeración…', icono: 'number_symbol', accion: function() {
        var e = ed(), ol = e && e.dom.getParent(e.selection.getNode(), 'ol');
        if (!ol) { NV.toast('Ubica el cursor en una lista numerada.'); return; }
        NV.preguntar('Establecer valor de numeración', 'Iniciar en:', ol.getAttribute('start') || '1').then(function(v) {
          var n = parseInt(v, 10); if (n >= 0) { e.dom.setAttrib(ol, 'start', n); cambio(); }
        });
      }},
      {texto: 'Sin numeración', accion: function() { if (ed().queryCommandState('InsertOrderedList')) cmd('InsertOrderedList'); }}], {ancho: 260});
    cont.addEventListener('click', function(e) { var x = e.target.closest('[data-t]'); if (x) { NV.cerrarMenu(); cmd('InsertOrderedList', {'list-style-type': x.dataset.t}); } });
  };
  A.menuMultinivel = function(b) {
    NV.menu(b, [{titulo: 'Biblioteca de listas'},
      {texto: '1. / a. / i.  (Numeración por niveles)', accion: function() { cmd('InsertOrderedList', {'list-style-type': 'decimal'}); }},
      {texto: '● / ○ / ■  (Viñetas por niveles)', accion: function() { cmd('InsertUnorderedList', {'list-style-type': 'disc'}); }},
      {sep: true}, {texto: 'Cambiar nivel de lista: usa Tab y Mayús+Tab, o Aumentar/Disminuir sangría', deshabilitado: true}], {ancho: 300});
  };
  A.sangriaMas = function() { cmd('Indent'); };
  A.sangriaMenos = function() { cmd('Outdent'); };
  A.alinearIzq = function() { cmd('JustifyLeft'); };
  A.alinearCentro = function() { cmd('JustifyCenter'); };
  A.alinearDer = function() { cmd('JustifyRight'); };
  A.justificar = function() { cmd('JustifyFull'); };
  A.marcas = function() { W.marcasFormato(); };
  A.interlineado = function(b, v) { if (!listo()) return; foco(); W.estiloBloques({'line-height': v}); };
  A.menuInterlineado = function(b) {
    var it = function(v) { return {texto: v.replace('.', ','), accion: function() { A.interlineado(null, v); }}; };
    var esp = function(t, p, v) { return {texto: t, accion: function() { if (!listo()) return; foco(); var o = {}; o[p] = v; W.estiloBloques(o); }}; };
    NV.menu(b, [it('1.0'), it('1.15'), it('1.5'), it('2.0'), it('2.5'), it('3.0'), {sep: true},
      {texto: 'Opciones de interlineado…', icono: 'text_line_spacing', accion: function() { W.dialogos.parrafo(); }},
      {sep: true}, esp('Agregar espacio antes del párrafo', 'margin-top', '12pt'), esp('Quitar espacio después del párrafo', 'margin-bottom', '0')], {ancho: 260});
  };
  A.sombreado = function() { if (!listo()) return; foco(); W.estiloBloques({'background-color': ultSombreado || ''}); };
  A.menuSombreado = function(b) {
    W.menuColores(b, function(c) { ultSombreado = c; pintarBarras(); A.sombreado(); }, {automatico: 'Sin color'});
  };
  var BORDE = '1px solid #000';
  A.bordeInf = function() { A.bordes('inf'); };
  A.bordes = function(tipo) {
    if (!listo()) return; foco();
    var m = {inf: {'border-bottom': BORDE}, sup: {'border-top': BORDE}, izq: {'border-left': BORDE}, der: {'border-right': BORDE},
             todos: {border: BORDE, padding: '1pt 4pt'}, ext: {border: BORDE, padding: '1pt 4pt'}, ninguno: {border: '', padding: ''}};
    if (tipo === 'linea') { insertar('<hr>'); return; }
    if (W.enTabla()) { W.bordesCeldas(tipo); return; }
    W.estiloBloques(m[tipo]);
  };
  A.menuBordes = function(b) {
    var it = function(t, k, ic) { return {texto: t, icono: ic, accion: function() { A.bordes(k); }}; };
    NV.menu(b, [it('Borde inferior', 'inf', 'border_bottom'), it('Borde superior', 'sup', 'border_top'), it('Borde izquierdo', 'izq', 'border_left'),
      it('Borde derecho', 'der', 'border_right'), {sep: true}, it('Sin borde', 'ninguno', 'border_none'), it('Todos los bordes', 'todos', 'border_all'),
      it('Bordes externos', 'ext', 'border_outside'), {sep: true}, it('Línea horizontal', 'linea', 'line_horizontal_1'),
      {sep: true}, {texto: 'Bordes y sombreado…', icono: 'border_all', accion: function() { W.dialogos.bordesSombreado(); }}], {ancho: 240});
  };
  A.ordenar = function() { W.dialogos.ordenar(); };

  // ---------- Estilos ----------
  A.estilo = function(b, f) {
    if (!listo()) return; var e = foco();
    e.undoManager.transact(function() {
      if (f === 'Normal') {
        W.bloquesSeleccionados().forEach(function(bl) {
          if (/^H[1-6]$/.test(bl.nodeName) || (bl.className && /nv-/.test(bl.className))) {
            var p = e.dom.rename(bl, 'p'); e.dom.removeClass(p, 'nv-NoSpacing nv-Title nv-Subtitle nv-Quote nv-IntenseQuote nv-ListParagraph nv-Caption');
            if (!p.className) p.removeAttribute('class');
          }
        });
        ['SubtleEmphasis', 'IntenseEmphasis', 'SubtleReference', 'IntenseReference', 'BookTitle'].forEach(function(x) { e.formatter.remove(x); });
      } else {
        var bloque = /^Heading|^(NoSpacing|Title|Subtitle|Quote|IntenseQuote|ListParagraph|Caption)$/.test(f);
        if (bloque) {  // un estilo de párrafo reemplaza al anterior (no se acumulan clases)
          W.bloquesSeleccionados().forEach(function(bl) { e.dom.removeClass(bl, 'nv-NoSpacing nv-Title nv-Subtitle nv-Quote nv-IntenseQuote nv-ListParagraph nv-Caption'); });
          e.formatter.apply(f);
        } else e.formatter.toggle(f);
      }
    });
    cambio();
  };
  A.galEst = function(b, d) { C.galeria(parseInt(d, 10)); };
  A.menuEstilos = function(b) {
    var items = C.ESTILOS.map(function(s) { return {texto: s.n, accion: function() { A.estilo(null, s.f); }}; });
    items.push({sep: true}, {texto: 'Borrar formato', icono: 'text_clear_formatting', accion: A.borrarFormato});
    NV.menu(b, items, {ancho: 220});
  };

  // ---------- Edición ----------
  A.buscar = function() { W.paneles.navegacion(true, 'buscar'); };
  A.reemplazar = function() { W.dialogos.reemplazar(); };
  A.menuBuscar = function(b) {
    NV.menu(b, [{texto: 'Buscar', icono: 'search', atajo: 'Ctrl+F', accion: A.buscar}, {texto: 'Búsqueda avanzada…', icono: 'search', accion: function() { W.dialogos.reemplazar(true); }},
                {texto: 'Ir a…', icono: 'arrow_right', accion: function() { W.dialogos.irA(); }}]);
  };
  A.menuSeleccionar = function(b) {
    NV.menu(b, [{texto: 'Seleccionar todo', icono: 'select_all_on', atajo: 'Ctrl+A', accion: function() { foco().execCommand('SelectAll'); }},
      {texto: 'Seleccionar todo el texto con formato similar', accion: function() { W.seleccionarSimilar(); }}]);
  };

  // ---------- Dictado y lectura (voz del navegador) ----------
  var reco = null;
  A.dictar = function() {
    if (!listo()) return;
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { NV.alerta('Dictar', 'Tu navegador no permite dictado. Usa Google Chrome o Microsoft Edge.'); return; }
    if (reco) { reco.stop(); return; }
    reco = new SR(); reco.lang = W.aj.idioma || 'es-CO'; reco.continuous = true; reco.interimResults = false;
    reco.onresult = function(e) {
      for (var i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) {
        var t = e.results[i][0].transcript.trim();
        t = t.replace(/\b(punto y aparte|nueva línea|nuevo párrafo)\b/gi, '\n').replace(/\bpunto\b/gi, '.').replace(/\bcoma\b/gi, ',').replace(/\bdos puntos\b/gi, ':');
        var partes = t.split('\n');
        partes.forEach(function(p, k) { if (k) ed().execCommand('InsertParagraph'); if (p.trim()) ed().insertContent(esc(p.trim()) + ' '); });
        cambio();
      }
    };
    reco.onend = function() { reco = null; C._dictando = false; C.refrescar(); };
    reco.onerror = function(e) { if (e.error === 'not-allowed') NV.toast('Permite el uso del micrófono para dictar.', true); };
    reco.start(); C._dictando = true; C.refrescar(); NV.toast('Dictando… habla con claridad. Vuelve a pulsar Dictar para terminar.');
  };
  A.leerVoz = function() {
    if (!window.speechSynthesis) { NV.alerta('Leer en voz alta', 'Tu navegador no permite leer en voz alta.'); return; }
    if (C._leyendo) { speechSynthesis.cancel(); C._leyendo = false; C.refrescar(); return; }
    var e = ed(), t = e.selection.isCollapsed() ? (e.getBody().innerText || '') : e.selection.getContent({format: 'text'});
    if (!t.trim()) return;
    var u = new SpeechSynthesisUtterance(t); u.lang = W.aj.idioma || 'es-CO';
    var voz = speechSynthesis.getVoices().filter(function(v) { return v.lang && v.lang.indexOf(u.lang.slice(0, 2)) === 0; })[0]; if (voz) u.voice = voz;
    u.onend = function() { C._leyendo = false; C.refrescar(); };
    speechSynthesis.speak(u); C._leyendo = true; C.refrescar();
  };

  // ---------- Insertar ----------
  A.salto = function() { insertar('<div class="nv-salto"></div><p><br data-mce-bogus="1"></p>'); };
  A.paginaBlanco = function() { insertar('<div class="nv-salto"></div><p><br></p><div class="nv-salto"></div><p><br data-mce-bogus="1"></p>'); };
  A.menuPortada = function(b) {
    var t = W.tema(), ac = t.acentos[0], hoy = new Date().toLocaleDateString('es-CO', {day: 'numeric', month: 'long', year: 'numeric'});
    var portadas = {
      'Austin': '<p style="text-align:center;margin-top:120pt"><span style="font-size:36pt;color:' + ac + '">[Título del documento]</span></p><p style="text-align:center"><span style="font-size:16pt;color:#595959">[Subtítulo del documento]</span></p>' +
        '<p style="text-align:center;margin-top:200pt"><span style="font-size:12pt">[Nombre del autor]</span></p><p style="text-align:center">' + hoy + '</p>',
      'Banda': '<div style="background:' + ac + ';color:#fff;padding:36pt 24pt;margin-top:160pt"><p style="margin:0"><span style="font-size:32pt">[Título del documento]</span></p><p style="margin:0"><span style="font-size:14pt">[Subtítulo]</span></p></div>' +
        '<p style="margin-top:24pt"><span style="color:#595959">[Nombre de la empresa] · ' + hoy + '</span></p>',
      'Línea lateral': '<div style="border-left:6pt solid ' + ac + ';padding-left:18pt;margin-top:200pt"><p style="margin:0"><span style="font-size:12pt;color:' + ac + '">[Empresa]</span></p><p style="margin:0"><span style="font-size:40pt">[Título]</span></p>' +
        '<p><span style="font-size:14pt;color:#595959">[Subtítulo]</span></p><p><span style="font-size:11pt">[Autor] · ' + hoy + '</span></p></div>'
    };
    var items = Object.keys(portadas).map(function(n) { return {texto: n, icono: 'document_header', accion: function() {
      if (!listo()) return; var e = foco();
      e.undoManager.transact(function() {
        var tmp = e.getDoc().createElement('div'); tmp.innerHTML = portadas[n] + '<div class="nv-salto"></div>';
        var b0 = e.getBody(), pri = b0.firstChild;
        while (tmp.firstChild) b0.insertBefore(tmp.firstChild, pri);
      });
      e.selection.select(e.getBody().firstChild, true); e.selection.collapse(true); cambio();
    }}; });
    NV.menu(b, items.concat([{sep: true}, {texto: 'Quitar portada actual', icono: 'delete', accion: function() {
      var e = ed(), b0 = e.getBody(), s = b0.querySelector('.nv-salto');
      if (!s) { NV.toast('No hay una portada (salto de página) al inicio.'); return; }
      e.undoManager.transact(function() { while (b0.firstChild && b0.firstChild !== s) b0.removeChild(b0.firstChild); b0.removeChild(s); }); cambio();
    }}]));
  };
  A.menuTabla = function(b) {
    var cont = document.createElement('div'); cont.className = 'nv-cuadricula';
    var F = 8, Cc = 10, h = '<div class="nv-cuadricula-t">Insertar tabla</div><div class="nv-cuadricula-g" style="grid-template-columns:repeat(' + Cc + ',18px)">';
    for (var i = 0; i < F * Cc; i++) h += '<span data-f="' + Math.floor(i / Cc) + '" data-c="' + (i % Cc) + '"></span>';
    cont.innerHTML = h + '</div>';
    var tit = cont.firstChild;
    cont.addEventListener('mouseover', function(e) {
      var s = e.target.closest('span[data-f]'); if (!s) return;
      var f = +s.dataset.f, c = +s.dataset.c;
      NV.$$('span[data-f]', cont).forEach(function(x) { x.classList.toggle('on', +x.dataset.f <= f && +x.dataset.c <= c); });
      tit.textContent = 'Tabla de ' + (c + 1) + ' x ' + (f + 1);
    });
    cont.addEventListener('click', function(e) { var s = e.target.closest('span[data-f]'); if (s) { NV.cerrarMenu(); W.insertarTabla(+s.dataset.f + 1, +s.dataset.c + 1); } });
    NV.menu(b, [{nodo: cont}, {sep: true}, {texto: 'Insertar tabla…', icono: 'table', accion: function() { W.dialogos.insertarTabla(); }},
      {texto: 'Convertir texto en tabla…', icono: 'table_edit', accion: function() { W.textoATabla(); }}], {ancho: 240});
  };
  A.menuImagenes = function(b) {
    NV.menu(b, [{texto: 'Este dispositivo…', icono: 'image', accion: A.imagenPC}, {texto: 'Desde una dirección web…', icono: 'globe', accion: function() {
      NV.preguntar('Insertar imagen', 'Dirección (URL) de la imagen:', 'https://').then(function(u) {
        if (u && /^https?:\/\/.+/.test(u)) insertar('<img src="' + esc(u) + '" alt="" style="max-width:100%">');
      });
    }}]);
  };
  A.imagenPC = function() {
    if (!listo()) return;
    NV.elegirArchivos('image/*', true).then(function(fs) {
      if (!fs.length) return;
      Promise.all(fs.map(function(f) { return NV.imagenADataUrl(f); })).then(function(urls) {
        insertar(urls.map(function(u) { return '<img src="' + u + '" alt="" style="max-width:100%">'; }).join(' '));
      });
    });
  };
  A.menuFormas = function(b) {
    var cont = document.createElement('div'); cont.className = 'nv-paleta'; cont.style.display = 'grid'; cont.style.gridTemplateColumns = 'repeat(6, 34px)'; cont.style.gap = '4px';
    cont.innerHTML = Object.keys(W.FORMAS).map(function(k) {
      return '<button type="button" data-f="' + k + '" title="' + esc(W.FORMAS[k].n) + '" style="width:34px;height:34px;background:#fff;border:1px solid #e1dfdd;padding:4px"><img alt="" style="width:24px;height:24px" src="' + W.svgForma(k, '#4472C4', '#2F528F', 1, '') + '"></button>';
    }).join('');
    NV.menu(b, [{titulo: 'Formas'}, {nodo: cont}], {ancho: 250});
    cont.addEventListener('click', function(e) { var x = e.target.closest('[data-f]'); if (x) { NV.cerrarMenu(); W.dialogos.forma(x.dataset.f); } });
  };
  A.menuIconos = function(b) {
    var lista = ['person', 'people', 'mail', 'call', 'home', 'building', 'calendar_ltr', 'clock', 'checkmark_circle', 'dismiss_circle', 'warning', 'info',
      'star', 'heart', 'lightbulb', 'rocket', 'trophy', 'flag', 'location', 'globe', 'money', 'cart', 'chart_multiple', 'data_pie', 'document', 'folder',
      'settings', 'shield', 'lock_closed', 'key', 'dentist', 'heart_pulse', 'stethoscope', 'camera', 'phone', 'laptop', 'wifi_1', 'thumb_like', 'arrow_right', 'target'];
    var cont = document.createElement('div'); cont.className = 'nv-paleta'; cont.style.display = 'grid'; cont.style.gridTemplateColumns = 'repeat(8, 32px)'; cont.style.gap = '3px';
    cont.innerHTML = lista.filter(function(n) { return window.NV_ICONOS && NV_ICONOS[n]; }).map(function(n) {
      return '<button type="button" data-i="' + n + '" title="' + n.replace(/_/g, ' ') + '" style="width:32px;height:32px;border:1px solid #e1dfdd;background:#fff;color:' + W.tema().acentos[0] + ';display:grid;place-items:center;padding:0">' + NV.icono(n) + '</button>';
    }).join('');
    NV.menu(b, [{titulo: 'Iconos (se insertan con el color de énfasis del tema)'}, {nodo: cont}], {ancho: 300});
    cont.addEventListener('click', function(e) {
      var x = e.target.closest('[data-i]'); if (!x) return; NV.cerrarMenu();
      var svg = NV_ICONOS[x.dataset.i].replace('<svg ', '<svg fill="' + W.tema().acentos[0] + '" ').replace(/width="\d+" height="\d+"/, 'width="96" height="96"');
      insertar('<img src="data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg))) + '" alt="' + esc(x.dataset.i.replace(/_/g, ' ')) + '" style="width:1.5cm;height:1.5cm">');
    });
  };
  A.grafico = function() { if (listo()) W.dialogos.grafico(); };
  A.vinculo = function() { if (listo()) W.dialogos.vinculo(); };
  A.marcador = function() { if (listo()) W.dialogos.marcador(); };
  A.referenciaCruzada = function() { if (listo()) W.dialogos.referenciaCruzada(); };
  A.comentario = fase3('Comentarios');
  A.comentarios = fase3('Comentarios');
  A.controlCambios = fase3('Control de cambios');
  A.restringir = fase3('Restringir edición');
  A.ecuacion = fase3('Ecuaciones');
  A.cita = fase3('Citas y bibliografía');
  A.bibliografia = fase3('Citas y bibliografía');
  A.menuEncabezado = function(b) { menuEncPie(b, 'encabezado'); };
  A.menuPie = function(b) { menuEncPie(b, 'pie'); };
  function menuEncPie(b, zona) {
    var tit = esc(W.doc ? W.doc.titulo : 'Documento'), pag = '<span data-campo="pagina">#</span>';
    var pres = zona === 'encabezado' ? {
      'En blanco': '<p>[Escriba aquí]</p>',
      'En blanco (tres columnas)': '<table style="width:100%;border-collapse:collapse"><tbody><tr><td style="width:33%">[Escriba aquí]</td><td style="width:34%;text-align:center">[Escriba aquí]</td><td style="width:33%;text-align:right">[Escriba aquí]</td></tr></tbody></table>',
      'Título del documento': '<p style="text-align:center"><span style="color:' + W.tema().acentos[0] + ';font-size:12pt">' + tit + '</span></p>',
      'Línea con título': '<p style="border-bottom:1px solid ' + W.tema().acentos[0] + ';padding-bottom:2pt">' + tit + '</p>'
    } : {
      'En blanco': '<p>[Escriba aquí]</p>',
      'Número de página centrado': '<p style="text-align:center">' + pag + '</p>',
      'Página X de Y': '<p style="text-align:right">Página ' + pag + ' de <span data-campo="paginas">#</span></p>',
      'Línea con número': '<p style="border-top:1px solid ' + W.tema().acentos[0] + ';padding-top:2pt;text-align:right">' + pag + '</p>'
    };
    var items = Object.keys(pres).map(function(n) { return {texto: n, icono: zona === 'pie' ? 'document_footer' : 'document_header', accion: function() { W.cambiarAjustes(function(a) { a[zona] = pres[n]; }); W.dialogos.encabezadoPie(zona); }}; });
    items.push({sep: true}, {texto: 'Editar ' + (zona === 'pie' ? 'pie de página' : 'encabezado'), icono: 'edit', accion: function() { W.dialogos.encabezadoPie(zona); }},
               {texto: 'Quitar ' + (zona === 'pie' ? 'pie de página' : 'encabezado'), icono: 'delete', accion: function() { W.cambiarAjustes(function(a) { a[zona] = ''; }); }});
    NV.menu(b, items, {ancho: 260});
  }
  A.menuNumPagina = function(b) {
    var pon = function(zona, al) { return function() {
      W.cambiarAjustes(function(a) { a[zona] = '<p style="text-align:' + al + '"><span data-campo="pagina">#</span></p>'; });
    }; };
    var sub = function(zona) { return [{texto: 'Número sin formato 1 (izquierda)', accion: pon(zona, 'left')}, {texto: 'Número sin formato 2 (centro)', accion: pon(zona, 'center')},
      {texto: 'Número sin formato 3 (derecha)', accion: pon(zona, 'right')},
      {texto: 'Página X de Y', accion: function() { W.cambiarAjustes(function(a) { a[zona] = '<p style="text-align:right">Página <span data-campo="pagina">#</span> de <span data-campo="paginas">#</span></p>'; }); }}]; };
    NV.menu(b, [{texto: 'Principio de página', icono: 'document_header', sub: sub('encabezado')}, {texto: 'Final de página', icono: 'document_footer', sub: sub('pie')},
      {sep: true}, {texto: 'Formato del número de página…', icono: 'number_symbol', accion: function() { W.dialogos.formatoNumPagina(); }},
      {texto: 'Quitar números de página', icono: 'delete', accion: function() {
        W.cambiarAjustes(function(a) { ['encabezado', 'pie'].forEach(function(z) { a[z] = String(a[z] || '').replace(/(Página\s*)?<span[^>]*data-campo="pagina"[^>]*>[^<]*<\/span>(\s*de\s*<span[^>]*data-campo="paginas"[^>]*>[^<]*<\/span>)?/g, ''); if (/^<p[^>]*>\s*<\/p>$/.test(a[z])) a[z] = ''; }); });
      }}], {ancho: 260});
  };
  A.menuCuadroTexto = function(b) {
    var ac = W.tema().acentos[0];
    NV.menu(b, [{texto: 'Cuadro de texto simple', icono: 'textbox', accion: function() { insertar('<div class="nv-cuadro" style="float:right;width:40%;margin:0 0 8pt 12pt"><p>[Escriba aquí el texto]</p></div><p><br data-mce-bogus="1"></p>'); }},
      {texto: 'Cita destacada lateral', icono: 'textbox', accion: function() { insertar('<div class="nv-cuadro" style="float:right;width:35%;margin:0 0 8pt 12pt;border:0;border-left:4pt solid ' + ac + ';background:' + W.tema().claro + '"><p style="font-style:italic;font-size:14pt;color:' + ac + '">[“Cite aquí una frase del documento para llamar la atención.”]</p></div><p><br data-mce-bogus="1"></p>'); }},
      {texto: 'Barra lateral con fondo', icono: 'textbox', accion: function() { insertar('<div class="nv-cuadro" style="float:left;width:33%;margin:0 12pt 8pt 0;border:0;background:' + ac + ';color:#fff;padding:10pt"><p style="color:#fff"><b>[Título de la barra lateral]</b></p><p style="color:#fff">[Texto de la barra lateral]</p></div><p><br data-mce-bogus="1"></p>'); }},
      {texto: 'Cuadro de ancho completo', icono: 'textbox', accion: function() { insertar('<div class="nv-cuadro"><p>[Escriba aquí el texto]</p></div><p><br data-mce-bogus="1"></p>'); }}], {ancho: 240});
  };
  A.menuWordart = function(b) {
    var it = function(n, c) { return {texto: n, estilo: '', accion: function() {
      if (!listo()) return; var e = foco(), t = e.selection.getContent({format: 'text'}) || 'Escriba aquí el texto';
      e.insertContent('<p style="text-align:center"><span class="' + c + '" style="font-size:36pt">' + esc(t) + '</span></p>'); cambio();
    }}; };
    NV.menu(b, [it('Relleno de color con sombra', 'nv-wa1'), it('Contorno con sombra', 'nv-wa2'), it('Degradado', 'nv-wa3'), it('Resplandor', 'nv-wa4')], {ancho: 240});
  };
  A.menuCapital = function(b) {
    var ap = function(on) { return function() {
      if (!listo()) return; var e = foco();
      W.bloquesSeleccionados().forEach(function(p) { if (p.nodeName === 'P') e.dom[on ? 'addClass' : 'removeClass'](p, 'nv-capital'); }); cambio();
    }; };
    NV.menu(b, [{texto: 'Ninguno', accion: ap(false)}, {texto: 'En texto', icono: 'text_case_title', accion: ap(true)}]);
  };
  A.lineaFirma = function() { if (listo()) W.dialogos.lineaFirma(); };
  A.fechaHora = function() { if (listo()) W.dialogos.fechaHora(); };
  A.lineaHorizontal = function() { insertar('<hr>'); };
  A.menuSimbolo = function(b) {
    var simb = '©®™§¶€£$¥¢°±×÷≠≤≥≈∞√∑πΩµ←→↑↓✓✗•…–—¿¡«»“”‘’½¼¾'.split('');
    var cont = document.createElement('div'); cont.className = 'nv-paleta nv-simbolos'; cont.style.width = '330px';
    cont.innerHTML = simb.map(function(s) { return '<button type="button" data-s="' + esc(s) + '">' + esc(s) + '</button>'; }).join('');
    NV.menu(b, [{nodo: cont}, {sep: true}, {texto: 'Más símbolos…', icono: 'symbols', accion: function() { if (listo()) foco().execCommand('mceShowCharmap'); }}], {ancho: 350});
    cont.addEventListener('click', function(e) { var x = e.target.closest('[data-s]'); if (x) { NV.cerrarMenu(); insertar(esc(x.dataset.s)); } });
  };

  // ---------- Diseño ----------
  A.tema = function(b, k) { W.cambiarAjustes(function(a) { a.tema = k; }); C.mostrarTab(C.tabActiva()); };
  A.menuTemas = function(b) {
    NV.menu(b, Object.keys(W.TEMAS).map(function(k) {
      var t = W.TEMAS[k];
      return {texto: t.n + '  ·  ' + t.titulos + ' / ' + t.cuerpo, on: W.aj.tema === k, estilo: 'font-family:' + NV.cssFuente(t.titulos), accion: function() { A.tema(null, k); }};
    }), {ancho: 300});
  };
  A.menuColoresTema = A.menuTemas;
  A.menuFuentesTema = function(b) {
    var pares = [['Calibri Light', 'Calibri'], ['Aptos', 'Aptos'], ['Cambria', 'Calibri'], ['Arial', 'Arial'], ['Times New Roman', 'Times New Roman'],
                 ['Georgia', 'Garamond'], ['Montserrat', 'Open Sans'], ['Roboto', 'Roboto'], ['Century Gothic', 'Lato'], ['Montserrat', 'Lato']];
    NV.menu(b, pares.map(function(p) {
      return {texto: p[0] + ' / ' + p[1], estilo: 'font-family:' + NV.cssFuente(p[0]), on: W.tema().titulos === p[0] && W.tema().cuerpo === p[1], accion: function() {
        W.cambiarAjustes(function(a) {
          var base = Object.assign({}, W.TEMAS[a.tema] || W.TEMAS.office); base.titulos = p[0]; base.cuerpo = p[1]; base.n = 'Personalizado';
          W.TEMAS.personalizado = base; a.tema = 'personalizado'; a.temaPersonalizado = base;
        });
      }};
    }), {ancho: 260});
  };
  A.menuEspaciado = function(b) {
    NV.menu(b, Object.keys(W.ESPACIADOS).map(function(k) {
      return {texto: W.ESPACIADOS[k].n, on: W.aj.espaciado === k, accion: function() { W.cambiarAjustes(function(a) { a.espaciado = k; }); }};
    }), {ancho: 240});
  };
  A.menuMarcaAgua = function(b) {
    var pon = function(t, c) { return function() { W.cambiarAjustes(function(a) { a.marcaAgua = {texto: t, color: c || '#BFBFBF'}; }); }; };
    NV.menu(b, [{titulo: 'Confidencial'}, {texto: 'CONFIDENCIAL', accion: pon('CONFIDENCIAL')}, {texto: 'NO COPIAR', accion: pon('NO COPIAR')},
      {titulo: 'Declinación de responsabilidades'}, {texto: 'BORRADOR', accion: pon('BORRADOR')}, {texto: 'MUESTRA', accion: pon('MUESTRA')},
      {titulo: 'Urgente'}, {texto: 'URGENTE', accion: pon('URGENTE', '#F4B183')}, {texto: 'LO ANTES POSIBLE', accion: pon('LO ANTES POSIBLE', '#F4B183')},
      {sep: true}, {texto: 'Marcas de agua personalizadas…', icono: 'drop', accion: function() { W.dialogos.marcaAgua(); }},
      {texto: 'Quitar marca de agua', icono: 'delete', accion: function() { W.cambiarAjustes(function(a) { a.marcaAgua = null; }); }}], {ancho: 250});
  };
  A.menuColorPagina = function(b) { W.menuColores(b, function(c) { W.cambiarAjustes(function(a) { a.colorPagina = c; }); }, {automatico: 'Sin color'}); };
  A.bordesPagina = function() { W.dialogos.bordesPagina(); };

  // ---------- Disposición ----------
  A.menuMargenes = function(b) {
    var items = Object.keys(W.MARGENES).map(function(k) {
      var m = W.MARGENES[k];
      return {texto: m.n + '   Sup: ' + m.sup + ' cm  Inf: ' + m.inf + ' cm  Izq: ' + m.izq + ' cm  Der: ' + m.der + ' cm', icono: 'document_margins', accion: function() {
        W.cambiarAjustes(function(a) { a.pagina.margenes = {sup: m.sup, inf: m.inf, izq: m.izq, der: m.der}; });
      }};
    });
    items.push({sep: true}, {texto: 'Márgenes personalizados…', accion: function() { W.dialogos.pagina('margenes'); }});
    NV.menu(b, items, {ancho: 420});
  };
  A.menuOrientacion = function(b) {
    NV.menu(b, [{texto: 'Vertical', icono: 'document', on: W.aj.pagina.orient !== 'h', accion: function() { W.cambiarAjustes(function(a) { a.pagina.orient = 'v'; }); }},
                {texto: 'Horizontal', icono: 'document_landscape', on: W.aj.pagina.orient === 'h', accion: function() { W.cambiarAjustes(function(a) { a.pagina.orient = 'h'; }); }}]);
  };
  A.menuTamanoPag = function(b) {
    var items = Object.keys(W.TAMANOS).map(function(k) {
      var t = W.TAMANOS[k];
      return {texto: t.n + '   ' + t.w + ' cm x ' + t.h + ' cm', on: W.aj.pagina.tam === k, accion: function() { W.cambiarAjustes(function(a) { a.pagina.tam = k; }); }};
    });
    items.push({sep: true}, {texto: 'Más tamaños de papel…', accion: function() { W.dialogos.pagina('papel'); }});
    NV.menu(b, items, {ancho: 300});
  };
  A.menuColumnas = function(b) {
    var pon = function(n, extra) { return function() { W.columnas(n, extra); }; };
    NV.menu(b, [{texto: 'Una', icono: 'text_column_one', accion: pon(1)}, {texto: 'Dos', icono: 'layout_column_two', accion: pon(2)}, {texto: 'Tres', icono: 'column_triple', accion: pon(3)},
      {texto: 'Izquierda', icono: 'layout_column_two', accion: pon(2, 'izq')}, {texto: 'Derecha', icono: 'layout_column_two', accion: pon(2, 'der')},
      {sep: true}, {texto: 'Más columnas…', accion: function() { W.dialogos.columnas(); }}]);
  };
  A.menuSaltos = function(b) {
    NV.menu(b, [{titulo: 'Saltos de página'}, {texto: 'Página', icono: 'document_page_break', atajo: 'Ctrl+Enter', accion: A.salto},
      {texto: 'Columna', icono: 'layout_column_two', accion: function() { insertar('<span class="nv-salto-col"></span>'); }}], {ancho: 240});
  };
  A.num = function(id, v) {
    if (!listo() || isNaN(v)) return; foco();
    var m = {nvSangIzq: ['margin-left', v + 'cm'], nvSangDer: ['margin-right', v + 'cm'], nvEspAntes: ['margin-top', v + 'pt'], nvEspDespues: ['margin-bottom', v + 'pt']}[id];
    if (m) { var o = {}; o[m[0]] = m[1]; W.estiloBloques(o); return; }
    if (id === 'nvCeldaAlto') { W.tamCelda('alto', v); return; }
    if (id === 'nvCeldaAncho') { W.tamCelda('ancho', v); return; }
    if (id === 'nvImgAlto' || id === 'nvImgAncho') { W.tamImagen(id === 'nvImgAlto' ? 'alto' : 'ancho', v); return; }
  };
  A.chk = function(id, on) {
    if (id === 'nvChkRegla') { W.est.regla = on; W.vista(W.est.vista); W.regla(); return; }
    if (id === 'nvChkNav') { W.paneles.navegacion(on); return; }
    if (id === 'nvChkMarcas') { W.marcasFormato(on); return; }
    if (/^nvT/.test(id)) { W.opcionTabla(id, on); return; }
    if (id === 'nvImgProp') { var im = ed().selection.getNode(); if (im.nodeName === 'IMG') { if (on) im.removeAttribute('data-nv-libre'); else im.setAttribute('data-nv-libre', '1'); cambio(); } }
  };
  A.dlgPagina = function() { W.dialogos.pagina(); };
  A.dlgParrafo = function() { W.dialogos.parrafo(); };
  A.dlgFuente = function() { W.dialogos.fuente(); };

  // ---------- Referencias ----------
  A.menuTOC = function(b) {
    NV.menu(b, [{titulo: 'Integrada'}, {texto: 'Tabla automática 1 (Contenido)', icono: 'text_bullet_list_square', accion: function() { W.insertarTOC('Contenido'); }},
      {texto: 'Tabla automática 2 (Tabla de contenido)', icono: 'text_bullet_list_square', accion: function() { W.insertarTOC('Tabla de contenido'); }},
      {sep: true}, {texto: 'Quitar tabla de contenido', icono: 'delete', accion: function() {
        var e = ed(), t = e.getBody().querySelector('.nv-toc'); if (t) { e.undoManager.transact(function() { t.remove(); }); cambio(); }
      }}], {ancho: 280});
  };
  A.actualizarTOC = function() { if (!W.actualizarTOC()) NV.toast('No hay tabla de contenido. Insértala desde Tabla de contenido.'); else NV.toast('Tabla de contenido actualizada.'); };
  A.menuAgregarTexto = function(b) {
    var n = function(t, f) { return {texto: t, accion: function() { A.estilo(null, f); }}; };
    NV.menu(b, [{texto: 'No mostrar en la tabla de contenido', accion: function() { A.estilo(null, 'Normal'); }}, n('Nivel 1', 'Heading1'), n('Nivel 2', 'Heading2'), n('Nivel 3', 'Heading3')]);
  };
  A.notaPie = function() { if (listo()) W.insertarNota('pie'); };
  A.notaFinal = function() { if (listo()) W.insertarNota('final'); };
  A.siguienteNota = function() {
    var e = ed(), notas = NV.$$('sup.nv-nota', e.getBody()); if (!notas.length) { NV.toast('No hay notas al pie.'); return; }
    var act = e.selection.getNode(), sig = notas.filter(function(n) { return act.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING; })[0] || notas[0];
    e.selection.select(sig); e.selection.collapse(false); sig.scrollIntoView({block: 'center'}); foco();
  };
  A.insertarTitulo = function() { if (listo()) W.dialogos.titulo(); };
  A.tablaIlustraciones = function() { if (listo()) W.insertarTablaIlustraciones(); };

  // ---------- Revisar ----------
  A.ortografia = function() {
    var e = ed(); if (!e) return;
    NV.dialogo({titulo: 'Ortografía y gramática', ancho: 480, html:
      '<p style="line-height:1.55;margin-top:0">Nuvia Word revisa la ortografía mientras escribes, en el idioma del documento (<b>' + esc(nombreIdioma(W.aj.idioma)) + '</b>): las palabras con error quedan subrayadas en rojo.</p>' +
      '<p style="line-height:1.55">Haz <b>clic derecho</b> sobre una palabra subrayada para ver las sugerencias, agregarla al diccionario u omitirla.</p>' +
      '<label class="nv-chk"><input type="checkbox" id="nvOrtoOn"' + (e.getBody().getAttribute('spellcheck') !== 'false' ? ' checked' : '') + '> Revisar ortografía mientras escribo</label>',
      botones: [{texto: 'Aceptar', prim: true, accion: function(d) { e.getBody().setAttribute('spellcheck', d.querySelector('#nvOrtoOn').checked ? 'true' : 'false'); return true; }}]});
  };
  A.sinonimos = function() {
    var e = ed(), w = e && e.selection.getContent({format: 'text'}).trim();
    if (!w) { NV.toast('Selecciona una palabra para buscar sinónimos.'); return; }
    window.open('https://www.wordreference.com/sinonimos/' + encodeURIComponent(w), '_blank', 'noopener');
  };
  A.contarPalabras = function() { W.dialogos.contarPalabras(); };
  function nombreIdioma(c) { return {'es-CO': 'Español (Colombia)', 'es-ES': 'Español (España)', 'es-MX': 'Español (México)', 'en-US': 'Inglés (Estados Unidos)', 'en-GB': 'Inglés (Reino Unido)', 'pt-BR': 'Portugués (Brasil)'}[c] || c; }
  W.nombreIdioma = nombreIdioma;
  A.menuIdioma = function(b) {
    NV.menu(b, ['es-CO', 'es-ES', 'es-MX', 'en-US', 'en-GB', 'pt-BR'].map(function(c) {
      return {texto: nombreIdioma(c), on: W.aj.idioma === c, accion: function() { W.cambiarAjustes(function(a) { a.idioma = c; }); var x = NV.$('#nvEstIdioma'); if (x) x.textContent = nombreIdioma(c); }};
    }), {ancho: 240});
  };

  // ---------- Vista ----------
  A.vista = function(b, v) { W.vista(v); };
  A.dlgZoom = function() { W.dialogos.zoom(); };
  A.zoom100 = function() { W.zoom(100); };
  A.zoomPagina = function() { W.zoomAjustar('pagina'); };
  A.zoomVarias = function() { W.zoomAjustar('varias'); };
  A.zoomAncho = function() { W.zoomAjustar('ancho'); };
  A.nuevaVentana = function() { if (W.doc) window.open('/design/office?doc=' + W.doc.id, '_blank'); };
  A.pantallaCompleta = function() {
    if (document.fullscreenElement) document.exitFullscreen(); else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
  };
  A.contraerCinta = function() { C.contraer(); };
  A.atajos = function() { W.dialogos.atajos(); };
  A.acercaDe = function() {
    NV.alerta('Acerca de Nuvia Office', 'Nuvia Office · Word\nProcesador de textos de la intranet NuviaColombia.\n\nAbre y guarda documentos de Word (.docx), exporta a PDF, convierte imágenes y PDF, y guarda todo en la plataforma.');
  };

  // ---------- Tablas ----------
  A.estiloTabla = function(b, id) { W.estiloTabla(id); };
  A.menuEstilosTabla = function(b) { NV.menu(b, C.ESTILOS_TABLA.map(function(s) { return {texto: s.n, accion: function() { W.estiloTabla(s.id); }}; }), {ancho: 300}); };
  var ultCelda = '#D9E2F3';
  A.sombreadoCelda = function() { W.sombrearCeldas(ultCelda); };
  A.menuSombreadoCelda = function(b) { W.menuColores(b, function(c) { ultCelda = c; var x = NV.$('#nvBarraCelda'); if (x) x.style.background = c; W.sombrearCeldas(c); }, {automatico: 'Sin color'}); };
  A.menuColorPluma = function(b) { W.menuColores(b, function(c) { W.colorPluma = c || '#000000'; var x = NV.$('#nvBarraPluma'); if (x) x.style.background = W.colorPluma; }, {automatico: 'Automático'}); };
  A.menuBordesCelda = function(b) {
    var it = function(t, k, ic) { return {texto: t, icono: ic, accion: function() { W.bordesCeldas(k); }}; };
    NV.menu(b, [it('Borde inferior', 'inf', 'border_bottom'), it('Borde superior', 'sup', 'border_top'), it('Borde izquierdo', 'izq', 'border_left'),
      it('Borde derecho', 'der', 'border_right'), {sep: true}, it('Sin borde', 'ninguno', 'border_none'), it('Todos los bordes', 'todos', 'border_all'),
      it('Bordes externos', 'ext', 'border_outside'), it('Bordes internos', 'int', 'border_inside')], {ancho: 220});
  };
  A.menuSelTabla = function(b) {
    var sel = function(q) { return function() { W.seleccionarTabla(q); }; };
    NV.menu(b, [{texto: 'Seleccionar celda', accion: sel('celda')}, {texto: 'Seleccionar columna', accion: sel('columna')}, {texto: 'Seleccionar fila', accion: sel('fila')}, {texto: 'Seleccionar tabla', accion: sel('tabla')}]);
  };
  A.verCuadricula = function() { var e = foco(); if (e) e.execCommand('mceToggleVisualAid'); };
  A.propTabla = function() { if (listo()) foco().execCommand('mceTableProps'); };
  A.menuEliminarTabla = function(b) {
    NV.menu(b, [{texto: 'Eliminar celdas (contenido)', icono: 'eraser', accion: function() { W.vaciarCeldas(); }}, {texto: 'Eliminar columnas', icono: 'table_delete_column', accion: function() { cmd('mceTableDeleteCol'); }},
      {texto: 'Eliminar filas', icono: 'table_delete_row', accion: function() { cmd('mceTableDeleteRow'); }}, {texto: 'Eliminar tabla', icono: 'table_dismiss', accion: function() { cmd('mceTableDelete'); }}]);
  };
  A.filaArriba = function() { cmd('mceTableInsertRowBefore'); };
  A.filaAbajo = function() { cmd('mceTableInsertRowAfter'); };
  A.colIzq = function() { cmd('mceTableInsertColBefore'); };
  A.colDer = function() { cmd('mceTableInsertColAfter'); };
  A.combinarCeldas = function() { cmd('mceTableMergeCells'); };
  A.dividirCeldas = function() { cmd('mceTableSplitCells'); };
  A.dividirTabla = function() { W.dividirTabla(); };
  A.menuAutoajustar = function(b) {
    var t = function() { var e = ed(); return e && e.dom.getParent(e.selection.getNode(), 'table'); };
    NV.menu(b, [{texto: 'Autoajustar al contenido', accion: function() { var x = t(); if (x) { ed().dom.setStyle(x, 'width', 'auto'); NV.$$('td,th', x).forEach(function(c) { c.style.width = ''; }); cambio(); } }},
      {texto: 'Autoajustar a la ventana', accion: function() { var x = t(); if (x) { ed().dom.setStyle(x, 'width', '100%'); cambio(); } }},
      {texto: 'Ancho de columna fijo', accion: function() { var x = t(); if (x) { ed().dom.setStyle(x, 'table-layout', 'fixed'); cambio(); } }}], {ancho: 230});
  };
  A.distribuirFilas = function() { W.distribuir('filas'); };
  A.distribuirCols = function() { W.distribuir('cols'); };
  A.alinCelda = function(b, v) { W.alinearCeldas(v.split(' ')[0], v.split(' ')[1]); };
  A.margenesCelda = function() { W.dialogos.margenesCelda(); };
  A.ordenarTabla = function() { W.dialogos.ordenarTabla(); };
  A.repetirEncabezado = function() { W.repetirEncabezado(); };
  A.tablaATexto = function() { W.tablaATexto(); };

  // ---------- Imágenes ----------
  A.estiloImg = function(b, id) { W.estiloImagen(id); };
  A.menuBordeImg = function(b) { W.menuColores(b, function(c) { W.bordeImagen(c); }, {automatico: 'Sin contorno'}); };
  A.textoAlt = function() { W.dialogos.textoAlt(); };
  A.menuCorrecciones = function(b) {
    var it = function(t, f) { return {texto: t, accion: function() { W.filtroImagen(f); }}; };
    NV.menu(b, [{titulo: 'Brillo / Contraste'}, it('Brillo: +20%', 'brightness(1.2)'), it('Brillo: -20%', 'brightness(0.8)'),
      it('Contraste: +20%', 'contrast(1.2)'), it('Contraste: -20%', 'contrast(0.8)'), {titulo: 'Nitidez'}, it('Suavizar: 50%', 'blur(1px)')], {ancho: 220});
  };
  A.menuColorImg = function(b) {
    var it = function(t, f) { return {texto: t, accion: function() { W.filtroImagen(f); }}; };
    NV.menu(b, [it('Escala de grises', 'grayscale(1)'), it('Sepia', 'sepia(1)'), it('Blanco y negro', 'grayscale(1) contrast(4)'),
      it('Saturación: 200%', 'saturate(2)'), it('Saturación: 0%', 'saturate(0)'), it('Lavado', 'brightness(1.4) contrast(0.6)')], {ancho: 200});
  };
  A.recortar = function() { W.dialogos.recortar(); };
  A.restablecerImg = function() { W.restablecerImagen(); };
  A.menuPosicion = function(b) { menuAjusteImg(b); };
  A.menuAjuste = function(b) { menuAjusteImg(b); };
  function menuAjusteImg(b) {
    var it = function(t, k, ic) { return {texto: t, icono: ic, accion: function() { W.ajusteImagen(k); }}; };
    NV.menu(b, [it('En línea con el texto', 'linea', 'text_wrap'), it('Cuadrado (a la izquierda)', 'izq', 'text_wrap'), it('Cuadrado (a la derecha)', 'der', 'text_wrap'),
      it('Arriba y abajo (centrada)', 'centro', 'text_wrap')], {ancho: 250});
  }
  A.menuAlinearObj = function(b) {
    NV.menu(b, [{texto: 'Alinear a la izquierda', icono: 'align_left', accion: function() { W.ajusteImagen('izq'); }}, {texto: 'Alinear al centro', icono: 'align_center_horizontal', accion: function() { W.ajusteImagen('centro'); }},
      {texto: 'Alinear a la derecha', icono: 'align_right', accion: function() { W.ajusteImagen('der'); }}]);
  };
  A.menuGirar = function(b) {
    NV.menu(b, [{texto: 'Girar 90° a la derecha', icono: 'arrow_rotate_clockwise', accion: function() { W.girarImagen(90); }}, {texto: 'Girar 90° a la izquierda', icono: 'arrow_rotate_counterclockwise', accion: function() { W.girarImagen(-90); }},
      {texto: 'Voltear verticalmente', icono: 'flip_vertical', accion: function() { W.girarImagen('v'); }}, {texto: 'Voltear horizontalmente', icono: 'flip_horizontal', accion: function() { W.girarImagen('h'); }}]);
  };
})();
