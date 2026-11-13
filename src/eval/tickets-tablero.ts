// Pruebas del tablero de tickets (kanban), sin modelo ni red: pnpm test:tickets-tablero
//
// El tablero es la misma lista de tickets repartida en columnas: si una tarjeta cae en la columna equivocada, o
// desaparece porque su estado se quitó de la configuración, el equipo deja de verla. Se prueba:
//  · una columna por estado, en el orden de la configuración, también las vacías (es donde se suelta una tarjeta);
//  · cada ticket en la suya, por urgencia del SLA, con el total aunque el tope corte;
//  · que las columnas que cierran solo traigan los últimos días, y que un abierto viejo sí esté;
//  · los filtros (prioridad, plan, «sin plan», asignado sin importar mayúsculas, «sin asignar») y los que no existen;
//  · un estado propio del negocio, y la columna «Sin estado» cuando se quita uno que tenía tickets;
//  · la ruta: que /tickets/:id no la tape, que mover sea el PATCH de siempre, el permiso y el candado;
//  · lo mínimo de la vista en el tablero.
//
// 🪤 Todo en una carpeta temporal, con un archivo de cliente de mentira y horas fijas en Bogotá: no depende de la
// hora a la que se corra ni de la configuración de nadie.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'xencrm-tablero-tickets-'));
const base = JSON.parse(readFileSync(new URL('../../xencrm.config.example.json', import.meta.url), 'utf8')) as Record<string, unknown>;
writeFileSync(join(dir, 'xencrm.config.json'), JSON.stringify({ ...base, timezone: 'America/Bogota' }));
writeFileSync(join(dir, '.env'), '');
Object.assign(process.env, {
  XENCRM_CONFIG: join(dir, 'xencrm.config.json'),
  XENCRM_ENV_FILE: join(dir, '.env'),
  DB_PATH: join(dir, 'xencrm.db'),
  WHATSAPP_ENABLED: 'false',
  ADMIN_TOKEN: 'token-del-tablero-de-prueba-0123456789',
});
globalThis.fetch = (async (url: string | URL | Request) => {
  throw new Error(`la prueba no sale a la red: ${String(url)}`);
}) as typeof fetch;

