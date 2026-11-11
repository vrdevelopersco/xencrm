// Quién entra a la consola y qué ve. El super-admin ve y atiende todos los clientes; a quien atiende un cliente
// solo le aparece —y le suena— lo de ese cliente. El admin de un cliente, además, maneja la gente de ese cliente:
// así el dueño de un negocio da de alta a sus empleados sin pedírselo a quien administra aiva. Los usuarios viven
// en un archivo junto a los clientes, con la clave guardada como hash (scrypt), nunca en claro.
//
// El CONSOLA_TOKEN sigue sirviendo como llave maestra del super-admin: es con lo que se entra la primera vez, antes
// de que exista un solo usuario, y la salida de emergencia si alguien pierde su clave.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { CLIENTES_DIR, leerIndice } from './clientes.js';

/**
 * - `super`: quien administra aiva. Ve todos los clientes, los da de alta y maneja a todo el equipo.
 * - `admin`: el admin de un cliente (el dueño, el gerente). Atiende sus clientes y maneja a la gente de ellos.
 * - `asesor`: atiende sus clientes y nada más; no ve el equipo.
 */
export type Rol = 'super' | 'admin' | 'asesor';

/**
 * 🪤 Antes de que existiera el admin de un cliente, el rol de quien atendía se llamaba `agente`, y quien lo tenía
 * podía hacer de todo en su cliente salvo manejar el equipo. Se lee como `admin` —así lo decidió el usuario el
 * 2026-10-16— para que nadie pierda nada al desplegar; el archivo queda con el nombre nuevo en la próxima escritura.
 */
function rolDe(rol: unknown, siFalta: Rol): Rol {
  if (rol === undefined || rol === null || rol === '') return siFalta;
  if (rol === 'agente') return 'admin';
  if (rol === 'super' || rol === 'admin' || rol === 'asesor') return rol;
  throw new Error('ese rol no existe');
}

export interface Usuario {
  usuario: string;
  nombre: string;
  /** Para saber a quién escribirle y, si alguien prefiere, para entrar con él en vez del usuario. */
  correo?: string;
  /** El color con el que se le reconoce en la consola. Sale de su nombre si no elige. */
  color?: string;
  /** El color de la consola que ve esta persona. Sin elegir, el azul de siempre, que no se guarda. */
  acento?: Acento;
  rol: Rol;
  /** Clientes que atiende. Vacío en un super-admin: los ve todos. */
  clientes: string[];
  activo: boolean;
  clave: string; // "sal:hash"
  desde: string;
}

/** Lo que se puede mostrar de un usuario: nunca la clave. */
export type UsuarioPublico = Omit<Usuario, 'clave'>;
export const sinClave = (u: Usuario): UsuarioPublico => {
  const { clave: _clave, ...resto } = u;
  return resto;
};

const ARCHIVO = () => join(CLIENTES_DIR, 'usuarios.json');

export function leerUsuarios(): Usuario[] {
  if (!existsSync(ARCHIVO())) return [];
  const usuarios = (JSON.parse(readFileSync(ARCHIVO(), 'utf8')) as { usuarios?: Usuario[] }).usuarios ?? [];
  // Un rol que no se entiende queda en lo que menos puede, en vez de tumbar la entrada de todos.
  return usuarios.map((u) => ({ ...u, rol: ['super', 'admin', 'asesor', 'agente'].includes(u.rol) ? rolDe(u.rol, 'asesor') : 'asesor' }));
}

function guardar(usuarios: Usuario[]) {
  mkdirSync(CLIENTES_DIR, { recursive: true });
  writeFileSync(ARCHIVO(), `${JSON.stringify({ usuarios }, null, 2)}\n`, { mode: 0o600 });
}

const hashear = (clave: string, sal = randomBytes(16).toString('hex')) => `${sal}:${scryptSync(clave, sal, 32).toString('hex')}`;

/**
 * Los colores con los que alguien se puede distinguir. Cerrada a propósito: una lista corta se reconoce de un
 * vistazo, y todos están medidos contra el papel de la consola.
 */
export const COLORES = ['#7b660f', '#2b5ea8', '#2c6b3f', '#a4231b', '#6b3fa0', '#0f6b73', '#8a5a08', '#4a4740'];

/** Si no eligió, uno estable sacado de su nombre: el mismo cada vez, sin guardar nada. */
export function colorDe(usuario: { usuario: string; color?: string }): string {
  if (usuario.color && COLORES.includes(usuario.color)) return usuario.color;
  let n = 0;
  for (const c of usuario.usuario) n = (n * 31 + c.charCodeAt(0)) % 100000;
  return COLORES[n % COLORES.length]!;
}

