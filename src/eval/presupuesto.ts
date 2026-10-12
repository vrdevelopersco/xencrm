// El tope de gasto de IA (sin modelo y sin red): pnpm test:presupuesto
//
// Lo que se prueba es lo que le pasa a un negocio cuando se acerca a su tope: cuándo cambia de escalón, que avise
// una sola vez, que al 90 % lo específico baje al modelo barato, y que al 100 % no salga ni una llamada a la IA de
// pago y aun así nadie se quede sin respuesta. También que, si hay un motor en la máquina, siga contestando ese.
//
// 🪤 Todo en una carpeta temporal con un negocio de ejemplo. OpenAI y Ollama son de mentira: se cuenta cada
// llamada que les llega, que es justo lo que el tope tiene que frenar.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'aiva-presupuesto-'));
const base = JSON.parse(readFileSync(new URL('../../aiva.config.example.json', import.meta.url), 'utf8')) as Record<string, unknown>;
writeFileSync(
  join(dir, 'aiva.config.json'),
  JSON.stringify({ ...base, timezone: 'America/Bogota', appointments: { enabled: true, service: 'visita', location: 'la tienda', days: [0, 1, 2, 3, 4, 5, 6], hours: [['08:00', '20:00']], minLeadHours: 0 } }),
);
writeFileSync(join(dir, '.env'), '');
Object.assign(process.env, {
  AIVA_CONFIG: join(dir, 'aiva.config.json'),
  AIVA_ENV_FILE: join(dir, '.env'),
  DB_PATH: join(dir, 'data', 'prueba.db'), // la carpeta de archivos vive al lado: así queda dentro de la temporal
  WHATSAPP_ENABLED: 'false',
  LLM_ENGINE: 'router',
  LIGHT_ENGINE: 'openai',
  HEAVY_ENGINE: 'openai',
  GATE_ENGINE: 'openai',
  ANALYSIS_ENGINE: 'openai',
  OPENAI_API_KEY: 'clave-de-prueba',
  OPENAI_BASE_URL: 'http://openai.prueba/v1',
  OPENAI_MODEL: 'gpt-5.4-mini',
  OPENAI_MODEL_LIGHT: 'gpt-5.4-mini',
  OPENAI_MODEL_HEAVY: 'gpt-5.4',
  OPENAI_MODEL_GATE: 'gpt-5.4-mini',
  OPENAI_MODEL_ANALYSIS: 'gpt-5.4-mini',
  EMBED_ENGINE: 'ollama',
  OLLAMA_URL: 'http://ollama.prueba',
  CHAT_MODEL: 'gemma-de-prueba',
  GATE_MODEL: 'gemma-de-prueba',
  EMBED_MODEL: 'vectores-de-prueba',
  TOPE_USD_MES: '5',
});

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};

// ---------- OpenAI y Ollama de mentira ----------
let aOpenAI = 0;
let aOllama = 0;
let ollamaArriba = false;
globalThis.fetch = (async (url: string | URL | Request, opciones?: RequestInit) => {
  const u = String(url);
  const cuerpo = JSON.parse(String(opciones?.body ?? '{}')) as { response_format?: { json_schema?: { schema?: { properties?: Record<string, unknown> } } }; input?: string | string[] };
  if (u.startsWith('http://openai.prueba/v1/models/')) return Response.json({ id: 'ok' });
  if (u === 'http://openai.prueba/v1/chat/completions') {
    aOpenAI++;
    const props = cuerpo.response_format?.json_schema?.schema?.properties;
    const content = props ? JSON.stringify('intent' in props ? { intent: 'compra', consulta_busqueda: '' } : {}) : 'Claro, te cuento.';
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 20 } });
  }
  if (u === 'http://ollama.prueba/api/tags') {
    if (!ollamaArriba) throw new Error('ECONNREFUSED');
    return Response.json({ models: [{ name: 'gemma-de-prueba' }, { name: 'vectores-de-prueba' }] });
  }
  if (u === 'http://ollama.prueba/api/embed') {
    const textos = Array.isArray(cuerpo.input) ? cuerpo.input : [String(cuerpo.input ?? '')];
    return Response.json({ embeddings: textos.map(() => [1, 0, 0]) });
  }
  if (u === 'http://ollama.prueba/api/chat') {
    if (!ollamaArriba) throw new Error('ECONNREFUSED');
    aOllama++;
    return Response.json({ message: { content: 'Te respondo desde la máquina.' }, prompt_eval_count: 50, eval_count: 10 });
  }
  throw new Error(`la prueba no sale a la red: ${u}`);
}) as typeof fetch;

