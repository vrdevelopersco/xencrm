// Pruebas de leer un archivo adjunto: pnpm test:adjuntos
//
// Lo que se prueba aquí no es «que lea Word»: es que NO lea lo que no debe y que diga por qué. Una puerta que
// acepta archivos es la más fácil de usar mal, y las dos formas de hacerlo mal son abrir lo que no se debe y
// devolver a medias algo que no se pudo leer entero.
import { readFileSync } from 'node:fs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { leerAdjunto } from '../crm/adjuntos.js';

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};

const dir = mkdtempSync(join(tmpdir(), 'aiva-adjuntos-'));
// Word y Excel de verdad (ZIP + XML), armados aquí para no depender de un archivo suelto en el repositorio.
const armar = (nombre: string, piezas: Record<string, string>) => {
  const guion = Object.entries(piezas)
    .map(([ruta, contenido]) => `z.writestr(${JSON.stringify(ruta)}, ${JSON.stringify(contenido)})`)
    .join('; ');
  execFileSync('python3', ['-c', `import zipfile\nwith zipfile.ZipFile(${JSON.stringify(join(dir, nombre))},'w',zipfile.ZIP_DEFLATED) as z: ${guion}`]);
  return new Uint8Array(readFileSync(join(dir, nombre)));
};

const docx = armar('a.docx', {
  '[Content_Types].xml': '<Types/>',
  'word/document.xml':
    '<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>Politica de alquiler</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>El deposito es de 200.000.</w:t></w:r></w:p></w:body></w:document>',
});
const leidoWord = leerAdjunto('a.docx', docx);
check('lee un Word', leidoWord.texto.includes('Politica de alquiler') && leidoWord.texto.includes('200.000'), leidoWord.texto);
// 🪤 Cada párrafo, un renglón: pegado todo en una línea el modelo pierde la estructura, que muchas veces es la
// mitad del sentido de un documento.
check('🪤 y respeta los párrafos', leidoWord.texto.split('\n').length >= 2, JSON.stringify(leidoWord.texto));

const xlsx = armar('a.xlsx', {
  '[Content_Types].xml': '<Types/>',
  'xl/sharedStrings.xml': '<sst><si><t>Producto</t></si><si><t>Esmoquin azul</t></si></sst>',
  'xl/worksheets/sheet1.xml':
    '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row>' +
    '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>350000</v></c></row></sheetData></worksheet>',
});
const leidoExcel = leerAdjunto('a.xlsx', xlsx);
// 🪤 En un xlsx el texto vive en una tabla aparte y las celdas la referencian por número: leer solo la hoja
// devuelve una cuadrícula de números sin una sola palabra.
check('🪤 lee un Excel resolviendo sus textos', leidoExcel.texto.includes('Esmoquin azul') && leidoExcel.texto.includes('350000'), leidoExcel.texto);

writeFileSync(join(dir, 'n.txt'), 'El proveedor sube precios el 15 de octubre.');
check('lee texto suelto', leerAdjunto('n.txt', new Uint8Array(readFileSync(join(dir, 'n.txt')))).texto.includes('15 de octubre'));

// 🪤 Por el CONTENIDO, no por el nombre. Un ejecutable renombrado a .docx sigue siendo un ejecutable, y fiarse
// de la extensión es fiarse de quien sube el archivo.
const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, ...new Array(60).fill(0)]);
let motivo = '';
try {
  leerAdjunto('inocente.docx', exe);
} catch (e) {
  motivo = (e as Error).message;
}
check('🪤 un ejecutable renombrado no se abre', motivo.includes('programa'), motivo || 'lo abrió');

// Lo que todavía no sabemos leer se dice claro, en vez de devolver media lectura.
const diceQueNo = (nombre: string, bytes: number[]) => {
  try {
    leerAdjunto(nombre, new Uint8Array([...bytes, ...new Array(40).fill(0x20)]));
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};
// 🪤 Sacarle a un PDF los trozos que se ven sin descomprimir da a veces media página y a veces basura, y el
// modelo contestaría con seguridad sobre un documento que leyó mal.
check('🪤 de un PDF dice que no sabe, en vez de leerlo a medias', diceQueNo('x.pdf', [0x25, 0x50, 0x44, 0x46]).includes('PDF'));
check('y de una imagen igual', diceQueNo('x.jpg', [0xff, 0xd8, 0xff]).includes('imagen'));

let grande = '';
try {
  leerAdjunto('gordo.txt', new Uint8Array(3 * 1024 * 1024));
} catch (e) {
  grande = (e as Error).message;
}
check('y lo que pesa de más, tampoco', grande.includes('demasiado'), grande);

console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
