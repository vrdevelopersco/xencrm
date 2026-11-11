// Pruebas del selector de embeddings (sin modelo de verdad): pnpm test:embeddings
// Los vectores de búsqueda pueden salir de Ollama (local) o de OpenAI (centavos, sin dependencias). Lo que se
// comprueba aquí es que el selector elija bien, que la respuesta se ordene como llegó y que el consumo quede
// registrado, sin llamar a ningún servicio: se intercepta fetch.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'xencrm-embed-')), 'xencrm.db');
process.env.EMBED_ENGINE = 'openai';
process.env.OPENAI_API_KEY = 'sk-de-prueba';
const { embed, embedModelo } = await import('../llm/embeddings.js');
const { usageSummary } = await import('../llm/usage.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};

check('con EMBED_ENGINE=openai usa el modelo de OpenAI', embedModelo() === 'text-embedding-3-small', embedModelo());

// Se intercepta la llamada: la respuesta llega DESORDENADA a propósito, como puede pasar de verdad.
const original = globalThis.fetch;
let pedido: { url: string; body: Record<string, unknown> } | null = null;
globalThis.fetch = (async (url: string, init: { body: string }) => {
  pedido = { url: String(url), body: JSON.parse(init.body) as Record<string, unknown> };
  return {
    ok: true,
    json: async () => ({
      data: [
        { index: 1, embedding: [0.2, 0.2] },
        { index: 0, embedding: [0.1, 0.1] },
      ],
      usage: { prompt_tokens: 12 },
    }),
  };
}) as unknown as typeof fetch;

const vectores = await embed(['uno', 'dos']);
globalThis.fetch = original;

check('le pega al endpoint de embeddings', /\/embeddings$/.test(pedido!.url), pedido!.url);
check('manda el modelo y los textos', pedido!.body.model === 'text-embedding-3-small' && JSON.stringify(pedido!.body.input) === '["uno","dos"]', JSON.stringify(pedido!.body));
check('devuelve los vectores en el orden que se pidieron', JSON.stringify(vectores) === '[[0.1,0.1],[0.2,0.2]]', JSON.stringify(vectores));

const consumo = usageSummary(0);
const fila = consumo.rows.find((r) => r.task === 'embeddings');
check('el consumo queda registrado como búsqueda', Boolean(fila) && fila!.inputTokens === 12, JSON.stringify(consumo.rows));
check('y con su precio, que es ridículo pero no cero', fila!.costUsd !== null && fila!.costUsd > 0 && fila!.costUsd < 0.000001, String(fila!.costUsd));

check('sin textos no llama a nadie', (await embed([])).length === 0);

console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
