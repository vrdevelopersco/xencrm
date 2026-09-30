// Sacar el texto de un archivo que alguien adjunta a una pregunta.
//
// La idea es pegar un documento y preguntar sobre él, no guardar archivos: nada de esto toca el disco. Se lee
// en memoria, se saca el texto, y el archivo se olvida.
//
// 🪤 El tipo se decide por el CONTENIDO, no por el nombre. Un ejecutable renombrado a `.pdf` sigue siendo un
// ejecutable, y confiar en la extensión es confiar en quien sube el archivo. Aquí se miran los primeros bytes;
// si no son de un formato que sepamos leer, se rechaza y punto. No se intenta adivinar.
//
// Word y Excel son archivos ZIP con XML dentro, así que se leen sin depender de nada: Node ya trae con qué
// descomprimir. Es unas sesenta líneas y evita meter una librería de varios megas en un paquete que viaja
// entero en cada actualización.
import { inflateRawSync } from 'node:zlib';

export interface Adjunto {
  nombre: string;
  texto: string;
}

/** Lo más grande que se acepta por archivo. Un documento de trabajo cabe de sobra; un vídeo, no. */
export const TOPE_ARCHIVO = 2 * 1024 * 1024;
/** Y lo más largo que se le pasa al modelo por archivo: más que esto no ayuda y sí cuesta. */
const TOPE_TEXTO = 20_000;

const empiezaPor = (b: Uint8Array, bytes: number[]): boolean => bytes.every((x, i) => b[i] === x);

/**
 * 🪤 Lo que NUNCA se abre. Se mira antes que nada: si esto acierta, no se sigue mirando.
 *
 * No es por miedo a que «se ejecute» —aquí nada se ejecuta ni se guarda—, es porque un archivo así en esta
 * puerta significa que algo va mal, y lo correcto es decirlo en vez de sacarle bytes con forma de texto.
 */
function esPeligroso(b: Uint8Array): boolean {
  return (
    empiezaPor(b, [0x4d, 0x5a]) || // MZ: ejecutable de Windows
    empiezaPor(b, [0x7f, 0x45, 0x4c, 0x46]) || // ELF: ejecutable de Linux
    empiezaPor(b, [0xca, 0xfe, 0xba, 0xbe]) || // Mach-O / class de Java
    empiezaPor(b, [0xcf, 0xfa, 0xed, 0xfe]) || // Mach-O de 64 bits
    empiezaPor(b, [0x23, 0x21]) // #! : un guion de consola
  );
}

