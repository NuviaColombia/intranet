// Training: edición de cada paso directamente donde se ve (modo edición de los admins). Cada tipo de paso se muestra completo
// (tarjetas con sus dos caras, acordeón abierto, quiz con todas sus preguntas) y cada texto se escribe en su lugar, en el idioma
// que se está viendo. Los elementos (tarjetas, etapas, opciones, filas…) se agregan, quitan y mueven con sus botones.
import { h, t, S, md, ui, AREAS, tarjetaLider } from './lib.js';
import { renderPaso, figura } from './steps.js';

const otro = () => (S.lang === 'es' ? 'en' : 'es');
const T2 = (es, en) => ({ es, en: en ?? es });

// ---------- Campo de texto editable en el lugar ----------
// get() → {es, en} (o undefined), set(v). opciones: tag, cls, multi (texto largo con formato), ph (texto guía), opcional
export function campo(get, set, cambio, o = {}) {
  const tag = o.tag || (o.multi ? 'div' : 'span');
  const el = h(tag, { class: 'tr-el-campo' + (o.multi ? ' multi' : '') + (o.cls ? ' ' + o.cls : ''), 'data-ph': o.ph || (o.multi ? 'Escribe aquí…' : 'Escribe…') });
  const crudo = () => { const v = get(); return (v && typeof v === 'object' ? v[S.lang] : '') || ''; };
  const pintar = () => {
    const r = crudo(), v = get();
    if (o.multi && r) el.replaceChildren(...md(T2(r), { sinGlosario: true, sinEditar: true }).childNodes); else el.textContent = r;
    el.classList.toggle('vacio', !r);
    const falta = !!(v && r && !String(v[otro()] || '').trim());
    el.classList.toggle('falta-trad', falta);
    if (falta) el.title = 'Falta la traducción al ' + (otro() === 'en' ? 'inglés' : 'español') + ' (cambia el idioma arriba para escribirla)'; else el.removeAttribute('title');
  };
  try { el.contentEditable = 'plaintext-only'; } catch (e) { /* navegador sin plaintext-only */ }
  if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
  el.spellcheck = true;
  // al entrar se muestra el texto para escribir (con ** y "- "); se cambia después del clic para no perder el cursor
  el.addEventListener('focus', () => {
    el.classList.add('editando');
    if (!o.multi || el.innerText.trim() === crudo().trim()) return;
    setTimeout(() => {
      if (document.activeElement !== el) return;
      el.textContent = crudo();
      const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
      const sl = window.getSelection(); sl.removeAllRanges(); sl.addRange(r);
    }, 0);
  });
  el.addEventListener('blur', () => { el.classList.remove('editando'); pintar(); });
  el.addEventListener('input', () => {
    let txt = el.innerText.replace(/ /g, ' ');
    txt = o.multi ? txt.replace(/\n{3,}/g, '\n\n') : txt.replace(/\n/g, ' ');
    const v = get(), n = { es: '', en: '', ...(v && typeof v === 'object' ? v : {}), [S.lang]: txt };
    if (o.opcional && !n.es.trim() && !n.en.trim()) set(undefined); else set(n);
    el.classList.toggle('vacio', !txt.trim());
    cambio();
  });
  el.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape' || (e.key === 'Enter' && (!o.multi || e.ctrlKey || e.metaKey))) { e.preventDefault(); el.blur(); }
  });
  el.addEventListener('click', (e) => e.stopPropagation());
  pintar();
  return el;
}
const campoDe = (obj, clave, cambio, o) => campo(() => obj[clave], (v) => { if (v === undefined) delete obj[clave]; else obj[clave] = v; }, cambio, o);
// texto sencillo (no bilingüe): icono, etc.
function campoSimple(obj, clave, cambio, o = {}) {
  const el = h('span', { class: 'tr-el-campo simple ' + (o.cls || ''), 'data-ph': o.ph || '…', title: o.titulo || '' }, obj[clave] || '');
  el.contentEditable = 'true';
  el.addEventListener('input', () => { const v = el.textContent.trim(); if (v) obj[clave] = v; else delete obj[clave]; cambio(); });
  el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); el.blur(); } });
  return el;
}
const sel = (opciones, valor, alElegir, o = {}) => h('select', { class: 'tr-el-sel', title: o.titulo || '', 'aria-label': o.titulo || '', onchange: (e) => alElegir(e.target.value) },
  opciones.map(([v, rot]) => h('option', { value: v, selected: String(valor ?? '') === String(v) }, rot)));
