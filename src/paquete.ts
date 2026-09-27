// Arma UN paquete para subir aiva a una plataforma de apps (Hostinger y parecidas), con todos los clientes bajo
// un solo dominio y separados por ruta:
//
//     aiva.hrctechnologies.com/            → la portada: qué es aiva
//     aiva.hrctechnologies.com/consola     → la consola (vigilancia y atención)
//     aiva.hrctechnologies.com/confia/     → el tablero y el chat de CONFIA
//     aiva.hrctechnologies.com/hrc/        → los de HRC
//
//   pnpm paquete                       usa aiva.hrctechnologies.com
//   pnpm paquete midominio.com
//
// Por qué un solo paquete y no uno por cliente: en estas plataformas cada app es un despliegue, un dominio y un
// juego de variables. Con cinco clientes eso son seis. Aquí se sube una vez y adentro `app.js` levanta un
// proceso por cliente —cada uno con su base y su WhatsApp, que es lo que no se puede mezclar— y un enrutador
// delante que reparte por la ruta.
//
// Tres cosas que el paquete resuelve:
//   1. **Ningún secreto viaja dentro.** Tokens y clave de OpenAI se ponen como variables en el panel.
//   2. **Los datos viven fuera del despliegue**, que en estas plataformas estrena carpeta en cada actualización.
//   3. **Va compilado a JavaScript**, no con tsx.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { leerIndice, rutas, type ClienteRef } from './clientes.js';

