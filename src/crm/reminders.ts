// Recordatorio de la cita el día antes, por el canal del cliente. Lo que no se puede enviar solo (chat del sitio,
// conversación que lleva una persona, WhatsApp oficial fuera de las 24 h sin plantilla) queda en Hoy para hacerlo a
// mano, con el texto listo. La respuesta del cliente ("ahí estaré", "no puedo") la atiende el flujo de citas.
import { business } from '../config.js';
import { formatSlot, getAppointment, listAppointments, setReminder, tzParts, zoned, type Appointment } from './appointments.js';
import { awaitReminderReply } from './booking.js';
import { agendaDe } from './sedes.js';
import { contactNumber, getContact, type Contact } from './contacts.js';
import { avisarRecordatorio } from './notifications.js';
import { soloEscucha, type ChannelId } from '../channels/switches.js';
import { canDeliver, canSendTemplate, replyWindow, sendTemplateToContact, sendToContact } from './outbox.js';

const cfg = business.appointments;
const HOUR = 3600_000;

/**
 * Cuándo se recuerda: el día anterior a la hora configurada, pero NUNCA un día que el negocio no trabaja.
 *
 * 🪤 Un recordatorio no es un aviso de una sola dirección: casi siempre alguien contesta. «Confirmo», «¿lo puedo
 * pasar al jueves?», «ya no voy». Mandarlo un domingo a las cinco de la tarde, con el negocio cerrado, significa
 * que esa respuesta se queda sin leer hasta el lunes —y si era para cancelar, el lunes ya es tarde: la hora se
 * perdió igual—. Lo vio Luigi en el tablero: una cita de lunes decía «se recuerda domingo a las 5pm», y DUNOR no
 * abre los domingos.
 *
 * Así que si cae en día cerrado, se va hacia ATRÁS al último día que sí se trabaja. Hacia atrás y no hacia
 * delante por lo mismo: un recordatorio que llega después de la cita no es un recordatorio.
 *
 * Y se topa a 7 días hacia atrás por si alguien configura un negocio que abre un solo día: mejor recordar con
 * mucha antelación que entrar en un bucle buscando un día que no existe.
 */
export function reminderTime(startsAt: number, sede: string | null = null): number {
  const p = tzParts(new Date(startsAt));
  const [hh, mm] = cfg.reminder.at.split(':').map(Number) as [number, number];
  // Los días que atiende la sede de la cita: si la del sur abre los domingos y la del norte no, el recordatorio de
  // una cita del lunes en la del sur puede salir el domingo.
  const dias = agendaDe(sede).days ?? [1, 2, 3, 4, 5];

  // 🪤 PRIMERO se intenta el MISMO día de la cita, a la hora configurada. Es lo que pide un recordatorio: «hoy a
  // las once tienes tu cita», leído esa mañana. El día anterior a las cinco de la tarde se olvida, y además caía
  // en domingo para las citas de lunes — con el negocio cerrado, de modo que si alguien contestaba «no puedo»,
  // nadie lo leía hasta que ya era tarde.
  const mismoDia = zoned(p.y, p.m, p.d, hh, mm);
  // Con al menos una hora de margen: un aviso que llega encima de la cita no avisa de nada.
  // 🪤 El día de la semana en la hora DEL NEGOCIO, no la de la máquina. Con getDay(), en un servidor en UTC un
  // recordatorio a las 7:30 p. m. de Bogotá ya es el día siguiente, y un domingo cerrado pasaba por lunes abierto.
  const diaDe = (t: Date) => tzParts(t).wd;
  if (mismoDia.getTime() <= startsAt - HOUR && dias.includes(diaDe(mismoDia))) return mismoDia.getTime();

  // Si no cabe —la hora configurada es posterior a la cita, o ese día no se trabaja— se va hacia ATRÁS, al
  // último día que sí se trabaja. Hacia atrás y nunca hacia delante: un recordatorio después de la cita no es
  // un recordatorio.
  let cuando = tzParts(new Date(zoned(p.y, p.m, p.d, 12, 0).getTime() - 24 * HOUR));
  for (let i = 0; i < 7; i++) {
    const t = zoned(cuando.y, cuando.m, cuando.d, hh, mm);
    if (dias.includes(diaDe(t))) return t.getTime();
    cuando = tzParts(new Date(zoned(cuando.y, cuando.m, cuando.d, 12, 0).getTime() - 24 * HOUR));
  }
  return zoned(cuando.y, cuando.m, cuando.d, hh, mm).getTime();
}

