// Pruebas de archivar y borrar conversaciones (sin modelo): pnpm test:archive
// Archivar la saca de las listas y de las cuentas sin perder nada, y vuelve sola si el cliente escribe.
// Borrar se lleva todo lo suyo. Base temporal.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'xencrm-arch-')), 'xencrm.db');
const { touchUser, appendMessage } = await import('../agent/memory.js');
const { getContact, listContacts, setArchived, deleteContact, stats, updateContact } = await import('../crm/contacts.js');
const { getDb } = await import('../rag/store.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};
const ids = (opts?: { archived?: boolean }) => listContacts(opts).map((c) => c.id);
const rows = (table: string, id: string) => (getDb().prepare(`SELECT COUNT(*) n FROM ${table} WHERE user_id = ?`).get(id) as { n: number }).n;

for (const id of ['web:real', 'web:spam']) {
  touchUser(id, 'web', id === 'web:real' ? 'Cliente' : 'Spam');
  appendMessage(id, 'user', 'hola', 'saludo');
}
updateContact('web:spam', { score: 70 }, { silent: true });
getDb().prepare("INSERT INTO appointments (user_id, starts_at, ends_at, service, location, status, notes, created_at) VALUES (?, ?, ?, 'cita', null, 'confirmada', '', ?)").run('web:spam', Date.now() + 86400_000, Date.now() + 90000_000, Date.now());
getDb().prepare("INSERT INTO llm_usage (ts, user_id, task, engine, model, input_tokens, cached_tokens, output_tokens, reasoning_tokens, ms) VALUES (?, ?, 'light', 'openai', 'x', 10, 0, 5, 0, 100)").run(Date.now(), 'web:spam');

check('las dos están en la lista', ids().length === 2 && stats().total === 2);
setArchived('web:spam', true);
check('archivada: sale de la lista', ids().join() === 'web:real');
check('y de las cuentas del tablero', stats().total === 1 && stats().hot === 0, JSON.stringify({ total: stats().total, hot: stats().hot }));
check('pero no se perdió nada', rows('messages', 'web:spam') === 1 && rows('appointments', 'web:spam') === 1 && getContact('web:spam')?.archived === true);
check('se ve con el filtro de archivados', ids({ archived: true }).join() === 'web:spam');
setArchived('web:spam', false);
check('devolver a las listas la trae de vuelta', ids().length === 2 && getContact('web:spam')?.archived === false);

setArchived('web:spam', true);
touchUser('web:spam', 'web', null); // el cliente vuelve a escribir
check('si el cliente escribe de nuevo, reaparece sola', getContact('web:spam')?.archived === false);

check('borrar: se lleva la ficha y todo lo suyo', deleteContact('web:spam') && getContact('web:spam') === null && rows('messages', 'web:spam') === 0 && rows('appointments', 'web:spam') === 0 && rows('llm_usage', 'web:spam') === 0);
check('lo demás queda intacto', ids().join() === 'web:real' && rows('messages', 'web:real') === 1);
check('borrar algo que no existe no rompe', deleteContact('web:spam') === false);

console.log(`\n${fail ? `${fail} fallos` : 'todo ok'}`);
process.exit(fail ? 1 : 0);
