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
  var datos = null, timer = null, filtroGrupo = '', vista = 'disenadores', filtroSem = '', modo = 'tablero';
  try { modo = localStorage.getItem('sgModo') === 'lista' ? 'lista' : 'tablero'; } catch (e) {}
  var tablero = document.getElementById('sgTablero'), listaW = document.getElementById('sgListaW');
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
    asignado: {ico: '🟡', rot: 'Asignado sin iniciar', desc: 'Tiene casos por empezar (Ready to design, Changes…), sin contar Hold'},
    hold: {ico: '⏸️', rot: 'En Hold', desc: 'Solo tiene casos en Hold o Dr authorization: esperan respuesta del doctor'},
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
    if (p.otros) pend.push(p.otros + ' por hacer');
    var holdTxt = p.hold ? p.hold + ' en Hold' : '';
    var pendTxt = (pend.length || holdTxt) ? '<div class="sg-pend">Pendientes: ' + esc(pend.concat(holdTxt ? [holdTxt] : []).join(' · ')) + '</div>' : '';
    if (x.grupo === 'ausente') return '<b>' + esc(x.ausencia) + '</b>';
    if (x.grupo === 'pausa') return '<b>' + esc(x.pausa.tipo) + '</b> desde ' + esc(x.pausa.desde) + ' hasta ' + esc(x.pausa.hasta) +
      (x.actual ? '<div class="sg-pend">Al volver: ' + esc(x.actual.estado) + ' ' + esc(x.actual.orden) + '</div>' : '') + pendTxt;
    if (x.grupo === 'ocupado') {
      var a = x.actual, t = duracion(minutosDesde(a.desde));
      return '<b>' + esc(a.estado) + '</b> · orden <b>' + esc(a.orden || 'sin número') + '</b>' + (a.paciente ? ' · ' + esc(a.paciente) : '') +
        '<div class="sg-sub">' + esc(a.producto || '') + (a.desde ? ' · desde ' + esc(a.desde) + (t ? ' (' + t + ')' : '') : '') + (a.otrosTrabajando ? ' · +' + a.otrosTrabajando + ' iniciado(s)' : '') + '</div>' + pendTxt;
    }
    if (x.grupo === 'asignado') {
      return '<b>' + esc(pend.join(' · ')) + '</b><div class="sg-sub">' + x.porHacer.map(function(o) { return esc(o.orden || 'sin número') + ' (' + esc(o.estado) + ')'; }).join(', ') + '</div>' +
        (holdTxt ? '<div class="sg-pend">Además: ' + esc(holdTxt) + '</div>' : '');
    }
    if (x.grupo === 'hold') {
      return '<b>' + esc(holdTxt) + '</b><div class="sg-sub">' + (x.enHold || []).map(function(o) { return esc(o.orden || 'sin número') + ' (' + esc(o.estado) + ')'; }).join(', ') + '</div>';
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
    tablero.hidden = modo !== 'tablero'; listaW.hidden = modo !== 'lista';
    panel.querySelectorAll('#sgModoW [data-modo]').forEach(function(b) { b.classList.toggle('on', b.dataset.modo === modo); });
    if (modo === 'tablero') { pintarTablero(filas); return; }
    if (!filas.length) { lista.innerHTML = '<tr><td colspan="5" class="sg-vacio">No hay diseñadores con este filtro.</td></tr>'; return; }
    var previo = '';
    lista.innerHTML = filas.map(function(x) {
      var sep = '';
      if (x.grupo !== previo) { previo = x.grupo; sep = '<tr class="sg-sep sg-' + x.grupo + '"><td colspan="5">' + GRUPOS[x.grupo].ico + ' ' + GRUPOS[x.grupo].rot + ' <span>' + esc(GRUPOS[x.grupo].desc) + '</span></td></tr>'; }
      return sep + '<tr class="sg-fila sg-' + x.grupo + '">' +
        '<td><div class="sg-persona"><span class="sg-av" data-id="' + x.id + '">' + esc(iniciales(x.nombre)) + '</span><b>' + esc(x.nombre) + '</b>' + (x.manager ? ' <span class="sg-mgr">Manager</span>' : '') + '</div></td>' +
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

  function avatar(x) { return '<span class="sg-av" data-id="' + x.id + '">' + esc(iniciales(x.nombre)) + '</span>'; }
  function fotos(raiz) {
    raiz.querySelectorAll('.sg-av[data-id]').forEach(function(av) {
      var im = new Image(); im.alt = ''; im.onload = function() { av.textContent = ''; av.appendChild(im); }; im.src = '/design/api/foto/' + av.dataset.id;
    });
  }
  // Tablero: una columna por estado (libres a la izquierda, ocupados y ausentes a la derecha), una tarjeta por diseñador
  function pintarTablero(filas) {
    var grupos = filtroGrupo ? [filtroGrupo] : Object.keys(GRUPOS);
    tablero.style.setProperty('--sg-cols', grupos.length);
    tablero.innerHTML = grupos.map(function(g) {
      var de = filas.filter(function(x) { return x.grupo === g; });
      return '<section class="sg-col sg-' + g + '"><header><span>' + GRUPOS[g].ico + ' ' + GRUPOS[g].rot + '</span><b>' + de.length + '</b></header>' +
        '<p class="sg-col-desc">' + esc(GRUPOS[g].desc) + '</p>' +
        (de.length ? de.map(function(x) {
          return '<article class="sg-card sg-' + x.grupo + '">' +
            '<div class="sg-card-cab">' + avatar(x) + '<div><b>' + esc(x.nombre) + '</b>' + (x.manager ? ' <span class="sg-mgr">Manager</span>' : '') + '<div class="sg-sub">' + esc(x.equipos.join(', ')) + ' · ' + esc(x.areas.join(', ')) + '</div></div>' +
            '<span class="sg-hechos" title="Casos terminados hoy">✔ ' + (x.terminadosHoy || 0) + '</span></div>' +
            '<div class="sg-card-que">' + queHace(x) + '</div></article>';
        }).join('') : '<div class="sg-col-vacia">Nadie</div>') + '</section>';
    }).join('');
    fotos(tablero);
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
    if (!filas.length) { cont.innerHTML = '<div class="sg-vacio">No hay equipos con este filtro.</div>'; return; }
    var ordenSem = {no: 0, justo: 1, si: 2, listo: 3, sin_casos: 4};
    filas = filas.slice().sort(function(a, b) { return ordenSem[a.semaforo] - ordenSem[b.semaforo] || a.area.localeCompare(b.area) || a.equipo.localeCompare(b.equipo); });
    cont.innerHTML = filas.map(function(e) {
      var pct = e.total ? Math.round(e.hechos * 100 / e.total) : 0, S = SEMAFORO[e.semaforo];
      var n = e.enTurno.length + e.prestados.length + e.deOtrosEquipos;
      var conCirugias = e.area === 'N3 Prosthetic' || e.area === 'N6 Material Changes';  // N2 y Face: órdenes
      var progr = e.cirugias + (conCirugias ? (e.cirugias === 1 ? ' cirugía' : ' cirugías') : (e.cirugias === 1 ? ' orden' : ' órdenes')) + (e.nightguards ? ' · ' + e.nightguards + ' nightguard' + (e.nightguards === 1 ? '' : 's') : '') +
        (e.material ? ' · ' + e.material + ' material change' + (e.material === 1 ? '' : 's') : '');
      var gente = e.enTurno.map(function(p) { return '<span class="sg-p sg-' + p.grupo + '" title="' + esc(GRUPOS[p.grupo] ? GRUPOS[p.grupo].rot : '') + '"><i></i>' + esc(p.nombre.split(' ').slice(0, 2).join(' ')) + (p.manager ? ' (manager)' : '') + '</span>'; }).join('') +
        e.prestados.map(function(nm) { return '<span class="sg-p sg-prest" title="Prestado de otro equipo"><i></i>' + esc(nm) + ' (prestado)</span>'; }).join('') +
        (e.deOtrosEquipos ? '<span class="sg-p sg-prest"><i></i>+' + e.deOtrosEquipos + ' de otros equipos</span>' : '');
      var detalle = e.semaforo === 'si' || e.semaforo === 'justo' || e.semaforo === 'no'
        ? 'Faltan ≈ <b>' + horas(e.pendienteMin) + '</b> de trabajo · quedan <b>' + horas(e.capacidadMin) + '</b> (' + n + ' diseñador' + (n === 1 ? '' : 'es') + ' × ' + horas(e.restanteMin) + ')' : esc(S.desc);
      return '<article class="sg-eq-card sg-sem-' + e.semaforo + '">' +
        '<header><div><h3>' + esc(e.equipo) + '</h3><div class="sg-sub">' + esc(e.area) + (e.manager ? ' · ' + esc(e.manager) : '') + '</div></div>' +
          '<span class="sg-semaforo sg-sem-' + e.semaforo + '" title="' + esc(S.desc) + '">' + S.ico + ' ' + S.rot + '</span></header>' +
        '<div class="sg-eq-det">' + detalle + '</div>' +
        '<div class="sg-eq-nums"><div><b>' + e.total + '</b><span>' + progr + '</span></div><div><b>' + e.hechos + '</b><span>terminados</span></div><div><b>' + e.enProceso + '</b><span>en proceso</span></div>' +
          '<div><b>' + e.porHacer + '</b><span>por hacer</span></div><div><b>' + (e.enHold || 0) + '</b><span>en Hold</span></div><div' + (e.sinDisenador ? ' class="sg-alerta"' : '') + '><b>' + e.sinDisenador + '</b><span>sin diseñador</span></div>' +
          '<div><b>' + (e.casosPorDisenador != null ? e.casosPorDisenador : '—') + '</b><span>casos por diseñador</span></div></div>' +
        '<div class="sg-barra" title="' + pct + '% terminado"><i style="width:' + pct + '%"></i></div>' +
        '<div class="sg-eq-gente"><span class="sg-sub">En turno (' + n + '):</span> ' + (gente || '<span class="sg-alerta">Nadie en turno</span>') + '</div>' +
        (e.ausentes.length ? '<div class="sg-sub">Ausentes: ' + esc(e.ausentes.join(', ')) + '</div>' : '') + '</article>';
    }).join('');
  }

  // ---------- N3/N2 Producción: reporte diario por equipo (services_design_produccion) ----------
  var fechaInput = document.getElementById('sgFecha'), prod = null, prodTok = 0;
  function hoyISO() { var d = new Date(new Date().toLocaleString('en-US', {timeZone: 'America/Bogota'})); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  fechaInput.value = hoyISO();
  function cargarProd() {
    var t = ++prodTok;
    return fetch('/design/api/seguimiento/produccion?fecha=' + encodeURIComponent(fechaInput.value || hoyISO()), {credentials: 'same-origin'})
      .then(function(r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function(d) { if (t === prodTok) { prod = d; pintarProd(); } })
      .catch(function() { if (t === prodTok) document.getElementById('sgProd').innerHTML = '<div class="sg-vacio">No se pudo cargar el reporte.</div>'; });
  }
  function prodFiltrados() {
    if (!prod) return [];
    var area = selArea.value, q = norm(buscar.value);
    return prod.equipos.filter(function(e) { return (!area || e.area === area) && (!q || norm(e.equipo + ' ' + e.manager).indexOf(q) >= 0); });
  }
  function copiar(texto, boton) {
    var listo = function() { var t0 = boton.textContent; boton.textContent = '✓ Copiado'; setTimeout(function() { boton.textContent = t0; }, 1500); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(texto).then(listo, function() { prompt('Copia el texto:', texto); });
    else { var ta = document.createElement('textarea'); ta.value = texto; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); listo(); } catch (e) { prompt('Copia el texto:', texto); } ta.remove(); }
  }
  function pintarProd() {
    var cont = document.getElementById('sgProd'), filas = prodFiltrados();
    if (!prod) { cont.innerHTML = '<div class="sg-vacio">Cargando…</div>'; return; }
    if (!filas.length) { cont.innerHTML = '<div class="sg-vacio">No hay equipos de N3 o N2 con este filtro.</div>'; return; }
    cont.innerHTML = filas.map(function(e, i) {
      return '<article class="sg-eq-card sg-prod-card">' +
        '<header><div><h3>' + esc(e.equipo) + '</h3><div class="sg-sub">' + esc(e.area) + (e.manager ? ' · ' + esc(e.manager) : '') + '</div></div>' +
        '<button type="button" class="btn gris mini" data-copiar="' + i + '">Copiar</button></header>' +
        '<pre class="sg-prod-txt">' + esc(e.texto) + '</pre>' +
        (e.centros.some(function(c) { return c.fueraDeOpenings; }) ? '<div class="sg-sub">Algún centro no es de este manager en Openings: se muestra igual.</div>' : '') +
        '</article>';
    }).join('');
    cont.querySelectorAll('[data-copiar]').forEach(function(b) { b.onclick = function() { copiar(filas[+b.dataset.copiar].texto, b); }; });
  }
  document.getElementById('sgProdCopiarTodo').addEventListener('click', function(ev) {
    copiar(prodFiltrados().map(function(e) { return e.equipo + '\n' + e.texto; }).join('\n\n'), ev.currentTarget);
  });
  fechaInput.addEventListener('change', cargarProd);

  function cambiarVista(v) {
    vista = v;
    panel.querySelectorAll('.sg-vista').forEach(function(b) { b.classList.toggle('on', b.dataset.vista === v); b.setAttribute('aria-selected', b.dataset.vista === v); });
    document.getElementById('sgVistaDis').hidden = v !== 'disenadores';
    document.getElementById('sgVistaEq').hidden = v !== 'equipos';
    document.getElementById('sgVistaProd').hidden = v !== 'produccion';
    document.getElementById('sgFechaW').hidden = v !== 'produccion';
    document.getElementById('sgFinW').hidden = v !== 'equipos';
    document.getElementById('sgModoW').hidden = v !== 'disenadores';
    buscar.placeholder = v === 'equipos' ? 'Buscar equipo, manager o diseñador…' : 'Buscar diseñador o equipo…';
    if (v === 'produccion') { pintarProd(); cargarProd(); return; }
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
        selArea.hidden = d.alcance === 'area' && d.areas.length <= 1;   // un aprobador solo ve su área (19-oct-2026): no hay nada que filtrar
        selArea.innerHTML = '<option value="">Todas las áreas</option>' + d.areas.map(function(a) { return '<option' + (a === actual ? ' selected' : '') + '>' + esc(a) + '</option>'; }).join('');
        if (vista === 'equipos') pintarEquipos(); else if (vista === 'produccion') cargarProd(); else pintar();
      })
      .catch(function() { hora.textContent = 'No se pudo actualizar; se reintenta en unos segundos'; })
      .then(function() { timer = setTimeout(cargar, (window.DSVivo && window.DSVivo.conectado) ? 60000 : 20000); });
  }
  var repintar = function() { if (vista === 'produccion') { pintarProd(); return; } if (!datos) return; if (vista === 'equipos') pintarEquipos(); else pintar(); };
  panel.querySelectorAll('#sgModoW [data-modo]').forEach(function(b) { b.addEventListener('click', function() { modo = b.dataset.modo; try { localStorage.setItem('sgModo', modo); } catch (e) {} repintar(); }); });
  selArea.addEventListener('change', repintar);
  buscar.addEventListener('input', repintar);
  document.getElementById('sgRefrescar').addEventListener('click', cargar);
  document.addEventListener('visibilitychange', function() { if (!document.hidden && panel.classList.contains('open')) cargar(); });
  // Con la conexión en vivo: cualquier cambio en órdenes o tiempos libres actualiza el panel (como mucho una vez cada
  // 5 s); además se refresca cada 60 s porque los minutos y los breaks avanzan solos. Sin conexión, cada 20 s.
  var tVivo = null, ultVivo = 0, tProd = null;
  document.addEventListener('ds:vivo', function(e) {
    var a = e.detail || {};
    // N3/N2 Producción: cambió una orden de cualquier equipo de N3 o N2 (aviso sin datos): se vuelve a pedir el reporte
    if (a.t === 'prod' && panel.classList.contains('open') && vista === 'produccion' && (!a.fecha || a.fecha === (fechaInput.value || hoyISO()))) {
      clearTimeout(tProd); tProd = setTimeout(cargarProd, 400 + Math.random() * 1200); return;
    }
    if (!panel.classList.contains('open') || (a.t !== 'dia' && a.t !== 'reconectado')) return;
    clearTimeout(tVivo);
    tVivo = setTimeout(function() { ultVivo = Date.now(); cargar(); }, Math.max(300, 5000 - (Date.now() - ultVivo)));
  });
  window.DS_PANELS.seguimiento = cargar;
  // el Schedule abre el panel del enlace (?panel=seguimiento) antes de que cargue este archivo
  if (panel.classList.contains('open')) cargar();
})();
