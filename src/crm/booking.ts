// Flujo determinista de agendamiento: ofrece espacios reales, entiende la elección y confirma.
// Fechas y horas no se le confían al modelo: "el sábado en la tarde" lo interpretan reglas (crm/when.ts) y, solo si
// no lo entienden, el modelo traduce la frase a un filtro; los espacios siempre salen de la agenda real.
import { business } from '../config.js';
import { pick } from '../agent/prompts.js';
import { expandExpressions } from '../agent/dictionary.js';
import { GREETING_RE } from '../agent/gate.js';
import { noteMiss } from './misses.js';
import {
  availableSlots,
  bookAppointment,
  formatDay,
  getAppointment,
  setCustomerReply,
  updateAppointment,
  formatSlot,
  isSlotFree,
  nextAppointmentFor,
  slotMatches,
  tzParts,
  zoned,
  type Slot,
  type When,
} from './appointments.js';
import { getContact, updateContact, type Contact } from './contacts.js';
import { customerLinks } from './calendar.js';
import { askModelWhen, eventDeadline, fold, formatMinutes, mentionsTime, parseWhen, refineWhen, weekdayOfKey } from './when.js';
import { formatPhone, parsePhone, ruleSignals } from './signals.js';

const cfg = business.appointments;

export interface BookingState {
  step: 'nombre' | 'elegir' | 'telefono' | 'confirmar' | 'gestionar' | 'cancelar' | 'recordatorio';
  /** Cita existente que se está cambiando (al confirmar la nueva, esta se cancela) o gestionando. */
  moving?: number;
  manage?: number;
  offered: string[]; // ISO
  chosen?: string;
  /** Lo que pidió el cliente ("el sábado en la tarde"). */
  when?: When;
}

const YES_RE =
  /^(?:(?:s[ií]+|sisas|dale|ok(?:ay)?|listo|confirm[oa]|confirmad[oa]|de una|claro|obvio|perfecto|va|vale|sale|correcto|as[ií] es|exacto|me sirve|esa|ese|h[aá]gale|bueno|est[aá] bien|ta bien|me parece)\b|👍|👌)/i;
// "bueno, mejor otro día": empieza como un sí pero pide otra cosa. ("sí, no hay problema" sí es un sí.)
const CHANGE_RE = /\b(?:mejor|otr[oa]s?\s+(?:d[ií]a|hora|fecha|opci[oó]n)|cambi\w*|ninguna|no\s+(?:puedo|me sirve|me queda|alcanzo))\b/i;
// Posición en la lista: "la última", "la del medio", "la más temprano", "cuanto antes".
const FIRST_RE = /\b(?:la|el)\s+(?:m[aá]s\s+(?:temprano|pronto|pronta|cercana|cercano))\b|\bcuanto antes\b|\blo (?:m[aá]s )?(?:antes|pronto) (?:posible|que se pueda)\b/i;
const LAST_RE = /\b(?:la|el)\s+(?:[uú]ltim[oa]|m[aá]s\s+tarde|de\s+m[aá]s\s+tarde)\b/i;
const MIDDLE_RE = /\b(?:la|el)\s+del\s+medio\b/i;
// "La que sea", "cualquiera", "me da igual": le sirve cualquiera de la lista; se toma la primera (sobre el texto sin tildes).
const ANY_RE =
  /^(?:(?:si|pues|bueno|ok|listo|dale|ah|no se)[\s,]+)*(?:cualquiera|cualquier\s+(?:hora|dia|opcion)|a\s+cualquier\s+hora|(?:la|el)\s+que\s+(?:sea|haya|tengas|tenga|(?:t[eu]|le)\s+(?:quede|sirva)\s+mejor|me\s+(?:des|de|recomiendes|recomiende)|(?:tu|usted)\s+(?:digas|diga|prefieras|prefiera|quieras|quiera)|digas|diga|prefieras|prefiera|quieras|quiera)|me\s+da\s+(?:igual|lo\s+mismo)|como\s+(?:tu\s+|usted\s+)?(?:quieras|quiera|prefieras|prefiera|veas|vea))\b/;
const NO_RE = /^(no|nop|otra|otro|ninguna|ninguno|cambia|mejor otra|no me sirve|no puedo)\b/i;
const ORDINALS: Record<string, number> = { primera: 1, primero: 1, segunda: 2, segundo: 2, tercera: 3, tercero: 3 };
// "la segunda" es una opción; "a primera hora" o "la segunda semana" no.
const ORDINAL_RE = /\b(primer[ao]|segund[ao]|tercer[ao])\b(?!\s+(?:hora|semana|quincena))/;
const CANCEL_RE = /^(cancel|olv[ií]d|ya no|no quiero)/;

