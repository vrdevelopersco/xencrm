// Pruebas del calendario (sin modelo): pnpm test:calendar
// 1) Lectura de un iCal como el que exporta Google/Outlook: zonas, repeticiones, excepciones, días completos.
// 2) El feed de citas y el .ics del cliente cumplen el formato (CRLF, líneas ≤ 75 bytes, escapes) y se releen igual.
// 3) Un evento del calendario del dueño bloquea ese espacio en la agenda que ofrece el bot.

// Calendario del dueño para la prueba 3: se arma antes de cargar la configuración.
const { tzParts, zoned } = await import('../crm/appointments.js');
const { business } = await import('../config.js');
const cfg = business.appointments;
let probe = new Date(Date.now() + 3 * 86400_000);
while (!cfg.days.includes(tzParts(probe).wd)) probe = new Date(probe.getTime() + 86400_000);
const pd = tzParts(probe);
const [oh, om] = cfg.hours[0]![0].split(':').map(Number) as [number, number];
const blockStart = zoned(pd.y, pd.m, pd.d, oh, om);
const blockEnd = new Date(blockStart.getTime() + cfg.durationMin * 60_000);
const ymd = `${pd.y}${String(pd.m).padStart(2, '0')}${String(pd.d).padStart(2, '0')}`;
const utc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const ownerIcs = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:dueno-1', `DTSTART:${utc(blockStart)}`, `DTEND:${utc(blockEnd)}`, 'SUMMARY:Médico', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
const { env } = await import('../config.js');
env.calendarBusyIcs.push(`data:text/calendar;base64,${Buffer.from(ownerIcs).toString('base64')}`);

const { busyFromIcs, syncBusy, busyStatus } = await import('../crm/busy.js');
const { availableSlots, listAppointments, getAppointment } = await import('../crm/appointments.js');
const { appointmentsFeed, appointmentIcs } = await import('../crm/calendar.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${!ok && detail ? `\n   ${detail}` : ''}`);
};
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16);
const sec = (ms: number) => Math.floor(ms / 1000); // iCalendar tiene resolución de segundos

// ---------- 1. Lectura ----------
const GOOGLE = `BEGIN:VCALENDAR
PRODID:-//Google Inc//Google Calendar 70.9054//EN
VERSION:2.0
X-WR-TIMEZONE:America/Bogota
BEGIN:VTIMEZONE
TZID:America/Bogota
BEGIN:STANDARD
TZOFFSETFROM:-0500
TZOFFSETTO:-0500
DTSTART:19700101T000000
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:hora-bogota
DTSTART;TZID=America/Bogota:20260926T150000
DTEND;TZID=America/Bogota:20260926T160000
SUMMARY:Evento con zona
END:VEVENT
BEGIN:VEVENT
UID:hora-utc
DTSTART:20260922T150000Z
DTEND:20260922T160000Z
END:VEVENT
BEGIN:VEVENT
UID:dia-completo
DTSTART;VALUE=DATE:20260924
DTEND;VALUE=DATE:20260925
END:VEVENT
BEGIN:VEVENT
UID:semanal
DTSTART;TZID=America/Bogota:20260921T100000
DTEND;TZID=America/Bogota:20260921T110000
RRULE:FREQ=WEEKLY;BYDAY=MO,WE
EXDATE;TZID=America/Bogota:20260923T100000
SUMMARY:Reunión semanal con un título muy largo que obliga a partir la línea en
  varias partes según el estándar
BEGIN:VALARM
ACTION:DISPLAY
TRIGGER:-PT10M
DTSTART:20000101T000000Z
END:VALARM
END:VEVENT
BEGIN:VEVENT
UID:semanal
RECURRENCE-ID;TZID=America/Bogota:20260928T100000
DTSTART;TZID=America/Bogota:20260928T120000
DTEND;TZID=America/Bogota:20260928T130000
END:VEVENT
BEGIN:VEVENT
UID:cancelado
DTSTART:20260929T150000Z
DTEND:20260929T160000Z
STATUS:CANCELLED
END:VEVENT
BEGIN:VEVENT
UID:libre
DTSTART:20260929T170000Z
DTEND:20260929T180000Z
TRANSP:TRANSPARENT
END:VEVENT
BEGIN:VEVENT
UID:diario
DTSTART;TZID=America/Bogota:20260925T180000
DTEND;TZID=America/Bogota:20260925T190000
RRULE:FREQ=DAILY;COUNT=3
END:VEVENT
BEGIN:VEVENT
UID:mensual
DTSTART;TZID=America/Bogota:20260908T090000
DTEND;TZID=America/Bogota:20260908T100000
RRULE:FREQ=MONTHLY;BYDAY=2TU
END:VEVENT
BEGIN:VEVENT
UID:outlook
DTSTART;TZID="SA Pacific Standard Time":20261001T090000
DTEND;TZID="SA Pacific Standard Time":20261001T100000
END:VEVENT
BEGIN:VEVENT
UID:duracion
DTSTART;TZID=America/Bogota:20261002T080000
DURATION:PT1H30M
END:VEVENT
BEGIN:VEVENT
UID:aiva-appt-7@aiva.local
DTSTART:20261003T150000Z
DTEND:20261003T160000Z
END:VEVENT
END:VCALENDAR`.replace(/\n/g, '\r\n');

