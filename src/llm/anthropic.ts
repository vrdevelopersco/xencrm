// Motor de respaldo en la nube: Claude, de Anthropic (Messages API).
//
// No tiene rol propio. Entra cuando el motor de un rol falla —OpenAI caído, sin saldo, con la llave revocada—, y en
// un servidor sin Ollama ni Apple es lo único que hay entre eso y un cliente sin respuesta. Mientras OpenAI
// conteste, aquí no sale ni una llamada.
//
// 🪤 La caché de Claude NO es automática como la de OpenAI, y no es gratis: guardar cuesta 1,25 × la entrada y
// dura 5 minutos (cada lectura los renueva); leer cuesta 0,1 × en Haiku y 0,05 × en Sonnet. Se marcan dos
// puntos, los dos sobre lo que se repite de verdad:
//   1. Lo fijo (`system`): la persona con la información del negocio, o las instrucciones del clasificador. Es
//      idéntico para todas las conversaciones de un negocio, así que lo aprovecha cualquier mensaje que llegue
//      dentro de esos 5 minutos, sea de quien sea.
//   2. El final del historial: dentro de una misma conversación, el turno siguiente lee lo ya conversado.
// Lo del turno (información encontrada, nombre, nota) va pegado al último mensaje, DESPUÉS de los dos puntos: si
// fuera antes, cambiaría en cada turno y no se aprovecharía nada. La marca automática de Anthropic («una sola
// marca al final») no sirve aquí por eso mismo: caería sobre lo del turno, que no se repite nunca.
import { env } from '../config.js';
import { EngineError } from './errors.js';
import type { ChatMessage } from './ollama.js';
import type { SchemaSpec } from './apple.js';
import type { Role } from './engines.js';
import { toStrictJsonSchema } from './openai.js';
import { recordUsage, type UsageTag } from './usage.js';

const VERSION = '2023-06-01';

/** Modelo de un rol: ANTHROPIC_MODEL_<ROL> o, si está vacío, ANTHROPIC_MODEL. */
export function anthropicModel(role?: Role): string {
  return (role && env.anthropicRoleModels[role]) || env.anthropicModel;
}

export interface AnthropicChatInput {
  /** Lo fijo: la persona o las instrucciones. Va con su marca de caché. */
  system: string;
  /** La conversación, terminando en el mensaje de este turno. */
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  schema?: SchemaSpec;
  model?: string;
  /** Marcar también el final del historial (punto 2). El clasificador no tiene historial que guardar. */
  cacheHistorial?: boolean;
  usage?: UsageTag;
}

type Bloque = { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } };
type Mensaje = { role: 'user' | 'assistant'; content: Bloque[] };

/**
 * La conversación como la acepta Claude: solo `user` y `assistant`, alternados, empezando por `user` y sin
 * textos vacíos.
 *
 * 🪤 Las tres cosas las rechaza con un 400, y las tres pasan en xencrm: el negocio puede escribir primero (un
 * seguimiento, un recordatorio), el cliente manda tres mensajes seguidos antes de que nadie conteste, y un
 * adjunto sin texto deja el contenido vacío. Se juntan los seguidos en uno y, si arranca el negocio, se dice.
 */
export function paraClaude(messages: ChatMessage[], cacheHistorial = false): Mensaje[] {
  const out: { role: 'user' | 'assistant'; text: string }[] = [];
  for (const m of messages) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const text = String(m.content ?? '').trim();
    if (!text) continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role) prev.text += `\n\n${text}`;
    else out.push({ role: m.role, text });
  }
  if (out[0]?.role === 'assistant') out.unshift({ role: 'user', text: '(La conversación la empezó el negocio con el mensaje que sigue.)' });
  return out.map((m, i) => ({
    role: m.role,
    content: [{ type: 'text', text: m.text, ...(cacheHistorial && out.length > 1 && i === out.length - 2 ? { cache_control: { type: 'ephemeral' as const } } : {}) }],
  }));
}

// Algunos modelos rechazan `temperature` (los que razonan, según la versión). Se aprende al primer 400 y desde
// ahí se omite para ese modelo, igual que con OpenAI.
const sinTemperatura = new Set<string>();

