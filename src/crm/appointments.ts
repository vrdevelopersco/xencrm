// Agenda de citas con disponibilidad configurable (aiva.config.json > appointments), sin dependencias externas.
import { business } from '../config.js';
import { getDb } from '../rag/store.js';
import { findDuplicates } from './merge.js';
import { addEvent, getContact, setStage, updateContact } from './contacts.js';
import { emitEvent } from './events.js';
import { busyOverlaps } from './busy.js';

const cfg = business.appointments;
const TZ = business.timezone;

export interface Slot {
  startsAt: Date;
  endsAt: Date;
}
export interface Appointment {
  id: number;
  userId: string;
  startsAt: number;
  endsAt: number;
  service: string;
  location: string | null;
  status: 'confirmada' | 'cancelada' | 'completada' | 'no_asistio';
  notes: string;
  createdAt: number;
  contactName?: string | null;
  /** Recordatorio del día antes: enviado (por el bot o a mano), a mano (no se pudo enviar solo) o no hacía falta. */
  reminder: { status: 'enviado' | 'a_mano' | 'no_hace_falta'; at: number | null; note: string | null } | null;
  /** Lo que respondió al recordatorio. */
  reply: 'confirmó' | 'no_puede' | null;
}

// ---------- Zona horaria (sin librerías) ----------
export function tzParts(date: Date): { y: number; m: number; d: number; hh: number; mm: number; wd: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { y: Number(get('year')), m: Number(get('month')), d: Number(get('day')), hh: Number(get('hour')), mm: Number(get('minute')), wd };
}

/** Fecha absoluta para una hora de pared (y-m-d hh:mm) en la zona horaria del negocio. */
export function zoned(y: number, m: number, d: number, hh: number, mm: number): Date {
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const p = tzParts(guess);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
  const offset = asUtc - guess.getTime();
  return new Date(guess.getTime() - offset);
}

