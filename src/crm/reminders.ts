// Recordatorio de la cita el día antes, por el canal del cliente. Lo que no se puede enviar solo (chat del sitio,
// conversación que lleva una persona, WhatsApp oficial fuera de las 24 h sin plantilla) queda en Hoy para hacerlo a
// mano, con el texto listo. La respuesta del cliente ("ahí estaré", "no puedo") la atiende el flujo de citas.
import { business } from '../config.js';
import { formatSlot, getAppointment, listAppointments, setReminder, tzParts, zoned, type Appointment } from './appointments.js';
import { awaitReminderReply } from './booking.js';
import { contactNumber, getContact, type Contact } from './contacts.js';
import { canDeliver, canSendTemplate, replyWindow, sendTemplateToContact, sendToContact } from './outbox.js';

const cfg = business.appointments;
const HOUR = 3600_000;

/** Cuándo se recuerda: el día anterior a la hora configurada (hora local del negocio). */
export function reminderTime(startsAt: number): number {
  const p = tzParts(new Date(startsAt));
  const dayBefore = tzParts(new Date(zoned(p.y, p.m, p.d, 12, 0).getTime() - 24 * HOUR));
  const [hh, mm] = cfg.reminder.at.split(':').map(Number) as [number, number];
  return zoned(dayBefore.y, dayBefore.m, dayBefore.d, hh, mm).getTime();
}

/** El texto del recordatorio, el mismo que se envía solo o que el equipo manda a mano. */
export function reminderText(appt: Appointment, contact: Contact | null, now = Date.now()): string {
  const first = (contact?.name ?? '').split(' ')[0];
  const tomorrow = tzParts(new Date(now + 24 * HOUR));
  const day = tzParts(new Date(appt.startsAt));
  const when = tomorrow.y === day.y && tomorrow.m === day.m && tomorrow.d === day.d ? `de mañana, ${formatSlot(new Date(appt.startsAt))}` : `del ${formatSlot(new Date(appt.startsAt))}`;
  return `Hola${first ? `, ${first}` : ''} 🙂 Te recordamos tu ${appt.service} ${when}${appt.location ? `, en ${appt.location}` : ''}. ¿Nos confirmas que vienes? Si necesitas cambiarla, me dices por aquí.`;
}

/** Por qué no se puede enviar solo; null si se puede. */
function manualReason(c: Contact | null): string | null {
  if (!c) return 'El contacto ya no existe.';
  if (c.humanMode) return `La conversación la lleva ${c.humanBy ?? 'alguien del equipo'}: el recordatorio va mejor de su parte.`;
  if (c.channel === 'whatsapp' || c.channel === 'meta') return null;
  return contactNumber(c) ? 'Llegó por el chat del sitio: recuérdale por WhatsApp.' : 'Llegó por el chat del sitio y no dejó número.';
}

/** Las citas a las que ya les toca el recordatorio y aún no lo tienen. */
export function dueReminders(now = Date.now()): Appointment[] {
  return listAppointments({ from: now + HOUR, to: now + 3 * 24 * HOUR, status: 'confirmada' }).filter((a) => !a.reminder && reminderTime(a.startsAt) <= now);
}

let running = false;

/** Envía (o deja a mano) los recordatorios que tocan. Devuelve cuántos se enviaron solos y cuántos quedaron a mano. */
export async function runReminders(now = Date.now()): Promise<{ sent: number; manual: number; skipped: number }> {
  const out = { sent: 0, manual: 0, skipped: 0 };
  if (running || !cfg.enabled || !cfg.reminder.enabled) return out;
  running = true;
  try {
    for (const a of dueReminders(now)) {
      const fresh = getAppointment(a.id);
      if (!fresh || fresh.reminder || fresh.status !== 'confirmada') continue;
      // Agendó poco antes de la hora del recordatorio (o después): acaba de hablar con nosotros, no hace falta.
      if (a.createdAt > reminderTime(a.startsAt) - 2 * HOUR) {
        setReminder(a.id, 'no_hace_falta', 'Agendó hace poco.');
        out.skipped++;
        continue;
      }
      const c = getContact(a.userId);
      const text = reminderText(a, c, now);
      // Sin canal conectado (WhatsApp apagado), sendToContact solo lo guardaría: no se da por enviado.
      const reason = manualReason(c) ?? (canDeliver(a.userId) ? null : `${c!.channel === 'meta' ? 'WhatsApp oficial' : 'WhatsApp'} no está conectado: recuérdale desde el teléfono.`);
      if (reason) {
        setReminder(a.id, 'a_mano', reason);
        out.manual++;
        continue;
      }
      try {
        if (replyWindow(a.userId, now).open) await sendToContact(a.userId, text, 'bot');
        else if (cfg.reminder.metaTemplate && canSendTemplate(a.userId)) {
          const first = (c!.name ?? '').split(' ')[0] || 'hola';
          await sendTemplateToContact(a.userId, { ...cfg.reminder.metaTemplate, params: [first, formatSlot(new Date(a.startsAt))] }, text);
        } else {
          setReminder(a.id, 'a_mano', 'Pasaron más de 24 horas desde su último mensaje y no hay plantilla de recordatorio aprobada en Meta (appointments.reminder.metaTemplate).');
          out.manual++;
          continue;
        }
        setReminder(a.id, 'enviado');
        awaitReminderReply(a.userId, a.id);
        out.sent++;
      } catch (err) {
        setReminder(a.id, 'a_mano', `No se pudo enviar: ${(err as Error).message.slice(0, 160)}`);
        out.manual++;
      }
    }
  } finally {
    running = false;
  }
  return out;
}

/** Para Hoy: las citas de las próximas 36 horas con el estado de su recordatorio y, si toca a mano, el texto y el número. */
export function remindersBoard(now = Date.now()) {
  if (!cfg.enabled || !cfg.reminder.enabled) return [];
  return listAppointments({ from: now, to: now + 36 * HOUR, status: 'confirmada' }).map((a) => {
    const c = getContact(a.userId);
    return { ...a, label: formatSlot(new Date(a.startsAt)), remindAt: reminderTime(a.startsAt), text: reminderText(a, c, now), number: contactNumber(c) };
  });
}

let timer: NodeJS.Timeout | null = null;
export function startReminders(): void {
  if (timer || !cfg.enabled || !cfg.reminder.enabled) return;
  const tick = () => void runReminders().then((r) => r.sent + r.manual && console.log(`[recordatorios] ${r.sent} enviados · ${r.manual} a mano`)).catch((err) => console.warn('[recordatorios]', (err as Error).message));
  timer = setInterval(tick, 60_000);
  timer.unref();
  setTimeout(tick, 5_000).unref(); // al arrancar, lo que haya quedado pendiente mientras estuvo apagado
}
