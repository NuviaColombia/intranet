// Training: renderizadores de cada tipo de paso. Cada uno devuelve { el, destroy? }.
import { h, t, ui, md, toast, S, CFG, AREAS, tarjetaLider } from './lib.js';
import { crearQuiz } from './quiz.js';

const tarjetaTitulo = (p) => (p.titulo ? h('h2', { class: 'tr-paso-tit' }, t(p.titulo)) : null);

// Imagen con pie; clic = verla en grande
export function figura(im, extra) {
  const pie = t(im.pie);
  return h('figure', { class: 'tr-fig' + (extra ? ' ' + extra : '') },
    h('button', { type: 'button', class: 'tr-fig-btn', 'aria-label': ui('ampliar'), onclick: () => ampliar(im) }, h('img', { src: im.src, alt: pie || '', loading: 'lazy' }), h('span', { class: 'tr-fig-lupa', 'aria-hidden': 'true' }, '⤢')),
    pie ? h('figcaption', null, md(im.pie, { sinGlosario: true })) : null, im.fuente ? h('small', { class: 'tr-fig-fuente' }, '📄 ' + im.fuente) : null);
}
function ampliar(im) {
  const cerrar = () => { fondo.remove(); document.removeEventListener('keydown', tecla, true); };
  const tecla = (e) => { if (e.key === 'Escape') { e.stopPropagation(); cerrar(); } };
  const fondo = h('div', { class: 'tr-lightbox', role: 'dialog', 'aria-modal': 'true', onclick: (e) => { if (e.target === fondo || e.target.classList.contains('tr-lb-x')) cerrar(); } },
    h('button', { type: 'button', class: 'tr-lb-x', 'aria-label': ui('cerrar') }, '✕'), h('img', { src: im.src, alt: t(im.pie) || '' }), t(im.pie) ? h('div', { class: 'tr-lb-pie' }, t(im.pie)) : null);
  document.addEventListener('keydown', tecla, true);
  document.body.append(fondo);
}

function imagen(p) {
  const ims = p.imagenes || [];
  return { el: h('div', { class: 'tr-paso tr-paso-imagen' }, tarjetaTitulo(p), h('div', { class: 'tr-galeria ' + (p.disposicion || (ims.length > 1 ? 'dos' : 'una')) }, ims.map((im) => figura(im)))) };
}

function texto(p) {
  const cuerpo = md(p.cuerpo, { maxTerminos: 6 });
  const im = p.imagen && p.imagen.src ? figura(p.imagen, 'tr-fig-lado') : null, lado = (p.imagen && p.imagen.lado) || 'der';
  const el = h('div', { class: 'tr-paso tr-paso-texto' }, tarjetaTitulo(p),
    im ? h('div', { class: 'tr-texto-img ' + lado }, im, cuerpo) : cuerpo,
    p.general ? h('span', { class: 'tr-chip-general' }, '🌐 ' + ui('general')) : null);
  const cal = (cls, icono, rotulo, txt) => txt ? h('aside', { class: 'tr-callout ' + cls }, h('div', { class: 'tr-callout-tit' }, h('span', null, icono), rotulo), md(txt, { maxTerminos: 2 })) : null;
  el.append(...[cal('porque', '💡', ui('porque'), p.porque), cal('dato', '📌', ui('dato'), p.dato), cal('alerta', '⚠️', ui('alerta'), p.alerta)].filter(Boolean));
  return { el };
}

function tarjetas(p) {
  const vistas = new Set(), pista = h('div', { class: 'tr-pista' }, ui('tocaVoltear') + ` (0/${p.items.length})`);
  const grid = h('div', { class: 'tr-tarjetas' });
  p.items.forEach((it, i) => {
    const b = h('button', { type: 'button', class: 'tr-tarjeta', 'aria-pressed': 'false', onclick: () => {
      const on = b.classList.toggle('vuelta'); b.setAttribute('aria-pressed', on);
      if (on) { vistas.add(i); pista.textContent = ui('tocaVoltear') + ` (${vistas.size}/${p.items.length})`; if (vistas.size === p.items.length) pista.classList.add('ok'); }
    } },
    h('span', { class: 'tr-tarjeta-in' },
      h('span', { class: 'tr-cara tr-frente' }, h('span', { class: 'tr-tarjeta-ico' }, it.icono || '◆'), h('b', null, t(it.titulo)), h('i', { class: 'tr-girar', 'aria-hidden': 'true' }, '↻')),
      h('span', { class: 'tr-cara tr-dorso' }, h('b', null, t(it.titulo)), md(it.texto, { sinGlosario: true }))));
    grid.append(b);
  });
  return { el: h('div', { class: 'tr-paso' }, tarjetaTitulo(p), pista, grid) };
}

