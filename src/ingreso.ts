// 🪤 El freno para quien prueba claves a ciegas en la puerta de la consola.
//
// Esta puerta abre la consola, y la consola alcanza el tablero de TODOS los clientes: sin freno, la única defensa
// sería la longitud de la clave, y en un rato se prueban miles. Tres barreras, porque ninguna sirve sola (estándar
// de seguridad, ~/proyectos/AUDITORIA-SEGURIDAD.md, sección C) y el hueco está justo en medio:
//
//   - Por DIRECCIÓN: 10 fallos en 15 minutos. Frena a quien martillea desde una conexión.
//   - Por dirección Y CUENTA: 5 fallos en un minuto. Es la que falta siempre: el cupo por dirección deja repartir
//     sus diez intentos entre cuentas distintas, y el bloqueo de la cuenta llega tarde para quien insiste sobre
//     una sola desde una sola conexión.
//   - Por CUENTA, con espera creciente: cada 5 fallos seguidos, 1, 5, 15 y 60 minutos. Frena a quien cambia de
//     dirección contra una misma cuenta. Una espera fija es un peaje conocido —quien automatiza espera y sigue—;
//     creciendo, insistir se encarece, y a quien solo tuvo un mal día apenas lo roza.
//
// Reglas que acompañan:
//   - Entrar bien pone a cero la cuenta, su historial de bloqueos incluido. La dirección NO: quien tiene una cuenta
//     propia no puede usarla para borrarse los fallos que lleva contra las de otros.
//   - El bloqueo se levanta solo. Si hubiera que desbloquear a mano, cualquiera que sepa un usuario dejaría a esa
//     persona por fuera hasta que alguien contestara el teléfono.
//   - La llave maestra no se bloquea por cuenta: es la salida de emergencia, y si un desconocido la pudiera cerrar
//     insistiendo, también cerraría la única forma de entrar a arreglarlo. La frenan las otras dos.
//   - 🪤 Vive en DISCO, no en memoria. Cada despliegue reinicia el proceso, y un contador en memoria le regalaba
//     borrón y cuenta nueva a quien supiera esperar a la próxima actualización.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLIENTES_DIR } from './clientes.js';

const MIN = 60_000;
const POR_DIRECCION = { fallos: 10, ventana: 15 * MIN };
const POR_DIRECCION_Y_CUENTA = { fallos: 5, ventana: MIN };
const SEGUIDOS_PARA_BLOQUEAR = 5;
const ESPERAS = [1, 5, 15, 60].map((m) => m * MIN);
/** Lo que no se ha movido en un día se olvida: cinco errores repartidos en un año no son un ataque. */
const OLVIDO = 24 * 60 * MIN;
/** Tope de llaves guardadas: quien rocía usuarios inventados no puede llenar el disco. */
const TOPE = 5000;
const MAESTRA = 'maestra';

interface Ventana {
  n: number;
  hasta: number;
}
interface Cuenta {
  seguidos: number;
  bloqueos: number;
  hasta: number;
  ultimo: number;
}
interface Estado {
  ventanas: Record<string, Ventana>;
  cuentas: Record<string, Cuenta>;
}

const archivo = () => join(CLIENTES_DIR, 'ingreso.json');
let estado: Estado | null = null;

function leer(): Estado {
  if (estado) return estado;
  estado = { ventanas: {}, cuentas: {} };
  try {
    if (existsSync(archivo())) {
      const d = JSON.parse(readFileSync(archivo(), 'utf8')) as Partial<Estado>;
      estado = { ventanas: d.ventanas ?? {}, cuentas: d.cuentas ?? {} };
    }
  } catch (err) {
    // Un archivo roto no puede dejar a nadie sin entrar: se empieza de cero y se dice.
    console.error('[consola] no pude leer el freno de intentos, empiezo de cero:', (err as Error).message);
  }
  return estado;
}

function guardar(now: number): void {
  const e = leer();
  for (const [k, v] of Object.entries(e.ventanas)) if (v.hasta < now) delete e.ventanas[k];
  for (const [k, v] of Object.entries(e.cuentas)) if (v.hasta < now && now - v.ultimo > OLVIDO) delete e.cuentas[k];
  const sobran = (o: Record<string, unknown>, cuando: (k: string) => number) => {
    const llaves = Object.keys(o);
    if (llaves.length > TOPE) llaves.sort((a, b) => cuando(a) - cuando(b)).slice(0, llaves.length - TOPE).forEach((k) => delete o[k]);
  };
  sobran(e.ventanas, (k) => e.ventanas[k]!.hasta);
  sobran(e.cuentas, (k) => e.cuentas[k]!.ultimo);
  try {
    const tmp = `${archivo()}.tmp`;
    writeFileSync(tmp, JSON.stringify(e), { mode: 0o600 });
    renameSync(tmp, archivo());
  } catch (err) {
    // Si no se puede escribir, el freno sigue en memoria: pierde el reinicio, no la puerta.
    console.error('[consola] no pude guardar el freno de intentos:', (err as Error).message);
  }
}

