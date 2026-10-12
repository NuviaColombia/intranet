/* Gestión › Seguimiento: qué está haciendo cada diseñador en tiempo real (libre, en pausa, con casos asignados,
   ocupado o ausente) para disponer del que esté libre. Datos: /design/api/seguimiento (services_design.seguimiento).
   Se actualiza cada 20 s mientras el panel está abierto. */
(function() {
  'use strict';
  window.DS_PANELS = window.DS_PANELS || {};
  var panel = document.getElementById('ov-seguimiento');
  if (!panel) return;
  var lista = document.getElementById('sgLista'), resumen = document.getElementById('sgResumen'), hora = document.getElementById('sgHora');
  var selArea = document.getElementById('sgArea'), buscar = document.getElementById('sgBuscar');
  var datos = null, timer = null, filtroGrupo = '', vista = 'disenadores', filtroSem = '';
  var finInput = document.getElementById('sgFin');
  try { var finGuardado = localStorage.getItem('sgFinJornada'); if (finGuardado) finInput.value = finGuardado; } catch (e) {}
  var SEMAFORO = {
    si: {ico: '✅', rot: 'Alcanza', desc: 'El trabajo pendiente cabe en el tiempo que queda (con margen)'},
    justo: {ico: '⚠️', rot: 'Justo', desc: 'Cabe, pero sin margen: cualquier retraso lo deja por fuera'},
    no: {ico: '❌', rot: 'No alcanza', desc: 'El trabajo pendiente es mayor que el tiempo que queda a los diseñadores en turno'},
    listo: {ico: '🏁', rot: 'Terminado', desc: 'Todos los casos de hoy están terminados'},
    sin_casos: {ico: '—', rot: 'Sin casos', desc: 'El manager no ha programado casos hoy'}
  };
  var GRUPOS = {
    libre: {ico: '🟢', rot: 'Libre', desc: 'Sin casos por hacer y fuera de break o almuerzo'},
    pausa: {ico: '☕', rot: 'En pausa', desc: 'En break o almuerzo según su Schedule'},
    asignado: {ico: '🟡', rot: 'Asignado sin iniciar', desc: 'Tiene casos en Ready to design o Hold'},
    ocupado: {ico: '🔴', rot: 'Ocupado', desc: 'Trabajando un caso ahora'},
    ausente: {ico: '⚪', rot: 'Ausente', desc: 'Tiene una ausencia registrada hoy'}
  };
  var esc = function(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; }); };
  var norm = function(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); };
  function minutosDesde(hhmm) {
    var m = /^(\d{1,2}):(\d{2})/.exec(hhmm || ''); if (!m || !datos) return null;
    var h = /^(\d{2}):(\d{2})/.exec(datos.hora);
    var d = (+h[1] * 60 + +h[2]) - (+m[1] * 60 + +m[2]);
    return d >= 0 ? d : null;
  }
  function duracion(min) { if (min == null) return ''; return min < 60 ? min + ' min' : Math.floor(min / 60) + ' h ' + (min % 60 ? (min % 60) + ' min' : ''); }
  function iniciales(n) { return String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(function(x) { return x[0].toUpperCase(); }).join(''); }

  function queHace(x) {
    var p = x.pendientes, pend = [];
    if (p.ready) pend.push(p.ready + ' Ready to design');
    if (p.hold) pend.push(p.hold + ' Hold');
    if (p.otros) pend.push(p.otros + ' por hacer');
    var pendTxt = pend.length ? '<div class="sg-pend">Pendientes: ' + esc(pend.join(' · ')) + '</div>' : '';
    if (x.grupo === 'ausente') return '<b>' + esc(x.ausencia) + '</b>';
    if (x.grupo === 'pausa') return '<b>' + esc(x.pausa.tipo) + '</b> desde ' + esc(x.pausa.desde) + ' hasta ' + esc(x.pausa.hasta) +
      (x.actual ? '<div class="sg-pend">Al volver: ' + esc(x.actual.estado) + ' ' + esc(x.actual.orden) + '</div>' : '') + pendTxt;
    if (x.grupo === 'ocupado') {
      var a = x.actual, t = duracion(minutosDesde(a.desde));
      return '<b>' + esc(a.estado) + '</b> · orden <b>' + esc(a.orden || 'sin número') + '</b>' + (a.paciente ? ' · ' + esc(a.paciente) : '') +
        '<div class="sg-sub">' + esc(a.producto || '') + (a.desde ? ' · desde ' + esc(a.desde) + (t ? ' (' + t + ')' : '') : '') + (a.otrosTrabajando ? ' · +' + a.otrosTrabajando + ' iniciado(s)' : '') + '</div>' + pendTxt;
    }
    if (x.grupo === 'asignado') {
      return '<b>' + esc(pend.join(' · ')) + '</b><div class="sg-sub">' + x.porHacer.map(function(o) { return esc(o.orden || 'sin número') + ' (' + esc(o.estado) + ')'; }).join(', ') + '</div>';
    }
    var libre = x.ultimoFin ? 'Libre desde ' + esc(x.ultimoFin) + (minutosDesde(x.ultimoFin) != null ? ' (' + duracion(minutosDesde(x.ultimoFin)) + ')' : '') : 'Sin casos hoy';
    return '<b>' + libre + '</b>';
  }

  function pintar() {
    if (!datos) return;
    hora.textContent = 'Actualizado ' + datos.hora;
    var area = selArea.value, q = norm(buscar.value);
    var filas = datos.disenadores.filter(function(x) {
      return (!area || x.areas.indexOf(area) >= 0) && (!q || norm(x.nombre + ' ' + x.equipos.join(' ')).indexOf(q) >= 0);
    });
    var cuenta = {};
    filas.forEach(function(x) { cuenta[x.grupo] = (cuenta[x.grupo] || 0) + 1; });
    resumen.innerHTML = '<button type="button" class="sg-chip' + (!filtroGrupo ? ' on' : '') + '" data-g="">Todos <b>' + filas.length + '</b></button>' +
      Object.keys(GRUPOS).map(function(g) {
        return '<button type="button" class="sg-chip sg-' + g + (filtroGrupo === g ? ' on' : '') + '" data-g="' + g + '" title="' + esc(GRUPOS[g].desc) + '">' + GRUPOS[g].ico + ' ' + GRUPOS[g].rot + ' <b>' + (cuenta[g] || 0) + '</b></button>';
      }).join('');
    resumen.querySelectorAll('[data-g]').forEach(function(b) { b.onclick = function() { filtroGrupo = b.dataset.g; pintar(); }; });
    if (filtroGrupo) filas = filas.filter(function(x) { return x.grupo === filtroGrupo; });
    if (!filas.length) { lista.innerHTML = '<tr><td colspan="5" class="sg-vacio">No hay diseñadores con este filtro.</td></tr>'; return; }
    var previo = '';
    lista.innerHTML = filas.map(function(x) {
      var sep = '';
      if (x.grupo !== previo) { previo = x.grupo; sep = '<tr class="sg-sep sg-' + x.grupo + '"><td colspan="5">' + GRUPOS[x.grupo].ico + ' ' + GRUPOS[x.grupo].rot + ' <span>' + esc(GRUPOS[x.grupo].desc) + '</span></td></tr>'; }
      return sep + '<tr class="sg-fila sg-' + x.grupo + '">' +
        '<td><div class="sg-persona"><span class="sg-av" data-id="' + x.id + '">' + esc(iniciales(x.nombre)) + '</span><b>' + esc(x.nombre) + '</b></div></td>' +
        '<td class="sg-eq">' + esc(x.equipos.join(', ')) + '<div class="sg-sub">' + esc(x.areas.join(', ')) + '</div></td>' +
        '<td><span class="sg-estado sg-' + x.grupo + '">' + GRUPOS[x.grupo].ico + ' ' + GRUPOS[x.grupo].rot + '</span></td>' +
        '<td class="sg-que">' + queHace(x) + '</td>' +
        '<td class="sg-num" title="Casos terminados hoy">' + (x.terminadosHoy || 0) + '</td></tr>';
    }).join('');
    // fotos de perfil (si no hay, quedan las iniciales)
    lista.querySelectorAll('.sg-av[data-id]').forEach(function(av) {
      var im = new Image(); im.alt = ''; im.onload = function() { av.textContent = ''; av.appendChild(im); }; im.src = '/design/api/foto/' + av.dataset.id;
    });
  }

  function horas(min) { min = Math.round(min || 0); var hh = Math.floor(min / 60), mm = min % 60; return hh ? hh + ' h' + (mm ? ' ' + mm + ' min' : '') : mm + ' min'; }
  function pintarEquipos() {
    var cont = document.getElementById('sgEquipos'), res = document.getElementById('sgResumenEq');
    var area = selArea.value, q = norm(buscar.value);
    var filas = datos.equipos.filter(function(e) { return (!area || e.area === area) && (!q || norm(e.equipo + ' ' + e.manager + ' ' + e.enTurno.map(function(p) { return p.nombre; }).join(' ')).indexOf(q) >= 0); });
    var cuenta = {}; filas.forEach(function(e) { cuenta[e.semaforo] = (cuenta[e.semaforo] || 0) + 1; });
    res.innerHTML = '<button type="button" class="sg-chip' + (!filtroSem ? ' on' : '') + '" data-s="">Todos <b>' + filas.length + '</b></button>' +
      ['no', 'justo', 'si', 'listo', 'sin_casos'].map(function(k) { return '<button type="button" class="sg-chip sg-sem-' + k + (filtroSem === k ? ' on' : '') + '" data-s="' + k + '" title="' + esc(SEMAFORO[k].desc) + '">' + SEMAFORO[k].ico + ' ' + SEMAFORO[k].rot + ' <b>' + (cuenta[k] || 0) + '</b></button>'; }).join('');
    res.querySelectorAll('[data-s]').forEach(function(b) { b.onclick = function() { filtroSem = b.dataset.s; pintarEquipos(); }; });
    if (filtroSem) filas = filas.filter(function(e) { return e.semaforo === filtroSem; });
    if (!filas.length) { cont.innerHTML = '<tr><td colspan="6" class="sg-vacio">No hay equipos con este filtro.</td></tr>'; return; }
    var ordenSem = {no: 0, justo: 1, si: 2, listo: 3, sin_casos: 4};
    filas = filas.slice().sort(function(a, b) { return ordenSem[a.semaforo] - ordenSem[b.semaforo] || a.area.localeCompare(b.area) || a.equipo.localeCompare(b.equipo); });
    cont.innerHTML = filas.map(function(e) {
      var pct = e.total ? Math.round(e.hechos * 100 / e.total) : 0, S = SEMAFORO[e.semaforo];
      var progr = e.cirugias + (e.cirugias === 1 ? ' cirugía' : ' cirugías') + (e.nightguards ? ' · ' + e.nightguards + ' nightguard' + (e.nightguards === 1 ? '' : 's') : '');
      var gente = e.enTurno.map(function(p) { return '<span class="sg-p sg-' + p.grupo + '" title="' + esc(GRUPOS[p.grupo] ? GRUPOS[p.grupo].rot : '') + '"><i></i>' + esc(p.nombre.split(' ').slice(0, 2).join(' ')) + '</span>'; }).join('') +
        e.prestados.map(function(n) { return '<span class="sg-p sg-prest" title="Prestado de otro equipo"><i></i>' + esc(n) + ' (prestado)</span>'; }).join('') +
        (e.deOtrosEquipos ? '<span class="sg-p sg-prest"><i></i>+' + e.deOtrosEquipos + ' de otros equipos</span>' : '');
      var detalle = e.semaforo === 'si' || e.semaforo === 'justo' || e.semaforo === 'no'
        ? '<div class="sg-sub">Faltan ≈ ' + horas(e.pendienteMin) + ' de trabajo · quedan ' + horas(e.capacidadMin) + ' (' + (e.enTurno.length + e.prestados.length + e.deOtrosEquipos) + ' diseñador' + ((e.enTurno.length + e.prestados.length + e.deOtrosEquipos) === 1 ? '' : 'es') + ' × ' + horas(e.restanteMin) + ')</div>' : '';
      return '<tr class="sg-eq-fila sg-sem-' + e.semaforo + '">' +
        '<td><b>' + esc(e.equipo) + '</b><div class="sg-sub">' + esc(e.area) + (e.manager ? ' · ' + esc(e.manager) : '') + '</div></td>' +
        '<td><b>' + progr + '</b><div class="sg-sub">' + e.total + ' en total</div></td>' +
        '<td><div class="sg-barra" title="' + pct + '% terminado"><i style="width:' + pct + '%"></i></div><div class="sg-sub">✔ ' + e.hechos + ' terminados · ▶ ' + e.enProceso + ' en proceso · ⏳ ' + e.porHacer + ' por hacer' +
          (e.sinDisenador ? ' · <span class="sg-alerta">' + e.sinDisenador + ' sin diseñador</span>' : '') + '</div></td>' +
        '<td><div class="sg-gente">' + (gente || '<span class="sg-alerta">Nadie en turno</span>') + '</div>' + (e.ausentes.length ? '<div class="sg-sub">Ausentes: ' + esc(e.ausentes.join(', ')) + '</div>' : '') + '</td>' +
        '<td>' + (e.casosPorDisenador != null ? '<b>' + e.casosPorDisenador + '</b><div class="sg-sub">casos por diseñador</div>' : '—') + '</td>' +
        '<td><span class="sg-semaforo sg-sem-' + e.semaforo + '" title="' + esc(S.desc) + '">' + S.ico + ' ' + S.rot + '</span>' + detalle + '</td></tr>';
    }).join('');
  }

  function cambiarVista(v) {
    vista = v;
    panel.querySelectorAll('.sg-vista').forEach(function(b) { b.classList.toggle('on', b.dataset.vista === v); b.setAttribute('aria-selected', b.dataset.vista === v); });
    document.getElementById('sgVistaDis').hidden = v !== 'disenadores';
    document.getElementById('sgVistaEq').hidden = v !== 'equipos';
    document.getElementById('sgFinW').hidden = v !== 'equipos';
    buscar.placeholder = v === 'equipos' ? 'Buscar equipo, manager o diseñador…' : 'Buscar diseñador o equipo…';
    if (datos) { if (v === 'equipos') pintarEquipos(); else pintar(); }
  }
  panel.querySelectorAll('.sg-vista').forEach(function(b) { b.addEventListener('click', function() { cambiarVista(b.dataset.vista); }); });
  finInput.addEventListener('change', function() { try { localStorage.setItem('sgFinJornada', finInput.value); } catch (e) {} cargar(); });

  function cargar() {
    clearTimeout(timer);
    if (!panel.classList.contains('open')) return;
    fetch('/design/api/seguimiento?fin=' + encodeURIComponent(finInput.value || '17:00'), {credentials: 'same-origin'})
      .then(function(r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function(d) {
        datos = d;
        var actual = selArea.value;
        selArea.innerHTML = '<option value="">Todas las áreas</option>' + d.areas.map(function(a) { return '<option' + (a === actual ? ' selected' : '') + '>' + esc(a) + '</option>'; }).join('');
        if (vista === 'equipos') pintarEquipos(); else pintar();
      })
      .catch(function() { hora.textContent = 'No se pudo actualizar; se reintenta en unos segundos'; })
      .then(function() { timer = setTimeout(cargar, 20000); });
  }
  var repintar = function() { if (!datos) return; if (vista === 'equipos') pintarEquipos(); else pintar(); };
  selArea.addEventListener('change', repintar);
  buscar.addEventListener('input', repintar);
  document.getElementById('sgRefrescar').addEventListener('click', cargar);
  document.addEventListener('visibilitychange', function() { if (!document.hidden && panel.classList.contains('open')) cargar(); });
  window.DS_PANELS.seguimiento = cargar;
  // el Schedule abre el panel del enlace (?panel=seguimiento) antes de que cargue este archivo
  if (panel.classList.contains('open')) cargar();
})();
