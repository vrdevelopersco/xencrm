// Ficha de prospecto (contacto) sobre la tabla users, con etapa, puntaje explicable y modo humano.
import { business } from '../config.js';
import { getDb } from '../rag/store.js';
import { decayed } from './score.js';
import { emitEvent } from './events.js';

// El embudo sale de la configuración del negocio (crm.stages): una boutique agenda citas, una financiera estudia
// solicitudes y una litografía cotiza y produce. El código no usa los nombres, usa los roles.
export type StageRole = 'inicio' | 'activo' | 'interes' | 'cita' | 'ganado' | 'perdido';
export type Stage = string;
export const STAGE_DEFS = business.crm.stages;
export const STAGES: Stage[] = STAGE_DEFS.map((s) => s.id);
export const STAGE_LABELS: Record<Stage, string> = Object.fromEntries(STAGE_DEFS.map((s) => [s.id, s.label]));

/** La primera etapa: donde entra quien acaba de escribir. */
export const primeraEtapa = (): Stage => (STAGE_DEFS.find((s) => s.rol === 'inicio') ?? STAGE_DEFS[0]!).id;

/** La etapa que cumple ese papel en este negocio, si la tiene ("cita" no existe donde no se agenda). */
export const etapaCon = (rol: StageRole): Stage | null => STAGE_DEFS.find((s) => s.rol === rol)?.id ?? null;

/** El papel de una etapa, para preguntar por lo que significa y no por cómo se llama. */
export const rolDe = (stage: Stage): StageRole | null => STAGE_DEFS.find((s) => s.id === stage)?.rol ?? null;

/** ¿Esta ficha está cerrada (ganada o perdida)? Esas no piden acción. */
export const estaCerrada = (stage: Stage): boolean => ['ganado', 'perdido'].includes(rolDe(stage) ?? '');

export interface ScoreFactor {
  label: string;
  points: number;
}

export interface Contact {
  id: string;
  channel: string;
  name: string | null;
  phone: string | null;
  stage: Stage;
  stageLocked: boolean;
  score: number;
  scoreBase: number;
  scoreFactors: ScoreFactor[];
  sentiment: string | null;
  humanMode: boolean;
  humanBy: string | null;
  humanSince: number | null;
  /** Momento del último análisis: si hay mensajes posteriores, el puntaje está desactualizado. */
  scoreAt: number | null;
  data: Record<string, unknown>;
  tags: string[];
  notes: string;
  summary: string | null;
  unread: number;
  firstSeen: number;
  lastSeen: number;
  lastMessageAt: number | null;
  messageCount: number;
  /** Archivada: no sale en listas ni en el embudo. Vuelve sola si el cliente escribe de nuevo. */
  archived: boolean;
}

const SELECT = `SELECT u.*, (SELECT COUNT(*) FROM messages m WHERE m.user_id = u.id AND m.role = 'user') AS message_count, (SELECT MAX(ts) FROM analyses a WHERE a.user_id = u.id) AS score_at FROM users u`;

function rowToContact(r: Record<string, unknown>): Contact {
  const json = <T>(v: unknown, def: T): T => {
    try {
      return v ? (JSON.parse(String(v)) as T) : def;
    } catch {
      return def;
    }
  };
  const base = Number(r.score ?? 0);
  const guardada = (r.stage as string) || '';
  const stage: Stage = STAGES.includes(guardada) ? guardada : primeraEtapa(); // si cambió el embudo, no se rompe
  const lastMessageAt = r.last_message_at == null ? null : Number(r.last_message_at);
  const hoy = decayed(base, json<ScoreFactor[]>(r.score_factors, []), lastMessageAt, stage);
  return {
    id: r.id as string,
    channel: r.channel as string,
    name: (r.name as string | null) ?? null,
    phone: (r.phone as string | null) ?? null,
    stage,
    stageLocked: Boolean(r.stage_locked),
    score: hoy.score,
    /** El de la conversación, sin descontar el silencio: lo que llegó a ser este prospecto. */
    scoreBase: base,
    scoreFactors: hoy.factors,
    sentiment: (r.sentiment as string | null) ?? null,
    humanMode: Boolean(r.human_mode),
    humanBy: (r.human_by as string | null) ?? null,
    humanSince: r.human_since == null ? null : Number(r.human_since),
    scoreAt: r.score_at == null ? null : Number(r.score_at),
    data: json<Record<string, unknown>>(r.data, {}),
    tags: json<string[]>(r.tags, []),
    notes: (r.notes as string) ?? '',
    summary: (r.summary as string | null) ?? null,
    unread: Number(r.unread ?? 0),
    firstSeen: Number(r.first_seen),
    lastSeen: Number(r.last_seen),
    lastMessageAt,
    messageCount: Number(r.message_count ?? 0),
    archived: Boolean(r.archived),
  };
}

export function getContact(id: string): Contact | null {
  const r = getDb().prepare(`${SELECT} WHERE u.id = ?`).get(id) as Record<string, unknown> | undefined;
  return r ? rowToContact(r) : null;
}