function flujo(p) {
  let actual = 0;
  const nodos = h('div', { class: 'tr-flujo-nodos', role: 'tablist' }), detalle = h('div', { class: 'tr-flujo-det', 'aria-live': 'polite' });
  const pintar = () => {
    nodos.querySelectorAll('.tr-flujo-nodo').forEach((n, i) => { n.classList.toggle('act', i === actual); n.classList.toggle('hecho', i < actual); n.setAttribute('aria-selected', i === actual); });
    const it = p.pasos[actual];
    detalle.replaceChildren(h('div', { class: 'tr-flujo-num' }, `${actual + 1}/${p.pasos.length}`), h('h3', null, t(it.titulo)), md(it.texto, { maxTerminos: 3 }),
      h('div', { class: 'tr-flujo-nav' },
        h('button', { type: 'button', class: 'tr-btn tr-btn-chico', disabled: actual === 0, onclick: () => { actual--; pintar(); } }, '← ' + ui('anterior')),
        h('button', { type: 'button', class: 'tr-btn tr-btn-chico', disabled: actual === p.pasos.length - 1, onclick: () => { actual++; pintar(); } }, ui('siguiente') + ' →')));
  };
  p.pasos.forEach((it, i) => nodos.append(h('button', { type: 'button', role: 'tab', class: 'tr-flujo-nodo', onclick: () => { actual = i; pintar(); }, title: t(it.titulo) }, h('span', { class: 'tr-flujo-punto' }, i + 1), h('span', { class: 'tr-flujo-rot' }, t(it.titulo)))));
  pintar();
  return { el: h('div', { class: 'tr-paso' }, tarjetaTitulo(p), nodos, detalle) };
}

function acordeon(p) {
  const el = h('div', { class: 'tr-paso' }, tarjetaTitulo(p));
  const lista = h('div', { class: 'tr-acordeon' });
  p.items.forEach((it, i) => {
    const cuerpo = h('div', { class: 'tr-acc-cuerpo', hidden: true }, md(it.texto, { maxTerminos: 3 }));
    const b = h('button', { type: 'button', class: 'tr-acc-cab', 'aria-expanded': 'false', onclick: () => {
      const abre = cuerpo.hidden; cuerpo.hidden = !abre; b.setAttribute('aria-expanded', abre); b.parentElement.classList.toggle('abierto', abre);
    } }, h('span', null, t(it.titulo)), h('i', { 'aria-hidden': 'true' }, '＋'));
    lista.append(h('div', { class: 'tr-acc-it' + (i === 0 ? '' : '') }, b, cuerpo));
  });
  el.append(lista);
  return { el };
}

function tabla(p) {
  const tb = h('table', { class: 'tr-tabla' }, h('thead', null, h('tr', null, p.cabeceras.map((c) => h('th', null, t(c))))),
    h('tbody', null, p.filas.map((f) => h('tr', null, f.map((c, j) => h(j === 0 ? 'th' : 'td', { scope: j === 0 ? 'row' : null, 'data-etq': t(p.cabeceras[j]) }, t(c)))))));
  return { el: h('div', { class: 'tr-paso' }, tarjetaTitulo(p), h('div', { class: 'tr-tabla-w' }, tb)) };
}

function checklist(p) {
  const total = p.items.length, cont = h('div', { class: 'tr-check-cont' });
  const lista = h('ul', { class: 'tr-check' });
  const actualizar = () => { const n = lista.querySelectorAll('input:checked').length; cont.textContent = `${n} / ${total}`; cont.classList.toggle('ok', n === total); };
  p.items.forEach((it, i) => lista.append(h('li', null, h('label', null, h('input', { type: 'checkbox', onchange: actualizar }), h('span', { class: 'tr-check-caja' }), h('span', null, md(it, { sinGlosario: true }))))));
  actualizar();
  return { el: h('div', { class: 'tr-paso' }, tarjetaTitulo(p), h('div', { class: 'tr-pista' }, ui('tocaMarcar'), cont), lista) };
}

function resumen(p) {
  return { el: h('div', { class: 'tr-paso' }, h('div', { class: 'tr-resumen' }, h('h2', null, '✨ ' + (p.titulo ? t(p.titulo) : ui('esencial'))),
    h('ul', null, p.puntos.map((x) => h('li', null, h('span', { class: 'tr-ok' }, '✓'), md(x, { sinGlosario: true })))))) };
}

