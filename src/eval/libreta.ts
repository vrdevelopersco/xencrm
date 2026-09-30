// Pruebas de la libreta: quién puede abrirla. pnpm test:libreta
//
// Esto no prueba que aiva conteste bien —eso es el modelo—, prueba la cerradura. Es la única puerta del sistema
// que no pide sesión, así que lo único que la separa de internet es lo que se comprueba aquí.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.AIVA_CLIENTES_DIR = mkdtempSync(join(tmpdir(), 'aiva-libreta-'));
const { libretaConfig, guardarLibretaConfig, deDondeViene, direccionPermitida } = await import('../crm/libreta-config.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};

// 🪤 Lo primero y lo más importante: recién instalado, sin que nadie haya tocado nada, la libreta está CERRADA.
// Si el defecto fuera al revés, cada cliente nuevo saldría a producción con una puerta abierta al modelo.
const virgen = libretaConfig();
check('🪤 sin configurar, la libreta está cerrada', virgen.llave === '' && virgen.ips.length === 0, JSON.stringify(virgen));
check('y una llave vacía no abre nada', !direccionPermitida('1.2.3.4', virgen.ips));

const LLAVE = 'K7mPq2XrvTb9nHs4YwLc8ZdFgJ3aQeRu';
guardarLibretaConfig({ llave: LLAVE, ips: ['190.24.10.4'] });
// El cache dura cinco segundos, pero guardar tiene que invalidarlo: quien quita una dirección la quita YA.
const guardada = libretaConfig();
check('guardar se ve en el acto, sin esperar el cache', guardada.llave === LLAVE && guardada.ips[0] === '190.24.10.4');

check('la dirección exacta entra', direccionPermitida('190.24.10.4', guardada.ips));
check('otra dirección no', !direccionPermitida('190.24.10.5', guardada.ips));
// 🪤 «Ninguna» es lo que vale cuando la lista está vacía. Una lista vacía tratada como «todas» —que es el error
// clásico de los filtros— convertiría el sello en decoración justo cuando alguien lo borra por error.
check('🪤 lista vacía = nadie, no todos', !direccionPermitida('190.24.10.4', []));
check('sin dirección conocida, tampoco', !direccionPermitida('', guardada.ips));

// Una red entera, para quien tiene dirección dinámica dentro de su operador.
check('un prefijo terminado en punto cubre su red', direccionPermitida('190.24.77.9', ['190.24.']));
// 🪤 Y no cubre a quien solo se le PARECE: sin el punto, «190.24» dejaría entrar a 190.240.x.x, que es de otro.
check('🪤 pero no a una red que empieza igual', !direccionPermitida('190.240.1.1', ['190.24.']));

check('de dónde viene: la primera de la cadena', deDondeViene({ 'x-forwarded-for': '190.24.10.4, 10.0.0.1' }, '127.0.0.1') === '190.24.10.4');
check('y sin cabeceras, ninguna', deDondeViene({}) === '');

// 🪤 La cabecera solo vale si la conexión llegó desde la misma máquina, que es donde está el servidor del
// alojamiento. Si llega directa de internet, `x-forwarded-for` es texto que escribió quien llama: creerla sería
// dejar que cualquiera diga desde dónde viene, y el sello por dirección no valdría nada.
check(
  '🪤 una petición directa no puede mentir sobre su dirección',
  deDondeViene({ 'x-forwarded-for': '190.24.10.4' }, '45.9.8.7') === '45.9.8.7',
  deDondeViene({ 'x-forwarded-for': '190.24.10.4' }, '45.9.8.7'),
);
check('y con esa mentira no entra', !direccionPermitida(deDondeViene({ 'x-forwarded-for': '190.24.10.4' }, '45.9.8.7'), ['190.24.10.4']));
check('desde el servidor de delante sí se le cree', deDondeViene({ 'x-forwarded-for': '190.24.10.4' }, '::ffff:127.0.0.1') === '190.24.10.4');
check('y una red interna también cuenta como de casa', deDondeViene({ 'x-forwarded-for': '190.24.10.4' }, '10.0.0.3') === '190.24.10.4');
// Sin nada delante —abriendo desde la propia máquina— la dirección es la del socket, y así se puede probar.
check('en local, sin proxy, vale la del socket', deDondeViene({}, '127.0.0.1') === '127.0.0.1');
// 🪤 `::1` y `127.0.0.1` son la MISMA máquina, y cuál te toca depende de por dónde entres. Sin unificarlas, uno
// añade su dirección en la consola, prueba, y le sigue diciendo que no, sin ninguna pista de por qué.
check('🪤 ::1 y 127.0.0.1 son la misma máquina', deDondeViene({}, '::1') === '127.0.0.1');
check('y así la que añadiste en la consola sí abre', direccionPermitida(deDondeViene({}, '::1'), ['127.0.0.1']));

// Quitar la llave cierra la puerta entera, no la deja a medias.
guardarLibretaConfig({ llave: '', ips: [] });
check('cerrar la libreta la deja cerrada', libretaConfig().llave === '');

// ── La cerradura tal como la usa el servidor ──
// Se copia aquí la comprobación de channels/web.ts para poder probarla sin levantar nada: si cambia allá y no
// acá, esta prueba deja de valer, y por eso el test siguiente comprueba que el original no se ablandó.
const puedeAbrir = (llaveDada: string, ip: string) => {
  const cfg = libretaConfig();
  if (!cfg.llave || cfg.llave.length < 16) return false;
  if (llaveDada.length !== cfg.llave.length) return false;
  let dif = 0;
  for (let i = 0; i < llaveDada.length; i++) dif |= llaveDada.charCodeAt(i) ^ cfg.llave.charCodeAt(i);
  return dif === 0 && direccionPermitida(ip, cfg.ips);
};

guardarLibretaConfig({ llave: LLAVE, ips: ['190.24.10.4'] });
check('con llave y dirección, abre', puedeAbrir(LLAVE, '190.24.10.4'));
// 🪤 Las dos cerraduras, no una. Una llave se filtra en un historial o en una captura de pantalla; si bastara
// con ella, ese descuido abriría la puerta desde cualquier parte del mundo.
check('🪤 con la llave pero desde otra dirección, NO', !puedeAbrir(LLAVE, '201.1.1.1'));
check('desde la dirección buena pero con otra llave, NO', !puedeAbrir('K7mPq2XrvTb9nHs4YwLc8ZdFgJ3aQeRX', '190.24.10.4'));
check('una llave más corta no cuela', !puedeAbrir(LLAVE.slice(0, 20), '190.24.10.4'));

guardarLibretaConfig({ llave: 'corta', ips: ['190.24.10.4'] });
check('una llave corta no abre aunque esté guardada', !puedeAbrir('corta', '190.24.10.4'));

// Que el servidor siga siendo igual de estricto que lo que se probó arriba.
const { readFileSync } = await import('node:fs');
const web = readFileSync(new URL('../channels/web.ts', import.meta.url), 'utf8');
check('🪤 el servidor sigue exigiendo las dos cosas', /cfg\.llave\.length < 16/.test(web) && /direccionPermitida\(/.test(web), 'revisa abierta() en channels/web.ts');
check('y una llave que no vale es 404, no 403', /if \(!abierta\(c\)\) return c\.notFound\(\);/.test(web));

rmSync(process.env.AIVA_CLIENTES_DIR!, { recursive: true, force: true });
console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
