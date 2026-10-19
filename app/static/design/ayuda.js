/* Solicitar ayuda (19-oct-2026): un aprobador de N3 pide un diseñador libre a los demás aprobadores de N3.
   Aquí vive todo lo de pantalla:
   - el botón «Solicitar ayuda» y el estado de la solicitud en Seguimiento › Diseñadores;
   - el aviso con la selección de diseñadores libres para el aprobador que debe responder (llega también por push);
   - Dashboard › Ayudas (solo admins): si los aprobadores siguen la sugerencia del sistema.
   Datos: /design/api/ayuda/* (services_design_ayuda). Se actualiza por el aviso en vivo {t:'ayuda'}. */
(function() {
  'use strict';
  if (window.DSAyuda) return;
  var est = null, tok = 0, vistos = {}, modal = null, urlId = null, previaSolicitud = null, timer = null;
  try { urlId = parseInt(new URLSearchParams(location.search).get('ayuda')) || null; } catch (e) {}

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; }); }
  function api(url, cuerpo) {
    return fetch(url, {method: cuerpo === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: cuerpo === undefined ? {} : {'Content-Type': 'application/json'},
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo)})
      .catch(function() { throw new Error('Se perdió la conexión con el servidor. Intenta de nuevo.'); })
      .then(function(r) {
        return r.json().catch(function() { return {}; }).then(function(d) {
          if (!r.ok) throw new Error(typeof d.detail === 'string' ? d.detail : 'Error ' + r.status);
          return d;
        });
      });
  }
  function aviso(txt) { if (window.dsToast) window.dsToast(txt); else alert(txt); }
  function hora(iso) { return new Date(iso).toLocaleTimeString('es-CO', {timeZone: 'America/Bogota', hour: 'numeric', minute: '2-digit', hour12: true}); }
  function hace(iso) { var m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)); return m < 1 ? 'ahora' : 'hace ' + m + ' min'; }

  // ---------- Estado ----------
  function cargar() {
    var mio = ++tok;
    return api('/design/api/ayuda/estado').then(function(d) {
      if (mio !== tok) return;
      var antes = previaSolicitud;
      est = d; previaSolicitud = d.solicitud ? {id: d.solicitud.id, estado: d.solicitud.estado} : null;
      // el solicitante se entera de que ya eligieron a alguien
      if (antes && d.solicitud && antes.id === d.solicitud.id && antes.estado === 'abierta' && d.solicitud.estado === 'atendida') {
        aviso('✅ ' + d.solicitud.elegido + ' fue enviado a tu equipo. Ya lo puedes asignar en tu Schedule.');
        document.dispatchEvent(new CustomEvent('ds:vivo', {detail: {t: 'dia', team: 0}}));   // el Schedule abierto recarga su lista de diseñadores
      }
      pintarSeguimiento(); revisarPendientes();
    }).catch(function() {}).then(function() {
      clearTimeout(timer); timer = setTimeout(cargar, (window.DSVivo && window.DSVivo.conectado) ? 90000 : 20000);
    });
  }

  // ---------- Seguimiento: botón y estado de mi solicitud ----------
  function panelSeg() { return document.getElementById('ov-seguimiento'); }
  function enDisenadores() { var p = panelSeg(), b = p && p.querySelector('.sg-vista.on'); return !b || b.dataset.vista === 'disenadores'; }
  function pintarSeguimiento() {
    var btn = document.getElementById('sgAyuda'), caja = document.getElementById('sgAyudaEstado');
    if (!btn || !caja) return;
    var puede = !!(est && est.puedeSolicitar), s = est && est.solicitud, abierta = !!(s && s.estado === 'abierta');
    btn.hidden = !puede || !enDisenadores();
    btn.disabled = abierta; btn.title = abierta ? 'Ya tienes una solicitud abierta' : 'Pide un diseñador libre a los demás aprobadores de N3';
    var txt = '', cls = '';
    if (puede && enDisenadores() && s) {
      if (s.estado === 'abierta') { txt = '⏳ Esperando respuesta de los aprobadores… vence a las ' + hora(s.vence) + ' <button type="button" class="btn gris mini" id="sgAyudaCancelar">Cancelar solicitud</button>'; cls = 'espera'; }
      else if (s.estado === 'atendida') { txt = '✅ <b>' + esc(s.elegido) + '</b> fue enviado a tu equipo. Asígnalo en tu Schedule: aparece en Diseñador como «' + esc(s.elegido) + ' (ayuda)».'; cls = 'ok'; }
      else if (s.estado === 'sin_disponibles') { txt = '⚠️ ' + esc(s.mensaje || 'No hay diseñadores disponibles. Contacta al manager General.'); cls = 'mal'; }
      else if (s.estado === 'vencida') { txt = 'La solicitud venció sin respuesta. Puedes volver a pedir ayuda o contactar al manager General.'; cls = 'mal'; }
    }
    caja.hidden = !txt; caja.className = 'ay-estado ' + cls; caja.innerHTML = txt;
    var c = document.getElementById('sgAyudaCancelar');
    if (c) c.onclick = function() {
      c.disabled = true;
      api('/design/api/ayuda/' + s.id + '/cancelar', {}).then(function() { aviso('Solicitud cancelada.'); cargar(); }).catch(function(e) { aviso('⚠️ ' + e.message); cargar(); });
    };
  }
  function solicitar() {
    var btn = document.getElementById('sgAyuda'); if (btn) btn.disabled = true;
    return api('/design/api/ayuda/solicitar', {}).then(function(r) {
      aviso(r.sinDisponibles ? '⚠️ ' + r.mensaje : (r.ya ? r.mensaje : '🤝 ' + r.mensaje));
      return cargar();
    }).catch(function(e) { aviso('⚠️ ' + e.message); return cargar(); });
  }
  function engancharSeguimiento() {
    var btn = document.getElementById('sgAyuda'); if (!btn) return;
    btn.addEventListener('click', solicitar);
    var p = panelSeg();
    p.addEventListener('click', function(e) { if (e.target.closest('.sg-vista')) setTimeout(pintarSeguimiento, 0); });
  }

  // ---------- Aprobador que responde: aviso con la selección ----------
  function cerrarModal() { if (modal) { modal.remove(); modal = null; } document.removeEventListener('keydown', teclas, true); }
  function teclas(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); posponer(); } }
  function posponer() { if (modal && modal.dataset.id) vistos[modal.dataset.id] = true; cerrarModal(); pintarPildora(); }
  function revisarPendientes() {
    var p = (est && est.pendientes) || [];
    if (modal) { var vivo = p.some(function(x) { return String(x.id) === modal.dataset.id; }); if (!vivo) { cerrarModal(); } else return; }
    var nuevo = p.filter(function(x) { return !vistos[x.id]; });
    var pedido = urlId && p.filter(function(x) { return x.id === urlId; })[0];
    if (pedido) { urlId = null; abrir(pedido); return; }
    if (nuevo.length) abrir(nuevo[0]);
    pintarPildora();
  }
  function pintarPildora() {
    var p = (est && est.pendientes) || [], el = document.getElementById('ayPildora');
    if (!p.length || modal) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('button'); el.type = 'button'; el.id = 'ayPildora'; el.className = 'ay-pildora';
      el.onclick = function() { var q = (est && est.pendientes) || []; if (q.length) abrir(q[0]); };
      document.body.appendChild(el);
    }
    el.innerHTML = '🤝 ' + p.length + ' pedido' + (p.length === 1 ? '' : 's') + ' de ayuda por responder';
  }
  function abrir(s) {
    cerrarModal();
    var bg = document.createElement('div'); bg.className = 'ds-qc-bg'; bg.dataset.id = s.id; modal = bg;
    var libres = s.libres.map(function(x) {
      var sug = x.id === s.sugeridoId;
      return '<button type="button" class="ds-prest-item ay-op" data-id="' + x.id + '" data-nombre="' + esc(x.nombre) + '" aria-pressed="false">🎨 <b>' + esc(x.nombre) + '</b>' +
        '<span class="ay-casos">' + x.casos + ' caso' + (x.casos === 1 ? '' : 's') + ' en el mes</span>' + (sug ? '<span class="ay-sug" title="El sistema sugiere al que menos casos lleva en el mes">Sugerido</span>' : '') + '</button>';
    }).join('');
    bg.innerHTML = '<div class="ds-qc ay-modal" role="dialog" aria-modal="true" aria-labelledby="ayTit"><h4 id="ayTit">🤝 ' + esc(s.solicitante) + ' pide ayuda</h4>' +
      '<div class="ds-qc-sub">Equipo ' + esc(s.equipo) + ' · pedido ' + hace(s.creada) + ' · vence a las ' + hora(s.vence) + '<br>Elige cuál de tus diseñadores libres envías:</div>' +
      '<div class="ds-prest-lista" id="ayLista">' + libres + '</div><p class="ay-error" id="ayError" hidden></p>' +
      '<div class="ds-qc-btns"><button type="button" class="btn gris" id="ayAhoraNo">Ahora no</button><button type="button" class="btn" id="ayEnviar" disabled>Enviar</button></div></div>';
    document.body.appendChild(bg); document.addEventListener('keydown', teclas, true);
    var sel = null, enviar = bg.querySelector('#ayEnviar'), err = bg.querySelector('#ayError');
    bg.querySelectorAll('.ay-op').forEach(function(b) {
      b.onclick = function() {
        bg.querySelectorAll('.ay-op').forEach(function(o) { o.classList.remove('on'); o.setAttribute('aria-pressed', 'false'); });
        b.classList.add('on'); b.setAttribute('aria-pressed', 'true'); sel = +b.dataset.id;
        enviar.disabled = false; enviar.textContent = 'Enviar a ' + b.dataset.nombre;
      };
    });
    bg.querySelector('#ayAhoraNo').onclick = posponer;
    enviar.onclick = function() {
      enviar.disabled = true; err.hidden = true;
      api('/design/api/ayuda/' + s.id + '/elegir', {empleadoId: sel}).then(function(r) {
        cerrarModal(); aviso('✅ ' + r.nombre + ' fue enviado al equipo de ' + s.solicitante + '.'); cargar();
      }).catch(function(e) { err.textContent = e.message; err.hidden = false; enviar.disabled = false; cargar(); });
    };
    var primero = bg.querySelector('.ay-op'); if (primero) primero.focus();
    pintarPildora();
  }

  // ---------- Dashboard › Ayudas (solo admins) ----------
  var DY = {tok: 0};
  function dyKpi(n, t, extra) { return '<div class="dd-kpi' + (extra ? ' ' + extra : '') + '"><b>' + n + '</b><span>' + t + '</span></div>'; }
  var ESTADOS = {atendida: 'Atendida', sin_disponibles: 'Sin disponibles', vencida: 'Venció', cancelada: 'Cancelada', abierta: 'Abierta'};
  function dyIniciar() {
    var d = document.getElementById('dyDesde'), h = document.getElementById('dyHasta');
    if (!d.value || !h.value) {
      var hoy = new Date(), p = function(n) { return String(n).padStart(2, '0'); };
      d.value = hoy.getFullYear() + '-' + p(hoy.getMonth() + 1) + '-01';
      h.value = hoy.getFullYear() + '-' + p(hoy.getMonth() + 1) + '-' + p(new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate());
    }
    dyCargar();
  }
  function dyCargar() {
    var mio = ++DY.tok, t = document.getElementById('dyTabla'), a = document.getElementById('dyAprobadores');
    t.style.opacity = '.5';
    api('/design/api/dashboard/ayudas?desde=' + document.getElementById('dyDesde').value + '&hasta=' + document.getElementById('dyHasta').value).then(function(r) {
      if (mio !== DY.tok) return;
      var k = r.kpis;
      document.getElementById('dyKpis').innerHTML = dyKpi(k.total, 'solicitudes') + dyKpi(k.atendidas, 'atendidas') +
        dyKpi(k.pctSiguieron == null ? '—' : k.pctSiguieron + '%', 'siguieron la sugerencia', k.pctSiguieron != null && k.pctSiguieron < 50 ? 'alerta' : '') +
        dyKpi(k.noSiguieron, 'no la siguieron') + dyKpi(k.sinDisponibles, 'sin diseñadores disponibles', k.sinDisponibles ? 'alerta' : '') + dyKpi(k.sinRespuesta, 'sin respuesta o canceladas');
      a.innerHTML = '<thead><tr><th class="dd-izq">Aprobador</th><th>Envíos</th><th>Siguió la sugerencia</th><th>%</th></tr></thead><tbody>' +
        (r.porAprobador.length ? r.porAprobador.map(function(x) {
          return '<tr><td class="dd-izq"><b>' + esc(x.nombre) + '</b></td><td>' + x.atendidas + '</td><td>' + x.siguio + ' de ' + x.atendidas + '</td><td><b>' + x.pct + '%</b></td></tr>';
        }).join('') : '<tr><td colspan="4" style="color:#4b5563">Todavía no hay envíos en este periodo.</td></tr>') + '</tbody>';
      t.innerHTML = '<thead><tr><th>Fecha</th><th>Hora</th><th>Solicitó</th><th>Equipo</th><th>Estado</th><th>Libres</th><th>Sugerido</th><th>Enviado</th><th>Lo envió</th><th>¿Siguió?</th><th>Respuesta</th></tr></thead><tbody>' +
        (r.items.length ? r.items.map(function(x) {
          return '<tr><td>' + esc(x.fecha) + '</td><td>' + esc(x.hora) + '</td><td class="dd-izq">' + esc(x.solicitante) + '</td><td>' + esc(x.equipo) + '</td><td>' + (ESTADOS[x.estado] || esc(x.estado)) + '</td>' +
            '<td>' + x.libres + ' (' + x.aprobadores + ' aprob.)</td><td>' + esc(x.sugerido || '—') + '</td><td>' + esc(x.elegido || '—') + '</td><td>' + esc(x.elegidoPor || '—') + '</td>' +
            '<td>' + (x.siguio == null ? '—' : x.siguio ? '<b style="color:#15803d">✔ Sí</b>' : '<b style="color:#b91c1c">✘ No</b>') + '</td><td>' + (x.respuestaMin == null ? '—' : x.respuestaMin + ' min') + '</td></tr>';
        }).join('') : '<tr><td colspan="11" style="color:#4b5563">No hay solicitudes en este periodo.</td></tr>') + '</tbody>';
    }).catch(function(e) { t.innerHTML = '<tbody><tr><td style="color:#b91c1c">No se pudo cargar: ' + esc(e.message) + '</td></tr></tbody>'; })
      .then(function() { t.style.opacity = ''; });
  }
  window.dyIniciar = dyIniciar;

  // ---------- Arranque ----------
  window.DSAyuda = {solicitar: solicitar, recargar: cargar};
  document.addEventListener('ds:vivo', function(e) { var a = e.detail || {}; if (a.t === 'ayuda' || a.t === 'reconectado') cargar(); });
  document.addEventListener('visibilitychange', function() { if (!document.hidden) cargar(); });
  function iniciar() {
    engancharSeguimiento();
    var d = document.getElementById('dyDesde'), h = document.getElementById('dyHasta');
    if (d && h) { d.onchange = h.onchange = dyCargar; }
    cargar();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
