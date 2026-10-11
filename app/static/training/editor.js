// Training: editor de contenido para admins (como el editor de la página de Inicio). Todo se guarda solo como borrador;
// nadie lo ve hasta que se publica el módulo. Se edita sobre la misma página: barra de edición arriba, panel del módulo,
// lección con todos sus pasos (arrastrables), panel lateral con el formulario de cada paso y biblioteca de imágenes.
import { S, h, t, md, api, toast, vaciar } from './lib.js';
import { renderPaso } from './steps.js';

let X = null;                     // funciones de training.js: vista, ir, ruta, pintarMenu, recargar, raiz, destruir
const est = {};                   // por módulo: { version, timer, guardando, cargado, error }
const raizEd = () => X.raiz;

export function iniciar(ctx) { X = ctx; }
export function olvidar() { Object.keys(est).forEach((k) => delete est[k]); }   // tras recargar el contenido del servidor

// ---------- Utilidades ----------
const clonar = (o) => JSON.parse(JSON.stringify(o));
const mods = () => S.contenido.modulos;
const modPor = (id) => mods().find((m) => m.id === id);
const info = (id) => (S.editor || {})[id] || {};
const hora = (iso) => (iso ? new Date(iso + (iso.endsWith('Z') ? '' : 'Z')).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const NOMBRE_TIPO = {
  texto: ['📝', 'Texto', 'Título, explicación y notas (por qué, dato, alerta). Puede llevar una imagen al lado.'],
  imagen: ['🖼', 'Imágenes', 'Una o varias imágenes con su explicación; se amplían al tocarlas.'],
  tarjetas: ['🃏', 'Tarjetas', 'Tarjetas que se voltean para descubrir la explicación.'],
  acordeon: ['☰', 'Acordeón', 'Preguntas o temas que se despliegan.'],
  flujo: ['➜', 'Flujo', 'Proceso paso a paso (3 o más etapas).'],
  caso: ['🧪', 'Caso de ejemplo', 'Un caso real de principio a fin, con tiempos y responsables.'],
  tabla: ['▦', 'Tabla', 'Datos en filas y columnas.'],
  checklist: ['☑', 'Lista de verificación', 'Puntos que la persona marca.'],
  resumen: ['✨', 'Resumen', 'Lo esencial de la lección en viñetas.'],
  quiz: ['🧠', 'Quiz', 'Preguntas para comprobar lo aprendido (aprobar con 70%).'],
  enlace: ['🔗', 'Enlace', 'A un protocolo oficial o a otra lección.'],
  lider: ['👤', 'Manager del área', 'Tarjeta del manager del área.'],
  modelo3d: ['🧩', 'Modelo 3D', 'Espacio para un modelo 3D (GLB, STL, OBJ o PLY).'],
  visor: ['🖥', 'Visor de caso', 'Visor HTML de un caso (pestañas RX y Changes).'],
  calculadora: ['🧮', 'Calculadora', 'Herramienta interactiva (espesor 24Z, tamaños, articulador, tiempos).'],
  simulador: ['🎛', 'Simulador', 'Simulador de movimientos (se edita en JSON).'],
  tour: ['🎬', 'Animación guiada', 'Animación de movimientos (se edita en JSON).'],
};
const PESADOS = new Set(['modelo3d', 'visor', 'simulador', 'tour', 'calculadora']);   // sin vista previa automática (WebGL)
const T = (es, en) => ({ es, en: en ?? es });
const idUnico = (base) => { const usados = new Set(mods().flatMap((m) => (m.lecciones || []).map((l) => l.id))); let n = 1, id; do { id = `${base}-l${n++}`; } while (usados.has(id)); return id; };
const slotNuevo = () => 'c-' + Math.random().toString(36).slice(2, 8);

function pasoNuevo(tipo) {
  switch (tipo) {
    case 'texto': return { t: 'texto', titulo: T('Nuevo título', 'New title'), cuerpo: T('Escribe aquí la explicación.', 'Write the explanation here.') };
    case 'imagen': return { t: 'imagen', titulo: T('Mira esta imagen', 'Look at this image'), disposicion: 'una', imagenes: [] };
    case 'tarjetas': case 'acordeon': return { t: tipo, titulo: T('Nuevo título', 'New title'), items: [1, 2].map((n) => ({ titulo: T('Tema ' + n, 'Topic ' + n), texto: T('Explicación.', 'Explanation.') })) };
    case 'flujo': return { t: 'flujo', titulo: T('Cómo funciona', 'How it works'), pasos: [1, 2, 3].map((n) => ({ titulo: T('Etapa ' + n, 'Stage ' + n), texto: T('Qué pasa aquí.', 'What happens here.') })) };
    case 'caso': return { t: 'caso', titulo: T('Caso de ejemplo', 'Example case'), contexto: T('Situación del caso.', 'Case situation.'), etapas: [1, 2, 3].map((n) => ({ titulo: T('Etapa ' + n, 'Stage ' + n), texto: T('Qué pasó.', 'What happened.') })) };
    case 'tabla': return { t: 'tabla', titulo: T('Tabla', 'Table'), cabeceras: [T('Columna 1', 'Column 1'), T('Columna 2', 'Column 2')], filas: [[T('Dato', 'Data'), T('Dato', 'Data')]] };
    case 'checklist': return { t: 'checklist', titulo: T('Antes de enviar', 'Before sending'), items: [T('Primer punto', 'First item'), T('Segundo punto', 'Second item')] };
    case 'resumen': return { t: 'resumen', titulo: T('Lo esencial', 'Key takeaways'), puntos: [T('Primera idea', 'First idea'), T('Segunda idea', 'Second idea')] };
    case 'quiz': return { t: 'quiz', preguntas: [1, 2].map(() => ({ tipo: 'una', enunciado: T('¿Pregunta?', 'Question?'), explicacion: T('Por qué esta es la respuesta.', 'Why this is the answer.'), opciones: [T('Correcta', 'Correct'), T('Opción', 'Option'), T('Opción', 'Option')].map((x, i) => ({ texto: x, ok: i === 0 })) })) };
    case 'enlace': return { t: 'enlace', titulo: T('Protocolo oficial', 'Official protocol'), texto: T('Para el detalle, revisa el protocolo.', 'For details, check the protocol.'), protocolo: '' };
    case 'lider': return { t: 'lider', area: 'face' };
    case 'modelo3d': return { t: 'modelo3d', slot: slotNuevo(), titulo: T('Modelo 3D', '3D model'), descripcion: T('Qué mirar en el modelo.', 'What to look at in the model.'), pendiente: T('Aquí irá el modelo.', 'The model will go here.') };
    case 'visor': return { t: 'visor', slot: slotNuevo(), pestana: 'rx', titulo: T('Visor de un caso', 'Case viewer'), descripcion: T('Qué mirar en el caso.', 'What to look at in the case.'), pendiente: T('Aquí irá el visor del caso.', 'The case viewer will go here.') };
    case 'calculadora': return { t: 'calculadora', id: 'tiempos', titulo: T('Calculadora', 'Calculator') };
    default: return { t: tipo };
  }
}

// ---------- Cargar y guardar ----------
async function asegurar(mid) {
  if (est[mid] && est[mid].cargado) return modPor(mid);
  const r = await api.get('/design/api/training/editor/' + mid);
  est[mid] = { ...(est[mid] || {}), version: r.version, cargado: true };
  const i = mods().findIndex((m) => m.id === mid);
  if (i >= 0) mods()[i] = r.contenido; else mods().push(r.contenido);
  return r.contenido;
}

function cambio(mid) {
  const e = est[mid] || (est[mid] = {});
  e.pendiente = true; pintarBarra();
  clearTimeout(e.timer); e.timer = setTimeout(() => guardar(mid), 700);
}

async function guardar(mid, forzar) {
  const e = est[mid]; if (!e) return;
  if (e.guardando) { clearTimeout(e.timer); e.timer = setTimeout(() => guardar(mid), 500); return; }
  e.guardando = true; e.pendiente = false; pintarBarra();
  try {
    const r = await api.post('/design/api/training/editor/' + mid, { contenido: modPor(mid), version: e.version, forzar: !!forzar });
    e.version = r.version; e.error = '';
    S.editor[mid] = { ...info(mid), hayCambios: true, actualizadoEn: r.actualizadoEn, actualizadoPor: 'tú' };
  } catch (err) {
    e.error = err.message;
    if (/después de que lo abriste/.test(err.message)) {
      if (confirm(err.message + '\n\n¿Guardar tus cambios encima de los suyos? (Cancelar = cargar la versión de la otra persona)')) { e.guardando = false; return guardar(mid, true); }
      e.cargado = false; await asegurar(mid); X.ruta();
    } else toast('No se guardó: ' + err.message, 'error');
  } finally { e.guardando = false; pintarBarra(); }
}
const esperarGuardado = async (mid) => { const e = est[mid]; if (!e) return; if (e.timer && e.pendiente) { clearTimeout(e.timer); await guardar(mid); } while (e.guardando) await new Promise((r) => setTimeout(r, 120)); };

// ---------- Barra de edición ----------
let barraEl = null, barraMod = null;
export function barra(mid) {
  barraMod = mid || null;
  barraEl = h('div', { class: 'tr-ed-barra', role: 'region', 'aria-label': 'Modo edición' });
  pintarBarra();
  return barraEl;
}
function pintarBarra() {
  if (!barraEl) return;
  const mid = barraMod, m = mid && modPor(mid), i = mid ? info(mid) : null, e = mid ? est[mid] || {} : {};
  const pendientes = Object.entries(S.editor || {}).filter(([, v]) => v.hayCambios || v.eliminarPendiente);
  let estado;
  if (mid) {
    if (e.guardando || e.pendiente) estado = h('span', { class: 'tr-ed-est guardando' }, '⏳ Guardando…');
    else if (e.error) estado = h('span', { class: 'tr-ed-est error' }, '⚠ No se guardó');
    else if (i.hayCambios) estado = h('span', { class: 'tr-ed-est borrador' }, '● Cambios sin publicar' + (i.actualizadoEn ? ' · guardado ' + hora(i.actualizadoEn) : ''));
    else estado = h('span', { class: 'tr-ed-est ok' }, '✓ Publicado' + (i.publicadoEn ? ' · ' + hora(i.publicadoEn) + (i.publicadoPor ? ' por ' + i.publicadoPor : '') : ''));
  } else estado = h('span', { class: 'tr-ed-est ' + (pendientes.length ? 'borrador' : 'ok') }, pendientes.length ? `● ${pendientes.length} módulo(s) con cambios sin publicar` : '✓ Todo publicado');
  barraEl.replaceChildren(...[
    h('span', { class: 'tr-ed-marca' }, '✏️ Modo edición'), m ? h('b', { class: 'tr-ed-mod' }, t(m.titulo)) : null, estado,
    h('span', { class: 'tr-ed-esp' }),
    mid && X.esLeccion() ? h('button', { type: 'button', class: 'tr-btn tr-btn-chico', onclick: () => { S.vistaAlumno = !S.vistaAlumno; X.ruta(); } }, S.vistaAlumno ? '✏️ Volver a editar' : '👁 Ver como alumno') : null,
    mid ? h('button', { type: 'button', class: 'tr-btn tr-btn-chico', onclick: () => historial(mid) }, '🕘 Historial') : null,
    mid && i.hayCambios ? h('button', { type: 'button', class: 'tr-btn tr-btn-chico', onclick: () => descartar(mid) }, 'Descartar cambios') : null,
    mid ? h('button', { type: 'button', class: 'tr-btn tr-btn-chico tr-btn-primario', disabled: !i.hayCambios && !e.pendiente, onclick: () => publicar([mid]) }, '🚀 Publicar') : null,
    !mid && pendientes.length ? h('button', { type: 'button', class: 'tr-btn tr-btn-chico tr-btn-primario', onclick: () => publicar(pendientes.map(([k]) => k)) }, '🚀 Publicar todo') : null,
    h('button', { type: 'button', class: 'tr-btn tr-btn-chico', title: 'Salir del modo edición', onclick: () => X.salirEdicion() }, 'Salir')].filter(Boolean));
}

async function publicar(ids) {
  for (const id of ids) await esperarGuardado(id);
  const nombres = ids.map((id) => (modPor(id) ? t(modPor(id).titulo) : id));
  if (!await dialogo('Publicar', h('div', null, h('p', null, 'Todos los que entran a Training verán esta versión de:'), h('ul', null, nombres.map((n) => h('li', null, n))), h('p', { class: 'tr-sub' }, 'La versión anterior queda en el Historial por si necesitas volver a ella.')), 'Publicar')) return;
  const fallos = [];
  for (const id of ids) {
    try { await api.post('/design/api/training/editor/' + id + '/publicar', {}); } catch (e) { fallos.push([id, e.message]); }
  }
  await X.recargar();
  if (fallos.length) dialogo('Falta revisar algo', h('div', null, fallos.map(([id, msg]) => h('div', { class: 'tr-error tr-ed-fallo' }, h('b', null, (modPor(id) ? t(modPor(id).titulo) : id) + ': '), msg))), null);
  else toast('🚀 Publicado', 'ok');
}
async function descartar(mid) {
  if (!await dialogo('Descartar cambios', h('p', null, 'El módulo vuelve a quedar como está publicado. Los cambios sin publicar se pierden.'), 'Descartar', true)) return;
  await esperarGuardado(mid);
  await api.post('/design/api/training/editor/' + mid + '/descartar', {});
  delete est[mid]; await X.recargar(); toast('Cambios descartados');
}
async function historial(mid) {
  const lista = await api.get('/design/api/training/editor/' + mid + '/versiones');
  const cuerpo = h('div', { class: 'tr-ed-hist' }, lista.length ? lista.map((v, i) => h('div', { class: 'tr-ed-hist-it' }, h('div', null, h('b', null, hora(v.publicadoEn)), i === 0 ? h('span', { class: 'tr-chip-estado hecho' }, 'Actual') : null, h('div', { class: 'tr-sub' }, v.publicadoPor)),
    i === 0 ? null : h('button', { type: 'button', class: 'tr-btn tr-btn-chico', onclick: async () => {
      await api.post(`/design/api/training/editor/${mid}/versiones/${v.id}/restaurar`, {}); cerrarDialogo(); delete est[mid]; await X.recargar(); toast('Versión restaurada como borrador: revísala y publícala');
    } }, 'Restaurar'))) : h('p', { class: 'tr-sub' }, 'Este módulo todavía no se ha publicado desde el editor (lo que se ve es la versión original del curso).'));
  dialogo('Historial de publicaciones', cuerpo, null);
}

// ---------- Diálogos ----------
let cerrarDialogo = () => {};
function dialogo(titulo, cuerpo, aceptar, peligro) {
  return new Promise((res) => {
    const fin = (v) => { fondo.remove(); document.removeEventListener('keydown', tecla, true); res(v); };
    const tecla = (e) => { if (e.key === 'Escape') { e.stopPropagation(); fin(false); } };
    cerrarDialogo = () => fin(false);
    const fondo = h('div', { class: 'tr-modal-fondo', onclick: (e) => { if (e.target === fondo) fin(false); } },
      h('div', { class: 'tr-modal tr-ed-modal', role: 'dialog', 'aria-modal': 'true' }, h('h3', null, titulo), cuerpo,
        h('div', { class: 'tr-modal-acc' }, h('button', { type: 'button', class: 'tr-btn', onclick: () => fin(false) }, aceptar ? 'Cancelar' : 'Cerrar'),
          aceptar ? h('button', { type: 'button', class: 'tr-btn ' + (peligro ? 'tr-btn-peligro' : 'tr-btn-primario'), onclick: () => fin(true) }, aceptar) : null)));
    document.addEventListener('keydown', tecla, true);
    raizEd().append(fondo);
  });
}

// ---------- Campos de formulario ----------
function autoAlto(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(420, ta.scrollHeight + 2) + 'px'; }
// Texto bilingüe: ES y EN lado a lado
function fT(obj, clave, etiqueta, o = {}, alCambiar) {
  const v = obj[clave] || { es: '', en: '' };
  const mk = (l) => {
    const props = { class: 'tr-in', value: v[l] || '', placeholder: l === 'es' ? 'Español' : 'English', 'aria-label': etiqueta + ' ' + l.toUpperCase(),
      oninput: (e) => { if (o.multi) autoAlto(e.target); const n = { es: l === 'es' ? e.target.value : (obj[clave] || {}).es || '', en: l === 'en' ? e.target.value : (obj[clave] || {}).en || '' };
        if (o.opcional && !n.es.trim() && !n.en.trim()) delete obj[clave]; else obj[clave] = n; alCambiar(); } };
    const el = o.multi ? h('textarea', { ...props, rows: o.filas || 3 }) : h('input', props);
    if (o.multi) { el.value = v[l] || ''; setTimeout(() => autoAlto(el), 0); }
    return h('label', { class: 'tr-ed-lang' }, h('span', { class: 'tr-ed-l' }, l.toUpperCase()), el);
  };
  return h('div', { class: 'tr-ed-campo' }, h('div', { class: 'tr-ed-etq' }, etiqueta, o.opcional ? h('small', null, ' · opcional') : null, o.ayuda ? h('small', { class: 'tr-ed-ayuda' }, o.ayuda) : null),
    h('div', { class: 'tr-ed-bi' }, mk('es'), mk('en')));
}
function fTxt(obj, clave, etiqueta, o = {}, alCambiar) {
  const set = (val) => { if (o.numero) val = val === '' ? undefined : Number(val); if (val === undefined || val === '') delete obj[clave]; else obj[clave] = val; alCambiar(); };
  const el = o.opciones
    ? h('select', { class: 'tr-in', onchange: (e) => set(e.target.value) }, o.opciones.map(([v, rot]) => h('option', { value: v, selected: String(obj[clave] ?? o.defecto ?? '') === String(v) }, rot)))
    : h('input', { class: 'tr-in', type: o.numero ? 'number' : 'text', value: obj[clave] ?? '', placeholder: o.ph || '', oninput: (e) => set(e.target.value) });
  return h('label', { class: 'tr-ed-campo' }, h('span', { class: 'tr-ed-etq' }, etiqueta, o.ayuda ? h('small', { class: 'tr-ed-ayuda' }, o.ayuda) : null), el);
}
function fBool(obj, clave, etiqueta, alCambiar) {
  return h('label', { class: 'tr-ed-check' }, h('input', { type: 'checkbox', checked: !!obj[clave], onchange: (e) => { obj[clave] = e.target.checked; alCambiar(); } }), etiqueta);
}

// Lista de elementos arrastrables (mover, eliminar, agregar)
function fLista(arr, etiqueta, crear, dibujar, alCambiar, o = {}) {
  const cont = h('div', { class: 'tr-ed-lista' });
  let arrastrando = null;
  const pintar = () => {
    cont.replaceChildren(...arr.map((it, i) => {
      const fila = h('div', { class: 'tr-ed-item', draggable: 'false' },
        h('div', { class: 'tr-ed-item-cab' },
          h('span', { class: 'tr-ed-asa', title: 'Arrastra para mover', onmousedown: () => { fila.draggable = true; }, onmouseup: () => { fila.draggable = false; } }, '⠿'),
          h('b', null, (o.nombre || 'Elemento') + ' ' + (i + 1)), o.resumen ? h('span', { class: 'tr-ed-item-res' }, o.resumen(it)) : null, h('span', { class: 'tr-ed-esp' }),
          h('button', { type: 'button', class: 'tr-ed-ib', title: 'Subir', disabled: i === 0, onclick: () => { arr.splice(i - 1, 0, arr.splice(i, 1)[0]); pintar(); alCambiar(); } }, '↑'),
          h('button', { type: 'button', class: 'tr-ed-ib', title: 'Bajar', disabled: i === arr.length - 1, onclick: () => { arr.splice(i + 1, 0, arr.splice(i, 1)[0]); pintar(); alCambiar(); } }, '↓'),
          h('button', { type: 'button', class: 'tr-ed-ib peligro', title: 'Eliminar', disabled: arr.length <= (o.min || 0), onclick: () => { arr.splice(i, 1); pintar(); alCambiar(); } }, '✕')),
        h('div', { class: 'tr-ed-item-cuerpo' }, dibujar(it, i, (nuevo) => { arr[i] = nuevo; alCambiar(); })));
      fila.addEventListener('dragstart', (e) => { arrastrando = i; e.dataTransfer.effectAllowed = 'move'; fila.classList.add('arrastrando'); });
      fila.addEventListener('dragend', () => { fila.draggable = false; fila.classList.remove('arrastrando'); cont.querySelectorAll('.sobre').forEach((x) => x.classList.remove('sobre')); });
      fila.addEventListener('dragover', (e) => { if (arrastrando === null) return; e.preventDefault(); fila.classList.add('sobre'); });
      fila.addEventListener('dragleave', () => fila.classList.remove('sobre'));
      fila.addEventListener('drop', (e) => { e.preventDefault(); if (arrastrando === null || arrastrando === i) return; const x = arr.splice(arrastrando, 1)[0]; arr.splice(i, 0, x); arrastrando = null; pintar(); alCambiar(); });
      return fila;
    }));
  };
  pintar();
  return h('div', { class: 'tr-ed-campo' }, h('div', { class: 'tr-ed-etq' }, etiqueta, o.ayuda ? h('small', { class: 'tr-ed-ayuda' }, o.ayuda) : null), cont,
    o.max && arr.length >= o.max ? null : h('button', { type: 'button', class: 'tr-btn tr-btn-chico tr-ed-agregar', onclick: async () => { const n = await crear(); if (n == null) return; arr.push(n); pintar(); alCambiar(); } }, '＋ ' + (o.agregar || 'Agregar')));
}

// ---------- Imágenes ----------
async function subirImagen(archivo) {
  const fd = new FormData(); fd.append('archivo', archivo);
  try { const dims = await new Promise((res) => { const im = new Image(); im.onload = () => res([im.naturalWidth, im.naturalHeight]); im.onerror = () => res([0, 0]); im.src = URL.createObjectURL(archivo); }); fd.append('ancho', dims[0]); fd.append('alto', dims[1]); } catch (e) { /* sin medidas */ }
  const m = await api.subir('/design/api/inicio/medios', fd);
  return { src: m.url };
}
const esImagen = (f) => /^image\//.test(f.type);
async function subirVarias(archivos) {
  const out = [];
  for (const f of [...archivos].filter(esImagen)) {
    toast('Subiendo ' + f.name + '…');
    try { out.push(await subirImagen(f)); } catch (e) { toast(f.name + ': ' + e.message, 'error'); }
  }
  return out;
}

// Biblioteca: imágenes de los protocolos (incluidas) + biblioteca de medios (subidas). Devuelve [{src, pie?, fuente?}]
function elegirImagenes(multiple) {
  return new Promise((res) => {
    let tab = 'protocolos', elegidas = [], cache = {};
    const zona = h('div', { class: 'tr-ed-bib-zona' }), cuenta = h('span', { class: 'tr-sub' });
    const fin = (v) => { fondo.remove(); document.removeEventListener('keydown', tecla, true); res(v); };
    const tecla = (e) => { if (e.key === 'Escape') { e.stopPropagation(); fin(null); } };
    const inp = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: async () => { const l = await subirVarias(inp.files); inp.value = ''; if (l.length) { delete cache.medios; tab = 'medios'; elegidas.push(...l); await pintar(); } } });
    const tabs = h('div', { class: 'tr-seg' });
    const btnOk = h('button', { type: 'button', class: 'tr-btn tr-btn-primario', onclick: () => fin(elegidas) }, 'Insertar');
    async function pintar() {
      tabs.replaceChildren(...[['protocolos', '📄 Imágenes de los protocolos'], ['medios', '🗂 Biblioteca de medios']].map(([k, r]) => h('button', { type: 'button', class: 'tr-seg-b' + (tab === k ? ' on' : ''), onclick: () => { tab = k; pintar(); } }, r)));
      cuenta.textContent = elegidas.length ? `${elegidas.length} elegida(s)` : (multiple ? 'Elige una o varias' : 'Elige una');
      btnOk.disabled = !elegidas.length;
      if (!cache[tab]) {
        zona.replaceChildren(h('div', { class: 'tr-cargando-mini' }, h('div', { class: 'tr-spinner' }), 'Cargando…'));
        try {
          cache[tab] = tab === 'protocolos' ? await api.get('/design/api/training/imagenes')
            : (await api.get('/design/api/inicio/medios')).filter((m) => m.tipo === 'imagen').map((m) => ({ src: m.url, nombre: m.nombre }));
        } catch (e) { zona.replaceChildren(h('div', { class: 'tr-error' }, e.message)); return; }
      }
      const lista = cache[tab];
      zona.replaceChildren(lista.length ? h('div', { class: 'tr-ed-bib-grid' }, lista.map((im) => {
        const on = elegidas.some((x) => x.src === im.src);
        return h('button', { type: 'button', class: 'tr-ed-bib-it' + (on ? ' on' : ''), title: im.nombre || '', onclick: () => {
          if (on) elegidas = elegidas.filter((x) => x.src !== im.src); else { const x = { src: im.src }; if (im.pie) x.pie = clonar(im.pie); if (im.fuente) x.fuente = im.fuente; if (multiple) elegidas.push(x); else elegidas = [x]; }
          pintar();
        } }, h('img', { src: im.src, alt: '' }), h('span', { class: 'tr-ed-bib-n' }, im.grupo ? im.grupo + ' · ' : '', im.nombre || ''), on ? h('i', null, '✓') : null);
      })) : h('div', { class: 'tr-vacio' }, tab === 'medios' ? 'Todavía no hay imágenes en la biblioteca. Súbelas con el botón o arrástralas aquí.' : 'No hay imágenes incluidas.'));
    }
    const fondo = h('div', { class: 'tr-modal-fondo', onclick: (e) => { if (e.target === fondo) fin(null); } },
      h('div', { class: 'tr-modal tr-ed-bib', role: 'dialog', 'aria-modal': 'true',
        ondragover: (e) => { e.preventDefault(); fondo.classList.add('soltar'); }, ondragleave: () => fondo.classList.remove('soltar'),
        ondrop: async (e) => { e.preventDefault(); fondo.classList.remove('soltar'); const l = await subirVarias(e.dataTransfer.files); if (l.length) { delete cache.medios; tab = 'medios'; elegidas.push(...(multiple ? l : l.slice(0, 1))); pintar(); } } },
        h('div', { class: 'tr-ed-bib-cab' }, h('h3', null, '🖼 Elegir imagen' + (multiple ? 'es' : '')), inp, h('button', { type: 'button', class: 'tr-btn tr-btn-chico', onclick: () => inp.click() }, '⬆ Subir desde el computador')),
        h('p', { class: 'tr-sub' }, 'También puedes arrastrar imágenes desde tu computador a esta ventana. Las que subas quedan en la biblioteca de medios de Design.'),
        tabs, zona, h('div', { class: 'tr-modal-acc' }, cuenta, h('span', { class: 'tr-ed-esp' }), h('button', { type: 'button', class: 'tr-btn', onclick: () => fin(null) }, 'Cancelar'), btnOk)));
    document.addEventListener('keydown', tecla, true);
    raizEd().append(fondo); pintar();
  });
}

