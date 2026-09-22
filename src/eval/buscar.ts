// Pruebas de buscar y de escribirle al cliente (sin modelo): pnpm test:buscar
// El buscador del tablero mira también dentro de la conversación, y la ficha arma el número con el que se le
// escribe por WhatsApp o se le llama, venga del teléfono que dejó o de su dirección de WhatsApp. Base temporal.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'aiva-buscar-')), 'aiva.db');
const { touchUser, appendMessage } = await import('../agent/memory.js');
const { getContact, listContacts, messageHit, contactNumber, updateContact } = await import('../crm/contacts.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};
const ids = (q: string) => listContacts({ q }).map((c) => c.id).sort();

touchUser('web:marta', 'web', 'Marta');
appendMessage('web:marta', 'user', 'quiero un esmoquin azul para la boda de mi hijo', 'consulta');
appendMessage('web:marta', 'assistant', 'Tenemos esmoquin desde $350.000.', 'respuesta');
updateContact('web:marta', { phone: '+573001234567', summary: 'Busca traje de boda' }, { silent: true });

touchUser('wa:573009998877@s.whatsapp.net', 'whatsapp', 'Pedro');
appendMessage('wa:573009998877@s.whatsapp.net', 'user', 'buenas, ¿abren el domingo?', 'consulta');

touchUser('web:luz', 'web', 'Luz');
appendMessage('web:luz', 'user', 'hola', 'saludo');
updateContact('web:luz', { phone: '3105554433' }, { silent: true }); // lo escribió sin indicativo

// --- buscar ---
check('encuentra por lo que se dijo en la conversación', ids('esmoquin').join() === 'web:marta', ids('esmoquin').join());
check('encuentra lo que respondió el asistente', ids('350.000').join() === 'web:marta', ids('350.000').join());
check('sigue encontrando por nombre', ids('Pedro').join() === 'wa:573009998877@s.whatsapp.net');
check('sigue encontrando por teléfono', ids('3001234567').join() === 'web:marta');
check('sigue encontrando por resumen', ids('boda de').join() === 'web:marta');
check('sin coincidencias no devuelve nada', ids('paraguas').length === 0);
check('no distingue mayúsculas', ids('ESMOQUIN').join() === 'web:marta');

const hit = messageHit('web:marta', 'esmoquin');
check('el fragmento es el mensaje más reciente que lo dice', hit?.role === 'assistant' && hit.content.includes('$350.000'), JSON.stringify(hit));
check('el fragmento dice quién lo dijo', messageHit('web:marta', 'boda')?.role === 'user');
check('sin coincidencia no hay fragmento', messageHit('web:marta', 'paraguas') === null);

// --- escribirle o llamarlo ---
check('el número sale del teléfono que dejó', contactNumber(getContact('web:marta')) === '573001234567');
check('un número local queda con indicativo', contactNumber(getContact('web:luz')) === '573105554433');
check('el número sale de la dirección de WhatsApp', contactNumber(getContact('wa:573009998877@s.whatsapp.net')) === '573009998877');
touchUser('web:anonimo', 'web', null);
check('sin teléfono no hay número', contactNumber(getContact('web:anonimo')) === null);

console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
