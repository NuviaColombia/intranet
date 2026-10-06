/* Nuvia Office: pantalla de inicio, menú Archivo (backstage), plantillas, abrir/descargar/imprimir/compartir
   y herramientas PDF (imágenes → PDF, documentos → PDF, PDF → documento editable, unir PDF). */
(function() {
  'use strict';
  var NV = window.NV, W = NV.word, esc = NV.esc, I = NV.icono;
  NV.vistaActual = 'inicio';
  NV.mostrarVista = function(v) {
    NV.vistaActual = v;
    NV.$('#nvVistaInicio').classList.toggle('nv-oculto', v !== 'inicio');
    NV.$('#nvVistaWord').classList.toggle('nv-oculto', v !== 'word');
    if (v === 'word' && W.cinta) setTimeout(W.cinta.posicionar, 0);
  };

  // ---------- Plantillas ----------
  var hoy = function() { return new Date().toLocaleDateString('es-CO', {day: 'numeric', month: 'long', year: 'numeric'}); };
  var PLANTILLAS = [
    {id: 'blanco', n: 'Documento en blanco', html: '<p><br></p>'},
    {id: 'carta', n: 'Carta formal', html: function() {
      return '<p>Bogotá D.C., ' + hoy() + '</p><p><br></p><p>Señor(a)<br><b>[Nombre del destinatario]</b><br>[Cargo]<br>[Empresa]<br>[Ciudad]</p><p><br></p>' +
        '<p><b>Asunto:</b> [Asunto de la carta]</p><p><br></p><p>Cordial saludo:</p>' +
        '<p style="text-align:justify">[Escriba aquí el cuerpo de la carta. Exponga de manera clara y breve el motivo de la comunicación.]</p>' +
        '<p style="text-align:justify">[Segundo párrafo con detalles adicionales o solicitud concreta.]</p><p>Agradezco de antemano su atención.</p><p><br></p><p>Atentamente,</p>' +
        '<p style="margin-top:36pt;margin-bottom:0">______________________________</p><p style="margin:0"><b>[Su nombre]</b></p><p style="margin:0">[Cargo]</p><p style="margin:0">Nuvia Design Colombia S.A.S.</p>';
    }},
    {id: 'informe', n: 'Informe', html: function() {
      return '<p class="nv-Title">[Título del informe]</p><p class="nv-Subtitle">[Subtítulo] · ' + hoy() + '</p>' +
        '<div class="nv-toc" contenteditable="false" data-nv-toc="Contenido"><p class="nv-toc-t">Contenido</p></div>' +
        '<h1>Introducción</h1><p style="text-align:justify">[Describa el propósito del informe, el alcance y el contexto.]</p>' +
        '<h1>Desarrollo</h1><h2>Análisis</h2><p style="text-align:justify">[Presente los datos, hallazgos y su análisis.]</p>' +
        '<table style="border-collapse:collapse;width:100%" data-nv-estilo="enc1"><tbody><tr><td style="background-color:#4472C4;color:#FFFFFF;font-weight:bold;border:1px solid #8faadc">Indicador</td><td style="background-color:#4472C4;color:#FFFFFF;font-weight:bold;border:1px solid #8faadc">Valor</td><td style="background-color:#4472C4;color:#FFFFFF;font-weight:bold;border:1px solid #8faadc">Meta</td></tr>' +
        '<tr><td style="border:1px solid #8faadc;background-color:#dae3f3">[Indicador 1]</td><td style="border:1px solid #8faadc;background-color:#dae3f3">[0]</td><td style="border:1px solid #8faadc;background-color:#dae3f3">[0]</td></tr>' +
        '<tr><td style="border:1px solid #8faadc">[Indicador 2]</td><td style="border:1px solid #8faadc">[0]</td><td style="border:1px solid #8faadc">[0]</td></tr></tbody></table><p><br></p>' +
        '<h2>Resultados</h2><ul><li>[Resultado 1]</li><li>[Resultado 2]</li></ul><h1>Conclusiones</h1><p style="text-align:justify">[Conclusiones y recomendaciones.]</p>';
    }, aj: {pie: '<p style="text-align:right">Página <span data-campo="pagina">#</span> de <span data-campo="paginas">#</span></p>'}},
    {id: 'memo', n: 'Memorando', html: function() {
      return '<p class="nv-Title" style="color:#2F5496">MEMORANDO</p><hr><p><b>Para:</b> [Destinatarios]<br><b>De:</b> [Remitente]<br><b>Fecha:</b> ' + hoy() + '<br><b>Asunto:</b> [Asunto]</p><hr>' +
        '<p style="text-align:justify">[Escriba aquí el mensaje del memorando.]</p>';
    }},
    {id: 'acta', n: 'Acta de reunión', html: function() {
      return '<p class="nv-Title">Acta de reunión</p><table style="border-collapse:collapse;width:100%" data-nv-estilo="clara"><tbody>' +
        ['Fecha|' + hoy(), 'Hora|[00:00 a. m.]', 'Lugar|[Sala / enlace]', 'Responsable|[Nombre]'].map(function(f) { var p = f.split('|'); return '<tr><td style="border:1px solid #BFBFBF;width:25%;font-weight:bold">' + p[0] + '</td><td style="border:1px solid #BFBFBF">' + p[1] + '</td></tr>'; }).join('') +
        '</tbody></table><h1>Asistentes</h1><ul><li>[Nombre — cargo]</li><li>[Nombre — cargo]</li></ul><h1>Orden del día</h1><ol><li>[Tema 1]</li><li>[Tema 2]</li></ol>' +
        '<h1>Desarrollo</h1><p>[Resumen de lo tratado.]</p><h1>Compromisos</h1><table style="border-collapse:collapse;width:100%" data-nv-estilo="enc1"><tbody><tr>' +
        ['Compromiso', 'Responsable', 'Fecha'].map(function(t) { return '<td style="background-color:#4472C4;color:#FFFFFF;font-weight:bold;border:1px solid #8faadc">' + t + '</td>'; }).join('') +
        '</tr><tr><td style="border:1px solid #8faadc">[ ]</td><td style="border:1px solid #8faadc">[ ]</td><td style="border:1px solid #8faadc">[ ]</td></tr></tbody></table>';
    }},
    {id: 'cv', n: 'Currículum', html: function() {
      return '<p class="nv-Title" style="text-align:center">[Nombre Apellido]</p><p style="text-align:center;color:#595959">[Cargo] · [correo@ejemplo.com] · [300 000 0000] · [Ciudad]</p><hr>' +
        '<h1>Perfil</h1><p style="text-align:justify">[Breve descripción profesional.]</p><h1>Experiencia</h1><h3>[Cargo] — [Empresa]</h3><p style="color:#595959;margin:0">[Mes año] – [Mes año]</p><ul><li>[Logro o responsabilidad]</li><li>[Logro o responsabilidad]</li></ul>' +
        '<h1>Educación</h1><h3>[Título] — [Institución]</h3><p style="color:#595959">[Año]</p><h1>Habilidades</h1><ul><li>[Habilidad]</li><li>[Habilidad]</li></ul>';
    }, aj: {pagina: {tam: 'carta', orient: 'v', margenes: {sup: 1.9, inf: 1.9, izq: 1.9, der: 1.9}}, tema: 'moderno'}}
  ];
  function miniPlantilla(p) {
    var lineas = {blanco: '', carta: '<i style="width:40%"></i><i></i><i></i><i style="width:70%"></i><br><i></i><i></i><i></i><i style="width:50%"></i>',
      informe: '<b style="width:70%;height:7px;background:#2F5496"></b><i style="width:40%"></i><br><b style="width:40%;height:4px;background:#2F5496"></b><i></i><i></i><u></u><i></i>',
      memo: '<b style="width:55%;height:7px;background:#2F5496"></b><i style="width:50%"></i><i style="width:45%"></i><i style="width:50%"></i><br><i></i><i></i><i></i>',
      acta: '<b style="width:50%;height:6px;background:#000"></b><u></u><b style="width:30%;height:4px;background:#2F5496"></b><i style="width:60%"></i><i style="width:60%"></i><b style="width:30%;height:4px;background:#2F5496"></b><i></i>',
      cv: '<b style="width:50%;height:7px;background:#000;margin:0 auto 3px"></b><i style="width:70%;margin:0 auto 6px"></i><b style="width:25%;height:4px;background:#0B5394"></b><i></i><i></i><b style="width:25%;height:4px;background:#0B5394"></b><i></i>'}[p.id] || '';
    return '<div style="width:100%;height:100%;padding:16px 14px;text-align:left" class="mini">' + lineas.replace(/<i( style="([^"]*)")?><\/i>/g, '<span style="display:block;height:3px;background:#c8c6c4;margin:0 0 4px;width:100%;$2"></span>')
      .replace(/<b style="([^"]*)"><\/b>/g, '<span style="display:block;margin:0 0 5px;$1"></span>').replace(/<u><\/u>/g, '<span style="display:block;height:14px;border:1px solid #8faadc;background:#dae3f3;margin:4px 0"></span>').replace(/<br>/g, '<span style="display:block;height:6px"></span>') + '</div>';
  }
  NV.nuevoDocumento = function(plantilla) {
    var p = PLANTILLAS.filter(function(x) { return x.id === (plantilla || 'blanco'); })[0] || PLANTILLAS[0];
    var aj = Object.assign(W.ajustesPredeterminados(), p.aj || {});
    NV.cargando('Creando documento…');
    return NV.api('/design/api/office/docs', {json: {tipo: 'word', titulo: p.id === 'blanco' ? 'Documento ' + new Date().toLocaleDateString('es-CO') : p.n, contenido: typeof p.html === 'function' ? p.html() : p.html, ajustes: aj}})
      .then(function(d) { NV.cargando(false); return W.abrir(d).then(function() { if (/nv-toc/.test(d.contenido)) setTimeout(function() { W.actualizarTOC(true); }, 800); }); })
      .catch(function(e) { NV.cargando(false); NV.toast(e.message, true); });
  };
  NV.crearDesdeHtml = function(titulo, html, ajustes) {
    return NV.api('/design/api/office/docs', {json: {tipo: 'word', titulo: titulo, contenido: html, ajustes: Object.assign(W.ajustesPredeterminados(), ajustes || {})}})
      .then(function(d) { return W.abrir(d); });
  };

  // ---------- Abrir desde el PC ----------
  NV.abrirDesdePC = function(f) {
    var ext = NV.extension(f.name), titulo = NV.sinExtension(f.name);
    if (ext === 'doc') { NV.alerta('Formato antiguo', 'Los archivos .doc (Word 97-2003) no se pueden abrir. Ábrelo en Word y guárdalo como .docx, o expórtalo a PDF.'); return Promise.resolve(); }
    if (ext === 'pptx' || ext === 'ppt') { NV.alerta('Presentaciones', 'Las presentaciones de PowerPoint llegan en la fase 2 de Nuvia Office.'); return Promise.resolve(); }
    NV.cargando('Abriendo ' + f.name + '…');
    var p;
    if (ext === 'docx' || ext === 'docm' || ext === 'dotx') p = NV.leerArchivo(f).then(function(b) { return NV.docx.importar(b); });
    else if (ext === 'pdf') p = NV.leerArchivo(f).then(function(b) { return NV.pdf.aDocumento(b, {imagenes: true}, function(x, t) { NV.cargando('Convirtiendo PDF… ' + t, x); }); });
    else if (ext === 'txt' || ext === 'csv' || ext === 'md') p = NV.leerArchivo(f, 'texto').then(function(t) { return {html: t.split(/\r?\n/).map(function(l) { return '<p>' + (esc(l) || '<br>') + '</p>'; }).join('')}; });
    else if (ext === 'html' || ext === 'htm') p = NV.leerArchivo(f, 'texto').then(function(t) { var d = new DOMParser().parseFromString(t, 'text/html'); NV.$$('script,style,link,meta', d).forEach(function(x) { x.remove(); }); return {html: d.body.innerHTML}; });
    else if (/^(png|jpe?g|gif|webp|bmp)$/.test(ext)) p = NV.imagenADataUrl(f).then(function(u) { return {html: '<p style="text-align:center"><img src="' + u + '" alt="' + esc(titulo) + '" style="max-width:100%"></p><p><br></p>'}; });
    else { NV.cargando(false); NV.toast('Formato no compatible. Abre archivos .docx, .pdf, .txt, .html o imágenes.', true); return Promise.resolve(); }
    return p.then(function(r) { NV.cargando('Guardando en Nuvia Office…'); return NV.crearDesdeHtml(titulo, r.html, r.ajustes); })
      .then(function() { NV.cargando(false); NV.backstage.cerrar(); })
      .catch(function(e) { NV.cargando(false); NV.toast(e.message || String(e), true); });
  };
  var ACEPTA = '.docx,.docm,.dotx,.pdf,.txt,.csv,.md,.html,.htm,.png,.jpg,.jpeg,.gif,.webp,.bmp,.doc,.pptx';

  // ---------- Lista de archivos ----------
  var listaCache = null;
  NV.cargarLista = function() { return NV.api('/design/api/office/docs').then(function(r) { listaCache = r; return r; }); };
  function filaDoc(d, modo) {
    var col = d.tipo === 'ppt' ? '#c43e1c' : '#185abd', letra = d.tipo === 'ppt' ? 'P' : 'W';
    return '<tr class="doc" data-id="' + d.id + '" tabindex="0"><td><span class="nom"><span class="tipo" style="background:' + col + '">' + letra + '</span><span>' + esc(d.titulo) + '</span></span></td>' +
      '<td>' + (modo === 'compartidos' ? esc(d.propietario) : (modo === 'eliminados' ? 'Eliminado ' + NV.fechaCorta(d.eliminadoEn) : NV.fechaCorta(d.actualizadoEn))) + '</td>' +
      '<td>' + (modo === 'compartidos' ? (d.permiso === 'editar' ? 'Puede editar' : 'Solo ver') : NV.tamano(d.tamano)) + '</td>' +
      '<td class="acc"><button type="button" data-acc="menu" aria-label="Más opciones de ' + esc(d.titulo) + '" title="Más opciones">⋯</button></td></tr>';
  }
  function pintarLista(cont, modo) {
    var r = listaCache || {mios: [], compartidos: [], eliminados: []}, lista = r[modo] || [];
    var q = (cont.dataset.q || '').toLowerCase();
    if (q) lista = lista.filter(function(d) { return d.titulo.toLowerCase().indexOf(q) >= 0; });
    var cab = modo === 'compartidos' ? '<th>Nombre</th><th>Compartido por</th><th>Permiso</th><th></th>' : modo === 'eliminados' ? '<th>Nombre</th><th>Eliminado</th><th>Tamaño</th><th></th>' : '<th>Nombre</th><th>Modificado</th><th>Tamaño</th><th></th>';
    cont.innerHTML = lista.length ? '<table class="nv-lista-docs"><thead><tr>' + cab + '</tr></thead><tbody>' + lista.map(function(d) { return filaDoc(d, modo); }).join('') + '</tbody></table>' :
      '<p class="nv-vacio">' + (q ? 'No hay documentos con ese nombre.' : modo === 'compartidos' ? 'Nadie ha compartido documentos contigo todavía.' : modo === 'eliminados' ? 'No hay documentos eliminados.' : 'Todavía no tienes documentos. Crea uno nuevo o abre un archivo de tu equipo.') + '</p>';
    cont.onclick = function(e) {
      var tr = e.target.closest('tr.doc'); if (!tr) return;
      var d = lista.filter(function(x) { return x.id === +tr.dataset.id; })[0]; if (!d) return;
      if (e.target.closest('[data-acc="menu"]')) { menuDoc(e.target.closest('button'), d, modo, function() { NV.cargarLista().then(function() { pintarLista(cont, modo); }); }); return; }
      if (modo === 'eliminados') { menuDoc(tr.querySelector('button'), d, modo, function() { NV.cargarLista().then(function() { pintarLista(cont, modo); }); }); return; }
      NV.backstage.cerrar(); abrirDoc(d);
    };
    cont.onkeydown = function(e) { if (e.key === 'Enter' && e.target.matches('tr.doc')) e.target.click(); };
  }
  function abrirDoc(d) {
    if (d.tipo === 'ppt') { NV.alerta('Presentaciones', 'Nuvia PowerPoint llega en la fase 2.'); return; }
    if (W.doc && W.doc.id === d.id && NV.vistaActual === 'word') { NV.backstage.cerrar(); return; }
    var antes = W.doc && !W.est.guardado ? W.guardar() : Promise.resolve();
    antes.then(function() { W.abrirPorId(d.id); });
  }
  function menuDoc(b, d, modo, refrescar) {
    var items;
    if (modo === 'eliminados') items = [
      {texto: 'Restaurar', icono: 'arrow_undo', accion: function() { NV.api('/design/api/office/docs/' + d.id + '/restaurar', {json: {}}).then(function() { NV.toast('Documento restaurado.'); refrescar(); }).catch(function(e) { NV.toast(e.message, true); }); }},
      {texto: 'Eliminar definitivamente', icono: 'delete', accion: function() {
        NV.confirmar('Eliminar definitivamente', '¿Eliminar "' + d.titulo + '" para siempre? No se puede deshacer.', 'Eliminar').then(function(ok) {
          if (ok) NV.api('/design/api/office/docs/' + d.id + '/borrar', {json: {}}).then(function() { NV.toast('Documento eliminado.'); refrescar(); }).catch(function(e) { NV.toast(e.message, true); });
        });
      }}];
    else items = [
      {texto: 'Abrir', icono: 'open', accion: function() { NV.backstage.cerrar(); abrirDoc(d); }},
      {texto: 'Abrir en una ventana nueva', icono: 'window_new', accion: function() { window.open('/design/office?doc=' + d.id, '_blank'); }},
      {sep: true},
      {texto: 'Descargar como Word (.docx)', icono: 'arrow_download', accion: function() { descargarDocId(d.id, 'docx'); }},
      {texto: 'Descargar como PDF', icono: 'document_pdf', accion: function() { descargarDocId(d.id, 'pdf'); }},
      {sep: true},
      modo === 'mios' ? {texto: 'Cambiar nombre', icono: 'rename', accion: function() {
        NV.preguntar('Cambiar nombre', 'Nombre del documento:', d.titulo).then(function(t) {
          t = (t || '').trim(); if (!t || t === d.titulo) return;
          NV.api('/design/api/office/docs/' + d.id).then(function(full) { return NV.api('/design/api/office/docs/' + d.id, {json: {version: full.version, titulo: t}}); })
            .then(function() { if (W.doc && W.doc.id === d.id) { W.doc.titulo = t; NV.$('#nvDocTitulo').textContent = t; W.doc.version++; } refrescar(); }).catch(function(e) { NV.toast(e.message, true); });
        });
      }} : null,
      {texto: 'Hacer una copia', icono: 'copy', accion: function() { NV.api('/design/api/office/docs/' + d.id + '/duplicar', {json: {}}).then(function() { NV.toast('Copia creada.'); refrescar(); }).catch(function(e) { NV.toast(e.message, true); }); }},
      modo === 'mios' ? {texto: 'Compartir', icono: 'share', accion: function() { NV.compartir(d.id); }} : null,
      modo === 'mios' ? {sep: true} : null,
      modo === 'mios' ? {texto: 'Eliminar', icono: 'delete', accion: function() {
        NV.api('/design/api/office/docs/' + d.id + '/eliminar', {json: {}}).then(function() {
          NV.toast('"' + d.titulo + '" se movió a Eliminados (puedes restaurarlo).');
          if (W.doc && W.doc.id === d.id) { W.doc = null; NV.mostrarVista('inicio'); NV.inicio.mostrar(); }
          refrescar();
        }).catch(function(e) { NV.toast(e.message, true); });
      }} : null];
    NV.menu(b, items.filter(Boolean), {ancho: 250});
  }
  function descargarDocId(id, fmt) {
    NV.cargando('Preparando descarga…');
    NV.api('/design/api/office/docs/' + id).then(function(d) {
      var aj = Object.assign(W.ajustesPredeterminados(), d.ajustes || {});
      if (aj.temaPersonalizado) W.TEMAS.personalizado = aj.temaPersonalizado;
      return fmt === 'pdf' ? NV.pdf.exportarDoc(d.contenido, aj, d.titulo, d.propietario).then(function(b) { NV.descargar(b, NV.nombreArchivo(d.titulo, 'pdf')); })
        : NV.docx.exportar(d.contenido, aj, d.titulo, d.propietario).then(function(b) { NV.descargar(b, NV.nombreArchivo(d.titulo, 'docx')); });
    }).then(function() { NV.cargando(false); }).catch(function(e) { NV.cargando(false); NV.toast('No se pudo descargar: ' + e.message, true); });
  }

  // ---------- Descargar el documento abierto ----------
  NV.descargarActual = function(fmt) {
    if (!W.doc) return;
    var html = W.contenidoLimpio(), aj = W.aj, t = W.doc.titulo, autor = (NV.usuario || {}).nombre;
    if (fmt === 'html') {
      var pagina = '<!DOCTYPE html><html lang="' + (aj.idioma || 'es') + '"><head><meta charset="utf-8"><title>' + esc(t) + '</title><link rel="stylesheet" href="' + NV.FUENTES_GOOGLE + '"><style>' +
        W.cssDocumento() + 'body{max-width:' + W.dim().w + 'cm;margin:2cm auto;padding:0 ' + aj.pagina.margenes.izq + 'cm;}.nv-salto{border-top:1px dashed #ccc;margin:24px 0;}</style></head><body>' + html + '</body></html>';
      NV.descargar(new Blob([pagina], {type: 'text/html;charset=utf-8'}), NV.nombreArchivo(t, 'html')); return Promise.resolve();
    }
    if (fmt === 'txt') {
      var div = document.createElement('div'); div.innerHTML = html.replace(/<\/(p|h\d|li|tr|div)>/g, '$&\n').replace(/<br\s*\/?>/g, '\n');
      NV.descargar(new Blob([div.textContent.replace(/\n{3,}/g, '\n\n')], {type: 'text/plain;charset=utf-8'}), NV.nombreArchivo(t, 'txt')); return Promise.resolve();
    }
    NV.cargando(fmt === 'pdf' ? 'Creando PDF…' : 'Creando documento de Word…');
    var p = fmt === 'pdf' ? NV.pdf.exportarDoc(html, aj, t, autor) : NV.docx.exportar(html, aj, t, autor);
    return p.then(function(b) { NV.cargando(false); NV.descargar(b, NV.nombreArchivo(t, fmt)); NV.toast('Se descargó "' + NV.nombreArchivo(t, fmt) + '".'); })
      .catch(function(e) { NV.cargando(false); NV.toast('No se pudo crear el archivo: ' + (e.message || e), true); });
  };

  // ---------- Compartir ----------
  NV.compartir = function(id) {
    id = id || (W.doc && W.doc.id);
    if (!id) return;
    Promise.all([NV.api('/design/api/office/docs/' + id), NV.api('/design/api/office/personas')]).then(function(r) {
      var d = r[0], personas = r[1];
      if (d.permiso !== 'dueño') { NV.alerta('Compartir', 'Solo ' + d.propietario + ' (dueño del documento) puede compartirlo.'); return; }
      var comp = {}; (d.compartido || []).forEach(function(c) { comp[c.empleadoId] = c.puedeEditar ? 'editar' : 'ver'; });
      var html = '<p style="margin-top:0;font-size:13.5px;line-height:1.5">Comparte <b>' + esc(d.titulo) + '</b> con aprobadores y administradores de Design. Ellos lo verán en <i>Compartidos conmigo</i>.</p>' +
        '<div class="nv-campo"><input type="text" id="ncQ" placeholder="Buscar persona…" aria-label="Buscar persona"></div><div class="nv-personas" id="ncL">' +
        personas.map(function(p) {
          return '<div class="nv-persona" data-n="' + esc(p.nombre.toLowerCase()) + '"><span class="ini">' + NV.iniciales(p.nombre) + '</span><span class="dat">' + esc(p.nombre) + '<small>' + esc(p.email || '') + '</small></span>' +
            '<select data-p="' + p.id + '" aria-label="Permiso de ' + esc(p.nombre) + '"><option value="">Sin acceso</option><option value="ver"' + (comp[p.id] === 'ver' ? ' selected' : '') + '>Puede ver</option><option value="editar"' + (comp[p.id] === 'editar' ? ' selected' : '') + '>Puede editar</option></select></div>';
        }).join('') + '</div>';
      NV.dialogo({titulo: 'Compartir', html: html, ancho: 520, alAbrir: function(dlg) {
        dlg.querySelector('#ncQ').addEventListener('input', function() { var q = this.value.toLowerCase(); NV.$$('.nv-persona', dlg).forEach(function(x) { x.style.display = x.dataset.n.indexOf(q) >= 0 ? '' : 'none'; }); });
        dlg.querySelector('#ncL').addEventListener('change', function(e) {
          var s = e.target.closest('select'); if (!s) return;
          var pid = +s.dataset.p, v = s.value; s.disabled = true;
          var req = v ? NV.api('/design/api/office/docs/' + id + '/compartir', {json: {empleadoId: pid, puedeEditar: v === 'editar'}}) : NV.api('/design/api/office/docs/' + id + '/compartir/' + pid + '/quitar', {json: {}});
          req.then(function() { NV.toast(v ? 'Compartido.' : 'Se quitó el acceso.'); }).catch(function(er) { NV.toast(er.message, true); }).then(function() { s.disabled = false; });
        });
      }, botones: [{texto: 'Listo', prim: true, valor: true}]});
    }).catch(function(e) { NV.toast(e.message, true); });
  };

  // ---------- Imprimir (vista previa con el mismo PDF que se descarga) ----------
  var urlVista = null;
  function vistaImpresion(cont) {
    cont.innerHTML = '<div style="display:flex;gap:28px;align-items:flex-start;flex-wrap:wrap"><div style="width:260px"><h1 style="margin-bottom:14px">Imprimir</h1>' +
      '<button type="button" class="nv-btn prim" id="nbImp" style="height:60px;width:110px;flex-direction:column;justify-content:center">' + I('print', 'g') + 'Imprimir</button>' +
      '<p style="font-size:13px;color:#605e5c;line-height:1.5;margin-top:18px">Se imprime exactamente como el PDF: páginas, encabezado, pie y números de página. En la ventana de impresión puedes elegir la impresora, las copias y las páginas.</p>' +
      '<button type="button" class="nv-btn" id="nbImpPdf">' + I('document_pdf', 'p') + 'Descargar el PDF</button></div>' +
      '<div style="flex:1;min-width:320px;height:calc(100vh - 110px);background:#e8e6e4;border-radius:6px;display:flex;align-items:center;justify-content:center" id="nbVista"><div class="nv-spin"></div></div></div>';
    NV.pdf.exportarDoc(W.contenidoLimpio(), W.aj, W.doc.titulo, (NV.usuario || {}).nombre).then(function(b) {
      if (urlVista) URL.revokeObjectURL(urlVista);
      urlVista = URL.createObjectURL(b);
      var v = cont.querySelector('#nbVista'); if (!v) return;
      v.innerHTML = '<iframe id="nbFrame" title="Vista previa de impresión" src="' + urlVista + '#view=FitH" style="width:100%;height:100%;border:0;border-radius:6px"></iframe>';
      cont.querySelector('#nbImp').onclick = function() {
        var f = cont.querySelector('#nbFrame');
        try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { window.open(urlVista, '_blank'); }
      };
      cont.querySelector('#nbImpPdf').onclick = function() { NV.descargar(b, NV.nombreArchivo(W.doc.titulo, 'pdf')); };
    }).catch(function(e) { var v = cont.querySelector('#nbVista'); if (v) v.innerHTML = '<p style="padding:20px">No se pudo preparar la vista previa: ' + esc(e.message) + '</p>'; });
  }

  // ---------- Herramientas PDF ----------
  var HERR = [
    {id: 'img2pdf', n: 'Imágenes a PDF', d: 'Convierte fotos PNG, JPG y otros formatos en un PDF, una imagen por página.', ic: 'image', c: '#0f7b0f'},
    {id: 'doc2pdf', n: 'Documento a PDF', d: 'Convierte archivos de Word (.docx), texto o HTML en PDF.', ic: 'document_pdf', c: '#c50f1f'},
    {id: 'pdf2doc', n: 'PDF a documento editable', d: 'Convierte un PDF en un documento de Nuvia Word para editarlo o guardarlo como .docx.', ic: 'document_edit', c: '#185abd'},
    {id: 'unirpdf', n: 'Unir PDF', d: 'Combina varios PDF en uno solo, en el orden que elijas.', ic: 'document_multiple', c: '#8764b8'}
  ];
  function herramientasHtml() {
    return '<div class="nv-herr-pdf">' + HERR.map(function(h) {
      return '<button type="button" class="nv-herr" data-herr="' + h.id + '"><span class="ic" style="background:' + h.c + '">' + I(h.ic) + '</span><span><b>' + esc(h.n) + '</b><span>' + esc(h.d) + '</span></span></button>';
    }).join('') + '</div>';
  }
  NV.herramienta = function(id) {
    if (id === 'img2pdf') return imagenesAPdf();
    if (id === 'doc2pdf') return documentoAPdf();
    if (id === 'pdf2doc') return pdfADocumento();
    if (id === 'unirpdf') return unirPdf();
  };
  // Lista de archivos con miniaturas, arrastrar para ordenar y quitar.
  function zonaArchivos(dlg, accept, multiple, pintarItem) {
    var archivos = [], zona = dlg.querySelector('.nv-arrastre'), lista = dlg.querySelector('.nv-imgs');
    var pintar = function() {
      lista.innerHTML = archivos.map(function(a, i) { return '<div class="nv-img-item" draggable="true" data-i="' + i + '"><span class="n">' + (i + 1) + '</span><button type="button" class="x" data-x="' + i + '" aria-label="Quitar ' + esc(a.f.name) + '">×</button>' + pintarItem(a) + '<div class="nombre" title="' + esc(a.f.name) + '">' + esc(a.f.name) + '</div></div>'; }).join('');
      dlg.querySelector('.nv-cuenta').textContent = archivos.length ? archivos.length + ' archivo' + (archivos.length === 1 ? '' : 's') + (multiple ? ' · arrastra para cambiar el orden' : '') : '';
    };
    var agregar = function(fs) {
      fs = fs.filter(function(f) { var ok = !accept || accept.test(f.name) || accept.test(f.type || ''); if (!ok) NV.toast('"' + f.name + '" no es un formato válido para esta herramienta.', true); return ok; });
      if (!multiple) archivos = [];
      fs.forEach(function(f) { var a = {f: f}; if (/^image\//.test(f.type)) a.url = URL.createObjectURL(f); archivos.push(a); });
      pintar();
    };
    zona.addEventListener('click', function() { NV.elegirArchivos(dlg.dataset.accept, multiple).then(agregar); });
    zona.addEventListener('keydown', function(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); zona.click(); } });
    ['dragenter', 'dragover'].forEach(function(t) { zona.addEventListener(t, function(e) { e.preventDefault(); zona.classList.add('sobre'); }); });
    ['dragleave', 'drop'].forEach(function(t) { zona.addEventListener(t, function(e) { e.preventDefault(); zona.classList.remove('sobre'); }); });
    zona.addEventListener('drop', function(e) { agregar(Array.prototype.slice.call(e.dataTransfer.files || [])); });
    var origen = null;
    lista.addEventListener('dragstart', function(e) { var it = e.target.closest('.nv-img-item'); if (it) { origen = +it.dataset.i; it.classList.add('arrastrando'); } });
    lista.addEventListener('dragover', function(e) { e.preventDefault(); });
    lista.addEventListener('drop', function(e) { e.preventDefault(); var it = e.target.closest('.nv-img-item'); if (it && origen !== null) { var a = archivos.splice(origen, 1)[0]; archivos.splice(+it.dataset.i, 0, a); pintar(); } origen = null; });
    lista.addEventListener('dragend', function() { origen = null; pintar(); });
    lista.addEventListener('click', function(e) { var x = e.target.closest('[data-x]'); if (x) { archivos.splice(+x.dataset.x, 1); pintar(); } });
    return {archivos: function() { return archivos.map(function(a) { return a.f; }); }, agregar: agregar};
  }
  function imagenesAPdf() {
    var html = '<div class="nv-arrastre" tabindex="0" role="button">' + I('image_add', 'g') + '<br>Arrastra aquí las imágenes o <b>haz clic para elegirlas</b><br><small>PNG, JPG, WEBP, GIF, BMP</small></div>' +
      '<div class="nv-imgs"></div><div class="nv-cuenta" style="font-size:12.5px;color:#605e5c;margin-bottom:10px"></div>' +
      '<div class="nv-filas2"><div class="nv-campo"><label for="ipT">Tamaño de página</label><select id="ipT"><option value="a4">A4</option><option value="carta">Carta</option><option value="oficio">Oficio</option><option value="imagen">Igual a la imagen</option></select></div>' +
      '<div class="nv-campo"><label for="ipO">Orientación</label><select id="ipO"><option value="auto">Automática (según la imagen)</option><option value="v">Vertical</option><option value="h">Horizontal</option></select></div>' +
      '<div class="nv-campo"><label for="ipM">Margen</label><select id="ipM"><option value="">Sin margen</option><option value="pequeno" selected>Pequeño</option><option value="grande">Grande</option></select></div>' +
      '<div class="nv-campo"><label for="ipA">Ajuste</label><select id="ipA"><option value="ajustar">Ajustar (imagen completa)</option><option value="llenar">Llenar la página (recorta bordes)</option></select></div></div>' +
      '<div class="nv-campo"><label for="ipN">Nombre del PDF</label><input type="text" id="ipN" value="Imágenes ' + new Date().toLocaleDateString('es-CO').replace(/\//g, '-') + '"></div>';
    var z;
    NV.dialogo({titulo: 'Imágenes a PDF', html: html, ancho: 640, alAbrir: function(d) {
      d.dataset.accept = 'image/*,.png,.jpg,.jpeg,.webp,.gif,.bmp';
      z = zonaArchivos(d, /\.(png|jpe?g|webp|gif|bmp)$|^image\//i, true, function(a) { return '<img src="' + a.url + '" alt="">'; });
    }, botones: [{texto: 'Convertir y descargar', prim: true, accion: function(d) {
      var fs = z.archivos(); if (!fs.length) { NV.toast('Agrega al menos una imagen.', true); return false; }
      var nombre = d.querySelector('#ipN').value || 'Imágenes';
      NV.cargando('Creando PDF…', 0);
      return NV.pdf.imagenesAPdf(fs, {tam: d.querySelector('#ipT').value, orient: d.querySelector('#ipO').value, margen: d.querySelector('#ipM').value, ajuste: d.querySelector('#ipA').value, titulo: nombre},
        function(x, n) { NV.cargando('Agregando ' + n + '…', x); })
        .then(function(b) { NV.cargando(false); NV.descargar(b, NV.nombreArchivo(nombre, 'pdf')); NV.toast('PDF creado con ' + fs.length + ' página' + (fs.length === 1 ? '' : 's') + '.'); return true; },
              function(e) { NV.cargando(false); throw e; });
    }}, {texto: 'Cancelar', valor: null}]});
  }
  function convertirAHtml(f) {
    var ext = NV.extension(f.name);
    if (ext === 'docx' || ext === 'docm' || ext === 'dotx') return NV.leerArchivo(f).then(function(b) { return NV.docx.importar(b); });
    if (ext === 'txt' || ext === 'csv' || ext === 'md') return NV.leerArchivo(f, 'texto').then(function(t) { return {html: t.split(/\r?\n/).map(function(l) { return '<p>' + (esc(l) || '<br>') + '</p>'; }).join('')}; });
    if (ext === 'html' || ext === 'htm') return NV.leerArchivo(f, 'texto').then(function(t) { var dd = new DOMParser().parseFromString(t, 'text/html'); NV.$$('script,style,link,meta', dd).forEach(function(x) { x.remove(); }); return {html: dd.body.innerHTML}; });
    if (/^(png|jpe?g|gif|webp|bmp)$/.test(ext)) return NV.imagenADataUrl(f).then(function(u) { return {html: '<p style="text-align:center"><img src="' + u + '" alt="" style="max-width:100%"></p>'}; });
    return Promise.reject(new Error('"' + f.name + '" no es un documento compatible (.docx, .txt, .html).'));
  }
  function documentoAPdf() {
    var mios = (listaCache && listaCache.mios || []).filter(function(d) { return d.tipo === 'word'; });
    var html = '<div class="nv-arrastre" tabindex="0" role="button">' + I('document_arrow_up', 'g') + '<br>Arrastra aquí los documentos o <b>haz clic para elegirlos</b><br><small>Word (.docx), texto (.txt) o HTML</small></div>' +
      '<div class="nv-imgs"></div><div class="nv-cuenta" style="font-size:12.5px;color:#605e5c;margin-bottom:10px"></div>' +
      (mios.length ? '<div class="nv-campo"><label for="dpMio">O un documento de Nuvia Office</label><select id="dpMio"><option value="">—</option>' + mios.map(function(d) { return '<option value="' + d.id + '">' + esc(d.titulo) + '</option>'; }).join('') + '</select></div>' : '') +
      '<label class="nv-chk"><input type="checkbox" id="dpUnir"> Unir todo en un solo PDF</label>';
    var z;
    NV.dialogo({titulo: 'Documento a PDF', html: html, ancho: 620, alAbrir: function(d) {
      d.dataset.accept = '.docx,.docm,.dotx,.txt,.csv,.md,.html,.htm';
      z = zonaArchivos(d, /\.(docx|docm|dotx|txt|csv|md|html?)$/i, true, function(a) { return '<div style="height:94px;display:grid;place-items:center;color:#185abd">' + I('document', 'g') + '</div>'; });
    }, botones: [{texto: 'Convertir y descargar', prim: true, accion: function(d) {
      var fs = z.archivos(), mio = d.querySelector('#dpMio') ? d.querySelector('#dpMio').value : '';
      if (!fs.length && !mio) { NV.toast('Elige al menos un documento.', true); return false; }
      var unir = d.querySelector('#dpUnir').checked, blobs = [], nombres = [], total = fs.length + (mio ? 1 : 0), k = 0;
      var paso = function(n) { k++; NV.cargando('Convirtiendo ' + n + '…', k / total); };
      var cadena = Promise.resolve();
      if (mio) cadena = cadena.then(function() {
        return NV.api('/design/api/office/docs/' + mio).then(function(doc) { paso(doc.titulo); var aj = Object.assign(W.ajustesPredeterminados(), doc.ajustes || {}); return NV.pdf.exportarDoc(doc.contenido, aj, doc.titulo).then(function(b) { blobs.push(b); nombres.push(doc.titulo); }); });
      });
      fs.forEach(function(f) {
        cadena = cadena.then(function() { paso(f.name); return convertirAHtml(f); }).then(function(r) {
          var aj = Object.assign(W.ajustesPredeterminados(), r.ajustes || {});
          return NV.pdf.exportarDoc(r.html, aj, NV.sinExtension(f.name)).then(function(b) { blobs.push(b); nombres.push(NV.sinExtension(f.name)); });
        });
      });
      return cadena.then(function() {
        if (unir && blobs.length > 1) return NV.pdf.unir(blobs).then(function(b) { NV.descargar(b, NV.nombreArchivo(nombres[0] + ' y otros', 'pdf')); });
        blobs.forEach(function(b, i) { setTimeout(function() { NV.descargar(b, NV.nombreArchivo(nombres[i], 'pdf')); }, i * 400); });
      }).then(function() { NV.cargando(false); NV.toast(blobs.length + ' PDF listo' + (blobs.length === 1 ? '' : 's') + '.'); return true; }, function(e) { NV.cargando(false); throw e; });
    }}, {texto: 'Cancelar', valor: null}]});
  }
  function pdfADocumento() {
    var html = '<div class="nv-arrastre" tabindex="0" role="button">' + I('document_pdf', 'g') + '<br>Arrastra aquí el PDF o <b>haz clic para elegirlo</b></div><div class="nv-imgs"></div><div class="nv-cuenta" style="font-size:12.5px;color:#605e5c;margin-bottom:10px"></div>' +
      '<label class="nv-chk"><input type="checkbox" id="pdI" checked> Incluir las imágenes del PDF</label>' +
      '<p style="font-size:12.5px;color:#605e5c;line-height:1.5">Se conservan el texto, los tamaños, las negritas y cursivas, los párrafos y las imágenes. Los PDF escaneados (fotos de páginas) se insertan como imágenes, porque no tienen texto que se pueda editar.</p>';
    var z;
    NV.dialogo({titulo: 'PDF a documento editable', html: html, ancho: 560, alAbrir: function(d) {
      d.dataset.accept = '.pdf,application/pdf';
      z = zonaArchivos(d, /\.pdf$|application\/pdf/i, false, function() { return '<div style="height:94px;display:grid;place-items:center;color:#c50f1f">' + I('document_pdf', 'g') + '</div>'; });
    }, botones: [
      {texto: 'Abrir en Nuvia Word', prim: true, accion: function(d) { return convertirPdf(d, z, 'abrir'); }},
      {texto: 'Descargar como Word', accion: function(d) { return convertirPdf(d, z, 'docx'); }},
      {texto: 'Cancelar', valor: null}]});
  }
  function convertirPdf(d, z, modo) {
    var f = z.archivos()[0]; if (!f) { NV.toast('Elige un PDF.', true); return false; }
    NV.cargando('Leyendo el PDF…', 0);
    return NV.leerArchivo(f).then(function(b) { return NV.pdf.aDocumento(b, {imagenes: d.querySelector('#pdI').checked}, function(x, t) { NV.cargando('Convirtiendo… ' + t, x); }); })
      .then(function(r) {
        if (modo === 'docx') { NV.cargando('Creando el archivo de Word…'); return NV.docx.exportar(r.html, r.ajustes, NV.sinExtension(f.name)).then(function(b) { NV.cargando(false); NV.descargar(b, NV.nombreArchivo(NV.sinExtension(f.name), 'docx')); return true; }); }
        NV.cargando('Guardando en Nuvia Office…');
        return NV.crearDesdeHtml(NV.sinExtension(f.name), r.html, r.ajustes).then(function() { NV.cargando(false); NV.backstage.cerrar(); return true; });
      }, function(e) { NV.cargando(false); throw new Error(/password/i.test(e && e.message) ? 'El PDF tiene contraseña.' : 'No se pudo leer el PDF: ' + (e.message || e)); });
  }
  function unirPdf() {
    var html = '<div class="nv-arrastre" tabindex="0" role="button">' + I('document_multiple', 'g') + '<br>Arrastra aquí los PDF o <b>haz clic para elegirlos</b></div><div class="nv-imgs"></div><div class="nv-cuenta" style="font-size:12.5px;color:#605e5c;margin-bottom:10px"></div>' +
      '<div class="nv-campo"><label for="upN">Nombre del PDF</label><input type="text" id="upN" value="PDF unido"></div>';
    var z;
    NV.dialogo({titulo: 'Unir PDF', html: html, ancho: 600, alAbrir: function(d) {
      d.dataset.accept = '.pdf,application/pdf';
      z = zonaArchivos(d, /\.pdf$|application\/pdf/i, true, function() { return '<div style="height:94px;display:grid;place-items:center;color:#c50f1f">' + I('document_pdf', 'g') + '</div>'; });
    }, botones: [{texto: 'Unir y descargar', prim: true, accion: function(d) {
      var fs = z.archivos(); if (fs.length < 2) { NV.toast('Agrega al menos dos PDF.', true); return false; }
      NV.cargando('Uniendo PDF…');
      return NV.pdf.unir(fs).then(function(b) { NV.cargando(false); NV.descargar(b, NV.nombreArchivo(d.querySelector('#upN').value || 'PDF unido', 'pdf')); return true; },
        function(e) { NV.cargando(false); throw new Error('No se pudo unir: ' + (e.message || e)); });
    }}, {texto: 'Cancelar', valor: null}]});
  }

  // ---------- Pantalla de inicio ----------
  NV.inicio = {};
  NV.inicio.mostrar = function(seccion) {
    NV.mostrarVista('inicio');
    document.title = 'Nuvia Office';
    try { history.replaceState(null, '', '/design/office'); } catch (e) {}
    var v = NV.$('#nvVistaInicio');
    v.innerHTML = '<div class="nv-inicio"><nav class="nv-bs-nav" aria-label="Nuvia Office">' +
      '<button type="button" class="volver" data-ir="design" title="Volver a Design">' + I('arrow_left') + '<span>Design</span></button>' +
      '<button type="button" data-s="inicio" class="on">' + I('home') + '<span>Inicio</span></button><button type="button" data-s="nuevo">' + I('document_add') + '<span>Nuevo</span></button>' +
      '<button type="button" data-s="abrir">' + I('folder_open') + '<span>Abrir</span></button><button type="button" data-s="pdf">' + I('document_pdf') + '<span>Herramientas PDF</span></button></nav>' +
      '<div class="nv-bs-c" id="nvInicioC"></div></div>';
    v.querySelector('nav').onclick = function(e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.ir) { location.href = '/design/inicio'; return; }
      NV.$$('button', v.querySelector('nav')).forEach(function(x) { x.classList.toggle('on', x === b); });
      pintarInicio(b.dataset.s);
    };
    pintarInicio(seccion || 'inicio');
  };
  function seccionNuevo(soloWord) {
    return '<div class="nv-plantillas">' + PLANTILLAS.map(function(p) {
      return '<button type="button" class="nv-plantilla" data-plantilla="' + p.id + '"><div class="hoja">' + (p.id === 'blanco' ? '' : miniPlantilla(p)) + '</div><div class="nom">' + esc(p.n) + '</div></button>';
    }).join('') + (soloWord ? '' : '<button type="button" class="nv-plantilla ancha" data-plantilla="ppt" title="Disponible en la fase 2"><div class="hoja" style="background:#fbeee9;color:#c43e1c;font-weight:600">Presentación en blanco<br><small style="font-weight:400">(fase 2)</small></div><div class="nom">Presentación en blanco</div></button>') + '</div>';
  }
  function pintarInicio(s) {
    var c = NV.$('#nvInicioC'), u = NV.usuario || {};
    var saludo = (new Date().getHours() < 12 ? 'Buenos días' : new Date().getHours() < 19 ? 'Buenas tardes' : 'Buenas noches') + (u.nombre ? ', ' + esc(u.nombre.split(' ')[0]) : '');
    if (s === 'nuevo') { c.innerHTML = '<h1>Nuevo</h1>' + seccionNuevo(); conectarPlantillas(c); return; }
    if (s === 'pdf') { c.innerHTML = '<h1>Herramientas PDF</h1>' + herramientasHtml(); conectarHerr(c); return; }
    if (s === 'abrir') {
      c.innerHTML = '<h1>Abrir</h1><div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px"><button type="button" class="nv-btn prim" id="niPC">' + I('folder_open', 'p') + 'Examinar en este equipo</button>' +
        '<input type="search" id="niQ" placeholder="Buscar por nombre" aria-label="Buscar documentos" style="height:32px;border:1px solid #a19f9d;border-radius:4px;padding:0 10px;font:inherit;min-width:240px"></div>' + listaHtml();
      c.querySelector('#niPC').onclick = function() { NV.elegirArchivos(ACEPTA).then(function(fs) { if (fs[0]) NV.abrirDesdePC(fs[0]); }); };
      conectarLista(c); return;
    }
    c.innerHTML = '<h1>' + saludo + '</h1><h2 style="margin-top:0">Nuevo</h2>' + seccionNuevo() +
      '<h2>Herramientas PDF</h2>' + herramientasHtml() +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:28px"><h2 style="margin:0">Documentos</h2><div style="display:flex;gap:8px">' +
      '<input type="search" id="niQ" placeholder="Buscar" aria-label="Buscar documentos" style="height:32px;border:1px solid #a19f9d;border-radius:4px;padding:0 10px;font:inherit">' +
      '<button type="button" class="nv-btn" id="niPC">' + I('folder_open', 'p') + 'Abrir desde el equipo</button></div></div>' + listaHtml();
    conectarPlantillas(c); conectarHerr(c); conectarLista(c);
    c.querySelector('#niPC').onclick = function() { NV.elegirArchivos(ACEPTA).then(function(fs) { if (fs[0]) NV.abrirDesdePC(fs[0]); }); };
    // soltar archivos sobre la pantalla de inicio los abre
    c.ondragover = function(e) { e.preventDefault(); }; c.ondrop = function(e) { e.preventDefault(); var f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) NV.abrirDesdePC(f); };
  }
  function listaHtml() {
    return '<div class="nv-tabs-lista" role="tablist"><button type="button" data-m="mios" class="on">Recientes</button><button type="button" data-m="compartidos">Compartidos conmigo</button><button type="button" data-m="eliminados">Eliminados</button></div><div id="niLista"><div class="nv-vacio">Cargando…</div></div>';
  }
  function conectarLista(c) {
    var cont = c.querySelector('#niLista'), modo = 'mios';
    c.querySelector('.nv-tabs-lista').onclick = function(e) { var b = e.target.closest('button'); if (!b) return; modo = b.dataset.m; NV.$$('button', this).forEach(function(x) { x.classList.toggle('on', x === b); }); pintarLista(cont, modo); };
    var q = c.querySelector('#niQ'); if (q) q.addEventListener('input', function() { cont.dataset.q = q.value; pintarLista(cont, modo); });
    NV.cargarLista().then(function() { pintarLista(cont, modo); }).catch(function(e) { cont.innerHTML = '<p class="nv-vacio">No se pudo cargar la lista: ' + esc(e.message) + '</p>'; });
  }
  function conectarPlantillas(c) {
    NV.$$('[data-plantilla]', c).forEach(function(b) {
      b.onclick = function() { if (b.dataset.plantilla === 'ppt') { NV.alerta('Presentaciones', 'Nuvia PowerPoint llega en la fase 2 de Nuvia Office.'); return; } NV.backstage.cerrar(); NV.nuevoDocumento(b.dataset.plantilla); };
    });
  }
  function conectarHerr(c) { NV.$$('[data-herr]', c).forEach(function(b) { b.onclick = function() { NV.herramienta(b.dataset.herr); }; }); }

  // ---------- Menú Archivo (backstage) ----------
  NV.backstage = {};
  NV.backstage.abrir = function(seccion) {
    if (!W.doc) { NV.inicio.mostrar(); return; }
    W.guardar();
    var bs = document.createElement('div'); bs.className = 'nv-backstage'; bs.id = 'nvBackstage'; bs.setAttribute('role', 'dialog'); bs.setAttribute('aria-label', 'Archivo');
    var dueno = W.doc.permiso === 'dueño';
    bs.innerHTML = '<nav class="nv-bs-nav"><button type="button" class="volver" data-s="cerrar" title="Volver al documento (Esc)">' + I('arrow_left') + '<span>Volver</span></button>' +
      '<button type="button" data-s="inicio">' + I('home') + '<span>Inicio</span></button><button type="button" data-s="nuevo">' + I('document_add') + '<span>Nuevo</span></button>' +
      '<button type="button" data-s="abrir">' + I('folder_open') + '<span>Abrir</span></button><div class="sep"></div>' +
      '<button type="button" data-s="info">' + I('info') + '<span>Información</span></button>' +
      '<button type="button" data-s="copia">' + I('save_copy') + '<span>Guardar una copia</span></button>' +
      '<button type="button" data-s="descargar">' + I('arrow_download') + '<span>Descargar</span></button>' +
      '<button type="button" data-s="exportar">' + I('document_pdf') + '<span>Exportar a PDF</span></button>' +
      '<button type="button" data-s="imprimir">' + I('print') + '<span>Imprimir</span></button>' +
      (dueno ? '<button type="button" data-s="compartir">' + I('share') + '<span>Compartir</span></button>' : '') +
      '<button type="button" data-s="pdf">' + I('wrench') + '<span>Herramientas PDF</span></button>' +
      '<div class="sep"></div><button type="button" data-s="salir" class="abajo">' + I('dismiss') + '<span>Cerrar</span></button></nav><div class="nv-bs-c" id="nvBsC"></div>';
    document.body.appendChild(bs);
    var tecla = function(e) { if (e.key === 'Escape' && !document.querySelector('.nv-fondo-dlg')) { e.preventDefault(); NV.backstage.cerrar(); } };
    document.addEventListener('keydown', tecla);
    bs._tecla = tecla;
    bs.querySelector('nav').onclick = function(e) { var b = e.target.closest('button'); if (b) ir(b.dataset.s); };
    ir(seccion || 'inicio');
  };
  NV.backstage.cerrar = function() {
    var bs = NV.$('#nvBackstage'); if (!bs) return;
    document.removeEventListener('keydown', bs._tecla); bs.remove();
    if (W.ed()) { W.ed().focus(); W.paginar(); }
  };
  function ir(s) {
    var c = NV.$('#nvBsC'); if (!c) return;
    NV.$$('#nvBackstage nav button').forEach(function(b) { b.classList.toggle('on', b.dataset.s === s); });
    if (s === 'cerrar') { NV.backstage.cerrar(); return; }
    if (s === 'salir') { W.guardar().then(function() { NV.backstage.cerrar(); W.doc = null; NV.inicio.mostrar(); }); return; }
    if (s === 'compartir') { NV.compartir(); return; }
    if (s === 'pdf') { c.innerHTML = '<h1>Herramientas PDF</h1>' + herramientasHtml(); conectarHerr(c); return; }
    if (s === 'nuevo') { c.innerHTML = '<h1>Nuevo</h1>' + seccionNuevo(); conectarPlantillas(c); return; }
    if (s === 'imprimir') { vistaImpresion(c); return; }
    if (s === 'abrir') {
      c.innerHTML = '<h1>Abrir</h1><div style="display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap"><button type="button" class="nv-btn prim" id="nbPC">' + I('folder_open', 'p') + 'Examinar en este equipo</button>' +
        '<input type="search" id="niQ" placeholder="Buscar por nombre" aria-label="Buscar documentos" style="height:32px;border:1px solid #a19f9d;border-radius:4px;padding:0 10px;font:inherit;min-width:240px"></div>' + listaHtml();
      c.querySelector('#nbPC').onclick = function() { NV.elegirArchivos(ACEPTA).then(function(fs) { if (fs[0]) NV.abrirDesdePC(fs[0]); }); };
      conectarLista(c); return;
    }
    if (s === 'copia') {
      c.innerHTML = '<h1>Guardar una copia</h1><div class="nv-campo" style="max-width:420px"><label for="nbCT">Nombre de la copia</label><input type="text" id="nbCT" value="Copia de ' + esc(W.doc.titulo) + '"></div>' +
        '<button type="button" class="nv-btn prim" id="nbCG">' + I('save_copy', 'p') + 'Guardar copia en Nuvia Office</button>' +
        '<h2>O descárgala a tu equipo</h2><div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" class="nv-btn" data-d="docx">Word (.docx)</button><button type="button" class="nv-btn" data-d="pdf">PDF</button></div>';
      c.querySelector('#nbCG').onclick = function() {
        var t = c.querySelector('#nbCT').value.trim() || 'Copia';
        NV.cargando('Guardando copia…');
        NV.api('/design/api/office/docs', {json: {tipo: 'word', titulo: t, contenido: W.contenidoLimpio(), ajustes: W.aj}}).then(function(d) { NV.cargando(false); NV.backstage.cerrar(); return W.abrir(d); })
          .then(function() { NV.toast('Copia guardada. Ahora estás editando la copia.'); }).catch(function(e) { NV.cargando(false); NV.toast(e.message, true); });
      };
      NV.$$('[data-d]', c).forEach(function(b) { b.onclick = function() { NV.descargarActual(b.dataset.d); }; });
      return;
    }
    if (s === 'descargar' || s === 'exportar') {
      var op = s === 'exportar' ? [['pdf', 'document_pdf', 'Exportar a PDF', 'Documento PDF con el mismo diseño, texto seleccionable, encabezado, pie y números de página.']] :
        [['docx', 'document', 'Documento de Word (.docx)', 'Se abre en Microsoft Word con sus estilos, tablas, imágenes, encabezado, pie y notas al pie.'],
         ['pdf', 'document_pdf', 'Documento PDF (.pdf)', 'Para enviar o imprimir; nadie puede modificarlo fácilmente.'],
         ['html', 'globe', 'Página web (.html)', 'Para publicar en una página web o abrir en el navegador.'],
         ['txt', 'text_t', 'Texto sin formato (.txt)', 'Solo el texto, sin formato.']];
      c.innerHTML = '<h1>' + (s === 'exportar' ? 'Exportar' : 'Descargar') + '</h1><div style="display:flex;flex-direction:column;gap:10px;max-width:640px">' + op.map(function(o) {
        return '<button type="button" class="nv-herr" data-d="' + o[0] + '"><span class="ic" style="background:' + (o[0] === 'pdf' ? '#c50f1f' : o[0] === 'docx' ? '#185abd' : '#605e5c') + '">' + I(o[1]) + '</span><span><b>' + esc(o[2]) + '</b><span>' + esc(o[3]) + '</span></span></button>';
      }).join('') + '</div>';
      NV.$$('[data-d]', c).forEach(function(b) { b.onclick = function() { NV.descargarActual(b.dataset.d); }; });
      return;
    }
    if (s === 'info') {
      var cnt = W.contar(), d = W.doc;
      c.innerHTML = '<h1>Información</h1><div style="display:flex;gap:40px;flex-wrap:wrap"><div style="flex:1;min-width:300px">' +
        '<h2 style="margin-top:0">' + esc(d.titulo) + '</h2><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px">' +
        (d.permiso !== 'ver' ? '<button type="button" class="nv-btn" id="nbRen">' + I('rename', 'p') + 'Cambiar nombre</button>' : '') +
        (d.permiso === 'dueño' ? '<button type="button" class="nv-btn" id="nbComp">' + I('share', 'p') + 'Compartir</button>' : '') + '</div>' +
        '<p style="line-height:1.6;font-size:13.5px;color:#605e5c">' + (d.permiso === 'dueño' ? 'Eres el dueño de este documento.' : d.permiso === 'editar' ? esc(d.propietario) + ' compartió este documento contigo y puedes editarlo.' : esc(d.propietario) + ' compartió este documento contigo en modo de solo lectura.') +
        ' Los cambios se guardan automáticamente en Nuvia Office.</p></div>' +
        '<div style="min-width:280px"><h2 style="margin-top:0">Propiedades</h2><table class="nv-info-tabla">' +
        '<tr><td>Tamaño</td><td>' + NV.tamano(d.tamano) + '</td></tr><tr><td>Páginas</td><td>' + cnt.paginas + '</td></tr><tr><td>Palabras</td><td>' + cnt.palabras.toLocaleString('es-CO') + '</td></tr>' +
        '<tr><td>Caracteres</td><td>' + cnt.caracteres.toLocaleString('es-CO') + '</td></tr><tr><td>Tamaño de página</td><td>' + esc((W.TAMANOS[W.aj.pagina.tam] || {n: 'Personalizado'}).n) + (W.aj.pagina.orient === 'h' ? ' · horizontal' : ' · vertical') + '</td></tr>' +
        '<tr><td>Idioma</td><td>' + esc(W.nombreIdioma(W.aj.idioma)) + '</td></tr><tr><td>Creado</td><td>' + new Date(d.creadoEn).toLocaleString('es-CO') + '</td></tr>' +
        '<tr><td>Última modificación</td><td>' + new Date(d.actualizadoEn).toLocaleString('es-CO') + '</td></tr><tr><td>Modificado por</td><td>' + esc(d.actualizadoPor || '') + '</td></tr>' +
        '<tr><td>Dueño</td><td>' + esc(d.propietario) + '</td></tr></table></div></div>';
      var ren = c.querySelector('#nbRen'); if (ren) ren.onclick = function() { W.renombrar().then(function() { ir('info'); }); };
      var cp = c.querySelector('#nbComp'); if (cp) cp.onclick = function() { NV.compartir(); };
      return;
    }
    // inicio dentro del documento
    c.innerHTML = '<h1>' + esc(saludoCorto()) + '</h1><h2 style="margin-top:0">Nuevo</h2>' + seccionNuevo() + '<h2>Documentos</h2>' + listaHtml();
    conectarPlantillas(c); conectarLista(c);
  }
  function saludoCorto() { var h = new Date().getHours(); return (h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches') + (NV.usuario && NV.usuario.nombre ? ', ' + NV.usuario.nombre.split(' ')[0] : ''); }
  W.renombrar = function() {
    if (!W.doc || W.est.soloLectura) return Promise.resolve();
    return NV.preguntar('Cambiar nombre', 'Nombre del documento:', W.doc.titulo).then(function(t) {
      t = (t || '').trim(); if (!t || t === W.doc.titulo) return;
      W.doc.titulo = t; NV.$('#nvDocTitulo').textContent = t; document.title = t + ' - Nuvia Word';
      W.est.guardado = false; return W.guardar();
    });
  };
})();
