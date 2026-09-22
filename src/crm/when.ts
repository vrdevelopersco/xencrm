// Intérprete de fechas y franjas para el flujo de citas: "el sábado en la tarde", "mañana después de las 5",
// "el 2 de octubre a las 4", "la otra semana temprano". Primero reglas (gratis y deterministas); solo si el
// mensaje habla de tiempo y las reglas no lo entienden, el modelo traduce la frase a un filtro. La disponibilidad
// real siempre la calcula availableSlots: el modelo nunca elige la fecha.
import { business } from '../config.js';
import { expandExpressions } from '../agent/dictionary.js';
import { classify, fallbackOrder, roleEngine } from '../llm/engines.js';
import type { SchemaSpec } from '../llm/apple.js';
import { dayKey, formatDay, tzParts, zoned, type When } from './appointments.js';

export function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// ---------- Calendario local ----------
type YMD = { y: number; m: number; d: number };
const keyOf = (x: YMD) => dayKey(x.y, x.m, x.d);
function addDays(x: YMD, n: number): YMD {
  const t = new Date(Date.UTC(x.y, x.m - 1, x.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
function validDate(y: number, m: number, d: number): YMD | null {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? { y, m, d } : null;
}
function fromKey(key: string): YMD {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return { y, m, d };
}
export function weekdayOfKey(key: string): number {
  const x = fromKey(key);
  return new Date(Date.UTC(x.y, x.m - 1, x.d)).getUTCDay();
}

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const WEEKDAYS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MONTH = `(${MONTHS.join('|')}|setiembre)`;
const WEEKDAY = `(${WEEKDAYS.join('|')})s?`;
const monthNumber = (s: string) => (s === 'setiembre' ? 9 : MONTHS.indexOf(s) + 1);

// ---------- Horas ----------
const RELATIVE_WORDS: Record<string, number> = { un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, diez: 10, quince: 15 };
const HOUR_WORDS: Record<string, number> = { una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12 };
// "5", "5:30", "cinco", "tres y media", "4 pm", "10 de la mañana"
const H = String.raw`(\d{1,2}(?::\d{2})?|${Object.keys(HOUR_WORDS).join('|')})(?:\s+y\s+(media|cuarto))?(?:\s*(a\.?\s?m\.?|p\.?\s?m\.?|de\s+la\s+(?:manana|tarde|noche)|del\s+mediodia)(?![a-z]))?`;
type Franja = 'manana' | 'mediodia' | 'almuerzo' | 'tarde' | 'noche' | 'ultima';

function toMinutes(num: string, frac: string | undefined, meridiem: string | undefined, franja: Franja | undefined): number | null {
  let h: number;
  let m = 0;
  if (num in HOUR_WORDS) h = HOUR_WORDS[num]!;
  else {
    const [hs, ms] = num.split(':');
    h = Number(hs);
    m = ms ? Number(ms) : 0;
  }
  if (frac === 'media') m += 30;
  if (frac === 'cuarto') m += 15;
  if (h > 23 || m > 59) return null;
  const mer = (meridiem ?? '').replace(/[\s.]/g, '');
  if (/^(pm|delatarde|delanoche)$/.test(mer) || (!mer && (franja === 'tarde' || franja === 'noche'))) {
    if (h < 12) h += 12;
  } else if (/^(am|delamanana)$/.test(mer)) {
    if (h === 12) h = 0;
  } else if (mer === 'delmediodia') {
    h = 12;
  } else if (h >= 1 && h <= 7) {
    h += 12; // "a las 4" en un negocio: 4 de la tarde
  }
  return h * 60 + m;
}

export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'a. m.' : 'p. m.'}`;
}
const las = (min: number) => `${Math.floor(min / 60) % 12 === 1 ? 'la' : 'las'} ${formatMinutes(min)}`;

// ---------- Etiquetas ----------
function dayText(x: YMD, today: YMD): string {
  const diff = Math.round((Date.UTC(x.y, x.m - 1, x.d) - Date.UTC(today.y, today.m - 1, today.d)) / 86400_000);
  if (diff === 0) return 'hoy';
  if (diff === 1) return 'mañana';
  if (diff === 2) return 'pasado mañana';
  return `el ${formatDay(zoned(x.y, x.m, x.d, 12, 0)).replace(',', '')}`;
}

function weekdaysText(wds: number[]): string {
  if (wds.length === 2 && wds.includes(6) && wds.includes(0)) return 'el fin de semana';
  return wds.map((w) => `el ${WEEKDAYS_ES[w]}`).join(' o ');
}

function finish(w: Omit<When, 'label'>): When {
  const label = [w.dayLabel, w.timeLabel].filter(Boolean).join(' ');
  return { ...w, label };
}

// ---------- Reglas ----------
/** Interpreta la fecha y la franja con reglas. null si el mensaje no habla de cuándo. */
export function parseWhen(text: string, now = new Date()): When | null {
  let t = ` ${fold(expandExpressions(text)).replace(/[¿?¡!,;]/g, ' ').replace(/\s+/g, ' ')} `
    // Muletillas: "12m" y "12 del día" son mediodía; "la de las 3" y "las 3" a secas son una hora.
    .replace(/\b(12|doce)\s*(?:m\b\.?|del dia\b)/g, '12 del mediodia')
    .replace(/\b(?:la|el)\s+de\s+(las?\s+)/g, ' a $1')
    .replace(/^\s*(?:y\s+)?(las\s+\S+|la\s+una\b)/, ' a $1'); // "la 2" a secas es una opción de la lista, no una hora
  const tp = tzParts(now);
  const today: YMD = { y: tp.y, m: tp.m, d: tp.d };
  const out: Omit<When, 'label'> = {};
  const blank = (re: RegExp, fn: (m: RegExpExecArray) => void) => {
    const g = new RegExp(re.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = g.exec(t))) {
      fn(m);
      t = t.slice(0, m.index) + ' '.repeat(m[0].length) + t.slice(m.index + m[0].length);
    }
  };

  // Franja del día (sin consumirla: "de la mañana" también sirve para leer la hora)
  const franja: Franja | undefined = /\b(?:en|por|de|a)\s+la\s+mananita\b|\b(?:en|por|de|a)\s+la\s+manana\b|\b(?:en|por)\s+las\s+mananas\b|(?<!mas\s)\btemprano\b|\btempranito\b|\ba primera hora\b|\bantes\s+del?\s+almuerzo\b/.test(t)
    ? 'manana'
    : /\b(?:al\s+)?medio\s?dia\b|\bmediodia\b/.test(t)
      ? 'mediodia'
      : /\ba ultima hora\b|\bal final del dia\b|\blo mas tarde posible\b/.test(t)
        ? 'ultima'
        : /\b(?:en|por|de|a)\s+la\s+tarde(?:cita)?\b|\b(?:en|por)\s+las\s+tardes\b|\btardecit[ao]\b|\bdespues\s+del?\s+almuerzo\b/.test(t)
          ? 'tarde'
          : /\b(?:en|por|de|a)\s+la\s+noche(?:cita)?\b|\b(?:en|por)\s+las\s+noches\b/.test(t)
            ? 'noche'
            : /\bhoras?\s+del?\s+almuerzo\b|\b(?:en|a|al|durante|para)\s+(?:el\s+)?almuerzo\b/.test(t)
              ? 'almuerzo'
              : undefined;

  // Horas: rangos, "después de", "antes de", "a las"
  let fromMin: number | undefined;
  let toMin: number | undefined;
  let at: number | undefined;
  let timeLabel: string | undefined;
  const hm = (m: RegExpExecArray, i: number) => toMinutes(m[i]!, m[i + 1], m[i + 2], franja);
  blank(new RegExp(String.raw`\b(?:entre|de)\s+(?:las?\s+)?${H}\s+(?:y|a)\s+(?:las?\s+)?${H}`), (m) => {
    const a = hm(m, 1);
    const b = hm(m, 4);
    if (a !== null && b !== null && a < b) {
      fromMin = a;
      toMin = b;
      timeLabel = `entre ${las(a)} y ${las(b)}`;
    }
  });
  blank(new RegExp(String.raw`\b(?:despues\s+de|desde|a\s+partir\s+de)\s+(?:las?\s+)?${H}|\bde\s+las?\s+${H}\s+en\s+adelante`), (m) => {
    const a = m[1] ? hm(m, 1) : hm(m, 4);
    if (a !== null) {
      fromMin = a;
      timeLabel = `después de ${las(a)}`;
    }
  });
  blank(new RegExp(String.raw`\b(?:antes\s+de|hasta)\s+(?:las?\s+)?${H}`), (m) => {
    const b = hm(m, 1);
    if (b !== null) {
      toMin = b;
      timeLabel = timeLabel && fromMin !== undefined ? `entre ${las(fromMin)} y ${las(b)}` : `antes de ${las(b)}`;
    }
  });
  blank(new RegExp(String.raw`\b(?:a|como\s+a|a\s+eso\s+de|sobre|tipo)\s+(?:las?\s+)?${H}(?![\w:])`), (m) => {
    // "a las 4", "tipo 4"; exige "las" o un indicador de hora para no confundir "a 2 cuadras"
    if (!/\blas?\s/.test(m[0]) && !m[3] && !/^tipo/.test(m[0].trim())) return;
    const a = hm(m, 1);
    if (a !== null && fromMin === undefined) {
      fromMin = a;
      at = a;
      timeLabel = `a ${las(a)}`;
    }
  });
  blank(/\b(\d{1,2}(?::\d{2})?)\s*(a\.?\s?m\.?|p\.?\s?m\.?|del mediodia)(?![a-z])|\b(\d{1,2}:\d{2})\b/, (m) => {
    const a = m[1] ? toMinutes(m[1], undefined, m[2], franja) : toMinutes(m[3]!, undefined, undefined, franja);
    if (a !== null && fromMin === undefined) {
      fromMin = a;
      at = a;
      timeLabel = `a ${las(a)}`;
    }
  });
  if (fromMin === undefined && toMin === undefined && franja) {
    const window: Record<Franja, [number, number, string]> = {
      manana: [0, 12 * 60, 'en la mañana'],
      mediodia: [12 * 60, 13 * 60 + 30, 'al mediodía'],
      almuerzo: [12 * 60, 14 * 60, 'a la hora del almuerzo'],
      ultima: [17 * 60, 24 * 60, 'a última hora'],
      tarde: [13 * 60, 19 * 60, 'en la tarde'], // después del almuerzo: las 12 son mediodía
      noche: [18 * 60, 24 * 60, 'en la noche'],
    };
    [fromMin, toMin, timeLabel] = window[franja];
  }
  if (fromMin !== undefined) out.fromMin = fromMin;
  if (toMin !== undefined) out.toMin = toMin;
  if (at !== undefined) out.at = at;
  if (timeLabel) out.timeLabel = timeLabel;

  // Fechas explícitas: "2 de octubre", "octubre 2", "2/10", "el sábado 26", "el 15"
  let date: YMD | null = null;
  const nextOccurrence = (m: number, d: number): YMD | null => {
    const thisYear = validDate(today.y, m, d);
    if (thisYear && keyOf(thisYear) >= keyOf(today)) return thisYear;
    return validDate(today.y + 1, m, d);
  };
  blank(new RegExp(String.raw`\b(\d{1,2})\s+(?:de\s+)?${MONTH}\b|\b${MONTH}\s+(\d{1,2})\b`), (m) => {
    date ??= m[1] ? nextOccurrence(monthNumber(m[2]!), Number(m[1])) : nextOccurrence(monthNumber(m[3]!), Number(m[4]));
  });
  blank(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/, (m) => {
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : undefined;
    date ??= y ? validDate(y, Number(m[2]), Number(m[1])) : nextOccurrence(Number(m[2]), Number(m[1]));
  });
  blank(new RegExp(String.raw`\b(?:(?:el|para\s+el|este|dia)\s+|${WEEKDAY}\s+)(\d{1,2})\b(?!\s*(?::|a\.?\s?m|p\.?\s?m|hrs?\b|horas\b|y\s+media|de\s+la))`), (m) => {
    const d = Number(m[2]);
    if (d < 1 || d > 31) return;
    const thisMonth = validDate(today.y, today.m, d);
    date ??= thisMonth && d >= today.d ? thisMonth : validDate(today.m === 12 ? today.y + 1 : today.y, (today.m % 12) + 1, d);
  });

  // Días relativos. "En ocho días" y "de hoy en ocho" son una semana; "en quince días", dos (se cuenta el día de hoy).
  if (!date) {
    const count = (w: string) => (/^\d+$/.test(w) ? Number(w) : RELATIVE_WORDS[w]);
    const inDays = /\b(?:en|dentro\s+de)\s+(\d{1,2}|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|diez|quince)\s+dias?\b|\bde\s+hoy\s+en\s+(ocho|quince|8|15)\b/.exec(t);
    const inWeeks = /\b(?:en|dentro\s+de)\s+(un|una|dos|tres|1|2|3)\s+semanas?\b/.exec(t);
    if (inDays) {
      const n = count(inDays[1] ?? inDays[2]!);
      if (n !== undefined && n >= 1 && n <= 60) date = addDays(today, n === 8 ? 7 : n === 15 ? 14 : n);
    } else if (inWeeks) {
      const n = count(inWeeks[1]!);
      if (n !== undefined) date = addDays(today, n * 7);
    }
  }
  if (!date) {
    if (/\bpasado\s+manana\b/.test(t)) date = addDays(today, 2);
    else if (/(?<!\b(?:la|las|pasado|de)\s)\bmanana\b/.test(t)) date = addDays(today, 1);
    else if (/\bhoy\b/.test(t)) date = today;
  }
  if (date) {
    out.days = [keyOf(date)];
    out.dayLabel = dayText(date, today);
  }

  // Semanas y días de la semana
  const wd = tp.wd;
  const nextMonday = addDays(today, ((8 - wd) % 7) || 7);
  let range: { from: YMD; to: YMD; label: string } | null = null;
  // "El otro fin de semana" es el de la próxima semana, no este.
  if (/\b(?:(?:la\s+)?(?:proxima|otra|siguiente|entrante)\s+semana|semana\s+(?:que\s+viene|entrante|siguiente))\b|\botro\s+(?:fin(?:de)?\s+de\s+semana|finde)\b/.test(t)) {
    range = { from: nextMonday, to: addDays(nextMonday, 6), label: 'la próxima semana' };
  } else if (/\besta\s+semana\b/.test(t)) {
    range = { from: today, to: addDays(today, (7 - wd) % 7), label: 'esta semana' };
  }
  const weekdays: number[] = [];
  if (/\bfin(?:de)?\s+de\s+semana\b|\bfinde\b/.test(t)) weekdays.push(6, 0);
  const midweek = /\bentre\s+semana\b/.test(t);
  if (midweek) weekdays.push(1, 2, 3, 4, 5);
  for (const m of t.matchAll(new RegExp(String.raw`\b(otro\s+)?${WEEKDAY}\b`, 'g'))) {
    const w = WEEKDAYS.indexOf(m[2]!);
    if (!weekdays.includes(w)) weekdays.push(w);
    if (m[1] && !range) range = { from: nextMonday, to: addDays(nextMonday, 6), label: 'la próxima semana' };
  }
  if (!date) {
    if (weekdays.length) {
      out.weekdays = weekdays;
      out.dayLabel = midweek && weekdays.length === 5 ? 'entre semana' : weekdaysText(weekdays) + (range ? ` de ${range.label}` : '');
    } else if (range) {
      out.dayLabel = range.label;
    }
    if (range) {
      out.from = keyOf(range.from);
      out.to = keyOf(range.to);
    }
  }

  if (!out.days && !out.weekdays && !out.from && out.fromMin === undefined && out.toMin === undefined) return null;
  return finish(out);
}

// "El evento es este viernes", "la boda es el 15", "es para el sábado": esa fecha es la del evento, no la de la cita.
const EVENT_RE =
  /\b(?:el|mi|la|nuestro|nuestra|su)\s+(?:evento|boda|matrimonio|matri|grado|graduacion|fiesta|gala|coctel|celebracion|ceremonia|cumpleanos|quince|aniversario|reunion|cena)\b[^.?!]{0,25}?\b(?:es|sera|va a ser|queda|cae)\b|\bes para (?:el|este|esta|la|manana|pasado manana|hoy)\b/;

/**
 * Si el mensaje dice cuándo es el evento, los espacios para la cita: desde hoy hasta el día antes del evento (o el
 * mismo día, si ya no hay antes). null si el mensaje no habla de la fecha de un evento.
 */
export function eventDeadline(text: string, now = new Date()): When | null {
  if (!EVENT_RE.test(fold(text))) return null;
  const w = parseWhen(text, now);
  if (!w) return null;
  const tp = tzParts(now);
  const today: YMD = { y: tp.y, m: tp.m, d: tp.d };
  let event: YMD | null = null;
  if (w.days?.length) event = fromKey(w.days[0]!);
  else if (w.weekdays?.length === 1) {
    // "este viernes": el próximo (hoy si hoy es viernes); "el viernes de la próxima semana": el de esa semana.
    const start = w.from ? fromKey(w.from) : today;
    const startWd = new Date(Date.UTC(start.y, start.m - 1, start.d)).getUTCDay();
    event = addDays(start, (w.weekdays[0]! - startWd + 7) % 7);
  }
  if (!event) return null;
  let to = addDays(event, -1);
  if (keyOf(to) < keyOf(today)) to = today;
  return finish({ from: keyOf(today), to: keyOf(to), dayLabel: `antes de tu evento (${dayText(event, today)})` });
}

/**
 * Lo nuevo refina lo que ya se había pedido: "al mediodía" después de "mañana" es mañana al mediodía, y "mejor el
 * jueves" después de "en la tarde" es el jueves en la tarde. Cada parte que el cliente no nombra se conserva.
 */
export function refineWhen(prev: When | undefined, next: When): When {
  if (!prev) return next;
  const hasDay = (w: When) => Boolean(w.days || w.weekdays || w.from || w.to);
  const hasTime = (w: When) => w.fromMin !== undefined || w.toMin !== undefined || w.at !== undefined;
  const out: Omit<When, 'label'> = { ...next };
  if (!hasDay(next) && hasDay(prev)) Object.assign(out, { days: prev.days, weekdays: prev.weekdays, from: prev.from, to: prev.to, dayLabel: prev.dayLabel });
  if (!hasTime(next) && hasTime(prev)) Object.assign(out, { fromMin: prev.fromMin, toMin: prev.toMin, at: prev.at, timeLabel: prev.timeLabel });
  return finish(out);
}

// ---------- Respaldo con el modelo ----------
// Palabras que indican que el cliente habla de cuándo, aunque las reglas no lo entiendan ("después del puente").
const TEMPORAL_RE = new RegExp(
  String.raw`\b(semana|mes|quincena|dias|almuerzo|festivo|puente|feriado|fecha|hora|temprano|tarde|noche|manana|mediodia|proxim\w*|siguiente|despues|antes|luego|cumple\w*|navidad|finde|hoy|${WEEKDAYS.join('|')}|${MONTHS.join('|')})\b`,
);
export function mentionsTime(text: string): boolean {
  return TEMPORAL_RE.test(fold(text));
}

const MODEL_SCHEMA: SchemaSpec = {
  properties: [
    { name: 'pide_fecha', type: 'boolean', description: 'true si el cliente pide o propone un día, fecha u hora para la cita' },
    { name: 'fecha_desde', type: 'string', description: 'Primer día aceptable, YYYY-MM-DD, o vacío' },
    { name: 'fecha_hasta', type: 'string', description: 'Último día aceptable, YYYY-MM-DD (igual a fecha_desde si es un solo día), o vacío' },
    { name: 'hora_desde', type: 'string', description: 'Hora mínima de inicio, HH:MM en 24 horas, o vacío' },
    { name: 'hora_hasta', type: 'string', description: 'Hora máxima de inicio, HH:MM en 24 horas, o vacío' },
  ],
};

/** El modelo traduce la frase a un filtro (fechas y horas). Solo se usa si las reglas no entendieron. */
export async function askModelWhen(text: string, opts: { userId?: string; now?: Date } = {}): Promise<When | null> {
  const now = opts.now ?? new Date();
  const tp = tzParts(now);
  const today: YMD = { y: tp.y, m: tp.m, d: tp.d };
  const instructions = `Conviertes lo que un cliente pide para su cita en un rango de fechas y horas. Hoy es ${formatDay(now)} de ${tp.y} (${business.timezone}).
No inventes: si el cliente no pide un día ni una hora, pide_fecha = false y lo demás vacío. Responde SOLO con el JSON.`;
  for (const engine of fallbackOrder(roleEngine('gate')).slice(0, 2)) {
    try {
      const raw = await classify(engine, { sessionId: 'when', instructions, prompt: `Mensaje del cliente: "${text}"`, schema: MODEL_SCHEMA, maxTurns: 1, role: 'gate', task: 'when', userId: opts.userId });
      const r = JSON.parse(raw) as Record<string, unknown>;
      if (!r.pide_fecha) return null;
      const date = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && validDate(...(v.split('-').map(Number) as [number, number, number])) ? v : undefined);
      const time = (v: unknown) => {
        const m = typeof v === 'string' ? /^(\d{1,2}):(\d{2})$/.exec(v) : null;
        return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : undefined;
      };
      let from = date(r.fecha_desde);
      let to = date(r.fecha_hasta) ?? from;
      if (from && to && to < from) [from, to] = [to, from];
      if (from && from < keyOf(today)) from = keyOf(today);
      const fromMin = time(r.hora_desde);
      const toMin = time(r.hora_hasta);
      const out: Omit<When, 'label'> = {};
      if (from && to && from === to) {
        out.days = [from];
        out.dayLabel = dayText(fromKey(from), today);
      } else if (from && to) {
        out.from = from;
        out.to = to;
        out.dayLabel = `entre ${dayText(fromKey(from), today)} y ${dayText(fromKey(to), today)}`;
      }
      if (fromMin !== undefined) out.fromMin = fromMin;
      if (toMin !== undefined && (fromMin === undefined || toMin > fromMin)) out.toMin = toMin;
      if (out.fromMin !== undefined && out.toMin !== undefined) out.timeLabel = `entre ${las(out.fromMin)} y ${las(out.toMin)}`;
      else if (out.fromMin !== undefined) out.timeLabel = `desde ${las(out.fromMin)}`;
      else if (out.toMin !== undefined) out.timeLabel = `antes de ${las(out.toMin)}`;
      if (!out.days && !out.from && out.fromMin === undefined && out.toMin === undefined) return null;
      console.log(`[when] ${engine} interpretó "${text.slice(0, 60)}" → ${[out.dayLabel, out.timeLabel].filter(Boolean).join(' ')}`);
      return finish(out);
    } catch (err) {
      console.warn(`[when] ${engine} falló: ${(err as Error).message}`);
    }
  }
  return null;
}

// ---------- Para el gate ----------
const AVAILABILITY_RE =
  /\b(?:tienen?|tienes|hay|queda|quedan)\s+(?:algun\s+|un\s+)?(?:algo|espacio|cupo|turno|hueco|cita)\b|\bhay\s+(?:\w+\s+)?disponib|\bdisponibilidad\b|\bpuedo\s+(?:ir|pasar|llegar)\b|\bme\s+(?:pueden|puedes)\s+(?:atender|recibir)\b/;

/** "¿tienen espacio el sábado en la tarde?": pregunta por disponibilidad con una fecha o franja. */
export function asksAvailability(text: string): boolean {
  return AVAILABILITY_RE.test(fold(text)) && parseWhen(text) !== null;
}
