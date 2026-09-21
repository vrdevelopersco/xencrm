// "Frases que no entendimos": lo que las reglas deberían resolver y no resolvieron (una fecha que tuvo que interpretar
// el modelo, un saludo o un pedido de cita que clasificó el modelo, una respuesta corta que sacó al cliente del flujo
// de la cita). Se enseñan desde el tablero como expresiones del diccionario ("a la hora del almuerzo" quiere decir
// "a las 12"): la próxima vez lo resuelven las reglas, sin gastar IA y sin volver a preguntar.
import { getDb } from '../rag/store.js';

export type MissKind = 'fecha' | 'frase' | 'cita';
export const MISS_KINDS: MissKind[] = ['fecha', 'frase', 'cita'];

export interface MissGroup {
  kind: MissKind;
  /** La frase normalizada: agrupa "Al medio día" y "al medio dia". */
  key: string;
  /** El último ejemplo, tal como lo escribió el cliente. */
  text: string;
  count: number;
  people: number;
  lastAt: number;
  userId: string;
  /** Lo que entendió el modelo o lo que esperaba el flujo. */
  reading: string | null;
  /** Qué podría querer decir, para empezar a enseñarla. */
  suggestion: string | null;
}

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export const missKey = (text: string) =>
  fold(text)
    .replace(/[¿?¡!.,;:"«»]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Anota una frase que las reglas no entendieron. La misma del mismo cliente en 10 minutos cuenta una vez, con el
 * primer diagnóstico: "la que sea" que sacó al cliente del flujo de la cita no se anota otra vez cuando la clasifica el modelo.
 */
export function noteMiss(userId: string, kind: MissKind, text: string, opts: { reading?: string | null; suggestion?: string | null } = {}): void {
  const key = missKey(text);
  if (!key || key.length > 200) return;
  const db = getDb();
  if (db.prepare('SELECT 1 FROM misses WHERE user_id = ? AND key = ? AND ts >= ?').get(userId, key, Date.now() - 600_000)) return;
  db.prepare('INSERT INTO misses (user_id, kind, text, key, reading, suggestion, ts) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    userId,
    kind,
    text.trim().slice(0, 300),
    key,
    opts.reading?.slice(0, 200) ?? null,
    opts.suggestion?.slice(0, 80) ?? null,
    Date.now(),
  );
}

/** Las frases sin revisar, agrupadas: primero las que más se repiten. */
export function listMisses(limit = 50): MissGroup[] {
  const db = getDb();
  const groups = db
    .prepare(
      `SELECT kind, key, COUNT(*) count, COUNT(DISTINCT user_id) people, MAX(ts) last_at FROM misses WHERE status = 'nueva'
       GROUP BY kind, key ORDER BY count DESC, last_at DESC LIMIT ?`,
    )
    .all(limit) as { kind: MissKind; key: string; count: number; people: number; last_at: number }[];
  // El último ejemplo, y la última lectura que sí se tuvo (no todas las veces la hay).
  const latest = db.prepare(
    `SELECT m.text, m.user_id,
       (SELECT reading FROM misses x WHERE x.status = 'nueva' AND x.kind = m.kind AND x.key = m.key AND x.reading IS NOT NULL ORDER BY x.ts DESC LIMIT 1) reading,
       (SELECT suggestion FROM misses x WHERE x.status = 'nueva' AND x.kind = m.kind AND x.key = m.key AND x.suggestion IS NOT NULL ORDER BY x.ts DESC LIMIT 1) suggestion
     FROM misses m WHERE m.status = 'nueva' AND m.kind = ? AND m.key = ? ORDER BY m.ts DESC LIMIT 1`,
  );
  return groups.map((g) => {
    const r = latest.get(g.kind, g.key) as { text: string; user_id: string; reading: string | null; suggestion: string | null };
    return { kind: g.kind, key: g.key, text: r.text, count: Number(g.count), people: Number(g.people), lastAt: Number(g.last_at), userId: r.user_id, reading: r.reading, suggestion: r.suggestion };
  });
}

export function getMissGroup(kind: MissKind, key: string): MissGroup | null {
  return listMisses(500).find((g) => g.kind === kind && g.key === key) ?? null;
}

/** Cierra un grupo: "revisada" (no hay nada que enseñar) o "enseñada" (ya quedó en el diccionario). */
export function closeMisses(kind: MissKind, key: string, status: 'revisada' | 'enseñada'): number {
  return Number(getDb().prepare("UPDATE misses SET status = ? WHERE kind = ? AND key = ? AND status = 'nueva'").run(status, kind, key).changes);
}
