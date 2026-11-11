// Consola del super-admin: todos los clientes en una pantalla, con lo que hay que atender de cada uno y el alta de
// clientes nuevos. No guarda nada propio: le pregunta a cada instancia por su API con el token de ese cliente, que
// lee de `clientes/<slug>/.env`.
//
// Por eso mismo escucha solo en la máquina (CONSOLA_HOST, por defecto 127.0.0.1): quien entre aquí tiene la llave
// de todos los tableros. Para entrar desde afuera, un túnel con autenticación por delante, nunca abierta.
//
//   pnpm consola          arranca en http://localhost:3900
import { createAdaptorServer, serve } from '@hono/node-server';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { anotarAcceso, navegadorDe, tapado, type Acceso } from './accesos.js';
import { actualizarCliente, CLIENTES_DIR, crearCliente, darDeBajaCliente, leerIndice, llamarACliente, PLANTILLAS, puertoLibre, tokenDe, urlDe, type ClienteRef } from './clientes.js';
import { cabecerasDeSiempre, cspDePagina, soloDesdeAqui } from './cabeceras.js';
import { anotarFalloDeIngreso, avisoDeFreno, entroBien, frenoDelIngreso } from './ingreso.js';
import { abrirSesion, ACENTOS, actualizarComo, alcanza, borrarComo, cambiarLoMio, COLORES, colorDe, cerrarSesion, crearComo, equipoPara, leerUsuarios, manejaEquipo, quitarClienteDeUsuarios, sesionDe, usuariosSinClientes, verificar, type UsuarioPublico } from './consola-usuarios.js';
import { irseSiQuedaHuerfano } from './huerfano.js';
import { deDondeViene, guardarLibretaConfig, libretaConfig } from './crm/libreta-config.js';
import { general, guardarGeneral } from './crm/general.js';

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
  /** Cómo se llama su asistente: es el nombre que sus clientes ya conocen. */
  agente?: string;
  /** Si tiene logo propio: la lista lo muestra en vez de las iniciales. */
  logo?: boolean;
  /** Cuánta gente lleva esperando respuesta ahora mismo. */
  esperandoAhora?: number;
  /** Cuánto lleva esperando el que más lleva, en minutos de horario de atención. */
  peorEsperaMin?: number;
  /** Qué parte de lo respondido cumplió lo prometido, en porcentaje. */
  cumplimiento?: number | null;
  /** Lo que el negocio prometió: primera respuesta en estos minutos. */
  acuerdoMin?: number;
  contactos?: number;
  calientes?: number;
  sinLeer?: number;
  citas?: number;
  esperanRespuesta?: number;
  porVerificar?: number;
  citasSinResultado?: number;
  /** Para el vistazo ampliado de cada cliente. */
  mensajesHoy?: number;
  puntajePromedio?: number;
  /** Cuántas conversaciones llegaron a cita y cuántas se ganaron, sobre el total. */
  llegaronACita?: number;
  ganadas?: number;
  efectividad?: number | null;
  publica?: string;
  whatsapp?: string;
  gastoMes?: number | null;
  /** El tope de gasto de IA del mes calendario: cuánto va y en qué escalón (ver crm/presupuesto.ts). */
  presupuesto?: { tope: number | null; gastado: number; porcentaje: number | null; nivel: string } | null;
  /** El commit que corre en ese cliente (src/version.ts). */
  version?: string;
  /** Cómo entra su equipo al tablero: con el modo fácil, y su candado, o viéndolo todo (channels/candado.ts). */
  modo?: 'facil' | 'completo';
}

const pesoUrgencia = { alta: 3, media: 2, baja: 1 } as const;
const pesoPrioridad = { alta: 3, media: 2, baja: 1 } as const;

/**
 * Los tickets de un cliente: lo que alguien de XENCRM tiene que atender, no lo que atiende el negocio. Salen solos
 * del estado, sin que nadie los escriba.
 */
