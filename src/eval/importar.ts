// Pruebas de traer un chat exportado como conversación (sin modelo): pnpm test:importar
// Dos cosas se prueban de verdad, y las dos son 🪤:
//   1. Que NINGUNA credencial del chat quede guardada. Un grupo de soporte está lleno de «Usuario: … Clave: …».
//   2. Que lo importado se pueda quitar sin tocar una conversación real.
// De paso, que la fecha no se vaya al futuro: WhatsApp exporta unos archivos en día/mes y otros en mes/día.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'xencrm-importar-'));
process.env.DB_PATH = join(dir, 'xencrm.db');

const { importarChat, taparSecretos, quitar, cuantas, PREFIJO } = await import('../crm/importar.js');
const { ordenDeFechas } = await import('../crm/historial.js');
const { getDb } = await import('../rag/store.js');
const { touchUser, getMessages } = await import('../agent/memory.js');
const { listContacts } = await import('../crm/contacts.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};

// --- 🪤 tapar credenciales ---
const conClaves = [
  '👤 Usuario: DEMOVENTAS@SISTEMAEJEMPLO.COM',
  '🔒 Clave: claveejemplo',
  'Clave temporal (el sistema te pedira cambiar):',
  'pX7wqLmeT-b5n2c8',
  'la api_key es sk-proj-ABCDEF1234567890xyz',
  'token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27u',
  'entra por https://panel.ejemplo.co/acceso?token=SUPERSECRETO123',
].join('\n');
const tapado = taparSecretos(conClaves);
for (const secreto of ['DEMOVENTAS@SISTEMAEJEMPLO.COM', 'claveejemplo', 'pX7wqLmeT-b5n2c8', 'sk-proj-ABCDEF', 'eyJhbGciOiJIUzI1NiJ9', 'SUPERSECRETO123']) {
  check(`tapa «${secreto.slice(0, 22)}»`, !tapado.texto.includes(secreto), tapado.texto);
}
check('y cuenta cuántas tapó', tapado.tapados >= 6, String(tapado.tapados));
check('el valor que venía en el renglón de abajo también', /cambiar\):\s*\n?«omitido»/.test(tapado.texto), tapado.texto);

// 🪤 Pero tapar de más borra justo lo que se quiere aprender: cómo atienden.
const charla = taparSecretos('por favor recuérdanos la clave de administrador\n¿a cada RRHH le entrego su usuario con esa contraseña?');
check('no toca una frase donde solo se habla de la clave', charla.tapados === 0 && charla.texto.includes('administrador') && charla.texto.includes('contraseña?'), charla.texto);
const conDosPuntos = taparSecretos('el usuario dice: no me llega el correo');
check('una etiqueta en mitad de la frase no dispara el tapado', conDosPuntos.tapados === 0, conDosPuntos.texto);

// --- 🪤 la fecha: el mismo 7/9 es 7 de septiembre o 9 de julio según el teléfono que exportó ---
const diaPrimero = '[18/08/26, 2:34:42 p. m.] Soporte: listo\n[7/09/26, 10:42:27 a. m.] Marta: gracias';
const mesPrimero = '[6/25/26, 1:27:52 p. m.] Soporte: listo\n[7/2/26, 10:42:27 a. m.] Marta: gracias';
check('reconoce el archivo en día/mes', ordenDeFechas(diaPrimero) === 'dm');
check('y el archivo en mes/día', ordenDeFechas(mesPrimero) === 'md');
check('sin pistas, día primero (como se escribe acá)', ordenDeFechas('[7/2/26, 10:42:27 a. m.] Marta: hola') === 'dm');

// --- traer un chat ---
const chat = [
  '[11/08/26, 6:24:41 p. m.] ~ HRC Tech: Usuario: admin@nomina-ejemplo.co',
  'Pass: Clave-ejemplo-2026',
  '[11/08/26, 6:25:10 p. m.] ~ Mario Gómez: perfecto, gracias',
  '[18/08/26, 2:34:42 p. m.] ~ HRC Tech: <Multimedia omitido>',
  '[25/08/26, 9:00:00 a. m.] ~ Mario Gómez: ¿me ayudan con un reporte?',
  '[25/08/26, 9:05:00 a. m.] ~ HRC Tech: claro que sí, ya lo reviso',
].join('\n');

// Una conversación DE VERDAD, que es la que no se puede tocar.
touchUser('web:cliente-de-verdad', 'web', 'Cliente real');
getDb().prepare("INSERT INTO messages (user_id, role, content, ts) VALUES (?, 'user', 'una pregunta real', ?)").run('web:cliente-de-verdad', Date.now());
const realesAntes = listContacts({ limit: 100 }).length;

