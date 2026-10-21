// La guía de inicio (sin modelo y sin red): pnpm test:guia
//
// Lo que se prueba: que cada paso se marque hecho SOLO cuando de verdad lo está —el perfil con lo que el asistente
// necesita, el catálogo con precios, un canal que recibe, una conversación de verdad, un horario escrito por
// alguien— y que, cuando no, diga exactamente qué falta. Que lo de citas no salga en un negocio que no agenda.
// Que sin token no conteste. Y que pedirla no cueste nada: ni una llamada al modelo ni a la red.
//
// 🪤 Todo en una carpeta temporal con un negocio de ejemplo; las peticiones van por `app.request`, el mismo
// camino que el navegador, con el guardia del tablero delante.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'aiva-guia-'));
const base = JSON.parse(readFileSync(new URL('../../aiva.config.example.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const archivoConfig = join(dir, 'aiva.config.json');
// Agenda citas, pero sin días ni franjas escritos: corre con el horario de ejemplo.
const escribirConfig = (citas: Record<string, unknown>) =>
  writeFileSync(archivoConfig, JSON.stringify({ ...base, profileFile: join(dir, 'perfil.json'), appointments: citas }));
escribirConfig({ enabled: true, service: 'visita' });
writeFileSync(join(dir, '.env'), '');
Object.assign(process.env, {
  AIVA_CONFIG: archivoConfig,
  AIVA_ENV_FILE: join(dir, '.env'),
  DB_PATH: join(dir, 'data', 'prueba.db'),
  ADMIN_TOKEN: 'token-del-tablero-de-prueba-0123456789',
  PUBLIC_URL: 'https://prueba.invalid',
  WHATSAPP_ENABLED: 'false',
  OPENAI_API_KEY: 'clave-de-prueba',
  OPENAI_BASE_URL: 'http://openai.prueba/v1',
  OLLAMA_URL: 'http://ollama.prueba',
});

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};

// 🪤 Cualquier salida a la red mientras se pide la guía es un error: ni modelo, ni Meta, ni la dirección pública.
const fetchDeVerdad = globalThis.fetch;
let llamadas = 0;
globalThis.fetch = (async (...a: Parameters<typeof fetch>) => {
  llamadas++;
  return fetchDeVerdad(...a);
}) as typeof fetch;

const { Hono } = await import('hono');
const { mountAdmin } = await import('../channels/admin.js');
const { business } = await import('../config.js');
const { saveProfile } = await import('../profile.js');
const { getDb } = await import('../rag/store.js');
const { olvidarPrecios } = await import('../crm/valor.js');
const { setChannelOn } = await import('../channels/switches.js');
const { checkPublicUrl, INSTANCE } = await import('../channels/public-check.js');

const app = new Hono();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
mountAdmin(app as any);

interface Paso { id: string; titulo: string; hecho: boolean; opcional: boolean; falta: string; ir: string }
const guia = async (token = process.env.ADMIN_TOKEN!) => {
  const r = await app.request('/admin/api/guia', { headers: { 'x-admin-token': token } });
  return { status: r.status, cuerpo: (r.status === 200 ? await r.json() : null) as { pasos: Paso[]; agente: string } | null };
};
const paso = async (id: string) => (await guia()).cuerpo?.pasos.find((p) => p.id === id);

// ---------- El guardia ----------
check('sin token no contesta', (await app.request('/admin/api/guia')).status === 401);
check('con un token equivocado tampoco', (await guia('otro-token-que-no-es-0123456789')).status === 401);

// ---------- Un negocio recién creado ----------
llamadas = 0;
const nuevo = await guia();
check('contesta con los pasos y el nombre del asistente', nuevo.status === 200 && Array.isArray(nuevo.cuerpo?.pasos) && nuevo.cuerpo?.agente === business.agent.name);
const ids = nuevo.cuerpo?.pasos.map((p) => p.id).join(',');
check('los pasos van en orden: perfil, catálogo, canal, prueba, citas y el calendario', ids === 'perfil,catalogo,canal,prueba,citas,calendario', ids);
check('en un negocio vacío no hay nada hecho', nuevo.cuerpo?.pasos.every((p) => !p.hecho) === true, JSON.stringify(nuevo.cuerpo?.pasos.map((p) => [p.id, p.hecho])));
check('cada paso pendiente dice qué falta y adónde ir', nuevo.cuerpo?.pasos.every((p) => p.falta.length > 10 && p.ir.length > 0) === true);
check('solo el calendario es opcional', nuevo.cuerpo?.pasos.filter((p) => p.opcional).map((p) => p.id).join(',') === 'calendario');
check('🪤 pedir la guía no sale a la red: ni modelo, ni Meta, ni la dirección pública', llamadas === 0, `${llamadas} llamadas`);

// ---------- El perfil ----------
const perfil0 = nuevo.cuerpo?.pasos.find((p) => p.id === 'perfil');
check('el perfil vacío dice las tres cosas que faltan', perfil0?.falta.startsWith('Faltan la dirección, los horarios y las formas de pago') === true, perfil0?.falta);
check('y lleva al perfil del negocio', perfil0?.ir === 'profile');
saveProfile({ service: { address: 'Calle 1 # 2-3' } });
const perfil1 = await paso('perfil');
check('con la dirección, faltan los otros dos', !perfil1?.hecho && perfil1?.falta.startsWith('Faltan los horarios y las formas de pago') === true, perfil1?.falta);
saveProfile({ service: { address: 'Calle 1 # 2-3', hours: '   ' }, payments: { methods: 'Efectivo y transferencia' } });
const perfil2 = await paso('perfil');
check('🪤 un campo con solo espacios no cuenta como lleno', !perfil2?.hecho && perfil2?.falta.startsWith('Faltan los horarios.') === true, perfil2?.falta);
saveProfile({ service: { address: 'Calle 1 # 2-3', hours: 'Lunes a sábado, 9 a 6' }, payments: { methods: 'Efectivo y transferencia' } });
const perfil3 = await paso('perfil');
saveProfile({ service: { hours: 'Lunes a sábado, 9 a 6' }, payments: { methods: 'Efectivo' } });
check('«Falta la dirección», en singular', (await paso('perfil'))?.falta.startsWith('Falta la dirección.') === true, (await paso('perfil'))?.falta);
saveProfile({ service: { address: 'Calle 1 # 2-3', hours: 'Lunes a sábado, 9 a 6' }, payments: { methods: 'Efectivo y transferencia' } });
check('con dirección, horarios y formas de pago, el perfil queda hecho', perfil3?.hecho === true && perfil3.falta === '', perfil3?.falta);

// ---------- El catálogo ----------
const db = getDb();
const producto = db.prepare("INSERT OR REPLACE INTO docs (id, kind, title, content, url, meta, embedding, updated_at) VALUES (?, 'product', ?, ?, '', ?, ?, ?)");
const vector = Buffer.from(new Float32Array([0.1, 0.2]).buffer);
check('sin productos lo dice', (await paso('catalogo'))?.falta === 'No hay productos todavía.');
producto.run('p1', 'Matera de barro', 'Matera grande', JSON.stringify({}), vector, Date.now());
olvidarPrecios();
const cat1 = await paso('catalogo');
check('con productos pero sin precio, no está hecho y dice por qué', !cat1?.hecho && /no tiene precios/.test(cat1?.falta ?? ''), cat1?.falta);
producto.run('p2', 'Potus', 'Planta de interior', JSON.stringify({ price: '$35.000' }), vector, Date.now());
olvidarPrecios();
check('con un producto con precio, queda hecho', (await paso('catalogo'))?.hecho === true);

// ---------- El canal ----------
const canal0 = await paso('canal');
check('el chat del sitio encendido sin comprobar la dirección no basta', !canal0?.hecho && /falta comprobar/.test(canal0?.falta ?? ''), canal0?.falta);
const { env } = await import('../config.js');
const laDeVerdad = env.publicUrl;
env.publicUrl = '';
const sinUrl = await paso('canal');
check('🪤 sin dirección pública lo dice de una vez, sin quedarse «revisando»', !sinUrl?.hecho && /falta la dirección pública/.test(sinUrl?.falta ?? ''), sinUrl?.falta);
env.publicUrl = laDeVerdad;
await checkPublicUrl((async () => new Response('', { status: 530 })) as unknown as typeof fetch);
const canal1 = await paso('canal');
check('si la dirección pública no responde, lo dice con el motivo', !canal1?.hecho && /no responde \(Cloudflare/.test(canal1?.falta ?? ''), canal1?.falta);
await checkPublicUrl((async () => new Response(JSON.stringify({ instance: INSTANCE }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch);
check('con el chat del sitio encendido y la dirección respondiendo, queda hecho', (await paso('canal'))?.hecho === true);
setChannelOn('web', false);
const canal2 = await paso('canal');
check('🪤 la dirección respondiendo no sirve si el chat está apagado y no hay WhatsApp', !canal2?.hecho && /Ningún canal/.test(canal2?.falta ?? ''), canal2?.falta);
setChannelOn('web', true);

// ---------- La prueba ----------
const mensaje = db.prepare("INSERT INTO messages (user_id, role, content, intent, ts) VALUES (?, ?, ?, '', ?)");
mensaje.run('wa:seed-demo-1', 'user', 'hola, ¿tienen potus?', Date.now());
mensaje.run('120363@g.us', 'user', 'alguien del grupo', Date.now());
mensaje.run('web:sesion-prueba-1', 'assistant', 'Hola, ¿en qué te ayudo?', Date.now());
check('🪤 la demostración, los grupos y lo que dice el asistente no cuentan como prueba', (await paso('prueba'))?.hecho === false);
mensaje.run('web:sesion-prueba-1', 'user', 'hola', Date.now());
check('un cliente que escribió de verdad sí', (await paso('prueba'))?.hecho === true);

// ---------- Las citas ----------
const citas0 = await paso('citas');
check('🪤 el horario de ejemplo no cuenta como horario puesto', !citas0?.hecho && /horario de ejemplo/.test(citas0?.falta ?? ''), citas0?.falta);
check('y lleva a El negocio, que es donde se pone', citas0?.ir === 'negocio');
escribirConfig({ enabled: true, service: 'visita', days: [1, 2, 3, 4, 5, 6], hours: [['10:00', '13:00'], ['15:00', '19:00']] });
check('con días y franjas escritos, queda hecho', (await paso('citas'))?.hecho === true);
const cal = await paso('calendario');
check('el calendario sin conectar es opcional y dice para qué sirve', cal?.opcional === true && !cal.hecho && /ocupado/.test(cal.falta), cal?.falta);

// ---------- Un negocio que no agenda ----------
business.appointments.enabled = false;
const sinCitas = (await guia()).cuerpo?.pasos.map((p) => p.id).join(',');
check('🪤 si el negocio no agenda, no salen ni las citas ni el calendario', sinCitas === 'perfil,catalogo,canal,prueba', sinCitas);
business.appointments.enabled = true;

// ---------- Todo junto ----------
llamadas = 0;
const fin = (await guia()).cuerpo?.pasos ?? [];
check('con todo puesto, lo obligatorio está hecho', fin.filter((p) => !p.opcional).every((p) => p.hecho), JSON.stringify(fin.map((p) => [p.id, p.hecho, p.falta])));
check('y lo hecho no dice que falte algo', fin.filter((p) => p.hecho).every((p) => p.falta === ''));
check('🪤 tampoco al final hubo una sola llamada a la red', llamadas === 0, `${llamadas} llamadas`);

globalThis.fetch = fetchDeVerdad;
console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
