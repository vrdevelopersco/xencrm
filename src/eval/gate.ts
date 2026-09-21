// Pruebas de las reglas del gate (sin modelo): pnpm test:gate
// 1) Casos a mano: qué resuelven las reglas y qué deben dejarle al modelo.
// 2) Cobertura sobre el corpus: mensajes guardados + ejemplos de los clientes, comparados con la intención ya decidida.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { ruleIntent } from '../agent/gate.js';
import type { ChatMessage } from '../llm/ollama.js';

const before: ChatMessage[] = [{ role: 'assistant', content: 'Te puedo mostrar dos opciones: el esmoquin negro y el traje azul.' }];
type Case = [text: string, intent: string | null, query?: string, history?: ChatMessage[]];
const CASES: Case[] = [
  ['¿dónde quedan?', 'info_tienda', 'ubicación'],
  ['hola, cuál es la dirección de la boutique?', 'info_tienda', 'ubicación'],
  ['¿a qué hora abren los sábados?', 'info_tienda', 'horarios'],
  ['atienden los domingos?', 'info_tienda', 'horarios'],
  ['¿y el horario?', 'info_tienda', 'horarios', before],
  ['aceptan tarjeta de crédito?', 'info_tienda', 'pago'],
  ['¿hacen envíos a Santa Marta?', 'info_tienda', 'envíos y domicilios · envios santa marta'],
  ['tienen parqueadero?', 'info_tienda', 'parqueadero'],
  ['¿tienen estacionamiento?', 'info_tienda', 'parqueadero'],
  // Del diccionario del cliente (aiva.config.json > dictionary): pagos locales y sus verbos
  ['¿aceptan nequi?', 'info_tienda', 'formas de pago'],
  ['¿confeccionan chalecos?', 'compra', 'chalecos'],
  ['cómo funciona el proceso?', 'info_tienda'],
  ['¿cuánto se demora un traje a la medida?', 'info_tienda'],
  ['dónde quedan y cuánto vale el alquiler?', 'info_tienda', 'ubicación y dirección de la tienda · quedan alquiler'],
  ['dónde quedan y a qué hora atienden?', 'info_tienda', 'ubicación y dirección de la tienda · horarios de atención'],
  ['¿cuánto cuesta el alquiler de un esmoquin?', 'compra', 'alquiler esmoquin'],
  ['precio del traje azul', 'compra', 'traje azul'],
  ['¿alquilan esmoquin?', 'compra', 'esmoquin'],
  ['Buenas, soy padrino en una boda el 18 de octubre, ¿alquilan esmoquin?', 'compra', 'esmoquin'],
  ['tienen vestidos de novia?', 'compra', 'vestidos novia'],
  // Al modelo: dependen del turno anterior, no dicen de qué hablan o pueden estar fuera de tema.
  ['¿cuánto vale?', null],
  ['¿y eso cuánto vale?', null, undefined, before],
  ['cuánto cuesta el primero?', null, undefined, before],
  ['¿alquilan?', null],
  ['me recomiendas una serie para ver este fin de semana?', null],
  ['cómo hago un for loop en python', null],
  ['me caso en diciembre y busco traje, ustedes alquilan o hacen a la medida?', null],
  ['qué me recomiendas para una boda de día?', null],
  ['quiero un traje para mi grado en noviembre, cómo funciona?', null],
  ['quiero saber dónde quedan', 'info_tienda', 'ubicación'],
  // Las de siempre
  ['hola', 'saludo'],
  ['quiero hablar con una persona', 'humano'],
  ['quiero agendar una cita', 'cita'],
  ['¿tienen espacio el sábado en la tarde?', 'cita'],
];

let fail = 0;
for (const [text, intent, query, history] of CASES) {
  const r = ruleIntent(text, history ?? []);
  const got = r?.intent ?? null;
  const ok = got === intent && (!query || (r?.query ?? '').toLowerCase().includes(query.toLowerCase()));
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${text.slice(0, 60).padEnd(60)} → ${got ?? 'modelo'}${r?.query ? ` [${r.query}]` : ''}${ok ? '' : `  (esperaba ${intent ?? 'modelo'}${query ? ` [${query}]` : ''})`}`);
}

// ---------- Cobertura sobre el corpus ----------
const corpus: { text: string; label: string | null; followUp: boolean; source: string }[] = [];
const seen = new Set<string>();
const push = (text: string, label: string | null, followUp: boolean, source: string) => {
  const key = text.trim().toLowerCase();
  if (!seen.has(key)) corpus.push({ text, label, followUp, source }), seen.add(key);
};
for (const dir of readdirSync('examples')) {
  const file = `examples/${dir}/scenarios.json`;
  if (!existsSync(file)) continue;
  for (const sc of JSON.parse(readFileSync(file, 'utf8')) as { turns: { text: string; expect: { intent?: string } }[] }[])
    sc.turns.forEach((t, i) => push(t.text, t.expect.intent ?? null, i > 0, dir));
}
const { getDb } = await import('../rag/store.js');
const rows = getDb()
  .prepare("SELECT user_id, content, intent, ts FROM messages WHERE role = 'user' AND intent IS NOT NULL ORDER BY user_id, ts")
  .all() as { user_id: string; content: string; intent: string }[];
rows.forEach((r, i) => push(r.content, r.intent, i > 0 && rows[i - 1]!.user_id === r.user_id, 'guardados'));

const byIntent: Record<string, number> = {};
let decided = 0;
let agree = 0;
let labeled = 0;
const disagreements: string[] = [];
for (const m of corpus) {
  const r = ruleIntent(m.text, m.followUp ? before : []);
  if (!r) continue;
  decided++;
  byIntent[r.intent] = (byIntent[r.intent] ?? 0) + 1;
  if (m.label && !['cita', 'humano', 'saludo'].includes(r.intent)) {
    labeled++;
    if (r.intent === m.label) agree++;
    else disagreements.push(`   ${m.label.padEnd(12)} → reglas: ${r.intent.padEnd(12)} ${m.text.slice(0, 70)}`);
  }
}
console.log(`\ncorpus: ${corpus.length} mensajes distintos · las reglas resuelven ${decided} (${Math.round((100 * decided) / corpus.length)} %), el resto va al modelo`);
console.log(`   por intención: ${Object.entries(byIntent).map(([k, v]) => `${k} ${v}`).join(' · ')} (compra e info_tienda son las reglas nuevas)`);
console.log(`reglas nuevas vs. intención ya decidida: ${agree}/${labeled} coinciden${disagreements.length ? '\n' + disagreements.join('\n') : ''}`);
console.log(`\n${CASES.length - fail} ok · ${fail} fallos`);
process.exit(fail ? 1 : 0);
