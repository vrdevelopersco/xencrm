// Notificaciones para el equipo: lo que merece atención, derivado del bus de eventos. Se guardan en memoria (últimas 100).
import { regla } from '../reglas.js';
import { business } from '../config.js';
import { onEvent, emitEvent, type CrmEvent } from './events.js';
import { getContact, type Contact } from './contacts.js';
import { formatSlot, nextAppointmentFor } from './appointments.js';
import { channelName } from './cross.js';
import { recap } from './recap.js';

export interface Notification {
  id: number;
  ts: number;
  userId: string;
  kind: 'handoff' | 'hot' | 'appointment' | 'new' | 'fail' | 'engine' | 'verify' | 'public' | 'cross' | 'recordatorio' | 'propuesta' | 'presupuesto';
  title: string;
  body: string;
}

const items: Notification[] = [];
let seq = 0;

function push(kind: Notification['kind'], userId: string, title: string, body: string) {
  const n: Notification = { id: ++seq, ts: Date.now(), userId, kind, title, body };
  items.push(n);
  if (items.length > 100) items.shift();
  emitEvent('notification', userId, { notification: n });
}

/**
 * Un recordatorio que XENCRM NO va a mandar, para que lo mande una persona.
 *
 * 🪤 Cuando el canal está en «solo escuchar», XENCRM no le escribe al cliente — ni siquiera para recordarle una
 * cita. Pero callarse y no decir nada es perder la cita: el aviso tiene que ir a alguien, y ese alguien es el
 * equipo. Por eso sale por la campana y no por WhatsApp.
 */
export function avisarRecordatorio(userId: string, titulo: string, cuerpo: string): void {
  push('recordatorio', userId, titulo, cuerpo);
}

function nameOf(userId: string): string {
  const c = getContact(userId);
  return c?.name || userId.replace(/^(wa|meta|web|cli|mcp):/, '').replace(/@.*$/, '').slice(0, 14);
}

let started = false;
export function startNotifications() {
  if (started) return;
  started = true;
  onEvent((ev: CrmEvent) => {
    const p = ev.payload as Record<string, unknown>;
    if (ev.type === 'propuesta') {
      const prop = p.propuesta as { texto?: string; conPersona?: boolean } | undefined;
      // 🪤 La que se deja mientras la lleva una persona no va a la campana: esa persona ya está en la conversación.
      if (!prop?.conPersona) push('propuesta', ev.userId, `Respuesta lista para ${nameOf(ev.userId)}`, (prop?.texto ?? '').slice(0, 120));
    }
    if (ev.type === 'handoff' && p.on && p.by === 'bot') {
      if (p.motivo === 'tope') push('handoff', ev.userId, `${nameOf(ev.userId)} pasó al equipo`, 'Se llegó al tope de gasto de IA del mes y su mensaje necesitaba IA: contéstale desde aquí.');
      else push('handoff', ev.userId, `${nameOf(ev.userId)} pidió hablar con una persona`, `${business.agent.name} está en pausa en esa conversación.`);
    }
    if (ev.type === 'presupuesto') {
      const titulo = p.nivel === 'agotado' ? 'Se llegó al tope de gasto de IA' : p.nivel === 'ahorro' ? 'Gasto de IA al 90 %: modo ahorro' : 'Gasto de IA al 80 % del tope';
      push('presupuesto', 'system', titulo, String(p.texto ?? ''));
    }
    if (ev.type === 'analysis') {
      const score = Number(p.score ?? 0);
      const prev = Number(p.prevScore ?? 0);
      const caliente = regla<number>('puntaje.caliente');
      if (score >= caliente && prev < caliente) {
        const c = p.contact as Contact | undefined;
        const why = c ? recap(c, nextAppointmentFor(c.id)) || c.summary : '';
        push('hot', ev.userId, `${nameOf(ev.userId)} está caliente (${score})`, why || 'Vale la pena darle seguimiento.');
      }
    }
    if (ev.type === 'appointment') {
      const a = p.appointment as { startsAt: number; status: string; notes?: string } | undefined;
      const moved = /^Reprogramada/.test(a?.notes ?? '');
      if (a?.status === 'confirmada')
        push('appointment', ev.userId, moved ? `${nameOf(ev.userId)} movió su cita` : `Cita agendada con ${nameOf(ev.userId)}`, `${moved ? 'Ahora es el ' : ''}${formatSlot(new Date(a.startsAt))}`);
      // Lo que cancela el cliente por el chat se avisa; lo que cancela el equipo desde el tablero, no (ya lo sabe).
      if (a?.status === 'cancelada' && p.by === 'bot' && !/Reprogramada por el cliente/.test(a.notes ?? ''))
        push('appointment', ev.userId, `${nameOf(ev.userId)} canceló su cita`, `Era el ${formatSlot(new Date(a.startsAt))}. El espacio quedó libre.`);
    }
    // La misma persona apareció por otro canal: el equipo puede unir las fichas desde la suya.
    if (ev.type === 'cross_channel') {
      const desde = channelName(String(p.channel ?? ''));
      const aqui = channelName(getContact(ev.userId)?.channel ?? '');
      push('cross', ev.userId, `${nameOf(ev.userId)} escribió por ${aqui}`, `Ya venía hablando por ${desde}. ${business.agent.name} siguió la conversación; en su ficha puedes unirlas.`);
    }
    if (ev.type === 'reminder_reply' && p.reply === 'no_puede') {
      const a = p.appointment as { startsAt: number } | undefined;
      push('appointment', ev.userId, `${nameOf(ev.userId)} no puede ir a su cita`, `${a ? `Era el ${formatSlot(new Date(a.startsAt))}. ` : ''}${business.agent.name} le ofreció cambiarla o cancelarla.`);
    }
    if (ev.type === 'verification') {
      const v = p.verification as { status?: string; question?: string; createdAt?: number } | undefined;
      if (v?.status === 'pendiente' && (v.createdAt ?? 0) > Date.now() - 60_000)
        push('verify', ev.userId, `${nameOf(ev.userId)} preguntó algo que ${business.agent.name} no sabe`, `«${String(v.question ?? '').slice(0, 120)}». Respóndele desde Hoy › Por verificar.`);
    }
    if (ev.type === 'public_down')
      push('public', 'system', 'La dirección pública no responde', `${String(p.error ?? '')}. Mientras tanto no funcionan el chat del sitio, WhatsApp oficial ni el tablero desde el celular. Revisa el túnel (Canales).`);
    if (ev.type === 'public_up') push('public', 'system', 'La dirección pública volvió a responder', String(p.url ?? ''));
    if (ev.type === 'bot_failed') push('fail', ev.userId, `${business.agent.name} no pudo responder a ${nameOf(ev.userId)}`, `Motivo: ${String(p.reason ?? 'error')}. El cliente recibió una disculpa; conviene responder a mano.`);
    if (ev.type === 'engine_down') push('engine', 'system', `Motor ${String(p.engine)} fuera de servicio`, `${String(p.reason ?? '')}. Las respuestas siguen con el otro motor si está disponible.`);
    if (ev.type === 'message' && p.author === 'customer') {
      const c = getContact(ev.userId);
      if (c && c.messageCount <= 1) push('new', ev.userId, `Nueva conversación: ${nameOf(ev.userId)}`, String(p.content ?? '').slice(0, 120));
    }
  });
}

export function listNotifications(limit = 30): Notification[] {
  return items.slice(-limit).reverse();
}
