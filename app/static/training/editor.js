// Training: editor de contenido para admins (como el editor de la página de Inicio). Todo se guarda solo como borrador;
// nadie lo ve hasta que se publica el módulo. Se edita sobre la misma página: barra de edición arriba, panel del módulo,
// lección con todos sus pasos (arrastrables), panel lateral con el formulario de cada paso y biblioteca de imágenes.
import { S, h, t, md, api, toast, vaciar, ED, UI_BASE, ui } from './lib.js';
import { renderPaso } from './steps.js';
import { pasoEditable, campoDe, campoSimple, sel, boton, lista as listaEl } from './enlinea.js';

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
  enlace: ['🔗', 'Enlace', 'A otra lección de la biblioteca.'],
  lider: ['👤', 'Manager del área', 'Tarjeta del manager del área.'],
  modelo3d: ['🧩', 'Modelo 3D', 'Espacio para un modelo 3D (GLB, STL, OBJ o PLY).'],
  visor: ['🖥', 'Visor de caso', 'Visor HTML de un caso (pestañas RX y Changes).'],
  calculadora: ['🧮', 'Calculadora', 'Herramienta interactiva (espesor 24Z, tamaños, articulador, tiempos).'],
  simulador: ['🎛', 'Simulador', 'Simulador de movimientos (se edita en JSON).'],
  tour: ['🎬', 'Animación guiada', 'Animación de movimientos (se edita en JSON).'],
};
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
    case 'enlace': return { t: 'enlace', titulo: T('Para profundizar', 'Go deeper'), texto: T('El detalle está en esta lección.', 'The details are in this lesson.'), lecc: '' };
    case 'lider': return { t: 'lider', area: 'face' };
    case 'modelo3d': return { t: 'modelo3d', slot: slotNuevo(), titulo: T('Modelo 3D', '3D model'), descripcion: T('Qué mirar en el modelo.', 'What to look at in the model.'), pendiente: T('Aquí irá el modelo.', 'The model will go here.') };
    case 'visor': return { t: 'visor', slot: slotNuevo(), pestana: 'rx', titulo: T('Visor de un caso', 'Case viewer'), descripcion: T('Qué mirar en el caso.', 'What to look at in the case.'), pendiente: T('Aquí irá el visor del caso.', 'The case viewer will go here.') };
    case 'calculadora': return { t: 'calculadora', id: 'tiempos', titulo: T('Calculadora', 'Calculator') };
    default: return { t: tipo };
  }
}

// ---------- Cargar y guardar ----------
const SITIO = 'sitio';   // textos de la plataforma, orden de secciones y paneles
const objeto = (mid) => (mid === SITIO ? S.contenido.sitio : modPor(mid));
// Carga el módulo para editarlo. Lo que ya está en pantalla (borrador) se conserva: solo se le agrega el glosario, que la vista
// no trae. reemplazar=true (otra persona guardó encima) toma la versión del servidor.
async function asegurar(mid, reemplazar) {
  if (est[mid] && est[mid].cargado && !reemplazar) return objeto(mid);
  const r = await api.get('/design/api/training/editor/' + mid);
  est[mid] = { ...(est[mid] || {}), version: r.version, cargado: true };
  if (mid === SITIO) {
    if (reemplazar || !S.contenido.sitio || !Object.keys(S.contenido.sitio).length) S.contenido.sitio = r.contenido || {};
    return S.contenido.sitio;
  }
  const i = mods().findIndex((m) => m.id === mid);
  if (i >= 0 && !reemplazar) { mods()[i].glosario = r.contenido.glosario || []; return mods()[i]; }
  if (i >= 0) mods()[i] = r.contenido; else mods().push(r.contenido);
  return r.contenido;
}

function cambio(mid) {
  if (!mid) return;
  const e = est[mid] || (est[mid] = {});
  e.pendiente = true; pintarBarra();
  clearTimeout(e.timer); e.timer = setTimeout(() => guardar(mid), 700);
}
export function sitio() { const x = S.contenido.sitio || (S.contenido.sitio = {}); return x; }
export function cambioSitio() { asegurar(SITIO).then(() => cambio(SITIO)); }

