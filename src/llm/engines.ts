// Capa de motores: Ollama (local), Apple Foundation Models (local) y OpenAI (nube) detrás de una misma interfaz.
import { chat, checkOllama, type ChatMessage } from './ollama.js';
import { apple, AppleError, type SchemaSpec } from './apple.js';
import { openaiChat, openaiEffort, openaiModel, probeOpenAI } from './openai.js';
import { EngineError } from './errors.js';
import { env } from '../config.js';
import { emitEvent } from '../crm/events.js';
import type { Task } from './usage.js';

export type Engine = 'ollama' | 'apple' | 'openai';
export const ENGINES: Engine[] = ['ollama', 'apple', 'openai'];
export type Role = 'light' | 'heavy' | 'gate' | 'analysis';

export interface GenerateInput {
  sessionId: string;
  /** Instrucciones estáticas (persona + reglas). Apple las usa como `instructions` de la sesión. */
  persona: string;
  /** Contexto RAG de este turno (cambia en cada mensaje). */
  context: string;
  /** Nota puntual para este turno (p. ej. "es el primer mensaje"). */
  note?: string;
  /** Nombre del cliente, si se sabe: va con lo del turno, no en la persona (que debe ser idéntica para todos). */
  customerName?: string | null;
  userText: string;
  history: ChatMessage[];
  /** El turno anterior lo respondió otro motor: Apple debe rehacer la sesión con el historial. */
  fresh?: boolean;
  temperature?: number;
  maxTokens?: number;
  /** Rol del turno: con OpenAI decide el modelo (OPENAI_MODEL_<ROL>). */
  role?: Role;
}

export interface ClassifyInput {
  sessionId: string;
  instructions: string;
  prompt: string;
  schema: SchemaSpec;
  maxTurns?: number;
  role?: Role;
  /** Para el registro de consumo: la conversación y, si no es la del rol, la tarea ("when"). */
  userId?: string;
  task?: Task;
}

// ---------- Roles ----------
/** Motor asignado a cada rol según .env (LLM_ENGINE fuerza uno solo). */
export function roleEngine(role: Role): Engine {
  if (env.llmEngine !== 'router') return env.llmEngine;
  switch (role) {
    case 'light':
      return env.lightEngine;
    case 'heavy':
      return env.heavyEngine;
    case 'gate':
      return env.gateEngine;
    case 'analysis':
      return env.analysisEngine;
  }
}

export const ROLES: Role[] = ['light', 'heavy', 'gate', 'analysis'];

/** Motor y, si es OpenAI, modelo de un rol: "openai · gpt-5.4-mini". Para logs y el tablero. */
export function roleLabel(role: Role): string {
  const e = roleEngine(role);
  return e === 'openai' ? `openai · ${openaiModel(role)}` : e;
}

/** Orden de intentos: el preferido primero, luego el otro rol, luego lo que quede disponible. */
export function fallbackOrder(preferred: Engine): Engine[] {
  const seen = new Set<Engine>();
  const out: Engine[] = [];
  for (const e of [preferred, roleEngine('heavy'), roleEngine('light'), ...ENGINES]) {
    if (seen.has(e)) continue;
    seen.add(e);
    if (e === preferred || isAvailable(e)) out.push(e);
  }
  return out;
}

// ---------- Disponibilidad con enfriamiento ----------
const COOLDOWN_MS = 60_000;
const state: Record<Engine, { available: boolean; retryAt: number; reason?: string }> = {
  ollama: { available: false, retryAt: 0 },
  apple: { available: false, retryAt: 0 },
  openai: { available: false, retryAt: 0 },
};

function enginesInUse(): Set<Engine> {
  if (env.llmEngine !== 'router') return new Set([env.llmEngine]);
  return new Set([env.lightEngine, env.heavyEngine, env.gateEngine, env.analysisEngine]);
}

export async function probeEngines(): Promise<Record<Engine, { available: boolean; reason?: string }>> {
  const inUse = enginesInUse();
  const o = await checkOllama();
  state.ollama = {
    available: o.ok && !o.missing.includes(env.chatModel),
    retryAt: 0,
    reason: !o.ok ? `sin conexión a ${env.ollamaUrl}` : o.missing.length ? `faltan modelos: ${o.missing.join(', ')}` : undefined,
  };
  if (inUse.has('apple')) {
    const a = await apple.probe();
    state.apple = { available: a.ok, retryAt: 0, reason: a.reason };
  } else {
    state.apple = { available: false, retryAt: 0, reason: 'no asignado a ningún rol' };
  }
  if (inUse.has('openai') || env.openaiApiKey) {
    const p = await probeOpenAI(ROLES.map(openaiModel));
    state.openai = { available: p.ok, retryAt: 0, reason: p.reason };
  } else {
    state.openai = { available: false, retryAt: 0, reason: 'sin OPENAI_API_KEY' };
  }
  return engineStatus();
}

export function isAvailable(e: Engine): boolean {
  const s = state[e];
  if (s.available) return true;
  return s.retryAt !== 0 && Date.now() >= s.retryAt; // vuelve a intentar tras el enfriamiento
}