const { touchUser } = await import('../agent/memory.js');
const { updateContact } = await import('../crm/contacts.js');
const T = await import('../crm/tickets.js');
const { frenoDelCandado } = await import('../channels/candado.js');
const { Hono } = await import('hono');
const { mountAdmin } = await import('../channels/admin.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;
/** Una hora de Bogotá (UTC−5, sin cambio de hora): «2026-09-22T10:00». */
const bog = (s: string) => new Date(`${s}:00-05:00`).getTime();
const cliente = (id: string, nombre: string, plan?: string) => {
  touchUser(id, 'whatsapp', nombre);
  updateContact(id, { data: plan ? { plan_soporte: plan } : {} }, { silent: true });
  return id;
};
const abrir = (contacto: string, prioridad: string, now: number) => T.crearTicket({ contacto, asunto: 'No sincroniza la app de campo', prioridad }, 'Laura', now).id;
const mover = (id: number, cambios: Record<string, unknown>, now: number) => T.cambiarTicket(id, cambios, 'Laura', now);
type Tablero = { columnas: { id: string; nombre: string; cierra: boolean; pausa: boolean; total: number; tickets: { id: number; estado: string }[] }[]; dias: number; tope: number };
const tablero = (f: Parameters<typeof T.tableroDeTickets>[0]): Tablero => {
  const r = T.tableroDeTickets(f);
  if ('error' in r) throw new Error(r.error);
  return r;
};
const columnaDe = (tab: Tablero, id: number) => tab.columnas.find((c) => c.tickets.some((t) => t.id === id))?.id ?? null;
const idsDe = (tab: Tablero, col: string) => tab.columnas.find((c) => c.id === col)?.tickets.map((t) => t.id) ?? [];
const todos = (tab: Tablero) => tab.columnas.flatMap((c) => c.tickets.map((t) => t.id)).sort((a, b) => a - b);
const estructura = (e: unknown) => {
  const r = T.guardarConfigSla({ estructura: e });
  if ('error' in r) throw new Error(r.error);
};

// Un lunes por la mañana, y el tablero se mira el jueves.
const t0 = bog('2026-09-21T09:00');
const now = bog('2026-09-24T10:00');
const ENT = cliente('573001110001', 'Andrea Ruiz', 'Enterprise');
const PRO = cliente('573001110002', 'Mateo Díaz', 'Pro');
const SIN = cliente('573001110003', 'Lucía Mora');

const vencido = abrir(PRO, 'alta', t0); // Pro · alta: 4 h hábiles para responder; el jueves ya pasó
const reciente = abrir(ENT, 'baja', now - 10 * MIN); // a tiempo
const enCurso = abrir(SIN, 'media', t0 + HORA); // sin plan: sin SLA
mover(enCurso, { estado: 'en_progreso', asignado: 'Laura' }, t0 + 2 * HORA);
const esperando = abrir(PRO, 'media', t0);
mover(esperando, { estado: 'esperando_cliente' }, t0 + HORA);
const resuelto = abrir(ENT, 'critica', now - 2 * DIA);
mover(resuelto, { estado: 'resuelto' }, now - DIA);
const cerradoViejo = abrir(PRO, 'baja', now - 60 * DIA);
mover(cerradoViejo, { estado: 'cerrado' }, now - 50 * DIA);
const abiertoViejo = abrir(PRO, 'alta', now - 45 * DIA); // nadie lo atendió: sigue abierto

// ---------------------------------------------------------------------------------------------------------------
console.log('— Las columnas son los estados de la configuración');
const tab = tablero({ now });
check('una columna por estado, en su orden y con su nombre', JSON.stringify(tab.columnas.map((c) => [c.id, c.nombre])) === JSON.stringify(T.FABRICA.estados.map((e) => [e.id, e.nombre])), JSON.stringify(tab.columnas.map((c) => c.id)));
check('cada columna dice si cierra o pausa, como su estado', tab.columnas.every((c) => { const e = T.FABRICA.estados.find((x) => x.id === c.id)!; return c.cierra === e.cierra && c.pausa === e.pausa; }));
check('de fábrica: 30 días de terminados y 100 por columna', tab.dias === 30 && tab.tope === 100, JSON.stringify([tab.dias, tab.tope]));
check('cada ticket en la columna de su estado', columnaDe(tab, vencido) === 'abierto' && columnaDe(tab, reciente) === 'abierto' && columnaDe(tab, enCurso) === 'en_progreso' && columnaDe(tab, esperando) === 'esperando_cliente' && columnaDe(tab, resuelto) === 'resuelto',
  JSON.stringify([vencido, reciente, enCurso, esperando, resuelto].map((id) => columnaDe(tab, id))));
check('🪤 la columna vacía también está: es donde se suelta una tarjeta', tab.columnas.some((c) => c.id === 'cerrado' && c.total === 0 && c.tickets.length === 0));
check('un abierto viejo sigue a la vista', columnaDe(tab, abiertoViejo) === 'abierto');
check('un cerrado de hace 50 días no, con 30 días', columnaDe(tab, cerradoViejo) === null);
check('con 90 días, sí', columnaDe(tablero({ now, dias: 90 }), cerradoViejo) === 'cerrado');
check('🪤 dentro de la columna, por urgencia: los incumplidos (el que vence antes, primero) y después los a tiempo', JSON.stringify(idsDe(tab, 'abierto')) === JSON.stringify([abiertoViejo, vencido, reciente]), JSON.stringify(idsDe(tab, 'abierto')));
check('y es la misma lista de tickets, repartida', JSON.stringify(todos(tab)) === JSON.stringify(T.listarTickets({ dias: 30, now }).map((t) => t.id).sort((a, b) => a - b)));
const corto = tablero({ now, tope: 1 });
const abiertoCorto = corto.columnas.find((c) => c.id === 'abierto')!;
check('con tope, el total dice cuántos hay aunque no vengan todos', abiertoCorto.total === 3 && abiertoCorto.tickets.length === 1 && abiertoCorto.tickets[0]!.id === abiertoViejo, JSON.stringify([abiertoCorto.total, abiertoCorto.tickets.map((t) => t.id)]));
check('los días y el tope se quedan entre sus límites', tablero({ now, dias: 9999, tope: -3 }).dias === 365 && tablero({ now, dias: 9999, tope: -3 }).tope === 1);

// ---------------------------------------------------------------------------------------------------------------
console.log('— Los filtros');
check('por prioridad', JSON.stringify(todos(tablero({ now, prioridad: 'alta' }))) === JSON.stringify([vencido, abiertoViejo].sort((a, b) => a - b)));
check('por plan', JSON.stringify(todos(tablero({ now, plan: 'pro' }))) === JSON.stringify([vencido, esperando, abiertoViejo].sort((a, b) => a - b)));
check('«sin plan»', JSON.stringify(todos(tablero({ now, plan: T.SIN_PLAN }))) === JSON.stringify([enCurso]));
check('por asignado, sin importar mayúsculas ni espacios', JSON.stringify(todos(tablero({ now, asignado: '  LAURA ' }))) === JSON.stringify([enCurso]));
check('«sin asignar»', !todos(tablero({ now, asignado: T.SIN_ASIGNAR })).includes(enCurso) && todos(tablero({ now, asignado: T.SIN_ASIGNAR })).includes(vencido));
check('juntos', JSON.stringify(todos(tablero({ now, plan: 'pro', prioridad: 'media' }))) === JSON.stringify([esperando]));
check('con filtros, las columnas siguen todas', tablero({ now, prioridad: 'critica', plan: 'basico' }).columnas.length === T.FABRICA.estados.length);
const malaPrioridad = T.tableroDeTickets({ now, prioridad: 'urgentisima' });
check('una prioridad que no existe vuelve con por qué y su campo', 'error' in malaPrioridad && malaPrioridad.campo === 'prioridad');
const malPlan = T.tableroDeTickets({ now, plan: 'oro' });
check('y un plan que no existe, igual', 'error' in malPlan && malPlan.campo === 'plan');

// ---------------------------------------------------------------------------------------------------------------
console.log('— Los estados de este negocio');
check('sin estados quitados, no hay columna «Sin estado»', !tab.columnas.some((c) => c.id === T.SIN_ESTADO));
const propios = [
  ...T.FABRICA.estados.filter((e) => e.id !== 'esperando_cliente' && !e.cierra),
  { id: 'revision', nombre: 'En revisión', cierra: false, pausa: false },
  ...T.FABRICA.estados.filter((e) => e.cierra),
];
estructura({ estados: propios });
const tab2 = tablero({ now });
check('las columnas siguen la configuración nueva, con el estado propio en su sitio', JSON.stringify(tab2.columnas.map((c) => c.id)) === JSON.stringify([...propios.map((e) => e.id), T.SIN_ESTADO]), JSON.stringify(tab2.columnas.map((c) => c.id)));
check('🪤 un ticket cuyo estado se quitó no desaparece: queda en «Sin estado», al final', columnaDe(tab2, esperando) === T.SIN_ESTADO && tab2.columnas.at(-1)!.id === T.SIN_ESTADO && tab2.columnas.at(-1)!.nombre === 'Sin estado');
mover(esperando, { estado: 'revision' }, now);
check('y se saca de ahí moviéndolo a uno que existe', columnaDe(tablero({ now }), esperando) === 'revision' && !tablero({ now }).columnas.some((c) => c.id === T.SIN_ESTADO));
// Antes de volver a los de fábrica, a uno que exista en los dos: si no, el resto de la prueba arranca con un huérfano.
mover(esperando, { estado: 'en_progreso' }, now);
T.olvidarConfigDelTablero();

// ---------------------------------------------------------------------------------------------------------------
console.log('— La ruta');
const app = new Hono();
mountAdmin(app as never);
const H = { 'x-admin-token': process.env.ADMIN_TOKEN!, 'content-type': 'application/json' };
const pedir = (ruta: string, init: { method?: string; body?: unknown; rol?: string } = {}) =>
  app.request(`/admin/api${ruta}`, { method: init.method ?? 'GET', headers: init.rol ? { ...H, 'x-xencrm-rol': init.rol } : H, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
type Respuesta = Tablero & { config: { estados: { id: string }[]; estadoInicial: string }; puede: { crear: boolean; mover: boolean }; ahora: number };

const r = await pedir('/tickets/tablero', { rol: 'asesor' });
check('🪤 /tickets/tablero contesta el tablero, y no lo toma por el id de un ticket', r.status === 200, String(r.status));
const d = (await r.json()) as Respuesta;
check('con las columnas, la configuración (nombres, tonos) y lo que se puede', d.columnas.length === T.FABRICA.estados.length && d.config.estados.length === T.FABRICA.estados.length && d.puede.mover === true && typeof d.ahora === 'number');
const malFiltro = await pedir('/tickets/tablero?prioridad=urgentisima');
check('un filtro que no existe vuelve con 400 y su campo', malFiltro.status === 400 && ((await malFiltro.json()) as { campo: string }).campo === 'prioridad');
const filtrado = (await (await pedir(`/tickets/tablero?plan=${T.SIN_PLAN}&asignado=laura`)).json()) as Respuesta;
check('los filtros llegan por la URL', JSON.stringify(todos(filtrado)) === JSON.stringify([enCurso]), JSON.stringify(todos(filtrado)));
const crea = await pedir('/tickets', { method: 'POST', rol: 'asesor', body: { contacto: PRO, asunto: 'La impresora fiscal no imprime', prioridad: 'alta' } });
const nuevo = ((await crea.json()) as { id: number }).id;
const ver = async () => (await (await pedir('/tickets/tablero', { rol: 'asesor' })).json()) as Respuesta;
check('un ticket nuevo entra en la columna del estado inicial', columnaDe(await ver(), nuevo) === d.config.estadoInicial);
const mueve = await pedir(`/tickets/${nuevo}`, { method: 'PATCH', rol: 'asesor', body: { estado: 'en_progreso' } });
check('moverlo de columna es el PATCH de siempre con { estado }', mueve.status === 200 && columnaDe(await ver(), nuevo) === 'en_progreso');
check('y /tickets/:id sigue contestando el ticket', (await pedir(`/tickets/${nuevo}`)).status === 200 && (await pedir('/tickets/999999')).status === 404);
const pone = T.guardarConfigSla({ reglas: { 'sla.permisos.mover': 'quien_administra' } });
check('(se cambia quién mueve)', !('error' in pone));
const sinMover = await (await pedir('/tickets/tablero', { rol: 'asesor' })).json() as Respuesta;
check('si el asesor no puede mover, el tablero se lee igual pero lo dice', sinMover.puede.mover === false && sinMover.columnas.length > 0);
check('y el PATCH lo frena el servidor, no solo la pantalla', (await pedir(`/tickets/${nuevo}`, { method: 'PATCH', rol: 'asesor', body: { estado: 'resuelto' } })).status === 403);
T.olvidarConfigDelTablero();
check('el candado del modo fácil deja leer el tablero', frenoDelCandado('tickets/tablero', 'GET', 'asesor', 'facil') === null);

// ---------------------------------------------------------------------------------------------------------------
console.log('— Lo mínimo de la vista');
const html = readFileSync(new URL('../../public/admin.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../../public/admin.js', import.meta.url), 'utf8');
const bloque = js.slice(js.indexOf('// ===== XEN · Tickets y SLA'), js.indexOf('// (fin de XEN · Tickets y SLA)'));
const estilo = html.slice(html.indexOf('/* ---------- XEN · Tickets y SLA'), html.indexOf('/* (fin de XEN · Tickets y SLA) */'));
check('Tickets se ve como lista o como tablero, y se recuerda', bloque.includes('data-xt-modo="lista"') && bloque.includes('data-xt-modo="tablero"') && bloque.includes("LLAVE('tickets.modo')"));
check('el tablero lo pide a /tickets/tablero', bloque.includes("'/tickets/tablero?"));
check('las tarjetas se arrastran, y también se mueven con «Mover…» (teclado, lector de pantalla, celular)', bloque.includes('draggable="true"') && bloque.includes('Mover…') && bloque.includes('card-move'));
check('🪤 y moverlas es el mismo PATCH, sin ruta nueva', /api\('\/tickets\/' \+ id, \{ method: 'PATCH', body: \{ estado: estado \} \}\)/.test(bloque));
check('quien no puede mover no ve tarjetas que se arrastran', bloque.includes('XT.puede.mover ? \' draggable="true"\''));
check('lo que pasó al mover se anuncia a un lector de pantalla', /id="view-tickets"[^]*?id="xt-tab-status"[^>]*role="status"/.test(html));
check('el estilo va en su ancla, y una columna vacía dice «tickets», no «tratos»', estilo.includes('.xt-tablero') && estilo.includes('Sin tickets en este estado'));

console.log(fail ? `\n${fail} prueba(s) fallaron` : '\nTodo bien');
process.exit(fail ? 1 : 0);
