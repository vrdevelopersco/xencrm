// Configuración › Modelos de IA (sin red y sin gastar): pnpm test:modelos
//
// XENCRM deja conectar seis proveedores desde el tablero —OpenAI, Anthropic (Claude), Apple, Ollama, LM Studio y
// otra API compatible con OpenAI— y decir cuál hace cada rol. Aquí se prueba lo que no puede fallar: que una llave
// no vuelve nunca al navegador, que se comprueba ANTES de guardarla, que lo guardado espera al reinicio y lo dice,
// que LM Studio y el compatible hablan con SU dirección (y sin la llave de OpenAI), y que ni un asesor ni el
// candado llegan a estas rutas.
//
// 🪤 Todo en una carpeta temporal con un `.env` de mentira, y la red también de mentira: cada dirección contesta lo
// que la prueba le dice y se guarda lo que le llegó.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'xen-modelos-'));
const base = JSON.parse(readFileSync(new URL('../../xencrm.config.example.json', import.meta.url), 'utf8')) as Record<string, unknown>;
writeFileSync(join(dir, 'xencrm.config.json'), JSON.stringify({ ...base, timezone: 'America/Bogota' }));
const ENV = join(dir, '.env');
const LLAVE_CLAUDE = 'sk-ant-api03-de-mentira-para-la-prueba-0000000000000000wxyz';
writeFileSync(ENV, `ANTHROPIC_API_KEY=${LLAVE_CLAUDE}\n`);
Object.assign(process.env, {
  XENCRM_CONFIG: join(dir, 'xencrm.config.json'),
  XENCRM_ENV_FILE: ENV,
  DB_PATH: join(dir, 'data', 'prueba.db'),
  ADMIN_TOKEN: 'token-del-tablero-de-prueba-0123456789',
  WHATSAPP_ENABLED: 'false',
  LLM_ENGINE: 'router',
  LIGHT_ENGINE: 'openai',
  HEAVY_ENGINE: 'openai',
  GATE_ENGINE: 'openai',
  ANALYSIS_ENGINE: 'openai',
  OPENAI_API_KEY: '',
  OPENAI_BASE_URL: 'http://openai.prueba/v1',
  OPENAI_MODEL: 'gpt-5.4-mini',
  ANTHROPIC_BASE_URL: 'http://claude.prueba/v1',
  OLLAMA_URL: 'http://ollama.prueba',
  CHAT_MODEL: 'gemma-de-prueba',
  LMSTUDIO_URL: 'http://lmstudio.prueba:1234/v1',
  LMSTUDIO_MODEL: 'qwen-local',
  COMPAT_URL: 'http://compat.prueba/v1',
  COMPAT_API_KEY: 'llave-del-compatible-de-prueba-9999',
  COMPAT_MODEL: 'llama-de-la-nube',
});

// La red de mentira: lo que se pidió, y lo que contesta cada dirección.
const pedidos: { url: string; headers: Record<string, string>; body: Record<string, unknown> | null }[] = [];
globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
  const url = String(input);
  const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
  pedidos.push({ url, headers, body: init?.body ? JSON.parse(String(init.body)) : null });
  const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json' } });
  if (url.endsWith('/chat/completions')) return json({ choices: [{ message: { content: 'hola desde ' + url.split('/')[2] } }], usage: { prompt_tokens: 10, completion_tokens: 3 } });
  if (url === 'http://lmstudio.prueba:1234/v1/models' || url === 'http://lm-nuevo.prueba/v1/models') return json({ data: [{ id: 'qwen-local' }, { id: 'otro-local' }] });
  if (url === 'http://compat.prueba/v1/models') return headers.authorization === 'Bearer llave-del-compatible-de-prueba-9999' ? json({ data: [{ id: 'llama-de-la-nube' }] }) : json({ error: 'no' }, 401);
  if (url.startsWith('http://claude.prueba/v1/models')) return headers['x-api-key'] === LLAVE_CLAUDE ? json({ data: [{ id: 'claude-haiku-5-5' }, { id: 'claude-sonnet-5-5' }] }) : json({ error: 'no' }, 401);
  if (url === 'http://openai.prueba/v1/models') return headers.authorization === 'Bearer sk-buena-de-prueba-000000000000' ? json({ data: [{ id: 'gpt-5.4-mini' }] }) : json({ error: 'no' }, 401);
  throw new TypeError('fetch failed');
}) as typeof fetch;

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};
const falla = async (f: () => Promise<unknown> | unknown): Promise<string> => {
  try {
    await f();
    return '';
  } catch (err) {
    return (err as Error).message;
  }
};
const archivo = () => readFileSync(ENV, 'utf8');

