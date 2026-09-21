import type { ChatMessage } from '../llm/ollama.js';
import { classify as classifyWith, fallbackOrder, roleEngine, type Engine } from '../llm/engines.js';
import { business } from '../config.js';
import { asksAvailability } from '../crm/when.js';
import { dictionaryVersion, expandExpressions, getDictionary } from './dictionary.js';
import { noteMiss } from '../crm/misses.js';
import { gatePrompt, GATE_SCHEMA, INTENTS, type Intent } from './prompts.js';

export interface GateResult {
  intent: Intent;
  query: string;
  via: 'regex' | Engine | 'fallback';
}

// Saludos y cortesías cortas: cualquier secuencia de estas muletillas ("jaja ok, gracias!", "hola buenas").
const COURTESY_TOKEN =
  '(ja|je|ji)+s?|ok(ay)?|oki|listo|vale|dale|bueno|ya|ah|oh|uy|hola+|holi+|buenas?( (d[ií]as|tardes|noches))?|hey|hello|hi|qu[eé] tal|buen d[ií]a|gracias+( totales| por (la|tu) (info|ayuda|informaci[oó]n))?|muchas gracias|mil gracias|perfecto|genial|chao|adi[oó]s|hasta luego|nos vemos|de nada|😊|👍|🙏';
export const GREETING_RE = new RegExp(`^(?:(?:${COURTESY_TOKEN})[,!. 🙂😊👋]*)+$`, 'i');
const CITA_RE =
  // "agenda" como verbo ("agenda la cita"), no como sustantivo ("déjame revisar mi agenda").
  /\b(cita|agendar|(?<!\b(?:mi|tu|su|la|una)\s)agenda|agendemos|agéndame|reservar|reserva|programar|tomar(me)? (las )?medidas|medirme|pasar (por|a) (la tienda|el local|la boutique|el taller|el atelier)|ir a (la tienda|el local|la boutique|el taller|el atelier|medirme)|visitarlos|puedo ir)\b/i;
const HUMAN_RE =
  /\b(hablar|comunicar(me)?|contactar|pasar(me)?|atender(me)?)\b.{0,25}\b(persona|humano|asesor|agente|alguien|encargado)\b|\b(queja|reclamo|pqr)\b/i;

// ---------- Preguntas típicas que no necesitan modelo ----------
// Temas de la tienda (lo genérico del español); cada negocio suma los suyos en aiva.config.json > dictionary.topics.
const BUILTIN_TOPICS: { re: RegExp; query: string }[] = [
  {
    re: /\b(?:d[oó]nde|en qu[eé] parte)\b.{0,20}\b(?:quedan?|est[aá]n?|ubicad[oa]s?|encuentro|la tienda|la boutique|el local)\b|\b(?:direcci[oó]n|ubicaci[oó]n|c[oó]mo llego|local f[ií]sico|tienda f[ií]sica)\b/i,
    query: 'ubicación y dirección de la tienda',
  },
  {
    re: /\bhorarios?\b|\ba qu[eé] horas?\b.{0,15}\b(?:abren|cierran|atienden|trabajan)\b|\bhasta qu[eé] hora\b|\b(?:abren|atienden|trabajan)\b.{0,15}\b(?:hoy|domingos?|s[aá]bados?|festivos?|fines? de semana)\b|\bqu[eé] d[ií]as\b.{0,10}\b(?:abren|atienden|trabajan)\b/i,
    query: 'horarios de atención',
  },
  {
    re: /\b(?:formas?|m[eé]todos?|medios?)\s+de\s+pago\b|\baceptan\b.{0,15}\b(?:tarjetas?|efectivo|transferencias?|cr[eé]dito|d[eé]bito)\b|\bpuedo pagar\b|\bpago contra entrega\b|\ba cuotas\b/i,
    query: 'formas de pago',
  },
  { re: /\benv[ií]os?\b|\bdomicilios?\b|\bdespach(?:an|os?)\b/i, query: 'envíos y domicilios' },
  { re: /\bdevoluci[oó]n|\bdevolver\b|\bgarant[ií]a\b|\bcambios?\s+de\s+(?:talla|prenda)\b|\bpol[ií]tica de cambios\b/i, query: 'cambios, devoluciones y garantía' },
  { re: /\bparqueadero|\bparqueo\b|\bestacionamiento\b/i, query: 'parqueadero' },
  {
    re: /\bc[oó]mo (?:funciona|es el proceso|se hace|se pide)\b|\bcu[aá]les son los pasos\b|\bcu[aá]nto (?:tiempo )?(?:se )?(?:demora|tarda|toma)\b/i,
    query: '',
  },
];
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PRICE_RE = /\bcu[aá]nto\s+(?:vale|valen|cuesta|cuestan|sale|salen|cobran|es|ser[ií]a)\b|\bprecios?\b|\bvalor(?:es)?\b|\btarifas?\b/i;
// "¿tienen…?", "¿venden…?" al inicio de una frase: pregunta por catálogo o servicio. Cada negocio suma sus verbos
// ("alquilan", "confeccionan") en su diccionario. Se aplica sobre el texto sin tildes.
const BASE_OFFER_VERBS = ['tienen', 'tendran', 'venden', 'manejan', 'hacen', 'trabajan'];
// "quiero un traje…": además de la pregunta hay una compra; el modelo decide qué pesa más.
const WANTS_RE = /\b(?:quiero|busco|necesito|me interesa)\s+(?:un|una|unos|unas|el|la|los|las|algo)\b/i;
// Referencias al turno anterior: sin historial no se entienden ("¿y eso cuánto vale?", "la otra").
const REFERENCE_RE = /\b(?:eso|esa|ese|esto|esta|este|esos|esas|lo|la otra|el otro|el primero|la primera|el segundo|la segunda|ah[ií])\b/i;
const BASE_STOP = 'a al algo alguna alguno algun como con cual cuales cuando donde cuanto cuanta cuantos cuantas de del el ella en es esta este hay la las le lo los mas me mi mis menos o para pero por que se si sin su sus te tu tus un una unas uno unos y ya aproximadamente aprox mas usted ustedes ahi vale valen cuesta cuestan sale salen cobran seria precio precios valor valores tarifa tarifas hola buenas buenos dias tardes noches porfa favor gracias quisiera saber quiero'.split(' ');

