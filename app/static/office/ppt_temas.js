/* Nuvia PowerPoint: temas (colores, fuentes, fondo y adornos) y diseños de diapositiva como en PowerPoint.
   Coordenadas en puntos: la diapositiva 16:9 mide 960 x 540 (13,33 x 7,5 pulgadas). */
(function() {
  'use strict';
  var NV = window.NV, P = NV.ppt = NV.ppt || {};

  P.TAMANOS = {
    '16:9': {n: 'Panorámica (16:9)', w: 960, h: 540},
    '4:3': {n: 'Estándar (4:3)', w: 720, h: 540},
    '16:10': {n: 'Panorámica (16:10)', w: 864, h: 540},
    'a4': {n: 'Papel A4', w: 780, h: 540}
  };
  // c = colores: oscuro1 (texto), claro1 (fondo), oscuro2, claro2, acento1..6
  P.TEMAS = {
    office: {n: 'Office', titulos: 'Calibri Light', cuerpo: 'Calibri',
             c: {o1: '#000000', c1: '#FFFFFF', o2: '#44546A', c2: '#E7E6E6', a: ['#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47']},
             fondo: {tipo: 'color', color: '#FFFFFF'}, adornos: 'ninguno'},
    faceta: {n: 'Faceta', titulos: 'Trebuchet MS', cuerpo: 'Trebuchet MS',
             c: {o1: '#000000', c1: '#FFFFFF', o2: '#2C3C43', c2: '#EBEBEB', a: ['#90C226', '#54A021', '#E6B91E', '#E76618', '#C42F1A', '#918655']},
             fondo: {tipo: 'color', color: '#FFFFFF'}, adornos: 'faceta'},
    ion: {n: 'Ion', titulos: 'Century Gothic', cuerpo: 'Century Gothic', claroSobreOscuro: true,
          c: {o1: '#FFFFFF', c1: '#1E5155', o2: '#1E5155', c2: '#C8E2DE', a: ['#B01513', '#EA6312', '#E6B729', '#6AAC90', '#54849A', '#9E5E9B']},
          fondo: {tipo: 'color', color: '#1E5155'}, adornos: 'ion'},
    retrospectiva: {n: 'Retrospectiva', titulos: 'Calibri Light', cuerpo: 'Calibri',
                    c: {o1: '#000000', c1: '#FFFFFF', o2: '#637052', c2: '#CCDDEA', a: ['#E48312', '#BD582C', '#865640', '#9B8357', '#C2BC80', '#94A088']},
                    fondo: {tipo: 'color', color: '#FFFFFF'}, adornos: 'retro'},
    integral: {n: 'Integral', titulos: 'Tw Cen MT', cuerpo: 'Tw Cen MT',
               c: {o1: '#000000', c1: '#FFFFFF', o2: '#335B74', c2: '#DFE3E5', a: ['#1CADE4', '#2683C6', '#27CED7', '#42BA97', '#3E8853', '#62A39F']},
               fondo: {tipo: 'color', color: '#FFFFFF'}, adornos: 'integral'},
    galeria: {n: 'Galería', titulos: 'Gill Sans MT', cuerpo: 'Gill Sans MT',
              c: {o1: '#000000', c1: '#FFFFFF', o2: '#454551', c2: '#D8D9DC', a: ['#A5644E', '#B58B80', '#C3986D', '#A19574', '#C17529', '#826277']},
              fondo: {tipo: 'color', color: '#F5F4F2'}, adornos: 'galeria'},
    nuvia: {n: 'Nuvia', titulos: 'Montserrat', cuerpo: 'Lato',
            c: {o1: '#0F1B33', c1: '#FFFFFF', o2: '#1D4ED8', c2: '#EFF6FF', a: ['#1D4ED8', '#0D9488', '#F59E0B', '#DC2626', '#7C3AED', '#64748B']},
            fondo: {tipo: 'color', color: '#FFFFFF'}, adornos: 'nuvia'},
    noche: {n: 'Noche', titulos: 'Segoe UI', cuerpo: 'Segoe UI', claroSobreOscuro: true,
            c: {o1: '#FFFFFF', c1: '#1F2430', o2: '#2B3142', c2: '#9AA3B5', a: ['#4FC3F7', '#FFB74D', '#81C784', '#E57373', '#BA68C8', '#90A4AE']},
            fondo: {tipo: 'degradado', desde: '#2B3142', hasta: '#141821', angulo: 135}, adornos: 'ninguno'},
    minimal: {n: 'Minimalista', titulos: 'Georgia', cuerpo: 'Open Sans',
              c: {o1: '#262626', c1: '#FFFFFF', o2: '#404040', c2: '#F2F2F2', a: ['#262626', '#7F7F7F', '#C00000', '#1F4E79', '#548235', '#BF9000']},
              fondo: {tipo: 'color', color: '#FFFFFF'}, adornos: 'minimal'}
  };
  P.VARIANTES = [  // paletas alternativas de acentos (Diseño › Variantes)
    ['#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47'],
    ['#156082', '#E97132', '#196B24', '#0F9ED5', '#A02B93', '#4EA72E'],
    ['#C00000', '#FF6600', '#FFC000', '#70AD47', '#4472C4', '#7030A0'],
    ['#2E7D32', '#00897B', '#0277BD', '#5E35B1', '#AD1457', '#EF6C00']
  ];
  P.tema = function(pres) { return pres.tema || P.TEMAS.office; };
  P.color = function(pres, clave) {  // clave: 'o1','c1','o2','c2','a1'..'a6' o un color
    if (!clave) return null;
    if (clave.charAt(0) === '#' || /^rgb/.test(clave)) return clave;
    var c = P.tema(pres).c;
    if (/^a\d$/.test(clave)) return c.a[+clave[1] - 1];
    return c[clave] || clave;
  };

  // Adornos de cada tema (formas que forman parte del diseño, detrás del contenido)
  function adornos(tipoAdorno, tema, w, h, tipoDiseno) {
    var a1 = tema.c.a[0], a2 = tema.c.a[1], o2 = tema.c.o2, out = [];
    var R = function(x, y, ww, hh, color, extra) { out.push(Object.assign({id: 'ad' + out.length, tipo: 'forma', forma: 'rect', x: x, y: y, w: ww, h: hh, estilo: {relleno: color, borde: 'none'}}, extra || {})); };
    var titulo = tipoDiseno === 'titulo' || tipoDiseno === 'seccion';
    switch (tipoAdorno) {
      case 'faceta': R(0, 0, w * 0.06, h, a1); R(w * 0.06, 0, 6, h, a2); break;
      case 'ion': if (titulo) R(0, h * 0.62, w, h * 0.38, '#163D40'); else R(w - 70, 0, 70, h, '#163D40'); break;
      case 'retro': R(0, h - 36, w, 36, a1); if (titulo) R(0, 0, w, 10, a1); break;
      case 'integral': R(0, 0, 18, h, a1); if (titulo) R(w * 0.06, h * 0.56, w * 0.88, 3, a1); break;
      case 'galeria': R(30, 30, w - 60, h - 60, 'none', {estilo: {relleno: 'none', borde: '#A5644E', grosor: 1.5}}); break;
      case 'nuvia': R(0, h - 8, w, 8, a1); if (titulo) { R(0, 0, w, h * 0.06, a1); R(w * 0.08, h * 0.6, 120, 6, tema.c.a[1]); } else R(40, 108, 80, 4, a1); break;
      case 'minimal': if (!titulo) R(60, 112, w - 120, 1, '#BFBFBF'); else R(w / 2 - 40, h * 0.58, 80, 2, '#262626'); break;
    }
    return out;
  }
  // Diseños de diapositiva (marcadores de posición) para un tamaño dado.
  P.disenosBase = function(tema, tam) {
    var w = tam.w, h = tam.h, m = Math.round(w * 0.0625), ancho = w - 2 * m, k = h / 540, t = tema;
    var col = t.claroSobreOscuro ? t.c.o1 : null;
    var M = function(rol, x, y, ww, hh, extra) { return Object.assign({rol: rol, x: Math.round(x), y: Math.round(y * k), w: Math.round(ww), h: Math.round(hh * k)}, extra || {}); };
    var tit = function(extra) { return M('titulo', m, 30, ancho, 90, Object.assign({fs: 40, fuente: t.titulos, valign: 'middle', color: col}, extra || {})); };
    var cuerpo = function(x, y, ww, hh, extra) { return M('cuerpo', x, y, ww, hh, Object.assign({fs: 24, fuente: t.cuerpo, vinetas: true, valign: 'top', color: col}, extra || {})); };
    var lista = [
      {id: 'titulo', nombre: 'Diapositiva de título', marcadores: [M('titulo', m * 1.6, 150, w - m * 3.2, 130, {fs: 54, fuente: t.titulos, align: 'center', valign: 'bottom', color: col}),
                                                          M('subtitulo', m * 1.6, 295, w - m * 3.2, 80, {fs: 24, fuente: t.cuerpo, align: 'center', valign: 'top', color: col || '#595959'})]},
      {id: 'tituloObjetos', nombre: 'Título y objetos', marcadores: [tit(), cuerpo(m, 135, ancho, 360)]},
      {id: 'seccion', nombre: 'Encabezado de sección', marcadores: [M('titulo', m, 140, ancho, 140, {fs: 54, fuente: t.titulos, valign: 'bottom', color: col}),
                                                                M('texto', m, 290, ancho, 80, {fs: 24, fuente: t.cuerpo, valign: 'top', color: col || '#595959'})]},
      {id: 'dosObjetos', nombre: 'Dos objetos', marcadores: [tit(), cuerpo(m, 135, ancho / 2 - 15, 360), cuerpo(m + ancho / 2 + 15, 135, ancho / 2 - 15, 360)]},
      {id: 'comparacion', nombre: 'Comparación', marcadores: [tit(), M('texto', m, 128, ancho / 2 - 15, 48, {fs: 24, fuente: t.cuerpo, negrita: true, valign: 'bottom', color: col}),
                                                          cuerpo(m, 182, ancho / 2 - 15, 315), M('texto', m + ancho / 2 + 15, 128, ancho / 2 - 15, 48, {fs: 24, fuente: t.cuerpo, negrita: true, valign: 'bottom', color: col}),
                                                          cuerpo(m + ancho / 2 + 15, 182, ancho / 2 - 15, 315)]},
      {id: 'soloTitulo', nombre: 'Solo el título', marcadores: [tit()]},
      {id: 'blanco', nombre: 'En blanco', marcadores: []},
      {id: 'contenidoTitulo', nombre: 'Contenido con título', marcadores: [M('titulo', m, 36, ancho * 0.36, 110, {fs: 32, fuente: t.titulos, valign: 'bottom', color: col}),
                                                                        cuerpo(m + ancho * 0.4, 36, ancho * 0.6, 460, {fs: 28}),
                                                                        M('texto', m, 160, ancho * 0.36, 336, {fs: 16, fuente: t.cuerpo, valign: 'top', color: col})]},
      {id: 'imagenTitulo', nombre: 'Imagen con título', marcadores: [M('titulo', m, 36, ancho * 0.36, 110, {fs: 32, fuente: t.titulos, valign: 'bottom', color: col}),
                                                                  M('imagen', m + ancho * 0.4, 36, ancho * 0.6, 460, {}),
                                                                  M('texto', m, 160, ancho * 0.36, 336, {fs: 16, fuente: t.cuerpo, valign: 'top', color: col})]}
    ];
    lista.forEach(function(d) { d.adornos = adornos(t.adornos, t, w, h, d.id); d.fondo = null; });
    return lista;
  };
  P.TEXTOS_MARCADOR = {titulo: 'Haga clic para agregar título', subtitulo: 'Haga clic para agregar subtítulo', cuerpo: 'Haga clic para agregar texto',
                       texto: 'Haga clic para agregar texto', imagen: 'Haga clic en el ícono para agregar una imagen'};

  // Presentación nueva con un tema
  P.nueva = function(temaId, tamId) {
    var tema = JSON.parse(JSON.stringify(P.TEMAS[temaId || 'office'] || P.TEMAS.office)), tam = Object.assign({id: tamId || '16:9'}, P.TAMANOS[tamId || '16:9']);
    var pres = {version: 1, tam: tam, tema: tema, temaId: temaId || 'office', disenos: P.disenosBase(tema, tam), diapositivas: [],
                pie: {numero: false, fecha: false, formatoFecha: '{dd}/{mm}/{aaaa}', texto: '', noEnTitulo: true}, idioma: 'es-CO'};
    pres.diapositivas.push(P.diapositivaDesdeDiseno(pres, 'titulo'));
    return pres;
  };
  P.uid = function(p) { return (p || 'e') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); };
  P.diseno = function(pres, id) { return pres.disenos.filter(function(d) { return d.id === id; })[0] || pres.disenos[0]; };
  P.diapositivaDesdeDiseno = function(pres, disenoId) {
    var d = P.diseno(pres, disenoId);
    return {id: P.uid('d'), diseno: d.id, fondo: null, oculta: false, notas: '', transicion: {tipo: 'ninguna', dur: 0.7}, avance: {clic: true, seg: null},
            elementos: d.marcadores.map(function(mk) { return P.elementoDesdeMarcador(mk); })};
  };
  P.elementoDesdeMarcador = function(mk) {
    var e = {id: P.uid(), tipo: mk.rol === 'imagen' ? 'imagen' : 'texto', marcador: mk.rol, x: mk.x, y: mk.y, w: mk.w, h: mk.h, rot: 0, html: '',
             estilo: {fs: mk.fs || 18, fuente: mk.fuente, align: mk.align || 'left', valign: mk.valign || 'top', color: mk.color || null, negrita: !!mk.negrita, vinetas: !!mk.vinetas}};
    if (mk.rol === 'imagen') { e.src = ''; e.vacia = true; }
    return e;
  };
  // Cambia el diseño de una diapositiva conservando el contenido de los marcadores por rol.
  P.cambiarDiseno = function(pres, diap, disenoId) {
    var d = P.diseno(pres, disenoId), viejos = diap.elementos.filter(function(e) { return e.marcador; }), resto = diap.elementos.filter(function(e) { return !e.marcador; });
    var nuevos = d.marcadores.map(function(mk) {
      var e = P.elementoDesdeMarcador(mk), i = viejos.findIndex(function(v) { return v.marcador === mk.rol; });
      if (i >= 0) { var v = viejos.splice(i, 1)[0]; e.html = v.html; if (v.tipo === 'imagen') { e.src = v.src; e.vacia = v.vacia; } }
      return e;
    });
    viejos.forEach(function(v) { if ((v.html && v.html.replace(/<[^>]+>/g, '').trim()) || (v.tipo === 'imagen' && !v.vacia)) { delete v.marcador; resto.push(v); } });
    diap.diseno = d.id; diap.elementos = nuevos.concat(resto);
  };
  // Aplica otro tema conservando el contenido (cambia fuentes/colores de los marcadores y los adornos).
  P.aplicarTema = function(pres, temaId, variante) {
    var tema = JSON.parse(JSON.stringify(P.TEMAS[temaId] || P.tema(pres)));
    if (variante) tema.c.a = variante.slice();
    var importados = pres.disenos.some(function(d) { return d.importado; });
    pres.tema = tema; pres.temaId = temaId;
    if (!importados) {
      var base = P.disenosBase(tema, pres.tam);
      pres.disenos = base;
      pres.diapositivas.forEach(function(s) {
        var d = P.diseno(pres, s.diseno);
        s.elementos.forEach(function(e) {
          if (!e.marcador) return;
          var mk = d.marcadores.filter(function(m) { return m.rol === e.marcador; })[0];
          if (mk) { e.estilo.fuente = mk.fuente; e.estilo.color = mk.color || null; }
        });
      });
    }
  };
  P.fondoCss = function(f, pres) {
    f = f || P.tema(pres).fondo;
    if (!f) return '#FFFFFF';
    if (f.tipo === 'degradado') return 'linear-gradient(' + (f.angulo || 90) + 'deg,' + f.desde + ',' + f.hasta + ')';
    if (f.tipo === 'imagen' && f.src) return '#fff url("' + (f.src.indexOf('res:') === 0 ? (((pres && pres.recursos) || (P.pres && P.pres.recursos) || {})[f.src.slice(4)] || '') : f.src) + '") center/' + (f.ajuste || 'cover') + ' no-repeat';
    return f.color || '#FFFFFF';
  };
})();
