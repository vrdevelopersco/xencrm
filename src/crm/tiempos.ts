// Cuánto se tarda en contestar. Es la medida que un negocio siente antes que ninguna otra: quien escribe y no
// recibe respuesta en un rato se va, y nadie se entera de que se fue.
//
// Todo sale de lo que ya está guardado —cada mensaje sabe quién lo escribió y cuándo—, así que esto no necesita
// ninguna tabla nueva ni nada corriendo de noche. Se puede mirar hacia atrás desde el primer día.
//
// Tres decisiones que cambian lo que dicen los números:
//
//  1. **Se mide la espera, no el mensaje.** Si alguien escribe cinco mensajes seguidos y se le contesta una vez,
//     eso es UNA espera de quince minutos, no cinco de tres. Se cuenta desde el primero sin responder.
//  2. 🪤 **El reloj se para fuera del horario.** Un mensaje del sábado a las once de la noche contestado el lunes
//     a las nueve no son 34 horas de mala atención: son diez minutos. Sin esto, cualquier acuerdo de servicio
//     sale incumplido los lunes y el número deja de mirarse. Se puede pedir el tiempo corrido, pero el que vale
//     para juzgar es el hábil.
//  3. **Quién contestó importa.** Xen respondiendo en cuatro segundos y una persona en veinte minutos son dos
//     cosas distintas y se miran por separado; mezclarlas esconde justo lo que hay que ver.
import { business } from '../config.js';
import { getDb } from '../rag/store.js';

const DIA = 86400_000;

/** Quién cerró la espera. */
export type Quien = 'xencrm' | 'persona';

export interface Espera {
  userId: string;
  /** Cuándo escribió el cliente y se quedó esperando. */
  desde: number;
  /** Cuándo le contestaron; null si sigue esperando ahora mismo. */
  hasta: number | null;
  /** Tiempo corrido. */
  ms: number;
  /** Tiempo dentro del horario de atención: el que vale para juzgar. */
  msHabiles: number;
  quien: Quien | null;
  /** Nombre de quien contestó, cuando fue una persona. */
  por: string | null;
  /** Cuántos mensajes seguidos mandó antes de que le contestaran. */
  mensajes: number;
}

// ---------- El horario del negocio ----------

/** Partes de una fecha en la zona del negocio. */
function enLaZona(ts: number, zona = business.timezone): { anio: number; mes: number; dia: number; minutos: number; diaSemana: number } {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  }).formatToParts(new Date(ts));
  const parte = (t: string) => f.find((p) => p.type === t)?.value ?? '0';
  const dias: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    anio: Number(parte('year')),
    mes: Number(parte('month')),
    dia: Number(parte('day')),
    minutos: (Number(parte('hour')) % 24) * 60 + Number(parte('minute')),
    diaSemana: dias[parte('weekday')] ?? 0,
  };
}

/** El instante de un minuto concreto de un día concreto, en la zona del negocio. */
function instante(base: number, minutosDelDia: number): number {
  const p = enLaZona(base);
  return base + (minutosDelDia - p.minutos) * 60_000;
}

const aMinutos = (hhmm: string): number => {
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m ?? 0);
};

/** El horario que se usa para medir: el de atención del negocio. Sin franjas definidas, se cuenta todo. */
export function horarioDelNegocio(): { dias: number[]; franjas: [number, number][] } {
  const a = business.appointments;
  const franjas = (a.hours ?? []).map((f) => [aMinutos(f[0]), aMinutos(f[1])] as [number, number]).filter((f) => f[1] > f[0]);
  return { dias: a.days ?? [1, 2, 3, 4, 5], franjas };
}

/**
 * Los milisegundos entre dos instantes que caen dentro del horario de atención. Si el negocio no tiene horario
 * declarado, devuelve el tiempo corrido: mejor eso que inventar una jornada que nadie dijo.
 */
export function msHabiles(desde: number, hasta: number, horario = horarioDelNegocio()): number {
  if (hasta <= desde) return 0;
  if (!horario.franjas.length) return hasta - desde;
  // Más de dos meses esperando no es una espera: es una conversación abandonada. Se corta para no recorrer años.
  const tope = Math.min(hasta, desde + 62 * DIA);
  let total = 0;
  for (let t = desde; t < tope; ) {
    const p = enLaZona(t);
    const medianoche = instante(t, 0);
    if (horario.dias.includes(p.diaSemana)) {
      for (const [ini, fin] of horario.franjas) {
        const a = Math.max(desde, medianoche + ini * 60_000);
        const b = Math.min(tope, medianoche + fin * 60_000);
        if (b > a) total += b - a;
      }
    }
    t = medianoche + DIA + 3600_000; // +1 h de colchón por los cambios de hora
    t = instante(t, 0);
  }
  return total;
}

