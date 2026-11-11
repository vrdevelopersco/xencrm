// Pruebas del flujo de citas con muletillas (sin modelo): pnpm test:booking
// Reproduce la lista que ve el cliente (10, 11 y 12 de un día) y verifica que "al medio día", "la última" o
// "sisas" hagan lo que una persona entendería. Falla si alguna respuesta tuvo que llamar al modelo.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'xencrm-booking-')), 'xencrm.db'); // agenda propia: no toca la del negocio
const { touchUser } = await import('../agent/memory.js');
const { getContact, updateContact, deleteContactsByPrefix } = await import('../crm/contacts.js');
const { availableSlots, tzParts, dayKey, listAppointments, formatDay, zoned } = await import('../crm/appointments.js');
const { bookingStep } = await import('../crm/booking.js');
const { parseWhen } = await import('../crm/when.js');
const { getDb } = await import('../rag/store.js');
type State = { step: 'nombre' | 'elegir' | 'telefono' | 'confirmar'; offered: string[]; chosen?: string; when?: { to?: string } };

const usageBefore = (getDb().prepare('SELECT COUNT(*) n FROM llm_usage').get() as { n: number }).n;
// Primer día con tres espacios seguidos en la mañana (en DUNOR: 10, 11 y 12).
let offered: string[] = [];
for (let d = 1; d <= 20 && offered.length < 3; d++) {
  const probe = tzParts(new Date(Date.now() + d * 86400_000));
  const key = dayKey(probe.y, probe.m, probe.d);
  const slots = availableSlots({ count: 3, when: { days: [key], toMin: 13 * 60, label: '' } });
  if (slots.length === 3) offered = slots.map((s) => s.startsAt.toISOString());
}
if (offered.length < 3) throw new Error('no hay un día con tres espacios seguidos para la prueba');
const hour = (iso: string) => tzParts(new Date(iso)).hh;
const day = (iso: string) => dayKey(tzParts(new Date(iso)).y, tzParts(new Date(iso)).m, tzParts(new Date(iso)).d);
console.log(`lista de prueba: ${offered.map((o) => `${day(o)} ${hour(o)}:00`).join(' · ')}\n`);

let n = 0;
let fail = 0;
async function run(reply: string, state: State, check: (st: State | null, text: string | null, userId: string) => string | null, opts: { phone?: boolean; name?: boolean } = {}) {
  const userId = `test:booking-${++n}`;
  touchUser(userId, 'cli', 'Prueba');
  // Por defecto el contacto ya tiene número (el paso del teléfono se prueba aparte).
  updateContact(userId, { name: opts.name === false ? null : 'Prueba', phone: opts.phone === false ? null : '+573000000000', data: { booking: state } }, { silent: true });
  const text = await bookingStep(userId, reply);
  const st = (getContact(userId)?.data.booking as State | undefined) ?? null;
  const problem = check(st, text, userId);
  getDb().prepare('DELETE FROM appointments WHERE user_id = ?').run(userId); // cada caso deja libre el espacio
  if (problem) fail++;
  console.log(`${problem ? '✗' : '✓'} ${state.step.padEnd(9)} «${reply}»${problem ? `\n   ${problem}\n   respuesta: ${(text ?? '(sin respuesta)').replace(/\n/g, ' ⏎ ').slice(0, 160)}` : ''}`);
}
const elegir = (extra: Partial<State> = {}): State => ({ step: 'elegir', offered, ...extra });
const chose = (h: number) => (st: State | null) => (st?.step === 'confirmar' && st.chosen && hour(st.chosen) === h ? null : `esperaba escoger la de las ${h}; quedó ${st?.step ?? 'sin flujo'} ${st?.chosen ? hour(st.chosen) + ':00' : ''}`);
const narrowed = (hours: number[]) => (st: State | null) =>
  st?.step === 'elegir' && st.offered.map(hour).join() === hours.join() ? null : `esperaba acotar a ${hours.join(', ')}; quedó ${st?.offered.map(hour).join(', ')}`;
const booked = (st: State | null, _t: string | null, userId: string) => (!st && listAppointments({ userId }).length === 1 ? null : 'esperaba la cita agendada');
const notBooked = (st: State | null, _t: string | null, userId: string) => (listAppointments({ userId }).length === 0 && st?.step === 'elegir' ? null : 'no debía agendar: debía ofrecer otras');

