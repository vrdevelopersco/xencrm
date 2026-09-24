// Arma UN paquete para subir aiva a una plataforma de apps (Hostinger y parecidas), con todos los clientes bajo
// un solo dominio y separados por ruta:
//
//     aiva.hrctechnologies.com/            → la consola
//     aiva.hrctechnologies.com/confia/     → el tablero y el chat de CONFIA
//     aiva.hrctechnologies.com/hrc/        → los de HRC
//
//   pnpm paquete                       usa aiva.hrctechnologies.com
//   pnpm paquete midominio.com
//
// Por qué un solo paquete y no uno por cliente: en estas plataformas cada app es un despliegue, un dominio y un
// juego de variables. Con cinco clientes eso son seis. Aquí se sube una vez y adentro `arranque.js` levanta un
// proceso por cliente —cada uno con su base y su WhatsApp, que es lo que no se puede mezclar— y un enrutador
// delante que reparte por la ruta.
//
// Tres cosas que el paquete resuelve:
//   1. **Ningún secreto viaja dentro.** Tokens y clave de OpenAI se ponen como variables en el panel.
//   2. **Los datos viven fuera del despliegue**, que en estas plataformas estrena carpeta en cada actualización.
//   3. **Va compilado a JavaScript**, no con tsx.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { leerIndice, rutas, type ClienteRef } from './clientes.js';

