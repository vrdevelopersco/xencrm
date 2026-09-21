// "Deja te verifico eso": lo que el bot no sabe queda por verificar en el tablero. El equipo responde, la respuesta le
// llega al cliente por su mismo canal (sin quitarle la conversación al bot) y, si se quiere, pasa a la información del
// negocio para que la próxima vez el bot ya lo sepa.
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { business } from '../config.js';
import { embed } from '../llm/ollama.js';
import { getDb, upsertDoc } from '../rag/store.js';
import { emitEvent } from './events.js';
import { sendToContact } from './outbox.js';

export interface Verification {
  id: number;
  userId: string;
  question: string;
  topic: string | null;
  status: 'pendiente' | 'respondida' | 'descartada';
  answer: string | null;
  answeredBy: string | null;
  learned: boolean;
  createdAt: number;
  answeredAt: number | null;
  contactName?: string | null;
}

// Frases con que el bot dice que no sabe algo y lo va a verificar (sobre el texto sin tildes).
const VERIFY_RE = /\bte verific|\blo verific|\bverificar(?:lo|te)\b|\blo averigu|\bno lo tengo (?:confirmado|a la mano)\b|\bno te lo puedo confirmar\b/;
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** ¿La respuesta dice que no sabe y que lo va a verificar? */
export function saysWillVerify(reply: string): boolean {
  return VERIFY_RE.test(fold(reply));
}

function rowTo(r: Record<string, unknown>): Verification {
  return {
    id: Number(r.id),
    userId: String(r.user_id),
    question: String(r.question),
    topic: (r.topic as string | null) ?? null,
    status: r.status as Verification['status'],
    answer: (r.answer as string | null) ?? null,
    answeredBy: (r.answered_by as string | null) ?? null,
    learned: Boolean(r.learned),
    createdAt: Number(r.created_at),
    answeredAt: r.answered_at === null || r.answered_at === undefined ? null : Number(r.answered_at),
    contactName: (r.contact_name as string | null) ?? null,
  };
}

export function getVerification(id: number): Verification | null {
  const r = getDb().prepare('SELECT v.*, u.name AS contact_name FROM verifications v LEFT JOIN users u ON u.id = v.user_id WHERE v.id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return r ? rowTo(r) : null;
}

export function listVerifications(status: Verification['status'] = 'pendiente', limit = 50): Verification[] {
  return (
    getDb()
      .prepare('SELECT v.*, u.name AS contact_name FROM verifications v LEFT JOIN users u ON u.id = v.user_id WHERE v.status = ? ORDER BY v.created_at ASC LIMIT ?')
      .all(status, limit) as Record<string, unknown>[]
  ).map(rowTo);
}

/** Abre una verificación, salvo que ya haya una pendiente del mismo cliente sobre lo mismo en las últimas 24 horas. */
export function openVerification(userId: string, question: string, topic?: string | null): Verification {
  const since = Date.now() - 24 * 3600_000;
  const pending = getDb()
    .prepare("SELECT id, question, topic FROM verifications WHERE user_id = ? AND status = 'pendiente' AND created_at >= ?")
    .all(userId, since) as { id: number; question: string; topic: string | null }[];
  const same = pending.find((p) => (topic && p.topic && fold(p.topic) === fold(topic)) || fold(p.question) === fold(question));
  if (same) return getVerification(same.id)!;
  // "hola, ¿tienen wifi?" se guarda como "¿tienen wifi?": el saludo no es parte de la pregunta.
  const clean = question.replace(/^\s*(?:hola+|buenas?(?:\s+(?:d[ií]as|tardes|noches))?|buen d[ií]a|hey)[\s,!.]*/i, '').trim() || question;
  const r = getDb()
    .prepare('INSERT INTO verifications (user_id, question, topic, created_at) VALUES (?, ?, ?, ?)')
    .run(userId, clean.slice(0, 500), topic ?? null, Date.now());
  const v = getVerification(Number(r.lastInsertRowid))!;
  emitEvent('verification', userId, { verification: v });
  return v;
}

/** Agrega la respuesta a la información del negocio y la indexa ya; si el índice no responde, queda para `pnpm ingest`. */
async function learn(v: Verification, answer: string): Promise<boolean> {
  const dir = business.sources.knowledgeDir;
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'respuestas-del-equipo.md');
  if (!existsSync(file)) appendFileSync(file, `# Respuestas del equipo\n\nLo que el equipo de ${business.business.name} respondió cuando ${business.agent.name} no lo sabía.\n`);
  const question = v.question.replace(/\s+/g, ' ').trim();
  appendFileSync(file, `\n## ${question}\n${answer.trim()}\n`);
  try {
    const content = `Pregunta de un cliente: ${question}\nRespuesta del equipo: ${answer.trim()}`;
    const [vec] = await embed([`${question}\n${content}`]);
    if (!vec) return false;
    upsertDoc({ id: `kb:respuestas-del-equipo.md#v${v.id}`, kind: 'knowledge', title: question, content, url: null, meta: { source: 'knowledge', file: 'respuestas-del-equipo.md' }, embedding: vec });
    return true;
  } catch (err) {
    console.warn(`[verificaciones] la respuesta quedó en ${file}; se indexará con pnpm ingest (${(err as Error).message})`);
    return false;
  }
}

/** Responde al cliente (como el equipo, sin tomar el control) y, si se pide, lo aprende. */
export async function answerVerification(id: number, answer: string, by: string, opts: { learn?: boolean } = {}): Promise<Verification> {
  const v = getVerification(id);
  if (!v) throw new Error('esa verificación no existe');
  if (v.status !== 'pendiente') throw new Error('esa verificación ya se cerró');
  await sendToContact(v.userId, answer.trim(), 'human', { by });
  const learned = opts.learn ? await learn(v, answer) : false;
  getDb()
    .prepare("UPDATE verifications SET status = 'respondida', answer = ?, answered_by = ?, learned = ?, answered_at = ? WHERE id = ?")
    .run(answer.trim(), by, learned || opts.learn ? 1 : 0, Date.now(), id);
  const done = getVerification(id)!;
  emitEvent('verification', v.userId, { verification: done });
  return done;
}

export function dismissVerification(id: number): Verification | null {
  getDb().prepare("UPDATE verifications SET status = 'descartada', answered_at = ? WHERE id = ? AND status = 'pendiente'").run(Date.now(), id);
  const v = getVerification(id);
  if (v) emitEvent('verification', v.userId, { verification: v });
  return v;
}
