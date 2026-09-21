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
