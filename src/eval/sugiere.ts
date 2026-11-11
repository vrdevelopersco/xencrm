// Aiva acompaña cuando la lleva una persona (sin modelo y sin red): pnpm test:sugiere
//
// Lo que se prueba: que mientras una persona lleva la conversación, aiva deje lista la respuesta a lo que SABE y
// nada más. Que no le escriba al cliente ni una palabra —tampoco el «dame un segundito»—, que no le quite la
// conversación a quien la tiene, que no toque una cita a medias, que lo que no sabe no se convierta en un «Por
// verificar» ni en una campana, y que con el ajuste apagado todo siga como antes: callada del todo.
//
// 🪤 Todo en una carpeta temporal con un negocio de ejemplo. OpenAI y Ollama son de mentira y cada llamada se
// cuenta: lo que cuesta este modo es justamente lo que hay que vigilar.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'aiva-sugiere-'));
const base = JSON.parse(readFileSync(new URL('../../aiva.config.example.json', import.meta.url), 'utf8')) as Record<string, unknown>;
writeFileSync(
  join(dir, 'aiva.config.json'),
  JSON.stringify({ ...base, timezone: 'America/Bogota', appointments: { enabled: true, service: 'visita', location: 'la tienda', days: [0, 1, 2, 3, 4, 5, 6], hours: [['08:00', '20:00']], minLeadHours: 0 } }),
);
writeFileSync(join(dir, '.env'), '');
Object.assign(process.env, {
  AIVA_CONFIG: join(dir, 'aiva.config.json'),
  AIVA_ENV_FILE: join(dir, '.env'),
  DB_PATH: join(dir, 'data', 'prueba.db'),
  ADMIN_TOKEN: 'token-del-tablero-de-prueba-0123456789',
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
});

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};

// ---------- OpenAI y Ollama de mentira ----------
// Lo que «contesta el modelo» depende de lo último que escribió el cliente, como en una conversación de verdad.
const RESPUESTAS: [RegExp, string][] = [
  [/env[ií]an/i, 'Sí, hacemos envíos a toda Colombia, también a Medellín 🙂'],
  [/parqueadero/i, 'Sí, tenemos parqueadero gratis para clientes.'],
  [/ba[ñn]o/i, 'Deja te verifico eso con el equipo y te confirmo por aquí 🙂'],
  [/recomiendas/i, 'Para poca luz te va muy bien un potus: aguanta sombra y se cuida fácil.'],
];
let aGenerar = 0;
let aClasificar = 0;
globalThis.fetch = (async (url: string | URL | Request, opciones?: RequestInit) => {
  const u = String(url);
  const cuerpo = JSON.parse(String(opciones?.body ?? '{}')) as {
    response_format?: { json_schema?: { schema?: { properties?: Record<string, unknown> } } };
    input?: string | string[];
    messages?: { role: string; content: unknown }[];
  };
  if (u.startsWith('http://openai.prueba/v1/models/')) return Response.json({ id: 'ok' });
  if (u === 'http://openai.prueba/v1/chat/completions') {
    const props = cuerpo.response_format?.json_schema?.schema?.properties;
    const ultimo = String([...(cuerpo.messages ?? [])].reverse().find((m) => m.role === 'user')?.content ?? '');
    let content: string;
    if (props && 'intent' in props) {
      aClasificar++;
      content = JSON.stringify({ intent: /hablar con alguien/i.test(ultimo) ? 'humano' : /recomiendas/i.test(ultimo) ? 'compra' : 'info_tienda', consulta_busqueda: '' });
    } else if (props) {
      content = JSON.stringify({}); // el análisis: no es lo que se prueba aquí
    } else {
      aGenerar++;
      content = RESPUESTAS.find(([re]) => re.test(ultimo))?.[1] ?? 'Claro, te cuento.';
    }
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 20 } });
  }
  if (u === 'http://ollama.prueba/api/tags') throw new Error('ECONNREFUSED');
  if (u === 'http://ollama.prueba/api/embed') {
    const textos = Array.isArray(cuerpo.input) ? cuerpo.input : [String(cuerpo.input ?? '')];
    return Response.json({ embeddings: textos.map(() => [1, 0, 0]) });
  }
  throw new Error(`la prueba no sale a la red: ${u}`);
}) as typeof fetch;

