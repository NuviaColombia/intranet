// Training: utilidades compartidas (DOM, idioma ES/EN, API, texto con formato, glosario).
export const CFG = window.TR_CFG || {};

export const S = {
  lang: (() => { try { return localStorage.getItem('tr_lang') || 'es'; } catch (e) { return 'es'; } })(),
  contenido: null, progreso: {}, modelos: {}, glosarioIdx: null,
};

// ---------- Textos de la interfaz ----------
const UI = {
  es: {
    inicio: 'Inicio', ruta: 'Ruta de aprendizaje', glosario: 'Glosario', examen: 'Examen final', admin: 'Administrar', diploma: 'Diploma',
    laboratorio: 'Laboratorio 3D', buscar: 'Buscar lecciones y términos…', sinResultados: 'Sin resultados', salir: 'Salir',
    hola: 'Hola, {n}', bienvenida: 'Bienvenido a Nuvia Training', subBienvenida: 'Aprende por qué hacemos las cosas como las hacemos: el lenguaje, los protocolos y las razones detrás de cada decisión. Sin conocimientos previos.',
    continuar: 'Continuar', empezar: 'Empezar', repasar: 'Repasar', completado: 'Completado', enCurso: 'En curso', nuevo: 'Nuevo',
    lecciones: 'lecciones', leccion: 'lección', min: 'min', progresoTotal: 'Tu progreso', de: 'de', modulos: 'Módulos', verModulo: 'Ver módulo',
    ultima: 'Continúa donde te quedaste', herramientas: 'Herramientas', labDesc: 'Mueve cada parte de la prótesis y mira el efecto en 3D, con el lenguaje oficial de Nuvia.',
    glosarioDesc: 'Todos los términos explicados en una línea, en español e inglés.', examenDesc: '20 preguntas de todo el curso. Aprueba con 80% y recibe tu diploma.',
    adminDesc: 'Sube los modelos 3D de las lecciones y revisa el avance del equipo.', anterior: 'Anterior', siguiente: 'Siguiente', terminar: 'Terminar lección',
    paso: 'Paso', volver: 'Volver', moduloSig: 'Siguiente módulo', leccionSig: 'Siguiente lección', verTodas: 'Ver todas las tarjetas', tocaVoltear: 'Toca una tarjeta para ver más',
    porque: 'Por qué lo hacemos así', dato: 'Dato clave', alerta: 'Ojo', general: 'Conocimiento general', confirmar: 'Confirmar con el manager',
    comprobar: 'Comprobar', siguientePreg: 'Siguiente pregunta', verResultado: 'Ver resultado', reintentar: 'Intentar de nuevo', correcto: '¡Correcto!', incorrecto: 'No exactamente',
    explicacion: 'Por qué', puntaje: 'Puntaje', aprobaste: '¡Aprobaste!', repetir: 'Repasa el contenido e inténtalo otra vez', verdadero: 'Verdadero', falso: 'Falso',
    ordena: 'Ordena de primero a último (usa las flechas)', empareja: 'Une cada elemento con su pareja', elige: 'Elige…', sube: 'Subir', baja: 'Bajar', selecciona: 'Selecciona una o varias',
    simVista: 'Vista', frontal: 'Frontal', perfil: 'Perfil', oclusal: 'Oclusal', libre: 'Libre', reiniciar: 'Reiniciar', fantasma: 'Posición inicial', estatico: 'Punto estático',
    receta: 'Así se escribiría en la receta (RX)', sinCambios: 'Sin cambios', reto: 'Reto', retoOk: '¡Reto cumplido!', retoFalta: 'Ajusta los deslizadores hasta acercarte al objetivo',
    antagonistaFijo: 'Antagonista fijo (Single 24z)', antagonistaSigue: 'El arco inferior acompaña', contacto: 'Contacto correcto', interferencia: 'Interferencia', sinOcluir: 'Sin ocluir',
    interfTxt: 'las cúspides superiores atraviesan el modelo inferior', espacioTxt: 'queda un espacio entre los arcos', vdoTxt: 'Apertura de VDO',
    play: 'Reproducir', pausa: 'Pausa', repetirTour: 'Repetir', escena: 'Escena', velocidad: 'Velocidad', tour: 'Animación explicativa',
    modeloPend: 'Modelo 3D pendiente', subirModelo: 'Subir modelo', reemplazar: 'Reemplazar', quitar: 'Quitar', verRecorrido: 'Recorrido', pines: 'Pines', agregarPin: 'Agregar pin',
    clicModelo: 'Haz clic sobre el modelo para colocar el pin', alambre: 'Malla', corte: 'Plano de corte', fondo: 'Fondo', reiniciarVista: 'Reiniciar vista', girar: 'Arrastra para girar · rueda para acercar',
    cargandoModelo: 'Cargando modelo…', errorModelo: 'No se pudo cargar el modelo', soloAdmin: 'Solo los admins pueden subir modelos', tituloPin: 'Título del pin', textoPin: 'Texto del pin',
    guardar: 'Guardar', cancelar: 'Cancelar', eliminar: 'Eliminar', cerrar: 'Cerrar', protocoloOficial: 'Abrir en Protocols', buscaEn: 'Búscalo en Protocols como', copiado: 'Copiado',
    espesorTitulo: 'Verifica tu diseño contra la garantía', tamArco: 'Tamaño de arco', medida: 'Tu medida (mm)', minimo: 'Mínimo', maximo: 'Máximo', cumple: 'Cumple', noCumple: 'No cumple',
    posteriores: 'Grosor posterior', anteriores: 'Grosor anterior', cantilever: 'Cantilever', bucalLingPost: 'Bucal-lingual posterior', bucalLingAnt: 'Bucal-lingual anterior',
    cmpA: 'Comparar', con: 'con', iguales: 'mismos dientes, arco más ancho', mas10: '≈10% más grande en todas las dimensiones', masAncho: '4–5 mm más ancho',
    glosBuscar: 'Buscar en el glosario…', glosTodos: 'Todos', glosVer: 'Ver en el glosario', glosCat: 'Categoría', terminos: 'términos',
    exTitulo: 'Examen final', exIntro: '20 preguntas tomadas de todas las lecciones. Necesitas 80% para aprobar. Puedes repetirlo las veces que quieras.', exEmpezar: 'Empezar examen', exMejor: 'Tu mejor puntaje',
    exAprobado: 'Examen aprobado', verDiploma: 'Ver mi diploma', imprimir: 'Imprimir / Guardar PDF', diplomaTit: 'Certificado de finalización', diplomaTxt: 'ha completado la capacitación', diplomaSub: 'sobre el lenguaje y los protocolos de diseño de Nuvia',
    fecha: 'Fecha', sinDiploma: 'Aprueba el examen final para obtener tu diploma', modelos3d: 'Modelos 3D', equipo: 'Avance del equipo', persona: 'Persona', avance: 'Avance', promedio: 'Promedio quizzes', examenCol: 'Examen', ultimaCol: 'Última actividad',
    espacio: 'Espacio', estado: 'Estado', subido: 'Subido', pendiente: 'Pendiente', acciones: 'Acciones', lecc: 'Lección', formatos: 'Formatos: GLB, STL, OBJ, PLY (máx. 60 MB)', subiendo: 'Subiendo…', subidoOk: 'Modelo subido',
    errorGenerico: 'Algo salió mal. Inténtalo de nuevo.', sinContenido: 'Todavía no hay contenido cargado.', cargando: 'Cargando…', idioma: 'Idioma', menu: 'Menú', progresoGuardado: 'Avance guardado', errorProgreso: 'No se pudo guardar el avance',
    checklist: 'Lista de verificación', tocaMarcar: 'Marca cada punto', esencial: 'Lo esencial', quiz: 'Comprueba lo aprendido', nivel: 'Nivel', basico: 'Básico', intermedio: 'Intermedio', avanzado: 'Avanzado',
    atajos: 'Atajos: ← → para moverte · Esc para salir', pasoDe: 'Paso {a} de {b}', completaLeccion: '¡Lección completada!', necesitas70: 'Necesitas al menos 70% en el quiz para completar la lección.',
    buscarMas: 'más resultados', enLeccion: 'Lección', enGlosario: 'Glosario', vistaDe: 'Vista', sinModelos: 'Aún no hay espacios de modelos', porcentaje: '{n}% completado', soloLectura: 'Solo lectura',
    labTitulo: 'Laboratorio de movimientos', labSub: 'Explora libremente cada movimiento del Lenguaje de Modificación.', pdf: 'PDF', verLeccion: 'Ver lección',
  },
  en: {
    inicio: 'Home', ruta: 'Learning path', glosario: 'Glossary', examen: 'Final exam', admin: 'Manage', diploma: 'Diploma',
    laboratorio: '3D Lab', buscar: 'Search lessons and terms…', sinResultados: 'No results', salir: 'Exit',
    hola: 'Hi, {n}', bienvenida: 'Welcome to Nuvia Training', subBienvenida: 'Learn why we do things the way we do: the language, the protocols and the reasons behind every decision. No prior knowledge needed.',
    continuar: 'Continue', empezar: 'Start', repasar: 'Review', completado: 'Completed', enCurso: 'In progress', nuevo: 'New',
    lecciones: 'lessons', leccion: 'lesson', min: 'min', progresoTotal: 'Your progress', de: 'of', modulos: 'Modules', verModulo: 'View module',
    ultima: 'Pick up where you left off', herramientas: 'Tools', labDesc: 'Move each part of the prosthesis and see the effect in 3D, using Nuvia’s official language.',
    glosarioDesc: 'Every term explained in one line, in Spanish and English.', examenDesc: '20 questions from the whole course. Pass with 80% and get your diploma.',
    adminDesc: 'Upload the 3D models used in lessons and check the team’s progress.', anterior: 'Previous', siguiente: 'Next', terminar: 'Finish lesson',
    paso: 'Step', volver: 'Back', moduloSig: 'Next module', leccionSig: 'Next lesson', verTodas: 'See all cards', tocaVoltear: 'Tap a card to see more',
    porque: 'Why we do it this way', dato: 'Key fact', alerta: 'Watch out', general: 'General knowledge', confirmar: 'Confirm with the manager',
    comprobar: 'Check', siguientePreg: 'Next question', verResultado: 'See result', reintentar: 'Try again', correcto: 'Correct!', incorrecto: 'Not quite',
    explicacion: 'Why', puntaje: 'Score', aprobaste: 'You passed!', repetir: 'Review the content and try again', verdadero: 'True', falso: 'False',
    ordena: 'Put in order, first to last (use the arrows)', empareja: 'Match each item with its pair', elige: 'Choose…', sube: 'Move up', baja: 'Move down', selecciona: 'Select one or more',
    simVista: 'View', frontal: 'Front', perfil: 'Profile', oclusal: 'Occlusal', libre: 'Free', reiniciar: 'Reset', fantasma: 'Initial position', estatico: 'Static point',
    receta: 'This is how it would be written on the prescription (RX)', sinCambios: 'No changes', reto: 'Challenge', retoOk: 'Challenge complete!', retoFalta: 'Adjust the sliders until you get close to the target',
    antagonistaFijo: 'Fixed antagonist (Single 24z)', antagonistaSigue: 'The lower arch follows', contacto: 'Correct contact', interferencia: 'Interference', sinOcluir: 'No occlusion',
    interfTxt: 'the upper cusps pass through the lower model', espacioTxt: 'there is a gap between the arches', vdoTxt: 'VDO opening',
    play: 'Play', pausa: 'Pause', repetirTour: 'Replay', escena: 'Scene', velocidad: 'Speed', tour: 'Guided animation',
    modeloPend: '3D model pending', subirModelo: 'Upload model', reemplazar: 'Replace', quitar: 'Remove', verRecorrido: 'Tour', pines: 'Pins', agregarPin: 'Add pin',
    clicModelo: 'Click on the model to place the pin', alambre: 'Wireframe', corte: 'Clipping plane', fondo: 'Background', reiniciarVista: 'Reset view', girar: 'Drag to rotate · scroll to zoom',
    cargandoModelo: 'Loading model…', errorModelo: 'The model could not be loaded', soloAdmin: 'Only admins can upload models', tituloPin: 'Pin title', textoPin: 'Pin text',
    guardar: 'Save', cancelar: 'Cancel', eliminar: 'Delete', cerrar: 'Close', protocoloOficial: 'Open in Protocols', buscaEn: 'Look it up in Protocols as', copiado: 'Copied',
    espesorTitulo: 'Check your design against the warranty', tamArco: 'Arch size', medida: 'Your measurement (mm)', minimo: 'Minimum', maximo: 'Maximum', cumple: 'Meets', noCumple: 'Does not meet',
    posteriores: 'Posterior thickness', anteriores: 'Anterior thickness', cantilever: 'Cantilever', bucalLingPost: 'Buccal-lingual posterior', bucalLingAnt: 'Buccal-lingual anterior',
    cmpA: 'Compare', con: 'with', iguales: 'same teeth, wider arch', mas10: '≈10% bigger in all dimensions', masAncho: '4–5 mm wider',
    glosBuscar: 'Search the glossary…', glosTodos: 'All', glosVer: 'See in glossary', glosCat: 'Category', terminos: 'terms',
    exTitulo: 'Final exam', exIntro: '20 questions taken from every lesson. You need 80% to pass. You can retake it as many times as you like.', exEmpezar: 'Start exam', exMejor: 'Your best score',
    exAprobado: 'Exam passed', verDiploma: 'See my diploma', imprimir: 'Print / Save as PDF', diplomaTit: 'Certificate of completion', diplomaTxt: 'has completed the training', diplomaSub: 'on Nuvia’s design language and protocols',
    fecha: 'Date', sinDiploma: 'Pass the final exam to get your diploma', modelos3d: '3D models', equipo: 'Team progress', persona: 'Person', avance: 'Progress', promedio: 'Quiz average', examenCol: 'Exam', ultimaCol: 'Last activity',
    espacio: 'Slot', estado: 'Status', subido: 'Uploaded', pendiente: 'Pending', acciones: 'Actions', lecc: 'Lesson', formatos: 'Formats: GLB, STL, OBJ, PLY (max. 60 MB)', subiendo: 'Uploading…', subidoOk: 'Model uploaded',
    errorGenerico: 'Something went wrong. Please try again.', sinContenido: 'There is no content yet.', cargando: 'Loading…', idioma: 'Language', menu: 'Menu', progresoGuardado: 'Progress saved', errorProgreso: 'Progress could not be saved',
    checklist: 'Checklist', tocaMarcar: 'Check each item', esencial: 'The essentials', quiz: 'Check what you learned', nivel: 'Level', basico: 'Basic', intermedio: 'Intermediate', avanzado: 'Advanced',
    atajos: 'Shortcuts: ← → to move · Esc to exit', pasoDe: 'Step {a} of {b}', completaLeccion: 'Lesson completed!', necesitas70: 'You need at least 70% on the quiz to complete the lesson.',
    buscarMas: 'more results', enLeccion: 'Lesson', enGlosario: 'Glossary', vistaDe: 'View', sinModelos: 'There are no model slots yet', porcentaje: '{n}% completed', soloLectura: 'Read only',
    labTitulo: 'Movement lab', labSub: 'Freely explore each movement of the Modification Language.', pdf: 'PDF', verLeccion: 'View lesson',
  },
};

