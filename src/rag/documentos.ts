// Cargarle conocimiento a un negocio desde su tablero, sin entrar al servidor.
//
// Hasta ahora el único camino era dejar un archivo en `clientes/<slug>/conocimiento/` y reindexar, o sea entrar
// por ssh. Por eso hay clientes dados de alta hace semanas con el índice en cero: no es que no tengan nada que
// contar, es que no tenían por dónde metérselo.
//
// 🪤 Todo acaba en un ARCHIVO, no solo en la base. El reindexado hace `replaceDocs('knowledge', …)`, que borra
// las filas de esa fuente y las vuelve a construir leyendo el directorio: lo que se hubiera guardado solo en la
// base desaparecería en el siguiente reindexado, sin aviso y sin que nadie relacione una cosa con la otra —y el
// reindexado lo dispara cualquiera, desde otro botón, días después—. Se escribe el archivo y luego se indexa
// desde él, que es el mismo camino que ya usa todo lo demás.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { business } from '../config.js';
import { getDb } from './store.js';
import { runIngest } from './ingest.js';

export interface DocumentoDelNegocio {
  /** El nombre del archivo, que es su identidad: se borra y se reemplaza por él. */
  archivo: string;
  titulo: string;
  bytes: number;
  cuando: number;
  /** En cuántos trozos quedó al indexarlo. 0 = está el archivo pero todavía no se ha reindexado. */
  fragmentos: number;
}

const carpeta = (): string => business.sources.knowledgeDir;

/**
 * 🪤 El nombre viene de un navegador, así que no se usa tal cual.
 *
 * Un archivo llamado `../../.env` escribiría fuera de la carpeta del cliente; uno llamado `../../../otro-cliente/
 * conocimiento/precios.md` le escribiría a OTRO negocio. Aquí se tira todo lo que no sea el nombre pelado y se
 * deja solo lo que puede ir en un nombre de archivo. Lo que quede vacío después de limpiar no se acepta: mejor
 * negarse que inventarle un nombre a algo que alguien quiso llamar de otra forma.
 */
export function nombreSeguro(nombre: string): string {
  const base = (nombre.split(/[/\\]/).pop() ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\.[a-z0-9]{1,8}$/i, '') // cualquier extensión: subir «precios.docx» no debe dejar un «precios-docx.md»
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base ? `${base}.md` : '';
}

/** El nombre del archivo, legible: «politicas-de-pago.docx» → «politicas de pago». */
const legible = (nombre: string): string => nombre.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();

/**
 * La primera línea, si de verdad parece un título: corta, sin punto final y sin pinta de frase suelta.
 *
 * Es un criterio tonto a propósito. Lo que no puede pasar es que una primera línea que es media frase acabe de
 * encabezado de todo el documento y se lleve por delante la búsqueda; ante la duda, no se usa.
 */
function deLaPrimeraLinea(texto: string): string {
  const primera = (texto.split('\n')[0] ?? '').trim();
  if (!primera || primera.length > 80 || primera.endsWith('.') || primera.endsWith(',')) return '';
  return primera;
}

/** Lo que el negocio tiene cargado, con cuántos trozos hizo cada archivo. */
export function documentosDelNegocio(): DocumentoDelNegocio[] {
  const dir = carpeta();
  if (!existsSync(dir)) return [];
  // Cuántos fragmentos salió de cada archivo. `meta.file` lo escribe el indexador con la ruta relativa.
  const porArchivo = new Map<string, number>();
  for (const fila of getDb().prepare("SELECT meta FROM docs WHERE kind = 'knowledge'").all() as { meta: string }[]) {
    try {
      const m = JSON.parse(fila.meta ?? '{}') as { file?: string };
      if (m.file) porArchivo.set(m.file, (porArchivo.get(m.file) ?? 0) + 1);
    } catch {
      /* una fila con meta rota no debe tumbar la lista entera */
    }
  }

  const salida: DocumentoDelNegocio[] = [];
  const recorrer = (sub: string) => {
    for (const entrada of readdirSync(join(dir, sub), { withFileTypes: true })) {
      const rel = sub ? join(sub, entrada.name) : entrada.name;
      if (entrada.isDirectory()) {
        recorrer(rel);
        continue;
      }
      if (!/\.(md|txt)$/i.test(entrada.name)) continue;
      const completa = join(dir, rel);
      const info = statSync(completa);
      const texto = readFileSync(completa, 'utf8');
      // El mismo título que le pondrá el indexador: el primer encabezado, o el nombre del archivo.
      const h1 = /^#\s+(.+)$/m.exec(texto)?.[1]?.trim();
      salida.push({
        archivo: rel,
        titulo: h1 || entrada.name.replace(/\.(md|txt)$/i, '').replace(/[-_]+/g, ' '),
        bytes: info.size,
        cuando: info.mtimeMs,
        fragmentos: porArchivo.get(rel) ?? 0,
      });
    }
  };
  recorrer('');
  return salida.sort((a, b) => b.cuando - a.cuando);
}

/** Que el archivo quede dentro de la carpeta de este cliente y en ningún otro sitio. */
function rutaDentro(archivo: string): string {
  const dir = resolve(carpeta());
  const destino = resolve(dir, archivo);
  // 🪤 Se comprueba sobre la ruta YA RESUELTA, no sobre el texto que llegó: `a/../../b` solo se ve que sale de
  // la carpeta después de resolverlo. Comprobar la cadena a mano es la forma clásica de que se escape uno.
  if (destino !== dir && !destino.startsWith(dir + '/')) throw new Error('ese archivo no es de este negocio');
  return destino;
}

