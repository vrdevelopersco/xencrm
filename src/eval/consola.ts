// Pruebas de la consola del super-admin (sin modelo): pnpm test:consola
// Los tickets salen solos del estado de cada instancia, el orden pone primero lo urgente de los clientes que más
// pesan, y el alta de un cliente es una acción del super-admin. Carpeta temporal: no toca los clientes de verdad.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = mkdtempSync(join(tmpdir(), 'aiva-consola-'));
process.env.AIVA_CLIENTES_DIR = base;
process.env.CONSOLA_TOKEN = 'token-de-prueba';
const { ticketsDe, ordenar, mountConsola } = await import('../consola.js');
const { crearCliente, leerIndice, tokenDe } = await import('../clientes.js');
const { Hono } = await import('hono');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};
const ref = (slug: string, prioridad: 'alta' | 'media' | 'baja') => ({ slug, nombre: slug, puerto: 3001, host: '', prioridad, desde: '2026-09-23' });

// --- los tickets salen del estado ---
const caido = ticketsDe(ref('uno', 'alta'), { arriba: false });
check('una instancia apagada es lo más urgente', caido.length === 1 && caido[0]!.urgencia === 'alta' && /no responde/.test(caido[0]!.titulo), JSON.stringify(caido));
check('y no inventa lo que no puede saber', caido.length === 1);

const vivo = ticketsDe(ref('dos', 'media'), { arriba: true, publica: 'caida', whatsapp: 'esperando_qr', porVerificar: 2, esperanRespuesta: 3, citasSinResultado: 1 });
check('la dirección pública caída es urgente', vivo.some((t) => t.urgencia === 'alta' && /pública/.test(t.titulo)), JSON.stringify(vivo.map((t) => t.titulo)));
check('WhatsApp pidiendo código avisa', vivo.some((t) => /WhatsApp/.test(t.titulo)));
check('las preguntas sin responder avisan, con cuántas', vivo.some((t) => /2 preguntas sin responder/.test(t.titulo)), JSON.stringify(vivo.map((t) => t.titulo)));
check('los que esperan respuesta también', vivo.some((t) => /3 esperan respuesta/.test(t.titulo)));
check('las citas sin resultado son lo menos urgente', vivo.some((t) => t.urgencia === 'baja' && /cita sin resultado/.test(t.titulo)), JSON.stringify(vivo.map((t) => t.titulo)));

const tranquilo = ticketsDe(ref('tres', 'baja'), { arriba: true, publica: 'ok', whatsapp: 'conectado', porVerificar: 0, esperanRespuesta: 0, citasSinResultado: 0 });
check('un cliente al día no genera tickets', tranquilo.length === 0, JSON.stringify(tranquilo));
check('WhatsApp apagado a propósito no es un problema', ticketsDe(ref('x', 'media'), { arriba: true, whatsapp: 'apagado' }).length === 0);

// --- el orden es el de atención ---
const orden = ordenar([
  { cliente: ref('tranquilo-grande', 'alta'), tickets: [] },
  { cliente: ref('urgente-chico', 'baja'), tickets: [{ urgencia: 'alta', titulo: 'a', detalle: '' }] },
  { cliente: ref('urgente-grande', 'alta'), tickets: [{ urgencia: 'alta', titulo: 'b', detalle: '' }] },
  { cliente: ref('tibio-medio', 'media'), tickets: [{ urgencia: 'baja', titulo: 'c', detalle: '' }] },
]).map((f) => f.cliente.slug);
check('primero lo urgente del cliente que más pesa', orden[0] === 'urgente-grande', orden.join(' · '));
check('un cliente sin pendientes queda de último, aunque sea grande', orden[3] === 'tranquilo-grande', orden.join(' · '));

// --- el alta es del super-admin, por la API ---
const app = new Hono();
mountConsola(app);
const pedir = (ruta: string, init: RequestInit = {}) =>
  app.request(`http://local${ruta}`, { ...init, headers: { 'x-consola-token': 'token-de-prueba', 'content-type': 'application/json', ...(init.headers ?? {}) } });

check('sin token no se ve nada', (await app.request('http://local/api/clientes')).status === 401);

// Puertos altos a propósito: la prueba no debe chocar con instancias de verdad corriendo en esta máquina.
const alta = await pedir('/api/clientes', { method: 'POST', body: JSON.stringify({ nombre: 'Financiera del Caribe', prioridad: 'alta', puerto: 39001 }) });
const creado = (await alta.json()) as { cliente?: { slug: string; prioridad: string }; token?: string };
check('el super-admin da de alta un cliente', alta.status === 200 && creado.cliente?.slug === 'financiera-del-caribe' && Boolean(creado.token), JSON.stringify(creado).slice(0, 120));
check('y puede elegirle el puerto', (creado.cliente as unknown as { puerto: number } | undefined)?.puerto === 39001);
check('queda en el índice, con su prioridad', leerIndice().some((c) => c.slug === 'financiera-del-caribe' && c.prioridad === 'alta'));
check('el token que devuelve es el que quedó en su .env', creado.token === tokenDe('financiera-del-caribe'));

const repetido = await pedir('/api/clientes', { method: 'POST', body: JSON.stringify({ nombre: 'Financiera del Caribe', puerto: 39003 }) });
check('no deja crear dos veces el mismo', repetido.status === 409, String(repetido.status));

const sinNombre = await pedir('/api/clientes', { method: 'POST', body: JSON.stringify({}) });
check('sin nombre no crea nada', sinNombre.status === 400);

const cambio = await pedir('/api/clientes/financiera-del-caribe', { method: 'PATCH', body: JSON.stringify({ prioridad: 'baja', notas: 'arranca en octubre' }) });
check('puede cambiarle la prioridad y dejarle una nota', cambio.status === 200 && leerIndice()[0]!.prioridad === 'baja' && leerIndice()[0]!.notas === 'arranca en octubre');
check('a un cliente que no existe, no', (await pedir('/api/clientes/nadie', { method: 'PATCH', body: '{}' })).status === 404);

// La consola no crea clientes por su cuenta: solo cuando se lo piden.
crearCliente({ nombre: 'Litografía Industrial', puerto: 39002 });
const lista = (await (await pedir('/api/clientes')).json()) as { clientes: { cliente: { slug: string } }[] };
check('lista los que hay, sin agregar ninguno', lista.clientes.length === 2, String(lista.clientes.length));
check('los apagados se ven como apagados', lista.clientes.every((f) => (f as unknown as { estado: { arriba: boolean } }).estado.arriba === false));

// --- una sola bandeja: lo de todos los clientes, y poder atenderlo desde aquí ---
const { pendientes } = await import('../consola.js');
check('sin instancias arriba, la bandeja queda vacía y no revienta', (await pendientes()).length === 0);

check('la consola habla por el cliente, poniendo su token', (await pedir('/api/c/financiera-del-caribe/stats')).status === 502, 'la instancia está apagada: 502, no 401');
check('por un cliente que no existe, no habla', (await pedir('/api/c/nadie/stats')).status === 404);
check('y sin el token de la consola, nada', (await app.request('http://local/api/c/financiera-del-caribe/stats')).status === 401);
check('la bandeja tampoco se ve sin token', (await app.request('http://local/api/pendientes')).status === 401);

console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
