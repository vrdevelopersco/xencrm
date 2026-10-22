// Claude de respaldo (sin red y sin gastar): pnpm test:claude
//
// Lo que se prueba es lo que pasa el día que OpenAI falla en un servidor donde no hay nada más: que conteste Claude,
// con el modelo de la altura de cada rol, que la caché se pida donde se repite de verdad y que lo que cueste quede
// bien contado —también lo que cuesta guardar en la caché, que con Claude no es gratis—.
//
// 🪤 Todo en una carpeta temporal con un negocio de ejemplo. OpenAI y Claude son de mentira: cada uno contesta lo
// que la prueba le dice, y se guarda lo que le llegó para mirar cómo se le pidió.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'aiva-claude-'));
const base = JSON.parse(readFileSync(new URL('../../aiva.config.example.json', import.meta.url), 'utf8')) as Record<string, unknown>;
writeFileSync(join(dir, 'aiva.config.json'), JSON.stringify({ ...base, timezone: 'America/Bogota' }));
writeFileSync(join(dir, '.env'), '');
Object.assign(process.env, {
  AIVA_CONFIG: join(dir, 'aiva.config.json'),
  AIVA_ENV_FILE: join(dir, '.env'),
  DB_PATH: join(dir, 'data', 'prueba.db'),
  WHATSAPP_ENABLED: 'false',
  LLM_ENGINE: 'router',
  LIGHT_ENGINE: 'openai',
  HEAVY_ENGINE: 'openai',
  GATE_ENGINE: 'openai',
  ANALYSIS_ENGINE: 'openai',
  OPENAI_API_KEY: 'clave-de-prueba',
  OPENAI_BASE_URL: 'http://openai.prueba/v1',
  OPENAI_MODEL: 'gpt-5.4-mini',
  OPENAI_MODEL_HEAVY: 'gpt-5.4',
  ANTHROPIC_API_KEY: 'clave-de-claude-de-prueba',
  ANTHROPIC_BASE_URL: 'http://claude.prueba/v1',
  // Los de por omisión, a propósito: Haiku para lo de siempre y Sonnet para lo específico y para clasificar.
  ANTHROPIC_MODEL: '',
  ANTHROPIC_MODEL_HEAVY: '',
  ANTHROPIC_MODEL_GATE: '',
  EMBED_ENGINE: 'ollama',
  OLLAMA_URL: 'http://ollama.prueba',
  CHAT_MODEL: 'gemma-de-prueba',
  EMBED_MODEL: 'vectores-de-prueba',
  TOPE_USD_MES: '',
});

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};