const boton = (txt, accion, cls) => h('button', { type: 'button', class: 'tr-el-btn' + (cls ? ' ' + cls : ''), onclick: (e) => { e.stopPropagation(); accion(); } }, txt);

// ---------- Lista de elementos (agregar, quitar, mover arrastrando o con flechas) ----------
function lista(arr, dibujar, nuevo, ctx, o = {}) {
  const cont = h('div', { class: 'tr-el-lista ' + (o.cls || '') });
  let arrastrando = null;
  arr.forEach((it, i) => {
    const item = h('div', { class: 'tr-el-item' + (o.clsItem ? ' ' + o.clsItem : '') },
      h('div', { class: 'tr-el-herr' },
        h('span', { class: 'tr-el-asa', title: 'Arrastra para mover', onmousedown: () => { item.draggable = true; }, onmouseup: () => { item.draggable = false; } }, '⠿'),
        boton('↑', () => { arr.splice(i - 1, 0, arr.splice(i, 1)[0]); ctx.estructura(); }, i === 0 ? 'oculto' : ''),
        boton('↓', () => { arr.splice(i + 1, 0, arr.splice(i, 1)[0]); ctx.estructura(); }, i === arr.length - 1 ? 'oculto' : ''),
        arr.length > (o.min || 0) ? boton('✕', () => { arr.splice(i, 1); ctx.estructura(); }, 'peligro') : null),
      dibujar(it, i, (v) => { arr[i] = v; }));
    item.addEventListener('dragstart', (e) => { arrastrando = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'item'); item.classList.add('arrastrando'); e.stopPropagation(); });
    item.addEventListener('dragend', () => { item.draggable = false; item.classList.remove('arrastrando'); });
    item.addEventListener('dragover', (e) => { if (arrastrando === null) return; e.preventDefault(); e.stopPropagation(); item.classList.add('sobre'); });
    item.addEventListener('dragleave', () => item.classList.remove('sobre'));
    item.addEventListener('drop', (e) => { if (arrastrando === null) return; e.preventDefault(); e.stopPropagation(); arr.splice(i, 0, arr.splice(arrastrando, 1)[0]); arrastrando = null; ctx.estructura(); });
    cont.append(item);
  });
  if (!o.max || arr.length < o.max) cont.append(boton('＋ ' + (o.agregar || 'Agregar'), () => { arr.push(nuevo()); ctx.estructura(); }, 'agregar'));
  return cont;
}