// ---------- Cambiar o cancelar una cita que ya existe ----------
const CANCEL_APPT_RE = /\b(?:canc[eé]l\w*|anul\w*|ya no (?:voy|puedo ir|podr[eé] ir|asisto|la necesito)|no (?:voy a|podr[eé]|puedo) (?:ir|asistir|llegar)|no alcanzo a (?:ir|llegar))\b/i;
const MOVE_APPT_RE =
  /\b(?:cambi\w*|mover(?:la)?|mu[eé]v\w*|reprogram\w*|reagend\w*|correr(?:la)?|c[oó]rre(?:la|mela)|pasar(?:la|mela)?\s+(?:para|al|a)|p[aá]sa(?:la|mela)\s+(?:para|al|a)|aplaz\w*|pospon\w*|posterg\w*|adelant\w*|otro d[ií]a|otra (?:fecha|hora))\b/i;
// Sin estas pistas, "quiero cambiar la talla" no es mover la cita.
const APPT_CONTEXT_RE =
  /\b(?:cita|visita|reserva|hora|fecha|d[ií]a|agenda\w*)\b|\b(?:c[aá]mbi|mov|mu[eé]v|p[aá]s|c[oó]rr|cancel|reprogram|reagend|aplaz|pospon|posterg|adelant)\w*(?:la|mela)\b/i;
// Respuestas al recordatorio: "ahí estaré" confirma; "no puedo", "se me complicó" abre cambiar o cancelar.
const COMING_RE =
  /\b(?:ah[ií] (?:estar[eé]|estaremos|nos vemos|voy|llego)|all[aá] (?:estar[eé]|nos vemos|voy|llego)|nos vemos|cuent[ae]n? conmigo|asistir[eé]|s[ií] voy|voy a ir|ya voy|confirmo|confirmad[oa])\b/i;
const CANT_RE = /\bno (?:puedo|podr[eé]|voy a poder|alcanzo|me queda|creo que (?:pueda|alcance|llegue))\b|\bse me (?:complic|cruz|atraves|present)\w*|\btengo un (?:inconveniente|imprevisto|problema)\b|\bno voy\b/i;
const KEEP_RE = /\b(?:as[ií] est[aá] bien|as[ií] (?:la )?dejamos|d[eé]jala|mantener|nada|ninguna|mejor no|no,? gracias|todo bien)\b/i;
const ANOTHER_RE = /\b(?:otra cita|una m[aá]s|adicional|nueva cita|para otra persona)\b/i;

/**
 * ¿Quiere cancelar o cambiar su cita? `strict` (fuera del flujo) pide contexto para "cambiar": "quiero cambiar
 * la talla" no es mover la cita, "¿la puedo pasar para el jueves?" sí.
 */
export function manageIntent(text: string, opts: { strict?: boolean } = {}): 'cancelar' | 'cambiar' | null {
  if (CANCEL_APPT_RE.test(text)) return 'cancelar';
  if (MOVE_APPT_RE.test(text) && (!opts.strict || APPT_CONTEXT_RE.test(text) || parseWhen(text))) return 'cambiar';
  return null;
}
// "la 2" es una opción; "el 2 de octubre" o "el 2/10" es una fecha.
const OPTION_RE = /^\s*(?:la\s+|el\s+|opci[oó]n\s+)?([1-3])\b(?!\s*(?:de\s+[a-z]|[/-]\d|:\d|a\.?\s?m|p\.?\s?m))/;
// Respuesta a "¿a nombre de quién?" que en realidad es una fecha ("el sábado", "mañana en la tarde").
const WHEN_START_RE = /^(el|la|para|mejor|este|esta|hoy|manana|pasado|entre|despues|antes|a|de|tipo|en|por|\d)\b/;

function state(c: Contact): BookingState | null {
  return (c.data.booking as BookingState | undefined) ?? null;
}
function save(c: Contact, st: BookingState | null) {
  const data = { ...c.data };
  if (st) data.booking = st;
  else delete data.booking;
  updateContact(c.id, { data }, { silent: true });
}

