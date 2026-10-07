/* Plantillas listas para la página de Inicio de Design (se pueden editar después). */
(function() {
  'use strict';
  var NVI = window.NVI, PH = NVI.placeholder;
  function b(tipo, p, estilo) { return {id: NVI.uid('b'), tipo: tipo, p: Object.assign(NVI.BLOQUES[tipo].d(), p || {}), estilo: estilo || {}}; }
  function col(ancho, bloques) { return {id: NVI.uid('c'), ancho: ancho, bloques: bloques || []}; }
  function sec(estilo, columnas) { return {id: NVI.uid('s'), tipo: 'columnas', estilo: Object.assign(NVI.estiloSeccion(), estilo || {}), columnas: columnas}; }
  function libre(estilo, elementos) { return {id: NVI.uid('s'), tipo: 'libre', estilo: Object.assign(NVI.estiloSeccion(), estilo || {}), elementos: elementos}; }
  function el(x, y, w, hh, bloque, z) { return {id: NVI.uid('e'), x: x, y: y, w: w, h: hh || 0, z: z || 1, bloque: bloque}; }
  var T = function(html, nivel, extra) { return b('titulo', Object.assign({html: html, nivel: nivel || 'h2'}, extra || {})); };
  var P = function(html, extra) { return b('texto', Object.assign({html: html}, extra || {})); };
  var ACCESOS = function(estilo, cols) {
    return b('tarjetas', {estilo: estilo || 'sombra', columnas: cols || 4, items: [
      {icono: '📅', titulo: 'Design Schedule', texto: 'Las órdenes del día de tu equipo.', enlace: '/design', textoEnlace: 'Abrir'},
      {icono: '📋', titulo: 'Protocols', texto: 'Protocolos de cada área, siempre al día.', enlace: '/design?panel=protocols', textoEnlace: 'Ver protocolos'},
      {icono: '✅', titulo: 'Pre-Approved', texto: 'Cambios pre-aprobados por doctor.', enlace: '/design?panel=preapproved', textoEnlace: 'Consultar'},
      {icono: '💬', titulo: 'Comments', texto: 'Genera los comentarios de cada caso.', enlace: '/design?panel=comments', textoEnlace: 'Ir'}]});
  };
  var P1 = '<p>Este es el espacio de todo el equipo de Design: aquí encuentras las novedades, los accesos a tus herramientas y lo que necesitas para empezar el día.</p>';

  NVI.PLANTILLAS = [
    {id: 'corporativo', nombre: 'Corporativo Nuvia', descripcion: 'Portada con degradado azul, accesos rápidos, cifras y muro de novedades.', crear: function() { return {
      tema: {fuenteTitulos: 'Poppins', fuenteTexto: 'Inter', primario: '#1d4ed8', secundario: '#0f172a', acento: '#f59e0b', fondo: '#f8fafc', texto: '#1f2937', radio: 16},
      secciones: [
        sec({fondoTipo: 'degradado', fondo: '#0f172a', fondo2: '#1d4ed8', angulo: 120, colorTexto: '#ffffff', padArriba: 96, padAbajo: 96, forma: 'ola', alinearV: 'center'},
          [col(7, [b('texto', {html: '<p style="font-weight:600;letter-spacing:.12em">NUVIA DESIGN COLOMBIA</p>', tamano: 13}, {margenAbajo: 6}), T('Bienvenido al equipo de Design', 'h1'), P(P1, {tamano: 18}),
            b('botones', {tamano: 'l', items: [{texto: 'Abrir Design Schedule', url: '/design', estilo: 'blanco'}, {texto: 'Ver protocolos', url: '/design?panel=protocols', estilo: 'borde'}]})]),
           col(5, [b('imagen', {src: PH('Foto del equipo', '#60a5fa', '#312e81'), radio: 24, sombra: true}, {animacion: 'zoom'})])]),
        sec({padArriba: 30, padAbajo: 40}, [col(12, [T('Accesos rápidos', 'h2', {alinear: 'center'}), P('<p>Todo lo que usas a diario, a un clic.</p>', {alinear: 'center', color: '#64748b'}), ACCESOS('sombra', 4)])]),
        sec({fondoTipo: 'color', fondo: '#ffffff', padArriba: 50, padAbajo: 50}, [col(12, [b('cifras', {}, {animacion: 'subir'})])]),
        sec({padArriba: 56, padAbajo: 70}, [col(8, [b('muro', {titulo: 'Novedades del equipo', columnas: 2, estilo: 'destacado'})]),
          col(4, [b('cuenta', {titulo: 'Próxima reunión general'}, {fondo: '#ffffff', relleno: 22, radio: 16, sombra: true, margenAbajo: 22}),
            b('acordeon', {}, {fondo: '#ffffff', relleno: 18, radio: 16, sombra: true})])])]}; }},
    {id: 'noticias', nombre: 'Noticias y anuncios', descripcion: 'Carrusel de destacados arriba y muro con columna lateral de eventos y enlaces.', crear: function() { return {
      tema: {fuenteTitulos: 'Montserrat', fuenteTexto: 'Lato', primario: '#0e7490', secundario: '#083344', acento: '#e11d48', fondo: '#ffffff', texto: '#1e293b', radio: 12},
      secciones: [
        sec({padArriba: 28, padAbajo: 10, ancho: 'ancho'}, [col(12, [b('carrusel', {alto: 440, radio: 18})])]),
        sec({padArriba: 34, padAbajo: 60, ancho: 'ancho'}, [col(8, [b('muro', {titulo: 'Últimas noticias', estilo: 'lista', cantidad: 8})]),
          col(4, [T('Esta semana', 'h3'), b('cuenta', {titulo: 'Capacitación de nuevos productos'}, {fondo: '#ecfeff', relleno: 18, radio: 14, margenAbajo: 20}),
            T('Enlaces útiles', 'h3'), b('botones', {items: [{texto: 'Design Schedule', url: '/design', estilo: 'enlace'}, {texto: 'Protocols', url: '/design?panel=protocols', estilo: 'enlace'}, {texto: 'Comments', url: '/design?panel=comments', estilo: 'enlace'}]}),
            b('cita', {texto: 'La calidad nunca es un accidente; es el resultado del esfuerzo inteligente.', autor: 'John Ruskin', cargo: '', estilo: 'linea'}, {margenAbajo: 0})])])]}; }},
    {id: 'video', nombre: 'Bienvenida con video', descripcion: 'Texto y video lado a lado, beneficios en tarjetas, testimonio y preguntas frecuentes.', crear: function() { return {
      tema: {fuenteTitulos: 'DM Sans', fuenteTexto: 'DM Sans', primario: '#7c3aed', secundario: '#1e1b4b', acento: '#10b981', fondo: '#ffffff', texto: '#1f2937', radio: 18},
      secciones: [
        sec({fondoTipo: 'degradado', fondo: '#f5f3ff', fondo2: '#ffffff', angulo: 180, padArriba: 80, padAbajo: 70, alinearV: 'center'},
          [col(5, [b('texto', {html: '<p><span style="color:#7c3aed;font-weight:700">● BIENVENIDA</span></p>'}, {margenAbajo: 4}), T('Así trabajamos en Nuvia Design', 'h1', {tamano: 46}),
            P('<p>Mira este video corto con lo esencial: cómo usar el Schedule, los protocolos y a quién acudir.</p>', {tamano: 17, color: '#475569'}), b('botones', {items: [{texto: 'Empezar', url: '/design', estilo: 'solido'}]})]),
           col(7, [b('video', {src: '', radio: 22}, {sombra: true, radio: 22, animacion: 'der'})])]),
        sec({padArriba: 60, padAbajo: 50}, [col(12, [T('Lo que encuentras aquí', 'h2', {alinear: 'center'}), b('tarjetas', {estilo: 'borde', columnas: 3, alinear: 'center', items: [
          {icono: '⚡', titulo: 'Más rápido', texto: 'Accesos directos a tus herramientas del día.'}, {icono: '🎯', titulo: 'Más claro', texto: 'Protocolos y pre-aprobados siempre actualizados.'}, {icono: '🤝', titulo: 'En equipo', texto: 'Novedades y logros de todos en un solo lugar.'}]})])]),
        sec({fondoTipo: 'color', fondo: '#1e1b4b', colorTexto: '#ffffff', padArriba: 70, padAbajo: 70}, [col(12, [b('cita', {estilo: 'grande', texto: 'Solos podemos hacer muy poco; juntos podemos hacer mucho.', autor: 'Helen Keller', cargo: ''})])]),
        sec({padArriba: 60, padAbajo: 70, ancho: 'estrecho'}, [col(12, [T('Preguntas frecuentes', 'h2', {alinear: 'center'}), b('acordeon')])])]}; }},
    {id: 'galeria', nombre: 'Galería visual', descripcion: 'Carrusel a pantalla completa, galería de fotos y muro: ideal para eventos y celebraciones.', crear: function() { return {
      tema: {fuenteTitulos: 'Playfair Display', fuenteTexto: 'Lato', primario: '#be123c', secundario: '#1c1917', acento: '#f59e0b', fondo: '#fffbf5', texto: '#292524', radio: 6},
      secciones: [
        sec({ancho: 'completo', padArriba: 0, padAbajo: 0}, [col(12, [b('carrusel', {alto: 560, radio: 0, efecto: 'fundido', oscurecer: 45}, {margenAbajo: 0})])]),
        sec({padArriba: 60, padAbajo: 20}, [col(12, [T('Momentos del equipo', 'h2', {alinear: 'center'}), P('<p>Celebraciones, capacitaciones y logros de Design.</p>', {alinear: 'center', color: '#78716c'}), b('separador', {ancho: 12, grosor: 3, color: '#be123c'})])]),
        sec({padArriba: 10, padAbajo: 50}, [col(12, [b('galeria', {columnas: 3, alto: 240, radio: 6})])]),
        sec({fondoTipo: 'color', fondo: '#ffffff', padArriba: 50, padAbajo: 60}, [col(12, [b('muro', {titulo: 'Lo último', columnas: 3})])])]}; }},
    {id: 'minimal', nombre: 'Minimalista', descripcion: 'Limpio y centrado: título, mensaje, botones y lista de novedades.', crear: function() { return {
      tema: {fuenteTitulos: 'Inter', fuenteTexto: 'Inter', primario: '#111827', secundario: '#111827', acento: '#2563eb', fondo: '#ffffff', texto: '#374151', radio: 10},
      secciones: [
        sec({ancho: 'estrecho', padArriba: 110, padAbajo: 40}, [col(12, [T('Design', 'h1', {alinear: 'center', tamano: 64, peso: '800'}), P('<p>Un solo lugar para empezar el día.</p>', {alinear: 'center', tamano: 20, color: '#6b7280'}),
          b('botones', {alinear: 'center', items: [{texto: 'Schedule', url: '/design', estilo: 'solido'}, {texto: 'Protocols', url: '/design?panel=protocols', estilo: 'suave'}, {texto: 'Comments', url: '/design?panel=comments', estilo: 'suave'}]})])]),
        sec({ancho: 'estrecho', padArriba: 10, padAbajo: 10}, [col(12, [b('separador', {ancho: 30})])]),
        sec({ancho: 'estrecho', padArriba: 30, padAbajo: 90}, [col(12, [b('muro', {titulo: 'Novedades', estilo: 'lista', cantidad: 5})])])]}; }},
    {id: 'oscuro', nombre: 'Moderno oscuro', descripcion: 'Fondo oscuro con acentos de color, tarjetas de vidrio, cifras y una página incrustada.', crear: function() { return {
      tema: {fuenteTitulos: 'Raleway', fuenteTexto: 'Inter', primario: '#22d3ee', secundario: '#020617', acento: '#a78bfa', fondo: '#020617', texto: '#e2e8f0', radio: 18},
      secciones: [
        sec({fondoTipo: 'degradado', fondo: '#020617', fondo2: '#1e1b4b', angulo: 160, colorTexto: '#f8fafc', padArriba: 110, padAbajo: 80},
          [col(12, [T('<span style="color:#22d3ee">Design</span> en un solo lugar', 'h1', {alinear: 'center', tamano: 56}), P('<p>Herramientas, novedades y equipo.</p>', {alinear: 'center', tamano: 19, color: '#94a3b8'}),
            b('botones', {alinear: 'center', tamano: 'l', items: [{texto: 'Abrir Schedule', url: '/design', estilo: 'solido'}]})])]),
        sec({fondoTipo: 'color', fondo: '#0b1120', colorTexto: '#e2e8f0', padArriba: 50, padAbajo: 50}, [col(12, [ACCESOS('vidrio', 4)])]),
        sec({fondoTipo: 'color', fondo: '#020617', colorTexto: '#e2e8f0', padArriba: 50, padAbajo: 50}, [col(12, [b('cifras', {color: '#22d3ee'})])]),
        sec({fondoTipo: 'color', fondo: '#0b1120', colorTexto: '#e2e8f0', padArriba: 50, padAbajo: 70}, [col(6, [b('muro', {titulo: 'Novedades', columnas: 1, estilo: 'lista', cantidad: 4})]),
          col(6, [T('Formulario o calendario', 'h3'), b('embed', {url: '', alto: 420, borde: false})])])]}; }},
    {id: 'creativo', nombre: 'Creativo (posición libre)', descripcion: 'Portada armada en posición libre para mover cada elemento donde quieras.', crear: function() { return {
      tema: {fuenteTitulos: 'Oswald', fuenteTexto: 'Nunito', primario: '#ea580c', secundario: '#1c1917', acento: '#0ea5e9', fondo: '#fff7ed', texto: '#292524', radio: 20},
      secciones: [
        libre({fondoTipo: 'degradado', fondo: '#fff7ed', fondo2: '#fed7aa', angulo: 135, alto: 560, padArriba: 30, padAbajo: 30}, [
          el(4, 70, 48, 0, T('HOLA, EQUIPO DE DESIGN', 'h1', {tamano: 64, peso: '700', color: '#1c1917'}), 2),
          el(4, 250, 40, 0, P('<p>Arrastra, cambia el tamaño y acomoda cada elemento donde quieras. En celulares se acomodan uno debajo del otro.</p>', {tamano: 18}), 2),
          el(4, 370, 40, 0, b('botones', {tamano: 'l', items: [{texto: 'Empezar el día', url: '/design', estilo: 'solido'}, {texto: 'Protocols', url: '/design?panel=protocols', estilo: 'borde'}]}), 2),
          el(56, 40, 40, 460, b('imagen', {src: PH('Tu foto', '#fdba74', '#9a3412'), alto: 460, radio: 28, sombra: true}), 1),
          el(48, 380, 18, 0, b('cifras', {items: [{numero: 5, prefijo: '', sufijo: '', etiqueta: 'Áreas'}], color: '#ea580c'}, {fondo: '#ffffff', relleno: 14, radio: 18, sombra: true}), 3)]),
        sec({padArriba: 60, padAbajo: 70}, [col(12, [ACCESOS('color', 4)])])]}; }}
  ];
  NVI.PLANTILLA_VACIA = function() { return {tema: NVI.clon(NVI.TEMA_BASE), secciones: [sec({}, [col(12, [T('Inicio de Design', 'h1'), P(P1)])])]}; };
  NVI.nuevaSeccion = function(tipo) {
    if (tipo === 'libre') return libre({alto: 480}, [el(5, 40, 40, 0, T('Arrástrame', 'h2'), 1)]);
    var anchos = {c1: [12], c2: [6, 6], c3: [4, 4, 4], c4: [3, 3, 3, 3], c13: [4, 8], c31: [8, 4], c121: [3, 6, 3]}[tipo] || [12];
    return sec({}, anchos.map(function(a) { return col(a, []); }));
  };
  NVI.nuevoBloque = function(tipo) { return b(tipo); };
})();
