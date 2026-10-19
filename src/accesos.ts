/**
 * La bitácora de accesos de la consola: quién entró, quién falló al intentarlo, quién abrió qué tablero y qué se
 * le hizo a cada cuenta. Una línea JSON por cosa, en `accesos.jsonl`, junto a `usuarios.json`.
 *
 * Nació el 2026-10-19: el usuario le pasó su acceso a DUNOR y no había forma de saber si habían entrado, si lo
 * intentaron y fallaron o si ni lo habían tocado. Las sesiones viven en memoria y los fallos también (son el freno
 * contra quien prueba claves), así que de un ingreso no quedaba nada. Se lee en `/_salud` con su token
 * (`pnpm salud`), sin entrar a la consola.
 *
 * Tres reglas, y las tres se prueban (`test:accesos`):
 * 1. **Anotar nunca tumba nada.** Si el disco no deja, se dice en el registro y se sigue: un login que falla porque
 *    no se pudo escribir la bitácora es peor que no tener bitácora.
 * 2. **Ninguna clave entra aquí**, ni la buena ni la mala. Y lo que se escribió como usuario tampoco, si no es una
 *    cuenta que exista: es justo donde la gente pega la clave por error. Se guarda tapado (`du…(9)`).
 * 3. **No crece sin fin.** Pasando de un mega se queda con las últimas líneas.
 */
import { appendFileSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const ARCHIVO_ACCESOS = 'accesos.jsonl';

export type TipoAcceso = 'entro' | 'fallo' | 'frenado' | 'salio' | 'tablero' | 'cuenta';

export interface Acceso {
  cuando: string;
  tipo: TipoAcceso;
  /** De quién se habla: quien entró, quien falló (tapado si no existe), a quién le cambiaron la cuenta. */
  usuario: string;
  rol?: string;
  /** Por qué falló: «clave equivocada», «cuenta desactivada» o «usuario que no existe». */
  motivo?: string;
  /** Para `cuenta`: quién lo hizo. */
  por?: string;
  /** Para `cuenta`: qué se hizo, sin valores secretos («clave nueva», «rol: asesor»). */
  que?: string;
  /** Para `tablero`: de qué cliente. */
  cliente?: string;
  ip?: string;
  navegador?: string;
}

const TOPE_BYTES = 1_000_000;
const QUEDAN = 2000;

export const rutaAccesos = (dir: string): string => join(dir, ARCHIVO_ACCESOS);

/** Lo que alguien escribió como usuario y no es de nadie: tapado, porque a veces es la clave pegada donde no era. */
export function tapado(escrito: string): string {
  const s = String(escrito ?? '').trim();
  if (!s) return '(vacío)';
  return `${s.slice(0, 2)}…(${s.length})`;
}

/** «Chrome · Windows», «Safari · iPhone». Lo justo para reconocer desde dónde, sin guardar la huella entera. */
export function navegadorDe(ua: string | undefined): string {
  const s = String(ua ?? '');
  if (!s) return '';
  const sistema = /iPhone/.test(s) ? 'iPhone' : /iPad/.test(s) ? 'iPad' : /Android/.test(s) ? 'Android'
    : /Windows/.test(s) ? 'Windows' : /Mac OS X|Macintosh/.test(s) ? 'Mac' : /Linux/.test(s) ? 'Linux' : '';
  const nav = /Edg\//.test(s) ? 'Edge' : /OPR\//.test(s) ? 'Opera' : /SamsungBrowser/.test(s) ? 'Samsung'
    : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) || /CriOS/.test(s) ? 'Chrome'
    : /Safari\//.test(s) ? 'Safari' : /curl|node|undici|python|Go-http/i.test(s) ? 'programa' : 'otro';
  return sistema ? `${nav} · ${sistema}` : nav;
}

/** Anota una línea. Nunca lanza: si no se pudo, lo dice en el registro del proceso y ya. */
export function anotarAcceso(dir: string, e: Omit<Acceso, 'cuando'>, ahora = new Date(), tope = TOPE_BYTES): void {
  try {
    const ruta = rutaAccesos(dir);
    const limpio: Record<string, unknown> = { cuando: ahora.toISOString() };
    for (const [k, v] of Object.entries(e)) if (v !== undefined && v !== '') limpio[k] = typeof v === 'string' ? v.slice(0, 200) : v;
    appendFileSync(ruta, `${JSON.stringify(limpio)}\n`, { mode: 0o600 });
    if (statSync(ruta).size > tope) recortar(ruta);
  } catch (err) {
    console.error('[accesos] no pude anotar:', (err as Error).message);
  }
}

