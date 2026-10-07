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
          col(5, [b('acordeon', {}, an('der', 0, {fondo: B, relleno: 18, radio: 14, sombra: true}))])])]}; }}
  ];
  NVI.PLANTILLA_VACIA = function() { return {tema: NVI.clon(NVI.TEMA_BASE), secciones: [sec({}, [col(12, [T('Inicio de Design', 'h1'), P(P1)])])]}; };
  NVI.nuevaSeccion = function(tipo) {
    if (tipo === 'libre') return libre({alto: 480}, [el(5, 40, 40, 0, T('Arrástrame', 'h2'), 1)]);
    var anchos = {c1: [12], c2: [6, 6], c3: [4, 4, 4], c4: [3, 3, 3, 3], c13: [4, 8], c31: [8, 4], c121: [3, 6, 3]}[tipo] || [12];
    return sec({}, anchos.map(function(a) { return col(a, []); }));
  };
  NVI.nuevoBloque = function(tipo) { return b(tipo); };
})();