/**
 * Guarda un documento del negocio y lo deja indexado.
 *
 * El texto puede venir escrito a mano en el tablero o sacado de un Word o un Excel que alguien subió. Da igual:
 * aquí llega texto y sale un `.md` en la carpeta del negocio, que es lo que el indexador sabe leer.
 */
export async function guardarDocumento(nombre: string, texto: string, titulo = ''): Promise<DocumentoDelNegocio> {
  const limpio = texto.trim();
  if (!limpio) throw new Error('el documento está vacío');
  if (limpio.length > 400_000) throw new Error('el documento es demasiado largo; pártelo en varios');
  const archivo = nombreSeguro(titulo || nombre);
  if (!archivo) throw new Error('ponle un nombre al documento');

  const dir = carpeta();
  // La carpeta puede no existir: un cliente dado de alta y nunca tocado no la tiene. Que no sea eso lo que
  // impida cargar el primer documento.
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  // El indexador saca el título del primer encabezado, así que se le pone si el texto no trae uno.
  //
  // 🪤 Y antes de caer en el nombre del archivo, se mira la primera línea del documento. Casi todos los Word que
  // sube un negocio empiezan por su propio título —«Servicios de XENTRIS LLC»— y usar en su lugar el nombre
  // del archivo convierte eso en «servicios xentris», que es peor para quien busca y peor para el modelo. El nombre
  // del archivo es el último recurso, no el primero.
  let conTitulo: string;
  if (/^#\s+/m.test(limpio)) {
    conTitulo = limpio; // ya trae encabezado propio: no se le toca nada
  } else {
    const primera = deLaPrimeraLinea(limpio);
    const cabeza = titulo || primera || legible(nombre);
    // Si el título SALE de la primera línea, esa línea se asciende: dejarla también en el cuerpo la repetiría
    // entera —«# Servicios de XENTRIS» y debajo «Servicios de XENTRIS»—, que es ruido en la pantalla y un fragmento
    // peor para buscar.
    const cuerpo = !titulo && primera ? limpio.slice(limpio.indexOf('\n') + 1).trim() : limpio;
    conTitulo = `# ${cabeza}\n\n${cuerpo}`;
  }
  writeFileSync(rutaDentro(archivo), conTitulo.endsWith('\n') ? conTitulo : conTitulo + '\n');

  // Se reindexa TODO el conocimiento y no solo este archivo, a propósito: es el mismo camino que usa el botón de
  // reindexar y el arranque, así que no hay un segundo camino que pueda quedarse atrás. Un negocio tiene
  // decenas de fragmentos, no millones; cuando eso deje de ser cierto, se parte.
  await runIngest({ only: 'knowledge' });

  const hecho = documentosDelNegocio().filter((d) => d.archivo === archivo)[0];
  if (!hecho) throw new Error('lo guardé pero no lo encuentro; mira el reindexado');
  return hecho;
}

/**
 * Borra un documento del negocio.
 *
 * 🪤 Borra el ARCHIVO y luego reindexa. Borrar solo las filas de la base dejaría el archivo en su sitio y el
 * documento volvería entero en el siguiente reindexado, que es la clase de fallo que hace que alguien deje de
 * confiar en el botón de borrar.
 */
export async function borrarDocumento(archivo: string): Promise<boolean> {
  const destino = rutaDentro(archivo);
  if (!existsSync(destino)) return false;
  rmSync(destino);
  await runIngest({ only: 'knowledge' });
  return true;
}

/**
 * Guarda el catálogo de productos del negocio (JSON o CSV) y lo indexa.
 *
 * Va aparte del conocimiento porque es otra cosa: un producto es una ficha con precio y existencias, no un
 * fragmento de texto, y el indexador los trata distinto. Pero el problema era el mismo —solo se podía poner
 * entrando al servidor— y la solución también.
 */
export async function guardarCatalogo(texto: string, comoCsv: boolean): Promise<number> {
  const limpio = texto.trim();
  if (!limpio) throw new Error('el catálogo está vacío');
  if (!comoCsv) {
    // Se valida ANTES de escribir: un JSON roto guardado deja al negocio sin catálogo hasta que alguien mire
    // los registros del servidor, y el aviso de «no pude leer el catálogo» sale por consola, donde no lo ve.
    let datos: unknown;
    try {
      datos = JSON.parse(limpio);
    } catch {
      throw new Error('ese archivo no es un JSON válido');
    }
    const lista = Array.isArray(datos) ? datos : (datos as { products?: unknown[] })?.products;
    if (!Array.isArray(lista)) throw new Error('esperaba una lista de productos, o un objeto con "products" dentro');
    if (!lista.length) throw new Error('la lista de productos está vacía');
  }

  const destino = business.sources.productsFile;
  const dir = destino.replace(/\/[^/]+$/, '');
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  // 🪤 El indexador decide por la extensión: con `.csv` usa su lector de CSV y con cualquier otra cosa prueba
  // JSON. Si el archivo configurado se llama `productos.json` y le escribimos un CSV dentro, no lo lee y el
  // negocio se queda sin catálogo sin que nadie entienda por qué.
  const ruta = comoCsv ? destino.replace(/\.[^./]+$/, '.csv') : destino;
  writeFileSync(ruta, limpio.endsWith('\n') ? limpio : limpio + '\n');
  if (ruta !== destino) {
    // La configuración apunta al otro archivo: se avisa en vez de dejarlo escrito donde nadie lo lee.
    rmSync(ruta);
    throw new Error('este negocio tiene el catálogo configurado como JSON. Súbelo en JSON, o cámbiale la ruta en la configuración.');
  }
  await runIngest({ only: 'products' });
  return (getDb().prepare("SELECT count(*) n FROM docs WHERE kind = 'product'").get() as { n: number }).n;
}
