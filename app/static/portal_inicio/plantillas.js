/* Plantillas listas para la página principal del portal (se pueden editar después).
   Todas usan la paleta de Nuvia: azul noche #1a1449, índigo #252772 y azul claro #2f98d5. */
(function() {
  'use strict';
  var NVI = window.NVI, PH = NVI.placeholder;
  var N = '#1a1449', I = '#252772', A = '#2f98d5', AS = '#e8f4fb', IS = '#eef0fa', B = '#ffffff';
  function b(tipo, p, estilo) { return {id: NVI.uid('b'), tipo: tipo, p: Object.assign(NVI.BLOQUES[tipo].d(), p || {}), estilo: estilo || {}}; }
  function col(ancho, bloques) { return {id: NVI.uid('c'), ancho: ancho, bloques: bloques || []}; }
  function sec(estilo, columnas) { return {id: NVI.uid('s'), tipo: 'columnas', estilo: Object.assign(NVI.estiloSeccion(), estilo || {}), columnas: columnas}; }
  var T = function(html, nivel, extra, estilo) { return b('titulo', Object.assign({html: html, nivel: nivel || 'h2'}, extra || {}), estilo); };
  var P = function(html, extra, estilo) { return b('texto', Object.assign({html: html}, extra || {}), estilo); };
  var an = function(tipo, retraso, extra) { return Object.assign({animacion: tipo, retraso: retraso || 0}, extra || {}); };
  var TEMA = function(extra) { return Object.assign({fuenteTitulos: 'Poppins', fuenteTexto: 'Inter', primario: I, secundario: N, acento: A, fondo: B, texto: N, radio: 16}, extra || {}); };
  var FOTO = function(t) { return PH(t || 'Foto del equipo', A, I); };
  var ACCESOS = [
    {icono: '🗓️', titulo: 'People', texto: 'Permisos, horas extra y certificaciones.', enlace: '/panel', textoEnlace: 'Abrir'},
    {icono: '🏭', titulo: 'Producción', texto: 'Custodia, consumo y conteo de inventario.', enlace: '/inventario', textoEnlace: 'Abrir'},
    {icono: '💵', titulo: 'Caja menor', texto: 'Recibos, legalización y arqueos.', enlace: '/caja-menor', textoEnlace: 'Abrir'},
    {icono: '🦺', titulo: 'SST', texto: 'Inventario de EPP.', enlace: '/sst', textoEnlace: 'Abrir'}];
  var accesos = function(estilo, cols, estiloCaja) { return b('tarjetas', {estilo: estilo || 'sombra', columnas: cols || 4, items: NVI.clon(ACCESOS)}, estiloCaja); };
  var P1 = '<p>Este es el espacio de toda la intranet: aquí encuentras las novedades y los accesos a tus herramientas.</p>';
  var CARRUSEL = function(extra, estilo) { return b('carrusel', Object.assign({items: [{src: PH('Diapositiva 1', A, N), titulo: 'Bienvenidos a Nuvia', texto: 'Escribe un mensaje para esta imagen', enlace: ''},
    {src: PH('Diapositiva 2', I, N), titulo: 'Novedades', texto: '', enlace: ''}, {src: PH('Diapositiva 3', A, I), titulo: 'Logros del equipo', texto: '', enlace: ''}]}, extra || {}), estilo); };
  var GALERIA = function(extra, estilo) { return b('galeria', Object.assign({items: [1, 2, 3, 4, 5, 6].map(function(i) { return {src: PH('Foto ' + i, [A, I, N, A, I, N][i - 1], [I, N, A, N, A, I][i - 1]), titulo: ''}; })}, extra || {}), estilo); };
  var ETIQUETA = function(texto, color, estilo, alinear) { return b('texto', {html: '<p style="font-weight:800;letter-spacing:.14em;color:' + color + '">' + texto + '</p>', tamano: 13, alinear: alinear || 'left'}, Object.assign({margenAbajo: 4}, estilo || {})); };
  var NOTAS = function(lista, estilo) { return b('tarjetas', {estilo: 'plano', columnas: 1, items: lista.map(function(x, i) { return {icono: '', imagen: PH(x[0], [A, I, N][i % 3], [I, N, A][i % 3]), titulo: x[0], texto: x[1], enlace: '', textoEnlace: ''}; })}, estilo); };

  NVI.PLANTILLAS = [
    {id: 'corporativo', nombre: 'Corporativo Nuvia', descripcion: 'Portada azul noche, accesos rápidos, cifras y muro de novedades.', crear: function() { return {
      tema: TEMA({fondo: IS}),
      secciones: [
        sec({fondoTipo: 'degradado', fondo: N, fondo2: I, angulo: 120, colorTexto: B, padArriba: 96, padAbajo: 96, forma: 'ola', alinearV: 'center'},
          [col(7, [b('texto', {html: '<p style="font-weight:600;letter-spacing:.12em;color:' + A + '">NUVIA COLOMBIA</p>', tamano: 13}, {margenAbajo: 6}), T('Bienvenido a la intranet', 'h1'), P(P1, {tamano: 18}),
            b('botones', {tamano: 'l', items: [{texto: 'Ver mis módulos', url: '#modulos', estilo: 'blanco'}]})]),
           col(5, [b('imagen', {src: FOTO(), radio: 24, sombra: true}, {animacion: 'zoom'})])]),
        sec({padArriba: 30, padAbajo: 40}, [col(12, [T('Accesos rápidos', 'h2', {alinear: 'center'}), P('<p>Todo lo que usas a diario, a un clic.</p>', {alinear: 'center', color: I}), accesos('sombra', 4)])]),
        sec({fondoTipo: 'color', fondo: B, padArriba: 50, padAbajo: 50}, [col(12, [b('cifras', {color: A}, {animacion: 'subir'})])]),
        sec({padArriba: 56, padAbajo: 70}, [col(8, [b('muro', {titulo: 'Novedades', columnas: 2, estilo: 'destacado'})]),
          col(4, [b('cuenta', {titulo: 'Próximo evento', color: I}, {fondo: B, relleno: 22, radio: 16, sombra: true, margenAbajo: 22}),
            b('acordeon', {}, {fondo: B, relleno: 18, radio: 16, sombra: true})])])]}; }},
    {id: 'noticias', nombre: 'Noticias y anuncios', descripcion: 'Carrusel de destacados arriba y muro con columna lateral de eventos y enlaces.', crear: function() { return {
      tema: TEMA({fuenteTitulos: 'Montserrat', fuenteTexto: 'Lato', radio: 12}),
      secciones: [
        sec({padArriba: 28, padAbajo: 10, ancho: 'ancho'}, [col(12, [CARRUSEL({alto: 440, radio: 18})])]),
        sec({padArriba: 34, padAbajo: 60, ancho: 'ancho'}, [col(8, [b('muro', {titulo: 'Últimas noticias', estilo: 'lista', cantidad: 8})]),
          col(4, [T('Esta semana', 'h3'), b('cuenta', {titulo: 'Próximo evento', color: I}, {fondo: AS, relleno: 18, radio: 14, margenAbajo: 20}),
            b('cita', {texto: 'La calidad nunca es un accidente; es el resultado del esfuerzo inteligente.', autor: 'John Ruskin', cargo: '', estilo: 'linea'}, {margenAbajo: 0})])])]}; }},
    {id: 'video', nombre: 'Bienvenida con video', descripcion: 'Texto y video lado a lado, beneficios en tarjetas, testimonio y preguntas frecuentes.', crear: function() { return {
      tema: TEMA({fuenteTitulos: 'DM Sans', fuenteTexto: 'DM Sans', radio: 18}),
      secciones: [
        sec({fondoTipo: 'degradado', fondo: AS, fondo2: B, angulo: 180, padArriba: 80, padAbajo: 70, alinearV: 'center'},
          [col(5, [b('texto', {html: '<p><span style="color:' + A + ';font-weight:700">● BIENVENIDA</span></p>'}, {margenAbajo: 4}), T('Así trabajamos en Nuvia', 'h1', {tamano: 46}),
            P('<p>Mira este video corto con lo esencial del equipo.</p>', {tamano: 17, color: I})]),
           col(7, [b('video', {src: '', radio: 22}, {sombra: true, radio: 22, animacion: 'der'})])]),
        sec({padArriba: 60, padAbajo: 50}, [col(12, [T('Lo que encuentras aquí', 'h2', {alinear: 'center'}), b('tarjetas', {estilo: 'borde', columnas: 3, alinear: 'center', items: [
          {icono: '⚡', titulo: 'Más rápido', texto: 'Accesos directos a tus herramientas del día.'}, {icono: '🎯', titulo: 'Más claro', texto: 'Novedades siempre actualizadas.'}, {icono: '🤝', titulo: 'En equipo', texto: 'Noticias y logros de todos en un solo lugar.'}]})])]),
        sec({fondoTipo: 'color', fondo: N, colorTexto: B, padArriba: 70, padAbajo: 70}, [col(12, [b('cita', {estilo: 'grande', texto: 'Solos podemos hacer muy poco; juntos podemos hacer mucho.', autor: 'Helen Keller', cargo: ''})])]),
        sec({padArriba: 60, padAbajo: 70, ancho: 'estrecho'}, [col(12, [T('Preguntas frecuentes', 'h2', {alinear: 'center'}), b('acordeon')])])]}; }},
    {id: 'galeria', nombre: 'Galería visual', descripcion: 'Carrusel a pantalla completa, galería de fotos y muro: ideal para eventos y celebraciones.', crear: function() { return {
      tema: TEMA({fuenteTitulos: 'Playfair Display', fuenteTexto: 'Lato', fondo: IS, radio: 6}),
      secciones: [
        sec({ancho: 'completo', padArriba: 0, padAbajo: 0}, [col(12, [CARRUSEL({alto: 560, radio: 0, efecto: 'fundido', oscurecer: 45}, {margenAbajo: 0})])]),
        sec({padArriba: 60, padAbajo: 20}, [col(12, [T('Momentos del equipo', 'h2', {alinear: 'center'}), P('<p>Celebraciones y logros de todos.</p>', {alinear: 'center', color: I}), b('separador', {ancho: 12, grosor: 3, color: A})])]),
        sec({padArriba: 10, padAbajo: 50}, [col(12, [GALERIA({columnas: 3, alto: 240, radio: 6})])]),
        sec({fondoTipo: 'color', fondo: B, padArriba: 50, padAbajo: 60}, [col(12, [b('muro', {titulo: 'Lo último', columnas: 3})])])]}; }},
    {id: 'minimal', nombre: 'Minimalista', descripcion: 'Limpio y centrado: título, mensaje, botones y lista de novedades.', crear: function() { return {
      tema: TEMA({fuenteTitulos: 'Inter', fuenteTexto: 'Inter', radio: 10}),
      secciones: [
        sec({ancho: 'estrecho', padArriba: 110, padAbajo: 40}, [col(12, [T('Nuvia', 'h1', {alinear: 'center', tamano: 64, peso: '800'}), P('<p>Un solo lugar para empezar el día.</p>', {alinear: 'center', tamano: 20, color: I})])]),
        sec({ancho: 'estrecho', padArriba: 10, padAbajo: 10}, [col(12, [b('separador', {ancho: 30, color: A})])]),
        sec({ancho: 'estrecho', padArriba: 30, padAbajo: 90}, [col(12, [b('muro', {titulo: 'Novedades', estilo: 'lista', cantidad: 5})])])]}; }},
    {id: 'noticiero', nombre: 'Revista de noticias', descripcion: 'Portada con carrusel, noticias al lado, video de la semana, fotos y muro.', crear: function() { return {
      tema: TEMA({fuenteTitulos: 'Montserrat', fuenteTexto: 'Lato', radio: 14}),
      secciones: [
        sec({ancho: 'ancho', padArriba: 30, padAbajo: 8}, [col(12, [ETIQUETA('NOTICIAS', A), T('Lo más importante de la semana', 'h1', {tamano: 42})])]),
        sec({ancho: 'ancho', padArriba: 10, padAbajo: 40}, [col(8, [CARRUSEL({alto: 470, radio: 18, efecto: 'fundido', intervalo: 6, oscurecer: 45, zoomLento: true})]),
          col(4, [T('También hoy', 'h3'), NOTAS([['Novedad 1', 'Escribe aquí el resumen de la novedad.'], ['Novedad 2', 'Escribe aquí el resumen de la novedad.'], ['Bienvenidas', 'Escribe aquí el resumen de la novedad.']])])]),
        sec({fondoTipo: 'color', fondo: AS, padArriba: 60, padAbajo: 60, alinearV: 'center'}, [col(7, [b('video', {src: '', radio: 18}, {sombra: true, radio: 18})]),
          col(5, [ETIQUETA('▶ VIDEO DE LA SEMANA', A), T('Mira el resumen en video', 'h2'), P('<p>Pega aquí el enlace de YouTube, Vimeo o WorkDrive, o sube un mp4.</p>', {color: I})])]),
        sec({padArriba: 56, padAbajo: 16}, [col(12, [T('En fotos', 'h2', {alinear: 'center'}), P('<p>Los momentos de la semana.</p>', {alinear: 'center', color: I})])]),
        sec({ancho: 'ancho', padArriba: 0, padAbajo: 40}, [col(12, [GALERIA({columnas: 4, alto: 210, radio: 14, entrada: 'zoom'})])]),
        sec({padArriba: 30, padAbajo: 70}, [col(12, [b('muro', {titulo: 'Todas las noticias', columnas: 3, estilo: 'tarjetas', cantidad: 9})])])]}; }}
  ];
  NVI.PLANTILLA_VACIA = function() { return {tema: NVI.clon(NVI.TEMA_BASE), secciones: [sec({}, [col(12, [T('Página principal', 'h1'), P(P1)])])]}; };
  NVI.nuevaSeccion = function(tipo) {
    if (tipo === 'libre') return {id: NVI.uid('s'), tipo: 'libre', estilo: Object.assign(NVI.estiloSeccion(), {alto: 480}), elementos: []};
    if (tipo === 'libre-baja') return {id: NVI.uid('s'), tipo: 'libre', estilo: Object.assign(NVI.estiloSeccion(), {alto: 240}), elementos: []};
    if (tipo === 'libre-alta') return {id: NVI.uid('s'), tipo: 'libre', estilo: Object.assign(NVI.estiloSeccion(), {alto: 760}), elementos: []};
    var anchos = {c1: [12], c2: [6, 6], c3: [4, 4, 4], c4: [3, 3, 3, 3], c13: [4, 8], c31: [8, 4], c121: [3, 6, 3]}[tipo] || [12];
    return sec({}, anchos.map(function(a) { return col(a, []); }));
  };
  NVI.nuevoBloque = function(tipo) { return b(tipo); };
})();