const engines = await import('../llm/engines.js');
const { handleMessage } = await import('../agent/agent.js');
const { touchUser } = await import('../agent/memory.js');
const { getContact, setHumanMode, updateContact } = await import('../crm/contacts.js');
const { propuestaDe, sugiereConPersona, ponerSugiereConPersona } = await import('../crm/propuestas.js');
const { sendToContact, registerSender } = await import('../crm/outbox.js');
const { listVerifications } = await import('../crm/verifications.js');
const { startNotifications, listNotifications } = await import('../crm/notifications.js');
const { onEvent } = await import('../crm/events.js');
const { getDb } = await import('../rag/store.js');
const { Hono } = await import('hono');
const { mountAdmin } = await import('../channels/admin.js');
startNotifications();
// El chat del sitio, de mentira: lo que salga hacia el cliente se cuenta aquí. Sin emisor, el «dame un segundito»
// ni se intentaría, y la prueba de que no sale pasaría sin probar nada.
const alCliente: { userId: string; texto: string }[] = [];
registerSender('web', async (userId, texto) => {
  alCliente.push({ userId, texto });
});
await engines.probeEngines(); // OpenAI contesta; Ollama no

const eventos: { type: string; userId: string; payload: Record<string, unknown> }[] = [];
onEvent((ev) => eventos.push({ type: ev.type, userId: ev.userId, payload: ev.payload as Record<string, unknown> }));

const app = new Hono();
mountAdmin(app as never);
const T = { 'x-admin-token': process.env.ADMIN_TOKEN!, 'content-type': 'application/json' };

/** Una conversación que ya lleva Laura. */
const conLaura = (id: string) => {
  touchUser(id, 'web', null);
  setHumanMode(id, true, 'Laura');
};
const loDelAsistente = (id: string) =>
  (getDb().prepare("SELECT COUNT(*) n FROM messages WHERE user_id = ? AND role = 'assistant'").get(id) as { n: number }).n;
const ultimoDelCliente = (id: string) =>
  getDb().prepare("SELECT content, intent FROM messages WHERE user_id = ? AND role = 'user' ORDER BY id DESC LIMIT 1").get(id) as { content: string; intent: string } | undefined;
const cuantas = (id: string) => (getDb().prepare('SELECT COUNT(*) n FROM propuestas WHERE user_id = ?').get(id) as { n: number }).n;
const llamadas = () => ({ gen: aGenerar, gate: aClasificar });

// =====================================================================================================
console.log('— De fábrica');
check('viene encendido', sugiereConPersona() === true);

// =====================================================================================================
console.log('— Pregunta algo que sabe');
{
  const id = 'web:sabe-1';
  conLaura(id);
  const antes = llamadas();
  const r = await handleMessage({ userId: id, channel: 'web', text: '¿envían a Medellín?' });
  const p = propuestaDe(id);
  check('no le contesta al cliente', r.silent === true && r.text === '', JSON.stringify(r));
  check('ni una palabra en la conversación', loDelAsistente(id) === 0, String(loDelAsistente(id)));
  check('deja la respuesta lista', Boolean(p) && /envíos a toda Colombia/.test(p!.texto), JSON.stringify(p));
  check('marcada como de una conversación que lleva una persona', p?.conPersona === true, JSON.stringify(p));
  check('y fresca: contesta a lo último que dijo', p?.vieja === false, JSON.stringify(p));
  check('Laura sigue a cargo', getContact(id)?.humanMode === true && getContact(id)?.humanBy === 'Laura', JSON.stringify({ h: getContact(id)?.humanMode, by: getContact(id)?.humanBy }));
  check('el mensaje del cliente entra como siempre que la lleva alguien', ultimoDelCliente(id)?.intent === 'humano', JSON.stringify(ultimoDelCliente(id)));
  check('una sola redacción', llamadas().gen - antes.gen === 1, JSON.stringify({ antes, ahora: llamadas() }));
  check('🪤 no suena la campana: Laura ya está ahí', !listNotifications().some((n) => n.kind === 'propuesta' && n.userId === id), JSON.stringify(listNotifications().slice(0, 3)));
  check('pero el tablero sí se entera, para pintarla', eventos.some((e) => e.type === 'propuesta' && e.userId === id && (e.payload.propuesta as { conPersona?: boolean })?.conPersona === true));

  console.log('— Laura la manda tal cual');
  const r2 = await app.request(`/admin/api/propuestas/${p!.id}/enviar`, { method: 'POST', headers: T, body: JSON.stringify({ by: 'Laura' }) });
  check('sale', r2.status === 200, String(r2.status));
  const dicho = getDb().prepare("SELECT content, author FROM messages WHERE user_id = ? AND role = 'assistant' ORDER BY id DESC LIMIT 1").get(id) as { content: string; author: string } | undefined;
  check('queda escrita como de aiva (la redactó ella; de ella no se aprende)', dicho?.author === 'bot' && /envíos/.test(dicho.content), JSON.stringify(dicho));
  check('🪤 y la conversación la sigue llevando Laura', getContact(id)?.humanMode === true && getContact(id)?.humanBy === 'Laura', JSON.stringify({ h: getContact(id)?.humanMode, by: getContact(id)?.humanBy }));
  check('ya no queda pendiente', propuestaDe(id) === null);
}

