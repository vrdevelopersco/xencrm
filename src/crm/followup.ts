// "Calientes sin seguimiento" solo sirve si se puede vaciar: si el equipo ya decidió que ese prospecto espera, la
// lista no lo debe repetir todos los días. Aquí se pospone (por defecto una semana) y se decide si sigue pospuesto.
// Si el cliente vuelve a escribir después, lo pospuesto ya no cuenta: hay algo nuevo que atender.
import { regla } from '../reglas.js';
import { getContact, updateContact, addEvent, type Contact } from './contacts.js';

const DAY = 86400_000;

/** ¿Este prospecto está pospuesto ahora mismo? */
export function isSnoozed(c: Contact, now = Date.now()): boolean {
  const until = Number(c.data.pospuesto_hasta ?? 0);
  const since = Number(c.data.pospuesto_desde ?? 0);
  return until > now && (c.lastMessageAt ?? 0) <= since;
}

/** Pospone el seguimiento de un prospecto. Devuelve la ficha y hasta cuándo, o null si la ficha no existe. */
export function snoozeFollowup(id: string, days?: number, now = Date.now()): { contact: Contact; until: number } | null {
  const me = getContact(id);
  if (!me) return null;
  // Por defecto y como mucho: reglas seg.posponerDias y seg.posponerMaxDias (de fábrica, 7 y 90).
  const porDefecto = regla<number>('seg.posponerDias');
  const n = Math.round(days ?? porDefecto);
  const d = Math.min(Math.max(Number.isFinite(n) ? n : porDefecto, 1), regla<number>('seg.posponerMaxDias'));
  const until = now + d * DAY;
  const contact = updateContact(id, { data: { ...me.data, pospuesto_desde: now, pospuesto_hasta: until } }); // sin perder lo capturado
  addEvent(id, 'followup_snooze', { days: d });
  return contact ? { contact, until } : null;
}
