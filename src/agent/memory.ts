import { getDb } from '../rag/store.js';
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
    `INSERT INTO users (id, channel, name, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen,
       name = COALESCE(excluded.name, users.name),
       archived = 0`, // si estaba archivada y el cliente vuelve a escribir, reaparece
  ).run(id, channel, name ?? null, now, now);
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

export function appendMessage(userId: string, role: 'user' | 'assistant', content: string, intent?: string, author?: Author, by?: string): number {
  const ts = Date.now();
  const a = author ?? (role === 'user' ? 'customer' : 'bot');
  const r = getDb()
    .prepare('INSERT INTO messages (user_id, role, content, intent, ts, author, by) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(userId, role, content, intent ?? null, ts, a, by ?? null);
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
}

export function getMessages(userId: string, limit = 50): StoredMessage[] {
  const rows = getDb()
    .prepare('SELECT id, role, author, by, content, intent, ts FROM messages WHERE user_id = ? ORDER BY ts DESC, id DESC LIMIT ?')
    .all(userId, limit) as unknown as StoredMessage[];
  return rows.reverse();
}

/** Últimos N turnos (usuario+asistente) en orden cronológico. */
export function getHistory(userId: string, turns = env.historyTurns): ChatMessage[] {
  const rows = getDb()
    .prepare('SELECT role, content FROM messages WHERE user_id = ? ORDER BY ts DESC, id DESC LIMIT ?')
    .all(userId, turns * 2) as { role: 'user' | 'assistant'; content: string }[];
  return rows.reverse().map((r) => ({ role: r.role, content: r.content }));
}

export function clearHistory(userId: string) {
  getDb().prepare('DELETE FROM messages WHERE user_id = ?').run(userId);
}