/** Número con el que se le confirma: el que dio o el de su WhatsApp (la dirección @s.whatsapp.net o de Meta es el número). */
function contactPhone(c: Contact): string | null {
  if (c.phone) return parsePhone(c.phone) ?? c.phone;
  const m = /^(?:wa:(\d{8,15})@s\.whatsapp\.net|meta:(\d{8,15}))$/.exec(c.id);
  return m ? `+${m[1] ?? m[2]}` : null;
}
const needsPhone = (c: Contact) => cfg.askPhone && !contactPhone(c);
const REFUSE_RE = /^(no|nop|prefiero no|mejor no|no quiero|no tengo)\b|\bsin (n[uú]mero|tel[eé]fono)\b/i;

function phonePrompt(iso: string): string {
  return `Perfecto, el ${formatSlot(new Date(iso))}. Para confirmarte y avisarte cualquier cambio, ¿a qué número te escribimos?${cfg.askEmail ? ' Si quieres, déjame también tu correo (es opcional).' : ''}`;
}
const confirmPrompt = (iso: string, lead = 'Listo:') => `${lead} ${cfg.service} el ${formatSlot(new Date(iso))}${cfg.location ? ` en ${cfg.location}` : ''}. ¿Te la confirmo?`;

function listSlots(slots: Slot[]): string {
  return slots.map((s, i) => `${i + 1}) ${formatSlot(s.startsAt)}`).join('\n');
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const hhmm = (s: string) => {
  const [h, m] = s.split(':').map(Number) as [number, number];
  return h * 60 + m;
};
const hoursText = () => cfg.hours.map(([f, t]) => `de ${formatMinutes(hhmm(f))} a ${formatMinutes(hhmm(t))}`).join(' y ');

/** Por qué no hay espacios para lo que pidió el cliente, dicho como se lo diría una persona. */
function whyNoSlots(w: When, continuing: boolean): string {
  const day = cap(w.dayLabel ?? w.label);
  const days = w.days ?? [];
  if (w.weekdays && !w.weekdays.some((d) => cfg.days.includes(d))) return `${day} no atendemos`;
  if (days.length && !days.some((k) => cfg.days.includes(weekdayOfKey(k)))) return `${day} no atendemos`;
  if (w.fromMin !== undefined || w.toMin !== undefined) {
    const lo = w.fromMin ?? 0;
    const hi = w.toMin ?? 24 * 60;
    const fits = cfg.hours.some(([f, t]) => Math.max(lo, hhmm(f)) < Math.min(hi, hhmm(t) - cfg.durationMin + 1));
    if (!fits) return `${cap(w.timeLabel ?? w.label)} no atendemos (el horario es ${hoursText()})`;
  }
  const tp = tzParts(new Date());
  const horizon = new Date(Date.UTC(tp.y, tp.m - 1, tp.d + cfg.maxDaysAhead)).toISOString().slice(0, 10);
  const first = days.length ? days.reduce((a, b) => (a < b ? a : b)) : w.from;
  const last = days.length ? days.reduce((a, b) => (a > b ? a : b)) : w.to;
  if (first && first > horizon) return `${day} todavía no tengo agenda abierta`;
  if (last) {
    const [y, m, d] = last.split('-').map(Number) as [number, number, number];
    const [ch, cm] = cfg.hours[cfg.hours.length - 1]![1].split(':').map(Number) as [number, number];
    const lastStart = zoned(y, m, d, ch, cm).getTime() - cfg.durationMin * 60_000;
    if (lastStart < Date.now() + cfg.minLeadHours * 3600_000) return `${day} ya no alcanzo a agendarte`;
  }
  return `${cap(w.label)} ${continuing ? 'no me quedan más espacios' : 'ya no me quedan espacios'}`;
}

function offer(c: Contact, opts: { when?: When; after?: Date } = {}): string {
  const { when, after } = opts;
  let slots = availableSlots({ count: 3, when, after });
  let intro: string;
  if (when && slots.length === 0) {
    // Lo más cercano: el mismo día a otra hora, la misma franja otro día, o lo primero libre.
    const reason = whyNoSlots(when, Boolean(after));
    const tries: (When | undefined)[] = [];
    if (when.fromMin !== undefined || when.toMin !== undefined) tries.push({ ...when, fromMin: undefined, toMin: undefined });
    if (when.days || when.weekdays || when.from) tries.push({ label: when.label, fromMin: when.fromMin, toMin: when.toMin });
    tries.push(undefined);
    for (const t of tries) {
      slots = availableSlots({ count: 3, when: t, after });
      if (slots.length) break;
    }
    intro = `${reason} 😕 Lo más cercano que tengo:`;
  } else {
    const where = cfg.location ? ` en ${cfg.location}` : '';
    intro = when
      ? pick([`${cap(when.label)} tengo estos espacios:`, `${cap(when.label)} te puedo ofrecer:`] as const)
      : pick([
          `Con gusto te agendo la ${cfg.service}${where}. Tengo estos espacios:`,
          `Claro, agendemos tu ${cfg.service}${where}. Te propongo estas opciones:`,
          `Perfecto. Para la ${cfg.service}${where} tengo disponible:`,
        ] as const);
  }
  if (slots.length === 0) {
    save(c, null);
    return `Uy, ${when ? 'por esas fechas' : 'en estos días'} no me quedan espacios libres 😕 ${business.business.humanContact} y te ayudan a buscar un hueco.`;
  }
  const moving = state(c)?.moving;
  save(c, { step: 'elegir', offered: slots.map((s) => s.startsAt.toISOString()), ...(when ? { when } : {}), ...(moving ? { moving } : {}) });
  return `${intro}\n${listSlots(slots)}\n¿Cuál te sirve? Si prefieres otro día u hora, dime.`;
}

async function book(c: Contact, userId: string, chosen: string): Promise<string> {
  const when = new Date(chosen);
  const moving = state(c)?.moving;
  let links: ReturnType<typeof customerLinks> = null;
  try {
    links = customerLinks(bookAppointment(userId, when, { notes: moving ? `Reprogramada por ${business.agent.name}` : `Agendada por ${business.agent.name}` }));
  } catch {
    return `Ese espacio se acaba de ocupar 😕 ` + offer(c);
  }
  save(getContact(userId)!, null);
  // Mover: primero se agenda la nueva y solo después se cancela la anterior, así nunca se queda sin cita.
  const old = moving ? getAppointment(moving) : null;
  if (old && old.status === 'confirmada') {
    updateAppointment(old.id, { status: 'cancelada', notes: `${old.notes ? `${old.notes} · ` : ''}Reprogramada por el cliente` }, 'bot');
    const fresh = getContact(userId);
    const phone = fresh ? contactPhone(fresh) : null;
    return (
      `¡Listo! Moví tu ${cfg.service} al ${formatSlot(when)}${cfg.location ? ` en ${cfg.location}` : ''}. La del ${formatSlot(new Date(old.startsAt))} quedó cancelada.` +
      (phone && !/^(wa|meta):/.test(userId) ? `\nSi hay alguna novedad, te escribimos al ${formatPhone(phone)}.` : '') +
      (links ? `\nPara guardarla en tu calendario: ${links.page}` : '')
    );
  }
  const fresh = getContact(userId);
  const firstName = (fresh?.name ?? '').split(' ')[0];
  const phone = fresh ? contactPhone(fresh) : null;
  const calendarLine = (phone && !/^(wa|meta):/.test(userId) ? `\nSi hay alguna novedad, te escribimos al ${formatPhone(phone)}.` : '') + (links ? `\nPara guardarla en tu calendario: ${links.page}` : '');
  return (
    pick([
    `¡Agendada${firstName ? `, ${firstName}` : ''}! 🗓️ Te esperamos el ${formatSlot(when)}${cfg.location ? ` en ${cfg.location}` : ''}. Si necesitas cambiarla, me escribes por aquí.`,
    `¡Listo, quedó! Tu ${cfg.service} es el ${formatSlot(when)}${cfg.location ? ` en ${cfg.location}` : ''}. Cualquier cambio, me avisas por aquí 🙂`,
    ] as const) + calendarLine
  );
}

/** La fecha del mensaje para la cita. "El evento es el viernes" no es la cita del viernes: es antes del evento. */
function readWhen(text: string): When | null {
  return eventDeadline(text) ?? parseWhen(text);
}

/**
 * Fecha o franja del mensaje: reglas primero; el modelo solo si habla de tiempo y las reglas no entendieron.
 * Lo que entendió el modelo queda en "frases que no entendimos" para enseñárselo a las reglas.
 */
async function interpret(text: string, opts: { model: boolean; userId?: string }): Promise<When | null> {
  const byRule = readWhen(text);
  if (byRule || !opts.model || !mentionsTime(text)) return byRule;
  const byModel = await askModelWhen(text, { userId: opts.userId });
  if (byModel && opts.userId) noteMiss(opts.userId, 'fecha', text, { reading: byModel.label, suggestion: byModel.label });
  return byModel;
}

async function start(userId: string, text = ''): Promise<string> {
  const c = getContact(userId);
  if (!c) return offerFallback();
  if (!cfg.enabled) return offerFallback();
  const existing = nextAppointmentFor(userId);
  if (existing) return manageExisting(c, existing.id, text, userId);
  const when = text ? await interpret(text, { model: true, userId }) : null;
  const name = c.name || (c.data.nombre as string | undefined);
  if (!name) {
    save(c, { step: 'nombre', offered: [], ...(when ? { when } : {}) });
    const hello = /^\s*(hola|buenas|buen[oa]s? (d[ií]as?|tardes|noches))\b/i.test(text) ? '¡Hola! ' : '';
    if (when) return `${hello}Con gusto te busco espacio ${when.label}. ¿A nombre de quién agendo la cita?`;
    return hello + pick(['¡Con gusto! ¿A nombre de quién agendo la cita?', 'Claro que sí. Dime tu nombre para agendarla, por favor.'] as const);
  }
  return offer(c, when ? { when } : {});
}

const slotOf = (id: number) => {
  const a = getAppointment(id);
  return a ? `${a.service} del ${formatSlot(new Date(a.startsAt))}` : `${cfg.service}`;
};

/** Ya tiene una cita: cancelarla (con confirmación), cambiarla (ofrece espacios) o preguntar qué quiere hacer. */
async function manageExisting(c: Contact, id: number, text: string, userId: string): Promise<string> {
  const intent = manageIntent(text);
  if (intent === 'cancelar') {
    save(c, { step: 'cancelar', offered: [], manage: id });
    return `¿Confirmas que cancelo tu ${slotOf(id)}?`;
  }
  const when = text ? parseWhen(text) : null;
  if (intent === 'cambiar' || when) {
    save(c, { step: 'elegir', offered: [], moving: id });
    return `Claro, busquemos otro espacio para tu ${slotOf(id)}. ` + offer(getContact(userId)!, when ? { when } : {});
  }
  save(c, { step: 'gestionar', offered: [], manage: id });
  return `Ya tienes tu ${slotOf(id)}${cfg.location ? ` en ${cfg.location}` : ''}. ¿Quieres cambiarla o cancelarla?`;
}

function offerFallback(): string {
  return `Para agendar una cita, ${business.business.humanContact}`;
}

async function step(userId: string, text: string): Promise<string | null> {
  const c = getContact(userId);
  const st = c ? state(c) : null;
  if (!c || !st) return null;
  const t = fold(expandExpressions(text.trim())); // "la que sea" → lo que el negocio enseñó (p. ej. "la primera")

  if (st.step === 'nombre') {
    const ev = eventDeadline(text);
    if (ev) {
      save(c, { ...st, when: ev });
      return `Anotado: te busco espacio ${ev.label}. ¿A nombre de quién agendo la cita?`;
    }
    const w = parseWhen(text);
    if (w && (WHEN_START_RE.test(t) || w.timeLabel)) {
      save(c, { ...st, when: w });
      return `Anotado: ${w.label}. ¿A nombre de quién agendo la cita?`;
    }
    // "Arnulfo Dominguez 300 123 4567": el número y el correo que vengan con el nombre se guardan aparte.
    const phone = parsePhone(text);
    const email = ruleSignals([text]).correo;
    const bare = text.replace(/\+?\d[\d\s().-]{6,}\d/g, ' ').replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, ' ').replace(/\s+/g, ' ').trim();
    const words = bare.split(/\s+/);
    if (words.length > 5 || /\?/.test(text) || bare.length < 2) {
      save(c, null);
      return null;
    }
    const name = bare
      .replace(/^(soy|me llamo|mi nombre es|a nombre de)\s+/i, '')
      .replace(/[.!,;]+$/, '');
    updateContact(c.id, { name, ...(phone ? { phone } : {}), data: { ...c.data, nombre: name, ...(email ? { correo: email } : {}) } }, { silent: true });
    const fresh = getContact(userId)!;
    return `Gracias, ${name.split(' ')[0]}. ` + offer(fresh, st.when ? { when: st.when } : {});
  }

  if (st.step === 'elegir') {
    const choose = (iso: string | undefined): string => {
      if (!iso) return offer(c, st.when ? { when: st.when } : {});
      if (!isSlotFree(new Date(iso))) return `Ese espacio se acaba de ocupar 😕 ` + offer(c, st.when ? { when: st.when } : {});
      if (needsPhone(c)) {
        save(c, { ...st, step: 'telefono', chosen: iso });
        return phonePrompt(iso);
      }
      save(c, { ...st, step: 'confirmar', chosen: iso });
      return confirmPrompt(iso);
    };
    const ordinal = ORDINAL_RE.exec(t)?.[1];
    const num = OPTION_RE.exec(t)?.[1] ?? (ordinal ? ORDINALS[ordinal] : undefined);
    if (num) return choose(st.offered[Number(num) - 1]);
    if (FIRST_RE.test(t)) return choose(st.offered[0]);
    if (LAST_RE.test(t)) return choose(st.offered[st.offered.length - 1]);
    if (MIDDLE_RE.test(t) && st.offered.length === 3) return choose(st.offered[1]);
    const w = readWhen(text);
    if (w) {
      // Primero entre lo que ya se ofreció: "al mediodía" con un espacio de 12:00 en la lista es ese espacio.
      const matches = st.offered.filter((iso) => slotMatches(new Date(iso), w));
      if (matches.length === 1) return choose(matches[0]);
      if (matches.length > 1) {
        save(c, { ...st, offered: matches });
        return `${cap(w.label)} tengo estas:\n${listSlots(matches.map((iso) => ({ startsAt: new Date(iso), endsAt: new Date(iso) })))}\n¿Cuál prefieres?`;
      }
      return offer(c, { when: refineWhen(st.when, w) });
    }
    if (ANY_RE.test(t)) return choose(st.offered[0]); // después de las fechas: "cualquiera, pero el jueves" pide el jueves
    if (/m[aá]s temprano/.test(t) && st.offered.length) {
      // Antes de lo ofrecido, el mismo día o franja que ya se había pedido.
      const first = tzParts(new Date(Math.min(...st.offered.map((iso) => new Date(iso).getTime()))));
      const minute = first.hh * 60 + first.mm;
      return offer(c, { when: refineWhen(st.when, { toMin: minute, timeLabel: `antes de ${formatMinutes(minute)}`, label: '' }) });
    }
    if (CANCEL_RE.test(t)) {
      save(c, null);
      return 'Sin problema, lo dejamos para cuando quieras. ¿Te ayudo con algo más?';
    }
    // "otra", "más tarde": los siguientes espacios. Si trae más ("después del puente"), primero se interpreta.
    const wantsOther = NO_RE.test(t) || /otr[oa]s? (d[ií]a|fecha|hora|opci)/.test(t) || /m[aá]s tarde|m[aá]s temprano|despu[eé]s/.test(t);
    const last = st.offered[st.offered.length - 1];
    // Los siguientes espacios, dentro de lo que ya se había pedido ("mañana", "en la tarde").
    const next = () => offer(c, { when: st.when, after: last ? new Date(new Date(last).getTime() + 60_000) : undefined });
    if (wantsOther && (t.split(/\s+/).length <= 4 || !mentionsTime(text))) return next();
    // "Sí" sin decir cuál: con un solo horario ofrecido es ese; con varios, se pregunta (nunca se da por agendada).
    if (YES_RE.test(t) && !CHANGE_RE.test(t) && t.split(/\s+/).length <= 4 && st.offered.length) {
      if (st.offered.length === 1) return choose(st.offered[0]);
      return `¿Cuál de estos te sirve? Dime el número:\n${listSlots(st.offered.map((iso) => ({ startsAt: new Date(iso), endsAt: new Date(iso) })))}`;
    }
    const guessed = await interpret(text, { model: true, userId });
    if (guessed) return offer(c, { when: refineWhen(st.when, guessed) });
    if (wantsOther) return next();
    // No parece parte del flujo: el agente responde y el flujo queda pausado.
    save(c, null);
    return null;
  }

  if (st.step === 'recordatorio') {
    const appt = st.manage ? getAppointment(st.manage) : null;
    if (!appt || appt.status !== 'confirmada') {
      save(c, null);
      return null;
    }
    const w = parseWhen(text);
    const same = w ? slotMatches(new Date(appt.startsAt), w) : false;
    // "Cancélala", "mejor el jueves": lo mismo que con cualquier cita ("sí, el martes" con la cita el martes confirma).
    if (/\b(?:cancel|anul)/.test(t) || (w && !same) || MOVE_APPT_RE.test(text)) return manageExisting(c, appt.id, text, userId);
    if (CANT_RE.test(t) || NO_RE.test(t)) {
      setCustomerReply(appt.id, 'no_puede');
      save(getContact(userId)!, { step: 'gestionar', offered: [], manage: appt.id });
      return 'Sin problema. ¿La pasamos para otro día o prefieres cancelarla?';
    }
    if (YES_RE.test(t) || COMING_RE.test(t) || same) {
      setCustomerReply(appt.id, 'confirmó');
      save(getContact(userId)!, null);
      return `¡Perfecto! Te esperamos el ${formatSlot(new Date(appt.startsAt))}${cfg.location ? ` en ${cfg.location}` : ''} 🙂`;
    }
    save(c, null);
    return null;
  }

  if (st.step === 'gestionar' || st.step === 'cancelar') {
    const appt = st.manage ? getAppointment(st.manage) : null;
    if (!appt || appt.status !== 'confirmada') {
      save(c, null);
      return null;
    }
    const slot = formatSlot(new Date(appt.startsAt));
    if (st.step === 'cancelar') {
      if (YES_RE.test(t) && !CHANGE_RE.test(t)) {
        updateAppointment(appt.id, { status: 'cancelada', notes: `${appt.notes ? `${appt.notes} · ` : ''}Cancelada por el cliente por chat` }, 'bot');
        save(getContact(userId)!, null);
        return `Listo, cancelé tu ${appt.service} del ${slot}. Si quieres agendar otra, me escribes por aquí 🙂`;
      }
      if (NO_RE.test(t) || KEEP_RE.test(t)) {
        save(c, null);
        return `Perfecto, la dejamos como está: te esperamos el ${slot} 🙂`;
      }
    } else {
      if (ANOTHER_RE.test(t)) {
        save(c, null);
        return offer(getContact(userId)!); // otra cita además de la que ya tiene
      }
      if (KEEP_RE.test(t) || NO_RE.test(t)) {
        save(c, null);
        return `Perfecto, te esperamos el ${slot} 🙂`;
      }
    }
    const intent = manageIntent(text);
    if (intent || parseWhen(text)) return manageExisting(c, appt.id, text, userId);
    save(c, null);
    return null;
  }

  if (st.step === 'telefono') {
    const chosen = st.chosen!;
    const phone = parsePhone(text);
    const email = cfg.askEmail ? ruleSignals([text]).correo : undefined;
    if (email) updateContact(c.id, { data: { ...c.data, correo: email } }, { silent: true });
    if (phone) {
      updateContact(c.id, { phone }, { silent: true });
      save(getContact(userId)!, { ...st, step: 'confirmar' });
      return confirmPrompt(chosen, '¡Gracias! Entonces:');
    }
    if (email) return 'Anotado tu correo. ¿Y a qué número te escribimos para confirmarte?';
    if (/\d{5,}/.test(text.replace(/\D/g, ''))) return 'Ese número no me cuadra 🤔 ¿Me lo pasas completo? Por ejemplo: 300 123 4567';
    if (REFUSE_RE.test(t)) {
      save(c, null);
      return `Sin un número no podemos confirmarte la cita 😕 Si prefieres, ${business.business.humanContact}`;
    }
    const w = readWhen(text);
    if (w) return offer(c, { when: refineWhen(st.when, w) }); // cambió de idea sobre el horario (o dijo cuándo es el evento)
    // Una respuesta corta que no es un número ("1", "ok"): se vuelve a pedir, sin perder el horario elegido.
    if (t.split(/\s+/).length <= 3 && !/\?/.test(text)) return `Para confirmarte la cita del ${formatSlot(new Date(chosen))}, ¿a qué número te escribimos? Por ejemplo: 300 123 4567`;
    save(c, null);
    return null;
  }

  if (st.step === 'confirmar') {
    const chosen = st.chosen!;
    // "El evento es el viernes": si el horario elegido ya es antes, se vuelve a pedir el sí; si no, se busca antes.
    const ev = eventDeadline(text);
    if (ev) return slotMatches(new Date(chosen), ev) ? confirmPrompt(chosen, 'Perfecto, queda antes de tu evento.') : offer(c, { when: ev });
    const w = parseWhen(text);
    // "sí, pero mejor a las 5": pide otra cosa. "sí, el sábado" con el sábado elegido: confirma.
    if (w) return slotMatches(new Date(chosen), w) ? book(c, userId, chosen) : offer(c, { when: refineWhen(st.when, w) });
    if (YES_RE.test(t) && !CHANGE_RE.test(t)) return book(c, userId, chosen);
    if (CANCEL_RE.test(t)) {
      save(c, null);
      return 'Sin problema, lo dejamos para cuando quieras. ¿Te ayudo con algo más?';
    }
    const next = () => offer(c, { when: st.when, after: new Date(new Date(chosen).getTime() + 60_000) });
    if (NO_RE.test(t) && (t.split(/\s+/).length <= 4 || !mentionsTime(text))) return next();
    const guessed = await interpret(text, { model: true, userId });
    if (guessed) return offer(c, { when: refineWhen(st.when, guessed) });
    if (NO_RE.test(t) || CHANGE_RE.test(t)) return next();
    save(c, null);
    return null;
  }
  return null;
}

