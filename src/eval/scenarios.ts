// Batería de escenarios por cliente: pnpm test:scenarios [--only=texto] [--engine=router|ollama|apple|openai|anthropic] [--keep]
// Lee los escenarios de `evalFile` en xencrm.config.json y verifica intención, motor, enlaces y límites.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const engineArg = process.argv.find((a) => a.startsWith('--engine='))?.split('=')[1];
if (engineArg) process.env.LLM_ENGINE = engineArg;
// Probar a Claude de titular necesita su llave. Sale de ~/xencrm-credenciales/anthropic.txt si no viene en el entorno.
// 🪤 NO del .env de la raíz: de ahí la leería cualquier prueba, y una prueba no sale a internet ni gasta.
if (engineArg === 'anthropic' && !process.env.ANTHROPIC_API_KEY) {
  const archivo = join(homedir(), 'xencrm-credenciales', 'anthropic.txt');
  if (existsSync(archivo)) process.env.ANTHROPIC_API_KEY = readFileSync(archivo, 'utf8').trim();
}

const { business, env } = await import('../config.js');
const { handleMessage } = await import('../agent/agent.js');
const { probeEngines, roleEngine, roleLabel, modeloDe } = await import('../llm/engines.js');
const { apple } = await import('../llm/apple.js');
const { getDb, countDocs } = await import('../rag/store.js');
const { purgeContact, getContact } = await import('../crm/contacts.js');
const { analysesSettled } = await import('../crm/analyzer.js');
const { recap } = await import('../crm/recap.js');
const { nextAppointmentFor } = await import('../crm/appointments.js');

interface Expect {
  intent?: string;
  engine?: string; // apple | ollama | openai | template, o 'light' / 'heavy' (rol)
  includesAny?: string[];
  excludes?: string[];
  link?: string; // texto que debe aparecer dentro de un enlace de la respuesta
  noGreeting?: boolean; // no debe volver a saludar ni presentarse
  silent?: boolean; // se espera que no responda (modo humano)
}
interface Scenario {
  name: string;
  turns: { text: string; expect: Expect }[];
}

const SCENARIOS = JSON.parse(readFileSync(business.evalFile, 'utf8')) as Scenario[];

getDb();
const docs = countDocs();
if (!docs.product && !docs.knowledge) {
  console.error('Índice vacío: ejecuta `pnpm ingest` primero.');
  process.exit(1);
}
const engines = await probeEngines();
const light = roleEngine('light');
const heavy = roleEngine('heavy');
// El enrutador reparte si los roles difieren en motor o, con OpenAI, en modelo.
const lanesDiffer = light !== heavy || modeloDe(light, 'light') !== modeloDe(heavy, 'heavy');
const routerReady = lanesDiffer && engines[light].available && engines[heavy].available;
console.log(
  `motores: ${Object.entries(engines)
    .map(([k, v]) => `${k}=${v.available ? '✓' : '✗ ' + (v.reason ?? '')}`)
    .join(' · ')} · modo=${env.llmEngine} (liviano ${roleLabel('light')}, pesado ${roleLabel('heavy')}, gate ${roleLabel('gate')}, análisis ${roleLabel('analysis')})`,
);
console.log(`escenarios: ${business.evalFile} (${SCENARIOS.length})`);
if (!routerReady) console.log('(las expectativas de motor solo se verifican en modo router con ambos motores disponibles)\n');

const only = process.argv.find((a) => a.startsWith('--only='))?.split('=').slice(1).join('=');
const runStarted = Date.now();
const lat: Record<string, number[]> = {};
let pass = 0;
let fail = 0;

