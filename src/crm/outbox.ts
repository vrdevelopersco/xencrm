// Envío de mensajes hacia el cliente desde fuera del agente (respuestas humanas, confirmaciones, recordatorios).
import { business } from '../config.js';
import { aprenderDeLaRespuesta } from './historial.js';
import { appendMessage, type Author } from '../agent/memory.js';
import { getContact, updateContact } from './contacts.js';
import type { Medio } from './medios.js';
import { emitEvent } from './events.js';
import { getDb } from '../rag/store.js';

// WhatsApp oficial (Meta) solo deja escribir texto libre hasta 24 h después del último mensaje del cliente; pasado ese
// tiempo hace falta una plantilla aprobada. El chat web y WhatsApp por QR no tienen esa regla.
const WINDOW_MS = 24 * 3600_000;

export interface ReplyWindow {
  /** El canal tiene ventana (WhatsApp oficial). */
  limited: boolean;
  open: boolean;
  /** Cuándo se cierra (o se cerró): 24 h después del último mensaje del cliente. */
  closesAt: number | null;
}

export function replyWindow(userId: string, now = Date.now()): ReplyWindow {
  const c = getContact(userId);
  if (!c || c.channel !== 'meta') return { limited: false, open: true, closesAt: null };
  const r = getDb().prepare("SELECT MAX(ts) t FROM messages WHERE user_id = ? AND role = 'user'").get(userId) as { t: number | null };
  const closesAt = r.t ? r.t + WINDOW_MS : null;
  return { limited: true, open: closesAt !== null && now < closesAt, closesAt };
}

export const WINDOW_CLOSED =
  'WhatsApp no deja escribirle ahora: pasaron más de 24 horas desde su último mensaje. Para retomar hace falta una plantilla aprobada por Meta, o esperar a que vuelva a escribir.';

/**
 * Cómo un canal entrega un mensaje. El adjunto es opcional: los canales que no sepan mandarlo lo ignoran y el
 * texto llega igual, que es mejor que no llegar nada.
 */
export type Sender = (userId: string, text: string, medio?: Medio | null) => Promise<void>;
const senders = new Map<string, Sender>();
/** Los canales que además saben entregar un archivo. */
const conMedios = new Set<string>();

/**
 * Cada canal registra cómo entregar un texto a un usuario suyo, y si sabe llevar archivos.
 *
 * 🪤 Lo de los archivos se declara EXPLÍCITAMENTE y por omisión es que no. Un canal que ignora en silencio el
 * adjunto deja al tablero diciendo «enviado» con una foto que el cliente nunca recibió, y quien atiende se
 * entera cuando el cliente pregunta por algo que cree que ya le mandaron. Es mejor no poder que creer que sí.
 */
export function registerSender(channel: string, fn: Sender, opts: { medios?: boolean } = {}) {
  senders.set(channel, fn);
  if (opts.medios) conMedios.add(channel);
  else conMedios.delete(channel);
}

/** ¿Este canal sabe llevarle un archivo al cliente? */
export function llevaArchivos(channel: string): boolean {
  return conMedios.has(channel);
}

/** Por dónde se puede entregar algo ahora mismo, y quién además lleva archivos. Para el reporte de salud. */
export function canalesQueEntregan(): { id: string; entrega: boolean; archivos: boolean }[] {
  return [...new Set([...senders.keys(), ...conMedios])].sort().map((id) => ({
    id,
    entrega: senders.has(id),
    archivos: conMedios.has(id),
  }));
}

/**
 * Manda un texto por un canal **sin pasar por el CRM**: no crea ficha, no guarda el mensaje, no analiza nada.
 * Es para avisar al propio equipo (ver `crm/vigilante.ts`), no para hablar con clientes. Devuelve si salió.
 *
 * 🪤 Lo que se manda por aquí no queda en ninguna conversación, así que no se use para escribirle a un cliente:
 * el equipo no vería lo que se le dijo y el CRM dejaría de ser el sitio donde está todo.
 */
export async function enviarSuelto(channel: string, destino: string, text: string): Promise<boolean> {
  const fn = senders.get(channel);
  if (!fn) return false;
  try {
    await fn(destino, text);
    return true;
  } catch {
    return false;
  }
}

