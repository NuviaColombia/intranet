// Training: renderizadores de cada tipo de paso. Cada uno devuelve { el, destroy? }.
import { h, t, ui, md, toast, S, CFG, AREAS, tarjetaLider, T, ED } from './lib.js';
import { crearQuiz } from './quiz.js';

const tarjetaTitulo = (p) => (p.titulo ? T('h2', { class: 'tr-paso-tit' }, p.titulo) : null);

// Imagen con pie; clic = verla en grande. En modo edición (ED.activo) lleva sus controles: reemplazar, quitar, agregar pie,
// y se arrastra para cambiarla de lugar (dentro de la galería o a otra galería).
let arrastreImg = null;   // { lista, i } de la imagen que se está arrastrando
export function figura(im, extra, ctl) {
  const pie = t(im.pie), ed = ED.activo && ctl;
  let colocando = null;   // 'ok' | 'mal' mientras se elige dónde poner un sticker
  const poner = (tipo, cx, cy) => {
    const r = marco.getBoundingClientRect(), x = ((cx - r.left) / r.width) * 100, y = ((cy - r.top) / r.height) * 100;
    if (x < 0 || x > 100 || y < 0 || y > 100) return false;   // fuera de la foto
    (im.marcas = im.marcas || []).push({ t: tipo, x: +x.toFixed(1), y: +y.toFixed(1) });
    toast(tipo === 'mal' ? '✗ Sticker de "incorrecto" agregado' : '✓ Sticker de "correcto" agregado', 'ok');
    ED.estructura && ED.estructura();
    return true;
  };
  const btn = h('button', { type: 'button', class: 'tr-fig-btn', 'aria-label': ui('ampliar'), onclick: (e) => {
    if (colocando) { if (poner(colocando, e.clientX, e.clientY)) colocando = null; return; }
    ampliar(im);
  } });
  // el marco mide lo mismo que la foto: las marcas quedan en el mismo punto en cualquier tamaño
  const marco = h('span', { class: 'tr-fig-marco' }, h('img', { src: im.src, alt: pie || '', loading: 'lazy' }), capaMarcas(im, !!ed));
  btn.append(marco, h('span', { class: 'tr-fig-lupa', 'aria-hidden': 'true' }, '⤢'));
  const fig = h('figure', { class: 'tr-fig' + (extra ? ' ' + extra : '') + (ed ? ' tr-fig-ed' : '') }, btn,
    pie || (ed && im.pie) ? h('figcaption', null, md(im.pie, { sinGlosario: true })) : null, im.fuente ? h('small', { class: 'tr-fig-fuente' }, '📄 ' + im.fuente) : null);
  if (!ed) return fig;
  const cambio = () => ED.estructura && ED.estructura();
  fig.prepend(h('div', { class: 'tr-fig-herr' },
    ctl.lista ? h('span', { class: 'tr-fig-asa', title: 'Arrastra para mover la imagen' }, '⠿') : null,
    h('button', { type: 'button', title: 'Reemplazar imagen', onclick: async () => { const l = await ED.imagenes(false); if (l && l[0]) { im.src = l[0].src; if (l[0].pie && !im.pie) im.pie = l[0].pie; if (l[0].fuente) im.fuente = l[0].fuente; cambio(); } } }, '🔄 Reemplazar'),
    !im.pie ? h('button', { type: 'button', title: 'Agregar pie de imagen', onclick: () => { im.pie = { es: 'Escribe aquí qué mirar en la imagen.', en: 'Write here what to look at in the image.' }; cambio(); } }, '＋ Pie') : null,
    ctl.lado ? h('button', { type: 'button', title: 'Cambiar la posición de la imagen', onclick: ctl.lado }, '⇄ Posición') : null,
    ctl.quitar ? h('button', { type: 'button', class: 'peligro', title: 'Quitar imagen', onclick: () => { if (confirm('¿Quitar esta imagen?')) ctl.quitar(); } }, '✕') : null));
  // stickers: se arrastran desde la bandeja y se sueltan sobre la foto (o se tocan y luego se hace clic en la foto)
  const sticker = (tipo) => {
    const st = h('button', { type: 'button', class: 'tr-sticker ' + tipo, draggable: 'true',
      title: tipo === 'mal' ? 'Arrastra esta ✗ roja (incorrecto) a la foto' : 'Arrastra este ✓ verde (correcto) a la foto',
      onclick: (e) => { e.stopPropagation(); colocando = tipo; fig.classList.add('colocando'); toast('Ahora haz clic en el punto de la foto donde va'); } }, tipo === 'mal' ? '✗' : '✓');
    st.addEventListener('dragstart', (e) => { e.stopPropagation(); e.dataTransfer.setData('text/x-sticker', tipo); e.dataTransfer.effectAllowed = 'copy'; fig.classList.add('soltando'); });
    st.addEventListener('dragend', () => fig.classList.remove('soltando'));
    return st;
  };
  btn.after(h('div', { class: 'tr-stickers' }, h('span', null, 'Stickers:'), sticker('ok'), sticker('mal'), h('small', null, 'arrástralos a la foto o tócalos y haz clic en la foto')));
  marco.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('text/x-sticker')) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; } });
  marco.addEventListener('drop', (e) => {
    const tipo = e.dataTransfer.getData('text/x-sticker'); if (!tipo) return;
    e.preventDefault(); e.stopPropagation(); fig.classList.remove('soltando');
    poner(tipo === 'mal' ? 'mal' : 'ok', e.clientX, e.clientY);
  });
  if (ctl.lista) {
    // la imagen se arrastra solo desde su manija ⠿ (así arrastrar sobre la foto mueve los stickers, no la imagen)
    const asa = fig.querySelector('.tr-fig-asa');
    if (asa) { asa.addEventListener('mousedown', () => { fig.draggable = true; }); asa.addEventListener('mouseup', () => { fig.draggable = false; }); }
    fig.addEventListener('dragstart', (e) => { arrastreImg = { lista: ctl.lista, i: ctl.i }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'img'); fig.classList.add('arrastrando'); e.stopPropagation(); });
    fig.addEventListener('dragend', () => { fig.draggable = false; fig.classList.remove('arrastrando'); arrastreImg = null; });
    fig.addEventListener('dragover', (e) => { if (!arrastreImg) return; e.preventDefault(); e.stopPropagation(); fig.classList.add('sobre'); });
    fig.addEventListener('dragleave', () => fig.classList.remove('sobre'));
    fig.addEventListener('drop', (e) => {
      if (!arrastreImg) return; e.preventDefault(); e.stopPropagation(); fig.classList.remove('sobre');
      const { lista, i } = arrastreImg; arrastreImg = null;
      if (lista === ctl.lista && i === ctl.i) return;
      const x = lista.splice(i, 1)[0];
      ctl.lista.splice(ctl.i, 0, x);   // queda en el lugar de la imagen sobre la que se soltó
      cambio();
    });
  }
  return fig;
}
// Marcas ✓ (correcto) y ✗ (incorrecto) sobre una foto, en % de su tamaño. En edición: arrastrar para mover, clic para cambiar
// entre ✓ y ✗, botón ✕ para quitar.
function capaMarcas(im, editar) {
  const marcas = im.marcas || [];
  if (!marcas.length) return null;
  const capa = h('span', { class: 'tr-chulos' + (editar ? ' editando' : ''), 'aria-hidden': editar ? null : 'true' });
  marcas.forEach((m, i) => {
    const tam = (d) => { m.s = +Math.max(0.5, Math.min(2.5, (m.s || 1) + d)).toFixed(2); if (m.s === 1) delete m.s; el.style.setProperty('--s', m.s || 1); };
    const el = h('span', { class: 'tr-chulo ' + (m.t === 'mal' ? 'mal' : 'ok'), style: { left: m.x + '%', top: m.y + '%', '--s': m.s || 1 }, title: editar ? 'Arrastra para mover · clic para cambiar ✓/✗ · rueda del mouse o − + para el tamaño' : (m.t === 'mal' ? 'Incorrecto' : 'Correcto') },
      m.t === 'mal' ? '✗' : '✓',
      editar ? h('span', { class: 'tr-chulo-x', title: 'Quitar sticker', onclick: (e) => { e.stopPropagation(); e.preventDefault(); marcas.splice(i, 1); if (!marcas.length) delete im.marcas; ED.estructura && ED.estructura(); } }, '×') : null,
      editar ? h('span', { class: 'tr-chulo-tam' },
        h('span', { class: 'tr-chulo-tb', title: 'Más pequeño', onclick: (e) => { e.stopPropagation(); e.preventDefault(); tam(-0.25); ED.estructura && ED.estructura(); } }, '−'),
        h('span', { class: 'tr-chulo-tb', title: 'Más grande', onclick: (e) => { e.stopPropagation(); e.preventDefault(); tam(0.25); ED.estructura && ED.estructura(); } }, '+')) : null);
    if (editar) {
      let tRueda = null;
      el.addEventListener('wheel', (e) => { e.preventDefault(); e.stopPropagation(); tam(e.deltaY < 0 ? 0.1 : -0.1); clearTimeout(tRueda); tRueda = setTimeout(() => ED.estructura && ED.estructura(), 500); }, { passive: false });
    }
    if (editar) {
      el.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); });
      el.addEventListener('pointerdown', (e) => {
        if (e.target.classList.contains('tr-chulo-x') || e.target.classList.contains('tr-chulo-tb')) return;
        e.preventDefault(); e.stopPropagation();
        const r = capa.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY; let movio = false;
        el.setPointerCapture(e.pointerId);
        const mover = (ev) => {
          if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) > 3) movio = true;
          m.x = +Math.max(0, Math.min(100, ((ev.clientX - r.left) / r.width) * 100)).toFixed(1);
          m.y = +Math.max(0, Math.min(100, ((ev.clientY - r.top) / r.height) * 100)).toFixed(1);
          el.style.left = m.x + '%'; el.style.top = m.y + '%';
        };
        const soltar = () => {
          el.removeEventListener('pointermove', mover); el.removeEventListener('pointerup', soltar);
          if (!movio) m.t = m.t === 'mal' ? 'ok' : 'mal';
          ED.estructura && ED.estructura();
        };
        el.addEventListener('pointermove', mover); el.addEventListener('pointerup', soltar);
      });
    }
    capa.append(el);
  });
  return capa;
}
function ampliar(im) {
  const cerrar = () => { fondo.remove(); document.removeEventListener('keydown', tecla, true); };
  const tecla = (e) => { if (e.key === 'Escape') { e.stopPropagation(); cerrar(); } };
  const fondo = h('div', { class: 'tr-lightbox', role: 'dialog', 'aria-modal': 'true', onclick: (e) => { if (e.target === fondo || e.target.classList.contains('tr-lb-x')) cerrar(); } },
    h('button', { type: 'button', class: 'tr-lb-x', 'aria-label': ui('cerrar') }, '✕'), h('span', { class: 'tr-lb-img' }, h('img', { src: im.src, alt: t(im.pie) || '' }), capaMarcas(im, false)), t(im.pie) ? h('div', { class: 'tr-lb-pie' }, t(im.pie)) : null);
  document.addEventListener('keydown', tecla, true);
  document.body.append(fondo);
}

