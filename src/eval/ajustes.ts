// Pruebas de la configuración editable del cliente (sin modelo): pnpm test:ajustes
// Lo que se guarda desde el tablero va al xencrm.config.json de ESE cliente. Dos cosas importan: que nunca se
// escriba algo con lo que el cliente no arrancaría, y que lo que no se edita desde ahí se quede como estaba.
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Una copia de la configuración de ejemplo: las pruebas no tocan la de ningún cliente de verdad.
const dir = mkdtempSync(join(tmpdir(), 'xencrm-ajustes-'));
const config = join(dir, 'xencrm.config.json');
copyFileSync('xencrm.config.example.json', config);
process.env.XENCRM_CONFIG = config;
process.env.DB_PATH = join(dir, 'xencrm.db');

const { ajustesDe, ajustesEnDisco, guardar, comoSeLee, puedeReiniciarse } = await import('../ajustes.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};
const leer = () => JSON.parse(readFileSync(config, 'utf8')) as Record<string, any>;
const intentar = (cambios: unknown) => {
  try {
    guardar(cambios);
    return '';
  } catch (e) {
    return comoSeLee(e);
  }
};

const base = ajustesDe();
check('lee lo que está corriendo', base.negocio.name === 'Casa Verde' && base.agente.name === 'Xen', JSON.stringify(base.negocio).slice(0, 80));

// --- guardar lo normal ---
const cambiado = JSON.parse(JSON.stringify(base)) as typeof base;
cambiado.negocio.name = 'Casa Verde Barranquilla';
cambiado.agente.style = 'seco y directo';
cambiado.timezone = 'America/Mexico_City';
cambiado.citas.enabled = true;
cambiado.citas.days = [1, 3, 5];
cambiado.citas.hours = [['08:00', '12:00']];
const r = guardar(cambiado);
check('guarda el nombre, el estilo y la zona', leer().business.name === 'Casa Verde Barranquilla' && leer().agent.style === 'seco y directo' && leer().timezone === 'America/Mexico_City');
check('guarda las citas', leer().appointments.enabled === true && leer().appointments.days.join() === '1,3,5');
check('avisa que hay que reiniciar para que se aplique', r.hayQueReiniciar === true);
check('y lo guardado ya se lee distinto de lo que corre', ajustesEnDisco().negocio.name !== ajustesDe().negocio.name);
check('deja una copia del archivo anterior', existsSync(`${config}.anterior`));

// --- lo que NO se toca desde aquí se queda como estaba ---
check('no toca las rutas del catálogo ni del conocimiento', leer().sources.productsFile === 'data/catalog/products.json' && leer().sources.knowledgeDir === 'data/knowledge');
check('ni el embudo, ni lo que captura', JSON.stringify(leer().crm) === JSON.stringify(JSON.parse(readFileSync('xencrm.config.example.json', 'utf8')).crm));
// Lo que el formulario no manda (el recordatorio de la cita, por ejemplo) tiene que sobrevivir a un guardado:
// si no, editar el nombre del negocio apagaría el recordatorio sin que nadie lo pidiera.
const conRecordatorio = leer();
conRecordatorio.appointments.reminder = { enabled: true, at: '18:30' };
conRecordatorio.appointments.askEmail = false;
writeFileSync(config, JSON.stringify(conRecordatorio, null, 2));
guardar({ ...cambiado, negocio: { ...cambiado.negocio, name: 'Casa Verde Centro' } });
check('lo que no vino en el formulario se queda como estaba', leer().appointments.reminder?.at === '18:30' && leer().appointments.askEmail === false, JSON.stringify(leer().appointments).slice(0, 140));

// --- lo que no puede pasar ---
const antes = readFileSync(config, 'utf8');
check('un negocio sin nombre se rechaza', /nombre/.test(intentar({ ...cambiado, negocio: { ...cambiado.negocio, name: '  ' } })));
check('un sitio que no es una dirección, también', /URL|url/.test(intentar({ ...cambiado, negocio: { ...cambiado.negocio, siteUrl: 'casaverde' } })));
check('una zona horaria inventada, también', /zona horaria/.test(intentar({ ...cambiado, timezone: 'America/Macondo' })));
check('un color que no es color, también', /color/.test(intentar({ ...cambiado, marca: { color: 'verde', logo: '' } })));
check('agendar citas sin días no tiene sentido', /día|franja/.test(intentar({ ...cambiado, citas: { ...cambiado.citas, days: [] } })));
check('ni una franja que termina antes de empezar', /antes de empezar/.test(intentar({ ...cambiado, citas: { ...cambiado.citas, hours: [['15:00', '09:00']] } })));
check('y cuando algo se rechaza, el archivo queda intacto', readFileSync(config, 'utf8') === antes);

// --- reiniciar solo donde hay quien lo levante ---
delete process.env.XENCRM_SUPERVISADO;
delete process.env.pm_id;
check('sin supervisor, no se ofrece reiniciar', puedeReiniciarse() === false);
process.env.XENCRM_SUPERVISADO = '1';
check('con el arranque del paquete, sí', puedeReiniciarse() === true);

// --- y lo guardado arranca de verdad ---
writeFileSync(join(dir, 'prueba.json'), readFileSync(config, 'utf8'));
const { loadBusinessConfig } = await import('../config.js');
const releido = loadBusinessConfig(join(dir, 'prueba.json'));
check('lo que quedó guardado se puede volver a cargar', releido.business.name === 'Casa Verde Centro' && releido.appointments.days.join() === '1,3,5', releido.business.name);

// --- 🪤 lo que se guarda, alguien lo tiene que leer ---
// «Primer saludo» se guardaba en el archivo, se enseñaba en el tablero con su pista, y NINGÚN punto del agente
// lo miraba. Quien escribía ahí la frase con la que quiere que reciban a sus clientes veía un campo que no
// hacía nada, sin un error, sin un aviso: creía que ya estaba puesto. Lo encontró una revisión, no una prueba.
//
// Un ajuste solo existe si algo lo lee. Esto comprueba justo eso para los del agente, que son los que se
// escriben a mano y los que nadie nota cuando se caen.
const fuenteAgente = readFileSync(new URL('../agent/agent.ts', import.meta.url), 'utf8');
const fuentePrompts = readFileSync(new URL('../agent/prompts.ts', import.meta.url), 'utf8');
const vivos = fuenteAgente + fuentePrompts;
// En prompts.ts la configuración entra por un alias (`const a = business.agent`), así que valen las dos formas.
for (const ajuste of ['greeting', 'style', 'goal', 'verifyPhrase']) {
  check(`🪤 el ajuste «${ajuste}» lo lee alguien`, new RegExp(`\\b(?:business\\.agent|agent|a)\\.${ajuste}\\b`).test(vivos),
    `se guarda y se enseña en el tablero, pero nada del agente lo usa: es un control que no hace nada`);
}

console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
