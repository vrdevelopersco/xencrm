// Qué motor hace cada cosa, y que no se pueda guardar algo que deje al cliente mudo. pnpm test:motores
//
// Lo que se prueba aquí no es que sepa escribir un archivo: es que sepa NEGARSE. Esta pantalla cambia, desde un
// navegador, cuál es el cerebro de un cliente en producción, y el efecto no se ve hasta que ese cliente
// reinicia. Para entonces nadie relaciona una cosa con la otra, así que lo que no se puede guardar tiene que
// rebotar aquí, en el momento de guardarlo, con el motivo dicho.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'xencrm-motores-'));
const envFile = join(dir, '.env');
// Un .env con comentarios y una clave que no es nuestra: se comprueba abajo que sobreviven intactos.
writeFileSync(
  envFile,
  ['# el archivo de este cliente', 'LLM_ENGINE=router', 'LIGHT_ENGINE=ollama', 'HEAVY_ENGINE=ollama', 'GATE_ENGINE=ollama', 'ANALYSIS_ENGINE=ollama', 'OPENAI_MODEL_HEAVY=gpt-5.4', 'ADMIN_TOKEN=noloquiteses', ''].join('\n'),
);
process.env.XENCRM_ENV_FILE = envFile;
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


// ── De quién es la clave de OpenAI ──
// Es lo que separa un producto de una cuenta de OpenAI compartida: cada negocio puede traer la suya y pagar lo
// que gasta. Ya funcionaba por herencia del .env; lo que se prueba aquí es que quitarla no rompa esa herencia.
const { quitarEnvValues } = await import('../envfile.js');
const { setEnvValues } = await import('../envfile.js');

setEnvValues({ OPENAI_API_KEY: 'sk-la-suya-de-mentira' });
check('la clave del cliente se escribe en SU archivo', leer().includes('OPENAI_API_KEY=sk-la-suya-de-mentira'));

// 🪤 Quitar NO es vaciar, y la diferencia se paga cara. El .env del cliente se lee ANTES que el de la raíz y lo
// que ya esté definido no se vuelve a tocar: una línea `OPENAI_API_KEY=` deja la clave en cadena vacía —que sí
// está definida— así que el cliente deja de heredar la de la casa y se queda SIN NINGUNA. No falla al guardar:
// falla la próxima vez que alguien escriba.
quitarEnvValues(['OPENAI_API_KEY']);
check('🪤 quitarla BORRA la línea, no la deja vacía', !/OPENAI_API_KEY=/.test(leer()), leer());
check('y no deja una línea en blanco suelta', !/^\s*$/m.test(leer().replace(/\n$/, '')) || leer().split('\n\n\n').length === 1);
check('🪤 lo demás del archivo sigue intacto', leer().includes('ADMIN_TOKEN=noloquiteses') && leer().includes('# el archivo de este cliente'));

// Y la forma de la clave se mira antes de hablar con nadie.
const { ponerClaveDelCliente } = await import('../motores.js');
check('una clave que no empieza por sk- se rechaza', (await falla(() => ponerClaveDelCliente('hola mundo'))).includes('sk-'));
check('y una con espacios también', (await falla(() => ponerClaveDelCliente('sk-con espacio'))).includes('espacios'));
check('🪤 y ninguna de las dos llegó a escribirse', !/OPENAI_API_KEY/.test(leer()));


// ── Encender y apagar la clave del cliente, sin perderla ──
// Es lo que hace falta para una demostración: se enciende la clave del día y se apaga al terminar, sin volver a
// pegarla cada vez (una clave que se pega a mano se acaba pegando mal justo el día que importa).
const mot = await import('../motores.js');
setEnvValues({ OPENAI_API_KEY: 'sk-la-del-demo' });
check('encendida, consta como suya', mot.claveDelCliente().propia === true);

mot.apagarClaveDelCliente();
const tras = mot.claveDelCliente();
check('apagada, vuelve a la de la casa', tras.propia === false);
// 🪤 Pero NO se pierde: guardada queda en true y se puede encender sin volver a pegarla.
check('🪤 y sigue guardada para encenderla luego', tras.guardada === true, JSON.stringify(tras));
// 🪤 Y lo crítico: la línea viva se BORRA, no se vacía. Una cadena vacía sí está definida y cortaría la
// herencia de la clave de la casa, dejando al cliente sin ninguna.
check('🪤 no queda una OPENAI_API_KEY vacía que corte la herencia', !/^OPENAI_API_KEY=\s*$/m.test(leer()), leer());
check('la aparcada sí está en el archivo', /OPENAI_API_KEY_APAGADA=sk-la-del-demo/.test(leer()));

mot.encenderClaveDelCliente();
check('encenderla la devuelve a su sitio', /^OPENAI_API_KEY=sk-la-del-demo$/m.test(leer()) && mot.claveDelCliente().propia === true);
check('y no deja la aparcada duplicada', !/OPENAI_API_KEY_APAGADA=/.test(leer()), leer());

mot.apagarClaveDelCliente();
mot.quitarClaveDelCliente();
const nada = mot.claveDelCliente();
check('olvidarla la quita de los dos sitios', nada.propia === false && nada.guardada === false);
check('y el archivo queda sin rastro', !/OPENAI_API_KEY/.test(leer()), leer());
check('encender sin nada guardado, lo dice', (await falla(async () => mot.encenderClaveDelCliente())).includes('no tiene ninguna clave'));
check('🪤 y lo demás del archivo sobrevivió a todo el ciclo', leer().includes('ADMIN_TOKEN=noloquiteses') && leer().includes('# el archivo de este cliente'));

rmSync(dir, { recursive: true, force: true });
console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
