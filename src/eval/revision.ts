// Pruebas de lo que salió de la revisión de DUNOR (2026-10-23), sin modelo: pnpm test:revision
//
// Quien revisó XENCRM vio cinco cosas que tenía razón en ver: «undefined COP» en el catálogo, mensajes que no
// salieron y quedaban como enviados, una historia que decía «admin» en vez del nombre de quien hizo cada cosa, un
// embudo sin motivo de pérdida y un «Míos» que se vaciaba cuando el asistente volvía a contestar. Y pidió un XENCRM
// sencillo: el modo fácil, que esconde sin quitar. Cada bloque de aquí es una de esas cosas.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'xencrm-revision-')), 'xencrm.db');
process.env.ADMIN_TOKEN = 'token-del-tablero-de-prueba-0123456789';
const { business } = await import('../config.js');
const { touchUser, appendMessage, getMessages } = await import('../agent/memory.js');
const { getContact, listEvents, setHumanMode, setStage, esDe, updateContact } = await import('../crm/contacts.js');
const { registerSender, sendToContact, reintentarMensaje } = await import('../crm/outbox.js');
const { onEvent } = await import('../crm/events.js');
const { productToDoc } = await import('../rag/ingest.js');
const { getDb, productosConPrecioRoto, replaceDocs } = await import('../rag/store.js');
const { mergeContacts } = await import('../crm/merge.js');
const { Hono } = await import('hono');
const { mountAdmin } = await import('../channels/admin.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};

const app = new Hono();
mountAdmin(app as never);
const T = { 'x-admin-token': process.env.ADMIN_TOKEN!, 'content-type': 'application/json' };
const como = (quien?: string) => (quien ? { ...T, 'x-xencrm-quien': encodeURIComponent(quien) } : T);
const pedir = (ruta: string, init: { method?: string; body?: unknown; quien?: string } = {}) =>
  app.request(`/admin/api${ruta}`, { method: init.method ?? 'GET', headers: como(init.quien), body: init.body === undefined ? undefined : JSON.stringify(init.body) });
const ficha = (id: string, canal: string, nombre: string) => {
  touchUser(id, canal, nombre);
  appendMessage(id, 'user', 'hola, ¿tienen trajes para boda?', 'consulta');
};
// Por número y no por hora: dos cosas en el mismo milisegundo empatan en la hora.
const eventos = (id: string, tipo: string) => listEvents(id, 200).filter((e) => e.type === tipo).sort((a, b) => a.id - b.id);
const ultimo = (id: string, tipo: string) => eventos(id, tipo).at(-1)?.payload as Record<string, unknown> | undefined;

console.log('— «undefined COP»: un producto sin precio no dice «undefined»');
const sinPrecio = productToDoc({ id: 'd001', name: 'Alquiler premium de traje', description: 'Trajes de las mejores marcas', price: undefined as unknown as number, url: 'https://atelier-demo.example', specs: { Precio: 'se define en la cita' } });
check('🪤 la ficha de un producto sin precio no dice «undefined»', !/undefined/.test(sinPrecio.content), sinPrecio.content);
check('ni se inventa una línea de precio: lo dice su ficha técnica', !/^Precio:/m.test(sinPrecio.content) && /Ficha técnica: Precio: se define en la cita/.test(sinPrecio.content), sinPrecio.content);
check('y el buscador lo recibe sin precio (null), no como cero', (sinPrecio.meta as { price: unknown }).price === null);
const conPrecio = productToDoc({ id: 'p1', name: 'Corbata', description: '', price: 120000, url: '' });
check('con precio, la línea sale como siempre', /^Precio: 120000 COP$/m.test(conPrecio.content) && (conPrecio.meta as { price: unknown }).price === 120000, conPrecio.content);
check('cero sí es un precio (una muestra, un regalo)', /^Precio: 0 COP$/m.test(productToDoc({ id: 'p2', name: 'Muestra', description: '', price: 0, url: '' }).content));
check('un precio escrito con letras no es un precio', !/Precio:/.test(productToDoc({ id: 'p3', name: 'X', description: '', price: 'a convenir' as unknown as number, url: '' }).content));
const variantes = productToDoc({ id: 'p4', name: 'Traje', description: '', price: 1, url: '', variants: [{ title: 'Talla 40', price: 1 }, { title: 'Talla 42' }] });
check('una variante sin precio sale con su nombre, sin «undefined»', /Variantes: Talla 40: 1, Talla 42$/m.test(variantes.content), variantes.content);
replaceDocs('product', [{ ...sinPrecio, content: 'Traje\nPrecio: undefined COP', embedding: [1, 0] }, { ...conPrecio, embedding: [0, 1] }]);
check('al arrancar se sabe cuántas fichas quedaron con el precio roto', productosConPrecioRoto() === 1, String(productosConPrecioRoto()));
replaceDocs('product', [{ ...sinPrecio, embedding: [1, 0] }]);
check('y al reindexar quedan cero', productosConPrecioRoto() === 0);

console.log('— Un mensaje que no salió queda marcado, y se puede volver a mandar');
const estados: { id: unknown; fallo: unknown }[] = [];
onEvent((ev) => {
  if (ev.type === 'message_estado') estados.push(ev.payload as { id: unknown; fallo: unknown });
});
ficha('wa:573001110001@s.whatsapp.net', 'whatsapp', 'Juliana');
const juli = 'wa:573001110001@s.whatsapp.net';
const r0 = await sendToContact(juli, 'Te espero el sábado', 'human', { by: 'Laura' });
const m0 = getMessages(juli).find((m) => m.id === r0.id);
check('sin WhatsApp conectado, el mensaje queda en la conversación…', Boolean(m0) && m0!.content === 'Te espero el sábado');
check('🪤 …pero marcado como que no salió, y por qué', r0.fallo === 'WhatsApp no está conectado' && m0?.fallo === 'WhatsApp no está conectado', JSON.stringify(m0));
check('el tablero se entera en vivo', estados.some((e) => e.id === r0.id && e.fallo === 'WhatsApp no está conectado'), JSON.stringify(estados));
const enviados: string[] = [];
let rechazar = true;
registerSender('whatsapp', async (_u, text) => {
  if (rechazar) throw new Error('se cayó la conexión con WhatsApp');
  enviados.push(text);
});
let lanzo = '';
try {
  await sendToContact(juli, 'Y llévate los zapatos', 'human', { by: 'Laura' });
} catch (err) {
  lanzo = (err as Error).message;
}
const m1 = getMessages(juli).at(-1);
check('si el canal lo rechaza, quien lo mandó se entera (el error sube)', lanzo === 'se cayó la conexión con WhatsApp', lanzo);
check('🪤 y el mensaje queda con ese motivo', m1?.content === 'Y llévate los zapatos' && m1?.fallo === 'se cayó la conexión con WhatsApp', JSON.stringify(m1));
const otraVez = await reintentarMensaje(juli, m1!.id);
check('reintentar mientras sigue caído dice el error de nuevo', !otraVez.ok && otraVez.error === 'se cayó la conexión con WhatsApp' && enviados.length === 0, JSON.stringify(otraVez));
rechazar = false;
const cuantosAntes = getMessages(juli).length;
const bien = await reintentarMensaje(juli, m1!.id);
check('con el canal de vuelta, sale', bien.ok && enviados.length === 1, JSON.stringify(bien));
check('firmado como cualquier mensaje del equipo', enviados[0] === `*${business.crm.firmaHumano}:* Y llévate los zapatos`, enviados[0]);
check('🪤 es el MISMO mensaje: no aparece dos veces en la conversación', getMessages(juli).length === cuantosAntes);
check('y se le quita la marca', getMessages(juli).find((m) => m.id === m1!.id)?.fallo === null);
check('reintentar uno que ya salió no lo manda dos veces', (await reintentarMensaje(juli, m1!.id)).ok && enviados.length === 1);
check('lo que escribió el cliente no se reintenta', !(await reintentarMensaje(juli, getMessages(juli)[0]!.id)).ok);
check('un mensaje de otra conversación, tampoco', !(await reintentarMensaje('web:otra', m1!.id)).ok);
const r2 = await sendToContact(juli, 'Listo', 'human', { by: 'Laura' });
check('lo que sale bien no lleva marca', r2.fallo === null && getMessages(juli).at(-1)?.fallo === null);
rechazar = true;
const porElTablero = await pedir(`/contacts/${encodeURIComponent(juli)}/reply`, { method: 'POST', body: { text: 'Hola de nuevo', by: 'Laura' } });
const porQue = (await porElTablero.json()) as { error?: string };
check('responder desde el tablero, si no sale, lo dice y dice que quedó marcado', porElTablero.status === 500 && /quedó marcado/i.test(porQue.error ?? ''), JSON.stringify(porQue));
rechazar = false;
const idFallido = getMessages(juli).at(-1)!.id;
const reintento = await pedir(`/contacts/${encodeURIComponent(juli)}/mensajes/${idFallido}/reintentar`, { method: 'POST' });
check('y desde el tablero se vuelve a intentar', reintento.status === 200 && getMessages(juli).at(-1)?.fallo === null, String(reintento.status));

console.log('— La historia dice quién hizo cada cosa');
ficha('web:bryan1', 'web', 'Camilo');
const cami = 'web:bryan1';
await pedir(`/contacts/${cami}`, { method: 'PATCH', body: { stage: 'interesado' }, quien: 'Bryan' });
check('🪤 cambiar la etapa queda con el nombre de quien lo hizo, no «admin»', ultimo(cami, 'stage')?.by === 'Bryan', JSON.stringify(ultimo(cami, 'stage')));
await pedir(`/contacts/${cami}`, { method: 'PATCH', body: { stage: 'conversando' }, quien: 'Andrés Núñez' });
check('un nombre con tildes llega entero', ultimo(cami, 'stage')?.by === 'Andrés Núñez', JSON.stringify(ultimo(cami, 'stage')));
await pedir(`/contacts/${cami}`, { method: 'PATCH', body: { stage: 'interesado' } });
check('sin nadie que lo diga, «equipo» (que se pinta «El equipo»)', ultimo(cami, 'stage')?.by === 'equipo');
await pedir(`/contacts/${cami}`, { method: 'PATCH', body: { name: 'Camilo Rojas', phone: '3001234567', notes: '', tags: [] }, quien: 'Laura' });
const editado = ultimo(cami, 'editado');
check('corregir datos deja quién y cuáles', editado?.by === 'Laura' && JSON.stringify(editado?.campos) === '["nombre","teléfono"]', JSON.stringify(editado));
const cuantosEditados = eventos(cami, 'editado').length;
await pedir(`/contacts/${cami}`, { method: 'PATCH', body: { name: 'Camilo Rojas', phone: '3001234567' }, quien: 'Laura' });
check('guardar sin cambiar nada no deja rastro', eventos(cami, 'editado').length === cuantosEditados);
await pedir(`/contacts/${cami}`, { method: 'PATCH', body: { data: { valor: 850000 } }, quien: 'Laura' });
check('poner el valor a mano también', JSON.stringify(ultimo(cami, 'editado')?.campos) === '["valor"]', JSON.stringify(ultimo(cami, 'editado')));
const nota = (await (await pedir(`/contacts/${cami}/notas`, { method: 'POST', body: { texto: 'Decide la novia', por: 'Alguien Más' }, quien: 'Laura' })).json()) as { events: { id: number; type: string; payload: { por?: string } }[] };
const laNota = nota.events.find((e) => e.type === 'nota');
check('🪤 la nota la firma la cuenta, no lo que mande el navegador', laNota?.payload.por === 'Laura', JSON.stringify(laNota));
await pedir(`/contacts/${cami}/notas/${laNota!.id}`, { method: 'DELETE', quien: 'Bryan' });
check('borrar una nota deja que alguien la borró, y quién', ultimo(cami, 'nota_borrada')?.by === 'Bryan' && eventos(cami, 'nota').length === 0);
await pedir(`/contacts/${cami}/archive`, { method: 'POST', body: { on: true }, quien: 'Bryan' });
check('archivar también', ultimo(cami, 'archivada')?.by === 'Bryan');
await pedir(`/contacts/${cami}/archive`, { method: 'POST', body: { on: false }, quien: 'Bryan' });

console.log('— A cargo: de quién es el cliente, aunque hoy lo atienda el asistente');
ficha('web:resp1', 'web', 'Valentina');
const vale = 'web:resp1';
check('una ficha nueva no es de nadie', getContact(vale)?.responsable === null);
setHumanMode(vale, true, 'Laura');
check('quien toma la conversación queda a cargo', getContact(vale)?.responsable === 'Laura');
setHumanMode(vale, false, 'bot');
check('🪤 y sigue a cargo cuando vuelve a contestar el asistente', getContact(vale)?.responsable === 'Laura' && getContact(vale)?.humanBy === null);
setHumanMode(vale, true, 'Pedro');
check('🪤 si una compañera ayuda un día, el cliente sigue siendo de quien era', getContact(vale)?.responsable === 'Laura');
ficha('web:toma', 'web', 'Paula');
await pedir('/contacts/web:toma/human', { method: 'POST', body: { on: true }, quien: 'Laura' });
check('🪤 apretar «Tú» la toma quien la aprieta, con su nombre (no «admin»)', getContact('web:toma')?.humanBy === 'Laura' && getContact('web:toma')?.responsable === 'Laura', JSON.stringify(getContact('web:toma')));
ficha('web:toma2', 'web', 'Elena');
// Si la última palabra fuera del cliente, el paso sería «Contestar». Un instante después, para no empatar en la hora.
await new Promise((listo) => setTimeout(listo, 5));
appendMessage('web:toma2', 'assistant', 'Claro, ya te paso con alguien del equipo.');
await pedir('/contacts/web:toma2/human', { method: 'POST', body: { on: true } });
check('con el token a secas y sin nombre, como antes: «admin», sin nadie a cargo', getContact('web:toma2')?.humanBy === 'admin' && getContact('web:toma2')?.responsable === null);
const { proximoPaso, contextoDelPaso } = await import('../crm/proximo.js');
check('y la ficha no dice «admin está atendiendo»', proximoPaso(getContact('web:toma2')!, contextoDelPaso()).texto === 'El equipo está atendiendo', proximoPaso(getContact('web:toma2')!, contextoDelPaso()).texto);
ficha('web:toma3', 'web', 'Rosa');
await pedir('/contacts/web:toma3/human', { method: 'POST', body: { on: true }, quien: 'Llave maestra' });
check('quien entra con la llave maestra la atiende, pero no queda a cargo', getContact('web:toma3')?.humanBy === 'Llave maestra' && getContact('web:toma3')?.responsable === null);
ficha('web:resp2', 'web', 'Sofía');
setHumanMode('web:resp2', true, 'bot');
setHumanMode('web:resp2', true, 'admin');
check('el asistente o el token a secas no quedan a cargo de nadie', getContact('web:resp2')?.responsable === null);
await pedir(`/contacts/${vale}/human`, { method: 'POST', body: { on: true, a: 'Pedro' }, quien: 'Bryan' });
check('entregársela a alguien lo deja a cargo', getContact(vale)?.responsable === 'Pedro');
check('y queda quién se la entregó', ultimo(vale, 'entregada')?.a === 'Pedro' && ultimo(vale, 'entregada')?.by === 'Bryan', JSON.stringify(ultimo(vale, 'entregada')));
check('el cambio de responsable, con de quién a quién', ultimo(vale, 'responsable')?.de === 'Laura' && ultimo(vale, 'responsable')?.a === 'Pedro', JSON.stringify(ultimo(vale, 'responsable')));
await pedir(`/contacts/${vale}`, { method: 'PATCH', body: { responsable: 'Laura' }, quien: 'Bryan' });
check('desde la ficha se cambia a mano', getContact(vale)?.responsable === 'Laura' && ultimo(vale, 'responsable')?.by === 'Bryan');
const nResp = eventos(vale, 'responsable').length;
await pedir(`/contacts/${vale}`, { method: 'PATCH', body: { responsable: 'Laura' }, quien: 'Bryan' });
check('dejarlo igual no ensucia la historia', eventos(vale, 'responsable').length === nResp);
setHumanMode(vale, false, 'bot');
const cuentas = (await (await pedir('/cuentas?yo=laura')).json()) as { mios: number };
// Las de Laura: Valentina (a cargo, la atiende el asistente), Juliana (le contestó desde el tablero) y Paula (la tomó).
check('🪤 «Míos» cuenta lo que está a cargo de uno aunque lo atienda el asistente', cuentas.mios === 3, JSON.stringify(cuentas));
check('esDe no distingue mayúsculas ni espacios', esDe(getContact(vale)!, '  LAURA ') && !esDe(getContact(vale)!, 'Pedro') && !esDe(getContact(vale)!, ''));
check('quien la atiende ahora también la ve en «Míos»', esDe({ responsable: null, humanMode: true, humanBy: 'Pedro' }, 'pedro'));
await pedir(`/contacts/${vale}`, { method: 'PATCH', body: { responsable: null }, quien: 'Laura' });
check('y se puede dejar sin nadie', getContact(vale)?.responsable === null && ultimo(vale, 'responsable')?.a === null);
ficha('web:dup', 'web', 'Martín');
ficha('wa:573009998877@s.whatsapp.net', 'whatsapp', 'Martín');
updateContact('web:dup', { phone: '3009998877' });
setHumanMode('web:dup', true, 'Laura');
setHumanMode('web:dup', false, 'bot');
const unida = mergeContacts('wa:573009998877@s.whatsapp.net', 'web:dup', 'Bryan');
check('al unir dos fichas, quien estaba a cargo sigue a cargo', unida.responsable === 'Laura', String(unida.responsable));
check('y la unión dice quién la hizo', ultimo(unida.id, 'contacts_merged')?.by === 'Bryan');

console.log('— Agendar desde el tablero sigue pudiendo caer encima de un evento del dueño');
// 🪤 Eso se decidía mirando si quien agendaba era «admin». Desde que el tablero firma con el nombre de la persona,
// esa pregunta daba siempre que no, y la cita chocaba con el calendario del dueño.
{
  const { env } = await import('../config.js');
  const { tzParts, zoned, bookAppointment } = await import('../crm/appointments.js');
  const { syncBusy } = await import('../crm/busy.js');
  const citas = business.appointments;
  let dia = new Date(Date.now() + 3 * 86400_000);
  while (!citas.days.includes(tzParts(dia).wd)) dia = new Date(dia.getTime() + 86400_000);
  const p = tzParts(dia);
  const [hh, mm] = citas.hours[0]![0].split(':').map(Number) as [number, number];
  const ocupado = zoned(p.y, p.m, p.d, hh, mm);
  const utc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:dueno-revision', `DTSTART:${utc(ocupado)}`, `DTEND:${utc(new Date(ocupado.getTime() + citas.durationMin * 60_000))}`, 'SUMMARY:Médico', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  env.calendarBusyIcs.push(`data:text/calendar;base64,${Buffer.from(ics).toString('base64')}`);
  await syncBusy();
  ficha('web:agenda', 'web', 'Felipe');
  let choca = '';
  try {
    bookAppointment('web:agenda', ocupado, { by: 'Bryan' });
  } catch (err) {
    choca = (err as Error).message;
  }
  check('fuera del tablero no se agenda encima de un evento del dueño', /no está disponible/.test(choca), choca || 'la agendó');
  const r = await pedir('/appointments', { method: 'POST', body: { userId: 'web:agenda', startsAt: ocupado.toISOString() }, quien: 'Bryan' });
  check('🪤 desde el tablero sí, aunque la cita la firme Bryan y no «admin»', r.status === 200, `${r.status} ${await r.text()}`);
  check('y la historia dice quién la agendó', ultimo('web:agenda', 'appointment_booked')?.by === 'Bryan', JSON.stringify(ultimo('web:agenda', 'appointment_booked')));
}

console.log('— Por qué se perdió');
ficha('web:perdida', 'web', 'Daniela');
const dani = 'web:perdida';
check('los motivos son del negocio y vienen con unos de fábrica', business.crm.motivosPerdida.length >= 3 && business.crm.motivosPerdida.includes('Precio'));
const stats = (await (await pedir('/stats')).json()) as { motivosPerdida: string[]; modo: string };
check('el tablero los recibe con lo demás', JSON.stringify(stats.motivosPerdida) === JSON.stringify(business.crm.motivosPerdida));
await pedir(`/contacts/${dani}`, { method: 'PATCH', body: { stage: 'perdido', motivo: 'Compró en otro lado' }, quien: 'Laura' });
check('pasarla a perdido con motivo lo guarda en la ficha', getContact(dani)?.stage === 'perdido' && getContact(dani)?.data.motivo_perdida === 'Compró en otro lado');
check('y en la historia, con el cambio de etapa', ultimo(dani, 'stage')?.motivo === 'Compró en otro lado' && ultimo(dani, 'stage')?.by === 'Laura');
await pedir(`/contacts/${dani}`, { method: 'PATCH', body: { stage: 'perdido', motivo: 'Precio' }, quien: 'Bryan' });
check('decirlo después (o corregirlo) desde la ficha', getContact(dani)?.data.motivo_perdida === 'Precio' && ultimo(dani, 'motivo_perdida')?.motivo === 'Precio' && ultimo(dani, 'motivo_perdida')?.by === 'Bryan');
await pedir(`/contacts/${dani}`, { method: 'PATCH', body: { stage: 'interesado' } });
check('🪤 si vuelve, el motivo se quita de la ficha (ya no es verdad)…', !('motivo_perdida' in (getContact(dani)?.data ?? {})));
check('…y en la historia se queda, que es lo que pasó', eventos(dani, 'stage').some((e) => e.payload.motivo === 'Compró en otro lado'));
await pedir(`/contacts/${dani}`, { method: 'PATCH', body: { stage: 'vendido', motivo: 'Precio' } });
check('un motivo solo vale para perdido', !('motivo_perdida' in (getContact(dani)?.data ?? {})) && !ultimo(dani, 'stage')?.motivo);
setStage(dani, 'perdido', { by: 'bot' });
check('el asistente puede perderla sin decir por qué', getContact(dani)?.stage === 'perdido' && !('motivo_perdida' in (getContact(dani)?.data ?? {})));
ficha('web:perdida2', 'web', 'Tomás');
await pedir('/contacts/web:perdida2', { method: 'PATCH', body: { stage: 'perdido', motivo: 'Precio' } });
ficha('web:perdida3', 'web', 'Lucía');
await pedir('/contacts/web:perdida3', { method: 'PATCH', body: { stage: 'perdido', motivo: 'La fecha no le servía' } });
const ventas = (await (await pedir('/ventas?days=30')).json()) as { perdidas: { cuantas: number; sinMotivo: number; motivos: { motivo: string; n: number }[] } };
check('Ventas cuenta las perdidas del periodo, y por qué', ventas.perdidas.cuantas === 3 && JSON.stringify(ventas.perdidas.motivos) === '[{"motivo":"La fecha no le servía","n":1},{"motivo":"Precio","n":1}]', JSON.stringify(ventas.perdidas));
ficha('web:perdida4', 'web', 'Nicolás');
await pedir('/contacts/web:perdida4', { method: 'PATCH', body: { stage: 'perdido', motivo: 'Precio' } });
const ventas2 = (await (await pedir('/ventas?days=30')).json()) as typeof ventas;
check('el motivo más repetido va primero', ventas2.perdidas.motivos[0]?.motivo === 'Precio' && ventas2.perdidas.motivos[0]?.n === 2, JSON.stringify(ventas2.perdidas));
check('🪤 las que no dicen por qué se cuentan aparte, a la vista', ventas.perdidas.sinMotivo === 1, JSON.stringify(ventas.perdidas));

console.log('— El modo del tablero es de cada cliente');
check('sin decir nada, completo (como estaba)', stats.modo === 'completo');
const puesto = await pedir('/tablero/modo', { method: 'PUT', body: { modo: 'facil' } });
check('quien administra lo pone en fácil', puesto.status === 200 && ((await (await pedir('/stats')).json()) as { modo: string }).modo === 'facil');
check('un modo que no existe se rechaza', (await pedir('/tablero/modo', { method: 'PUT', body: { modo: 'turbo' } })).status === 400);
check('y queda guardado en su base, no en un archivo que el despliegue pisa', (getDb().prepare("SELECT value FROM settings WHERE key = 'tablero.modo'").get() as { value: string }).value === '"facil"');

console.log('— El tablero (código fuente)');
const html = readFileSync(new URL('../../public/admin.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../../public/admin.js', import.meta.url), 'utf8');
check('🪤 el modo fácil esconde con CSS lo marcado, no lo borra', /:root\[data-modo="facil"\] \.solo-completo\{display:none!important\}/.test(html));
const riel = html.slice(html.indexOf('<nav class="nav">'), html.indexOf('</nav>', html.indexOf('<nav class="nav">')));
const delRiel = (vista: string) => riel.match(new RegExp(`<button[^>]*data-view="${vista}"[^>]*>`))?.[0] ?? '';
// 🪤 2026-11-04: el modo fácil ya no usa este riel —tiene el menú de Nexora (ver eval/facil.ts)—, pero Análisis sigue
// marcado: quien vea el completo con el menú viejo no lo pierde, y el fácil no lo enseña desde aquí.
check('Análisis no va en el riel del modo fácil', /solo-completo/.test(delRiel('analysis')));
check('🪤 lo del día a día sí: Hoy, Conversaciones, Calendario y Clientes', ['today', 'inbox', 'calendar', 'clientes'].every((v) => delRiel(v) && !/solo-completo/.test(delRiel(v))));
check('Seguimientos, El asistente y Trazabilidad se esconden', /view: 'seguimientos', lbl: 'Seguimientos', soloCompleto: true/.test(js) && /view: 'agent'[^}]*soloCompleto: true/.test(js) && /view: 'trazas'[^}]*soloCompleto: true/.test(js));
check('Perfil, Lo que sabe, Canales y la guía, no', ['profile', 'knowledge', 'channels', 'guia'].every((v) => new RegExp(`view: '${v}'`).test(js) && !new RegExp(`view: '${v}'[^}]*soloCompleto`).test(js)));
check('el puntaje y su porqué se esconden; la etapa y quién está a cargo, no',
  /fila\('¿Prospecto\?'[\s\S]*?'solo-completo'\)/.test(js) && /perfil-por solo-completo/.test(js) && /fila\('Etapa', '<select id="f-etapa"[^\n]*motivoHtml\(c, 'f-motivo'\)\)/.test(js) && /fila\('Asignado a', responsableHtml\(c, 'f-resp'\)\)/.test(js));
check('el «¿por qué?» de cada respuesta, también', /class="por-que solo-completo"/.test(js));
check('🪤 el puntaje de la cabecera de la conversación también (su clase se reescribe al pintar)', /\$\('chat-temp'\)\.className = 'meta-line solo-completo'/.test(js) && /id="chat-temp"/.test(html));
check('de las pastillas de puntaje queda solo «caliente»', /c\.temperature === 'caliente' \? '' : ' solo-completo'/.test(js));
// Desde el 2026-11-03 los dos son solo de quien administra xencrm: es el candado (ver eval/candado.ts).
check('hay un interruptor para uno y otro para todo el equipo (los dos, solo para quien administra XENCRM)', /proxy: 'modo-btn'[^}]*modo: 'yo'[^}]*soloSuper: true/.test(js) && /proxy: 'modo-equipo-btn'[^}]*soloSuper: true[^}]*modo: 'equipo'/.test(js) && /id="modo-btn"/.test(html) && /id="modo-equipo-btn"/.test(html));
check('y en el celular también se llega', /data-proxy="modo-btn"/.test(html));
check('🪤 en el modo fácil Hoy enseña solo lo que tiene algo, y cómo ver todo', /facil \? sections\.filter\(function \(s\) \{ return s\.n > 0; \}\)/.test(js) && /id="hoy-ver-todo"/.test(js));
const deHoy = js.slice(js.indexOf('function loadToday()'), js.indexOf("var TONOS"));
// Un título puede venir del vocabulario del negocio (VOC.Citas + ' de hoy'): también cuenta.
const secciones = (deHoy.match(/\{ t: (?:'|VOC\.)/g) || []).length;
const tonos = ((js.match(/var TONOS = \[([^\]]*)\]/)?.[1] ?? '').match(/'[a-z]+'/g) || []).length;
check('🪤 cada recuadro de Hoy tiene su color (antes los grupos corrían a todos los demás un puesto)', secciones > 0 && secciones === tonos, `${secciones} recuadros y ${tonos} colores`);
check('el tablero manda quién es en cada llamada', /headers\['x-xencrm-quien'\] = encodeURIComponent\(state\.name\)/.test(js));
check('🪤 si no salió pero quedó guardado, el cajón se vacía: si no, el cliente lo recibiría dos veces', /if \(r\.fallo\) \{ \$\('reply'\)\.value = ''; quitarAdjunto\(\); \}/.test(js));
check('🪤 todo cambio de etapa pasa por la pregunta de por qué se perdió', (js.match(/method: 'PATCH', body: \{ stage:/g) || []).length === 1 && (js.match(/cambiarEtapa\(c, /g) || []).length >= 4,
  'el único PATCH de etapa directo debe ser el de «¿Cómo les fue? → vendido»');
check('«Míos» del tablero sigue la misma regla que el servidor', /function esMia\(c\) \{ return Boolean\(state\.name\) && \(mismoNombre\(c\.responsable, state\.name\) \|\| \(Boolean\(c\.humanMode\) && mismoNombre\(c\.humanBy, state\.name\)\)\); \}/.test(js));
const nuevos = ['editado', 'responsable', 'entregada', 'nota_borrada', 'motivo_perdida'];
check('🪤 la historia sabe nombrar cada cosa nueva que se anota (lo que no sabe nombrar, no lo enseña)', nuevos.every((t) => js.includes(`case '${t}':`)), nuevos.filter((t) => !js.includes(`case '${t}':`)).join(', '));

// La burbuja, armada como en el tablero: lo que no salió se dice en el mensaje, con cómo volver a mandarlo.
const trozo = (re: RegExp) => js.match(re)?.[0] ?? '';
const burbuja = new Function(`${trozo(/function esc\(s\)[\s\S]*?\n  \}/)}\nfunction hhmm(){return '00:00'}\nvar state = {};\nfunction esAdmin(){return true}\n${trozo(/function adjunto\(m\)[\s\S]*?\n  \}/)}\n${trozo(/function bubble\(msg\)[\s\S]*?\n  \}/)}\nreturn bubble;`)() as (m: Record<string, unknown>) => string;
const fallida = burbuja({ id: 7, role: 'assistant', author: 'human', by: 'Laura', content: 'Te espero', ts: 0, fallo: 'WhatsApp no está conectado' });
check('un mensaje que no salió lo dice, con el motivo y el botón', /class="bubble human fallo"/.test(fallida) && /No le llegó/.test(fallida) && /WhatsApp no está conectado/.test(fallida) && /data-reintentar="7"/.test(fallida), fallida);
check('uno que salió, no', !/No le llegó|fallo/.test(burbuja({ id: 8, role: 'assistant', author: 'human', by: 'Laura', content: 'Listo', ts: 0, fallo: null })));
check('el motivo se escapa como todo lo demás', !/<img/.test(burbuja({ id: 9, role: 'assistant', author: 'human', content: 'x', ts: 0, fallo: '<img src=x onerror=robar()>' })));

console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
