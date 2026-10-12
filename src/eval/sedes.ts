// Sedes: un negocio, un número, varios sitios (sin modelo): pnpm test:sedes
//
// Dos sedes que no abren igual —la del norte de lunes a viernes, la del sur también los sábados y solo en la mañana—
// para que se note si algo ofrece los espacios de la sede equivocada. Lo que se prueba es lo que vive el cliente:
// que le pregunten en cuál, que entiendan «la del norte» o «la de la 72», que le ofrezcan los espacios de ESA sede y
// que la confirmación, el recordatorio y la cita digan a dónde tiene que ir. Falla si algo tuvo que llamar al modelo.
//
// 🪤 Todo en una carpeta temporal con un negocio de ejemplo: no toca la agenda ni la configuración de nadie.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'aiva-sedes-'));
const base = JSON.parse(readFileSync(new URL('../../aiva.config.example.json', import.meta.url), 'utf8')) as Record<string, unknown>;
writeFileSync(
  join(dir, 'aiva.config.json'),
  JSON.stringify({
    ...base,
    timezone: 'America/Bogota',
    appointments: { enabled: true, service: 'visita', durationMin: 60, days: [1, 2, 3, 4, 5], hours: [['09:00', '12:00'], ['14:00', '18:00']], capacity: 1, minLeadHours: 0, maxDaysAhead: 21 },
    sedes: [
      { id: 'norte', nombre: 'Sede Norte', direccion: 'Cra 53 # 82-20', apodos: ['la del norte', 'alto prado'] },
      { id: 'sur', nombre: 'Sede Sur', direccion: 'Calle 72 # 45-10', apodos: ['la de la 72', 'la 72'], days: [1, 2, 3, 4, 5, 6], hours: [['08:00', '12:00']] },
    ],
  }),
);
writeFileSync(join(dir, '.env'), '');
Object.assign(process.env, {
  AIVA_CONFIG: join(dir, 'aiva.config.json'),
  AIVA_ENV_FILE: join(dir, '.env'),
  DB_PATH: join(dir, 'data', 'aiva.db'),
  WHATSAPP_ENABLED: 'false',
  // El calendario del dueño, ninguno; el de la sede del sur, uno de mentira (ver «Calendarios por sede»).
  CALENDAR_BUSY_ICS: '',
  CALENDAR_BUSY_ICS_SUR: 'http://cal.prueba/sur.ics',
});
// Si algo llama a un modelo, falla: el flujo de citas es de reglas. Solo contesta el calendario de la sede del sur.
let calendarioSur = '';
globalThis.fetch = (async (url: string | URL | Request) => {
  if (String(url) === 'http://cal.prueba/sur.ics') return new Response(calendarioSur, { headers: { 'content-type': 'text/calendar' } });
  throw new Error(`la prueba no sale a la red: ${String(url)}`);
}) as typeof fetch;