export function formatSlot(date: Date, opts: { withDay?: boolean } = { withDay: true }): string {
  const f = new Intl.DateTimeFormat('es-CO', {
    timeZone: TZ,
    ...(opts.withDay ? { weekday: 'long', day: 'numeric', month: 'long' } : {}),
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return f.format(date).replace(/\u202f/g, ' ').replace(/\s+/g, ' ');
}

export function formatDay(date: Date): string {
  return new Intl.DateTimeFormat('es-CO', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(date);
}

// ---------- Filtro de fecha y franja ----------
/** Lo que pidió el cliente ("el sábado en la tarde"), ya interpretado por crm/when.ts. */
export interface When {
  /** Días concretos, fecha local YYYY-MM-DD. */
  days?: string[];
  /** Rango de días (inclusive), fecha local YYYY-MM-DD. */
  from?: string;
  to?: string;
  /** Días de la semana admitidos: 0 = domingo … 6 = sábado. */
  weekdays?: number[];
  /** Franja: la cita empieza en [fromMin, toMin), en minutos desde medianoche. */
  fromMin?: number;
  toMin?: number;
  /** Hora exacta que dijo el cliente ("a las 12", "la de las 3"): para escoger entre lo ofrecido, esa hora. */
  at?: number;
  /** Cómo se lo decimos al cliente: "el sábado en la tarde" (y sus dos partes por separado). */
  label: string;
  dayLabel?: string;
  timeLabel?: string;
}

export function dayKey(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function whenAllowsDay(w: When, key: string, weekday: number): boolean {
  if (w.days && !w.days.includes(key)) return false;
  if (w.from && key < w.from) return false;
  if (w.to && key > w.to) return false;
  if (w.weekdays && !w.weekdays.includes(weekday)) return false;
  return true;
}

export function whenAllowsMinute(w: When, minute: number): boolean {
  return (w.fromMin === undefined || minute >= w.fromMin) && (w.toMin === undefined || minute < w.toMin);
}

/** ¿Este espacio es el que describe el cliente? Con hora exacta ("a las 12"), el que empieza en esa hora. */
export function slotMatches(startsAt: Date, w: When): boolean {
  const p = tzParts(startsAt);
  const minute = p.hh * 60 + p.mm;
  if (!whenAllowsDay(w, dayKey(p.y, p.m, p.d), p.wd)) return false;
  return w.at !== undefined ? minute >= w.at && minute < w.at + 60 : whenAllowsMinute(w, minute);
}

// ---------- Disponibilidad ----------
/** Citas que se cruzan con ese espacio, más los eventos del calendario privado del dueño (salvo que se excluyan). */
function bookedCount(startsAt: Date, opts: { includeBusy?: boolean } = {}): number {
  const start = startsAt.getTime();
  const end = start + cfg.durationMin * 60_000;
  const booked = (
    getDb().prepare("SELECT COUNT(*) n FROM appointments WHERE status = 'confirmada' AND starts_at < ? AND ends_at > ?").get(end, start) as { n: number }
  ).n;
  return booked + (opts.includeBusy === false ? 0 : busyOverlaps(start, end));
}

/**
 * Espacios libres a partir de ahora (respetando antelación mínima), opcionalmente solo de un día de la semana
 * o de lo que pidió el cliente (`when`). Sin un día fijo, reparte un espacio por día.
 */
export function availableSlots(opts: { count?: number; weekday?: number; after?: Date; spreadDays?: boolean; when?: When } = {}): Slot[] {
  const count = opts.count ?? 3;
  const w = opts.when;
  const oneDay = opts.weekday !== undefined || w?.days?.length === 1 || w?.weekdays?.length === 1;
  const earliest = new Date(Math.max(Date.now() + cfg.minLeadHours * 3600_000, (opts.after ?? new Date(0)).getTime()));
  const out: Slot[] = [];
  const perDay = new Map<string, number>();
  const start = tzParts(new Date());
  for (let dayOffset = 0; dayOffset <= cfg.maxDaysAhead && out.length < count; dayOffset++) {
    const dayDate = new Date(Date.UTC(start.y, start.m - 1, start.d + dayOffset, 12, 0));
    const p = tzParts(dayDate);
    if (!cfg.days.includes(p.wd)) continue;
    if (opts.weekday !== undefined && p.wd !== opts.weekday) continue;
    const key = dayKey(p.y, p.m, p.d);
    if (w && !whenAllowsDay(w, key, p.wd)) continue;
    for (const [from, to] of cfg.hours) {
      const [fh, fm] = from.split(':').map(Number) as [number, number];
      const [th, tm] = to.split(':').map(Number) as [number, number];
      let minute = fh * 60 + fm;
      for (
        let t = zoned(p.y, p.m, p.d, fh, fm);
        t.getTime() + cfg.durationMin * 60_000 <= zoned(p.y, p.m, p.d, th, tm).getTime();
        t = new Date(t.getTime() + cfg.durationMin * 60_000), minute += cfg.durationMin
      ) {
        if (t < earliest) continue;
        if (w && !whenAllowsMinute(w, minute)) continue;
        if (bookedCount(t) >= cfg.capacity) continue;
        if (opts.spreadDays !== false && !oneDay && (perDay.get(key) ?? 0) >= 1) break;
        out.push({ startsAt: t, endsAt: new Date(t.getTime() + cfg.durationMin * 60_000) });
        perDay.set(key, (perDay.get(key) ?? 0) + 1);
        if (out.length >= count) break;
      }
      if (out.length >= count) break;
    }
  }
  return out;
}

export function isSlotFree(startsAt: Date, opts: { includeBusy?: boolean } = {}): boolean {
  return bookedCount(startsAt, opts) < cfg.capacity;
}

// ---------- Reservas ----------
function rowToAppointment(r: Record<string, unknown>): Appointment {
  return {
    id: Number(r.id),
    userId: r.user_id as string,
    startsAt: Number(r.starts_at),
    endsAt: Number(r.ends_at),
    service: r.service as string,
    location: (r.location as string | null) ?? null,
    status: r.status as Appointment['status'],
    notes: (r.notes as string) ?? '',
    createdAt: Number(r.created_at),
    contactName: (r.contact_name as string | null) ?? null,
    reminder: r.reminder_status
      ? { status: r.reminder_status as NonNullable<Appointment['reminder']>['status'], at: r.reminder_at == null ? null : Number(r.reminder_at), note: (r.reminder_note as string | null) ?? null }
      : null,
    reply: (r.customer_reply as Appointment['reply']) ?? null,
  };
}

/** Marca el recordatorio de una cita. */
export function setReminder(id: number, status: NonNullable<Appointment['reminder']>['status'], note: string | null = null): Appointment | null {
  getDb().prepare('UPDATE appointments SET reminder_status = ?, reminder_at = ?, reminder_note = ? WHERE id = ?').run(status, Date.now(), note, id);
  const appt = getAppointment(id);
  if (appt) emitEvent('appointment', appt.userId, { appointment: appt, by: 'reminder' });
  return appt;
}

/** Guarda lo que respondió el cliente al recordatorio ("confirmó" o "no puede"). */
export function setCustomerReply(id: number, reply: NonNullable<Appointment['reply']>): Appointment | null {
  getDb().prepare('UPDATE appointments SET customer_reply = ? WHERE id = ?').run(reply, id);
  const appt = getAppointment(id);
  if (appt) {
    addEvent(appt.userId, 'reminder_reply', { id, reply });
    emitEvent('reminder_reply', appt.userId, { appointment: appt, reply });
  }
  return appt;
}

export function bookAppointment(userId: string, startsAt: Date, opts: { service?: string; notes?: string; by?: string } = {}): Appointment {
  // Desde el tablero se puede agendar encima de un evento personal del dueño: la persona sabe lo que hace.
  if (!isSlotFree(startsAt, { includeBusy: opts.by !== 'admin' })) throw new Error('ese espacio ya no está disponible');
  const endsAt = new Date(startsAt.getTime() + cfg.durationMin * 60_000);
  const r = getDb()
    .prepare('INSERT INTO appointments (user_id, starts_at, ends_at, service, location, status, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(userId, startsAt.getTime(), endsAt.getTime(), opts.service ?? cfg.service, cfg.location || null, 'confirmada', opts.notes ?? '', Date.now());
  const appt = getAppointment(Number(r.lastInsertRowid))!;
  addEvent(userId, 'appointment_booked', { id: appt.id, startsAt: appt.startsAt, by: opts.by ?? 'bot' });
  const c = getContact(userId);
  if (c && !['vendido'].includes(c.stage)) setStage(userId, 'cita_agendada', { by: opts.by ?? 'bot' });
  emitEvent('appointment', userId, { appointment: appt });
  return appt;
}

export function getAppointment(id: number): Appointment | null {
  const r = getDb().prepare('SELECT a.*, u.name AS contact_name FROM appointments a LEFT JOIN users u ON u.id = a.user_id WHERE a.id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return r ? rowToAppointment(r) : null;
}

export function listAppointments(opts: { userId?: string; from?: number; to?: number; status?: string; limit?: number } = {}): Appointment[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.userId) {
    where.push('a.user_id = ?');
    params.push(opts.userId);
  }
  if (opts.from !== undefined) {
    where.push('a.starts_at >= ?');
    params.push(opts.from);
  }
  if (opts.to !== undefined) {
    where.push('a.starts_at <= ?');
    params.push(opts.to);
  }
  if (opts.status) {
    where.push('a.status = ?');
    params.push(opts.status);
  }
  params.push(opts.limit ?? 200);
  const rows = getDb()
    .prepare(
      `SELECT a.*, u.name AS contact_name FROM appointments a LEFT JOIN users u ON u.id = a.user_id${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY a.starts_at ASC LIMIT ?`,
    )
    .all(...params) as Record<string, unknown>[];
  return rows.map(rowToAppointment);
}

export function updateAppointment(id: number, patch: { status?: Appointment['status']; notes?: string }, by = 'admin'): Appointment | null {
  const sets: string[] = [];
  const params: (string | number)[] = [];
  if (patch.status) {
    sets.push('status = ?');
    params.push(patch.status);
  }
  if (patch.notes !== undefined) {
    sets.push('notes = ?');
    params.push(patch.notes);
  }
  if (sets.length) {
    params.push(id);
    getDb().prepare(`UPDATE appointments SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }
  const appt = getAppointment(id);
  if (appt) {
    addEvent(appt.userId, 'appointment_updated', { id, ...patch, by });
    emitEvent('appointment', appt.userId, { appointment: appt, by });
    if (patch.status === 'cancelada') {
      const c = getContact(appt.userId);
      // Solo baja de etapa si no le queda otra cita (al mover una cita, la nueva ya existe cuando se cancela la vieja).
      if (c?.stage === 'cita_agendada' && !c.stageLocked && !nextAppointmentFor(appt.userId)) updateContact(appt.userId, { stage: 'interesado' });
    }
  }
  return appt;
}

/** Borra las citas de conversaciones de prueba (eval:, replay:): no deben ocupar la agenda real ni salir en el calendario. */
export function deleteAppointmentsByPrefix(prefix: string): number {
  return Number(getDb().prepare('DELETE FROM appointments WHERE user_id LIKE ?').run(`${prefix}%`).changes);
}

export function nextAppointmentFor(userId: string): Appointment | null {
  return listAppointments({ userId, from: Date.now(), status: 'confirmada', limit: 1 })[0] ?? null;
}

/**
 * La próxima cita de esta persona, aunque esté en otra ficha suya: escribió por el chat del sitio, dejó su número y
 * agendó, y ahora escribe por WhatsApp. Sin esto el bot le ofrece horarios como si no tuviera nada y puede quedar
 * con dos citas. Las fichas se unen a mano desde el tablero; mientras tanto, para el cliente es la misma cita.
 */
export function nextAppointmentForPerson(userId: string): Appointment | null {
  const mine = nextAppointmentFor(userId);
  if (mine) return mine;
  for (const { contact } of findDuplicates(userId)) {
    const other = nextAppointmentFor(contact.id);
    if (other) return other;
  }
  return null;
}
