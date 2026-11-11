// El próximo paso de cada persona: qué hay que hacer con ella, en una frase, sin preguntarle a ningún modelo.
//
// Sale de lo que el tablero ya sabe —quién tiene la última palabra, si hay una cita, si se pospuso, cuánto lleva
// en silencio— y en el MISMO orden que Hoy: primero lo que más cuesta dejar quieto. Por eso alguien con cita dice
// «Cita el jueves» y no «Retomar»: la cita ya es el seguimiento. Y por eso las reglas de «retomar» son las de
// Seguimientos, con el mismo umbral de puntaje y las mismas 24 horas: si la frase y la lista no coincidieran, una
// de las dos estaría mintiendo.
//
// 🪤 Ningún modelo aquí. Una lista son quinientas fichas cada vez que se abre: con un modelo serían quinientas
// llamadas, y la frase cambiaría de una vez a otra sin que hubiera cambiado nada.

import { business } from '../config.js';
import { V } from '../vocabulario.js';
import { getDb } from '../rag/store.js';
import { listAppointments } from './appointments.js';
import { esPersona, estaCerrada, type Contact } from './contacts.js';
import { isSnoozed } from './followup.js';
import { listVerifications } from './verifications.js';

export type TipoPaso = 'verificar' | 'responder' | 'persona' | 'resultado' | 'cita' | 'pospuesto' | 'retomar' | 'escribir' | 'atiende' | 'ninguno';

export interface ProximoPaso {
  tipo: TipoPaso;
  /** La frase, lista para enseñar. Vacía cuando no hay nada que hacer: una venta cerrada no pide nada. */
  texto: string;
  /** Lo que se queda esperando a alguien del equipo. Es lo que se pinta de otro color, y nada más. */
  urgente: boolean;
  /** La fecha de la que habla la frase (la cita, hasta cuándo se pospuso), para ordenar por ella. */
  cuando: number | null;
}

/** Lo que hace falta saber de todas las fichas a la vez. Se arma una vez por lista, no una por ficha. */
export interface ContextoPaso {
  now: number;
  /** Fichas donde la última palabra es del cliente: nadie le ha contestado. */
  ultimaPalabraSuya: Set<string>;
  /** Fichas con algo que el asistente prometió averiguar y sigue sin respuesta. */
  verificando: Set<string>;
  /** La próxima cita confirmada de cada ficha. */
  proximaCita: Map<string, number>;
  /** La cita que ya pasó y sigue sin resultado (vino, no vino), de cada ficha. */
  sinResultado: Map<string, number>;
}

const DIA = 86400_000;
const RETOMAR_DESDE = 60; // el mismo umbral de «caliente» de Hoy y de Seguimientos

/** La fecha en el huso del negocio, para decir «hoy», «mañana» o «el jueves 16 oct» sin equivocarse de día. */
function diaLocal(ts: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: business.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts));
}

/** «hoy, 3:00 p. m.», «mañana, 10:30 a. m.» o «el jue 16 oct, 3:00 p. m.». */
export function cuandoCorto(ts: number, now: number): string {
  const hora = new Intl.DateTimeFormat('es-CO', { timeZone: business.timezone, hour: 'numeric', minute: '2-digit', hour12: true })
    .format(new Date(ts))
    .replace(/ /g, ' ');
  const d = diaLocal(ts);
  if (d === diaLocal(now)) return `hoy, ${hora}`;
  if (d === diaLocal(now + DIA)) return `mañana, ${hora}`;
  if (d === diaLocal(now - DIA)) return `ayer, ${hora}`;
  // Por partes y no con format(): según la versión de ICU sale «vie, 16 de oct.» o «vie 16 oct», y una prueba
  // que pasa en un Mac y falla en el servidor es peor que ninguna.
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('es-CO', { timeZone: business.timezone, weekday: 'short', day: 'numeric', month: 'short' }).formatToParts(new Date(ts)).map((x) => [x.type, x.value.replace(/\./g, '')]),
  );
  return `el ${p.weekday} ${p.day} ${p.month}, ${hora}`;
}

/** «el 20 oct», para lo que no lleva hora. */
function fechaCorta(ts: number): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('es-CO', { timeZone: business.timezone, day: 'numeric', month: 'short' }).formatToParts(new Date(ts)).map((x) => [x.type, x.value.replace(/\./g, '')]),
  );
  return `el ${p.day} ${p.month}`;
}

const dias = (n: number) => `${n} día${n === 1 ? '' : 's'}`;

