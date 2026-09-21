// Chat de prueba en terminal: pnpm chat
// Funciona interactivo y también con entrada por tubería:  printf 'hola\nlink de la monstera\n' | pnpm chat
import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';
import { business, env } from './config.js';
import { probeEngines } from './llm/engines.js';
import { apple } from './llm/apple.js';
import { countDocs, getDb } from './rag/store.js';
import { handleMessage } from './agent/agent.js';

// El iterador se crea ANTES de cualquier await: readline solo guarda en cola las líneas (y el cierre de la
// tubería) que ocurren después de crearlo; si no, la entrada por tubería se perdería mientras se sondean motores.
const interactive = Boolean(stdin.isTTY);
const rl = createInterface({ input: stdin, output: interactive ? stdout : undefined, terminal: interactive });
const lines = rl[Symbol.asyncIterator]();

getDb();
const engines = await probeEngines();
console.log(`motores: ollama=${engines.ollama.available ? '✓' : '✗ ' + engines.ollama.reason} · apple=${engines.apple.available ? '✓' : '✗ ' + engines.apple.reason} · modo=${env.llmEngine}`);
if (!engines.ollama.available && !engines.apple.available) {
  console.error('Ningún motor disponible. Arranca Ollama o compila el sidecar (pnpm build:sidecar).');
  process.exit(1);
}
const docs = countDocs();
if (!docs.product && !docs.knowledge) console.warn('No hay documentos indexados. Ejecuta: pnpm ingest');

const userId = `cli:${process.env.USER ?? 'local'}`;
console.log(`\n${business.agent.name} (${business.business.name}) · docs ${JSON.stringify(docs)}`);
console.log('Escribe tu mensaje. Comandos: /reset (borra memoria), /salir\n');

const prompt = () => {
  if (interactive) rl.prompt();
};
rl.setPrompt('tú > ');
prompt();
for await (const raw of { [Symbol.asyncIterator]: () => lines }) {
  const line = raw.trim();
  if (!line) {
    prompt();
    continue;
  }
  if (line === '/salir' || line === '/exit') break;
  if (!interactive) console.log(`tú > ${line}`);
  const r = await handleMessage({ userId, channel: 'cli', text: line });
  console.log(`\n${business.agent.name} > ${r.text}\n   [${r.intent} · ${r.engine}${r.route ? ` (${r.route})` : ''} · ${r.ms}ms${r.sources.length ? ' · ' + r.sources.map((s) => s.title).join(' | ') : ''}]\n`);
  prompt();
}
rl.close();
apple.stop();
process.exit(0);
