// Pruebas del recordatorio del día antes (sin modelo): pnpm test:reminders
// Cuándo se envía, por qué canal, qué queda a mano y cómo se entiende la respuesta del cliente.
// Usa una base temporal: el recordatorio revisa TODAS las citas y no debe tocar las reales.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'aiva-rem-')), 'aiva.db');
const { business } = await import('../config.js');
const { touchUser, appendMessage } = await import('../agent/memory.js');
const { getContact, updateContact, setHumanMode } = await import('../crm/contacts.js');
const { getAppointment, tzParts, zoned, formatSlot } = await import('../crm/appointments.js');
const { registerSender, registerTemplateSender } = await import('../crm/outbox.js');
const { reminderTime, runReminders, remindersBoard } = await import('../crm/reminders.js');
const { bookingStep } = await import('../crm/booking.js');
const { getDb } = await import('../rag/store.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};
const HOUR = 3600_000;
business.appointments.enabled = true;
business.appointments.reminder.enabled = true;
business.appointments.reminder.at = '08:00';
// 🪤 El negocio de esta prueba abre TODOS los días, a propósito. Antes heredaba los días laborales de verdad y
// el resultado dependía del día en que se corriera: un sábado, la cita de «pasado mañana» caía en lunes, el
// recordatorio se iba al domingo cerrado y la prueba fallaba sola, sin que nadie hubiera tocado nada. Los días
// cerrados se prueban aparte, con fechas fijas.
business.appointments.days = [0, 1, 2, 3, 4, 5, 6];

// Cita pasado mañana a las 10:00 (hora del negocio): se recuerda ESE MISMO día a las 8 de la mañana.
const p = tzParts(new Date(Date.now() + 2 * 24 * HOUR));
const T = zoned(p.y, p.m, p.d, 10, 0).getTime();
const remindAt = reminderTime(T);
const before = tzParts(new Date(remindAt));
check('🪤 se recuerda la mañana de la cita, no la tarde anterior', before.hh === 8 && before.mm === 0 && T - remindAt === 2 * HOUR, new Date(remindAt).toISOString());
check('y el mismo día que la cita', before.d === p.d && before.m === p.m, `${before.d}/${before.m} vs ${p.d}/${p.m}`);

// Si a esa hora la cita ya pasó, se va hacia atrás: nunca después.
const temprano = zoned(p.y, p.m, p.d, 8, 30).getTime();
check('una cita muy temprano se recuerda el día antes', reminderTime(temprano) < zoned(p.y, p.m, p.d, 0, 0).getTime(), new Date(reminderTime(temprano)).toISOString());

// 🪤 El caso que lo empezó todo: cita el lunes, y el domingo el negocio está cerrado. Fechas fijas para que no
// dependa de cuándo se corra. Lunes 5 de octubre de 2026 a las 11:00.
const soloEntreSemana = [1, 2, 3, 4, 5, 6];
const lunes = zoned(2026, 10, 5, 11, 0).getTime();
business.appointments.days = soloEntreSemana;
const conDomingoCerrado = tzParts(new Date(reminderTime(lunes)));
check('🪤 la cita del lunes NO se recuerda el domingo cerrado', conDomingoCerrado.wd !== 0, `cayó en el día ${conDomingoCerrado.wd}`);
check('se recuerda el lunes por la mañana', conDomingoCerrado.d === 5 && conDomingoCerrado.hh === 8, `${conDomingoCerrado.d} a las ${conDomingoCerrado.hh}`);
business.appointments.days = [0, 1, 2, 3, 4, 5, 6];

const make = (userId: string, channel: string, opts: { name?: string; phone?: string; createdAgoH?: number; status?: string } = {}) => {
  touchUser(userId, channel, opts.name ?? null);
  updateContact(userId, { name: opts.name ?? null, phone: opts.phone ?? null }, { silent: true });
  appendMessage(userId, 'user', 'quiero una cita', 'cita');
  const r = getDb()
    .prepare('INSERT INTO appointments (user_id, starts_at, ends_at, service, location, status, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(userId, T, T + 45 * 60_000, 'cita de prueba', 'la tienda', opts.status ?? 'confirmada', '', remindAt - (opts.createdAgoH ?? 48) * HOUR);
  return Number(r.lastInsertRowid);
};
const wa = make('wa:573001112233@s.whatsapp.net', 'whatsapp', { name: 'Laura Pérez' });
const waCant = make('wa:573002223344@s.whatsapp.net', 'whatsapp', { name: 'Pedro' });
const waMove = make('wa:573003334455@s.whatsapp.net', 'whatsapp', { name: 'Ana' });
const webPhone = make('web:rem-phone', 'web', { name: 'Marta', phone: '+57 300 444 5566' });
const webNoPhone = make('web:rem-nophone', 'web', { name: 'Sin Número' });
const human = make('wa:573005556677@s.whatsapp.net', 'whatsapp', { name: 'Con Asesor' });
setHumanMode('wa:573005556677@s.whatsapp.net', true, 'Laura del equipo');
// Pidió una persona: el traspaso lo hizo el asistente, y eso se guarda como «bot».
const pidioPersona = make('wa:573009990011@s.whatsapp.net', 'whatsapp', { name: 'Pidió Persona' });
setHumanMode('wa:573009990011@s.whatsapp.net', true, 'bot');
const late = make('wa:573006667788@s.whatsapp.net', 'whatsapp', { name: 'Recién', createdAgoH: 1 });
const cancelled = make('wa:573007778899@s.whatsapp.net', 'whatsapp', { name: 'Canceló', status: 'cancelada' });
const metaOld = make('meta:573008889900', 'meta', { name: 'Meta Viejo' });
getDb().prepare("UPDATE messages SET ts = ? WHERE user_id = 'meta:573008889900'").run(remindAt - 30 * HOUR);

// 1. Antes de la hora no pasa nada; WhatsApp sin conectar no se da por enviado
check('antes de la hora no se envía nada', (await runReminders(remindAt - HOUR)).sent === 0 && !getAppointment(wa)!.reminder);

// 2. A la hora: WhatsApp conectado envía; lo demás queda a mano con el motivo
const sent: { userId: string; text: string }[] = [];
registerSender('whatsapp', async (userId, text) => void sent.push({ userId, text }));
const r = await runReminders(remindAt + 5 * 60_000);
const toLaura = sent.find((s) => s.userId === 'wa:573001112233@s.whatsapp.net');
// 🪤 Dice «de hoy», no la fecha larga: el recordatorio llega la mañana de la cita, y «tu cita del lunes 5 de
// octubre» leído el propio lunes obliga a mirar el calendario para entender un mensaje que debería ser obvio.
check('por WhatsApp: le llega con su nombre y dice que es HOY', Boolean(toLaura && /Hola, Laura 🙂 Te recordamos tu cita de prueba de hoy, 10:00/.test(toLaura.text) && /¿Nos confirmas que vienes\?/.test(toLaura.text)), toLaura?.text);
// Por WhatsApp el cliente ve siempre el mismo número y contestan el asistente y las personas del equipo, así
// que todo lo que sale va firmado con quién lo manda. Aquí lo manda el asistente.
check('y firmado por el asistente, no por una persona', Boolean(toLaura && toLaura.text.startsWith('*Aiva:*')), toLaura?.text);
check('queda marcado como enviado', getAppointment(wa)!.reminder?.status === 'enviado');
check('chat del sitio con número: a mano, con el número para WhatsApp', getAppointment(webPhone)!.reminder?.status === 'a_mano' && /por WhatsApp/.test(getAppointment(webPhone)!.reminder?.note ?? ''));
check('chat del sitio sin número: a mano y dice por qué', /no dejó número/.test(getAppointment(webNoPhone)!.reminder?.note ?? ''));
check('si la conversación la lleva una persona, a mano', getAppointment(human)!.reminder?.status === 'a_mano' && /Laura del equipo/.test(getAppointment(human)!.reminder?.note ?? ''));
check('🪤 si el traspaso lo hizo el asistente, no dice «la lleva bot»', getAppointment(pidioPersona)!.reminder?.status === 'a_mano' && /la lleva alguien del equipo/.test(getAppointment(pidioPersona)!.reminder?.note ?? '') && !/lleva bot/.test(getAppointment(pidioPersona)!.reminder?.note ?? ''), getAppointment(pidioPersona)!.reminder?.note ?? '');
check('agendó hace poco: no hace falta', getAppointment(late)!.reminder?.status === 'no_hace_falta');
check('una cita cancelada no se recuerda', !getAppointment(cancelled)!.reminder && !sent.some((s) => s.userId === 'wa:573007778899@s.whatsapp.net'));
check('WhatsApp oficial sin el emisor conectado: a mano', getAppointment(metaOld)!.reminder?.status === 'a_mano' && /no está conectado/.test(getAppointment(metaOld)!.reminder?.note ?? ''), getAppointment(metaOld)!.reminder?.note ?? '');
check('se enviaron 3 (los de WhatsApp) y quedaron 5 a mano', r.sent === 3 && r.manual === 5, JSON.stringify(r));
check('otra pasada no repite nada', (await runReminders(remindAt + 10 * 60_000)).sent === 0 && sent.length === 3);
const board = remindersBoard(remindAt + 5 * 60_000);
const marta = board.find((a) => a.id === webPhone);
check('Hoy muestra el texto y el número para escribirle a mano', marta?.number === '573004445566' && /Hola, Marta/.test(marta.text), JSON.stringify(marta));

// 3. WhatsApp oficial: fuera de las 24 h solo con plantilla aprobada
const metaT = make('meta:573009990011', 'meta', { name: 'Sofía Gómez' });
getDb().prepare("UPDATE messages SET ts = ? WHERE user_id = 'meta:573009990011'").run(remindAt - 30 * HOUR);
registerSender('meta', async () => undefined);
const templates: { userId: string; name: string; params: string[] }[] = [];
registerTemplateSender('meta', async (userId, t) => void templates.push({ userId, name: t.name, params: t.params }));
business.appointments.reminder.metaTemplate = { name: 'recordatorio_cita', language: 'es' };
getDb().prepare('UPDATE appointments SET reminder_status = NULL WHERE id = ?').run(metaOld);
await runReminders(remindAt + 15 * 60_000);
const tpl = templates.find((t) => t.userId === 'meta:573009990011');
check('fuera de las 24 h va la plantilla con nombre y fecha', tpl?.name === 'recordatorio_cita' && tpl.params[0] === 'Sofía' && tpl.params[1] === formatSlot(new Date(T)), JSON.stringify(tpl));
check('y en la conversación queda el texto', getAppointment(metaT)!.reminder?.status === 'enviado');

// 4. La respuesta del cliente
const say = (userId: string, text: string) => bookingStep(userId, text);
const yes = await say('wa:573001112233@s.whatsapp.net', 'Sí, ahí estaré');
check('"sí, ahí estaré" confirma la asistencia', /^¡Perfecto! Te esperamos/.test(yes ?? '') && getAppointment(wa)!.reply === 'confirmó', yes ?? '(sin respuesta)');
check('y cierra el flujo', !getContact('wa:573001112233@s.whatsapp.net')!.data.booking);
const cant = await say('wa:573002223344@s.whatsapp.net', 'uy no puedo, se me complicó');
check('"no puedo" pregunta si la pasamos o la cancela', /pasamos para otro día o prefieres cancelarla/.test(cant ?? '') && getAppointment(waCant)!.reply === 'no_puede', cant ?? '');
// 🪤 «Cancélala» aquí cancela de UNA, sin «¿confirmas?» y sin preguntarle qué pasó. Ya dijo que no podía, ya se
// le ofreció moverla, y acaba de escoger entre las dos opciones que le dimos: cualquier paso más es fricción
// puesta a propósito en el camino de salida, que es justo lo que no se debe hacer. Ver crm/retener.ts.
const cancel = await say('wa:573002223344@s.whatsapp.net', 'cancélala');
check('"cancélala" la cancela de una, sin más vueltas', /cancel[eé]/.test(cancel ?? '') && getAppointment(waCant)!.status === 'cancelada', String(cancel));
check('y no le vuelve a preguntar por qué', !/pas[oó] algo|ya no est[aá]s tan seguro|Confirmas/.test(cancel ?? ''), String(cancel));
const move = await say('wa:573003334455@s.whatsapp.net', 'mejor el jueves en la tarde');
check('"mejor el jueves en la tarde" busca otro espacio', /busquemos otro espacio/.test(move ?? ''), move ?? '');

console.log(`\n${fail ? `${fail} fallos` : 'todo ok'}`);
process.exit(fail ? 1 : 0);