function imagen(p) {
  const ims = p.imagenes || (p.imagenes = []);
  const cambio = () => ED.estructura && ED.estructura();
  const disp = p.disposicion || (ims.length > 1 ? 'dos' : 'una');
  const gal = h('div', { class: 'tr-galeria ' + disp }, ims.map((im, i) => figura(im, '', { lista: ims, i, quitar: () => { ims.splice(i, 1); cambio(); } })));
  if (ED.activo) {
    if (ims.length < 6) gal.append(h('button', { type: 'button', class: 'tr-fig-mas', onclick: async () => { const l = await ED.imagenes(true); if (l && l.length) { ims.push(...l.slice(0, 6 - ims.length)); cambio(); } },
      ondragover: (e) => { if (arrastreImg) e.preventDefault(); }, ondrop: (e) => { if (!arrastreImg) return; e.preventDefault(); const x = arrastreImg.lista.splice(arrastreImg.i, 1)[0]; arrastreImg = null; ims.push(x); cambio(); } }, '＋ Agregar imagen'));
    return { el: h('div', { class: 'tr-paso tr-paso-imagen' }, tarjetaTitulo(p) || h('div', { class: 'tr-ed-sin' }, h('button', { type: 'button', class: 'tr-btn tr-btn-chico', onclick: () => { p.titulo = { es: 'Título', en: 'Title' }; cambio(); } }, '＋ Título')),
      h('div', { class: 'tr-ed-disp' }, 'Imágenes por fila: ', ['una', 'dos', 'tres'].map((d, k) => h('button', { type: 'button', class: disp === d ? 'on' : '', onclick: () => { p.disposicion = d; cambio(); } }, String(k + 1)))), gal) };
  }
  return { el: h('div', { class: 'tr-paso tr-paso-imagen' }, tarjetaTitulo(p), gal) };
}

