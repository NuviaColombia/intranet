// Calendario de Design (19-oct-2026): interfaz de la app «Calendario Colombia» adaptada a la intranet.
// Sin cuentas propias (usa la sesión de la intranet); permisos por equipo (ver services_design_calendario.py):
// admin todo · aprobadores sus equipos (crean y asignan) · diseñadores solo ven y marcan como hechas sus tareas.
// En vivo con el bus de Design (evento 'ds:vivo' {t:'cal'}). Ausencias desde People + vacaciones estimadas.
import { api, ApiError } from './api.js';
import { getColombianHolidays as festivosColombia, holidaysInRange as festivosColombiaRango, toISO } from './holidays.js';

// Festivos = los oficiales de Colombia + los de la empresa (Parámetros › Festivos), Rosember 19-oct-2026.
// Mismos nombres que las funciones de holidays.js: todo el calendario (mes, semana, año, Equipo, días hábiles) los usa.
const FESTIVOS_EMPRESA = new Map();   // 'AAAA-MM-DD' -> nombre
// Clase del día festivo: verde para los de Colombia y rojo para los de la empresa (Parámetros › Festivos).
const holClass = (h) => (h ? 'holiday' + (h.empresa ? ' empresa' : '') : '');
function holidaysInRange(from, to) {
  const m = festivosColombiaRango(from, to);
  for (const [d, name] of FESTIVOS_EMPRESA) if (d >= from && d <= to && !m.has(d)) m.set(d, { date: d, name, empresa: true });
  return new Map([...m.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}
function getColombianHolidays(year) {
  const lista = festivosColombia(year);
  const ya = new Set(lista.map((h) => h.date));
  for (const [d, name] of FESTIVOS_EMPRESA) if (d.slice(0, 4) === String(year) && !ya.has(d)) lista.push({ date: d, name, empresa: true });
  return lista.sort((a, b) => a.date.localeCompare(b.date));
}
/** Días hábiles entre dos fechas: sin sábados, domingos ni festivos (oficiales y de la empresa). */
function businessDays(from, to) {
  const hol = holidaysInRange(from, to);
  let n = 0;
  for (let d = from; d <= to; ) {
    const [y, m, dd] = d.split('-').map(Number);
    const dt = new Date(y, m - 1, dd);
    if (dt.getDay() !== 0 && dt.getDay() !== 6 && !hol.has(d)) n++;
    dt.setDate(dt.getDate() + 1);
    d = toISO(dt);
  }
  return n;
}
async function loadFestivosEmpresa() {
  try {
    const lista = await api.get('/design/api/calendario/festivos');
    FESTIVOS_EMPRESA.clear();
    for (const f of lista) FESTIVOS_EMPRESA.set(f.date, f.name);
  } catch { /* sin los de la empresa quedan los oficiales */ }
}

// ════════════════════════ Utilidades ════════════════════════

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const parseISO = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (s, n) => {
  const d = parseISO(s);
  d.setDate(d.getDate() + n);
  return toISO(d);
};
const diffDays = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);
const todayISO = () => toISO(new Date());
const weekStart = (s) => addDays(s, -((parseISO(s).getDay() + 6) % 7)); // semana inicia lunes
const monthStart = (s) => s.slice(0, 8) + '01';
const addMonths = (s, n) => {
  const d = parseISO(s);
  const day = d.getDate();
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(day, last));
  return toISO(t);
};
const isWeekend = (s) => [0, 6].includes(parseISO(s).getDay());
const toMin = (t) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : 0);
const fromMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const fmt = (s, opts) => new Intl.DateTimeFormat('es-CO', opts).format(parseISO(s));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const MONTHS = Array.from({ length: 12 }, (_, i) => cap(new Intl.DateTimeFormat('es-CO', { month: 'long' }).format(new Date(2020, i, 1))));
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3).toLowerCase());
const DOW = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const DOW_MINI = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