// Reglas con el diccionario del negocio: se recompilan cuando se importa uno nuevo desde el tablero.
interface Rules {
  topics: { test: (t: string) => boolean; query: string }[];
  offerRe: RegExp;
  stop: Set<string>;
}
let compiled: (Rules & { version: number }) | null = null;
function rules(): Rules {
  const version = dictionaryVersion();
  if (compiled?.version === version) return compiled;
  const d = getDictionary();
  const verbs = [...BASE_OFFER_VERBS, ...d.offerVerbs.map(fold)];
  compiled = {
    version,
    topics: [
      ...BUILTIN_TOPICS.map((x) => ({ test: (t: string) => x.re.test(t), query: x.query })),
      ...d.topics.map((x) => {
        const re = new RegExp(`\\b(?:${x.keywords.map((k) => escapeRe(fold(k))).join('|')})\\b`);
        return { test: (t: string) => re.test(fold(t)), query: x.query };
      }),
    ],
    offerRe: new RegExp(`(?:^|[¿.!?,]\\s*)(?:${verbs.map(escapeRe).join('|')})\\b\\s*([^?.!]*)`, 'i'),
    stop: new Set([...BASE_STOP, ...verbs]),
  };
  return compiled;
}
/** Palabras con contenido (sin muletillas ni palabras de pregunta): de qué se habla. */
function subject(text: string): string {
  return fold(text)
    .replace(/[^a-zñ0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !rules().stop.has(w))
    .join(' ');
}

/**
 * Reglas baratas del gate. Devuelve null cuando hace falta el modelo: mensajes largos, lo que depende del turno
 * anterior ("¿y eso cuánto vale?") y todo lo que podría estar fuera de tema (eso nunca lo decide una regla).
 */
export function ruleIntent(text: string, history: ChatMessage[] = []): GateResult | null {
  const t = expandExpressions(text.trim()); // "cuadrar una vueltica" → lo que el negocio enseñó que quiere decir
  if (t.length <= 40 && GREETING_RE.test(t)) return { intent: 'saludo', query: '', via: 'regex' };
  if (HUMAN_RE.test(t)) return { intent: 'humano', query: '', via: 'regex' };
  if (business.appointments.enabled && CITA_RE.test(t) && t.length <= 120) return { intent: 'cita', query: '', via: 'regex' };
  // "¿tienen espacio el sábado en la tarde?": disponibilidad con fecha o franja.
  if (business.appointments.enabled && t.length <= 160 && asksAvailability(t)) return { intent: 'cita', query: '', via: 'regex' };
  if (t.length > 160) return null;
  const followUp = history.length > 0 && REFERENCE_RE.test(t) && subject(t).split(' ').filter(Boolean).length < 2;
  if (followUp) return null;

  // Temas de la tienda: se busca con la consulta de cada tema tocado ("ubicación… · horarios…"); si alguno no la
  // tiene o además pregunta un precio o por un producto, se agrega lo que dijo el cliente.
  const { topics: allTopics, offerRe } = rules();
  const topics = allTopics.filter((x) => x.test(t));
  if (topics.length && WANTS_RE.test(t)) return null;
  if (topics.length) {
    const queries = topics.map((x) => x.query).filter(Boolean);
    const extra = queries.length < topics.length || PRICE_RE.test(t) || offerRe.test(fold(t)) ? subject(t) : '';
    return { intent: 'info_tienda', query: [...queries, extra].filter(Boolean).join(' · ') || t, via: 'regex' };
  }
  // Precio o catálogo de algo concreto: "¿cuánto cuesta el alquiler de un esmoquin?", "¿alquilan esmoquin?".
  const offer = offerRe.exec(fold(t));
  if (PRICE_RE.test(t) || offer) {
    const about = subject(offer && !PRICE_RE.test(t) ? offer[1]! : t);
    if (!about || (history.length > 0 && REFERENCE_RE.test(t))) return null; // "¿cuánto vale?", "¿y eso?": necesita el historial
    return { intent: 'compra', query: about, via: 'regex' };
  }
  return null;
}

// Lo que el modelo clasificó y una regla podría haber resuelto: frases cortas que son un saludo, un pedido de cita,
// pedir una persona o una pregunta de la tienda. Lo largo, lo que depende del turno anterior y lo que mezcla compra con
// pregunta va al modelo a propósito: no se anota.
const TEACHABLE: Partial<Record<Intent, { reading: string; suggestion: string }>> = {
  saludo: { reading: 'un saludo', suggestion: 'hola' },
  cita: { reading: 'quiere una cita', suggestion: 'quiero agendar una cita' },
  humano: { reading: 'quiere hablar con una persona', suggestion: 'quiero hablar con una persona' },
  info_tienda: { reading: 'pregunta de la tienda', suggestion: '' },
};
function noteRuleMiss(userId: string, t: string, history: ChatMessage[], intent: Intent, query: string) {
  const teach = TEACHABLE[intent];
  if (!teach || t.length > 80 || WANTS_RE.test(t) || (history.length > 0 && REFERENCE_RE.test(t))) return;
  const about = intent === 'info_tienda' && query ? query : '';
  noteMiss(userId, 'frase', t, { reading: about ? `${teach.reading}: ${about}` : teach.reading, suggestion: about || teach.suggestion });
}

/** Clasifica el mensaje: reglas baratas primero, luego el motor del gate con salida JSON (y el otro motor de respaldo). */
export async function classify(text: string, history: ChatMessage[], userId?: string): Promise<GateResult> {
  const t = text.trim();
  const byRule = ruleIntent(t, history);
  if (byRule) return byRule;

  const recent = history
    .slice(-4)
    .map((m) => `${m.role === 'user' ? 'Cliente' : 'Asistente'}: ${m.content.replace(/\s+/g, ' ').slice(0, 200)}`)
    .join('\n');
  const prompt = `Historial reciente:\n${recent || '(sin historial)'}\n\nÚLTIMO mensaje del cliente: "${t}"`;

  for (const engine of fallbackOrder(roleEngine('gate'))) {
    try {
      const raw = await classifyWith(engine, { sessionId: 'gate', instructions: gatePrompt(), prompt, schema: GATE_SCHEMA, maxTurns: 10, role: 'gate', userId });
      const parsed = JSON.parse(raw) as { intent?: string; consulta_busqueda?: string };
      let intent = INTENTS.find((i) => i === parsed.intent);
      if (!intent) throw new Error(`intent inválido: ${parsed.intent}`);
      if (intent === 'cita' && !business.appointments.enabled) intent = 'info_tienda';
      const query = (parsed.consulta_busqueda ?? '').trim();
      if (userId) noteRuleMiss(userId, t, history, intent, query);
      return { intent, query: query || (intent === 'info_tienda' ? 'cómo visitar la tienda, horarios y citas' : ''), via: engine };
    } catch (err) {
      console.warn(`[gate] ${engine} falló: ${(err as Error).message}`);
    }
  }
  // Sin gate: seguimos como consulta de compra; el prompt de sistema y el filtro de enlaces siguen protegiendo.
  return { intent: 'compra', query: t, via: 'fallback' };
}
