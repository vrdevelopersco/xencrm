// Respaldo diario de la base (contactos, conversaciones, citas, fichas): una copia consistente con VACUUM INTO, aunque
// el servidor esté escribiendo, en data/backups/ (BACKUP_DIR), conservando las últimas BACKUP_KEEP (14). Tienen datos
// de clientes: no van al repositorio. Para restaurar: detener XENCRM y copiar la copia elegida sobre DB_PATH.
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { env } from '../config.js';
import { getDb } from './store.js';

const DAY = 24 * 3600_000;
export const backupDir = () => resolve(process.env.BACKUP_DIR || join(dirname(env.dbPath), 'backups'));
const keep = () => Math.max(1, Number(process.env.BACKUP_KEEP || 14));

export interface BackupInfo {
  dir: string;
  count: number;
  last: { file: string; at: number; bytes: number } | null;
}

export function listBackups(): { file: string; at: number; bytes: number }[] {
  const dir = backupDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^xencrm-\d{4}-\d{2}-\d{2}-\d{4}\.db$/.test(f))
    .map((f) => {
      const st = statSync(join(dir, f));
      return { file: join(dir, f), at: st.mtimeMs, bytes: st.size };
    })
    .sort((a, b) => b.at - a.at);
}

export function backupStatus(): BackupInfo {
  const all = listBackups();
  return { dir: backupDir(), count: all.length, last: all[0] ?? null };
}

/** Hace una copia ya y borra las más viejas que BACKUP_KEEP. */
export function backupNow(now = new Date()): { file: string; bytes: number } {
  const dir = backupDir();
  mkdirSync(dir, { recursive: true });
  const p = (n: number) => String(n).padStart(2, '0');
  const name = `xencrm-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.db`;
  const file = join(dir, name);
  if (existsSync(file)) rmSync(file); // dos respaldos en el mismo minuto: vale el último
  getDb().exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  chmodSync(file, 0o600); // datos de clientes: solo el dueño del equipo la lee
  for (const old of listBackups().slice(keep())) rmSync(old.file);
  return { file, bytes: statSync(file).size };
}

let timer: NodeJS.Timeout | null = null;
/** Al arrancar y cada hora: si el último respaldo tiene más de un día (o no hay), respalda. */
export function startBackups(): void {
  if (timer) return;
  const tick = () => {
    try {
      const last = backupStatus().last;
      if (!last || Date.now() - last.at > DAY) {
        const r = backupNow();
        console.log(`[respaldo] ${r.file} (${Math.round(r.bytes / 1024)} KB)`);
      }
    } catch (err) {
      console.warn('[respaldo] no se pudo:', (err as Error).message);
    }
  };
  setTimeout(tick, 60_000).unref();
  timer = setInterval(tick, 3600_000);
  timer.unref();
}