// ---------- OpenAI y Claude de mentira ----------
type Llamada = { url: string; headers: Record<string, string>; cuerpo: Record<string, unknown> };
const aClaude: Llamada[] = [];
let aOpenAI = 0;
/** Qué hace OpenAI: contestar, caerse (500), quedarse sin saldo (429) o no tener red. */
let openai: 'bien' | 'caido' | 'sin_saldo' | 'sin_red' = 'bien';
/** Lo que contesta Claude a la próxima llamada, si la prueba quiere algo distinto de lo normal. */
let claudeDice: ((c: Record<string, unknown>) => Response) | null = null;
let claudeModelos: Record<string, number> = {};
globalThis.fetch = (async (url: string | URL | Request, opciones?: RequestInit) => {
  const u = String(url);
  const cuerpo = JSON.parse(String(opciones?.body ?? '{}')) as Record<string, unknown>;
  if (u.startsWith('http://openai.prueba/v1/models/')) return Response.json({ id: 'ok' });
  if (u === 'http://openai.prueba/v1/chat/completions') {
    aOpenAI++;
    if (openai === 'sin_red') throw new Error('ECONNRESET');
    if (openai === 'caido') return new Response('{"error":{"message":"server error"}}', { status: 500 });
    if (openai === 'sin_saldo') return new Response('{"error":{"code":"insufficient_quota","message":"You exceeded your current quota"}}', { status: 429 });
    const props = (cuerpo.response_format as { json_schema?: { schema?: { properties?: Record<string, unknown> } } } | undefined)?.json_schema?.schema?.properties;
    const content = props ? JSON.stringify('intent' in props ? { intent: 'compra', consulta_busqueda: '' } : {}) : 'Te contesta OpenAI.';
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 20 } });
  }
  if (u.startsWith('http://claude.prueba/v1/models/')) {
    const m = decodeURIComponent(u.split('/').pop()!);
    claudeModelos[m] = (claudeModelos[m] ?? 0) + 1;
    return Response.json({ id: m, type: 'model' });
  }
  if (u === 'http://claude.prueba/v1/messages') {
    const headers = Object.fromEntries(Object.entries((opciones?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    aClaude.push({ url: u, headers, cuerpo });
    if (claudeDice) {
      const f = claudeDice;
      claudeDice = null;
      return f(cuerpo);
    }
    const formato = (cuerpo.output_config as { format?: { schema?: { properties?: Record<string, unknown> } } } | undefined)?.format;
    const props = formato?.schema?.properties;
    const text = props ? JSON.stringify('intent' in props ? { intent: 'compra', consulta_busqueda: 'macetas' } : {}) : 'Te contesta Claude.';
    return Response.json({
      type: 'message',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text }],
      usage: { input_tokens: 40, cache_creation_input_tokens: 1000, cache_read_input_tokens: 2000, output_tokens: 30 },
    });
  }
  if (u === 'http://ollama.prueba/api/tags') throw new Error('ECONNREFUSED');
  if (u === 'http://ollama.prueba/api/embed') {
    const textos = Array.isArray(cuerpo.input) ? (cuerpo.input as string[]) : [String(cuerpo.input ?? '')];
    return Response.json({ embeddings: textos.map(() => [1, 0, 0]) });
  }
  if (u === 'http://ollama.prueba/api/chat') throw new Error('ECONNREFUSED');
  throw new Error(`la prueba no sale a la red: ${u}`);
}) as typeof fetch;

const engines = await import('../llm/engines.js');
const { paraClaude, anthropicChat, anthropicModel, codigoDeError } = await import('../llm/anthropic.js');
const { costUsd, efectoCache, usageSummary, recordUsage } = await import('../llm/usage.js');
const { getDb } = await import('../rag/store.js');
const { classify: gate } = await import('../agent/gate.js');
const { handleMessage } = await import('../agent/agent.js');
const { saludDelCliente } = await import('../salud.js');
const { EngineError } = await import('../llm/errors.js');
const pres = await import('../crm/presupuesto.js');
const cerca = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const ultimaFila = () => getDb().prepare('SELECT * FROM llm_usage ORDER BY id DESC LIMIT 1').get() as Record<string, number | string>;

// =====================================================================================================
console.log('— Qué modelo atiende cada cosa');
check('lo de todos los días con Haiku', anthropicModel('light') === 'claude-haiku-5-5', anthropicModel('light'));
check('el análisis con Haiku', anthropicModel('analysis') === 'claude-haiku-5-5', anthropicModel('analysis'));
check('lo específico con Sonnet', anthropicModel('heavy') === 'claude-sonnet-5-5', anthropicModel('heavy'));
check('🪤 el clasificador con Sonnet: no baja de categoría ni siendo el suplente', anthropicModel('gate') === 'claude-sonnet-5-5', anthropicModel('gate'));