function miniatura(im, alCambiar, quitar) {
  return h('div', { class: 'tr-ed-img' }, h('img', { src: im.src, alt: '' }),
    h('div', { class: 'tr-ed-img-acc' }, h('button', { type: 'button', class: 'tr-btn tr-btn-chico', onclick: async () => { const l = await elegirImagenes(false); if (l && l[0]) { im.src = l[0].src; alCambiar(true); } } }, '🔄 Cambiar'),
      quitar ? h('button', { type: 'button', class: 'tr-btn tr-btn-chico tr-btn-peligro', onclick: quitar }, 'Quitar') : null));
}

// ---------- Formulario de cada tipo de paso ----------
function formPaso(p, alCambiar, repintarForm) {
  const c = alCambiar, f = [];
  const tit = (opc) => fT(p, 'titulo', 'Título', { opcional: opc }, c);
  const itemsTT = (arr, nombre, conIcono) => fLista(arr, nombre + 's', () => ({ titulo: T('Nuevo', 'New'), texto: T('Explicación.', 'Explanation.') }),
    (it) => h('div', null, conIcono ? fTxt(it, 'icono', 'Icono (emoji)', { ph: '◆' }, c) : null, fT(it, 'titulo', 'Título', {}, c), fT(it, 'texto', 'Texto', { multi: true }, c)), c,
    { nombre, agregar: 'Agregar ' + nombre.toLowerCase(), min: 1, resumen: (it) => t(it.titulo) });
  switch (p.t) {
    case 'texto': {
      f.push(tit(), fT(p, 'cuerpo', 'Texto', { multi: true, filas: 6, ayuda: '**negrita**, *cursiva*, y listas empezando la línea con "- "' }, c),
        fT(p, 'porque', '💡 Por qué importa', { multi: true, opcional: true }, c), fT(p, 'dato', '📌 Dato', { multi: true, opcional: true }, c), fT(p, 'alerta', '⚠️ Alerta', { multi: true, opcional: true }, c));
      const zonaImg = h('div', { class: 'tr-ed-campo' }, h('div', { class: 'tr-ed-etq' }, 'Imagen al lado del texto', h('small', null, ' · opcional')));
      if (p.imagen && p.imagen.src) {
        zonaImg.append(miniatura(p.imagen, () => { c(); repintarForm(); }, () => { delete p.imagen; c(); repintarForm(); }),
          fTxt(p.imagen, 'lado', 'Posición', { opciones: [['der', 'A la derecha del texto'], ['izq', 'A la izquierda del texto'], ['arriba', 'Arriba del texto'], ['abajo', 'Debajo del texto']], defecto: 'der' }, c),
          fT(p.imagen, 'pie', 'Pie de imagen', { opcional: true, multi: true, filas: 2 }, c));
      } else zonaImg.append(h('button', { type: 'button', class: 'tr-btn tr-btn-chico', onclick: async () => { const l = await elegirImagenes(false); if (l && l[0]) { p.imagen = { ...l[0], lado: 'der' }; c(); repintarForm(); } } }, '🖼 Agregar imagen'));
      f.push(zonaImg);
      break;
    }
    case 'imagen':
      p.imagenes = p.imagenes || [];
      f.push(tit(true), fTxt(p, 'disposicion', 'Cómo se acomodan', { opciones: [['una', 'Una debajo de otra (grandes)'], ['dos', 'Dos por fila'], ['tres', 'Tres por fila']], defecto: 'una' }, c),
        fLista(p.imagenes, 'Imágenes', async () => { const l = await elegirImagenes(true); if (!l || !l.length) return null; l.slice(1).forEach((x) => p.imagenes.push(x)); setTimeout(repintarForm, 0); return l[0]; },
          (im) => h('div', null, miniatura(im, () => { c(); repintarForm(); }), fT(im, 'pie', 'Pie de imagen (qué mirar y por qué)', { opcional: true, multi: true, filas: 2 }, c), fTxt(im, 'fuente', 'Fuente', { ph: 'Protocolo…' }, c)),
          c, { nombre: 'Imagen', agregar: 'Agregar imágenes', max: 6, ayuda: 'Arrastra ⠿ para cambiar el orden.' }));
      break;
    case 'tarjetas': f.push(tit(), itemsTT(p.items, 'Tarjeta', true)); break;
    case 'acordeon': f.push(tit(), itemsTT(p.items, 'Tema')); break;
    case 'flujo': f.push(tit(), itemsTT(p.pasos, 'Etapa')); break;
    case 'caso':
      f.push(tit(), fT(p, 'contexto', 'Contexto', { multi: true }, c),
        fLista(p.etapas, 'Etapas', () => ({ titulo: T('Etapa', 'Stage'), texto: T('Qué pasó.', 'What happened.') }), (it) => h('div', null, fT(it, 'titulo', 'Título', {}, c), fT(it, 'texto', 'Texto', { multi: true }, c), fT(it, 'tiempo', '⏱ Tiempo', { opcional: true }, c), fT(it, 'quien', '👤 Quién', { opcional: true }, c)), c, { nombre: 'Etapa', agregar: 'Agregar etapa', min: 1, resumen: (it) => t(it.titulo) }),
        fT(p, 'resultado', '✅ Resultado', { multi: true, opcional: true }, c));
      break;
    case 'checklist': f.push(tit(), fLista(p.items, 'Puntos', () => T('Nuevo punto', 'New item'), (it, i, set) => bi(it, set), c, { nombre: 'Punto', min: 1 })); break;
    case 'resumen': f.push(tit(true), fLista(p.puntos, 'Puntos', () => T('Nueva idea', 'New idea'), (it, i, set) => bi(it, set), c, { nombre: 'Punto', min: 1 })); break;
    case 'tabla': f.push(tit(), formTabla(p, c, repintarForm)); break;
    case 'quiz': f.push(fLista(p.preguntas, 'Preguntas', () => ({ tipo: 'una', enunciado: T('¿Pregunta?', 'Question?'), explicacion: T('Por qué.', 'Why.'), opciones: [0, 1, 2].map((i) => ({ texto: T(i ? 'Opción' : 'Correcta', i ? 'Option' : 'Correct'), ok: !i })) }),
      (q) => formPregunta(q, c), c, { nombre: 'Pregunta', agregar: 'Agregar pregunta', min: 1, max: 6, resumen: (q) => t(q.enunciado) })); break;
    case 'enlace':
      f.push(tit(), fT(p, 'texto', 'Texto', { multi: true }, c),
        fTxt(p, 'lecc', 'Lleva a la lección', { opciones: [['', '— Ninguna (usar protocolo) —'], ...mods().flatMap((m) => (m.lecciones || []).map((l) => [l.id, t(m.titulo) + ' › ' + t(l.titulo)]))] }, c),
        fTxt(p, 'protocolo', 'O busca este protocolo en Protocols', { ph: 'Nombre del protocolo' }, c));
      break;
    case 'lider': f.push(fTxt(p, 'area', 'Área', { opciones: [['face', 'Face Design'], ['n2', 'N2 Demodenture'], ['n3', 'N3 Prosthetic'], ['n6', 'N6 Material Changes'], ['support', 'Support'], ['todas', 'Todas las áreas']] }, c), fT(p, 'texto', 'Texto', { multi: true, opcional: true }, c)); break;
    case 'modelo3d': case 'visor':
      f.push(tit(), fT(p, 'descripcion', 'Qué mirar', { multi: true }, c), fT(p, 'pendiente', 'Mensaje mientras no hay archivo', { multi: true }, c),
        fTxt(p, 'slot', 'Espacio (identificador del archivo)', { ayuda: 'Minúsculas, números y guiones. El archivo se sube en este mismo paso o en Administrar › Modelos 3D.' }, c),
        p.t === 'visor' ? fTxt(p, 'pestana', 'Abre en la pestaña', { opciones: [['rx', 'RX'], ['changes', 'Changes']], defecto: 'rx' }, c) : null);
      break;
    case 'calculadora': f.push(tit(), fTxt(p, 'id', 'Herramienta', { opciones: [['espesor24z', 'Espesor 24Z'], ['tamanos', 'Tamaños de arco'], ['articulador', 'Articulador'], ['tiempos', 'Tiempos de diseño']] }, c), fT(p, 'guia', 'Guía', { multi: true, opcional: true }, c)); break;
    default: f.push(h('p', { class: 'tr-sub' }, 'Este tipo de paso se edita en la pestaña "Avanzado (JSON)".'));
  }
  return f.filter(Boolean);
}
// texto bilingüe suelto (elemento de lista que es directamente {es, en})
function bi(it, set) { const caja = { v: it }; return fT(caja, 'v', 'Texto', { multi: true, filas: 2 }, () => set(caja.v || T(''))); }

