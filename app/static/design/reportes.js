// Dashboard › Reportes (Rosember, 21-oct-2026): abrir el reporte mensual (ES/EN) y subir / ver / quitar reportes en PDF.
// Servidor: routers/design_reportes.py. Solo admins (el script solo se carga para ellos).
(function() {
  'use strict';
  var listo = false;
  var $ = function(id) { return document.getElementById(id); };
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function(c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; }); }
  function mesTxt(m) { var n = MESES[+m.slice(5) - 1]; return n.charAt(0).toUpperCase() + n.slice(1) + ' ' + m.slice(0, 4); }
  function tam(b) { return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
  function res(txt, mal) { var r = $('drRes'); r.textContent = txt; r.style.color = mal ? '#b91c1c' : '#047857'; }
  function pintar(lista) {
    var t = $('drTabla');
    if (!lista.length) { t.innerHTML = '<tbody><tr><td style="color:#6b7280">Todavía no hay reportes subidos.</td></tr></tbody>'; return; }
    t.innerHTML = '<thead><tr><th>Mes</th><th>Título</th><th>Archivo</th><th>Subido por</th><th></th></tr></thead><tbody>' + lista.map(function(r) {
      var en = new Date(r.en).toLocaleString('es-CO', {timeZone: 'America/Bogota', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit'});
      return '<tr><td>' + esc(mesTxt(r.mes)) + '</td><td><b>' + esc(r.titulo) + '</b></td><td>' + esc(r.archivo) + ' <span style="color:#6b7280">(' + tam(r.tam) + ')</span></td>' +
        '<td>' + esc(r.por) + '<div style="color:#6b7280;font-size:12px">' + esc(en) + '</div></td>' +
        '<td style="white-space:nowrap"><a class="btn gris" href="/design/reportes/archivo/' + r.id + '" target="_blank" rel="noopener">Ver</a> ' +
        '<a class="btn gris" href="/design/reportes/archivo/' + r.id + '?descargar=1">Descargar</a> ' +
        '<button type="button" class="btn gris" data-quitar="' + r.id + '" data-titulo="' + esc(r.titulo) + '" style="color:#b91c1c">Eliminar</button></td></tr>';
    }).join('') + '</tbody>';
  }
  function cargar() {
    fetch('/design/api/reportes', {credentials: 'same-origin'}).then(function(r) { return r.json(); }).then(function(d) {
      var ops = d.meses.map(function(m) { return '<option value="' + m + '">' + mesTxt(m) + '</option>'; }).join('');
      if (!$('drMes').options.length) { $('drMes').innerHTML = ops; $('drMesSub').innerHTML = ops; }
      var gv = $('drGvMes');   // Reportes GeoVictoria: por defecto el mes que ya cerró
      if (gv && !gv.options.length) { gv.innerHTML = ops; if (gv.options.length > 1) gv.selectedIndex = 1; }
      pintar(d.subidos);
    }).catch(function() { res('No se pudieron cargar los reportes.', true); });
  }
  function iniciar() {
    if (listo) { cargar(); return; }
    listo = true;
    if ($('drGvAbrir')) $('drGvAbrir').addEventListener('click', function() {
      window.open('/design/reportes/geovictoria?mes=' + $('drGvMes').value, '_blank', 'noopener');
    });
    $('drAbrir').addEventListener('click', function() {
      window.open('/design/reportes/mensual?mes=' + $('drMes').value + '&lang=' + $('drLang').value, '_blank', 'noopener');
    });
    $('drSubir').addEventListener('click', function() {
      var f = $('drArchivo').files[0], b = $('drSubir');
      if (!f) return res('Elige el archivo PDF.', true);
      if (f.size > 15 * 1024 * 1024) return res('El PDF pasa de 15 MB.', true);
      var fd = new FormData();
      fd.append('archivo', f); fd.append('titulo', $('drTitulo').value); fd.append('mes', $('drMesSub').value);
      b.disabled = true; res('Subiendo…');
      fetch('/design/api/reportes/subir', {method: 'POST', credentials: 'same-origin', body: fd})
        .then(function(r) { return r.json().then(function(d) { if (!r.ok) throw new Error(d.detail || 'No se pudo subir.'); return d; }); })
        .then(function(d) { pintar(d.subidos); $('drArchivo').value = ''; $('drTitulo').value = ''; res('✔ Reporte subido.'); })
        .catch(function(e) { res('✘ ' + e.message, true); }).then(function() { b.disabled = false; });
    });
    $('drTabla').addEventListener('click', function(ev) {
      var id = ev.target.dataset.quitar;
      if (!id || !confirm('¿Eliminar el reporte «' + ev.target.dataset.titulo + '»? No se puede deshacer.')) return;
      fetch('/design/api/reportes/' + id + '/eliminar', {method: 'POST', credentials: 'same-origin'})
        .then(function(r) { return r.json(); }).then(function(d) { pintar(d.subidos || []); res('✔ Reporte eliminado.'); })
        .catch(function() { res('No se pudo eliminar.', true); });
    });
    cargar();
  }
  window.drIniciar = iniciar;
})();