// =====================================================================================================
console.log('— La conversación como la acepta Claude');
{
  const m = paraClaude([
    { role: 'assistant', content: 'Hola, te escribimos por tu pedido.' },
    { role: 'user', content: 'hola' },
    { role: 'user', content: '¿siguen abiertos?' },
    { role: 'user', content: '   ' },
    { role: 'system', content: 'esto no va aquí' },
    { role: 'assistant', content: 'Sí, hasta las 6.' },
    { role: 'user', content: 'gracias' },
  ]);
  check('🪤 si empezó el negocio, se dice, porque Claude exige que empiece el cliente', m[0]?.role === 'user' && /empezó el negocio/.test(m[0].content[0]!.text), JSON.stringify(m[0]));
  check('los mensajes seguidos del cliente van juntos, en uno', m.filter((x) => x.role === 'user').some((x) => x.content[0]!.text === 'hola\n\n¿siguen abiertos?'), JSON.stringify(m));
  check('los vacíos y los de sistema no pasan', !JSON.stringify(m).includes('esto no va aquí') && m.every((x) => x.content[0]!.text.trim()), JSON.stringify(m));
  check('quedan alternados', m.every((x, i) => i === 0 || x.role !== m[i - 1]!.role), m.map((x) => x.role).join(','));
  check('sin pedirlo, no se marca el historial para la caché', !JSON.stringify(m).includes('cache_control'));
  const c = paraClaude(
    [
      { role: 'user', content: 'uno' },
      { role: 'assistant', content: 'dos' },
      { role: 'user', content: 'tres' },
    ],
    true,
  );
  check('pidiéndolo, la marca va en el final de lo conversado: el penúltimo', Boolean(c[1]!.content[0]!.cache_control) && !c[0]!.content[0]!.cache_control && !c[2]!.content[0]!.cache_control, JSON.stringify(c));
  check('con un solo mensaje no hay historial que guardar', !JSON.stringify(paraClaude([{ role: 'user', content: 'solo' }], true)).includes('cache_control'));
}

// =====================================================================================================
console.log('— Cómo se le pide');
{
  aClaude.length = 0;
  const out = await anthropicChat({ system: 'Eres el asistente.', messages: [{ role: 'user', content: 'hola' }], model: 'claude-haiku-5-5', maxTokens: 123, usage: { task: 'light', userId: 'web:x' } });
  const c = aClaude[0]!;
  check('contesta el texto de Claude', out === 'Te contesta Claude.', out);
  check('con la llave en x-api-key y la versión de la API', c.headers['x-api-key'] === 'clave-de-claude-de-prueba' && c.headers['anthropic-version'] === '2023-06-01', JSON.stringify(Object.keys(c.headers)));
  const system = c.cuerpo.system as { text: string; cache_control?: { type: string } }[];
  check('lo fijo va en system y marcado para la caché', system[0]?.text === 'Eres el asistente.' && system[0]?.cache_control?.type === 'ephemeral', JSON.stringify(system));
  check('🪤 sin la marca automática de arriba, que caería sobre lo del turno', !('cache_control' in c.cuerpo));
  check('con su tope de salida', c.cuerpo.max_tokens === 123);

  aClaude.length = 0;
  await anthropicChat({ system: 'Clasifica.', messages: [{ role: 'user', content: 'quiero una maceta' }], schema: { properties: [{ name: 'intent', enum: ['compra', 'saludo'] }] } as never });
  const f = (aClaude[0]!.cuerpo.output_config as { format: { type: string; schema: { additionalProperties: boolean; required: string[] } } }).format;
  check('pidiendo JSON, va el esquema estricto en output_config', f.type === 'json_schema' && f.schema.additionalProperties === false && f.schema.required.includes('intent'), JSON.stringify(f));
  check('y a temperatura 0', aClaude[0]!.cuerpo.temperature === 0);

  // 🪤 Hay modelos que rechazan `temperature`: se aprende al primer 400 y se repite sin ella.
  aClaude.length = 0;
  claudeDice = () => new Response('{"type":"error","error":{"type":"invalid_request_error","message":"temperature is not supported for this model"}}', { status: 400 });
  const otra = await anthropicChat({ system: 'x', messages: [{ role: 'user', content: 'hola' }], model: 'claude-razona-de-prueba', temperature: 0.4 });
  check('si rechaza la temperatura, repite sin ella y contesta', otra === 'Te contesta Claude.' && aClaude.length === 2 && !('temperature' in aClaude[1]!.cuerpo), JSON.stringify(aClaude.map((x) => x.cuerpo.temperature)));
  aClaude.length = 0;
  await anthropicChat({ system: 'x', messages: [{ role: 'user', content: 'hola' }], model: 'claude-razona-de-prueba', temperature: 0.4 });
  check('y desde ahí ya no la manda a ese modelo', aClaude.length === 1 && !('temperature' in aClaude[0]!.cuerpo));
}

