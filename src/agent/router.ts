import { env } from '../config.js';
import { isAvailable, roleEngine, type Engine } from '../llm/engines.js';
import { openaiModel } from '../llm/openai.js';
import type { Intent } from './prompts.js';

export interface RouteInput {
  intent: Intent;
  userText: string;
  estimatedTokens: number; // persona + contexto + historial condensado + mensaje (importa para Apple)
  lastRole?: 'light' | 'heavy'; // qué rol respondió el turno anterior de este cliente
}
export interface Route {
  engine: Engine;
  role: 'light' | 'heavy';
  reason: string;
}

// El modelo pesado es para cuando el cliente pide algo específico: recomendar o comparar, detalles puntuales de una
// prenda, medidas o tallas, o una prenda con características ("un traje azul oscuro slim para la noche"). Saludar,
// agendar, decir si hay o no algo, dar un precio o tomar apuntes (evento, presupuesto) lo hace el liviano.
// Todo sobre el texto sin tildes.
const RECOMMEND_RE =
  /recomiend|recomendaci|sugier|sugerenci|aconsej|diferenci|compar|\bque me (?:sirve|conviene|queda|va)\b|\bcual (?:me|es mejor|elijo|escojo|le queda|queda mejor)\b|\bno se (?:que|cual)\b|\bque (?:me )?(?:pongo|uso|llevo)\b|\bcombin/;
// Detalles propios de una prenda (tela, corte, largo…) y detalles generales ("qué incluye", "cuidados"), que solo
// cuentan si se habla de una prenda: "¿qué incluye la asesoría?" es información del servicio, no de una prenda.
const GARMENT_DETAIL_RE =
  /\bde que (?:tela|material|esta hecho)\b|\btela\b|\bmaterial|\bforro\b|\bsolapa|\bbotones\b|\bcorte\b|\bslim\b|entallad|\bajust|\blargo\b|\bmangas?\b|\bhombros?\b|\bcintura\b|\bpecho\b|\bcomo (?:me queda|queda puesto)\b/;
const GENERIC_DETAIL_RE = /\bque (?:trae|incluye)\b|\bincluye\b|\bde que es\b|especificaci|caracteristic|\bdetalle|cuidad|\bcomo (?:se lava|se cuida)\b/;
// "Diseño a la medida" es un servicio, no pedir medidas.
const SIZE_RE = /\btallas?\b|(?<!\ba la )\bmedidas?\b|\bmido\b|\bpeso \d|\bkilos\b|\bestatura\b|\bcentimetros\b|\bcm\b/;
const COLOR_RE = /\bcolor(?:es)?\b|\b(?:azul|negr|gris|beige|blanc|crema|vinotinto|burdeos|verde|cafe|marron|roj|rosad|morad|mostaza|platead|dorad)\w*|\boscur|\bclar[oa]s?\b/;
// Una prenda con color es un pedido específico solo si la está pidiendo ("quiero un traje azul oscuro"); en
// "¿cuánto cuesta el esmoquin negro?" el color es parte del nombre.
const WANT_RE = /\b(?:quiero|quisiera|busco|ando buscando|necesito|me gustaria|me interesa|estoy buscando)\b/;
const GARMENT_RE = /\b(?:traje|vestido|esmoquin|smoking|saco|blazer|camisa|chaleco|pantalon|corbata|corbatin|guayabera|frac|chaqueta|prenda|look|outfit)\w*/;
// "¿Tienen…?", "¿hay…?": decir si hay o no, aunque traiga color o talla ("¿tienen el gris en talla 42?").
const EXIST_RE = /^(?:(?:hola|buenas|buenos dias|buenas tardes|buenas noches|y|oye|disculpa|una pregunta)[\s,!.]*)*¿?\s*(?:ustedes\s+)?(?:tienen|tendran|hay|habra|venden|manejan|alquilan|consigo|trabajan|hacen)\b/;
// Seguimientos cortos de lo específico ("¿y en azul?", "la segunda", "¿y esa?"): sigue el mismo modelo.
const FOLLOWUP_RE = /^(?:y|e|o)\b|\b(?:la primera|el primero|la segunda|el segundo|la tercera|el tercero|esa|ese|esas|esos|la otra|el otro|los dos|ambos)\b/;
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Por qué este mensaje necesita el modelo pesado, o null si le basta el liviano. */
export function heavyReason(intent: Intent, userText: string, lastRole?: 'light' | 'heavy'): string | null {
  if (intent !== 'compra') return null; // saludos, información de la tienda, citas: liviano
  const t = fold(userText.trim()).replace(/^[¿¡\s]+/, '');
  if (RECOMMEND_RE.test(t)) return 'recomendación o comparación';
  const words = t.split(/\s+/).length;
  if (lastRole === 'heavy' && words <= 8 && FOLLOWUP_RE.test(t)) return 'seguimiento de lo específico';
  if (EXIST_RE.test(t)) return null; // hay o no hay
  if (GARMENT_DETAIL_RE.test(t) || (GENERIC_DETAIL_RE.test(t) && GARMENT_RE.test(t))) return 'detalle puntual';
  if (SIZE_RE.test(t)) return 'medidas o tallas';
  if (COLOR_RE.test(t) && GARMENT_RE.test(t) && WANT_RE.test(t)) return 'prenda con características';
  return null;
}

/**
 * Decide qué motor responde el turno, por roles (LIGHT_ENGINE / HEAVY_ENGINE en .env): el pesado solo cuando el
 * cliente pide algo específico (heavyReason); el resto, el liviano. Si solo hay un motor disponible, se usa ese.
 * Con OpenAI en ambos roles, lo que cambia es el modelo.
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
  // Apple tiene una ventana de 4.096 tokens: lo que no cabe va al otro motor.
  if (light === 'apple' && input.estimatedTokens > env.appleMaxPromptTokens) return H(`contexto ~${input.estimatedTokens} tokens`);
  const why = heavyReason(input.intent, input.userText, input.lastRole);
  if (why) return H(why);
  return L(input.intent === 'saludo' ? 'saludo' : input.intent === 'info_tienda' ? 'info de tienda' : 'compra puntual');
}
