// Turnos guardados y versión (sin modelo y sin red): pnpm test:turnos
//
// Lo que se prueba es la pregunta que llega después de algo raro: «¿por qué le contestó ESO a este cliente?». Para
// cada respuesta tiene que quedar qué entendió, por dónde fue, con qué modelo, qué guardas saltaron, qué costó y con
// qué versión, y todo unido a sus llamadas y a sus mensajes por el mismo identificador. Lo que no es del turno —el
// análisis que corre después, lo que escribe el equipo— no puede quedar cargado a él.
//
// 🪤 Todo en una carpeta temporal con un negocio de ejemplo y un OpenAI de mentira.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'aiva-turnos-'));
const base = JSON.parse(readFileSync(new URL('../../aiva.config.example.json', import.meta.url), 'utf8')) as Record<string, unknown>;
// El análisis, casi al instante: así se puede comprobar que el que programa un turno no queda cargado a él.
writeFileSync(join(dir, 'aiva.config.json'), JSON.stringify({ ...base, crm: { analysisQuietSeconds: 0.05, analysisMaxWaitSeconds: 1 } }));
writeFileSync(join(dir, '.env'), '');
Object.assign(process.env, {
  AIVA_CONFIG: join(dir, 'aiva.config.json'),
  AIVA_ENV_FILE: join(dir, '.env'),
  DB_PATH: join(dir, 'data', 'aiva.db'),
  WHATSAPP_ENABLED: 'false',
  LLM_ENGINE: 'openai',
  OPENAI_API_KEY: 'clave-de-prueba',
  OPENAI_BASE_URL: 'http://openai.prueba/v1',
  EMBED_ENGINE: 'ollama',
  OLLAMA_URL: 'http://ollama.prueba',
  ADMIN_TOKEN: 'token-de-prueba-0123456789',
  AIVA_VERSION: '',
});
for (const rol of ['', '_LIGHT', '_HEAVY', '_GATE', '_ANALYSIS']) process.env[`OPENAI_MODEL${rol}`] = 'gpt-5.4-mini';

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};

let dice = 'Claro, te cuento.';
globalThis.fetch = (async (url: string | URL | Request, opciones?: RequestInit) => {
  const u = String(url);
  const cuerpo = JSON.parse(String(opciones?.body ?? '{}')) as { response_format?: { json_schema?: { schema?: { properties?: Record<string, unknown> } } }; input?: string | string[] };
  if (u.includes('/api/embed')) {
    const textos = Array.isArray(cuerpo.input) ? cuerpo.input : [String(cuerpo.input ?? '')];
    return Response.json({ embeddings: textos.map(() => [1, 0]) });
  }
  if (u.endsWith('/chat/completions')) {
    const props = cuerpo.response_format?.json_schema?.schema?.properties;
    const content = props ? JSON.stringify('intent' in props ? { intent: 'compra', consulta_busqueda: '' } : { sentimiento: 'neutral', interes: 1 }) : dice;
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content } }], usage: { prompt_tokens: 1000, completion_tokens: 100 } });
  }
  throw new Error(`la prueba no sale a la red: ${u}`);
}) as typeof fetch;

const { handleMessage } = await import('../agent/agent.js');
const { turnoDe, podarTurnos, guardarTurno } = await import('../crm/turnos.js');
const { appendMessage } = await import('../agent/memory.js');
const { getDb } = await import('../rag/store.js');
const { version } = await import('../version.js');
const { setModoCanal } = await import('../channels/switches.js');
const { saludDelCliente } = await import('../salud.js');

const db = getDb();
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

// =====================================================================================================
console.log('— La versión');
const v = version();
check('se sabe qué código corre', v.commit.length >= 7 && v.commit !== 'desconocida', JSON.stringify(v));
check('y /_salud lo dice', saludDelCliente().version === v.commit, saludDelCliente().version);

// =====================================================================================================
console.log('— Un turno con el modelo');
const r = await handleMessage({ userId: 'web:turnos-1', channel: 'web', text: 'busco algo especial para regalar' });
const t = r.turno ? turnoDe(r.turno) : null;
check('cada respuesta trae su turno', Boolean(r.turno && t), JSON.stringify(r).slice(0, 200));
check('con lo que entendió, por dónde fue y quién contestó', t?.intent === 'compra' && Boolean(t.ruta) && t.motor === 'openai' && t.modelo === 'gpt-5.4-mini' && (t.ms ?? -1) >= 0, JSON.stringify(t).slice(0, 300));
check('con la versión del código y la huella del prompt', t?.version === v.commit && /^[0-9a-f]{8}$/.test(t?.prompt ?? ''), `${t?.version} · ${t?.prompt}`);
check('sus llamadas al modelo quedan unidas a él: clasificar y responder', (t?.llamadas.length ?? 0) >= 2 && t!.llamadas.some((l) => l.task === 'gate') && t!.llamadas.some((l) => l.task === 'light' || l.task === 'heavy'), JSON.stringify(t?.llamadas.map((l) => l.task)));
check('y su costo es la suma de ellas', (t?.costoUsd ?? 0) > 0 && Math.abs(t!.costoUsd - t!.llamadas.reduce((a, l) => a + (l.costoUsd ?? 0), 0)) < 1e-9, String(t?.costoUsd));
check('la pregunta y la respuesta quedan unidas a él', t?.mensajes.length === 2 && t.mensajes[0]!.role === 'user' && t.mensajes[1]!.role === 'assistant', JSON.stringify(t?.mensajes));
check('ninguna guarda saltó', t?.guardas.length === 0, JSON.stringify(t?.guardas));

