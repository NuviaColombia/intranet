/* Nuvia PowerPoint: cinta de opciones, acciones y diálogos. */
(function() {
  'use strict';
  var NV = window.NV, P = NV.ppt, C = P.cinta = {}, I = NV.icono, esc = NV.esc;
  var A = C.acciones = {};

  // ---------- Botones ----------
  function at(a, v, t) { return ' data-a="' + a + '"' + (v != null ? ' data-v="' + esc(v) + '"' : '') + ' title="' + esc(t || '') + '" aria-label="' + esc(t || '') + '"'; }
  function B(a, ic, t, v) { return '<button type="button" class="nv-b"' + at(a, v, t) + '>' + (ic.charAt(0) === '<' ? ic : I(ic)) + '</button>'; }
  function BT(a, ic, txt, t, v, menu) { return '<button type="button" class="nv-b"' + at(a, v, t || txt) + (menu ? ' data-menu="1"' : '') + '>' + (ic ? I(ic, 'p') : '') + '<span>' + esc(txt) + '</span>' + (menu ? '<span class="nv-flecha">▾</span>' : '') + '</button>'; }
  function BG(a, ic, txt, t, v, menu) { return '<button type="button" class="nv-b grande"' + at(a, v, t || txt.replace(/\n/g, ' ')) + (menu ? ' data-menu="1"' : '') + '>' + I(ic, 'g') + '<span class="nv-b-txt">' + esc(txt).replace(/\n/g, '<br>') + (menu ? '<span class="nv-flecha">▾</span>' : '') + '</span></button>'; }
  function SPLIT(a, am, ic, t, colorId) {
    return '<span class="nv-split"><button type="button" class="nv-b' + (colorId ? ' color' : '') + '"' + at(a, null, t) + '>' + (ic.charAt(0) === '<' ? ic : I(ic)) + (colorId ? '<span class="nv-color-barra" id="' + colorId + '"></span>' : '') +
      '</button><button type="button" class="nv-b mas" data-menu="1"' + at(am, null, t + ': más opciones') + '><span class="nv-flecha">▾</span></button></span>';
  }
  function G(n, c, lanz) { return '<div class="nv-grupo" role="group" aria-label="' + esc(n) + '"><div class="nv-grupo-cuerpo">' + c + '</div><div class="nv-grupo-nombre">' + esc(n) + '</div>' + (lanz ? '<button type="button" class="nv-lanzador"' + at(lanz, null, n + ': más opciones') + '>' + I('arrow_down_right', 'p') + '</button>' : '') + '</div>'; }
  function COL() { return '<div class="nv-col">' + Array.prototype.join.call(arguments, '') + '</div>'; }
  function FILA() { return '<div class="nv-fila">' + Array.prototype.join.call(arguments, '') + '</div>'; }
  function NUM(id, etq, u, t, paso) { return '<label class="nv-num" title="' + esc(t) + '"><span style="width:58px">' + esc(etq) + '</span><input type="number" id="' + id + '" step="' + (paso || 0.1) + '" data-num="' + id + '"><span>' + esc(u) + '</span></label>'; }
  function BL(a, l, e, t) { return '<button type="button" class="nv-b"' + at(a, null, t) + '><span style="font:' + e + ' 15px/1 Georgia,serif;width:16px;display:inline-block;text-align:center">' + l + '</span></button>'; }

  var TRANSICIONES = [['ninguna', 'Ninguna', 'dismiss_circle'], ['cortar', 'Cortar', 'cut'], ['desvanecer', 'Desvanecer', 'drop'], ['empujar', 'Empujar', 'arrow_left'],
    ['barrido', 'Barrido', 'arrow_right'], ['dividir', 'Dividir', 'split_vertical'], ['revelar', 'Revelar', 'eye'], ['cubrir', 'Cubrir', 'square_multiple'],
    ['zoom', 'Zoom', 'zoom_in'], ['girar', 'Girar', 'arrow_rotate_clockwise']];
  var ANIMACIONES = [['ninguna', 'Ninguna', 'dismiss_circle'], ['aparecer', 'Aparecer', 'star'], ['desvanecer', 'Desvanecer', 'drop'], ['volar', 'Entrar volando', 'arrow_up'],
    ['flotar', 'Flotar hacia dentro', 'arrow_trending'], ['dividir', 'Dividir', 'split_vertical'], ['barrido', 'Barrido', 'arrow_right'], ['zoom', 'Forma (zoom)', 'zoom_in'],
    ['rebotar', 'Rebotar', 'arrow_bounce'], ['girar', 'Crecer y girar', 'arrow_rotate_clockwise'], ['pulso', 'Pulso (énfasis)', 'heart_pulse']];
  C.TRANSICIONES = TRANSICIONES; C.ANIMACIONES = ANIMACIONES;
  function galeria(lista, accion, actual, ancho) {
    return '<div class="nv-galeria" style="height:72px"><div class="nv-galeria-items">' + lista.map(function(x) {
      return '<button type="button" class="nv-estilo-item' + (actual === x[0] ? ' on' : '') + '" style="width:' + (ancho || 64) + 'px;align-items:center;justify-content:center;gap:3px" data-a="' + accion + '" data-v="' + x[0] + '" title="' + esc(x[1]) + '">' +
        I(x[2]) + '<span class="nombre" style="text-align:center">' + esc(x[1]) + '</span></button>';
    }).join('') + '</div></div>';
  }
  function galeriaTemas() {
    var h = '<div class="nv-galeria" style="height:72px"><div class="nv-galeria-items">';
    Object.keys(P.TEMAS).forEach(function(k) {
      var t = P.TEMAS[k], bg = P.fondoCss(t.fondo, {tema: t});
      h += '<button type="button" class="nv-estilo-item' + (P.pres && P.pres.temaId === k ? ' on' : '') + '" style="width:78px;padding:0;overflow:hidden" data-a="tema" data-v="' + k + '" title="Tema ' + esc(t.n) + '">' +
        '<span style="display:flex;flex-direction:column;justify-content:space-between;height:100%;background:' + bg + ';padding:6px 6px 4px"><span style="font:600 15px ' + NV.cssFuente(t.titulos).replace(/"/g, "'") + ';color:' + (t.claroSobreOscuro ? '#fff' : '#000') + '">Aa</span>' +
        '<span style="display:flex;gap:2px">' + t.c.a.slice(0, 4).map(function(c) { return '<i style="display:block;width:13px;height:6px;background:' + c + '"></i>'; }).join('') + '</span></span></button>';
    });
    return h + '</div></div>';
  }
  var TABS = {
    inicio: {n: 'Inicio', r: function() {
      return G('Portapapeles', '<span class="nv-split" style="flex-direction:column"><button type="button" class="nv-b grande" style="height:52px"' + at('pegar', null, 'Pegar (Ctrl+V)') + '>' + I('clipboard_paste', 'g') + '</button><button type="button" class="nv-b" style="height:22px;font-size:12px"' + at('pegar', null, 'Pegar') + '>Pegar</button></span>' +
          COL(BT('cortar', 'cut', 'Cortar', 'Cortar (Ctrl+X)'), BT('copiar', 'copy', 'Copiar', 'Copiar (Ctrl+C)'), BT('brocha', 'paint_brush', 'Copiar formato'))) +
        G('Diapositivas', '<span class="nv-split" style="flex-direction:column"><button type="button" class="nv-b grande" style="height:52px"' + at('nuevaDiap', null, 'Nueva diapositiva (Ctrl+M)') + '>' + I('slide_add', 'g') + '</button><button type="button" class="nv-b" style="height:22px;font-size:12px" data-menu="1"' + at('menuNueva', null, 'Diseños de diapositiva') + '>Nueva <span class="nv-flecha">▾</span></button></span>' +
          COL(BT('menuDiseno', 'slide_layout', 'Diseño', 'Diseño de la diapositiva', null, true), BT('restablecer', 'arrow_reset', 'Restablecer', 'Restablecer posiciones del diseño'), BT('duplicarDiap', 'copy', 'Duplicar', 'Duplicar diapositiva'))) +
        G('Fuente', COL(
          FILA('<span class="nv-combo"><input id="nvpFuente" style="width:126px" aria-label="Fuente"><button type="button" data-a="menuFuente" data-menu="1" aria-label="Fuentes">▾</button></span>',
               '<span class="nv-combo"><input id="nvpTamano" style="width:38px" aria-label="Tamaño de fuente"><button type="button" data-a="menuTamano" data-menu="1" aria-label="Tamaños">▾</button></span>',
               B('agrandar', 'font_increase', 'Aumentar tamaño de fuente (Ctrl+>)'), B('achicar', 'font_decrease', 'Disminuir tamaño de fuente (Ctrl+<)'), B('borrarFormato', 'text_clear_formatting', 'Borrar todo el formato')),
          FILA(BL('negrita', 'N', 'bold', 'Negrita (Ctrl+B)'), BL('cursiva', 'K', 'italic', 'Cursiva (Ctrl+I)'), '<button type="button" class="nv-b"' + at('subrayado', null, 'Subrayado (Ctrl+U)') + '><span style="font:15px/1 Georgia,serif;text-decoration:underline;width:16px;display:inline-block;text-align:center">S</span></button>',
               B('sombraTexto', '<span style="font:bold 15px Georgia;text-shadow:1px 1px 1px #888;width:16px;display:inline-block">S</span>', 'Sombra de texto'), B('tachado', 'text_strikethrough', 'Tachado'),
               '<button type="button" class="nv-b" data-menu="1"' + at('menuMayus', null, 'Cambiar mayúsculas y minúsculas') + '><span style="font-size:13px">Aa</span><span class="nv-flecha">▾</span></button>',
               SPLIT('colorFuente', 'menuColorFuente', '<span style="font:bold 15px/1 Georgia,serif;width:16px;display:inline-block;text-align:center">A</span>', 'Color de fuente', 'nvpBarraColor'))), 'dlgFuente') +
        G('Párrafo', COL(
          FILA(B('vinetas', 'text_bullet_list_ltr', 'Viñetas'), B('numeracion', 'text_number_list_ltr', 'Numeración'), B('sangriaMenos', 'text_indent_decrease_ltr', 'Disminuir nivel de lista'),
               B('sangriaMas', 'text_indent_increase_ltr', 'Aumentar nivel de lista'), '<button type="button" class="nv-b" data-menu="1"' + at('menuInterlineado', null, 'Interlineado') + '>' + I('text_line_spacing') + '<span class="nv-flecha">▾</span></button>',
               '<button type="button" class="nv-b" data-menu="1"' + at('menuColumnasTxt', null, 'Columnas') + '>' + I('column_triple') + '<span class="nv-flecha">▾</span></button>'),
          FILA(B('alinear', 'text_align_left', 'Alinear a la izquierda (Ctrl+L)', 'left'), B('alinear', 'text_align_center', 'Centrar (Ctrl+E)', 'center'), B('alinear', 'text_align_right', 'Alinear a la derecha (Ctrl+R)', 'right'),
               B('alinear', 'text_align_justify', 'Justificar (Ctrl+J)', 'justify'), '<button type="button" class="nv-b" data-menu="1"' + at('menuAlinearTexto', null, 'Alinear texto (arriba, en medio, abajo)') + '>' + I('text_align_center_rotate_90') + '<span class="nv-flecha">▾</span></button>'))) +
        G('Dibujo', '<span style="display:flex;flex-direction:column;gap:2px">' + BT('menuFormas', 'shapes', 'Formas', 'Formas', null, true) + BT('menuOrganizar', 'position_forward', 'Organizar', 'Organizar', null, true) + BT('menuEstilosRapidos', 'paint_brush', 'Estilos rápidos', 'Estilos rápidos', null, true) + '</span>' +
          COL(SPLIT('relleno', 'menuRelleno', 'paint_bucket', 'Relleno de forma', 'nvpBarraRelleno'), SPLIT('contorno', 'menuContorno', 'pen', 'Contorno de forma', 'nvpBarraContorno'), BT('menuEfectos', 'sparkle', 'Efectos', 'Efectos de forma', null, true))) +
        G('Edición', COL(BT('buscar', 'search', 'Buscar', 'Buscar (Ctrl+F)'), BT('reemplazar', 'arrow_swap', 'Reemplazar', 'Reemplazar (Ctrl+H)'), BT('seleccionarTodo', 'select_all_on', 'Seleccionar todo', 'Seleccionar todo (Ctrl+A)')));
    }},
    insertar: {n: 'Insertar', r: function() {
      return G('Diapositivas', BG('nuevaDiap', 'slide_add', 'Nueva\ndiapositiva', 'Nueva diapositiva (Ctrl+M)') ) +
        G('Tablas', BG('menuTabla', 'table', 'Tabla', 'Tabla', null, true)) +
        G('Imágenes', BG('menuImagenes', 'image', 'Imágenes', 'Imágenes', null, true)) +
        G('Ilustraciones', BG('menuFormas', 'shapes', 'Formas', 'Formas', null, true) + BG('menuIconos', 'emoji', 'Iconos', 'Iconos', null, true) + BG('grafico', 'data_bar_vertical', 'Gráfico', 'Gráfico')) +
        G('Vínculos', BG('vinculo', 'link', 'Vínculo', 'Vínculo (Ctrl+K)')) +
        G('Comentarios', BG('comentario', 'comment_add', 'Comentario', 'Comentario')) +
        G('Texto', BG('cuadroTexto', 'textbox', 'Cuadro\nde texto', 'Cuadro de texto') + COL(BT('encabezadoPie', 'document_footer', 'Encabezado y pie de página'), BT('menuWordart', 'text_effects', 'WordArt', 'WordArt', null, true),
          BT('fechaHora', 'calendar_ltr', 'Fecha y hora')) + COL(BT('numeroDiap', 'number_symbol', 'Número de diapositiva'))) +
        G('Símbolos', COL(BT('menuSimbolo', 'symbols', 'Símbolo', 'Símbolo', null, true)));
    }},
    diseno: {n: 'Diseño', r: function() {
      return G('Temas', galeriaTemas()) +
        G('Variantes', '<div class="nv-galeria" style="height:72px"><div class="nv-galeria-items">' + P.VARIANTES.map(function(v, i) {
          return '<button type="button" class="nv-estilo-item" style="width:56px;align-items:center;justify-content:center" data-a="variante" data-v="' + i + '" title="Variante ' + (i + 1) + '"><span style="display:grid;grid-template-columns:repeat(3,12px);gap:2px">' +
            v.map(function(c) { return '<i style="display:block;width:12px;height:12px;background:' + c + '"></i>'; }).join('') + '</span></button>';
        }).join('') + '</div></div>') +
        G('Personalizar', BG('menuTamanoDiap', 'slide_size', 'Tamaño de\ndiapositiva', 'Tamaño de diapositiva', null, true) + BG('formatoFondo', 'paint_bucket', 'Formato\ndel fondo', 'Formato del fondo'));
    }},
    transiciones: {n: 'Transiciones', r: function() {
      var d = P.diap() || {}, t = d.transicion || {};
      return G('Vista previa', BG('previaTransicion', 'play', 'Vista\nprevia', 'Vista previa de la transición')) +
        G('Transición a esta diapositiva', galeria(TRANSICIONES, 'transicion', t.tipo || 'ninguna') + BG('menuOpcTransicion', 'options', 'Opciones\nde efectos', 'Opciones de efectos', null, true)) +
        G('Intervalos', COL(NUM('nvpTDur', 'Duración:', 's', 'Duración de la transición', 0.25), BT('aplicarTodas', 'checkmark', 'Aplicar a todas')) +
          COL('<label class="nv-chk" style="font-size:12.5px;margin:2px 0"><input type="checkbox" id="nvpAvClic" data-chk="nvpAvClic"> Al hacer clic con el mouse</label>',
              '<label class="nv-chk" style="font-size:12.5px;margin:2px 0"><input type="checkbox" id="nvpAvSeg" data-chk="nvpAvSeg"> Después de: <input type="number" id="nvpAvSegV" data-num="nvpAvSegV" step="1" min="0" style="width:52px;height:22px;margin-left:4px"> s</label>'));
    }},
    animaciones: {n: 'Animaciones', r: function() {
      var s = P.seleccionados()[0], an = s && s.anim || {};
      return G('Vista previa', BG('previaAnim', 'play', 'Vista\nprevia', 'Vista previa de las animaciones')) +
        G('Animación', galeria(ANIMACIONES, 'animacion', an.tipo || 'ninguna', 60) + BG('menuOpcAnim', 'options', 'Opciones\nde efectos', 'Opciones de efectos', null, true)) +
        G('Animación avanzada', BG('panelAnim', 'list', 'Panel de\nanimación', 'Panel de animación')) +
        G('Intervalos', COL('<label class="nv-num"><span style="width:58px">Inicio:</span><select class="nv-sel" id="nvpAInicio" style="width:150px"><option value="clic">Al hacer clic</option><option value="con">Con la anterior</option><option value="despues">Después de la anterior</option></select></label>',
          NUM('nvpADur', 'Duración:', 's', 'Duración', 0.25), NUM('nvpARet', 'Retraso:', 's', 'Retraso', 0.25)) +
          COL(BT('animAntes', 'arrow_up', 'Mover antes'), BT('animDespues', 'arrow_down', 'Mover después')));
    }},
    presentacion: {n: 'Presentación con diapositivas', r: function() {
      return G('Iniciar presentación con diapositivas', BG('desdePrincipio', 'slide_play', 'Desde el\nprincipio', 'Desde el principio (F5)') + BG('desdeActual', 'play', 'Desde la\ndiapositiva actual', 'Desde la diapositiva actual (Mayús+F5)')) +
        G('Configurar', BG('ocultarDiap', 'eye_off', 'Ocultar\ndiapositiva', 'Ocultar diapositiva') + COL('<label class="nv-chk" style="font-size:12.5px"><input type="checkbox" id="nvpModerador" data-chk="nvpModerador"> Usar vista del moderador</label>')) +
        G('Monitores', COL('<span style="font-size:12px;color:#605e5c;max-width:220px;display:block;line-height:1.35">Durante la presentación: flechas o clic para avanzar, B pantalla negra, W pantalla blanca, P vista del moderador, Esc para salir.</span>'));
    }},
    revisar: {n: 'Revisar', r: function() {
      return G('Revisión', BG('ortografia', 'text_proofing_tools', 'Ortografía', 'Ortografía (F7)')) + G('Idioma', BG('menuIdioma', 'local_language', 'Idioma', 'Idioma', null, true)) +
        G('Comentarios', BG('comentario', 'comment_add', 'Nuevo\ncomentario', 'Nuevo comentario'));
    }},
    vista: {n: 'Vista', r: function() {
      return G('Vistas de presentación', BG('vista', 'slide_text', 'Normal', 'Normal', 'normal') + BG('vista', 'grid', 'Clasificador de\ndiapositivas', 'Clasificador de diapositivas', 'clasificador') + BG('vista', 'book_open', 'Vista de\nlectura', 'Vista de lectura', 'lectura')) +
        G('Mostrar', COL('<label class="nv-chk" style="font-size:12.5px;margin:2px 0"><input type="checkbox" id="nvpChkCuad" data-chk="nvpChkCuad"> Cuadrícula</label>',
          '<label class="nv-chk" style="font-size:12.5px;margin:2px 0"><input type="checkbox" id="nvpChkGuias" data-chk="nvpChkGuias"> Guías inteligentes</label>',
          '<label class="nv-chk" style="font-size:12.5px;margin:2px 0"><input type="checkbox" id="nvpChkNotas" data-chk="nvpChkNotas"> Notas</label>')) +
        G('Zoom', BG('dlgZoom', 'zoom_in', 'Zoom', 'Zoom') + BG('ajustar', 'arrow_maximize', 'Ajustar a\nla ventana', 'Ajustar a la ventana'));
    }},
    ayuda: {n: 'Ayuda', r: function() { return G('Ayuda', BG('atajos', 'keyboard', 'Atajos de\nteclado', 'Atajos de teclado')); }},
    forma: {n: 'Formato de forma', ctx: 'forma', r: function() {
      return G('Insertar formas', BT('menuFormas', 'shapes', 'Formas', 'Formas', null, true)) +
        G('Estilos de forma', estilosRapidos() + COL(SPLIT('relleno', 'menuRelleno', 'paint_bucket', 'Relleno de forma', 'nvpBarraRelleno2'), SPLIT('contorno', 'menuContorno', 'pen', 'Contorno de forma', 'nvpBarraContorno2'), BT('menuEfectos', 'sparkle', 'Efectos de forma', null, null, true))) +
        G('Organizar', COL(BT('alFrente', 'position_to_front', 'Traer al frente'), BT('alFondo', 'position_to_back', 'Enviar al fondo'), BT('menuAlinear', 'align_left', 'Alinear', 'Alinear', null, true)) + COL(BT('menuGirar', 'arrow_rotate_clockwise', 'Girar', 'Girar', null, true), BT('menuCambiarForma', 'shapes', 'Cambiar forma', 'Cambiar forma', null, true))) +
        G('Tamaño', COL(NUM('nvpAlto', 'Alto:', 'cm', 'Alto'), NUM('nvpAncho', 'Ancho:', 'cm', 'Ancho')));
    }},
    imagen: {n: 'Formato de imagen', ctx: 'imagen', r: function() {
      return G('Ajustar', BG('menuCorrecciones', 'brightness_high', 'Correcciones', 'Correcciones', null, true) + BG('menuColorImg', 'color', 'Color', 'Color', null, true) + COL(BT('cambiarImagen', 'image_edit', 'Cambiar imagen'), BT('restablecerImg', 'arrow_reset', 'Restablecer imagen'))) +
        G('Estilos de imagen', estilosImagen() + COL(BT('menuBordeImg', 'border_outside', 'Borde de imagen', 'Borde de imagen', null, true))) +
        G('Accesibilidad', BG('textoAlt', 'image_alt_text', 'Texto\nalternativo', 'Texto alternativo')) +
        G('Organizar', COL(BT('alFrente', 'position_to_front', 'Traer al frente'), BT('alFondo', 'position_to_back', 'Enviar al fondo'), BT('menuAlinear', 'align_left', 'Alinear', 'Alinear', null, true)) + COL(BT('menuGirar', 'arrow_rotate_clockwise', 'Girar', 'Girar', null, true), BT('menuAjusteImg', 'crop', 'Ajuste', 'Ajuste de la imagen', null, true))) +
        G('Tamaño', COL(NUM('nvpAlto', 'Alto:', 'cm', 'Alto'), NUM('nvpAncho', 'Ancho:', 'cm', 'Ancho')));
    }},
    tabla: {n: 'Diseño de tabla', ctx: 'tabla', r: function() {
      return G('Opciones de estilo', COL('<label class="nv-chk" style="font-size:12.5px;margin:2px 0"><input type="checkbox" id="nvpTEnc" data-chk="nvpTEnc"> Fila de encabezado</label>', '<label class="nv-chk" style="font-size:12.5px;margin:2px 0"><input type="checkbox" id="nvpTBan" data-chk="nvpTBan"> Filas con bandas</label>')) +
        G('Estilos de tabla', '<div class="nv-galeria" style="height:72px"><div class="nv-galeria-items">' + ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'o2'].map(function(c) {
          var col = P.color(P.pres, c);
          return '<button type="button" class="nv-estilo-item" style="width:52px;align-items:center;justify-content:center" data-a="colorTabla" data-v="' + c + '" title="Énfasis"><span style="display:grid;grid-template-columns:repeat(3,10px);gap:1px">' +
            [0, 1, 2].map(function() { return '<i style="display:block;height:6px;background:' + col + '"></i>'; }).join('') + [0, 1, 2, 3, 4, 5].map(function(i) { return '<i style="display:block;height:6px;background:' + P.mezclar(col, i < 3 ? 0.8 : 0.9) + '"></i>'; }).join('') + '</span></button>';
        }).join('') + '</div></div>' + SPLIT('sombreadoCelda', 'menuSombreadoCelda', 'paint_bucket', 'Sombreado de celda', 'nvpBarraCelda')) +
        G('Filas y columnas', COL(BT('filaArriba', 'table_insert_row', 'Insertar arriba'), BT('filaAbajo', 'table_insert_row', 'Insertar debajo'), BT('eliminarFila', 'table_delete_row', 'Eliminar fila')) +
          COL(BT('colIzq', 'table_insert_column', 'Insertar a la izquierda'), BT('colDer', 'table_insert_column', 'Insertar a la derecha'), BT('eliminarCol', 'table_delete_column', 'Eliminar columna'))) +
        G('Alineación', COL(BT('alinCelda', 'text_align_left', 'Izquierda', null, 'left'), BT('alinCelda', 'text_align_center', 'Centro', null, 'center'), BT('alinCelda', 'text_align_right', 'Derecha', null, 'right')));
    }},
    grafico: {n: 'Diseño de gráfico', ctx: 'grafico', r: function() {
      return G('Datos', BG('editarGrafico', 'table_edit', 'Editar\ndatos', 'Editar datos del gráfico')) +
        G('Tipo', BG('menuTipoGrafico', 'data_bar_vertical', 'Cambiar tipo\nde gráfico', 'Cambiar tipo de gráfico', null, true));
    }}
  };
  C.TABS = TABS;
  var ESTILOS_FORMA = [['a1', 'a1', '#FFFFFF'], ['a2', 'a2', '#FFFFFF'], ['a3', 'a3', '#FFFFFF'], ['a4', 'a4', '#000000'], ['a5', 'a5', '#FFFFFF'], ['a6', 'a6', '#FFFFFF'],
    ['none', 'a1', 'a1'], ['c2', 'o2', 'o2'], ['o2', 'o2', '#FFFFFF']];
  function estilosRapidos() {
    return '<div class="nv-galeria" style="height:72px;margin-right:6px"><div class="nv-galeria-items">' + ESTILOS_FORMA.map(function(s, i) {
      var r = s[0] === 'none' ? '#fff' : P.color(P.pres, s[0]), b = P.color(P.pres, s[1]), t = P.color(P.pres, s[2]);
      return '<button type="button" class="nv-estilo-item" style="width:46px;align-items:center;justify-content:center" data-a="estiloForma" data-v="' + i + '" title="Estilo de forma"><span style="display:grid;place-items:center;width:34px;height:26px;border-radius:3px;background:' + r + ';border:2px solid ' + b + ';color:' + t + ';font-weight:bold;font-size:12px">Abc</span></button>';
    }).join('') + '</div></div>';
  }
  C.ESTILOS_FORMA = ESTILOS_FORMA;
  var ESTILOS_IMG = [['ninguno', 'Sin estilo', {}], ['marco', 'Marco blanco', {borde: '#FFFFFF', grosor: 8, sombra: true}], ['sombra', 'Sombra', {sombra: true}], ['redondeado', 'Redondeado', {radio: '16px'}],
    ['ovalo', 'Óvalo', {radio: '50%'}], ['negro', 'Marco negro', {borde: '#000000', grosor: 4}]];
  C.ESTILOS_IMG = ESTILOS_IMG;
  function estilosImagen() {
    return '<div class="nv-galeria" style="height:72px;margin-right:6px"><div class="nv-galeria-items">' + ESTILOS_IMG.map(function(s) {
      var x = s[2];
      return '<button type="button" class="nv-estilo-item" style="width:52px;align-items:center;justify-content:center" data-a="estiloImg" data-v="' + s[0] + '" title="' + s[1] + '"><span style="display:block;width:34px;height:26px;background:linear-gradient(135deg,#9ec5ef,#4a7fc1);' +
        (x.borde ? 'border:2px solid ' + x.borde + ';' : '') + (x.sombra ? 'box-shadow:2px 2px 4px rgba(0,0,0,.4);' : '') + (x.radio ? 'border-radius:' + (x.radio === '50%' ? '50%' : '6px') + ';' : '') + '"></span></button>';
    }).join('') + '</div></div>';
  }

  // ---------- Construcción y estado ----------
  var tabActiva = 'inicio', ctxActivo = null;
  C.construir = function() {
    var tabs = NV.$('#nvpTabs'), h = '<button type="button" class="nv-tab archivo" data-tab="archivo">Archivo</button>';
    Object.keys(TABS).forEach(function(k) { var t = TABS[k]; h += '<button type="button" class="nv-tab' + (t.ctx ? ' contextual nv-oculto' : '') + '" data-tab="' + k + '"' + (t.ctx ? ' data-ctx="' + t.ctx + '"' : '') + ' role="tab">' + esc(t.n) + '</button>'; });
    h += '<div class="nv-tabs-der"><button type="button" class="nv-b" data-a="desdeActual" title="Presentar desde la diapositiva actual">' + I('slide_play', 'p') + '<span>Presentar</span></button>' +
      '<button type="button" class="nv-b" id="nvpContraer" title="Contraer la cinta (Ctrl+F1)" aria-label="Contraer la cinta">' + I('chevron_up', 'p') + '</button></div>';
    tabs.innerHTML = h;
    tabs.addEventListener('click', function(e) {
      if (e.target.closest('#nvpContraer')) { NV.$('#nvpCinta').classList.toggle('contraida'); P.posicionar(); P.ajustarZoom(); return; }
      var b = e.target.closest('.nv-tab'); if (b) { if (b.dataset.tab === 'archivo') { NV.backstage.abrir(); return; } C.mostrarTab(b.dataset.tab); return; }
      clic(e);
    });
    var cinta = NV.$('#nvpCinta');
    cinta.addEventListener('mousedown', function(e) { if (e.target.closest('button') && !e.target.closest('input,select')) e.preventDefault(); });
    cinta.addEventListener('click', clic);
    cinta.addEventListener('change', cambio);
    cinta.addEventListener('keydown', function(e) { if (e.key === 'Enter' && e.target.matches('input[data-num],#nvpFuente,#nvpTamano')) { e.preventDefault(); cambio(e); } });
    // buscar comandos
    var q = NV.$('#nvpBuscarCmd'), res = NV.$('#nvpBuscarRes'), vis = [];
    q.addEventListener('input', function() {
      var t = q.value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      if (!t) { res.classList.add('nv-oculto'); return; }
      vis = indice().filter(function(c) { return c.t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').indexOf(t) >= 0; }).slice(0, 12);
      res.innerHTML = vis.length ? vis.map(function(c, i) { return '<button type="button" class="nv-menu-item" data-i="' + i + '"><span class="txt">' + esc(c.t) + '</span><span class="atajo">' + esc(c.tn) + '</span></button>'; }).join('') : '<div style="padding:10px 12px;font-size:13px;color:#605e5c">Sin resultados</div>';
      res.classList.remove('nv-oculto');
    });
    q.addEventListener('keydown', function(e) { if (e.key === 'Enter' && vis[0]) { e.preventDefault(); ejecutar(vis[0]); q.value = ''; res.classList.add('nv-oculto'); } if (e.key === 'Escape') { q.value = ''; res.classList.add('nv-oculto'); } });
    res.addEventListener('mousedown', function(e) { e.preventDefault(); });
    res.addEventListener('click', function(e) { var b = e.target.closest('[data-i]'); if (b) { ejecutar(vis[+b.dataset.i]); q.value = ''; res.classList.add('nv-oculto'); } });
    q.addEventListener('blur', function() { setTimeout(function() { res.classList.add('nv-oculto'); }, 150); });
  };
  var idx = null;
  function indice() {
    if (idx) return idx; idx = [];
    Object.keys(TABS).forEach(function(k) { if (TABS[k].ctx) return; var d = document.createElement('div'); d.innerHTML = TABS[k].r();
      NV.$$('[data-a]', d).forEach(function(b) { var t = (b.getAttribute('title') || '').replace(/\s*\(.*\)$/, '').replace(/: más opciones$/, ''); if (t && !idx.some(function(x) { return x.t === t; })) idx.push({t: t, a: b.dataset.a, v: b.dataset.v, tab: k, tn: TABS[k].n}); }); });
    return idx;
  }
  function ejecutar(c) { C.mostrarTab(c.tab); var b = NV.$('#nvpCinta [data-a="' + c.a + '"]' + (c.v ? '[data-v="' + c.v + '"]' : '')); if (b) b.click(); }
  C.mostrarTab = function(k) {
    tabActiva = k;
    NV.$$('#nvpTabs .nv-tab').forEach(function(b) { b.classList.toggle('activa', b.dataset.tab === k); });
    NV.$('#nvpCinta').innerHTML = TABS[k].r();
    C.refrescar(true); P.posicionar();
  };
  function contexto() {
    var s = P.seleccionados(); if (s.length !== 1) return s.length > 1 ? 'forma' : null;
    var e = s[0]; return e.tipo === 'imagen' ? 'imagen' : e.tipo === 'tabla' ? 'tabla' : e.tipo === 'grafico' ? 'grafico' : 'forma';
  }
  C.refrescar = function(forzar) {
    if (!P.pres) return;
    var ctx = contexto();
    if (ctx !== ctxActivo || forzar) {
      NV.$$('#nvpTabs .nv-tab[data-ctx]').forEach(function(b) { b.classList.toggle('nv-oculto', b.dataset.ctx !== ctx); });
      if (ctxActivo !== ctx && TABS[tabActiva] && TABS[tabActiva].ctx && TABS[tabActiva].ctx !== ctx) { ctxActivo = ctx; C.mostrarTab('inicio'); return; }
      ctxActivo = ctx;
      if (tabActiva === 'animaciones' && !forzar) { C.mostrarTab('animaciones'); return; }
    }
    var s = P.seleccionados(), e = s[0], st = e && e.estilo || {}, ed = P.editable();
    var q = function(c) { try { return document.queryCommandState(c); } catch (x) { return false; } };
    var marcar = function(a, on) { NV.$$('#nvpCinta [data-a="' + a + '"]').forEach(function(b) { b.classList.toggle('on', !!on); }); };
    marcar('negrita', ed ? q('bold') : st.negrita); marcar('cursiva', ed ? q('italic') : st.cursiva); marcar('subrayado', ed ? q('underline') : st.subrayado);
    marcar('sombraTexto', st.sombraTexto); marcar('brocha', !!C._brocha);
    NV.$$('#nvpCinta [data-a="alinear"]').forEach(function(b) { b.classList.toggle('on', (st.align || 'left') === b.dataset.v && !!e); });
    var fi = NV.$('#nvpFuente'), ti = NV.$('#nvpTamano');
    if (fi && document.activeElement !== fi) { var fn = ed ? document.queryCommandValue('fontName') : st.fuente; var f = NV.fuentePorNombre(fn); fi.value = f ? f.n : (String(fn || P.tema(P.pres).cuerpo).split(',')[0].replace(/["']/g, '')); }
    if (ti && document.activeElement !== ti) ti.value = ed ? tamSel() : (st.fs || (e ? 18 : ''));
    var col = function(id, c) { var x = NV.$('#' + id); if (x) x.style.background = c || 'transparent'; };
    col('nvpBarraColor', C._ultColor || '#C00000'); col('nvpBarraRelleno', C._ultRelleno || P.color(P.pres, 'a1')); col('nvpBarraRelleno2', C._ultRelleno || P.color(P.pres, 'a1'));
    col('nvpBarraContorno', C._ultContorno || '#000'); col('nvpBarraContorno2', C._ultContorno || '#000'); col('nvpBarraCelda', C._ultCelda || '#D9E2F3');
    var setN = function(id, v) { var i = NV.$('#' + id); if (i && document.activeElement !== i) i.value = v; };
    if (e) { setN('nvpAlto', (e.h / 72 * 2.54).toFixed(2)); setN('nvpAncho', (e.w / 72 * 2.54).toFixed(2)); }
    var d = P.diap() || {};
    if (tabActiva === 'transiciones') { var t = d.transicion || {}; setN('nvpTDur', t.dur || 0.7); var av = d.avance || {clic: true}; var c1 = NV.$('#nvpAvClic'), c2 = NV.$('#nvpAvSeg'); if (c1) c1.checked = av.clic !== false; if (c2) c2.checked = av.seg != null; setN('nvpAvSegV', av.seg != null ? av.seg : 5); }
    if (tabActiva === 'animaciones') { var an = e && e.anim || {}; var si = NV.$('#nvpAInicio'); if (si) si.value = an.inicio || 'clic'; setN('nvpADur', an.dur || 0.5); setN('nvpARet', an.retraso || 0);
      NV.$$('#nvpCinta [data-a="animacion"]').forEach(function(b) { b.classList.toggle('on', (an.tipo || 'ninguna') === b.dataset.v); b.disabled = !e; }); }
    var ch = function(id, v) { var x = NV.$('#' + id); if (x) x.checked = !!v; };
    ch('nvpChkCuad', P.est.cuadricula); ch('nvpChkGuias', P.est.guias); ch('nvpChkNotas', P.est.notas); ch('nvpModerador', P.est.moderador);
    if (ctx === 'tabla' && e) { ch('nvpTEnc', e.tabla.encabezado !== false); ch('nvpTBan', e.tabla.bandas !== false); }
    NV.$$('#nvpCinta [data-a="vista"]').forEach(function(b) { b.classList.toggle('on', b.dataset.v === P.est.vista); });
    if (P.est.soloLectura) NV.$$('#nvpCinta button, #nvpCinta input, #nvpCinta select').forEach(function(b) { if (!/^(desde|vista|dlgZoom|ajustar|atajos|copiar|buscar)/.test(b.dataset.a || '') && !b.matches('[data-chk]')) b.disabled = true; });
  };
  function tamSel() {
    var s = getSelection(); if (!s.rangeCount) return '';
    var n = s.anchorNode; if (n && n.nodeType === 3) n = n.parentNode;
    return n ? Math.round(parseFloat(getComputedStyle(n).fontSize) / (P.escala ? 1 : 1)) : '';
  }
  function clic(e) {
    var b = e.target.closest('[data-a]'); if (!b || b.disabled) return;
    var fn = A[b.dataset.a]; if (!fn) { NV.toast('Esta opción estará disponible pronto.'); return; }
    fn(b, b.dataset.v, e);
    if (!b.dataset.menu) setTimeout(function() { C.refrescar(); }, 0);
  }
  function cambio(e) {
    var t = e.target;
    if (t.id === 'nvpFuente') return A.fuente(null, t.value);
    if (t.id === 'nvpTamano') return A.tamano(null, t.value);
    if (t.id === 'nvpAInicio') return A.animProp('inicio', t.value);
    if (t.dataset.num) return A.num(t.dataset.num, parseFloat(t.value));
    if (t.dataset.chk) return A.chk(t.dataset.chk, t.checked);
  }

  // ---------- Formato de texto ----------
  function conEdicion() { var ed = P.editable(); if (ed) { ed.focus(); document.execCommand('styleWithCSS', false, true); } return ed; }
  function cambioTexto() { var ed = P.editable(), e = P.buscarEl(P.est.editando); if (ed && e) { e.html = ed.innerHTML; P.cambio(true); } }
  // Sin texto en edición: el formato se aplica a todo el cuadro (como PowerPoint) y se quitan los formatos en línea opuestos
  function aTodo(prop, valor, cssProp) {
    var s = P.seleccionados().filter(function(e) { return e.tipo === 'texto' || e.tipo === 'forma' || e.tipo === 'tabla'; });
    if (!s.length) return false;
    s.forEach(function(e) {
      e.estilo = e.estilo || {}; e.estilo[prop] = valor;
      if (cssProp && e.html) { var d = document.createElement('div'); d.innerHTML = e.html; NV.$$('[style]', d).forEach(function(x) { x.style.removeProperty(cssProp); if (!x.getAttribute('style')) x.removeAttribute('style'); });
        if (cssProp === 'font-weight') NV.$$('b,strong', d).forEach(function(x) { x.replaceWith.apply(x, x.childNodes); });
        if (cssProp === 'font-style') NV.$$('i,em', d).forEach(function(x) { x.replaceWith.apply(x, x.childNodes); });
        NV.$$('font', d).forEach(function(x) { if (cssProp === 'color') x.removeAttribute('color'); if (cssProp === 'font-family') x.removeAttribute('face'); });
        e.html = d.innerHTML; }
    });
    P.pintarEscena(); P.cambio(); return true;
  }
  function cmdTexto(c, v) { if (conEdicion()) { document.execCommand(c, false, v); cambioTexto(); return true; } return false; }
  A.negrita = function() { if (!cmdTexto('bold')) { var e = P.seleccionados()[0]; if (e) aTodo('negrita', !(e.estilo && e.estilo.negrita), 'font-weight'); } };
  A.cursiva = function() { if (!cmdTexto('italic')) { var e = P.seleccionados()[0]; if (e) aTodo('cursiva', !(e.estilo && e.estilo.cursiva), 'font-style'); } };
  A.subrayado = function() { if (!cmdTexto('underline')) { var e = P.seleccionados()[0]; if (e) aTodo('subrayado', !(e.estilo && e.estilo.subrayado), 'text-decoration'); } };
  A.tachado = function() { cmdTexto('strikeThrough'); };
  A.sombraTexto = function() { var e = P.seleccionados()[0]; if (e) aTodo('sombraTexto', !(e.estilo && e.estilo.sombraTexto)); };
  A.borrarFormato = function() { if (!cmdTexto('removeFormat')) { P.seleccionados().forEach(function(e) { if (e.html) { var d = document.createElement('div'); d.innerHTML = e.html; e.html = d.innerText.split('\n').map(function(l) { return '<p>' + esc(l) + '</p>'; }).join(''); } }); P.pintarEscena(); P.cambio(); } };
  A.fuente = function(b, n) {
    var f = NV.fuentePorNombre(n), nombre = f ? f.n : n; if (!nombre) return;
    if (P.est.editando && conEdicion()) { document.execCommand('fontName', false, f ? f.css.replace(/"/g, '') : n); cambioTexto(); return; }
    aTodo('fuente', nombre, 'font-family');
  };
  A.tamano = function(b, v) {
    var n = parseFloat(String(v).replace(',', '.')); if (!(n >= 1 && n <= 400)) return;
    var ed = P.editable();
    if (ed && !getSelection().isCollapsed) {
      ed.focus(); document.execCommand('styleWithCSS', false, false); document.execCommand('fontSize', false, '7');
      NV.$$('font[size="7"]', ed).forEach(function(x) { var s = document.createElement('span'); s.style.fontSize = n + 'px'; s.innerHTML = x.innerHTML; x.replaceWith(s); });
      cambioTexto(); return;
    }
    aTodo('fs', n, 'font-size');
  };
  var TAMS = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 88, 96];
  function tamActual() { var ed = P.editable(); if (ed) return +tamSel() || 18; var e = P.seleccionados()[0]; return e && e.estilo && e.estilo.fs || 18; }
  A.agrandar = function() { var t = tamActual(); A.tamano(null, TAMS.filter(function(x) { return x > t; })[0] || t + 8); };
  A.achicar = function() { var t = tamActual(); A.tamano(null, TAMS.filter(function(x) { return x < t; }).pop() || Math.max(1, t - 2)); };
  A.menuFuente = function(b) {
    var t = P.tema(P.pres), it = [{titulo: 'Fuentes del tema'}, {texto: t.titulos + ' (Títulos)', estilo: 'font-family:' + NV.cssFuente(t.titulos), accion: function() { A.fuente(null, t.titulos); }},
      {texto: t.cuerpo + ' (Cuerpo)', estilo: 'font-family:' + NV.cssFuente(t.cuerpo), accion: function() { A.fuente(null, t.cuerpo); }}, {sep: true}, {titulo: 'Todas las fuentes'}];
    NV.FUENTES.forEach(function(f) { it.push({texto: f.n, estilo: 'font-family:' + f.css + ';font-size:14px', accion: function() { A.fuente(null, f.n); }}); });
    NV.menu(b.closest('.nv-combo') || b, it, {ancho: 230});
  };
  A.menuTamano = function(b) { NV.menu(b.closest('.nv-combo') || b, TAMS.map(function(s) { return {texto: String(s), accion: function() { A.tamano(null, s); }}; }), {ancho: 80}); };
  var MAYUS = {oracion: function(t) { return t.toLowerCase().replace(/(^\s*|[.!?]\s+)(\p{L})/gu, function(m, a, l) { return a + l.toUpperCase(); }); },
    minus: function(t) { return t.toLowerCase(); }, mayus: function(t) { return t.toUpperCase(); }, titulo: function(t) { return t.toLowerCase().replace(/(^|\s)(\p{L})/gu, function(m, a, l) { return a + l.toUpperCase(); }); }};
  A.menuMayus = function(b) {
    var ap = function(k) { return function() {
      var ed = P.editable();
      if (ed && !getSelection().isCollapsed) { var t = getSelection().toString(); document.execCommand('insertText', false, MAYUS[k](t)); cambioTexto(); return; }
      P.seleccionados().forEach(function(e) { if (!e.html) return; var d = document.createElement('div'); d.innerHTML = e.html; var w = document.createTreeWalker(d, NodeFilter.SHOW_TEXT), n; while ((n = w.nextNode())) n.data = MAYUS[k](n.data); e.html = d.innerHTML; });
      P.pintarEscena(); P.cambio();
    }; };
    NV.menu(b, [{texto: 'Tipo oración.', accion: ap('oracion')}, {texto: 'minúsculas', accion: ap('minus')}, {texto: 'MAYÚSCULAS', accion: ap('mayus')}, {texto: 'Poner En Mayúsculas Cada Palabra', accion: ap('titulo')}]);
  };
  A.colorFuente = function() { aplicarColorTexto(C._ultColor || '#C00000'); };
  function aplicarColorTexto(c) { if (!cmdTexto('foreColor', c)) aTodo('color', c, 'color'); }
  A.menuColorFuente = function(b) { menuColores(b, function(c) { C._ultColor = c; aplicarColorTexto(c || P.tema(P.pres).c.o1); C.refrescar(); }, 'Automático'); };
  A.vinetas = function() { if (!cmdTexto('insertUnorderedList')) { listaTodo('ul'); } };
  A.numeracion = function() { if (!cmdTexto('insertOrderedList')) { listaTodo('ol'); } };
  function listaTodo(tag) {
    P.seleccionados().forEach(function(e) {
      if (e.tipo !== 'texto' && e.tipo !== 'forma') return;
      var d = document.createElement('div'); d.innerHTML = e.html || '';
      var ya = d.querySelector('ul,ol');
      if (ya && ya.nodeName.toLowerCase() === tag) { e.html = NV.$$('li', d).map(function(li) { return '<p>' + li.innerHTML + '</p>'; }).join(''); e.estilo.vinetas = false; }
      else { var lineas = d.querySelector('p,div,li') ? NV.$$('p,div,li', d).map(function(x) { return x.innerHTML; }) : [d.innerHTML]; e.html = '<' + tag + '>' + lineas.filter(Boolean).map(function(l) { return '<li>' + l + '</li>'; }).join('') + '</' + tag + '>'; e.estilo.vinetas = true; }
    });
    P.pintarEscena(); P.cambio();
  }
  A.sangriaMas = function() { cmdTexto('indent'); };
  A.sangriaMenos = function() { cmdTexto('outdent'); };
  A.alinear = function(b, v) {
    var ed = P.editable();
    if (ed) { conEdicion(); document.execCommand({left: 'justifyLeft', center: 'justifyCenter', right: 'justifyRight', justify: 'justifyFull'}[v]); cambioTexto(); return; }
    aTodo('align', v, 'text-align');
  };
  A.menuInterlineado = function(b) { NV.menu(b, ['1.0', '1.15', '1.5', '2.0', '2.5', '3.0'].map(function(v) { return {texto: v.replace('.', ','), accion: function() { aTodo('interlineado', +v); }}; })); };
  A.menuColumnasTxt = function(b) { NV.menu(b, [1, 2, 3].map(function(n) { return {texto: n === 1 ? 'Una columna' : n + ' columnas', accion: function() { aTodo('columnas', n); }}; })); };
  A.menuAlinearTexto = function(b) { NV.menu(b, [['top', 'Arriba'], ['middle', 'En el medio'], ['bottom', 'Abajo']].map(function(x) { return {texto: x[1], accion: function() { aTodo('valign', x[0]); }}; })); };
  A.dlgFuente = function() {
    var e = P.seleccionados()[0]; if (!e) { NV.toast('Selecciona un cuadro de texto.'); return; }
    var st = e.estilo || {};
    NV.dialogo({titulo: 'Fuente', ancho: 440, html: '<div class="nv-filas2"><div class="nv-campo"><label for="pfF">Fuente</label><select id="pfF">' + NV.FUENTES.map(function(f) { return '<option' + (f.n === (st.fuente || P.tema(P.pres).cuerpo) ? ' selected' : '') + '>' + f.n + '</option>'; }).join('') + '</select></div>' +
      '<div class="nv-campo"><label for="pfT">Tamaño</label><input type="number" id="pfT" value="' + (st.fs || 18) + '"></div><div class="nv-campo"><label for="pfC">Color</label><input type="color" id="pfC" value="' + (/^#/.test(P.color(P.pres, st.color) || '') ? P.color(P.pres, st.color) : '#000000') + '" style="width:100%;height:32px"></div></div>' +
      '<label class="nv-chk"><input type="checkbox" id="pfN"' + (st.negrita ? ' checked' : '') + '> Negrita</label><label class="nv-chk"><input type="checkbox" id="pfK"' + (st.cursiva ? ' checked' : '') + '> Cursiva</label><label class="nv-chk"><input type="checkbox" id="pfS"' + (st.subrayado ? ' checked' : '') + '> Subrayado</label>',
      botones: [{texto: 'Aceptar', prim: true, accion: function(d) {
        P.seleccionados().forEach(function(x) { x.estilo = Object.assign(x.estilo || {}, {fuente: d.querySelector('#pfF').value, fs: +d.querySelector('#pfT').value || 18, color: d.querySelector('#pfC').value, negrita: d.querySelector('#pfN').checked, cursiva: d.querySelector('#pfK').checked, subrayado: d.querySelector('#pfS').checked}); });
        P.pintarEscena(); P.cambio(); return true;
      }}, {texto: 'Cancelar', valor: null}]});
  };
  C.atajosTexto = function(ev) {
    var k = ev.key.toLowerCase();
    if (k === 'b') { A.negrita(); return true; } if (k === 'i') { A.cursiva(); return true; } if (k === 'u') { A.subrayado(); return true; }
    if (k === 'e') { A.alinear(null, 'center'); return true; } if (k === 'l') { A.alinear(null, 'left'); return true; } if (k === 'r') { A.alinear(null, 'right'); return true; } if (k === 'j') { A.alinear(null, 'justify'); return true; }
    if (ev.shiftKey && (k === '>' || k === '.')) { A.agrandar(); return true; } if (ev.shiftKey && (k === '<' || k === ',')) { A.achicar(); return true; }
    if (k === 'k') { A.vinculo(); return true; }
    return false;
  };

  // ---------- Colores ----------
  function menuColores(b, alElegir, automatico) {
    var t = P.tema(P.pres), base = ['#FFFFFF', '#000000', t.c.c2, t.c.o2].concat(t.c.a), cont = document.createElement('div'); cont.className = 'nv-paleta';
    var h = '<div class="nv-menu-tit" style="padding:2px 0 6px">Colores del tema</div><div class="nv-paleta-fila sep">' + base.map(function(c) { return '<button type="button" data-c="' + c + '" style="background:' + c + '" title="' + c + '"></button>'; }).join('') + '</div>';
    [0.8, 0.6, 0.4, -0.25, -0.5].forEach(function(k) { h += '<div class="nv-paleta-fila">' + base.map(function(c) { var x = k > 0 ? P.mezclar(c, k) : oscurecer(c, -k); return '<button type="button" data-c="' + x + '" style="background:' + x + '" title="' + x + '"></button>'; }).join('') + '</div>'; });
    h += '<div class="nv-menu-tit" style="padding:8px 0 6px">Colores estándar</div><div class="nv-paleta-fila">' + ['#C00000', '#FF0000', '#FFC000', '#FFFF00', '#92D050', '#00B050', '#00B0F0', '#0070C0', '#002060', '#7030A0'].map(function(c) { return '<button type="button" data-c="' + c + '" style="background:' + c + '" title="' + c + '"></button>'; }).join('') + '</div>';
    cont.innerHTML = h;
    var it = []; if (automatico) it.push({texto: automatico, accion: function() { alElegir(automatico === 'Sin relleno' || automatico === 'Sin contorno' ? 'none' : ''); }});
    it.push({nodo: cont}, {sep: true}, {texto: 'Más colores…', icono: 'color', accion: function() { var i = document.createElement('input'); i.type = 'color'; i.style.cssText = 'position:fixed;left:-99px'; document.body.appendChild(i); i.onchange = function() { alElegir(i.value.toUpperCase()); i.remove(); }; i.click(); }});
    NV.menu(b, it, {ancho: 236});
    cont.addEventListener('click', function(e) { var x = e.target.closest('[data-c]'); if (x) { NV.cerrarMenu(); alElegir(x.dataset.c); } });
  }
  C.menuColores = menuColores;
  function oscurecer(hex, k) { var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255, f = function(c) { return Math.round(c * (1 - k)); }; return '#' + [f(r), f(g), f(b)].map(function(x) { return ('0' + x.toString(16)).slice(-2); }).join('').toUpperCase(); }

  // ---------- Formas y estilos ----------
  function formas() { return P.seleccionados().filter(function(e) { return e.tipo === 'forma' || e.tipo === 'texto' || e.tipo === 'linea'; }); }
  A.relleno = function() { aplicarEstiloForma({relleno: C._ultRelleno || P.color(P.pres, 'a1')}); };
  A.menuRelleno = function(b) { menuColores(b, function(c) { C._ultRelleno = c; aplicarEstiloForma({relleno: c}); }, 'Sin relleno'); };
  A.contorno = function() { aplicarEstiloForma({borde: C._ultContorno || '#000000'}); };
  A.menuContorno = function(b) {
    var gro = [0.75, 1, 1.5, 2.25, 3, 4.5, 6].map(function(g) { return {texto: g + ' pto', accion: function() { aplicarEstiloForma({grosor: g}); }}; });
    menuColores(b, function(c) { C._ultContorno = c; aplicarEstiloForma({borde: c}); }, 'Sin contorno');
    var m = document.querySelector('.nv-menu'); if (m) { var sep = document.createElement('div'); sep.className = 'nv-menu-tit'; sep.textContent = 'Grosor'; m.appendChild(sep); gro.forEach(function(g) { var x = document.createElement('button'); x.type = 'button'; x.className = 'nv-menu-item'; x.textContent = g.texto; x.onclick = function() { NV.cerrarMenu(); g.accion(); }; m.appendChild(x); }); }
  };
  function aplicarEstiloForma(o) {
    var s = formas(); if (!s.length) { NV.toast('Selecciona una forma o un cuadro de texto.'); return; }
    s.forEach(function(e) { e.estilo = Object.assign(e.estilo || {}, o); }); P.pintarEscena(); P.cambio();
  }
  A.menuEfectos = function(b) {
    NV.menu(b, [{texto: 'Sombra', icono: 'square_shadow', accion: function() { aplicarEstiloForma({sombra: true}); }}, {texto: 'Sin sombra', accion: function() { aplicarEstiloForma({sombra: false}); }},
      {sep: true}, {texto: 'Transparencia 25%', accion: function() { aplicarEstiloForma({opacidad: 0.75}); }}, {texto: 'Transparencia 50%', accion: function() { aplicarEstiloForma({opacidad: 0.5}); }}, {texto: 'Sin transparencia', accion: function() { aplicarEstiloForma({opacidad: 1}); }}], {ancho: 220});
  };
  A.estiloForma = function(b, i) { var s = ESTILOS_FORMA[+i]; aplicarEstiloForma({relleno: s[0] === 'none' ? 'none' : P.color(P.pres, s[0]), borde: P.color(P.pres, s[1]), color: P.color(P.pres, s[2]), grosor: 1.5}); };
  A.menuEstilosRapidos = function(b) {
    var cont = document.createElement('div'); cont.innerHTML = estilosRapidos(); cont.style.padding = '6px';
    NV.menu(b, [{nodo: cont}], {ancho: 460}); cont.addEventListener('click', function(e) { var x = e.target.closest('[data-v]'); if (x) { NV.cerrarMenu(); A.estiloForma(null, x.dataset.v); } });
  };
  A.menuFormas = function(b) {
    var cont = document.createElement('div'); cont.className = 'nv-paleta'; cont.style.display = 'grid'; cont.style.gridTemplateColumns = 'repeat(6, 34px)'; cont.style.gap = '4px';
    cont.innerHTML = '<button type="button" data-f="linea" title="Línea" style="width:34px;height:34px;background:#fff;border:1px solid #e1dfdd;padding:4px">' + I('line_horizontal_1') + '</button>' +
      '<button type="button" data-f="flechaLinea" title="Flecha" style="width:34px;height:34px;background:#fff;border:1px solid #e1dfdd;padding:4px">' + I('arrow_right') + '</button>' +
      Object.keys(NV.word.FORMAS).filter(function(k) { return k !== 'linea' && k !== 'lineaFlecha'; }).map(function(k) {
        return '<button type="button" data-f="' + k + '" title="' + esc(NV.word.FORMAS[k].n) + '" style="width:34px;height:34px;background:#fff;border:1px solid #e1dfdd;padding:4px"><img alt="" style="width:24px;height:24px" src="' + NV.word.svgForma(k, '#4472C4', '#2F528F', 1, '') + '"></button>';
      }).join('');
    NV.menu(b, [{titulo: 'Formas'}, {nodo: cont}], {ancho: 250});
    cont.addEventListener('click', function(e) { var x = e.target.closest('[data-f]'); if (x) { NV.cerrarMenu(); C.insertarForma(x.dataset.f); } });
  };
  C.insertarForma = function(k) {
    if (P.est.soloLectura) return;
    P.salirEdicion();
    var tam = P.pres.tam, e;
    if (k === 'linea' || k === 'flechaLinea') e = {id: P.uid(), tipo: 'linea', x: tam.w / 2 - 120, y: tam.h / 2, w: 240, h: 0, rot: 0, estilo: {borde: P.color(P.pres, 'a1'), grosor: 2.5, flecha: k === 'flechaLinea'}};
    else e = {id: P.uid(), tipo: 'forma', forma: k, x: tam.w / 2 - 90, y: tam.h / 2 - 60, w: 180, h: k === 'rect' || k === 'redondeado' ? 100 : 120, rot: 0, html: '',
              estilo: {relleno: P.color(P.pres, 'a1'), borde: oscurecer(P.color(P.pres, 'a1'), 0.25), grosor: 1, color: '#FFFFFF', align: 'center', valign: 'middle', fs: 18}};
    P.diap().elementos.push(e); P.pintarEscena(); P.seleccionar([e.id]); P.cambio();
  };
  A.menuCambiarForma = function(b) {
    var e = P.seleccionados().filter(function(x) { return x.tipo === 'forma'; })[0]; if (!e) return;
    NV.menu(b, Object.keys(NV.word.FORMAS).filter(function(k) { return k !== 'linea' && k !== 'lineaFlecha'; }).map(function(k) { return {texto: NV.word.FORMAS[k].n, accion: function() { e.forma = k; P.pintarEscena(); P.cambio(); }}; }), {ancho: 220});
  };
  A.menuOrganizar = function(b) {
    NV.menu(b, [{titulo: 'Ordenar objetos'}, {texto: 'Traer al frente', icono: 'position_to_front', accion: A.alFrente}, {texto: 'Traer adelante', accion: function() { orden(1); }},
      {texto: 'Enviar atrás', accion: function() { orden(-1); }}, {texto: 'Enviar al fondo', icono: 'position_to_back', accion: A.alFondo},
      {sep: true}, {texto: 'Alinear', icono: 'align_left', sub: subAlinear()}, {texto: 'Girar', icono: 'arrow_rotate_clockwise', sub: subGirar()}], {ancho: 230});
  };
  function orden(d) {
    var dp = P.diap(), s = P.seleccionados(); if (!s.length) return;
    s.forEach(function(e) { var i = dp.elementos.indexOf(e), j = Math.max(0, Math.min(dp.elementos.length - 1, i + d)); dp.elementos.splice(i, 1); dp.elementos.splice(j, 0, e); });
    P.pintarEscena(); P.cambio();
  }
  A.alFrente = function() { var dp = P.diap(), s = P.seleccionados(); s.forEach(function(e) { dp.elementos.splice(dp.elementos.indexOf(e), 1); dp.elementos.push(e); }); P.pintarEscena(); P.cambio(); };
  A.alFondo = function() { var dp = P.diap(), s = P.seleccionados(); s.slice().reverse().forEach(function(e) { dp.elementos.splice(dp.elementos.indexOf(e), 1); dp.elementos.unshift(e); }); P.pintarEscena(); P.cambio(); };
  function subAlinear() {
    var al = function(t) { return function() {
      var s = P.seleccionados(); if (!s.length) return;
      var tam = P.pres.tam, ref = s.length > 1 ? P.caja(s) : {x: 0, y: 0, w: tam.w, h: tam.h};
      s.forEach(function(e) {
        if (t === 'izq') e.x = ref.x; if (t === 'centro') e.x = Math.round(ref.x + (ref.w - e.w) / 2); if (t === 'der') e.x = ref.x + ref.w - e.w;
        if (t === 'arriba') e.y = ref.y; if (t === 'medio') e.y = Math.round(ref.y + (ref.h - e.h) / 2); if (t === 'abajo') e.y = ref.y + ref.h - e.h;
      });
      if ((t === 'distH' || t === 'distV') && s.length > 2) {
        var h = t === 'distH', ord = s.slice().sort(function(a, b) { return h ? a.x - b.x : a.y - b.y; }), total = ord.reduce(function(m, e) { return m + (h ? e.w : e.h); }, 0);
        var ini = h ? ord[0].x : ord[0].y, fin = h ? ord[ord.length - 1].x + ord[ord.length - 1].w : ord[ord.length - 1].y + ord[ord.length - 1].h, hueco = (fin - ini - total) / (ord.length - 1), pos = ini;
        ord.forEach(function(e) { if (h) { e.x = Math.round(pos); pos += e.w + hueco; } else { e.y = Math.round(pos); pos += e.h + hueco; } });
      }
      P.pintarEscena(); P.cambio();
    }; };
    return [{texto: 'Alinear a la izquierda', accion: al('izq')}, {texto: 'Alinear verticalmente', accion: al('centro')}, {texto: 'Alinear a la derecha', accion: al('der')}, {sep: true},
      {texto: 'Alinear en la parte superior', accion: al('arriba')}, {texto: 'Alinear al medio', accion: al('medio')}, {texto: 'Alinear en la parte inferior', accion: al('abajo')}, {sep: true},
      {texto: 'Distribuir horizontalmente', accion: al('distH')}, {texto: 'Distribuir verticalmente', accion: al('distV')}];
  }
  function subGirar() {
    var g = function(d) { return function() { P.seleccionados().forEach(function(e) { e.rot = (((e.rot || 0) + d) % 360 + 360) % 360; }); P.pintarEscena(); P.cambio(); }; };
    return [{texto: 'Girar 90° a la derecha', accion: g(90)}, {texto: 'Girar 90° a la izquierda', accion: g(-90)}, {texto: 'Restablecer giro', accion: function() { P.seleccionados().forEach(function(e) { e.rot = 0; }); P.pintarEscena(); P.cambio(); }}];
  }
  A.menuAlinear = function(b) { NV.menu(b, subAlinear(), {ancho: 230}); };
  A.menuGirar = function(b) { NV.menu(b, subGirar(), {ancho: 220}); };

  // ---------- Portapapeles ----------
  A.copiar = function() { if (P.est.editando) { document.execCommand('copy'); return; } P.copiar(false); };
  A.cortar = function() { if (P.est.editando) { document.execCommand('cut'); cambioTexto(); return; } P.copiar(true); };
  A.pegar = function() {
    if (navigator.clipboard && navigator.clipboard.read) {
      navigator.clipboard.read().then(function(items) {
        var it = items[0]; if (!it) return P.pegar();
        var img = it.types.filter(function(t) { return /^image\//.test(t); })[0];
        if (img) return it.getType(img).then(function(bl) { return NV.imagenADataUrl(bl); }).then(function(u) { C.insertarImagenUrl(u); });
        if (it.types.indexOf('text/plain') >= 0) return it.getType('text/plain').then(function(bl) { return bl.text(); }).then(function(t) {
          if (P.pegar(t)) return; if (P.est.editando) { document.execCommand('insertText', false, t); cambioTexto(); } else C.insertarTexto(esc(t).replace(/\n/g, '<br>'));
        });
      }).catch(function() { if (!P.pegar()) NV.toast('Usa Ctrl+V para pegar.'); });
    } else if (!P.pegar()) NV.toast('Usa Ctrl+V para pegar.');
  };
  A.brocha = function() {
    var e = P.seleccionados()[0];
    if (C._brocha) { C._brocha = null; C.refrescar(); return; }
    if (!e) return;
    C._brocha = JSON.parse(JSON.stringify(e.estilo || {}));
    NV.toast('Haz clic en otro objeto para aplicarle el formato.');
    var h = function(ev) {
      if (!ev.target.closest('#nvpLienzo')) { document.removeEventListener('mouseup', h, true); return; }
      setTimeout(function() {
        var s = P.seleccionados(); if (C._brocha && s.length && s[0] !== e) { s.forEach(function(x) { x.estilo = Object.assign(x.estilo || {}, C._brocha); }); P.pintarEscena(); P.cambio(); }
        C._brocha = null; C.refrescar(); document.removeEventListener('mouseup', h, true);
      }, 0);
    };
    document.addEventListener('mouseup', h, true);
  };
  A.seleccionarTodo = function() { P.seleccionar(P.diap().elementos.map(function(e) { return e.id; })); };
  A.buscar = function() { C.dlgBuscar(false); };
  A.reemplazar = function() { C.dlgBuscar(true); };
  C.dlgBuscar = function(reemplazo) {
    NV.dialogo({titulo: reemplazo ? 'Reemplazar' : 'Buscar', ancho: 440, html: '<div class="nv-campo"><label for="pbB">Buscar</label><input type="text" id="pbB"></div>' + (reemplazo ? '<div class="nv-campo"><label for="pbR">Reemplazar con</label><input type="text" id="pbR"></div>' : '') +
      '<label class="nv-chk"><input type="checkbox" id="pbM"> Coincidir mayúsculas y minúsculas</label><p id="pbMsg" style="font-size:13px;color:#605e5c;min-height:18px"></p>',
      botones: [{texto: 'Buscar siguiente', accion: function(d) {
        var q = d.querySelector('#pbB').value; if (!q) return false;
        var mm = d.querySelector('#pbM').checked, n = P.pres.diapositivas.length, i0 = P.est.actual;
        for (var k = 1; k <= n; k++) {
          var i = (i0 + k) % n, hit = P.pres.diapositivas[i].elementos.filter(function(e) { var t = textoDe(e); return mm ? t.indexOf(q) >= 0 : t.toLowerCase().indexOf(q.toLowerCase()) >= 0; })[0];
          if (hit) { P.ir(i); P.seleccionar([hit.id]); d.querySelector('#pbMsg').textContent = 'Encontrado en la diapositiva ' + (i + 1) + '.'; return false; }
        }
        d.querySelector('#pbMsg').textContent = 'No se encontró "' + q + '".'; return false;
      }}, reemplazo ? {texto: 'Reemplazar todos', prim: true, accion: function(d) {
        var q = d.querySelector('#pbB').value, r = d.querySelector('#pbR').value, mm = d.querySelector('#pbM').checked; if (!q) return false;
        var re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), mm ? 'g' : 'gi'), n = 0;
        P.pres.diapositivas.forEach(function(s) { s.elementos.forEach(function(e) {
          var cambiar = function(html) { var dv = document.createElement('div'); dv.innerHTML = html; var w = document.createTreeWalker(dv, NodeFilter.SHOW_TEXT), t; while ((t = w.nextNode())) { var nuevo = t.data.replace(re, function() { n++; return r; }); if (nuevo !== t.data) t.data = nuevo; } return dv.innerHTML; };
          if (e.html) e.html = cambiar(e.html);
          if (e.tabla) e.tabla.filas.forEach(function(f) { f.forEach(function(c) { c.html = cambiar(c.html || ''); }); });
        }); });
        d.querySelector('#pbMsg').textContent = 'Se realizaron ' + n + ' reemplazos.'; if (n) { P.pintarTodo(); P.cambio(); } return false;
      }} : null, {texto: 'Cerrar', valor: null}].filter(Boolean)});
  };
  function textoDe(e) { var d = document.createElement('div'); d.innerHTML = (e.html || '') + (e.tabla ? e.tabla.filas.map(function(f) { return f.map(function(c) { return c.html; }).join(' '); }).join(' ') : ''); return d.textContent; }

  // ---------- Diapositivas ----------
  A.nuevaDiap = function() { P.nuevaDiapositiva(); };
  function menuDisenos(b, alElegir) {
    var tam = P.pres.tam, k = 96 / tam.w, cont = document.createElement('div'); cont.style.cssText = 'display:grid;grid-template-columns:repeat(3,112px);gap:8px;padding:8px 10px';
    P.pres.disenos.forEach(function(d) {
      var bt = document.createElement('button'); bt.type = 'button'; bt.title = d.nombre; bt.style.cssText = 'border:1px solid #e1dfdd;background:#fff;padding:4px;cursor:pointer;font-size:11px;text-align:center;border-radius:3px';
      var marco = document.createElement('div'); marco.className = 'nvp-mini-marco'; marco.style.cssText = 'width:' + tam.w * k + 'px;height:' + tam.h * k + 'px;margin:0 auto 3px;pointer-events:none';
      var dp = P.diapositivaDesdeDiseno(P.pres, d.id);
      dp.elementos.forEach(function(e) { if (e.marcador && e.tipo === 'texto') e.html = '<p style="color:#7f7f7f">' + ({titulo: 'Título', subtitulo: 'Subtítulo', cuerpo: '• Texto', texto: 'Texto'}[e.marcador] || '') + '</p>'; });
      var r = P.render(dp, {modo: 'mini'}); r.style.transformOrigin = '0 0'; r.style.transform = 'scale(' + k + ')'; marco.appendChild(r);
      bt.appendChild(marco); var n = document.createElement('div'); n.textContent = d.nombre; n.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap'; bt.appendChild(n);
      bt.onclick = function() { NV.cerrarMenu(); alElegir(d.id); };
      cont.appendChild(bt);
    });
    NV.menu(b, [{titulo: (P.pres.disenos.some(function(d) { return d.importado; }) ? 'Diseños de la plantilla' : 'Tema ' + P.tema(P.pres).n)}, {nodo: cont}], {ancho: 380});
  }
  A.menuNueva = function(b) { menuDisenos(b, function(id) { P.nuevaDiapositiva(id); }); };
  A.menuDiseno = function(b) { menuDisenos(b, function(id) { P.cambiarDiseno(P.pres, P.diap(), id); P.pintarEscena(); P.cambio(); }); };
  A.restablecer = function() { var d = P.diap(); P.cambiarDiseno(P.pres, d, d.diseno); P.pintarEscena(); P.cambio(); };
  A.duplicarDiap = function() { P.duplicarDiapositiva(); };
  A.ocultarDiap = function() { var d = P.diap(); d.oculta = !d.oculta; P.pintarMinis(); P.cambio(); NV.toast(d.oculta ? 'La diapositiva no se mostrará en la presentación.' : 'La diapositiva se mostrará en la presentación.'); };
  C.menuMinis = function(ev) {
    NV.menu({x: ev.clientX, y: ev.clientY}, [{texto: 'Nueva diapositiva', icono: 'slide_add', atajo: 'Ctrl+M', accion: function() { P.nuevaDiapositiva(); }},
      {texto: 'Duplicar diapositiva', icono: 'copy', accion: P.duplicarDiapositiva}, {texto: 'Eliminar diapositiva', icono: 'delete', accion: P.eliminarDiapositiva},
      {sep: true}, {texto: P.diap().oculta ? 'Mostrar diapositiva' : 'Ocultar diapositiva', icono: 'eye_off', accion: A.ocultarDiap},
      {texto: 'Formato del fondo…', icono: 'paint_bucket', accion: A.formatoFondo}]);
  };
  C.menuContextual = function(ev) {
    var s = P.seleccionados();
    var it = s.length ? [{texto: 'Cortar', icono: 'cut', atajo: 'Ctrl+X', accion: function() { P.copiar(true); }}, {texto: 'Copiar', icono: 'copy', atajo: 'Ctrl+C', accion: function() { P.copiar(false); }},
      {texto: 'Pegar', icono: 'clipboard_paste', atajo: 'Ctrl+V', accion: function() { P.pegar(); }}, {texto: 'Duplicar', atajo: 'Ctrl+D', accion: P.duplicar}, {sep: true},
      {texto: 'Traer al frente', icono: 'position_to_front', accion: A.alFrente}, {texto: 'Enviar al fondo', icono: 'position_to_back', accion: A.alFondo}, {sep: true},
      {texto: 'Vínculo…', icono: 'link', accion: A.vinculo}, {texto: 'Eliminar', icono: 'delete', atajo: 'Supr', accion: P.eliminarSeleccion}] :
      [{texto: 'Pegar', icono: 'clipboard_paste', atajo: 'Ctrl+V', accion: function() { P.pegar(); }}, {texto: 'Nueva diapositiva', icono: 'slide_add', accion: function() { P.nuevaDiapositiva(); }},
       {texto: 'Diseño', icono: 'slide_layout', accion: function() { A.menuDiseno({x: ev.clientX, y: ev.clientY, getBoundingClientRect: null}); }}, {texto: 'Formato del fondo…', icono: 'paint_bucket', accion: A.formatoFondo}];
    NV.menu({x: ev.clientX, y: ev.clientY}, it, {ancho: 220});
  };

  // ---------- Insertar ----------
  A.cuadroTexto = function() {
    var tam = P.pres.tam, e = {id: P.uid(), tipo: 'texto', x: tam.w / 2 - 200, y: tam.h / 2 - 30, w: 400, h: 60, rot: 0, html: '', estilo: {fs: 18, align: 'left', valign: 'top'}};
    P.diap().elementos.push(e); P.pintarEscena(); P.seleccionar([e.id]); P.cambio(); P.editar(e.id);
  };
  C.insertarTexto = function(html) {
    var tam = P.pres.tam, e = {id: P.uid(), tipo: 'texto', x: 80, y: tam.h / 2 - 40, w: tam.w - 160, h: 80, rot: 0, html: '<p>' + html + '</p>', estilo: {fs: 18}};
    P.diap().elementos.push(e); P.pintarEscena(); P.seleccionar([e.id]); P.cambio();
  };
  A.menuImagenes = function(b) {
    NV.menu(b, [{texto: 'Este dispositivo…', icono: 'image', accion: function() { C.elegirImagen(); }}, {texto: 'Desde una dirección web…', icono: 'globe', accion: function() {
      NV.preguntar('Insertar imagen', 'Dirección (URL):', 'https://').then(function(u) { if (u && /^https?:\/\//.test(u)) C.insertarImagenUrl(u); });
    }}]);
  };
  C.elegirImagen = function(reemplazar) {
    return NV.elegirArchivos('image/*', !reemplazar).then(function(fs) {
      if (!fs.length) return;
      return Promise.all(fs.map(function(f) { return NV.imagenADataUrl(f, 2400); })).then(function(urls) { urls.forEach(function(u, i) { C.insertarImagenUrl(u, reemplazar, i); }); });
    });
  };
  C.insertarImagenUrl = function(u, reemplazar, i) {
    var img = new Image();
    img.onload = function() {
      var tam = P.pres.tam, r = img.naturalWidth / img.naturalHeight;
      if (reemplazar) {
        var e = P.buscarEl(reemplazar); if (!e) return;
        e.src = P.recurso(u); e.vacia = false; e.ajuste = 'cover';
        if (!e.marcador) { e.h = Math.round(e.w / r); }
        P.pintarEscena(); P.seleccionar([e.id]); P.cambio(); return;
      }
      var w = Math.min(tam.w * 0.6, img.naturalWidth * 0.75), h = w / r; if (h > tam.h * 0.7) { h = tam.h * 0.7; w = h * r; }
      var vacio = P.diap().elementos.filter(function(x) { return x.tipo === 'imagen' && x.marcador && !x.src; })[0];
      if (vacio && !i) { vacio.src = P.recurso(u); vacio.vacia = false; vacio.ajuste = 'cover'; P.pintarEscena(); P.seleccionar([vacio.id]); P.cambio(); return; }
      var e2 = {id: P.uid(), tipo: 'imagen', src: P.recurso(u), x: Math.round((tam.w - w) / 2) + (i || 0) * 20, y: Math.round((tam.h - h) / 2) + (i || 0) * 20, w: Math.round(w), h: Math.round(h), rot: 0, estilo: {}};
      P.diap().elementos.push(e2); P.pintarEscena(); P.seleccionar([e2.id]); P.cambio();
    };
    img.onerror = function() { NV.toast('No se pudo cargar la imagen.', true); };
    img.src = u;
  };
  C.imagenEnMarcador = function(id) { C.elegirImagen(id); };
  A.cambiarImagen = function() { var e = P.seleccionados()[0]; if (e && e.tipo === 'imagen') C.elegirImagen(e.id); };
  A.menuTabla = function(b) {
    var cont = document.createElement('div'); cont.className = 'nv-cuadricula';
    var h = '<div class="nv-cuadricula-t">Insertar tabla</div><div class="nv-cuadricula-g" style="grid-template-columns:repeat(10,18px)">';
    for (var i = 0; i < 80; i++) h += '<span data-f="' + Math.floor(i / 10) + '" data-c="' + (i % 10) + '"></span>';
    cont.innerHTML = h + '</div>';
    cont.addEventListener('mouseover', function(e) { var s = e.target.closest('span[data-f]'); if (!s) return; NV.$$('span[data-f]', cont).forEach(function(x) { x.classList.toggle('on', +x.dataset.f <= +s.dataset.f && +x.dataset.c <= +s.dataset.c); }); cont.firstChild.textContent = 'Tabla de ' + (+s.dataset.c + 1) + ' x ' + (+s.dataset.f + 1); });
    cont.addEventListener('click', function(e) { var s = e.target.closest('span[data-f]'); if (s) { NV.cerrarMenu(); C.insertarTabla(+s.dataset.f + 1, +s.dataset.c + 1); } });
    NV.menu(b, [{nodo: cont}, {sep: true}, {texto: 'Insertar tabla…', icono: 'table', accion: function() {
      NV.dialogo({titulo: 'Insertar tabla', ancho: 320, html: '<div class="nv-filas2"><div class="nv-campo"><label for="ptC">Columnas</label><input type="number" id="ptC" value="5" min="1" max="20"></div><div class="nv-campo"><label for="ptF">Filas</label><input type="number" id="ptF" value="2" min="1" max="40"></div></div>',
        botones: [{texto: 'Aceptar', prim: true, accion: function(d) { C.insertarTabla(Math.max(1, Math.min(40, +d.querySelector('#ptF').value || 2)), Math.max(1, Math.min(20, +d.querySelector('#ptC').value || 5))); return true; }}, {texto: 'Cancelar', valor: null}]});
    }}], {ancho: 240});
  };
  C.insertarTabla = function(f, c) {
    var tam = P.pres.tam, w = Math.min(tam.w - 120, c * 160), filas = [];
    for (var i = 0; i < f; i++) { var fila = []; for (var j = 0; j < c; j++) fila.push({html: ''}); filas.push(fila); }
    var e = {id: P.uid(), tipo: 'tabla', x: Math.round((tam.w - w) / 2), y: 140, w: w, h: f * 40, rot: 0, tabla: {filas: filas, anchos: filas[0].map(function() { return 1; }), color: 'a1', encabezado: true, bandas: true}, estilo: {fs: 18}};
    P.diap().elementos.push(e); P.pintarEscena(); P.seleccionar([e.id]); P.cambio();
  };
  function tablaSel() { return P.seleccionados().filter(function(e) { return e.tipo === 'tabla'; })[0]; }
  function celda() { return P.est.celda || [0, 0]; }
  function editarDespues(e) { P.pintarEscena(); P.seleccionar([e.id]); P.cambio(); }
  A.filaArriba = function() { var e = tablaSel(); if (!e) return; var f = celda()[0]; e.tabla.filas.splice(f, 0, e.tabla.filas[0].map(function() { return {html: ''}; })); e.h += 40; editarDespues(e); };
  A.filaAbajo = function() { var e = tablaSel(); if (!e) return; var f = celda()[0]; e.tabla.filas.splice(f + 1, 0, e.tabla.filas[0].map(function() { return {html: ''}; })); e.h += 40; editarDespues(e); };
  A.colIzq = function() { var e = tablaSel(); if (!e) return; var c = celda()[1]; e.tabla.filas.forEach(function(f) { f.splice(c, 0, {html: ''}); }); e.tabla.anchos.splice(c, 0, 1); editarDespues(e); };
  A.colDer = function() { var e = tablaSel(); if (!e) return; var c = celda()[1]; e.tabla.filas.forEach(function(f) { f.splice(c + 1, 0, {html: ''}); }); e.tabla.anchos.splice(c + 1, 0, 1); editarDespues(e); };
  A.eliminarFila = function() { var e = tablaSel(); if (!e || e.tabla.filas.length < 2) return; e.tabla.filas.splice(celda()[0], 1); e.h = Math.max(30, e.h - 40); P.est.celda = [0, 0]; editarDespues(e); };
  A.eliminarCol = function() { var e = tablaSel(); if (!e || e.tabla.filas[0].length < 2) return; var c = celda()[1]; e.tabla.filas.forEach(function(f) { f.splice(c, 1); }); e.tabla.anchos.splice(c, 1); P.est.celda = [0, 0]; editarDespues(e); };
  A.colorTabla = function(b, c) { var e = tablaSel(); if (e) { e.tabla.color = c; editarDespues(e); } };
  A.sombreadoCelda = function() { var e = tablaSel(); if (!e) return; var cl = celda(); e.tabla.filas[cl[0]][cl[1]].fondo = C._ultCelda || '#D9E2F3'; editarDespues(e); };
  A.menuSombreadoCelda = function(b) { menuColores(b, function(c) { C._ultCelda = c; A.sombreadoCelda(); }, 'Sin color'); };
  A.alinCelda = function(b, v) { var e = tablaSel(); if (!e) return; var cl = celda(); e.tabla.filas[cl[0]][cl[1]].align = v; editarDespues(e); };
  A.menuIconos = function(b) {
    var lista = ['person', 'people', 'mail', 'call', 'home', 'building', 'calendar_ltr', 'clock', 'checkmark_circle', 'dismiss_circle', 'warning', 'info', 'star', 'heart', 'lightbulb', 'rocket',
      'trophy', 'flag', 'location', 'globe', 'money', 'cart', 'chart_multiple', 'data_pie', 'document', 'folder', 'settings', 'shield', 'lock_closed', 'key', 'dentist', 'heart_pulse', 'stethoscope', 'camera', 'phone', 'laptop', 'thumb_like', 'arrow_right', 'target'];
    var cont = document.createElement('div'); cont.className = 'nv-paleta'; cont.style.display = 'grid'; cont.style.gridTemplateColumns = 'repeat(8, 32px)'; cont.style.gap = '3px';
    cont.innerHTML = lista.filter(function(n) { return window.NV_ICONOS && NV_ICONOS[n]; }).map(function(n) { return '<button type="button" data-i="' + n + '" title="' + n.replace(/_/g, ' ') + '" style="width:32px;height:32px;border:1px solid #e1dfdd;background:#fff;color:' + P.color(P.pres, 'a1') + ';display:grid;place-items:center;padding:0">' + I(n) + '</button>'; }).join('');
    NV.menu(b, [{titulo: 'Iconos'}, {nodo: cont}], {ancho: 300});
    cont.addEventListener('click', function(e) {
      var x = e.target.closest('[data-i]'); if (!x) return; NV.cerrarMenu();
      var svg = NV_ICONOS[x.dataset.i].replace('<svg ', '<svg fill="' + P.color(P.pres, 'a1') + '" width="240" height="240" ');
      var tam = P.pres.tam, el = {id: P.uid(), tipo: 'imagen', src: P.recurso('data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)))), x: tam.w / 2 - 50, y: tam.h / 2 - 50, w: 100, h: 100, rot: 0, alt: x.dataset.i, estilo: {}, ajuste: 'contain'};
      P.diap().elementos.push(el); P.pintarEscena(); P.seleccionar([el.id]); P.cambio();
    });
  };
  A.grafico = function() { C.dlgGrafico(null); };
  A.editarGrafico = function() { var e = P.seleccionados()[0]; if (e && e.tipo === 'grafico') C.dlgGrafico(e); };
  C.dlgGrafico = function(e) {
    // usa el editor de gráficos de Nuvia Word sobre un elemento falso y luego toma los datos
    var falso = document.createElement('img');
    if (e) falso.setAttribute('data-nv-grafico', JSON.stringify(e.grafico));
    var original = NV.word.insertarGrafico;
    NV.word.insertarGrafico = function(g) {
      NV.word.insertarGrafico = original;
      if (e) { e.grafico = g; delete e._png; P.pintarEscena(); P.cambio(); return; }
      var tam = P.pres.tam, el = {id: P.uid(), tipo: 'grafico', grafico: g, x: Math.round(tam.w * 0.15), y: 130, w: Math.round(tam.w * 0.7), h: Math.round(tam.h * 0.68), rot: 0, estilo: {}};
      var vacio = P.diap().elementos.filter(function(x) { return x.marcador === 'cuerpo' && P.textoVacio(x.html); })[0];
      if (vacio) { el.x = vacio.x; el.y = vacio.y; el.w = vacio.w; el.h = vacio.h; P.diap().elementos.splice(P.diap().elementos.indexOf(vacio), 1); }
      P.diap().elementos.push(el); P.pintarEscena(); P.seleccionar([el.id]); P.cambio();
    };
    NV.word.dialogos.grafico(e ? falso : null).then(function() { NV.word.insertarGrafico = original; });
  };
  A.menuTipoGrafico = function(b) {
    var e = P.seleccionados()[0]; if (!e || e.tipo !== 'grafico') return;
    NV.menu(b, [['columnas', 'Columnas agrupadas'], ['barras', 'Barras agrupadas'], ['lineas', 'Líneas'], ['circular', 'Circular']].map(function(t) { return {texto: t[1], on: e.grafico.tipo === t[0], accion: function() { e.grafico.tipo = t[0]; delete e._png; P.pintarEscena(); P.cambio(); }}; }));
  };
  A.vinculo = function() {
    var e = P.seleccionados()[0]; if (!e) { NV.toast('Selecciona un objeto o un texto.'); return; }
    var ed = P.editable(), selTxt = ed && !getSelection().isCollapsed;
    NV.dialogo({titulo: 'Vínculo', ancho: 440, html: '<div class="nv-campo"><label for="pvU">Dirección</label><input type="text" id="pvU" value="' + esc(e.vinculo || '') + '" placeholder="https://… o #3 para ir a la diapositiva 3"></div>',
      botones: [{texto: 'Aceptar', prim: true, accion: function(d) {
        var u = d.querySelector('#pvU').value.trim(); if (u && !/^(https?:|mailto:|#\d+)/.test(u)) u = 'https://' + u;
        if (selTxt) { ed.focus(); document.execCommand('createLink', false, u); cambioTexto(); } else { e.vinculo = u || null; P.cambio(); }
        return true;
      }}, {texto: 'Quitar vínculo', accion: function() { e.vinculo = null; P.cambio(); return true; }}, {texto: 'Cancelar', valor: null}]});
  };
  A.comentario = function() { NV.alerta('Comentarios', 'Los comentarios llegan en la fase 3 de Nuvia Office.'); };
  A.menuWordart = function(b) {
    var ap = function(cls) { return function() {
      var tam = P.pres.tam, ac = P.color(P.pres, 'a1'), est = {wa1: {color: ac, sombraTexto: true, negrita: true}, wa2: {color: '#FFFFFF', negrita: true, sombraTexto: true}, wa3: {color: P.color(P.pres, 'a2'), negrita: true}}[cls];
      var e = {id: P.uid(), tipo: 'texto', x: tam.w / 2 - 300, y: tam.h / 2 - 50, w: 600, h: 100, rot: 0, html: '<p>Escriba aquí el texto</p>', estilo: Object.assign({fs: 54, align: 'center', valign: 'middle', fuente: P.tema(P.pres).titulos}, est)};
      if (cls === 'wa2') e.estilo.relleno = ac;
      P.diap().elementos.push(e); P.pintarEscena(); P.seleccionar([e.id]); P.cambio();
    }; };
    NV.menu(b, [{texto: 'Relleno de color con sombra', accion: ap('wa1')}, {texto: 'Blanco sobre color', accion: ap('wa2')}, {texto: 'Color de énfasis 2', accion: ap('wa3')}], {ancho: 240});
  };
  A.fechaHora = function() {
    NV.dialogo({titulo: 'Fecha y hora', ancho: 400, html: '<div class="nv-campo"><label for="pfh">Formatos</label><select id="pfh" size="8" style="height:auto">' + NV.fechas.FORMATOS.map(function(f, i) { return '<option value="' + i + '"' + (i ? '' : ' selected') + '>' + esc(NV.fechas.formatear(f)) + '</option>'; }).join('') + '</select></div>' +
      '<label class="nv-chk"><input type="checkbox" id="pfhA" checked> Actualizar automáticamente (siempre la fecha de hoy)</label>',
      botones: [{texto: 'Aceptar', prim: true, accion: function(d) {
        var f = NV.fechas.FORMATOS[+d.querySelector('#pfh').value], auto = d.querySelector('#pfhA').checked;
        var html = auto ? NV.fechas.span(f) : esc(NV.fechas.formatear(f));
        var ed = P.editable(); if (ed) { ed.focus(); document.execCommand('insertHTML', false, html); cambioTexto(); } else C.insertarTexto(html);
        return true;
      }}, {texto: 'Cancelar', valor: null}]});
  };
  A.numeroDiap = function() { P.pres.pie = Object.assign(P.pres.pie || {}, {numero: true}); P.pintarTodo(); P.cambio(); NV.toast('Se mostrará el número de diapositiva (Insertar › Encabezado y pie de página para más opciones).'); };
  A.encabezadoPie = function() {
    var pie = P.pres.pie || {};
    NV.dialogo({titulo: 'Encabezado y pie de página', ancho: 460, html:
      '<label class="nv-chk"><input type="checkbox" id="peF"' + (pie.fecha ? ' checked' : '') + '> Fecha y hora</label>' +
      '<div style="margin-left:26px"><label class="nv-chk"><input type="radio" name="peFT" value="auto"' + (!pie.fechaFija ? ' checked' : '') + '> Actualizar automáticamente</label>' +
      '<select id="peFF" class="nv-sel" style="margin:0 0 6px 24px">' + NV.fechas.FORMATOS.map(function(f) { return '<option value="' + esc(f) + '"' + (f === pie.formatoFecha ? ' selected' : '') + '>' + esc(NV.fechas.formatear(f)) + '</option>'; }).join('') + '</select>' +
      '<label class="nv-chk"><input type="radio" name="peFT" value="fija"' + (pie.fechaFija ? ' checked' : '') + '> Fija: <input type="text" id="peFX" value="' + esc(pie.fechaFija || '') + '" style="height:26px;border:1px solid #a19f9d;border-radius:3px;margin-left:6px"></label></div>' +
      '<label class="nv-chk"><input type="checkbox" id="peN"' + (pie.numero ? ' checked' : '') + '> Número de diapositiva</label>' +
      '<label class="nv-chk"><input type="checkbox" id="peP"' + (pie.texto ? ' checked' : '') + '> Pie de página</label><div class="nv-campo" style="margin-left:26px"><input type="text" id="pePT" value="' + esc(pie.texto || '') + '"></div>' +
      '<label class="nv-chk"><input type="checkbox" id="peT"' + (pie.noEnTitulo !== false ? ' checked' : '') + '> No mostrar en diapositiva de título</label>',
      botones: [{texto: 'Aplicar a todas', prim: true, accion: function(d) {
        var fija = d.querySelector('input[name=peFT]:checked').value === 'fija';
        P.pres.pie = {fecha: d.querySelector('#peF').checked, formatoFecha: d.querySelector('#peFF').value, fechaFija: fija ? d.querySelector('#peFX').value : '',
                      numero: d.querySelector('#peN').checked, texto: d.querySelector('#peP').checked ? d.querySelector('#pePT').value : '', noEnTitulo: d.querySelector('#peT').checked};
        P.pintarTodo(); P.cambio(); return true;
      }}, {texto: 'Cancelar', valor: null}]});
  };
  A.menuSimbolo = function(b) {
    var simb = '©®™§¶€£$¥°±×÷≠≤≥≈∞√∑πΩµ←→↑↓✓✗•…–—¿¡«»“”½¼¾★☆♦♥'.split('');
    var cont = document.createElement('div'); cont.className = 'nv-paleta nv-simbolos'; cont.style.width = '330px';
    cont.innerHTML = simb.map(function(s) { return '<button type="button" data-s="' + esc(s) + '">' + esc(s) + '</button>'; }).join('');
    NV.menu(b, [{nodo: cont}], {ancho: 350});
    cont.addEventListener('click', function(e) { var x = e.target.closest('[data-s]'); if (!x) return; NV.cerrarMenu(); var ed = P.editable(); if (ed) { ed.focus(); document.execCommand('insertText', false, x.dataset.s); cambioTexto(); } else C.insertarTexto(esc(x.dataset.s)); });
  };

  // ---------- Diseño ----------
  A.tema = function(b, k) { P.aplicarTema(P.pres, k); P.cambio(); P.pintarTodo(); C.mostrarTab('diseno'); };
  A.variante = function(b, i) { P.aplicarTema(P.pres, P.pres.temaId, P.VARIANTES[+i]); P.cambio(); P.pintarTodo(); C.mostrarTab('diseno'); };
  A.menuTamanoDiap = function(b) {
    NV.menu(b, Object.keys(P.TAMANOS).map(function(k) { return {texto: P.TAMANOS[k].n, on: P.pres.tam.id === k, accion: function() { cambiarTamano(k); }}; }));
  };
  function cambiarTamano(k) {
    var t = P.TAMANOS[k], kx = t.w / P.pres.tam.w, ky = t.h / P.pres.tam.h;
    var escalar = function(e) { e.x = Math.round(e.x * kx); e.w = Math.round(e.w * kx); e.y = Math.round(e.y * ky); e.h = Math.round(e.h * ky); delete e._png; };
    P.pres.diapositivas.forEach(function(s) { s.elementos.forEach(escalar); });
    P.pres.disenos.forEach(function(d) { (d.adornos || []).forEach(escalar); d.marcadores.forEach(escalar); });
    P.pres.tam = Object.assign({id: k}, t); P.ajustarZoom(); P.pintarTodo(); P.cambio();
  }
  A.formatoFondo = function() {
    var d = P.diap(), f = d.fondo || P.diseno(P.pres, d.diseno).fondo || P.tema(P.pres).fondo || {tipo: 'color', color: '#FFFFFF'}, img = null;
    NV.dialogo({titulo: 'Formato del fondo', ancho: 420, html:
      '<label class="nv-chk"><input type="radio" name="pfT" value="color"' + (f.tipo === 'color' ? ' checked' : '') + '> Relleno sólido <input type="color" id="pfC" value="' + (f.color || '#ffffff') + '" style="margin-left:8px;width:50px;height:26px"></label>' +
      '<label class="nv-chk"><input type="radio" name="pfT" value="degradado"' + (f.tipo === 'degradado' ? ' checked' : '') + '> Degradado <input type="color" id="pfD1" value="' + (f.desde || '#ffffff') + '" style="margin-left:8px;width:50px;height:26px"> <input type="color" id="pfD2" value="' + (f.hasta || P.color(P.pres, 'a1')) + '" style="width:50px;height:26px"></label>' +
      '<label class="nv-chk"><input type="radio" name="pfT" value="imagen"' + (f.tipo === 'imagen' ? ' checked' : '') + '> Imagen <button type="button" class="nv-btn" id="pfI" style="height:26px;margin-left:8px">Elegir…</button></label>' +
      '<label class="nv-chk"><input type="checkbox" id="pfO"' + (d.fondo && d.fondo.ocultarAdornos ? ' checked' : '') + '> Ocultar gráficos del fondo (adornos del diseño)</label>',
      alAbrir: function(dl) { dl.querySelector('#pfI').onclick = function() { NV.elegirArchivos('image/*').then(function(fs) { if (fs[0]) NV.imagenADataUrl(fs[0], 2400).then(function(u) { img = u; dl.querySelector('input[value=imagen]').checked = true; NV.toast('Imagen lista. Pulsa Aplicar.'); }); }); }; },
      botones: [{texto: 'Aplicar', prim: true, accion: function(dl) { d.fondo = leerFondo(dl, img, f); P.pintarTodo(); P.cambio(); return true; }},
        {texto: 'Aplicar a todas', accion: function(dl) { var nf = leerFondo(dl, img, f); P.pres.diapositivas.forEach(function(s) { s.fondo = JSON.parse(JSON.stringify(nf)); }); P.pintarTodo(); P.cambio(); return true; }},
        {texto: 'Restablecer', accion: function() { d.fondo = null; P.pintarTodo(); P.cambio(); return true; }}, {texto: 'Cancelar', valor: null}]});
  };
  function leerFondo(dl, img, f) {
    var t = dl.querySelector('input[name=pfT]:checked').value, o = {tipo: t, ocultarAdornos: dl.querySelector('#pfO').checked};
    if (t === 'color') o.color = dl.querySelector('#pfC').value;
    if (t === 'degradado') { o.desde = dl.querySelector('#pfD1').value; o.hasta = dl.querySelector('#pfD2').value; o.angulo = 135; }
    if (t === 'imagen') o.src = img ? P.recurso(img) : (f.src || '');
    return o;
  }

  // ---------- Transiciones y animaciones ----------
  A.transicion = function(b, t) { var d = P.diap(); d.transicion = Object.assign(d.transicion || {}, {tipo: t}); P.cambio(); P.pintarMinis(); C.mostrarTab('transiciones'); if (t !== 'ninguna') P.show.previaTransicion(); };
  A.previaTransicion = function() { P.show.previaTransicion(); };
  A.menuOpcTransicion = function(b) {
    var d = P.diap(); NV.menu(b, [['izq', 'Desde la derecha'], ['der', 'Desde la izquierda'], ['arriba', 'Desde abajo'], ['abajo', 'Desde arriba']].map(function(x) { return {texto: x[1], on: (d.transicion || {}).dir === x[0], accion: function() { d.transicion.dir = x[0]; P.cambio(); P.show.previaTransicion(); }}; }));
  };
  A.aplicarTodas = function() { var t = JSON.parse(JSON.stringify(P.diap().transicion || {tipo: 'ninguna'})); P.pres.diapositivas.forEach(function(d) { d.transicion = JSON.parse(JSON.stringify(t)); }); P.cambio(); P.pintarMinis(); NV.toast('Transición aplicada a todas las diapositivas.'); };
  A.animacion = function(b, t) {
    var s = P.seleccionados(); if (!s.length) { NV.toast('Selecciona un objeto para animarlo.'); return; }
    var max = Math.max.apply(null, [0].concat(P.diap().elementos.map(function(e) { return e.anim ? e.anim.orden || 0 : 0; })));
    s.forEach(function(e) { if (t === 'ninguna') delete e.anim; else e.anim = Object.assign({inicio: 'clic', dur: 0.5, retraso: 0, orden: (e.anim && e.anim.orden) || ++max}, e.anim || {}, {tipo: t}); });
    P.cambio(); C.mostrarTab('animaciones'); if (t !== 'ninguna') P.show.previaAnim(s);
  };
  A.animProp = function(k, v) { P.seleccionados().forEach(function(e) { if (e.anim) e.anim[k] = v; }); P.cambio(); };
  A.menuOpcAnim = function(b) {
    NV.menu(b, [['abajo', 'Desde abajo'], ['izq', 'Desde la izquierda'], ['der', 'Desde la derecha'], ['arriba', 'Desde arriba']].map(function(x) { return {texto: x[1], accion: function() { A.animProp('dir', x[0]); }}; }));
  };
  A.previaAnim = function() { P.show.previaAnim(); };
  A.animAntes = function() { moverAnim(-1); };
  A.animDespues = function() { moverAnim(1); };
  function moverAnim(d) {
    var e = P.seleccionados()[0]; if (!e || !e.anim) return;
    var lista = P.diap().elementos.filter(function(x) { return x.anim; }).sort(function(a, b) { return a.anim.orden - b.anim.orden; }), i = lista.indexOf(e), j = i + d;
    if (j < 0 || j >= lista.length) return;
    var t = lista[j].anim.orden; lista[j].anim.orden = e.anim.orden; e.anim.orden = t; P.cambio(); A.panelAnim(true);
  }
  A.panelAnim = function(sr) {
    var soloRefrescar = sr === true;
    var lista = P.diap().elementos.filter(function(x) { return x.anim; }).sort(function(a, b) { return a.anim.orden - b.anim.orden; });
    var nombre = function(e) { return (e.html ? e.html.replace(/<[^>]+>/g, ' ').trim().slice(0, 30) : '') || ({imagen: 'Imagen', forma: 'Forma', tabla: 'Tabla', grafico: 'Gráfico', linea: 'Línea', texto: 'Cuadro de texto'}[e.tipo]); };
    var html = lista.length ? '<ol style="padding-left:20px;line-height:2">' + lista.map(function(e) { return '<li><b>' + esc(ANIMACIONES.filter(function(a) { return a[0] === e.anim.tipo; })[0][1]) + '</b> — ' + esc(nombre(e)) + ' <small style="color:#605e5c">(' + {clic: 'al hacer clic', con: 'con la anterior', despues: 'después de la anterior'}[e.anim.inicio || 'clic'] + ')</small></li>'; }).join('') + '</ol>' :
      '<p class="nv-vacio">Esta diapositiva no tiene animaciones. Selecciona un objeto y elige una animación.</p>';
    if (soloRefrescar && !document.querySelector('.nv-dlg [data-panel-anim]')) return;
    var ab = document.querySelector('.nv-dlg [data-panel-anim]'); if (ab) { ab.innerHTML = html; return; }
    NV.dialogo({titulo: 'Panel de animación', ancho: 420, html: '<div data-panel-anim>' + html + '</div><p style="font-size:12.5px;color:#605e5c">Para cambiar el orden, selecciona el objeto y usa "Mover antes" / "Mover después".</p>', botones: [{texto: 'Cerrar', prim: true, valor: true}]});
  };

  // ---------- Presentación, revisar y vista ----------
  A.desdePrincipio = function() { P.show.iniciar(0); };
  A.desdeActual = function() { P.show.iniciar(P.est.actual); };
  A.ortografia = function() { NV.alerta('Ortografía', 'Las palabras con error se subrayan en rojo mientras escribes dentro de un cuadro de texto. Haz clic derecho sobre una palabra subrayada para ver las sugerencias.'); };
  C.menuIdioma = A.menuIdioma = function(b) {
    NV.menu(b, ['es-CO', 'es-ES', 'es-MX', 'en-US', 'pt-BR'].map(function(c) { return {texto: NV.word.nombreIdioma(c), on: P.pres.idioma === c, accion: function() { P.pres.idioma = c; NV.$('#nvpEstIdioma').textContent = NV.word.nombreIdioma(c); P.cambio(); }}; }));
  };
  A.vista = function(b, v) { P.vista(v); };
  C.dlgZoom = A.dlgZoom = function() {
    NV.dialogo({titulo: 'Zoom', ancho: 320, html: '<div class="nv-campo"><label for="pzP">Porcentaje</label><input type="number" id="pzP" min="10" max="400" value="' + Math.round(P.escala() * 100) + '"></div>',
      botones: [{texto: 'Aceptar', prim: true, accion: function(d) { P.zoom(+d.querySelector('#pzP').value || 100); return true; }}, {texto: 'Ajustar', accion: function() { P.zoom(0); return true; }}, {texto: 'Cancelar', valor: null}]});
  };
  A.ajustar = function() { P.zoom(0); };
  C.irA = function() {
    NV.preguntar('Ir a la diapositiva', 'Número (1 a ' + P.pres.diapositivas.length + '):', String(P.est.actual + 1)).then(function(v) { var n = parseInt(v, 10); if (n >= 1) P.ir(Math.min(P.pres.diapositivas.length, n) - 1); });
  };
  A.atajos = function() {
    var at2 = [['Ctrl+M', 'Nueva diapositiva'], ['Ctrl+D', 'Duplicar objeto'], ['Ctrl+C / X / V', 'Copiar / cortar / pegar'], ['Ctrl+Z / Ctrl+Y', 'Deshacer / rehacer'], ['Supr', 'Eliminar objeto'],
      ['Flechas (Mayús)', 'Mover objeto 1 pto (10 pto)'], ['Tab', 'Seleccionar el siguiente objeto'], ['Enter / F2', 'Editar el texto del objeto'], ['Esc', 'Salir del texto / quitar selección'],
      ['Ctrl+B / I / U', 'Negrita / cursiva / subrayado'], ['Ctrl+E / L / R / J', 'Alinear texto'], ['Ctrl+Mayús+> / <', 'Tamaño de fuente'], ['F5', 'Presentar desde el principio'], ['Mayús+F5', 'Presentar desde la diapositiva actual'],
      ['Alt (al arrastrar)', 'Mover sin guías'], ['Mayús (al arrastrar)', 'Mover en línea recta / mantener proporción']];
    NV.dialogo({titulo: 'Atajos de teclado', ancho: 520, html: '<table class="nv-info-tabla">' + at2.map(function(a) { return '<tr><td><b>' + esc(a[0]) + '</b></td><td>' + esc(a[1]) + '</td></tr>'; }).join('') + '</table>', botones: [{texto: 'Cerrar', prim: true, valor: true}]});
  };
  A.num = function(id, v) {
    if (isNaN(v)) return;
    var s = P.seleccionados();
    if (id === 'nvpAlto' || id === 'nvpAncho') { s.forEach(function(e) { var pt = v / 2.54 * 72, r = e.w / e.h; if (id === 'nvpAncho') { e.w = Math.round(pt); if (e.tipo === 'imagen') e.h = Math.round(pt / r); } else { e.h = Math.round(pt); if (e.tipo === 'imagen') e.w = Math.round(pt * r); } delete e._png; }); P.pintarEscena(); P.cambio(); return; }
    if (id === 'nvpTDur') { var d = P.diap(); d.transicion = Object.assign(d.transicion || {tipo: 'ninguna'}, {dur: Math.max(0.1, v)}); P.cambio(); return; }
    if (id === 'nvpAvSegV') { var d2 = P.diap(); d2.avance = Object.assign(d2.avance || {clic: true}, {seg: Math.max(0, v)}); P.cambio(); return; }
    if (id === 'nvpADur') return A.animProp('dur', Math.max(0.1, v));
    if (id === 'nvpARet') return A.animProp('retraso', Math.max(0, v));
  };
  A.chk = function(id, on) {
    if (id === 'nvpChkCuad') { P.est.cuadricula = on; P.pintarEscena(); return; }
    if (id === 'nvpChkGuias') { P.est.guias = on; return; }
    if (id === 'nvpChkNotas') { NV.$('#nvpBtnNotas').click(); return; }
    if (id === 'nvpModerador') { P.est.moderador = on; return; }
    if (id === 'nvpAvClic') { var d = P.diap(); d.avance = Object.assign(d.avance || {}, {clic: on}); P.cambio(); return; }
    if (id === 'nvpAvSeg') { var d2 = P.diap(); d2.avance = Object.assign(d2.avance || {clic: true}, {seg: on ? (+NV.$('#nvpAvSegV').value || 5) : null}); P.cambio(); return; }
    var e = P.seleccionados()[0];
    if (id === 'nvpTEnc' && e) { e.tabla.encabezado = on; P.pintarEscena(); P.cambio(); }
    if (id === 'nvpTBan' && e) { e.tabla.bandas = on; P.pintarEscena(); P.cambio(); }
  };

  // ---------- Imágenes ----------
  function imagenSel() { return P.seleccionados().filter(function(e) { return e.tipo === 'imagen'; })[0]; }
  A.estiloImg = function(b, id) { var e = imagenSel(); if (!e) return; var s = ESTILOS_IMG.filter(function(x) { return x[0] === id; })[0]; e.estilo = Object.assign({}, {filtro: (e.estilo || {}).filtro}, s[2]); P.pintarEscena(); P.cambio(); };
  A.menuBordeImg = function(b) { menuColores(b, function(c) { var e = imagenSel(); if (!e) return; e.estilo = Object.assign(e.estilo || {}, {borde: c === 'none' ? null : c, grosor: 3}); P.pintarEscena(); P.cambio(); }, 'Sin contorno'); };
  A.menuCorrecciones = function(b) { menuFiltro(b, [['brightness(1.2)', 'Brillo +20%'], ['brightness(0.8)', 'Brillo -20%'], ['contrast(1.25)', 'Contraste +25%'], ['contrast(0.8)', 'Contraste -20%']]); };
  A.menuColorImg = function(b) { menuFiltro(b, [['grayscale(1)', 'Escala de grises'], ['sepia(1)', 'Sepia'], ['saturate(2)', 'Saturación 200%'], ['saturate(0.4)', 'Saturación 40%'], ['', 'Color original']]); };
  function menuFiltro(b, lista) { NV.menu(b, lista.map(function(x) { return {texto: x[1], accion: function() { var e = imagenSel(); if (!e) return; e.estilo = Object.assign(e.estilo || {}, {filtro: x[0]}); P.pintarEscena(); P.cambio(); }}; })); }
  A.restablecerImg = function() { var e = imagenSel(); if (!e) return; e.estilo = {}; e.ajuste = 'fill'; P.pintarEscena(); P.cambio(); };
  A.menuAjusteImg = function(b) { NV.menu(b, [['fill', 'Estirar'], ['cover', 'Rellenar (recortar)'], ['contain', 'Ajustar (completa)']].map(function(x) { return {texto: x[1], accion: function() { var e = imagenSel(); if (e) { e.ajuste = x[0]; P.pintarEscena(); P.cambio(); } }}; })); };
  A.textoAlt = function() {
    var e = imagenSel(); if (!e) return;
    NV.preguntar('Texto alternativo', 'Describe la imagen:', e.alt || '').then(function(t) { if (t !== null && t !== undefined) { e.alt = t; P.cambio(); } });
  };
})();