function formPregunta(q, c) {
  const zona = h('div');
  const pintar = () => {
    const tipo = fTxt(q, 'tipo', 'Tipo de pregunta', { opciones: [['una', 'Una respuesta correcta'], ['varias', 'Varias respuestas correctas'], ['vf', 'Verdadero o falso'], ['orden', 'Ordenar'], ['parejas', 'Unir parejas']] }, () => { ajustar(); c(); pintar(); });
    const partes = [tipo, fT(q, 'enunciado', 'Pregunta', { multi: true, filas: 2 }, c)];
    if (q.tipo === 'una' || q.tipo === 'varias') partes.push(fLista(q.opciones, 'Opciones', () => ({ texto: T('Opción', 'Option'), ok: false }), (o) => h('div', null, fT(o, 'texto', 'Texto', {}, c), fBool(o, 'ok', '✓ Es correcta', c)), c, { nombre: 'Opción', min: 3, max: 5, agregar: 'Agregar opción', resumen: (o) => (o.ok ? '✓ ' : '') + t(o.texto) }));
    if (q.tipo === 'vf') partes.push(fTxt(q, 'ok', 'Respuesta correcta', { opciones: [['true', 'Verdadero'], ['false', 'Falso']] }, () => { q.ok = q.ok === 'true' || q.ok === true; c(); }));
    if (q.tipo === 'orden') partes.push(fLista(q.items, 'Elementos en el orden correcto', () => T('Elemento', 'Item'), (it, i, set) => bi(it, set), c, { nombre: 'Elemento', min: 3, max: 7, ayuda: 'Escríbelos en el orden correcto; se mezclan al mostrarlos.' }));
    if (q.tipo === 'parejas') partes.push(fLista(q.pares, 'Parejas', () => ({ a: T('Concepto', 'Concept'), b: T('Pareja', 'Match') }), (pr) => h('div', null, fT(pr, 'a', 'Izquierda', {}, c), fT(pr, 'b', 'Derecha', {}, c)), c, { nombre: 'Pareja', min: 3, max: 6 }));
    partes.push(fT(q, 'explicacion', 'Explicación (se muestra al responder)', { multi: true, filas: 2 }, c));
    zona.replaceChildren(...partes);
  };
  const ajustar = () => {
    if ((q.tipo === 'una' || q.tipo === 'varias') && !q.opciones) q.opciones = [0, 1, 2].map((i) => ({ texto: T('Opción ' + (i + 1), 'Option ' + (i + 1)), ok: !i }));
    if (q.tipo === 'varias' && q.opciones.filter((o) => o.ok).length < 2) q.opciones.slice(0, 2).forEach((o) => { o.ok = true; });
    if (q.tipo === 'vf' && typeof q.ok !== 'boolean') q.ok = true;
    if (q.tipo === 'orden' && !q.items) q.items = [1, 2, 3].map((n) => T('Paso ' + n, 'Step ' + n));
    if (q.tipo === 'parejas' && !q.pares) q.pares = [1, 2, 3].map((n) => ({ a: T('Concepto ' + n, 'Concept ' + n), b: T('Pareja ' + n, 'Match ' + n) }));
  };
  pintar();
  return zona;
}

