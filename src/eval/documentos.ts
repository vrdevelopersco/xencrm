// Cargarle conocimiento a un negocio desde el tablero. pnpm test:documentos
//
// Dos cosas se prueban aquí y las dos son de las que no dan error, solo dan un resultado equivocado más tarde:
// que un nombre de archivo venido de un navegador no pueda escribir fuera de la carpeta de SU negocio, y que lo
// que se carga quede en un archivo de verdad y no solo en la base —porque el reindexado reconstruye desde el
// directorio y se llevaría por delante lo que solo estuviera en la base, días después y sin aviso.
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'aiva-docs-'));
const conocimiento = join(dir, 'conocimiento');
const catalogo = join(dir, 'catalogo');
// Una configuración mínima que apunte a esta carpeta de usar y tirar.
const base = JSON.parse(readFileSync(new URL('../../aiva.config.example.json', import.meta.url), 'utf8')) as Record<string, unknown>;
base.sources = { ...(base.sources as object), productsFile: join(catalogo, 'productos.json'), knowledgeDir: conocimiento };
writeFileSync(join(dir, 'aiva.config.json'), JSON.stringify(base));
process.env.AIVA_CONFIG = join(dir, 'aiva.config.json');
process.env.DB_PATH = join(dir, 'prueba.db');

const { nombreSeguro, guardarDocumento, borrarDocumento, documentosDelNegocio } = await import('../rag/documentos.js');
const { chunkText } = await import('../rag/ingest.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};
const falla = async (fn: () => Promise<unknown>): Promise<string> => {
  try {
    await fn();
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};

// ── El nombre, que viene de un navegador ──
// 🪤 Lo peor que puede hacer esto es escribir fuera de la carpeta de su negocio. En un servidor multicliente,
// `../../otro/conocimiento/precios.md` no es un archivo mal nombrado: es un negocio escribiéndole al KB de otro.
// Lo que importa no es en qué se convierte, sino que NUNCA salga de la carpeta: o queda en un nombre pelado o
// se rechaza. `.env` cae en lo segundo —la extensión se come el nombre entero y no queda nada— y está bien así.
const seguro = (n: string) => { const r = nombreSeguro(n); return r === '' || (!r.includes('/') && !r.includes('\\') && !r.includes('..')); };
check('🪤 una ruta hacia arriba no sobrevive', seguro('../../.env') && nombreSeguro('../../.env') !== '../../.env', nombreSeguro('../../.env'));
check('🪤 y no puede apuntar a otro cliente', !nombreSeguro('../../otro/conocimiento/precios.md').includes('/'), nombreSeguro('../../otro/conocimiento/precios.md'));
check('una barra invertida tampoco', !nombreSeguro('..\\..\\otro\\x.md').includes('\\'));
check('los acentos y los espacios se acomodan', nombreSeguro('Políticas de pago.docx') === 'politicas-de-pago.md', nombreSeguro('Políticas de pago.docx'));
// 🪤 La extensión entera, no solo las que conocemos: subir «precios.docx» dejaba un «precios-docx.md».
check('🪤 la extensión no se queda dentro del nombre', nombreSeguro('precios.docx') === 'precios.md', nombreSeguro('precios.docx'));
check('un nombre que se queda en nada se rechaza', nombreSeguro('///...') === '');

// ── Guardar ──
const uno = await guardarDocumento('politicas.docx', 'Políticas de pago\n\nAceptamos efectivo, transferencia y tarjeta.\nNo hacemos devoluciones de dinero.');
// 🪤 Esto es lo que impide que el trabajo de alguien se evapore: el reindexado reconstruye el conocimiento
// LEYENDO EL DIRECTORIO, así que lo que estuviera solo en la base desaparecería la próxima vez que alguien le
// dé a reindexar — otro día, desde otro botón, sin que nadie ate los cabos.
check('🪤 queda un archivo de verdad en la carpeta', existsSync(join(conocimiento, 'politicas.md')), readdirSync(conocimiento).join(', '));
check('y queda indexado', uno.fragmentos > 0, JSON.stringify(uno));
// 🪤 El título sale de la primera línea del documento, no del nombre del archivo: casi todo Word que sube un
// negocio empieza por su propio título, y «politicas» es peor que «Políticas de pago» para buscar y para el modelo.
check('🪤 el título sale del documento, no del archivo', uno.titulo === 'Políticas de pago', uno.titulo);
const escrito = readFileSync(join(conocimiento, 'politicas.md'), 'utf8');
check('la primera línea se asciende, no se repite', escrito.indexOf('Políticas de pago') === escrito.lastIndexOf('Políticas de pago'), escrito);

const escrito2 = await guardarDocumento('', 'Abrimos de 8 a 6, de lunes a viernes.', 'Horarios');
check('escrito a mano, el título manda', escrito2.titulo === 'Horarios' && escrito2.archivo === 'horarios.md', JSON.stringify(escrito2));

check('se ven los dos en la lista', documentosDelNegocio().length === 2);
check('vacío no se guarda', (await falla(() => guardarDocumento('x.md', '   '))).includes('vacío'));
check('sin nombre tampoco', (await falla(() => guardarDocumento('...', 'algo que decir'))).includes('nombre'));

// Subir el mismo nombre otra vez REEMPLAZA, no duplica: es como se corrige un documento.
await guardarDocumento('politicas.docx', 'Políticas de pago\n\nAhora sí hacemos devoluciones dentro de 8 días.');
check('subir el mismo nombre reemplaza, no duplica', documentosDelNegocio().length === 2);
check('y el contenido es el nuevo', readFileSync(join(conocimiento, 'politicas.md'), 'utf8').includes('8 días'));

// ── Borrar ──
await borrarDocumento('politicas.md');
// 🪤 Borrar el archivo, no solo sus filas. Si quedara el archivo, el documento volvería entero en el siguiente
// reindexado, y entonces nadie vuelve a confiar en el botón de borrar.
check('🪤 borrar se lleva el archivo', !existsSync(join(conocimiento, 'politicas.md')));
check('y ya no está en la lista', documentosDelNegocio().length === 1);
check('borrar algo que no está, lo dice', (await borrarDocumento('no-existe.md')) === false);
check('🪤 y no se puede borrar fuera de la carpeta', (await falla(() => borrarDocumento('../../aiva.config.json'))).includes('no es de este negocio'));
check('la configuración sigue ahí', existsSync(join(dir, 'aiva.config.json')));

// ── El troceado ──
// 🪤 El título del archivo sale de su `# H1`, así que en un documento de un solo encabezado los dos son iguales
// y el fragmento acababa titulado «Políticas › Políticas». Gasta en repetirse la mitad del título, que es con lo
// que el modelo decide si el fragmento le sirve.
const trozos = chunkText('# Políticas\n\nAceptamos efectivo.', { title: 'Políticas' });
check('🪤 el título no se repite a sí mismo', trozos[0]?.title === 'Políticas', JSON.stringify(trozos.map((t) => t.title)));
const dos = chunkText('# Políticas\n\n## Pagos\n\nEfectivo y tarjeta.', { title: 'Políticas' });
check('pero un encabezado que sí dice algo, se añade', dos.some((t) => t.title === 'Políticas › Pagos'), JSON.stringify(dos.map((t) => t.title)));

rmSync(dir, { recursive: true, force: true });
console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