// =====================================================================================================
console.log('— Qué cuenta como caído');
check('🪤 sin saldo es un 400, no un 402: se reconoce por el texto', codigoDeError(400, '{"error":{"message":"Your credit balance is too low to access the Anthropic API."}}') === 'sin_saldo');
check('un 400 cualquiera es la petición, no el motor', codigoDeError(400, 'messages: roles must alternate') === 'bad_request');
check('529 (sobrecargado) es del motor', codigoDeError(529, 'overloaded') === 'server');
check('401 es la llave', codigoDeError(401, '') === 'auth');
check('404 es el modelo', codigoDeError(404, '') === 'sin_modelo');
{
  claudeDice = () => new Response('{"error":{"message":"Your credit balance is too low to access the Anthropic API."}}', { status: 400 });
  let err: unknown;
  try {
    await anthropicChat({ system: 'x', messages: [{ role: 'user', content: 'hola' }] });
  } catch (e) {
    err = e;
  }
  check('sin saldo sale como error sin_saldo', err instanceof EngineError && err.code === 'sin_saldo', String(err));
}

// =====================================================================================================
console.log('— Lo que cuesta, con la caché');
{
  getDb().exec('DELETE FROM llm_usage');
  await anthropicChat({ system: 'x', messages: [{ role: 'user', content: 'hola' }], model: 'claude-haiku-5-5', usage: { task: 'light', userId: 'web:x' } });
  const f = ultimaFila();
  check('🪤 la entrada es el total, como con OpenAI: lo nuevo + lo guardado + lo leído', f.input_tokens === 40 + 1000 + 2000, String(f.input_tokens));
  check('lo leído de la caché, en su columna', f.cached_tokens === 2000, String(f.cached_tokens));
  check('lo guardado en la caché, en la suya', f.cache_write_tokens === 1000, String(f.cache_write_tokens));
  check('queda como de anthropic con su modelo', f.engine === 'anthropic' && f.model === 'claude-haiku-5-5', `${f.engine} ${f.model}`);
  // Haiku 5.5: 0,10 entrada · 0,01 leer · 0,125 guardar · 0,50 salida, por millón.
  const esperado = (40 * 0.1 + 2000 * 0.01 + 1000 * 0.125 + 30 * 0.5) / 1e6;
  const c = costUsd('anthropic', 'claude-haiku-5-5', 3040, 2000, 30, 0, 1000)!;
  check('el costo cobra cada pedazo a su tarifa', cerca(c, esperado), `${c} ≠ ${esperado}`);
  check('🪤 guardar cuesta más que la entrada normal, no igual', costUsd('anthropic', 'claude-haiku-5-5', 1000, 0, 0, 0, 1000)! > costUsd('anthropic', 'claude-haiku-5-5', 1000, 0, 0, 0, 0)!);
  check('Sonnet lee la caché a 0,05 × la entrada', cerca(costUsd('anthropic', 'claude-sonnet-5-5', 1_000_000, 1_000_000, 0)!, 0.1));
  check('un modelo con fecha cobra como su familia', costUsd('anthropic', 'claude-haiku-4-5-20251001', 1_000_000, 0, 0) === 1);
  check('OpenAI sigue cobrando igual', cerca(costUsd('openai', 'gpt-5.4-mini', 1_000_000, 0, 0)!, 0.75));
  const e = efectoCache('anthropic', 'claude-haiku-5-5', 2000, 1000)!;
  check('el efecto de la caché da lo ahorrado al leer', cerca(e.ahorroUsd, (2000 * (0.1 - 0.01)) / 1e6), String(e.ahorroUsd));
  check('y lo que costó de más guardar', cerca(e.guardarUsd, (1000 * (0.125 - 0.1)) / 1e6), String(e.guardarUsd));
  check('con OpenAI guardar no cuesta', efectoCache('openai', 'gpt-5.4-mini', 2000, 0)!.guardarUsd === 0);
  const s = usageSummary(0);
  const cc = s.cache.find((x) => x.engine === 'anthropic');
  check('el informe trae la caché de Claude con las dos cifras', Boolean(cc && cerca(cc.ahorroUsd, e.ahorroUsd) && cerca(cc.guardarUsd, e.guardarUsd)), JSON.stringify(s.cache));
  check('y su total incluye lo de guardar', cerca(s.totalUsd, esperado), `${s.totalUsd} ≠ ${esperado}`);
  // El tope muestra lo gastado redondeado; lo que importa es que lo de Claude esté sumado.
  check('lo de Claude cuenta para el tope del mes', Math.abs(pres.presupuesto().gastado - esperado) < 0.0001 && pres.presupuesto().gastado > 0, String(pres.presupuesto().gastado));
}