/**
 * El número del contacto, solo dígitos y con indicativo: el que dio o el de su WhatsApp (la dirección lo trae).
 * Sirve para escribirle, llamarlo y para saber si dos fichas son la misma persona.
 */
export function contactNumber(c: Contact | null): string | null {
  if (!c) return null;
  const m = /^(?:wa:(\d{8,15})@s\.whatsapp\.net|meta:(\d{8,15}))$/.exec(c.id);
  const raw = c.phone ?? (m ? (m[1] ?? m[2]!) : null);
  if (!raw) return null;
  let digits = raw.replace(/\D/g, '');
  // "300 123 4567" y "+57 300 123 4567" son el mismo número.
  if (digits.length === business.business.phoneLocalDigits) digits = business.business.phoneCountryCode + digits;
  return digits.length >= 8 ? digits : null;
}

export function listContacts(opts: { stage?: Stage; humanMode?: boolean; q?: string; limit?: number; archived?: boolean } = {}): Contact[] {
  const where: string[] = [`u.archived = ${opts.archived ? 1 : 0}`]; // por defecto, sin las archivadas
  const params: unknown[] = [];
  if (opts.stage) {
    where.push('u.stage = ?');
    params.push(opts.stage);
  }
  if (opts.humanMode !== undefined) {
    where.push('u.human_mode = ?');
    params.push(opts.humanMode ? 1 : 0);
  }
  if (opts.q) {
    // También dentro de la conversación: "el vestido azul" aparece aunque no esté en el nombre ni en el resumen.
    where.push('(u.name LIKE ? OR u.id LIKE ? OR u.phone LIKE ? OR u.summary LIKE ? OR EXISTS (SELECT 1 FROM messages m WHERE m.user_id = u.id AND m.content LIKE ?))');
    const like = `%${opts.q}%`;
    params.push(like, like, like, like, like);
  }
  const sql = `${SELECT}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY COALESCE(u.last_message_at, u.last_seen) DESC LIMIT ?`;
  params.push(opts.limit ?? 200);
  return (getDb().prepare(sql).all(...(params as (string | number)[])) as Record<string, unknown>[]).map(rowToContact);
}

/** El mensaje más reciente donde aparece lo buscado, para mostrarlo en la lista. */
export function messageHit(userId: string, q: string): { role: string; content: string; ts: number } | null {
  const row = getDb()
    .prepare('SELECT role, content, ts FROM messages WHERE user_id = ? AND content LIKE ? ORDER BY ts DESC LIMIT 1')
    .get(userId, `%${q}%`) as { role: string; content: string; ts: number } | undefined;
  return row ?? null;
}

export interface ContactPatch {
  name?: string | null;
  phone?: string | null;
  stage?: Stage;
  stageLocked?: boolean;
  score?: number;
  scoreFactors?: ScoreFactor[];
  sentiment?: string | null;
  humanMode?: boolean;
  data?: Record<string, unknown>;
  tags?: string[];
  notes?: string;
  summary?: string | null;
  unread?: number;
}

export function updateContact(id: string, patch: ContactPatch, opts: { silent?: boolean } = {}): Contact | null {
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  const map: [keyof ContactPatch, string, (v: unknown) => string | number | null][] = [
    ['name', 'name', (v) => (v as string | null) ?? null],
    ['phone', 'phone', (v) => (v as string | null) ?? null],
    ['stage', 'stage', (v) => String(v)],
    ['stageLocked', 'stage_locked', (v) => (v ? 1 : 0)],
    ['score', 'score', (v) => Number(v)],
    ['scoreFactors', 'score_factors', (v) => JSON.stringify(v)],
    ['sentiment', 'sentiment', (v) => (v as string | null) ?? null],
    ['humanMode', 'human_mode', (v) => (v ? 1 : 0)],
    ['data', 'data', (v) => JSON.stringify(v)],
    ['tags', 'tags', (v) => JSON.stringify(v)],
    ['notes', 'notes', (v) => String(v)],
    ['summary', 'summary', (v) => (v as string | null) ?? null],
    ['unread', 'unread', (v) => Number(v)],
  ];
  for (const [key, col, conv] of map) {
    if (patch[key] !== undefined) {
      sets.push(`${col} = ?`);
      params.push(conv(patch[key]));
    }
  }
  if (sets.length) {
    params.push(id);
    getDb().prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }
  const c = getContact(id);
  if (c && !opts.silent) emitEvent('contact', id, { contact: c });
  return c;
}

export function setHumanMode(id: string, on: boolean, by: string): Contact | null {
  getDb().prepare('UPDATE users SET human_by = ?, human_since = ? WHERE id = ?').run(on ? by : null, on ? Date.now() : null, id);
  const c = updateContact(id, { humanMode: on });
  addEvent(id, on ? 'human_on' : 'human_off', { by });
  emitEvent('handoff', id, { on, by });
  return c;
}

export function setStage(id: string, stage: Stage, opts: { locked?: boolean; by?: string } = {}): Contact | null {
  const prev = getContact(id)?.stage;
  const c = updateContact(id, { stage, ...(opts.locked !== undefined ? { stageLocked: opts.locked } : {}) });
  if (prev !== stage) addEvent(id, 'stage', { from: prev, to: stage, by: opts.by ?? 'bot' });
  return c;
}

