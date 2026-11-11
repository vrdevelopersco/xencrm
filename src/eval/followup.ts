// Pruebas de posponer el seguimiento de un prospecto caliente (sin modelo): pnpm test:followup
// "Dejarlo por ahora" lo saca de la lista una semana, sin perder lo que el cliente ya había dicho, y si el cliente
// vuelve a escribir la lista lo trae de nuevo. Base temporal.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'xencrm-follow-')), 'xencrm.db');
const { touchUser, appendMessage } = await import('../agent/memory.js');
const { getContact, updateContact, listEvents } = await import('../crm/contacts.js');
const { isSnoozed, snoozeFollowup } = await import('../crm/followup.js');
const { getDb } = await import('../rag/store.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};
const DAY = 86400_000;

touchUser('web:andres', 'web', 'Andrés');
appendMessage('web:andres', 'user', 'quiero un traje para mi boda', 'consulta');
updateContact('web:andres', { score: 78, data: { prenda: 'traje', ocasion: 'boda', fecha_evento: '6 de diciembre' } }, { silent: true });

const antes = getContact('web:andres')!;
check('un caliente sin posponer entra en la lista', !isSnoozed(antes));

const done = snoozeFollowup('web:andres', 7)!;
const c = getContact('web:andres')!;
check('posponer devuelve hasta cuándo (una semana)', Math.abs(done.until - (Date.now() + 7 * DAY)) < 5000, String(done.until));
check('queda fuera de la lista', isSnoozed(c));
check('no se pierde lo que el cliente dijo', c.data.prenda === 'traje' && c.data.ocasion === 'boda' && c.data.fecha_evento === '6 de diciembre', JSON.stringify(c.data));
check('queda anotado en la línea de tiempo', listEvents('web:andres').some((e) => e.type === 'followup_snooze'));
check('vuelve a la lista cuando pasa la semana', !isSnoozed(c, Date.now() + 8 * DAY));
check('sigue fuera al otro día', isSnoozed(c, Date.now() + DAY));

// Si el cliente escribe durante la semana, hay algo nuevo: vuelve a la lista.
appendMessage('web:andres', 'user', '¿sigue disponible el azul?', 'consulta');
// El mensaje llega un rato después de posponer (si no, la prueba depende del milisegundo exacto).
getDb().prepare('UPDATE users SET last_message_at = ? WHERE id = ?').run(Date.now() + 60_000, 'web:andres');
check('si el cliente vuelve a escribir, vuelve a la lista', !isSnoozed(getContact('web:andres')!, Date.now() + DAY));

// Días fuera de rango
snoozeFollowup('web:andres', 0);
check('menos de un día se vuelve un día', Math.abs(Number(getContact('web:andres')!.data.pospuesto_hasta) - (Date.now() + DAY)) < 5000);
snoozeFollowup('web:andres', 9999);
check('más de 90 días se corta en 90', Math.abs(Number(getContact('web:andres')!.data.pospuesto_hasta) - (Date.now() + 90 * DAY)) < 5000);

check('una ficha que no existe no hace nada', snoozeFollowup('web:nadie') === null);

console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
