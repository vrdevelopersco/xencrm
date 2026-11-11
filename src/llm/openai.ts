// Motor de nube: OpenAI Chat Completions, y las APIs que hablan igual: LM Studio (en la máquina) y «otro
// compatible» (OpenRouter, Groq, un vLLM propio…). Cada uno con su URL, su llave y su modelo; el cliente es el mismo.
import { business, env } from '../config.js';
import { EngineError } from './errors.js';
import type { ChatMessage } from './ollama.js';
import type { SchemaSpec } from './apple.js';
import type { Role } from './engines.js';
import { recordUsage, type UsageTag } from './usage.js';

/** Los motores que hablan como OpenAI. */
export type MotorCompatible = 'openai' | 'lmstudio' | 'compat';

/** Dónde y con qué llave habla cada uno, según lo que CORRE (el `.env` leído al arrancar). */
export interface Compatible {
  motor: MotorCompatible;
  /** Para los mensajes: «OpenAI», «LM Studio» o el nombre que se le dio al compatible. */
  nombre: string;
  baseUrl: string;
  apiKey: string;
  /** Sin llave no se intenta (OpenAI). LM Studio no la pide; el compatible, depende. */
  llaveObligatoria: boolean;
  /** El modelo que sirve, para los que tienen uno solo (LM Studio, el compatible). */
  modelo: string;
}

export function compatibleDe(motor: MotorCompatible): Compatible {
  if (motor === 'lmstudio') return { motor, nombre: 'LM Studio', baseUrl: env.lmstudioUrl, apiKey: '', llaveObligatoria: false, modelo: env.lmstudioModel };
  if (motor === 'compat') return { motor, nombre: env.compatNombre || 'la API compatible', baseUrl: env.compatUrl, apiKey: env.compatApiKey, llaveObligatoria: false, modelo: env.compatModel };
  return { motor, nombre: 'OpenAI', baseUrl: env.openaiBaseUrl, apiKey: env.openaiApiKey, llaveObligatoria: true, modelo: '' };
}

export interface OpenAIChatInput {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  schema?: SchemaSpec;
  /** Modelo de esta llamada; por defecto OPENAI_MODEL. */
  model?: string;
  /** Esfuerzo de razonamiento (OPENAI_EFFORT_<ROL>); se omite si el modelo no lo acepta. */
  effort?: string;
  /** Para el registro de consumo: qué tarea y qué conversación. */
  usage?: UsageTag;
}

/** Modelo de un rol: OPENAI_MODEL_<ROL> o, si está vacío, OPENAI_MODEL. */
export function openaiModel(role?: Role): string {
  return (role && env.openaiRoleModels[role]) || env.openaiModel;
}

export function openaiEffort(role?: Role): string | undefined {
  return (role && env.openaiRoleEffort[role]) || undefined;
}
const noEffort = new Set<string>();

// Los modelos de razonamiento (gpt-5, gpt-5-mini, gpt-5.5, o3…) rechazan `temperature` distinta de 1 y gastan
// tokens pensando antes de escribir: con un tope de 300 devuelven el texto vacío. Se reconocen al primer 400
// por `temperature`; desde ahí se omite ese parámetro y se les da margen para razonar.
const reasoningModels = new Set<string>();
const REASONING_BUDGET = 4000;

// Caché de prompts: OpenAI cobra 90 % menos por el prefijo que ya vio (desde 1024 tokens). La clave agrupa las llamadas
// de un negocio y una tarea para que lleguen a la misma caché; la retención de 24 h la mantiene entre conversaciones
// espaciadas (la normal dura minutos). Si la API (u otra compatible, vía OPENAI_BASE_URL) no los acepta, se omiten.
const noRetention = new Set<string>();
let noCacheKey = false;
const slug = business.business.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'aiva';

