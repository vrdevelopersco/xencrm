// Pruebas del alta de clientes (sin modelo): pnpm test:clientes
// Cada cliente queda con su carpeta, su base, su WhatsApp, su token y su puerto, y de ahí salen el ecosystem de
// pm2 y el ingress del túnel. Todo en una carpeta temporal: no toca los clientes de verdad.
import { mkdtempSync, existsSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = mkdtempSync(join(tmpdir(), 'aiva-clientes-'));
process.env.AIVA_CLIENTES_DIR = base;
const { crearCliente, leerIndice, puertoLibre, pm2Config, tunelConfig, rutas, slugificar } = await import('../clientes.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};

const { cliente: dunor, token: tokenDunor } = crearCliente({ nombre: 'DUNOR Boutique', host: 'dunor.aiva.co', prioridad: 'alta', hoy: '2026-09-23' });
const { cliente: fin, token: tokenFin } = crearCliente({ nombre: 'Financiera del Caribe', prioridad: 'media', hoy: '2026-09-23' });

check('el identificador sale del nombre, sin tildes ni espacios', dunor.slug === 'dunor-boutique' && fin.slug === 'financiera-del-caribe', `${dunor.slug} · ${fin.slug}`);
check('los puertos no se pisan', dunor.puerto === 3001 && fin.puerto === 3002, `${dunor.puerto} · ${fin.puerto}`);
check('el siguiente que entre toma el que sigue', puertoLibre() === 3003, String(puertoLibre()));
check('cada uno con su token', tokenDunor !== tokenFin && tokenDunor.length >= 32);
check('quedan los dos en el índice, ordenados', leerIndice().map((c) => c.slug).join() === 'dunor-boutique,financiera-del-caribe');

const r = rutas('dunor-boutique');
check('tiene su configuración, su base, su WhatsApp', existsSync(r.config) && existsSync(r.data) && existsSync(r.auth));
check('el .env del cliente no se lee desde afuera', (statSync(r.env).mode & 0o077) === 0, (statSync(r.env).mode & 0o777).toString(8));

const env = readFileSync(r.env, 'utf8');
check('su .env trae lo suyo: puerto, base, WhatsApp, token y dominio', /PORT=3001/.test(env) && /DB_PATH=.*dunor-boutique\/data\/aiva\.db/.test(env) && /ADMIN_TOKEN=/.test(env) && /PUBLIC_URL=https:\/\/dunor\.aiva\.co/.test(env), env);
check('y NO repite las claves de la máquina', !/OPENAI_API_KEY/.test(env), env);

const config = JSON.parse(readFileSync(r.config, 'utf8')) as { business: { name: string }; dictionaryFile: string; profileFile: string };
check('la configuración queda a nombre del negocio', config.business.name === 'DUNOR Boutique', config.business.name);
check('el diccionario y el perfil viven con el cliente', config.dictionaryFile.includes('dunor-boutique') && config.profileFile.includes('dunor-boutique'), config.dictionaryFile);

const pm2 = pm2Config();
check('pm2 lleva una app por cliente', /aiva-dunor-boutique/.test(pm2) && /aiva-financiera-del-caribe/.test(pm2));
check('cada app apunta a la configuración y al .env de su cliente', /AIVA_CONFIG.*dunor-boutique/.test(pm2) && /AIVA_ENV_FILE.*financiera-del-caribe/.test(pm2));
check('y se reinicia sola si se cae', /max_restarts/.test(pm2) && /restart_delay/.test(pm2));

const tunel = tunelConfig();
check('el túnel manda cada dominio a su puerto', /hostname: dunor\.aiva\.co\n\s+service: http:\/\/localhost:3001/.test(tunel), tunel);
check('quien no tiene dominio no aparece en el túnel', !/financiera/.test(tunel), tunel);
check('lo que no coincida no cae en el cliente equivocado', /http_status:404/.test(tunel));

let err = '';
try {
  crearCliente({ nombre: 'DUNOR Boutique' });
} catch (e) {
  err = (e as Error).message;
}
check('no se puede dar de alta dos veces el mismo', /ya existe/.test(err), err);

err = '';
try {
  crearCliente({ nombre: 'Otro', puerto: 3001 });
} catch (e) {
  err = (e as Error).message;
}
check('ni robarle el puerto a otro', /puerto 3001/.test(err), err);

check('un nombre que no da identificador se rechaza', (() => { try { crearCliente({ nombre: '¿¡!' }); return false; } catch { return true; } })());
check('los identificadores se limpian', slugificar('Litografía Industrial S.A.S.') === 'litografia-industrial-s-a-s', slugificar('Litografía Industrial S.A.S.'));

console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