/**
 * El instante en que se cumplen `ms` de tiempo hábil contados desde `desde`: el vencimiento de un plazo que solo
 * corre dentro del horario (el SLA de un ticket en horas hábiles, crm/tickets.ts). Es lo inverso de msHabiles:
 * msHabiles(desde, sumarHabiles(desde, x)) === x. Sin franjas declaradas, es tiempo corrido.
 */
export function sumarHabiles(desde: number, ms: number, horario = horarioDelNegocio()): number {
  if (ms <= 0) return desde;
  if (!horario.franjas.length || !horario.dias.length) return desde + ms;
  const franjas = horario.franjas.slice().sort((a, b) => a[0] - b[0]);
  let falta = ms;
  // Un año de días sin horario hábil sería un horario roto: se corta ahí en vez de dar vueltas sin fin.
  for (let t = desde, vuelta = 0; vuelta < 400; vuelta++) {
    const p = enLaZona(t);
    const medianoche = instante(t, 0);
    if (horario.dias.includes(p.diaSemana)) {
      for (const [ini, fin] of franjas) {
        const a = Math.max(t, medianoche + ini * 60_000);
        const b = medianoche + fin * 60_000;
        if (b <= a) continue;
        if (b - a >= falta) return a + falta;
        falta -= b - a;
      }
    }
    t = instante(medianoche + DIA + 3600_000, 0); // +1 h de colchón por los cambios de hora
  }
  return desde + ms;
}

// ---------- Las esperas ----------

interface FilaMensaje {
  user_id: string;
  role: string;
  author: string | null;
  by: string | null;
  ts: number;
}

/**
 * Reconstruye las esperas a partir de los mensajes. Una espera empieza cuando el cliente escribe sin tener
 * respuesta pendiente y termina cuando alguien —Xen o una persona— contesta.
 */
export function esperas(opts: { desde?: number; userId?: string; ahora?: number } = {}): Espera[] {
  const ahora = opts.ahora ?? Date.now();
  const desde = opts.desde ?? ahora - 30 * DIA;
  const db = getDb();
  const filas = (
    opts.userId
      ? db.prepare('SELECT user_id, role, author, by, ts FROM messages WHERE user_id = ? AND ts >= ? ORDER BY user_id, ts').all(opts.userId, desde)
      : db.prepare('SELECT user_id, role, author, by, ts FROM messages WHERE ts >= ? ORDER BY user_id, ts').all(desde)
  ) as unknown as FilaMensaje[];

  const horario = horarioDelNegocio();
  const out: Espera[] = [];
  let abierta: Espera | null = null;
  let usuario = '';

  const cerrarPendiente = () => {
    if (!abierta) return;
    abierta.ms = ahora - abierta.desde;
    abierta.msHabiles = msHabiles(abierta.desde, ahora, horario);
    out.push(abierta);
    abierta = null;
  };

  for (const m of filas) {
    if (m.user_id !== usuario) {
      cerrarPendiente(); // la conversación anterior se queda sin respuesta hasta ahora
      usuario = m.user_id;
    }
    if (m.role === 'user') {
      if (abierta) abierta.mensajes++;
      else abierta = { userId: m.user_id, desde: m.ts, hasta: null, ms: 0, msHabiles: 0, quien: null, por: null, mensajes: 1 };
      continue;
    }
    // Una respuesta: cierra la espera que hubiera. Lo que el negocio manda sin que nadie pregunte no cuenta.
    if (!abierta) continue;
    abierta.hasta = m.ts;
    abierta.ms = m.ts - abierta.desde;
    abierta.msHabiles = msHabiles(abierta.desde, m.ts, horario);
    abierta.quien = m.author === 'human' ? 'persona' : 'xencrm';
    abierta.por = m.author === 'human' ? m.by : null;
    out.push(abierta);
    abierta = null;
  }
  cerrarPendiente();
  return out;
}

// ---------- Resumen ----------

const percentil = (valores: number[], p: number): number => {
  if (!valores.length) return 0;
  const orden = [...valores].sort((a, b) => a - b);
  const i = Math.min(orden.length - 1, Math.floor((p / 100) * orden.length));
  return orden[i]!;
};