export function ui(clave, vars) {
  let s = (UI[S.lang] && UI[S.lang][clave]) ?? UI.es[clave];
  if (s === undefined) { console.warn('[training] falta el texto de interfaz:', clave); s = clave; }
  if (vars) for (const k in vars) s = s.replaceAll('{' + k + '}', vars[k]);
  return s;
}
export const hayTexto = (clave) => clave in UI.es;

// Texto bilingüe {es, en} → cadena en el idioma actual (si falta uno, usa el otro)
export function t(o) {
  if (o == null) return '';
  if (typeof o === 'string') return o;
  return o[S.lang] || o.es || o.en || '';
}
export function setLang(l) {
  S.lang = l === 'en' ? 'en' : 'es'; S.glosarioIdx = null;
  try { localStorage.setItem('tr_lang', S.lang); } catch (e) { /* sin almacenamiento: no pasa nada */ }
  document.documentElement.setAttribute('data-tr-lang', S.lang);
}

// ---------- DOM ----------
export function h(tag, attrs, ...hijos) {
  const e = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'style' && typeof v === 'object') { for (const p in v) { if (p.startsWith('--')) e.style.setProperty(p, v[p]); else e.style[p] = v[p]; } }
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'data') for (const d in v) e.dataset[d] = v[d];
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of hijos.flat(Infinity)) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
}
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function vaciar(e) { while (e.firstChild) e.removeChild(e.firstChild); return e; }