const p = await import('../crm/presupuesto.js');
const { recordUsage, costUsd } = await import('../llm/usage.js');
const { getDb } = await import('../rag/store.js');
const { onEvent } = await import('../crm/events.js');
const { setSetting } = await import('../crm/settings.js');
const engines = await import('../llm/engines.js');
const { chooseEngine } = await import('../agent/router.js');
const { handleMessage } = await import('../agent/agent.js');
const { TOPE_REPLIES, HUMAN_REPLIES } = await import('../agent/prompts.js');
const { getContact } = await import('../crm/contacts.js');
const { analyzeContact } = await import('../crm/analyzer.js');
const { transcribir, NoSeTranscribe } = await import('../llm/transcribir.js');
const { startNotifications, listNotifications } = await import('../crm/notifications.js');
const { ticketsDe } = await import('../consola.js');
const { saludDelCliente } = await import('../salud.js');
startNotifications();

const eventos: { nivel: string; texto: string }[] = [];
onEvent((ev) => {
  if (ev.type === 'presupuesto') eventos.push({ nivel: String(ev.payload.nivel), texto: String(ev.payload.texto) });
});

// Un gasto de `usd` dólares, en el instante `ts`: tokens de entrada de gpt-5.4-mini, que cuestan 0.75 por millón.
const POR_MILLON = costUsd('openai', 'gpt-5.4-mini', 1_000_000, 0, 0)!;
const gastar = (usd: number, ts: number) => {
  recordUsage({ engine: 'openai', model: 'gpt-5.4-mini', task: 'light', inputTokens: Math.round((usd / POR_MILLON) * 1_000_000), outputTokens: 0, ms: 1 });
  getDb().prepare('UPDATE llm_usage SET ts = ? WHERE id = (SELECT MAX(id) FROM llm_usage)').run(ts);
};
const borrarGasto = () => getDb().exec('DELETE FROM llm_usage');
const ahora = Date.now();
const cerca = (a: number, b: number) => Math.abs(a - b) < 0.001;

// =====================================================================================================
console.log('— El mes es el del negocio');
{
  // 12 de octubre de 2026 al mediodía en Bogotá (UTC−5).
  const m = p.mesDe(Date.UTC(2026, 9, 12, 17, 0));
  check('empieza el día 1 a medianoche en Bogotá', m.desde === Date.UTC(2026, 9, 1, 5, 0), new Date(m.desde).toISOString());
  check('y acaba el 1 del mes siguiente', m.hasta === Date.UTC(2026, 10, 1, 5, 0), new Date(m.hasta).toISOString());
  // 🪤 El 31 a las 11:30 p. m. en Bogotá ya es 1 de noviembre en UTC: sigue siendo octubre para quien paga.
  const tarde = p.mesDe(Date.UTC(2026, 10, 1, 4, 30));
  check('🪤 el 31 a las 11:30 p. m. sigue siendo octubre, aunque en UTC ya sea noviembre', tarde.clave === '2026-10', tarde.clave);
  const diciembre = p.mesDe(Date.UTC(2026, 11, 20, 17, 0));
  check('diciembre acaba en enero del año siguiente', diciembre.hasta === Date.UTC(2027, 0, 1, 5, 0), new Date(diciembre.hasta).toISOString());
}

