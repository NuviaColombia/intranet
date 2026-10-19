// Festivos de Colombia — módulo isomórfico (lo usan el navegador y el servidor).
// Se calcula para CUALQUIER año, así que el calendario se "actualiza solo" cada año
// (2024, 2025 ... 2030 y siguientes) sin tener que cargar datos manualmente.
//
// Reglas:
//  - Fijos: no se mueven aunque caigan en fin de semana.
//  - Ley 51 de 1983 ("Ley Emiliani"): se trasladan al lunes siguiente si no caen en lunes.
//  - Religiosos móviles: dependen del Domingo de Pascua (algunos además se trasladan a lunes).

const pad = (n) => String(n).padStart(2, '0');
export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const nextMonday = (d) => addDays(d, d.getDay() === 1 ? 0 : (8 - d.getDay()) % 7);

// Algoritmo anónimo gregoriano (Meeus/Jones/Butcher).
export function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

const FIXED = [
  [1, 1, 'Año Nuevo'],
  [5, 1, 'Día del Trabajo'],
  [7, 20, 'Día de la Independencia'],
  [8, 7, 'Batalla de Boyacá'],
  [12, 8, 'Inmaculada Concepción'],
  [12, 25, 'Navidad'],
];

const EMILIANI = [
  [1, 6, 'Día de los Reyes Magos'],
  [3, 19, 'Día de San José'],
  [6, 29, 'San Pedro y San Pablo'],
  [8, 15, 'Asunción de la Virgen'],
  [10, 12, 'Día de la Diversidad Étnica y Cultural'],
  [11, 1, 'Día de Todos los Santos'],
  [11, 11, 'Independencia de Cartagena'],
];

// [días desde Pascua, nombre, ¿se traslada a lunes?]
const EASTER_BASED = [
  [-3, 'Jueves Santo', false],
  [-2, 'Viernes Santo', false],
  [39, 'Ascensión del Señor', true],
  [60, 'Corpus Christi', true],
  [68, 'Sagrado Corazón de Jesús', true],
];

const cache = new Map();

/** @returns {{date:string,name:string,originalDate:string,moved:boolean,type:'fijo'|'emiliani'|'religioso'}[]} */
export function getColombianHolidays(year) {
  if (cache.has(year)) return cache.get(year);
  const list = [];
  const add = (date, original, name, type) =>
    list.push({ date: toISO(date), originalDate: toISO(original), moved: toISO(date) !== toISO(original), name, type });

  for (const [m, d, name] of FIXED) {
    const dt = new Date(year, m - 1, d);
    add(dt, dt, name, 'fijo');
  }
  for (const [m, d, name] of EMILIANI) {
    const dt = new Date(year, m - 1, d);
    add(nextMonday(dt), dt, name, 'emiliani');
  }
  const easter = easterSunday(year);
  for (const [offset, name, move] of EASTER_BASED) {
    const dt = addDays(easter, offset);
    add(move ? nextMonday(dt) : dt, dt, name, 'religioso');
  }
  list.sort((a, b) => a.date.localeCompare(b.date));
  cache.set(year, list);
  return list;
}

/**
 * Días hábiles entre dos fechas (inclusive): excluye sábados, domingos y festivos de Colombia.
 * Útil para contar días de vacaciones (en Colombia las vacaciones se cuentan en días hábiles).
 */
export function businessDays(from, to, { saturdays = false } = {}) {
  const hol = holidaysInRange(from, to);
  const [y, m, d] = from.split('-').map(Number);
  const cur = new Date(y, m - 1, d);
  let n = 0;
  for (let iso = from; iso <= to; cur.setDate(cur.getDate() + 1), iso = toISO(cur)) {
    const dow = cur.getDay();
    if (dow === 0 || (dow === 6 && !saturdays) || hol.has(iso)) continue;
    n++;
  }
  return n;
}

/** Mapa ISO -> festivo para un rango [from, to] (strings YYYY-MM-DD). */
export function holidaysInRange(from, to) {
  const map = new Map();
  const y1 = Number(from.slice(0, 4));
  const y2 = Number(to.slice(0, 4));
  for (let y = y1; y <= y2; y++) {
    for (const h of getColombianHolidays(y)) {
      if (h.date >= from && h.date <= to) map.set(h.date, h);
    }
  }
  return map;
}