function markDown(e: Engine, reason: string) {
  const wasUp = state[e].available;
  state[e] = { available: false, retryAt: Date.now() + COOLDOWN_MS, reason };
  console.warn(`[engines] ${e} fuera de servicio 60s: ${reason}`);
  if (wasUp) emitEvent('engine_down', 'system', { engine: e, reason });
}
function markUp(e: Engine) {
  if (!state[e].available) state[e] = { available: true, retryAt: 0 };
}

/** Errores que indican que el motor no está operativo (no errores de una petición concreta). */
function isOutage(e: Engine, err: unknown): boolean {
  if (e === 'apple') return err instanceof AppleError && ['not_installed', 'unavailable', 'crashed', 'timeout'].includes(err.code);
  if (e === 'openai') return err instanceof EngineError && ['not_configured', 'network', 'auth', 'server'].includes(err.code);
  return err instanceof Error && /conectar con Ollama|fetch failed|ECONNREFUSED|not found/i.test(err.message);
}

// ---------- Construcción de prompts por motor ----------
export function contextBlock(context: string): string {
  return `## Información disponible\n${context}`;
}

function condenseHistory(history: ChatMessage[], turns = 6): string {
  return history
    .slice(-turns * 2)
    .map((m) => `${m.role === 'user' ? 'Cliente' : 'Asistente'}: ${m.content.replace(/\s+/g, ' ').slice(0, 220)}`)
    .join('\n');
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5); // español: 3-4 caracteres por token (doc. de Apple)
}

// ---------- Operaciones ----------
export async function generate(engine: Engine, input: GenerateInput): Promise<string> {
  const usage = { task: (input.role ?? 'light') as Task, userId: input.sessionId };
  try {
    let out: string;
    // Lo que cambia en cada turno: información encontrada, nombre del cliente y nota.
    const turn = [
      input.context ? contextBlock(input.context) : '', // vacío: la información ya va completa en la persona
      input.customerName ? `## El cliente\nSe llama ${input.customerName}; úsalo con naturalidad.` : '',
      input.note ? `## Nota para este turno\n${input.note}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    if (engine === 'apple') {
      const prompt = `${turn}\n\n## Mensaje del cliente\n${input.userText}`;
      const r = await apple.chat({
        session: input.sessionId,
        instructions: input.persona,
        prompt,
        history: condenseHistory(input.history),
        fresh: input.fresh,
        temperature: input.temperature ?? env.temperature,
        maxTokens: input.maxTokens ?? 300,
      });
      out = r.content;
    } else if (engine === 'ollama') {
      const messages: ChatMessage[] = [{ role: 'system', content: `${input.persona}\n\n${turn}` }, ...input.history, { role: 'user', content: input.userText }];
      out = await chat({ messages, temperature: input.temperature, numPredict: input.maxTokens ?? 350, usage });
    } else {
      // OpenAI reutiliza el prefijo idéntico más largo (desde 1024 tokens): la persona es igual para todos los clientes
      // y el historial crece turno a turno; lo del turno va al final para no romper ese prefijo.
      const messages: ChatMessage[] = [
        { role: 'system', content: input.persona },
        ...input.history,
        { role: 'system', content: turn },
        { role: 'user', content: input.userText },
      ];
      out = await openaiChat({ messages, temperature: input.temperature, maxTokens: input.maxTokens ?? 350, model: openaiModel(input.role), effort: openaiEffort(input.role), usage });
    }
    markUp(engine);
    return out;
  } catch (err) {
    if (isOutage(engine, err)) markDown(engine, (err as Error).message);
    throw err;
  }
}

export async function classify(engine: Engine, input: ClassifyInput): Promise<string> {
  const usage = { task: input.task ?? ((input.role ?? 'gate') as Task), userId: input.userId };
  try {
    let out: string;
    if (engine === 'apple') {
      const r = await apple.chat({
        session: input.sessionId,
        instructions: input.instructions,
        prompt: input.prompt,
        temperature: 0,
        maxTokens: 300,
        maxTurns: input.maxTurns ?? 10,
        schema: input.schema,
      });
      out = r.content;
    } else {
      const messages: ChatMessage[] = [
        { role: 'system', content: input.instructions },
        { role: 'user', content: input.prompt },
      ];
      out =
        engine === 'ollama'
          ? await chat({ model: env.gateModel, messages, temperature: 0, numPredict: 300, format: toJsonSchema(input.schema), usage })
          : await openaiChat({ messages, maxTokens: 300, schema: input.schema, model: openaiModel(input.role), effort: openaiEffort(input.role), usage });
    }
    markUp(engine);
    return out;
  } catch (err) {
    if (isOutage(engine, err)) markDown(engine, (err as Error).message);
    throw err;
  }
}

function toJsonSchema(spec: SchemaSpec): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const p of spec.properties) {
    properties[p.name] = { type: p.type ?? 'string', ...(p.enum ? { enum: p.enum } : {}), ...(p.description ? { description: p.description } : {}) };
  }
  return { type: 'object', properties, required: spec.properties.map((p) => p.name) };
}

export function engineStatus(): Record<Engine, { available: boolean; reason?: string }> {
  return { ollama: { ...state.ollama }, apple: { ...state.apple }, openai: { ...state.openai } };
}