function recortar(ruta: string): void {
  const lineas = readFileSync(ruta, 'utf8').split('\n').filter(Boolean);
  const temporal = `${ruta}.recorte`;
  writeFileSync(temporal, `${lineas.slice(-QUEDAN).join('\n')}\n`, { mode: 0o600 });
  renameSync(temporal, ruta); // de un golpe: quien lea en ese momento ve el archivo viejo o el nuevo, nunca medio
}

/** Todas las líneas que se puedan leer, de la más vieja a la más nueva. Una línea rota se salta, no tumba el resto. */
export function leerAccesos(dir: string): Acceso[] {
  let texto = '';
  try { texto = readFileSync(rutaAccesos(dir), 'utf8'); } catch { return []; }
  const salen: Acceso[] = [];
  for (const linea of texto.split('\n')) {
    if (!linea.trim()) continue;
    try { salen.push(JSON.parse(linea) as Acceso); } catch { /* una línea a medio escribir: se salta */ }
  }
  return salen;
}

export interface ResumenDeUsuario {
  usuario: string;
  ultimoIngreso: string | null;
  ingresos: number;
  /** Fallos después de su último ingreso (o todos, si nunca ha entrado): si sube, alguien no está atinando. */
  fallosDesdeUltimoIngreso: number;
  ultimoFallo: string | null;
  ultimoMotivo: string | null;
  ultimoTablero: string | null;
  desde: string | null;
}

/** Por cada quien, lo que se viene a preguntar: si entró, cuándo, y si está fallando. Los que más recientes, arriba. */
export function resumenPorUsuario(eventos: Acceso[]): ResumenDeUsuario[] {
  const por = new Map<string, ResumenDeUsuario>();
  const de = (u: string) => {
    let r = por.get(u);
    if (!r) por.set(u, (r = { usuario: u, ultimoIngreso: null, ingresos: 0, fallosDesdeUltimoIngreso: 0, ultimoFallo: null, ultimoMotivo: null, ultimoTablero: null, desde: null }));
    return r;
  };
  for (const e of eventos) {
    if (e.tipo === 'cuenta') continue; // lo que le hicieron a la cuenta no es actividad de esa persona
    const r = de(e.usuario);
    r.desde ??= e.cuando;
    if (e.tipo === 'entro') { r.ultimoIngreso = e.cuando; r.ingresos++; r.fallosDesdeUltimoIngreso = 0; }
    if (e.tipo === 'fallo' || e.tipo === 'frenado') { r.ultimoFallo = e.cuando; r.ultimoMotivo = e.motivo ?? e.tipo; r.fallosDesdeUltimoIngreso++; }
    if (e.tipo === 'tablero') r.ultimoTablero = e.cuando;
  }
  const ultimaVez = (r: ResumenDeUsuario) => [r.ultimoIngreso, r.ultimoFallo, r.ultimoTablero].filter(Boolean).sort().pop() ?? '';
  return [...por.values()].sort((a, b) => ultimaVez(b).localeCompare(ultimaVez(a)));
}

/** Lo que ve `/_salud` con su token: el resumen y las últimas líneas, de la más nueva a la más vieja. */
export function accesosParaSalud(dir: string, opciones: { n?: number; usuario?: string } = {}): {
  porUsuario: ResumenDeUsuario[]; ultimos: Acceso[]; total: number;
} {
  const n = Math.min(Math.max(Number(opciones.n) || 100, 1), QUEDAN);
  const quien = String(opciones.usuario ?? '').trim().toLowerCase();
  const todos = leerAccesos(dir);
  const suyos = quien ? todos.filter((e) => e.usuario === quien || e.por === quien) : todos;
  return { porUsuario: resumenPorUsuario(suyos), ultimos: suyos.slice(-n).reverse(), total: suyos.length };
}
