// El puntaje se calcula cuando llega un mensaje, así que sin esto se queda congelado en su mejor momento: alguien
// que hace dos semanas no habla sigue apareciendo en 100 y "caliente". Aquí el puntaje envejece al leerlo, con el
// motivo a la vista, para que la lista de calientes sea de gente que de verdad está caliente hoy.
//
// Los tramos son un estimado hecho con lo que hay (10 conversaciones reales, 3 con cita, 1 venta): el orden importa
// más que el número exacto. Se revisa cuando haya ~20 citas con resultado marcado en Hoy › ¿Cómo les fue?
import type { ScoreFactor, Stage } from './contacts.js';

const DAY = 86400_000;

/** Cuántos puntos se le quitan a un prospecto por llevar días sin hablar. */
export function silencePenalty(lastMessageAt: number | null, stage: Stage, now = Date.now()): number {
  // Con cita agendada o ya vendido, el silencio es normal: el siguiente paso está puesto.
  if (stage === 'cita_agendada' || stage === 'vendido' || !lastMessageAt) return 0;
  const days = (now - lastMessageAt) / DAY;
  if (days < 3) return 0;
  if (days < 7) return 10;
  if (days < 14) return 25;
  return 40;
}

/** "4 días", "más de una semana", "3 semanas": para decir en la ficha por qué bajó. */
function silenceLabel(days: number): string {
  if (days < 7) return `${Math.floor(days)} días`;
  if (days < 14) return 'más de una semana';
  if (days < 35) return `${Math.floor(days / 7)} semanas`;
  return 'más de un mes';
}

/** El puntaje de hoy: el de la conversación menos lo que pesa el silencio, con ese descuento como un factor más. */
export function decayed(
  base: number,
  factors: ScoreFactor[],
  lastMessageAt: number | null,
  stage: Stage,
  now = Date.now(),
): { score: number; factors: ScoreFactor[] } {
  const penalty = silencePenalty(lastMessageAt, stage, now);
  if (!penalty) return { score: base, factors };
  const days = (now - (lastMessageAt as number)) / DAY;
  return {
    score: Math.max(0, base - penalty),
    factors: [...factors, { label: `Sin hablar hace ${silenceLabel(days)}`, points: -penalty }],
  };
}