function formTabla(p, c, repintar) {
  p.cabeceras = p.cabeceras || []; p.filas = p.filas || [];
  const celda = (v, set) => h('div', { class: 'tr-ed-celda' }, h('input', { class: 'tr-in', value: v.es || '', placeholder: 'ES', oninput: (e) => { v.es = e.target.value; set(v); } }), h('input', { class: 'tr-in', value: v.en || '', placeholder: 'EN', oninput: (e) => { v.en = e.target.value; set(v); } }));
  const tabla = h('table', { class: 'tr-ed-tabla' },
    h('thead', null, h('tr', null, p.cabeceras.map((cb, j) => h('th', null, celda(cb, (v) => { p.cabeceras[j] = v; c(); }), h('button', { type: 'button', class: 'tr-ed-ib peligro', title: 'Quitar columna', disabled: p.cabeceras.length <= 1, onclick: () => { p.cabeceras.splice(j, 1); p.filas.forEach((f) => f.splice(j, 1)); c(); repintar(); } }, '✕'))), h('th'))),
    h('tbody', null, p.filas.map((fila, i) => h('tr', null, fila.map((v, j) => h('td', null, celda(v, (x) => { fila[j] = x; c(); }))),
      h('td', null, h('button', { type: 'button', class: 'tr-ed-ib', title: 'Subir', disabled: !i, onclick: () => { p.filas.splice(i - 1, 0, p.filas.splice(i, 1)[0]); c(); repintar(); } }, '↑'),
        h('button', { type: 'button', class: 'tr-ed-ib peligro', title: 'Quitar fila', onclick: () => { p.filas.splice(i, 1); c(); repintar(); } }, '✕'))))));
  return h('div', { class: 'tr-ed-campo' }, h('div', { class: 'tr-ed-etq' }, 'Tabla'), h('div', { class: 'tr-tabla-w' }, tabla),
    h('div', { class: 'tr-acc' }, h('button', { type: 'button', class: 'tr-btn tr-btn-chico', onclick: () => { p.filas.push(p.cabeceras.map(() => T(''))); c(); repintar(); } }, '＋ Fila'),
      h('button', { type: 'button', class: 'tr-btn tr-btn-chico', onclick: () => { p.cabeceras.push(T('Columna', 'Column')); p.filas.forEach((f) => f.push(T(''))); c(); repintar(); } }, '＋ Columna')));
}

