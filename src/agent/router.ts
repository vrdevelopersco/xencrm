import { env } from '../config.js';
import { isAvailable, roleEngine, type Engine } from '../llm/engines.js';
import { openaiModel } from '../llm/openai.js';
import type { Intent } from './prompts.js';

export interface RouteInput {
  intent: Intent;
  userText: string;
  historyLength: number; // mensajes (usuario+asistente)
  estimatedTokens: number; // persona + contexto + historial condensado + mensaje (importa para Apple)
  outOfStock?: boolean; // algún producto relevante está agotado: hay que sugerir alternativas
  lastRole?: 'light' | 'heavy'; // qué rol respondió el turno anterior de este cliente
  details?: boolean; // el cliente pide información/especificaciones/cuidados de un producto
}
export interface Route {
  engine: Engine;
  role: 'light' | 'heavy';
  reason: string;
}

// Seguimientos cortos que dependen de lo que acaba de decir el asistente ("la primera", "dale, el link"):
// si el turno anterior lo llevó el motor pesado, él sigue; tiene el hilo completo.
const FOLLOWUP_RE = /\b(la primera|el primero|la segunda|el segundo|la tercera|el tercero|es[ae]s?|la otra|el otro|los dos|ambos|link|enlace|dale|ok)\b/i;
// Preguntas con montos (costo de envío, mínimos, reembolsos): el modelo pequeño tiende a inventar cifras.
const MONEY_RE = /cu[aá]nto|\bvale|cuesta|costo|precio|tarifa|valor|m[ií]nimo|gratis|descuento|reembols/i;
// Señales de que el turno pide recomendar/comparar: trabajo "de adulto" para el modelo grande.
const HEAVY_RE =
  /recomiend|sugier|aconsej|\bcu[aá]l(es)?\b|\bmejor(es)?\b|diferenc|compar|opcion|alternativ|\bideas?\b|regal|\bpara (mi|un|una|el|la|los|las)\b|qu[eé] (me )?(sirve|conviene)|no s[eé] (qu[eé]|cu[aá]l)|presupuesto|no pase de|menos de|m[aá]ximo|m[aá]s barat|econ[oó]mic|\d+ ?(mil|k)\b/i;

/**
 * Decide qué motor responde el turno, por roles (LIGHT_ENGINE / HEAVY_ENGINE en .env):
 * - liviano: saludos, info de tienda y compras puntuales (un producto, el enlace, un precio).
 * - pesado: recomendaciones/comparaciones, detalles, turnos con mucho contexto o historial largo.
 * Si solo hay un motor disponible, se usa ese. Con OpenAI en ambos roles, lo que cambia es el modelo.
 */
export function chooseEngine(input: RouteInput): Route {
  const light = roleEngine('light');
  const heavy = roleEngine('heavy');
  const L = (reason: string): Route => ({ engine: light, role: 'light', reason });
  const H = (reason: string): Route => ({ engine: heavy, role: 'heavy', reason });
  if (light === heavy && (light !== 'openai' || openaiModel('light') === openaiModel('heavy'))) {
    return L(env.llmEngine !== 'router' ? `forzado LLM_ENGINE=${light}` : 'un solo motor');
  }
  const lightOk = isAvailable(light);
  const heavyOk = isAvailable(heavy);
  if (!lightOk && !heavyOk) return H('ningún motor disponible');
  if (!lightOk) return H(`${light} no disponible`);
  if (!heavyOk) return L(`${heavy} no disponible`);

  // Un saludo o cortesía no necesita historial ni contexto: siempre al motor rápido.
  if (input.intent === 'saludo') return L('saludo');
  if (light === 'apple' && input.estimatedTokens > env.appleMaxPromptTokens) return H(`contexto ~${input.estimatedTokens} tokens`);
  if (input.historyLength >= 12) return H('historial largo');
  if (input.intent === 'info_tienda') {
    if (MONEY_RE.test(input.userText)) return H('info de tienda con montos');
    return L('info de tienda');
  }
  // compra
  if (input.details) return H('detalles de producto');
  const words = input.userText.trim().split(/\s+/).length;
  if (input.lastRole === 'heavy' && words <= 8 && FOLLOWUP_RE.test(input.userText)) return H('continuidad tras recomendación');
  const questions = (input.userText.match(/\?/g) ?? []).length;
  if (HEAVY_RE.test(input.userText)) return H('recomendación/comparación');
  if (input.outOfStock) return H('producto agotado, sugerir alternativa');
  if (questions >= 2) return H('varias preguntas');
  return L('compra puntual');
}