// ---------- API ----------
async function pedir(url, opts) {
  const r = await fetch(url, { credentials: 'same-origin', ...opts });
  let d = null;
  try { d = await r.json(); } catch (e) { /* sin cuerpo JSON */ }
  if (!r.ok) throw new Error((d && d.detail) || (r.status + ''));
  return d;
}
export const api = {
  get: (u) => pedir(u),
  post: (u, body) => pedir(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }),
  subir: (u, form) => pedir(u, { method: 'POST', body: form }),
};

export function toast(msg, tipo) {
  const c = document.getElementById('trToasts') || document.body.appendChild(h('div', { id: 'trToasts', class: 'tr-toasts', 'aria-live': 'polite' }));
  const e = h('div', { class: 'tr-toast ' + (tipo || '') }, msg);
  c.append(e);
  setTimeout(() => e.classList.add('sale'), 2600);
  setTimeout(() => e.remove(), 3100);
}

// ---------- Texto con formato (**negrita**, *cursiva*, listas "- ") y términos del glosario ----------
function inline(s) { return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<i>$2</i>'); }

function indiceGlosario() {
  if (S.glosarioIdx) return S.glosarioIdx;
  const lista = (S.contenido && S.contenido.glosario) || [];
  const mapa = new Map();
  for (const g of lista) {
    const tt = t(g.termino).trim();
    if (tt.length >= 2 && !mapa.has(tt.toLowerCase())) mapa.set(tt.toLowerCase(), g);
  }
  const terminos = [...mapa.keys()].sort((a, b) => b.length - a.length).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = terminos.length ? new RegExp('(?<![\\p{L}\\p{N}])(' + terminos.join('|') + ')(?![\\p{L}\\p{N}])', 'giu') : null;
  S.glosarioIdx = { mapa, re };
  return S.glosarioIdx;
}

function enlazarTerminos(raiz, maximo, yaVistos) {
  const { mapa, re } = indiceGlosario();
  if (!re) return;
  let n = 0;
  const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT, { acceptNode: (x) => (x.parentElement.closest('.tr-term, a, button, code') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  const nodos = []; while (w.nextNode()) nodos.push(w.currentNode);
  for (const nodo of nodos) {
    if (n >= maximo) break;
    const txt = nodo.nodeValue; re.lastIndex = 0;
    let m, ult = 0; const frag = document.createDocumentFragment(); let hubo = false;
    while ((m = re.exec(txt)) && n < maximo) {
      const g = mapa.get(m[1].toLowerCase());
      if (!g || yaVistos.has(g.id)) continue;
      yaVistos.add(g.id); n++; hubo = true;
      frag.append(txt.slice(ult, m.index), h('button', { type: 'button', class: 'tr-term', data: { id: g.id }, 'aria-label': t(g.termino) }, m[1]));
      ult = m.index + m[1].length;
    }
    if (hubo) { frag.append(txt.slice(ult)); nodo.replaceWith(frag); }
  }
}

export function md(texto, opts) {
  const o = opts || {};
  const raiz = h('div', { class: 'tr-md' });
  const lineas = String(t(texto)).split('\n');
  let lista = null;
  for (const l of lineas) {
    if (/^\s*[-•]\s+/.test(l)) {
      if (!lista) { lista = h('ul'); raiz.append(lista); }
      lista.append(h('li', { html: inline(l.replace(/^\s*[-•]\s+/, '')) }));
    } else {
      lista = null;
      if (l.trim()) raiz.append(h('p', { html: inline(l) }));
    }
  }
  if (!o.sinGlosario) enlazarTerminos(raiz, o.maxTerminos || 5, o.vistos || new Set());
  return raiz;
}

// Ventanita con la definición de un término (clic en cualquier término subrayado)
let pop = null;
export function iniciarGlosarioPop() {
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest && ev.target.closest('.tr-term');
    if (pop) { pop.remove(); pop = null; }
    if (!b) return;
    const g = ((S.contenido && S.contenido.glosario) || []).find((x) => x.id === b.dataset.id);
    if (!g) return;
    pop = h('div', { class: 'tr-pop', role: 'dialog' },
      h('b', null, t(g.termino)), h('p', null, t(g.def)),
      h('a', { href: '#/glosario/' + g.id, class: 'tr-pop-ver' }, ui('glosVer') + ' →'));
    document.body.append(pop);
    const r = b.getBoundingClientRect(), pw = pop.offsetWidth;
    pop.style.top = Math.min(window.innerHeight - pop.offsetHeight - 8, r.bottom + 8) + 'px';
    pop.style.left = Math.max(8, Math.min(window.innerWidth - pw - 8, r.left)) + 'px';
    ev.stopPropagation();
  }, true);
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && pop) { pop.remove(); pop = null; } });
}