for (const sc of SCENARIOS) {
  if (only && !sc.name.includes(only)) continue;
  const userId = `eval:${sc.name.replace(/\W+/g, '-')}`;
  purgeContact(userId);
  await apple.reset(userId).catch(() => undefined);
  console.log(`\n━━ ${sc.name}`);
  for (const turn of sc.turns) {
    const r = await handleMessage({ userId, channel: 'cli', text: turn.text });
    const lane = r.model ? `${r.engine}:${r.model}` : r.engine;
    (lat[lane] ??= []).push(r.ms);
    const problems: string[] = [];
    const e = turn.expect;
    const byRole = e.engine === 'light' || e.engine === 'heavy';
    if (e.intent && r.intent !== e.intent) problems.push(`intent ${r.intent} ≠ ${e.intent}`);
    if (routerReady && byRole && r.role !== e.engine) problems.push(`rol ${r.role ?? r.engine} ≠ ${e.engine}`);
    if (routerReady && e.engine && !byRole && r.engine !== e.engine) problems.push(`engine ${r.engine} ≠ ${e.engine}`);
    if (e.silent && !r.silent) problems.push('debía quedarse en silencio (modo humano)');
    if (e.includesAny && !e.includesAny.some((s) => r.text.includes(s))) problems.push(`no contiene ninguno de: ${e.includesAny.join(' | ')}`);
    if (e.excludes) for (const s of e.excludes) if (r.text.includes(s)) problems.push(`contiene "${s}"`);
    if (e.link && !(r.text.match(/https?:\/\/[^\s]+/g) ?? []).some((u) => u.includes(e.link!))) problems.push(`falta enlace con "${e.link}"`);
    for (const url of r.text.match(/https?:\/\/[^\s]+/g) ?? []) if (!url.startsWith(business.business.siteUrl)) problems.push(`enlace ajeno ${url}`);
    if (e.noGreeting && /^[¡!]?\s*(hola|buenas|hey)/i.test(r.text)) problems.push('vuelve a saludar');
    if (e.noGreeting && new RegExp(`^(soy|es) ${business.agent.name}`, 'i').test(r.text)) problems.push('vuelve a presentarse');
    const ok = problems.length === 0;
    ok ? pass++ : fail++;
    console.log(
      `${ok ? '✓' : '✗'} ${r.ms}ms · ${r.intent}(${r.gateVia || 'rule'}) · ${lane}${r.route ? ` [${r.route}]` : ''}\n   > ${turn.text}\n   < ${(r.silent ? '(silencio: modo humano)' : r.text).replace(/\n+/g, ' ⏎ ').slice(0, 260)}`,
    );
    if (!ok) console.log(`   ✗ ${problems.join('; ')}`);
  }
}

// El análisis corre en segundo plano: se espera a que termine y se muestra cómo quedó cada ficha.
console.log('\n━━ fichas (análisis)');
if (!(await analysesSettled())) console.log('(el análisis no terminó a tiempo)');
for (const sc of SCENARIOS) {
  if (only && !sc.name.includes(only)) continue;
  const c = getContact(`eval:${sc.name.replace(/\W+/g, '-')}`);
  if (c) console.log(`${sc.name.slice(0, 32).padEnd(32)} ${String(c.score).padStart(3)} · ${c.stage} · ${c.sentiment ?? '-'} · ${c.summary ?? ''}\n${''.padEnd(33)}recap: ${recap(c, nextAppointmentFor(c.id)) || '—'}`);
}

console.log('\n━━ resumen');
for (const [engine, times] of Object.entries(lat)) {
  const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
  console.log(`${engine.padEnd(22)} ${String(times.length).padStart(2)} turnos · media ${avg}ms · max ${Math.max(...times)}ms`);
}
const { usageSummary, formatUsage } = await import('../llm/usage.js');
console.log('\n━━ consumo');
console.log(formatUsage(usageSummary(runStarted, { userPrefix: 'eval:' })));
console.log(`${pass} ok · ${fail} fallos`);
// Las conversaciones de prueba no deben ensuciar la bandeja, ocupar la agenda ni salir en el calendario suscrito.
// --keep las deja para revisarlas en el tablero (sus citas se borran igual).
const { deleteAppointmentsByPrefix } = await import('../crm/appointments.js');
const { deleteContactsByPrefix } = await import('../crm/contacts.js');
if (process.argv.includes('--keep')) deleteAppointmentsByPrefix('eval:');
else deleteContactsByPrefix('eval:');
apple.stop();
process.exit(fail ? 1 : 0);
