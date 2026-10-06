/* Nuvia Word: editor (TinyMCE como motor de edición, sin su barra) con páginas como en Word: tamaño, márgenes,
   encabezado y pie, números de página, marca de agua, color y borde de página. La cinta está en word_cinta.js
   y los diálogos en word_dialogos.js. */
(function() {
  'use strict';
  var NV = window.NV, W = NV.word = NV.word || {};
  var ed = null;            // editor TinyMCE
  W.ed = function() { return ed; };
  W.doc = null;             // {id, titulo, version, permiso, ...}
  W.aj = null;              // ajustes del documento (página, encabezado, tema…)
  W.est = {guardado: true, guardando: false, autoguardado: true, vista: 'impresion', zoom: 100, marcas: false, regla: false,
           nav: false, soloLectura: false, pendiente: false};

  // ---------- Catálogos ----------
  W.TAMANOS = {
    carta: {n: 'Carta', w: 21.59, h: 27.94}, oficio: {n: 'Oficio (Legal)', w: 21.59, h: 35.56}, a4: {n: 'A4', w: 21, h: 29.7},
    a5: {n: 'A5', w: 14.8, h: 21}, a3: {n: 'A3', w: 29.7, h: 42}, ejecutivo: {n: 'Ejecutivo', w: 18.41, h: 26.67},
    tabloide: {n: 'Tabloide', w: 27.94, h: 43.18}
  };
  W.MARGENES = {
    normal: {n: 'Normal', sup: 2.54, inf: 2.54, izq: 2.54, der: 2.54},
    estrecho: {n: 'Estrecho', sup: 1.27, inf: 1.27, izq: 1.27, der: 1.27},
    moderado: {n: 'Moderado', sup: 2.54, inf: 2.54, izq: 1.91, der: 1.91},
    ancho: {n: 'Ancho', sup: 2.54, inf: 2.54, izq: 5.08, der: 5.08},
    office2003: {n: 'Predeterminado de Office 2003', sup: 2.54, inf: 2.54, izq: 3.17, der: 3.17},
    icontec: {n: 'Normas APA / Icontec', sup: 3, inf: 3, izq: 3, der: 2}
  };
  W.TEMAS = {
    office: {n: 'Office', titulos: 'Calibri Light', cuerpo: 'Calibri', h: '#2F5496', h3: '#1F3763', oscuro: '#44546A', claro: '#E7E6E6',
             acentos: ['#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47']},
    office2023: {n: 'Office 2023', titulos: 'Aptos', cuerpo: 'Aptos', h: '#0F4761', h3: '#0F4761', oscuro: '#0E2841', claro: '#E8E8E8',
                 acentos: ['#156082', '#E97132', '#196B24', '#0F9ED5', '#A02B93', '#4EA72E']},
    clasico: {n: 'Clásico', titulos: 'Cambria', cuerpo: 'Cambria', h: '#17365D', h3: '#1F497D', oscuro: '#1F497D', claro: '#EEECE1',
              acentos: ['#4F81BD', '#C0504D', '#9BBB59', '#8064A2', '#4BACC6', '#F79646']},
    retrospectiva: {n: 'Retrospectiva', titulos: 'Calibri Light', cuerpo: 'Calibri', h: '#A55F0B', h3: '#6E3F07', oscuro: '#637052', claro: '#CCDDEA',
                    acentos: ['#E48312', '#BD582C', '#865640', '#9B8357', '#C2BC80', '#94A088']},
    elegante: {n: 'Elegante', titulos: 'Georgia', cuerpo: 'Garamond', h: '#5B4636', h3: '#3F3025', oscuro: '#3F3025', claro: '#EFE9E1',
               acentos: ['#8C6D4F', '#B08D57', '#6B8E7F', '#A05D56', '#5E7184', '#C2A878']},
    moderno: {n: 'Moderno', titulos: 'Montserrat', cuerpo: 'Open Sans', h: '#0B5394', h3: '#073763', oscuro: '#1B2A3A', claro: '#E6EEF5',
              acentos: ['#0F6FC6', '#009DD9', '#0BD0D9', '#10CF9B', '#7CCA62', '#A5C249']},
    tecnico: {n: 'Técnico', titulos: 'Roboto', cuerpo: 'Roboto', h: '#1E3A6E', h3: '#15294D', oscuro: '#212B36', claro: '#ECEFF3',
              acentos: ['#3B5998', '#E05A47', '#17A2B8', '#28A745', '#FFC107', '#6F42C1']},
    sobrio: {n: 'Sobrio', titulos: 'Arial', cuerpo: 'Arial', h: '#262626', h3: '#404040', oscuro: '#262626', claro: '#F2F2F2',
             acentos: ['#404040', '#7F7F7F', '#A6A6A6', '#C00000', '#1F4E79', '#548235']},
    nuvia: {n: 'Nuvia', titulos: 'Montserrat', cuerpo: 'Lato', h: '#1D4ED8', h3: '#1E3A8A', oscuro: '#0F1B33', claro: '#EFF6FF',
            acentos: ['#1D4ED8', '#0D9488', '#F59E0B', '#DC2626', '#7C3AED', '#64748B']}
  };
  W.ESPACIADOS = {
    sin: {n: 'Sin espacio entre párrafos', antes: 0, despues: 0, linea: 1},
    compacto: {n: 'Compacto', antes: 0, despues: 4, linea: 1},
    estrecho: {n: 'Estrecho', antes: 0, despues: 6, linea: 1.08},
    normal: {n: 'Predeterminado', antes: 0, despues: 8, linea: 1.08},
    abierto: {n: 'Abierto', antes: 0, despues: 10, linea: 1.15},
    relajado: {n: 'Relajado', antes: 0, despues: 6, linea: 1.5},
    doble: {n: 'Doble', antes: 0, despues: 8, linea: 2}
  };
  W.ajustesPredeterminados = function() {
    return {pagina: {tam: 'carta', orient: 'v', margenes: {sup: 2.54, inf: 2.54, izq: 2.54, der: 2.54}},
            encabezado: '', pie: '', primeraDistinta: false, distEnc: 1.25, distPie: 1.25, numInicio: 1, formatoNum: '1',
            marcaAgua: null, colorPagina: '', bordePagina: null, tema: 'office', espaciado: 'normal', idioma: 'es-CO'};
  };
  W.tema = function() { return W.TEMAS[(W.aj && W.aj.tema) || 'office'] || W.TEMAS.office; };
  W.dim = function() {  // en cm
    var a = W.aj, t = W.TAMANOS[a.pagina.tam] || {w: a.pagina.ancho || 21.59, h: a.pagina.alto || 27.94};
    var w = t.w, h = t.h;
    if (a.pagina.orient === 'h') { var x = w; w = h; h = x; }
    return {w: w, h: h, m: a.pagina.margenes};
  };

  // ---------- Hoja de estilos del documento (la usan el editor, la impresión y el PDF) ----------
  W.cssDocumento = function(paraImprimir) {
    var t = W.tema(), e = W.ESPACIADOS[W.aj.espaciado] || W.ESPACIADOS.normal, d = W.dim(), ac = t.acentos[0];
    var cuerpo = NV.cssFuente(t.cuerpo), titulos = NV.cssFuente(t.titulos);
    return [
      'body{font-family:' + cuerpo + ';font-size:11pt;line-height:' + e.linea + ';color:#000;overflow-wrap:break-word;}',
      'p{margin:' + e.antes + 'pt 0 ' + e.despues + 'pt;}',
      'h1,h2,h3,h4,h5,h6{font-family:' + titulos + ';font-weight:normal;line-height:1.08;margin:0;}',
      'h1{font-size:16pt;color:' + t.h + ';margin:12pt 0 0;}',
      'h2{font-size:13pt;color:' + t.h + ';margin:2pt 0 0;}',
      'h3{font-size:12pt;color:' + t.h3 + ';margin:2pt 0 0;}',
      'h4{font-size:11pt;font-style:italic;color:' + t.h + ';margin:2pt 0 0;}',
      'h5{font-size:11pt;color:' + t.h + ';margin:2pt 0 0;}',
      'h6{font-size:11pt;color:' + t.h3 + ';margin:2pt 0 0;}',
      '.nv-NoSpacing{margin:0;line-height:1;}',
      '.nv-Title{font-family:' + titulos + ';font-size:28pt;line-height:1;letter-spacing:-0.5pt;margin:0;}',
      '.nv-Subtitle{color:#5A5A5A;letter-spacing:0.75pt;margin:0 0 8pt;}',
      '.nv-Quote{font-style:italic;color:#404040;text-align:center;margin:10pt 43pt;}',
      '.nv-IntenseQuote{font-style:italic;color:' + ac + ';text-align:center;border-top:1px solid ' + ac + ';border-bottom:1px solid ' + ac + ';padding:10pt 0;margin:18pt 43pt;}',
      '.nv-ListParagraph{margin-left:1.27cm;}',
      '.nv-Caption{font-style:italic;font-size:9pt;color:' + t.oscuro + ';margin:0 0 10pt;}',
      '.nv-SubtleEmphasis{font-style:italic;color:#404040;}',
      '.nv-IntenseEmphasis{font-style:italic;color:' + ac + ';}',
      '.nv-SubtleReference{font-variant:small-caps;color:#5A5A5A;}',
      '.nv-IntenseReference{font-variant:small-caps;font-weight:bold;color:' + ac + ';letter-spacing:0.25pt;}',
      '.nv-BookTitle{font-weight:bold;font-style:italic;letter-spacing:0.25pt;}',
      'a{color:#0563C1;text-decoration:underline;}',
      'ul,ol{margin:0 0 ' + e.despues + 'pt;padding-left:1.27cm;}',
      'li>p{margin:0;}',
      'ol ol{list-style-type:lower-alpha;} ol ol ol{list-style-type:lower-roman;}',
      'ul ul{list-style-type:circle;} ul ul ul{list-style-type:square;}',
      'table{border-collapse:collapse;}',
      'td,th{padding:0 5.4pt;vertical-align:top;}',
      'th{font-weight:bold;text-align:left;}',
      'img{max-width:100%;height:auto;}',
      'blockquote{margin:0 0 ' + e.despues + 'pt 1.27cm;}',
      'hr{border:0;border-top:1px solid #a0a0a0;margin:6pt 0;}',
      '.nv-salto{display:block;height:0;margin:0;border:0;page-break-after:always;break-after:page;}',
      '.nv-salto-col{display:block;height:0;margin:0;break-after:column;}',
      '.nv-cols{column-gap:1.27cm;}',
      '.nv-cols.linea{column-rule:1px solid #000;}',
      '.nv-toc{margin:0 0 12pt;}',
      '.nv-toc .nv-toc-t{font-family:' + titulos + ';font-size:16pt;color:' + t.h + ';margin:12pt 0 6pt;}',
      '.nv-toc p{margin:0 0 5pt;display:flex;align-items:baseline;gap:4px;}',
      '.nv-toc p a{color:inherit;text-decoration:none;}',
      '.nv-toc .nv-toc-p{flex:1;border-bottom:1px dotted #000;min-width:12px;transform:translateY(-3px);}',
      '.nv-toc .n2{padding-left:0.39cm;} .nv-toc .n3{padding-left:0.78cm;}',
      '.nv-cuadro{border:1px solid #000;padding:4pt 7pt;}',
      '.nv-notas{margin-top:18pt;font-size:10pt;}',
      '.nv-notas hr{width:33%;margin:0 0 6pt;border-top:1px solid #000;}',
      '.nv-notas ol{padding-left:0.6cm;}',
      'sup.nv-nota{font-size:0.7em;}',
      'sup.nv-nota a{color:inherit;text-decoration:none;}',
      'p.nv-capital::first-letter{float:left;font-size:3.4em;line-height:0.8;padding:4px 6px 0 0;}',
      '.nv-wa1{font-weight:bold;color:' + ac + ';text-shadow:1px 1px 2px rgba(0,0,0,.35);}',
      '.nv-wa2{font-weight:bold;color:#fff;-webkit-text-stroke:1px ' + ac + ';text-shadow:2px 2px 0 ' + ac + ';}',
      '.nv-wa3{font-weight:bold;background:linear-gradient(90deg,' + t.acentos[0] + ',' + t.acentos[1] + ');-webkit-background-clip:text;background-clip:text;color:transparent;}',
      '.nv-wa4{font-weight:bold;color:#262626;text-shadow:0 0 6px ' + t.acentos[3] + ';}',
      '.nv-sombra{text-shadow:1px 1px 2px rgba(0,0,0,.45);}',
      '.nv-contorno{color:#fff;-webkit-text-stroke:1px #000;}',
      '.nv-resplandor{text-shadow:0 0 5px ' + t.acentos[3] + ',0 0 9px ' + t.acentos[3] + ';}',
      paraImprimir ? '' : '',
    ].join('\n');
  };
  // CSS exclusivo del editor: páginas sobre fondo gris, marcas de formato, ayudas visuales.
  function cssEditor() {
    var d = W.dim(), m = d.m;
    return [
      'html{background:#e8e6e4;min-height:100%;}',
      'body{box-sizing:border-box;width:' + d.w + 'cm;min-height:' + d.h + 'cm;margin:24px auto 48px;padding:' + m.sup + 'cm ' + m.der + 'cm ' + m.inf + 'cm ' + m.izq + 'cm;' +
        'background:transparent;}',  // sin position: el editor ubica sus barras y agarraderas respecto al documento
      'html.nv-web{background:#fff;} html.nv-web body{width:auto;max-width:none;margin:0;padding:24px 56px;min-height:100%;}',
      'html.nv-web #nv-hojas{display:none;}',
      'body.mce-content-readonly{cursor:default;}',
      '#nv-hojas{position:absolute;left:0;top:0;width:100%;z-index:-1;pointer-events:none;}',  // detrás del texto (el cuerpo no tiene position)
      'html.nv-zoom .ephox-snooker-resizer-bar,html.nv-zoom .mce-resizehandle,html.nv-zoom .mce-resize-backdrop{display:none !important;}',  // con zoom el editor ubica mal barras y agarraderas
      '.nv-hoja{position:absolute;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.06),0 2px 6px rgba(0,0,0,.12);overflow:hidden;}',
      '.nv-hoja-borde{position:absolute;inset:24pt;pointer-events:none;}',
      '.nv-zona{position:absolute;overflow:hidden;font-size:11pt;line-height:1.15;color:#000;pointer-events:auto;cursor:default;}',
      '.nv-zona:hover{outline:1px dashed #9ab;}',
      '.nv-zona p{margin:0;}',
      '.nv-marca{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(-45deg);white-space:nowrap;font-weight:bold;opacity:.35;pointer-events:none;}',
      'body.nv-marcas p::after,body.nv-marcas h1::after,body.nv-marcas h2::after,body.nv-marcas h3::after,body.nv-marcas h4::after,body.nv-marcas li::after{content:"¶";color:#7a8ba0;font-weight:normal;font-style:normal;margin-left:1px;}',
      'body.nv-marcas .nv-salto{height:auto;border-top:1px dotted #7a8ba0;text-align:center;margin:6pt 0;}',
      'body.nv-marcas .nv-salto::before{content:"Salto de página";font:9pt sans-serif;color:#7a8ba0;background:#fff;padding:0 6px;position:relative;top:-0.7em;}',
      '.nv-salto{user-select:none;}',
      '.nv-buscar-res{background:#fff100;}',
      '.nv-cuadro{min-height:1em;}',
      'img[data-mce-selected]{outline:2px solid #2b7cd3;}',
      '.mce-content-body [contentEditable=false][data-mce-selected]{outline:2px solid #2b7cd3;}'
    ].join('\n');
  }
  function aplicarEstilos() {
    if (!ed) return;
    var d = ed.getDoc();
    var s1 = d.getElementById('nv-css-doc'); if (!s1) { s1 = d.createElement('style'); s1.id = 'nv-css-doc'; d.head.appendChild(s1); }
    var s2 = d.getElementById('nv-css-ed'); if (!s2) { s2 = d.createElement('style'); s2.id = 'nv-css-ed'; d.head.appendChild(s2); }
    s1.textContent = W.cssDocumento(); s2.textContent = cssEditor();
    ed.getBody().setAttribute('lang', W.aj.idioma || 'es-CO');
    ed.getBody().setAttribute('spellcheck', 'true');
    W.paginarYa();
  }
  W.aplicarEstilos = aplicarEstilos;
  W.cambiarAjustes = function(fn) {  // cambia ajustes, redibuja y marca para guardar
    if (W.est.soloLectura) return;
    fn(W.aj); aplicarEstilos(); W.marcarCambio(); if (W.regla) W.regla();
  };

  // ---------- Paginación (como Word: los bloques que no caben pasan a la página siguiente) ----------
  var GAP = 24, tPag = null;
  W.paginar = function() { clearTimeout(tPag); tPag = setTimeout(W.paginarYa, 120); };
  W.paginarYa = function() {
    clearTimeout(tPag);
    if (!ed || !ed.getDoc()) return;
    var d = ed.getDoc(), b = ed.getBody(), html = d.documentElement;
    var cont = d.getElementById('nv-hojas');
    if (!cont) { cont = d.createElement('div'); cont.id = 'nv-hojas'; cont.setAttribute('aria-hidden', 'true'); html.appendChild(cont); }
    var reglas = d.getElementById('nv-empujes');
    if (!reglas) { reglas = d.createElement('style'); reglas.id = 'nv-empujes'; d.head.appendChild(reglas); }
    NV.$$('[data-mce-nvp]', b).forEach(function(el) { el.removeAttribute('data-mce-nvp'); });
    reglas.textContent = '';
    if (W.est.vista === 'web') { cont.innerHTML = ''; W.paginas = 1; actualizarEstado(); return; }
    var dm = W.dim(), H = NV.cmAPx(dm.h), mt = NV.cmAPx(dm.m.sup), mb = NV.cmAPx(dm.m.inf), util = H - mt - mb, P = H + GAP;
    var txt = [], k = 0, saltoPend = false, prev = null;
    var T = parseFloat(ed.getWin().getComputedStyle(b).marginTop) || 0;  // offsetTop se mide desde el documento (el cuerpo no tiene position)
    var hijos = Array.prototype.filter.call(b.children, function(el) { return !el.hasAttribute('data-mce-bogus') && el.nodeName !== 'STYLE'; });
    hijos.forEach(function(el) {
      var esSalto = el.classList.contains('nv-salto');
      var top = el.offsetTop - T, alto = el.offsetHeight;
      var p = Math.floor(top / P), cTop = p * P + mt, cBot = p * P + H - mb, destino = null;
      if (saltoPend) destino = (top <= cTop + 1 ? cTop : (p + 1) * P + mt);
      else if (top > cBot - 2) destino = (p + 1) * P + mt;
      else if (top < cTop - 1) destino = cTop;
      else if (top + alto > cBot + 1 && alto <= util && !esSalto) destino = (p + 1) * P + mt;
      if (destino !== null && destino - top > 0.5) {
        var cs = ed.getWin().getComputedStyle(el), mt0 = parseFloat(cs.marginTop) || 0, mbPrev = 0;
        if (prev) mbPrev = parseFloat(ed.getWin().getComputedStyle(prev).marginBottom) || 0;
        var nuevo = (prev ? Math.max(mt0, mbPrev) : mt0) + (destino - top);
        el.setAttribute('data-mce-nvp', k);
        txt.push('[data-mce-nvp="' + k + '"]{margin-top:' + nuevo.toFixed(1) + 'px !important;}');
        reglas.textContent = txt.join('');
        k++;
      }
      saltoPend = esSalto;
      prev = el;
    });
    var ultimo = hijos[hijos.length - 1], fin = ultimo ? ultimo.offsetTop - T + ultimo.offsetHeight : 0;
    var n = Math.max(1, Math.ceil((fin + mb) / P - 0.0001));
    if (saltoPend) n = Math.max(n, Math.floor(fin / P) + 2);
    txt.push('body{min-height:' + (n * P - GAP) + 'px !important;}');
    reglas.textContent = txt.join('');
    W.paginas = n;
    dibujarHojas(cont, n, H, P);
    actualizarEstado();
  };
  function numFormato(n) {
    var f = W.aj.formatoNum || '1';
    if (f === 'i' || f === 'I') { var r = romano(n); return f === 'i' ? r.toLowerCase() : r; }
    if (f === 'a' || f === 'A') { var s = ''; while (n > 0) { n--; s = String.fromCharCode(97 + n % 26) + s; n = Math.floor(n / 26); } return f === 'A' ? s.toUpperCase() : s; }
    return String(n);
  }
  function romano(n) {
    var v = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1], s = ['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I'], r = '';
    for (var i = 0; i < v.length; i++) while (n >= v[i]) { r += s[i]; n -= v[i]; }
    return r;
  }
  W.numPagina = numFormato;
  W.camposHtml = function(html, pagina, total) {  // reemplaza {PÁGINA} y {PÁGINAS} en encabezado/pie
    return String(html || '').replace(/<span[^>]*data-campo="pagina"[^>]*>[^<]*<\/span>/g, numFormato(pagina + (W.aj.numInicio || 1) - 1))
      .replace(/<span[^>]*data-campo="paginas"[^>]*>[^<]*<\/span>/g, String(total))
      .replace(/<span[^>]*data-campo="fecha"[^>]*>[^<]*<\/span>/g, new Date().toLocaleDateString('es-CO'));
  };
  function dibujarHojas(cont, n, H, P) {
    var d = ed.getDoc(), b = ed.getBody(), a = W.aj, dm = W.dim();
    var csb = ed.getWin().getComputedStyle(b);  // el cuerpo está centrado con margin:auto (offsetLeft del body vale 0)
    var left = parseFloat(csb.marginLeft) || 0, top0 = parseFloat(csb.marginTop) || 0, Wd = b.offsetWidth;
    var ml = NV.cmAPx(dm.m.izq), mr = NV.cmAPx(dm.m.der), mt = NV.cmAPx(dm.m.sup), mb = NV.cmAPx(dm.m.inf);
    var de = NV.cmAPx(a.distEnc || 1.25), dp = NV.cmAPx(a.distPie || 1.25);
    var bp = a.bordePagina, ma = a.marcaAgua;
    var h = '';
    for (var i = 0; i < n; i++) {
      var y = top0 + i * P, primera = i === 0 && a.primeraDistinta;
      h += '<div class="nv-hoja" style="left:' + left + 'px;top:' + y + 'px;width:' + Wd + 'px;height:' + H + 'px;' + (a.colorPagina ? 'background:' + a.colorPagina + ';' : '') + '">';
      if (bp && bp.estilo && bp.estilo !== 'none') h += '<div class="nv-hoja-borde" style="border:' + (bp.grosor || 1) + 'pt ' + bp.estilo + ' ' + (bp.color || '#000') + '"></div>';
      if (ma && ma.texto) {
        var fs = Math.min(Wd, H) / Math.max(4, ma.texto.length) * 1.25;
        h += '<div class="nv-marca" style="font-family:' + NV.cssFuente(ma.fuente || 'Calibri').replace(/"/g, "'") + ';font-size:' + fs + 'px;color:' + (ma.color || '#bfbfbf') + '">' + NV.esc(ma.texto) + '</div>';
      }
      h += '</div>';
      var enc = primera ? (a.encabezadoPrimera || '') : a.encabezado, pie = primera ? (a.piePrimera || '') : a.pie;
      h += '<div class="nv-zona" data-zona="encabezado" title="Doble clic para editar el encabezado" style="left:' + (left + ml) + 'px;top:' + (y + de) + 'px;width:' + (Wd - ml - mr) + 'px;max-height:' + Math.max(16, mt - de) + 'px;">' +
           W.camposHtml(enc, i + 1, n) + '</div>';
      h += '<div class="nv-zona" data-zona="pie" title="Doble clic para editar el pie de página" style="left:' + (left + ml) + 'px;bottom:auto;top:' + (y + H - dp) + 'px;width:' + (Wd - ml - mr) + 'px;transform:translateY(-100%);max-height:' + Math.max(16, mb - dp) + 'px;">' +
           W.camposHtml(pie, i + 1, n) + '</div>';
    }
    cont.innerHTML = h;
    cont.style.height = (top0 + n * P) + 'px';
  }

  // ---------- Estado (barra inferior) ----------
  function paginaActual() {
    if (!ed || W.est.vista === 'web') return 1;
    var n = ed.selection.getNode(), b = ed.getBody();
    while (n && n.parentNode && n.parentNode !== b) n = n.parentNode;
    if (!n || n === b || !W.top(n) && W.top(n) !== 0) return 1;
    var P = NV.cmAPx(W.dim().h) + GAP;
    return Math.min(W.paginas || 1, Math.floor(W.top(n) / P) + 1);
  }
  W.paginaActual = paginaActual;
  // Posición vertical de un bloque del cuerpo medida desde el borde superior de la primera hoja.
  W.top = function(el) {
    var b = ed.getBody();
    while (el && el.parentNode && el.parentNode !== b) el = el.parentNode;
    return el ? el.offsetTop - (parseFloat(ed.getWin().getComputedStyle(b).marginTop) || 0) : 0;
  };
  W.contar = function() {
    var b = ed.getBody(), t = (b.innerText || '').replace(/ /g, ' ');
    var palabras = (t.match(/[^\s]+/g) || []).length;
    var sel = ed.selection.isCollapsed() ? '' : ed.selection.getContent({format: 'text'});
    return {palabras: palabras, caracteres: t.replace(/\n/g, '').length, sinEspacios: t.replace(/\s/g, '').length,
            parrafos: NV.$$('p,h1,h2,h3,h4,h5,h6,li', b).filter(function(p) { return p.textContent.trim(); }).length,
            lineas: Math.round(b.scrollHeight / 18), seleccion: sel ? (sel.match(/[^\s]+/g) || []).length : 0, paginas: W.paginas || 1};
  };
  var tEstado = null;
  function actualizarEstado() {
    clearTimeout(tEstado);
    tEstado = setTimeout(function() {
      if (!ed) return;
      var c = W.contar();
      var ep = NV.$('#nvEstPagina'), epal = NV.$('#nvEstPalabras');
      if (ep) ep.textContent = W.est.vista === 'web' ? 'Diseño web' : 'Página ' + paginaActual() + ' de ' + (W.paginas || 1);
      if (epal) epal.textContent = (c.seleccion ? c.seleccion + ' de ' : '') + c.palabras.toLocaleString('es-CO') + (c.palabras === 1 ? ' palabra' : ' palabras');
    }, 80);
  }
  W.actualizarEstado = actualizarEstado;

  // ---------- Guardado (autoguardado como en Microsoft 365) ----------
  var tGuardar = null;
  W.marcarCambio = function() {
    if (W.est.soloLectura) return;
    W.est.guardado = false; pintarGuardado();
    clearTimeout(tGuardar);
    if (W.est.autoguardado) tGuardar = setTimeout(function() { W.guardar(); }, 1500);
  };
  function pintarGuardado() {
    var e = NV.$('#nvEstadoDoc'); if (!e) return;
    e.textContent = W.est.soloLectura ? '· Solo lectura' : W.est.guardando ? '· Guardando…' : W.est.guardado ? '· Guardado' : (W.est.autoguardado ? '· Guardando…' : '· Sin guardar');
  }
  W.pintarGuardado = pintarGuardado;
  W.contenidoLimpio = function() {
    return ed.getContent();  // TinyMCE quita sus atributos internos (data-mce-*) y los elementos auxiliares
  };
  W.guardar = function(forzar) {
    clearTimeout(tGuardar);
    if (!ed || !W.doc || W.est.soloLectura) return Promise.resolve();
    if (W.est.guardando) { W.est.pendiente = true; return Promise.resolve(); }
    if (W.est.guardado && !forzar) return Promise.resolve();
    W.est.guardando = true; W.est.guardado = true; pintarGuardado();
    var cuerpo = {version: W.doc.version, titulo: W.doc.titulo, contenido: W.contenidoLimpio(), ajustes: W.aj};
    if (forzar === 'forzar') cuerpo.forzar = true;
    return NV.api('/design/api/office/docs/' + W.doc.id, {json: cuerpo}).then(function(r) {
      W.doc.version = r.version; W.doc.actualizadoEn = r.actualizadoEn;
    }).catch(function(e) {
      W.est.guardado = false;
      if (e.status === 409) {
        return NV.dialogo({titulo: 'Conflicto al guardar', html: '<p style="line-height:1.5;margin:0">' + NV.esc(e.message) +
          '</p><p style="line-height:1.5">¿Qué quieres hacer?</p>', ancho: 480,
          botones: [{texto: 'Guardar mi versión', prim: true, valor: 'mia'}, {texto: 'Abrir la otra versión', valor: 'otra'}, {texto: 'Cancelar', valor: null}]})
          .then(function(v) {
            if (v === 'mia') { W.est.guardando = false; return W.guardar('forzar'); }
            if (v === 'otra') { W.est.guardado = true; return W.abrirPorId(W.doc.id); }
          });
      }
      NV.toast('No se guardó: ' + e.message, true);
    }).then(function() {
      W.est.guardando = false; pintarGuardado();
      if (W.est.pendiente) { W.est.pendiente = false; if (!W.est.guardado) W.guardar(); }
    });
  };
  window.addEventListener('beforeunload', function(e) {
    if (W.doc && !W.est.guardado && !W.est.soloLectura) { W.guardar(); e.preventDefault(); e.returnValue = ''; }
  });

  // ---------- Abrir un documento ----------
  W.abrirPorId = function(id) {
    NV.cargando('Abriendo documento…');
    return NV.api('/design/api/office/docs/' + id).then(function(d) { NV.cargando(false); return W.abrir(d); })
      .catch(function(e) { NV.cargando(false); NV.toast('No se pudo abrir: ' + e.message, true); });
  };
  W.abrir = function(d) {
    W.doc = d;
    W.aj = Object.assign(W.ajustesPredeterminados(), d.ajustes || {});
    W.aj.pagina = Object.assign(W.ajustesPredeterminados().pagina, W.aj.pagina || {});
    W.est.soloLectura = d.permiso === 'ver';
    W.est.guardado = true;
    document.title = d.titulo + ' - Nuvia Word';
    try { history.replaceState(null, '', '/design/office?doc=' + d.id); } catch (e) {}
    NV.mostrarVista('word');
    NV.$('#nvDocTitulo').textContent = d.titulo;
    pintarGuardado();
    return iniciarEditor().then(function() {
      ed.setContent(d.contenido || '<p><br></p>');
      ed.undoManager.clear(); ed.undoManager.add();
      ed.mode.set(W.est.soloLectura ? 'readonly' : 'design');
      aplicarEstilos();
      ed.focus(); ed.selection.select(ed.getBody(), true); ed.selection.collapse(true);
      if (W.cinta) W.cinta.refrescar();
      if (W.regla) W.regla();
      setTimeout(W.paginarYa, 300); setTimeout(W.paginarYa, 1200);  // fuentes e imágenes que cargan después
    });
  };

  // ---------- Motor de edición ----------
  var listo = null;
  function iniciarEditor() {
    if (listo) return listo;
    listo = NV.lib.tinymce().then(function(tinymce) {
      return new Promise(function(ok) {
        tinymce.init({
          target: NV.$('#nvEditor'), license_key: 'gpl', base_url: NV.CDN.tinymce.replace(/\/tinymce\.min\.js$/, ''), suffix: '.min',
          language: 'es', language_url: 'https://cdn.jsdelivr.net/npm/tinymce-i18n@24.12.9/langs7/es.js',
          menubar: false, toolbar: false, statusbar: false, branding: false, promotion: false, height: '100%', resize: false,
          plugins: 'lists advlist table image link charmap searchreplace wordcount nonbreaking visualchars visualblocks anchor directionality',
          content_css: [NV.FUENTES_GOOGLE], content_style: '', body_class: 'nv-cuerpo',
          browser_spellcheck: true, contextmenu: false, object_resizing: 'img,table', resize_img_proportional: true,
          table_toolbar: '', table_resize_bars: true, table_default_attributes: {}, table_default_styles: {'border-collapse': 'collapse', width: '100%'},
          table_use_colgroups: false, table_sizing_mode: 'relative', table_header_type: 'section',
          image_caption: false, image_advtab: true, paste_data_images: true, automatic_uploads: false,
          images_dataimg_filter: function() { return false; },  // las imágenes quedan como datos (no como direcciones blob: temporales)
          images_upload_handler: function(blob) {
            return new Promise(function(ok) { var r = new FileReader(); r.onload = function() { ok(r.result); }; r.readAsDataURL(blob.blob()); });
          },
          link_default_target: '_blank', link_assume_external_targets: 'https', convert_urls: false, relative_urls: false,
          indentation: '1.27cm', indent_use_margin: true, nonbreaking_force_tab: false, table_tab_navigation: true, lists_indent_on_tab: true,
          entity_encoding: 'raw', forced_root_block: 'p', keep_styles: true, end_container_on_empty_block: true,
          valid_children: '+body[style],+div[p|h1|h2|h3|h4|h5|h6|ul|ol|table|div|img]',
          extended_valid_elements: 'span[*],div[*],p[*],sup[*],a[*],img[*],hr[*],table[*],td[*],th[*],tr[*]',
          font_family_formats: NV.FUENTES.map(function(f) { return f.n + '=' + f.css.replace(/"/g, ''); }).join(';'),
          font_size_formats: '8pt 9pt 10pt 10.5pt 11pt 12pt 14pt 16pt 18pt 20pt 22pt 24pt 26pt 28pt 36pt 48pt 72pt',
          line_height_formats: '1 1.08 1.15 1.5 2 2.5 3',
          formats: W.formatos(),
          style_formats_autohide: true,
          setup: function(editor) {
            ed = editor;
            editor.on('PreInit', function() {  // el atributo de la paginación nunca se guarda en el documento
              editor.serializer.addAttributeFilter('data-mce-nvp', function(nodos, nombre) { nodos.forEach(function(n) { n.attr(nombre, null); }); });
            });
            editor.on('init', function() { ok(editor); });
            W.configurarEventos(editor);
          }
        });
      });
    });
    return listo;
  }
  W.formatos = function() {
    var f = {
      underline: {inline: 'span', styles: {'text-decoration': 'underline'}, exact: true},
      strikethrough: {inline: 'span', styles: {'text-decoration': 'line-through'}, exact: true},
      subDoble: {inline: 'span', styles: {'text-decoration': 'underline', 'text-decoration-style': 'double'}},
      subPunteado: {inline: 'span', styles: {'text-decoration': 'underline', 'text-decoration-style': 'dotted'}},
      subDiscontinuo: {inline: 'span', styles: {'text-decoration': 'underline', 'text-decoration-style': 'dashed'}},
      subOndulado: {inline: 'span', styles: {'text-decoration': 'underline', 'text-decoration-style': 'wavy'}},
      subGrueso: {inline: 'span', styles: {'text-decoration': 'underline', 'text-decoration-thickness': '2px'}},
      tachadoDoble: {inline: 'span', styles: {'text-decoration': 'line-through', 'text-decoration-style': 'double'}},
      versalitas: {inline: 'span', styles: {'font-variant': 'small-caps'}},
      todoMayus: {inline: 'span', styles: {'text-transform': 'uppercase'}},
      oculto: {inline: 'span', styles: {display: 'none'}},
      espaciado: {inline: 'span', styles: {'letter-spacing': '%valor'}},
      Normal: {block: 'p', remove: 'all'},
      NoSpacing: {block: 'p', classes: 'nv-NoSpacing'},
      Title: {block: 'p', classes: 'nv-Title'}, Subtitle: {block: 'p', classes: 'nv-Subtitle'},
      Quote: {block: 'p', classes: 'nv-Quote'}, IntenseQuote: {block: 'p', classes: 'nv-IntenseQuote'},
      ListParagraph: {block: 'p', classes: 'nv-ListParagraph'}, Caption: {block: 'p', classes: 'nv-Caption'},
      SubtleEmphasis: {inline: 'span', classes: 'nv-SubtleEmphasis'}, Emphasis: {inline: 'em'},
      IntenseEmphasis: {inline: 'span', classes: 'nv-IntenseEmphasis'}, Strong: {inline: 'strong'},
      SubtleReference: {inline: 'span', classes: 'nv-SubtleReference'}, IntenseReference: {inline: 'span', classes: 'nv-IntenseReference'},
      BookTitle: {inline: 'span', classes: 'nv-BookTitle'},
      sombra: {inline: 'span', classes: 'nv-sombra'}, contorno: {inline: 'span', classes: 'nv-contorno'}, resplandor: {inline: 'span', classes: 'nv-resplandor'}
    };
    for (var i = 1; i <= 6; i++) f['Heading' + i] = {block: 'h' + i, remove: 'all'};
    return f;
  };

  W.configurarEventos = function(editor) {
    var refrescar = function() { if (W.cinta) W.cinta.refrescar(); actualizarEstado(); };
    editor.on('NodeChange', refrescar);
    editor.on('input Undo Redo ExecCommand SetContent', function(e) {
      if (e.type === 'setcontent' && e.initial) return;
      W.paginar();
      if (e.type !== 'setcontent' || !e.load) {
        if (e.type === 'execcommand' && /^(mceFocus|SelectAll|mceVisual|mceToggleVisualAid|mceAddUndoLevel)/.test(e.command)) return;
        if (W.doc && editor.isDirty()) { editor.setDirty(false); W.marcarCambio(); }
      }
    });
    editor.on('change keyup', function() {
      if (W.doc && editor.isDirty()) { editor.setDirty(false); W.marcarCambio(); }
      W.paginar();
    });
    editor.on('ObjectResized', function() { W.marcarCambio(); W.paginar(); });
    editor.on('init', function() {
      var dd = editor.getDoc();
      dd.addEventListener('load', function() { W.paginar(); }, true);  // imágenes que terminan de cargar
      // Doble clic en el encabezado o el pie (están detrás del texto, así que se ubican por la posición del clic)
      dd.addEventListener('dblclick', function(e) {
        if (!W.dialogos || W.est.soloLectura || W.est.vista !== 'impresion') return;
        var zona = NV.$$('.nv-zona', dd).filter(function(z) { var r = z.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top - 4 && e.clientY <= r.bottom + 4; })[0];
        if (!zona) {  // zona vacía: cualquier clic en el margen superior o inferior de una hoja
          var hoja = NV.$$('.nv-hoja', dd).filter(function(h) { var r = h.getBoundingClientRect(); return e.clientY >= r.top && e.clientY <= r.bottom; })[0];
          if (hoja) {
            var r = hoja.getBoundingClientRect(), z = W.est.zoom / 100, mt = NV.cmAPx(W.aj.pagina.margenes.sup) * z, mb = NV.cmAPx(W.aj.pagina.margenes.inf) * z;
            if (e.clientY < r.top + mt) zona = {getAttribute: function() { return 'encabezado'; }};
            else if (e.clientY > r.bottom - mb) zona = {getAttribute: function() { return 'pie'; }};
          }
        }
        if (zona) { e.preventDefault(); W.dialogos.encabezadoPie(zona.getAttribute('data-zona')); }
      });
      editor.getWin().addEventListener('scroll', function() { actualizarEstado(); });
      if (dd.fonts && dd.fonts.ready) dd.fonts.ready.then(function() { W.paginarYa(); });
    });
    editor.on('ResizeEditor ResizeWindow', function() { W.paginar(); if (W.regla) W.regla(); });
    editor.on('keydown', function(e) {
      if (W.atajos && W.atajos(e, true)) return;
      // Tab como en Word: en tablas pasa de celda (lo maneja el complemento de tablas), en listas cambia el nivel; en el texto, tabulación
      if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey && !W.est.soloLectura) {
        var n = editor.selection.getNode();
        if (editor.dom.getParent(n, 'td,th,li')) return;
        if (e.shiftKey) { e.preventDefault(); editor.execCommand('Outdent'); return; }
        e.preventDefault(); editor.insertContent('&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;');
      }
    });
    // Al pegar desde Word/web se conservan negritas, colores, tablas e imágenes; se quitan los estilos de clases ajenas.
    editor.on('PastePostProcess', function(e) {
      NV.$$('[class]', e.node).forEach(function(el) {
        var c = (el.getAttribute('class') || '').split(/\s+/).filter(function(x) { return /^nv-/.test(x); }).join(' ');
        if (c) el.setAttribute('class', c); else el.removeAttribute('class');
      });
    });
  };

  // ---------- Zoom y vistas ----------
  W.zoom = function(z) {
    z = Math.max(10, Math.min(500, Math.round(z)));
    W.est.zoom = z;
    if (ed) { ed.getDoc().documentElement.style.zoom = (z / 100); ed.getDoc().documentElement.classList.toggle('nv-zoom', z !== 100); W.paginar(); }
    var r = NV.$('#nvZoomRango'), t = NV.$('#nvZoomTxt');
    if (r) r.value = z; if (t) t.textContent = z + '%';
    if (W.regla) W.regla();
  };
  W.zoomAjustar = function(modo) {
    if (!ed) return;
    var f = ed.getContainer().querySelector('iframe'), d = W.dim();
    var anchoPx = NV.cmAPx(d.w), altoPx = NV.cmAPx(d.h);
    var zw = (f.clientWidth - 48) / anchoPx * 100, zh = (f.clientHeight - 60) / altoPx * 100;
    W.zoom(modo === 'pagina' ? Math.min(zw, zh) : modo === 'varias' ? Math.min(zw / 2.1, zh) : zw);
  };
  W.vista = function(v) {
    W.est.vista = v;
    document.body.classList.toggle('nv-lectura', v === 'lectura');
    if (ed) {
      ed.getDoc().documentElement.classList.toggle('nv-web', v === 'web');
      ed.mode.set(v === 'lectura' || W.est.soloLectura ? 'readonly' : 'design');
    }
    NV.$$('[data-vista]').forEach(function(b) { b.classList.toggle('on', b.getAttribute('data-vista') === v); });
    var rg = NV.$('#nvRegla'); if (rg) rg.classList.toggle('nv-oculto', !W.est.regla || v !== 'impresion');
    W.paginarYa();
    if (W.cinta) W.cinta.refrescar();
  };
  W.marcasFormato = function(on) {
    W.est.marcas = on === undefined ? !W.est.marcas : on;
    if (ed) { ed.getBody().classList.toggle('nv-marcas', W.est.marcas); ed.execCommand('mceVisualChars', false, W.est.marcas); }
    W.paginar(); if (W.cinta) W.cinta.refrescar();
  };

  // ---------- Regla horizontal con márgenes que se arrastran ----------
  W.regla = function() {
    var rg = NV.$('#nvRegla');
    if (!rg || rg.classList.contains('nv-oculto') || !ed || !ed.getDoc()) return;
    var b = ed.getBody(), z = W.est.zoom / 100, d = W.dim(), f = ed.getContainer().querySelector('iframe');
    var sx = ed.getWin().scrollX || 0;
    var left = ((parseFloat(ed.getWin().getComputedStyle(b).marginLeft) || 0) * z) - sx * z + (f.getBoundingClientRect().left - rg.getBoundingClientRect().left);
    var ancho = NV.cmAPx(d.w) * z, ml = NV.cmAPx(d.m.izq) * z, mr = NV.cmAPx(d.m.der) * z, cm = NV.cmAPx(1) * z;
    var h = '<div class="nv-regla-c" style="left:' + left + 'px;width:' + ancho + 'px">' +
      '<div class="nv-regla-m" style="left:0;width:' + ml + 'px"></div><div class="nv-regla-m" style="right:0;width:' + mr + 'px"></div></div>';
    for (var i = 1; i < d.w - d.m.izq; i++) {
      var x = left + ml + i * cm;
      if (x > left + ancho - 4) break;
      h += '<span class="nv-regla-t" style="left:' + x + 'px">' + i + '</span>';
    }
    for (var j = 1; j < (d.w - d.m.izq) * 4; j++) {
      if (j % 4 === 0) continue;
      var xx = left + ml + j * cm / 4; if (xx > left + ancho - mr) break;
      h += '<span class="nv-regla-tick" style="left:' + xx + 'px;height:' + (j % 2 ? 3 : 5) + 'px"></span>';
    }
    h += '<div class="nv-regla-h" data-lado="izq" title="Margen izquierdo" style="left:' + (left + ml) + 'px"></div>' +
         '<div class="nv-regla-h" data-lado="der" title="Margen derecho" style="left:' + (left + ancho - mr) + 'px"></div>';
    rg.innerHTML = h;
    NV.$$('.nv-regla-h', rg).forEach(function(hd) {
      hd.onmousedown = function(e) {
        if (W.est.soloLectura) return;
        e.preventDefault();
        var lado = hd.getAttribute('data-lado'), x0 = e.clientX, m0 = W.aj.pagina.margenes[lado];
        function mover(ev) {
          var dcm = NV.pxACm((ev.clientX - x0) / z) * (lado === 'izq' ? 1 : -1);
          var v = Math.max(0.3, Math.min(d.w / 2 - 1, Math.round((m0 + dcm) * 20) / 20));
          W.aj.pagina.margenes[lado] = v; aplicarEstilos(); W.regla();
        }
        function soltar() { document.removeEventListener('mousemove', mover); document.removeEventListener('mouseup', soltar); W.marcarCambio(); }
        document.addEventListener('mousemove', mover); document.addEventListener('mouseup', soltar);
      };
    });
  };

  // ---------- Utilidades sobre la selección ----------
  W.bloquesSeleccionados = function() {
    var bl = ed.selection.getSelectedBlocks();
    return bl && bl.length ? bl : [ed.dom.getParent(ed.selection.getNode(), ed.dom.isBlock) || ed.getBody().firstChild].filter(Boolean);
  };
  W.estiloBloques = function(estilos) {
    ed.undoManager.transact(function() {
      W.bloquesSeleccionados().forEach(function(b) { if (b !== ed.getBody()) ed.dom.setStyles(b, estilos); });
    });
    ed.nodeChanged(); W.marcarCambio(); W.paginar();
  };
  // Aplica una función a cada texto seleccionado (cambiar mayúsculas y minúsculas).
  W.transformarTexto = function(fn) {
    var rng = ed.selection.getRng();
    if (rng.collapsed) {  // Word: sin selección cambia la palabra donde está el cursor
      var tn = rng.startContainer;
      if (tn.nodeType !== 3) return;
      var s = rng.startOffset, txt = tn.data, i = s, j = s;
      while (i > 0 && /\S/.test(txt[i - 1])) i--;
      while (j < txt.length && /\S/.test(txt[j])) j++;
      rng.setStart(tn, i); rng.setEnd(tn, j); ed.selection.setRng(rng);
    }
    ed.undoManager.transact(function() {
      var r = ed.selection.getRng(), raiz = r.commonAncestorContainer.nodeType === 3 ? r.commonAncestorContainer.parentNode : r.commonAncestorContainer;
      var walker = ed.getDoc().createTreeWalker(raiz, NodeFilter.SHOW_TEXT), nodos = [], n;
      while ((n = walker.nextNode())) if (r.intersectsNode(n)) nodos.push(n);
      if (r.commonAncestorContainer.nodeType === 3) nodos = [r.commonAncestorContainer];
      var completo = nodos.map(function(t) {
        var a = t === r.startContainer ? r.startOffset : 0, b = t === r.endContainer ? r.endOffset : t.data.length;
        return t.data.slice(a, b);
      }).join('\u0000');
      var nuevo = fn(completo).split('\u0000');
      var sc = r.startContainer, so = r.startOffset, ec = r.endContainer, eo = r.endOffset;
      nodos.forEach(function(t, k) {
        var a = t === sc ? so : 0, b = t === ec ? eo : t.data.length;
        t.data = t.data.slice(0, a) + (nuevo[k] || '') + t.data.slice(b);
      });
    });
    W.marcarCambio();
  };
})();