const prov = await import('../proveedores.js');
const engines = await import('../llm/engines.js');
const { openaiChat } = await import('../llm/openai.js');
const { costUsd } = await import('../llm/usage.js');
const { guardarMotores } = await import('../motores.js');
const { frenoDelCandado } = await import('../channels/candado.js');
const { Hono } = await import('hono');
const { mountAdmin } = await import('../channels/admin.js');

console.log('— Los seis proveedores, y ninguna llave');
const todos = prov.proveedores();
check('OpenAI, Anthropic, Apple, Ollama, LM Studio y la compatible, en ese orden', todos.map((p) => p.id).join(',') === 'openai,anthropic,apple,ollama,lmstudio,compat', todos.map((p) => p.id).join(','));
const claude = todos.find((p) => p.id === 'anthropic')!;
check('Claude con la llave puesta se ve puesta, con su pista', Boolean(claude.llave?.puesta) && claude.llave!.pista.endsWith('wxyz') && claude.llave!.pista.length < 16, JSON.stringify(claude.llave));
check('🪤 y la llave no sale entera por ningún lado (tampoco la del compatible)', !JSON.stringify(todos).includes(LLAVE_CLAUDE) && !JSON.stringify(todos).includes('llave-del-compatible-de-prueba-9999'));
check('Claude se dice respaldo', claude.respaldo && !todos.find((p) => p.id === 'openai')!.respaldo);
check('OpenAI sin llave: «Sin llave», no «No disponible»', todos.find((p) => p.id === 'openai')!.estado === 'sin_llave');
check('los de la máquina (Apple, Ollama, LM Studio) no cobran; la compatible cuenta como de pago', todos.filter((p) => p.deMaquina).map((p) => p.id).join(',') === 'apple,ollama,lmstudio' && todos.find((p) => p.id === 'compat')!.dePago);
check('cada uno dice qué roles hace hoy (OpenAI, los cuatro)', todos.find((p) => p.id === 'openai')!.enUso.length === 4);

console.log('— Una llave se comprueba antes de guardarla');
let comprobadas: string[] = [];
const comprobarBien: import('../proveedores.js').ComprobarLlave = async (id) => { comprobadas.push(id); };
const comprobarMal: import('../proveedores.js').ComprobarLlave = async () => { throw new Error('OpenAI dice que esa llave no vale.'); };
check('una de OpenAI empieza por sk-', (await falla(() => prov.guardarProveedor('openai', { llave: 'abc' }, comprobarBien))).includes('sk-'));
check('una de Claude empieza por sk-ant-', (await falla(() => prov.guardarProveedor('anthropic', { llave: 'sk-otra-cosa-000000' }, comprobarBien))).includes('sk-ant-'));
check('con espacios o comillas no se guarda (partiría la línea del .env)', (await falla(() => prov.guardarProveedor('openai', { llave: 'sk-con espacio' }, comprobarBien))).includes('espacios'));
const antes = archivo();
check('🪤 si el proveedor dice que no vale, NO se escribe nada', (await falla(() => prov.guardarProveedor('openai', { llave: 'sk-mala-de-prueba-0000000000' }, comprobarMal))).includes('no vale') && archivo() === antes);
comprobadas = [];
const puesta = await prov.guardarProveedor('openai', { llave: 'sk-buena-de-prueba-000000000000' }, comprobarBien);
check('si vale, se comprueba primero y se guarda en el .env de este cliente', comprobadas.join() === 'openai' && archivo().includes('OPENAI_API_KEY=sk-buena-de-prueba-000000000000'));
check('🪤 y lo que vuelve es la pista, nunca la llave', !JSON.stringify(puesta).includes('sk-buena-de-prueba-000000000000') && puesta.proveedor.llave!.pista.endsWith('0000'), JSON.stringify(puesta.proveedor.llave));
check('lo guardado espera al reinicio, y lo dice', puesta.hayQueReiniciar && puesta.proveedor.pendiente && puesta.proveedor.estado === 'sin_probar' && /reiniciar/.test(puesta.proveedor.porque ?? ''));
writeFileSync(ENV, archivo() + 'OPENAI_API_KEY_APAGADA=sk-aparcada-0000000000000\n');
prov.quitarLlave('openai');
check('quitar la de OpenAI borra la línea (no la deja vacía) y también la aparcada', !/OPENAI_API_KEY=/.test(archivo()) && !/APAGADA/.test(archivo()), archivo());