// ---------- Panel lateral (editar un paso) ----------
let panelAbierto = null;
function abrirPanel(titulo, construir, alCerrar) {
  cerrarPanel();
  const cuerpo = h('div', { class: 'tr-ed-panel-cuerpo' });
  let tab = 'form';
  const tabs = h('div', { class: 'tr-seg' });
  const panel = h('aside', { class: 'tr-ed-panel', role: 'dialog', 'aria-label': titulo },
    h('div', { class: 'tr-ed-panel-cab' }, h('h3', null, titulo), h('button', { type: 'button', class: 'tr-ed-ib', 'aria-label': 'Cerrar', onclick: () => cerrarPanel() }, '✕')), tabs, cuerpo,
    h('div', { class: 'tr-ed-panel-pie tr-sub' }, 'Los cambios se guardan solos como borrador. Nadie los ve hasta que publiques.'));
  const pintar = () => {
    const opciones = construir.json ? [['form', 'Contenido'], ['json', 'Avanzado (JSON)']] : [['form', 'Contenido']];
    tabs.replaceChildren(...opciones.map(([k, r]) => h('button', { type: 'button', class: 'tr-seg-b' + (tab === k ? ' on' : ''), onclick: () => { tab = k; pintar(); } }, r)));
    tabs.hidden = opciones.length < 2;
    vaciar(cuerpo).append(...(tab === 'json' ? construir.json(pintar) : construir.form(pintar)));
  };
  const tecla = (e) => { if (e.key === 'Escape' && !document.querySelector('.tr-modal-fondo, .tr-lightbox')) { e.stopPropagation(); cerrarPanel(); } };
  document.addEventListener('keydown', tecla, true);
  panelAbierto = { el: panel, cerrar: () => { document.removeEventListener('keydown', tecla, true); panel.remove(); raizEd().classList.remove('con-panel'); if (alCerrar) alCerrar(); } };
  raizEd().append(panel); raizEd().classList.add('con-panel');
  pintar();
  return panelAbierto;
}
export function cerrarPanel() { if (panelAbierto) { const p = panelAbierto; panelAbierto = null; p.cerrar(); } }

