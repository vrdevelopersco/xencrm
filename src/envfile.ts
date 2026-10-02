// Escribir claves en .env desde el tablero (credenciales de Meta): se cambia solo la línea de cada clave, se
// conserva todo lo demás (comentarios y orden) y se aplica al proceso en marcha.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { ENV_FILE } from './config.js';

export function setEnvValues(values: Record<string, string>, path = ENV_FILE): void {
  const lines = existsSync(path) ? readFileSync(path, 'utf8').split('\n') : [];
  for (const [key, raw] of Object.entries(values)) {
    const value = raw.replace(/[\r\n]/g, '').trim();
    if (/[\s#"']/.test(value)) throw new Error(`${key} no puede tener espacios, comillas ni #`);
    const i = lines.findIndex((l) => l.trim().startsWith(`${key}=`));
    if (i >= 0) lines[i] = `${key}=${value}`;
    else {
      if (lines.length && lines[lines.length - 1] === '') lines.splice(lines.length - 1, 0, `${key}=${value}`);
      else lines.push(`${key}=${value}`);
    }
    process.env[key] = value;
  }
  writeFileSync(path, lines.join('\n').replace(/\n{3,}/g, '\n\n'), { mode: 0o600 });
}

/**
 * Borra claves del `.env`, en vez de dejarlas vacías.
 *
 * 🪤 Vaciar NO es lo mismo que quitar, y la diferencia se paga cara. El `.env` de un cliente se lee ANTES que el
 * de la raíz y lo que ya esté definido no se vuelve a tocar: una línea `OPENAI_API_KEY=` deja la clave en cadena
 * vacía, que sí está definida, así que el cliente deja de heredar la de la casa y se queda SIN NINGUNA. No da
 * error al guardar; da error la próxima vez que alguien escriba.
 */
export function quitarEnvValues(keys: string[], path = ENV_FILE): void {
  if (!existsSync(path) || !keys.length) return;
  const fuera = new Set(keys);
  const lines = readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => {
      const eq = l.indexOf('=');
      return eq === -1 || !fuera.has(l.slice(0, eq).trim());
    });
  for (const k of keys) delete process.env[k];
  writeFileSync(path, lines.join('\n').replace(/\n{3,}/g, '\n\n'), { mode: 0o600 });
}
