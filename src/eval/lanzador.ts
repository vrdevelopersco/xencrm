// Pruebas del lanzador del paquete: pnpm test:lanzador
//
// Esto no prueba una función: prueba que **no se repita el peor fallo que hemos tenido en producción**. El
// 2026-09-29 el alojamiento arrancó el lanzador dos veces a la vez. Cada copia levantó sus tres clientes y su
// consola —ocho procesos donde iban cuatro— y dos de ellos abrieron el mismo WhatsApp. Cada uno echaba al otro
// cada tres segundos, sin parar, durante horas. Y /_salud decía «Todo arriba», porque cada lanzador veía a sus
// hijos y sus hijos estaban perfectos.
//
// Lo que sostiene que eso no vuelva son cuatro cosas pequeñas, y cualquiera de ellas se borra sin querer en una
// edición. Por eso están aquí, y por eso la última se prueba matando un proceso de verdad: que un comentario
// diga que los hijos se van solos no significa que se vayan.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};

// ---------- El lanzador que se va a generar ----------
const fuente = readFileSync(new URL('../paquete.ts', import.meta.url), 'utf8');
const desde = fuente.indexOf('String.raw`');
const hasta = fuente.indexOf('\n`;', desde);
const arranque = fuente.slice(desde, hasta);
check('se encuentra la plantilla del lanzador', desde !== -1 && hasta !== -1);

// 🪤 Un acento grave dentro de la plantilla la cierra por la mitad y rompe la compilación con errores que
// señalan a cualquier sitio menos al culpable. Ha pasado cuatro veces, siempre en un comentario.
const graves = arranque.slice('String.raw`'.length).includes('`');
check('🪤 no hay acentos graves dentro de la plantilla', !graves, 'un acento grave en un comentario cierra la plantilla y rompe la compilación');

// 🪤 El alojamiento mata la aplicación si no abre el puerto en tres segundos, y cada intento fallido deja
// huérfanos. Si alguien vuelve a mover el listen() detrás de algo lento, el sitio entra en bucle de reinicios.
const posListen = arranque.indexOf('servidor.listen(PUERTO');
const posLevantar = arranque.indexOf('function levantarALosMios');
check('🪤 se abre el puerto ANTES de levantar a nadie', posListen !== -1 && posListen < posLevantar, 'el alojamiento da 3 segundos: primero listen(), lo demás después');

// 🪤 El cerrojo: sin esto, dos lanzadores levantan dos copias de todo.
check('🪤 hay un cerrojo para que solo un lanzador levante clientes', /function tomarElMando/.test(arranque) && /PUERTO_MANDO/.test(arranque));
check('y el que no lo consigue reparte en vez de levantar', /function deEspejo/.test(arranque) && /seguirAlQueManda/.test(arranque));

// 🪤 La consola también tiene que irse con su lanzador. Cuando no llevaba esta variable, de cuatro procesos se
// iban tres: el que se quedaba obligaba al siguiente a correrse de tramo y a levantar una segunda copia.
const bloqueConsola = arranque.slice(arranque.indexOf("slug: 'consola'"), arranque.indexOf("esLaConsola: true"));
check('🪤 la consola también se va si se muere el lanzador', /AIVA_SUPERVISADO: '1'/.test(bloqueConsola), bloqueConsola.slice(0, 200));

// Correrse de puerto esconde el problema en vez de arreglarlo: antes de eso hay que echar a los de antes y
// esperar a que suelten.
check('antes de correrse de puerto se echa a los de la versión anterior', arranque.indexOf('matarLosDeAntes()') < arranque.indexOf('tramoLibre(puertoBase'));

