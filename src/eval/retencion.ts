// Retención automática (sin modelo y sin red): pnpm test:retencion
//
// Lo que se prueba es lo que no puede fallar cuando algo borra datos de clientes solo, de noche, sin nadie mirando:
// que venga apagada; que no deje poner menos de 90 días; que antes haya un respaldo, y que sin él no toque nada; que
// no toque a quien tiene una cita por delante ni a quien escribió hace poco; que al anonimizar no quede el nombre
// ni el teléfono en NINGUNA tabla —se recorre la base entera buscándolos—, pero sí las cuentas del embudo y del
// gasto; que borrar borre; y que la consola no deje cambiarla a quien no administra aiva.
//
// 🪤 Todo en una carpeta temporal: la base, los archivos del chat y los respaldos.
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'aiva-retencion-'));
const base = JSON.parse(readFileSync(new URL('../../aiva.config.example.json', import.meta.url), 'utf8')) as Record<string, unknown>;
writeFileSync(join(dir, 'aiva.config.json'), JSON.stringify(base));
writeFileSync(join(dir, '.env'), '');
// Un archivo donde iría la carpeta de respaldos: así se prueba qué pasa cuando no se puede respaldar.
writeFileSync(join(dir, 'no-es-carpeta'), '');
Object.assign(process.env, {
  AIVA_CONFIG: join(dir, 'aiva.config.json'),
  AIVA_ENV_FILE: join(dir, '.env'),
  DB_PATH: join(dir, 'data', 'aiva.db'),
  BACKUP_DIR: join(dir, 'no-es-carpeta', 'respaldos'),
  WHATSAPP_ENABLED: 'false',
  LLM_ENGINE: 'openai',
  OPENAI_API_KEY: 'clave-de-prueba',
  OPENAI_BASE_URL: 'http://openai.prueba/v1',
  EMBED_ENGINE: 'ollama',
  OLLAMA_URL: 'http://ollama.prueba',
  ADMIN_TOKEN: 'token-de-prueba-0123456789',
});
globalThis.fetch = (async (url: string | URL | Request) => {
  throw new Error(`la prueba no sale a la red: ${String(url)}`);
}) as typeof fetch;

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};

const { getDb } = await import('../rag/store.js');
const { touchUser, appendMessage } = await import('../agent/memory.js');
const { addEvent } = await import('../crm/contacts.js');
const { guardar, rutaDe } = await import('../crm/medios.js');
const { noteMiss } = await import('../crm/misses.js');
const { openVerification } = await import('../crm/verifications.js');
const { proponer } = await import('../crm/propuestas.js');
const { anotarParticipante } = await import('../crm/grupo-gente.js');
const { guardarTurno, nuevoTurno } = await import('../crm/turnos.js');
const R = await import('../crm/retencion.js');

const db = getDb();
const DIA = 86400_000;
const ahora = Date.now();
const hace = (dias: number) => ahora - dias * DIA;