/** El texto del recordatorio, el mismo que se envía solo o que el equipo manda a mano. */
export function reminderText(appt: Appointment, contact: Contact | null, now = Date.now()): string {
  const first = (contact?.name ?? '').split(' ')[0];
  const day = tzParts(new Date(appt.startsAt));
  const esMismoDia = (p: { y: number; m: number; d: number }) => p.y === day.y && p.m === day.m && p.d === day.d;
  // 🪤 «Hoy» antes que «mañana». Desde que se recuerda la mañana de la cita, el caso normal es ese; sin esta
  // rama el mensaje decía «te recordamos tu cita del lunes, 5 de octubre» el propio lunes por la mañana, que es
  // la forma más fría de decir «hoy a las once» y obliga a mirar el calendario para entender un recordatorio.
  const when = esMismoDia(tzParts(new Date(now)))
    ? `de hoy, ${formatSlot(new Date(appt.startsAt), { withDay: false })}`
    : esMismoDia(tzParts(new Date(now + 24 * HOUR)))
      ? `de mañana, ${formatSlot(new Date(appt.startsAt))}`
      : `del ${formatSlot(new Date(appt.startsAt))}`;
  return `Hola${first ? `, ${first}` : ''} 🙂 Te recordamos tu ${appt.service} ${when}${appt.location ? `, en ${appt.location}` : ''}. ¿Nos confirmas que vienes? Si necesitas cambiarla, me dices por aquí.`;
}

/** Por qué no se puede enviar solo; null si se puede. */
function manualReason(c: Contact | null): string | null {
  if (!c) return 'El contacto ya no existe.';
  // 🪤 «Solo escuchar» es modo aprendizaje: aiva mira cómo atiende el negocio y no le escribe al cliente. Un
  // recordatorio automático lo rompería justo donde más se nota — el cliente recibiría un mensaje de un robot
  // en una conversación que hasta ahora llevaba una persona. Se recuerda igual, pero a través del equipo.
  if (soloEscucha(c.channel as ChannelId)) return 'El canal está en solo escuchar: aiva no le escribe al cliente. Mándaselo tú.';
  // «bot» es quien hizo el traspaso (pidió una persona, o se llegó al tope de gasto), no quien la lleva.
  if (c.humanMode) return `La conversación la lleva ${c.humanBy && c.humanBy !== 'bot' ? c.humanBy : 'alguien del equipo'}: el recordatorio va mejor de su parte.`;
  if (c.channel === 'whatsapp' || c.channel === 'meta') return null;
  return contactNumber(c) ? 'Llegó por el chat del sitio: recuérdale por WhatsApp.' : 'Llegó por el chat del sitio y no dejó número.';
}

/** Las citas a las que ya les toca el recordatorio y aún no lo tienen. */
export function dueReminders(now = Date.now()): Appointment[] {
  return listAppointments({ from: now + HOUR, to: now + 3 * 24 * HOUR, status: 'confirmada' }).filter((a) => !a.reminder && reminderTime(a.startsAt, a.sede) <= now);
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
      if (a.createdAt > reminderTime(a.startsAt, a.sede) - 2 * HOUR) {
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
        // Que no se quede esperando a que alguien entre a mirar: se avisa por la campana, con la cita y el porqué.
        avisarRecordatorio(a.userId, `Recuérdale su cita a ${c?.name || 'este cliente'}`, `${formatSlot(new Date(a.startsAt))} · ${reason}`);
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
    return { ...a, label: formatSlot(new Date(a.startsAt)), remindAt: reminderTime(a.startsAt, a.sede), text: reminderText(a, c, now), number: contactNumber(c) };
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