console.log('— Direcciones y modelos');
check('una dirección empieza por http o https', (await falla(() => prov.guardarProveedor('ollama', { url: 'file:///etc/passwd' }))).includes('http'));
check('sin usuario ni clave adentro', (await falla(() => prov.guardarProveedor('compat', { url: 'https://yo:secreto@api.prueba/v1' }))).includes('usuario'));
check('sin espacios', (await falla(() => prov.guardarProveedor('lmstudio', { url: 'http://mal escrito/v1' }))).length > 0);
const lm = await prov.guardarProveedor('lmstudio', { url: 'http://lm-nuevo.prueba/v1/' });
check('se guarda sin la barra final, y no hace falta que conteste para guardarla', lm.proveedor.url!.valor === 'http://lm-nuevo.prueba/v1' && archivo().includes('LMSTUDIO_URL=http://lm-nuevo.prueba/v1'));
check('el modelo de Ollama no se cambia aquí (es el de toda la máquina)', (await falla(() => prov.guardarProveedor('ollama', { modelo: 'otro' }))).length > 0);
check('el nombre del compatible va sin espacios', (await falla(() => prov.guardarProveedor('compat', { nombre: 'Mi API rara' }))).length > 0);
await prov.guardarProveedor('openai', { url: '' });
check('🪤 vaciar la dirección de OpenAI la quita, y vuelve a la de siempre', !/OPENAI_BASE_URL=/.test(archivo()));

console.log('— Probar no gasta y prueba lo guardado');
pedidos.length = 0;
const pruebaLm = await prov.probarProveedor('lmstudio');
check('LM Studio se prueba en SU dirección, la guardada (no en la de OpenAI)', pedidos.length === 1 && pedidos[0]!.url === 'http://lm-nuevo.prueba/v1/models', pedidos.map((p) => p.url).join(' '));
check('y sin la llave de nadie', !pedidos[0]?.headers.authorization);
check('🪤 solo pregunta qué modelos hay: no genera nada', !pedidos.some((p) => p.url.endsWith('/chat/completions')));
check('contesta y trae los modelos para elegir', pruebaLm.ok && pruebaLm.modelos.join() === 'qwen-local,otro-local', JSON.stringify(pruebaLm));
await prov.guardarProveedor('lmstudio', { modelo: 'no-esta' });
const sinEse = await prov.probarProveedor('lmstudio');
check('un modelo que no está se dice', !sinEse.ok && sinEse.contesta && /no-esta/.test(sinEse.porque ?? ''), JSON.stringify(sinEse));
await prov.guardarProveedor('lmstudio', { modelo: 'qwen-local' });
const compatBien = await prov.probarProveedor('compat');
check('el compatible se prueba con su llave', compatBien.ok && pedidos.some((p) => p.url === 'http://compat.prueba/v1/models' && p.headers.authorization === 'Bearer llave-del-compatible-de-prueba-9999'));
const sinLlave = await prov.probarProveedor('openai');
check('OpenAI sin llave no sale a la red: dice que falta', !sinLlave.ok && sinLlave.porque === 'Falta la llave.');
const nadie = await prov.probarProveedor('ollama');
check('Ollama apagado: lo dice con su dirección', !nadie.ok && !nadie.contesta && /ollama\.prueba/.test(nadie.porque ?? ''), JSON.stringify(nadie));
const red = { compatible: async () => ({ ok: true, modelos: [] }), ollama: async () => ({ ok: true, modelos: [] }), anthropic: async () => ({ ok: true, status: 200, modelos: [] }), apple: async () => ({ ok: false, reason: 'falta ./sidecar/bin/xencrm-afm (pnpm build:sidecar)' }) };
const manzana = await prov.probarProveedor('apple', red);
check('Apple dice por qué no, sin inventarse que sí, y en palabras (no «falta ./sidecar…»)', !manzana.ok && /solo corre en un Mac/.test(manzana.porque ?? '') && !/^falta/.test(manzana.porque ?? ''), manzana.porque);
const manzana2 = await prov.probarProveedor('apple', { ...red, apple: async () => ({ ok: false, reason: 'Apple Intelligence apagado' }) });
check('y si es otro motivo, lo dice tal cual', /Apple Intelligence apagado/.test(manzana2.porque ?? ''), manzana2.porque);

