// Cada turno del asistente, guardado: qué entendió, por dónde lo mandó, con qué modelo, qué guardas saltaron, cuánto
// costó y con qué versión del código y del prompt salió.
//
// Hasta ahora eso vivía en `console.log` y en la memoria del monitor de demostración (crm/vivo.ts): se perdía al
// reiniciar, y no había cómo unir una respuesta concreta con lo que costó. La pregunta que esto contesta es la que
// llega siempre después de algo raro: «¿por qué le contestó ESO a este cliente?».
//
// 🪤 El identificador viaja solo, con AsyncLocalStorage, desde que entra el mensaje hasta que sale la respuesta:
// cada llamada a un modelo (llm/usage.ts) y cada mensaje guardado (agent/memory.ts) lo toman de ahí. Pasarlo de
// función en función era tocar treinta firmas y olvidar una; olvidar una es tener una llamada que nadie sabe de qué
// turno salió.
//
// 🪤 Lo que se dispara DESDE un turno pero no es de él —el análisis que corre un minuto después, en silencio— se
// saca del turno con `fueraDelTurno`. Si no, su gasto quedaría cargado a una respuesta que no lo causó.
//
// No guarda el texto: los mensajes ya están en `messages`, unidos por la misma columna. Aquí va lo que no se ve.
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { getDb } from '../rag/store.js';
import { costUsd } from '../llm/usage.js';
import { version } from '../version.js';

interface EnCurso {
  id: string;
  /** Las guardas que saltaron en este turno («promesa:50 %», «sin_respaldo:wifi»…). */
  guardas: string[];
}
const actual = new AsyncLocalStorage<EnCurso>();

export const nuevoTurno = (): string => `t_${Date.now().toString(36)}${randomUUID().replace(/-/g, '').slice(0, 6)}`;
/** El turno en curso, o null fuera de uno. */
export const idDelTurno = (): string | null => actual.getStore()?.id ?? null;
/** Corre `fn` como un turno: todo lo que haga, aunque sea asíncrono, queda con ese id. */
export function enUnTurno<T>(id: string, fn: () => T): T {
  return actual.run({ id, guardas: [] }, fn);
}
/** Corre `fn` fuera de cualquier turno (y lo que deje programado, también). */
export function fueraDelTurno<T>(fn: () => T): T {
  return actual.exit(fn);
}
/** Anota que una guarda saltó en el turno en curso. Fuera de un turno no hace nada. */
export function anotarGuarda(nombre: string): void {
  actual.getStore()?.guardas.push(nombre);
}
export const guardasDelTurno = (): string[] => [...(actual.getStore()?.guardas ?? [])];

export interface Turno {
  id: string;
  ts: number;
  userId: string;
  channel: string;
  intent: string | null;
  /** Cómo se clasificó: regex, el motor, «rápida», «tope»… */
  via: string | null;
  ruta: string | null;
  motor: string | null;
  modelo: string | null;
  rol: string | null;
  ms: number | null;
  /** No hubo respuesta automática (solo escuchar, modo humano, modo prueba). */
  silencio: boolean;
  guardas: string[];
  /** Huella de las instrucciones del asistente: cambia cuando cambia el prompt. */
  prompt: string | null;
  version: string;
  error: string | null;
}

const NOVENTA_DIAS = 90 * 86400_000;
let ultimaPoda = 0;

/** Guarda un turno. 🪤 Nunca lanza: un fallo al guardar la traza no puede dejar a un cliente sin su respuesta. */
export function guardarTurno(t: Omit<Turno, 'ts' | 'version'> & { ts?: number }): void {
  try {
    const db = getDb();
    const ahora = t.ts ?? Date.now();
    if (ahora - ultimaPoda > 3600_000) {
      ultimaPoda = ahora;
      podarTurnos(ahora);
    }
    db.prepare(
      `INSERT OR REPLACE INTO turnos (id, ts, user_id, channel, intent, via, ruta, motor, modelo, rol, ms, silencio, guardas, prompt, version, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      t.id,
      ahora,
      t.userId,
      t.channel,
      t.intent,
      t.via,
      t.ruta,
      t.motor,
      t.modelo,
      t.rol,
      t.ms,
      t.silencio ? 1 : 0,
      JSON.stringify(t.guardas),
      t.prompt,
      version().commit,
      t.error,
    );
  } catch (err) {
    console.warn('[turnos] no pude guardar el turno:', (err as Error).message);
  }
}

/**
 * Los turnos se guardan 90 días: lo que se investiga es lo de esta semana, y pasado eso solo ocupan. El consumo y los
 * mensajes no se tocan: tienen sus propias reglas.
 */
export function podarTurnos(ahora = Date.now()): number {
  return Number(getDb().prepare('DELETE FROM turnos WHERE ts < ?').run(ahora - NOVENTA_DIAS).changes);
}

export interface Llamada {
  task: string;
  engine: string;
  model: string;
  entrada: number;
  cache: number;
  salida: number;
  razonamiento: number;
  ms: number;
  costoUsd: number | null;
}

/** Un turno con sus llamadas a modelos, su costo y sus mensajes. null si no existe (o ya se podó). */
export function turnoDe(id: string): (Turno & { llamadas: Llamada[]; costoUsd: number; sinPrecio: boolean; mensajes: { id: number; role: string; author: string; content: string }[] }) | null {
  const db = getDb();
  const r = db.prepare('SELECT * FROM turnos WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!r) return null;
  const llamadas = (
    db
      .prepare('SELECT task, engine, model, input_tokens, cached_tokens, output_tokens, reasoning_tokens, COALESCE(segundos, 0) segundos, ms FROM llm_usage WHERE turno = ? ORDER BY id')
      .all(id) as Record<string, number | string>[]
  ).map((l) => ({
    task: String(l.task),
    engine: String(l.engine),
    model: String(l.model),
    entrada: Number(l.input_tokens),
    cache: Number(l.cached_tokens),
    salida: Number(l.output_tokens),
    razonamiento: Number(l.reasoning_tokens),
    ms: Number(l.ms),
    costoUsd: costUsd(String(l.engine), String(l.model), Number(l.input_tokens), Number(l.cached_tokens), Number(l.output_tokens), Number(l.segundos)),
  }));
  const mensajes = db.prepare('SELECT id, role, author, content FROM messages WHERE turno = ? ORDER BY id').all(id) as { id: number; role: string; author: string; content: string }[];
  let guardas: string[] = [];
  try {
    guardas = JSON.parse(String(r.guardas ?? '[]')) as string[];
  } catch {
    guardas = [];
  }
  return {
    id: String(r.id),
    ts: Number(r.ts),
    userId: String(r.user_id),
    channel: String(r.channel ?? ''),
    intent: (r.intent as string | null) ?? null,
    via: (r.via as string | null) ?? null,
    ruta: (r.ruta as string | null) ?? null,
    motor: (r.motor as string | null) ?? null,
    modelo: (r.modelo as string | null) ?? null,
    rol: (r.rol as string | null) ?? null,
    ms: r.ms == null ? null : Number(r.ms),
    silencio: Boolean(r.silencio),
    guardas,
    prompt: (r.prompt as string | null) ?? null,
    version: String(r.version ?? ''),
    error: (r.error as string | null) ?? null,
    llamadas,
    costoUsd: llamadas.reduce((a, l) => a + (l.costoUsd ?? 0), 0),
    sinPrecio: llamadas.some((l) => l.costoUsd === null),
    mensajes,
  };
}
