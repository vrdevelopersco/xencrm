// Mensajes repetidos de WhatsApp oficial (sin modelo y sin red): pnpm test:repetidos
//
// Meta puede mandar la misma notificación más de una vez, y reintenta lo que no le confirmamos. Lo que se prueba es
// lo que vería el cliente: un «hola» repetido por Meta es UN mensaje en el CRM y UNA respuesta, llegue el repetido
// al instante —dentro de la espera que junta mensajes seguidos— o un rato después.
//
// De paso, lo que el canal hace cuando NO contesta el asistente («Mira» y «Propone»): no marca leído, no enseña
// «escribiendo…» y no le dice al cliente que solo lee texto. Igual que WhatsApp por QR.
//
// 🪤 Las peticiones van contra la ruta de verdad (`app.request`), firmadas como firma Meta. Todo en una carpeta
// temporal; lo que XENCRM le manda a Meta se anota en vez de salir, y cualquier otra salida a la red hace fallar la prueba.
import { createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HttpBindings } from '@hono/node-server';

const dir = mkdtempSync(join(tmpdir(), 'xencrm-repetidos-'));
const base = JSON.parse(readFileSync(new URL('../../xencrm.config.example.json', import.meta.url), 'utf8')) as Record<string, unknown>;
writeFileSync(join(dir, 'xencrm.config.json'), JSON.stringify(base));
writeFileSync(join(dir, '.env'), '');
const SECRETO = 'secreto-de-prueba';
Object.assign(process.env, {
  XENCRM_CONFIG: join(dir, 'xencrm.config.json'),
  XENCRM_ENV_FILE: join(dir, '.env'),
  DB_PATH: join(dir, 'prueba.db'),
  META_ACCESS_TOKEN: 'token-de-prueba',
  META_PHONE_NUMBER_ID: '1234567890',
  META_APP_SECRET: SECRETO,
  META_VERIFY_TOKEN: 'verifica-de-prueba',
  DEBOUNCE_MS: '40',
  WHATSAPP_ENABLED: 'false',
  LLM_ENGINE: 'openai',
  OPENAI_API_KEY: 'clave-de-prueba',
  OPENAI_BASE_URL: 'http://openai.prueba/v1',
  // 🪤 Un solo modelo para todos los roles. config.ts también lee el .env de la raíz, y con los modelos de esta máquina
  // el enrutador mandaba un «hola» al pesado —con su «dame un segundito»— y la prueba contaba dos respuestas.
  OPENAI_MODEL: 'modelo-de-prueba',
  OPENAI_MODEL_LIGHT: 'modelo-de-prueba',
  OPENAI_MODEL_HEAVY: 'modelo-de-prueba',
  OPENAI_MODEL_GATE: 'modelo-de-prueba',
  OPENAI_MODEL_ANALYSIS: 'modelo-de-prueba',
  EMBED_ENGINE: 'ollama',
  OLLAMA_URL: 'http://ollama.prueba',
});

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};

// Lo que XENCRM le pide a Meta: escribirle a alguien, o marcar leído con «escribiendo…».
const aMeta: { para?: string; texto?: string; leido?: string }[] = [];
globalThis.fetch = (async (url: string | URL | Request, opciones?: RequestInit) => {
  const u = String(url);
  const cuerpo = JSON.parse(String(opciones?.body ?? '{}')) as Record<string, unknown>;
  if (u.includes('graph.facebook.com')) {
    aMeta.push(cuerpo.status === 'read' ? { leido: String(cuerpo.message_id) } : { para: String(cuerpo.to), texto: (cuerpo.text as { body?: string } | undefined)?.body });
    return Response.json({ messages: [{ id: `wamid.salida-${aMeta.length}` }] });
  }
  if (u.endsWith('/chat/completions')) {
    const clasifica = Boolean(cuerpo.response_format);
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: clasifica ? '{"intent":"saludo","consulta_busqueda":""}' : '¡Hola! ¿En qué te ayudo?' } }] });
  }
  if (u.includes('/api/embed') || u.includes('/embeddings')) return Response.json({ embeddings: [[1, 0]], data: [{ embedding: [1, 0], index: 0 }] });
  throw new Error(`la prueba no sale a la red: ${u}`);
}) as typeof fetch;

const { Hono } = await import('hono');
const { mountMeta } = await import('../channels/meta.js');
const { setModoCanal } = await import('../channels/switches.js');
const { primeraVez } = await import('../crm/entrantes.js');
const { getMessages } = await import('../agent/memory.js');
const { getDb } = await import('../rag/store.js');

// =====================================================================================================
console.log('— Lo que ya entró');
const t0 = Date.now();
check('la primera vez, entra', primeraVez('prueba', 'wamid.A', t0));
check('la segunda, no', !primeraVez('prueba', 'wamid.A', t0 + 1000));
check('el mismo id por otro canal es otro mensaje', primeraVez('otra-prueba', 'wamid.A', t0));
check('sin id no hay con qué comparar: se atiende, siempre', primeraVez('prueba', '', t0) && primeraVez('prueba', '', t0) && primeraVez('prueba', undefined, t0));
const OCHO_DIAS = 8 * 24 * 3600_000;
check('a los siete días se olvida (Meta ya no reintenta)', primeraVez('prueba', 'wamid.A', t0 + OCHO_DIAS));
check('y lo recién llegado se sigue recordando', !primeraVez('prueba', 'wamid.A', t0 + OCHO_DIAS + 1000));
check('🪤 vive en la base, no en memoria: sobrevive a un reinicio', (getDb().prepare("SELECT COUNT(*) n FROM entrantes WHERE canal = 'prueba' AND id = 'wamid.A'").get() as { n: number }).n === 1);