/**
 * Los colores que puede tener la consola de cada quien. Es preferencia de la persona, no del negocio: cambia lo que
 * ve ella y nada más. El verde agua de XENCRM («xen») es el de siempre y va primero; el azul, que lo fue en aiva,
 * queda como una opción más. Cada uno tiene su pintura en public/consola.html, y test:tablero falla si aquí
 * aparece uno que allá no esté pintado.
 */
export const ACENTOS = ['xen', 'azul', 'dorado', 'grafito', 'morado'] as const;
export type Acento = (typeof ACENTOS)[number];

/** El de siempre no se guarda: «no eligió» y «eligió el de siempre» son lo mismo, y así un cambio del de siempre los
 * alcanza. 🪤 Por eso quien en aiva tenía el azul (que no se guardaba) entra a XENCRM con el verde agua. */
const acentoLimpio = (acento: string | undefined): Acento | undefined => {
  const a = String(acento ?? '').trim();
  if (!a || a === 'xen') return undefined;
  if (!(ACENTOS as readonly string[]).includes(a)) throw new Error('ese color de consola no está en la lista');
  return a as Acento;
};

const colorLimpio = (color: string | undefined): string | undefined => {
  if (color === undefined) return undefined;
  const c = color.trim();
  if (!c) return '';
  if (!COLORES.includes(c)) throw new Error('ese color no está en la lista');
  return c;
};