// ---------- Edición en el lugar (doble clic en cualquier texto, imágenes con controles) ----------
let refrescar = null;   // repinta la vista actual después de un cambio de estructura (la pone cada vista)
const midActual = () => X.modActual() || SITIO;
export function activarEnLugar() {
  ED.activo = true;
  ED.texto = () => { const mid = midActual(); asegurar(mid).then(() => cambio(mid)); if (panelAbierto && panelAbierto.repintar) panelAbierto.repintar(); };
  ED.estructura = () => { const mid = midActual(); asegurar(mid).then(() => cambio(mid)); if (refrescar) refrescar(); else X.ruta(); };
  ED.imagenes = (multiple) => elegirImagenes(multiple);
  ED.ui = (clave, valor) => {
    const st = sitio(); st.ui = st.ui || {}; st.ui[S.lang] = st.ui[S.lang] || {};
    st.ui[S.lang][clave] = valor; cambioSitio();
  };
}
export function desactivarEnLugar() { ED.activo = false; ED.texto = ED.estructura = ED.imagenes = ED.ui = null; refrescar = null; }
export function alCambiarVista() { refrescar = null; }

async function guardar(mid, forzar) {
  const e = est[mid]; if (!e) return;
  if (e.guardando) { clearTimeout(e.timer); e.timer = setTimeout(() => guardar(mid), 500); return; }
  e.guardando = true; e.pendiente = false; pintarBarra();
  try {
    if (!e.cargado) await asegurar(mid);
    const r = await api.post('/design/api/training/editor/' + mid, { contenido: objeto(mid), version: e.version, forzar: !!forzar });
    e.version = r.version; e.error = '';
    S.editor[mid] = { ...info(mid), hayCambios: true, actualizadoEn: r.actualizadoEn, actualizadoPor: 'tú' };
  } catch (err) {
    e.error = err.message;
    if (/después de que lo abriste/.test(err.message)) {
      if (confirm(err.message + '\n\n¿Guardar tus cambios encima de los suyos? (Cancelar = cargar la versión de la otra persona)')) { e.guardando = false; return guardar(mid, true); }
      await asegurar(mid, true); X.ruta();
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
  const iS = info(SITIO), eS = est[SITIO] || {};
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
    (iS.hayCambios || eS.pendiente || eS.guardando) ? h('span', { class: 'tr-ed-est borrador', title: 'Textos de la plataforma, orden de secciones y paneles' }, eS.guardando || eS.pendiente ? '⏳ Diseño…' : '● Diseño sin publicar') : null,
    h('span', { class: 'tr-ed-ayuda-dc' }, 'Clic en cualquier texto para escribir'),
    h('span', { class: 'tr-ed-esp' }),
    mid && X.esLeccion() ? h('button', { type: 'button', class: 'tr-btn tr-btn-chico', onclick: () => { S.vistaAlumno = !S.vistaAlumno; X.ruta(); } }, S.vistaAlumno ? '✏️ Volver a editar' : '👁 Ver como alumno') : null,
    h('button', { type: 'button', class: 'tr-btn tr-btn-chico', onclick: () => panelTextos() }, '🔤 Textos de la plataforma'),
    mid ? h('button', { type: 'button', class: 'tr-btn tr-btn-chico', onclick: () => historial(mid) }, '🕘 Historial') : null,
    mid && i.hayCambios ? h('button', { type: 'button', class: 'tr-btn tr-btn-chico', onclick: () => descartar(mid) }, 'Descartar cambios') : null,
    mid ? h('button', { type: 'button', class: 'tr-btn tr-btn-chico tr-btn-primario', disabled: !i.hayCambios && !e.pendiente && !iS.hayCambios && !eS.pendiente, onclick: () => publicar([mid, ...(iS.hayCambios || eS.pendiente ? [SITIO] : [])].filter((x) => x === SITIO || info(x).hayCambios || (est[x] || {}).pendiente)) }, '🚀 Publicar') : null,
    !mid && pendientes.length ? h('button', { type: 'button', class: 'tr-btn tr-btn-chico tr-btn-primario', onclick: () => publicar(pendientes.map(([k]) => k)) }, '🚀 Publicar todo') : null,
    h('button', { type: 'button', class: 'tr-btn tr-btn-chico', title: 'Salir del modo edición', onclick: () => X.salirEdicion() }, 'Salir')].filter(Boolean));
}