console.log('— Cuánto se puede gastar');
check('sin tope puesto, vale el TOPE_USD_MES del .env', p.topeUsdMes() === 5, String(p.topeUsdMes()));
p.ponerTope(10);
check('el de la consola le gana al del .env', p.topeUsdMes() === 10);
p.ponerTope(0);
check('🪤 quitarlo desde la consola no resucita el del .env', p.topeUsdMes() === null, String(p.topeUsdMes()));
check('sin tope, el escalón es «sin tope»', p.presupuesto(ahora).nivel === 'sin_tope');
for (const malo of [-3, 'veinte', 1e9]) {
  let error = '';
  try {
    p.ponerTope(malo as number);
  } catch (e) {
    error = (e as Error).message;
  }
  check(`un tope de ${JSON.stringify(malo)} no se guarda`, Boolean(error), 'se guardó');
}
check('«12,50» con coma también vale', p.ponerTope('12,50').tope === 12.5);

console.log('— Los escalones');
p.ponerTope(10);
const { desde } = p.mesDe(ahora);
gastar(7.9, ahora);
gastar(3, desde - 1000); // el mes pasado: no cuenta
recordUsage({ engine: 'ollama', model: 'gemma-de-prueba', task: 'light', inputTokens: 10_000_000, outputTokens: 0, ms: 1 }); // la máquina no cuesta
let v = p.presupuesto(ahora);
check('el mes pasado no cuenta, y lo de la máquina tampoco', cerca(v.gastado, 7.9), String(v.gastado));
check('7,90 de 10: va bien', v.nivel === 'normal' && v.porcentaje === 79, `${v.nivel} ${v.porcentaje}`);
check('y no avisa nada', eventos.length === 0, JSON.stringify(eventos));
gastar(0.1, ahora);
v = p.presupuesto(ahora);
check('8 de 10: aviso', v.nivel === 'aviso', v.nivel);
check('avisa una vez', eventos.length === 1 && eventos[0]!.nivel === 'aviso', JSON.stringify(eventos));
check('con cifras de verdad en el aviso', /\$8\.00 de IA este mes, el 80 % del tope de \$10\.00/.test(eventos[0]?.texto ?? ''), eventos[0]?.texto);
p.presupuesto(ahora);
check('🪤 preguntar otra vez no vuelve a avisar', eventos.length === 1, JSON.stringify(eventos));
gastar(1, ahora);
v = p.presupuesto(ahora);
check('9 de 10: ahorro, y su aviso', v.nivel === 'ahorro' && eventos.at(-1)?.nivel === 'ahorro' && eventos.length === 2, `${v.nivel} · ${eventos.length}`);
gastar(1, ahora);
v = p.presupuesto(ahora);
check('10 de 10: se acabó, y su aviso', v.nivel === 'agotado' && eventos.at(-1)?.nivel === 'agotado' && eventos.length === 3, `${v.nivel} · ${eventos.length}`);
check('el aviso del 100 % dice qué pasa ahora', /no usa la IA de pago/.test(eventos.at(-1)?.texto ?? ''), eventos.at(-1)?.texto);
p.ponerTope(20);
check('subir el tope saca del escalón al instante, sin reiniciar', p.presupuesto().nivel === 'normal', p.presupuesto().nivel);
p.ponerTope(10);
p.presupuesto(ahora);
check('🪤 bajarlo otra vez en el mismo mes no repite el aviso del 100 %', eventos.length === 3, JSON.stringify(eventos.map((e) => e.nivel)));
recordUsage({ engine: 'openai', model: 'modelo-sin-tarifa', task: 'light', inputTokens: 100, outputTokens: 0, ms: 1 });
check('un modelo sin tarifa conocida se dice', p.presupuesto(ahora).sinPrecio);
check('la campana lo cuenta', listNotifications().some((n) => n.kind === 'presupuesto' && /tope de gasto/.test(n.title)), JSON.stringify(listNotifications().slice(0, 3)));