/** Hace cuánto, en palabras cortas: «2 h», «3 días». */
function haceCuanto(ms: number): string {
  if (ms < 3600_000) return `${Math.max(1, Math.round(ms / 60_000))} min`;
  if (ms < DIA) return `${Math.round(ms / 3600_000)} h`;
  return dias(Math.round(ms / DIA));
}

export function proximoPaso(c: Contact, ctx: ContextoPaso): ProximoPaso {
  const { now } = ctx;
  const paso = (tipo: TipoPaso, texto: string, urgente = false, cuando: number | null = null): ProximoPaso => ({ tipo, texto, urgente, cuando });

  // Vendida o perdida: no pide nada. Una frase ahí sería ruido en la fila de alguien que ya está resuelto.
  if (estaCerrada(c.stage)) return paso('ninguno', '');

  // Lo que el asistente quedó de averiguar: el cliente está esperando una respuesta que solo tiene el equipo.
  if (ctx.verificando.has(c.id)) return paso('verificar', 'Responder lo que quedó de averiguar', true);

  const ultimo = c.lastMessageAt ?? c.lastSeen ?? now;
  // La última palabra es suya y nadie le contestó. Va antes que «pidió una persona» porque es lo mismo pero peor:
  // además de pedirla, escribió y está esperando.
  if (ctx.ultimaPalabraSuya.has(c.id)) return paso('responder', `Contestar: escribió hace ${haceCuanto(now - ultimo)}`, true, ultimo);

  // 🪤 «bot» es quién PASÓ la conversación, no quién la tiene: hasta que alguien la tome, no la tiene nadie.
  if (c.humanMode && (!c.humanBy || c.humanBy === 'bot')) return paso('persona', 'Atender: la pasaron al equipo', true);

  const sinResultado = ctx.sinResultado.get(c.id);
  if (sinResultado) return paso('resultado', `Anotar cómo le fue en ${V.la} ${V.cita} de ${cuandoCorto(sinResultado, now).replace(/^el /, '')}`, true, sinResultado);

  const cita = ctx.proximaCita.get(c.id);
  if (cita) return paso('cita', `${V.Cita} ${cuandoCorto(cita, now)}`, false, cita);

  if (isSnoozed(c, now)) {
    const hasta = Number(c.data.pospuesto_hasta);
    return paso('pospuesto', `Retomar ${fechaCorta(hasta)}`, false, hasta);
  }

  const callado = now - ultimo;
  if (callado >= DIA) {
    const n = Math.max(1, Math.round(callado / DIA));
    // Las mismas dos frases de Seguimientos, con el puntaje sin el descuento por silencio: justo los que fueron
    // buenos y se enfriaron por falta de seguimiento son los que hay que retomar.
    return c.scoreBase >= RETOMAR_DESDE
      ? paso('retomar', `Retomar: ${dias(n)} sin escribir`, true, ultimo)
      : paso('escribir', `Escribirle: ${dias(n)} sin escribir`, false, ultimo);
  }

  // Conversación viva: no hay que hacer nada, pero sí saber quién la tiene.
  // «bot», «admin» y «equipo» no son el nombre de nadie (ver esPersona): la ficha no puede decir «admin está atendiendo».
  if (c.humanMode) return paso('atiende', `${esPersona(c.humanBy) ? c.humanBy : 'El equipo'} está atendiendo`);
  return paso('atiende', `${business.agent.name || 'Xen'} está atendiendo`);
}

/**
 * Lo que proximoPaso necesita de todas las fichas, en cuatro consultas. Las citas van con tope alto porque una
 * cita que no entra en la lista haría decir «Retomar» a quien ya tiene una.
 */
export function contextoDelPaso(now = Date.now()): ContextoPaso {
  const ultimaPalabraSuya = new Set(
    (getDb().prepare("SELECT user_id FROM messages m WHERE role = 'user' AND ts = (SELECT MAX(ts) FROM messages WHERE user_id = m.user_id)").all() as { user_id: string }[]).map((r) => r.user_id),
  );
  const verificando = new Set(listVerifications('pendiente', 1000).map((v) => v.userId));
  const proximaCita = new Map<string, number>();
  for (const a of listAppointments({ from: now, status: 'confirmada', limit: 5000 })) if (!proximaCita.has(a.userId)) proximaCita.set(a.userId, a.startsAt);
  // La más reciente de las que ya pasaron: de esa es de la que hay que contar cómo fue.
  const sinResultado = new Map<string, number>();
  for (const a of listAppointments({ from: now - 14 * DIA, to: now, status: 'confirmada', limit: 5000 })) if (a.endsAt < now) sinResultado.set(a.userId, a.startsAt);
  return { now, ultimaPalabraSuya, verificando, proximaCita, sinResultado };
}
