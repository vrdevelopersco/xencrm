// Pruebas del blindaje contra quien desarma la aplicación desde fuera: pnpm test:blindaje
//
// Sale del estándar de seguridad de HRC (~/proyectos/AUDITORIA-SEGURIDAD.md) medido contra aiva en producción
// el 2026-11-07: sin una cabecera en la portada, el código entero del tablero y de la consola servido a quien no
// había entrado, /_salud contando versión y clientes sin token, la dirección de quien llama tomada de lo que él
// mismo escribe, y un freno de intentos que olvidaba todo en cada despliegue.
//
// Lo que se prueba aquí es lo que se puede probar sin el alojamiento: el borde de verdad (borde.cjs, el mismo
// archivo que carga el lanzador), la puerta de la consola, el freno con su reloj, la CSP de cada página y lo que
// queda del código después de afinarlo. Lo que solo se ve en el servidor —que el alojamiento no pise una
// cabecera— se mide con el verificador del estándar después de subir, no aquí.
//
// 🪤 Todo pasa en una carpeta temporal (AIVA_CLIENTES_DIR): el freno escribe en disco, y no puede ser en el de
// los clientes de verdad.
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'aiva-blindaje-'));
const clientesDir = join(dir, 'clientes');
mkdirSync(clientesDir, { recursive: true });
process.env.AIVA_CLIENTES_DIR = clientesDir;
process.env.DB_PATH = join(dir, 'aiva.db');
process.env.CONSOLA_TOKEN = 'llave-maestra-de-prueba-0123456789';
process.env.ADMIN_TOKEN = 'token-del-tablero-de-prueba-0123456789';
writeFileSync(join(clientesDir, 'index.json'), JSON.stringify({ clientes: [{ slug: 'boutique', nombre: 'Boutique', puerto: 39911, host: '', prioridad: 'alta', desde: '2026-01-01' }] }));

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const borde = createRequire(import.meta.url)('../borde.cjs') as any;
const RAIZ = new URL('../../', import.meta.url);
const leer = (ruta: string) => readFileSync(new URL(ruta, RAIZ), 'utf8');

// ---------- El borde: lo que lleva toda respuesta ----------
const json = borde.blindar({ 'Content-Type': 'application/json', Server: 'hcdn', 'X-Powered-By': 'Express' });
check('toda respuesta lleva HSTS con preload', /max-age=\d{8,};\s*includeSubDomains;\s*preload/.test(json['strict-transport-security']), json['strict-transport-security']);
check('y nosniff, no-referrer y ningún permiso del aparato',
  json['x-content-type-options'] === 'nosniff' && json['referrer-policy'] === 'no-referrer' && /camera=\(\)/.test(json['permissions-policy']) && /microphone=\(\)/.test(json['permissions-policy']));
check('nadie la mete en un marco ajeno', json['x-frame-options'] === 'DENY');
check('🪤 el servidor no se presenta (ni Server ni X-Powered-By)', !('server' in json) && !('x-powered-by' in json), JSON.stringify(json));
check('lo que no es una página: nada puede correr (un SVG abierto como página ejecuta JavaScript)', /default-src 'none'/.test(json['content-security-policy']));
check('🪤 lo que no dice nada de su caché queda SIN caché', json['cache-control'] === 'no-store',
  'al revés, una página que cambia según quién entró acaba servida a otro desde la caché del alojamiento');
const propia = borde.blindar({ 'content-type': 'text/html', 'content-security-policy': "default-src 'self'", 'cache-control': 'public, max-age=60' });
check('la CSP y la caché de la página mandan en lo suyo', propia['content-security-policy'] === "default-src 'self'" && propia['cache-control'] === 'public, max-age=60');
check('🪤 y una página sin CSP NO recibe una de relleno: que falte se tiene que ver', !('content-security-policy' in borde.blindar({ 'content-type': 'text/html' })),
  'una CSP genérica rompería los guiones en línea de la página, o los dejaría pasar todos sin decir nada');