export async function anthropicChat(input: AnthropicChatInput): Promise<string> {
  if (!env.anthropicApiKey) throw new EngineError('anthropic', 'not_configured', 'falta ANTHROPIC_API_KEY');
  const model = input.model || env.anthropicModel;
  const body: Record<string, unknown> = {
    model,
    max_tokens: input.maxTokens ?? 400,
    system: [{ type: 'text', text: input.system, cache_control: { type: 'ephemeral' } }],
    messages: paraClaude(input.messages, input.cacheHistorial),
    temperature: input.schema ? 0 : (input.temperature ?? env.temperature),
  };
  if (input.schema) body.output_config = { format: { type: 'json_schema', schema: toStrictJsonSchema(input.schema) } };
  if (sinTemperatura.has(model)) delete body.temperature;
  try {
    return await request(body, input.usage);
  } catch (err) {
    if (!(err instanceof EngineError && err.code === 'bad_request' && 'temperature' in body && /temperature/.test(err.message))) throw err;
    sinTemperatura.add(model);
    delete body.temperature;
    return request(body, input.usage);
  }
}

/** El código de error con el que se decide si Claude está caído o solo falló esta petición. */
export function codigoDeError(status: number, texto: string): string {
  // 🪤 Sin saldo NO es un 402 ni un 429: es un 400 como el de una petición mal hecha. Si se tratara como tal,
  // cada mensaje volvería a intentarlo, y lo que se quiere es saber que se acabó y dejar de llamar un rato.
  if (status === 400 && /credit balance/i.test(texto)) return 'sin_saldo';
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'sin_modelo';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server'; // 529 = sobrecargado
  return 'bad_request';
}

async function request(body: Record<string, unknown>, usage?: UsageTag): Promise<string> {
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(`${env.anthropicBaseUrl}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.anthropicApiKey, 'anthropic-version': VERSION },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    throw new EngineError('anthropic', 'network', `sin conexión con ${env.anthropicBaseUrl}: ${(err as Error).message}`);
  }
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    throw new EngineError('anthropic', codigoDeError(res.status, text), `Anthropic ${res.status}: ${text}`, res.status);
  }
  const data = (await res.json()) as {
    stop_reason?: string;
    content?: { type: string; text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
  };
  const u = data.usage;
  // 🪤 Claude cuenta la entrada en tres pedazos que no se pisan (lo nuevo, lo que guardó y lo que leyó); OpenAI
  // da el total y aparte cuánto salió de la caché. Se guarda como OpenAI —entrada = el total— para que el informe
  // y el tope sumen igual los dos, y lo guardado va en su columna porque se cobra distinto.
  const guardados = u?.cache_creation_input_tokens ?? 0;
  const leidos = u?.cache_read_input_tokens ?? 0;
  recordUsage({
    ...usage,
    engine: 'anthropic',
    model: String(body.model),
    inputTokens: (u?.input_tokens ?? 0) + guardados + leidos,
    cachedTokens: leidos,
    cacheWriteTokens: guardados,
    outputTokens: u?.output_tokens ?? 0,
    ms: Date.now() - started,
  });
  if (data.stop_reason === 'refusal') throw new EngineError('anthropic', 'refusal', 'Claude no quiso contestar esto');
  const content = (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('');
  if (!content.trim() && data.stop_reason === 'max_tokens') {
    throw new EngineError('anthropic', 'truncated', `${String(body.model)} agotó ${String(body.max_tokens)} tokens sin escribir la respuesta`);
  }
  return content;
}

/** Comprueba la llave y que existan los modelos, sin gastar: leer la ficha de un modelo no se cobra. */
export async function probeAnthropic(models: string[]): Promise<{ ok: boolean; reason?: string }> {
  if (!env.anthropicApiKey) return { ok: false, reason: 'sin ANTHROPIC_API_KEY' };
  try {
    for (const model of new Set(models)) {
      const res = await fetch(`${env.anthropicBaseUrl}/models/${encodeURIComponent(model)}`, {
        headers: { 'x-api-key': env.anthropicApiKey, 'anthropic-version': VERSION },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 404) return { ok: false, reason: `modelo ${model} no existe para esta clave` };
      if (res.status === 401 || res.status === 403) return { ok: false, reason: 'la clave de Anthropic no vale' };
      if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}
