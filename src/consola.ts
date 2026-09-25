// Consola del super-admin: todos los clientes en una pantalla, con lo que hay que atender de cada uno y el alta de
// clientes nuevos. No guarda nada propio: le pregunta a cada instancia por su API con el token de ese cliente, que
// lee de `clientes/<slug>/.env`.
//
// Por eso mismo escucha solo en la máquina (CONSOLA_HOST, por defecto 127.0.0.1): quien entre aquí tiene la llave
// de todos los tableros. Para entrar desde afuera, un túnel con autenticación por delante, nunca abierta.
//
//   pnpm consola          arranca en http://localhost:3900
import { serve } from '@hono/node-server';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { readFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { actualizarCliente, crearCliente, darDeBajaCliente, leerIndice, PLANTILLAS, puertoLibre, tokenDe, urlDe, type ClienteRef } from './clientes.js';
import { abrirSesion, actualizarUsuario, alcanza, borrarUsuario, cambiarLoMio, cerrarSesion, crearUsuario, leerUsuarios, quitarClienteDeUsuarios, sesionDe, sinClave, usuariosSinClientes, verificar, type UsuarioPublico } from './consola-usuarios.js';

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
// PORT lo inyectan las plataformas de apps; CONSOLA_PORT manda si está, para no pisarlo en una máquina propia.
const PUERTO = Number(envRaiz('CONSOLA_PORT') || envRaiz('PORT') || 3900);
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

const pedir = async (cliente: Pick<ClienteRef, 'base' | 'puerto'>, ruta: string, token: string, ms = 2500): Promise<Record<string, unknown> | null> => {
  try {
    const r = await fetch(`${urlDe(cliente)}${ruta}`, { headers: { 'x-admin-token': token }, signal: AbortSignal.timeout(ms) });
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
    pedir(cliente, '/admin/api/me', token, 1500),
    pedir(cliente, '/admin/api/stats', token),
    pedir(cliente, '/admin/api/today', token),
    pedir(cliente, '/admin/api/channels', token),
    pedir(cliente, '/admin/api/usage?days=30', token),
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

/** Los clientes que puede ver quien mira, con su estado y sus tickets, en orden de atención. */
export async function tablero(usuario: UsuarioPublico | null = null) {
  const clientes = leerIndice().filter((c) => alcanza(usuario, c.slug));
  const filas = await Promise.all(
    clientes.map(async (cliente) => {
      const estado = await estadoDe(cliente);
      return { cliente, estado, tickets: ticketsDe(cliente, estado) };
    }),
  );
  return ordenar(filas) as { cliente: ClienteRef; estado: EstadoCliente; tickets: Ticket[] }[];
}

/** Una cosa por atender, de cualquier cliente: la consola es una sola bandeja. */
export interface Pendiente {
  slug: string;
  cliente: string;
  prioridad: ClienteRef['prioridad'];
  tipo: 'persona' | 'verificar' | 'espera';
  userId: string;
  nombre: string;
  texto: string;
  ts: number;
  /** Solo en las de verificar: el id de la pregunta para responderla. */
  verificacionId?: number;
  /** WhatsApp oficial pasadas 24 h no deja escribir: la consola lo advierte igual que el tablero. */
  ventana?: string;
}

const PESO_TIPO = { persona: 3, verificar: 3, espera: 2 } as const;

/** Lo que espera a una persona en los clientes que atiende quien mira, junto y en orden de atención. */
export async function pendientes(usuario: UsuarioPublico | null = null): Promise<Pendiente[]> {
  const clientes = leerIndice().filter((c) => alcanza(usuario, c.slug));
  const listas = await Promise.all(
    clientes.map(async (cliente): Promise<Pendiente[]> => {
      const token = tokenDe(cliente.slug);
      if (!token) return [];
      const hoy = await pedir(cliente, '/admin/api/today', token);
      if (!hoy) return [];
      const base = { slug: cliente.slug, cliente: cliente.nombre, prioridad: cliente.prioridad };
      const nombre = (c: Record<string, unknown>) => String(c.name ?? '') || String(c.id ?? '').replace(/^(wa|meta|web|cli|mcp):/, '').slice(0, 14);
      const verificaciones = (hoy.verifications as Record<string, unknown>[] | undefined) ?? [];
      const humanos = (hoy.handoffs as Record<string, unknown>[] | undefined) ?? [];
      const esperan = (hoy.unanswered as Record<string, unknown>[] | undefined) ?? [];
      return [
        ...verificaciones.map((v) => ({
          ...base,
          tipo: 'verificar' as const,
          userId: String(v.userId ?? ''),
          nombre: String(v.contactName ?? '') || String(v.userId ?? '').slice(0, 18),
          texto: String(v.question ?? ''),
          ts: Number(v.createdAt ?? v.ts ?? 0),
          verificacionId: Number(v.id ?? 0),
          ventana: (v.window as { note?: string } | undefined)?.note,
        })),
        ...humanos.map((c) => ({ ...base, tipo: 'persona' as const, userId: String(c.id ?? ''), nombre: nombre(c), texto: String(c.recap ?? c.summary ?? 'Pidió hablar con una persona.'), ts: Number(c.lastMessageAt ?? 0) })),
        ...esperan.map((c) => ({ ...base, tipo: 'espera' as const, userId: String(c.id ?? ''), nombre: nombre(c), texto: String(c.recap ?? c.summary ?? ''), ts: Number(c.lastMessageAt ?? 0) })),
      ];
    }),
  );
  const peso = (p: Pendiente) => PESO_TIPO[p.tipo] * pesoPrioridad[p.prioridad];
  return listas.flat().sort((a, b) => peso(b) - peso(a) || a.ts - b.ts); // a igual peso, lo que lleva más esperando
}

// ---------- Quién entra ----------
// La sesión viaja en una galleta además de la cabecera: es lo único que sirve para una navegación normal (abrir
// el tablero de un cliente) y para el flujo en vivo, que no pueden poner cabeceras.
const GALLETA = 'aiva_consola';

/** Con la llave maestra se entra como super-admin, sin usuario en el archivo. */
const SUPER_DE_EMERGENCIA: UsuarioPublico = {
  usuario: 'maestra',
  nombre: 'Llave maestra',
  rol: 'super',
  clientes: [],
  activo: true,
  desde: new Date().toISOString().slice(0, 10),
};

const porHttps = (c: Context) => c.req.header('x-forwarded-proto') === 'https' || c.req.url.startsWith('https:');
const galletaDe = (c: Context) => getCookie(c, GALLETA);
const ponerGalleta = (c: Context, sesion: string) =>
  setCookie(c, GALLETA, sesion, { path: '/', httpOnly: true, sameSite: 'Lax', secure: porHttps(c), maxAge: 12 * 60 * 60 });
const quitarGalleta = (c: Context) => deleteCookie(c, GALLETA, { path: '/' });

/** Quién hace la petición, por cabecera o por galleta. `usuario` null con la llave maestra: alcanza a todos. */
function quienEs(c: Context): { usuario: UsuarioPublico | null; esSuper: boolean } | null {
  if ((c.req.header('x-consola-token') ?? c.req.query('token')) === CONSOLA_TOKEN) return { usuario: null, esSuper: true };
  const usuario = sesionDe(c.req.header('x-consola-sesion') ?? galletaDe(c));
  return usuario ? { usuario, esSuper: usuario.rol === 'super' } : null;
}

export function mountConsola(app: Hono) {
  app.get('/', (c) => c.html(readFileSync(new URL('../public/consola.html', import.meta.url), 'utf8')));

  // El logo de la casa. En el despliegue lo sirve el enrutador, pero la consola también corre sola (pnpm consola)
  // y ahí nadie más lo serviría.
  app.get('/hrc-technologies.png', (c) =>
    c.body(readFileSync(new URL('../public/hrc-technologies.png', import.meta.url)), 200, {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=86400',
    }),
  );

  // Entrar con usuario y clave; la llave maestra (CONSOLA_TOKEN) sigue valiendo como super-admin.
  //
  // La sesión sale por dos vías a la vez: en el cuerpo (para las llamadas del panel, que la mandan por cabecera) y
  // en una galleta. La galleta es lo que permite abrir el tablero de un cliente aquí dentro: una navegación normal
  // y un EventSource no pueden poner cabeceras, pero la galleta viaja sola.
  app.post('/api/entrar', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { usuario?: string; clave?: string; maestra?: string };
    const conMaestra = Boolean(body.maestra) && body.maestra === CONSOLA_TOKEN;
    const u = conMaestra ? SUPER_DE_EMERGENCIA : body.usuario && body.clave ? verificar(body.usuario, body.clave) : null;
    if (!u) return c.json({ error: conMaestra ? 'Llave maestra incorrecta' : 'Usuario o clave incorrectos' }, 401);
    const sesion = abrirSesion(u, Date.now(), conMaestra);
    ponerGalleta(c, sesion);
    return c.json({ sesion, usuario: u });
  });
  app.post('/api/salir', (c) => {
    cerrarSesion(c.req.header('x-consola-sesion') ?? galletaDe(c));
    quitarGalleta(c);
    return c.json({ ok: true });
  });

  app.use('/api/*', async (c, next) => {
    if (c.req.path === '/api/entrar' || c.req.path === '/api/salir') return next();
    const quien = quienEs(c);
    if (!quien) return c.json({ error: 'no autorizado' }, 401);
    c.set('usuario' as never, quien.usuario as never);
    c.set('esSuper' as never, quien.esSuper as never);
    await next();
  });

  /**
   * El tablero de un cliente, servido desde aquí con su token puesto por dentro.
   *
   * Es lo que hace que un super-admin no tenga que volver a identificarse —ni repartir tokens— para entrar a un
   * cliente: se entra una vez a la consola y desde ahí se abre cualquier tablero al que uno alcance. El tablero
   * calcula solo dónde vive (BASE sale de la ruta), así que servido en /c/dunor/admin sus llamadas caen en
   * /c/dunor/admin/api/... y por aquí vuelven a pasar.
   */
  app.all('/c/:slug/:resto{.*}', async (c) => {
    const quien = quienEs(c);
    if (!quien) return c.redirect('/', 302); // sin sesión, a la puerta de la consola
    const slug = c.req.param('slug');
    if (!alcanza(quien.usuario, slug)) return c.text('Ese cliente no es tuyo.', 403);
    const cliente = leerIndice().find((x) => x.slug === slug);
    const token = cliente ? tokenDe(slug) : '';
    if (!cliente || !token) return c.text('Ese cliente no existe o no tiene token.', 404);

    const resto = c.req.param('resto') || '';
    const ruta = resto === 'admin' || resto === 'admin.js' || resto.startsWith('admin/api/') ? `/${resto}` : null;
    if (!ruta) return c.text('No encontrado', 404);

    const url = new URL(urlDe(cliente) + ruta);
    for (const [k, v] of Object.entries(c.req.query())) url.searchParams.set(k, v);
    const metodo = c.req.method;
    const cuerpo = metodo === 'GET' || metodo === 'HEAD' ? undefined : await c.req.text();
    // El flujo en vivo (SSE) no puede llevar reloj: se queda abierto a propósito.
    const esFlujo = resto.endsWith('admin/api/stream');
    try {
      const r = await fetch(url, {
        method: metodo,
        headers: { 'x-admin-token': token, ...(cuerpo ? { 'content-type': 'application/json' } : {}) },
        body: cuerpo,
        ...(esFlujo ? {} : { signal: AbortSignal.timeout(15000) }),
      });
      return new Response(r.body, {
        status: r.status,
        headers: {
          'content-type': r.headers.get('content-type') ?? 'application/json',
          'cache-control': esFlujo ? 'no-cache' : (r.headers.get('cache-control') ?? 'no-cache'),
        },
      });
    } catch {
      return c.text('La instancia de ese cliente no responde.', 502);
    }
  });

  app.get('/api/yo', (c) => {
    const u = c.get('usuario' as never) as UsuarioPublico | null;
    return c.json({ usuario: u, super: Boolean(c.get('esSuper' as never)) });
  });

  // El equipo: quién entra a la consola y qué clientes atiende. Solo el super-admin.
  app.get('/api/usuarios', (c) => {
    if (!c.get('esSuper' as never)) return c.json({ error: 'solo el super-admin' }, 403);
    // `sinClientes` son los que atienden y se quedaron sin ninguno: no pueden hacer nada hasta que les asignen.
    return c.json({ usuarios: leerUsuarios().map(sinClave), sinClientes: usuariosSinClientes().map((u) => u.usuario) });
  });
  /**
   * Lo mío: nombre, correo y clave. Cualquiera que entró puede cambiarse lo suyo sin pedirle nada a nadie; para
   * la clave hay que poner la actual. Con la llave maestra no hay nada que cambiar: no es un usuario del archivo.
   */
  app.patch('/api/yo', async (c) => {
    const yo = c.get('usuario' as never) as UsuarioPublico | null;
    if (!yo) return c.json({ error: 'entraste con la llave maestra: eso no es una cuenta. Crea tu usuario en Equipo.' }, 400);
    const body = (await c.req.json().catch(() => ({}))) as { nombre?: string; correo?: string; claveActual?: string; claveNueva?: string };
    try {
      return c.json({ usuario: cambiarLoMio(yo.usuario, body) });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.post('/api/usuarios', async (c) => {
    if (!c.get('esSuper' as never)) return c.json({ error: 'solo el super-admin' }, 403);
    const body = (await c.req.json().catch(() => ({}))) as { usuario?: string; nombre?: string; correo?: string; clave?: string; rol?: 'super' | 'agente'; clientes?: string[] };
    if (!body.usuario || !body.clave) return c.json({ error: 'falta el usuario o la clave' }, 400);
    try {
      return c.json({ usuario: crearUsuario({ usuario: body.usuario, nombre: body.nombre, correo: body.correo, clave: body.clave, rol: body.rol, clientes: body.clientes }) });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 409);
    }
  });
  app.patch('/api/usuarios/:usuario', async (c) => {
    if (!c.get('esSuper' as never)) return c.json({ error: 'solo el super-admin' }, 403);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    try {
      return c.json({ usuario: actualizarUsuario(c.req.param('usuario'), body) });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 404);
    }
  });
  app.delete('/api/usuarios/:usuario', (c) => {
    if (!c.get('esSuper' as never)) return c.json({ error: 'solo el super-admin' }, 403);
    return borrarUsuario(c.req.param('usuario')) ? c.json({ ok: true }) : c.json({ error: 'no existe' }, 404);
  });

  app.get('/api/clientes', async (c) => c.json({ clientes: await tablero(c.get('usuario' as never) as UsuarioPublico | null), puertoSugerido: puertoLibre() }));

  // Cómo atiende el negocio: de aquí salen su embudo y si agenda citas.
  app.get('/api/plantillas', (c) => c.json({ plantillas: PLANTILLAS }));

  // El alta la hace el super-admin desde aquí: crea la carpeta, el token y el puerto. No arranca nada.
  app.post('/api/clientes', async (c) => {
    if (!c.get('esSuper' as never)) return c.json({ error: 'solo el super-admin da de alta clientes' }, 403);
    const body = (await c.req.json().catch(() => ({}))) as { nombre?: string; slug?: string; host?: string; puerto?: number; base?: string; prioridad?: ClienteRef['prioridad']; plantilla?: string };
    if (!body.nombre?.trim()) return c.json({ error: 'falta el nombre del negocio' }, 400);
    try {
      const { cliente, token } = crearCliente({
        nombre: body.nombre.trim(),
        slug: body.slug,
        host: body.host?.trim(),
        puerto: body.puerto ? Number(body.puerto) : undefined,
        base: body.base?.trim(),
        prioridad: body.prioridad,
        plantilla: body.plantilla,
      });
      return c.json({ cliente, token });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 409);
    }
  });

  app.patch('/api/clientes/:slug', async (c) => {
    if (!c.get('esSuper' as never)) return c.json({ error: 'solo el super-admin' }, 403);
    const body = (await c.req.json().catch(() => ({}))) as Partial<ClienteRef>;
    try {
      return c.json({ cliente: actualizarCliente(c.req.param('slug'), body) });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 404);
    }
  });

  // Todo lo que espera a una persona, de todos los clientes, en una sola bandeja.
  app.get('/api/pendientes', async (c) => c.json({ pendientes: await pendientes(c.get('usuario' as never) as UsuarioPublico | null) }));

  /**
   * La consola habla por el cliente: cualquier ruta del tablero de un cliente, con su token puesto aquí. Así se
   * atiende desde una sola pantalla sin repartir los tokens ni abrir cinco tableros.
   */
  app.all('/api/c/:slug/:ruta{.+}', async (c) => {
    const slug = c.req.param('slug');
    if (!alcanza(c.get('usuario' as never) as UsuarioPublico | null, slug)) return c.json({ error: 'ese cliente no es tuyo' }, 403);
    const cliente = leerIndice().find((x) => x.slug === slug);
    const token = cliente ? tokenDe(slug) : '';
    if (!cliente || !token) return c.json({ error: 'ese cliente no existe' }, 404);
    const url = new URL(`${urlDe(cliente)}/admin/api/${c.req.param('ruta')}`);
    for (const [k, v] of Object.entries(c.req.query())) url.searchParams.set(k, v);
    const method = c.req.method;
    const body = method === 'GET' || method === 'HEAD' ? undefined : await c.req.text();
    try {
      const r = await fetch(url, {
        method,
        headers: { 'x-admin-token': token, ...(body ? { 'content-type': 'application/json' } : {}) },
        body,
        signal: AbortSignal.timeout(8000),
      });
      return new Response(r.body, { status: r.status, headers: { 'content-type': r.headers.get('content-type') ?? 'application/json' } });
    } catch {
      return c.json({ error: 'la instancia de ese cliente no responde' }, 502);
    }
  });

  /**
   * Dar de baja un cliente. Su carpeta (base, configuración, WhatsApp) se guarda en `clientes/_dados-de-baja/`:
   * no se borra nada. Y sus usuarios se limpian, que si no quedan atendiendo a un cliente que ya no existe.
   */
  app.delete('/api/clientes/:slug', (c) => {
    if (!c.get('esSuper' as never)) return c.json({ error: 'solo el super-admin' }, 403);
    const slug = c.req.param('slug');
    try {
      const { cliente, guardadoEn } = darDeBajaCliente(slug);
      const usuarios = quitarClienteDeUsuarios(slug);
      return c.json({ cliente, guardadoEn, usuarios });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 404);
    }
  });

  app.get('/api/clientes/:slug/token', (c) => {
    if (!c.get('esSuper' as never)) return c.json({ error: 'solo el super-admin' }, 403);
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