// ---------- El borde: lo de adentro que no se sirve desde fuera ----------
const cerrados = ['/admin', '/admin.js', '/admin.js?v=1', '/admin/api/contacts', '/admin/monitor', '/_servicio', '/health', '/health?x=1'];
check('el tablero y lo de servicio de un cliente no se sirven por su ruta', cerrados.every((r) => borde.cerradoDesdeFuera(r, {})), cerrados.filter((r) => !borde.cerradoDesdeFuera(r, {})).join(', '));
// 🪤 El de adentro decodifica la ruta y no le importan las barras repetidas: una regla que no lo sepa es una
// puerta con el cartel cambiado.
const disfrazados = ['/%61dmin', '/admin%2ejs', '//admin', '/./admin', '/ADMIN', '/Admin.JS', '/%5f%73ervicio', '/%2fhealth'];
check('🪤 tampoco disfrazados (codificados, con barras repetidas, en mayúsculas)', disfrazados.every((r) => borde.cerradoDesdeFuera(r, {})), disfrazados.filter((r) => !borde.cerradoDesdeFuera(r, {})).join(', '));
check('una ruta que ni se puede leer, cerrada', borde.cerradoDesdeFuera('/%E0%A4%A', {}) === true);
const abiertos = ['/', '/chat', '/widget.js', '/api/chat', '/api/history', '/api/stream', '/brand/logo', '/libreta/abc', '/webhooks/meta', '/cita/1/x.ics', '/administrar'];
check('lo público del cliente sigue abierto: su chat, su burbuja, su logo, su calendario', abiertos.every((r) => !borde.cerradoDesdeFuera(r, {})), abiertos.filter((r) => borde.cerradoDesdeFuera(r, {})).join(', '));
check('TABLERO_DIRECTO=si vuelve a abrir el tablero por su ruta…', !borde.cerradoDesdeFuera('/admin', { TABLERO_DIRECTO: 'si' }) && !borde.cerradoDesdeFuera('/admin/api/x', { TABLERO_DIRECTO: 'Si' }));
check('…pero lo de servicio no se abre nunca', borde.cerradoDesdeFuera('/_servicio', { TABLERO_DIRECTO: 'si' }) && borde.cerradoDesdeFuera('/health', { TABLERO_DIRECTO: 'si' }));

// ---------- El borde: de dónde viene quien llama ----------
// 🪤 Medido en producción: el alojamiento AÑADE la dirección de verdad a la que mande el navegador. La primera la
// escribe quien llama.
const cadena = { 'x-forwarded-for': '203.0.113.8, 179.33.208.232, 10.0.0.1' };
check('sin regla, la primera, como siempre (hasta medir el alojamiento)', borde.direccionDeQuienLlama(cadena, undefined) === '203.0.113.8');
check('AIVA_IP=0 es la última; AIVA_IP=1, la anterior', borde.direccionDeQuienLlama(cadena, '0') === '10.0.0.1' && borde.direccionDeQuienLlama(cadena, '1') === '179.33.208.232');
check('y con más saltos que direcciones, la primera (no revienta)', borde.direccionDeQuienLlama(cadena, '9') === '203.0.113.8' && borde.direccionDeQuienLlama({}, '1') === '');
const limpias = borde.sinSuplantar({ 'cf-connecting-ip': '1.1.1.1', 'X-Real-IP': '2.2.2.2', forwarded: 'for=3.3.3.3', 'true-client-ip': '4.4.4.4', 'x-forwarded-for': '5.5.5.5, 6.6.6.6', cookie: 'a=1' }, '6.6.6.6');
check('🪤 hacia adentro pasa UNA dirección, la decidida, y ninguna de las que se pueden inventar',
  limpias['x-forwarded-for'] === '6.6.6.6' && !('cf-connecting-ip' in limpias) && !('X-Real-IP' in limpias) && !('forwarded' in limpias) && !('true-client-ip' in limpias) && limpias.cookie === 'a=1',
  JSON.stringify(limpias));

