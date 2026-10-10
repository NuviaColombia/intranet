// Training: calculadoras y widgets interactivos (sin 3D): espesores de la garantía 24-Z, tamaños de arco, articulador y tiempos.
import { h, t, ui, md } from './lib.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs, ...hijos) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs || {}) e.setAttribute(k, attrs[k]);
  for (const c of hijos.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
};
const TAM = ['A', 'AW', 'B', 'BW', 'C', 'CW'];
const COLOR = ['#e6d3a8', '#e8777b', '#6fc58a', '#a98bf0', '#f0a3c4', '#6aa4f5'];
const cabecera = (p) => [p.titulo ? h('h2', { class: 'tr-paso-tit' }, '🧮 ' + t(p.titulo)) : null, p.guia ? h('div', { class: 'tr-sim-guia' }, md(p.guia, { maxTerminos: 2 })) : null];

// ---------- Garantía 24-Z: espesores mínimos ----------
function espesor24z(p) {
  let sel = 0;
  const reglas = (i) => (i >= 4 ? { post: 12, ant: 14 } : { post: 10, ant: 12 });
  const filas = [
    { k: 'post', rot: 'posteriores', tipo: 'min' }, { k: 'ant', rot: 'anteriores', tipo: 'min' },
    { k: 'can', rot: 'cantilever', tipo: 'max', v: 15 }, { k: 'blp', rot: 'bucalLingPost', tipo: 'min', v: 10 }, { k: 'bla', rot: 'bucalLingAnt', tipo: 'min', v: 8 }];
  const chips = h('div', { class: 'tr-seg tr-seg-tam', role: 'group', 'aria-label': ui('tamArco') }, TAM.map((n, i) => h('button', { type: 'button', class: 'tr-seg-b' + (i === 0 ? ' on' : ''), style: { '--c': COLOR[i] }, onclick: () => { sel = i; pintar(); } }, n)));
  const tabla = h('div', { class: 'tr-medidas' }), resultado = h('div', { class: 'tr-medidas-res', 'aria-live': 'polite' });
  const entradas = {};
  const pintar = () => {
    chips.querySelectorAll('.tr-seg-b').forEach((b, i) => b.classList.toggle('on', i === sel));
    const r = reglas(sel); let ok = 0, medidas = 0;
    tabla.replaceChildren(...filas.map((f) => {
      const lim = f.v ?? r[f.k];
      const inp = entradas[f.k] || (entradas[f.k] = h('input', { type: 'number', step: '0.1', min: '0', inputmode: 'decimal', 'aria-label': ui(f.rot), oninput: pintar }));
      const v = parseFloat(inp.value), tiene = !isNaN(v), cumple = tiene && (f.tipo === 'min' ? v >= lim : v <= lim);
      if (tiene) { medidas++; if (cumple) ok++; }
      return h('div', { class: 'tr-med-fila' + (tiene ? (cumple ? ' ok' : ' mal') : '') },
        h('div', { class: 'tr-med-nom' }, ui(f.rot), h('small', null, `${f.tipo === 'min' ? ui('minimo') : ui('maximo')}: ${lim} mm`)), inp,
        h('div', { class: 'tr-med-est' }, tiene ? (cumple ? '✓ ' + ui('cumple') : '✕ ' + ui('noCumple')) : '—'));
    }));
    resultado.className = 'tr-medidas-res' + (medidas && ok === medidas ? ' ok' : (medidas ? ' mal' : ''));
    resultado.textContent = medidas ? `${ok} / ${medidas} ${ui('cumple').toLowerCase()}` : '';
  };
  pintar();
  return { el: h('div', { class: 'tr-sim tr-calc' }, cabecera(p), h('div', { class: 'tr-calc-sub' }, ui('espesorTitulo')), h('div', { class: 'tr-sim-barra' }, h('b', null, ui('tamArco') + ':'), chips), tabla, resultado) };
}

