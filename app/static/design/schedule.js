/* Design Schedule: código de la página (antes iba dentro de design_schedule.html, 500 KB en cada carga).
   Ahora el navegador lo guarda en caché. Los datos de la persona llegan en window.DS_CFG (lo arma la página).
   Cada bloque es el mismo <script> de antes, en el mismo orden. */
// ---------- Red: una sola función para todos los paneles de Design Schedule ----------
// Revisa el código de respuesta (antes varios paneles trataban un error 4xx/5xx como éxito) y da un
// mensaje claro si el servidor devuelve HTML (sesión vencida, error del proxy) en vez de JSON.
window.dsFetchJSON = function(url, opts) {
  // Peticiones lanzadas por la página antes de bajar este código (ver el script del inicio de design_schedule.html): se usan una
  // sola vez y solo si son recientes; si no, la petición se hace normal.
  var pre = !opts && window.DS_PRE && window.DS_PRE[url];
  if (pre) delete window.DS_PRE[url];
  return ((pre && Date.now() - pre.t < 15000) ? pre.p : fetch(url, opts || {})).catch(function() {
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
    var hb = document.getElementById('dsHistorialBtn'); if (hb) hb.classList.toggle('ds-fuera', !(DS.teamId || (chk && chk.checked)));
    var dl = document.getElementById('dsLatDias'); if (dl) dl.classList.toggle('ds-fuera', !(DS.teamId || (chk && chk.checked)));
    if (!(DS.teamId || (chk && chk.checked))) dsCalCerrar();
    // "Dejar a cargo" está junto al buscador: solo se ve con un equipo abierto (no en todas las áreas)
    document.getElementById('dsACargo').classList.toggle('ds-fuera', !DS.teamId || !!(chk && chk.checked));
    // "Producción" (aprobadores, admins y diseñadores, 23-oct-2026): con un equipo abierto; no se usa en Support
    var sinProd = !DS.teamId || !!(chk && chk.checked) || DS.areaFormato === 'support';
    document.getElementById('dsProdBtn').classList.toggle('ds-fuera', sinProd);
    if (sinProd) dsCerrarProduccion();   // su ventana no tendría datos que mostrar
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
    dsPintarDiasLat(function(idx) { DS.diaSel = idx; dsRenderDias(); dsCargarDia(); });
    dsCalSincronizar();
  }

  // Semana y días en la barra lateral (Rosember, 26-oct-2026): una sola fila con la flecha de semana anterior, los días como
  // «L 26», «M 27»… y la flecha de semana siguiente, y encima el rango de la semana. Con la barra abierta se ve la fila completa;
  // cerrada (46px) solo queda el día elegido. Sirven para la vista del equipo y para la de todas las áreas (`alElegir` cambia
  // según la vista). El día de hoy lleva un punto verde y el elegido va resaltado.
  var DS_LETRAS_DIAS = ['L', 'M', 'M', 'J', 'V'];
  var DS_SVG_LAT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  function dsPintarDiasLat(alElegir) {
    var cont = document.getElementById('dsLatDias'); if (!cont) return;
    var hoyISO = dsFechaISO(new Date());
    var foco = cont.contains(document.activeElement) ? (document.activeElement.dataset.nav || '') : null;   // para devolver el foco
    var fin = new Date(DS.lunes); fin.setDate(fin.getDate() + 4);
    var rango = dsRangoCorto(DS.lunes, fin);
    cont.innerHTML = '';
    var cap = document.createElement('span');   // encima de la fila: «26–30» (cerrada) / «Semana 26 - 30 de oct» (abierta)
    cap.className = 'ds-it ds-lat-rango'; cap.dataset.nav = 'rango'; cap.title = 'Semana ' + rango;
    cap.innerHTML = '<span class="ds-it-ico"></span><span class="ds-it-txt"></span>';
    cap.firstChild.textContent = DS.lunes.getDate() + '–' + fin.getDate(); cap.lastChild.textContent = 'Semana ' + rango;
    cont.appendChild(cap);
    var fila = document.createElement('div'); fila.className = 'ds-lat-fila'; fila.setAttribute('role', 'group'); fila.setAttribute('aria-label', 'Semana y días');
    cont.appendChild(fila);
    function boton(clase, nav, contenido, titulo, html) {
      var b = document.createElement('button'); b.type = 'button'; b.className = clase; b.dataset.nav = nav;
      b.title = titulo; b.setAttribute('aria-label', titulo);
      if (html) b.innerHTML = contenido; else b.textContent = contenido;
      fila.appendChild(b);
      return b;
    }
    boton('ds-lat-sem', 'ant', DS_SVG_LAT + '<polyline points="15 6 9 12 15 18"/></svg>', 'Semana anterior', true).onclick = function() { window.dsCambiarSemana(-7); };
    for (var i = 0; i < 5; i++) {
      var d = new Date(DS.lunes); d.setDate(d.getDate() + i);
      var largo = d.toLocaleDateString('es-CO', {weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'});
      var esHoy = dsFechaISO(d) === hoyISO;
      var btn = boton('ds-lat-dia' + (i === DS.diaSel ? ' activo' : '') + (esHoy ? ' hoy' : ''), 'd' + i, DS_LETRAS_DIAS[i] + ' ' + d.getDate(),
                      largo.charAt(0).toUpperCase() + largo.slice(1) + (esHoy ? ' (hoy)' : ''), false);
      btn.setAttribute('aria-pressed', i === DS.diaSel ? 'true' : 'false');
      btn.onclick = (function(idx) { return function() { alElegir(idx); }; })(i);
    }
    boton('ds-lat-sem', 'sig', DS_SVG_LAT + '<polyline points="9 6 15 12 9 18"/></svg>', 'Semana siguiente', true).onclick = function() { window.dsCambiarSemana(7); };
    if (foco !== null) {   // al repintar se pierde el foco: vuelve al mismo botón (o al día elegido)
      var f = (foco && cont.querySelector('[data-nav="' + foco + '"]')) || cont.querySelector('.activo');
      if (f && f.focus) f.focus({preventScroll: true});
    }
  }

  function dsFechaSeleccionada() {
    var d = new Date(DS.lunes); d.setDate(d.getDate() + DS.diaSel); return d;
  }

  // ---------- Historial: calendario para ir a cualquier día de producción (Rosember, 26-oct-2026) ----------
  // Reemplaza los selectores de Mes y de Semana. Se abre desde la barra lateral (botón «Historial»); solo se eligen días de
  // lunes a viernes, que son los del Schedule. Cambia la semana compartida (DS.lunes) y el día (DS.diaSel), igual que las flechas.
  function dsMesLabel(anio, mes) {
    var d = new Date(anio, mes, 1);
    var l = d.toLocaleDateString('es-CO', {month:'long', year:'numeric'});
    return l.charAt(0).toUpperCase() + l.slice(1);
  }
  var DS_CAL = {y: 0, m: 0, sel: ''};
  function dsIrAFecha(f) {
    DS.lunes = dsLunesDe(f); DS.diaSel = (f.getDay() + 6) % 7;
    dsRefrescarSemana();
  }
  // Historial: ventana centrada con el fondo oscurecido, como «Dejar a cargo» (27-oct-2026). Se cierra con la X, Esc o un clic en el fondo.
  function dsCalCerrar() {
    var bg = document.getElementById('dsCalBg'); if (bg) bg.remove();
    document.removeEventListener('keydown', dsCalEsc, true);
  }
  function dsCalEsc(e) {
    if (e.key !== 'Escape') return;
    e.stopPropagation(); dsCalCerrar();
    var b = document.getElementById('dsHistorialBtn'); if (b && b.focus) b.focus({preventScroll: true});
  }
  function dsCalPintar(enfocar) {
    var pop = document.getElementById('dsCalPop'); if (!pop) return;
    var y = DS_CAL.y, m = DS_CAL.m, sel = dsFechaISO(dsFechaSeleccionada()), hoy = dsFechaISO(new Date());
    var ultimo = new Date(y, m + 1, 0).getDate(), h = '';
    h += '<div class="ds-cal-cab"><button type="button" class="ds-cal-nav" data-cal-mes="-1" aria-label="Mes anterior">‹</button>' +
         '<b aria-live="polite">' + dsMesLabel(y, m) + '</b><button type="button" class="ds-cal-nav" data-cal-mes="1" aria-label="Mes siguiente">›</button></div>';
    h += '<div class="ds-cal-sem" aria-hidden="true">' + ['L', 'M', 'M', 'J', 'V'].map(function(d) { return '<span>' + d + '</span>'; }).join('') + '</div><div class="ds-cal-dias">';
    var primero = true;
    for (var dia = 1; dia <= ultimo; dia++) {
      var f = new Date(y, m, dia), dow = (f.getDay() + 6) % 7;   // 0 = lunes … 6 = domingo
      if (dow > 4) continue;                                     // sin fines de semana: el Schedule es de lunes a viernes
      if (primero) { for (var v = 0; v < dow; v++) h += '<span class="ds-cal-vacio"></span>'; primero = false; }
      var iso = dsFechaISO(f);
      h += '<button type="button" class="ds-cal-dia' + (iso === sel ? ' sel' : '') + (iso === hoy ? ' hoy' : '') + '" data-cal-dia="' + iso + '" aria-pressed="' + (iso === sel) + '" ' +
           'aria-label="' + f.toLocaleDateString('es-CO', {weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'}) + '">' + dia + '</button>';
    }
    h += '</div><div class="ds-cal-pie"><button type="button" class="btn mini gris" data-cal-hoy>Hoy</button></div>';
    pop.innerHTML = h;
    if (enfocar) { var b = pop.querySelector('.ds-cal-dia.sel') || pop.querySelector('.ds-cal-dia'); if (b) b.focus({preventScroll: true}); }
  }
  function dsCalAbrir(btn) {
    if (document.getElementById('dsCalPop')) { dsCalCerrar(); return; }
    var f = dsFechaSeleccionada(); DS_CAL.y = f.getFullYear(); DS_CAL.m = f.getMonth(); DS_CAL.sel = dsFechaISO(f);
    var bg = document.createElement('div'); bg.className = 'ds-qc-bg ds-fondo-50'; bg.id = 'dsCalBg';
    var pop = document.createElement('div'); pop.className = 'ds-cal-pop'; pop.id = 'dsCalPop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-modal', 'true'); pop.setAttribute('aria-label', 'Historial: elegir un día');
    bg.appendChild(pop); document.body.appendChild(bg); dsCalPintar(true);
    bg.addEventListener('mousedown', function(e) { if (e.target === bg) dsCalCerrar(); });
    pop.addEventListener('click', function(e) {
      var nav = e.target.closest('[data-cal-mes]'), dia = e.target.closest('[data-cal-dia]');
      if (nav) {
        var d = new Date(DS_CAL.y, DS_CAL.m + parseInt(nav.dataset.calMes, 10), 1); DS_CAL.y = d.getFullYear(); DS_CAL.m = d.getMonth();
        dsCalPintar(false); return;
      }
      if (dia) { var p = dia.dataset.calDia.split('-'); dsCalCerrar(); dsIrAFecha(new Date(+p[0], +p[1] - 1, +p[2])); return; }
      if (e.target.closest('[data-cal-hoy]')) { dsCalCerrar(); dsIrAHoy(); dsRefrescarSemana(); }
    });
    // Flechas del teclado entre los días (← → de a uno, ↑ ↓ de a una semana)
    pop.addEventListener('keydown', function(e) {
      var dias = Array.prototype.slice.call(pop.querySelectorAll('.ds-cal-dia')), i = dias.indexOf(document.activeElement);
      var paso = {ArrowLeft: -1, ArrowRight: 1, ArrowUp: -5, ArrowDown: 5}[e.key];
      if (i < 0 || !paso) return;
      e.preventDefault(); var d = dias[Math.max(0, Math.min(dias.length - 1, i + paso))]; if (d) d.focus();
    });
    document.addEventListener('keydown', dsCalEsc, true);
  }
  // Si cambia el día por otro camino (flechas de semana, buscador, «Hoy»), el calendario abierto lo sigue
  function dsCalSincronizar() {
    var pop = document.getElementById('dsCalPop'); if (!pop) return;
    var f = dsFechaSeleccionada(), iso = dsFechaISO(f);
    if (iso !== DS_CAL.sel) { DS_CAL.sel = iso; DS_CAL.y = f.getFullYear(); DS_CAL.m = f.getMonth(); }
    dsCalPintar(false);
  }
  (function() {
    var b = document.getElementById('dsHistorialBtn');
    if (b) b.addEventListener('click', function() { dsCalAbrir(b); });
  })();

  // Empleados y aprobadores: sin la fila de áreas y, si tienen más de un equipo, un selector "Mi equipo" junto a los contadores.
  (function dsSoloMio() {
    if (!window.DS_SOLO_MIO) return;
    var cont = document.getElementById('dsVistaNormal');
    if (cont && cont.parentNode) cont.parentNode.classList.add('ds-solo-mio');
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
      // Venir con ESC desde Módulos (?esc=1): los admins abren la vista donde están todos los schedules; los demás ya
      // entran a su propio equipo (arriba).
      if (URL_PARAMS.get('esc') === '1') {
        try { var u = new URL(location.href); u.searchParams.delete('esc'); history.replaceState(null, '', u); } catch (x) {}
        var chkTodas = document.getElementById('dsTodasAreasChk');
        if (chkTodas && !chkTodas.checked && !(area && teamId) && window.DS_CFG && window.DS_CFG.esAdmin) { chkTodas.checked = true; dsMostrarVista(true); }
      }
    }).catch(function(e) {
      if (window.dsSoltar) window.dsSoltar();
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
      else if (window.dsSoltar) window.dsSoltar();   // no hay día que esperar: se muestra la pantalla
    }).catch(function(e) { if (window.dsSoltar) window.dsSoltar(); throw e; });
  }

  // Muestra la orden encontrada en la búsqueda (Rosember, 22-oct-2026: «te lleva pero no la muestra»). Espera a que la
  // fila exista (la tabla se termina de pintar después), abre el panel plegado donde esté, la deja en el centro y la marca
  // con un borde ámbar que parpadea (se ve también en filas de color: Approved, Hold…). Se quita sola o con un clic.
  function dsMostrarResaltada(id, intento) {
    var tr = document.querySelector('#dsVistaEquipo tr[data-id="' + id + '"]');
    if (!tr) {
      if (intento < 20) setTimeout(function() { dsMostrarResaltada(id, intento + 1); }, 150);
      else dsToast('La orden no está en este día del Schedule (pudo pasar a otro día).');
      return;
    }
    for (var p = tr.parentElement; p; p = p.parentElement) {
      if (p.tagName === 'DETAILS' && !p.open) p.open = true;
      if (p.hidden && p.id !== 'dsVistaEquipo') p.hidden = false;
    }
    document.querySelectorAll('tr.ds-resaltada').forEach(function(x) { x.classList.remove('ds-resaltada'); });
    tr.classList.add('ds-resaltada');
    var suave = !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    var ir = function() { tr.scrollIntoView({block: 'center', behavior: suave ? 'smooth' : 'auto'}); };
    ir(); setTimeout(ir, 350);   // por si algo arriba terminó de cargar y la movió
    // La tabla puede volver a pintarse (en vivo, colores…) y la fila nueva no traería la marca: se repone mientras dure
    var sel = '#dsVistaEquipo tr[data-id="' + id + '"]', hasta = Date.now() + 10000, vigila = null;
    var quitar = function() {
      clearInterval(vigila); document.removeEventListener('click', quitar, true);
      document.querySelectorAll('tr.ds-resaltada').forEach(function(x) { x.classList.remove('ds-resaltada'); });
    };
    vigila = setInterval(function() {
      if (Date.now() > hasta) { quitar(); return; }
      var t = document.querySelector(sel); if (t && !t.classList.contains('ds-resaltada')) t.classList.add('ds-resaltada');
    }, 200);
    setTimeout(function() { document.addEventListener('click', quitar, true); }, 400);
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
  // Barra lateral derecha (Rosember, 26-oct-2026; inspirada en «Sidebar Navigation Animation» de Halal Lab): Producción,
  // Cambios digital y Dejar a cargo, cada una con su icono. En reposo solo iconos; al pasar el mouse (o con el foco del
  // teclado) se ensancha y los nombres entran en cascada; la muesca de la flecha la deja fija abierta o la cierra. Se
  // recoge al salir el mouse (si no está fija), con Esc, al hacer clic afuera o al usar una acción. Sin acciones visibles,
  // no se ve y el Schedule no reserva el margen de la derecha.
  (function() {
    var lat = document.getElementById('dsLateral'), panel = document.getElementById('dsLatPanel'), muesca = document.getElementById('dsLatMuesca');
    if (!lat) return;
    var SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
    var ICONOS = {
      prod: SVG + '<path d="M3 3v18h18"/><path d="M7 16v-4"/><path d="M12 16V8"/><path d="M17 16v-7"/></svg>',                       // gráfica de barras
      cambio: SVG + '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/></svg>', // intercambio
      hist: SVG + '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/></svg>',                                   // calendario
      cfg: SVG + '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>',   // controles
      cargo: SVG + '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M16 11l2 2 4-4"/></svg>',   // persona con visto
      comments: SVG + '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',                                 // globo de comentario
      preapproved: SVG + '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',         // casilla con visto
      canvas: SVG + '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>'   // imagen
    };
    var fijo = false, timer = null;
    function hayAcciones() {
      return Array.prototype.some.call(panel.children, function(el) { return !el.hidden && !el.classList.contains('ds-fuera'); });
    }
    // Cada acción: icono + nombre. «Dejar a cargo» se vuelve a dibujar con cada día: se arma de nuevo.
    function armar() {
      var i = 0;
      panel.querySelectorAll('.ds-prod-btn, #dsACargo > .btn, #dsACargo > .ds-acargo-chip').forEach(function(el) {
        if (!el.querySelector('.ds-it-ico')) {
          var txt = el.textContent.trim(), ico = el.dataset.latPanel || (el.id === 'dsProdBtn' ? 'prod' : el.id === 'dsCambioDigBtn' ? 'cambio' : el.id === 'dsHistorialBtn' ? 'hist' : el.id === 'dsConfigBtn' ? 'cfg' : 'cargo');
          el.classList.add('ds-it');
          if (!el.title) el.title = txt;
          el.innerHTML = '<span class="ds-it-ico">' + ICONOS[ico] + '</span><span class="ds-it-txt"></span>';
          el.lastChild.textContent = txt;
        }
        if (!el.hidden && !el.classList.contains('ds-fuera')) { if (el.style.getPropertyValue('--i') !== String(i)) el.style.setProperty('--i', i); i++; }
      });
    }
    function abrir() { clearTimeout(timer); lat.classList.add('abierto'); muesca.setAttribute('aria-expanded', 'true'); }
    function cerrar() {
      clearTimeout(timer); fijo = false; lat.classList.remove('abierto', 'fijo'); muesca.setAttribute('aria-expanded', 'false');
      muesca.title = 'Mostrar los nombres (deja la barra abierta)';
    }
    muesca.addEventListener('click', function() {
      if (fijo) { cerrar(); return; }
      fijo = true; lat.classList.add('fijo'); muesca.title = 'Cerrar la barra'; abrir();
    });
    if (window.matchMedia && window.matchMedia('(hover: hover)').matches) {
      lat.addEventListener('mouseenter', function() { clearTimeout(timer); timer = setTimeout(abrir, 60); });
      lat.addEventListener('mouseleave', function() { clearTimeout(timer); if (!fijo) timer = setTimeout(cerrar, 220); });
    }
    lat.addEventListener('focusin', abrir);
    lat.addEventListener('focusout', function(e) {
      if (fijo || lat.contains(e.relatedTarget)) return;
      // al repintar los días el botón enfocado desaparece y el foco se pierde: con el mouse encima no se cierra
      setTimeout(function() { if (!fijo && !lat.contains(document.activeElement) && !lat.matches(':hover')) cerrar(); }, 0);
    });
    panel.addEventListener('click', function(e) { if (e.target.closest('button') && !e.target.closest('.ds-lat-dia, .ds-lat-sem')) setTimeout(cerrar, 0); });   // los días y las flechas de semana no la cierran
    document.addEventListener('mousedown', function(e) { if (!lat.contains(e.target) && lat.classList.contains('abierto')) cerrar(); });
    lat.addEventListener('keydown', function(e) { if (e.key === 'Escape' && lat.classList.contains('abierto')) { e.stopPropagation(); cerrar(); muesca.focus(); } });
    function revisar() {
      armar();
      var v = hayAcciones(); lat.hidden = !v; if (!v) cerrar();
      var app = document.getElementById('ds-app'); if (app) app.classList.toggle('ds-con-lateral', v);   // la barra no tapa el contenido
    }
    try { new MutationObserver(revisar).observe(panel, {subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden']}); } catch (e) {}
    revisar();
    // Comments, Pre-Approved y Canvas (antes en «Tools»): abren el mismo panel que el enlace ?panel= de siempre
    panel.querySelectorAll('[data-lat-panel]').forEach(function(b) { b.addEventListener('click', function() { dsAbrirPanel(b.dataset.latPanel); }); });
  })();
  // ---------- Configuración del Schedule (Rosember, 26-oct-2026) ----------
  // Botón debajo de «Historial»: abre una ventana con los ajustes de personalización. Hoy: colores de los estados (antes el
  // interruptor de cada tabla) y, para managers y admins, los avisos de apoyo.
  (function() {
    var btn = document.getElementById('dsConfigBtn'), pop = document.getElementById('dsCfgPop'); if (!btn || !pop) return;
    // el interruptor de colores muestra lo que está guardado en este navegador
    document.querySelectorAll('.ds-auto-oc-chk').forEach(function(c) { c.checked = dsColoresFila(); });
    function cerrar() {
      pop.hidden = true; btn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('mousedown', fuera, true); document.removeEventListener('keydown', esc, true);
    }
    function fuera(e) { if (!pop.contains(e.target) && !e.target.closest('#dsConfigBtn')) cerrar(); }
    function esc(e) { if (e.key === 'Escape') { e.stopPropagation(); cerrar(); btn.focus({preventScroll: true}); } }
    function abrir() {
      pop.hidden = false; btn.setAttribute('aria-expanded', 'true');
      var r = btn.getBoundingClientRect();
      pop.style.top = Math.max(8, Math.min(window.innerHeight - pop.offsetHeight - 8, r.top)) + 'px';
      pop.style.left = Math.max(8, window.innerWidth - 46 - pop.offsetWidth - 10) + 'px';
      document.addEventListener('mousedown', fuera, true); document.addEventListener('keydown', esc, true);
    }
    btn.addEventListener('click', function() { if (pop.hidden) abrir(); else cerrar(); });
    var ap = document.getElementById('dsCfgApoyo');
    if (ap) {
      api('/design/api/preferencias/apoyo').then(function(d) { ap.checked = !!d.activo; }).catch(function() {});
      ap.addEventListener('change', function() {
        postJSON('/design/api/preferencias/apoyo', {activo: ap.checked}).then(function(d) { ap.checked = !!d.activo; })
          .catch(function(e) { ap.checked = !ap.checked; dsToast('⚠️ ' + e.message); });
      });
    }
  })();

  // ---------- Necesito apoyo (Rosember, 26-oct-2026) ----------
  // Botón en la fila de cada tabla (solo para el diseñador). Escribe una nota y se avisa por push a su manager o a quien
  // esté a cargo hoy; esa persona recibe la nota en la notificación.
  document.addEventListener('click', function(e) {
    var b = e.target.closest && e.target.closest('.ds-btn-apoyo');
    if (b) dsPedirApoyo(b.dataset.tabla || '');
  });
  function dsPedirApoyo(tabla) {
    if (!DS.teamId) return;
    var seccion = {principal: 'Cirugías', nightguard: 'Nightguards / TC', material: dsEsRD() ? 'Removable Denture' : 'Material Change', tibar: 'Over Ti-bar', dummy: 'Dummy'}[tabla] || 'Schedule';
    var html = '<h3>Pedir apoyo</h3><p class="dd-p-nota" style="margin:0 0 8px">Se le envía una notificación a tu manager (o a quien esté a cargo hoy) con tu nota. Sección: ' + dsEsc(seccion) + '.</p>' +
      '<textarea id="apoyo_nota" rows="3" maxlength="500" placeholder="Qué necesitas, por ejemplo: un caso que no alcanzo a sacar hoy" style="width:100%"></textarea>' +
      '<p id="apoyo_aviso" class="dd-p-nota" style="min-height:18px;margin:6px 0 0;color:#b91c1c"></p>';
    dcModal(html, function(f) {
      var nota = (document.getElementById('apoyo_nota').value || '').trim();
      var aviso = document.getElementById('apoyo_aviso');
      if (!nota) { aviso.textContent = 'Escribe la nota.'; f.querySelector('[data-m=si]').disabled = false; return; }
      window.dsPostJSON('/design/api/teams/' + DS.teamId + '/apoyo', {tabla: tabla, nota: nota}).then(function(r) {
        f.remove();
        dsToast(r.avisados.length ? '🙋 Aviso enviado a ' + r.avisados.join(', ') : 'Listo: no hay a quién avisar (o apagó los avisos de apoyo).');
      }, function(e) { f.querySelector('[data-m=si]').disabled = false; aviso.textContent = e.message; });
    }, 'Enviar');
    setTimeout(function() { var t = document.getElementById('apoyo_nota'); if (t) t.focus(); }, 30);
  }

  (function() {
    var inp = document.getElementById('dsBuscarInput'), res = document.getElementById('dsBuscarRes');
    if (!inp) return;
    var timer = null, tok = 0, caja = inp.closest('.ds-buscar'), logo = document.getElementById('dsBuscarLogo');
    function cerrar() { res.hidden = true; res.innerHTML = ''; }
    // Como Google: el logo se alarga en la barra; se recoge al salir sin nada escrito
    function abrir() { caja.classList.add('abierto'); logo.setAttribute('aria-expanded', 'true'); inp.tabIndex = 0; inp.focus({preventScroll: true}); }
    function recoger() {
      if (inp.value.trim()) return;
      caja.classList.remove('abierto'); logo.setAttribute('aria-expanded', 'false'); inp.tabIndex = -1; cerrar();
    }
    logo.addEventListener('click', function() { if (caja.classList.contains('abierto') && !inp.value.trim()) { recoger(); logo.focus(); } else abrir(); });
    caja.addEventListener('focusout', function(e) { if (!caja.contains(e.relatedTarget)) setTimeout(function() { if (!caja.contains(document.activeElement)) recoger(); }, 0); });
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
          b.onclick = function() { cerrar(); inp.value = ''; recoger(); dsIrACaso(x); };
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
      if (e.key === 'Escape') { inp.value = ''; recoger(); logo.focus(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (primero) primero.click(); }
      else if (e.key === 'ArrowDown' && primero) { e.preventDefault(); primero.focus(); }
    });
    res.addEventListener('keydown', function(e) {
      var items = Array.prototype.slice.call(res.querySelectorAll('.ds-buscar-item')), i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' && items[i + 1]) { e.preventDefault(); items[i + 1].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); (items[i - 1] || inp).focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); cerrar(); inp.focus(); }
    });
    document.addEventListener('mousedown', function(e) { if (!e.target.closest('.ds-buscar')) { cerrar(); recoger(); } });
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
    var rd = area.nombre === DS_AREA_RD;
    document.getElementById('dsPanelNightguard').style.display = (area.formato === 'dual' && !rd) ? '' : 'none';
    document.getElementById('dsPanelMaterial').style.display = (area.nombre === DS_AREA_MATERIAL || rd) ? '' : 'none';
    document.getElementById('dsPanelPrincipal').style.display = rd ? 'none' : '';
    document.getElementById('dsTituloMaterial').innerText = rd ? 'Removable Denture' : 'Material Change';
    // N6: «Cirugías/Dummy» (Rosember, 19-oct-2026)
    document.getElementById('dsTituloPrincipal').innerText = area.nombre === DS_AREA_MATERIAL ? 'Cirugías/Dummy' : (area.formato === 'dual') ? 'Cirugías' : 'Órdenes';
    document.getElementById('dsSinEquipo').style.display = 'none';
    document.getElementById('dsVistaEquipo').style.display = '';
    dsSeleccionarEquipo(teamId);
  }

  function dsActualizarTitulo() {
    var t = (DS.teams || []).find(function(x) { return x.id === DS.teamId; });
    var chk = document.getElementById('dsTodasAreasChk');
    var sp = document.getElementById('dsTituloEquipo'), h1 = sp.parentNode, equipo = (t && !(chk && chk.checked)) ? ' (' + t.nombre + ')' : '';
    // La pestaña sigue diciendo «Design Schedule (equipo)» para todos
    h1.dataset.pestana = 'Design Schedule' + equipo;
    if (DS_CFG.esAdmin) { sp.innerText = equipo; }
    else {
      // Saludo con el primer nombre (Rosember, 26-oct-2026); quien está a cargo hoy ve el de aprobador
      var gestiona = DS_CFG.rol === 'aprobador' || DS.aCargoHoy;
      dsSaludoPoner('Hola ' + DS_CFG.primerNombre + (gestiona ? ', aquí está tu equipo en movimiento.' : ', tu trabajo es espectacular. ¡Gracias!'));
    }
    if (window.dsActualizarPestana) window.dsActualizarPestana();
  }
  // El saludo entra palabra por palabra. Si el texto no cambió no se toca (así no se repite la animación); con «repetir»
  // se vuelve a armar aunque sea igual (al volver al Schedule desde un panel).
  function dsSaludoPoner(txt, repetir) {
    var s = document.getElementById('dsSaludo'); if (!s || (s.dataset.txt === txt && !repetir)) return;
    s.dataset.txt = txt; s.innerHTML = '';
    txt.split(' ').forEach(function(p, i) {
      var w = document.createElement('span'); w.className = 'ds-pal'; w.style.setProperty('--i', i); w.textContent = p;
      s.appendChild(w); s.appendChild(document.createTextNode(' '));
    });
  }
  // Al ingresar al Schedule (cargar la página o volver a él desde un panel) el saludo entra y los contadores se cuentan
  DS.kpiContar = true;
  function dsEntrada() {
    var s = document.getElementById('dsSaludo'); if (s) dsSaludoPoner(s.dataset.txt || '', true);
    DS.kpiContar = true;
    if (DS.diaData) dsRenderKpis(DS.diaData);
  }
  window.dsEntrada = dsEntrada;

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
        {k:'critico', l:'Crítico', t:'multi', opciones:['','N/A','Inaccurate tissue','Min Thickness','Implant moved','Implant angled','Implant close','Tissue smooth >15']},
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
        {k:'critico', l:'Crítico', t:'multi', opciones:['','N/A','Inaccurate tissue','Min Thickness','Implant moved','Implant angled','Implant close','Tissue smooth >15']},
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
    // N6 · Material Change (pedido por Rosember el 12-oct-2026): dos etapas en la misma fila, cada una con sus horas,
    // su QC y su total (g: 'b' = Bite design, 'z' = Zirconia design; extra = columnas calculadas después de esa celda).
    material: [
      {k:'orden', l:'Orden', t:'text'}, {k:'paciente', l:'Paciente', t:'text'},
      {k:'centro', l:'Centro', t:'catalogo', cat:'centro'}, {k:'producto', l:'Producto', t:'catalogo', cat:'producto'},
      {k:'designerId', l:'Diseñador', t:'designer'},
      {k:'etapa', l:'Etapa', t:'select', opciones:['', 'Bite design', 'Zirconia design']},
      {k:'horaInicio', l:'Inicio', t:'time', g:'b'}, {k:'sHold', l:'S.Hold', t:'time', g:'b'},
      {k:'fHold', l:'F.Hold', t:'time', g:'b', sinTHold: true, extra: [{k:'bTHold', l:'T. Hold'}]},
      {k:'horaFin', l:'Fin', t:'time', g:'b'}, {k:'qc', l:'QC', t:'checkbox', g:'b', extra: [{k:'bTotal', l:'Total'}]},
      {k:'zHoraInicio', l:'Inicio', t:'time', g:'z'}, {k:'zSHold', l:'S.Hold', t:'time', g:'z'},
      {k:'zFHold', l:'F.Hold', t:'time', g:'z', extra: [{k:'zTHold', l:'T. Hold'}]},
      {k:'zHoraFin', l:'Fin', t:'time', g:'z'}, {k:'zQc', l:'QC', t:'checkbox', g:'z', extra: [{k:'zTotal', l:'Total'}]},
      // sin Esferas: en N6 ya no se usa (Rosember, 19-oct-2026)
      {k:'estado', l:'Estado', t:'catalogo', cat:'estado'}, {k:'notas', l:'Notas', t:'text'},
    ],
    // N6 desde el 29-oct-2026 (Rosember, 28-oct-2026): sin la columna Etapa (se ve por las horas marcadas) y con más etapas,
    // cada una con sus horas, QC y total: Material Change agrega «Nightguard design»; Over Ti-bar, «Zirconia» y «Nightguard design».
    // Se arman en dsSpecN6 a partir de COLSPEC.material.
    etapasN6: {
      x: [
        {k:'xHoraInicio', l:'Inicio', t:'time', g:'x'}, {k:'xSHold', l:'S.Hold', t:'time', g:'x'},
        {k:'xFHold', l:'F.Hold', t:'time', g:'x', extra: [{k:'xTHold', l:'T. Hold'}]},
        {k:'xHoraFin', l:'Fin', t:'time', g:'x'}, {k:'xQc', l:'QC', t:'checkbox', g:'x', extra: [{k:'xTotal', l:'Total'}]}
      ],
      n: [
        {k:'nHoraInicio', l:'Inicio', t:'time', g:'n'}, {k:'nSHold', l:'S.Hold', t:'time', g:'n'},
        {k:'nFHold', l:'F.Hold', t:'time', g:'n', extra: [{k:'nTHold', l:'T. Hold'}]},
        {k:'nHoraFin', l:'Fin', t:'time', g:'n'}, {k:'nQc', l:'QC', t:'checkbox', g:'n', extra: [{k:'nTotal', l:'Total'}]}
      ]
    },
    // Removable Denture (Rosember, 20-oct-2026): la orden llega de N3 / N6 (Nestor como diseñador prestado); aquí se ve con
    // el manager de donde viene, el arco y sus dos etapas (Bite design · Denture design), que se llenan con el estado.
    rd: [
      {k:'orden', l:'Orden', t:'ro'}, {k:'paciente', l:'Paciente', t:'ro'}, {k:'centro', l:'Centro', t:'ro'},
      {k:'producto', l:'Producto', t:'ro'}, {k:'manager', l:'Manager', t:'ro'},
      {k:'arco', l:'Arch', t:'select', opciones:['', 'Upper', 'Lower', 'Both']},
      {k:'etapa', l:'Etapa', t:'select', opciones:['', 'Bite design', 'Denture design']},
      // Tiempos como en el Excel (Rosember, 20-oct-2026): BITE DESIGN (START · FINISH) · DENTURE DESIGN (START · FINISH · TOTAL)
      // · TOTAL (TIME = Bite + Denture). Los Hold siguen contando por dentro (los llena el estado), pero no se muestran.
      {k:'horaInicio', l:'START', t:'time', g:'b'}, {k:'horaFin', l:'FINISH', t:'time', g:'b'},
      {k:'zHoraInicio', l:'START', t:'time', g:'z'}, {k:'zHoraFin', l:'FINISH', t:'time', g:'z', extra: [{k:'zTotal', l:'TOTAL'}]},
      {k:'rdTime', l:'TIME', t:'calc', g:'t'},
      // Sin columna QC por ahora (Rosember, 21-oct-2026)
      {k:'estado', l:'Estado', t:'catalogo', cat:'estado'}, {k:'notas', l:'Notas', t:'text'},
    ],
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
  // N2: T. Hold = Hold anteriores del caso (holdMinutos) + F.Hold − S.Hold (como el servidor)
  // Un Hold sin Re-initiated (pasó de Hold directo a Approved) termina en el Fin: igual que _fin_hold en services_design.py
  function dsFinHold(s, fh, fin) { return fh || (s ? fin : ''); }
  function dsTHoldMin(f) { var fh = dsFinHold(f.sHold, f.fHold, f.horaFin); return (parseFloat(f.holdMinutos) || 0) + (f.sHold && fh ? (dsEntre(f.sHold, fh) || 0) : 0); }
  function dsTHoldTxt(f) { return dsTHoldMin(f) || (f.sHold && f.fHold) ? dsFmtMin(dsTHoldMin(f)) : ''; }
  // Fin − Inicio − Hold; si el caso pasó varias noches en Hold se suman los días que falten, sin pasar de los que lleva
  // desde que se creó (misma regla que _menos_hold en services_design.py; orden 242472, 19-oct-2026)
  function dsMenosHold(f, tf, hold) {
    var max = parseInt(f.diasDesdeCreada) || 0, k = 0;
    while (tf + 1440 * k - hold < 0 && k < max) k++;
    return Math.max(0, tf + 1440 * k - hold);
  }
  function dsDuracionMin(f, tabla, formato) {
    if (formato === 'support') return null;
    tabla = dsTablaBase(tabla);   // Over Ti-bar como Material Change; Dummy como Cirugías
    if (tabla === 'material') return dsMaterialMin(f).t;
    if (tabla === 'nightguard' && !dsNgNuevo(formato, f)) return dsEntre(f.horaInicio, f.horaFin);
    // Medido con hora real (disenoMin, 27-oct-2026): no depende de las horas sin fecha; igual que duracion_orden_min en el servidor
    if (f.disenoMin !== null && f.disenoMin !== undefined) return f.horaFin ? f.disenoMin : null;
    if (formato === 'n2') { var t = dsEntre(f.horaInicio, f.horaFin); return t === null ? null : dsMenosHold(f, t, dsTHoldMin(f)); }
    if (dsFaceNuevo(formato) || (tabla === 'nightguard' && dsNgNuevo(formato, f))) {  // Face: Fin − Inicio diseño − tiempo en Hold (este Hold + los anteriores del caso)
      var tf = dsEntre(f.horaInicio, f.horaFin); if (tf === null) return null;
      var fhh = dsFinHold(f.sHold, f.fHold, f.horaFin);
      var hold = (parseFloat(f.holdMinutos) || 0) + (f.sHold && fhh ? (dsEntre(f.sHold, fhh) || 0) : 0);
      return dsMenosHold(f, tf, hold);
    }
    var d = dsEntre(f.horaInicioDiseno, f.horaFin);
    return d === null ? null : Math.max(0, d - (parseFloat(f.holdMinutos) || 0));
  }
  function dsDuracionFila(f, tabla) {
    return tabla === 'prestadas' ? dsFmtMin(dsDuracionMin(f, f.tabla, f.formato)) : dsFmtMin(dsDuracionMin(f, tabla, DS.areaFormato));
  }

  // Columnas de la tabla. "Crítico" (Critical Cases) solo existe en N3 Prosthetic, como en la herramienta original.
  var DS_FACE_NUEVO_DESDE = '2026-10-01';   // 21-oct-2026: todo octubre con el formato actual (antes 5-oct; igual en services_design.py)
  var DS_DUAL_NUEVO_DESDE = '2026-10-01';
  var DS_NG_NUEVO_DESDE = '2026-10-01';  // Nightguards / TC de N3 y N6 con el mismo formato (horas_por_estado en services_design.py)
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
  // N6 desde el 29-oct-2026: Material Change y Over Ti-bar sin Etapa y con sus etapas nuevas antes de Estado
  function dsSpecN6(tablaOrig) {
    var extra = tablaOrig === 'tibar' ? COLSPEC.etapasN6.x.concat(COLSPEC.etapasN6.n) : COLSPEC.etapasN6.n;
    var base = COLSPEC.material.filter(function(c) { return c.k !== 'etapa'; }), i = base.findIndex(function(c) { return c.k === 'estado'; });
    return base.slice(0, i).concat(extra, base.slice(i));
  }
  function dsSpec(tabla, formato, areaNombre) {
    var tablaOrig = tabla;
    tabla = dsTablaBase(tabla);   // Over Ti-bar con las columnas de Material Change; Dummy, con las de Cirugías
    if (tabla === 'material') return (areaNombre || dsAreaNombre()) === DS_AREA_RD ? COLSPEC.rd
      : (areaNombre || dsAreaNombre()) === DS_AREA_MATERIAL && dsN6Separado() ? dsSpecN6(tablaOrig) : COLSPEC.material;
    var area = areaNombre || (DS.areas.find(function(a) { return a.id === DS.areaId; }) || {}).nombre;
    var fm = formato || DS.areaFormato;
    var base = !dsFaceNuevo(fm) ? COLSPEC[fm] : (fm === 'dual' ? {principal: COLSPEC.dualNuevo.principal, nightguard: dsNgNuevo(fm) ? COLSPEC.dualNuevo.nightguard : COLSPEC.dual.nightguard} : COLSPEC.faceNuevo);
    var spec = base[tabla] || [];
    if (area === 'N6 Material Changes') {
      // N6 con las columnas de N2 (pedido por Rosember el 9-oct-2026): Inicio · S.Hold · F.Hold · T. Hold · Fin.
      // Las horas se registran igual que en N3 (con el estado); solo cambian los nombres y aparece T. Hold.
      // Sin la columna Esferas (Rosember, 19-oct-2026)
      spec = spec.filter(function(c) { return c.k !== 'esferas'; }).map(function(c) {
        if (c.k === 'horaInicio' && c.l === 'Inicio diseño') return Object.assign({}, c, {l: 'Inicio'});
        if (c.k === 'sHold') return Object.assign({}, c, {l: 'S.Hold'});
        if (c.k === 'fHold') return Object.assign({}, c, {l: 'F.Hold', sinTHold: false});
        return c;
      });
    }
    var comoN3 = area === 'N3 Prosthetic' || area === DS_AREA_TRAINING;   // Training se ve igual que N3
    if (comoN3 && tabla === 'principal' && fm === 'dual') {
      // Articulation va antes de los tiempos de siempre, y estos se marcan como "Design" (otro color)
      var i0 = spec.findIndex(function(c) { return c.k === 'horaInicio'; });
      if (i0 >= 0) {
        var DES = {horaInicio: 1, sHold: 1, fHold: 1, horaFin: 1};
        spec = spec.map(function(c) { return DES[c.k] ? Object.assign({}, c, {g: 'd'}) : c; });
        var art = [{k:'artStart', l:'START', t:'time', g:'a'}, {k:'artRtd', l:'RTD', t:'time', g:'a', extra: [{k:'artTotal', l:'TOTAL'}]}];
        spec = spec.slice(0, i0).concat(art, spec.slice(i0));
      }
      if (area === DS_AREA_TRAINING) {   // de qué equipo (manager) llegó el caso
        var id0 = spec.findIndex(function(c) { return c.k === 'designerId'; });
        spec = spec.slice(0, id0 + 1).concat([{k:'origenEquipo', l:'Equipo de origen', t:'ro'}], spec.slice(id0 + 1));
      }
    }
    return comoN3 ? spec : spec.filter(function(c) { return c.k !== 'critico'; });
  }
  function dsEncabezadoExtra(c) { // N2: T. Hold calculado; Material Change: T. Hold y Total de cada etapa
    return (c.k === 'fHold' && !c.sinTHold ? '<th>T. Hold</th>' : '') +
           (c.extra || []).map(function(x) { return '<th class="ds-g-' + c.g + '">' + x.l + '</th>'; }).join('');
  }

  function dsEsProductoNG(v) { return /nightguard/i.test(v) || /\btc\b/i.test(v); }
  // Productos que van solo en la tabla de Nightguards / TC (no en Cirugías) aunque su nombre no diga Nightguard ni TC
  // (15-oct-2026: Scan/Measurements de N3). Se comparan sin mayúsculas, espacios ni signos ("Scan / Measurements" = "Scan/Measurements").
  // 19-oct-2026: también "Prosthetic Scan/Measurement" (cualquier nombre que lleve "Prosthetic Scan"): queda un solo producto en N3 y va aquí.
  var DS_PRODUCTOS_SOLO_NG = ['scanmeasurements', 'scanmeasurement'];
  function dsEsProductoSoloNG(v) {
    var k = String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9]/g, '');
    return DS_PRODUCTOS_SOLO_NG.indexOf(k) >= 0 || k.indexOf('prostheticscan') >= 0;
  }

  // ---------- N6 · Material Change (pedido por Rosember el 12-oct-2026; ver TABLA_MATERIAL en services_design.py) ----------
  // Panel arriba de Cirugías con sus propios productos (no salen en Cirugías) y estados ("Dr authorization" = Hold,
  // "Changes" = Ready to design). Bite design usa las horas y el QC de siempre; Zirconia design, las columnas z*.
  var DS_AREA_MATERIAL = 'N6 Material Changes';
  var DS_AREA_RD = 'Removable Denture';   // Schedule Removable Denture (20-oct-2026): ver COLSPEC.rd
  function dsEsRD() { return dsAreaNombre() === DS_AREA_RD; }
  var DS_AREA_TRAINING = 'Training';   // Schedule de entrenamiento: igual al de N3; los casos llegan desde N3 con la opción "Training" del diseñador
  function dsNorm(v) { return String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' '); }
  var DS_PRODUCTOS_MATERIAL = ['N6 - Material Change Full Mouth 24Z', 'N6 - Material Change Single 24Z',
    'N6 - Full Mouth Zirk - Over Ti-Bar (8mm or less)', 'N6 - Redo Material Change Full Mouth 24Z',
    'N6 - Redo Material Change Single 24Z', 'N6 - Full Mouth 24Z Remake', 'N6 - Single 24Z Remake'].map(dsNorm);
  function dsEsProductoMaterial(v) { return DS_PRODUCTOS_MATERIAL.indexOf(dsNorm(v)) >= 0; }
  var DS_ESTADOS_SOLO_MATERIAL = ['dr authorization', 'changes'];
  function dsEsHold(estado) { var e = dsNorm(estado); return e === 'hold' || e === 'dr authorization'; }
  function dsEsReady(estado) { var e = dsNorm(estado); return e === 'ready to design' || e === 'changes'; }
  function dsEsZirconia(f) { var e = dsNorm(f && f.etapa); return e === 'zirconia design' || e === 'denture design'; }   // 2.ª etapa (Material Change / Removable Denture)
  var DS_CAMPOS_QC = ['qc', 'zQc', 'xQc', 'nQc'];   // QC de cada etapa (x = «Zirconia» de Over Ti-bar, n = «Nightguard design»)
  function dsEsCampoQc(k) { return DS_CAMPOS_QC.indexOf(k) >= 0; }
  function dsCampoReporte(chk) { return chk && dsEsCampoQc(chk.dataset.campo) ? chk.dataset.campo + 'Reporte' : 'qcReporte'; }
  // QC que cierra la orden (Material Change: el de Zirconia)
  function dsQcFinal(f) { return dsTablaBase(f.tabla) === 'material' ? !!f.zQc : !!f.qc; }
  function dsMinEtapa(ini, fin, s, fh, previos) {
    var t = dsEntre(ini, fin); if (t === null) return null;
    fh = dsFinHold(s, fh, fin);
    return Math.max(0, t - (parseFloat(previos) || 0) - (s && fh ? (dsEntre(s, fh) || 0) : 0));
  }
  // Minutos de Bite, de Zirconia y total (misma fórmula que material_minutos en services_design.py)
  function dsMaterialMin(f) {
    var b = dsMinEtapa(f.horaInicio, f.horaFin, f.sHold, f.fHold, f.holdMinutos);
    var z = dsMinEtapa(f.zHoraInicio, f.zHoraFin, f.zSHold, f.zFHold, f.zHoldMinutos);
    var x = dsMinEtapa(f.xHoraInicio, f.xHoraFin, f.xSHold, f.xFHold, f.xHoldMinutos);   // N6: «Zirconia» de Over Ti-bar
    var n = dsMinEtapa(f.nHoraInicio, f.nHoraFin, f.nSHold, f.nFHold, f.nHoldMinutos);   // N6: «Nightguard design»
    var todas = [b, z, x, n].filter(function(v) { return v !== null; });
    return {b: b, z: z, x: x, n: n, t: todas.length ? todas.reduce(function(a, v) { return a + v; }, 0) : null};
  }
  // N3 · Cirugías: tiempo de articulación = RTD − START (minutos; si cruza la medianoche se suma un día, como las demás horas)
  var DS_ART_LIMITE_MIN = 120;  // lo normal son 2 h; pasadas se cuenta en Dashboard › Articulación (art_min en services_design.py)
  function dsArtMin(f) { return dsEntre(f.artStart, f.artRtd); }
  function dsCalcTxt(k, f) {
    if (k === 'bTHold') return dsTHoldTxt(f);
    if (k === 'zTHold') return dsTHoldTxt({holdMinutos: f.zHoldMinutos, sHold: f.zSHold, fHold: f.zFHold});
    if (k === 'bTotal') return dsFmtMin(dsMaterialMin(f).b);
    if (k === 'zTotal') return dsFmtMin(dsMaterialMin(f).z);
    if (k === 'xTHold') return dsTHoldTxt({holdMinutos: f.xHoldMinutos, sHold: f.xSHold, fHold: f.xFHold});
    if (k === 'nTHold') return dsTHoldTxt({holdMinutos: f.nHoldMinutos, sHold: f.nSHold, fHold: f.nFHold});
    if (k === 'xTotal') return dsFmtMin(dsMaterialMin(f).x);
    if (k === 'nTotal') return dsFmtMin(dsMaterialMin(f).n);
    if (k === 'artTotal') return dsFmtMin(dsArtMin(f));
    if (k === 'rdTime') return dsFmtMin(dsMaterialMin(f).t);   // Removable Denture: Bite + Denture
    return '';
  }
  // Tablas del Schedule y su contenedor (Material Change primero, como en pantalla)
  var DS_TABLAS = ['material', 'tibar', 'dummy', 'principal', 'nightguard'];
  var DS_CONT = {material: 'dsTablaMaterial', tibar: 'dsTablaTibar', dummy: 'dsTablaDummy', principal: 'dsTablaPrincipal', nightguard: 'dsTablaNightguard'};
  // ---------- N6 · cuatro tablas (Rosember, 28-oct-2026; ver TABLA_TIBAR en services_design.py) ----------
  // Desde el 29-oct-2026: Material Change, Over Ti-bar, Dummy y Cirugías, cada una con sus productos. Over Ti-bar funciona
  // como Material Change (Bite + Zirconia) y Dummy como Cirugías. Nightguards / TC sale solo si le quedó alguna orden.
  var DS_N6_SEPARADO_DESDE = '2026-10-29';
  var DS_TABLA_BASE = {tibar: 'material', dummy: 'principal'};
  function dsTablaBase(t) { return DS_TABLA_BASE[t] || t; }
  function dsN6Separado() { return dsAreaNombre() === DS_AREA_MATERIAL && dsFechaISO(dsFechaSeleccionada()) >= DS_N6_SEPARADO_DESDE; }
  var DS_N6_24Z = ['N6 - Material Change Full Mouth 24Z', 'N6 - Material Change Single 24Z', 'N6 - Redo Material Change Full Mouth 24Z',
    'N6 - Redo Material Change Single 24Z', 'N6 - Full Mouth 24Z Remake', 'N6 - Single 24Z Remake'];
  var DS_PRODUCTOS_N6 = {   // igual que PRODUCTOS_N6_TABLA en services_design.py
    material: DS_N6_24Z,
    tibar: ['N6 - Full Mouth Zirk - Over Ti-Bar (8mm or less)'],
    dummy: ['N6 - Dummy Set', 'N6 - Aesthetic Dummy', 'Screw Retained - Dummy'],
    principal: DS_N6_24Z.concat(['N6 - Material Change Full Mouth G-CAM/TiBar', 'N6 - Material Change Single G-CAM/TiBar',
      'N6 - Full Mouth G-CAM Remake', 'N6 - Single G-CAM Remake', 'N6 - Remake Removable Denture',
      'N6 - Remake Removable Denture With Fixed Arch', 'N6 - Remake Removable Denture With Fixed Arch 24Z',
      'N6 - Full Mouth G-CAM Ti Bar Remake', 'N6 - Single G-CAM Ti Bar Remake'])
  };
  Object.keys(DS_PRODUCTOS_N6).forEach(function(k) { DS_PRODUCTOS_N6[k] = DS_PRODUCTOS_N6[k].map(dsNorm); });
  function dsPanelesN6(dia) {
    var sep = dsN6Separado();
    ['Tibar', 'Dummy'].forEach(function(t) {
      document.getElementById('dsPanel' + t).style.display = sep ? '' : 'none';
      if (!sep) document.getElementById('dsTabla' + t).innerHTML = '';
    });
    if (dsAreaNombre() !== DS_AREA_MATERIAL) return;
    document.getElementById('dsPanelNightguard').style.display = !sep || (dia.nightguard || []).length ? '' : 'none';
    document.getElementById('dsTituloPrincipal').innerText = sep ? 'Cirugías' : 'Cirugías/Dummy';
  }
  function dsSelTablas(sufijo) { return DS_TABLAS.map(function(t) { return '#' + DS_CONT[t] + (sufijo ? ' ' + sufijo : ''); }).join(', '); }
  // Fila de encabezado con los bloques Bite design / Zirconia design (solo tablas con columnas agrupadas)
  var DS_GRUPOS = {b: 'Bite design', z: 'Zirconia design', x: 'Zirconia', n: 'Nightguard design', a: 'Articulation', d: 'Design', t: 'TOTAL'};
  function dsAnchoCol(c) { return 1 + (c.k === 'fHold' && !c.sinTHold ? 1 : 0) + (c.extra ? c.extra.length : 0); }
  function dsFilaGrupos(spec, alFinal) {
    if (!spec.some(function(c) { return c.g; })) return '';
    var html = '<tr class="ds-tr-grupos">', run = null;
    var nombreG = function(g) { return !dsEsRD() ? DS_GRUPOS[g] : ({b: 'BITE DESIGN', z: 'DENTURE DESIGN'}[g] || DS_GRUPOS[g]); };
    var cerrar = function() { if (run) html += '<th colspan="' + run.n + '" class="' + (run.g ? 'ds-gh ds-g-' + run.g : 'ds-gh-vacio') + '">' + (run.g ? nombreG(run.g) : '') + '</th>'; };
    spec.forEach(function(c) {
      var g = c.g || '';
      if (run && run.g === g) run.n += dsAnchoCol(c); else { cerrar(); run = {g: g, n: dsAnchoCol(c)}; }
    });
    if (run && !run.g) run.n += alFinal; else { cerrar(); run = {g: '', n: alFinal}; }
    cerrar();
    return html + '</tr>';
  }
  // ¿Esta lista de estados es de una fila de Material Change?
  function dsFilaEsMaterial(sel, tabla) {
    if (dsTablaBase(tabla) === 'material') return true;
    var tr = sel.closest('tr');
    return !!(tr && tr._dsFila && tr._dsFila.f && dsTablaBase(tr._dsFila.f.tabla) === 'material');
  }

  // ¿Ya hay otra orden con ese número hoy en este equipo? (el servidor valida también las que no se ven)
  // Un número puede estar hasta 5 veces en el día del equipo (MAX_REPETICIONES_ORDEN en services_design.py)
  var DS_MAX_REPETIDAS = 5;
  function dsOrdenRepetida(orden, idActual) {
    var n = String(orden || '').trim().toUpperCase();
    if (!n || !DS.diaData) return false;
    return (DS.diaData.principal || []).concat(DS.diaData.nightguard || [], DS.diaData.material || [], DS.diaData.tibar || [], DS.diaData.dummy || []).filter(function(f) {
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
    dsMarcarFaltaAprobar(tr);   // N3: celdas que faltan para Approved (parpadean unos segundos)
    dsAjustarOpcionHold(tr, f);
    dsAjustarOpcionPickup(tr, f);
    dsAjustarOpcionBite(tr, f);
    tr.classList.toggle('ds-fila-cancelada', f.estado === 'Canceled');
    var est = String(f.estado || '').trim().toLowerCase();
    // 19-oct-2026: "Dr authorization" (Material Change) se ve como Approved (color y chip), no como Hold; en lo demás sigue contando como Hold
    tr.classList.toggle('ds-fila-hold', est === 'hold');
    tr.classList.toggle('ds-fila-ready', dsEsReady(f.estado));  // Material Change: también "Changes"
    tr.classList.toggle('ds-fila-html', est === 'html');
    tr.classList.toggle('ds-fila-aprobada', est === 'approved' || est === 'dr authorization');
    var formato = tabla === 'prestadas' ? f.formato : DS.areaFormato, tablaReal = dsTablaBase(tabla === 'prestadas' ? f.tabla : tabla);
    var aprobada = f.estado === 'Approved', falta = false;
    var ngNuevo = tablaReal === 'nightguard' && dsNgNuevo(formato, tabla === 'prestadas' ? f : null);
    var req = formato === 'support' ? [] : ((tablaReal === 'nightguard' && !ngNuevo) || formato === 'n2') ? ['horaInicio', 'horaFin']
            : (dsFaceNuevo(formato) || ngNuevo) ? (f.sHold ? ['horaInicio', 'fHold', 'horaFin'] : ['horaInicio', 'horaFin'])
            : ['horaInicio', 'horaInicioDiseno', 'horaFin'];
    // [campo, ¿ya debería tener hora?]. Material Change: Bite al pasar a Zirconia; Zirconia al aprobar la orden.
    var esMat = tablaReal === 'material', biteHecha = esMat && dsEsZirconia(f), zHecha = biteHecha && aprobada;
    var reqs = !esMat ? req.map(function(k) { return [k, aprobada]; })
      : (f.sHold ? ['horaInicio', 'fHold', 'horaFin'] : ['horaInicio', 'horaFin']).map(function(k) { return [k, biteHecha]; })
          .concat((f.zSHold ? ['zHoraInicio', 'zFHold', 'zHoraFin'] : ['zHoraInicio', 'zHoraFin']).map(function(k) { return [k, zHecha]; }));
    reqs.forEach(function(par) {
      var k = par[0], el = tr.querySelector('[data-campo="' + k + '"]'), miss = par[1] && !f[k];
      if (miss) falta = true;
      if (!el) return;
      el.classList.toggle('ds-falta', miss);
      if (miss) el.title = 'Falta esta hora y la orden ya está aprobada'; else el.removeAttribute('title');
    });
    // QC (Material Change: uno por etapa)
    [['qc', 'qcReporte', esMat ? biteHecha : aprobada], ['zQc', 'zQcReporte', zHecha], ['xQc', 'xQcReporte', false], ['nQc', 'nQcReporte', false]].forEach(function(q) {
      var qc = tr.querySelector('[data-campo="' + q[0] + '"]'), td = qc && qc.closest('td');
      if (!td) return;
      var pend = q[2] && !f[q[0]], etapaTxt = esMat ? (q[0] === 'zQc' ? 'Zirconia aprobada' : 'Bite aprobado') : 'Orden aprobada';
      td.classList.toggle('ds-qc-pend', pend && !falta);
      td.classList.toggle('ds-qc-pend-rojo', pend && falta);
      if (pend) td.title = etapaTxt + (falta ? ': faltan horas y marcar el QC' : ': falta marcar el QC'); else td.removeAttribute('title');
      var rep = String(f[q[1]] || '').trim();
      td.classList.toggle('ds-qc-hallazgo', !!f[q[0]] && !!rep);
      if (f[q[0]]) td.dataset.qcTip = rep ? 'si' : 'no'; else delete td.dataset.qcTip;
      td._qcTexto = rep;
    });
    tr._dsFila = {tabla: tabla, f: f};   // para actualizar sus accesos sin volver a dibujar la fila
    dsAccesosFila(tr, tabla, f);
  }

  // ---------- Accesos en la fila ----------
  // Orden (N3, orden completa con paciente): botón a Comments N3; la primera vez llena Patient, Order # y Product.
  // Centro elegido: botón con la miniatura del Pre-Approved de sus doctores; clic abre una ventana flotante en vivo.
  function dsAreaNombre() { return (DS.areas.find(function(a) { return a.id === DS.areaId; }) || {}).nombre || ''; }
  function dsAccesosFila(tr, tabla, f) {
    // 'prestadas': órdenes de otro equipo asignadas a esta persona (prestada o enviada como ayuda): también llevan sus
    // accesos, con el área de la orden y no la del equipo que se está viendo (Rosember, 19-oct-2026: Eliana no los tenía)
    var tb0 = dsTablaBase(tabla);
    if (tb0 !== 'principal' && tb0 !== 'nightguard' && tb0 !== 'material' && tb0 !== 'prestadas') return;
    var areaOrden = tabla === 'prestadas' ? (f.area || '') : dsAreaNombre();
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
    poner(tdO, 'ds-acc-cmt', perm && areaOrden === 'N3 Prosthetic' && completa,
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
          var v = fl.valores[i], fotos = (fl.fotos || [])[i] || [];
          return '<td' + (/^\s*always ask\.?\s*$/i.test(v || '') ? ' class="pa-ask"' : '') + '>' + esc(v || '') +
                 (fotos.length ? '<div class="pa-fotos">' + fotos.map(function(id) {
                   return '<span class="pa-foto"><img src="/design/api/preapproved/fotos/' + id + '" alt="Foto" loading="lazy" title="Ver la foto" onclick="paVerFoto(this.src)"></span>';
                 }).join('') + '</div>' : '') + '</td>';
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

  // Pestañas ancladas (Rosember, 27-oct-2026), al estilo de las pestañas de Chrome: una ventana flotante que se suelta
  // cerca de la barra superior queda como pestaña azul colgando debajo de la barra (la ventana se oculta pero sigue
  // actualizándose). Clic en la pestaña = se despega en su último lugar; arrastrarla hacia abajo = se despega bajo el
  // mouse y se sigue moviendo; arrastrarla de lado = se deja donde se quiera en la fila (las demás se corren solo si se
  // tocan). Las ancladas y su lugar se recuerdan en este navegador.
  var DS_FWREG = {}, DS_DOCK = [], DS_DOCK_KEY = 'dsDockV1', DS_DOCK_RESTAURADO = false;
  function dsFwRegistrar(el, info) { info.el = el; el.dataset.fwId = info.id; DS_FWREG[info.id] = info; }
  function dsFwQuitar(id) {   // la ventana se cerró: sale del registro y de las pestañas
    delete DS_FWREG[id];
    var i = DS_DOCK.indexOf(id); if (i >= 0) { DS_DOCK.splice(i, 1); dsDockPintar(); dsDockGuardar(); }
  }
  function dsDockBarra() {
    var b = document.getElementById('dsDock'); if (b) return b;
    var nav = document.querySelector('body > nav'); if (!nav) return null;
    b = document.createElement('div'); b.id = 'dsDock'; b.setAttribute('role', 'tablist'); b.setAttribute('aria-label', 'Ventanas ancladas');
    nav.appendChild(b); return b;
  }
  function dsDockCerca(y) { var nav = document.querySelector('body > nav'); return !!nav && y < nav.getBoundingClientRect().bottom + 40; }
  function dsDockGuardar() {
    try {
      localStorage.setItem(DS_DOCK_KEY, JSON.stringify(DS_DOCK.map(function(id) {
        var info = DS_FWREG[id]; if (!info || !info.guardar) return null;
        var g = {}; for (var k in info.guardar) g[k] = info.guardar[k];
        g.x = Math.round(info.x || 0); return g;
      }).filter(Boolean)));
    } catch (e) {}
  }
  // Cada pestaña queda en su x; si dos se tocan (o una se sale de la fila) se corren lo justo para que no se monten.
  function dsDockAcomodar() {
    var b = document.getElementById('dsDock'); if (!b) return;
    var ancho = b.clientWidth, sep = 4, ini = 8;
    var ts = Array.prototype.map.call(b.children, function(t) { return {t: t, info: DS_FWREG[t.dataset.id], w: t.offsetWidth}; })
      .filter(function(o) { return o.info; });
    ts.sort(function(a, c) { return a.info.x - c.info.x; });
    var lim = ini;
    ts.forEach(function(o) { o.info.x = Math.max(o.info.x, lim); lim = o.info.x + o.w + sep; });
    lim = ancho - 8;
    for (var i = ts.length - 1; i >= 0; i--) { ts[i].info.x = Math.max(ini, Math.min(ts[i].info.x, lim - ts[i].w)); lim = ts[i].info.x - sep; }
    ts.forEach(function(o) { o.t.style.left = o.info.x + 'px'; });
    DS_DOCK = ts.map(function(o) { return o.t.dataset.id; });
  }
  function dsDockPintar() {
    var b = dsDockBarra(); if (!b) return;
    b.innerHTML = '';
    var der = 8;   // una pestaña nueva sin lugar elegido va a la derecha de las demás
    DS_DOCK.forEach(function(id) { var info = DS_FWREG[id]; if (info && info.x != null) der = Math.max(der, info.x + 200); });
    DS_DOCK.forEach(function(id) {
      var info = DS_FWREG[id]; if (!info) return;
      if (info.x == null) { info.x = der; der += 200; }
      var t = document.createElement('div'); t.className = 'ds-dock-tab'; t.setAttribute('role', 'tab'); t.tabIndex = 0; t.dataset.id = id;
      t.title = info.titulo + ' · clic para despegar';
      t.innerHTML = '<span></span><button type="button" title="Cerrar" aria-label="Cerrar">✕</button>';
      t.querySelector('span').textContent = info.titulo;
      t.querySelector('button').onclick = function(e) { e.stopPropagation(); info.cerrar(); };
      t.addEventListener('keydown', function(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dsDockDespegar(id); } });
      t.addEventListener('mousedown', function(e) { if (e.button === 0 && !e.target.closest('button')) dsDockTabArrastre(t, id, e); });
      t.style.left = info.x + 'px';
      b.appendChild(t);
    });
    document.documentElement.classList.toggle('ds-con-dock', DS_DOCK.length > 0);
    dsDockAcomodar();
  }
  function dsDockAnclar(id, x) {   // x: donde se soltó la ventana (la pestaña queda ahí)
    var info = DS_FWREG[id]; if (!info) return;
    info.pos = {left: info.el.style.left, top: info.el.style.top};
    info.x = x != null ? Math.max(8, x) : null;
    info.el.classList.add('ds-fw-anclada');
    if (DS_DOCK.indexOf(id) < 0) DS_DOCK.push(id);
    dsDockPintar(); dsDockGuardar();
  }
  // ev: si viene, la ventana aparece bajo el mouse y se sigue arrastrando (pestaña sacada hacia abajo)
  function dsDockDespegar(id, ev) {
    var info = DS_FWREG[id]; if (!info) return;
    var i = DS_DOCK.indexOf(id); if (i >= 0) DS_DOCK.splice(i, 1);
    info.xPrev = info.x; info.x = null;   // recuerda dónde estaba la pestaña para volver ahí
    var el = info.el;
    el.classList.remove('ds-fw-anclada', 'min');
    var m = el.querySelector('[data-fw="min"]'); if (m) { m.title = 'Minimizar'; m.textContent = '—'; }
    el.style.zIndex = ++DS_FW_Z;
    if (info.alMostrar) info.alMostrar();
    if (ev) {
      el.style.left = Math.max(0, ev.clientX - 60) + 'px'; el.style.top = Math.max(0, ev.clientY - 14) + 'px';
    } else if (info.pos && info.pos.left) {
      el.style.left = info.pos.left; el.style.top = info.pos.top;
    } else if (info.posInicial) info.posInicial();
    var r = el.getBoundingClientRect();   // que no quede por fuera de la pantalla
    if (r.left > window.innerWidth - 80) el.style.left = Math.max(8, window.innerWidth - 8 - r.width) + 'px';
    if (r.top > window.innerHeight - 36) el.style.top = Math.max(8, window.innerHeight - 8 - r.height) + 'px';
    dsDockPintar(); dsDockGuardar();
    if (ev) dsFwArrastrar(el, ev, 60, 14);
  }
  // Mover una ventana desde su cabecera; al soltarla cerca de la barra superior se ancla.
  function dsFwArrastrar(el, e, dx, dy) {
    var r = el.getBoundingClientRect();
    if (dx == null) { dx = e.clientX - r.left; dy = e.clientY - r.top; }
    var b = dsDockBarra(), x0 = e.clientX, y0 = e.clientY, movio = false;
    var mover = function(ev) {
      if (!movio && Math.abs(ev.clientX - x0) < 4 && Math.abs(ev.clientY - y0) < 4) return;   // un clic no mueve ni ancla
      movio = true;
      el.style.left = Math.max(-r.width + 80, Math.min(window.innerWidth - 80, ev.clientX - dx)) + 'px';
      el.style.top = Math.max(0, Math.min(window.innerHeight - 36, ev.clientY - dy)) + 'px';
      if (b) b.classList.toggle('ds-dock-zona', dsDockCerca(ev.clientY));
    };
    var soltar = function(ev) {
      document.removeEventListener('mousemove', mover); document.removeEventListener('mouseup', soltar);
      if (b) b.classList.remove('ds-dock-zona');
      if (movio && el.dataset.fwId && dsDockCerca(ev.clientY)) dsDockAnclar(el.dataset.fwId, ev.clientX - 40);
    };
    document.addEventListener('mousemove', mover); document.addEventListener('mouseup', soltar);
  }
  function dsFwCabecera(el) {   // arrastre, doble clic y — comunes de todas las ventanas flotantes
    var cab = el.querySelector('.ds-fw-cab');
    el.addEventListener('mousedown', function() { el.style.zIndex = ++DS_FW_Z; });
    cab.addEventListener('mousedown', function(e) {
      if (e.button !== 0 || e.target.closest('button')) return;
      e.preventDefault(); dsFwArrastrar(el, e);
    });
    // Minimizar una ventana que está sobre la zona de anclaje la vuelve a anclar sola, en el lugar donde estaba su pestaña.
    var alternar = function() {
      var id = el.dataset.fwId, info = DS_FWREG[id], r = el.getBoundingClientRect();
      if (info && !el.classList.contains('min') && dsDockCerca(r.top + 14)) { dsDockAnclar(id, info.xPrev != null ? info.xPrev : r.left); return; }
      el.classList.toggle('min');
      var b = el.querySelector('[data-fw="min"]');
      b.title = el.classList.contains('min') ? 'Restaurar' : 'Minimizar'; b.textContent = el.classList.contains('min') ? '▢' : '—';
    };
    cab.addEventListener('dblclick', function(e) { if (!e.target.closest('button')) alternar(); });
    el.querySelector('[data-fw="min"]').onclick = alternar;
  }
  // Arrastre de una pestaña: de lado se mueve libre por la fila; hacia abajo la despega; sin moverse es un clic (despega).
  function dsDockTabArrastre(t, id, e) {
    e.preventDefault();
    var info = DS_FWREG[id], x0 = e.clientX, y0 = e.clientY, movio = false, b = t.parentNode, l0 = info.x;
    var mover = function(ev) {
      if (!movio && Math.abs(ev.clientX - x0) < 5 && Math.abs(ev.clientY - y0) < 5) return;
      movio = true; t.classList.add('arrastrando');
      if (ev.clientY > b.getBoundingClientRect().bottom + 24) { fin(); dsDockDespegar(id, ev); return; }
      info.x = Math.max(8, Math.min(b.clientWidth - 8 - t.offsetWidth, l0 + ev.clientX - x0));
      t.style.left = info.x + 'px';
    };
    var fin = function() {
      document.removeEventListener('mousemove', mover); document.removeEventListener('mouseup', soltar);
      t.classList.remove('arrastrando');
    };
    var soltar = function() {
      fin();
      if (!movio) { dsDockDespegar(id); return; }
      dsDockAcomodar(); dsDockGuardar();
    };
    document.addEventListener('mousemove', mover); document.addEventListener('mouseup', soltar);
  }
  // Al cargar el Schedule (una vez, con el día ya pintado) se vuelven a abrir ancladas las que estaban en pestañas.
  function dsDockRestaurar() {
    if (DS_DOCK_RESTAURADO) return; DS_DOCK_RESTAURADO = true;
    var lista; try { lista = JSON.parse(localStorage.getItem(DS_DOCK_KEY) || '[]'); } catch (e) { lista = []; }
    if (!Array.isArray(lista)) return;
    lista.forEach(function(g) {
      if (!g || !g.t) return;
      if (g.t === 'prod') {
        var pb = document.getElementById('dsProdBtn');
        if (pb && !pb.classList.contains('ds-fuera')) dsAbrirProduccion(true);
      } else if (g.t === 'pa' && g.centro && g.area) dsPaVentana(g.centro, {area: g.area, team: g.team || '', anclada: true});
      var id = g.t === 'prod' ? 'prod' : 'pa|' + g.area + '|' + (g.team || '') + '|' + String(g.centro || '').toLowerCase();
      if (DS_FWREG[id] && typeof g.x === 'number') DS_FWREG[id].x = g.x;
    });
    dsDockPintar();
    dsDockGuardar();   // se olvidan las que ya no aplican
  }
  function dsPaVentana(centro, op) {
    op = op || {};
    dsPaMiniQuitar();
    var area = op.area || DS.areaId, team = op.area ? (op.team || '') : (DS.teamId || ''), clave = area + '|' + team + '|' + centro.toLowerCase();
    var w = DS_FW[clave];
    if (w && w.el.isConnected) {
      if (w.el.classList.contains('ds-fw-anclada')) { if (!op.anclada) dsDockDespegar('pa|' + clave); return; }
      w.el.classList.remove('min'); w.el.style.zIndex = ++DS_FW_Z; return;
    }
    var el = document.createElement('div'); el.className = 'ds-fw'; el.style.zIndex = ++DS_FW_Z; el.setAttribute('role', 'dialog');
    var n = DS_FW_N++ % 6;
    el.style.left = Math.max(8, Math.min(window.innerWidth - 640, 140 + n * 28)) + 'px'; el.style.top = (110 + n * 28) + 'px';
    el.innerHTML = '<div class="ds-fw-cab"><b></b><small></small><button type="button" data-fw="min" title="Minimizar">—</button><button type="button" data-fw="cerrar" title="Cerrar">✕</button></div>' +
      '<div class="ds-fw-cuerpo"><div class="ds-fw-vivo">Cargando…</div><div class="ds-fw-docs" role="group" aria-label="Doctor"></div><div class="ds-fw-c"></div></div>';
    el.querySelector('b').textContent = 'Pre-Approved · ' + centro;
    el.setAttribute('aria-label', 'Pre-Approved ' + centro);
    document.body.appendChild(el);
    w = DS_FW[clave] = {el: el, centro: centro, area: area, v: null, doctor: '', datos: null, manual: false};
    dsFwCabecera(el);
    var cerrar = function() { clearInterval(w.timer); el.remove(); delete DS_FW[clave]; dsFwQuitar('pa|' + clave); };
    el.querySelector('[data-fw="cerrar"]').onclick = cerrar;
    dsFwRegistrar(el, {id: 'pa|' + clave, titulo: 'Pre-Approved · ' + centro, cerrar: cerrar, guardar: {t: 'pa', centro: centro, area: area, team: team},
      alMostrar: function() { if (w.ajustePendiente) { w.ajustePendiente = false; ajustarTamano(); } }});
    if (op.anclada) { el.classList.add('ds-fw-anclada'); DS_DOCK.push('pa|' + clave); dsDockPintar(); }
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
      if (el.classList.contains('ds-fw-anclada')) { w.ajustePendiente = true; return; }   // oculta: se mide al despegarla
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
  // al escribir el primer dato; en ese momento aparece otra fila nueva debajo (pedido por Rosember el 12-oct-2026).
  // Antes la fila nueva solo aparecía si TODAS las órdenes del día estaban completas, y cualquier fila que nunca se
  // completa (Meeting/Practice en N2, canceladas, casos que pasan de otro día, una fila a medias) la bloqueaba.
  // Una orden "completa" (centro + producto + diseñador) es la única que cuentan los contadores;
  // mismo criterio que filtro_orden_completa() en services_design.py.
  function dsOrdenCompleta(f) { return !!(f.centro && f.producto && (f.designerId || f.designerPrestado)); }
  // Producto «Training» (26-oct-2026): fantasma, solo para practicar; se ve en el Schedule pero no cuenta (= es_producto_fantasma)
  function dsEsFantasma(f) { return String((f && f.producto) || '').trim().toLowerCase() === 'training'; }
  // ¿La fila está totalmente en blanco? (p. ej. las que crea "+ Agregar orden"): entonces ya hay dónde escribir.
  var DS_CAMPOS_DATO = ['orden', 'paciente', 'centro', 'producto', 'designerId', 'designerPrestado', 'estado'];
  function dsFrenaFilaNueva(f) { return !DS_CAMPOS_DATO.some(function(k) { return f[k] && String(f[k]).trim(); }); }

  var DS_SORTABLES = {centro: true, producto: true, designerId: true, estado: true};
  DS.sort = {principal: null, nightguard: null, material: null, tibar: null, dummy: null}; // {k, dir: 1 (A→Z) | -1 (Z→A)}

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
    DS.tablaFila = tabla === 'prestadas' ? f.tabla : tabla;   // la lista de Diseñador depende de la tabla (Removable Denture)
    // fila en blanco de quien solo crea órdenes de un producto: el producto ya viene puesto
    if (nueva && tabla === 'principal' && dsSoloPropias() && DS.diaData && DS.diaData.creaProducto) f = Object.assign({producto: DS.diaData.creaProducto}, f);
    var html = '<tr data-id="' + (nueva ? 'nuevo' : f.id) + '"' + (nueva ? ' class="ds-fila-nueva"' : '') + '>';
    spec.forEach(function(c, i) {
      var g = c.g ? 'ds-g-' + c.g + (c.g !== (spec[i - 1] || {}).g ? ' ds-g-ini' : '') : '';
      if (c.t === 'calc') { html += '<td data-col="' + i + '" class="ds-calc ' + g + '" data-calc="' + c.k + '">' + dsCalcTxt(c.k, f) + '</td>'; return; }
      html += '<td data-col="' + i + '"' + (g ? ' class="' + g + '"' : '') + '>' + dsCeldaInput(c, f) + '</td>';
      if (c.k === 'fHold' && !c.sinTHold) html += '<td class="ds-thold">' + dsTHoldTxt(f) + '</td>';
      (c.extra || []).forEach(function(x) { html += '<td class="ds-calc ds-g-' + c.g + '" data-calc="' + x.k + '">' + dsCalcTxt(x.k, f) + '</td>'; });
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
    if (!dsQcFinal(f)) return false;  // Material Change: se oculta con el QC de Zirconia
    var g = DS.qcGracia[f.id];
    return !(g && Date.now() - g < 30000);
  }
  function dsEsCancelada(f) { return String(f.estado || '').trim().toLowerCase() === 'canceled'; }
  DS.cancelGracia = {}; DS.estadoVisto = {};
  function dsBtnOjo(id) {
    return '<button type="button" class="ds-btn-ojo" data-ojo="' + id + '" title="Ocultar esta fila" aria-label="Ocultar o mostrar esta fila" onclick="dsOjoFila(' + id + ')">👁</button>';
  }
  // «Mostrar ocultas» es un ojo (Rosember, 26-oct-2026; inspirado en «Hide» de Chad Urbanick en Dribbble): con las órdenes ocultas
  // el ojo está tachado y apagado; al tocarlo parpadea, la raya se borra y lanza una onda; al volver a ocultarlas, al revés.
  // El número de órdenes ocultas va en una insignia. La animación es solo CSS (clases .mostrando y .pulso).
  var DS_OJO_SVG = '<svg class="ds-ojo-svg" viewBox="0 0 24 24" aria-hidden="true"><g class="ojo-g"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/>' +
    '<circle class="ojo-pup" cx="12" cy="12" r="3"/></g><path class="ojo-raya" pathLength="1" d="M4 20L20 4"/></svg><span class="ds-oc-n"></span>';
  function dsOjoBtn(btn, ver, n) {
    if (!btn.querySelector('.ds-ojo-svg')) btn.innerHTML = DS_OJO_SVG;
    var antes = btn.classList.contains('mostrando');
    btn.classList.toggle('mostrando', !!ver);
    if (btn.dataset.listo && antes !== !!ver) {   // onda y parpadeo solo cuando de verdad cambia (no en cada refresco en vivo)
      btn.classList.remove('pulso'); void btn.offsetWidth; btn.classList.add('pulso');
      clearTimeout(btn._pulso); btn._pulso = setTimeout(function() { btn.classList.remove('pulso'); }, 700);
    }
    btn.dataset.listo = '1';
    var num = btn.querySelector('.ds-oc-n'); num.textContent = n; num.hidden = !n;
    btn.setAttribute('aria-pressed', ver ? 'true' : 'false');
    btn.setAttribute('aria-label', ver ? 'Volver a ocultar las órdenes ocultas (' + n + ')' : 'Mostrar las órdenes ocultas (' + n + ')');
    btn.title = ver ? 'Ocultar (' + n + '): vuelve a ocultar las órdenes con QC, las canceladas y las que ocultaste'
                    : 'Mostrar ocultas (' + n + '): muestra las órdenes con QC, las canceladas y las que ocultaste (atenuadas)';
  }
  function dsAplicarOcultas(tabla) {
    var btn = document.getElementById('dsOcultas_' + tabla);
    var sw = btn && btn.parentNode.querySelector('.ds-auto-oc');
    if (sw) { sw.style.display = DS.diaData ? '' : 'none'; sw.querySelector('input').checked = dsColoresFila(); }
    if (!window.DS_GESTION || !DS.diaData || !DS_CONT[tabla]) { if (btn) btn.style.display = 'none'; return; }
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
      var tr = document.querySelector('#' + DS_CONT[tabla] + ' tr[data-id="' + f.id + '"]');
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
      dsOjoBtn(btn, DS.verOcultas, n);
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
  window.dsVerOcultas = function() { DS.verOcultas = !DS.verOcultas; DS_TABLAS.forEach(dsAplicarOcultas); };
  window.dsOjoFila = function(id) {
    var man = dsOcultasLeer(), f = null;
    DS_TABLAS.forEach(function(t) { f = f || (DS.diaData[t] || []).find(function(x) { return x.id === id; }); });
    if (!f) return;
    if (dsEstaOculta(f, man)) man[id] = (dsQcFinal(f) || dsEsCancelada(f)) ? 'visible' : undefined; else man[id] = 'oculta';
    if (man[id] === undefined) delete man[id];
    dsOcultasGuardar(man);
    DS_TABLAS.forEach(dsAplicarOcultas);
  };

  function dsBtnEliminar(id) {
    return '<button type="button" class="ds-btn-x" title="Eliminar orden" onclick="dsEliminarFila(' + id + ')">✕</button>';
  }

  function dsConectarFila(tr, tabla) {
    tr.querySelectorAll('[data-campo]').forEach(function(input) {
      if (dsEsCampoQc(input.dataset.campo)) {
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
        if (input.value === '__colores') { dsAbrirColores(tr, tabla, input); return; }
        if (input.value === '__bitefinish') { dsBiteFinish(tr, tabla, input); return; }
        if (input.dataset.campo === 'estado' && input.value === 'Approved' && !dsPuedeAprobar(tr, tabla, input)) {
          if (DS_COLOR_TIPO.estado) dsPintarCelda(input);
          return;
        }
        if (DS_COLOR_TIPO[input.dataset.campo]) dsPintarCelda(input);
        if (input.dataset.campo === 'designerId' && input.value === '__otro') { dsElegirPrestado(tr, tabla, input); return; }
        if (input.dataset.campo === 'designerId' && input.value === '__training') { dsMoverATraining(tr, tabla, input); return; }
        if (input.dataset.campo === 'designerId' && input.value === '__ayuda') { dsPedirAyuda(tr, input); return; }
        if (input.dataset.campo === 'designerId' && input.value === '__support') { dsAsignarSupport(tr, tabla, input); return; }
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
  // Pedir ayuda (Solicitar ayuda): la orden queda ligada a la solicitud y, cuando otro aprobador elige a alguien, el
  // diseñador se pone solo como Diseñador de esta orden (llega por el aviso en vivo). Ver static/design/ayuda.js.
  function dsPedirAyuda(tr, sel) {
    sel.value = sel.dataset.previo || '';   // la celda conserva lo que tenía mientras llega la respuesta
    var id = parseInt(tr.dataset.id);
    if (!id) { dsToast('Guarda primero la orden (número y centro) para pedir ayuda.'); return; }
    if (window.DSAyuda) window.DSAyuda.solicitar(id);
  }
  // «🛟 Support Designer»: el servidor dice quién está de turno en Support ahora (o quién cubre ese turno)
  function dsAsignarSupport(tr, tabla, sel) {
    sel.value = sel.dataset.previo || '';
    api('/design/api/support/en-turno').then(function(d) {
      if (!tr.isConnected) return;
      var v = String(d.id);
      if (!sel.querySelector('option[value="' + v + '"]')) {
        var opt = document.createElement('option'); opt.value = v; opt.text = (d.corto || d.nombre) + ' (Support)'; opt.title = d.nombre;
        sel.insertBefore(opt, sel.querySelector('option[value^="__"]'));
      }
      sel.value = v;
      dsGuardarFila(tr, tabla);
      dsToast('Asignado a ' + d.nombre + ' · Support de turno (' + d.turnoNombre + ')' + (d.cubre ? ', cubriendo a ' + d.cubre : '') + '.');
    }).catch(function(e) { alert('No se pudo asignar a Support: ' + e.message); });
  }
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

  // Tras guardar el QC (de cualquiera de los dos recuadros): marca la casilla, guarda la fila y, a los aprobadores, les
  // oculta la fila a los 30 s.
  function dsQcGuardado(tr, tabla, chk, reporte) {
    tr._qcReporte = reporte; tr._qcCampoRep = dsCampoReporte(chk);  // Material Change: reporte de Bite o de Zirconia
    chk.checked = true;
    dsGuardarFila(tr, tabla);
    var idQc = parseInt(tr.dataset.id);
    if (window.DS_GESTION && idQc) {  // se oculta a los 30 s (aprobadores)
      var man = dsOcultasLeer(); if (man[idQc] === 'visible') { delete man[idQc]; dsOcultasGuardar(man); }
      DS.qcGracia[idQc] = Date.now();
      setTimeout(function() { dsAplicarOcultas(tabla); }, 30500);
    }
  }

  // QC con lista de hallazgos: títulos generales que se despliegan con los hallazgos preestablecidos del área (N2, Face...).
  // Se guarda como texto en el reporte de QC: una línea por título ("TÍTULO: hallazgo; hallazgo").
  // Los aprobadores y admins agregan títulos y hallazgos nuevos (quedan para toda el área); los admins también los borran.
  var DS_QC_ESPEC = /\(Especificar[^)]*\)/i;
  var DS_QC_OPCIONES = ['Upper', 'Lower', 'Ambos'];
  function dsAbrirQc(tr, tabla, chk) {
    if (tabla === 'prestadas' || !DS.areaId) { dsAbrirQcLibre(tr, tabla, chk); return; }
    // El catálogo depende del área, de la tabla (Cirugías / Nightguards y TC) y del producto de la fila (NG o TC)
    var prod = (tr.querySelector('[data-campo="producto"]') || {}).value || '';
    var url = '/design/api/qc-catalogo?area_id=' + DS.areaId + '&tabla=' + encodeURIComponent(tabla) + '&producto=' + encodeURIComponent(prod);
    window.dsFetchJSON(url).then(function(cat) {
      if (cat && cat.titulos && cat.titulos.length) dsAbrirQcLista(tr, tabla, chk, cat, url); else dsAbrirQcLibre(tr, tabla, chk);
    }).catch(function() { dsAbrirQcLibre(tr, tabla, chk); });
  }
  function dsAbrirQcLista(tr, tabla, chk, cat, urlCatalogo) {
    var id = parseInt(tr.dataset.id);
    var local = (DS.diaData[tabla] || []).find(function(x) { return x.id === id; }) || {};
    var previo = local[dsCampoReporte(chk)] || '';
    var ordenTxt = (tr.querySelector('[data-campo="orden"]') || {}).value || '';
    var titulos = cat.titulos, puedeAgregar = !!cat.puedeAgregar, puedeBorrar = !!cat.puedeBorrar;
    var sel = {}, resto = [], abiertos = {}, conHallazgos = !!previo;   // sel[texto del hallazgo] = {on, op}

    // Lo que ya estaba guardado vuelve a quedar marcado; lo que no está en la lista se conserva como "anterior".
    var base = function(t) { return t.replace(DS_QC_ESPEC, '').replace(/\s+/g, ' ').trim(); };
    var coincide = function(seg) {
      for (var a = 0; a < titulos.length; a++) for (var b = 0; b < titulos[a].items.length; b++) {
        var tx = titulos[a].items[b].texto;
        if (seg === tx) return {texto: tx, op: ''};
        if (DS_QC_ESPEC.test(tx)) { var bs = base(tx) + ' ('; if (seg.indexOf(bs) === 0 && seg.slice(-1) === ')') return {texto: tx, op: seg.slice(bs.length, -1)}; }
      }
      return null;
    };
    previo.split('\n').forEach(function(linea) {
      linea = linea.trim(); if (!linea) return;
      var k = linea.indexOf(': '), tit = k > 0 ? linea.slice(0, k) : '', cuerpo = k > 0 ? linea.slice(k + 2) : linea;
      cuerpo.split('; ').forEach(function(seg) {
        seg = seg.trim(); if (!seg) return;
        var c = coincide(seg);
        if (c) sel[c.texto] = {on: true, op: c.op}; else resto.push({titulo: tit, seg: seg});
      });
    });

    var bg = document.createElement('div'); bg.className = 'ds-qc-bg'; bg.id = 'dsQc';
    bg.innerHTML = '<div class="ds-qc ds-qc-ancho" role="dialog" aria-modal="true" aria-labelledby="dsQcTit">' +
      '<h4 id="dsQcTit"></h4><div class="ds-qc-sub">¿Encontraste algo al revisar esta orden?</div>' +
      '<div class="ds-qc-opciones">' +
        '<label><input type="radio" name="dsQcHallazgo" value="no"' + (previo ? '' : ' checked') + '> Sin hallazgos</label>' +
        '<label><input type="radio" name="dsQcHallazgo" value="si"' + (previo ? ' checked' : '') + '> Con hallazgos</label></div>' +
      '<input type="search" class="ds-qc-buscar" id="dsQcBuscar" placeholder="🔍 Buscar hallazgo…" aria-label="Buscar hallazgo" hidden>' +
      '<div class="ds-qc-lista" id="dsQcLista"></div>' +
      '<div class="ds-qc-err" id="dsQcErr"></div>' +
      '<div class="ds-qc-btns"><button type="button" class="btn gris" data-qc="no">Cancelar</button>' +
      '<button type="button" class="btn" data-qc="si">Guardar QC</button></div></div>';
    document.body.appendChild(bg);
    bg.querySelector('#dsQcTit').textContent = 'Control de calidad' + (ordenTxt ? ' — ' + ordenTxt : '');
    var lista = bg.querySelector('#dsQcLista'), err = bg.querySelector('#dsQcErr');
    // Buscador de hallazgos (Rosember, 26-oct-2026): con la lista larga, deja solo los que coinciden y abre sus títulos
    var buscador = bg.querySelector('#dsQcBuscar');
    var normQc = function(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); };
    buscador.addEventListener('input', function() { pintar(); });
    buscador.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); } });
    var el = function(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
    var mensaje = function(t) { err.textContent = t || ''; };

    var textoFinal = function() {   // el reporte: una línea por título, con los hallazgos marcados
      var lineas = [];
      titulos.forEach(function(t) {
        var partes = [];
        t.items.forEach(function(it) {
          var s = sel[it.texto]; if (!s || !s.on) return;
          partes.push(DS_QC_ESPEC.test(it.texto) ? it.texto.replace(DS_QC_ESPEC, '(' + s.op + ')') : it.texto);
        });
        resto.forEach(function(r) { if (r.titulo === t.titulo) partes.push(r.seg); });
        if (partes.length) lineas.push(t.titulo + ': ' + partes.join('; '));
      });
      var otros = {};
      resto.forEach(function(r) { if (!titulos.some(function(t) { return t.titulo === r.titulo; })) (otros[r.titulo] = otros[r.titulo] || []).push(r.seg); });
      Object.keys(otros).forEach(function(k) { lineas.push((k ? k + ': ' : '') + otros[k].join('; ')); });
      return lineas.join('\n');
    };
    var cuentaTitulo = function(t) {
      return t.items.filter(function(it) { return sel[it.texto] && sel[it.texto].on; }).length + resto.filter(function(r) { return r.titulo === t.titulo; }).length;
    };
    var recargar = function(datos) { titulos = datos.titulos || titulos; pintar(); };
    var llamar = function(url, cuerpo) {   // agrega o quita y vuelve a pedir la lista de esta tabla y producto
      mensaje('');
      return window.dsPostJSON(url, cuerpo).then(function() { return window.dsFetchJSON(urlCatalogo); }).then(recargar)
        .catch(function(e) { mensaje(e.message || 'No se pudo guardar.'); });
    };
    // Campo para agregar (título o hallazgo): aparece donde se pulsa y se confirma con Enter o con el botón
    var campoAgregar = function(rotulo, placeholder, alAgregar) {
      var fila = el('div', 'ds-qc-add'), inp = el('input'); inp.type = 'text'; inp.maxLength = 300; inp.placeholder = placeholder;
      var ok = el('button', 'btn mini', 'Agregar'), no = el('button', 'btn gris mini', 'Cancelar'); ok.type = no.type = 'button';
      var hecho = function() { var v = inp.value.trim(); if (!v) { inp.focus(); return; } alAgregar(v); };
      ok.onclick = hecho; no.onclick = function() { pintar(); };
      inp.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); hecho(); } });
      fila.appendChild(inp); fila.appendChild(ok); fila.appendChild(no);
      setTimeout(function() { inp.focus(); }, 0);
      return fila;
    };

    var pintar = function() {
      lista.innerHTML = '';
      lista.style.display = conHallazgos ? '' : 'none';
      buscador.hidden = !conHallazgos;
      if (!conHallazgos) return;
      var q = normQc(buscador.value.trim()), hay = false;
      titulos.forEach(function(t) {
        // con búsqueda: solo los hallazgos que coinciden (o todos los del título si el título coincide), con el título abierto
        var visibles = !q || normQc(t.titulo).indexOf(q) >= 0 ? t.items : t.items.filter(function(it) { return normQc(it.texto).indexOf(q) >= 0; });
        if (q && !visibles.length) return;
        hay = true;
        var d = el('details', 'ds-qc-tit'); d.open = q ? true : !!abiertos[t.titulo]; d.dataset.titulo = t.titulo;
        d.addEventListener('toggle', function() { if (!q) abiertos[t.titulo] = d.open; });
        var sm = el('summary'); sm.appendChild(el('span', 'ds-qc-tit-n', t.titulo));
        if (puedeBorrar) {   // admins: corregir el nombre del título (Rosember, 21-oct-2026)
          var lap = el('button', 'ds-qc-x ds-qc-ren', '✎'); lap.type = 'button'; lap.title = 'Editar el nombre de este título';
          lap.onclick = function(e) {
            e.preventDefault(); e.stopPropagation();
            var campo = campoAgregar('', 'Nombre del título…', function(v) {
              if (v === t.titulo) { pintar(); return; }
              abiertos[v] = abiertos[t.titulo];
              llamar('/design/api/qc-catalogo/titulo/renombrar', {areaId: DS.areaId, titulo: t.titulo, nuevo: v, tabla: tabla});
            });
            campo.querySelector('input').value = t.titulo;
            campo.querySelector('.btn').textContent = 'Guardar';
            d.replaceWith(campo);
          };
          sm.appendChild(lap);
          // admins: eliminar el título con sus hallazgos (Rosember, 26-oct-2026)
          var bt = el('button', 'ds-qc-x ds-qc-ren', '🗑'); bt.type = 'button';
          bt.title = 'Eliminar este título y sus hallazgos de la lista (los reportes ya guardados no cambian)';
          bt.onclick = function(e) {
            e.preventDefault(); e.stopPropagation();
            if (!confirm('¿Eliminar el título "' + t.titulo + '"' + (t.items.length ? ' y sus ' + t.items.length + ' hallazgos' : '') +
                         ' de la lista? Los reportes de QC ya guardados no cambian.')) return;
            t.items.forEach(function(it) { delete sel[it.texto]; });
            llamar('/design/api/qc-catalogo/titulo/eliminar', {areaId: DS.areaId, titulo: t.titulo, tabla: tabla});
          };
          sm.appendChild(bt);
        }
        var n = cuentaTitulo(t); if (n) sm.appendChild(el('span', 'ds-qc-cnt', String(n)));
        d.appendChild(sm);
        var cuerpo = el('div', 'ds-qc-items');
        visibles.forEach(function(it) {
          var fila = el('label', 'ds-qc-item'), cb = el('input'); cb.type = 'checkbox'; cb.checked = !!(sel[it.texto] && sel[it.texto].on);
          fila.appendChild(cb);
          var espec = DS_QC_ESPEC.test(it.texto);
          fila.appendChild(el('span', 'ds-qc-it-t', espec ? base(it.texto) : it.texto));
          var op = null;
          if (espec) {
            op = el('select', 'ds-qc-op'); op.appendChild(new Option('¿Cuál?', ''));
            DS_QC_OPCIONES.forEach(function(o) { op.appendChild(new Option(o, o)); });
            op.value = (sel[it.texto] && sel[it.texto].op) || ''; op.style.display = cb.checked ? '' : 'none';
            op.onchange = function() { (sel[it.texto] = sel[it.texto] || {on: true}).op = op.value; mensaje(''); };
            fila.appendChild(op);
          }
          cb.onchange = function() {
            sel[it.texto] = {on: cb.checked, op: (sel[it.texto] && sel[it.texto].op) || ''};
            if (op) op.style.display = cb.checked ? '' : 'none';
            var c = cuentaTitulo(t), tag = d.querySelector('.ds-qc-cnt');
            if (c && !tag) sm.appendChild(el('span', 'ds-qc-cnt', String(c))); else if (tag) { if (c) tag.textContent = String(c); else tag.remove(); }
            mensaje('');
          };
          if (puedeBorrar) {
            // admins: corregir el texto del hallazgo (Rosember, 26-oct-2026)
            var ed = el('button', 'ds-qc-x ds-qc-ren', '✎'); ed.type = 'button';
            ed.title = 'Editar el texto de este hallazgo (los reportes ya guardados no cambian)';
            ed.onclick = function(e) {
              e.preventDefault(); e.stopPropagation();
              var campo = campoAgregar('', 'Texto del hallazgo…', function(v) {
                if (v === it.texto) { pintar(); return; }
                if (sel[it.texto]) { sel[v] = sel[it.texto]; delete sel[it.texto]; }
                abiertos[t.titulo] = true;
                llamar('/design/api/qc-catalogo/' + it.id + '/editar', {texto: v});
              });
              campo.querySelector('input').value = it.texto;
              campo.querySelector('.btn').textContent = 'Guardar';
              fila.replaceWith(campo);
            };
            fila.appendChild(ed);
            var x = el('button', 'ds-qc-x', '🗑'); x.type = 'button'; x.title = 'Quitar este hallazgo de la lista (los reportes ya guardados no cambian)';
            x.onclick = function(e) {
              e.preventDefault();
              if (!confirm('¿Quitar "' + it.texto + '" de la lista de hallazgos?')) return;
              delete sel[it.texto]; llamar('/design/api/qc-catalogo/' + it.id + '/eliminar', {});
            };
            fila.appendChild(x);
          }
          cuerpo.appendChild(fila);
        });
        resto.forEach(function(r, i) {
          if (r.titulo !== t.titulo) return;
          var fila = el('div', 'ds-qc-item ds-qc-previo'); fila.appendChild(el('span', 'ds-qc-it-t', r.seg + '  (guardado antes)'));
          var q = el('button', 'ds-qc-x', '✕'); q.type = 'button'; q.title = 'Quitar'; q.onclick = function() { resto.splice(i, 1); pintar(); };
          fila.appendChild(q); cuerpo.appendChild(fila);
        });
        if (puedeAgregar) {
          var mas = el('button', 'ds-qc-mas', '+ Agregar hallazgo a ' + t.titulo); mas.type = 'button';
          mas.onclick = function() {
            var campo = campoAgregar('', 'Escribe el hallazgo nuevo…', function(v) { abiertos[t.titulo] = true; llamar('/design/api/qc-catalogo/hallazgo', {areaId: DS.areaId, titulo: t.titulo, texto: v, tabla: tabla}); });
            mas.replaceWith(campo);
          };
          cuerpo.appendChild(mas);
        }
        d.appendChild(cuerpo); lista.appendChild(d);
      });
      if (q && !hay) lista.appendChild(el('div', 'ds-qc-vacio', 'Ningún hallazgo coincide con «' + buscador.value.trim() + '».'));
      var sueltos = resto.filter(function(r) { return !titulos.some(function(t) { return t.titulo === r.titulo; }); });
      if (sueltos.length) {
        var bloque = el('div', 'ds-qc-sueltos'); bloque.appendChild(el('div', 'ds-qc-sub', 'Guardado antes (no está en la lista):'));
        sueltos.forEach(function(r) {
          var fila = el('div', 'ds-qc-item ds-qc-previo'); fila.appendChild(el('span', 'ds-qc-it-t', (r.titulo ? r.titulo + ': ' : '') + r.seg));
          var q = el('button', 'ds-qc-x', '✕'); q.type = 'button'; q.onclick = function() { resto.splice(resto.indexOf(r), 1); pintar(); };
          fila.appendChild(q); bloque.appendChild(fila);
        });
        lista.appendChild(bloque);
      }
      if (puedeAgregar) {
        var nuevo = el('button', 'ds-qc-mas ds-qc-nuevo', '+ Nuevo título'); nuevo.type = 'button';
        nuevo.onclick = function() {
          nuevo.replaceWith(campoAgregar('', 'Nombre del título nuevo…', function(v) { llamar('/design/api/qc-catalogo/titulo', {areaId: DS.areaId, titulo: v, tabla: tabla}); }));
        };
        lista.appendChild(nuevo);
      }
    };
    bg.querySelectorAll('input[name="dsQcHallazgo"]').forEach(function(r) {
      r.addEventListener('change', function() { conHallazgos = bg.querySelector('input[name="dsQcHallazgo"]:checked').value === 'si'; mensaje(''); pintar(); });
    });
    pintar();

    var cerrar = function() { bg.remove(); document.removeEventListener('keydown', teclas, true); chk.focus(); };
    var guardar = function() {
      if (!conHallazgos) { cerrar(); dsQcGuardado(tr, tabla, chk, ''); return; }
      var falta = null;
      titulos.forEach(function(t) { t.items.forEach(function(it) { var s = sel[it.texto]; if (s && s.on && DS_QC_ESPEC.test(it.texto) && !s.op) falta = falta || it; }); });
      if (falta) { mensaje('Elige si es Upper, Lower o Ambos en "' + base(falta.texto) + '".'); abiertos[titulos.filter(function(t) { return t.items.indexOf(falta) >= 0; })[0].titulo] = true; pintar(); return; }
      var reporte = textoFinal().trim();
      if (!reporte) { mensaje('Elige al menos un hallazgo o marca "Sin hallazgos".'); return; }
      cerrar(); dsQcGuardado(tr, tabla, chk, reporte);
    };
    var teclas = function(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(); }
      else if (e.key === 'Enter' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'SUMMARY') { e.preventDefault(); e.stopPropagation(); guardar(); }
    };
    document.addEventListener('keydown', teclas, true);
    bg.querySelector('[data-qc="si"]').onclick = guardar;
    bg.querySelector('[data-qc="no"]').onclick = cerrar;
    bg.addEventListener('mousedown', function(e) { if (e.target === bg) cerrar(); });
  }

  // Recuadro de QC sin lista: "¿Hallazgos?" Sí/No + comentario (obligatorio si hubo hallazgos). Se usa donde el área
  // todavía no tiene lista de hallazgos. Se guarda en el reporte de QC de la orden: vacío = sin hallazgos.
  function dsAbrirQcLibre(tr, tabla, chk) {
    var id = parseInt(tr.dataset.id);
    var local = (DS.diaData[tabla] || []).find(function(x) { return x.id === id; }) || {};
    var previo = local[dsCampoReporte(chk)] || '';
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
      cerrar();
      dsQcGuardado(tr, tabla, chk, reporte);
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
  // Estados que solo aplican a TC y Nightguards: se ofrecen en la tabla de Nightguards/TC y en filas con ese producto
  // (pedido por Rosember el 12-oct-2026; ver estado_changes_ready_una_vez en services_design.py).
  var DS_ESTADOS_SOLO_NG = ['changes ready'];
  // Hold solo después de iniciar (Rosember, 21-oct-2026; el servidor también lo valida: orden_iniciada en services_design.py).
  // Material Change y Removable Denture miran la etapa en curso (Zirconia / Denture usan zHoraInicio).
  function dsHoldPermitido(f) {
    if (!f || dsEsHoldEstado(f.estado) || dsNorm(f.estado) === 'meeting') return true;   // de Meeting (N2) sí se pasa a Hold (27-oct-2026)
    return !!String((dsEsZirconia(f) ? f.zHoraInicio : f.horaInicio) || '').trim();
  }
  function dsEsHoldEstado(e) { return dsNorm(e) === 'hold'; }
  function dsAjustarOpcionHold(tr, f) {
    var sel = tr && tr.querySelector('select[data-campo="estado"]');
    if (!sel) return;
    var ok = dsHoldPermitido(f);
    [].forEach.call(sel.options, function(o) {
      if (dsEsHoldEstado(o.value) && o.value !== sel.value) { o.hidden = !ok; o.disabled = !ok; o.title = ok ? '' : 'Primero inicia la orden (Initiated)'; }
    });
  }
  // N3 › Cirugías (Rosember, 21-oct-2026): de «Pickup received» solo se pasa a «Ready to design» (que marca el RTD de la
  // articulación); los estados de diseño se ocultan hasta entonces. El servidor también lo valida (pickup_salta).
  var DS_PICKUP_SIGUE = ['pickup received', 'ready to design', 'order entered', 'canceled', 'cancelled', 'skipped', 'skip'];
  function dsAjustarOpcionPickup(tr, f) {
    var sel = tr && tr.querySelector('select[data-campo="estado"]');
    if (!sel) return;
    var bloquear = !!f && dsNorm(f.estado) === 'pickup received' && dsAreaNombre() === 'N3 Prosthetic' && !!tr.closest('#dsTablaPrincipal');
    [].forEach.call(sel.options, function(o) {
      var libre = !o.value || o.value.charAt(0) === '_' || DS_PICKUP_SIGUE.indexOf(dsNorm(o.value)) >= 0;
      if (bloquear && !libre) { o.hidden = true; o.disabled = true; o.title = 'Primero marca Ready to design'; o.dataset.pk = '1'; }
      else if (o.dataset.pk) { o.hidden = false; o.disabled = false; o.title = ''; delete o.dataset.pk; }
    });
  }
  // «Bite Finish» (Rosember, 21-oct-2026): en las órdenes de N3 / N6 con copia en Removable Denture, al final de la lista de
  // estados (arriba de «Colores…»). No es un estado: pone el FINISH de Bite design en Removable, la deja en Ready to design
  // y avisa a Nestor (api_bite_finish). La orden de N3 se queda en el estado que tenía.
  function dsAjustarOpcionBite(tr, f) {
    var sel = tr && tr.querySelector('select[data-campo="estado"]');
    if (!sel) return;
    var vieja = sel.querySelector('option[value="__bitefinish"]');
    if (vieja) vieja.remove();
    if (!f || !f.rdBite) return;
    var o = document.createElement('option');
    o.value = '__bitefinish';
    o.text = f.rdBite === 'hecho' ? 'Bite Finish ✓' : 'Bite Finish';
    o.disabled = f.rdBite === 'hecho';
    o.title = f.rdBite === 'hecho' ? 'El Bite design ya se marcó como terminado en Removable Denture' : 'Termina el Bite design en Removable Denture y avisa a Nestor';
    sel.insertBefore(o, sel.querySelector('option[value="__colores"]'));
  }
  function dsBiteFinish(tr, tabla, sel) {
    var f = (DS.diaData && DS.diaData[tabla] || []).find(function(o) { return String(o.id) === tr.dataset.id; });
    sel.value = f && f.estado != null ? f.estado : (sel.dataset.valorActual || '');
    if (DS_COLOR_TIPO.estado) dsPintarCelda(sel);
    if (!f || !confirm('¿Marcar el FINISH de Bite design ahora? La orden pasa a Ready to design en Removable Denture y le llega el aviso a Nestor.')) return;
    fetch('/design/api/ordenes/' + f.id + '/bite-finish', {method: 'POST', credentials: 'same-origin'})
      .then(function(r) { return r.json().then(function(d) { return {ok: r.ok, d: d}; }); })
      .then(function(x) {
        if (!x.ok) { dsToast(x.d.detail || 'No se pudo marcar el Bite Finish.'); return; }
        f.rdBite = 'hecho';
        dsAjustarOpcionBite(tr, f);
        dsToast('✔ Bite Finish ' + x.d.finish + ': Removable Denture quedó en Ready to design y se avisó a Nestor.');
      }).catch(function() { dsToast('No se pudo marcar el Bite Finish.'); });
  }
  function dsFilaEsNG(sel, tabla) {
    if (tabla === 'nightguard') return true;
    var tr = sel.closest('tr'), p = tr && tr.querySelector('[data-campo="producto"]');
    return !!p && dsEsProductoNG(p.dataset.valorActual || p.value || '');
  }
  function dsPoblarCatalogos(root, spec, tabla) {
    spec.forEach(function(c) {
      if (c.t !== 'catalogo') return;
      dsCatalogo(c.cat).then(function(valores) {
        // Nightguards / TC: sus productos (TC, Nightguard y los de DS_PRODUCTOS_SOLO_NG) y, al final, los de Material Change
        // (pedido por Rosember el 12-oct-2026). Esos tres son de N6: en N3 ya no salen (Rosember, 20-oct-2026)
        // N6 desde el 29-oct-2026: cada tabla solo con sus productos (en la vista del equipo; las prestadas no cambian)
        var listaN6 = c.k === 'producto' && dsN6Separado() && root.id === DS_CONT[tabla] ? DS_PRODUCTOS_N6[tabla] : null;
        if (listaN6) valores = listaN6.map(function(m) { return valores.find(function(v) { return dsNorm(v) === m; }); }).filter(Boolean);
        if (c.k === 'producto' && tabla === 'nightguard') {
          valores = valores.filter(function(v) { return (dsEsProductoNG(v) || dsEsProductoSoloNG(v)) && !dsEsProductoMaterial(v); })
            .concat(dsAreaNombre() === DS_AREA_MATERIAL ? DS_PRODUCTOS_MATERIAL.map(function(m) { return valores.find(function(v) { return dsNorm(v) === m; }); }).filter(Boolean) : []);
        }
        // Material Change: solo sus productos, y esos productos ya no se eligen en Cirugías
        if (c.k === 'producto' && tabla === 'material' && !listaN6) valores = valores.filter(dsEsProductoMaterial);
        if (c.k === 'producto' && tabla === 'principal' && dsAreaNombre() === DS_AREA_MATERIAL && !listaN6) valores = valores.filter(function(v) { return !dsEsProductoMaterial(v); });
        // Los productos solo de Nightguards / TC (Scan/Measurements) no se eligen en Cirugías de las áreas que tienen las dos tablas;
        // una orden que ya lo tenga lo sigue mostrando (la opción actual se conserva)
        if (c.k === 'producto' && tabla === 'principal' && DS.areaFormato === 'dual') valores = valores.filter(function(v) { return !dsEsProductoSoloNG(v); });
        root.querySelectorAll('select[data-campo="' + c.k + '"]').forEach(function(sel) {
          var actual = sel.dataset.valorActual || '';
          valores.forEach(function(v) {
            if (c.k === 'estado' && v !== actual && DS_ESTADOS_SOLO_NG.indexOf(String(v).trim().toLowerCase()) >= 0 && !dsFilaEsNG(sel, tabla)) return;
            // «Changes» también en Cirugías/Dummy de N6 (Rosember, 19-oct-2026); «Dr authorization» sigue siendo solo de Material Change
            var changesN6 = dsNorm(v) === 'changes' && dsTablaBase(tabla) === 'principal' && dsAreaNombre() === DS_AREA_MATERIAL;
            if (c.k === 'estado' && v !== actual && DS_ESTADOS_SOLO_MATERIAL.indexOf(dsNorm(v)) >= 0 && !dsFilaEsMaterial(sel, tabla) && !changesN6) return;
            if (!sel.querySelector('option[value="' + CSS.escape(v) + '"]')) {
              var opt = document.createElement('option'); opt.value = v; opt.text = v; sel.appendChild(opt);
            }
          });
          var conColor = c.k === 'centro' || c.k === 'estado' || (c.k === 'producto' && dsColoresProductos());
          if (conColor) {   // «Colores…» siempre al final de la lista
            var oc = sel.querySelector('option[value="__colores"]');
            if (oc) oc.remove();
            sel.insertAdjacentHTML('beforeend', DS_OPCION_COLORES);
          }
          if (actual) sel.value = actual;
          if (c.k === 'estado') {   // Hold solo después de iniciar
            var trH = sel.closest('tr'), idH = trH ? parseInt(trH.dataset.id, 10) : NaN;
            var fH = isNaN(idH) ? null : (DS.diaData && (DS.diaData[tabla] || []).find(function(x) { return x.id === idH; }));
            dsAjustarOpcionHold(trH, fH || {estado: actual});
            dsAjustarOpcionPickup(trH, fH || {estado: actual});
            dsAjustarOpcionBite(trH, fH);
          }
          if (conColor) dsPintarCelda(sel);
        });
      });
    });
  }

  // ---------- Colores de diseñadores y centros (19-oct-2026) ----------
  // Cada equipo pinta las casillas de Diseñador y Centro con el color que quiera, desde la opción «🎨 Colores…» al final de
  // esas listas. Desde el 19-oct-2026 los colores son DEL EQUIPO (base de datos, /design/api/teams/{id}/colores): los pone
  // el manager y los ven sus diseñadores y quien abra ese Schedule. Lo que cada manager tenía en su navegador se sube
  // solo la primera vez (dsColoresSubirLocales); el navegador queda como respaldo si el servidor aún no tiene colores.
  var DS_OPCION_COLORES = '<option value="__colores">Colores…</option>';   // solo texto (Rosember, 20-oct-2026)
  // Qué casillas se pueden pintar: d = diseñador (por id), c = centro, p = producto (solo N2), e = estado (Rosember, 19-oct-2026)
  var DS_COLOR_TIPO = {designerId: 'd', centro: 'c', producto: 'p', estado: 'e'};
  var DS_COLOR_NOMBRE = {d: ['diseñadores', 'diseñador'], c: ['centros', 'centro'], p: ['productos', 'producto'], e: ['estados', 'estado']};
  function dsColoresProductos() { return dsAreaNombre() === 'N2 Demodenture'; }
  function dsColoresVacio(x) { return ['d', 'c', 'p', 'e'].every(function(k) { return !Object.keys(x[k] || {}).length; }); }
  function dsColoresCopia(x) { var r = {}; ['d', 'c', 'p', 'e'].forEach(function(k) { r[k] = Object.assign({}, (x && x[k]) || {}); }); return r; }
  var DS_COLORES = [
    {k: 'rojo', n: 'Rojo', c: '239,68,68'}, {k: 'naranja', n: 'Naranja', c: '249,115,22'}, {k: 'amarillo', n: 'Amarillo', c: '234,179,8'},
    {k: 'lima', n: 'Lima', c: '132,204,22'}, {k: 'verde', n: 'Verde', c: '34,197,94'}, {k: 'turquesa', n: 'Turquesa', c: '20,184,166'},
    {k: 'celeste', n: 'Celeste', c: '14,165,233'}, {k: 'azul', n: 'Azul', c: '59,130,246'}, {k: 'morado', n: 'Morado', c: '139,92,246'},
    {k: 'rosado', n: 'Rosado', c: '236,72,153'}, {k: 'cafe', n: 'Café', c: '161,98,7'}, {k: 'gris', n: 'Gris', c: '107,114,128'}
  ];
  function dsColoresClave() { return 'dsColores:' + DS.teamId; }
  function dsColoresLocales() {
    try { return dsColoresCopia(JSON.parse(localStorage.getItem(dsColoresClave()) || '{}')); }
    catch (e) { return dsColoresCopia(null); }
  }
  function dsColoresLeer() {
    var srv = DS.diaData && DS.diaData.colores;
    if (srv) return dsColoresCopia(srv);
    return dsColoresLocales();
  }
  var dsColoresT = null;
  function dsColoresEnviar(x) {
    var team = DS.teamId;
    return fetch('/design/api/teams/' + team + '/colores', {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({d: x.d, c: x.c, p: x.p || {}, e: x.e || {}})}).then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); })
      .catch(function() { dsToast('No se pudieron guardar los colores del equipo; se reintenta al volver a elegir.'); });
  }
  function dsColoresGuardar(x) {
    try { localStorage.setItem(dsColoresClave(), JSON.stringify(x)); } catch (e) {}
    if (!(DS.diaData && DS.diaData.puedeColores)) return;
    DS.diaData.colores = dsColoresCopia(x);   // se ve al instante; el servidor avisa a los demás
    clearTimeout(dsColoresT); dsColoresT = setTimeout(function() { dsColoresEnviar(x); }, 500);
  }
  // Una sola vez por equipo: si el manager tenía colores en este PC y el equipo aún no tiene en el servidor, se suben
  function dsColoresSubirLocales() {
    if (!(DS.diaData && DS.diaData.puedeColores) || DS.diaData.colores) return;
    var x = dsColoresLocales();
    if (dsColoresVacio(x)) return;
    DS.diaData.colores = x;
    dsColoresEnviar(x);
  }
  function dsColorRgb(k) { var c = DS_COLORES.find(function(x) { return x.k === k; }); return c ? c.c : null; }
  // Pinta una casilla según su valor (diseñador por id, centro por nombre). Fondo suave + borde a la izquierda: se lee en claro y oscuro.
  function dsColoresDeFila(el) {   // Removable Denture: los colores del equipo de origen de esa fila
    var tr = el.closest('tr'), f = tr && (DS.diaData.material || []).find(function(o) { return String(o.id) === tr.dataset.id; });
    return dsColoresCopia(f && (DS.diaData.coloresEquipos || {})[String(f.teamOrigen)]);
  }
  function dsPintarCelda(sel, colores) {
    if (!sel || !sel.closest('#dsTablaMaterial, #dsTablaTibar, #dsTablaDummy, #dsTablaPrincipal, #dsTablaNightguard')) return;   // las prestadas son de otro equipo
    if (dsEsRD()) colores = dsColoresDeFila(sel);
    var x = colores || dsColoresLeer(), campo = sel.dataset.campo, tipo = DS_COLOR_TIPO[campo];
    if (tipo === 'p' && !dsColoresProductos()) return;
    var v = campo === 'designerId' ? sel.value : (sel.value || sel.dataset.valorActual || '');
    var rgb = dsColorRgb((x[tipo] || {})[v]);
    // 'important': en modo oscuro las filas con color de estado vuelven transparentes sus casillas (oscuro.css)
    if (rgb) sel.style.setProperty('background-color', 'rgba(' + rgb + ',.22)', 'important'); else sel.style.removeProperty('background-color');
    sel.style.boxShadow = rgb ? 'inset 4px 0 0 rgb(' + rgb + ')' : '';
  }
  // Tarjetas de Tiempos libres: el borde y un fondo suave con el color asignado en el Schedule (diseñadores y managers).
  // Sin color, el manager conserva su borde oscuro de siempre (ds-tl-mgr).
  function dsPintarTarjetaTL(card, d) {
    if (!card) return;
    var rgb = dsColorRgb((dsColoresLeer().d || {})[String(d.id)]);
    card.style.boxShadow = rgb ? 'inset 4px 0 0 rgb(' + rgb + ')' : '';
    card.style.background = rgb ? 'rgba(' + rgb + ',.10)' : '';
  }
  function dsPintarTarjetasTL() {
    document.querySelectorAll('#dsBreaks .ds-tl-card').forEach(function(card) {
      dsPintarTarjetaTL(card, {id: +card.dataset.empleadoId});
    });
  }
  function dsPintarColores(scope) {
    var x = dsColoresLeer();
    dsPintarTarjetasTL();
    (scope || document).querySelectorAll('select[data-campo="designerId"], select[data-campo="centro"], select[data-campo="producto"], select[data-campo="estado"]').forEach(function(s) { dsPintarCelda(s, x); });
    if (dsEsRD()) (scope || document).querySelectorAll('#dsTablaMaterial span.ds-ro[data-ro="centro"]').forEach(function(sp) {
      var rgb = dsColorRgb((dsColoresDeFila(sp).c || {})[sp.textContent.trim()]), td = sp.closest('td');
      if (rgb) td.style.setProperty('background-color', 'rgba(' + rgb + ',.22)', 'important'); else td.style.removeProperty('background-color');
      td.style.boxShadow = rgb ? 'inset 4px 0 0 rgb(' + rgb + ')' : '';
    });
  }
  // La lista vuelve a lo que tenía (la opción «Colores…» nunca se guarda en la orden) y se abre la ventana de colores.
  function dsAbrirColores(tr, tabla, sel) {
    var f = (DS.diaData && DS.diaData[tabla] || []).find(function(o) { return String(o.id) === tr.dataset.id; });
    var campo = sel.dataset.campo, previo = f ? f[campo] : (campo === 'designerId' ? sel.dataset.previo : sel.dataset.valorActual);
    sel.value = previo == null ? '' : String(previo);
    var nombres = [];
    if (campo === 'designerId') {
      Array.prototype.forEach.call(sel.options, function(o) {
        if (o.value && o.value.indexOf('__') !== 0) nombres.push({id: o.value, nombre: o.text.replace(/ \((manager|ayuda|prestado|ya no está)\)$/, '')});
      });
    } else {
      Array.prototype.forEach.call(sel.options, function(o) { if (o.value && o.value !== '__colores') nombres.push({id: o.value, nombre: o.value}); });
      nombres.sort(function(a, b) { return a.nombre.localeCompare(b.nombre, 'es', {sensitivity: 'base'}); });
    }
    dsModalColores(DS_COLOR_TIPO[campo], nombres, sel.value);
  }
  function dsModalColores(tipo, nombres, actual) {
    var x = dsColoresLeer(), mapa = x[tipo];
    var bg = document.createElement('div'); bg.className = 'ds-qc-bg'; bg.id = 'dsColores';
    bg.innerHTML = '<div class="ds-qc ds-col-modal" role="dialog" aria-modal="true" aria-labelledby="dsColTit">' +
      '<h4 id="dsColTit">Colores de ' + DS_COLOR_NOMBRE[tipo][0] + '</h4>' +
      '<div class="ds-qc-sub">Elige un color para cada ' + DS_COLOR_NOMBRE[tipo][1] + '. ' + (DS.diaData && DS.diaData.puedeColores ? 'Los ve todo el equipo en este Schedule, también sus diseñadores.' : 'Solo se ve en este computador.') + '</div>' +
      '<div class="ds-col-lista"></div>' +
      '<div class="ds-qc-btns"><button type="button" class="btn gris" data-col="quitar">Quitar todos</button><button type="button" class="btn" data-col="listo">Listo</button></div></div>';
    document.body.appendChild(bg);
    var lista = bg.querySelector('.ds-col-lista');
    nombres.forEach(function(n) {
      var fila = document.createElement('div'); fila.className = 'ds-col-fila' + (n.id === actual ? ' ds-col-actual' : '');
      var nom = document.createElement('span'); nom.className = 'ds-col-nombre'; nom.textContent = n.nombre;
      var pal = document.createElement('div'); pal.className = 'ds-col-paleta';
      var marcar = function() {
        var rgb = dsColorRgb(mapa[n.id]);
        nom.style.backgroundColor = rgb ? 'rgba(' + rgb + ',.22)' : ''; nom.style.boxShadow = rgb ? 'inset 4px 0 0 rgb(' + rgb + ')' : '';
        pal.querySelectorAll('button').forEach(function(b) { b.setAttribute('aria-pressed', String((b.dataset.k || '') === (mapa[n.id] || ''))); });
      };
      [{k: '', n: 'Sin color'}].concat(DS_COLORES).forEach(function(c) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'ds-col-punto' + (c.k ? '' : ' ds-col-sin');
        b.dataset.k = c.k; b.title = c.n; b.setAttribute('aria-label', n.nombre + ': ' + c.n);
        if (c.c) b.style.background = 'rgb(' + c.c + ')';
        b.onclick = function() { if (c.k) mapa[n.id] = c.k; else delete mapa[n.id]; dsColoresGuardar(x); marcar(); dsPintarColores(); };
        pal.appendChild(b);
      });
      fila.appendChild(nom); fila.appendChild(pal); lista.appendChild(fila); marcar();
    });
    if (!nombres.length) lista.innerHTML = '<p class="ds-prest-vacio">No hay nombres en esta lista.</p>';
    var teclas = function(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(); } };
    var cerrar = function() { bg.remove(); document.removeEventListener('keydown', teclas, true); };
    bg.querySelector('[data-col="listo"]').onclick = cerrar;
    bg.querySelector('[data-col="quitar"]').onclick = function() {
      if (!confirm('¿Quitar todos los colores de ' + DS_COLOR_NOMBRE[tipo][0] + ' de este equipo?')) return;
      Object.keys(mapa).forEach(function(k) { delete mapa[k]; }); dsColoresGuardar(x); dsPintarColores(); cerrar();
    };
    bg.addEventListener('mousedown', function(e) { if (e.target === bg) cerrar(); });
    document.addEventListener('keydown', teclas, true);
    var a = lista.querySelector('.ds-col-actual button[aria-pressed="true"]') || lista.querySelector('button'); if (a) a.focus();
    var fa = lista.querySelector('.ds-col-actual'); if (fa) fa.scrollIntoView({block: 'nearest'});
  }

  // Cirugías (Rosember, 28-oct-2026): la tabla sube una fila para que la fila de grupos (Articulation / Design) quede a la
  // altura del título «Cirugías», que no se mueve. Solo si cabe: si los grupos tocarían el título o los botones (pantallas
  // angostas) o hay avisos entre el título y la tabla, queda como antes. Solo la tabla principal.
  function dsSubirTablaPrincipal() {
    var panel = document.getElementById('dsPanelPrincipal'), cont = document.getElementById('dsTablaPrincipal');
    if (!panel || !cont) return;
    var cab = panel.querySelector('.ds-panel-h'), avisos = document.getElementById('dsCopiasPend');
    panel.classList.remove('ds-grupos-arriba');
    var g = cont.querySelector('table.ds-tabla tr.ds-tr-grupos'), ths = g ? g.querySelectorAll('th.ds-gh') : [];
    if (!ths.length || !cab || !panel.offsetParent || (avisos && avisos.offsetHeight)) return;
    var tit = panel.querySelector('.ds-panel-titulo') || cab.firstElementChild, acc = panel.querySelector('.ds-panel-acc');
    var izq = ths[0].getBoundingClientRect().left, der = ths[ths.length - 1].getBoundingClientRect().right;
    if (izq < tit.getBoundingClientRect().right + 16 || (acc && acc.offsetWidth && der > acc.getBoundingClientRect().left - 16)) return;
    var subir = cab.offsetHeight + (parseFloat(getComputedStyle(cab).marginBottom) || 0) + (g.getBoundingClientRect().top - cont.getBoundingClientRect().top);
    panel.style.setProperty('--ds-subir', Math.round(subir) + 'px');
    panel.classList.add('ds-grupos-arriba');
  }
  (function() {   // también al cambiar el ancho de la ventana, los botones del título (ocultas, apoyo) o los avisos
    var t = null, otra = function() { clearTimeout(t); t = setTimeout(dsSubirTablaPrincipal, 60); };
    window.addEventListener('resize', otra);
    try {
      var ro = new ResizeObserver(otra);
      ['dsCopiasPend', 'dsTablaPrincipal'].forEach(function(id) { var e = document.getElementById(id); if (e) ro.observe(e); });
      var acc = document.querySelector('#dsPanelPrincipal .ds-panel-acc'); if (acc) ro.observe(acc);
    } catch (e) {}
  })();
  function dsRenderTabla(tabla) {
    var spec = dsSpec(tabla);
    var cont = document.getElementById(DS_CONT[tabla]);
    var filas = dsFilasOrdenadas(tabla);
    var s = DS.sort[tabla];
    var html = '<table class="ds-tabla' + (dsTablaBase(tabla) === 'material' ? ' ds-tabla-material' + (dsEsRD() ? ' ds-tabla-rd' : '') : '') + '"><thead>' + dsFilaGrupos(spec, 2) + '<tr>';
    spec.forEach(function(c) {
      if (DS_SORTABLES[c.k]) {
        var on = s && s.k === c.k;
        html += '<th class="ds-th-sort' + (on ? ' on' : '') + '" data-sort="' + c.k + '" title="Ordenar alfabéticamente">' + c.l +
                '<span class="ds-sort-ind">' + (on ? (s.dir === 1 ? '▲' : '▼') : '↕') + '</span></th>';
      } else html += '<th' + (c.g ? ' class="ds-g-' + c.g + '"' : '') + '>' + c.l + '</th>';
      html += dsEncabezadoExtra(c);
    });
    html += '<th class="ds-th-total">' + (dsTablaBase(tabla) === 'material' ? 'Total general' : 'Total') + '</th><th></th></tr></thead><tbody>';
    filas.forEach(function(f) { html += dsFilaHtml(spec, f, tabla); });
    if (dsPuedeCrear() && !filas.some(dsFrenaFilaNueva)) html += dsFilaHtml(spec, {}, tabla);
    html += '</tbody></table>';
    DS.renderizando = true; // si la celda con foco desaparece, su "blur" no debe guardar
    try { cont.innerHTML = html; } finally { DS.renderizando = false; }
    cont.querySelectorAll('tbody tr').forEach(function(tr) { dsConectarFila(tr, tabla); dsMarcarFila(tr, tabla); });
    if (tabla === 'principal') dsSubirTablaPrincipal();
    if (dsDiaCerrado()) {
      // Día cerrado: todo en solo lectura; el QC sigue editable hasta las 5:00 am de D+2.
      cont.querySelectorAll('[data-campo]').forEach(function(el) {
        el.disabled = !(dsEsCampoQc(el.dataset.campo) && DS.diaData.qcEditable && DS.diaData.puedeQc !== false);
      });
    }
    if (dsSoloLectura() || (DS.diaData && DS.diaData.soloEditaPropias)) {
      // Training: todos ven todos los casos; quien no es de ese equipo no edita nada y cada entrenado solo edita los suyos
      cont.querySelectorAll('tbody tr').forEach(function(tr) {
        var fila = (DS.diaData[tabla] || []).find(function(x) { return String(x.id) === tr.dataset.id; });
        if (dsSoloLectura() || !fila || fila.designerId !== DS.diaData.miId) tr.querySelectorAll('[data-campo]').forEach(function(el) { el.disabled = true; });
      });
    }
    if (dsSoloPropias()) {
      // Vista del diseñador: edita sus órdenes pero no las reasigna.
      dsBloquearCamposManager(cont);
      dsBloquearHoras(cont, DS.areaFormato, tabla, dsFechaISO(dsFechaSeleccionada()));
      dsAjustarCreaProducto(cont);
      if (dsTablaBase(tabla) === 'material') dsBloquearEtapa(cont);
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
    dsPintarColores(cont);
    dsAplicarOcultas(tabla);
  }

  // Vista del diseñador: solo edita horas, estado, notas y (N3/N6) esferas y crítico; el resto de la orden es del manager.
  var DS_CAMPOS_MANAGER = ['orden', 'paciente', 'centro', 'producto', 'designerId'];
  // En N3 y N6 el diseñador sí edita orden, paciente y producto (pedido por Rosember el 12-oct-2026); centro y diseñador
  // siguen siendo del manager. Igual que AREAS_DISENADOR_EDITA en routers/design_schedule.py.
  var DS_AREAS_DISENADOR_EDITA = ['N3 Prosthetic', 'N6 Material Changes', 'Training'];
  var DS_CAMPOS_DISENADOR_EDITA = ['orden', 'paciente', 'producto'];
  function dsCamposManager(area) {
    if (DS_AREAS_DISENADOR_EDITA.indexOf(area) < 0) return DS_CAMPOS_MANAGER;
    return DS_CAMPOS_MANAGER.filter(function(k) { return DS_CAMPOS_DISENADOR_EDITA.indexOf(k) < 0; });
  }
  // Las horas las llena el estado (Initiated, Hold, Approved): el diseñador no las escribe a mano. Solo donde el estado ya
  // las llena (mismas fechas que horas_por_estado en services_design.py); antes de esas fechas siguen editables.
  var DS_HORAS_CAMPOS = ['horaInicio', 'horaInicioDiseno', 'horaFin', 'sHold', 'fHold', 'holdMinutos',
                         'zHoraInicio', 'zSHold', 'zFHold', 'zHoldMinutos', 'zHoraFin',
                         'xHoraInicio', 'xSHold', 'xFHold', 'xHoldMinutos', 'xHoraFin', 'nHoraInicio', 'nSHold', 'nFHold', 'nHoldMinutos', 'nHoraFin'];
  // Material Change: la etapa cambia sola al aprobar Bite; corregirla es del manager (igual en el servidor)
  function dsBloquearEtapa(scope) {
    scope.querySelectorAll('[data-campo="etapa"]').forEach(function(el) { el.disabled = true; el.title = 'La etapa cambia sola al aprobar Bite design'; });
  }
  function dsHorasPorEstado(formato, tabla, fechaISO) {
    if (formato === 'n2') return fechaISO >= '2026-10-01';   // 21-oct-2026: todo octubre (antes 9-oct; N2_NUEVO_DESDE)
    if (formato === 'dual') return tabla === 'nightguard' ? fechaISO >= DS_NG_NUEVO_DESDE : fechaISO >= DS_DUAL_NUEVO_DESDE;
    if (formato === 'single') return fechaISO >= DS_FACE_NUEVO_DESDE;
    return false;
  }
  function dsBloquearHoras(scope, formato, tabla, fechaISO) {
    if (!dsHorasPorEstado(formato, tabla, fechaISO)) return;
    scope.querySelectorAll('[data-campo]').forEach(function(el) {
      if (DS_HORAS_CAMPOS.indexOf(el.dataset.campo) < 0) return;
      el.disabled = true;
      el.title = 'La hora se registra sola con el estado (Initiated, Hold, Approved)';
    });
  }
  // Quien solo crea órdenes de un producto (DS.diaData.creaProducto, p. ej. Maxilar Print): en la fila en blanco y en sus
  // órdenes de ese producto llena orden, paciente y centro; el producto y el diseñador quedan fijos.
  function dsAjustarCreaProducto(scope) {
    var prod = DS.diaData && DS.diaData.creaProducto;
    if (!prod || !dsSoloPropias()) return;
    scope.querySelectorAll('tbody tr').forEach(function(tr) {
      var p = tr.querySelector('[data-campo="producto"]');
      if (!(tr.dataset.id === 'nuevo' || (p && (p.dataset.valorActual || p.value) === prod))) return;
      ['orden', 'paciente', 'centro'].forEach(function(k) { var el = tr.querySelector('[data-campo="' + k + '"]'); if (el) { el.disabled = false; el.removeAttribute('title'); } });
      ['producto', 'designerId'].forEach(function(k) { var el = tr.querySelector('[data-campo="' + k + '"]'); if (el) { el.disabled = true; el.title = 'Queda fijo'; } });
    });
  }
  function dsBloquearCamposManager(cont, area) {
    var campos = dsCamposManager(area || (DS.areas.find(function(a) { return a.id === DS.areaId; }) || {}).nombre);
    cont.querySelectorAll('[data-campo]').forEach(function(el) {
      if (campos.indexOf(el.dataset.campo) < 0) return;
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
      html += '<h4 class="ds-prest-h">' + dsEsc(g.equipo) + (g.tabla === 'nightguard' ? ' — Nightguards / TC' : g.tabla === 'material' ? ' — Material Change' : g.tabla === 'tibar' ? ' — Over Ti-bar' : g.tabla === 'dummy' ? ' — Dummy' : '') + '</h4>' +
              '<table class="ds-tabla" data-grupo="' + g.teamId + '-' + g.tabla + '"><thead>' + dsFilaGrupos(spec, 2) + '<tr>';
      spec.forEach(function(c) { html += '<th' + (c.g ? ' class="ds-g-' + c.g + '"' : '') + '>' + c.l + '</th>' + dsEncabezadoExtra(c); });
      html += '<th>' + (dsTablaBase(g.tabla) === 'material' ? 'Total general' : 'Total') + '</th><th></th></tr></thead><tbody>';
      g.filas.forEach(function(f) { html += dsFilaHtml(spec, f, 'prestadas'); });
      html += '</tbody></table>';
    });
    DS.renderizando = true;
    try { cont.innerHTML = html; } finally { DS.renderizando = false; }
    cont.querySelectorAll('tbody tr').forEach(function(tr) { dsConectarFila(tr, 'prestadas'); dsMarcarFila(tr, 'prestadas'); });
    cont.querySelectorAll('[data-campo]').forEach(function(el) {
      if (dsDiaCerrado()) el.disabled = !(dsEsCampoQc(el.dataset.campo) && DS.diaData.qcEditable);
    });
    grupos.forEach(function(g) {   // órdenes prestadas: cada tabla con la regla del área de su equipo
      var tb = cont.querySelector('table[data-grupo="' + g.teamId + '-' + g.tabla + '"]');
      if (tb) dsBloquearCamposManager(tb, g.area);
      if (tb && dsTablaBase(g.tabla) === 'material') dsBloquearEtapa(tb);
    });
    grupos.forEach(function(g) {
      var tb = cont.querySelector('table[data-grupo="' + g.teamId + '-' + g.tabla + '"]'), fch = String((g.filas[0] || {}).fecha || '').slice(0, 10) || dsFechaISO(dsFechaSeleccionada());
      if (tb) dsBloquearHoras(tb, g.formato, g.tabla, fch);
    });
    grupos.forEach(function(g) {
      dsPoblarCatalogos(cont.querySelector('table[data-grupo="' + g.teamId + '-' + g.tabla + '"]'), dsSpec(g.tabla, g.formato, g.area), g.tabla);
    });
  }

  function dsTrainingListo(f) { return !!(String(f.orden || '').trim() && String(f.paciente || '').trim() && String(f.centro || '').trim()); }
  function dsOpcionTraining(f) {
    var ok = dsTrainingListo(f);
    return '<option value="__training"' + (ok ? '' : ' disabled') + '>➜ Training' + (ok ? '' : ' (falta orden, paciente o centro)') + '</option>';
  }
  // Training: el caso sale de este Schedule y pasa al de Training (misma orden, queda sin diseñador para la entrenadora)
  function dsMoverATraining(tr, tabla, sel) {
    sel.value = sel.dataset.previo || '';
    var f = (DS.diaData && DS.diaData[tabla] || []).find(function(x) { return x.id === parseInt(tr.dataset.id); });
    if (!f || !dsTrainingListo(f)) return;
    if (!confirm('¿Pasar la orden ' + f.orden + ' (' + f.paciente + ') al Schedule de Training?\n\nSaldrá de este Schedule y la verás en Training.')) return;
    sel.disabled = true;
    fetch('/design/api/ordenes/' + f.id + '/training', {method: 'POST'}).then(function(r) {
      return r.json().catch(function() { return {}; }).then(function(x) { if (!r.ok) throw new Error(typeof x.detail === 'string' ? x.detail : 'HTTP ' + r.status); return x; });
    }).then(function() { dsCargarDia(); })
      .catch(function(e) { sel.disabled = false; alert('No se pudo pasar a Training: ' + e.message); });
  }
  function dsCeldaInput(c, f) {
    var val = f[c.k], al = ' aria-label="' + dsEsc(c.l || c.k) + '"';
    if (c.t === 'ro') return '<span class="ds-ro" data-ro="' + c.k + '">' + dsEsc(val || '') + '</span>';
    if (c.t === 'text') return '<input type="text" data-campo="' + c.k + '"' + al + ' value="' + dsEsc(val || '') + '">';
    if (c.t === 'number') return '<input type="number" step="1" data-campo="' + c.k + '"' + al + ' value="' + dsEsc(val || 0) + '">';
    if (c.t === 'time') return '<input type="time" class="ds-hora" required data-campo="' + c.k + '"' + al + ' value="' + dsEsc(val || '') + '">';
    if (c.t === 'checkbox') {
      var bloq = dsEsCampoQc(c.k) && DS.diaData && DS.diaData.puedeQc === false;  // el QC lo marcan aprobadores y el diseñador a cargo
      return '<input type="checkbox" data-campo="' + c.k + '"' + al + ' ' + (val ? 'checked' : '') +
             (bloq ? ' disabled title="Solo los aprobadores marcan el QC"' : '') + '>';
    }
    if (c.t === 'multi') {   // Crítico (19-oct-2026): varios ítems, guardados como «A; B»
      return '<input type="hidden" data-campo="' + c.k + '" value="' + dsEsc(val || '') + '">' +
             '<button type="button" class="ds-multi" data-opciones="' + dsEsc(JSON.stringify(c.opciones.filter(Boolean))) + '"' + al +
             ' title="' + dsEsc(dsMultiItems(val).join('\n') || 'Elegir uno o varios') + '">' + dsEsc(dsMultiTxt(val)) + '</button>';
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
        if (d.esRD && DS.tablaFila !== 'nightguard' && d.id !== val) return;   // Nestor (Removable Denture): solo en Nightguards / TC
        // primer nombre y primer apellido (el completo, al pasar el cursor): la columna ocupa menos (19-oct-2026)
        html += '<option value="' + d.id + '"' + (d.id === val ? ' selected' : '') + ' title="' + dsEsc(d.nombre) + '">' + dsEsc(d.corto || d.nombre) +
                (d.esManager ? ' (manager)' : '') + (d.esAyuda ? ' (ayuda)' : '') + (d.esRD ? ' (Removable Denture)' : '') + '</option>';
      });
      if (val && !lista.some(function(d) { return d.id === val; })) {
        var esSup = DS.diaData && (DS.diaData.supportIds || []).indexOf(val) >= 0;
        html += '<option value="' + dsEsc(val) + '" selected title="' + dsEsc(f.designerNombre || '') + '">' +
                dsEsc((f.designerCorto || f.designerNombre || 'Diseñador') + (f.designerInhabilitado ? ' (ya no está)' : esSup ? ' (Support)' : ' (prestado)')) + '</option>';
      }
      if (DS.diaData && !DS.diaData.designersCaso && !dsSoloPropias()) html += '<option value="__otro">Others (prestado)…</option>';
      if (f.id && (f.tabla === 'principal' || f.tabla === 'nightguard') && dsAreaNombre() === 'N3 Prosthetic' && !dsSoloPropias() && !dsDiaCerrado()) {   // Cirugías y Nightguards (27-oct-2026)
        html += dsOpcionTraining(f);   // pasa el caso al Schedule de Training (se habilita con orden, paciente y centro)
      }
      // N3: asignar el caso a quien está de turno en Support (o a quien lo cubre) (20-oct-2026)
      if (dsAreaNombre() === 'N3 Prosthetic' && !dsSoloPropias() && !dsDiaCerrado() && DS.diaData && DS.diaData.supportIds) {
        html += '<option value="__support">Support Designer</option>';
      }
      // Pedir ayuda (19-oct-2026): al final de la lista, en las órdenes ya guardadas de hoy del aprobador de un equipo de N3
      html += DS_OPCION_COLORES;   // colores de cada diseñador (preferencia de este PC); «Pedir ayuda…» sigue siendo la última
      if (f.id && DS.diaData && DS.diaData.puedeAyuda && !dsDiaCerrado()) html += '<option value="__ayuda">🤝 Pedir ayuda…</option>';
      return html + '</select>';
    }
    return '';
  }

  // Quiénes se pueden elegir en la columna Diseñador: los diseñadores del equipo y, al final, su manager
  // (Support: todos los diseñadores de Design y al final los managers).
  function dsElegibles() {
    if (!DS.diaData) return [];
    if (DS.diaData.designersCaso) return DS.diaData.designersCaso;
    var base = (DS.diaData.designers || []).concat(DS.diaData.manager ? [DS.diaData.manager] : []);
    // Ayuda del día (Seguimiento › Solicitar ayuda): el diseñador que otro aprobador envió a este equipo
    (DS.diaData.ayudas || []).forEach(function(a) { if (!base.some(function(d) { return d.id === a.id; })) base.push(a); });
    // Removable Denture (Nestor Rojas): al final, para pasarle el caso sin ir a «Others (prestado)» (20-oct-2026)
    (DS.diaData.designersRD || []).forEach(function(a) { if (!base.some(function(d) { return d.id === a.id; })) base.push(a); });
    return base;
  }

  // ---------- Selección múltiple (Crítico de N3) ----------
  function dsMultiItems(v) { return String(v || '').split(/\s*;\s*/).filter(Boolean); }
  function dsMultiTxt(v) { var it = dsMultiItems(v); return !it.length ? '—' : it[0] + (it.length > 1 ? ' +' + (it.length - 1) : ''); }
  function dsMultiPintar(btn, v) { btn.textContent = dsMultiTxt(v); btn.title = dsMultiItems(v).join('\n') || 'Elegir uno o varios'; }
  function dsCerrarMulti() { var p = document.getElementById('dsMultiPop'); if (p && p._cerrar) p._cerrar(); }
  function dsAbrirMulti(btn, hid) {
    dsCerrarMulti();
    var ops = JSON.parse(btn.dataset.opciones || '[]'), inicial = hid.value, sel = dsMultiItems(inicial);
    var pop = document.createElement('div'); pop.className = 'ds-multi-pop'; pop.id = 'dsMultiPop';
    pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Crítico: elige uno o varios');
    pop.innerHTML = '<div class="ds-multi-tit">Crítico · uno o varios</div>' + ops.map(function(o, i) {
      return '<label><input type="checkbox" value="' + dsEsc(o) + '"' + (sel.indexOf(o) >= 0 ? ' checked' : '') + '> ' + dsEsc(o) + '</label>';
    }).join('') + '<div class="ds-multi-acc"><button type="button" class="btn mini">Listo</button></div>';
    document.body.appendChild(pop);
    var r = btn.getBoundingClientRect();
    pop.style.top = Math.min(r.bottom + 4, window.innerHeight - pop.offsetHeight - 8) + 'px';
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8)) + 'px';
    var cajas = pop.querySelectorAll('input[type=checkbox]');
    pop.addEventListener('change', function(e) {   // N/A va sola: elegirla quita las demás y al revés
      var x = e.target;
      if (x.checked) cajas.forEach(function(c) { if (c !== x && (x.value === 'N/A' || c.value === 'N/A')) c.checked = false; });
      var v = Array.prototype.filter.call(cajas, function(c) { return c.checked; }).map(function(c) { return c.value; }).join('; ');
      hid.value = v; dsMultiPintar(btn, v);
    });
    var fuera = function(e) { if (!pop.contains(e.target) && e.target !== btn) cerrar(); };
    var tecla = function(e) { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); cerrar(); } };
    function cerrar() {
      document.removeEventListener('mousedown', fuera, true); document.removeEventListener('keydown', tecla, true);
      pop.remove();
      if (hid.value !== inicial) hid.dispatchEvent(new Event('blur'));   // guarda como cualquier celda
      if (btn.isConnected) btn.focus();
    }
    pop._cerrar = cerrar;
    pop.querySelector('.ds-multi-acc button').onclick = cerrar;
    document.addEventListener('mousedown', fuera, true); document.addEventListener('keydown', tecla, true);
    if (cajas[0]) cajas[0].focus();
  }
  document.addEventListener('click', function(e) {
    var b = e.target.closest && e.target.closest('button.ds-multi'); if (!b) return;
    var hid = b.parentNode.querySelector('[data-campo]');
    if (!hid || hid.disabled || dsDiaCerrado()) return;
    dsAbrirMulti(b, hid);
  });

  // ---------- N3 › Cirugías: para poner Approved la fila debe estar completa (igual que APROBAR_N3 en services_design.py) ----------
  var DS_APROBAR_N3 = [['orden', 'Orden'], ['paciente', 'Paciente'], ['centro', 'Centro'], ['producto', 'Producto'], ['designerId', 'Diseñador'],
                       ['artStart', 'START'], ['artRtd', 'RTD'], ['horaInicio', 'Inicio diseño'], ['critico', 'Crítico']];
  function dsPuedeAprobar(tr, tabla, sel) {
    var f = (DS.diaData && DS.diaData[tabla] || []).find(function(x) { return x.id === parseInt(tr.dataset.id); }) || {};
    var area = tabla === 'prestadas' ? f.area : dsAreaNombre(), tablaReal = tabla === 'prestadas' ? f.tabla : tabla;
    if (area !== 'N3 Prosthetic' || tablaReal !== 'principal' || f.estado === 'Approved') return true;
    if (['bite design', 'denture design'].indexOf(dsNorm(f.etapa)) >= 0) return true;   // caso de Removable Denture
    var datos = dsFilaDesdeForm(tr);
    var val = function(k) { return k === 'designerId' ? (datos.designerId || f.designerPrestado || '') : (datos[k] !== undefined ? datos[k] : f[k]); };
    var falta = DS_APROBAR_N3.filter(function(p) { return !String(val(p[0]) || '').trim(); });
    if (String(val('sHold') || '').trim() && !String(val('fHold') || '').trim()) falta.push(['fHold', 'Re-initiated (hay Start hold)']);
    if (!falta.length) return true;
    sel.value = f.estado || '';
    // parpadean las celdas que faltan (5 s); se guarda aparte porque la fila puede volver a dibujarse mientras tanto
    DS.faltaAprobar = {id: tr.dataset.id, campos: falta.map(function(p) { return p[0]; }), hasta: Date.now() + 5000};
    dsMarcarFaltaAprobar(tr);
    clearTimeout(DS.tFaltaAprobar);
    DS.tFaltaAprobar = setTimeout(function() {
      document.querySelectorAll('td.ds-falta-aprobar').forEach(function(td) { td.classList.remove('ds-falta-aprobar'); });
      DS.faltaAprobar = null;
    }, 5000);
    dsToast('Para poner Approved falta llenar: ' + falta.map(function(p) { return p[1]; }).join(', ') + '.');
    return false;
  }

  function dsMarcarFaltaAprobar(tr) {
    var fa = DS.faltaAprobar;
    if (!fa || fa.id !== tr.dataset.id || Date.now() > fa.hasta) return;
    fa.campos.forEach(function(k) {
      var el = tr.querySelector('[data-campo="' + k + '"]'), td = el && el.closest('td');
      if (td && !td.classList.contains('ds-falta-aprobar')) td.classList.add('ds-falta-aprobar');
    });
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
    // N3 (Rosember, 22-oct-2026): al escribir el número de orden, una fila sin estado queda en «Order Entered»
    // (el servidor hace lo mismo: estado_al_escribir_orden)
    if (tabla !== 'prestadas' && dsAreaNombre() === 'N3 Prosthetic' && String(datos.orden || '').trim() && !String(datos.estado || '').trim()) {
      var selE = tr.querySelector('select[data-campo="estado"]');
      if (selE && [].some.call(selE.options, function(o) { return o.value === 'Order Entered'; })) {
        selE.value = 'Order Entered'; datos.estado = 'Order Entered';
        if (typeof dsPintarCelda === 'function') dsPintarCelda(selE);
      }
    }
    // La opción Hold sigue al estado elegido de inmediato, sin esperar al servidor (28-oct-2026: en producción el guardado
    // tarda y, al poner Meeting en una orden nueva, Hold no aparecía en la lista hasta que llegaba la respuesta)
    dsAjustarOpcionHold(tr, Object.assign({}, existente || {}, datos));
    if (tr.dataset.id === 'nuevo') {
      if (tr._qcReporte !== undefined) datos[tr._qcCampoRep || 'qcReporte'] = tr._qcReporte;
      if (!dsTieneDatos(datos)) return;
      if (tr._creando) { tr._pendiente = true; return; } // se vuelve a guardar cuando termine de crearse
      tr._creando = true;
      dsSeguir(postJSON('/design/api/ordenes', datos)).then(function(o) {
        tr._creando = false;
        tr.dataset.id = o.id; tr.classList.remove('ds-fila-nueva');
        tr.querySelector('.ds-acc').innerHTML = (window.DS_GESTION ? dsBtnOjo(o.id) : '') + (dsSoloPropias() ? '' : dsBtnEliminar(o.id));
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
      datos.qcReporte = local.qcReporte || '';
      ['zQcReporte', 'xQcReporte', 'nQcReporte'].forEach(function(k) { if (local[k] !== undefined) datos[k] = local[k] || ''; });
      if (tr._qcReporte !== undefined) datos[tr._qcCampoRep || 'qcReporte'] = tr._qcReporte;
    }
    delete tr._qcReporte; delete tr._qcCampoRep;
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
    // Los cambios de una misma orden se guardan uno tras otro (28-oct-2026): Meeting → Hold seguidos llegaban al servidor en
    // desorden y el Hold se rechazaba («Primero inicia la orden»)
    DS.colaOrden = DS.colaOrden || {};
    var envioP = (DS.colaOrden[id] || Promise.resolve()).catch(function() {}).then(function() { return postJSON('/design/api/ordenes/' + id, envio); });
    DS.colaOrden[id] = envioP;
    dsSeguir(envioP).then(function(o) {
      if (o.copiaN2) dsAvisoN2(o.copiaN2);   // Face: al marcar el QC → copia a N2 (en el día de hoy)
      if (o.copiaN2Pendiente) dsToast('Se desmarcó el QC: ' + o.copiaN2Pendiente + ' orden(es) copiada(s) a N2 esperan la decisión de su manager.');
      var i = filas.findIndex(function(x) { return x.id === id; });
      if (i >= 0) filas[i] = (tabla === 'prestadas' || dsEsRD()) ? Object.assign({}, filas[i], o) : dsConservarExtras(filas[i], o); // prestadas / RD conservan equipo y manager
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
      if (el.classList.contains('ds-hora')) el.setAttribute('value', v);   // horas deshabilitadas: el «—» mira el atributo
    });
    tr.querySelectorAll('button.ds-multi').forEach(function(b) { var h = b.parentNode.querySelector('[data-campo]'); if (h) dsMultiPintar(b, h.value); });
  }

  function dsTrasGuardar(tabla, tr, o) {
    if (!tr.isConnected) { // la tabla se redibujó mientras guardaba
      if (tabla === 'prestadas') dsRenderPrestadas(); else dsRenderTabla(tabla);
      dsRenderKpis(DS.diaData); return;
    }
    dsPonerValores(tr, o);
    if (tabla !== 'prestadas') setTimeout(function() { dsAplicarOcultas(tabla); }, 0);
    tr.querySelector('.ds-total').innerText = dsDuracionFila(o, tabla);
    var tdTHold = tr.querySelector('.ds-thold'); if (tdTHold) tdTHold.innerText = dsTHoldTxt(o);
    tr.querySelectorAll('[data-calc]').forEach(function(td) { td.innerText = dsCalcTxt(td.dataset.calc, o); });
    var selD = tr.querySelector('[data-campo="designerId"]'); if (selD) selD.dataset.previo = o.designerId || '';
    var opT = tr.querySelector('option[value="__training"]');
    if (opT) { var okT = dsTrainingListo(o); opT.disabled = !okT; opT.text = '➜ Training' + (okT ? '' : ' (falta orden, paciente o centro)'); }
    dsMarcarFila(tr, tabla, o);
    dsRenderKpis(DS.diaData);
    if (tabla === 'prestadas') return;
    // Si ya no queda ninguna fila incompleta (sin contar los casos que pasaron de otro día), se agrega una fila nueva vacía
    // al final (sin redibujar: no se pierde el foco).
    var tbody = tr.parentNode;
    if (dsPuedeCrear() && !DS.diaData[tabla].some(dsFrenaFilaNueva) && !tbody.querySelector('tr[data-id="nuevo"]')) {
      var spec = dsSpec(tabla);
      var tmp = document.createElement('tbody'); tmp.innerHTML = dsFilaHtml(spec, {}, tabla);
      var nueva = tmp.firstChild;
      tbody.appendChild(nueva);
      dsConectarFila(nueva, tabla);
      dsPoblarCatalogos(nueva, spec, tabla);
      dsAjustarCreaProducto(tbody);
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
    DS_TABLAS.forEach(function(t) {
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
  // Un diseñador puede crear órdenes si tiene permiso para un producto (creaProducto, p. ej. Maxilar Print): solo en la fila en blanco
  function dsSoloLectura() { return !!(DS.diaData && DS.diaData.soloLectura); }   // Schedule de Training visto por alguien que no es de ese equipo
  function dsPuedeCrear() { return !dsDiaCerrado() && !dsSoloLectura() && (!dsSoloPropias() || !!(DS.diaData && DS.diaData.creaProducto)); }
  function dsPuedeCrearVarias() { return !dsDiaCerrado() && !dsSoloLectura() && !dsSoloPropias(); }  // + Agregar orden, pegar filas nuevas

  // Candado junto al título + botones "Agregar orden" según si el día ya se cerró (5:00 am del día siguiente, hora Colombia).
  function dsAplicarCierre() {
    var candado = document.getElementById('dsCandado');
    var cerrado = dsDiaCerrado();
    document.querySelectorAll('.ds-btn-add').forEach(function(b) { b.style.display = dsPuedeCrearVarias() && !dsEsRD() ? '' : 'none'; });
    if (!cerrado) {
      var perm = DS.diaData && DS.diaData.permisoEdicionHasta;
      if (!perm) { candado.textContent = '🔒'; candado.style.display = 'none'; return; }
      // Día ya cerrado que esta persona puede editar por un permiso temporal (Parámetros › Equipos)
      var v = new Date(perm);
      candado.textContent = '🔓';
      candado.title = 'Este día ya se cerró, pero tienes permiso para editarlo hasta el ' +
        v.toLocaleDateString('es-CO', {day: 'numeric', month: 'long'}) + ' a las ' +
        v.toLocaleTimeString('es-CO', {hour: 'numeric', minute: '2-digit'}) + '.';
      candado.setAttribute('aria-label', candado.title); candado.style.display = '';
      return;
    }
    candado.textContent = '🔒';
    var txt = '🔒 Este día ya se cerró y no se puede editar.';
    if (DS.diaData.qcEditable) {
      var h = new Date(DS.diaData.qcEditableHasta);
      txt += ' El checkbox de QC se puede marcar hasta el ' +
             h.toLocaleDateString('es-CO', {day: 'numeric', month: 'long', timeZone: 'America/Bogota'}) + ' a las 5:00 am.';
    }
    candado.title = txt.replace('🔒 ', ''); candado.setAttribute('aria-label', candado.title); candado.style.display = '';
  }

  // Contadores fijos; solo cuentan órdenes completas (centro + producto + diseñador). Canceladas: cualquier orden con datos
  // en Canceled, aunque no tenga diseñador (se cancelan muchas antes de asignarlas y el contador se quedaba en 0; 19-oct-2026).
  function dsOrdenConDatos(f) { return !!(f.orden || f.paciente || f.centro || f.producto); }
  var DS_KPIS = [
    {uno: 'Orden', varios: 'Órdenes', cuenta: function(f) { return true; }},
    {uno: 'En proceso', varios: 'En proceso', cuenta: function(f) { return f.estado === 'Initiated'; }},
    {uno: 'En espera', varios: 'En espera', cuenta: function(f) { return dsEsHold(f.estado); }},
    {uno: 'Aprobada', varios: 'Aprobadas', cuenta: function(f) { return f.estado === 'Approved' && dsQcFinal(f); }},
    {uno: 'Cancelada', varios: 'Canceladas', cuenta: dsEsCancelada, conDatos: true},
  ];
  function dsRenderKpis(dia) {
    dsDockRestaurar();     // pestañas ancladas de la visita anterior (una sola vez)
    dsPintarProduccion();  // la ventana de Producción (si está abierta) sigue los cambios
    var filas = dia.principal.concat(dia.nightguard || [], dia.material || [], dia.tibar || [], dia.dummy || []);
    // Vista del diseñador: también cuentan los casos que hizo prestado en otros equipos (19-oct-2026)
    if (dia.soloPropias) filas = filas.concat(dia.prestadas || []);
    filas = filas.filter(function(f) { return !dsEsFantasma(f); });   // producto «Training»: no cuenta
    var todas = filas.filter(dsOrdenCompleta), conDatos = filas.filter(dsOrdenConDatos);
    // Los 5 números se calculan igual que siempre (DS_KPIS); el panel solo los dibuja.
    var n = DS_KPIS.map(function(k) { return (k.conDatos ? conDatos : todas).filter(k.cuenta).length; });
    // «Otros estados» (solo para completar la barra): órdenes completas que no cuentan en En proceso, En espera, Aprobadas
    // ni Canceladas (Order Entered, Pickup received, Ready to design, Meeting, aprobadas sin QC…). Se cuenta con las mismas
    // condiciones, no con una resta: los contadores se solapan (p. ej. Canceladas incluye filas incompletas).
    var otros = todas.filter(function(f) { return !DS_KPIS.slice(1).some(function(k) { return k.cuenta(f); }); }).length;
    dsPanelResumen({total: n[0], proc: n[1], wait: n[2], ok: n[3], x: n[4], otros: otros});
  }

  // ---------- Panel unificado de contadores (Rosember, 28-oct-2026) ----------
  // Reemplaza las 5 tarjetas. Un panel con el total, el % de aprobadas, una barra apilada y la leyenda; los números cuentan
  // hasta su valor y la barra crece. Al cambiar los datos se animan desde el valor anterior. Solo dibuja: no calcula nada.
  var DS_PANEL = [
    {k: 'proc', etq: ['En proceso', 'En proceso'], c: '#3b82f6'},
    {k: 'wait', etq: ['En espera', 'En espera'], c: '#f59e0b'},
    {k: 'ok', etq: ['Aprobada', 'Aprobadas'], c: '#10b981'},
    {k: 'x', etq: ['Cancelada', 'Canceladas'], c: '#ef4444'},
    {k: 'otros', etq: ['Otros estados', 'Otros estados'], c: '#94a3b8',
     ayuda: 'Órdenes completas en otros estados: Order Entered, Pickup received, Ready to design, Meeting, aprobadas sin QC…'},
  ];
  function dsPanelContar(el, de, a, retraso, reducido) {
    var id = el._kc = (el._kc || 0) + 1;
    if (reducido || de === a) { el.textContent = a; return; }
    el.textContent = de;
    var t0 = performance.now() + retraso;
    (function paso(t) {
      if (el._kc !== id) return;
      var p = Math.min(1, Math.max(0, (t - t0) / 1000));
      el.textContent = Math.round(de + (a - de) * (1 - Math.pow(1 - p, 3)));
      if (p < 1 && el.isConnected) requestAnimationFrame(paso); else el.textContent = a;
    })(performance.now());
  }
  function dsPanelMontar(cont) {
    cont.innerHTML = '<section class="ds-kpi-panel" aria-label="Resumen de órdenes">' +
      '<div class="kp-tot"><div class="kp-cap"></div><div class="kp-big"><span class="kp-num" data-n="total">0</span><small class="kp-pal"></small></div>' +
      '<span class="kp-meta"><b>0%</b> aprobadas</span></div>' +
      '<div class="kp-der"><div class="kp-stack"></div><div class="kp-legend">' + DS_PANEL.map(function(e) {
        return '<div class="kp-li" data-k="' + e.k + '" style="--c:' + e.c + '"' + (e.ayuda ? ' title="' + e.ayuda + '"' : '') + '><span class="kp-dot"></span>' +
          '<div><div class="kp-l"></div><div class="kp-v"><b data-n="' + e.k + '">0</b><span>0%</span></div></div></div>';
      }).join('') + '</div></div></section>';
    var p = cont.firstChild;
    var foco = function(k) {
      p.classList.toggle('focus', !!k);
      p.querySelectorAll('[data-k]').forEach(function(x) { x.classList.toggle('on', !!k && x.dataset.k === k); });
    };
    p.addEventListener('mouseover', function(e) { var t = e.target.closest('[data-k]'); foco(t ? t.dataset.k : null); });
    p.addEventListener('mouseleave', function() { foco(null); });
  }
  function dsPanelResumen(v) {
    var cont = document.getElementById('dsKpis'); if (!cont) return;
    var p = cont.firstElementChild;
    if (!p || !p.classList.contains('ds-kpi-panel')) { dsPanelMontar(cont); p = cont.firstElementChild; DS.kpiPrev = null; }
    var reducido = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    // Al ingresar al Schedule el panel entra y los números cuentan desde 0; en la carga inicial el contenido todavía está
    // oculto (.ds-inicial): se espera a que ya se vea
    var entra = !!DS.kpiContar, espera = 0;
    if (entra) {
      DS.kpiContar = false; DS.kpiPrev = null;
      var app = document.getElementById('ds-app'); espera = app && app.classList.contains('ds-inicial') ? 250 : 0;
      p.classList.remove('kp-entra'); void p.offsetWidth; p.style.animationDelay = espera + 'ms'; p.classList.add('kp-entra');
    }
    var ant = DS.kpiPrev || {total: 0, proc: 0, wait: 0, ok: 0, x: 0, otros: 0};
    var pct = function(x) { return v.total ? Math.round(x / v.total * 100) : 0; };
    p.querySelector('.kp-cap').textContent = 'Resumen de órdenes' + (dsAreaNombre() ? ' · ' + dsAreaNombre() : '');
    p.querySelector('.kp-pal').textContent = v.total === 1 ? 'orden' : 'órdenes';
    p.querySelector('.kp-meta b').textContent = pct(v.ok) + '%';
    var i = 0;
    p.querySelectorAll('[data-n]').forEach(function(el) { var k = el.dataset.n; dsPanelContar(el, ant[k], v[k], espera + i * 70, reducido); i++; });
    DS_PANEL.forEach(function(e) {
      var li = p.querySelector('.kp-li[data-k="' + e.k + '"]');
      li.querySelector('.kp-l').textContent = e.etq[v[e.k] === 1 ? 0 : 1];
      li.querySelector('.kp-v span').textContent = pct(v[e.k]) + '%';
    });
    // Barra apilada: un segmento por estado con valor > 0; crece (y se encoge) con la transición de flex-grow
    var stack = p.querySelector('.kp-stack');
    DS_PANEL.forEach(function(e, idx) {
      var val = v[e.k], seg = stack.querySelector('.kp-seg[data-k="' + e.k + '"]');
      var nombre = e.etq[val === 1 ? 0 : 1];
      if (val > 0) {
        if (!seg) {
          seg = document.createElement('div'); seg.className = 'kp-seg'; seg.dataset.k = e.k; seg.style.setProperty('--c', e.c); seg.style.flexGrow = 0;
          var despues = null;   // se inserta en el orden de los estados
          DS_PANEL.slice(idx + 1).some(function(o) { despues = stack.querySelector('.kp-seg[data-k="' + o.k + '"]'); return !!despues; });
          stack.insertBefore(seg, despues);
        }
        seg.dataset.v = val; seg.title = nombre + ': ' + val;
        seg.style.transitionDelay = (reducido ? 0 : (entra ? espera / 1000 + .2 + idx * .12 : 0)) + 's';
        requestAnimationFrame(function() { requestAnimationFrame(function() { if (seg.dataset.v === String(val)) seg.style.flexGrow = val; }); });
      } else if (seg) {
        seg.dataset.v = 0; seg.style.transitionDelay = '0s'; seg.style.flexGrow = 0;
        setTimeout(function() { if (seg.dataset.v === '0') seg.remove(); }, reducido ? 0 : 1200);
      }
    });
    DS.kpiPrev = {total: v.total, proc: v.proc, wait: v.wait, ok: v.ok, x: v.x, otros: v.otros};
  }

  var DS_DESCANSO_MIN = 15; // duración de cada descanso registrado con el checkbox

  function dsHoraMas(hhmm, minutos) {
    var p = hhmm.split(':'); var t = (parseInt(p[0]) * 60 + parseInt(p[1]) + minutos) % (24 * 60);
    return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
  }
  // Hora actual de Colombia (24 h) tomada del reloj del SERVIDOR: si el computador tiene la hora o la zona horaria mal
  // (p. ej. 3:00 a. m. en vez de 3:00 p. m.), el descanso no queda mal registrado (reportado por Rosember el 12-oct-2026).
  function dsHoraActual() {
    var d = new Date(Date.now() + (DS.desfase || 0));
    try {
      var p = new Intl.DateTimeFormat('en-GB', {timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(d);
      var h = (p.find(function(x) { return x.type === 'hour'; }) || {}).value, m = (p.find(function(x) { return x.type === 'minute'; }) || {}).value;
      if (h && m) return (h === '24' ? '00' : h) + ':' + m;
    } catch (e) {}
    var u = new Date(d.getTime() - 5 * 3600000);  // Colombia = UTC-5 todo el año
    return String(u.getUTCHours()).padStart(2, '0') + ':' + String(u.getUTCMinutes()).padStart(2, '0');
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
      // El manager también tiene su tarjeta (26-oct-2026): va al final, después de los diseñadores
      var tl = dia.designers.concat(dia.manager ? [dia.manager] : [], dia.managerTL ? [dia.managerTL] : []);
      tl.forEach(function(d) {
        var b = dia.breaks.find(function(x) { return x.empleadoId === d.id; }) || {};
        var card = document.createElement('div'); card.className = 'ds-tl-card'; card.dataset.empleadoId = d.id;
        card.dataset.fecha = dia._fecha || dsFechaISO(dsFechaSeleccionada()); card.dataset.team = dia._team || DS.teamId;   // su día y su equipo
        var fila = function(lbl, ini, fin, conCheck) {
          return '<div class="ds-tl-fila"><span class="ds-tl-lbl" title="' + lbl + '">' + lbl.replace('Descanso', 'Desc.') + '</span>' +
            (conCheck ? '<input type="checkbox" data-descanso="' + conCheck + '" title="Registrar descanso de ' + DS_DESCANSO_MIN + ' min desde ahora" aria-label="Registrar ' + lbl + ' de ' + dsEsc(d.nombre) + '">' : '<span></span>') +
            '<input type="time" class="ds-hora" required data-campo="' + ini + '" aria-label="' + lbl + ' de ' + dsEsc(d.nombre) + ': inicio" value="' + dsEsc(b[ini] || '') + '">' +
            '<span class="ds-tl-guion">-</span>' +
            '<input type="time" class="ds-hora" required data-campo="' + fin + '" aria-label="' + lbl + ' de ' + dsEsc(d.nombre) + ': fin" value="' + dsEsc(b[fin] || '') + '"></div>';
        };
        // La ausencia funciona igual que antes (mismo selector y valores); solo cambió de lugar.
        card.innerHTML =
          '<div class="ds-tl-head"><span class="ds-tl-nombre" title="' + dsEsc(d.nombre) + '">' + dsEsc(d.corto || d.nombre) + '</span>' +
            '<span class="ds-tl-aus">' +
              (b.ausenciaAutomatica ? '<span title="Tomado automáticamente de un permiso aprobado en People" style="color:#16a34a">🔒</span>' : '') +
              ((b.permisosHoras || []).length ? '<span class="ds-tl-permh" title="' + dsEsc(b.permisosHoras.map(function(p) { return p.tipo + ' ' + p.desde + '–' + p.hasta; }).join('\n')) +
                ' (aprobado en People)">🕑 ' + dsEsc(b.permisosHoras[0].desde + '–' + b.permisosHoras[0].hasta) + (b.permisosHoras.length > 1 ? ' +' + (b.permisosHoras.length - 1) : '') + '</span>' : '') +
              '<select data-campo="tipoAusencia" title="Ausencia" aria-label="Ausencia"><option value="">—</option>' +
                tipos.map(function(t) { return '<option value="' + dsEsc(t) + '"' + (t === b.tipoAusencia ? ' selected' : '') + '>' + dsEsc(t) + '</option>'; }).join('') +
              '</select></span></div>' +
          fila('Almuerzo', 'almuerzoInicio', 'almuerzoFin', null) +
          fila('Descanso 1', 'break1Inicio', 'break1Fin', 'break1') +
          fila('Descanso 2', 'break2Inicio', 'break2Fin', 'break2');
        if (d.esManager) card.classList.add('ds-tl-mgr');
        dsPintarTarjetaTL(card, d);   // color que tiene asignado el diseñador en el Schedule
        if (d.soloLectura) {   // tiempos libres del manager vistos por un diseñador: solo se miran
          card.classList.add('ds-tl-ajeno');
          card.querySelectorAll('input, select').forEach(function(el) { el.disabled = true; });
          card.title = 'Tiempos libres de tu manager: solo lectura';
          card._guardado = {}; grid.appendChild(card); return;
        }
        dsConectarTarjeta(card);
        card._guardado = dsDatosBreak(card); // estado inicial, para deshacer
        grid.appendChild(card);
      });
      // Una sola fila que se recorta; si no caben todas en la pantalla, rota sola (carrusel). Ver dsCarruselTL.
      var vp = document.createElement('div'); vp.className = 'ds-tl-viewport';
      vp.appendChild(grid);
      var viejoVp = cont.querySelector('.ds-tl-viewport'); if (viejoVp && viejoVp._ro) viejoVp._ro.disconnect();
      cont.replaceChildren(vp); // se cambia de una sola vez: el panel nunca queda vacío
      if (window.ResizeObserver) { vp._ro = new ResizeObserver(function() { dsCarruselTL(vp); }); vp._ro.observe(vp); }
      dsCarruselTL(vp);
    });
  }

  // Carrusel de Tiempos libres (Rosember, 26-oct-2026): las tarjetas van en una fila. Si caben todas en el ancho, se reparten;
  // si no, se muestran las que caben y el carrusel avanza una tarjeta cada pocos segundos (vuelve al principio al llegar al final).
  // Se pausa con el mouse encima o con el foco dentro, y las flechas ‹ › lo mueven a mano.
  var DS_TL_GAP = 8, DS_TL_MIN = 196, DS_TL_PAUSA_MS = 4500;
  function dsCarruselTL(vp) {
    var g = vp.querySelector('.ds-tl-grid'); if (!g || !vp.isConnected) return;
    var n = g.children.length, vw = vp.clientWidth;
    if (!vw || !n) return;   // oculto (otra pestaña): se acomoda cuando se vea
    var por = Math.max(1, Math.floor((vw + DS_TL_GAP) / (DS_TL_MIN + DS_TL_GAP)));
    var rota = n > por;
    var cw = Math.floor(rota ? (vw - DS_TL_GAP * (por - 1)) / por : Math.min(340, (vw - DS_TL_GAP * (n - 1)) / n));
    g.style.setProperty('--tlw', cw + 'px');
    var st = vp._tl || (vp._tl = {idx: 0, t: null, pausa: false});
    st.paso = cw + DS_TL_GAP; st.max = Math.max(0, n - por);
    st.idx = Math.min(st.idx, st.max);
    vp.classList.toggle('rota', rota);
    g.style.transform = 'translateX(' + (-st.idx * st.paso) + 'px)';
    if (rota && !vp._flechas) {
      vp._flechas = true;
      [['ant', '‹', 'Tarjetas anteriores', -1], ['sig', '›', 'Tarjetas siguientes', 1]].forEach(function(f) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'ds-tl-flecha ' + f[0];
        b.textContent = f[1]; b.title = f[2]; b.setAttribute('aria-label', f[2]);
        b.onclick = function() { dsTLMover(vp, f[3]); };
        vp.appendChild(b);
      });
      vp.addEventListener('mouseenter', function() { vp._tl.pausa = true; });
      vp.addEventListener('mouseleave', function() { vp._tl.pausa = false; });
      vp.addEventListener('focusin', function() { vp._tl.pausa = true; });
      vp.addEventListener('focusout', function() { vp._tl.pausa = false; });
    }
    if (!rota && st.t) { clearInterval(st.t); st.t = null; }
    var reducido = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (rota && !st.t && !reducido) {
      st.t = setInterval(function() {
        if (!vp.isConnected) { clearInterval(st.t); return; }
        if (!st.pausa) dsTLMover(vp, 1);
      }, DS_TL_PAUSA_MS);
    }
  }
  function dsTLMover(vp, d) {
    var st = vp._tl, g = vp.querySelector('.ds-tl-grid'); if (!st || !g) return;
    st.idx = st.idx + d > st.max ? 0 : (st.idx + d < 0 ? st.max : st.idx + d);
    g.style.transform = 'translateX(' + (-st.idx * st.paso) + 'px)';
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
          var inicio = dsHoraActual();
          // Descansos seguidos (19-oct-2026): si el otro descanso todavía está corriendo (p. ej. marcó el 1 a las 5:00 y a
          // los pocos minutos marca el 2), este empieza cuando termina aquel: 5:00–5:15 y 5:15–5:30, sin cruzarse.
          var otra = clave === 'break1' ? 'break2' : 'break1';
          var oIni = card.querySelector('[data-campo="' + otra + 'Inicio"]').value, oFin = card.querySelector('[data-campo="' + otra + 'Fin"]').value;
          if (oIni && oFin) {
            var min = function(h) { var p = h.split(':'); return parseInt(p[0], 10) * 60 + parseInt(p[1], 10); };
            var dur = (min(oFin) - min(oIni) + 1440) % 1440, pasados = (min(inicio) - min(oIni) + 1440) % 1440;
            if (dur > 0 && pasados < dur) inicio = oFin;
          }
          ini.value = inicio; fin.value = dsHoraMas(inicio, DS_DESCANSO_MIN);
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
  // N3 (20-oct-2026): la producción se separa en Sx (cirugías), Tc y Ng (Nightguards). Igual que tipo_produccion (servidor).
  // Tipo de cada caso en «Producción del día»: sx = tabla principal (Cirugías en N3, Dummy en N6), mc = Material Change, tc, ng
  // Productos de Nightguards / TC que cuentan como Tc aunque no digan «TC» (Rosember, 22-oct-2026; PRODUCTOS_TC en el servidor)
  var DS_PRODUCTOS_TC = ['n6 - full mouth zirk - over ti-bar (8mm or less)'];
  function dsTipoProduccion(tabla, producto) {
    if (dsTablaBase(tabla) === 'material') return 'mc';   // Over Ti-bar como Mc por ahora (Rosember lo ajusta después)
    if (tabla !== 'nightguard') return 'sx';
    var p = dsNorm(producto);
    return /\btc\b/i.test(p) || DS_PRODUCTOS_TC.indexOf(p) >= 0 ? 'tc' : 'ng';
  }
  function dsProduccionDia(dia) {
    var cuenta = {}, nombres = {}, orden = [], tipos = {};
    var tipoDe = function(k) { return tipos[k] || (tipos[k] = {sx: 0, tc: 0, ng: 0, mc: 0}); };
    (dia.designers || []).forEach(function(d) { var k = 'd' + d.id; cuenta[k] = 0; nombres[k] = d.corto || d.nombre; orden.push(k); tipoDe(k); });   // primer nombre y primer apellido
    var prest = {};
    var tablaDe = function(f, lista) { return f.tabla || lista; };
    [['principal', dia.principal], ['nightguard', dia.nightguard], ['material', dia.material], ['tibar', dia.tibar], ['dummy', dia.dummy], ['', dia.soloPropias ? dia.prestadas : []]]
      .forEach(function(par) { (par[1] || []).forEach(function(f) {
      var k = f.designerId ? 'd' + f.designerId : (f.designerPrestado ? 'p' + f.designerPrestado : null);
      var est = String(f.estado || '').toLowerCase();
      // canceladas, skipped y «Training» no cuentan (como _es_cancelada en el servidor: el número del mes y el Reparto, 27-oct-2026)
      if (!k || est.indexOf('cancel') >= 0 || est.indexOf('skip') >= 0 || dsEsFantasma(f)) return;
      if (!(k in cuenta)) { cuenta[k] = 0; nombres[k] = f.designerCorto || f.designerNombre || f.designerPrestado || 'Sin nombre'; orden.push(k); }
      cuenta[k]++;
      tipoDe(k)[dsTipoProduccion(tablaDe(f, par[0]), f.producto)]++;
      if (f.equipo && dia.soloPropias) prest[k] = (prest[k] || 0) + 1;   // vista del diseñador: los suyos en otros equipos
    }); });
    // Manager: los casos que sus diseñadores hicieron prestados en otros equipos también son de su producción
    Object.keys(dia.prestadosEquipo || {}).forEach(function(id) {
      var k = 'd' + id; if (!(k in cuenta)) return;
      cuenta[k] += dia.prestadosEquipo[id]; prest[k] = (prest[k] || 0) + dia.prestadosEquipo[id];
      var pt = (dia.prestadosTipo || {})[id] || {};
      ['sx', 'tc', 'ng', 'mc'].forEach(function(t) { tipoDe(k)[t] += pt[t] || 0; });
    });
    return orden.map(function(k) { return {id: k.charAt(0) === 'd' ? parseInt(k.slice(1), 10) : null, nombre: nombres[k], casos: cuenta[k], prestados: prest[k] || 0, tipos: tipoDe(k)}; });
  }
  function dsProduccionRD(dia) {
    var por = {}, orden = [];
    (dia.material || []).forEach(function(f) {
      if (dsNorm(f.estado) === 'canceled' || dsEsFantasma(f)) return;
      var m = f.manager || f.equipo || 'Sin manager';
      if (!por[m]) { por[m] = {nombre: m, casos: 0, rem: 0}; orden.push(m); }
      por[m].casos++;
      if (dsNorm(f.estado) === 'approved' && dsEsZirconia(f)) por[m].rem += dsNorm(f.arco) === 'both' ? 2 : 1;
    });
    return orden.sort(function(a, b) { return a.localeCompare(b, 'es'); }).map(function(m) { return por[m]; });
  }
  // Acumulado del mes (Rosember, 27-oct-2026): junto a cada número del día se ve lo que lleva la persona en el mes. El servidor da
  // lo de los días ANTERIORES del mes y la pantalla le suma el día elegido, así se mueve en vivo con cada cambio.
  var DS_PROD_MES = {clave: '', datos: null, pidiendo: ''};
  function dsProdMesPedir() {
    if (!DS.teamId) return;
    var clave = DS.teamId + '|' + dsFechaISO(dsFechaSeleccionada());
    if (DS_PROD_MES.clave === clave || DS_PROD_MES.pidiendo === clave) return;
    DS_PROD_MES.pidiendo = clave;
    window.dsFetchJSON('/design/api/produccion-mes?team_id=' + DS.teamId + '&fecha=' + dsFechaISO(dsFechaSeleccionada())).then(function(d) {
      if (DS_PROD_MES.pidiendo !== clave) return;
      DS_PROD_MES = {clave: clave, datos: d || {}, pidiendo: ''};
      dsPintarProduccion();
    }).catch(function() { if (DS_PROD_MES.pidiendo === clave) DS_PROD_MES.pidiendo = ''; });
  }
  function dsPintarProduccion() {
    var pop = document.getElementById('dsProdPop'); if (!pop || !DS.diaData) return;
    var cuerpo = pop.querySelector('.ds-fw-cuerpo');
    if (dsEsRD()) {
      var fr = dsProduccionRD(DS.diaData), fd = dsFechaSeleccionada();
      var tc = fr.reduce(function(a, x) { return a + x.casos; }, 0), tr = fr.reduce(function(a, x) { return a + x.rem; }, 0);
      cuerpo.innerHTML = '<div class="sub">' + dsEsc(NOMBRES_DIAS[(fd.getDay() + 6) % 7] || '') + ' ' + fd.getDate() +
        ' · por manager (sin canceladas) · REM = arcos aprobados (Both cuenta 2)</div>' +
        (fr.length ? '<table><thead><tr><th>Manager</th><th class="n">Casos</th><th class="n" title="Arcos aprobados: Upper o Lower = 1, Both = 2">REM</th></tr></thead><tbody>' +
          fr.map(function(x) { return '<tr><td>' + dsEsc(x.nombre) + '</td><td class="n">' + x.casos + '</td><td class="n' + (x.rem ? '' : ' cero') + '">' + x.rem + '</td></tr>'; }).join('') +
          '<tr class="total"><td>Total</td><td class="n">' + tc + '</td><td class="n">' + tr + '</td></tr></tbody></table>'
         : '<p class="ds-prest-vacio">Todavía no hay casos este día.</p>');
      return;
    }
    var filas = dsProduccionDia(DS.diaData), total = filas.reduce(function(a, x) { return a + x.casos; }, 0);
    var f = dsFechaSeleccionada();
    dsProdMesPedir();
    var mesOk = DS_PROD_MES.clave === DS.teamId + '|' + dsFechaISO(f), prev = (mesOk && DS_PROD_MES.datos) || {};
    // mes = lo de los días anteriores + lo del día elegido (si no hay datos del mes todavía, no se muestra)
    var mesDe = function(x, t) { var p = (x.id != null && prev[x.id]) || {}; return t.reduce(function(a, k) { return a + (p[k] || 0) + (x.tipos[k] || 0); }, 0); };
    var mesTxt = function(v, cero) { return mesOk ? ' <span class="mes' + (cero ? ' cero' : '') + '" title="Lleva en el mes">' + v + '</span>' : ''; };
    // N3: Sx · Tc · Ng; N6 (21-oct-2026): Mc (Material Change) · D (Dummy) · Ng · Tc. Cada columna suma sus tipos.
    var area = dsAreaNombre(), porTipo = area === 'N3 Prosthetic' || area === DS_AREA_MATERIAL;
    var TIPOS = area === DS_AREA_MATERIAL
      ? [[['mc'], 'Mc', 'Material Change'], [['sx'], 'D', 'Dummy'], [['ng'], 'Ng', 'Nightguards'], [['tc'], 'Tc', 'TC']]
      : [[['sx', 'mc'], 'Sx', 'Cirugías'], [['tc'], 'Tc', 'TC'], [['ng'], 'Ng', 'Nightguards']];
    var val = function(x, t) { return t[0].reduce(function(a, k) { return a + (x.tipos[k] || 0); }, 0); };
    var suma = function(t) { return filas.reduce(function(a, x) { return a + val(x, t); }, 0); };
    var cab = porTipo ? TIPOS.map(function(t) { return '<th class="n" title="' + t[2] + '">' + t[1] + '</th>'; }).join('') : '<th class="n">Casos</th>';
    var celdas = function(x) { return porTipo ? TIPOS.map(function(t) { var v = val(x, t), m = mesDe(x, t[0]); return '<td class="n' + (v ? '' : ' cero') + '">' + v + mesTxt(m, !m) + '</td>'; }).join('')
                                              : '<td class="n">' + x.casos + mesTxt(mesDe(x, ['sx', 'tc', 'ng', 'mc']), false) + '</td>'; };
    var sumaMes = function(t) { return filas.reduce(function(a, x) { return a + mesDe(x, t); }, 0); };
    var totales = porTipo ? TIPOS.map(function(t) { return '<td class="n">' + suma(t) + mesTxt(sumaMes(t[0]), false) + '</td>'; }).join('')
                          : '<td class="n">' + total + mesTxt(sumaMes(['sx', 'tc', 'ng', 'mc']), false) + '</td>';
    cuerpo.innerHTML = '<div class="sub">' + dsEsc(NOMBRES_DIAS[(f.getDay() + 6) % 7] || '') + ' ' + f.getDate() + ' de ' + dsEsc(f.toLocaleDateString('es-CO', {month: 'long'})) +
      ' · casos asignados a cada diseñador (sin canceladas ni skipped)' + (mesOk ? ' · <span class="mes">en gris, lo que lleva del mes</span>' : '') + '</div>' +
      (filas.length ? '<table><thead><tr><th>Diseñador</th>' + cab + '</tr></thead><tbody>' +
        filas.map(function(x) { return '<tr' + (x.casos ? '' : ' class="cero"') + '><td>' + dsEsc(x.nombre) +
          (x.prestados ? ' <span class="ds-prod-prest" title="Casos que hizo prestado en otros equipos (ya están sumados)">(' + x.prestados + ' prestado' + (x.prestados > 1 ? 's' : '') + ')</span>' : '') +
          '</td>' + celdas(x) + '</tr>'; }).join('') +
        '<tr class="total"><td>Total' + (porTipo ? ' · ' + total : '') + '</td>' + totales + '</tr></tbody></table>'
       : '<p class="ds-prest-vacio">Este equipo no tiene diseñadores.</p>');
  }
  // Producción del día como ventana flotante (Rosember, 27-oct-2026), igual que las de Pre-Approved: se mueve desde la cabecera,
  // se minimiza (— / doble clic), se cierra (✕) y se sigue actualizando sola al cambiar de día o de equipo. No se cierra al
  // hacer clic afuera ni con Esc.
  function dsCerrarProduccion() {
    var pop = document.getElementById('dsProdPop'); if (pop) pop.remove();
    dsFwQuitar('prod');
  }
  function dsAbrirProduccion(anclada) {
    var ya = document.getElementById('dsProdPop');
    if (ya) {
      if (ya.classList.contains('ds-fw-anclada')) { if (!anclada) dsDockDespegar('prod'); return; }
      ya.classList.remove('min'); ya.style.zIndex = ++DS_FW_Z; var m = ya.querySelector('[data-fw="min"]'); if (m) { m.title = 'Minimizar'; m.textContent = '—'; } return;
    }
    var el = document.createElement('div'); el.className = 'ds-fw ds-fw-prod'; el.id = 'dsProdPop'; el.style.zIndex = ++DS_FW_Z;
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Producción del día');
    el.innerHTML = '<div class="ds-fw-cab"><b>Producción del día</b><small></small><button type="button" data-fw="min" title="Minimizar">—</button><button type="button" data-fw="cerrar" title="Cerrar">✕</button></div>' +
      '<div class="ds-fw-cuerpo"></div>';
    var posInicial = function() {   // se abre junto a la barra lateral y se puede mover
      var r = document.getElementById('dsProdBtn').getBoundingClientRect();
      el.style.left = Math.max(8, window.innerWidth - 46 - el.offsetWidth - 10) + 'px';
      el.style.top = Math.max(8, Math.min(window.innerHeight - el.offsetHeight - 8, r.top)) + 'px';
    };
    dsFwRegistrar(el, {id: 'prod', titulo: 'Producción del día', cerrar: dsCerrarProduccion, guardar: {t: 'prod'}, posInicial: posInicial});
    if (anclada) el.classList.add('ds-fw-anclada');
    document.body.appendChild(el);
    dsPintarProduccion();
    if (anclada) { DS_DOCK.push('prod'); dsDockPintar(); } else posInicial();
    dsFwCabecera(el);
    el.querySelector('[data-fw="cerrar"]').onclick = dsCerrarProduccion;
  }
  document.getElementById('dsProdBtn').addEventListener('click', function() { dsAbrirProduccion(false); });
  // ---------- Support: "Dejar a cargo" = cubrir el turno de una persona de Support (Support Time) ----------
  function dsFechaIsoCorta(iso) { var p = iso.split('-'); return parseInt(p[2], 10) + ' ' + DS_MESES_C[parseInt(p[1], 10) - 1]; }
  function dsRenderACargoSupport(cont) {
    window.dsFetchJSON('/design/api/support-time').then(function(st) {
      if (DS.areaFormato !== 'support') return;
      cont.innerHTML = '';
      var cobs = st.coberturas || [];
      cobs.forEach(function(c) {
        var tn = (st.turnos[c.turno - 1] || {}).nombre || ('turno ' + c.turno);
        var chip = document.createElement('span'); chip.className = 'ds-acargo-chip' + (c.activa ? '' : ' prog');
        var largo = (c.activa ? 'Cubre el turno ' : 'Programado: cubre el turno ') + tn.toLowerCase() + ': ' + c.nombre + ' · ' + dsFechaIsoCorta(c.desde) + ' al ' + dsFechaIsoCorta(c.hasta);
        chip.textContent = (c.activa ? 'Cubre ' : 'Prog.: ') + tn.toLowerCase() + ': ' + String(c.nombre || '').split(' ')[0];   // corto: es una pestaña
        chip.title = largo + '\nLo dejó: ' + (c.asignadoPor || '—');
        cont.appendChild(chip);
      });
      if (st.puedeCubrir) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'btn gris'; b.id = 'dsACargoEditar'; b.textContent = 'Dejar a cargo';
        b.title = 'Deja a alguien cubriendo el turno de una persona de Support entre dos fechas';
        b.onclick = function() { dsModalCobertura(st); };
        cont.appendChild(b);
      }
      cont.hidden = !cont.children.length;
    }).catch(function() { cont.hidden = true; });
  }
  function dsModalCobertura(st) {
    var hoy = dsFechaISO(new Date());
    var bg = document.createElement('div'); bg.className = 'ds-qc-bg ds-fondo-50';   // fondo al 50 % (Rosember, 26-oct-2026)
    var quien = function(n) { var p = (st.personas || []).find(function(x) { return x.turnoActual.n === n; }); return p ? p.nombre : ''; };
    var turnosOps = (st.turnos || []).map(function(t) { return '<option value="' + t.n + '">' + dsEsc(t.nombre) + ' · ' + dsEsc(t.horaTxt) + (quien(t.n) ? ' (hoy: ' + dsEsc(quien(t.n)) + ')' : '') + '</option>'; }).join('');
    var lista = (st.coberturas || []).map(function(c) {
      return '<div class="ds-cob-fila"><span>' + dsEsc(c.nombre) + ' · ' + dsEsc((st.turnos[c.turno - 1] || {}).nombre || '') + ' · ' + dsFechaIsoCorta(c.desde) + ' al ' + dsFechaIsoCorta(c.hasta) +
             '</span><button type="button" class="btn rojo mini" data-quitar="' + c.id + '">Quitar</button></div>'; }).join('');
    bg.innerHTML = '<div class="ds-qc ds-acargo-form" role="dialog" aria-modal="true" aria-labelledby="dsCobTit" style="width:460px">' +
      '<h4 id="dsCobTit">Dejar a cargo un turno de Support</h4>' +
      '<div class="ds-qc-sub">Elige quién cubre el turno y las fechas. Mientras tanto edita el Schedule de Support y el turno aparece cubierto por esa persona en la página de Inicio. Se apaga solo al terminar las fechas.</div>' +
      '<label for="dsCobTurno">Turno que cubre</label><select id="dsCobTurno">' + turnosOps + '</select>' +
      '<label for="dsCobQuien">Quién lo cubre</label><select id="dsCobQuien"><option value="">Cargando…</option></select>' +
      '<div class="ds-acargo-fechas"><div><label for="dsCobDesde">Desde</label><input type="date" id="dsCobDesde" min="' + hoy + '" value="' + hoy + '"></div>' +
      '<div><label for="dsCobHasta">Hasta</label><input type="date" id="dsCobHasta" min="' + hoy + '" value="' + hoy + '"></div></div>' +
      (lista ? '<div class="ds-cob-lista"><div class="ds-qc-sub" style="margin:8px 0 4px">Coberturas vigentes o programadas</div>' + lista + '</div>' : '') +
      '<div class="ds-qc-err" id="dsCobErr"></div>' +
      '<div class="ds-qc-btns"><button type="button" class="btn gris" data-cob="cancelar">Cerrar</button><button type="button" class="btn" data-cob="guardar">Guardar</button></div></div>';
    document.body.appendChild(bg);
    var teclas = function(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(); } };
    var cerrar = function() { bg.remove(); document.removeEventListener('keydown', teclas, true); };
    var err = bg.querySelector('#dsCobErr');
    var listo = function(msg) { cerrar(); dsToast(msg); dsRenderACargoSupport(document.getElementById('dsACargo')); };
    window.dsFetchJSON('/design/api/support-time/candidatos').then(function(l) {
      bg.querySelector('#dsCobQuien').innerHTML = '<option value="">Elegir…</option>' + l.map(function(p) { return '<option value="' + p.id + '">' + dsEsc(p.nombre) + '</option>'; }).join('');
    }).catch(function(e) { err.textContent = e.message; });
    bg.addEventListener('click', function(e) {
      var q = e.target.closest('[data-quitar]');
      if (q) { postJSON('/design/api/support-time/cobertura/' + q.dataset.quitar + '/quitar', {}).then(function() { listo('Se quitó la cobertura.'); }, function(x) { err.textContent = x.message; }); return; }
      var b = e.target.closest('[data-cob]'); if (!b) return;
      if (b.dataset.cob === 'cancelar') { cerrar(); return; }
      var turno = parseInt(bg.querySelector('#dsCobTurno').value, 10), quien2 = bg.querySelector('#dsCobQuien'), de = bg.querySelector('#dsCobDesde').value, ha = bg.querySelector('#dsCobHasta').value;
      if (!quien2.value) { err.textContent = 'Elige quién cubre el turno.'; return; }
      if (!de || !ha) { err.textContent = 'Elige las fechas.'; return; }
      if (ha < de) { err.textContent = 'La fecha final no puede ser antes de la inicial.'; return; }
      postJSON('/design/api/support-time/cobertura', {turno: turno, empleadoId: parseInt(quien2.value, 10), desde: de, hasta: ha}).then(function() {
        listo(quien2.options[quien2.selectedIndex].text + ' cubre el turno ' + dsRangoTxt({desde: de, hasta: ha}) + '.');
      }, function(x) { err.textContent = x.message; });
    });
    bg.addEventListener('mousedown', function(e) { if (e.target === bg) cerrar(); });
    document.addEventListener('keydown', teclas, true);
  }
  function dsRenderACargo(dia) {
    var a = dia && dia.aCargo, hoy = !!(a && a.esYo && a.activa);
    if (DS.aCargoHoy !== hoy) { DS.aCargoHoy = hoy; dsActualizarTitulo(); }
    var cont = document.getElementById('dsACargo'); if (!cont) return;
    if (DS.areaFormato === 'support') { dsRenderACargoSupport(cont); return; }
    cont.innerHTML = '';
    cont.hidden = !(dia && (dia.puedeDelegar || (a && a.esYo)));
    if (cont.hidden) return;
    if (a && a.esYo) {
      cont.innerHTML = '<span class="ds-acargo-chip yo" title="Mientras tanto puedes asignar y editar los casos de todo el equipo, como el manager.">' +
        (a.activa ? 'A cargo hasta el ' + dsACargoFecha(a.hasta) : 'A cargo ' + dsRangoTxt(a)) + '</span>';
      return;
    }
    if (a) {
      // Varias asignaciones (Rosember, 26-oct-2026): se muestra la de hoy (o la próxima) y cuántas más hay programadas
      var mas = (a.lista || []).length - 1;
      var detalle = (a.lista || []).map(function(x) { return x.nombre + ': ' + dsRangoTxt(x); }).join('\n');
      // Pestaña del borde derecho: texto corto (primer nombre); el detalle va en el título. Toda la pestaña abre «Cambiar».
      var corto = String(a.nombre || '').split(' ')[0];
      cont.innerHTML = '<button type="button" id="dsACargoEditar" class="ds-acargo-chip' + (a.activa ? '' : ' prog') + '" title="' +
        dsEsc(detalle + '\nAutorizó: ' + (a.asignadoPor || '—') + '\n\nClic para ver o cambiar') + '" aria-label="Ver o cambiar quién queda a cargo">' +
        (a.activa ? 'A cargo: ' + dsEsc(corto) + ' · hasta el ' + dsACargoFecha(a.hasta) : 'Programado: ' + dsEsc(corto)) +
        (mas > 0 ? ' · +' + mas : '') + '</button>';
    } else {
      cont.innerHTML = '<button type="button" class="btn gris" id="dsACargoEditar" title="Autoriza a alguien a asignar casos en este Schedule mientras no estás">Dejar a cargo</button>';
    }
    document.getElementById('dsACargoEditar').onclick = function() { dsModalACargo(dia); };
  }
  function dsModalACargo(dia) {
    var a = dia.aCargo, hoy = dsFechaISO(new Date()), lista = (a && a.lista) || [], cambio = false;
    var url = '/design/api/teams/' + DS.teamId + '/delegacion';
    var bg = document.createElement('div'); bg.className = 'ds-qc-bg ds-fondo-50';   // fondo al 50 % (Rosember, 26-oct-2026)
    var delEquipo = (dia.designers || []).filter(function(d) { return !d.esManager; });
    // «Otra persona…» (Rosember, 26-oct-2026): a veces queda a cargo alguien de otro equipo de la misma área
    var ops = delEquipo.map(function(d) { return '<option value="' + d.id + '">' + dsEsc(d.nombre) + '</option>'; }).join('') +
              '<option value="otra">Otra persona…</option>';
    // Al agregar varias seguidas (una persona por día), las fechas proponen el día siguiente a la última asignación
    var sigDia = function() {
      var u = lista.reduce(function(m, x) { return x.hasta > m ? x.hasta : m; }, '');
      if (!u || u < hoy) return hoy;
      var d = new Date(u + 'T12:00:00'); d.setDate(d.getDate() + 1); return dsFechaISO(d);
    };
    bg.innerHTML = '<div class="ds-qc ds-acargo-form" role="dialog" aria-modal="true" aria-labelledby="dsACargoTit" style="width:460px">' +
      '<h4 id="dsACargoTit">Dejar a cargo del equipo</h4>' +
      '<div class="ds-qc-sub">Mientras no estás, quien quede a cargo puede asignar y editar los casos de todo el equipo en este Schedule, igual que tú. ' +
      'Puedes programar varias asignaciones (por ejemplo, una persona distinta cada día); cada día solo una persona. Se apagan solas al terminar sus fechas.</div>' +
      '<div class="ds-acargo-lista" id="dsACargoLista"></div>' +
      '<div class="ds-qc-sub" style="margin:12px 0 4px;font-weight:600">Agregar una asignación</div>' +
      '<label for="dsACargoQuien">Persona</label><select id="dsACargoQuien">' + ops + '</select>' +
      '<div id="dsACargoOtraW" hidden style="margin-top:6px"><input type="search" id="dsACargoBuscar" placeholder="Busca por nombre o equipo…" style="width:100%;box-sizing:border-box;margin-bottom:4px">' +
      '<select id="dsACargoOtra" size="6" aria-label="Personas de la misma área" style="width:100%"></select></div>' +
      '<div class="ds-acargo-fechas"><div><label for="dsACargoDesde">Desde</label><input type="date" id="dsACargoDesde" min="' + hoy + '"></div>' +
      '<div><label for="dsACargoHasta">Hasta</label><input type="date" id="dsACargoHasta" min="' + hoy + '"></div></div>' +
      '<div class="ds-qc-err" id="dsACargoErr"></div>' +
      '<div class="ds-qc-btns"><button type="button" class="btn gris" data-ac="cerrar">Cerrar</button>' +
      '<button type="button" class="btn" data-ac="agregar">Agregar</button></div></div>';
    document.body.appendChild(bg);
    var err = document.getElementById('dsACargoErr'), inDesde = document.getElementById('dsACargoDesde'), inHasta = document.getElementById('dsACargoHasta');
    var ponerFechas = function() { inDesde.value = inHasta.value = sigDia(); };
    var pintarLista = function() {
      document.getElementById('dsACargoLista').innerHTML = lista.length ? lista.map(function(x) {
        return '<div class="ds-cob-fila"><span>' + dsEsc(x.nombre) + ' · ' + dsRangoTxt(x) + (x.activa ? ' <b>(hoy)</b>' : '') + '</span>' +
               '<button type="button" class="btn rojo mini" data-quitar="' + dsEsc(x.id) + '">Quitar</button></div>'; }).join('')
        : '<p class="ds-prest-vacio">Nadie queda a cargo por ahora.</p>';
    };
    pintarLista(); ponerFechas();
    inDesde.addEventListener('change', function() { if (!inHasta.value || inHasta.value < inDesde.value) inHasta.value = inDesde.value; });
    var teclas = function(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(); } };
    var cerrar = function() { bg.remove(); document.removeEventListener('keydown', teclas, true); if (cambio) dsCargarDia(); };
    var nuevaLista = function(r) { lista = (r && r.aCargo && r.aCargo.lista) || []; cambio = true; pintarLista(); };
    bg.addEventListener('click', function(e) {
      var q = e.target.closest('[data-quitar]');
      if (q) {
        err.textContent = '';
        postJSON(url + '/quitar?entrada=' + encodeURIComponent(q.dataset.quitar), {}).then(function(r) { nuevaLista(r); ponerFechas(); },
                                                                                          function(x) { err.textContent = x.message; });
        return;
      }
      var b = e.target.closest('[data-ac]'); if (!b) return;
      if (b.dataset.ac === 'cerrar') { cerrar(); return; }
      var sel = document.getElementById('dsACargoQuien'), de = inDesde.value, ha = inHasta.value;
      var quien = sel.value === 'otra' ? document.getElementById('dsACargoOtra') : sel;
      err.textContent = '';
      if (!quien.value) { err.textContent = 'Elige a la persona que queda a cargo.'; return; }
      if (!de || !ha) { err.textContent = 'Elige las fechas.'; return; }
      if (ha < de) { err.textContent = 'La fecha final no puede ser antes de la inicial.'; return; }
      var opt = quien.options[quien.selectedIndex];
      postJSON(url, {empleadoId: parseInt(quien.value, 10), desde: de, hasta: ha}).then(function(r) {
        nuevaLista(r); ponerFechas();
        dsToast((opt.dataset.nombre || opt.text) + ' queda a cargo ' + dsRangoTxt({desde: de, hasta: ha}) + '.');
      }, function(x) { err.textContent = x.message; });
    });
    // «Otra persona…»: buscador con las personas de la misma área que no son del equipo
    var selQuien = document.getElementById('dsACargoQuien'), otraW = document.getElementById('dsACargoOtraW'), candidatos = null;
    var norm = function(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(); };
    var pintarOtras = function() {
      var q = norm(document.getElementById('dsACargoBuscar').value), sl = document.getElementById('dsACargoOtra');
      var filas = (candidatos || []).filter(function(c) { return !q || norm(c.nombre + ' ' + c.equipo).indexOf(q) >= 0; });
      sl.innerHTML = filas.length ? filas.map(function(c) {
        return '<option value="' + c.id + '" data-nombre="' + dsEsc(c.nombre) + '">' + dsEsc(c.nombre) + ' — ' + dsEsc(c.equipo) + '</option>'; }).join('')
        : '<option value="" disabled>' + (candidatos ? 'No hay nadie con ese nombre en el área.' : 'Cargando…') + '</option>';
    };
    selQuien.addEventListener('change', function() {
      otraW.hidden = selQuien.value !== 'otra';
      if (otraW.hidden) return;
      pintarOtras();
      document.getElementById('dsACargoBuscar').focus();
      if (!candidatos) window.dsFetchJSON(url + '/candidatos').then(function(c) { candidatos = c || []; pintarOtras(); },
                                                                     function(x) { candidatos = []; pintarOtras(); err.textContent = 'No se pudo cargar la lista: ' + x.message; });
    });
    document.getElementById('dsACargoBuscar').addEventListener('input', pintarOtras);
    bg.addEventListener('mousedown', function(e) { if (e.target === bg) cerrar(); });
    document.addEventListener('keydown', teclas, true);
    selQuien.focus();
  }

  function dsAplicarDia(dia, soloOrdenes) {
    if (dia.ahoraMs) {  // diferencia entre el reloj del computador y el del servidor
      DS.desfase = dia.ahoraMs - Date.now();
      if (Math.abs(DS.desfase) > 5 * 60000 && !DS.avisoReloj) {
        DS.avisoReloj = true;
        dsToast('⚠️ La hora de este computador no está bien (' + Math.round(Math.abs(DS.desfase) / 60000) + ' min de diferencia). Los descansos se registran con la hora de Colombia igual; conviene ajustar el reloj.');
      }
    }
    DS.diaData = dia;
    DS.diaVersion = dia.version || null;  // huella del día (Schedule en vivo)
    DS.diaVersionClave = DS.teamId + ':' + dsFechaISO(dsFechaSeleccionada());
    document.querySelectorAll('.ds-btn-apoyo').forEach(function(b) { b.style.display = dia.soloPropias ? '' : 'none'; });   // solo el diseñador pide apoyo
    dsRenderACargo(dia);
    dsRenderCopias(dia);
    dsPintarProduccion();
    dsPanelesN6(dia);
    if (dsAreaNombre() === DS_AREA_MATERIAL || dsEsRD()) dsRenderTabla('material');
    if (dsN6Separado()) { dsRenderTabla('tibar'); dsRenderTabla('dummy'); }
    dsRenderTabla('principal');
    if (DS.areaFormato === 'dual') dsRenderTabla('nightguard');
    dsRenderPrestadas();
    dsAplicarCierre();
    dsRenderKpis(dia);
    if (!soloOrdenes) dsRenderBreaks(dia);
    dsColoresSubirLocales();   // colores que el manager tenía solo en su PC: pasan a ser del equipo
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
        if (DS.todasUlt && Date.now() - DS.todasUlt < 8000) { dsVivoPend = true; return; }   // se vuelve a intentar en la próxima revisión
        DS.todasUlt = Date.now();
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
      if (r.v === DS.diaVersion) return;  // sin cambios
      if (dsOcupado()) { dsVivoPend = true; return; }  // está escribiendo: se aplica apenas termine
      return api(url).then(function(dia) {
        if (DS.diaUrl !== url || dsOcupado()) return;
        dia._fecha = fecha; dia._team = parseInt(clave);
        dsAplicarVivo(dia, r.v);
      });
    }).catch(function() {});
  }
  // Aplica un día ya armado (pedido al servidor o armado con el cambio de un aviso). Si no cambió nada de lo que se ve, no
  // redibuja; si cambió, conserva el foco y el scroll y resalta un momento las filas que cambiaron.
  function dsAplicarVivo(dia, nuevaVersion) {
    var antes = {};
    ['material', 'tibar', 'dummy', 'principal', 'nightguard', 'prestadas'].forEach(function(t) {
      (DS.diaData[t] || []).forEach(function(f) { antes[f.id] = dsHuellaFila(f); });
    });
    var sinV = function(d) { var c = Object.assign({}, d); delete c.version; delete c._fecha; delete c._team; delete c.ahoraMs; return JSON.stringify(c); };
    var mismo = sinV(dia) === sinV(DS.diaData), forzar = DS.forzarRender;
    DS.forzarRender = false;
    var y = window.scrollY;
    if (mismo && !forzar) { if (nuevaVersion) { DS.diaVersion = nuevaVersion; DS.diaData.version = nuevaVersion; } return; }  // fue un cambio propio: ya se ve
    var act = document.activeElement, foco = null;
    if (act && act.dataset && act.dataset.campo) {
      var trA = act.closest('tr[data-id]'), tbA = act.closest('[id^="dsTabla"]');
      if (trA && tbA) foco = {tabla: tbA.id, id: trA.dataset.id, campo: act.dataset.campo};
    }
    var versionPrevia = DS.diaVersion;
    dsAplicarDia(dia);
    if (!nuevaVersion) DS.diaVersion = versionPrevia;   // armado con un parche: la huella del servidor se revisa en la próxima revisión de seguridad
    if (foco) {  // vuelve a la misma celda
      var el = document.querySelector('#' + foco.tabla + ' tr[data-id="' + foco.id + '"] [data-campo="' + foco.campo + '"]');
      if (el) el.focus({preventScroll: true});
    }
    window.scrollTo(0, y);
    ['material', 'tibar', 'dummy', 'principal', 'nightguard', 'prestadas'].forEach(function(t) {
      (dia[t] || []).forEach(function(f) {
        if (antes[f.id] === dsHuellaFila(f)) return;
        var tr = document.querySelector('#dsVistaEquipo tr[data-id="' + f.id + '"]');
        if (tr) { tr.classList.add('ds-vivo'); setTimeout(function() { tr.classList.remove('ds-vivo'); }, 2500); }
      });
    });
  }
  // El aviso trae las órdenes cambiadas ({t:'ord', team, fecha, o:[...], x:[ids]}): se actualizan solo esas filas, sin pedir
  // el día al servidor (auditoría 19-oct-2026: antes cada guardado hacía que todos los compañeros pidieran el día completo).
  // Un diseñador recibe solo las suyas; si una orden deja de ser suya (la reasignaron), se quita de su pantalla.
  var dsParches = [];
  // Datos que arma /dia y que el aviso en vivo o la respuesta de un guardado no repiten: se conservan de la fila anterior
  // («Bite Finish» de Removable Denture; equipo, manager y equipo de origen en la tabla de Removable). 21-oct-2026.
  var DS_EXTRAS_FILA = ['rdBite', 'manager', 'equipo', 'teamOrigen'];
  function dsConservarExtras(antes, o) {
    if (!antes) return o;
    var faltan = DS_EXTRAS_FILA.filter(function(k) { return o[k] === undefined && antes[k] !== undefined; });
    if (!faltan.length) return o;
    var n = Object.assign({}, o);
    faltan.forEach(function(k) { n[k] = antes[k]; });
    return n;
  }
  function dsParchar(a) {
    if (!DS.diaData || a.fecha !== dsFechaISO(dsFechaSeleccionada())) return;   // no es el día que se está viendo
    if (a.team !== DS.teamId) {
      // Orden de otro equipo que me prestaron (o a la que me enviaron como ayuda): se vuelve a pedir el día para el panel «Prestadas»
      var yo = DS.diaData.miId, mias = (DS.diaData.prestadas || []).map(function(p) { return p.id; });
      var toca = (a.o || []).some(function(o) { return o.designerId === yo || mias.indexOf(o.id) >= 0; }) ||
                 (a.x || []).some(function(id) { return mias.indexOf(id) >= 0; });
      if (toca) { dsVivoPend = true; setTimeout(function() { dsVivoQuiza(false); }, 200); }
      return;
    }
    var vista = document.getElementById('dsVistaEquipo');
    if (!vista || vista.style.display === 'none') return;
    dsParches.push(a);
    dsVivoQuiza(false);
  }
  function dsAplicarParches() {
    if (!dsParches.length || !DS.diaData || dsOcupado()) return;
    var lista = dsParches.splice(0, dsParches.length);
    var dia = Object.assign({}, DS.diaData), tablas = ['material', 'tibar', 'dummy', 'principal', 'nightguard'];
    var solo = !!(DS.diaData.soloPropias && !DS.diaData.soloEditaPropias), yo = DS.diaData.miId;
    var clave = DS.teamId + ':' + dsFechaISO(dsFechaSeleccionada());
    tablas.forEach(function(t) { dia[t] = (DS.diaData[t] || []).slice(); });
    lista.forEach(function(a) {
      if (a.team + ':' + a.fecha !== clave) return;
      var quitar = function(id) { tablas.forEach(function(t) { dia[t] = dia[t].filter(function(f) { return f.id !== id; }); }); };
      (a.x || []).forEach(quitar);
      (a.o || []).forEach(function(o) {
        var antes = null;
        tablas.forEach(function(t) { antes = antes || dia[t].find(function(f) { return f.id === o.id; }) || null; });
        o = dsConservarExtras(antes, o);
        quitar(o.id);
        if (tablas.indexOf(o.tabla) < 0 || (solo && o.designerId !== yo)) return;
        dia[o.tabla].push(o);
      });
    });
    tablas.forEach(function(t) { dia[t].sort(function(x, y) { return (x.ordenVisual - y.ordenVisual) || (x.id - y.id); }); });
    dsAplicarVivo(dia, null);
  }
  // Con la conexión en vivo (static/design/vivo.js) solo se revisa cuando llega un aviso de ESTE equipo y día (o de
  // cualquier equipo de ese día en la vista de todas las áreas), más una revisión de seguridad cada 90 s. Sin
  // conexión se vuelve a revisar cada 5 s como antes.
  var dsVivoPend = false, dsVivoUlt = 0;
  function dsVivoQuiza(forzar) {
    dsAplicarParches();
    var enVivo = window.DSVivo && window.DSVivo.conectado;
    if (forzar || !enVivo || dsVivoPend || Date.now() - dsVivoUlt > 90000) { dsVivoUlt = Date.now(); dsVivoPend = false; dsVivoTick(); }
  }
  setInterval(function() { dsVivoQuiza(false); }, DS_VIVO_MS);
  document.addEventListener('visibilitychange', function() { if (!document.hidden) dsVivoQuiza(true); });
  document.addEventListener('ds:vivo', function(e) {
    var a = e.detail || {};
    if (a.t === 'reconectado') {
      // Al abrir la página: si la conexión en vivo ya estaba lista cuando se pidió el día, no se perdió nada (simulación de
      // 150 personas, 19-oct-2026: cada apertura pedía la huella del día dos veces sin necesidad)
      var v = window.DSVivo;
      if (a.primera && DS.diaPedidoEn && v && v.holaEn && v.holaEn <= DS.diaPedidoEn) return;
      dsVivoPend = true; return;
    }
    if (a.t === 'cfg') {   // cambiaron equipos, catálogos, festivos...: se vuelven a pedir con una espera al azar (para no pedir todos a la vez)
      clearTimeout(DS.tCfg);
      DS.tCfg = setTimeout(function() { catalogoCache = {}; DS.forzarRender = true; DS.diaVersion = '(cfg)'; dsVivoPend = true; dsVivoQuiza(false); }, 500 + Math.random() * 4000);
      return;
    }
    if (a.t === 'ord' && DS.lunes) {
      var chkO = document.getElementById('dsTodasAreasChk');
      if (chkO && chkO.checked) { dsVivoPend = true; setTimeout(function() { dsVivoQuiza(false); }, 200); return; }   // todas las áreas: se pide completo
      dsParchar(a); return;
    }
    if (a.t === 'dia' && a.p) return;   // el cambio de las órdenes ya llegó con el aviso 'ord'
    if (a.t !== 'dia' || !DS.lunes) return;
    var chkTodas = document.getElementById('dsTodasAreasChk'), todas = chkTodas && chkTodas.checked;
    var fecha = todas ? dsFechaISO(new Date(DS.lunes.getFullYear(), DS.lunes.getMonth(), DS.lunes.getDate() + DS.diaSel))
                      : (DS.teamId ? dsFechaISO(dsFechaSeleccionada()) : null);
    if (!a.team || ((a.fecha === fecha || a.fecha === '*') && (todas || a.team === DS.teamId))) { dsVivoPend = true; setTimeout(function() { dsVivoQuiza(false); }, 200); }
  });

  function dsCargarDia(soloOrdenes) {
    if (!DS.teamId) return;
    var fechaPedida = dsFechaISO(dsFechaSeleccionada()), teamPedido = DS.teamId;
    var url = '/design/api/dia?team_id=' + DS.teamId + '&fecha=' + fechaPedida;
    DS.diaUrl = url; DS.diaPedidoEn = Date.now();
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
      if (window.dsSoltar) window.dsSoltar();   // primer día listo: se muestra todo junto y arrancan las cargas secundarias
      dsVivoUlt = Date.now();   // recién traído del servidor: la revisión de seguridad (90 s) cuenta desde aquí
      if (DS.resaltar) { var idR = DS.resaltar; DS.resaltar = null; dsMostrarResaltada(idR, 0); }   // viene de la búsqueda
    }).catch(function(e) {
      if (DS.diaUrl !== url) return;
      if (window.dsSoltar) window.dsSoltar();
      document.body.classList.remove('ds-cargando-dia');
      DS.diaData = null;
      dsRenderACargo(null);
      dsRenderPrestadas();
      ['dsTablaMaterial', 'dsTablaTibar', 'dsTablaDummy', 'dsTablaPrincipal', 'dsTablaNightguard'].forEach(function(id) { var el = document.getElementById(id); if (el) el.innerHTML = ''; });
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
                   'solicitadoPor', 'situacion', 'solucion', 'clasificacion', 'soporte', 'estado', 'qc', 'qcReporte', 'notas',
                   'zHoraInicio', 'zSHold', 'zFHold', 'zHoldMinutos', 'zHoraFin', 'zQc', 'zQcReporte', 'artStart', 'artRtd',
                   'xHoraInicio', 'xSHold', 'xFHold', 'xHoldMinutos', 'xHoraFin', 'xQc', 'xQcReporte',
                   'nHoraInicio', 'nSHold', 'nFHold', 'nHoldMinutos', 'nHoraFin', 'nQc', 'nQcReporte'];
  function dsClon(o) { return JSON.parse(JSON.stringify(o)); }
  function dsMismaOrden(a, b) { return DS_CAMPOS.every(function(k) { return (a[k] == null ? '' : a[k]) === (b[k] == null ? '' : b[k]); }); }
  function dsSoloCampos(o) { var r = {}; DS_CAMPOS.forEach(function(k) { if (o[k] !== undefined) r[k] = o[k]; }); return r; }

  window.dsToast = function(m) { dsToast(m); };
  // N2 (13-oct-2026): órdenes copiadas desde Face cuyo QC se desmarcó. El manager de N2 decide con Face: borrar o mantener.
  function dsRenderCopias(dia) {
    var c = document.getElementById('dsCopiasPend'); if (!c) return;
    var lista = dia.copiasPendientes || [];
    if (!lista.length) { c.innerHTML = ''; return; }
    var puede = !dsSoloPropias();
    c.innerHTML = lista.map(function(x) {
      return '<div class="ds-copia-pend" role="alert"><div><b>⚠️ La orden ' + dsEsc(x.orden) + ' (' + dsEsc(x.paciente) + ', ' + dsEsc(x.centro) + ') se desmarcó el QC en ' + dsEsc(x.faceEquipo) + '</b>' +
        (x.desmarcadaEn ? ' · ' + new Date(x.desmarcadaEn).toLocaleString('es-CO', {timeZone: 'America/Bogota'}) : '') +
        '<br><span>Habla con el manager de Face: si Face aprueba el cambio, borra la orden; si la mantienen, se queda.</span></div>' +
        (puede ? '<div class="ds-copia-acc"><button type="button" class="btn rojo mini" data-copia="' + x.ordenId + '" data-accion="borrar">Borrar la orden</button>' +
          '<button type="button" class="btn gris mini" data-copia="' + x.ordenId + '" data-accion="mantener">Mantener</button></div>' : '') + '</div>';
    }).join('');
    c.querySelectorAll('[data-copia]').forEach(function(b) {
      b.onclick = function() { dsDecidirCopia(b.dataset.copia, b.dataset.accion); };
    });
  }
  function dsDecidirCopia(id, accion) {
    if (accion === 'borrar' && !confirm('¿Borrar la orden copiada desde Face? Confirma que Face aprobó el cambio.')) return;
    postJSON('/design/api/copias-face/' + id + '/decidir', {accion: accion}).then(function() {
      dsToast(accion === 'borrar' ? 'Orden borrada.' : 'Orden mantenida.');
      dsCargarDia();
    }).catch(function(e) { dsToast('⚠️ ' + e.message); });
  }
  // Face → N2 (13-oct-2026): aviso de la copia que se hace al marcar el QC (queda en N2 el día en que se marca)
  function dsAvisoN2(c) {
    if (!c.ok) return dsToast('⚠️ ' + c.motivo);
    dsToast(c.ya ? 'Esa orden ya estaba en N2 (' + c.equipo + ').' : 'Copiada a N2 para hoy: ' + c.equipo + ' (manager ' + c.manager + ').');
  }
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
  function dsTablaDe(el) {
    var cont = el.closest(dsSelTablas());
    return cont ? DS_TABLAS.filter(function(t) { return DS_CONT[t] === cont.id; })[0] : null;
  }
  // Solo las filas visibles (las ocultas no entran en la selección, copiar ni pegar)
  function dsFilasDom(tabla) { return Array.prototype.slice.call(document.querySelectorAll('#' + DS_CONT[tabla] + ' tbody tr:not(.ds-oculta)')); }
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
    var td = e.target.closest && e.target.closest(dsSelTablas('td[data-col]'));
    if (!td) { if (!e.target.closest(dsSelTablas('.ds-tabla'))) { DS.sel = null; dsPintarSel(); } return; }
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
    var td = e.target.closest && e.target.closest(dsSelTablas('td[data-col]'));
    if (!td || td === dsArrastre.td || dsTablaDe(td) !== dsArrastre.tabla) return;
    var k = dsCoord(td); DS.sel.r2 = k.r; DS.sel.c2 = k.c;
    td.closest(dsSelTablas('.ds-tabla')).classList.add('ds-arrastrando');
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
    var td = el.closest && el.closest(dsSelTablas('td[data-col]'));
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
    if (c.t === 'multi') {
      var out = [];
      for (var i = 0, it = v.split(/\s*[;,]\s*/).filter(Boolean); i < it.length; i++) {
        var m = c.opciones.find(function(o) { return o && o.toLowerCase() === it[i].toLowerCase(); });
        if (!m) return undefined;
        if (out.indexOf(m) < 0) out.push(m);
      }
      return out.indexOf('N/A') >= 0 && out.length > 1 ? undefined : out.join('; ');
    }
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
    if (DS.diaData && DS.diaData.puedeQc === false) cambios = cambios.filter(function(x) { return !dsEsCampoQc(x.spec.k); });
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
      return nuevas.length && dsPuedeCrearVarias() ? dsCrearOrdenes(tabla, nuevas, false) : [];
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
    if (!multi && !(el && el.closest && el.closest(dsSelTablas('.ds-tabla')))) return;
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
    if (unValor && celdasSel.length <= 1 && dsEsTexto(el) && el.closest(dsSelTablas('.ds-tabla'))) return;
    if (!(el && el.closest && el.closest(dsSelTablas('.ds-tabla'))) && celdasSel.length <= 1) return;
    e.preventDefault();
    var s = DS.sel, tabla = s.tabla, spec = dsSpec(tabla);
    var trs = dsFilasDom(tabla), r0 = Math.min(s.r1, s.r2), c0 = Math.min(s.c1, s.c2);
    var cambios = [], extras = [], omitidos = 0, bloqueados = 0, qcOmitidos = 0;
    var poner = function(tr, c, texto) {
      var cs = spec[c]; if (!cs) return;
      var celda = tr ? tr.querySelector('td[data-col="' + c + '"] [data-campo]') : null;
      if (celda && celda.disabled) { bloqueados++; return; }
      var ref = celda || document.querySelector('#' + DS_CONT[tabla] + ' td[data-col="' + c + '"] [data-campo]');
      var v = dsValorPegado(ref, cs, texto);
      if (v === undefined) { omitidos++; return; }
      if (dsEsCampoQc(cs.k) && v === true) { qcOmitidos++; return; } // el QC se marca con su recuadro de hallazgos
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
      if (extras.length && !dsPuedeCrearVarias()) { bloqueados += extras.length; extras = []; }
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
    var enTabla = el && el.closest && el.closest(dsSelTablas('.ds-tabla'));
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
    dsCalSincronizar();
    dsPintarDiasLat(function(idx) { DS.diaSel = idx; dsRenderDiasTodas(); dsCargarTodasAreas(); });
  }
  var COLS_RESUMEN = [
    {k:'orden', l:'Orden'}, {k:'paciente', l:'Paciente'}, {k:'centro', l:'Centro'},
    {k:'producto', l:'Producto'}, {k:'designerNombre', l:'Diseñador'}, {k:'estado', l:'Estado'},
  ];
  // Clase de color de la fila según el estado (mismos colores que el horario del equipo)
  function dsClaseEstado(estado) {
    var e = String(estado || '').trim().toLowerCase();
    return {'hold': 'ds-fila-hold', 'dr authorization': 'ds-fila-aprobada', 'ready to design': 'ds-fila-ready', 'changes': 'ds-fila-ready', 'html': 'ds-fila-html', 'approved': 'ds-fila-aprobada', 'canceled': 'ds-fila-cancelada'}[e] || '';
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
  if (!areaId) return Promise.resolve();
  return ddApi('/design/api/teams?area_id=' + areaId).then(function(teams) {
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
    if (r === 'mes') { desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1); hasta = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0); }   // el mes completo (predeterminado desde el 19-oct-2026)
    if (r === 'quincena') {   // predeterminado (14-oct-2026): del 1 al 15, o del 16 al último día del mes
      if (hoy.getDate() <= 15) { desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1); hasta = new Date(hoy.getFullYear(), hoy.getMonth(), 15); }
      else { desde = new Date(hoy.getFullYear(), hoy.getMonth(), 16); hasta = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0); }
    }
    if (r === 'mesAnt') { desde = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1); hasta = new Date(hoy.getFullYear(), hoy.getMonth(), 0); }
    document.getElementById('ddDesde').value = ddIso(desde);
    document.getElementById('ddHasta').value = ddIso(hasta);
  }
  ddCargar();
}
// Un aprobador con un solo equipo abre el Dashboard con su área y su equipo ya elegidos.
function ddAplicarInicial() {
  var ini = window.DS_CFG.dashInicial; if (!ini) return Promise.resolve();
  document.getElementById('ddArea').value = ini.areaId;
  return ddCambioArea().then(function() { document.getElementById('ddTeam').value = ini.teamId; });
}
function ddLimpiar() {
  ['ddTeam', 'ddDesigner', 'ddProducto', 'ddEstado', 'ddQc'].forEach(function(id) { document.getElementById(id).value = ''; });
  document.getElementById('ddDesignerTxt').value = '';
  if (document.getElementById('ddArea').value) { document.getElementById('ddArea').value = ''; ddCambioArea(); }
  ddAplicarInicial().then(function() { ddRapido('mes'); });
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

// ---------- Casos por producto: una tabla por producto con su tiempo objetivo (manual) ----------
// El tiempo lo escribe el aprobador o admin según lo que esté mirando (puede variar); no se guarda: solo se recuerda
// mientras la página siga abierta, para que no se pierda al cambiar de filtro.
var DD_OBJETIVOS = {};
function ddParseObjetivo(t) {
  t = String(t || '').trim().replace(',', '.'); if (!t) return null;
  var m = t.match(/^(\d+):(\d{1,2})$/); if (m) return parseInt(m[1]) * 60 + parseInt(m[2]);
  var n = parseFloat(t); return isNaN(n) || n <= 0 ? null : n;
}
function ddCumple(c, obj) {  // true cumplió · false no cumplió · null sin dato (sin tiempo registrado o sin objetivo)
  if (obj === null || !c.duracionMin) return null;
  return c.duracionMin <= obj;
}
function ddResumenProducto(p, obj) {
  if (obj === null || !p.lista) return '';
  var si = 0, no = 0, sin = 0;
  p.lista.forEach(function(c) { var r = ddCumple(c, obj); if (r === null) sin++; else if (r) si++; else no++; });
  return '<span class="si">✔ ' + si + ' cumplieron</span> · <span class="no">✘ ' + no + ' no cumplieron</span>' + (sin ? ' · ' + sin + ' sin tiempo' : '');
}
function ddFilasProducto(p, obj) {
  return (p.lista || []).map(function(c) {
    var r = ddCumple(c, obj), dif = (r === null) ? '' : ((c.duracionMin - obj) > 0 ? '+' : '') + Math.round(c.duracionMin - obj) + ' min';
    return '<tr class="' + (r === null ? '' : r ? 'dd-cumple' : 'dd-nocumple') + '"><td>' + ddEsc(c.orden) + '</td><td class="dd-izq">' + ddEsc(c.paciente) + '</td><td>' + c.fecha + '</td>' +
      '<td>' + ddEsc(c.equipo) + '</td><td>' + ddEsc(c.designerNombre) + '</td><td>' + ddEsc(c.estado) + '</td><td>' + ddTiempo(c.duracionMin) + '</td>' +
      '<td class="dd-res">' + (r === null ? '—' : r ? '✔ Cumplió' : '✘ No cumplió') + '</td><td>' + dif + '</td></tr>';
  }).join('');
}
// 14-oct-2026: cada producto sale cerrado; sus casos se piden al abrirlo (con los filtros y el periodo del Dashboard)
// y solo puede haber uno abierto: al abrir otro, el anterior se cierra. Así no se cargan miles de filas de golpe.
var DD_PROD_ABIERTO = null;
function ddRenderProductos() {
  var cont = document.getElementById('ddProductoTablas'); if (!cont || !DD_ULTIMO) return;
  var lista = DD_ULTIMO.porProducto;
  if (!lista.length) { cont.innerHTML = '<p style="color:#4b5563">Sin datos.</p>'; return; }
  cont.innerHTML = '';
  lista.forEach(function(p) {
    var det = document.createElement('details'); det.className = 'dd-prod'; det.dataset.prod = p.producto;
    det.innerHTML = '<summary><span class="dd-prod-nombre"></span><span class="dd-prod-meta">' + p.casos + ' casos · promedio ' + ddTiempo(p.promedioMin) + '</span>' +
      '<span class="dd-prod-res"></span><label class="dd-prod-obj" onclick="event.stopPropagation()">Tiempo del producto <input type="text" inputmode="decimal" placeholder="min" aria-label="Tiempo del producto en minutos"> min</label></summary>' +
      '<div class="dd-prod-cuerpo"><p class="dd-p-nota">Cargando casos…</p></div>';
    det.querySelector('.dd-prod-nombre').textContent = p.producto || '(sin producto)';
    var inp = det.querySelector('input'), res = det.querySelector('.dd-prod-res'), cuerpo = det.querySelector('.dd-prod-cuerpo');
    inp.value = DD_OBJETIVOS[p.producto] || '';
    var pintar = function() {
      if (!p.lista) return;
      var o = ddParseObjetivo(inp.value); res.innerHTML = ddResumenProducto(p, o);
      var tb = cuerpo.querySelector('tbody'); if (tb) tb.innerHTML = ddFilasProducto(p, o);
    };
    var pendiente = null;   // espera a que termine de escribir: no redibuja la tabla en cada tecla
    inp.oninput = function() { DD_OBJETIVOS[p.producto] = inp.value; clearTimeout(pendiente); pendiente = setTimeout(pintar, 180); };
    inp.onclick = function(e) { e.stopPropagation(); };
    inp.onkeydown = function(e) { e.stopPropagation(); };
    det.addEventListener('toggle', function() {
      if (!det.open) { if (DD_PROD_ABIERTO === p.producto) DD_PROD_ABIERTO = null; return; }
      DD_PROD_ABIERTO = p.producto;
      cont.querySelectorAll('details.dd-prod[open]').forEach(function(o) { if (o !== det) o.open = false; });   // uno a la vez
      if (p.lista) return;
      var clave = DD_PARAMS;
      var listo = function(l) {
        if (clave !== DD_PARAMS) return;   // cambiaron los filtros mientras cargaba
        p.lista = l; DD_LISTAS[p.producto] = l;
        cuerpo.innerHTML = l.length ? '<table class="dd-tabla"><thead><tr><th>Orden</th><th>Paciente</th><th>Fecha</th><th>Equipo</th><th>Diseñador</th><th>Estado</th><th>Tiempo de diseño</th><th>Resultado</th><th>Diferencia</th></tr></thead><tbody></tbody></table>'
                                    : '<p class="dd-p-nota">Sin casos en este periodo.</p>';
        pintar();
      };
      if (DD_LISTAS.hasOwnProperty(p.producto)) { listo(DD_LISTAS[p.producto]); return; }
      ddApi('/design/api/dashboard/producto-casos?' + clave + '&prod=' + encodeURIComponent(p.producto || ''))
        .then(function(d) { listo(d.lista || []); })
        .catch(function(e) { cuerpo.innerHTML = '<p class="dd-p-nota" style="color:#b91c1c"></p>'; cuerpo.firstChild.textContent = 'No se pudieron cargar los casos: ' + e.message; });
    });
    cont.appendChild(det);
    if (DD_PROD_ABIERTO === p.producto) det.open = true;   // al cambiar de filtro, el que estaba abierto se recarga
  });
}

// A8 (13-oct-2026): el Dashboard se mira por área y por periodo (un año como máximo); ya no hay "Todo".
function ddCargarTendencia() {
  var box = document.getElementById('ddTendencia'), body = document.getElementById('ddTendenciaBody');
  DDT.ocultos = {};
  var area = document.getElementById('ddArea').value, team = document.getElementById('ddTeam').value;
  var desde = document.getElementById('ddDesde').value, hasta = document.getElementById('ddHasta').value;
  if ((!area && !team) || !desde || !hasta) { box.hidden = true; return; }
  var u = '/design/api/dashboard/tendencia?desde=' + desde + '&hasta=' + hasta + (team ? '&team_id=' + team : '&area_id=' + area);
  ddApi(u).then(function(d) { ddPintarTendencia(d, body, box); }).catch(function(e) { box.hidden = false; body.innerHTML = '<p class="dd-p-nota" style="color:#b91c1c"></p>'; body.firstChild.textContent = 'No se pudo cargar la tendencia: ' + e.message; });
}
var DDT = {d: null, ocultos: {}};
// El violeta (#7c3aed) se cambió por un verde azulado (28-oct-2026): el lila de Zullys es exclusivo y no debe parecerse a otro equipo.
var DDT_COL = ['#1d4ed8', '#dc2626', '#16a34a', '#d97706', '#0d9488', '#0891b2', '#db2777', '#65a30d', '#334155', '#ea580c'];
// Colores fijos por nombre (equipo o aprobador), en todas las gráficas del Dashboard: Zulys siempre en lila (Rosember, 28-oct-2026;
// se escribe «Zulys», se acepta también «Zully»)
var DDT_FIJOS = [{quien: ['zuly', 'zully'], color: '#a78bfa'}];
function ddTColores(series) {
  var norm = function(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); };
  var k = 0;   // los demás siguen la paleta en su orden, sin contar a quienes tienen color fijo
  return series.map(function(s) {
    var texto = norm(s.nombre + ' ' + (s.aprobador || ''));
    var fijo = DDT_FIJOS.find(function(f) { return f.quien.some(function(q) { return texto.indexOf(q) >= 0; }); });
    return fijo ? fijo.color : DDT_COL[k++ % DDT_COL.length];
  });
}
// Techo "redondo" para el eje Y (1, 2, 5, 10, 20, 50, ...)
function ddTecho(max) {
  var pasos = [1, 2, 5], m = 1;
  while (true) { for (var k = 0; k < pasos.length; k++) { if (pasos[k] * m >= max) return pasos[k] * m; } m *= 10; }
}
function ddPintarTendencia(d, body, box) {
  box.hidden = false;
  DDT.d = d;
  ddDibujarTendencia(body);
}
// Pestaña Resumen (Rosember, 21-oct-2026): una «Tendencia por equipo» por área (Face, N2, N3, N6), siempre en el mes en
// curso. Cada gráfica tiene su propio estado (qué equipos están ocultos). El servidor ya limita a los equipos del aprobador.
var DG = {tok: 0};
// Reportes de QC por diseñador del mes en curso (21-oct-2026): barras horizontales de más a menos, solo quien tiene ≥ 1.
// Pasa el mouse sobre una barra para ver sus hallazgos.
// Reparto de productos por equipo (21-oct-2026): tabla diseñador × producto del mes, con la equidad de cada producto
var DG_REP = {team: null, desde: '', hasta: '', mes: ''};
var DG_EQ = {pareja: ['Pareja', 'dg-eq-ok'], algo: ['Algo desigual', 'dg-eq-medio'], desigual: ['Desigual', 'dg-eq-mal'], pocos: ['Pocos casos', 'dg-eq-pocos']};
function dgRepCargar(t) {
  var box = document.getElementById('dgRep'), tabla = document.getElementById('dgRepTabla'), sel = document.getElementById('dgRepTeam');
  if (!box) return;
  var u = '/design/api/dashboard/reparto?desde=' + DG_REP.desde + '&hasta=' + DG_REP.hasta + (DG_REP.team ? '&team_id=' + DG_REP.team : '');
  if (DD_MOV) tabla.style.opacity = '.4';
  ddApi(u).then(function(d) {
    if (t !== DG.tok) return;
    tabla.style.opacity = '';
    if (!d.equipos.length) { box.hidden = true; return; }
    box.hidden = false;
    var grupos = {};
    d.equipos.forEach(function(e) { (grupos[e.area] = grupos[e.area] || []).push(e); });
    sel.innerHTML = Object.keys(grupos).map(function(a) {
      return '<optgroup label="' + ddEsc(a) + '">' + grupos[a].map(function(e) {
        return '<option value="' + e.id + '"' + (e.id === d.teamId ? ' selected' : '') + '>' + ddEsc(e.nombre) + ' (' + e.casos + ')</option>';
      }).join('') + '</optgroup>';
    }).join('');
    DG_REP.team = d.teamId;
    dgRepPintar(d, tabla, document.getElementById('dgRepSub'));
    var bch = document.getElementById('dgRepCh');   // N2: apartado de Changes
    if (bch) { bch.hidden = !d.changes; if (d.changes) dgRepPintar(d.changes, document.getElementById('dgRepChTabla'), document.getElementById('dgRepChSub'), 'changes'); }
  }).catch(function(e) {
    if (t !== DG.tok) return;
    tabla.style.opacity = ''; box.hidden = false; tabla.innerHTML = '<tbody><tr><td style="color:#b91c1c"></td></tr></tbody>'; tabla.querySelector('td').textContent = 'No se pudo cargar: ' + e.message;
  });
}
// Una tabla de Reparto (la principal o la de Changes de N2) con su subtítulo
function dgRepPintar(d, tabla, sub, que) {
    var n = d.productos.length, total = d.totales[n] || 0;
    sub.textContent = 'Mes en curso · ' + DG_REP.mes + ' · ' + (d.casos != null ? d.casos : total) + ' casos · ' + d.filas.length + ' diseñador' + (d.filas.length === 1 ? '' : 'es') + ' con casos';
    var eqHtml = function(e) {
      if (!e) return '<span class="dd-p-nota">—</span>';
      var x = DG_EQ[e.nivel];
      return '<span class="dg-eq ' + x[1] + '" title="Lo que hizo cada uno se separa en promedio ' + e.cv + ' % de lo que le correspondía según los días en que estuvo">' + x[0] + '</span>';
    };
    // Cada celda se compara con lo que le correspondía a ese diseñador: los casos de cada día se reparten entre quienes
    // estaban ese día (sin vacaciones, incapacidad, luto, calamidad… de Tiempos libres y People; 22-oct-2026). Antes:
    // vacaciones, calamidades, incapacidades… de Tiempos libres y de People). Ausente todo el periodo: no se marca.
    var celda = function(v, i, e, f) {
      var esp = f.esperado ? f.esperado[i] : 0;
      // el manager no entra en la equidad (27-oct-2026): su fila se muestra sin marcas
      if (!e || !f.dias || f.manager) return '<td' + (f.dias || f.manager ? '' : ' class="dg-rep-aus"') + '>' + (v || '<span class="dg-rep-0">0</span>') + '</td>';
      // lo prestado en otros equipos se suma a la celda pero no a la equidad: la marca compara sin eso
      var ve = f.valoresEq ? (i < f.valoresEq.length ? f.valoresEq[i] : f.valoresEq.reduce(function(a, b) { return a + b; }, 0)) : v;
      // ▲/▼ solo si se separa 2 casos o más de lo que le correspondía y el producto no es «pareja» ni de «pocos casos»
      var marca = e.nivel !== 'pareja' && e.nivel !== 'pocos' && Math.abs(ve - esp) >= 2;
      var r = esp ? ve / esp : 9, cl = !marca ? '' : (r >= 1.5 ? 'dg-rep-alto' : (r <= 0.5 ? 'dg-rep-bajo' : ''));
      var flecha = cl === 'dg-rep-alto' ? ' ▲' : (cl === 'dg-rep-bajo' ? ' ▼' : '');
      return '<td class="' + cl + '" title="Le correspondían ≈ ' + esp + ' (los casos de los ' + f.dias + ' días en que estuvo, repartidos entre los presentes)">' + (v || '0') + flecha + '</td>';
    };
    var diasCelda = function(f) {
      var t = f.ausencias.map(function(a) { return a.tipo + ': ' + a.dias + ' día' + (a.dias === 1 ? '' : 's'); }).join('\n');
      return '<td class="' + (f.dias ? (f.ausencias.length ? 'dg-rep-dias-aus' : '') : 'dg-rep-aus') + '"' + (t ? ' title="' + ddEsc(t).replace(/"/g, '&quot;') + '"' : '') + '>' +
        f.dias + ' / ' + d.habiles + (f.ausencias.length ? ' <span class="dg-rep-i">ⓘ</span>' : '') + '</td>';
    };
    var h = '<thead><tr><th class="dd-izq">Diseñador</th><th title="Días disponibles / días hábiles del mes hasta hoy">Días</th>' + d.productos.map(function(p) { return '<th>' + ddEsc(p) + '</th>'; }).join('') + '<th>Total</th></tr></thead><tbody>';
    h += d.filas.map(function(f) {
      return '<tr><td class="dd-izq"><b>' + ddEsc(f.nombre) + '</b>' + (f.manager ? ' <small class="dg-rep-aus-t" title="Sus casos cuentan en el total, no en la equidad">(manager)</small>' : '') +
        (f.fuera ? ' <small class="dg-rep-aus-t" title="Casos que hizo prestado en otros equipos: están sumados en su fila (como en Producción del día) pero no cuentan para la equidad">(+' + f.fuera + ' en otros equipos)</small>' : '') +
        (f.dias || f.manager ? '' : ' <small class="dg-rep-aus-t">ausente todo el periodo</small>') + '</td>' + diasCelda(f) +
        f.valores.map(function(v, i) { return celda(v, i, d.equidad[i], f); }).join('') +
        celda(f.total, n, d.equidad[n], f).replace('<td', '<td style="font-weight:700"') + '</tr>';
    }).join('');
    if (d.prestados) h += '<tr class="dg-rep-prest" title="' + ddEsc('Hechos por personas que no son del equipo:\n' + d.prestados.quienes.map(function(q) { return '• ' + q.nombre + ': ' + q.casos; }).join('\n')).replace(/"/g, '&quot;') + '"><td class="dd-izq">Prestados <span class="dg-rep-i">ⓘ</span></td><td></td>' + d.prestados.valores.map(function(v) { return '<td>' + v + '</td>'; }).join('') + '<td>' + d.prestados.total + '</td></tr>';
    h += '</tbody><tfoot><tr><th class="dd-izq">Total</th><th></th>' + d.totales.map(function(v) { return '<th>' + v + '</th>'; }).join('') + '</tr>' +
      '<tr><th class="dd-izq">Equidad</th><th></th>' + d.equidad.map(function(e) { return '<th>' + eqHtml(e) + '</th>'; }).join('') + '</tr></tfoot>';
    tabla.innerHTML = d.productos.length && (d.filas.length || d.prestados) ? h : '<tbody><tr><td class="dd-p-nota">' + (que === 'changes' ? 'Este equipo no tiene Changes' : 'Este equipo no tiene casos') + ' en el mes en curso.</td></tr></tbody>';
}
var DG_QC_MIN = 5;   // solo salen quienes tienen 5 reportes o más en el mes (Rosember, 21-oct-2026)
function dgQcCargar(desde, hasta, mes, t) {
  var box = document.getElementById('dgQc'), cont = document.getElementById('dgQcBarras');
  if (!box) return;
  if (DD_MOV) cont.style.opacity = '0';
  ddApi('/design/api/dashboard/qc-disenadores?desde=' + desde + '&hasta=' + hasta).then(function(d) {
    if (t !== DG.tok) return;
    cont.style.opacity = '';
    var filas = d.disenadores.filter(function(f) { return f.reportes >= DG_QC_MIN; });
    box.hidden = false;
    document.getElementById('dgQcSub').textContent = 'Mes en curso · ' + mes + ' · ' + DG_QC_MIN + ' reportes o más · ' + filas.length + ' diseñador' +
      (filas.length === 1 ? '' : 'es') + (filas.length ? ' · clic en una barra para ver sus errores' : '');
    if (!filas.length) { cont.innerHTML = '<p class="dd-p-nota">Nadie tiene ' + DG_QC_MIN + ' o más reportes de QC en el mes en curso.</p>'; return; }
    var max = filas[0].reportes;
    cont.className = filas.length > 10 ? 'dg-qc-dos' : '';
    cont.innerHTML = filas.map(function(f) {
      var ini = f.nombre.split(/\s+/).filter(Boolean).slice(0, 2).map(function(p) { return p[0]; }).join('').toUpperCase();
      var cara = f.foto ? '<img src="' + f.foto + '" alt="">' : '<span>' + ddEsc(ini) + '</span>';
      // clic en la barra: abre/cierra la lista de errores (hallazgos de QC) del diseñador en el mes
      var det = '<table class="dd-tabla dg-qc-tabla"><thead><tr><th>Fecha</th><th>Orden</th><th>Paciente</th><th>Producto</th><th class="dd-izq">Error (hallazgo de QC)</th></tr></thead><tbody>' +
        f.lista.map(function(h) {
          return '<tr><td>' + h.fecha.slice(8, 10) + '/' + h.fecha.slice(5, 7) + '</td><td>' + ddEsc(h.orden) + '</td><td>' + ddEsc(h.paciente) + '</td><td>' + ddEsc(h.producto) +
            '</td><td class="dd-izq">' + ddEsc(h.hallazgo) + '</td></tr>';
        }).join('') + '</tbody></table>';
      return '<div class="dg-qc-item"><div class="da-barra dg-qc-barra" role="button" tabindex="0" aria-expanded="false"><span class="n"><i class="dg-qc-cara">' + cara + '</i>' + ddEsc(f.nombre) +
        ' <small>' + ddEsc(f.equipos.join(', ')) + '</small></span><span class="b"><i style="width:' + Math.max(3, f.reportes * 100 / max) + '%"></i></span><b>' + f.reportes + '</b></div>' +
        '<div class="dg-qc-det" hidden>' + det + '</div></div>';
    }).join('');
    cont.querySelectorAll('.dg-qc-barra').forEach(function(b) {
      var abrir = function() {
        var det = b.nextElementSibling, ab = det.hidden;
        det.hidden = !ab; b.setAttribute('aria-expanded', ab); b.classList.toggle('on', ab);
      };
      b.addEventListener('click', abrir);
      b.addEventListener('keydown', function(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); } });
    });
    ddAnimar(cont, null);
  }).catch(function(e) {
    if (t !== DG.tok) return;
    cont.style.opacity = ''; box.hidden = false; cont.innerHTML = '<p class="dd-p-nota" style="color:#b91c1c"></p>'; cont.firstChild.textContent = 'No se pudo cargar: ' + e.message;
  });
}
function dgCargar() {
  var hoy = new Date(), desde = daISO(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), hasta = daISO(hoy), t = ++DG.tok;
  var mes = hoy.toLocaleDateString('es-CO', {month: 'long', year: 'numeric'});
  var paneles = document.querySelectorAll('#dgGraficas .dg-area'), pend = paneles.length, alguna = false;
  dgQcCargar(desde, hasta, mes, t);
  DG_REP.desde = desde; DG_REP.hasta = hasta; DG_REP.mes = mes; dgRepCargar(t);
  var selRep = document.getElementById('dgRepTeam');
  if (selRep && !selRep.dataset.listo) { selRep.dataset.listo = '1'; selRep.addEventListener('change', function() { DG_REP.team = +selRep.value; dgRepCargar(DG.tok); }); }
  var fin = function() { if (--pend === 0 && t === DG.tok) document.getElementById('dgVacio').hidden = alguna; };
  if (!pend) { document.getElementById('dgVacio').hidden = false; return; }
  paneles.forEach(function(p) {
    var body = p.querySelector('.dg-cuerpo');
    p.querySelector('.dg-mes').textContent = 'Mes en curso · ' + mes;
    ddApi('/design/api/dashboard/tendencia?desde=' + desde + '&hasta=' + hasta + '&area_id=' + p.dataset.area).then(function(d) {
      if (t !== DG.tok) return;
      if (!d.series.length) { p.hidden = true; return; }   // sin equipos (o sin casos) de esta área para esta persona
      p.hidden = false; alguna = true;
      if (DD_MOV) { p.classList.remove('dg-entra'); void p.offsetWidth; p.classList.add('dg-entra'); }
      ddDibujarTendencia(body, {d: d, ocultos: {}, chica: true, caras: true, animar: true});
    }).catch(function(e) {
      if (t !== DG.tok) return;
      p.hidden = false; body.innerHTML = '<p class="dd-p-nota" style="color:#b91c1c"></p>'; body.firstChild.textContent = 'No se pudo cargar: ' + e.message;
    }).then(fin);
  });
}
// Gráfica de casos por equipo: pasa el mouse para ver el detalle de cada día o semana; haz clic en un equipo para
// mostrar u ocultar su línea. Sábados y domingos no se cuentan (ya vienen fuera desde el servidor).
var DDT_CARA = 0;
function ddDibujarTendencia(body, st) {
  st = st || DDT;   // Filtros usa DDT; cada gráfica de Resumen trae su propio estado
  var d = st.d;
  if (!d.series.length || !d.tramos.length) {
    body.innerHTML = '<p class="dd-p-nota">No hay casos completos en este periodo.</p>'; return;
  }
  var colores = ddTColores(d.series);
  var lista = d.series.map(function(s, k) { return {s: s, c: colores[k]}; });
  var activos = lista.filter(function(x) { return !st.ocultos[x.s.nombre]; });
  // Resumen (21-oct-2026): gráficas más chicas, dos por fila; la cara del aprobador en el día de hoy y entrada animada
  var W = st.chica ? 560 : 900, H = st.chica ? 300 : 340, PL = 40, PR = st.caras ? 26 : 18, PT = st.caras ? 24 : 16, PB = 46, n = d.tramos.length;
  var animar = st.animar && DD_MOV; st.animar = false;
  var max = 1;
  activos.forEach(function(x) { x.s.valores.forEach(function(v) { if (v > max) max = v; }); });
  var techo = ddTecho(max / 4) * 4, iw = W - PL - PR, ih = H - PT - PB;   // 4 tramos de un paso «redondo»: las guías caen en enteros (21-oct-2026)
  var x = function(i) { return PL + (n <= 1 ? iw / 2 : i * iw / (n - 1)); };
  var y = function(v) { return PT + ih - v * ih / techo; };
  var anchoZona = n <= 1 ? iw : iw / (n - 1);

  var rejilla = '';
  for (var g = 0; g <= 4; g++) {
    var val = techo * g / 4, yy = y(val);
    rejilla += '<line x1="' + PL + '" x2="' + (W - PR) + '" y1="' + yy + '" y2="' + yy + '" stroke="#e2e8f0"/>' +
               '<text x="' + (PL - 8) + '" y="' + (yy + 4) + '" text-anchor="end" font-size="11" fill="#64748b">' + Math.round(val) + '</text>';
  }
  var paso = Math.max(1, Math.ceil(n / (st.chica ? 8 : 12)));
  var etiquetas = d.tramos.map(function(t, i) {
    return i % paso ? '' : '<text x="' + x(i) + '" y="' + (H - PB + 18) + '" text-anchor="middle" font-size="11" fill="#475569">' + ddEsc(t) + '</text>';
  }).join('');
  var hoy = st.caras && d.hoy != null ? d.hoy : -1, repetidos = {};
  var lineas = activos.map(function(a, k) {
    var pts = a.s.valores.map(function(v, i) { return x(i) + ',' + y(v); }).join(' ');
    var demora = 'style="--i:' + k + '"';
    return '<polyline class="dd-linea" ' + demora + ' pathLength="1" fill="none" stroke="' + a.c + '" stroke-width="2.4" stroke-linejoin="round" points="' + pts + '"/>' +
      a.s.valores.map(function(v, i) {
        if (i === hoy) return '';
        return '<circle class="dd-pto" style="--i:' + k + ';--p:' + (n <= 1 ? 0 : i / (n - 1)) + '" cx="' + x(i) + '" cy="' + y(v) + '" r="3.4" fill="#fff" stroke="' + a.c + '" stroke-width="2"/>';
      }).join('');
  }).join('');
  // Hoy: en vez del círculo, la cara del aprobador del equipo (o sus iniciales si no tiene foto). Si dos equipos van
  // igual, las caras se corren un poco para que se vean las dos.
  var caras = hoy < 0 ? '' : activos.map(function(a, k) {
    var v = a.s.valores[hoy], rep = repetidos[v] = (repetidos[v] || 0) + 1;
    var cx = x(hoy) - (rep - 1) * 14, cy = y(v), r = 12, id = 'ddCara' + (++DDT_CARA);
    var nom = a.s.aprobador || a.s.nombre;
    var ini = nom.split(/\s+/).filter(Boolean).slice(0, 2).map(function(p) { return p[0]; }).join('').toUpperCase();
    var dentro = a.s.foto
      ? '<clipPath id="' + id + '"><circle cx="' + cx + '" cy="' + cy + '" r="' + r + '"/></clipPath>' +
        '<image href="' + a.s.foto + '" x="' + (cx - r) + '" y="' + (cy - r) + '" width="' + (2 * r) + '" height="' + (2 * r) + '" preserveAspectRatio="xMidYMid slice" clip-path="url(#' + id + ')"/>'
      : '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + a.c + '"/>' +
        '<text x="' + cx + '" y="' + (cy + 4) + '" text-anchor="middle" font-size="10" font-weight="700" fill="#fff">' + ddEsc(ini) + '</text>';
    return '<g class="dd-cara" style="--i:' + k + ';transform-origin:' + cx + 'px ' + cy + 'px"><title>' + ddEsc(nom + ' · ' + a.s.nombre + ' · hoy: ' + v) + '</title>' +
      '<circle class="dd-cara-halo" cx="' + cx + '" cy="' + cy + '" r="' + (r + 3) + '" fill="none" stroke="' + a.c + '" stroke-width="2"/>' +
      dentro + '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="#fff" stroke-width="2"/></g>';
  }).reverse().join('');   // la del equipo con más casos queda encima
  var zonas = d.tramos.map(function(t, i) {
    return '<rect class="dd-zona" data-i="' + i + '" x="' + (x(i) - anchoZona / 2) + '" y="' + PT + '" width="' + anchoZona + '" height="' + ih + '" fill="transparent"/>';
  }).join('');
  var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Casos por equipo en el periodo">' +
    rejilla +
    '<line x1="' + PL + '" x2="' + (W - PR) + '" y1="' + (PT + ih) + '" y2="' + (PT + ih) + '" stroke="#94a3b8"/>' +
    etiquetas +
    '<line class="dd-guia" x1="0" x2="0" y1="' + PT + '" y2="' + (PT + ih) + '" stroke="#334155" stroke-dasharray="4 3" opacity="0"/>' +
    lineas + caras + '<g class="dd-puntos"></g>' + zonas + '</svg>';

  // Resumen (21-oct-2026): en la leyenda solo el primer nombre del equipo (sin «Eq»/«Equipo»); el nombre completo en el título
  var palabras = function(nm) { return nm.split(/\s+/).filter(function(w) { return w && !/^(eq\.?|equipo|team)$/i.test(w); }); };
  var primeros = {};
  lista.forEach(function(x) { var w = (palabras(x.s.nombre)[0] || '').toLowerCase(); primeros[w] = (primeros[w] || 0) + 1; });
  var corto = function(nm) {   // si dos equipos empiezan igual, se agrega la segunda palabra para distinguirlos
    if (!st.chica) return nm;
    var p = palabras(nm);
    if (!p.length) return nm;
    return primeros[p[0].toLowerCase()] > 1 ? p.slice(0, 2).join(' ') : p[0];
  };
  var leyenda = lista.map(function(x) {
    var oculto = !!st.ocultos[x.s.nombre];
    return '<button type="button" class="dd-leg' + (oculto ? ' off' : '') + '" data-nombre="' + ddEsc(x.s.nombre).replace(/"/g, '&quot;') + '" aria-pressed="' + (!oculto) + '" title="' + ddEsc(x.s.nombre).replace(/"/g, '&quot;') + '">' +
      '<i style="background:' + x.c + '"></i>' + ddEsc(corto(x.s.nombre)) + ' <b>' + x.s.total + '</b></button>';
  }).join('');
  var resumen = activos.reduce(function(s, a) { return s + a.s.total; }, 0);
  body.innerHTML = '<div class="dd-tend-cab"><span><b>' + resumen + '</b> casos en ' + n + ' ' + (d.tramos[0] && d.tramos[0].indexOf('Sem') === 0 ? 'semanas' : 'días laborables') + '</span>' +
    (st.chica ? '<span class="dd-p-nota">Clic en un día para ver el detalle</span>' : '<span class="dd-p-nota">Pasa el mouse para ver el detalle · clic en un equipo para mostrar u ocultar su línea</span>') + '</div>' +
    '<div class="dd-tend' + (animar ? ' dd-tend-anim' : '') + '">' + svg + '<div class="dd-tip" hidden></div></div>' +
    '<div class="dd-leyenda">' + leyenda + '</div>';

  var tip = body.querySelector('.dd-tip'), guia = body.querySelector('.dd-guia'), puntos = body.querySelector('.dd-puntos');
  var svgEl = body.querySelector('svg');
  // En Resumen el detalle de un día sale al hacer clic (no al pasar el mouse); otro clic en el mismo día o fuera lo cierra.
  // Los equipos van de mayor a menor, como se ven en la gráfica (21-oct-2026).
  var diaAbierto = -1;
  var cerrar = function() { diaAbierto = -1; guia.setAttribute('opacity', 0); puntos.innerHTML = ''; tip.hidden = true; };
  body.querySelectorAll('.dd-zona').forEach(function(z) {
    z.addEventListener(st.chica ? 'click' : 'mouseenter', function(ev) {
      var i = +z.dataset.i;
      if (st.chica) {
        ev.stopPropagation();
        if (diaAbierto === i) { cerrar(); return; }
        diaAbierto = i;
      }
      guia.setAttribute('x1', x(i)); guia.setAttribute('x2', x(i)); guia.setAttribute('opacity', 1);
      puntos.innerHTML = activos.map(function(a) { return '<circle cx="' + x(i) + '" cy="' + y(a.s.valores[i]) + '" r="6" fill="' + a.c + '" stroke="#fff" stroke-width="2"/>'; }).join('');
      var filas = activos.slice().sort(function(p, q) { return q.s.valores[i] - p.s.valores[i]; }).map(function(a) {
        return '<div class="dd-tip-f"><span><i style="background:' + a.c + '"></i>' + ddEsc(a.s.nombre) + '</span><b>' + a.s.valores[i] + '</b></div>';
      }).join('') || '<div>Sin equipos seleccionados</div>';
      tip.innerHTML = '<div class="dd-tip-t">' + ddEsc(d.tramos[i]) + '</div>' + filas;
      tip.hidden = false;
      var pct = (x(i) / W) * 100;
      tip.style.left = Math.min(Math.max(pct, 12), 70) + '%';
    });
  });
  if (st.chica) {
    if (st.fuera) document.removeEventListener('click', st.fuera);
    st.fuera = function(ev) { if (!body.isConnected) { document.removeEventListener('click', st.fuera); return; } if (!svgEl.contains(ev.target)) cerrar(); };
    document.addEventListener('click', st.fuera);
    svgEl.classList.add('dd-clic');
  } else svgEl.addEventListener('mouseleave', cerrar);
  body.querySelectorAll('.dd-leg').forEach(function(b) {
    b.addEventListener('click', function() { var nm = b.dataset.nombre; st.ocultos[nm] = !st.ocultos[nm]; ddDibujarTendencia(body, st); });
  });
}
// Filtros actuales del Dashboard (área o equipo, diseñador, producto, estado, QC y periodo Desde–Hasta)
function ddParams() {
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
  return params;
}
var DD_PARAMS = '', DD_LISTAS = {};
function ddCargar() {
  var params = new URLSearchParams();
  var area = document.getElementById('ddArea').value, team = document.getElementById('ddTeam').value;
  if (!area && !team) {
    document.getElementById('ddKpis').innerHTML = '<p class="dd-p-nota" style="padding:10px">Elige un área para ver el Dashboard.</p>';
    document.getElementById('ddTendencia').hidden = true;
    return;
  }
  if (!document.getElementById('ddDesde').value || !document.getElementById('ddHasta').value) { ddRapido('mes'); return; }
  ddCargarTendencia();
  params = ddParams();

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
    ddMostrar = {};   // datos nuevos: cada lista vuelve a mostrar sus primeras filas
    DD_ULTIMO = data;
    DD_PARAMS = params.toString(); DD_LISTAS = {};   // los casos por producto se vuelven a pedir con estos filtros
    ddPintarResultado(data);
  });
}
// M19/B10 (13-oct-2026): las tablas largas muestran 50 filas y un botón "Mostrar más" (no se dibujan todas de golpe).
var DD_TOPE = 50, ddMostrar = {};
function ddVerMas(id) { ddMostrar[id] = (ddMostrar[id] || DD_TOPE) + DD_TOPE; ddPintarResultado(DD_ULTIMO); }
function ddFilas(id, lista, fila, colspan, vacio) {
  var n = ddMostrar[id] || DD_TOPE;
  var html = lista.slice(0, n).map(fila).join('');
  if (lista.length > n) html += '<tr class="dd-mas"><td colspan="' + colspan + '"><button type="button" class="btn gris mini" onclick="ddVerMas(\'' + id + '\')">Mostrar más (' + (lista.length - n) + ' restantes)</button></td></tr>';
  return html || '<tr><td colspan="' + colspan + '" style="color:#4b5563">' + vacio + '</td></tr>';
}
function ddPintarResultado(data) {
  {
    // Título: Dashboard + el manager (si lo que se ve es de un solo manager). El aprobador siempre ve su nombre.
    var mgrs = []; data.porEquipo.forEach(function(e) { if (e.manager && mgrs.indexOf(e.manager) < 0) mgrs.push(e.manager); });
    var nombreTit = mgrs.length === 1 ? mgrs[0] : (!mgrs.length && window.DS_CFG.dashNombre) || '';
    document.getElementById('ddTitulo').textContent = 'Dashboard' + (nombreTit ? ' — ' + nombreTit : '');
    var k = data.kpis, total = data.totalCasos;
    document.getElementById('ddKpis').style.opacity = '';
    ddLlenarSelect('ddDesigner', data.opciones.disenadores, function(d) { return d.clave; }, function(d) { return d.nombre; });
    ddLlenarSelect('ddProducto', data.opciones.productos, function(p) { return p; }, function(p) { return p; });
    ddLlenarSelect('ddEstado', data.opciones.estados, function(p) { return p; }, function(p) { return p; });
    var nomSel = document.getElementById('ddDesigner'), fa = document.getElementById('ddFiltroActivo');
    var quien = nomSel.value ? nomSel.options[nomSel.selectedIndex].text : document.getElementById('ddDesignerTxt').value.trim();
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
    document.getElementById('ddProduccion').innerHTML = ddFilas('produccion', data.porDesigner, function(d) {
      return '<tr class="dd-clic' + (selClave === d.clave ? ' dd-sel' : '') + '" data-clave="' + ddEsc(d.clave).replace(/"/g, '&quot;') + '" title="Ver solo los casos de ' + ddEsc(d.nombre).replace(/"/g, '&quot;') + '">' +
        '<td class="dd-izq">' + ddEsc(d.nombre) + '</td><td>' + ddEsc(d.equipos.join(', ')) + '</td><td>' + d.casos + '</td><td>' + d.aprobadas + '</td>' +
        '<td>' + ddTiempo(d.duracionMin) + '</td><td>' + ddTiempo(d.promedioMin) + '</td><td>' + ddTiempo(d.holdMin) + '</td>' +
        '<td>' + d.conQc + '</td><td>' + d.qcHallazgos + '</td></tr>';
    }, 9, 'Sin datos.');
    document.querySelectorAll('#ddProduccion tr[data-clave]').forEach(function(tr) {
      tr.onclick = function() { var s = document.getElementById('ddDesigner'); s.value = s.value === tr.dataset.clave ? '' : tr.dataset.clave; document.getElementById('ddDesignerTxt').value = ''; ddCargar(); };
    });

    ddRenderProductos();

    document.getElementById('ddEquipos').innerHTML = ddFilas('equipos', data.porEquipo, function(e) {
      return '<tr><td class="dd-izq">' + ddEsc(e.equipo) + '</td><td>' + ddEsc(e.area) + '</td><td>' + e.casos + '</td><td>' + e.aprobadas + '</td><td>' + ddTiempo(e.promedioMin) + '</td><td>' + e.qcHallazgos + '</td></tr>';
    }, 6, 'Sin datos.');

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

    ddPintarQc();

    document.getElementById('ddSinQc').innerHTML = ddFilas('sinQc', data.sinQc, function(r) {
      return '<tr><td>' + ddEsc(r.orden) + '</td><td>' + ddEsc(r.paciente) + '</td><td>' + r.fecha + '</td><td>' + ddEsc(r.equipo) + '</td><td>' + ddEsc(r.producto) + '</td>' +
             '<td>' + ddEsc(r.estado) + '</td><td>' + ddEsc(r.designerNombre) + '</td></tr>';
    }, 7, 'Sin datos.');
  }
}

// Admins: borrar hallazgos de QC (uno o todos los que muestra el filtro). El QC sigue marcado y la orden queda
// "Sin hallazgos"; las Notas no cambian. Se puede deshacer desde el aviso.
var DD_ADMIN = DD_PROPIOS === null;
// ---------- Reportes de QC: filtro en el encabezado «Hallazgo de QC» (Rosember, 26-oct-2026) ----------
// ▾ ordena A → Z / Z → A y deja elegir qué hallazgos ver (cada reporte se parte en sus hallazgos: «Título › hallazgo»).
// La tabla, «Borrar los hallazgos filtrados» y la exportación usan solo lo que queda visible.
var DD_QC_FIL = {orden: 0, sel: null, q: ''};   // sel: null = todos; si no, {hallazgo: true}
function ddQcHallazgos(texto) {
  var out = [];
  String(texto || '').split('\n').forEach(function(linea) {
    linea = linea.trim(); if (!linea) return;
    var k = linea.indexOf(': '), tit = k > 0 ? linea.slice(0, k).trim() : '', cuerpo = k > 0 ? linea.slice(k + 2) : linea;
    cuerpo.split('; ').forEach(function(seg) { seg = seg.trim(); if (seg) out.push(tit ? tit + ' › ' + seg : seg); });
  });
  return out;
}
function ddQcFiltrados() {
  var lista = DD_ULTIMO ? DD_ULTIMO.qcReportes.slice() : [], f = DD_QC_FIL;
  if (f.sel) lista = lista.filter(function(r) { return ddQcHallazgos(r.qcReporte).some(function(h) { return f.sel[h]; }); });
  if (f.orden) lista.sort(function(a, b) { return f.orden * String(a.qcReporte || '').localeCompare(String(b.qcReporte || ''), 'es', {sensitivity: 'base'}); });
  return lista;
}
function ddPintarQc() {
  var lista = ddQcFiltrados(), activo = !!(DD_QC_FIL.sel || DD_QC_FIL.orden);
  document.getElementById('ddQcReportes').innerHTML = ddFilas('qcReportes', lista, function(r) {
    return '<tr><td>' + ddEsc(r.orden) + '</td><td>' + ddEsc(r.paciente) + '</td><td>' + r.fecha + '</td><td>' + ddEsc(r.equipo) + '</td><td>' + ddEsc(r.producto) + '</td>' +
           '<td>' + ddEsc(r.designerNombre) + '</td><td class="dd-izq" style="white-space:pre-wrap" data-qc-texto="' + r.ordenId + '">' + ddEsc(r.qcReporte) + '</td>' +
           (DD_ADMIN ? '<td style="white-space:nowrap"><button type="button" class="btn gris mini" title="Corregir el texto del hallazgo" onclick="ddQcEditar(' + r.ordenId + ')">Editar</button> ' +
                       '<button type="button" class="btn rojo mini" title="Borrar este hallazgo (el QC sigue marcado, queda sin hallazgos)" onclick="ddQcBorrar([' + r.ordenId + '])">Borrar</button></td>' : '') + '</tr>';
  }, 8, DD_QC_FIL.sel ? 'Ningún reporte tiene los hallazgos elegidos.' : 'Sin hallazgos de QC.');
  var bt = document.getElementById('ddQcBorrarTodo');
  if (bt) { bt.style.display = lista.length > 1 ? '' : 'none'; bt.textContent = 'Borrar los ' + lista.length + ' hallazgos filtrados'; }
  var fb = document.getElementById('ddQcFiltroBtn');
  if (fb) { fb.classList.toggle('on', activo); fb.textContent = DD_QC_FIL.sel ? '▾ ' + Object.keys(DD_QC_FIL.sel).length : '▾'; }
}
function ddQcCerrarFiltro() {
  var m = document.getElementById('ddQcFil'); if (m) m.remove();
  document.removeEventListener('mousedown', ddQcFueraFiltro, true); document.removeEventListener('keydown', ddQcTeclaFiltro, true);
}
function ddQcFueraFiltro(e) { var m = document.getElementById('ddQcFil'); if (m && !m.contains(e.target) && e.target.id !== 'ddQcFiltroBtn') ddQcCerrarFiltro(); }
function ddQcTeclaFiltro(e) { if (e.key === 'Escape') { e.preventDefault(); ddQcCerrarFiltro(); } }
function ddQcAbrirFiltro(btn) {
  if (document.getElementById('ddQcFil')) { ddQcCerrarFiltro(); return; }
  var cuenta = {};
  (DD_ULTIMO ? DD_ULTIMO.qcReportes : []).forEach(function(r) {
    var vistos = {};
    ddQcHallazgos(r.qcReporte).forEach(function(h) { if (!vistos[h]) { vistos[h] = 1; cuenta[h] = (cuenta[h] || 0) + 1; } });
  });
  var valores = Object.keys(cuenta).sort(function(a, b) { return a.localeCompare(b, 'es', {sensitivity: 'base'}); });
  var norm = function(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); };
  var m = document.createElement('div'); m.id = 'ddQcFil'; m.className = 'dd-fil-pop'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-label', 'Filtrar los reportes de QC');
  m.innerHTML = '<button type="button" data-o="1">↑ Ordenar A → Z</button><button type="button" data-o="-1">↓ Ordenar Z → A</button>' +
    (DD_QC_FIL.orden ? '<button type="button" data-o="0">✕ Quitar orden</button>' : '') + '<hr>' +
    '<input type="search" placeholder="Buscar hallazgo…" aria-label="Buscar hallazgo">' +
    '<label class="dd-fil-todos"><input type="checkbox" data-todos> (Seleccionar todos)</label><div class="dd-fil-lista"></div>' +
    '<div class="dd-fil-pie"><button type="button" class="btn gris mini" data-acc="limpiar">Quitar filtro</button><button type="button" class="btn mini" data-acc="listo">Listo</button></div>';
  document.body.appendChild(m);
  var r = btn.getBoundingClientRect();
  m.style.top = (r.bottom + window.scrollY + 4) + 'px';
  m.style.left = Math.max(8, Math.min(window.innerWidth - m.offsetWidth - 8, r.right - m.offsetWidth)) + window.scrollX + 'px';
  var buscar = m.querySelector('input[type="search"]'), todos = m.querySelector('[data-todos]'), cont = m.querySelector('.dd-fil-lista');
  var marcado = function(h) { return !DD_QC_FIL.sel || !!DD_QC_FIL.sel[h]; };
  var pintar = function() {
    var q = norm(buscar.value), vis = valores.filter(function(h) { return !q || norm(h).indexOf(q) >= 0; });
    cont.innerHTML = vis.length ? vis.map(function(h) {
      return '<label><input type="checkbox" value="' + ddEsc(h) + '"' + (marcado(h) ? ' checked' : '') + '> <span>' + ddEsc(h) + '</span> <small>' + cuenta[h] + '</small></label>';
    }).join('') : '<p class="dd-fil-vacio">' + (valores.length ? 'Ningún hallazgo coincide.' : 'No hay reportes con este filtro.') + '</p>';
    todos.checked = vis.length > 0 && vis.every(marcado);
  };
  var aplicar = function(sel) {   // sel con todos los valores = sin filtro
    DD_QC_FIL.sel = sel && Object.keys(sel).length < valores.length ? sel : null;
    if (sel && !Object.keys(sel).length) DD_QC_FIL.sel = {};   // nada marcado: no se ve ninguno
    ddMostrar.qcReportes = 0; ddPintarQc();
  };
  var actuales = function() { var s = {}; valores.forEach(function(h) { if (marcado(h)) s[h] = true; }); return s; };
  m.addEventListener('change', function(e) {
    var s = actuales(), q = norm(buscar.value);
    if (e.target.hasAttribute('data-todos')) valores.forEach(function(h) { if (!q || norm(h).indexOf(q) >= 0) { if (e.target.checked) s[h] = true; else delete s[h]; } });
    else if (e.target.checked) s[e.target.value] = true; else delete s[e.target.value];
    aplicar(s); pintar();
  });
  m.addEventListener('click', function(e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.o != null) { DD_QC_FIL.orden = parseInt(b.dataset.o, 10); ddPintarQc(); ddQcCerrarFiltro(); return; }
    if (b.dataset.acc === 'limpiar') { DD_QC_FIL.sel = null; DD_QC_FIL.orden = 0; ddMostrar.qcReportes = 0; ddPintarQc(); }
    ddQcCerrarFiltro();
  });
  buscar.addEventListener('input', pintar);
  pintar(); buscar.focus();
  document.addEventListener('mousedown', ddQcFueraFiltro, true); document.addEventListener('keydown', ddQcTeclaFiltro, true);
}
function ddQcBorrar(ids) {
  var lista = ids || ddQcFiltrados().map(function(r) { return r.ordenId; });
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
// Admins: corregir el texto de un hallazgo de QC ahí mismo (Rosember, 21-oct-2026). Se guarda en la orden y se puede deshacer.
function ddQcEditar(ordenId) {
  var r = DD_ULTIMO && DD_ULTIMO.qcReportes.find(function(x) { return x.ordenId === ordenId; });
  var td = document.querySelector('[data-qc-texto="' + ordenId + '"]');
  if (!r || !td || td.querySelector('textarea')) return;
  td.innerHTML = '<textarea rows="4" style="width:100%;min-width:260px;font:inherit;padding:6px;box-sizing:border-box"></textarea>' +
    '<div style="margin-top:4px;display:flex;gap:6px"><button type="button" class="btn mini">Guardar</button><button type="button" class="btn gris mini">Cancelar</button></div>';
  var ta = td.querySelector('textarea'), bs = td.querySelectorAll('button');
  ta.value = r.qcReporte || '';
  ta.focus();
  var cancelar = function() { td.textContent = r.qcReporte || ''; };
  var guardar = function() {
    var nuevo = ta.value.trim();
    if (nuevo === (r.qcReporte || '').trim()) { cancelar(); return; }
    bs[0].disabled = true;
    window.dsPostJSON('/design/api/dashboard/qc-hallazgos/editar', {id: ordenId, texto: nuevo}).then(function(d) {
      r.qcReporte = d.texto;
      td.textContent = d.texto;
      var restaurar = {}; restaurar[ordenId] = d.antes;
      ddAvisoDeshacer('Hallazgo de QC de la orden ' + r.orden + ' corregido.', function() {
        window.dsPostJSON('/design/api/dashboard/qc-hallazgos/borrar', {ids: [], restaurar: restaurar}).then(function() { ddCargar(); dsToast('Se volvió al texto anterior.'); })
          .catch(function(e) { alert('No se pudo deshacer: ' + e.message); });
      });
    }).catch(function(e) { bs[0].disabled = false; alert('No se pudo guardar: ' + e.message); });
  };
  bs[0].onclick = guardar;
  bs[1].onclick = cancelar;
  ta.addEventListener('keydown', function(ev) {
    if (ev.key === 'Escape') cancelar();
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) guardar();
  });
}
function ddAvisoDeshacer(texto, deshacer) {
  var v = document.getElementById('ddAviso'); if (v) v.remove();
  v = document.createElement('div'); v.id = 'ddAviso'; v.className = 'ds-toast'; v.style.display = '';
  v.innerHTML = '<span></span> <button type="button" style="margin-left:10px;background:#fff;color:#111827;border:none;border-radius:5px;padding:3px 10px;cursor:pointer;font-weight:600">Deshacer</button>';
  v.querySelector('span').textContent = texto;
  v.querySelector('button').onclick = function() { v.remove(); deshacer(); };
  document.body.appendChild(v);
  setTimeout(function() { if (v.isConnected) v.remove(); }, 12000);
}

// Descarga lo que se ve (con los filtros actuales) en un archivo que abre Excel (CSV con separador ;).
function ddDescargar() {
  var d = DD_ULTIMO; if (!d) return;
  if (!d.listasCompletas) {   // los casos por producto no vienen con el Dashboard: se traen todos para el archivo
    var clave = DD_PARAMS;
    ddApi('/design/api/dashboard/producto-casos?' + clave + '&todos=1').then(function(r) {
      if (clave !== DD_PARAMS || d !== DD_ULTIMO) return;
      d.porProducto.forEach(function(p) { p.lista = (r.productos || {})[p.producto || ''] || []; DD_LISTAS[p.producto] = p.lista; });
      d.listasCompletas = true; ddDescargar();
    }).catch(function(e) { alert('No se pudo preparar la descarga: ' + e.message); });
    return;
  }
  var c = function(v) { v = v == null ? '' : String(v); return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  var h = function(m) { return m ? (m / 60).toFixed(2).replace('.', ',') : ''; };
  var filas = [['Dashboard Design', 'Desde', document.getElementById('ddDesde').value || 'inicio', 'Hasta', document.getElementById('ddHasta').value || 'hoy'], [],
    ['PRODUCCIÓN POR DISEÑADOR'], ['Diseñador', 'Equipo', 'Casos', 'Aprobadas', 'Canceladas/Skipped', 'Horas totales', 'Promedio por caso (min)', 'Horas en Hold', 'Con QC', 'QC con hallazgos']];
  d.porDesigner.forEach(function(x) { filas.push([x.nombre, x.equipos.join(', '), x.casos, x.aprobadas, x.canceladas, h(x.duracionMin), String(x.promedioMin).replace('.', ','), h(x.holdMin), x.conQc, x.qcHallazgos]); });
  filas.push([], ['POR EQUIPO'], ['Equipo', 'Área', 'Casos', 'Aprobadas', 'Promedio por caso (min)', 'QC con hallazgos']);
  d.porEquipo.forEach(function(x) { filas.push([x.equipo, x.area, x.casos, x.aprobadas, String(x.promedioMin).replace('.', ','), x.qcHallazgos]); });
  filas.push([], ['PRODUCTOS'], ['Producto', 'Casos', 'Promedio por caso (min)']);
  d.porProducto.forEach(function(x) { filas.push([x.producto, x.casos, String(x.promedioMin).replace('.', ',')]); });
  filas.push([], ['CASOS POR PRODUCTO'], ['Producto', 'Tiempo del producto (min)', 'Orden', 'Paciente', 'Fecha', 'Equipo', 'Diseñador', 'Estado', 'Tiempo de diseño (min)', 'Resultado']);
  d.porProducto.forEach(function(p) {
    var o = ddParseObjetivo(DD_OBJETIVOS[p.producto]);
    (p.lista || []).forEach(function(x) { var r = ddCumple(x, o); filas.push([p.producto, o === null ? '' : String(o).replace('.', ','), x.orden, x.paciente, x.fecha, x.equipo, x.designerNombre, x.estado, x.duracionMin ? String(x.duracionMin).replace('.', ',') : '', r === null ? '' : r ? 'Cumplió' : 'No cumplió']); });
  });
  filas.push([], ['REPORTES DE QC'], ['Orden', 'Paciente', 'Fecha', 'Equipo', 'Producto', 'Diseñador', 'Hallazgo de QC']);
  ddQcFiltrados().forEach(function(x) { filas.push([x.orden, x.paciente, x.fecha, x.equipo, x.producto, x.designerNombre, x.qcReporte]); });   // lo que deja ver el filtro ▾
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

// ---------- Dashboard › Productos: órdenes de cada producto por mes (pedido por Rosember el 12-oct-2026) ----------
var DP = {datos: null, orden: 'total', dir: -1, tok: 0};
var DP_MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
var DP_MESES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function dpNorm(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
function dpVista(v) {
  document.querySelectorAll('.dd-vista').forEach(function(b) { var on = b.dataset.dv === v; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  document.getElementById('ddVistaGeneral').hidden = v !== 'general';
  document.getElementById('ddVistaResumen').hidden = v !== 'resumen';
  document.getElementById('ddVistaProductos').hidden = v !== 'productos';
  document.getElementById('ddVistaArticulacion').hidden = v !== 'articulacion';
  document.getElementById('ddVistaCambios').hidden = v !== 'cambios';
  var vl = document.getElementById('ddVistaLentas'); if (vl) { vl.hidden = v !== 'lentas'; if (v === 'lentas') dlIniciar(); }
  var vy = document.getElementById('ddVistaAyudas'); if (vy) { vy.hidden = v !== 'ayudas'; if (v === 'ayudas' && window.dyIniciar) window.dyIniciar(); }
  var vr = document.getElementById('ddVistaReportes'); if (vr) { vr.hidden = v !== 'reportes'; if (v === 'reportes' && window.drIniciar) window.drIniciar(); }
  if (v === 'cambios') { var pc = document.getElementById('dcPlegable'); if (pc) pc.open = false; dcSemestreInicial(); dcCargar(true); }   // la tabla abre cerrada
  if (v === 'productos') dpCargar();
  if (v === 'articulacion') daAbrir();
  if (v === 'general') dgCargar();
  if (v === 'resumen' && !ddCargar.listo) ddAbrirFiltros();   // Filtros se arma la primera vez que se abre
}
function dpCargar() {
  var hoy = new Date(), anioSel = document.getElementById('dpAnio'), mesSel = document.getElementById('dpMes');
  if (!mesSel.options.length) { mesSel.innerHTML = DP_MESES_L.map(function(m, i) { return '<option value="' + i + '">' + m.charAt(0).toUpperCase() + m.slice(1) + '</option>'; }).join(''); mesSel.value = hoy.getMonth(); }
  var anio = anioSel.value || hoy.getFullYear(), area = document.getElementById('dpArea').value, team = document.getElementById('dpTeam').value;
  var u = '/design/api/dashboard/productos?anio=' + anio + (team ? '&team_id=' + team : area ? '&area_id=' + area : ''), t = ++DP.tok;
  document.getElementById('dpTabla').style.opacity = '.5';
  if (DD_MOV) document.getElementById('dpTop').style.opacity = '0';   // sin «flash» de las barras viejas antes de animar las nuevas
  ddApi(u).then(function(d) {
    if (t !== DP.tok) return;
    document.getElementById('dpTop').style.opacity = '';
    DP.datos = d; DP.animar = true;
    var actual = String(d.anio);
    anioSel.innerHTML = d.anios.map(function(a) { return '<option' + (String(a) === actual ? ' selected' : '') + '>' + a + '</option>'; }).join('');
    dpPintar();
  }).catch(function(e) { document.getElementById('dpTabla').innerHTML = '<tbody><tr><td>No se pudo cargar: ' + ddEsc(e.message) + '</td></tr></tbody>'; })
    .then(function() { document.getElementById('dpTabla').style.opacity = ''; if (t === DP.tok) document.getElementById('dpTop').style.opacity = ''; });
}
function dpFiltrados() {
  var q = dpNorm(document.getElementById('dpBuscar').value.trim());
  var lista = (DP.datos ? DP.datos.productos : []).filter(function(p) { return !q || dpNorm(p.producto).indexOf(q) >= 0; });
  var k = DP.orden, dir = DP.dir;
  return lista.slice().sort(function(a, b) {
    var va = k === 'producto' ? a.producto.toLowerCase() : k === 'total' ? a.total : a.meses[+k], vb = k === 'producto' ? b.producto.toLowerCase() : k === 'total' ? b.total : b.meses[+k];
    return (va < vb ? -1 : va > vb ? 1 : 0) * dir || b.total - a.total;
  });
}
function dpPintar() {
  if (!DP.datos) return;
  var filas = dpFiltrados(), mes = +document.getElementById('dpMes').value, q = document.getElementById('dpBuscar').value.trim();
  var tot = DP_MESES.map(function(m, i) { return filas.reduce(function(s, p) { return s + p.meses[i]; }, 0); }), total = tot.reduce(function(a, b) { return a + b; }, 0);
  var conMes = filas.filter(function(p) { return p.meses[mes]; });
  document.getElementById('dpKpis').innerHTML =
    '<div class="dd-kpi"><b>' + tot[mes] + '</b>órdenes en ' + DP_MESES_L[mes] + (q ? ' · "' + ddEsc(q) + '"' : '') + '</div>' +
    '<div class="dd-kpi"><b>' + total + '</b>órdenes en ' + DP.datos.anio + '</div>' +
    '<div class="dd-kpi"><b>' + conMes.length + '</b>productos con órdenes en ' + DP_MESES_L[mes] + '</div>' +
    '<div class="dd-kpi"><b>' + ddEsc(conMes.length ? conMes.slice().sort(function(a, b) { return b.meses[mes] - a.meses[mes]; })[0].producto : '—') + '</b>el más pedido en ' + DP_MESES_L[mes] + '</div>';
  // los productos del mes, en barras
  document.getElementById('dpTopTit').textContent = 'Productos de ' + DP_MESES_L[mes] + ' ' + DP.datos.anio;
  var top = conMes.slice().sort(function(a, b) { return b.meses[mes] - a.meses[mes]; }), max = top.length ? top[0].meses[mes] : 1;
  document.getElementById('dpTop').classList.remove('dd-anim');   // redibujar (p. ej. al buscar) no vuelve a animar; ddAnimar la enciende
  document.getElementById('dpTop').innerHTML = top.length ? top.slice(0, 15).map(function(p) {
    return '<div class="dp-barra"><span class="n" title="' + ddEsc(p.producto) + '">' + ddEsc(p.producto) + '</span><span class="b"><i style="width:' + Math.max(2, p.meses[mes] * 100 / max) + '%"></i></span><b>' + p.meses[mes] + '</b></div>';
  }).join('') + (top.length > 15 ? '<div class="dp-mas">y ' + (top.length - 15) + ' productos más en la tabla</div>' : '')
    : '<p style="color:#4b5563;font-size:13px;margin:6px 0">No hay órdenes en ' + DP_MESES_L[mes] + (q ? ' con "' + ddEsc(q) + '"' : '') + '.</p>';
  if (DP.animar) { DP.animar = false; ddAnimar(document.getElementById('dpTop'), document.getElementById('dpKpis')); }
  // tabla producto × mes
  var flecha = function(k) { return DP.orden === k ? (DP.dir === 1 ? ' ▲' : ' ▼') : ''; };
  var h = '<thead><tr><th class="dd-izq" data-o="producto">Producto' + flecha('producto') + '</th>' +
    DP_MESES.map(function(m, i) { return '<th data-o="' + i + '"' + (i === mes ? ' class="dp-mes-on"' : '') + '>' + m + flecha(String(i)) + '</th>'; }).join('') +
    '<th data-o="total">Total' + flecha('total') + '</th></tr></thead><tbody>';
  h += filas.length ? filas.map(function(p) {
    return '<tr><td class="dd-izq"><b>' + ddEsc(p.producto) + '</b><div class="dp-areas">' + ddEsc(p.areas.join(' · ')) + '</div></td>' +
      p.meses.map(function(n, i) { return '<td' + (i === mes ? ' class="dp-mes-on"' : '') + '>' + (n || '<span class="dp-cero">·</span>') + '</td>'; }).join('') + '<td><b>' + p.total + '</b></td></tr>';
  }).join('') : '<tr><td colspan="14" style="color:#4b5563">No hay productos con ese nombre en ' + DP.datos.anio + '.</td></tr>';
  h += '</tbody><tfoot><tr><th class="dd-izq">Total' + (q ? ' "' + ddEsc(q) + '"' : '') + '</th>' + tot.map(function(n, i) { return '<th' + (i === mes ? ' class="dp-mes-on"' : '') + '>' + n + '</th>'; }).join('') + '<th>' + total + '</th></tr></tfoot>';
  var tb = document.getElementById('dpTabla'); tb.innerHTML = h;
  tb.querySelectorAll('thead th[data-o]').forEach(function(th) {
    th.style.cursor = 'pointer';
    th.onclick = function() { var k = th.dataset.o; DP.dir = DP.orden === k ? -DP.dir : (k === 'producto' ? 1 : -1); DP.orden = k; dpPintar(); };
  });
}
function dpDescargar() {
  if (!DP.datos) return;
  var filas = dpFiltrados(), sep = ';', q = function(v) { return '"' + String(v).replace(/"/g, '""') + '"'; };
  var csv = [['Producto', 'Áreas'].concat(DP_MESES_L, ['Total']).map(q).join(sep)].concat(filas.map(function(p) {
    return [q(p.producto), q(p.areas.join(', '))].concat(p.meses, [p.total]).join(sep);
  }));
  var b = new Blob(['\ufeff' + csv.join('\r\n')], {type: 'text/csv;charset=utf-8'}), a = document.createElement('a');
  a.href = URL.createObjectURL(b); a.download = 'Productos por mes ' + DP.datos.anio + '.csv'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function() { URL.revokeObjectURL(a.href); }, 2000);
}
(function() {
  var el = function(id) { return document.getElementById(id); };
  if (!el('ddVistaProductos')) return;
  document.querySelectorAll('.dd-vista').forEach(function(b) { b.addEventListener('click', function() { dpVista(b.dataset.dv); }); });
  el('dpArea').addEventListener('change', function() {
    var sel = el('dpTeam'), areaId = el('dpArea').value; sel.innerHTML = '<option value="">-- Todos --</option>';
    if (!areaId) { dpCargar(); return; }
    ddApi('/design/api/teams?area_id=' + areaId).then(function(teams) {
      teams.filter(function(t) { return !DD_PROPIOS || DD_PROPIOS.indexOf(t.id) >= 0; })
           .forEach(function(t) { var o = document.createElement('option'); o.value = t.id; o.text = t.nombre; sel.appendChild(o); });
    }).then(dpCargar);
  });
  el('dpTeam').addEventListener('change', dpCargar);
  el('dpAnio').addEventListener('change', dpCargar);
  el('dpMes').addEventListener('change', function() { DP.animar = true; dpPintar(); });
  var tb = null; el('dpBuscar').addEventListener('input', function() { clearTimeout(tb); tb = setTimeout(dpPintar, 200); });
  el('dpDescargar').addEventListener('click', dpDescargar);
})();

// ---------- Dashboard › Articulación: casos de N3 › Cirugías que pasan de 2 h entre START y RTD (pedido por Rosember el 13-oct-2026) ----------
var DA = {datos: null, orden: 'pasadas', dir: -1, tok: 0, tope: 50, animar: false};
// Movimiento en las gráficas de Productos y Articulación (Rosember, 21-oct-2026): las barras crecen en cascada, las filas
// entran deslizándose y los números de arriba cuentan hasta su valor. Solo al cargar datos o cambiar el mes (no al escribir
// en el buscador). Quien pide menos movimiento en su sistema no lo ve.
var DD_MOV = !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
function ddAnimar(cont, kpis) {
  if (!DD_MOV) return;
  if (cont) {
    cont.querySelectorAll('.dp-barra, .da-barra').forEach(function(r, i) { r.style.setProperty('--i', Math.min(i, 20)); });
    cont.classList.remove('dd-anim'); void cont.offsetWidth; cont.classList.add('dd-anim');
  }
  if (kpis) kpis.querySelectorAll('.dd-kpi b').forEach(function(b) {
    var m = /^(\d+)(%?)$/.exec(b.textContent.trim()), fin = m ? +m[1] : 0;
    if (!fin) return;
    var t0 = performance.now(), dur = 800;
    (function paso(t) {
      var p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      b.textContent = Math.round(fin * e) + m[2];
      if (p < 1) requestAnimationFrame(paso);
    })(t0);
  });
}
var DA_TOPE = 50;   // casos que se muestran de a poco («Mostrar más»), para que la página no se ponga pesada
// Cada vez que se entra a la pestaña: el mes en curso y las tablas cerradas (Rosember, 21-oct-2026)
function daAbrir() {
  var hoy = new Date();
  document.getElementById('daDesde').value = daISO(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
  document.getElementById('daHasta').value = daISO(hoy);
  ['daPlegCentros', 'daPlegCasos'].forEach(function(id) { var d = document.getElementById(id); if (d) d.open = false; });
  var sel = document.getElementById('daTeam');
  if (sel.options.length <= 1 && document.getElementById('daArea').value) { daEquipos().then(daCargar); return; }
  daCargar();
}
function daEquipos() {
  var sel = document.getElementById('daTeam'), areaId = document.getElementById('daArea').value; sel.innerHTML = '<option value="">-- Todos --</option>';
  if (!areaId) return Promise.resolve();
  return ddApi('/design/api/teams?area_id=' + areaId).then(function(teams) {
    teams.filter(function(t) { return !DD_PROPIOS || DD_PROPIOS.indexOf(t.id) >= 0; })
         .forEach(function(t) { var o = document.createElement('option'); o.value = t.id; o.text = t.nombre; sel.appendChild(o); });
  });
}
function daFmt(m) { return m === null || m === undefined ? '' : Math.floor(m / 60) + 'h ' + (m % 60) + 'm'; }
function daISO(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function daCargar() {
  var hoy = new Date(), ds = document.getElementById('daDesde'), hs = document.getElementById('daHasta');
  if (!ds.value) ds.value = daISO(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
  if (!hs.value) hs.value = daISO(hoy);
  var area = document.getElementById('daArea').value, team = document.getElementById('daTeam').value, t = ++DA.tok;
  var u = '/design/api/dashboard/articulacion?desde=' + ds.value + '&hasta=' + hs.value + (team ? '&team_id=' + team : area ? '&area_id=' + area : '');
  document.getElementById('daCentros').style.opacity = '.5';
  if (DD_MOV) document.getElementById('daTop').style.opacity = '0';   // sin «flash» de las barras viejas antes de animar las nuevas
  ddApi(u).then(function(d) { if (t !== DA.tok) return; document.getElementById('daTop').style.opacity = ''; DA.datos = d; DA.tope = DA_TOPE; DA.animar = true; daPintar(); })
    .catch(function(e) { document.getElementById('daCentros').innerHTML = '<tbody><tr><td>No se pudo cargar: ' + ddEsc(e.message) + '</td></tr></tbody>'; })
    .then(function() { document.getElementById('daCentros').style.opacity = ''; if (t === DA.tok) document.getElementById('daTop').style.opacity = ''; });
}
function daFiltrar() {
  var q = dpNorm(document.getElementById('daBuscar').value.trim()), d = DA.datos;
  if (!d) return {centros: [], casos: []};
  var cs = d.centros.filter(function(c) { return !q || dpNorm(c.centro).indexOf(q) >= 0; });
  var k = DA.orden, dir = DA.dir;
  cs = cs.slice().sort(function(a, b) {
    var va = k === 'centro' ? a.centro.toLowerCase() : a[k], vb = k === 'centro' ? b.centro.toLowerCase() : b[k];
    return (va < vb ? -1 : va > vb ? 1 : 0) * dir || b.pasadas - a.pasadas || a.centro.localeCompare(b.centro);
  });
  return {centros: cs, casos: d.casos.filter(function(c) { return !q || dpNorm(c.centro).indexOf(q) >= 0; })};
}
function daPintar() {
  if (!DA.datos) return;
  var f = daFiltrar(), d = DA.datos, q = document.getElementById('daBuscar').value.trim();
  var med = f.centros.reduce(function(s, c) { return s + c.casos; }, 0), pas = f.centros.reduce(function(s, c) { return s + c.pasadas; }, 0);
  var prom = med ? Math.round(f.centros.reduce(function(s, c) { return s + c.promedio * c.casos; }, 0) / med) : 0;
  document.getElementById('daKpis').innerHTML =
    '<div class="dd-kpi"><b>' + med + '</b>casos medidos' + (q ? ' · "' + ddEsc(q) + '"' : '') + '</div>' +
    '<div class="dd-kpi"><b>' + pas + '</b>pasaron de ' + (d.limiteMin / 60) + ' horas</div>' +
    '<div class="dd-kpi"><b>' + (med ? Math.round(pas * 100 / med) : 0) + '%</b>de los casos medidos</div>' +
    '<div class="dd-kpi"><b>' + (med ? daFmt(prom) : '—') + '</b>tiempo promedio de articulación</div>';
  var animar = DA.animar; DA.animar = false;
  var top = f.centros.filter(function(c) { return c.casos && c.promedio; }).slice().sort(function(x, y) { return y.promedio - x.promedio; }).slice(0, 15);
  var topMax = top.length ? top[0].promedio : 1;
  document.getElementById('daTop').classList.remove('dd-anim');   // redibujar (p. ej. al buscar) no vuelve a animar; ddAnimar la enciende
  document.getElementById('daTop').innerHTML = top.length ? top.map(function(c) {
    return '<div class="da-barra" title="' + ddEsc(c.centro) + ': promedio ' + daFmt(c.promedio) + ', el más largo ' + daFmt(c.max) + '"><span class="n">' + ddEsc(c.centro) + '</span>' +
      '<span class="b"><i style="width:' + Math.max(2, c.promedio * 100 / topMax) + '%"></i></span>' +
      '<b>' + daFmt(c.promedio) + ' <small>· ' + c.casos + ' casos</small></b></div>';
  }).join('') : '<p class="dd-p-nota">No hay casos con START y RTD en este periodo.</p>';
  if (animar) ddAnimar(document.getElementById('daTop'), document.getElementById('daKpis'));
  var flecha = function(k) { return DA.orden === k ? (DA.dir === 1 ? ' ▲' : ' ▼') : ''; };
  var th = function(k, t, izq) { return '<th' + (izq ? ' class="dd-izq"' : '') + ' data-o="' + k + '">' + t + flecha(k) + '</th>'; };
  var conPasadas = f.centros.filter(function(c) { return c.pasadas > 0; });   // la tabla solo muestra los que pasaron de 2 h
  document.getElementById('daCentrosSub').textContent = conPasadas.length + ' centro' + (conPasadas.length === 1 ? '' : 's') + ' · de más a menos casos pasados · clic en un título para ordenar';
  var h = '<thead><tr>' + th('centro', 'Centro') + th('casos', 'Casos medidos') + th('pasadas', 'Pasaron de 2 h') + th('pct', '% que pasó') + th('promedio', 'Promedio') + th('max', 'El más largo') + '</tr></thead><tbody>';
  h += conPasadas.length ? conPasadas.map(function(c) {
    return '<tr><td><b>' + ddEsc(c.centro) + '</b></td><td>' + c.casos + '</td><td>' + (c.pasadas ? '<b style="color:#b91c1c">' + c.pasadas + '</b>' : '<span class="dp-cero">·</span>') +
      '</td><td>' + c.pct + '%</td><td>' + daFmt(c.promedio) + '</td><td>' + daFmt(c.max) + '</td></tr>';
  }).join('') : '<tr><td colspan="6" style="color:#4b5563">Ningún centro pasó de 2 horas en este rango' + (q ? ' para "' + ddEsc(q) + '"' : '') + '.</td></tr>';
  var tb = document.getElementById('daCentros'); tb.innerHTML = h + '</tbody>';
  tb.querySelectorAll('thead th[data-o]').forEach(function(x) {
    x.style.cursor = 'pointer';
    x.onclick = function() { var k = x.dataset.o; DA.dir = DA.orden === k ? -DA.dir : (k === 'centro' ? 1 : -1); DA.orden = k; daPintar(); };
  });
  document.getElementById('daCasosSub').textContent = f.casos.length + ' caso' + (f.casos.length === 1 ? '' : 's') + ' · de más a menos tiempo';
  document.getElementById('daCasos').innerHTML = '<thead><tr><th>Fecha</th><th>Orden</th><th>Paciente</th><th>Centro</th><th>Equipo</th><th>Diseñador</th><th>START</th><th>RTD</th><th>Tiempo</th></tr></thead><tbody>' +
    (f.casos.length ? f.casos.slice(0, DA.tope).map(function(c) {
      return '<tr><td>' + ddEsc(c.fecha) + '</td><td>' + ddEsc(c.orden) + '</td><td>' + ddEsc(c.paciente) + '</td><td>' + ddEsc(c.centro) + '</td><td>' + ddEsc(c.equipo) +
        '</td><td>' + ddEsc(c.designer) + '</td><td>' + ddEsc(c.start) + '</td><td>' + ddEsc(c.rtd) + '</td><td><b>' + daFmt(c.min) + '</b></td></tr>';
    }).join('') : '<tr><td colspan="9" style="color:#4b5563">Ningún caso pasó de 2 horas en este rango.</td></tr>') + '</tbody>';
  var resto = f.casos.length - Math.min(DA.tope, f.casos.length), mas = document.getElementById('daCasosMas');
  mas.innerHTML = resto > 0 ? '<button type="button" class="btn gris mini" id="daVerMas">Mostrar más (' + resto + ' restantes)</button>' : '';
  var vm = document.getElementById('daVerMas'); if (vm) vm.onclick = function() { DA.tope += DA_TOPE; daPintar(); };
}
function daDescargar() {
  if (!DA.datos) return;
  var f = daFiltrar(), sep = ';', q = function(v) { return '"' + String(v).replace(/"/g, '""') + '"'; };
  var a1 = [['Centro', 'Casos medidos', 'Pasaron de 2 h', '% que pasó', 'Promedio (min)', 'El más largo (min)'].map(q).join(sep)].concat(f.centros.map(function(c) {
    return [q(c.centro), c.casos, c.pasadas, c.pct, c.promedio, c.max].join(sep); }));
  var a2 = [['Fecha', 'Orden', 'Paciente', 'Centro', 'Equipo', 'Diseñador', 'START', 'RTD', 'Minutos'].map(q).join(sep)].concat(f.casos.map(function(c) {
    return [c.fecha, q(c.orden), q(c.paciente), q(c.centro), q(c.equipo), q(c.designer), q(c.start), q(c.rtd), c.min].join(sep); }));
  var b = new Blob(['﻿' + a1.concat(['', q('Casos que pasaron de 2 horas')], a2).join('\r\n')], {type: 'text/csv;charset=utf-8'}), a = document.createElement('a');
  a.href = URL.createObjectURL(b); a.download = 'Articulacion ' + document.getElementById('daDesde').value + ' a ' + document.getElementById('daHasta').value + '.csv';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(function() { URL.revokeObjectURL(a.href); }, 2000);
}
(function() {
  var el = function(id) { return document.getElementById(id); };
  if (!el('ddVistaArticulacion')) return;
  el('daArea').addEventListener('change', function() { daEquipos().then(daCargar); });
  ['daTeam', 'daDesde', 'daHasta'].forEach(function(id) { el(id).addEventListener('change', daCargar); });
  var tb = null; el('daBuscar').addEventListener('input', function() { clearTimeout(tb); tb = setTimeout(function() { DA.tope = DA_TOPE; daPintar(); }, 200); });
  el('daDescargar').addEventListener('click', daDescargar);
})();


// ---------- Dashboard › Cambios digitales (13-oct-2026) ----------
// Registro de los cambios que piden el doctor o el laboratorio. Buscar, filtrar, ordenar, editar en la celda, agregar,
// quitar (solo admin), importar el Excel y descargar. Mismo estilo que las demás tablas del Dashboard.
var DC = {items: [], total: 0, orden: 'fecha', dir: 'desc', limite: 50, tok: 0, ediciones: 0, tipos: [], centros: []};
var DC_COLS = [['fecha', 'Fecha'], ['orden', 'Orden'], ['paciente', 'Paciente'], ['centro', 'Centro'], ['doctor', 'Doctor'],
               ['producto', 'Producto'], ['tipo_cambio', 'Cambio'], ['detalle', 'Detalle'], ['origen', 'Origen']];
function dcEsc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function dcFiltros() {
  var v = function(id) { return document.getElementById(id).value; };
  return {q: v('dcBuscar').trim(), origen: v('dcOrigen'), tipo: v('dcTipo'), centro: v('dcCentro'), desde: v('dcDesde'), hasta: v('dcHasta'),
          orden: DC.orden, dir: DC.dir};
}
function dcUrl(extra) {
  var f = dcFiltros(), p = new URLSearchParams();
  Object.keys(f).forEach(function(k) { if (f[k]) p.set(k, f[k]); });
  if (extra) Object.keys(extra).forEach(function(k) { p.set(k, extra[k]); });
  return p.toString();
}
document.addEventListener('ds:vivo', function(e) {
  var a = e.detail || {};
  if (a.t !== 'cambios') return;
  var v = document.getElementById('ddVistaCambios'), t = document.getElementById('dcTabla');
  if (!v || v.hidden || !v.offsetParent) return;   // la vista no está abierta
  if (t && document.activeElement && t.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;   // está editando una celda
  clearTimeout(DC.tViv); DC.tViv = setTimeout(function() { dcCargar(true); }, 600 + Math.random() * 1500);
});
function dcCargar(reiniciar) {
  var tok = DC.tok = DC.tok + 1;
  var offset = reiniciar ? 0 : DC.items.length;
  dcMostrarSemestre();
  if (reiniciar) { DC.items = []; }
  var url = '/design/api/cambios-digitales?' + dcUrl({limite: DC.limite, offset: offset});
  document.getElementById('dcTabla').style.opacity = '.5';
  ddApi(url).then(function(d) {
    if (tok !== DC.tok) return;
    DC.items = DC.items.concat(d.items); DC.total = d.total;
    if (reiniciar || !DC.tipos.length || d.tipos.length) { DC.tipos = d.tipos; DC.centros = d.centros; dcLlenarFiltros(d); }
    dcKpis(d.kpis);
    dcPintar();
  }).catch(function(e) {
    document.getElementById('dcTabla').innerHTML = '<tbody><tr><td style="color:#b91c1c">No se pudo cargar: ' + dcEsc(e.message) + '</td></tr></tbody>';
  }).then(function() { document.getElementById('dcTabla').style.opacity = ''; });
}
function dcLlenarFiltros(d) {
  var poner = function(id, lista, todos) {
    var sel = document.getElementById(id), actual = sel.value;
    sel.innerHTML = '<option value="">' + todos + '</option>' + lista.map(function(x) { return '<option value="' + dcEsc(x) + '">' + dcEsc(x) + '</option>'; }).join('');
    sel.value = actual;
  };
  poner('dcTipo', d.tipos, 'Todos'); poner('dcCentro', d.centros, 'Todos');
}
function dcKpis(k) {
  document.getElementById('dcKpis').innerHTML =
    '<div class="dd-kpi"><b>' + k.total + '</b><span>cambios registrados</span></div>' +
    '<div class="dd-kpi"><b>' + k.doc + '</b><span>pedidos por el doctor (DOC)</span></div>' +
    '<div class="dd-kpi"><b>' + k.lab + '</b><span>pedidos por el laboratorio (LAB)</span></div>' +
    '<div class="dd-kpi"><b>' + k.centros + '</b><span>centros con cambios</span></div>';
}
function dcCabecera() {
  return '<thead><tr>' + DC_COLS.map(function(c) {
    var key = c[0], sort = key !== 'detalle', flecha = DC.orden === key ? (DC.dir === 'asc' ? ' ▲' : ' ▼') : '';
    return '<th' + (sort ? ' data-o="' + key + '" style="cursor:pointer"' : '') + '>' + c[1] + flecha + '</th>';
  }).join('') + (DD_ADMIN ? '<th></th>' : '') + '</tr></thead>';
}
function dcCelda(f, campo) {
  var v = f[campo] || '';
  var clase = campo === 'detalle' ? ' style="white-space:pre-wrap;min-width:260px;max-width:420px;text-align:center"' : '';
  if (campo === 'origen') v = v ? '<span class="dc-origen dc-' + dcEsc(v) + '">' + dcEsc(v) + '</span>' : '';
  else v = dcEsc(v);
  var titulo = campo === 'detalle' && f.detalleEs ? f.detalleEs : 'Clic para editar';   // detalle en inglés: tooltip con la traducción
  return '<td data-campo="' + campo + '" data-id="' + f.id + '" class="dc-editable"' + clase + ' title="' + dcEsc(titulo) + '">' + v + '</td>';
}
function dcPintar() {
  var t = document.getElementById('dcTabla');
  var filas = DC.items.map(function(f) {
    return '<tr data-id="' + f.id + '">' + DC_COLS.map(function(c) { return dcCelda(f, c[0]); }).join('') +
      (DD_ADMIN ? '<td><button type="button" class="dc-x" data-dc-borrar="' + f.id + '" aria-label="Quitar este cambio" title="Quitar">×</button></td>' : '') + '</tr>';
  }).join('');
  t.innerHTML = dcCabecera() + '<tbody>' + (filas || '<tr><td colspan="' + (DD_ADMIN ? 10 : 9) + '" style="color:#4b5563">No hay cambios con estos filtros.</td></tr>') + '</tbody>';
  document.getElementById('dcCuenta').textContent = 'Mostrando ' + DC.items.length + ' de ' + DC.total;
  var mas = document.getElementById('dcMas');
  mas.innerHTML = DC.items.length < DC.total ? '<button type="button" class="btn gris mini" id="dcVerMas">Mostrar más (' + (DC.total - DC.items.length) + ' restantes)</button>' : '';
  var vm = document.getElementById('dcVerMas'); if (vm) vm.onclick = function() { dcCargar(false); };
  t.querySelectorAll('thead th[data-o]').forEach(function(th) {
    th.onclick = function() {
      var k = th.dataset.o;
      DC.dir = DC.orden === k ? (DC.dir === 'asc' ? 'desc' : 'asc') : (k === 'fecha' ? 'desc' : 'asc');
      DC.orden = k; dcCargar(true);
    };
  });
  t.querySelectorAll('[data-dc-borrar]').forEach(function(b) { b.onclick = function() { dcBorrar(b.dataset.dcBorrar); }; });
  t.querySelectorAll('td.dc-editable').forEach(function(td) { td.onclick = function() { dcEditar(td); }; });
}
// Edición en la celda: Enter guarda (en Detalle, Shift+Enter hace salto de línea), Esc cancela, salir de la celda guarda.
function dcEditar(td) {
  if (td.querySelector('input, select, textarea')) return;
  var campo = td.dataset.campo, id = +td.dataset.id, f = DC.items.find(function(x) { return x.id === id; });
  if (!f) return;
  var antes = f[campo] || '', el;
  if (campo === 'origen') { el = document.createElement('select'); el.innerHTML = '<option value="">—</option><option value="DOC">DOC</option><option value="LAB">LAB</option>'; el.value = antes; }
  else if (campo === 'fecha') { el = document.createElement('input'); el.type = 'date'; el.value = antes; }
  else if (campo === 'detalle') { el = document.createElement('textarea'); el.rows = 3; el.value = antes; el.style.width = '100%'; }
  else { el = document.createElement('input'); el.type = 'text'; el.value = antes; el.style.width = '100%'; }
  el.setAttribute('aria-label', 'Editar ' + campo);
  td.innerHTML = ''; td.appendChild(el); el.focus();
  if (el.select && el.tagName === 'INPUT' && el.type === 'text') el.select();
  var fin = function(guardar) {
    el.removeEventListener('blur', alSalir);
    if (!guardar || el.value === antes) { dcPintarFila(id); return; }
    var nuevo = el.value;
    window.dsPostJSON('/design/api/cambios-digitales/' + id, {campo: campo, valor: nuevo})
      .then(function(r) { var i = DC.items.findIndex(function(x) { return x.id === id; }); if (i >= 0) DC.items[i] = r; dcPintarFila(id); if (campo !== 'tipo_cambio' && campo !== 'centro') return; dcCargar(true); })
      .catch(function(e) { dcPintarFila(id); dsToast('⚠️ ' + e.message); });
  };
  var alSalir = function() { fin(true); };
  el.addEventListener('blur', alSalir);
  el.addEventListener('keydown', function(e) {
    e.stopPropagation();   // Esc aquí solo cancela la celda: no debe cerrar el Dashboard
    if (e.key === 'Escape') { e.preventDefault(); fin(false); }
    else if (e.key === 'Enter' && !(campo === 'detalle' && e.shiftKey)) { e.preventDefault(); fin(true); }
  });
}
function dcPintarFila(id) {
  var f = DC.items.find(function(x) { return x.id === id; }); var tr = document.querySelector('#dcTabla tr[data-id="' + id + '"]');
  if (!f || !tr) return dcPintar();
  var tmp = document.createElement('tr'); tmp.dataset.id = id;
  tmp.innerHTML = DC_COLS.map(function(c) { return dcCelda(f, c[0]); }).join('') + (DD_ADMIN ? '<td><button type="button" class="dc-x" data-dc-borrar="' + f.id + '" aria-label="Quitar este cambio" title="Quitar">×</button></td>' : '');
  tr.innerHTML = tmp.innerHTML;
  tr.querySelectorAll('td.dc-editable').forEach(function(td) { td.onclick = function() { dcEditar(td); }; });
  var b = tr.querySelector('[data-dc-borrar]'); if (b) b.onclick = function() { dcBorrar(id); };
}
function dcBorrar(id) {
  if (!confirm('¿Quitar este cambio del registro?')) return;
  window.dsPostJSON('/design/api/cambios-digitales/' + id + '/eliminar', {})
    .then(function() { DC.items = DC.items.filter(function(x) { return x.id !== id; }); DC.total -= 1; dsToast('Cambio quitado.'); dcCargar(true); })
    .catch(function(e) { dsToast('⚠️ ' + e.message); });
}
// Semestres (13-oct-2026): jun–dic y ene–jun. Por defecto, el semestre de hoy; las flechas pasan al siguiente o anterior.
function dcSemestreDe(anio, mitad) {   // mitad 1 = jun–dic, 0 = ene–jun
  return mitad ? {desde: anio + '-06-01', hasta: anio + '-12-31'} : {desde: anio + '-01-01', hasta: anio + '-06-30'};
}
function dcSemestreInicial() {
  var d = document.getElementById('dcDesde'), h = document.getElementById('dcHasta');
  if (d.value && h.value) return;
  var hoy = new Date(), s = dcSemestreDe(hoy.getFullYear(), hoy.getMonth() >= 5 ? 1 : 0);
  d.value = s.desde; h.value = s.hasta;
}
function dcSemestrePaso(delta) {
  var d = document.getElementById('dcDesde').value || document.getElementById('dcHasta').value;
  var base = d ? new Date(d + 'T12:00:00') : new Date();
  var idx = base.getFullYear() * 2 + (base.getMonth() >= 5 ? 1 : 0) + delta;
  var s = dcSemestreDe(Math.floor(idx / 2), idx % 2);
  document.getElementById('dcDesde').value = s.desde; document.getElementById('dcHasta').value = s.hasta;
  dcCargar(true);
}
function dcMostrarSemestre() {
  var d = document.getElementById('dcDesde').value, h = document.getElementById('dcHasta').value, el = document.getElementById('dcSemLabel');
  if (!el) return;
  if (!d || !h) { el.textContent = 'Todo el registro'; return; }
  var mesIni = +d.slice(5, 7), anio = d.slice(0, 4), esJunDic = mesIni === 6;
  el.textContent = (esJunDic ? 'Jun – Dic ' : 'Ene – Jun ') + anio;
}
// Cambio digital (13-oct-2026): formulario tipo tabla desde Producción. El número de orden trae el resto del Schedule.
function dcdAbrir() {
  var campos = [['orden', 'Número de orden'], ['fecha', 'Fecha'], ['paciente', 'Paciente'], ['centro', 'Centro'], ['producto', 'Producto'],
                ['doctor', 'Doctor'], ['tipo_cambio', 'Tipo de cambio'], ['detalle', 'Detalle'], ['origen', 'Origen (quién lo pidió)']];
  var filas = campos.map(function(c) {
    var campo;
    if (c[0] === 'orden') campo = '<input id="dcd_orden" type="text" autocomplete="off" placeholder="Ej: 240169" style="width:100%">';
    else if (['fecha', 'paciente', 'centro', 'producto'].indexOf(c[0]) >= 0) campo = '<span id="dcd_' + c[0] + '" class="dcd-auto">—</span>';
    else if (c[0] === 'doctor') campo = '<select id="dcd_doctor" style="width:100%"><option value="">— elige un doctor —</option></select>' +
      '<div id="dcd_doctor_nuevo_w" hidden style="margin-top:6px"><input id="dcd_doctor_nuevo" type="text" placeholder="Escribe el nombre del doctor en turno" style="width:100%"></div>';
    else if (c[0] === 'tipo_cambio') campo = '<select id="dcd_tipo" style="width:100%"><option value="">— elige un tipo —</option></select>' +
      '<div id="dcd_tipo_nuevo_w" hidden style="margin-top:6px"><input id="dcd_tipo_nuevo" type="text" placeholder="Escribe el nuevo tipo de cambio" style="width:100%"></div>';
    else if (c[0] === 'detalle') campo = '<textarea id="dcd_detalle" rows="3" placeholder="Qué se cambió y por qué" style="width:100%"></textarea>';
    else campo = '<select id="dcd_origen" style="width:100%"><option value="">— elige —</option><option value="DOC">DOC · lo pidió el doctor</option><option value="LAB">LAB · lo pidió el laboratorio</option></select>';
    return '<tr><th style="width:34%;text-align:center">' + c[1] + (c[0] === 'orden' || c[0] === 'doctor' || c[0] === 'tipo_cambio' || c[0] === 'detalle' || c[0] === 'origen' ? ' <span style="color:#b91c1c">*</span>' : '') + '</th><td>' + campo + '</td></tr>';
  }).join('');
  var html = '<h3>Cambio digital</h3><p class="dd-p-nota" style="margin:0 0 8px">Escribe el número de orden: fecha, paciente, centro y producto salen del Schedule. Lo marcado con * es obligatorio.</p>' +
    '<table class="dd-tabla dcd-tabla" style="width:100%"><tbody>' + filas + '</tbody></table><p id="dcd_aviso" class="dd-p-nota" style="min-height:18px;margin:6px 0 0"></p>';
  var ov = dcModal(html, function(f) {
    var datos = {orden: v('orden'), doctor: doctorElegido(), tipo_cambio: tipoElegido(), detalle: v('detalle'), origen: v('origen')};
    window.dsPostJSON('/design/api/cambios-digitales/desde-orden', datos).then(function() {
      f.remove(); dsToast('Cambio digital guardado en la tabla.'); dcCargar(true);
    }).catch(function(e) { f.querySelector('[data-m=si]').disabled = false; alert(e.message); });
  }, 'Guardar');
  function v(id) { return (document.getElementById('dcd_' + id) || {value: ''}).value.trim(); }
  ov.classList.add('ds-fondo-50');   // fondo al 50 % (Rosember, 26-oct-2026)
  var guardar = ov.querySelector('[data-m=si]');
  // Tipos de cambio: los que ya existen + "Agregar tipo de cambio…" para escribir uno nuevo
  var selTipo = document.getElementById('dcd_tipo'), wNuevo = document.getElementById('dcd_tipo_nuevo_w');
  function tipoElegido() {
    if (selTipo.value !== '__nuevo__') return selTipo.value;
    var escrito = document.getElementById('dcd_tipo_nuevo').value.trim().replace(/\s+/g, ' ');
    var igual = Array.prototype.find.call(selTipo.options, function(o) { return o.value && o.value !== '__nuevo__' && o.value.toLowerCase() === escrito.toLowerCase(); });
    return igual ? igual.value : escrito;   // si ya existe (sin importar mayúsculas), usa el mismo nombre
  }
  // Doctor: los de Pre-Approved del centro + "Otro doctor" para escribir el que está en turno
  var selDoc = document.getElementById('dcd_doctor'), wDocNuevo = document.getElementById('dcd_doctor_nuevo_w');
  function doctorElegido() {
    if (selDoc.value !== '__nuevo__') return selDoc.value;
    return document.getElementById('dcd_doctor_nuevo').value.trim().replace(/\s+/g, ' ');
  }
  function cargarDoctores(centro) {
    ddApi('/design/api/cambios-digitales/doctores?centro=' + encodeURIComponent(centro)).then(function(r) {
      var lista = r.doctores || [];
      selDoc.innerHTML = '<option value="">— elige un doctor —</option>' + lista.map(function(n) { return '<option value="' + dcEsc(n) + '">' + dcEsc(n) + '</option>'; }).join('') +
        '<option value="__nuevo__">+ Otro doctor (escribirlo)…</option>';
      selDoc.value = '';
      wDocNuevo.hidden = lista.length > 0;   // sin doctores en Pre-Approved: se escribe directamente
      if (!lista.length) document.getElementById('dcd_doctor_nuevo').focus();
      estado();
    }).catch(function() { wDocNuevo.hidden = false; estado(); });
  }
  selDoc.addEventListener('change', function() {
    wDocNuevo.hidden = selDoc.value !== '__nuevo__';
    if (!wDocNuevo.hidden) document.getElementById('dcd_doctor_nuevo').focus();
    estado();
  });
  document.getElementById('dcd_doctor_nuevo').addEventListener('input', estado);
  ddApi('/design/api/cambios-digitales?limite=1').then(function(d) {
    selTipo.innerHTML = '<option value="">— elige un tipo —</option>' + (d.tipos || []).map(function(t) { return '<option value="' + dcEsc(t) + '">' + dcEsc(t) + '</option>'; }).join('') +
      '<option value="__nuevo__">+ Agregar tipo de cambio…</option>';
  }).catch(function() {});
  selTipo.addEventListener('change', function() {
    wNuevo.hidden = selTipo.value !== '__nuevo__';
    if (!wNuevo.hidden) document.getElementById('dcd_tipo_nuevo').focus();
    estado();
  });
  document.getElementById('dcd_tipo_nuevo').addEventListener('input', estado);
  var encontrada = false, buscando = null, tok = 0;
  function estado() {
    var listo = encontrada && doctorElegido() && tipoElegido() && v('detalle') && v('origen');
    guardar.disabled = !listo;
    return listo;
  }
  function buscar() {
    var num = v('orden'), t = ++tok;
    encontrada = false;
    ['fecha', 'paciente', 'centro', 'producto'].forEach(function(c) { document.getElementById('dcd_' + c).textContent = '—'; });
    if (!num) { document.getElementById('dcd_aviso').textContent = ''; estado(); return; }
    ddApi('/design/api/cambios-digitales/buscar-orden?orden=' + encodeURIComponent(num)).then(function(r) {
      if (t !== tok) return;
      if (!r.encontrada) { document.getElementById('dcd_aviso').textContent = r.motivo; }
      else {
        encontrada = true;
        document.getElementById('dcd_fecha').textContent = r.fecha ? r.fecha.split('-').reverse().join('/') : '—';
        document.getElementById('dcd_paciente').textContent = r.paciente || '—';
        document.getElementById('dcd_centro').textContent = r.centro || '—';
        document.getElementById('dcd_producto').textContent = r.producto || '—';
        cargarDoctores(r.centro);
        document.getElementById('dcd_aviso').textContent = r.coincidencias > 1
          ? 'Hay ' + r.coincidencias + ' órdenes con ese número: se usa la más reciente (' + r.equipo + ').'
          : 'Orden encontrada en ' + r.equipo + '.';
      }
      estado();
    }).catch(function(e) { if (t === tok) { document.getElementById('dcd_aviso').textContent = e.message; estado(); } });
  }
  ['dcd_orden'].forEach(function(id) {
    document.getElementById(id).addEventListener('input', function() { clearTimeout(buscando); buscando = setTimeout(buscar, 300); });
  });
  ['dcd_detalle', 'dcd_origen'].forEach(function(id) {
    document.getElementById(id).addEventListener('input', estado); document.getElementById(id).addEventListener('change', estado);
  });
  estado();
  document.getElementById('dcd_orden').focus();
}
(function() {
  var b = document.getElementById('dsCambioDigBtn'); if (b) b.addEventListener('click', dcdAbrir);
  var a = document.getElementById('dcSemAnt'), s = document.getElementById('dcSemSig');
  if (a) a.addEventListener('click', function() { dcSemestrePaso(-1); });
  if (s) s.addEventListener('click', function() { dcSemestrePaso(1); });
})();

// Ventana propia de esta pantalla (la del Dashboard no comparte la de Parámetros)
function dcModal(html, aceptar, etiqueta) {
  var f = document.createElement('div'); f.className = 'eq-modal-fondo';
  f.innerHTML = '<div class="eq-modal" role="dialog" aria-modal="true">' + html + '<div class="eq-modal-acc"><button type="button" class="btn gris" data-m="no">Cancelar</button>' +
    '<button type="button" class="btn" data-m="si">' + dcEsc(etiqueta) + '</button></div></div>';
  document.body.appendChild(f);
  // Esc cierra el diálogo, como los demás paneles de Design (28-oct-2026)
  var tecla = function(e) { if (e.key === 'Escape' && document.body.contains(f)) { e.stopPropagation(); f.remove(); document.removeEventListener('keydown', tecla, true); } };
  document.addEventListener('keydown', tecla, true);
  f.addEventListener('click', function(e) {
    if (e.target === f || e.target.dataset.m === 'no') { f.remove(); document.removeEventListener('keydown', tecla, true); }
    else if (e.target.dataset.m === 'si') { e.target.disabled = true; aceptar(f); }
  });
  return f;
}
function dcImportarArchivo(file) {
  var fd = new FormData(); fd.append('archivo', file);
  dsToast('Importando ' + file.name + '…');
  fetch('/design/api/cambios-digitales/importar', {method: 'POST', body: fd, credentials: 'same-origin'}).then(function(r) {
    return r.json().catch(function() { return {}; }).then(function(x) { if (!r.ok) throw new Error(typeof x.detail === 'string' ? x.detail : 'HTTP ' + r.status); return x; });
  }).then(function(x) {
    var msg = x.agregados + ' cambio(s) agregado(s)' + (x.repetidos ? ', ' + x.repetidos + ' ya estaban' : '') + (x.errores.length ? '. Revisa: ' + x.errores.slice(0, 3).join(' · ') : '.');
    alert(msg); dcCargar(true);
  }).catch(function(e) { alert('No se pudo importar: ' + e.message); });
}
(function() {
  var el = function(id) { return document.getElementById(id); };
  if (!el('ddVistaCambios')) return;
  var tb = null;
  el('dcBuscar').addEventListener('input', function() { clearTimeout(tb); tb = setTimeout(function() { dcCargar(true); }, 250); });
  ['dcOrigen', 'dcTipo', 'dcCentro', 'dcDesde', 'dcHasta'].forEach(function(id) { el(id).addEventListener('change', function() { dcCargar(true); }); });
  el('dcAgregar').addEventListener('click', function() { el('dcPlegable').open = true; dcdAbrir(); });   // al agregar se abre la tabla para ver el cambio nuevo   // mismo formulario guiado que en Producción (orden → datos del Schedule)
  el('dcImportar').addEventListener('click', function() { el('dcArchivo').click(); });
  el('dcArchivo').addEventListener('change', function() { if (this.files[0]) dcImportarArchivo(this.files[0]); this.value = ''; });
  el('dcCsv').addEventListener('click', function() { window.location = '/design/api/cambios-digitales/csv?' + dcUrl(); });
})();


// ---------- Dashboard › Aprobaciones (solo admin, 13-oct-2026): órdenes que tardaron más de 1 h 30 min en aprobarse ----------
// Órdenes en las que el manager tardó más de 1 h 30 min entre Approved y marcar el QC (o siguen sin QC pasado ese tiempo).
var DL = {items: [], orden: 'minutos', dir: 'desc', tope: 50, tok: 0};
var DL_COLS = [['fecha', 'Fecha'], ['orden', 'Orden'], ['paciente', 'Paciente'], ['centro', 'Centro'], ['manager', 'Manager'],   // sin Equipo (21-oct-2026)
               ['disenador', 'Diseñador'], ['aprobadaEn', 'Aprobada'], ['minutos', 'Sin QC desde hace']];   // solo las que siguen sin QC (21-oct-2026)
function dlHora(iso) {
  return iso ? new Date(iso).toLocaleString('es-CO', {timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true}) : '—';
}
// Por defecto, el semestre de hoy (jun–dic o ene–jun), igual que Cambios digitales; las flechas pasan de semestre.
function dlIniciar() {
  var pl = document.getElementById('dlPlegable'); if (pl) pl.open = false;   // se abre cerrada (Rosember, 21-oct-2026)
  var d = document.getElementById('dlDesde'), h = document.getElementById('dlHasta');
  if (!d.value || !h.value) {
    var hoy = new Date(), s = dcSemestreDe(hoy.getFullYear(), hoy.getMonth() >= 5 ? 1 : 0);
    d.value = s.desde; h.value = s.hasta;
  }
  dlCargar();
}
function dlSemestrePaso(delta) {
  var d = document.getElementById('dlDesde').value || document.getElementById('dlHasta').value;
  var base = d ? new Date(d + 'T12:00:00') : new Date();
  var idx = base.getFullYear() * 2 + (base.getMonth() >= 5 ? 1 : 0) + delta;
  var s = dcSemestreDe(Math.floor(idx / 2), idx % 2);
  document.getElementById('dlDesde').value = s.desde; document.getElementById('dlHasta').value = s.hasta;
  dlCargar();
}
function dlMostrarSemestre() {
  var d = document.getElementById('dlDesde').value, h = document.getElementById('dlHasta').value, el = document.getElementById('dlSemLabel');
  if (!el) return;
  var esSem = (d.slice(5) === '06-01' && h.slice(5) === '12-31') || (d.slice(5) === '01-01' && h.slice(5) === '06-30');
  el.textContent = !d || !h ? '' : esSem ? (d.slice(5, 7) === '06' ? 'Jun – Dic ' : 'Ene – Jun ') + d.slice(0, 4) : 'Periodo personalizado';
}
function dlCargar() {
  var area = document.getElementById('dlArea').value, team = document.getElementById('dlTeam').value;
  var u = '/design/api/dashboard/aprobaciones-lentas?desde=' + document.getElementById('dlDesde').value + '&hasta=' + document.getElementById('dlHasta').value +
          (team ? '&team_id=' + team : area ? '&area_id=' + area : '');
  var tok = DL.tok = DL.tok + 1;
  dlMostrarSemestre();
  document.getElementById('dlTabla').style.opacity = '.5';
  ddApi(u).then(function(d) {
    if (tok !== DL.tok) return;
    DL.items = d.items; DL.tope = 50; DL.kpis = d.kpis; dlKpis(d.kpis); dlPintar();
  }).catch(function(e) {
    document.getElementById('dlTabla').innerHTML = '<tbody><tr><td style="color:#b91c1c">No se pudo cargar: ' + dcEsc(e.message) + '</td></tr></tbody>';
  }).then(function() { document.getElementById('dlTabla').style.opacity = ''; });
}
function dlKpis(k) {
  document.getElementById('dlKpis').innerHTML =
    '<div class="dd-kpi alerta"><b>' + k.total + '</b><span>aprobadas sin QC hace más de 1 h 30 min</span></div>' +
    '<div class="dd-kpi"><b>' + (k.managers || 0) + '</b><span>managers con QC pendiente</span></div>' +
    '<div class="dd-kpi"><b>' + (k.total ? daFmt(k.promedio) : '—') + '</b><span>espera promedio</span></div>' +
    '<div class="dd-kpi"><b>' + (k.total ? daFmt(k.maxima) : '—') + '</b><span>la espera más larga</span></div>';
}
function dlFiltradas() {
  var q = dpNorm(document.getElementById('dlBuscar').value.trim());
  var l = DL.items.filter(function(x) { return !q || dpNorm([x.orden, x.paciente, x.centro, x.equipo, x.manager, x.disenador].join(' ')).indexOf(q) >= 0; });
  var k = DL.orden, dir = DL.dir === 'asc' ? 1 : -1;
  return l.slice().sort(function(a, b) {
    var va = a[k], vb = b[k]; if (typeof va === 'string') { va = va.toLowerCase(); vb = String(vb).toLowerCase(); }
    return (va < vb ? -1 : va > vb ? 1 : 0) * dir || b.minutos - a.minutos;
  });
}
function dlPintar() {
  var l = dlFiltradas(), t = document.getElementById('dlTabla');
  var cab = '<thead><tr>' + DL_COLS.map(function(c) {
    var fl = DL.orden === c[0] ? (DL.dir === 'asc' ? ' ▲' : ' ▼') : '';
    return '<th data-o="' + c[0] + '" style="cursor:pointer">' + c[1] + fl + '</th>';
  }).join('') + '</tr></thead>';
  var filas = l.slice(0, DL.tope).map(function(x) {
    return '<tr><td>' + dcEsc(x.fecha.split('-').reverse().join('/')) + '</td><td>' + dcEsc(x.orden) + '</td><td>' + dcEsc(x.paciente) + '</td><td>' + dcEsc(x.centro) +
      '</td><td>' + dcEsc(x.manager) + '</td><td>' + dcEsc(x.disenador) + '</td><td>' + dlHora(x.aprobadaEn) + '</td><td><b class="dl-pend">' + daFmt(x.minutos) + '</b></td></tr>';
  }).join('');
  t.innerHTML = cab + '<tbody>' + (filas || '<tr><td colspan="8" style="color:#4b5563">No hay órdenes aprobadas sin QC por más de 1 h 30 min en este periodo.</td></tr>') + '</tbody>';
  document.getElementById('dlCuenta').textContent = 'Mostrando ' + Math.min(DL.tope, l.length) + ' de ' + l.length;
  var mas = document.getElementById('dlMas');
  mas.innerHTML = l.length > DL.tope ? '<button type="button" class="btn gris mini" id="dlVerMas">Mostrar más (' + (l.length - DL.tope) + ' restantes)</button>' : '';
  var vm = document.getElementById('dlVerMas'); if (vm) vm.onclick = function() { DL.tope += 50; dlPintar(); };
  t.querySelectorAll('thead th[data-o]').forEach(function(th) {
    th.onclick = function() { var k = th.dataset.o; DL.dir = DL.orden === k ? (DL.dir === 'asc' ? 'desc' : 'asc') : (k === 'minutos' ? 'desc' : 'asc'); DL.orden = k; dlPintar(); };
  });
}
function dlDescargar() {
  var l = dlFiltradas(), sep = ';', q = function(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
  var csv = [['Fecha', 'Orden', 'Paciente', 'Centro', 'Equipo', 'Manager', 'Diseñador', 'Aprobada', 'Minutos sin QC'].map(q).join(sep)].concat(l.map(function(x) {
    return [x.fecha, x.orden, x.paciente, x.centro, x.equipo, x.manager, x.disenador, dlHora(x.aprobadaEn), x.minutos].map(q).join(sep); }));
  var b = new Blob(['\ufeff' + csv.join('\r\n')], {type: 'text/csv;charset=utf-8'}), a = document.createElement('a');
  a.href = URL.createObjectURL(b); a.download = 'Aprobaciones ' + document.getElementById('dlDesde').value + ' a ' + document.getElementById('dlHasta').value + '.csv';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(function() { URL.revokeObjectURL(a.href); }, 2000);
}
(function() {
  var el = function(id) { return document.getElementById(id); };
  if (!el('ddVistaLentas')) return;
  el('dlArea').addEventListener('change', function() {
    var sel = el('dlTeam'), areaId = el('dlArea').value; sel.innerHTML = '<option value="">-- Todos --</option>';
    if (!areaId) { dlCargar(); return; }
    ddApi('/design/api/teams?area_id=' + areaId).then(function(teams) {
      teams.forEach(function(t) { var o = document.createElement('option'); o.value = t.id; o.text = t.nombre; sel.appendChild(o); });
    }).then(dlCargar);
  });
  ['dlTeam', 'dlDesde', 'dlHasta'].forEach(function(id) { el(id).addEventListener('change', dlCargar); });
  var tb = null; el('dlBuscar').addEventListener('input', function() { clearTimeout(tb); tb = setTimeout(function() { DL.tope = 50; dlPintar(); }, 200); });
  el('dlCsv').addEventListener('click', dlDescargar);
  el('dlSemAnt').addEventListener('click', function() { dlSemestrePaso(-1); });
  el('dlSemSig').addEventListener('click', function() { dlSemestrePaso(1); });
})();

window.DS_PANELS.dashboard = function() {
  if (!document.getElementById('ddVistaGeneral').hidden) { dgCargar(); return; }
  if (!document.getElementById('ddVistaArticulacion').hidden) { daAbrir(); return; }
  if (!document.getElementById('ddVistaProductos').hidden) { dpCargar(); return; }
  if (!document.getElementById('ddVistaCambios').hidden) { dcSemestreInicial(); dcCargar(true); return; }
  var vl2 = document.getElementById('ddVistaLentas'); if (vl2 && !vl2.hidden) { dlIniciar(); return; }
  ddAbrirFiltros();
};
function ddAbrirFiltros() {   // pestaña Filtros (antes «Resumen»): igual que siempre
  if (!ddCargar.listo) {
    ddCargar.listo = true;
    if (!document.getElementById('ddDesde').value && !document.getElementById('ddHasta').value) {
      ddAplicarInicial().then(function() { ddRapido('mes'); }); return;
    }
    ddAplicarInicial().then(ddCargar); return;
  }
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
  // 28-oct-2026: + Shape (n11) en Design details; se quitó «Número de Attachment del archivo To mill» (l22), no se usaba
  var CMT_FIELDS = ["b4","j4","b7","b11","d11","f11","h11","j11","l11","n11","b15","f15","j15","b19","f19","j19","l23","l24","l25","l26","l27","b30"];
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
  // VDO con punto decimal y su propio signo: «1,5» → «+1.5», «+1.2» → «+1.2» (no «++1.2»)
  function cmtVdo(v){ var s=cmtDisp(v).replace(",",".").replace(/^\+\s*/,""); return (cmtNum(s)>0?"+":"")+s; }
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
    if(cmtNe(f.n11)) s += "Shape: "+f.n11+CMT_NL;
    if(cmtNz(f.h11)) s += "VDO: "+cmtVdo(f.h11)+CMT_NL;
    if(cmtNe(f.b15)||cmtNe(f.b19)){
      s += "Skipped implants: "+(cmtNe(f.b15)?"Upper: "+f.b15+" ":"")+(cmtNe(f.b19)?"Lower: "+f.b19:"")+CMT_NL;
    }
    if(cmtNe(f.b7)) s += CMT_NL;
    if(cmtNe(f.d11)) s += "This arch is "+(cmtSi(f.f11)?"Custom ":"")+f.d11+(cmtNe(f.l11)?" ":". ");   // sin PC cierra con punto
    if(cmtNe(f.l11)){
      if(cmtIsNum(f.l11)){
        var n=cmtNum(f.l11);
        var pre = n>999?"(InTech #":(n>99?"(DDI-0":(n>9?"(DDI-00":"(DDI-000"));
        s += pre+cmtDisp(f.l11)+"). ";
      } else { s += "(PC "+cmtDisp(f.l11).replace(/^PC\s*/i,"")+"). "; }   // si ya escribieron «PC 12» no sale «PC PC 12»
    }
    if(cmtNe(f.b7)){
      s += "We used VDO at "+cmtVdo(f.h11)+
           (cmtNz(f.h11)&&cmtNe(f.j11)?" (Digitally "+cmtVdo(f.j11)+")":"")+". ";
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
        "Scans ✅ "+CMT_NL+"Measurements ✅ "+CMT_NL+"Cantilever ✅ "+CMT_NL+"Access Hole ✅ "+CMT_NL+"Icam / Micron ✅";   // antes «Medidas» (28-oct-2026: todo en inglés)
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
    {id: "n11", label: "Shape (Design details)"}, {id: "j15", label: "Total (Implants Upper)"}, {id: "j19", label: "Total (Implants Lower)"}];
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
    var po = (f.b4 || '') + '\u0001' + (f.j4 || '');   // las plantillas solo usan paciente y orden ({PO})
    if (po !== cmtPoPintado) cmtRenderPlantillas();
    cmtGuardarLuego(f);
  }
  // El texto se actualiza con cada tecla, pero el borrador y la orden se guardan cuando la persona hace una pausa
  // de 250 ms (antes: dos escrituras completas por tecla). Antes de Limpiar, de cambiar de orden o de cerrar la
  // página se guarda lo pendiente de inmediato, así no se pierde nada.
  var cmtPendiente = null, cmtTimer = 0;
  function cmtGuardarLuego(f) { cmtPendiente = f; clearTimeout(cmtTimer); cmtTimer = setTimeout(cmtGuardarAhora, 250); }
  function cmtGuardarAhora() {
    clearTimeout(cmtTimer); cmtTimer = 0;
    var f = cmtPendiente; cmtPendiente = null;
    if (f) cmtGuardarBorrador(f);
  }
  window.addEventListener('pagehide', cmtGuardarAhora);
  window.addEventListener('beforeunload', cmtGuardarAhora);
  document.addEventListener('visibilitychange', function() { if (document.visibilityState === 'hidden') cmtGuardarAhora(); });
  // Borrador: lo escrito en Comments N3 se guarda en este navegador (por persona) con cada cambio, así al
  // actualizar la página o cerrarla por error no se pierde. "Limpiar" lo vacía (y guarda el caso en el historial).
  var CMT_BORRADOR_KEY = 'cmtBorradorV1:' + window.DS_CFG.userId, cmtBorradorListo = false;
  // Trabajo por orden: cada número de orden guarda lo que se trabajó en Comments (en este navegador, de cada persona).
  // Así, si una cirugía queda en Hold y el diseñador abre otra orden (ej. una TC), al volver a la primera recupera todo.
  // Se borra solo 2 días después del último cambio. Cada orden va en su propia clave (cmtOrdenV2:<persona>:<orden>),
  // así guardar una orden escribe solo esa y no las hasta 300 que haya (antes todas iban juntas en cmtOrdenesV1).
  var CMT_ORDEN_PREF = 'cmtOrdenV2:' + window.DS_CFG.userId + ':', CMT_ORDEN_DIAS = 2, CMT_ORDEN_MAX = 300;
  function cmtClaveOrden(o) { return String(o || '').trim().toUpperCase(); }
  function cmtOrdenLeer(k) {
    var o = null; try { o = JSON.parse(localStorage.getItem(CMT_ORDEN_PREF + k) || 'null'); } catch (e) {}
    if (o && o.t > Date.now() - CMT_ORDEN_DIAS * 864e5) return o;
    if (o) try { localStorage.removeItem(CMT_ORDEN_PREF + k); } catch (e) {}
    return null;
  }
  // Pasa lo guardado con el formato anterior (un solo mapa) a una clave por orden, borra las vencidas y deja máximo 300.
  function cmtOrdenesOrdenar() {
    try {
      var viejaK = 'cmtOrdenesV1:' + window.DS_CFG.userId, vieja = localStorage.getItem(viejaK);
      if (vieja) {
        var m = JSON.parse(vieja) || {};
        Object.keys(m).forEach(function(k) { if (m[k] && m[k].t && !localStorage.getItem(CMT_ORDEN_PREF + k)) localStorage.setItem(CMT_ORDEN_PREF + k, JSON.stringify(m[k])); });
        localStorage.removeItem(viejaK);
      }
      var lim = Date.now() - CMT_ORDEN_DIAS * 864e5, vivas = [];
      for (var i = localStorage.length - 1; i >= 0; i--) {
        var c = localStorage.key(i); if (!c || c.indexOf(CMT_ORDEN_PREF) !== 0) continue;
        var o = null; try { o = JSON.parse(localStorage.getItem(c)); } catch (e) {}
        if (!o || !(o.t > lim)) localStorage.removeItem(c); else vivas.push([c, o.t]);
      }
      if (vivas.length > CMT_ORDEN_MAX) vivas.sort(function(a, b) { return a[1] - b[1]; }).slice(0, vivas.length - CMT_ORDEN_MAX).forEach(function(x) { localStorage.removeItem(x[0]); });
    } catch (e) {}
  }
  cmtOrdenesOrdenar();
  window.cmtTrabajoDeOrden = function(orden) { var k = cmtClaveOrden(orden); return k ? cmtOrdenLeer(k) : null; };
  function cmtGuardarOrden(f) {
    var k = cmtClaveOrden(f.j4); if (!k || !CMT_FIELDS.some(function(x) { return cmtNe(f[x]); })) return;
    var antes = cmtOrdenLeer(k);
    try { localStorage.setItem(CMT_ORDEN_PREF + k, JSON.stringify({t: Date.now(), campos: f})); } catch (e) {}
    if (!antes) {
      cmtOrdenesOrdenar();   // orden nueva: revisa el tope de 300 (solo aquí, no con cada tecla)
      if (window.dsRefrescarAccesosCmt) window.dsRefrescarAccesosCmt();   // el 💬 de esa orden queda marcado
    }
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
  var cmtPoPintado = null;
  function cmtRenderPlantillas() {
    var f = cmtLeer();
    cmtPoPintado = (f.b4 || '') + '\u0001' + (f.j4 || '');
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
      cmtRecalcular(); cmtGuardarAhora();   // el borrador se borra ya, no 250 ms después
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
    cmtGuardarAhora();
    cmtGuardarOrden(f);   // lo que había en el formulario queda guardado en su orden
    var guardado = window.cmtTrabajoDeOrden(o.orden);
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
      if (r.v === PA.version) return;
      if (paOcupado()) { paVivoPend = true; return; }
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
  // Con la conexión en vivo: se revisa al llegar un aviso de Pre-Approved (y cada 90 s por seguridad); sin ella, cada 5 s.
  var paVivoPend = false, paVivoUlt = 0;
  function paVivoQuiza(forzar) {
    var enVivo = window.DSVivo && window.DSVivo.conectado;
    if (forzar || !enVivo || paVivoPend || Date.now() - paVivoUlt > 90000) { paVivoUlt = Date.now(); paVivoPend = false; paVivoTick(); }
  }
  setInterval(function() { paVivoQuiza(false); }, 5000);
  document.addEventListener('visibilitychange', function() { if (!document.hidden) paVivoQuiza(true); });
  document.addEventListener('ds:vivo', function(e) {
    var a = e.detail || {};
    if (a.t === 'reconectado' || a.t === 'pa') { paVivoPend = true; if (a.t === 'pa') setTimeout(function() { paVivoQuiza(false); }, 200); }
  });

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

  // ---------- Fotos en las celdas (pedido por Rosember el 12-oct-2026) ----------
  // Miniaturas debajo del texto; clic = verla grande. Quien edita Pre-Approved agrega con 📷 (o pegando una imagen con
  // Ctrl+V en la celda) y quita con ✕.
  function paFotosCelda(td, fotos, filaId, docId) {
    if (!fotos.length && !PA.edita) return;
    var cont = document.createElement('div'); cont.className = 'pa-fotos';
    fotos.forEach(function(f) {
      var b = document.createElement('span'); b.className = 'pa-foto';
      var img = document.createElement('img'); img.src = '/design/api/preapproved/fotos/' + f.id; img.alt = 'Foto'; img.loading = 'lazy';
      img.title = 'Ver la foto'; img.onclick = function(e) { e.stopPropagation(); window.paVerFoto(img.src); };
      b.appendChild(img);
      if (PA.edita) b.appendChild(paBotonX('Quitar la foto', function() {
        if (!confirm('¿Quitar esta foto de la celda? No se puede recuperar.')) return;
        paPost('/design/api/preapproved/fotos/' + f.id + '/eliminar').then(cargarDetalle).catch(paError);
      }));
      cont.appendChild(b);
    });
    if (PA.edita) {
      var lab = document.createElement('label'); lab.className = 'pa-foto-add'; lab.title = 'Agregar foto (también puedes pegarla con Ctrl+V en la celda)';
      lab.textContent = '📷';
      var inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/png,image/jpeg,image/webp,image/gif'; inp.multiple = true; inp.hidden = true;
      inp.onchange = function() { paSubirFotos(inp.files, filaId, docId); inp.value = ''; };
      lab.appendChild(inp); cont.appendChild(lab);
      td.addEventListener('paste', function(e) {
        var archivos = Array.prototype.filter.call((e.clipboardData || {}).files || [], function(f) { return /^image\//.test(f.type); });
        if (!archivos.length) return;
        e.preventDefault(); paSubirFotos(archivos, filaId, docId);
      });
    }
    td.appendChild(cont);
  }
  function paSubirFotos(archivos, filaId, docId) {
    var lista = Array.prototype.slice.call(archivos || []);
    if (!lista.length) return;
    PA.enVuelo = (PA.enVuelo || 0) + 1;
    Promise.all(lista.map(function(a) {
      var fd = new FormData(); fd.append('filaId', filaId); fd.append('doctorId', docId); fd.append('archivo', a, a.name || 'foto.png');
      return fetch('/design/api/preapproved/fotos', {method: 'POST', body: fd})
        .then(function(r) { return r.json().then(function(d) { if (!r.ok) throw new Error(d.detail || 'No se pudo subir la foto.'); return d; }); });
    })).then(function() { PA.enVuelo--; cargarDetalle(); }, function(e) { PA.enVuelo--; paError(e); });
  }
  // Foto en grande (también la usa la ventana de Pre-Approved del Schedule)
  window.paVerFoto = function(src) {
    var bg = document.createElement('div'); bg.className = 'pa-foto-bg'; bg.setAttribute('role', 'dialog'); bg.setAttribute('aria-label', 'Foto');
    var img = document.createElement('img'); img.src = src; img.alt = 'Foto';
    var x = document.createElement('button'); x.type = 'button'; x.className = 'pa-foto-cerrar'; x.textContent = '✕'; x.setAttribute('aria-label', 'Cerrar');
    bg.appendChild(img); bg.appendChild(x); document.body.appendChild(bg); x.focus();
    var cerrar = function() { bg.remove(); document.removeEventListener('keydown', tecla, true); };
    var tecla = function(e) { if (e.key === 'Escape') { e.stopPropagation(); cerrar(); } };
    document.addEventListener('keydown', tecla, true);
    bg.addEventListener('click', function(e) { if (e.target !== img) cerrar(); });
  };

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
    // «+ Doctor» (27-oct-2026): el centro que se toca (su nombre, un doctor o una celda de sus columnas) queda elegido y el
    // doctor nuevo se agrega ahí. centroDe[doctorId] = centro al que pertenece cada columna (los centros agrupan columnas seguidas).
    var centroDe = {}, k0 = 0;
    d.centros.forEach(function(c) { for (var j = 0; j < Math.max(1, c.span); j++) { var dd = d.doctores[k0++]; if (dd) centroDe[dd.id] = c.id; } });
    if (PA.centroSel && !d.centros.some(function(c) { return c.id === PA.centroSel; })) PA.centroSel = null;   // otra hoja o centro borrado
    d.centros.forEach(function(c) {
      var th = document.createElement('th'); th.colSpan = Math.max(1, c.span); th.dataset.centro = c.id;
      if (c.id === PA.centroSel) th.classList.add('pa-centro-sel');
      th.addEventListener('mousedown', function() { paElegirCentro(c.id); });
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
      if (centroDe[doc.id]) th.addEventListener('mousedown', function() { paElegirCentro(centroDe[doc.id]); });
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
        if (centroDe[doc.id]) td.addEventListener('mousedown', function() { paElegirCentro(centroDe[doc.id]); });
        if (paEsAsk(val)) td.className = 'pa-ask';
        var c = document.createElement('div'); c.className = 'pa-txt'; td.appendChild(c);
        paEditable(c, val, function(v) {
          td.classList.toggle('pa-ask', paEsAsk(v));
          paPost('/design/api/preapproved/celdas', {filaId: fila.id, doctorId: doc.id, valor: v})
            .then(function() { fila.valores[String(doc.id)] = v; }).catch(paError);
        });
        paFotosCelda(td, (d.fotos || {})[fila.id + '-' + doc.id] || [], fila.id, doc.id);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    tabla.appendChild(tbody);
    paEtiquetaDoctor();
  }
  // Centro elegido para «+ Doctor»: se marca en el encabezado y el botón dice en cuál se agrega
  function paElegirCentro(id) {
    if (PA.centroSel === id) return;
    PA.centroSel = id;
    document.querySelectorAll('#paTabla th[data-centro]').forEach(function(th) { th.classList.toggle('pa-centro-sel', th.dataset.centro === String(id)); });
    paEtiquetaDoctor();
  }
  function paEtiquetaDoctor() {
    var b = document.getElementById('paBtnDoctor'); if (!b) return;
    var c = PA.centroSel && PA.detalle && PA.detalle.centros.find(function(x) { return x.id === PA.centroSel; });
    var nombre = c ? (c.nombre || '').trim() : '';
    b.textContent = c ? '+ Doctor en ' + (nombre.length > 18 ? nombre.slice(0, 17) + '…' : nombre || 'este centro') : '+ Doctor';
    b.classList.toggle('pa-btn-centro', !!c);
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
    var c = PA.centroSel && PA.detalle && PA.detalle.centros.find(function(x) { return x.id === PA.centroSel; });
    paPost('/design/api/preapproved/sheets/' + PA.sheetId + '/doctores' + (c ? '?centro_id=' + c.id : ''))
      .then(function(r) {
        return Promise.resolve(cargarDetalle()).then(function() {
          var sc = document.getElementById('paScroll'), th = r && document.querySelector('#paTabla th[data-doctor="' + r.id + '"]');
          if (c && th) {   // en un centro: se lleva a la vista la columna nueva y se marca un momento
            sc.scrollBy({left: th.getBoundingClientRect().left - sc.getBoundingClientRect().left - 260, behavior: 'smooth'});
            th.classList.add('pa-nuevo'); setTimeout(function() { th.classList.remove('pa-nuevo'); }, 2500);
          } else setTimeout(function() { sc.scrollTo({left: sc.scrollWidth, behavior: 'smooth'}); }, 300);
        });
      })
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

    // Mismo manager en los dos lados: se mueve un doctor de un centro a otro de la misma hoja (el destino es siempre un centro)
    var mismo = PAC.srcSheetId === PAC.dstSheetId;
    var centroDe = function(det, docId) {
      var i = 0, k = det.doctores.findIndex(function(d) { return d.id === docId; }), acum = 0;
      if (k < 0) return null;
      for (i = 0; i < det.centros.length; i++) { acum += det.centros[i].span; if (k < acum) return det.centros[i]; }
      return null;
    };
    var showTC = PAC.mode === 'move' && PAC.srcSel;
    tcBlock.style.display = showTC ? '' : 'none';
    if (showTC) {
      var origen = mismo && PAC.srcSel.tipo === 'doctor' ? centroDe(PAC.dstDetalle, PAC.srcSel.id) : null;
      var libres = PAC.dstDetalle.centros.filter(function(c) { return !origen || c.id !== origen.id; });
      var opts = mismo ? '' : '<option value="__new__">+ Nuevo centro</option>';
      libres.forEach(function(c) {
        opts += '<option value="' + c.id + '"' + (String(c.id) === String(PAC.targetCentro) ? ' selected' : '') + '>' + (mismo ? 'Pasar a «' : 'Fusionar en «') + esc(c.nombre || 'Sin centro') + '»</option>';
      });
      tcSel.innerHTML = opts;
      if (!libres.some(function(c) { return String(c.id) === String(PAC.targetCentro); })) PAC.targetCentro = mismo ? (libres[0] ? String(libres[0].id) : '__new__') : '__new__';
      tcSel.value = PAC.targetCentro;
    }

    var ok = false, msg = '';
    if (PAC.mode === 'move') {
      if (!PAC.srcSel) msg = 'Elige un doctor o centro en Origen.';
      else if (mismo && PAC.srcSel.tipo !== 'doctor') msg = 'Para mover un centro elige un manager de destino distinto (dentro de un mismo manager solo se mueven doctores).';
      else if (mismo && PAC.targetCentro === '__new__') msg = 'Este manager no tiene otro centro al que pasar al doctor.';
      else { ok = true; msg = mismo ? 'Pasar el doctor al centro elegido (mismo manager).' : 'Mover ' + (PAC.srcSel.tipo === 'doctor' ? 'el doctor' : 'el centro') + ' seleccionado a este manager.'; }
    } else {
      if (!PAC.srcSel) msg = 'Elige un ítem en Origen.';
      else if (!PAC.dstSel) msg = 'Elige un ítem en Destino.';
      else if (PAC.srcSel.tipo !== PAC.dstSel.tipo) msg = 'Deben ser del mismo tipo (doctor↔doctor o centro↔centro).';
      else if (mismo && PAC.srcSel.tipo !== 'doctor') msg = 'Para intercambiar centros elige dos managers distintos (dentro de un mismo manager solo se intercambian doctores).';
      else if (mismo && PAC.srcSel.id === PAC.dstSel.id) msg = 'Elige dos doctores distintos.';
      else { ok = true; msg = mismo ? 'Intercambiar los dos doctores (mismo manager, centros distintos).' : 'Intercambiar ambos elementos seleccionados.'; }
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

  var CV = { areas: [], areaId: null, verDe: null, personas: [] }; // verDe: id de la persona cuyas hojas ve un manager/admin (solo vista)

  // Canvas en el navegador (Rosember, 26-oct-2026): cada persona trabaja su Canvas en SU navegador (IndexedDB, por
  // persona y área) y el servidor guarda una copia de respaldo privada (solo el dueño puede guardar en ella). La primera
  // vez (o si se borraron los datos del navegador) se copian al navegador las hojas del respaldo.
  var CV_IDB = null, cvLocalTimers = {};
  function cvIdb() {
    if (CV_IDB) return CV_IDB;
    CV_IDB = new Promise(function(ok, mal) {
      try {
        var rq = indexedDB.open('ds-canvas', 1);
        rq.onupgradeneeded = function() { rq.result.createObjectStore('hojas'); };
        rq.onsuccess = function() { ok(rq.result); };
        rq.onerror = function() { mal(rq.error); };
      } catch (e) { mal(e); }
    });
    CV_IDB.catch(function() { CV_IDB = null; });
    return CV_IDB;
  }
  function cvClaveLocal(areaId) { return ((window.DS_CFG && window.DS_CFG.userId) || 0) + ':' + areaId; }
  function cvLocalLeer(areaId) {
    return cvIdb().then(function(db) {
      return new Promise(function(ok) {
        var rq = db.transaction('hojas').objectStore('hojas').get(cvClaveLocal(areaId));
        rq.onsuccess = function() { try { var v = JSON.parse(rq.result || 'null'); ok(Array.isArray(v) ? v : null); } catch (e) { ok(null); } };
        rq.onerror = function() { ok(null); };
      });
    }).catch(function() { return null; });
  }
  function cvLocalGuardar() {
    var areaId = CV.areaId, docs = CANVAS.docs;   // la lista de esta área (si cambia de área, se guarda la anterior)
    if (!areaId) return;
    clearTimeout(cvLocalTimers[areaId]);
    cvLocalTimers[areaId] = setTimeout(function() {
      delete cvLocalTimers[areaId];
      var texto; try { texto = JSON.stringify(docs); } catch (e) { return; }
      cvIdb().then(function(db) { db.transaction('hojas', 'readwrite').objectStore('hojas').put(texto, cvClaveLocal(areaId)); }).catch(function() {});
    }, 250);
  }
  // Agrega las hojas del respaldo que no están en el navegador (al deshacer un borrado o si el borrado falló)
  function cvTraerDelServidor(areaId) {
    return api('/design/api/canvas/docs?area_id=' + areaId).then(function(docs) {
      if (areaId !== CV.areaId) return;
      var hay = {}; CANVAS.docs.forEach(function(d) { hay[d.id] = 1; });
      docs.forEach(function(d) { if (!hay[d.id]) CANVAS.docs.push(cvFromServer(d)); });
      cvLocalGuardar();
    });
  }
  var CANVAS = { docs: [], activeId: null, view: "home", selFrame: null, scale: 1, railCollapsed: false };
  var cvSaveTimers = {}, cvGuardando = {};

  // ---------- Áreas ----------
  function cvCargarAreas() {
    CANVAS.homeMode = "board"; // Canvas siempre abre en vista Tablero (se puede cambiar en el momento)
    // Cada equipo ve solo sus áreas (Rosember, 27-oct-2026): N3 no ve N2 ni Face; admins y Support, todas
    Promise.all([window.dsAreas(), api('/design/api/canvas/areas')]).then(function(r) {
      var permiso = r[1] || {todas: true};
      var areas = r[0].filter(function(a) { return permiso.todas || (permiso.ids || []).indexOf(a.id) >= 0; });
      CV.areas = areas;
      var cont = document.getElementById('cvAreaTabs'); cont.innerHTML = '';
      if (!areas.length) {
        document.getElementById("canvasHome").innerHTML = '<div class="cv-empty" style="padding:30px">No perteneces a ningún equipo de Design, así que no hay hojas de Canvas para ti. Pídele a tu manager que te agregue a su equipo.</div>';
        return;
      }
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
    CV.areaId = areaId; CV.verDe = null; CV.personas = [];   // 26-oct-2026: cada quien ve solo sus hojas (sin «Ver hojas de»)
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
    return cvLocalLeer(areaId).then(function(local) {
      if (areaId !== CV.areaId) throw {viejo: true}; // el usuario ya cambió de área
      if (local) {   // lo que hay en el navegador de esta persona
        CANVAS.docs = local.map(function(d) { d.frames = (d.frames || []).map(cvSanear); d.elements = (d.elements || []).map(cvSanear); return d; });
        // Hojas compartidas (26-oct-2026): llegan al respaldo del servidor; las que no están en el navegador se agregan
        cvTraerDelServidor(areaId).then(function() { if (areaId === CV.areaId && CANVAS.view === "home") cvRender(); }, function() {});
        return;
      }
      return api('/design/api/canvas/docs?area_id=' + areaId).then(function(docs) {   // primera vez: copia del respaldo
        if (areaId !== CV.areaId) throw {viejo: true};
        CANVAS.docs = docs.map(cvFromServer);
        cvLocalGuardar();
      });
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
    cvLocalGuardar();   // primero en el navegador; abajo, el respaldo en el servidor
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
        cvLocalGuardar();
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
    cvLocalGuardar();
    if (CANVAS.activeId === id) { CANVAS.view = "home"; CANVAS.activeId = null; }
    cvRender();
    fetch('/design/api/canvas/docs/' + id + '/eliminar', {method: 'POST'})
      .then(function(r) { return r.json().then(function(d) { if (!r.ok) throw new Error(d.detail || 'No se pudo eliminar.'); return d; }); })
      .then(function(r) { cvAvisoDeshacer(nombre, r.papeleraId, areaId); })
      .catch(function(e) { alert(e.message); cvTraerDelServidor(areaId).then(cvRender); });
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
          if (CV.areaId === areaId) cvTraerDelServidor(areaId).then(cvRender);
        })
        .catch(function(e) { cvAviso('<span></span>', false).querySelector('span').textContent = '⚠️ ' + e.message; });
    };
  }
  function cvDuplicateDoc(id) {
    postJSON('/design/api/canvas/docs/' + id + '/duplicar').then(function(r) {
      CANVAS.docs.unshift(cvFromServer(r)); cvLocalGuardar(); cvRender();
    });
  }
  // Limpiar todo (Rosember, 27-oct-2026): en la vista Tablero quita las fotos de los marcos de TODAS las hojas del área para
  // reutilizarlas (como «🧹 Limpiar» de una hoja, pero en todas). Se queda el formato, los marcos y las anotaciones. Pide
  // confirmación y deja «Deshacer» unos segundos, porque no se puede recuperar una foto quitada.
  function cvLimpiarTodo() {
    var conFotos = CANVAS.docs.filter(function(d) { return d.frames.some(function(f) { return f.img; }); });
    var total = conFotos.reduce(function(n, d) { return n + d.frames.filter(function(f) { return f.img; }).length; }, 0);
    if (!total) { cvAviso('<span>No hay fotos para quitar.</span>', false); return; }
    if (!confirm('¿Quitar las ' + total + ' foto' + (total === 1 ? '' : 's') + ' de ' + conFotos.length + ' hoja' + (conFotos.length === 1 ? '' : 's') +
                 '?\n\nLas hojas conservan su formato, sus marcos y sus anotaciones. Podrás deshacerlo en el aviso que aparece abajo.')) return;
    var areaId = CV.areaId;
    var respaldo = conFotos.map(function(d) { return {id: d.id, frames: JSON.stringify(d.frames)}; });
    conFotos.forEach(function(d) {
      d.frames.forEach(function(f) { f.img = null; });
      d.updated = Date_nowSafe(); cvSave(d.id);
    });
    cvRender();
    var v = cvAviso('<span>🧹 Se quitaron ' + total + ' foto' + (total === 1 ? '' : 's') + ' de ' + conFotos.length + ' hoja' + (conFotos.length === 1 ? '' : 's') +
                    '</span><button type="button" class="cv-aviso-btn">Deshacer</button><button type="button" class="cv-aviso-x" title="Cerrar">✕</button>', true);
    v.querySelector('.cv-aviso-x').onclick = function() { v.classList.remove('open'); };
    var btn = v.querySelector('.cv-aviso-btn');
    btn.onclick = function() {
      btn.disabled = true;
      if (CV.areaId !== areaId) { cvAviso('<span>Cambiaste de área: ya no se puede deshacer.</span>', false); return; }
      respaldo.forEach(function(r) {
        var d = CANVAS.docs.find(function(x) { return x.id === r.id; });
        if (!d) return;
        d.frames = JSON.parse(r.frames); d.updated = Date_nowSafe(); cvSave(d.id);
      });
      cvRender(); cvAviso('<span>✅ Fotos restauradas</span>', false);
    };
  }

  // Compartir una copia de la hoja (Rosember, 26-oct-2026): con todos los del área o con una persona. Va solo el formato.
  // Ventana rehecha el 27-oct-2026: dos tarjetas para elegir y, para «Una persona», una lista con buscador, iniciales y equipo.
  function cvCompartir(id) {
    var d = CANVAS.docs.find(function(x) { return x.id === id; }); if (!d) return;
    var bg = document.createElement('div'); bg.className = 'ds-qc-bg';
    bg.innerHTML = '<div class="ds-qc cv-sh" role="dialog" aria-modal="true" aria-labelledby="cvShTit">' +
      '<div class="cv-sh-cab"><span class="cv-sh-ico" aria-hidden="true">⇪</span><div><h4 id="cvShTit">Compartir hoja</h4><div class="cv-sh-hoja" id="cvShHoja"></div></div></div>' +
      '<div class="cv-sh-nota">Se envía una <b>copia con el formato</b>: título, marcos y anotaciones. <b>Las fotos no se comparten</b>: los marcos llegan vacíos.</div>' +
      '<div class="cv-sh-opts" role="radiogroup" aria-label="Con quién compartir">' +
        '<button type="button" class="cv-sh-opt on" role="radio" aria-checked="true" data-modo="area"><span class="cv-sh-opt-i">👥</span><b>Todo mi área</b><small id="cvShN">…</small></button>' +
        '<button type="button" class="cv-sh-opt" role="radio" aria-checked="false" data-modo="uno"><span class="cv-sh-opt-i">👤</span><b>Una persona</b><small>Elige a quién</small></button>' +
      '</div>' +
      '<div class="cv-sh-uno" id="cvShUnoW" hidden>' +
        '<div class="cv-sh-busca"><span aria-hidden="true">🔍</span><input type="search" id="cvShBuscar" placeholder="Buscar por nombre o equipo…" autocomplete="off" aria-label="Buscar persona"></div>' +
        '<div class="cv-sh-lista" id="cvShLista" role="listbox" aria-label="Personas de tu área"></div>' +
      '</div>' +
      '<div class="cv-sh-err" id="cvShErr" role="alert"></div>' +
      '<div class="cv-sh-btns"><button type="button" class="btn gris" data-sh="no">Cancelar</button><button type="button" class="btn" data-sh="si" id="cvShOk">Compartir</button></div></div>';
    document.body.appendChild(bg);
    bg.querySelector('#cvShHoja').textContent = d.name || d.title || 'Hoja';
    var err = bg.querySelector('#cvShErr'), lista = bg.querySelector('#cvShLista'), buscar = bg.querySelector('#cvShBuscar'),
        ok = bg.querySelector('#cvShOk'), unoW = bg.querySelector('#cvShUnoW');
    var gente = [], modo = 'area', elegido = null;
    var norm = function(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); };
    var iniciales = function(n) { var p = String(n || '').trim().split(/\s+/); return ((p[0] || '')[0] || '') + ((p[1] || '')[0] || ''); };
    var primero = function(n) { return String(n || '').trim().split(/\s+/)[0] || ''; };
    var visibles = function() {
      var q = norm(buscar.value.trim());
      return gente.filter(function(p) { return !q || norm(p.nombre + ' ' + p.equipo).indexOf(q) >= 0; });
    };
    var pintarBoton = function() {
      var n = gente.length;
      if (modo === 'area') { ok.textContent = 'Compartir con ' + n + ' persona' + (n === 1 ? '' : 's'); ok.disabled = !n; }
      else { ok.textContent = elegido ? 'Compartir con ' + primero(elegido.nombre) : 'Compartir'; ok.disabled = !elegido; }
    };
    var pintar = function() {
      var vis = visibles();
      lista.innerHTML = vis.length ? vis.map(function(p) {
        return '<button type="button" class="cv-sh-per' + (elegido && elegido.id === p.id ? ' on' : '') + '" role="option" aria-selected="' + (elegido && elegido.id === p.id) + '" data-id="' + p.id + '">' +
          '<span class="cv-sh-av">' + esc(iniciales(p.nombre)) + '</span>' +
          '<span class="cv-sh-per-t"><b>' + esc(p.nombre) + '</b><small>' + esc(p.equipo) + '</small></span><span class="cv-sh-ck" aria-hidden="true">✓</span></button>';
      }).join('') : '<div class="cv-sh-vacio">' + (gente.length ? 'Nadie coincide con «' + esc(buscar.value.trim()) + '».' : 'No hay más personas en tu área.') + '</div>';
      pintarBoton();
    };
    var poner = function(m) {
      modo = m; err.textContent = '';
      bg.querySelectorAll('.cv-sh-opt').forEach(function(b) { var on = b.dataset.modo === m; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
      unoW.hidden = m !== 'uno';
      if (m === 'uno') { pintar(); buscar.focus(); } else pintarBoton();
    };
    api('/design/api/canvas/destinatarios?area_id=' + CV.areaId).then(function(ps) {
      gente = ps || [];
      bg.querySelector('#cvShN').textContent = gente.length + ' persona' + (gente.length === 1 ? '' : 's');
      pintar();
    }, function(e) { err.textContent = 'No se pudo cargar la lista: ' + e.message; });
    var cerrar = function() { bg.remove(); document.removeEventListener('keydown', teclas, true); };
    var enviar = function() {
      if (ok.disabled) return;
      var destino = modo === 'area' ? 'area' : String(elegido.id);
      if (modo === 'area' && !confirm('¿Compartir una copia de esta hoja con las ' + gente.length + ' personas de tu área?')) return;
      ok.disabled = true; err.textContent = '';
      // primero se guarda lo último de la hoja en el respaldo, para que la copia salga al día
      var cuerpo = {nombre: d.name, titulo: d.title, tituloColor: d.titleColor, w: d.w, h: d.h, frames: d.frames, elements: d.elements};
      postJSON('/design/api/canvas/docs/' + d.id, cuerpo)
        .then(function() { return postJSON('/design/api/canvas/docs/' + d.id + '/compartir', {destino: destino}); })
        .then(function(r) {
          cerrar();
          cvAviso('<span>✅ Hoja compartida con ' + (r.enviadas === 1 ? (modo === 'area' ? '1 persona' : esc(elegido.nombre)) : r.enviadas + ' personas') + '</span>', false);
        }, function(x) { pintarBoton(); err.textContent = x.message; });
    };
    var teclas = function(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(); return; }
      if (modo !== 'uno') { if (e.key === 'Enter' && !e.target.closest('button')) { e.preventDefault(); enviar(); } return; }
      var vis = visibles(), i = elegido ? vis.findIndex(function(p) { return p.id === elegido.id; }) : -1;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!vis.length) return;
        elegido = vis[Math.max(0, Math.min(vis.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
        pintar();
        var sel = lista.querySelector('.cv-sh-per.on'); if (sel && sel.scrollIntoView) sel.scrollIntoView({block: 'nearest'});
      } else if (e.key === 'Enter' && e.target === buscar) {
        e.preventDefault();
        if (!elegido && vis.length === 1) { elegido = vis[0]; pintar(); }
        enviar();
      }
    };
    document.addEventListener('keydown', teclas, true);
    buscar.addEventListener('input', function() {
      if (elegido && !visibles().some(function(p) { return p.id === elegido.id; })) elegido = null;
      pintar();
    });
    bg.addEventListener('mousedown', function(e) { if (e.target === bg) cerrar(); });
    bg.addEventListener('click', function(e) {
      var o = e.target.closest('.cv-sh-opt'); if (o) { poner(o.dataset.modo); return; }
      var pe = e.target.closest('.cv-sh-per');
      if (pe) { elegido = gente.find(function(p) { return String(p.id) === pe.dataset.id; }) || null; err.textContent = ''; pintar(); return; }
      var b = e.target.closest('[data-sh]'); if (!b) return;
      if (b.dataset.sh === 'no') cerrar(); else enviar();
    });
    bg.addEventListener('dblclick', function(e) { if (e.target.closest('.cv-sh-per')) enviar(); });
    pintarBoton();
  }
  function cvRenameDoc(id) {
    var d = CANVAS.docs.find(function(x) { return x.id === id; }); if (!d) return;
    var n = (prompt("Nuevo nombre:", d.name) || "").trim(); if (!n) return;
    d.name = n; d.updated = Date_nowSafe();
    cvLocalGuardar();
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
    var verDe = '';
    if (CV.personas.length) {
      verDe = '<label class="cv-verde">Ver hojas de: <select data-cvverde><option value="">Mis hojas</option>' +
        CV.personas.map(function(p) { return '<option value="' + p.id + '"' + (CV.verDe === p.id ? ' selected' : '') + '>' + esc(p.nombre) + '</option>'; }).join('') +
        '</select></label>';
    }
    // Limpiar todo (27-oct-2026): solo en la vista Tablero; quita las fotos de todas las hojas del área
    var fotos = CANVAS.docs.reduce(function(n, d) { return n + d.frames.filter(function(f) { return f.img; }).length; }, 0);
    var limpiar = cur === 'board' && !CV.verDe
      ? '<button class="cv-mini-btn cv-limpiar-todo" data-clearall' + (fotos ? '' : ' disabled') + ' title="' +
        (fotos ? 'Quitar las ' + fotos + ' foto' + (fotos === 1 ? '' : 's') + ' de todas las hojas (el formato y las anotaciones se quedan)' : 'No hay fotos en las hojas') + '">🧹 Limpiar todo' + (fotos ? ' (' + fotos + ')' : '') + '</button>'
      : '';
    // Descargar todo (27-oct-2026): abre la misma ventana que «📚 Todas» del editor para elegir qué hojas bajar en PNG
    var descargar = cur === 'board' ? '<button class="cv-mini-btn cv-descargar-todo" data-cvdescargar' + (CANVAS.docs.length ? '' : ' disabled') +
      ' title="Elegir qué hojas descargar, cada una en PNG">⬇️ Descargar todo</button>' : '';
    return '<div class="cv-home-head"><h3 class="cv-h">Hojas de trabajo</h3>' + verDe + limpiar + descargar +
      '<div class="cv-view-wrap" id="cvViewWrap">' +
        '<button class="cv-mini-btn" data-cvviewtoggle>' + (CV_VIEW_ICON[cur] || '') + ' Vista: ' + esc(curLabel) + ' ▾</button>' +
        '<div class="cv-view-menu"><div class="cv-view-menu-h">Vista de la galería</div>' + items + '</div>' +
      '</div></div>';
  }
  function cvRenderHome() {
    var home = document.getElementById("canvasHome");
    var addCard = CV.verDe ? '' : '<button class="cv-tpl-card cv-new-card" data-newsheet title="Crear una hoja en blanco"><div class="cv-new-plus">＋</div><div class="cv-tpl-name">Nueva hoja personalizada</div><div class="cv-tpl-sub">En blanco, tú la armas</div></button>';
    if (CANVAS.homeMode === "board") {
      var tiles = CANVAS.docs.map(function(d) {
        var filled = d.frames.filter(function(f) { return f.img; }).length;
        return '<div class="cv-board-card" draggable="true" data-bcard="' + d.id + '" title="Arrastra para cambiar el orden">' +
          '<div class="cv-thumb-wrap" data-open="' + d.id + '" tabindex="0" role="button" title="Abrir hoja para editar">' + cvSheetThumb(d, 300) + '</div>' +
          '<button class="cv-board-name" data-open="' + d.id + '">' + esc(d.name || d.title || "Hoja") + '</button>' +
          '<div class="cv-board-sub">' + d.frames.length + ' marco' + (d.frames.length === 1 ? "" : "s") + (filled ? (" · " + filled + " con foto") : "") + '</div>' +
          '<div class="cv-sheet-acts">' +
            '<button class="cv-mini-btn" data-dl="' + d.id + '" title="Descargar esta hoja (imagen PNG)">⬇ Descargar</button>' +
            '<button class="cv-mini-btn" data-share="' + d.id + '" title="Compartir una copia de esta hoja (solo el formato, sin fotos)">⇪ Compartir</button>' +
          '</div>' +
        '</div>';
      }).join('');
      home.innerHTML = cvHomeHeader() + '<div class="cv-board">' + tiles + addCard + '</div>';
      cvBindBoardDrag(home.querySelector(".cv-board"));
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
          '<button class="cv-mini-btn" data-dl="' + d.id + '" title="Descargar esta hoja (imagen PNG)">⬇</button>' +
          '<button class="cv-mini-btn" data-share="' + d.id + '" title="Compartir una copia (solo el formato, sin fotos)">⇪</button>' +
          (CV.verDe ? '' : '<button class="cv-mini-btn" data-dup="' + d.id + '" title="Duplicar">⧉</button>' +
          '<button class="cv-mini-btn" data-ren="' + d.id + '" title="Renombrar">✎</button>' +
          '<button class="cv-mini-btn cv-danger" data-del="' + d.id + '" title="Eliminar">🗑️</button>') +
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
            '<button class="cv-frame-btn" data-fdl="' + f.id + '" title="Descargar solo este marco (PNG, con sus anotaciones)">⬇</button>' +
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
           '<button class="cv-mini-btn" id="cvPdfAllBtn" title="Descargar varias hojas, cada una en su PNG (eliges cuáles)">📚 Todas</button>' : '') +
         '<button class="cv-primary-btn" id="cvExportBtn" title="Exportar como PNG">PNG</button>' +
         '<button class="cv-mini-btn" id="cvShareBtn" title="Compartir una copia de esta hoja con alguien de tu área (solo el formato, sin fotos)">⇪ Compartir</button>' +
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
          '<button data-share="' + d.id + '" title="Compartir una copia (solo el formato, sin fotos)">⇪</button>' +
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
  // despues: la hoja queda a la derecha de la otra (Tablero); sin él, antes (barra de hojas del editor)
  function cvReorderDocs(fromId, toId, despues) {
    var docs = CANVAS.docs;
    var fi = docs.findIndex(function(d) { return String(d.id) === String(fromId); });
    if (fi < 0 || String(fromId) === String(toId)) return;
    var moved = docs.splice(fi, 1)[0];
    var ti = docs.findIndex(function(d) { return String(d.id) === String(toId); });
    if (ti < 0) { docs.splice(fi, 0, moved); return; }
    docs.splice(ti + (despues ? 1 : 0), 0, moved);
    cvLocalGuardar();
    if (CANVAS.view === "editor") cvRenderEditor(); else cvRenderHome();
    postJSON('/design/api/canvas/docs/' + fromId + '/mover', { targetId: parseInt(toId), despues: !!despues });
  }
  // Tablero (Rosember, 27-oct-2026): las hojas se arrastran para cambiar su orden. Una raya marca dónde va a quedar
  // (a la izquierda o a la derecha de la hoja que está debajo del mouse). Soltar fotos sobre los marcos sigue igual.
  function cvBindBoardDrag(board) {
    if (!board) return;
    var dragId = null;
    var limpiar = function() { board.querySelectorAll(".cv-bdrop-antes, .cv-bdrop-despues").forEach(function(x) { x.classList.remove("cv-bdrop-antes", "cv-bdrop-despues"); }); };
    board.querySelectorAll("[data-bcard]").forEach(function(card) {
      card.addEventListener("dragstart", function(e) {
        dragId = card.dataset.bcard; card.classList.add("cv-bdragging");
        if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", "hoja " + dragId); } catch (err) {} }
      });
      card.addEventListener("dragend", function() { card.classList.remove("cv-bdragging"); limpiar(); dragId = null; });
      card.addEventListener("dragover", function(e) {
        if (dragId == null) return;              // una foto desde el escritorio: la maneja el marco
        e.preventDefault(); e.stopPropagation();
        limpiar();
        if (card.dataset.bcard === dragId) return;
        var r = card.getBoundingClientRect();
        card.classList.add(e.clientX > r.left + r.width / 2 ? "cv-bdrop-despues" : "cv-bdrop-antes");
      });
      card.addEventListener("drop", function(e) {
        if (dragId == null) return;
        e.preventDefault(); e.stopPropagation();
        var despues = card.classList.contains("cv-bdrop-despues"), desde = dragId;
        limpiar();
        if (card.dataset.bcard !== desde) cvReorderDocs(desde, card.dataset.bcard, despues);
      });
    });
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
  async function escribirPng(carpeta, nombre, png) {
    var fh = await carpeta.getFileHandle(nombre + ".png", {create: true});
    var w = await fh.createWritable(); await w.write(png); await w.close();
  }
  async function cvSheetPngBlob(doc) {
    var cv = await cvSheetToCanvas(doc);
    return new Promise(function(res) { cv.toBlob(res, "image/png"); });
  }
  async function cvExportPNG(id) {
    var doc = CANVAS.docs.find(function(d) { return d.id === id; }) || cvActiveDoc(); if (!doc) return;
    var cv = await cvSheetToCanvas(doc);
    var a = document.createElement("a");
    a.href = cv.toDataURL("image/png"); a.download = cvSheetFileName(doc) + ".png";
    document.body.appendChild(a); a.click(); a.remove();
  }
  // Descargar un solo marco (foto) con las anotaciones que caen sobre él, sin el resto de la hoja ni el título
  // (pedido por Rosember el 12-oct-2026: en los casos single no se necesita la hoja completa).
  async function cvExportFrame(frameId) {
    var doc = cvActiveDoc(); if (!doc) return;
    var f = doc.frames.find(function(x) { return x.id === frameId; }); if (!f) return;
    var full = await cvSheetToCanvas(Object.assign({}, doc, {title: ""}));   // sin el título de la hoja
    var x = Math.max(0, Math.round(f.x)), y = Math.max(0, Math.round(f.y));
    var w = Math.min(full.width - x, Math.round(f.w)), h = Math.min(full.height - y, Math.round(f.h));
    var cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    cv.getContext("2d").drawImage(full, x, y, w, h, 0, 0, w, h);
    var n = doc.frames.indexOf(f) + 1;
    var a = document.createElement("a");
    a.href = cv.toDataURL("image/png"); a.download = cvSheetFileName(doc) + " - marco " + n + ".png";
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

  // «📚 Todas» (editor, modo experto) y «Descargar todo» (vista Tablero) (Rosember, 27-oct-2026): ventana en el centro con la
  // miniatura de cada hoja; clic en la hoja la marca o desmarca (sin casillas), «Marcar todas» marca todas. Cada hoja se
  // guarda en su propio PNG.
  function cvElegirPngs() {
    if (document.getElementById("cvPngBg") || !CANVAS.docs.length) return;
    var docs = CANVAS.docs.slice(), elegida = docs.map(function() { return false; }), ocupado = false;
    var bg = document.createElement("div"); bg.className = "ds-qc-bg ds-fondo-50"; bg.id = "cvPngBg";
    bg.innerHTML = '<div class="cv-png-pop" role="dialog" aria-modal="true" aria-labelledby="cvPngTit">' +
      '<div class="cv-png-cab"><h3 id="cvPngTit">Descargar hojas en PNG</h3><button type="button" class="cv-png-x" data-cvpng-cerrar title="Cerrar" aria-label="Cerrar">✕</button></div>' +
      '<p class="cv-png-sub">Haz clic en las hojas que quieres descargar. Cada una se guarda en su propio PNG' +
        (window.showDirectoryPicker ? '; si eliges varias, te pide la carpeta donde guardarlas.' : '.') + '</p>' +
      '<div class="cv-png-barra"><button type="button" class="cv-mini-btn" data-cvpng-todas></button><span class="cv-png-cuenta"></span></div>' +
      '<div class="cv-png-grid">' + docs.map(function(d, i) {
        var W = cvDocW(d), H = cvDocH(d);
        return '<button type="button" class="cv-png-card" data-cvpng-i="' + i + '" aria-pressed="false" title="' + esc(d.name || "Hoja " + (i + 1)) + '">' +
          '<span class="cv-png-img" style="aspect-ratio:' + W + ' / ' + H + '"><span class="cv-png-cargando">Cargando…</span></span>' +
          '<span class="cv-png-check" aria-hidden="true">✓</span>' +
          '<span class="cv-png-pie-card"><span class="cv-png-n">' + (i + 1) + '</span><span class="cv-png-nom"><b>' + esc(d.name || "Hoja " + (i + 1)) + '</b>' +
          (d.title ? '<small>' + esc(d.title) + '</small>' : '') + '</span></span></button>';
      }).join("") + '</div>' +
      '<div class="cv-png-pie"><span class="cv-png-estado" aria-live="polite"></span>' +
      '<button type="button" class="cv-mini-btn" data-cvpng-cerrar>Cancelar</button><button type="button" class="cv-primary-btn" data-cvpng-bajar disabled>Descargar</button></div></div>';
    document.body.appendChild(bg);
    var pop = bg.firstChild, todas = pop.querySelector("[data-cvpng-todas]"), bajar = pop.querySelector("[data-cvpng-bajar]");
    var tarjetas = Array.prototype.slice.call(pop.querySelectorAll("[data-cvpng-i]"));
    var contar = function() {
      var n = elegida.filter(Boolean).length;
      tarjetas.forEach(function(t, i) { t.classList.toggle("on", elegida[i]); t.setAttribute("aria-pressed", elegida[i] ? "true" : "false"); });
      todas.textContent = n === docs.length ? "Desmarcar todas" : "Marcar todas";
      pop.querySelector(".cv-png-cuenta").textContent = n + " de " + docs.length + " elegidas";
      bajar.disabled = !n || ocupado; bajar.textContent = n ? "Descargar " + n + " PNG" : "Descargar";
      if (!ocupado) pop.querySelector(".cv-png-estado").textContent = "";
    };
    var cerrar = function() { abierta = false; bg.remove(); document.removeEventListener("keydown", teclas, true); };
    // mientras está abierta, las teclas no llegan al Canvas (← → cambian de hoja, Supr borra); Enter/Espacio sí marcan la hoja
    var teclas = function(e) { e.stopPropagation(); if (e.key === "Escape" && !ocupado) cerrar(); };
    document.addEventListener("keydown", teclas, true);
    todas.addEventListener("click", function() { var t = elegida.filter(Boolean).length !== docs.length; elegida = elegida.map(function() { return t; }); contar(); });
    tarjetas.forEach(function(t, i) { t.addEventListener("click", function() { if (ocupado) return; elegida[i] = !elegida[i]; contar(); }); });
    bg.addEventListener("mousedown", function(e) { if (e.target === bg && !ocupado) cerrar(); });
    pop.addEventListener("click", function(e) { if (e.target.closest("[data-cvpng-cerrar]") && !ocupado) cerrar(); });
    // Miniaturas: la hoja tal como se descarga (fotos, anotaciones y título), una tras otra para no trabar la pantalla
    var abierta = true;
    (async function() {
      for (var i = 0; i < docs.length && abierta; i++) {
        try {
          var cv = await cvSheetToCanvas(docs[i]), k = 320 / Math.max(cv.width, cv.height);
          var mini = document.createElement("canvas"); mini.width = Math.round(cv.width * k); mini.height = Math.round(cv.height * k);
          mini.getContext("2d").drawImage(cv, 0, 0, mini.width, mini.height);
          var caja = tarjetas[i].querySelector(".cv-png-img");
          caja.innerHTML = '<img alt="" src="' + mini.toDataURL("image/png") + '">';
        } catch (e) { tarjetas[i].querySelector(".cv-png-cargando").textContent = "Sin vista previa"; }
      }
    })();
    bajar.addEventListener("click", async function() {
      var elegidas = docs.filter(function(d, i) { return elegida[i]; });
      var estado = pop.querySelector(".cv-png-estado");
      // Varias hojas: el navegador bloquea (o pregunta) las descargas seguidas, así que se pide una carpeta una vez y se
      // guardan todas ahí. Si el navegador no lo permite, se descargan una por una.
      var carpeta = null;
      if (elegidas.length > 1 && window.showDirectoryPicker) {
        try { carpeta = await window.showDirectoryPicker({id: "canvas-png", mode: "readwrite"}); }
        catch (err) { if (err && err.name === "AbortError") { estado.textContent = "Elige una carpeta para guardar las hojas."; return; } }
      }
      ocupado = true; contar();
      // Una hoja que falla no detiene a las demás (28-oct-2026): se anota el motivo y se sigue con la siguiente
      var usados = {}, fallos = [], guardadas = 0;
      for (var i = 0; i < elegidas.length; i++) {
        var nomHoja = (docs.indexOf(elegidas[i]) + 1) + " - " + (cvSheetFileName(elegidas[i]) || "hoja");
        estado.textContent = "Guardando " + (i + 1) + " de " + elegidas.length + "…";
        try {
          if (carpeta) {
            // con el número de la hoja: varias hojas se llaman igual (Upper, Lower…)
            var n = usados[nomHoja] = (usados[nomHoja] || 0) + 1;
            var png = await cvSheetPngBlob(elegidas[i]);
            if (!png) throw new Error("no se pudo generar la imagen de la hoja");
            // Si el archivo con ese nombre cambió en disco mientras se escribía (OneDrive, antivirus, un visor abierto), el
            // navegador da InvalidStateError: se guarda con otro nombre y no se borra nada que ya exista.
            var base = nomHoja + (n > 1 ? " (" + n + ")" : "");
            try { await escribirPng(carpeta, base, png); }
            catch (err1) {
              if (!(err1 && (err1.name === "InvalidStateError" || err1.name === "NoModificationAllowedError"))) throw err1;
              await escribirPng(carpeta, base + " - " + Date.now().toString(36).slice(-4), png);
            }
          } else {
            await cvExportPNG(elegidas[i].id);
            await new Promise(function(r) { setTimeout(r, 400); });
          }
          guardadas++;
        } catch (err) {
          fallos.push(nomHoja + ": " + ((err && (err.name || err.message)) || "error desconocido") + (err && err.name && err.message ? " (" + err.message + ")" : ""));
          console.error("Canvas › descarga PNG:", nomHoja, err);
        }
      }
      if (!fallos.length) {
        cerrar();
        if (carpeta) dsToast(guardadas + " hojas guardadas en la carpeta «" + carpeta.name + "».");
      } else {
        ocupado = false; contar();
        estado.textContent = (guardadas ? guardadas + " guardada(s); " : "") + "no se pudo: " + fallos.join(" · ");
      }
    });
    contar(); todas.focus();
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
    // Un clic afuera cierra el menú de Formas / Líneas; adentro NO (28-oct-2026): al cerrarlo en el mousedown el menú se
    // redibujaba antes del clic y no se podía elegir Círculo, Rectángulo ni las líneas en modo experto.
    if (CANVAS._toolGroup && !e.target.closest(".cv-toolgroup")) { CANVAS._toolGroup = null; cvRenderTools(); }
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
    if (t.closest("[data-cvverde]")) return; // el selector se atiende en su evento change
    if (t.closest("[data-cvviewtoggle]")) { e.stopPropagation(); var w = document.getElementById("cvViewWrap"); if (w) w.classList.toggle("open"); return; }
    var vpick = t.closest("[data-cvview]"); if (vpick) { cvSetView(vpick.dataset.cvview, false); return; }
    var bframe = t.closest("[data-bframe]"); if (bframe) { e.stopPropagation(); cvBoardFrameClick(bframe.dataset.bdoc, bframe.dataset.bframe); return; }
    if (t.closest("[data-clearall]")) { cvLimpiarTodo(); return; }
    if (t.closest("[data-cvdescargar]")) { cvElegirPngs(); return; }
    var dl = t.closest("[data-dl]"); if (dl) { e.stopPropagation(); cvExportPNG(parseInt(dl.dataset.dl)); return; }   // descargar una hoja desde el tablero o la cuadrícula
    if (CV.verDe && t.closest("[data-newsheet], [data-open], [data-ren], [data-dup], [data-del]")) return; // solo vista
    if (t.closest("[data-newsheet]")) { cvNewCustomSheet(); return; }
    var open = t.closest("[data-open]"); if (open) { cvOpenDoc(parseInt(open.dataset.open)); return; }
    var ren = t.closest("[data-ren]"); if (ren) { cvRenameDoc(parseInt(ren.dataset.ren)); return; }
    var dup = t.closest("[data-dup]"); if (dup) { cvDuplicateDoc(parseInt(dup.dataset.dup)); return; }
    var sh = t.closest("[data-share]"); if (sh) { e.stopPropagation(); cvCompartir(parseInt(sh.dataset.share)); return; }
    if (t.closest("#cvShareBtn")) { var d9 = cvActiveDoc(); if (d9) cvCompartir(d9.id); return; }
    var del = t.closest("[data-del]"); if (del) { cvDeleteDoc(parseInt(del.dataset.del)); return; }
    var csz = t.closest('[data-cvsize="apply"]'); if (csz) { var d0 = cvActiveDoc(); var wi = document.getElementById("cvSizeW"), hi = document.getElementById("cvSizeH"); if (d0 && wi && hi) cvApplySize(d0, wi.value, hi.value); return; }
    if (t.closest("#cvBackBtn")) { cvBackHome(); return; }
    if (t.closest("#cvExportBtn")) { var d1 = cvActiveDoc(); if (d1) cvExportPNG(d1.id); return; }
    if (t.closest("#cvCopyBtn")) { cvCopySheet(t.closest("#cvCopyBtn")); return; }
    if (t.closest("#cvPdfBtn")) { var d2 = cvActiveDoc(); if (d2) cvExportPDF([d2], cvSheetFileName(d2) + ".pdf"); return; }
    if (t.closest("#cvPdfAllBtn")) { if (CANVAS.docs.length) cvElegirPngs(); return; }
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
    var fdl = t.closest("[data-fdl]"); if (fdl) { e.stopPropagation(); cvExportFrame(fdl.dataset.fdl); return; }
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
// Protocols (PDF buscables por diapositiva, edición en Nuvia Office) se retiró el 21-oct-2026 (Rosember).
;
(function() {
  var MODULOS = {"pa-sheet":"Pre-Approved · hoja", "pa-centro":"Pre-Approved · centro",
                "pa-doctor":"Pre-Approved · doctor", "pa-fila":"Pre-Approved · criterio", "perf-emp":"Desempeño · persona", "openings-fila":"Openings · fila", "openings-col":"Openings · columna",
                "cv-doc":"Canvas · hoja", "cmt-template":"Comments · plantilla",
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
      list.innerHTML = '<div class="tr-empty">No hay borrados registrados.<br>Cuando alguien elimine algo en Design Schedule (Pre-Approved, Comments, Canvas…), aparecerá aquí para poder restaurarlo.</div>';
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

  // El botón solo existe para admins (el panel Papelera no se dibuja para otros roles).
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
    if (d.puedeGestionar) toolbar.appendChild(pfBotonAgregar());
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
  // ---------- Personas de la hoja (Rosember, 26-oct-2026): aprobadores (su hoja) y admins agregan, renombran y quitan ----------
  function pfBotonAgregar() {
    var w = document.createElement('span'); w.className = 'pf-agregar';
    var b = document.createElement('button'); b.type = 'button'; b.className = 'btn mini'; b.innerText = '+ Agregar persona';
    b.title = 'Agregar una nueva contratación a esta hoja';
    b.onclick = function() {
      w.innerHTML = '';
      var inp = document.createElement('input'); inp.type = 'text'; inp.maxLength = 150; inp.placeholder = 'Nombre completo';
      inp.setAttribute('aria-label', 'Nombre de la persona nueva');
      var ok = document.createElement('button'); ok.type = 'button'; ok.className = 'btn mini'; ok.innerText = 'Agregar';
      var no = document.createElement('button'); no.type = 'button'; no.className = 'btn gris mini'; no.innerText = 'Cancelar';
      var guardar = function() {
        if (!inp.value.trim()) { inp.focus(); return; }
        ok.disabled = true;
        postJSON('/design/api/perf/sheets/' + PF.sheetId + '/personas', {nombre: inp.value}).then(function(r) {
          window.dsToast('✅ ' + r.nombre + ' quedó en la hoja.'); cargarEval();
        }, function(e) { ok.disabled = false; window.dsToast('⚠️ ' + e.message); inp.focus(); });
      };
      ok.onclick = guardar; no.onclick = function() { w.replaceWith(pfBotonAgregar()); };
      inp.onkeydown = function(e) {
        if (e.key === 'Enter') { e.preventDefault(); guardar(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); no.onclick(); }
      };
      w.appendChild(inp); w.appendChild(ok); w.appendChild(no); inp.focus();
    };
    w.appendChild(b);
    return w;
  }
  function pfNombreHtml(emp, ei, d) {
    var h = '<span class="pf-p-nombre">' + esc(emp.nombre) + '</span>';
    if (d.puedeGestionar && emp.editable !== false) {
      h += '<span class="pf-p-acc"><button type="button" data-p-ren="' + ei + '" title="Corregir el nombre" aria-label="Corregir el nombre de ' + esc(emp.nombre) + '">✎</button>' +
           '<button type="button" data-p-del="' + ei + '" title="Quitar de la hoja (queda en la Papelera)" aria-label="Quitar a ' + esc(emp.nombre) + ' de la hoja">🗑</button></span>';
    }
    return h;
  }
  function pfManejarPersona(e, d, repintar) {
    var ren = e.target.closest('[data-p-ren]'), del = e.target.closest('[data-p-del]');
    if (del) {
      var emp = d.empleados[+del.dataset.pDel];
      if (!confirm('¿Quitar a ' + emp.nombre + ' de esta hoja de desempeño?\n\nSus calificaciones quedan en la Papelera 15 días por si hay que restaurarla.')) return;
      postJSON('/design/api/perf/empleados/' + emp.id + '/quitar', {}).then(function() {
        window.dsToast('🗑 ' + emp.nombre + ' salió de la hoja (está en la Papelera).'); cargarEval();
      }, function(x) { window.dsToast('⚠️ ' + x.message); });
      return;
    }
    if (!ren) return;
    var p = d.empleados[+ren.dataset.pRen], caja = ren.closest('.pf-emp-h, .pf-nombre'), nom = caja.querySelector('.pf-p-nombre');
    var inp = document.createElement('input'); inp.type = 'text'; inp.maxLength = 150; inp.value = p.nombre; inp.className = 'pf-p-input';
    inp.setAttribute('aria-label', 'Nombre de ' + p.nombre);
    nom.replaceWith(inp); caja.querySelector('.pf-p-acc').hidden = true; inp.focus(); inp.select();
    var listo = false;
    var guardar = function() {
      if (listo) return; listo = true;
      var v = inp.value.trim();
      if (!v || v === p.nombre) { repintar(); return; }
      postJSON('/design/api/perf/empleados/' + p.id + '/nombre', {nombre: v}).then(function(r) {
        p.nombre = r.nombre; window.dsToast('✅ Nombre actualizado.'); repintar();
      }, function(x) { window.dsToast('⚠️ ' + x.message); repintar(); });
    };
    inp.onkeydown = function(ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); guardar(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); listo = true; repintar(); }
    };
    inp.onblur = guardar;
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
              '<h4 class="pf-emp-h">' + pfNombreHtml(emp, ei, d) + '</h4><div class="pf-anual-wrap"><table class="pf-tabla pf-anual"><colgroup>' + cols + '</colgroup>' + h + '</table></div></div>';
    });
    var cont = document.createElement('div'); cont.innerHTML = html || '<p style="color:#4b5563">Esta hoja no tiene personas.</p>';
    panel.appendChild(cont);
    cont.addEventListener('click', function(e) { pfManejarPersona(e, d, function() { renderEval(d); }); });
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
    tabla.addEventListener('click', function(e) { pfManejarPersona(e, d, function() { renderEval(d); }); });
    d.empleados.forEach(function(emp, ei) {
      var tr = document.createElement('tr');
      var tdNombre = document.createElement('td'); tdNombre.className = 'pf-nombre'; tdNombre.innerHTML = pfNombreHtml(emp, ei, d);
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
      // Categoría editable por el admin (Rosember, 22-oct-2026)
      g += '<tr><td class="pf-nombre">' + (d.ganadoresEditables === false ? esc(w.categoria)
        : '<input class="pf-cat" data-cat="' + wi + '" maxlength="150" value="' + esc(w.categoria) + '" aria-label="Categoría" title="Escribe para cambiar el nombre de la categoría">') + '</td>';
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
      if (el.dataset.cat !== undefined) {   // nombre de la categoría
        var wc = d.ganadores[+el.dataset.cat], txt = el.value.replace(/\s+/g, ' ').trim();
        if (!txt) { el.value = wc.categoria; return; }
        if (txt === wc.categoria) return;
        postJSON('/design/api/perf/ganadores/' + wc.id + '/categoria', {categoria: txt})
          .then(function(r) { wc.categoria = el.value = r.categoria; }).catch(pfFallo(cargarSeleccion));
        return;
      }
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
      var tdCat = document.createElement('td'); tdCat.className = 'pf-nombre';
      if (d.ganadoresEditables === false) tdCat.innerText = g.categoria;
      else {   // categoría editable por el admin (22-oct-2026)
        var ic = document.createElement('input'); ic.className = 'pf-cat'; ic.maxLength = 150; ic.value = g.categoria; ic.setAttribute('aria-label', 'Categoría');
        ic.addEventListener('blur', function() {
          var txt = ic.value.replace(/\s+/g, ' ').trim();
          if (!txt) { ic.value = g.categoria; return; }
          if (txt === g.categoria) return;
          postJSON('/design/api/perf/ganadores/' + g.id + '/categoria', {categoria: txt})
            .then(function(r) { g.categoria = ic.value = r.categoria; }).catch(pfFallo(cargarSeleccion));
        });
        tdCat.appendChild(ic);
      }
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

  // ---------- Selección asistida (Rosember, 21-oct-2026; solo admin) ----------
  // Analiza el mes (por defecto el anterior, que ya cerró) y propone: Manager del mes, Empleado del mes N2/Face, N3/N6,
  // otro de N3/N6 y MVP, con el porqué de cada uno. El cálculo está en services_design_seleccion.py. No guarda nada.
  var PF_MESES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  function pfSelOpciones() {
    var hoy = new Date(), out = [];
    for (var i = 0; i <= 6; i++) {
      var d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
      out.push({anio: d.getFullYear(), mes: d.getMonth() + 1, l: PF_MESES_L[d.getMonth()] + ' ' + d.getFullYear() + (i === 0 ? ' (en curso)' : (i === 1 ? ' (mes anterior)' : ''))});
    }
    return out;
  }
  function pfSelAbrir() {
    var box = document.getElementById('pfSel');
    if (!box) return;
    if (!box.hidden) { box.hidden = true; return; }
    box.hidden = false;
    var ops = pfSelOpciones();
    box.innerHTML = '<div class="pf-sel-cab"><h3>🏆 Selección asistida</h3>' +
      '<label>Mes <select id="pfSelMes">' + ops.map(function(o, i) { return '<option value="' + o.anio + '-' + o.mes + '"' + (i === 1 ? ' selected' : '') + '>' + o.l + '</option>'; }).join('') + '</select></label>' +
      '<button type="button" class="btn mini" id="pfSelIr">Analizar</button>' +
      '<button type="button" class="btn mini gris" id="pfSelCfgBtn" aria-expanded="false">⚙️ Configuración</button></div>' +
      '<div id="pfSelCfg" class="pf-sel-cfg" hidden></div>' +
      '<div id="pfSelRes"><p class="dd-p-nota">Elige el mes y presiona «Analizar».</p></div>';
    document.getElementById('pfSelIr').onclick = pfSelAnalizar;
    document.getElementById('pfSelCfgBtn').onclick = pfSelConfig;
  }
  // Configuración de porcentajes (Rosember, 22-oct-2026): dos grupos (diseñadores y managers), cada uno suma 100 %.
  // Un criterio en 0 % no cuenta. «Restablecer» vuelve a los de fábrica (sin guardar hasta que se presione Guardar).
  function pfSelConfig() {
    var box = document.getElementById('pfSelCfg'), btn = document.getElementById('pfSelCfgBtn');
    if (!box.hidden) { box.hidden = true; btn.setAttribute('aria-expanded', 'false'); return; }
    box.hidden = false; btn.setAttribute('aria-expanded', 'true');
    box.innerHTML = '<p class="dd-p-nota">Cargando…</p>';
    api('/design/api/perf/seleccion-asistida/config').then(function(c) { pfSelCfgPintar(box, c); })
      .catch(function(e) { box.innerHTML = '<p class="dd-p-nota" style="color:#b91c1c"></p>'; box.firstChild.textContent = e.message; });
  }
  function pfSelCfgPintar(box, c) {
    var e = function(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function(x) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[x]; }); };
    var grupo = function(g, titulo, vals) {
      return '<fieldset class="pf-sel-cfg-g" data-g="' + g + '"><legend>' + titulo + ' · <span class="pf-sel-suma"></span></legend>' +
        Object.keys(vals).map(function(k) {
          var ay = (c.ayuda && c.ayuda[g] && c.ayuda[g][k]) || '';   // qué representa el criterio (tooltip)
          // burbuja propia (22-oct-2026): el title del navegador tardaba o no salía; esta aparece al pasar el mouse o al tocar
          return '<label><span>' + e(c.nombres[k]) + (ay ? ' <i class="pf-sel-ay" tabindex="0" role="note" aria-label="' + e(ay) + '">ⓘ<b class="pf-sel-tip">' + e(ay) + '</b></i>' : '') +
            '</span><input type="number" min="0" max="100" step="1" data-k="' + k + '" value="' + vals[k] + '"> %</label>';
        }).join('') + '</fieldset>';
    };
    box.innerHTML = '<div class="pf-sel-cfg-grid">' + grupo('disenador', 'Diseñadores', c.disenador) + grupo('manager', 'Managers', c.manager) + '</div>' +
      '<p class="dd-p-nota">Cada grupo debe sumar 100 %. Un criterio en 0 % no se tiene en cuenta. Los cambios aplican al próximo «Analizar».</p>' +
      '<div class="pf-sel-cfg-acc"><button type="button" class="btn mini" data-a="guardar">Guardar</button>' +
      '<button type="button" class="btn mini gris" data-a="fabrica">Restablecer los de fábrica</button></div>';
    var sumar = function() {
      var ok = true;
      box.querySelectorAll('fieldset').forEach(function(f) {
        var t = 0; f.querySelectorAll('input').forEach(function(i) { t += +i.value || 0; });
        var s = f.querySelector('.pf-sel-suma'); s.textContent = 'suma ' + t + ' %'; s.classList.toggle('mal', t !== 100);
        if (t !== 100) ok = false;
      });
      box.querySelector('[data-a="guardar"]').disabled = !ok;
    };
    box.addEventListener('input', sumar);
    box.querySelector('[data-a="fabrica"]').onclick = function() {
      ['disenador', 'manager'].forEach(function(g) {
        box.querySelectorAll('fieldset[data-g="' + g + '"] input').forEach(function(i) { i.value = c.fabrica[g][i.dataset.k]; });
      });
      sumar();
    };
    box.querySelector('[data-a="guardar"]').onclick = function() {
      var datos = {};
      box.querySelectorAll('fieldset').forEach(function(f) {
        var g = datos[f.dataset.g] = {}; f.querySelectorAll('input').forEach(function(i) { g[i.dataset.k] = +i.value || 0; });
      });
      var b = this; b.disabled = true; b.textContent = 'Guardando…';
      window.dsFetchJSON('/design/api/perf/seleccion-asistida/config', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(datos)})
        .then(function(c2) { pfSelCfgPintar(box, c2); var p = document.createElement('p'); p.className = 'pf-sel-ok'; p.textContent = '✔ Porcentajes guardados.'; box.appendChild(p); })
        .catch(function(er) { b.disabled = false; b.textContent = 'Guardar'; alert(er.message); });
    };
    sumar();
  }
  function pfSelAnalizar() {
    var v = document.getElementById('pfSelMes').value.split('-'), res = document.getElementById('pfSelRes');
    res.innerHTML = '<p class="dd-p-nota">Analizando las estadísticas del mes…</p>';
    Promise.all([api('/design/api/perf/seleccion-asistida?anio=' + v[0] + '&mes=' + v[1]),
                 api('/design/api/perf/seleccion-asistida/destinos?anio=' + v[0] + '&mes=' + v[1]).catch(function() { return {categorias: []}; })])
      .then(function(r) { r[0].destinos = r[1]; pfSelPintar(r[0], res); })
      .catch(function(e) { res.innerHTML = '<p class="dd-p-nota" style="color:#b91c1c"></p>'; res.firstChild.textContent = 'No se pudo analizar: ' + e.message; });
  }
  function pfSelPintar(d, res) {
    var e = function(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function(c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]; }); };
    var pesos = function(t) { var p = d.pesos[t]; return Object.keys(p).map(function(k) { return d.nombres[k] + ' ' + p[k] + ' %'; }).join(' · '); };
    var h = (d.enCurso ? '<p class="pf-sel-aviso">⚠️ El mes aún no termina: es una prueba con los datos hasta hoy (' + e(d.hasta) + ').</p>' : '') +
      '<p class="dd-p-nota">Periodo ' + e(d.desde) + ' a ' + e(d.hasta) + ' · ' + d.habiles + ' días hábiles. Puntaje 0-100: cada indicador se compara con el resto de su área (percentil) y se pondera. ' +
      'Compiten quienes tuvieron al menos ' + Math.round(d.reglas.minFraccionDias * 100) + ' % de días disponibles y ' + d.reglas.minAprobadas + ' casos aprobados.</p>';
    // Postulados (22-oct-2026): cada manager postula a su empleado del mes en la hoja de Selección; si ya hay, solo ellos compiten
    var po = d.postulados || {};
    h += po.activo
      ? '<details class="pf-sel-no"><summary>🏅 Compiten los ' + po.total + ' postulados de los managers este mes (su puntaje es su posición frente a toda su área)</summary><ul>' +
        po.lista.map(function(x) { return '<li>' + e(x.nombre) + ' <small>' + e(x.area) + '</small>' + (x.por ? ' — postulado por ' + e(x.por) : '') + '</li>'; }).join('') + '</ul></details>'
      : '<p class="pf-sel-aviso">Aún no hay postulados este mes en la hoja de Selección: se muestran todos los diseñadores (prueba).</p>';
    h += '<p class="dd-p-nota">' + (po.managersCalificados ? 'Manager del mes: compiten los ' + po.managersCalificados + ' managers calificados este mes en DESIGN MANAGERS.'
      : 'Manager del mes: aún no hay calificaciones en DESIGN MANAGERS este mes, se muestran todos los managers.') + '</p>';
    h += '<div class="pf-sel-grid">' + d.categorias.map(function(c) {
      var g = c.candidatos[0];
      if (!g) return '<div class="pf-sel-card"><h4>' + e(c.titulo) + '</h4><p class="dd-p-nota">Sin candidatos con datos suficientes.</p></div>';
      var extra = c.tipo === 'manager' ? e(g.area) + ' · ' + e(g.equipos.join(', ')) : e(g.area) + (g.postuladoPor ? ' · postulado por ' + e(g.postuladoPor) : '');
      return '<div class="pf-sel-card" data-clave="' + c.clave + '"><h4>' + e(c.titulo) + '</h4><div class="pf-sel-gan"><b>' + e(g.nombre) + '</b><span class="pf-sel-pts">' + g.puntaje + '</span></div>' +
        '<div class="pf-sel-sub">' + extra + '</div>' +
        (g.porQue.fuertes.length ? '<ul class="pf-sel-pq">' + g.porQue.fuertes.map(function(x) { return '<li>✅ ' + e(x) + '</li>'; }).join('') + '</ul>' : '') +
        (g.porQue.mejorar.length ? '<ul class="pf-sel-pq">' + g.porQue.mejorar.map(function(x) { return '<li>⚠️ ' + e(x) + '</li>'; }).join('') + '</ul>' : '') +
        (g.faltan.length ? '<p class="pf-sel-falta">Sin dato de: ' + e(g.faltan.join(', ')) + ' (su peso se repartió)</p>' : '') +
        '<div class="pf-sel-elegir"><button type="button" class="btn mini" data-elegir="0">✔ Elegir a ' + e(g.nombre.split(' ')[0]) + '</button><span class="pf-sel-eleg-res"></span></div>' +
        (c.candidatos.length > 1 ? '<details><summary>Siguientes</summary><ol start="' + ((c.posicion || 1) + 1) + '">' + c.candidatos.slice(1).map(function(x, j) {
          return '<li>' + e(x.nombre) + ' <small>' + e(x.area) + '</small> — <b>' + x.puntaje + '</b> <button type="button" class="pf-sel-eleg-mini" data-elegir="' + (j + 1) + '">Elegir</button></li>';
        }).join('') + '</ol></details>' : '') +
        '</div>';
    }).join('') + '</div>';
    h += '<p class="dd-p-nota">Pesos de diseñadores: ' + e(pesos('disenador')) + '.<br>Pesos de managers: ' + e(pesos('manager')) + '.</p>';
    // Carga de trabajo: cada caso vale los minutos estándar de su producto (mediana real), así se comparan áreas con
    // casos fáciles y muchos (Face) contra áreas con casos complejos y menos (N3 / N6)
    if (d.complejidad && d.complejidad.length) h += '<p class="dd-p-nota">Carga de trabajo por caso este mes (minutos estándar promedio): ' +
      d.complejidad.map(function(c) { return e(c.area) + ' ' + c.minutos + ' min'; }).join(' · ') + '. Un caso de un área compleja vale más que uno de un área de casos más rápidos.</p>';
    if (d.noCompiten.length) h += '<details class="pf-sel-no"><summary>No compiten este mes (' + d.noCompiten.length + ')</summary><ul>' +
      d.noCompiten.map(function(x) { return '<li>' + e(x.nombre) + ' <small>' + e(x.area) + '</small>: ' + e(x.motivo) + '</li>'; }).join('') + '</ul></details>';
    res.innerHTML = h;
    res.onclick = function(ev) { var b = ev.target.closest('[data-elegir]'); if (b) pfSelElegir(d, b); };
  }
  // Elegir (Rosember, 22-oct-2026): lo elegido se registra en la tabla «Empleado del mes» de la hoja de Selección, en la
  // columna del mes analizado. Se propone la categoría que corresponde (MVP → la fila MVP, etc.) y se puede cambiar.
  function pfSelSugerida(clave, persona, cats, usados) {
    var n = function(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); };
    var con = function(pal) { return cats.filter(function(c) { return pal.some(function(p) { return n(c.categoria).indexOf(p) >= 0; }); }); };
    var lista = clave === 'mvp' ? con(['mvp']) : clave === 'manager' ? con(['manager', 'lider', 'líder'])
      : clave === 'n2face' ? (n(persona.area).indexOf('face') >= 0 ? con(['face']) : con(['n2'])).concat(con(['n2', 'face']))
      : con(['n3', 'n6']);
    if (clave === 'n3n6b') lista = lista.slice(1).concat(lista.slice(0, 1));   // el «otro» va en la segunda fila de N3/N6
    var libre = lista.filter(function(c) { return usados.indexOf(c.id) < 0; });
    return (libre[0] || lista[0] || cats[0] || {}).id;
  }
  function pfSelElegir(d, b) {
    var card = b.closest('.pf-sel-card'), clave = card.dataset.clave, cat = d.categorias.find(function(c) { return c.clave === clave; });
    var persona = cat.candidatos[+b.dataset.elegir], des = d.destinos || {categorias: []};
    var e = function(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function(c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]; }); };
    var out = card.querySelector('.pf-sel-eleg-res');
    if (!des.categorias.length) { out.textContent = 'No hay una hoja de Selección con la columna de ese mes.'; return; }
    d._usados = d._usados || [];
    var sug = pfSelSugerida(clave, persona, des.categorias, d._usados);
    var viejo = card.querySelector('.pf-sel-eleg-form'); if (viejo) viejo.remove();
    var f = document.createElement('div'); f.className = 'pf-sel-eleg-form';
    f.innerHTML = '<label>Registrar a <b>' + e(persona.nombre) + '</b> en ' + e(des.hoja) + ' · ' + e(des.etiqueta) + ':</label>' +
      '<select>' + des.categorias.map(function(c) { return '<option value="' + c.id + '"' + (c.id === sug ? ' selected' : '') + '>' + e(c.categoria) + (c.actual ? ' (hoy: ' + e(c.actual) + ')' : '') + '</option>'; }).join('') + '</select>' +
      '<button type="button" class="btn mini">Registrar</button><button type="button" class="btn mini gris">Cancelar</button>';
    card.querySelector('.pf-sel-elegir').after(f);
    f.querySelector('.gris').onclick = function() { f.remove(); };
    f.querySelector('.btn:not(.gris)').onclick = function() {
      var id = +f.querySelector('select').value, c = des.categorias.find(function(x) { return x.id === id; });
      if (c.actual && c.actual !== persona.nombre && !confirm('«' + c.categoria + '» ya tiene a ' + c.actual + ' en ' + des.etiqueta + '. ¿Reemplazarlo por ' + persona.nombre + '?')) return;
      var bt = this; bt.disabled = true;
      window.dsFetchJSON('/design/api/perf/ganadores/' + id, {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({mesIndice: des.mesIndice, nombre: persona.nombre})}).then(function() {
        c.actual = persona.nombre; if (d._usados.indexOf(id) < 0) d._usados.push(id);
        f.remove(); out.textContent = '✔ Registrado en «' + c.categoria + '» (' + des.etiqueta + ')'; out.classList.add('ok');
        // si la hoja de Selección está abierta abajo, se actualiza sola (Rosember, 22-oct-2026: había que recargar)
        if (PF.sheetId === des.sheetId) cargarSeleccion();
      }).catch(function(er) { bt.disabled = false; alert(er.message); });
    };
  }
  var pfSelBtn = document.getElementById('pfSelBtn');
  if (pfSelBtn) pfSelBtn.addEventListener('click', pfSelAbrir);

})();
;
(function() {
  window.DS_PANELS = window.DS_PANELS || {};

  var DS_PANELES_GESTION = ['dashboard', 'perf', 'papelera', 'seguimiento'];
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
    document.dispatchEvent(new Event('ds:asignaciones'));   // número de casos asignados en la barra (asignaciones.js)
    try {
      var url = new URL(location.href);
      url.searchParams.set('panel', id);
      history.replaceState(null, '', url);
    } catch (e) {}
    dsActualizarPestana();
  }
  var dsFocoPrevio = null;
  function dsCerrarPaneles() {
    var habiaPanel = !!document.querySelector('.ds-overlay.open');
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
    if (habiaPanel && window.dsEntrada) window.dsEntrada();   // volver al Schedule cuenta como ingresar: saludo y contadores
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
    var titulo = panel ? (base + ' ' + det.trim()).trim() : (h1.dataset.pestana || (base + ' ' + det.trim()).trim());   // el Schedule muestra un saludo
    if (titulo && document.title !== titulo) document.title = titulo;
  }
  window.dsActualizarPestana = dsActualizarPestana;
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

// Managers y admins: elegir de quién ver las hojas de Canvas (solo vista).
document.addEventListener('change', function(e) {
  var sel = e.target && e.target.closest && e.target.closest('[data-cvverde]');
  if (!sel) return;
  var cv = window.dsCanvasVerDe; if (cv) cv(sel.value ? parseInt(sel.value, 10) : null);
});
