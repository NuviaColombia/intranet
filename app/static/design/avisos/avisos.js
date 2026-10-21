// Centro de avisos (Cliq) · Rosember, 20-oct-2026. Mensajes (qué, cuándo, a dónde), Grupos (canales y personas) e
// Historial (qué se envió y qué respondió Cliq). Servidor: routers/design_avisos.py y services_design_avisos.py.
(function() {
  'use strict';
  var D = null, editando = null, vistaT = null;
  var dl = document.createElement('datalist'); dl.id = 'avPersonas'; document.body.appendChild(dl);   // correos para «+ Persona»
  var DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  var ORIGEN = {auto: 'Automático', manual: 'Enviado a mano', prueba: 'Prueba', reintento: 'Reintento'};
  var $ = function(id) { return document.getElementById(id); };
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function(c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; }); }

  function api(url, cuerpo) {
    var op = {credentials: 'same-origin'};
    if (cuerpo !== undefined) op = {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(cuerpo || {})};
    return fetch(url, op).then(function(r) {
      return r.json().catch(function() { return {}; }).then(function(d) {
        if (!r.ok) throw new Error(d.detail || 'No se pudo (error ' + r.status + ').');
        return d;
      });
    });
  }
  function aviso(txt, mal) {
    var t = document.createElement('div');
    t.className = 'av-toast' + (mal ? ' mal' : '');
    t.textContent = txt;
    document.body.appendChild(t);
    setTimeout(function() { t.classList.add('fuera'); }, 3200);
    setTimeout(function() { t.remove(); }, 3800);
  }
  function cuando(iso) {
    try { return new Date(iso).toLocaleString('es-CO', {timeZone: 'America/Bogota', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit'}); }
    catch (e) { return iso; }
  }
  function nombrePersona(email) {
    var p = (D.personas || []).find(function(x) { return x.email.toLowerCase() === String(email).toLowerCase(); });
    return p ? p.nombre : email;
  }
  // Formato de Cliq: *negrita*, _cursiva_, {@correo} = @mención
  function cliqHtml(t, vars) {
    var h = esc(t);
    if (vars) h = h.replace(/\{(\w+)\}/g, function(m, k) { return D.variables.some(function(v) { return v.k === k; }) ? '<span class="av-v" title="Se llena al enviar">' + k + '</span>' : m; });
    return h.replace(/\{@([^}\s]+)\}/g, function(_, e) { return '<span class="av-mencion">@' + esc(nombrePersona(e)) + '</span>'; })
      .replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/(^|\s)_([^_\n]+)_/g, '$1<i>$2</i>').replace(/\n/g, '<br>');
  }
  function resultados(res) {
    var mal = res.filter(function(r) { return !r.ok; });
    if (!res.length) return aviso('No había a quién enviarlo.', true);
    if (mal.length) aviso('✘ ' + mal.map(function(r) { return destinoTxt(r.tipo, r.destino) + ': ' + r.detalle; }).join(' · '), true);
    else aviso('✔ Enviado a ' + res.map(function(r) { return destinoTxt(r.tipo, r.destino); }).join(', '));
  }
  function destinoTxt(tipo, valor) { return tipo === 'persona' ? '@' + nombrePersona(valor) : '#' + valor; }

  // ---------- Carga ----------
  function cargar(d) {
    D = d;
    var c = $('avConexion');
    c.className = 'av-conexion ' + (d.conexion.configurado ? 'ok' : 'mal');
    c.textContent = d.conexion.configurado ? 'Conectado a Cliq · bot ' + d.conexion.bot : 'Sin conexión: falta el token de Cliq en Render';
    $('avCantMsg').textContent = d.mensajes.length;
    $('avCantGrp').textContent = d.grupos.length;
    pintarMensajes();
    pintarGrupos();
    var f = $('avHistFiltro'), v = f.value;
    f.innerHTML = '<option value="">Todos</option>' + d.mensajes.map(function(m) { return '<option value="' + m.id + '">' + esc(m.nombre) + '</option>'; }).join('');
    f.value = v;
    $('avBots').innerHTML = d.bots.map(function(b) { return '<option value="' + esc(b) + '">'; }).join('');
    $('avPersonas').innerHTML = d.personas.map(function(p) { return '<option value="' + esc(p.email) + '">' + esc(p.nombre) + '</option>'; }).join('');
  }
  function recargar() { return api('/design/api/avisos').then(cargar).catch(function(e) { aviso(e.message, true); }); }

  // ---------- Pestañas ----------
  document.querySelectorAll('.av-tab').forEach(function(b) {
    b.addEventListener('click', function() { abrirTab(b.dataset.tab); });
  });
  function abrirTab(t) {
    document.querySelectorAll('.av-tab').forEach(function(b) { var on = b.dataset.tab === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    document.querySelectorAll('.av-panel').forEach(function(p) { p.hidden = p.dataset.panel !== t; });
    if (t === 'historial') cargarHistorial();
    try { localStorage.setItem('avTab', t); } catch (e) { /* sin almacenamiento */ }
  }

  // ---------- Mensajes ----------
  function pintarMensajes() {
    var el = $('avMensajes');
    if (!D.mensajes.length) { el.innerHTML = '<div class="av-vacio">Todavía no hay mensajes. Crea el primero con <b>+ Nuevo mensaje</b>.</div>'; return; }
    el.innerHTML = D.mensajes.map(function(m) {
      var grupos = m.grupos.map(function(id) { return D.grupos.find(function(g) { return g.id === id; }); }).filter(Boolean);
      var ult = m.ultimo ? '<span class="' + (m.ultimo.ok ? 'av-ok' : 'av-mal') + '">' + (m.ultimo.ok ? '✔' : '✘') + ' Último envío: ' + esc(cuando(m.ultimo.en)) + '</span>' : '<span class="av-gris">Aún no se ha enviado</span>';
      return '<article class="av-card' + (m.activo ? '' : ' pausado') + '" data-id="' + m.id + '">' +
        '<div class="av-card-cab"><h3>' + esc(m.nombre) + (m.sistema ? ' <span class="av-tag" title="La plataforma ya lo enviaba antes del Centro: se puede pausar y editar, no eliminar">De la plataforma</span>' : '') + '</h3>' +
        '<label class="av-sw" title="' + (m.activo ? 'Activo: se envía solo' : 'Pausado: no se envía solo') + '"><input type="checkbox" data-a="activo"' + (m.activo ? ' checked' : '') + '><span></span>' + (m.activo ? 'Activo' : 'Pausado') + '</label></div>' +
        '<div class="av-linea">🕘 ' + esc(m.descripcion) + '</div>' +
        '<div class="av-linea">📍 ' + (grupos.length ? grupos.map(function(g) { return '<span class="av-chip">' + esc(g.nombre) + '</span>'; }).join(' ') : '<span class="av-mal">Sin grupos: no se envía a nadie</span>') + '</div>' +
        '<div class="av-muestra">' + cliqHtml(m.texto, true) + '</div>' +
        '<div class="av-card-pie">' + ult + '<span class="av-acc">' +
          '<button type="button" class="av-btn" data-a="editar">Editar</button>' +
          '<button type="button" class="av-btn" data-a="enviar" title="Enviar ya a sus grupos">Enviar ahora</button>' +
          '<button type="button" class="av-btn" data-a="duplicar">Duplicar</button>' +
          (m.sistema ? '' : '<button type="button" class="av-btn peligro" data-a="eliminar">Eliminar</button>') +
        '</span></div></article>';
    }).join('');
  }
  $('avMensajes').addEventListener('click', function(ev) {
    var b = ev.target.closest('[data-a]'), card = ev.target.closest('.av-card');
    if (!b || !card || b.tagName === 'INPUT') return;
    var m = D.mensajes.find(function(x) { return x.id === +card.dataset.id; });
    if (b.dataset.a === 'editar') abrirEditor(m);
    else if (b.dataset.a === 'enviar') {
      if (!confirm('¿Enviar «' + m.nombre + '» ahora a sus grupos?')) return;
      b.disabled = true;
      api('/design/api/avisos/mensajes/' + m.id + '/enviar', {prueba: false}).then(function(d) { resultados(d.resultados); recargar(); })
        .catch(function(e) { aviso(e.message, true); }).then(function() { b.disabled = false; });
    } else if (b.dataset.a === 'duplicar') {
      api('/design/api/avisos/mensajes/' + m.id + '/duplicar', {}).then(function(d) {
        cargar(d); aviso('✔ Copia creada (en pausa). Edítala y actívala.');
        abrirEditor(D.mensajes.find(function(x) { return x.id === d.guardado; }));
      }).catch(function(e) { aviso(e.message, true); });
    } else if (b.dataset.a === 'eliminar') {
      if (!confirm('¿Eliminar el mensaje «' + m.nombre + '»? El historial se conserva.')) return;
      api('/design/api/avisos/mensajes/' + m.id + '/eliminar', {}).then(function(d) { cargar(d); aviso('✔ Mensaje eliminado.'); }).catch(function(e) { aviso(e.message, true); });
    }
  });
  $('avMensajes').addEventListener('change', function(ev) {
    if (ev.target.dataset.a !== 'activo') return;
    var id = +ev.target.closest('.av-card').dataset.id;
    api('/design/api/avisos/mensajes/' + id + '/activo', {activo: ev.target.checked}).then(function(d) { cargar(d); aviso(ev.target.checked ? '✔ Activado.' : '✔ En pausa: no se enviará solo.'); })
      .catch(function(e) { aviso(e.message, true); recargar(); });
  });

  // ---------- Editor de mensaje ----------
  var DISP_TXT = {turno_support: 'Al empezar cada turno de Support', cambio_support: 'El día del cambio de turno', programado: 'Programado', manual: 'Solo a mano'};
  function abrirEditor(m) {
    editando = m ? JSON.parse(JSON.stringify(m)) : {id: null, nombre: '', activo: true, bot: '', texto: '', disparador: 'manual', progTipo: 'una',
                                                   progFecha: '', progHora: '08:00', progDias: [0, 1, 2, 3, 4], saltarFestivos: true, grupos: [], sistema: ''};
    $('avModalTit').textContent = m ? 'Editar mensaje' : 'Nuevo mensaje';
    $('avNombre').value = editando.nombre;
    $('avTexto').value = editando.texto;
    $('avBot').value = editando.bot;
    $('avBot').placeholder = D.conexion.bot;
    $('avFecha').value = editando.progFecha;
    $('avHora').value = editando.progHora;
    $('avHora2').value = editando.progHora || '07:00';
    $('avFestivos').checked = editando.saltarFestivos;
    $('avVars').innerHTML = '<span class="av-gris">Insertar:</span> ' + D.variables.map(function(v) {
      return '<button type="button" class="av-var" data-v="' + v.k + '" title="' + esc(v.l) + '">{' + v.k + '}</button>';
    }).join('');
    pintarDisp();
    pintarGruposSel();
    $('avModalRes').textContent = '';
    $('avModal').hidden = false;
    document.body.classList.add('av-con-modal');
    vistaPrevia();
    setTimeout(function() { $(m ? 'avTexto' : 'avNombre').focus(); }, 30);
  }
  function cerrarEditor() { $('avModal').hidden = true; document.body.classList.remove('av-con-modal'); editando = null; }
  $('avCerrar').addEventListener('click', cerrarEditor);
  $('avModal').addEventListener('click', function(ev) { if (ev.target === $('avModal')) cerrarEditor(); });
  document.addEventListener('keydown', function(ev) { if (ev.key === 'Escape' && editando) cerrarEditor(); });
  $('avNuevoMsg').addEventListener('click', function() { abrirEditor(null); });

  function pintarDisp() {
    var e = editando, el = $('avDisp');
    var opciones = e.sistema ? [e.disparador] : Object.keys(DISP_TXT);
    el.innerHTML = opciones.map(function(k) { return '<button type="button" data-v="' + k + '" class="' + (k === e.disparador ? 'on' : '') + '">' + DISP_TXT[k] + '</button>'; }).join('');
    var nota = $('avDispNota');
    nota.hidden = !e.sistema && e.disparador !== 'turno_support' && e.disparador !== 'cambio_support';
    nota.textContent = e.disparador === 'turno_support' ? 'Sale a la hora de inicio de cada turno (Parámetros › Support Time), solo los días de Support.'
      : e.disparador === 'cambio_support' ? 'Sale el día en que las dos personas de Support intercambian turno, a la hora que elijas.' : '';
    $('avProg').hidden = e.disparador !== 'programado';
    $('avHoraCambio').hidden = e.disparador !== 'cambio_support';
    $('avFestivosCampo').hidden = !(e.disparador === 'turno_support' || (e.disparador === 'programado' && e.progTipo === 'semanal'));
    document.querySelectorAll('#avProgTipo button').forEach(function(b) { b.classList.toggle('on', b.dataset.v === e.progTipo); });
    $('avFechaCampo').hidden = e.progTipo !== 'una';
    $('avDias').hidden = e.progTipo !== 'semanal';
    $('avDias').innerHTML = DIAS.map(function(d, i) {
      return '<button type="button" data-d="' + i + '" class="' + (e.progDias.indexOf(i) >= 0 ? 'on' : '') + '">' + d + '</button>';
    }).join('');
  }
  $('avDisp').addEventListener('click', function(ev) { var b = ev.target.closest('button'); if (!b) return; editando.disparador = b.dataset.v; pintarDisp(); });
  $('avProgTipo').addEventListener('click', function(ev) { var b = ev.target.closest('button'); if (!b) return; editando.progTipo = b.dataset.v; pintarDisp(); });
  $('avDias').addEventListener('click', function(ev) {
    var b = ev.target.closest('button'); if (!b) return;
    var d = +b.dataset.d, i = editando.progDias.indexOf(d);
    if (i >= 0) editando.progDias.splice(i, 1); else editando.progDias.push(d);
    pintarDisp();
  });
  function pintarGruposSel() {
    var el = $('avGruposSel');
    if (!D.grupos.length) { el.innerHTML = '<span class="av-mal">No hay grupos.</span> <button type="button" class="av-link" data-ir="grupos">Crear un grupo</button>'; return; }
    el.innerHTML = D.grupos.map(function(g) {
      var n = g.destinos.length;
      return '<label class="av-check"><input type="checkbox" value="' + g.id + '"' + (editando.grupos.indexOf(g.id) >= 0 ? ' checked' : '') + '> ' + esc(g.nombre) +
        ' <span class="av-gris">(' + n + (n === 1 ? ' destino' : ' destinos') + ')</span></label>';
    }).join('') + '<button type="button" class="av-link" data-ir="grupos">Administrar grupos</button>';
  }
  $('avGruposSel').addEventListener('click', function(ev) {
    if (ev.target.dataset.ir) { cerrarEditor(); abrirTab('grupos'); }
  });
  $('avVars').addEventListener('click', function(ev) {
    var b = ev.target.closest('.av-var'); if (!b) return;
    var ta = $('avTexto'), ins = '{' + b.dataset.v + '}', a = ta.selectionStart, z = ta.selectionEnd;
    ta.value = ta.value.slice(0, a) + ins + ta.value.slice(z);
    ta.focus(); ta.selectionStart = ta.selectionEnd = a + ins.length;
    vistaPrevia();
  });
  $('avTexto').addEventListener('input', function() { clearTimeout(vistaT); vistaT = setTimeout(vistaPrevia, 350); });
  function vistaPrevia() {
    var texto = $('avTexto').value;
    $('avVistaBot').textContent = ($('avBot').value.trim() || D.conexion.bot);
    if (!texto.trim()) { $('avVista').innerHTML = '<span class="av-gris">Escribe el texto para ver cómo queda.</span>'; return; }
    api('/design/api/avisos/vista-previa', {texto: texto}).then(function(d) { if (editando) $('avVista').innerHTML = cliqHtml(d.texto); })
      .catch(function() { $('avVista').innerHTML = cliqHtml(texto); });
  }
  $('avBot').addEventListener('input', vistaPrevia);
  function datosEditor() {
    var e = editando;
    return {id: e.id, nombre: $('avNombre').value, activo: e.activo, bot: $('avBot').value, texto: $('avTexto').value, disparador: e.disparador,
            progTipo: e.progTipo, progFecha: $('avFecha').value, progHora: e.disparador === 'cambio_support' ? $('avHora2').value : $('avHora').value,
            progDias: e.progDias, saltarFestivos: $('avFestivos').checked,
            grupos: [].map.call($('avGruposSel').querySelectorAll('input:checked'), function(i) { return +i.value; })};
  }
  function guardarEditor() {
    var b = $('avGuardar'); b.disabled = true;
    return api('/design/api/avisos/mensajes', datosEditor()).then(function(d) {
      cargar(d);
      editando.id = d.guardado;
      return d.guardado;
    }).finally(function() { b.disabled = false; });
  }
  $('avGuardar').addEventListener('click', function() {
    guardarEditor().then(function() { cerrarEditor(); aviso('✔ Mensaje guardado.'); }).catch(function(e) { $('avModalRes').textContent = '✘ ' + e.message; });
  });
  $('avPrueba').addEventListener('click', function() {
    var b = $('avPrueba'); $('avModalRes').textContent = 'Guardando y enviando…';
    guardarEditor().then(function(id) {
      b.disabled = true;
      return api('/design/api/avisos/mensajes/' + id + '/enviar', {prueba: true});
    }).then(function(d) {
      var r = d.resultados[0] || {};
      $('avModalRes').textContent = r.ok ? '✔ Te llegó por mensaje directo del bot. Ya quedó guardado.' : '✘ ' + (r.detalle || 'No se pudo.');
      recargar();
    }).catch(function(e) { $('avModalRes').textContent = '✘ ' + e.message; }).then(function() { b.disabled = false; });
  });

  // ---------- Grupos ----------
  // 20-oct-2026 (Rosember: «¿cómo veo cuántos hay agregados?»): cada grupo muestra la lista de destinos con su número;
  // abajo, una sola fila para agregar. «Guardar cambios» solo se activa cuando hay algo sin guardar.
  function pintarGrupos() {
    var el = $('avGrupos');
    if (el.querySelector('.av-card.sucio')) return;   // hay un grupo con cambios sin guardar: no se pierde lo escrito
    if (!D.grupos.length) { el.innerHTML = '<div class="av-vacio">Todavía no hay grupos. Crea uno con <b>+ Nuevo grupo</b>.</div>'; return; }
    el.innerHTML = '';
    D.grupos.forEach(function(g) { el.appendChild(tarjetaGrupo(g)); });
  }
  function resumenDest(lista) {
    var c = lista.filter(function(d) { return d.tipo !== 'persona'; }).length, p = lista.length - c, partes = [];
    if (c) partes.push(c + (c === 1 ? ' canal' : ' canales'));
    if (p) partes.push(p + (p === 1 ? ' persona' : ' personas'));
    return partes.join(' · ');
  }
  function pintarDests(c) {
    var lista = c._destinos, ul = c.querySelector('.av-dests');
    c.querySelector('.av-dest-cant').textContent = lista.length;
    c.querySelector('.av-dest-res').textContent = resumenDest(lista);
    // etiquetas compactas, una al lado de la otra (Rosember, 20-oct-2026: «que se vayan agrupando para ahorrar espacio»)
    ul.innerHTML = lista.length ? lista.map(function(d, i) {
      var persona = d.tipo === 'persona', nombre = persona ? nombrePersona(d.valor) : d.valor;
      return '<li class="av-dest-item' + (d.nuevo ? ' nuevo' : '') + '" title="' + esc(persona ? 'Persona: ' + d.valor : 'Canal de Cliq: ' + d.valor) + '">' +
        '<span class="av-dest-ico">' + (persona ? '@' : '#') + '</span><span class="av-dest-txt">' + esc(nombre) + '</span>' +
        '<button type="button" class="av-dest-b" data-a="probar" data-i="' + i + '" title="Enviar un mensaje de prueba solo aquí" aria-label="Probar ' + esc(nombre) + '">✉</button>' +
        '<button type="button" class="av-dest-b quitar" data-a="quitar" data-i="' + i + '" title="Quitar de este grupo" aria-label="Quitar ' + esc(nombre) + '">✕</button></li>';
    }).join('') : '<li class="av-dest-vacio">Todavía no hay destinos. Agrega un canal o una persona abajo.</li>';
    var b = c.querySelector('[data-a="guardar"]'), sucio = c.classList.contains('sucio');
    b.disabled = !sucio;
    b.textContent = sucio ? 'Guardar cambios' : 'Guardado ✓';
  }
  function marcarSucio(c) { c.classList.add('sucio'); pintarDests(c); }
  function tarjetaGrupo(g) {
    var c = document.createElement('article');
    c.className = 'av-card av-grupo';
    c.dataset.id = g.id || '';
    c._destinos = (g.destinos || []).map(function(d) { return {tipo: d.tipo, valor: d.valor}; });
    c.innerHTML = '<div class="av-card-cab"><input type="text" class="av-titulo-inp" data-c="nombre" maxlength="120" placeholder="Nombre del grupo, ej. Managers N3" aria-label="Nombre del grupo"></div>' +
      '<div class="av-linea av-gris">' + (g.usos && g.usos.length ? 'Lo usan: ' + g.usos.map(esc).join(', ') : 'Ningún mensaje lo usa todavía') + '</div>' +
      '<div class="av-dest-tit">Destinos <span class="av-cant av-dest-cant"></span> <span class="av-gris av-dest-res"></span></div>' +
      '<ul class="av-dests"></ul>' +
      '<div class="av-agregar"><select data-c="tipo" aria-label="Tipo de destino"><option value="canal">Canal #</option><option value="persona">Persona @</option></select>' +
        '<input type="text" data-c="nuevo" maxlength="200" aria-label="Canal o correo">' +
        '<button type="button" class="av-btn" data-a="agregar">Agregar</button></div>' +
      '<div class="av-card-pie"><span class="av-acc">' +
        (g.id ? '<button type="button" class="av-btn peligro" data-a="eliminar">Eliminar grupo</button>' : '<button type="button" class="av-btn" data-a="cancelar">Cancelar</button>') + '</span>' +
        '<span class="av-acc"><span class="av-sucio">Cambios sin guardar</span><button type="button" class="av-btn prim" data-a="guardar">Guardar cambios</button></span></div>';
    c.querySelector('[data-c="nombre"]').value = g.nombre || '';
    var sel = c.querySelector('[data-c="tipo"]'), inp = c.querySelector('[data-c="nuevo"]');
    function ajustar() {
      var p = sel.value === 'persona';
      inp.placeholder = p ? 'Correo de Zoho de la persona' : 'Unique Name del canal, ej. supportnuviacolombiacom';
      if (p) inp.setAttribute('list', 'avPersonas'); else inp.removeAttribute('list');
    }
    sel.addEventListener('change', ajustar);
    inp.addEventListener('keydown', function(ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); if (agregar(c) && c._destinos.some(function(x) { return x.nuevo; })) guardarGrupo(c, null); }
    });
    ajustar();
    if (!g.id) c.classList.add('sucio');
    pintarDests(c);
    return c;
  }
  function agregar(c, callado) {
    var sel = c.querySelector('[data-c="tipo"]'), inp = c.querySelector('[data-c="nuevo"]');
    var tipo = sel.value, valor = inp.value.trim().replace(/^[#@]+/, '').trim();
    if (!valor) { if (!callado) { aviso('Escribe el canal o el correo.', true); inp.focus(); } return true; }
    if (tipo === 'persona' && valor.indexOf('@') < 0) { aviso('Para una persona escribe su correo de Zoho.', true); inp.focus(); return false; }
    if (tipo === 'canal' && /\s/.test(valor)) { aviso('El Unique Name del canal no lleva espacios.', true); inp.focus(); return false; }
    if (c._destinos.some(function(d) { return d.tipo === tipo && d.valor.toLowerCase() === valor.toLowerCase(); })) {
      aviso('Ya está en este grupo.', true); inp.select(); return false;
    }
    c._destinos.push({tipo: tipo, valor: valor, nuevo: true});
    inp.value = '';
    marcarSucio(c);
    inp.focus();
    return true;
  }
  $('avNuevoGrp').addEventListener('click', function() {
    var el = $('avGrupos');
    if (el.querySelector('.av-vacio')) el.innerHTML = '';
    var c = tarjetaGrupo({id: null, nombre: '', destinos: [], usos: []});
    el.insertBefore(c, el.firstChild);
    c.querySelector('[data-c="nombre"]').focus();
  });
  $('avGrupos').addEventListener('input', function(ev) {
    var c = ev.target.closest('.av-card');
    if (c && ev.target.dataset.c === 'nombre') marcarSucio(c);
  });
  $('avGrupos').addEventListener('click', function(ev) {
    var b = ev.target.closest('[data-a]'), c = ev.target.closest('.av-card');
    if (!b || !c) return;
    var a = b.dataset.a, id = c.dataset.id ? +c.dataset.id : null;
    if (a === 'agregar') { if (agregar(c) && c._destinos.some(function(x) { return x.nuevo; })) guardarGrupo(c, b); }
    else if (a === 'quitar') {
      var q = c._destinos[+b.dataset.i];
      if (q && !q.nuevo && !confirm('¿Quitar ' + destinoTxt(q.tipo, q.valor) + ' de este grupo?')) return;
      c._destinos.splice(+b.dataset.i, 1); marcarSucio(c); guardarGrupo(c, b);
    } else if (a === 'probar') {
      var d = c._destinos[+b.dataset.i];
      b.disabled = true;
      api('/design/api/avisos/probar-destino', {tipo: d.tipo, valor: d.valor}).then(function(r) {
        aviso(r.ok ? '✔ Llegó a ' + destinoTxt(d.tipo, d.valor) : '✘ ' + destinoTxt(d.tipo, d.valor) + ': ' + r.detalle, !r.ok);
      }).catch(function(e) { aviso(e.message, true); }).then(function() { b.disabled = false; });
    } else if (a === 'cancelar') {
      c.remove(); if (!$('avGrupos').children.length) pintarGrupos();
    } else if (a === 'eliminar') {
      var g = D.grupos.find(function(x) { return x.id === id; });
      var uso = g && g.usos.length ? '\nLo usan: ' + g.usos.join(', ') + '. Esos mensajes dejarán de enviarse a este grupo.' : '';
      if (!confirm('¿Eliminar el grupo «' + (g ? g.nombre : '') + '»?' + uso)) return;
      api('/design/api/avisos/grupos/' + id + '/eliminar', {}).then(function(d) { c.remove(); cargar(d); aviso('✔ Grupo eliminado.'); }).catch(function(e) { aviso(e.message, true); });
    } else if (a === 'guardar') guardarGrupo(c, b);
  });

  // Guarda el grupo: con «Guardar cambios» y también solo, al agregar o quitar un destino (Rosember, 20-oct-2026)
  function guardarGrupo(c, b) {
    var id = c.dataset.id ? +c.dataset.id : null;
    if (!c.querySelector('[data-c="nombre"]').value.trim()) {
      aviso('Escribe primero el nombre del grupo; se guarda con él.', true);
      c.querySelector('[data-c="nombre"]').focus();
      return;
    }
    if (!agregar(c, true)) return;   // lo que quedó escrito en «Agregar» también se guarda
    c.querySelector('[data-a="guardar"]').disabled = true;
    var destinos = c._destinos.map(function(d) { return {tipo: d.tipo, valor: d.valor}; });
    api('/design/api/avisos/grupos', {id: id, nombre: c.querySelector('[data-c="nombre"]').value, destinos: destinos}).then(function(d) {
      c.classList.remove('sucio');
      if ($('avGrupos').querySelector('.av-card.sucio')) {   // otro grupo tiene cambios: este se queda como está, ya guardado
        var nom = c.querySelector('[data-c="nombre"]').value.trim().toLowerCase();
        var g2 = d.grupos.find(function(x) { return x.nombre.toLowerCase() === nom; });
        if (g2) c.dataset.id = g2.id;
        c._destinos.forEach(function(x) { delete x.nuevo; });
        pintarDests(c);
      } else if (!id) c.remove();   // el nuevo vuelve a salir, ya guardado, al repintar
      cargar(d);
      aviso('✔ Grupo guardado: ' + (destinos.length ? resumenDest(destinos) : 'sin destinos') + '.');
    }).catch(function(e) { aviso(e.message, true); pintarDests(c); });
  }

  // ---------- Historial ----------
  function cargarHistorial() {
    var f = $('avHistFiltro').value, tb = $('avHist').querySelector('tbody');
    tb.innerHTML = '<tr><td colspan="6" class="av-gris">Cargando…</td></tr>';
    api('/design/api/avisos/historial' + (f ? '?mensaje_id=' + f : '')).then(function(filas) {
      if (!filas.length) { tb.innerHTML = '<tr><td colspan="6" class="av-gris">Todavía no hay envíos.</td></tr>'; return; }
      tb.innerHTML = filas.map(function(e) {
        return '<tr class="' + (e.ok ? '' : 'mal') + '"><td>' + esc(cuando(e.en)) + '</td><td>' + esc(e.mensaje) + '</td>' +
          '<td>' + esc(destinoTxt(e.tipo, e.destino)) + (e.grupo ? '<div class="av-gris">' + esc(e.grupo) + '</div>' : '') + '</td>' +
          '<td>' + (e.ok ? '<span class="av-ok">✔ Enviado</span>' : '<span class="av-mal">✘ ' + esc(e.detalle) + '</span>') + '</td>' +
          '<td>' + esc(ORIGEN[e.origen] || e.origen) + '<div class="av-gris">' + esc(e.por) + '</div></td>' +
          '<td class="av-td-acc"><button type="button" class="av-btn" data-ver="' + e.id + '">Ver texto</button>' +
          (e.ok ? '' : '<button type="button" class="av-btn" data-reintentar="' + e.id + '">Reintentar</button>') + '</td></tr>' +
          '<tr class="av-hist-txt" data-txt="' + e.id + '" hidden><td colspan="6"><div class="av-muestra">' + cliqHtml(e.texto) + '</div></td></tr>';
      }).join('');
    }).catch(function(e) { tb.innerHTML = '<tr><td colspan="6" class="av-mal">' + esc(e.message) + '</td></tr>'; });
  }
  $('avHistFiltro').addEventListener('change', cargarHistorial);
  $('avHistRecargar').addEventListener('click', cargarHistorial);
  $('avHist').addEventListener('click', function(ev) {
    var v = ev.target.dataset.ver, r = ev.target.dataset.reintentar;
    if (v) { var t = $('avHist').querySelector('[data-txt="' + v + '"]'); t.hidden = !t.hidden; ev.target.textContent = t.hidden ? 'Ver texto' : 'Ocultar'; }
    if (r) {
      ev.target.disabled = true;
      api('/design/api/avisos/historial/' + r + '/reintentar', {}).then(function(x) { aviso(x.ok ? '✔ Enviado.' : '✘ ' + x.detalle, !x.ok); cargarHistorial(); })
        .catch(function(e) { aviso(e.message, true); ev.target.disabled = false; });
    }
  });

  window.addEventListener('beforeunload', function(ev) {
    if (document.querySelector('#avGrupos .av-card.sucio')) { ev.preventDefault(); ev.returnValue = ''; }
  });

  recargar().then(function() {
    var t = null;
    try { t = localStorage.getItem('avTab'); } catch (e) { /* sin almacenamiento */ }
    if (t && t !== 'mensajes') abrirTab(t);
  });
})();