const limpia = (cuenta: string) => String(cuenta ?? '').trim().toLowerCase().slice(0, 64);
const llaves = (ip: string, cuenta: string) => ({ d: `d:${ip}`, p: `p:${ip}|${limpia(cuenta)}`, u: limpia(cuenta) });

/** Si está frenado, hasta cuándo. Null si puede intentar. */
export function frenoDelIngreso(ip: string, cuenta: string, now = Date.now()): { hasta: number; motivo: string } | null {
  const e = leer();
  const k = llaves(ip, cuenta);
  const d = e.ventanas[k.d];
  if (d && d.hasta > now && d.n >= POR_DIRECCION.fallos) return { hasta: d.hasta, motivo: 'demasiados intentos desde esa dirección' };
  const p = e.ventanas[k.p];
  if (p && p.hasta > now && p.n >= POR_DIRECCION_Y_CUENTA.fallos) return { hasta: p.hasta, motivo: 'demasiados intentos sobre esa cuenta' };
  const u = k.u && k.u !== MAESTRA ? e.cuentas[k.u] : undefined;
  if (u && u.hasta > now) return { hasta: u.hasta, motivo: 'cuenta bloqueada un rato' };
  return null;
}

/**
 * Un intento fallido. Devuelve los minutos de bloqueo si con este la cuenta quedó bloqueada (para anotarlo en la
 * bitácora: un bloqueo es un hecho de seguridad, no solo una línea en el registro del servidor).
 */
export function anotarFalloDeIngreso(ip: string, cuenta: string, now = Date.now()): { bloqueadaMin?: number } {
  const e = leer();
  const k = llaves(ip, cuenta);
  const sumar = (llave: string, regla: { ventana: number }) => {
    const v = e.ventanas[llave];
    if (!v || v.hasta < now) e.ventanas[llave] = { n: 1, hasta: now + regla.ventana };
    else v.n++;
  };
  sumar(k.d, POR_DIRECCION);
  sumar(k.p, POR_DIRECCION_Y_CUENTA);
  let bloqueadaMin: number | undefined;
  if (k.u && k.u !== MAESTRA) {
    const u = e.cuentas[k.u] && now - e.cuentas[k.u]!.ultimo <= OLVIDO ? e.cuentas[k.u]! : { seguidos: 0, bloqueos: 0, hasta: 0, ultimo: now };
    u.seguidos++;
    u.ultimo = now;
    if (u.seguidos >= SEGUIDOS_PARA_BLOQUEAR) {
      const espera = ESPERAS[Math.min(u.bloqueos, ESPERAS.length - 1)]!;
      u.bloqueos++;
      u.seguidos = 0;
      u.hasta = now + espera;
      bloqueadaMin = espera / MIN;
    }
    e.cuentas[k.u] = u;
  }
  guardar(now);
  return { bloqueadaMin };
}

/** Entró bien: la cuenta vuelve a cero, bloqueos incluidos. La dirección no (ver arriba). */
export function entroBien(ip: string, cuenta: string, now = Date.now()): void {
  const e = leer();
  const k = llaves(ip, cuenta);
  delete e.ventanas[k.p];
  delete e.cuentas[k.u];
  guardar(now);
}

/**
 * Lo que se le dice a quien está frenado, y los segundos para `Retry-After`.
 *
 * 🪤 Los dos dicen lo MISMO: una persona lee el texto y un programa la cabecera, y si no cuadran uno de los dos
 * vuelve antes de tiempo y se come otro rechazo sin entender por qué. Por eso los segundos son los minutos del
 * texto, redondeados hacia arriba, y no el resto exacto.
 */
export function avisoDeFreno(hasta: number, now = Date.now()): { texto: string; segundos: number } {
  const minutos = Math.max(1, Math.ceil((hasta - now) / MIN));
  return { texto: `Demasiados intentos. Espera ${minutos === 1 ? 'un minuto' : `${minutos} minutos`} y vuelve a intentar.`, segundos: minutos * 60 };
}

/** Para las pruebas: olvidar lo leído y empezar de cero en la carpeta que toque. */
export function olvidarFrenoEnMemoria(): void {
  estado = null;
}
