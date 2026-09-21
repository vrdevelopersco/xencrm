// Datos de demostración: conversaciones sintéticas con ficha, puntaje, etapa, citas y una en manos de una asesora.
// pnpm seed          carga el archivo `seedFile` de aiva.config.json
// pnpm seed --clear  borra solo los contactos sembrados (ids wa:seed-…)
import { readFileSync, existsSync } from 'node:fs';
import { business } from './config.js';
import { getDb } from './rag/store.js';
import { computeScore, type Signals } from './crm/analyzer.js';
import { getContact, purgeContact } from './crm/contacts.js';

interface SeedMessage {
  role: 'user' | 'assistant';
  text: string;
  author?: 'bot' | 'human';
  by?: string;
}
interface SeedContact {
  id: string;
  name: string | null;
  stage: string;
  stageLocked?: boolean;
  sentiment: string | null;
  lastMinutesAgo: number;
  unread: number;
  humanMode?: boolean;
  humanBy?: string;
  humanSinceMinutesAgo?: number;
  summary: string | null;
  data: Record<string, unknown>;
  signals: Partial<Signals> | null;
  appointmentInHours?: number;
  messages: SeedMessage[];
}

const file = business.seedFile;
if (!file) {
  console.error('Este cliente no tiene datos de demostración: define "seedFile" en aiva.config.json.');
  process.exit(1);
}
const db = getDb();
const PREFIX = 'wa:seed-';

if (process.argv.includes('--clear')) {
  const ids = (db.prepare("SELECT id FROM users WHERE id LIKE ?").all(`${PREFIX}%`) as { id: string }[]).map((r) => r.id);
  for (const id of ids) {
    purgeContact(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }
  console.log(`✓ ${ids.length} contactos de demostración borrados`);
  process.exit(0);
}

if (!existsSync(file)) {
  console.error(`No existe ${file}`);
  process.exit(1);
}
const seeds = JSON.parse(readFileSync(file, 'utf8')) as SeedContact[];
const now = Date.now();
let count = 0;

for (const sd of seeds) {
  const userId = `${PREFIX}${sd.id}@s.whatsapp.net`;
  if (getContact(userId)) {
    purgeContact(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  }
  const lastTs = now - sd.lastMinutesAgo * 60_000;
  const firstTs = lastTs - sd.messages.length * 3 * 60_000;
  db.prepare('INSERT INTO users (id, channel, name, phone, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?)').run(userId, 'whatsapp', sd.name, `+${sd.id}`, firstTs, lastTs);

  // Mensajes espaciados hasta el último
  const step = sd.messages.length > 1 ? (lastTs - firstTs) / (sd.messages.length - 1) : 0;
  sd.messages.forEach((m, i) => {
    const ts = Math.round(firstTs + step * i);
    const author = m.role === 'user' ? 'customer' : m.author ?? 'bot';
    db.prepare('INSERT INTO messages (user_id, role, content, intent, ts, author, by) VALUES (?, ?, ?, ?, ?, ?, ?)').run(userId, m.role, m.text, null, ts, author, m.by ?? null);
  });

  // Cita
  let hasAppointment = false;
  if (sd.appointmentInHours !== undefined) {
    const startsAt = now + sd.appointmentInHours * 3600_000;
    db.prepare('INSERT INTO appointments (user_id, starts_at, ends_at, service, location, status, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      userId,
      startsAt,
      startsAt + business.appointments.durationMin * 60_000,
      business.appointments.service,
      business.appointments.location || null,
      'confirmada',
      'Demostración',
      lastTs,
    );
    db.prepare('INSERT INTO events (user_id, ts, type, payload) VALUES (?, ?, ?, ?)').run(userId, lastTs, 'appointment_booked', JSON.stringify({ startsAt, by: 'bot' }));
    hasAppointment = true;
  }

  // Ficha, puntaje y análisis
  let score = 0;
  let factors: { label: string; points: number }[] = [];
  if (sd.signals) {
    const base: Signals = {
      sentimiento: (sd.sentiment as Signals['sentimiento']) ?? 'neutral',
      interes: 0,
      urgencia: 'baja',
      quiere_cita: false,
      pidio_precio: false,
      menciono_presupuesto: false,
      tiene_objecion: false,
      objecion: '',
      presupuesto: '',
      nombre: sd.name ?? '',
      ciudad: String(sd.data.ciudad ?? ''),
      telefono: '',
      resumen: sd.summary ?? '',
      ...sd.signals,
    };
    for (const f of business.crm.fields) base[f.name] = String(sd.data[f.name] ?? '');
    const stub = getContact(userId)!;
    ({ score, factors } = computeScore({ ...stub, messageCount: sd.messages.filter((m) => m.role === 'user').length, lastMessageAt: lastTs }, base, { hasAppointment }));
    db.prepare('INSERT INTO analyses (user_id, ts, engine, sentiment, signals, score, factors) VALUES (?, ?, ?, ?, ?, ?, ?)').run(userId, lastTs + 5000, 'seed', base.sentimiento, JSON.stringify(base), score, JSON.stringify(factors));
  }
  const humanSince = sd.humanMode ? now - (sd.humanSinceMinutesAgo ?? 10) * 60_000 : null;
  db.prepare(
    `UPDATE users SET stage = ?, stage_locked = ?, score = ?, score_factors = ?, sentiment = ?, human_mode = ?, human_by = ?, human_since = ?, data = ?, summary = ?, unread = ?, last_message_at = ? WHERE id = ?`,
  ).run(sd.stage, sd.stageLocked ? 1 : 0, score, JSON.stringify(factors), sd.sentiment, sd.humanMode ? 1 : 0, sd.humanMode ? sd.humanBy ?? 'equipo' : null, humanSince, JSON.stringify(sd.data), sd.summary, sd.unread, lastTs, userId);
  if (sd.stage !== 'nuevo') db.prepare('INSERT INTO events (user_id, ts, type, payload) VALUES (?, ?, ?, ?)').run(userId, firstTs + 60_000, 'stage', JSON.stringify({ from: 'nuevo', to: sd.stage, by: 'bot' }));
  if (sd.humanMode) db.prepare('INSERT INTO events (user_id, ts, type, payload) VALUES (?, ?, ?, ?)').run(userId, humanSince, 'human_on', JSON.stringify({ by: 'bot' }));
  count++;
  console.log(`  ${sd.name ?? sd.id}: ${sd.stage} · score ${score}${hasAppointment ? ' · cita' : ''}${sd.humanMode ? ` · la lleva ${sd.humanBy}` : ''}`);
}
console.log(`✓ ${count} contactos de demostración cargados desde ${file}. Quitar: pnpm seed --clear`);