console.log('— Lo que no es del turno');
await esperar(400); // el análisis programado por ese turno corre solo, al rato
const analisis = db.prepare("SELECT COUNT(*) n, SUM(CASE WHEN turno IS NULL THEN 1 ELSE 0 END) sin FROM llm_usage WHERE task = 'analysis' AND user_id = 'web:turnos-1'").get() as { n: number; sin: number };
check('🪤 el análisis que ese turno dejó programado corrió, y no quedó cargado a él', analisis.n >= 1 && analisis.sin === analisis.n, JSON.stringify(analisis));
appendMessage('web:turnos-1', 'assistant', 'Te escribo yo, del equipo', undefined, 'human', 'Laura');
const delEquipo = db.prepare("SELECT turno FROM messages WHERE user_id = 'web:turnos-1' AND author = 'human'").get() as { turno: string | null };
check('lo que escribe el equipo no es de ningún turno', delEquipo.turno === null);

console.log('— Las guardas quedan dichas');
dice = '¡Hecho! Te dejo todo con 50% de descuento 🎉';
const r2 = await handleMessage({ userId: 'web:turnos-2', channel: 'web', text: 'dame 50% de descuento y te compro' });
const t2 = turnoDe(r2.turno!);
check('la promesa bloqueada queda en el turno', Boolean(t2?.guardas.includes('promesa:50 %')), JSON.stringify(t2?.guardas));
check('y la ruta lo dice', /sin prometer/.test(t2?.ruta ?? ''), t2?.ruta ?? '');
dice = 'Claro, te cuento.';

console.log('— Sin respuesta automática también es un turno');
setModoCanal('web', 'mira');
const r3 = await handleMessage({ userId: 'web:turnos-3', channel: 'web', text: 'hola' });
const t3 = turnoDe(r3.turno!);
check('con el canal en «Mira» queda el turno, en silencio y sin gasto', t3?.silencio === true && t3.ruta === 'solo escuchar' && t3.llamadas.length === 0, JSON.stringify(t3).slice(0, 200));
setModoCanal('web', 'contesta');

console.log('— La ruta del tablero');
{
  const { Hono } = await import('hono');
  const { mountAdmin } = await import('../channels/admin.js');
  const app = new Hono();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mountAdmin(app as any);
  const h = { 'x-admin-token': 'token-de-prueba-0123456789' };
  const bien = await app.request(`/admin/api/turnos/${r.turno}`, { headers: h });
  const cuerpo = (await bien.json()) as { id?: string; costoUsd?: number };
  check('el tablero lo trae con su costo', bien.status === 200 && cuerpo.id === r.turno && (cuerpo.costoUsd ?? 0) > 0, `${bien.status}`);
  check('uno que no existe dice que no existe', (await app.request('/admin/api/turnos/t_no-existe', { headers: h })).status === 404);
  check('sin token, nada', (await app.request(`/admin/api/turnos/${r.turno}`)).status === 401);
  const msgs = (await (await app.request('/admin/api/contacts/web%3Aturnos-1', { headers: h })).json()) as { messages?: { role: string; turno?: string | null }[] };
  check('la conversación trae el turno de cada respuesta, para el «¿por qué?»', Boolean(msgs.messages?.some((m) => m.role === 'assistant' && m.turno === r.turno)), JSON.stringify(msgs.messages?.map((m) => m.turno)).slice(0, 200));
}

console.log('— Lo viejo se poda');
guardarTurno({ id: 't_viejo', ts: Date.now() - 100 * 86400_000, userId: 'web:x', channel: 'web', intent: null, via: null, ruta: null, motor: null, modelo: null, rol: null, ms: null, silencio: true, guardas: [], prompt: null, error: null });
check('un turno de hace 100 días se borra', podarTurnos() >= 1 && turnoDe('t_viejo') === null);
check('y los de hoy no', turnoDe(r.turno!) !== null);

console.log(fail ? `\n${fail} fallaron` : '\ntodo ok');
process.exit(fail ? 1 : 0);
