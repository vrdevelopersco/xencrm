// Arma los paquetes para subir aiva a una plataforma de apps (Hostinger y parecidas): uno por cliente y uno para
// la consola. En una máquina propia esto no hace falta —ahí corre pm2 con el código tal cual—; esto es para donde
// solo se puede subir un .zip por app.
//
//   pnpm paquete                          usa aiva.hrctechnologies.com como dominio base
//   pnpm paquete midominio.com            con otro dominio
//
// Tres decisiones que vale la pena conocer:
//
//   1. **Ningún secreto viaja en el .zip.** Ni el token del tablero, ni la clave de OpenAI. Esas se ponen como
//      variables de entorno en el panel, que es donde deben estar. El paquete dice cuáles hacen falta.
//   2. **Los datos viven fuera del despliegue.** Estas plataformas estrenan carpeta en cada actualización
//      (…/versions/<uuid>/), así que `arranque.js` busca un sitio estable y apunta allá la base, la sesión de
//      WhatsApp, el diccionario y el perfil. Si no lo hiciera, cada actualización borraría al cliente.
//   3. **Va compilado a JavaScript**, no con tsx: menos dependencias y arranca más rápido.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { leerIndice, rutas, type ClienteRef } from './clientes.js';

const DOMINIO = process.argv[2] ?? 'aiva.hrctechnologies.com';
const SALIDA = resolve('paquetes');
const raiz = (...p: string[]) => resolve(...p);

/** Lo que hace falta para arrancar en cualquier parte: encuentra dónde guardar y deja todo apuntando allá. */
const ARRANQUE = (slug: string, entrada: string, esConsola: boolean) => `// Generado por: pnpm paquete — no editar a mano.
// Busca dónde guardar los datos FUERA de la carpeta del despliegue: estas plataformas estrenan carpeta en cada
// actualización, y lo que quede adentro se pierde. El primer sitio donde se pueda escribir, gana.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const candidatos = [
  process.env.AIVA_DATOS,
  join(homedir(), 'aiva-datos'),
  resolve(aqui, '..', '..', '..', '..', 'aiva-datos'),
  join(tmpdir(), 'aiva-datos'),
].filter(Boolean);

let datos = null;
for (const dir of candidatos) {
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '.escribible'), String(Date.now()));
    datos = dir;
    break;
  } catch {
    /* el siguiente */
  }
}
if (!datos) {
  console.error('No encontré dónde guardar los datos. Define AIVA_DATOS con una ruta donde se pueda escribir.');
  process.exit(1);
}

const mio = join(datos, '${slug}');
for (const sub of ['', 'data', 'auth', 'catalogo', 'conocimiento']) mkdirSync(join(mio, sub), { recursive: true });
console.log('[aiva] datos en ' + mio);
${
  esConsola
    ? `process.env.AIVA_CLIENTES_DIR ||= join(mio, 'clientes');
mkdirSync(process.env.AIVA_CLIENTES_DIR, { recursive: true });`
    : `process.env.DB_PATH ||= join(mio, 'data', 'aiva.db');
process.env.WHATSAPP_AUTH_DIR ||= join(mio, 'auth');

// La configuración viaja en el paquete, pero sus rutas apuntaban a la máquina donde se armó: aquí se reescriben
// a la carpeta de datos y se guarda una copia allá, que es la que lee aiva.
const config = JSON.parse(readFileSync(join(aqui, 'aiva.config.json'), 'utf8'));
config.dictionaryFile = join(mio, 'dictionary.json');
config.profileFile = join(mio, 'profile.json');
config.sources = { ...(config.sources ?? {}), productsFile: join(mio, 'catalogo', 'productos.json'), knowledgeDir: join(mio, 'conocimiento') };
const destino = join(mio, 'aiva.config.json');
writeFileSync(destino, JSON.stringify(config, null, 2));
process.env.AIVA_CONFIG ||= destino;`
}

await import('${entrada}');
`;

