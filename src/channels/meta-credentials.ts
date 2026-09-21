// Credenciales de WhatsApp oficial desde el tablero: se validan, se verifican con Meta, se guardan en .env (no en la
// base ni en el repositorio) y se aplican sin reiniciar. Lo que se deja en blanco conserva el valor anterior.
import { randomBytes } from 'node:crypto';
import { setEnvValues } from '../envfile.js';
import { applyMetaCredentials, metaStatus, verifyMeta, type MetaCredentials } from './meta.js';

export interface MetaCredentialsInput {
  token?: string;
  phoneId?: string;
  verifyToken?: string;
  appSecret?: string;
  version?: string;
}

const ENV_KEYS: Record<keyof MetaCredentials, string> = {
  token: 'META_ACCESS_TOKEN',
  phoneId: 'META_PHONE_NUMBER_ID',
  verifyToken: 'META_VERIFY_TOKEN',
  appSecret: 'META_APP_SECRET',
  version: 'META_API_VERSION',
};

export type SaveResult =
  | { ok: true; verified: { phone: string; name: string } | null; warning?: string; status: ReturnType<typeof metaStatus> }
  | { ok: false; error: string };

/** Valida, verifica con Meta y guarda. `verify` se puede reemplazar en pruebas. */
export async function saveMetaCredentials(input: MetaCredentialsInput, verify = verifyMeta): Promise<SaveResult> {
  const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const current = metaStatus();
  const next = {
    token: clean(input.token) || null,
    phoneId: clean(input.phoneId) || current.phoneId,
    verifyToken: clean(input.verifyToken) || current.verifyToken || randomBytes(12).toString('hex'),
    appSecret: clean(input.appSecret) || null,
    version: clean(input.version) || current.version,
  };
  const token = next.token ?? process.env.META_ACCESS_TOKEN ?? '';
  const appSecret = next.appSecret ?? process.env.META_APP_SECRET ?? '';
  if (!token) return { ok: false, error: 'Falta el token de acceso (META_ACCESS_TOKEN).' };
  if (!/^\d{6,20}$/.test(next.phoneId)) return { ok: false, error: 'El ID del número son solo dígitos (lo da Meta en WhatsApp › Configuración de la API; no es el número de teléfono).' };
  if (!/^v\d{1,3}\.\d$/.test(next.version)) return { ok: false, error: 'La versión de la API se escribe como v21.0.' };
  if (/\s/.test(token) || /\s/.test(appSecret) || /\s/.test(next.verifyToken)) return { ok: false, error: 'Los tokens no llevan espacios: revisa que se hayan copiado completos.' };

  const check = await verify({ token, phoneId: next.phoneId, version: next.version });
  // Si Meta dice que no, no se guarda: un error de tipeo no debe tumbar una configuración que funciona.
  if (!check.ok && !check.network) return { ok: false, error: check.error };

  const values: Partial<MetaCredentials> = { phoneId: next.phoneId, verifyToken: next.verifyToken, version: next.version, token };
  if (next.appSecret) values.appSecret = next.appSecret;
  setEnvValues(Object.fromEntries(Object.entries(values).map(([k, v]) => [ENV_KEYS[k as keyof MetaCredentials], v as string])));
  applyMetaCredentials(values, check.ok ? { phone: check.phone, name: check.name } : undefined);
  return {
    ok: true,
    verified: check.ok ? { phone: check.phone, name: check.name } : null,
    ...(check.ok ? {} : { warning: `Se guardaron sin verificar. ${check.error}` }),
    status: metaStatus(),
  };
}
