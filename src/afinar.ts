// Lo que se sirve al navegador, sin comentarios: lo usa pnpm paquete al armar el ZIP (y test:blindaje).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { transformSync } from 'esbuild';

/**
 * Las páginas y los guiones que ve el navegador, sin comentarios ni espacios, y con los nombres de adentro
 * acortados.
 *
 * 🪤 Los comentarios de este código explican POR QUÉ cada cosa es como es, trampas incluidas: dónde estuvo un
 * fallo, qué frena qué, en qué orden se comprueba. Es justo lo que necesita quien quiere desarmar la aplicación,
 * y se le servía entero a cualquiera que abriera la página. En el repositorio se quedan; al ZIP no van.
 *
 * Lo que el servidor rellena al servir (`__NEGOCIO__`, `__STORE_NAME__`…) tiene que salir intacto: si no, la
 * página sale con la marca a la vista o rota. Se cuentan antes y después, y si no cuadran el ZIP no se arma.
 *
 * 🪤 widget.js NO pasa por el minificador. Sus marcas van dentro de cadenas con comilla simple, y quien las llena
 * escapa justo para esa comilla (crm/chat-config.ts). El minificador cambia las comillas a dobles —con eso, un
 * saludo con una comilla doble rompería la cadena— y además pliega `'__SALUDO__' || …` a la marca sola, porque
 * una cadena no vacía siempre es verdadera, y se pierde el saludo de respaldo. A ese solo se le quitan las líneas
 * que son comentario. `AIVA_SIN_AFINAR=1` arma el ZIP con todo legible, para mirar un fallo en el servidor.
 */
export function afinarLoServido(carpeta: string): void {
  let antes = 0;
  let despues = 0;
  for (const nombre of readdirSync(carpeta)) {
    const ext = extname(nombre);
    if (ext !== '.html' && ext !== '.js') continue;
    const ruta = join(carpeta, nombre);
    const original = readFileSync(ruta, 'utf8');
    const afinado = afinarArchivo(nombre, original);
    writeFileSync(ruta, afinado);
    antes += original.length;
    despues += afinado.length;
  }
  console.log(`→ lo que se sirve, sin comentarios: ${Math.round(antes / 1024)} KB → ${Math.round(despues / 1024)} KB`);
}

/** Un archivo de public/, afinado según lo que es. Si sus marcas no salen intactas, no se sigue. */
export function afinarArchivo(nombre: string, original: string): string {
  const ext = extname(nombre);
  const afinado = nombre === 'widget.js' ? sinLineasDeComentario(original) : ext === '.js' ? jsAfinado(original) : htmlAfinado(original);
  if (marcasDe(afinado) !== marcasDe(original)) throw new Error(`${nombre}: al afinarlo cambiaron las marcas que llena el servidor (${marcasDe(original)} → ${marcasDe(afinado)})`);
  return afinado;
}
export const marcasDe = (s: string) => (s.match(/__[A-Z][A-Z_]+__/g) ?? []).sort().join(',');

export const jsAfinado = (js: string) => transformSync(js, { loader: 'js', minify: true, legalComments: 'none', charset: 'utf8' }).code.trimEnd();
const cssAfinado = (css: string) => transformSync(css, { loader: 'css', minify: true, legalComments: 'none', charset: 'utf8' }).code.trimEnd();

/**
 * Una página: se afinan sus guiones en línea y sus hojas de estilo, y se le quitan los comentarios de HTML. Las
 * etiquetas, los atributos y el texto se quedan como están: de ahí cuelgan los `id` que la consola recorta y el
 * `</head>` donde se le inyecta al tablero quién entró.
 */
export function htmlAfinado(html: string): string {
  return html
    .split(/(<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>)/i)
    .map((trozo, i) => {
      if (i % 2 === 0) return trozo.replace(/<!--(?!\[)[\s\S]*?-->/g, '');
      const m = /^(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2>)$/i.exec(trozo);
      if (!m || !m[3]!.trim()) return trozo;
      if (m[2]!.toLowerCase() === 'style') return m[1] + cssAfinado(m[3]!) + m[4];
      return /\bsrc\s*=/i.test(m[1]!) ? trozo : m[1] + jsAfinado(m[3]!) + m[4];
    })
    .join('');
}

/**
 * Solo las líneas que son enteras un comentario `//`. Sin tocar nada más, que es lo que hace falta en widget.js.
 *
 * 🪤 Salvo dentro de una cadena que sigue en la línea siguiente (termina en `\`): widget.js lleva su hoja de estilos
 * así, y una línea de ahí que empezara por `//` es texto, no un comentario.
 */
export const sinLineasDeComentario = (js: string): string => {
  const quedan: string[] = [];
  for (const linea of js.split('\n')) {
    const sigueLaCadena = /\\$/.test(quedan.at(-1) ?? '');
    if (!sigueLaCadena && /^\s*\/\/(?!#)/.test(linea)) continue;
    quedan.push(linea);
  }
  return quedan.join('\n');
};
