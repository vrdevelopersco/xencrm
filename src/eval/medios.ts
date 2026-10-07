// Pruebas de los archivos del chat (sin modelo): pnpm test:medios
//
// Esto guarda en disco cosas que manda gente de fuera y después las sirve de vuelta a quien atiende. Las dos
// mitades son peligrosas por su cuenta: por una se sale de la carpeta, por la otra se ejecuta código en el
// dominio del tablero. Cada agujero tiene su prueba, y ninguno da error cuando se abre.
import { mkdtempSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const base = mkdtempSync(join(tmpdir(), 'aiva-medios-'));
process.env.DB_PATH = join(base, 'data', 'aiva.db');
const { guardar, rutaDe, borrar, tipoDe, seAcepta, carpeta, cuantoOcupa, huella, MedioRechazado, MAXIMO_BYTES, MIMES_ACEPTADOS } =
  await import('../crm/medios.js');
const { touchUser, appendMessage, getMessages } = await import('../agent/memory.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};
const falla = (name: string, fn: () => unknown, trozo: string) => {
  try {
    fn();
    check(name, false, 'no se quejó');
  } catch (err) {
    check(name, err instanceof MedioRechazado && (err as Error).message.includes(trozo), (err as Error).message);
  }
};
const bytes = (n: number) => new Uint8Array(n).fill(65);

// ---------- Dónde viven ----------
// 🪤 Hermana de la base del cliente, no dentro. Cada cliente corre con su propia carpeta, así que el
// aislamiento entre inquilinos es el mismo que ya separa sus conversaciones: no hay nada que programar, pero sí
// que comprobar, porque mover esto a un sitio común sería abrir un agujero entre clientes sin darse cuenta.
check('🪤 los archivos viven en la carpeta del cliente', carpeta() === join(base, 'medios'), carpeta());
check('y la carpeta se crea sola', existsSync(carpeta()));

// ---------- Qué se acepta ----------
check('reconoce los tipos por lo que son', tipoDe('image/jpeg') === 'imagen' && tipoDe('application/pdf') === 'documento' && tipoDe('audio/ogg') === 'audio' && tipoDe('video/mp4') === 'video');
check('un tipo con parámetros también', tipoDe('image/png; charset=binary') === 'imagen');
// 🪤 SVG y HTML son programas, no imágenes ni documentos. Servidos desde el dominio del tablero harían lo que
// quisieran con la sesión de quien los abra.
check('🪤 no se acepta SVG ni HTML, que son programas', !seAcepta('image/svg+xml') && !seAcepta('text/html'), 'uno de los dos pasó');
check('ni nada ejecutable', !seAcepta('application/x-sh') && !seAcepta('application/javascript'));
falla('un tipo desconocido se rechaza diciendo cuál', () => guardar(bytes(10), { mime: 'application/x-cosa' }), 'application/x-cosa');
falla('un archivo vacío no se guarda', () => guardar(new Uint8Array(0), { mime: 'image/png' }), 'vacío');
falla('y uno demasiado grande tampoco', () => guardar(bytes(MAXIMO_BYTES + 1), { mime: 'image/png' }), 'tope');
check('el tope cabe en lo que admite WhatsApp', MAXIMO_BYTES <= 16 * 1024 * 1024 && MAXIMO_BYTES >= 4 * 1024 * 1024, String(MAXIMO_BYTES));
check('el selector de archivos sabe qué ofrecer', MIMES_ACEPTADOS.includes('application/pdf') && MIMES_ACEPTADOS.length > 8);

// ---------- Guardar ----------
const foto = guardar(bytes(2048), { mime: 'image/jpeg', nombre: 'mi traje.JPG' });
check('guarda y devuelve con qué apuntarlo', foto.tipo === 'imagen' && foto.bytes === 2048 && /^[0-9a-f]{32}\.jpg$/.test(foto.id), JSON.stringify(foto));
check('el archivo está en disco', Boolean(rutaDe(foto.id)) && readFileSync(rutaDe(foto.id)!).length === 2048);
check('y solo lo puede leer su dueño', (statSync(rutaDe(foto.id)!).mode & 0o077) === 0, (statSync(rutaDe(foto.id)!).mode & 0o777).toString(8));
check('no repite la extensión si ya la traía, y respeta cómo lo llamó él', foto.nombre === 'mi traje.JPG', foto.nombre);

// 🪤 La extensión sale de NUESTRA tabla, nunca del nombre de quien manda. Es lo que impide que un
// «catalogo.pdf.html» quede en disco como .html y se sirva como página.
const trampa = guardar(bytes(10), { mime: 'application/pdf', nombre: 'catalogo.pdf.html' });
check('🪤 el nombre de fuera no decide la extensión en disco', trampa.id.endsWith('.pdf'), trampa.id);
check('y el nombre para enseñar queda limpio', trampa.nombre === 'catalogo.pdf.html.pdf', trampa.nombre);

// 🪤 Dos clientes que suban "foto.jpg" no se pueden pisar el archivo.
const a = guardar(bytes(5), { mime: 'image/png', nombre: 'foto.png' });
const b = guardar(bytes(7), { mime: 'image/png', nombre: 'foto.png' });
check('🪤 dos archivos con el mismo nombre no se pisan', a.id !== b.id && readFileSync(rutaDe(a.id)!).length === 5 && readFileSync(rutaDe(b.id)!).length === 7);

// Un nombre con rutas dentro no puede acabar en una ruta.
const conRuta = guardar(bytes(5), { mime: 'image/png', nombre: '../../../etc/passwd' });
check('un nombre con rutas se queda sin ellas', conRuta.nombre === 'etc passwd.png', conRuta.nombre);
const sinNombre = guardar(bytes(5), { mime: 'application/pdf', nombre: '' });
check('sin nombre se le pone uno', sinNombre.nombre === 'archivo.pdf', sinNombre.nombre);

// ---------- Pedirlo de vuelta: la puerta al sistema de archivos ----------
// 🪤 El identificador viaja en la dirección y se convierte en una ruta de disco. Sin anclar la comprobación,
// «dame el archivo X» se convierte en «léeme cualquier archivo del servidor».
writeFileSync(join(base, 'secreto.txt'), 'la clave');
const ataques = [
  '../secreto.txt',
  '../../etc/passwd',
  '..%2Fsecreto.txt',
  '/etc/passwd',
  'a'.repeat(32) + '.jpg/../../secreto.txt',
  './' + 'a'.repeat(32) + '.jpg',
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.jpg', // mayúsculas: no son de los nuestros
  '',
];
check('🪤 no se puede salir de la carpeta pidiendo un archivo', ataques.every((x) => rutaDe(x) === null),
  ataques.filter((x) => rutaDe(x) !== null).join(' | '));
check('y un identificador con la forma buena pero inexistente da nada', rutaDe('f'.repeat(32) + '.jpg') === null);
check('el que sí existe se encuentra', rutaDe(foto.id) !== null);

// ---------- Borrar y contar ----------
const antes = cuantoOcupa();
check('cuenta lo que hay', antes.archivos >= 6 && antes.bytes > 2048, JSON.stringify(antes));
check('borra el que se le pida', borrar(a.id) && rutaDe(a.id) === null);
check('y no se deja engañar para borrar fuera', !borrar('../secreto.txt') && existsSync(join(base, 'secreto.txt')));
check('borrar dos veces no se queja', !borrar(a.id));
check('la cuenta baja', cuantoOcupa().archivos === antes.archivos - 1);

// La huella sirve para no guardar dos veces el mismo portafolio.
check('el mismo contenido da la misma huella', huella(bytes(100)) === huella(bytes(100)) && huella(bytes(100)) !== huella(bytes(101)));

// ---------- En la conversación ----------
const quien = 'wa:573001112233@s.whatsapp.net';
touchUser(quien, 'whatsapp', 'Cliente');
appendMessage(quien, 'user', '[imagen] mi traje.jpg', undefined, 'customer', undefined, foto);
appendMessage(quien, 'user', 'mira este que me gustó', undefined, 'customer');
const msgs = getMessages(quien, 10);
check('el archivo queda apuntado en su mensaje', msgs[0]?.media?.id === foto.id, JSON.stringify(msgs[0]?.media));
check('y un mensaje sin archivo no inventa ninguno', msgs[1]?.media === null);
check('se puede volver al archivo desde la conversación', Boolean(rutaDe(msgs[0]!.media!.id)));

// 🪤 Un `media` ilegible no puede tumbar la conversación entera: se enseña el mensaje sin su archivo.
const { getDb } = await import('../rag/store.js');
getDb().prepare("UPDATE messages SET media = '{roto' WHERE id = ?").run(msgs[0]!.id);
const tras = getMessages(quien, 10);
check('🪤 un adjunto ilegible no deja la conversación en blanco', tras.length === 2 && tras[0]?.media === null, JSON.stringify(tras.map((m) => m.media)));

// ---------- 🪤 Un canal que no sabe llevar archivos tiene que DECIRLO ----------
// Lo peor que puede pasar con esto no es que falle: es que el tablero diga «enviado» y el cliente no tenga
// nada. Quien atiende se enteraría cuando el cliente pregunte por algo que cree que ya le mandaron.
const { registerSender, llevaArchivos, sendToContact } = await import('../crm/outbox.js');
const { updateContact } = await import('../crm/contacts.js');
registerSender('solo-texto', async () => undefined);
registerSender('con-archivos', async () => undefined, { medios: true });
check('🪤 por omisión, un canal NO lleva archivos', !llevaArchivos('solo-texto'));
check('y el que sí sabe lo declara', llevaArchivos('con-archivos'));
check('uno que no existe tampoco', !llevaArchivos('inventado'));

touchUser('texto:1', 'solo-texto', 'Quien sea');
updateContact('texto:1', { phone: '+573001112233' }, { silent: true });
const otra = guardar(bytes(10), { mime: 'image/png', nombre: 'x.png' });
const antesDeIntentar = getMessages('texto:1', 10).length;
let seQuejo = '';
try {
  await sendToContact('texto:1', 'te mando esto', 'human', { by: 'Luis', medio: otra });
} catch (err) {
  seQuejo = (err as Error).message;
}
check('🪤 mandar un archivo por un canal que no sabe se rechaza, y dice por qué', /no puedo mandarle archivos/i.test(seQuejo), seQuejo || 'no se quejó');
// 🪤 Y no deja rastro: si el mensaje quedara guardado, en la conversación habría un archivo que el cliente no
// tiene, y nadie podría distinguirlo de uno que sí llegó.
check('🪤 y no deja el mensaje guardado a medias', getMessages('texto:1', 10).length === antesDeIntentar, 'quedó un mensaje con un archivo que nunca salió');
check('el texto solo sí pasa por ese canal', await sendToContact('texto:1', 'esto sí', 'human', { by: 'Luis' }).then(() => true).catch(() => false));

console.log(fail ? `\n${fail} fallo(s)` : '\ntodo ok');
process.exit(fail ? 1 : 0);