// Escoger de la lista con muletillas
await run('Al medio dia', elegir(), chose(12));
await run('A las 12pm', elegir(), chose(12));
await run('12m', elegir(), chose(12));
await run('la de las 11', elegir(), chose(11));
await run('las 10', elegir(), chose(10));
await run('la última', elegir(), chose(12));
await run('la más temprano', elegir(), chose(10));
await run('la del medio', elegir(), chose(11));
await run('la segunda', elegir(), chose(11));
await run('en la mañana', elegir(), narrowed([10, 11]));
await run('a primera hora', elegir(), narrowed([10, 11]));
await run('a la hora del almuerzo', elegir(), chose(12));
// Le sirve cualquiera: la primera de la lista
await run('la que sea', elegir(), chose(10));
await run('Cualquiera me sirve', elegir(), chose(10));
await run('me da igual', elegir(), chose(10));
await run('la que tú digas', elegir(), chose(10));
await run('cualquiera, pero el jueves', elegir(), (st) => (st?.step === 'elegir' ? null : `esperaba ofrecer el jueves, no escoger; quedó ${st?.step ?? 'sin flujo'}`));
// Más tarde el mismo día pedido
await run('más tarde', elegir({ when: parseWhen(`el ${Number(day(offered[0]!).slice(8))}`) ?? undefined }), (st) =>
  st?.step === 'elegir' && st.offered.length > 0 && st.offered.every((o) => day(o) === day(offered[0]!) && hour(o) > 12) ? null : `esperaba espacios después de las 12 del mismo día; quedó ${st?.offered.map((o) => `${day(o)} ${hour(o)}`).join(', ')}`,
);
// Refinar sin olvidar el día: se ofrecieron 10 y 11 de "mañana"; "al mediodía" es ese día a las 12.
await run('al mediodía', elegir({ offered: offered.slice(0, 2), when: parseWhen(`el ${Number(day(offered[0]!).slice(8))}`) ?? undefined }), (st) =>
  st?.step === 'elegir' && st.offered.length > 0 && st.offered.every((o) => day(o) === day(offered[0]!) && hour(o) === 12) ? null : `esperaba el mismo día a las 12; quedó ${st?.offered.map((o) => `${day(o)} ${hour(o)}`).join(', ')}`,
);
// Confirmar con muletillas
const confirmar = (): State => ({ step: 'confirmar', offered, chosen: offered[2] });
await run('sisas', confirmar(), booked);
await run('Hágale pues', confirmar(), booked);
await run('sí, no hay problema', confirmar(), booked);
await run('👍', confirmar(), booked);
await run('sí, a las 12', confirmar(), booked);
await run('bueno, mejor otro día', confirmar(), notBooked);

// Número de contacto cuando el canal no lo trae (chat web)
const sinNumero = { phone: false };
await run('la 2', elegir(), (st, text) => (st?.step === 'telefono' && /número/.test(text ?? '') ? null : `esperaba pedir el número; quedó ${st?.step}`), sinNumero);
const telefono = (): State => ({ step: 'telefono', offered, chosen: offered[1] });
await run('mi número es 300 123 4567 y mi correo Arnulfo.D@gmail.com', telefono(), (st, _t, userId) => {
  const c = getContact(userId)!;
  return st?.step === 'confirmar' && c.phone === '+573001234567' && c.data.correo === 'arnulfo.d@gmail.com' ? null : `quedó ${st?.step} · ${c.phone} · ${String(c.data.correo)}`;
}, sinNumero);
await run('arnulfo@gmail.com', telefono(), (st, text, userId) => (st?.step === 'telefono' && getContact(userId)!.data.correo === 'arnulfo@gmail.com' && /número/.test(text ?? '') ? null : `esperaba guardar el correo y volver a pedir el número; quedó ${st?.step}`), sinNumero);
await run('300 123', telefono(), (st, text) => (st?.step === 'telefono' && /no me cuadra/.test(text ?? '') ? null : `esperaba pedirlo completo; quedó ${st?.step}`), sinNumero);
await run('prefiero no', telefono(), (st, text, userId) => (!st && listAppointments({ userId }).length === 0 && /Sin un número/.test(text ?? '') ? null : 'esperaba no agendar y ofrecer el contacto directo'), sinNumero);
await run('Arnulfo Dominguez 300 123 4567', { step: 'nombre', offered: [] }, (st, _t, userId) => {
  const c = getContact(userId)!;
  return st?.step === 'elegir' && c.name === 'Arnulfo Dominguez' && c.phone === '+573001234567' ? null : `quedó ${st?.step} · «${c.name}» · ${c.phone}`;
}, { phone: false, name: false });

