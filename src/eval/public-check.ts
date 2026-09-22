// Pruebas del aviso de dirección pública caída (sin red): pnpm test:public
// Solo se da por caída tras 3 fallas seguidas, avisa una vez al caer y una al volver, y distingue otro servidor.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'aiva-public-')), 'aiva.db');
const { env } = await import('../config.js');
const { INSTANCE, checkPublicUrl } = await import('../channels/public-check.js');
const { onEvent } = await import('../crm/events.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};
const events: string[] = [];
onEvent((ev) => void (ev.type.startsWith('public_') && events.push(ev.type)));
const json = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
const dnsFail = (async () => {
  throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
}) as unknown as typeof fetch;

env.publicUrl = '';
check('sin PUBLIC_URL: lo dice, sin alarma', (await checkPublicUrl(json({}))).state === 'sin_url' && events.length === 0);

env.publicUrl = 'https://prueba.trycloudflare.com';
check('responde este mismo servidor: en línea', (await checkPublicUrl(json({ ok: true, instance: INSTANCE }))).state === 'ok');
let s = await checkPublicUrl(dnsFail);
check('una falla (DNS recién creado) no es caída todavía', s.state === 'fallando' && s.error === 'no se encuentra la dirección' && events.length === 0, JSON.stringify(s));
await checkPublicUrl(dnsFail);
s = await checkPublicUrl(dnsFail);
check('tres fallas seguidas: caída, con aviso', s.state === 'caida' && events.join() === 'public_down', JSON.stringify({ s, events }));
await checkPublicUrl(dnsFail);
check('sigue caída: no repite el aviso', events.join() === 'public_down');
s = await checkPublicUrl(json({ ok: true, instance: INSTANCE }));
check('vuelve: en línea, con aviso', s.state === 'ok' && s.fails === 0 && events.join() === 'public_down,public_up');
s = await checkPublicUrl(json({ error: 1033 }, 530));
check('Cloudflare sin túnel (530) se explica', s.state === 'fallando' && /Cloudflare no encuentra el túnel/.test(s.error), s.error);
await checkPublicUrl(json({ ok: true, instance: 'otro' }));
s = await checkPublicUrl(json({ ok: true, instance: 'otro' }));
check('responde otro servidor: se distingue', s.state === 'otro_servidor' && /otro servidor/.test(s.error), JSON.stringify(s));

console.log(`\n${fail ? `${fail} fallos` : 'todo ok'}`);
process.exit(fail ? 1 : 0);