// =====================================================================================================
console.log('— Cuándo entra el respaldo');
await engines.probeEngines();
check('con llave y modelos, Claude queda disponible', engines.engineStatus().anthropic.available, JSON.stringify(engines.engineStatus().anthropic));
check('se sondean los modelos de todos los roles (Haiku y Sonnet)', Boolean(claudeModelos['claude-haiku-5-5'] && claudeModelos['claude-sonnet-5-5']), JSON.stringify(claudeModelos));
check('con OpenAI bien, primero OpenAI y Claude detrás', JSON.stringify(engines.fallbackOrder('openai')) === '["openai","anthropic"]', JSON.stringify(engines.fallbackOrder('openai')));
check('🪤 Claude no se ofrece en la consola: no es de los que se asignan a un rol', !engines.ENGINES.includes('anthropic'));

{
  aClaude.length = 0;
  openai = 'caido';
  // Una frase que las reglas no resuelven solas: si no, el clasificador ni llama a un modelo.
  const g = await gate('quiero comprar una maceta', [], 'web:gate-1');
  check('OpenAI caído: el clasificador lo resuelve Claude', g.via === 'anthropic' && g.intent === 'compra', JSON.stringify(g));
  check('🪤 y con Sonnet, no con Haiku', aClaude.some((c) => c.cuerpo.model === 'claude-sonnet-5-5' && Boolean(c.cuerpo.output_config)), JSON.stringify(aClaude.map((c) => c.cuerpo.model)));
  check('🪤 recién caído OpenAI, Claude pasa adelante: nadie espera a que OpenAI vuelva a fallar', JSON.stringify(engines.fallbackOrder('openai')) === '["anthropic","openai"]', JSON.stringify(engines.fallbackOrder('openai')));
}

