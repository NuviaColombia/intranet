/* Nuvia Office: plantillas de la organización (Word y PowerPoint). Las cargan, editan y borran los admins; todos las usan.
   Al cargar una plantilla se detectan las fechas escritas para que queden como campo "Fecha de hoy". */
(function() {
  'use strict';
  var NV = window.NV, W = NV.word, P = NV.ppt, esc = NV.esc, I = NV.icono;
  var T = NV.plantillas = {lista: [], admin: false, cargada: false};

  T.cargarLista = function() {
    return NV.api('/design/api/office/plantillas').then(function(r) { T.lista = r.plantillas || []; T.admin = !!r.puedeAdministrar; T.cargada = true; return T.lista; });
  };
  // Galería de plantillas (para Nuevo / Inicio). tipo: 'word' | 'ppt' | null (todas)
  T.galeria = function(cont, tipo) {
    var pintar = function() {
      var lista = T.lista.filter(function(p) { return !tipo || p.tipo === tipo; });
      var h = '<div class="nv-plantillas">';
      lista.forEach(function(p) {
        var ancha = p.tipo === 'ppt';
        h += '<div class="nv-plantilla' + (ancha ? ' ancha' : '') + ' org" data-pl="' + p.id + '" role="button" tabindex="0" title="' + esc(p.descripcion || p.titulo) + '"><div class="hoja">' +
          (p.miniatura ? '<img src="' + p.miniatura + '" alt="" style="width:100%;height:100%;object-fit:cover">' : '<span style="color:' + (ancha ? '#c43e1c' : '#185abd') + ';font-weight:700;font-size:28px">' + (ancha ? 'P' : 'W') + '</span>') +
          '<span class="nv-pl-tipo" style="background:' + (ancha ? '#c43e1c' : '#185abd') + '">' + (ancha ? 'P' : 'W') + '</span>' +
          (T.admin ? '<button type="button" class="nv-pl-menu" data-plmenu="' + p.id + '" aria-label="Opciones de la plantilla ' + esc(p.titulo) + '" title="Opciones">⋯</button>' : '') +
          '</div><div class="nom">' + esc(p.titulo) + '</div></div>';
      });
      if (T.admin) h += '<button type="button" class="nv-plantilla nueva-pl' + (tipo === 'ppt' ? ' ancha' : '') + '" data-plcargar="1" title="Cargar una plantilla (.docx, .dotx, .pptx, .potx)"><div class="hoja" style="border-style:dashed;flex-direction:column;gap:6px;color:#605e5c">' +
        I('add_circle', 'g') + '<span style="font-size:12px">Cargar plantilla</span></div><div class="nom">Cargar plantilla…</div></button>';
      if (!lista.length && !T.admin) h += '<p class="nv-vacio">Todavía no hay plantillas de la organización. Un administrador las puede cargar.</p>';
      cont.innerHTML = h + '</div>';
    };
    cont.onclick = function(e) {
      var m = e.target.closest('[data-plmenu]'); if (m) { e.stopPropagation(); menu(m, +m.dataset.plmenu, function() { T.cargarLista().then(pintar); }); return; }
      if (e.target.closest('[data-plcargar]')) { T.cargar().then(function(ok) { if (ok) T.cargarLista().then(pintar); }); return; }
      var c = e.target.closest('[data-pl]'); if (c) T.usar(+c.dataset.pl);
    };
    cont.onkeydown = function(e) { if (e.key === 'Enter' && e.target.matches('[data-pl]')) e.target.click(); };
    if (T.cargada) pintar(); else { cont.innerHTML = '<p class="nv-vacio">Cargando plantillas…</p>'; T.cargarLista().then(pintar).catch(function(er) { cont.innerHTML = '<p class="nv-vacio">' + esc(er.message) + '</p>'; }); }
  };
  function menu(b, id, refrescar) {
    var p = T.lista.filter(function(x) { return x.id === id; })[0]; if (!p) return;
    NV.menu(b, [{texto: 'Crear ' + (p.tipo === 'ppt' ? 'presentación' : 'documento') + ' con esta plantilla', icono: 'document_add', accion: function() { T.usar(id); }},
      {sep: true}, {texto: 'Editar plantilla', icono: 'edit', accion: function() { NV.backstage.cerrar(); T.editar(id); }},
      {texto: 'Cambiar nombre y descripción', icono: 'rename', accion: function() { renombrar(p, refrescar); }},
      {texto: 'Descargar (' + (p.tipo === 'ppt' ? '.pptx' : '.docx') + ')', icono: 'arrow_download', accion: function() { descargar(id); }},
      {sep: true}, {texto: 'Eliminar plantilla', icono: 'delete', accion: function() {
        NV.confirmar('Eliminar plantilla', '¿Eliminar la plantilla "' + p.titulo + '"? Los documentos que ya se crearon con ella no cambian.', 'Eliminar').then(function(ok) {
          if (ok) NV.api('/design/api/office/plantillas/' + id + '/eliminar', {json: {}}).then(function() { NV.toast('Plantilla eliminada.'); refrescar(); }).catch(function(e) { NV.toast(e.message, true); });
        });
      }}], {ancho: 280});
  }
  function renombrar(p, refrescar) {
    NV.dialogo({titulo: 'Plantilla', ancho: 440, html: '<div class="nv-campo"><label for="plN">Nombre</label><input type="text" id="plN" value="' + esc(p.titulo) + '" maxlength="255"></div>' +
      '<div class="nv-campo"><label for="plD">Descripción (opcional)</label><textarea id="plD" maxlength="500">' + esc(p.descripcion || '') + '</textarea></div>',
      botones: [{texto: 'Guardar', prim: true, accion: function(d) {
        return NV.api('/design/api/office/plantillas/' + p.id, {json: {version: p.version, titulo: d.querySelector('#plN').value, descripcion: d.querySelector('#plD').value}})
          .then(function() { refrescar(); return true; });
      }}, {texto: 'Cancelar', valor: null}]});
  }
  function descargar(id) {
    NV.cargando('Preparando descarga…');
    NV.api('/design/api/office/plantillas/' + id).then(function(p) {
      if (p.tipo === 'ppt') return P.pptx.exportar(JSON.parse(p.contenido), p.titulo).then(function(b) { NV.descargar(b, NV.nombreArchivo(p.titulo, 'pptx')); });
      var aj = Object.assign(W.ajustesPredeterminados(), p.ajustes || {});
      return NV.docx.exportar(p.contenido, aj, p.titulo).then(function(b) { NV.descargar(b, NV.nombreArchivo(p.titulo, 'docx')); });
    }).then(function() { NV.cargando(false); }).catch(function(e) { NV.cargando(false); NV.toast(e.message, true); });
  }
  T.usar = function(id) {
    NV.cargando('Creando a partir de la plantilla…');
    var antes = W.doc && !W.est.guardado ? W.guardar() : P.doc && !P.est.guardado ? P.guardar() : Promise.resolve();
    return antes.then(function() { return NV.api('/design/api/office/plantillas/' + id + '/usar', {json: {}}); })
      .then(function(d) { NV.cargando(false); NV.backstage.cerrar(); return NV.abrirDocumento(d); })
      .catch(function(e) { NV.cargando(false); NV.toast(e.message, true); });
  };
  T.editar = function(id) {
    NV.cargando('Abriendo plantilla…');
    return NV.api('/design/api/office/plantillas/' + id).then(function(p) {
      NV.cargando(false);
      p.esPlantilla = true;
      return p.tipo === 'ppt' ? P.abrir(p) : W.abrir(p);
    }).catch(function(e) { NV.cargando(false); NV.toast(e.message, true); });
  };

  // ---------- Cargar una plantilla desde un archivo ----------
  T.cargar = function() {
    return NV.elegirArchivos('.docx,.dotx,.docm,.pptx,.potx,.pptm').then(function(fs) {
      var f = fs[0]; if (!f) return false;
      var ext = NV.extension(f.name), esPpt = /^p/.test(ext), titulo = NV.sinExtension(f.name);
      NV.cargando('Leyendo la plantilla…');
      return NV.leerArchivo(f).then(function(buf) {
        return esPpt ? P.pptx.importar(buf, function(x, t) { NV.cargando('Leyendo la plantilla… ' + t, x); }).then(function(pres) { return {tipo: 'ppt', pres: pres}; })
                     : NV.docx.importar(buf).then(function(r) { return {tipo: 'word', html: r.html, ajustes: r.ajustes}; });
      }).then(function(r) {
        NV.cargando(false);
        return elegirFechas(r).then(function() {
          return NV.dialogo({titulo: 'Nueva plantilla', ancho: 440, html: '<div class="nv-campo"><label for="plN">Nombre de la plantilla</label><input type="text" id="plN" value="' + esc(titulo) + '" maxlength="255"></div>' +
            '<div class="nv-campo"><label for="plD">Descripción (opcional)</label><textarea id="plD" maxlength="500" placeholder="Para qué sirve esta plantilla"></textarea></div>',
            botones: [{texto: 'Guardar plantilla', prim: true, accion: function(d) { return {t: d.querySelector('#plN').value.trim() || titulo, d: d.querySelector('#plD').value}; }}, {texto: 'Cancelar', valor: null}]});
        }).then(function(info) {
          if (!info) return false;
          NV.cargando('Guardando la plantilla…');
          return miniatura(r).then(function(m) {
            var cuerpo = r.tipo === 'ppt' ? {tipo: 'ppt', titulo: info.t, descripcion: info.d, contenido: JSON.stringify(r.pres), ajustes: {tipo: 'ppt'}, miniatura: m || ''}
                                          : {tipo: 'word', titulo: info.t, descripcion: info.d, contenido: r.html, ajustes: r.ajustes, miniatura: m || ''};
            return NV.api('/design/api/office/plantillas', {json: cuerpo});
          }).then(function() { NV.cargando(false); NV.toast('Plantilla "' + info.t + '" guardada. Ya la pueden usar todos.'); return true; });
        });
      }).catch(function(e) { NV.cargando(false); NV.toast('No se pudo cargar la plantilla: ' + (e.message || e), true); return false; });
    });
  };
  // Muestra las fechas encontradas y convierte en campo "Fecha de hoy" las elegidas.
  function elegirFechas(r) {
    if (r.tipo === 'ppt') {
      var lista = P.pptx.buscarFechas(r.pres);
      return NV.fechas.elegir(lista).then(function(sel) { P.pptx.convertirFechas(lista, sel); });
    }
    var zonas = [{clave: 'html'}, {clave: 'encabezado', aj: true}, {clave: 'pie', aj: true}].map(function(z) {
      var d = document.createElement('div'); d.innerHTML = z.aj ? (r.ajustes[z.clave] || '') : r.html; z.div = d; z.fechas = NV.fechas.buscar(d); return z;
    });
    var todas = []; zonas.forEach(function(z) { z.fechas.forEach(function(f) { todas.push({z: z, f: f, texto: f.texto, contexto: ({html: '', encabezado: 'Encabezado: ', pie: 'Pie de página: '})[z.clave] + NV.fechas.contexto(f)}); }); });
    return NV.fechas.elegir(todas).then(function(sel) {
      zonas.forEach(function(z) {
        var idx = []; todas.forEach(function(t, i) { if (t.z === z && sel.indexOf(i) >= 0) idx.push(z.fechas.indexOf(t.f)); });
        if (!idx.length) return;
        NV.fechas.convertir(z.div, z.fechas, idx);
        if (z.aj) r.ajustes[z.clave] = z.div.innerHTML; else r.html = z.div.innerHTML;
      });
    });
  }
  // Imagen pequeña de la primera página / diapositiva
  function miniatura(r) {
    if (r.tipo === 'ppt') {
      var antes = P.pres; P.pres = r.pres;
      return P.show.miniatura(0).then(function(m) { P.pres = antes; return m; }, function() { P.pres = antes; return null; });
    }
    return T.miniaturaWord(r.html, r.ajustes);
  }
  T.miniaturaWord = function(html, aj) {
    return NV.lib.html2canvas().then(function(h2c) {
      var antesAj = W.aj; W.aj = Object.assign(W.ajustesPredeterminados(), aj || {});
      var d = W.dim(), host = document.createElement('div'); host.style.cssText = 'position:fixed;left:-20000px;top:0';
      var hoja = document.createElement('div'); hoja.className = 'nv-mini-doc';
      hoja.style.cssText = 'width:' + d.w + 'cm;height:' + d.h + 'cm;padding:' + d.m.sup + 'cm ' + d.m.der + 'cm 0 ' + d.m.izq + 'cm;box-sizing:border-box;background:#fff;overflow:hidden';
      var css = document.createElement('style'); css.textContent = W.cssDocumento().replace(/(^|\})\s*([^{}@]+)\{/g, function(m, a, sel) { return a + sel.split(',').map(function(s) { return '.nv-mini-doc ' + (s.trim() === 'body' ? '' : s.trim()); }).join(',') + '{'; });
      hoja.innerHTML = NV.fechas.actualizarHtml(html || '');
      host.appendChild(css); host.appendChild(hoja); document.body.appendChild(host);
      W.aj = antesAj;
      return (document.fonts && document.fonts.ready || Promise.resolve()).then(function() { return h2c(hoja, {scale: 0.35, backgroundColor: '#ffffff', logging: false, useCORS: true}); })
        .then(function(c) { host.remove(); return c.toDataURL('image/jpeg', 0.8); }, function() { host.remove(); return null; });
    }).catch(function() { return null; });
  };
  // Guardar el documento o presentación actual como plantilla (admins)
  T.guardarComo = function() {
    var esPpt = NV.vistaActual === 'ppt', doc = esPpt ? P.doc : W.doc; if (!doc) return;
    NV.dialogo({titulo: 'Guardar como plantilla', ancho: 440, html: '<div class="nv-campo"><label for="plN">Nombre de la plantilla</label><input type="text" id="plN" value="' + esc(doc.titulo) + '"></div>' +
      '<div class="nv-campo"><label for="plD">Descripción (opcional)</label><textarea id="plD"></textarea></div>' +
      '<label class="nv-chk"><input type="checkbox" id="plF" checked> Convertir las fechas escritas en "Fecha de hoy"</label>',
      botones: [{texto: 'Guardar plantilla', prim: true, accion: function(d) {
        var r = esPpt ? {tipo: 'ppt', pres: JSON.parse(JSON.stringify(P.pres))} : {tipo: 'word', html: W.contenidoLimpio(), ajustes: JSON.parse(JSON.stringify(W.aj))};
        var conv = d.querySelector('#plF').checked ? elegirFechas(r) : Promise.resolve();
        var t = d.querySelector('#plN').value.trim() || doc.titulo, ds = d.querySelector('#plD').value;
        return conv.then(function() { return miniatura(r); }).then(function(m) {
          return NV.api('/design/api/office/plantillas', {json: esPpt ? {tipo: 'ppt', titulo: t, descripcion: ds, contenido: JSON.stringify(r.pres), ajustes: {tipo: 'ppt'}, miniatura: m || ''} :
            {tipo: 'word', titulo: t, descripcion: ds, contenido: r.html, ajustes: r.ajustes, miniatura: m || ''}});
        }).then(function() { T.cargada = false; NV.toast('Plantilla "' + t + '" guardada.'); return true; });
      }}, {texto: 'Cancelar', valor: null}]});
  };
})();
