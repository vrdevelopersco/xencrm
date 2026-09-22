// Un mismo cliente por dos canales queda como dos fichas: escribe por el chat del sitio, deja su número y después
// escribe por WhatsApp. Aquí se detectan (mismo número) y se unen en una sola: la conversación, las citas, el
// análisis y el consumo quedan en la ficha que se conserva, y la otra desaparece. No se puede deshacer, así que el
// tablero lo pregunta antes (el respaldo diario es la red de seguridad).
import { getDb } from '../rag/store.js';
import { addEvent, contactNumber, getContact, STAGES, type Contact, type Stage } from './contacts.js';
import { emitEvent } from './events.js';

const TABLES = ['messages', 'analyses', 'events', 'appointments', 'verifications', 'misses', 'llm_usage'];

/** Otras fichas que parecen la misma persona (mismo número, otro canal). */
export function findDuplicates(id: string): { contact: Contact; reason: string }[] {
  const c = getContact(id);
  const number = c && contactNumber(c);
  if (!c || !number) return [];
  const rows = getDb().prepare('SELECT id FROM users WHERE id <> ?').all(id) as { id: string }[];
  return rows.flatMap((r) => {
    const other = getContact(r.id);
    if (!other || contactNumber(other) !== number) return [];
    return [{ contact: other, reason: `mismo número (${number})` }];
  });
}

// La misma persona escribiendo por otro canal se consulta en cada mensaje: se recuerda un minuto para no recorrer
// los contactos en cada turno de una conversación.
const siblingCache = new Map<string, { ids: string[]; at: number }>();
const SIBLING_TTL = 60_000;

/** Ids de las otras fichas de esta persona, de la más reciente a la más vieja. */
export function siblingIds(id: string, now = Date.now()): string[] {
  const hit = siblingCache.get(id);
  if (hit && now - hit.at < SIBLING_TTL) return hit.ids;
  const ids = findDuplicates(id)
    .sort((a, b) => (b.contact.lastMessageAt ?? b.contact.lastSeen) - (a.contact.lastMessageAt ?? a.contact.lastSeen))
    .map((d) => d.contact.id);
  siblingCache.set(id, { ids, at: now });
  return ids;
}

/** Se llama cuando las fichas cambian (unir, borrar): la próxima consulta vuelve a mirar. */
export function forgetSiblings() {
  siblingCache.clear();
}

/** Cuál ficha conviene conservar: donde el cliente escribió más recientemente (ahí llegan las respuestas). */
export function keeperOf(a: Contact, b: Contact): { keep: Contact; drop: Contact } {
  return (a.lastMessageAt ?? a.lastSeen) >= (b.lastMessageAt ?? b.lastSeen) ? { keep: a, drop: b } : { keep: b, drop: a };
}

const better = (a: Stage, b: Stage) => (STAGES.indexOf(a) >= STAGES.indexOf(b) ? a : b);

/** Une `dropId` dentro de `keepId` y devuelve la ficha resultante. */
export function mergeContacts(keepId: string, dropId: string): Contact {
  const keep = getContact(keepId);
  const drop = getContact(dropId);
  if (!keep || !drop) throw new Error('alguna de las dos fichas ya no existe');
  if (keepId === dropId) throw new Error('son la misma ficha');
  const db = getDb();
  db.exec('BEGIN');
  try {
    for (const t of TABLES) db.prepare(`UPDATE ${t} SET user_id = ? WHERE user_id = ?`).run(keepId, dropId);
    const data = { ...drop.data, ...keep.data }; // lo de la ficha que se conserva manda
    const tags = [...new Set([...keep.tags, ...drop.tags])];
    const notes = [keep.notes, drop.notes].map((n) => n.trim()).filter(Boolean).join('\n');
    const note = `Se unió la ficha de ${drop.channel} (${drop.id})${drop.name && drop.name !== keep.name ? `, a nombre de ${drop.name}` : ''}.`;
    db.prepare(
      `UPDATE users SET name = ?, phone = ?, stage = ?, stage_locked = ?, score = ?, score_factors = ?, sentiment = ?, human_mode = ?, human_by = ?, human_since = ?,
       data = ?, tags = ?, notes = ?, summary = ?, unread = ?, first_seen = ?, last_seen = ?, last_message_at = ? WHERE id = ?`,
    ).run(
      keep.name ?? drop.name,
      keep.phone ?? drop.phone,
      keep.stageLocked ? keep.stage : better(keep.stage, drop.stage),
      keep.stageLocked || drop.stageLocked ? 1 : 0,
      keep.scoreAt && (!drop.scoreAt || keep.scoreAt >= drop.scoreAt) ? keep.score : drop.score,
      JSON.stringify(keep.scoreAt && (!drop.scoreAt || keep.scoreAt >= drop.scoreAt) ? keep.scoreFactors : drop.scoreFactors),
      keep.sentiment ?? drop.sentiment,
      keep.humanMode || drop.humanMode ? 1 : 0,
      keep.humanBy ?? drop.humanBy,
      keep.humanSince ?? drop.humanSince,
      JSON.stringify(data),
      JSON.stringify(tags),
      [notes, note].filter(Boolean).join('\n'),
      keep.summary ?? drop.summary,
      keep.unread + drop.unread,
      Math.min(keep.firstSeen, drop.firstSeen),
      Math.max(keep.lastSeen, drop.lastSeen),
      Math.max(keep.lastMessageAt ?? 0, drop.lastMessageAt ?? 0) || null,
      keepId,
    );
    db.prepare('DELETE FROM users WHERE id = ?').run(dropId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  forgetSiblings(); // las fichas cambiaron
  addEvent(keepId, 'contacts_merged', { from: dropId, channel: drop.channel });
  const merged = getContact(keepId)!;
  emitEvent('contact', keepId, { contact: merged, merged: dropId });
  return merged;
}
