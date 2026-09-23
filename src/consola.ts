// Consola del super-admin: todos los clientes en una pantalla, con lo que hay que atender de cada uno y el alta de
// clientes nuevos. No guarda nada propio: le pregunta a cada instancia por su API con el token de ese cliente, que
// lee de `clientes/<slug>/.env`.
//
// Por eso mismo escucha solo en la máquina (CONSOLA_HOST, por defecto 127.0.0.1): quien entre aquí tiene la llave
// de todos los tableros. Para entrar desde afuera, un túnel con autenticación por delante, nunca abierta.
//
//   pnpm consola          arranca en http://localhost:3900
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { readFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { actualizarCliente, crearCliente, leerIndice, puertoLibre, tokenDe, type ClienteRef } from './clientes.js';

// El .env de la raíz, sin pasar por la configuración de un cliente (la consola no es de ningún cliente).
function envRaiz(clave: string): string {
  if (process.env[clave]) return process.env[clave]!;
  if (!existsSync('.env')) return '';
  for (const raw of readFileSync('.env', 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq !== -1 && line.slice(0, eq).trim() === clave) return line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
  return '';
}

export const CONSOLA_TOKEN = envRaiz('CONSOLA_TOKEN') || randomBytes(16).toString('hex');
const PUERTO = Number(envRaiz('CONSOLA_PORT') || 3900);
const HOST = envRaiz('CONSOLA_HOST') || '127.0.0.1';

export interface Ticket {
  urgencia: 'alta' | 'media' | 'baja';
  titulo: string;
  detalle: string;
}

/** Lo que la consola alcanza a saber de un cliente preguntándole a su instancia. */
export interface EstadoCliente {
  arriba: boolean;
  negocio?: string;
  contactos?: number;
  calientes?: number;
  sinLeer?: number;
  citas?: number;
  esperanRespuesta?: number;
  porVerificar?: number;
  citasSinResultado?: number;
  publica?: string;
  whatsapp?: string;
  gastoMes?: number | null;
}

const pesoUrgencia = { alta: 3, media: 2, baja: 1 } as const;
const pesoPrioridad = { alta: 3, media: 2, baja: 1 } as const;

/**
 * Los tickets de un cliente: lo que alguien de aiva tiene que atender, no lo que atiende el negocio. Salen solos
 * del estado, sin que nadie los escriba.
 */
export function ticketsDe(cliente: ClienteRef, e: EstadoCliente): Ticket[] {
  const t: Ticket[] = [];
  if (!e.arriba) {
    t.push({ urgencia: 'alta', titulo: 'La instancia no responde', detalle: `Nadie está atendiendo a ${cliente.nombre}. Revisar con pm2 logs aiva-${cliente.slug}.` });
    return t; // si está caída, lo demás no se sabe
  }
  if (e.publica && e.publica !== 'ok') {
    t.push({ urgencia: 'alta', titulo: 'La dirección pública no responde', detalle: 'Sin ella no entran el chat del sitio ni WhatsApp oficial.' });
  }
  if (e.whatsapp && !['conectado', 'apagado', 'no_disponible', 'sin_configurar'].includes(e.whatsapp)) {
    t.push({ urgencia: 'media', titulo: `WhatsApp en "${e.whatsapp}"`, detalle: 'Puede que haya que volver a escanear el código.' });
  }
  if (e.porVerificar) {
    t.push({ urgencia: 'media', titulo: `${e.porVerificar} pregunta${e.porVerificar === 1 ? '' : 's'} sin responder`, detalle: 'El asistente no supo y el cliente está esperando la respuesta del equipo.' });
  }
  if (e.esperanRespuesta) {
    t.push({ urgencia: 'media', titulo: `${e.esperanRespuesta} esperan respuesta`, detalle: 'La última palabra la tiene el cliente.' });
  }
  if (e.citasSinResultado) {
    t.push({ urgencia: 'baja', titulo: `${e.citasSinResultado} cita${e.citasSinResultado === 1 ? '' : 's'} sin resultado`, detalle: 'Sin marcarlas, el puntaje no se puede calibrar.' });
  }
  return t;
}

/** Orden de atención: primero lo urgente de los clientes que más pesan. */
export function ordenar(filas: { cliente: ClienteRef; tickets: Ticket[] }[]) {
  const peso = (f: { cliente: ClienteRef; tickets: Ticket[] }) =>
    f.tickets.reduce((a, t) => a + pesoUrgencia[t.urgencia], 0) * pesoPrioridad[f.cliente.prioridad] + pesoPrioridad[f.cliente.prioridad] / 10;
  return [...filas].sort((a, b) => peso(b) - peso(a) || a.cliente.nombre.localeCompare(b.cliente.nombre));
}

const pedir = async (puerto: number, ruta: string, token: string, ms = 2500): Promise<Record<string, unknown> | null> => {
  try {
    const r = await fetch(`http://localhost:${puerto}${ruta}`, { headers: { 'x-admin-token': token }, signal: AbortSignal.timeout(ms) });
    return r.ok ? ((await r.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/** Le pregunta a la instancia de un cliente cómo va. Si no responde, queda "apagada" y nada más. */
export async function estadoDe(cliente: ClienteRef): Promise<EstadoCliente> {
  const token = tokenDe(cliente.slug);
  if (!token) return { arriba: false };
  const [me, stats, hoy, canales, gasto] = await Promise.all([
    pedir(cliente.puerto, '/admin/api/me', token, 1500),
    pedir(cliente.puerto, '/admin/api/stats', token),
    pedir(cliente.puerto, '/admin/api/today', token),
    pedir(cliente.puerto, '/admin/api/channels', token),
    pedir(cliente.puerto, '/admin/api/usage?days=30', token),
  ]);
  if (!me) return { arriba: false };
  const lista = (x: unknown) => (Array.isArray(x) ? x.length : 0);
  const wa = Array.isArray(canales) ? (canales as { id: string; state: string; on: boolean }[]).find((c) => c.id === 'whatsapp') : undefined;
  return {
    arriba: true,
    negocio: String(me.business ?? cliente.nombre),
    contactos: Number(stats?.total ?? 0),
    calientes: Number(stats?.hot ?? 0),
    sinLeer: Number(stats?.unread ?? 0),
    citas: Number(stats?.upcomingAppointments ?? 0),
    esperanRespuesta: lista(hoy?.unanswered),
    porVerificar: lista(hoy?.verifications),
    citasSinResultado: lista(hoy?.past),
    publica: (hoy?.public as { state?: string } | undefined)?.state ?? '',
    whatsapp: wa?.on ? wa.state : 'apagado',
    gastoMes: gasto ? Number(gasto.totalUsd ?? 0) : null,
  };
}

/** Todos los clientes, con su estado y sus tickets, en orden de atención. */
export async function tablero() {
  const clientes = leerIndice();
  const filas = await Promise.all(
    clientes.map(async (cliente) => {
      const estado = await estadoDe(cliente);
      return { cliente, estado, tickets: ticketsDe(cliente, estado) };
    }),
  );
  return ordenar(filas) as { cliente: ClienteRef; estado: EstadoCliente; tickets: Ticket[] }[];
}

export function mountConsola(app: Hono) {
  app.get('/', (c) => c.html(readFileSync(new URL('../public/consola.html', import.meta.url), 'utf8')));

  app.use('/api/*', async (c, next) => {
    if ((c.req.header('x-consola-token') ?? c.req.query('token')) !== CONSOLA_TOKEN) return c.json({ error: 'no autorizado' }, 401);
    await next();
  });

  app.get('/api/clientes', async (c) => c.json({ clientes: await tablero(), puertoSugerido: puertoLibre() }));

  // El alta la hace el super-admin desde aquí: crea la carpeta, el token y el puerto. No arranca nada.
  app.post('/api/clientes', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { nombre?: string; slug?: string; host?: string; prioridad?: ClienteRef['prioridad']; plantilla?: string };
    if (!body.nombre?.trim()) return c.json({ error: 'falta el nombre del negocio' }, 400);
    try {
      const { cliente, token } = crearCliente({
        nombre: body.nombre.trim(),
        slug: body.slug,
        host: body.host?.trim(),
        prioridad: body.prioridad,
        plantilla: body.plantilla,
      });
      return c.json({ cliente, token });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 409);
    }
  });

  app.patch('/api/clientes/:slug', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Partial<ClienteRef>;
    try {
      return c.json({ cliente: actualizarCliente(c.req.param('slug'), body) });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 404);
    }
  });

  app.get('/api/clientes/:slug/token', (c) => {
    const token = tokenDe(c.req.param('slug'));
    return token ? c.json({ token }) : c.json({ error: 'no existe' }, 404);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = new Hono();
  mountConsola(app);
  serve({ fetch: app.fetch, port: PUERTO, hostname: HOST }, () => {
    console.log(`\n🛠  Consola de aiva · http://localhost:${PUERTO}`);
    console.log(`   clientes: ${leerIndice().length}`);
    console.log(`   token: el de CONSOLA_TOKEN en .env${envRaiz('CONSOLA_TOKEN') ? ` (termina en …${CONSOLA_TOKEN.slice(-4)})` : `; no estaba, esta vez es ${CONSOLA_TOKEN}`}`);
    console.log(`   escucha solo en ${HOST}: quien entre aquí ve todos los clientes.\n`);
  });
}