/** Una persona con de todo: mensajes con foto, análisis, cita, eventos, consumo, turno, origen, pendientes. */
function sembrar(id: string, nombre: string, telefono: string, quietaDesde: number, opts: { citaEn?: number } = {}) {
  touchUser(id, id.split(':')[0]!, nombre);
  const foto = guardar(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), { mime: 'image/jpeg', nombre: 'mi-foto.jpg' });
  appendMessage(id, 'user', `Hola, soy ${nombre}, mi número es ${telefono}`, 'saludo', 'customer', undefined, foto);
  appendMessage(id, 'assistant', `Hola ${nombre}, ¿en qué te ayudo?`);
  db.prepare(
    "UPDATE users SET phone = ?, number = ?, stage = 'cotizando', score = 72, data = ?, tags = ?, notes = ?, summary = ?, score_factors = ?, last_message_at = ?, last_seen = ? WHERE id = ?",
  ).run(telefono, telefono, JSON.stringify({ correo: `${nombre.split(' ')[0]!.toLowerCase()}@correo.co` }), JSON.stringify([`amiga de ${nombre}`]), `Llamar a ${nombre}`, `${nombre} quiere un vestido`, JSON.stringify([`${nombre} preguntó el precio`]), quietaDesde, quietaDesde, id);
  db.prepare('UPDATE messages SET ts = ? WHERE user_id = ?').run(quietaDesde, id);
  db.prepare("INSERT INTO analyses (user_id, ts, engine, sentiment, signals, score, factors) VALUES (?, ?, 'openai', 'positivo', ?, 72, '[]')").run(id, quietaDesde, JSON.stringify({ nombre }));
  const cita = opts.citaEn ?? quietaDesde - DIA;
  db.prepare("INSERT INTO appointments (user_id, starts_at, ends_at, service, status, notes, created_at, customer_reply) VALUES (?, ?, ?, 'Prueba de vestido', ?, ?, ?, ?)").run(
    id,
    cita,
    cita + 3600_000,
    opts.citaEn ? 'confirmada' : 'asistio',
    `Viene ${nombre} con la mamá`,
    quietaDesde,
    `Sí, ahí estaré. ${nombre}`,
  );
  addEvent(id, 'etapa', { de: 'nuevo', a: 'cotizando', nota: `lo movió ${nombre}` });
  db.prepare("INSERT INTO llm_usage (ts, user_id, task, engine, model, input_tokens, output_tokens, ms) VALUES (?, ?, 'light', 'openai', 'gpt-5.4-mini', 1000, 100, 50)").run(quietaDesde, id);
  guardarTurno({ id: nuevoTurno(), ts: ahora, userId: id, channel: 'whatsapp', intent: 'saludo', via: 'regex', ruta: 'saludo', motor: null, modelo: null, rol: null, ms: 5, silencio: false, guardas: [], prompt: null, error: null });
  db.prepare("INSERT INTO origen (user_id, fuente, medio, campana, clic, url, referente, ts) VALUES (?, 'facebook', 'anuncio', 'verano', ?, ?, 'https://l.facebook.com', ?)").run(
    id,
    `clic-${telefono}`,
    `https://tienda.co/?correo=${encodeURIComponent(nombre)}`,
    quietaDesde,
  );
  noteMiss(id, 'frase', `soy ${nombre} y no entendí`);
  openVerification(id, `¿${nombre} puede pagar a cuotas?`);
  proponer(id, `Hola ${nombre}, te paso el catálogo`);
  db.prepare('INSERT INTO wa_salida (user_id, texto, ts) VALUES (?, ?, ?)').run(id, `Hola ${nombre}`, quietaDesde);
  anotarParticipante('grupo:novias@g.us', id, nombre, quietaDesde);
  return foto.id;
}

