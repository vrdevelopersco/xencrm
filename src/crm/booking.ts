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
  nextAppointmentForPerson,
  slotMatches,
  tzParts,
  zoned,
  type Slot,
  type When,
} from './appointments.js';
import { addEvent, getContact, updateContact, type Contact } from './contacts.js';
import { customerLinks } from './calendar.js';
import { askModelWhen, eventDeadline, fold, formatMinutes, mentionsTime, parseWhen, refineWhen, weekdayOfKey } from './when.js';
import { formatPhone, parsePhone, ruleSignals } from './signals.js';
import { alCancelar, anotarIntento, diasParaElEvento, motivoDeCancelar, preguntaQuePaso, respuesta, yaSeIntento } from './retener.js';
import { agendaDe, listaDeSedes, sedeEn, sedePorId, sedes, sedesNombradas, variasSedes, type Agenda, type Sede } from './sedes.js';

const cfg = business.appointments;

export interface BookingState {
  step: 'nombre' | 'sede' | 'elegir' | 'telefono' | 'confirmar' | 'gestionar' | 'cancelar' | 'porque' | 'recordatorio';
  /** En qué sede, si el negocio tiene varias (crm/sedes.ts). Los espacios ofrecidos son de esta. */
  sede?: string;
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
// Preguntas sobre la cita que ya tiene: quiere saber, no cambiar.
const ASK_APPT_RE =
  /\b(?:a\s+qu[eé]\s+hora|qu[eé]\s+hora|cu[aá]ndo|qu[eé]\s+d[ií]a|d[oó]nde|en\s+d[oó]nde|sigue\s+(?:en\s+pie|igual|ah[ií])|qued[oó]\s+(?:en\s+pie|igual)|me\s+confirmas|confirmarme|recu[eé]rdame|me\s+recuerdas|ten[ií]a\s+la\s+cita|es\s+la\s+cita)\b/i;

// ---------- Cambiar o cancelar una cita que ya existe ----------
const CANCEL_APPT_RE = /\b(?:canc[eé]l\w*|anul\w*|ya no (?:voy|puedo ir|podr[eé] ir|asisto|la necesito)|no (?:voy a|podr[eé]|puedo) (?:ir|asistir|llegar)|no alcanzo a (?:ir|llegar))\b/i;
const MOVE_APPT_RE =
  /\b(?:c[aá]mbi\w*|mover(?:la)?|mu[eé]v\w*|reprogram\w*|reagend\w*|correr(?:la)?|c[oó]rre(?:la|mela)|pasar(?:la|mela)?\s+(?:para|al|a)|p[aá]sa(?:la|mela)\s+(?:para|al|a)|aplaz\w*|pospon\w*|posterg\w*|adelant\w*|otro d[ií]a|otra (?:fecha|hora))\b/i;
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
// Lo mismo para escoger sede, que pueden ser más de tres: «la 4», «sede 2».
const SEDE_NUM_RE = /^\s*(?:la\s+|el\s+|sede\s+|opci[oó]n\s+)?([1-9])\b(?!\s*(?:de\s+[a-z]|[/-]\d|:\d|\d|a\.?\s?m|p\.?\s?m))/;
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
const enLugar = (ag: Agenda) => (ag.lugar ? ` en ${ag.lugar}` : '');
const confirmPrompt = (iso: string, lead = 'Listo:', sede?: string | null) => `${lead} ${cfg.service} el ${formatSlot(new Date(iso))}${enLugar(agendaDe(sede))}. ¿Te la confirmo?`;

function listSlots(slots: Slot[]): string {
  return slots.map((s, i) => `${i + 1}) ${formatSlot(s.startsAt)}`).join('\n');
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const hhmm = (s: string) => {
  const [h, m] = s.split(':').map(Number) as [number, number];
  return h * 60 + m;
};
const hoursText = (ag: Agenda) => ag.hours.map(([f, t]) => `de ${formatMinutes(hhmm(f))} a ${formatMinutes(hhmm(t))}`).join(' y ');

/** Por qué no hay espacios para lo que pidió el cliente, dicho como se lo diría una persona. */
function whyNoSlots(w: When, continuing: boolean, ag: Agenda = agendaDe()): string {
  const day = cap(w.dayLabel ?? w.label);
  const days = w.days ?? [];
  // Con varias sedes se dice en cuál: «el sábado no atendemos» sería falso si la otra sí abre.
  const aqui = variasSedes() && ag.sede ? ` en ${ag.sede.nombre}` : '';
  if (w.weekdays && !w.weekdays.some((d) => ag.days.includes(d))) return `${day} no atendemos${aqui}`;
  if (days.length && !days.some((k) => ag.days.includes(weekdayOfKey(k)))) return `${day} no atendemos${aqui}`;
  if (w.fromMin !== undefined || w.toMin !== undefined) {
    const lo = w.fromMin ?? 0;
    const hi = w.toMin ?? 24 * 60;
    const fits = ag.hours.some(([f, t]) => Math.max(lo, hhmm(f)) < Math.min(hi, hhmm(t) - ag.durationMin + 1));
    if (!fits) return `${cap(w.timeLabel ?? w.label)} no atendemos${aqui} (el horario es ${hoursText(ag)})`;
  }
  const tp = tzParts(new Date());
  const horizon = new Date(Date.UTC(tp.y, tp.m - 1, tp.d + ag.maxDaysAhead)).toISOString().slice(0, 10);
  const first = days.length ? days.reduce((a, b) => (a < b ? a : b)) : w.from;
  const last = days.length ? days.reduce((a, b) => (a > b ? a : b)) : w.to;
  if (first && first > horizon) return `${day} todavía no tengo agenda abierta`;
  if (last) {
    const [y, m, d] = last.split('-').map(Number) as [number, number, number];
    const [ch, cm] = ag.hours[ag.hours.length - 1]![1].split(':').map(Number) as [number, number];
    const lastStart = zoned(y, m, d, ch, cm).getTime() - ag.durationMin * 60_000;
    if (lastStart < Date.now() + ag.minLeadHours * 3600_000) return `${day} ya no alcanzo a agendarte${aqui}`;
  }
  return `${cap(w.label)}${aqui} ${continuing ? 'no me quedan más espacios' : 'ya no me quedan espacios'}`;
}

/**
 * Preguntar en cuál sede. Lo que ya se sabía —la fecha que pidió, la cita que se está moviendo— se guarda para
 * seguir con eso apenas diga cuál.
 */
function askSede(c: Contact, opts: { when?: When; moving?: number; lead?: string } = {}): string {
  save(c, { step: 'sede', offered: [], ...(opts.when ? { when: opts.when } : {}), ...(opts.moving ? { moving: opts.moving } : {}) });
  return `${opts.lead ?? ''}¿En cuál de nuestras sedes te queda mejor?\n${listaDeSedes()}`;
}

/** La sede con el espacio libre más pronto para lo que pidió: para «la que sea» o «cualquiera». */
function laMasPronta(when?: When): Sede | null {
  let mejor: { sede: Sede; t: number } | null = null;
  for (const s of sedes()) {
    const t = availableSlots({ count: 1, when, sede: s.id })[0]?.startsAt.getTime();
    if (t !== undefined && (!mejor || t < mejor.t)) mejor = { sede: s, t };
  }
  return mejor?.sede ?? null;
}

function offer(c: Contact, opts: { when?: When; after?: Date; sede?: string | null } = {}): string {
  const { when, after } = opts;
  const prev = state(c);
  const sedeId = opts.sede !== undefined ? opts.sede : (prev?.sede ?? null);
  // Con varias sedes, los espacios son de una: sin saber cuál, primero se pregunta.
  if (variasSedes() && !sedePorId(sedeId)) return askSede(c, { when, moving: prev?.moving });
  let ag = agendaDe(sedeId);
  const multi = variasSedes();
  let slots = availableSlots({ count: 3, when, after, sede: ag.sede?.id });
  let intro: string;
  if (when && slots.length === 0) {
    const reason = whyNoSlots(when, Boolean(after), ag);
    // 🪤 Con varias sedes, primero lo que pidió en OTRA sede: si quería el sábado y la suya no abre los sábados,
    // «la del sur sí tiene el sábado» le sirve más que un martes en la suya. Y se dice, nunca se cambia callado.
    const otra = multi ? sedes().find((s) => s.id !== ag.sede?.id && availableSlots({ count: 1, when, after, sede: s.id }).length) : undefined;
    if (otra) {
      ag = agendaDe(otra.id);
      slots = availableSlots({ count: 3, when, after, sede: otra.id });
      intro = `${reason} 😕 En ${otra.nombre} sí tengo ${when.label}:`;
    } else {
      // Lo más cercano: el mismo día a otra hora, la misma franja otro día, o lo primero libre.
      const tries: (When | undefined)[] = [];
      if (when.fromMin !== undefined || when.toMin !== undefined) tries.push({ ...when, fromMin: undefined, toMin: undefined });
      if (when.days || when.weekdays || when.from) tries.push({ label: when.label, fromMin: when.fromMin, toMin: when.toMin });
      tries.push(undefined);
      for (const t of tries) {
        slots = availableSlots({ count: 3, when: t, after, sede: ag.sede?.id });
        if (slots.length) break;
      }
      intro = `${reason} 😕 Lo más cercano que tengo${multi && ag.sede ? ` en ${ag.sede.nombre}` : ''}:`;
    }
  } else {
    const where = multi && ag.sede ? ` en ${ag.sede.nombre}` : cfg.location ? ` en ${cfg.location}` : '';
    intro = when
      ? pick([`${cap(when.label)}${multi && ag.sede ? ` en ${ag.sede.nombre}` : ''} tengo estos espacios:`, `${cap(when.label)}${multi && ag.sede ? ` en ${ag.sede.nombre}` : ''} te puedo ofrecer:`] as const)
      : pick([
          `Con gusto te agendo la ${cfg.service}${where}. Tengo estos espacios:`,
          `Claro, agendemos tu ${cfg.service}${where}. Te propongo estas opciones:`,
          `Perfecto. Para la ${cfg.service}${where} tengo disponible:`,
        ] as const);
  }
  if (slots.length === 0) {
    // En la suya no queda nada en estos días: si otra sede tiene, se le ofrece en vez de mandarlo a llamar.
    const otra = multi ? sedes().find((s) => s.id !== ag.sede?.id && availableSlots({ count: 1, after, sede: s.id }).length) : undefined;
    if (otra) {
      const lleno = `En ${ag.sede!.nombre} no me quedan espacios ${when ? 'por esas fechas' : 'en estos días'} 😕`;
      return offer(c, { after, sede: otra.id }).replace(/^[^\n]*\n/, `${lleno} En ${otra.nombre} tengo:\n`);
    }
    save(c, null);
    return `Uy, ${when ? 'por esas fechas' : 'en estos días'} no me quedan espacios libres 😕 ${business.business.humanContact} y te ayudan a buscar un hueco.`;
  }
  const moving = prev?.moving;
  save(c, {
    step: 'elegir',
    offered: slots.map((s) => s.startsAt.toISOString()),
    ...(when ? { when } : {}),
    ...(moving ? { moving } : {}),
    ...(ag.sede && sedes().length ? { sede: ag.sede.id } : {}),
  });
  return `${intro}\n${listSlots(slots)}\n¿Cuál te sirve? Si prefieres otro día u hora, dime.`;
}

/** La sede queda en la ficha: la próxima vez se le ofrece esa sin preguntar (y puede cambiarla diciéndolo). */
function recordarSede(userId: string, sede: string | null) {
  const c = getContact(userId);
  if (!c || !sede || c.data.sede === sede) return;
  updateContact(userId, { data: { ...c.data, sede } }, { silent: true });
}

async function book(c: Contact, userId: string, chosen: string): Promise<string> {
  const when = new Date(chosen);
  const st0 = state(c);
  const moving = st0?.moving;
  let links: ReturnType<typeof customerLinks> = null;
  let nueva: ReturnType<typeof bookAppointment>;
  try {
    nueva = bookAppointment(userId, when, { notes: moving ? `Reprogramada por ${business.agent.name}` : `Agendada por ${business.agent.name}`, sede: st0?.sede ?? null });
    links = customerLinks(nueva);
  } catch {
    return `Ese espacio se acaba de ocupar 😕 ` + offer(c);
  }
  save(getContact(userId)!, null);
  recordarSede(userId, nueva.sede);
  const en = nueva.location ? ` en ${nueva.location}` : '';
  // Mover: primero se agenda la nueva y solo después se cancela la anterior, así nunca se queda sin cita.
  const old = moving ? getAppointment(moving) : null;
  if (old && old.status === 'confirmada') {
    noteCrossFicha(old, userId, 'movida');
    updateAppointment(old.id, { status: 'cancelada', notes: `${old.notes ? `${old.notes} · ` : ''}Reprogramada por el cliente desde ${channelName(getContact(userId))}` }, 'bot');
    const fresh = getContact(userId);
    const phone = fresh ? contactPhone(fresh) : null;
    return (
      `¡Listo! Moví tu ${cfg.service} al ${formatSlot(when)}${en}. La del ${formatSlot(new Date(old.startsAt))} quedó cancelada.` +
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
    `¡Agendada${firstName ? `, ${firstName}` : ''}! 🗓️ Te esperamos el ${formatSlot(when)}${en}. Si necesitas cambiarla, me escribes por aquí.`,
    `¡Listo, quedó! Tu ${cfg.service} es el ${formatSlot(when)}${en}. Cualquier cambio, me avisas por aquí 🙂`,
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
  const existing = nextAppointmentForPerson(userId); // aunque la haya agendado por el otro canal
  if (existing) return manageExisting(c, existing.id, text, userId);
  const when = text ? await interpret(text, { model: true, userId }) : null;
  // La sede que nombró («quiero una cita en la del norte»), o en la que agendó la última vez.
  const sede = (text ? sedeEn(text) : null) ?? sedePorId(c.data.sede as string | undefined);
  const name = c.name || (c.data.nombre as string | undefined);
  if (!name) {
    save(c, { step: 'nombre', offered: [], ...(when ? { when } : {}), ...(sede ? { sede: sede.id } : {}) });
    const hello = /^\s*(hola|buenas|buen[oa]s? (d[ií]as?|tardes|noches))\b/i.test(text) ? '¡Hola! ' : '';
    if (when) return `${hello}Con gusto te busco espacio ${when.label}. ¿A nombre de quién agendo la cita?`;
    return hello + pick(['¡Con gusto! ¿A nombre de quién agendo la cita?', 'Claro que sí. Dime tu nombre para agendarla, por favor.'] as const);
  }
  return offer(c, { ...(when ? { when } : {}), sede: sede?.id ?? null });
}

// Canal por donde está escribiendo, para que la cita diga desde dónde la tocaron.
const CHANNEL_NAME: Record<string, string> = { whatsapp: 'WhatsApp', meta: 'WhatsApp', web: 'el chat del sitio' };
const channelName = (c: Contact | null) => (c ? (CHANNEL_NAME[c.channel] ?? 'otro canal') : 'otro canal');

/**
 * La cita puede estar en otra ficha de la misma persona (agendó por el chat del sitio y ahora escribe por
 * WhatsApp). Cuando eso pasa, queda anotado en las dos líneas de tiempo: la ficha donde está la cita no puede
 * quedarse muda, y la ficha desde donde escribió tampoco.
 */
function noteCrossFicha(appt: { id: number; userId: string }, userId: string, what: string) {
  if (appt.userId === userId) return;
  const desde = channelName(getContact(userId));
  addEvent(userId, 'appointment_cross', { id: appt.id, what, ficha: appt.userId });
  addEvent(appt.userId, 'appointment_cross', { id: appt.id, what, desde });
}

const slotOf = (id: number) => {
  const a = getAppointment(id);
  return a ? `${a.service} del ${formatSlot(new Date(a.startsAt))}` : `${cfg.service}`;
};

/** Ya tiene una cita: cancelarla (con confirmación), cambiarla (ofrece espacios) o preguntar qué quiere hacer. */
async function manageExisting(c: Contact, id: number, text: string, userId: string): Promise<string> {
  const intent = manageIntent(text);
  // "¿A qué hora era?", "¿sigue en pie?": está preguntando por su cita, no pidiendo cambiarla.
  if (!intent && ASK_APPT_RE.test(text)) {
    const a = getAppointment(id);
    save(c, { step: 'gestionar', offered: [], manage: id }); // si después dice "cámbiala", sigue el hilo
    return a
      ? `Tu ${a.service} es el ${formatSlot(new Date(a.startsAt))}${a.location ? ` en ${a.location}` : ''}. ¡Te esperamos! Si necesitas cambiarla o cancelarla, me dices.`
      : offerFallback();
  }
  if (intent === 'cancelar') {
    // 🪤 Antes se iba directo a «¿confirmas que cancelo?», y eso pierde citas que no estaban perdidas: mucha
    // gente escribe «cancélala» cuando lo que quiere es moverla. Ahora se pregunta qué pasó, UNA vez y con la
    // salida en el mismo mensaje. Si ya se preguntó por esta cita, se cancela sin más vueltas. Ver crm/retener.ts.
    if (yaSeIntento(c, id)) {
      save(c, { step: 'cancelar', offered: [], manage: id });
      return `¿Confirmas que cancelo tu ${slotOf(id)}?`;
    }
    save(c, { step: 'porque', offered: [], manage: id });
    return preguntaQuePaso(slotOf(id));
  }
  // "¿me confirmas la cita del jueves?" nombra el día de su propia cita: pregunta por ella, no la está moviendo.
  const appt = getAppointment(id);
  const said = text ? parseWhen(text) : null;
  const when = said && appt && slotMatches(new Date(appt.startsAt), said) ? null : said;
  // «Mejor en la del sur»: nombrar otra sede también es moverla. Si no nombra ninguna, se queda en la suya.
  const otraSede = text ? sedeEn(text) : null;
  const cambiaDeSede = Boolean(otraSede && otraSede.id !== appt?.sede);
  if (intent === 'cambiar' || when || cambiaDeSede) {
    save(c, { step: 'elegir', offered: [], moving: id, ...(appt?.sede ? { sede: appt.sede } : {}) });
    return `Claro, busquemos otro espacio para tu ${slotOf(id)}. ` + offer(getContact(userId)!, { ...(when ? { when } : {}), sede: otraSede?.id ?? appt?.sede ?? null });
  }
  save(c, { step: 'gestionar', offered: [], manage: id });
  return `Ya tienes tu ${slotOf(id)}${appt?.location ? ` en ${appt.location}` : ''}. ¿Quieres cambiarla o cancelarla?`;
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
    // «En la del norte»: contestó en cuál sede, no cómo se llama.
    const dicha = sedeEn(text);
    if (dicha && text.trim().split(/\s+/).length <= 6) {
      save(c, { ...st, sede: dicha.id });
      return `Anotado: ${dicha.nombre}. ¿A nombre de quién agendo la cita?`;
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

  if (st.step === 'sede') {
    // «la 2», «la segunda», «la del norte», «la de la 72». Los números aquí son sedes, no horarios: todavía no se
    // ofreció ninguno.
    const ordinal = ORDINAL_RE.exec(t)?.[1];
    const num = SEDE_NUM_RE.exec(t)?.[1] ?? (ordinal ? ORDINALS[ordinal] : undefined);
    const w = readWhen(text);
    const when = w ? refineWhen(st.when, w) : st.when;
    let sede: Sede | null = (num ? sedes()[Number(num) - 1] : undefined) ?? sedeEn(text);
    // «La que sea», «cualquiera»: la que tenga el espacio más pronto, y se le dice cuál quedó.
    if (!sede && ANY_RE.test(t)) sede = laMasPronta(when);
    if (sede) return offer(c, { ...(when ? { when } : {}), sede: sede.id });
    // Nombró dos («no la de la 72, la del norte»): se pregunta otra vez, sin importar lo largo del mensaje.
    if (sedesNombradas(text).length > 1) return askSede(c, { when, moving: st.moving, lead: 'No me quedó claro en cuál. ' });
    if (w) return askSede(c, { when, moving: st.moving, lead: `Anotado: ${w.label}. ` });
    if (t.split(/\s+/).length <= 6 && !/\?/.test(text)) return askSede(c, { when, moving: st.moving, lead: 'Dime el número o el nombre. ' });
    save(c, null);
    return null;
  }

  if (st.step === 'elegir') {
    // «Mejor en la del sur»: otra sede, con lo mismo que había pedido (y lo nuevo que diga en el mismo mensaje).
    const otra = sedeEn(text);
    if (otra && otra.id !== st.sede) {
      const w = readWhen(text);
      return offer(c, { ...(w || st.when ? { when: w ? refineWhen(st.when, w) : st.when } : {}), sede: otra.id });
    }
    const choose = (iso: string | undefined): string => {
      if (!iso) return offer(c, st.when ? { when: st.when } : {});
      if (!isSlotFree(new Date(iso), { sede: st.sede ?? null })) return `Ese espacio se acaba de ocupar 😕 ` + offer(c, st.when ? { when: st.when } : {});
      if (needsPhone(c)) {
        save(c, { ...st, step: 'telefono', chosen: iso });
        return phonePrompt(iso);
      }
      save(c, { ...st, step: 'confirmar', chosen: iso });
      return confirmPrompt(iso, undefined, st.sede);
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
      // 🪤 Esto YA ES el intento, y se anota como tal: contestando al recordatorio el cliente dijo que no podía
      // —o sea que ya explicó— y aquí mismo se le ofrece la alternativa. Si no se anotara, un «cancélala» a
      // continuación le preguntaría «¿y qué pasó?» a alguien que acaba de contarlo. Ver crm/retener.ts.
      updateContact(userId, { data: anotarIntento(getContact(userId)?.data ?? null, appt.id) }, { silent: true });
      save(getContact(userId)!, { step: 'gestionar', offered: [], manage: appt.id });
      return 'Sin problema. ¿La pasamos para otro día o prefieres cancelarla?';
    }
    if (YES_RE.test(t) || COMING_RE.test(t) || same) {
      setCustomerReply(appt.id, 'confirmó');
      save(getContact(userId)!, null);
      return `¡Perfecto! Te esperamos el ${formatSlot(new Date(appt.startsAt))}${appt.location ? ` en ${appt.location}` : ''} 🙂`;
    }
    save(c, null);
    return null;
  }

  // Contestó a «¿qué pasó?». Aquí se decide si se le ofrece algo o se le cancela y ya. Ver crm/retener.ts.
  if (st.step === 'porque') {
    const appt = st.manage ? getAppointment(st.manage) : null;
    if (!appt || appt.status !== 'confirmada') {
      save(c, null);
      return null;
    }
    const slot = formatSlot(new Date(appt.startsAt));

    // Si en vez de un motivo dice una fecha o pide moverla, es lo que queríamos: se mueve y no se insiste.
    const w = parseWhen(text);
    if (MOVE_APPT_RE.test(text) || (w && !slotMatches(new Date(appt.startsAt), w))) {
      save(c, { step: 'elegir', offered: [], moving: appt.id });
      return `Claro, busquemos otro espacio. ` + offer(getContact(userId)!, w ? { when: w } : {});
    }

    const motivo = motivoDeCancelar(text, yaSeIntento(c, appt.id));
    const opciones = availableSlots({ count: 2, spreadDays: true, sede: appt.sede }).map((s) => `el ${formatSlot(s.startsAt)}`);
    const r = respuesta(motivo, { cita: slot, opciones, diasEvento: diasParaElEvento(c) });

    // 🪤 «Cancélala y ya», «no me insistas»: se cancela en el acto, sin la pregunta de confirmación. Volver a
    // preguntar «¿seguro?» a quien acaba de decir que no quiere más vueltas es justo lo que no se debe hacer.
    if (r.cancelar || CANCEL_APPT_RE.test(text)) {
      noteCrossFicha(appt, userId, 'cancelada');
      updateAppointment(appt.id, { status: 'cancelada', notes: `${appt.notes ? `${appt.notes} · ` : ''}Cancelada por el cliente desde ${channelName(c)}` }, 'bot');
      save(getContact(userId)!, null);
      // Con su propia despedida si la trae: a quien se le murió alguien no se le contesta con la frase de
      // siempre. Ver crm/retener.ts.
      return r.texto || alCancelar(appt.service, slot);
    }

    // El único intento queda anotado en la ficha: no hay un segundo, ni hoy ni dentro de un mes.
    if (r.gastaIntento) updateContact(userId, { data: anotarIntento(getContact(userId)?.data ?? null, appt.id) }, { silent: true });
    save(getContact(userId)!, { step: 'gestionar', offered: [], manage: appt.id });
    return r.texto;
  }

  if (st.step === 'gestionar' || st.step === 'cancelar') {
    const appt = st.manage ? getAppointment(st.manage) : null;
    if (!appt || appt.status !== 'confirmada') {
      save(c, null);
      return null;
    }
    const slot = formatSlot(new Date(appt.startsAt));
    // 🪤 Después de que ya se le ofreció algo, pedir cancelar MANDA sobre el sí y el no, y se mira antes que
    // nada. La respuesta natural a «¿la dejamos o te la cancelo?» es «no, cancélala»: empieza por un no, y leída
    // como un no a secas se le contestaba «perfecto, te esperamos» a quien acababa de pedir por SEGUNDA vez que
    // se la cancelaran. Eso es justo la trampa que este flujo existe para no tener.
    //
    // Solo con el intento ya gastado. Sin él seguimos en el camino normal, donde «cancélala» pasa por su
    // confirmación de siempre: es un toque y protege de un mensaje escrito sin querer.
    if (yaSeIntento(c, appt.id) && CANCEL_APPT_RE.test(text)) {
      noteCrossFicha(appt, userId, 'cancelada');
      updateAppointment(appt.id, { status: 'cancelada', notes: `${appt.notes ? `${appt.notes} · ` : ''}Cancelada por el cliente desde ${channelName(c)}` }, 'bot');
      save(getContact(userId)!, null);
      return alCancelar(appt.service, slot);
    }
    if (st.step === 'cancelar') {
      if (YES_RE.test(t) && !CHANGE_RE.test(t)) {
        noteCrossFicha(appt, userId, 'cancelada');
        updateAppointment(appt.id, { status: 'cancelada', notes: `${appt.notes ? `${appt.notes} · ` : ''}Cancelada por el cliente desde ${channelName(c)}` }, 'bot');
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
      return confirmPrompt(chosen, '¡Gracias! Entonces:', st.sede);
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
    // «Sí, pero en la del sur»: el horario elegido era de la otra sede, así que se vuelve a ofrecer en esa.
    const otra = sedeEn(text);
    if (otra && otra.id !== st.sede) return offer(c, { ...(st.when ? { when: st.when } : {}), sede: otra.id });
    // "El evento es el viernes": si el horario elegido ya es antes, se vuelve a pedir el sí; si no, se busca antes.
    const ev = eventDeadline(text);
    if (ev) return slotMatches(new Date(chosen), ev) ? confirmPrompt(chosen, 'Perfecto, queda antes de tu evento.', st.sede) : offer(c, { when: ev });
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
  sede: 'esperaba en cuál sede',
  elegir: 'esperaba que eligiera uno de los horarios',
  telefono: 'esperaba el número de teléfono',
  confirmar: 'esperaba un sí o un no para confirmar',
  gestionar: 'esperaba si cambia, cancela o deja la cita',
  cancelar: 'esperaba que confirmara la cancelación',
  porque: 'esperaba saber por qué quiere cancelar, para ofrecerle moverla',
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
  const sede = sedeEn(text);
  if (sede) return sede.nombre;
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