{
  aClaude.length = 0;
  const antes = aOpenAI;
  const r = await handleMessage({ userId: 'web:respaldo-1', channel: 'web', text: '¿tienen macetas grandes?' });
  check('el cliente recibe la respuesta de Claude', r.text.includes('Te contesta Claude') && r.engine === 'anthropic', JSON.stringify({ text: r.text, engine: r.engine, route: r.route }));
  check('y queda anotado con qué modelo', typeof r.model === 'string' && r.model.startsWith('claude-'), String(r.model));
  check('sin pasar por OpenAI mientras está en su minuto de enfriamiento', aOpenAI === antes, `${aOpenAI - antes} llamadas a OpenAI`);
  const resp = aClaude.find((c) => !c.cuerpo.output_config);
  const sys = (resp?.cuerpo.system as { text: string }[] | undefined)?.[0]?.text ?? '';
  const msgs = (resp?.cuerpo.messages ?? []) as { role: string; content: { text: string }[] }[];
  check('la persona va en system, marcada para la caché', sys.length > 200 && JSON.stringify(resp?.cuerpo.system).includes('cache_control'), sys.slice(0, 80));
  // Con caché, releer la información completa sale casi gratis: Claude la recibe como OpenAI, y no solo lo que
  // encontró la búsqueda, que en un negocio chico deja fuera justo lo que preguntan.
  check('Claude recibe la información completa del negocio, fija en lo que se guarda', sys.includes('## Información disponible (todo el negocio)'), sys.slice(-200));
  check('🪤 el mensaje del cliente va al final, después de lo del turno', /## Mensaje del cliente\n¿tienen macetas grandes\?$/.test(msgs[msgs.length - 1]?.content[0]?.text ?? ''), JSON.stringify(msgs[msgs.length - 1]));
  const saludo = saludDelCliente().avisos.find((a) => /openai/.test(a));
  check('la salud dice que contesta el respaldo, no que nadie contesta', Boolean(saludo && /contestando Claude/.test(saludo)), String(saludo));
}

{
  // Pasado el minuto, OpenAI vuelve a ir primero: es el que se eligió.
  openai = 'bien';
  await engines.probeEngines();
  check('con OpenAI de vuelta, vuelve a ir primero', JSON.stringify(engines.fallbackOrder('openai')) === '["openai","anthropic"]', JSON.stringify(engines.fallbackOrder('openai')));
  aClaude.length = 0;
  const r = await handleMessage({ userId: 'web:respaldo-2', channel: 'web', text: '¿tienen macetas grandes?' });
  check('y Claude no gasta nada mientras OpenAI conteste', r.engine === 'openai' && aClaude.length === 0, `${r.engine} · ${aClaude.length} llamadas a Claude`);
}

{
  // 🪤 Sin saldo en OpenAI es un 429 como pasarse de velocidad; tiene que dejarlo fuera, no chocar mensaje a mensaje.
  openai = 'sin_saldo';
  const g = await gate('ustedes trabajan con empresas o solo con personas naturales', [], 'web:gate-2');
  check('OpenAI sin saldo: contesta Claude', g.via === 'anthropic', JSON.stringify(g));
  check('🪤 y OpenAI queda fuera un rato, con Claude adelante', JSON.stringify(engines.fallbackOrder('openai')) === '["anthropic","openai"]', JSON.stringify(engines.fallbackOrder('openai')));
  openai = 'bien';
  await engines.probeEngines();
}

{
  // El tope de gasto también frena a Claude: un respaldo que no lo respetara sería la forma de saltárselo.
  // Dos dólares gastados con un tope de un centavo (el tope se guarda en centavos: menos sería «sin tope»).
  recordUsage({ engine: 'anthropic', model: 'claude-sonnet-5-5', task: 'light', inputTokens: 1_000_000, outputTokens: 0, ms: 1 });
  pres.ponerTope(0.01);
  check('con el tope alcanzado, Claude tampoco entra', !engines.fallbackOrder('openai').includes('anthropic'), JSON.stringify(engines.fallbackOrder('openai')));
  let err = '';
  try {
    await engines.classify('anthropic', { sessionId: 'x', instructions: 'x', prompt: 'x', schema: { properties: [{ name: 'a' }] } as never });
  } catch (e) {
    err = (e as Error).constructor.name;
  }
  check('y si alguien lo llama directo, lo frena el último freno', err === 'TopeAlcanzado', err);
  pres.ponerTope(0);
}

// =====================================================================================================
console.log('— Sin llave no hay respaldo, y no pasa nada');
{
  const { env } = await import('../config.js');
  const llave = env.anthropicApiKey;
  env.anthropicApiKey = '';
  await engines.probeEngines();
  const st = engines.engineStatus().anthropic;
  check('sin llave, no disponible y dice por qué', !st.available && st.reason === 'sin ANTHROPIC_API_KEY', JSON.stringify(st));
  check('y no entra en la lista', !engines.fallbackOrder('openai').includes('anthropic'), JSON.stringify(engines.fallbackOrder('openai')));
  env.anthropicApiKey = llave;
}

// =====================================================================================================
console.log('— Lo que se ve fuera del código');
{
  const js = readFileSync(new URL('../../public/admin.js', import.meta.url), 'utf8');
  check('el tablero nombra a Claude como respaldo', js.includes("'claude (respaldo)'"));
  check('🪤 el informe de gasto da lo ahorrado Y lo que costó guardar', /function cacheLineas/.test(js) && /guardarlo costó/.test(js) && /más que no tenerla/.test(js));
  check('el pie ya no dice que todo es tarifa de OpenAI', !js.includes('tarifa estándar de OpenAI'));
  const paquete = readFileSync(new URL('../paquete.ts', import.meta.url), 'utf8');
  check('el LEEME del paquete dice qué variable poner para el respaldo', /# ANTHROPIC_API_KEY=sk-ant-/.test(paquete));
  const ejemplo = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
  check('y el .env de ejemplo también', /^ANTHROPIC_API_KEY=$/m.test(ejemplo));
}

console.log(fail ? `\n✗ ${fail} fallaron` : '\n✓ Claude de respaldo: todo bien');
process.exit(fail ? 1 : 0);