const from = Date.UTC(2026, 8, 20, 5);
const to = Date.UTC(2026, 9, 22, 5);
const busy = busyFromIcs(GOOGLE, from, to);
const has = (start: string, end: string) => busy.some((b) => iso(b.start) === start && iso(b.end) === end);
check('hora con zona (TZID America/Bogota)', has('2026-09-26T20:00', '2026-09-26T21:00'));
check('hora en UTC', has('2026-09-22T15:00', '2026-09-22T16:00'));
check('día completo = medianoche a medianoche en Bogotá', has('2026-09-24T05:00', '2026-09-25T05:00'));
check('semanal lunes y miércoles', has('2026-09-21T15:00', '2026-09-21T16:00') && has('2026-09-30T15:00', '2026-09-30T16:00') && has('2026-10-21T15:00', '2026-10-21T16:00'));
check('EXDATE quita el miércoles 23', !busy.some((b) => iso(b.start) === '2026-09-23T15:00'));
check('RECURRENCE-ID mueve el lunes 28 a las 12', has('2026-09-28T17:00', '2026-09-28T18:00') && !busy.some((b) => iso(b.start) === '2026-09-28T15:00'));
check('cancelado y "libre" no ocupan', !busy.some((b) => iso(b.start).startsWith('2026-09-29')));
check('diario con COUNT=3', ['2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28'].map((d) => has(`${d}T23:00`, `${d.slice(0, 8)}${String(Number(d.slice(8)) + 1).padStart(2, '0')}T00:00`)).join() === 'true,true,true,false');
check('mensual segundo martes (13 de octubre)', has('2026-10-13T14:00', '2026-10-13T15:00'));
check('zona de Windows (Outlook)', has('2026-10-01T14:00', '2026-10-01T15:00'));
check('DURATION en vez de DTEND', has('2026-10-02T13:00', '2026-10-02T14:30'));
check('ignora las citas de aiva (no se bloquea a sí mismo)', !busy.some((b) => iso(b.start) === '2026-10-03T15:00'));
const weekly = busy.filter((b) => new Date(b.start).getUTCHours() === 15 && [1, 3].includes(new Date(b.start).getUTCDay()));
check('semanal: 8 ocurrencias en la ventana', weekly.length === 8, `obtuvo ${weekly.length}: ${weekly.map((b) => iso(b.start)).join(', ')}`);

// ---------- 2. Formato de lo que publica aiva ----------
const appts = listAppointments({ from: Date.now() - 60 * 86400_000, limit: 5000 });
const feed = appointmentsFeed();
const lines = feed.split('\r\n');
check('feed: termina en CRLF y sin saltos sueltos', feed.endsWith('\r\n') && !/[^\r]\n/.test(feed));
check('feed: ninguna línea pasa de 75 bytes', lines.every((l) => Buffer.byteLength(l) <= 75), lines.find((l) => Buffer.byteLength(l) > 75));
const opened = lines.filter((l) => l.startsWith('BEGIN:')).length;
const closed = lines.filter((l) => l.startsWith('END:')).length;
check('feed: BEGIN/END balanceados', opened === closed);
const reread = busyFromIcs(feed, 0, Date.now() + 400 * 86400_000, { includeOwn: true });
const confirmed = appts.filter((a) => a.status === 'confirmada');
check(`feed: se relee igual (${confirmed.length} citas confirmadas)`, reread.length === confirmed.length && confirmed.every((a) => reread.some((b) => sec(b.start) === sec(a.startsAt) && sec(b.end) === sec(a.endsAt))), `releídas ${reread.length}: ${reread.map((b) => iso(b.start)).join(', ')} · en la base: ${confirmed.map((a) => iso(a.startsAt)).join(', ')}`);
const one = confirmed[0] ?? appts[0];
if (one) {
  const ics = appointmentIcs(getAppointment(one.id)!);
  check('ics del cliente: recordatorios un día y dos horas antes', ics.includes('TRIGGER:-P1D') && ics.includes('TRIGGER:-PT2H'));
  if (one.location?.includes(',')) check('ics del cliente: comas escapadas en el lugar', ics.includes('LOCATION:' + one.location.replace(/,/g, '\\,')));
} else console.log('(sin citas en la base: se omiten las pruebas del .ics del cliente)');

// ---------- 3. El calendario del dueño bloquea la agenda ----------
await syncBusy();
const st = busyStatus();
check('lectura del calendario del dueño', st.at(-1)?.ok === true && st.at(-1)?.intervals === 1, JSON.stringify(st.at(-1)));
const dayWhen = { days: [`${pd.y}-${String(pd.m).padStart(2, '0')}-${String(pd.d).padStart(2, '0')}`], label: ymd };
const offered = availableSlots({ count: 20, when: dayWhen }).map((s) => s.startsAt.getTime());
check(`el bot no ofrece la hora ocupada (${iso(blockStart.getTime())}Z)`, !offered.includes(blockStart.getTime()), `ofreció: ${offered.map(iso).join(', ')}`);

console.log(`\n${fail ? `${fail} fallos` : 'todo ok'}`);
process.exit(fail ? 1 : 0);