function texto(p) {
  const cuerpo = md(p.cuerpo, { maxTerminos: 6 });
  const cambio = () => ED.estructura && ED.estructura();
  const LADOS = ['der', 'izq', 'arriba', 'abajo'];
  const im = p.imagen && p.imagen.src ? figura(p.imagen, 'tr-fig-lado', { quitar: () => { delete p.imagen; cambio(); },
    lado: () => { p.imagen.lado = LADOS[(LADOS.indexOf(p.imagen.lado || 'der') + 1) % LADOS.length]; cambio(); } }) : null, lado = (p.imagen && p.imagen.lado) || 'der';
  const el = h('div', { class: 'tr-paso tr-paso-texto' }, tarjetaTitulo(p),
    im ? h('div', { class: 'tr-texto-img ' + lado }, im, cuerpo) : cuerpo,
    p.general ? h('span', { class: 'tr-chip-general' }, '🌐 ' + ui('general')) : null,
    ED.activo && !im ? h('button', { type: 'button', class: 'tr-btn tr-btn-chico tr-ed-solo', onclick: async () => { const l = await ED.imagenes(false); if (l && l[0]) { p.imagen = { ...l[0], lado: 'der' }; cambio(); } } }, '🖼 Agregar imagen al lado del texto') : null);
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
      h('span', { class: 'tr-cara tr-frente' }, h('span', { class: 'tr-tarjeta-ico' }, it.icono || '◆'), T('b', null, it.titulo), h('i', { class: 'tr-girar', 'aria-hidden': 'true' }, '↻')),
      h('span', { class: 'tr-cara tr-dorso' }, T('b', null, it.titulo), md(it.texto, { sinGlosario: true }))));
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
    detalle.replaceChildren(h('div', { class: 'tr-flujo-num' }, `${actual + 1}/${p.pasos.length}`), T('h3', null, it.titulo), md(it.texto, { maxTerminos: 3 }),
      h('div', { class: 'tr-flujo-nav' },
        h('button', { type: 'button', class: 'tr-btn tr-btn-chico', disabled: actual === 0, onclick: () => { actual--; pintar(); } }, '← ' + ui('anterior')),
        h('button', { type: 'button', class: 'tr-btn tr-btn-chico', disabled: actual === p.pasos.length - 1, onclick: () => { actual++; pintar(); } }, ui('siguiente') + ' →')));
  };
  p.pasos.forEach((it, i) => nodos.append(h('button', { type: 'button', role: 'tab', class: 'tr-flujo-nodo', onclick: () => { actual = i; pintar(); }, title: t(it.titulo) }, h('span', { class: 'tr-flujo-punto' }, i + 1), T('span', { class: 'tr-flujo-rot' }, it.titulo))));
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
    } }, T('span', null, it.titulo), h('i', { 'aria-hidden': 'true' }, '＋'));
    lista.append(h('div', { class: 'tr-acc-it' + (i === 0 ? '' : '') }, b, cuerpo));
  });
  el.append(lista);
  return { el };
}