// ---------- Explorador de tamaños de arco ----------
function curvaArco(escala, ancho, cx, cy, k = 0.0455) {
  // devuelve 14 dientes como [x, y, ang, w, grosor] en coordenadas SVG (vista oclusal, incisivos arriba)
  const W = [8.5, 6.5, 7.5, 7, 7, 10, 9.5].map((x) => x * 0.93), G = [7, 6.2, 8, 9, 9, 10.5, 10];
  const dientes = []; let s = 0, x = 0, suma = 0;
  W.forEach((w, i) => {
    const obj = suma + w / 2; suma += w;
    while (s < obj) { const dx = 0.05; s += Math.hypot(dx, 2 * k * x * dx); x += dx; }
    for (const lado of [1, -1]) {
      const xx = x * lado * (1 + (ancho - 54) / 54 * 0.0), z = 24 - k * x * x, ang = Math.atan(-2 * k * x * lado);
      dientes.push({ x: cx + xx * escala * 2.1 * (1 + ancho / 54), y: cy - z * escala * 2.1, ang: -ang, w: w * escala * 2.1, g: G[i] * 0.8 * escala * 2.1 });
    }
  });
  return dientes;
}
function dibujarArco(i, fantasma) {
  const fam = Math.floor(i / 2), ancha = i % 2, escala = Math.pow(1.1, fam), ancho = ancha * 4.5;
  const g = svg('g', { opacity: fantasma ? 0.35 : 1 });
  curvaArco(escala, ancho, 160, 175).forEach((d) => g.append(svg('rect', { x: -d.w / 2, y: -d.g / 2, width: d.w, height: d.g, rx: Math.min(d.w, d.g) / 2.4, transform: `translate(${d.x} ${d.y}) rotate(${(d.ang * 180) / Math.PI})`,
    fill: fantasma ? 'none' : COLOR[i], stroke: fantasma ? '#64748b' : '#475569', 'stroke-width': fantasma ? 1.2 : 1, 'stroke-dasharray': fantasma ? '4 3' : '' })));
  return g;
}
function tamanos(p) {
  let a = 0, b = 1;
  const sa = h('select', { 'aria-label': ui('cmpA'), onchange: () => { a = +sa.value; pintar(); } }, TAM.map((n, i) => h('option', { value: i }, n))),
    sb = h('select', { 'aria-label': ui('con'), onchange: () => { b = +sb.value; pintar(); } }, TAM.map((n, i) => h('option', { value: i, selected: i === 1 }, n)));
  const lienzo = svg('svg', { viewBox: '0 0 320 210', class: 'tr-svg-arco', role: 'img', 'aria-label': ui('tamArco') }), nota = h('div', { class: 'tr-tam-nota' });
  const chips = h('div', { class: 'tr-seg tr-seg-tam' }, TAM.map((n, i) => h('button', { type: 'button', class: 'tr-seg-b', style: { '--c': COLOR[i] }, onclick: () => { b = i; if (a === b) a = Math.max(0, i - 1); sa.value = a; sb.value = b; pintar(); } }, n)));
  const pintar = () => {
    chips.querySelectorAll('.tr-seg-b').forEach((x, i) => x.classList.toggle('on', i === b));
    lienzo.replaceChildren(svg('line', { x1: 160, y1: 10, x2: 160, y2: 200, stroke: '#cbd5e1', 'stroke-dasharray': '3 4' }), dibujarArco(a, true), dibujarArco(b, false),
      svg('text', { x: 8, y: 20, fill: '#64748b', 'font-size': 11 }, ui('fantasma') + ': ' + TAM[a]), svg('text', { x: 8, y: 36, fill: '#0f172a', 'font-size': 12, 'font-weight': 700 }, TAM[b]));
    const fa = Math.floor(a / 2), fb = Math.floor(b / 2), wa = a % 2, wb = b % 2, lineas = [];
    if (a === b) lineas.push(ui('sinCambios'));
    if (fb !== fa) lineas.push(`${fb > fa ? '▲' : '▼'} ${Math.abs(fb - fa) === 1 ? ui('mas10') : '≈' + Math.round((Math.pow(1.1, Math.abs(fb - fa)) - 1) * 100) + '%'}`);
    if (wb !== wa) lineas.push(`${wb > wa ? '↔ +' : '↔ −'}${ui('masAncho')}`);
    if (fb === fa && wb !== wa) lineas.push(ui('iguales'));
    nota.replaceChildren(h('b', null, `${TAM[a]} → ${TAM[b]}`), ...lineas.map((l) => h('div', null, l)));
  };
  pintar();
  return { el: h('div', { class: 'tr-sim tr-calc' }, cabecera(p), h('div', { class: 'tr-sim-barra' }, chips), h('div', { class: 'tr-tam-cuerpo' }, h('div', { class: 'tr-svg-w' }, lienzo),
    h('div', null, h('div', { class: 'tr-opts' }, ui('cmpA') + ' ', sa, ' ' + ui('con') + ' ', sb), nota))) };
}