// =====================================================================================================
const app = new Hono<{ Bindings: HttpBindings }>();
mountMeta(app);
const CLIENTE = '573001112233';
const USUARIO = `meta:${CLIENTE}`;
const notificacion = (mensajes: Record<string, unknown>[]) =>
  JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: 'waba', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: '1234567890' }, contacts: [{ wa_id: CLIENTE, profile: { name: 'Laura' } }], messages: mensajes } }] }],
  });
const texto = (id: string, body: string) => ({ from: CLIENTE, id, timestamp: '1760000000', type: 'text', text: { body } });
const pegatina = (id: string) => ({ from: CLIENTE, id, timestamp: '1760000000', type: 'sticker', sticker: { id: 'x' } });
const deMeta = async (raw: string) =>
  (await app.request('/webhooks/meta', { method: 'POST', body: raw, headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${createHmac('sha256', SECRETO).update(raw).digest('hex')}` } })).status;
const hasta = async (cumple: () => boolean, ms = 3000) => {
  const fin = Date.now() + ms;
  while (!cumple() && Date.now() < fin) await new Promise((r) => setTimeout(r, 20));
  await new Promise((r) => setTimeout(r, 150)); // y un poco más, por si llega algo de sobra
};
const delCliente = () => getMessages(USUARIO, 100).filter((m) => m.role === 'user').map((m) => m.content);
const respuestas = () => aMeta.filter((x) => x.para === CLIENTE && x.texto && !/solo puedo leer/.test(x.texto));
const soloTexto = () => aMeta.filter((x) => x.para === CLIENTE && /solo puedo leer/.test(x.texto ?? ''));

console.log('— Meta manda lo mismo dos veces (contesta el asistente)');
{
  const hola = notificacion([texto('wamid.1', 'hola')]);
  const a = await deMeta(hola);
  const b = await deMeta(hola); // al instante: cae dentro de la espera que junta los mensajes seguidos
  check('Meta recibe 200 las dos veces (si no, reintenta más)', a === 200 && b === 200, `${a} / ${b}`);
  await hasta(() => respuestas().length >= 1);
  check('🪤 un solo mensaje del cliente, y no «hola\\nhola»', JSON.stringify(delCliente()) === JSON.stringify(['hola']), JSON.stringify(delCliente()));
  check('una sola respuesta', respuestas().length === 1, JSON.stringify(respuestas()));

  await deMeta(hola); // un rato después, ya contestado: el reintento tardío
  await hasta(() => respuestas().length >= 2, 600);
  check('el reintento tardío tampoco entra', delCliente().length === 1, JSON.stringify(delCliente()));
  check('ni se contesta otra vez', respuestas().length === 1, JSON.stringify(respuestas()));

  await deMeta(notificacion([texto('wamid.1', 'hola'), texto('wamid.2', 'busco una monstera')]));
  await hasta(() => delCliente().length >= 2);
  check('en la misma notificación, lo repetido se salta y lo nuevo entra', JSON.stringify(delCliente()) === JSON.stringify(['hola', 'busco una monstera']), JSON.stringify(delCliente()));

  await deMeta(notificacion([pegatina('wamid.3')]));
  await deMeta(notificacion([pegatina('wamid.3')]));
  await hasta(() => soloTexto().length >= 1);
  check('lo que no es texto se avisa una vez, no dos', soloTexto().length === 1, JSON.stringify(soloTexto()));
}

console.log('— Con el canal en «Mira»: contesta una persona');
{
  setModoCanal('meta', 'mira');
  const antes = { respuestas: respuestas().length, soloTexto: soloTexto().length, leidos: aMeta.filter((x) => x.leido).length };
  await deMeta(notificacion([texto('wamid.4', '¿tienen macetas grandes?')]));
  await hasta(() => delCliente().length >= 3);
  check('el mensaje entra al CRM', delCliente().at(-1) === '¿tienen macetas grandes?', JSON.stringify(delCliente()));
  check('el asistente no contesta', respuestas().length === antes.respuestas);
  check('🪤 ni marca leído ni enseña «escribiendo…» (el cliente creería que ya le van a contestar)', aMeta.filter((x) => x.leido).length === antes.leidos, JSON.stringify(aMeta.slice(-3)));
  await deMeta(notificacion([pegatina('wamid.5')]));
  await hasta(() => soloTexto().length > antes.soloTexto, 400);
  check('🪤 ni le dice que solo lee texto: eso delata a un robot donde atiende una persona', soloTexto().length === antes.soloTexto, JSON.stringify(soloTexto()));
  setModoCanal('meta', 'contesta');
}

console.log(fail ? `\n${fail} fallaron` : '\ntodo ok');
process.exit(fail ? 1 : 0);
