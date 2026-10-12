// Calendarios privados del dueño (la "dirección secreta en formato iCal" de Google, el calendario publicado de
// Outlook o uno público de iCloud): sus eventos ocupan la agenda para que el bot no ofrezca esas horas.
// Se leen cada 5 minutos, sin tokens ni cuentas conectadas. Solo importa cuándo está ocupado, no qué hace.
import { business, env } from '../config.js';

export interface BusyInterval {
  start: number;
  end: number;
}

// ---------- Zonas horarias ----------
// Outlook usa nombres de Windows; Google e iCloud, nombres IANA. Si no se reconoce, se usa la del negocio.
const WINDOWS_TZ: Record<string, string> = {
  'SA Pacific Standard Time': 'America/Bogota',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Central America Standard Time': 'America/Guatemala',
  'Central Standard Time (Mexico)': 'America/Mexico_City',
  'SA Western Standard Time': 'America/La_Paz',
  'Venezuela Standard Time': 'America/Caracas',
  'Pacific SA Standard Time': 'America/Santiago',
  'Argentina Standard Time': 'America/Buenos_Aires',
  'E. South America Standard Time': 'America/Sao_Paulo',
  'GMT Standard Time': 'Europe/London',
  'Romance Standard Time': 'Europe/Paris',
  'W. Europe Standard Time': 'Europe/Berlin',
  UTC: 'UTC',
};

function validTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function resolveTz(tzid: string | undefined): string {
  if (!tzid) return business.timezone;
  const clean = tzid.replace(/^\/[^/]+\/[^/]+\//, ''); // "/mozilla.org/20050126_1/America/Bogota"
  if (validTz(clean)) return clean;
  return WINDOWS_TZ[clean] ?? business.timezone;
}

interface Wall {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
  ss: number;
}

function wallIn(tz: string, ms: number): Wall & { wd: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  return {
    y: Number(get('year')),
    m: Number(get('month')),
    d: Number(get('day')),
    hh: Number(get('hour')),
    mm: Number(get('minute')),
    ss: Number(get('second')),
    wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday')),
  };
}

/** Instante (ms) de una hora de pared en una zona; dos pasadas para los cambios de horario. */
function wallToMs(tz: string, w: Wall): number {
  const guess = Date.UTC(w.y, w.m - 1, w.d, w.hh, w.mm, w.ss);
  if (tz === 'UTC') return guess;
  const offset = (ms: number) => {
    const p = wallIn(tz, ms);
    return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - ms;
  };
  const first = guess - offset(guess);
  const second = guess - offset(first);
  return second;
}

function addDaysWall(w: Wall, n: number): Wall {
  const t = new Date(Date.UTC(w.y, w.m - 1, w.d + n));
  return { ...w, y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
const weekdayOf = (w: Wall) => new Date(Date.UTC(w.y, w.m - 1, w.d)).getUTCDay();
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// ---------- Lectura de iCalendar (RFC 5545) ----------
interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

function splitOutsideQuotes(s: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (const ch of s) {
    if (ch === '"') quoted = !quoted;
    if (ch === sep && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseLine(line: string): Prop | null {
  let quoted = false;
  let i = 0;
  for (; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ':' && !quoted) break;
  }
  if (i >= line.length) return null;
  const [name, ...rawParams] = splitOutsideQuotes(line.slice(0, i), ';');
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name!.toUpperCase(), params, value: line.slice(i + 1) };
}

interface DateValue {
  wall: Wall;
  tz: string;
  allDay: boolean;
}

function parseDate(value: string, params: Record<string, string>): DateValue | null {
  const v = value.trim();
  const day = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (day) return { wall: { y: +day[1]!, m: +day[2]!, d: +day[3]!, hh: 0, mm: 0, ss: 0 }, tz: resolveTz(params.TZID), allDay: true };
  const dt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (!dt) return null;
  return {
    wall: { y: +dt[1]!, m: +dt[2]!, d: +dt[3]!, hh: +dt[4]!, mm: +dt[5]!, ss: +dt[6]! },
    tz: dt[7] ? 'UTC' : resolveTz(params.TZID),
    allDay: false,
  };
}

function parseDuration(v: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return null;
  const ms = ((+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * 86400 + +(m[4] ?? 0) * 3600 + +(m[5] ?? 0) * 60 + +(m[6] ?? 0)) * 1000;
  return m[1] === '-' ? -ms : ms;
}

interface VEvent {
  uid: string;
  start: DateValue;
  end?: DateValue;
  duration?: number;
  rrule?: Record<string, string>;
  exdates: DateValue[];
  recurrenceId?: DateValue;
  cancelled: boolean;
  transparent: boolean;
}

function readEvents(text: string): VEvent[] {
  const lines = text.replace(/\r\n|\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events: VEvent[] = [];
  let cur: Partial<VEvent> | null = null;
  let nested = 0; // VALARM y demás bloques dentro del evento
  for (const line of lines) {
    const p = parseLine(line);
    if (!p) continue;
    if (p.name === 'BEGIN') {
      if (p.value.toUpperCase() === 'VEVENT') cur = { exdates: [], cancelled: false, transparent: false, uid: '' };
      else if (cur) nested++;
      continue;
    }
    if (p.name === 'END') {
      if (p.value.toUpperCase() === 'VEVENT' && cur) {
        if (cur.start) events.push(cur as VEvent);
        cur = null;
        nested = 0;
      } else if (cur && nested) nested--;
      continue;
    }
    if (!cur || nested) continue;
    switch (p.name) {
      case 'UID':
        cur.uid = p.value;
        break;
      case 'DTSTART':
        cur.start = parseDate(p.value, p.params) ?? undefined;
        break;
      case 'DTEND':
        cur.end = parseDate(p.value, p.params) ?? undefined;
        break;
      case 'DURATION':
        cur.duration = parseDuration(p.value) ?? undefined;
        break;
      case 'RRULE':
        cur.rrule = Object.fromEntries(p.value.split(';').map((kv) => kv.split('=') as [string, string]).map(([k, v]) => [k.toUpperCase(), v ?? '']));
        break;
      case 'EXDATE':
        for (const v of p.value.split(',')) {
          const d = parseDate(v, p.params);
          if (d) cur.exdates!.push(d);
        }
        break;
      case 'RECURRENCE-ID':
        cur.recurrenceId = parseDate(p.value, p.params) ?? undefined;
        break;
      case 'STATUS':
        cur.cancelled = p.value.toUpperCase() === 'CANCELLED';
        break;
      case 'TRANSP':
        cur.transparent = p.value.toUpperCase() === 'TRANSPARENT';
        break;
    }
  }
  return events;
}

const toMs = (d: DateValue) => wallToMs(d.tz, d.wall);
const WD: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/** Inicios (ms) de las ocurrencias de un evento repetido que caen antes de `until`. */
function occurrences(ev: VEvent, windowEnd: number): number[] {
  const s = ev.start;
  const startMs = toMs(s);
  if (!ev.rrule) return [startMs];
  const r = ev.rrule;
  const interval = Math.max(1, Number(r.INTERVAL ?? 1) || 1);
  const count = r.COUNT ? Number(r.COUNT) : Infinity;
  let until = Infinity;
  if (r.UNTIL) {
    const u = parseDate(r.UNTIL, {});
    if (u) until = u.allDay ? wallToMs(s.tz, { ...u.wall, hh: 23, mm: 59, ss: 59 }) : toMs(u);
  }
  const byday = (r.BYDAY ?? '')
    .split(',')
    .filter(Boolean)
    .map((x) => {
      const m = /^([+-]?\d+)?([A-Z]{2})$/.exec(x.toUpperCase());
      return m ? { n: m[1] ? Number(m[1]) : undefined, wd: WD[m[2]!]! } : null;
    })
    .filter((x): x is { n: number | undefined; wd: number } => x !== null);
  const bymonthday = (r.BYMONTHDAY ?? '').split(',').filter(Boolean).map(Number);
  const bymonth = (r.BYMONTH ?? '').split(',').filter(Boolean).map(Number);

  const out: number[] = [];
  let n = 0;
  // Devuelve false cuando ya no hay que seguir (COUNT, UNTIL o fin de la ventana).
  const emit = (w: Wall): boolean => {
    const ms = wallToMs(s.tz, w);
    if (ms < startMs) return true;
    if (ms > until || n >= count || ms > windowEnd) return false;
    n++;
    out.push(ms);
    return true;
  };
  const at = (y: number, m: number, d: number): Wall => ({ y, m, d, hh: s.wall.hh, mm: s.wall.mm, ss: s.wall.ss });
  const freq = (r.FREQ ?? '').toUpperCase();
  const MAX = 5000;

  if (freq === 'DAILY') {
    for (let k = 0; k < MAX; k++) {
      const w = addDaysWall(s.wall, k * interval);
      if (byday.length && !byday.some((b) => b.wd === weekdayOf(w))) continue;
      if (bymonth.length && !bymonth.includes(w.m)) continue;
      if (!emit(w)) break;
    }
  } else if (freq === 'WEEKLY') {
    const days = (byday.length ? byday.map((b) => b.wd) : [weekdayOf(s.wall)]).sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    const monday = addDaysWall(s.wall, -((weekdayOf(s.wall) + 6) % 7));
    outer: for (let k = 0; k < MAX; k++) {
      for (const wd of days) {
        const w = addDaysWall(monday, k * 7 * interval + ((wd + 6) % 7));
        if (!emit(w)) break outer;
      }
    }
  } else if (freq === 'MONTHLY') {
    outer: for (let k = 0; k < MAX; k++) {
      const total = s.wall.m - 1 + k * interval;
      const y = s.wall.y + Math.floor(total / 12);
      const m = (total % 12) + 1;
      const dim = daysInMonth(y, m);
      let days: number[];
      if (byday.length) {
        days = [];
        for (const b of byday) {
          const all = Array.from({ length: dim }, (_, i) => i + 1).filter((d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay() === b.wd);
          if (b.n === undefined) days.push(...all);
          else {
            const d = b.n > 0 ? all[b.n - 1] : all[all.length + b.n];
            if (d) days.push(d);
          }
        }
      } else if (bymonthday.length) days = bymonthday.map((d) => (d < 0 ? dim + d + 1 : d));
      else days = [s.wall.d];
      for (const d of [...new Set(days)].filter((d) => d >= 1 && d <= dim).sort((a, b) => a - b)) {
        if (!emit(at(y, m, d))) break outer;
      }
    }
  } else if (freq === 'YEARLY') {
    outer: for (let k = 0; k < MAX; k++) {
      const y = s.wall.y + k * interval;
      for (const m of bymonth.length ? bymonth : [s.wall.m]) {
        for (const d of bymonthday.length ? bymonthday : [s.wall.d]) {
          if (d > daysInMonth(y, m)) continue;
          if (!emit(at(y, m, d))) break outer;
        }
      }
    }
  } else {
    return [startMs]; // frecuencia no soportada: al menos la primera ocurrencia
  }
  return out;
}

/** Intervalos ocupados de un iCalendar entre `from` y `to` (ms). Ignora cancelados, "libres" y las citas de aiva. */
export function busyFromIcs(text: string, from: number, to: number, opts: { includeOwn?: boolean } = {}): BusyInterval[] {
  const events = readEvents(text).filter((e) => opts.includeOwn || !e.uid.startsWith('aiva-appt-'));
  // Ocurrencias movidas o canceladas una por una (RECURRENCE-ID): la serie las omite.
  const overridden = new Map<string, Set<number>>();
  for (const e of events) {
    if (!e.recurrenceId) continue;
    const set = overridden.get(e.uid) ?? new Set<number>();
    set.add(toMs(e.recurrenceId));
    overridden.set(e.uid, set);
  }
  const out: BusyInterval[] = [];
  for (const e of events) {
    if (e.cancelled || e.transparent) continue;
    const startMs = toMs(e.start);
    let length: number;
    if (e.end) length = toMs(e.end) - startMs;
    else if (e.duration !== undefined) length = e.duration;
    else length = e.start.allDay ? 86400_000 : 0;
    if (length <= 0) continue;
    const skip = new Set(e.exdates.map(toMs));
    const moved = e.recurrenceId ? undefined : overridden.get(e.uid);
    for (const start of e.recurrenceId ? [startMs] : occurrences(e, to)) {
      if (skip.has(start) || moved?.has(start)) continue;
      const end = start + length;
      if (end > from && start < to) out.push({ start, end });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

// ---------- Sincronización ----------
const REFRESH_MS = 5 * 60_000;
const perSource: BusyInterval[][] = [];
export interface BusySource {
  /** URL recortada: la dirección secreta no se muestra completa. */
  label: string;
  /** La sede que bloquea, si es de una sola (CALENDAR_BUSY_ICS_<SEDE>). Sin sede: bloquea todas. */
  sede?: string;
  ok: boolean;
  intervals: number;
  syncedAt?: number;
  error?: string;
}
/**
 * De dónde se leen: los de CALENDAR_BUSY_ICS bloquean todas las sedes —es el calendario del dueño, y si él está
 * ocupado no puede estar en ninguna—, y los de CALENDAR_BUSY_ICS_<SEDE> (CALENDAR_BUSY_ICS_NORTE) solo esa sede.
 *
 * 🪤 En el .env y no en aiva.config.json: son direcciones secretas —quien las tenga ve la agenda del dueño— y la
 * configuración se respalda y se manda por correo.
 */
const variableDe = (sede: string) => `CALENDAR_BUSY_ICS_${sede.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
const fuentes = (): { url: string; sede: string | null }[] => [
  ...env.calendarBusyIcs.map((url) => ({ url, sede: null })),
  ...business.sedes.flatMap((s) =>
    (process.env[variableDe(s.id)] ?? '')
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean)
      .map((url) => ({ url, sede: s.id })),
  ),
];
let urls: { url: string; sede: string | null }[] = [];
let sources: BusySource[] = [];
/**
 * La lista se arma al usarla y no al cargar el módulo: así la lee igual quien la toque después de arrancar (las
 * pruebas lo hacen). Si cambió, se empieza de cero: lo leído de una lista no vale para otra.
 */
function preparar(): void {
  const ahora = fuentes();
  if (JSON.stringify(ahora) === JSON.stringify(urls)) return;
  urls = ahora;
  sources = urls.map((u) => ({ label: maskUrl(u.url), ...(u.sede ? { sede: u.sede } : {}), ok: false, intervals: 0 }));
  perSource.length = 0;
}

function maskUrl(url: string): string {
  try {
    const u = new URL(url.replace(/^webcal:/i, 'https:'));
    return `${u.host}/…${u.pathname.slice(-12)}`;
  } catch {
    return 'URL inválida';
  }
}

export async function syncBusy(): Promise<void> {
  preparar();
  const from = Date.now() - 86400_000;
  const to = Date.now() + (business.appointments.maxDaysAhead + 2) * 86400_000;
  await Promise.all(
    urls.map(async ({ url }, i) => {
      const s = sources[i]!;
      try {
        const res = await fetch(url.replace(/^webcal:/i, 'https:'), { signal: AbortSignal.timeout(20_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('la respuesta no es un calendario iCal');
        perSource[i] = busyFromIcs(text, from, to);
        Object.assign(s, { ok: true, intervals: perSource[i]!.length, syncedAt: Date.now(), error: undefined });
      } catch (err) {
        // Se conserva lo último que se leyó bien: mejor una agenda algo vieja que ofrecer horas ocupadas.
        Object.assign(s, { ok: false, error: (err as Error).message });
        console.warn(`[calendario] no se pudo leer ${s.label}: ${(err as Error).message}`);
      }
    }),
  );
}

export function startBusySync(): void {
  if (!fuentes().length) return;
  void syncBusy();
  setInterval(() => void syncBusy(), REFRESH_MS).unref();
}

/** ¿Este calendario cuenta para esa sede? Los generales, para todas; los de una sede, solo para ella. */
const cuentaPara = (i: number, sede: string | null | undefined) => !urls[i]!.sede || urls[i]!.sede === sede;

/** Cuántos eventos del dueño se cruzan con [start, end) en esa sede (sin sede: los generales). */
export function busyOverlaps(start: number, end: number, sede?: string | null): number {
  preparar();
  let n = 0;
  perSource.forEach((list, i) => {
    if (!cuentaPara(i, sede)) return;
    for (const b of list ?? []) if (b.start < end && b.end > start) n++;
  });
  return n;
}

/** Los bloques ocupados de [from, to). Con sede, los generales y los de esa sede; sin sede, todos. */
export function busyIntervals(from: number, to: number, sede?: string | null): BusyInterval[] {
  preparar();
  return perSource
    .flatMap((list, i) => (sede === undefined || cuentaPara(i, sede) ? (list ?? []) : []))
    .filter((b) => b.end > from && b.start < to)
    .sort((a, b) => a.start - b.start);
}

export function busyStatus(): BusySource[] {
  preparar();
  return sources.map((s) => ({ ...s }));
}