// ---------- Progreso ----------
export function pruebasDe(leccion) { return (leccion.pasos || []).filter((p) => p.t === 'quiz'); }
export function todasLasLecciones() { return ((S.contenido && S.contenido.modulos) || []).flatMap((m) => (m.lecciones || []).map((l) => ({ ...l, modulo: m }))); }
export function estadoLeccion(id) { return S.progreso[id] || { completada: false, puntaje: 0 }; }
export function resumenModulo(m) {
  const ls = m.lecciones || [], hechas = ls.filter((l) => estadoLeccion(l.id).completada).length;
  return { total: ls.length, hechas, pct: ls.length ? Math.round((hechas * 100) / ls.length) : 0,
    estado: hechas === ls.length && ls.length ? 'hecho' : (hechas || ls.some((l) => estadoLeccion(l.id).puntaje) ? 'curso' : 'nuevo'),
    minutos: ls.reduce((a, l) => a + (l.minutos || 5), 0) };
}
export function resumenGeneral() {
  const ls = todasLasLecciones(), hechas = ls.filter((l) => estadoLeccion(l.id).completada).length;
  return { total: ls.length, hechas, pct: ls.length ? Math.round((hechas * 100) / ls.length) : 0 };
}
export async function guardarProgreso(id, datos) {
  const previo = S.progreso[id] || { completada: false, puntaje: 0, dato: '' };
  S.progreso[id] = { ...previo, ...(datos.completada ? { completada: true } : {}), puntaje: Math.max(previo.puntaje || 0, datos.puntaje || 0), dato: datos.dato ?? previo.dato };
  try {
    await api.post('/design/api/training/progreso', { leccion: id, completada: datos.completada, puntaje: datos.puntaje, dato: datos.dato });
  } catch (e) { toast(ui('errorProgreso'), 'error'); }
}

export function anillo(pct, tam, grosor) {
  const r = (tam - grosor) / 2, c = 2 * Math.PI * r;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', `0 0 ${tam} ${tam}`); svg.setAttribute('width', tam); svg.setAttribute('height', tam); svg.setAttribute('class', 'tr-anillo'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', pct + '%');
  const mk = (cls, off) => { const k = document.createElementNS(ns, 'circle'); k.setAttribute('cx', tam / 2); k.setAttribute('cy', tam / 2); k.setAttribute('r', r); k.setAttribute('fill', 'none'); k.setAttribute('stroke-width', grosor); k.setAttribute('class', cls); if (off != null) { k.setAttribute('stroke-dasharray', c); k.setAttribute('stroke-dashoffset', off); k.setAttribute('stroke-linecap', 'round'); k.setAttribute('transform', `rotate(-90 ${tam / 2} ${tam / 2})`); } return k; };
  svg.append(mk('fondo'), mk('arco', c * (1 - pct / 100)));
  return svg;
}
export const barra = (pct) => h('div', { class: 'tr-barra', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('i', { style: { width: pct + '%' } }));