// ---------- ZIP, lo justo para Word y Excel ----------
const u16 = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8);
const u32 = (b: Uint8Array, i: number) => (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0;

/** Saca un archivo de dentro del ZIP. Devuelve null si no está o si viene comprimido de una forma rara. */
function delZip(b: Uint8Array, cual: string): string | null {
  // El índice del ZIP está al final, y hay que buscarlo hacia atrás porque su tamaño es variable.
  let fin = -1;
  for (let i = b.length - 22; i >= 0 && i > b.length - 66_000; i--) {
    if (u32(b, i) === 0x06054b50) {
      fin = i;
      break;
    }
  }
  if (fin === -1) return null;
  let p = u32(b, fin + 16);
  const cuantos = u16(b, fin + 10);
  for (let n = 0; n < cuantos && p + 46 <= b.length; n++) {
    if (u32(b, p) !== 0x02014b50) return null;
    const metodo = u16(b, p + 10);
    const comprimido = u32(b, p + 20);
    const largoNombre = u16(b, p + 28);
    const nombre = Buffer.from(b.slice(p + 46, p + 46 + largoNombre)).toString('utf8');
    const desdeLocal = u32(b, p + 42);
    if (nombre === cual) {
      // La cabecera local repite el nombre y los extras, con largos propios: hay que saltarlos desde ella.
      const ln = u16(b, desdeLocal + 26);
      const le = u16(b, desdeLocal + 28);
      const datos = b.slice(desdeLocal + 30 + ln + le, desdeLocal + 30 + ln + le + comprimido);
      if (metodo === 0) return Buffer.from(datos).toString('utf8');
      if (metodo === 8) return inflateRawSync(Buffer.from(datos)).toString('utf8');
      return null; // otro método de compresión: no vale la pena traerse una librería por eso
    }
    p += 46 + largoNombre + u16(b, p + 30) + u16(b, p + 32);
  }
  return null;
}

const sinEtiquetas = (xml: string, cortes: RegExp): string =>
  xml
    .replace(cortes, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

function deWord(b: Uint8Array): string | null {
  const xml = delZip(b, 'word/document.xml');
  // Cada párrafo y cada salto de línea del documento se convierten en un salto de verdad; si no, sale todo
  // pegado en un solo renglón y el modelo pierde la estructura, que muchas veces es la mitad del sentido.
  return xml === null ? null : sinEtiquetas(xml, /<\/w:p>|<w:br\s*\/>/g);
}

function deExcel(b: Uint8Array): string | null {
  const compartidas = delZip(b, 'xl/sharedStrings.xml');
  const hoja = delZip(b, 'xl/worksheets/sheet1.xml');
  if (compartidas === null && hoja === null) return null;
  // En un xlsx el texto vive en una tabla aparte y las celdas la referencian por número.
  const textos = compartidas ? [...compartidas.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => sinEtiquetas(m[1] ?? '', /<\/t>/g)) : [];
  if (!hoja) return textos.join('\n');
  // 🪤 Los atributos se sacan del trozo entero y no con un grupo opcional dentro del patrón de la celda: un
  // `(?:\st="(\w+)")?` seguido de `[^>]*` nunca llega a casar, porque lo de antes ya se comió el `t="s"`. El
  // resultado no era un error sino algo peor: una cuadrícula de números, con los textos vueltos su índice.
  const filas = [...hoja.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((fila) =>
    [...(fila[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)]
      .map((celda) => {
        const tipo = (celda[1] ?? '').match(/\bt="([^"]+)"/)?.[1] ?? '';
        const dentro = celda[2] ?? '';
        const valor = dentro.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '';
        if (tipo === 's') return textos[Number(valor)] ?? '';
        if (tipo === 'inlineStr' || tipo === 'str') return sinEtiquetas(dentro, /<\/t>/g);
        return valor;
      })
      .join('\t'),
  );
  return filas.join('\n').trim();
}

/**
 * Lee un archivo adjunto y devuelve su texto.
 *
 * Lanza si no se puede leer, con el motivo dicho para una persona: «no puedo leer PDF todavía» es una
 * respuesta útil; «error» no.
 */
export function leerAdjunto(nombre: string, datos: Uint8Array): Adjunto {
  if (!datos.length) throw new Error(`"${nombre}" llegó vacío`);
  if (datos.length > TOPE_ARCHIVO) throw new Error(`"${nombre}" pesa demasiado (máximo 2 MB)`);
  if (esPeligroso(datos)) throw new Error(`"${nombre}" es un programa, no un documento: no se abre`);

  let texto: string | null = null;
  if (empiezaPor(datos, [0x50, 0x4b, 0x03, 0x04])) {
    // Un ZIP: puede ser Word, Excel o un comprimido cualquiera. Se intenta por dentro.
    texto = deWord(datos) ?? deExcel(datos);
    if (texto === null) throw new Error(`"${nombre}" es un comprimido que no sé leer. Word y Excel sí; un .zip suelto no.`);
  } else if (empiezaPor(datos, [0x25, 0x50, 0x44, 0x46])) {
    // 🪤 Se reconoce y se dice que no. Sacarle a un PDF los trozos de texto que se ven sin descomprimir da un
    // resultado a medias —a veces media página, a veces basura— y eso es peor que no leerlo: el modelo
    // contestaría con seguridad sobre un documento que leyó mal.
    throw new Error(`"${nombre}" es un PDF y todavía no sé leerlos. Pégame el texto o mándalo en Word.`);
  } else if (empiezaPor(datos, [0xff, 0xd8, 0xff]) || empiezaPor(datos, [0x89, 0x50, 0x4e, 0x47])) {
    throw new Error(`"${nombre}" es una imagen y todavía no sé mirarlas. Cuéntame qué dice.`);
  } else {
    const crudo = Buffer.from(datos).toString('utf8');
    // Texto de verdad: si viene lleno de bytes que no son imprimibles, es un binario disfrazado.
    const raros = (crudo.match(/[\u0000-\u0008\u000e-\u001f]/g) ?? []).length;
    if (raros > crudo.length / 100) throw new Error(`"${nombre}" no parece un documento de texto`);
    texto = crudo;
  }

  const limpio = (texto ?? '').trim();
  if (!limpio) throw new Error(`"${nombre}" no tiene texto que leer`);
  return { nombre, texto: limpio.length > TOPE_TEXTO ? limpio.slice(0, TOPE_TEXTO) + '\n[…recortado]' : limpio };
}
