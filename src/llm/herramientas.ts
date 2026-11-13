/**
 * Llamar herramientas (tool calling) con los motores de la nube que lo saben hacer: OpenAI y los que hablan como él
 * (Chat Completions: LM Studio, «otro compatible») y Claude (Messages API). Lo usa el modo agéntico (src/agentico/).
 *
 * La conversación de un turno agéntico se guarda en un formato NEUTRO (`Paso`): lo que dijo el cliente, lo que
 * contestó el modelo con las herramientas que pidió, y lo que devolvieron. Cada motor lo traduce al suyo justo antes
 * de llamar; así el bucle no sabe con quién habla, y el respaldo (OpenAI cae → Claude) sigue el mismo turno.
 *
 * Aquí solo se habla con la API. Decidir qué herramienta existe, validar lo que pide el modelo y ejecutarlo es del
 * código (src/agentico/nucleo.ts): el modelo pide; nunca ejecuta.
 *
 * 🪤 Los motores de la máquina (Ollama, Apple) no entran: o no tienen herramientas, o las tienen según el modelo y
 * sin garantía de formato. Con ellos el asistente sigue el recorrido de siempre (agent.ts), que no las necesita.
 */
import { env, business } from '../config.js';
import { EngineError } from './errors.js';
import { compatibleDe, type MotorCompatible } from './openai.js';
import { codigoDeError, paraClaude } from './anthropic.js';
import { costUsd, recordUsage, type UsageTag } from './usage.js';

/** Lo que el modelo sabe de una herramienta: su nombre, para qué sirve y qué recibe (JSON Schema). */
export interface DefHerramienta {
  nombre: string;
  descripcion: string;
  parametros: Record<string, unknown>;
}

/** Una herramienta que pidió el modelo. `args` es lo que mandó ya leído; null si no era JSON. */
export interface Llamada {
  id: string;
  nombre: string;
  args: unknown;
  /** Lo que mandó tal cual: para devolvérselo en el turno siguiente y para el registro. */
  crudo: string;
}

export type Paso =
  | { rol: 'usuario'; texto: string }
  | { rol: 'asistente'; texto: string; llamadas: Llamada[] }
  | { rol: 'resultados'; resultados: { id: string; contenido: string; error?: boolean }[] };

export interface EntradaHerramientas {
  /** Lo fijo: la persona o las instrucciones del copiloto. */
  sistema: string;
  pasos: Paso[];
  herramientas: DefHerramienta[];
  /** La última vuelta: las herramientas siguen declaradas (el historial las nombra) pero no se pueden pedir. */
  sinHerramientas?: boolean;
  modelo: string;
  maxTokens?: number;
  temperatura?: number;
  usage?: UsageTag;
}

export interface RespuestaHerramientas {
  texto: string;
  llamadas: Llamada[];
  /** Lo que costó esta llamada (USD). 0 en los de la máquina; null si el modelo no tiene precio conocido. */
  costoUsd: number | null;
  /** Por qué paró: 'herramientas', 'fin', 'largo' (se le acabaron los tokens). */
  fin: 'herramientas' | 'fin' | 'largo';
}