/** ¿Hay cómo entregarle un mensaje ahora? (WhatsApp apagado o sin conectar: no.) */
export function canDeliver(userId: string): boolean {
  const c = getContact(userId);
  return Boolean(c && senders.has(c.channel));
}

// Plantillas aprobadas (WhatsApp oficial): lo único que se puede enviar fuera de la ventana de 24 horas.
export interface Template {
  name: string;
  language: string;
  params: string[];
}
export type TemplateSender = (userId: string, template: Template) => Promise<void>;
const templateSenders = new Map<string, TemplateSender>();
export function registerTemplateSender(channel: string, fn: TemplateSender) {
  templateSenders.set(channel, fn);
}
export function canSendTemplate(userId: string): boolean {
  const c = getContact(userId);
  return Boolean(c && templateSenders.has(c.channel));
}

/** Envía una plantilla; en la conversación queda `text`, lo que el cliente ve con la plantilla ya llena. */
export async function sendTemplateToContact(userId: string, template: Template, text: string): Promise<void> {
  const c = getContact(userId);
  const send = c ? templateSenders.get(c.channel) : undefined;
  if (!c || !send) throw new Error('este canal no envía plantillas');
  await send(userId, template);
  const id = appendMessage(userId, 'assistant', text, undefined, 'bot');
  emitEvent('message', userId, { id, role: 'assistant', author: 'bot', by: null, content: text, ts: Date.now() });
}

/**
 * Cómo sale firmado un mensaje hacia el cliente.
 *
 * Por WhatsApp el cliente ve siempre el mismo número, así que hay que decirle con quién está hablando: si le
 * contesta el asistente o si le contestó una persona. Antes iba el **nombre** de quien escribía desde el tablero
 * —y al cliente le llegaba «*Arthur:*», que para él no significa nada y encima expone a quien atiende—. Ahora va
 * el papel: el asistente firma con su nombre (el que el negocio le puso) y una persona firma como el equipo.
 *
 * En el chat del sitio no se firma: ahí ya se ve en pantalla quién habla.
 */
export function conFirma(text: string, author: Author, canal: string): string {
  if (canal === 'web') return text;
  const quien = author === 'human' ? business.crm.firmaHumano : business.agent.name;
  return quien ? `*${quien}:* ${text}` : text;
}

export async function sendToContact(
  userId: string,
  text: string,
  author: Author = 'human',
  opts: { by?: string; medio?: Medio | null } = {},
): Promise<void> {
  const c = getContact(userId);
  if (!c) throw new Error(`contacto ${userId} no existe`);
  // Se revisa antes de guardar nada: un mensaje que Meta va a rechazar no debe aparecer como enviado.
  if (!replyWindow(userId).open) throw new Error(WINDOW_CLOSED);
  const send = senders.get(c.channel);
  const by = opts.by?.trim() || undefined;
  const medio = opts.medio ?? null;
  // 🪤 Se comprueba ANTES de guardar nada. Si se guardara primero, la conversación quedaría con un archivo que
  // el cliente no tiene y nadie podría distinguirlo de uno que sí llegó.
  if (medio && !llevaArchivos(c.channel)) {
    throw new Error(`Por ${c.channel} no puedo mandarle archivos todavía; solo por WhatsApp. El texto sí se puede.`);
  }
  const id = appendMessage(userId, 'assistant', text, undefined, author, by, medio);
  emitEvent('message', userId, { id, role: 'assistant', author, by: by ?? null, content: text, ts: Date.now(), media: medio });
  updateContact(userId, { unread: 0 }, { silent: true });
  // Lo que contesta una persona enseña cómo atiende este negocio: entra al material de aprendizaje. Del propio
  // asistente no se aprende nada (ver crm/historial.ts).
  // 🪤 De un mensaje que es solo un archivo no se aprende nada: el pie «te mando el portafolio» no enseña a
  // atender, y mete ruido en el material del que sale el estilo del negocio.
  if (author === 'human' && !medio) {
    try {
      aprenderDeLaRespuesta(userId, text, by ?? '');
    } catch (err) {
      console.error('[outbox] no pude guardar lo aprendido:', (err as Error).message);
    }
  }
  if (!send) {
    console.warn(`[outbox] el canal ${c.channel} no tiene emisor registrado; el mensaje quedó guardado`);
    return;
  }
  await send(userId, conFirma(text, author, c.channel), medio);
}