function editorJSON(obj, aplicar) {
  const ta = h('textarea', { class: 'tr-in tr-ed-json', spellcheck: 'false' }); ta.value = JSON.stringify(obj, null, 2);
  const err = h('div', { class: 'tr-sub' });
  return [h('p', { class: 'tr-sub' }, 'Edición avanzada: cambia el JSON y pulsa Aplicar. Formato descrito en static/training/README.md.'), ta, err,
    h('button', { type: 'button', class: 'tr-btn tr-btn-primario tr-btn-chico', onclick: () => { try { const v = JSON.parse(ta.value); if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Debe ser un objeto { … }'); aplicar(v); err.textContent = '✓ Aplicado'; } catch (e) { err.textContent = '⚠ ' + e.message; } } }, 'Aplicar')];
}

// ---------- Inicio: módulos nuevos y módulos por quitar ----------
export function decorarInicio(pagina) {
  const pend = Object.entries(S.editor || {}).filter(([id, v]) => v.eliminarPendiente);
  const caja = h('section', { class: 'tr-seccion tr-ed-inicio' }, h('h2', null, '✏️ Contenido del curso'),
    h('p', { class: 'tr-sub' }, 'Abre cualquier módulo para editarlo: textos, lecciones, pasos, imágenes y quizzes. Todo queda como borrador hasta que lo publiques.'),
    h('div', { class: 'tr-acc' }, h('button', { type: 'button', class: 'tr-btn tr-btn-primario', onclick: nuevoModulo }, '＋ Nuevo módulo')),
    pend.length ? h('div', { class: 'tr-ed-quitar' }, h('b', null, 'Módulos que se quitarán al publicar:'), pend.map(([id]) => h('div', { class: 'tr-ed-quitar-it' }, h('code', null, id),
      h('button', { type: 'button', class: 'tr-btn tr-btn-chico', onclick: async () => { await api.post('/design/api/training/editor/' + id + '/descartar', {}); await X.recargar(); } }, 'No quitarlo'),
      h('button', { type: 'button', class: 'tr-btn tr-btn-chico tr-btn-peligro', onclick: () => publicar([id]) }, 'Quitar ya')))) : null);
  pagina.querySelector('.tr-hero')?.after(caja);
  pagina.querySelectorAll('a.tr-mod-card').forEach((a) => {
    const id = (a.getAttribute('href') || '').replace('#/m/', ''), i = info(id);
    if (i.hayCambios) a.querySelector('.tr-mod-top')?.append(h('span', { class: 'tr-chip-ed' }, i.publicado ? '✏️ Sin publicar' : '🆕 Borrador'));
  });
}
async function nuevoModulo() {
  const d = { tituloEs: '', tituloEn: '', seccion: 'biblioteca', area: 'face' };
  const area = fTxt(d, 'area', 'Área', { opciones: [['face', 'Face Design'], ['n2', 'N2 Demodenture'], ['n3', 'N3 Prosthetic'], ['n6', 'N6 Material Changes'], ['support', 'Support']] }, () => {});
  const sec = fTxt(d, 'seccion', 'Dónde va', { opciones: [['intro', 'Empieza aquí'], ['area', 'Las áreas del departamento'], ['biblioteca', 'Biblioteca de referencia']] }, () => { area.hidden = d.seccion !== 'area'; });
  area.hidden = true;
  const cuerpo = h('div', { class: 'tr-ed-form' }, fTxt(d, 'tituloEs', 'Título en español', {}, () => {}), fTxt(d, 'tituloEn', 'Título en inglés', {}, () => {}), sec, area);
  if (!await dialogo('Nuevo módulo', cuerpo, 'Crear')) return;
  try { const r = await api.post('/design/api/training/editor-nuevo', d); await X.recargar(); X.ir('#/m/' + r.id); toast('Módulo creado como borrador'); } catch (e) { toast(e.message, 'error'); }
}

// ---------- Módulo: datos, lecciones y glosario ----------
export async function decorarModulo(pagina, m0) {
  const m = await asegurar(m0.id);
  const c = () => cambio(m.id);
  const panel = h('section', { class: 'tr-ed-modulo' });
  let tab = 'lecciones';
  const pintar = () => {
    const tabs = h('div', { class: 'tr-seg' }, [['lecciones', '📚 Lecciones'], ['datos', '🧾 Datos del módulo'], ['glosario', '📖 Glosario']].map(([k, r]) => h('button', { type: 'button', class: 'tr-seg-b' + (tab === k ? ' on' : ''), onclick: () => { tab = k; pintar(); } }, r)));
    let cuerpo;
    if (tab === 'datos') {
      const area = fTxt(m, 'area', 'Área', { opciones: [['face', 'Face Design'], ['n2', 'N2 Demodenture'], ['n3', 'N3 Prosthetic'], ['n6', 'N6 Material Changes'], ['support', 'Support']] }, c);
      area.hidden = m.seccion !== 'area';
      cuerpo = h('div', { class: 'tr-ed-form' }, h('div', { class: 'tr-ed-fila' }, fTxt(m, 'icono', 'Icono (emoji)', { ph: '📘' }, () => { c(); X.pintarMenu(); }), fTxt(m, 'orden', 'Orden', { numero: true, ayuda: 'Menor = aparece antes' }, c)),
        fT(m, 'titulo', 'Título', {}, () => { c(); X.pintarMenu(); }), fT(m, 'resumen', 'Resumen', { multi: true }, c),
        h('div', { class: 'tr-ed-fila' }, fTxt(m, 'seccion', 'Sección', { opciones: [['intro', 'Empieza aquí'], ['area', 'Las áreas del departamento'], ['biblioteca', 'Biblioteca de referencia']] }, () => { if (m.seccion === 'area' && !m.area) m.area = 'face'; if (m.seccion !== 'area') delete m.area; c(); pintar(); }), area),
        h('div', { class: 'tr-ed-peligro' }, h('b', null, 'Quitar este módulo del curso'), h('p', { class: 'tr-sub' }, 'Desaparece del curso cuando publiques. El avance de las personas no se borra.'),
          h('button', { type: 'button', class: 'tr-btn tr-btn-chico tr-btn-peligro', onclick: async () => {
            if (!await dialogo('Quitar módulo', h('p', null, `"${t(m.titulo)}" se quitará del curso cuando publiques. Puedes deshacerlo desde Inicio mientras no publiques.`), 'Quitar', true)) return;
            await esperarGuardado(m.id); await api.post('/design/api/training/editor/' + m.id + '/eliminar', {}); delete est[m.id]; await X.recargar(); X.ir('#/');
          } }, '🗑 Quitar módulo')));
    } else if (tab === 'glosario') {
      m.glosario = m.glosario || [];
      cuerpo = h('div', { class: 'tr-ed-form' }, fLista(m.glosario, 'Términos de este módulo', () => ({ id: m.id + '-' + Math.random().toString(36).slice(2, 7), termino: T('Término', 'Term'), def: T('Qué significa, en una línea.', 'What it means, in one line.'), cat: '' }),
        (g) => h('div', null, fT(g, 'termino', 'Término', {}, c), fT(g, 'def', 'Definición', { multi: true, filas: 2 }, c), fTxt(g, 'cat', 'Categoría', { ph: 'p. ej. N3, exocad, calidad' }, c)), c,
        { nombre: 'Término', agregar: 'Agregar término', resumen: (g) => t(g.termino), ayuda: 'Los términos aparecen subrayados en las lecciones y en el Glosario (se actualiza al publicar).' }));
    } else {
      cuerpo = h('div', { class: 'tr-ed-form' }, fLista(m.lecciones, 'Lecciones', () => ({ id: idUnico(m.id), titulo: T('Nueva lección', 'New lesson'), minutos: 5, pasos: [pasoNuevo('texto'), pasoNuevo('quiz')] }),
        (l) => h('div', { class: 'tr-ed-lec' }, fT(l, 'titulo', 'Título', {}, () => { c(); X.pintarMenu(); }), h('div', { class: 'tr-ed-fila' }, fTxt(l, 'minutos', 'Minutos', { numero: true }, c),
          h('div', { class: 'tr-ed-lec-acc' }, h('span', { class: 'tr-sub' }, `${(l.pasos || []).length} pasos`), h('a', { class: 'tr-btn tr-btn-chico tr-btn-primario', href: '#/l/' + l.id }, '✏️ Editar pasos →')))),
        () => { c(); X.pintarMenu(); }, { nombre: 'Lección', agregar: 'Nueva lección', min: 1, resumen: (l) => t(l.titulo), ayuda: 'Arrastra ⠿ para cambiar el orden. Quitar una lección no borra el avance guardado.' }));
    }
    panel.replaceChildren(h('div', { class: 'tr-ed-modulo-cab' }, h('h2', null, '✏️ Editar módulo'), tabs), cuerpo);
  };
  pintar();
  const ref = pagina.querySelector('.tr-mod-head');
  if (ref) ref.after(panel); else pagina.prepend(panel);
}

// ---------- Lección: todos los pasos, arrastrables ----------
export async function vistaLeccion(l0, m0) {
  const m = await asegurar(m0.id);
  const l = (m.lecciones || []).find((x) => x.id === l0.id);
  if (!l) return X.ir('#/m/' + m.id);
  l.pasos = l.pasos || [];
  const c = () => cambio(m.id);
  const lista = h('div', { class: 'tr-ed-pasos' });
  const previas = [];   // destruir vistas previas (quizzes, WebGL)
  let arrastrando = null;
  X.destruir.push(() => { previas.forEach((d) => d && d()); cerrarPanel(); });

  const cab = h('div', { class: 'tr-leccion-cab' }, h('div', { class: 'tr-migas', role: 'navigation' }, h('a', { href: '#/' }, 'Inicio'), ' › ', h('a', { href: '#/m/' + m.id }, t(m.titulo))),
    h('div', { class: 'tr-ed-lec-tit' }, fT(l, 'titulo', 'Título de la lección', {}, () => { c(); X.pintarMenu(); }), fTxt(l, 'minutos', 'Minutos', { numero: true }, c)),
    h('p', { class: 'tr-sub' }, 'Haz clic en ✏️ para cambiar un paso; arrastra ⠿ para moverlo; usa ＋ para agregar pasos o suelta imágenes desde tu computador sobre ＋. El último paso suele ser un quiz.'));

  function separador(pos) {
    const b = h('button', { type: 'button', class: 'tr-ed-sep-btn', onclick: () => menuTipos(pos) }, '＋ Agregar paso');
    const sep = h('div', { class: 'tr-ed-sep' }, b);
    sep.addEventListener('dragover', (e) => { e.preventDefault(); sep.classList.add('sobre'); });
    sep.addEventListener('dragleave', () => sep.classList.remove('sobre'));
    sep.addEventListener('drop', async (e) => {
      e.preventDefault(); sep.classList.remove('sobre');
      if (arrastrando !== null) { const de = arrastrando; arrastrando = null; const x = l.pasos.splice(de, 1)[0]; l.pasos.splice(pos > de ? pos - 1 : pos, 0, x); c(); pintar(); return; }
      const ims = await subirVarias(e.dataTransfer.files || []);
      if (ims.length) { const p = pasoNuevo('imagen'); p.imagenes = ims; p.disposicion = ims.length >= 3 ? 'tres' : (ims.length === 2 ? 'dos' : 'una'); delete p.titulo; l.pasos.splice(pos, 0, p); c(); pintar(); editar(pos); }
    });
    return sep;
  }
  function menuTipos(pos) {
    const tipos = ['texto', 'imagen', 'tarjetas', 'acordeon', 'flujo', 'caso', 'tabla', 'checklist', 'resumen', 'quiz', 'enlace', 'lider', 'modelo3d', 'visor', 'calculadora'];
    const cuerpo = h('div', { class: 'tr-ed-tipos' }, tipos.map((tp) => h('button', { type: 'button', class: 'tr-ed-tipo', onclick: async () => {
      cerrarDialogo();
      const p = pasoNuevo(tp);
      if (tp === 'imagen') { const ims = await elegirImagenes(true); if (!ims || !ims.length) return; p.imagenes = ims; p.disposicion = ims.length >= 3 ? 'tres' : (ims.length === 2 ? 'dos' : 'una'); }
      l.pasos.splice(pos, 0, p); c(); pintar(); editar(pos);
    } }, h('span', { class: 'tr-ed-tipo-ico' }, NOMBRE_TIPO[tp][0]), h('b', null, NOMBRE_TIPO[tp][1]), h('small', null, NOMBRE_TIPO[tp][2]))));
    dialogo('¿Qué quieres agregar?', cuerpo, null);
  }
  function vistaPrevia(p, caja) {
    if (PESADOS.has(p.t)) {
      caja.replaceChildren(h('div', { class: 'tr-ed-pesado' }, h('span', null, NOMBRE_TIPO[p.t][0]), h('div', null, h('b', null, t(p.titulo) || NOMBRE_TIPO[p.t][1]), h('div', { class: 'tr-sub' }, p.slot ? 'Espacio: ' + p.slot : NOMBRE_TIPO[p.t][2])),
        h('button', { type: 'button', class: 'tr-btn tr-btn-chico', onclick: () => { const r = renderPaso(p, {}); previas.push(r.destroy); caja.replaceChildren(r.el); } }, '▶ Ver vista previa')));
      return;
    }
    try { const r = renderPaso(p, {}); previas.push(r.destroy); caja.replaceChildren(r.el); } catch (e) { caja.replaceChildren(h('div', { class: 'tr-error' }, 'Este paso tiene un error: ' + e.message + ' (ábrelo para corregirlo)')); }
  }
  const tarjetas = [];
  function tarjeta(p, i) {
    const prev = h('div', { class: 'tr-ed-prev' });
    const card = h('div', { class: 'tr-ed-paso', data: { i } },
      h('div', { class: 'tr-ed-paso-cab' },
        h('span', { class: 'tr-ed-asa', title: 'Arrastra para mover', onmousedown: () => { card.draggable = true; }, onmouseup: () => { card.draggable = false; } }, '⠿'),
        h('span', { class: 'tr-ed-paso-n' }, i + 1), h('span', { class: 'tr-ed-paso-tipo' }, (NOMBRE_TIPO[p.t] || ['•', p.t])[0] + ' ' + (NOMBRE_TIPO[p.t] || ['', p.t])[1]),
        h('span', { class: 'tr-ed-esp' }),
        h('button', { type: 'button', class: 'tr-btn tr-btn-chico tr-btn-primario', onclick: () => editar(i) }, '✏️ Editar'),
        h('button', { type: 'button', class: 'tr-ed-ib', title: 'Subir', disabled: i === 0, onclick: () => mover(i, i - 1) }, '↑'),
        h('button', { type: 'button', class: 'tr-ed-ib', title: 'Bajar', disabled: i === l.pasos.length - 1, onclick: () => mover(i, i + 1) }, '↓'),
        h('button', { type: 'button', class: 'tr-ed-ib', title: 'Duplicar', onclick: () => { const x = clonar(p); if (x.slot) x.slot = slotNuevo(); l.pasos.splice(i + 1, 0, x); c(); pintar(); } }, '⧉'),
        h('button', { type: 'button', class: 'tr-ed-ib peligro', title: 'Eliminar', onclick: async () => { if (!await dialogo('Eliminar paso', h('p', null, `¿Eliminar el paso ${i + 1} (${(NOMBRE_TIPO[p.t] || ['', p.t])[1]})?`), 'Eliminar', true)) return; l.pasos.splice(i, 1); cerrarPanel(); c(); pintar(); } }, '🗑')),
      prev);
    card.addEventListener('dragstart', (e) => { arrastrando = i; e.dataTransfer.effectAllowed = 'move'; card.classList.add('arrastrando'); lista.classList.add('moviendo'); });
    card.addEventListener('dragend', () => { card.draggable = false; card.classList.remove('arrastrando'); lista.classList.remove('moviendo'); arrastrando = null; });
    vistaPrevia(p, prev);
    tarjetas[i] = { card, prev };
    return card;
  }
  function mover(de, a) { if (a < 0 || a >= l.pasos.length) return; l.pasos.splice(a, 0, l.pasos.splice(de, 1)[0]); c(); pintar(); }
  function pintar() {
    previas.splice(0).forEach((d) => d && d()); tarjetas.length = 0;
    const nodos = [separador(0)];
    l.pasos.forEach((p, i) => nodos.push(tarjeta(p, i), separador(i + 1)));
    if (!l.pasos.length) nodos.push(h('div', { class: 'tr-vacio' }, 'Esta lección no tiene pasos. Usa ＋ para agregar el primero.'));
    lista.replaceChildren(...nodos);
  }
  function editar(i) {
    const p = l.pasos[i]; if (!p) return;
    tarjetas.forEach((x, k) => x && x.card.classList.toggle('editando', k === i));
    let tPrev = null;
    const refrescar = () => { clearTimeout(tPrev); tPrev = setTimeout(() => { const tj = tarjetas[l.pasos.indexOf(p)]; if (tj) vistaPrevia(p, tj.prev); }, 250); };
    const alCambiar = () => { c(); refrescar(); };
    abrirPanel(`Paso ${i + 1} · ${(NOMBRE_TIPO[p.t] || ['', p.t])[1]}`, {
      form: (repintar) => formPaso(p, alCambiar, repintar),
      json: (repintar) => editorJSON(p, (v) => { Object.keys(p).forEach((k) => delete p[k]); Object.assign(p, v); alCambiar(); repintar(); }),
    }, () => tarjetas.forEach((x) => x && x.card.classList.remove('editando')));
    tarjetas[i]?.card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  X.vista(h('div', { class: 'tr-pagina tr-leccion tr-ed-leccion' }, barra(m.id), cab, lista), t(l.titulo));
  pintar();
}
