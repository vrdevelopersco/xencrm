// De dónde salen los vectores para buscar en el catálogo y en lo que sabe el negocio.
//
// Dos caminos, y se elige con EMBED_ENGINE:
//   · ollama (por defecto): `bge-m3` corriendo en la misma máquina. Gratis y nada sale de ahí. Pide ~3 GB de RAM.
//   · openai: `text-embedding-3-small`. Cuesta $0.02 por millón de tokens —una búsqueda son ~20 tokens— y quita la
//     única dependencia pesada, que es lo que permite correr XENCRM en una máquina chica o en un hosting de apps.
//
// 🪤 Los vectores de dos modelos NO son comparables: bge-m3 da 1024 números y text-embedding-3-small 1536. Al
// cambiar de motor hay que volver a indexar (`pnpm ingest`). Mientras tanto, el buscador descarta los vectores que
// no midan lo mismo y avisa una vez, en vez de devolver resultados al azar.
import { env } from '../config.js';
import { embed as embedOllama } from './ollama.js';
import { recordUsage } from './usage.js';

const OPENAI_POR_DEFECTO = 'text-embedding-3-small';

async function embedOpenAI(texts: string[], model: string): Promise<number[][]> {
  const t0 = Date.now();
  const r = await fetch(`${env.openaiBaseUrl}/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.openaiApiKey}` },
    body: JSON.stringify({ model, input: texts }),
  });
  if (!r.ok) throw new Error(`OpenAI embeddings HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = (await r.json()) as { data: { embedding: number[]; index: number }[]; usage?: { prompt_tokens?: number } };
  recordUsage({
    task: 'embeddings',
    engine: 'openai',
    model,
    inputTokens: Number(data.usage?.prompt_tokens ?? 0),
    outputTokens: 0,
    ms: Date.now() - t0,
  });
  // La respuesta trae el índice de cada uno: se ordena para devolverlos como llegaron.
  return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

/** Convierte textos en vectores con el motor configurado. */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (env.embedEngine === 'openai') return embedOpenAI(texts, env.embedModel === 'bge-m3' ? OPENAI_POR_DEFECTO : env.embedModel);
  return embedOllama(texts);
}

/** Qué modelo se está usando de verdad: sirve para avisar cuando el índice quedó de otro. */
export function embedModelo(): string {
  return env.embedEngine === 'openai' ? (env.embedModel === 'bge-m3' ? OPENAI_POR_DEFECTO : env.embedModel) : env.embedModel;
}