const leer = (crudo: string): unknown => {
  try {
    return JSON.parse(crudo || '{}');
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------------------------------------------
// OpenAI y compatibles (Chat Completions)
// ---------------------------------------------------------------------------------------------------------------

type MensajeOpenAI =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[] }
  | { role: 'tool'; tool_call_id: string; content: string };

/** Los pasos neutros como los quiere Chat Completions: cada resultado es un mensaje `tool` con el id de su llamada. */
export function paraOpenAI(sistema: string, pasos: Paso[]): MensajeOpenAI[] {
  const out: MensajeOpenAI[] = [{ role: 'system', content: sistema }];
  for (const p of pasos) {
    if (p.rol === 'usuario') out.push({ role: 'user', content: p.texto });
    else if (p.rol === 'asistente') {
      out.push({
        role: 'assistant',
        content: p.texto || null,
        ...(p.llamadas.length ? { tool_calls: p.llamadas.map((l) => ({ id: l.id, type: 'function' as const, function: { name: l.nombre, arguments: l.crudo || '{}' } })) } : {}),
      });
    } else for (const r of p.resultados) out.push({ role: 'tool', tool_call_id: r.id, content: r.contenido });
  }
  return out;
}

const sinTemperatura = new Set<string>();
const slug = business.business.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'xencrm';

export async function openaiConHerramientas(e: EntradaHerramientas, motor: MotorCompatible = 'openai'): Promise<RespuestaHerramientas> {
  const p = compatibleDe(motor);
  if (motor === 'openai' && !p.apiKey) throw new EngineError('openai', 'not_configured', 'falta OPENAI_API_KEY');
  if (motor !== 'openai' && !p.baseUrl) throw new EngineError(motor, 'not_configured', `falta la dirección de ${p.nombre}`);
  const model = motor === 'openai' ? e.modelo || env.openaiModel : p.modelo;
  if (!model) throw new EngineError(motor, 'not_configured', `falta el modelo de ${p.nombre}`);
  const maxTokens = e.maxTokens ?? 700;
  const body: Record<string, unknown> = {
    model,
    messages: paraOpenAI(e.sistema, e.pasos),
    temperature: e.temperatura ?? env.temperature,
  };
  // 🪤 Chat Completions rechaza `tools: []`: sin herramientas, ni la llave.
  if (e.herramientas.length) {
    body.tools = e.herramientas.map((h) => ({ type: 'function', function: { name: h.nombre, description: h.descripcion, parameters: h.parametros } }));
    if (e.sinHerramientas) body.tool_choice = 'none';
  }
  if (motor === 'openai') {
    body.max_completion_tokens = maxTokens;
    body.prompt_cache_key = `${slug}-${e.usage?.task ?? 'agente'}`;
  } else body.max_tokens = maxTokens;
  // Los que razonan rechazan `temperature` y gastan tokens pensando: sin margen devuelven vacío (ver openai.ts).
  const comoRazonador = () => {
    delete body.temperature;
    if (motor === 'openai') body.max_completion_tokens = maxTokens + 4000;
    else body.max_tokens = maxTokens + 4000;
  };
  if (sinTemperatura.has(model)) comoRazonador();
  for (let intento = 0; ; intento++) {
    try {
      return await pedirOpenAI(body, e.usage, p);
    } catch (err) {
      const rechazo = err instanceof EngineError && err.code === 'bad_request' && intento < 2 ? err.message : '';
      if ('temperature' in body && /'?temperature'?/.test(rechazo)) {
        sinTemperatura.add(model);
        comoRazonador();
      } else if ('prompt_cache_key' in body && /prompt_cache_key/.test(rechazo)) delete body.prompt_cache_key;
      else throw err;
    }
  }
}

async function pedirOpenAI(body: Record<string, unknown>, usage: UsageTag | undefined, p: ReturnType<typeof compatibleDe>): Promise<RespuestaHerramientas> {
  const empezo = Date.now();
  let res: Response;
  try {
    res = await fetch(`${p.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(p.apiKey ? { authorization: `Bearer ${p.apiKey}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(p.motor === 'lmstudio' ? 120_000 : 60_000),
    });
  } catch (err) {
    throw new EngineError(p.motor, 'network', `sin conexión con ${p.baseUrl}: ${(err as Error).message}`);
  }
  if (!res.ok) {
    const t = (await res.text()).slice(0, 300);
    const code = res.status === 401 || res.status === 403 ? 'auth' : res.status === 429 && /insufficient_quota/.test(t) ? 'sin_saldo' : res.status === 429 ? 'rate_limited' : res.status >= 500 ? 'server' : 'bad_request';
    throw new EngineError(p.motor, code, `${p.nombre} ${res.status}: ${t}`, res.status);
  }
  const data = (await res.json()) as {
    choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string | null; tool_calls?: { id: string; function?: { name?: string; arguments?: string } }[] } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; completion_tokens_details?: { reasoning_tokens?: number } };
  };
  const u = data.usage;
  const entrada = u?.prompt_tokens ?? 0, cache = u?.prompt_tokens_details?.cached_tokens ?? 0, salida = u?.completion_tokens ?? 0;
  recordUsage({ ...usage, engine: p.motor, model: String(body.model), inputTokens: entrada, cachedTokens: cache, outputTokens: salida, reasoningTokens: u?.completion_tokens_details?.reasoning_tokens ?? 0, ms: Date.now() - empezo });
  const c = data.choices?.[0];
  if (c?.message?.refusal) throw new EngineError(p.motor, 'refusal', c.message.refusal);
  const llamadas: Llamada[] = (c?.message?.tool_calls ?? []).map((t) => ({ id: t.id, nombre: t.function?.name ?? '', crudo: t.function?.arguments ?? '', args: leer(t.function?.arguments ?? '') }));
  const texto = c?.message?.content ?? '';
  const fin = llamadas.length ? 'herramientas' : c?.finish_reason === 'length' ? 'largo' : 'fin';
  if (fin === 'largo' && !texto.trim()) throw new EngineError(p.motor, 'truncated', `${String(body.model)} agotó sus tokens sin escribir la respuesta`);
  return { texto, llamadas, fin, costoUsd: costUsd(p.motor, String(body.model), entrada, cache, salida) };
}

// ---------------------------------------------------------------------------------------------------------------
// Claude (Messages API)
// ---------------------------------------------------------------------------------------------------------------

type BloqueClaude =
  | { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };
type MensajeClaude = { role: 'user' | 'assistant'; content: BloqueClaude[] };

/**
 * Los pasos neutros como los quiere Claude. Lo conversado antes de este turno (texto con texto) pasa por
 * `paraClaude`, que ya resuelve lo que Claude rechaza (dos seguidos del mismo lado, empezar por el negocio, vacíos);
 * desde el primer pedido de herramientas, cada llamada es un bloque `tool_use` del asistente y cada resultado un
 * `tool_result` del usuario, con el id de su llamada.
 */