function tabla(p) {
  const tb = h('table', { class: 'tr-tabla' }, h('thead', null, h('tr', null, p.cabeceras.map((c) => T('th', null, c)))),
    h('tbody', null, p.filas.map((f) => h('tr', null, f.map((c, j) => T(j === 0 ? 'th' : 'td', { scope: j === 0 ? 'row' : null, 'data-etq': t(p.cabeceras[j]) }, c))))));
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
  return { el: h('div', { class: 'tr-paso' }, h('div', { class: 'tr-resumen' }, p.titulo ? T('h2', null, p.titulo, '✨ ') : h('h2', null, '✨ ' + ui('esencial')),
    h('ul', null, p.puntos.map((x) => h('li', null, h('span', { class: 'tr-ok' }, '✓'), md(x, { sinGlosario: true })))))) };
}

function enlace(p) {
  if (p.lecc) {   // enlace a una lección de la biblioteca de referencia
    return { el: h('div', { class: 'tr-paso' }, h('div', { class: 'tr-enlace' }, h('div', { class: 'tr-enlace-ico' }, '📚'),
      h('div', { class: 'tr-enlace-txt' }, T('h3', null, p.titulo), md(p.texto, { maxTerminos: 2 })),
      h('a', { class: 'tr-btn tr-btn-primario', href: '#/l/' + p.lecc }, ui('abrirLeccion') + ' →'))) };
  }
  const buscar = p.protocolo;
  const url = '/design?panel=protocols&q=' + encodeURIComponent(buscar);
  const copiar = h('button', { type: 'button', class: 'tr-btn tr-btn-chico', onclick: async () => { try { await navigator.clipboard.writeText(buscar); toast(ui('copiado')); } catch (e) { /* sin portapapeles */ } } }, '⧉');
  return { el: h('div', { class: 'tr-paso' }, h('div', { class: 'tr-enlace' }, h('div', { class: 'tr-enlace-ico' }, '📋'),
    h('div', { class: 'tr-enlace-txt' }, T('h3', null, p.titulo), md(p.texto, { maxTerminos: 2 }), h('div', { class: 'tr-enlace-busca' }, ui('buscaEn') + ': ', h('code', null, buscar), copiar)),
    h('a', { class: 'tr-btn tr-btn-primario', href: url, target: '_blank', rel: 'noopener' }, ui('protocoloOficial') + ' ↗'))) };
}