/** Busca un texto en TODA la base: cada tabla, cada columna de texto. Devuelve dónde apareció. */
function dondeAparece(texto: string): string[] {
  const tablas = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'docs_fts%'").all() as { name: string }[]).map((t) => t.name);
  const hallado: string[] = [];
  for (const t of tablas) {
    const cols = (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string; type: string }[]).filter((c) => !/BLOB/i.test(c.type));
    for (const c of cols) {
      const n = (db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE CAST(${c.name} AS TEXT) LIKE ?`).get(`%${texto}%`) as { n: number }).n;
      if (n) hallado.push(`${t}.${c.name}`);
    }
  }
  return hallado;
}

const VIEJA = 'wa:573001112222@s.whatsapp.net';
const CON_CITA = 'wa:573003334444@s.whatsapp.net';
const RECIENTE = 'web:reciente-1';
const fotoVieja = sembrar(VIEJA, 'Pedro Páramo', '573001112222', hace(400));
sembrar(CON_CITA, 'Susana San Juan', '573003334444', hace(400), { citaEn: ahora + 10 * DIA });
sembrar(RECIENTE, 'Juan Preciado', '573005556666', hace(30));

// =====================================================================================================
console.log('— Viene apagada');
check('sin política no hay nada', R.politica() === null);
check('🪤 y una pasada no toca nada', R.aplicarRetencion(ahora) === null && Boolean(db.prepare('SELECT 1 FROM users WHERE id = ?').get(VIEJA)));

console.log('— Lo que no deja poner');
const rechaza = (entrada: { dias?: number | string | null; accion?: string }, que: RegExp) => {
  try {
    R.ponerPolitica(entrada);
    return false;
  } catch (err) {
    return que.test((err as Error).message);
  }
};
check('🪤 menos de 90 días, no', rechaza({ dias: 30 }, /mínimo son 90/));
check('días con decimales, no', rechaza({ dias: 365.5 }, /entero/));
check('algo que no es un número, no', rechaza({ dias: 'un año' }, /entero/));
check('más de diez años, no', rechaza({ dias: 5000 }, /máximo/));
check('una acción que no existe, no', rechaza({ dias: 365, accion: 'quemar' }, /anonimizar o borrar/));
check('nada de eso quedó guardado', R.politica() === null);

console.log('— Antes de guardar, cuántas tocaría');
const previa = R.vistaPrevia(365, ahora);
check('las quietas de hace más de un año, sin contar la que tiene cita', previa.cuantas === 1 && previa.conCita === 1, JSON.stringify(previa));
check('y de cuándo es la más vieja', previa.masVieja === hace(400), String(previa.masVieja));

// =====================================================================================================
console.log('— Sin respaldo no se toca nada');
R.ponerPolitica({ dias: 365 });
check('se guarda, y anonimizar es lo de por defecto', R.politica()?.dias === 365 && R.politica()?.accion === 'anonimizar', JSON.stringify(R.politica()));
const sinRespaldo = R.aplicarRetencion(ahora);
check('🪤 si no se pudo respaldar, no se anonimiza nadie', sinRespaldo?.cuantos === 0 && Boolean(sinRespaldo.error) && Boolean(db.prepare('SELECT 1 FROM users WHERE id = ?').get(VIEJA)), JSON.stringify(sinRespaldo));
check('y queda dicho, para que la consola lo enseñe', R.ultimaPasada()?.error === sinRespaldo?.error && R.ultimaPasada()?.quedan === 1);

// =====================================================================================================
console.log('— Anonimizar');
const respaldos = join(dir, 'respaldos');
process.env.BACKUP_DIR = respaldos;
const consumoAntes = db.prepare('SELECT COUNT(*) n, SUM(input_tokens) t FROM llm_usage').get() as { n: number; t: number };
const pasada = R.aplicarRetencion(ahora);
check('una pasada anonimiza la vieja', pasada?.cuantos === 1 && pasada.quedan === 0 && !pasada.error, JSON.stringify(pasada));
check('🪤 y antes hizo el respaldo, que guarda lo de antes', existsSync(respaldos) && readdirSync(respaldos).some((f) => f.endsWith('.db')), existsSync(respaldos) ? readdirSync(respaldos).join(',') : 'no hay carpeta');
check('su identificador de antes ya no existe', !db.prepare('SELECT 1 FROM users WHERE id = ?').get(VIEJA));
for (const rastro of ['Pedro Páramo', 'Pedro', '3001112222', 'pedro@correo.co', VIEJA]) {
  const donde = dondeAparece(rastro);
  check(`🪤 «${rastro}» no queda en ninguna tabla`, donde.length === 0, donde.join(', '));
}
check('🪤 ni la foto en el disco', rutaDe(fotoVieja) === null);
const anon = db.prepare("SELECT * FROM users WHERE id LIKE 'anon:%'").get() as Record<string, unknown> | undefined;
check('queda una ficha anónima, archivada', Boolean(anon) && anon!.archived === 1 && anon!.name === null && anon!.phone === null && anon!.notes === '' && anon!.summary === null, JSON.stringify(anon));
check('con su etapa, su puntaje y su canal: el embudo sigue cuadrando', anon?.stage === 'cotizando' && anon.score === 72 && anon.channel === 'wa', JSON.stringify(anon));
const idAnon = String(anon?.id);
const cuenta = (t: string) => (db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE user_id = ?`).get(idAnon) as { n: number }).n;
check('su cita se queda, sin notas', cuenta('appointments') === 1 && (db.prepare('SELECT notes FROM appointments WHERE user_id = ?').get(idAnon) as { notes: string }).notes === '');
check('sus eventos se quedan, sin detalle', cuenta('events') >= 1 && (db.prepare("SELECT COUNT(*) n FROM events WHERE user_id = ? AND payload <> '{}'").get(idAnon) as { n: number }).n === 0);
const origenAnon = db.prepare('SELECT campana, clic, url FROM origen WHERE user_id = ?').get(idAnon) as { campana: string; clic: string; url: string } | undefined;
check('de dónde vino se queda: la campaña sí, el clic y la página no', origenAnon?.campana === 'verano' && origenAnon.clic === '' && origenAnon.url === '', JSON.stringify(origenAnon));
check('su turno se queda', cuenta('turnos') === 1);
check('mensajes, análisis, pendientes y propuestas se van', ['messages', 'analyses', 'misses', 'verifications', 'propuestas', 'wa_salida'].every((t) => cuenta(t) === 0));
const consumoDespues = db.prepare('SELECT COUNT(*) n, SUM(input_tokens) t FROM llm_usage').get() as { n: number; t: number };
check('🪤 el gasto de IA no se encoge', consumoDespues.n === consumoAntes.n && consumoDespues.t === consumoAntes.t && cuenta('llm_usage') === 1);

console.log('— Lo que no se toca');
check('🪤 a quien tiene una cita por delante, no', Boolean(db.prepare('SELECT 1 FROM users WHERE id = ? AND name IS NOT NULL', ).get(CON_CITA)) && dondeAparece('Susana San Juan').includes('messages.content'));
check('a quien escribió hace un mes, no', Boolean(db.prepare('SELECT 1 FROM users WHERE id = ? AND name IS NOT NULL').get(RECIENTE)));
check('una segunda pasada no encuentra nada más', R.aplicarRetencion(ahora)?.cuantos === 0 && (db.prepare("SELECT COUNT(*) n FROM users WHERE id LIKE 'anon:%'").get() as { n: number }).n === 1);

console.log('— Si vuelve a escribir');
const vuelve = touchUser(VIEJA, 'wa', null);
check('empieza de cero: ficha nueva, sin nada de antes', vuelve.messageCount === 0 && vuelve.name === null, JSON.stringify(vuelve));

// =====================================================================================================
console.log('— Por tandas');
const muchas = 305;
const insertar = db.prepare("INSERT INTO users (id, channel, name, first_seen, last_seen, last_message_at) VALUES (?, 'web', ?, ?, ?, ?)");
for (let i = 0; i < muchas; i++) insertar.run(`web:vieja-${i}`, `Vieja ${i}`, hace(800), hace(500), hace(500));
const tanda = R.aplicarRetencion(ahora);
check('🪤 una pasada no se lleva miles de golpe', tanda?.cuantos === 300 && tanda.quedan === 5, JSON.stringify(tanda));
check('la siguiente termina', R.aplicarRetencion(ahora)?.cuantos === 5);

// =====================================================================================================
console.log('— Borrar');
const OTRA = 'wa:573007778888@s.whatsapp.net';
const fotoOtra = sembrar(OTRA, 'Dolores Preciado', '573007778888', hace(400));
R.ponerPolitica({ dias: 365, accion: 'borrar' });
const borrada = R.aplicarRetencion(ahora);
check('una pasada la borra', borrada?.cuantos === 1 && borrada.accion === 'borrar', JSON.stringify(borrada));
for (const rastro of ['Dolores', '3007778888', OTRA]) {
  const donde = dondeAparece(rastro);
  check(`🪤 «${rastro}» no queda en ninguna tabla`, donde.length === 0, donde.join(', '));
}
check('ni su foto', rutaDe(fotoOtra) === null);
check('ni una ficha anónima: borrar es borrar', (db.prepare("SELECT COUNT(*) n FROM users WHERE id LIKE 'anon:%'").get() as { n: number }).n === 1 + muchas);
check('🪤 el gasto queda, a nombre de nadie', (db.prepare("SELECT COUNT(*) n FROM llm_usage WHERE user_id = 'borrado'").get() as { n: number }).n === 1);

console.log('— Apagarla');
check('vacío la apaga', R.ponerPolitica({ dias: '' }) === null && R.politica() === null);
sembrar('web:otra-vieja', 'Fulgor Sedano', '573009990000', hace(400));
check('y apagada no toca nada', R.aplicarRetencion(ahora) === null && Boolean(db.prepare("SELECT 1 FROM users WHERE id = 'web:otra-vieja'").get()));

// =====================================================================================================
console.log('— La ruta del tablero');
{
  const { Hono } = await import('hono');
  const { mountAdmin } = await import('../channels/admin.js');
  const app = new Hono();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mountAdmin(app as any);
  const h = { 'x-admin-token': 'token-de-prueba-0123456789', 'content-type': 'application/json' };
  const ver = (await (await app.request('/admin/api/retencion?dias=365', { headers: h })).json()) as { politica: unknown; previa: { cuantas: number }; minimo: number };
  check('el tablero la ve, con cuántas tocaría', ver.politica === null && ver.previa.cuantas === 1 && ver.minimo === 90, JSON.stringify(ver));
  const mal = await app.request('/admin/api/retencion', { method: 'PUT', headers: h, body: JSON.stringify({ dias: 7 }) });
  check('🪤 la ruta tampoco deja poner menos de 90 días', mal.status === 400 && R.politica() === null, `${mal.status}`);
  const bien = (await (await app.request('/admin/api/retencion', { method: 'PUT', headers: h, body: JSON.stringify({ dias: 730, accion: 'anonimizar' }) })).json()) as { politica?: { dias: number } };
  check('y guarda lo que sí', bien.politica?.dias === 730 && R.politica()?.dias === 730, JSON.stringify(bien));
  check('sin token, nada', (await app.request('/admin/api/retencion')).status === 401);
}

console.log(fail ? `\n${fail} fallaron` : '\ntodo ok');
process.exit(fail ? 1 : 0);
