import { idDelTurno } from '../crm/turnos.js';
import { guardarNumero, primeraEtapa } from '../crm/contacts.js';
import { siblingIds } from '../crm/merge.js';
import { getDb } from '../rag/store.js';
import type { Medio } from '../crm/medios.js';
import { env } from '../config.js';
import type { ChatMessage } from '../llm/ollama.js';

export interface UserInfo {
  id: string;
  channel: string;
  name: string | null;
  firstSeen: number;
  lastSeen: number;
  messageCount: number;
}

export function touchUser(id: string, channel: string, name?: string | null): UserInfo {
  const db = getDb();
  const now = Date.now();
  db.prepare(
    `INSERT INTO users (id, channel, name, stage, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen,
       name = COALESCE(excluded.name, users.name),
       archived = 0`, // si estaba archivada y el cliente vuelve a escribir, reaparece
  ).run(id, channel, name ?? null, primeraEtapa(), now, now);
  guardarNumero(id, null); // de la dirección de WhatsApp sale el número; si dio otro, se actualiza al guardarlo
  const row = db.prepare('SELECT id, channel, name, first_seen, last_seen FROM users WHERE id = ?').get(id) as Record<
    string,
    unknown
  >;
  const count = (db.prepare('SELECT COUNT(*) n FROM messages WHERE user_id = ?').get(id) as { n: number }).n;
  return {
    id,
    channel: row.channel as string,
    name: (row.name as string | null) ?? null,
    firstSeen: row.first_seen as number,
    lastSeen: row.last_seen as number,
    messageCount: count,
  };
}

export type Author = 'customer' | 'bot' | 'human';

export function appendMessage(
  userId: string,
  role: 'user' | 'assistant',
  content: string,
  intent?: string,
  author?: Author,
  by?: string,
  /** El archivo que acompaña al mensaje, si lo hay. Solo la referencia: el archivo vive en crm/medios.ts. */
  media?: Medio | null,
): number {
  const ts = Date.now();
  const a = author ?? (role === 'user' ? 'customer' : 'bot');
  const r = getDb()
    .prepare('INSERT INTO messages (user_id, role, content, intent, ts, author, by, media, turno) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    // El turno en curso, si lo hay (crm/turnos.ts): lo que escribe el equipo o lo importado no sale de uno.
    .run(userId, role, content, intent ?? null, ts, a, by ?? null, media ? JSON.stringify(media) : null, idDelTurno());
  getDb().prepare('UPDATE users SET last_message_at = ? WHERE id = ?').run(ts, userId);
  return Number(r.lastInsertRowid);
}

export interface StoredMessage {
  id: number;
  role: 'user' | 'assistant';
  author: Author;
  by: string | null;
  content: string;
  intent: string | null;
  ts: number;
  /** El archivo que vino o se mandó con este mensaje, si lo hubo. */
  media?: Medio | null;
  /** El turno del asistente que lo produjo (crm/turnos.ts): para ver por qué contestó eso. */
  turno?: string | null;
}

export function getMessages(userId: string, limit = 50): StoredMessage[] {
  const rows = getDb()
    .prepare('SELECT id, role, author, by, content, intent, ts, media, turno FROM messages WHERE user_id = ? ORDER BY ts DESC, id DESC LIMIT ?')
    .all(userId, limit) as unknown as (StoredMessage & { media: string | null })[];
  // 🪤 Un `media` ilegible no puede tumbar la conversación entera: se enseña el mensaje sin su archivo, que es
  // infinitamente mejor que una pantalla en blanco donde había un historial.
  return rows.reverse().map((r) => ({ ...r, media: parseMedio(r.media) }));
}

function parseMedio(crudo: string | null): Medio | null {
  if (!crudo) return null;
  try {
    return JSON.parse(crudo) as Medio;
  } catch {
    return null;
  }
}

/**
 * La conversación reciente. Si la misma persona venía hablando por otro canal (mismo número: escribió por el chat
 * del sitio y ahora por WhatsApp), esos mensajes entran también, en orden: para el cliente es una sola
 * conversación y el asistente tiene que llegar sabiendo de qué hablaban. Las fichas siguen separadas hasta que
 * alguien las una desde el tablero.
 */
export function getHistory(userId: string, turns = env.historyTurns): ChatMessage[] {
  const ids = [userId, ...siblingIds(userId)];
  const marks = ids.map(() => '?').join(', ');
  const rows = getDb()
    .prepare(`SELECT role, content FROM messages WHERE user_id IN (${marks}) ORDER BY ts DESC, id DESC LIMIT ?`)
    .all(...ids, turns * 2) as { role: 'user' | 'assistant'; content: string }[];
  return rows.reverse().map((r) => ({ role: r.role, content: r.content }));
}

export function clearHistory(userId: string) {
  getDb().prepare('DELETE FROM messages WHERE user_id = ?').run(userId);
}
