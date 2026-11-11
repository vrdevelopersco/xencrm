// ¿La dirección pública (PUBLIC_URL, el túnel) llega a este servidor? Si se cae, dejan de funcionar el chat del sitio,
// el webhook de WhatsApp oficial, el calendario en Google/Outlook y el tablero desde el celular, y nadie se entera.
// XENCRM se llama a sí misma por esa dirección cada 5 minutos y compara un código único de este proceso (así también
// detecta que la dirección apunta a otro servidor). Justo después de crear un túnel, este equipo a veces tarda en
// resolver el nombre: por eso solo se da por caída después de 3 fallas seguidas.
import { randomBytes } from 'node:crypto';
import { env } from '../config.js';
import { emitEvent } from '../crm/events.js';

export const INSTANCE = randomBytes(8).toString('hex');
export type PublicState = 'sin_url' | 'revisando' | 'ok' | 'fallando' | 'caida' | 'otro_servidor';
const FAILS_TO_DOWN = 3;

const status = { state: 'revisando' as PublicState, checkedAt: 0, okAt: 0, failingSince: 0, fails: 0, error: '' };
export function publicStatus() {
  return { url: env.publicUrl, ...status };
}

/** El error en palabras de persona. */
function explain(err: unknown, httpStatus?: number): string {
  if (httpStatus === 530 || httpStatus === 1033) return 'Cloudflare no encuentra el túnel (se cerró o cambió de dirección)';
  if (httpStatus) return `la dirección respondió ${httpStatus}`;
  const msg = String((err as { cause?: { code?: string } })?.cause?.code ?? (err as Error)?.message ?? err);
  if (/ENOTFOUND|EAI_AGAIN/.test(msg)) return 'no se encuentra la dirección';
  if (/abort|timeout/i.test(msg)) return 'no respondió en 10 segundos';
  return `no se pudo conectar (${msg.slice(0, 80)})`;
}

export async function checkPublicUrl(fetcher: typeof fetch = fetch): Promise<ReturnType<typeof publicStatus>> {
  const now = Date.now();
  status.checkedAt = now;
  if (!env.publicUrl) {
    Object.assign(status, { state: 'sin_url', fails: 0, failingSince: 0, error: '' });
    return publicStatus();
  }
  let problem = '';
  let other = false;
  try {
    const res = await fetcher(`${env.publicUrl}/health?ping=${now}`, { signal: AbortSignal.timeout(10_000), headers: { 'cache-control': 'no-cache' } });
    if (!res.ok) problem = explain(null, res.status);
    else {
      const body = (await res.json().catch(() => null)) as { instance?: string } | null;
      if (body?.instance !== INSTANCE) {
        other = true;
        problem = 'la dirección responde, pero desde otro servidor';
      }
    }
  } catch (err) {
    problem = explain(err);
  }
  if (!problem) {
    const wasDown = status.state === 'caida' || status.state === 'otro_servidor';
    Object.assign(status, { state: 'ok', okAt: now, fails: 0, failingSince: 0, error: '' });
    if (wasDown) emitEvent('public_up', 'system', { url: env.publicUrl });
    return publicStatus();
  }
  status.fails++;
  status.failingSince ||= now;
  status.error = problem;
  const wasDown = status.state === 'caida' || status.state === 'otro_servidor';
  if (status.fails >= FAILS_TO_DOWN) {
    status.state = other ? 'otro_servidor' : 'caida';
    if (!wasDown) emitEvent('public_down', 'system', { url: env.publicUrl, error: problem, since: status.failingSince });
  } else if (!wasDown) status.state = 'fallando';
  return publicStatus();
}

let timer: NodeJS.Timeout | null = null;
export function startPublicCheck(): void {
  if (timer) return;
  const tick = () => void checkPublicUrl().catch(() => undefined);
  setTimeout(tick, 20_000).unref(); // al arrancar, el túnel puede tardar unos segundos
  timer = setInterval(tick, 5 * 60_000);
  timer.unref();
}
