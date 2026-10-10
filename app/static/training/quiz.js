// Training: quizzes (una, varias, verdadero/falso, ordenar, parejas) usados en las lecciones y en el examen final.
import { h, t, ui, md, anillo } from './lib.js';

export const UMBRAL_LECCION = 70;

export function mezclar(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Una pregunta. onResponder(correcta) se llama cuando el alumno comprueba su respuesta.
function crearPregunta(q, onResponder) {
  const caja = h('div', { class: 'tr-preg' });
  const enunciado = h('div', { class: 'tr-preg-enun' }, md(q.enunciado, { sinGlosario: false, maxTerminos: 3 }));
  const cuerpo = h('div', { class: 'tr-preg-cuerpo' });
  const pie = h('div', { class: 'tr-preg-pie' });
  const fb = h('div', { class: 'tr-feedback', 'aria-live': 'polite' });
  caja.append(enunciado, cuerpo, pie, fb);
  let respondida = false, evaluar = () => false;
  const btn = h('button', { type: 'button', class: 'tr-btn tr-btn-primario', disabled: true, onclick: () => comprobar() }, ui('comprobar'));
  pie.append(btn);

  function terminar(ok) {
    respondida = true; btn.hidden = true;
    fb.className = 'tr-feedback ' + (ok ? 'ok' : 'mal');
    fb.append(...[h('b', null, ok ? '✔ ' + ui('correcto') : '✖ ' + ui('incorrecto')), q.explicacion ? h('div', { class: 'tr-fb-exp' }, h('span', null, ui('explicacion') + ': '), md(q.explicacion, { maxTerminos: 2 })) : null].filter(Boolean));
    cuerpo.classList.add('bloqueado');
    cuerpo.querySelectorAll('button, input, select').forEach((x) => { x.disabled = true; });
    onResponder(ok);
  }
  function comprobar() { if (!respondida) terminar(evaluar()); }
  const habilitar = (si) => { btn.disabled = !si; };

  if (q.tipo === 'una' || q.tipo === 'varias') {
    const multi = q.tipo === 'varias', ops = mezclar(q.opciones.map((o, i) => ({ ...o, i }))), marcadas = new Set();
    if (multi) cuerpo.append(h('div', { class: 'tr-preg-pista' }, ui('selecciona')));
    const lista = h('div', { class: 'tr-ops', role: multi ? 'group' : 'radiogroup' });
    ops.forEach((o) => {
      const b = h('button', { type: 'button', class: 'tr-op', role: multi ? 'checkbox' : 'radio', 'aria-checked': 'false', onclick: () => {
        if (respondida) return;
        if (multi) { marcadas.has(o.i) ? marcadas.delete(o.i) : marcadas.add(o.i); }
        else { marcadas.clear(); marcadas.add(o.i); }
        lista.querySelectorAll('.tr-op').forEach((x) => { const on = marcadas.has(+x.dataset.i); x.classList.toggle('sel', on); x.setAttribute('aria-checked', on); });
        habilitar(marcadas.size > 0);
      }, data: { i: o.i } }, h('span', { class: 'tr-op-marca' }), h('span', null, md(o.texto, { sinGlosario: true })));
      lista.append(b);
    });
    cuerpo.append(lista);
    evaluar = () => {
      const correctas = new Set(q.opciones.map((o, i) => (o.ok ? i : -1)).filter((i) => i >= 0));
      lista.querySelectorAll('.tr-op').forEach((x) => { const i = +x.dataset.i; x.classList.toggle('es-ok', correctas.has(i)); if (marcadas.has(i) && !correctas.has(i)) x.classList.add('es-mal'); });
      return marcadas.size === correctas.size && [...marcadas].every((i) => correctas.has(i));
    };
  } else if (q.tipo === 'vf') {
    const fila = h('div', { class: 'tr-vf' });
    [[true, ui('verdadero')], [false, ui('falso')]].forEach(([v, txt]) => fila.append(h('button', { type: 'button', class: 'tr-op tr-op-vf', onclick: () => {
      if (respondida) return;
      fila.querySelectorAll('.tr-op').forEach((x) => x.classList.remove('sel')); fila.querySelector(v ? '.v' : '.f').classList.add('sel');
      evaluar = () => { fila.querySelector(q.ok ? '.v' : '.f').classList.add('es-ok'); if (v !== q.ok) fila.querySelector(v ? '.v' : '.f').classList.add('es-mal'); return v === q.ok; };
      habilitar(true); comprobar();
    }, class: 'tr-op tr-op-vf ' + (v ? 'v' : 'f') }, txt)));
    cuerpo.append(fila);
  } else if (q.tipo === 'orden') {
    let orden = mezclar(q.items.map((x, i) => ({ x, i })));
    if (orden.every((o, k) => o.i === k)) orden = orden.reverse();
    cuerpo.append(h('div', { class: 'tr-preg-pista' }, ui('ordena')));
    const ul = h('ol', { class: 'tr-orden' });
    const pintar = () => {
      ul.replaceChildren(...orden.map((o, k) => h('li', { class: 'tr-orden-it' }, h('span', { class: 'tr-orden-n' }, k + 1), h('span', { class: 'tr-orden-t' }, md(o.x, { sinGlosario: true })),
        h('span', { class: 'tr-orden-bt' },
          h('button', { type: 'button', 'aria-label': ui('sube'), disabled: k === 0 || respondida, onclick: () => { [orden[k - 1], orden[k]] = [orden[k], orden[k - 1]]; pintar(); } }, '▲'),
          h('button', { type: 'button', 'aria-label': ui('baja'), disabled: k === orden.length - 1 || respondida, onclick: () => { [orden[k + 1], orden[k]] = [orden[k], orden[k + 1]]; pintar(); } }, '▼')))));
    };
    pintar(); cuerpo.append(ul); habilitar(true);
    evaluar = () => { orden.forEach((o, k) => ul.children[k].classList.add(o.i === k ? 'es-ok' : 'es-mal')); return orden.every((o, k) => o.i === k); };
  } else if (q.tipo === 'parejas') {
    cuerpo.append(h('div', { class: 'tr-preg-pista' }, ui('empareja')));
    // Las respuestas se comparan por texto (dos pares pueden compartir la misma respuesta) y no se repiten en la lista
    const textos = [...new Set(q.pares.map((p) => t(p.b)))], derecha = mezclar(textos), sel = [];
    const tabla = h('div', { class: 'tr-parejas' });
    q.pares.forEach((p, k) => {
      const s = h('select', { 'aria-label': t(p.a), onchange: () => { sel[k] = s.value === '' ? null : s.value; habilitar(q.pares.every((_, j) => sel[j] != null)); } },
        h('option', { value: '' }, ui('elige')), ...derecha.map((d) => h('option', { value: d }, d)));
      sel[k] = null;
      tabla.append(h('div', { class: 'tr-par-fila' }, h('span', { class: 'tr-par-a' }, t(p.a)), s));
    });
    cuerpo.append(tabla);
    evaluar = () => { let ok = true; q.pares.forEach((_, k) => { const bien = sel[k] === t(q.pares[k].b); tabla.children[k].classList.add(bien ? 'es-ok' : 'es-mal'); if (!bien) { ok = false; tabla.children[k].append(h('span', { class: 'tr-par-sol' }, '→ ' + t(q.pares[k].b))); } }); return ok; };
  }
  return caja;
}

// Quiz completo: una pregunta a la vez, resultado final. opts: { titulo, umbral, onFin(puntaje), reintentable }
export function crearQuiz(preguntas, opts) {
  const o = { umbral: UMBRAL_LECCION, ...(opts || {}) };
  const raiz = h('div', { class: 'tr-quiz' });
  let idx = 0, aciertos = 0, lista = preguntas;
  function pintar() {
    raiz.replaceChildren();
    if (idx >= lista.length) return resultado();
    const q = lista[idx];
    const cab = h('div', { class: 'tr-quiz-cab' },
      h('span', { class: 'tr-quiz-n' }, `${idx + 1} / ${lista.length}`),
      h('div', { class: 'tr-quiz-prog' }, h('i', { style: { width: (idx * 100 / lista.length) + '%' } })));
    const sig = h('button', { type: 'button', class: 'tr-btn tr-btn-primario', hidden: true, onclick: () => { idx++; pintar(); } }, idx === lista.length - 1 ? ui('verResultado') : ui('siguientePreg'));
    const pregunta = crearPregunta(q, (ok) => { if (ok) aciertos++; sig.hidden = false; sig.focus(); });
    raiz.append(cab, pregunta, h('div', { class: 'tr-quiz-sig' }, sig));
  }
  function resultado() {
    const pct = Math.round((aciertos * 100) / lista.length), ok = pct >= o.umbral;
    raiz.append(h('div', { class: 'tr-quiz-res ' + (ok ? 'ok' : 'mal') },
      anillo(pct, 120, 12), h('div', { class: 'tr-quiz-res-pct' }, pct + '%'),
      h('h3', null, ok ? ui('aprobaste') : ui('repetir')),
      h('p', null, `${ui('puntaje')}: ${aciertos} / ${lista.length}`),
      !ok && o.umbral === UMBRAL_LECCION ? h('p', { class: 'tr-sub' }, ui('necesitas70')) : null,
      h('button', { type: 'button', class: 'tr-btn', onclick: () => { idx = 0; aciertos = 0; lista = o.reintentable === false ? lista : lista.map((q) => q); pintar(); } }, ui('reintentar'))));
    if (o.onFin) o.onFin(pct);
  }
  pintar();
  return raiz;
}
