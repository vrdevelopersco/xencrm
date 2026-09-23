// Quién entra a la consola y qué ve. El super-admin ve y atiende todos los clientes; a quien atiende un cliente
// solo le aparece —y le suena— lo de ese cliente. Los usuarios viven en un archivo junto a los clientes, con la
// clave guardada como hash (scrypt), nunca en claro.
//
// El CONSOLA_TOKEN sigue sirviendo como llave maestra del super-admin: es con lo que se entra la primera vez, antes
// de que exista un solo usuario, y la salida de emergencia si alguien pierde su clave.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { CLIENTES_DIR } from './clientes.js';

export type Rol = 'super' | 'agente';

export interface Usuario {
  usuario: string;
  nombre: string;
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
  return (JSON.parse(readFileSync(ARCHIVO(), 'utf8')) as { usuarios?: Usuario[] }).usuarios ?? [];
}

function guardar(usuarios: Usuario[]) {
  mkdirSync(CLIENTES_DIR, { recursive: true });
  writeFileSync(ARCHIVO(), `${JSON.stringify({ usuarios }, null, 2)}\n`, { mode: 0o600 });
}

const hashear = (clave: string, sal = randomBytes(16).toString('hex')) => `${sal}:${scryptSync(clave, sal, 32).toString('hex')}`;
function coincide(clave: string, guardada: string): boolean {
  const [sal, hash] = guardada.split(':');
  if (!sal || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = scryptSync(clave, sal, 32);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Crea a alguien del equipo. `clientes` vacío en un super-admin (los ve todos). */
export function crearUsuario(datos: { usuario: string; nombre?: string; clave: string; rol?: Rol; clientes?: string[]; hoy?: string }): UsuarioPublico {
  const usuario = datos.usuario.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) throw new Error('el usuario va en minúsculas, de 3 a 30 letras o números');
  if (datos.clave.length < 8) throw new Error('la clave necesita al menos 8 caracteres');
  const usuarios = leerUsuarios();
  if (usuarios.some((u) => u.usuario === usuario)) throw new Error('ya existe alguien con ese usuario');
  const nuevo: Usuario = {
    usuario,
    nombre: datos.nombre?.trim() || usuario,
    rol: datos.rol ?? 'agente',
    clientes: datos.rol === 'super' ? [] : (datos.clientes ?? []),
    activo: true,
    clave: hashear(datos.clave),
    desde: (datos.hoy ?? new Date().toISOString()).slice(0, 10),
  };
  guardar([...usuarios, nuevo]);
  return sinClave(nuevo);
}

/** Cambia lo que el super-admin puede cambiar: nombre, rol, clientes, si sigue activo y la clave. */
export function actualizarUsuario(usuario: string, cambios: Partial<Pick<Usuario, 'nombre' | 'rol' | 'clientes' | 'activo'>> & { clave?: string }): UsuarioPublico {
  const usuarios = leerUsuarios();
  const i = usuarios.findIndex((u) => u.usuario === usuario);
  if (i === -1) throw new Error('ese usuario no existe');
  const actual = usuarios[i]!;
  if (cambios.clave !== undefined && cambios.clave.length < 8) throw new Error('la clave necesita al menos 8 caracteres');
  const rol = cambios.rol ?? actual.rol;
  usuarios[i] = {
    ...actual,
    ...cambios,
    rol,
    clientes: rol === 'super' ? [] : (cambios.clientes ?? actual.clientes),
    clave: cambios.clave ? hashear(cambios.clave) : actual.clave,
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

/** Comprueba usuario y clave. Devuelve null si no coinciden o si está inactivo (sin decir cuál de las dos). */
export function verificar(usuario: string, clave: string): UsuarioPublico | null {
  const u = leerUsuarios().find((x) => x.usuario === usuario.trim().toLowerCase());
  if (!u || !u.activo || !coincide(clave, u.clave)) return null;
  return sinClave(u);
}

// ---------- Sesiones (en memoria: si la consola se reinicia, se vuelve a entrar) ----------
const sesiones = new Map<string, { usuario: UsuarioPublico; hasta: number }>();
const DURACION = 12 * 3600_000;

export function abrirSesion(usuario: UsuarioPublico, now = Date.now()): string {
  const token = randomBytes(24).toString('hex');
  sesiones.set(token, { usuario, hasta: now + DURACION });
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
  // Se relee por si le cambiaron el rol o los clientes mientras estaba adentro.
  const fresco = leerUsuarios().find((u) => u.usuario === s.usuario.usuario);
  if (!fresco || !fresco.activo) {
    sesiones.delete(token);
    return null;
  }
  return sinClave(fresco);
}

export function cerrarSesion(token: string | undefined) {
  if (token) sesiones.delete(token);
}

/** ¿Este usuario puede ver este cliente? El super-admin, todos. */
export const alcanza = (usuario: UsuarioPublico | null, slug: string): boolean =>
  !usuario || usuario.rol === 'super' || usuario.clientes.includes(slug);
