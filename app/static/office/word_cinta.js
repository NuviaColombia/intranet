/* Nuvia Word: cinta de opciones (pestañas, grupos y botones como Word), estado de los botones, búsqueda de comandos
   y atajos de teclado. Las acciones complejas abren diálogos de word_dialogos.js. */
(function() {
  'use strict';
  var NV = window.NV, W = NV.word, C = W.cinta = {};
  var I = NV.icono, esc = NV.esc;
  function ed() { return W.ed(); }
  function foco() { var e = ed(); if (e) e.focus(); return e; }
  function cmd(c, ui, v) { var e = foco(); if (!e || W.est.soloLectura) return; e.execCommand(c, ui || false, v); W.marcarCambio(); W.paginar(); }

  // ---------- Constructores de botones ----------
  function attrs(a, v, t) { return ' data-a="' + a + '"' + (v != null ? ' data-v="' + esc(v) + '"' : '') + ' title="' + esc(t || '') + '" aria-label="' + esc(t || '') + '"'; }
  function B(a, ic, t, v, extra) {  // botón pequeño solo ícono
    return '<button type="button" class="nv-b"' + attrs(a, v, t) + (extra || '') + '>' + (ic.charAt(0) === '<' ? ic : I(ic)) + '</button>';
  }
  function BT(a, ic, txt, t, v, menu) {  // botón pequeño con texto
    return '<button type="button" class="nv-b"' + attrs(a, v, t || txt) + (menu ? ' data-menu="1"' : '') + '>' + (ic ? I(ic, 'p') : '') +
      '<span>' + esc(txt) + '</span>' + (menu ? '<span class="nv-flecha">▾</span>' : '') + '</button>';
  }
  function BG(a, ic, txt, t, v, menu) {  // botón grande
    return '<button type="button" class="nv-b grande"' + attrs(a, v, t || txt.replace(/\n/g, ' ')) + (menu ? ' data-menu="1"' : '') + '>' + I(ic, 'g') +
      '<span class="nv-b-txt">' + esc(txt).replace(/\n/g, '<br>') + (menu ? '<span class="nv-flecha">▾</span>' : '') + '</span></button>';
  }
  function BL(a, letra, estilo, t) {  // N K S como en Word en español
    return '<button type="button" class="nv-b"' + attrs(a, null, t) + '><span style="font:' + estilo + ' 15px/1 Georgia,serif;width:16px;display:inline-block;text-align:center">' + letra + '</span></button>';
  }
  function SPLIT(a, am, ic, t, colorId) {
    return '<span class="nv-split"><button type="button" class="nv-b' + (colorId ? ' color' : '') + '"' + attrs(a, null, t) + '>' + (ic.charAt(0) === '<' ? ic : I(ic)) +
      (colorId ? '<span class="nv-color-barra" id="' + colorId + '"></span>' : '') + '</button>' +
      '<button type="button" class="nv-b mas"' + attrs(am, null, t + ': más opciones') + ' data-menu="1"><span class="nv-flecha">▾</span></button></span>';
  }
  function G(nombre, cuerpo, lanzador) {
    return '<div class="nv-grupo" role="group" aria-label="' + esc(nombre) + '"><div class="nv-grupo-cuerpo">' + cuerpo + '</div><div class="nv-grupo-nombre">' + esc(nombre) +
      '</div>' + (lanzador ? '<button type="button" class="nv-lanzador"' + attrs(lanzador, null, nombre + ': más opciones') + '>' + I('arrow_down_right', 'p') + '</button>' : '') + '</div>';
  }
  function COL() { return '<div class="nv-col">' + Array.prototype.join.call(arguments, '') + '</div>'; }
  function FILA() { return '<div class="nv-fila">' + Array.prototype.join.call(arguments, '') + '</div>'; }
  function NUM(id, etq, unidad, t, paso) {
    return '<label class="nv-num" title="' + esc(t) + '"><span style="width:58px">' + esc(etq) + '</span><input type="number" id="' + id + '" step="' + (paso || 0.1) +
      '" data-num="' + id + '"><span>' + esc(unidad) + '</span></label>';
  }
  function CHK(id, etq) { return '<label class="nv-chk" style="font-size:12.5px;margin:2px 0"><input type="checkbox" id="' + id + '" data-chk="' + id + '"> ' + esc(etq) + '</label>'; }

  // ---------- Pestañas ----------
  var ESTILOS = [
    {f: 'Normal', n: 'Normal', m: 'AaBbCcDd'}, {f: 'NoSpacing', n: 'Sin espaciado', m: 'AaBbCcDd'},
    {f: 'Heading1', n: 'Título 1', m: 'AaBbCc', s: 'h1'}, {f: 'Heading2', n: 'Título 2', m: 'AaBbCcD', s: 'h2'},
    {f: 'Heading3', n: 'Título 3', m: 'AaBbCcD', s: 'h3'}, {f: 'Title', n: 'Título', m: 'AaBb', s: 'title'},
    {f: 'Subtitle', n: 'Subtítulo', m: 'AaBbCcD', s: 'sub'}, {f: 'SubtleEmphasis', n: 'Énfasis sutil', m: 'AaBbCcD', s: 'se'},
    {f: 'Emphasis', n: 'Énfasis', m: 'AaBbCcD', s: 'em'}, {f: 'IntenseEmphasis', n: 'Énfasis intenso', m: 'AaBbCcD', s: 'ie'},
    {f: 'Strong', n: 'Texto en negrita', m: 'AaBbCcD', s: 'b'}, {f: 'Quote', n: 'Cita', m: 'AaBbCcD', s: 'q'},
    {f: 'IntenseQuote', n: 'Cita destacada', m: 'AaBbCcD', s: 'iq'}, {f: 'SubtleReference', n: 'Referencia sutil', m: 'AABBCCD', s: 'sr'},
    {f: 'IntenseReference', n: 'Referencia intensa', m: 'AABBCCD', s: 'ir'}, {f: 'BookTitle', n: 'Título del libro', m: 'AaBbCcD', s: 'bt'},
    {f: 'ListParagraph', n: 'Párrafo de lista', m: 'AaBbCcD'}, {f: 'Heading4', n: 'Título 4', m: 'AaBbCcD', s: 'h4'},
    {f: 'Caption', n: 'Descripción', m: 'AaBbCcD', s: 'cap'}
  ];
  C.ESTILOS = ESTILOS;
  function muestraEstilo(e) {
    var t = W.tema(), tf = NV.cssFuente(t.titulos).replace(/"/g, "'"), ac = t.acentos[0];
    var m = {h1: 'font-family:' + tf + ';color:' + t.h + ';font-size:17px', h2: 'font-family:' + tf + ';color:' + t.h + ';font-size:15px',
             h3: 'font-family:' + tf + ';color:' + t.h3 + ';font-size:14px', h4: 'font-family:' + tf + ';color:' + t.h + ';font-style:italic',
             title: 'font-family:' + tf + ';font-size:22px', sub: 'color:#5a5a5a', se: 'font-style:italic;color:#404040', em: 'font-style:italic',
             ie: 'font-style:italic;color:' + ac, b: 'font-weight:bold', q: 'font-style:italic;color:#404040', iq: 'font-style:italic;color:' + ac,
             sr: 'font-variant:small-caps;color:#5a5a5a', ir: 'font-variant:small-caps;font-weight:bold;color:' + ac, bt: 'font-weight:bold;font-style:italic',
             cap: 'font-style:italic;color:' + t.oscuro + ';font-size:12px'}[e.s] || '';
    return 'font-family:' + NV.cssFuente(t.cuerpo).replace(/"/g, "'") + ';' + m;
  }
  var galeriaIni = 0;
  function galeriaEstilos() {
    var h = '<div class="nv-galeria" role="listbox" aria-label="Estilos"><div class="nv-galeria-items" id="nvGalEstilos">';
    ESTILOS.slice(galeriaIni, galeriaIni + 6).forEach(function(e) {
      h += '<button type="button" class="nv-estilo-item" data-a="estilo" data-v="' + e.f + '" title="' + esc(e.n) + '" role="option"><span class="muestra" style="' + muestraEstilo(e) + '">' + e.m +
        '</span><span class="nombre">' + esc(e.n) + '</span></button>';
    });
    return h + '</div><div class="nv-galeria-mas"><button type="button" data-a="galEst" data-v="-1" title="Fila anterior" aria-label="Estilos anteriores">▲</button>' +
      '<button type="button" data-a="galEst" data-v="1" title="Fila siguiente" aria-label="Más estilos">▼</button><button type="button" data-a="menuEstilos" data-menu="1" title="Todos los estilos" aria-label="Todos los estilos">☰</button></div></div>';
  }
  var TABS = {
    inicio: {n: 'Inicio', r: function() {
      return G('Portapapeles',
          '<span class="nv-split" style="flex-direction:column"><button type="button" class="nv-b grande" style="height:52px"' + attrs('pegar', null, 'Pegar (Ctrl+V)') + '>' + I('clipboard_paste', 'g') +
          '</button><button type="button" class="nv-b" style="height:22px;font-size:12px"' + attrs('menuPegar', null, 'Opciones de pegado') + ' data-menu="1">Pegar <span class="nv-flecha">▾</span></button></span>' +
          COL(BT('cortar', 'cut', 'Cortar', 'Cortar (Ctrl+X)'), BT('copiar', 'copy', 'Copiar', 'Copiar (Ctrl+C)'), BT('brocha', 'paint_brush', 'Copiar formato', 'Copiar formato (Ctrl+Mayús+C). Doble clic para aplicarlo varias veces'))) +
        G('Fuente', COL(
          FILA('<span class="nv-combo"><input id="nvFuente" style="width:132px" aria-label="Fuente" title="Fuente (Ctrl+Mayús+F)"><button type="button" data-a="menuFuente" data-menu="1" aria-label="Lista de fuentes" title="Fuentes">▾</button></span>',
               '<span class="nv-combo"><input id="nvTamano" style="width:40px" aria-label="Tamaño de fuente" title="Tamaño de fuente (Ctrl+Mayús+P)"><button type="button" data-a="menuTamano" data-menu="1" aria-label="Lista de tamaños" title="Tamaños">▾</button></span>',
               B('agrandar', 'font_increase', 'Aumentar tamaño de fuente (Ctrl+>)'), B('achicar', 'font_decrease', 'Disminuir tamaño de fuente (Ctrl+<)'),
               '<button type="button" class="nv-b" data-menu="1"' + attrs('menuMayus', null, 'Cambiar mayúsculas y minúsculas (Mayús+F3)') + '><span style="font-size:13px">Aa</span><span class="nv-flecha">▾</span></button>',
               B('borrarFormato', 'text_clear_formatting', 'Borrar todo el formato (Ctrl+Espacio)')),
          FILA(BL('negrita', 'N', 'bold', 'Negrita (Ctrl+B)'), BL('cursiva', 'K', 'italic', 'Cursiva (Ctrl+I)'),
               '<span class="nv-split"><button type="button" class="nv-b"' + attrs('subrayado', null, 'Subrayado (Ctrl+U)') + '><span style="font:15px/1 Georgia,serif;text-decoration:underline;width:16px;display:inline-block;text-align:center">S</span></button>' +
               '<button type="button" class="nv-b mas" data-menu="1"' + attrs('menuSubrayado', null, 'Tipos de subrayado') + '><span class="nv-flecha">▾</span></button></span>',
               B('tachado', 'text_strikethrough', 'Tachado'), B('subindice', 'text_subscript', 'Subíndice (Ctrl+=)'), B('superindice', 'text_superscript', 'Superíndice (Ctrl+Mayús++)'),
               '<button type="button" class="nv-b" data-menu="1"' + attrs('menuEfectos', null, 'Efectos de texto y tipografía') + '><span style="font:bold 15px Georgia;color:#fff;-webkit-text-stroke:1px #185abd;width:14px;display:inline-block">A</span><span class="nv-flecha">▾</span></button>',
               SPLIT('resaltar', 'menuResaltar', 'highlight', 'Color de resaltado de texto', 'nvBarraResaltar'),
               SPLIT('colorFuente', 'menuColorFuente', '<span style="font:bold 15px/1 Georgia,serif;width:16px;display:inline-block;text-align:center">A</span>', 'Color de fuente', 'nvBarraColor'))), 'dlgFuente') +
        G('Párrafo', COL(
          FILA(SPLIT('vinetas', 'menuVinetas', 'text_bullet_list_ltr', 'Viñetas'), SPLIT('numeracion', 'menuNumeracion', 'text_number_list_ltr', 'Numeración'),
               '<button type="button" class="nv-b" data-menu="1"' + attrs('menuMultinivel', null, 'Lista multinivel') + '>' + I('text_bullet_list_tree') + '<span class="nv-flecha">▾</span></button>',
               B('sangriaMenos', 'text_indent_decrease_ltr', 'Disminuir sangría'), B('sangriaMas', 'text_indent_increase_ltr', 'Aumentar sangría'),
               B('ordenar', 'text_sort_ascending', 'Ordenar'), B('marcas', 'text_paragraph', 'Mostrar todo (Ctrl+*)')),
          FILA(B('alinearIzq', 'text_align_left', 'Alinear a la izquierda (Ctrl+L)'), B('alinearCentro', 'text_align_center', 'Centrar (Ctrl+E)'),
               B('alinearDer', 'text_align_right', 'Alinear a la derecha (Ctrl+R)'), B('justificar', 'text_align_justify', 'Justificar (Ctrl+J)'),
               '<button type="button" class="nv-b" data-menu="1"' + attrs('menuInterlineado', null, 'Espaciado entre líneas y párrafos') + '>' + I('text_line_spacing') + '<span class="nv-flecha">▾</span></button>',
               SPLIT('sombreado', 'menuSombreado', 'paint_bucket', 'Sombreado', 'nvBarraSombreado'),
               SPLIT('bordeInf', 'menuBordes', 'border_bottom', 'Bordes'))), 'dlgParrafo') +
        G('Estilos', galeriaEstilos(), 'menuEstilos') +
        G('Edición', COL(
          '<span class="nv-split"><button type="button" class="nv-b"' + attrs('buscar', null, 'Buscar (Ctrl+F)') + '>' + I('search', 'p') + '<span>Buscar</span></button><button type="button" class="nv-b mas" data-menu="1"' + attrs('menuBuscar', null, 'Opciones de búsqueda') + '><span class="nv-flecha">▾</span></button></span>',
          BT('reemplazar', 'arrow_swap', 'Reemplazar', 'Reemplazar (Ctrl+H)'), BT('menuSeleccionar', 'cursor', 'Seleccionar', 'Seleccionar', null, true))) +
        G('Voz', BG('dictar', 'mic', 'Dictar', 'Dictar: escribe con tu voz (Alt+`)'));
    }},
    insertar: {n: 'Insertar', r: function() {
      return G('Páginas', BG('menuPortada', 'document_header', 'Portada', 'Portada', null, true) + COL(BT('paginaBlanco', 'document', 'Página en blanco'), BT('salto', 'document_page_break', 'Salto de página', 'Salto de página (Ctrl+Enter)'))) +
        G('Tablas', BG('menuTabla', 'table', 'Tabla', 'Insertar tabla', null, true)) +
        G('Ilustraciones', BG('menuImagenes', 'image', 'Imágenes', 'Insertar imágenes', null, true) + BG('menuFormas', 'shapes', 'Formas', 'Formas', null, true) +
          BG('menuIconos', 'emoji', 'Iconos', 'Insertar un ícono', null, true) + BG('grafico', 'data_bar_vertical', 'Gráfico', 'Insertar gráfico')) +
        G('Vínculos', COL(BT('vinculo', 'link', 'Vínculo', 'Vínculo (Ctrl+K)'), BT('marcador', 'bookmark', 'Marcador'), BT('referenciaCruzada', 'link_square', 'Referencia cruzada'))) +
        G('Comentarios', BG('comentario', 'comment_add', 'Comentario', 'Nuevo comentario (Ctrl+Alt+M)')) +
        G('Encabezado y pie de página', COL(BT('menuEncabezado', 'document_header', 'Encabezado', 'Encabezado', null, true), BT('menuPie', 'document_footer', 'Pie de página', 'Pie de página', null, true),
          BT('menuNumPagina', 'number_symbol', 'Número de página', 'Número de página', null, true))) +
        G('Texto', BG('menuCuadroTexto', 'textbox', 'Cuadro\nde texto', 'Cuadro de texto', null, true) + COL(BT('menuWordart', 'text_effects', 'WordArt', 'WordArt', null, true),
          BT('menuCapital', 'text_case_title', 'Letra capital', 'Letra capital', null, true), BT('lineaFirma', 'signature', 'Línea de firma')) +
          COL(BT('fechaHora', 'calendar_ltr', 'Fecha y hora'), BT('lineaHorizontal', 'line_horizontal_1', 'Línea horizontal'))) +
        G('Símbolos', COL(BT('ecuacion', 'math_formula', 'Ecuación', 'Insertar ecuación'), BT('menuSimbolo', 'symbols', 'Símbolo', 'Símbolo', null, true)));
    }},
    diseno: {n: 'Diseño', r: function() {
      return G('Formato del documento', BG('menuTemas', 'color', 'Temas', 'Temas', null, true) + galeriaFormato() +
          COL(BT('menuColoresTema', 'color_fill', 'Colores', 'Colores del tema', null, true), BT('menuFuentesTema', 'text_font', 'Fuentes', 'Fuentes del tema', null, true),
            BT('menuEspaciado', 'text_paragraph_direction', 'Espaciado entre párrafos', 'Espaciado entre párrafos', null, true))) +
        G('Fondo de página', BG('menuMarcaAgua', 'drop', 'Marca de\nagua', 'Marca de agua', null, true) + BG('menuColorPagina', 'paint_bucket', 'Color de\npágina', 'Color de página', null, true) +
          BG('bordesPagina', 'border_outside', 'Bordes de\npágina', 'Bordes de página'));
    }},
    disposicion: {n: 'Disposición', r: function() {
      return G('Configurar página', BG('menuMargenes', 'document_margins', 'Márgenes', 'Márgenes', null, true) + BG('menuOrientacion', 'document_landscape', 'Orientación', 'Orientación', null, true) +
          BG('menuTamanoPag', 'document', 'Tamaño', 'Tamaño', null, true) + BG('menuColumnas', 'column_triple', 'Columnas', 'Columnas', null, true) +
          COL(BT('menuSaltos', 'document_page_break', 'Saltos', 'Saltos', null, true)), 'dlgPagina') +
        G('Párrafo', COL('<span style="font-size:12px;font-weight:600;padding-left:2px">Sangría</span>', NUM('nvSangIzq', 'Izquierda:', 'cm', 'Sangría izquierda'), NUM('nvSangDer', 'Derecha:', 'cm', 'Sangría derecha')) +
          COL('<span style="font-size:12px;font-weight:600;padding-left:2px">Espaciado</span>', NUM('nvEspAntes', 'Antes:', 'pto', 'Espaciado antes', 6), NUM('nvEspDespues', 'Después:', 'pto', 'Espaciado después', 6)), 'dlgParrafo') +
        G('Organizar', BG('menuPosicion', 'position_to_front', 'Posición', 'Posición del objeto', null, true) + BG('menuAjuste', 'text_wrap', 'Ajustar\ntexto', 'Ajustar texto', null, true) +
          COL(BT('menuAlinearObj', 'align_left', 'Alinear', 'Alinear', null, true), BT('menuGirar', 'arrow_rotate_clockwise', 'Girar', 'Girar', null, true)));
    }},
    referencias: {n: 'Referencias', r: function() {
      return G('Tabla de contenido', BG('menuTOC', 'text_bullet_list_square', 'Tabla de\ncontenido', 'Tabla de contenido', null, true) +
          COL(BT('menuAgregarTexto', 'text_add', 'Agregar texto', 'Agregar texto a la tabla', null, true), BT('actualizarTOC', 'arrow_sync', 'Actualizar tabla'))) +
        G('Notas al pie', BG('notaPie', 'note_add', 'Insertar nota\nal pie', 'Insertar nota al pie (Ctrl+Alt+F)') + COL(BT('notaFinal', 'note', 'Insertar nota al final', 'Insertar nota al final (Ctrl+Alt+D)'),
          BT('siguienteNota', 'arrow_down', 'Siguiente nota al pie'))) +
        G('Títulos', BG('insertarTitulo', 'image_alt_text', 'Insertar\ntítulo', 'Insertar título') + COL(BT('tablaIlustraciones', 'list', 'Insertar tabla de ilustraciones'))) +
        G('Citas y bibliografía', BG('cita', 'book_add', 'Insertar\ncita', 'Insertar cita') + COL(BT('bibliografia', 'book', 'Bibliografía')));
    }},
    revisar: {n: 'Revisar', r: function() {
      return G('Revisión', BG('ortografia', 'text_proofing_tools', 'Ortografía y\ngramática', 'Ortografía y gramática (F7)') + COL(BT('sinonimos', 'book_open', 'Sinónimos', 'Sinónimos (Mayús+F7)'), BT('contarPalabras', 'text_word_count', 'Contar palabras'))) +
        G('Voz', BG('leerVoz', 'speaker_2', 'Leer en\nvoz alta', 'Leer en voz alta (Ctrl+Alt+Espacio)')) +
        G('Idioma', BG('menuIdioma', 'local_language', 'Idioma', 'Idioma', null, true)) +
        G('Comentarios', BG('comentario', 'comment_add', 'Nuevo\ncomentario', 'Nuevo comentario') + COL(BT('comentarios', 'comment_multiple', 'Mostrar comentarios'))) +
        G('Seguimiento', BG('controlCambios', 'document_edit', 'Control de\ncambios', 'Control de cambios (Ctrl+Mayús+E)')) +
        G('Proteger', BG('restringir', 'lock_closed', 'Restringir\nedición', 'Restringir edición'));
    }},
    vista: {n: 'Vista', r: function() {
      return G('Vistas', BG('vista', 'book_open', 'Modo de\nlectura', 'Modo de lectura', 'lectura').replace('data-a="vista"', 'data-a="vista" data-vista="lectura"') +
          BG('vista', 'document', 'Diseño de\nimpresión', 'Diseño de impresión', 'impresion').replace('data-a="vista"', 'data-a="vista" data-vista="impresion"') +
          BG('vista', 'globe', 'Diseño\nweb', 'Diseño web', 'web').replace('data-a="vista"', 'data-a="vista" data-vista="web"')) +
        G('Mostrar', COL(CHK('nvChkRegla', 'Regla'), CHK('nvChkNav', 'Panel de navegación'), CHK('nvChkMarcas', 'Marcas de formato'))) +
        G('Zoom', BG('dlgZoom', 'zoom_in', 'Zoom', 'Zoom') + BG('zoom100', 'zoom_fit', '100%', 'Zoom al 100%') +
          COL(BT('zoomPagina', 'document_one_page', 'Una página'), BT('zoomVarias', 'document_multiple', 'Varias páginas'), BT('zoomAncho', 'arrow_autofit_width', 'Ancho de página'))) +
        G('Ventana', BG('nuevaVentana', 'window_new', 'Nueva\nventana', 'Abrir este documento en otra ventana') + BG('pantallaCompleta', 'full_screen_maximize', 'Pantalla\ncompleta', 'Pantalla completa (F11)'));
    }},
    ayuda: {n: 'Ayuda', r: function() {
      return G('Ayuda', BG('atajos', 'keyboard', 'Atajos de\nteclado', 'Atajos de teclado') + BG('acercaDe', 'info', 'Acerca de\nNuvia Office', 'Acerca de Nuvia Office'));
    }},
    tablaDiseno: {n: 'Diseño de tabla', ctx: 'tabla', r: function() {
      return G('Opciones de estilo de tabla', COL(CHK('nvTEnc', 'Fila de encabezado'), CHK('nvTTot', 'Fila de totales'), CHK('nvTBandas', 'Filas con bandas')) +
          COL(CHK('nvTPrimCol', 'Primera columna'), CHK('nvTUltCol', 'Última columna'), CHK('nvTColBandas', 'Columnas con bandas'))) +
        G('Estilos de tabla', galeriaTablas() + SPLIT('sombreadoCelda', 'menuSombreadoCelda', 'paint_bucket', 'Sombreado', 'nvBarraCelda')) +
        G('Bordes', COL(FILA('<select class="nv-sel" id="nvBordeEstilo" aria-label="Estilo de borde" style="width:96px"><option value="solid">────</option><option value="dashed">- - - -</option><option value="dotted">·······</option><option value="double">════</option><option value="none">Sin borde</option></select>'),
          FILA('<select class="nv-sel" id="nvBordeGrosor" aria-label="Grosor de la pluma" style="width:96px"><option value="0.5">½ pto</option><option value="1" selected>1 pto</option><option value="1.5">1½ pto</option><option value="2.25">2¼ pto</option><option value="3">3 pto</option><option value="4.5">4½ pto</option><option value="6">6 pto</option></select>'),
          FILA('<span class="nv-split"><button type="button" class="nv-b color"' + attrs('menuColorPluma', null, 'Color de la pluma') + ' data-menu="1">' + I('pen') + '<span class="nv-color-barra" id="nvBarraPluma" style="background:#000"></span></button></span>')) +
          BG('menuBordesCelda', 'border_all', 'Bordes', 'Bordes', null, true));
    }},
    tablaDisp: {n: 'Disposición de tabla', ctx: 'tabla', r: function() {
      return G('Tabla', COL(BT('menuSelTabla', 'cursor', 'Seleccionar', 'Seleccionar', null, true), BT('verCuadricula', 'grid', 'Ver cuadrícula'), BT('propTabla', 'settings', 'Propiedades'))) +
        G('Filas y columnas', BG('menuEliminarTabla', 'table_delete_row', 'Eliminar', 'Eliminar', null, true) + BG('filaArriba', 'table_insert_row', 'Insertar\narriba', 'Insertar arriba') +
          COL(BT('filaAbajo', 'table_insert_row', 'Insertar debajo'), BT('colIzq', 'table_insert_column', 'Insertar a la izquierda'), BT('colDer', 'table_insert_column', 'Insertar a la derecha'))) +
        G('Combinar', COL(BT('combinarCeldas', 'table_cells_merge', 'Combinar celdas'), BT('dividirCeldas', 'table_cells_split', 'Dividir celdas'), BT('dividirTabla', 'table_split', 'Dividir tabla'))) +
        G('Tamaño de celda', BG('menuAutoajustar', 'table_resize_column', 'Autoajustar', 'Autoajustar', null, true) +
          COL(NUM('nvCeldaAlto', 'Alto:', 'cm', 'Alto de fila'), NUM('nvCeldaAncho', 'Ancho:', 'cm', 'Ancho de columna')) +
          COL(BT('distribuirFilas', 'table_stack_below', 'Distribuir filas'), BT('distribuirCols', 'table_stack_right', 'Distribuir columnas'))) +
        G('Alineación', '<div style="display:grid;grid-template-columns:repeat(3,26px);gap:1px">' +
          [['top', 'left', 'Arriba a la izquierda'], ['top', 'center', 'Arriba al centro'], ['top', 'right', 'Arriba a la derecha'],
           ['middle', 'left', 'Centro a la izquierda'], ['middle', 'center', 'Centrar'], ['middle', 'right', 'Centro a la derecha'],
           ['bottom', 'left', 'Abajo a la izquierda'], ['bottom', 'center', 'Abajo al centro'], ['bottom', 'right', 'Abajo a la derecha']].map(function(x) {
            return '<button type="button" class="nv-b" style="min-width:26px;padding:0"' + attrs('alinCelda', x[0] + ' ' + x[1], x[2]) + '>' +
              '<span style="display:flex;flex-direction:column;justify-content:' + ({top: 'flex-start', middle: 'center', bottom: 'flex-end'})[x[0]] + ';align-items:' +
              ({left: 'flex-start', center: 'center', right: 'flex-end'})[x[1]] + ';width:16px;height:16px;gap:2px"><i style="display:block;width:10px;height:2px;background:currentColor"></i><i style="display:block;width:7px;height:2px;background:currentColor"></i></span></button>';
          }).join('') + '</div>' + COL(BT('margenesCelda', 'padding_left', 'Márgenes de celda'))) +
        G('Datos', COL(BT('ordenarTabla', 'text_sort_ascending', 'Ordenar'), BT('repetirEncabezado', 'table_freeze_row', 'Repetir filas de título'), BT('tablaATexto', 'text_column_one', 'Convertir texto')));
    }},
    imagen: {n: 'Formato de imagen', ctx: 'imagen', r: function() {
      return G('Ajustar', BG('menuCorrecciones', 'brightness_high', 'Correcciones', 'Correcciones', null, true) + BG('menuColorImg', 'color', 'Color', 'Color', null, true) +
          COL(BT('recortar', 'crop', 'Recortar'), BT('restablecerImg', 'arrow_reset', 'Restablecer imagen'))) +
        G('Estilos de imagen', galeriaImagen() + COL(BT('menuBordeImg', 'border_outside', 'Borde de imagen', 'Borde de imagen', null, true))) +
        G('Accesibilidad', BG('textoAlt', 'image_alt_text', 'Texto\nalternativo', 'Texto alternativo')) +
        G('Organizar', BG('menuPosicion', 'position_to_front', 'Posición', 'Posición', null, true) + BG('menuAjuste', 'text_wrap', 'Ajustar\ntexto', 'Ajustar texto', null, true) +
          COL(BT('menuAlinearObj', 'align_left', 'Alinear', 'Alinear', null, true), BT('menuGirar', 'arrow_rotate_clockwise', 'Girar', 'Girar', null, true))) +
        G('Tamaño', COL(NUM('nvImgAlto', 'Alto:', 'cm', 'Alto de la imagen'), NUM('nvImgAncho', 'Ancho:', 'cm', 'Ancho de la imagen'), CHK('nvImgProp', 'Bloquear relación de aspecto')));
    }}
  };
  C.TABS = TABS;
  function galeriaFormato() {
    var h = '<div class="nv-galeria" style="height:70px"><div class="nv-galeria-items">';
    [['office', 'Office'], ['office2023', 'Office 2023'], ['clasico', 'Clásico'], ['moderno', 'Moderno'], ['elegante', 'Elegante']].forEach(function(x) {
      var t = W.TEMAS[x[0]];
      h += '<button type="button" class="nv-estilo-item" style="width:66px" data-a="tema" data-v="' + x[0] + '" title="Tema ' + esc(t.n) + '"><span class="muestra" style="font-family:' +
        NV.cssFuente(t.titulos).replace(/"/g, "'") + ';font-size:13px;color:' + t.h + '">Título</span><span style="display:flex;gap:1px">' +
        t.acentos.slice(0, 4).map(function(c) { return '<i style="display:block;width:12px;height:8px;background:' + c + '"></i>'; }).join('') + '</span><span class="nombre">' + esc(t.n) + '</span></button>';
    });
    return h + '</div></div>';
  }
  var ESTILOS_TABLA = [
    {id: 'cuadricula', n: 'Tabla con cuadrícula'}, {id: 'normal', n: 'Tabla normal'}, {id: 'clara', n: 'Tabla con cuadrícula clara'},
    {id: 'enc1', n: 'Tabla con cuadrícula 4 - Énfasis 1'}, {id: 'enc2', n: 'Tabla con cuadrícula 4 - Énfasis 2'}, {id: 'lista', n: 'Tabla de lista 3'},
    {id: 'bandas', n: 'Tabla con cuadrícula 5 oscura - Énfasis 1'}, {id: 'sencilla', n: 'Tabla sencilla 1'}
  ];
  C.ESTILOS_TABLA = ESTILOS_TABLA;
  function galeriaTablas() {
    var h = '<div class="nv-galeria" style="height:70px;margin-right:6px"><div class="nv-galeria-items">';
    ESTILOS_TABLA.slice(0, 7).forEach(function(s) {
      h += '<button type="button" class="nv-estilo-item" style="width:56px;padding:3px" data-a="estiloTabla" data-v="' + s.id + '" title="' + esc(s.n) + '">' + W.miniTabla(s.id) + '</button>';
    });
    return h + '</div><div class="nv-galeria-mas"><button type="button" data-a="menuEstilosTabla" data-menu="1" title="Más estilos de tabla" aria-label="Más estilos de tabla">☰</button></div></div>';
  }
  var ESTILOS_IMG = [
    {id: 'ninguno', n: 'Sin estilo', css: ''}, {id: 'marco', n: 'Marco simple, blanco', css: 'border:6px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)'},
    {id: 'sombra', n: 'Sombra paralela', css: 'box-shadow:4px 4px 8px rgba(0,0,0,.45)'}, {id: 'redondeado', n: 'Rectángulo redondeado', css: 'border-radius:12px'},
    {id: 'ovalo', n: 'Óvalo', css: 'border-radius:50%'}, {id: 'borde', n: 'Marco negro', css: 'border:3px solid #000'},
    {id: 'suave', n: 'Bordes suaves', css: 'border-radius:6px;box-shadow:0 0 8px 2px rgba(255,255,255,.9) inset,0 1px 4px rgba(0,0,0,.25)'}
  ];
  C.ESTILOS_IMG = ESTILOS_IMG;
  function galeriaImagen() {
    var h = '<div class="nv-galeria" style="height:70px;margin-right:6px"><div class="nv-galeria-items">';
    ESTILOS_IMG.forEach(function(s) {
      h += '<button type="button" class="nv-estilo-item" style="width:52px;padding:6px;align-items:center;justify-content:center" data-a="estiloImg" data-v="' + s.id + '" title="' + esc(s.n) + '">' +
        '<span style="display:block;width:34px;height:26px;background:linear-gradient(135deg,#9ec5ef,#4a7fc1);' + s.css.replace(/6px solid/, '3px solid').replace(/12px/, '6px') + '"></span></button>';
    });
    return h + '</div></div>';
  }

  // ---------- Construcción y estado ----------
  var tabActiva = 'inicio', ctxActivo = null;
  C.construir = function() {
    var tabs = NV.$('#nvTabs'), h = '<button type="button" class="nv-tab archivo" data-tab="archivo" id="nvTabArchivo">Archivo</button>';
    Object.keys(TABS).forEach(function(k) {
      var t = TABS[k];
      h += '<button type="button" class="nv-tab' + (t.ctx ? ' contextual nv-oculto' : '') + '" data-tab="' + k + '"' + (t.ctx ? ' data-ctx="' + t.ctx + '"' : '') + ' role="tab">' + esc(t.n) + '</button>';
    });
    h += '<div class="nv-tabs-der"><button type="button" class="nv-b" data-a="comentarios" title="Comentarios">' + I('comment_multiple', 'p') + '<span>Comentarios</span></button>' +
      '<button type="button" class="nv-b" data-a="contraerCinta" id="nvContraer" title="Contraer la cinta (Ctrl+F1)" aria-label="Contraer la cinta">' + I('chevron_up', 'p') + '</button></div>';
    tabs.innerHTML = h;
    tabs.addEventListener('click', function(e) {
      var b = e.target.closest('.nv-tab'); if (!b) return;
      if (b.dataset.tab === 'archivo') { NV.backstage.abrir(); return; }
      C.mostrarTab(b.dataset.tab);
      if (NV.$('#nvCinta').classList.contains('contraida')) { NV.$('#nvCinta').classList.remove('contraida'); C._temporal = true; }
    });
    tabs.addEventListener('dblclick', function(e) { if (e.target.closest('.nv-tab:not(.archivo)')) C.contraer(); });
    var cinta = NV.$('#nvCinta');
    cinta.addEventListener('mousedown', function(e) {  // conserva la selección del documento
      if (e.target.closest('button') && !e.target.closest('input,select')) e.preventDefault();
    });
    cinta.addEventListener('click', clic);
    NV.$('#nvTabs').addEventListener('click', clic);
    cinta.addEventListener('change', cambio);
    cinta.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && e.target.matches('input[data-num], #nvFuente, #nvTamano')) { e.preventDefault(); cambio(e); foco(); }
    });
    C.mostrarTab('inicio');
  };
  C.contraer = function() { var c = NV.$('#nvCinta'); c.classList.toggle('contraida'); C._temporal = false; W.paginar(); setTimeout(posicionarTrabajo, 0); };
  C.mostrarTab = function(k) {
    tabActiva = k;
    NV.$$('#nvTabs .nv-tab').forEach(function(b) { b.classList.toggle('activa', b.dataset.tab === k); b.setAttribute('aria-selected', b.dataset.tab === k); });
    var c = NV.$('#nvCinta'); c.innerHTML = TABS[k].r(); c.setAttribute('role', 'tabpanel');
    C.refrescar(true);
    posicionarTrabajo();
  };
  function posicionarTrabajo() {
    var t = NV.$('#nvTrabajo'); if (!t) return;
    var arriba = NV.$('#nvCinta').getBoundingClientRect().bottom;
    if (NV.$('#nvCinta').classList.contains('contraida') || document.body.classList.contains('nv-lectura')) arriba = (document.body.classList.contains('nv-lectura') ? NV.$('.nv-titulo') : NV.$('#nvTabs')).getBoundingClientRect().bottom;
    t.style.top = arriba + 'px';
  }
  C.posicionar = posicionarTrabajo;
  window.addEventListener('resize', posicionarTrabajo);

  function contexto() {
    var e = ed(); if (!e || !e.selection) return null;
    var n = e.selection.getNode();
    if (n && n.nodeName === 'IMG') return 'imagen';
    if (e.dom.getParent(n, 'table')) return 'tabla';
    return null;
  }
  C.refrescar = function(forzar) {
    var e = ed(); if (!e || !e.selection) return;
    // pestañas contextuales (tabla / imagen) como en Word
    var ctx = contexto();
    if (ctx !== ctxActivo || forzar) {
      NV.$$('#nvTabs .nv-tab[data-ctx]').forEach(function(b) { b.classList.toggle('nv-oculto', b.dataset.ctx !== ctx); });
      if (ctxActivo && ctx !== ctxActivo && TABS[tabActiva] && TABS[tabActiva].ctx && TABS[tabActiva].ctx !== ctx) { ctxActivo = ctx; C.mostrarTab('inicio'); return; }
      ctxActivo = ctx;
    }
    var q = function(c) { try { return e.queryCommandState(c); } catch (x) { return false; } };
    var marcar = function(a, on) { NV.$$('#nvCinta [data-a="' + a + '"]').forEach(function(b) { b.classList.toggle('on', !!on); b.setAttribute('aria-pressed', !!on); }); };
    marcar('negrita', q('Bold')); marcar('cursiva', q('Italic')); marcar('subrayado', q('Underline') || e.formatter.match('underline'));
    marcar('tachado', q('Strikethrough') || e.formatter.match('strikethrough')); marcar('subindice', q('Subscript')); marcar('superindice', q('Superscript'));
    marcar('alinearIzq', q('JustifyLeft')); marcar('alinearCentro', q('JustifyCenter')); marcar('alinearDer', q('JustifyRight')); marcar('justificar', q('JustifyFull'));
    marcar('vinetas', q('InsertUnorderedList')); marcar('numeracion', q('InsertOrderedList')); marcar('marcas', W.est.marcas);
    marcar('brocha', !!C._brocha); marcar('dictar', !!C._dictando); marcar('leerVoz', !!C._leyendo);
    var fi = NV.$('#nvFuente'), ti = NV.$('#nvTamano');
    if (fi && document.activeElement !== fi) {
      var fn = e.queryCommandValue('FontName') || '', f = NV.fuentePorNombre(fn);
      fi.value = f ? f.n : (fn.split(',')[0].replace(/["']/g, '') || W.tema().cuerpo);
    }
    if (ti && document.activeElement !== ti) ti.value = String(tamanoActual());
    NV.$$('#nvCinta .nv-estilo-item[data-a="estilo"]').forEach(function(b) { b.classList.toggle('on', estiloActual() === b.dataset.v); });
    // Disposición: sangrías y espaciado del párrafo actual
    var blq = e.dom.getParent(e.selection.getNode(), e.dom.isBlock), w = e.getWin();
    if (blq && blq !== e.getBody()) {
      var cs = w.getComputedStyle(blq);
      setNum('nvSangIzq', NV.pxACm(parseFloat(cs.marginLeft) || 0), 2); setNum('nvSangDer', NV.pxACm(parseFloat(cs.marginRight) || 0), 2);
      setNum('nvEspAntes', NV.pxAPt(parseFloat(cs.marginTop) || 0), 0); setNum('nvEspDespues', NV.pxAPt(parseFloat(cs.marginBottom) || 0), 0);
    }
    var chk = function(id, v) { var c = NV.$('#' + id); if (c) c.checked = !!v; };
    chk('nvChkRegla', W.est.regla); chk('nvChkNav', W.est.nav); chk('nvChkMarcas', W.est.marcas);
    NV.$$('[data-vista]').forEach(function(b) { b.classList.toggle('on', b.getAttribute('data-vista') === W.est.vista); });
    if (ctx === 'tabla') {
      var tb = e.dom.getParent(e.selection.getNode(), 'table'), op = W.opcionesTabla(tb);
      chk('nvTEnc', op.enc); chk('nvTTot', op.tot); chk('nvTBandas', op.bandas); chk('nvTPrimCol', op.primCol); chk('nvTUltCol', op.ultCol); chk('nvTColBandas', op.colBandas);
      var td = e.dom.getParent(e.selection.getNode(), 'td,th');
      if (td) { setNum('nvCeldaAlto', NV.pxACm(td.parentNode.offsetHeight), 2); setNum('nvCeldaAncho', NV.pxACm(td.offsetWidth), 2); }
    }
    if (ctx === 'imagen') {
      var im = e.selection.getNode();
      setNum('nvImgAlto', NV.pxACm(im.height || im.offsetHeight), 2); setNum('nvImgAncho', NV.pxACm(im.width || im.offsetWidth), 2);
      chk('nvImgProp', im.getAttribute('data-nv-libre') !== '1');
    }
    var ro = W.est.soloLectura;
    NV.$$('#nvCinta button, #nvCinta input, #nvCinta select').forEach(function(b) {
      if (!ro) { if (b.dataset.roOff) { b.disabled = false; delete b.dataset.roOff; } return; }
      var a = b.dataset.a || '';
      if (!/^(buscar|menuBuscar|copiar|vista|dlgZoom|zoom|nuevaVentana|pantallaCompleta|contarPalabras|leerVoz|atajos|acercaDe|menuSeleccionar)/.test(a) && !b.matches('[data-chk]')) {
        if (!b.disabled) { b.disabled = true; b.dataset.roOff = '1'; }
      }
    });
    var u = NV.$('#nvDeshacer'), r = NV.$('#nvRehacer');
    if (u) u.disabled = ro || !e.undoManager.hasUndo(); if (r) r.disabled = ro || !e.undoManager.hasRedo();
  };
  function setNum(id, v, dec) { var i = NV.$('#' + id); if (i && document.activeElement !== i) i.value = (Math.round(v * Math.pow(10, dec)) / Math.pow(10, dec)); }
  function tamanoActual() {
    var e = ed(), n = e.selection.getNode();
    var px = parseFloat(e.getWin().getComputedStyle(n.nodeType === 1 ? n : n.parentNode).fontSize) || 14.67;
    return Math.round(NV.pxAPt(px) * 2) / 2;
  }
  C.tamanoActual = tamanoActual;
  function estiloActual() {
    var e = ed();
    for (var i = 0; i < ESTILOS.length; i++) {
      var f = ESTILOS[i].f; if (f === 'Normal') continue;
      if (e.formatter.match(f)) return f;
    }
    return 'Normal';
  }

  // ---------- Clics ----------
  function clic(e) {
    var b = e.target.closest('[data-a]'); if (!b || b.disabled) return;
    var a = b.dataset.a, v = b.dataset.v;
    var fn = W.acciones[a];
    if (!fn) { NV.toast('Esta opción estará disponible pronto.'); return; }
    if (C._temporal && !b.dataset.menu) { NV.$('#nvCinta').classList.add('contraida'); C._temporal = false; posicionarTrabajo(); }
    fn(b, v, e);
    if (!b.dataset.menu) setTimeout(function() { C.refrescar(); }, 0);
  }
  function cambio(e) {
    var t = e.target;
    if (t.id === 'nvFuente') { W.acciones.fuente(null, t.value); return; }
    if (t.id === 'nvTamano') { W.acciones.tamano(null, t.value); return; }
    if (t.dataset.num && W.acciones.num) { W.acciones.num(t.dataset.num, parseFloat(t.value)); return; }
    if (t.dataset.chk && W.acciones.chk) { W.acciones.chk(t.dataset.chk, t.checked); return; }
    if (t.id === 'nvBordeEstilo' || t.id === 'nvBordeGrosor') return;
  }
  C.galeria = function(d) { galeriaIni = Math.max(0, Math.min(ESTILOS.length - 6, galeriaIni + d * 6)); if (tabActiva === 'inicio') C.mostrarTab('inicio'); };
  C.tabActiva = function() { return tabActiva; };

  // ---------- Búsqueda de comandos (como "Buscar" de Microsoft 365) ----------
  C.indiceComandos = function() {
    var lista = [], vistos = {};
    Object.keys(TABS).forEach(function(k) {
      var t = TABS[k], div = document.createElement('div'); div.innerHTML = t.r();
      NV.$$('[data-a]', div).forEach(function(b) {
        var tit = (b.getAttribute('title') || '').replace(/\s*\(.*\)$/, '').replace(/: más opciones$/, '');
        if (!tit || vistos[tit + b.dataset.a]) return;
        vistos[tit + b.dataset.a] = 1;
        lista.push({t: tit, a: b.dataset.a, v: b.dataset.v, tab: k, tn: t.n, menu: !!b.dataset.menu});
      });
    });
    return lista;
  };
  C.ejecutarComando = function(c) {
    if (TABS[c.tab].ctx && TABS[c.tab].ctx !== contexto()) { NV.toast('Esa opción está en la pestaña ' + TABS[c.tab].n + ' (selecciona una ' + TABS[c.tab].ctx + ').'); return; }
    C.mostrarTab(c.tab);
    var b = NV.$('#nvCinta [data-a="' + c.a + '"]' + (c.v ? '[data-v="' + c.v + '"]' : ''));
    if (b) { b.click(); if (!c.menu) foco(); }
  };

  // ---------- Atajos de teclado (los de Word; los que el navegador reserva, como Ctrl+N o Ctrl+T, no se pueden usar) ----------
  W.atajos = function(e, enEditor) {
    var k = e.key, c = e.ctrlKey || e.metaKey, s = e.shiftKey, a = e.altKey, A = W.acciones;
    var hacer = function(fn) { e.preventDefault(); e.stopPropagation(); fn(); return true; };
    if (c && !a && (k === 's' || k === 'S' || k === 'g' || k === 'G') && !s) return hacer(function() { W.guardar(true); NV.toast('Documento guardado.'); });
    if (c && !a && (k === 'p' || k === 'P') && !s) return hacer(function() { NV.backstage.abrir('imprimir'); });
    if (c && !a && (k === 'o' || k === 'O')) return hacer(function() { NV.backstage.abrir('abrir'); });
    if (c && !s && !a && (k === 'f' || k === 'F')) return hacer(function() { A.buscar(); });
    if (c && !s && !a && (k === 'h' || k === 'H')) return hacer(function() { A.reemplazar(); });
    if (k === 'F7' && !s) return hacer(function() { A.ortografia(); });
    if (k === 'F3' && s) return hacer(function() { A.mayusCiclo(); });
    if (k === 'F1' && c) return hacer(function() { C.contraer(); });
    if (k === 'F11') return hacer(function() { A.pantallaCompleta(); });
    if (a && !c && (k === 'q' || k === 'Q')) return hacer(function() { var q = NV.$('#nvBuscarCmd'); q.focus(); q.select(); });
    if (!enEditor) return false;
    if (W.est.soloLectura) return false;
    if (c && !s && !a && (k === 'k' || k === 'K')) return hacer(function() { A.vinculo(); });
    if (c && k === 'Enter') return hacer(function() { A.salto(); });
    if (c && !s && !a && (k === 'e' || k === 'E')) return hacer(function() { A.alinearCentro(); });
    if (c && !s && !a && (k === 'l' || k === 'L')) return hacer(function() { A.alinearIzq(); });
    if (c && !s && !a && (k === 'r' || k === 'R')) return hacer(function() { A.alinearDer(); });
    if (c && !s && !a && (k === 'j' || k === 'J')) return hacer(function() { A.justificar(); });
    if (c && !s && !a && (k === 'q' || k === 'Q')) return hacer(function() { A.alinearIzq(); });
    if (c && !s && !a && (k === 'd' || k === 'D')) return hacer(function() { A.dlgFuente(); });
    if (c && !s && !a && (k === 'm' || k === 'M')) return hacer(function() { A.sangriaMas(); });
    if (c && s && !a && (k === 'm' || k === 'M')) return hacer(function() { A.sangriaMenos(); });
    if (c && s && (k === '>' || k === '.')) return hacer(function() { A.agrandar(); });
    if (c && s && (k === '<' || k === ',')) return hacer(function() { A.achicar(); });
    if (c && !s && k === ']') return hacer(function() { A.tamanoPaso(1); });
    if (c && !s && k === '[') return hacer(function() { A.tamanoPaso(-1); });
    if (c && !s && k === '=') return hacer(function() { A.subindice(); });
    if (c && s && (k === '+' || k === '=')) return hacer(function() { A.superindice(); });
    if (c && k === ' ' && !a) return hacer(function() { A.borrarFormato(); });
    if (c && !s && !a && k === '1') return hacer(function() { A.interlineado(null, '1'); });
    if (c && !s && !a && k === '2') return hacer(function() { A.interlineado(null, '2'); });
    if (c && !s && !a && k === '5') return hacer(function() { A.interlineado(null, '1.5'); });
    if (c && a && /^[1-3]$/.test(k)) return hacer(function() { A.estilo(null, 'Heading' + k); });
    if (c && s && (k === 'n' || k === 'N')) return hacer(function() { A.estilo(null, 'Normal'); });
    if (c && s && (k === 'l' || k === 'L')) return hacer(function() { A.vinetas(); });
    if (c && s && (k === 'c' || k === 'C')) return hacer(function() { A.brochaCopiar(); });
    if (c && s && (k === 'v' || k === 'V')) return hacer(function() { A.brochaPegar(); });
    if (c && s && (k === 'f' || k === 'F')) return hacer(function() { var i = NV.$('#nvFuente'); C.mostrarTab('inicio'); NV.$('#nvFuente').focus(); NV.$('#nvFuente').select(); });
    if (c && s && (k === 'p' || k === 'P')) return hacer(function() { C.mostrarTab('inicio'); NV.$('#nvTamano').focus(); NV.$('#nvTamano').select(); });
    if (c && (k === '*' || (s && k === '8'))) return hacer(function() { W.marcasFormato(); });
    if (c && a && (k === 'f' || k === 'F')) return hacer(function() { A.notaPie(); });
    if (c && a && (k === 'd' || k === 'D')) return hacer(function() { A.notaFinal(); });
    if (c && a && k === ' ') return hacer(function() { A.leerVoz(); });
    if (e.key === 'Escape' && C._brocha) return hacer(function() { C._brocha = null; C.refrescar(); });
    return false;
  };
  document.addEventListener('keydown', function(e) { if (NV.vistaActual === 'word' && !e.target.closest('.nv-dlg,.nv-menu')) W.atajos(e, false); });
})();