export async function openaiChat(input: OpenAIChatInput, motor: MotorCompatible = 'openai'): Promise<string> {
  const p = compatibleDe(motor);
  if (motor === 'openai' && !p.apiKey) throw new EngineError('openai', 'not_configured', 'falta OPENAI_API_KEY');
  if (motor !== 'openai' && !p.baseUrl) throw new EngineError(motor, 'not_configured', `falta la dirección de ${p.nombre}`);
  // LM Studio y el compatible sirven UN modelo, el suyo: el del rol es de OpenAI y allá no existe.
  const model = motor === 'openai' ? input.model || env.openaiModel : p.modelo;
  if (!model) throw new EngineError(motor, 'not_configured', `falta el modelo de ${p.nombre}`);
  const maxTokens = input.maxTokens ?? 400;
  const body: Record<string, unknown> = {
    model,
    messages: input.messages,
    temperature: input.temperature ?? env.temperature,
  };
  // 🪤 `max_completion_tokens` es de OpenAI (los modelos de razonamiento rechazan `max_tokens`); las APIs
  // compatibles entienden el de siempre, y uno que no conocen lo ignoran y escriben sin tope.
  if (motor === 'openai') body.max_completion_tokens = maxTokens;
  else body.max_tokens = maxTokens;
  if (input.schema) {
    body.response_format = { type: 'json_schema', json_schema: { name: 'salida', strict: true, schema: toStrictJsonSchema(input.schema) } };
    body.temperature = 0;
  }
  const asReasoning = () => {
    delete body.temperature;
    if (motor === 'openai') body.max_completion_tokens = maxTokens + REASONING_BUDGET;
    else body.max_tokens = maxTokens + REASONING_BUDGET;
  };
  if (reasoningModels.has(model)) asReasoning();
  // La caché con clave y retención y el esfuerzo de razonamiento son de OpenAI: a los demás no se les mandan.
  if (motor === 'openai') {
    if (input.effort && !noEffort.has(model)) body.reasoning_effort = input.effort;
    if (!noCacheKey) body.prompt_cache_key = `${slug}-${input.usage?.task ?? 'chat'}`;
    if (!noRetention.has(model)) body.prompt_cache_retention = '24h';
  }
  for (let attempt = 0; ; attempt++) {
    try {
      return await request(body, input.usage, p);
    } catch (err) {
      const rejected = err instanceof EngineError && err.code === 'bad_request' && attempt < 4 ? err.message : '';
      if ('temperature' in body && /'temperature'/.test(rejected)) {
        reasoningModels.add(model);
        asReasoning();
      } else if ('reasoning_effort' in body && /reasoning/.test(rejected)) {
        noEffort.add(model);
        delete body.reasoning_effort;
      } else if ('prompt_cache_retention' in body && /prompt_cache_retention/.test(rejected)) {
        noRetention.add(model);
        delete body.prompt_cache_retention;
      } else if ('prompt_cache_key' in body && /prompt_cache_key/.test(rejected)) {
        noCacheKey = true;
        delete body.prompt_cache_key;
      } else throw err;
    }
  }
}