export interface ResumenTiempos {
  /** Cuántas esperas se respondieron en el periodo. */
  respondidas: number;
  /** La mitad se contestó en menos de esto (en horario de atención). */
  medianaMs: number;
  /** Nueve de cada diez, en menos de esto. Es el número que duele y el que hay que mirar. */
  p90Ms: number;
  porQuien: Record<Quien, { n: number; medianaMs: number }>;
  /** Quiénes contestaron y cuánto tardaron, de más rápido a más lento. */
  personas: { nombre: string; n: number; medianaMs: number }[];
  /** Las que siguen esperando ahora mismo, de la que más lleva a la que menos. */
  esperando: Espera[];
  /** De las respondidas, cuántas pasaron del acuerdo. */
  fueraDeAcuerdo: number;
  /** El acuerdo con el que se midió, en minutos. */
  acuerdoMin: number;
}

/**
 * El resumen que se mira. `acuerdoMin` es lo que el negocio promete: la primera respuesta en ese tiempo. No
 * tiene un valor por defecto universal —una boutique y una financiera no prometen lo mismo—, así que quien
 * llama decide, y en la configuración de cada cliente se guarda el suyo.
 */
export function resumenTiempos(opts: { desde?: number; acuerdoMin?: number; ahora?: number } = {}): ResumenTiempos {
  const acuerdoMin = opts.acuerdoMin ?? 15;
  const todas = esperas({ desde: opts.desde, ahora: opts.ahora });
  const respondidas = todas.filter((e) => e.hasta !== null);
  const tiempos = respondidas.map((e) => e.msHabiles);

  const de = (quien: Quien) => {
    const suyas = respondidas.filter((e) => e.quien === quien).map((e) => e.msHabiles);
    return { n: suyas.length, medianaMs: percentil(suyas, 50) };
  };

  const porPersona = new Map<string, number[]>();
  for (const e of respondidas) {
    if (e.quien !== 'persona') continue;
    const nombre = e.por || 'el equipo';
    porPersona.set(nombre, [...(porPersona.get(nombre) ?? []), e.msHabiles]);
  }

  return {
    respondidas: respondidas.length,
    medianaMs: percentil(tiempos, 50),
    p90Ms: percentil(tiempos, 90),
    porQuien: { xencrm: de('xencrm'), persona: de('persona') },
    personas: [...porPersona.entries()]
      .map(([nombre, v]) => ({ nombre, n: v.length, medianaMs: percentil(v, 50) }))
      .sort((a, b) => a.medianaMs - b.medianaMs),
    esperando: todas.filter((e) => e.hasta === null).sort((a, b) => b.msHabiles - a.msHabiles),
    fueraDeAcuerdo: respondidas.filter((e) => e.msHabiles > acuerdoMin * 60_000).length,
    acuerdoMin,
  };
}

/**
 * ¿El negocio está atendiendo ahora mismo?
 *
 * Sirve para lo que ve quien llega por la web: decirle «suele responder en minutos» a las tres de la mañana es
 * prometer algo que no va a pasar, y quien lo lea a esa hora se va a quedar esperando.
 *
 * 🪤 Sin horario declarado contesta que sí. Un negocio que no configuró sus horas no está cerrado —es que no lo
 * ha dicho—, y tratarlo como cerrado apagaría el chat de todo cliente nuevo hasta que alguien se diera cuenta.
 */
export function atendiendoAhora(ahora = Date.now()): boolean {
  const { dias, franjas } = horarioDelNegocio();
  if (!franjas.length) return true;
  const p = enLaZona(ahora);
  if (!dias.includes(p.diaSemana)) return false;
  // 🪤 La JORNADA, no las franjas una por una. Estas franjas son las de las CITAS, y un negocio que agenda de
  // 10 a 13 y de 15 a 19 no está cerrado a las 14:30: está almorzando, y a un mensaje contesta igual. Mirar
  // franja por franja hacía que el chat dijera «fuera de horario» a media tarde —pasó, delante de un cliente—
  // y eso no es un detalle estético: le dice a quien escribe que no espere respuesta cuando sí la va a haber.
  //
  // Se mira de la primera apertura al último cierre del día. Fuera de eso sí está cerrado de verdad.
  const abre = Math.min(...franjas.map(([ini]) => ini));
  const cierra = Math.max(...franjas.map(([, fin]) => fin));
  return p.minutos >= abre && p.minutos < cierra;
}
