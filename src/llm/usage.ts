// Registro de consumo de los modelos: tokens y costo por tarea, modelo y conversación.
// Cada llamada a OpenAI u Ollama deja una fila en llm_usage; el tablero y `pnpm usage` la resumen.
import { getDb } from '../rag/store.js';
import { idDelTurno } from '../crm/turnos.js';

/** light/heavy = responder; gate = clasificar; analysis = ficha y puntaje; when = interpretar fechas. */
// `consulta` es aparte para que se vea cuánto cuesta lo que pregunta el equipo, que no es lo que gasta
// atendiendo clientes. Mezclarlo escondería las dos cosas: parecería que atender cuesta más de lo que cuesta.
export type Task = 'light' | 'heavy' | 'gate' | 'analysis' | 'when' | 'embeddings' | 'consulta' | 'transcripcion';

export interface UsageTag {
  task?: Task;
  /** Conversación que originó la llamada. */
  userId?: string;
}

export interface UsageEntry extends UsageTag {
  engine: string;
  model: string;
  inputTokens: number;
  cachedTokens?: number;
  outputTokens: number;
  reasoningTokens?: number;
  /** Segundos de audio, cuando el modelo se cobra por minuto en vez de por tokens. */
  segundos?: number;
  ms: number;
}

// USD por millón de tokens, tarifa estándar. Consultado el 2026-09-21 en developers.openai.com/api/docs/pricing.
// Un modelo que no esté aquí se registra igual, sin costo.
const PRICES: Record<string, { input: number; cached: number; output: number }> = {
  'gpt-5.5': { input: 5, cached: 0.5, output: 30 },
  'gpt-5.4': { input: 2.5, cached: 0.25, output: 15 },
  'gpt-5.4-mini': { input: 0.75, cached: 0.075, output: 4.5 },
  'gpt-5.4-nano': { input: 0.2, cached: 0.02, output: 1.25 },
  'gpt-5-mini': { input: 0.25, cached: 0.025, output: 2 },
  'gpt-4.1-mini': { input: 0.4, cached: 0.1, output: 1.6 },
  'gpt-4o-mini': { input: 0.15, cached: 0.075, output: 0.6 },
  // Vectores de búsqueda: no generan salida, solo leen. Son centavos al año con este volumen.
  'text-embedding-3-small': { input: 0.02, cached: 0.02, output: 0 },
  'text-embedding-3-large': { input: 0.13, cached: 0.13, output: 0 },
};

/** Costo en USD de una llamada; null si el modelo no tiene precio conocido (los locales cuestan 0). */
/**
 * Lo que se cobra POR MINUTO, no por tokens. Tabla aparte porque es otra unidad.
 *
 * 🪤 Meter esto en la tabla de tokens saldría barato de escribir y daría una cifra falsa en el informe de
 * gasto, que es justo el sitio donde una cifra falsa hace daño: es la que se mira para decidir si algo se
 * puede dejar encendido. Consultado el 2026-10-08.
 */
const POR_MINUTO: Record<string, number> = {
  'gpt-4o-mini-transcribe': 0.003,
  'gpt-4o-transcribe': 0.006,
  'whisper-1': 0.006,
};

export function costUsd(engine: string, model: string, input: number, cached: number, output: number, segundos = 0): number | null {
  if (engine !== 'openai') return 0;
  const limpio = model.replace(/-\d{4}-\d{2}-\d{2}$/, '');
  const porMinuto = POR_MINUTO[limpio];
  if (porMinuto !== undefined) return (segundos / 60) * porMinuto;
  const p = PRICES[limpio];
  if (!p) return null;
  return ((input - cached) * p.input + cached * p.cached + output * p.output) / 1_000_000;
}