// "11:00 a. m.." al cerrar la frase con una hora: un solo punto.
const tidy = (s: string) => s.replace(/([ap])\. m\.\./g, '$1. m.');

/** Inicia el flujo (intención "cita"); si el mensaje ya trae fecha o franja, ofrece según eso; si ya tiene cita, la gestiona. */
export async function startBooking(userId: string, text = ''): Promise<string> {
  return tidy(await start(userId, text));
}

/**
 * Procesa un mensaje mientras hay un flujo de cita en curso.
 * Devuelve la respuesta, o null si el mensaje no encaja en el flujo (el agente lo atiende normalmente).
 */
export async function bookingStep(userId: string, text: string): Promise<string | null> {
  const c = getContact(userId);
  const was = c ? state(c) : null;
  const r = await step(userId, text);
  // Una respuesta corta que no encajó ("la que sea", "hágale") sacó al cliente del flujo: queda para enseñarla.
  // Las preguntas y las cortesías salen del flujo a propósito.
  if (r === null && was && was.step !== 'nombre' && text.trim().length <= 60 && !/\?/.test(text) && !GREETING_RE.test(text.trim()))
    noteMiss(userId, 'cita', text, { reading: EXPECTED[was.step] });
  return r === null ? null : tidy(r);
}

const EXPECTED: Record<BookingState['step'], string> = {
  nombre: 'esperaba el nombre',
  elegir: 'esperaba que eligiera uno de los horarios',
  telefono: 'esperaba el número de teléfono',
  confirmar: 'esperaba un sí o un no para confirmar',
  gestionar: 'esperaba si cambia, cancela o deja la cita',
  cancelar: 'esperaba que confirmara la cancelación',
  recordatorio: 'esperaba que confirmara si viene a la cita',
};