async function publicar(ids) {
  for (const id of ids) await esperarGuardado(id);
  const nombres = ids.map((id) => (id === SITIO ? 'Textos de la plataforma, orden de secciones y paneles' : (modPor(id) ? t(modPor(id).titulo) : id)));
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
// Texto bilingüe: ES y EN lado a lado
function fTxt(obj, clave, etiqueta, o = {}, alCambiar) {
  const set = (val) => { if (o.numero) val = val === '' ? undefined : Number(val); if (val === undefined || val === '') delete obj[clave]; else obj[clave] = val; alCambiar(); };
  const el = o.opciones
    ? h('select', { class: 'tr-in', onchange: (e) => set(e.target.value) }, o.opciones.map(([v, rot]) => h('option', { value: v, selected: String(obj[clave] ?? o.defecto ?? '') === String(v) }, rot)))
    : h('input', { class: 'tr-in', type: o.numero ? 'number' : 'text', value: obj[clave] ?? '', placeholder: o.ph || '', oninput: (e) => set(e.target.value) });
  return h('label', { class: 'tr-ed-campo' }, h('span', { class: 'tr-ed-etq' }, etiqueta, o.ayuda ? h('small', { class: 'tr-ed-ayuda' }, o.ayuda) : null), el);
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

// ---------- Panel lateral (textos de la plataforma) ----------
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
  panelAbierto = { el: panel, repintar: () => { if (!panel.contains(document.activeElement)) pintar(); }, cerrar: () => { document.removeEventListener('keydown', tecla, true); panel.remove(); raizEd().classList.remove('con-panel'); if (alCerrar) alCerrar(); } };
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
  pagina.prepend(caja);
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

// ---------- Módulo: se edita en la misma página (icono, título, resumen, sección, lecciones y glosario) ----------
export async function decorarModulo(pagina, m0) {
  const m = await asegurar(m0.id);
  const c = () => cambio(m.id);
  const ctx = { cambio: c, estructura: () => { c(); X.pintarMenu(); X.ruta(); } };
  // icono
  const ico = pagina.querySelector('.tr-mod-head .tr-mod-ico');
  if (ico) ico.replaceWith(h('span', { class: 'tr-mod-ico grande' }, campoSimple(m, 'icono', () => { c(); X.pintarMenu(); }, { ph: '📘', titulo: 'Icono del módulo (emoji)' })));
  // sección, área, orden y quitar
  const AREAS_OP = [['face', 'Face Design'], ['n2', 'N2 Demodenture'], ['n3', 'N3 Prosthetic'], ['n6', 'N6 Material Changes'], ['support', 'Support']];
  const ajustes = h('div', { class: 'tr-el-fila tr-ed-mod-ajustes' },
    h('span', null, 'Sección: '), sel([['intro', 'Empieza aquí'], ['area', 'Las áreas del departamento'], ['biblioteca', 'Biblioteca de referencia']], m.seccion || 'biblioteca', (v) => { m.seccion = v; if (v === 'area' && !m.area) m.area = 'face'; if (v !== 'area') delete m.area; ctx.estructura(); }),
    m.seccion === 'area' ? [h('span', null, ' Área: '), sel(AREAS_OP, m.area, (v) => { m.area = v; ctx.estructura(); })] : null,
    h('span', null, ' Orden: '), h('input', { type: 'number', class: 'tr-el-num-in', value: m.orden ?? '', title: 'Menor = aparece antes', onchange: (e) => { m.orden = e.target.value === '' ? 99 : Number(e.target.value); ctx.estructura(); } }),
    h('span', { class: 'tr-ed-esp' }),
    boton('🗑 Quitar módulo', async () => {
      if (!await dialogo('Quitar módulo', h('p', null, `"${t(m.titulo)}" se quitará del curso cuando publiques. Puedes deshacerlo desde Inicio mientras no publiques.`), 'Quitar', true)) return;
      await esperarGuardado(m.id); await api.post('/design/api/training/editor/' + m.id + '/eliminar', {}); delete est[m.id]; await X.recargar(); X.ir('#/');
    }, 'peligro'));
  pagina.querySelector('.tr-mod-head')?.after(ajustes);
  // lecciones: título en el lugar, minutos, mover, abrir
  const lecs = pagina.querySelector('.tr-lecs');
  const nueva = () => ({ id: idUnico(m.id), titulo: T('Nueva lección', 'New lesson'), minutos: 5, pasos: [pasoNuevo('texto'), pasoNuevo('quiz')] });
  const listaLecs = listaEl(m.lecciones, (l, i) => h('div', { class: 'tr-lec-card tr-el-lec' }, h('span', { class: 'tr-lec-n' }, i + 1),
    h('div', { class: 'tr-lec-txt' }, campoDe(l, 'titulo', () => { c(); X.pintarMenu(); }, { tag: 'b', ph: 'Título de la lección' }),
      h('small', null, h('input', { type: 'number', class: 'tr-el-num-in', min: 1, value: l.minutos || 5, title: 'Minutos', onchange: (e) => { l.minutos = Number(e.target.value) || 5; c(); } }), ' min · ' + (l.pasos || []).length + ' pasos')),
    boton('↗', () => moverLeccion(l), 'chico'), h('a', { class: 'tr-btn tr-btn-chico tr-btn-primario', href: '#/l/' + l.id }, 'Abrir →')),
    nueva, ctx, { agregar: 'Nueva lección', min: 1 });
  if (lecs) lecs.replaceWith(h('div', { class: 'tr-lecs' }, listaLecs));
  // glosario del módulo
  m.glosario = m.glosario || [];
  pagina.append(h('section', { class: 'tr-seccion tr-el-glos' }, h('h2', null, '📖 Glosario de este módulo'), h('p', { class: 'tr-sub' }, 'Los términos aparecen subrayados en las lecciones y en el Glosario general.'),
    listaEl(m.glosario, (g) => h('div', { class: 'tr-glos-it' }, campoDe(g, 'termino', c, { tag: 'h3', ph: 'Término' }), campoDe(g, 'def', c, { multi: true, ph: 'Qué significa, en una línea' }),
      h('small', { class: 'tr-sub' }, 'Categoría: ', campoSimple(g, 'cat', c, { ph: 'p. ej. N3' }))),
    () => ({ id: m.id + '-' + Math.random().toString(36).slice(2, 7), termino: T('Término', 'Term'), def: T('Qué significa.', 'What it means.'), cat: '' }), ctx, { agregar: 'Término' })));
  async function moverLeccion(l) {
    const d = { destino: '' };
    const opciones = mods().filter((x) => x.id !== m.id).map((x) => [x.id, t(x.titulo)]);
    d.destino = opciones[0] ? opciones[0][0] : '';
    if (!await dialogo('Mover la lección a otro módulo', h('div', { class: 'tr-ed-form' }, h('p', null, `"${t(l.titulo)}" quedará al final del módulo elegido. El avance de las personas se conserva.`), fTxt(d, 'destino', 'Módulo de destino', { opciones }, () => {})), 'Mover')) return;
    if (m.lecciones.length <= 1) return toast('El módulo debe quedar con al menos una lección', 'error');
    const m2 = await asegurar(d.destino);
    m.lecciones.splice(m.lecciones.indexOf(l), 1); (m2.lecciones = m2.lecciones || []).push(l);
    c(); cambio(m2.id); X.pintarMenu(); X.ruta();
    toast('Lección movida a "' + t(m2.titulo) + '"');
  }
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
    campoDe(l, 'titulo', () => { c(); X.pintarMenu(); }, { tag: 'h1', ph: 'Título de la lección' }),
    h('div', { class: 'tr-sub' }, h('input', { type: 'number', class: 'tr-el-num-in', min: 1, value: l.minutos || 5, title: 'Minutos', onchange: (e) => { l.minutos = Number(e.target.value) || 5; c(); } }), ' ' + 'min'),
    h('div', { class: 'tr-ed-guia' }, '✏️ Haz clic en cualquier texto y escribe. Estás escribiendo en ', h('b', null, S.lang === 'es' ? 'ESPAÑOL' : 'INGLÉS'),
      ' — cambia a ', S.lang === 'es' ? 'EN' : 'ES', ' arriba para escribir la traducción (los textos sin traducir tienen una línea naranja). Arrastra ⠿ para mover; ＋ agrega pasos o suelta ahí imágenes de tu computador.'));

  function separador(pos) {
    const b = h('button', { type: 'button', class: 'tr-ed-sep-btn', onclick: () => menuTipos(pos) }, '＋ Agregar paso');
    const sep = h('div', { class: 'tr-ed-sep' }, b);
    sep.addEventListener('dragover', (e) => { e.preventDefault(); sep.classList.add('sobre'); });
    sep.addEventListener('dragleave', () => sep.classList.remove('sobre'));
    sep.addEventListener('drop', async (e) => {
      e.preventDefault(); sep.classList.remove('sobre');
      if (arrastrando !== null) { const de = arrastrando; arrastrando = null; const x = l.pasos.splice(de, 1)[0]; l.pasos.splice(pos > de ? pos - 1 : pos, 0, x); c(); pintar(); return; }
      const ims = await subirVarias(e.dataTransfer.files || []);
      if (ims.length) { const p = pasoNuevo('imagen'); p.imagenes = ims; p.disposicion = ims.length >= 3 ? 'tres' : (ims.length === 2 ? 'dos' : 'una'); delete p.titulo; l.pasos.splice(pos, 0, p); c(); pintar(); enfocar(pos); }
    });
    return sep;
  }
  function menuTipos(pos) {
    const tipos = ['texto', 'imagen', 'tarjetas', 'acordeon', 'flujo', 'caso', 'tabla', 'checklist', 'resumen', 'quiz', 'enlace', 'lider', 'modelo3d', 'visor', 'calculadora'];
    const cuerpo = h('div', { class: 'tr-ed-tipos' }, tipos.map((tp) => h('button', { type: 'button', class: 'tr-ed-tipo', onclick: async () => {
      cerrarDialogo();
      const p = pasoNuevo(tp);
      if (tp === 'imagen') { const ims = await elegirImagenes(true); if (!ims || !ims.length) return; p.imagenes = ims; p.disposicion = ims.length >= 3 ? 'tres' : (ims.length === 2 ? 'dos' : 'una'); }
      l.pasos.splice(pos, 0, p); c(); pintar(); enfocar(pos);
    } }, h('span', { class: 'tr-ed-tipo-ico' }, NOMBRE_TIPO[tp][0]), h('b', null, NOMBRE_TIPO[tp][1]), h('small', null, NOMBRE_TIPO[tp][2]))));
    dialogo('¿Qué quieres agregar?', cuerpo, null);
  }
  const modos = new WeakMap();   // paso -> 'ver' cuando se muestra como lo ve la persona
  const ctxEd = { cambio: () => c(), estructura: () => { c(); pintar(); }, imagenes: (mult) => elegirImagenes(mult), destruir: (fn) => previas.push(fn),
    lecciones: () => mods().flatMap((mm) => (mm.lecciones || []).map((x) => [x.id, t(mm.titulo) + ' › ' + t(x.titulo)])) };
  function cuerpoPaso(p, caja) {
    if (modos.get(p) === 'ver') {
      try { const r = renderPaso(p, {}); previas.push(r.destroy); caja.replaceChildren(r.el); } catch (e) { caja.replaceChildren(h('div', { class: 'tr-error' }, 'Este paso tiene un error: ' + e.message)); }
      return;
    }
    try { caja.replaceChildren(pasoEditable(p, ctxEd)); } catch (e) { console.error(e); caja.replaceChildren(h('div', { class: 'tr-error' }, 'No se pudo mostrar este paso para editar (' + e.message + '). Corrígelo con { } JSON.')); }
  }
  const tarjetas = [];
  function tarjeta(p, i) {
    const cuerpo = h('div', { class: 'tr-ed-prev' });
    const ver = modos.get(p) === 'ver';
    const card = h('div', { class: 'tr-ed-paso' + (ver ? ' viendo' : ''), data: { i } },
      h('div', { class: 'tr-ed-paso-cab' },
        h('span', { class: 'tr-ed-asa', title: 'Arrastra para mover', onmousedown: () => { card.draggable = true; }, onmouseup: () => { card.draggable = false; } }, '⠿'),
        h('span', { class: 'tr-ed-paso-n' }, i + 1), h('span', { class: 'tr-ed-paso-tipo' }, (NOMBRE_TIPO[p.t] || ['•', p.t])[0] + ' ' + (NOMBRE_TIPO[p.t] || ['', p.t])[1]),
        h('span', { class: 'tr-ed-esp' }),
        h('button', { type: 'button', class: 'tr-btn tr-btn-chico' + (ver ? ' tr-btn-primario' : ''), title: ver ? 'Volver a editar este paso' : 'Ver este paso como lo ve la persona (con sus interacciones)', onclick: () => { if (ver) modos.delete(p); else modos.set(p, 'ver'); pintar(); } }, ver ? '✏️ Editar aquí' : '👁 Ver cómo queda'),
        h('button', { type: 'button', class: 'tr-ed-ib', title: 'Subir', disabled: i === 0, onclick: () => mover(i, i - 1) }, '↑'),
        h('button', { type: 'button', class: 'tr-ed-ib', title: 'Bajar', disabled: i === l.pasos.length - 1, onclick: () => mover(i, i + 1) }, '↓'),
        h('button', { type: 'button', class: 'tr-ed-ib', title: 'Duplicar', onclick: () => { const x = clonar(p); if (x.slot) x.slot = slotNuevo(); l.pasos.splice(i + 1, 0, x); c(); pintar(); } }, '⧉'),
        h('button', { type: 'button', class: 'tr-ed-ib', title: 'Mover a otra lección', onclick: () => moverPaso(i) }, '↗'),
        h('button', { type: 'button', class: 'tr-ed-ib', title: 'Edición avanzada (JSON)', onclick: () => json(p) }, '{ }'),
        h('button', { type: 'button', class: 'tr-ed-ib peligro', title: 'Eliminar', onclick: async () => { if (!await dialogo('Eliminar paso', h('p', null, `¿Eliminar el paso ${i + 1} (${(NOMBRE_TIPO[p.t] || ['', p.t])[1]})?`), 'Eliminar', true)) return; l.pasos.splice(i, 1); c(); pintar(); } }, '🗑')),
      cuerpo);
    card.addEventListener('dragstart', (e) => { if (e.target !== card) return; arrastrando = i; e.dataTransfer.effectAllowed = 'move'; card.classList.add('arrastrando'); lista.classList.add('moviendo'); });
    card.addEventListener('dragend', () => { card.draggable = false; card.classList.remove('arrastrando'); lista.classList.remove('moviendo'); arrastrando = null; });
    cuerpoPaso(p, cuerpo);
    tarjetas[i] = { card, cuerpo };
    return card;
  }
  function json(p) {
    dialogo('Edición avanzada (JSON)', h('div', { class: 'tr-ed-form' }, ...editorJSON(p, (v) => { Object.keys(p).forEach((k) => delete p[k]); Object.assign(p, v); c(); cerrarDialogo(); pintar(); })), null);
  }
  function enfocar(i) {
    const tj = tarjetas[i]; if (!tj) return;
    tj.card.scrollIntoView({ block: 'center', behavior: 'smooth' });
    tj.card.classList.add('nuevo'); setTimeout(() => tj.card.classList.remove('nuevo'), 1600);
    const primero = tj.card.querySelector('.tr-el-campo'); if (primero) setTimeout(() => primero.focus(), 350);
  }
  async function moverPaso(i) {
    const d = { destino: '', donde: 'fin' };
    const opciones = mods().flatMap((mm) => (mm.lecciones || []).filter((x) => x !== l).map((x) => [mm.id + '|' + x.id, t(mm.titulo) + ' › ' + t(x.titulo)]));
    d.destino = opciones[0] ? opciones[0][0] : '';
    const cuerpo = h('div', { class: 'tr-ed-form' }, fTxt(d, 'destino', 'Lección de destino', { opciones }, () => {}), fTxt(d, 'donde', 'Dónde', { opciones: [['fin', 'Al final'], ['inicio', 'Al principio']] }, () => {}));
    if (!await dialogo('Mover el paso a otra lección', cuerpo, 'Mover')) return;
    const [mid2, lid2] = d.destino.split('|');
    const m2 = await asegurar(mid2), l2 = (m2.lecciones || []).find((x) => x.id === lid2);
    if (!l2) return;
    const x = l.pasos.splice(i, 1)[0]; l2.pasos = l2.pasos || [];
    if (d.donde === 'inicio') l2.pasos.unshift(x); else l2.pasos.push(x);
    c(); if (mid2 !== m.id) cambio(mid2); pintar();
    toast('Paso movido a "' + t(l2.titulo) + '"');
  }
  function mover(de, a) { if (a < 0 || a >= l.pasos.length) return; l.pasos.splice(a, 0, l.pasos.splice(de, 1)[0]); c(); pintar(); }
  function pintar() {
    previas.splice(0).forEach((d) => d && d()); tarjetas.length = 0;
    const nodos = [separador(0)];
    l.pasos.forEach((p, i) => nodos.push(tarjeta(p, i), separador(i + 1)));
    if (!l.pasos.length) nodos.push(h('div', { class: 'tr-vacio' }, 'Esta lección no tiene pasos. Usa ＋ para agregar el primero.'));
    lista.replaceChildren(...nodos);
  }
  X.vista(h('div', { class: 'tr-pagina tr-leccion tr-ed-leccion' }, barra(m.id), cab, lista), t(l.titulo));
  pintar();
  refrescar = () => pintar();
}


// ---------- Textos de la plataforma: cualquier texto de la interfaz (botones, títulos, avisos), en ES y EN ----------
export function panelTextos() {
  asegurar(SITIO);
  let filtro = '';
  abrirPanel('Textos de la plataforma', {
    form: (repintar) => {
      const st = sitio(); st.ui = st.ui || {}; st.ui.es = st.ui.es || {}; st.ui.en = st.ui.en || {};
      const buscar = h('input', { class: 'tr-in', type: 'search', placeholder: 'Buscar un texto…', value: filtro, oninput: (e) => { filtro = e.target.value; pintarLista(); } });
      const lista = h('div', { class: 'tr-ed-textos' });
      const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      function pintarLista() {
        const q = norm(filtro);
        const claves = Object.keys(UI_BASE.es).filter((k) => !q || norm(k + ' ' + UI_BASE.es[k] + ' ' + (UI_BASE.en[k] || '') + ' ' + (st.ui.es[k] || '') + ' ' + (st.ui.en[k] || '')).includes(q));
        lista.replaceChildren(...claves.slice(0, 80).map((k) => {
          const propio = st.ui.es[k] || st.ui.en[k];
          const campo = (l) => h('label', { class: 'tr-ed-lang' }, h('span', { class: 'tr-ed-l' }, l.toUpperCase()),
            h('textarea', { class: 'tr-in', rows: 1, placeholder: UI_BASE[l][k] || '', oninput: (e) => { if (e.target.value.trim()) st.ui[l][k] = e.target.value; else delete st.ui[l][k]; cambioSitio(); } }, st.ui[l][k] || ''));
          return h('div', { class: 'tr-ed-texto' + (propio ? ' propio' : '') }, h('div', { class: 'tr-ed-etq' }, h('code', null, k), propio ? h('button', { type: 'button', class: 'tr-ed-ib', title: 'Volver al texto original', onclick: () => { delete st.ui.es[k]; delete st.ui.en[k]; cambioSitio(); pintarLista(); } }, '↺') : null),
            h('div', { class: 'tr-ed-bi' }, campo('es'), campo('en')));
        }), claves.length > 80 ? h('p', { class: 'tr-sub' }, `Mostrando 80 de ${claves.length}: escribe en el buscador para encontrar el resto.`) : null);
        lista.querySelectorAll('textarea').forEach((x) => { if (!x.value) x.value = ''; });
      }
      pintarLista();
      return [h('p', { class: 'tr-sub' }, 'Cambia cualquier texto de la plataforma. Vacío = texto original (en gris). Los cambios se ven al recargar la vista y se publican con el botón Publicar.'), buscar, lista];
    },
  }, () => X.ruta());
}

// ---------- Bloques movibles (secciones de Inicio, paneles del Laboratorio) ----------
// Cada bloque es [clave, elemento, nombre]. Devuelve los elementos en el orden guardado (sitio[clave].orden); en modo edición
// cada bloque lleva su barra: arrastrar, subir, bajar y ocultar/mostrar.
export function ordenarBloques(clave, bloques, opciones = {}) {
  const st = sitio(), conf = st[clave] || {}, orden = conf.orden || [], ocultos = new Set(conf.ocultos || []);
  const lista = [...bloques].sort((a, b) => { const ia = orden.indexOf(a[0]), ib = orden.indexOf(b[0]); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
  const guardar = (nuevoOrden, nuevosOcultos) => { st[clave] = { ...(st[clave] || {}), orden: nuevoOrden, ocultos: [...nuevosOcultos] }; cambioSitio(); X.ruta(); };
  let arrastrando = null;
  return lista.map(([k, el, nombre], i) => {
    const ids = lista.map((x) => x[0]);
    const caja = h('div', { class: 'tr-bloque' + (ocultos.has(k) ? ' oculto' : ''), data: { bloque: k } },
      h('div', { class: 'tr-bloque-barra' },
        h('span', { class: 'tr-ed-asa', title: 'Arrastra para mover', onmousedown: () => { caja.draggable = true; }, onmouseup: () => { caja.draggable = false; } }, '⠿'),
        h('b', null, nombre), ocultos.has(k) ? h('span', { class: 'tr-chip-ed' }, 'Oculto') : null, h('span', { class: 'tr-ed-esp' }),
        opciones.extra ? opciones.extra(k) : null,
        h('button', { type: 'button', class: 'tr-ed-ib', title: 'Subir', disabled: i === 0, onclick: () => { const o = [...ids]; o.splice(i - 1, 0, o.splice(i, 1)[0]); guardar(o, ocultos); } }, '↑'),
        h('button', { type: 'button', class: 'tr-ed-ib', title: 'Bajar', disabled: i === ids.length - 1, onclick: () => { const o = [...ids]; o.splice(i + 1, 0, o.splice(i, 1)[0]); guardar(o, ocultos); } }, '↓'),
        h('button', { type: 'button', class: 'tr-ed-ib', title: ocultos.has(k) ? 'Mostrar' : 'Ocultar', onclick: () => { const n = new Set(ocultos); if (n.has(k)) n.delete(k); else n.add(k); guardar(ids, n); } }, ocultos.has(k) ? '👁' : '🚫')),
      el);
    caja.addEventListener('dragstart', (e) => { arrastrando = i; e.dataTransfer.effectAllowed = 'move'; caja.classList.add('arrastrando'); });
    caja.addEventListener('dragend', () => { caja.draggable = false; caja.classList.remove('arrastrando'); });
    caja.addEventListener('dragover', (e) => { if (arrastrando === null) return; e.preventDefault(); caja.classList.add('sobre'); });
    caja.addEventListener('dragleave', () => caja.classList.remove('sobre'));
    caja.addEventListener('drop', (e) => { if (arrastrando === null) return; e.preventDefault(); const o = [...ids]; o.splice(i, 0, o.splice(arrastrando, 1)[0]); arrastrando = null; guardar(o, ocultos); });
    return caja;
  });
}
export const elegirImagen = (multiple) => elegirImagenes(multiple);

// ---------- Inicio: mover módulos entre secciones arrastrando su tarjeta ----------
export function moduloArrastrable(card, m, seccion) {
  card.draggable = true;
  card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-modulo', m.id); e.dataTransfer.effectAllowed = 'move'; card.classList.add('arrastrando'); });
  card.addEventListener('dragend', () => card.classList.remove('arrastrando'));
}
export function zonaModulos(grid, seccion) {
  grid.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('text/x-modulo')) { e.preventDefault(); grid.classList.add('sobre'); } });
  grid.addEventListener('dragleave', () => grid.classList.remove('sobre'));
  grid.addEventListener('drop', async (e) => {
    const id = e.dataTransfer.getData('text/x-modulo'); if (!id) return;
    e.preventDefault(); grid.classList.remove('sobre');
    const m = await asegurar(id);
    if (seccion === 'area' && !m.area) {
      const d = { area: 'face' };
      if (!await dialogo('¿De qué área es?', fTxt(d, 'area', 'Área', { opciones: [['face', 'Face Design'], ['n2', 'N2 Demodenture'], ['n3', 'N3 Prosthetic'], ['n6', 'N6 Material Changes'], ['support', 'Support']] }, () => {}), 'Mover')) return;
      m.area = d.area;
    }
    if (seccion !== 'area') delete m.area;
    m.seccion = seccion;
    // posición: antes de la tarjeta sobre la que se soltó (o al final)
    const cards = [...grid.querySelectorAll('a.tr-mod-card')], destino = e.target.closest && e.target.closest('a.tr-mod-card');
    const idsSec = cards.map((c) => (c.getAttribute('href') || '').replace('#/m/', '')).filter((x) => x !== id);
    const pos = destino ? idsSec.indexOf((destino.getAttribute('href') || '').replace('#/m/', '')) : idsSec.length;
    idsSec.splice(pos < 0 ? idsSec.length : pos, 0, id);
    const base = { intro: 1, area: 10, biblioteca: 40 }[seccion] || 40;
    for (const [k, mid] of idsSec.entries()) { const mm = await asegurar(mid); if (mm.orden !== base + k) { mm.orden = base + k; cambio(mid); } }
    cambio(id); mods().sort((a, b) => (a.orden ?? 99) - (b.orden ?? 99)); X.pintarMenu(); X.ruta();
  });
}
