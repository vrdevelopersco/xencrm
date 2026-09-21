// Pruebas del flujo de citas con muletillas (sin modelo): pnpm test:booking
// Reproduce la lista que ve el cliente (10, 11 y 12 de un día) y verifica que "al medio día", "la última" o
// "sisas" hagan lo que una persona entendería. Falla si alguna respuesta tuvo que llamar al modelo.
const { touchUser } = await import('../agent/memory.js');
const { getContact, updateContact, deleteContactsByPrefix } = await import('../crm/contacts.js');
const { availableSlots, tzParts, dayKey, listAppointments } = await import('../crm/appointments.js');
const { bookingStep } = await import('../crm/booking.js');
const { parseWhen } = await import('../crm/when.js');
const { getDb } = await import('../rag/store.js');
type State = { step: 'nombre' | 'elegir' | 'telefono' | 'confirmar'; offered: string[]; chosen?: string; when?: unknown };

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
await flow('cancelar con confirmación', ['quiero cancelar mi cita', 'sí'], (u, id, r) =>
  /Confirmas que cancelo/.test(r[0]!) && /cancelé/.test(r[1]!) && status(id) === 'cancelada' ? null : `quedó ${status(id)}`,
);
await flow('arrepentirse de cancelar', ['quiero cancelar mi cita', 'no, mejor no'], (u, id, r) =>
  /la dejamos como está/.test(r[1]!) && status(id) === 'confirmada' ? null : `quedó ${status(id)}`,
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
await flow('"sobre mi cita" → pregunta → cancelarla', ['hola, sobre mi cita', 'cancelarla', 'sí'], (u, id, r) =>
  /cambiarla o cancelarla/.test(r[0]!) && /Confirmas/.test(r[1]!) && status(id) === 'cancelada' ? null : `quedó ${status(id)}`,
);
await flow('"así está bien" la deja como está', ['hola, sobre mi cita', 'así está bien, gracias'], (u, id, r) =>
  /te esperamos/.test(r[1]!) && status(id) === 'confirmada' ? null : `quedó ${status(id)}`,
);

const usageAfter = (getDb().prepare('SELECT COUNT(*) n FROM llm_usage').get() as { n: number }).n;
if (usageAfter !== usageBefore) {
  fail++;
  console.log(`✗ ${usageAfter - usageBefore} respuestas tuvieron que llamar al modelo: las reglas no las entendieron`);
}
deleteContactsByPrefix('test:booking-');
console.log(`\n${fail ? `${fail} fallos` : 'todo ok'}`);
process.exit(fail ? 1 : 0);
