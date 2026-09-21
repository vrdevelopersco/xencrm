// Repasa conversaciones sintéticas del cliente (seedFile y evalFile de aiva.config.json) con los motores
// configurados y mide tokens y costo: pnpm replay [--fast] [--only=texto] [--keep]
// Por defecto espera el análisis después de cada mensaje, como en un chat real (la persona tarda en responder);
// --fast manda los mensajes seguidos (el análisis se agrupa y el costo sale menor que en la realidad).
// --out=archivo.json guarda la ficha final de cada conversación, para comparar configuraciones.
import { readFileSync, writeFileSync } from 'node:fs';

const { business } = await import('../config.js');
const { handleMessage } = await import('../agent/agent.js');
const { probeEngines, roleLabel } = await import('../llm/engines.js');
const { purgeContact, getContact } = await import('../crm/contacts.js');
const { analysesSettled } = await import('../crm/analyzer.js');
const { recap } = await import('../crm/recap.js');
const { nextAppointmentFor } = await import('../crm/appointments.js');
const { usageSummary, formatUsage } = await import('../llm/usage.js');
const { apple } = await import('../llm/apple.js');

const fast = process.argv.includes('--fast');
const only = process.argv.find((a) => a.startsWith('--only='))?.split('=').slice(1).join('=');
const outFile = process.argv.find((a) => a.startsWith('--out='))?.split('=').slice(1).join('=');

interface Conversation {
  name: string;
  turns: string[];
}
const convs: Conversation[] = [];
if (business.seedFile) {
  const seed = JSON.parse(readFileSync(business.seedFile, 'utf8')) as { name: string | null; messages: { role: string; text: string }[] }[];
  for (const c of seed) convs.push({ name: `seed: ${c.name ?? 'sin nombre'}`, turns: c.messages.filter((m) => m.role === 'user').map((m) => m.text) });
}
const scenarios = JSON.parse(readFileSync(business.evalFile, 'utf8')) as { name: string; turns: { text: string }[] }[];
for (const s of scenarios) convs.push({ name: `escenario: ${s.name}`, turns: s.turns.map((t) => t.text) });

await probeEngines();
console.log(`motores: liviano ${roleLabel('light')} · pesado ${roleLabel('heavy')} · gate ${roleLabel('gate')} · análisis ${roleLabel('analysis')}`);
console.log(`${convs.length} conversaciones · ritmo ${fast ? 'rápido (mensajes seguidos)' : 'real (análisis tras cada mensaje)'}\n`);

const started = Date.now();
const per: { name: string; userId: string; messages: number; usd: number; calls: number; analysis: Record<string, number>; ficha: unknown }[] = [];
for (const [i, c] of convs.entries()) {
  if (only && !c.name.includes(only)) continue;
  const userId = `replay:${i}-${c.name.replace(/\W+/g, '-').slice(0, 30)}`;
  purgeContact(userId);
  await apple.reset(userId).catch(() => undefined);
  const t0 = Date.now();
  for (const text of c.turns) {
    await handleMessage({ userId, channel: 'cli', text });
    if (!fast) await analysesSettled();
  }
  await analysesSettled();
  const s = usageSummary(t0, { userPrefix: userId });
  const ct = getContact(userId);
  const { getDb } = await import('../rag/store.js');
  const engines = getDb().prepare('SELECT engine, COUNT(*) n FROM analyses WHERE user_id = ? GROUP BY engine').all(userId) as { engine: string; n: number }[];
  per.push({
    name: c.name,
    userId,
    messages: c.turns.length,
    usd: s.totalUsd,
    calls: s.rows.reduce((a, r) => a + r.calls, 0),
    analysis: Object.fromEntries(engines.map((e) => [e.engine, e.n])),
    ficha: ct && { score: ct.score, stage: ct.stage, sentiment: ct.sentiment, recap: recap(ct, nextAppointmentFor(userId)), summary: ct.summary, data: ct.data },
  });
  console.log(`${c.name.slice(0, 52).padEnd(52)} ${String(c.turns.length).padStart(2)} msj · $${s.totalUsd.toFixed(4)} · ${s.rows.reduce((a, r) => a + r.calls, 0)} llamadas`);
}

if (outFile) writeFileSync(outFile, JSON.stringify(per, null, 2));
console.log('\n━━ consumo del repaso');
const total = usageSummary(started, { userPrefix: 'replay:' });
console.log(formatUsage(total));
if (total.usdPerConversation !== null) {
  const msgs = per.reduce((a, p) => a + p.messages, 0);
  console.log(`\nproyección: 1.000 conversaciones como estas ≈ $${((total.totalUsd / per.length) * 1000).toFixed(2)} · 1.000 mensajes del cliente ≈ $${((total.totalUsd / msgs) * 1000).toFixed(2)}`);
}
// Las conversaciones de prueba no deben ensuciar la bandeja, ocupar la agenda ni salir en el calendario suscrito.
// --keep las deja para revisarlas en el tablero (sus citas se borran igual).
const { deleteAppointmentsByPrefix } = await import('../crm/appointments.js');
const { deleteContactsByPrefix } = await import('../crm/contacts.js');
if (process.argv.includes('--keep')) deleteAppointmentsByPrefix('replay:');
else deleteContactsByPrefix('replay:');
apple.stop();
process.exit(0);