export function recordUsage(e: UsageEntry): void {
  try {
    getDb()
      .prepare(
        'INSERT INTO llm_usage (ts, user_id, task, engine, model, input_tokens, cached_tokens, output_tokens, reasoning_tokens, segundos, ms, turno) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(Date.now(), e.userId ?? null, e.task ?? 'light', e.engine, e.model, e.inputTokens, e.cachedTokens ?? 0, e.outputTokens, e.reasoningTokens ?? 0, e.segundos ?? 0, e.ms, idDelTurno());
  } catch (err) {
    console.warn('[usage] no se pudo registrar:', (err as Error).message);
  }
}

export interface UsageRow {
  task: string;
  engine: string;
  model: string;
  calls: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  /** Segundos de audio transcrito, cuando el modelo se cobra por minuto. */
  segundos: number;
  avgMs: number;
  costUsd: number | null;
}

export interface UsageSummary {
  since: number;
  rows: UsageRow[];
  totalUsd: number;
  /** Algún modelo usado no tiene precio conocido: el total se queda corto. */
  unpriced: boolean;
  conversations: number;
  customerMessages: number;
  usdPerConversation: number | null;
  usdPerMessage: number | null;
}

/** Consumo desde `since` (ms), opcionalmente solo de conversaciones cuyo id empieza por `userPrefix`. */
export function usageSummary(since: number, opts: { userPrefix?: string } = {}): UsageSummary {
  const db = getDb();
  const prefix = opts.userPrefix ? `${opts.userPrefix}%` : '%';
  const raw = db
    .prepare(
      `SELECT task, engine, model, COUNT(*) calls, SUM(input_tokens) input, SUM(cached_tokens) cached, SUM(output_tokens) output,
              SUM(reasoning_tokens) reasoning, SUM(COALESCE(segundos, 0)) segundos, AVG(ms) ms
       FROM llm_usage WHERE ts >= ? AND COALESCE(user_id, '') LIKE ? GROUP BY task, engine, model ORDER BY task, model`,
    )
    .all(since, prefix) as { task: string; engine: string; model: string; calls: number; input: number; cached: number; output: number; reasoning: number; segundos: number; ms: number }[];
  let totalUsd = 0;
  let unpriced = false;
  const rows: UsageRow[] = raw.map((r) => {
    const cost = costUsd(r.engine, r.model, r.input, r.cached, r.output, r.segundos);
    if (cost === null) unpriced = true;
    else totalUsd += cost;
    return {
      task: r.task,
      engine: r.engine,
      model: r.model,
      calls: r.calls,
      inputTokens: r.input,
      segundos: r.segundos ?? 0,
      cachedTokens: r.cached,
      outputTokens: r.output,
      reasoningTokens: r.reasoning,
      avgMs: Math.round(r.ms),
      costUsd: cost,
    };
  });
  // Todas las conversaciones con mensajes del cliente en el periodo, también las que el código resolvió sin modelo.
  const counts = db
    .prepare(`SELECT COUNT(DISTINCT user_id) conversations, COUNT(*) messages FROM messages WHERE role = 'user' AND ts >= ? AND user_id LIKE ?`)
    .get(since, prefix) as { conversations: number; messages: number };
  return {
    since,
    rows,
    totalUsd,
    unpriced,
    conversations: counts.conversations,
    customerMessages: counts.messages,
    usdPerConversation: counts.conversations ? totalUsd / counts.conversations : null,
    usdPerMessage: counts.messages ? totalUsd / counts.messages : null,
  };
}

const TASK_NAMES: Record<string, string> = { light: 'responder (liviano)', heavy: 'responder (pesado)', gate: 'clasificar', analysis: 'análisis', when: 'fechas', embeddings: 'búsqueda (vectores)' };

/** Tabla de texto para la consola. */
export function formatUsage(s: UsageSummary): string {
  const usd = (n: number | null) => (n === null ? '   s/p' : `$${n.toFixed(n < 0.01 ? 5 : 4)}`);
  const lines = [
    'tarea                 modelo                 llamadas  entrada/llamada  caché  salida/llamada  razon.   ms     costo',
    ...s.rows.map(
      (r) =>
        `${(TASK_NAMES[r.task] ?? r.task).padEnd(21)} ${`${r.engine === 'openai' ? '' : r.engine + ':'}${r.model}`.padEnd(22)} ${String(r.calls).padStart(8)}  ${String(Math.round(r.inputTokens / r.calls)).padStart(15)}  ${`${Math.round((100 * r.cachedTokens) / Math.max(1, r.inputTokens))}%`.padStart(5)}  ${String(Math.round(r.outputTokens / r.calls)).padStart(14)}  ${String(Math.round(r.reasoningTokens / r.calls)).padStart(6)}  ${String(r.avgMs).padStart(5)}  ${usd(r.costUsd).padStart(9)}`,
    ),
    `total ${usd(s.totalUsd)}${s.unpriced ? ' (hay modelos sin precio)' : ''} · ${s.conversations} conversaciones · ${s.customerMessages} mensajes del cliente` +
      (s.usdPerConversation !== null ? ` · ${usd(s.usdPerConversation)} por conversación · ${usd(s.usdPerMessage)} por mensaje` : ''),
  ];
  return lines.join('\n');
}
