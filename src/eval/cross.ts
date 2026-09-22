// Pruebas de la misma persona por dos canales (sin modelo): pnpm test:cross
// Empezó por el chat del sitio y en la tarde escribe por WhatsApp: el asistente llega sabiendo de qué hablaban
// (la conversación del otro canal entra en el historial) y se lo dice una sola vez. Las fichas no se unen solas.
// Base temporal.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'aiva-cross-')), 'aiva.db');
const { touchUser, appendMessage, getHistory, getMessages } = await import('../agent/memory.js');
const { getContact, updateContact, listEvents } = await import('../crm/contacts.js');
const { crossChannelGreeting, channelName } = await import('../crm/cross.js');
const { forgetSiblings } = await import('../crm/merge.js');
const { getDb } = await import('../rag/store.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};
const WEB = 'web:marta-sesion';
const WA = 'wa:573005551234@s.whatsapp.net';
const back = (id: string, ms: number) => getDb().prepare('UPDATE users SET last_message_at = ? WHERE id = ?').run(Date.now() - ms, id);

// Por la mañana, por el chat del sitio
touchUser(WEB, 'web', 'Marta');
appendMessage(WEB, 'user', 'busco un traje azul para la boda de mi hermano', 'consulta');
appendMessage(WEB, 'assistant', 'Claro, tenemos el traje azul noche en alquiler.', 'respuesta');
appendMessage(WEB, 'user', 'mi número es 3005551234', 'dato');
updateContact(WEB, { phone: '+573005551234' }, { silent: true });

// Por la tarde, por WhatsApp
touchUser(WA, 'whatsapp', 'Marta');
appendMessage(WA, 'user', '¿me confirmas lo del traje?', 'consulta');
forgetSiblings();

const hist = getHistory(WA);
check('la conversación del otro canal entra en el contexto', hist.some((m) => /traje azul para la boda/.test(m.content)), JSON.stringify(hist.map((m) => m.content.slice(0, 30))));
check('y queda en orden, con lo de ahora al final', /lo del traje/.test(hist.at(-1)!.content), hist.at(-1)?.content);
check('pero el chat que se ve en el tablero sigue siendo el de su canal', getMessages(WA).length === 1, String(getMessages(WA).length));

const saludo = crossChannelGreeting(WA)!;
check('se lo dice, nombrando el canal de antes', /Marta/.test(saludo) && /chat del sitio/.test(saludo), saludo);
check('se dice una sola vez', crossChannelGreeting(WA) === null);
check('queda en la línea de tiempo', listEvents(WA).some((e) => e.type === 'cross_channel'));
check('las fichas siguen separadas', Boolean(getContact(WEB)) && Boolean(getContact(WA)));

// Quien no tiene otra ficha no recibe nada
touchUser('web:solo', 'web', 'Solo');
appendMessage('web:solo', 'user', 'hola', 'saludo');
check('sin otra ficha no se dice nada', crossChannelGreeting('web:solo') === null);

// Una conversación vieja no es "la misma gestión"
touchUser('web:vieja', 'web', 'Vieja');
appendMessage('web:vieja', 'user', 'hola', 'saludo');
updateContact('web:vieja', { phone: '+573009990000' }, { silent: true });
touchUser('wa:573009990000@s.whatsapp.net', 'whatsapp', 'Vieja');
appendMessage('wa:573009990000@s.whatsapp.net', 'user', 'buenas', 'saludo');
back('web:vieja', 90 * 86400_000);
forgetSiblings();
check('lo de hace tres meses no cuenta como la misma gestión', crossChannelGreeting('wa:573009990000@s.whatsapp.net') === null);

// Dos sesiones del mismo canal (volvió al sitio otro día) no son un cruce de canales
touchUser('web:ana-1', 'web', 'Ana');
appendMessage('web:ana-1', 'user', 'hola', 'saludo');
updateContact('web:ana-1', { phone: '+573001110000' }, { silent: true });
touchUser('web:ana-2', 'web', 'Ana');
appendMessage('web:ana-2', 'user', 'hola de nuevo', 'saludo');
updateContact('web:ana-2', { phone: '+573001110000' }, { silent: true });
forgetSiblings();
check('otra sesión del mismo canal no se anuncia como cruce', crossChannelGreeting('web:ana-2') === null);
check('pero su conversación anterior sí entra en el contexto', getHistory('web:ana-2').some((m) => m.content === 'hola'));

check('los canales se nombran como habla la gente', channelName('whatsapp') === 'WhatsApp' && channelName('web') === 'el chat del sitio' && channelName('raro') === 'otro canal');

console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
