// Pruebas del respaldo de la base (sin modelo): pnpm test:backup
// La copia se abre y trae los datos; se conservan las últimas BACKUP_KEEP. Base y carpeta temporales.
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const dir = mkdtempSync(join(tmpdir(), 'aiva-backup-'));
process.env.DB_PATH = join(dir, 'aiva.db');
process.env.BACKUP_DIR = join(dir, 'respaldos');
process.env.BACKUP_KEEP = '3';
const { touchUser, appendMessage } = await import('../agent/memory.js');
const { backupNow, backupStatus, listBackups } = await import('../rag/backup.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};
check('sin respaldos todavía, lo dice', backupStatus().last === null && backupStatus().count === 0);
touchUser('test:respaldo', 'cli', 'Laura');
appendMessage('test:respaldo', 'user', 'hola, quiero una cita', 'cita');
const r = backupNow(new Date(2026, 8, 22, 3, 0));
const copy = new DatabaseSync(r.file, { readOnly: true });
const users = (copy.prepare("SELECT COUNT(*) n FROM users WHERE id = 'test:respaldo'").get() as { n: number }).n;
const msgs = (copy.prepare("SELECT COUNT(*) n FROM messages WHERE user_id = 'test:respaldo'").get() as { n: number }).n;
copy.close();
check('la copia se abre y trae contactos y mensajes', users === 1 && msgs === 1, `${users} contactos, ${msgs} mensajes`);
check('solo la lee el dueño del equipo (600)', (statSync(r.file).mode & 0o777) === 0o600, (statSync(r.file).mode & 0o777).toString(8));
check('el nombre dice la fecha', /aiva-2026-09-22-0300\.db$/.test(r.file), r.file);
for (let d = 23; d <= 27; d++) backupNow(new Date(2026, 8, d, 3, 0));
check('se conservan las últimas 3', listBackups().length === 3 && /aiva-2026-09-27-0300\.db$/.test(backupStatus().last?.file ?? ''), JSON.stringify(listBackups().map((b) => b.file.split('/').pop())));
console.log(`\n${fail ? `${fail} fallos` : 'todo ok'}`);
process.exit(fail ? 1 : 0);
