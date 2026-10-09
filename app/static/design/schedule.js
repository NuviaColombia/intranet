/* Design Schedule: código de la página (antes iba dentro de design_schedule.html, 500 KB en cada carga).
   Ahora el navegador lo guarda en caché. Los datos de la persona llegan en window.DS_CFG (lo arma la página).
   Cada bloque es el mismo <script> de antes, en el mismo orden. */
// ---------- Red: una sola función para todos los paneles de Design Schedule ----------
// Revisa el código de respuesta (antes varios paneles trataban un error 4xx/5xx como éxito) y da un
// mensaje claro si el servidor devuelve HTML (sesión vencida, error del proxy) en vez de JSON.
window.dsFetchJSON = function(url, opts) {
  return fetch(url, opts || {}).catch(function() {
    var e = new Error('Se perdió la conexión con el servidor. Intenta de nuevo.'); e.ds = true; throw e;
  }).then(function(r) {
    return r.text().then(function(t) {
      var d = null; try { d = t ? JSON.parse(t) : null; } catch (x) {}
      var e;
      if (!r.ok) {
        var det = d && d.detail;
        e = new Error(Array.isArray(det) ? 'Hay datos inválidos en lo que se envió.' : (det || ('El servidor respondió con un error (' + r.status + ').')));
      } else if (d === null && t) {
        e = new Error('Respuesta inesperada del servidor. Si se cerró la sesión, recarga la página.');
      }
      if (e) { e.ds = true; e.status = r.status; throw e; }
      return d;
    });
  });
};
window.dsEnVuelo = 0;  // guardados en curso: mientras haya, el Schedule no se refresca en vivo
window.dsPostJSON = function(url, body) {
  window.dsEnVuelo++;
  var fin = function() { window.dsEnVuelo = Math.max(0, window.dsEnVuelo - 1); };
  var pr = window.dsFetchJSON(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body || {})});
  pr.then(fin, fin);
  return pr;
};
// Red de seguridad: si una acción falla y nadie manejó el error, se avisa en pantalla en vez de fallar en silencio.
window.addEventListener('unhandledrejection', function(ev) {
  var e = ev.reason;
  if (e && e.ds && window.dsToast) { window.dsToast('⚠️ ' + e.message); ev.preventDefault(); }
});

(function() {
  function api(url, opts) { return window.dsFetchJSON(url, opts); }
  function postJSON(url, body) {
    return api(url, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
  }

  var URL_PARAMS = new URLSearchParams(location.search);
  // Desmarcar un descanso ya registrado: solo roles por encima del diseñador (empleado).
  var DS_PUEDE_DESMARCAR = window.DS_CFG.esAprobador;
  // Área en la que se está trabajando (la del equipo abierto; si aún está cargando, la del enlace).
  window.dsAreaActual = function() { return DS.areaId || parseInt(new URLSearchParams(location.search).get('area_id')) || null; };
  var DS = {
    areas: [], areaId: null, areaFormato: null,
    teams: [], teamId: null,
    lunes: dsLunesDe(new Date()),
    diaSel: 0, // 0=lunes ... 4=viernes (se ajusta a hoy con dsIrAHoy)
    diaData: null,
    deepLinkAreaId: URL_PARAMS.get('area_id') ? parseInt(URL_PARAMS.get('area_id')) : null,
    deepLinkTeamId: URL_PARAMS.get('team_id') ? parseInt(URL_PARAMS.get('team_id')) : null,
  };
  // Semana y día de hoy; sábado y domingo muestran el lunes siguiente (el horario es de lunes a viernes).
  function dsIrAHoy() {
    var hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    var dow = hoy.getDay(); // 0=domingo ... 6=sábado
    if (dow === 6) hoy.setDate(hoy.getDate() + 2);
    else if (dow === 0) hoy.setDate(hoy.getDate() + 1);
    DS.lunes = dsLunesDe(hoy);
    DS.diaSel = (hoy.getDay() + 6) % 7;
  }
  dsIrAHoy();  // al entrar (también para Todas las áreas sin equipo abierto) el día es hoy, no el lunes
  window.dsCambiarSemana = function(delta) {
    DS.lunes.setDate(DS.lunes.getDate() + delta);
    dsRefrescarSemana();
  };
  // Refresca la vista activa (equipo o todas las áreas) tras cambiar de semana.
  function dsRefrescarSemana() {
    var chk = document.getElementById('dsTodasAreasChk');
    if (chk && chk.checked) { dsRenderDiasTodas(); dsCargarTodasAreas(); }
    else { dsRenderDias(); dsCargarDia(); }
  }
  function dsActualizarSemanaCtrl() {
    var chk = document.getElementById('dsTodasAreasChk');
    document.getElementById('dsSemanaCtrl').style.display = (DS.teamId || (chk && chk.checked)) ? '' : 'none';
    // "Dejar a cargo" está junto al buscador: solo se ve con un equipo abierto (no en todas las áreas)
    document.getElementById('dsACargo').classList.toggle('ds-fuera', !DS.teamId || !!(chk && chk.checked));
    // "Producción" (managers, aprobadores y admins): mismo lugar y misma regla
    document.getElementById('dsProdBtn').classList.toggle('ds-fuera', !window.DS_GESTION || !DS.teamId || !!(chk && chk.checked));
  }

  function dsLunesDe(d) {
    var dia = d.getDay(); var diff = (dia === 0 ? -6 : 1) - dia;
    var l = new Date(d); l.setDate(d.getDate() + diff); l.setHours(0,0,0,0);
    return l;
  }
  function dsFechaISO(d) { return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
  function dsFechaCorta(d) { return d.toLocaleDateString('es-CO', {day:'2-digit', month:'short'}); }
  // "21 - 25 de sept"; si la semana cruza de mes: "28 de sept - 2 de oct".
  function dsRangoCorto(ini, fin) {
    if (ini.getMonth() === fin.getMonth()) return ini.getDate() + ' - ' + dsFechaCorta(fin).replace(/^0/, '');
    return dsFechaCorta(ini).replace(/^0/, '') + ' - ' + dsFechaCorta(fin).replace(/^0/, '');
  }

  var NOMBRES_DIAS = ['Lunes','Martes','Miércoles','Jueves','Viernes'];

  function dsRenderDias() {
    var fin = new Date(DS.lunes); fin.setDate(fin.getDate() + 4);
    document.getElementById('dsRangoSemana').innerText = dsRangoCorto(DS.lunes, fin);
    var cont = document.getElementById('dsDiaTabs'); cont.innerHTML = '';
    for (var i = 0; i < 5; i++) {
      var d = new Date(DS.lunes); d.setDate(d.getDate() + i);
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'ds-dia' + (i === DS.diaSel ? ' activo' : '');
      btn.innerText = NOMBRES_DIAS[i] + ' ' + d.getDate(); // el mes ya se ve en el rango de la semana
      btn.onclick = (function(idx) { return function() { DS.diaSel = idx; dsRenderDias(); dsCargarDia(); }; })(i);
      cont.appendChild(btn);
    }
    dsSincronizarFiltrosFecha();
  }

  function dsFechaSeleccionada() {
    var d = new Date(DS.lunes); d.setDate(d.getDate() + DS.diaSel); return d;
  }

  // ---------- Filtros de Mes / Semana ----------
  function dsMesLabel(anio, mes) {
    var d = new Date(anio, mes, 1);
    var l = d.toLocaleDateString('es-CO', {month:'long', year:'numeric'});
    return l.charAt(0).toUpperCase() + l.slice(1);
  }
  function dsSemanasDelMes(anio, mes) {
    var primerDia = new Date(anio, mes, 1);
    var ultimoDia = new Date(anio, mes + 1, 0);
    var lunes = dsLunesDe(primerDia);
    var out = [];
    while (lunes <= ultimoDia) {
      out.push(new Date(lunes));
      lunes = new Date(lunes); lunes.setDate(lunes.getDate() + 7);
    }
    return out;
  }
  function dsPoblarFiltroMes() {
    var sel = document.getElementById('dsMesFiltro');
    var hoy = new Date(); var opciones = [];
    for (var offset = -6; offset <= 6; offset++) opciones.push(new Date(hoy.getFullYear(), hoy.getMonth() + offset, 1));
    sel.innerHTML = opciones.map(function(d) {
      var val = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      return '<option value="' + val + '">' + dsMesLabel(d.getFullYear(), d.getMonth()) + '</option>';
    }).join('');
  }
  function dsPoblarFiltroSemana() {
    var sel = document.getElementById('dsSemanaFiltro');
    var mesVal = document.getElementById('dsMesFiltro').value; if (!mesVal) return;
    var partes = mesVal.split('-'); var anio = parseInt(partes[0]), mes = parseInt(partes[1]) - 1;
    var semanas = dsSemanasDelMes(anio, mes);
    sel.innerHTML = semanas.map(function(lunes, i) {
      var fin = new Date(lunes); fin.setDate(fin.getDate() + 4);
      return '<option value="' + dsFechaISO(lunes) + '">Semana ' + (i + 1) + ': ' + dsFechaCorta(lunes) + ' — ' + dsFechaCorta(fin) + '</option>';
    }).join('');
  }
  function dsSincronizarFiltrosFecha() {
    var mesSel = document.getElementById('dsMesFiltro'); if (!mesSel) return;
    var mesVal = DS.lunes.getFullYear() + '-' + String(DS.lunes.getMonth() + 1).padStart(2, '0');
    if (!mesSel.querySelector('option[value="' + mesVal + '"]')) {
      var opt = document.createElement('option'); opt.value = mesVal;
      opt.text = dsMesLabel(DS.lunes.getFullYear(), DS.lunes.getMonth());
      mesSel.appendChild(opt);
    }
    mesSel.value = mesVal;
    dsPoblarFiltroSemana();
    var semSel = document.getElementById('dsSemanaFiltro');
    var semVal = dsFechaISO(DS.lunes);
    if (semSel.querySelector('option[value="' + semVal + '"]')) semSel.value = semVal;
  }
  function dsAplicarSemanaFiltro() {
    var val = document.getElementById('dsSemanaFiltro').value; if (!val) return;
    DS.lunes = new Date(val + 'T00:00:00'); DS.diaSel = 0;
    dsRefrescarSemana();
  }

  // Empleados y aprobadores: sin la fila de áreas; la semana pasa al final de la fila de contadores y, si tienen
  // más de un equipo, un selector "Mi equipo" en la misma fila.
  (function dsSoloMio() {
    if (!window.DS_SOLO_MIO) return;
    var cont = document.getElementById('dsVistaNormal');
    if (cont && cont.parentNode) cont.parentNode.classList.add('ds-solo-mio');
    var fila = document.querySelector('.ds-fila-kpis'), sem = document.getElementById('dsSemanaCtrl');
    if (fila && sem) fila.appendChild(sem);
    var sin = document.querySelector('#dsSinEquipo span:last-child');
    if (sin) sin.textContent = 'No tienes un equipo asignado en Design. Pídele a un administrador que te agregue en Parámetros › Equipos.';
    var mios = (window.DS_INICIO && window.DS_INICIO.misEquipos) || [], sel = document.getElementById('dsMisEquipos');
    if (sel && mios.length > 1) {
      sel.innerHTML = mios.map(function(t) {
        return '<option value="' + t.teamId + '">' + dsEsc(t.area + ' · ' + t.nombre) + '</option>'; }).join('');
      sel.hidden = false;
      sel.addEventListener('change', function() {
        var t = mios.find(function(x) { return String(x.teamId) === sel.value; });
        var area = t && DS.areas.find(function(a) { return a.id === t.areaId; });
        if (area) dsIrAEquipo(area, t.teamId);
      });
    }
  })();
  function dsMarcarMiEquipo() {
    var sel = document.getElementById('dsMisEquipos');
    if (sel && !sel.hidden && DS.teamId) sel.value = String(DS.teamId);
  }

  // ---------- Áreas / Equipos ----------
  // Presionar un área solo abre su lista de equipos; el horario cambia únicamente al elegir un equipo.
  function dsCargarAreas() {
    window.dsAreas().then(function(areas) {
      DS.areas = areas;
      var cont = document.getElementById('dsAreaTabs'); cont.innerHTML = '';
      areas.forEach(function(a) {
        cont.appendChild(dsDropArea(a, 'ds-tab' + (a.id === DS.areaId ? ' activo' : ''), function() { dsAbrirListaArea(a); }));
      });
      // Deep link (?area_id=&team_id=): abre directamente ese equipo. Sin enlace, empleados y aprobadores
      // entran directo a su propio schedule (el que manejan o en el que son diseñadores).
      var mio = !DS.deepLinkTeamId && !DS.teamId && window.DS_INICIO && window.DS_INICIO.miEquipo;
      var area = areas.find(function(a) { return a.id === (mio ? mio.areaId : DS.deepLinkAreaId); });
      var teamId = mio ? mio.teamId : DS.deepLinkTeamId;
      DS.deepLinkAreaId = DS.deepLinkTeamId = null;
      if (area && teamId) dsIrAEquipo(area, teamId);
    }).catch(function(e) {
      var cont = document.getElementById('dsAreaTabs');
      cont.innerHTML = '<span class="ds-err-carga">No se pudieron cargar las áreas. <button type="button" class="btn mini">Reintentar</button></span>';
      cont.querySelector('button').onclick = dsCargarAreas;
    });
  }

  function dsDropDeArea(areaId) { return document.querySelector('#dsAreaTabs .ds-drop[data-area="' + areaId + '"]'); }

  function dsAbrirListaArea(area) {
    var drop = dsDropDeArea(area.id);
    if (drop.classList.contains('open')) { dsDropCerrar(); return; }
    api('/design/api/teams?area_id=' + area.id).then(function(teams) {
      dsDropRenderItems(drop, teams, area.id === DS.areaId ? DS.teamId : null, 'Sin equipos', function(teamId) {
        dsElegirEquipo(area, teams, teamId);
      });
      dsDropAbrir(drop);
    });
  }

  // Abre un equipo conociendo solo su área (deep link, "Ver equipo →" de la vista de todas las áreas).
  function dsIrAEquipo(area, teamId) {
    api('/design/api/teams?area_id=' + area.id).then(function(teams) {
      if (teams.some(function(t) { return t.id === teamId; })) dsElegirEquipo(area, teams, teamId);
    });
  }

  // ---------- Búsqueda de orden o paciente (arriba, para todos; cada quien ve lo que su rol le permite) ----------
  window.dsIrACaso = function(x) {
    var area = DS.areas.find(function(a) { return a.id === x.abrirAreaId; });
    if (!area) { dsToast('No se encontró el área de esa orden.'); return; }
    api('/design/api/teams?area_id=' + area.id).then(function(teams) {
      if (!teams.some(function(t) { return t.id === x.abrirTeamId; })) { dsToast('No tienes acceso al equipo de esa orden.'); return; }
      var p = String(x.fecha).split('-');
      DS.resaltar = x.ordenId;
      dsElegirEquipo(area, teams, x.abrirTeamId, new Date(+p[0], +p[1] - 1, +p[2])); // una sola carga, ya en la fecha del caso
    }).catch(function(e) { dsToast('⚠️ ' + e.message); });
  };
  (function() {
    var inp = document.getElementById('dsBuscarInput'), res = document.getElementById('dsBuscarRes');
    if (!inp) return;
    var timer = null, tok = 0;
    function cerrar() { res.hidden = true; res.innerHTML = ''; }
    function aviso(txt) { var d = document.createElement('div'); d.className = 'ds-buscar-vacio'; d.textContent = txt; res.appendChild(d); }
    function fechaLarga(iso) {
      var p = String(iso).split('-'), d = new Date(+p[0], +p[1] - 1, +p[2]);
      return d.toLocaleDateString('es-CO', {weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'});
    }
    function buscar() {
      var q = inp.value.trim(), t = ++tok;
      if (q.length < 2) { cerrar(); return; }
      api('/design/api/buscar?q=' + encodeURIComponent(q)).then(function(r) {
        if (t !== tok) return;
        res.innerHTML = '';
        if (!r.length) aviso('Sin resultados para “' + q + '”.');
        r.forEach(function(x) {
          var b = document.createElement('button'); b.type = 'button'; b.className = 'ds-buscar-item';
          b.innerHTML = '<span class="ds-bi-top"><b></b> · <span></span></span><span class="ds-bi-sub"></span>';
          b.querySelector('b').textContent = x.orden || '—';
          b.querySelector('.ds-bi-top span').textContent = x.paciente || '(sin paciente)';
          b.querySelector('.ds-bi-sub').textContent = x.area + ' › ' + x.equipo + ' › ' + fechaLarga(x.fecha) + (x.estado ? ' · ' + x.estado : '');
          b.onclick = function() { cerrar(); inp.value = ''; dsIrACaso(x); };
          res.appendChild(b);
        });
        if (r.length >= 50) aviso('Se muestran los 50 más recientes; escribe más para afinar.');
        res.hidden = false;
      }).catch(function(e) {
        if (t !== tok) return;
        res.innerHTML = ''; aviso('No se pudo buscar: ' + e.message); res.hidden = false;
      });
    }
    inp.addEventListener('input', function() { clearTimeout(timer); timer = setTimeout(buscar, 250); });
    inp.addEventListener('focus', function() { if (inp.value.trim().length >= 2 && res.hidden) buscar(); });
    inp.addEventListener('keydown', function(e) {
      var primero = res.querySelector('.ds-buscar-item');
      if (e.key === 'Escape') { inp.value = ''; cerrar(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (primero) primero.click(); }
      else if (e.key === 'ArrowDown' && primero) { e.preventDefault(); primero.focus(); }
    });
    res.addEventListener('keydown', function(e) {
      var items = Array.prototype.slice.call(res.querySelectorAll('.ds-buscar-item')), i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' && items[i + 1]) { e.preventDefault(); items[i + 1].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); (items[i - 1] || inp).focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); cerrar(); inp.focus(); }
    });
    document.addEventListener('mousedown', function(e) { if (!e.target.closest('.ds-buscar')) cerrar(); });
  })();

  function dsElegirEquipo(area, teams, teamId, fecha) {
    DS.areaId = area.id; DS.areaFormato = area.formato; DS.teams = teams; DS.teamId = teamId;
    if (fecha) { DS.lunes = dsLunesDe(fecha); DS.diaSel = Math.min(4, (fecha.getDay() + 6) % 7); } // desde la búsqueda
    else dsIrAHoy(); // al elegir un equipo siempre se abre en el día actual
    var chk = document.getElementById('dsTodasAreasChk');
    if (chk && chk.checked) { chk.checked = false; dsMostrarVista(false); }
    document.querySelectorAll('#dsAreaTabs .ds-tab').forEach(function(b, i) {
      b.classList.toggle('activo', DS.areas[i].id === area.id);
    });
    document.getElementById('dsPanelNightguard').style.display = (area.formato === 'dual') ? '' : 'none';
    document.getElementById('dsTituloPrincipal').innerText = (area.formato === 'dual') ? 'Cirugías' : 'Órdenes';
    document.getElementById('dsSinEquipo').style.display = 'none';
    document.getElementById('dsVistaEquipo').style.display = '';
    dsSeleccionarEquipo(teamId);
  }

  function dsActualizarTitulo() {
    var t = DS.teams.find(function(x) { return x.id === DS.teamId; });
    var chk = document.getElementById('dsTodasAreasChk');
    document.getElementById('dsTituloEquipo').innerText = (t && !(chk && chk.checked)) ? ' (' + t.nombre + ')' : '';
  }

  function dsSeleccionarEquipo(teamId) {
    DS.teamId = teamId;
    dsMarcarMiEquipo();
    dsActualizarTitulo();
    dsActualizarSemanaCtrl();
    dsRenderDias();
    dsCargarDia();
  }

  // ---------- Especificación de columnas por formato ----------
  var COLSPEC = {
    dual: {
      principal: [
        {k:'orden', l:'Orden', t:'text'}, {k:'paciente', l:'Paciente', t:'text'},
        {k:'centro', l:'Centro', t:'catalogo', cat:'centro'}, {k:'producto', l:'Producto', t:'catalogo', cat:'producto'},
        {k:'designerId', l:'Diseñador', t:'designer'},
        {k:'horaInicio', l:'Inicio', t:'time'}, {k:'horaInicioDiseno', l:'Inicio diseño', t:'time'},
        {k:'holdMinutos', l:'Hold (min)', t:'number'}, {k:'horaFin', l:'Fin', t:'time'},
        {k:'esferas', l:'Esferas', t:'select', opciones:['','Yes','No','N/A']},
        {k:'critico', l:'Crítico', t:'select', opciones:['','N/A','Inaccurate tissue','Min Thickness','Implant moved','Implant angled','Implant close','Tissue smooth >15']},
        {k:'estado', l:'Estado', t:'catalogo', cat:'estado'},
        {k:'qc', l:'QC', t:'checkbox'}, {k:'notas', l:'Notas', t:'text'},
      ],
      nightguard: [
        {k:'orden', l:'Orden', t:'text'}, {k:'paciente', l:'Paciente', t:'text'},
        {k:'centro', l:'Centro', t:'catalogo', cat:'centro'}, {k:'producto', l:'Producto', t:'catalogo', cat:'producto'},
        {k:'designerId', l:'Diseñador', t:'designer'}, {k:'notas', l:'Notas', t:'text'},
        {k:'horaInicio', l:'Inicio', t:'time'}, {k:'horaFin', l:'Fin', t:'time'},
        {k:'estado', l:'Estado', t:'catalogo', cat:'estado'}, {k:'qc', l:'QC', t:'checkbox'},
      ],
    },
    single: { principal: [
      {k:'orden', l:'Orden', t:'text'}, {k:'paciente', l:'Paciente', t:'text'},
      {k:'centro', l:'Centro', t:'catalogo', cat:'centro'}, {k:'producto', l:'Producto', t:'catalogo', cat:'producto'},
      {k:'designerId', l:'Diseñador', t:'designer'},
      {k:'horaInicio', l:'Inicio', t:'time'}, {k:'horaInicioDiseno', l:'Inicio diseño', t:'time'},
      {k:'holdMinutos', l:'Hold (min)', t:'number'}, {k:'horaFin', l:'Fin', t:'time'},
      {k:'estado', l:'Estado', t:'catalogo', cat:'estado'},
      {k:'qc', l:'QC', t:'checkbox'}, {k:'notas', l:'Notas', t:'text'},
    ]},
    // Face Design desde el 5-oct-2026: Inicio diseño · Start hold · Re-initiated · Fin (las horas las llena el estado)
    faceNuevo: { principal: [
      {k:'orden', l:'Orden', t:'text'}, {k:'paciente', l:'Paciente', t:'text'},
      {k:'centro', l:'Centro', t:'catalogo', cat:'centro'}, {k:'producto', l:'Producto', t:'catalogo', cat:'producto'},
      {k:'designerId', l:'Diseñador', t:'designer'},
      {k:'horaInicio', l:'Inicio diseño', t:'time'}, {k:'sHold', l:'Start hold', t:'time'}, {k:'fHold', l:'Re-initiated', t:'time', sinTHold: true},
      {k:'horaFin', l:'Fin', t:'time'},
      {k:'estado', l:'Estado', t:'catalogo', cat:'estado'},
      {k:'qc', l:'QC', t:'checkbox'}, {k:'notas', l:'Notas', t:'text'},
    ]},
    // N3 / N6 desde el 5-oct-2026: Cirugías con el formato de horas de Face (Nightguards / TC no cambia)
    dualNuevo: {
      principal: [
        {k:'orden', l:'Orden', t:'text'}, {k:'paciente', l:'Paciente', t:'text'},
        {k:'centro', l:'Centro', t:'catalogo', cat:'centro'}, {k:'producto', l:'Producto', t:'catalogo', cat:'producto'},
        {k:'designerId', l:'Diseñador', t:'designer'},
        {k:'horaInicio', l:'Inicio diseño', t:'time'}, {k:'sHold', l:'Start hold', t:'time'}, {k:'fHold', l:'Re-initiated', t:'time', sinTHold: true},
        {k:'horaFin', l:'Fin', t:'time'},
        {k:'esferas', l:'Esferas', t:'select', opciones:['','Yes','No','N/A']},
        {k:'critico', l:'Crítico', t:'select', opciones:['','N/A','Inaccurate tissue','Min Thickness','Implant moved','Implant angled','Implant close','Tissue smooth >15']},
        {k:'estado', l:'Estado', t:'catalogo', cat:'estado'},
        {k:'qc', l:'QC', t:'checkbox'}, {k:'notas', l:'Notas', t:'text'},
      ],
      // Nightguards / TC desde el 6-oct-2026: mismo formato de horas (el estado llena las horas)
      nightguard: [
        {k:'orden', l:'Orden', t:'text'}, {k:'paciente', l:'Paciente', t:'text'},
        {k:'centro', l:'Centro', t:'catalogo', cat:'centro'}, {k:'producto', l:'Producto', t:'catalogo', cat:'producto'},
        {k:'designerId', l:'Diseñador', t:'designer'},
        {k:'horaInicio', l:'Inicio diseño', t:'time'}, {k:'sHold', l:'Start hold', t:'time'}, {k:'fHold', l:'Re-initiated', t:'time', sinTHold: true},
        {k:'horaFin', l:'Fin', t:'time'},
        {k:'estado', l:'Estado', t:'catalogo', cat:'estado'},
        {k:'qc', l:'QC', t:'checkbox'}, {k:'notas', l:'Notas', t:'text'},
      ],
    },
    n2: { principal: [
      {k:'orden', l:'Orden', t:'text'}, {k:'paciente', l:'Paciente', t:'text'},
      {k:'centro', l:'Centro', t:'catalogo', cat:'centro'}, {k:'producto', l:'Producto', t:'catalogo', cat:'producto'},
      {k:'designerId', l:'Diseñador', t:'designer'},
      {k:'horaInicio', l:'Inicio', t:'time'}, {k:'sHold', l:'S.Hold', t:'time'}, {k:'fHold', l:'F.Hold', t:'time'},
      {k:'horaFin', l:'Fin', t:'time'},
      {k:'estado', l:'Estado', t:'catalogo', cat:'estado'},
      {k:'qc', l:'QC', t:'checkbox'}, {k:'notas', l:'Notas', t:'text'},
    ]},
    support: { principal: [
      {k:'orden', l:'Orden', t:'text'}, {k:'paciente', l:'Paciente', t:'text'},
      {k:'centro', l:'Centro', t:'catalogo', cat:'centro'}, {k:'producto', l:'Producto', t:'catalogo', cat:'producto'},
      {k:'etapa', l:'Etapa', t:'catalogo', cat:'etapa'}, {k:'designerId', l:'Diseñador', t:'designer'},
      {k:'solicitadoPor', l:'Solicitado por', t:'text'}, {k:'situacion', l:'Situación', t:'text'},
      {k:'solucion', l:'Solución', t:'text'}, {k:'clasificacion', l:'Clasificación', t:'catalogo', cat:'clasificacion'},
      {k:'soporte', l:'Soporte', t:'catalogo', cat:'soporte'},
    ]},
  };

  // Todos los catálogos del área llegan en una sola petición y se guarda la promesa (antes cada tabla
  // pedía cada columna por separado: 6 peticiones al abrir un equipo de Face Design).
  var catalogoCache = {};
  function dsCatalogo(tipo) {
    // Centro: los centros de Openings del manager del equipo (los manda el servidor con el día); si no hay, el catálogo.
    if (tipo === 'centro' && DS.diaData && Array.isArray(DS.diaData.centros)) return Promise.resolve(DS.diaData.centros);
    var areaId = DS.areaId;
    if (!catalogoCache[areaId]) {
      catalogoCache[areaId] = api('/design/api/catalogos?area_id=' + areaId)
        .catch(function(e) { delete catalogoCache[areaId]; throw e; });
    }
    return catalogoCache[areaId].then(function(todos) {
      var l = todos[tipo] || [];
      // Centro siempre en orden alfabético (como los centros de Openings)
      return tipo === 'centro' ? l.slice().sort(function(a, b) { return a.localeCompare(b, 'es', {sensitivity: 'base'}); }) : l;
    });
  }

  // ---------- Duración (misma fórmula que duracion_orden_min en services_design.py) ----------
  // N3/N6 (Cirugías) y Face: Fin − Inicio diseño − Hold (min). N2: Fin − Inicio − T. Hold (T. Hold = F.Hold − S.Hold).
  // Nightguards / TC: Fin − Inicio. Si cruza la medianoche se suma un día, como la herramienta original.
  function dsMinDe(h) { if (!h) return null; var p = String(h).split(':'); var m = parseInt(p[0]) * 60 + parseInt(p[1]); return isNaN(m) ? null : m; }
  function dsEntre(a, b) { var x = dsMinDe(a), y = dsMinDe(b); if (x === null || y === null) return null; var d = y - x; return d < 0 ? d + 1440 : d; }
  function dsFmtMin(m) { if (m === null || m === undefined || isNaN(m)) return ''; m = Math.max(0, Math.round(m)); return Math.floor(m / 60) + 'h ' + (m % 60) + 'm'; }
  function dsDuracionMin(f, tabla, formato) {
    if (formato === 'support') return null;
    if (tabla === 'nightguard' && !dsNgNuevo(formato, f)) return dsEntre(f.horaInicio, f.horaFin);
    if (formato === 'n2') { var t = dsEntre(f.horaInicio, f.horaFin); return t === null ? null : Math.max(0, t - (dsEntre(f.sHold, f.fHold) || 0)); }
    if (dsFaceNuevo(formato) || (tabla === 'nightguard' && dsNgNuevo(formato, f))) {  // Face: Fin − Inicio diseño − tiempo en Hold (este Hold + los anteriores del caso)
      var tf = dsEntre(f.horaInicio, f.horaFin); if (tf === null) return null;
      var hold = (parseFloat(f.holdMinutos) || 0) + (f.sHold && f.fHold ? (dsEntre(f.sHold, f.fHold) || 0) : 0);
      return Math.max(0, tf - hold);
    }
    var d = dsEntre(f.horaInicioDiseno, f.horaFin);
    return d === null ? null : Math.max(0, d - (parseFloat(f.holdMinutos) || 0));
  }
  function dsDuracionFila(f, tabla) {
    return tabla === 'prestadas' ? dsFmtMin(dsDuracionMin(f, f.tabla, f.formato)) : dsFmtMin(dsDuracionMin(f, tabla, DS.areaFormato));
  }

  // Columnas de la tabla. "Crítico" (Critical Cases) solo existe en N3 Prosthetic, como en la herramienta original.
  var DS_FACE_NUEVO_DESDE = '2026-10-05';
  var DS_DUAL_NUEVO_DESDE = '2026-10-05';
  var DS_NG_NUEVO_DESDE = '2026-10-06';  // Nightguards / TC de N3 y N6 con el mismo formato (horas_por_estado en services_design.py)
  // f: orden (para la tabla de prestadas usa su propia fecha); si no, el día abierto
  function dsNgNuevo(formato, f) {
    var d = f && f.fecha ? String(f.fecha).slice(0, 10) : dsFechaISO(dsFechaSeleccionada());
    return formato === 'dual' && d >= DS_NG_NUEVO_DESDE;
  }
  // Formato de horas nuevo (Inicio diseño · Start hold · Re-initiated · Fin): Face y Cirugías de N3/N6.
  // Ojo: para N3/N6 aplica solo a la tabla principal; quien lo use revisa antes que no sea Nightguards.
  function dsFaceNuevo(formato) {
    var f = dsFechaISO(dsFechaSeleccionada());
    return (formato === 'single' && f >= DS_FACE_NUEVO_DESDE) || (formato === 'dual' && f >= DS_DUAL_NUEVO_DESDE);
  }
  function dsSpec(tabla, formato, areaNombre) {
    var area = areaNombre || (DS.areas.find(function(a) { return a.id === DS.areaId; }) || {}).nombre;
    var fm = formato || DS.areaFormato;
    var base = !dsFaceNuevo(fm) ? COLSPEC[fm] : (fm === 'dual' ? {principal: COLSPEC.dualNuevo.principal, nightguard: dsNgNuevo(fm) ? COLSPEC.dualNuevo.nightguard : COLSPEC.dual.nightguard} : COLSPEC.faceNuevo);
    var spec = base[tabla] || [];
    return area === 'N3 Prosthetic' ? spec : spec.filter(function(c) { return c.k !== 'critico'; });
  }
  function dsEncabezadoExtra(c) { return c.k === 'fHold' && !c.sinTHold ? '<th>T. Hold</th>' : ''; } // N2: T. Hold calculado

  function dsEsProductoNG(v) { return /nightguard/i.test(v) || /\btc\b/i.test(v); }

  // ¿Ya hay otra orden con ese número hoy en este equipo? (el servidor valida también las que no se ven)
  // Un número puede estar hasta 5 veces en el día del equipo (MAX_REPETICIONES_ORDEN en services_design.py)
  var DS_MAX_REPETIDAS = 5;
  function dsOrdenRepetida(orden, idActual) {
    var n = String(orden || '').trim().toUpperCase();
    if (!n || !DS.diaData) return false;
    return (DS.diaData.principal || []).concat(DS.diaData.nightguard || []).filter(function(f) {
      return String(f.id) !== String(idActual) && String(f.orden || '').trim().toUpperCase() === n;
    }).length >= DS_MAX_REPETIDAS;
  }
  function dsAvisoRepetida(orden) {
    alert('⚠️ El número de orden "' + String(orden).trim().toUpperCase() + '" ya está ' + DS_MAX_REPETIDAS + ' veces en este día (es el máximo).');
  }

  // Colores por estado + alertas de la orden aprobada (horas que faltan y QC pendiente), como la herramienta original.
  function dsMarcarFila(tr, tabla, f) {
    if (!tr || tr.dataset.id === 'nuevo') return;
    f = f || (DS.diaData[tabla] || []).find(function(x) { return x.id === parseInt(tr.dataset.id); });
    if (!f) return;
    tr.classList.toggle('ds-fila-cancelada', f.estado === 'Canceled');
    tr.classList.toggle('ds-fila-hold', f.estado === 'Hold');
    var est = String(f.estado || '').trim().toLowerCase();
    tr.classList.toggle('ds-fila-ready', est === 'ready to design');
    tr.classList.toggle('ds-fila-html', est === 'html');
    tr.classList.toggle('ds-fila-aprobada', est === 'approved');
    var formato = tabla === 'prestadas' ? f.formato : DS.areaFormato, tablaReal = tabla === 'prestadas' ? f.tabla : tabla;
    var aprobada = f.estado === 'Approved', falta = false;
    var ngNuevo = tablaReal === 'nightguard' && dsNgNuevo(formato, tabla === 'prestadas' ? f : null);
    var req = formato === 'support' ? [] : ((tablaReal === 'nightguard' && !ngNuevo) || formato === 'n2') ? ['horaInicio', 'horaFin']
            : (dsFaceNuevo(formato) || ngNuevo) ? (f.sHold ? ['horaInicio', 'fHold', 'horaFin'] : ['horaInicio', 'horaFin'])
            : ['horaInicio', 'horaInicioDiseno', 'horaFin'];
    req.forEach(function(k) {
      var el = tr.querySelector('[data-campo="' + k + '"]'), miss = aprobada && !f[k];
      if (miss) falta = true;
      if (!el) return;
      el.classList.toggle('ds-falta', miss);
      if (miss) el.title = 'Falta esta hora y la orden ya está aprobada'; else el.removeAttribute('title');
    });
    var qc = tr.querySelector('[data-campo="qc"]'), td = qc && qc.closest('td');
    if (td) {
      var pend = aprobada && !f.qc;
      td.classList.toggle('ds-qc-pend', pend && !falta);
      td.classList.toggle('ds-qc-pend-rojo', pend && falta);
      if (pend) td.title = falta ? 'Orden aprobada: faltan horas y marcar el QC' : 'Orden aprobada: falta marcar el QC'; else td.removeAttribute('title');
      var rep = String(f.qcReporte || '').trim();
      td.classList.toggle('ds-qc-hallazgo', !!f.qc && !!rep);
      if (f.qc) td.dataset.qcTip = rep ? 'si' : 'no'; else delete td.dataset.qcTip;
      td._qcTexto = rep;
    }
    tr._dsFila = {tabla: tabla, f: f};   // para actualizar sus accesos sin volver a dibujar la fila
    dsAccesosFila(tr, tabla, f);
  }

  // ---------- Accesos en la fila ----------
  // Orden (N3, orden completa con paciente): botón a Comments N3; la primera vez llena Patient, Order # y Product.
  // Centro elegido: botón con la miniatura del Pre-Approved de sus doctores; clic abre una ventana flotante en vivo.
  function dsAreaNombre() { return (DS.areas.find(function(a) { return a.id === DS.areaId; }) || {}).nombre || ''; }
  function dsAccesosFila(tr, tabla, f) {
    if (tabla !== 'principal' && tabla !== 'nightguard') return;
    var tdO = (tr.querySelector('[data-campo="orden"]') || {}).parentNode, tdC = (tr.querySelector('[data-campo="centro"]') || {}).parentNode;
    var perm = window.DS_INICIO && window.DS_INICIO.comments ? window.DS_INICIO.comments.n3 !== false : true;
    var poner = function(td, clase, mostrar, titulo, alClic, extra) {
      if (!td || td.tagName !== 'TD') return;
      var b = td.querySelector('.' + clase);
      if (!mostrar) { if (b) b.remove(); if (!td.querySelector('.ds-acc-btn')) td.classList.remove('ds-con-acc'); return; }
      if (!b) { b = document.createElement('button'); b.type = 'button'; b.className = 'ds-acc-btn ' + clase; b.tabIndex = -1; td.appendChild(b); td.classList.add('ds-con-acc'); }
      b.title = titulo; b.setAttribute('aria-label', titulo); b.onclick = function(e) { e.preventDefault(); e.stopPropagation(); alClic(); };
      if (extra) extra(b);
    };
    var completa = dsOrdenCompleta(f) && String(f.orden || '').trim() && String(f.paciente || '').trim();
    var trabajo = window.cmtTrabajoDeOrden ? window.cmtTrabajoDeOrden(f.orden) : null, usada = !!trabajo;
    poner(tdO, 'ds-acc-cmt', perm && dsAreaNombre() === 'N3 Prosthetic' && completa,
          usada ? 'Abrir Comments N3 con lo que trabajaste en esta orden (guardado ' + dsHaceCuanto(trabajo.t) + '; se borra a los 2 días)' : 'Abrir Comments N3 con esta orden (llena Patient, Order # y Product)',
          function() { dsIrAComments(f, tr, tabla); }, function(b) { b.textContent = '💬'; b.classList.toggle('usado', usada); });
    poner(tdC, 'ds-acc-pa', !!String(f.centro || '').trim(), 'Pre-Approved de los doctores de ' + f.centro + ' (clic para abrir en ventana)',
          function() { dsPaVentana(f.centro); }, function(b) { b.textContent = '📋'; b.dataset.centro = f.centro; });
  }
  function dsIrAComments(f, tr, tabla) {
    var actual = (DS.diaData[tabla] || []).find(function(x) { return x.id === f.id; }) || f;
    window.dsAbrirPanel('comments');
    if (window.cmtDesdeSchedule) window.cmtDesdeSchedule({orden: actual.orden, paciente: actual.paciente, producto: actual.producto});
    dsAccesosFila(tr, tabla, actual);
  }
  function dsHaceCuanto(t) { var m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'hace un momento' : m < 60 ? 'hace ' + m + ' min' : m < 1440 ? 'hace ' + Math.round(m / 60) + ' h' : 'hace ' + Math.round(m / 1440) + ' días'; }
  // cuando se guarda trabajo de una orden nueva, los 💬 del día se actualizan (quedan marcados)
  window.dsRefrescarAccesosCmt = function() {
    document.querySelectorAll('tr').forEach(function(tr) {
      var b = tr.querySelector('.ds-acc-cmt'); if (!b || !tr._dsFila) return;
      dsAccesosFila(tr, tr._dsFila.tabla, tr._dsFila.f);
    });
  };

  // Miniatura al pasar el mouse por el botón del centro
  var DS_PA_CACHE = {};
  function dsPaDatos(centro, fresco) {
    var k = DS.areaId + '|' + DS.teamId + '|' + centro, c = DS_PA_CACHE[k];
    if (c && !fresco && Date.now() - c.t < 30000) return Promise.resolve(c.d);
    return window.dsFetchJSON('/design/api/preapproved/centro?area_id=' + DS.areaId + '&team_id=' + (DS.teamId || '') + '&centro=' + encodeURIComponent(centro))
      .then(function(d) { DS_PA_CACHE[k] = {t: Date.now(), d: d}; return d; });
  }
  // doctor: nombre del doctor a mostrar (vacío = todos)
  function dsPaTablaHtml(hj, doctor) {
    var esc = dsEsc, idx = hj.doctores.map(function(d, i) { return i; }).filter(function(i) { return !doctor || hj.doctores[i] === doctor; });
    if (!idx.length) return '';
    return '<table class="pa-t"><thead><tr class="pa-r-centros"><th class="pa-fija"></th><th colspan="' + idx.length + '">' + esc(hj.centro) + '</th></tr>' +
      '<tr class="pa-r-doctores"><th class="pa-fija">' + esc(hj.changesLabel || 'Changes') + '</th>' + idx.map(function(i) { return '<th>' + esc(hj.doctores[i]) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      hj.filas.map(function(fl) {
        return '<tr><th class="pa-fija">' + esc(fl.criterio) + '</th>' + idx.map(function(i) {
          var v = fl.valores[i];
          return '<td' + (/^\s*always ask\.?\s*$/i.test(v || '') ? ' class="pa-ask"' : '') + '>' + esc(v || '') + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table>';
  }
  var dsPaMini = null, dsPaMiniT = null;
  function dsPaMiniQuitar() { clearTimeout(dsPaMiniT); if (dsPaMini) { dsPaMini.remove(); dsPaMini = null; } }
  document.addEventListener('mouseover', function(e) {
    var b = e.target.closest && e.target.closest('.ds-acc-pa');
    if (!b) { if (dsPaMini || dsPaMiniT) dsPaMiniQuitar(); return; }
    if (dsPaMini && dsPaMini._b === b) return;
    dsPaMiniQuitar();
    dsPaMiniT = setTimeout(function() {
      var centro = b.dataset.centro;
      dsPaDatos(centro).then(function(d) {
        if (!b.matches(':hover')) return;
        dsPaMiniQuitar();
        var m = document.createElement('div'); m.className = 'ds-pa-mini'; m._b = b;
        m.innerHTML = d.hojas.length ? '<div class="ds-pa-mini-tit"></div>' + dsPaTablaHtml(d.hojas[0]) + '<div class="ds-pa-mini-pie">Clic para abrir en una ventana' + (d.hojas.length > 1 ? ' (y ' + (d.hojas.length - 1) + ' hoja(s) más con este centro)' : '') + '</div>'
                                     : '<div class="ds-pa-mini-tit"></div><div style="font-size:12px;color:#4b5563">No hay doctores de este centro en Pre-Approved.</div>';
        m.querySelector('.ds-pa-mini-tit').textContent = 'Pre-Approved · ' + centro + (d.hojas[0] ? ' · ' + d.hojas[0].hoja : '');
        document.body.appendChild(m); dsPaMini = m;
        var r = b.getBoundingClientRect(), w = m.offsetWidth, hh = m.offsetHeight;
        var x = Math.min(window.innerWidth - w - 8, Math.max(8, r.left - 20)), y = r.bottom + 6; if (y + hh > window.innerHeight - 8) y = Math.max(8, r.top - hh - 6);
        m.style.left = x + 'px'; m.style.top = y + 'px';
      }).catch(function() {});
    }, 250);
  });
  document.addEventListener('mousedown', dsPaMiniQuitar, true);
  document.addEventListener('scroll', dsPaMiniQuitar, true);

  // Ventanas flotantes (una por centro): mover, minimizar, cerrar; se actualizan solas.
  var DS_FW = {}, DS_FW_Z = 9000, DS_FW_N = 0;
  function dsPaVentana(centro) {
    dsPaMiniQuitar();
    var area = DS.areaId, team = DS.teamId || '', clave = area + '|' + team + '|' + centro.toLowerCase();
    var w = DS_FW[clave];
    if (w && w.el.isConnected) { w.el.classList.remove('min'); w.el.style.zIndex = ++DS_FW_Z; return; }
    var el = document.createElement('div'); el.className = 'ds-fw'; el.style.zIndex = ++DS_FW_Z; el.setAttribute('role', 'dialog');
    var n = DS_FW_N++ % 6;
    el.style.left = Math.max(8, Math.min(window.innerWidth - 640, 140 + n * 28)) + 'px'; el.style.top = (110 + n * 28) + 'px';
    el.innerHTML = '<div class="ds-fw-cab"><b></b><small></small><button type="button" data-fw="min" title="Minimizar">—</button><button type="button" data-fw="cerrar" title="Cerrar">✕</button></div>' +
      '<div class="ds-fw-cuerpo"><div class="ds-fw-vivo">Cargando…</div><div class="ds-fw-docs" role="group" aria-label="Doctor"></div><div class="ds-fw-c"></div></div>';
    el.querySelector('b').textContent = 'Pre-Approved · ' + centro;
    el.setAttribute('aria-label', 'Pre-Approved ' + centro);
    document.body.appendChild(el);
    w = DS_FW[clave] = {el: el, centro: centro, area: area, v: null, doctor: '', datos: null, manual: false};
    var cab = el.querySelector('.ds-fw-cab');
    el.addEventListener('mousedown', function() { el.style.zIndex = ++DS_FW_Z; });
    cab.addEventListener('mousedown', function(e) {
      if (e.target.closest('button')) return;
      e.preventDefault();
      var r = el.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      var mover = function(ev) {
        el.style.left = Math.max(-r.width + 80, Math.min(window.innerWidth - 80, ev.clientX - dx)) + 'px';
        el.style.top = Math.max(0, Math.min(window.innerHeight - 36, ev.clientY - dy)) + 'px';
      };
      var soltar = function() { document.removeEventListener('mousemove', mover); document.removeEventListener('mouseup', soltar); };
      document.addEventListener('mousemove', mover); document.addEventListener('mouseup', soltar);
    });
    cab.addEventListener('dblclick', function(e) { if (!e.target.closest('button')) el.classList.toggle('min'); });
    el.querySelector('[data-fw="min"]').onclick = function() { el.classList.toggle('min'); this.title = el.classList.contains('min') ? 'Restaurar' : 'Minimizar'; this.textContent = el.classList.contains('min') ? '▢' : '—'; };
    el.querySelector('[data-fw="cerrar"]').onclick = function() { clearInterval(w.timer); el.remove(); delete DS_FW[clave]; };
    var pintar = function() {
      return window.dsFetchJSON('/design/api/preapproved/centro?area_id=' + area + '&team_id=' + team + '&centro=' + encodeURIComponent(centro)).then(function(d) {
        var hora = new Date().toLocaleTimeString('es-CO', {hour: '2-digit', minute: '2-digit', second: '2-digit'});
        el.querySelector('.ds-fw-vivo').textContent = 'En vivo · actualizado ' + hora;
        if (d.v === w.v) return;
        var primera = w.v === null;
        w.v = d.v; w.datos = d;
        el.querySelector('small').textContent = d.hojas.map(function(x) { return x.hoja; }).join(' · ');
        dibujar(primera);
        DS_PA_CACHE[area + '|' + team + '|' + centro] = {t: Date.now(), d: d};
      }).catch(function() { el.querySelector('.ds-fw-vivo').textContent = 'Sin conexión: se reintenta en unos segundos…'; });
    };
    // Botones de doctor (Todos + cada doctor) y la tabla del doctor elegido
    var dibujar = function(ajustar) {
      var d = w.datos; if (!d) return;
      var docs = [];
      d.hojas.forEach(function(hj) { hj.doctores.forEach(function(x) { if (docs.indexOf(x) < 0) docs.push(x); }); });
      if (w.doctor && docs.indexOf(w.doctor) < 0) w.doctor = '';
      var cont = el.querySelector('.ds-fw-docs');
      cont.innerHTML = docs.length > 1 ? ['<button type="button" data-doc=""' + (w.doctor ? '' : ' class="on"') + '>Todos</button>'].concat(docs.map(function(x) {
        return '<button type="button" data-doc="' + dsEsc(x) + '"' + (w.doctor === x ? ' class="on"' : '') + '>' + dsEsc(x) + '</button>';
      })).join('') : '';
      cont.querySelectorAll('[data-doc]').forEach(function(b) { b.onclick = function() { w.doctor = b.dataset.doc; dibujar(!w.manual); }; });
      var partes = d.hojas.map(function(hj) {
        var t = dsPaTablaHtml(hj, w.doctor); if (!t) return '';
        return (d.hojas.length > 1 ? '<div class="pa-titulo">' + dsEsc(hj.hoja) + '</div>' : '') + '<div class="pa-scroll">' + t + '</div>';
      }).join('');
      el.querySelector('.ds-fw-c').innerHTML = partes || '<p style="color:#4b5563;font-size:13px;margin:6px 2px">No hay doctores de este centro en Pre-Approved.</p>';
      if (ajustar) ajustarTamano();
    };
    // Tamaño según el texto: ancho para que las columnas no queden apretadas y alto hasta donde quepa en la pantalla
    var ajustarTamano = function() {
      if (el.classList.contains('min')) return;
      var maxW = window.innerWidth - 24, maxH = window.innerHeight - 24;
      el.style.width = maxW + 'px'; el.style.height = 'auto';
      var ancho = 0;
      el.querySelectorAll('.ds-fw-c table.pa-t').forEach(function(t) { t.style.minWidth = '0'; ancho = Math.max(ancho, t.offsetWidth); t.style.minWidth = ''; });
      ancho = Math.max(ancho, 340);  // los botones de doctores se acomodan en varias líneas
      el.style.width = Math.min(maxW, ancho + 24 + 2) + 'px';
      var cab = el.querySelector('.ds-fw-cab').offsetHeight, cuerpo = el.querySelector('.ds-fw-cuerpo');
      el.style.height = Math.min(maxH, cab + cuerpo.scrollHeight + 4) + 'px';
      var r = el.getBoundingClientRect();
      if (r.right > window.innerWidth - 8) el.style.left = Math.max(8, window.innerWidth - 8 - r.width) + 'px';
      if (r.bottom > window.innerHeight - 8) el.style.top = Math.max(8, window.innerHeight - 8 - r.height) + 'px';
    };
    // si la persona cambia el tamaño a mano, se respeta (no se vuelve a ajustar al elegir doctor)
    el.addEventListener('mousedown', function(e) { var r = el.getBoundingClientRect(); if (e.clientX > r.right - 18 && e.clientY > r.bottom - 18) w.manual = true; });
    pintar();
    w.timer = setInterval(function() { if (!document.hidden && el.isConnected) pintar(); }, 6000);
  }
  window.dsPaVentana = dsPaVentana;

  // Tooltip del QC marcado (también sobre el checkbox deshabilitado: se escucha en la celda).
  (function() {
    var tip = null;
    var quitar = function() { if (tip) { tip.remove(); tip = null; } };
    document.addEventListener('mouseover', function(e) {
      var td = e.target.closest && e.target.closest('table.ds-tabla td[data-qc-tip]');
      if (!td) { quitar(); return; }
      if (tip && tip._td === td) return;
      quitar();
      tip = document.createElement('div'); tip._td = td;
      if (td.dataset.qcTip === 'si') { tip.className = 'ds-qc-tip'; tip.innerHTML = '<b>QC con hallazgos</b><span></span>'; tip.querySelector('span').textContent = td._qcTexto || ''; }
      else { tip.className = 'ds-qc-tip sin'; tip.innerHTML = '<b>QC sin hallazgos</b>'; }
      document.body.appendChild(tip);
      var r = td.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
      var x = Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2));
      var y = r.top - h - 8; if (y < 8) y = r.bottom + 8;
      tip.style.left = x + 'px'; tip.style.top = y + 'px';
    });
    document.addEventListener('scroll', quitar, true);
    document.addEventListener('mousedown', quitar, true);
  })();

  // ---------- Tabla de órdenes ----------
  // Siempre hay una fila vacía lista para llenar ("fila nueva"): existe solo en pantalla y se guarda en la BD
  // al escribir el primer dato. Cuando ya no quedan filas incompletas se agrega otra fila nueva.
  // Una orden "completa" (centro + producto + diseñador) es la única que cuentan los contadores;
  // mismo criterio que filtro_orden_completa() en services_design.py.
  function dsOrdenCompleta(f) { return !!(f.centro && f.producto && (f.designerId || f.designerPrestado)); }

  var DS_SORTABLES = {centro: true, producto: true, designerId: true, estado: true};
  DS.sort = {principal: null, nightguard: null}; // {k, dir: 1 (A→Z) | -1 (Z→A)}

  function dsTextoOrden(f, k) {
    if (k !== 'designerId') return f[k] || '';
    var d = dsElegibles().find(function(x) { return x.id === f.designerId; });
    return d ? d.nombre : (f.designerNombre || f.designerPrestado || '');
  }

  function dsFilasOrdenadas(tabla) {
    var filas = (DS.diaData[tabla] || []).slice();
    var s = DS.sort[tabla];
    if (s) {
      filas.sort(function(a, b) {
        var va = dsTextoOrden(a, s.k), vb = dsTextoOrden(b, s.k);
        if (!va !== !vb) return va ? -1 : 1; // vacías siempre al final
        return va.localeCompare(vb, 'es', {sensitivity: 'base'}) * s.dir;
      });
    }
    return filas;
  }

  function dsFilaHtml(spec, f, tabla) {
    var nueva = !f.id;
    var html = '<tr data-id="' + (nueva ? 'nuevo' : f.id) + '"' + (nueva ? ' class="ds-fila-nueva"' : '') + '>';
    spec.forEach(function(c, i) {
      html += '<td data-col="' + i + '">' + dsCeldaInput(c, f) + '</td>';
      if (c.k === 'fHold' && !c.sinTHold) html += '<td class="ds-thold">' + dsFmtMin(dsEntre(f.sHold, f.fHold)) + '</td>';
    });
    html += '<td class="ds-total">' + dsDuracionFila(f, tabla) + '</td>';
    html += '<td class="ds-acc">' + (!nueva && tabla !== 'prestadas' && window.DS_GESTION ? dsBtnOjo(f.id) : '') +
            (nueva || dsDiaCerrado() || dsSoloPropias() || tabla === 'prestadas' ? '' : dsBtnEliminar(f.id)) + '</td>';
    return html + '</tr>';
  }
  // ---------- Filas ocultas (solo aprobadores y admins) ----------
  // Las órdenes con QC se ocultan solas (las que se marcan ahora, a los 30 s). Cada fila tiene un botón para
  // ocultarla o volver a mostrarla, y cada tabla un botón "Mostrar ocultas (N)". Es solo la vista de esta persona
  // (se recuerda en este navegador); los contadores siguen contando todo.
  var DS_OCULTAS_KEY = 'dsOcultasV1';
  DS.qcGracia = {}; DS.verOcultas = false;
  function dsOcultasLeer() { try { return JSON.parse(localStorage.getItem(DS_OCULTAS_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function dsOcultasGuardar(o) { try { localStorage.setItem(DS_OCULTAS_KEY, JSON.stringify(o)); } catch (e) {} }
  // estado manual: {id: 'oculta' | 'visible'}
  // Interruptor de colores (por persona, en este navegador): encendido = color del estado en toda la fila;
  // apagado = solo en la columna Estado.
  function dsColoresFila() { try { return localStorage.getItem('dsColoresFila') !== 'no'; } catch (e) { return true; } }
  function dsAplicarColores() { document.body.classList.toggle('ds-color-solo-estado', !dsColoresFila()); }
  dsAplicarColores();
  function dsEstaOculta(f, man) {
    if (dsDiaCerrado()) return false;  // ocultar aplica solo al día activo: un día cerrado muestra todas sus órdenes
    var m = man[f.id];
    if (m === 'oculta') return true;
    if (m === 'visible') return false;
    // Canceladas: también se ocultan solas, 30 s después de quedar en Canceled (las que ya estaban, de una vez)
    if (dsEsCancelada(f)) { var gc = DS.cancelGracia[f.id]; return !(gc && Date.now() - gc < 30000); }
    if (!f.qc) return false;
    var g = DS.qcGracia[f.id];
    return !(g && Date.now() - g < 30000);
  }
  function dsEsCancelada(f) { return String(f.estado || '').trim().toLowerCase() === 'canceled'; }
  DS.cancelGracia = {}; DS.estadoVisto = {};
  function dsBtnOjo(id) {
    return '<button type="button" class="ds-btn-ojo" data-ojo="' + id + '" title="Ocultar esta fila" aria-label="Ocultar o mostrar esta fila" onclick="dsOjoFila(' + id + ')">👁</button>';
  }
  function dsAplicarOcultas(tabla) {
    var btn = document.getElementById('dsOcultas_' + tabla);
    var sw = btn && btn.parentNode.querySelector('.ds-auto-oc');
    if (sw) { sw.style.display = DS.diaData ? '' : 'none'; sw.querySelector('input').checked = dsColoresFila(); }
    if (!window.DS_GESTION || !DS.diaData || (tabla !== 'principal' && tabla !== 'nightguard')) { if (btn) btn.style.display = 'none'; return; }
    var man = dsOcultasLeer(), n = 0, cambio = false;
    (DS.diaData[tabla] || []).forEach(function(f) {
      // una orden que acaba de pasar a Canceled (aquí o por otra persona) se ve 30 s y luego se oculta
      var antes = DS.estadoVisto[f.id], ahora = dsEsCancelada(f);
      if (antes === false && ahora && !DS.cancelGracia[f.id]) {
        DS.cancelGracia[f.id] = Date.now();
        setTimeout(function() { dsAplicarOcultas(tabla); }, 30500);
      }
      if (!ahora) delete DS.cancelGracia[f.id];
      DS.estadoVisto[f.id] = ahora;
      var tr = document.querySelector('#' + (tabla === 'principal' ? 'dsTablaPrincipal' : 'dsTablaNightguard') + ' tr[data-id="' + f.id + '"]');
      var oc = dsEstaOculta(f, man);
      if (oc) n++;
      if (!tr) return;
      if (tr.classList.contains('ds-oculta') !== (oc && !DS.verOcultas)) cambio = true;
      tr.classList.toggle('ds-oculta', oc && !DS.verOcultas);
      tr.classList.toggle('ds-oculta-ver', oc && DS.verOcultas);
      var ojo = tr.querySelector('[data-ojo]');
      if (ojo) ojo.style.display = dsDiaCerrado() ? 'none' : '';
      if (ojo) { ojo.title = oc ? 'Mostrar esta fila' : 'Ocultar esta fila'; ojo.textContent = oc ? '🙈' : '👁'; }
    });
    if (btn) {
      btn.style.display = !n && !DS.verOcultas ? 'none' : '';  // (.btn pisa el atributo hidden)
      btn.textContent = DS.verOcultas ? 'Ocultar (' + n + ')' : 'Mostrar ocultas (' + n + ')';
      btn.title = DS.verOcultas ? 'Vuelve a ocultar las órdenes con QC, las canceladas y las que ocultaste' : 'Muestra las órdenes con QC, las canceladas y las que ocultaste (atenuadas)';
    }
    if (cambio && DS.sel) { DS.sel = null; dsPintarSel(); }  // cambiaron las filas visibles: la selección ya no aplica
  }
  document.querySelectorAll('.ds-auto-oc-chk').forEach(function(c) {
    c.addEventListener('change', function() {
      try { localStorage.setItem('dsColoresFila', c.checked ? 'si' : 'no'); } catch (e) {}
      document.querySelectorAll('.ds-auto-oc-chk').forEach(function(x) { x.checked = c.checked; });
      dsAplicarColores();
    });
  });
  window.dsVerOcultas = function() { DS.verOcultas = !DS.verOcultas; dsAplicarOcultas('principal'); dsAplicarOcultas('nightguard'); };
  window.dsOjoFila = function(id) {
    var man = dsOcultasLeer(), f = null;
    ['principal', 'nightguard'].forEach(function(t) { f = f || (DS.diaData[t] || []).find(function(x) { return x.id === id; }); });
    if (!f) return;
    if (dsEstaOculta(f, man)) man[id] = (f.qc || dsEsCancelada(f)) ? 'visible' : undefined; else man[id] = 'oculta';
    if (man[id] === undefined) delete man[id];
    dsOcultasGuardar(man);
    dsAplicarOcultas('principal'); dsAplicarOcultas('nightguard');
  };

  function dsBtnEliminar(id) {
    return '<button type="button" class="ds-btn-x" title="Eliminar orden" onclick="dsEliminarFila(' + id + ')">✕</button>';
  }

  function dsConectarFila(tr, tabla) {
    tr.querySelectorAll('[data-campo]').forEach(function(input) {
      if (input.dataset.campo === 'qc') {
        // Marcar QC exige llenar el recuadro de hallazgos; desmarcar guarda de inmediato (el reporte se conserva).
        input.addEventListener('change', function() {
          if (!input.checked) { dsGuardarFila(tr, tabla); return; }
          input.checked = false;
          dsAbrirQc(tr, tabla, input);
        });
        return;
      }
      var ev = (input.tagName === 'SELECT' || input.type === 'checkbox') ? 'change' : 'blur';
      input.addEventListener(ev, function() {
        if (ev === 'blur' && dsSinCambio(tr, tabla, input)) return; // no cambió (p. ej. pasar con Tab)
        if (input.dataset.campo === 'designerId' && input.value === '__otro') { dsElegirPrestado(tr, tabla, input); return; }
        if (input.dataset.campo === 'orden' && DS.areaFormato === 'support' && tabla !== 'prestadas' && input.value.trim()) {
          dsAutocompletarSupport(tr, tabla, input); return;
        }
        dsGuardarFila(tr, tabla);
      });
    });
  }

  // ¿La celda tiene lo mismo que está guardado? Se compara contra la orden guardada y no contra el valor "al
  // enfocar": en Chrome, elegir una hora con el reloj del campo vuelve a disparar focusin y ese valor quedaba
  // igual al nuevo, así que al salir no se guardaba.
  function dsSinCambio(tr, tabla, input) {
    var v = input.value, campo = input.dataset.campo;
    if (tr.dataset.id === 'nuevo') return v === '' || (input.type === 'number' && !parseFloat(v));
    var f = (DS.diaData && DS.diaData[tabla] || []).find(function(x) { return x.id === parseInt(tr.dataset.id); });
    if (!f) return false;
    var g = f[campo] == null ? '' : f[campo];
    return input.type === 'number' ? (parseFloat(v) || 0) === (parseFloat(g) || 0) : String(v) === String(g);
  }

  // Diseñador prestado ("Others"): primero el equipo (de la misma área) y luego el diseñador. Se guarda la persona
  // real, así la orden también le aparece en su propio horario (bloque "Prestadas a otros equipos").
  function dsElegirPrestado(tr, tabla, sel) {
    sel.value = sel.dataset.previo || ''; // mientras se elige, la celda conserva lo que tenía
    api('/design/api/prestables?team_id=' + DS.teamId).then(function(equipos) {
      dsModalPrestado(equipos, function(d) {
        if (d && tr.isConnected) {
          if (!sel.querySelector('option[value="' + d.id + '"]')) {
            var opt = document.createElement('option'); opt.value = d.id; opt.text = d.nombre + ' (prestado)';
            sel.insertBefore(opt, sel.querySelector('option[value="__otro"]'));
          }
          sel.value = String(d.id);
          dsGuardarFila(tr, tabla);
        }
        if (tr.isConnected) sel.focus();
      });
    }).catch(function(e) { alert('No se pudieron cargar los equipos: ' + e.message); });
  }
  function dsModalPrestado(equipos, listo) {
    var bg = document.createElement('div'); bg.className = 'ds-qc-bg'; bg.id = 'dsPrestado';
    bg.innerHTML = '<div class="ds-qc" role="dialog" aria-modal="true" aria-labelledby="dsPrestTit">' +
      '<h4 id="dsPrestTit">Diseñador prestado</h4><div class="ds-qc-sub" id="dsPrestSub"></div>' +
      '<div class="ds-prest-lista" id="dsPrestLista"></div>' +
      '<div class="ds-qc-btns"><button type="button" class="btn gris" data-prest="cancelar">Cancelar</button></div></div>';
    document.body.appendChild(bg);
    var sub = bg.querySelector('#dsPrestSub'), lista = bg.querySelector('#dsPrestLista');
    var teclas = function(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(null); } };
    var cerrar = function(d) { bg.remove(); document.removeEventListener('keydown', teclas, true); listo(d); };
    var boton = function(txt) { var b = document.createElement('button'); b.type = 'button'; b.className = 'ds-prest-item'; b.textContent = txt; return b; };
    var vacio = function(txt) { var p = document.createElement('p'); p.className = 'ds-prest-vacio'; p.textContent = txt; lista.appendChild(p); };
    var foco = function() { var b = lista.querySelector('button') || bg.querySelector('[data-prest]'); b.focus(); };
    function verEquipos() {
      sub.textContent = 'Elige el equipo del que te prestaron el diseñador:';
      lista.innerHTML = '';
      if (!equipos.length) vacio('No hay otros equipos en esta área.');
      equipos.forEach(function(t) { var b = boton('👥 ' + t.nombre); b.onclick = function() { verDisenadores(t); }; lista.appendChild(b); });
      foco();
    }
    function verDisenadores(t) {
      sub.textContent = 'Equipo ' + t.nombre + ' — elige el diseñador prestado:';
      lista.innerHTML = '';
      var v = boton('‹ Volver a equipos'); v.classList.add('ds-prest-volver'); v.onclick = verEquipos; lista.appendChild(v);
      if (!t.designers.length && !t.manager) vacio('Este equipo no tiene diseñadores registrados.');
      t.designers.forEach(function(d) { var b = boton('🎨 ' + d.nombre); b.onclick = function() { cerrar(d); }; lista.appendChild(b); });
      if (t.manager) { var bm = boton('👤 ' + t.manager.nombre + ' (manager)'); bm.onclick = function() { cerrar(t.manager); }; lista.appendChild(bm); }
      foco();
    }
    bg.querySelector('[data-prest="cancelar"]').onclick = function() { cerrar(null); };
    bg.addEventListener('mousedown', function(e) { if (e.target === bg) cerrar(null); });
    document.addEventListener('keydown', teclas, true);
    verEquipos();
  }

  // Support: al escribir el número de orden trae paciente, centro, producto y diseñador del horario donde ya
  // existe esa orden (la más reciente), como la herramienta original.
  function dsAutocompletarSupport(tr, tabla, input) {
    var orden = input.value.trim();
    if (dsOrdenRepetida(orden, tr.dataset.id)) { dsGuardarFila(tr, tabla); return; } // el guardado da el aviso
    api('/design/api/support/autocompletar?team_id=' + DS.teamId + '&orden=' + encodeURIComponent(orden)).then(function(x) {
      if (!tr.isConnected) return;
      if (x && (x.paciente || x.centro || x.producto || x.designerId)) {
        var poner = function(campo, valor, texto) {
          var el = tr.querySelector('[data-campo="' + campo + '"]');
          if (!el || !valor) return;
          if (el.tagName === 'SELECT' && !el.querySelector('option[value="' + CSS.escape(String(valor)) + '"]')) {
            var o = document.createElement('option'); o.value = valor; o.text = texto || valor; el.appendChild(o);
          }
          el.value = String(valor); el._alEnfocar = el.value;
          if (el.dataset.valorActual !== undefined) el.dataset.valorActual = el.value;
        };
        poner('paciente', x.paciente); poner('centro', x.centro); poner('producto', x.producto);
        poner('designerId', x.designerId, x.designerNombre);
        dsToast('Se completaron los datos del caso desde el horario donde ya existe la orden.');
      }
      dsGuardarFila(tr, tabla);
    }, function() { dsGuardarFila(tr, tabla); });
  }

  // Recuadro de QC: "¿Hallazgos?" Sí/No + comentario (obligatorio si hubo hallazgos).
  // Se guarda en el reporte de QC de la orden: vacío = sin hallazgos. Cancelar deja el QC sin marcar.
  function dsAbrirQc(tr, tabla, chk) {
    var id = parseInt(tr.dataset.id);
    var local = (DS.diaData[tabla] || []).find(function(x) { return x.id === id; }) || {};
    var previo = local.qcReporte || '';
    var ordenTxt = (tr.querySelector('[data-campo="orden"]') || {}).value || '';
    var bg = document.createElement('div'); bg.className = 'ds-qc-bg'; bg.id = 'dsQc';
    bg.innerHTML = '<div class="ds-qc" role="dialog" aria-modal="true" aria-labelledby="dsQcTit">' +
      '<h4 id="dsQcTit"></h4>' +
      '<div class="ds-qc-sub">¿Encontraste algo al revisar esta orden?</div>' +
      '<div class="ds-qc-opciones">' +
        '<label><input type="radio" name="dsQcHallazgo" value="no"' + (previo ? '' : ' checked') + '> Sin hallazgos</label>' +
        '<label><input type="radio" name="dsQcHallazgo" value="si"' + (previo ? ' checked' : '') + '> Con hallazgos</label>' +
      '</div>' +
      '<textarea id="dsQcTexto" placeholder="Describe lo que encontraste..."></textarea>' +
      '<div class="ds-qc-err" id="dsQcErr"></div>' +
      '<div class="ds-qc-btns"><button type="button" class="btn gris" data-qc="no">Cancelar</button>' +
      '<button type="button" class="btn" data-qc="si">Guardar QC</button></div></div>';
    document.body.appendChild(bg);
    bg.querySelector('#dsQcTit').textContent = 'Control de calidad' + (ordenTxt ? ' — ' + ordenTxt : '');
    var txt = bg.querySelector('#dsQcTexto'); txt.value = previo;
    var conHallazgos = function() { return bg.querySelector('input[name="dsQcHallazgo"]:checked').value === 'si'; };
    var sync = function() { txt.disabled = !conHallazgos(); if (!txt.disabled) txt.focus(); bg.querySelector('#dsQcErr').innerText = ''; };
    bg.querySelectorAll('input[name="dsQcHallazgo"]').forEach(function(r) { r.addEventListener('change', sync); });
    sync();
    if (txt.disabled) bg.querySelector('[data-qc="si"]').focus();
    var cerrar = function() { bg.remove(); document.removeEventListener('keydown', teclas, true); chk.focus(); };
    var guardar = function() {
      var reporte = conHallazgos() ? txt.value.trim() : '';
      if (conHallazgos() && !reporte) { bg.querySelector('#dsQcErr').innerText = 'Describe el hallazgo o elige "Sin hallazgos".'; txt.focus(); return; }
      tr._qcReporte = reporte;
      chk.checked = true;
      cerrar();
      dsGuardarFila(tr, tabla);
      var idQc = parseInt(tr.dataset.id);
      if (window.DS_GESTION && idQc) {  // se oculta a los 30 s (aprobadores)
        var man = dsOcultasLeer(); if (man[idQc] === 'visible') { delete man[idQc]; dsOcultasGuardar(man); }
        DS.qcGracia[idQc] = Date.now();
        setTimeout(function() { dsAplicarOcultas(tabla); }, 30500);
      }
    };
    var teclas = function(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || e.target.tagName !== 'TEXTAREA')) { e.preventDefault(); e.stopPropagation(); guardar(); }
    };
    document.addEventListener('keydown', teclas, true);
    bg.querySelector('[data-qc="si"]').onclick = guardar;
    bg.querySelector('[data-qc="no"]').onclick = cerrar;
    bg.addEventListener('mousedown', function(e) { if (e.target === bg) cerrar(); });
  }

  // Catálogos asíncronos (centro/producto/estado...) de las filas dentro de `root`.
  function dsPoblarCatalogos(root, spec, tabla) {
    spec.forEach(function(c) {
      if (c.t !== 'catalogo') return;
      dsCatalogo(c.cat).then(function(valores) {
        if (c.k === 'producto' && tabla === 'nightguard') valores = valores.filter(dsEsProductoNG);
        root.querySelectorAll('select[data-campo="' + c.k + '"]').forEach(function(sel) {
          var actual = sel.dataset.valorActual || '';
          valores.forEach(function(v) {
            if (!sel.querySelector('option[value="' + CSS.escape(v) + '"]')) {
              var opt = document.createElement('option'); opt.value = v; opt.text = v; sel.appendChild(opt);
            }
          });
          if (actual) sel.value = actual;
        });
      });
    });
  }

  function dsRenderTabla(tabla) {
    var spec = dsSpec(tabla);
    var cont = document.getElementById(tabla === 'principal' ? 'dsTablaPrincipal' : 'dsTablaNightguard');
    var filas = dsFilasOrdenadas(tabla);
    var s = DS.sort[tabla];
    var html = '<table class="ds-tabla"><thead><tr>';
    spec.forEach(function(c) {
      if (DS_SORTABLES[c.k]) {
        var on = s && s.k === c.k;
        html += '<th class="ds-th-sort' + (on ? ' on' : '') + '" data-sort="' + c.k + '" title="Ordenar alfabéticamente">' + c.l +
                '<span class="ds-sort-ind">' + (on ? (s.dir === 1 ? '▲' : '▼') : '↕') + '</span></th>';
      } else html += '<th>' + c.l + '</th>';
      html += dsEncabezadoExtra(c);
    });
    html += '<th>Total</th><th></th></tr></thead><tbody>';
    filas.forEach(function(f) { html += dsFilaHtml(spec, f, tabla); });
    if (dsPuedeCrear() && !filas.some(function(f) { return !dsOrdenCompleta(f); })) html += dsFilaHtml(spec, {}, tabla);
    html += '</tbody></table>';
    DS.renderizando = true; // si la celda con foco desaparece, su "blur" no debe guardar
    try { cont.innerHTML = html; } finally { DS.renderizando = false; }
    cont.querySelectorAll('tbody tr').forEach(function(tr) { dsConectarFila(tr, tabla); dsMarcarFila(tr, tabla); });
    if (dsDiaCerrado()) {
      // Día cerrado: todo en solo lectura; el QC sigue editable hasta las 5:00 am de D+2.
      cont.querySelectorAll('[data-campo]').forEach(function(el) {
        el.disabled = !(el.dataset.campo === 'qc' && DS.diaData.qcEditable && DS.diaData.puedeQc !== false);
      });
    }
    if (dsSoloPropias()) {
      // Vista del diseñador: edita sus órdenes pero no las reasigna.
      dsBloquearCamposManager(cont);
    }
    cont.querySelectorAll('th[data-sort]').forEach(function(th) {
      th.addEventListener('click', function() {
        // Ciclo: A→Z, Z→A, orden original
        var k = th.dataset.sort, act = DS.sort[tabla];
        DS.sort[tabla] = (!act || act.k !== k) ? {k: k, dir: 1} : (act.dir === 1 ? {k: k, dir: -1} : null);
        dsRenderTabla(tabla);
      });
    });
    dsPoblarCatalogos(cont, spec, tabla);
    dsAplicarOcultas(tabla);
  }

  // Vista del diseñador: solo edita horas, estado, notas y (N3/N6) esferas y crítico; el resto de la orden es del manager.
  var DS_CAMPOS_MANAGER = ['orden', 'paciente', 'centro', 'producto', 'designerId'];
  function dsBloquearCamposManager(cont) {
    cont.querySelectorAll('[data-campo]').forEach(function(el) {
      if (DS_CAMPOS_MANAGER.indexOf(el.dataset.campo) < 0) return;
      el.disabled = true;
      el.title = el.dataset.campo === 'designerId' ? 'Solo el manager puede reasignar la orden' : 'Solo el manager puede editar este dato';
    });
  }

  // Órdenes de otros equipos asignadas a este diseñador como prestado (solo en la vista del diseñador).
  function dsRenderPrestadas() {
    var panel = document.getElementById('dsPanelPrestadas'), cont = document.getElementById('dsTablaPrestadas');
    var lista = (DS.diaData && DS.diaData.prestadas) || [];
    panel.style.display = lista.length ? '' : 'none';
    if (!lista.length) { cont.innerHTML = ''; return; }
    var grupos = [];
    lista.forEach(function(f) {
      var g = grupos.find(function(x) { return x.teamId === f.teamId && x.tabla === f.tabla; });
      if (!g) grupos.push(g = {teamId: f.teamId, equipo: f.equipo, tabla: f.tabla, formato: f.formato, area: f.area, filas: []});
      g.filas.push(f);
    });
    var html = '';
    grupos.forEach(function(g) {
      var spec = dsSpec(g.tabla, g.formato, g.area);
      html += '<h4 class="ds-prest-h">' + dsEsc(g.equipo) + (g.tabla === 'nightguard' ? ' — Nightguards / TC' : '') + '</h4>' +
              '<table class="ds-tabla" data-grupo="' + g.teamId + '-' + g.tabla + '"><thead><tr>';
      spec.forEach(function(c) { html += '<th>' + c.l + '</th>' + dsEncabezadoExtra(c); });
      html += '<th>Total</th><th></th></tr></thead><tbody>';
      g.filas.forEach(function(f) { html += dsFilaHtml(spec, f, 'prestadas'); });
      html += '</tbody></table>';
    });
    DS.renderizando = true;
    try { cont.innerHTML = html; } finally { DS.renderizando = false; }
    cont.querySelectorAll('tbody tr').forEach(function(tr) { dsConectarFila(tr, 'prestadas'); dsMarcarFila(tr, 'prestadas'); });
    cont.querySelectorAll('[data-campo]').forEach(function(el) {
      if (dsDiaCerrado()) el.disabled = !(el.dataset.campo === 'qc' && DS.diaData.qcEditable);
    });
    dsBloquearCamposManager(cont);
    grupos.forEach(function(g) {
      dsPoblarCatalogos(cont.querySelector('table[data-grupo="' + g.teamId + '-' + g.tabla + '"]'), dsSpec(g.tabla, g.formato, g.area), g.tabla);
    });
  }

  function dsCeldaInput(c, f) {
    var val = f[c.k], al = ' aria-label="' + dsEsc(c.l || c.k) + '"';
    if (c.t === 'text') return '<input type="text" data-campo="' + c.k + '"' + al + ' value="' + dsEsc(val || '') + '">';
    if (c.t === 'number') return '<input type="number" step="1" data-campo="' + c.k + '"' + al + ' value="' + dsEsc(val || 0) + '">';
    if (c.t === 'time') return '<input type="time" data-campo="' + c.k + '"' + al + ' value="' + dsEsc(val || '') + '">';
    if (c.t === 'checkbox') {
      var bloq = c.k === 'qc' && DS.diaData && DS.diaData.puedeQc === false;  // el QC lo marcan aprobadores y el diseñador a cargo
      return '<input type="checkbox" data-campo="' + c.k + '"' + al + ' ' + (val ? 'checked' : '') +
             (bloq ? ' disabled title="Solo los aprobadores marcan el QC"' : '') + '>';
    }
    if (c.t === 'select') {
      var html = '<select data-campo="' + c.k + '"' + al + '>';
      c.opciones.forEach(function(o) { html += '<option value="' + dsEsc(o) + '"' + (o === val ? ' selected' : '') + '>' + (o ? dsEsc(o) : '—') + '</option>'; });
      return html + '</select>';
    }
    if (c.t === 'catalogo') {
      return '<select data-campo="' + c.k + '"' + al + ' data-valor-actual="' + dsEsc(val || '') + '"><option value="">—</option>' +
             (val ? '<option value="' + dsEsc(val) + '" selected>' + dsEsc(val) + '</option>' : '') + '</select>';
    }
    if (c.t === 'designer') {
      // Support elige entre todos los diseñadores de Design; las demás áreas, entre los del equipo + "Others" (prestado).
      var lista = dsElegibles();
      var html = '<select data-campo="designerId"' + al + ' data-previo="' + dsEsc(val || '') + '"><option value="">—</option>';
      lista.forEach(function(d) {
        html += '<option value="' + d.id + '"' + (d.id === val ? ' selected' : '') + '>' + dsEsc(d.nombre) + (d.esManager ? ' (manager)' : '') + '</option>';
      });
      if (val && !lista.some(function(d) { return d.id === val; })) {
        html += '<option value="' + dsEsc(val) + '" selected>' + dsEsc((f.designerNombre || 'Diseñador') + ' (prestado)') + '</option>';
      }
      if (DS.diaData && !DS.diaData.designersCaso && !dsSoloPropias()) html += '<option value="__otro">Others (prestado)…</option>';
      return html + '</select>';
    }
    return '';
  }

  // Quiénes se pueden elegir en la columna Diseñador: los diseñadores del equipo y, al final, su manager
  // (Support: todos los diseñadores de Design y al final los managers).
  function dsElegibles() {
    if (!DS.diaData) return [];
    if (DS.diaData.designersCaso) return DS.diaData.designersCaso;
    return (DS.diaData.designers || []).concat(DS.diaData.manager ? [DS.diaData.manager] : []);
  }

  function dsEsc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function dsFilaDesdeForm(tr) {
    var datos = {teamId: DS.teamId, fecha: dsFechaISO(dsFechaSeleccionada())};
    tr.querySelectorAll('[data-campo]').forEach(function(input) {
      var campo = input.dataset.campo;
      var valor;
      if (input.type === 'checkbox') valor = input.checked;
      else if (campo === 'designerId') valor = input.value ? parseInt(input.value) : null;
      else if (campo === 'holdMinutos') valor = parseFloat(input.value) || 0;
      else valor = input.value;
      datos[campo] = valor;
    });
    return datos;
  }

  // ¿La fila nueva ya tiene algo escrito? (los valores por defecto no cuentan)
  function dsTieneDatos(datos) {
    return Object.keys(datos).some(function(k) {
      if (k === 'teamId' || k === 'fecha' || k === 'tabla') return false;
      var v = datos[k];
      return v !== '' && v !== null && v !== false && v !== 0;
    });
  }

  function dsGuardarFila(tr, tabla) {
    // Una fila que se está reemplazando (la tabla se redibujó) no se guarda: tendría valores viejos.
    if (!tr.isConnected || DS.renderizando) return;
    var datos = dsFilaDesdeForm(tr);
    var filas = DS.diaData[tabla];
    var existente = tr.dataset.id === 'nuevo' ? null : filas.find(function(x) { return x.id === parseInt(tr.dataset.id); });
    datos.tabla = tabla === 'prestadas' ? ((existente && existente.tabla) || 'principal') : tabla;
    // Número de orden repetido en el día (mismo equipo): aviso y no se guarda.
    var inpOrden = tr.querySelector('[data-campo="orden"]');
    var ordenCambio = !existente || String(datos.orden || '').trim().toUpperCase() !== String(existente.orden || '').trim().toUpperCase();
    if (tabla !== 'prestadas' && inpOrden && ordenCambio && dsOrdenRepetida(datos.orden, tr.dataset.id)) {
      dsAvisoRepetida(datos.orden);
      inpOrden.value = existente ? (existente.orden || '') : ''; inpOrden._alEnfocar = inpOrden.value;
      return;
    }
    if (tr.dataset.id === 'nuevo') {
      if (tr._qcReporte !== undefined) datos.qcReporte = tr._qcReporte;
      if (!dsTieneDatos(datos)) return;
      if (tr._creando) { tr._pendiente = true; return; } // se vuelve a guardar cuando termine de crearse
      tr._creando = true;
      dsSeguir(postJSON('/design/api/ordenes', datos)).then(function(o) {
        tr._creando = false;
        tr.dataset.id = o.id; tr.classList.remove('ds-fila-nueva');
        tr.querySelector('.ds-acc').innerHTML = (window.DS_GESTION ? dsBtnOjo(o.id) : '') + dsBtnEliminar(o.id);
        filas.push(o);
        dsHistPush({tipo: 'ordenes', tabla: tabla, ediciones: [], creadas: [{id: o.id, datos: dsClon(o)}], eliminadas: []});
        if (tr._pendiente) { tr._pendiente = false; dsGuardarFila(tr, tabla); return; }
        dsTrasGuardar(tabla, tr, o);
      }).catch(function(e) {
        tr._creando = false;
        if (/Ya existe una orden/.test(e.message) && inpOrden) { alert('⚠️ ' + e.message); inpOrden.value = ''; inpOrden._alEnfocar = ''; return; }
        alert('Error guardando: ' + e.message);
      });
      return;
    }
    var id = parseInt(tr.dataset.id);
    var local = filas.find(function(x) { return x.id === id; });
    var antes = local ? dsClon(local) : null;
    // Campos que no están en la tabla (p. ej. Crítico fuera de N3): se envían los que ya tenía la orden.
    if (local) {
      DS_CAMPOS.forEach(function(k) { if (datos[k] === undefined && local[k] !== undefined && local[k] !== null) datos[k] = local[k]; });
      datos.designerPrestado = local.designerPrestado || '';
      datos.qcReporte = tr._qcReporte !== undefined ? tr._qcReporte : (local.qcReporte || '');
    }
    delete tr._qcReporte;
    // Solo se envían los campos que cambiaron: si otra persona editó otro campo de esta orden, no se pisa.
    var envio = {teamId: datos.teamId, fecha: datos.fecha, tabla: datos.tabla};
    if (antes) {
      Object.keys(datos).forEach(function(k) {
        if (k === 'teamId' || k === 'fecha' || k === 'tabla') return;
        var a = antes[k], d = datos[k];
        if ((a === null || a === undefined ? '' : String(a)) !== (d === null || d === undefined ? '' : String(d))) envio[k] = d;
      });
    } else envio = datos;
    if (local) Object.assign(local, datos); // refleja el cambio de inmediato (orden A→Z, contadores)
    dsSeguir(postJSON('/design/api/ordenes/' + id, envio)).then(function(o) {
      var i = filas.findIndex(function(x) { return x.id === id; });
      if (i >= 0) filas[i] = tabla === 'prestadas' ? Object.assign({}, filas[i], o) : o; // prestadas conserva equipo/formato
      if (tabla === 'prestadas' && i >= 0) o = filas[i];
      if (antes && !dsMismaOrden(antes, o)) {
        dsHistPush({tipo: 'ordenes', tabla: tabla, ediciones: [{id: id, antes: antes, despues: dsClon(o),
                    campos: Object.keys(envio).filter(function(k) { return DS_CAMPOS.indexOf(k) >= 0; })}], creadas: [], eliminadas: []});
      }
      dsTrasGuardar(tabla, tr, o);
    }).catch(function(e) {
      if (local && antes) Object.assign(local, antes); // los contadores y el orden no quedan con datos no guardados
      alert((/Ya existe una orden/.test(e.message) ? '⚠️ ' : 'Error guardando: ') + e.message);
      dsCargarDia(true);
    });
  }

  // La respuesta del servidor trae la orden completa: si otra persona cambió otros campos de la misma orden,
  // se muestran ya (sin tocar la celda donde está el cursor).
  function dsPonerValores(tr, o) {
    tr.querySelectorAll('[data-campo]').forEach(function(el) {
      var k = el.dataset.campo;
      if (el === document.activeElement || !(k in o)) return;
      if (el.type === 'checkbox') { if (el.checked !== !!o[k]) el.checked = !!o[k]; return; }
      var v = o[k] === null || o[k] === undefined ? '' : String(o[k]);
      if (k === 'holdMinutos' && v === '0' && el.value === '') return;
      if (el.tagName === 'SELECT' && v && !el.querySelector('option[value="' + CSS.escape(v) + '"]')) return;
      if (el.value !== v) { el.value = v; el._alEnfocar = v; if (el.dataset.valorActual !== undefined) el.dataset.valorActual = v; }
    });
  }

  function dsTrasGuardar(tabla, tr, o) {
    if (!tr.isConnected) { // la tabla se redibujó mientras guardaba
      if (tabla === 'prestadas') dsRenderPrestadas(); else dsRenderTabla(tabla);
      dsRenderKpis(DS.diaData); return;
    }
    dsPonerValores(tr, o);
    if (tabla !== 'prestadas') setTimeout(function() { dsAplicarOcultas(tabla); }, 0);
    tr.querySelector('.ds-total').innerText = dsDuracionFila(o, tabla);
    var tdTHold = tr.querySelector('.ds-thold'); if (tdTHold) tdTHold.innerText = dsFmtMin(dsEntre(o.sHold, o.fHold));
    var selD = tr.querySelector('[data-campo="designerId"]'); if (selD) selD.dataset.previo = o.designerId || '';
    dsMarcarFila(tr, tabla, o);
    dsRenderKpis(DS.diaData);
    if (tabla === 'prestadas') return;
    // Si ya no queda ninguna fila incompleta, se agrega una fila nueva vacía al final (sin redibujar: no se pierde el foco).
    var tbody = tr.parentNode;
    if (dsPuedeCrear() && !DS.diaData[tabla].some(function(f) { return !dsOrdenCompleta(f); }) && !tbody.querySelector('tr[data-id="nuevo"]')) {
      var spec = dsSpec(tabla);
      var tmp = document.createElement('tbody'); tmp.innerHTML = dsFilaHtml(spec, {}, tabla);
      var nueva = tmp.firstChild;
      tbody.appendChild(nueva);
      dsConectarFila(nueva, tabla);
      dsPoblarCatalogos(nueva, spec, tabla);
    }
  }

  // "+ Agregar orden": ventanita que pregunta cuántas (1 a 50) y las crea en una sola petición.
  window.dsAgregarFila = function(tabla, ev) {
    if (!DS.teamId) { alert('Selecciona un equipo primero.'); return; }
    var btn = ev && ev.currentTarget;
    dsCerrarPop();
    var pop = document.createElement('div'); pop.className = 'ds-pop'; pop.id = 'dsPop';
    pop.innerHTML = '<label for="dsPopN">¿Cuántas órdenes agregar?</label>' +
      '<input type="number" id="dsPopN" min="1" max="50" value="1">' +
      '<div class="ds-pop-btns"><button type="button" class="btn gris" data-pop="no">Cancelar</button>' +
      '<button type="button" class="btn" data-pop="si">Agregar</button></div>';
    document.body.appendChild(pop);
    var r = btn ? btn.getBoundingClientRect() : {right: innerWidth - 20, bottom: 120};
    pop.style.top = (r.bottom + 6) + 'px';
    pop.style.left = Math.max(10, r.right - pop.offsetWidth) + 'px';
    var inp = pop.querySelector('#dsPopN'); inp.focus(); inp.select();
    var ok = function() {
      var n = Math.floor(Number(inp.value));
      if (!(n >= 1 && n <= 50)) { inp.focus(); inp.select(); dsToast('Escribe un número entre 1 y 50.'); return; }
      dsCerrarPop();
      dsCrearOrdenes(tabla, Array.apply(null, Array(n)).map(function() { return {}; }), true)
        .then(function() { dsCargarDia(true); }).catch(function(e) { alert('Error: ' + e.message); });
    };
    pop.querySelector('[data-pop="si"]').onclick = ok;
    pop.querySelector('[data-pop="no"]').onclick = dsCerrarPop;
    inp.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); ok(); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dsCerrarPop(); }
    });
    setTimeout(function() { document.addEventListener('mousedown', dsPopFuera, true); }, 0);
  };
  function dsPopFuera(e) { var pop = document.getElementById('dsPop'); if (pop && !pop.contains(e.target)) dsCerrarPop(); }
  function dsCerrarPop() {
    var pop = document.getElementById('dsPop'); if (pop) pop.remove();
    document.removeEventListener('mousedown', dsPopFuera, true);
  }

  window.dsEliminarFila = function(id) {
    if (!confirm('¿Eliminar esta orden?')) return;
    var tabla = null, datos = null;
    ['principal', 'nightguard'].forEach(function(t) {
      var f = (DS.diaData[t] || []).find(function(x) { return x.id === id; });
      if (f) { tabla = t; datos = dsClon(f); }
    });
    postJSON('/design/api/ordenes/' + id + '/eliminar', {}).then(function() {
      if (datos) dsHistPush({tipo: 'ordenes', tabla: tabla, ediciones: [], creadas: [], eliminadas: [{id: id, datos: datos}]});
      dsCargarDia(true);
    })
      .catch(function(e) { alert('Error: ' + e.message); });
  };

  function dsDiaCerrado() { return !!(DS.diaData && DS.diaData.cerrado); }
  // Vista de un diseñador: solo sus órdenes y sus tiempos libres; no crea, no borra ni reasigna órdenes.
  function dsSoloPropias() { return !!(DS.diaData && DS.diaData.soloPropias); }
  function dsPuedeCrear() { return !dsDiaCerrado() && !dsSoloPropias(); }

  // Candado junto al título + botones "Agregar orden" según si el día ya se cerró (5:00 am del día siguiente, hora Colombia).
  function dsAplicarCierre() {
    var candado = document.getElementById('dsCandado');
    var cerrado = dsDiaCerrado();
    document.querySelectorAll('.ds-btn-add').forEach(function(b) { b.style.display = dsPuedeCrear() ? '' : 'none'; });
    if (!cerrado) { candado.style.display = 'none'; return; }
    var txt = '🔒 Este día ya se cerró y no se puede editar.';
    if (DS.diaData.qcEditable) {
      var h = new Date(DS.diaData.qcEditableHasta);
      txt += ' El checkbox de QC se puede marcar hasta el ' +
             h.toLocaleDateString('es-CO', {day: 'numeric', month: 'long', timeZone: 'America/Bogota'}) + ' a las 5:00 am.';
    }
    candado.title = txt.replace('🔒 ', ''); candado.setAttribute('aria-label', candado.title); candado.style.display = '';
  }

  // Contadores fijos; solo cuentan órdenes completas (centro + producto + diseñador).
  var DS_KPIS = [
    {uno: 'Orden', varios: 'Órdenes', cuenta: function(f) { return true; }},
    {uno: 'En proceso', varios: 'En proceso', cuenta: function(f) { return f.estado === 'Initiated'; }},
    {uno: 'En espera', varios: 'En espera', cuenta: function(f) { return f.estado === 'Hold'; }},
    {uno: 'Aprobada', varios: 'Aprobadas', cuenta: function(f) { return f.estado === 'Approved' && f.qc; }},
    {uno: 'Cancelada', varios: 'Canceladas', cuenta: function(f) { return f.estado === 'Canceled'; }},
  ];
  function dsRenderKpis(dia) {
    dsPintarProduccion();  // la ventana de Producción (si está abierta) sigue los cambios
    var todas = dia.principal.concat(dia.nightguard || []).filter(dsOrdenCompleta);
    var cont = document.getElementById('dsKpis'); cont.innerHTML = '';
    DS_KPIS.forEach(function(k) {
      var n = todas.filter(k.cuenta).length;
      var el = document.createElement('div'); el.className = 'ds-kpi';
      el.innerHTML = '<b>' + n + '</b>' + (n === 1 ? k.uno : k.varios);
      cont.appendChild(el);
    });
  }

  var DS_DESCANSO_MIN = 15; // duración de cada descanso registrado con el checkbox

  function dsHoraMas(hhmm, minutos) {
    var p = hhmm.split(':'); var t = (parseInt(p[0]) * 60 + parseInt(p[1]) + minutos) % (24 * 60);
    return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
  }
  function dsHoraActual() {
    var d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  var dsAusenciasPromesa = null; // la lista de tipos de ausencia se pide una sola vez
  function dsRenderBreaks(dia) {
    var cont = document.getElementById('dsBreaks');
    if (!dia.designers.length) { cont.innerHTML = '<p style="color:#4b5563">' + (dia.soloPropias ? 'No estás asignado como diseñador en este equipo.' : 'Este equipo no tiene diseñadores asignados.') + '</p>'; return; }
    if (!dsAusenciasPromesa) {
      dsAusenciasPromesa = window.DS_INICIO.ausencias ? Promise.resolve(window.DS_INICIO.ausencias)
        : api('/design/api/ausencias').catch(function(e) { dsAusenciasPromesa = null; throw e; });
    }
    dsAusenciasPromesa.then(function(tipos) {
      if (DS.diaData !== dia) return; // cambió de día/equipo mientras cargaba
      var grid = document.createElement('div'); grid.className = 'ds-tl-grid';
      dia.designers.forEach(function(d) {
        var b = dia.breaks.find(function(x) { return x.empleadoId === d.id; }) || {};
        var card = document.createElement('div'); card.className = 'ds-tl-card'; card.dataset.empleadoId = d.id;
        card.dataset.fecha = dia._fecha || dsFechaISO(dsFechaSeleccionada()); card.dataset.team = dia._team || DS.teamId;   // su día y su equipo
        var fila = function(lbl, ini, fin, conCheck) {
          return '<div class="ds-tl-fila"><span class="ds-tl-lbl">' + lbl + '</span>' +
            (conCheck ? '<input type="checkbox" data-descanso="' + conCheck + '" title="Registrar descanso de ' + DS_DESCANSO_MIN + ' min desde ahora" aria-label="Registrar ' + lbl + ' de ' + dsEsc(d.nombre) + '">' : '<span></span>') +
            '<input type="time" data-campo="' + ini + '" aria-label="' + lbl + ' de ' + dsEsc(d.nombre) + ': inicio" value="' + dsEsc(b[ini] || '') + '">' +
            '<span class="ds-tl-guion">-</span>' +
            '<input type="time" data-campo="' + fin + '" aria-label="' + lbl + ' de ' + dsEsc(d.nombre) + ': fin" value="' + dsEsc(b[fin] || '') + '"></div>';
        };
        // La ausencia funciona igual que antes (mismo selector y valores); solo cambió de lugar.
        card.innerHTML =
          '<div class="ds-tl-head"><span class="ds-tl-nombre" title="' + dsEsc(d.nombre) + '">' + dsEsc(d.nombre) + '</span>' +
            '<span class="ds-tl-aus">' +
              (b.ausenciaAutomatica ? '<span title="Tomado automáticamente de un permiso aprobado en People" style="color:#16a34a">🔒 People</span>' : '') +
              '<select data-campo="tipoAusencia" title="Ausencia" aria-label="Ausencia"><option value="">—</option>' +
                tipos.map(function(t) { return '<option value="' + dsEsc(t) + '"' + (t === b.tipoAusencia ? ' selected' : '') + '>' + dsEsc(t) + '</option>'; }).join('') +
              '</select></span></div>' +
          fila('Almuerzo', 'almuerzoInicio', 'almuerzoFin', null) +
          fila('Descanso 1', 'break1Inicio', 'break1Fin', 'break1') +
          fila('Descanso 2', 'break2Inicio', 'break2Fin', 'break2');
        dsConectarTarjeta(card);
        card._guardado = dsDatosBreak(card); // estado inicial, para deshacer
        grid.appendChild(card);
      });
      cont.replaceChildren(grid); // se cambia de una sola vez: el panel nunca queda vacío
    });
  }

  // Checkbox del descanso: marcado = hay hora de inicio. Al marcarlo registra ahora + 15 min.
  // Solo managers/admins pueden desmarcarlo (borra las horas); las horas se pueden corregir a mano.
  function dsSincronizarDescanso(card, clave) {
    var chk = card.querySelector('[data-descanso="' + clave + '"]');
    var ini = card.querySelector('[data-campo="' + clave + 'Inicio"]');
    chk.checked = !!ini.value;
    chk.disabled = dsDiaCerrado() || (chk.checked && !DS_PUEDE_DESMARCAR);
    chk.title = chk.checked
      ? (DS_PUEDE_DESMARCAR ? 'Desmarcar borra las horas de este descanso' : 'Descanso registrado. Solo un manager o administrador puede desmarcarlo')
      : 'Registrar descanso de ' + DS_DESCANSO_MIN + ' min desde ahora';
  }

  function dsConectarTarjeta(card) {
    var cerrado = dsDiaCerrado();
    card.querySelectorAll('[data-campo]').forEach(function(input) {
      if (cerrado) { input.disabled = true; return; }
      var ev = input.tagName === 'SELECT' ? 'change' : 'blur';
      input.addEventListener(ev, function() {
        ['break1', 'break2'].forEach(function(k) { dsSincronizarDescanso(card, k); });
        dsGuardarBreak(card);
      });
    });
    ['break1', 'break2'].forEach(function(clave) {
      var chk = card.querySelector('[data-descanso="' + clave + '"]');
      var ini = card.querySelector('[data-campo="' + clave + 'Inicio"]');
      var fin = card.querySelector('[data-campo="' + clave + 'Fin"]');
      dsSincronizarDescanso(card, clave);
      chk.addEventListener('change', function() {
        if (chk.checked) {
          var ahora = dsHoraActual();
          ini.value = ahora; fin.value = dsHoraMas(ahora, DS_DESCANSO_MIN);
        } else {
          if (!DS_PUEDE_DESMARCAR || !confirm('¿Borrar el registro de este descanso?')) { chk.checked = true; return; }
          ini.value = ''; fin.value = '';
        }
        dsSincronizarDescanso(card, clave);
        dsGuardarBreak(card);
      });
    });
  }

  function dsDatosBreak(row) {
    // se guarda siempre en el día y el equipo de la tarjeta (no en el que esté elegido en ese momento)
    var datos = {teamId: parseInt(row.dataset.team) || DS.teamId, empleadoId: parseInt(row.dataset.empleadoId), fecha: row.dataset.fecha || dsFechaISO(dsFechaSeleccionada())};
    row.querySelectorAll('[data-campo]').forEach(function(input) { datos[input.dataset.campo] = input.value; });
    return datos;
  }
  function dsGuardarBreak(row) {
    if (!row.isConnected) return;
    // una tarjeta de otro día que quedó en pantalla (cambio de día o carga fallida) no se guarda
    if (row.dataset.fecha && row.dataset.fecha !== dsFechaISO(dsFechaSeleccionada())) { dsToast('Los tiempos libres en pantalla eran de otro día; se volvieron a cargar.'); dsCargarDia(); return; }
    var datos = dsDatosBreak(row);
    var antes = row._guardado;
    dsSeguir(postJSON('/design/api/breaks', datos)).then(function() {
      if (antes && JSON.stringify(antes) !== JSON.stringify(datos)) {
        dsHistPush({tipo: 'break', antes: antes, despues: dsClon(datos)});
      }
      row._guardado = dsClon(datos);
    }).catch(function(e) { alert('Error guardando: ' + e.message); });
  }

  // soloOrdenes: al agregar/eliminar una orden no se redibuja "Tiempos libres" (no cambió y parpadeaba).
  // ---------- Diseñador a cargo (el manager no está): mismas opciones que el manager en este Schedule ----------
  var DS_MESES_C = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  function dsACargoFecha(iso) { var p = iso.split('-'); return parseInt(p[2], 10) + ' ' + DS_MESES_C[parseInt(p[1], 10) - 1]; }
  function dsRangoTxt(a) { return a.desde === a.hasta ? 'el ' + dsACargoFecha(a.desde) : 'del ' + dsACargoFecha(a.desde) + ' al ' + dsACargoFecha(a.hasta); }
  // ---------- Producción del día: casos asignados a cada diseñador en el día elegido (para repartir los casos) ----------
  function dsProduccionDia(dia) {
    var cuenta = {}, nombres = {}, orden = [];
    (dia.designers || []).forEach(function(d) { var k = 'd' + d.id; cuenta[k] = 0; nombres[k] = d.nombre; orden.push(k); });
    (dia.principal || []).concat(dia.nightguard || []).forEach(function(f) {
      var k = f.designerId ? 'd' + f.designerId : (f.designerPrestado ? 'p' + f.designerPrestado : null);
      if (!k || String(f.estado || '').trim().toLowerCase() === 'canceled') return;  // las canceladas no cuentan
      if (!(k in cuenta)) { cuenta[k] = 0; nombres[k] = f.designerNombre || f.designerPrestado || 'Sin nombre'; orden.push(k); }
      cuenta[k]++;
    });
    return orden.map(function(k) { return {nombre: nombres[k], casos: cuenta[k]}; });
  }
  function dsPintarProduccion() {
    var pop = document.getElementById('dsProdPop'); if (!pop || !DS.diaData) return;
    var filas = dsProduccionDia(DS.diaData), total = filas.reduce(function(a, x) { return a + x.casos; }, 0);
    var f = dsFechaSeleccionada();
    pop.innerHTML = '<h4>Producción del día</h4><div class="sub">' + dsEsc(NOMBRES_DIAS[(f.getDay() + 6) % 7] || '') + ' ' + f.getDate() + ' de ' + dsEsc(f.toLocaleDateString('es-CO', {month: 'long'})) +
      ' · casos asignados a cada diseñador (sin canceladas)</div>' +
      (filas.length ? '<table><thead><tr><th>Diseñador</th><th class="n">Casos</th></tr></thead><tbody>' +
        filas.map(function(x) { return '<tr' + (x.casos ? '' : ' class="cero"') + '><td>' + dsEsc(x.nombre) + '</td><td class="n">' + x.casos + '</td></tr>'; }).join('') +
        '<tr class="total"><td>Total</td><td class="n">' + total + '</td></tr></tbody></table>'
       : '<p class="ds-prest-vacio">Este equipo no tiene diseñadores.</p>');
  }
  function dsCerrarProduccion() {
    var pop = document.getElementById('dsProdPop'); if (pop) pop.remove();
    document.removeEventListener('mousedown', dsProdFuera, true); document.removeEventListener('keydown', dsProdEsc, true);
  }
  function dsProdFuera(e) { var pop = document.getElementById('dsProdPop'); if (pop && !pop.contains(e.target) && e.target.id !== 'dsProdBtn') dsCerrarProduccion(); }
  function dsProdEsc(e) { if (e.key === 'Escape') dsCerrarProduccion(); }
  document.getElementById('dsProdBtn').addEventListener('click', function() {
    if (document.getElementById('dsProdPop')) { dsCerrarProduccion(); return; }
    var pop = document.createElement('div'); pop.className = 'ds-prod-pop'; pop.id = 'dsProdPop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Producción del día');
    document.body.appendChild(pop); dsPintarProduccion();
    var r = this.getBoundingClientRect();
    pop.style.top = (r.bottom + 6) + 'px'; pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.right - pop.offsetWidth)) + 'px';
    document.addEventListener('mousedown', dsProdFuera, true); document.addEventListener('keydown', dsProdEsc, true);
  });
  function dsRenderACargo(dia) {
    var cont = document.getElementById('dsACargo'); if (!cont) return;
    var a = dia && dia.aCargo;
    cont.innerHTML = '';
    cont.hidden = !(dia && (dia.puedeDelegar || (a && a.esYo)));
    if (cont.hidden) return;
    if (a && a.esYo) {
      cont.innerHTML = '<span class="ds-acargo-chip yo" title="Mientras tanto puedes asignar y editar los casos de todo el equipo, como el manager.">' +
        (a.activa ? 'Estás a cargo del equipo hasta el ' + dsACargoFecha(a.hasta) : 'Estarás a cargo del equipo ' + dsRangoTxt(a)) + '</span>';
      return;
    }
    if (a) {
      cont.innerHTML = '<span class="ds-acargo-chip' + (a.activa ? '' : ' prog') + '" title="' + dsEsc('Autorizó: ' + (a.asignadoPor || '—')) + '">' +
        (a.activa ? 'A cargo: ' + dsEsc(a.nombre) + ' · hasta el ' + dsACargoFecha(a.hasta) : 'Programado: ' + dsEsc(a.nombre) + ' · ' + dsRangoTxt(a)) +
        '<button type="button" id="dsACargoEditar" aria-label="Cambiar quién queda a cargo">Cambiar</button></span>';
    } else {
      cont.innerHTML = '<button type="button" class="btn gris" id="dsACargoEditar" title="Autoriza a un diseñador del equipo a asignar casos en este Schedule mientras no estás">Dejar a cargo</button>';
    }
    document.getElementById('dsACargoEditar').onclick = function() { dsModalACargo(dia); };
  }
  function dsModalACargo(dia) {
    var a = dia.aCargo, hoy = dsFechaISO(new Date());
    var bg = document.createElement('div'); bg.className = 'ds-qc-bg';
    var ops = (dia.designers || []).filter(function(d) { return !d.esManager; }).map(function(d) {
      return '<option value="' + d.id + '"' + (a && a.empleadoId === d.id ? ' selected' : '') + '>' + dsEsc(d.nombre) + '</option>'; }).join('');
    bg.innerHTML = '<div class="ds-qc ds-acargo-form" role="dialog" aria-modal="true" aria-labelledby="dsACargoTit" style="width:420px">' +
      '<h4 id="dsACargoTit">Dejar a cargo del equipo</h4>' +
      '<div class="ds-qc-sub">Mientras no estás, el diseñador elegido puede asignar y editar los casos de todo el equipo en este Schedule, igual que tú. Solo uno a la vez; se apaga solo al terminar las fechas.</div>' +
      (ops ? '<label for="dsACargoQuien">Diseñador</label><select id="dsACargoQuien">' + ops + '</select>' +
             '<div class="ds-acargo-fechas"><div><label for="dsACargoDesde">Desde</label><input type="date" id="dsACargoDesde" min="' + hoy + '" value="' + (a ? (a.desde < hoy ? hoy : a.desde) : hoy) + '"></div>' +
             '<div><label for="dsACargoHasta">Hasta</label><input type="date" id="dsACargoHasta" min="' + hoy + '" value="' + (a ? a.hasta : hoy) + '"></div></div>'
           : '<p class="ds-prest-vacio">Este equipo no tiene diseñadores asignados.</p>') +
      '<div class="ds-qc-btns">' + (a ? '<button type="button" class="btn rojo" data-ac="quitar">Quitar autorización</button>' : '') +
      '<button type="button" class="btn gris" data-ac="cancelar">Cancelar</button>' + (ops ? '<button type="button" class="btn" data-ac="guardar">Guardar</button>' : '') + '</div></div>';
    document.body.appendChild(bg);
    var teclas = function(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(); } };
    var cerrar = function() { bg.remove(); document.removeEventListener('keydown', teclas, true); };
    var listo = function(msg) { cerrar(); dsToast(msg); dsCargarDia(); };
    var falla = function(e) { alert('No se pudo guardar: ' + e.message); };
    var url = '/design/api/teams/' + DS.teamId + '/delegacion';
    bg.addEventListener('click', function(e) {
      var b = e.target.closest('[data-ac]'); if (!b) return;
      if (b.dataset.ac === 'cancelar') { cerrar(); return; }
      if (b.dataset.ac === 'quitar') { postJSON(url + '/quitar', {}).then(function() { listo('Se quitó la autorización.'); }, falla); return; }
      var sel = document.getElementById('dsACargoQuien'), de = document.getElementById('dsACargoDesde').value, ha = document.getElementById('dsACargoHasta').value;
      if (!de || !ha) { alert('Elige las fechas.'); return; }
      if (ha < de) { alert('La fecha final no puede ser antes de la inicial.'); return; }
      postJSON(url, {empleadoId: parseInt(sel.value, 10), desde: de, hasta: ha}).then(function() {
        listo(sel.options[sel.selectedIndex].text + ' queda a cargo ' + dsRangoTxt({desde: de, hasta: ha}) + '.');
      }, falla);
    });
    bg.addEventListener('mousedown', function(e) { if (e.target === bg) cerrar(); });
    document.addEventListener('keydown', teclas, true);
    (bg.querySelector('select') || bg.querySelector('[data-ac]')).focus();
  }

  function dsAplicarDia(dia, soloOrdenes) {
    DS.diaData = dia;
    DS.diaVersion = dia.version || null;  // huella del día (Schedule en vivo)
    DS.diaVersionClave = DS.teamId + ':' + dsFechaISO(dsFechaSeleccionada());
    dsRenderACargo(dia);
    dsPintarProduccion();
    dsRenderTabla('principal');
    if (DS.areaFormato === 'dual') dsRenderTabla('nightguard');
    dsRenderPrestadas();
    dsAplicarCierre();
    dsRenderKpis(dia);
    if (!soloOrdenes) dsRenderBreaks(dia);
  }

  // ---------- Schedule en vivo ----------
  // Cada pocos segundos se pregunta al servidor la "huella" del día abierto. Si cambió (alguien creó, editó o
  // borró una orden o un tiempo libre), se vuelve a pedir el día y se redibuja sin recargar la página. No se
  // redibuja mientras la persona está escribiendo en una celda, tiene celdas seleccionadas, una ventana abierta o
  // un guardado en curso: se espera a que termine. Las filas que cambiaron se marcan un momento.
  var DS_VIVO_MS = 5000;
  var dsUltimaTecla = 0, dsUltimoClic = 0;
  document.addEventListener('input', function() { dsUltimaTecla = Date.now(); }, true);
  document.addEventListener('keydown', function() { dsUltimaTecla = Date.now(); }, true);
  document.addEventListener('pointerdown', function() { dsUltimoClic = Date.now(); }, true);
  function dsOcupado() {
    var a = document.activeElement, vista = document.getElementById('dsVistaEquipo'), ahora = Date.now();
    if (window.dsEnVuelo > 0 || document.body.classList.contains('ds-cargando-dia')) return true;
    if (document.querySelector('.ds-qc-bg, #dsPop')) return true;  // ventana abierta (QC, prestado, a cargo, cantidad)
    if (a && vista && vista.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) {
      // está escribiendo (hace menos de 3 s) o tiene un cambio sin guardar en la celda: se espera
      if (ahora - dsUltimaTecla < 3000) return true;
      if (a._alEnfocar !== undefined && a.type !== 'checkbox' && a.value !== a._alEnfocar) return true;
      // una lista recién abierta: redibujar la cerraría
      if (a.tagName === 'SELECT' && ahora - Math.max(dsUltimoClic, dsUltimaTecla) < 10000) return true;
    }
    // celdas seleccionadas para copiar/pegar: se espera mientras la persona siga trabajando (15 s sin tocar nada)
    if (document.querySelector('.ds-tabla td.ds-sel, .ds-tabla td.ds-sel-activa') &&
        ahora - Math.max(dsUltimoClic, dsUltimaTecla) < 15000) return true;
    return false;
  }
  function dsHuellaFila(f) { var c = Object.assign({}, f); return JSON.stringify(c); }
  function dsVivoTick() {
    var chkTodas = document.getElementById('dsTodasAreasChk');
    if (!document.hidden && chkTodas && chkTodas.checked && !document.querySelector('.ds-overlay.open')) {
      // primero la huella (liviana): solo si cambió algo se vuelven a pedir los datos de todas las áreas
      var fT = dsFechaISO(new Date(DS.lunes.getFullYear(), DS.lunes.getMonth(), DS.lunes.getDate() + DS.diaSel));
      api('/design/api/todas-areas/version?fecha=' + fT).then(function(r) {
        if (!r || (DS.todasV && DS.todasV.f === fT && DS.todasV.v === r.v)) return;
        DS.todasV = {f: fT, v: r.v}; dsCargarTodasAreas(true);
      }).catch(function() {});
      return;
    }
    if (document.hidden || !DS.teamId || !DS.diaData || document.querySelector('.ds-overlay.open')) return;
    var vistaEq = document.getElementById('dsVistaEquipo');
    if (!vistaEq || vistaEq.style.display === 'none') return;
    var fecha = dsFechaISO(dsFechaSeleccionada()), clave = DS.teamId + ':' + fecha, url = DS.diaUrl;
    api('/design/api/dia/version?team_id=' + DS.teamId + '&fecha=' + fecha).then(function(r) {
      if (!r || DS.diaUrl !== url) return;
      if (DS.diaVersion === null || DS.diaVersionClave !== clave) { DS.diaVersion = r.v; DS.diaVersionClave = clave; return; }
      if (r.v === DS.diaVersion || dsOcupado()) return;  // sin cambios, o se espera al próximo turno
      return api(url).then(function(dia) {
        if (DS.diaUrl !== url || dsOcupado()) return;
        dia._fecha = fecha; dia._team = parseInt(clave);
        var antes = {};
        ['principal', 'nightguard', 'prestadas'].forEach(function(t) {
          (DS.diaData[t] || []).forEach(function(f) { antes[f.id] = dsHuellaFila(f); });
        });
        var sinV = function(d) { var c = Object.assign({}, d); delete c.version; delete c._fecha; delete c._team; return JSON.stringify(c); };
        var mismo = sinV(dia) === sinV(DS.diaData);
        var y = window.scrollY;
        if (mismo) { DS.diaVersion = r.v; DS.diaData.version = r.v; return; }  // fue un cambio propio: ya se ve
        var act = document.activeElement, foco = null;
        if (act && act.dataset && act.dataset.campo) {
          var trA = act.closest('tr[data-id]'), tbA = act.closest('[id^="dsTabla"]');
          if (trA && tbA) foco = {tabla: tbA.id, id: trA.dataset.id, campo: act.dataset.campo};
        }
        dsAplicarDia(dia);
        if (foco) {  // vuelve a la misma celda
          var el = document.querySelector('#' + foco.tabla + ' tr[data-id="' + foco.id + '"] [data-campo="' + foco.campo + '"]');
          if (el) el.focus({preventScroll: true});
        }
        window.scrollTo(0, y);
        ['principal', 'nightguard', 'prestadas'].forEach(function(t) {
          (dia[t] || []).forEach(function(f) {
            if (antes[f.id] === dsHuellaFila(f)) return;
            var tr = document.querySelector('#dsVistaEquipo tr[data-id="' + f.id + '"]');
            if (tr) { tr.classList.add('ds-vivo'); setTimeout(function() { tr.classList.remove('ds-vivo'); }, 2500); }
          });
        });
      });
    }).catch(function() {});
  }
  setInterval(dsVivoTick, DS_VIVO_MS);
  document.addEventListener('visibilitychange', function() { if (!document.hidden) dsVivoTick(); });

  function dsCargarDia(soloOrdenes) {
    if (!DS.teamId) return;
    var fechaPedida = dsFechaISO(dsFechaSeleccionada()), teamPedido = DS.teamId;
    var url = '/design/api/dia?team_id=' + DS.teamId + '&fecha=' + fechaPedida;
    DS.diaUrl = url;
    // Mientras llega el día nuevo, la tabla y los tiempos libres del día anterior no se pueden editar (se guardarían con otra fecha).
    document.body.classList.add('ds-cargando-dia');
    // Si falla por un corte de conexión o un error momentáneo del servidor, se reintenta solo antes de avisar.
    var pedir = function(n) {
      return api(url).catch(function(e) {
        if (n < 2 && DS.diaUrl === url && (!e.status || e.status >= 500)) return new Promise(function(r) { setTimeout(r, 1200 * (n + 1)); }).then(function() { return pedir(n + 1); });
        throw e;
      });
    };
    pedir(0).then(function(dia) {
      if (DS.diaUrl !== url) return; // llegó tarde: ya se pidió otro día/equipo
      dia._fecha = fechaPedida; dia._team = teamPedido;
      document.body.classList.remove('ds-cargando-dia');
      dsAplicarDia(dia, soloOrdenes);
      if (DS.resaltar) { // viene de la búsqueda: marca la orden encontrada
        var trR = document.querySelector('#dsVistaEquipo tr[data-id="' + DS.resaltar + '"]');
        DS.resaltar = null;
        if (trR) {
          trR.classList.add('ds-resaltada'); trR.scrollIntoView({block: 'center'});
          setTimeout(function() { trR.classList.remove('ds-resaltada'); }, 3000);
        }
      }
    }).catch(function(e) {
      if (DS.diaUrl !== url) return;
      document.body.classList.remove('ds-cargando-dia');
      DS.diaData = null;
      dsRenderACargo(null);
      dsRenderPrestadas();
      ['dsTablaPrincipal', 'dsTablaNightguard'].forEach(function(id) { var el = document.getElementById(id); if (el) el.innerHTML = ''; });
      var tl = document.getElementById('dsBreaks'); if (tl) tl.innerHTML = '<p style="color:#4b5563">Los tiempos libres se muestran cuando cargue el día.</p>';   // no quedan los del día anterior
      var cont = document.getElementById('dsTablaPrincipal');
      cont.innerHTML = '<p class="ds-err-carga">No se pudo cargar el día: <span></span> <button type="button" class="btn mini">Reintentar</button></p>';
      cont.querySelector('span').textContent = e.message;
      cont.querySelector('button').onclick = function() { dsCargarDia(); };
    });
  }

  // =====================================================================================
  // Teclado del Horario: selección de celdas, Ctrl+C / Ctrl+V (celda o bloque, también desde Excel),
  // Supr (vacía la celda), Ctrl+Z / Ctrl+Y (deshacer / rehacer). Todo pasa por la API normal, así que
  // el cierre diario se respeta igual (en un día cerrado solo cambia el QC mientras esté habilitado).
  // =====================================================================================
  var DS_CAMPOS = ['orden', 'paciente', 'centro', 'producto', 'designerId', 'designerPrestado', 'horaInicio',
                   'horaInicioDiseno', 'horaFin', 'holdMinutos', 'esferas', 'critico', 'sHold', 'fHold', 'etapa',
                   'solicitadoPor', 'situacion', 'solucion', 'clasificacion', 'soporte', 'estado', 'qc', 'qcReporte', 'notas'];
  function dsClon(o) { return JSON.parse(JSON.stringify(o)); }
  function dsMismaOrden(a, b) { return DS_CAMPOS.every(function(k) { return (a[k] == null ? '' : a[k]) === (b[k] == null ? '' : b[k]); }); }
  function dsSoloCampos(o) { var r = {}; DS_CAMPOS.forEach(function(k) { if (o[k] !== undefined) r[k] = o[k]; }); return r; }

  window.dsToast = function(m) { dsToast(m); };
  function dsToast(msg) {
    var t = document.getElementById('dsToast');
    if (!t) { t = document.createElement('div'); t.id = 'dsToast'; t.className = 'ds-toast'; document.body.appendChild(t); }
    t.innerText = msg; t.style.display = '';
    clearTimeout(t._timer); t._timer = setTimeout(function() { t.style.display = 'none'; }, 3500);
  }

  // ---------- Historial (uno por equipo + día, mientras la página esté abierta) ----------
  DS.hist = {}; DS.remap = {}; DS.histOcupado = false;
  function dsHistClave() { return DS.teamId + ':' + dsFechaISO(dsFechaSeleccionada()); }
  function dsHist() { var k = dsHistClave(); return DS.hist[k] || (DS.hist[k] = {u: [], r: []}); }
  function dsHistPush(op) {
    if (DS.histOcupado) return; // lo que hacen deshacer/rehacer no se vuelve a registrar
    var h = dsHist(); h.u.push(op); if (h.u.length > 100) h.u.shift(); h.r = [];
  }
  // Sigue la cadena de ids de órdenes recreadas (deshacer una eliminación crea la orden con otro id).
  function dsIdReal(id) {
    var vistos = {};
    while (DS.remap[id] && DS.remap[id] !== id && !vistos[id]) { vistos[id] = true; id = DS.remap[id]; }
    return id;
  }
  // Guardados en curso: deshacer/rehacer espera a que terminen para no saltarse el último cambio.
  DS.enCurso = new Set();
  function dsSeguir(promesa) {
    DS.enCurso.add(promesa);
    var fin = function() { DS.enCurso.delete(promesa); };
    promesa.then(fin, fin);
    return promesa;
  }

  // Crea órdenes en lote; `registrar` agrega la operación al historial.
  function dsCrearOrdenes(tabla, filas, registrar) {
    return postJSON('/design/api/ordenes/lote', {teamId: DS.teamId, fecha: dsFechaISO(dsFechaSeleccionada()), tabla: tabla, filas: filas})
      .then(function(creadas) {
        if (registrar) dsHistPush({tipo: 'ordenes', tabla: tabla, ediciones: [],
                                   creadas: creadas.map(function(o) { return {id: o.id, datos: dsClon(o)}; }), eliminadas: []});
        return creadas;
      });
  }
  // `campos`: solo esos campos (los que tocó la operación), para no pisar lo que otra persona cambió en la misma orden.
  function dsActualizarOrden(id, tabla, datos, campos) {
    var cuerpo = dsSoloCampos(datos);
    if (campos && campos.length) { var sub = {}; campos.forEach(function(k) { if (k in cuerpo) sub[k] = cuerpo[k]; }); cuerpo = sub; }
    return postJSON('/design/api/ordenes/' + dsIdReal(id), Object.assign(cuerpo,
      {teamId: DS.teamId, fecha: dsFechaISO(dsFechaSeleccionada()), tabla: tabla === 'prestadas' ? (datos.tabla || 'principal') : tabla}));
  }
  function dsBorrarOrden(id) { return postJSON('/design/api/ordenes/' + dsIdReal(id) + '/eliminar', {}); }

  // Ejecuta una operación hacia atrás (deshacer) o hacia adelante (rehacer).
  function dsAplicarOp(op, atras) {
    if (op.tipo === 'break') return postJSON('/design/api/breaks', atras ? op.antes : op.despues);
    var aCrear = atras ? op.eliminadas : op.creadas, aBorrar = atras ? op.creadas : op.eliminadas;
    var pasos = [];
    aBorrar.forEach(function(x) { pasos.push(dsBorrarOrden(x.id)); });
    op.ediciones.forEach(function(e) { pasos.push(dsActualizarOrden(e.id, op.tabla, atras ? e.antes : e.despues, e.campos)); });
    return Promise.all(pasos).then(function() {
      if (!aCrear.length) return;
      return dsCrearOrdenes(op.tabla, aCrear.map(function(x) { return dsSoloCampos(x.datos); }), false).then(function(nuevas) {
        aCrear.forEach(function(x, i) { // la orden recreada puede tener otro id
          var viejo = dsIdReal(x.id), nuevo = nuevas[i].id;
          if (viejo === nuevo) return;
          delete DS.remap[nuevo]; // si la base reutilizó el id, que no quede apuntando a una orden anterior
          DS.remap[viejo] = nuevo;
        });
      });
    });
  }
  function dsDeshacerRehacer(atras) {
    if (DS.histOcupado || !DS.teamId) return;
    if (DS.enCurso.size) {
      var esperar = Array.from(DS.enCurso).map(function(p) { return p.catch(function() {}); });
      Promise.all(esperar).then(function() { dsDeshacerRehacer(atras); });
      return;
    }
    var h = dsHist(), pila = atras ? h.u : h.r, otra = atras ? h.r : h.u;
    if (!pila.length) { dsToast(atras ? 'No hay nada para deshacer.' : 'No hay nada para rehacer.'); return; }
    var op = pila.pop(); DS.histOcupado = true;
    dsAplicarOp(op, atras).then(function() {
      otra.push(op); DS.histOcupado = false;
      dsCargarDia(op.tipo === 'ordenes');
    }).catch(function(e) {
      DS.histOcupado = false; pila.push(op);
      alert('No se pudo ' + (atras ? 'deshacer' : 'rehacer') + ': ' + e.message); dsCargarDia();
    });
  }

  // ---------- Selección de celdas ----------
  DS.sel = null; // {tabla, r1, c1, r2, c2} (filas/columnas visibles de la tabla)
  function dsTablaDe(el) { var cont = el.closest('#dsTablaPrincipal, #dsTablaNightguard'); return cont ? (cont.id === 'dsTablaPrincipal' ? 'principal' : 'nightguard') : null; }
  // Solo las filas visibles (las ocultas no entran en la selección, copiar ni pegar)
  function dsFilasDom(tabla) { return Array.prototype.slice.call(document.querySelectorAll('#' + (tabla === 'principal' ? 'dsTablaPrincipal' : 'dsTablaNightguard') + ' tbody tr:not(.ds-oculta)')); }
  function dsCoord(td) { var tr = td.parentNode; return {r: dsFilasDom(dsTablaDe(td)).indexOf(tr), c: parseInt(td.dataset.col)}; }
  function dsPintarSel() {
    document.querySelectorAll('.ds-tabla td.ds-sel, .ds-tabla td.ds-sel-activa').forEach(function(td) { td.classList.remove('ds-sel', 'ds-sel-activa'); });
    var s = DS.sel; if (!s) return;
    var multi = s.r1 !== s.r2 || s.c1 !== s.c2;
    dsFilasDom(s.tabla).forEach(function(tr, r) {
      if (r < Math.min(s.r1, s.r2) || r > Math.max(s.r1, s.r2)) return;
      tr.querySelectorAll('td[data-col]').forEach(function(td) {
        var c = parseInt(td.dataset.col);
        if (c >= Math.min(s.c1, s.c2) && c <= Math.max(s.c1, s.c2) && multi) td.classList.add('ds-sel');
      });
    });
    var trA = dsFilasDom(s.tabla)[s.r2]; var tdA = trA && trA.querySelector('td[data-col="' + s.c2 + '"]');
    if (tdA && multi) tdA.classList.add('ds-sel-activa');
  }
  // Celdas seleccionadas como [{tr, td, el, c, fila, col}] en orden de filas/columnas.
  function dsCeldasSel() {
    var s = DS.sel; if (!s) return [];
    var spec = dsSpec(s.tabla), out = [];
    dsFilasDom(s.tabla).forEach(function(tr, r) {
      if (r < Math.min(s.r1, s.r2) || r > Math.max(s.r1, s.r2)) return;
      for (var c = Math.min(s.c1, s.c2); c <= Math.max(s.c1, s.c2); c++) {
        var td = tr.querySelector('td[data-col="' + c + '"]');
        if (td) out.push({tr: tr, td: td, el: td.querySelector('[data-campo]'), c: c, spec: spec[c], fila: r - Math.min(s.r1, s.r2), col: c - Math.min(s.c1, s.c2)});
      }
    });
    return out;
  }

  var dsArrastre = null;
  document.addEventListener('mousedown', function(e) {
    var td = e.target.closest && e.target.closest('#dsTablaPrincipal td[data-col], #dsTablaNightguard td[data-col]');
    if (!td) { if (!e.target.closest('#dsTablaPrincipal .ds-tabla, #dsTablaNightguard .ds-tabla')) { DS.sel = null; dsPintarSel(); } return; }
    var tabla = dsTablaDe(td), k = dsCoord(td);
    // Listas: el primer clic solo selecciona la celda (como Excel) para poder copiar/pegar/Supr;
    // el segundo clic sobre la celda ya seleccionada abre la lista.
    var lista = e.target.tagName === 'SELECT' ? e.target : null;
    if (e.shiftKey && DS.sel && DS.sel.tabla === tabla) { DS.sel.r2 = k.r; DS.sel.c2 = k.c; e.preventDefault(); }
    else DS.sel = {tabla: tabla, r1: k.r, c1: k.c, r2: k.r, c2: k.c};
    dsArrastre = {tabla: tabla, td: td}; // antes de dar el foco, para que "focusin" no reinicie la selección
    if (lista && !lista.disabled && document.activeElement !== lista) { e.preventDefault(); lista.focus(); }
    dsPintarSel();
  });
  document.addEventListener('mouseover', function(e) {
    if (!dsArrastre || !(e.buttons & 1)) return;
    var td = e.target.closest && e.target.closest('#dsTablaPrincipal td[data-col], #dsTablaNightguard td[data-col]');
    if (!td || td === dsArrastre.td || dsTablaDe(td) !== dsArrastre.tabla) return;
    var k = dsCoord(td); DS.sel.r2 = k.r; DS.sel.c2 = k.c;
    td.closest('#dsTablaPrincipal .ds-tabla, #dsTablaNightguard .ds-tabla').classList.add('ds-arrastrando');
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    dsPintarSel();
  });
  document.addEventListener('mouseup', function() {
    if (dsArrastre) document.querySelectorAll('.ds-tabla.ds-arrastrando').forEach(function(t) { t.classList.remove('ds-arrastrando'); });
    dsArrastre = null;
  });
  // Al entrar a una celda con Tab se selecciona esa celda.
  document.addEventListener('focusin', function(e) {
    var el = e.target;
    if (el.matches && el.matches('.ds-tabla [data-campo], .ds-tl-card [data-campo]')) el._alEnfocar = el.value;
    var td = el.closest && el.closest('#dsTablaPrincipal td[data-col], #dsTablaNightguard td[data-col]');
    if (td && !dsArrastre) {
      var k = dsCoord(td), tabla = dsTablaDe(td);
      var s = DS.sel;
      if (!(s && s.tabla === tabla && (s.r1 !== s.r2 || s.c1 !== s.c2) && k.r >= Math.min(s.r1, s.r2) && k.r <= Math.max(s.r1, s.r2) && k.c >= Math.min(s.c1, s.c2) && k.c <= Math.max(s.c1, s.c2))) {
        DS.sel = {tabla: tabla, r1: k.r, c1: k.c, r2: k.r, c2: k.c}; dsPintarSel();
      }
    }
  });

  // ---------- Valores de celda: texto para copiar y conversión al pegar ----------
  function dsTextoCelda(el, c) {
    if (!el) return '';
    if (c.t === 'checkbox') return el.checked ? 'TRUE' : 'FALSE';
    if (el.tagName === 'SELECT') return el.value ? (c.t === 'designer' ? el.options[el.selectedIndex].text : el.value) : '';
    return el.value;
  }
  function dsNormHora(v) {
    var m = String(v).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap])?\.?\s*m?\.?$/i);
    if (!m) return null;
    var h = parseInt(m[1]), mi = parseInt(m[2]);
    if (m[3]) { var pm = m[3].toLowerCase() === 'p'; if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
    if (h > 23 || mi > 59) return null;
    return String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0');
  }
  var DS_SI = ['true', 'verdadero', '1', 'x', 'si', 'sí', 'yes', '✓', '✔'];
  // Devuelve el valor para el elemento, o undefined si no corresponde a ninguna opción válida.
  function dsValorPegado(el, c, txt) {
    var v = String(txt == null ? '' : txt).trim();
    if (c.t === 'checkbox') return DS_SI.indexOf(v.toLowerCase()) >= 0;
    if (v === '') return c.t === 'number' ? 0 : '';
    if (c.t === 'number') { var n = parseFloat(v.replace(',', '.')); return isNaN(n) ? undefined : n; }
    if (c.t === 'time') { var h = dsNormHora(v); return h === null ? undefined : h; }
    if (el.tagName === 'SELECT') {
      var low = v.toLowerCase();
      var opt = Array.prototype.find.call(el.options, function(o) { return o.value && (o.value.toLowerCase() === low || o.text.toLowerCase() === low); });
      if (!opt) return undefined;
      return c.t === 'designer' ? parseInt(opt.value) : opt.value;
    }
    return v;
  }
  function dsValorBase(c) { return c.t === 'checkbox' ? false : (c.t === 'number' ? 0 : (c.t === 'designer' ? null : '')); }

  // Aplica valores a varias celdas: [{tr, spec, valor}] + filas nuevas (arreglo de {campo: valor}).
  // Todo en una sola operación de historial; al final se redibujan las tablas.
  function dsAplicarLote(tabla, cambios, extras) {
    if (DS.diaData && DS.diaData.puedeQc === false) cambios = cambios.filter(function(x) { return x.spec.k !== 'qc'; });
    var filas = DS.diaData[tabla] || [], porFila = new Map();
    cambios.forEach(function(x) {
      if (!porFila.has(x.tr)) porFila.set(x.tr, {});
      porFila.get(x.tr)[x.spec.k] = x.valor;
    });
    var ediciones = [], nuevas = [], pasos = [];
    porFila.forEach(function(valores, tr) {
      if (tr.dataset.id === 'nuevo') { if (Object.keys(valores).some(function(k) { return valores[k] !== dsValorBase({t: ''}) && valores[k] !== null && valores[k] !== false && valores[k] !== 0; })) nuevas.push(valores); return; }
      var id = parseInt(tr.dataset.id), local = filas.find(function(f) { return f.id === id; });
      if (!local) return;
      var antes = dsClon(local), despues = Object.assign(dsClon(local), valores);
      if (dsMismaOrden(antes, despues)) return;
      ediciones.push({id: id, antes: antes, despues: despues, campos: Object.keys(valores)});
    });
    nuevas = nuevas.concat(extras || []);
    if (!ediciones.length && !nuevas.length) return Promise.resolve();
    ediciones.forEach(function(e) { pasos.push(dsActualizarOrden(e.id, tabla, e.despues, e.campos).then(function(o) { e.despues = dsClon(o); })); });
    return Promise.all(pasos).then(function() {
      return nuevas.length && dsPuedeCrear() ? dsCrearOrdenes(tabla, nuevas, false) : [];
    }).then(function(creadas) {
      dsHistPush({tipo: 'ordenes', tabla: tabla, ediciones: ediciones,
                  creadas: (creadas || []).map(function(o) { return {id: o.id, datos: dsClon(o)}; }), eliminadas: []});
      dsCargarDia(true);
    }).catch(function(e) { alert('Error guardando: ' + e.message); dsCargarDia(true); });
  }

  // ¿El foco está en el Horario (sin paneles superpuestos abiertos)?
  function dsEnHorario() {
    if (!DS.teamId || document.querySelector('.ds-overlay.open') || document.getElementById('dsPop') || document.getElementById('dsQc') || document.getElementById('dsPrestado')) return false;
    var chk = document.getElementById('dsTodasAreasChk');
    return !(chk && chk.checked);
  }
  function dsEsTexto(el) { return el && el.tagName === 'INPUT' && el.type === 'text'; }

  // ---------- Ctrl+C ----------
  document.addEventListener('copy', function(e) {
    if (!dsEnHorario() || !DS.sel) return;
    var el = document.activeElement, celdas = dsCeldasSel();
    if (!celdas.length) return;
    var multi = celdas.length > 1;
    // Texto parcialmente seleccionado dentro de una celda: copia normal del navegador.
    if (!multi && dsEsTexto(el) && el.selectionStart !== el.selectionEnd && !(el.selectionStart === 0 && el.selectionEnd === el.value.length)) return;
    if (!multi && !(el && el.closest && el.closest('#dsTablaPrincipal .ds-tabla, #dsTablaNightguard .ds-tabla'))) return;
    var filas = [];
    celdas.forEach(function(x) { (filas[x.fila] = filas[x.fila] || [])[x.col] = dsTextoCelda(x.el, x.spec); });
    e.clipboardData.setData('text/plain', filas.map(function(f) { return f.join('\t'); }).join('\n'));
    e.preventDefault();
    if (multi) dsToast(celdas.length + ' celdas copiadas.');
  });

  // ---------- Ctrl+V ----------
  document.addEventListener('paste', function(e) {
    if (!dsEnHorario() || !DS.sel) return;
    var el = document.activeElement;
    var txt = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
    var bloque = txt.replace(/\r/g, '').replace(/\n+$/, '').split('\n').map(function(l) { return l.split('\t'); });
    var unValor = bloque.length === 1 && bloque[0].length === 1;
    var celdasSel = dsCeldasSel();
    // Un solo valor escrito dentro de una celda de texto: pegado normal (se guarda al salir de la celda).
    if (unValor && celdasSel.length <= 1 && dsEsTexto(el) && el.closest('#dsTablaPrincipal .ds-tabla, #dsTablaNightguard .ds-tabla')) return;
    if (!(el && el.closest && el.closest('#dsTablaPrincipal .ds-tabla, #dsTablaNightguard .ds-tabla')) && celdasSel.length <= 1) return;
    e.preventDefault();
    var s = DS.sel, tabla = s.tabla, spec = dsSpec(tabla);
    var trs = dsFilasDom(tabla), r0 = Math.min(s.r1, s.r2), c0 = Math.min(s.c1, s.c2);
    var cambios = [], extras = [], omitidos = 0, bloqueados = 0, qcOmitidos = 0;
    var poner = function(tr, c, texto) {
      var cs = spec[c]; if (!cs) return;
      var celda = tr ? tr.querySelector('td[data-col="' + c + '"] [data-campo]') : null;
      if (celda && celda.disabled) { bloqueados++; return; }
      var ref = celda || document.querySelector('#' + (tabla === 'principal' ? 'dsTablaPrincipal' : 'dsTablaNightguard') + ' td[data-col="' + c + '"] [data-campo]');
      var v = dsValorPegado(ref, cs, texto);
      if (v === undefined) { omitidos++; return; }
      if (cs.k === 'qc' && v === true) { qcOmitidos++; return; } // el QC se marca con su recuadro de hallazgos
      return {spec: cs, valor: v};
    };
    if (unValor && celdasSel.length > 1) {
      // Un valor sobre un rango: se repite en todas las celdas seleccionadas (como Excel).
      celdasSel.forEach(function(x) { var r = poner(x.tr, x.c, bloque[0][0]); if (r) cambios.push({tr: x.tr, spec: r.spec, valor: r.valor}); });
    } else {
      bloque.forEach(function(fila, i) {
        var tr = trs[r0 + i], nueva = {};
        fila.forEach(function(texto, j) {
          var r = poner(tr, c0 + j, texto); if (!r) return;
          if (tr) cambios.push({tr: tr, spec: r.spec, valor: r.valor}); else nueva[r.spec.k] = r.valor;
        });
        if (!tr && Object.keys(nueva).length) extras.push(nueva);
      });
      if (extras.length && !dsPuedeCrear()) { bloqueados += extras.length; extras = []; }
      DS.sel = {tabla: tabla, r1: r0, c1: c0, r2: r0 + bloque.length - 1, c2: c0 + Math.max.apply(null, bloque.map(function(f) { return f.length; })) - 1};
    }
    var avisos = [];
    if (omitidos) avisos.push(omitidos + ' valor(es) no coinciden con las opciones de la lista y no se pegaron');
    if (bloqueados) avisos.push(bloqueados + ' celda(s) no editables' + (dsDiaCerrado() ? ' por el cierre del día' : ''));
    if (qcOmitidos) avisos.push('el QC no se marca pegando: márcalo en su checkbox para registrar los hallazgos');
    if (avisos.length) dsToast(avisos.join('. ') + '.');
    dsAplicarLote(tabla, cambios, extras).then(function() { dsPintarSel(); });
  });

  // ---------- Supr / Ctrl+Z / Ctrl+Y ----------
  document.addEventListener('keydown', function(e) {
    if (!dsEnHorario()) return;
    var el = document.activeElement;
    var enTabla = el && el.closest && el.closest('#dsTablaPrincipal .ds-tabla, #dsTablaNightguard .ds-tabla');
    var enTarjeta = el && el.closest && el.closest('.ds-tl-card');
    var ctrl = e.ctrlKey || e.metaKey, k = (e.key || '').toLowerCase();

    if (e.key === 'Delete' && !ctrl) {
      if (enTabla || (DS.sel && dsCeldasSel().length > 1)) {
        e.preventDefault();
        var celdas = dsCeldasSel().filter(function(x) { return x.el && !x.el.disabled; });
        if (celdas.length) dsAplicarLote(DS.sel.tabla, celdas.map(function(x) { return {tr: x.tr, spec: x.spec, valor: dsValorBase(x.spec)}; }), []);
        return;
      }
      // Tiempos libres: Supr vacía la hora (la ausencia y el checkbox de descanso no se tocan).
      if (enTarjeta && el.type === 'time' && !el.disabled) {
        e.preventDefault(); el.value = ''; el._alEnfocar = '';
        el.dispatchEvent(new Event('blur'));
      }
      return;
    }
    if (!ctrl) return;
    var deshacer = k === 'z' && !e.shiftKey, rehacer = k === 'y' || (k === 'z' && e.shiftKey);
    if (!deshacer && !rehacer) return;
    // Mientras se escribe en una celda de texto, Ctrl+Z deshace lo escrito (comportamiento normal del navegador).
    if (deshacer && dsEsTexto(el) && (enTabla || enTarjeta) && el.value !== el._alEnfocar) return;
    e.preventDefault();
    if (el && el.blur && (enTabla || enTarjeta)) el.blur();
    setTimeout(function() { dsDeshacerRehacer(deshacer); }, 0); // deja terminar el guardado del blur
  });

  // ---------- Vista "Todas las áreas" (solo aprobadores/admins) ----------
  // Usa la misma semana/día que la vista de equipo (DS.lunes / DS.diaSel), manejada desde la fila de áreas.
  function dsRenderDiasTodas() {
    var fin = new Date(DS.lunes); fin.setDate(fin.getDate() + 4);
    document.getElementById('dsRangoSemana').innerText = dsRangoCorto(DS.lunes, fin);
    dsSincronizarFiltrosFecha();
    var cont = document.getElementById('dsDiaTabsTodas'); cont.innerHTML = '';
    for (var i = 0; i < 5; i++) {
      var d = new Date(DS.lunes); d.setDate(d.getDate() + i);
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'ds-dia' + (i === DS.diaSel ? ' activo' : '');
      btn.innerText = NOMBRES_DIAS[i] + ' ' + d.getDate(); // el mes ya se ve en el rango de la semana
      btn.onclick = (function(idx) { return function() { DS.diaSel = idx; dsRenderDiasTodas(); dsCargarTodasAreas(); }; })(i);
      cont.appendChild(btn);
    }
  }
  var COLS_RESUMEN = [
    {k:'orden', l:'Orden'}, {k:'paciente', l:'Paciente'}, {k:'centro', l:'Centro'},
    {k:'producto', l:'Producto'}, {k:'designerNombre', l:'Diseñador'}, {k:'estado', l:'Estado'},
  ];
  // Clase de color de la fila según el estado (mismos colores que el horario del equipo)
  function dsClaseEstado(estado) {
    var e = String(estado || '').trim().toLowerCase();
    return {'hold': 'ds-fila-hold', 'ready to design': 'ds-fila-ready', 'html': 'ds-fila-html', 'approved': 'ds-fila-aprobada', 'canceled': 'ds-fila-cancelada'}[e] || '';
  }
  function dsRenderResumenTabla(filas) {
    if (!filas.length) return '<p style="color:#4b5563;font-size:12px;margin:4px 0 14px">Sin órdenes este día.</p>';
    var s = DS.todasSort, html = '<table class="ds-tabla" style="margin-bottom:14px"><thead><tr>';
    COLS_RESUMEN.forEach(function(c) {
      var on = s && s.k === c.k;
      html += '<th class="ds-th-sort' + (on ? ' on' : '') + '" data-tsort="' + c.k + '" title="Ordenar alfabéticamente">' + c.l +
              '<span class="ds-sort-ind">' + (on ? (s.dir === 1 ? '▲' : '▼') : '↕') + '</span></th>';
    });
    html += '</tr></thead><tbody>';
    filas.forEach(function(f) {
      html += '<tr class="' + dsClaseEstado(f.estado) + '">' + COLS_RESUMEN.map(function(c) {
        var v = dsEsc(f[c.k] || '—');
        return '<td>' + (c.k === 'estado' ? '<span data-campo="estado">' + v + '</span>' : v) + '</td>';
      }).join('') + '</tr>';
    });
    return html + '</tbody></table>';
  }
  // Resumen de un equipo para la pestaña cerrada: total del día, por estado y por diseñador (sin canceladas)
  function dsResumenEquipo(ordenes) {
    var activas = ordenes.filter(function(f) { return String(f.estado || '').trim().toLowerCase() !== 'canceled'; });
    var est = {}, dis = {};
    ordenes.forEach(function(f) { var k = f.estado || 'Sin estado'; est[k] = (est[k] || 0) + 1; });
    activas.forEach(function(f) { var k = f.designerNombre || 'Sin asignar'; dis[k] = (dis[k] || 0) + 1; });
    var chips = Object.keys(est).sort(function(a, b) { return est[b] - est[a]; }).map(function(k) {
      return '<span class="ds-tq-chip ' + dsClaseEstado(k) + '">' + dsEsc(k) + ' <b>' + est[k] + '</b></span>';
    }).join('');
    var disenadores = Object.keys(dis).sort(function(a, b) { return dis[b] - dis[a] || a.localeCompare(b); }).map(function(k) {
      return '<span class="ds-tq-dis">' + dsEsc(k) + ' <b>' + dis[k] + '</b></span>';
    }).join('');
    return {total: activas.length, chips: chips, disenadores: disenadores};
  }
  // Una sola petición trae áreas, equipos y órdenes del día (antes: 1 por área + 1 por equipo).
  // vivo = refresco en vivo (cada 5 s, como el horario del equipo): sin "Cargando…" y solo redibuja si algo cambió
  function dsCargarTodasAreas(vivo) {
    var fecha = dsFechaISO(new Date(DS.lunes.getFullYear(), DS.lunes.getMonth(), DS.lunes.getDate() + DS.diaSel));
    var cont = document.getElementById('dsTodasAreasCont');
    if (vivo && DS.todasFecha !== fecha) return;
    if (!vivo) { cont.innerHTML = '<p style="color:#4b5563">Cargando…</p>'; DS.todasJson = null; }
    DS.todasFecha = fecha;
    api('/design/api/todas-areas?fecha=' + fecha).catch(function(e) {
      if (!vivo && DS.todasFecha === fecha) { cont.innerHTML = '<p class="ds-err-carga"></p>'; cont.firstChild.textContent = 'No se pudo cargar: ' + e.message; }
      return null;
    }).then(function(areas) {
      if (!areas || DS.todasFecha !== fecha) return; // cambió el día/semana mientras cargaba
      var j = JSON.stringify(areas); if (vivo && j === DS.todasJson) return; DS.todasJson = j;
      DS.todasDatos = areas;
      dsPintarTodas();
    });
  }
  // Filtros (para todos los equipos a la vez) y orden por columna; se conservan con el refresco en vivo.
  DS.todasFiltro = {}; DS.todasSort = null;
  function dsTodasFiltrar(lista) {
    var fl = DS.todasFiltro, q = String(fl.q || '').trim().toLowerCase();
    var out = lista.filter(function(f) {
      if (q && (String(f.orden || '') + ' ' + String(f.paciente || '')).toLowerCase().indexOf(q) < 0) return false;
      return ['centro', 'producto', 'designerNombre', 'estado'].every(function(k) { return !fl[k] || String(f[k] || '') === fl[k]; });
    });
    var s = DS.todasSort;
    if (s) out = out.slice().sort(function(a, b) { return s.dir * String(a[s.k] || '').localeCompare(String(b[s.k] || ''), 'es', {numeric: true, sensitivity: 'base'}); });
    return out;
  }
  function dsTodasOpciones(areas) {
    var vals = {centro: {}, producto: {}, designerNombre: {}, estado: {}};
    areas.forEach(function(a) { a.teams.forEach(function(t) { t.ordenes.forEach(function(f) { Object.keys(vals).forEach(function(k) { if (f[k]) vals[k][f[k]] = 1; }); }); }); });
    document.querySelectorAll('#dsTodasFiltros select[data-tf]').forEach(function(sel) {
      var k = sel.dataset.tf, actual = DS.todasFiltro[k] || '', primero = sel.options[0].outerHTML;
      var lista = Object.keys(vals[k]); if (actual && lista.indexOf(actual) < 0) lista.push(actual);
      lista.sort(function(a, b) { return a.localeCompare(b, 'es', {numeric: true, sensitivity: 'base'}); });
      sel.innerHTML = primero + lista.map(function(v) { return '<option>' + dsEsc(v) + '</option>'; }).join('');
      sel.value = actual; sel.classList.toggle('on', !!actual);
    });
  }
  (function() {
    var bar = document.getElementById('dsTodasFiltros'); if (!bar) return;
    bar.querySelectorAll('[data-tf]').forEach(function(el) {
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', function() {
        DS.todasFiltro[el.dataset.tf] = el.value; if (el.tagName === 'SELECT') el.classList.toggle('on', !!el.value); dsPintarTodas();
      });
    });
    document.getElementById('dsTodasLimpiar').onclick = function() {
      DS.todasFiltro = {}; DS.todasSort = null; bar.querySelectorAll('[data-tf]').forEach(function(el) { el.value = ''; el.classList.remove('on'); }); dsPintarTodas();
    };
  })();
  function dsPintarTodas() {
    var cont = document.getElementById('dsTodasAreasCont'), areas = DS.todasDatos; if (!areas) return;
    dsTodasOpciones(areas);
    var filtrando = Object.keys(DS.todasFiltro).some(function(k) { return DS.todasFiltro[k]; });
    {
      var conEquipos = areas.filter(function(a) { return a.teams.length; });
      if (!conEquipos.length) { cont.innerHTML = '<p style="color:#4b5563">No hay equipos configurados en ninguna área todavía.</p>'; return; }
      // Pestañas por equipo: cerradas por defecto (se ve el resumen de producción); se recuerda cuáles se abrieron
      // mientras la página siga abierta, también con el refresco en vivo.
      DS.todasAbiertas = DS.todasAbiertas || {};
      var html = '';
      conEquipos.forEach(function(a) {
        var totalArea = 0;
        var equipos = a.teams.map(function(t) {
          var filas = dsTodasFiltrar(t.ordenes);
          if (filtrando && !filas.length) return '';  // con filtro, solo los equipos que tienen coincidencias
          var r = dsResumenEquipo(filas), abierta = !!DS.todasAbiertas[t.id];
          totalArea += r.total;
          return '<div class="ds-tq' + (abierta ? ' abierta' : '') + '" data-tq="' + t.id + '">' +
            '<div class="ds-tq-cab">' +
              '<button type="button" class="ds-tq-btn" aria-expanded="' + abierta + '" title="' + (abierta ? 'Ocultar' : 'Mostrar') + ' las órdenes del equipo">' +
                '<span class="ds-tq-flecha">▸</span><b>' + dsEsc(t.nombre) + '</b><span class="ds-tq-total">' + r.total + ' caso' + (r.total === 1 ? '' : 's') + '</span></button>' +
              '<span class="ds-tq-chips">' + r.chips + '</span>' +
              '<button type="button" class="btn gris mini" data-ir-equipo="' + a.id + ':' + a.formato + ':' + t.id + '">Ver equipo →</button>' +
            '</div>' +
            (r.disenadores ? '<div class="ds-tq-diss">' + r.disenadores + '</div>' : '') +
            '<div class="ds-tq-cuerpo"' + (abierta ? '' : ' hidden') + '>' + dsRenderResumenTabla(filas) + '</div>' +
          '</div>';
        }).join('');
        if (filtrando && !equipos) return;
        html += '<div class="ds-panel"><div class="ds-tq-area"><h3 style="font-size:16px;color:#111827;margin:0">' + dsEsc(a.nombre) +
          ' <span style="font-weight:500;color:#6b7280;font-size:13px">· ' + totalArea + ' casos</span></h3>' +
          '<span><button type="button" class="btn gris mini" data-tq-todos="1">Mostrar todos</button> <button type="button" class="btn gris mini" data-tq-todos="0">Ocultar todos</button></span></div>' +
          equipos + '</div>';
      });
      cont.innerHTML = html || '<p style="color:#4b5563">Ninguna orden coincide con los filtros.</p>';
      cont.querySelectorAll('th[data-tsort]').forEach(function(th) {
        th.addEventListener('click', function() {  // A→Z, Z→A, orden original (como el horario del equipo)
          var k = th.dataset.tsort, act = DS.todasSort;
          DS.todasSort = (!act || act.k !== k) ? {k: k, dir: 1} : (act.dir === 1 ? {k: k, dir: -1} : null);
          dsPintarTodas();
        });
      });
      var abrir = function(caja, on) {
        caja.classList.toggle('abierta', on); caja.querySelector('.ds-tq-cuerpo').hidden = !on;
        var b = caja.querySelector('.ds-tq-btn'); b.setAttribute('aria-expanded', on); b.title = (on ? 'Ocultar' : 'Mostrar') + ' las órdenes del equipo';
        if (on) DS.todasAbiertas[caja.dataset.tq] = true; else delete DS.todasAbiertas[caja.dataset.tq];
      };
      cont.querySelectorAll('.ds-tq-btn').forEach(function(b) {
        b.addEventListener('click', function() { var caja = b.closest('.ds-tq'); abrir(caja, !caja.classList.contains('abierta')); });
      });
      cont.querySelectorAll('[data-tq-todos]').forEach(function(b) {
        b.addEventListener('click', function() { var on = b.dataset.tqTodos === '1'; b.closest('.ds-panel').querySelectorAll('.ds-tq').forEach(function(c) { abrir(c, on); }); });
      });
      cont.querySelectorAll('[data-ir-equipo]').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var partes = btn.dataset.irEquipo.split(':');
          dsIrAEquipo({id: parseInt(partes[0]), formato: partes[1]}, parseInt(partes[2]));
        });
      });
    }
  }
  function dsMostrarVista(todasAreas) {
    document.getElementById('dsVistaNormal').style.display = todasAreas ? 'none' : '';
    document.getElementById('dsVistaTodasAreas').style.display = todasAreas ? '' : 'none';
    dsActualizarTitulo();
    dsActualizarSemanaCtrl();
    // La semana es compartida: al volver a la vista de equipo se recarga por si cambió en la de todas las áreas.
    if (todasAreas) { dsRenderDiasTodas(); dsCargarTodasAreas(); }
    else { dsRenderDias(); dsCargarDia(); }
  }
  var todasAreasChk = document.getElementById('dsTodasAreasChk');
  if (todasAreasChk) {
    todasAreasChk.addEventListener('change', function() { dsMostrarVista(this.checked); });
  }

  // ---------- Wiring filtros de fecha ----------
  document.getElementById('dsMesFiltro').addEventListener('change', function() {
    dsPoblarFiltroSemana();
    document.getElementById('dsSemanaFiltro').selectedIndex = 0;
    dsAplicarSemanaFiltro();
  });
  document.getElementById('dsSemanaFiltro').addEventListener('change', dsAplicarSemanaFiltro);
  dsPoblarFiltroMes();

  dsRenderDias();
  dsCargarAreas();
})();
;
function ddApi(url) { return window.dsFetchJSON(url); }
function ddEsc(v) { return String(v == null ? '' : v).replace(/</g, '&lt;'); }
function ddMin(m) { return Math.floor(m/60) + 'h ' + Math.round(m%60) + 'm'; }

// Aprobador: solo los equipos que maneja (null = admin, ve todos).
var DD_PROPIOS = window.DS_CFG.dashTeams;
function ddCambioArea() {
  var areaId = document.getElementById('ddArea').value;
  var sel = document.getElementById('ddTeam'); sel.innerHTML = '<option value="">-- Todos --</option>';
  var tok = ddCambioArea.tok = (ddCambioArea.tok || 0) + 1; // dos cambios rápidos ya no mezclan equipos
  if (!areaId) return;
  ddApi('/design/api/teams?area_id=' + areaId).then(function(teams) {
    if (tok !== ddCambioArea.tok) return;
    sel.innerHTML = '<option value="">' + (DD_PROPIOS ? '-- Mis equipos --' : '-- Todos --') + '</option>';
    teams.filter(function(t) { return !DD_PROPIOS || DD_PROPIOS.indexOf(t.id) >= 0; })
         .forEach(function(t) { var o = document.createElement('option'); o.value = t.id; o.text = t.nombre; sel.appendChild(o); });
  });
}

var DD_ULTIMO = null;
function ddIso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
function ddRapido(r) {
  document.querySelectorAll('.dd-rapidos button').forEach(function(b) { b.classList.toggle('on', b.dataset.r === r); });
  if (r) {
    var hoy = new Date(), desde = new Date(hoy), hasta = new Date(hoy);
    if (r === 'semana') { var dw = (hoy.getDay() + 6) % 7; desde.setDate(hoy.getDate() - dw); }
    if (r === 'mes') desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    if (r === 'mesAnt') { desde = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1); hasta = new Date(hoy.getFullYear(), hoy.getMonth(), 0); }
    document.getElementById('ddDesde').value = r === 'todo' ? '' : ddIso(desde);
    document.getElementById('ddHasta').value = r === 'todo' ? '' : ddIso(hasta);
  }
  ddCargar();
}
function ddLimpiar() {
  ['ddTeam', 'ddDesigner', 'ddProducto', 'ddEstado', 'ddQc'].forEach(function(id) { document.getElementById(id).value = ''; });
  document.getElementById('ddDesignerTxt').value = '';
  if (document.getElementById('ddArea').value) { document.getElementById('ddArea').value = ''; ddCambioArea(); }
  ddRapido('mes');
}
function ddCargarPronto() { clearTimeout(ddCargarPronto.t); ddCargarPronto.t = setTimeout(ddCargar, 350); }
function ddLlenarSelect(id, lista, valor, texto, todos) {
  var sel = document.getElementById(id), actual = sel.value;
  sel.innerHTML = '<option value="">' + (todos || '-- Todos --') + '</option>';
  lista.forEach(function(x) { var o = document.createElement('option'); o.value = valor(x); o.text = texto(x); sel.appendChild(o); });
  if (actual && !Array.prototype.some.call(sel.options, function(o) { return o.value === actual; })) {
    var o = document.createElement('option'); o.value = actual; o.text = actual.indexOf('libre:') === 0 ? actual.slice(6) : actual; sel.appendChild(o);
  }
  sel.value = actual;
}
function ddTiempo(m) { return m ? ddMin(m) : '—'; }
function ddPct(a, b) { return b ? Math.round(a * 100 / b) + '%' : '—'; }

function ddCargar() {
  var params = new URLSearchParams();
  var area = document.getElementById('ddArea').value, team = document.getElementById('ddTeam').value;
  if (team) params.set('team_id', team); else if (area) params.set('area_id', area);
  var dsg = document.getElementById('ddDesigner').value;
  if (dsg) { if (dsg.indexOf('libre:') === 0) params.set('designer_nombre', dsg.slice(6)); else params.set('designer_id', dsg); }
  var txt = document.getElementById('ddDesignerTxt').value.trim(); if (txt && !params.get('designer_nombre')) params.set('designer_nombre', txt);
  var producto = document.getElementById('ddProducto').value; if (producto) params.set('producto', producto);
  var estado = document.getElementById('ddEstado').value; if (estado) params.set('estado', estado);
  var qc = document.getElementById('ddQc').value; if (qc) params.set('qc', qc);
  var desde = document.getElementById('ddDesde').value; if (desde) params.set('fecha_desde', desde);
  var hasta = document.getElementById('ddHasta').value; if (hasta) params.set('fecha_hasta', hasta);

  var tok = ddCargar.tok = (ddCargar.tok || 0) + 1;
  document.getElementById('ddKpis').style.opacity = '.5';
  ddApi('/design/api/dashboard?' + params.toString()).catch(function(e) {
    if (tok !== ddCargar.tok) return null;
    document.getElementById('ddKpis').style.opacity = '';
    document.getElementById('ddKpis').innerHTML = '<div style="color:#b91c1c;padding:10px"></div>';
    document.getElementById('ddKpis').firstChild.textContent = 'No se pudo cargar el dashboard: ' + e.message;
    return null;
  }).then(function(data) {
    if (!data || tok !== ddCargar.tok) return;
    DD_ULTIMO = data;
    var k = data.kpis, total = data.totalCasos;
    document.getElementById('ddKpis').style.opacity = '';
    ddLlenarSelect('ddDesigner', data.opciones.disenadores, function(d) { return d.clave; }, function(d) { return d.nombre; });
    ddLlenarSelect('ddProducto', data.opciones.productos, function(p) { return p; }, function(p) { return p; });
    ddLlenarSelect('ddEstado', data.opciones.estados, function(p) { return p; }, function(p) { return p; });
    var nomSel = document.getElementById('ddDesigner'), fa = document.getElementById('ddFiltroActivo');
    var quien = nomSel.value ? nomSel.options[nomSel.selectedIndex].text : txt;
    fa.innerHTML = quien ? 'Mostrando solo: <b></b> <button type="button" onclick="document.getElementById(\'ddDesigner\').value=\'\';document.getElementById(\'ddDesignerTxt\').value=\'\';ddCargar()">✕ quitar</button>' : '';
    if (quien) fa.querySelector('b').textContent = quien;
    var kpi = function(v, t, sub, alerta) { return '<div class="dd-kpi' + (alerta ? ' alerta' : '') + '"><b>' + v + '</b><span>' + t + '</span>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>'; };
    document.getElementById('ddKpis').innerHTML =
      kpi(total, 'Casos totales') +
      kpi(k.aprobadas, 'Aprobadas', ddPct(k.aprobadas, total) + ' de los casos') +
      kpi(k.enProceso, 'En proceso') +
      kpi(k.canceladas, 'Canceladas / Skipped') +
      kpi(ddTiempo(k.duracionMin), 'Tiempo total de diseño') +
      kpi(ddTiempo(k.promedioMin), 'Promedio por caso', k.conTiempo + ' casos con tiempo') +
      kpi(k.conHold, 'Casos con Hold', k.holdMin ? ddMin(k.holdMin) + ' en Hold' : 'sin Hold') +
      kpi(k.conQc, 'Con QC', ddPct(k.conQc, total) + ' de los casos') +
      kpi(k.qcHallazgos, 'QC con hallazgos', ddPct(k.qcHallazgos, k.conQc) + ' de los QC', k.qcHallazgos > 0) +
      kpi(data.sinQc.length, 'Aprobadas sin QC', '', data.sinQc.length > 0);

    var selClave = nomSel.value;
    document.getElementById('ddProduccion').innerHTML = data.porDesigner.map(function(d) {
      return '<tr class="dd-clic' + (selClave === d.clave ? ' dd-sel' : '') + '" data-clave="' + ddEsc(d.clave).replace(/"/g, '&quot;') + '" title="Ver solo los casos de ' + ddEsc(d.nombre).replace(/"/g, '&quot;') + '">' +
        '<td class="dd-izq">' + ddEsc(d.nombre) + '</td><td>' + ddEsc(d.equipos.join(', ')) + '</td><td>' + d.casos + '</td><td>' + d.aprobadas + '</td>' +
        '<td>' + ddTiempo(d.duracionMin) + '</td><td>' + ddTiempo(d.promedioMin) + '</td><td>' + ddTiempo(d.holdMin) + '</td>' +
        '<td>' + d.conQc + '</td><td>' + d.qcHallazgos + '</td></tr>';
    }).join('') || '<tr><td colspan="9" style="color:#4b5563">Sin datos.</td></tr>';
    document.querySelectorAll('#ddProduccion tr[data-clave]').forEach(function(tr) {
      tr.onclick = function() { var s = document.getElementById('ddDesigner'); s.value = s.value === tr.dataset.clave ? '' : tr.dataset.clave; document.getElementById('ddDesignerTxt').value = ''; ddCargar(); };
    });

    document.getElementById('ddEquipos').innerHTML = data.porEquipo.map(function(e) {
      return '<tr><td class="dd-izq">' + ddEsc(e.equipo) + '</td><td>' + ddEsc(e.area) + '</td><td>' + e.casos + '</td><td>' + e.aprobadas + '</td><td>' + ddTiempo(e.promedioMin) + '</td><td>' + e.qcHallazgos + '</td></tr>';
    }).join('') || '<tr><td colspan="6" style="color:#4b5563">Sin datos.</td></tr>';

    var barras = function(lista, nombre, valor, extra) {
      var max = Math.max.apply(null, lista.map(valor).concat([1]));
      return lista.map(function(x) {
        return '<div class="dd-bar-row"><span class="dd-bar-label" title="' + ddEsc(nombre(x)).replace(/"/g, '&quot;') + '">' + ddEsc(nombre(x)) + '</span>' +
               '<div class="dd-bar-track"><div class="dd-bar-fill" style="width:' + Math.round(valor(x) / max * 100) + '%"></div></div>' +
               '<span class="dd-bar-val">' + valor(x) + (extra ? extra(x) : '') + '</span></div>';
      }).join('') || '<p style="color:#4b5563">Sin datos.</p>';
    };
    document.getElementById('ddEstados').innerHTML = barras(data.porEstado, function(e) { return e.estado; }, function(e) { return e.casos; });
    document.getElementById('ddProductoMix').innerHTML = barras(data.porProducto, function(p) { return p.producto; }, function(p) { return p.casos; },
      function(p) { return p.promedioMin ? ' · ' + ddMin(p.promedioMin) : ''; });

    var maxDia = Math.max.apply(null, data.porDia.map(function(d) { return d.casos; }).concat([1]));
    document.getElementById('ddDias').innerHTML = data.porDia.map(function(d) {
      var p = d.fecha.split('-');
      return '<div class="dd-dia" title="' + p[2] + '/' + p[1] + '/' + p[0] + ': ' + d.casos + ' casos"><span>' + d.casos + '</span><i style="height:' + Math.round(d.casos / maxDia * 100) + '%"></i><span>' + p[2] + '/' + p[1] + '</span></div>';
    }).join('') || '<p style="color:#4b5563">Sin datos.</p>';

    document.getElementById('ddQcReportes').innerHTML = data.qcReportes.map(function(r) {
      return '<tr><td>' + ddEsc(r.orden) + '</td><td>' + ddEsc(r.paciente) + '</td><td>' + r.fecha + '</td><td>' + ddEsc(r.equipo) + '</td><td>' + ddEsc(r.producto) + '</td>' +
             '<td>' + ddEsc(r.designerNombre) + '</td><td class="dd-izq" style="white-space:pre-wrap">' + ddEsc(r.qcReporte) + '</td>' +
             (DD_ADMIN ? '<td><button type="button" class="btn rojo mini" title="Borrar este hallazgo (el QC sigue marcado, queda sin hallazgos)" onclick="ddQcBorrar([' + r.ordenId + '])">Borrar</button></td>' : '') + '</tr>';
    }).join('') || '<tr><td colspan="8" style="color:#4b5563">Sin hallazgos de QC.</td></tr>';
    var bt = document.getElementById('ddQcBorrarTodo');
    if (bt) { bt.style.display = data.qcReportes.length > 1 ? '' : 'none'; bt.textContent = 'Borrar los ' + data.qcReportes.length + ' hallazgos filtrados'; }

    document.getElementById('ddSinQc').innerHTML = data.sinQc.map(function(r) {
      return '<tr><td>' + ddEsc(r.orden) + '</td><td>' + ddEsc(r.paciente) + '</td><td>' + r.fecha + '</td><td>' + ddEsc(r.equipo) + '</td><td>' + ddEsc(r.producto) + '</td>' +
             '<td>' + ddEsc(r.estado) + '</td><td>' + ddEsc(r.designerNombre) + '</td></tr>';
    }).join('') || '<tr><td colspan="7" style="color:#4b5563">Sin datos.</td></tr>';
  });
}

// Admins: borrar hallazgos de QC (uno o todos los que muestra el filtro). El QC sigue marcado y la orden queda
// "Sin hallazgos"; las Notas no cambian. Se puede deshacer desde el aviso.
var DD_ADMIN = DD_PROPIOS === null;
function ddQcBorrar(ids) {
  var lista = ids || (DD_ULTIMO ? DD_ULTIMO.qcReportes.map(function(r) { return r.ordenId; }) : []);
  if (!lista.length) return;
  var uno = lista.length === 1 && DD_ULTIMO ? DD_ULTIMO.qcReportes.find(function(r) { return r.ordenId === lista[0]; }) : null;
  var msg = uno ? '¿Borrar el hallazgo de QC de la orden ' + uno.orden + '?\n\n"' + uno.qcReporte.slice(0, 300) + '"\n\nEl QC sigue marcado y la orden queda "Sin hallazgos". Las Notas no cambian.'
                : '¿Borrar los ' + lista.length + ' hallazgos de QC que muestra el filtro actual?\n\nEl QC sigue marcado y esas órdenes quedan "Sin hallazgos". Las Notas no cambian.';
  if (!confirm(msg)) return;
  window.dsPostJSON('/design/api/dashboard/qc-hallazgos/borrar', {ids: lista}).then(function(r) {
    var borrados = r.borrados || {}, n = Object.keys(borrados).length;
    ddCargar();
    ddAvisoDeshacer(n === 1 ? 'Se borró 1 hallazgo de QC.' : 'Se borraron ' + n + ' hallazgos de QC.', function() {
      window.dsPostJSON('/design/api/dashboard/qc-hallazgos/borrar', {ids: [], restaurar: borrados}).then(function() { ddCargar(); dsToast('Hallazgos restaurados.'); })
        .catch(function(e) { alert('No se pudo deshacer: ' + e.message); });
    });
  }).catch(function(e) { alert('No se pudo borrar: ' + e.message); });
}
function ddAvisoDeshacer(texto, deshacer) {
  var v = document.getElementById('ddAviso'); if (v) v.remove();
  v = document.createElement('div'); v.id = 'ddAviso'; v.className = 'ds-toast'; v.style.display = '';
  v.innerHTML = '<span></span> <button type="button" style="margin-left:10px;background:#fff;color:#1d4ed8;border:none;border-radius:5px;padding:3px 10px;cursor:pointer;font-weight:600">Deshacer</button>';
  v.querySelector('span').textContent = texto;
  v.querySelector('button').onclick = function() { v.remove(); deshacer(); };
  document.body.appendChild(v);
  setTimeout(function() { if (v.isConnected) v.remove(); }, 12000);
}

// Descarga lo que se ve (con los filtros actuales) en un archivo que abre Excel (CSV con separador ;).
function ddDescargar() {
  var d = DD_ULTIMO; if (!d) return;
  var c = function(v) { v = v == null ? '' : String(v); return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  var h = function(m) { return m ? (m / 60).toFixed(2).replace('.', ',') : ''; };
  var filas = [['Dashboard Design', 'Desde', document.getElementById('ddDesde').value || 'inicio', 'Hasta', document.getElementById('ddHasta').value || 'hoy'], [],
    ['PRODUCCIÓN POR DISEÑADOR'], ['Diseñador', 'Equipo', 'Casos', 'Aprobadas', 'Canceladas/Skipped', 'Horas totales', 'Promedio por caso (min)', 'Horas en Hold', 'Con QC', 'QC con hallazgos']];
  d.porDesigner.forEach(function(x) { filas.push([x.nombre, x.equipos.join(', '), x.casos, x.aprobadas, x.canceladas, h(x.duracionMin), String(x.promedioMin).replace('.', ','), h(x.holdMin), x.conQc, x.qcHallazgos]); });
  filas.push([], ['POR EQUIPO'], ['Equipo', 'Área', 'Casos', 'Aprobadas', 'Promedio por caso (min)', 'QC con hallazgos']);
  d.porEquipo.forEach(function(x) { filas.push([x.equipo, x.area, x.casos, x.aprobadas, String(x.promedioMin).replace('.', ','), x.qcHallazgos]); });
  filas.push([], ['PRODUCTOS'], ['Producto', 'Casos', 'Promedio por caso (min)']);
  d.porProducto.forEach(function(x) { filas.push([x.producto, x.casos, String(x.promedioMin).replace('.', ',')]); });
  filas.push([], ['REPORTES DE QC'], ['Orden', 'Paciente', 'Fecha', 'Equipo', 'Producto', 'Diseñador', 'Hallazgo de QC']);
  d.qcReportes.forEach(function(x) { filas.push([x.orden, x.paciente, x.fecha, x.equipo, x.producto, x.designerNombre, x.qcReporte]); });
  filas.push([], ['APROBADAS SIN QC'], ['Orden', 'Paciente', 'Fecha', 'Equipo', 'Producto', 'Estado', 'Diseñador']);
  d.sinQc.forEach(function(x) { filas.push([x.orden, x.paciente, x.fecha, x.equipo, x.producto, x.estado, x.designerNombre]); });
  var csv = '\ufeff' + filas.map(function(f) { return f.map(c).join(';'); }).join('\r\n');
  var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], {type: 'text/csv;charset=utf-8'}));
  a.download = 'Dashboard Design ' + ddIso(new Date()) + '.csv'; document.body.appendChild(a); a.click(); a.remove();
}

function ddBuscar() {
  var q = document.getElementById('ddBuscar').value.trim();
  if (!q) { document.getElementById('ddResultadosBusqueda').innerHTML = ''; return; }
  ddApi('/design/api/buscar?q=' + encodeURIComponent(q)).then(function(res) {
    var cont = document.getElementById('ddResultadosBusqueda');
    if (!res.length) { cont.innerHTML = '<p style="color:#4b5563">Sin resultados.</p>'; return; }
    cont.innerHTML = '<div class="dd-panel"><table class="dd-tabla"><thead><tr><th>Orden</th><th>Paciente</th><th>Área</th><th>Equipo</th><th>Fecha</th></tr></thead><tbody>' +
      res.map(function(r) {
        return '<tr><td>' + ddEsc(r.orden) + '</td><td>' + ddEsc(r.paciente) + '</td><td>' + ddEsc(r.area) + '</td>' +
               '<td>' + ddEsc(r.equipo) + '</td><td>' + r.fecha + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  });
}

window.DS_PANELS.dashboard = function() {
  if (!ddCargar.listo) { ddCargar.listo = true; if (!document.getElementById('ddDesde').value && !document.getElementById('ddHasta').value) { ddRapido('mes'); return; } }
  ddCargar();
};
;
(function() {
  function api(url) { return window.dsFetchJSON(url); }
  function postJSON(url, body) { return window.dsPostJSON(url, body); }

  // Pestañas según el área (N3 para N3/N6; N2 / Face Design para N2/Face; Support y admins, las dos).
  var CMT_PERM = (window.DS_INICIO && window.DS_INICIO.comments) || {n3: true, faq: true};
  (function cmtPestanas() {
    var tn3 = document.getElementById('cmtTabN3'), tfaq = document.getElementById('cmtTabFaq');
    if (!tn3 || !tfaq) return;
    tn3.hidden = !CMT_PERM.n3; tfaq.hidden = !CMT_PERM.faq;
    if (!CMT_PERM.n3 && !CMT_PERM.faq) {
      tn3.parentNode.insertAdjacentHTML('afterend', '<p id="cmtSinArea" style="color:#4b5563;margin:16px 0">No hay comentarios para tu área.</p>');
      document.getElementById('cmtPanelN3').style.display = 'none';
      document.getElementById('cmtPanelFaq').style.display = 'none';
    }
  })();
  window.cmtMostrarTab = function(tab) {
    if (!CMT_PERM[tab]) return;
    document.getElementById('cmtPanelN3').style.display = tab === 'n3' ? '' : 'none';
    document.getElementById('cmtPanelFaq').style.display = tab === 'faq' ? '' : 'none';
    document.getElementById('cmtTabN3').classList.toggle('activo', tab === 'n3');
    document.getElementById('cmtTabFaq').classList.toggle('activo', tab === 'faq');
    if (tab === 'faq') faqInit();
  };

  // ================= N3 Comments: réplica exacta de la fórmula del Excel =================
  var CMT_FIELDS = ["b4","j4","b7","b11","d11","f11","h11","j11","l11","b15","f15","j15","b19","f19","j19","l22","l23","l24","l25","l26","l27","b30"];
  var CMT_PRODUCTS_DEFAULTS = ["N3 - Screw Retained","N6 - Dummy Set","N3 - Removable Denture",
    "N3 - Redo Removable Denture","N6 - Remake Removable Denture","N6 - Removable Denture","N6 - Single 24Z Remake"];
  var CMT_ARCH = ["A5","A10","AW5","AW10","B5","B10","BW5","BW10","C5","C10","CW5","CW10"];
  var CMT_TOTALS = ["3","4","5","6","7","8"];
  var CMT_NL = "\n";
  var CMT_UP_SAME=["#11, #13, #16","#11, #16, #13","#13, #11, #16","#13, #16, #11","#16, #13, #11","#16, #11, #13","#21, #23, #26","#21, #26, #23","#23, #21, #26","#23, #26, #21","#26, #23, #21","#26, #21, #23"];
  var CMT_LOW_SAME=["#31, #33, #36","#31, #36, #33","#33, #31, #36","#33, #36, #31","#36, #33, #31","#36, #31, #33","#41, #43, #46","#41, #46, #43","#43, #41, #46","#43, #46, #41","#46, #43, #41","#46, #41, #43"];

  function cmtNe(v){ return String(v==null?"":v).trim() !== ""; }
  function cmtNum(v){ var n=parseFloat(String(v==null?"":v).replace(",",".")); return isNaN(n)?0:n; }
  function cmtNz(v){ return cmtNe(v) && cmtNum(v)!==0; }
  function cmtIsNum(v){ var s=String(v==null?"":v).trim(); return s!=="" && /^[+-]?\d+([.,]\d+)?$/.test(s); }
  function cmtLen(v){ return String(v==null?"":v).trim().length; }
  function cmtDisp(v){ return String(v==null?"":v).trim(); }
  function cmtEqi(a,b){ return String(a==null?"":a).trim().toLowerCase() === String(b).toLowerCase(); }
  function cmtSi(v){ return cmtEqi(v,"Si"); }
  function cmtFmt(n){ if(n===""||n==null) return ""; return String(Number(n)); }
  function cmtProdEq(p,name){ return cmtEqi(p,name); }
  function cmtRemovableLike(p){
    return cmtProdEq(p,"N3 - Screw Retained")||cmtProdEq(p,"N6 - Dummy Set")||
           cmtProdEq(p,"N3 - Removable Denture")||cmtProdEq(p,"N3 - Redo Removable Denture")||
           cmtProdEq(p,"N6 - Remake Removable Denture")||cmtProdEq(p,"N6 - Removable Denture");
  }
  function cmtA12Excluded(f){
    var p=f.b7;
    return cmtProdEq(p,"N3 - Removable Denture")||cmtProdEq(p,"N3 - Redo Removable Denture")||
           cmtProdEq(p,"N6 - Remake Removable Denture")||cmtProdEq(p,"N6 - Removable Denture")||
           (!cmtNe(f.b15)&&!cmtNe(f.b19)&&cmtProdEq(p,"N6 - Dummy Set"));
  }
  function cmtBracketWord(p){
    if(cmtProdEq(p,"N3 - Screw Retained")) return "screw retained";
    if(cmtProdEq(p,"N6 - Dummy Set")) return "dummy";
    return "bar";
  }
  // Cuenta los implantes por sus números (#11, #13 → 2), sin depender de cómo estén separados.
  function cmtImplCount(v){ return cmtNe(v) ? (String(v).match(/\d+/g) || []).length : 0; }
  function cmtCalcMoved(skip, still, total){
    var t = cmtNum(total);
    var c = cmtImplCount(skip) + cmtImplCount(still);
    if((cmtNe(skip)||cmtNe(still)) && c < t+1) return c;
    return "";
  }
  function cmtArchBlock(which, f, moved){
    var skip = which==="up"?f.b15:f.b19;
    var still= which==="up"?f.f15:f.f19;
    var total= which==="up"?f.j15:f.j19;
    var same = (which==="up"?CMT_UP_SAME:CMT_LOW_SAME).map(function(s){return s.toLowerCase();});
    var label= which==="up"?"Upper arch":"Lower arch";
    var bw   = cmtBracketWord(f.b7);
    var L    = moved;
    if(!(L!=="" && L!==0)) return "";
    var Jn = cmtNum(total);
    var out = CMT_NL+CMT_NL;
    if(cmtNe(skip)){
      out += label+": We try to skip each implant to choose the best possible alignment. The best option was skipping";
      out += (cmtLen(skip)>3 ? " implants " : " implant ");
      out += skip + " so that the rest would be in a better position";
      out += (!cmtNe(still) ? "" : " but we still have the "+still+" implant moved");
      out += ". This arch has " + cmtFmt(L) + (L===1 ? " implant moved." : " implants moved.");
      if(same.indexOf(String(skip).trim().toLowerCase()) !== -1){
        out += " The doctor approved to continue with " + (L>3
          ? cmtFmt(L)+" implants moved out of "+cmtFmt(Jn)+" and the 3 skipped implants are on the same side."
          : "3 skipped implants on the same side.");
      } else if(L!==1){
        if(L>=4 || (L===3 && (Jn===4||Jn===5))){
          out += " The Doctor approved to continue with " + cmtFmt(L) + " implants moved out of " + cmtFmt(Jn) + ".";
        }
      }
      if(cmtNe(still) && (L===2 || (L===3 && Jn>=6))){
        out += " If removing the skipped implant from the master model the "+bw+" and the guide are not sitting well, you can remove the implant that looks moved.";
      }
    } else if(!cmtNe(skip) && cmtNe(still)){
      out += label+": We try to skip each implant to choose the best possible alignment, however when we skip";
      out += (cmtLen(still)>3 ? " implants " : " implant ");
      out += still + " it negatively affected the other implants. If the "+bw+" and guide are not positioned correctly, you can remove the implant that appears to be moved. This arch has "+cmtFmt(L)+(L===1?" implant moved.":" implants moved.");
    }
    return out;
  }
  function cmtGenReadyToMill(f){
    var L15 = cmtCalcMoved(f.b15,f.f15,f.j15);
    var L19 = cmtCalcMoved(f.b19,f.f19,f.j19);
    var l15n = (L15===""?0:L15), l19n = (L19===""?0:L19);
    var j15 = cmtNum(f.j15), j19 = cmtNum(f.j19);
    var s = "";
    if(cmtNe(f.j4)&&cmtNe(f.b4)) s += "Ready to mill: "+f.b4+" "+f.j4+CMT_NL;
    if(cmtNe(f.b7)) s += "Product: "+f.b7+CMT_NL;
    if(cmtNe(f.b11) && !cmtRemovableLike(f.b7)) s += "Bar adapt: "+f.b11+CMT_NL;
    if(cmtNe(f.d11)) s += (cmtSi(f.f11)?"Size: Custom ":"Size: ")+f.d11+CMT_NL;
    if(cmtNz(f.h11)) s += "VDO: "+(cmtNum(f.h11)>0?"+":"")+cmtDisp(f.h11)+CMT_NL;
    if(cmtNe(f.b15)||cmtNe(f.b19)){
      s += "Skipped implants: "+(cmtNe(f.b15)?"Upper: "+f.b15+" ":"")+(cmtNe(f.b19)?"Lower: "+f.b19:"")+CMT_NL;
    }
    if(cmtNe(f.b7)) s += CMT_NL;
    if(cmtNe(f.d11)) s += "This arch is "+(cmtSi(f.f11)?"Custom ":"")+f.d11+" ";
    if(cmtNe(f.l11)){
      if(cmtIsNum(f.l11)){
        var n=cmtNum(f.l11);
        var pre = n>999?"(InTech #":(n>99?"(DDI-0":(n>9?"(DDI-00":"(DDI-000"));
        s += pre+cmtDisp(f.l11)+"). ";
      } else { s += "(PC "+f.l11+"). "; }
    }
    if(cmtNe(f.b7)){
      s += "We used VDO at "+(cmtNum(f.h11)>0?"+":"")+cmtDisp(f.h11)+
           (cmtNz(f.h11)?" (Digitally "+(cmtNum(f.h11)>0?"+":"")+cmtDisp(f.j11)+")":"")+". ";
    }
    if(cmtNe(f.b11) && !cmtRemovableLike(f.b7)) s += "This bar was adapted to "+f.b11+". ";
    if(cmtNe(f.b7) && !cmtA12Excluded(f)){
      var w = cmtProdEq(f.b7,"N3 - Screw Retained")?"The screw retained":(cmtProdEq(f.b7,"N6 - Dummy Set")?"The dummy":"The bar");
      s += w+" implants and the articulation guide implants are in the same position, that means that both designs must be accurate in the digital bite, if you have problems please check the process.";
    }
    if((L15!==""&&L15!==0)||(L19!==""&&L19!==0)) s += " The case took longer than estimated due to different alignment attempts.";
    if(l19n>=4 || (l19n===3&&(j19===4||j19===5)) || l15n>=4 || (l15n===3&&(j15===4||j15===5))){
      s += " The Master articulation will probably not be usable due to the number of moved implants and the case may be delivered in the digital articulation.";
    }
    if(cmtNum(f.l22)>0) s += CMT_NL+CMT_NL+"FILES TO MILL ATTACHMENT #"+cmtDisp(f.l22);
    if(cmtNe(f.b30)||cmtNe(f.l23)||cmtNe(f.l24)||cmtNe(f.l25)||cmtSi(f.l26)||cmtSi(f.l27)){
      s += CMT_NL+CMT_NL;
      if(cmtNe(f.l23)) s += "We showed the occlusion to the Dr and it was approved, the HTML is under the attachment #"+cmtDisp(f.l23)+". ";
      if(cmtNe(f.l24)) s += "As requested by the doctor, we made "+(cmtEqi(f.l24,"Midline")?"a midline change ":(cmtEqi(f.l24,"CANT")?"an occlusal cant change ":(cmtEqi(f.l24,"AMBOS")?"occlusal cant and midline changes ":"")))+"digitally. Since the case was not rearticulated, the master articulation will be disabled. ";
      if(cmtNe(f.l25)) s += (cmtEqi(f.l25,"Upper")?"The Upper tissue was":(cmtEqi(f.l25,"Lower")?"The Lower tissue was":(cmtEqi(f.l25,"Ambos")?"The Upper and Lower tissue were":"")))+" digitally extended because we did not have enough information to complete the design. ";
      if(cmtSi(f.l26)) s += "This case has the same occlusion approved by the doctor in N2 and will be processed in 24Z. ";
      if(cmtSi(f.l27)) s += "We notified the manager that the waxup overlapped the antagonist in some areas and approved to continue. ";
      s += (f.b30||"");
    }
    s += cmtArchBlock("up", f, L15);
    s += cmtArchBlock("low", f, L19);
    return s;
  }
  function cmtGenEverythingOk(f){
    if(cmtNe(f.j4)&&cmtNe(f.b4)){
      return f.b4+" "+f.j4+" Everything is ok "+CMT_NL+CMT_NL+
        "Scans ✅ "+CMT_NL+"Medidas ✅ "+CMT_NL+"Cantilever ✅ "+CMT_NL+"Access Hole ✅ "+CMT_NL+"Icam / Micron ✅";
    }
    return "";
  }
  var CMT_TEMPLATES = [
    {n:"Downloading scan files", t:"{PO}\nWe started downloading the scan files, when we have the files downloaded, we will officially start the surgery. The download time may vary."},
    {n:"N3 Design — Initiated", t:"{PO}\nN3 Design. Initiated"},
    {n:"Hold", t:"{PO}\nHOLD"},
    {n:"Re-initiated", t:"{PO}\nRE-INITIATED"},
    {n:"Midline hacia la derecha", t:"{PO}\ntenemos una medida de mm digitalmente en la midline hacia la derecha, el doctor pidio mm right. Continuamos con la marca de la demo?"},
    {n:"Midline hacia la izquierda", t:"{PO}\ntenemos una medida de mm digitalmente en la midline hacia la izquierda, el doctor pidio mm left. Continuamos con la marca de la demo?"},
    {n:"Hold — implants moved (upper)", t:"{PO} Hold\nIn the upper, we have X of Y implants moved with respect to the pick-up. According to the protocol, we need a new pick-up if possible, or if we continue with the alignment omitting two implants and leaving the comment about the third moved implant, we await the doctor's authorization to continue. @manager"},
    {n:"NG Design Ready to print", t:"{PO}\nNG Design Ready to print"},
    {n:"Master articulation warning", t:"The master articulation will probably not be usable due to the number of moved implants, and the case may be delivered in the digital articulation."},
    {n:"Manager aprobó angulación", t:"The laboratory manager approved continuing with the angulation of the implants."},
    {n:"Delay — alignment attempts", t:"We will have a delay because we must make different alignment attempts, as these attempts will increase the time in the design of the product."}
  ];
  function cmtTplText(tpl, f){
    var po = (cmtNe(f.b4)||cmtNe(f.j4)) ? ((f.b4||"")+" "+(f.j4||"")).trim() : "";
    return tpl.t.replace("{PO}", po);
  }

  function cmtLeer() {
    var f = {};
    CMT_FIELDS.forEach(function(k) { var el = document.getElementById("cmt_"+k); f[k] = el ? el.value : ""; });
    return f;
  }
  // Si hay implantes elegidos pero Total moved queda vacío, el campo se marca en ámbar con ⚠ y explica por qué.
  function cmtAvisoMovidos(id, skip, still, total, moved) {
    var el = document.getElementById(id);
    var falta = (cmtNe(skip) || cmtNe(still)) && (moved === "" || moved === 0);
    el.classList.toggle('cmt-aviso', falta);
    if (falta) {
      el.value = '⚠';
      el.title = cmtNe(total) ? 'Los implantes elegidos superan el Total elegido — revisa el Total o los implantes.'
                              : 'Elige el Total para calcular los implantes movidos.';
    } else el.removeAttribute('title');
  }

  // ---------- Skipped implants / Still moved: lista de selección múltiple ----------
  var CMT_IMPL = {up: ['#11', '#13', '#16', '#18', '#21', '#23', '#26', '#28'],
                  low: ['#31', '#33', '#36', '#38', '#41', '#43', '#46', '#48']};
  function cmtNums(v) { return (String(v || '').match(/\d+/g) || []).map(function(n) { return '#' + n; }); }
  function cmtCerrarMulti() {
    var m = document.getElementById('cmtMulti'); if (m) m.remove();
    document.removeEventListener('mousedown', cmtMultiFuera, true);
    document.removeEventListener('keydown', cmtMultiTecla, true);
  }
  function cmtMultiFuera(e) { var m = document.getElementById('cmtMulti'); if (m && !m.contains(e.target) && !e.target.classList.contains('cmt-impl')) cmtCerrarMulti(); }
  function cmtMultiTecla(e) { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); cmtCerrarMulti(); } }
  function cmtAbrirMulti(inp) {
    var abierto = document.getElementById('cmtMulti');
    if (abierto && abierto.dataset.para === inp.id) { cmtCerrarMulti(); return; }
    cmtCerrarMulti();
    var lista = CMT_IMPL[inp.dataset.arcada], elegidos = cmtNums(inp.value), otros = cmtNums(document.getElementById(inp.dataset.par).value);
    var m = document.createElement('div'); m.id = 'cmtMulti'; m.className = 'cmt-multi'; m.dataset.para = inp.id; m.setAttribute('role', 'listbox');
    m.innerHTML = lista.map(function(n) {
      var en = elegidos.indexOf(n) >= 0, no = !en && otros.indexOf(n) >= 0;
      return '<label' + (no ? ' class="no" title="Ya está en el otro campo de esta arcada"' : '') + '><input type="checkbox" value="' + n + '"' +
             (en ? ' checked' : '') + (no ? ' disabled' : '') + '>' + n + '</label>';
    }).join('') + '<div class="pie"><button type="button" data-acc="limpiar">Quitar todos</button><button type="button" data-acc="cerrar">Listo</button></div>';
    document.body.appendChild(m);
    var r = inp.getBoundingClientRect();
    m.style.left = (r.left + window.scrollX) + 'px'; m.style.top = (r.bottom + window.scrollY + 4) + 'px';
    var aplicar = function() {
      var sel = [].map.call(m.querySelectorAll('input:checked'), function(c) { return c.value; });
      inp.value = lista.filter(function(n) { return sel.indexOf(n) >= 0; }).join(', ');
      inp.dispatchEvent(new Event('input', {bubbles: true}));
    };
    m.addEventListener('change', aplicar);
    m.addEventListener('click', function(e) {
      var b = e.target.closest('button[data-acc]'); if (!b) return;
      if (b.dataset.acc === 'limpiar') { m.querySelectorAll('input:checked').forEach(function(c) { c.checked = false; }); aplicar(); }
      cmtCerrarMulti(); inp.focus();
    });
    document.addEventListener('mousedown', cmtMultiFuera, true);
    document.addEventListener('keydown', cmtMultiTecla, true);
    var primero = m.querySelector('input:not([disabled])'); if (primero) primero.focus();
  }
  document.addEventListener('click', function(e) {
    var inp = e.target.closest && e.target.closest('input.cmt-impl'); if (inp) cmtAbrirMulti(inp);
  });
  document.addEventListener('keydown', function(e) {
    var inp = e.target; if (!inp.classList || !inp.classList.contains('cmt-impl')) return;
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); cmtAbrirMulti(inp); }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); inp.value = ''; inp.dispatchEvent(new Event('input', {bubbles: true})); }
  });

  // ---------- Copiar "Ready to mill": revisa que el formato esté diligenciado (como el original) ----------
  var CMT_REQUIRED = [
    {id: "b4", label: "Patient (General information)"}, {id: "j4", label: "Order # (General information)"},
    {id: "b7", label: "Product"}, {id: "b11", label: "Bar adapt (Design details)"}, {id: "d11", label: "Arch size (Design details)"},
    {id: "f11", label: "TC Custom (Design details)"}, {id: "h11", label: "VDO lab (Design details)"},
    {id: "j11", label: "VDO Digital (Design details)"}, {id: "l11", label: "PC (Design details)"},
    {id: "j15", label: "Total (Implants Upper)"}, {id: "j19", label: "Total (Implants Lower)"}];
  function cmtMarcarFaltantes() {
    var faltan = [];
    CMT_REQUIRED.forEach(function(c) {
      var el = document.getElementById('cmt_' + c.id), vacio = !el || String(el.value || '').trim() === '';
      if (el) el.classList.toggle('cmt-missing', vacio);
      if (vacio) faltan.push(c);
    });
    return faltan;
  }
  function cmtVentanaFaltantes(faltan, copiar) {
    var bg = document.createElement('div'); bg.className = 'ds-qc-bg';
    bg.innerHTML = '<div class="ds-qc" role="dialog" aria-modal="true" aria-labelledby="cmtFaltTit" style="width:440px">' +
      '<h4 id="cmtFaltTit">Formato incompleto</h4><div class="ds-qc-sub">Estos campos del formato no fueron diligenciados. ¿Deseas copiar el comentario de todas formas o volver a editar?</div>' +
      '<ul style="margin:6px 0 10px 18px;font-size:13px">' + faltan.map(function(c) { return '<li>' + cmtEscHtml(c.label) + '</li>'; }).join('') + '</ul>' +
      '<div class="ds-qc-btns"><button type="button" class="btn gris" data-acc="editar">Volver a editar</button><button type="button" class="btn" data-acc="copiar">Copiar de todas formas</button></div></div>';
    document.body.appendChild(bg);
    var cerrar = function() { bg.remove(); document.removeEventListener('keydown', tecla, true); };
    var tecla = function(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(); } };
    bg.addEventListener('click', function(e) {
      var b = e.target.closest('[data-acc]');
      if (e.target === bg || (b && b.dataset.acc === 'editar')) { cerrar(); var el = document.getElementById('cmt_' + faltan[0].id); if (el) el.focus(); return; }
      if (b && b.dataset.acc === 'copiar') { cerrar(); copiar(); }
    });
    document.addEventListener('keydown', tecla, true);
    bg.querySelector('[data-acc="copiar"]').focus();
  }

  // Las cajas de comentario crecen con el texto (como el original): sin barra para leer todo.
  function cmtAutoGrow(el) {
    if (!el || !el.offsetParent) return;
    var min = parseInt(el.dataset.minAlto || '0', 10);
    if (!min) { min = el.offsetHeight || 120; el.dataset.minAlto = min; }
    el.style.height = 'auto'; el.style.height = Math.max(min, el.scrollHeight + 2) + 'px';
  }

  function cmtRecalcular() {
    var f = cmtLeer();
    var L15 = cmtCalcMoved(f.b15, f.f15, f.j15);
    var L19 = cmtCalcMoved(f.b19, f.f19, f.j19);
    document.getElementById("cmt_L15").value = cmtFmt(L15);
    document.getElementById("cmt_L19").value = cmtFmt(L19);
    cmtAvisoMovidos("cmt_L15", f.b15, f.f15, f.j15, L15);
    cmtAvisoMovidos("cmt_L19", f.b19, f.f19, f.j19, L19);
    document.getElementById("cmtOut1").value = cmtGenReadyToMill(f);
    document.getElementById("cmtOut2").value = cmtGenEverythingOk(f);
    cmtAutoGrow(document.getElementById("cmtOut1")); cmtAutoGrow(document.getElementById("cmtOut2")); cmtAutoGrow(document.getElementById("cmt_b30"));
    cmtRenderPlantillas();
    cmtGuardarBorrador(f);
  }
  // Borrador: lo escrito en Comments N3 se guarda en este navegador (por persona) con cada cambio, así al
  // actualizar la página o cerrarla por error no se pierde. "Limpiar" lo vacía (y guarda el caso en el historial).
  var CMT_BORRADOR_KEY = 'cmtBorradorV1:' + window.DS_CFG.userId, cmtBorradorListo = false;
  // Trabajo por orden: cada número de orden guarda lo que se trabajó en Comments (en este navegador, de cada persona).
  // Así, si una cirugía queda en Hold y el diseñador abre otra orden (ej. una TC), al volver a la primera recupera todo.
  // Se borra solo 2 días después del último cambio.
  var CMT_ORDENES_KEY = 'cmtOrdenesV1:' + window.DS_CFG.userId, CMT_ORDEN_DIAS = 2;
  function cmtClaveOrden(o) { return String(o || '').trim().toUpperCase(); }
  function cmtOrdenes() {
    var m = {}; try { m = JSON.parse(localStorage.getItem(CMT_ORDENES_KEY) || '{}') || {}; } catch (e) {}
    var lim = Date.now() - CMT_ORDEN_DIAS * 864e5, cambio = false;
    Object.keys(m).forEach(function(k) { if (!m[k] || !(m[k].t > lim)) { delete m[k]; cambio = true; } });
    if (cambio) try { localStorage.setItem(CMT_ORDENES_KEY, JSON.stringify(m)); } catch (e) {}
    return m;
  }
  window.cmtTrabajoDeOrden = function(orden) { return cmtOrdenes()[cmtClaveOrden(orden)] || null; };
  function cmtGuardarOrden(f) {
    var k = cmtClaveOrden(f.j4); if (!k || !CMT_FIELDS.some(function(x) { return cmtNe(f[x]); })) return;
    var m = cmtOrdenes(), antes = m[k];
    m[k] = {t: Date.now(), campos: f};
    var claves = Object.keys(m); if (claves.length > 300) claves.sort(function(a, b) { return m[a].t - m[b].t; }).slice(0, claves.length - 300).forEach(function(x) { delete m[x]; });
    try { localStorage.setItem(CMT_ORDENES_KEY, JSON.stringify(m)); } catch (e) {}
    if (!antes && window.dsRefrescarAccesosCmt) window.dsRefrescarAccesosCmt();   // el 💬 de esa orden queda marcado
  }
  function cmtGuardarBorrador(f) {
    if (!cmtBorradorListo) return;
    try {
      if (CMT_FIELDS.some(function(k) { return cmtNe(f[k]); })) localStorage.setItem(CMT_BORRADOR_KEY, JSON.stringify({t: Date.now(), campos: f}));
      else localStorage.removeItem(CMT_BORRADOR_KEY);
    } catch (e) {}
    cmtGuardarOrden(f);
  }
  function cmtRestaurarBorrador() {
    var b = null; try { b = JSON.parse(localStorage.getItem(CMT_BORRADOR_KEY) || 'null'); } catch (e) {}
    if (b && b.campos && CMT_FIELDS.some(function(k) { return cmtNe(b.campos[k]); })) cmtCargarDesdeHistorial(b.campos);
    cmtBorradorListo = true;
  }
  function cmtEscHtml(v) { return String(v == null ? "" : v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  // Plantillas: compartidas por todo el equipo (las 11 fijas + las que se agreguen); favoritos por persona.
  // Mientras carga (o si falla la carga) se muestran las 11 fijas escritas aquí.
  var CMT_TPL = CMT_TEMPLATES.map(function(t) { return {id: null, n: t.n, t: t.t, fija: true}; });
  var CMT_FAVS = {};
  function cmtCargarPlantillas() {
    Promise.all([api('/design/api/comentarios/templates'), api('/design/api/favoritos/activos')]).then(function(r) {
      if (!Array.isArray(r[0])) return;
      CMT_TPL = r[0].map(function(t) { return {id: t.id, n: t.nombre, t: t.texto, fija: t.esFija}; });
      CMT_FAVS = {};
      ((r[1] || {}).cmtTemplates || []).forEach(function(id) { CMT_FAVS[id] = true; });
      cmtRenderPlantillas();
    }).catch(function() {});
  }
  function cmtTplHtml(tpl, f) {
    var fav = tpl.id != null && CMT_FAVS[tpl.id];
    var star = tpl.id == null ? '' :
      '<button type="button" class="cmt-tpl-ico cmt-tpl-star' + (fav ? ' on' : '') + '" title="' + (fav ? 'Quitar de favoritos' : 'Marcar como favorito') + '" onclick="cmtFavToggle(' + tpl.id + ')">' + (fav ? '★' : '☆') + '</button>';
    // Todas se pueden editar; las 11 del formato original no se borran
    var edit = tpl.id == null ? '' :
      '<button type="button" class="cmt-tpl-ico" title="Editar nota" onclick="cmtNotaAbrir(' + tpl.id + ')">✎</button>' +
      (tpl.fija ? '' : '<button type="button" class="cmt-tpl-ico" title="Eliminar nota (va a la Papelera)" onclick="cmtNotaEliminar(' + tpl.id + ')">🗑</button>');
    return '<div class="cmt-tpl-item"><div class="cmt-tpl-head">' + star + '<span class="cmt-tpl-name">' + cmtEscHtml(tpl.n) + '</span>' +
           '<span class="cmt-tpl-acc">' + edit + '<button type="button" class="btn mini" onclick="cmtCopiarPlantilla(' + CMT_TPL.indexOf(tpl) + ', this)">Copiar</button></span></div>' +
           '<div class="cmt-tpl-text">' + cmtEscHtml(cmtTplText(tpl, f)) + '</div></div>';
  }
  function cmtRenderPlantillas() {
    var f = cmtLeer();
    var favs = CMT_TPL.filter(function(t) { return t.id != null && CMT_FAVS[t.id]; });
    var resto = CMT_TPL.filter(function(t) { return favs.indexOf(t) < 0; });
    var html = favs.map(function(t) { return cmtTplHtml(t, f); }).join('');
    if (favs.length && resto.length) html += '<div class="cmt-tpl-sep">Otras notas</div>';
    html += resto.map(function(t) { return cmtTplHtml(t, f); }).join('');
    document.getElementById('cmtTplList').innerHTML = html;
  }
  window.cmtFavToggle = function(id) {
    CMT_FAVS[id] = !CMT_FAVS[id]; cmtRenderPlantillas();
    postJSON('/design/api/favoritos/cmt-template/' + id + '/toggle').then(function(r) {
      if (!r || typeof r.favorito !== 'boolean') { cmtCargarPlantillas(); return; }
      if (r.favorito !== !!CMT_FAVS[id]) { CMT_FAVS[id] = r.favorito; cmtRenderPlantillas(); }
    }).catch(cmtCargarPlantillas);
  };
  // Ventanita para crear o editar una nota. "{PO}" se reemplaza por el paciente y la orden.
  window.cmtNotaAbrir = function(id) {
    if (document.getElementById('cmtNota')) return;
    var tpl = id != null ? CMT_TPL.find(function(t) { return t.id === id; }) : null;
    var texto = tpl ? tpl.t : '', conPo = tpl ? /^\{PO\}/.test(texto) : true;
    var sepPo = /^\{PO\} /.test(texto) ? ' ' : '\n';  // "{PO} Hold..." conserva el espacio al guardar
    if (conPo) texto = texto.replace(/^\{PO\}[ \n]?/, '');
    var bg = document.createElement('div'); bg.className = 'ds-qc-bg'; bg.id = 'cmtNota';
    bg.innerHTML = '<div class="ds-qc cmt-nota" role="dialog" aria-modal="true" aria-labelledby="cmtNotaTit" style="width:520px">' +
      '<h4 id="cmtNotaTit">' + (tpl ? 'Editar nota' : 'Nueva nota') + '</h4>' +
      '<div class="ds-qc-sub">La ve todo el equipo en Plantillas de notas.</div>' +
      '<label class="cmt-nota-lbl" for="cmtNotaNom">Nombre</label><input type="text" id="cmtNotaNom" maxlength="150" placeholder="Ej: Hold — falta scan">' +
      '<label class="cmt-nota-lbl" for="cmtNotaTxt">Texto</label>' +
      '<label class="cmt-nota-po"><input type="checkbox" id="cmtNotaPo"' + (conPo ? ' checked' : '') + '> Empezar con el paciente y la orden</label>' +
      '<textarea id="cmtNotaTxt" placeholder="Escribe la nota..."></textarea>' +
      '<div class="ds-qc-err" id="cmtNotaErr"></div>' +
      '<div class="ds-qc-btns"><button type="button" class="btn gris" data-n="no">Cancelar</button><button type="button" class="btn" data-n="si">Guardar</button></div></div>';
    document.body.appendChild(bg);
    var nom = bg.querySelector('#cmtNotaNom'), txt = bg.querySelector('#cmtNotaTxt'), err = bg.querySelector('#cmtNotaErr');
    var btnSi = bg.querySelector('[data-n="si"]');
    nom.value = tpl ? tpl.n : ''; txt.value = texto; nom.focus();
    [nom, txt].forEach(function(el) { el.addEventListener('input', function() { err.innerText = ''; }); });
    var cerrar = function() { bg.remove(); document.removeEventListener('keydown', teclas, true); };
    var guardar = function() {
      if (btnSi.disabled) return;
      var n = nom.value.trim(), t = txt.value.replace(/\s+$/, '');
      if (!n) { err.innerText = 'Escribe un nombre para la nota.'; nom.focus(); return; }
      if (!t.trim()) { err.innerText = 'Escribe el texto de la nota.'; txt.focus(); return; }
      if (bg.querySelector('#cmtNotaPo').checked) t = '{PO}' + sepPo + t;
      btnSi.disabled = true;
      postJSON('/design/api/comentarios/templates' + (tpl ? '/' + tpl.id : ''), {nombre: n, texto: t}).then(function(r) {
        if (!r || !r.id) throw new Error((r && r.detail) || 'No se pudo guardar.');
        cerrar(); cmtCargarPlantillas();
      }).catch(function(e) { err.innerText = e.message || 'No se pudo guardar.'; btnSi.disabled = false; });
    };
    var teclas = function(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || e.target.tagName !== 'TEXTAREA')) { e.preventDefault(); e.stopPropagation(); guardar(); }
    };
    document.addEventListener('keydown', teclas, true);
    btnSi.onclick = guardar;
    bg.querySelector('[data-n="no"]').onclick = cerrar;
    bg.addEventListener('mousedown', function(e) { if (e.target === bg) cerrar(); });
  };
  window.cmtNotaEliminar = function(id) {
    var tpl = CMT_TPL.find(function(t) { return t.id === id; });
    if (!tpl || !confirm('¿Eliminar la nota "' + tpl.n + '"? Se puede recuperar desde la Papelera.')) return;
    postJSON('/design/api/comentarios/templates/' + id + '/eliminar').then(cmtCargarPlantillas);
  };
  // Copiar: usa el portapapeles del navegador y, si no está disponible, el método clásico. Muestra "Copiado".
  window.dsCopiar = function(texto, boton) {
    var hecho = function() {
      if (!boton) return;
      var t = boton.textContent; boton.textContent = 'Copiado ✓';
      setTimeout(function() { boton.textContent = t; }, 1200);
    };
    var clasico = function() {
      var ta = document.createElement('textarea'); ta.value = texto; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); hecho(); } catch (e) { alert('No se pudo copiar. Selecciona el texto y usa Ctrl+C.'); }
      ta.remove();
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(texto).then(hecho, clasico); else clasico();
  };
  window.cmtCopiar = function(id, boton) {
    var copiar = function() { window.dsCopiar(document.getElementById(id).value, boton); };
    if (id === 'cmtOut1') { var faltan = cmtMarcarFaltantes(); if (faltan.length) { cmtVentanaFaltantes(faltan, copiar); return; } }
    copiar();
  };
  window.cmtLimpiar = function() {
    var f = cmtLeer();
    var vaciar = function() {
      CMT_FIELDS.forEach(function(k) { var el = document.getElementById("cmt_"+k); if (el) el.value = ""; });
      cmtRecalcular();
    };
    // como el original: se guarda si hay cualquier dato (sin paciente queda como "(sin nombre)")
    if (!CMT_FIELDS.some(function(k) { return cmtNe(f[k]); })) { vaciar(); return; }
    postJSON('/design/api/comentarios/historial', {paciente: f.b4, orden: f.j4, campos: f})
      .then(function() { vaciar(); cmtCargarHistorial(); })
      .catch(function(e) { alert('No se guardó en el historial, así que no se borró el formulario: ' + e.message); });
  };
  function cmtCargarDesdeHistorial(campos) {
    CMT_FIELDS.forEach(function(k) {
      var el = document.getElementById("cmt_"+k); if (!el) return;
      var v = campos[k] || "";
      // una lista con un valor que ya no está (p. ej. Bar adapt escrito a mano antes) lo agrega para no perderlo
      if (el.tagName === 'SELECT' && v && !Array.prototype.some.call(el.options, function(o) { return o.value === v; })) {
        var o = document.createElement('option'); o.value = o.text = v; el.insertBefore(o, el.querySelector('option[value="__nueva__"]'));
      }
      el.value = v; if (k === 'b11') el._antes = v;
    });
    cmtRecalcular();
  }
  // "Hoy 14:05", "Ayer 09:30" o "03/10 16:20", en la hora del computador (el servidor guarda UTC).
  function cmtFechaHist(iso) {
    if (!iso) return '';
    var d = new Date(/Z|[+-]\d\d:\d\d$/.test(iso) ? iso : iso + 'Z'), hoy = new Date(), pad = function(n) { return String(n).padStart(2, '0'); };
    if (isNaN(d)) return '';
    var hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
    if (d.toDateString() === hoy.toDateString()) return 'Hoy ' + hm;
    var ayer = new Date(hoy); ayer.setDate(hoy.getDate() - 1);
    if (d.toDateString() === ayer.toDateString()) return 'Ayer ' + hm;
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + ' ' + hm;
  }
  function cmtCargarHistorial() {
    api('/design/api/comentarios/historial').then(function(hist) {
      var cont = document.getElementById('cmtHistList');
      document.getElementById('cmtHistCount').textContent = hist.length ? '(' + hist.length + ')' : '';
      cont.innerHTML = hist.map(function(h) {
        var nombre = ((h.paciente || '') + ' ' + (h.orden || '')).trim() || '(sin nombre)';
        return '<div class="cmt-hist-item"><span>' + cmtEscHtml(nombre) +
               ' <small style="color:#64748b;white-space:nowrap">' + cmtFechaHist(h.creadoEn) + '</small></span>' +
               '<span><button type="button" class="btn mini" onclick="cmtVerHistorial(' + h.id + ')">Cargar</button> ' +
               '<button type="button" class="btn rojo mini" onclick="cmtBorrarHistorial(' + h.id + ')">×</button></span></div>';
      }).join('') || '<p style="color:#4b5563;font-size:12px">Sin historial reciente.</p>';
      window._cmtHist = hist;
    });
  }
  window.cmtVerHistorial = function(id) {
    var h = (window._cmtHist || []).find(function(x) { return x.id === id; });
    if (h) cmtCargarDesdeHistorial(h.campos);
  };
  window.cmtBorrarHistorial = function(id) {
    postJSON('/design/api/comentarios/historial/' + id + '/eliminar').then(cmtCargarHistorial);
  };

  var cmtListo = false;
  function cmtInit() {
    if (!CMT_PERM.n3) { if (CMT_PERM.faq) cmtMostrarTab('faq'); return; }  // solo N2 / Face: abre esa pestaña
    if (cmtListo) { cmtCargarHistorial(); cmtCargarPlantillas(); setTimeout(cmtRecalcular, 0); return; }
    cmtListo = true;
    document.getElementById('cmt_d11').innerHTML = '<option value="">—</option>' + CMT_ARCH.map(function(a) { return '<option value="'+a+'">'+a+'</option>'; }).join('');
    document.getElementById('cmt_j15').innerHTML = '<option value="">—</option>' + CMT_TOTALS.map(function(a) { return '<option value="'+a+'">'+a+'</option>'; }).join('');
    document.getElementById('cmt_j19').innerHTML = '<option value="">—</option>' + CMT_TOTALS.map(function(a) { return '<option value="'+a+'">'+a+'</option>'; }).join('');
    ['cmt_f11'].forEach(function(id) { document.getElementById(id).innerHTML = '<option value="">—</option><option value="Si">Si</option><option value="No">No</option>'; });
    document.getElementById('cmt_l24').innerHTML = '<option value="">—</option>' + ['Midline','CANT','AMBOS'].map(function(a) { return '<option value="'+a+'">'+a+'</option>'; }).join('');
    document.getElementById('cmt_l25').innerHTML = '<option value="">—</option>' + ['Upper','Lower','Ambos'].map(function(a) { return '<option value="'+a+'">'+a+'</option>'; }).join('');
    document.getElementById('cmt_l26').innerHTML = '<option value="">—</option><option value="Si">Si</option><option value="No">No</option>';
    document.getElementById('cmt_l27').innerHTML = '<option value="">—</option><option value="Si">Si</option><option value="No">No</option>';
    document.getElementById('cmtProdList').innerHTML = CMT_PRODUCTS_DEFAULTS.map(function(p) { return '<option value="'+p+'"></option>'; }).join('');
    // Sin sugerencias del navegador ("último uso" de pacientes y órdenes anteriores): el historial ya las guarda.
    document.querySelectorAll('#cmtPanelN3 input').forEach(function(i) { i.setAttribute('autocomplete', 'off'); });
    cmtBarAdaptCargar();
    document.getElementById('cmt_b11').addEventListener('change', function() {
      if (this.value !== '__nueva__') { this._antes = this.value; return; }
      var sel = this, antes = sel._antes || '';
      var v = prompt('Nueva opción de Bar adapt (quedará en la lista para todos):', '');
      v = (v || '').replace(/\s+/g, ' ').trim();
      if (!v) { sel.value = antes; cmtRecalcular(); return; }
      postJSON('/design/api/comentarios/bar-adapt', {valor: v}).then(function(r) {
        return cmtBarAdaptCargar().then(function() { sel.value = r.valor; sel._antes = r.valor; sel.classList.remove('cmt-missing'); cmtRecalcular(); });
      }).catch(function(e) { alert('No se pudo agregar: ' + e.message); sel.value = antes; cmtRecalcular(); });
    });
    window.dsAreas().then(function(areas) {
      var n3 = areas.find(function(a) { return a.nombre === 'N3 Prosthetic'; });
      if (!n3) return;
      api('/design/api/catalogo?area_id=' + n3.id + '&tipo=producto').then(function(productos) {
        var todos = Array.from(new Set(CMT_PRODUCTS_DEFAULTS.concat(productos))).sort();
        document.getElementById('cmtProdList').innerHTML = todos.map(function(p) { return '<option value="'+p+'"></option>'; }).join('');
      });
    });
    CMT_FIELDS.forEach(function(k) {
      var el = document.getElementById('cmt_' + k);
      if (el) el.addEventListener('input', cmtRecalcular);
      if (el) el.addEventListener('input', function() { if (String(el.value || '').trim()) el.classList.remove('cmt-missing'); });
      if (el && el.tagName === 'SELECT') el.addEventListener('change', function() { if (el.value) el.classList.remove('cmt-missing'); });
      if (el && el.tagName === 'SELECT') el.addEventListener('change', cmtRecalcular);
    });
    cmtRestaurarBorrador();  // lo que estaba escrito antes de actualizar la página
    cmtRecalcular();
    setTimeout(cmtRecalcular, 0);  // con el panel ya visible, para que las cajas tomen su alto
    cmtCargarHistorial();
    cmtCargarPlantillas();
  }
  // Acceso desde el Schedule (botón 💬 en Orden): la primera vez llena Patient, Order # y Product. Si el formulario
  // tenía otro caso, se guarda en el historial (como "Limpiar") antes de llenarlo.
  window.cmtDesdeSchedule = function(o) {
    if (!CMT_PERM.n3) return;
    var f = cmtLeer();
    if (cmtClaveOrden(f.j4) === cmtClaveOrden(o.orden)) return;   // ya está abierta esa orden
    cmtGuardarOrden(f);   // lo que había en el formulario queda guardado en su orden
    var guardado = cmtOrdenes()[cmtClaveOrden(o.orden)];
    CMT_FIELDS.forEach(function(k) { var el = document.getElementById("cmt_"+k); if (el) { el.value = ""; el.classList.remove('cmt-missing'); } });
    if (guardado && guardado.campos) {
      cmtCargarDesdeHistorial(guardado.campos);
      if (window.dsToast) window.dsToast('Se recuperó lo que trabajaste en la orden ' + o.orden + '.');
    } else {
      var pon = function(id, v) { var el = document.getElementById(id); if (el) el.value = v || ''; };
      pon('cmt_b4', o.paciente); pon('cmt_j4', o.orden); pon('cmt_b7', o.producto);
      cmtRecalcular();
    }
    if (cmtNe(f.j4) && f.j4 !== o.orden && window.dsToast && !guardado) window.dsToast('Lo de la orden ' + f.j4 + ' quedó guardado: vuelve a tocar su 💬 para seguir.');
  };
  // Bar adapt: las 4 fijas + las que agregue el equipo; la última opción permite agregar otra.
  function cmtBarAdaptPintar(lista) {
    var sel = document.getElementById('cmt_b11'), actual = sel.value === '__nueva__' ? (sel._antes || '') : sel.value;
    sel.innerHTML = '<option value="">—</option>' + lista.map(function(v) { return '<option>' + cmtEscHtml(v) + '</option>'; }).join('') +
      (actual && lista.indexOf(actual) < 0 ? '<option>' + cmtEscHtml(actual) + '</option>' : '') + '<option value="__nueva__">➕ Agregar otra opción…</option>';
    sel.value = actual; sel._antes = actual;
  }
  function cmtBarAdaptCargar() {
    cmtBarAdaptPintar(window.CMT_BAR_ADAPT || ['0.1mm', '1mm', '0.1mm on Upper and 1mm on lower', '1mm on Upper and 0.1mm on lower']);
    return api('/design/api/comentarios/bar-adapt').then(function(l) { if (Array.isArray(l)) { window.CMT_BAR_ADAPT = l; cmtBarAdaptPintar(l); } }).catch(function() {});
  }
  window.cmtCopiarPlantilla = function(i, boton) {
    var f = cmtLeer();
    if (CMT_TPL[i]) window.dsCopiar(cmtTplText(CMT_TPL[i], f), boton);
  };

  // ================= N2 / Face Design: hojas FAQ =================
  // Todos leen, buscan y copian el template; editan solo los roles por encima del diseñador.
  var FAQ = {hojas: [], hojaId: null, hoja: null, edita: false, listo: false};
  var FAQ_ANCHOS = {situacion: '17%', producto: '11%', como_proceder: '20%', plantilla: '34%', ejemplos: '14%'};
  function faqPost(url, body) {
    return fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body || {})})
      .then(function(r) { return r.json().then(function(d) { if (!r.ok) throw new Error(d.detail || 'No se pudo guardar.'); return d; }); });
  }
  function faqError(e) { alert(e && e.message ? e.message : 'No se pudo guardar.'); faqCargarHoja(); }
  function faqNorm(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
  function faqInit() {
    if (FAQ.listo) { faqCargarHojas(); return; }
    FAQ.listo = true;
    document.getElementById('faqBuscar').addEventListener('input', faqFiltrar);
    faqCargarHojas();
  }
  function faqCargarHojas(elegir) {
    return api('/design/api/faq/hojas').then(function(r) {
      FAQ.hojas = r.hojas || []; FAQ.edita = !!r.puedeEditar;
      document.getElementById('faqGestion').style.display = FAQ.edita ? '' : 'none';
      document.getElementById('faqHerr').style.display = FAQ.edita ? '' : 'none';
      var guardada = null; try { guardada = parseInt(localStorage.getItem('ds_faq_hoja')); } catch (e) {}
      var ids = FAQ.hojas.map(function(h) { return h.id; });
      FAQ.hojaId = [elegir, FAQ.hojaId, guardada].filter(function(x) { return ids.indexOf(x) >= 0; })[0] || ids[0] || null;
      faqPintarHojas();
      return faqCargarHoja();
    });
  }
  function faqPintarHojas() {
    var cont = document.getElementById('faqHojas'); cont.innerHTML = '';
    FAQ.hojas.forEach(function(h) {
      var b = document.createElement('button'); b.type = 'button';
      b.className = 'faq-hoja' + (h.id === FAQ.hojaId ? ' activo' : ''); b.textContent = h.nombre;
      b.onclick = function() {
        FAQ.hojaId = h.id; try { localStorage.setItem('ds_faq_hoja', h.id); } catch (e) {}
        document.getElementById('faqBuscar').value = '';
        faqPintarHojas(); faqCargarHoja();
      };
      cont.appendChild(b);
    });
  }
  function faqCargarHoja() {
    if (!FAQ.hojaId) { FAQ.hoja = null; faqPintar(); return Promise.resolve(); }
    var id = FAQ.hojaId;
    return api('/design/api/faq/hojas/' + id).then(function(h) { if (id === FAQ.hojaId && h && h.id) { FAQ.hoja = h; faqPintar(); } });
  }
  // Secciones = filas contiguas con el mismo nombre de sección.
  function faqGrupos(filas) {
    var g = [];
    filas.forEach(function(f) {
      var ult = g[g.length - 1];
      if (ult && ult.nombre === f.seccion) ult.filas.push(f); else g.push({nombre: f.seccion, filas: [f]});
    });
    return g;
  }
  function faqEditable(el, alGuardar) {
    if (!FAQ.edita) return;
    el.setAttribute('contenteditable', 'plaintext-only');
    var antes;
    el.addEventListener('focus', function() { antes = el.innerText; });
    el.addEventListener('keydown', function(e) { if (e.key === 'Escape') { e.stopPropagation(); el.innerText = antes; el.blur(); } });
    el.addEventListener('blur', function() {
      var v = el.innerText.replace(/\n$/, '');
      if (v !== antes) alGuardar(v, antes);
    });
  }
  function faqPintar() {
    var h = FAQ.hoja, head = document.getElementById('faqHead'), body = document.getElementById('faqBody');
    head.innerHTML = ''; body.innerHTML = '';
    document.getElementById('faqTitulo').textContent = h ? h.nombre : '';
    if (!h) { body.innerHTML = '<tr><td class="faq-vacio">No hay hojas.</td></tr>'; faqFiltrar(); return; }
    var cols = h.columnas, ncol = cols.length + (FAQ.edita ? 1 : 0);
    var trh = document.createElement('tr');
    cols.forEach(function(c) {
      var th = document.createElement('th'); th.style.width = FAQ_ANCHOS[c.k] || '160px';
      var d = document.createElement('div'); d.className = 'faq-th';
      var t = document.createElement('span'); t.className = 'faq-th-txt'; t.textContent = c.l; d.appendChild(t);
      faqEditable(t, function(v) {
        if (!v.trim()) { t.textContent = c.l; return; }
        faqPost('/design/api/faq/hojas/' + h.id + '/columnas/' + c.k, {titulo: v}).then(function() { c.l = v.trim(); }).catch(faqError);
      });
      if (FAQ.edita) {
        var x = document.createElement('button'); x.type = 'button'; x.className = 'faq-x'; x.textContent = '✕';
        x.title = 'Eliminar columna "' + c.l + '" (va a la Papelera)';
        x.onclick = function() {
          if (!confirm('¿Eliminar la columna "' + c.l + '" con todo su contenido? Se puede recuperar desde la Papelera.')) return;
          faqPost('/design/api/faq/hojas/' + h.id + '/columnas/' + c.k + '/eliminar').then(faqCargarHoja).catch(faqError);
        };
        d.appendChild(x);
      }
      th.appendChild(d); trh.appendChild(th);
    });
    if (FAQ.edita) { var tha = document.createElement('th'); tha.className = 'faq-acc'; trh.appendChild(tha); }
    head.appendChild(trh);

    faqGrupos(h.filas).forEach(function(g) {
      var trs = document.createElement('tr'); trs.className = 'faq-sec';
      var tds = document.createElement('td'); tds.colSpan = ncol;
      var sh = document.createElement('div'); sh.className = 'faq-sec-h';
      var st = document.createElement('span'); st.className = 'faq-sec-txt'; st.textContent = g.nombre || (FAQ.edita ? '' : 'Sin sección');
      sh.appendChild(st);
      var sn = document.createElement('span'); sn.className = 'faq-sec-n'; sh.appendChild(sn);
      faqEditable(st, function(v) {
        faqPost('/design/api/faq/hojas/' + h.id + '/seccion', {filas: g.filas.map(function(f) { return f.id; }), nombre: v})
          .then(faqCargarHoja).catch(faqError);
      });
      if (FAQ.edita) {
        if (!g.nombre) st.textContent = 'Sin sección';
        var mas = document.createElement('button'); mas.type = 'button'; mas.className = 'faq-sec-add'; mas.textContent = '+';
        mas.title = 'Agregar situación en esta sección';
        mas.onclick = function() { faqNuevaFila(g.nombre, g.filas[g.filas.length - 1].id); };
        sh.appendChild(mas);
      }
      tds.appendChild(sh); trs.appendChild(tds); body.appendChild(trs);
      trs._filas = [];
      g.filas.forEach(function(f) {
        var tr = document.createElement('tr'); tr.className = 'faq-fila'; tr._sec = trs; trs._filas.push(tr);
        tr._texto = faqNorm([g.nombre].concat(cols.map(function(c) { return f[c.k] || ''; })).join(' '));
        cols.forEach(function(c) {
          var td = document.createElement('td'); if (c.k === 'plantilla') td.className = 'faq-tpl';
          var cel = document.createElement('div'); cel.className = 'faq-cel'; cel.textContent = f[c.k] || '';
          faqEditable(cel, function(v) {
            faqPost('/design/api/faq/filas/' + f.id, {campo: c.k, valor: v}).then(function() {
              f[c.k] = v; tr._texto = faqNorm([g.nombre].concat(cols.map(function(cc) { return f[cc.k] || ''; })).join(' '));
            }).catch(faqError);
          });
          td.appendChild(cel);
          if (c.k === 'plantilla') {
            var pie = document.createElement('div'); pie.className = 'faq-tpl-pie';
            var cp = document.createElement('button'); cp.type = 'button'; cp.className = 'btn mini'; cp.textContent = 'Copiar';
            cp.onclick = function() { window.dsCopiar(f.plantilla || '', cp); };
            pie.appendChild(cp); td.appendChild(pie);
          }
          tr.appendChild(td);
        });
        if (FAQ.edita) {
          var tda = document.createElement('td'); tda.className = 'faq-acc';
          var x = document.createElement('button'); x.type = 'button'; x.className = 'faq-x'; x.textContent = '✕';
          x.title = 'Eliminar esta situación (va a la Papelera)';
          x.onclick = function() {
            if (!confirm('¿Eliminar esta fila? Se puede recuperar desde la Papelera.')) return;
            faqPost('/design/api/faq/filas/' + f.id + '/eliminar').then(faqCargarHoja).catch(faqError);
          };
          tda.appendChild(x); tr.appendChild(tda);
        }
        body.appendChild(tr);
      });
    });
    faqFiltrar();
  }
  function faqFiltrar() {
    var q = faqNorm(document.getElementById('faqBuscar').value.trim()), vis = 0, tot = 0;
    document.querySelectorAll('#faqBody tr.faq-sec').forEach(function(trs) {
      var n = 0;
      trs._filas.forEach(function(tr) { var ok = !q || tr._texto.indexOf(q) >= 0; tr.style.display = ok ? '' : 'none'; if (ok) n++; });
      trs.style.display = n ? '' : 'none';
      trs.querySelector('.faq-sec-n').textContent = '(' + n + ')';
      vis += n; tot += trs._filas.length;
    });
    document.getElementById('faqCuenta').textContent = q ? vis + ' de ' + tot + ' filas' : tot + (tot === 1 ? ' fila' : ' filas');
  }
  function faqNuevaFila(seccion, despuesDe) {
    faqPost('/design/api/faq/hojas/' + FAQ.hojaId + '/filas', {seccion: seccion || '', despuesDe: despuesDe || null}).then(function(r) {
      document.getElementById('faqBuscar').value = '';
      return faqCargarHoja().then(function() {
        var cel = null;
        document.querySelectorAll('#faqBody tr.faq-fila').forEach(function(tr, i) {
          if (FAQ.hoja.filas[i] && FAQ.hoja.filas[i].id === r.id) cel = tr.querySelector('.faq-cel');
        });
        if (cel) { cel.scrollIntoView({block: 'center'}); cel.focus(); }
      });
    }).catch(faqError);
  }
  window.faqAgregar = function(que) {
    if (!FAQ.hoja) return;
    if (que === 'situacion') {
      var ult = FAQ.hoja.filas[FAQ.hoja.filas.length - 1];
      faqNuevaFila(ult ? ult.seccion : 'Nueva sección', null);
    } else if (que === 'seccion') {
      var n = (prompt('Nombre de la nueva sección:', 'Nueva sección') || '').trim();
      if (n) faqNuevaFila(n, null);
    } else if (que === 'columna') {
      var c = (prompt('Nombre de la nueva columna:', 'Nueva columna') || '').trim();
      if (c) faqPost('/design/api/faq/hojas/' + FAQ.hojaId + '/columnas', {titulo: c}).then(faqCargarHoja).catch(faqError);
    }
  };
  window.faqHojaAccion = function(que) {
    var h = FAQ.hoja; if (!h && que !== 'nueva') return;
    if (que === 'renombrar') {
      var n = (prompt('Nuevo nombre de la hoja:', h.nombre) || '').trim();
      if (n && n !== h.nombre) faqPost('/design/api/faq/hojas/' + h.id + '/renombrar', {nombre: n}).then(function() { return faqCargarHojas(); }).catch(faqError);
    } else if (que === 'duplicar') {
      faqPost('/design/api/faq/hojas', {nombre: h.nombre + ' (copia)', duplicarDe: h.id}).then(function(r) { return faqCargarHojas(r.id); }).catch(faqError);
    } else if (que === 'nueva') {
      var nn = (prompt('Nombre de la nueva hoja:', 'Nueva hoja') || '').trim();
      if (nn) faqPost('/design/api/faq/hojas', {nombre: nn}).then(function(r) { return faqCargarHojas(r.id); }).catch(faqError);
    } else if (que === 'eliminar') {
      if (FAQ.hojas.length <= 1) { alert('Debe quedar al menos una hoja.'); return; }
      if (!confirm('¿Eliminar la hoja "' + h.nombre + '" con todas sus filas? Se puede recuperar desde la Papelera.')) return;
      faqPost('/design/api/faq/hojas/' + h.id + '/eliminar').then(function() { FAQ.hojaId = null; return faqCargarHojas(); }).catch(faqError);
    }
  };

  window.DS_PANELS.comments = cmtInit;

})();
;
(function() {
  function api(url) { return window.dsFetchJSON(url); }
  function postJSON(url, body) { return window.dsPostJSON(url, body); }
  function esc(v) { return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  var URL_PARAMS = new URLSearchParams(location.search);
  var PA = { areaId: null, sheetId: null, areas: [], sheets: [], detalle: null,
            deepLinkAreaId: URL_PARAMS.get('area_id') ? parseInt(URL_PARAMS.get('area_id')) : null,
            deepLinkSheetId: URL_PARAMS.get('sheet_id') ? parseInt(URL_PARAMS.get('sheet_id')) : null };

  // Presionar un área solo abre su lista de hojas; la hoja se carga únicamente al elegirla.
  // Solo se muestran las áreas que tienen hojas (Face Design, N6 y Support hoy no tienen ninguna);
  // si un área recibe hojas más adelante, vuelve a aparecer sola.
  function cargarAreas() {
    window.dsAreas().then(function(todas) {
      return Promise.all(todas.map(function(a) {
        return api('/design/api/preapproved/sheets?area_id=' + a.id).then(function(h) { return h.length ? a : null; }, function() { return null; });
      })).then(function(r) { return r.filter(Boolean); });
    }).then(function(areas) {
      PA.areas = areas;
      var cont = document.getElementById('paAreaTabs'); cont.innerHTML = '';
      if (!areas.length) { cont.innerHTML = '<p style="color:#4b5563;margin:4px 0">No hay Pre-Approved para tu área.</p>'; return; }
      areas.forEach(function(a) {
        cont.appendChild(dsDropArea(a, 'pa-tab' + (a.id === PA.areaId ? ' activo' : ''), function() { abrirListaArea(a); }));
      });
      // Deep link (?area_id=&sheet_id=): abre directamente esa hoja.
      var areaId = PA.deepLinkAreaId, sheetId = PA.deepLinkSheetId;
      PA.deepLinkAreaId = PA.deepLinkSheetId = null;
      // Sin enlace, empleados y aprobadores abren la hoja de su equipo (como el Schedule).
      var mia = window.DS_INICIO && window.DS_INICIO.miPreapproved;
      if (!sheetId && !PA.sheetId && mia) { areaId = mia.areaId; sheetId = mia.sheetId; }
      if (areaId && sheetId) {
        api('/design/api/preapproved/sheets?area_id=' + areaId).then(function(sheets) {
          if (sheets.some(function(s) { return s.id === sheetId; })) elegirHoja(areaId, sheets, sheetId);
        });
      }
    });
  }

  function dropDeArea(areaId) { return document.querySelector('#paAreaTabs .ds-drop[data-area="' + areaId + '"]'); }

  function abrirListaArea(area) {
    var drop = dropDeArea(area.id);
    if (drop.classList.contains('open')) { dsDropCerrar(); return; }
    api('/design/api/preapproved/sheets?area_id=' + area.id).then(function(sheets) {
      dsDropRenderItems(drop, sheets, area.id === PA.areaId ? PA.sheetId : null, 'Sin hojas', function(sheetId) {
        elegirHoja(area.id, sheets, sheetId);
      });
      dsDropAbrir(drop);
    });
  }

  function elegirHoja(areaId, sheets, sheetId) {
    if (PA.areaId && PA.areaId !== areaId && PA_BUSQ.q) { PA_BUSQ.q = ''; PA_BUSQ.hits = []; PA_BUSQ.tok++; document.getElementById('paBuscar').value = ''; }
    PA.areaId = areaId; PA.sheets = sheets;
    marcarArea();
    seleccionarHoja(sheetId);
  }

  function marcarArea() {
    document.querySelectorAll('#paAreaTabs .pa-tab').forEach(function(b, i) { b.classList.toggle('activo', PA.areas[i].id === PA.areaId); });
  }

  function actualizarTitulo() {
    var s = PA.sheets.find(function(x) { return x.id === PA.sheetId; });
    document.getElementById('paTituloHoja').innerText = s ? ' (' + s.nombre + ')' : '';
  }

  // Muestra/oculta todo lo que depende de tener una hoja abierta. Las herramientas de edición
  // solo aparecen para quien puede editar (roles por encima del diseñador).
  function mostrarHoja(visible) {
    ['paIzq', 'paGridPanel'].forEach(function(id) { document.getElementById(id).style.display = visible ? '' : 'none'; });
    document.getElementById('paHerr').style.display = visible && PA.edita ? '' : 'none';
    document.getElementById('paGestion').style.display = visible && PA.edita ? '' : 'none';
    document.getElementById('paSinHoja').style.display = visible ? 'none' : '';
  }

  function sinHoja() {
    PA.areaId = null; PA.sheetId = null; PA.sheets = [];
    marcarArea(); actualizarTitulo(); mostrarHoja(false);
  }

  // Recarga las hojas del área abierta (tras crear, renombrar, eliminar o "Cambios"); si la hoja ya no existe, queda sin selección.
  function cargarHojas() {
    var areaId = PA.areaId;
    if (!areaId) return;
    api('/design/api/preapproved/sheets?area_id=' + areaId).then(function(sheets) {
      if (PA.areaId !== areaId) return; // el usuario ya cambió de área mientras cargaba
      PA.sheets = sheets;
      if (sheets.some(function(s) { return s.id === PA.sheetId; })) seleccionarHoja(PA.sheetId);
      else sinHoja();
    });
  }

  function paPost(url, body) {
    PA.enVuelo = (PA.enVuelo || 0) + 1;
    var fin = function() { PA.enVuelo = Math.max(0, PA.enVuelo - 1); };
    var pr = fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body || {})})
      .then(function(r) { return r.json().then(function(d) { if (!r.ok) throw new Error(d.detail || 'No se pudo guardar.'); return d; }); });
    pr.then(fin, fin);
    return pr;
  }
  function paError(e) { alert(e && e.message ? e.message : 'No se pudo guardar.'); cargarDetalle(); }

  window.paNuevaHoja = function() {
    if (!PA.areaId) return;
    var nombre = (prompt('Nombre de la nueva hoja (ej. nombre del diseñador/manager):') || '').trim();
    if (!nombre) return;
    paPost('/design/api/preapproved/sheets?area_id=' + PA.areaId + '&nombre=' + encodeURIComponent(nombre))
      .then(function(r) { PA.sheetId = r.id; cargarHojas(); }).catch(paError);
  };
  window.paRenombrarHoja = function() {
    var d = PA.detalle; if (!d) return;
    var n = (prompt('Nuevo nombre de la hoja:', d.nombre) || '').trim();
    if (n && n !== d.nombre) paPost('/design/api/preapproved/sheets/' + d.id, {nombre: n}).then(cargarHojas).catch(paError);
  };
  window.paBorrarHoja = function() {
    if (!PA.sheetId || !confirm('¿Eliminar esta hoja completa? Se puede recuperar desde la Papelera.')) return;
    paPost('/design/api/preapproved/sheets/' + PA.sheetId + '/eliminar').then(function() { PA.sheetId = null; cargarHojas(); }).catch(paError);
  };

  function seleccionarHoja(sheetId) {
    PA.sheetId = sheetId;
    actualizarTitulo();
    cargarDetalle();
  }

  function cargarDetalle(enVivo) {
    var id = PA.sheetId;
    if (!id) return Promise.resolve();
    return api('/design/api/preapproved/sheets/' + id).then(function(d) {
      if (id !== PA.sheetId || !d || !d.id) return;
      var previo = PA.detalle && PA.detalle.id === d.id ? PA.detalle : null;
      if (enVivo && previo && JSON.stringify(previo) === JSON.stringify(d)) return;  // fue un cambio propio: ya se ve
      PA.detalle = d; PA.edita = !!d.puedeEditar; PA.version = null;
      mostrarHoja(true);
      var sc = document.getElementById('paScroll'), x = sc.scrollLeft, ov = document.getElementById('ov-preapproved'), y = ov ? ov.scrollTop : 0;
      renderTabla(d);
      sc.scrollLeft = x; if (ov && enVivo) ov.scrollTop = y;
      paMarcarBusqueda();
      if (enVivo && previo) {  // marca un momento las celdas que cambió otra persona
        d.filas.forEach(function(f) {
          var fp = previo.filas.find(function(z) { return z.id === f.id; });
          Object.keys(f.valores).forEach(function(doc) {
            if (fp && (fp.valores[doc] || '') === (f.valores[doc] || '')) return;
            var td = document.querySelector('#paTabla td[data-fila="' + f.id + '"][data-doc="' + doc + '"]');
            if (td) { td.classList.add('pa-vivo'); setTimeout(function() { td.classList.remove('pa-vivo'); }, 2500); }
          });
        });
      }
    });
  }

  // ---------- Pre-Approved en vivo ----------
  // Cada 5 s se pregunta la huella de la hoja abierta; si alguien la cambió, se vuelve a pedir y se redibuja
  // (conservando la posición). No se redibuja mientras la persona está editando una celda, tiene la ventana de
  // Cambios abierta, está ajustando un ancho o hay un guardado en curso.
  var paUltimaTecla = 0;
  document.addEventListener('keydown', function() { paUltimaTecla = Date.now(); }, true);
  function paOcupado() {
    var a = document.activeElement, ov = document.getElementById('ov-preapproved');
    if (PA.enVuelo > 0) return true;
    if (a && ov && ov.contains(a) && (a.isContentEditable || a.tagName === 'INPUT' && a.type !== 'search')) return true;
    if (a && a.id === 'paBuscar' && Date.now() - paUltimaTecla < 3000) return true;
    if (document.querySelector('#pacModal.open, .pa-rz.activo')) return true;
    return document.body.style.cursor === 'col-resize';
  }
  function paVivoTick() {
    var ov = document.getElementById('ov-preapproved');
    if (document.hidden || !ov || !ov.classList.contains('open') || !PA.sheetId || !PA.detalle) return;
    var id = PA.sheetId;
    api('/design/api/preapproved/sheets/' + id + '/version').then(function(r) {
      if (!r || id !== PA.sheetId) return;
      if (r.v === null) { if (!paOcupado()) cargarHojas(); return; }  // la hoja ya no existe
      if (PA.version === null || PA.version === undefined) { PA.version = r.v; return; }
      if (r.v === PA.version || paOcupado()) return;
      var vAntes = PA.version;
      api('/design/api/preapproved/sheets?area_id=' + PA.areaId).then(function(sheets) {
        if (id !== PA.sheetId || paOcupado()) return;
        var cambioLista = JSON.stringify((sheets || []).map(function(s) { return [s.id, s.nombre]; })) !==
                          JSON.stringify((PA.sheets || []).map(function(s) { return [s.id, s.nombre]; }));
        if (cambioLista) { PA.sheets = sheets; actualizarTitulo(); }
        return cargarDetalle(true).then(function() { if (id === PA.sheetId) PA.version = r.v; });
      });
    }).catch(function() {});
  }
  setInterval(paVivoTick, 5000);
  document.addEventListener('visibilitychange', function() { if (!document.hidden) paVivoTick(); });

  // Celda/encabezado editable en su lugar (solo quien puede editar). Esc cancela.
  function paEditable(el, texto, alGuardar) {
    el.textContent = String(texto || '').trim();
    if (!PA.edita) return;
    el.setAttribute('contenteditable', 'plaintext-only');
    var antes;
    el.addEventListener('focus', function() { antes = el.innerText; });
    el.addEventListener('keydown', function(e) { if (e.key === 'Escape') { e.stopPropagation(); el.innerText = antes; el.blur(); } });
    el.addEventListener('blur', function() {
      var v = el.innerText.replace(/\n$/, '');
      if (v !== antes) alGuardar(v);
    });
  }
  function paEsAsk(v) { return /^\s*always ask\.?\s*$/i.test(v || ''); }
  function paBotonX(titulo, alClic) {
    var x = document.createElement('button'); x.type = 'button'; x.className = 'faq-x'; x.textContent = '✕';
    x.title = titulo; x.onclick = function(e) { e.stopPropagation(); alClic(); };
    return x;
  }

  var PA_ANCHO_CRIT = 170, PA_ANCHO_DOC = 230;
  function renderTabla(d) {
    var tabla = document.getElementById('paTabla'); tabla.innerHTML = '';
    var tit0 = document.getElementById('paTitulo'), tit = tit0.cloneNode(false);
    tit0.replaceWith(tit); tit.removeAttribute('contenteditable');
    paEditable(tit, d.titulo || 'Pre-approved changes', function(v) {
      paPost('/design/api/preapproved/sheets/' + d.id, {titulo: v}).then(function() { d.titulo = v; }).catch(paError);
    });
    var anchos = d.anchos || {};
    var cg = document.createElement('colgroup');
    var cols = [{clave: 'crit', px: anchos.crit || PA_ANCHO_CRIT}].concat(d.doctores.map(function(doc) {
      return {clave: String(doc.id), px: anchos[String(doc.id)] || PA_ANCHO_DOC};
    }));
    cols.forEach(function(c) { var col = document.createElement('col'); col.style.width = c.px + 'px'; c.el = col; cg.appendChild(col); });
    tabla.appendChild(cg);
    var totalAncho = function() { tabla.style.width = cols.reduce(function(a, c) { return a + c.px; }, 0) + 'px'; };
    totalAncho();

    var thead = document.createElement('thead');
    // Fila 1: centros (agrupan doctores consecutivos)
    var r1 = document.createElement('tr'); r1.className = 'pa-r-centros';
    var esq = document.createElement('th'); esq.className = 'pa-fija'; r1.appendChild(esq);
    var usados = 0;
    d.centros.forEach(function(c) {
      var th = document.createElement('th'); th.colSpan = Math.max(1, c.span); th.dataset.centro = c.id;
      var h = document.createElement('div'); h.className = 'pa-th';
      var t = document.createElement('span'); t.className = 'pa-txt'; h.appendChild(t);
      paEditable(t, c.nombre, function(v) {
        paPost('/design/api/preapproved/centros/' + c.id, {nombre: v, span: c.span}).then(function() { c.nombre = v; }).catch(paError);
      });
      if (PA.edita) h.appendChild(paBotonX('Eliminar el centro y sus doctores (va a la Papelera)', function() {
        if (!confirm('¿Eliminar el centro "' + (c.nombre || '(sin nombre)') + '" con sus ' + c.span + ' doctor(es)? Se puede recuperar desde la Papelera.')) return;
        paPost('/design/api/preapproved/centros/' + c.id + '/eliminar').then(cargarDetalle).catch(paError);
      }));
      th.appendChild(h); r1.appendChild(th);
      usados += Math.max(1, c.span);
    });
    if (d.doctores.length > usados) { var thr = document.createElement('th'); thr.colSpan = d.doctores.length - usados; r1.appendChild(thr); }
    thead.appendChild(r1);
    // Fila 2: etiqueta de cambios + doctores
    var r2 = document.createElement('tr'); r2.className = 'pa-r-doctores';
    var chg = document.createElement('th'); chg.className = 'pa-fija';
    var chgT = document.createElement('span'); chgT.className = 'pa-txt'; chg.appendChild(chgT);
    paEditable(chgT, d.changesLabel || 'Changes', function(v) {
      paPost('/design/api/preapproved/sheets/' + d.id, {changesLabel: v}).then(function() { d.changesLabel = v; }).catch(paError);
    });
    r2.appendChild(chg);
    var ths = [chg];
    d.doctores.forEach(function(doc) {
      var th = document.createElement('th'); th.dataset.doctor = doc.id;
      var h = document.createElement('div'); h.className = 'pa-th';
      var t = document.createElement('span'); t.className = 'pa-txt'; h.appendChild(t);
      paEditable(t, doc.nombre, function(v) {
        paPost('/design/api/preapproved/doctores/' + doc.id, {nombre: v}).then(function() { doc.nombre = v; }).catch(paError);
      });
      if (PA.edita) h.appendChild(paBotonX('Eliminar doctor (va a la Papelera)', function() {
        if (!confirm('¿Eliminar al doctor "' + (doc.nombre || '(sin nombre)') + '" y sus valores? Se puede recuperar desde la Papelera.')) return;
        paPost('/design/api/preapproved/doctores/' + doc.id + '/eliminar').then(cargarDetalle).catch(paError);
      }));
      th.appendChild(h); r2.appendChild(th); ths.push(th);
    });
    thead.appendChild(r2);
    tabla.appendChild(thead);

    // Ajustar ancho arrastrando el borde (se guarda por hoja)
    if (PA.edita) ths.forEach(function(th, k) {
      var c = cols[k], rz = document.createElement('div'); rz.className = 'pa-rsz'; rz.title = 'Arrastra para ajustar el ancho';
      rz.addEventListener('mousedown', function(e) {
        e.preventDefault(); var x0 = e.clientX, w0 = c.px; rz.classList.add('activo');
        var mover = function(ev) { c.px = Math.max(60, Math.min(800, w0 + ev.clientX - x0)); c.el.style.width = c.px + 'px'; totalAncho(); };
        var soltar = function() {
          document.removeEventListener('mousemove', mover); document.removeEventListener('mouseup', soltar); rz.classList.remove('activo');
          if (c.px !== w0) paPost('/design/api/preapproved/sheets/' + d.id + '/anchos', {clave: c.clave, px: c.px}).catch(paError);
        };
        document.addEventListener('mousemove', mover); document.addEventListener('mouseup', soltar);
      });
      th.appendChild(rz);
    });

    var tbody = document.createElement('tbody');
    d.filas.forEach(function(fila) {
      var tr = document.createElement('tr');
      var th = document.createElement('th'); th.className = 'pa-fija';
      var h = document.createElement('div'); h.className = 'pa-th';
      var t = document.createElement('span'); t.className = 'pa-txt'; h.appendChild(t);
      paEditable(t, fila.criterio, function(v) {
        paPost('/design/api/preapproved/filas/' + fila.id, {nombre: v}).then(function() { fila.criterio = v; }).catch(paError);
      });
      if (PA.edita) h.appendChild(paBotonX('Eliminar criterio (va a la Papelera)', function() {
        if (!confirm('¿Eliminar el criterio "' + (fila.criterio || '(sin nombre)') + '"? Se puede recuperar desde la Papelera.')) return;
        paPost('/design/api/preapproved/filas/' + fila.id + '/eliminar').then(cargarDetalle).catch(paError);
      }));
      th.appendChild(h); tr.appendChild(th);
      d.doctores.forEach(function(doc) {
        var td = document.createElement('td'), val = fila.valores[String(doc.id)] || '';
        td.dataset.fila = fila.id; td.dataset.doc = doc.id;
        if (paEsAsk(val)) td.className = 'pa-ask';
        var c = document.createElement('div'); c.className = 'pa-txt'; td.appendChild(c);
        paEditable(c, val, function(v) {
          td.classList.toggle('pa-ask', paEsAsk(v));
          paPost('/design/api/preapproved/celdas', {filaId: fila.id, doctorId: doc.id, valor: v})
            .then(function() { fila.valores[String(doc.id)] = v; }).catch(paError);
        });
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    tabla.appendChild(tbody);
  }

  // Buscar: busca doctores y centros en todas las hojas del ÁREA ABIERTA (cada área funciona por separado). Resalta los de la hoja abierta y lleva
  // al primero; si solo hay en otra hoja, cambia a esa hoja. Enter pasa al siguiente (también de una hoja a otra).
  var PA_BUSQ = {q: '', hits: [], i: 0, tok: 0};
  function paNorm(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
  function paCuentaTexto() {
    var cuenta = document.getElementById('paCuenta'), n = PA_BUSQ.hits.length, h = PA_BUSQ.hits[PA_BUSQ.i];
    if (!PA_BUSQ.q) { cuenta.textContent = ''; return; }
    if (!n) { cuenta.textContent = 'Sin coincidencias'; return; }
    var otras = new Set(PA_BUSQ.hits.map(function(x) { return x.sheetId; })).size;
    cuenta.textContent = (n === 1 ? '1 coincidencia' : (PA_BUSQ.i + 1) + ' de ' + n + ' coincidencias') +
      (otras > 1 || (h && h.sheetId !== PA.sheetId) ? ' · hoja ' + h.hoja : '');
  }
  // Resalta en la hoja abierta lo que coincide y lleva al resultado actual (si es de esta hoja).
  function paMarcarBusqueda() {
    document.querySelectorAll('#paTabla .pa-hl').forEach(function(x) { x.classList.remove('pa-hl'); });
    paCuentaTexto();
    if (!PA_BUSQ.q) return;
    PA_BUSQ.hits.forEach(function(h) {
      if (h.sheetId !== PA.sheetId) return;
      var el = document.querySelector('#paTabla th[data-' + h.tipo + '="' + h.id + '"]'); if (el) el.classList.add('pa-hl');
    });
    var act = PA_BUSQ.hits[PA_BUSQ.i];
    if (!act || act.sheetId !== PA.sheetId) return;
    var obj = document.querySelector('#paTabla th[data-' + act.tipo + '="' + act.id + '"]'), sc = document.getElementById('paScroll');
    var fijaEl = document.querySelector('#paTabla thead .pa-fija');
    if (!obj || !sc || !fijaEl) return;
    var fija = fijaEl.offsetWidth;
    sc.scrollTo({left: Math.max(0, obj.offsetLeft - fija - (sc.clientWidth - fija - obj.offsetWidth) / 2), behavior: 'smooth'});
  }
  function paIrAResultado() {
    var h = PA_BUSQ.hits[PA_BUSQ.i];
    if (!h) { paMarcarBusqueda(); return; }
    if (h.sheetId === PA.sheetId) { paMarcarBusqueda(); return; }
    api('/design/api/preapproved/sheets?area_id=' + h.areaId).then(function(sheets) {
      if (PA_BUSQ.hits[PA_BUSQ.i] !== h) return;  // el usuario siguió escribiendo
      elegirHoja(h.areaId, sheets, h.sheetId);  // al cargar, cargarDetalle llama a paMarcarBusqueda
    });
  }
  function paBuscar(siguiente) {
    var q = paNorm(document.getElementById('paBuscar').value.trim());
    if (siguiente && q && q === PA_BUSQ.q && PA_BUSQ.hits.length) {
      PA_BUSQ.i = (PA_BUSQ.i + 1) % PA_BUSQ.hits.length; paIrAResultado(); return;
    }
    var t = ++PA_BUSQ.tok;
    if (!q) { PA_BUSQ.q = ''; PA_BUSQ.hits = []; paMarcarBusqueda(); return; }
    // solo en el área abierta: N3 busca en N3, N2 en N2
    api('/design/api/preapproved/buscar?q=' + encodeURIComponent(q) + (PA.areaId ? '&area_id=' + PA.areaId : '')).then(function(hits) {
      if (t !== PA_BUSQ.tok) return;
      PA_BUSQ.q = q; PA_BUSQ.hits = hits || [];
      var aqui = PA_BUSQ.hits.findIndex(function(h) { return h.sheetId === PA.sheetId; });
      PA_BUSQ.i = aqui >= 0 ? aqui : 0;  // primero lo de la hoja abierta
      paIrAResultado();
    }).catch(function() { if (t === PA_BUSQ.tok) document.getElementById('paCuenta').textContent = 'No se pudo buscar'; });
  }
  var paBuscarTimer = null;
  document.getElementById('paBuscar').addEventListener('input', function() { clearTimeout(paBuscarTimer); paBuscarTimer = setTimeout(function() { paBuscar(false); }, 350); });
  document.getElementById('paBuscar').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); clearTimeout(paBuscarTimer); paBuscar(true); }
  });

  window.paAgregarCentro = function() {
    var n = (prompt('Nombre del nuevo centro:', 'Nuevo centro') || '').trim();
    if (!n) return;
    var k = parseInt(prompt('¿Cuántos doctores tendrá este centro?', '1'), 10);
    if (!k || k < 1) k = 1;
    paPost('/design/api/preapproved/sheets/' + PA.sheetId + '/centros?nombre=' + encodeURIComponent(n) + '&doctores=' + k)
      .then(function() { cargarDetalle(); setTimeout(function() { var sc = document.getElementById('paScroll'); sc.scrollTo({left: sc.scrollWidth, behavior: 'smooth'}); }, 300); })
      .catch(paError);
  };
  window.paAgregarDoctor = function() {
    paPost('/design/api/preapproved/sheets/' + PA.sheetId + '/doctores')
      .then(function() { cargarDetalle(); setTimeout(function() { var sc = document.getElementById('paScroll'); sc.scrollTo({left: sc.scrollWidth, behavior: 'smooth'}); }, 300); })
      .catch(paError);
  };
  window.paAgregarFila = function() { paPost('/design/api/preapproved/sheets/' + PA.sheetId + '/filas').then(cargarDetalle).catch(paError); };

  // ---------- Cambios: mover/intercambiar doctores y centros entre managers ----------
  var PAC = { mode: 'move', srcSheetId: null, dstSheetId: null, srcSel: null, dstSel: null,
             targetCentro: '__new__', srcDetalle: null, dstDetalle: null };

  window.pacAbrir = function() {
    if (!PA.sheets.length) { alert('Esta área no tiene hojas todavía.'); return; }
    PAC.mode = 'move';
    PAC.srcSheetId = PA.sheetId || PA.sheets[0].id;
    var otra = PA.sheets.find(function(s) { return s.id !== PAC.srcSheetId; });
    PAC.dstSheetId = otra ? otra.id : PAC.srcSheetId;
    PAC.srcSel = null; PAC.dstSel = null; PAC.targetCentro = '__new__';
    document.querySelectorAll('#pacModal .pac-mode-btn').forEach(function(b) { b.classList.toggle('activo', b.dataset.mode === 'move'); });
    pacRenderTodo();
    document.getElementById('pacModal').classList.add('open');
  };
  window.pacCerrar = function() { document.getElementById('pacModal').classList.remove('open'); };
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && document.getElementById('pacModal').classList.contains('open')) { e.stopImmediatePropagation(); e.preventDefault(); pacCerrar(); }
  }, true);

  function pacRenderTodo() {
    pacRenderManagers();
    Promise.all([api('/design/api/preapproved/sheets/' + PAC.srcSheetId), api('/design/api/preapproved/sheets/' + PAC.dstSheetId)])
      .then(function(r) {
        PAC.srcDetalle = r[0]; PAC.dstDetalle = r[1];
        pacRenderArbol('src'); pacRenderArbol('dst'); pacRenderMid();
      }).catch(function(e) {
        var summary = document.getElementById('pacSummary');
        summary.textContent = 'No se pudieron cargar las hojas: ' + e.message; summary.className = 'pac-summary warn';
      });
  }

  function pacRenderManagers() {
    ['src', 'dst'].forEach(function(side) {
      var sel = document.getElementById('pacMgr' + side);
      var cur = side === 'src' ? PAC.srcSheetId : PAC.dstSheetId;
      sel.innerHTML = PA.sheets.map(function(s) {
        return '<option value="' + s.id + '"' + (s.id === cur ? ' selected' : '') + '>' + esc(s.nombre) + '</option>';
      }).join('');
    });
  }

  function pacRenderArbol(side) {
    var host = document.getElementById('pac' + side + 'Tree');
    var d = side === 'src' ? PAC.srcDetalle : PAC.dstDetalle;
    if (!host || !d) return;
    var sel = side === 'src' ? PAC.srcSel : PAC.dstSel;
    var idx = 0;
    var html = d.centros.map(function(c) {
      var start = idx; idx += c.span;
      var centroSel = sel && sel.tipo === 'centro' && sel.id === c.id;
      var docsHtml = '';
      d.doctores.slice(start, start + c.span).forEach(function(doc) {
        var docSel = sel && sel.tipo === 'doctor' && sel.id === doc.id;
        docsHtml += '<button type="button" class="pac-doc' + (docSel ? ' sel' : '') + '" data-side="' + side + '" data-tipo="doctor" data-id="' + doc.id + '">' + esc(doc.nombre || 'Sin nombre') + '</button>';
      });
      return '<div class="pac-centro' + (centroSel ? ' sel' : '') + '">' +
        '<div class="pac-centro-head" data-side="' + side + '" data-tipo="centro" data-id="' + c.id + '">🏢 ' + esc(c.nombre || 'Sin centro') + '<span class="pac-badge">' + c.span + '</span></div>' +
        '<div class="pac-docs">' + docsHtml + '</div></div>';
    }).join('') || '<div style="color:#4b5563;font-size:12px;padding:8px">Este manager no tiene centros.</div>';
    host.innerHTML = html;
    var seleccionable = PAC.mode === 'swap' || side === 'src';
    host.style.opacity = seleccionable ? '1' : '.6';
  }

  function pacRenderMid() {
    var btn = document.getElementById('pacApplyBtn');
    var tcBlock = document.getElementById('pacTargetCentroBlock');
    var tcSel = document.getElementById('pacTargetCentro');
    var summary = document.getElementById('pacSummary');
    if (!PAC.srcDetalle || !PAC.dstDetalle) return;
    btn.innerText = PAC.mode === 'move' ? 'Mover →' : 'Intercambiar ⇄';

    var showTC = PAC.mode === 'move' && PAC.srcSel;
    tcBlock.style.display = showTC ? '' : 'none';
    if (showTC) {
      var opts = '<option value="__new__">+ Nuevo centro</option>';
      PAC.dstDetalle.centros.forEach(function(c) {
        opts += '<option value="' + c.id + '"' + (String(c.id) === String(PAC.targetCentro) ? ' selected' : '') + '>Fusionar en «' + esc(c.nombre || 'Sin centro') + '»</option>';
      });
      tcSel.innerHTML = opts;
      if (PAC.targetCentro !== '__new__' && !PAC.dstDetalle.centros.some(function(c) { return String(c.id) === String(PAC.targetCentro); })) PAC.targetCentro = '__new__';
      tcSel.value = PAC.targetCentro;
    }

    var ok = false, msg = '';
    if (PAC.mode === 'move') {
      if (!PAC.srcSel) msg = 'Elige un doctor o centro en Origen.';
      else if (PAC.srcSheetId === PAC.dstSheetId) msg = 'Elige un manager de destino distinto.';
      else { ok = true; msg = 'Mover ' + (PAC.srcSel.tipo === 'doctor' ? 'el doctor' : 'el centro') + ' seleccionado a este manager.'; }
    } else {
      if (!PAC.srcSel) msg = 'Elige un ítem en Origen.';
      else if (!PAC.dstSel) msg = 'Elige un ítem en Destino.';
      else if (PAC.srcSheetId === PAC.dstSheetId) msg = 'Elige dos managers distintos.';
      else if (PAC.srcSel.tipo !== PAC.dstSel.tipo) msg = 'Deben ser del mismo tipo (doctor↔doctor o centro↔centro).';
      else { ok = true; msg = 'Intercambiar ambos elementos seleccionados.'; }
    }
    btn.disabled = !ok;
    summary.textContent = msg;
    summary.className = 'pac-summary';
  }

  window.pacAplicar = function() {
    var url, body;
    if (PAC.mode === 'move') {
      var centroDestinoId = PAC.targetCentro === '__new__' ? null : parseInt(PAC.targetCentro);
      if (PAC.srcSel.tipo === 'doctor') {
        url = '/design/api/preapproved/cambios/mover-doctor';
        body = {doctorId: PAC.srcSel.id, sheetDestinoId: PAC.dstSheetId, centroDestinoId: centroDestinoId};
      } else {
        url = '/design/api/preapproved/cambios/mover-centro';
        body = {centroId: PAC.srcSel.id, sheetDestinoId: PAC.dstSheetId, centroDestinoId: centroDestinoId};
      }
    } else if (PAC.srcSel.tipo === 'doctor') {
      url = '/design/api/preapproved/cambios/intercambiar-doctor';
      body = {doctorAId: PAC.srcSel.id, doctorBId: PAC.dstSel.id};
    } else {
      url = '/design/api/preapproved/cambios/intercambiar-centro';
      body = {centroAId: PAC.srcSel.id, centroBId: PAC.dstSel.id};
    }
    var btn = document.getElementById('pacApplyBtn'); btn.disabled = true;
    fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})
      .then(function(r) { return r.json().then(function(data) { return {ok: r.ok, data: data}; }); })
      .then(function(res) {
        var summary = document.getElementById('pacSummary');
        if (!res.ok) {
          summary.textContent = res.data.detail || 'No se pudo aplicar.';
          summary.className = 'pac-summary warn';
          btn.disabled = false;
          return;
        }
        summary.textContent = 'Listo.' + (res.data.unmatched ? ' ⚠️ ' + res.data.unmatched + ' valor(es) en criterios que no existen en el destino se descartaron.' : '') +
          (res.data.openings && res.data.openings.length ? ' Openings también se actualizó (' + res.data.openings.join(' · ') + ').' : '');
        summary.className = 'pac-summary ok';
        PAC.srcSel = null; PAC.dstSel = null; PAC.targetCentro = '__new__';
        pacRenderTodo();
        cargarHojas();
      }).catch(function() {
        var summary = document.getElementById('pacSummary');
        summary.textContent = 'No se pudo aplicar: se perdió la conexión o el servidor falló. Intenta de nuevo.';
        summary.className = 'pac-summary warn'; btn.disabled = false;
      });
  };

  (function initPac() {
    var modal = document.getElementById('pacModal'); if (!modal) return;
    document.getElementById('pacCloseBtn').addEventListener('click', window.pacCerrar);
    modal.addEventListener('click', function(e) { if (e.target === modal) window.pacCerrar(); });
    modal.querySelectorAll('.pac-mode-btn').forEach(function(b) {
      b.addEventListener('click', function() {
        PAC.mode = b.dataset.mode; PAC.srcSel = null; PAC.dstSel = null; PAC.targetCentro = '__new__';
        modal.querySelectorAll('.pac-mode-btn').forEach(function(x) { x.classList.toggle('activo', x === b); });
        pacRenderTodo();
      });
    });
    document.getElementById('pacMgrsrc').addEventListener('change', function() {
      PAC.srcSheetId = parseInt(this.value); PAC.srcSel = null; PAC.targetCentro = '__new__'; pacRenderTodo();
    });
    document.getElementById('pacMgrdst').addEventListener('change', function() {
      PAC.dstSheetId = parseInt(this.value); PAC.dstSel = null; PAC.targetCentro = '__new__'; pacRenderTodo();
    });
    document.getElementById('pacTargetCentro').addEventListener('change', function() { PAC.targetCentro = this.value; pacRenderMid(); });
    document.getElementById('pacApplyBtn').addEventListener('click', window.pacAplicar);
    modal.querySelectorAll('.pac-tree').forEach(function(tree) {
      tree.addEventListener('click', function(e) {
        var el = e.target.closest('[data-tipo]'); if (!el) return;
        var side = el.dataset.side;
        if (PAC.mode === 'move' && side === 'dst') return;
        var sel = {tipo: el.dataset.tipo, id: parseInt(el.dataset.id)};
        if (side === 'src') { PAC.srcSel = sel; PAC.targetCentro = '__new__'; } else { PAC.dstSel = sel; }
        pacRenderArbol('src'); pacRenderArbol('dst'); pacRenderMid();
      });
    });
  })();

  window.DS_PANELS.preapproved = cargarAreas;

})();
;
(function() {
  function esc(v) { return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function api(url) { return window.dsFetchJSON(url); }
  function postJSON(url, body) { return window.dsPostJSON(url, body); }
  function Date_nowSafe() { try { return Date.now(); } catch (e) { return 0; } }

  var CV = { areas: [], areaId: null };
  var CANVAS = { docs: [], activeId: null, view: "home", selFrame: null, scale: 1, railCollapsed: false };
  var cvSaveTimers = {}, cvGuardando = {};

  // ---------- Áreas ----------
  function cvCargarAreas() {
    CANVAS.homeMode = "board"; // Canvas siempre abre en vista Tablero (se puede cambiar en el momento)
    window.dsAreas().then(function(areas) {
      CV.areas = areas;
      var cont = document.getElementById('cvAreaTabs'); cont.innerHTML = '';
      areas.forEach(function(a) {
        var btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'cv-area-tab' + (a.id === CV.areaId ? ' activo' : '');
        btn.innerText = a.nombre;
        btn.onclick = function() { cvSeleccionarArea(a.id); };
        cont.appendChild(btn);
      });
      if (areas.length) cvSeleccionarArea(areas.some(function(a) { return a.id === CV.areaId; }) ? CV.areaId : areas[0].id);
    });
  }
  function cvSeleccionarArea(areaId) {
    CV.areaId = areaId;
    document.querySelectorAll('#cvAreaTabs .cv-area-tab').forEach(function(b, i) { b.classList.toggle('activo', CV.areas[i].id === areaId); });
    CANVAS.view = "home"; CANVAS.activeId = null; CANVAS.selFrame = null; CANVAS.selEl = null;
    cvLoadPrefs();
    CANVAS.hist = { undo: [], redo: [] };
    cvLoadDocs(areaId).then(cvRender, function(e) {
      if (e && e.viejo) return;
      var home = document.getElementById("canvasHome");
      home.innerHTML = '<div class="cv-empty" style="padding:30px;color:#b91c1c">No se pudieron cargar las hojas. <button type="button" class="cv-mini-btn">Reintentar</button></div>';
      home.querySelector("button").onclick = function() { cvSeleccionarArea(areaId); };
    });
  }

  // ---------- Persistencia ----------
  var CV_NUM = ["x", "y", "w", "h", "r", "x1", "y1", "x2", "y2", "stroke", "size", "rot", "nw", "nh", "scale", "ox", "oy", "bri", "con"];
  function cvColorSeguro(c, def) { return (typeof c === "string" && /^#[0-9a-fA-F]{3,8}$/.test(c)) ? c : def; }
  function cvSanear(o) {
    if (!o || typeof o !== "object") return o;
    CV_NUM.forEach(function(k) { if (k in o && typeof o[k] !== "number") o[k] = Number(o[k]) || 0; });
    if ("color" in o) o.color = cvColorSeguro(o.color, "#e11d1d");
    if ("n" in o) o.n = parseInt(o.n, 10) || 1;
    if ("id" in o) o.id = String(o.id).replace(/[^A-Za-z0-9_-]/g, "");
    if (Array.isArray(o.points)) o.points = o.points.map(function(p) { return {x: Number(p && p.x) || 0, y: Number(p && p.y) || 0}; });
    if (o.img) {
      if (typeof o.img.src !== "string" || !/^data:image\/(png|jpe?g|gif|webp|bmp|svg\+xml);base64,[A-Za-z0-9+\/=\s]*$/.test(o.img.src.slice(0, 300))) o.img = null;
      else cvSanear(o.img);
    }
    return o;
  }
  function cvFromServer(d) {
    return { id: d.id, name: d.nombre, templateId: d.templateId, title: d.titulo, titleColor: cvColorSeguro(d.tituloColor, "#d10a11"),
             w: Number(d.w) || 1080, h: Number(d.h) || 1080, frames: (d.frames || []).map(cvSanear), elements: (d.elements || []).map(cvSanear), updated: Date_nowSafe() };
  }
  function cvLoadDocs(areaId) {
    return api('/design/api/canvas/docs?area_id=' + areaId).then(function(docs) {
      if (areaId !== CV.areaId) throw {viejo: true}; // el usuario ya cambió de área
      CANVAS.docs = docs.map(cvFromServer);
    });
  }
  function cvLoadPrefs() {
    try { CANVAS.railCollapsed = localStorage.getItem("canvas_rail_collapsed") === "1"; } catch (e) {}
    if (!CANVAS.homeMode) CANVAS.homeMode = "board";
    try { CANVAS.expert = localStorage.getItem("canvas_expert") === "1"; } catch (e) { CANVAS.expert = false; }
    if (CANVAS.stroke == null) CANVAS.stroke = 7;
  }
  // Guarda (debounced) el contenido mutable de UNA hoja en el backend.
  function cvSave(docId) {
    docId = docId || CANVAS.activeId;
    if (!docId) return;
    cvRailRefreshActive();
    clearTimeout(cvSaveTimers[docId]);
    var docRef = CANVAS.docs.find(function(d) { return d.id === docId; }); // si cambia de área antes de guardar, no se pierde
    cvSaveTimers[docId] = setTimeout(function() {
      cvSaveTimers[docId] = null;
      var doc = CANVAS.docs.find(function(d) { return d.id === docId; }) || docRef;
      if (!doc) return;
      var cuerpo = {nombre: doc.name, titulo: doc.title, tituloColor: doc.titleColor, w: doc.w, h: doc.h, frames: doc.frames, elements: doc.elements};
      // Los guardados de una misma hoja salen uno tras otro: nunca llega uno viejo después de uno nuevo.
      cvGuardando[docId] = (cvGuardando[docId] || Promise.resolve()).then(function() {
        return postJSON('/design/api/canvas/docs/' + docId, cuerpo).catch(function(e) {
          cvAviso('<span>⚠️ No se pudo guardar la hoja "' + esc(doc.name || '') + '": ' + esc(e.message) + '</span>', false);
        });
      });
    }, 300);
  }
  window.addEventListener('beforeunload', function(e) {
    if (Object.keys(cvSaveTimers).some(function(k) { return cvSaveTimers[k]; })) { e.preventDefault(); e.returnValue = ''; }
  });
  function cvToggleExpert() {
    CANVAS.expert = !CANVAS.expert;
    try { localStorage.setItem("canvas_expert", CANVAS.expert ? "1" : "0"); } catch (e) {}
    if (!CANVAS.expert && ["rect", "line", "hl", "num"].includes(CANVAS.tool)) CANVAS.tool = "select";
    CANVAS._toolGroup = null;
    if (CANVAS.view === "editor") cvRenderEditor(); else cvRenderTools();
  }
  var CV_VIEWS = [{ id: "grid", label: "Cuadrícula" }, { id: "board", label: "Tablero" }];
  function cvSetView(mode, makeDefault) {
    if (mode !== "grid" && mode !== "board") return;
    CANVAS.homeMode = mode;
    cvRender();
  }

  // ---------- CRUD de hojas ----------
  function cvActiveDoc() { return CANVAS.docs.find(function(d) { return d.id === CANVAS.activeId; }) || null; }
  function cvDocIndex(doc) { return CANVAS.docs.findIndex(function(d) { return d.id === doc.id; }); }
  function cvOpenDoc(id) { CANVAS.activeId = id; CANVAS.view = "editor"; CANVAS.selFrame = null; cvRender(); }
  function cvBackHome() { cvCloseAdjust(); CANVAS.view = "home"; CANVAS.activeId = null; CANVAS.selFrame = null; cvRender(); }

  function cvNewCustomSheet() {
    postJSON('/design/api/canvas/docs', { areaId: CV.areaId, nombre: "Hoja personalizada", titulo: "Título", templateId: "", frames: [] })
      .then(function(r) {
        CANVAS.docs.unshift(cvFromServer({ id: r.id, nombre: "Hoja personalizada", titulo: "Título", tituloColor: "#d10a11", w: 1080, h: 1080, frames: [], elements: [] }));
        CANVAS.activeId = r.id; CANVAS.view = "editor"; CANVAS.selFrame = null;
        cvRender();
      });
  }
  // Eliminar hoja: pide confirmación y luego muestra un aviso con "Deshacer" (10 s).
  // Devuelve true si se eliminó (el panel de hojas lo usa para pasar a una hoja vecina).
  function cvDeleteDoc(id) {
    var idx = CANVAS.docs.findIndex(function(x) { return x.id === id; }); if (idx < 0) return false;
    var nombre = CANVAS.docs[idx].name || CANVAS.docs[idx].title || 'Hoja';
    if (!confirm('¿Eliminar la hoja "' + nombre + '"? Podrás deshacerlo en el aviso que aparece abajo.')) return false;
    var areaId = CV.areaId;
    CANVAS.docs.splice(idx, 1);
    if (CANVAS.activeId === id) { CANVAS.view = "home"; CANVAS.activeId = null; }
    cvRender();
    fetch('/design/api/canvas/docs/' + id + '/eliminar', {method: 'POST'})
      .then(function(r) { return r.json().then(function(d) { if (!r.ok) throw new Error(d.detail || 'No se pudo eliminar.'); return d; }); })
      .then(function(r) { cvAvisoDeshacer(nombre, r.papeleraId, areaId); })
      .catch(function(e) { alert(e.message); cvLoadDocs(areaId).then(cvRender); });
    return true;
  }
  var cvAvisoTimer = null;
  function cvAviso(html, conDeshacer) {
    var v = document.getElementById('cvAviso');
    if (!v) { v = document.createElement('div'); v.id = 'cvAviso'; v.className = 'cv-aviso'; v.setAttribute('role', 'status'); document.body.appendChild(v); }
    v.innerHTML = html; v.classList.add('open');
    clearTimeout(cvAvisoTimer);
    cvAvisoTimer = setTimeout(function() { v.classList.remove('open'); }, conDeshacer ? 10000 : 3500);
    return v;
  }
  function cvAvisoDeshacer(nombre, papeleraId, areaId) {
    var v = cvAviso('<span>🗑️ Hoja <b></b> eliminada</span><button type="button" class="cv-aviso-btn">Deshacer</button><button type="button" class="cv-aviso-x" title="Cerrar">✕</button>', true);
    v.querySelector('b').textContent = '"' + nombre + '"';
    v.querySelector('.cv-aviso-x').onclick = function() { v.classList.remove('open'); };
    var btn = v.querySelector('.cv-aviso-btn');
    btn.onclick = function() {
      btn.disabled = true;
      fetch('/design/api/canvas/deshacer/' + papeleraId, {method: 'POST'})
        .then(function(r) { return r.json().then(function(d) { if (!r.ok) throw new Error(d.detail || 'No se pudo restaurar.'); return d; }); })
        .then(function() {
          cvAviso('<span>✅ Hoja restaurada</span>', false);
          if (CV.areaId === areaId) cvLoadDocs(areaId).then(cvRender);
        })
        .catch(function(e) { cvAviso('<span></span>', false).querySelector('span').textContent = '⚠️ ' + e.message; });
    };
  }
  function cvDuplicateDoc(id) {
    postJSON('/design/api/canvas/docs/' + id + '/duplicar').then(function(r) {
      CANVAS.docs.unshift(cvFromServer(r)); cvRender();
    });
  }
  function cvRenameDoc(id) {
    var d = CANVAS.docs.find(function(x) { return x.id === id; }); if (!d) return;
    var n = (prompt("Nuevo nombre:", d.name) || "").trim(); if (!n) return;
    d.name = n; d.updated = Date_nowSafe();
    postJSON('/design/api/canvas/docs/' + id + '/renombrar', { nombre: n }).then(cvRender);
  }

  /* ---------- Render ---------- */
  function cvRender() {
    var home = document.getElementById("canvasHome");
    var ed = document.getElementById("canvasEditor");
    if (!home || !ed) return;
    if (CANVAS.view === "editor" && cvActiveDoc()) {
      home.style.display = "none"; ed.style.display = "";
      cvRenderEditor();
    } else {
      ed.style.display = "none"; home.style.display = "";
      cvRenderHome();
    }
  }

  function cvDocW(doc) { return (doc && doc.w) || 1080; }
  function cvDocH(doc) { return (doc && doc.h) || 1080; }
  var CV_SIZE_PRESETS = [
    { label: "Cuadrado", w: 1080, h: 1080 }, { label: "Horizontal", w: 1350, h: 1080 },
    { label: "Vertical", w: 1080, h: 1350 }, { label: "Story", w: 1080, h: 1920 }, { label: "Carta", w: 1400, h: 1080 },
  ];
  function cvApplySize(doc, w, h) {
    w = Math.round(+w); h = Math.round(+h);
    if (!(w >= 400 && w <= 4000 && h >= 400 && h <= 4000)) { alert("El tamaño debe estar entre 400 y 4000 px por lado."); return; }
    doc.w = w; doc.h = h; doc.updated = Date_nowSafe(); cvSave(); cvRenderEditor();
  }

  var _cvMeasureCtx = null;
  function cvMeasureCtx() { if (!_cvMeasureCtx) { _cvMeasureCtx = document.createElement("canvas").getContext("2d"); } return _cvMeasureCtx; }
  function cvTitleSize(title) {
    var ctx = cvMeasureCtx(), size = 78;
    while (size > 34) { ctx.font = "800 " + size + "px Inter, Arial, sans-serif"; if (ctx.measureText(title || "").width <= 980) break; size -= 2; }
    return size;
  }

  function cvMiniPreview(tpl) {
    var W = cvDocW(tpl), H = cvDocH(tpl), s = 118 / Math.max(W, H);
    var mw = Math.round(W * s), mh = Math.round(H * s);
    var frames = (tpl.frames || []).map(function(f) {
      return '<div class="cv-mini-frame" style="left:' + (f.x * s) + 'px;top:' + (f.y * s) + 'px;width:' + (f.w * s) + 'px;height:' + (f.h * s) + 'px"></div>';
    }).join('');
    return '<div class="cv-mini" style="width:' + mw + 'px;height:' + mh + 'px"><div class="cv-mini-title">' + esc(tpl.title) + '</div>' + frames + '</div>';
  }
  function cvSheetThumb(doc, maxSide) {
    var W = cvDocW(doc), H = cvDocH(doc), s = maxSide / Math.max(W, H);
    var bw = Math.round(W * s), bh = Math.round(H * s);
    var tsize = Math.max(7, Math.round(cvTitleSize(doc.title) * s));
    var bt = CANVAS.boardTarget;
    var frames = (doc.frames || []).map(function(f) {
      var st = 'left:' + (f.x * s) + 'px;top:' + (f.y * s) + 'px;width:' + (f.w * s) + 'px;height:' + (f.h * s) + 'px';
      var isT = bt && bt.docId === doc.id && bt.frameId === f.id;
      var cls = "cv-thumb-frame" + (f.img && f.img.src ? " has-img" : "") + (isT ? " cv-btarget" : "");
      var bg = (f.img && f.img.src) ? (";background-image:url('" + f.img.src + "')") : "";
      var plus = (!f.img) ? '<span class="cv-thumb-plus">+</span>' : "";
      return '<div class="' + cls + '" data-bframe="' + f.id + '" data-bdoc="' + doc.id + '" title="Clic para agregar imagen" style="' + st + bg + '">' + plus + '</div>';
    }).join('');
    var title = '<div class="cv-thumb-title" style="color:' + (doc.titleColor || '#d10a11') + ';font-size:' + tsize + 'px;top:' + Math.round(56 * s) + 'px">' + esc(doc.title || "") + '</div>';
    return '<div class="cv-thumb" style="width:' + bw + 'px;height:' + bh + 'px">' + title + frames + '</div>';
  }
  var CV_VIEW_ICON = {
    grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    board: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;"><rect x="3" y="4" width="8" height="16" rx="1.5"/><rect x="13" y="4" width="8" height="10" rx="1.5"/></svg>',
  };
  function cvHomeHeader() {
    var cur = CANVAS.homeMode;
    var curLabel = (CV_VIEWS.find(function(v) { return v.id === cur; }) || CV_VIEWS[0]).label;
    var items = CV_VIEWS.map(function(v) {
      return '<div class="cv-view-item' + (v.id === cur ? ' active' : '') + '">' +
        '<button class="cv-view-pick" data-cvview="' + v.id + '">' + (CV_VIEW_ICON[v.id] || '') + '<span>' + v.label + '</span></button>' +
      '</div>';
    }).join('');
    return '<div class="cv-home-head"><h3 class="cv-h">Hojas de trabajo</h3>' +
      '<div class="cv-view-wrap" id="cvViewWrap">' +
        '<button class="cv-mini-btn" data-cvviewtoggle>' + (CV_VIEW_ICON[cur] || '') + ' Vista: ' + esc(curLabel) + ' ▾</button>' +
        '<div class="cv-view-menu"><div class="cv-view-menu-h">Vista de la galería</div>' + items + '</div>' +
      '</div></div>';
  }
  function cvRenderHome() {
    var home = document.getElementById("canvasHome");
    var addCard = '<button class="cv-tpl-card cv-new-card" data-newsheet title="Crear una hoja en blanco"><div class="cv-new-plus">＋</div><div class="cv-tpl-name">Nueva hoja personalizada</div><div class="cv-tpl-sub">En blanco, tú la armas</div></button>';
    if (CANVAS.homeMode === "board") {
      var tiles = CANVAS.docs.map(function(d) {
        var filled = d.frames.filter(function(f) { return f.img; }).length;
        return '<div class="cv-board-card">' +
          '<div class="cv-thumb-wrap" data-open="' + d.id + '" tabindex="0" role="button" title="Abrir hoja para editar">' + cvSheetThumb(d, 300) + '</div>' +
          '<button class="cv-board-name" data-open="' + d.id + '">' + esc(d.name || d.title || "Hoja") + '</button>' +
          '<div class="cv-board-sub">' + d.frames.length + ' marco' + (d.frames.length === 1 ? "" : "s") + (filled ? (" · " + filled + " con foto") : "") + '</div>' +
        '</div>';
      }).join('');
      home.innerHTML = cvHomeHeader() + '<div class="cv-board">' + tiles + addCard + '</div>';
      return;
    }
    var cards = CANVAS.docs.map(function(d) {
      var filled = d.frames.filter(function(f) { return f.img; }).length;
      return '<div class="cv-sheet-card">' +
        '<button class="cv-sheet-open" data-open="' + d.id + '" title="Abrir hoja">' + cvMiniPreview(d) +
          '<div class="cv-tpl-name">' + esc(d.name || d.title || "Hoja") + '</div>' +
          '<div class="cv-tpl-sub">' + d.frames.length + ' marco' + (d.frames.length === 1 ? "" : "s") + (filled ? (" · " + filled + " con foto") : "") + '</div>' +
        '</button>' +
        '<div class="cv-sheet-acts">' +
          '<button class="cv-mini-btn" data-dup="' + d.id + '" title="Duplicar">⧉</button>' +
          '<button class="cv-mini-btn" data-ren="' + d.id + '" title="Renombrar">✎</button>' +
          '<button class="cv-mini-btn cv-danger" data-del="' + d.id + '" title="Eliminar">🗑️</button>' +
        '</div></div>';
    }).join('');
    home.innerHTML = cvHomeHeader() + '<div class="cv-tpl-grid">' + cards + addCard + '</div>';
  }

  function cvRenderEditor() {
    var doc = cvActiveDoc(); if (!doc) return;
    cvEnsureSizes(doc, function() { cvRenderEditorNow(doc); });
  }
  function cvRenderEditorNow(doc) {
    var ed = document.getElementById("canvasEditor"); if (!ed || cvActiveDoc() !== doc) return;
    var tsize = cvTitleSize(doc.title);
    var DW = cvDocW(doc), DH = cvDocH(doc);
    var framesHtml = doc.frames.map(function(f) {
      var sel = (CANVAS.selFrame === f.id) ? " cv-sel" : "";
      var inner;
      if (f.img) {
        var g = cvFrameImgGeom(f);
        var flt = cvImgFilter(f.img);
        inner = '<img src="' + f.img.src + '" class="cv-frame-img" draggable="false" style="left:' + g.left + 'px;top:' + g.top + 'px;width:' + g.dw + 'px;height:' + g.dh + 'px;' + (flt ? ('filter:' + flt + ';') : '') + '">' +
          '<div class="cv-frame-tools">' +
            '<button class="cv-frame-btn" data-zout="' + f.id + '" title="Alejar">−</button>' +
            '<button class="cv-frame-btn" data-zin="' + f.id + '" title="Acercar">+</button>' +
            '<button class="cv-frame-btn" data-zreset="' + f.id + '" title="Reencuadrar">⟲</button>' +
            (CANVAS.expert ? '<button class="cv-frame-btn" data-frot="' + f.id + '" title="Rotar 90°">↻</button>' +
              '<button class="cv-frame-btn" data-fflip="' + f.id + '" title="Voltear horizontal">⇋</button>' +
              '<button class="cv-frame-btn" data-fadj="' + f.id + '" title="Brillo / contraste">☀</button>' : '') +
            '<button class="cv-frame-btn" data-replace="' + f.id + '" title="Reemplazar">⤢</button>' +
            '<button class="cv-frame-btn" data-clear="' + f.id + '" title="Quitar imagen">✕</button>' +
          '</div>';
      } else {
        inner = '<div class="cv-frame-empty"><span>⬆</span><small>Clic para subir · arrastra · Ctrl+V</small></div>';
      }
      var frameCtl = '<div class="cv-fmove" data-fmove="' + f.id + '" title="Mover marco">✥</div><button class="cv-fdel" data-fdel="' + f.id + '" title="Eliminar marco">🗑️</button><div class="cv-fresize" data-fresize="' + f.id + '" title="Redimensionar"></div>';
      return '<div class="cv-frame' + sel + (f.img ? ' has-img' : '') + '" data-frame="' + f.id + '" style="left:' + f.x + 'px;top:' + f.y + 'px;width:' + f.w + 'px;height:' + f.h + 'px">' + inner + frameCtl + '</div>';
    }).join('');
    ed.innerHTML =
      '<div class="cv-ed-bar">' +
         '<button class="cv-mini-btn" id="cvBackBtn">‹ Hojas</button>' +
         '<button class="cv-mini-btn" id="cvPrevBtn" title="Hoja anterior (←)">‹</button>' +
         '<span class="cv-ed-pos">' + (cvDocIndex(doc) + 1) + ' / ' + CANVAS.docs.length + '</span>' +
         '<button class="cv-mini-btn" id="cvNextBtn" title="Hoja siguiente (→)">›</button>' +
         '<span class="cv-ed-name" id="cvDocName" contenteditable spellcheck="false" title="Clic para renombrar">' + esc(doc.name) + '</span>' +
         '<span class="cv-tool-sep"></span>' +
         (CANVAS.expert ? '<button class="cv-mini-btn" id="cvPdfBtn" title="Exportar esta hoja a PDF">📄 PDF</button>' +
           '<button class="cv-mini-btn" id="cvPdfAllBtn" title="Exportar TODAS las hojas del área a un solo PDF">📚 Todas</button>' : '') +
         '<button class="cv-primary-btn" id="cvExportBtn" title="Exportar como PNG">PNG</button>' +
         (CANVAS.expert ? '<button class="cv-mini-btn" id="cvCopyBtn" title="Copiar como imagen">📋 Copiar</button>' : '') +
         '<span class="cv-tool-sep"></span>' +
         (CANVAS.expert ? '<button class="cv-mini-btn" data-ellock title="Bloquear/desbloquear la selección">🔒 Bloquear</button>' : '') +
         '<button class="cv-mini-btn" data-eldel title="Eliminar la anotación seleccionada (Supr)">🗑️ Borrar</button>' +
         (CANVAS.expert ? '<span class="cv-tool-sep"></span><span class="cv-size" title="Tamaño de la hoja (px)">' +
           '<input class="cv-size-in" id="cvSizeW" type="number" min="400" max="4000" step="10" value="' + DW + '" title="Ancho">' +
           '<span class="cv-size-x">×</span>' +
           '<input class="cv-size-in" id="cvSizeH" type="number" min="400" max="4000" step="10" value="' + DH + '" title="Alto">' +
           '<button class="cv-mini-btn" data-cvsize="apply" title="Aplicar tamaño">Aplicar</button>' +
           '<select class="cv-size-preset" id="cvSizePreset" title="Tamaños predefinidos"><option value="">Tamaño…</option>' +
             CV_SIZE_PRESETS.map(function(p, i) { return '<option value="' + i + '"' + (p.w === DW && p.h === DH ? " selected" : "") + '>' + esc(p.label) + '</option>'; }).join('') +
           '</select></span>' : '') +
         '<button class="cv-mini-btn" id="cvClearPhotos" title="Quitar todas las fotos para reutilizar la hoja">🧹 Limpiar</button>' +
         '<button class="cv-tool cv-expert-toggle' + (CANVAS.expert ? ' active' : '') + '" data-cvexpert title="Modo básico / experto" style="margin-left:auto;">' + (CANVAS.expert ? "⚙️ Experto" : "⚙️ Básico") + '</button>' +
       '</div>' +
       '<div class="cv-tools-row"><div class="cv-tools" id="cvTools"></div></div>' +
       '<div class="cv-ed-body">' +
         cvRailHtml() +
         '<div class="cv-stage-wrap"><div class="cv-stage" id="cvStage">' +
           '<div class="cv-canvas" id="cvCanvas" style="width:' + DW + 'px;height:' + DH + 'px">' +
             '<div class="cv-title" id="cvTitle" contenteditable spellcheck="false" style="color:' + doc.titleColor + ';font-size:' + tsize + 'px">' + esc(doc.title) + '</div>' +
             framesHtml +
             '<div id="cvAnnoLayer" class="cv-anno-layer"></div>' +
           '</div>' +
         '</div></div>' +
       '</div>';
    cvRenderTools(); cvRenderAnno(); cvBindRail(); cvLayoutStage();
  }
  function cvLayoutStage() {
    var wrap = document.querySelector(".cv-stage-wrap");
    var stage = document.getElementById("cvStage");
    var canvas = document.getElementById("cvCanvas");
    if (!wrap || !stage || !canvas) return;
    var doc = cvActiveDoc(); if (!doc) return;
    var W = cvDocW(doc), H = cvDocH(doc);
    var availW = wrap.clientWidth - 24;
    var availH = window.innerHeight - wrap.getBoundingClientRect().top - 24;
    wrap.style.minHeight = Math.max(0, availH) + "px";
    var s = Math.min(availW / W, availH / H) * 0.98;
    var longest = Math.max(W, H);
    if (longest * s > 1400) s = 1400 / longest;
    if (longest * s < 280) s = 280 / longest;
    CANVAS.scale = s;
    canvas.style.transform = "scale(" + s + ")";
    stage.style.width = (W * s) + "px";
    stage.style.height = (H * s) + "px";
  }

  /* ---------- Panel de hojas (rail) ---------- */
  var CV_RAIL_W = 150;
  function cvThumbAnnoSvg(doc, bw, bh) {
    var els = doc.elements || []; if (!els.length) return "";
    var W = cvDocW(doc), H = cvDocH(doc);
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + bw + '" height="' + bh + '" style="position:absolute;top:0;left:0;pointer-events:none;overflow:visible">';
    var texts = "";
    els.forEach(function(el) {
      if (el.type === "ellipse") svg += '<ellipse cx="' + (el.x + el.w / 2) + '" cy="' + (el.y + el.h / 2) + '" rx="' + Math.abs(el.w / 2) + '" ry="' + Math.abs(el.h / 2) + '" fill="none" stroke="' + el.color + '" stroke-width="' + el.stroke + '"/>';
      else if (el.type === "rect") svg += '<rect x="' + el.x + '" y="' + el.y + '" width="' + Math.abs(el.w) + '" height="' + Math.abs(el.h) + '" fill="none" stroke="' + el.color + '" stroke-width="' + el.stroke + '"/>';
      else if (el.type === "arrow") svg += cvArrowSvg(el);
      else if (el.type === "line") svg += '<line x1="' + el.x1 + '" y1="' + el.y1 + '" x2="' + el.x2 + '" y2="' + el.y2 + '" stroke="' + el.color + '" stroke-width="' + el.stroke + '" stroke-linecap="round"/>';
      else if (el.type === "pen") svg += '<polyline points="' + el.points.map(function(p) { return p.x + "," + p.y; }).join(" ") + '" fill="none" stroke="' + el.color + '" stroke-width="' + el.stroke + '" stroke-linecap="round" stroke-linejoin="round"/>';
      else if (el.type === "hl") svg += '<polyline points="' + el.points.map(function(p) { return p.x + "," + p.y; }).join(" ") + '" fill="none" stroke="' + el.color + '" stroke-width="' + el.stroke + '" stroke-linecap="round" stroke-linejoin="round" opacity="0.35"/>';
      else if (el.type === "num") { svg += '<circle cx="' + el.x + '" cy="' + el.y + '" r="' + el.r + '" fill="' + el.color + '"/><text x="' + el.x + '" y="' + el.y + '" text-anchor="middle" dominant-baseline="central" fill="#fff" font-weight="800" font-family="Inter,Arial,sans-serif" font-size="' + Math.round(el.r * 1.15) + '">' + esc(String(el.n)) + '</text>'; }
      else if (el.type === "text") {
        var lines = String(el.text || "").split("\n");
        var tsp = lines.map(function(ln, i) { return '<tspan x="' + el.x + '" dy="' + (i === 0 ? 0 : el.size) + '">' + esc(ln) + '</tspan>'; }).join('');
        texts += '<text x="' + el.x + '" y="' + (el.y + el.size * 0.85) + '" fill="' + el.color + '" font-family="Inter,Arial,sans-serif" font-weight="700" font-size="' + el.size + '">' + tsp + '</text>';
      }
    });
    return svg + texts + '</svg>';
  }
  function cvRailThumb(doc, maxSide) {
    var W = cvDocW(doc), H = cvDocH(doc), s = maxSide / Math.max(W, H);
    var bw = Math.round(W * s), bh = Math.round(H * s);
    var tsize = Math.max(6, Math.round(cvTitleSize(doc.title) * s));
    var frames = (doc.frames || []).map(function(f) {
      var st = 'left:' + (f.x * s) + 'px;top:' + (f.y * s) + 'px;width:' + (f.w * s) + 'px;height:' + (f.h * s) + 'px';
      var bg = (f.img && f.img.src) ? (";background-image:url('" + f.img.src + "')") : "";
      return '<div class="cv-thumb-frame' + (f.img && f.img.src ? ' has-img' : '') + '" style="' + st + bg + '"></div>';
    }).join('');
    var title = '<div class="cv-thumb-title" style="color:' + (doc.titleColor || '#d10a11') + ';font-size:' + tsize + 'px;top:' + Math.round(56 * s) + 'px">' + esc(doc.title || "") + '</div>';
    return '<div class="cv-thumb" style="width:' + bw + 'px;height:' + bh + 'px;position:relative;overflow:hidden;background:#fff">' + title + frames + cvThumbAnnoSvg(doc, bw, bh) + '</div>';
  }
  function cvRailHtml() {
    if (CANVAS.railCollapsed) return '<button class="cv-rail-expander" data-cvrailtoggle title="Mostrar panel de hojas">🗂 Hojas ▸</button>';
    var items = CANVAS.docs.map(function(d, i) {
      var active = String(d.id) === String(CANVAS.activeId);
      return '<div class="cv-rail-item' + (active ? ' active' : '') + '" data-railid="' + d.id + '" draggable="true" title="Arrastra para reordenar">' +
        '<div class="cv-rail-acts">' +
          '<button data-dup="' + d.id + '" title="Duplicar hoja">⧉</button>' +
          '<button data-ren="' + d.id + '" title="Renombrar hoja">✎</button>' +
          '<button class="cv-danger" data-cvraildel="' + d.id + '" title="Eliminar hoja">🗑️</button>' +
        '</div>' +
        '<div class="cv-rail-thumbwrap" data-open="' + d.id + '" tabindex="0" role="button" aria-label="Abrir hoja ' + (i + 1) + '"><span class="cv-rail-num">' + (i + 1) + '</span>' + cvRailThumb(d, CV_RAIL_W) + '</div>' +
        '<div class="cv-rail-name" data-open="' + d.id + '">' + esc(d.name || d.title || "Hoja") + '</div>' +
      '</div>';
    }).join('');
    return '<div class="cv-rail" id="cvRail"><div class="cv-rail-head">Hojas (' + CANVAS.docs.length + ')<button class="cv-rail-collapse" data-cvrailtoggle title="Ocultar panel">◀</button></div>' +
      items + '<button class="cv-rail-add" data-newsheet title="Crear una hoja nueva">＋ Nueva hoja</button></div>';
  }
  function cvRailRefreshActive() {
    if (CANVAS.view !== "editor" || CANVAS.railCollapsed) return;
    var doc = cvActiveDoc(); if (!doc) return;
    var item = document.querySelector('#cvRail .cv-rail-item[data-railid="' + doc.id + '"]');
    if (!item) return;
    var tw = item.querySelector('.cv-rail-thumbwrap');
    if (tw) tw.innerHTML = '<span class="cv-rail-num">' + (cvDocIndex(doc) + 1) + '</span>' + cvRailThumb(doc, CV_RAIL_W);
    var nm = item.querySelector('.cv-rail-name'); if (nm) nm.textContent = doc.name || doc.title || "Hoja";
  }
  function cvBindRail() {
    var rail = document.getElementById("cvRail"); if (!rail) return;
    var active = rail.querySelector('.cv-rail-item.active'); if (active) active.scrollIntoView({ block: "nearest" });
    var dragId = null;
    rail.querySelectorAll('.cv-rail-item').forEach(function(item) {
      item.addEventListener("dragstart", function(e) { dragId = item.dataset.railid; item.classList.add("cv-rail-dragging"); if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"; });
      item.addEventListener("dragend", function() { item.classList.remove("cv-rail-dragging"); rail.querySelectorAll('.cv-rail-drop').forEach(function(x) { x.classList.remove("cv-rail-drop"); }); dragId = null; });
      item.addEventListener("dragover", function(e) { e.preventDefault(); if (item.dataset.railid !== dragId) item.classList.add("cv-rail-drop"); });
      item.addEventListener("dragleave", function() { item.classList.remove("cv-rail-drop"); });
      item.addEventListener("drop", function(e) { e.preventDefault(); item.classList.remove("cv-rail-drop"); if (dragId != null && item.dataset.railid !== dragId) cvReorderDocs(dragId, item.dataset.railid); });
    });
  }
  function cvReorderDocs(fromId, toId) {
    var docs = CANVAS.docs;
    var fi = docs.findIndex(function(d) { return String(d.id) === String(fromId); });
    var ti = docs.findIndex(function(d) { return String(d.id) === String(toId); });
    if (fi < 0 || ti < 0 || fi === ti) return;
    var moved = docs.splice(fi, 1)[0];
    docs.splice(fi < ti ? ti - 1 : ti, 0, moved);
    cvRenderEditor();
    postJSON('/design/api/canvas/docs/' + fromId + '/mover', { targetId: parseInt(toId) });
  }
  function cvRailDelete(id) {
    var idx = CANVAS.docs.findIndex(function(d) { return String(d.id) === String(id); }); if (idx < 0) return;
    var wasActive = String(CANVAS.activeId) === String(id);
    if (!cvDeleteDoc(parseInt(id))) return;
    if (wasActive && CANVAS.docs.length) { var ni = Math.min(idx, CANVAS.docs.length - 1); cvOpenDoc(CANVAS.docs[ni].id); }
  }
  function cvToggleRail() {
    CANVAS.railCollapsed = !CANVAS.railCollapsed;
    try { localStorage.setItem("canvas_rail_collapsed", CANVAS.railCollapsed ? "1" : "0"); } catch (e) {}
    cvRenderEditor();
  }

  /* ---------- Imágenes en marcos ---------- */
  function cvSetFrameImageOn(docId, frameId, dataUrl, board) {
    var doc = CANVAS.docs.find(function(d) { return d.id === docId; }); if (!doc) return;
    var f = doc.frames.find(function(x) { return x.id === frameId; }); if (!f) return;
    if (!board) cvRecord();
    var apply = function(nw, nh) {
      f.img = { src: dataUrl, nw: nw, nh: nh, scale: 1, ox: 0, oy: 0 };
      doc.updated = Date_nowSafe(); cvSave(docId);
      if (board) cvRender(); else cvRenderEditor();
    };
    var im = new Image();
    im.onload = function() { apply(im.naturalWidth || im.width || 100, im.naturalHeight || im.height || 100); };
    im.onerror = function() { apply(100, 100); };
    im.src = dataUrl;
  }
  function cvSetFrameImage(frameId, dataUrl) { cvSetFrameImageOn(CANVAS.activeId, frameId, dataUrl, false); }
  function cvImgFilter(img) {
    if (!img) return "";
    var b = img.bri == null ? 1 : img.bri, c = img.con == null ? 1 : img.con;
    if (b === 1 && c === 1) return "";
    return "brightness(" + b + ") contrast(" + c + ")";
  }
  function cvBakeTransform(frameId, kind) {
    var doc = cvActiveDoc(); if (!doc) return;
    var f = doc.frames.find(function(x) { return x.id === frameId; }); if (!f || !f.img) return;
    var src = f.img.src, bri = f.img.bri, con = f.img.con;
    cvLoadImage(src).then(function(im) {
      var w = im.naturalWidth || im.width, h = im.naturalHeight || im.height;
      var c = document.createElement("canvas"), ctx = c.getContext("2d");
      if (kind === "rot") { c.width = h; c.height = w; ctx.translate(h / 2, w / 2); ctx.rotate(Math.PI / 2); ctx.drawImage(im, -w / 2, -h / 2); }
      else { c.width = w; c.height = h; ctx.translate(w, 0); ctx.scale(-1, 1); ctx.drawImage(im, 0, 0); }
      var type = /^data:image\/png/.test(src) ? "image/png" : "image/jpeg";
      var url = c.toDataURL(type, 0.92);
      cvRecord();
      f.img = { src: url, nw: c.width, nh: c.height, scale: 1, ox: 0, oy: 0, bri: bri, con: con };
      doc.updated = Date_nowSafe(); cvSave(); cvRenderEditor();
    }).catch(function() {});
  }
  function cvCloseAdjust() { var p = document.getElementById("cvAdjustPop"); if (p) p.remove(); }
  window.cvCloseAdjust = cvCloseAdjust;
  function cvOpenAdjust(frameId, anchorBtn) {
    cvCloseAdjust();
    var doc = cvActiveDoc(); var f = doc && doc.frames.find(function(x) { return x.id === frameId; }); if (!f || !f.img) return;
    cvRecord();
    var b = f.img.bri == null ? 1 : f.img.bri, c = f.img.con == null ? 1 : f.img.con;
    var pop = document.createElement("div"); pop.id = "cvAdjustPop"; pop.className = "cv-adjust-pop";
    pop.innerHTML = '<div class="cv-adjust-row"><label>☀ Brillo</label><input type="range" id="cvAdjBri" min="0.4" max="1.6" step="0.02" value="' + b + '"></div>' +
      '<div class="cv-adjust-row"><label>◐ Contraste</label><input type="range" id="cvAdjCon" min="0.4" max="1.6" step="0.02" value="' + c + '"></div>' +
      '<div class="cv-adjust-actions"><button class="cv-mini-btn" id="cvAdjReset">Restablecer</button><button class="cv-mini-btn" id="cvAdjClose">Cerrar</button></div>';
    document.body.appendChild(pop);
    var r = anchorBtn.getBoundingClientRect();
    pop.style.left = Math.min(r.left, window.innerWidth - 240) + "px"; pop.style.top = (r.bottom + 6) + "px";
    var bri = pop.querySelector("#cvAdjBri"), con = pop.querySelector("#cvAdjCon");
    var applyLive = function() {
      f.img.bri = +bri.value; f.img.con = +con.value;
      var imgEl = document.querySelector('.cv-frame[data-frame="' + frameId + '"] .cv-frame-img');
      if (imgEl) { imgEl.style.filter = cvImgFilter(f.img) || "none"; }
      cvSave();
    };
    bri.addEventListener("input", applyLive); con.addEventListener("input", applyLive);
    pop.querySelector("#cvAdjReset").addEventListener("click", function() { bri.value = 1; con.value = 1; applyLive(); });
    pop.querySelector("#cvAdjClose").addEventListener("click", cvCloseAdjust);
  }
  function cvClearFrameOn(docId, frameId, board) {
    var doc = CANVAS.docs.find(function(d) { return d.id === docId; }); if (!doc) return;
    var f = doc.frames.find(function(x) { return x.id === frameId; }); if (!f) return;
    if (!board) cvRecord();
    var antes = f.img;
    f.img = null; doc.updated = Date_nowSafe(); cvSave(docId);
    if (board) cvRender(); else cvRenderEditor();
    if (board && antes) {
      var v = cvAviso('<span>🗑️ Foto quitada</span><button type="button" class="cv-aviso-btn">Deshacer</button>', true);
      v.querySelector('.cv-aviso-btn').onclick = function() {
        var d2 = CANVAS.docs.find(function(d) { return d.id === docId; }), f2 = d2 && d2.frames.find(function(x) { return x.id === frameId; });
        if (f2 && !f2.img) { f2.img = antes; cvSave(docId); cvRender(); }
        v.classList.remove('open');
      };
    }
  }
  function cvClearFrame(frameId) { cvClearFrameOn(CANVAS.activeId, frameId, false); }
  function cvReadFileToTarget(file, tg) {
    if (!file || !/^image\//.test(file.type) || !tg) return;
    var rd = new FileReader();
    rd.onload = function() { cvSetFrameImageOn(tg.docId, tg.frameId, rd.result, !!tg.board); };
    rd.readAsDataURL(file);
  }
  function cvReadFileToFrame(file, frameId) { cvReadFileToTarget(file, { docId: CANVAS.activeId, frameId: frameId, board: false }); }
  var _cvFileInput = null, _cvFileTarget = null;
  function cvEnsureFileInput() {
    if (!_cvFileInput) {
      _cvFileInput = document.createElement("input");
      _cvFileInput.type = "file"; _cvFileInput.accept = "image/*"; _cvFileInput.style.display = "none";
      document.body.appendChild(_cvFileInput);
      _cvFileInput.addEventListener("change", function() { if (_cvFileInput.files[0] && _cvFileTarget) cvReadFileToTarget(_cvFileInput.files[0], _cvFileTarget); _cvFileInput.value = ""; });
    }
  }
  function cvPickImage(frameId) { cvEnsureFileInput(); _cvFileTarget = { docId: CANVAS.activeId, frameId: frameId, board: false }; _cvFileInput.click(); }
  function cvPickImageBoard(docId, frameId) { cvEnsureFileInput(); _cvFileTarget = { docId: docId, frameId: frameId, board: true }; _cvFileInput.click(); }
  function cvBoardHoverTrack(e) {
    if (CANVAS.view !== "home" || CANVAS.homeMode !== "board") { CANVAS.boardHover = null; return; }
    var bf = e.target.closest("[data-bframe]");
    CANVAS.boardHover = bf ? { docId: parseInt(bf.dataset.bdoc), frameId: bf.dataset.bframe } : null;
  }
  function cvBoardFrameClick(docId, frameId) {
    docId = parseInt(docId);
    var doc = CANVAS.docs.find(function(d) { return d.id === docId; }); if (!doc) return;
    var f = doc.frames.find(function(x) { return x.id === frameId; }); if (!f) return;
    CANVAS.boardTarget = { docId: docId, frameId: frameId };
    document.querySelectorAll(".cv-thumb-frame.cv-btarget").forEach(function(el) { el.classList.remove("cv-btarget"); });
    var el = document.querySelector('.cv-thumb-frame[data-bframe="' + frameId + '"][data-bdoc="' + docId + '"]'); if (el) el.classList.add("cv-btarget");
    if (!f.img) cvPickImageBoard(docId, frameId);
  }

  /* ---------- Export PNG/PDF ---------- */
  function cvDrawCover(ctx, img, x, y, w, h) {
    var ir = img.width / img.height, rr = w / h, sw, sh, sx, sy;
    if (ir > rr) { sh = img.height; sw = sh * rr; sx = (img.width - sw) / 2; sy = 0; }
    else { sw = img.width; sh = sw / rr; sx = 0; sy = (img.height - sh) / 2; }
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
    ctx.restore();
  }
  function cvLoadImage(src) { return new Promise(function(res, rej) { var im = new Image(); im.onload = function() { res(im); }; im.onerror = rej; im.src = src; }); }
  function cvSheetFileName(doc) { return ((doc.name || "hoja") + " - " + (doc.title || "")).replace(/[\\/:*?"<>|]+/g, "_").trim(); }
  async function cvSheetToCanvas(doc) {
    var EW = cvDocW(doc), EH = cvDocH(doc);
    var cv = document.createElement("canvas"); cv.width = EW; cv.height = EH;
    var ctx = cv.getContext("2d");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, EW, EH);
    for (var i = 0; i < doc.frames.length; i++) {
      var f = doc.frames[i];
      if (f.img && f.img.src) {
        try {
          var im = await cvLoadImage(f.img.src);
          var nw = f.img.nw || im.width, nh = f.img.nh || im.height;
          var g = cvGeom(f.w, f.h, nw, nh, f.img.scale, f.img.ox, f.img.oy);
          ctx.save(); ctx.beginPath(); ctx.rect(f.x, f.y, f.w, f.h); ctx.clip();
          var flt = cvImgFilter(f.img); if (flt) ctx.filter = flt;
          ctx.drawImage(im, f.x + g.left, f.y + g.top, g.dw, g.dh);
          ctx.filter = "none"; ctx.restore();
        } catch (e) { ctx.fillStyle = "#eef2f6"; ctx.fillRect(f.x, f.y, f.w, f.h); }
      } else {
        ctx.fillStyle = "#f2f5f8"; ctx.fillRect(f.x, f.y, f.w, f.h);
        ctx.strokeStyle = "#c8d2dc"; ctx.lineWidth = 2; ctx.strokeRect(f.x + 1, f.y + 1, f.w - 2, f.h - 2);
      }
    }
    (doc.elements || []).forEach(function(el) { cvDrawEl(ctx, el); });
    ctx.fillStyle = doc.titleColor || "#d10a11";
    ctx.font = "800 " + cvTitleSize(doc.title) + "px Inter, Arial, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(doc.title || "", EW / 2, 118);
    return cv;
  }
  async function cvExportPNG(id) {
    var doc = CANVAS.docs.find(function(d) { return d.id === id; }) || cvActiveDoc(); if (!doc) return;
    var cv = await cvSheetToCanvas(doc);
    var a = document.createElement("a");
    a.href = cv.toDataURL("image/png"); a.download = cvSheetFileName(doc) + ".png";
    document.body.appendChild(a); a.click(); a.remove();
  }
  async function cvCopySheet(btn) {
    var doc = cvActiveDoc(); if (!doc) return;
    try {
      var cv = await cvSheetToCanvas(doc);
      var blob = await new Promise(function(res) { cv.toBlob(res, "image/png"); });
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      if (btn) { var o = btn.textContent; btn.textContent = "✓ Copiado"; setTimeout(function() { btn.textContent = o; }, 1400); }
    } catch (e) { alert("No se pudo copiar al portapapeles. Puede requerir HTTPS o permiso del navegador."); }
  }
  function cvImagesToPdfBlob(pages) {
    var enc = new TextEncoder(), chunks = [], pos = 0, objOff = {};
    var push = function(d) { var b = (typeof d === "string") ? enc.encode(d) : d; chunks.push(b); pos += b.length; };
    push("%PDF-1.3\n");
    var N = pages.length, pageN = [], contN = [], imgN = [], o = 3;
    for (var i = 0; i < N; i++) { pageN.push(o++); contN.push(o++); imgN.push(o++); }
    var maxObj = o - 1;
    objOff[1] = pos; push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
    objOff[2] = pos; push("2 0 obj\n<< /Type /Pages /Kids [" + pageN.map(function(n) { return n + " 0 R"; }).join(" ") + "] /Count " + N + " >>\nendobj\n");
    for (i = 0; i < N; i++) {
      var p = pages[i];
      objOff[pageN[i]] = pos; push(pageN[i] + " 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + p.iw + " " + p.ih + "] /Resources << /XObject << /Im0 " + imgN[i] + " 0 R >> >> /Contents " + contN[i] + " 0 R >>\nendobj\n");
      var content = "q\n" + p.iw + " 0 0 " + p.ih + " 0 0 cm\n/Im0 Do\nQ\n";
      objOff[contN[i]] = pos; push(contN[i] + " 0 obj\n<< /Length " + enc.encode(content).length + " >>\nstream\n" + content + "endstream\nendobj\n");
      objOff[imgN[i]] = pos; push(imgN[i] + " 0 obj\n<< /Type /XObject /Subtype /Image /Width " + p.iw + " /Height " + p.ih + " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + p.jpeg.length + " >>\nstream\n");
      push(p.jpeg); push("\nendstream\nendobj\n");
    }
    var xrefStart = pos;
    var xref = "xref\n0 " + (maxObj + 1) + "\n0000000000 65535 f \n";
    for (var n = 1; n <= maxObj; n++) { xref += String(objOff[n] || 0).padStart(10, "0") + " 00000 n \n"; }
    push(xref); push("trailer\n<< /Size " + (maxObj + 1) + " /Root 1 0 R >>\nstartxref\n" + xrefStart + "\n%%EOF");
    var total = chunks.reduce(function(s, c) { return s + c.length; }, 0), out = new Uint8Array(total), k = 0;
    chunks.forEach(function(c) { out.set(c, k); k += c.length; });
    return new Blob([out], { type: "application/pdf" });
  }
  async function cvExportPDF(docs, filename) {
    var pages = [];
    for (var i = 0; i < docs.length; i++) {
      var cv = await cvSheetToCanvas(docs[i]);
      var blob = await new Promise(function(res) { cv.toBlob(res, "image/jpeg", 0.9); });
      var buf = new Uint8Array(await blob.arrayBuffer());
      pages.push({ jpeg: buf, iw: cv.width, ih: cv.height });
    }
    var pdf = cvImagesToPdfBlob(pages);
    var a = document.createElement("a"), url = URL.createObjectURL(pdf);
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function() { URL.revokeObjectURL(url); }, 5000);
  }

  /* ---------- Anotaciones: modelo/geometría ---------- */
  function cvUid(prefijo) { return prefijo + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function cvElId() { return cvUid("el"); }
  function cvSelElement() { var d = cvActiveDoc(); return d ? (d.elements || []).find(function(e) { return e.id === CANVAS.selEl; }) : null; }
  function cvElBBox(el) {
    if (el.type === "ellipse" || el.type === "rect") return { x: el.x, y: el.y, w: Math.abs(el.w), h: Math.abs(el.h) };
    if (el.type === "num") return { x: el.x - el.r, y: el.y - el.r, w: el.r * 2, h: el.r * 2 };
    if (el.type === "arrow" || el.type === "line") { var x = Math.min(el.x1, el.x2), y = Math.min(el.y1, el.y2); return { x: x, y: y, w: Math.abs(el.x2 - el.x1), h: Math.abs(el.y2 - el.y1) }; }
    if (el.type === "pen" || el.type === "hl") {
      var xs = el.points.map(function(p) { return p.x; }), ys = el.points.map(function(p) { return p.y; });
      var x2 = Math.min.apply(null, xs), y2 = Math.min.apply(null, ys);
      return { x: x2, y: y2, w: Math.max.apply(null, xs) - x2, h: Math.max.apply(null, ys) - y2 };
    }
    if (el.type === "text") {
      var ctx = cvMeasureCtx(); ctx.font = "700 " + (el.size || 44) + "px Inter, Arial, sans-serif";
      var lines = String(el.text || "").split("\n"), w = 0;
      lines.forEach(function(l) { w = Math.max(w, ctx.measureText(l).width); });
      return { x: el.x, y: el.y, w: w, h: lines.length * (el.size || 44) * 1.1 };
    }
    return { x: el.x || 0, y: el.y || 0, w: 0, h: 0 };
  }
  function cvElCenter(el) { var b = cvElBBox(el); return { x: b.x + b.w / 2, y: b.y + b.h / 2 }; }
  function cvApplyElMove(el, s, dx, dy) {
    if (el.type === "ellipse" || el.type === "rect" || el.type === "text" || el.type === "num") { el.x = s.x + dx; el.y = s.y + dy; }
    else if (el.type === "arrow" || el.type === "line") { el.x1 = s.x1 + dx; el.y1 = s.y1 + dy; el.x2 = s.x2 + dx; el.y2 = s.y2 + dy; }
    else if (el.type === "pen" || el.type === "hl") { el.points = s.points.map(function(pt) { return { x: pt.x + dx, y: pt.y + dy }; }); }
  }
  function cvComputeSnap(el) {
    var doc = cvActiveDoc(), W = cvDocW(doc), H = cvDocH(doc), TH = 9 / (CANVAS.scale || 1);
    var c = cvElCenter(el);
    var xt = [W / 2], yt = [H / 2];
    (doc.elements || []).forEach(function(o) { if (o.id === el.id) return; var oc = cvElCenter(o); xt.push(oc.x); yt.push(oc.y); });
    var bestX = 1e9, bestY = 1e9;
    xt.forEach(function(t) { var d = t - c.x; if (Math.abs(d) < TH && Math.abs(d) < Math.abs(bestX)) bestX = d; });
    yt.forEach(function(t) { var d = t - c.y; if (Math.abs(d) < TH && Math.abs(d) < Math.abs(bestY)) bestY = d; });
    var lines = [], sdx = 0, sdy = 0;
    if (bestX < 1e9) { sdx = bestX; lines.push({ type: "v", x: c.x + bestX }); }
    if (bestY < 1e9) { sdy = bestY; lines.push({ type: "h", y: c.y + bestY }); }
    return { dx: sdx, dy: sdy, lines: lines };
  }
  function cvDuplicateEl() {
    var doc = cvActiveDoc(), el = cvSelElement(); if (!doc || !el) return;
    cvRecord();
    var c = JSON.parse(JSON.stringify(el)); c.id = cvElId(); delete c.locked; var d = 26;
    if (c.type === "arrow" || c.type === "line") { c.x1 += d; c.y1 += d; c.x2 += d; c.y2 += d; }
    else if (c.type === "pen" || c.type === "hl") { c.points = c.points.map(function(p) { return { x: p.x + d, y: p.y + d }; }); }
    else { c.x = (c.x || 0) + d; c.y = (c.y || 0) + d; }
    doc.elements.push(c); CANVAS.selEl = c.id; CANVAS.editText = null; doc.updated = Date_nowSafe(); cvSave(); cvRenderTools(); cvRenderAnno();
  }
  function cvOrderEl(dir) {
    var doc = cvActiveDoc(), el = cvSelElement(); if (!doc || !el) return;
    cvRecord();
    doc.elements = doc.elements.filter(function(x) { return x.id !== el.id; });
    if (dir === "front") doc.elements.push(el); else doc.elements.unshift(el);
    doc.updated = Date_nowSafe(); cvSave(); cvRenderAnno();
  }
  function cvToggleLock() {
    var el = cvSelElement(); if (!el) return;
    cvRecord(); el.locked = !el.locked; var d = cvActiveDoc(); if (d) d.updated = Date_nowSafe(); cvSave(); cvRenderTools(); cvRenderAnno();
  }
  function cvNavDoc(dir) {
    var docs = CANVAS.docs; if (docs.length < 2) return;
    var i = docs.findIndex(function(d) { return d.id === CANVAS.activeId; }); if (i < 0) i = 0;
    i = (i + dir + docs.length) % docs.length;
    CANVAS.activeId = docs[i].id; CANVAS.selFrame = null; CANVAS.selEl = null; CANVAS.editText = null;
    cvRenderEditor();
  }
  function cvEventToCanvas(e) {
    var canvas = document.getElementById("cvCanvas"); var r = canvas.getBoundingClientRect(); var s = CANVAS.scale || 1;
    return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s };
  }
  function cvToolGroupHTML(gid, label, items, tool) {
    var open = CANVAS._toolGroup === gid;
    var act = items.find(function(it) { return it[0] === tool; });
    return '<span class="cv-toolgroup' + (open ? ' open' : '') + '">' +
      '<button class="cv-tool' + (act ? ' active' : '') + '" data-toolgroup="' + gid + '">' + (act ? act[1] : label) + ' <span class="cv-tg-caret">▾</span></button>' +
      '<div class="cv-tg-menu">' + items.map(function(it) { return '<button class="cv-tg-item' + (it[0] === tool ? ' active' : '') + '" data-tool="' + it[0] + '">' + it[1] + '</button>'; }).join('') + '</div>' +
    '</span>';
  }
  function cvRenderTools() {
    var el = document.getElementById("cvTools"); if (!el) return;
    var expert = !!CANVAS.expert, tool = CANVAS.tool, sel = cvSelElement();
    var btn = function(t, l) { return '<button class="cv-tool' + (tool === t ? ' active' : '') + '" data-tool="' + t + '">' + l + '</button>'; };
    var html = btn("select", "🖱️ Seleccionar");
    if (expert) {
      html += cvToolGroupHTML("formas", "🔷 Formas", [["ellipse", "◯ Círculo"], ["rect", "▭ Rectángulo"]], tool);
      html += cvToolGroupHTML("lineas", "／ Líneas", [["arrow", "↗ Flecha"], ["line", "／ Línea"]], tool);
      html += btn("text", "T Texto") + btn("pen", "✏️ Lápiz") + btn("hl", "🖍️ Resaltador") + btn("num", "① Marcador");
    } else {
      html += btn("ellipse", "◯ Círculo") + btn("arrow", "↗ Flecha") + btn("text", "T Texto") + btn("pen", "✏️ Lápiz");
    }
    var colorTools = ["ellipse", "rect", "arrow", "line", "pen", "hl", "num", "text"];
    var strokeTools = ["ellipse", "rect", "arrow", "line", "pen", "hl"];
    var showColor = colorTools.indexOf(tool) >= 0 || (sel && sel.color != null);
    var showStroke = expert && (strokeTools.indexOf(tool) >= 0 || (sel && sel.stroke != null));
    if (showColor) {
      var colors = ["#e11d1d", "#111827", "#1d6fe1", "#12a150", "#f59e0b", "#ffffff"];
      html += '<span class="cv-tool-sep"></span>' + colors.map(function(c) { return '<button class="cv-color' + (CANVAS.color === c ? ' active' : '') + '" data-color="' + c + '" style="background:' + c + '" title="Color"></button>'; }).join('');
      if (expert) { var cur = /^#[0-9a-fA-F]{6}$/.test(CANVAS.color) ? CANVAS.color : "#e11d1d"; html += '<input type="color" id="cvColorPick" class="cv-colorpick" value="' + cur + '" title="Color libre">'; }
    }
    if (showStroke) {
      var strokes = [["S", 4], ["M", 8], ["L", 14]];
      html += '<span class="cv-tool-sep"></span><span class="cv-stroke-lbl">Grosor</span>' +
        strokes.map(function(s) { return '<button class="cv-tool cv-stroke' + ((CANVAS.stroke || 7) === s[1] ? ' active' : '') + '" data-stroke="' + s[1] + '" title="Grosor ' + s[0] + '">' + s[0] + '</button>'; }).join('');
    }
    if (expert && (tool === "text" || (sel && sel.type === "text"))) {
      html += '<span class="cv-tool-sep"></span><button class="cv-tool" data-textbg title="Fondo del texto seleccionado">🏷️ Fondo texto</button>';
    }
    if (expert && sel) {
      html += '<span class="cv-tool-sep"></span>' +
        '<button class="cv-tool" data-eldup title="Duplicar (Ctrl+D)">⧉ Duplicar</button>' +
        '<button class="cv-tool" data-elfront title="Traer al frente">⤒ Frente</button>' +
        '<button class="cv-tool" data-elback title="Enviar atrás">⤓ Atrás</button>';
    }
    html += '<span class="cv-tool-sep"></span>' +
      '<button class="cv-tool cv-tool-icon" data-freeframe title="Agregar un marco libre"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><path d="M12 5v14M5 12h14"/></svg></button>';
    el.innerHTML = html;
  }
  function cvArrowSvg(el) {
    var ang = Math.atan2(el.y2 - el.y1, el.x2 - el.x1), hl = Math.max(18, (el.stroke || 9) * 3.0);
    var a1 = ang + Math.PI * 0.86, a2 = ang - Math.PI * 0.86;
    var hx1 = el.x2 + hl * Math.cos(a1), hy1 = el.y2 + hl * Math.sin(a1);
    var hx2 = el.x2 + hl * Math.cos(a2), hy2 = el.y2 + hl * Math.sin(a2);
    return '<line data-el="' + el.id + '" class="cv-shape" x1="' + el.x1 + '" y1="' + el.y1 + '" x2="' + el.x2 + '" y2="' + el.y2 + '" stroke="' + el.color + '" stroke-width="' + el.stroke + '" stroke-linecap="round"/>' +
      '<polygon data-el="' + el.id + '" class="cv-shape" points="' + el.x2 + ',' + el.y2 + ' ' + hx1 + ',' + hy1 + ' ' + hx2 + ',' + hy2 + '" fill="' + el.color + '"/>';
  }
  function cvHandlesHTML(el) {
    if (!el || el.locked) return "";
    if (el.type === "num") return '<div class="cv-handle" data-handle="nr" data-el="' + el.id + '" style="left:' + (el.x + el.r) + 'px;top:' + (el.y + el.r) + 'px"></div>';
    if (el.type === "ellipse" || el.type === "rect") return '<div class="cv-handle" data-handle="br" data-el="' + el.id + '" style="left:' + (el.x + el.w) + 'px;top:' + (el.y + el.h) + 'px"></div>';
    if (el.type === "arrow" || el.type === "line") return '<div class="cv-handle" data-handle="p1" data-el="' + el.id + '" style="left:' + el.x1 + 'px;top:' + el.y1 + 'px"></div>' +
      '<div class="cv-handle" data-handle="p2" data-el="' + el.id + '" style="left:' + el.x2 + 'px;top:' + el.y2 + 'px"></div>';
    return "";
  }
  function cvRenderAnno() {
    var doc = cvActiveDoc(); var layer = document.getElementById("cvAnnoLayer"); if (!doc || !layer) return;
    var els = doc.elements || [];
    var svg = '<svg class="cv-anno-svg" viewBox="0 0 ' + cvDocW(doc) + ' ' + cvDocH(doc) + '" width="' + cvDocW(doc) + '" height="' + cvDocH(doc) + '">';
    var texts = "";
    els.forEach(function(el) {
      var selc = el.id === CANVAS.selEl ? " cv-el-sel" : "";
      if (el.type === "ellipse") svg += '<ellipse data-el="' + el.id + '" class="cv-shape' + selc + '" cx="' + (el.x + el.w / 2) + '" cy="' + (el.y + el.h / 2) + '" rx="' + Math.abs(el.w / 2) + '" ry="' + Math.abs(el.h / 2) + '" fill="none" stroke="' + el.color + '" stroke-width="' + el.stroke + '"/>';
      else if (el.type === "rect") svg += '<rect data-el="' + el.id + '" class="cv-shape' + selc + '" x="' + el.x + '" y="' + el.y + '" width="' + Math.abs(el.w) + '" height="' + Math.abs(el.h) + '" fill="none" stroke="' + el.color + '" stroke-width="' + el.stroke + '"/>';
      else if (el.type === "arrow") svg += cvArrowSvg(el);
      else if (el.type === "line") svg += '<line data-el="' + el.id + '" class="cv-shape' + selc + '" x1="' + el.x1 + '" y1="' + el.y1 + '" x2="' + el.x2 + '" y2="' + el.y2 + '" stroke="' + el.color + '" stroke-width="' + el.stroke + '" stroke-linecap="round"/>';
      else if (el.type === "pen") svg += '<polyline data-el="' + el.id + '" class="cv-shape' + selc + '" points="' + el.points.map(function(p) { return p.x + "," + p.y; }).join(" ") + '" fill="none" stroke="' + el.color + '" stroke-width="' + el.stroke + '" stroke-linecap="round" stroke-linejoin="round"/>';
      else if (el.type === "hl") svg += '<polyline data-el="' + el.id + '" class="cv-shape' + selc + '" points="' + el.points.map(function(p) { return p.x + "," + p.y; }).join(" ") + '" fill="none" stroke="' + el.color + '" stroke-width="' + el.stroke + '" stroke-linecap="round" stroke-linejoin="round" opacity="0.35"/>';
      else if (el.type === "num") {
        svg += '<circle data-el="' + el.id + '" class="cv-shape' + selc + '" cx="' + el.x + '" cy="' + el.y + '" r="' + el.r + '" fill="' + el.color + '"/>';
        svg += '<text x="' + el.x + '" y="' + el.y + '" text-anchor="middle" dominant-baseline="central" fill="#fff" font-weight="800" font-family="Inter, Arial, sans-serif" font-size="' + Math.round(el.r * 1.15) + '" style="pointer-events:none;user-select:none">' + el.n + '</text>';
      } else if (el.type === "text") {
        var editing = CANVAS.editText === el.id;
        var bgStyle = el.bg ? "background:rgba(255,255,255,.92);padding:4px 10px;border-radius:8px;" : "";
        texts += '<div class="cv-text' + selc + '" data-el="' + el.id + '" contenteditable="' + editing + '" spellcheck="false" style="left:' + el.x + 'px;top:' + el.y + 'px;color:' + el.color + ';font-size:' + el.size + 'px;' + bgStyle + '">' + esc(el.text).replace(/\n/g, "<br>") + '</div>';
      }
    });
    (CANVAS._guides || []).forEach(function(g) {
      if (g.type === "v") svg += '<line x1="' + g.x + '" y1="0" x2="' + g.x + '" y2="' + cvDocH(doc) + '" stroke="#e11d8f" stroke-width="1.6" stroke-dasharray="10 7"/>';
      else svg += '<line x1="0" y1="' + g.y + '" x2="' + cvDocW(doc) + '" y2="' + g.y + '" stroke="#e11d8f" stroke-width="1.6" stroke-dasharray="10 7"/>';
    });
    svg += '</svg>';
    var handles = cvHandlesHTML(els.find(function(e) { return e.id === CANVAS.selEl; }));
    var drawMode = CANVAS.tool !== "select";
    var catchDiv = '<div id="cvDrawCatch" class="cv-draw-catch" style="pointer-events:' + (drawMode ? 'all' : 'none') + ';cursor:' + (drawMode ? 'crosshair' : 'default') + '"></div>';
    layer.innerHTML = svg + texts + handles + catchDiv;
    var selEl = els.find(function(e) { return e.id === CANVAS.selEl; });
    if (selEl && selEl.type === "text") {
      var div = layer.querySelector('.cv-text[data-el="' + selEl.id + '"]');
      if (div) {
        var hd = document.createElement("div");
        hd.className = "cv-handle"; hd.dataset.handle = "tsize"; hd.dataset.el = selEl.id;
        hd.style.left = (selEl.x + div.offsetWidth) + "px"; hd.style.top = (selEl.y + div.offsetHeight) + "px";
        layer.appendChild(hd);
      }
    }
  }

  /* ---------- Dibujar (crear elementos) ---------- */
  var cvDrawCtx = null, cvMoveCtx = null, cvResizeCtx = null;
  CANVAS.tool = "select"; CANVAS.color = "#e11d1d"; CANVAS.selEl = null; CANVAS.editText = null;
  function cvDrawStart(e) {
    var doc = cvActiveDoc(); if (!doc) return;
    var p = cvEventToCanvas(e); e.preventDefault();
    cvRecord();
    var color = CANVAS.color, id = cvElId();
    if (CANVAS.tool === "text") {
      var el = { id: id, type: "text", x: p.x, y: p.y, text: "Texto", color: color, size: 46 };
      doc.elements.push(el); CANVAS.selEl = id; CANVAS.editText = id; CANVAS.tool = "select";
      doc.updated = Date_nowSafe(); cvSave(); cvRenderTools(); cvRenderAnno();
      setTimeout(function() {
        var d = document.querySelector('.cv-text[data-el="' + id + '"]');
        if (d) { d.focus(); try { var range = document.createRange(); range.selectNodeContents(d); var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range); } catch (_) {} }
      }, 20);
      return;
    }
    if (CANVAS.tool === "num") {
      var nextN = (doc.elements.filter(function(x) { return x.type === "num"; }).reduce(function(mx, x) { return Math.max(mx, x.n || 0); }, 0)) + 1;
      var elN = { id: id, type: "num", x: p.x, y: p.y, r: 32, n: nextN, color: color };
      doc.elements.push(elN); CANVAS.selEl = id; CANVAS.tool = "select";
      doc.updated = Date_nowSafe(); cvSave(); cvRenderTools(); cvRenderAnno();
      return;
    }
    var elD; var sw = CANVAS.stroke || 7;
    if (CANVAS.tool === "ellipse") elD = { id: id, type: "ellipse", x: p.x, y: p.y, w: 0, h: 0, color: color, stroke: sw };
    else if (CANVAS.tool === "rect") elD = { id: id, type: "rect", x: p.x, y: p.y, w: 0, h: 0, color: color, stroke: sw };
    else if (CANVAS.tool === "arrow") elD = { id: id, type: "arrow", x1: p.x, y1: p.y, x2: p.x, y2: p.y, color: color, stroke: sw + 2 };
    else if (CANVAS.tool === "line") elD = { id: id, type: "line", x1: p.x, y1: p.y, x2: p.x, y2: p.y, color: color, stroke: sw };
    else if (CANVAS.tool === "pen") elD = { id: id, type: "pen", points: [{ x: p.x, y: p.y }], color: color, stroke: sw };
    else if (CANVAS.tool === "hl") elD = { id: id, type: "hl", points: [{ x: p.x, y: p.y }], color: color, stroke: Math.max(sw * 2.6, 22) };
    else return;
    doc.elements.push(elD);
    cvDrawCtx = { el: elD, sx: p.x, sy: p.y };
    document.addEventListener("mousemove", cvDrawMove); document.addEventListener("mouseup", cvDrawEnd);
    cvRenderAnno();
  }
  function cvDrawMove(e) {
    if (!cvDrawCtx) return;
    var p = cvEventToCanvas(e), el = cvDrawCtx.el;
    if (el.type === "ellipse" || el.type === "rect") { el.x = Math.min(cvDrawCtx.sx, p.x); el.y = Math.min(cvDrawCtx.sy, p.y); el.w = Math.abs(p.x - cvDrawCtx.sx); el.h = Math.abs(p.y - cvDrawCtx.sy); }
    else if (el.type === "arrow" || el.type === "line") { el.x2 = p.x; el.y2 = p.y; }
    else if (el.type === "pen" || el.type === "hl") { el.points.push({ x: p.x, y: p.y }); }
    cvRenderAnno();
  }
  function cvDrawEnd() {
    document.removeEventListener("mousemove", cvDrawMove); document.removeEventListener("mouseup", cvDrawEnd);
    if (!cvDrawCtx) return;
    var el = cvDrawCtx.el, doc = cvActiveDoc(), tiny = false;
    if (el.type === "ellipse" || el.type === "rect") tiny = (el.w < 8 && el.h < 8);
    else if (el.type === "arrow" || el.type === "line") tiny = (Math.hypot(el.x2 - el.x1, el.y2 - el.y1) < 8);
    else if (el.type === "pen" || el.type === "hl") tiny = (el.points.length < 2);
    if (tiny) { doc.elements = doc.elements.filter(function(x) { return x.id !== el.id; }); CANVAS.selEl = null; }
    else { CANVAS.selEl = el.id; CANVAS.tool = "select"; }
    cvDrawCtx = null; doc.updated = Date_nowSafe(); cvSave(); cvRenderTools(); cvRenderAnno();
  }
  function cvMoveStart(e, elId) {
    var doc = cvActiveDoc(); var el = doc.elements.find(function(x) { return x.id === elId; }); if (!el) return;
    if (el.type === "text" && CANVAS.editText === elId) return;
    e.preventDefault();
    cvRecord();
    var p = cvEventToCanvas(e);
    cvMoveCtx = { el: el, sx: p.x, sy: p.y, moved: false, snap: JSON.parse(JSON.stringify(el)) };
    document.addEventListener("mousemove", cvMoveMove); document.addEventListener("mouseup", cvMoveEnd);
  }
  function cvMoveMove(e) {
    if (!cvMoveCtx) return;
    var p = cvEventToCanvas(e); var dx = p.x - cvMoveCtx.sx, dy = p.y - cvMoveCtx.sy; var el = cvMoveCtx.el, s = cvMoveCtx.snap;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) cvMoveCtx.moved = true;
    cvApplyElMove(el, s, dx, dy);
    var snap = cvComputeSnap(el);
    if (snap.dx || snap.dy) cvApplyElMove(el, s, dx + snap.dx, dy + snap.dy);
    CANVAS._guides = snap.lines;
    cvRenderAnno();
  }
  function cvMoveEnd() {
    document.removeEventListener("mousemove", cvMoveMove); document.removeEventListener("mouseup", cvMoveEnd);
    if (!cvMoveCtx) return;
    var el = cvMoveCtx.el, doc = cvActiveDoc();
    if (!cvMoveCtx.moved && el.type === "text") {
      CANVAS.editText = el.id; cvRenderAnno();
      setTimeout(function() { var d = document.querySelector('.cv-text[data-el="' + el.id + '"]'); if (d) d.focus(); }, 20);
    } else { doc.updated = Date_nowSafe(); cvSave(); }
    cvMoveCtx = null; CANVAS._guides = null; cvRenderAnno();
  }
  function cvResizeStart(e, handle) {
    var doc = cvActiveDoc(); var el = doc.elements.find(function(x) { return x.id === handle.dataset.el; }); if (!el) return;
    e.preventDefault(); e.stopPropagation();
    cvRecord();
    var p0 = cvEventToCanvas(e);
    cvResizeCtx = { el: el, which: handle.dataset.handle, sy: p0.y, size0: el.size || 46 };
    document.addEventListener("mousemove", cvResizeMove); document.addEventListener("mouseup", cvResizeEnd);
  }
  function cvResizeMove(e) {
    if (!cvResizeCtx) return;
    var p = cvEventToCanvas(e), el = cvResizeCtx.el, w = cvResizeCtx.which;
    if ((el.type === "ellipse" || el.type === "rect") && w === "br") { el.w = Math.max(8, p.x - el.x); el.h = Math.max(8, p.y - el.y); }
    else if (el.type === "num" && w === "nr") { el.r = Math.max(12, Math.round(Math.hypot(p.x - el.x, p.y - el.y))); }
    else if (el.type === "arrow" || el.type === "line") { if (w === "p1") { el.x1 = p.x; el.y1 = p.y; } else { el.x2 = p.x; el.y2 = p.y; } }
    else if (el.type === "text" && w === "tsize") { el.size = Math.max(14, Math.round((cvResizeCtx.size0 || 46) + (p.y - cvResizeCtx.sy) * 0.6)); }
    cvRenderAnno();
  }
  function cvResizeEnd() {
    document.removeEventListener("mousemove", cvResizeMove); document.removeEventListener("mouseup", cvResizeEnd);
    if (cvResizeCtx) { var d = cvActiveDoc(); d.updated = Date_nowSafe(); cvSave(); cvResizeCtx = null; }
  }
  function cvAnnoMouseDown(e) {
    if (CANVAS.view !== "editor") return;
    if (CANVAS._toolGroup) { CANVAS._toolGroup = null; cvRenderTools(); }
    var fmv = e.target.closest("[data-fmove]"); if (fmv) { cvFrameMoveStart(e, fmv.dataset.fmove); return; }
    var frs = e.target.closest("[data-fresize]"); if (frs) { cvFrameResizeStart(e, frs.dataset.fresize); return; }
    var h = e.target.closest(".cv-handle"); if (h) { cvResizeStart(e, h); return; }
    var catchEl = e.target.closest("#cvDrawCatch");
    if (catchEl && CANVAS.tool !== "select") { cvDrawStart(e); return; }
    var node = e.target.closest("[data-el]");
    if (node && CANVAS.tool === "select") {
      var el = cvActiveDoc().elements.find(function(x) { return x.id === node.dataset.el; });
      if (el && el.type === "text" && CANVAS.editText === el.id) return;
      if (el && el.locked) { CANVAS.selEl = node.dataset.el; cvRenderTools(); cvRenderAnno(); return; }
      CANVAS.selEl = node.dataset.el; cvMoveStart(e, node.dataset.el); cvRenderTools(); cvRenderAnno(); return;
    }
  }
  function cvOnFocusOut(e) {
    var tx = e.target && e.target.closest && e.target.closest(".cv-text[data-el]");
    if (tx && CANVAS.editText === tx.dataset.el) {
      var doc = cvActiveDoc(); var el = doc.elements.find(function(x) { return x.id === tx.dataset.el; });
      CANVAS.editText = null;
      if (el) { el.text = tx.innerText; if (!String(el.text).trim()) { doc.elements = doc.elements.filter(function(x) { return x.id !== el.id; }); CANVAS.selEl = null; } }
      cvSave(); cvRenderAnno();
    }
  }
  function cvDeleteEl() {
    var doc = cvActiveDoc(); if (!doc || !CANVAS.selEl) return;
    var sel = cvSelElement(); if (sel && sel.locked) return;
    cvRecord();
    doc.elements = (doc.elements || []).filter(function(e) { return e.id !== CANVAS.selEl; });
    CANVAS.selEl = null; CANVAS.editText = null; doc.updated = Date_nowSafe(); cvSave(); cvRenderAnno();
  }
  function cvOnKey(e) {
    // Los atajos de Canvas solo aplican con el panel Canvas abierto (antes capturaban Ctrl+Z en toda la página).
    var ovCanvas = document.getElementById("ov-canvas");
    if (!ovCanvas || !ovCanvas.classList.contains("open")) return;
    var typing0 = document.activeElement && (document.activeElement.isContentEditable || document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "TEXTAREA");
    if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z") && !e.shiftKey) { e.preventDefault(); cvUndo(); return; }
    if ((e.ctrlKey || e.metaKey) && ((e.key === "y" || e.key === "Y") || (e.shiftKey && (e.key === "z" || e.key === "Z")))) { e.preventDefault(); cvRedo(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === "d" || e.key === "D")) { e.preventDefault(); if (CANVAS.view === "editor" && CANVAS.selEl) cvDuplicateEl(); return; }
    if (CANVAS.view === "home" && CANVAS.homeMode === "board") {
      if ((e.key === "Delete" || e.key === "Backspace") && !typing0 && CANVAS.boardHover) {
        var h = CANVAS.boardHover, doc0 = CANVAS.docs.find(function(d) { return d.id === h.docId; }), f0 = doc0 && doc0.frames.find(function(x) { return x.id === h.frameId; });
        if (f0 && f0.img) { e.preventDefault(); cvClearFrameOn(h.docId, h.frameId, true); }
      }
      return;
    }
    if (CANVAS.view !== "editor") return;
    if (e.key === "ArrowLeft" && !typing0) { e.preventDefault(); cvNavDoc(-1); }
    else if (e.key === "ArrowRight" && !typing0) { e.preventDefault(); cvNavDoc(1); }
    else if (e.key === "Enter" && !typing0 && CANVAS.selFrame) { e.preventDefault(); var dd = cvActiveDoc(); var ff = dd && dd.frames.find(function(x) { return x.id === CANVAS.selFrame; }); if (ff && !ff.img) cvPickImage(ff.id); }
    else if ((e.key === "Delete" || e.key === "Backspace") && !typing0 && CANVAS.selEl) { e.preventDefault(); cvDeleteEl(); }
    else if (e.key === "Escape") { e.stopImmediatePropagation(); cvCloseAdjust(); if (CANVAS.editText) { CANVAS.editText = null; cvRenderAnno(); } else if (CANVAS.selEl) { CANVAS.selEl = null; cvRenderAnno(); } else { cvBackHome(); } }
  }
  function cvDrawEl(ctx, el) {
    ctx.save();
    ctx.strokeStyle = el.color; ctx.fillStyle = el.color; ctx.lineWidth = el.stroke || 6; ctx.lineJoin = "round"; ctx.lineCap = "round";
    if (el.type === "ellipse") { ctx.beginPath(); ctx.ellipse(el.x + el.w / 2, el.y + el.h / 2, Math.abs(el.w / 2), Math.abs(el.h / 2), 0, 0, Math.PI * 2); ctx.stroke(); }
    else if (el.type === "arrow") {
      ctx.beginPath(); ctx.moveTo(el.x1, el.y1); ctx.lineTo(el.x2, el.y2); ctx.stroke();
      var ang = Math.atan2(el.y2 - el.y1, el.x2 - el.x1), hl = Math.max(18, (el.stroke || 9) * 3.0), a1 = ang + Math.PI * 0.86, a2 = ang - Math.PI * 0.86;
      ctx.beginPath(); ctx.moveTo(el.x2, el.y2); ctx.lineTo(el.x2 + hl * Math.cos(a1), el.y2 + hl * Math.sin(a1)); ctx.lineTo(el.x2 + hl * Math.cos(a2), el.y2 + hl * Math.sin(a2)); ctx.closePath(); ctx.fill();
    }
    else if (el.type === "rect") { ctx.strokeRect(el.x, el.y, Math.abs(el.w), Math.abs(el.h)); }
    else if (el.type === "line") { ctx.beginPath(); ctx.moveTo(el.x1, el.y1); ctx.lineTo(el.x2, el.y2); ctx.stroke(); }
    else if (el.type === "pen") { ctx.beginPath(); (el.points || []).forEach(function(p, i) { i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.stroke(); }
    else if (el.type === "hl") { ctx.globalAlpha = 0.35; ctx.beginPath(); (el.points || []).forEach(function(p, i) { i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.stroke(); ctx.globalAlpha = 1; }
    else if (el.type === "num") {
      ctx.fillStyle = el.color; ctx.beginPath(); ctx.arc(el.x, el.y, el.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = "800 " + Math.round(el.r * 1.15) + "px Inter, Arial, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(String(el.n), el.x, el.y + 1);
    } else if (el.type === "text") {
      var size = el.size || 44, lh = size * 1.1, pad = 10, padY = 4;
      ctx.font = "700 " + size + "px Inter, Arial, sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "top";
      var lines = String(el.text || "").split("\n");
      var ox = el.bg ? el.x + pad : el.x, oy = el.bg ? el.y + padY : el.y;
      if (el.bg) {
        var maxW = 0; lines.forEach(function(ln) { maxW = Math.max(maxW, ctx.measureText(ln).width); });
        var rw = maxW + pad * 2, rh = lines.length * lh + padY * 2, rr = 8;
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.beginPath(); ctx.moveTo(el.x + rr, el.y); ctx.arcTo(el.x + rw, el.y, el.x + rw, el.y + rh, rr); ctx.arcTo(el.x + rw, el.y + rh, el.x, el.y + rh, rr); ctx.arcTo(el.x, el.y + rh, el.x, el.y, rr); ctx.arcTo(el.x, el.y, el.x + rw, el.y, rr); ctx.fill();
      }
      ctx.fillStyle = el.color;
      lines.forEach(function(ln, i) { ctx.fillText(ln, ox, oy + i * lh); });
    }
    ctx.restore();
  }

  /* ---------- Deshacer / rehacer ---------- */
  CANVAS.hist = { undo: [], redo: [] };
  // Copia profunda que reutiliza los textos (las fotos en base64 pesan MB; copiarlas 80 veces llenaba la memoria).
  function cvClonar(v) {
    if (Array.isArray(v)) return v.map(cvClonar);
    if (v && typeof v === "object") { var o = {}; for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) o[k] = cvClonar(v[k]); return o; }
    return v;
  }
  function cvSnapDoc(d) { return { docId: d.id, doc: cvClonar(d) }; }
  function cvRecord() {
    var d = cvActiveDoc(); if (!d) return;
    CANVAS.hist.undo.push(cvSnapDoc(d));
    if (CANVAS.hist.undo.length > 40) CANVAS.hist.undo.shift();
    CANVAS.hist.redo = []; CANVAS._lastAct = null;
  }
  function cvRecordAct(tag) {
    if (tag && tag === CANVAS._lastAct) return;
    var d = cvActiveDoc(); if (!d) return;
    CANVAS.hist.undo.push(cvSnapDoc(d));
    if (CANVAS.hist.undo.length > 40) CANVAS.hist.undo.shift();
    CANVAS.hist.redo = []; CANVAS._lastAct = tag || null;
  }
  function cvApplySnap(snap) {
    var i = CANVAS.docs.findIndex(function(x) { return x.id === snap.docId; }); if (i < 0) return;
    CANVAS.docs[i] = cvClonar(snap.doc);
    CANVAS.activeId = snap.docId; CANVAS.selFrame = null; CANVAS.selEl = null; CANVAS.editText = null; CANVAS._lastAct = null;
    cvSave(); cvRenderEditor();
  }
  function cvUndo() { var d = cvActiveDoc(); if (!d || !CANVAS.hist.undo.length) return; CANVAS.hist.redo.push(cvSnapDoc(d)); cvApplySnap(CANVAS.hist.undo.pop()); }
  function cvRedo() { var d = cvActiveDoc(); if (!d || !CANVAS.hist.redo.length) return; CANVAS.hist.undo.push(cvSnapDoc(d)); cvApplySnap(CANVAS.hist.redo.pop()); }
  function cvOnFocusIn(e) {
    if (CANVAS.view !== "editor") return;
    var ed = e.target.closest && e.target.closest("#cvTitle, #cvDocName, .cv-text[data-el]");
    if (ed) cvRecord();
  }

  /* ---------- Marcos libres ---------- */
  function cvAddFreeFrame() {
    var doc = cvActiveDoc(); if (!doc) return;
    cvRecord();
    var id = cvUid("ff");
    var n = doc.frames.filter(function(f) { return f.free; }).length;
    var x = Math.min(700, 120 + n * 46), y = Math.min(760, 300 + n * 46);
    doc.frames.push({ id: id, x: x, y: y, w: 380, h: 285, img: null, free: true });
    CANVAS.selFrame = id; doc.updated = Date_nowSafe(); cvSave(); cvRenderEditor();
  }
  function cvDeleteFreeFrame(fid) {
    var doc = cvActiveDoc(); if (!doc) return;
    cvRecord();
    doc.frames = doc.frames.filter(function(f) { return f.id !== fid; });
    if (CANVAS.selFrame === fid) CANVAS.selFrame = null;
    doc.updated = Date_nowSafe(); cvSave(); cvRenderEditor();
  }
  var cvFrameDrag = null;
  function cvFrameMoveStart(e, fid) {
    var doc = cvActiveDoc(); var f = doc.frames.find(function(x) { return x.id === fid; }); if (!f) return;
    e.preventDefault(); cvRecord(); CANVAS.selFrame = fid;
    var p = cvEventToCanvas(e);
    cvFrameDrag = { mode: "move", f: f, sx: p.x, sy: p.y, ox: f.x, oy: f.y };
    document.addEventListener("mousemove", cvFrameDragMove); document.addEventListener("mouseup", cvFrameDragEnd);
  }
  function cvFrameResizeStart(e, fid) {
    var doc = cvActiveDoc(); var f = doc.frames.find(function(x) { return x.id === fid; }); if (!f) return;
    e.preventDefault(); e.stopPropagation(); cvRecord(); CANVAS.selFrame = fid;
    var p = cvEventToCanvas(e);
    cvFrameDrag = { mode: "resize", f: f, sx: p.x, sy: p.y, ow: f.w, oh: f.h };
    document.addEventListener("mousemove", cvFrameDragMove); document.addEventListener("mouseup", cvFrameDragEnd);
  }
  function cvFrameDragMove(e) {
    if (!cvFrameDrag) return;
    var p = cvEventToCanvas(e), d = cvFrameDrag, f = d.f;
    if (d.mode === "move") { f.x = Math.round(d.ox + (p.x - d.sx)); f.y = Math.round(d.oy + (p.y - d.sy)); }
    else { f.w = Math.max(60, Math.round(d.ow + (p.x - d.sx))); f.h = Math.max(60, Math.round(d.oh + (p.y - d.sy))); }
    var el = document.querySelector('#cvCanvas .cv-frame[data-frame="' + f.id + '"]');
    if (el) { el.style.left = f.x + "px"; el.style.top = f.y + "px"; el.style.width = f.w + "px"; el.style.height = f.h + "px"; if (f.img) cvApplyFrameImg(el, f); }
  }
  function cvFrameDragEnd() {
    document.removeEventListener("mousemove", cvFrameDragMove); document.removeEventListener("mouseup", cvFrameDragEnd);
    if (cvFrameDrag) { var d = cvActiveDoc(); if (d) { d.updated = Date_nowSafe(); cvSave(); } cvFrameDrag = null; }
  }

  /* ---------- Zoom / pan de imagen en marco ---------- */
  function cvGeom(fw, fh, nw, nh, scale, ox, oy) {
    nw = nw || 1; nh = nh || 1;
    var cover = Math.max(fw / nw, fh / nh);
    var s = cover * (scale || 1);
    var dw = nw * s, dh = nh * s;
    var left = (fw - dw) / 2 + (ox || 0);
    var top = (fh - dh) / 2 + (oy || 0);
    left = Math.min(0, Math.max(fw - dw, left));
    top = Math.min(0, Math.max(fh - dh, top));
    return { left: left, top: top, dw: dw, dh: dh };
  }
  function cvFrameImgGeom(f) { var im = f.img; return cvGeom(f.w, f.h, im.nw, im.nh, im.scale, im.ox, im.oy); }
  function cvClampOffset(f) {
    var im = f.img, g = cvFrameImgGeom(f);
    var cover = Math.max(f.w / (im.nw || 1), f.h / (im.nh || 1)), s = cover * (im.scale || 1);
    var dw = (im.nw || 1) * s, dh = (im.nh || 1) * s;
    im.ox = g.left - (f.w - dw) / 2;
    im.oy = g.top - (f.h - dh) / 2;
  }
  function cvEnsureSizes(doc, done) {
    var need = doc.frames.filter(function(f) { return f.img && (!f.img.nw || !f.img.nh); });
    if (!need.length) { done(); return; }
    var left = need.length;
    need.forEach(function(f) {
      var im = new Image();
      im.onload = im.onerror = function() {
        f.img.nw = im.naturalWidth || im.width || 100;
        f.img.nh = im.naturalHeight || im.height || 100;
        if (f.img.scale == null) f.img.scale = 1;
        if (f.img.ox == null) f.img.ox = 0;
        if (f.img.oy == null) f.img.oy = 0;
        left -= 1; if (left === 0) done();
      };
      im.src = f.img.src;
    });
  }
  function cvApplyFrameImg(frameEl, f) {
    var img = frameEl && frameEl.querySelector(".cv-frame-img"); if (!img) return;
    var g = cvFrameImgGeom(f);
    img.style.left = g.left + "px"; img.style.top = g.top + "px"; img.style.width = g.dw + "px"; img.style.height = g.dh + "px";
  }
  function cvZoomFrame(frameId, factor) {
    var doc = cvActiveDoc(); if (!doc) return;
    var f = doc.frames.find(function(x) { return x.id === frameId; }); if (!f || !f.img) return;
    cvRecordAct("zoom:" + frameId);
    f.img.scale = Math.max(1, Math.min(6, (f.img.scale || 1) * factor));
    cvClampOffset(f);
    cvApplyFrameImg(document.querySelector('#cvCanvas [data-frame="' + frameId + '"]'), f);
    doc.updated = Date_nowSafe(); cvSave();
  }
  function cvResetFrame(frameId) {
    var doc = cvActiveDoc(); if (!doc) return;
    var f = doc.frames.find(function(x) { return x.id === frameId; }); if (!f || !f.img) return;
    cvRecord();
    f.img.scale = 1; f.img.ox = 0; f.img.oy = 0;
    cvApplyFrameImg(document.querySelector('#cvCanvas [data-frame="' + frameId + '"]'), f);
    doc.updated = Date_nowSafe(); cvSave();
  }
  var cvPan = null;
  function cvPanStart(e) {
    var img = e.target.closest(".cv-frame-img"); if (!img) return;
    var frameEl = img.closest("[data-frame]"); if (!frameEl) return;
    var doc = cvActiveDoc(); var f = doc && doc.frames.find(function(x) { return x.id === frameEl.dataset.frame; });
    if (!f || !f.img) return;
    e.preventDefault();
    cvRecord();
    CANVAS.selFrame = f.id;
    cvPan = { f: f, frameEl: frameEl, startX: e.clientX, startY: e.clientY, ox0: f.img.ox || 0, oy0: f.img.oy || 0 };
    document.addEventListener("mousemove", cvPanMove);
    document.addEventListener("mouseup", cvPanEnd);
  }
  function cvPanMove(e) {
    if (!cvPan) return;
    var sc = CANVAS.scale || 1;
    cvPan.f.img.ox = cvPan.ox0 + (e.clientX - cvPan.startX) / sc;
    cvPan.f.img.oy = cvPan.oy0 + (e.clientY - cvPan.startY) / sc;
    cvClampOffset(cvPan.f);
    cvApplyFrameImg(cvPan.frameEl, cvPan.f);
  }
  function cvPanEnd() {
    document.removeEventListener("mousemove", cvPanMove);
    document.removeEventListener("mouseup", cvPanEnd);
    if (cvPan) { var d = cvActiveDoc(); if (d) { d.updated = Date_nowSafe(); cvSave(); } cvPan = null; }
  }
  function cvOnWheel(e) {
    var frameEl = e.target.closest("[data-frame]"); if (!frameEl) return;
    var doc = cvActiveDoc(); var f = doc && doc.frames.find(function(x) { return x.id === frameEl.dataset.frame; });
    if (!f || !f.img) return;
    e.preventDefault();
    cvZoomFrame(f.id, e.deltaY < 0 ? 1.10 : 1 / 1.10);
  }

  /* ---------- Eventos globales ---------- */
  function cvOnClick(e) {
    var t = e.target;
    if (t.closest("[data-cvrailtoggle]")) { e.stopPropagation(); cvToggleRail(); return; }
    var rdel = t.closest("[data-cvraildel]"); if (rdel) { e.stopPropagation(); cvRailDelete(rdel.dataset.cvraildel); return; }
    if (t.closest("[data-cvviewtoggle]")) { e.stopPropagation(); var w = document.getElementById("cvViewWrap"); if (w) w.classList.toggle("open"); return; }
    var vpick = t.closest("[data-cvview]"); if (vpick) { cvSetView(vpick.dataset.cvview, false); return; }
    var bframe = t.closest("[data-bframe]"); if (bframe) { e.stopPropagation(); cvBoardFrameClick(bframe.dataset.bdoc, bframe.dataset.bframe); return; }
    if (t.closest("[data-newsheet]")) { cvNewCustomSheet(); return; }
    var open = t.closest("[data-open]"); if (open) { cvOpenDoc(parseInt(open.dataset.open)); return; }
    var ren = t.closest("[data-ren]"); if (ren) { cvRenameDoc(parseInt(ren.dataset.ren)); return; }
    var dup = t.closest("[data-dup]"); if (dup) { cvDuplicateDoc(parseInt(dup.dataset.dup)); return; }
    var del = t.closest("[data-del]"); if (del) { cvDeleteDoc(parseInt(del.dataset.del)); return; }
    var csz = t.closest('[data-cvsize="apply"]'); if (csz) { var d0 = cvActiveDoc(); var wi = document.getElementById("cvSizeW"), hi = document.getElementById("cvSizeH"); if (d0 && wi && hi) cvApplySize(d0, wi.value, hi.value); return; }
    if (t.closest("#cvBackBtn")) { cvBackHome(); return; }
    if (t.closest("#cvExportBtn")) { var d1 = cvActiveDoc(); if (d1) cvExportPNG(d1.id); return; }
    if (t.closest("#cvCopyBtn")) { cvCopySheet(t.closest("#cvCopyBtn")); return; }
    if (t.closest("#cvPdfBtn")) { var d2 = cvActiveDoc(); if (d2) cvExportPDF([d2], cvSheetFileName(d2) + ".pdf"); return; }
    if (t.closest("#cvPdfAllBtn")) { if (CANVAS.docs.length) cvExportPDF(CANVAS.docs, "Canvas - todas las hojas.pdf"); return; }
    if (t.closest("#cvClearPhotos")) { var doc3 = cvActiveDoc(); if (doc3 && doc3.frames.some(function(f) { return f.img; })) { cvRecord(); doc3.frames.forEach(function(f) { f.img = null; }); doc3.updated = Date_nowSafe(); cvSave(); cvRenderEditor(); } return; }
    if (t.closest("#cvPrevBtn")) { cvNavDoc(-1); return; }
    if (t.closest("#cvNextBtn")) { cvNavDoc(1); return; }
    if (t.closest("[data-cvexpert]")) { cvToggleExpert(); return; }
    if (t.closest("[data-eldup]")) { cvDuplicateEl(); return; }
    if (t.closest("[data-elfront]")) { cvOrderEl("front"); return; }
    if (t.closest("[data-elback]")) { cvOrderEl("back"); return; }
    if (t.closest("[data-ellock]")) { cvToggleLock(); return; }
    if (t.closest("[data-textbg]")) { var s0 = cvSelElement(); if (s0 && s0.type === "text") { cvRecord(); s0.bg = !s0.bg; cvSave(); cvRenderAnno(); } return; }
    var swb = t.closest("[data-stroke]"); if (swb) { CANVAS.stroke = +swb.dataset.stroke; var s1 = cvSelElement(); if (s1 && s1.stroke != null) { cvRecord(); s1.stroke = (s1.type === "hl") ? Math.max(CANVAS.stroke * 2.6, 22) : ((s1.type === "arrow") ? CANVAS.stroke + 2 : CANVAS.stroke); cvSave(); } cvRenderTools(); cvRenderAnno(); return; }
    var tg = t.closest("[data-toolgroup]"); if (tg) { CANVAS._toolGroup = (CANVAS._toolGroup === tg.dataset.toolgroup) ? null : tg.dataset.toolgroup; cvRenderTools(); return; }
    var tl = t.closest("[data-tool]"); if (tl) { CANVAS.tool = tl.dataset.tool; CANVAS._toolGroup = null; if (CANVAS.tool !== "select") CANVAS.editText = null; cvRenderTools(); cvRenderAnno(); return; }
    var co = t.closest("[data-color]"); if (co) { CANVAS.color = co.dataset.color; var s2 = cvSelElement(); if (s2) { cvRecord(); s2.color = co.dataset.color; cvSave(); } cvRenderTools(); cvRenderAnno(); return; }
    if (t.closest("[data-eldel]")) { cvDeleteEl(); return; }
    if (t.closest("[data-freeframe]")) { cvAddFreeFrame(); return; }
    var fdel = t.closest("[data-fdel]"); if (fdel) { e.stopPropagation(); cvDeleteFreeFrame(fdel.dataset.fdel); return; }
    if (t.closest("[data-fmove]") || t.closest("[data-fresize]")) return;
    var zin = t.closest("[data-zin]"); if (zin) { e.stopPropagation(); cvZoomFrame(zin.dataset.zin, 1.15); return; }
    var zout = t.closest("[data-zout]"); if (zout) { e.stopPropagation(); cvZoomFrame(zout.dataset.zout, 1 / 1.15); return; }
    var zr = t.closest("[data-zreset]"); if (zr) { e.stopPropagation(); cvResetFrame(zr.dataset.zreset); return; }
    var frt = t.closest("[data-frot]"); if (frt) { e.stopPropagation(); cvBakeTransform(frt.dataset.frot, "rot"); return; }
    var ffl = t.closest("[data-fflip]"); if (ffl) { e.stopPropagation(); cvBakeTransform(ffl.dataset.fflip, "flip"); return; }
    var fad = t.closest("[data-fadj]"); if (fad) { e.stopPropagation(); cvOpenAdjust(fad.dataset.fadj, fad); return; }
    var rep = t.closest("[data-replace]"); if (rep) { e.stopPropagation(); cvPickImage(rep.dataset.replace); return; }
    var clr = t.closest("[data-clear]"); if (clr) { e.stopPropagation(); cvClearFrame(clr.dataset.clear); return; }
    var fr = t.closest("[data-frame]");
    if (fr) {
      var id2 = fr.dataset.frame;
      CANVAS.selFrame = id2;
      var doc4 = cvActiveDoc(); var f2 = doc4 && doc4.frames.find(function(x) { return x.id === id2; });
      document.querySelectorAll("#cvCanvas .cv-frame").forEach(function(el2) { el2.classList.toggle("cv-sel", el2.dataset.frame === id2); });
      if (f2 && !f2.img) cvPickImage(id2);
      return;
    }
  }
  function cvOnDragOver(e) {
    var bf = e.target.closest("[data-bframe]");
    if (bf) { e.preventDefault(); document.querySelectorAll(".cv-thumb-frame.cv-drop").forEach(function(el) { el.classList.toggle("cv-drop", el === bf); }); bf.classList.add("cv-drop"); return; }
    if (e.target.closest("[data-frame]")) { e.preventDefault(); var fr = e.target.closest("[data-frame]"); document.querySelectorAll("#cvCanvas .cv-frame").forEach(function(el) { el.classList.toggle("cv-drop", el === fr); }); }
  }
  function cvOnDragLeave(e) { var fr = e.target.closest("[data-frame],[data-bframe]"); if (fr) fr.classList.remove("cv-drop"); }
  function cvOnDrop(e) {
    var bf = e.target.closest("[data-bframe]");
    if (bf) { e.preventDefault(); bf.classList.remove("cv-drop"); var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (file) { CANVAS.boardTarget = { docId: parseInt(bf.dataset.bdoc), frameId: bf.dataset.bframe }; cvReadFileToTarget(file, { docId: parseInt(bf.dataset.bdoc), frameId: bf.dataset.bframe, board: true }); } return; }
    var fr = e.target.closest("[data-frame]"); if (!fr) return;
    e.preventDefault(); fr.classList.remove("cv-drop");
    var file2 = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file2) cvReadFileToFrame(file2, fr.dataset.frame);
  }
  function cvOnPaste(e) {
    var ovC = document.getElementById("ov-canvas");
    if (!ovC || !ovC.classList.contains("open")) return;
    var items = (e.clipboardData && e.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.type && it.type.indexOf("image") === 0) {
        var file = it.getAsFile(); if (!file) return;
        if (CANVAS.view === "editor") {
          var ad = cvActiveDoc();
          var target = CANVAS.selFrame || (ad && (ad.frames.find(function(f) { return !f.img; }) || ad.frames[0]) || {}).id;
          if (target) { e.preventDefault(); cvReadFileToFrame(file, target); }
          return;
        }
        if (CANVAS.homeMode === "board") {
          var tg = CANVAS.boardHover || CANVAS.boardTarget;
          if (tg) { e.preventDefault(); cvReadFileToTarget(file, { docId: tg.docId, frameId: tg.frameId, board: true }); }
        }
        return;
      }
    }
  }
  function cvOnTitleInput(e) {
    var doc = cvActiveDoc(); if (!doc) return;
    var cp = e.target.closest("#cvColorPick");
    if (cp) { CANVAS.color = cp.value; var s = cvSelElement(); if (s) { cvRecord(); s.color = cp.value; cvSave(); } cvRenderAnno(); document.querySelectorAll("#cvTools .cv-color").forEach(function(b) { b.classList.remove("active"); }); return; }
    var el = e.target.closest("#cvTitle");
    if (el) { doc.title = el.innerText; doc.updated = Date_nowSafe(); el.style.fontSize = cvTitleSize(doc.title) + "px"; cvSave(); return; }
    var nm = e.target.closest("#cvDocName");
    if (nm) { doc.name = nm.innerText; doc.updated = Date_nowSafe(); cvSave(); return; }
    var tx = e.target.closest(".cv-text[data-el]");
    if (tx) { var elx = (doc.elements || []).find(function(x) { return x.id === tx.dataset.el; }); if (elx) { elx.text = tx.innerText; doc.updated = Date_nowSafe(); cvSave(); } return; }
  }

  // ---------- Wiring ----------
  document.addEventListener("click", cvOnClick);
  document.addEventListener("input", cvOnTitleInput);
  document.addEventListener("change", function(e) {
    var sel = e.target.closest("#cvSizePreset"); if (!sel || sel.value === "") return;
    var p = CV_SIZE_PRESETS[+sel.value], d = cvActiveDoc();
    if (p && d) cvApplySize(d, p.w, p.h);
  });
  document.addEventListener("dragover", cvOnDragOver);
  document.addEventListener("dragleave", cvOnDragLeave);
  document.addEventListener("drop", cvOnDrop);
  document.addEventListener("mousedown", cvPanStart);
  document.addEventListener("mousedown", cvAnnoMouseDown);
  document.getElementById("ov-canvas").addEventListener("wheel", cvOnWheel, { passive: false });
  document.addEventListener("focusout", cvOnFocusOut);
  document.addEventListener("focusin", cvOnFocusIn);
  document.addEventListener("keydown", cvOnKey);
  document.addEventListener("paste", cvOnPaste);
  document.getElementById("ov-canvas").addEventListener("keydown", function(e) {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches('div[data-open][role="button"]')) { e.preventDefault(); e.target.click(); }
  });
  document.addEventListener("click", function(e) { if (!e.target.closest(".cv-view-wrap")) { var w = document.getElementById("cvViewWrap"); if (w) w.classList.remove("open"); } });
  document.addEventListener("mouseover", cvBoardHoverTrack);
  window.addEventListener("resize", function() { if (CANVAS.view === "editor") cvLayoutStage(); });

  window.DS_PANELS.canvas = cvCargarAreas;

})();
;
(function() {
  function api(url) { return window.dsFetchJSON(url); }
  function postJSON(url, body) { return window.dsPostJSON(url, body); }
  function esc(v) { return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  // ============ Protocols: PDF completos, buscables por diapositiva y filtrados por área ============
  // Un protocolo se ve en sus áreas (o en todas si es General). El texto de cada diapositiva se extrae
  // en el navegador (pdf.js) al subirlo; las diapositivas se dibujan desde el PDF guardado.
  var PR = { areas: [], areaId: null, q: '', items: [], edita: false, docs: {}, busq: null, seq: 0 };
  // Estrella: protocolos marcados por esta persona. Si hay marcados en el área, se busca solo en ellos.
  // Es personal y dura solo mientras la página esté abierta (se quita al recargar).
  var PR_MARCADOS = {};
  function prMarcadosArea() { return PR.items.filter(function(p) { return PR_MARCADOS[p.id]; }); }
  function prPintarSolo() {
    var cont = document.getElementById('prSolo'), m = prMarcadosArea();
    if (!m.length) { cont.style.display = 'none'; cont.innerHTML = ''; return; }
    cont.style.display = '';
    cont.innerHTML = '<span>★ Buscando solo en:</span>';
    m.forEach(function(p) {
      var c = document.createElement('span'); c.className = 'c'; c.textContent = p.titulo;
      var x = document.createElement('button'); x.type = 'button'; x.textContent = '✕'; x.title = 'Quitar la estrella';
      x.onclick = function() { prMarcar2(p.id, false); };
      c.appendChild(x); cont.appendChild(c);
    });
    var q = document.createElement('button'); q.type = 'button'; q.className = 'quitar'; q.textContent = 'Quitar todas';
    q.onclick = function() { m.forEach(function(p) { delete PR_MARCADOS[p.id]; }); prRefrescar(); };
    cont.appendChild(q);
  }
  function prMarcar2(id, on) { if (on) PR_MARCADOS[id] = true; else delete PR_MARCADOS[id]; prRefrescar(); }
  function prRefrescar() { prPintarSolo(); if (PR.q.trim()) buscar(); else renderLista(); }
  function prBotonEstrella(p) {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'pr-star' + (PR_MARCADOS[p.id] ? ' on' : '');
    b.textContent = PR_MARCADOS[p.id] ? '★' : '☆';
    b.title = PR_MARCADOS[p.id] ? 'Quitar la estrella' : 'Marcar: al buscar, solo se busca en los protocolos marcados';
    b.onclick = function(e) { e.stopPropagation(); prMarcar2(p.id, !PR_MARCADOS[p.id]); };
    return b;
  }
  function prNorm(t) { return Array.from(String(t || '')).map(function(c) { return (c.normalize('NFD')[0] || c).toLowerCase(); }).join(''); }
  function prPalabras(q) { return prNorm(q).split(/\s+/).filter(function(w) { return w.length >= 2; }); }
  function prMarcar(texto, palabras) {
    var n = prNorm(texto), marcas = [];
    palabras.forEach(function(w) { var i = n.indexOf(w); while (i >= 0) { marcas.push([i, i + w.length]); i = n.indexOf(w, i + w.length); } });
    marcas.sort(function(a, b) { return a[0] - b[0]; });
    var out = '', k = 0;
    marcas.forEach(function(m) { if (m[0] < k) return; out += esc(texto.slice(k, m[0])) + '<mark>' + esc(texto.slice(m[0], m[1])) + '</mark>'; k = m[1]; });
    return out + esc(texto.slice(k));
  }
  function prPost(url, opts) {
    return fetch(url, opts).catch(function() { throw new Error('Se perdió la conexión con el servidor. Intenta de nuevo.'); }).then(function(r) {
      return r.text().then(function(t) {
        var d = null; try { d = JSON.parse(t); } catch (e) {}
        if (!r.ok) throw new Error((d && d.detail) || ('El servidor respondió con un error (' + r.status + '). Intenta de nuevo.'));
        if (!d) throw new Error('Respuesta inesperada del servidor. Intenta de nuevo.');
        return d;
      });
    });
  }
  function prTam(b) { return b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }

  function cargarAreas() {
    window.dsAreas().catch(function(e) { prErrorGrid('No se pudieron cargar las áreas: ' + e.message, cargarAreas); return null; }).then(function(areas) {
      if (!areas) return;
      // Cada equipo ve su área y la pareja (N2↔Face, N3↔N6); null = todas (admins, Support, sin equipo)
      var permitidas = window.DS_INICIO && window.DS_INICIO.prAreas;
      if (permitidas) areas = areas.filter(function(a) { return permitidas.indexOf(a.id) >= 0; });
      PR.areas = areas;
      var actual = window.dsAreaActual && window.dsAreaActual();
      if (!PR.areaId || !areas.some(function(a) { return a.id === PR.areaId; })) {
        PR.areaId = areas.some(function(a) { return a.id === actual; }) ? actual : (areas[0] && areas[0].id);
      }
      renderTabs();
      cargarProtocolos();
    });
  }
  function renderTabs() {
    var tabs = document.getElementById('prAreaTabs'); tabs.innerHTML = '';
    PR.areas.forEach(function(a) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = a.nombre;
      b.className = 'pr-tab' + (a.id === PR.areaId ? ' activo' : '');
      b.onclick = function() { PR.areaId = a.id; renderTabs(); cargarProtocolos(); };
      tabs.appendChild(b);
    });
    var area = PR.areas.find(function(a) { return a.id === PR.areaId; });
    document.getElementById('prSearch').placeholder = 'Busca una palabra en los protocolos de ' + (area ? area.nombre : 'esta área') + ' (ej. tissue)...';
  }
  function prErrorGrid(msg, reintentar) {
    var grid = document.getElementById('prGrid');
    grid.innerHTML = '<div class="pr-empty"><span></span> <button type="button" class="btn mini">Reintentar</button></div>';
    grid.querySelector('span').textContent = msg;
    grid.querySelector('button').onclick = reintentar;
  }
  function cargarProtocolos() {
    var areaId = PR.areaId;
    if (!PR.items.length) document.getElementById('prGrid').innerHTML = '<div class="pr-empty">Cargando…</div>';
    api('/design/api/protocolos?area_id=' + areaId).catch(function(e) {
      if (areaId === PR.areaId) prErrorGrid('No se pudieron cargar los protocolos: ' + e.message, cargarProtocolos);
      return null;
    }).then(function(r) {
      if (!r) return;
      if (areaId !== PR.areaId) return;
      PR.items = r.protocolos || []; PR.edita = !!r.puedeEditar;
      document.getElementById('prHerr').style.display = PR.edita ? '' : 'none';
      prPintarSolo();
      if (PR.q.trim()) buscar(); else renderLista();
    });
  }

  // ---- PDF: se carga una vez por protocolo y se dibujan las diapositivas que se ven en pantalla ----
  function prDoc(id) {
    if (!PR.docs[id]) PR.docs[id] = window.dsPdfjs().then(function() {
      return pdfjsLib.getDocument({url: '/design/api/protocolos/' + id + '/pdf', isEvalSupported: false, disableStream: true, disableAutoFetch: true, rangeChunkSize: 262144}).promise;
    })
      .catch(function(e) { delete PR.docs[id]; throw e; });
    return PR.docs[id];
  }
  // Resalta en la diapositiva las palabras buscadas (ubicación a partir del texto del PDF).
  function prResaltar(page, viewport, ctx, palabras) {
    if (!palabras || !palabras.length) return Promise.resolve();
    return page.getTextContent().then(function(tc) {
      ctx.save(); ctx.fillStyle = 'rgba(250, 204, 21, 0.42)';
      tc.items.forEach(function(it) {
        if (!it.str) return;
        var n = prNorm(it.str), tx = pdfjsLib.Util.transform(viewport.transform, it.transform);
        var alto = Math.hypot(tx[2], tx[3]), ancho = it.width * viewport.scale, x = tx[4], y = tx[5];
        palabras.forEach(function(w) {
          var i = n.indexOf(w);
          while (i >= 0) {
            ctx.fillRect(x + ancho * i / n.length - 1, y - alto * 1.02, ancho * w.length / n.length + 2, alto * 1.3);
            i = n.indexOf(w, i + w.length);
          }
        });
      });
      ctx.restore();
    });
  }
  function prDibujar(canvas, id, pagina, anchoCss, palabras) {
    return prDoc(id).then(function(pdf) { return pdf.getPage(Math.min(Math.max(1, pagina), pdf.numPages)); }).then(function(page) {
      var base = page.getViewport({scale: 1}), dpr = window.devicePixelRatio || 1;
      var escala = anchoCss / base.width, vp = page.getViewport({scale: escala * dpr});
      canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
      canvas.style.width = Math.round(vp.width / dpr) + 'px'; canvas.style.height = Math.round(vp.height / dpr) + 'px';
      var ctx = canvas.getContext('2d');
      // Tope de 16 Mpx por lienzo (más grande queda en blanco en Safari/iPad y dispara la memoria).
      var px = vp.width * vp.height;
      if (px > 16e6) {
        vp = page.getViewport({scale: escala * dpr * Math.sqrt(16e6 / px)});
        canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
      }
      return page.render({canvasContext: ctx, viewport: vp}).promise
        .then(function() { return prResaltar(page, vp, ctx, palabras); })
        .then(function() { page.cleanup(); });
    });
  }
  // Miniaturas: se dibujan al aparecer en pantalla, de a pocas a la vez.
  var prCola = [], prActivos = 0;
  function prEncolar(job) { prCola.push(job); prSiguiente(); }
  function prSiguiente() {
    while (prActivos < 3 && prCola.length) {
      var job = prCola.shift(); prActivos++;
      job().catch(function() {}).then(function() { prActivos--; prSiguiente(); });
    }
  }
  var prObs = ('IntersectionObserver' in window) ? new IntersectionObserver(function(ents) {
    ents.forEach(function(e) { if (e.isIntersecting) { prObs.unobserve(e.target); e.target._dibujar(); } });
  }, {rootMargin: '300px'}) : null;
  // guardar: la primera diapositiva sin búsqueda se sube como imagen pequeña; la próxima vez la tarjeta
  // muestra esa imagen y no abre el PDF (abrir cada PDF es lo que hacía lenta la lista).
  function prMiniatura(thumb, id, pagina, palabras, guardar) {
    var seq = PR.seq;
    thumb.innerHTML = '<span class="pr-cargando">Cargando…</span>';
    thumb._dibujar = function() {
      prEncolar(function() {
        if (seq !== PR.seq) return Promise.resolve();
        var c = document.createElement('canvas');
        return prDibujar(c, id, pagina, Math.max(260, thumb.clientWidth || 300), palabras).then(function() {
          if (guardar) prSubirMiniatura(id, c);
          if (seq !== PR.seq) return;
          thumb.innerHTML = ''; thumb.appendChild(c); c.style.width = '100%'; c.style.height = 'auto';
          if (thumb._pag) thumb.appendChild(thumb._pag);
        }, function() { thumb.innerHTML = '<span class="pr-cargando">No se pudo abrir el PDF</span>'; });
      });
    };
    if (prObs) prObs.observe(thumb); else thumb._dibujar();
  }
  function prSubirMiniatura(id, canvas) {
    try {
      var ancho = Math.min(560, canvas.width), alto = Math.round(canvas.height * ancho / canvas.width);
      var c2 = document.createElement('canvas'); c2.width = ancho; c2.height = alto;
      var ctx = c2.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, ancho, alto); ctx.drawImage(canvas, 0, 0, ancho, alto);
      c2.toBlob(function(b) {
        if (b && b.size < 400 * 1024) fetch('/design/api/protocolos/' + id + '/miniatura', {method: 'POST', headers: {'Content-Type': 'image/jpeg'}, body: b}).catch(function() {});
      }, 'image/jpeg', 0.82);
    } catch (e) {}
  }
  function prMiniaturaGuardada(thumb, p) {
    var img = new Image(); img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
    img.style.width = '100%'; img.style.height = 'auto'; img.style.display = 'block';
    img.onerror = function() { prMiniatura(thumb, p.id, 1, null, true); };  // si falla, como antes: desde el PDF
    img.src = '/design/api/protocolos/' + p.id + '/miniatura?v=' + p.archivoId;
    thumb.innerHTML = ''; thumb.appendChild(img);
  }
  function prTeclado(card, nombre) {
    card.tabIndex = 0; card.setAttribute('role', 'button'); card.setAttribute('aria-label', 'Abrir ' + nombre);
    card.addEventListener('keydown', function(e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target === card) { e.preventDefault(); card.click(); }
    });
  }
  function prChips(p) {
    if (!p.areas.length) return '<span class="pr-chip general">General</span>';
    return p.areas.map(function(a) { return '<span class="pr-chip">' + esc(a.nombre) + '</span>'; }).join('');
  }

  // ---- Sin búsqueda: todos los protocolos del área ----
  function renderLista() {
    PR.seq++; prCola = []; if (prObs) prObs.disconnect();
    var grid = document.getElementById('prGrid');
    var area = PR.areas.find(function(a) { return a.id === PR.areaId; });
    document.getElementById('prCuenta').textContent = PR.items.length + (PR.items.length === 1 ? ' protocolo' : ' protocolos') + ' en ' + (area ? area.nombre : '');
    if (!PR.items.length) {
      grid.innerHTML = '<div class="pr-empty">Todavía no hay protocolos para esta área.' + (PR.edita ? ' Usa “⬆ Subir protocolos (PDF)”.' : '') + '</div>';
      return;
    }
    grid.innerHTML = ''; var cont = document.createElement('div'); cont.className = 'pr-grid'; grid.appendChild(cont);
    PR.items.forEach(function(p) {
      var card = document.createElement('div'); card.className = 'pr-card';
      card.innerHTML = '<div class="pr-thumb"></div><div class="pr-card-body"><div class="pr-titulo"></div>' +
        '<div class="pr-sub"></div><div class="pr-chips">' + prChips(p) + '</div></div>';
      card.querySelector('.pr-titulo').textContent = p.titulo;
      card.querySelector('.pr-sub').textContent = (p.tieneArchivo ? p.paginas + ' diapositivas · ' + prTam(p.tamano) : 'Protocolo de texto') + (p.version ? ' · ' + p.version : '');
      var th = card.querySelector('.pr-thumb');
      if (p.tieneArchivo && p.miniatura) prMiniaturaGuardada(th, p);
      else if (p.tieneArchivo) prMiniatura(th, p.id, 1, null, true);
      else th.innerHTML = '<span class="pr-texto-ico">📄</span>';
      if (PR.edita) {
        var acc = document.createElement('div'); acc.className = 'pr-acc';
        acc.innerHTML = '<button type="button" title="Editar título y áreas">✎</button><button type="button" title="Eliminar (va a la Papelera)">🗑</button>';
        acc.children[0].onclick = function(e) { e.stopPropagation(); prEditar(p); };
        acc.children[1].onclick = function(e) { e.stopPropagation(); prEliminar(p); };
        card.appendChild(acc);
      }
      card.appendChild(prBotonEstrella(p));
      if (PR_MARCADOS[p.id]) card.classList.add('marcado');
      card.onclick = function() { prAbrirVisor(p.id, 1, null); };
      prTeclado(card, p.titulo);
      cont.appendChild(card);
    });
  }

  // ---- Con búsqueda: las diapositivas donde aparece la palabra ----
  var prTimer = null;
  document.getElementById('prSearch').addEventListener('input', function() {
    PR.q = this.value; clearTimeout(prTimer);
    prTimer = setTimeout(function() { if (PR.q.trim()) buscar(); else renderLista(); }, 280);
  });
  function buscar() {
    var q = PR.q.trim(), areaId = PR.areaId;
    if (!prPalabras(q).length) { renderLista(); document.getElementById('prCuenta').textContent = 'Escribe al menos 2 letras.'; return; }
    var solo = prMarcadosArea().map(function(p) { return p.id; }).join(',');
    document.getElementById('prCuenta').textContent = 'Buscando…';
    api('/design/api/protocolos/buscar?area_id=' + areaId + '&q=' + encodeURIComponent(q) + (solo ? '&solo=' + solo : '')).catch(function(e) {
      if (q === PR.q.trim() && areaId === PR.areaId) { document.getElementById('prCuenta').textContent = ''; prErrorGrid('No se pudo buscar: ' + e.message, buscar); }
      return null;
    }).then(function(r) {
      if (!r) return;
      if (q !== PR.q.trim() || areaId !== PR.areaId) return;
      PR.busq = {q: q, palabras: prPalabras(q), res: r.resultados || []};
      renderResultados(r);
    });
  }
  function renderResultados(r) {
    PR.seq++; prCola = []; if (prObs) prObs.disconnect();
    var grid = document.getElementById('prGrid'), res = PR.busq.res, palabras = PR.busq.palabras;
    var area = PR.areas.find(function(a) { return a.id === PR.areaId; });
    var grupos = [];
    res.forEach(function(x) { var g = grupos[grupos.length - 1]; if (!g || g.id !== x.protocoloId) grupos.push(g = {id: x.protocoloId, titulo: x.titulo, items: []}); g.items.push(x); });
    var nMarc = prMarcadosArea().length, donde = nMarc ? (nMarc === 1 ? 'el protocolo marcado' : 'los ' + nMarc + ' protocolos marcados') : 'los protocolos de ' + (area ? area.nombre : 'esta área');
    document.getElementById('prCuenta').textContent = res.length
      ? r.total + (r.total === 1 ? ' diapositiva' : ' diapositivas') + ' con “' + PR.busq.q + '” en ' + (nMarc ? donde : grupos.length + (grupos.length === 1 ? ' protocolo' : ' protocolos') + ' de ' + (area ? area.nombre : '')) + (r.total > res.length ? ' (se muestran las primeras ' + res.length + ')' : '')
      : '';
    if (!res.length) { grid.innerHTML = '<div class="pr-empty">No se encontró “' + esc(PR.busq.q) + '” en ' + esc(donde) + '.</div>'; return; }
    grid.innerHTML = '';
    grupos.forEach(function(g) {
      var sec = document.createElement('div'); sec.className = 'pr-grupo';
      sec.innerHTML = '<div class="pr-grupo-h"><b></b><span></span></div><div class="pr-grid"></div>';
      sec.querySelector('b').textContent = g.titulo;
      var pg0 = PR.items.find(function(x) { return x.id === g.id; });
      if (pg0) { var st = prBotonEstrella(pg0); st.style.position = 'static'; st.style.boxShadow = 'none'; st.style.width = '24px'; st.style.height = '24px'; st.style.fontSize = '16px'; sec.querySelector('.pr-grupo-h').insertBefore(st, sec.querySelector('b')); }
      sec.querySelector('span').textContent = g.items.length + (g.items.length === 1 ? ' diapositiva' : ' diapositivas');
      var cont = sec.querySelector('.pr-grid');
      g.items.forEach(function(x) {
        var card = document.createElement('div'); card.className = 'pr-card';
        card.innerHTML = '<div class="pr-thumb"></div><div class="pr-card-body"><div class="pr-frag"></div></div>';
        card.querySelector('.pr-frag').innerHTML = prMarcar(x.fragmento, palabras);
        var th = card.querySelector('.pr-thumb');
        if (x.pagina) {
          var pag = document.createElement('span'); pag.className = 'pr-pag'; pag.textContent = 'Diapositiva ' + x.pagina;
          th._pag = pag; prMiniatura(th, x.protocoloId, x.pagina, palabras);
        } else th.innerHTML = '<span class="pr-texto-ico">📄</span>';
        card.onclick = function() { prAbrirVisor(x.protocoloId, x.pagina || 1, PR.busq); };
        prTeclado(card, x.titulo + (x.pagina ? ', diapositiva ' + x.pagina : ''));
        cont.appendChild(card);
      });
      grid.appendChild(sec);
    });
  }

  // ---- Visor: protocolo completo, en la diapositiva elegida ----
  var PV = {id: null, pagina: 1, total: 0, zoom: 1, palabras: null, coinc: [], p: null, dibujo: 0};
  var prVisorTok = 0;
  function prAbrirVisor(id, pagina, busq) {
    var tok = ++prVisorTok;
    api('/design/api/protocolos/' + id).catch(function(e) { window.dsToast('⚠️ No se pudo abrir el protocolo: ' + e.message); return null; }).then(function(p) {
      if (!p || tok !== prVisorTok) return;
      PV = {id: id, pagina: pagina || 1, total: p.paginas || 0, zoom: 1, palabras: busq ? busq.palabras : null, coinc: [], p: p, dibujo: 0};
      if (busq) PV.coinc = busq.res.filter(function(x) { return x.protocoloId === id && x.pagina; });
      document.getElementById('prVisorTitulo').textContent = p.titulo;
      var dl = document.getElementById('prVisorDescargar');
      dl.style.display = p.tieneArchivo ? '' : 'none'; dl.href = '/design/api/protocolos/' + id + '/pdf';
      document.getElementById('prVisor').classList.add('open');
      prVisorLista(); prVisorPintar();
    });
  }
  function prVisorLista() {
    var l = document.getElementById('prVisorLista');
    if (!PV.coinc.length) { l.style.display = 'none'; return; }
    l.style.display = '';
    l.innerHTML = '<div class="h">Coincidencias (' + PV.coinc.length + ')</div>';
    PV.coinc.forEach(function(x) {
      var b = document.createElement('button'); b.type = 'button'; b.dataset.pag = x.pagina;
      b.innerHTML = '<b>Diapositiva ' + x.pagina + '</b><br>' + prMarcar(x.fragmento, PV.palabras);
      b.onclick = function() { PV.pagina = x.pagina; prVisorPintar(); };
      l.appendChild(b);
    });
  }
  function prVisorPintar() {
    var stage = document.getElementById('prVisorStage'), p = PV.p;
    document.querySelectorAll('#prVisorLista button').forEach(function(b) { b.classList.toggle('activo', +b.dataset.pag === PV.pagina); });
    var act = document.querySelector('#prVisorLista button.activo'); if (act) act.scrollIntoView({block: 'nearest'});
    var i = PV.coinc.findIndex(function(x) { return x.pagina === PV.pagina; });
    document.getElementById('prVisorCoinc').textContent = PV.coinc.length ? (i >= 0 ? 'Coincidencia ' + (i + 1) + ' de ' + PV.coinc.length : PV.coinc.length + ' coincidencias') : '';
    if (!p.tieneArchivo) {
      document.getElementById('prVisorPos').textContent = '';
      ['prVisorAnt', 'prVisorSig', 'prVisorMenos', 'prVisorMas'].forEach(function(b) { document.getElementById(b).style.display = 'none'; });
      stage.innerHTML = '<div class="pr-visor-texto"></div>';
      stage.firstChild.innerHTML = PV.palabras ? prMarcar(p.contenido || p.descripcion || '', PV.palabras) : esc(p.contenido || p.descripcion || '');
      return;
    }
    ['prVisorAnt', 'prVisorSig', 'prVisorMenos', 'prVisorMas'].forEach(function(b) { document.getElementById(b).style.display = ''; });
    document.getElementById('prVisorPos').textContent = 'Diapositiva ' + PV.pagina + ' de ' + PV.total;
    document.getElementById('prVisorAnt').disabled = PV.pagina <= 1;
    document.getElementById('prVisorSig').disabled = PV.pagina >= PV.total;
    var c = document.createElement('canvas'), pag = PV.pagina, id = PV.id, tok = ++PV.dibujo;
    prDoc(id).then(function(pdf) { return pdf.getPage(pag); }).then(function(page) {
      if (tok !== PV.dibujo) return;
      var vp = page.getViewport({scale: 1});
      var ancho = Math.min((stage.clientWidth - 36) / vp.width, (stage.clientHeight - 36) / vp.height) * vp.width * PV.zoom;
      return prDibujar(c, id, pag, Math.max(300, ancho), PV.palabras).then(function() {
        if (tok === PV.dibujo) { stage.innerHTML = ''; stage.appendChild(c); }
      });
    }).catch(function() { if (tok === PV.dibujo) stage.innerHTML = '<div class="pr-visor-texto">No se pudo abrir el PDF.</div>'; });
  }
  function prVisorIr(d) { var n = PV.pagina + d; if (n >= 1 && n <= PV.total) { PV.pagina = n; prVisorPintar(); } }
  function prVisorCerrar() { document.getElementById('prVisor').classList.remove('open'); document.getElementById('prVisorStage').innerHTML = ''; }
  document.getElementById('prVisorAnt').onclick = function() { prVisorIr(-1); };
  document.getElementById('prVisorSig').onclick = function() { prVisorIr(1); };
  document.getElementById('prVisorMas').onclick = function() { PV.zoom = Math.min(3, PV.zoom * 1.2); prVisorPintar(); };
  document.getElementById('prVisorMenos').onclick = function() { PV.zoom = Math.max(0.4, PV.zoom / 1.2); prVisorPintar(); };
  document.getElementById('prVisorCerrar').onclick = prVisorCerrar;
  document.addEventListener('keydown', function(e) {
    if (!document.getElementById('prVisor').classList.contains('open')) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); prVisorCerrar(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); prVisorIr(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); prVisorIr(1); }
  }, true);
  var prRz = null;
  window.addEventListener('resize', function() {
    clearTimeout(prRz);
    prRz = setTimeout(function() { if (document.getElementById('prVisor').classList.contains('open')) prVisorPintar(); }, 150);
  });

  // ---- Áreas (casillas) para subir y editar ----
  function prAreasHtml(marcadas) {
    return '<div class="pr-areas-sel">' + PR.areas.map(function(a) {
      return '<label><input type="checkbox" value="' + a.id + '"' + (marcadas.indexOf(a.id) >= 0 ? ' checked' : '') + '> ' + esc(a.nombre) + '</label>';
    }).join('') + '</div>';
  }
  function prAreasLeer(bg) { return Array.from(bg.querySelectorAll('.pr-areas-sel input:checked')).map(function(i) { return +i.value; }); }
  function prModal(html, ancho) {
    var bg = document.createElement('div'); bg.className = 'ds-qc-bg'; bg.id = 'prModal';
    bg.innerHTML = '<div class="ds-qc" role="dialog" aria-modal="true" style="width:' + (ancho || 560) + 'px">' + html + '</div>';
    document.body.appendChild(bg);
    var cerrar = function() { if (bg._ocupado) return; bg.remove(); document.removeEventListener('keydown', esc1, true); };
    var esc1 = function(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(); } };
    document.addEventListener('keydown', esc1, true);
    bg.addEventListener('mousedown', function(e) { if (e.target === bg) cerrar(); });
    bg._cerrar = cerrar;
    return bg;
  }

  // ---- Subir: uno o varios PDF; el texto de cada diapositiva se lee aquí con pdf.js ----
  var fileInput = document.getElementById('prFileInput');
  window.prSubirAbrir = function() { fileInput.value = ''; fileInput.click(); };
  fileInput.addEventListener('change', function() { if (this.files.length) prSubirForm(Array.from(this.files)); });
  document.getElementById('ov-protocols').addEventListener('dragover', function(e) { if (PR.edita && e.dataTransfer && Array.from(e.dataTransfer.types).indexOf('Files') >= 0) e.preventDefault(); });
  document.getElementById('ov-protocols').addEventListener('drop', function(e) {
    if (!PR.edita || !e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault();
    var pdfs = Array.from(e.dataTransfer.files).filter(function(f) { return /\.pdf$/i.test(f.name) || f.type === 'application/pdf'; });
    if (pdfs.length) prSubirForm(pdfs);
  });
  function prSubirForm(files) {
    var bg = prModal('<h4>Subir protocolos (PDF)</h4><div class="ds-qc-sub">Cada PDF queda como un protocolo. Se guarda completo y se puede buscar por diapositiva.</div>' +
      '<label class="pr-lbl">Título de cada protocolo</label><div class="pr-form-lista"></div>' +
      '<label class="pr-lbl">¿En qué áreas se verán?</label>' + prAreasHtml([PR.areaId]) +
      '<label class="pr-lbl" for="prVer">Versión</label><input type="text" id="prVer" value="v1.0" style="width:120px;margin:0 0 10px">' +
      '<div class="pr-espacio" id="prEspacio">Calculando espacio…</div>' +
      '<div class="ds-qc-err" id="prErr"></div>' +
      '<div class="ds-qc-btns"><button type="button" class="btn gris" data-b="no">Cancelar</button><button type="button" class="btn" data-b="si">Subir</button></div>', 620);
    var lista = bg.querySelector('.pr-form-lista');
    // Espacio: en el plan gratuito de Supabase la base completa (toda la intranet) tiene 500 MB.
    var suma = files.reduce(function(a, f) { return a + (f.size <= 120 * 1048576 ? f.size : 0); }, 0);
    api('/design/api/protocolos/espacio').then(function(e) {
      var el = bg.querySelector('#prEspacio'); if (!el) return;
      if (e.baseBytes == null) { el.textContent = 'Estos archivos suman ' + prTam(suma) + '.'; return; }
      var despues = e.baseBytes + suma;
      el.textContent = 'Base de datos: ' + prTam(e.baseBytes) + ' usados (PDF de protocolos: ' + prTam(e.pdfBytes) + '). Estos archivos suman ' + prTam(suma) + ' → quedaría en ' + prTam(despues) + '.';
      if (despues > 450 * 1048576) {
        el.classList.add('alerta');
        el.textContent += ' ⚠️ Si el plan de Supabase es el gratuito (500 MB para toda la intranet), no alcanzaría y la intranet quedaría en solo lectura. Confirma el plan antes de subir.';
      }
    }).catch(function() { var el = bg.querySelector('#prEspacio'); if (el) el.textContent = 'Estos archivos suman ' + prTam(suma) + '.'; });
    files.forEach(function(f) {
      var fila = document.createElement('div'); fila.className = 'pr-form-fila';
      fila.innerHTML = '<input type="text" maxlength="255"><span class="tam"></span><span class="est"></span>';
      fila.querySelector('input').value = f.name.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim();
      fila.querySelector('.tam').textContent = prTam(f.size);
      if (f.size > 120 * 1048576) { fila.querySelector('.est').textContent = '⚠️ Supera 120 MB'; fila.querySelector('.est').style.color = '#dc2626'; }
      fila._file = f; lista.appendChild(fila);
    });
    bg.querySelector('[data-b="no"]').onclick = bg._cerrar;
    bg.querySelector('[data-b="si"]').onclick = function() {
      var areas = prAreasLeer(bg), err = bg.querySelector('#prErr'), btn = this;
      if (!areas.length) { err.textContent = 'Elige al menos un área.'; return; }
      err.textContent = ''; btn.disabled = true; bg.querySelector('[data-b="no"]').disabled = true; bg._ocupado = true;
      var filas = Array.from(lista.children), fallos = 0, ok = 0;
      filas.reduce(function(prom, fila) {
        return prom.then(function() {
          var est = fila.querySelector('.est'), f = fila._file;
          if (f.size > 120 * 1048576) { fallos++; return; }
          est.style.color = '#1d4ed8'; est.textContent = 'Leyendo…';
          return window.dsPdfjs().then(function() { return f.arrayBuffer(); }).then(function(buf) {
            return pdfjsLib.getDocument({data: new Uint8Array(buf), isEvalSupported: false}).promise.then(function(pdf) {
              var textos = [], n = pdf.numPages;
              var leer = function(i) {
                if (i > n) return Promise.resolve();
                est.textContent = 'Leyendo ' + i + '/' + n + '…';
                return pdf.getPage(i).then(function(pg) { return pg.getTextContent(); }).then(function(tc) {
                  textos.push(tc.items.map(function(it) { return (it.str || '') + (it.hasEOL ? '\n' : ' '); }).join('').replace(/[ \t]+/g, ' ').trim());
                  return leer(i + 1);
                });
              };
              return leer(1).then(function() { pdf.destroy(); return prSubirPorPartes(f, est); }).then(function(archivoId) {
                est.textContent = 'Guardando…';
                return prPost('/design/api/protocolos/subida/' + archivoId + '/finalizar', {method: 'POST', headers: {'Content-Type': 'application/json'},
                  body: JSON.stringify({titulo: fila.querySelector('input').value.trim() || f.name, areas: areas,
                                        version: bg.querySelector('#prVer').value.trim() || 'v1.0', paginas: textos})});
              });
            });
          }).then(function() { ok++; est.style.color = '#16a34a'; est.textContent = '✓ Listo'; },
                  function(e) { fallos++; est.style.color = '#dc2626'; est.textContent = '⚠️ ' + (e && e.message ? e.message : 'Error'); });
        });
      }, Promise.resolve()).then(function() {
        bg._ocupado = false; bg.querySelector('[data-b="no"]').disabled = false;
        bg.querySelector('[data-b="no"]').textContent = 'Cerrar'; btn.style.display = 'none';
        err.style.color = fallos ? '#dc2626' : '#16a34a';
        err.textContent = ok + ' subido(s)' + (fallos ? ', ' + fallos + ' con error' : '') + '.';
        cargarProtocolos();
      });
    };
  }

  // Sube el PDF en trozos de 4 MB (cada envío es liviano; si uno falla por la red, se reintenta).
  function prSubirPorPartes(f, est) {
    return prPost('/design/api/protocolos/subida', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({nombre: f.name, tamano: f.size})}).then(function(r) {
      var parte = r.parte, total = Math.ceil(f.size / parte);
      var enviar = function(i, intento) {
        if (i >= total) return Promise.resolve(r.archivoId);
        est.textContent = 'Subiendo ' + Math.round(i * 100 / total) + '%…';
        var ini = i * parte;
        return prPost('/design/api/protocolos/subida/' + r.archivoId + '/parte?offset=' + ini,
          {method: 'POST', headers: {'Content-Type': 'application/octet-stream'}, body: f.slice(ini, ini + parte)})
          .then(function() { return enviar(i + 1, 0); }, function(e) {
            if (intento >= 2) throw e;
            return new Promise(function(ok) { setTimeout(ok, 1500 * (intento + 1)); }).then(function() { return enviar(i, intento + 1); });
          });
      };
      return enviar(0, 0);
    });
  }

  function prEditar(p) {
    var bg = prModal('<h4>Editar protocolo</h4><div class="ds-qc-sub"></div>' +
      '<label class="pr-lbl" for="prEdTit">Título</label><input type="text" id="prEdTit" maxlength="255" style="width:100%;margin:0 0 10px;box-sizing:border-box">' +
      '<label class="pr-lbl">¿En qué áreas se verá?</label>' + prAreasHtml(p.areas.map(function(a) { return a.id; })) +
      '<label class="pr-lbl" for="prEdVer">Versión</label><input type="text" id="prEdVer" style="width:120px;margin:0 0 10px">' +
      '<div class="ds-qc-err" id="prErr"></div>' +
      '<div class="ds-qc-btns"><button type="button" class="btn gris" data-b="no">Cancelar</button><button type="button" class="btn" data-b="si">Guardar</button></div>');
    bg.querySelector('.ds-qc-sub').textContent = p.tieneArchivo ? p.archivo + ' · ' + p.paginas + ' diapositivas' : 'Protocolo de texto';
    bg.querySelector('#prEdTit').value = p.titulo; bg.querySelector('#prEdVer').value = p.version || '';
    bg.querySelector('[data-b="no"]').onclick = bg._cerrar;
    bg.querySelector('[data-b="si"]').onclick = function() {
      var areas = prAreasLeer(bg);
      if (!areas.length) { bg.querySelector('#prErr').textContent = 'Elige al menos un área.'; return; }
      prPost('/design/api/protocolos/' + p.id, {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({titulo: bg.querySelector('#prEdTit').value, areas: areas, version: bg.querySelector('#prEdVer').value})})
        .then(function() { bg._cerrar(); cargarProtocolos(); })
        .catch(function(e) { bg.querySelector('#prErr').textContent = e.message; });
    };
  }
  function prEliminar(p) {
    if (!confirm('¿Eliminar el protocolo "' + p.titulo + '"? Un líder puede restaurarlo desde la Papelera.')) return;
    prPost('/design/api/protocolos/' + p.id + '/eliminar', {method: 'POST'}).then(function() { delete PR.docs[p.id]; cargarProtocolos(); })
      .catch(function(e) { alert(e.message); });
  }

  window.DS_PANELS.protocols = cargarAreas;

})();
;
(function() {
  var MODULOS = {"pa-sheet":"Pre-Approved · hoja", "pa-centro":"Pre-Approved · centro",
                "pa-doctor":"Pre-Approved · doctor", "pa-fila":"Pre-Approved · criterio", "perf-emp":"Desempeño · persona", "openings-fila":"Openings · fila", "openings-col":"Openings · columna",
                "protocol":"Protocolo", "cv-doc":"Canvas · hoja", "cmt-template":"Comments · plantilla",
                "faq-hoja":"Comments N2/Face · hoja", "faq-fila":"Comments N2/Face · situación", "faq-col":"Comments N2/Face · columna"};

  function postJSON(url) {
    return fetch(url, {method:'POST'}).then(function(r) {
      if (!r.ok) return r.json().then(function(e) { throw new Error(e.detail || 'Error'); });
      return r.json();
    });
  }
  function esc(v) { return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function cargar() {
    window.dsFetchJSON('/design/api/papelera').then(render).catch(function(e) {
      var list = document.getElementById('trList');
      list.innerHTML = '<div class="tr-empty"></div>';
      list.firstChild.textContent = 'No se pudo cargar la papelera: ' + e.message;
    });
  }

  function render(items) {
    var list = document.getElementById('trList');
    if (!items.length) {
      list.innerHTML = '<div class="tr-empty">No hay borrados registrados.<br>Cuando alguien elimine algo en Design Schedule (Pre-Approved, Comments, Canvas, Protocols…), aparecerá aquí para poder restaurarlo.</div>';
      return;
    }
    list.innerHTML = items.map(function(it) {
      return '<div class="tr-item">' +
        '<div class="tr-ico">🗑️</div>' +
        '<div class="tr-main">' +
          '<div class="tr-label"><span class="tr-badge">' + esc(MODULOS[it.modulo] || it.modulo) + '</span>' + esc(it.etiqueta) + '</div>' +
          '<div class="tr-meta">Eliminado por <b>' + esc(it.eliminado_por) + '</b> · ' + esc(it.eliminado_en) + '</div>' +
        '</div>' +
        '<div class="tr-actions">' +
          '<button type="button" class="tr-restore" data-restore="' + it.id + '">↺ Restaurar</button>' +
          (TR_ES_ADMIN ? '<button type="button" class="tr-perma" data-perma="' + it.id + '" title="Eliminar del historial (permanente)" aria-label="Eliminar del historial">✕</button>' : '') +
        '</div>' +
      '</div>';
    }).join('');

    list.querySelectorAll('[data-restore]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var b = this; if (b.disabled) return; b.disabled = true; // evita restaurar dos veces con doble clic
        postJSON('/design/api/papelera/' + this.dataset.restore + '/restaurar')
          .then(function() { cargar(); })
          .catch(function(e) { b.disabled = false; alert(e.message); });
      });
    });
    list.querySelectorAll('[data-perma]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        if (!confirm('¿Eliminar esta entrada del historial? Ya no se podrá restaurar.')) return;
        postJSON('/design/api/papelera/' + this.dataset.perma + '/eliminar')
          .then(function() { cargar(); })
          .catch(function(e) { alert(e.message); });
      });
    });
  }

  // El botón solo existe para managers/admins (el panel Papelera no se dibuja para otros roles).
  var trVaciarBtn = document.getElementById('trVaciarBtn');
  if (trVaciarBtn) trVaciarBtn.addEventListener('click', function() {
    if (!confirm('¿Vaciar todo el historial de la papelera? Esta acción no se puede deshacer.')) return;
    postJSON('/design/api/papelera/vaciar').then(function() { cargar(); }).catch(function(e) { alert(e.message); });
  });

  window.DS_PANELS.papelera = cargar;
  var TR_ES_ADMIN = window.DS_CFG.esAdmin; // vaciar y borrar para siempre: solo admins

})();
;
(function() {
  function api(url) { return window.dsFetchJSON(url); }
  function postJSON(url, body) { return window.dsPostJSON(url, body); }
  function esc(v) { return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  var PF = { sheets: [], sheetId: null, mesIdx: 0, detalle: null };

  // Hojas agrupadas por área según el inicio del nombre ("N3 Paula" -> N3 Prosthetic, lista "Paula"), igual que
  // en Horario. Las que no empiezan con un prefijo de área (DESIGN MANAGERS, SELECCION...) quedan como botones sueltos.
  // No hay área guardada en la BD: una hoja nueva "N3 Carlos" cae sola en N3.
  var PF_GRUPOS = [
    {id: 'Face', nombre: 'Face Design'}, {id: 'N2', nombre: 'N2 Demodenture'},
    {id: 'N3', nombre: 'N3 Prosthetic'}, {id: 'N6', nombre: 'N6 Material Changes'},
  ];
  function grupoDe(nombre) {
    var m = /^\s*(Face|N2|N3|N6)\s+(.+)$/i.exec(nombre || '');
    if (!m) return null;
    var g = PF_GRUPOS.find(function(x) { return x.id.toLowerCase() === m[1].toLowerCase(); });
    return g ? {grupo: g, corto: m[2].trim()} : null;
  }

  function cargarSheets() {
    api('/design/api/perf/sheets').then(function(sheets) {
      PF.sheets = sheets;
      var cont = document.getElementById('pfSheetTabs'); cont.innerHTML = '';
      PF_GRUPOS.forEach(function(g) {
        var items = sheets.filter(function(s) { var x = grupoDe(s.nombre); return x && x.grupo === g; })
                          .map(function(s) { return {id: s.id, nombre: grupoDe(s.nombre).corto}; });
        if (!items.length) return; // áreas sin hojas (Support) no se muestran
        var drop = dsDropArea(g, 'pf-tab', function() {
          if (drop.classList.contains('open')) { dsDropCerrar(); return; }
          dsDropRenderItems(drop, items, PF.sheetId, 'Sin equipos', seleccionarSheet);
          dsDropAbrir(drop);
        });
        drop.dataset.grupo = g.id;
        cont.appendChild(drop);
      });
      sheets.filter(function(s) { return !grupoDe(s.nombre); }).forEach(function(s) {
        var btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'pf-tab'; btn.dataset.sheet = s.id;
        btn.innerText = s.nombre;
        btn.onclick = function() { dsDropCerrar(); seleccionarSheet(s.id); };
        cont.appendChild(btn);
      });
      // Al reabrir el panel se conserva la hoja elegida; el aprobador entra directo a la de su equipo; un admin elige.
      var propia = sheets.find(function(s) { return s.propia; });
      if (PF.sheetId && sheets.some(function(s) { return s.id === PF.sheetId; })) seleccionarSheet(PF.sheetId);
      else if (propia) seleccionarSheet(propia.id);
      else { PF.sheetId = null; marcarSheet(); }
    });
  }

  function marcarSheet() {
    var s = PF.sheets.find(function(x) { return x.id === PF.sheetId; });
    var g = s && grupoDe(s.nombre);
    document.querySelectorAll('#pfSheetTabs > .ds-drop').forEach(function(d) {
      d.querySelector('.pf-tab').classList.toggle('activo', !!(g && d.dataset.grupo === g.grupo.id));
    });
    document.querySelectorAll('#pfSheetTabs > button[data-sheet]').forEach(function(b) {
      b.classList.toggle('activo', !!s && parseInt(b.dataset.sheet) === s.id);
    });
    document.getElementById('pfTituloHoja').innerText = s ? ' (' + s.nombre + ')' : '';
    document.getElementById('pfSinHoja').style.display = s ? 'none' : '';
    document.getElementById('pfPanel').style.display = s ? '' : 'none';
  }

  // Mes actual ("Sep 2026"); si la hoja es de otro año, el mismo mes de su año (las hojas van de enero a diciembre).
  var PF_MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  function mesActualIdx(meses) {
    var hoy = new Date(), etiqueta = PF_MESES[hoy.getMonth()] + ' ' + hoy.getFullYear();
    var i = meses.indexOf(etiqueta);
    if (i >= 0) return i;
    i = meses.findIndex(function(m) { return m.split(' ')[0] === PF_MESES[hoy.getMonth()]; });
    return i >= 0 ? i : 0;
  }

  function seleccionarSheet(sheetId) {
    PF.sheetId = sheetId;
    PF.mesIdx = null; // se fija al mes actual cuando llegan los datos de la hoja
    marcarSheet();
    var s = PF.sheets.find(function(x) { return x.id === sheetId; });
    if (!s) return;
    if (s.tipo === 'eval') cargarEval();
    else cargarSeleccion();
  }

  function selectMeses(meses, onchange) {
    var sel = document.createElement('select');
    meses.forEach(function(m, i) {
      var op = document.createElement('option'); op.value = i; op.innerText = m;
      if (i === PF.mesIdx) op.selected = true;
      sel.appendChild(op);
    });
    sel.onchange = function() { PF.mesIdx = parseInt(this.value); onchange(); };
    return sel;
  }

  function pfFallo(recargar) { return function(e) { window.dsToast('⚠️ No se guardó: ' + e.message); recargar(); }; }
  function cargarEval() {
    var sid = PF.sheetId;
    api('/design/api/perf/sheets/' + sid + '/eval').then(function(d) {
      if (sid !== PF.sheetId) return; // cambió de hoja mientras cargaba
      PF.detalle = d;
      if (PF.mesIdx === null || PF.mesIdx >= d.meses.length) PF.mesIdx = mesActualIdx(d.meses);
      renderEval(d);
    });
  }

  // Porcentaje por nivel (mismo criterio que PERF_PORCENTAJE_NIVEL en services_design.py).
  // Todos los criterios pesan igual; sin calificar = 0 %. Total general = promedio de los meses calificados.
  var PF_PCT = {ALTO: 100, SOBRESALIENTE: 95, MEDIO: 50, BAJO: 0, '': 0};
  function pfTotales(emp, d) {
    var n = d.criterios.length, totales = [], calificados = [];
    d.meses.forEach(function(m, i) {
      var suma = 0, alguno = false;
      d.criterios.forEach(function(c) { var v = emp.celdas[c.id + '_' + i]; var nv = v ? v.nivel : ''; if (nv) alguno = true; suma += PF_PCT[nv] || 0; });
      var t = n ? suma / n / 100 : 0;
      totales.push(t); if (alguno) calificados.push(t);
    });
    emp.totalesMes = totales;
    emp.total = calificados.length ? calificados.reduce(function(a, b) { return a + b; }, 0) / calificados.length : 0;
  }

  function pfPct(f) { return ((f || 0) * 100).toFixed(1).replace(/\.0$/, '') + '%'; }

  // ---------- Preferencias de cada persona (solo en su navegador): vista, meses ocultos y anchos por hoja ----------
  var PF_UI_KEY = 'pf_ui_v1';
  function pfUiTodo() { try { return JSON.parse(localStorage.getItem(PF_UI_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function pfUi(sid) { var t = pfUiTodo(); var u = t[sid] || {}; u.ocultos = u.ocultos || []; u.anchos = u.anchos || {}; return u; }
  function pfUiGuardar(sid, u) { try { var t = pfUiTodo(); t[sid] = u; localStorage.setItem(PF_UI_KEY, JSON.stringify(t)); } catch (e) {} }
  function pfVista() { try { return localStorage.getItem('pf_vista') || 'anio'; } catch (e) { return 'anio'; } }
  function pfSetVista(v) { try { localStorage.setItem('pf_vista', v); } catch (e) {} }
  function pfMesesVisibles(meses, u) { return meses.map(function(m, i) { return i; }).filter(function(i) { return u.ocultos.indexOf(i) < 0; }); }
  var PF_ANCHO = {num: 34, crit: 230, res: 146, score: 62, total: 84, ev: 190, post: 150, pscore: 70, pnota: 280};
  function pfAncho(u, clave) { return u.anchos[clave] || PF_ANCHO[clave]; }
  function pfCol(u, clave) { return '<col data-clave="' + clave + '" style="width:' + pfAncho(u, clave) + 'px">'; }
  function pfRz(clave) { return '<span class="pf-rz" data-rz="' + clave + '" title="Arrastra para ajustar el ancho"></span>'; }

  // Barra: Año completo / Un mes, selector de mes (solo en "Un mes") y "Mostrar ocultos".
  function pfBarra(d, alCambiar) {
    var toolbar = document.createElement('div'); toolbar.className = 'pf-toolbar';
    var vista = document.createElement('span'); vista.className = 'pf-vista'; vista.setAttribute('role', 'group'); vista.setAttribute('aria-label', 'Vista');
    [['anio', 'Año completo'], ['mes', 'Un mes']].forEach(function(o) {
      var b = document.createElement('button'); b.type = 'button'; b.innerText = o[1];
      b.className = pfVista() === o[0] ? 'activo' : ''; b.setAttribute('aria-pressed', pfVista() === o[0] ? 'true' : 'false');
      b.onclick = function() { pfSetVista(o[0]); alCambiar(); };
      vista.appendChild(b);
    });
    toolbar.appendChild(vista);
    if (pfVista() === 'mes') {
      var label = document.createElement('span'); label.innerText = 'Mes:'; toolbar.appendChild(label);
      toolbar.appendChild(selectMeses(d.meses, alCambiar));
    } else {
      var u = pfUi(PF.sheetId);
      if (u.ocultos.length) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'btn gris mini';
        b.innerText = '👁 Mostrar ' + u.ocultos.length + (u.ocultos.length === 1 ? ' mes oculto' : ' meses ocultos');
        b.onclick = function() { u.ocultos = []; pfUiGuardar(PF.sheetId, u); alCambiar(); };
        toolbar.appendChild(b);
      }
    }
    return toolbar;
  }
  function pfEncMes(nombre, i) {
    return '<span>' + esc(nombre) + '</span> <button type="button" class="pf-ocultar" data-ocultar="' + i + '" title="Ocultar este mes" aria-label="Ocultar ' + esc(nombre) + '">🚫</button>';
  }
  // Delegación: ocultar mes y ajustar anchos (una sola vez por panel).
  (function() {
    var panel = document.getElementById('pfPanel');
    if (!panel) return;
    panel.addEventListener('click', function(e) {
      var b = e.target.closest('[data-ocultar]'); if (!b) return;
      var u = pfUi(PF.sheetId), i = parseInt(b.dataset.ocultar);
      if (u.ocultos.indexOf(i) < 0) u.ocultos.push(i);
      pfUiGuardar(PF.sheetId, u);
      if (PF.detalle) (PF.detalle.tipo === 'eval' ? renderEval : renderSeleccion)(PF.detalle);
    });
    panel.addEventListener('mousedown', function(e) {
      var h = e.target.closest('.pf-rz'); if (!h) return;
      e.preventDefault();
      var clave = h.dataset.rz, u = pfUi(PF.sheetId), x0 = e.clientX, w0 = pfAncho(u, clave);
      var mover = function(ev) {
        var w = Math.max(30, Math.round(w0 + ev.clientX - x0));
        panel.querySelectorAll('col[data-clave="' + clave + '"]').forEach(function(c) { c.style.width = w + 'px'; });
        u.anchos[clave] = w;
      };
      var soltar = function() { document.removeEventListener('mousemove', mover); document.removeEventListener('mouseup', soltar); pfUiGuardar(PF.sheetId, u); };
      document.addEventListener('mousemove', mover); document.addEventListener('mouseup', soltar);
    });
  })();

  function renderEval(d) {
    if (pfVista() === 'mes') { renderEvalMes(d); return; }
    var panel = document.getElementById('pfPanel');
    panel.innerHTML = '';
    panel.appendChild(pfBarra(d, function() { renderEval(d); }));
    var u = pfUi(PF.sheetId), vis = pfMesesVisibles(d.meses, u), nC = d.criterios.length;
    var niveles = ['', 'BAJO', 'MEDIO', 'SOBRESALIENTE', 'ALTO'];
    var html = '';
    d.empleados.forEach(function(emp, ei) {
      var ro = emp.editable === false;
      var cols = pfCol(u, 'num') + pfCol(u, 'crit');
      vis.forEach(function() { cols += pfCol(u, 'res') + pfCol(u, 'score'); });
      cols += pfCol(u, 'total');
      var h = '<thead><tr><th rowspan="2">#' + pfRz('num') + '</th><th rowspan="2">Requerimiento' + pfRz('crit') + '</th>';
      vis.forEach(function(i) { h += '<th colspan="2" class="pf-mes-h">' + pfEncMes(d.meses[i], i) + '</th>'; });
      h += '<th rowspan="2">Total general' + pfRz('total') + '</th></tr><tr>';
      vis.forEach(function() { h += '<th>Resultado' + pfRz('res') + '</th><th>Score' + pfRz('score') + '</th>'; });
      h += '</tr></thead><tbody>';
      d.criterios.forEach(function(c, ci) {
        h += '<tr><td class="pf-num">' + (ci + 1) + '</td><td class="pf-crit">' + esc(c.nombre) + '</td>';
        vis.forEach(function(i) {
          var v = emp.celdas[c.id + '_' + i] || {nivel: ''};
          h += '<td class="pf-res' + (v.nivel ? ' pf-nivel-' + v.nivel : '') + '"><select data-emp="' + ei + '" data-crit="' + c.id + '" data-mes="' + i + '"' +
               (ro ? ' disabled' : '') + ' aria-label="' + esc(c.nombre + ' — ' + d.meses[i] + ' — ' + emp.nombre) + '">' +
               niveles.map(function(n) { return '<option value="' + n + '"' + (n === v.nivel ? ' selected' : '') + '>' + (n || '—') + '</option>'; }).join('') +
               '</select></td><td class="pf-total" data-score="' + ei + '-' + c.id + '-' + i + '">' + (v.nivel ? (PF_PCT[v.nivel] || 0) + '%' : '') + '</td>';
        });
        if (ci === 0) h += '<td class="pf-total" rowspan="' + nC + '" data-total-gral="' + ei + '">' + pfPct(emp.total) + '</td>';
        h += '</tr>';
      });
      h += '<tr class="pf-fila-total"><td colspan="2">TOTAL SCORE</td>';
      vis.forEach(function(i) { h += '<td colspan="2" data-total-mes="' + ei + '-' + i + '">' + pfPct(emp.totalesMes[i]) + '</td>'; });
      h += '<td></td></tr><tr class="pf-fila-notas"><td colspan="2">Notas</td><td colspan="' + (vis.length * 2 + 1) + '">' +
           '<textarea data-nota="' + ei + '"' + (ro ? ' disabled' : '') + ' aria-label="Notas de ' + esc(emp.nombre) + '">' + esc(emp.nota || '') + '</textarea></td></tr></tbody>';
      html += '<div class="pf-emp' + (ro ? ' pf-solo-lectura' : '') + '"' + (ro ? ' title="Solo lectura: no puedes calificarte a ti mismo ni a personas de otros equipos."' : '') + '>' +
              '<h4 class="pf-emp-h">' + esc(emp.nombre) + '</h4><div class="pf-anual-wrap"><table class="pf-tabla pf-anual"><colgroup>' + cols + '</colgroup>' + h + '</table></div></div>';
    });
    var cont = document.createElement('div'); cont.innerHTML = html || '<p style="color:#4b5563">Esta hoja no tiene personas.</p>';
    panel.appendChild(cont);
    cont.addEventListener('change', function(e) {
      var sel = e.target.closest('select[data-emp]'); if (!sel) return;
      var emp = d.empleados[+sel.dataset.emp], cid = +sel.dataset.crit, mes = +sel.dataset.mes, nivel = sel.value, pct = PF_PCT[nivel] || 0;
      postJSON('/design/api/perf/celdas', {empleadoId: emp.id, criterioId: cid, mesIndice: mes, nivel: nivel, puntaje: pct}).catch(pfFallo(cargarEval));
      emp.celdas[cid + '_' + mes] = {nivel: nivel, puntaje: pct};
      sel.parentNode.className = 'pf-res' + (nivel ? ' pf-nivel-' + nivel : '');
      cont.querySelector('[data-score="' + sel.dataset.emp + '-' + cid + '-' + mes + '"]').innerText = nivel ? pct + '%' : '';
      pfTotales(emp, d);
      cont.querySelector('[data-total-mes="' + sel.dataset.emp + '-' + mes + '"]').innerText = pfPct(emp.totalesMes[mes]);
      cont.querySelector('[data-total-gral="' + sel.dataset.emp + '"]').innerText = pfPct(emp.total);
    });
    cont.addEventListener('focusout', function(e) {
      var ta = e.target.closest('textarea[data-nota]'); if (!ta) return;
      var emp = d.empleados[+ta.dataset.nota];
      if ((emp.nota || '') === ta.value) return;
      emp.nota = ta.value;
      postJSON('/design/api/perf/empleados/' + emp.id + '/nota', {nota: ta.value}).catch(pfFallo(cargarEval));
    });
  }

  function renderEvalMes(d) {
    var panel = document.getElementById('pfPanel');
    panel.innerHTML = '';
    panel.appendChild(pfBarra(d, function() { renderEval(d); }));

    var tabla = document.createElement('table'); tabla.className = 'pf-tabla';
    var head = '<thead><tr><th>Diseñador/a</th>';
    d.criterios.forEach(function(c) { head += '<th style="white-space:normal;min-width:110px">' + esc(c.nombre) + '</th>'; });
    head += '<th>Total mes</th><th>Total general</th><th>Notas</th></tr></thead>';
    tabla.innerHTML = head;

    var tbody = document.createElement('tbody');
    d.empleados.forEach(function(emp) {
      var tr = document.createElement('tr');
      var tdNombre = document.createElement('td'); tdNombre.className = 'pf-nombre'; tdNombre.innerText = emp.nombre;
      tr.appendChild(tdNombre);
      var tdMes = document.createElement('td'); tdMes.className = 'pf-total';
      var tdTotal = document.createElement('td'); tdTotal.className = 'pf-total';

      d.criterios.forEach(function(crit) {
        var key = crit.id + '_' + PF.mesIdx;
        var val = emp.celdas[key] || { nivel: '', puntaje: 0 };
        var td = document.createElement('td');
        var wrap = document.createElement('div'); wrap.className = 'pf-celda';
        var sel = document.createElement('select');
        ['', 'BAJO', 'MEDIO', 'SOBRESALIENTE', 'ALTO'].forEach(function(op) {
          var o = document.createElement('option'); o.value = op; o.innerText = op || '—';
          if (op === val.nivel) o.selected = true;
          sel.appendChild(o);
        });
        // Porcentaje del nivel: se llena solo y no se edita.
        var num = document.createElement('span'); num.className = 'pf-pct';
        num.innerText = (PF_PCT[val.nivel] || 0) + '%';
        function guardar() {
          var nivel = sel.value, pct = PF_PCT[nivel] || 0;
          postJSON('/design/api/perf/celdas', {
            empleadoId: emp.id, criterioId: crit.id, mesIndice: PF.mesIdx, nivel: nivel, puntaje: pct,
          }).catch(pfFallo(cargarEval));
          emp.celdas[key] = {nivel: nivel, puntaje: pct};
          num.innerText = pct + '%';
          td.className = nivel ? 'pf-nivel-' + nivel : '';
          pfTotales(emp, d);
          tdMes.innerText = pfPct(emp.totalesMes[PF.mesIdx]);
          tdTotal.innerText = pfPct(emp.total);
        }
        sel.onchange = guardar;
        sel.setAttribute('aria-label', crit.nombre + ' de ' + emp.nombre);
        if (emp.editable === false) sel.disabled = true;
        td.className = val.nivel ? 'pf-nivel-' + val.nivel : '';
        wrap.appendChild(sel); wrap.appendChild(num); td.appendChild(wrap);
        tr.appendChild(td);
      });

      tdMes.innerText = pfPct(emp.totalesMes[PF.mesIdx]);
      tr.appendChild(tdMes);
      tdTotal.innerText = pfPct(emp.total);
      tr.appendChild(tdTotal);

      var tdNota = document.createElement('td');
      var ta = document.createElement('textarea'); ta.className = 'pf-nota'; ta.value = emp.nota || '';
      ta.setAttribute('aria-label', 'Notas de ' + emp.nombre);
      if (emp.editable === false) {
        ta.disabled = true;
        tr.title = 'Solo lectura: no puedes calificarte a ti mismo ni a personas de otros equipos.';
        tr.classList.add('pf-solo-lectura');
      }
      ta.addEventListener('blur', function() {
        postJSON('/design/api/perf/empleados/' + emp.id + '/nota', { nota: this.value }).catch(pfFallo(cargarEval));
      });
      tdNota.appendChild(ta);
      tr.appendChild(tdNota);

      tbody.appendChild(tr);
    });
    tabla.appendChild(tbody);
    panel.appendChild(tabla);
  }

  function cargarSeleccion() {
    var sid = PF.sheetId;
    api('/design/api/perf/sheets/' + sid + '/seleccion').then(function(d) {
      if (sid !== PF.sheetId) return;
      PF.detalle = d;
      if (PF.mesIdx === null || PF.mesIdx >= d.meses.length) PF.mesIdx = mesActualIdx(d.meses);
      renderSeleccion(d);
    });
  }

  function renderSeleccion(d) {
    if (pfVista() === 'mes') { renderSeleccionMes(d); return; }
    var panel = document.getElementById('pfPanel');
    panel.innerHTML = '';
    panel.appendChild(pfBarra(d, function() { renderSeleccion(d); }));
    var u = pfUi(PF.sheetId), vis = pfMesesVisibles(d.meses, u);
    // Empleado del mes (solo admins: ellos deciden)
    var g = '<h3>Empleado del mes</h3><div class="pf-anual-wrap"><table class="pf-tabla pf-anual"><colgroup>' + pfCol(u, 'ev');
    vis.forEach(function() { g += pfCol(u, 'post'); });
    g += '</colgroup><thead><tr><th>Categoría' + pfRz('ev') + '</th>';
    vis.forEach(function(i) { g += '<th class="pf-mes-h">' + pfEncMes(d.meses[i], i) + pfRz('post') + '</th>'; });
    g += '</tr></thead><tbody>';
    if (d.verGanadores === false) g = '';
    else d.ganadores.forEach(function(w, wi) {
      g += '<tr><td class="pf-nombre">' + esc(w.categoria) + '</td>';
      vis.forEach(function(i) {
        g += '<td class="pf-lideres-in"><input class="pf-mini" data-gan="' + wi + '" data-mes="' + i + '" value="' + esc(w.ganadoresMes[i] || '') + '"' +
             (d.ganadoresEditables === false ? ' disabled title="Lo registra un administrador"' : '') +
             ' aria-label="' + esc(w.categoria + ' — ' + d.meses[i]) + '"></td>';
      });
      g += '</tr>';
    });
    if (d.verGanadores !== false) g += '</tbody></table></div>';
    // Evaluaciones por líder: por mes Persona nominada + Puntaje + Nota
    var l = '<div class="pf-seccion-h"><h3>Evaluaciones por líder</h3></div><div class="pf-anual-wrap"><table class="pf-tabla pf-anual"><colgroup>' + pfCol(u, 'ev');
    vis.forEach(function() { l += pfCol(u, 'post') + pfCol(u, 'pscore') + pfCol(u, 'pnota'); });
    l += '</colgroup><thead><tr><th rowspan="2">Evaluador/a' + pfRz('ev') + '</th>';
    vis.forEach(function(i) { l += '<th colspan="3" class="pf-mes-h">' + pfEncMes(d.meses[i], i) + '</th>'; });
    l += '</tr><tr>';
    vis.forEach(function() { l += '<th>Persona nominada' + pfRz('post') + '</th><th>Puntaje' + pfRz('pscore') + '</th><th>Nota' + pfRz('pnota') + '</th>'; });
    l += '</tr></thead><tbody>';
    d.filas.forEach(function(f, fi) {
      var ro = f.editable === false;
      l += '<tr' + (ro ? ' class="pf-solo-lectura" title="Solo lectura: cada líder edita su propia fila."' : '') + '><td class="pf-nombre">' + esc(f.evaluador) + '</td>';
      vis.forEach(function(i) {
        var c = f.celdas[i] || {persona: '', puntaje: '', nota: ''}, dis = ro ? ' disabled' : '', lab = esc(f.evaluador + ' — ' + d.meses[i]);
        l += '<td class="pf-lideres-in"><input class="pf-mini" data-fila="' + fi + '" data-mes="' + i + '" data-k="persona" value="' + esc(c.persona) + '"' + dis + ' aria-label="Persona nominada: ' + lab + '"></td>' +
             '<td class="pf-lideres-in"><input class="pf-mini" data-fila="' + fi + '" data-mes="' + i + '" data-k="puntaje" value="' + esc(c.puntaje) + '"' + dis + ' aria-label="Puntaje: ' + lab + '"></td>' +
             '<td class="pf-lideres-in"><textarea data-fila="' + fi + '" data-mes="' + i + '" data-k="nota"' + dis + ' aria-label="Nota: ' + lab + '">' + esc(c.nota) + '</textarea></td>';
      });
      l += '</tr>';
    });
    l += '</tbody></table></div>';
    var cont = document.createElement('div'); cont.innerHTML = g + l;
    panel.appendChild(cont);
    pfAjustarNotas(cont);
    cont.addEventListener('focusout', function(e) {
      var el = e.target;
      if (el.dataset.gan !== undefined) {
        var w = d.ganadores[+el.dataset.gan], i = +el.dataset.mes;
        if ((w.ganadoresMes[i] || '') === el.value) return;
        w.ganadoresMes[i] = el.value;
        postJSON('/design/api/perf/ganadores/' + w.id, {mesIndice: i, nombre: el.value}).catch(pfFallo(cargarSeleccion));
        return;
      }
      if (el.dataset.fila === undefined) return;
      var f = d.filas[+el.dataset.fila], mes = +el.dataset.mes;
      var c = f.celdas[mes] = f.celdas[mes] || {persona: '', puntaje: '', nota: ''};
      if ((c[el.dataset.k] || '') === el.value) return;
      c[el.dataset.k] = el.value;
      postJSON('/design/api/perf/filas/' + f.id + '/celdas', {mesIndice: mes, persona: c.persona || '', puntaje: c.puntaje || '', nota: c.nota || ''})
        .catch(pfFallo(cargarSeleccion));
    });
  }

  function renderSeleccionMes(d) {
    var panel = document.getElementById('pfPanel');
    panel.innerHTML = '';
    panel.appendChild(pfBarra(d, function() { renderSeleccion(d); }));

    var h2 = document.createElement('h3'); h2.innerText = 'Empleado del mes';
    var tablaGan = document.createElement('table'); tablaGan.className = 'pf-tabla';
    if (d.verGanadores !== false) panel.appendChild(h2);
    var headGan = '<thead><tr><th>Categoría</th>';
    d.meses.forEach(function(m) { headGan += '<th>' + esc(m) + '</th>'; });
    headGan += '</tr></thead>';
    tablaGan.innerHTML = headGan;
    var bodyGan = document.createElement('tbody');
    d.ganadores.forEach(function(g) {
      var tr = document.createElement('tr');
      var tdCat = document.createElement('td'); tdCat.className = 'pf-nombre'; tdCat.innerText = g.categoria;
      tr.appendChild(tdCat);
      d.meses.forEach(function(m, i) {
        var td = document.createElement('td');
        var inp = document.createElement('input'); inp.className = 'pf-mini'; inp.style.width = '120px';
        inp.value = g.ganadoresMes[i] || '';
        inp.setAttribute('aria-label', g.categoria + ' — ' + m);
        if (d.ganadoresEditables === false) { inp.disabled = true; inp.title = 'Lo registra un administrador'; }
        inp.addEventListener('blur', function() {
          postJSON('/design/api/perf/ganadores/' + g.id, { mesIndice: i, nombre: this.value }).catch(pfFallo(cargarSeleccion));
        });
        td.appendChild(inp); tr.appendChild(td);
      });
      bodyGan.appendChild(tr);
    });
    tablaGan.appendChild(bodyGan);
    if (d.verGanadores !== false) panel.appendChild(tablaGan);

    // Título y selector de mes en la misma fila (el mes al final), con el mismo espacio que "Empleado del mes".
    var cab = document.createElement('div'); cab.className = 'pf-seccion-h';
    var h3 = document.createElement('h3'); h3.innerText = 'Evaluaciones por líder'; cab.appendChild(h3);
    panel.appendChild(cab);

    var tabla = document.createElement('table'); tabla.className = 'pf-tabla pf-tabla-lideres';
    tabla.innerHTML = '<thead><tr><th>Evaluador/a</th><th>Persona nominada</th><th>Puntaje</th><th>Nota</th></tr></thead>';
    var tbody = document.createElement('tbody');
    d.filas.forEach(function(f) {
      var celda = f.celdas[PF.mesIdx] || { persona: '', puntaje: '', nota: '' };
      var tr = document.createElement('tr');
      var tdEv = document.createElement('td'); tdEv.className = 'pf-nombre'; tdEv.innerText = f.evaluador;
      tr.appendChild(tdEv);

      var tdPersona = document.createElement('td');
      var inpP = document.createElement('input'); inpP.className = 'pf-mini'; inpP.style.width = '140px'; inpP.value = celda.persona;
      tdPersona.appendChild(inpP); tr.appendChild(tdPersona);

      var tdScore = document.createElement('td');
      var inpS = document.createElement('input'); inpS.className = 'pf-mini'; inpS.style.width = '60px'; inpS.value = celda.puntaje;
      tdScore.appendChild(inpS); tr.appendChild(tdScore);

      var tdNota = document.createElement('td');
      var ta = document.createElement('textarea'); ta.className = 'pf-nota-sel'; ta.value = celda.nota;
      tdNota.appendChild(ta); tr.appendChild(tdNota);

      if (f.editable === false) {
        inpP.disabled = inpS.disabled = ta.disabled = true;
        tr.title = 'Solo lectura: cada líder edita su propia fila.';
        tr.classList.add('pf-solo-lectura');
      }
      inpP.setAttribute('aria-label', 'Persona nominada por ' + f.evaluador);
      inpS.setAttribute('aria-label', 'Puntaje de ' + f.evaluador);
      ta.setAttribute('aria-label', 'Nota de ' + f.evaluador);
      function guardar() {
        postJSON('/design/api/perf/filas/' + f.id + '/celdas', {
          mesIndice: PF.mesIdx, persona: inpP.value, puntaje: inpS.value, nota: ta.value,
        }).catch(pfFallo(cargarSeleccion));
      }
      inpP.addEventListener('blur', guardar);
      inpS.addEventListener('blur', guardar);
      ta.addEventListener('blur', guardar);

      tbody.appendChild(tr);
    });
    tabla.appendChild(tbody);
    panel.appendChild(tabla);
    pfAjustarNotas(tabla);
  }

  // Notas de Evaluaciones por líder: la celda crece con el texto (como Excel con ajuste de texto), sin barra para leer.
  function pfAutoAlto(ta) { ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight + 2) + 'px'; }
  function pfAjustarNotas(cont) {
    var tas = cont.querySelectorAll('td.pf-lideres-in textarea, textarea.pf-nota-sel');
    // al cambiar el ancho (ventana o arrastrando la columna) se vuelve a ajustar el alto
    var ro = window.ResizeObserver ? new ResizeObserver(function(es) {
      es.forEach(function(e) { if (e.target._pfAncho !== e.contentRect.width) { e.target._pfAncho = e.contentRect.width; pfAutoAlto(e.target); } });
    }) : null;
    tas.forEach(function(ta) {
      ta.classList.add('pf-nota-auto'); ta.addEventListener('input', function() { pfAutoAlto(ta); });
      if (ro) ro.observe(ta);
    });
    requestAnimationFrame(function() { tas.forEach(pfAutoAlto); });
  }

  window.DS_PANELS.perf = cargarSheets;

})();
;
(function() {
  window.DS_PANELS = window.DS_PANELS || {};

  var DS_PANELES_GESTION = ['dashboard', 'perf', 'papelera'];
  function dsAbrirPanel(id) {
    if (DS_PANELES_GESTION.indexOf(id) >= 0 && !window.DS_GESTION) {
      // un enlace ?panel=dashboard|perf|papelera no abre nada para un empleado
      try { var u = new URL(location.href); u.searchParams.delete('panel'); history.replaceState(null, '', u); } catch (e) {}
      return;
    }
    document.querySelectorAll('.ds-overlay.open').forEach(function(p) { p.classList.remove('open'); });
    var panel = document.getElementById('ov-' + id);
    if (!panel) return;
    if (window.cvCloseAdjust) window.cvCloseAdjust();
    if (!document.querySelector('.ds-overlay.open')) dsFocoPrevio = document.activeElement;
    panel.classList.add('open');
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true');
    var h1 = panel.querySelector('h1'); if (h1) { h1.id = h1.id || ('dsTit_' + id); panel.setAttribute('aria-labelledby', h1.id); }
    document.body.classList.add('ds-locked');
    var cerrar = panel.querySelector('.ds-overlay-close'); if (cerrar) cerrar.focus({preventScroll: true});
    if (window.DS_PANELS[id]) window.DS_PANELS[id]();
    try {
      var url = new URL(location.href);
      url.searchParams.set('panel', id);
      history.replaceState(null, '', url);
    } catch (e) {}
    dsActualizarPestana();
  }
  var dsFocoPrevio = null;
  function dsCerrarPaneles() {
    if (window.cvCloseAdjust) window.cvCloseAdjust();
    document.querySelectorAll('.ds-overlay.open').forEach(function(p) { p.classList.remove('open'); });
    document.body.classList.remove('ds-locked');
    if (dsFocoPrevio && dsFocoPrevio.isConnected && dsFocoPrevio.focus) { try { dsFocoPrevio.focus({preventScroll: true}); } catch (e) {} }
    dsFocoPrevio = null;
    try {
      var url = new URL(location.href);
      url.searchParams.delete('panel');
      history.replaceState(null, '', url);
    } catch (e) {}
    dsActualizarPestana();
  }
  // Nombre de la pestaña del navegador según dónde está el usuario: "Pre-Approved (N2 Daniel)",
  // "Comments", "Design Schedule (Team X)"... Toma el título del panel abierto (sin "— Design Schedule")
  // y el detalle entre paréntesis (hoja o equipo), y se actualiza solo cuando ese detalle cambia.
  function dsActualizarPestana() {
    var panel = document.querySelector('.ds-overlay.open');
    var h1 = panel ? panel.querySelector('h1') : document.querySelector('#dsTituloEquipo') && document.querySelector('#dsTituloEquipo').parentNode;
    if (!h1) return;
    var base = '', det = '';
    h1.childNodes.forEach(function(n) {
      if (n.nodeType === 3) base += n.textContent; else if (n.tagName === 'SPAN') det += n.textContent;
    });
    base = base.split(' — ')[0].trim();
    var titulo = (base + ' ' + det.trim()).trim();
    if (titulo && document.title !== titulo) document.title = titulo;
  }
  try {
    var dsObsTitulo = new MutationObserver(dsActualizarPestana);
    document.querySelectorAll('h1 > span[id]').forEach(function(sp) { dsObsTitulo.observe(sp, {childList: true, characterData: true, subtree: true}); });
  } catch (e) {}
  dsActualizarPestana();
  // Alto de la barra superior fija, para que los paneles empiecen justo debajo.
  var dsNav = document.querySelector('body > nav');
  function dsMedirNav() { document.documentElement.style.setProperty('--ds-nav-h', (dsNav ? dsNav.offsetHeight : 0) + 'px'); }
  dsMedirNav();
  window.addEventListener('resize', dsMedirNav);
  try { if (dsNav) new ResizeObserver(dsMedirNav).observe(dsNav); } catch (e) {}
  // Con la barra visible, sus enlaces cambian de panel sin recargar la página:
  // Herramientas/Gestión abren el panel y "Design Schedule" vuelve a la tabla principal.
  if (dsNav) dsNav.addEventListener('click', function(e) {
    var a = e.target.closest('a[href]');
    if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    var url; try { url = new URL(a.href, location.href); } catch (err) { return; }
    if (url.origin !== location.origin || url.pathname !== '/design') return;
    var panel = url.searchParams.get('panel');
    if (panel && !document.getElementById('ov-' + panel)) return;
    if (!panel && !document.querySelector('.ds-overlay.open')) return; // ya está en la tabla: navegación normal
    e.preventDefault();
    document.querySelectorAll('.nav-drop-menu.open').forEach(function(m) { m.classList.remove('open'); });
    if (panel) dsAbrirPanel(panel); else dsCerrarPaneles();
  });
  window.dsAbrirPanel = dsAbrirPanel;
  window.dsCerrarPaneles = dsCerrarPaneles;

  document.querySelectorAll('.ds-overlay-close').forEach(function(btn) {
    btn.addEventListener('click', dsCerrarPaneles);
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && document.querySelector('.ds-overlay.open')) dsCerrarPaneles();
  });

  var initialPanel = new URLSearchParams(location.search).get('panel');
  if (initialPanel) dsAbrirPanel(initialPanel);
})();
