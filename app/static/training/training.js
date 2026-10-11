// Training de Design: aplicación principal (rutas y vistas). Contenido en /static/training/data/*.json (vía /design/api/training/contenido).
import { CFG, S, h, t, ui, md, api, toast, vaciar, setLang, iniciarGlosarioPop, estadoLeccion, resumenModulo, resumenGeneral, guardarProgreso, todasLasLecciones, anillo, barra, AREAS, tarjetaLider, avatar, T, U, ED as EDL, aplicarTema, temaActual } from './lib.js';
import { renderPaso } from './steps.js';
import { crearQuiz, mezclar } from './quiz.js';

const raiz = document.getElementById('trRaiz');
let vistaActual = null, destruir = [];   // destruir: funciones que limpian la vista actual (WebGL, temporizadores)

// ---------- Modo edición (admins): el contenido se edita en la misma página y se publica por módulo ----------
let ED = null;   // módulo editor.js (se carga solo en modo edición)
S.editando = CFG.esAdmin && (() => { try { return sessionStorage.getItem('tr_editar') === '1'; } catch (e) { return false; } })();
async function cargarContenido() {
  const c = await api.get('/design/api/training/contenido' + (S.editando ? '?borrador=1' : ''));
  S.editor = c.editor || {}; delete c.editor; S.contenido = c; S.glosarioIdx = null; indice = null;
}
async function cargarEditor() {
  if (!S.editando || ED) return;
  ED = await import('./editor.js');
  ED.iniciar({ raiz, vista, ir, ruta: () => ruta(), pintarMenu: () => pintarMenu(), recargar, salirEdicion, modActual: () => modDeRuta(), esLeccion: () => /^#\/l\//.test(location.hash), get destruir() { return destruir; } });
  ED.activarEnLugar();
}
async function recargar() { await cargarContenido(); if (ED) ED.olvidar(); armarMarco(); ruta(); }
async function entrarEdicion() {
  S.editando = true; S.vistaAlumno = false; try { sessionStorage.setItem('tr_editar', '1'); } catch (e) { /* sin almacenamiento */ }
  try { await cargarContenido(); await cargarEditor(); if (ED) ED.activarEnLugar(); } catch (e) { toast(e.message, 'error'); }
  armarMarco(); ruta();
}
async function salirEdicion() {
  if (ED) { ED.cerrarPanel(); ED.desactivarEnLugar(); }
  S.editando = false; S.vistaAlumno = false; try { sessionStorage.removeItem('tr_editar'); } catch (e) { /* sin almacenamiento */ }
  await cargarContenido(); armarMarco(); ruta();
}
const modDeRuta = () => { const r = location.hash || '#/'; const mm = r.match(/^#\/m\/([^/]+)/); if (mm) return mm[1]; const ll = r.match(/^#\/l\/([^/]+)/); return ll ? (leccion(ll[1]) || {}).m?.id : null; };

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const mod = (id) => S.contenido.modulos.find((m) => m.id === id);
const leccion = (id) => { for (const m of S.contenido.modulos) { const l = (m.lecciones || []).find((x) => x.id === id); if (l) return { l, m }; } return null; };
const ir = (hash) => { if (location.hash === hash) ruta(); else location.hash = hash; };
const minutosLeccion = (l) => l.minutos || 5;

// ---------- Estructura de la página ----------
let cuerpo, menu, buscador, resultados;
function armarMarco() {
  vaciar(raiz);
  const btnMenu = h('button', { type: 'button', class: 'tr-btn tr-btn-chico tr-menu-btn', 'aria-label': ui('menu'), onclick: () => raiz.classList.toggle('menu-abierto') }, '☰');
  buscador = h('input', { type: 'search', class: 'tr-buscar', placeholder: ui('buscar'), 'aria-label': ui('buscar'), autocomplete: 'off', oninput: () => buscar(buscador.value) });
  resultados = h('div', { class: 'tr-resultados', hidden: true, role: 'listbox' });
  const idioma = h('div', { class: 'tr-idioma', role: 'group', 'aria-label': ui('idioma') }, ['es', 'en'].map((l) => h('button', { type: 'button', class: S.lang === l ? 'on' : '', 'aria-pressed': S.lang === l, onclick: () => { if (S.lang === l) return; setLang(l); armarMarco(); ruta(); } }, l.toUpperCase())));
  const pct = resumenGeneral().pct;
  const top = h('header', { class: 'tr-top' }, btnMenu, h('a', { class: 'tr-marca', href: '#/' }, h('b', null, 'Nuvia Training')),
    h('div', { class: 'tr-buscar-w' }, h('span', { class: 'tr-buscar-ico', 'aria-hidden': 'true' }, '⌕'), buscador, resultados),
    h('div', { class: 'tr-top-der' }, CFG.esAdmin ? h('button', { type: 'button', class: 'tr-btn tr-btn-chico tr-btn-editar' + (S.editando ? ' on' : ''), 'aria-pressed': !!S.editando, title: ui('editarAyuda'),
      onclick: () => (S.editando ? salirEdicion() : entrarEdicion()) }, S.editando ? '✓ ' + ui('salirEdicion') : '✏️ ' + ui('editar')) : null,
      h('button', { type: 'button', class: 'tr-tema-btn', title: temaActual() === 'oscuro' ? ui('temaClaro') : ui('temaOscuro'), 'aria-label': temaActual() === 'oscuro' ? ui('temaClaro') : ui('temaOscuro'),
        onclick: () => { aplicarTema(temaActual() === 'oscuro' ? 'claro' : 'oscuro'); armarMarco(); ruta(); } }, temaActual() === 'oscuro' ? '☀️' : '🌙'),
      h('a', { href: '#/', class: 'tr-mini-anillo', title: ui('progresoTotal'), 'aria-label': ui('progresoTotal') + ' ' + pct + '%' }, anillo(pct, 34, 5), h('span', null, pct + '%')), idioma));
  menu = h('div', { class: 'tr-menu', role: 'navigation', 'aria-label': ui('ruta') });
  cuerpo = h('div', { class: 'tr-cuerpo', id: 'trMain', role: 'region', 'aria-label': 'Training', tabindex: '-1' });
  raiz.append(top, h('div', { class: 'tr-marco' }, menu, cuerpo), h('div', { class: 'tr-velo', onclick: () => raiz.classList.remove('menu-abierto') }));
  pintarMenu();
}

const seccionDe = (m) => m.seccion || 'biblioteca';
function pintarMenu() {
  const r = location.hash || '#/', lecActual = (r.match(/^#\/l\/([^/]+)/) || [])[1], modActual = (r.match(/^#\/m\/([^/]+)/) || [])[1] || (lecActual && (leccion(lecActual) || {}).m?.id);
  const enlace = (hash, ico, txt, extra) => h('a', { href: hash, class: 'tr-m-it' + (r === hash || r.startsWith(hash + '/') ? ' act' : ''), onclick: () => raiz.classList.remove('menu-abierto') }, h('span', { class: 'tr-m-ico' }, ico), h('span', { class: 'tr-m-txt' }, txt), extra);
  vaciar(menu);
  menu.append(enlace('#/', '🏠', ui('inicio')));
  const itemModulo = (m) => {
    const rs = resumenModulo(m), abierto = m.id === modActual, ac = m.area && AREAS[m.area] ? AREAS[m.area].color : '';
    menu.append(h('a', { href: '#/m/' + m.id, class: 'tr-m-it tr-m-mod' + (abierto ? ' act' : ''), style: ac ? { '--ac': ac } : null, onclick: () => raiz.classList.remove('menu-abierto') },
      h('span', { class: 'tr-m-ico' }, m.icono || '📘'), h('span', { class: 'tr-m-txt' }, t(m.titulo)),
      h('span', { class: 'tr-m-est ' + rs.estado, title: `${rs.hechas}/${rs.total}` }, rs.estado === 'hecho' ? '✓' : (rs.estado === 'curso' ? '●' : ''))));
    if (abierto) menu.append(h('div', { class: 'tr-m-lecs' }, (m.lecciones || []).map((l) => h('a', { href: '#/l/' + l.id, class: 'tr-m-lec' + (l.id === lecActual ? ' act' : ''), onclick: () => raiz.classList.remove('menu-abierto') },
      h('span', { class: 'tr-m-chk' + (estadoLeccion(l.id).completada ? ' ok' : '') }, estadoLeccion(l.id).completada ? '✓' : ''), h('span', null, t(l.titulo))))));
  };
  for (const [sec, rot] of [['intro', 'secIntro'], ['area', 'secAreas'], ['biblioteca', 'secBiblio']]) {
    const lista = S.contenido.modulos.filter((m) => seccionDe(m) === sec);
    if (!lista.length) continue;
    menu.append(h('div', { class: 'tr-m-sec' }, ui(rot)));
    lista.forEach(itemModulo);
  }
  menu.append(h('div', { class: 'tr-m-sec' }, ui('herramientas')), enlace('#/laboratorio', '🧪', ui('laboratorio')), enlace('#/glosario', '📖', ui('glosario')), enlace('#/examen', '📝', ui('examen')));
  if (CFG.esAdmin) menu.append(enlace('#/admin', '⚙️', ui('admin')));
}

// ---------- Búsqueda ----------
let indice = null;
function indexar() {
  if (indice) return indice;
  indice = [];
  for (const m of S.contenido.modulos) for (const l of m.lecciones || []) {
    const partes = [];
    for (const p of l.pasos || []) { partes.push(JSON.stringify([p.titulo, p.cuerpo, p.items, p.pasos, p.puntos, p.guia])); }
    indice.push({ tipo: 'leccion', id: l.id, titulo: t(l.titulo), sub: t(m.titulo), tn: norm(JSON.stringify(l.titulo)), cn: norm(partes.join(' ')) });
  }
  for (const g of S.contenido.glosario) indice.push({ tipo: 'termino', id: g.id, titulo: t(g.termino), sub: t(g.def), tn: norm(JSON.stringify(g.termino)), cn: norm(JSON.stringify(g.def)) });
  return indice;
}
function buscar(q) {
  q = norm(q).trim();
  if (q.length < 2) { resultados.hidden = true; return; }
  const sc = indexar().map((x) => ({ x, s: (x.tn.includes(q) ? 10 : 0) + (x.cn.includes(q) ? 1 : 0) })).filter((r) => r.s > 0).sort((a, b) => b.s - a.s).slice(0, 10);
  vaciar(resultados); resultados.hidden = false;
  if (!sc.length) { resultados.append(h('div', { class: 'tr-res-vacio' }, ui('sinResultados'))); return; }
  sc.forEach(({ x }) => resultados.append(h('a', { href: x.tipo === 'leccion' ? '#/l/' + x.id : '#/glosario/' + x.id, class: 'tr-res', role: 'option', onclick: () => { resultados.hidden = true; buscador.value = ''; } },
    h('span', { class: 'tr-res-tipo' }, x.tipo === 'leccion' ? ui('enLeccion') : ui('enGlosario')), h('b', null, x.titulo), h('small', null, x.sub.slice(0, 90)))));
}
document.addEventListener('click', (e) => { if (resultados && !e.target.closest('.tr-buscar-w')) resultados.hidden = true; });

// ---------- Utilidades de vista ----------
function limpiar() { destruir.forEach((f) => { try { f(); } catch (e) { console.error(e); } }); destruir = []; }
function vista(nodo, titulo) {
  vaciar(cuerpo);
  if (S.editando && ED && !nodo.querySelector('.tr-ed-barra')) cuerpo.append(ED.barra(modDeRuta()));
  cuerpo.append(nodo); document.title = (titulo ? titulo + ' · ' : '') + 'Training'; window.scrollTo({ top: 0 });
}
function chipEstado(estado) { return h('span', { class: 'tr-chip-estado ' + estado }, estado === 'hecho' ? '✓ ' + ui('completado') : (estado === 'curso' ? '● ' + ui('enCurso') : ui('nuevo'))); }
function primeraPendiente() {
  const ult = (S.progreso._ultima || {}).dato;
  if (ult) { const [id, i] = ult.split(':'); if (leccion(id) && !estadoLeccion(id).completada) return { id, paso: +i || 0, retoma: true }; }
  const l = todasLasLecciones().find((x) => !estadoLeccion(x.id).completada);
  return l ? { id: l.id, paso: 0 } : null;
}

// ---------- Bloques que el admin ordena u oculta (sitio[clave] = { orden, ocultos }) ----------
const sitio = () => S.contenido.sitio || {};
function ordenar(clave, bloques, opciones) {
  if (S.editando && ED) return ED.ordenarBloques(clave, bloques, opciones);
  const conf = sitio()[clave] || {}, orden = conf.orden || [], ocultos = new Set(conf.ocultos || []);
  return bloques.filter((b) => !ocultos.has(b[0])).sort((a, b) => { const ia = orden.indexOf(a[0]), ib = orden.indexOf(b[0]); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); }).map((b) => b[1]);
}

// ---------- Inicio ----------
function tarjetaModulo(m, n, grande) {
  const rs = resumenModulo(m), a = m.area && AREAS[m.area], lider = a && (S.lideres || {})[m.area];
  return h('a', { class: 'tr-mod-card ' + rs.estado + (grande ? ' grande' : '') + (a ? ' de-area' : ''), href: '#/m/' + m.id, style: a ? { '--ac': a.color } : null },
    h('div', { class: 'tr-mod-top' }, h('span', { class: 'tr-mod-ico' }, m.icono || '📘'), n ? h('span', { class: 'tr-mod-n' }, n) : null, chipEstado(rs.estado)),
    h('h3', null, t(m.titulo)), h('p', null, t(m.resumen)),
    a ? h('div', { class: 'tr-mod-lider' }, avatar(lider || { nombre: a.nombre }, 30), h('span', null, lider ? lider.nombre : ui('porAnunciar'))) : null,
    barra(rs.pct), h('div', { class: 'tr-mod-meta' }, `${rs.total} ${ui('lecciones')} · ≈${rs.minutos} ${ui('min')}`));
}
function vistaInicio() {
  const g = resumenGeneral(), sig = primeraPendiente(), info = sig && leccion(sig.id), portada = (sitio().portada || {}).src;
  const hero = h('section', { class: 'tr-hero' + (portada ? ' con-portada' : '') }, portada ? h('img', { class: 'tr-hero-img', src: portada, alt: '' }) : null,
    h('div', { class: 'tr-hero-txt' }, h('div', { class: 'tr-eyebrow' }, ui('hola', { n: CFG.nombre || '' }) + ' 👋'), U('h1', null, 'bienvenida'), U('p', null, 'subBienvenida'),
      sig && info ? h('div', { class: 'tr-hero-cta' }, h('a', { class: 'tr-btn tr-btn-primario tr-btn-grande', href: '#/l/' + sig.id + (sig.paso ? '/' + sig.paso : '') }, (sig.retoma || g.hechas ? ui('continuar') : ui('empezar')) + ' →'),
        h('span', { class: 'tr-sub' }, (sig.retoma ? ui('ultima') + ': ' : '') + t(info.l.titulo))) : h('div', { class: 'tr-hero-cta' }, h('span', { class: 'tr-chip-estado hecho' }, '🎉 ' + ui('completado')))),
    h('div', { class: 'tr-hero-prog' }, h('div', { class: 'tr-anillo-w' }, anillo(g.pct, 150, 14), h('div', { class: 'tr-anillo-n' }, h('b', null, g.pct + '%'), h('span', null, `${g.hechas} ${ui('de')} ${g.total}`))), h('div', { class: 'tr-sub' }, ui('progresoTotal') + ' · ' + ui('lecciones'))));
  const grupo = (sec) => S.contenido.modulos.filter((m) => seccionDe(m) === sec);
  const editar = S.editando && ED;
  const rejilla = (sec, cls, lista, tarjeta) => {
    const grid = h('div', { class: 'tr-grid-mod ' + cls }, lista.map((m, i) => { const c = tarjeta(m, i); if (editar) ED.moduloArrastrable(c, m, sec); return c; }));
    if (editar) { ED.zonaModulos(grid, sec); if (!lista.length) grid.append(h('div', { class: 'tr-vacio tr-ed-soltar' }, 'Arrastra aquí un módulo')); }
    return grid;
  };
  const intro = grupo('intro'), areas = grupo('area'), biblio = grupo('biblioteca');
  const bloques = [['hero', hero, 'Portada']];
  if (intro.length || editar) bloques.push(['intro', h('section', { class: 'tr-seccion' }, U('h2', null, 'secIntro'), rejilla('intro', 'uno', intro, (m) => tarjetaModulo(m, 1, true))), 'Empieza aquí']);
  if (areas.length || editar) bloques.push(['areas', h('section', { class: 'tr-seccion' }, U('h2', null, 'secAreas'), U('p', { class: 'tr-sub' }, 'areasDesc'), rejilla('area', '', areas, (m, i) => tarjetaModulo(m, i + 1))), 'Las áreas']);
  if (biblio.length || editar) bloques.push(['biblioteca', h('section', { class: 'tr-seccion' }, U('h2', null, 'secBiblio', '📚 '), U('p', { class: 'tr-sub' }, 'biblioDesc'), rejilla('biblioteca', 'chica', biblio, (m) => tarjetaModulo(m))), 'Biblioteca de referencia']);
  const herr = h('section', { class: 'tr-seccion' }, U('h2', null, 'herramientas'), h('div', { class: 'tr-grid-herr' },
    [['#/laboratorio', '🧪', 'laboratorio', 'labDesc'], ['#/glosario', '📖', 'glosario', 'glosarioDesc'], ['#/examen', '📝', 'examen', 'examenDesc'], ...(CFG.esAdmin ? [['#/admin', '⚙️', 'admin', 'adminDesc']] : [])]
      .map(([hr, ico, tit, desc]) => h(editar ? 'div' : 'a', { class: 'tr-herr', href: editar ? null : hr }, h('span', { class: 'tr-herr-ico' }, ico), h('div', null, U('b', null, tit), U('p', null, desc)), editar ? h('a', { class: 'tr-btn tr-btn-chico', href: hr }, 'Abrir →') : null))));
  bloques.push(['herramientas', herr, 'Herramientas']);
  const extra = (k) => (k === 'hero' && editar ? h('span', { class: 'tr-acc' },
    h('button', { type: 'button', class: 'tr-btn tr-btn-chico', onclick: async () => { const l = await ED.elegirImagen(false); if (l && l[0]) { ED.sitio().portada = { src: l[0].src }; ED.cambioSitio(); ruta(); } } }, portada ? '🔄 Cambiar imagen de portada' : '🖼 Imagen de portada'),
    portada ? h('button', { type: 'button', class: 'tr-btn tr-btn-chico tr-btn-peligro', onclick: () => { delete ED.sitio().portada; ED.cambioSitio(); ruta(); } }, 'Quitar imagen') : null) : null);
  const pag = h('div', { class: 'tr-pagina' }, ...ordenar('inicio', bloques, { extra }));
  vista(pag, ui('inicio'));
  if (editar) ED.decorarInicio(pag);
}

// ---------- Módulo ----------
function vistaModulo(id) {
  const m = mod(id); if (!m) return ir('#/');
  const rs = resumenModulo(m);
  const lista = h('div', { class: 'tr-lecs' }, (m.lecciones || []).map((l, i) => {
    const e = estadoLeccion(l.id), pasos = (l.pasos || []).length;
    return h('a', { class: 'tr-lec-card' + (e.completada ? ' hecho' : ''), href: '#/l/' + l.id },
      h('span', { class: 'tr-lec-n' }, e.completada ? '✓' : i + 1),
      h('div', { class: 'tr-lec-txt' }, h('b', null, t(l.titulo)), h('small', null, `${minutosLeccion(l)} ${ui('min')} · ${pasos} ${ui('paso').toLowerCase()}s`)),
      e.puntaje ? h('span', { class: 'tr-lec-pts', title: ui('puntaje') }, e.puntaje + '%') : null, h('span', { class: 'tr-lec-flecha' }, '→'));
  }));
  const sig = (m.lecciones || []).find((l) => !estadoLeccion(l.id).completada) || (m.lecciones || [])[0];
  vista(h('div', { class: 'tr-pagina' }, h('div', { class: 'tr-migas', role: 'navigation' }, h('a', { href: '#/' }, ui('inicio')), ' › ', t(m.titulo)),
    h('section', { class: 'tr-mod-head' }, h('span', { class: 'tr-mod-ico grande' }, m.icono || '📘'), h('div', null, T('h1', null, m.titulo), T('p', null, m.resumen), h('div', { class: 'tr-sub' }, `${rs.total} ${ui('lecciones')} · ≈${rs.minutos} ${ui('min')} · ${ui('porcentaje', { n: rs.pct })}`), barra(rs.pct))),
    m.area && AREAS[m.area] ? tarjetaLider(m.area) : null,
    sig ? h('a', { class: 'tr-btn tr-btn-primario', href: '#/l/' + sig.id }, (rs.hechas ? ui('continuar') : ui('empezar')) + ' →') : null, lista), t(m.titulo));
  if (S.editando && ED) ED.decorarModulo(cuerpo.querySelector('.tr-pagina'), m).catch((e) => toast(e.message, 'error'));
}

// ---------- Lección ----------
function vistaLeccion(id, pasoIni) {
  const f = leccion(id); if (!f) return ir('#/');
  if (S.editando && ED && !S.vistaAlumno) { ED.vistaLeccion(f.l, f.m).catch((e) => { console.error(e); toast(e.message, 'error'); }); return; }
  const { l, m } = f, pasos = l.pasos || [];
  let idx = Math.max(0, Math.min(pasos.length - 1, pasoIni || 0)), actual = null, quizPasado = estadoLeccion(l.id).completada || !pasos.some((p) => p.t === 'quiz'), guardarTimer = null;   // una lección sin quiz se completa al llegar al final
  const lienzo = h('div', { class: 'tr-leccion-paso' }), puntos = h('div', { class: 'tr-pasos-puntos', role: 'tablist' });
  const btnAnt = h('button', { type: 'button', class: 'tr-btn', onclick: () => mover(-1) }, '← ' + ui('anterior')), btnSig = h('button', { type: 'button', class: 'tr-btn tr-btn-primario', onclick: () => avanzar() });
  const progresoTxt = h('span', { class: 'tr-sub' });
  const cab = h('div', { class: 'tr-leccion-cab' }, h('div', { class: 'tr-migas', role: 'navigation' }, h('a', { href: '#/' }, ui('inicio')), ' › ', h('a', { href: '#/m/' + m.id }, t(m.titulo))),
    T('h1', null, l.titulo), h('div', { class: 'tr-sub' }, `${minutosLeccion(l)} ${ui('min')} · ${ui('atajos')}`));
  const marco = h('div', { class: 'tr-pagina tr-leccion' }, cab, h('div', { class: 'tr-leccion-prog' }, puntos, progresoTxt), lienzo, h('div', { class: 'tr-leccion-nav' }, btnAnt, btnSig));
  vista(marco, t(l.titulo));
  const ctx = { onQuiz: async (pct) => {
    if (pct >= 70) { quizPasado = true; await guardarProgreso(l.id, { completada: true, puntaje: pct }); pintarMenu(); actualizarNav(); }
    else await guardarProgreso(l.id, { puntaje: pct });
  } };

  function pintarPuntos() {
    puntos.replaceChildren(...pasos.map((p, i) => h('button', { type: 'button', role: 'tab', class: 'tr-pp' + (i === idx ? ' act' : (i < idx ? ' hecho' : '')), 'aria-label': ui('paso') + ' ' + (i + 1), 'aria-selected': i === idx, onclick: () => { if (i <= idx || quizPasado || p.t !== 'quiz') ir_(i); } })));
    progresoTxt.textContent = ui('pasoDe', { a: idx + 1, b: pasos.length });
  }
  function actualizarNav() {
    const ultimo = idx === pasos.length - 1, esQuiz = pasos[idx].t === 'quiz';
    btnAnt.disabled = idx === 0; btnAnt.hidden = idx === 0;
    btnSig.textContent = ultimo ? (quizPasado ? ui('terminar') + ' ✓' : ui('terminar')) : ui('siguiente') + ' →';
    btnSig.disabled = ultimo && esQuiz && !quizPasado;
    btnSig.title = btnSig.disabled ? ui('necesitas70') : '';
  }
  function mostrar() {
    if (actual && actual.destroy) actual.destroy();
    actual = renderPaso(pasos[idx], ctx);
    lienzo.replaceChildren(h('div', { class: 'tr-entra' }, actual.el));
    pintarPuntos(); actualizarNav();
    history.replaceState(null, '', '#/l/' + l.id + (idx ? '/' + idx : ''));
    clearTimeout(guardarTimer); guardarTimer = setTimeout(() => guardarProgreso('_ultima', { dato: `${l.id}:${idx}` }), 900);
    const top = cab.getBoundingClientRect().bottom + window.scrollY - 70; if (window.scrollY > top + 200) window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }
  const ir_ = (i) => { idx = Math.max(0, Math.min(pasos.length - 1, i)); mostrar(); };
  const mover = (d) => ir_(idx + d);
  async function avanzar() {
    if (idx < pasos.length - 1) return mover(1);
    if (!quizPasado) return;
    await guardarProgreso(l.id, { completada: true }); pintarMenu(); final();
  }
  function final() {
    const sig = todasLasLecciones().find((x) => !estadoLeccion(x.id).completada && x.id !== l.id), sigMismo = (m.lecciones || [])[(m.lecciones || []).findIndex((x) => x.id === l.id) + 1];
    const e = estadoLeccion(l.id), rs = resumenModulo(m);
    vaciar(lienzo).append(h('div', { class: 'tr-fin tr-entra' }, h('div', { class: 'tr-fin-ico' }, '🎉'), U('h2', null, 'completaLeccion'), h('p', null, `${ui('puntaje')}: ${e.puntaje || 100}%`), h('div', { class: 'tr-sub' }, `${t(m.titulo)} · ${ui('porcentaje', { n: rs.pct })}`), barra(rs.pct),
      h('div', { class: 'tr-fin-acc' }, sigMismo ? h('a', { class: 'tr-btn tr-btn-primario', href: '#/l/' + sigMismo.id }, ui('leccionSig') + ' →') : (sig ? h('a', { class: 'tr-btn tr-btn-primario', href: '#/l/' + sig.id }, ui('moduloSig') + ' →') : h('a', { class: 'tr-btn tr-btn-primario', href: '#/examen' }, ui('examen') + ' →')),
        h('a', { class: 'tr-btn', href: '#/m/' + m.id }, ui('volver')))));
    document.querySelector('.tr-leccion-nav').hidden = true; actual = null; pintarMenu();
  }
  const tecla = (e) => {
    if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.key !== 'Escape') return;
    if (e.key === 'ArrowRight' && !btnSig.disabled) { if (idx < pasos.length - 1) mover(1); }
    else if (e.key === 'ArrowLeft') mover(-1);
    else if (e.key === 'Escape' && !document.querySelector('.tr-modal-fondo, .tr-pop')) ir('#/m/' + m.id);
  };
  document.addEventListener('keydown', tecla);
  destruir.push(() => { document.removeEventListener('keydown', tecla); clearTimeout(guardarTimer); if (actual && actual.destroy) actual.destroy(); });
  mostrar();
}

// ---------- Glosario ----------
function vistaGlosario(resaltar) {
  const lista = S.contenido.glosario.map((g) => ({ ...g, ck: norm(g.cat || '') }));
  const etiquetas = new Map();   // categoría normalizada -> etiqueta (prefiere la que lleva tilde)
  for (const g of lista) if (g.ck) { const e = etiquetas.get(g.ck); if (!e || (/[áéíóúñ]/i.test(g.cat) && !/[áéíóúñ]/i.test(e))) etiquetas.set(g.ck, g.cat); }
  const cats = [...etiquetas.keys()].sort(), nombreCat = (k) => { const e = etiquetas.get(k); return /^n[236]$/i.test(e) ? e.toUpperCase() : e.charAt(0).toUpperCase() + e.slice(1); };
  let q = '', cat = '';
  const ent = h('input', { type: 'search', class: 'tr-in', placeholder: ui('glosBuscar'), 'aria-label': ui('glosBuscar'), oninput: () => { q = norm(ent.value); pintar(); } });
  const chips = h('div', { class: 'tr-chips' });
  const out = h('div', { class: 'tr-glos' }), cuenta = h('div', { class: 'tr-sub' });
  const pintarChips = () => chips.replaceChildren(h('button', { type: 'button', class: 'tr-chip' + (!cat ? ' on' : ''), onclick: () => { cat = ''; pintar(); } }, ui('glosTodos')), ...cats.map((c) => h('button', { type: 'button', class: 'tr-chip' + (cat === c ? ' on' : ''), onclick: () => { cat = c; pintar(); } }, nombreCat(c))));
  function pintar() {
    pintarChips();
    const filas = lista.filter((g) => (!cat || g.ck === cat) && (!q || norm(JSON.stringify([g.termino, g.def])).includes(q)));
    cuenta.textContent = `${filas.length} ${ui('terminos')}`;
    let letra = '';
    out.replaceChildren(...filas.flatMap((g) => {
      const l = (t(g.termino)[0] || '#').toUpperCase(), nodos = [];
      if (l !== letra) { letra = l; nodos.push(h('div', { class: 'tr-glos-letra' }, l)); }
      const otro = S.lang === 'es' ? g.termino.en : g.termino.es;
      const mo = mod(g.modulo);
      nodos.push(h('article', { class: 'tr-glos-it' + (g.id === resaltar ? ' resaltado' : ''), id: 'g-' + g.id }, h('h3', null, t(g.termino), otro && otro !== t(g.termino) ? h('small', null, otro) : null), h('p', null, t(g.def)),
        mo ? h('a', { class: 'tr-glos-mod', href: '#/m/' + mo.id }, (mo.icono || '') + ' ' + t(mo.titulo)) : null));
      return nodos;
    }));
    if (!filas.length) out.append(h('div', { class: 'tr-vacio' }, ui('sinResultados')));
  }
  vista(h('div', { class: 'tr-pagina' }, U('h1', null, 'glosario', '📖 '), U('p', { class: 'tr-sub' }, 'glosarioDesc'), ent, chips, cuenta, out), ui('glosario'));
  pintar();
  if (resaltar) setTimeout(() => { const e = document.getElementById('g-' + resaltar); if (e) e.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 80);
}

// ---------- Laboratorio 3D ----------
const LAB_GUIA = {
  rx: [
    ['🦴', { es: 'Maxilar y mandíbula', en: 'Maxilla and mandible' }, { es: 'Salen de la tomografía (CBCT). Son la base real del paciente: el diseño se apoya en el hueso, no solo en la encía.', en: 'They come from the CT scan (CBCT). They are the patient’s real foundation: the design rests on bone, not just on the gums.' }],
    ['🙂', { es: 'Cara alineada', en: 'Aligned face' }, { es: 'El escaneo facial se alinea con la tomografía y los modelos. Así la sonrisa se diseña mirando la cara: línea media, línea entre las pupilas y labios.', en: 'The face scan is aligned with the CT and the models. That way the smile is designed looking at the face: midline, interpupillary line and lips.' }],
    ['🦷', { es: 'Waxup y prótesis', en: 'Waxup and prosthesis' }, { es: 'El waxup (tamaño C5 en este caso) es la propuesta de dientes. Enciende y apaga cada objeto para ver cómo encaja con el hueso, la encía y la mordida.', en: 'The waxup (size C5 in this case) is the proposed teeth. Turn each object on and off to see how it fits the bone, gums and bite.' }],
    ['⚠️', { es: 'Por qué importa', en: 'Why it matters' }, { es: 'Si un registro (foto, escaneo o tomografía) viene mal tomado, la alineación falla y el diseño se corre. Por eso Face Design revisa los registros antes de diseñar.', en: 'If a record (photo, scan or CT) is taken poorly, the alignment fails and the design shifts. That is why Face Design checks the records before designing.' }],
  ],
  changes: [
    ['↕️', { es: 'Borde incisal', en: 'Incisal edge' }, { es: 'Sube o baja los dientes de adelante. El doctor lo pide en mm: “+1 apically” los sube 1 mm.', en: 'Moves the front teeth up or down. The doctor asks in mm: “+1 apically” moves them up 1 mm.' }],
    ['↔️', { es: 'Línea media', en: 'Midline' }, { es: 'Mueve el centro de la sonrisa a la derecha o izquierda del paciente (no de quien mira).', en: 'Moves the center of the smile to the patient’s right or left (not the viewer’s).' }],
    ['📐', { es: 'Inclinación (cant) y plano', en: 'Cant and plane' }, { es: 'Corrige una sonrisa torcida o un plano de mordida inclinado respecto a la cara.', en: 'Corrects a tilted smile or a bite plane that is slanted relative to the face.' }],
    ['🔁', { es: 'Antes y después', en: 'Before and after' }, { es: 'Compara con la posición original: cada palabra de la receta corresponde a un movimiento concreto. En el simulador de abajo puedes practicar cada uno.', en: 'Compare with the original position: every word on the prescription maps to a specific movement. Practice each one in the simulator below.' }],
  ],
};
function vistaLab() {
  let tab = 'rx';
  const editar = S.editando && ED, st = sitio();
  if (editar && !st.labGuia) ED.sitio().labGuia = JSON.parse(JSON.stringify(LAB_GUIA_OBJ()));
  if (editar && !st.labVisor) ED.sitio().labVisor = JSON.parse(JSON.stringify(LAB_VISOR));
  const guiaDe = (k) => ((sitio().labGuia || LAB_GUIA_OBJ())[k] || []);
  const guia = h('div', { class: 'tr-lab-guia' });
  const pintarGuia = () => {
    const items = guiaDe(tab);
    guia.replaceChildren(U('h3', null, tab === 'rx' ? 'labGuiaRx' : 'labGuiaChanges'), ...items.map((it, i) => h('div', { class: 'tr-lab-g' },
      h(editar ? 'button' : 'span', { class: 'tr-lab-g-ico', type: editar ? 'button' : null, title: editar ? 'Cambiar icono' : null, onclick: editar ? () => { const v = prompt('Icono (emoji):', it.ico); if (v) { it.ico = v; ED.cambioSitio(); pintarGuia(); } } : null }, it.ico),
      h('div', null, T('b', null, it.titulo), T('p', null, it.texto)),
      editar ? h('div', { class: 'tr-lab-g-acc' },
        h('button', { type: 'button', class: 'tr-ed-ib', title: 'Subir', disabled: !i, onclick: () => { items.splice(i - 1, 0, items.splice(i, 1)[0]); ED.cambioSitio(); pintarGuia(); } }, '↑'),
        h('button', { type: 'button', class: 'tr-ed-ib peligro', title: 'Quitar', onclick: () => { items.splice(i, 1); ED.cambioSitio(); pintarGuia(); } }, '✕')) : null)),
      editar ? h('button', { type: 'button', class: 'tr-btn tr-btn-chico', onclick: () => { items.push({ ico: '💡', titulo: { es: 'Nuevo punto', en: 'New point' }, texto: { es: 'Qué mirar y por qué.', en: 'What to look at and why.' } }); ED.cambioSitio(); pintarGuia(); } }, '＋ Agregar punto') : null);
  };
  const visorZona = h('div', { class: 'tr-lab-visor' }, h('div', { class: 'tr-cargando-mini' }, h('div', { class: 'tr-spinner' }), ui('cargando')));
  const simZona = h('div');
  const lado = (sitio().lab || {}).guiaLado || 'der';
  const bloques = [
    ['visor', h('section', { class: 'tr-seccion' }, U('h2', null, 'labVisorTit', '🖥 '), U('p', { class: 'tr-sub' }, 'labVisorSub'), h('div', { class: 'tr-lab-dos' + (lado === 'izq' ? ' guia-izq' : '') }, visorZona, guia)), 'Visor del caso real'],
    ['sim', h('section', { class: 'tr-seccion' }, U('h2', null, 'labSimTit', '🎛 '), U('p', { class: 'tr-sub' }, 'labSub'), simZona), 'Simulador de movimientos'],
  ];
  const extra = (k) => (k === 'visor' && editar ? h('button', { type: 'button', class: 'tr-btn tr-btn-chico', onclick: () => { const x = ED.sitio(); x.lab = { ...(x.lab || {}), guiaLado: lado === 'izq' ? 'der' : 'izq' }; ED.cambioSitio(); ruta(); } }, '⇄ Guía a la ' + (lado === 'izq' ? 'derecha' : 'izquierda')) : null);
  const cont = h('div', { class: 'tr-pagina tr-pagina-ancha' }, U('h1', null, 'labTitulo', '🧪 '), U('p', { class: 'tr-sub' }, 'labIntro'), ...ordenar('lab', bloques, { extra }));
  vista(cont, ui('laboratorio'));
  pintarGuia();
  import('./sim.js').then((m) => {
    const tx = sitio().labVisor || LAB_VISOR;
    const paso = { t: 'visor', slot: 'laboratorio-visor', pestana: 'rx', titulo: tx.titulo, descripcion: tx.descripcion, pendiente: tx.pendiente || LAB_VISOR.pendiente, alCambiarPestana: (k) => { tab = k; pintarGuia(); } };
    const v = m.crearVisorPaso(paso); visorZona.replaceChildren(v.el);
    const s2 = m.crearLaboratorio(); simZona.append(s2.el); destruir.push(s2.destroy);
  }).catch((e) => { console.error(e); cont.append(h('div', { class: 'tr-error' }, ui('errorGenerico'))); });
}
const LAB_VISOR = { titulo: { es: 'Caso real aprobado', en: 'Approved real case' },
  descripcion: { es: 'Gira con el mouse, acerca con la rueda y usa las pestañas **RX** y **Changes**. Al lado tienes qué mirar en cada una.', en: 'Rotate with the mouse, zoom with the wheel and use the **RX** and **Changes** tabs. Next to it you have what to look at in each one.' },
  pendiente: { es: 'Sube aquí el visor HTML de un caso (Nuvia Design Viewer).', en: 'Upload a case HTML viewer here (Nuvia Design Viewer).' } };
const LAB_GUIA_OBJ = () => Object.fromEntries(Object.entries(LAB_GUIA).map(([k, l]) => [k, l.map(([ico, titulo, texto]) => ({ ico, titulo, texto }))]));

// ---------- Examen final ----------
function preguntasExamen() {
  const preg = (m) => mezclar((m.lecciones || []).flatMap((l) => (l.pasos || []).filter((p) => p.t === 'quiz').flatMap((p) => p.preguntas)));
  const principales = S.contenido.modulos.filter((m) => seccionDe(m) !== 'biblioteca').map(preg), apoyo = S.contenido.modulos.filter((m) => seccionDe(m) === 'biblioteca').map(preg);
  const sel = []; let i = 0;
  while (sel.length < 20 && principales.some((a) => a.length)) { const a = principales[i % principales.length]; if (a.length) sel.push(a.pop()); i++; }   // áreas e introducción, repartidas
  for (i = 0; sel.length < 20 && apoyo.some((a) => a.length); i++) { const a = apoyo[i % apoyo.length]; if (a.length) sel.push(a.pop()); }               // si faltan, la biblioteca
  return mezclar(sel);
}
function vistaExamen() {
  const e = estadoLeccion('_examen'), aprobado = e.puntaje >= 80;
  const caja = h('div', { class: 'tr-pagina' }, U('h1', null, 'exTitulo', '📝 '), U('p', null, 'exIntro'));
  const resumen = h('div', { class: 'tr-ex-info' }, e.puntaje ? h('div', { class: 'tr-ex-mejor' }, ui('exMejor') + ': ', h('b', null, e.puntaje + '%'), aprobado ? h('span', { class: 'tr-chip-estado hecho' }, '✓ ' + ui('exAprobado')) : null) : null,
    aprobado ? h('a', { class: 'tr-btn', href: '#/diploma' }, '🎓 ' + ui('verDiploma')) : null);
  const zona = h('div', { class: 'tr-ex-zona' });
  const empezar = h('button', { type: 'button', class: 'tr-btn tr-btn-primario tr-btn-grande', onclick: () => {
    const preg = preguntasExamen(); if (!preg.length) return toast(ui('sinContenido'), 'error');
    empezar.hidden = true;
    zona.replaceChildren(crearQuiz(preg, { umbral: 80, onFin: async (pct) => { await guardarProgreso('_examen', { puntaje: pct, completada: pct >= 80 }); if (pct >= 80) toast('🎓 ' + ui('exAprobado'), 'ok'); } }),
      h('div', { class: 'tr-fin-acc' }, h('button', { type: 'button', class: 'tr-btn', onclick: () => vistaExamen() }, ui('volver')), h('a', { class: 'tr-btn', href: '#/diploma' }, '🎓 ' + ui('diploma'))));
  } }, ui('exEmpezar'));
  vista(h('div', null, caja, h('div', { class: 'tr-pagina' }, resumen, empezar, zona)), ui('examen'));
}

// ---------- Diploma ----------
function vistaDiploma() {
  const e = estadoLeccion('_examen');
  if (e.puntaje < 80) return vista(h('div', { class: 'tr-pagina' }, U('h1', null, 'diploma', '🎓 '), U('p', null, 'sinDiploma'), h('a', { class: 'tr-btn tr-btn-primario', href: '#/examen' }, ui('examen') + ' →')), ui('diploma'));
  const fecha = new Date((e.actualizado && new Date(e.actualizado).getTime()) || Date.now()).toLocaleDateString(S.lang === 'es' ? 'es-CO' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  vista(h('div', { class: 'tr-pagina' }, h('div', { class: 'tr-diploma' }, h('div', { class: 'tr-dip-borde' }, h('div', { class: 'tr-dip-sello' }, '🎓'), h('div', { class: 'tr-dip-sup' }, 'Nuvia Design'), U('h1', null, 'diplomaTit'),
    h('div', { class: 'tr-dip-nombre' }, CFG.nombreCompleto || CFG.nombre), U('p', null, 'diplomaTxt'), U('p', { class: 'tr-dip-sub' }, 'diplomaSub'), h('div', { class: 'tr-dip-pie' }, h('span', null, `${ui('fecha')}: ${fecha}`), h('span', null, `${ui('puntaje')}: ${e.puntaje}%`)))),
    h('div', { class: 'tr-fin-acc tr-noprint' }, h('button', { type: 'button', class: 'tr-btn tr-btn-primario', onclick: () => window.print() }, '🖨 ' + ui('imprimir')), h('a', { class: 'tr-btn', href: '#/' }, ui('volver')))), ui('diploma'));
}

// ---------- Administración ----------
async function vistaAdmin() {
  if (!CFG.esAdmin) return ir('#/');
  const cont = h('div', { class: 'tr-pagina tr-pagina-ancha' }, U('h1', null, 'admin', '⚙️ '), h('div', { class: 'tr-cargando-mini' }, h('div', { class: 'tr-spinner' }), ui('cargando')));
  vista(cont, ui('admin'));
  let datos;
  try { datos = await api.get('/design/api/training/admin'); } catch (e) { cont.append(h('div', { class: 'tr-error' }, e.message)); return; }
  cont.querySelector('.tr-cargando-mini').remove();
  const tabs = h('div', { class: 'tr-seg tr-seg-vistas' }), panel = h('div', { class: 'tr-admin-panel' });
  let tab = 'modelos';
  const pintar = () => {
    tabs.replaceChildren(...[['modelos', '🧩 ' + ui('modelos3d')], ['lideres', '🧑‍💼 ' + ui('lideres')], ['equipo', '👥 ' + ui('equipo')]].map(([k, rot]) => h('button', { type: 'button', class: 'tr-seg-b' + (tab === k ? ' on' : ''), onclick: () => { tab = k; pintar(); } }, rot)));
    if (tab === 'modelos') {
      panel.replaceChildren(U('p', { class: 'tr-sub' }, 'formatos'), datos.slots.length ? h('div', { class: 'tr-tabla-w' }, h('table', { class: 'tr-tabla' }, h('thead', null, h('tr', null, [ui('espacio'), ui('lecc'), ui('estado'), ui('acciones')].map((x) => h('th', null, x)))),
        h('tbody', null, datos.slots.map((s) => {
          const f = h('input', { type: 'file', accept: s.tipo === 'visor' ? '.html,.htm' : '.glb,.stl,.obj,.ply', hidden: true, onchange: async () => { const a = f.files[0]; if (!a) return; const fd = new FormData(); fd.append('slot', s.slot); fd.append('archivo', a); toast(ui('subiendo')); try { await api.subir('/design/api/training/modelos', fd); toast(ui('subidoOk'), 'ok'); datos = await api.get('/design/api/training/admin'); pintar(); } catch (e) { toast(e.message, 'error'); } } });
          return h('tr', null, h('th', { scope: 'row' }, h('code', null, s.slot), h('div', { class: 'tr-sub' }, t(s.titulo))), h('td', null, h('a', { href: s.leccion ? '#/l/' + s.leccion : '#/laboratorio' }, t(s.leccionTitulo))),
            h('td', null, s.modelo ? h('span', { class: 'tr-chip-estado hecho' }, '✓ ' + (s.modelo.incluido ? ui('incluido') : ui('subido')) + ' · ' + (s.modelo.tamano / 1048576).toFixed(1) + ' MB') : h('span', { class: 'tr-chip-estado' }, ui('pendiente'))),
            h('td', { class: 'tr-acc' }, f, h('button', { type: 'button', class: 'tr-btn tr-btn-chico', onclick: () => f.click() }, '⬆ ' + (s.modelo ? ui('reemplazar') : ui('subirModelo'))),
              h('a', { class: 'tr-btn tr-btn-chico', href: s.leccion ? '#/l/' + s.leccion : '#/laboratorio' }, ui('verLeccion'))));
        })))) : h('div', { class: 'tr-vacio' }, ui('sinModelos')));
    } else if (tab === 'lideres') {
      panel.replaceChildren(U('p', { class: 'tr-sub' }, 'liderAyuda'), h('div', { class: 'tr-lideres-admin' }, Object.keys(AREAS).map((a) => {
        const act = (datos.lideres || {})[a], sel = h('select', { class: 'tr-in', 'aria-label': AREAS[a].nombre }, h('option', { value: '' }, ui('liderSinAsignar')), ...datos.candidatos.map((c) => h('option', { value: c.id, selected: !!act && act.empleadoId === c.id }, c.nombre)));
        const ces = h('input', { class: 'tr-in', placeholder: ui('liderCargoEs'), maxlength: 80, value: act ? act.cargo.es : '' }), cen = h('input', { class: 'tr-in', placeholder: ui('liderCargoEn'), maxlength: 80, value: act ? act.cargo.en : '' });
        return h('div', { class: 'tr-lider-adm', style: { '--ac': AREAS[a].color } }, h('h3', null, AREAS[a].ico + ' ' + AREAS[a].nombre), sel, ces, cen,
          h('div', { class: 'tr-acc' }, h('button', { type: 'button', class: 'tr-btn tr-btn-primario tr-btn-chico', onclick: async () => {
            if (!sel.value) return toast(ui('liderSinAsignar'), 'error');
            try { S.lideres = datos.lideres = await api.post('/design/api/training/lideres/' + a, { empleadoId: +sel.value, cargoEs: ces.value, cargoEn: cen.value }); toast(ui('liderGuardado'), 'ok'); pintar(); } catch (e) { toast(e.message, 'error'); } } }, ui('guardar')),
            act ? h('button', { type: 'button', class: 'tr-btn tr-btn-chico tr-btn-peligro', onclick: async () => { try { S.lideres = datos.lideres = await api.post('/design/api/training/lideres/' + a + '/quitar', {}); toast(ui('liderQuitado'), 'ok'); pintar(); } catch (e) { toast(e.message, 'error'); } } }, ui('quitar')) : null));
      })));
    } else {
      panel.replaceChildren(h('div', { class: 'tr-tabla-w' }, h('table', { class: 'tr-tabla' }, h('thead', null, h('tr', null, [ui('persona'), ui('avance'), ui('promedio'), ui('examenCol'), ui('ultimaCol')].map((x) => h('th', null, x)))),
        h('tbody', null, datos.equipo.map((p) => h('tr', null, h('th', { scope: 'row' }, p.nombre), h('td', null, h('div', { class: 'tr-av' }, barra(p.total ? Math.round(p.completadas * 100 / p.total) : 0), h('span', null, `${p.completadas}/${p.total}`))),
          h('td', null, p.promedio != null ? p.promedio + '%' : '—'), h('td', null, p.examen ? p.examen + '%' : '—'), h('td', null, p.ultima ? new Date(p.ultima).toLocaleDateString(S.lang === 'es' ? 'es-CO' : 'en-US') : '—')))))));
    }
  };
  cont.append(tabs, panel); pintar();
}

// ---------- Rutas ----------
function ruta() {
  limpiar(); raiz.classList.remove('menu-abierto');
  if (ED) { ED.cerrarPanel(); ED.alCambiarVista(); }
  const r = (location.hash || '#/').replace(/^#/, '').split('/').filter(Boolean);
  try {
    if (!S.contenido.modulos.length) { vista(h('div', { class: 'tr-pagina' }, h('h1', null, 'Training'), U('p', null, 'sinContenido')), 'Training'); pintarMenu(); return; }
    switch (r[0]) {
      case 'm': vistaModulo(r[1]); break;
      case 'l': vistaLeccion(r[1], parseInt(r[2], 10) || 0); break;
      case 'glosario': vistaGlosario(r[1]); break;
      case 'laboratorio': vistaLab(); break;
      case 'examen': vistaExamen(); break;
      case 'diploma': vistaDiploma(); break;
      case 'admin': vistaAdmin(); break;
      default: vistaInicio();
    }
  } catch (e) { console.error(e); vista(h('div', { class: 'tr-pagina' }, h('div', { class: 'tr-error' }, ui('errorGenerico'))), 'Training'); }
  pintarMenu();
}

async function arrancar() {
  setLang(S.lang); aplicarTema();
  try {
    const [, p, m, l] = await Promise.all([cargarContenido(), api.get('/design/api/training/progreso').catch(() => ({})), api.get('/design/api/training/modelos').catch(() => []), api.get('/design/api/training/lideres').catch(() => ({}))]);
    S.lideres = l || {}; S.progreso = p || {}; S.modelos = Object.fromEntries((m || []).map((x) => [x.slot, x]));
    await cargarEditor();
  } catch (e) {
    vaciar(raiz).append(h('div', { class: 'tr-pagina' }, h('h1', null, 'Training'), h('div', { class: 'tr-error' }, ui('errorGenerico') + ' (' + e.message + ')'))); return;
  }
  iniciarGlosarioPop(); armarMarco();
  window.addEventListener('hashchange', ruta); ruta();
}
arrancar();
