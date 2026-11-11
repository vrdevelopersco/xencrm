// Conversaciones de demostración: fichas sintéticas con puntaje, etapa, citas y una en manos de una asesora,
// para que un tablero recién montado no se vea desierto al mostrarlo.
//
// 🪤 Esto mete datos falsos en la base de un cliente real, así que lo único que importa de verdad es **poder
// quitarlos sin tocar lo de verdad**. Por eso todo lo sembrado lleva el prefijo `wa:seed-` en el id: quitar es
// borrar exactamente lo que empieza así, y ninguna conversación real puede empezar así (las de WhatsApp son
// números y las del sitio empiezan por `web:`).
//
// Antes esto era un guion de terminal. Vive aquí porque en un servidor no hay terminal, y cargar y quitar tiene
// que poder hacerse desde la consola.
import { existsSync, readFileSync } from 'node:fs';
import { business } from '../config.js';
import { getDb } from '../rag/store.js';
import { computeScore, type Signals } from './analyzer.js';
import { availableSlots } from './appointments.js';
import { getContact, purgeContact } from './contacts.js';
import { sembrarTicketsDe, type TicketDemo } from './tickets-demo.js';
import { quitarServicioDemo, sembrarServicio } from './servicio-demo.js';

export const PREFIJO = 'wa:seed-';

export interface MensajeDemo {
  role: 'user' | 'assistant';
  text: string;
  author?: 'bot' | 'human';
  by?: string;
}

export interface ContactoDemo {
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
  messages: MensajeDemo[];
  /** Los tickets de soporte de este contacto (Servicio › Tickets). Formato en docs/xencrm.md › «Servicio». */
  tickets?: TicketDemo[];
}

/** Cuántas conversaciones de demostración hay ahora mismo. */
export function cuantas(): number {
  return (getDb().prepare('SELECT COUNT(*) n FROM users WHERE id LIKE ?').get(`${PREFIJO}%`) as { n: number }).n;
}

/** Quita **solo** lo sembrado. Devuelve cuántas quitó. */
export function quitar(): number {
  const db = getDb();
  const ids = (db.prepare('SELECT id FROM users WHERE id LIKE ?').all(`${PREFIJO}%`) as { id: string }[]).map((r) => r.id);
  for (const id of ids) {
    purgeContact(id); // mensajes, análisis, eventos y citas de esa ficha
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }
  quitarServicioDemo(); // los mantenimientos y actualizaciones de ejemplo (no son de una ficha)
  return ids.length;
}

/** El archivo de ejemplos de este cliente (`seedFile` en su configuración). */
export const archivoDemo = (): string | null => (business.seedFile && existsSync(business.seedFile) ? business.seedFile : null);

/**
 * Carga las conversaciones de demostración. Vuelve a empezar: lo que ya estuviera sembrado se quita primero,
 * así cargar dos veces no deja el tablero con todo repetido.
 */
export function cargar(opts: { archivo?: string | null; now?: number } = {}): number {
  const archivo = opts.archivo ?? archivoDemo();
  if (!archivo) throw new Error('este cliente no tiene datos de demostración (seedFile)');
  const now = opts.now ?? Date.now();
  const db = getDb();
  const seeds = JSON.parse(readFileSync(archivo, 'utf8')) as ContactoDemo[];
  quitar();

  let cuenta = 0;
  for (const sd of seeds) {
    const userId = `${PREFIJO}${sd.id}@s.whatsapp.net`;
    if (getContact(userId)) {
      purgeContact(userId);
      db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    }
    const lastTs = now - sd.lastMinutesAgo * 60_000;
    const firstTs = lastTs - sd.messages.length * 3 * 60_000;
    db.prepare('INSERT INTO users (id, channel, name, phone, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?)').run(userId, 'whatsapp', sd.name, `+${sd.id}`, firstTs, lastTs);

    const paso = sd.messages.length > 1 ? (lastTs - firstTs) / (sd.messages.length - 1) : 0;
    sd.messages.forEach((m, i) => {
      const ts = Math.round(firstTs + paso * i);
      const autor = m.role === 'user' ? 'customer' : (m.author ?? 'bot');
      db.prepare('INSERT INTO messages (user_id, role, content, intent, ts, author, by) VALUES (?, ?, ?, ?, ?, ?, ?)').run(userId, m.role, m.text, null, ts, autor, m.by ?? null);
    });

    if (sd.appointmentInHours !== undefined) {
      // 🪤 Se encaja en el primer hueco de la agenda del negocio desde esa hora: sumarle horas a «ahora» dejaba demos
      // a las 6:47 a. m. o un sábado en un negocio que atiende de lunes a viernes, y eso se ve inventado.
      const deseado = now + sd.appointmentInHours * 3600_000;
      const startsAt = availableSlots({ count: 1, after: new Date(deseado) })[0]?.startsAt.getTime() ?? deseado;
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
    }

    // El puntaje se calcula igual que en una conversación de verdad, con las señales del ejemplo: así el
    // tablero muestra factores explicables ("Pidió cita +30") y no un número inventado.
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
      } as Signals;
      for (const f of business.crm.fields) (base as Record<string, unknown>)[f.name] = String(sd.data[f.name] ?? '');
      const ficha = getContact(userId)!;
      ({ score, factors } = computeScore(
        { ...ficha, messageCount: sd.messages.filter((m) => m.role === 'user').length, lastMessageAt: lastTs },
        base,
        { hasAppointment: sd.appointmentInHours !== undefined },
      ));
      db.prepare('INSERT INTO analyses (user_id, ts, engine, sentiment, signals, score, factors) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        userId, lastTs + 5000, 'seed', base.sentimiento, JSON.stringify(base), score, JSON.stringify(factors),
      );
    }
    const humanSince = sd.humanMode ? now - (sd.humanSinceMinutesAgo ?? 10) * 60_000 : null;
    db.prepare(
      'UPDATE users SET stage = ?, stage_locked = ?, score = ?, score_factors = ?, sentiment = ?, human_mode = ?, human_by = ?, human_since = ?, data = ?, summary = ?, unread = ?, last_message_at = ? WHERE id = ?',
    ).run(
      sd.stage,
      sd.stageLocked ? 1 : 0,
      score,
      JSON.stringify(factors),
      sd.sentiment,
      sd.humanMode ? 1 : 0,
      sd.humanMode ? (sd.humanBy ?? 'equipo') : null,
      humanSince,
      JSON.stringify(sd.data),
      sd.summary,
      sd.unread,
      lastTs,
      userId,
    );
    if (sd.stage !== 'nuevo') {
      db.prepare('INSERT INTO events (user_id, ts, type, payload) VALUES (?, ?, ?, ?)').run(userId, firstTs + 60_000, 'stage', JSON.stringify({ from: 'nuevo', to: sd.stage, by: 'bot' }));
    }
    if (sd.humanMode) {
      db.prepare('INSERT INTO events (user_id, ts, type, payload) VALUES (?, ?, ?, ?)').run(userId, humanSince, 'human_on', JSON.stringify({ by: 'bot' }));
    }
    sembrarTicketsDe(userId, sd.tickets ?? [], now);
    cuenta++;
  }
  // Lo de Servicio que no es de una ficha (mantenimientos, actualizaciones): de `servicio.json`, junto a la semilla.
  sembrarServicio(archivo, now);
  return cuenta;
}
