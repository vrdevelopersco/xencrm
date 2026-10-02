// Modo prueba: que aiva conteste SOLO a unos chats concretos, y a nadie más.
//
// Para una demostración en vivo. Sin esto hay que elegir entre dos cosas malas: dejar el canal encendido —y que
// aiva le conteste a cualquier cliente de verdad que escriba en mitad de la demo— o apagarlo entero, y entonces
// tampoco contesta a quien está enseñando. Aquí se dice a quién sí, y el resto del mundo se queda como en «Mira»:
// sus mensajes entran al CRM y los atiende una persona después.
//
// 🪤 CADUCA SOLA, y esa es la mitad del diseño. Lo que pasa cuando esto se queda encendido no es un fallo visible
// —nada se rompe, nada da error— es que los clientes de verdad escriben y nadie les contesta, durante días, hasta
// que alguien se pregunta por qué bajaron las ventas. Una demostración dura una tarde y quien la da está pensando
// en otra cosa cuando termina. Así que no se apaga: se vence.
//
// 🪤 Y una lista VACÍA significa apagado, nunca «no contestarle a nadie». Es la diferencia entre un modo que se
// olvida encendido y un CRM mudo: si alguien borra el último chat de la lista, lo que quiere es volver a la
// normalidad, no silenciar el negocio entero.
import { getSetting, setSetting } from './settings.js';

export interface ModoPrueba {
  /** Los chats a los que sí se contesta. Tal como los escribió quien montó la prueba. */
  chats: string[];
  /** Cuándo se vence, en milisegundos. */
  hasta: number;
  /** Quién la puso, para que se sepa a quién preguntarle. */
  por: string;
}

const CLAVE = 'prueba.solo';
/** Lo máximo que puede durar. Una demostración no dura un día; si hace falta más, se vuelve a poner. */
export const HORAS_MAXIMO = 12;

/** Solo los dígitos: un teléfono se escribe de seis maneras y todas tienen que valer. */
const soloNumeros = (s: string): string => s.replace(/\D/g, '');

/** La prueba que esté corriendo, o null. Vencida es como no haberla. */
export function pruebaActiva(ahora = Date.now()): ModoPrueba | null {
  const g = getSetting<ModoPrueba | null>(CLAVE, null);
  if (!g || !Array.isArray(g.chats) || !g.chats.length) return null;
  if (!Number.isFinite(g.hasta) || g.hasta <= ahora) return null;
  return { chats: g.chats.map(String), hasta: Number(g.hasta), por: String(g.por ?? '') };
}

export function ponerPrueba(chats: string[], horas: number, por: string): ModoPrueba {
  const limpios = [...new Set(chats.map((c) => c.trim()).filter(Boolean))].slice(0, 20);
  if (!limpios.length) throw new Error('dime a qué chats sí les puede contestar');
  const h = Math.min(HORAS_MAXIMO, Math.max(0.25, Number(horas) || 2));
  const modo: ModoPrueba = { chats: limpios, hasta: Date.now() + h * 3600_000, por: por.slice(0, 60) };
  setSetting(CLAVE, modo);
  return modo;
}

export function quitarPrueba(): void {
  setSetting(CLAVE, null);
}

/**
 * ¿Aiva puede contestarle a este?
 *
 * Sin prueba en marcha, a todo el mundo: esta función no debe cambiar nada mientras nadie la use. Con prueba en
 * marcha, solo a los de la lista.
 *
 * 🪤 Se compara por los DÍGITOS y por el final, no por la cadena entera. Quien monta una demostración escribe
 * «300 123 4567» o «+57 300 1234567»; lo que llega por el canal es `wa:573001234567@s.whatsapp.net`. Exigir que
 * coincidan letra por letra haría que la lista no casara nunca y que aiva se quedara muda en su propia demo,
 * que es exactamente el peor momento para descubrirlo.
 */
export function puedeContestar(userId: string, ahora = Date.now()): boolean {
  const p = pruebaActiva(ahora);
  if (!p) return true;
  const id = userId.toLowerCase();
  const digitos = soloNumeros(userId);
  return p.chats.some((c) => {
    const d = soloNumeros(c);
    // Un número: casa si uno termina en el otro (con o sin indicativo del país).
    if (d.length >= 7 && digitos.length >= 7) return digitos.endsWith(d) || d.endsWith(digitos);
    // Cualquier otra cosa (un id de sesión web, un trozo de jid): que aparezca dentro.
    const t = c.trim().toLowerCase();
    return t.length >= 4 && id.includes(t);
  });
}

/** Cuánto le queda, en palabras, para poder decirlo sin hacer cuentas. */
export function cuantoLeQueda(p: ModoPrueba, ahora = Date.now()): string {
  const min = Math.max(0, Math.round((p.hasta - ahora) / 60_000));
  if (min < 1) return 'se está venciendo';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}
