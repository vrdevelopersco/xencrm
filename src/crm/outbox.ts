// Envío de mensajes hacia el cliente desde fuera del agente (respuestas humanas, confirmaciones, recordatorios).
import { appendMessage, type Author } from '../agent/memory.js';
import { getContact, updateContact } from './contacts.js';
import { emitEvent } from './events.js';

export type Sender = (userId: string, text: string) => Promise<void>;
const senders = new Map<string, Sender>();

/** Cada canal registra cómo entregar un texto a un usuario suyo. */
export function registerSender(channel: string, fn: Sender) {
  senders.set(channel, fn);
}

export async function sendToContact(userId: string, text: string, author: Author = 'human', opts: { by?: string } = {}): Promise<void> {
  const c = getContact(userId);
  if (!c) throw new Error(`contacto ${userId} no existe`);
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
