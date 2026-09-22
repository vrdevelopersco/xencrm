// Pruebas de unir fichas de la misma persona (sin modelo): pnpm test:merge
// Se detectan por el número (aunque uno lo tenga en la dirección de WhatsApp y el otro lo haya escrito), y al unir
// no se pierde nada: conversación, citas, análisis, consumo, etiquetas y notas quedan en la ficha que se conserva.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'aiva-merge-')), 'aiva.db');
const { touchUser, appendMessage } = await import('../agent/memory.js');
const { getContact, updateContact, setStage, addEvent, contactNumber, listEvents } = await import('../crm/contacts.js');
const { findDuplicates, keeperOf, mergeContacts } = await import('../crm/merge.js');
const { getDb } = await import('../rag/store.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};
const WEB = 'web:1111-2222';
const WA = 'wa:573001234567@s.whatsapp.net';
const count = (table: string, id: string) => (getDb().prepare(`SELECT COUNT(*) n FROM ${table} WHERE user_id = ?`).get(id) as { n: number }).n;

// Por el chat del sitio: dio su número, tiene conversación, una cita y una etiqueta
touchUser(WEB, 'web', null);
updateContact(WEB, { name: 'Arnulfo Domínguez', phone: '+57 300 123 4567', tags: ['boda'], notes: 'Vino por el sitio.' }, { silent: true });
appendMessage(WEB, 'user', 'quiero alquilar un traje', 'compra');
appendMessage(WEB, 'assistant', 'con gusto', undefined, 'bot');
setStage(WEB, 'interesado');
getDb().prepare("INSERT INTO appointments (user_id, starts_at, ends_at, service, location, status, notes, created_at) VALUES (?, ?, ?, 'cita', null, 'confirmada', '', ?)").run(WEB, Date.now() + 86400_000, Date.now() + 90000_000, Date.now());
getDb().prepare("INSERT INTO llm_usage (ts, user_id, task, engine, model, input_tokens, cached_tokens, output_tokens, reasoning_tokens, ms) VALUES (?, ?, 'light', 'openai', 'x', 10, 0, 5, 0, 100)").run(Date.now(), WEB);
addEvent(WEB, 'stage', { to: 'interesado' });

// Días después escribe por WhatsApp: el número va en la dirección
touchUser(WA, 'whatsapp', 'Arnulfo');
appendMessage(WA, 'user', 'hola, es sobre mi traje', 'compra');
updateContact(WA, { tags: ['whatsapp'] }, { silent: true });

check('el número se reconoce aunque uno lo tenga en la dirección', contactNumber(getContact(WEB)!) === '573001234567' && contactNumber(getContact(WA)!) === '573001234567');
const dups = findDuplicates(WEB);
check('desde una ficha se ve la otra', dups.length === 1 && dups[0]!.contact.id === WA && /mismo número/.test(dups[0]!.reason), JSON.stringify(dups.map((d) => d.contact.id)));
check('se conserva donde escribió más recientemente (WhatsApp)', keeperOf(getContact(WEB)!, getContact(WA)!).keep.id === WA);

const merged = mergeContacts(WA, WEB);
check('la conversación queda completa en una sola ficha', count('messages', WA) === 3 && count('messages', WEB) === 0, `${count('messages', WA)} mensajes`);
check('la cita también', count('appointments', WA) === 1);
check('y el consumo, para que el costo siga siendo de esa persona', count('llm_usage', WA) === 1);
check('la ficha vieja ya no existe', getContact(WEB) === null);
check('se queda con el nombre completo y el número', merged.name === 'Arnulfo' && merged.phone === '+57 300 123 4567', `${merged.name} · ${merged.phone}`);
check('la etapa más avanzada gana', merged.stage === 'interesado', merged.stage);
check('junta etiquetas y deja constancia en las notas', merged.tags.join() === 'whatsapp,boda' && /Vino por el sitio/.test(merged.notes) && /Se unió la ficha de web/.test(merged.notes), JSON.stringify({ tags: merged.tags, notes: merged.notes }));

let msg = '';
try {
  mergeContacts(WA, WA);
} catch (err) {
  msg = (err as Error).message;
}
check('no se une una ficha consigo misma', /misma ficha/.test(msg), msg);
check('sin duplicados no propone nada', findDuplicates(WA).length === 0);

// La misma persona por dos canales: la cita que agendó por el chat del sitio también vale cuando escribe por
// WhatsApp, aunque las fichas todavía no se hayan unido (si no, el bot le ofrece horarios y queda con dos citas).
const { nextAppointmentForPerson } = await import('../crm/appointments.js');
touchUser('web:lucia', 'web', 'Lucía');
appendMessage('web:lucia', 'user', 'quiero una cita', 'cita');
updateContact('web:lucia', { phone: '+573007778899' });
touchUser('wa:573007778899@s.whatsapp.net', 'whatsapp', 'Lucía');
appendMessage('wa:573007778899@s.whatsapp.net', 'user', 'hola', 'saludo');
const manana = Date.now() + 86400_000;
getDb()
  .prepare("INSERT INTO appointments (user_id, starts_at, ends_at, service, location, status, notes, created_at) VALUES (?, ?, ?, 'cita', null, 'confirmada', '', ?)")
  .run('web:lucia', manana, manana + 3600_000, Date.now());
const suya = nextAppointmentForPerson('wa:573007778899@s.whatsapp.net');
check('la cita del otro canal cuenta como suya', suya?.userId === 'web:lucia', String(suya?.userId));
check('la ficha con la cita la ve igual', nextAppointmentForPerson('web:lucia')?.userId === 'web:lucia');
touchUser('web:ajeno', 'web', 'Otro');
check('quien no es la misma persona no hereda citas', nextAppointmentForPerson('web:ajeno') === null);

// Si la cancela desde el otro canal, las dos líneas de tiempo lo cuentan (la cita no cambia de ficha).
const { bookingStep, startBooking } = await import('../crm/booking.js');
await startBooking('wa:573007778899@s.whatsapp.net', 'quiero cancelar mi cita');
await bookingStep('wa:573007778899@s.whatsapp.net', 'sí');
const { getAppointment } = await import('../crm/appointments.js');
const citaId = suya!.id;
check('la cita quedó cancelada aunque sea de la otra ficha', getAppointment(citaId)?.status === 'cancelada', String(getAppointment(citaId)?.status));
check('la nota dice desde dónde la cancelaron', /desde WhatsApp/.test(getAppointment(citaId)?.notes ?? ''), getAppointment(citaId)?.notes);
check('queda en la línea de tiempo de quien escribió', listEvents('wa:573007778899@s.whatsapp.net').some((e) => e.type === 'appointment_cross'));
check('y en la de la ficha donde vive la cita', listEvents('web:lucia').some((e) => e.type === 'appointment_cross'));
check('la cita no se mudó de ficha', getAppointment(citaId)?.userId === 'web:lucia');

console.log(`\n${fail ? `${fail} fallos` : 'todo ok'}`);
process.exit(fail ? 1 : 0);