export function ticketsDe(cliente: ClienteRef, e: EstadoCliente): Ticket[] {
  const t: Ticket[] = [];
  if (!e.arriba) {
    // El aviso dice lo que se sabe (no contesta) y no lo que se teme (se cayó, se perdió todo). Casi siempre es
    // la red o un reinicio, y las conversaciones siguen en su sitio: alarmar de más hace que se deje de leer.
    t.push({ urgencia: 'alta', titulo: 'Sin conexión con este cliente', detalle: `No estamos alcanzando a ${cliente.nombre} ahora mismo; sus conversaciones están guardadas. Suele ser la red o un reinicio. Si sigue así, revisar con pm2 logs xencrm-${cliente.slug}.` });
    return t; // si está caída, lo demás no se sabe
  }
  // 🪤 Cada estado con lo que significa (channels/public-check.ts). Antes cualquiera distinto de «ok» era «no
  // contesta», con urgencia alta: también «sin_url», que es no tener dirección configurada, y «fallando», que es una
  // falla suelta que la propia instancia todavía no da por caída —necesita tres seguidas—. Una alarma que suena por
  // lo que no es enseña a no leerla.
  if (e.publica === 'caida') {
    t.push({ urgencia: 'alta', titulo: 'Su dirección pública no contesta', detalle: 'Mientras tanto no entran el chat del sitio ni WhatsApp oficial. Suele ser la red o el túnel.' });
  } else if (e.publica === 'otro_servidor') {
    t.push({ urgencia: 'alta', titulo: 'Su dirección pública contesta desde otro servidor', detalle: 'El túnel o el dominio apunta a otra instancia: lo que entra por ahí no le llega a este cliente. Revisar a dónde apunta.' });
  }
  // El conflicto va aparte y va arriba: es el único estado de WhatsApp en el que el canal no se recupera solo,
  // y mientras dure, el negocio no recibe ni contesta nada por ahí.
  if (e.whatsapp === 'conflicto') {
    t.push({
      urgencia: 'alta',
      titulo: 'Su WhatsApp está abierto en dos sitios',
      detalle: 'Cada sesión echa a la otra y no entra ningún mensaje. Hay que dejarlo en un solo sitio (teléfono › Dispositivos vinculados, u otra máquina con XENCRM) y volver a encender el canal en su tablero.',
    });
  } else if (e.whatsapp && !['conectado', 'apagado', 'no_disponible', 'sin_configurar'].includes(e.whatsapp)) {
    t.push({ urgencia: 'media', titulo: `WhatsApp en "${e.whatsapp}"`, detalle: 'Puede que haya que volver a escanear el código.' });
  }
  // El tope de gasto. 🪤 Al 100 % es urgencia alta aunque nada esté caído: lo que necesita IA ya no lo contesta
  // XENCRM, y si nadie del negocio está mirando su tablero, esos clientes se quedan esperando.
  const p = e.presupuesto;
  if (p && p.tope !== null && p.porcentaje !== null) {
    const cuanto = `Lleva $${p.gastado.toFixed(2)} de $${p.tope.toFixed(2)} este mes.`;
    if (p.nivel === 'agotado') t.push({ urgencia: 'alta', titulo: 'Llegó al tope de gasto de IA', detalle: `${cuanto} Lo que necesita IA lo contesta el equipo a mano hasta el mes siguiente, o hasta subir el tope en Configuración › Motores.` });
    else if (p.nivel === 'ahorro') t.push({ urgencia: 'media', titulo: `Gasto de IA al ${p.porcentaje} %: ahorrando`, detalle: `${cuanto} Lo específico ya lo contesta el modelo de responder; al 100 % deja de usar la IA de pago.` });
    else if (p.nivel === 'aviso') t.push({ urgencia: 'baja', titulo: `Gasto de IA al ${p.porcentaje} % del tope`, detalle: `${cuanto} Al 90 % empieza a ahorrar.` });
  }
  if (e.porVerificar) {
    t.push({ urgencia: 'media', titulo: `${e.porVerificar} pregunta${e.porVerificar === 1 ? '' : 's'} sin responder`, detalle: 'El asistente no supo y el cliente está esperando la respuesta del equipo.' });
  }
  if (e.acuerdoMin && e.peorEsperaMin && e.peorEsperaMin > e.acuerdoMin) {
    const cuantos = e.esperandoAhora ?? 1;
    t.push({
      urgencia: 'alta',
      titulo: `${cuantos === 1 ? 'Alguien lleva' : `${cuantos} llevan`} ${e.peorEsperaMin} min esperando`,
      detalle: `Prometieron contestar en ${e.acuerdoMin}. Esto se arregla contestando ahora, desde su tablero.`,
    });
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

const pedir = async (cliente: ClienteRef, ruta: string, token: string, ms = 2500): Promise<Record<string, unknown> | null> => {
  try {
    const r = await llamarACliente(cliente, ruta, { headers: { 'x-admin-token': token }, esperaMs: ms });
    return r.ok ? ((await r.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/** Le pregunta a la instancia de un cliente cómo va. Si no responde, queda "apagada" y nada más. */
export async function estadoDe(cliente: ClienteRef): Promise<EstadoCliente> {
  const token = tokenDe(cliente.slug);
  if (!token) return { arriba: false };
  const [me, stats, hoy, canales, gasto, tiempos, tope] = await Promise.all([
    pedir(cliente, '/admin/api/me', token, 1500),
    pedir(cliente, '/admin/api/stats', token),
    pedir(cliente, '/admin/api/today', token),
    pedir(cliente, '/admin/api/channels', token),
    pedir(cliente, '/admin/api/usage?days=30', token),
    pedir(cliente, '/admin/api/tiempos?dias=7', token),
    pedir(cliente, '/admin/api/presupuesto', token),
  ]);
  if (!me) return { arriba: false };
  const lista = (x: unknown) => (Array.isArray(x) ? x.length : 0);
  // Efectividad: de las conversaciones abiertas, cuántas llegaron a cita y cuántas se ganaron. Las etapas las
  // nombra cada negocio, así que se buscan por su papel, que es lo único que significa lo mismo en todos.
  const etapas = (stats?.stages ?? []) as { id: string; rol?: string }[];
  const porEtapa = (stats?.byStage ?? {}) as Record<string, number>;
  const cuantosCon = (rol: string) => etapas.filter((e) => e.rol === rol).reduce((a, e) => a + Number(porEtapa[e.id] ?? 0), 0);
  const total = Number(stats?.total ?? 0);
  const llegaronACita = cuantosCon('cita');
  const ganadas = cuantosCon('ganado');
  const wa = Array.isArray(canales) ? (canales as { id: string; state: string; on: boolean }[]).find((c) => c.id === 'whatsapp') : undefined;
  return {
    arriba: true,
    negocio: String(me.business ?? cliente.nombre),
    agente: String(me.agent ?? ''),
    version: me.version ? String(me.version) : undefined,
    modo: stats?.modo === 'facil' ? 'facil' : 'completo',
    logo: Boolean(me.logo),
    contactos: Number(stats?.total ?? 0),
    calientes: Number(stats?.hot ?? 0),
    sinLeer: Number(stats?.unread ?? 0),
    citas: Number(stats?.upcomingAppointments ?? 0),
    esperanRespuesta: lista(hoy?.unanswered),
    ...(() => {
      const esperando = (tiempos?.esperando ?? []) as { msHabiles: number }[];
      const respondidas = Number(tiempos?.respondidas ?? 0);
      const fuera = Number(tiempos?.fueraDeAcuerdo ?? 0);
      return {
        esperandoAhora: esperando.length,
        peorEsperaMin: esperando.length ? Math.round(Math.max(...esperando.map((x) => x.msHabiles)) / 60_000) : 0,
        cumplimiento: respondidas ? Math.round(((respondidas - fuera) / respondidas) * 100) : null,
        acuerdoMin: Number(tiempos?.acuerdoMin ?? 0) || undefined,
      };
    })(),
    porVerificar: lista(hoy?.verifications),
    citasSinResultado: lista(hoy?.past),
    publica: (hoy?.public as { state?: string } | undefined)?.state ?? '',
    whatsapp: wa?.on ? wa.state : 'apagado',
    gastoMes: gasto ? Number(gasto.totalUsd ?? 0) : null,
    presupuesto: tope
      ? { tope: tope.tope == null ? null : Number(tope.tope), gastado: Number(tope.gastado ?? 0), porcentaje: tope.porcentaje == null ? null : Number(tope.porcentaje), nivel: String(tope.nivel ?? '') }
      : null,
    mensajesHoy: Number(stats?.messagesToday ?? 0),
    puntajePromedio: Number(stats?.avgScore ?? 0),
    llegaronACita,
    ganadas,
    efectividad: total ? Math.round((100 * (llegaronACita + ganadas)) / total) : null,
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
const GALLETA = 'xencrm_consola';

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
// `Strict`: el navegador no la manda en nada que nazca en otro sitio. Interfaz y API comparten origen, así que eso
// cierra además las peticiones disparadas desde otra página (estándar de HRC, sección B), y queda soloDesdeAqui
// detrás por si acaso.
const ponerGalleta = (c: Context, sesion: string) =>
  setCookie(c, GALLETA, sesion, { path: '/', httpOnly: true, sameSite: 'Strict', secure: porHttps(c), maxAge: 12 * 60 * 60 });
// 🪤 Al borrarla se repiten TODOS los atributos del alta. Borrar no los hereda: salía `Max-Age=0; Path=/` a secas
// (medido en producción el 2026-11-07), y un navegador que compara atributos puede no dar por borrada la original.
// Aquí además la sesión se cierra en el servidor, pero la galleta tiene que irse igual.
const quitarGalleta = (c: Context) => deleteCookie(c, GALLETA, { path: '/', httpOnly: true, sameSite: 'Strict', secure: porHttps(c) });

/** Quién hace la petición, por cabecera o por galleta. `usuario` null con la llave maestra: alcanza a todos. */
/**
 * Lo que solo puede tocar quien administra XENCRM, aunque el cliente sea suyo.
 *
 * La llave de OpenAI y el reparto de motores deciden a quién se le factura y cuánto: no son de la operación
 * del negocio. Todo lo demás —sus contactos, sus citas, su conocimiento, su configuración— sí es suyo.
 */
const SOLO_SUPER = /^(clave|motores)(\/|$)/;
/**
 * Lo que el negocio puede ver pero solo cambia quien administra XENCRM. La retención borra (o anonimiza) datos de sus
 * clientes: el negocio tiene que saber que existe y cuándo pasó, pero encenderla no es de la operación del día. Las
 * metas (KPIs y metas) las pone quien administra: el equipo las ve —sabe a qué apunta— pero no se las cambia.
 */
const SOLO_SUPER_CAMBIA = /^(retencion|metas)(\/|$)/;

/**
 * Si quien no es super-admin pide algo de lo anterior, por qué no. Null si puede.
 *
 * 🪤 Al cliente se llega por DOS puertas: `/api/c/<slug>/…` (la consola hablando por él) y `/c/<slug>/admin/api/…`
 * (su tablero abierto desde la consola). El freno estaba solo en la primera, así que por la segunda alguien que
 * atiende cambiaba los motores, ponía una clave de OpenAI o encendía la retención que borra conversaciones. Con
 * una sola función para las dos, no se puede volver a cerrar una y olvidar la otra.
 */
function vedado(esSuper: boolean, ruta: string, metodo: string): string | null {
  if (esSuper) return null;
  if (SOLO_SUPER.test(ruta)) return 'eso lo lleva quien administra XENCRM, no el negocio';
  if (SOLO_SUPER_CAMBIA.test(ruta) && metodo !== 'GET' && metodo !== 'HEAD') return 'eso lo cambia quien administra XENCRM; verlo sí puedes';
  return null;
}

function quienEs(c: Context): { usuario: UsuarioPublico | null; esSuper: boolean } | null {
  // 🪤 La llave maestra, solo por cabecera (para programas: pnpm salud, un guion). Se aceptaba también en la
  // dirección (`?token=`), y lo que va en la dirección queda escrito en los registros del alojamiento.
  if (c.req.header('x-consola-token') === CONSOLA_TOKEN) return { usuario: null, esSuper: true };
  const usuario = sesionDe(c.req.header('x-consola-sesion') ?? galletaDe(c));
  return usuario ? { usuario, esSuper: usuario.rol === 'super' } : null;
}

// El freno para quien prueba claves a ciegas vive en ingreso.ts, con sus tres barreras y en disco.
// 🪤 Lo que NO se reenvía a la instancia de un cliente. La llave maestra se acepta por `?token=`, y el proxy
// copiaba la dirección entera: bastaba abrir `/c/<cliente>/admin?token=<llave>` para que la llave de TODOS los
// clientes quedara escrita en el registro de acceso de la instancia de uno solo.
const CREDENCIAL = new Set(['token', 'sesion', 'maestra', 'clave']);

/** De dónde viene quien pide. Detrás del servidor del hosting, la de verdad llega en una cabecera. */
const deDonde = (c: Context): string =>
  c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'sin-direccion';

// ── La bitácora de accesos (src/accesos.ts): se lee en /_salud con su token. Anotar nunca tumba nada.
const anotar = (c: Context, e: Omit<Acceso, 'cuando' | 'ip' | 'navegador'>) =>
  anotarAcceso(CLIENTES_DIR, { ...e, ip: deDonde(c), navegador: navegadorDe(c.req.header('user-agent')) });
/** Quién hizo algo, para la bitácora. La llave maestra no es una cuenta: se nombra con un espacio, que ningún
 *  usuario puede tener, para que no se confunda con alguien que se llame «maestra». */
const nombreDe = (u: UsuarioPublico | null): string => (!u || u === SUPER_DE_EMERGENCIA ? 'llave maestra' : u.usuario);
/** A quién se refiere un intento fallido y por qué falló. Lo escrito solo se guarda si es una cuenta que existe:
 *  si no, es justo donde alguien pudo pegar su clave por error, y va tapado. */
function intentoFallido(body: { usuario?: string; clave?: string; maestra?: string }): { usuario: string; motivo: string } {
  if (body.maestra) return { usuario: 'llave maestra', motivo: 'llave maestra equivocada' };
  const escrito = String(body.usuario ?? '').trim().toLowerCase();
  const cuenta = escrito ? leerUsuarios().find((x) => x.usuario === escrito || (Boolean(x.correo) && x.correo === escrito)) : undefined;
  if (!cuenta) return { usuario: tapado(escrito), motivo: 'usuario que no existe' };
  return { usuario: cuenta.usuario, motivo: !cuenta.activo ? 'cuenta desactivada' : body.clave ? 'clave equivocada' : 'sin clave' };
}
/** Qué se le cambió a una cuenta. La clave se nombra, nunca se escribe. */
function queCambio(body: Record<string, unknown>): string {
  const partes: string[] = [];
  if (body.clave !== undefined || body.claveNueva !== undefined) partes.push('clave nueva');
  if (body.rol !== undefined) partes.push(`rol: ${String(body.rol)}`);
  if (Array.isArray(body.clientes)) partes.push(`clientes: ${body.clientes.join(', ') || 'ninguno'}`);
  if (body.activo !== undefined) partes.push(body.activo ? 'activada' : 'desactivada');
  for (const k of ['nombre', 'correo', 'color', 'acento']) if (body[k] !== undefined) partes.push(k);
  return partes.join(' · ') || 'nada';
}

/**
 * La página de la consola, leída una sola vez al arrancar.
 *
 * 🪤 Antes se leía del disco en CADA petición. Cuando algo falla ahí —el archivo no está donde se espera, no se
 * puede leer, lo que sea— la consola entera devuelve un 500 mudo: no entra nadie y desde fuera no hay forma de
 * saber por qué. Leyéndola al arrancar, el problema se ve una vez en el registro y la página se sirve de memoria.
 */
let laPagina: string | null = null;
let porQueNo = '';
function paginaConsola(): string | null {
  if (laPagina !== null) return laPagina;
  try {
    laPagina = readFileSync(new URL('../public/consola.html', import.meta.url), 'utf8');
  } catch (err) {
    porQueNo = (err as Error).message;
    console.error('[consola] no pude leer public/consola.html:', porQueNo);
  }
  return laPagina;
}

/**
 * La consola, en dos páginas: la puerta (solo el formulario de entrar) para quien no tiene sesión, y la consola
 * entera para quien sí.
 *
 * 🪤 Antes la página era una sola y se le servía completa a cualquiera: 180 KB con el código de todas las
 * pantallas —cada ruta de la API, cada permiso que se comprueba, cómo se arma cada llamada— a alguien que ni
 * había escrito una clave. Ahora quien no entró solo se lleva el formulario.
 *
 * Se parten por sus marcas en public/consola.html (`<div id="login"`, `<div id="app"`, `<script id="guion-puerta">`,
 * `<script id="guion-app">`), en ese orden. Si alguna falta, no se adivina: se dice, y test:blindaje lo vigila.
 */
export function partirLaConsola(html: string): { puerta: string; consola: string } | null {
  const marcas = ['<div id="login"', '<div id="app"', '<script id="guion-puerta">', '<script id="guion-app">', '</body>'];
  const pos = marcas.map((m) => (m === '</body>' ? html.lastIndexOf(m) : html.indexOf(m)));
  if (pos.some((p, i) => p === -1 || (i > 0 && p <= pos[i - 1]!))) return null;
  const [login, app, guionPuerta, guionApp, pie] = pos as [number, number, number, number, number];
  const cabeza = html.slice(0, login);
  return {
    puerta: cabeza + html.slice(login, app) + html.slice(guionPuerta, guionApp) + html.slice(pie),
    consola: cabeza + html.slice(app, guionPuerta) + html.slice(guionApp, pie) + html.slice(pie),
  };
}
let lasPartes: { puerta: { html: string; csp: string }; consola: { html: string; csp: string } } | null | undefined;
function partesDeLaConsola() {
  if (lasPartes !== undefined) return lasPartes;
  const html = paginaConsola();
  const partes = html ? partirLaConsola(html) : null;
  if (html && !partes) {
    porQueNo = 'a public/consola.html le falta alguna de sus marcas (login, app, guion-puerta, guion-app)';
    console.error('[consola]', porQueNo);
  }
  lasPartes = partes && {
    puerta: { html: partes.puerta, csp: cspDePagina(partes.puerta) },
    consola: { html: partes.consola, csp: cspDePagina(partes.consola) },
  };
  return lasPartes;
}

export function mountConsola(app: Hono) {
  app.use('*', cabecerasDeSiempre);
  app.use('*', soloDesdeAqui);
  // Un error dentro de la consola tiene que decir qué pasó. Un «Internal Server Error» a secas deja a quien lo
  // sufre sin nada que contar y a quien lo arregla adivinando.
  //
  // 🪤 Pero el detalle va al registro del servidor, no a la respuesta: un mensaje de error interno le cuenta a
  // quien está tanteando qué hay detrás (rutas de archivos, nombres de funciones, qué se rompió con qué). A quien
  // lo sufre le basta saber en qué ruta y cuándo, para buscarlo en el registro.
  app.onError((err, c) => {
    console.error('[consola]', c.req.method, c.req.path, '→', err);
    return c.text(`Falló ${c.req.path}. El detalle quedó en el registro del servidor (${new Date().toISOString()}).`, 500);
  });

  // La puerta o la consola entera, según haya sesión (ver partirLaConsola). La misma dirección sirve dos páginas
  // distintas: por eso no se guarda en ninguna caché, y se avisa que depende de la galleta.
  const puerta = (c: Context) => {
    const partes = partesDeLaConsola();
    if (!partes) return c.text(`No pude leer la página de la consola: ${porQueNo}`, 500);
    const pagina = quienEs(c) ? partes.consola : partes.puerta;
    c.header('content-security-policy', pagina.csp);
    c.header('cache-control', 'no-store');
    c.header('vary', 'cookie');
    return c.html(pagina.html);
  };
  app.get('/', puerta);
  // La misma puerta donde la pone el despliegue (xencrm.hrctechnologies.com/consola), para que mandar aquí funcione
  // igual con el enrutador del paquete y con la consola corriendo sola.
  app.get('/consola', puerta);

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
  // 🪤 La sesión sale SOLO en la galleta (HttpOnly: ningún guion de la página la lee). Antes iba también en el
  // cuerpo, y la consola la guardaba en el almacenamiento del navegador: ahí la lee cualquier guion que llegue a
  // correr en este origen, y un fallo de escape ya no robaba una pestaña abierta, se llevaba la credencial a otro
  // sitio. Quien no es un navegador (un guion, las pruebas) la toma del Set-Cookie y la manda por cabecera.
  app.post('/api/entrar', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { usuario?: string; clave?: string; maestra?: string };
    // La cuenta se cuenta por quién es, no por cómo la escribieron: con el usuario o con el correo es la misma, y
    // alternar entre los dos no puede dar el doble de intentos.
    const escrito = String(body.usuario ?? '').trim().toLowerCase().slice(0, 64);
    const existente = escrito ? leerUsuarios().find((x) => x.usuario === escrito || (Boolean(x.correo) && x.correo === escrito)) : undefined;
    const cuenta = body.maestra ? 'maestra' : existente?.usuario ?? escrito;
    const ip = deDonde(c);
    const freno = frenoDelIngreso(ip, cuenta);
    if (freno) {
      anotar(c, { tipo: 'frenado', usuario: intentoFallido(body).usuario, motivo: freno.motivo });
      const aviso = avisoDeFreno(freno.hasta);
      c.header('retry-after', String(aviso.segundos));
      return c.json({ error: aviso.texto }, 429);
    }
    const conMaestra = Boolean(body.maestra) && body.maestra === CONSOLA_TOKEN;
    const u = conMaestra ? SUPER_DE_EMERGENCIA : body.usuario && body.clave ? verificar(body.usuario, body.clave) : null;
    if (!u) {
      const { bloqueadaMin } = anotarFalloDeIngreso(ip, cuenta);
      // Al cliente, siempre lo mismo; el motivo de verdad (usuario que no existe, cuenta desactivada, clave
      // equivocada) queda en la bitácora, que es donde se averigua por qué alguien no puede entrar.
      anotar(c, { tipo: 'fallo', ...intentoFallido(body) });
      if (bloqueadaMin) anotar(c, { tipo: 'frenado', usuario: intentoFallido(body).usuario, motivo: `cuenta bloqueada ${bloqueadaMin} min` });
      return c.json({ error: 'Usuario o clave incorrectos' }, 401);
    }
    entroBien(ip, cuenta);
    const sesion = abrirSesion(u, Date.now(), conMaestra);
    ponerGalleta(c, sesion);
    anotar(c, { tipo: 'entro', usuario: nombreDe(u), rol: u.rol });
    return c.json({ ok: true, usuario: u });
  });
  app.post('/api/salir', (c) => {
    const quien = sesionDe(c.req.header('x-consola-sesion') ?? galletaDe(c));
    if (quien) anotar(c, { tipo: 'salio', usuario: nombreDe(quien) });
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
    // Sin sesión, a la puerta de la consola. 🪤 A /consola y no a /: en el despliegue, / es la portada, y quien
    // tenía el tablero guardado caía en una página que no era ni el tablero ni dónde entrar.
    if (!quien) return c.redirect('/consola', 302);
    const slug = c.req.param('slug');
    if (!alcanza(quien.usuario, slug)) return c.text('Ese cliente no es tuyo.', 403);
    const resto = c.req.param('resto') || '';
    const prohibido = resto.startsWith('admin/api/') ? vedado(quien.esSuper, resto.slice('admin/api/'.length), c.req.method) : null;
    if (prohibido) return c.json({ error: prohibido }, 403);
    const cliente = leerIndice().find((x) => x.slug === slug);
    const token = cliente ? tokenDe(slug) : '';
    if (!cliente || !token) return c.text('Ese cliente no existe o no tiene token.', 404);
    // Abrir el tablero es lo que dice si alguien de verdad está mirando su negocio; sus llamadas de adentro, no.
    if (resto === 'admin') anotar(c, { tipo: 'tablero', usuario: nombreDe(quien.usuario), cliente: slug });

    // El monitor (la pantalla que se mira en otro aparato durante una demostración) también entra por aquí: por la
    // ruta del cliente ya no se sirve nada del tablero (borde.cjs, cerradoDesdeFuera).
    const ruta = resto === 'admin' || resto === 'admin.js' || resto === 'admin/monitor' || resto.startsWith('admin/api/') ? `/${resto}` : null;
    if (!ruta) return c.text('No encontrado', 404);

    const url = new URL(urlDe(cliente) + ruta);
    for (const [k, v] of Object.entries(c.req.query())) if (!CREDENCIAL.has(k)) url.searchParams.set(k, v);
    const metodo = c.req.method;
    // 🪤 El cuerpo va en BYTES y con el tipo con que llegó. Leído como texto y reenviado como JSON, un adjunto
    // (un formulario con una foto) llegaba al cliente roto y sin su separador, y el tablero decía «falta el
    // archivo»: mandar un archivo funcionaba con el token a secas y fallaba justo entrando por aquí.
    const cuerpo = metodo === 'GET' || metodo === 'HEAD' ? undefined : new Uint8Array(await c.req.arrayBuffer());
    const tipo = c.req.header('content-type') || 'application/json';
    // Quién es, para la historia de cada ficha (channels/admin.ts, quienHace). Sale de la cuenta, no del navegador:
    // lo que mande el navegador en esa cabecera no pasa de aquí.
    const nombre = quien.usuario?.nombre || (quien.esSuper ? 'Llave maestra' : '');
    // Y con qué rol, para el candado del modo fácil (channels/candado.ts). También de la sesión, nunca del navegador.
    const miRol = quien.esSuper ? 'super' : quien.usuario?.rol || 'asesor';
    // El flujo en vivo (SSE) no puede llevar reloj: se queda abierto a propósito.
    const esFlujo = resto.endsWith('admin/api/stream');
    const esLaPagina = resto === 'admin';
    try {
      const r = await llamarACliente(cliente, url.pathname + url.search, {
        method: metodo,
        headers: { 'x-admin-token': token, 'x-xencrm-rol': miRol, ...(nombre ? { 'x-xencrm-quien': encodeURIComponent(nombre) } : {}), ...(cuerpo?.length ? { 'content-type': tipo } : {}) },
        body: cuerpo,
        ...(esFlujo ? {} : { esperaMs: 15000 }),
      });
      // 🪤 El tablero, si no encuentra un token en el navegador, ni lo intenta: enseña su pantalla de token. Pero
      // entrando por aquí no hace falta ninguno —la consola se lo pone a cada petición—, así que se le avisa con
      // una marca en la página. Sin esto, un super-admin entraba a un cliente y le volvían a pedir el token.
      if (esLaPagina && r.ok) {
        // Además del cliente, quiénes lo atienden: el tablero no tiene forma de saberlo por su cuenta (habla con
        // un token, no con cuentas) y sin eso no se le puede entregar una conversación a nadie por su nombre.
        const equipo = leerUsuarios()
          .filter((u) => u.activo && (u.rol === 'super' || u.clientes.includes(slug)))
          .map((u) => ({ usuario: u.usuario, nombre: u.nombre }));
        // 🪤 Y quién está atendiendo. Antes el tablero guardaba ese nombre en el navegador, así que se perdía al
        // cambiar de equipo o de navegador y había que volver a escribirlo. Quien entra por la consola ya dijo
        // quién es al iniciar sesión: el nombre sale de su cuenta y deja de depender de la máquina.
        // 🪤 Con la llave maestra no hay cuenta en el archivo, así que esto llegaba VACÍO y el tablero se
        // quedaba sin saber quién atiende. Se dice igual: quien entró por la puerta de emergencia también tiene
        // un nombre que enseñar, y es mejor «Llave maestra» que nada.
        // 🪤 De `quien`, que es de esta ruta, y NO de `c.get('usuario')`: ese lo pone el middleware de /api/* y
        // aquí nunca se escribió, así que leerlo daba vacío siempre y el tablero se quedaba sin saber quién
        // atiende — que es justo el fallo que se estaba persiguiendo.
        const soy = quien.usuario?.nombre || (quien.esSuper ? 'Llave maestra' : '');
        // 🪤 Y su ROL (`miRol`, el mismo que va en `x-xencrm-rol`), para que el tablero pueda guardar lo que no es del
        // día a día —el gasto, las llamadas al modelo— detrás de una sección que solo ve quien administra. Quien
        // entra con el token a secas no pasa por aquí y lo ve todo: es su token, y con él puede llamar a cualquier
        // ruta igual. Esto ORDENA la pantalla; lo que cierra de verdad es el candado del servidor (channels/candado.ts).
        const html = (await r.text()).replace(
          '</head>',
          `<script>window.XENCRM_CONSOLA=${JSON.stringify(slug)};window.XENCRM_EQUIPO=${JSON.stringify(equipo)};window.XENCRM_QUIEN=${JSON.stringify(soy)};window.XENCRM_ROL=${JSON.stringify(miRol)}</script></head>`,
        );
        // La CSP se saca de la página YA inyectada: la huella de ese guion cambia con cada quien que entra.
        c.header('content-security-policy', cspDePagina(html));
        c.header('cache-control', 'no-store');
        return c.html(html);
      }
      const csp = r.headers.get('content-security-policy');
      return new Response(r.body, {
        status: r.status,
        headers: {
          'content-type': r.headers.get('content-type') ?? 'application/json',
          'cache-control': esFlujo ? 'no-cache' : (r.headers.get('cache-control') ?? 'no-cache'),
          // La del cliente pasa tal cual (el monitor trae la suya, con la huella de su guion).
          ...(csp ? { 'content-security-policy': csp } : {}),
        },
      });
    } catch {
      return c.text('No estamos alcanzando a ese cliente ahora mismo. Suele ser la red; vuelve a intentar en un momento.', 502);
    }
  });

  app.get('/api/yo', (c) => {
    const u = c.get('usuario' as never) as UsuarioPublico | null;
    return c.json({ usuario: u ? { ...u, color: colorDe(u) } : null, super: Boolean(c.get('esSuper' as never)), equipo: manejaEquipo(u), colores: COLORES, acentos: ACENTOS });
  });

  // El equipo: quién entra a la consola y qué clientes atiende. El super-admin ve a todos; el admin de un cliente,
  // a la gente de sus clientes (ver equipoPara). El asesor, a nadie.
  app.get('/api/usuarios', (c) => {
    const actor = c.get('usuario' as never) as UsuarioPublico | null;
    if (!manejaEquipo(actor)) return c.json({ error: 'el equipo lo maneja el admin de tu cliente' }, 403);
    // `sinClientes` son los que atienden y se quedaron sin ninguno: no pueden hacer nada hasta que les asignen.
    // Solo los ve el super-admin: el admin de un cliente no tiene cómo asignárselos, y no son de su negocio.
    return c.json({
      usuarios: equipoPara(actor).map((u) => ({ ...u, color: colorDe(u) })),
      sinClientes: c.get('esSuper' as never) ? usuariosSinClientes().map((u) => u.usuario) : [],
      colores: COLORES,
    });
  });
  /**
   * Lo mío: nombre, correo y clave. Cualquiera que entró puede cambiarse lo suyo sin pedirle nada a nadie; para
   * la clave hay que poner la actual. Con la llave maestra no hay nada que cambiar: no es un usuario del archivo.
   */
  app.patch('/api/yo', async (c) => {
    const yo = c.get('usuario' as never) as UsuarioPublico | null;
    if (!yo) return c.json({ error: 'entraste con la llave maestra: eso no es una cuenta. Crea tu usuario en Equipo.' }, 400);
    const body = (await c.req.json().catch(() => ({}))) as { nombre?: string; correo?: string; color?: string; acento?: string; claveActual?: string; claveNueva?: string };
    try {
      const u = cambiarLoMio(yo.usuario, body);
      anotar(c, { tipo: 'cuenta', usuario: yo.usuario, por: yo.usuario, que: `lo suyo: ${queCambio(body)}` });
      return c.json({ usuario: { ...u, color: colorDe(u) } });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  // Crear, cambiar y quitar gente. Quién puede tocar a quién lo decide consola-usuarios (crearComo y compañía),
  // no esta ruta: así la regla vive en un solo sitio y se prueba sin levantar la consola.
  const actorDe = (c: Context) => c.get('usuario' as never) as UsuarioPublico | null;
  app.post('/api/usuarios', async (c) => {
    if (!manejaEquipo(actorDe(c))) return c.json({ error: 'el equipo lo maneja el admin de tu cliente' }, 403);
    const body = (await c.req.json().catch(() => ({}))) as { usuario?: string; nombre?: string; correo?: string; color?: string; clave?: string; rol?: 'super' | 'admin' | 'asesor'; clientes?: string[] };
    if (!body.usuario || !body.clave) return c.json({ error: 'falta el usuario o la clave' }, 400);
    try {
      const nuevo = crearComo(actorDe(c), { usuario: body.usuario, nombre: body.nombre, correo: body.correo, color: body.color, clave: body.clave, rol: body.rol, clientes: body.clientes });
      anotar(c, { tipo: 'cuenta', usuario: nuevo.usuario, por: nombreDe(actorDe(c)), que: `creada · ${nuevo.rol} · ${nuevo.clientes.join(', ') || 'sin clientes'}` });
      return c.json({ usuario: nuevo });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 409);
    }
  });
  app.patch('/api/usuarios/:usuario', async (c) => {
    if (!manejaEquipo(actorDe(c))) return c.json({ error: 'el equipo lo maneja el admin de tu cliente' }, 403);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    try {
      const cambiado = actualizarComo(actorDe(c), c.req.param('usuario'), body);
      anotar(c, { tipo: 'cuenta', usuario: cambiado.usuario, por: nombreDe(actorDe(c)), que: queCambio(body) });
      return c.json({ usuario: cambiado });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 404);
    }
  });
  app.delete('/api/usuarios/:usuario', (c) => {
    if (!manejaEquipo(actorDe(c))) return c.json({ error: 'el equipo lo maneja el admin de tu cliente' }, 403);
    try {
      if (!borrarComo(actorDe(c), c.req.param('usuario'))) return c.json({ error: 'no existe' }, 404);
      anotar(c, { tipo: 'cuenta', usuario: c.req.param('usuario').toLowerCase(), por: nombreDe(actorDe(c)), que: 'quitada' });
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  /**
   * Las gráficas de todos los clientes juntas: cada instancia calcula la suya y aquí se suman. Un cliente
   * apagado simplemente no aporta, en vez de tumbar la pantalla.
   */
  app.get('/api/series', async (c) => {
    const usuario = c.get('usuario' as never) as UsuarioPublico | null;
    const clientes = leerIndice().filter((x) => alcanza(usuario, x.slug));
    const partes = await Promise.all(
      clientes.map(async (cliente) => {
        const token = tokenDe(cliente.slug);
        if (!token) return null;
        return (await pedir(cliente, '/admin/api/series?dias=14', token, 4000)) as
          | { nuevas?: { dia: string; whatsapp: number; web: number; otros: number; total: number }[]; semana?: Record<string, { ahora: number; antes: number }> }
          | null;
      }),
    );
    const vivas = partes.filter(Boolean) as NonNullable<(typeof partes)[number]>[];
    const porDia = new Map<string, { dia: string; whatsapp: number; web: number; otros: number; total: number }>();
    for (const p of vivas) {
      for (const d of p.nuevas ?? []) {
        const acc = porDia.get(d.dia) ?? { dia: d.dia, whatsapp: 0, web: 0, otros: 0, total: 0 };
        acc.whatsapp += d.whatsapp;
        acc.web += d.web;
        acc.otros += d.otros;
        acc.total += d.total;
        porDia.set(d.dia, acc);
      }
    }
    const sumarSemana = (campo: string) => {
      const ahora = vivas.reduce((a, p) => a + Number(p.semana?.[campo]?.ahora ?? 0), 0);
      const antes = vivas.reduce((a, p) => a + Number(p.semana?.[campo]?.antes ?? 0), 0);
      return { ahora, antes, delta: antes === 0 ? null : Math.round(((ahora - antes) / antes) * 100) };
    };
    return c.json({
      clientes: vivas.length,
      nuevas: [...porDia.values()].sort((a, b) => a.dia.localeCompare(b.dia)),
      semana: { conversaciones: sumarSemana('conversaciones'), mensajes: sumarSemana('mensajes'), citas: sumarSemana('citas') },
    });
  });

  app.get('/api/clientes', async (c) => c.json({ clientes: await tablero(c.get('usuario' as never) as UsuarioPublico | null), puertoSugerido: puertoLibre() }));

  /**
   * El logo de un cliente, para que la lista se lea de un vistazo por su marca y no por dos iniciales. Pasa por
   * aquí y no directo porque las instancias viven en puertos internos: el navegador no las alcanza. Sirve con la
   * galleta de sesión, que es lo que una etiqueta `img` puede mandar.
   */
  app.get('/api/marca/:slug', async (c) => {
    const slug = c.req.param('slug');
    if (!alcanza(c.get('usuario' as never) as UsuarioPublico | null, slug)) return c.text('Ese cliente no es tuyo.', 403);
    const cliente = leerIndice().find((x) => x.slug === slug);
    if (!cliente) return c.text('No existe.', 404);
    try {
      const r = await llamarACliente(cliente, '/brand/logo', { esperaMs: 2500 });
      if (!r.ok) return c.text('Sin logo.', 404);
      // 🪤 Esto es un archivo de otro: la instancia del cliente lo sirve con su propia CSP y aquí hay que
      // repetirla. Un logo puede ser un SVG, y un SVG abierto como página ejecuta JavaScript —en el origen de
      // la consola, que es donde vive la sesión que alcanza a todos los clientes—.
      return c.body(await r.arrayBuffer(), 200, {
        'content-type': r.headers.get('content-type') ?? 'image/png',
        'cache-control': 'private, max-age=300',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
        'content-disposition': 'inline',
      });
    } catch {
      return c.text('No contestó.', 404);
    }
  });

  // Cómo atiende el negocio: de aquí salen su embudo y si agenda citas.
  app.get('/api/plantillas', (c) => c.json({ plantillas: PLANTILLAS }));

  // El alta la hace el super-admin desde aquí: crea la carpeta, el token y el puerto. No arranca nada.
  app.post('/api/clientes', async (c) => {
    if (!c.get('esSuper' as never)) return c.json({ error: 'solo el super-admin da de alta clientes' }, 403);
    const body = (await c.req.json().catch(() => ({}))) as { nombre?: string; slug?: string; host?: string; puerto?: number; base?: string; prioridad?: ClienteRef['prioridad']; plantilla?: string; sedes?: string };
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
        sedes: typeof body.sedes === 'string' ? body.sedes : undefined,
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
    // 🪤 Hay rutas que NO son del negocio aunque sean de su cliente: la llave de OpenAI y qué modelos se usan.
    // Eso es nuestra infraestructura y nuestro costo, no su operación. La pantalla ya las escondía —la pestaña
    // de Configuración solo la ve el super—, pero esconder un botón no protege nada: por aquí pasaba cualquier
    // ruta con el token del cliente ya puesto, así que al darle cuenta a un cliente le estábamos dando también
    // la posibilidad de leerse y cambiarse la llave con una llamada. Se cierra donde se decide, no donde se pinta.
    const prohibido = vedado(Boolean(c.get('esSuper' as never)), c.req.param('ruta'), c.req.method);
    if (prohibido) return c.json({ error: prohibido }, 403);
    const cliente = leerIndice().find((x) => x.slug === slug);
    const token = cliente ? tokenDe(slug) : '';
    if (!cliente || !token) return c.json({ error: 'ese cliente no existe' }, 404);
    const url = new URL(`${urlDe(cliente)}/admin/api/${c.req.param('ruta')}`);
    for (const [k, v] of Object.entries(c.req.query())) if (!CREDENCIAL.has(k)) url.searchParams.set(k, v);
    const method = c.req.method;
    const body = method === 'GET' || method === 'HEAD' ? undefined : await c.req.text();
    // Lo que se cambie desde la consola también queda con nombre en la historia de la ficha (ver arriba, /c/:slug).
    const nombre = actorDe(c)?.nombre || (c.get('esSuper' as never) ? 'Llave maestra' : '');
    const rol = c.get('esSuper' as never) ? 'super' : actorDe(c)?.rol || 'asesor';
    try {
      const r = await llamarACliente(cliente, url.pathname + url.search, {
        method,
        headers: { 'x-admin-token': token, 'x-xencrm-rol': rol, ...(nombre ? { 'x-xencrm-quien': encodeURIComponent(nombre) } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
        body,
        esperaMs: 8000,
      });
      return new Response(r.body, { status: r.status, headers: { 'content-type': r.headers.get('content-type') ?? 'application/json' } });
    } catch {
      return c.json({ error: 'no estamos alcanzando a ese cliente ahora mismo; suele ser la red' }, 502);
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

  /**
   * La libreta: quién puede abrirla. Va aquí, en la consola, porque es una herramienta de quien opera el
   * sistema, no del negocio. Lo que se guarda lo leen los procesos de los clientes de la carpeta compartida.
   */
  app.get('/api/libreta', (c) => {
    if (!c.get('esSuper' as never)) return c.json({ error: 'solo el super-admin' }, 403);
    const cfg = libretaConfig();
    return c.json({
      ...cfg,
      // Desde dónde está entrando quien pregunta: para poder añadirla de un clic y no tener que ir a buscarla.
      tuIp: deDondeViene(
        {
          'cf-connecting-ip': c.req.header('cf-connecting-ip'),
          'x-forwarded-for': c.req.header('x-forwarded-for'),
          'x-real-ip': c.req.header('x-real-ip'),
        },
        (c as { env?: { incoming?: { socket?: { remoteAddress?: string } } } }).env?.incoming?.socket?.remoteAddress ?? '',
      ),
      // 🪤 La dirección PÚBLICA de cada cliente, no la del proxy de la consola. Si el enlace fuera por
      // `/c/<slug>/…`, quien lo abriera entraría con la dirección de este servidor y no con la suya, así que el
      // sello por IP dejaría pasar a cualquiera con la llave — justo lo que el sello existe para evitar.
      clientes: leerIndice().map((x) => ({
        slug: x.slug,
        nombre: x.nombre,
        publico: x.host ? `https://${x.host}` : x.base ? x.base.replace(/\/$/, '') : `/${x.slug}`,
      })),
    });
  });

  app.post('/api/libreta', async (c) => {
    if (!c.get('esSuper' as never)) return c.json({ error: 'solo el super-admin' }, 403);
    const body = (await c.req.json().catch(() => ({}))) as { llave?: string; ips?: string[] };
    const llave = (body.llave ?? '').trim();
    // 🪤 Una llave corta se adivina probando. Mejor negarse que dejar puesta una que no protege nada.
    if (llave && llave.length < 24) return c.json({ error: 'la llave debe tener al menos 24 caracteres' }, 400);
    return c.json(guardarLibretaConfig({ llave, ips: Array.isArray(body.ips) ? body.ips.map(String) : [] }));
  });

  // ── La configuración general del aplicativo ──────────────────────────────
  //
  // Lo que vale para TODOS los clientes mientras cada uno no decida otra cosa en su tablero. Ver crm/general.ts
  // para el porqué de los dos niveles y de quién le gana a quién.
  app.get('/api/general', (c) => {
    if (!c.get('esSuper' as never)) return c.json({ error: 'solo el super-admin' }, 403);
    return c.json(general());
  });

  app.post('/api/general', async (c) => {
    if (!c.get('esSuper' as never)) return c.json({ error: 'solo el super-admin' }, 403);
    const body = await c.req.json().catch(() => ({}));
    return c.json(guardarGeneral(body));
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
  irseSiQuedaHuerfano(); // si el lanzador se muere, esta consola se va con él y no deja el puerto agarrado
  // La misma puerta de servicio que los clientes: un socket de archivo por si al enrutador no le llega por red.
  // Ver el porqué en channels/web.ts; aquí duele más, porque sin consola no se ve ningún cliente.
  if (process.env.XENCRM_SOCK) {
    const ruta = process.env.XENCRM_SOCK;
    try {
      rmSync(ruta, { force: true });
    } catch {
      /* el listen dirá por qué */
    }
    const puerta = createAdaptorServer({ fetch: app.fetch });
    puerta.on('error', (e: Error) => console.error(`   no pude abrir el socket ${ruta}: ${e.message}`));
    puerta.listen(ruta, () => console.log(`   y también por ${ruta}`));
  }
  const servidor = serve({ fetch: app.fetch, port: PUERTO, hostname: HOST }, () => {
    console.log(`\n🛠  Consola de XENCRM · http://localhost:${PUERTO}`);
    console.log(`   clientes: ${leerIndice().length}`);
    console.log(`   token: el de CONSOLA_TOKEN en .env${envRaiz('CONSOLA_TOKEN') ? ` (termina en …${CONSOLA_TOKEN.slice(-4)})` : `; no estaba, esta vez es ${CONSOLA_TOKEN}`}`);
    console.log(`   escucha solo en ${HOST}: quien entre aquí ve todos los clientes.\n`);
  });
  // Que no abra el puerto no es motivo para morirse si el socket quedó abierto: el enrutador entra por ahí.
  servidor.on('error', (e: Error) => console.error(`   no pude abrir el puerto ${PUERTO}: ${e.message}`));
}