// ---------- Articulador: el pin y el VDO ----------
function articulador(p) {
  let mm = 0;
  const lienzo = svg('svg', { viewBox: '0 0 420 240', class: 'tr-svg-art', role: 'img' }), lectura = h('output', { class: 'tr-art-lectura' });
  const dibujar = () => {
    const L = 270, ang = (mm / 100) * 0.9, hx = 70, hy = 110;   // eje de bisagra y ángulo del miembro inferior (exagerado para verse)
    const baja = (x) => hy + 34 + Math.sin(ang) * (x - hx);
    lienzo.replaceChildren(
      svg('rect', { x: 20, y: 20, width: 380, height: 18, rx: 6, fill: '#94a3b8' }),                                        // brazo superior fijo
      svg('rect', { x: hx - 12, y: 20, width: 24, height: hy - 8, rx: 6, fill: '#64748b' }),                                // columna
      svg('circle', { cx: hx, cy: hy, r: 9, fill: '#fbbf24', stroke: '#92400e', 'stroke-width': 2 }),                       // eje (bisagra)
      svg('rect', { x: 250, y: 38, width: 86, height: 34, rx: 8, fill: '#e2e8f0', stroke: '#64748b' }),                     // modelo superior
      svg('text', { x: 293, y: 59, 'text-anchor': 'middle', 'font-size': 11, fill: '#334155' }, t({ es: 'Modelo superior', en: 'Upper cast' })),
      svg('g', { transform: `rotate(${(ang * 180) / Math.PI} ${hx} ${hy + 34})` },
        svg('rect', { x: hx - 6, y: hy + 28, width: L + 120, height: 12, rx: 5, fill: '#94a3b8' }),                           // miembro inferior
        svg('rect', { x: 250, y: hy - 4, width: 86, height: 32, rx: 8, fill: '#cbd5e1', stroke: '#64748b' }),               // modelo inferior
        svg('text', { x: 293, y: hy + 17, 'text-anchor': 'middle', 'font-size': 11, fill: '#334155' }, t({ es: 'Modelo inferior', en: 'Lower cast' }))),
      svg('line', { x1: 392, y1: 38, x2: 392, y2: baja(392) - 0, stroke: '#ef4444', 'stroke-width': 4, 'stroke-linecap': 'round' }),   // pin incisal
      svg('text', { x: 360, y: 24, fill: '#b91c1c', 'font-size': 11, 'font-weight': 700 }, 'Pin'),
      svg('text', { x: hx + 14, y: hy - 12, fill: '#92400e', 'font-size': 11 }, t({ es: 'Eje de bisagra', en: 'Hinge axis' })));
    lectura.textContent = `VDO ${mm > 0 ? '+' : ''}${String(mm).replace(/\.0$/, '')} mm`;
  };
  const r = h('input', { type: 'range', min: -5, max: 5, step: 0.5, value: 0, 'aria-label': 'Pin', oninput: (e) => { mm = parseFloat(e.target.value); dibujar(); } });
  dibujar();
  return { el: h('div', { class: 'tr-sim tr-calc' }, cabecera(p), h('div', { class: 'tr-art' }, h('div', { class: 'tr-svg-w' }, lienzo), h('div', { class: 'tr-art-ctl' },
    h('label', null, t({ es: 'Altura del pin (mm)', en: 'Pin height (mm)' }), r), lectura,
    h('div', { class: 'tr-sub' }, t({ es: 'Al subir o bajar el pin, el modelo inferior gira alrededor del eje de bisagra y cambia la distancia vertical entre los modelos (VDO). Después se escanean los modelos ya en esa relación, por eso el VDO no se cambia solo en digital.', en: 'When the pin goes up or down, the lower cast rotates around the hinge axis and the vertical distance between the casts (VDO) changes. The casts are then scanned in that relationship, which is why VDO is not changed on screen alone.' }))))) };
}