/**
 * Después de enviar el recordatorio, la respuesta del cliente ("sí, ahí estaré", "no puedo") se lee como respuesta a
 * él. No pisa un flujo de cita que ya esté en curso.
 */
export function awaitReminderReply(userId: string, appointmentId: number): void {
  const c = getContact(userId);
  if (c && !state(c)) save(c, { step: 'recordatorio', offered: [], manage: appointmentId });
}

/** Qué entiende el flujo de la cita en una respuesta, sin importar el paso: para comprobar lo que se le enseña. */
export function bookingReading(text: string): string | null {
  const t = fold(expandExpressions(text.trim()));
  const ordinal = ORDINAL_RE.exec(t)?.[1];
  const num = OPTION_RE.exec(t)?.[1] ?? (ordinal ? ORDINALS[ordinal] : undefined);
  if (num) return `la opción ${num}`;
  if (FIRST_RE.test(t)) return 'la primera opción';
  if (LAST_RE.test(t)) return 'la última opción';
  if (MIDDLE_RE.test(t)) return 'la opción del medio';
  const w = parseWhen(text);
  if (w) return w.label;
  if (ANY_RE.test(t)) return 'cualquiera: la primera opción';
  if (CANCEL_RE.test(t)) return 'dejar la cita para después';
  if (KEEP_RE.test(t)) return 'dejar la cita como está';
  if (YES_RE.test(t) && !CHANGE_RE.test(t)) return 'sí';
  if (NO_RE.test(t)) return 'no, otra opción';
  return null;
}

export function hasBookingInProgress(userId: string): boolean {
  const c = getContact(userId);
  return Boolean(c && state(c));
}

export function describeDay(d: Date) {
  return formatDay(d);
}
