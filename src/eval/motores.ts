// Qué motor hace cada cosa, y que no se pueda guardar algo que deje al cliente mudo. pnpm test:motores
//
// Lo que se prueba aquí no es que sepa escribir un archivo: es que sepa NEGARSE. Esta pantalla cambia, desde un
// navegador, cuál es el cerebro de un cliente en producción, y el efecto no se ve hasta que ese cliente
// reinicia. Para entonces nadie relaciona una cosa con la otra, así que lo que no se puede guardar tiene que
// rebotar aquí, en el momento de guardarlo, con el motivo dicho.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'aiva-motores-'));
const envFile = join(dir, '.env');
// Un .env con comentarios y una clave que no es nuestra: se comprueba abajo que sobreviven intactos.
writeFileSync(
  envFile,
  ['# el archivo de este cliente', 'LLM_ENGINE=router', 'LIGHT_ENGINE=ollama', 'HEAVY_ENGINE=ollama', 'GATE_ENGINE=ollama', 'ANALYSIS_ENGINE=ollama', 'OPENAI_MODEL_HEAVY=gpt-5.4', 'ADMIN_TOKEN=noloquiteses', ''].join('\n'),
);
process.env.AIVA_ENV_FILE = envFile;
process.env.DB_PATH = join(dir, 'prueba.db');

const motores = await import('../motores.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};

// El sondeo lo pone la prueba: aquí no hay ni Ollama ni sidecar de Apple, y lo que se prueba es la DECISIÓN
// —qué se guarda y qué se rechaza—, no si esta máquina tiene algo encendido.
const disponibles = new Set(['ollama']);
const sondeo = async (e: string) =>
  disponibles.has(e) ? { available: true } : { available: false, reason: e === 'apple' ? 'no encontré el sidecar' : 'sin OPENAI_API_KEY' };

const falla = async (fn: () => Promise<unknown>): Promise<string> => {
  try {
    await fn();
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};

const leer = () => readFileSync(envFile, 'utf8');

const ahora = motores.motoresDe();
check('lee lo que corre', ahora.reparto === 'router' && ahora.roles.length === 4);
check('y el modelo propio de un rol', ahora.roles.filter((r) => r.rol === 'heavy')[0]?.modelo === 'gpt-5.4');

// ── Lo que NO se guarda ──
// 🪤 Esto es lo que vuelve la pantalla usable sin miedo. Poner un motor que no responde en esa máquina deja al
// cliente sin atender a nadie, y como solo se nota al reiniciar, nadie ata el cabo. Se dice que no, y por qué.
let motivo = await falla(() => motores.guardarMotores({ roles: [{ rol: 'light', motor: 'apple' }] }, sondeo));
check('🪤 un motor que no responde ahí NO se guarda', motivo.includes('no responde') && motivo.includes('sidecar'), motivo || 'lo guardó');
check('y el archivo se queda como estaba', leer().includes('LIGHT_ENGINE=ollama'));

motivo = await falla(() => motores.guardarMotores({ reparto: 'openai' }, sondeo));
check('ni forzar uno que no responde, para todo', motivo.includes('no responde'), motivo || 'lo guardó');

motivo = await falla(() => motores.guardarMotores({ roles: [{ rol: 'light', motor: 'gemini' as never }] }, sondeo));
check('ni un motor inventado', motivo.includes('no es un motor'), motivo);

motivo = await falla(() => motores.guardarMotores({ roles: [{ rol: 'cocinar' as never, motor: 'ollama' }] }, sondeo));
check('ni un rol inventado', motivo.includes('no es un rol'), motivo);

// 🪤 El nombre del modelo acaba en una línea de un .env, donde un espacio o una comilla lo parten en dos y el
// cliente arranca con basura —o no arranca—. Rebota antes de escribir, no después.
motivo = await falla(() => motores.guardarMotores({ roles: [{ rol: 'heavy', modelo: 'gpt 5.4' }] }, sondeo));
check('🪤 ni un modelo con espacios', motivo.includes('espacios'), motivo);
motivo = await falla(() => motores.guardarMotores({ roles: [{ rol: 'heavy', modelo: 'x'.repeat(200) }] }, sondeo));
check('ni uno absurdamente largo', motivo.includes('largo'), motivo);
motivo = await falla(() => motores.guardarMotores({ roles: [{ rol: 'light', esfuerzo: 'muchísimo' }] }, sondeo));
check('ni un esfuerzo que no existe', motivo.includes('esfuerzo'), motivo);

check('🪤 después de tanto rechazo, el archivo sigue intacto', leer().includes('GATE_ENGINE=ollama') && leer().includes('OPENAI_MODEL_HEAVY=gpt-5.4'));

// ── Lo que sí ──
const r = await motores.guardarMotores({ roles: [{ rol: 'light', motor: 'ollama', modelo: '' }, { rol: 'gate', motor: 'ollama' }] }, sondeo);
check('un motor que sí responde se guarda', leer().includes('LIGHT_ENGINE=ollama'));
// 🪤 Y se dice que hace falta reiniciar. La configuración se lee una vez al arrancar; devolver «listo» a secas
// haría pensar que ya está puesto, y el cliente seguiría contestando con el motor de antes sin que nadie
// entienda por qué.
check('🪤 y avisa de que hay que reiniciar', r.hayQueReiniciar === true);
check('y lo que devuelve es lo que CORRE, no lo que se guardó', r.motores.roles.length === 4);

disponibles.add('openai');
await motores.guardarMotores({ roles: [{ rol: 'analysis', motor: 'openai', modelo: 'gpt-5.4-mini' }] }, sondeo);
check('el modelo del rol se escribe en su variable', /OPENAI_MODEL_ANALYSIS=gpt-5\.4-mini/.test(leer()), leer());

// 🪤 Se tocan unas claves y NO las demás. Un cliente tiene su token, su puerto y sus credenciales en ese mismo
// archivo: reescribirlo entero por cambiar un motor es la forma más fácil de dejarlo sin poder entrar a su
// propio tablero.
check('🪤 no toca lo que no es suyo', leer().includes('ADMIN_TOKEN=noloquiteses'));
check('ni los comentarios', leer().includes('# el archivo de este cliente'));

const vacio = await motores.guardarMotores({}, sondeo);
check('sin cambios, no reescribe ni pide reiniciar', vacio.hayQueReiniciar === false);

rmSync(dir, { recursive: true, force: true });
console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
