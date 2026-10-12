// Dar de alta a alguien a mano: el que llegó por el local, por una llamada o con una tarjeta.
//
// Un CRM que solo conoce a quien escribió por el chat deja fuera a media clientela de un negocio de barrio. Esto
// es la «C» del CRUD: una ficha que nace sin conversación.
//
// 🪤 Lo delicado no es crearla: es QUÉ DIRECCIÓN se le pone. La ficha nace con la misma que tendría su WhatsApp
// (`wa:57…@s.whatsapp.net`), porque el día que esa persona escriba, el canal va a buscar exactamente esa. Con un
// identificador inventado habría dos fichas de la misma persona —la de la libreta y la real— cada una con la
// mitad de la historia, y nadie se entera hasta que falta la mitad.
import { randomUUID } from 'node:crypto';
import { touchUser } from '../agent/memory.js';
import { getContact, numeroNormalizado, STAGES, updateContact, type Contact, type Stage } from './contacts.js';
import { getDb } from '../rag/store.js';
import { sedePorId } from './sedes.js';

export interface Alta {
  name?: string;
  phone?: string;
  stage?: Stage;
  notes?: string;
  /** La sede a la que llegó, si el negocio tiene sedes (crm/sedes.ts). Sin ella sale en «Sin sede todavía». */
  sede?: string;
}

export interface Resultado {
  contact: Contact;
  /** Ya tenía ficha: no se creó otra, se devuelve la que hay. */
  yaExistia: boolean;
}

/**
 * La dirección que le toca a quien se da de alta a mano.
 *
 * Con número, la de su WhatsApp. Sin número no hay forma de adivinarla, así que lleva una propia y marcada:
 * `mano:` dice de dónde salió, y el día que esa persona escriba se podrá juntar con su ficha real a mano.
 */
export function direccionDe(numero: string | null): string {
  return numero ? `wa:${numero}@s.whatsapp.net` : `mano:${randomUUID().slice(0, 8)}`;
}

/** Quién tiene ya este número, si alguien. */
export function quienTieneElNumero(numero: string): string | null {
  return (getDb().prepare('SELECT id FROM users WHERE number = ? LIMIT 1').get(numero) as { id: string } | undefined)?.id ?? null;
}

/**
 * Crea la ficha, o devuelve la que ya existía.
 *
 * 🪤 No se crea una segunda ficha de quien ya está: quien da de alta a mano no sabe —ni tiene por qué— si esa
 * persona ya escribió alguna vez. Si se creara igual, el CRM partiría su historia en dos justo en el momento en
 * que alguien intenta ordenarla.
 */
export function darDeAlta(datos: Alta): Resultado {
  const nombre = String(datos.name ?? '').trim();
  const numero = numeroNormalizado('', String(datos.phone ?? '').trim() || null);
  if (!nombre && !numero) throw new Error('dime al menos el nombre o el teléfono');
  if (datos.stage && !STAGES.includes(datos.stage)) throw new Error('etapa inválida');
  if (datos.sede && !sedePorId(datos.sede)) throw new Error('esa sede no existe');

  if (numero) {
    const ya = quienTieneElNumero(numero);
    if (ya) return { contact: getContact(ya)!, yaExistia: true };
  }

  const id = direccionDe(numero);
  const existente = getContact(id);
  if (existente) return { contact: existente, yaExistia: true };

  touchUser(id, numero ? 'whatsapp' : 'manual', nombre || null);
  updateContact(id, {
    name: nombre || null,
    phone: numero,
    ...(datos.stage ? { stage: datos.stage } : {}),
    ...(datos.notes ? { notes: String(datos.notes) } : {}),
    ...(datos.sede ? { data: { ...(getContact(id)?.data ?? {}), sede: datos.sede } } : {}),
  });
  // Se relee en vez de usar lo que devuelve updateContact: así la ficha sale con todo lo que le haya puesto el
  // alta (el número normalizado en su columna, la etapa de entrada) y no con una versión a medio hacer.
  return { contact: getContact(id)!, yaExistia: false };
}