const DOMINIO = (process.argv[2] ?? 'aiva.hrctechnologies.com').replace(/^https?:\/\//, '').replace(/\/$/, '');
const SALIDA = resolve('paquetes');
const PUERTO_INTERNO = 4100; // los procesos de adentro; nadie los ve desde afuera

const ARRANQUE = String.raw`// Generado por: pnpm paquete — no editar a mano.
//
// Levanta un proceso por cliente y uno para la consola, y pone delante un enrutador que reparte por la ruta:
// /confia/... va al proceso de CONFIA sin el prefijo, y todo lo demás a la consola. Así un solo despliegue atiende
// a todos los clientes sin mezclar sus datos: cada proceso tiene su base, su WhatsApp y su configuración.
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const PUERTO = Number(process.env.PORT || 3000);
const { dominio, puertoInterno, clientes } = JSON.parse(readFileSync(join(aqui, 'clientes.json'), 'utf8'));

// ── Dónde guardar ───────────────────────────────────────────────────────────
// Estas plataformas despliegan en una carpeta nueva cada vez, así que lo que se escriba al lado del código se
// pierde en la siguiente actualización. Se busca un sitio estable; el primero donde se pueda escribir, gana.
let datos = null;
for (const dir of [process.env.AIVA_DATOS, join(homedir(), 'aiva-datos'), resolve(aqui, '..', '..', '..', '..', 'aiva-datos'), join(tmpdir(), 'aiva-datos')].filter(Boolean)) {
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
  console.error('[aiva] no encontré dónde guardar. Define AIVA_DATOS con una ruta donde se pueda escribir.');
  process.exit(1);
}
console.log('[aiva] datos en ' + datos);

const tokenDe = (slug) => process.env['TOKEN_' + slug.toUpperCase().replace(/[^A-Z0-9]/g, '_')] || '';

// ── Un proceso por cliente ──────────────────────────────────────────────────
const hijos = new Map();
function levantar(slug, guion, env, puerto) {
  const hijo = spawn(process.execPath, [join(aqui, guion)], {
    env: { ...process.env, ...env, PORT: String(puerto) },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  hijo.on('exit', (code) => {
    console.error('[aiva] ' + slug + ' se cayó (' + code + '); lo levanto en 5 s');
    setTimeout(() => levantar(slug, guion, env, puerto), 5000);
  });
  hijos.set(slug, { puerto, hijo });
}

clientes.forEach((c, i) => {
  const mio = join(datos, c.slug);
  for (const sub of ['', 'data', 'auth', 'catalogo', 'conocimiento']) mkdirSync(join(mio, sub), { recursive: true });
  // La configuración viaja en el paquete con las rutas de la máquina donde se armó: aquí se reescriben.
  const config = JSON.parse(readFileSync(join(aqui, 'config', c.slug + '.json'), 'utf8'));
  config.dictionaryFile = join(mio, 'dictionary.json');
  config.profileFile = join(mio, 'profile.json');
  config.sources = { ...(config.sources ?? {}), productsFile: join(mio, 'catalogo', 'productos.json'), knowledgeDir: join(mio, 'conocimiento') };
  const configPath = join(mio, 'aiva.config.json');
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  levantar(c.slug, 'dist/index.js', {
    AIVA_CONFIG: configPath,
    DB_PATH: join(mio, 'data', 'aiva.db'),
    WHATSAPP_AUTH_DIR: join(mio, 'auth'),
    ADMIN_TOKEN: tokenDe(c.slug),
    PUBLIC_URL: 'https://' + dominio + '/' + c.slug,
  }, puertoInterno + i);
});

// ── La consola ──────────────────────────────────────────────────────────────
// Se le arma su índice apuntando a los puertos de adentro: ella les habla por ahí, no por internet.
const dirClientes = join(datos, '_consola');
mkdirSync(dirClientes, { recursive: true });
writeFileSync(
  join(dirClientes, 'index.json'),
  JSON.stringify(
    {
      clientes: clientes.map((c, i) => ({
        ...c,
        puerto: puertoInterno + i,
        base: 'http://127.0.0.1:' + (puertoInterno + i),
        host: dominio + '/' + c.slug, // para el enlace "Abrir tablero"
      })),
    },
    null,
    2,
  ),
);
const puertoConsola = puertoInterno + clientes.length;
levantar('consola', 'dist/consola.js', { AIVA_CLIENTES_DIR: dirClientes, CONSOLA_HOST: '127.0.0.1', CONSOLA_PORT: String(puertoConsola) }, puertoConsola);

// ── El enrutador ────────────────────────────────────────────────────────────
function haciaDonde(url) {
  const m = /^\/([a-z0-9][a-z0-9_-]*)(\/.*)?$/i.exec(url.split('?')[0] || '/');
  const destino = m && hijos.get(m[1]);
  if (!destino) return { puerto: puertoConsola, ruta: url, prefijo: '' };
  const resto = url.slice(1 + m[1].length) || '/';
  return { puerto: destino.puerto, ruta: resto.startsWith('/') ? resto : '/' + resto, prefijo: '/' + m[1] };
}

http
  .createServer((pide, responde) => {
    const { puerto, ruta, prefijo } = haciaDonde(pide.url || '/');
    const salida = http.request(
      { host: '127.0.0.1', port: puerto, path: ruta, method: pide.method, headers: { ...pide.headers, host: '127.0.0.1:' + puerto } },
      (r) => {
        const cabeceras = { ...r.headers };
        // Una redirección de adentro no sabe del prefijo: se lo ponemos para que no saque al cliente de su ruta.
        if (prefijo && typeof cabeceras.location === 'string' && cabeceras.location.startsWith('/')) {
          cabeceras.location = prefijo + cabeceras.location;
        }
        responde.writeHead(r.statusCode || 502, cabeceras);
        r.pipe(responde); // sin buffer: así el chat en vivo (SSE) sigue llegando mensaje a mensaje
      },
    );
    salida.on('error', () => {
      responde.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      responde.end('Ese cliente está arrancando o no responde. Intenta en unos segundos.');
    });
    pide.pipe(salida);
  })
  .listen(PUERTO, () => {
    console.log('[aiva] escuchando en ' + PUERTO);
    console.log('[aiva]   https://' + dominio + '/            → la consola');
    for (const c of clientes) console.log('[aiva]   https://' + dominio + '/' + c.slug + '/  → ' + c.nombre);
  });
`;

// ---------- Armar ----------
const clientes: ClienteRef[] = leerIndice();
if (!clientes.length) {
  console.error('No hay clientes dados de alta. Crea al menos uno con: pnpm cliente nuevo');
  process.exit(1);
}

rmSync(SALIDA, { recursive: true, force: true });
mkdirSync(SALIDA, { recursive: true });
const dir = join(SALIDA, 'aiva');
mkdirSync(join(dir, 'config'), { recursive: true });

console.log('→ compilando a JavaScript…');
execFileSync('node_modules/.bin/tsc', ['--noEmit', 'false', '--outDir', join(dir, 'dist')], { stdio: 'inherit' });
cpSync(resolve('public'), join(dir, 'public'), { recursive: true });
for (const c of clientes) cpSync(rutas(c.slug).config, join(dir, 'config', `${c.slug}.json`));

writeFileSync(
  join(dir, 'clientes.json'),
  `${JSON.stringify({ dominio: DOMINIO, puertoInterno: PUERTO_INTERNO, clientes: clientes.map((c) => ({ slug: c.slug, nombre: c.nombre, prioridad: c.prioridad, desde: c.desde })) }, null, 2)}\n`,
);
writeFileSync(join(dir, 'arranque.js'), ARRANQUE);

const base = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { dependencies: Record<string, string> };
writeFileSync(
  join(dir, 'package.json'),
  `${JSON.stringify({ name: 'aiva', private: true, type: 'module', engines: { node: '>=22.13' }, scripts: { start: 'node arranque.js' }, dependencies: base.dependencies }, null, 2)}\n`,
);

const variables = [
  'OPENAI_API_KEY=PONER',
  'OPENAI_MODEL=gpt-5.4-mini',
  'LIGHT_ENGINE=openai',
  'HEAVY_ENGINE=openai',
  'GATE_ENGINE=openai',
  'ANALYSIS_ENGINE=openai',
  'EMBED_ENGINE=openai',
  'CONSOLA_TOKEN=PONER    # la llave maestra de la consola',
  ...clientes.map((c) => `TOKEN_${c.slug.toUpperCase().replace(/[^A-Z0-9]/g, '_')}=PONER    # el token de ${c.nombre}, en clientes/${c.slug}/.env`),
];
writeFileSync(
  join(dir, 'LEEME.txt'),
  [
    'aiva · todos los clientes en un solo despliegue',
    '',
    `Al subirlo queda:`,
    `  https://${DOMINIO}/            la consola (tu pantalla)`,
    ...clientes.map((c) => `  https://${DOMINIO}/${c.slug}/${' '.repeat(Math.max(1, 12 - c.slug.length))}${c.nombre}: su tablero en /${c.slug}/admin y su chat en /${c.slug}/`),
    '',
    'En el panel, al desplegar:',
    '  Versión de Node ........ 24',
    '  Comando de compilación . npm install --omit=dev',
    '  Comando de inicio ...... npm start',
    '',
    'Variables de entorno: cópialas tal cual. Las que dicen «PONER» las reemplazas tú.',
    '',
    ...variables,
    '',
    '(PORT lo pone la plataforma: no lo definas. WhatsApp arranca apagado en cada cliente; se enciende',
    ' desde su tablero, en Canales, cuando vayan a escanear el código.)',
    '',
    'Los datos —base, WhatsApp, perfil, diccionario— NO viven en esta carpeta: van a ~/aiva-datos, fuera del',
    'despliegue. Por eso una actualización no borra nada. Si el panel no deja escribir ahí, define AIVA_DATOS.',
    '',
    'Adentro corre un proceso por cliente, cada uno con su base: lo que no se mezcla no se puede filtrar.',
    '',
  ].join('\n'),
);

execFileSync('zip', ['-q', '-r', `${dir}.zip`, '.', '-x', '.DS_Store'], { cwd: dir });
const mb = (readFileSync(`${dir}.zip`).length / 1024 / 1024).toFixed(1);

console.log(`
════════════════════════════════════════════════════════════════════
  ✓ ${dir}.zip   (${mb} MB)
════════════════════════════════════════════════════════════════════

  Un solo despliegue, y adentro:

     https://${DOMINIO}/            la consola
${clientes.map((c) => `     https://${DOMINIO}/${c.slug}/${' '.repeat(Math.max(1, 12 - c.slug.length))}${c.nombre}`).join('\n')}

  En el panel:  Node 24 · compilar "npm install --omit=dev" · iniciar "npm start"
  Las variables de entorno están en el LEEME.txt de adentro; sin ellas no arranca.
`);
