// La misma persona por dos canales: empezó por el chat del sitio y en la tarde escribe por WhatsApp. Para ella es
// la misma gestión, así que el asistente llega sabiendo de qué hablaban (la conversación del otro canal entra en el
// historial, en `agent/memory.ts`) y se lo dice de frente la primera vez, en vez de saludar como si no la conociera.
// Las fichas no se unen solas: la unión la decide una persona desde el tablero, porque cada ficha es la historia de
// su canal.
import { regla } from '../reglas.js';
import { addEvent, getContact, updateContact } from './contacts.js';
import { emitEvent } from './events.js';
import { siblingIds } from './merge.js';

const CHANNEL_NAME: Record<string, string> = {
  whatsapp: 'WhatsApp',
  meta: 'WhatsApp',
  web: 'el chat del sitio',
  cli: 'la consola',
  mcp: 'otro asistente',
};
export const channelName = (channel: string) => CHANNEL_NAME[channel] ?? 'otro canal';

/** Solo cuenta como "la misma gestión" lo que pasó hace poco: un mes. */
const reciente = (): number => regla<number>('contactos.mismaPersonaDias') * 86400_000; // 30 días de fábrica

/**
 * Si esta persona venía hablando por otro canal y todavía no se lo hemos dicho, la frase con la que abre la
 * respuesta. Se dice una sola vez por ficha; después la conversación sigue normal.
 */
export function crossChannelGreeting(userId: string, now = Date.now()): string | null {
  const me = getContact(userId);
  if (!me || me.data.cruce_avisado) return null;
  const other = siblingIds(userId, now)
    .map((id) => getContact(id))
    .find((x) => x && x.channel !== me.channel && x.messageCount > 0 && now - (x.lastMessageAt ?? x.lastSeen) < reciente());
  if (!other) return null;
  updateContact(userId, { data: { ...me.data, cruce_avisado: true } }, { silent: true });
  addEvent(userId, 'cross_channel', { from: other.id, channel: other.channel });
  emitEvent('cross_channel', userId, { from: other.id, channel: other.channel, name: other.name ?? me.name ?? null });
  const first = (me.name ?? other.name ?? '').split(' ')[0];
  return `Hola${first ? `, ${first}` : ''} 🙂 Vi que veníamos hablando por ${channelName(other.channel)}; ya me puse al tanto.`;
}