// =====================================================================================================
console.log('— Al 90 %: lo específico, con el barato');
{
  // 🪤 Antes de sondear, ningún motor cuenta como disponible: el saludo va al pesado por eso, y no por lo que se
  // pidió. Ahí no va el «dame un segundito que lo consulto»: a un «hola» no se le consulta nada.
  const caido = chooseEngine({ intent: 'saludo', userText: 'hola', estimatedTokens: 100 });
  check('con los motores caídos, un saludo va al pesado pero sin aviso de que va a tardar', caido.role === 'heavy' && !caido.porLoQuePidio, JSON.stringify(caido));
}
await engines.probeEngines(); // OpenAI contesta; Ollama no
borrarGasto();
p.ponerTope(10);
p.olvidarPresupuesto();
const especifico = { intent: 'compra' as const, userText: '¿qué me recomiendas para una boda de día?', estimatedTokens: 500, lastRole: undefined };
check('lejos del tope, lo específico va al pesado, y con aviso', chooseEngine(especifico).role === 'heavy' && chooseEngine(especifico).porLoQuePidio === true, JSON.stringify(chooseEngine(especifico)));
gastar(9.2, ahora);
p.olvidarPresupuesto();
const conAhorro = chooseEngine(especifico);
check('al 92 %, lo contesta el de responder', conAhorro.role === 'light' && /ahorro/.test(conAhorro.reason), JSON.stringify(conAhorro));

// =====================================================================================================
console.log('— Al 100 %, sin un motor en la máquina');
gastar(1, ahora);
p.olvidarPresupuesto();
check('ningún motor de la máquina contesta', engines.motorSinCosto() === null && engines.iaAgotada());
{
  const antes = aOpenAI;
  let error: unknown = null;
  try {
    await engines.generate('openai', { sessionId: 'x', persona: 'p', context: '', userText: 'hola', history: [] });
  } catch (e) {
    error = e;
  }
  check('🪤 una llamada que se olvidó del tope no sale: el freno está en el motor', error instanceof p.TopeAlcanzado && aOpenAI === antes, String(error));
}
{
  const antes = aOpenAI;
  const r = await handleMessage({ userId: 'web:tope-1', channel: 'web', text: '¿tienen macetas grandes?' });
  check('lo que necesita IA → al cliente se le dice que le contesta una persona', (TOPE_REPLIES as readonly string[]).includes(r.text), r.text);
  check('ni una llamada a OpenAI', aOpenAI === antes, `${aOpenAI - antes} llamadas`);
  check('la conversación pasa al equipo', getContact('web:tope-1')?.humanMode === true);
  check('y la campana dice por qué, no que pidió una persona', listNotifications().some((n) => n.kind === 'handoff' && /pasó al equipo/.test(n.title) && /tope de gasto/.test(n.body)), JSON.stringify(listNotifications().slice(0, 2)));
  const otra = await handleMessage({ userId: 'web:tope-1', channel: 'web', text: '¿y en qué colores?' });
  check('lo que siga escribiendo lo atiende una persona, sin repetirle el aviso', otra.silent === true, JSON.stringify(otra));
}
{
  const antes = aOpenAI;
  const r = await handleMessage({ userId: 'web:tope-2', channel: 'web', text: 'quiero agendar una visita' });
  check('agendar sigue funcionando: es un flujo sin IA', r.route.includes('cita') && !(TOPE_REPLIES as readonly string[]).includes(r.text), `${r.route} · ${r.text}`);
  check('y no gastó nada', aOpenAI === antes, `${aOpenAI - antes} llamadas`);
  check('ni le quitó la conversación al asistente', getContact('web:tope-2')?.humanMode !== true);
}
{
  const r = await handleMessage({ userId: 'web:tope-3', channel: 'web', text: 'quiero hablar con una persona' });
  check('pedir una persona, igual que siempre', (HUMAN_REPLIES as readonly string[]).includes(r.text), r.text);
}
{
  const antes = aOpenAI;
  await analyzeContact('web:tope-1');
  const fila = getDb().prepare("SELECT engine FROM analyses WHERE user_id = 'web:tope-1' ORDER BY ts DESC LIMIT 1").get() as { engine: string } | undefined;
  check('🪤 la ficha se sigue actualizando con lo que sabe el código, sin modelo', fila?.engine === 'reglas' && aOpenAI === antes, `${fila?.engine} · ${aOpenAI - antes} llamadas`);
}
{
  let error: unknown = null;
  try {
    await transcribir('/no/existe.ogg', { segundos: 12 });
  } catch (e) {
    error = e;
  }
  check('una nota de voz no se transcribe: queda para el equipo', error instanceof NoSeTranscribe && /tope/.test((error as Error).message), String(error));
}
check('/_salud lo dice, sin cifras', saludDelCliente().presupuesto.nivel === 'agotado' && saludDelCliente().avisos.some((a) => /tope de gasto/.test(a) && !/\$/.test(a)), JSON.stringify(saludDelCliente().avisos));

