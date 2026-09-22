// Pruebas de cuándo corre el análisis (sin modelo): pnpm test:schedule
// Una ráfaga de mensajes paga un análisis; una conversación larga y activa, uno cada espera máxima; "flush" corre ya.
// Tiempos cortos para la prueba (0,3 s de silencio, 1 s de espera máxima) y una base temporal.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'aiva-sched-')), 'aiva.db');
const { business } = await import('../config.js');
const { touchUser, appendMessage } = await import('../agent/memory.js');
const { scheduleAnalysis, flushAnalyses, analysesSettled } = await import('../crm/analyzer.js');
const { getDb } = await import('../rag/store.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};
business.crm.analysisQuietSeconds = 0.3;
business.crm.analysisMaxWaitSeconds = 1;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const runs = (userId: string) => (getDb().prepare('SELECT COUNT(*) n FROM analyses WHERE user_id = ?').get(userId) as { n: number }).n;
// Mensajes triviales: el análisis los resuelve por reglas, sin modelo, y deja su registro.
const say = (userId: string) => {
  appendMessage(userId, 'user', 'ok gracias', 'saludo');
  scheduleAnalysis(userId);
};

touchUser('test:rafaga', 'cli', null);
for (let i = 0; i < 5; i++) {
  say('test:rafaga');
  await sleep(80);
}
check('durante la ráfaga no se analiza', runs('test:rafaga') === 0);
await sleep(600);
check('cinco mensajes seguidos: un solo análisis, tras el silencio', runs('test:rafaga') === 1, String(runs('test:rafaga')));

touchUser('test:activa', 'cli', null);
for (let i = 0; i < 8; i++) {
  say('test:activa');
  await sleep(200); // nunca hay 0,3 s de silencio
}
check('conversación activa: la espera máxima fuerza un análisis a mitad', runs('test:activa') >= 1, String(runs('test:activa')));
await sleep(600);
check('y otro al quedar en silencio (dos en total, no ocho)', runs('test:activa') === 2, String(runs('test:activa')));

touchUser('test:flush', 'cli', null);
say('test:flush');
flushAnalyses('test:flush');
await analysesSettled();
check('flush corre ya lo pendiente (para escenarios y repasos)', runs('test:flush') === 1, String(runs('test:flush')));

console.log(`\n${fail ? `${fail} fallos` : 'todo ok'}`);
process.exit(fail ? 1 : 0);
