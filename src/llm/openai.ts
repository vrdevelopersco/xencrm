// Motor de nube: OpenAI Chat Completions (o cualquier API compatible vía OPENAI_BASE_URL).
import { env } from '../config.js';
import { EngineError } from './errors.js';
import type { ChatMessage } from './ollama.js';
import type { SchemaSpec } from './apple.js';
import type { Role } from './engines.js';
import { recordUsage, type UsageTag } from './usage.js';

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

export async function openaiChat(input: OpenAIChatInput): Promise<string> {
  if (!env.openaiApiKey) throw new EngineError('openai', 'not_configured', 'falta OPENAI_API_KEY');
  const model = input.model || env.openaiModel;
  const maxTokens = input.maxTokens ?? 400;
  const body: Record<string, unknown> = {
    model,
    messages: input.messages,
    temperature: input.temperature ?? env.temperature,
    max_completion_tokens: maxTokens,
  };
  if (input.schema) {
    body.response_format = { type: 'json_schema', json_schema: { name: 'salida', strict: true, schema: toStrictJsonSchema(input.schema) } };
    body.temperature = 0;
  }
  const asReasoning = () => {
    delete body.temperature;
    body.max_completion_tokens = maxTokens + REASONING_BUDGET;
  };
  if (reasoningModels.has(model)) asReasoning();
  if (input.effort && !noEffort.has(model)) body.reasoning_effort = input.effort;
  for (let attempt = 0; ; attempt++) {
    try {
      return await request(body, input.usage);
    } catch (err) {
      const rejected = err instanceof EngineError && err.code === 'bad_request' && attempt < 2 ? err.message : '';
      if ('temperature' in body && /'temperature'/.test(rejected)) {
        reasoningModels.add(model);
        asReasoning();
      } else if ('reasoning_effort' in body && /reasoning/.test(rejected)) {
        noEffort.add(model);
        delete body.reasoning_effort;
      } else throw err;
    }
  }
}

async function request(body: Record<string, unknown>, usage?: UsageTag): Promise<string> {
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(`${env.openaiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.openaiApiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    throw new EngineError('openai', 'network', `sin conexión con ${env.openaiBaseUrl}: ${(err as Error).message}`);
  }
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    const code = res.status === 401 || res.status === 403 ? 'auth' : res.status === 429 ? 'rate_limited' : res.status >= 500 ? 'server' : 'bad_request';
    throw new EngineError('openai', code, `OpenAI ${res.status}: ${text}`, res.status);
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
    engine: 'openai',
    model: String(body.model),
    inputTokens: u?.prompt_tokens ?? 0,
    cachedTokens: u?.prompt_tokens_details?.cached_tokens ?? 0,
    outputTokens: u?.completion_tokens ?? 0,
    reasoningTokens: u?.completion_tokens_details?.reasoning_tokens ?? 0,
    ms: Date.now() - started,
  });
  const choice = data.choices?.[0];
  if (choice?.message?.refusal) throw new EngineError('openai', 'refusal', choice.message.refusal);
  const content = choice?.message?.content ?? '';
  if (!content.trim() && choice?.finish_reason === 'length') {
    throw new EngineError('openai', 'truncated', `${String(body.model)} agotó ${String(body.max_completion_tokens)} tokens sin escribir la respuesta`);
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