function timeShort(t) {
  if (!t) return '';
  const h = Number(t.slice(0, 2));
  const m = t.slice(3, 5);
  return `${h % 12 || 12}${m !== '00' ? ':' + m : ''}${h < 12 ? 'a' : 'p'}`;
}
function timeLong(t) {
  if (!t) return '';
  const h = Number(t.slice(0, 2));
  return `${h % 12 || 12}:${t.slice(3, 5)} ${h < 12 ? 'a. m.' : 'p. m.'}`;
}
function timeAgo(sqlDate) {
  const d = new Date(sqlDate.replace(' ', 'T') + 'Z');
  const sec = Math.round((d - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
  const abs = Math.abs(sec);
  if (abs < 60) return 'hace un momento';
  if (abs < 3600) return rtf.format(Math.round(sec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(sec / 3600), 'hour');
  return rtf.format(Math.round(sec / 86400), 'day');
}
const initials = (name = '') =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('') || '?';
const debounce = (fn, ms) => {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
};

const storage = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? { ...fallback, ...JSON.parse(v) } : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
};

const PALETTE = ['#4f46e5', '#3b82f6', '#0ea5e9', '#14b8a6', '#10b981', '#84cc16', '#eab308', '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#a855f7', '#64748b'];
const STATUS = { pending: 'Pendiente', in_progress: 'En progreso', done: 'Completado' };
const PRIORITY = { low: 'Baja', normal: 'Normal', high: 'Alta' };
const RECURRENCE = { none: 'No se repite', daily: 'Cada día', weekly: 'Cada semana', monthly: 'Cada mes', yearly: 'Cada año' };
const ABSENCE_META = {
  vacaciones: { label: 'Vacaciones', icon: '🌴', color: '#10b981' },
  permiso: { label: 'Permiso', icon: '⏱️', color: '#f59e0b' },
  incapacidad: { label: 'Incapacidad', icon: '🩺', color: '#ef4444' },
  licencia: { label: 'Licencia', icon: '📄', color: '#8b5cf6' },
  calamidad: { label: 'Calamidad', icon: '⚠️', color: '#64748b' },
  ausencia: { label: 'Ausencia', icon: '🚫', color: '#64748b' },
  otro: { label: 'Ausencia', icon: '📌', color: '#94a3b8' },
};
const absMeta = (a) => ABSENCE_META[a.type] || ABSENCE_META.otro;
const absStatusLabel = (a) => (a.status === 'estimated' ? ' (estimada)' : a.status === 'pending' ? ' (pendiente)' : '');
function hashColor(key = '') {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
const personColor = (a) => a.user_color || hashColor(a.person_key || a.person_name);
// Sin círculos con iniciales (Rosember, 19-oct-2026): las personas se muestran solo con su nombre
const personAvatar = () => '';
const firstName = (name = '') => String(name).trim().split(/\s+/)[0] || '';
const namesOf = (ids, max = 3) => {
  const n = ids.map((id) => firstName(userById(id)?.name)).filter(Boolean);
  return n.length > max ? `${n.slice(0, max).join(', ')} +${n.length - max}` : n.join(', ');
};
function absRangeLabel(a) {
  if (a.start_time && a.start_date === a.end_date) return `${fmt(a.start_date, { day: 'numeric', month: 'short' })} · ${timeLong(a.start_time)} – ${timeLong(a.end_time)}`;
  if (a.start_date === a.end_date) return fmt(a.start_date, { weekday: 'short', day: 'numeric', month: 'short' });
  const sameYear = a.start_date.slice(0, 4) === a.end_date.slice(0, 4);
  return `${fmt(a.start_date, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })} – ${fmt(a.end_date, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}
const absDaysLabel = (a) => {
  if (a.start_time) return 'Por horas';
  const n = businessDays(a.start_date, a.end_date);
  return `${n} día${n === 1 ? '' : 's'} hábil${n === 1 ? '' : 'es'}`;
};

// ════════════════════════ Estado ════════════════════════

const prefs = storage.get('dsCal.prefs', { showHolidays: true, onlyMine: false, showDone: true, hiddenTags: [], showAbsences: true, absenceTeam: '', showBirthdays: true });
const savePrefs = () => storage.set('dsCal.prefs', prefs);

const state = {
  me: null,
  users: [],
  tags: [],
  events: [],
  absences: [],
  absencePeople: [],
  absenceStatus: null,
  tasks: [],
  activity: [],
  online: new Set(),
  // Siempre abre en el mes actual.
  view: 'month',
  cursor: todayISO(),
  miniCursor: monthStart(todayISO()),
  personFocus: null,
  drag: null,
  scrollKey: null,
  today: todayISO(),
};

const userById = (id) => state.users.find((u) => u.id === id);
const tagById = (id) => state.tags.find((t) => t.id === id);
const canEdit = (ev) => !!ev.can_edit;   // lo decide el servidor: admin todo, aprobador sus equipos
const canCreate = () => !!state.me?.puedeCrear;
const eventColor = (ev) => ev.color || tagById(ev.tag_ids?.[0])?.color || userById(ev.created_by)?.color || '#4f46e5';

const avatar = () => '';   // ver personAvatar

// ════════════════════════ Equipos (intranet) ════════════════════════

/** Equipos donde esta persona puede crear (aprobador: los suyos; admin: todos + «General»). */
function teamChoices(current) {
  const list = (state.me.equipos || []).map((t) => ({ id: t.id, label: `${t.nombre}${t.area ? ` · ${t.area}` : ''}` }));
  if (state.me.admin) list.unshift({ id: null, label: '🌐 General (todo Design)' });
  if (current && !list.some((t) => t.id === current)) list.push({ id: current, label: 'Equipo actual' });
  return list;
}
function defaultTeam() {
  const ids = (state.me.equipos || []).map((t) => t.id);
  if (prefs.lastTeam && ids.includes(prefs.lastTeam)) return prefs.lastTeam;
  return ids[0] ?? null;
}
/** A quién se puede asignar: la gente del equipo (general: cualquiera de Design). */
function assignableIds(teamId) {
  if (!teamId) return new Set(state.users.map((u) => u.id));
  const t = (state.me.equipos || []).find((x) => x.id === teamId);
  if (t) return new Set(t.miembros);
  return new Set(state.users.filter((u) => (u.team_ids || []).includes(teamId)).map((u) => u.id));
}
const canEstimate = (userId) => state.me.admin || (state.me.equipos || []).some((t) => t.miembros.includes(userId));

/** Vacaciones estimadas (aún sin aprobar en People): las pone el aprobador para planear con tiempo. */
function openEstimate({ empleado_id = null, date = null, estimate = null } = {}) {
  if (!canCreate()) return;
  const people = state.absencePeople.filter((p) => p.user_id && canEstimate(p.user_id));
  const sel = estimate ? estimate.user_id : empleado_id;
  const start = estimate ? estimate.start_date : date || state.today;
  const end = estimate ? estimate.end_date : addDays(start, 4);
  const el = openModal(
    `<form id="est-form" novalidate>
      <div class="modal-head"><h2>${estimate ? 'Editar vacaciones estimadas' : 'Vacaciones estimadas'}</h2><button type="button" class="icon-btn" data-close aria-label="Cerrar">✕</button></div>
      <div class="modal-body">
        <p class="tiny muted" style="margin-top:0">Aún no están aprobadas en People: sirven para planear el equipo. Un mes antes del inicio le llega un push al manager para recordar que la persona envíe el formato de vacaciones a People. Cuando People las apruebe, estas se borran solas.</p>
        <label class="field"><span>Persona</span><select name="empleado_id" ${estimate ? 'disabled' : ''} required>
          <option value="">Elige…</option>
          ${people.map((p) => `<option value="${p.user_id}" ${p.user_id === sel ? 'selected' : ''}>${esc(p.person_name)}${p.team ? ` · ${esc(p.team)}` : ''}</option>`).join('')}</select></label>
        <div class="row">
          <label class="field"><span>Desde</span><input type="date" name="start_date" value="${start}" required /></label>
          <label class="field"><span>Hasta</span><input type="date" name="end_date" value="${end}" required /></label>
        </div>
        <div class="tiny muted" id="est-dias"></div>
        <label class="field"><span>Notas</span><input name="notes" maxlength="300" value="${esc(estimate?.notes || '')}" placeholder="Opcional" /></label>
      </div>
      <div class="modal-foot">${estimate ? `<button type="button" class="btn btn-danger" data-est-del="${estimate.estimada_id}">Eliminar</button>` : ''}<span class="spacer"></span>
        <button type="button" class="btn" data-close>Cancelar</button><button type="submit" class="btn btn-primary">${estimate ? 'Guardar' : 'Crear'}</button></div>
    </form>`,
    { size: 'sm' },
  );
  const form = $('#est-form', el);
  const f = (n) => form.elements[n];
  const dias = () => {
    const s = f('start_date').value, e = f('end_date').value;
    $('#est-dias', el).textContent = s && e && e >= s ? `${businessDays(s, e)} días hábiles` : '';
  };
  dias();
  form.addEventListener('change', (e) => {
    if (e.target.name === 'start_date' && f('end_date').value < e.target.value) f('end_date').value = e.target.value;
    dias();
  });
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return closeModal();
    const d = e.target.closest('[data-est-del]');
    if (d) deleteEstimate(Number(d.dataset.estDel));
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = { empleado_id: Number(f('empleado_id').value) || null, start_date: f('start_date').value, end_date: f('end_date').value, notes: f('notes').value };
    if (!estimate && !payload.empleado_id) return toast('Elige a la persona', 'error');
    try {
      if (estimate) await api.put(`/design/api/calendario/estimates/${estimate.estimada_id}`, payload);
      else await api.post('/design/api/calendario/estimates', payload);
      closeModal();
      toast(estimate ? 'Vacaciones estimadas actualizadas' : 'Vacaciones estimadas creadas', 'success');
      await Promise.all([loadAbsences(), loadAbsenceMeta()]);
      renderMain();
      renderSidebar();
    } catch (err) {
      handleError(err);
    }
  });
}

async function deleteEstimate(id) {
  if (!(await confirmDialog('Eliminar vacaciones estimadas', '¿Eliminar estas vacaciones estimadas?', 'Eliminar', true))) return;
  try {
    await api.del(`/design/api/calendario/estimates/${id}`);
    hidePopover();
    while (modalStack.length) closeModal();
    toast('Vacaciones estimadas eliminadas');
    await loadAbsences();
    renderMain();
    renderSidebar();
  } catch (err) {
    handleError(err);
  }
}

// ════════════════════════ Cumpleaños (salen de People) ════════════════════════

const BDAY_COLORES = ['#ec4899', '#f59e0b', '#8b5cf6', '#10b981', '#3b82f6', '#ef4444', '#eab308', '#14b8a6'];
const sinAnimacion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Lluvia de confeti dentro de `host` (se borra sola). */
function confeti(host, n = 46) {
  if (!host || sinAnimacion()) return;
  const capa = document.createElement('div');
  capa.className = 'cal-confeti';
  const alto = host.getBoundingClientRect().height || 300;
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i');
    p.style.left = Math.random() * 100 + '%';
    p.style.background = BDAY_COLORES[i % BDAY_COLORES.length];
    p.style.setProperty('--x', (Math.random() * 120 - 60).toFixed(0) + 'px');
    p.style.setProperty('--h', (alto + 40).toFixed(0) + 'px');
    p.style.setProperty('--r', (Math.random() * 720 - 360).toFixed(0) + 'deg');
    p.style.setProperty('--d', (1.6 + Math.random() * 1.6).toFixed(2) + 's');
    p.style.setProperty('--t', (Math.random() * 0.6).toFixed(2) + 's');
    if (i % 3 === 0) p.style.borderRadius = '50%';
    capa.append(p);
  }
  host.append(capa);
  setTimeout(() => capa.remove(), 4200);
}

/** Tarjeta de felicitación (no es un evento editable). */
function openBirthday(ev, occ) {
  const b = ev.birthday;
  const hoy = occ === state.today;
  const dias = diffDays(state.today, occ);
  const cuando = hoy ? '¡Es hoy!' : dias > 0 ? (dias === 1 ? 'Es mañana' : `Faltan ${dias} días`) : (dias === -1 ? 'Fue ayer' : `Fue hace ${-dias} días`);
  const el = openModal(
    `<div class="bday-card">
       <button type="button" class="icon-btn bday-cerrar" data-close aria-label="Cerrar">✕</button>
       <div class="bday-grande" aria-hidden="true">🎂</div>
       <h2>${hoy ? `¡Feliz cumpleaños, ${esc(b.first || b.name)}!` : esc(ev.title)}</h2>
       <p class="bday-fecha">${cap(fmt(occ, { weekday: 'long', day: 'numeric', month: 'long' }))} · ${cuando}</p>
       ${hoy ? '<p class="bday-msg">Hoy es un buen día para dejarle un saludo 🎉</p>' : ''}
     </div>`,
    { size: 'sm' },
  );
  el.addEventListener('click', (e) => e.target.closest('[data-close]') && closeModal());
  if (hoy) confeti(el.querySelector('.bday-card'), 60);
}

/** Al entrar el día de un cumpleaños: aviso con confeti (una vez al día en cada PC). */
function celebrarHoy() {
  const hoy = state.events.filter((e) => e.birthday && e.start_date === state.today);
  if (!hoy.length || prefs.showBirthdays === false) return;
  const clave = 'dsCal.cumple:' + state.today;
  try { if (localStorage.getItem(clave)) return; localStorage.setItem(clave, '1'); } catch {}
  const nombres = hoy.map((e) => e.birthday.first || e.birthday.name);
  const lista = nombres.length > 1 ? `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}` : nombres[0];
  const ban = document.createElement('button');
  ban.type = 'button';
  ban.className = 'bday-banner';
  ban.innerHTML = `<span class="bday-cake" aria-hidden="true">🎂</span><span><b>¡Hoy cumple${nombres.length > 1 ? 'n' : ''} años ${esc(lista)}!</b><br><span class="tiny">Toca para felicitar 🎉</span></span>`;
  ban.onclick = () => { ban.remove(); openBirthday(hoy[0], state.today); };
  $('#calapp').append(ban);
  confeti(ban, 34);
  setTimeout(() => ban.classList.add('sale'), 7500);
  setTimeout(() => ban.remove(), 8200);
}

// ════════════════════════ Recurrencia ════════════════════════

function nthOccurrence(start, n, rule) {
  const d = parseISO(start);
  if (rule === 'daily') return addDays(start, n);
  if (rule === 'weekly') return addDays(start, 7 * n);
  if (rule === 'monthly') {
    const t = new Date(d.getFullYear(), d.getMonth() + n, d.getDate());
    return t.getDate() === d.getDate() ? toISO(t) : null; // p. ej. día 31 se omite en meses cortos
  }
  if (rule === 'yearly') {
    const t = new Date(d.getFullYear() + n, d.getMonth(), d.getDate());
    return t.getMonth() === d.getMonth() ? toISO(t) : null; // 29 de febrero
  }
  return null;
}

/** Ocurrencias de un evento que tocan el rango [from, to]. */
function expand(ev, from, to) {
  const dur = diffDays(ev.start_date, ev.end_date);
  const ex = new Set(ev.exdates || []);
  const out = [];
  const push = (s) => {
    const e = addDays(s, dur);
    if (s <= to && e >= from && !ex.has(s)) out.push({ ev, start: s, end: e, key: `${ev.id}@${s}` });
  };
  if (ev.recurrence === 'none') {
    push(ev.start_date);
    return out;
  }
  const limit = ev.recurrence_until && ev.recurrence_until < to ? ev.recurrence_until : to;
  const s0 = parseISO(ev.start_date);
  const f0 = parseISO(from);
  let n = 0;
  if (ev.recurrence === 'daily') n = Math.max(0, diffDays(ev.start_date, from) - dur);
  if (ev.recurrence === 'weekly') n = Math.max(0, Math.floor((diffDays(ev.start_date, from) - dur) / 7));
  if (ev.recurrence === 'monthly') n = Math.max(0, (f0.getFullYear() - s0.getFullYear()) * 12 + f0.getMonth() - s0.getMonth() - Math.ceil(dur / 28) - 1);
  if (ev.recurrence === 'yearly') n = Math.max(0, f0.getFullYear() - s0.getFullYear() - 1 - Math.floor(dur / 365));
  for (let guard = 0; guard < 2000; guard++, n++) {
    const s = nthOccurrence(ev.start_date, n, ev.recurrence);
    if (s === null) continue;
    if (s > limit) break;
    push(s);
  }
  return out;
}

function passesFilters(ev) {
  const me = state.me.id;
  if (ev.birthday) {   // cumpleaños: solo los oculta su interruptor, «solo mis eventos» y el filtro de persona
    const uid = ev.birthday.user_id;
    return prefs.showBirthdays !== false && (!prefs.onlyMine || uid === me) && (!state.personFocus || uid === state.personFocus);
  }
  if (!prefs.showDone && ev.status === 'done') return false;
  if (prefs.onlyMine && ev.created_by !== me && !ev.assignee_ids.includes(me)) return false;
  if (state.personFocus && ev.created_by !== state.personFocus && !ev.assignee_ids.includes(state.personFocus)) return false;
  const hidden = new Set(prefs.hiddenTags);
  if (!ev.tag_ids.length) return !hidden.has(0);
  return ev.tag_ids.some((t) => !hidden.has(t));
}

function sortOcc(a, b) {
  const la = diffDays(a.start, a.end);
  const lb = diffDays(b.start, b.end);
  if (la !== lb) return lb - la;
  if (a.ev.all_day !== b.ev.all_day) return a.ev.all_day ? -1 : 1;
  return (a.ev.start_time || '').localeCompare(b.ev.start_time || '') || a.ev.title.localeCompare(b.ev.title);
}

function occurrencesByDay(from, to) {
  const map = new Map();
  for (const ev of state.events) {
    if (!passesFilters(ev)) continue;
    for (const occ of expand(ev, from, to)) {
      const s = occ.start < from ? from : occ.start;
      const e = occ.end > to ? to : occ.end;
      for (let d = s; d <= e; d = addDays(d, 1)) {
        if (!map.has(d)) map.set(d, []);
        map.get(d).push(occ);
      }
    }
  }
  for (const list of map.values()) list.sort(sortOcc);
  return map;
}

const holidays = (from, to) => (prefs.showHolidays ? holidaysInRange(from, to) : new Map());

function absencePasses(a) {
  if (prefs.absenceTeam && a.team !== prefs.absenceTeam) return false;
  if (prefs.onlyMine && a.user_id !== state.me.id) return false;
  if (state.personFocus && a.user_id !== state.personFocus) return false;
  return true;
}

/** Mapa día -> ausencias (respeta filtros). La vista Equipo ignora el interruptor "mostrar". */
function absencesByDay(from, to, { force = false } = {}) {
  const map = new Map();
  if (!prefs.showAbsences && !force) return map;
  for (const a of state.absences) {
    if (!absencePasses(a)) continue;
    const s = a.start_date < from ? from : a.start_date;
    const e = a.end_date > to ? to : a.end_date;
    for (let d = s; d <= e; d = addDays(d, 1)) {
      if (!map.has(d)) map.set(d, []);
      map.get(d).push(a);
    }
  }
  return map;
}

function absChip(a) {
  const m = absMeta(a);
  return `<button class="achip ${a.status !== 'approved' ? 'pending' : ''} ${a.status === 'estimated' ? 'estimated' : ''}" style="--c:${m.color}" data-abs-id="${a.id}" title="${esc(`${a.person_name} · ${m.label}${absStatusLabel(a)} · ${absRangeLabel(a)}`)}">
    <span>${m.icon}</span><span class="c-title">${esc(a.person_name)}</span>${a.start_time ? `<span class="c-time">${timeShort(a.start_time)}</span>` : ''}</button>`;
}

function absBadge(day, list) {
  if (!list?.length) return '';
  return `<button class="abs-badge" data-abs-day="${day}" title="${esc(list.map((a) => `${a.person_name} (${absMeta(a).label})`).join(', '))}">
    <span class="abs-names">🌴 ${list.length === 1 ? esc(firstName(list[0].person_name)) : `${list.length} fuera`}</span></button>`;
}

// ════════════════════════ Rangos / navegación ════════════════════════

function viewRange(view = state.view, cursor = state.cursor) {
  if (view === 'month') {
    const from = weekStart(monthStart(cursor));
    return { from, to: addDays(from, 41) };
  }
  if (view === 'week') {
    const from = weekStart(cursor);
    return { from, to: addDays(from, 6) };
  }
  if (view === 'agenda') return { from: cursor, to: addDays(cursor, 59) };
  if (view === 'team') {
    const from = monthStart(cursor);
    return { from, to: addDays(addMonths(from, 1), -1) };
  }
  const y = cursor.slice(0, 4);
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

function fetchRange() {
  const a = viewRange();
  const mini = viewRange('month', state.miniCursor);
  return { from: a.from < mini.from ? a.from : mini.from, to: a.to > mini.to ? a.to : mini.to };
}

function navigate(dir) {
  const v = state.view;
  if (v === 'month' || v === 'team') state.cursor = addMonths(state.cursor, dir);
  else if (v === 'week') state.cursor = addDays(state.cursor, 7 * dir);
  else if (v === 'agenda') state.cursor = addDays(state.cursor, 30 * dir);
  else state.cursor = addMonths(state.cursor, 12 * dir);
  state.miniCursor = monthStart(state.cursor);
  refresh();
}

function goTo(date, view = state.view) {
  state.cursor = date;
  state.view = view;
  state.miniCursor = monthStart(date);
  refresh();
}

// ════════════════════════ Carga de datos ════════════════════════

let loadSeq = 0;
async function loadEvents() {
  const seq = ++loadSeq;
  const { from, to } = fetchRange();
  const events = await api.get(`/design/api/calendario/events?from=${from}&to=${to}`);
  if (seq === loadSeq) state.events = events;
}
let absSeq = 0;
async function loadAbsences() {
  const seq = ++absSeq;
  const { from, to } = fetchRange();
  const list = await api.get(`/design/api/calendario/absences?from=${from}&to=${to}`);
  if (seq === absSeq) state.absences = list;
}
async function loadAbsenceMeta() {
  [state.absencePeople, state.absenceStatus] = await Promise.all([api.get('/design/api/calendario/absences/people'), api.get('/design/api/calendario/absences/status')]);
}
const loadTags = async () => (state.tags = await api.get('/design/api/calendario/tags'));
const loadUsers = async () => (state.users = await api.get('/design/api/calendario/users'));
const loadTasks = async () => (state.tasks = await api.get('/design/api/calendario/my-tasks'));

async function refresh() {
  renderAll(); // pinta inmediatamente con lo que haya (festivos, navegación)
  try {
    await Promise.all([loadEvents(), loadAbsences()]);
    renderMain();
    renderMini();
    renderAbsencePanel();
  } catch (e) {
    handleError(e);
  }
}

function handleError(e) {
  if (e instanceof ApiError && (e.status === 401 || e.status === 307)) return location.reload();
  toast(e.message || 'Algo salió mal', 'error');
  console.error(e);
}

// ════════════════════════ Render: topbar y sidebar ════════════════════════

function renderAll() {
  renderTopbar();
  renderSidebar();
  renderMain();
}

function renderTopbar() {
  const c = state.cursor;
  let title;
  if (state.view === 'month') title = `${MONTHS[parseISO(c).getMonth()]} ${c.slice(0, 4)}`;
  else if (state.view === 'week') {
    const { from, to } = viewRange();
    const sameMonth = from.slice(5, 7) === to.slice(5, 7);
    title = sameMonth
      ? `${Number(from.slice(8))} – ${Number(to.slice(8))} ${MONTHS_SHORT[parseISO(to).getMonth()]} ${to.slice(0, 4)}`
      : `${Number(from.slice(8))} ${MONTHS_SHORT[parseISO(from).getMonth()]} – ${Number(to.slice(8))} ${MONTHS_SHORT[parseISO(to).getMonth()]} ${to.slice(0, 4)}`;
  } else if (state.view === 'agenda') title = `Agenda · desde ${fmt(c, { day: 'numeric', month: 'short' })}`;
  else if (state.view === 'team') title = `Equipo · ${MONTHS[parseISO(c).getMonth()]} ${c.slice(0, 4)}`;
  else title = c.slice(0, 4);
  $('#period-title').textContent = title;
  $$('#view-switch button').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
  document.title = `${title} · Calendario`;
}

function miniMonthHtml(monthIso, { header = true, highlight = null, compact = false } = {}) {
  const from = weekStart(monthStart(monthIso));
  const to = addDays(from, 41);
  const month = monthIso.slice(0, 7);
  const hol = holidays(from, to);
  const byDay = occurrencesByDay(from, to);
  let html = header
    ? `<div class="mini-head"><button class="icon-btn" data-mini="-1" aria-label="Mes anterior">‹</button>
       <strong>${MONTHS[parseISO(monthIso).getMonth()]} ${monthIso.slice(0, 4)}</strong>
       <button class="icon-btn" data-mini="1" aria-label="Mes siguiente">›</button></div>`
    : '';
  html += '<div class="mini-grid">' + DOW_MINI.map((d) => `<span class="dow">${d}</span>`).join('');
  for (let i = 0; i < 42; i++) {
    const d = addDays(from, i);
    if (compact && i >= 35 && d.slice(0, 7) !== month) break;
    const h = hol.get(d);
    const cls = [
      d.slice(0, 7) !== month && 'out',
      h && holClass(h),
      d === state.today && 'today',
      byDay.has(d) && 'has-events',
      highlight && d >= highlight.from && d <= highlight.to && 'in-range',
    ]
      .filter(Boolean)
      .join(' ');
    const tip = h ? `${h.name}${h.moved ? ' (trasladado)' : ''}` : '';
    html += `<button class="${cls}" data-goto="${d}" title="${esc(tip)}">${Number(d.slice(8))}</button>`;
  }
  return html + '</div>';
}

function renderMini() {
  const highlight = state.view === 'week' ? viewRange() : null;
  $('#mini-cal').innerHTML = miniMonthHtml(state.miniCursor, { highlight });
}

function renderAbsencePanel() {
  $('#f-absences').checked = prefs.showAbsences;
  const teams = [...new Set(state.absencePeople.map((p) => p.team).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  if (prefs.absenceTeam && !teams.includes(prefs.absenceTeam)) teams.push(prefs.absenceTeam);
  $('#f-team').innerHTML =
    `<option value="">Todos los equipos</option>` + teams.map((t) => `<option value="${esc(t)}" ${t === prefs.absenceTeam ? 'selected' : ''}>${esc(t)}</option>`).join('');
  $('#f-team').hidden = !teams.length;

  const today = state.today;
  const out = state.absences.filter((a) => a.start_date <= today && a.end_date >= today && absencePasses(a));
  const st = state.absenceStatus;
  const connected = st?.pull || st?.push?.enabled;
  $('#out-today-count').textContent = out.length;
  $('#out-today').innerHTML = out.length
    ? `<li class="out-head">Fuera hoy</li>` +
      out
        .map((a) => {
          const m = absMeta(a);
          return `<li data-abs-id="${a.id}">${personAvatar(a)}<div><div class="t-title">${esc(a.person_name)}</div>
            <div class="t-date"><span style="color:${m.color}">${m.icon} ${m.label}</span>${a.status === 'estimated' ? ' · estimada' : a.status === 'pending' ? ' · pendiente' : ''} · ${a.start_time ? `${timeLong(a.start_time)} – ${timeLong(a.end_time)}` : `regresa ${fmt(nextWorkday(a.end_date), { weekday: 'short', day: 'numeric', month: 'short' })}`}</div></div></li>`;
        })
        .join('')
    : connected
      ? '<li class="empty">✅ Todo el equipo disponible hoy</li>'
      : '';

  const box = $('#sync-status');
  if (!st) return (box.innerHTML = '');
  if (st.pull?.intranet) {
    box.innerHTML = `<span class="sync-dot ok"></span>Datos de People (intranet), al día${canCreate() ? ' <button class="link-btn" data-estimate>＋ Vacaciones estimadas</button>' : ''}`;
    return;
  }
  if (!connected) {
    box.innerHTML = `<span class="muted">Sin conexión con la plataforma de vacaciones.</span>${state.me.role === 'admin' ? ' <button class="link-btn" data-integration-help>¿Cómo conectarla?</button>' : ''}`;
    return;
  }
  const pull = st.pull;
  const lastOk = [pull?.last_ok, st.push?.last_ok].filter(Boolean).sort().pop();
  const err = pull?.error && state.me.role === 'admin' ? `<div class="sync-err" title="${esc(pull.error)}">⚠️ ${esc(pull.error)}</div>` : '';
  box.innerHTML = `<span class="sync-dot ${pull?.error ? 'bad' : 'ok'}"></span>Sincronizado ${lastOk ? isoAgo(lastOk) : '—'}
    ${state.me.role === 'admin' && pull ? '<button class="link-btn" data-sync-now>Sincronizar</button>' : ''}${err}`;
}

const isoAgo = (iso) => timeAgo(new Date(iso).toISOString().slice(0, 19).replace('T', ' '));

/** Siguiente día hábil después de una fecha (para "regresa el…"). */
function nextWorkday(date) {
  let d = addDays(date, 1);
  for (let i = 0; i < 15 && (isWeekend(d) || holidaysInRange(d, d).size); i++) d = addDays(d, 1);
  return d;
}

function renderSidebar() {
  renderMini();
  renderAbsencePanel();
  $('#f-holidays').checked = prefs.showHolidays;
  $('#f-mine').checked = prefs.onlyMine;
  $('#f-done').checked = prefs.showDone;
  $('#f-bdays').checked = prefs.showBirthdays !== false;

  // Tareas asignadas
  const tasks = state.tasks;
  $('#tasks-count').textContent = tasks.length;
  $('#task-list').innerHTML = tasks.length
    ? tasks
        .slice(0, 8)
        .map((ev) => {
          const overdue = ev.end_date < state.today && ev.recurrence === 'none';
          return `<li data-open="${ev.id}" data-occ="${ev.start_date}">
            <input type="checkbox" class="check" style="--c:${esc(eventColor(ev))}" data-done="${ev.id}" title="Marcar como completado" />
            <div><div class="t-title">${esc(ev.title)}</div>
            <div class="t-date ${overdue ? 'overdue' : ''}">${overdue ? 'Vencido · ' : ''}${fmt(ev.start_date, { weekday: 'short', day: 'numeric', month: 'short' })}${ev.all_day ? '' : ' · ' + timeLong(ev.start_time)}${ev.status === 'in_progress' ? ' · En progreso' : ''}</div></div>
          </li>`;
        })
        .join('')
    : '<li class="empty">🎉 No tienes asignaciones pendientes</li>';

  // Etiquetas
  const hidden = new Set(prefs.hiddenTags);
  const tagRow = (id, name, color, usage) => `
    <li><label><input type="checkbox" class="check" style="--c:${esc(color)}" data-tag-filter="${id}" ${hidden.has(id) ? '' : 'checked'} />
    <span class="name">${esc(name)}</span></label>
    ${usage != null ? `<span class="count">${usage}</span>` : ''}
    <button class="only-btn" data-tag-only="${id}" title="Mostrar solo esta">solo</button></li>`;
  $('#tag-filters').innerHTML =
    state.tags.map((t) => tagRow(t.id, t.name, t.color, t.usage)).join('') + tagRow(0, 'Sin etiqueta', '#94a3b8', null);

  // Festivos: solo los del mes que se está viendo (Rosember, 19-oct-2026; antes salían los 18 del año)
  const year = Number(state.cursor.slice(0, 4));
  const mes = state.cursor.slice(0, 7);
  $('#holiday-year').textContent = `de ${MONTHS[parseISO(state.cursor).getMonth()].toLowerCase()}`;
  const list = getColombianHolidays(year).filter((h) => h.date.slice(0, 7) === mes);
  const next = list.find((h) => h.date >= state.today);
  $('#holiday-list').innerHTML = !list.length ? '<li class="empty">No hay festivos este mes</li>' : list
    .map(
      (h) => `<li data-goto-month="${h.date}" class="${h.date < state.today ? 'past' : ''} ${h === next ? 'next' : ''} ${h.empresa ? 'empresa' : ''}"
        title="${h.empresa ? 'Festivo de la empresa (Parámetros › Festivos)' : h.moved ? `Trasladado desde el ${fmt(h.originalDate, { day: 'numeric', month: 'long' })} (Ley Emiliani)` : 'Festivo fijo'}">
        <span class="h-date">${fmt(h.date, { day: '2-digit', month: 'short' })}</span>
        <span>${esc(h.name)}${h.moved ? ' <span class="h-moved">↪ lunes</span>' : ''}</span></li>`,
    )
    .join('');
}

// ════════════════════════ Render: vistas ════════════════════════

function renderMain() {
  const main = $('#main');
  const prevScroll = $('#week-body')?.scrollTop;
  if (state.view === 'month') main.innerHTML = renderMonth();
  else if (state.view === 'week') main.innerHTML = renderWeek();
  else if (state.view === 'agenda') main.innerHTML = renderAgenda();
  else if (state.view === 'team') main.innerHTML = renderTeam();
  else main.innerHTML = renderYear();
  if (state.view === 'week') afterWeekRender(prevScroll);
}

// ¿Ya pasó? (Rosember, 19-oct-2026: lo pasado se ve más apagado). Con hora: pasó cuando terminó.
function isPast(ev, end) {
  if (end < state.today) return true;
  if (end > state.today || ev.all_day || !ev.end_time) return false;
  const now = new Date();
  return toMin(ev.end_time) <= now.getHours() * 60 + now.getMinutes();
}

function chipHtml(occ, day) {
  const ev = occ.ev;
  if (ev.birthday) {
    const hoy = occ.start === state.today;
    return `<button class="chip bday ${hoy ? 'bday-hoy' : ''} ${isPast(ev, occ.end) ? 'past' : ''}" data-ev="${ev.id}" data-occ="${occ.start}" title="${esc(ev.title)}">
      <span class="bday-cake" aria-hidden="true">🎂</span><span class="c-title">${esc(ev.birthday.name)}</span></button>`;
  }
  const cls = ['chip'];
  if (isPast(ev, occ.end)) cls.push('past');
  if (ev.status === 'done') cls.push('done');
  if (ev.priority === 'high') cls.push('high');
  if (ev.visibility === 'private') cls.push('private');
  if (day > occ.start && parseISO(day).getDay() !== 1) cls.push('cont-left');
  if (day < occ.end && parseISO(day).getDay() !== 0) cls.push('cont-right');
  if (ev.all_day && occ.start !== occ.end) cls.push('solid');
  const meta = [
    ev.recurrence !== 'none' ? '↻' : '',
    ev.assignee_ids.length ? `👤${ev.assignee_ids.length}` : '',
    ev.comment_count ? `💬${ev.comment_count}` : '',
    ev.status === 'done' ? '✓' : ev.status === 'in_progress' ? '◐' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const tooltip = `${ev.title}${ev.all_day ? '' : ` · ${timeLong(ev.start_time)} – ${timeLong(ev.end_time)}`}${ev.location ? ` · ${ev.location}` : ''}`;
  return `<button class="${cls.join(' ')}" style="--c:${esc(eventColor(ev))}" data-ev="${ev.id}" data-occ="${occ.start}"
    ${canEdit(ev) ? 'draggable="true"' : ''} title="${esc(tooltip)}">
    ${!ev.all_day && day === occ.start ? `<span class="c-time">${timeShort(ev.start_time)}</span>` : ''}
    <span class="c-title">${esc(ev.title)}</span>${meta ? `<span class="c-meta">${meta}</span>` : ''}</button>`;
}

function monthCapacity() {
  const main = $('#main');
  const cellH = (main.clientHeight - 37) / 6;
  return Math.max(1, Math.floor((cellH - 40) / 24));
}

function renderMonth() {
  const { from, to } = viewRange();
  const month = state.cursor.slice(0, 7);
  const hol = holidays(from, to);
  const byDay = occurrencesByDay(from, to);
  const absDay = absencesByDay(from, to);
  const cap = window.matchMedia('(max-width: 640px)').matches ? 4 : monthCapacity();
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const d = addDays(from, i);
    const h = hol.get(d);
    const items = byDay.get(d) || [];
    const cls = ['day', d.slice(0, 7) !== month && 'out', isWeekend(d) && 'weekend', h && holClass(h), d === state.today && 'today', d < state.today && 'pasado']
      .filter(Boolean)
      .join(' ');
    const shown = items.length > cap ? items.slice(0, cap - 1) : items;
    const more = items.length - shown.length;
    cells += `<div class="${cls}" data-date="${d}" data-drop="day">
      <div class="day-head">
        <button class="day-num" data-week="${d}" title="Ver semana">${Number(d.slice(8))}${d.slice(8) === '01' ? ' ' + MONTHS_SHORT[parseISO(d).getMonth()] : ''}</button>
        ${h ? `<span class="holiday-name" title="${esc(h.name)}${h.moved ? ' · trasladado (Ley Emiliani)' : ''}">${esc(h.name)}</span>` : ''}
        ${absBadge(d, absDay.get(d))}
      </div>
      <div class="day-events">${shown.map((o) => chipHtml(o, d)).join('')}
      ${more > 0 ? `<button class="more-btn" data-more="${d}">+${more} más</button>` : ''}</div>
    </div>`;
  }
  return `<div class="month">
    <div class="dow-row">${DOW.map((d) => `<div>${d}</div>`).join('')}</div>
    <div class="month-grid" style="grid-template-rows:repeat(6,minmax(0,1fr))">${cells}</div>
  </div>`;
}

function layoutColumn(items) {
  items.sort((a, b) => a.s - b.s || b.e - a.e);
  const clusters = [];
  let cur = [];
  let end = -1;
  for (const it of items) {
    if (cur.length && it.s >= end) {
      clusters.push(cur);
      cur = [];
      end = -1;
    }
    cur.push(it);
    end = Math.max(end, it.e);
  }
  if (cur.length) clusters.push(cur);
  for (const cl of clusters) {
    const lanes = [];
    for (const it of cl) {
      let lane = lanes.findIndex((e) => e <= it.s);
      if (lane === -1) lane = lanes.length;
      lanes[lane] = it.e;
      it.lane = lane;
    }
    for (const it of cl) it.lanes = lanes.length;
  }
  return items;
}

function renderWeek() {
  const { from, to } = viewRange();
  const hol = holidays(from, to);
  const byDay = occurrencesByDay(from, to);
  const absDay = absencesByDay(from, to);
  const hourH = 48;
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const isTimed = (o) => !o.ev.all_day && o.start === o.end;

  const head = days
    .map((d, i) => {
      const h = hol.get(d);
      return `<div class="wh ${d === state.today ? 'today' : ''} ${h ? holClass(h) : ''}" data-goto-month="${d}" title="${esc(h?.name || '')}">
        <div class="dname">${DOW[i]}</div><div class="dnum">${Number(d.slice(8))}</div>
        ${h ? `<div class="hname">${esc(h.name)}</div>` : ''}</div>`;
    })
    .join('');

  const allday = days
    .map((d) => {
      const items = (byDay.get(d) || []).filter((o) => !isTimed(o));
      return `<div class="ad ${hol.has(d) ? holClass(hol.get(d)) : ''}" data-date="${d}" data-drop="allday">${(absDay.get(d) || []).map(absChip).join('')}${items.map((o) => chipHtml(o, d)).join('')}</div>`;
    })
    .join('');

  const cols = days
    .map((d) => {
      const items = layoutColumn(
        (byDay.get(d) || []).filter(isTimed).map((o) => {
          const s = toMin(o.ev.start_time);
          return { o, s, e: Math.max(toMin(o.ev.end_time), s + 25) };
        }),
      );
      const evs = items
        .map(({ o, s, e, lane, lanes }) => {
          const ev = o.ev;
          const w = 100 / lanes;
          return `<button class="tevent ${ev.status === 'done' ? 'done' : ''} ${isPast(ev, o.end) ? 'past' : ''}" data-ev="${ev.id}" data-occ="${o.start}" ${canEdit(ev) ? 'draggable="true"' : ''}
            style="--c:${esc(eventColor(ev))};top:${(s / 60) * hourH}px;height:${((e - s) / 60) * hourH - 2}px;left:calc(${lane * w}% + 2px);width:calc(${w}% - 4px);right:auto"
            title="${esc(ev.title)}">
            <span class="te-title">${ev.priority === 'high' ? '❗' : ''}${ev.visibility === 'private' ? '🔒 ' : ''}${esc(ev.title)}</span>
            <span class="te-time">${timeLong(ev.start_time)} – ${timeLong(ev.end_time)}</span>
            ${ev.assignee_ids.length ? `<span class="te-time">👤 ${esc(namesOf(ev.assignee_ids))}</span>` : ''}
          </button>`;
        })
        .join('');
      const now = d === state.today ? `<div class="now-line" style="top:${(toMin(fromMin(new Date().getHours() * 60 + new Date().getMinutes())) / 60) * hourH}px"></div>` : '';
      return `<div class="wcol ${isWeekend(d) ? 'weekend' : ''} ${hol.has(d) ? holClass(hol.get(d)) : ''}" data-date="${d}" data-drop="timed" style="height:${24 * hourH}px">${evs}${now}</div>`;
    })
    .join('');

  const hours = Array.from({ length: 24 }, (_, h) => `<div>${h === 0 ? '' : timeShort(fromMin(h * 60))}</div>`).join('');
  return `<div class="week">
    <div class="week-head"><div></div>${head}</div>
    <div class="week-allday"><div class="label">Todo el día</div>${allday}</div>
    <div class="week-body" id="week-body"><div class="week-grid"><div class="hours">${hours}</div>${cols}</div></div>
  </div>`;
}

function afterWeekRender(prevScroll) {
  const key = viewRange().from;
  const body = $('#week-body');
  if (state.scrollKey === key && prevScroll != null) return (body.scrollTop = prevScroll);
  state.scrollKey = key;
  const { from, to } = viewRange();
  const hour = state.today >= from && state.today <= to ? Math.max(0, new Date().getHours() - 2) : 7;
  body.scrollTop = hour * 48;
}

function renderAgenda() {
  const { from, to } = viewRange();
  const hol = holidays(from, to);
  const byDay = occurrencesByDay(from, to);
  const absDay = absencesByDay(from, to);
  let html = '';
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const items = byDay.get(d) || [];
    const h = hol.get(d);
    const outs = absDay.get(d) || [];
    if (!items.length && !h && !outs.length) continue;
    html += `<div class="agenda-day ${d === state.today ? 'today' : ''} ${h ? holClass(h) : ''}">
      <div class="agenda-date" data-week="${d}"><div class="ad-num">${Number(d.slice(8))}</div>
        <div class="ad-label">${cap(fmt(d, { weekday: 'long' }))}<br>${fmt(d, { month: 'short', year: 'numeric' })}</div></div>
      <div class="agenda-items">
        ${h ? `<div class="agenda-holiday">${h.empresa ? '🏢 Festivo de la empresa' : '🇨🇴 Festivo'}: ${esc(h.name)}${h.moved ? ' · trasladado desde el ' + fmt(h.originalDate, { day: 'numeric', month: 'long' }) : ''}</div>` : ''}
        ${outs.length ? `<div class="agenda-out"><span class="muted">Fuera:</span> ${outs.map(absChip).join('')}</div>` : ''}
        ${items
          .map((o) => {
            const ev = o.ev;
            const time = ev.all_day ? (o.start !== o.end ? `Día ${diffDays(o.start, d) + 1}/${diffDays(o.start, o.end) + 1}` : 'Todo el día') : `${timeLong(ev.start_time)}`;
            if (ev.birthday) {
              return `<button class="agenda-item bday ${isPast(ev, o.end) ? 'past' : ''}" data-ev="${ev.id}" data-occ="${o.start}">
                <span class="ai-time"><span class="bday-cake" aria-hidden="true">🎂</span></span>
                <span><div class="ai-title">${esc(ev.title)}</div><div class="ai-sub">${o.start === state.today ? '¡Es hoy! Felicítalo 🎉' : 'Cumpleaños'}</div></span><span></span></button>`;
            }
            return `<button class="agenda-item ${ev.status === 'done' ? 'done' : ''} ${isPast(ev, o.end) ? 'past' : ''}" style="--c:${esc(eventColor(ev))}" data-ev="${ev.id}" data-occ="${o.start}">
              <span class="ai-time">${time}</span>
              <span><div class="ai-title">${ev.priority === 'high' ? '❗ ' : ''}${ev.visibility === 'private' ? '🔒 ' : ''}${esc(ev.title)}</div>
                <div class="ai-sub">${ev.tag_ids.map((t) => tagById(t)).filter(Boolean).map((t) => `<span class="pill" style="--c:${esc(t.color)}">${esc(t.name)}</span>`).join('')}
                ${ev.location ? `<span>📍 ${esc(ev.location)}</span>` : ''}${ev.recurrence !== 'none' ? `<span>↻ ${RECURRENCE[ev.recurrence]}</span>` : ''}</div></span>
              <span style="display:flex;gap:8px;align-items:center"><span class="status ${ev.status}">${STATUS[ev.status]}</span>
                ${ev.assignee_ids.length ? `<span class="ai-names">👤 ${esc(namesOf(ev.assignee_ids, 4))}</span>` : ''}</span>
            </button>`;
          })
          .join('')}
      </div></div>`;
  }
  return `<div class="agenda">${html || `<div class="agenda-empty"><div class="big">🗓️</div><p>No hay eventos en los próximos 60 días.</p><button class="btn btn-primary" data-create="${from}">＋ Crear evento</button></div>`}</div>`;
}

function renderYear() {
  const y = state.cursor.slice(0, 4);
  let html = '';
  for (let m = 0; m < 12; m++) {
    const iso = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const count = prefs.showHolidays ? getColombianHolidays(Number(y)).filter((h) => h.date.slice(5, 7) === iso.slice(5, 7)).length : 0;
    html += `<div class="ymonth"><h4 data-goto-month="${iso}">${MONTHS[m]}${count ? `<span class="ycount">${count} festivo${count > 1 ? 's' : ''}</span>` : ''}</h4>
      ${miniMonthHtml(iso, { header: false, compact: true })}</div>`;
  }
  return `<div class="year">${html}</div>`;
}

// ════════════════════════ Vista Equipo (vacaciones y permisos) ════════════════════════

function renderTeam() {
  const { from, to } = viewRange();
  const days = Array.from({ length: diffDays(from, to) + 1 }, (_, i) => addDays(from, i));
  const hol = holidaysInRange(from, to);
  const st = state.absenceStatus;
  const connected = st?.pull || st?.push?.enabled;
  const people = state.absencePeople.filter(
    (p) => (!prefs.absenceTeam || p.team === prefs.absenceTeam) && (!state.personFocus || p.user_id === state.personFocus) && (!prefs.onlyMine || p.user_id === state.me.id),
  );

  if (!people.length) {
    return `<div class="agenda"><div class="agenda-empty"><div class="big">🌴</div>
      ${
        connected
          ? `<p>No hay personas para este filtro.</p>`
          : `<p><b>Aún no hay datos de vacaciones y permisos.</b><br>El calendario los toma de la plataforma de la empresa.</p>
           ${state.me.role === 'admin' ? '<button class="btn btn-primary" data-integration-help>Ver cómo conectar la plataforma</button>' : '<p class="muted">Pide a un administrador que conecte la plataforma.</p>'}`
      }
    </div></div>`;
  }

  const cols = `grid-template-columns: var(--tl-name) repeat(${days.length}, minmax(28px, 1fr)) 64px`;
  const dayCls = (d) => [isWeekend(d) && 'weekend', hol.has(d) && holClass(hol.get(d)), d === state.today && 'today', d < state.today && 'past'].filter(Boolean).join(' ');
  const bg = (p) => days.map((d, i) => `<div class="tl-cell ${dayCls(d)}${p && canEstimate(p.user_id) ? ' puede-estimar' : ''}" style="grid-column:${i + 2}"${p && canEstimate(p.user_id) ? ` data-est-person="${p.user_id}" data-est-date="${d}" title="Doble clic para poner vacaciones estimadas"` : ''}></div>`).join('');

  const head = `<div class="tl-row tl-head" style="${cols}"><div class="tl-name">Persona</div>
    ${days
      .map(
        (d, i) =>
          `<div class="tl-day ${dayCls(d)}" style="grid-column:${i + 2}" title="${esc(hol.get(d)?.name || '')}"><span>${DOW_MINI[(parseISO(d).getDay() + 6) % 7]}</span><b>${Number(d.slice(8))}</b></div>`,
      )
      .join('')}
    <div class="tl-sum">Días háb.</div></div>`;

  // Ausencias por persona dentro del mes
  const keys = new Set(people.map((p) => p.person_key));
  const byPerson = new Map();
  for (const a of state.absences) {
    if (a.start_date > to || a.end_date < from || !keys.has(a.person_key)) continue;
    if (!byPerson.has(a.person_key)) byPerson.set(a.person_key, []);
    byPerson.get(a.person_key).push(a);
  }

  // Fila de capacidad: cuántas personas están fuera cada día (solo aprobadas, días completos)
  const outRow = `<div class="tl-row tl-cap" style="${cols}"><div class="tl-name"><b>Fuera</b><span class="tiny muted">de ${people.length}</span></div>
    ${days
      .map((d, i) => {
        let n = 0;
        for (const list of byPerson.values()) if (list.some((a) => a.status === 'approved' && !a.start_time && a.start_date <= d && a.end_date >= d)) n++;
        return `<div class="tl-cell tl-capcell ${dayCls(d)}" style="grid-column:${i + 2};--r:${(n / people.length).toFixed(2)}" title="${n} de ${people.length} fuera">${n || ''}</div>`;
      })
      .join('')}<div class="tl-sum"></div></div>`;

  let body = '';
  let lastTeam = null;
  for (const p of people) {
    if (p.team !== lastTeam) {
      lastTeam = p.team;
      const n = people.filter((x) => x.team === p.team).length;
      body += `<div class="tl-team">${esc(p.team || 'Sin equipo')} <span class="muted">· ${n}</span></div>`;
    }
    let total = 0;
    const bars = (byPerson.get(p.person_key) || [])
      .map((a) => {
        const s = a.start_date < from ? from : a.start_date;
        const e = a.end_date > to ? to : a.end_date;
        if (!a.start_time && a.status === 'approved') total += businessDays(s, e);
        const m = absMeta(a);
        const span = diffDays(s, e) + 1;
        return `<button class="tl-bar ${a.end_date < state.today ? 'past' : ''} ${a.status !== 'approved' ? 'pending' : ''} ${a.status === 'estimated' ? 'estimated' : ''} ${a.start_date < from ? 'cut-l' : ''} ${a.end_date > to ? 'cut-r' : ''}"
          style="grid-column:${diffDays(from, s) + 2} / span ${span};--c:${m.color}" data-abs-id="${a.id}"
          title="${esc(`${m.label}${absStatusLabel(a)} · ${absRangeLabel(a)} · ${absDaysLabel(a)}`)}">
          <span>${m.icon}</span>${span >= 3 ? `<span class="c-title">${m.label}${a.status === 'estimated' ? ' · estimada' : a.status === 'pending' ? ' · pendiente' : ''}</span>` : ''}</button>`;
      })
      .join('');
    body += `<div class="tl-row" style="${cols}">
      <div class="tl-name">${personAvatar(p)}<span class="name" title="${esc(p.person_email || '')}">${esc(p.person_name)}</span></div>
      ${bg(p)}${bars}<div class="tl-sum">${total ? `${total} d` : '<span class="muted">—</span>'}</div></div>`;
  }

  const legend = Object.entries(ABSENCE_META)
    .filter(([k]) => !['otro', 'ausencia'].includes(k))
    .map(([, m]) => `<span class="legend-item"><span class="legend-sw" style="--c:${m.color}"></span>${m.icon} ${m.label}</span>`)
    .join('');
  return `<div class="team">
    <div class="team-toolbar">${legend}
      <span class="legend-item"><span class="legend-sw pending" style="--c:#10b981"></span>Pendiente en People</span>
      <span class="legend-item"><span class="legend-sw estimated"></span>Estimada (no aprobada)</span>
      <span class="legend-item"><span class="legend-sw" style="--c:#16a34a"></span>Festivo de Colombia</span><span class="legend-item"><span class="legend-sw" style="--c:#dc2626"></span>Festivo de la empresa</span>
      <span class="spacer"></span>${canCreate() ? '<button class="btn" data-estimate>＋ Vacaciones estimadas</button>' : ''}
      <span class="tiny muted">🔒 Aprobadas y pendientes: People (intranet). Las estimadas las pone el aprobador.</span></div>
    <div class="timeline">${head}${outRow}${body}</div></div>`;
}

function showAbsenceDay(anchor, date) {
  const list = absencesByDay(date, date).get(date) || [];
  showPopover(
    anchor,
    `<h4>Fuera · ${fmt(date, { weekday: 'long', day: 'numeric', month: 'long' })}</h4>
     <ul class="out-list">${list
       .map((a) => {
         const m = absMeta(a);
         return `<li data-abs-id="${a.id}">${personAvatar(a)}<div><div class="t-title">${esc(a.person_name)}${a.team ? ` <span class="tiny muted">· ${esc(a.team)}</span>` : ''}</div>
           <div class="t-date"><span style="color:${m.color}">${m.icon} ${m.label}</span>${a.status === 'pending' ? ' · pendiente' : ''} · ${absRangeLabel(a)}</div></div></li>`;
       })
       .join('')}</ul>`,
    { width: 300 },
  );
}

function showAbsenceDetail(anchor, id) {
  const a = state.absences.find((x) => x.id === Number(id));
  if (!a) return;
  const m = absMeta(a);
  showPopover(
    anchor,
    `<div style="display:flex;gap:10px;align-items:center;margin-bottom:10px">${personAvatar(a, 'lg')}
       <div><b>${esc(a.person_name)}</b><div class="tiny muted">${esc([a.team, a.person_email].filter(Boolean).join(' · '))}</div></div></div>
     <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px"><span class="pill" style="--c:${m.color}">${m.icon} ${m.label}</span>
       <span class="status ${a.status === 'approved' ? 'done' : 'in_progress'}">${a.status === 'estimated' ? 'Estimada (no aprobada en People)' : a.status === 'pending' ? 'Pendiente de aprobación en People' : 'Aprobado en People'}</span></div>
     ${a.type_name && a.type_name !== m.label ? `<div class="abs-line">🏷️ ${esc(a.type_name)}</div>` : ''}
     <div class="abs-line">📅 ${absRangeLabel(a)}</div>
     <div class="abs-line">🗓️ ${absDaysLabel(a)}${!a.start_time ? ` · regresa el ${fmt(nextWorkday(a.end_date), { weekday: 'long', day: 'numeric', month: 'short' })}` : ''}</div>
     ${a.notes ? `<div class="abs-line">📝 ${esc(a.notes)}</div>` : ''}
     ${a.status === 'estimated'
       ? `<p class="tiny muted" style="margin:10px 0 0">La puso el aprobador. Un mes antes del inicio le llega un push al manager para recordar que la persona envíe el formato de vacaciones a People. Cuando People las apruebe, esta estimada se borra sola.${a.reminded ? ' Recordatorio ya enviado.' : ''}</p>
          ${a.can_manage ? `<div class="est-acciones"><button class="btn" data-est-edit="${a.estimada_id}">Editar</button><button class="btn btn-danger" data-est-del="${a.estimada_id}">Eliminar</button></div>` : ''}`
       : `<p class="tiny muted" style="margin:10px 0 0">Se gestiona en People (${esc(a.external_id)}).</p>`}`,
    { width: 300 },
  );
}

function openIntegrationHelp() {
  const origin = location.origin;
  const el = openModal(
    `<div class="modal-head"><h2>Conectar la plataforma de vacaciones y permisos</h2><button class="icon-btn" data-close aria-label="Cerrar">✕</button></div>
     <div class="modal-body integration-help">
       <p>Tu plataforma es la <b>fuente oficial</b>: el calendario lee sus datos y los muestra en solo lectura. Usa una opción (o ambas):</p>
       <h4>Opción A · El calendario consulta tu plataforma (recomendado)</h4>
       <p>Expón un endpoint que devuelva JSON y configúralo en <code>calendar.config.json</code>:</p>
       <pre>{ "absences": { "sourceUrl": "https://tu-plataforma/api/ausencias",
                 "sourceToken": "token-de-lectura", "syncMinutes": 5 } }</pre>
       <h4>Opción B · Tu plataforma envía los cambios al calendario</h4>
       <pre>PUT    ${origin}/api/integrations/absences        (foto completa)
POST   ${origin}/api/integrations/absences        (altas / cambios)
DELETE ${origin}/api/integrations/absences/{id}
Authorization: Bearer &lt;pushToken&gt;</pre>
       <h4>Formato de cada registro</h4>
       <pre>{ "id": "VAC-1001", "nombre": "Laura Gómez", "correo": "laura@empresa.com",
  "equipo": "Diseño", "tipo": "Vacaciones", "estado": "Aprobado",
  "fecha_inicio": "2026-10-19", "fecha_fin": "2026-10-23",
  "hora_inicio": "14:00", "hora_fin": "17:00", "observaciones": "" }</pre>
       <p class="tiny muted">Se aceptan nombres en español o inglés (name, email, team, type, status, start_date, end_date…) y fechas AAAA-MM-DD o DD/MM/AAAA.
       El <b>correo</b> enlaza la ausencia con la cuenta del calendario. Más detalles en el README.</p>
     </div>`,
  );
  el.addEventListener('click', (e) => e.target.closest('[data-close]') && closeModal());
}

// ════════════════════════ Modales, popovers, toasts ════════════════════════

const modalStack = [];

function openModal(html, { size = '', onClose } = {}) {
  const el = document.createElement('div');
  el.className = `modal ${size}`;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = html;
  el.style.zIndex = 70 + modalStack.length * 2;
  $('#modal-root').append(el);
  modalStack.push({ el, onClose });
  const bd = $('#backdrop');
  bd.hidden = false;
  bd.style.zIndex = 69 + (modalStack.length - 1) * 2;
  hidePopover();
  setTimeout(() => el.querySelector('[autofocus]')?.focus(), 30);
  return el;
}

function closeModal() {
  const top = modalStack.pop();
  if (!top) return;
  top.el.remove();
  top.onClose?.();
  const bd = $('#backdrop');
  if (!modalStack.length) bd.hidden = true;
  else bd.style.zIndex = 69 + (modalStack.length - 1) * 2;
}

function choiceDialog(title, message, choices) {
  return new Promise((resolve) => {
    let done = false;
    const el = openModal(
      `<div class="modal-head"><h2>${esc(title)}</h2></div>
       <div class="modal-body"><p class="muted" style="margin:0">${message}</p></div>
       <div class="modal-foot"><span class="spacer"></span>
       <button class="btn" data-choice="">Cancelar</button>
       ${choices.map((c, i) => `<button class="btn ${c.danger ? 'btn-danger' : i === choices.length - 1 ? 'btn-primary' : ''}" data-choice="${c.value}">${esc(c.label)}</button>`).join('')}</div>`,
      { size: 'sm', onClose: () => !done && resolve(null) },
    );
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-choice]');
      if (!b) return;
      done = true;
      closeModal();
      resolve(b.dataset.choice || null);
    });
    el.querySelector('.btn-primary, .btn-danger')?.focus();
  });
}
const confirmDialog = (title, message, okLabel = 'Aceptar', danger = false) =>
  choiceDialog(title, message, [{ value: 'ok', label: okLabel, danger }]).then((v) => v === 'ok');

function showPopover(anchor, html, { width } = {}) {
  const pop = $('#popover');
  pop.onclick = null;
  pop.innerHTML = html;
  pop.hidden = false;
  if (width) pop.style.width = width + 'px';
  else pop.style.width = '';
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth;
  const ph = pop.offsetHeight;
  let left = Math.min(Math.max(8, r.left), window.innerWidth - pw - 8);
  let top = r.bottom + 6;
  if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 6);
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
  return pop;
}
const hidePopover = () => ($('#popover').hidden = true);

function toast(message, type = '', action) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${esc(message)}</span>${action ? `<button>${esc(action.label)}</button>` : ''}`;
  if (action) el.querySelector('button').onclick = () => (action.run(), el.remove());
  $('#toasts').append(el);
  setTimeout(() => el.remove(), action ? 6000 : 3500);
}

// ════════════════════════ Modal de evento ════════════════════════

async function openEventById(id, occ) {
  let ev = state.events.find((e) => e.id === Number(id)) || state.tasks.find((e) => e.id === Number(id));
  if (ev && ev.birthday) return openBirthday(ev, occ || ev.start_date);
  try {
    if (!ev) ev = await api.get(`/design/api/calendario/events/${id}`);
    openEventModal(ev, { occurrence: occ || ev.start_date });
  } catch (e) {
    handleError(e);
  }
}

function openCreate({ date = state.cursor, time = null, allDay = time === null } = {}) {
  if (!canCreate()) return;   // diseñadores: solo ven
  const startMin = time != null ? time : 9 * 60;
  const endMin = Math.min(startMin + 60, 23 * 60 + 59);
  openEventModal({
    title: '',
    start_date: date,
    end_date: date,
    all_day: allDay,
    start_time: fromMin(startMin),
    end_time: fromMin(endMin),
    recurrence: 'none',
    status: 'pending',
    priority: 'normal',
    visibility: 'public',
    tag_ids: [],
    assignee_ids: [],
    description: '',
    location: '',
    color: null,
    team_id: defaultTeam(),
  });
}

function openEventModal(ev, { occurrence } = {}) {
  const isNew = !ev.id;
  const editable = isNew || canEdit(ev);
  const isAssignee = !isNew && ev.assignee_ids.includes(state.me.id);
  const statusEditable = editable || isAssignee;
  const dis = editable ? '' : 'disabled';
  const draft = { tags: new Set(ev.tag_ids), people: new Set(ev.assignee_ids), color: ev.color, team: ev.team_id ?? null };
  const teamOptions = editable ? teamChoices(ev.team_id) : [];
  const creator = userById(ev.created_by);

  const el = openModal(
    `<form id="event-form" novalidate>
      <div class="modal-head">
        <h2>${isNew ? 'Nuevo evento' : editable ? 'Editar evento' : 'Detalle del evento'}</h2>
        <button type="button" class="icon-btn" data-close aria-label="Cerrar">✕</button>
      </div>
      <div class="modal-body">
        <input class="title-input" name="title" placeholder="Añade un título" maxlength="140" value="${esc(ev.title)}" ${dis} autofocus required />
        ${
          !isNew
            ? `<div class="meta-line">${avatar(creator, 'sm')} Creado por <b>${esc(creator?.name || '—')}</b>
               · ${timeAgo(ev.created_at)} ${ev.updated_at !== ev.created_at ? `· editado ${timeAgo(ev.updated_at)}` : ''}
               ${ev.recurrence !== 'none' ? `· <span>↻ ocurrencia del ${fmt(occurrence, { day: 'numeric', month: 'long', year: 'numeric' })}</span>` : ''}</div>`
            : ''
        }
        ${editable
          ? `<label class="field"><span>Equipo</span><select name="team_id">${teamOptions.map((t) => `<option value="${t.id ?? ''}" ${String(t.id ?? '') === String(draft.team ?? '') ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></label>`
          : `<div class="meta-line">👥 ${esc(ev.team_name || 'General (todo Design)')}</div>`}
        <div class="holiday-warning agenda-holiday" style="margin-bottom:14px" hidden></div>
        <div class="conflict-warning" hidden></div>
        <div class="row">
          <label class="field"><span>Inicio</span><input type="date" name="start_date" value="${ev.start_date}" ${dis} required /></label>
          <label class="field"><span>Fin</span><input type="date" name="end_date" value="${ev.end_date}" ${dis} required /></label>
        </div>
        <label class="switch" style="margin:-4px 0 8px"><input type="checkbox" name="all_day" ${ev.all_day ? 'checked' : ''} ${dis} /><span></span>Todo el día</label>
        <div class="row times" ${ev.all_day ? 'hidden' : ''}>
          <label class="field"><span>Hora inicio</span><input type="time" name="start_time" value="${ev.start_time || '09:00'}" step="300" ${dis} /></label>
          <label class="field"><span>Hora fin</span><input type="time" name="end_time" value="${ev.end_time || '10:00'}" step="300" ${dis} /></label>
        </div>
        <div class="row-3">
          <label class="field"><span>Repetir</span><select name="recurrence" ${dis}>
            ${Object.entries(RECURRENCE).map(([k, v]) => `<option value="${k}" ${ev.recurrence === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label class="field until" ${ev.recurrence === 'none' ? 'hidden' : ''}><span>Repetir hasta</span>
            <input type="date" name="recurrence_until" value="${ev.recurrence_until || ''}" ${dis} placeholder="Sin fin" /></label>
          <label class="field"><span>Visibilidad</span><select name="visibility" ${dis}>
            <option value="public" ${ev.visibility === 'public' ? 'selected' : ''}>🌐 Todo el equipo</option>
            <option value="private" ${ev.visibility === 'private' ? 'selected' : ''}>🔒 Privado (yo y asignados)</option></select></label>
        </div>
        <div class="row-3">
          <label class="field"><span>Estado</span><select name="status" ${statusEditable ? '' : 'disabled'}>
            ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${ev.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label class="field"><span>Prioridad</span><select name="priority" ${dis}>
            ${Object.entries(PRIORITY).map(([k, v]) => `<option value="${k}" ${ev.priority === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label class="field"><span>Ubicación</span><input name="location" maxlength="200" value="${esc(ev.location)}" placeholder="Oficina, enlace…" ${dis} /></label>
        </div>

        <div class="block"><span class="section-label">Etiquetas</span>
          <div class="toggle-chips" id="tag-chips"></div>
          <div class="inline-new" id="new-tag" hidden>
            <input type="color" value="${PALETTE[Math.floor(Math.random() * PALETTE.length)]}" aria-label="Color de etiqueta" />
            <input class="input" placeholder="Nombre de la etiqueta" maxlength="40" />
            <button type="button" class="btn" data-save-tag>Crear</button>
          </div>
        </div>

        <div class="block"><span class="section-label">Asignar a</span><div class="toggle-chips" id="people-chips"></div></div>

        <div class="block"><span class="section-label">Color</span><div class="color-row" id="color-row"></div></div>

        <label class="field"><span>Descripción</span><textarea name="description" maxlength="5000" placeholder="Notas, agenda, enlaces…" ${dis}>${esc(ev.description)}</textarea></label>

        ${
          !isNew
            ? `<div class="comments"><span class="section-label">Comentarios</span><div id="comment-list"><p class="tiny muted">Cargando…</p></div>
               <div class="comment-form">${avatar(state.me)}<input class="input" id="comment-input" placeholder="Escribe un comentario y presiona Enter" maxlength="2000" />
               <button type="button" class="btn" data-comment>Enviar</button></div></div>`
            : ''
        }
      </div>
      <div class="modal-foot">
        ${!isNew && editable ? `<button type="button" class="btn btn-danger" data-delete>Eliminar</button><button type="button" class="btn" data-duplicate title="Duplicar">Duplicar</button>` : ''}
        <span class="spacer"></span>
        <span class="tiny muted hide-sm">Ctrl + Enter para guardar</span>
        <button type="button" class="btn" data-close>Cancelar</button>
        ${statusEditable ? `<button type="submit" class="btn btn-primary">${isNew ? 'Crear evento' : 'Guardar'}</button>` : ''}
      </div>
    </form>`,
  );

  const form = $('#event-form', el);
  const f = (n) => form.elements[n];
  let prevStart = ev.start_date;

  const renderTagChips = () => {
    $('#tag-chips', el).innerHTML =
      state.tags
        .map(
          (t) => `<button type="button" class="toggle-chip ${draft.tags.has(t.id) ? 'on' : ''}" style="--c:${esc(t.color)}" data-tag="${t.id}" ${dis}>
            <span class="sw"></span>${esc(t.name)}</button>`,
        )
        .join('') + (editable && canCreate() ? '<button type="button" class="toggle-chip add" data-add-tag>＋ Nueva etiqueta</button>' : '');
  };
  const renderPeopleChips = () => {
    const allowed = assignableIds(draft.team);
    $('#people-chips', el).innerHTML = state.users
      .filter((u) => draft.people.has(u.id) || !editable || allowed.has(u.id))
      .map(
        (u) => `<button type="button" class="toggle-chip ${draft.people.has(u.id) ? 'on' : ''}" style="--c:${esc(u.color)}" data-person-chip="${u.id}" ${dis}>
          ${avatar(u, 'sm')}${esc(u.name)}${u.id === state.me.id ? ' (yo)' : ''}</button>`,
      )
      .join('');
  };
  const renderColors = () => {
    $('#color-row', el).innerHTML =
      `<button type="button" class="color-dot none ${!draft.color ? 'on' : ''}" style="--c:#94a3b8" data-color="" title="Automático (color de la etiqueta)" ${dis}></button>` +
      PALETTE.map((c) => `<button type="button" class="color-dot ${draft.color === c ? 'on' : ''}" style="--c:${c}" data-color="${c}" ${dis}></button>`).join('');
  };
  const updateHolidayWarning = () => {
    const box = $('.holiday-warning', el);
    const s = f('start_date').value;
    const e = f('end_date').value || s;
    if (!s) return (box.hidden = true);
    const hol = [...holidaysInRange(s, e > s ? e : s).values()];
    box.hidden = !hol.length;
    box.textContent = hol.length ? `🇨🇴 ${hol.length > 1 ? 'Incluye festivos' : 'Día festivo'}: ${hol.map((h) => `${h.name} (${fmt(h.date, { day: 'numeric', month: 'short' })})`).join(', ')}` : '';
  };
  // Aviso si alguna persona asignada está de vacaciones / permiso en esas fechas
  let conflictSeq = 0;
  const checkConflicts = debounce(async () => {
    const box = $('.conflict-warning', el);
    const s = f('start_date').value;
    const e = f('end_date').value || s;
    const people = [...draft.people];
    if (!s || e < s || !people.length) return (box.hidden = true);
    const seq = ++conflictSeq;
    try {
      const list = (await api.get(`/design/api/calendario/absences?from=${s}&to=${e}`)).filter((a) => people.includes(a.user_id));
      if (seq !== conflictSeq || !el.isConnected) return;
      box.hidden = !list.length;
      box.innerHTML = list.length
        ? `<b>⚠️ Conflicto de disponibilidad</b>` +
          list.map((a) => `<div>${absMeta(a).icon} <b>${esc(a.person_name)}</b>: ${absMeta(a).label}${a.status === 'pending' ? ' (pendiente)' : ''} · ${absRangeLabel(a)}</div>`).join('')
        : '';
    } catch {
      box.hidden = true;
    }
  }, 200);

  renderTagChips();
  renderPeopleChips();
  renderColors();
  updateHolidayWarning();
  checkConflicts();

  // Interacciones del formulario
  form.addEventListener('change', (e) => {
    const n = e.target.name;
    if (n === 'all_day') $('.times', el).hidden = e.target.checked;
    if (n === 'team_id') {
      draft.team = e.target.value ? Number(e.target.value) : null;
      const allowed = assignableIds(draft.team);
      for (const id of [...draft.people]) if (!allowed.has(id)) draft.people.delete(id);   // solo gente del equipo
      renderPeopleChips();
      checkConflicts();
    }
    if (n === 'recurrence') $('.until', el).hidden = e.target.value === 'none';
    if (n === 'start_date' && e.target.value) {
      // conserva la duración del evento al mover la fecha de inicio
      const span = Math.max(0, diffDays(prevStart, f('end_date').value || prevStart));
      f('end_date').value = addDays(e.target.value, span);
      prevStart = e.target.value;
    }
    if (n === 'start_time' && f('end_time').value <= e.target.value && f('start_date').value === f('end_date').value) {
      f('end_time').value = fromMin(Math.min(toMin(e.target.value) + 60, 23 * 60 + 59));
    }
    if (n === 'start_date' || n === 'end_date') {
      updateHolidayWarning();
      checkConflicts();
    }
  });

  el.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.matches('[data-close]')) return closeModal();
    if (t.dataset.tag) {
      const id = Number(t.dataset.tag);
      draft.tags.has(id) ? draft.tags.delete(id) : draft.tags.add(id);
      return renderTagChips();
    }
    if (t.dataset.personChip) {
      const id = Number(t.dataset.personChip);
      draft.people.has(id) ? draft.people.delete(id) : draft.people.add(id);
      checkConflicts();
      return renderPeopleChips();
    }
    if (t.dataset.color !== undefined) {
      draft.color = t.dataset.color || null;
      return renderColors();
    }
    if (t.matches('[data-add-tag]')) {
      $('#new-tag', el).hidden = false;
      return $('#new-tag .input', el).focus();
    }
    if (t.matches('[data-save-tag]')) return createTagInline();
    if (t.matches('[data-comment]')) return postComment();
    if (t.matches('[data-delete]')) return deleteEvent(ev, occurrence);
    if (t.matches('[data-duplicate]')) {
      closeModal();
      const { id, ...copy } = ev;
      return openEventModal({ ...copy, title: `${ev.title} (copia)`, created_by: state.me.id, exdates: [], can_edit: true });
    }
  });

  const createTagInline = async () => {
    const box = $('#new-tag', el);
    const name = $('.input', box).value.trim();
    if (!name) return;
    try {
      const tag = await api.post('/design/api/calendario/tags', { name, color: $('input[type=color]', box).value });
      state.tags.push(tag);
      draft.tags.add(tag.id);
      $('.input', box).value = '';
      box.hidden = true;
      renderTagChips();
      renderSidebar();
    } catch (err) {
      handleError(err);
    }
  };
  $('#new-tag .input', el).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      createTagInline();
    }
  });

  // Comentarios
  const loadComments = async () => {
    const list = await api.get(`/design/api/calendario/events/${ev.id}/comments`);
    $('#comment-list', el).innerHTML = list.length
      ? list
          .map(
            (c) => `<div class="comment">${avatar({ id: c.user_id, name: c.user_name, color: c.user_color })}
              <div class="c-body"><div class="c-head"><b>${esc(c.user_name)}</b><span class="tiny muted">${timeAgo(c.created_at)}</span></div>${esc(c.body)}</div></div>`,
          )
          .join('')
      : '<p class="tiny muted">Aún no hay comentarios. ¡Sé el primero!</p>';
  };
  const postComment = async () => {
    const input = $('#comment-input', el);
    const body = input.value.trim();
    if (!body) return;
    input.disabled = true;
    try {
      await api.post(`/design/api/calendario/events/${ev.id}/comments`, { body });
      input.value = '';
      ev.comment_count = (ev.comment_count || 0) + 1;
      await loadComments();
    } catch (err) {
      handleError(err);
    } finally {
      input.disabled = false;
      input.focus();
    }
  };
  if (!isNew) {
    loadComments().catch(handleError);
    $('#comment-input', el).addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        postComment();
      }
    });
  }

  // Guardar
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) form.requestSubmit();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = $('button[type=submit]', el);
    try {
      let saved;
      if (!editable) {
        saved = await api.patch(`/design/api/calendario/events/${ev.id}`, { status: f('status').value });
      } else {
        const payload = {
          title: f('title').value.trim(),
          start_date: f('start_date').value,
          end_date: f('end_date').value || f('start_date').value,
          all_day: f('all_day').checked,
          start_time: f('start_time').value,
          end_time: f('end_time').value,
          recurrence: f('recurrence').value,
          recurrence_until: f('recurrence_until').value || null,
          visibility: f('visibility').value,
          status: f('status').value,
          priority: f('priority').value,
          location: f('location').value,
          description: f('description').value,
          color: draft.color,
          tag_ids: [...draft.tags],
          assignee_ids: [...draft.people],
          team_id: draft.team,
        };
        if (draft.team) prefs.lastTeam = draft.team, savePrefs();
        if (!payload.title) {
          f('title').focus();
          return toast('Escribe un título para el evento', 'error');
        }
        submit.disabled = true;
        saved = isNew ? await api.post('/design/api/calendario/events', payload) : await api.put(`/design/api/calendario/events/${ev.id}`, payload);
      }
      closeModal();
      toast(isNew ? 'Evento creado' : 'Cambios guardados', 'success');
      upsertLocal(saved);
      if (isNew && (saved.start_date < viewRange().from || saved.start_date > viewRange().to)) {
        toast(`El evento quedó el ${fmt(saved.start_date, { day: 'numeric', month: 'long', year: 'numeric' })}`, '', {
          label: 'Ir',
          run: () => goTo(saved.start_date),
        });
      }
      renderMain();
      renderMini();
      reloadSide();
    } catch (err) {
      submit && (submit.disabled = false);
      handleError(err);
    }
  });
}

function upsertLocal(ev) {
  const i = state.events.findIndex((e) => e.id === ev.id);
  if (i >= 0) state.events[i] = ev;
  else state.events.push(ev);
}

const reloadSide = debounce(async () => {
  try {
    await Promise.all([loadTasks(), loadTags()]);
    renderSidebar();
  } catch (e) {
    handleError(e);
  }
}, 150);

async function deleteEvent(ev, occurrence) {
  let mode = 'all';
  if (ev.recurrence !== 'none') {
    mode = await choiceDialog(
      'Eliminar evento recurrente',
      `«${esc(ev.title)}» se repite. ¿Qué quieres eliminar?`,
      [
        { value: 'one', label: `Solo el ${fmt(occurrence, { day: 'numeric', month: 'short' })}` },
        { value: 'all', label: 'Toda la serie', danger: true },
      ],
    );
  } else if (!(await confirmDialog('Eliminar evento', `¿Eliminar «${esc(ev.title)}»? Esta acción no se puede deshacer.`, 'Eliminar', true))) mode = null;
  if (!mode) return;
  try {
    await api.del(`/design/api/calendario/events/${ev.id}${mode === 'one' ? `?occurrence=${occurrence}` : ''}`);
    closeModal();
    if (mode === 'one') {
      const local = state.events.find((e) => e.id === ev.id);
      if (local) local.exdates = [...(local.exdates || []), occurrence];
    } else state.events = state.events.filter((e) => e.id !== ev.id);
    toast('Evento eliminado');
    renderMain();
    renderMini();
    reloadSide();
  } catch (e) {
    handleError(e);
  }
}

// ════════════════════════ Arrastrar y soltar ════════════════════════

async function moveEvent({ id, occ, grabOffset }, targetDate, mode, targetMin) {
  const ev = state.events.find((e) => e.id === id);
  if (!ev) return;
  const delta = diffDays(occ, targetDate);
  const patch = { start_date: addDays(ev.start_date, delta), end_date: addDays(ev.end_date, delta) };
  if (mode === 'timed') {
    const total = ev.all_day ? 60 : diffDays(ev.start_date, ev.end_date) * 1440 + toMin(ev.end_time) - toMin(ev.start_time);
    let start = Math.round((targetMin - (grabOffset || 0)) / 15) * 15;
    start = Math.min(Math.max(0, start), 24 * 60 - 15);
    let endAbs = start + Math.max(15, total);
    const extraDays = Math.floor(endAbs / 1440);
    endAbs = endAbs % 1440;
    patch.start_date = targetDate;
    patch.end_date = addDays(targetDate, extraDays);
    if (extraDays && endAbs === 0) {
      patch.end_date = addDays(targetDate, extraDays - 1);
      endAbs = 1439;
    }
    patch.all_day = false;
    patch.start_time = fromMin(start);
    patch.end_time = fromMin(endAbs);
    if (ev.recurrence !== 'none') {
      // mantener el patrón: solo se desplaza la serie
      patch.start_date = addDays(ev.start_date, delta);
      patch.end_date = addDays(patch.start_date, extraDays);
    }
  } else if (mode === 'allday') patch.all_day = true;

  const unchanged =
    patch.start_date === ev.start_date &&
    patch.end_date === ev.end_date &&
    (patch.all_day === undefined || patch.all_day === ev.all_day) &&
    (patch.start_time === undefined || patch.start_time === ev.start_time);
  if (unchanged) return;

  if (ev.recurrence !== 'none') {
    const ok = await confirmDialog('Mover serie', `«${esc(ev.title)}» es recurrente. Se moverá <b>toda la serie</b>. ¿Continuar?`, 'Mover serie');
    if (!ok) return;
  }
  const backup = { ...ev };
  Object.assign(ev, patch);
  renderMain();
  renderMini();
  try {
    upsertLocal(await api.patch(`/design/api/calendario/events/${id}`, patch));
    renderMain();
    toast(`«${ev.title}» movido al ${fmt(patch.start_date, { weekday: 'long', day: 'numeric', month: 'long' })}`, '', {
      label: 'Deshacer',
      run: async () => {
        try {
          const keys = Object.keys(patch);
          const undo = Object.fromEntries(keys.map((k) => [k, backup[k]]));
          if (undo.all_day && !backup.start_time) delete undo.start_time;
          upsertLocal(await api.patch(`/design/api/calendario/events/${id}`, undo));
          renderMain();
          renderMini();
        } catch (e) {
          handleError(e);
        }
      },
    });
    reloadSide();
  } catch (e) {
    Object.assign(ev, backup);
    renderMain();
    handleError(e);
  }
}

function setupDragAndDrop() {
  const main = $('#main');
  main.addEventListener('dragstart', (e) => {
    const el = e.target.closest('[data-ev][draggable]');
    if (!el) return;
    let grabOffset = 0;
    if (el.classList.contains('tevent')) grabOffset = ((e.clientY - el.getBoundingClientRect().top) / 48) * 60;
    state.drag = { id: Number(el.dataset.ev), occ: el.dataset.occ, grabOffset };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', el.dataset.ev);
    requestAnimationFrame(() => el.classList.add('dragging'));
    hidePopover();
  });
  main.addEventListener('dragend', () => {
    state.drag = null;
    $$('.dragging, .drop-target').forEach((x) => x.classList.remove('dragging', 'drop-target'));
  });
  main.addEventListener('dragover', (e) => {
    if (!state.drag) return;
    const zone = e.target.closest('[data-drop]');
    if (!zone) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!zone.classList.contains('drop-target')) {
      $$('.drop-target').forEach((x) => x.classList.remove('drop-target'));
      zone.classList.add('drop-target');
    }
  });
  main.addEventListener('drop', (e) => {
    const zone = e.target.closest('[data-drop]');
    if (!zone || !state.drag) return;
    e.preventDefault();
    const drag = state.drag;
    state.drag = null;
    zone.classList.remove('drop-target');
    const mode = zone.dataset.drop;
    const minutes = mode === 'timed' ? ((e.clientY - zone.getBoundingClientRect().top) / 48) * 60 : 0;
    moveEvent(drag, zone.dataset.date, mode === 'day' ? 'day' : mode, minutes);
  });
}

// ════════════════════════ Otros modales ════════════════════════

function openTagManager() {
  const el = openModal(
    `<div class="modal-head"><h2>Etiquetas</h2><button class="icon-btn" data-close aria-label="Cerrar">✕</button></div>
     <div class="modal-body"><p class="tiny muted" style="margin-top:0">Las etiquetas son compartidas por todo el equipo. Cambia el color o el nombre y se guardará automáticamente.</p>
       <div id="tag-rows"></div>
       <span class="section-label" style="margin-top:16px">Nueva etiqueta</span>
       <div class="tag-row"><input type="color" id="nt-color" value="${PALETTE[Math.floor(Math.random() * PALETTE.length)]}" />
         <input class="input" id="nt-name" placeholder="Ej: Cliente, Urgente, Marketing…" maxlength="40" /><button class="btn btn-primary" data-new>Crear</button><span></span></div>
     </div>`,
    { size: 'sm' },
  );
  const rows = () => {
    $('#tag-rows', el).innerHTML = state.tags
      .map(
        (t) => `<div class="tag-row" data-id="${t.id}"><input type="color" value="${esc(t.color)}" data-field="color" />
          <input class="input" value="${esc(t.name)}" data-field="name" maxlength="40" />
          <span class="tiny muted">${t.usage || 0} uso${t.usage === 1 ? '' : 's'}</span>
          <button class="icon-btn" data-del title="Eliminar">🗑</button></div>`,
      )
      .join('');
  };
  rows();
  const after = async () => {
    await loadTags();
    rows();
    renderSidebar();
    renderMain();
  };
  el.addEventListener('change', async (e) => {
    const row = e.target.closest('.tag-row[data-id]');
    if (!row) return;
    try {
      await api.patch(`/design/api/calendario/tags/${row.dataset.id}`, { [e.target.dataset.field]: e.target.value });
      await after();
      toast('Etiqueta actualizada', 'success');
    } catch (err) {
      handleError(err);
      await after();
    }
  });
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.matches('[data-close]')) return closeModal();
    if (b.matches('[data-new]')) {
      const name = $('#nt-name', el).value.trim();
      if (!name) return $('#nt-name', el).focus();
      try {
        await api.post('/design/api/calendario/tags', { name, color: $('#nt-color', el).value });
        $('#nt-name', el).value = '';
        await after();
      } catch (err) {
        handleError(err);
      }
    }
    if (b.matches('[data-del]')) {
      const id = Number(b.closest('.tag-row').dataset.id);
      const tag = tagById(id);
      if (!(await confirmDialog('Eliminar etiqueta', `¿Eliminar «${esc(tag.name)}»? Se quitará de ${tag.usage || 0} evento(s).`, 'Eliminar', true))) return;
      try {
        await api.del(`/design/api/calendario/tags/${id}`);
        prefs.hiddenTags = prefs.hiddenTags.filter((t) => t !== id);
        savePrefs();
        await after();
        await loadEvents();
        renderMain();
      } catch (err) {
        handleError(err);
      }
    }
  });
  $('#nt-name', el).addEventListener('keydown', (e) => e.key === 'Enter' && $('[data-new]', el).click());
}

function openShortcuts() {
  const keys = [
    ['N', 'Nuevo evento'],
    ['T', 'Ir a hoy'],
    ['← / →', 'Periodo anterior / siguiente'],
    ['M', 'Vista mes'],
    ['S / W', 'Vista semana'],
    ['A', 'Vista agenda'],
    ['Y', 'Vista año'],
    ['E', 'Vista equipo (vacaciones y permisos)'],
    ['/', 'Buscar'],
    ['Ctrl + Enter', 'Guardar evento'],
    ['Esc', 'Cerrar ventana'],
  ];
  const el = openModal(
    `<div class="modal-head"><h2>Atajos de teclado</h2><button class="icon-btn" data-close>✕</button></div>
     <div class="modal-body">${keys.map(([k, v]) => `<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border)"><span>${v}</span><kbd style="background:var(--surface-3)">${k}</kbd></div>`).join('')}
     <p class="tiny muted">Consejo: arrastra los eventos para cambiarlos de día u hora. Haz doble clic en un espacio vacío para crear.</p></div>`,
    { size: 'sm' },
  );
  el.addEventListener('click', (e) => e.target.closest('[data-close]') && closeModal());
}

function openPeriodPicker(anchor) {
  let year = Number(state.cursor.slice(0, 4));
  const paint = () => {
    const curMonth = Number(state.cursor.slice(5, 7)) - 1;
    const pop = showPopover(
      anchor,
      `<div class="picker-years"><button class="icon-btn" data-py="-1">‹</button><b style="font-size:16px">${year}</b><button class="icon-btn" data-py="1">›</button></div>
       <div class="picker-months">${MONTHS_SHORT.map((m, i) => `<button data-pm="${i}" class="${i === curMonth && year === Number(state.cursor.slice(0, 4)) ? 'on' : ''}">${m}</button>`).join('')}</div>
       <div style="display:flex;gap:6px;margin-top:10px">${[2024, 2025, 2026, 2027, 2028, 2029, 2030].map((y) => `<button class="link-btn" data-pyear="${y}" style="flex:1">${y}</button>`).join('')}</div>`,
      { width: 300 },
    );
    pop.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.py) {
        year += Number(b.dataset.py);
        return paint();
      }
      if (b.dataset.pyear) {
        year = Number(b.dataset.pyear);
        return paint();
      }
      if (b.dataset.pm) {
        const m = Number(b.dataset.pm);
        const iso = `${year}-${String(m + 1).padStart(2, '0')}-01`;
        hidePopover();
        goTo(iso.slice(0, 7) === state.today.slice(0, 7) ? state.today : iso, state.view === 'year' ? 'month' : state.view);
      }
    };
  };
  paint();
}

// ════════════════════════ Búsqueda ════════════════════════

function setupSearch() {
  const input = $('#search');
  const box = $('#search-results');
  let results = [];
  let active = -1;
  const paint = () => {
    if (!input.value.trim()) return (box.hidden = true);
    box.hidden = false;
    box.innerHTML = results.length
      ? results
          .map(
            (ev, i) => `<button class="${i === active ? 'active' : ''}" data-i="${i}">
              <span class="avatar sm" style="background:${esc(eventColor(ev))}">${ev.recurrence !== 'none' ? '↻' : ''}</span>
              <span style="min-width:0"><div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(ev.title)}</div>
              ${ev.location ? `<div class="tiny muted">📍 ${esc(ev.location)}</div>` : ''}</span>
              <span class="sr-date">${fmt(ev.start_date, { day: 'numeric', month: 'short', year: 'numeric' })}</span></button>`,
          )
          .join('')
      : '<p class="tiny muted" style="padding:8px 10px;margin:0">Sin resultados</p>';
  };
  const choose = (ev) => {
    input.value = '';
    box.hidden = true;
    input.blur();
    goTo(ev.start_date);
    openEventModal(ev, { occurrence: ev.start_date });
  };
  const search = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) {
      results = [];
      return paint();
    }
    try {
      results = await api.get(`/design/api/calendario/events/search?q=${encodeURIComponent(q)}`);
      active = -1;
      paint();
    } catch (e) {
      handleError(e);
    }
  }, 200);
  input.addEventListener('input', search);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') active = Math.min(results.length - 1, active + 1);
    else if (e.key === 'ArrowUp') active = Math.max(0, active - 1);
    else if (e.key === 'Enter' && results[Math.max(0, active)]) return choose(results[Math.max(0, active)]);
    else if (e.key === 'Escape') {
      input.value = '';
      box.hidden = true;
      return input.blur();
    } else return;
    e.preventDefault();
    paint();
  });
  box.addEventListener('mousedown', (e) => {
    const b = e.target.closest('[data-i]');
    if (b) {
      e.preventDefault();
      choose(results[Number(b.dataset.i)]);
    }
  });
  input.addEventListener('blur', () => setTimeout(() => (box.hidden = true), 150));
  input.addEventListener('focus', () => input.value && paint());
}

// ════════════════════════ Tiempo real ════════════════════════

const reloadEquipos = debounce(async () => {
  try {
    state.me = await api.get('/design/api/calendario/me');
    await Promise.all([loadUsers(), loadAbsenceMeta(), loadEvents(), loadAbsences(), loadFestivosEmpresa()]);
    renderAll();
  } catch (e) {
    handleError(e);
  }
}, 500 + Math.random() * 3000);

function connectStream() {
  const reload = debounce(async () => {
    try {
      await Promise.all([loadEvents(), loadTasks(), loadTags(), loadAbsences()]);
      renderMain();
      renderSidebar();
    } catch (e) {
      handleError(e);
    }
  }, 300 + Math.random() * 1200);   // cada pantalla espera un poco distinto: no piden todas a la vez
  // Avisos del bus de Design (static/design/vivo.js): {t:'cal'} sin datos; cada pantalla pide lo que puede ver
  document.addEventListener('ds:vivo', (e) => {
    const a = e.detail || {};
    if (a.t === 'cal' || (a.t === 'reconectado' && !a.primera)) reload();
    if (a.t === 'cfg') reloadEquipos();   // cambiaron equipos o personas (Parámetros): quién se ve y a quién se asigna
  });
}

// ════════════════════════ Eventos globales ════════════════════════

function setupEvents() {
  $('#today-btn').onclick = () => goTo(todayISO());
  $('#prev-btn').onclick = () => navigate(-1);
  $('#next-btn').onclick = () => navigate(1);
  $('#create-btn').onclick = () => openCreate({ date: state.view === 'month' && state.cursor.slice(0, 7) !== state.today.slice(0, 7) ? state.cursor : state.today });
  $('#period-title').onclick = (e) => openPeriodPicker(e.currentTarget);
  $('#view-switch').onclick = (e) => {
    const b = e.target.closest('[data-view]');
    if (b) goTo(state.cursor, b.dataset.view);
  };
  $('#menu-btn').onclick = () => $('#sidebar').classList.toggle('open');
  $('#manage-tags').onclick = openTagManager;
  // Antes en el menú de la cuenta (se quitó: la cuenta y las notificaciones ya están en la barra de la intranet)
  $('#cal-ics').onclick = () => (location.href = '/design/api/calendario/export.ics');
  $('#cal-keys').onclick = openShortcuts;

  // Filtros
  $('#f-holidays').onchange = (e) => {
    prefs.showHolidays = e.target.checked;
    savePrefs();
    renderMain();
    renderMini();
  };
  $('#f-mine').onchange = (e) => {
    prefs.onlyMine = e.target.checked;
    savePrefs();
    renderMain();
    renderMini();
  };
  $('#f-absences').onchange = (e) => {
    prefs.showAbsences = e.target.checked;
    savePrefs();
    renderMain();
  };
  $('#f-team').onchange = (e) => {
    prefs.absenceTeam = e.target.value;
    savePrefs();
    renderAbsencePanel();
    renderMain();
  };
  $('#f-bdays').onchange = (e) => {
    prefs.showBirthdays = e.target.checked;
    savePrefs();
    renderMain();
    renderMini();
  };
  $('#f-done').onchange = (e) => {
    prefs.showDone = e.target.checked;
    savePrefs();
    renderMain();
    renderMini();
  };

  // Sidebar (delegado)
  $('#sidebar').addEventListener('click', async (e) => {
    const t = e.target;
    const absItem = t.closest('[data-abs-id]');
    if (absItem) return showAbsenceDetail(absItem, absItem.dataset.absId);
    if (t.closest('[data-estimate]')) return openEstimate({});
    if (t.closest('[data-integration-help]')) return openIntegrationHelp();
    if (t.closest('[data-sync-now]')) {
      try {
        const r = await api.post('/design/api/calendario/absences/sync');
        toast(r.unchanged ? 'Sin cambios en la plataforma' : `Sincronizado: ${r.imported ?? 0} ausencias${r.skipped ? ` · ${r.skipped} omitidas` : ''}`, 'success');
        await Promise.all([loadAbsences(), loadAbsenceMeta()]);
        renderSidebar();
        renderMain();
      } catch (err) {
        handleError(err);
        await loadAbsenceMeta().catch(() => {});
        renderAbsencePanel();
      }
      return;
    }
    const mini = t.closest('[data-mini]');
    if (mini) {
      state.miniCursor = addMonths(state.miniCursor, Number(mini.dataset.mini));
      renderMini();
      loadEvents().then(renderMini).catch(handleError);
      return;
    }
    const g = t.closest('[data-goto]');
    if (g) {
      goTo(g.dataset.goto, state.view === 'year' ? 'month' : state.view);
      if (innerWidth <= 960) $('#sidebar').classList.remove('open');
      return;
    }
    const gm = t.closest('[data-goto-month]');
    if (gm) return goTo(gm.dataset.gotoMonth, state.view === 'year' ? 'month' : state.view);
    const done = t.closest('[data-done]');
    if (done) {
      e.stopPropagation();
      try {
        await api.patch(`/design/api/calendario/events/${done.dataset.done}`, { status: 'done' });
        toast('¡Tarea completada! 🎉', 'success');
        await Promise.all([loadTasks(), loadEvents()]);
        renderSidebar();
        renderMain();
      } catch (err) {
        handleError(err);
      }
      return;
    }
    const open = t.closest('[data-open]');
    if (open) return openEventById(open.dataset.open, open.dataset.occ);
    const only = t.closest('[data-tag-only]');
    if (only) {
      const id = Number(only.dataset.tagOnly);
      prefs.hiddenTags = [0, ...state.tags.map((x) => x.id)].filter((x) => x !== id);
      savePrefs();
      renderSidebar();
      renderMain();
      renderMini();
      return;
    }
    const person = t.closest('[data-person]');
    if (person) {
      e.preventDefault();
      const id = Number(person.dataset.person);
      state.personFocus = !id || state.personFocus === id ? null : id;
      renderSidebar();
      renderMain();
      renderMini();
    }
  });
  $('#tag-filters').addEventListener('change', (e) => {
    const id = Number(e.target.dataset.tagFilter);
    const set = new Set(prefs.hiddenTags);
    e.target.checked ? set.delete(id) : set.add(id);
    prefs.hiddenTags = [...set];
    savePrefs();
    renderMain();
    renderMini();
  });

  // Vista principal (delegado)
  $('#main').addEventListener('click', (e) => {
    if ($('#sidebar').classList.contains('open')) $('#sidebar').classList.remove('open');
    const t = e.target;
    if (t.closest('[data-estimate]')) return openEstimate({});
    const absId = t.closest('[data-abs-id]');
    if (absId) return showAbsenceDetail(absId, absId.dataset.absId);
    const absDayBtn = t.closest('[data-abs-day]');
    if (absDayBtn) return showAbsenceDay(absDayBtn, absDayBtn.dataset.absDay);
    if (t.closest('[data-integration-help]')) return openIntegrationHelp();
    const chip = t.closest('[data-ev]');
    if (chip) return openEventById(chip.dataset.ev, chip.dataset.occ);
    const more = t.closest('[data-more]');
    if (more) return showDayPopover(more, more.dataset.more);
    const wk = t.closest('[data-week]');
    if (wk) return goTo(wk.dataset.week, 'week');
    const gm = t.closest('[data-goto-month]');
    if (gm) return goTo(gm.dataset.gotoMonth, 'month');
    const g = t.closest('[data-goto]');
    if (g) return goTo(g.dataset.goto, 'month');
    const cr = t.closest('[data-create]');
    if (cr) return openCreate({ date: cr.dataset.create });
  });
  // Crear un evento: DOBLE clic en un espacio vacío (Rosember, 19-oct-2026: con un clic se abría sin querer)
  $('#main').addEventListener('dblclick', (e) => {
    const t = e.target;
    const est = t.closest('[data-est-person]');   // vista Equipo: doble clic en la fila de una persona = vacaciones estimadas
    if (est) return openEstimate({ empleado_id: Number(est.dataset.estPerson), date: est.dataset.estDate });
    if (t.closest('[data-ev], [data-abs-id], [data-abs-day], [data-more], [data-week], [data-goto-month], [data-goto], button')) return;
    const col = t.closest('.wcol');
    if (col) {
      const min = Math.floor((((e.clientY - col.getBoundingClientRect().top) / 48) * 60) / 30) * 30;
      return openCreate({ date: col.dataset.date, time: Math.min(min, 23 * 60) });
    }
    const zone = t.closest('.day, .ad');
    if (zone) return openCreate({ date: zone.dataset.date, allDay: true });
  });

  $('#popover').addEventListener('click', (e) => {
    const ed = e.target.closest('[data-est-edit]');
    if (ed) {
      hidePopover();
      const a = state.absences.find((x) => x.estimada_id === Number(ed.dataset.estEdit));
      return openEstimate({ estimate: a });
    }
    const dl = e.target.closest('[data-est-del]');
    if (dl) return deleteEstimate(Number(dl.dataset.estDel));
    const absItem = e.target.closest('[data-abs-id]');
    if (absItem) return showAbsenceDetail(absItem, absItem.dataset.absId);
    const chip = e.target.closest('[data-ev]');
    if (chip) {
      hidePopover();
      openEventById(chip.dataset.ev, chip.dataset.occ);
    }
    const cr = e.target.closest('[data-create]');
    if (cr) {
      hidePopover();
      openCreate({ date: cr.dataset.create });
    }
    const m = e.target.closest('[data-menu]');
    if (m) {
      hidePopover();
      const a = m.dataset.menu;
      if (a === 'tags') openTagManager();
      if (a === 'keys') openShortcuts();
      if (a === 'ics') location.href = '/design/api/calendario/export.ics';
      if (a === 'estimate') openEstimate({});
    }
  });

  document.addEventListener('mousedown', (e) => {
    const pop = $('#popover');
    if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('#period-title, [data-more], [data-abs-id], [data-abs-day]')) hidePopover();
  });
  $('#backdrop').onclick = closeModal;

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('#popover').hidden) return hidePopover();
      if (modalStack.length) return closeModal();
      $('#sidebar').classList.remove('open');
      return;
    }
    if (modalStack.length || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest('input, textarea, select, [contenteditable]')) return;
    const k = e.key.toLowerCase();
    const actions = {
      n: () => $('#create-btn').click(),
      t: () => goTo(todayISO()),
      arrowleft: () => navigate(-1),
      arrowright: () => navigate(1),
      m: () => goTo(state.cursor, 'month'),
      s: () => goTo(state.cursor, 'week'),
      w: () => goTo(state.cursor, 'week'),
      a: () => goTo(state.cursor, 'agenda'),
      y: () => goTo(state.cursor, 'year'),
      e: () => goTo(state.cursor, 'team'),
      '/': () => $('#search').focus(),
      '?': openShortcuts,
    };
    if (actions[k]) {
      e.preventDefault();
      actions[k]();
    }
  });

  window.addEventListener(
    'resize',
    debounce(() => state.view === 'month' && renderMain(), 120),
  );

  // Cambio de día (medianoche) y línea de "ahora"
  setInterval(() => {
    const t = todayISO();
    if (t !== state.today) {
      state.today = t;
      renderAll();
    } else if (state.view === 'week') {
      const line = $('.now-line');
      if (line) line.style.top = ((new Date().getHours() * 60 + new Date().getMinutes()) / 60) * 48 + 'px';
    }
  }, 60_000);

  setupDragAndDrop();
  setupSearch();
}

function showDayPopover(anchor, date) {
  const from = date;
  const items = occurrencesByDay(from, from).get(date) || [];
  const h = holidays(date, date).get(date);
  showPopover(
    anchor,
    `<h4>${cap(fmt(date, { weekday: 'long', day: 'numeric', month: 'long' }))}<button class="link-btn" data-create="${date}">＋ Crear</button></h4>
     ${h ? `<div class="agenda-holiday" style="margin-bottom:8px">${h.empresa ? '🏢' : '🇨🇴'} ${esc(h.name)}</div>` : ''}
     <div class="day-events">${items.map((o) => chipHtml(o, date)).join('')}</div>`,
  );
  $$('#popover [draggable]').forEach((x) => x.removeAttribute('draggable'));
}

// ════════════════════════ Autenticación / arranque ════════════════════════

async function boot(me) {
  state.me = me;
  state.view = 'month';
  state.cursor = todayISO();
  state.today = state.cursor;
  // Enlace del push de vacaciones estimadas: /design/calendario?vista=team&fecha=AAAA-MM-DD
  const qs = new URLSearchParams(location.search);
  if (['month', 'week', 'agenda', 'year', 'team'].includes(qs.get('vista'))) state.view = qs.get('vista');
  if (/^\d{4}-\d{2}-\d{2}$/.test(qs.get('fecha') || '')) state.cursor = qs.get('fecha');
  state.miniCursor = monthStart(state.cursor);
  $('#create-btn').hidden = !canCreate();
  $('#solo-lectura').hidden = canCreate();
  $('#manage-tags').hidden = !canCreate();
  try {
    await Promise.all([loadUsers(), loadTags(), loadTasks(), loadAbsenceMeta(), loadFestivosEmpresa()]);
    await refresh();
    celebrarHoy();
    connectStream();
  } catch (e) {
    handleError(e);
  }
}

let wired = false;
async function start() {
  if (!wired) {
    setupEvents();
    wired = true;
  }
  try {
    const me = await api.get('/design/api/calendario/me');
    await boot(me);
  } catch (e) {
    handleError(e);
  }
}

start();
