// Pruebas de los fijados en la base (sin modelo): pnpm test:fijados
//
// Lo delicado no es guardar una lista: es que un identificador de WhatsApp es un teléfono, y que al borrar, unir o
// anonimizar una ficha no quede guardado en los fijados de nadie.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'aiva-fijados-')), 'aiva.db');
process.env.ADMIN_TOKEN = 'token-del-tablero-de-prueba-0123456789';
const { touchUser, appendMessage } = await import('../agent/memory.js');
const { updateContact } = await import('../crm/contacts.js');
const { leerFijados, guardarFijados, reemplazarEnFijados, MAXIMO_FIJADOS } = await import('../crm/fijados.js');
const { anonimizar, borrarDelTodo } = await import('../crm/retencion.js');
const { getDb } = await import('../rag/store.js');
const { Hono } = await import('hono');
const { mountAdmin } = await import('../channels/admin.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};

const ficha = (id: string, nombre: string) => {
  touchUser(id, 'whatsapp', nombre);
  appendMessage(id, 'user', 'hola', 'consulta');
};
for (let i = 1; i <= 15; i++) ficha(`wa:57300000${String(i).padStart(4, '0')}@s.whatsapp.net`, `Persona ${i}`);
const id = (i: number) => `wa:57300000${String(i).padStart(4, '0')}@s.whatsapp.net`;
const ids = (l: { id: string }[]) => l.map((x) => x.id);

console.log('— Guardar y leer');
check('sin nombre no hay fijados', leerFijados('').length === 0);
check('sin nombre no se guarda', (() => { try { guardarFijados('  ', [id(1)]); return false; } catch { return true; } })());
guardarFijados('Laura', [id(2), id(1)]);
check('se leen en el orden en que se guardaron', ids(leerFijados('Laura')).join() === [id(2), id(1)].join());
check('🪤 «Laura» y « laura » son la misma persona', ids(leerFijados(' laura ')).join() === [id(2), id(1)].join());
check('los de otra persona son otros', leerFijados('Pedro').length === 0);
guardarFijados('Laura', [id(3), id(3), id(1)]);
check('una ficha no sale dos veces', ids(leerFijados('Laura')).join() === [id(3), id(1)].join());
guardarFijados('Laura', [id(4), 'wa:nadie@s.whatsapp.net']);
check('lo que no es una ficha no se guarda', ids(leerFijados('Laura')).join() === id(4));
guardarFijados('Laura', Array.from({ length: 15 }, (_, i) => id(i + 1)));
check(`hasta ${MAXIMO_FIJADOS}, no más`, leerFijados('Laura').length === MAXIMO_FIJADOS);
check('lo que no es una lista se rechaza', (() => { try { guardarFijados('Laura', 'todo'); return false; } catch { return true; } })());
updateContact(id(1), { name: 'Persona Uno Corregida' }, { silent: true });
check('el nombre sale como está hoy en la ficha', leerFijados('Laura').find((f) => f.id === id(1))?.name === 'Persona Uno Corregida');

console.log('— Cuando la ficha cambia de identificador o deja de existir');
guardarFijados('Laura', [id(5), id(6), id(7)]);
guardarFijados('Pedro', [id(6), id(8)]);
check('unir dos fichas cambia la vieja por la que quedó, en la lista de todos', reemplazarEnFijados(id(6), id(5)) === 2 &&
  ids(leerFijados('Laura')).join() === [id(5), id(7)].join() && ids(leerFijados('Pedro')).join() === [id(5), id(8)].join(),
  `${ids(leerFijados('Laura'))} · ${ids(leerFijados('Pedro'))}`);
const guardado = () => (getDb().prepare("SELECT group_concat(value, ' ') v FROM settings WHERE key LIKE 'fijados:%'").get() as { v: string }).v;
const nuevo = anonimizar(id(7));
check('🪤 anonimizar quita su teléfono de los fijados de todos', Boolean(nuevo) && !guardado().includes('573000000007') && !guardado().includes(nuevo!), guardado());
borrarDelTodo(id(8));
check('🪤 borrarla del todo también', !guardado().includes('573000000008'), guardado());

console.log('— Las rutas del tablero');
const app = new Hono();
mountAdmin(app as never);
const T = { 'x-admin-token': process.env.ADMIN_TOKEN!, 'content-type': 'application/json' };
const put = (cuerpo: unknown) => app.request('/admin/api/fijados', { method: 'PUT', headers: T, body: JSON.stringify(cuerpo) });
const r1 = await put({ yo: 'Ana', ids: [id(9), id(10)] });
const j1 = (await r1.json()) as { fijados: { id: string; name: string }[] };
check('guardar devuelve la lista con los nombres', r1.status === 200 && j1.fijados.length === 2 && j1.fijados[0]!.name === 'Persona 9', JSON.stringify(j1));
const j2 = (await (await app.request('/admin/api/fijados?yo=Ana', { headers: T })).json()) as { fijados: { id: string }[] };
check('leer devuelve lo guardado, desde cualquier navegador', ids(j2.fijados).join() === [id(9), id(10)].join());
check('sin nombre, guardar contesta que falta', (await put({ ids: [id(9)] })).status === 400);
check('sin el token del tablero no se lee ni se guarda',
  (await app.request('/admin/api/fijados?yo=Ana')).status === 401 && (await app.request('/admin/api/fijados', { method: 'PUT', body: '{}' })).status === 401);
const borrada = await app.request(`/admin/api/contacts/${encodeURIComponent(id(10))}`, { method: 'DELETE', headers: T });
check('🪤 borrarla desde el tablero la quita de los fijados', borrada.status === 200 && !guardado().includes('573000000010'), guardado());

console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
