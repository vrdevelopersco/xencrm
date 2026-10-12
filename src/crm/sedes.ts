// Las sedes de un negocio: dónde queda cada una, cuándo atiende y cómo la llama la gente.
//
// Un negocio con tres sedes y un solo WhatsApp tenía que escoger: o tres números, o un asistente que no sabe a
// cuál mandar a cada quien. Con esto el asistente pregunta en cuál, entiende «la del norte» o «la de la 72», ofrece
// los espacios de ESA sede y lo dice en la confirmación, en el recordatorio y en el calendario del cliente.
//
// 🪤 Sin sedes en la configuración no cambia nada: la «agenda» es la de siempre (`appointments`), con su `location`.
// Todo lo de aquí se pregunta por `agendaDe(id)` y nunca por `business.sedes` directamente, para que ese caso, que es
// el de casi todos los clientes, no tenga que pensarse en ningún otro sitio.
import { business, type BusinessConfig } from '../config.js';

export type Sede = BusinessConfig['sedes'][number];

/** Todo lo que hace falta para ofrecer y agendar en un sitio. */
export interface Agenda {
  /** null: el negocio no tiene sedes, es la agenda de siempre. */
  sede: Sede | null;
  days: number[];
  hours: [string, string][];
  capacity: number;
  durationMin: number;
  minLeadHours: number;
  maxDaysAhead: number;
  service: string;
  /** Lo que se guarda en la cita y se le dice al cliente: «Sede Norte (Cra 53 # 82-20)». */
  lugar: string;
}

export const sedes = (): Sede[] => business.sedes;
/** Hay que preguntar en cuál: con una sola, no hay nada que escoger. */
export const variasSedes = (): boolean => business.sedes.length > 1;

export function sedePorId(id: string | null | undefined): Sede | null {
  return id ? (business.sedes.find((s) => s.id === id) ?? null) : null;
}

export const lugarDe = (s: Sede): string => (s.direccion ? `${s.nombre} (${s.direccion})` : s.nombre);

/**
 * La agenda de una sede, con lo que no diga heredado de `appointments`. Sin id —o con uno que no existe— y con
 * una sola sede configurada, es esa; sin sedes, la de siempre.
 */
export function agendaDe(id?: string | null): Agenda {
  const a = business.appointments;
  const sede = sedePorId(id) ?? (business.sedes.length === 1 ? business.sedes[0]! : null);
  return {
    sede,
    days: sede?.days ?? a.days,
    hours: sede?.hours ?? a.hours,
    capacity: sede?.capacity ?? a.capacity,
    durationMin: a.durationMin,
    minLeadHours: a.minLeadHours,
    maxDaysAhead: a.maxDaysAhead,
    service: a.service,
    lugar: sede ? lugarDe(sede) : a.location,
  };
}

/** La primera sede: a ella se le cuentan las citas viejas, de antes de que hubiera sedes (sin sede guardada). */
export const esLaPrimera = (s: Sede): boolean => business.sedes[0]?.id === s.id;

// ---------- Cuál nombra el cliente ----------
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Las formas de nombrar una sede: su nombre, su id, sus apodos, y el nombre sin lo que no distingue —«Sede Norte»
 * se dice «norte», «DUNOR Alto Prado» se dice «alto prado»—.
 */
function formasDe(s: Sede): string[] {
  const negocio = fold(business.business.name);
  const nombre = fold(s.nombre);
  const corto = nombre.replace(/^(?:la\s+)?sede\s+(?:de\s+(?:la\s+|el\s+)?|del\s+)?/, '').replace(new RegExp(`^${escapeRe(negocio)}\\s+`), '');
  return [...new Set([nombre, corto, fold(s.id).replace(/-/g, ' '), ...s.apodos.map(fold)])].filter((f) => f.length >= 2);
}

/**
 * La sede que nombra el mensaje, o null si no nombra ninguna.
 *
 * 🪤 Si nombra DOS sedes distintas, también null, y se pregunta. «No la de la 72, la del norte» nombra las dos, y
 * saber cuál es la que quiere es leer la negación, que las reglas no saben hacer bien. Preguntar cuesta un mensaje;
 * agendar en la sede equivocada cuesta un cliente que llega a la otra punta de la ciudad.
 */
export function sedeEn(texto: string): Sede | null {
  const nombradas = sedesNombradas(texto);
  return nombradas.length === 1 ? nombradas[0]! : null;
}

/** Todas las sedes que nombra el mensaje: para saber si nombró dos y hay que volver a preguntar. */
export function sedesNombradas(texto: string): Sede[] {
  if (!business.sedes.length) return [];
  const t = fold(texto);
  return business.sedes.filter((s) => formasDe(s).some((f) => new RegExp(`(?<![a-z0-9ñ])${escapeRe(f)}(?![a-z0-9ñ])`).test(t)));
}

// ---------- Cómo se dicen ----------
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** «lunes a viernes», «martes, jueves y sábado». */
export function diasComoTexto(dias: number[]): string {
  const orden = [...new Set(dias)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)); // la semana empieza el lunes
  if (!orden.length) return 'ningún día';
  const seguidos = orden.every((d, i) => i === 0 || d === (orden[i - 1]! + 1) % 7);
  if (seguidos && orden.length >= 3) return `${DIAS[orden[0]!]} a ${DIAS[orden[orden.length - 1]!]}`;
  const nombres = orden.map((d) => DIAS[d]!);
  return nombres.length === 1 ? nombres[0]! : `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}

const horasComoTexto = (h: [string, string][]) => h.map(([a, b]) => `${a} a ${b}`).join(' y ');

/** La lista para escoger: «1) Sede Norte · Cra 53 # 82-20». */
export function listaDeSedes(): string {
  return business.sedes.map((s, i) => `${i + 1}) ${s.nombre}${s.direccion ? ` · ${s.direccion}` : ''}`).join('\n');
}

/**
 * Las sedes como información del negocio, para el prompt y la búsqueda.
 *
 * 🪤 Dice «Dirección» con todas las letras. Si el Perfil tiene la dirección vacía, queda «por confirmar» y el
 * asistente verifica cualquier pregunta que la toque; con las sedes, la dirección sí se sabe, y la palabra en la
 * referencia es lo que le dice a esa guarda que este dato ya está respaldado.
 */
export function sedesComoInformacion(): string {
  if (!business.sedes.length) return '';
  const lineas = business.sedes.map((s) => {
    const ag = agendaDe(s.id);
    const apodos = s.apodos.length ? ` La gente le dice: ${s.apodos.join(', ')}.` : '';
    return `- ${s.nombre}.${s.direccion ? ` Dirección: ${s.direccion}.` : ''} Atiende ${diasComoTexto(ag.days)}, de ${horasComoTexto(ag.hours)}.${apodos}`;
  });
  return `${business.sedes.length === 1 ? 'Nuestra sede' : `Tenemos ${business.sedes.length} sedes`}:\n${lineas.join('\n')}`;
}