// ---------- Tiempos de diseño por producto (hoja de tiempos) ----------
const TIEMPOS = [
  ['Face', 'Face Align', null, null, 15, '', 0], ['Face', 'Face Design', null, null, 45, '', 0],
  ['N2', 'Travel UL', 90, 20, 110, 'Bite + Demo', 0], ['N2', 'Regular case UL', 90, 20, 110, 'Bite + Demo', 0], ['N2', 'Traveling Single', 105, 15, 120, 'Bite + Demo', 0],
  ['N2', 'Regular case Single', 105, 15, 120, 'Bite + Demo', 0], ['N2', 'Single 24z', 120, 15, 135, 'Bite + Demo + Barra', 0], ['N2', 'Single G-cam', 105, 15, 120, 'Bite + Demo', 0], ['N2', 'Demo UL', 80, 20, 100, 'Bite + Demo', 0],
  ['N3', 'N2 - TC Design', 30, null, 30, 'Bite + TC', 0], ['N3', 'NG (Nightguard)', 45, null, 45, 'Bite + NG + Medidas', 0], ['N3', 'Full Mouth 24z', 90, 10, 100, 'Bite + I-cam + Barra + Guía', 0],
  ['N3', 'Removable denture / G-cam', 90, 10, 100, 'Bite + I-cam + Barra + Guía + Remov', 0], ['N3', 'Single 24z', 80, null, 80, 'Bite + I-cam + Barra + Guía', 0],
  ['N3', 'Single G-cam / Ti bar', 120, 30, 150, 'Bite + I-cam + Barra + Guía + TC', 0], ['N3', 'Single Rev denture', 60, 30, 90, 'Bite + Remov + TC', 0],
  ['N6', 'Zn over Ti bar - Single', 50, 90, 150, 'Bite + Guide Col', 1], ['N6', 'Zn over Ti bar - Both', 60, 120, 180, 'Bite + Guide Col', 0],
  ['N6', 'Zn composite - Single copy', 60, 70, 130, 'Bite + Guide Col', 0], ['N6', 'Zn composite - Single new morphology', 90, 60, 150, 'Bite + Guide Col + Guide USA', 0],
  ['N6', 'Zn composite - Both copy', 90, 110, 200, 'Bite + Guide Col', 0], ['N6', 'Zn composite - Both new morphology', 90, 70, 160, 'Bite + Guide Col + Guide USA', 0],
  ['N6', 'Dummy - Single', null, null, 90, 'Bite + Dummy + Guía', 0], ['N6', 'Dummy - Both', null, null, 90, 'Bite + Dummy + Guía', 0],
  ['N6', 'TC design - Single', null, 45, 45, 'Barra + TC', 0], ['N6', 'TC design - Both', null, 90, 90, 'Barra + TC', 0], ['N6', 'N6 Nightguard', null, 45, 45, 'NG final + Medidas', 1]];