// =====================================================================================================
console.log('— Lo que no sabe, no se lo deja');
{
  const id = 'web:no-sabe-1';
  conLaura(id);
  const antes = llamadas();
  const r = await handleMessage({ userId: id, channel: 'web', text: '¿tienen baño para clientes?' });
  check('nada que mandar cuando sería «déjame verificar»', propuestaDe(id) === null && cuantas(id) === 0, JSON.stringify(propuestaDe(id)));
  check('🪤 no abre un «Por verificar»: Laura ya está leyendo', !listVerifications('pendiente').some((v) => v.userId === id), JSON.stringify(listVerifications('pendiente')));
  check('ni avisa que no supo', !listNotifications().some((n) => n.userId === id && (n.kind === 'verify' || n.kind === 'fail' || n.kind === 'propuesta')), JSON.stringify(listNotifications().filter((n) => n.userId === id)));
  check('y el turno dice por qué se calló', /acompaña · no lo sabe/.test(r.route), r.route);
  check('ni escribe', r.silent === true && loDelAsistente(id) === 0);
  check('una sola redacción', llamadas().gen - antes.gen === 1, JSON.stringify({ antes, ahora: llamadas() }));
}
{
  const id = 'web:no-sabe-2';
  conLaura(id);
  const antes = llamadas();
  const r = await handleMessage({ userId: id, channel: 'web', text: '¿tienen parqueadero?' });
  check('una afirmación sin respaldo tampoco se deja', cuantas(id) === 0 && /sin respaldo/.test(r.route), JSON.stringify({ p: propuestaDe(id), ruta: r.route }));
  check('🪤 y no se paga otra redacción para rehacerla', llamadas().gen - antes.gen === 1, JSON.stringify({ antes, ahora: llamadas() }));
  check('ni queda por verificar', !listVerifications('pendiente').some((v) => v.userId === id));
}

// =====================================================================================================
console.log('— Lo que no es del negocio, ni se redacta');
{
  const id = 'web:saludo-1';
  conLaura(id);
  const antes = llamadas();
  await handleMessage({ userId: id, channel: 'web', text: 'hola' });
  check('un saludo no cuesta nada', llamadas().gen === antes.gen && llamadas().gate === antes.gate, JSON.stringify({ antes, ahora: llamadas() }));
  check('ni deja nada', cuantas(id) === 0);
  await handleMessage({ userId: id, channel: 'web', text: 'quiero hablar con una persona' });
  check('pedir una persona tampoco, y no se toca quién la lleva', cuantas(id) === 0 && getContact(id)?.humanBy === 'Laura', JSON.stringify({ n: cuantas(id), by: getContact(id)?.humanBy }));
  await handleMessage({ userId: id, channel: 'web', text: 'quiero agendar una visita' });
  check('ni una cita: esa la agenda la persona', cuantas(id) === 0 && !getContact(id)?.data.booking, JSON.stringify(getContact(id)?.data));
}

// =====================================================================================================
console.log('— Lo que se tarda');
{
  const id = 'web:tarda-1';
  conLaura(id);
  const r = await handleMessage({ userId: id, channel: 'web', text: '¿qué planta me recomiendas para una oficina con poca luz?' });
  check('🪤 sin «dame un segundito»: el cliente está hablando con Laura', loDelAsistente(id) === 0 && !alCliente.some((m) => m.userId === id), JSON.stringify(alCliente));
  check('y la recomendación queda lista', /potus/.test(propuestaDe(id)?.texto ?? ''), JSON.stringify({ r, p: propuestaDe(id) }));
}