export function paraClaudeConHerramientas(pasos: Paso[]): MensajeClaude[] {
  const primera = pasos.findIndex((p) => p.rol !== 'usuario' && (p.rol === 'resultados' || p.llamadas.length > 0));
  const antes = primera < 0 ? pasos : pasos.slice(0, primera);
  const out: MensajeClaude[] = paraClaude(
    antes.map((p) => ({ role: p.rol === 'usuario' ? ('user' as const) : ('assistant' as const), content: p.rol === 'resultados' ? '' : p.texto })),
    true,
  );
  if (primera < 0) return out;
  for (const p of pasos.slice(primera)) {
    if (p.rol === 'usuario') out.push({ role: 'user', content: [{ type: 'text', text: p.texto }] });
    else if (p.rol === 'asistente') {
      const content: BloqueClaude[] = [];
      if (p.texto.trim()) content.push({ type: 'text', text: p.texto });
      for (const l of p.llamadas) content.push({ type: 'tool_use', id: l.id, name: l.nombre, input: l.args ?? {} });
      out.push({ role: 'assistant', content });
    } else out.push({ role: 'user', content: p.resultados.map((r) => ({ type: 'tool_result' as const, tool_use_id: r.id, content: r.contenido, ...(r.error ? { is_error: true } : {}) })) });
  }
  return out;
}

const claudeSinTemperatura = new Set<string>();

export async function claudeConHerramientas(e: EntradaHerramientas): Promise<RespuestaHerramientas> {
  if (!env.anthropicApiKey) throw new EngineError('anthropic', 'not_configured', 'falta ANTHROPIC_API_KEY');
  const model = e.modelo || env.anthropicModel;
  const body: Record<string, unknown> = {
    model,
    max_tokens: e.maxTokens ?? 700,
    // La marca de caché en lo fijo guarda también las herramientas, que van antes en el orden de Claude.
    system: [{ type: 'text', text: e.sistema, cache_control: { type: 'ephemeral' } }],
    messages: paraClaudeConHerramientas(e.pasos),
    temperature: e.temperatura ?? env.temperature,
  };
  if (e.herramientas.length) {
    body.tools = e.herramientas.map((h) => ({ name: h.nombre, description: h.descripcion, input_schema: h.parametros }));
    if (e.sinHerramientas) body.tool_choice = { type: 'none' };
  }
  if (claudeSinTemperatura.has(model)) delete body.temperature;
  try {
    return await pedirClaude(body, e.usage);
  } catch (err) {
    if (!(err instanceof EngineError && err.code === 'bad_request' && 'temperature' in body && /temperature/.test(err.message))) throw err;
    claudeSinTemperatura.add(model);
    delete body.temperature;
    return pedirClaude(body, e.usage);
  }
}

async function pedirClaude(body: Record<string, unknown>, usage?: UsageTag): Promise<RespuestaHerramientas> {
  const empezo = Date.now();
  let res: Response;
  try {
    res = await fetch(`${env.anthropicBaseUrl}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.anthropicApiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    throw new EngineError('anthropic', 'network', `sin conexión con ${env.anthropicBaseUrl}: ${(err as Error).message}`);
  }
  if (!res.ok) {
    const t = (await res.text()).slice(0, 300);
    throw new EngineError('anthropic', codigoDeError(res.status, t), `Anthropic ${res.status}: ${t}`, res.status);
  }
  const data = (await res.json()) as {
    stop_reason?: string;
    content?: { type: string; text?: string; id?: string; name?: string; input?: unknown }[];
    usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
  };
  const u = data.usage;
  const guardados = u?.cache_creation_input_tokens ?? 0, leidos = u?.cache_read_input_tokens ?? 0;
  const entrada = (u?.input_tokens ?? 0) + guardados + leidos, salida = u?.output_tokens ?? 0;
  recordUsage({ ...usage, engine: 'anthropic', model: String(body.model), inputTokens: entrada, cachedTokens: leidos, cacheWriteTokens: guardados, outputTokens: salida, ms: Date.now() - empezo });
  if (data.stop_reason === 'refusal') throw new EngineError('anthropic', 'refusal', 'Claude no quiso contestar esto');
  const bloques = data.content ?? [];
  const texto = bloques.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
  const llamadas: Llamada[] = bloques.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id ?? '', nombre: b.name ?? '', args: b.input ?? {}, crudo: JSON.stringify(b.input ?? {}) }));
  const fin = llamadas.length ? 'herramientas' : data.stop_reason === 'max_tokens' ? 'largo' : 'fin';
  if (fin === 'largo' && !texto.trim()) throw new EngineError('anthropic', 'truncated', `${String(body.model)} agotó sus tokens sin escribir la respuesta`);
  return { texto, llamadas, fin, costoUsd: costUsd('anthropic', String(body.model), entrada, leidos, salida, 0, guardados) };
}
