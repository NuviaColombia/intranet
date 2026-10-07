/* Plantillas listas para la página de Inicio de Design (se pueden editar después).
   Todas usan la paleta de Nuvia: azul noche #1a1449, índigo #252772 y azul claro #2f98d5. */
(function() {
  'use strict';
  var NVI = window.NVI, PH = NVI.placeholder;
  var N = '#1a1449', I = '#252772', A = '#2f98d5', AS = '#e8f4fb', IS = '#eef0fa', B = '#ffffff';
  function b(tipo, p, estilo) { return {id: NVI.uid('b'), tipo: tipo, p: Object.assign(NVI.BLOQUES[tipo].d(), p || {}), estilo: estilo || {}}; }
  function col(ancho, bloques) { return {id: NVI.uid('c'), ancho: ancho, bloques: bloques || []}; }
  function sec(estilo, columnas) { return {id: NVI.uid('s'), tipo: 'columnas', estilo: Object.assign(NVI.estiloSeccion(), estilo || {}), columnas: columnas}; }
  function libre(estilo, elementos) { return {id: NVI.uid('s'), tipo: 'libre', estilo: Object.assign(NVI.estiloSeccion(), estilo || {}), elementos: elementos}; }
  function el(x, y, w, hh, bloque, z) { return {id: NVI.uid('e'), x: x, y: y, w: w, h: hh || 0, z: z || 1, bloque: bloque}; }
  var T = function(html, nivel, extra, estilo) { return b('titulo', Object.assign({html: html, nivel: nivel || 'h2'}, extra || {}), estilo); };
  var P = function(html, extra, estilo) { return b('texto', Object.assign({html: html}, extra || {}), estilo); };
  var an = function(tipo, retraso, extra) { return Object.assign({animacion: tipo, retraso: retraso || 0}, extra || {}); };
  var TEMA = function(extra) { return Object.assign({fuenteTitulos: 'Poppins', fuenteTexto: 'Inter', primario: I, secundario: N, acento: A, fondo: B, texto: N, radio: 16}, extra || {}); };
  var FOTO = function(t) { return PH(t || 'Foto del equipo', A, I); };
  var ACCESOS = [
    {icono: '📅', titulo: 'Design Schedule', texto: 'Las órdenes del día de tu equipo.', enlace: '/design', textoEnlace: 'Abrir'},
    {icono: '📋', titulo: 'Protocols', texto: 'Protocolos de cada área, siempre al día.', enlace: '/design?panel=protocols', textoEnlace: 'Ver protocolos'},
    {icono: '✅', titulo: 'Pre-Approved', texto: 'Cambios pre-aprobados por doctor.', enlace: '/design?panel=preapproved', textoEnlace: 'Consultar'},
    {icono: '💬', titulo: 'Comments', texto: 'Genera los comentarios de cada caso.', enlace: '/design?panel=comments', textoEnlace: 'Ir'}];
  var accesos = function(estilo, cols, estiloCaja) { return b('tarjetas', {estilo: estilo || 'sombra', columnas: cols || 4, items: NVI.clon(ACCESOS)}, estiloCaja); };
  // una tarjeta por columna: así cada una aparece un poco después de la anterior
  var accesosEscalonados = function(estilo, anim) { return ACCESOS.map(function(it, i) { return col(3, [b('tarjetas', {estilo: estilo, columnas: 1, items: [NVI.clon(it)]}, an(anim || 'subir', i * 150))]); }); };
  var P1 = '<p>Este es el espacio de todo el equipo de Design: aquí encuentras las novedades, los accesos a tus herramientas y lo que necesitas para empezar el día.</p>';
  var CARRUSEL = function(extra, estilo) { return b('carrusel', Object.assign({items: [{src: PH('Diapositiva 1', A, N), titulo: 'Bienvenidos a Design', texto: 'Escribe un mensaje para esta imagen', enlace: ''},
    {src: PH('Diapositiva 2', I, N), titulo: 'Logros del equipo', texto: '', enlace: ''}, {src: PH('Diapositiva 3', A, I), titulo: 'Novedades', texto: '', enlace: ''}]}, extra || {}), estilo); };
  var GALERIA = function(extra, estilo) { return b('galeria', Object.assign({items: [1, 2, 3, 4, 5, 6].map(function(i) { return {src: PH('Foto ' + i, [A, I, N, A, I, N][i - 1], [I, N, A, N, A, I][i - 1]), titulo: ''}; })}, extra || {}), estilo); };

  // ---------- Ayudas de las plantillas de noticias y de temporada ----------
  var HN = '#ff7a1a', HM = '#5b2a86';                 // Halloween: naranja y morado
  var NR = '#c8102e', NV = '#0f6b46', ND = '#e8b64c';  // Navidad: rojo, verde y dorado
  // texto pequeño en mayúsculas encima de un título (ej. "NOTICIAS DE DESIGN")
  var ETIQUETA = function(texto, color, estilo, alinear) { return b('texto', {html: '<p style="font-weight:800;letter-spacing:.14em;color:' + color + '">' + texto + '</p>', tamano: 13, alinear: alinear || 'left'}, Object.assign({margenAbajo: 4}, estilo || {})); };
  // noticias cortas con foto, una debajo de otra
  var NOTAS = function(lista, estilo) { return b('tarjetas', {estilo: 'plano', columnas: 1, items: lista.map(function(x, i) { return {icono: '', imagen: PH(x[0], [A, I, N][i % 3], [I, N, A][i % 3]), titulo: x[0], texto: x[1], enlace: '', textoEnlace: ''}; })}, estilo); };
  // la próxima vez que llega una fecha (mes 1-12), para las cuentas regresivas de temporada
  var PROX = function(mes, dia, hora) {
    var hoy = new Date(), f = new Date(hoy.getFullYear(), mes - 1, dia, hora || 0, 0, 0);
    if (f < hoy) f.setFullYear(f.getFullYear() + 1);
    var d2 = function(n) { return String(n).padStart(2, '0'); };
    return f.getFullYear() + '-' + d2(f.getMonth() + 1) + '-' + d2(f.getDate()) + 'T' + d2(f.getHours()) + ':00';
  };
  var FOTOS_HW = function(t) { return [1, 2, 3, 4, 5, 6, 7, 8].map(function(i) { return {src: PH(t + ' ' + i, [HN, HM, '#0d0a1f', '#b3360b'][i % 4], [HM, '#0d0a1f', HN, HM][i % 4]), titulo: ''}; }); };
  var FOTOS_NV = function(t) { return [1, 2, 3, 4, 5, 6, 7, 8].map(function(i) { return {src: PH(t + ' ' + i, [NR, NV, N, ND][i % 4], [NV, N, NR, NR][i % 4]), titulo: ''}; }); };

  NVI.PLANTILLAS = [
    {id: 'corporativo', nombre: 'Corporativo Nuvia', descripcion: 'Portada azul noche, accesos rápidos, cifras y muro de novedades.', crear: function() { return {
      tema: TEMA({fondo: IS}),
      secciones: [
        sec({fondoTipo: 'degradado', fondo: N, fondo2: I, angulo: 120, colorTexto: B, padArriba: 96, padAbajo: 96, forma: 'ola', alinearV: 'center'},
          [col(7, [b('texto', {html: '<p style="font-weight:600;letter-spacing:.12em;color:' + A + '">NUVIA DESIGN COLOMBIA</p>', tamano: 13}, {margenAbajo: 6}), T('Bienvenido al equipo de Design', 'h1'), P(P1, {tamano: 18}),
            b('botones', {tamano: 'l', items: [{texto: 'Abrir Design Schedule', url: '/design', estilo: 'blanco'}, {texto: 'Ver protocolos', url: '/design?panel=protocols', estilo: 'borde'}]})]),
           col(5, [b('imagen', {src: FOTO(), radio: 24, sombra: true}, {animacion: 'zoom'})])]),
        sec({padArriba: 30, padAbajo: 40}, [col(12, [T('Accesos rápidos', 'h2', {alinear: 'center'}), P('<p>Todo lo que usas a diario, a un clic.</p>', {alinear: 'center', color: I}), accesos('sombra', 4)])]),
        sec({fondoTipo: 'color', fondo: B, padArriba: 50, padAbajo: 50}, [col(12, [b('cifras', {color: A}, {animacion: 'subir'})])]),
        sec({padArriba: 56, padAbajo: 70}, [col(8, [b('muro', {titulo: 'Novedades del equipo', columnas: 2, estilo: 'destacado'})]),
          col(4, [b('cuenta', {titulo: 'Próxima reunión general', color: I}, {fondo: B, relleno: 22, radio: 16, sombra: true, margenAbajo: 22}),
            b('acordeon', {}, {fondo: B, relleno: 18, radio: 16, sombra: true})])])]}; }},
    {id: 'noticias', nombre: 'Noticias y anuncios', descripcion: 'Carrusel de destacados arriba y muro con columna lateral de eventos y enlaces.', crear: function() { return {
      tema: TEMA({fuenteTitulos: 'Montserrat', fuenteTexto: 'Lato', radio: 12}),
      secciones: [
        sec({padArriba: 28, padAbajo: 10, ancho: 'ancho'}, [col(12, [CARRUSEL({alto: 440, radio: 18})])]),
        sec({padArriba: 34, padAbajo: 60, ancho: 'ancho'}, [col(8, [b('muro', {titulo: 'Últimas noticias', estilo: 'lista', cantidad: 8})]),
          col(4, [T('Esta semana', 'h3'), b('cuenta', {titulo: 'Capacitación de nuevos productos', color: I}, {fondo: AS, relleno: 18, radio: 14, margenAbajo: 20}),
            T('Enlaces útiles', 'h3'), b('botones', {items: [{texto: 'Design Schedule', url: '/design', estilo: 'enlace'}, {texto: 'Protocols', url: '/design?panel=protocols', estilo: 'enlace'}, {texto: 'Comments', url: '/design?panel=comments', estilo: 'enlace'}]}),
            b('cita', {texto: 'La calidad nunca es un accidente; es el resultado del esfuerzo inteligente.', autor: 'John Ruskin', cargo: '', estilo: 'linea'}, {margenAbajo: 0})])])]}; }},
    {id: 'video', nombre: 'Bienvenida con video', descripcion: 'Texto y video lado a lado, beneficios en tarjetas, testimonio y preguntas frecuentes.', crear: function() { return {
      tema: TEMA({fuenteTitulos: 'DM Sans', fuenteTexto: 'DM Sans', radio: 18}),
      secciones: [
        sec({fondoTipo: 'degradado', fondo: AS, fondo2: B, angulo: 180, padArriba: 80, padAbajo: 70, alinearV: 'center'},
          [col(5, [b('texto', {html: '<p><span style="color:' + A + ';font-weight:700">● BIENVENIDA</span></p>'}, {margenAbajo: 4}), T('Así trabajamos en Nuvia Design', 'h1', {tamano: 46}),
            P('<p>Mira este video corto con lo esencial: cómo usar el Schedule, los protocolos y a quién acudir.</p>', {tamano: 17, color: I}), b('botones', {items: [{texto: 'Empezar', url: '/design', estilo: 'solido'}]})]),
           col(7, [b('video', {src: '', radio: 22}, {sombra: true, radio: 22, animacion: 'der'})])]),
        sec({padArriba: 60, padAbajo: 50}, [col(12, [T('Lo que encuentras aquí', 'h2', {alinear: 'center'}), b('tarjetas', {estilo: 'borde', columnas: 3, alinear: 'center', items: [
          {icono: '⚡', titulo: 'Más rápido', texto: 'Accesos directos a tus herramientas del día.'}, {icono: '🎯', titulo: 'Más claro', texto: 'Protocolos y pre-aprobados siempre actualizados.'}, {icono: '🤝', titulo: 'En equipo', texto: 'Novedades y logros de todos en un solo lugar.'}]})])]),
        sec({fondoTipo: 'color', fondo: N, colorTexto: B, padArriba: 70, padAbajo: 70}, [col(12, [b('cita', {estilo: 'grande', texto: 'Solos podemos hacer muy poco; juntos podemos hacer mucho.', autor: 'Helen Keller', cargo: ''})])]),
        sec({padArriba: 60, padAbajo: 70, ancho: 'estrecho'}, [col(12, [T('Preguntas frecuentes', 'h2', {alinear: 'center'}), b('acordeon')])])]}; }},
    {id: 'galeria', nombre: 'Galería visual', descripcion: 'Carrusel a pantalla completa, galería de fotos y muro: ideal para eventos y celebraciones.', crear: function() { return {
      tema: TEMA({fuenteTitulos: 'Playfair Display', fuenteTexto: 'Lato', fondo: IS, radio: 6}),
      secciones: [
        sec({ancho: 'completo', padArriba: 0, padAbajo: 0}, [col(12, [CARRUSEL({alto: 560, radio: 0, efecto: 'fundido', oscurecer: 45}, {margenAbajo: 0})])]),
        sec({padArriba: 60, padAbajo: 20}, [col(12, [T('Momentos del equipo', 'h2', {alinear: 'center'}), P('<p>Celebraciones, capacitaciones y logros de Design.</p>', {alinear: 'center', color: I}), b('separador', {ancho: 12, grosor: 3, color: A})])]),
        sec({padArriba: 10, padAbajo: 50}, [col(12, [GALERIA({columnas: 3, alto: 240, radio: 6})])]),
        sec({fondoTipo: 'color', fondo: B, padArriba: 50, padAbajo: 60}, [col(12, [b('muro', {titulo: 'Lo último', columnas: 3})])])]}; }},
    {id: 'minimal', nombre: 'Minimalista', descripcion: 'Limpio y centrado: título, mensaje, botones y lista de novedades.', crear: function() { return {
      tema: TEMA({fuenteTitulos: 'Inter', fuenteTexto: 'Inter', radio: 10}),
      secciones: [
        sec({ancho: 'estrecho', padArriba: 110, padAbajo: 40}, [col(12, [T('Design', 'h1', {alinear: 'center', tamano: 64, peso: '800'}), P('<p>Un solo lugar para empezar el día.</p>', {alinear: 'center', tamano: 20, color: I}),
          b('botones', {alinear: 'center', items: [{texto: 'Schedule', url: '/design', estilo: 'solido'}, {texto: 'Protocols', url: '/design?panel=protocols', estilo: 'suave'}, {texto: 'Comments', url: '/design?panel=comments', estilo: 'suave'}]})])]),
        sec({ancho: 'estrecho', padArriba: 10, padAbajo: 10}, [col(12, [b('separador', {ancho: 30, color: A})])]),
        sec({ancho: 'estrecho', padArriba: 30, padAbajo: 90}, [col(12, [b('muro', {titulo: 'Novedades', estilo: 'lista', cantidad: 5})])])]}; }},
    {id: 'oscuro', nombre: 'Moderno oscuro', descripcion: 'Azul noche con acentos en azul claro, tarjetas de vidrio, cifras y una página incrustada.', crear: function() { return {
      tema: TEMA({fuenteTitulos: 'Raleway', fuenteTexto: 'Inter', primario: A, fondo: N, texto: '#e6e8f5', radio: 18}),
      secciones: [
        sec({fondoTipo: 'degradado', fondo: N, fondo2: I, angulo: 160, colorTexto: B, padArriba: 110, padAbajo: 80},
          [col(12, [T('<span style="color:' + A + '">Design</span> en un solo lugar', 'h1', {alinear: 'center', tamano: 56}), P('<p>Herramientas, novedades y equipo.</p>', {alinear: 'center', tamano: 19, color: '#b9bde3'}),
            b('botones', {alinear: 'center', tamano: 'l', items: [{texto: 'Abrir Schedule', url: '/design', estilo: 'solido'}]})])]),
        sec({fondoTipo: 'color', fondo: I, colorTexto: '#e6e8f5', padArriba: 50, padAbajo: 50}, [col(12, [accesos('vidrio', 4)])]),
        sec({fondoTipo: 'color', fondo: N, colorTexto: '#e6e8f5', padArriba: 50, padAbajo: 50}, [col(12, [b('cifras', {color: A})])]),
        sec({fondoTipo: 'color', fondo: I, colorTexto: '#e6e8f5', padArriba: 50, padAbajo: 70}, [col(6, [b('muro', {titulo: 'Novedades', columnas: 1, estilo: 'lista', cantidad: 4})]),
          col(6, [T('Formulario o calendario', 'h3'), b('embed', {url: '', alto: 420, borde: false})])])]}; }},
    {id: 'creativo', nombre: 'Creativo (posición libre)', descripcion: 'Portada armada en posición libre para mover cada elemento donde quieras.', crear: function() { return {
      tema: TEMA({fuenteTitulos: 'Oswald', fuenteTexto: 'Nunito', primario: I, radio: 20}),
      secciones: [
        libre({fondoTipo: 'degradado', fondo: AS, fondo2: IS, angulo: 135, alto: 560, padArriba: 30, padAbajo: 30}, [
          el(4, 70, 48, 0, T('HOLA, EQUIPO DE DESIGN', 'h1', {tamano: 64, peso: '700', color: N}), 2),
          el(4, 250, 40, 0, P('<p>Arrastra, cambia el tamaño y acomoda cada elemento donde quieras. En celulares se acomodan uno debajo del otro.</p>', {tamano: 18}), 2),
          el(4, 370, 40, 0, b('botones', {tamano: 'l', items: [{texto: 'Empezar el día', url: '/design', estilo: 'solido'}, {texto: 'Protocols', url: '/design?panel=protocols', estilo: 'borde'}]}), 2),
          el(56, 40, 40, 460, b('imagen', {src: FOTO('Tu foto'), alto: 460, radio: 28, sombra: true}), 1),
          el(48, 380, 18, 0, b('cifras', {items: [{numero: 5, prefijo: '', sufijo: '', etiqueta: 'Áreas'}], color: A}, {fondo: B, relleno: 14, radio: 18, sombra: true}), 3)]),
        sec({padArriba: 60, padAbajo: 70}, [col(12, [accesos('color', 4)])])]}; }},

    // ---------- Plantillas con animaciones ----------
    {id: 'movimiento', nombre: 'Portada en movimiento ✨', descripcion: 'Fondo con degradado en movimiento, textos que aparecen uno tras otro, imagen que flota y tarjetas escalonadas.', crear: function() { return {
      tema: TEMA({fondo: IS}),
      secciones: [
        sec({fondoTipo: 'degradado', fondo: N, fondo2: A, angulo: 120, animarFondo: true, colorTexto: B, padArriba: 110, padAbajo: 110, forma: 'curva', alinearV: 'center'},
          [col(7, [b('texto', {html: '<p style="font-weight:700;letter-spacing:.14em">NUVIA DESIGN COLOMBIA</p>', tamano: 13}, an('aparecer', 0, {margenAbajo: 6})),
            T('Creamos sonrisas con tecnología y equipo', 'h1', {tamano: 54}, an('subir', 150)),
            P(P1, {tamano: 18}, an('subir', 350)),
            b('botones', {tamano: 'l', items: [{texto: 'Empezar el día', url: '/design', estilo: 'blanco'}, {texto: 'Protocols', url: '/design?panel=protocols', estilo: 'borde'}]}, an('subir', 550))]),
           col(5, [b('imagen', {src: FOTO(), radio: 28, sombra: true}, an('flotar', 300))])]),
        sec({padArriba: 40, padAbajo: 50}, [col(12, [T('Tus herramientas', 'h2', {alinear: 'center'}, an('aparecer')), P('<p>Entra directo a lo que usas cada día.</p>', {alinear: 'center', color: I}, an('aparecer', 150))])]
),
        sec({padArriba: 0, padAbajo: 60}, accesosEscalonados('sombra', 'subir')),
        sec({fondoTipo: 'degradado', fondo: I, fondo2: N, angulo: 90, colorTexto: B, padArriba: 60, padAbajo: 60}, [col(12, [b('cifras', {color: A, items: [
          {numero: 120, prefijo: '', sufijo: '+', etiqueta: 'Casos diarios'}, {numero: 5, prefijo: '', sufijo: '', etiqueta: 'Áreas'}, {numero: 98, prefijo: '', sufijo: '%', etiqueta: 'Aprobados con QC'}, {numero: 60, prefijo: '', sufijo: '', etiqueta: 'Centros'}]}, an('zoom'))])]),
        sec({padArriba: 60, padAbajo: 80}, [col(8, [b('muro', {titulo: 'Novedades del equipo', columnas: 2, estilo: 'destacado'}, an('izq'))]),
          col(4, [b('cuenta', {titulo: 'Próximo evento', color: I}, an('der', 0, {fondo: B, relleno: 22, radio: 18, sombra: true}))])])]}; }},
    {id: 'pasos', nombre: 'Bienvenida paso a paso ✨', descripcion: 'Para nuevos integrantes: pasos numerados que entran por los lados, imágenes que flotan y cierre con degradado en movimiento.', crear: function() {
      var paso = function(n, titulo, texto, imagenDer) {
        var txt = col(6, [b('texto', {html: '<p style="font-weight:800;color:' + A + ';font-size:15px;letter-spacing:.1em">PASO ' + n + '</p>'}, an(imagenDer ? 'izq' : 'der', 0, {margenAbajo: 4})),
          T(titulo, 'h2', {}, an(imagenDer ? 'izq' : 'der', 120)), P('<p>' + texto + '</p>', {tamano: 17, color: I}, an(imagenDer ? 'izq' : 'der', 240))]);
        var img = col(6, [b('imagen', {src: PH('Paso ' + n, n % 2 ? A : I, N), radio: 24, sombra: true}, an('flotar', 200))]);
        return sec({fondoTipo: n % 2 ? 'ninguno' : 'color', fondo: AS, padArriba: 70, padAbajo: 70, alinearV: 'center'}, imagenDer ? [txt, img] : [img, txt]);
      };
      return {tema: TEMA({fuenteTitulos: 'Montserrat', fuenteTexto: 'Inter'}),
        secciones: [
          sec({fondoTipo: 'degradado', fondo: N, fondo2: I, angulo: 135, colorTexto: B, padArriba: 100, padAbajo: 90, ancho: 'estrecho', forma: 'diagonal'},
            [col(12, [T('¡Bienvenido a Nuvia Design!', 'h1', {alinear: 'center'}, an('zoom')), P('<p>En tres pasos te cuento cómo empezar.</p>', {alinear: 'center', tamano: 19}, an('subir', 200))])]),
          paso(1, 'Conoce tu Schedule', 'Ahí ves los casos asignados del día, sus horas y su estado. Elige tu equipo y empieza.', true),
          paso(2, 'Consulta los protocolos', 'Cada área tiene sus protocolos y los cambios pre-aprobados por doctor. Revísalos antes de diseñar.', false),
          paso(3, 'Documenta cada caso', 'Con Comments generas el comentario de cada orden en segundos.', true),
          sec({fondoTipo: 'degradado', fondo: I, fondo2: A, angulo: 120, animarFondo: true, colorTexto: B, padArriba: 80, padAbajo: 80, ancho: 'estrecho'},
            [col(12, [T('¿Listo?', 'h2', {alinear: 'center', tamano: 44}, an('zoom')), b('botones', {alinear: 'center', tamano: 'l', items: [{texto: 'Abrir Design Schedule', url: '/design', estilo: 'blanco'}]}, an('subir', 200))])])]};
    }},
    {id: 'celebraciones', nombre: 'Celebraciones ✨', descripcion: 'Carrusel que cambia solo, fotos que aparecen con zoom, muro destacado y cuenta regresiva que flota.', crear: function() { return {
      tema: TEMA({fuenteTitulos: 'Poppins', fuenteTexto: 'Nunito', fondo: B, radio: 20}),
      secciones: [
        sec({ancho: 'ancho', padArriba: 30, padAbajo: 20}, [col(12, [CARRUSEL({alto: 480, radio: 24, efecto: 'fundido', intervalo: 4, oscurecer: 40}, an('zoom'))])]),
        sec({padArriba: 40, padAbajo: 20}, [col(12, [T('🎉 Celebramos juntos', 'h2', {alinear: 'center'}, an('subir')), P('<p>Cumpleaños, logros y momentos especiales del equipo.</p>', {alinear: 'center', color: I}, an('subir', 150))])]),
        sec({padArriba: 10, padAbajo: 50}, [col(12, [GALERIA({columnas: 3, alto: 230, radio: 16}, an('zoom', 100))])]),
        sec({fondoTipo: 'color', fondo: AS, padArriba: 60, padAbajo: 70}, [col(8, [b('muro', {titulo: 'Lo que está pasando', columnas: 2, estilo: 'destacado'}, an('subir'))]),
          col(4, [b('cuenta', {titulo: 'Próxima celebración', color: A}, an('flotar', 200, {fondo: B, relleno: 24, radio: 20, sombra: true}))])])]}; }},
    {id: 'tablero', nombre: 'Tablero del equipo ✨', descripcion: 'Cifras que cuentan solas sobre azul noche, accesos que entran uno a uno y novedades al lado.', crear: function() { return {
      tema: TEMA({fuenteTitulos: 'Raleway', fuenteTexto: 'Inter', fondo: IS, radio: 14}),
      secciones: [
        sec({fondoTipo: 'degradado', fondo: N, fondo2: I, angulo: 135, animarFondo: true, colorTexto: B, padArriba: 70, padAbajo: 60},
          [col(12, [T('Tablero de Design', 'h1', {alinear: 'center', tamano: 46}, an('aparecer')), P('<p>Así vamos hoy.</p>', {alinear: 'center', color: '#b9bde3'}, an('aparecer', 150)),
            b('cifras', {color: A, items: [{numero: 120, prefijo: '', sufijo: '+', etiqueta: 'Casos del día'}, {numero: 98, prefijo: '', sufijo: '%', etiqueta: 'Con QC'}, {numero: 5, prefijo: '', sufijo: '', etiqueta: 'Áreas'}, {numero: 12, prefijo: '', sufijo: '', etiqueta: 'Equipos'}]}, an('subir', 300))])]),
        sec({padArriba: 40, padAbajo: 20}, accesosEscalonados('borde', 'zoom')),
        sec({padArriba: 30, padAbajo: 70}, [col(7, [b('muro', {titulo: 'Novedades', estilo: 'lista', cantidad: 5}, an('izq'))]),
          col(5, [b('acordeon', {}, an('der', 0, {fondo: B, relleno: 18, radio: 14, sombra: true}))])])]}; }},

    // ---------- Noticias con animaciones (fotos y videos) ----------
    {id: 'revista', nombre: 'Revista de noticias ✨', descripcion: 'Portada con carrusel en zoom lento, noticias al lado, video de la semana, fotos que aparecen una a una y muro.', crear: function() { return {
      tema: TEMA({fuenteTitulos: 'Montserrat', fuenteTexto: 'Lato', radio: 14}),
      secciones: [
        sec({ancho: 'ancho', padArriba: 30, padAbajo: 8}, [col(12, [ETIQUETA('NOTICIAS DE DESIGN', A, an('aparecer')), T('Lo más importante de la semana', 'h1', {tamano: 42}, an('subir', 120))])]),
        sec({ancho: 'ancho', padArriba: 10, padAbajo: 40}, [col(8, [CARRUSEL({alto: 470, radio: 18, efecto: 'fundido', intervalo: 6, oscurecer: 45, zoomLento: true}, an('zoom'))]),
          col(4, [T('También hoy', 'h3', {}, an('der')), NOTAS([['Nuevo protocolo de N3', 'Desde el lunes cambia la forma de revisar los casos de N3.'], ['Capacitación de producto', 'El jueves a las 10 a. m. en la sala principal.'], ['Bienvenidas', 'Tres diseñadores se unen al equipo esta semana.']], an('der', 150))])]),
        sec({fondoTipo: 'color', fondo: AS, padArriba: 60, padAbajo: 60, alinearV: 'center'}, [col(7, [b('video', {src: '', radio: 18}, an('izq', 0, {sombra: true, radio: 18}))]),
          col(5, [ETIQUETA('▶ VIDEO DE LA SEMANA', A, an('der')), T('Mira el resumen en video', 'h2', {}, an('der', 120)), P('<p>Pega aquí el enlace de YouTube, Vimeo o WorkDrive, o sube un mp4. El video entra con una animación al bajar por la página.</p>', {color: I}, an('der', 240)),
            b('botones', {items: [{texto: 'Ver todas las noticias', url: '', estilo: 'solido'}]}, an('der', 360))])]),
        sec({padArriba: 56, padAbajo: 16}, [col(12, [T('En fotos', 'h2', {alinear: 'center'}, an('subir')), P('<p>Los momentos de la semana.</p>', {alinear: 'center', color: I}, an('subir', 120))])]),
        sec({ancho: 'ancho', padArriba: 0, padAbajo: 40}, [col(12, [GALERIA({columnas: 4, alto: 210, radio: 14, entrada: 'zoom'})])]),
        sec({padArriba: 30, padAbajo: 70}, [col(12, [b('muro', {titulo: 'Todas las noticias', columnas: 3, estilo: 'tarjetas', cantidad: 9}, an('subir'))])])]}; }},
    {id: 'noticiero', nombre: 'Noticiero en video ✨', descripcion: 'Fondo azul noche: video principal grande, más videos al lado, fila de tres videos y noticias escritas.', crear: function() {
      var vid = function(r) { return b('video', {src: '', radio: r || 14}); };
      return {
        tema: TEMA({fuenteTitulos: 'Bebas Neue', fuenteTexto: 'Inter', primario: A, fondo: N, texto: '#e6e8f5', radio: 14}),
        secciones: [
          sec({fondoTipo: 'degradado', fondo: N, fondo2: I, angulo: 120, animarFondo: true, colorTexto: B, padArriba: 50, padAbajo: 30, ancho: 'ancho'},
            [col(12, [ETIQUETA('● EN VIDEO', '#ff5a5f', an('aparecer')), T('Noticiero de Design', 'h1', {tamano: 64, peso: '400'}, an('subir', 120))])]),
          sec({fondoTipo: 'color', fondo: I, colorTexto: '#e6e8f5', padArriba: 20, padAbajo: 50, ancho: 'ancho'},
            [col(8, [Object.assign(vid(18), {estilo: an('zoom', 0, {sombra: true, radio: 18, margenAbajo: 14})}), T('Titular del video principal', 'h3', {tamano: 30, peso: '400'}, an('subir', 150)), P('<p>Un resumen corto de lo que trata el video.</p>', {color: '#b9bde3'}, an('subir', 250))]),
             col(4, [T('Más videos', 'h3', {peso: '400', tamano: 28}, an('der')), Object.assign(vid(), {estilo: an('der', 120, {margenAbajo: 14})}), Object.assign(vid(), {estilo: an('der', 260)})])]),
          sec({fondoTipo: 'color', fondo: N, colorTexto: '#e6e8f5', padArriba: 50, padAbajo: 50, ancho: 'ancho'}, [0, 1, 2].map(function(i) {
            return col(4, [Object.assign(vid(), {estilo: an('subir', i * 150, {margenAbajo: 10})}), T(['Capacitación', 'Detrás de cámaras', 'Mensaje del equipo'][i], 'h4', {peso: '600'}, an('subir', i * 150 + 100))]); })),
          sec({fondoTipo: 'color', fondo: I, colorTexto: '#e6e8f5', padArriba: 50, padAbajo: 70, ancho: 'ancho'}, [col(12, [b('muro', {titulo: 'Noticias escritas', columnas: 3, estilo: 'tarjetas'}, an('subir'))])])]};
    }},
    {id: 'boletin', nombre: 'Boletín semanal ✨', descripcion: 'Encabezado con ola, noticias con foto que entran por los lados, fotos que suben una a una, frase y cuenta regresiva.', crear: function() {
      var nota = function(n, titulo, texto, fotoDer) {
        var txt = col(6, [ETIQUETA('NOTICIA ' + n, A, an(fotoDer ? 'izq' : 'der')), T(titulo, 'h2', {}, an(fotoDer ? 'izq' : 'der', 120)), P('<p>' + texto + '</p>', {tamano: 17, color: I}, an(fotoDer ? 'izq' : 'der', 240))]);
        var img = col(6, [b('imagen', {src: PH('Foto de la noticia ' + n, n % 2 ? A : I, N), radio: 20, efecto: 'zoom', alto: 320}, an(fotoDer ? 'der' : 'izq', 100, {sombra: true, radio: 20}))]);
        return sec({fondoTipo: n % 2 ? 'color' : 'ninguno', fondo: B, padArriba: 56, padAbajo: 56, alinearV: 'center'}, fotoDer ? [txt, img] : [img, txt]);
      };
      return {tema: TEMA({fuenteTitulos: 'DM Sans', fuenteTexto: 'DM Sans', fondo: IS, radio: 16}),
        secciones: [
          sec({fondoTipo: 'degradado', fondo: A, fondo2: I, angulo: 120, animarFondo: true, colorTexto: B, ancho: 'estrecho', padArriba: 80, padAbajo: 60, forma: 'ola'},
            [col(12, [ETIQUETA('BOLETÍN SEMANAL', B, an('aparecer'), 'center'), T('Lo que pasó esta semana en Design', 'h1', {alinear: 'center'}, an('zoom', 120)), P('<p>Noticias, fotos y fechas importantes del equipo.</p>', {alinear: 'center', tamano: 18}, an('subir', 260))])]),
          nota(1, 'Récord de casos aprobados', 'El equipo cerró la semana con el mejor resultado de QC del año. ¡Gracias a todos!', true),
          nota(2, 'Nuevo flujo en N2', 'Las órdenes en Html ahora pasan solas al día siguiente, igual que las de Hold.', false),
          nota(3, 'Capacitación de nuevos productos', 'Aprende las novedades del catálogo en la sesión del jueves.', true),
          sec({fondoTipo: 'color', fondo: B, colorTexto: N, padArriba: 60, padAbajo: 60, alinearV: 'center'}, [col(5, [ETIQUETA('▶ VIDEO', A, an('izq')), T('El video de la semana', 'h2', {}, an('izq', 120)), P('<p>Pega aquí el enlace del video o sube un mp4.</p>', {}, an('izq', 240))]),
          col(7, [b('video', {src: '', radio: 18}, an('der', 100, {sombra: true, radio: 18}))])]),
          sec({padArriba: 56, padAbajo: 50}, [col(12, [T('La semana en fotos', 'h2', {alinear: 'center'}, an('subir')), GALERIA({columnas: 3, alto: 220, radio: 14, entrada: 'subir'})])]),
          sec({fondoTipo: 'color', fondo: N, colorTexto: B, padArriba: 60, padAbajo: 60, alinearV: 'center'}, [col(7, [b('cita', {estilo: 'linea', texto: 'Los grandes resultados se construyen con pequeños detalles bien hechos.', autor: 'Equipo Design', cargo: ''}, an('izq'))]),
            col(5, [b('cuenta', {titulo: 'Próxima reunión general', color: A}, an('der', 0, {fondo: I, relleno: 22, radio: 18}))])]),
          sec({ancho: 'estrecho', padArriba: 50, padAbajo: 70}, [col(12, [b('muro', {titulo: 'Más noticias', estilo: 'lista', cantidad: 6}, an('subir'))])])]};
    }},

    // ---------- Halloween (octubre) ----------
    {id: 'hw_murcielagos', nombre: 'Halloween: noche de murciélagos 🦇', descripcion: 'Noche morada con murciélagos que vuelan, carrusel del concurso de disfraces, cuenta regresiva a la fiesta y fotos que aparecen una a una.', crear: function() { return {
      tema: TEMA({fuenteTitulos: 'Creepster', fuenteTexto: 'Nunito', primario: HN, secundario: HM, acento: HN, fondo: '#140b26', texto: '#f3e9ff', radio: 16}),
      secciones: [
        sec({fondoTipo: 'degradado', fondo: '#0d0a1f', fondo2: HM, angulo: 160, animarFondo: true, colorTexto: '#f3e9ff', padArriba: 100, padAbajo: 90, decoracion: 'murcielagos', forma: 'ola'},
          [col(12, [ETIQUETA('🎃 NOTICIAS DE OCTUBRE', HN, an('aparecer', 0), 'center'), T('Halloween en Design', 'h1', {alinear: 'center', tamano: 78, peso: '400', color: HN}, an('zoom', 150)),
            P('<p>Disfraces, dulces y sustos: todo lo que pasa este mes en el equipo.</p>', {alinear: 'center', tamano: 19}, an('subir', 300)),
            b('botones', {alinear: 'center', tamano: 'l', items: [{texto: 'Inscribe tu disfraz', url: '', estilo: 'solido'}, {texto: 'Ver las fotos', url: '', estilo: 'borde'}]}, an('subir', 450))])]),
        sec({ancho: 'ancho', padArriba: 40, padAbajo: 40}, [col(8, [CARRUSEL({alto: 440, radio: 18, efecto: 'fundido', intervalo: 5, oscurecer: 40, zoomLento: true, items: [
            {src: PH('Concurso de disfraces', HN, HM), titulo: 'Concurso de disfraces', texto: 'Sube tu foto y vota por tu favorito.', enlace: ''}, {src: PH('Decoración de puestos', HM, '#0d0a1f'), titulo: 'Decoración de puestos', texto: 'El área más terrorífica gana.', enlace: ''}, {src: PH('Noche de dulces', HN, '#0d0a1f'), titulo: 'Noche de dulces', texto: '', enlace: ''}]}, an('zoom'))]),
          col(4, [b('cuenta', {titulo: 'Fiesta de Halloween', fecha: PROX(10, 31, 16), textoFin: '¡Feliz Halloween! 🎃', color: HN}, an('flotar', 200, {fondo: '#24123f', relleno: 24, radio: 18, sombra: true, margenAbajo: 22})),
            b('tarjetas', {estilo: 'vidrio', columnas: 1, items: [{icono: '🏆', titulo: 'Premios', texto: 'Mejor disfraz individual, en grupo y mejor puesto decorado.'}]}, an('der', 350))])]),
        sec({fondoTipo: 'color', fondo: '#24123f', colorTexto: '#f3e9ff', padArriba: 60, padAbajo: 60, alinearV: 'center'}, [col(5, [ETIQUETA('▶ VIDEO', HN, an('izq')), T('Video del concurso de disfraces', 'h2', {}, an('izq', 120)), P('<p>Pega aquí el video del desfile o del concurso.</p>', {}, an('izq', 240))]),
          col(7, [b('video', {src: '', radio: 18}, an('der', 100, {sombra: true, radio: 18}))])]),
        sec({padArriba: 50, padAbajo: 20}, [col(12, [T('Galería del terror', 'h2', {alinear: 'center', peso: '400', tamano: 46, color: HN}, an('subir')), P('<p>Las mejores fotos del concurso.</p>', {alinear: 'center'}, an('subir', 120))])]),
        sec({ancho: 'ancho', padArriba: 0, padAbajo: 50}, [col(12, [GALERIA({columnas: 4, alto: 220, radio: 14, entrada: 'zoom', items: FOTOS_HW('Disfraz')})])]),
        sec({fondoTipo: 'color', fondo: '#24123f', colorTexto: '#f3e9ff', padArriba: 56, padAbajo: 70}, [col(12, [b('muro', {titulo: 'Noticias de Halloween', columnas: 3, estilo: 'destacado'}, an('subir'))])])]}; }},
    {id: 'hw_calabazas', nombre: 'Halloween: calabazas 🎃', descripcion: 'Naranja cálido con calabazas y hojas que caen, video del concurso, actividades en tarjetas que entran una a una y fotos con zoom.', crear: function() { return {
      tema: TEMA({fuenteTitulos: 'Creepster', fuenteTexto: 'Nunito', primario: '#c2410c', secundario: '#3b1d0b', acento: HN, fondo: '#fff7ed', texto: '#3b1d0b', radio: 18}),
      secciones: [
        sec({fondoTipo: 'degradado', fondo: '#ff8a1a', fondo2: '#b3360b', angulo: 135, animarFondo: true, colorTexto: B, padArriba: 80, padAbajo: 80, alinearV: 'center', decoracion: 'calabazas', forma: 'curva'},
          [col(6, [ETIQUETA('OCTUBRE EN NUVIA', '#ffe2c2', an('aparecer')), T('Semana de las calabazas', 'h1', {tamano: 66, peso: '400'}, an('izq', 120)),
            P('<p>Mira el video del concurso y entérate de las actividades de la semana.</p>', {tamano: 18}, an('izq', 260)), b('botones', {tamano: 'l', items: [{texto: 'Participar', url: '', estilo: 'blanco'}]}, an('izq', 400))]),
           col(6, [b('video', {src: '', radio: 22}, an('der', 150, {sombra: true, radio: 22}))])]),
        sec({padArriba: 50, padAbajo: 20}, [col(12, [T('Actividades de la semana', 'h2', {alinear: 'center', peso: '400', tamano: 44, color: '#c2410c'}, an('subir'))])]),
        sec({padArriba: 0, padAbajo: 50}, [['🎭', 'Concurso de disfraces', 'Individual y por equipos. Inscríbete con tu manager.'], ['🍬', 'Dulce o truco', 'Pasa por cada área a recoger dulces el viernes.'], ['🏚', 'Puesto embrujado', 'Decora tu puesto y gana el premio del área.']].map(function(x, i) {
          return col(4, [b('tarjetas', {estilo: 'sombra', columnas: 1, alinear: 'center', items: [{icono: x[0], titulo: x[1], texto: x[2]}]}, an('subir', i * 160))]); })),
        sec({fondoTipo: 'color', fondo: '#3b1d0b', colorTexto: '#ffe2c2', padArriba: 56, padAbajo: 56, decoracion: 'calabazas'}, [col(12, [T('Fotos de la semana', 'h2', {alinear: 'center', peso: '400', tamano: 44}, an('zoom')),
          GALERIA({columnas: 3, alto: 240, radio: 18, entrada: 'zoom', items: FOTOS_HW('Calabaza')})])]),
        sec({padArriba: 56, padAbajo: 70}, [col(8, [b('muro', {titulo: 'Novedades', columnas: 2, estilo: 'destacado'}, an('izq'))]),
          col(4, [b('cuenta', {titulo: 'Cierre de votaciones', fecha: PROX(10, 31, 12), textoFin: '¡Ya tenemos ganadores!', color: '#c2410c'}, an('der', 0, {fondo: B, relleno: 22, radio: 18, sombra: true}))])])]}; }},
    {id: 'hw_fantasmas', nombre: 'Halloween: fantasmas 👻', descripcion: 'Morado y negro con fantasmas que suben, noticia principal con foto que flota, cifras del concurso, reglas y muro.', crear: function() { return {
      tema: TEMA({fuenteTitulos: 'Creepster', fuenteTexto: 'Inter', primario: '#a855f7', secundario: '#1e1033', acento: '#b6f36b', fondo: '#120a20', texto: '#ede4ff', radio: 16}),
      secciones: [
        sec({fondoTipo: 'degradado', fondo: '#1e1033', fondo2: '#4c1d95', angulo: 180, colorTexto: '#ede4ff', padArriba: 90, padAbajo: 80, alinearV: 'center', decoracion: 'fantasmas'},
          [col(7, [ETIQUETA('👻 NOTICIA PRINCIPAL', '#b6f36b', an('aparecer')), T('¡Llegó la noche de los fantasmas!', 'h1', {tamano: 60, peso: '400'}, an('subir', 120)),
            P('<p>Cuenta aquí la noticia más importante de Halloween: fechas, lugar y cómo participar.</p>', {tamano: 18, color: '#cbb8f5'}, an('subir', 260)),
            b('botones', {tamano: 'l', items: [{texto: 'Leer más', url: '', estilo: 'solido'}]}, an('subir', 400))]),
           col(5, [b('imagen', {src: PH('Foto de Halloween', '#a855f7', '#1e1033'), radio: 28, efecto: 'lento'}, an('flotar', 200, {sombra: true, radio: 28}))])]),
        sec({fondoTipo: 'color', fondo: '#1e1033', colorTexto: '#ede4ff', padArriba: 50, padAbajo: 50}, [col(12, [b('cifras', {color: '#b6f36b', items: [
          {numero: 45, prefijo: '', sufijo: '', etiqueta: 'Disfraces inscritos'}, {numero: 320, prefijo: '', sufijo: '+', etiqueta: 'Votos'}, {numero: 6, prefijo: '', sufijo: '', etiqueta: 'Premios'}]}, an('zoom'))])]),
        sec({padArriba: 56, padAbajo: 50, decoracion: 'fantasmas'}, [col(6, [T('Reglas del concurso', 'h2', {peso: '400', tamano: 40}, an('izq')), b('acordeon', {items: [
            {titulo: '¿Quién puede participar?', texto: 'Todo el equipo de Design, de forma individual o en grupo.'}, {titulo: '¿Cómo voto?', texto: 'Escribe en el muro el nombre de tu disfraz favorito.'}, {titulo: '¿Cuándo son los premios?', texto: 'El 31 de octubre al final de la jornada.'}]}, an('izq', 150, {fondo: '#1e1033', relleno: 18, radio: 16}))]),
          col(6, [b('video', {src: '', radio: 18}, an('der', 0, {margenAbajo: 18})), b('cuenta', {titulo: 'Premiación', fecha: PROX(10, 31, 17), textoFin: '¡Feliz Halloween! 👻', color: '#b6f36b'}, an('der', 200, {fondo: '#1e1033', relleno: 20, radio: 16}))])]),
        sec({fondoTipo: 'color', fondo: '#1e1033', colorTexto: '#ede4ff', padArriba: 50, padAbajo: 70}, [col(12, [GALERIA({columnas: 4, alto: 200, radio: 14, entrada: 'subir', items: FOTOS_HW('Fantasma')}, {margenAbajo: 30}), b('muro', {titulo: 'Lo que está pasando', columnas: 3, estilo: 'tarjetas'}, an('subir'))])])]}; }},

    // ---------- Navidad y fin de año ----------
    {id: 'nv_nieve', nombre: 'Navidad: noche de nieve ❄', descripcion: 'Azul noche de Nuvia con nieve que cae, carrusel en zoom lento, cuenta regresiva a Navidad y muro de mensajes.', crear: function() { return {
      tema: TEMA({fuenteTitulos: 'Mountains of Christmas', fuenteTexto: 'Lato', fondo: '#f4f8fc', radio: 18}),
      secciones: [
        sec({fondoTipo: 'degradado', fondo: N, fondo2: '#0b3a66', angulo: 180, colorTexto: B, padArriba: 100, padAbajo: 90, decoracion: 'nieve', forma: 'ola'},
          [col(12, [ETIQUETA('❄ NOTICIAS DE DICIEMBRE', '#bfe3f7', an('aparecer'), 'center'), T('Feliz Navidad, equipo de Design', 'h1', {alinear: 'center', tamano: 68}, an('zoom', 150)),
            P('<p>Novenas, amigo secreto y la fiesta de fin de año: aquí encuentras todo.</p>', {alinear: 'center', tamano: 19, color: '#d7e9f7'}, an('subir', 300)),
            b('botones', {alinear: 'center', tamano: 'l', items: [{texto: 'Ver la programación', url: '', estilo: 'blanco'}]}, an('subir', 450))])]),
        sec({ancho: 'ancho', padArriba: 40, padAbajo: 40}, [col(8, [CARRUSEL({alto: 440, radio: 18, efecto: 'fundido', intervalo: 5, oscurecer: 35, zoomLento: true, items: [
            {src: PH('Novena de aguinaldos', NR, NV), titulo: 'Novena de aguinaldos', texto: 'Del 16 al 24 de diciembre a las 4 p. m.', enlace: ''}, {src: PH('Amigo secreto', NV, N), titulo: 'Amigo secreto', texto: 'El intercambio es el 20 de diciembre.', enlace: ''}, {src: PH('Fiesta de fin de año', A, N), titulo: 'Fiesta de fin de año', texto: '', enlace: ''}]}, an('zoom'))]),
          col(4, [b('cuenta', {titulo: 'Faltan para Navidad', fecha: PROX(12, 24, 18), textoFin: '¡Feliz Navidad! 🎄', color: NR}, an('flotar', 200, {fondo: B, relleno: 24, radio: 18, sombra: true, margenAbajo: 20})),
            b('tarjetas', {estilo: 'sombra', columnas: 1, items: [{icono: '🎁', titulo: 'Amigo secreto', texto: 'Recuerda el valor acordado y entrega tu regalo el día del intercambio.'}]}, an('der', 350))])]),
        sec({fondoTipo: 'color', fondo: N, colorTexto: B, padArriba: 60, padAbajo: 60, alinearV: 'center'}, [col(5, [ETIQUETA('▶ VIDEO', '#ffd7dc', an('izq')), T('Mensaje de Navidad', 'h2', {}, an('izq', 120)), P('<p>Pega aquí el video con el saludo de fin de año.</p>', {}, an('izq', 240))]),
          col(7, [b('video', {src: '', radio: 18}, an('der', 100, {sombra: true, radio: 18}))])]),
        sec({padArriba: 50, padAbajo: 60}, [col(12, [T('Momentos navideños', 'h2', {alinear: 'center', tamano: 46}, an('subir')), GALERIA({columnas: 4, alto: 210, radio: 16, entrada: 'zoom', items: FOTOS_NV('Navidad')})])]),
        sec({fondoTipo: 'color', fondo: N, colorTexto: B, padArriba: 56, padAbajo: 70, decoracion: 'nieve'}, [col(12, [b('muro', {titulo: 'Mensajes y noticias', columnas: 3, estilo: 'tarjetas'}, an('subir'))])])]}; }},
    {id: 'nv_clasica', nombre: 'Navidad clásica 🎄', descripcion: 'Rojo y verde con estrellas y regalos que caen, video del mensaje de fin de año, programación en tarjetas y fotos con zoom.', crear: function() { return {
      tema: TEMA({fuenteTitulos: 'Mountains of Christmas', fuenteTexto: 'Nunito', primario: NR, secundario: NV, acento: ND, fondo: '#fffaf2', texto: '#2b1a12', radio: 18}),
      secciones: [
        sec({fondoTipo: 'degradado', fondo: NR, fondo2: '#7a0a1d', angulo: 135, animarFondo: true, colorTexto: B, padArriba: 80, padAbajo: 80, alinearV: 'center', decoracion: 'navidad', forma: 'curva'},
          [col(6, [ETIQUETA('🎄 MENSAJE DE NAVIDAD', '#ffe7a3', an('aparecer')), T('Gracias por este año juntos', 'h1', {tamano: 62}, an('izq', 120)),
            P('<p>Mira el video con el mensaje de fin de año para todo el equipo de Design.</p>', {tamano: 18}, an('izq', 260))]),
           col(6, [b('video', {src: '', radio: 22}, an('der', 150, {sombra: true, radio: 22}))])]),
        sec({padArriba: 56, padAbajo: 20}, [col(12, [T('Programación de diciembre', 'h2', {alinear: 'center', tamano: 48, color: NV}, an('subir'))])]),
        sec({padArriba: 0, padAbajo: 50}, [['🕯', 'Novena', 'Del 16 al 24 de diciembre. Cada día la organiza un equipo distinto.'], ['🎁', 'Amigo secreto', 'Intercambio de regalos el 20 de diciembre.'], ['🥳', 'Fiesta de fin de año', 'Fecha, lugar y código de vestuario por confirmar.']].map(function(x, i) {
          return col(4, [b('tarjetas', {estilo: 'borde', columnas: 1, alinear: 'center', items: [{icono: x[0], titulo: x[1], texto: x[2]}]}, an('subir', i * 160))]); })),
        sec({fondoTipo: 'color', fondo: NV, colorTexto: B, padArriba: 56, padAbajo: 56, decoracion: 'navidad'}, [col(12, [T('Nuestra Navidad en fotos', 'h2', {alinear: 'center', tamano: 46}, an('zoom')),
          GALERIA({columnas: 3, alto: 240, radio: 18, entrada: 'zoom', items: FOTOS_NV('Foto')})])]),
        sec({padArriba: 56, padAbajo: 70}, [col(8, [b('muro', {titulo: 'Noticias de diciembre', columnas: 2, estilo: 'destacado'}, an('izq'))]),
          col(4, [b('cuenta', {titulo: 'Noche de velitas', fecha: PROX(12, 7, 18), textoFin: '¡Feliz noche de velitas! 🕯', color: NR}, an('der', 0, {fondo: B, relleno: 22, radio: 18, sombra: true, margenAbajo: 20})),
            b('cita', {estilo: 'tarjeta', texto: 'La Navidad no es un momento ni una estación, sino un estado de la mente.', autor: 'Calvin Coolidge', cargo: ''}, an('der', 200))])])]}; }},
    {id: 'nv_fin_ano', nombre: 'Fin de año 🎆', descripcion: 'Azul noche y dorado con confeti, cifras del año que cuentan solas, fotos que aparecen una a una y cuenta regresiva al año nuevo.', crear: function() { return {
      tema: TEMA({fuenteTitulos: 'Playfair Display', fuenteTexto: 'Inter', primario: ND, secundario: N, acento: ND, fondo: '#0f0c2e', texto: '#f5f1e6', radio: 16}),
      secciones: [
        sec({fondoTipo: 'degradado', fondo: '#0f0c2e', fondo2: I, angulo: 160, animarFondo: true, colorTexto: '#f5f1e6', padArriba: 110, padAbajo: 90, decoracion: 'confeti'},
          [col(12, [ETIQUETA('✨ RESUMEN DEL AÑO', ND, an('aparecer'), 'center'), T('¡Gracias por un gran año!', 'h1', {alinear: 'center', tamano: 64}, an('zoom', 150)),
            P('<p>Lo que logramos juntos y lo que viene para el próximo año.</p>', {alinear: 'center', tamano: 19, color: '#d9d2bd'}, an('subir', 300))])]),
        sec({fondoTipo: 'color', fondo: N, colorTexto: '#f5f1e6', padArriba: 50, padAbajo: 50}, [col(12, [b('cifras', {color: ND, items: [
          {numero: 30000, prefijo: '', sufijo: '+', etiqueta: 'Casos diseñados'}, {numero: 98, prefijo: '', sufijo: '%', etiqueta: 'Aprobados con QC'}, {numero: 12, prefijo: '', sufijo: '', etiqueta: 'Equipos'}, {numero: 60, prefijo: '', sufijo: '+', etiqueta: 'Centros'}]}, an('zoom'))])]),
        sec({padArriba: 56, padAbajo: 40, alinearV: 'center'}, [col(7, [b('video', {src: '', radio: 18}, an('izq', 0, {sombra: true, radio: 18}))]),
          col(5, [T('El año en un video', 'h2', {}, an('der')), P('<p>Pega aquí el video resumen del año.</p>', {color: '#d9d2bd'}, an('der', 150)),
            b('cuenta', {titulo: 'Faltan para el año nuevo', fecha: PROX(1, 1, 0), textoFin: '¡Feliz año nuevo! 🎆', color: ND}, an('der', 300, {fondo: N, relleno: 20, radio: 16}))])]),
        sec({padArriba: 40, padAbajo: 50, decoracion: 'confeti'}, [col(12, [T('Momentos del año', 'h2', {alinear: 'center'}, an('subir')), GALERIA({columnas: 4, alto: 210, radio: 14, entrada: 'subir', items: [1, 2, 3, 4, 5, 6, 7, 8].map(function(i) { return {src: PH('Momento ' + i, [ND, I, N, A][i % 4], '#0f0c2e'), titulo: ''}; })})])]),
        sec({fondoTipo: 'color', fondo: N, colorTexto: '#f5f1e6', padArriba: 56, padAbajo: 70}, [col(12, [b('muro', {titulo: 'Mensajes de fin de año', columnas: 3, estilo: 'tarjetas'}, an('subir'))])])]}; }}
  ];
  NVI.PLANTILLA_VACIA = function() { return {tema: NVI.clon(NVI.TEMA_BASE), secciones: [sec({}, [col(12, [T('Inicio de Design', 'h1'), P(P1)])])]}; };
  NVI.nuevaSeccion = function(tipo) {
    if (tipo === 'libre') return libre({alto: 480}, [el(5, 40, 40, 0, T('Arrástrame', 'h2'), 1)]);
    var anchos = {c1: [12], c2: [6, 6], c3: [4, 4, 4], c4: [3, 3, 3, 3], c13: [4, 8], c31: [8, 4], c121: [3, 6, 3]}[tipo] || [12];
    return sec({}, anchos.map(function(a) { return col(a, []); }));
  };
  NVI.nuevoBloque = function(tipo) { return b(tipo); };
})();
