// Pruebas de las credenciales de WhatsApp oficial desde el tablero (sin red): pnpm test:meta
// Se validan, solo se guardan si Meta las acepta, van a .env sin tocar lo demás y nunca vuelven completas.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'xencrm-meta-'));
const envFile = join(dir, '.env');
writeFileSync(envFile, '# Máquina de pruebas\nADMIN_TOKEN=abc123\nOPENAI_API_KEY=sk-prueba # clave\n');
process.env.XENCRM_ENV_FILE = envFile;
process.env.DB_PATH = join(dir, 'xencrm.db');
for (const k of ['META_ACCESS_TOKEN', 'META_PHONE_NUMBER_ID', 'META_VERIFY_TOKEN', 'META_APP_SECRET', 'META_API_VERSION']) delete process.env[k];
const { saveMetaCredentials } = await import('../channels/meta-credentials.js');
const { metaStatus } = await import('../channels/meta.js');
const { channelCards } = await import('../channels/registry.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};
const TOKEN = 'EAAGprueba1234567890abcd';
const accept = async () => ({ ok: true as const, phone: '+57 321 610 5383', name: 'DUNOR Boutique' });
const reject = async () => ({ ok: false as const, error: 'Meta respondió 401: Invalid OAuth access token' });
const offline = async () => ({ ok: false as const, network: true, error: 'No se pudo hablar con Meta: fetch failed' });
const envText = () => readFileSync(envFile, 'utf8');

let r = await saveMetaCredentials({ phoneId: '123456789012345' }, accept);
check('sin token no se guarda y dice qué falta', !r.ok && /token de acceso/.test(r.error));
r = await saveMetaCredentials({ token: TOKEN, phoneId: '+57 321 610 5383' }, accept);
check('el número de teléfono no sirve como ID del número', !r.ok && /solo dígitos/.test(r.error));
r = await saveMetaCredentials({ token: TOKEN, phoneId: '123456789012345' }, reject);
check('si Meta las rechaza, no se guardan y se dice por qué', !r.ok && /401/.test(r.error) && !envText().includes('META_') && !metaStatus().configured);

r = await saveMetaCredentials({ token: TOKEN, phoneId: '123456789012345', appSecret: 'secretodelaapp99' }, accept);
check('aceptadas: se guardan y queda verificado', r.ok && r.verified?.phone === '+57 321 610 5383' && metaStatus().configured);
const text = envText();
check('van a .env y lo demás del archivo queda igual', text.includes(`META_ACCESS_TOKEN=${TOKEN}`) && text.startsWith('# Máquina de pruebas\nADMIN_TOKEN=abc123\nOPENAI_API_KEY=sk-prueba # clave\n'), text);
check('si no se da token de verificación, se genera uno', /^[0-9a-f]{24}$/.test(metaStatus().verifyToken));
const card = channelCards().find((c) => c.id === 'meta')!;
check('el tablero nunca recibe el token ni la clave completos', !JSON.stringify(card).includes(TOKEN) && !JSON.stringify(card).includes('secretodelaapp99') && card.credentials?.tokenTail === '…abcd');
check('la tarjeta dice con qué número quedó verificado', /\+57 321 610 5383/.test(card.detail ?? ''), card.detail);

r = await saveMetaCredentials({ version: 'v23.0' }, accept);
check('lo que se deja en blanco conserva su valor', r.ok && envText().includes(`META_ACCESS_TOKEN=${TOKEN}`) && envText().includes('META_API_VERSION=v23.0') && metaStatus().appSecretTail === '…pp99');
r = await saveMetaCredentials({ version: '23' }, accept);
check('versión mal escrita: no se guarda', !r.ok && /v26\.0/.test(r.error));
r = await saveMetaCredentials({ token: 'EAAGotro0000000000wxyz' }, offline);
check('sin conexión con Meta se guarda, avisando que no se verificó', r.ok && !r.verified && /sin verificar/.test(r.warning ?? '') && envText().includes('META_ACCESS_TOKEN=EAAGotro0000000000wxyz'));

console.log(`\n${fail ? `${fail} fallos` : 'todo ok'}`);
process.exit(fail ? 1 : 0);