// ---------- El borde: la CSP de una página ----------
const pagina = '<html><head><script>var a=1</script><script src="admin.js"></script><style>b{}</style></head><body><script type="text/javascript">b()</script></body></html>';
const csp = borde.cspDePagina(pagina);
const huella = (js: string) => `'sha256-${createHash('sha256').update(js).digest('base64')}'`;
check('la CSP lleva la huella de cada guion en línea, y solo de esos', csp.includes(huella('var a=1')) && csp.includes(huella('b()')) && (csp.match(/'sha256-/g) ?? []).length === 2, csp);
check('🪤 y nada en línea sin huella: ni guiones ni manejadores', !/script-src[^;]*'unsafe-inline'/.test(csp) && !/'unsafe-eval'/.test(csp), csp);
for (const directiva of ["default-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'", "connect-src 'self'"]) {
  check(`la CSP dice ${directiva}`, csp.includes(directiva), csp);
}
const txt = borde.securityTxt('aiva.ejemplo.co', undefined, '2026-11-07');
const vence = Date.parse(/Expires: (\S+)/.exec(txt)?.[1] ?? '');
check('security.txt dice a quién escribir y vence dentro de un año (RFC 9116)',
  /^Contact: mailto:\S+@\S+/m.test(txt) && vence > Date.parse('2026-11-07') && vence <= Date.parse('2026-11-07') + 366 * 864e5 && /Canonical: https:\/\/aiva\.ejemplo\.co\/\.well-known\/security\.txt/.test(txt), txt);

// ---------- El lanzador: que todo salga por el borde ----------
const fuente = leer('src/paquete.ts');
const arranque = fuente.slice(fuente.indexOf('const ARRANQUE = String.raw`'), fuente.indexOf('\n`;', fuente.indexOf('const ARRANQUE = String.raw`')));
const escrituras = arranque.match(/responde\.writeHead\(/g)?.length ?? 0;
const blindadas = arranque.match(/responde\.writeHead\([^,]+, borde\.blindar\(/g)?.length ?? 0;
check('🪤 TODA respuesta del lanzador sale por borde.blindar', escrituras > 0 && escrituras === blindadas, `${blindadas} de ${escrituras}: la portada no llevaba ni una cabecera porque no era de nadie`);
check('el lanzador carga el borde de lo compilado, y el ZIP lo lleva ahí', /require\(join\(aqui, 'dist', 'borde\.cjs'\)\)/.test(arranque) && /cpSync\(resolve\('src', 'borde\.cjs'\), join\(dir, 'dist', 'borde\.cjs'\)\)/.test(fuente));
check('sirve security.txt', /camino === '\/\.well-known\/security\.txt'/.test(arranque) && /borde\.securityTxt\(/.test(arranque));
check('cierra lo de adentro de cada cliente antes de repartir', /if \(prefijo && borde\.cerradoDesdeFuera\(ruta, process\.env\)\)/.test(arranque)
  && arranque.indexOf('borde.cerradoDesdeFuera(ruta') < arranque.indexOf('const intentar = (quedan)'));
check('🪤 y hacia adentro va la dirección decidida, no la que escribió quien llama', /borde\.sinSuplantar\(cabeceras, borde\.direccionDeQuienLlama\(cabeceras, process\.env\.AIVA_IP\)\)/.test(arranque));
const salud = arranque.slice(arranque.indexOf("if (camino === '/_salud')"));
check('🪤 /_salud sin token solo dice que está en pie', /if \(!conToken\) \{[\s\S]{0,300}JSON\.stringify\(\{ ok: true \}\)/.test(salud)
  && salud.indexOf('if (!conToken)') < salud.indexOf('version:'), 'la versión le dice a quien hace reconocimiento qué fallos probar, y la lista de clientes, a quién');
check('y con token enseña cómo llegó la petición, para fijar AIVA_IP', /tuPeticion: \{/.test(salud) && /xForwardedFor:/.test(salud));
check('las páginas del lanzador llevan su CSP', /'content-security-policy': CSP_PORTADA/.test(arranque) && /'content-security-policy': CSP_ARRANCANDO/.test(arranque));
check('el ZIP se arma con lo servido afinado', /if \(process\.env\.AIVA_SIN_AFINAR !== '1'\) afinarLoServido\(join\(dir, 'public'\)\)/.test(fuente));

// ---------- La consola: la puerta sin el código de adentro ----------
const { Hono } = await import('hono');
const { mountConsola, partirLaConsola } = await import('../consola.js');
const { crearUsuario } = await import('../consola-usuarios.js');
const consolaHtml = leer('public/consola.html');
const partes = partirLaConsola(consolaHtml);
check('la consola se parte en la puerta y la consola', Boolean(partes), 'le falta alguna marca: <div id="login", <div id="app", <script id="guion-puerta">, <script id="guion-app">');
if (partes) {
  check('🪤 la puerta no lleva nada de adentro: ni las pantallas ni las rutas de la API',
    !/id="app"|guion-app|\/usuarios|\/clientes|\/libreta|\/general|\/pendientes|tablero\/modo/.test(partes.puerta),
    (partes.puerta.match(/id="app"|guion-app|\/usuarios|\/clientes|\/libreta|\/general|\/pendientes|tablero\/modo/g) ?? []).join(', '));
  check('y sí el formulario de entrar, con la llave maestra', ['id="u"', 'id="p"', 'id="entrar"', 'id="t"', 'id="entrar-maestra"'].every((m) => partes.puerta.includes(m)));
  check('la consola no lleva la puerta', !partes.consola.includes('id="login"') && !partes.consola.includes('guion-puerta'));
  check('la puerta pesa una fracción de la consola', partes.puerta.length < partes.consola.length / 2, `${partes.puerta.length} contra ${partes.consola.length}`);
}
const guionApp = consolaHtml.slice(consolaHtml.indexOf('<script id="guion-app">'));
check('🪤 la sesión ya no vive en el navegador: la consola no la guarda ni la manda a mano',
  !/localStorage\.(setItem|getItem)\('aiva\.consola\.(sesion|token)'/.test(consolaHtml) && !/x-consola-sesion|x-consola-token/.test(guionApp),
  'en el almacenamiento local la lee cualquier guion que llegue a correr en la página');
// 🪤 También los que se arman dentro de una cadena de JavaScript (`'onerror="…"'`): el logo de cada cliente en la
// consola llevaba uno así, y una búsqueda que pedía un espacio antes de `on` no lo vio. Lo vio la CSP, en Chrome.
const EN_LINEA_O_ARMADO = /(?:^|[\s'"<])on(?:error|load|click|dblclick|change|input|submit|reset|mouse\w+|pointer\w+|key\w+|focus\w*|blur|toggle|close|scroll|wheel|drag\w*|drop|touch\w+|animation\w+|transition\w+)\s*=\s*\\?["'`]|javascript:/i;
const conManejador = readdirSync(new URL('public/', RAIZ)).filter((n) => /\.(html|js)$/.test(n)).filter((n) => EN_LINEA_O_ARMADO.test(leer(`public/${n}`)));
check('🪤 ninguna página de la casa trae manejadores en línea ni javascript:, ni escritos ni armados en una cadena', conManejador.length === 0,
  `${conManejador.join(', ')}: la CSP no los deja correr, y el botón (o el logo) queda muerto sin decir por qué`);

const consola = new Hono();
mountConsola(consola);
crearUsuario({ usuario: 'ana', nombre: 'Ana', clave: 'clave-de-ana-1', rol: 'asesor', clientes: ['boutique'] });
const anonima = await consola.request('/consola');
const htmlAnonima = await anonima.text();
check('sin sesión, /consola es la puerta', anonima.status === 200 && htmlAnonima.includes('guion-puerta') && !htmlAnonima.includes('guion-app'));
check('🪤 que no se guarda en ninguna caché, y que depende de la galleta', anonima.headers.get('cache-control') === 'no-store' && /cookie/i.test(anonima.headers.get('vary') ?? ''),
  `${anonima.headers.get('cache-control')} · vary ${anonima.headers.get('vary')}`);
const huellasServidas = (html: string) => [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => huella(m[1]!));
const cspAnonima = anonima.headers.get('content-security-policy') ?? '';
check('y su CSP trae la huella de lo que la puerta trae en línea', huellasServidas(htmlAnonima).every((h) => cspAnonima.includes(h)) && huellasServidas(htmlAnonima).length > 0, cspAnonima);
const entro = await consola.request('/api/entrar', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '190.1.1.1' }, body: JSON.stringify({ usuario: 'ana', clave: 'clave-de-ana-1' }) });
const galleta = entro.headers.get('set-cookie') ?? '';
const sesion = /aiva_consola=([^;]*)/.exec(galleta)?.[1] ?? '';
check('entrar deja la sesión en una galleta HttpOnly, Strict', /HttpOnly/i.test(galleta) && /SameSite=Strict/i.test(galleta) && sesion.length > 20, galleta.replace(sesion, '…'));
check('🪤 y el cuerpo no la trae', !JSON.stringify(await entro.json()).includes(sesion));
const adentro = await consola.request('/consola', { headers: { cookie: `aiva_consola=${sesion}` } });
const htmlAdentro = await adentro.text();
check('con sesión, /consola es la consola entera', htmlAdentro.includes('guion-app') && !htmlAdentro.includes('guion-puerta'));
check('con su CSP propia', huellasServidas(htmlAdentro).every((h) => (adentro.headers.get('content-security-policy') ?? '').includes(h)));
const salida = await consola.request('/api/salir', { method: 'POST', headers: { cookie: `aiva_consola=${sesion}` } });
const borrada = salida.headers.get('set-cookie') ?? '';
check('🪤 al salir, la galleta se borra con los MISMOS atributos con que se puso', /Max-Age=0/i.test(borrada) && /HttpOnly/i.test(borrada) && /SameSite=Strict/i.test(borrada) && /Path=\//i.test(borrada),
  `${borrada} — borrar no hereda los atributos del alta (medido en producción: salía sin HttpOnly ni SameSite)`);
check('y la sesión queda muerta en el servidor', (await consola.request('/api/yo', { headers: { cookie: `aiva_consola=${sesion}` } })).status === 401);
check('🪤 la llave maestra ya no vale en la dirección (queda en los registros del alojamiento)',
  (await consola.request(`/api/yo?token=${process.env.CONSOLA_TOKEN}`)).status === 401 && (await consola.request('/api/yo', { headers: { 'x-consola-token': process.env.CONSOLA_TOKEN! } })).status === 200);
const conFallo = new Hono();
mountConsola(conFallo);
conFallo.get('/api/revienta', () => {
  throw new Error('no pude abrir /ruta/secreta/usuarios.json');
});
const reventon = await conFallo.request('/api/revienta', { headers: { 'x-consola-token': process.env.CONSOLA_TOKEN! } });
check('un error interno no le cuenta al de fuera qué se rompió (eso va al registro del servidor)', reventon.status === 500 && !/secreta|usuarios\.json/.test(await reventon.text()));

// ---------- El freno: tres barreras, con reloj, en disco ----------
const ingreso = await import('../ingreso.js');
const T0 = Date.parse('2026-11-07T12:00:00Z');
const MIN = 60_000;
// Por dirección: rociar cuentas distintas desde una sola conexión.
for (let i = 0; i < 10; i++) ingreso.anotarFalloDeIngreso('7.7.7.7', `inventada-${i}`, T0 + i);
const porDireccion = ingreso.frenoDelIngreso('7.7.7.7', 'otra-mas', T0 + 20);
check('10 fallos desde una dirección, aunque sea contra cuentas distintas: frenada', porDireccion !== null && /dirección/.test(porDireccion.motivo), JSON.stringify(porDireccion));
check('y se suelta sola a los 15 minutos', ingreso.frenoDelIngreso('7.7.7.7', 'otra-mas', T0 + 15 * MIN + 1) === null);
// 🪤 La del medio: insistir sobre UNA cuenta desde UNA conexión pasa por debajo de las otras dos.
for (let i = 0; i < 5; i++) ingreso.anotarFalloDeIngreso('8.8.8.8', 'Laura', T0 + i);
const delMedio = ingreso.frenoDelIngreso('8.8.8.8', 'laura', T0 + 10);
check('🪤 5 fallos sobre una cuenta desde una conexión: frenada (la barrera que falta siempre)', delMedio !== null, JSON.stringify(delMedio));
check('la cuenta se cuenta sin importar mayúsculas', ingreso.frenoDelIngreso('8.8.8.8', 'LAURA', T0 + 10) !== null);
// 🪤 Justo aquí, antes de que nada más escriba: si solo los fallos no se guardaran, un reinicio lo borraría todo.
ingreso.olvidarFrenoEnMemoria();
check('🪤 el freno sobrevive a un reinicio: vive en disco', ingreso.frenoDelIngreso('8.8.8.8', 'laura', T0 + 30) !== null,
  'un contador en memoria le regala borrón y cuenta nueva a quien espere al próximo despliegue');
// La del medio es otra que la de la cuenta, aunque salten con el mismo número: si laura entra bien desde OTRA
// conexión, su cuenta vuelve a cero, pero quien insistía desde esta sigue frenado.
ingreso.entroBien('8.8.4.4', 'laura', T0 + 40);
check('🪤 y la del medio es suya: aunque la cuenta vuelva a cero, esa conexión sigue frenada', ingreso.frenoDelIngreso('8.8.8.8', 'laura', T0 + 50) !== null
  && ingreso.frenoDelIngreso('8.8.4.4', 'laura', T0 + 50) === null, 'sin la barrera del medio, entrar desde otro lado le devolvía los intentos a quien insistía');
// Por cuenta, desde direcciones distintas, con espera creciente.
const esperas: number[] = [];
let t = T0;
for (let ronda = 0; ronda < 5; ronda++) {
  let bloqueo: number | undefined;
  for (let i = 0; i < 5; i++) bloqueo = ingreso.anotarFalloDeIngreso(`9.9.${ronda}.${i}`, 'marta', t + i).bloqueadaMin ?? bloqueo;
  esperas.push(bloqueo ?? 0);
  const f = ingreso.frenoDelIngreso('1.2.3.4', 'marta', t + 10);
  if (!f) esperas.push(-1);
  t = (f?.hasta ?? t) + 1;
}
check('🪤 cambiando de dirección contra una cuenta: 1, 5, 15, 60 y 60 minutos', esperas.join(',') === '1,5,15,60,60', esperas.join(','));
check('el bloqueo se levanta solo', ingreso.frenoDelIngreso('1.2.3.4', 'marta', t + 1) === null);
ingreso.anotarFalloDeIngreso('1.1.1.1', 'marta', t + 2);
ingreso.entroBien('1.1.1.1', 'marta', t + 3);
for (let i = 0; i < 4; i++) ingreso.anotarFalloDeIngreso(`5.5.5.${i}`, 'marta', t + 10 + i);
check('entrar bien pone a cero la cuenta, su historial de bloqueos incluido', ingreso.frenoDelIngreso('5.5.5.9', 'marta', t + 20) === null
  && ingreso.anotarFalloDeIngreso('5.5.5.5', 'marta', t + 21).bloqueadaMin === 1);
for (let i = 0; i < 9; i++) ingreso.anotarFalloDeIngreso('6.6.6.6', `rocio-${i}`, T0 + i);
ingreso.entroBien('6.6.6.6', 'mi-cuenta', T0 + 20);
ingreso.anotarFalloDeIngreso('6.6.6.6', 'rocio-9', T0 + 21);
check('🪤 pero no la dirección: entrar a la cuenta propia no borra los fallos contra las de otros', ingreso.frenoDelIngreso('6.6.6.6', 'rocio-10', T0 + 22) !== null);
for (let i = 0; i < 12; i++) ingreso.anotarFalloDeIngreso(`4.4.4.${i}`, 'maestra', T0 + i);
check('la llave maestra no se bloquea por cuenta: es la salida de emergencia', ingreso.frenoDelIngreso('4.4.4.200', 'maestra', T0 + 20) === null);
const aviso = ingreso.avisoDeFreno(T0 + 61_000, T0);
check('el texto y Retry-After dicen lo mismo', aviso.segundos === 120 && /2 minutos/.test(aviso.texto), JSON.stringify(aviso));
// Y por la puerta de verdad: el 429 con su cabecera.
let r429: Response | null = null;
for (let i = 0; i < 8 && !r429; i++) {
  const r = await consola.request('/api/entrar', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '11.11.11.11' }, body: JSON.stringify({ usuario: 'ana', clave: `mala-${i}` }) });
  if (r.status === 429) r429 = r;
}
const cuerpo429 = r429 ? ((await r429.json()) as { error?: string }) : {};
const minutos429 = Number(/Espera (\d+|un) minuto/.exec(cuerpo429.error ?? '')?.[1]?.replace('un', '1'));
check('🪤 todo 429 lleva Retry-After, y cuadra con el texto', Boolean(r429) && Number(r429!.headers.get('retry-after')) === minutos429 * 60, `${r429?.headers.get('retry-after')} · ${cuerpo429.error}`);
check('y con el freno puesto, ni la clave buena entra', (await consola.request('/api/entrar', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '11.11.11.11' }, body: JSON.stringify({ usuario: 'ana', clave: 'clave-de-ana-1' }) })).status === 429);

// ---------- Las páginas de cada cliente llevan su CSP ----------
const { mountAdmin } = await import('../channels/admin.js');
const tablero = new Hono();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
mountAdmin(tablero as any);
for (const ruta of ['/admin', '/admin/monitor']) {
  const r = await tablero.request(ruta);
  const html = await r.text();
  const c = r.headers.get('content-security-policy') ?? '';
  check(`${ruta} lleva CSP con la huella de lo suyo en línea`, r.status === 200 && /default-src 'self'/.test(c) && huellasServidas(html).every((h) => c.includes(h)), c.slice(0, 120));
}
const { app: web } = await import('../channels/web.js');
for (const ruta of ['/', '/chat']) {
  const r = await web.request(ruta);
  const c = r.headers.get('content-security-policy') ?? '';
  check(`la página pública ${ruta} lleva CSP`, /default-src 'self'/.test(c) && huellasServidas(await r.text()).every((h) => c.includes(h)), `${r.status} ${c.slice(0, 120)}`);
}
const inicio = leer('public/inicio.html');
check('la portada se sirve con la huella de lo suyo (la calcula el lanzador)', huellasServidas(inicio).every((h) => borde.cspDePagina(inicio).includes(h)));

// ---------- Lo que queda del código después de afinarlo ----------
const { afinarArchivo, marcasDe } = await import('../afinar.js');
for (const nombre of readdirSync(new URL('public/', RAIZ)).filter((n) => /\.(html|js)$/.test(n))) {
  const original = leer(`public/${nombre}`);
  const afinado = afinarArchivo(nombre, original);
  const notas = (afinado.match(/🪤/g) ?? []).length;
  check(`${nombre}: sin las notas de adentro, con sus marcas intactas`, notas === 0 && marcasDe(afinado) === marcasDe(original), `${notas} notas 🪤 · ${marcasDe(original)} → ${marcasDe(afinado)}`);
  if (nombre.endsWith('.js') && nombre !== 'widget.js') {
    let compila = true;
    try {
      new Function(afinado); // eslint-disable-line no-new-func
    } catch {
      compila = false;
    }
    check(`${nombre} afinado sigue siendo JavaScript válido`, compila);
  }
}
const consolaAfinada = afinarArchivo('consola.html', consolaHtml);
check('🪤 la consola afinada se sigue partiendo en puerta y consola', Boolean(partirLaConsola(consolaAfinada)), 'el afinado se comió alguna marca de las que recorta el servidor');
check('y el tablero afinado conserva su </head> (ahí se le inyecta quién entró)', afinarArchivo('admin.html', leer('public/admin.html')).includes('</head>'));
const widget = leer('public/widget.js');
const widgetAfinado = afinarArchivo('widget.js', widget);
check("🪤 widget.js conserva sus comillas simples alrededor de cada marca (quien las llena escapa para esa comilla)",
  ['__SALUDO__', '__AGENT_NAME__', '__STORE_NAME__', '__POSICION__', '__ABRE_SOLA__'].every((m) => widgetAfinado.includes(`'${m}'`)),
  'el minificador pasa las comillas a dobles: un saludo con una comilla doble rompería la cadena');
let widgetCompila = true;
try {
  new Function(widgetAfinado); // eslint-disable-line no-new-func
} catch {
  widgetCompila = false;
}
check('widget.js sin sus comentarios sigue siendo JavaScript válido', widgetCompila);
check('y solo perdió líneas de comentario: lo demás, igual línea por línea',
  widget.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n') === widgetAfinado || widgetAfinado.split('\n').every((l) => widget.split('\n').includes(l)));
check("y su saludo de respaldo no se pliega", widgetAfinado.includes("'__SALUDO__' || ("), 'el minificador pliega «cadena || …» a la cadena sola: se pierde el saludo de respaldo');

console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
