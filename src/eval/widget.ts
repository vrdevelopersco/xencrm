// Que el guion que se pega en el sitio de un cliente SE PUEDA LEER. pnpm test:widget
//
// 🪤 Esta prueba existe porque el mismo error ya ha roto dos archivos distintos: `public/widget.js` y la
// plantilla del lanzador en `src/paquete.ts`. Los dos son JavaScript escrito dentro de una cadena de
// JavaScript, y en los dos un comentario de varias líneas metido donde no iba partió la cadena y dejó el
// archivo sin cerrar. No da error al compilar —TypeScript no mira dentro de una cadena— ni al arrancar: da
// error en el navegador de un visitante, en el sitio de un cliente, donde nadie nuestro lo va a ver.
//
// Aquí se lee el archivo como lo lee un navegador. Si no parsea, falla aquí y no allá.
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
// 🪤 Se importa el MISMO escapador que usa el servidor, no una copia. Una copia parecida es una prueba que
// pasa mientras el archivo de verdad está roto, que es peor que no tener prueba.
import { paraCadenaJs } from '../crm/chat-config.js';

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};

const crudo = readFileSync(new URL('../../public/widget.js', import.meta.url), 'utf8');

const parsea = (js: string): string => {
  try {
    new Script(js);
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};

check('🪤 el widget tal cual parsea', parsea(crudo) === '', parsea(crudo));

// Y con los huecos rellenos, que es como sale de verdad. Se prueban valores con los caracteres que más daño
// hacen: una comilla simple cierra la cadena donde se mete, y una barra invertida se come lo siguiente.
const servido = (saludo: string, negocio = 'Boutique') =>
  crudo
    .replace('__AGENT_NAME__', 'Aiva')
    .replace('__STORE_NAME__', negocio)
    .replace('__BRAND_COLOR__', '#2f7d4f')
    .replace('__BRAND_LOGO__', '/brand/logo')
    .replace('__SALUDO__', paraCadenaJs(saludo))
    .replace('__POSICION__', 'derecha')
    .replace('__ABRE_SOLA__', '0');

check('con los huecos rellenos, también', parsea(servido('Hola, ¿qué buscas?')) === '');
// 🪤 El saludo lo escribe quien configura, en una caja de texto, y acaba DENTRO de una cadena de este archivo.
// Una comilla suya no puede dejar sin chat a todos los visitantes de su sitio.
check("🪤 un saludo con comilla no rompe el archivo", parsea(servido("Hola, ¿qué 'buscas' hoy?")) === '', parsea(servido("Hola, ¿qué 'buscas' hoy?")));
check('ni uno con barra invertida', parsea(servido('Mira esto \\ y esto')) === '', parsea(servido('Mira esto \\ y esto')));
check('ni uno con un salto de línea', parsea(servido('Hola\ny bienvenido')) === '');
check('ni uno que intente cerrar el guion', parsea(servido('</script><script>alert(1)</script>')) === '');

// Que no quede ningún hueco sin rellenar: uno olvidado sale tal cual al sitio del cliente.
const huecos = servido('hola').match(/__[A-Z_]+__/g);
check('no queda ningún hueco sin rellenar', huecos === null, String(huecos));

// Los dos modos existen de verdad, que es lo que sostiene que la burbuja y la ventana sean el mismo archivo.
check('sabe hacer de ventana y de burbuja', /data-modo/.test(crudo) && /VENTANA/.test(crudo));
// 🪤 La burbuja que se abre sola NUNCA en un teléfono: ahí el panel ocupa la pantalla entera y taparía el sitio
// que la persona está intentando leer.
check('🪤 no se abre sola en un teléfono', /ABRE_SOLA > 0[\s\S]{0,120}innerWidth > 480/.test(crudo));
check('ni a quien ya venía hablando', /ABRE_SOLA > 0 && !sessionId/.test(crudo));

// Y la plantilla del lanzador, que es el otro archivo con el mismo riesgo.
const paquete = readFileSync(new URL('../paquete.ts', import.meta.url), 'utf8');
const plantilla = /String\.raw`([\s\S]*?)`/.exec(paquete)?.[1] ?? '';
check('la plantilla del lanzador sigue estando', plantilla.length > 500);
check('🪤 y sigue sin acentos graves dentro', !plantilla.includes('`'));

console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
