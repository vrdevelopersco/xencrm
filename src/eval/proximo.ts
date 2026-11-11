// Pruebas del próximo paso, el valor en la lista y las notas de la historia (sin modelo): pnpm test:proximo
//
// Lo que más importa aquí es que el próximo paso diga lo mismo que el resto del tablero: si una ficha dice
// «Retomar» y no está en Seguimientos, o está en Seguimientos y dice otra cosa, una de las dos pantallas miente.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'xencrm-proximo-')), 'xencrm.db');
process.env.ADMIN_TOKEN = 'token-del-tablero-de-prueba-0123456789';
const { touchUser, appendMessage } = await import('../agent/memory.js');
const { getContact, updateContact, setHumanMode, setStage, etapaCon, listEvents } = await import('../crm/contacts.js');
const { proximoPaso, contextoDelPaso, cuandoCorto } = await import('../crm/proximo.js');
const { openVerification } = await import('../crm/verifications.js');
const { getDb } = await import('../rag/store.js');
const { business } = await import('../config.js');
const { Hono } = await import('hono');
const { mountAdmin } = await import('../channels/admin.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};
const H = 3600_000;
const DIA = 24 * H;
const now = Date.now();
const db = getDb();

/** Una ficha con su última conversación: quién habló de último y hace cuánto. */
function ficha(id: string, nombre: string, o: { hace: number; ultimo?: 'user' | 'assistant'; score?: number }) {
  touchUser(id, 'web', nombre);
  appendMessage(id, 'user', 'hola, quiero información', 'consulta');
  if ((o.ultimo ?? 'assistant') === 'assistant') appendMessage(id, 'assistant', 'con gusto', 'consulta');
  const ts = now - o.hace;
  // Quien habló de último, un milisegundo después: con el mismo ts los dos serían «el último».
  db.prepare("UPDATE messages SET ts = CASE WHEN role = ? THEN ? ELSE ? END WHERE user_id = ?").run(o.ultimo ?? 'assistant', ts, ts - 1, id);
  db.prepare('UPDATE users SET last_message_at = ?, last_seen = ?, unread = 2 WHERE id = ?').run(ts, ts, id);
  if (o.score !== undefined) updateContact(id, { score: o.score }, { silent: true });
}
function cita(id: string, startsAt: number) {
  db.prepare("INSERT INTO appointments (user_id, starts_at, ends_at, service, status, notes, created_at) VALUES (?, ?, ?, 'asesoría', 'confirmada', '', ?)").run(id, startsAt, startsAt + H, now);
}

ficha('web:vendida', 'Vendida', { hace: 3 * DIA, score: 90 });
setStage('web:vendida', etapaCon('ganado')!, { locked: true, by: 'admin' });
ficha('web:verifica', 'Verifica', { hace: 2 * H });
openVerification('web:verifica', '¿tienen el traje en talla 44?');
ficha('web:espera', 'Espera', { hace: 2 * H, ultimo: 'user' });
ficha('web:pidio', 'Pidió', { hace: 30 * 60_000 });
setHumanMode('web:pidio', true, 'bot');
ficha('web:laura', 'De Laura', { hace: 20 * 60_000 });
setHumanMode('web:laura', true, 'Laura');
ficha('web:cita', 'Con cita', { hace: 3 * DIA, score: 80 });
cita('web:cita', now + DIA);
ficha('web:fue', 'Ya fue', { hace: 3 * DIA, score: 70 });
cita('web:fue', now - 2 * DIA);
ficha('web:pospuesto', 'Pospuesto', { hace: 3 * DIA, score: 75 });
updateContact('web:pospuesto', { data: { pospuesto_desde: now - DIA, pospuesto_hasta: now + 5 * DIA } }, { silent: true });
ficha('web:caliente', 'Caliente', { hace: 3 * DIA, score: 72 });
ficha('web:frio', 'Frío', { hace: 2 * DIA, score: 10 });
ficha('web:viva', 'Viva', { hace: 10 * 60_000, score: 20 });
// Entre 24 y 48 horas: el borde. Seguimientos la incluye desde las 24, y el paso tiene que decir lo mismo.
ficha('web:borde', 'Borde', { hace: 30 * H, score: 10 });

const ctx = contextoDelPaso(now);
const paso = (id: string) => proximoPaso(getContact(id)!, ctx);

console.log('— El próximo paso, regla por regla');
check('una venta cerrada no pide nada', paso('web:vendida').tipo === 'ninguno' && paso('web:vendida').texto === '', JSON.stringify(paso('web:vendida')));
check('lo que quedó de averiguar va primero y urgente', paso('web:verifica').tipo === 'verificar' && paso('web:verifica').urgente, JSON.stringify(paso('web:verifica')));
check('la última palabra suya: «Contestar», con hace cuánto', paso('web:espera').tipo === 'responder' && /^Contestar: escribió hace 2 h$/.test(paso('web:espera').texto) && paso('web:espera').urgente, JSON.stringify(paso('web:espera')));
check('🪤 la pasó el bot: la tiene el equipo, no «bot»', paso('web:pidio').tipo === 'persona' && !/bot/i.test(paso('web:pidio').texto), JSON.stringify(paso('web:pidio')));
check('la tiene una persona: dice quién', paso('web:laura').texto === 'Laura está atendiendo' && !paso('web:laura').urgente, JSON.stringify(paso('web:laura')));
check('con cita: la cita es el paso, con fecha corta', paso('web:cita').tipo === 'cita' && /^Cita mañana, \d{1,2}:\d{2} [ap]\. m\.$/.test(paso('web:cita').texto), JSON.stringify(paso('web:cita')));
check('la cita trae su fecha para ordenar', paso('web:cita').cuando === now + DIA);
check('una cita que pasó sin resultado pide anotarlo', paso('web:fue').tipo === 'resultado' && /^Anotar cómo le fue en la cita de /.test(paso('web:fue').texto), JSON.stringify(paso('web:fue')));
check('pospuesto: dice hasta cuándo, sin apurar', paso('web:pospuesto').tipo === 'pospuesto' && /^Retomar el \d{1,2} \w+$/.test(paso('web:pospuesto').texto) && !paso('web:pospuesto').urgente, JSON.stringify(paso('web:pospuesto')));
check('caliente callado: «Retomar», urgente', paso('web:caliente').texto === 'Retomar: 3 días sin escribir' && paso('web:caliente').urgente, JSON.stringify(paso('web:caliente')));
check('frío callado: «Escribirle», sin apurar', paso('web:frio').texto === 'Escribirle: 2 días sin escribir' && !paso('web:frio').urgente, JSON.stringify(paso('web:frio')));
check('🪤 a las 30 horas ya toca escribirle (el borde son 24, como en Seguimientos)', paso('web:borde').texto === 'Escribirle: 1 día sin escribir', JSON.stringify(paso('web:borde')));
check('conversación viva: la atiende el asistente, por su nombre', paso('web:viva').texto === `${business.agent.name} está atendiendo`, JSON.stringify(paso('web:viva')));
check('ninguna frase habla de «bot» ni deja «undefined»', ['web:vendida', 'web:verifica', 'web:espera', 'web:pidio', 'web:laura', 'web:cita', 'web:fue', 'web:pospuesto', 'web:caliente', 'web:frio', 'web:viva'].every((id) => !/\bbot\b|undefined|null|NaN/.test(paso(id).texto)));

console.log('— Las fechas, en el huso del negocio');
const mediodia = (() => {
  // Mediodía de hoy en el huso del negocio, para no depender de la hora a la que se corra la prueba.
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: business.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
  return new Date(`${hoy}T12:00:00-05:00`).getTime();
})();
check('hoy', /^hoy, /.test(cuandoCorto(mediodia, mediodia)), cuandoCorto(mediodia, mediodia));
check('mañana', /^mañana, /.test(cuandoCorto(mediodia + DIA, mediodia)));
check('ayer', /^ayer, /.test(cuandoCorto(mediodia - DIA, mediodia)));
// 🪤 Con letras y no con \w: «sáb» y «mié» llevan tilde, y la prueba fallaba solo los días en que cuatro más caían ahí.
check('más lejos: día de la semana y fecha, sin puntos', /^el \p{L}+ \d{1,2} \p{L}+, /u.test(cuandoCorto(mediodia + 4 * DIA, mediodia)) && !/\./.test(cuandoCorto(mediodia + 4 * DIA, mediodia).split(',')[0] ?? ''), cuandoCorto(mediodia + 4 * DIA, mediodia));

console.log('— La lista del tablero');
const app = new Hono();
mountAdmin(app as never);
const T = { 'x-admin-token': process.env.ADMIN_TOKEN!, 'content-type': 'application/json' };
const lista = (await (await app.request('/admin/api/contacts', { headers: T })).json()) as { id: string; valor: number; valorOrigen: string; proximo: { tipo: string; texto: string } }[];
check('cada fila trae su próximo paso', lista.length >= 12 && lista.every((x) => x.proximo && typeof x.proximo.texto === 'string'), JSON.stringify(lista[0]).slice(0, 300));
check('cada fila trae su valor, aunque sea 0', lista.every((x) => typeof x.valor === 'number'));
updateContact('web:cita', { data: { valor: 480000 } }, { silent: true });
const conValor = ((await (await app.request('/admin/api/contacts', { headers: T })).json()) as typeof lista).find((x) => x.id === 'web:cita')!;
check('el valor puesto a mano sale en la lista y dice de dónde', conValor.valor === 480000 && conValor.valorOrigen === 'a mano', JSON.stringify(conValor));

// 🪤 Una sola cola por concepto: los que el paso manda a retomar o escribir son exactamente los de Seguimientos.
const seg = (await (await app.request('/admin/api/seguimientos', { headers: T })).json()) as { seguimientos: { id: string }[] };
const enSeguimientos = new Set(seg.seguimientos.map((x) => x.id));
const porElPaso = new Set(lista.filter((x) => x.proximo.tipo === 'retomar' || x.proximo.tipo === 'escribir').map((x) => x.id));
check('🪤 «Retomar» y «Escribirle» son exactamente los de Seguimientos', enSeguimientos.size === porElPaso.size && [...porElPaso].every((id) => enSeguimientos.has(id)),
  `seguimientos: ${[...enSeguimientos].join(', ')} · paso: ${[...porElPaso].join(', ')}`);

console.log('— Los números de la barra');
const cuentas = (await (await app.request('/admin/api/cuentas?yo=Laura', { headers: T })).json()) as { total: number; abiertos: number; calientes: number; mios: number };
const todas = lista.length;
check('cuántas fichas y cuántas abiertas (la vendida no cuenta como abierta)', cuentas.total === todas && cuentas.abiertos === todas - 1, JSON.stringify(cuentas));
check('«míos» son las que tiene quien mira, por su nombre', cuentas.mios === 1, JSON.stringify(cuentas));
const sinNombre = (await (await app.request('/admin/api/cuentas', { headers: T })).json()) as { mios: number };
check('sin nombre no hay «míos»', sinNombre.mios === 0);
const calientesALaMano = lista.filter((x) => (x as unknown as { score: number; stage: string }).score >= 60 && !['vendido', 'perdido'].includes((x as unknown as { stage: string }).stage)).length;
check('calientes: abiertos y con 60 o más, como en Hoy', cuentas.calientes === calientesALaMano, `${cuentas.calientes} vs ${calientesALaMano}`);
const tres = (await (await app.request('/admin/api/contacts?limit=3', { headers: T })).json()) as unknown[];
check('🪤 la lista respeta el límite que se le pide (antes se quedaba en 200 sin decirlo)', tres.length === 3, String(tres.length));

console.log('— Las notas de la historia');
const nota = async (id: string, cuerpo: unknown) => app.request(`/admin/api/contacts/${encodeURIComponent(id)}/notas`, { method: 'POST', headers: T, body: JSON.stringify(cuerpo) });
const r1 = await nota('web:cita', { texto: 'Decide la mamá; llamarla el jueves', por: 'Laura' });
const j1 = (await r1.json()) as { events: { id: number; type: string; payload: { texto?: string; por?: string } }[] };
const laNota = j1.events.find((e) => e.type === 'nota');
check('una nota se guarda con quién la escribió', r1.status === 201 && laNota?.payload.texto === 'Decide la mamá; llamarla el jueves' && laNota?.payload.por === 'Laura', JSON.stringify(j1).slice(0, 300));
await nota('web:cita', { texto: 'Pidió el azul en 44' });
check('dos notas son dos cosas que pasaron, no una que se corrige', listEvents('web:cita', 200).filter((e) => e.type === 'nota').length === 2);
check('sin nombre la firma el equipo', listEvents('web:cita', 200).some((e) => e.type === 'nota' && e.payload.por === 'el equipo'));
check('🪤 la nota fija de siempre no se toca', getContact('web:cita')!.notes === '');
check('una nota vacía no se guarda', (await nota('web:cita', { texto: '   ' })).status === 400);
check('una nota larguísima no se guarda', (await nota('web:cita', { texto: 'x'.repeat(2001) })).status === 400);
check('a una ficha que no existe, no', (await nota('web:nadie', { texto: 'hola' })).status === 404);
const borrar = (id: string, ev: number) => app.request(`/admin/api/contacts/${encodeURIComponent(id)}/notas/${ev}`, { method: 'DELETE', headers: T });
const otroEvento = listEvents('web:cita', 200).find((e) => e.type === 'appointment_booked' || e.type !== 'nota')!;
check('🪤 lo que pasó (una etapa, una cita) no se borra como si fuera una nota', !otroEvento || (await borrar('web:cita', otroEvento.id)).status === 404);
check('la nota de otra ficha no se borra desde esta', (await borrar('web:laura', laNota!.id)).status === 404);
check('una nota se borra', (await borrar('web:cita', laNota!.id)).status === 200 && listEvents('web:cita', 200).filter((e) => e.type === 'nota').length === 1);
const sinToken = await app.request(`/admin/api/contacts/web%3Acita/notas`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ texto: 'x' }) });
check('sin el token del tablero no se escribe nada', sinToken.status === 401, String(sinToken.status));

console.log('— Marcar todo como leído');
const r2 = (await (await app.request('/admin/api/contacts/leidas', { method: 'POST', headers: T })).json()) as { cuantas: number };
const quedan = (db.prepare('SELECT COUNT(*) n FROM users WHERE unread > 0').get() as { n: number }).n;
check('deja todo en cero y dice cuántas eran', r2.cuantas >= 12 && quedan === 0, `${r2.cuantas} · quedan ${quedan}`);

console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