// =====================================================================================================
console.log('— Al 100 %, con un motor en la máquina');
ollamaArriba = true;
await engines.probeEngines();
p.olvidarPresupuesto();
check('Ollama contesta, así que la IA no se acabó del todo', engines.motorSinCosto() === 'ollama' && !engines.iaAgotada());
check('OpenAI sale de la lista y queda la máquina', JSON.stringify(engines.fallbackOrder('openai')) === '["ollama"]', JSON.stringify(engines.fallbackOrder('openai')));
{
  const antes = { openai: aOpenAI, ollama: aOllama };
  const r = await handleMessage({ userId: 'web:tope-4', channel: 'web', text: '¿tienen macetas grandes?' });
  check('se sigue contestando, desde la máquina', r.text === 'Te respondo desde la máquina.' && aOllama > antes.ollama, `${r.text} · ${r.route}`);
  check('y OpenAI no recibe nada', aOpenAI === antes.openai, `${aOpenAI - antes.openai} llamadas`);
  check('el asistente sigue con la conversación', getContact('web:tope-4')?.humanMode !== true);
}
ollamaArriba = false;
await engines.probeEngines();

// =====================================================================================================
console.log('— La consola');
const estado = (nivel: string, porcentaje: number) => ({ arriba: true, presupuesto: { tope: 10, gastado: porcentaje / 10, porcentaje, nivel } });
const cliente = { slug: 'x', nombre: 'X', puerto: 1, host: '', prioridad: 'media' as const, desde: '2026-01-01' };
const titulos = (nivel: string, porcentaje: number) => ticketsDe(cliente as never, estado(nivel, porcentaje) as never).map((t) => `${t.urgencia}:${t.titulo}`);
check('al 100 % es urgente aunque nada esté caído', titulos('agotado', 100).some((t) => t.startsWith('alta:') && /tope de gasto/.test(t)), JSON.stringify(titulos('agotado', 100)));
check('al 90 %, media', titulos('ahorro', 92).some((t) => t.startsWith('media:') && /92 %/.test(t)), JSON.stringify(titulos('ahorro', 92)));
check('al 80 %, baja', titulos('aviso', 81).some((t) => t.startsWith('baja:')), JSON.stringify(titulos('aviso', 81)));
check('sin tope, ningún ticket', ticketsDe(cliente as never, { arriba: true, presupuesto: { tope: null, gastado: 3, porcentaje: null, nivel: 'sin_tope' } } as never).length === 0);

// El mes siguiente vuelve a empezar: el aviso es por mes.
setSetting('presupuesto.avisado', '2020-01:agotado');
p.presupuesto(ahora);
check('en un mes nuevo, el aviso vuelve a salir', eventos.at(-1)?.nivel === 'agotado' && eventos.length === 4, JSON.stringify(eventos.map((e) => e.nivel)));

console.log(fail ? `\n${fail} fallaron` : '\ntodo ok');
process.exit(fail ? 1 : 0);
