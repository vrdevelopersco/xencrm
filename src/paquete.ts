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
const { execFileSync, spawn } = require('node:child_process');
const net = require('node:net');
const http = require('node:http');
const { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } = require('node:fs');
const { homedir, tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

const aqui = __dirname;
const PUERTO = Number(process.env.PORT || 3000);
const { dominio, puertoInterno: puertoBase, clientes } = JSON.parse(readFileSync(join(aqui, 'clientes.json'), 'utf8'));

/**
 * 🪤 Correrse de puerto es el ÚLTIMO recurso, no el primero.
 *
 * Cuando el alojamiento mata este proceso sin darle tiempo a despedirse, los hijos quedan vivos agarrando sus
 * puertos. Durante un tiempo esto se resolvió buscando un tramo libre y usándolo: el sitio volvía, sí, pero los
 * huérfanos seguían ahí — y con ellos, la sesión de WhatsApp del cliente abierta. Dos copias, el mismo número,
 * cada una echando a la otra: 440 Stream Errored (conflict) en bucle infinito. Correrse de puerto no arreglaba
 * nada, escondía el cadáver.
 *
 * Ahora el orden es otro: primero se echa a los de la versión anterior, luego se espera a que suelten, y solo si
 * después de todo eso el tramo sigue ocupado se busca otro, avisando fuerte de que algo quedó vivo.
 */
function libre(puerto) {
  return new Promise((res) => {
    const probar = net.createServer();
    probar.once('error', () => res(false));
    probar.once('listening', () => probar.close(() => res(true)));
    probar.listen(puerto, '127.0.0.1');
  });
}

async function tramoLibre(base, cuantos) {
  for (let inicio = base; inicio < base + 200; inicio += cuantos) {
    const estados = await Promise.all(Array.from({ length: cuantos }, (_, i) => libre(inicio + i)));
    if (estados.every(Boolean)) {
      if (inicio !== base) console.log('[aiva] los puertos ' + base + '+ estaban ocupados (¿versión anterior sin cerrar?); uso ' + inicio + '+');
      return inicio;
    }
  }
  console.error('[aiva] no encontré puertos libres; lo intento en ' + base + ' de todos modos');
  return base;
}

/** Espera a que el tramo de siempre quede libre. Devuelve true si lo consiguió. */
async function esperarElTramo(base, cuantos, maxMs) {
  const hasta = Date.now() + maxMs;
  for (;;) {
    const estados = await Promise.all(Array.from({ length: cuantos }, (_, i) => libre(base + i)));
    if (estados.every(Boolean)) return true;
    if (Date.now() > hasta) return false;
    await new Promise((r) => setTimeout(r, 500));
  }
}

/**
 * 🪤 UN SOLO lanzador levanta gente. Los demás solo reparten.
 *
 * El alojamiento puede arrancar este mismo archivo más de una vez a la vez. No es una suposición: el 2026-09-29
 * salieron dos con 1,4 segundos de diferencia, y cada uno levantó su propia copia de los tres clientes y de la
 * consola —ocho procesos donde debía haber cuatro—. El sitio parecía funcionar. Lo que no funcionaba era
 * WhatsApp: dos procesos abriendo el mismo número, echándose el uno al otro cada tres segundos, sin parar.
 *
 * Y lo peor: /_salud decía «Todo arriba», porque cada lanzador solo sabe de sus hijos y sus hijos estaban bien.
 *
 * El cerrojo es un puerto. Quien lo abre, manda; quien no puede abrirlo, sabe que hay otro y se limita a
 * repartir hacia los puertos del que mandó. Un puerto y no un archivo porque el sistema lo suelta solo cuando el
 * proceso muere, sin dejar cerrojos viejos trabados que luego hay que salir a limpiar a mano.
 */
function tomarElMando(puerto) {
  return new Promise((res) => {
    const cerrojo = net.createServer();
    cerrojo.once('error', () => res(null));
    cerrojo.once('listening', () => res(cerrojo));
    cerrojo.listen(puerto, '127.0.0.1');
  });
}

/**
 * Echa a los procesos de clientes de una versión anterior que hayan quedado vivos.
 *
 * Se reconocen por dos cosas a la vez: cuelgan de la carpeta de ESTE dominio y son uno de nuestros dos guiones.
 * Los de la versión que se está levantando ahora (misma carpeta que este archivo) no se tocan. Si no se puede
 * mirar la lista de procesos, no se mata nada: mejor un huérfano que un disparo a ciegas.
 */
function matarLosDeAntes() {
  const corte = aqui.indexOf('/hbuilds/');
  const raiz = corte === -1 ? null : aqui.slice(0, corte);
  if (!raiz) return 0;
  let idos = 0;
  try {
    for (const linea of execFileSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8', timeout: 4000 }).split('\n')) {
      const m = /^\s*(\d+)\s+(.*)$/.exec(linea);
      if (!m) continue;
      const pid = Number(m[1]);
      const orden = m[2];
      if (pid === process.pid || !orden.includes(raiz) || orden.includes(aqui)) continue;
      if (!/\/dist\/(index|consola)\.js(\s|$)/.test(orden)) continue;
      try {
        process.kill(pid, 'SIGTERM');
        idos++;
      } catch {
        /* ya no estaba */
      }
    }
  } catch {
    return 0; // sin la lista de procesos no se adivina
  }
  if (idos) console.log('[aiva] eché a ' + idos + ' proceso(s) de la versión anterior que seguían vivos.');
  return idos;
}

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

// Los sockets por los que el enrutador también puede hablarle a los de adentro. Van en los datos y no en el
// despliegue, que estrena carpeta en cada actualización.
const dirSockets = join(datos, '_sockets');
mkdirSync(dirSockets, { recursive: true });

// 🪤 Un socket de archivo no admite rutas largas: el sistema corta sobre los 100 caracteres y falla con EINVAL,
// que no dice nada de longitudes. Si la carpeta de datos queda muy adentro se usa la temporal, que es corta; y
// si tampoco cabe, este se queda sin su puerta de servicio y manda el puerto, como siempre.
function socketPara(slug) {
  const enDatos = join(dirSockets, slug + '.sock');
  if (enDatos.length <= 100) return enDatos;
  const corto = join(tmpdir(), 'aiva-' + slug + '.sock');
  if (corto.length <= 100) return corto;
  console.error('[aiva] sin socket para ' + slug + ': no hay ninguna ruta lo bastante corta.');
  return '';
}

const tokenDe = (slug) => process.env['TOKEN_' + slug.toUpperCase().replace(/[^A-Z0-9]/g, '_')] || '';

// La clave de OpenAI de UN cliente, para que pague lo que gasta.
//
// 🪤 Esto hace falta porque una variable del panel le gana a cualquier .env: el cargador solo rellena lo que no
// esté ya definido, así que con OPENAI_API_KEY puesta arriba, el .env de un cliente no pinta nada y la clave
// que alguien ponga desde la consola no tendría ningún efecto. No falla ni avisa: simplemente paga la casa.
//
// Se mira en dos sitios, y manda el primero:
//   1. El .env del propio cliente, que es lo que escribe la consola.
//   2. OPENAI_KEY_<SLUG> en el panel, para dejarlo puesto sin entrar a la consola.
// Lo que salga de aquí se le pasa al hijo en SU entorno, que gana sobre lo heredado del panel.
const claveDelCliente = (slug, suEnv) => {
  try {
    if (existsSync(suEnv)) {
      for (const linea of readFileSync(suEnv, 'utf8').split('\n')) {
        const l = linea.trim();
        if (!l.startsWith('OPENAI_API_KEY=')) continue;
        const v = l.slice('OPENAI_API_KEY='.length).trim().replace(/^["']|["']$/g, '');
        if (v) return v;
      }
    }
  } catch (e) { /* si no se puede leer, se sigue con lo del panel */ }
  return process.env['OPENAI_KEY_' + slug.toUpperCase().replace(/[^A-Z0-9]/g, '_')] || '';
};

// ── Un proceso por cliente ──────────────────────────────────────────────────
const hijos = new Map();
// A dónde va cada cliente. Es un mapa aparte del de los hijos a propósito: el lanzador que NO tiene el mando no
// levanta a nadie, pero sí reparte, y para eso le basta saber en qué puerto está cada uno.
const rutas = new Map();
// El cerrojo va justo debajo del tramo de siempre: si los clientes están en 4100, el mando está en 4099. Se
// declara aquí arriba y no junto a donde se usa porque /_salud lo lee, y /_salud contesta desde el primer
// instante: entre que se abre el puerto y termina de leerse este archivo caben peticiones.
const PUERTO_MANDO = puertoBase - 1;
let soyElDueno = false;
let mandoDe = '';
let cerrando = false;
function levantar(slug, guion, env, puerto) {
  if (cerrando) return;
  const antes = hijos.get(slug);
  // 🪤 Además del puerto, un socket de archivo. Es la puerta que no pasa por la red: en el servidor los cuatro
  // procesos estaban vivos y escuchando, y el padre recibía ECONNREFUSED en los cuatro. Por ahí se llega igual.
  const sock = socketPara(slug);
  if (sock) socketDe.set(puerto, sock);
  const hijo = spawn(process.execPath, [join(aqui, guion)], {
    env: { ...process.env, ...env, PORT: String(puerto), AIVA_SOCK: sock, AIVA_BIND: process.env.AIVA_BIND || '127.0.0.1' },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  hijo.on('exit', (code) => {
    if (cerrando) return;
    const h = hijos.get(slug);
    if (h) {
      h.caidas = (h.caidas || 0) + 1;
      h.ultimoCodigo = code;
      h.ultimaCaida = Date.now();
    }
    console.error('[aiva] ' + slug + ' se cayó (' + code + '); lo levanto en 5 s');
    setTimeout(() => levantar(slug, guion, env, puerto), 5000);
  });
  rutas.set(slug, puerto);
  hijos.set(slug, {
    puerto,
    hijo,
    pid: hijo.pid,
    desde: Date.now(),
    arranques: (antes && antes.arranques ? antes.arranques : 0) + 1,
    caidas: (antes && antes.caidas) || 0,
    ultimoCodigo: antes && antes.ultimoCodigo,
    ultimaCaida: antes && antes.ultimaCaida,
  });
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
  // 🪤 El modelo pesado, explícito. Si liviano y pesado acaban siendo el mismo modelo, el enrutador se queda
  // en liviano para siempre y nunca sube de categoría: el aviso de «dame un segundito» no sale nunca porque no
  // hay turno pesado que anunciar. (Sin acentos graves aquí: esto vive dentro de la plantilla del lanzador.)
  OPENAI_MODEL_HEAVY: process.env.OPENAI_MODEL_HEAVY || 'gpt-5.4',
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

const paraLevantar = [];
let puertoInterno = puertoBase;
let puertoConsola = puertoBase + clientes.length;

clientes.forEach((c, i) => {
  const mio = join(datos, c.slug);
  // 'medios' es donde quedan las fotos y los documentos del chat. Hermano de 'data' a propósito: así sobrevive
  // a cada despliegue igual que la base, y el respaldo —que es un JSON— no carga con megas de archivos.
  for (const sub of ['', 'data', 'auth', 'catalogo', 'conocimiento', 'medios']) mkdirSync(join(mio, sub), { recursive: true });
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
  paraLevantar.push({ slug: c.slug, guion: 'dist/index.js', env: {
    ...porDefecto,
    // La carpeta que comparten la consola y los clientes. La consola escribe ahí la configuración de la
    // libreta —la llave y desde qué direcciones se abre— y cada cliente la lee.
    AIVA_CLIENTES_DIR: join(datos, '_consola'),
    AIVA_CONFIG: configPath,
    AIVA_SLUG: c.slug,
    DB_PATH: join(mio, 'data', 'aiva.db'),
    WHATSAPP_AUTH_DIR: join(mio, 'auth'),
    ADMIN_TOKEN: tokenDe(c.slug),
    PUBLIC_URL: 'https://' + dominio + '/' + c.slug,
    // 🪤 Solo si la tiene. Poner OPENAI_API_KEY en vacío aquí sería peor que no ponerla: una cadena vacía sí
    // está definida, así que este cliente dejaría de heredar la de la casa y se quedaría sin ninguna.
    ...(claveDelCliente(c.slug, join(mio, '.env')) ? { OPENAI_API_KEY: claveDelCliente(c.slug, join(mio, '.env')) } : {}),
  } });
});

// ── La consola ──────────────────────────────────────────────────────────────
// Se le arma su índice apuntando a los puertos de adentro: ella les habla por ahí, no por internet.
const dirClientes = join(datos, '_consola');
mkdirSync(dirClientes, { recursive: true });
// Se escribe cuando ya se sabe en qué puertos quedaron: si se escribiera antes, la consola hablaría a los de
// la versión anterior y todo diría «no estamos alcanzando a este cliente».
function escribirIndiceDeClientes() {
  writeFileSync(
    join(dirClientes, 'index.json'),
    JSON.stringify(
      {
        clientes: clientes.map((c, i) => ({
          ...c,
          puerto: puertoInterno + i,
          base: 'http://127.0.0.1:' + (puertoInterno + i),
          // Por si la red entre procesos no funciona: la consola entra por aquí, igual que el enrutador.
          sock: socketPara(c.slug),
          host: dominio + '/' + c.slug, // para el enlace "Abrir tablero"
        })),
        // Lo que sigue no lo usa la consola: lo lee el lanzador que se encuentre con que otro tiene el mando,
        // para repartir hacia los puertos de verdad en vez de inventárselos.
        mando: { pid: process.pid, consola: puertoConsola, sock: socketPara('consola'), desde: Date.now() },
      },
      null,
      2,
    ),
  );
}
paraLevantar.push({
  slug: 'consola',
  guion: 'dist/consola.js',
  // 🪤 AIVA_SUPERVISADO también aquí, y no es un detalle: es lo que hace que la consola se vaya si el lanzador
  // se muere. Sin esto sobrevive sola, se queda con su puerto, y el lanzador siguiente tiene que correrse de
  // tramo y levantar una segunda copia de TODO. Lo encontró la prueba de matar al lanzador: de cuatro procesos
  // se iban tres, y el que se quedaba era justo este.
  env: { AIVA_CLIENTES_DIR: dirClientes, CONSOLA_HOST: process.env.AIVA_BIND || '127.0.0.1', AIVA_SUPERVISADO: '1' },
  esLaConsola: true,
});

// ── El enrutador ────────────────────────────────────────────────────────────
// La portada: una página que explica qué es aiva. La sirve el enrutador mismo, sin molestar a nadie, porque es
// lo único que ve quien llega al dominio pelado. La consola queda en /consola, y sus llamadas (/api/...) siguen
// saliendo de la raíz, que es a donde van por defecto.
/**
 * Lo que se ve en el hueco entre que abre la puerta el enrutador y levantan los de adentro.
 *
 * 🪤 Antes era texto pelado: «Todavía está arrancando». Técnicamente cierto y, para quien abre el tablero de
 * su negocio, indistinguible de que todo se rompió. Se ve durante un par de segundos y es lo primero que ve
 * alguien tras una actualización: merece parecer lo que es —algo encendiéndose— y no una página de error.
 *
 * Se recarga sola, así que nadie tiene que tocar nada. Va entera aquí dentro, sin pedirle nada a nadie: si
 * hubiera que traer una hoja de estilos o una fuente, justo ahora no hay quien la sirva.
 */
const ARRANCANDO = [
  '<!doctype html><html lang="es"><head><meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width,initial-scale=1">',
  '<meta http-equiv="refresh" content="4">',
  '<title>Arrancando</title><style>',
  ':root{color-scheme:light dark}',
  'body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f5f0;color:#1d1a15;',
  'font:16px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif}',
  '@media(prefers-color-scheme:dark){body{background:#12100d;color:#ece7dd}}',
  'body::before{content:"";position:fixed;inset:-20%;z-index:-1;filter:blur(60px);opacity:.5;',
  'background:radial-gradient(600px 500px at 10% 10%,#d9c58a,transparent 60%),',
  'radial-gradient(700px 600px at 90% 20%,#9fb8d6,transparent 60%),',
  'radial-gradient(600px 500px at 60% 100%,#c9a6a0,transparent 60%)}',
  '.caja{text-align:center;padding:30px 36px;border-radius:20px;background:rgba(255,255,255,.55);',
  'border:1px solid rgba(255,255,255,.65);box-shadow:0 12px 44px rgba(0,0,0,.12);',
  '-webkit-backdrop-filter:blur(22px);backdrop-filter:blur(22px)}',
  '@media(prefers-color-scheme:dark){.caja{background:rgba(30,26,20,.55);border-color:rgba(255,255,255,.12)}}',
  '.rueda{width:30px;height:30px;margin:0 auto 16px;border-radius:50%;',
  'border:3px solid rgba(127,127,127,.22);border-top-color:currentColor;animation:giro 900ms linear infinite}',
  '@keyframes giro{to{transform:rotate(360deg)}}',
  '@media(prefers-reduced-motion:reduce){.rueda{animation:none;border-top-color:rgba(127,127,127,.22)}}',
  'b{font-size:17px;display:block;letter-spacing:-.01em}small{opacity:.7;font-size:13.5px}',
  '</style></head><body><div class="caja"><div class="rueda"></div>',
  '<b>Arrancando</b><small>Tarda unos segundos. Se abre solo.</small></div>',
  '<script>setTimeout(function(){location.reload()},2000)<\/script>',
  '</body></html>',
].join('');

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
  const destino = m && rutas.get(m[1]);
  if (!destino) return { puerto: puertoConsola, ruta: url, prefijo: '' };
  const resto = url.slice(1 + m[1].length) || '/';
  return { puerto: destino, ruta: resto.startsWith('/') ? resto : '/' + resto, prefijo: '/' + m[1] };
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
// 🪤 No dar por hecho POR DÓNDE se alcanza a los de adentro.
//
// Durante días el enrutador dio por sentado que sus hijos estaban en 127.0.0.1 y punto. En el servidor eso
// resultó ser falso: los cuatro procesos vivos, escuchando según su propio registro, y el padre recibiendo
// ECONNREFUSED en los cuatro — con el sitio entero devolviendo «todavía está arrancando». Una suposición de una
// línea, invisible, que costó una mañana.
//
// Así que ya no se supone: se prueban las puertas en orden y se recuerda cuál abrió. La última es un socket de
// archivo, que no pasa por la red y por eso funciona aunque el enrutador y sus hijos no se vean por ella.
const socketDe = new Map(); // puerto -> archivo por el que también se le puede hablar
const porDondeVa = new Map(); // puerto -> la puerta que sí abrió

const nombreDePuerta = (puerta) => (puerta.socketPath ? 'socket' : puerta.host);
const puertasDe = (puerto) => {
  const lista = [{ host: '127.0.0.1' }, { host: '::1' }];
  const sock = socketDe.get(puerto);
  if (sock) lista.push({ socketPath: sock });
  return lista;
};
/** Cómo hablarle a un puerto de adentro: por donde ya sabemos que abre, o por la puerta de siempre. */
const comoLlego = (puerto) => porDondeVa.get(puerto) || { host: '127.0.0.1' };
const conDestino = (puerta, puerto, resto) =>
  puerta.socketPath ? { socketPath: puerta.socketPath, ...resto } : { host: puerta.host, port: puerto, ...resto };

/**
 * Las cabeceras con las que se le habla al proceso de adentro.
 *
 * El Host tiene que apuntar al puerto interno —es a quien se le está hablando— pero al cambiarlo se pierde el
 * NOMBRE con el que llamaron desde fuera, y ese nombre hace falta adentro: es contra él que se comprueba que un
 * POST venga de nuestra propia página (ver cabeceras.ts).
 *
 * 🪤 Por eso el nombre original se guarda en x-forwarded-host ANTES de pisarlo. Sin esto, lo único que salva el
 * login es que el servidor del alojamiento ponga esa cabecera por su cuenta: el día que no la ponga —o que
 * alguien entre directo al puerto de Node— adentro se compara «https://aiva.midominio» contra «127.0.0.1:4100»,
 * no coinciden, y TODO lo que no sea abrir una página se cae con un 403. Entrar, contestar, guardar: todo. Y no
 * se ve en ninguna prueba del código, porque el código está bien; lo que faltaba era el dato.
 */
const paraAdentro = (cabeceras, puerto) => ({
  ...cabeceras,
  'x-forwarded-host': cabeceras['x-forwarded-host'] || cabeceras.host,
  host: '127.0.0.1:' + puerto,
});

// Devuelve el MOTIVO, no un sí o un no. «5 de 5 no contestaron a tiempo» no distingue un proceso que todavía no
// abrió el puerto (ECONNREFUSED) de uno que abrió y está tan ahogado que no alcanza a contestar, y son dos
// problemas que no se arreglan igual. Eso obligó a leer el registro del panel línea por línea.
const tocar = (puerta, puerto) =>
  new Promise((res) => {
    const r = http.request(conDestino(puerta, puerto, { path: '/health', timeout: 1500 }), (x) => {
      x.resume();
      res(null);
    });
    r.on('error', (e) => res(e.code || e.message || 'error'));
    r.on('timeout', () => {
      r.destroy();
      res('no contestó en 1,5 s');
    });
    r.end();
  });

async function sondear(puerto) {
  const fallos = [];
  for (const puerta of puertasDe(puerto)) {
    const mal = await tocar(puerta, puerto);
    if (!mal) {
      porDondeVa.set(puerto, puerta);
      return null;
    }
    fallos.push(nombreDePuerta(puerta) + ' ' + mal);
  }
  porDondeVa.delete(puerto);
  return fallos.join(' · ');
}

/**
 * 🪤 Qué hay escuchando de verdad en nuestros puertos, según el propio sistema.
 *
 * Esto existe porque hubo una mañana entera de callejón sin salida: los cuatro procesos vivos, cada uno diciendo
 * en su registro «escuchando en 4100», y el padre recibiendo ECONNREFUSED al llamar a 127.0.0.1:4100. Con solo
 * esos dos datos no se puede avanzar: falta saber en qué DIRECCIÓN quedaron abiertos. El sistema lo sabe y lo
 * publica; solo había que leerlo. En Linux; donde no esté, no se inventa nada.
 */
function quienEscucha() {
  const mios = new Set(losDeAdentro());
  const visto = {};
  const legible = (hex) => {
    if (hex.length === 8) return [6, 4, 2, 0].map((i) => parseInt(hex.slice(i, i + 2), 16)).join('.');
    if (/^0+$/.test(hex)) return '::';
    if (/^0{24}0*1.*$/.test(hex) && parseInt(hex.slice(24), 16) === 1) return '::1';
    if (hex.slice(0, 24) === '00000000000000000000FFFF') return '::ffff:' + [30, 28, 26, 24].map((i) => parseInt(hex.slice(i, i + 2), 16)).join('.');
    return 'IPv6 ' + hex;
  };
  for (const archivo of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let texto;
    try {
      texto = readFileSync(archivo, 'utf8');
    } catch {
      continue;
    }
    for (const linea of texto.split('\n').slice(1)) {
      const campos = linea.trim().split(/\s+/);
      if (campos.length < 4 || campos[3] !== '0A') continue; // 0A = escuchando
      const partes = (campos[1] || '').split(':');
      const puerto = parseInt(partes[1] || '', 16);
      if (!mios.has(puerto)) continue;
      visto[puerto] = (visto[puerto] ? visto[puerto] + ' + ' : '') + legible(partes[0]);
    }
  }
  return Object.keys(visto).length ? visto : 'no se pudo mirar (no es Linux) o no hay nada abierto en esos puertos';
}

/** Lo último que se supo de cada puerto de adentro, para /_salud. */
let ultimoSondeo = null;

const losDeAdentro = () =>
  // Sin repetidos: la consola estaba dos veces en esta lista (por su puerto y como hijo), así que el recuento
  // decía «5 de 5» cuando adentro hay cuatro. Un número que no cuadra hace dudar del diagnóstico entero.
  //
  // 🪤 De RUTAS y no de los hijos: el espejo no tiene hijos —no levanta a nadie— y así no sondeaba nada. Se
  // quedaba creyendo que a todos se les llega por el puerto, que es justo lo que aquí no funciona, y repartía
  // contra una puerta cerrada: el sitio entero devolviendo «todavía está arrancando» con todo bien levantado.
  [...new Set([puertoConsola, ...rutas.values()])];

async function sondearATodos() {
  const puertos = losDeAdentro();
  const motivos = await Promise.all(puertos.map(sondear));
  const fallan = puertos.map((p, i) => ({ puerto: p, motivo: motivos[i] })).filter((x) => x.motivo);
  ultimoSondeo = { cuando: Date.now(), fallan };
  return fallan;
}

async function esperarALosDeAdentro(maxMs = 30000) {
  const hasta = Date.now() + maxMs;
  for (;;) {
    const fallan = await sondearATodos();
    if (!fallan.length) {
      console.log('[aiva] todos adentro listos, por ' + [...new Set([...porDondeVa.values()].map(nombreDePuerta))].join(' y '));
      return;
    }
    if (Date.now() > hasta) {
      console.log('[aiva] abro igual: ' + fallan.length + ' de ' + losDeAdentro().length + ' no contestaron — ' + fallan.map((x) => x.puerto + ': ' + x.motivo).join(', '));
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
    // ── Un sitio donde mirar cuando algo no arranca ──────────────────────────
    // 🪤 Lo sirve el ENRUTADOR, no los hijos: cuando ninguno levanta, todo lo demás contesta 503 y desde fuera
    // no hay forma de saber si es memoria, un puerto pillado o un error del código. Esto lo dice en una
    // llamada, sin entrar al servidor ni mirar registros a ciegas.
    if (camino === '/_salud') {
      // 🪤 Sin token. Esto se mira JUSTO cuando nada funciona, y en ese momento pedir una credencial que hay
      // que ir a buscar al panel es poner una puerta delante del extintor. Lo que se enseña no abre nada: si
      // este sitio está vivo y un cliente está caído, eso ya se ve desde fuera pidiéndole su página.
      //
      // Los pids y los puertos internos sí se guardan para quien traiga el token: no porque sean un secreto,
      // sino porque no le sirven a nadie más.
      const token = (pide.headers['x-consola-token'] || '').toString() || new URL(pide.url, 'http://x').searchParams.get('token') || '';
      const conToken = Boolean(process.env.CONSOLA_TOKEN) && token === process.env.CONSOLA_TOKEN;
      const mem = process.memoryUsage();
      const cuerpo = {
        arrancado: new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString(),
        enPieDesdeHaceMin: Math.round(process.uptime() / 60),
        node: process.version,
        // 🪤 Quién es este que contesta. Cuando el alojamiento arrancó dos lanzadores, cada uno veía a sus
        // cuatro hijos perfectos y decía «Todo arriba» — y entre los dos había ocho procesos peleándose el
        // WhatsApp del cliente. Desde fuera no había forma de notarlo. Ahora lo primero que se dice es si este
        // tiene el mando o es un espejo, y a quién sigue.
        papel: soyElDueno ? 'con el mando' : 'espejo del ' + (mandoDe || 'otro lanzador'),
        enrutador: { puerto: PUERTO, memoriaMB: Math.round(mem.rss / 1048576) },
        // 🪤 Sin sondeo hecho NO se dice «todos contestan». El espejo nunca sondeaba y contestaba eso mismo
        // mientras el sitio entero daba 503: un diagnóstico que inventa buenas noticias cierra la única pista.
        sondeo: !ultimoSondeo ? 'todavía no se ha mirado' : ultimoSondeo.fallan.length ? ultimoSondeo.fallan : 'todos contestan',
        // Lo que dice el sistema, no lo que dice cada proceso de sí mismo. Cuando los dos no coinciden, la
        // respuesta está justo ahí.
        escuchando: quienEscucha(),
        puertos: conToken
          ? { pedidos: puertoBase, usados: puertoInterno, consola: puertoConsola, semovio: puertoInterno !== puertoBase }
          : { semovio: puertoInterno !== puertoBase },
        // El espejo no tiene hijos que enseñar, pero sí reparte: por dónde lo hace es justo lo que hay que ver
        // cuando el sitio no responde y los procesos están bien.
        reparte: soyElDueno
          ? undefined
          : [...rutas.entries()].map(([slug, puerto]) => ({
              slug,
              por: porDondeVa.has(puerto) ? nombreDePuerta(porDondeVa.get(puerto)) : 'no se le llega',
            })),
        adentro: [...hijos.entries()].map(([slug, h]) => ({
          slug,
          puerto: conToken ? h.puerto : undefined,
          pid: conToken ? h.pid : undefined,
          vivo: Boolean(h.hijo && h.hijo.exitCode === null),
          por: porDondeVa.has(h.puerto) ? nombreDePuerta(porDondeVa.get(h.puerto)) : 'no se le llega',
          enPieDesdeHaceMin: Math.round((Date.now() - h.desde) / 60000),
          arranques: h.arranques,
          caidas: h.caidas,
          ultimoCodigo: h.ultimoCodigo === undefined ? null : h.ultimoCodigo,
          ultimaCaida: h.ultimaCaida ? new Date(h.ultimaCaida).toISOString() : null,
        })),
      };
      // Una línea que diga qué mirar primero, para no tener que interpretar el resto.
      const muertos = cuerpo.adentro.filter((x) => !x.vivo);
      const reinician = cuerpo.adentro.filter((x) => x.caidas > 2);
      cuerpo.veredicto = !soyElDueno
        ? 'Este lanzador no manda: otro tiene el mando y levantó a los clientes; este solo reparte. Es lo correcto cuando el alojamiento arranca la aplicación más de una vez.'
        : !cuerpo.adentro.length
        ? 'Todavía no se ha levantado nada: el enrutador acaba de arrancar.'
        : muertos.length === cuerpo.adentro.length
          ? 'Ninguno de adentro está vivo. Mira ultimoCodigo: si es 1, revienta al arrancar; si los puertos se movieron, la versión anterior sigue agarrándolos.'
          : reinician.length
            ? 'Hay procesos reiniciándose en bucle (' + reinician.map((x) => x.slug).join(', ') + '). Suele ser memoria o un error al arrancar.'
            : muertos.length
              ? 'Falta ' + muertos.map((x) => x.slug).join(', ') + '.'
              : 'Todo arriba.';
      responde.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      responde.end(JSON.stringify(cuerpo, null, 2));
      return;
    }

    const { puerto, ruta, prefijo } = haciaDonde(pide.url || '/');

    /**
     * 🪤 Reintentar antes de rendirse. El enrutador abre la puerta en medio segundo —obligatorio: si tarda
     * tres, el alojamiento lo mata— y los procesos de adentro tardan unos segundos más en levantar. En ese
     * hueco, quien entraba se llevaba un «todavía está arrancando» aunque bastaba con esperar dos segundos.
     *
     * Solo se reintenta lo que no lleva cuerpo (GET y HEAD): el cuerpo de un POST ya se consumió al primer
     * intento y reenviarlo mandaría medio formulario. Y esos son justo los que importan, porque el que se
     * encuentra el hueco es el que ABRE la página, no el que manda algo.
     */
    const sinCuerpo = pide.method === 'GET' || pide.method === 'HEAD';
    const intentar = (quedan) => {
      const salida = http.request(
        conDestino(comoLlego(puerto), puerto, { path: ruta, method: pide.method, headers: paraAdentro(pide.headers, puerto) }),
        (r) => {
          // 🪤 Se quita el reloj EN CUANTO contesta. El de arriba es para que una petición no se quede colgada
          // esperando a un proceso que ni rechaza ni responde; pero el chat en vivo se queda abierto a
          // propósito y con el reloj puesto lo cortaríamos cada pocos segundos.
          salida.setTimeout(0);
          const cabeceras = { ...r.headers };
          // Una redirección de adentro no sabe del prefijo: se lo ponemos para que no saque al cliente de su ruta.
          if (prefijo && typeof cabeceras.location === 'string' && cabeceras.location.startsWith('/')) {
            cabeceras.location = prefijo + cabeceras.location;
          }
          responde.writeHead(r.statusCode || 502, cabeceras);
          r.pipe(responde); // sin buffer: así el chat en vivo (SSE) sigue llegando mensaje a mensaje
        },
      );
      // Un proceso que no rechaza pero tampoco contesta dejaba la petición esperando para siempre: el navegador
      // en blanco y nada en los registros. Cuatro segundos y se da por fallido, que es lo que ya sabemos tratar.
      salida.setTimeout(4000, () => salida.destroy(new Error('no contestó a tiempo')));
      salida.on('error', () => {
        if (quedan > 0 && sinCuerpo) {
          setTimeout(() => intentar(quedan - 1), 400);
          return;
        }
        responde.writeHead(503, { 'content-type': 'text/html; charset=utf-8', 'retry-after': '3' });
        responde.end(pide.method === 'HEAD' ? undefined : ARRANCANDO);
      });
      pide.pipe(salida);
    };
    intentar(sinCuerpo ? 6 : 0); // ~2,4 s, que es lo que tardan en levantar
});

// 🪤 El await de nivel superior no existe aquí: este lanzador es CommonJS porque el servidor del alojamiento lo
// carga con require. Por eso se encadena en vez de esperar.
/**
 * 🪤 Se ESCUCHA YA, antes de levantar a nadie.
 *
 * El servidor del alojamiento da la aplicación por colgada si no llama a listen() en tres segundos: la mata y la
 * rearranca. Y cada intento deja hijos huérfanos agarrando los puertos, así que el siguiente arranque tampoco
 * puede, y entra en un bucle del que no sale. Pasó exactamente eso por retrasar ese listen() para esperar a los
 * de adentro —una idea razonable que aquí es letal—.
 *
 * Mientras los de adentro no estén, el enrutador contesta «todavía está arrancando», que es la verdad y dura
 * unos segundos. Eso es mucho mejor que no contestar.
 */
servidor.listen(PUERTO, () => {
  console.log('[aiva] escuchando en ' + PUERTO);
});

async function levantarALosMios() {
  soyElDueno = true;
  // Primero se echa a los de la versión anterior; luego se les da tiempo a soltar. Correrse de puerto, solo si
  // después de eso siguen ahí: un tramo distinto significa dos copias vivas, y eso es lo que hay que evitar.
  matarLosDeAntes();
  if (!(await esperarElTramo(puertoBase, paraLevantar.length, 12000))) {
    console.error('[aiva] los puertos de siempre siguen ocupados y algo quedó vivo ahí. Busco otro tramo, pero revisa /_salud.');
    puertoInterno = await tramoLibre(puertoBase, paraLevantar.length);
  } else {
    puertoInterno = puertoBase;
  }
  puertoConsola = puertoInterno + clientes.length;
  paraLevantar.forEach((h, i) => {
    const puerto = h.esLaConsola ? puertoConsola : puertoInterno + i;
    const env = h.esLaConsola ? { ...h.env, CONSOLA_PORT: String(puerto) } : h.env;
    levantar(h.slug, h.guion, env, puerto);
  });
  // El índice que usa la consola para hablarles tiene que apuntar a los puertos de verdad, no a los de ayer.
  escribirIndiceDeClientes();
  await esperarALosDeAdentro();
  // Se sigue mirando cada quince segundos: un hijo que se reinicia puede quedar en otra puerta, y /_salud tiene
  // que decir cómo están las cosas ahora, no cómo estaban al arrancar.
  setInterval(() => void sondearATodos(), 15000).unref();
  (() => {
    console.log('[aiva]   https://' + dominio + '/            → qué es aiva');
    console.log('[aiva]   https://' + dominio + '/consola     → la consola (tu pantalla)');
    for (const c of clientes) console.log('[aiva]   https://' + dominio + '/' + c.slug + '/  → ' + c.nombre);
  })();
}

/** Lee del índice a qué puertos hay que repartir. Lo escribió el lanzador que tiene el mando. */
function seguirAlQueManda() {
  try {
    const leido = JSON.parse(readFileSync(join(dirClientes, 'index.json'), 'utf8'));
    if (!leido || !leido.mando || !Array.isArray(leido.clientes)) return false;
    // 🪤 Los sockets también: son la puerta que de verdad funciona en este alojamiento. El espejo los sacaba de
    // ninguna parte —se apuntan al levantar a cada hijo, y él no levanta a nadie—, así que solo le quedaba el
    // puerto. Aquí los lee del índice, que es para lo que el dueño los escribe.
    for (const c of leido.clientes) {
      if (!c.slug || !c.puerto) continue;
      rutas.set(c.slug, c.puerto);
      if (c.sock) socketDe.set(c.puerto, c.sock);
    }
    rutas.set('consola', leido.mando.consola);
    if (leido.mando.sock) socketDe.set(leido.mando.consola, leido.mando.sock);
    puertoConsola = leido.mando.consola;
    mandoDe = 'lanzador ' + leido.mando.pid;
    return rutas.size > 0;
  } catch {
    return false;
  }
}

/**
 * Sin el mando: no se levanta a nadie, solo se reparte hacia los puertos del que sí lo tiene. Y se sigue
 * mirando el cerrojo: si ese se va (lo matan, se cae), el primero que consiga abrirlo toma el relevo y levanta
 * a los clientes. Así dos lanzadores no se estorban, pero tampoco se quedan los dos de brazos cruzados.
 */
async function deEspejo() {
  console.log('[aiva] otro lanzador tiene el mando; este solo reparte (no levanta a nadie).');
  for (;;) {
    // Sondear no es cosa del dueño: es de quien reparte. Y reparten los dos.
    if (seguirAlQueManda()) await sondearATodos();
    await new Promise((r) => setTimeout(r, 4000));
    if (cerrando) return;
    const cerrojo = await tomarElMando(PUERTO_MANDO);
    if (cerrojo) {
      console.log('[aiva] el lanzador que mandaba ya no está: tomo el mando y levanto a los clientes.');
      rutas.clear();
      await levantarALosMios();
      return;
    }
  }
}

async function arrancar() {
  const cerrojo = await tomarElMando(PUERTO_MANDO);
  if (!cerrojo) return deEspejo();
  await levantarALosMios();
}

void arrancar();
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
  'OPENAI_MODEL=gpt-5.4-mini    # el de siempre: saludar, orientar, lo de todos los días',
  'LIGHT_ENGINE=openai',
  'HEAVY_ENGINE=openai',
  'GATE_ENGINE=openai',
  'ANALYSIS_ENGINE=openai',
  // 🪤 Sin esta línea NO HAY motor pesado. El enrutador compara el modelo de liviano con el de pesado y, si
  // son el mismo, se queda en liviano y dice «un solo motor»: nunca sube de categoría, por mucho que la pregunta
  // lo pida. El paquete salía así —los dos en mini— y nadie lo notaba, porque no falla: simplemente contesta
  // siempre con el modelo pequeño lo que debería contestar el grande.
  'OPENAI_MODEL_HEAVY=gpt-5.4    # lo específico: prenda, color, medidas, recomendar',
  'OPENAI_MODEL_ANALYSIS=gpt-5.4-mini    # la ficha y el puntaje, donde nadie espera',
  'EMBED_ENGINE=openai',
  'CONSOLA_TOKEN=PONER    # la llave maestra de la consola',
  ...clientes.map((c) => `TOKEN_${c.slug.toUpperCase().replace(/[^A-Z0-9]/g, '_')}=PONER    # el token de ${c.nombre}, en clientes/${c.slug}/.env`),
  '',
  '# Opcional: la clave de OpenAI de un cliente concreto, para que pague lo que gasta él y no la casa.',
  '# Lo mismo se puede poner desde la consola (Configuración > Motores), que es más cómodo y la comprueba antes.',
  ...clientes.map((c) => `# OPENAI_KEY_${c.slug.toUpperCase().replace(/[^A-Z0-9]/g, '_')}=sk-...    # solo ${c.nombre}`),
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
