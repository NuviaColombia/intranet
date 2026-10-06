/* Nuvia Office: arranque y controles fijos (barra de título, búsqueda de comandos, barra de estado). */
(function() {
  'use strict';
  var NV = window.NV, W = NV.word, I = NV.icono;

  function iconos() {
    NV.$('#nvGuardar').innerHTML = I('save'); NV.$('#nvDeshacer').innerHTML = I('arrow_undo'); NV.$('#nvRehacer').innerHTML = I('arrow_redo');
    NV.$('#nvCompartir').innerHTML = I('share', 'p') + 'Compartir'; NV.$('#nvLupa').innerHTML = I('search', 'p'); NV.$('#nvCerrarNav').innerHTML = I('dismiss', 'p');
    NV.$('[data-vista="lectura"]').innerHTML = I('book_open', 'p'); NV.$('[data-vista="impresion"]').innerHTML = I('document', 'p'); NV.$('[data-vista="web"]').innerHTML = I('globe', 'p');
  }

  function controles() {
    NV.$('#nvAppIco').onclick = function() { W.guardar().then(function() { W.doc = null; NV.inicio.mostrar(); }); };
    NV.$('#nvAppIco').onkeydown = function(e) { if (e.key === 'Enter') this.click(); };
    var sw = NV.$('#nvAuto');
    sw.onclick = function() {
      W.est.autoguardado = !W.est.autoguardado; sw.classList.toggle('on', W.est.autoguardado); sw.setAttribute('aria-checked', W.est.autoguardado);
      if (W.est.autoguardado) W.guardar(); else NV.toast('Autoguardado desactivado: guarda con Ctrl+S.');
      W.pintarGuardado();
    };
    NV.$('#nvGuardar').onclick = function() { W.guardar(true).then(function() { NV.toast('Documento guardado.'); }); };
    NV.$('#nvDeshacer').onclick = function() { var e = W.ed(); if (e) { e.execCommand('Undo'); e.focus(); } };
    NV.$('#nvRehacer').onclick = function() { var e = W.ed(); if (e) { e.execCommand('Redo'); e.focus(); } };
    NV.$('#nvDocTitulo').onclick = function() { W.renombrar(); };
    NV.$('#nvCompartir').onclick = function() { NV.compartir(); };
    NV.$('#nvCerrarNav').onclick = function() { W.paneles.navegacion(false); };
    NV.$('#nvEstPagina').onclick = function() { W.dialogos.irA(); };
    NV.$('#nvEstPalabras').onclick = function() { W.dialogos.contarPalabras(); };
    NV.$('#nvEstIdioma').onclick = function(e) { W.acciones.menuIdioma(e.currentTarget); };
    NV.$$('.nv-estado-barra [data-vista]').forEach(function(b) { b.onclick = function() { W.vista(b.getAttribute('data-vista')); }; });
    NV.$('#nvZoomRango').oninput = function() { W.zoom(+this.value); };
    NV.$('#nvZoomMenos').onclick = function() { W.zoom(Math.ceil(W.est.zoom / 10) * 10 - 10); };
    NV.$('#nvZoomMas').onclick = function() { W.zoom(Math.floor(W.est.zoom / 10) * 10 + 10); };
    NV.$('#nvZoomTxt').onclick = function() { W.dialogos.zoom(); };
    // Ctrl + rueda del mouse: zoom, como en Word
    document.addEventListener('wheel', function(e) { if (e.ctrlKey && NV.vistaActual === 'word' && e.target.closest('#nvTrabajo')) { e.preventDefault(); W.zoom(W.est.zoom + (e.deltaY < 0 ? 10 : -10)); } }, {passive: false});

    // Buscar comandos (Alt+Q)
    var q = NV.$('#nvBuscarCmd'), res = NV.$('#nvBuscarRes'), indice = null, sel = 0, vis = [];
    var pintar = function() {
      var t = q.value.trim().toLowerCase();
      if (!t) { res.classList.add('nv-oculto'); return; }
      indice = indice || W.cinta.indiceComandos();
      var norm = function(s) { return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }, tn = norm(t);
      vis = indice.filter(function(c) { return norm(c.t).indexOf(tn) >= 0; }).slice(0, 12);
      res.innerHTML = vis.length ? vis.map(function(c, i) { return '<button type="button" class="nv-menu-item" data-i="' + i + '" style="' + (i === sel ? 'background:#f3f2f1' : '') + '"><span class="txt">' + NV.esc(c.t) + '</span><span class="atajo">' + NV.esc(c.tn) + '</span></button>'; }).join('') :
        '<div style="padding:10px 12px;font-size:13px;color:#605e5c">No hay comandos con "' + NV.esc(q.value) + '"</div>';
      res.classList.remove('nv-oculto');
    };
    q.addEventListener('input', function() { sel = 0; pintar(); });
    q.addEventListener('keydown', function(e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(vis.length - 1, sel + 1); pintar(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); pintar(); }
      else if (e.key === 'Enter' && vis[sel]) { e.preventDefault(); var c = vis[sel]; q.value = ''; res.classList.add('nv-oculto'); W.cinta.ejecutarComando(c); }
      else if (e.key === 'Escape') { q.value = ''; res.classList.add('nv-oculto'); var ed = W.ed(); if (ed) ed.focus(); }
    });
    res.addEventListener('mousedown', function(e) { e.preventDefault(); });
    res.addEventListener('click', function(e) { var b = e.target.closest('[data-i]'); if (!b) return; var c = vis[+b.dataset.i]; q.value = ''; res.classList.add('nv-oculto'); W.cinta.ejecutarComando(c); });
    q.addEventListener('blur', function() { setTimeout(function() { res.classList.add('nv-oculto'); }, 150); });
  }

  // Doble clic sobre una forma o un gráfico: se vuelve a editar.
  function dobleClicObjetos() {
    var e = W.ed(); if (!e || e._nvDbl) return; e._nvDbl = true;
    e.on('dblclick', function(ev) {
      var t = ev.target; if (W.est.soloLectura || !t || t.nodeName !== 'IMG') return;
      if (t.getAttribute('data-nv-forma')) { ev.preventDefault(); W.dialogos.forma(null, t); }
      else if (t.getAttribute('data-nv-grafico')) { ev.preventDefault(); W.dialogos.grafico(t); }
    });
  }

  function iniciar() {
    iconos(); controles(); W.cinta.construir();
    var abrirOrig = W.abrir;
    W.abrir = function(d) { return abrirOrig(d).then(function() { dobleClicObjetos(); var i = NV.$('#nvEstIdioma'); if (i) i.textContent = W.nombreIdioma(W.aj.idioma); W.cinta.mostrarTab('inicio'); }); };
    var p = new URLSearchParams(location.search), id = parseInt(p.get('doc'), 10);
    if (id) W.abrirPorId(id).then(function() { if (!W.doc) NV.inicio.mostrar(); });
    else if (p.get('nuevo') === 'word') NV.nuevoDocumento('blanco');
    else if (p.get('herramienta')) { NV.inicio.mostrar('pdf'); NV.herramienta(p.get('herramienta')); }
    else NV.inicio.mostrar();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