function lider(p) {
  if (p.area === 'todas') return { el: h('div', { class: 'tr-paso' }, h('h2', { class: 'tr-paso-tit' }, '👥 ' + ui('areaManager') + 's'), h('div', { class: 'tr-lideres-grid' }, Object.keys(AREAS).map((a) => tarjetaLider(a)))) };
  return { el: h('div', { class: 'tr-paso tr-paso-lider' }, tarjetaLider(p.area, { texto: p.texto })) };
}

function caso(p) {
  const lista = h('ol', { class: 'tr-caso-linea' }, p.etapas.map((e, i) => h('li', { class: 'tr-caso-et' },
    h('span', { class: 'tr-caso-n' }, i + 1),
    h('div', { class: 'tr-caso-cuerpo' }, T('b', null, e.titulo), md(e.texto, { maxTerminos: 2 }),
      (e.tiempo || e.quien) ? h('div', { class: 'tr-caso-meta' }, e.tiempo ? h('span', { class: 'tr-caso-tiempo' }, '⏱ ' + t(e.tiempo)) : null, e.quien ? h('span', { class: 'tr-caso-quien' }, '👤 ' + t(e.quien)) : null) : null))));
  return { el: h('div', { class: 'tr-paso tr-caso' }, h('span', { class: 'tr-caso-sello' }, '🧪 ' + ui('casoEjemplo')), T('h2', { class: 'tr-paso-tit' }, p.titulo), md(p.contexto, { maxTerminos: 3 }), lista,
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