console.log('— LM Studio y el compatible hablan como OpenAI, cada uno con lo suyo');
pedidos.length = 0;
const r1 = await openaiChat({ messages: [{ role: 'user', content: 'hola' }], model: 'gpt-5.4', maxTokens: 50, usage: { task: 'light', userId: 'web:x' } }, 'lmstudio');
const p1 = pedidos[0]!;
check('va a la dirección de LM Studio (la que corre)', p1.url === 'http://lmstudio.prueba:1234/v1/chat/completions' && r1.includes('lmstudio.prueba'), p1.url);
check('con SU modelo, no el del rol de OpenAI', p1.body?.model === 'qwen-local', String(p1.body?.model));
check('🪤 sin llave y sin lo que solo entiende OpenAI (caché con clave, esfuerzo, max_completion_tokens)', !p1.headers.authorization && !('prompt_cache_key' in p1.body!) && !('max_completion_tokens' in p1.body!) && p1.body!.max_tokens === 50, JSON.stringify(p1.body));
pedidos.length = 0;
await openaiChat({ messages: [{ role: 'user', content: 'hola' }] }, 'compat');
check('el compatible lleva su llave y su modelo', pedidos[0]?.url === 'http://compat.prueba/v1/chat/completions' && pedidos[0]?.headers.authorization === 'Bearer llave-del-compatible-de-prueba-9999' && pedidos[0]?.body?.model === 'llama-de-la-nube');
check('LM Studio no cuesta; lo del compatible sale «sin precio», no en cero', costUsd('lmstudio', 'qwen-local', 1000, 0, 100) === 0 && costUsd('compat', 'llama-de-la-nube', 1000, 0, 100) === null);
pedidos.length = 0;
await engines.generate('lmstudio', { sessionId: 'web:x', persona: 'Eres el asistente.', context: '', userText: 'hola', history: [], role: 'light' });
check('generate con lmstudio pasa por su dirección', pedidos[0]?.url === 'http://lmstudio.prueba:1234/v1/chat/completions');

console.log('— Qué hace cada rol');
check('se pueden poner en un rol: los de la máquina, OpenAI, el compatible y Claude', ['ollama', 'apple', 'lmstudio', 'openai', 'compat', 'anthropic'].every((e) => engines.ASIGNABLES.includes(e as never)));
check('🪤 y Claude sigue al final de la cadena: es el respaldo de los demás roles', !engines.ENGINES.includes('anthropic') && engines.RESPALDOS.includes('anthropic'));
check('🪤 en la cadena, LM Studio (sin costo) va antes que los de pago', engines.ENGINES.indexOf('lmstudio') < engines.ENGINES.indexOf('openai') && engines.ENGINES.indexOf('openai') < engines.ENGINES.indexOf('compat'));
check('un motor sin configurar no entra en la cadena de nadie', !engines.fallbackOrder('openai').includes('compat'), JSON.stringify(engines.fallbackOrder('openai')));
const sondeo = async (m: string) => (m === 'lmstudio' || m === 'anthropic' ? { available: true } : { available: false, reason: 'no contesta' });
const g = await guardarMotores({ roles: [{ rol: 'light', motor: 'lmstudio' }, { rol: 'gate', motor: 'anthropic', modeloClaude: 'claude-sonnet-5-5' }] }, sondeo as never);
check('un rol se guarda en LM Studio, y otro en Claude con su modelo', archivo().includes('LIGHT_ENGINE=lmstudio') && archivo().includes('GATE_ENGINE=anthropic') && archivo().includes('ANTHROPIC_MODEL_GATE=claude-sonnet-5-5') && g.hayQueReiniciar);
const noVa = await falla(() => guardarMotores({ roles: [{ rol: 'heavy', motor: 'compat' }] }, sondeo as never));
check('uno que no contesta no se guarda, y se dice con su nombre de persona', /la API compatible no responde/.test(noVa), noVa);
check('lo que se lee dice qué se puede elegir y los modelos de Claude', g.motores.asignables.includes('anthropic') && typeof g.motores.roles[0]!.modeloClaude === 'string');