// ---------- Cambiar o cancelar una cita que ya existe ----------
const { startBooking, manageIntent } = await import('../crm/booking.js');
const { bookAppointment, getAppointment } = await import('../crm/appointments.js');
const intents: [string, boolean, string | null][] = [
  ['quiero cancelar mi cita', true, 'cancelar'],
  ['ya no puedo ir', true, 'cancelar'],
  ['¿la puedo pasar para el jueves?', true, 'cambiar'],
  ['necesito mover la cita', true, 'cambiar'],
  ['quiero cambiar la talla del traje', true, null],
  ['quiero agendar una cita', true, null],
  ['cambiarla', false, 'cambiar'],
  ['cámbiala', false, 'cambiar'],
  ['cámbiamela para el viernes', true, 'cambiar'],
  ['mejor cancélala', true, 'cancelar'],
  ['¿me la puedes correr para el viernes?', true, 'cambiar'],
  ['pásamela para mañana', true, 'cambiar'],
  ['la escuela de mi hijo cambió el horario', true, null], // ambiguo: no se fuerza el flujo
];
for (const [text, strict, want] of intents) {
  const got = manageIntent(text, { strict });
  if (got !== want) fail++;
  console.log(`${got === want ? '✓' : '✗'} intención «${text}» → ${got ?? 'nada'}${got === want ? '' : ` (esperaba ${want ?? 'nada'})`}`);
}
// "Sí" sin decir cuál, un número que no llega y la fecha del evento (repetición de la prueba de Arnulfo)
await run('Si', elegir(), (st, text) => (st?.step === 'elegir' && /Cuál de estos te sirve/.test(text ?? '') ? null : `con 3 horarios debía preguntar cuál; quedó ${st?.step ?? 'sin flujo'}`));
await run('sí', elegir({ offered: offered.slice(0, 1) }), chose(10));
await run('1', { step: 'telefono', offered, chosen: offered[2] }, (st, text) =>
  st?.step === 'telefono' && st.chosen === offered[2] && /a qué número te escribimos/.test(text ?? '') ? null : `debía volver a pedir el número sin perder el horario; quedó ${st?.step ?? 'sin flujo'}`,
  { phone: false },
);
const friday = (() => { for (let d = 1; d <= 7; d++) { const p = tzParts(new Date(Date.now() + d * 86400_000)); if (p.wd === 5) return dayKey(p.y, p.m, p.d); } return ''; })();
await run('El evento es este viernes😭', { step: 'nombre', offered: [] }, (st, text) =>
  st?.when?.to && st.when.to < friday && /antes de tu evento/.test(text ?? '') ? null : `la cita debía quedar antes del viernes ${friday}; quedó ${JSON.stringify(st?.when)}`,
  { name: false },
);
await run('el evento es el viernes', { step: 'confirmar', offered, chosen: offered[0] }, (st, text, userId) =>
  day(offered[0]!) < friday
    ? st?.step === 'confirmar' && /queda antes de tu evento/.test(text ?? '') && listAppointments({ userId }).length === 0 ? null : 'decir cuándo es el evento no es confirmar: debía volver a pedir el sí'
    : null,
);
{
  // El evento, a cinco días: así siempre quedan días hábiles antes, caiga hoy en el día de la semana que caiga.
  const p = tzParts(new Date(Date.now() + 5 * 86400_000));
  const evento = dayKey(p.y, p.m, p.d);
  const nombreDia = formatDay(zoned(p.y, p.m, p.d, 12, 0)).split(',')[0]!;
  const userId = `test:booking-${++n}`;
  touchUser(userId, 'cli', 'Prueba');
  updateContact(userId, { name: 'Arnulfo', phone: '+573000000000' }, { silent: true });
  const text = await startBooking(userId, `El evento es el ${nombreDia}, quiero una cita`);
  const st = getContact(userId)?.data.booking as State | undefined;
  const days = (st?.offered ?? []).map(day);
  const ok = days.length > 0 && days.every((d) => d < evento);
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} agendar diciendo cuándo es el evento: espacios antes del ${nombreDia}${ok ? '' : `
   ${days.join(', ')} · ${text.replace(/\n/g, ' ⏎ ')}`}`);
}

/** Contacto con nombre, número y una cita ya agendada en el primer espacio libre. */
function withAppointment(): { userId: string; apptId: number } {
  const userId = `test:booking-${++n}`;
  touchUser(userId, 'cli', 'Prueba');
  updateContact(userId, { name: 'Prueba', phone: '+573000000000' }, { silent: true });
  const slot = availableSlots({ count: 1 })[0]!;
  return { userId, apptId: bookAppointment(userId, slot.startsAt).id };
}
async function flow(name: string, steps: string[], check: (userId: string, apptId: number, replies: string[]) => string | null) {
  const { userId, apptId } = withAppointment();
  const replies = [await startBooking(userId, steps[0]!)];
  for (const s of steps.slice(1)) replies.push((await bookingStep(userId, s)) ?? '(sin respuesta)');
  const problem = check(userId, apptId, replies);
  if (problem) fail++;
  console.log(`${problem ? '✗' : '✓'} ${name}${problem ? `\n   ${problem}\n   ${replies.map((r) => r.replace(/\n/g, ' ⏎ ').slice(0, 110)).join('\n   ')}` : ''}`);
}
const status = (id: number) => getAppointment(id)?.status;
// 🪤 Cancelar ya no es un paso: primero se pregunta qué pasó, una sola vez y con la salida escrita en el mismo
// mensaje. Ver crm/retener.ts, que es donde vive el porqué y donde están las pruebas de que no se acosa.
await flow('cancelar: pregunta qué pasó y luego cancela', ['quiero cancelar mi cita', 'ya no estoy seguro', 'cancélala'], (u, id, r) =>
  /no te sirve ese d[ií]a|ya no est[aá]s tan seguro/.test(r[0]!) && /cancel[eé]/.test(r[2]!) && status(id) === 'cancelada' ? null : `quedó ${status(id)}`,
);
await flow('arrepentirse de cancelar', ['quiero cancelar mi cita', 'ya no estoy seguro', 'déjala así'], (u, id, r) =>
  /te esperamos/.test(r[2]!) && status(id) === 'confirmada' ? null : `quedó ${status(id)}`,
);
// 🪤 Y «déjalo así» conserva la cita, no la cancela: en una conversación de citas quiere decir «déjala como
// está». Confundirlo con «no me preguntes más» cancelaba la cita de quien se estaba arrepintiendo de cancelar.
await flow('«déjalo así» conserva la cita, no la mata', ['quiero cancelar mi cita', 'déjalo así'], (u, id) =>
  status(id) === 'confirmada' ? null : `quedó ${status(id)}`,
);
await flow('mover al jueves en la tarde', ['¿puedo cambiar mi cita para el jueves en la tarde?', 'la 1', 'sí'], (u, id, r) => {
  const all = listAppointments({ userId: u });
  const fresh = all.find((a) => a.id !== id);
  const thu = fresh && tzParts(new Date(fresh.startsAt));
  const stage = getContact(u)?.stage;
  return /Moví tu/.test(r[2]!) && status(id) === 'cancelada' && fresh?.status === 'confirmada' && thu?.wd === 4 && thu.hh >= 13 && stage === 'cita_agendada'
    ? null
    : `vieja ${status(id)} · nueva ${fresh?.status} ${thu ? `día ${thu.wd} ${thu.hh}h` : ''} · etapa ${stage}`;
});
await flow('"sobre mi cita" → pregunta → cancelarla', ['hola, sobre mi cita', 'cancelarla', 'ya no estoy seguro', 'cancélala', 'sí'], (u, id, r) =>
  /cambiarla o cancelarla/.test(r[0]!) && /no te sirve ese d[ií]a|ya no est[aá]s tan seguro/.test(r[1]!) && status(id) === 'cancelada' ? null : `quedó ${status(id)}`,
);
await flow('"así está bien" la deja como está', ['hola, sobre mi cita', 'así está bien, gracias'], (u, id, r) =>
  /te esperamos/.test(r[1]!) && status(id) === 'confirmada' ? null : `quedó ${status(id)}`,
);

// Nombrar el día de su propia cita es preguntar por ella, no pedir otra hora: "¿me confirmas la cita del jueves?"
{
  const { userId, apptId } = withAppointment();
  const dia = formatDay(new Date(getAppointment(apptId)!.startsAt)).split(',')[0]!; // "jueves"
  const r1 = await startBooking(userId, `hola, ¿me confirmas la cita del ${dia}?`);
  const ok1 = /(?:Ya tienes tu|Tu cita)/.test(r1) && !/busquemos otro espacio/.test(r1) && !/\d\) /.test(r1);
  if (!ok1) fail++;
  console.log(`${ok1 ? '✓' : '✗'} preguntar por la cita nombrando su día no la mueve${ok1 ? '' : `\n   ${r1.replace(/\n/g, ' ⏎ ').slice(0, 130)}`}`);

  const { userId: u2, apptId: a2 } = withAppointment();
  const dia2 = formatDay(new Date(getAppointment(a2)!.startsAt)).split(',')[0]!;
  const r2 = await startBooking(u2, `¿la puedo pasar para el ${dia2} en la tarde?`);
  const ok2 = /busquemos otro espacio/.test(r2);
  if (!ok2) fail++;
  console.log(`${ok2 ? '✓' : '✗'} pedir otra hora del mismo día sí la mueve${ok2 ? '' : `\n   ${r2.replace(/\n/g, ' ⏎ ').slice(0, 130)}`}`);
}


await flow('preguntar la hora de su cita no la pone a cambiarla', ['¿a qué hora era mi cita?'], (u, id, r) =>
  /Te esperamos/.test(r[0]!) && !/cambiarla o cancelarla\?$/.test(r[0]!.trim()) && !/Lo más cercano|\d\) /.test(r[0]!) ? null : r[0]!.slice(0, 90),
);
await flow('y si después sí quiere cambiarla, sigue el hilo', ['¿cuándo era mi cita?', 'cámbiala'], (u, id, r) =>
  /Te esperamos/.test(r[0]!) && /busquemos otro espacio|Lo más cercano|\d\) /.test(r[1]!) ? null : r[1]!.slice(0, 90),
);

// El día que pida, si está lleno, se dice y se ofrece lo más cercano: no se salta a la semana siguiente.
{
  const primero = availableSlots({ count: 1 })[0]!; // el próximo espacio libre, sea cual sea
  const p = tzParts(primero.startsAt);
  const diaKey = dayKey(p.y, p.m, p.d);
  const nombreDia = formatDay(zoned(p.y, p.m, p.d, 12, 0)).split(',')[0]!; // "jueves"
  for (let i = 0; i < 30; i++) {
    const slot = availableSlots({ count: 1, when: { days: [diaKey], label: nombreDia } })[0];
    if (!slot) break;
    const u = `test:booking-lleno-${i}`;
    touchUser(u, 'cli', 'Relleno');
    updateContact(u, { name: 'Relleno', phone: '+573000000000' }, { silent: true });
    bookAppointment(u, slot.startsAt, { by: 'admin' });
  }
  const lleno = availableSlots({ count: 1, when: { days: [diaKey], label: nombreDia } }).length === 0;
  const entiende = parseWhen(`el ${nombreDia}`)?.days?.[0] === diaKey; // "el jueves" es ese jueves, el de esta semana
  const u = `test:booking-${++n}`;
  touchUser(u, 'cli', 'Marta');
  updateContact(u, { name: 'Marta', phone: '+573001112233' }, { silent: true });
  const r = await startBooking(u, `¿puedo ir el ${nombreDia}?`);
  const ofrecidos = [...r.matchAll(/\d\) (.+)/g)].map((m) => m[1]!);
  const ok = lleno && entiende && /ya no me quedan espacios/.test(r) && /Lo más cercano/.test(r) && !ofrecidos.some((o) => o.includes(nombreDia));
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} el día pedido lleno se dice, no se salta a la otra semana${ok ? '' : `\n   (lleno=${lleno} entiende=${entiende} ${nombreDia} ${diaKey}) ${r.replace(/\n/g, ' ⏎ ').slice(0, 160)}`}`);
}

const usageAfter = (getDb().prepare('SELECT COUNT(*) n FROM llm_usage').get() as { n: number }).n;
if (usageAfter !== usageBefore) {
  fail++;
  console.log(`✗ ${usageAfter - usageBefore} respuestas tuvieron que llamar al modelo: las reglas no las entendieron`);
}
deleteContactsByPrefix('test:booking-');
console.log(`\n${fail ? `${fail} fallos` : 'todo ok'}`);
process.exit(fail ? 1 : 0);