const DOMINIO = (process.argv[2] ?? 'aiva.hrctechnologies.com').replace(/^https?:\/\//, '').replace(/\/$/, '');
const SALIDA = resolve('paquetes');
const PUERTO_INTERNO = 4100; // los procesos de adentro; nadie los ve desde afuera

const ARRANQUE = String.raw`// Generado por: pnpm paquete — no editar a mano.
//
// Levanta un proceso por cliente y uno para la consola, y pone delante un enrutador que reparte por la ruta:
// / es la portada, /confia/... va al proceso de CONFIA sin el prefijo, y lo demás a la consola. Así un despliegue atiende
// a todos los clientes sin mezclar sus datos: cada proceso tiene su base, su WhatsApp y su configuración.
//
// 🪤 Este archivo es CommonJS a propósito, y por eso la carpeta no declara "type": "module" (lo declara dist/,
// que sí es ESM). El servidor de estas plataformas —LiteSpeed— no ejecuta "npm start": hace require() del archivo
// de inicio dentro de su propio proceso. Un require() de un módulo ESM con await arriba revienta con
// ERR_REQUIRE_ASYNC_MODULE. Los hijos sí arrancan como se debe, con node, y siguen siendo ESM.
const { spawn } = require('node:child_process');
const http = require('node:http');
const { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } = require('node:fs');
const { homedir, tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

const aqui = __dirname;
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
let cerrando = false;
function levantar(slug, guion, env, puerto) {
  if (cerrando) return;
  const hijo = spawn(process.execPath, [join(aqui, guion)], {
    env: { ...process.env, ...env, PORT: String(puerto) },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  hijo.on('exit', (code) => {
    if (cerrando) return;
    console.error('[aiva] ' + slug + ' se cayó (' + code + '); lo levanto en 5 s');
    setTimeout(() => levantar(slug, guion, env, puerto), 5000);
  });
  hijos.set(slug, { puerto, hijo });
}

// Si se van sin nosotros, los hijos quedan agarrando sus puertos y la siguiente versión no puede arrancar: da
// EADDRINUSE y uno se vuelve loco buscando el error en el código nuevo. Al cerrar, se van todos.
function cerrar(senal) {
  if (cerrando) return;
  cerrando = true;
  for (const [slug, h] of hijos) {
    try {
      h.hijo.kill(senal === 'SIGKILL' ? 'SIGKILL' : 'SIGTERM');
    } catch {
      console.error('[aiva] no pude cerrar ' + slug);
    }
  }
  setTimeout(() => process.exit(0), 1500).unref();
}
for (const s of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(s, () => cerrar(s));
process.on('exit', () => cerrar('SIGKILL'));

// Aquí no hay Ollama ni va a haberlo: si al panel se le olvidó una variable, igual se usa OpenAI en vez de
// quedarse esperando un modelo local que no existe. Lo que sí esté en el panel manda sobre esto.
const porDefecto = {
  LIGHT_ENGINE: process.env.LIGHT_ENGINE || 'openai',
  HEAVY_ENGINE: process.env.HEAVY_ENGINE || 'openai',
  GATE_ENGINE: process.env.GATE_ENGINE || 'openai',
  ANALYSIS_ENGINE: process.env.ANALYSIS_ENGINE || 'openai',
  EMBED_ENGINE: process.env.EMBED_ENGINE || 'openai',
  // Aquí hay quien los vuelva a levantar (este mismo arranque), así que el tablero puede ofrecer reiniciar para
  // aplicar un cambio de configuración sin miedo a dejar al cliente abajo.
  AIVA_SUPERVISADO: '1',
  // WhatsApp arranca apagado: se enciende desde el tablero de cada cliente, en Canales, cuando vayan a escanear
  // el código. Esto es solo el arranque de fábrica; una vez lo prenden, queda prendido en su base.
  WHATSAPP_ENABLED: process.env.WHATSAPP_ENABLED || 'false',
  // Al vincular el WhatsApp de un negocio de verdad, lo prudente es mirar antes de hablar: entra todo al CRM, se
  // lee lo que ya estaba conversado para aprender cómo atienden, y el asistente se queda callado hasta que el
  // negocio le dé voz desde el tablero (Canales › Contesta Aiva).
  WHATSAPP_SOLO_ESCUCHAR: process.env.WHATSAPP_SOLO_ESCUCHAR || 'true',
  // 🪤 Pedir TODO el historial al vincular tumba la vinculación: WhatsApp cierra con 428 antes de enseñar el
  // código, en bucle, sin decir por qué. Costó medio día de diagnóstico creyendo que era el alojamiento. Se
  // queda apagado; lo ya conversado se trae aparte, exportando el chat (Perfil › Lo que aprendimos de sus chats).
  WHATSAPP_IMPORT_HISTORY: process.env.WHATSAPP_IMPORT_HISTORY || 'false',
};

clientes.forEach((c, i) => {
  const mio = join(datos, c.slug);
  for (const sub of ['', 'data', 'auth', 'catalogo', 'conocimiento']) mkdirSync(join(mio, sub), { recursive: true });
  // La configuración viaja en el paquete con las rutas de la máquina donde se armó: aquí se reescriben.
  //
  // 🪤 Si el cliente ya tiene la suya en los datos, manda ESA: ahí están los cambios que hicieron desde el
  // tablero (nombre, asistente, citas, marca), y pisarlos en cada actualización sería borrarles el trabajo. La
  // que trae el paquete solo se usa la primera vez.
  const configPath = join(mio, 'aiva.config.json');
  const deFabrica = join(aqui, 'config', c.slug + '.json');
  const config = JSON.parse(readFileSync(existsSync(configPath) ? configPath : deFabrica, 'utf8'));
  config.dictionaryFile = join(mio, 'dictionary.json');
  config.profileFile = join(mio, 'profile.json');
  config.sources = { ...(config.sources ?? {}), productsFile: join(mio, 'catalogo', 'productos.json'), knowledgeDir: join(mio, 'conocimiento') };
  // La marca del cliente: se copia a sus datos la primera vez (ahí la pueden cambiar) y las rutas se reescriben
  // a donde de verdad quedó.
  const marcaDeFabrica = join(aqui, 'config', c.slug + '-marca');
  const miMarca = join(mio, 'marca');
  if (existsSync(marcaDeFabrica) && !existsSync(miMarca)) cpSync(marcaDeFabrica, miMarca, { recursive: true });
  if (config.brand) {
    for (const cual of ['logo', 'logoOscuro', 'favicon']) {
      const v = config.brand[cual];
      if (typeof v === 'string' && v && !/^https?:/.test(v)) config.brand[cual] = join(miMarca, v.split('/').pop());
    }
  }
  // 🪤 Y si el cliente TIENE marca pero su configuración no la nombra, se toma lo que haya en su carpeta. Pasa
  // al restaurar un respaldo que se armó antes de que ese cliente tuviera logos: la configuración vuelve sin
  // marca, el tablero sale sin logo y /brand/logo contesta 404 sin que nadie entienda por qué.
  if (existsSync(miMarca)) {
    config.brand = config.brand || {};
    const hay = readdirSync(miMarca);
    const buscar = (re) => hay.find((f) => re.test(f));
    const poner = (cual, re) => {
      if (config.brand[cual]) return;
      const f = buscar(re);
      if (f) config.brand[cual] = join(miMarca, f);
    };
    poner('logoOscuro', /oscuro|dark/i);
    poner('favicon', /favicon|icono?\b/i);
    poner('logo', /logo/i);
  }
  // Los ejemplos del modo demo viajan con el paquete: sin esto, en el servidor el botón dice "este cliente no
  // trae ejemplos" aunque sí los tenga en el repositorio. Son de fábrica, así que se refrescan en cada subida.
  const semillaDeFabrica = join(aqui, 'config', c.slug + '-seed.json');
  if (existsSync(semillaDeFabrica)) {
    const miSemilla = join(mio, 'seed.json');
    cpSync(semillaDeFabrica, miSemilla);
    config.seedFile = miSemilla;
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  levantar(c.slug, 'dist/index.js', {
    ...porDefecto,
    AIVA_CONFIG: configPath,
    AIVA_SLUG: c.slug,
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
// La portada: una página que explica qué es aiva. La sirve el enrutador mismo, sin molestar a nadie, porque es
// lo único que ve quien llega al dominio pelado. La consola queda en /consola, y sus llamadas (/api/...) siguen
// saliendo de la raíz, que es a donde van por defecto.
const PORTADA = (() => {
  try {
    return readFileSync(join(aqui, 'public', 'inicio.html'));
  } catch {
    return null;
  }
})();

// Lo que la portada necesita al lado (el logo, por ahora). Un solo tramo, sin barras ni puntos dobles: nadie
// pide "../../.env" por aquí. Y solo tipos que se sirven tal cual.
const TIPOS = { png: 'image/png', jpg: 'image/jpeg', svg: 'image/svg+xml', webp: 'image/webp', ico: 'image/x-icon', css: 'text/css; charset=utf-8' };
function archivoDeLaPortada(camino) {
  const m = /^\/([a-z0-9][a-z0-9._-]*)\.(png|jpg|svg|webp|ico|css)$/i.exec(camino);
  if (!m || camino.includes('..')) return null;
  try {
    return { cuerpo: readFileSync(join(aqui, 'public', m[1] + '.' + m[2])), tipo: TIPOS[m[2].toLowerCase()] };
  } catch {
    return null;
  }
}

function haciaDonde(url) {
  const camino = url.split('?')[0] || '/';
  if (camino === '/consola' || camino === '/consola/') return { puerto: puertoConsola, ruta: '/', prefijo: '' };
  const m = /^\/([a-z0-9][a-z0-9_-]*)(\/.*)?$/i.exec(camino);
  const destino = m && hijos.get(m[1]);
  if (!destino) return { puerto: puertoConsola, ruta: url, prefijo: '' };
  const resto = url.slice(1 + m[1].length) || '/';
  return { puerto: destino.puerto, ruta: resto.startsWith('/') ? resto : '/' + resto, prefijo: '/' + m[1] };
}

/**
 * 🪤 No abrir la puerta hasta que los de adentro contesten.
 *
 * Al subir una versión nueva, este enrutador arranca en un segundo y los procesos de cada cliente tardan diez o
 * quince. En ese hueco, quien entrara se llevaba un 502 —le pasó a alguien justo al ir a iniciar sesión, y el
 * mensaje que veía era «el servidor contestó 502», que no dice nada y parece que todo está roto—. Así que se
 * espera a que respondan, con un tope: si alguno no levanta, igual se abre, porque es mejor un cliente caído
 * que todos.
 */
const listo = (puerto) =>
  new Promise((res) => {
    const r = http.request({ host: '127.0.0.1', port: puerto, path: '/health', timeout: 1500 }, (x) => {
      x.resume();
      res(true);
    });
    r.on('error', () => res(false));
    r.on('timeout', () => {
      r.destroy();
      res(false);
    });
    r.end();
  });

async function esperarALosDeAdentro(maxMs = 30000) {
  const puertos = [puertoConsola, ...[...hijos.values()].map((h) => h.puerto)];
  const hasta = Date.now() + maxMs;
  for (;;) {
    const estados = await Promise.all(puertos.map(listo));
    const faltan = estados.filter((x) => !x).length;
    if (!faltan) {
      console.log('[aiva] todos adentro listos');
      return;
    }
    if (Date.now() > hasta) {
      console.log('[aiva] abro igual: ' + faltan + ' de ' + puertos.length + ' no contestaron a tiempo');
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

const servidor = http.createServer((pide, responde) => {
    const camino = (pide.url || '/').split('?')[0];
    if (PORTADA && (camino === '/' || camino === '/index.html')) {
      responde.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
      responde.end(pide.method === 'HEAD' ? undefined : PORTADA);
      return;
    }
    const suelto = archivoDeLaPortada(camino);
    if (suelto) {
      responde.writeHead(200, { 'content-type': suelto.tipo, 'cache-control': 'public, max-age=86400' });
      responde.end(pide.method === 'HEAD' ? undefined : suelto.cuerpo);
      return;
    }
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
      responde.writeHead(503, { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '5' });
      responde.end('Todavía está arrancando. Vuelve a intentar en unos segundos.');
    });
    pide.pipe(salida);
});

// 🪤 El await de nivel superior no existe aquí: este lanzador es CommonJS porque el servidor del alojamiento lo
// carga con require. Por eso se encadena en vez de esperar.
void esperarALosDeAdentro().then(() =>
  servidor.listen(PUERTO, () => {
    console.log('[aiva] escuchando en ' + PUERTO);
    console.log('[aiva]   https://' + dominio + '/            → qué es aiva');
    console.log('[aiva]   https://' + dominio + '/consola     → la consola (tu pantalla)');
    for (const c of clientes) console.log('[aiva]   https://' + dominio + '/' + c.slug + '/  → ' + c.nombre);
  }),
);
`;

// ---------- Armar ----------
const clientes: ClienteRef[] = leerIndice();
if (!clientes.length) {
  console.error('No hay clientes dados de alta. Crea al menos uno con: pnpm cliente nuevo');
  process.exit(1);
}

// 🪤 Se borra SOLO lo que este guion crea. Antes barría `paquetes/` entera y se llevó por delante archivos que
// alguien había dejado ahí (unas credenciales, en su momento): una carpeta de salida no es una carpeta propia.
mkdirSync(SALIDA, { recursive: true });
const dir = join(SALIDA, 'aiva');
rmSync(dir, { recursive: true, force: true });
rmSync(`${dir}.zip`, { force: true });
mkdirSync(join(dir, 'config'), { recursive: true });

console.log('→ compilando a JavaScript…');
execFileSync('node_modules/.bin/tsc', ['--noEmit', 'false', '--outDir', join(dir, 'dist')], { stdio: 'inherit' });
cpSync(resolve('public'), join(dir, 'public'), { recursive: true });
for (const c of clientes) {
  cpSync(rutas(c.slug).config, join(dir, 'config', `${c.slug}.json`));
  // Su marca (logos, favicon) viaja con él: sin esto, en el servidor apunta a archivos que no existen.
  const marca = join(rutas(c.slug).dir, 'marca');
  if (existsSync(marca)) cpSync(marca, join(dir, 'config', `${c.slug}-marca`), { recursive: true });
  // Y sus ejemplos de demostración, que viven fuera de la carpeta del cliente (`seedFile` en su configuración).
  const suConfig = JSON.parse(readFileSync(rutas(c.slug).config, 'utf8')) as { seedFile?: string };
  const semilla = suConfig.seedFile ? resolve(suConfig.seedFile) : '';
  if (semilla && existsSync(semilla)) cpSync(semilla, join(dir, 'config', `${c.slug}-seed.json`));
}

writeFileSync(
  join(dir, 'clientes.json'),
  `${JSON.stringify({ dominio: DOMINIO, puertoInterno: PUERTO_INTERNO, clientes: clientes.map((c) => ({ slug: c.slug, nombre: c.nombre, prioridad: c.prioridad, desde: c.desde })) }, null, 2)}\n`,
);
writeFileSync(join(dir, 'app.js'), ARRANQUE);

const base = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { dependencies: Record<string, string> };
writeFileSync(
  join(dir, 'package.json'),
  `${JSON.stringify({ name: 'aiva', private: true, main: 'app.js', engines: { node: '>=22.13' }, scripts: { start: 'node app.js' }, dependencies: base.dependencies }, null, 2)}\n`,
);
// La raíz NO declara "type": "module": el arranque tiene que ser CommonJS porque el servidor de la plataforma
// hace require() del archivo de inicio, y un require() de ESM con await arriba revienta. Lo compilado sí es ESM,
// y se lo dice este package.json de adentro, que manda sobre el de la raíz para todo lo que cuelgue de dist/.
writeFileSync(join(dir, 'dist', 'package.json'), '{ "type": "module" }\n');

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
    `  https://${DOMINIO}/            la portada: qué es aiva`,
    `  https://${DOMINIO}/consola     la consola (tu pantalla)`,
    ...clientes.map((c) => `  https://${DOMINIO}/${c.slug}/${' '.repeat(Math.max(1, 12 - c.slug.length))}${c.nombre}: su tablero en /${c.slug}/admin y su chat en /${c.slug}/`),
    '',
    'En el panel, al desplegar:',
    '  Versión de Node ........ 24',
    '  Archivo de inicio ...... app.js        ← IMPORTANTE, ver abajo',
    '  Comando de compilación . npm install --omit=dev',
    '  Comando de inicio ...... npm start',
    '',
    'El archivo de inicio tiene que ser app.js y no otro. Estas plataformas no ejecutan "npm start": el servidor',
    'hace require() del archivo que uno le diga, dentro de su propio proceso. Si queda apuntando a dist/index.js',
    '—que es el servidor de UN cliente, y además es ESM— revienta con ERR_REQUIRE_ASYNC_MODULE y no arranca nada.',
    'app.js es el que levanta a todos y reparte por ruta.',
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

     https://${DOMINIO}/            la portada: qué es aiva
     https://${DOMINIO}/consola     la consola (tu pantalla)
${clientes.map((c) => `     https://${DOMINIO}/${c.slug}/${' '.repeat(Math.max(1, 12 - c.slug.length))}${c.nombre}`).join('\n')}

  En el panel:  Node 24 · compilar "npm install --omit=dev" · iniciar "npm start"
  Las variables de entorno están en el LEEME.txt de adentro; sin ellas no arranca.
`);
