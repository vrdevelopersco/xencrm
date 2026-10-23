// Bus de eventos en memoria: alimenta el tablero (SSE) y el widget (respuestas humanas en vivo).
import { EventEmitter } from 'node:events';

export type CrmEventType =
  | 'message'
  /** Un mensaje que ya estaba en la conversación cambió de estado: no salió, o salió al reintentarlo. */
  | 'message_estado'
  | 'contact'
  | 'analysis'
  | 'appointment'
  | 'handoff'
  | 'notification'
  | 'propuesta'
  | 'bot_failed'
  | 'engine_down'
  | 'verification'
  | 'reminder_reply'
  | 'cross_channel'
  | 'public_down'
  | 'public_up'
  | 'presupuesto';
export interface CrmEvent {
  type: CrmEventType;
  userId: string;
  ts: number;
  payload: Record<string, unknown>;
}

const bus = new EventEmitter();
bus.setMaxListeners(200);

export function emitEvent(type: CrmEventType, userId: string, payload: Record<string, unknown> = {}) {
  const ev: CrmEvent = { type, userId, ts: Date.now(), payload };
  bus.emit('event', ev);
}

export function onEvent(listener: (ev: CrmEvent) => void): () => void {
  bus.on('event', listener);
  return () => bus.off('event', listener);
}
