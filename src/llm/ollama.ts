import { env } from '../config.js';
import { recordUsage, type UsageTag } from './usage.js';

export type Role = 'system' | 'user' | 'assistant';
export type ChatMessage = { role: Role; content: string };

export interface ChatOptions {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  numPredict?: number;
  /** Para el registro de consumo: qué tarea y qué conversación. */
  usage?: UsageTag;
  numCtx?: number;
  /** JSON schema para salida estructurada (Ollama structured outputs) */
  format?: Record<string, unknown> | 'json';
  /** Desactiva el "thinking" en modelos que lo soportan (más rápido para atención al cliente) */
  think?: boolean;
}

export class OllamaError extends Error {}

async function post<T>(path: string, body: unknown, retry = 1): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retry; attempt++) {
    try {
      const res = await fetch(`${env.ollamaUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new OllamaError(`Ollama ${path} -> ${res.status}: ${text.slice(0, 300)}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
      // Solo reintentar errores de red, no errores 4xx del servidor
      if (err instanceof OllamaError) throw err;
      if (attempt < retry) await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new OllamaError(`No pude conectar con Ollama en ${env.ollamaUrl}: ${String(lastErr)}`);
}

let thinkSupported: boolean | undefined; // se detecta en la primera llamada

export async function chat(opts: ChatOptions): Promise<string> {
  const body: Record<string, unknown> = {
    model: opts.model ?? env.chatModel,
    messages: opts.messages,
    stream: false,
    keep_alive: env.keepAlive,
    options: {
      temperature: opts.temperature ?? env.temperature,
      num_predict: opts.numPredict ?? 400,
      num_ctx: opts.numCtx ?? env.numCtx,
    },
  };
  if (opts.format) body.format = opts.format;
  const wantThink = opts.think ?? false;
  if (thinkSupported !== false) body.think = wantThink;

  type Reply = { message: { content: string }; prompt_eval_count?: number; eval_count?: number };
  const started = Date.now();
  const done = (data: Reply) => {
    recordUsage({ ...opts.usage, engine: 'ollama', model: String(body.model), inputTokens: data.prompt_eval_count ?? 0, outputTokens: data.eval_count ?? 0, ms: Date.now() - started });
    return data.message.content;
  };
  try {
    const data = await post<Reply>('/api/chat', body);
    thinkSupported ??= true;
    return done(data);
  } catch (err) {
    // Modelos sin soporte de "think" devuelven 400: reintentar sin el flag.
    if (thinkSupported === undefined && err instanceof OllamaError && /think/i.test(err.message)) {
      thinkSupported = false;
      delete body.think;
      return done(await post<Reply>('/api/chat', body));
    }
    throw err;
  }
}

export async function embed(texts: string[], model = env.embedModel): Promise<number[][]> {
  if (texts.length === 0) return [];
  const data = await post<{ embeddings: number[][] }>('/api/embed', { model, input: texts, keep_alive: env.keepAlive });
  return data.embeddings;
}

/** Verifica que Ollama responde y que los modelos configurados existen. */
export async function checkOllama(): Promise<{ ok: boolean; missing: string[] }> {
  const res = await fetch(`${env.ollamaUrl}/api/tags`).catch(() => null);
  if (!res?.ok) return { ok: false, missing: [] };
  const { models } = (await res.json()) as { models: { name: string }[] };
  const names = new Set(models.map((m) => m.name));
  const has = (m: string) => names.has(m) || names.has(`${m}:latest`);
  const missing = [env.chatModel, env.gateModel, env.embedModel].filter((m, i, a) => a.indexOf(m) === i && !has(m));
  return { ok: true, missing };
}
