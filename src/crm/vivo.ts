// Lo que está pasando ahora mismo, turno a turno, para mirarlo mientras ocurre.
//
// Es el monitor de quien está enseñando el producto en vivo: en la pantalla grande va la conversación y aquí, en
// un portátil al lado, va lo que la conversación no dice — si esa respuesta salió del guion o la improvisó el
// modelo, cuánto tardó, si el asistente acaba de admitir que no sabe algo. Con eso se decide lo único que se
// puede decidir en mitad de una demostración: seguir preguntando o parar aquí.
//
// 🪤 Vive EN MEMORIA y se pierde al reiniciar, a propósito. Esto no es historial —el historial ya está en la base
// y es el bueno— son las tripas de los últimos minutos: cuánto tardó cada llamada, qué motor contestó, qué ruta
// tomó. Guardarlo sería crear una segunda copia de las conversaciones, con datos de clientes dentro, que nadie
// pidió y que habría que cuidar. Para lo que sirve, media hora de memoria sobra.
import { getContact } from './contacts.js';
import { usageSummary } from '../llm/usage.js';

export interface Turno {
  ts: number;
  userId: string;
  nombre: string;
  pregunta: string;
  respuesta: string;
  /** Por dónde salió: el guion, el modelo, una plantilla, el flujo de citas. */
  ruta: string;
  motor: string;
  modelo: string;
  ms: number;
  intent: string;
  /** Lo que habría que estar mirando de ese turno. Vacío = todo normal. */
  alarmas: string[];
}

/** Cuántos turnos se recuerdan. Una demostración son veinte; cien es de sobra y no pesa nada. */
const CUANTOS = 100;
const turnos: Turno[] = [];
/**
 * Desde cuándo se cuenta el gasto de esta demostración.
 *
 * 🪤 No es «desde que arrancó el proceso»: entonces la cuenta arrastraría lo del ensayo de la mañana y el número
 * que se enseña al final —«esta demo costó tanto»— sería falso por arriba, que es la peor dirección para
 * equivocarse delante de un cliente. Se pone a cero con «Empezar limpio», justo antes de salir.
 */
let desde = Date.now();

/** Más de esto en una demostración es una pausa que se nota desde la última fila. */
const LENTO_MS = 6000;

/**
 * Señales de que algo merece una mirada.
 *
 * 🪤 «Improvisada» NO quiere decir mal. El modelo contesta bien casi siempre y por eso existe. Lo que significa
 * es que esa respuesta no la escribió nadie y no estaba prevista, así que es la que puede tardar, cambiar de
 * tono o admitir que no sabe — y quien está presentando necesita saber en qué momento dejó de pisar terreno
 * preparado. Marcarla no es una alarma de error: es el aviso de que se salió del guion.
 */
function mirarEsto(t: Omit<Turno, 'alarmas'>): string[] {
  const a: string[] = [];
  if (t.ruta.startsWith('respuesta rápida')) {
    // Nada que mirar: esto lo escribió una persona y salió tal cual.
  } else if (t.motor !== 'none' && t.motor !== 'template') {
    a.push('improvisada por el modelo');
  }
  if (t.ms >= LENTO_MS) a.push(`tardó ${(t.ms / 1000).toFixed(1)} s`);
  if (t.motor === 'none') a.push('no contestó');
  // Admitir que no se sabe algo está BIEN —es lo que se le pide— pero delante de un jurado conviene verlo venir.
  if (/no tengo (ese|el) dato|no s[ée] |no cuento con|te confirmo|lo verifico|lo consulto con el equipo/i.test(t.respuesta)) {
    a.push('dijo que no sabe');
  }
  if (t.intent === 'humano') a.push('pidió una persona');
  return a;
}

export function anotarTurno(t: Omit<Turno, 'alarmas' | 'nombre'>): void {
  const c = getContact(t.userId);
  const turno: Turno = { ...t, nombre: c?.name || t.userId.replace(/^\w+:/, '').slice(0, 14), alarmas: [] };
  turno.alarmas = mirarEsto(turno);
  turnos.push(turno);
  if (turnos.length > CUANTOS) turnos.splice(0, turnos.length - CUANTOS);
}

/** Lo que ve el monitor: los últimos turnos y cómo va cada conversación. */
export function comoVa(cuantos = 25): {
  turnos: Turno[];
  conversaciones: { userId: string; nombre: string; turnos: number; puntaje: number | null; temperatura: string; porElGuion: number; improvisadas: number; msMedio: number }[];
} {
  const ultimos = turnos.slice(-cuantos);
  const porChat = new Map<string, Turno[]>();
  for (const t of turnos) porChat.set(t.userId, [...(porChat.get(t.userId) ?? []), t]);

  const conversaciones = [...porChat.entries()].map(([userId, ts]) => {
    const c = getContact(userId);
    const guion = ts.filter((x) => x.ruta.startsWith('respuesta rápida')).length;
    // Solo las que costaron una llamada cuentan para la media: meter las instantáneas la hunde y haría
    // parecer que todo va rapidísimo justo cuando lo que importa es cuánto tarda lo que SÍ pasa por el modelo.
    const delModelo = ts.filter((x) => x.motor !== 'template' && x.motor !== 'none');
    return {
      userId,
      nombre: c?.name || ts[ts.length - 1]?.nombre || userId,
      turnos: ts.length,
      puntaje: c?.score ?? null,
      // La temperatura sale del puntaje con los mismos cortes que usa el tablero (60 y 30): no es un campo
      // aparte, y duplicar los cortes aquí sería que un día digan cosas distintas.
      temperatura: c?.score == null ? '' : c.score >= 60 ? 'caliente' : c.score >= 30 ? 'tibio' : 'frío',
      porElGuion: guion,
      improvisadas: delModelo.length,
      msMedio: delModelo.length ? Math.round(delModelo.reduce((s, x) => s + x.ms, 0) / delModelo.length) : 0,
    };
  });
  return { turnos: ultimos, conversaciones };
}

/** Para empezar limpio antes de salir al escenario: también pone el contador de gasto a cero. */
export function olvidarTodo(): void {
  turnos.length = 0;
  desde = Date.now();
}

/**
 * Lo que lleva gastado esta demostración, en dinero.
 *
 * Sale del registro propio de XENCRM, no de OpenAI: la API de OpenAI solo deja leer el gasto con una clave de
 * Admin (`sk-admin-…`), y una de proyecto —la que usa un cliente— no puede, por muchos permisos que se le den.
 * Da igual: aquí está desglosado por tarea y por modelo, que es más de lo que daría allá.
 */
export function gastoDeLaDemo(): { usd: number; llamadas: number; desde: number; porTarea: { tarea: string; usd: number; llamadas: number }[] } {
  const s = usageSummary(desde);
  const porTarea = new Map<string, { usd: number; llamadas: number }>();
  for (const r of s.rows) {
    const a = porTarea.get(r.task) ?? { usd: 0, llamadas: 0 };
    a.usd += r.costUsd ?? 0;
    a.llamadas += r.calls;
    porTarea.set(r.task, a);
  }
  return {
    usd: s.totalUsd ?? 0,
    llamadas: s.rows.reduce((n, r) => n + r.calls, 0),
    desde,
    porTarea: [...porTarea.entries()].map(([tarea, v]) => ({ tarea, ...v })).sort((a, b) => b.usd - a.usd),
  };
}