function enlace(p) {
  if (p.lecc) {   // enlace a una lección de la biblioteca de referencia
    return { el: h('div', { class: 'tr-paso' }, h('div', { class: 'tr-enlace' }, h('div', { class: 'tr-enlace-ico' }, '📚'),
      h('div', { class: 'tr-enlace-txt' }, h('h3', null, t(p.titulo)), md(p.texto, { maxTerminos: 2 })),
      h('a', { class: 'tr-btn tr-btn-primario', href: '#/l/' + p.lecc }, ui('abrirLeccion') + ' →'))) };
  }
  const buscar = p.protocolo;
  const url = '/design?panel=protocols&q=' + encodeURIComponent(buscar);
  const copiar = h('button', { type: 'button', class: 'tr-btn tr-btn-chico', onclick: async () => { try { await navigator.clipboard.writeText(buscar); toast(ui('copiado')); } catch (e) { /* sin portapapeles */ } } }, '⧉');
  return { el: h('div', { class: 'tr-paso' }, h('div', { class: 'tr-enlace' }, h('div', { class: 'tr-enlace-ico' }, '📋'),
    h('div', { class: 'tr-enlace-txt' }, h('h3', null, t(p.titulo)), md(p.texto, { maxTerminos: 2 }), h('div', { class: 'tr-enlace-busca' }, ui('buscaEn') + ': ', h('code', null, buscar), copiar)),
    h('a', { class: 'tr-btn tr-btn-primario', href: url, target: '_blank', rel: 'noopener' }, ui('protocoloOficial') + ' ↗'))) };
}

function lider(p) {
  if (p.area === 'todas') return { el: h('div', { class: 'tr-paso' }, h('h2', { class: 'tr-paso-tit' }, '👥 ' + ui('areaManager') + 's'), h('div', { class: 'tr-lideres-grid' }, Object.keys(AREAS).map((a) => tarjetaLider(a)))) };
  return { el: h('div', { class: 'tr-paso tr-paso-lider' }, tarjetaLider(p.area, { texto: p.texto })) };
}

function caso(p) {
  const lista = h('ol', { class: 'tr-caso-linea' }, p.etapas.map((e, i) => h('li', { class: 'tr-caso-et' },
    h('span', { class: 'tr-caso-n' }, i + 1),
    h('div', { class: 'tr-caso-cuerpo' }, h('b', null, t(e.titulo)), md(e.texto, { maxTerminos: 2 }),
      (e.tiempo || e.quien) ? h('div', { class: 'tr-caso-meta' }, e.tiempo ? h('span', { class: 'tr-caso-tiempo' }, '⏱ ' + t(e.tiempo)) : null, e.quien ? h('span', { class: 'tr-caso-quien' }, '👤 ' + t(e.quien)) : null) : null))));
  return { el: h('div', { class: 'tr-paso tr-caso' }, h('span', { class: 'tr-caso-sello' }, '🧪 ' + ui('casoEjemplo')), h('h2', { class: 'tr-paso-tit' }, t(p.titulo)), md(p.contexto, { maxTerminos: 3 }), lista,
    p.resultado ? h('div', { class: 'tr-caso-res' }, h('b', null, '✅ ' + ui('resultado') + ': '), md(p.resultado, { sinGlosario: true })) : null) };
}

function quiz(p, ctx) {
  const q = crearQuiz(p.preguntas, { onFin: (pct) => ctx.onQuiz && ctx.onQuiz(pct) });
  return { el: h('div', { class: 'tr-paso' }, h('h2', { class: 'tr-paso-tit' }, '🧠 ' + ui('quiz')), q) };
}

// Pasos que usan WebGL o widgets: se cargan solo cuando se necesitan
function diferido(carga, ...args) {
  const el = h('div', { class: 'tr-paso tr-diferido' }, h('div', { class: 'tr-cargando-mini' }, h('div', { class: 'tr-spinner' }), ui('cargando')));
  let destruir = null, muerto = false;
  carga().then((fn) => { if (muerto) return; const r = fn(...args); if (!r) return; el.replaceChildren(r.el); destruir = r.destroy; if (r.alMostrar) r.alMostrar(); })
    .catch((e) => { console.error('[training]', e); el.replaceChildren(h('div', { class: 'tr-error' }, ui('errorGenerico'))); });
  return { el, destroy: () => { muerto = true; if (destruir) destruir(); } };
}

export function renderPaso(p, ctx) {
  switch (p.t) {
    case 'texto': return texto(p);
    case 'imagen': return imagen(p);
    case 'tarjetas': return tarjetas(p);
    case 'flujo': return flujo(p);
    case 'acordeon': return acordeon(p);
    case 'tabla': return tabla(p);
    case 'checklist': return checklist(p);
    case 'resumen': return resumen(p);
    case 'enlace': return enlace(p);
    case 'quiz': return quiz(p, ctx);
    case 'lider': return lider(p);
    case 'caso': return caso(p);
    case 'visor': return diferido(() => import('./sim.js').then((m) => m.crearVisorPaso), p);
    case 'calculadora': return diferido(() => import('./widgets.js').then((m) => m.crearWidget), p);
    case 'simulador': return diferido(() => import('./sim.js').then((m) => m.crearSimuladorPaso), p);
    case 'tour': return diferido(() => import('./sim.js').then((m) => m.crearTourPaso), p);
    case 'modelo3d': return diferido(() => import('./sim.js').then((m) => m.crearModeloPaso), p);
    default: return { el: h('div', { class: 'tr-paso' }, h('p', null, 'Paso no reconocido: ' + p.t)) };
  }
}
