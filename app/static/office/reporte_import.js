/* Nuvia Office: reporte de importación. Al abrir un .docx/.pptx (o cargarlo como plantilla) se revisa el archivo por
   dentro y se muestra lo que Nuvia Office todavía no carga igual, con un botón para copiar el mensaje. */
(function() {
  'use strict';
  var NV = window.NV, esc = NV.esc;
  var R = NV.reporte = {};

  function contar(txt, re) { var m = txt.match(re); return m ? m.length : 0; }
  function leerTodo(zip, filtro) {
    var nombres = Object.keys(zip.files).filter(function(n) { return !zip.files[n].dir && filtro.test(n); });
    return Promise.all(nombres.map(function(n) { return zip.file(n).async('string').then(function(t) { return {n: n, t: t}; }); }));
  }
  function fuentesNoDisponibles(textos) {
    var vistas = {}, faltan = [];
    // solo las fuentes que se usan en el texto (Word: w:rFonts; tema y PowerPoint: <a:latin>), no las de respaldo para otros idiomas
    textos.forEach(function(t) { var re = /(?:<w:rFonts[^>]*?w:(?:ascii|hAnsi)|<a:latin[^>]*?typeface)="([^"+][^"]*)"/g, m; while ((m = re.exec(t))) vistas[m[1]] = 1; });
    Object.keys(vistas).forEach(function(f) {
      if (/^(\+|Symbol$|Wingdings|Webdings|MS Mincho|SimSun|Mangal|Times$|Courier$)/i.test(f)) return;
      if (!NV.fuentePorNombre(f)) faltan.push(f);
    });
    return faltan.sort();
  }

  // ---------- Word ----------
  R.docx = function(buffer) {
    return NV.lib.jszip().then(function(JSZip) { return JSZip.loadAsync(buffer); }).then(function(zip) {
      return leerTodo(zip, /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments|styles|settings|fontTable)\.xml$|^word\/theme\/theme\d*\.xml$/).then(function(arch) {
        var por = {}; arch.forEach(function(a) { por[a.n] = a.t; });
        var cuerpo = arch.filter(function(a) { return /document|header|footer|footnotes|endnotes/.test(a.n); }).map(function(a) { return a.t; }).join('');
        var L = [], add = function(c, que, nota) { if (c) L.push({que: que, cantidad: c, nota: nota}); };
        add(contar(cuerpo, /<c:chart\b/g), 'Gráficos de Excel', 'No se cargan. En Nuvia se pueden volver a crear con Insertar › Gráfico.');
        add(contar(cuerpo, /<dgm:relIds\b/g), 'SmartArt', 'No se carga (ni su texto).');
        add(contar(cuerpo, /<m:oMath\b/g), 'Ecuaciones', 'Pueden verse como texto simple o no aparecer.');
        add(contar(cuerpo, /<(wps:txbx|v:textbox)\b/g), 'Cuadros de texto y formas con texto', 'El texto se pasa como párrafos normales; se pierde la forma y su posición.');
        add(contar(cuerpo, /<wps:wsp\b/g) - contar(cuerpo, /<wps:txbx\b/g), 'Formas (flechas, rectángulos, líneas…)', 'Pueden no aparecer o verse distinto.');
        add(contar(cuerpo, /<wp:anchor\b/g), 'Imágenes u objetos flotantes (con ajuste de texto)', 'Se colocan dentro del texto; puede cambiar su posición.');
        add(contar(cuerpo, /<w:sdt>/g) + contar(cuerpo, /<w:sdt\s/g), 'Controles de contenido (casillas, listas, fechas para llenar)', 'Quedan como texto normal, sin la casilla o lista.');
        add(contar(cuerpo, /<w:ffData\b/g), 'Campos de formulario antiguos', 'Quedan como texto normal.');
        add(contar(cuerpo, /<w:(object|pict)\b[^>]*>(?:(?!<\/w:(object|pict)>)[\s\S])*o:OLEObject/g), 'Objetos incrustados (hojas de Excel, archivos)', 'No se cargan; puede quedar solo una imagen.');
        add(contar(cuerpo, /<w:(ins|del)\s/g), 'Control de cambios (texto insertado o borrado sin aceptar)', 'Se pierden las marcas de cambios.');
        add(contar(por['word/comments.xml'] || '', /<w:comment\s/g), 'Comentarios', 'No se cargan.');
        var notasFin = contar(por['word/endnotes.xml'] || '', /<w:endnote\s/g) - contar(por['word/endnotes.xml'] || '', /w:type="(separator|continuationSeparator)"/g);
        add(Math.max(0, notasFin), 'Notas al final del documento', 'Se cargan como texto al final; no quedan vinculadas.');
        var secciones = contar(por['word/document.xml'] || '', /<w:sectPr\b/g);
        if (secciones > 1) add(secciones, 'Secciones con distinto formato de página', 'Nuvia usa un solo formato de página (el de la primera sección); cambian orientación o márgenes distintos.');
        add(contar(por['word/document.xml'] || '', /<w:cols\b[^>]*w:num="[2-9]"/g), 'Texto en columnas por sección', 'Puede quedar en una sola columna.');
        if (/<w:evenAndOddHeaders(?![^>]*w:val="(false|0|off)")[^>]*>/.test(por['word/settings.xml'] || '')) add(1, 'Encabezados distintos en páginas pares e impares', 'Se usa un solo encabezado y pie.');
        add(contar(cuerpo, /<w:lnNumType\b/g), 'Numeración de líneas', 'No se muestra.');
        add(contar(cuerpo, /w:dropCap="(drop|margin)"/g), 'Letra capital', 'Queda como letra normal.');
        // campos de Word que Nuvia no actualiza
        var campos = {}, re = /(?:<w:instrText[^>]*>|w:instr=")\s*([A-Z]+)/g, m;
        while ((m = re.exec(cuerpo))) if (!/^(PAGE|NUMPAGES|DATE|TIME|HYPERLINK|SECTIONPAGES|CREATEDATE|SAVEDATE|PRINTDATE)$/.test(m[1])) campos[m[1]] = (campos[m[1]] || 0) + 1;
        Object.keys(campos).forEach(function(k) {
          add(campos[k], 'Campo de Word ' + k, {TOC: 'La tabla de contenido queda como texto fijo; vuelve a insertarla en Nuvia (Referencias › Tabla de contenido) para que se actualice.',
            MERGEFIELD: 'Los campos de combinar correspondencia quedan como texto.', REF: 'Las referencias cruzadas quedan como texto fijo.', SEQ: 'La numeración de figuras/tablas queda fija.',
            FORMTEXT: 'Queda como texto normal.', FORMCHECKBOX: 'La casilla queda como texto.'}[k] || 'Queda con el último valor, como texto fijo.');
        });
        if (Object.keys(zip.files).some(function(n) { return /vbaProject\.bin$/i.test(n); })) add(1, 'Macros (VBA)', 'No se cargan ni se ejecutan.');
        var faltan = fuentesNoDisponibles(arch.filter(function(a) { return /document|styles|header|footer|theme/.test(a.n); }).map(function(a) { return a.t; }));
        if (faltan.length) L.push({que: 'Fuentes que no tiene Nuvia: ' + faltan.join(', '), cantidad: faltan.length, nota: 'Se muestran con una fuente parecida.'});
        return L;
      });
    }).catch(function() { return []; });
  };

  // ---------- PowerPoint ----------
  R.pptx = function(buffer) {
    return NV.lib.jszip().then(function(JSZip) { return JSZip.loadAsync(buffer); }).then(function(zip) {
      return leerTodo(zip, /^ppt\/(slides\/slide\d+|slideLayouts\/slideLayout\d+|slideMasters\/slideMaster\d+|presentation|theme\/theme\d+|charts\/chart\d+)\.xml$/).then(function(arch) {
        var dia = arch.filter(function(a) { return /slides\/slide/.test(a.n); }), txt = dia.map(function(a) { return a.t; }).join(''), todo = arch.map(function(a) { return a.t; }).join('');
        var pres = (arch.filter(function(a) { return a.n === 'ppt/presentation.xml'; })[0] || {}).t || '';
        var L = [], add = function(c, que, nota) { if (c) L.push({que: que, cantidad: c, nota: nota}); };
        add(contar(txt, /drawingml\/2006\/diagram"/g), 'SmartArt', 'No se carga.');
        add(contar(txt, /<(a:videoFile|p14:media|a:audioFile|a:wavAudioFile)\b/g), 'Videos o audios', 'No se cargan; puede quedar solo la imagen de portada.');
        add(contar(txt, /<p:oleObj\b/g), 'Objetos incrustados (Excel, archivos)', 'No se cargan; puede quedar solo una imagen.');
        add(contar(txt, /<(m:oMath|a14:m)\b/g), 'Ecuaciones', 'Pueden no aparecer.');
        add(dia.filter(function(a) { return /<p:timing\b[\s\S]*?<p:(anim|animEffect|animMotion|set)\b/.test(a.t); }).length, 'Diapositivas con animaciones', 'Las animaciones no se cargan (sí las transiciones). Puedes volver a ponerlas en Animaciones.');
        add(contar(txt, /<a:custGeom\b/g), 'Formas personalizadas (dibujadas a mano o editadas por puntos)', 'Se dibujan como rectángulo.');
        var geom = P_GEOM(), raras = {};
        var re = /<a:prstGeom prst="([^"]+)"/g, m; while ((m = re.exec(txt))) if (!geom[m[1]] && m[1] !== 'line' && !/Connector|line/i.test(m[1])) raras[m[1]] = (raras[m[1]] || 0) + 1;
        var nRaras = Object.keys(raras).reduce(function(a, k) { return a + raras[k]; }, 0);
        if (nRaras) L.push({que: 'Formas que no tiene Nuvia: ' + Object.keys(raras).join(', '), cantidad: nRaras, nota: 'Se dibujan como rectángulo.'});
        add(contar(txt, /<a:(scene3d|sp3d)\b/g), 'Efectos 3D', 'Se muestran planos.');
        add(contar(txt, /<a:(reflection|glow|softEdge)\b/g), 'Efectos de reflejo, iluminado o bordes suaves', 'No se muestran.');
        add(contar(txt, /<a:pattFill\b/g), 'Rellenos con trama', 'Se usa un color sólido.');
        var tiposG = {};
        arch.filter(function(a) { return /charts\/chart/.test(a.n); }).forEach(function(a) { var mm = a.t.match(/<c:(scatterChart|radarChart|bubbleChart|stockChart|surfaceChart|surface3DChart|ofPieChart)\b/g); (mm || []).forEach(function(x) { var k = x.slice(3); tiposG[k] = (tiposG[k] || 0) + 1; }); });
        Object.keys(tiposG).forEach(function(k) { add(tiposG[k], 'Gráfico tipo ' + {scatterChart: 'dispersión', radarChart: 'radial', bubbleChart: 'burbujas', stockChart: 'cotizaciones', surfaceChart: 'superficie', surface3DChart: 'superficie 3D', ofPieChart: 'circular con subgráfico'}[k], 'Se convierte a columnas.'); });
        if (/<p14:sectionLst\b/.test(pres)) add(1, 'Secciones de diapositivas', 'Las diapositivas se cargan sin las secciones.');
        add(Object.keys(zip.files).filter(function(n) { return /^ppt\/comments\/|^ppt\/comments\/modernComment/.test(n); }).length, 'Comentarios', 'No se cargan.');
        if (/<p:embeddedFontLst\b/.test(pres)) add(1, 'Fuentes incrustadas en el archivo', 'Se usan fuentes parecidas.');
        if (Object.keys(zip.files).some(function(n) { return /vbaProject\.bin$/i.test(n); })) add(1, 'Macros (VBA)', 'No se cargan ni se ejecutan.');
        var faltan = fuentesNoDisponibles([todo]);
        if (faltan.length) L.push({que: 'Fuentes que no tiene Nuvia: ' + faltan.join(', '), cantidad: faltan.length, nota: 'Se muestran con una fuente parecida.'});
        return L;
      });
    }).catch(function() { return []; });
  };
  function P_GEOM() { return (NV.ppt && NV.ppt.pptx && NV.ppt.pptx.GEOM) || {}; }

  // ---------- Mensaje ----------
  R.mostrar = function(nombre, lista) {
    if (!lista || !lista.length) return Promise.resolve();
    var texto = 'Nuvia Office — reporte al abrir "' + nombre + '" (' + new Date().toLocaleString('es-CO') + ')\n' +
      lista.map(function(x) { return '• ' + x.que + (x.cantidad > 1 ? ' (' + x.cantidad + ')' : '') + ': ' + x.nota; }).join('\n');
    var html = '<p style="margin-top:0;line-height:1.5">El archivo se abrió, pero tiene cosas que Nuvia Office todavía no carga igual que el original. ' +
      'Copia este mensaje y envíalo para agregarlas a Nuvia Office.</p>' +
      '<div style="max-height:320px;overflow:auto;border:1px solid #e1dfdd;border-radius:6px"><table class="nv-info-tabla" style="width:100%;margin:0"><thead><tr><th style="text-align:left">Qué</th><th>Cant.</th><th style="text-align:left">Qué pasa en Nuvia</th></tr></thead><tbody>' +
      lista.map(function(x) { return '<tr><td><b>' + esc(x.que) + '</b></td><td style="text-align:center">' + x.cantidad + '</td><td>' + esc(x.nota) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    return NV.dialogo({titulo: 'Algunas cosas no se cargaron igual', ancho: 720, html: html, botones: [
      {texto: 'Copiar mensaje', accion: function(d) {
        var listo = function() { var b = d.querySelector('.nv-btn'); NV.toast('Mensaje copiado. Pégalo donde lo vayas a enviar.'); return false; };
        try { navigator.clipboard.writeText(texto).then(listo, function() { R.copiarRespaldo(texto); listo(); }); } catch (e) { R.copiarRespaldo(texto); listo(); }
        return false;
      }},
      {texto: 'Entendido', prim: true, valor: true}]});
  };
  R.copiarRespaldo = function(t) { var a = document.createElement('textarea'); a.value = t; a.style.cssText = 'position:fixed;left:-9999px'; document.body.appendChild(a); a.select(); try { document.execCommand('copy'); } catch (e) {} a.remove(); };
  // Analiza y muestra (no detiene la apertura si algo falla)
  R.revisar = function(buffer, ext, nombre) {
    var f = /^(pptx|potx|ppsx|pptm)$/.test(ext) ? R.pptx : /^(docx|docm|dotx)$/.test(ext) ? R.docx : null;
    if (!f) return Promise.resolve();
    return f(buffer).then(function(l) { return R.mostrar(nombre, l); }).catch(function() {});
  };
})();
