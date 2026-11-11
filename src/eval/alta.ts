// Pruebas del alta a mano (sin modelo): pnpm test:alta
// La «C» del CRUD de clientes. Lo que se prueba aquí no es que se cree la ficha —eso se ve— sino que no nazca
// duplicada: la ficha de la libreta y la del WhatsApp tienen que ser la MISMA, o el CRM parte en dos la historia
// de la persona justo cuando alguien intenta ordenarla. Base temporal.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'xencrm-alta-')), 'xencrm.db');
const { touchUser, appendMessage } = await import('../agent/memory.js');
const { darDeAlta, direccionDe } = await import('../crm/alta.js');
const { getContact, listContacts, primeraEtapa, STAGE_DEFS } = await import('../crm/contacts.js');

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
    check(name, (err as Error).message.includes(trozo), (err as Error).message);
  }
};

// ── Lo mínimo ─────────────────────────────────────────────────────────────────
falla('sin nombre ni teléfono no hay ficha que valga', () => darDeAlta({}), 'nombre o el teléfono');
falla('y una etapa inventada no entra', () => darDeAlta({ name: 'X', stage: 'etapa-que-no-existe' as never }), 'etapa inválida');

// ── La dirección: lo que evita el duplicado ───────────────────────────────────
// 🪤 Esta es la prueba que justifica el módulo. Con número, la ficha tiene que nacer con la dirección EXACTA que
// usará el canal de WhatsApp cuando esa persona escriba (`wa:57…@s.whatsapp.net`). Si cambiara el formato, el
// mensaje entraría en una ficha nueva y la de la libreta se quedaría vacía para siempre.
const { contact: jony, yaExistia: eraNueva } = darDeAlta({ name: 'Jony Ive', phone: '300 555 7788', notes: 'Llegó por el local' });
check('🪤 nace con la dirección que tendrá su WhatsApp', jony.id === 'wa:573005557788@s.whatsapp.net', jony.id);
check('no existía antes', !eraNueva);
check('con su nombre, su número normalizado y su nota', jony.name === 'Jony Ive' && jony.phone === '573005557788' && jony.notes === 'Llegó por el local', JSON.stringify({ n: jony.name, p: jony.phone, no: jony.notes }));
check('entra por la primera etapa si no se dice otra', jony.stage === primeraEtapa(), jony.stage);
check('y queda contada entre los contactos', listContacts({ limit: 50 }).some((c) => c.id === jony.id));

// El mismo número escrito de otra forma es la misma persona.
const otra = darDeAlta({ name: 'Jony I.', phone: '+57 300 555 7788' });
check('🪤 el mismo número con indicativo NO crea otra ficha', otra.yaExistia && otra.contact.id === jony.id, otra.contact.id);
check('y no le pisa el nombre que ya tenía', otra.contact.name === 'Jony Ive', String(otra.contact.name));
check('sigue habiendo una sola', listContacts({ limit: 50 }).filter((c) => c.phone === '573005557788').length === 1);

// Y al revés: quien ya escribió por WhatsApp y luego alguien intenta apuntarlo a mano.
const yaEscribio = 'wa:573001112233@s.whatsapp.net';
touchUser(yaEscribio, 'whatsapp', 'Sebastián');
appendMessage(yaEscribio, 'user', 'Buenas, ¿alquilan esmoquin?');
const repe = darDeAlta({ name: 'Sebastian M', phone: '3001112233' });
check('🪤 a quien ya escribió no se le hace una ficha nueva', repe.yaExistia && repe.contact.id === yaEscribio, repe.contact.id);
check('y conserva su conversación', repe.contact.messageCount === 1, String(repe.contact.messageCount));

// ── Sin número ────────────────────────────────────────────────────────────────
const sinTel = darDeAlta({ name: 'Señora del local' });
check('se puede dar de alta solo con el nombre', !sinTel.yaExistia && sinTel.contact.name === 'Señora del local');
check('y se nota de dónde salió esa ficha', sinTel.contact.id.startsWith('mano:') && sinTel.contact.channel === 'manual', `${sinTel.contact.id} · ${sinTel.contact.channel}`);
check('dos sin número son dos personas distintas', darDeAlta({ name: 'Otro señor' }).contact.id !== sinTel.contact.id);
check('la dirección sin número no se parece a una de WhatsApp', !direccionDe(null).includes('@s.whatsapp.net'), direccionDe(null));

// ── La etapa que se pida ──────────────────────────────────────────────────────
const conEtapa = STAGE_DEFS[STAGE_DEFS.length - 1]!.id;
check('se puede dar de alta directo en otra etapa', darDeAlta({ name: 'Camilo', phone: '3012223344', stage: conEtapa }).contact.stage === conEtapa);

// ── Un número que no es un número ─────────────────────────────────────────────
// Tres dígitos no son un teléfono: la ficha se crea igual pero sin número, no con uno roto que luego no sirva
// ni para escribirle ni para reconocerlo cuando llegue de verdad.
const corto = darDeAlta({ name: 'Marta', phone: '123' });
check('un número demasiado corto no se guarda como teléfono', corto.contact.phone === null && corto.contact.id.startsWith('mano:'), `${corto.contact.phone} · ${corto.contact.id}`);

check('la ficha se puede volver a leer por su dirección', getContact(jony.id)?.name === 'Jony Ive');

console.log(fail ? `\n${fail} fallo(s)` : '\ntodo ok');
process.exit(fail ? 1 : 0);
