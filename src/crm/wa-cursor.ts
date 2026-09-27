// Por dónde va el historial de cada chat de WhatsApp.
//
// Al vincular un número, WhatsApp manda lo reciente de cada conversación y nada más. Para traer lo de antes hay
// que pedírselo apuntando al mensaje más antiguo que ya se tiene — así que hay que ir guardando cuál es.
//
// Vive aparte del canal de WhatsApp a propósito: es lógica de datos, se puede probar sin abrir ninguna sesión, y
// así no arrastra la librería entera a quien solo quiere leer el cursor.
import { getDb } from '../rag/store.js';

export interface Cursor {
  chat: string;
  keyId: string;
  fromMe: boolean;
  ts: number;
}

/**
 * Anota el mensaje más antiguo conocido de un chat.
 *
 * 🪤 Solo retrocede: si llega uno más nuevo que el que ya está guardado, se ignora. Avanzar hacia adelante
 * dejaría el cursor en el último mensaje y pedir «más historial» traería lo que ya se tiene, una y otra vez.
 */
export function anotarCursor(c: Cursor): void {
  getDb()
    .prepare(
      `INSERT INTO wa_cursor (chat, key_id, from_me, ts) VALUES (?, ?, ?, ?)
       ON CONFLICT(chat) DO UPDATE SET key_id = excluded.key_id, from_me = excluded.from_me, ts = excluded.ts
       WHERE excluded.ts < wa_cursor.ts`,
    )
    .run(c.chat, c.keyId, c.fromMe ? 1 : 0, c.ts);
}

/** Los chats de los que se puede pedir más, empezando por el que tiene lo más antiguo. */
export function cursores(limite = 200): Cursor[] {
  return (
    getDb().prepare('SELECT chat, key_id, from_me, ts FROM wa_cursor ORDER BY ts LIMIT ?').all(limite) as unknown as {
      chat: string;
      key_id: string;
      from_me: number;
      ts: number;
    }[]
  ).map((r) => ({ chat: r.chat, keyId: r.key_id, fromMe: Boolean(r.from_me), ts: r.ts }));
}

export const cursorDe = (chat: string): Cursor | null => cursores(200).find((c) => c.chat === chat) ?? null;