async function request(body: Record<string, unknown>, usage: UsageTag | undefined, p: Compatible): Promise<string> {
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(`${p.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(p.apiKey ? { authorization: `Bearer ${p.apiKey}` } : {}) },
      body: JSON.stringify(body),
      // Uno de la máquina (LM Studio) puede tardar más en la primera respuesta: está cargando el modelo.
      signal: AbortSignal.timeout(p.motor === 'lmstudio' ? 120_000 : 60_000),
    });
  } catch (err) {
    throw new EngineError(p.motor, 'network', `sin conexión con ${p.baseUrl}: ${(err as Error).message}`);
  }
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    // 🪤 Sin saldo es un 429, como pasarse de velocidad, pero no se arregla esperando: se marca aparte para que el
    // motor quede fuera un rato y los mensajes vayan derecho al respaldo en vez de chocar uno por uno.
    const code =
      res.status === 401 || res.status === 403
        ? 'auth'
        : res.status === 429 && /insufficient_quota/.test(text)
          ? 'sin_saldo'
          : res.status === 429
            ? 'rate_limited'
            : res.status >= 500
              ? 'server'
              : 'bad_request';
    throw new EngineError(p.motor, code, `${p.nombre} ${res.status}: ${text}`, res.status);
  }
  const data = (await res.json()) as {
    model?: string;
    choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }[];
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number };
      completion_tokens_details?: { reasoning_tokens?: number };
    };
  };
  const u = data.usage;
  recordUsage({
    ...usage,
    engine: p.motor,
    model: String(body.model),
    inputTokens: u?.prompt_tokens ?? 0,
    cachedTokens: u?.prompt_tokens_details?.cached_tokens ?? 0,
    outputTokens: u?.completion_tokens ?? 0,
    reasoningTokens: u?.completion_tokens_details?.reasoning_tokens ?? 0,
    ms: Date.now() - started,
  });
  const choice = data.choices?.[0];
  if (choice?.message?.refusal) throw new EngineError(p.motor, 'refusal', choice.message.refusal);
  const content = choice?.message?.content ?? '';
  if (!content.trim() && choice?.finish_reason === 'length') {
    throw new EngineError(p.motor, 'truncated', `${String(body.model)} agotó ${String(body.max_completion_tokens ?? body.max_tokens)} tokens sin escribir la respuesta`);
  }
  return content;
}

/** Verifica credenciales y que existan los modelos configurados, con llamadas baratas. */
export async function probeOpenAI(models: string[] = [env.openaiModel]): Promise<{ ok: boolean; reason?: string }> {
  if (!env.openaiApiKey) return { ok: false, reason: 'sin OPENAI_API_KEY' };
  try {
    for (const model of new Set(models)) {
      const res = await fetch(`${env.openaiBaseUrl}/models/${encodeURIComponent(model)}`, {
        headers: { authorization: `Bearer ${env.openaiApiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 404) return { ok: false, reason: `modelo ${model} no existe para esta clave` };
      if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}

/**
 * ¿Contesta una API compatible con OpenAI en esta dirección, con esta llave? Pregunta la lista de modelos
 * (`GET /models`): no genera nada, así que no gasta. Si se nombra un modelo, además dice si está.
 *
 * 🪤 La lista sale para que quien configura ELIJA el modelo en vez de escribirlo de memoria: un nombre mal escrito
 * en LM Studio no da error al guardar, da error con el primer cliente.
 */
export async function probeCompatible(baseUrl: string, apiKey: string, modelo?: string): Promise<{ ok: boolean; reason?: string; modelos: string[] }> {
  if (!baseUrl) return { ok: false, reason: 'falta la dirección', modelos: [] };
  let res: Response;
  try {
    res = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    });
  } catch (err) {
    const porque = (err as Error).name === 'TimeoutError' ? 'no contestó en 10 segundos' : 'no hay nada escuchando en esa dirección';
    return { ok: false, reason: porque, modelos: [] };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, reason: 'la llave no vale (o hace falta una)', modelos: [] };
  if (!res.ok) return { ok: false, reason: `contestó ${res.status}`, modelos: [] };
  let modelos: string[] = [];
  try {
    const d = (await res.json()) as { data?: { id?: unknown }[] };
    modelos = (d.data ?? []).map((m) => (typeof m.id === 'string' ? m.id.slice(0, 120) : '')).filter(Boolean).slice(0, 1000);
  } catch {
    return { ok: false, reason: 'contestó, pero no como una API compatible con OpenAI', modelos: [] };
  }
  if (modelo && !modelos.includes(modelo)) return { ok: false, reason: modelos.length ? `el modelo ${modelo} no está ahí` : 'no tiene ningún modelo cargado', modelos };
  return { ok: true, modelos };
}

/** JSON Schema estricto (todas las propiedades requeridas, sin extras), como exige structured outputs. */
export function toStrictJsonSchema(spec: SchemaSpec): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const p of spec.properties) {
    properties[p.name] = {
      type: p.type ?? 'string',
      ...(p.enum ? { enum: p.enum } : {}),
      ...(p.description ? { description: p.description } : {}),
    };
  }
  return { type: 'object', properties, required: spec.properties.map((p) => p.name), additionalProperties: false };
}
