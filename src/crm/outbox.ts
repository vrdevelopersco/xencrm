// Envío de mensajes hacia el cliente desde fuera del agente (respuestas humanas, confirmaciones, recordatorios).
import { appendMessage, type Author } from '../agent/memory.js';
import { getContact, updateContact } from './contacts.js';
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

export type Sender = (userId: string, text: string) => Promise<void>;
const senders = new Map<string, Sender>();

/** Cada canal registra cómo entregar un texto a un usuario suyo. */
export function registerSender(channel: string, fn: Sender) {
  senders.set(channel, fn);
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

export async function sendToContact(userId: string, text: string, author: Author = 'human', opts: { by?: string } = {}): Promise<void> {
  const c = getContact(userId);
  if (!c) throw new Error(`contacto ${userId} no existe`);
  // Se revisa antes de guardar nada: un mensaje que Meta va a rechazar no debe aparecer como enviado.
  if (!replyWindow(userId).open) throw new Error(WINDOW_CLOSED);
  const send = senders.get(c.channel);
  const by = opts.by?.trim() || undefined;
  const id = appendMessage(userId, 'assistant', text, undefined, author, by);
  emitEvent('message', userId, { id, role: 'assistant', author, by: by ?? null, content: text, ts: Date.now() });
  updateContact(userId, { unread: 0 }, { silent: true });
  if (!send) {
    console.warn(`[outbox] el canal ${c.channel} no tiene emisor registrado; el mensaje quedó guardado`);
    return;
  }
  // En WhatsApp el cliente ve siempre el mismo número: el nombre del asesor aclara quién le escribe.
  const outgoing = by && author === 'human' && c.channel !== 'web' ? `*${by}:* ${text}` : text;
  await send(userId, outgoing);
}