function paquete(nombre: string, entrada: string, extras: { config?: string; variables: string[]; nota: string }) {
  const dir = join(SALIDA, nombre);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync(join(SALIDA, '.dist'), join(dir, 'dist'), { recursive: true });
  cpSync(raiz('public'), join(dir, 'public'), { recursive: true });
  if (extras.config) cpSync(extras.config, join(dir, 'aiva.config.json'));

  const base = JSON.parse(readFileSync(raiz('package.json'), 'utf8')) as { dependencies: Record<string, string> };
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify(
      {
        name: `aiva-${nombre}`,
        private: true,
        type: 'module',
        engines: { node: '>=22.13' },
        scripts: { start: 'node arranque.js' },
        dependencies: base.dependencies,
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(dir, 'arranque.js'), ARRANQUE(nombre, entrada, nombre === 'consola'));
  writeFileSync(
    join(dir, 'LEEME.txt'),
    [
      `aiva · ${nombre}`,
      '',
      extras.nota,
      '',
      'En el panel, al desplegar:',
      '  Versión de Node ........ 24',
      '  Comando de compilación . npm install --omit=dev',
      '  Comando de inicio ...... npm start',
      '',
      'Variables de entorno: cópialas tal cual en el panel (sin esto no arranca bien).',
      'Las que dicen «PONER» las reemplazas tú.',
      '',
      ...extras.variables,
      '',
      'Los datos (base, WhatsApp, perfil) NO viven en esta carpeta: van a ~/aiva-datos, fuera del despliegue.',
      'Por eso una actualización no borra nada. Si el panel no deja escribir ahí, define AIVA_DATOS.',
      '',
    ].join('\n'),
  );
  return dir;
}

function zip(dir: string) {
  execFileSync('zip', ['-q', '-r', `${dir}.zip`, '.', '-x', '.DS_Store'], { cwd: dir });
  return `${dir}.zip`;
}

// ---------- Armar ----------
const clientes: ClienteRef[] = leerIndice();
rmSync(SALIDA, { recursive: true, force: true });
mkdirSync(SALIDA, { recursive: true });

console.log('→ compilando a JavaScript…');
execFileSync('node_modules/.bin/tsc', ['--noEmit', 'false', '--outDir', join(SALIDA, '.dist')], { stdio: 'inherit' });

const hechos: { nombre: string; zip: string; dominio: string }[] = [];
for (const c of clientes) {
  const dominio = `${c.slug}.${DOMINIO.split('.').slice(1).join('.')}`;
  const dir = paquete(c.slug, './dist/index.js', {
    config: rutas(c.slug).config,
    nota: `${c.nombre}. Su tablero queda en https://${dominio}/admin y su chat en https://${dominio}/`,
    variables: [
      `ADMIN_TOKEN=PONER    # el token de este cliente: está en clientes/${c.slug}/.env`,
      'OPENAI_API_KEY=PONER',
      `PUBLIC_URL=https://${dominio}`,
      'OPENAI_MODEL=gpt-5.4-mini',
      'LIGHT_ENGINE=openai',
      'HEAVY_ENGINE=openai',
      'GATE_ENGINE=openai',
      'ANALYSIS_ENGINE=openai',
      'WHATSAPP_ENABLED=false',
      '',
      '(PORT lo pone la plataforma: no lo definas.',
      ' WHATSAPP_ENABLED se pone en true desde el tablero, en Canales, cuando vayan a escanear el código.)',
    ],
  });
  hechos.push({ nombre: c.nombre, zip: zip(dir), dominio });
}

const dirConsola = paquete('consola', './dist/consola.js', {
  nota: `La consola: todos los clientes en una pantalla. Queda en https://${DOMINIO}`,
  variables: [
    'CONSOLA_TOKEN=PONER    # la llave maestra, la de tu .env',
    'CONSOLA_HOST=0.0.0.0   # aquí sí: la plataforma es la que publica',
    ...clientes.map((c) => `TOKEN_${c.slug.toUpperCase().replace(/[^A-Z0-9]/g, '_')}=PONER    # el token de ${c.nombre}`),
    '',
    '(PORT lo pone la plataforma: no lo definas.)',
  ],
});
hechos.push({ nombre: 'Consola', zip: zip(dirConsola), dominio: DOMINIO });

rmSync(join(SALIDA, '.dist'), { recursive: true, force: true });

const mb = (p: string) => (readFileSync(p).length / 1024 / 1024).toFixed(1);
console.log(`
════════════════════════════════════════════════════════════════════
  ${hechos.length} paquetes listos en ${SALIDA}
════════════════════════════════════════════════════════════════════
`);
for (const h of hechos) console.log(`  ${h.nombre.padEnd(20)} ${h.zip.split('/').pop()!.padEnd(28)} ${mb(h.zip)} MB → ${h.dominio}`);
console.log(`
  Cada .zip es UNA app en el panel. Dentro de cada uno hay un LEEME.txt
  con las variables de entorno que hay que poner: sin ellas no arranca.

  Ninguno lleva secretos adentro, a propósito.

  Después de subir los clientes, la consola necesita saber dónde quedaron:
     pnpm cliente base <slug> https://<su-dominio>
`);

// El índice guarda dónde vive cada cliente: la consola les habla por ahí en vez de por localhost.
if (clientes.length) console.log(`  (hoy la consola los busca en localhost; con ese comando pasa a buscarlos por su URL)\n`);