check('al principio no hay ninguna importada', cuantas() === 0);
const r = importarChat(chat, { nombre: 'HRC Gráficas', delNegocio: ['~ HRC Tech'] });
check('crea la ficha con el prefijo que la delata', r.id === `${PREFIJO}hrc-graficas` && cuantas() === 1, r.id);
check('trae los mensajes y deja fuera los de sistema', r.mensajes === 4, String(r.mensajes));
check('sabe cuáles escribió el negocio', r.delNegocio === 2, String(r.delNegocio));
check('la ficha queda con el nombre del chat y la fecha del último mensaje', (() => {
  const f = listContacts({ limit: 100 }).find((c) => c.id === r.id);
  return Boolean(f) && f!.name === 'HRC Gráficas' && f!.lastMessageAt === r.hasta;
})());
check('las fechas son de este año, no del futuro', new Date(r.hasta!).getFullYear() === 2026 && r.hasta! <= Date.now(), new Date(r.hasta!).toISOString());

// Un grupo de soporte de hace meses no es una conversación «nueva»: eso llenaría el tablero de trabajo que no
// existe. La columna se elige por rol, nunca por el nombre de la etapa.
const { business } = await import('../config.js');
const rolDe = (id: string) => business.crm.stages.find((e) => e.id === id)?.rol;
const viejito = importarChat(chat, { nombre: 'Chat dormido', delNegocio: ['~ HRC Tech'], ahora: new Date('2026-11-30').getTime() });
const fresco = importarChat(chat, { nombre: 'Chat vivo', delNegocio: ['~ HRC Tech'], ahora: new Date('2026-08-26').getTime() });
const etapaDe = (id: string) => listContacts({ limit: 100 }).find((c) => c.id === id)!.stage;
check('un chat que se apagó hace meses entra cerrado, no como nuevo', rolDe(etapaDe(viejito.id)) === 'ganado', etapaDe(viejito.id));
check('y uno que sigue vivo, como activo', rolDe(etapaDe(fresco.id)) === 'activo', etapaDe(fresco.id));
check('pero si le dicen la etapa, manda esa', (() => {
  const puesto = importarChat(chat, { nombre: 'Chat dicho', delNegocio: [], etapa: business.crm.stages[0]!.id });
  return etapaDe(puesto.id) === business.crm.stages[0]!.id;
})());
quitar();
importarChat(chat, { nombre: 'HRC Gráficas', delNegocio: ['~ HRC Tech'] });

const msgs = getMessages(r.id, 50);
const delNegocio = msgs.filter((m) => m.role === 'assistant');
check('🪤 lo que escribió el equipo NO queda como si lo hubiera dicho el asistente', delNegocio.every((m) => (m as { author?: string }).author === 'human'), JSON.stringify(delNegocio[0]));
check('y queda con el nombre de quien contestó', delNegocio.every((m) => (m as { by?: string }).by === '~ HRC Tech'), JSON.stringify(delNegocio[0]));
check('🪤 ninguna credencial quedó guardada', !JSON.stringify(msgs).includes('Clave-ejemplo-2026') && !JSON.stringify(msgs).includes('admin@nomina-ejemplo.co'), JSON.stringify(msgs[0]));

// Importar dos veces no deja la conversación repetida.
importarChat(chat, { nombre: 'HRC Gráficas', delNegocio: ['~ HRC Tech'] });
check('importar dos veces no duplica', cuantas() === 1 && getMessages(r.id, 50).length === 4, `${cuantas()} fichas, ${getMessages(r.id, 50).length} mensajes`);

check('un archivo que no es un chat se rechaza', (() => {
  try {
    importarChat('esto no es un chat de WhatsApp', { nombre: 'nada', delNegocio: [] });
    return false;
  } catch {
    return true;
  }
})());

// --- 🪤 quitar ---
const quitadas = quitar();
check('quitar se lleva todas las importadas', quitadas === 1 && cuantas() === 0, `quitadas ${quitadas}`);
check('y no toca la conversación real', listContacts({ limit: 100 }).length === realesAntes && Boolean(listContacts({ limit: 100 }).find((c) => c.id === 'web:cliente-de-verdad')));
check('tampoco sus mensajes', (getDb().prepare("SELECT COUNT(*) n FROM messages WHERE user_id = 'web:cliente-de-verdad'").get() as { n: number }).n === 1);
check('ni deja mensajes sueltos de la importada', (getDb().prepare('SELECT COUNT(*) n FROM messages WHERE user_id LIKE ?').get(`${PREFIJO}%`) as { n: number }).n === 0);
check('quitar cuando no hay nada no revienta', quitar() === 0);

console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
