// Las fichas que cada quien fija en la barra del tablero. Viven en la base del cliente (tabla `settings`) y no en el
// navegador: así siguen a la persona a otro computador o al celular.
//
// «Cada quien» es el nombre con el que responde, lo mismo que decide «Míos». El tablero no tiene usuarios propios
// —se entra con el token del negocio, o por la consola, que le pasa el nombre de la cuenta—, así que el nombre es lo
// único que distingue a una persona de otra. Dos que firmen igual comparten fijados, como comparten «Míos».
//
// Se guardan solo los identificadores. El nombre de cada ficha se lee al pedirlos: si cambió, sale el nuevo; si la
// ficha ya no existe, no sale.
//
// 🪤 Un identificador de WhatsApp ES un teléfono. Por eso, cuando una ficha se borra, se anonimiza o se une con
// otra, se quita de aquí también (reemplazarEnFijados): si no, la retención dejaría el número guardado en los
// ajustes, que es justo lo que promete no dejar.

import { getDb } from '../rag/store.js';
import { getContact } from './contacts.js';
import { getSetting, setSetting } from './settings.js';

export const MAXIMO_FIJADOS = 12;
const PREFIJO = 'fijados:';

/** Mayúsculas y espacios de más no hacen a otra persona: «Laura» y « laura » fijan lo mismo. */
const llave = (nombre: string) => PREFIJO + nombre.trim().replace(/\s+/g, ' ').toLowerCase().slice(0, 40);

export function leerFijados(nombre: string): { id: string; name: string | null }[] {
  if (!nombre.trim()) return [];
  return getSetting<string[]>(llave(nombre), [])
    .map((id) => getContact(id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
    .map((c) => ({ id: c.id, name: c.name }));
}

/** Guarda la lista entera, en el orden en que llega: arriba lo último que se fijó. */
export function guardarFijados(nombre: string, ids: unknown): { id: string; name: string | null }[] {
  if (!nombre.trim()) throw new Error('sin nombre no hay a quién guardarle los fijados');
  if (!Array.isArray(ids)) throw new Error('los fijados van en una lista');
  const limpios = [...new Set(ids.map((x) => String(x)))].filter((id) => getContact(id)).slice(0, MAXIMO_FIJADOS);
  setSetting(llave(nombre), limpios);
  return leerFijados(nombre);
}

/**
 * Cambia una ficha por otra en los fijados de todo el mundo (al unir dos fichas), o la quita (con `null`, al borrarla
 * o anonimizarla). Devuelve en cuántas listas estaba.
 */
export function reemplazarEnFijados(viejo: string, nuevo: string | null): number {
  const db = getDb();
  const filas = db.prepare('SELECT key, value FROM settings WHERE key LIKE ?').all(`${PREFIJO}%`) as { key: string; value: string }[];
  let tocadas = 0;
  for (const f of filas) {
    let ids: string[];
    try {
      ids = JSON.parse(f.value) as string[];
    } catch {
      continue;
    }
    if (!Array.isArray(ids) || !ids.includes(viejo)) continue;
    const cambiados = [...new Set(ids.map((id) => (id === viejo ? nuevo : id)).filter((id): id is string => Boolean(id)))];
    db.prepare('UPDATE settings SET value = ?, updated_at = ? WHERE key = ?').run(JSON.stringify(cambiados), Date.now(), f.key);
    tocadas++;
  }
  return tocadas;
}