const hm = (m) => (m == null ? '—' : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} h`);

function tiempos(p) {
  let grupo = 'N2'; const cant = {}; let jornada = 8;
  const tabs = h('div', { class: 'tr-seg tr-seg-vistas', role: 'tablist' }, ['Face', 'N2', 'N3', 'N6'].map((g) => h('button', { type: 'button', class: 'tr-seg-b' + (g === grupo ? ' on' : ''), onclick: () => { grupo = g; pintar(); } }, g)));
  const cuerpo = h('div', { class: 'tr-tiempos' }), plan = h('div', { class: 'tr-plan' });
  const inJ = h('input', { type: 'number', min: 1, max: 24, step: 0.5, value: jornada, 'aria-label': t({ es: 'Horas de la jornada', en: 'Shift hours' }), oninput: (e) => { jornada = parseFloat(e.target.value) || 8; pintarPlan(); } });
  function pintarPlan() {
    const items = TIEMPOS.filter((f) => cant[f[0] + f[1]]), total = items.reduce((a, f) => a + f[4] * cant[f[0] + f[1]], 0), pct = Math.min(100, Math.round(total / (jornada * 60) * 100));
    plan.replaceChildren(h('h3', null, '⏱ ' + t({ es: 'Planifica un turno', en: 'Plan a shift' })), h('div', { class: 'tr-opts' }, t({ es: 'Horas del turno', en: 'Shift hours' }) + ': ', inJ),
      h('div', { class: 'tr-plan-tot' + (total > jornada * 60 ? ' mal' : '') }, hm(total), h('span', null, ` / ${jornada} h`)), h('div', { class: 'tr-barra' }, h('i', { style: { width: pct + '%' } })),
      items.length ? h('ul', { class: 'tr-plan-lista' }, items.map((f) => h('li', null, `${cant[f[0] + f[1]]} × ${f[0]} · ${f[1]} = ${hm(f[4] * cant[f[0] + f[1]])}`))) : h('div', { class: 'tr-sub' }, t({ es: 'Agrega productos con + para ver cuántos caben en el turno.', en: 'Add products with + to see how many fit in the shift.' })));
  }
  function pintar() {
    tabs.querySelectorAll('.tr-seg-b').forEach((b) => b.classList.toggle('on', b.textContent === grupo));
    const filas = TIEMPOS.filter((f) => f[0] === grupo);
    cuerpo.replaceChildren(h('div', { class: 'tr-tabla-w' }, h('table', { class: 'tr-tabla' },
      h('thead', null, h('tr', null, [t({ es: 'Producto', en: 'Product' }), t({ es: 'Diseño', en: 'Design' }), t({ es: 'Extra', en: 'Extra' }), 'Total', t({ es: 'Resultado', en: 'Output' }), ''].map((x) => h('th', null, x)))),
      h('tbody', null, filas.map((f) => { const key = f[0] + f[1]; return h('tr', null, h('th', { scope: 'row' }, f[1], f[6] ? h('span', { class: 'tr-dudoso', title: ui('confirmar') }, ' ⚠') : null), h('td', null, hm(f[2])), h('td', null, hm(f[3])), h('td', null, h('b', null, hm(f[4]))), h('td', null, f[5] || '—'),
        h('td', { class: 'tr-mas' }, h('button', { type: 'button', 'aria-label': '−', onclick: () => { cant[key] = Math.max(0, (cant[key] || 0) - 1); pintar(); } }, '−'), h('span', null, cant[key] || 0), h('button', { type: 'button', 'aria-label': '+', onclick: () => { cant[key] = (cant[key] || 0) + 1; pintar(); } }, '+'))); })))));
    pintarPlan();
  }
  pintar();
  return { el: h('div', { class: 'tr-sim tr-calc' }, cabecera(p), h('div', { class: 'tr-sim-barra' }, tabs), cuerpo, plan,
    h('div', { class: 'tr-sub' }, t({ es: 'Tiempos de referencia de la hoja de tiempos de diseño (horas de trabajo, no plazos de entrega). Las filas con ⚠ están por confirmar con el manager.', en: 'Reference times from the design-times sheet (working hours, not delivery deadlines). Rows marked ⚠ are pending confirmation with the manager.' }))) };
}

export function crearWidget(p) {
  switch (p.id) {
    case 'espesor24z': return espesor24z(p);
    case 'tamanos': return tamanos(p);
    case 'articulador': return articulador(p);
    case 'tiempos': return tiempos(p);
    default: return { el: h('div', { class: 'tr-paso' }, 'Widget desconocido: ' + p.id) };
  }
}