console.log('— Solo quien administra');
for (const [ruta, metodo] of [['motores/proveedores', 'GET'], ['motores/proveedores/openai', 'PUT'], ['motores/proveedores/openai/llave', 'DELETE'], ['motores/proveedores/lmstudio/probar', 'POST']] as [string, string][]) {
  check(`el candado cierra ${metodo} ${ruta} a un asesor`, frenoDelCandado(ruta, metodo, 'asesor', 'facil') !== null);
  check(`y no a quien manda (${metodo} ${ruta})`, frenoDelCandado(ruta, metodo, 'super', 'facil') === null);
}
const consola = readFileSync(new URL('../consola.ts', import.meta.url), 'utf8');
const soloSuper = new RegExp(/const SOLO_SUPER = \/(.+)\/;/.exec(consola)?.[1] ?? '^$');
check('🪤 y la consola no deja pasar a quien no es super-admin, ni para leer (todo va bajo motores/)', ['motores/proveedores', 'motores/proveedores/anthropic', 'motores/proveedores/compat/probar'].every((r) => soloSuper.test(r)), String(soloSuper));
const app = new Hono();
mountAdmin(app as never);
const T = { 'x-admin-token': process.env.ADMIN_TOKEN!, 'content-type': 'application/json' };
check('sin el token del tablero, nada', (await app.request('/admin/api/motores/proveedores')).status === 401);
const leido = await (await app.request('/admin/api/motores/proveedores', { headers: T })).text();
check('con el token, los seis y los roles con su nombre de persona', /"id":"compat"/.test(leido) && /"nombre":"Clasificar"/.test(leido) && /"cuidado":/.test(leido));
check('🪤 y en lo que sale por la ruta no va ninguna llave', !leido.includes(LLAVE_CLAUDE) && !leido.includes('llave-del-compatible-de-prueba-9999'));
const guardo = await (await app.request('/admin/api/motores/proveedores/compat', { method: 'PUT', headers: T, body: JSON.stringify({ llave: 'llave-del-compatible-de-prueba-9999' }) })).text();
check('guardar por la ruta comprueba la llave contra su API y no la devuelve', /"ok":true/.test(guardo) && !guardo.includes('llave-del-compatible-de-prueba-9999'), guardo.slice(0, 200));
const mala = await app.request('/admin/api/motores/proveedores/compat', { method: 'PUT', headers: T, body: JSON.stringify({ llave: 'otra-que-no-vale-0000000' }) });
check('una que no vale: 400 con el motivo', mala.status === 400 && /no vale/.test(await mala.text()));
check('un proveedor que no existe: 404', (await app.request('/admin/api/motores/proveedores/gemini', { headers: T, method: 'PUT', body: '{}' })).status === 404);

console.log('— La pantalla');
const js = readFileSync(new URL('../../public/admin.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../../public/admin.html', import.meta.url), 'utf8');
check('está en Configuración, solo para quien manda, y el candado la cierra', /\{ view: 'modelos', ic: 'chispa', lbl: 'Modelos de IA', soloSuper: true \}/.test(js) && /var VISTAS_DE_QUIEN_ADMINISTRA = \{[^}]*\bmodelos: 1/.test(js));
check('la vista vive en su ancla, con el aviso del reinicio fijo arriba', /XEN · Modelos de IA: la vista nueva[\s\S]*id="view-modelos"[\s\S]*se aplica al reiniciar[\s\S]*\(fin de XEN · Modelos de IA\)/.test(html));
check('🪤 la llave se pega en un campo de contraseña que el navegador no autocompleta', /type="password" name="llave"[^>]*autocomplete="new-password"/.test(js));
check('🪤 y se vacía en cuanto se guardó (si falla, se queda para corregirla)', /var llave = form\.querySelector\('\[name=llave\]'\); if \(llave\) llave\.value = '';/.test(js));
check('quitar una llave pide confirmarlo sin ventanas del navegador', /data-acc="quitar-si">Sí, quitar la llave/.test(js) && !/confirm\(/.test(js.slice(js.indexOf('XEN · Modelos de IA: lo nuevo'), js.indexOf('(fin de XEN · Modelos de IA)'))));
check('contesta pero le falta algo: ámbar, no rojo', /r\.contesta \? 'xm-medio' : 'xm-mal'/.test(js));
check('🪤 [hidden] gana en la pantalla (el display de .btn le ganaba, y «Reiniciar ahora» salía sin nada pendiente)', /#view-modelos \[hidden\]\{display:none!important\}/.test(html));
check('el estado va con palabra, no solo con color', /XM_ESTADO = \{[\s\S]*'Conectado'[\s\S]*'Sin llave'[\s\S]*'No disponible'[\s\S]*'Sin probar'/.test(js));

console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
