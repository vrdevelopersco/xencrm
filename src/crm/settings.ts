// Ajustes que se cambian desde el tablero (qué canales están encendidos, por ejemplo). Los secretos no van aquí:
// siguen en .env. Si un ajuste no existe, manda el valor por defecto que viene del .env.
import { getDb } from '../rag/store.js';

export function getSetting<T>(key: string, fallback: T): T {
  const r = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  if (!r) return fallback;
  try {
    return JSON.parse(r.value) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(key: string, value: unknown): void {
  getDb()
    .prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .run(key, JSON.stringify(value), Date.now());
}

/** Quita un ajuste: vuelve a mandar el valor por defecto de quien lo lee. */
export function quitarSetting(key: string): void {
  getDb().prepare('DELETE FROM settings WHERE key = ?').run(key);
}