const { touchUser } = await import('../agent/memory.js');
const { getContact, updateContact } = await import('../crm/contacts.js');
const { availableSlots, bookAppointment, isSlotFree, listAppointments, tzParts, zoned } = await import('../crm/appointments.js');
const { startBooking, bookingStep, bookingReading } = await import('../crm/booking.js');
const { reminderText, reminderTime } = await import('../crm/reminders.js');
const { sedeEn, diasComoTexto, sedesComoInformacion, agendaDe } = await import('../crm/sedes.js');
const { getDb } = await import('../rag/store.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};
type Estado = { step: string; sede?: string; offered: string[]; chosen?: string } | null;
const estado = (u: string): Estado => (getContact(u)?.data.booking as Estado | undefined) ?? null;
const uso = () => (getDb().prepare('SELECT COUNT(*) n FROM llm_usage').get() as { n: number }).n;
const antes = uso();
let n = 0;
/**
 * Un cliente con nombre y número: lo que se prueba aquí es la sede, no esos pasos. 🪤 Cada uno con SU número: con el
 * mismo, aiva los toma por la misma persona (crm/merge.ts) y les ofrece gestionar la cita del primero.
 */
const cliente = (opts: { nombre?: string | null } = {}) => {
  const u = `test:sedes-${++n}`;
  touchUser(u, 'cli', null);
  updateContact(u, { name: opts.nombre === null ? null : (opts.nombre ?? 'Prueba'), phone: `+57300${String(n).padStart(7, '0')}` }, { silent: true });
  return u;
};
const hora = (iso: string) => tzParts(new Date(iso)).hh;
const dia = (iso: string) => tzParts(new Date(iso)).wd;
const corto = (s: string | null) => (s ?? '(sin respuesta)').replace(/\n/g, ' ⏎ ').slice(0, 200);

// =====================================================================================================
console.log('— Cuál sede nombra');
for (const [texto, espera] of [
  ['la del norte', 'norte'],
  ['Sede Norte', 'norte'],
  ['en el norte', 'norte'],
  ['cerca de Alto Prado', 'norte'],
  ['la de la 72', 'sur'],
  ['SEDE SUR', 'sur'],
  ['el norte o el sur, me da igual', null],
  ['quiero ir al centro', null],
  ['el 72 de la lista', null],
] as const) {
  check(`«${texto}» → ${espera ?? 'ninguna'}`, (sedeEn(texto)?.id ?? null) === espera, String(sedeEn(texto)?.id ?? null));
}
{
  // 🪤 Un apodo que cabe dentro del de otra sede: vale el más largo.
  const { business } = await import('../config.js');
  const sur = business.sedes.find((s) => s.id === 'sur')!;
  business.sedes.push({ id: 'centro', nombre: 'Sede Centro', direccion: '', apodos: ['la del centro'] });
  sur.apodos.push('la del centro comercial');
  check('🪤 «la del centro comercial» es la del sur, aunque adentro diga «la del centro»', sedeEn('quiero ir a la del centro comercial')?.id === 'sur', String(sedeEn('quiero ir a la del centro comercial')?.id));
  check('y «la del centro» sola es la del centro', sedeEn('mejor la del centro')?.id === 'centro', String(sedeEn('mejor la del centro')?.id));
  check('nombrar dos sin que una quepa en la otra sigue siendo ambiguo', sedeEn('la del centro o la del norte') === null);
  business.sedes.pop();
  sur.apodos.pop();
}
check('los días se dicen como se dicen', diasComoTexto([1, 2, 3, 4, 5]) === 'lunes a viernes' && diasComoTexto([1, 3, 5]) === 'lunes, miércoles y viernes' && diasComoTexto([6, 0]) === 'sábado y domingo',
  `${diasComoTexto([1, 2, 3, 4, 5])} · ${diasComoTexto([1, 3, 5])} · ${diasComoTexto([6, 0])}`);
const info = sedesComoInformacion();
check('la información del negocio dice dónde queda cada una y cuándo atiende', /Dirección: Cra 53 # 82-20/.test(info) && /lunes a viernes/.test(info) && /lunes a sábado, de 08:00 a 12:00/.test(info), info);
{
  const { businessSheet, formatContext } = await import('../rag/retriever.js');
  const { unsupportedAnswer } = await import('../agent/format.js');
  const hoja = businessSheet().text;
  check('el modelo ve las sedes en la ficha del negocio', /### Sedes/.test(hoja) && /Calle 72 # 45-10/.test(hoja), hoja.slice(0, 300));
  check('y también sin la ficha, con lo que trae la búsqueda', /Cra 53 # 82-20/.test(formatContext([], [])));
  check('«¿tienen sede en Alto Prado?» → «sí» está respaldado: es un apodo de la del norte', unsupportedAnswer('¿tienen sede en alto prado?', 'Sí, en Alto Prado queda nuestra Sede Norte.', hoja) === null, String(unsupportedAnswer('¿tienen sede en alto prado?', 'Sí, en Alto Prado queda nuestra Sede Norte.', hoja)));
  check('y una sede que no existe, no', unsupportedAnswer('¿tienen sede en Soledad?', 'Sí, tenemos sede en Soledad.', hoja) === 'soledad', String(unsupportedAnswer('¿tienen sede en Soledad?', 'Sí, tenemos sede en Soledad.', hoja)));
}
check('cada sede hereda lo que no dice y cambia lo que sí', agendaDe('norte').hours.length === 2 && agendaDe('sur').hours.length === 1 && agendaDe('sur').capacity === 1);

// =====================================================================================================
console.log('— Escoger la sede');
{
  const u = cliente();
  const r1 = await startBooking(u, 'quiero agendar una visita');
  check('con dos sedes, primero pregunta en cuál', /¿En cuál de nuestras sedes/.test(r1) && /Sede Norte · Cra 53/.test(r1) && /Sede Sur · Calle 72/.test(r1) && estado(u)?.step === 'sede', corto(r1));
  const r2 = await bookingStep(u, 'la del norte');
  const st = estado(u);
  check('«la del norte» → espacios de la del norte', st?.step === 'elegir' && st.sede === 'norte' && /Sede Norte/.test(r2 ?? ''), corto(r2));
  check('y solo de sus días y horas', Boolean(st?.offered.length) && st!.offered.every((o) => dia(o) >= 1 && dia(o) <= 5 && ((hora(o) >= 9 && hora(o) < 12) || (hora(o) >= 14 && hora(o) < 18))), st?.offered.map((o) => `${dia(o)}/${hora(o)}`).join(' '));
  const r3 = await bookingStep(u, 'la 1');
  check('al confirmar dice a dónde tiene que ir', estado(u)?.step === 'confirmar' && /en Sede Norte \(Cra 53 # 82-20\)/.test(r3 ?? ''), corto(r3));
  const r4 = await bookingStep(u, 'sí');
  const cita = listAppointments({ userId: u })[0];
  check('la cita queda en la del norte, con su dirección', cita?.sede === 'norte' && cita.location === 'Sede Norte (Cra 53 # 82-20)', JSON.stringify(cita));
  check('y la respuesta también lo dice', /en Sede Norte \(Cra 53 # 82-20\)/.test(r4 ?? ''), corto(r4));
  check('la ficha recuerda la sede', getContact(u)?.data.sede === 'norte');
  check('el recordatorio dice a dónde ir', /en Sede Norte \(Cra 53 # 82-20\)/.test(reminderText(cita!, getContact(u))), reminderText(cita!, getContact(u)));

  // Moverla: se queda en su sede, salvo que diga otra.
  const r5 = await startBooking(u, '¿la puedo pasar para otro día?');
  check('moverla ofrece en la misma sede, sin volver a preguntar', estado(u)?.sede === 'norte' && estado(u)?.step === 'elegir', `${corto(r5)} · ${JSON.stringify(estado(u))}`);
  const r6 = await bookingStep(u, 'mejor en la del sur');
  check('«mejor en la del sur» cambia de sede, con los espacios de allá', estado(u)?.sede === 'sur' && estado(u)!.offered.every((o) => hora(o) >= 8 && hora(o) < 12) && /Sede Sur/.test(r6 ?? ''), corto(r6));
}
{
  const u = cliente();
  await startBooking(u, 'quiero una cita');
  const r = await bookingStep(u, '2');
  check('«2» es la segunda sede de la lista', estado(u)?.sede === 'sur', corto(r));
}
{
  const u = cliente();
  const r = await startBooking(u, 'quiero una cita en la de la 72');
  check('si la nombra de entrada, no se le pregunta', estado(u)?.step === 'elegir' && estado(u)?.sede === 'sur', corto(r));
}
{
  const u = cliente({ nombre: null });
  await startBooking(u, 'quiero una cita');
  const r1 = await bookingStep(u, 'en la del norte');
  check('si al pedirle el nombre contesta la sede, se anota y se le vuelve a pedir el nombre', /Anotado: Sede Norte/.test(r1 ?? '') && estado(u)?.step === 'nombre', corto(r1));
  const r2 = await bookingStep(u, 'Laura Gómez');
  check('y después del nombre ya no se le pregunta la sede', estado(u)?.step === 'elegir' && estado(u)?.sede === 'norte', corto(r2));
}
{
  const u = cliente();
  await startBooking(u, 'quiero una cita');
  const r = await bookingStep(u, 'no la de la 72, la del norte, la que me queda más cerca');
  check('🪤 si nombra las dos, se le vuelve a preguntar en vez de adivinar', estado(u)?.step === 'sede' && /No me quedó claro/.test(r ?? ''), corto(r));
}
{
  const u = cliente();
  await startBooking(u, 'quiero una cita');
  const r = await bookingStep(u, 'la que sea');
  const sede = estado(u)?.sede;
  check('«la que sea»: la que tenga el espacio más pronto, y se le dice cuál', Boolean(sede) && new RegExp(sede === 'sur' ? 'Sede Sur' : 'Sede Norte').test(r ?? ''), corto(r));
}

// =====================================================================================================
console.log('— Lo que una sede tiene y la otra no');
{
  const u = cliente();
  const r = await startBooking(u, 'quiero una cita en la del norte el sábado');
  const st = estado(u);
  check('el sábado la del norte no abre: se dice, y se le ofrece la del sur, que sí', /no atendemos en Sede Norte/.test(r) && /En Sede Sur sí tengo/.test(r) && st?.sede === 'sur' && st.offered.every((o) => dia(o) === 6), corto(r));
}
{
  // El mismo lunes a las 9, en las dos sedes: cada una tiene su cupo.
  const lunes = availableSlots({ count: 500, sede: 'norte', spreadDays: false }).find((s) => tzParts(s.startsAt).wd === 1 && tzParts(s.startsAt).hh === 9)!.startsAt;
  const a = cliente();
  bookAppointment(a, lunes, { sede: 'norte', by: 'admin' });
  check('una cita en la del norte ocupa la del norte', !isSlotFree(lunes, { sede: 'norte' }));
  check('agendada desde el tablero, también deja la sede en la ficha', getContact(a)?.data.sede === 'norte', JSON.stringify(getContact(a)?.data));
  check('🪤 y no la del sur: cada sede tiene su cupo', isSlotFree(lunes, { sede: 'sur' }));
  // Una cita de antes de que hubiera sedes (sin sede guardada) se le cuenta a la primera.
  const despues = new Date(lunes.getTime() + 3600_000);
  getDb()
    .prepare("INSERT INTO appointments (user_id, starts_at, ends_at, service, location, status, notes, created_at) VALUES (?, ?, ?, 'visita', NULL, 'confirmada', '', ?)")
    .run(a, despues.getTime(), despues.getTime() + 3600_000, Date.now());
  check('🪤 una cita vieja, sin sede, ocupa la primera sede y no queda libre dos veces', !isSlotFree(despues, { sede: 'norte' }) && isSlotFree(despues, { sede: 'sur' }));
  let error = '';
  try {
    bookAppointment(a, new Date(lunes.getTime() + 5 * 3600_000), { by: 'admin' });
  } catch (e) {
    error = (e as Error).message;
  }
  check('🪤 con varias sedes, una cita sin sede no se agenda', /qué sede/.test(error), error || 'se agendó');
}
{
  // El lunes de la semana que viene a las 7:30: el recordatorio de las 8 ya no cabe ese día, así que se va al último
  // día que esa sede atiende. La del sur abre los sábados; la del norte, no.
  let t = Date.now() + 2 * 86400_000;
  while (tzParts(new Date(t)).wd !== 1) t += 86400_000;
  const p = tzParts(new Date(t));
  const temprano = zoned(p.y, p.m, p.d, 7, 30).getTime();
  const wd = (x: number) => tzParts(new Date(x)).wd;
  check('el recordatorio de la del sur puede salir el sábado', wd(reminderTime(temprano, 'sur')) === 6, String(wd(reminderTime(temprano, 'sur'))));
  check('el de la del norte, el viernes', wd(reminderTime(temprano, 'norte')) === 5, String(wd(reminderTime(temprano, 'norte'))));
}
// =====================================================================================================
console.log('— Editarlas desde El negocio');
{
  const { ajustesDe, guardar } = await import('../ajustes.js');
  const enDisco = () => JSON.parse(readFileSync(join(dir, 'aiva.config.json'), 'utf8')) as { sedes: { id: string; nombre: string }[] };
  const base = ajustesDe();
  const [norte, sur] = base.sedes!;
  guardar({ ...base, sedes: [norte, sur, { id: '', nombre: 'Sede Centro', direccion: 'Calle 1 # 2-3', apodos: [] }] });
  check('una sede nueva recibe su id del nombre, sin «Sede» ni el nombre del negocio', enDisco().sedes.some((x) => x.id === 'centro'), JSON.stringify(enDisco().sedes.map((x) => x.id)));
  guardar({ ...base, sedes: [{ ...norte!, nombre: 'Norte Alto Prado' }, sur, { id: 'centro', nombre: 'Sede Centro', direccion: 'Calle 1 # 2-3', apodos: [] }] });
  check('🪤 cambiarle el nombre no le cambia el id: las citas y las fichas lo llevan', enDisco().sedes[0]!.id === 'norte' && enDisco().sedes[0]!.nombre === 'Norte Alto Prado');
  const { sedes: _fuera, ...viejo } = base;
  guardar(viejo);
  check('🪤 un formulario viejo, sin el campo de sedes, no las borra', enDisco().sedes.length === 3, JSON.stringify(enDisco().sedes.map((x) => x.id)));
  const u = cliente();
  const libre = availableSlots({ count: 1, sede: 'sur' })[0]!.startsAt;
  bookAppointment(u, libre, { sede: 'sur', by: 'admin' });
  let error = '';
  try {
    guardar({ ...base, sedes: [norte] });
  } catch (e) {
    error = (e as Error).message;
  }
  check('🪤 no se puede quitar una sede con citas por delante', /Sede Sur tiene \d+ citas? por delante/.test(error) && enDisco().sedes.length === 3, error || 'la quitó');
  let franja = '';
  try {
    guardar({ ...base, sedes: [norte, { ...sur!, hours: [['12:00', '08:00']] }] });
  } catch (e) {
    franja = (e as Error).message;
  }
  check('una franja al revés se dice con el nombre de la sede', /Sede Sur.*12:00–08:00/.test(franja), franja || 'se guardó');
}

{
  // 🪤 En un servidor en UTC, un recordatorio a las 7:30 p. m. de Bogotá ya es el día siguiente en la máquina. Con
  // el día de la semana de la máquina, un domingo cerrado pasaba por un lunes abierto.
  const { business } = await import('../config.js');
  const antes = { at: business.appointments.reminder.at, tz: process.env.TZ };
  business.appointments.reminder.at = '19:30';
  process.env.TZ = 'UTC';
  let t = Date.now() + 2 * 86400_000;
  while (tzParts(new Date(t)).wd !== 1) t += 86400_000;
  const p = tzParts(new Date(t));
  const nueve = zoned(p.y, p.m, p.d, 9, 0).getTime();
  const dia = tzParts(new Date(reminderTime(nueve, 'norte'))).wd;
  business.appointments.reminder.at = antes.at;
  if (antes.tz === undefined) delete process.env.TZ;
  else process.env.TZ = antes.tz;
  check('🪤 con el servidor en UTC, el recordatorio de la tarde no cae en un día cerrado', dia === 5, `cayó en el día ${dia}`);
}
{
  console.log('— Calendarios por sede');
  // Un evento en el calendario de la sede del sur, un martes a las 10 en dos semanas: a esa hora abren las dos.
  const { syncBusy, busyStatus, busyIntervals } = await import('../crm/busy.js');
  let t = Date.now() + 8 * 86400_000;
  while (tzParts(new Date(t)).wd !== 2) t += 86400_000;
  const p = tzParts(new Date(t));
  const diez = zoned(p.y, p.m, p.d, 10, 0);
  const ics = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  calendarioSur = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:sur-1\r\nDTSTART:${ics(diez)}\r\nDTEND:${ics(new Date(diez.getTime() + 3600_000))}\r\nSUMMARY:Ocupado\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
  await syncBusy();
  check('el calendario de la sede del sur se lee, y dice de qué sede es', busyStatus().some((s) => s.ok && s.sede === 'sur' && s.intervals === 1), JSON.stringify(busyStatus()));
  check('🪤 su evento ocupa la sede del sur', !isSlotFree(diez, { sede: 'sur' }));
  check('🪤 y no la del norte, que tiene su propia gente', isSlotFree(diez, { sede: 'norte' }));
  const desde = diez.getTime() - 3600_000, hasta = diez.getTime() + 2 * 3600_000;
  check('el calendario del tablero, mirando la del norte, no lo pinta', busyIntervals(desde, hasta, 'norte').length === 0 && busyIntervals(desde, hasta, 'sur').length === 1 && busyIntervals(desde, hasta).length === 1);
}
{
  // Quien llegó al local y se da de alta a mano también es de una sede.
  const { darDeAlta } = await import('../crm/alta.js');
  const r = darDeAlta({ name: 'Llegó al Local', phone: '3009998877', sede: 'sur' });
  check('dar de alta a mano a alguien deja su sede en la ficha', r.contact.data.sede === 'sur', JSON.stringify(r.contact.data));
  let error = '';
  try {
    darDeAlta({ name: 'Otra', sede: 'no-existe' });
  } catch (e) {
    error = (e as Error).message;
  }
  check('una sede que no existe no se acepta', /no existe/.test(error), error || 'se aceptó');
}
check('enseñar una frase sabe leer sedes', bookingReading('la de la 72') === 'Sede Sur', String(bookingReading('la de la 72')));

// =====================================================================================================
console.log('— Sin sedes, ni una palabra de sedes');
// 🪤 Casi ningún cliente tiene sedes, y para ellos esto tiene que costar cero: ni tokens en el prompt, ni una
// instrucción de «no hables de sedes» que ponga al modelo a pensar en lo que no existe, ni una pregunta de más al
// agendar. Si alguien pregunta por sedes, se contesta con el Perfil, como cualquier otra pregunta del negocio.
{
  const { business } = await import('../config.js');
  const { sedesNombradas } = await import('../crm/sedes.js');
  const { businessSheet, formatContext } = await import('../rag/retriever.js');
  const { personaPrompt, gatePrompt, datosDeLaPersona, soloLasReglas } = await import('../agent/prompts.js');
  const guardadas = business.sedes.splice(0);
  const todo = [businessSheet().text, formatContext([], []), personaPrompt(), gatePrompt(), datosDeLaPersona(), soloLasReglas(), sedesComoInformacion()].join('\n');
  const dicha = /.{0,60}\bsedes?\b.{0,60}/i.exec(todo)?.[0] ?? '';
  check('🪤 nada de lo que ve el modelo dice «sede»', !dicha, dicha);
  check('ningún mensaje nombra una sede', sedeEn('en la sede norte, la del norte') === null && sedesNombradas('la de la 72').length === 0);
  const u = cliente();
  const r = await startBooking(u, 'quiero agendar una visita');
  check('al agendar no pregunta en cuál', !/sede/i.test(r) && estado(u)?.step !== 'sede' && /\d/.test(r), corto(r));
  check('y la agenda es la de siempre', agendaDe(null).sede === null && agendaDe('norte').sede === null);
  business.sedes.push(...guardadas);
}

check('ni una llamada a un modelo', uso() === antes, `${uso() - antes} llamadas`);
console.log(fail ? `\n${fail} fallaron` : '\ntodo ok');
process.exit(fail ? 1 : 0);