export function addEvent(userId: string, type: string, payload: Record<string, unknown> = {}) {
  getDb().prepare('INSERT INTO events (user_id, ts, type, payload) VALUES (?, ?, ?, ?)').run(userId, Date.now(), type, JSON.stringify(payload));
}

export function listEvents(userId: string, limit = 50): { id: number; ts: number; type: string; payload: Record<string, unknown> }[] {
  const rows = getDb().prepare('SELECT id, ts, type, payload FROM events WHERE user_id = ? ORDER BY ts DESC LIMIT ?').all(userId, limit) as {
    id: number;
    ts: number;
    type: string;
    payload: string;
  }[];
  return rows.map((r) => ({ ...r, payload: JSON.parse(r.payload || '{}') })).reverse();
}

export function stats() {
  const db = getDb();
  const byStage = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>;
  for (const r of db.prepare('SELECT stage, COUNT(*) n FROM users WHERE archived = 0 GROUP BY stage').all() as { stage: Stage; n: number }[]) byStage[r.stage] = r.n;
  const total = (db.prepare('SELECT COUNT(*) n FROM users WHERE archived = 0').get() as { n: number }).n;
  const avgScore = (db.prepare('SELECT AVG(score) a FROM users WHERE archived = 0').get() as { a: number | null }).a ?? 0;
  // Calientes de hoy: el puntaje ya con el descuento por silencio, igual que lo que se ve en las listas.
  const hot = listContacts({ limit: 100000 }).filter((c) => c.score >= 60).length;
  const human = (db.prepare('SELECT COUNT(*) n FROM users WHERE human_mode = 1 AND archived = 0').get() as { n: number }).n;
  const unread = (db.prepare('SELECT COALESCE(SUM(unread), 0) n FROM users WHERE archived = 0').get() as { n: number }).n;
  const sentiments = Object.fromEntries(
    (db.prepare('SELECT sentiment, COUNT(*) n FROM users WHERE sentiment IS NOT NULL GROUP BY sentiment').all() as { sentiment: string; n: number }[]).map((r) => [r.sentiment, r.n]),
  );
  const now = Date.now();
  const week = now + 7 * 86400_000;
  const upcoming = (db.prepare("SELECT COUNT(*) n FROM appointments WHERE status = 'confirmada' AND starts_at BETWEEN ? AND ?").get(now, week) as { n: number }).n;
  const messagesToday = (db.prepare("SELECT COUNT(*) n FROM messages WHERE role = 'user' AND ts >= ?").get(now - 86400_000) as { n: number }).n;
  return { total, byStage, avgScore: Math.round(avgScore), hot, human, unread, sentiments, upcomingAppointments: upcoming, messagesToday };
}

/** Borra todo lo de un contacto (mensajes, análisis, eventos, citas) y deja la ficha en cero. Para pruebas y `/reset` total. */
/** Borra del todo las conversaciones de prueba (eval:, replay:): contacto, mensajes, análisis, eventos y citas.
 *  El consumo de IA (llm_usage) se conserva: es gasto real. */
export function deleteContactsByPrefix(prefix: string): number {
  const db = getDb();
  for (const t of ['messages', 'analyses', 'events', 'appointments', 'verifications', 'misses']) db.prepare(`DELETE FROM ${t} WHERE user_id LIKE ?`).run(`${prefix}%`);
  return Number(db.prepare('DELETE FROM users WHERE id LIKE ?').run(`${prefix}%`).changes);
}

/** Archiva o desarchiva: no borra nada, solo la saca (o la devuelve) de las listas. */
export function setArchived(id: string, on: boolean): Contact | null {
  getDb().prepare('UPDATE users SET archived = ? WHERE id = ?').run(on ? 1 : 0, id);
  const c = getContact(id);
  if (c) {
    addEvent(id, on ? 'archivada' : 'desarchivada');
    emitEvent('contact', id, { contact: c });
  }
  return c;
}

/** Borra la ficha y todo lo suyo (conversación, citas, análisis, consumo). No se deshace. */
export function deleteContact(id: string): boolean {
  const db = getDb();
  const c = getContact(id);
  if (!c) return false;
  db.exec('BEGIN');
  try {
    for (const t of ['messages', 'analyses', 'events', 'appointments', 'verifications', 'misses', 'llm_usage']) db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  emitEvent('contact', id, { deleted: true });
  return true;
}

export function purgeContact(userId: string) {
  const db = getDb();
  for (const t of ['messages', 'analyses', 'events', 'appointments', 'verifications', 'misses']) db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(userId);
  db.prepare(
    "UPDATE users SET name = NULL, phone = NULL, stage = 'nuevo', stage_locked = 0, score = 0, score_factors = '[]', sentiment = NULL, human_mode = 0, data = '{}', tags = '[]', notes = '', summary = NULL, unread = 0, last_message_at = NULL WHERE id = ?",
  ).run(userId);
}