/** Un correo con forma de correo, o vacío. No se comprueba que exista: eso lo dirá el primer mensaje. */
export function correoLimpio(correo: string | undefined, quien = ''): string {
  const c = (correo ?? '').trim().toLowerCase();
  if (!c) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c)) throw new Error('ese correo no tiene forma de correo');
  if (leerUsuarios().some((u) => u.correo === c && u.usuario !== quien)) throw new Error('ya hay alguien con ese correo');
  return c;
}
function coincide(clave: string, guardada: string): boolean {
  const [sal, hash] = guardada.split(':');
  if (!sal || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = scryptSync(clave, sal, 32);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Que no se asigne un cliente que no existe: así no nacen usuarios apuntando al aire. */
function comprobarClientes(slugs: string[]): string[] {
  const existen = new Set(leerIndice().map((c) => c.slug));
  const malos = slugs.filter((s) => !existen.has(s));
  if (malos.length) throw new Error(`no existe${malos.length === 1 ? ' el cliente' : 'n los clientes'}: ${malos.join(', ')}`);
  return slugs;
}

/** Crea a alguien del equipo. `clientes` vacío en un super-admin (los ve todos). Sin rol, asesor: lo que menos puede. */
export function crearUsuario(datos: { usuario: string; nombre?: string; correo?: string; color?: string; clave: string; rol?: Rol | 'agente'; clientes?: string[]; hoy?: string }): UsuarioPublico {
  const usuario = datos.usuario.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) throw new Error('el usuario va en minúsculas, de 3 a 30 letras o números');
  if (datos.clave.length < 8) throw new Error('la clave necesita al menos 8 caracteres');
  const usuarios = leerUsuarios();
  if (usuarios.some((u) => u.usuario === usuario)) throw new Error('ya existe alguien con ese usuario');
  const correo = correoLimpio(datos.correo);
  const color = colorLimpio(datos.color);
  const rol = rolDe(datos.rol, 'asesor');
  const nuevo: Usuario = {
    usuario,
    nombre: datos.nombre?.trim() || usuario,
    correo,
    color,
    rol,
    clientes: rol === 'super' ? [] : comprobarClientes(datos.clientes ?? []),
    activo: true,
    clave: hashear(datos.clave),
    desde: (datos.hoy ?? new Date().toISOString()).slice(0, 10),
  };
  guardar([...usuarios, nuevo]);
  return sinClave(nuevo);
}

/** Cambia lo que el super-admin puede cambiar: nombre, rol, clientes, si sigue activo y la clave. */
export function actualizarUsuario(usuario: string, cambios: Partial<Pick<Usuario, 'nombre' | 'correo' | 'color' | 'clientes' | 'activo'>> & { rol?: Rol | 'agente'; clave?: string }): UsuarioPublico {
  const usuarios = leerUsuarios();
  const i = usuarios.findIndex((u) => u.usuario === usuario);
  if (i === -1) throw new Error('ese usuario no existe');
  const actual = usuarios[i]!;
  if (cambios.clave !== undefined && cambios.clave.length < 8) throw new Error('la clave necesita al menos 8 caracteres');
  const rol = rolDe(cambios.rol, actual.rol);
  usuarios[i] = {
    ...actual,
    ...cambios,
    correo: cambios.correo === undefined ? actual.correo : correoLimpio(cambios.correo, usuario),
    color: cambios.color === undefined ? actual.color : colorLimpio(cambios.color),
    rol,
    clientes: rol === 'super' ? [] : comprobarClientes(cambios.clientes ?? actual.clientes),
    clave: cambios.clave ? hashear(cambios.clave) : actual.clave,
  };
  guardar(usuarios);
  return sinClave(usuarios[i]!);
}

/**
 * Lo que cada quien puede cambiar de sí mismo: su nombre, su correo, su color, el de su consola y su clave. La clave pide la actual, que si
 * no cualquiera que se siente en una sesión abierta se la cambia y deja al dueño afuera.
 *
 * El rol y los clientes NO se tocan aquí: eso lo decide el super-admin.
 */
export function cambiarLoMio(
  usuario: string,
  cambios: { nombre?: string; correo?: string; color?: string; acento?: string; claveActual?: string; claveNueva?: string },
): UsuarioPublico {
  const usuarios = leerUsuarios();
  const i = usuarios.findIndex((u) => u.usuario === usuario);
  if (i === -1) throw new Error('ese usuario no existe');
  const actual = usuarios[i]!;
  if (cambios.claveNueva !== undefined) {
    if (!coincide(cambios.claveActual ?? '', actual.clave)) throw new Error('la clave actual no es esa');
    if (cambios.claveNueva.length < 8) throw new Error('la clave nueva necesita al menos 8 caracteres');
  }
  const nombre = cambios.nombre === undefined ? actual.nombre : cambios.nombre.trim();
  if (!nombre) throw new Error('el nombre no puede quedar vacío');
  usuarios[i] = {
    ...actual,
    nombre,
    correo: cambios.correo === undefined ? actual.correo : correoLimpio(cambios.correo, usuario),
    color: cambios.color === undefined ? actual.color : colorLimpio(cambios.color),
    acento: cambios.acento === undefined ? actual.acento : acentoLimpio(cambios.acento),
    clave: cambios.claveNueva ? hashear(cambios.claveNueva) : actual.clave,
  };
  guardar(usuarios);
  return sinClave(usuarios[i]!);
}

export function borrarUsuario(usuario: string): boolean {
  const usuarios = leerUsuarios();
  const quedan = usuarios.filter((u) => u.usuario !== usuario);
  if (quedan.length === usuarios.length) return false;
  guardar(quedan);
  return true;
}

// ---------- El equipo, visto por quien lo maneja ----------
// `actor` null es la llave maestra, como en `alcanza`: entra como super-admin.

/** ¿Puede esta persona abrir Equipo? El super-admin y el admin de un cliente; el asesor, no. */
export const manejaEquipo = (actor: UsuarioPublico | null): boolean => !actor || actor.rol === 'super' || actor.rol === 'admin';

/**
 * ¿Puede `actor` cambiar a `objetivo`? El super-admin, a cualquiera. El admin de un cliente, solo a quien trabaja
 * **únicamente** en clientes suyos: alguien que además atiende a otro negocio no es suyo de manejar —cambiarle la
 * clave lo dejaría por fuera de un cliente ajeno—, y un super-admin tampoco.
 */
export function administra(actor: UsuarioPublico | null, objetivo: Pick<Usuario, 'rol' | 'clientes'>): boolean {
  if (!actor || actor.rol === 'super') return true;
  if (actor.rol !== 'admin') return false;
  return objetivo.rol !== 'super' && objetivo.clientes.length > 0 && objetivo.clientes.every((s) => actor.clientes.includes(s));
}

export type EnElEquipo = UsuarioPublico & { soloVer?: boolean };

/**
 * El equipo que ve `actor`. El super-admin, todo. El admin de un cliente ve a quien entra a sus clientes: a los
 * suyos enteros y a los demás —el super-admin, quien atiende además a otro negocio— solo por su nombre, para que
 * sepa quién más ve sus conversaciones.
 *
 * 🪤 De esos otros NO sale la lista entera de sus clientes: que DUNOR viera que alguien atiende también a CONFIA
 * le estaría contando quiénes más son clientes de aiva. Solo se le dice lo que tiene que ver con los suyos.
 */
export function equipoPara(actor: UsuarioPublico | null): EnElEquipo[] {
  const usuarios = leerUsuarios();
  if (!actor || actor.rol === 'super') return usuarios.map(sinClave);
  if (actor.rol !== 'admin') return [];
  const mios = (u: Usuario) => u.clientes.filter((s) => actor.clientes.includes(s));
  return usuarios
    .filter((u) => u.rol === 'super' || mios(u).length > 0)
    .map((u) =>
      administra(actor, u)
        ? sinClave(u)
        : { usuario: u.usuario, nombre: u.nombre, color: u.color, rol: u.rol, clientes: mios(u), activo: u.activo, desde: u.desde, soloVer: true },
    );
}

/** Que el admin de un cliente solo reparta clientes suyos, y al menos uno: alguien sin clientes se le perdería de vista. */
function clientesDelAdmin(actor: UsuarioPublico, clientes: string[]): string[] {
  if (!clientes.length) throw new Error('tiene que atender al menos uno de tus clientes');
  if (clientes.some((s) => !actor.clientes.includes(s))) throw new Error('solo puedes darle clientes que tú atiendes');
  return clientes;
}

/**
 * Crear a alguien en nombre de `actor`. El admin de un cliente crea asesores u otros admins de **sus** clientes;
 * un super-admin solo lo crea otro super-admin. Si no dice qué clientes, le quedan los mismos del admin.
 */
export function crearComo(actor: UsuarioPublico | null, datos: Parameters<typeof crearUsuario>[0]): UsuarioPublico {
  if (!manejaEquipo(actor)) throw new Error('el equipo lo maneja el admin de tu cliente');
  if (!actor || actor.rol === 'super') return crearUsuario(datos);
  const rol = rolDe(datos.rol, 'asesor');
  if (rol === 'super') throw new Error('un super-admin solo lo crea quien administra XENCRM');
  return crearUsuario({ ...datos, rol, clientes: clientesDelAdmin(actor, datos.clientes?.length ? datos.clientes : actor.clientes) });
}

/** Lo que el admin de un cliente le puede cambiar a su gente. Lo demás que venga en la petición se ignora. */
const CAMPOS_DEL_ADMIN = ['nombre', 'correo', 'color', 'rol', 'clientes', 'activo', 'clave'] as const;

/**
 * Cambiar a alguien en nombre de `actor`. A quien no es suyo, el admin de un cliente recibe «ese usuario no existe»,
 * lo mismo que si no existiera: así no se entera de quién trabaja en otros negocios.
 *
 * 🪤 Su propio rol, sus clientes y si sigue activo no se los cambia él mismo: un admin que se baja a asesor o se
 * desactiva deja a su negocio sin nadie que maneje el equipo, y de ahí solo lo saca quien administra aiva.
 */
export function actualizarComo(actor: UsuarioPublico | null, usuario: string, cambios: Record<string, unknown>): UsuarioPublico {
  if (!manejaEquipo(actor)) throw new Error('el equipo lo maneja el admin de tu cliente');
  if (!actor || actor.rol === 'super') return actualizarUsuario(usuario, cambios);
  const objetivo = leerUsuarios().find((u) => u.usuario === usuario);
  if (!objetivo || !administra(actor, objetivo)) throw new Error('ese usuario no existe');
  const limpios: Record<string, unknown> = {};
  for (const k of CAMPOS_DEL_ADMIN) if (cambios[k] !== undefined) limpios[k] = cambios[k];
  if (limpios.rol !== undefined && rolDe(limpios.rol, objetivo.rol) === 'super') throw new Error('un super-admin solo lo nombra quien administra XENCRM');
  if (usuario === actor.usuario && (limpios.rol !== undefined || limpios.clientes !== undefined || limpios.activo !== undefined)) {
    throw new Error('tu propio rol y tus clientes los cambia otro admin o quien administra XENCRM');
  }
  if (limpios.clientes !== undefined) limpios.clientes = clientesDelAdmin(actor, Array.isArray(limpios.clientes) ? (limpios.clientes as string[]) : []);
  return actualizarUsuario(usuario, limpios);
}

/** Quitar a alguien en nombre de `actor`. A sí mismo, nadie: se queda sin poder entrar a deshacerlo. */
export function borrarComo(actor: UsuarioPublico | null, usuario: string): boolean {
  if (!manejaEquipo(actor)) throw new Error('el equipo lo maneja el admin de tu cliente');
  if (!actor || actor.rol === 'super') return borrarUsuario(usuario);
  if (usuario === actor.usuario) throw new Error('no puedes quitarte a ti mismo');
  const objetivo = leerUsuarios().find((u) => u.usuario === usuario);
  if (!objetivo || !administra(actor, objetivo)) return false;
  return borrarUsuario(usuario);
}

/** Comprueba usuario y clave. Devuelve null si no coinciden o si está inactivo (sin decir cuál de las dos). */
export function verificar(usuario: string, clave: string): UsuarioPublico | null {
  const quien = usuario.trim().toLowerCase();
  const u = leerUsuarios().find((x) => x.usuario === quien || (Boolean(x.correo) && x.correo === quien));
  if (!u || !u.activo || !coincide(clave, u.clave)) return null;
  return sinClave(u);
}

// ---------- Sesiones (en memoria: si la consola se reinicia, se vuelve a entrar) ----------
const sesiones = new Map<string, { usuario: UsuarioPublico; hasta: number; maestra: boolean; sello: string }>();

/**
 * 🪤 Un resumen de la clave guardada, para que cambiarla cierre las sesiones que ya estaban abiertas. Sin esto,
 * a una cuenta que se filtró se le cambia la clave y el que entró **sigue adentro hasta doce horas**, que es
 * justo lo contrario de lo que uno cree que hizo al cambiarla. No guarda la clave: guarda su huella.
 */
const selloDe = (quien: string): string => {
  const u = leerUsuarios().find((x) => x.usuario === quien);
  return u ? createHash('sha256').update(u.clave).digest('hex').slice(0, 16) : '';
};
const DURACION = 12 * 3600_000;

/**
 * Abre sesión. `maestra` es la de quien entró con el CONSOLA_TOKEN: ese "usuario" no está en el archivo, así que
 * su sesión no se relee contra él —si no, se caería sola al primer uso—. Es la salida de emergencia.
 */
export function abrirSesion(usuario: UsuarioPublico, now = Date.now(), maestra = false): string {
  const token = randomBytes(24).toString('hex');
  sesiones.set(token, { usuario, hasta: now + DURACION, maestra, sello: maestra ? '' : selloDe(usuario.usuario) });
  return token;
}

export function sesionDe(token: string | undefined, now = Date.now()): UsuarioPublico | null {
  if (!token) return null;
  const s = sesiones.get(token);
  if (!s) return null;
  if (s.hasta < now) {
    sesiones.delete(token);
    return null;
  }
  if (s.maestra) return s.usuario; // no está en el archivo: no hay nada que releer
  // Se relee por si le cambiaron el rol o los clientes mientras estaba adentro.
  const fresco = leerUsuarios().find((u) => u.usuario === s.usuario.usuario);
  if (!fresco || !fresco.activo) {
    sesiones.delete(token);
    return null;
  }
  // Le cambiaron la clave mientras estaba adentro: esta sesión es de antes y ya no vale.
  if (createHash('sha256').update(fresco.clave).digest('hex').slice(0, 16) !== s.sello) {
    sesiones.delete(token);
    return null;
  }
  return sinClave(fresco);
}

export function cerrarSesion(token: string | undefined) {
  if (token) sesiones.delete(token);
}

/**
 * Un cliente que se da de baja no puede dejar usuarios apuntándolo. Se les quita de su lista y, si alguien que
 * atiende se queda **sin ningún cliente**, se desactiva: no tendría nada que ver al entrar, y así el super-admin
 * lo ve en Equipo y decide si lo reasigna o lo quita. A un super-admin no se le toca: su lista vacía significa
 * "todos", no "ninguno".
 */
export function quitarClienteDeUsuarios(slug: string): { tocados: string[]; desactivados: string[] } {
  const usuarios = leerUsuarios();
  const tocados: string[] = [];
  const desactivados: string[] = [];
  const nuevos = usuarios.map((u) => {
    if (u.rol === 'super' || !u.clientes.includes(slug)) return u;
    const clientes = u.clientes.filter((c) => c !== slug);
    tocados.push(u.usuario);
    if (!clientes.length && u.activo) desactivados.push(u.usuario);
    return { ...u, clientes, activo: clientes.length ? u.activo : false };
  });
  if (tocados.length) guardar(nuevos);
  return { tocados, desactivados };
}

/** Quien atiende y se quedó sin clientes: no puede hacer nada hasta que le asignen uno. */
export function usuariosSinClientes(): UsuarioPublico[] {
  return leerUsuarios()
    .filter((u) => u.rol !== 'super' && !u.clientes.length)
    .map(sinClave);
}

/** ¿Este usuario puede ver este cliente? El super-admin, todos. */
export const alcanza = (usuario: UsuarioPublico | null, slug: string): boolean =>
  !usuario || usuario.rol === 'super' || usuario.clientes.includes(slug);
