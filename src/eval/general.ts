// La configuración general y quién le gana a quién. pnpm test:general
//
// Aquí se prueba una sola regla, que es la que sostiene el multicliente: **lo que decidió un negocio le gana a
// lo que diga la consola**. Si esto se rompe, un día alguien cambia un saludo «para todos» y le pisa el suyo a
// tres clientes que lo habían escrito a mano. No hay aviso que valga para eso: hay que probarlo.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'xencrm-general-'));
process.env.XENCRM_CLIENTES_DIR = dir;
process.env.DB_PATH = join(dir, 'prueba.db');

const { general, guardarGeneral, limpiar, resolver, DEFECTOS } = await import('../crm/general.js');
const { burbujaDe, ventanaDe, guardarSuyo, volverAloGeneral, loQueDecidio } = await import('../crm/chat-config.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};

// 🪤 Sin archivo, los defectos. Y los defectos son «lo de siempre»: nada encendido que nadie pidió.
check('sin configurar, los defectos', JSON.stringify(general()) === JSON.stringify(DEFECTOS));
check('🪤 y la burbuja NO se abre sola de fábrica', DEFECTOS.burbuja.abreSola === 0);
check('ni se esconde fuera de horario', DEFECTOS.burbuja.soloEnHorario === false);

guardarGeneral({ burbuja: { saludo: 'Hola desde la consola', posicion: 'izquierda', abreSola: 20, soloEnHorario: true }, ventana: { titulo: 'Escríbenos', pie: 'pie general', cerradaDice: '' } });
check('lo general se guarda y se relee', general().burbuja.saludo === 'Hola desde la consola');
check('y le llega al cliente que no ha decidido nada', burbujaDe().saludo === 'Hola desde la consola' && burbujaDe().posicion === 'izquierda');

// ── La regla ──
guardarSuyo('burbuja', { saludo: 'Lo que escribió el negocio' });
check('🪤 lo del cliente LE GANA a lo general', burbujaDe().saludo === 'Lo que escribió el negocio', burbujaDe().saludo);
// 🪤 Y lo que NO tocó sigue siendo lo general, y sigue cambiando con él. Guardar el objeto entero al tocar un
// campo congelaría aquí los valores generales de hoy, y ese cliente dejaría de recibir los cambios de arriba
// sin haber pedido nunca esa independencia.
check('🪤 lo que no tocó sigue viniendo de lo general', burbujaDe().posicion === 'izquierda' && burbujaDe().abreSola === 20);
check('y solo consta como suyo lo que tocó', JSON.stringify(loQueDecidio('burbuja')) === '["saludo"]', JSON.stringify(loQueDecidio('burbuja')));

guardarGeneral({ ...general(), burbuja: { ...general().burbuja, posicion: 'derecha', saludo: 'otro saludo general' } });
check('🪤 al cambiar lo general, lo no tocado se mueve…', burbujaDe().posicion === 'derecha');
check('…y lo que el negocio decidió NO se mueve', burbujaDe().saludo === 'Lo que escribió el negocio', burbujaDe().saludo);

// Una cadena vacía es una decisión («no quiero pie»), no un «no lo he tocado».
guardarSuyo('ventana', { pie: '' });
check('🪤 dejarlo en blanco es decidir, no es no haber tocado', ventanaDe().pie === '' && ventanaDe().titulo === 'Escríbenos', JSON.stringify(ventanaDe()));

volverAloGeneral('burbuja');
check('y se puede volver a lo general', burbujaDe().saludo === 'otro saludo general' && loQueDecidio('burbuja').length === 0);

// ── Lo que llega torcido ──
// 🪤 Esto acaba DENTRO de un archivo JavaScript que corre en el sitio de un cliente, así que nada de lo que
// venga se cree sin mirarlo: ni un número absurdo, ni una posición inventada, ni un texto sin fin.
const sucio = limpiar({ burbuja: { saludo: 'x'.repeat(900), posicion: 'arriba', abreSola: 99999, soloEnHorario: 'sí' }, ventana: { titulo: 42 } });
check('🪤 una posición inventada cae en la de siempre', sucio.burbuja.posicion === 'derecha');
check('un número absurdo se recorta', sucio.burbuja.abreSola === 300, String(sucio.burbuja.abreSola));
check('un texto sin fin se corta', sucio.burbuja.saludo.length === 400);
// 🪤 «sí» como texto no es verdadero. Un `Boolean('sí')` sería `true` y encendería solo un ajuste que nadie
// encendió; aquí solo el verdadero de verdad cuenta.
check('🪤 solo el sí de verdad enciende algo', sucio.burbuja.soloEnHorario === false);
check('y lo que no es texto no se cuela', sucio.ventana.titulo === '');
check('un archivo corrupto no tumba nada', JSON.stringify(limpiar(null)) === JSON.stringify(DEFECTOS));

writeFileSync(join(dir, 'general.json'), 'esto no es json');
check('ni uno ilegible: se vuelve a los defectos', general().burbuja.posicion === 'derecha');

// resolver() por su cuenta: `undefined` no pisa, todo lo demás sí.
check('resolver: undefined no pisa', resolver({ a: 1, b: 2 }, { a: undefined }).a === 1);
check('resolver: sin nada suyo, lo de todos', resolver({ a: 1 }, null).a === 1);

rmSync(dir, { recursive: true, force: true });
console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