// 🪤 Las puertas. Dar por hecho que a los de adentro se llega por 127.0.0.1 tuvo al sitio entero devolviendo
// «todavía está arrancando» con los cuatro procesos vivos y escuchando. Ahora se prueban varias y se recuerda
// cuál abrió; si alguien vuelve a dejar una sola, esto lo dice.
check('🪤 se prueba más de una puerta para llegar a los de adentro', /puertasDe/.test(arranque) && /socketPath/.test(arranque) && /'::1'/.test(arranque));
check('y el reparto usa la que abrió, no la que se suponía', /conDestino\(comoLlego\(puerto\)/.test(arranque), 'el proxy volvió a fijar 127.0.0.1');

// 🪤 Al repartir hay que cambiar el Host —se le habla al puerto interno— pero eso BORRA el nombre con el que
// llamaron desde fuera, y adentro ese nombre es contra lo que se comprueba que un POST venga de nuestra propia
// página. Sin guardarlo en x-forwarded-host, el login (y contestar, y guardar) solo funciona mientras el
// servidor del alojamiento ponga esa cabecera por su cuenta; el día que no lo haga, 403 para todo el mundo.
// Medido el 2026-10-02 contra el paquete de verdad: sin x-forwarded-host, entrar devuelve 403.
check('🪤 al repartir se guarda el nombre con el que llamaron', /'x-forwarded-host': cabeceras\['x-forwarded-host'\] \|\| cabeceras\.host/.test(arranque),
  'si se pisa el Host sin guardar el original, adentro compara el Origin del navegador contra 127.0.0.1 y rechaza todo POST');
check('y se guarda ANTES de pisar el Host', arranque.indexOf("'x-forwarded-host':") < arranque.indexOf("host: '127.0.0.1:' + puerto"),
  'si se pisa primero, lo que se guarda es ya el puerto interno');

// Y lo de adentro tiene que mirar esa cabecera, o lo anterior no sirve de nada.
const fuenteCabeceras = readFileSync(new URL('../cabeceras.ts', import.meta.url), 'utf8');
check('y adentro se compara contra ella', /x-forwarded-host/.test(fuenteCabeceras), 'cabeceras.ts dejó de mirar x-forwarded-host');
check('se mira lo que dice el sistema, no solo lo que dice cada proceso', /\/proc\/net\/tcp/.test(arranque));

// 🪤 La puerta de servicio se abre antes que el puerto. Estuvo dentro del callback del puerto, que es el único
// sitio donde no sirve para nada: si el puerto no abre, ese callback no se llama. Lo encontró un simulacro.
const fuenteWeb = readFileSync(new URL('../channels/web.ts', import.meta.url), 'utf8');
check('🪤 la puerta de servicio se abre antes que el puerto', fuenteWeb.indexOf('abrirPuertaDeServicio();') < fuenteWeb.indexOf('const servidor = serve('),
  'dentro del callback de serve() solo existe cuando el puerto funciona, que es justo cuando no hace falta');
check('y no abrir el puerto ya no tumba al proceso', /servidor\.on\('error'/.test(fuenteWeb));

// El sondeo tiene que decir POR QUÉ no contestan: «5 de 5 no contestaron» costó una mañana de registros.
check('el sondeo dice el motivo de cada puerto que falla', /res\(e\.code \|\| e\.message/.test(arranque));

// ---------- El hueco entre que abre la puerta y levantan los de adentro ----------
// 🪤 El enrutador abre en medio segundo (obligatorio) y los de adentro tardan unos segundos más. Quien entraba
// en ese hueco se llevaba un «todavía está arrancando» aunque bastaba esperar dos segundos.
check('🪤 se reintenta antes de rendirse', /const intentar = \(quedan\)/.test(arranque) && /intentar\(sinCuerpo \? 6 : 0\)/.test(arranque));
// 🪤 El cuerpo de un POST ya se consumió al primer intento: reenviarlo mandaría medio formulario.
check('🪤 solo se reintenta lo que no lleva cuerpo', /const sinCuerpo = pide\.method === 'GET' \|\| pide\.method === 'HEAD';/.test(arranque));
check('y lo que se ve es una pantalla, no texto pelado', /const ARRANCANDO = \[/.test(arranque) && /text\/html; charset=utf-8'/.test(arranque));
// 🪤 Un proceso que ni rechaza ni contesta dejaba la petición esperando para siempre.
check('🪤 el reparto tiene reloj…', /salida\.setTimeout\(4000/.test(arranque));
// …pero se quita al contestar: el chat en vivo se queda abierto a propósito.
check('…y se le quita en cuanto contesta, por el chat en vivo', /salida\.setTimeout\(0\);/.test(arranque));

// ---------- El que reparte sin mandar ----------
// 🪤 Esto rompió producción el 2026-09-30, con todo bien levantado. El alojamiento arrancó la aplicación dos
// veces: uno tomó el mando y levantó a los clientes por socket —bien—, y el otro se quedó de espejo. Pero el
// espejo no sondeaba (eso vivía dentro de «levantar a los míos») ni sabía de los sockets (se apuntan al
// levantar a cada hijo, y él no levanta a nadie). Así que repartía contra el puerto, que es justo lo que en ese
// servidor no funciona, y el sitio entero devolvía «todavía está arrancando».
check('🪤 la lista de a quién sondear sale de las rutas, no de los hijos', /\[\.\.\.new Set\(\[puertoConsola, \.\.\.rutas\.values\(\)\]\)\]/.test(arranque),
  'el espejo no tiene hijos: con la lista sacada de ahí, no sondea nada y cree que a todos se les llega por el puerto');
check('🪤 el espejo también sondea', /if \(seguirAlQueManda\(\)\) await sondearATodos\(\);/.test(arranque),
  'sondear no es cosa del dueño: es de quien reparte, y reparten los dos');
check('y aprende los sockets del índice', /if \(c\.sock\) socketDe\.set\(c\.puerto, c\.sock\)/.test(arranque) && /sock: socketPara\('consola'\)/.test(arranque));
check('🪤 sin haber sondeado, /_salud no dice que todos contestan', /!ultimoSondeo \? 'todav/.test(arranque),
  'un diagnóstico que inventa buenas noticias cierra la única pista que quedaba');
check('y el espejo dice por dónde reparte', /reparte: soyElDueno/.test(arranque));

// ---------- Que la consola llegue a un cliente aunque la red no responda ----------
// 🪤 Esto no es hipotético: el 2026-09-29 pasó en producción. Los tres clientes atendiendo perfectamente y la
// consola enseñándolos a los tres como «sin conexión», porque le hablaba por red y ahí la red entre nuestros
// propios procesos estaba bloqueada.
const { llamarACliente } = await import('../clientes.js');
const { createServer } = await import('node:http');
const dirSock = mkdtempSync(join(tmpdir(), 'aiva-sock-'));
const sock = join(dirSock, 'c.sock');
const deMentira = createServer((_pide, responde) => {
  responde.writeHead(200, { 'content-type': 'application/json' });
  responde.end(JSON.stringify({ ok: true }));
});
await new Promise<void>((r) => deMentira.listen(sock, () => r()));

// Un cliente cuyo puerto NO contesta (nadie escucha ahí) pero que sí tiene socket.
const clienteRaro = { slug: 'prueba', nombre: 'Prueba', puerto: 1, host: '', base: 'http://127.0.0.1:1', sock, prioridad: 'alta' as const, desde: '2026-01-01' };
const porSocket = await llamarACliente(clienteRaro, '/health').catch((e: Error) => e);
check('🪤 la consola entra por el socket cuando la red no contesta', porSocket instanceof Response && porSocket.status === 200, String(porSocket));

// Y si tampoco hay socket, falla de forma limpia en vez de quedarse colgada.
const sinNada = { ...clienteRaro, sock: undefined };
const nada = await llamarACliente(sinNada, '/health').then(() => null).catch((e: Error) => e);
check('y si no hay por dónde, se rinde con un error claro', nada instanceof Error, 'debería lanzar, no colgarse');
deMentira.close();

// ---------- Que los hijos se vayan de verdad al quedarse sin padre ----------
// Un abuelo (esta prueba) levanta un padre, el padre levanta un hijo que vigila. Se mata al padre con SIGKILL
// —que es lo que hace el alojamiento, sin despedidas— y el hijo tiene que irse solo.
const dir = mkdtempSync(join(tmpdir(), 'aiva-huerfano-'));
const hijoJs = join(dir, 'hijo.mjs');
const padreJs = join(dir, 'padre.mjs');
const senal = join(dir, 'sigo-vivo');
writeFileSync(
  hijoJs,
  `import { irseSiQuedaHuerfano } from ${JSON.stringify(new URL('../huerfano.ts', import.meta.url).href)};
   import { writeFileSync } from 'node:fs';
   irseSiQuedaHuerfano();
   setInterval(() => writeFileSync(${JSON.stringify(senal)}, String(Date.now())), 200);`,
);
writeFileSync(
  padreJs,
  `import { spawn } from 'node:child_process';
   spawn(process.execPath, ['--import', 'tsx', ${JSON.stringify(hijoJs)}], { env: { ...process.env, AIVA_SUPERVISADO: '1' }, stdio: 'ignore' });
   setInterval(() => {}, 1000);`,
);

const padre = spawn(process.execPath, ['--import', 'tsx', padreJs], { stdio: 'ignore' });
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
await esperar(3000);
let vivoAntes = 0;
try {
  vivoAntes = Number(readFileSync(senal, 'utf8'));
} catch {
  /* no llegó a arrancar */
}
check('el hijo vigilado arranca y da señales de vida', vivoAntes > 0, 'no escribió la señal; la prueba siguiente no valdría nada');

padre.kill('SIGKILL'); // como el alojamiento: sin aviso y sin despedida
await esperar(7000);
const ultima = Number(readFileSync(senal, 'utf8'));
// Si se fue, dejó de escribir hace rato. Si sigue vivo, la última señal es de hace un instante.
check('🪤 el hijo se va solo al quedarse sin padre', Date.now() - ultima > 3000, `siguió escribiendo hace ${Date.now() - ultima} ms: quedaría agarrando el puerto y el WhatsApp del cliente`);

console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