// =====================================================================================================
console.log('— Una cita a medias no se toca');
{
  const id = 'web:cita-1';
  conLaura(id);
  const enCurso = { paso: 'dia', servicio: 'visita' };
  updateContact(id, { data: { ...(getContact(id)?.data ?? {}), booking: enCurso } }, { silent: true });
  const antes = llamadas();
  await handleMessage({ userId: id, channel: 'web', text: '¿envían a Medellín?' });
  check('la cita sigue donde estaba', JSON.stringify(getContact(id)?.data.booking) === JSON.stringify(enCurso), JSON.stringify(getContact(id)?.data.booking));
  check('sin propuesta y sin gastar', cuantas(id) === 0 && llamadas().gen === antes.gen && llamadas().gate === antes.gate, JSON.stringify({ n: cuantas(id), antes, ahora: llamadas() }));
}

// =====================================================================================================
console.log('— Las propuestas se quedan atrás');
{
  const id = 'web:vieja-1';
  conLaura(id);
  await handleMessage({ userId: id, channel: 'web', text: '¿envían a Medellín?' });
  check('hay una', propuestaDe(id)?.vieja === false);
  await handleMessage({ userId: id, channel: 'web', text: 'hola' });
  check('el cliente escribió otra vez: se marca como vieja', propuestaDe(id)?.vieja === true, JSON.stringify(propuestaDe(id)));
  await sendToContact(id, 'Hola, sí te llega en dos días.', 'human', { by: 'Laura' });
  check('🪤 Laura contestó con sus palabras: la de aiva se aparta', propuestaDe(id) === null, JSON.stringify(propuestaDe(id)));
}

// =====================================================================================================
console.log('— Apagado');
{
  const off = await app.request('/admin/api/agent/sugiere', { method: 'PUT', headers: T, body: JSON.stringify({ on: false }) });
  check('se apaga desde el tablero', off.status === 200 && sugiereConPersona() === false, String(off.status));
  const ver = (await (await app.request('/admin/api/agent', { headers: T })).json()) as { sugiereConPersona?: boolean };
  check('y el tablero lo lee', ver.sugiereConPersona === false, JSON.stringify(ver.sugiereConPersona));
  check('sin «on» no se toca', (await app.request('/admin/api/agent/sugiere', { method: 'PUT', headers: T, body: '{"on":"sí"}' })).status === 400);
  check('sin token, nada', (await app.request('/admin/api/agent/sugiere', { method: 'PUT', body: JSON.stringify({ on: true }) })).status === 401);
  const id = 'web:apagado-1';
  conLaura(id);
  const antes = llamadas();
  const r = await handleMessage({ userId: id, channel: 'web', text: '¿envían a Medellín?' });
  check('callada del todo, como antes', r.silent === true && r.route === 'modo humano' && cuantas(id) === 0, JSON.stringify(r));
  check('y sin gastar ni una llamada', llamadas().gen === antes.gen && llamadas().gate === antes.gate, JSON.stringify({ antes, ahora: llamadas() }));
  check('el mensaje entra igual', ultimoDelCliente(id)?.intent === 'humano' && /Medellín/.test(ultimoDelCliente(id)?.content ?? ''));
  ponerSugiereConPersona(true);
}

// =====================================================================================================
console.log('— Sin una persona, nada cambia');
{
  const id = 'web:sola-1';
  touchUser(id, 'web', null);
  const r = await handleMessage({ userId: id, channel: 'web', text: '¿envían a Medellín?' });
  check('aiva contesta sola, como siempre', !r.silent && /envíos/.test(r.text) && cuantas(id) === 0, JSON.stringify(r));
  const t = 'web:sola-2';
  touchUser(t, 'web', null);
  await handleMessage({ userId: t, channel: 'web', text: '¿qué planta me recomiendas para una oficina con poca luz?' });
  check('y sin nadie, lo que tarda sí lleva su «dame un segundito» (la prueba de arriba mira algo real)', alCliente.some((m) => m.userId === t), JSON.stringify(alCliente));
}

// =====================================================================================================
console.log('— En el tablero');
{
  const js = readFileSync(new URL('../../public/admin.js', import.meta.url), 'utf8');
  check('la propuesta dice que es una ayuda, no «la respuesta»', /p\.conPersona \? \(state\.agentName \|\| 'Xen'\) \+ ' puede contestar esto'/.test(js));
  check('🪤 y no suena cuando llega a una conversación que lleva alguien', /if \(p && p\.conPersona\) return;/.test(js));
  check('el interruptor está en Agente, con su explicación', /Cuando la llevas tú<\/b>/.test(js) && /deja lista la respuesta a lo que sabe; tú decides si la mandas/.test(js) && /api\('\/agent\/sugiere'/.test(js));
}

console.log(fail ? `\n${fail} fallaron` : '\ntodo ok');
process.exit(fail ? 1 : 0);
