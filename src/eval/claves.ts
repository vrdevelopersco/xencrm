// Claves y tarjetas en vivo (sin modelo y sin red): pnpm test:claves
//
// Un cliente de una financiera escribe «mi clave es 4567, no puedo entrar». Hasta ahora eso quedaba guardado en
// claro en el CRM y además se le mandaba al modelo. Lo que se prueba: que se tape antes de que nada lo lea, que no
// se tape lo que no es secreto —el correo que deja al agendar, su número, «la clave es que me llegue rápido»— y que
// el asistente le diga, con tacto, que no comparta eso por el chat.
//
// 🪤 Todo en una carpeta temporal y con un OpenAI de mentira que anota lo que recibe.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'xencrm-claves-'));
const base = JSON.parse(readFileSync(new URL('../../xencrm.config.example.json', import.meta.url), 'utf8')) as Record<string, unknown>;
writeFileSync(join(dir, 'xencrm.config.json'), JSON.stringify(base));
writeFileSync(join(dir, '.env'), '');
Object.assign(process.env, {
  XENCRM_CONFIG: join(dir, 'xencrm.config.json'),
  XENCRM_ENV_FILE: join(dir, '.env'),
  DB_PATH: join(dir, 'data', 'xencrm.db'),
  WHATSAPP_ENABLED: 'false',
  LLM_ENGINE: 'openai',
  OPENAI_API_KEY: 'clave-de-prueba',
  OPENAI_BASE_URL: 'http://openai.prueba/v1',
  EMBED_ENGINE: 'ollama',
  OLLAMA_URL: 'http://ollama.prueba',
});
for (const rol of ['', '_LIGHT', '_HEAVY', '_GATE', '_ANALYSIS']) process.env[`OPENAI_MODEL${rol}`] = 'gpt-5.4-mini';

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};

const alModelo: string[] = [];
globalThis.fetch = (async (url: string | URL | Request, opciones?: RequestInit) => {
  const u = String(url);
  const cuerpo = JSON.parse(String(opciones?.body ?? '{}')) as { response_format?: { json_schema?: { schema?: { properties?: Record<string, unknown> } } }; input?: string | string[] };
  if (u.includes('/api/embed')) {
    alModelo.push(JSON.stringify(cuerpo.input));
    const textos = Array.isArray(cuerpo.input) ? cuerpo.input : [String(cuerpo.input ?? '')];
    return Response.json({ embeddings: textos.map(() => [1, 0]) });
  }
  if (u.endsWith('/chat/completions')) {
    alModelo.push(String(opciones?.body ?? ''));
    const props = cuerpo.response_format?.json_schema?.schema?.properties;
    const content = props ? JSON.stringify('intent' in props ? { intent: 'info_tienda', consulta_busqueda: '' } : {}) : 'Por seguridad, no compartas claves por aquí. ¿Qué te pasa al entrar?';
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content } }] });
  }
  throw new Error(`la prueba no sale a la red: ${u}`);
}) as typeof fetch;

const { taparEnVivo } = await import('../crm/secretos.js');
const { handleMessage } = await import('../agent/agent.js');
const { appendMessage, getMessages } = await import('../agent/memory.js');

// =====================================================================================================
console.log('— Qué se tapa y qué no');
const casos: [string, string][] = [
  ['mi clave es 4567', 'mi clave es «omitido»'],
  ['mi pin es el 1234, ¿qué hago?', 'mi pin es el «omitido», ¿qué hago?'],
  ['Clave: girasol', 'Clave: «omitido»'],
  ['mi contraseña es perrito123', 'mi contraseña es «omitido»'],
  ['el código de verificación es 482913', 'el código de verificación es «omitido»'],
  ['te mando la tarjeta 5555-5555-5555-4444 para pagar', 'te mando la tarjeta «tarjeta omitida» para pagar'],
  ['4111 1111 1111 1111', '«tarjeta omitida»'],
  ['mi llave es sk-proj-abcdefghijklmnop', 'mi llave es «clave omitida»'],
  // Lo que NO es secreto
  ['la clave es que me llegue rápido', 'la clave es que me llegue rápido'],
  ['el PIN de mi tarjeta no funciona', 'el PIN de mi tarjeta no funciona'],
  ['Correo: pedro@gmail.com', 'Correo: pedro@gmail.com'],
  ['Usuario: pedro', 'Usuario: pedro'],
  ['mi número es 300 123 4567', 'mi número es 300 123 4567'],
  ['+57 300 123 4567', '+57 300 123 4567'],
  ['4111 1111 1111 1112', '4111 1111 1111 1112'],
  ['código del pedido: 1234', 'código del pedido: 1234'],
];
for (const [entra, sale] of casos) {
  const r = taparEnVivo(entra).texto;
  check(`«${entra}»${entra === sale ? ' queda igual' : ''}`, r === sale, `quedó «${r}»`);
}

// =====================================================================================================
console.log('— En una conversación');
const r = await handleMessage({ userId: 'web:claves-1', channel: 'web', text: 'mi clave es 4567 y no puedo entrar a la app' });
const guardado = getMessages('web:claves-1').map((m) => m.content).join(' | ');
check('🪤 lo que queda guardado no tiene la clave', !guardado.includes('4567') && guardado.includes('«omitido»'), guardado);
check('🪤 ni le llega al modelo, ni a la búsqueda', alModelo.length > 0 && !alModelo.some((x) => x.includes('4567')), `${alModelo.filter((x) => x.includes('4567')).length} de ${alModelo.length} llevaban la clave`);
check('al modelo se le pide decirle, con tacto, que no la comparta', alModelo.some((x) => x.includes('por seguridad no comparta claves')), 'no llevaba el aviso');
const { turnoDe } = await import('../crm/turnos.js');
check('y el turno lo anota', Boolean(r.turno && turnoDe(r.turno)?.guardas.includes('clave_tapada')), JSON.stringify(r.turno ? turnoDe(r.turno)?.guardas : null));
appendMessage('web:claves-1', 'assistant', 'Tu clave temporal es Xy7#2k', undefined, 'human', 'Laura');
check('lo que escribe el equipo también se guarda sin la clave', !getMessages('web:claves-1').some((m) => m.content.includes('Xy7#2k')), getMessages('web:claves-1').at(-1)?.content ?? '');

console.log(fail ? `\n${fail} fallaron` : '\ntodo ok');
process.exit(fail ? 1 : 0);