// ---------- Cada tipo de paso, editable ----------
export function pasoEditable(p, ctx) {
  const c = ctx.cambio, est = ctx.estructura;
  const titulo = (opcional) => (p.titulo || !opcional ? campoDe(p, 'titulo', c, { tag: 'h2', cls: 'tr-paso-tit', ph: 'Título del paso', opcional }) : h('div', { class: 'tr-el-fila' }, boton('＋ Título', () => { p.titulo = T2('Título', 'Title'); est(); })));
  const caja = (cls, ...hijos) => h('div', { class: 'tr-paso tr-el-paso ' + (cls || '') }, ...hijos);
  switch (p.t) {
    case 'texto': {
      const cuerpo = campoDe(p, 'cuerpo', c, { multi: true, ph: 'Escribe la explicación. **negrita**, *cursiva*, y listas con "- " al inicio de la línea.' });
      const LADOS = ['der', 'izq', 'arriba', 'abajo'];
      const im = p.imagen && p.imagen.src ? figura(p.imagen, 'tr-fig-lado', { quitar: () => { delete p.imagen; est(); }, lado: () => { p.imagen.lado = LADOS[(LADOS.indexOf(p.imagen.lado || 'der') + 1) % 4]; est(); } }) : null;
      const NOTAS = [['porque', '💡', ui('porque')], ['dato', '📌', ui('dato')], ['alerta', '⚠️', ui('alerta')]];
      const notas = NOTAS.filter(([k]) => p[k]).map(([k, ico, rot]) => h('aside', { class: 'tr-callout ' + k + ' tr-el-nota' }, h('div', { class: 'tr-callout-tit' }, h('span', null, ico), rot, boton('✕', () => { delete p[k]; est(); }, 'peligro chico')),
        campoDe(p, k, c, { multi: true, ph: 'Escribe la nota…' })));
      const faltan = NOTAS.filter(([k]) => !p[k]);
      return caja('tr-paso-texto', titulo(), im ? h('div', { class: 'tr-texto-img ' + ((p.imagen && p.imagen.lado) || 'der') }, im, cuerpo) : cuerpo, ...notas,
        h('div', { class: 'tr-el-fila' }, ...faltan.map(([k, ico, rot]) => boton('＋ ' + ico + ' ' + rot, () => { p[k] = T2(''); est(); })),
          !im ? boton('＋ 🖼 Imagen al lado del texto', async () => { const l = await ctx.imagenes(false); if (l && l[0]) { p.imagen = { ...l[0], lado: 'der' }; est(); } }) : null));
    }
    case 'imagen': return renderPaso(p, {}).el;
    case 'tarjetas': {
      p.items = p.items || [];
      return caja('', titulo(), h('div', { class: 'tr-pista' }, 'Así se ven las dos caras de cada tarjeta: el frente (icono y título) y lo que aparece al voltearla.'),
        lista(p.items, (it) => h('div', { class: 'tr-el-tarjeta' }, h('div', { class: 'tr-el-tarjeta-frente' }, campoSimple(it, 'icono', c, { cls: 'tr-tarjeta-ico', ph: '◆', titulo: 'Icono (emoji)' }), campoDe(it, 'titulo', c, { tag: 'b', ph: 'Título' })),
          h('div', { class: 'tr-el-tarjeta-dorso' }, h('small', null, '↻ Al voltear:'), campoDe(it, 'texto', c, { multi: true, ph: 'Explicación' }))),
        () => ({ titulo: T2('Nueva tarjeta', 'New card'), texto: T2('Explicación.', 'Explanation.') }), ctx, { cls: 'tr-el-grid', agregar: 'Tarjeta', min: 1 }));
    }
    case 'acordeon':
      p.items = p.items || [];
      return caja('', titulo(), lista(p.items, (it) => h('div', { class: 'tr-el-acc' }, campoDe(it, 'titulo', c, { tag: 'b', ph: 'Tema o pregunta' }), campoDe(it, 'texto', c, { multi: true, ph: 'Lo que aparece al abrirlo' })),
        () => ({ titulo: T2('Nuevo tema', 'New topic'), texto: T2('Explicación.', 'Explanation.') }), ctx, { agregar: 'Tema', min: 1 }));
    case 'flujo':
      p.pasos = p.pasos || [];
      return caja('', titulo(), lista(p.pasos, (it, i) => h('div', { class: 'tr-el-etapa' }, h('span', { class: 'tr-el-num' }, i + 1), h('div', null, campoDe(it, 'titulo', c, { tag: 'b', ph: 'Etapa' }), campoDe(it, 'texto', c, { multi: true, ph: 'Qué pasa en esta etapa' }))),
        () => ({ titulo: T2('Nueva etapa', 'New stage'), texto: T2('Qué pasa aquí.', 'What happens here.') }), ctx, { agregar: 'Etapa', min: 1 }));
    case 'caso':
      p.etapas = p.etapas || [];
      return caja('tr-caso', h('span', { class: 'tr-caso-sello' }, '🧪 ' + ui('casoEjemplo')), titulo(), campoDe(p, 'contexto', c, { multi: true, ph: 'Situación del caso' }),
        lista(p.etapas, (e, i) => h('div', { class: 'tr-el-etapa' }, h('span', { class: 'tr-el-num' }, i + 1), h('div', null, campoDe(e, 'titulo', c, { tag: 'b', ph: 'Etapa' }), campoDe(e, 'texto', c, { multi: true, ph: 'Qué pasó' }),
          h('div', { class: 'tr-caso-meta' }, h('span', { class: 'tr-caso-tiempo' }, '⏱ ', campoDe(e, 'tiempo', c, { ph: 'tiempo (opcional)', opcional: true })), h('span', { class: 'tr-caso-quien' }, '👤 ', campoDe(e, 'quien', c, { ph: 'quién (opcional)', opcional: true }))))),
          () => ({ titulo: T2('Nueva etapa', 'New stage'), texto: T2('Qué pasó.', 'What happened.') }), ctx, { agregar: 'Etapa', min: 1 }),
        h('div', { class: 'tr-caso-res' }, h('b', null, '✅ ' + ui('resultado') + ': '), campoDe(p, 'resultado', c, { multi: true, ph: 'Resultado (opcional)', opcional: true })));
    case 'tabla': {
      p.cabeceras = p.cabeceras || []; p.filas = p.filas || [];
      const celda = (fila, j, tagc) => h(tagc, null, campo(() => fila[j], (v) => { fila[j] = v || T2(''); }, c, { ph: '…' }));
      const tb = h('table', { class: 'tr-tabla tr-el-tabla' },
        h('thead', null, h('tr', null, p.cabeceras.map((cb, j) => h('th', null, campo(() => p.cabeceras[j], (v) => { p.cabeceras[j] = v || T2(''); }, c, { ph: 'Columna' }),
          p.cabeceras.length > 1 ? boton('✕', () => { p.cabeceras.splice(j, 1); p.filas.forEach((f) => f.splice(j, 1)); est(); }, 'peligro chico') : null)), h('th', { class: 'tr-el-col-acc' }))),
        h('tbody', null, p.filas.map((f, i) => h('tr', null, f.map((x, j) => celda(f, j, j === 0 ? 'th' : 'td')),
          h('td', { class: 'tr-el-col-acc' }, i ? boton('↑', () => { p.filas.splice(i - 1, 0, p.filas.splice(i, 1)[0]); est(); }, 'chico') : null, boton('✕', () => { p.filas.splice(i, 1); est(); }, 'peligro chico'))))));
      return caja('', titulo(), h('div', { class: 'tr-tabla-w' }, tb), h('div', { class: 'tr-el-fila' }, boton('＋ Fila', () => { p.filas.push(p.cabeceras.map(() => T2(''))); est(); }), boton('＋ Columna', () => { p.cabeceras.push(T2('Columna', 'Column')); p.filas.forEach((f) => f.push(T2(''))); est(); })));
    }
    case 'checklist': case 'resumen': {
      const k = p.t === 'checklist' ? 'items' : 'puntos';
      p[k] = p[k] || [];
      return caja(p.t === 'resumen' ? 'tr-resumen' : '', titulo(p.t === 'resumen'),
        lista(p[k], (x, i, set) => h('div', { class: 'tr-el-punto' }, h('span', { class: p.t === 'resumen' ? 'tr-ok' : 'tr-check-caja' }, p.t === 'resumen' ? '✓' : ''), campo(() => p[k][i], (v) => { p[k][i] = v || T2(''); }, c, { multi: true, ph: 'Escribe el punto' })),
          () => T2('Nuevo punto', 'New item'), ctx, { agregar: 'Punto', min: 1 }));
    }
    case 'quiz':
      p.preguntas = p.preguntas || [];
      return caja('tr-el-quiz', h('h2', { class: 'tr-paso-tit' }, '🧠 ' + ui('quiz')), h('div', { class: 'tr-pista' }, 'Marca con ✓ la respuesta correcta. La explicación se muestra cuando la persona responde. Se aprueba con 70%.'),
        lista(p.preguntas, (q, i) => pregunta(q, i, ctx), () => ({ tipo: 'una', enunciado: T2('¿Nueva pregunta?', 'New question?'), explicacion: T2('Por qué.', 'Why.'), opciones: [0, 1, 2].map((n) => ({ texto: T2(n ? 'Opción' : 'Correcta', n ? 'Option' : 'Correct'), ok: !n })) }),
          ctx, { agregar: 'Pregunta', min: 1, max: 6, clsItem: 'tr-el-preg-w' }));
    case 'enlace': {
      const lecc = ctx.lecciones();
      return caja('', h('div', { class: 'tr-enlace' }, h('div', { class: 'tr-enlace-ico' }, p.lecc ? '📚' : '📋'),
        h('div', { class: 'tr-enlace-txt' }, campoDe(p, 'titulo', c, { tag: 'h3', ph: 'Título' }), campoDe(p, 'texto', c, { multi: true, ph: 'Texto' }),
          h('div', { class: 'tr-el-fila' }, h('span', null, 'Lleva a: '), sel([['', '— un protocolo de Protocols —'], ...lecc], p.lecc || '', (v) => { if (v) { p.lecc = v; delete p.protocolo; } else { delete p.lecc; p.protocolo = p.protocolo || ''; } est(); }, { titulo: 'Destino del enlace' }),
            !p.lecc ? h('span', null, ' Buscar: ', campoSimple(p, 'protocolo', c, { ph: 'nombre del protocolo' })) : null))));
    }
    case 'lider':
      return caja('', h('div', { class: 'tr-el-fila' }, h('span', null, 'Área: '), sel([['face', 'Face Design'], ['n2', 'N2 Demodenture'], ['n3', 'N3 Prosthetic'], ['n6', 'N6 Material Changes'], ['support', 'Support'], ['todas', 'Todas las áreas']], p.area, (v) => { p.area = v; est(); })),
        p.area !== 'todas' ? tarjetaLider(p.area || 'face') : null, p.area !== 'todas' ? h('div', null, h('small', { class: 'tr-sub' }, ui('hablarCon') + ' '), campoDe(p, 'texto', c, { multi: true, ph: 'Cuándo hablar con esta persona (opcional)', opcional: true })) : null);
    case 'modelo3d': case 'visor': case 'calculadora': case 'simulador': case 'tour': {
      const zona = h('div');
      const ajustes = [];
      if (p.t === 'modelo3d' || p.t === 'visor') ajustes.push(h('span', null, 'Espacio del archivo: '), campoSimple(p, 'slot', c, { ph: 'nombre-del-espacio', titulo: 'Minúsculas, números y guiones' }));
      if (p.t === 'visor') ajustes.push(h('span', null, ' Abre en: '), sel([['rx', 'RX'], ['changes', 'Changes']], p.pestana || 'rx', (v) => { p.pestana = v; c(); }));
      if (p.t === 'calculadora') ajustes.push(h('span', null, 'Herramienta: '), sel([['espesor24z', 'Espesor 24Z'], ['tamanos', 'Tamaños de arco'], ['articulador', 'Articulador'], ['tiempos', 'Tiempos de diseño']], p.id, (v) => { p.id = v; c(); }));
      const desc = p.t === 'modelo3d' || p.t === 'visor' ? 'descripcion' : 'guia';
      return caja('', titulo(), campoDe(p, desc, c, { multi: true, ph: p.t === 'modelo3d' || p.t === 'visor' ? 'Qué mirar' : 'Guía (opcional)', opcional: desc === 'guia' }),
        p.t === 'modelo3d' || p.t === 'visor' ? h('div', { class: 'tr-el-nota-sec' }, h('small', null, 'Mensaje mientras no hay archivo:'), campoDe(p, 'pendiente', c, { multi: true, ph: 'Aquí irá…' })) : null,
        ajustes.length ? h('div', { class: 'tr-el-fila' }, ...ajustes) : null,
        p.t === 'simulador' || p.t === 'tour' ? h('p', { class: 'tr-sub' }, 'Los movimientos de este paso se ajustan con el botón { } (JSON) de la barra del paso.') : null,
        h('div', { class: 'tr-el-fila' }, boton('▶ Ver cómo queda', () => { const r = renderPaso(p, {}); ctx.destruir(r.destroy); zona.replaceChildren(r.el); })), zona);
    }
    default:
      return caja('', h('p', { class: 'tr-sub' }, 'Este tipo de paso se edita con el botón { } (JSON).'));
  }
}

function pregunta(q, i, ctx) {
  const c = ctx.cambio, est = ctx.estructura;
  const cambiarTipo = (v) => {
    q.tipo = v;
    if ((v === 'una' || v === 'varias') && !q.opciones) q.opciones = [0, 1, 2].map((n) => ({ texto: T2('Opción ' + (n + 1), 'Option ' + (n + 1)), ok: !n }));
    if (v === 'una' && q.opciones && q.opciones.filter((o) => o.ok).length !== 1) q.opciones.forEach((o, k) => { o.ok = k === 0; });
    if (v === 'varias' && q.opciones.filter((o) => o.ok).length < 2) q.opciones.slice(0, 2).forEach((o) => { o.ok = true; });
    if (v === 'vf' && typeof q.ok !== 'boolean') q.ok = true;
    if (v === 'orden' && !q.items) q.items = [1, 2, 3].map((n) => T2('Paso ' + n, 'Step ' + n));
    if (v === 'parejas' && !q.pares) q.pares = [1, 2, 3].map((n) => ({ a: T2('Concepto ' + n, 'Concept ' + n), b: T2('Pareja ' + n, 'Match ' + n) }));
    est();
  };
  const partes = [h('div', { class: 'tr-el-fila tr-el-preg-cab' }, h('b', null, 'Pregunta ' + (i + 1)), sel([['una', 'Una respuesta correcta'], ['varias', 'Varias correctas'], ['vf', 'Verdadero o falso'], ['orden', 'Ordenar'], ['parejas', 'Unir parejas']], q.tipo, cambiarTipo, { titulo: 'Tipo de pregunta' })),
    campoDe(q, 'enunciado', c, { multi: true, cls: 'tr-preg-txt', ph: 'Escribe la pregunta' })];
  if (q.tipo === 'una' || q.tipo === 'varias') {
    q.opciones = q.opciones || [];
    partes.push(lista(q.opciones, (o) => h('div', { class: 'tr-el-op' + (o.ok ? ' ok' : '') },
      h('button', { type: 'button', class: 'tr-el-marca', title: o.ok ? 'Es correcta' : 'Marcar como correcta', 'aria-pressed': !!o.ok, onclick: (e) => { e.stopPropagation(); if (q.tipo === 'una') q.opciones.forEach((x) => { x.ok = x === o; }); else o.ok = !o.ok; est(); } }, o.ok ? '✓' : ''),
      campoDe(o, 'texto', c, { ph: 'Opción' })), () => ({ texto: T2('Nueva opción', 'New option'), ok: false }), ctx, { agregar: 'Opción', min: 3, max: 5 }));
  } else if (q.tipo === 'vf') {
    partes.push(h('div', { class: 'tr-el-fila' }, 'Respuesta correcta: ', [[true, ui('verdadero')], [false, ui('falso')]].map(([v, rot]) => h('button', { type: 'button', class: 'tr-el-btn' + (q.ok === v ? ' on' : ''), onclick: (e) => { e.stopPropagation(); q.ok = v; est(); } }, (q.ok === v ? '✓ ' : '') + rot))));
  } else if (q.tipo === 'orden') {
    q.items = q.items || [];
    partes.push(h('small', { class: 'tr-sub' }, 'Escríbelos en el orden correcto; a la persona le aparecen mezclados.'),
      lista(q.items, (x, k) => h('div', { class: 'tr-el-punto' }, h('span', { class: 'tr-el-num chico' }, k + 1), campo(() => q.items[k], (v) => { q.items[k] = v || T2(''); }, c, { ph: 'Elemento' })), () => T2('Nuevo elemento', 'New item'), ctx, { agregar: 'Elemento', min: 3, max: 7 }));
  } else if (q.tipo === 'parejas') {
    q.pares = q.pares || [];
    partes.push(lista(q.pares, (pr) => h('div', { class: 'tr-el-par' }, campoDe(pr, 'a', c, { ph: 'Concepto' }), h('span', null, '↔'), campoDe(pr, 'b', c, { ph: 'Pareja' })), () => ({ a: T2('Concepto', 'Concept'), b: T2('Pareja', 'Match') }), ctx, { agregar: 'Pareja', min: 3, max: 6 }));
  }
  partes.push(h('div', { class: 'tr-el-exp' }, h('small', null, 'Explicación (aparece al responder):'), campoDe(q, 'explicacion', c, { multi: true, ph: 'Por qué esa es la respuesta' })));
  return h('div', { class: 'tr-el-preg' }, ...partes);
}

// ---------- Datos de un término del glosario y de una lección, en el lugar ----------
export { campoDe, campoSimple, sel, boton, lista };
