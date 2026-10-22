// El tope de gasto de IA de cada cliente: cuánto puede costar al mes, y qué pasa al acercarse.
//
// Hasta ahora el gasto se medía —cada llamada queda en `llm_usage` con su costo— pero nada lo frenaba. Un mes con
// mucho movimiento, o alguien que se pone a escribirle al asistente sin parar para hacerlo gastar, y la factura
// llegaba al final, cuando ya no había nada que hacer. Quien pone su propia llave de OpenAI pregunta esto antes que
// cualquier otra cosa: «¿y si se me dispara?».
//
// Tres escalones, y ninguno deja a un cliente sin atender:
//
//   80 %   aviso: la campana del tablero, la consola y, si hay a quién, un WhatsApp al equipo.
//   90 %   ahorro: lo específico lo contesta el modelo de responder, que es el barato.
//   100 %  se acabó: aiva deja de llamar a la IA de pago hasta el mes siguiente o hasta que se suba el tope. Lo que
//          se resuelve sin IA sigue —citas, pedir una persona, respuestas rápidas— y lo demás pasa al equipo, con
//          aviso al cliente. Si hay un motor en la máquina (Ollama, Apple), sigue contestando ese, que no cuesta.
//
// 🪤 Mes calendario en la zona horaria del negocio, no «últimos 30 días»: así factura OpenAI y así piensa quien
// paga. Con una ventana móvil, lo gastado hace 29 días saldría de la cuenta a una hora cualquiera y el asistente
// volvería a contestar a mitad de una tarde sin que nadie hubiera subido nada.
//
// 🪤 Solo se cuenta y se corta lo que cuesta, que es OpenAI y Claude (el respaldo). Ollama y Apple corren en la
// máquina y no tienen tope. Lo que gasta Claude cuenta en el mismo tope: un respaldo que no lo respetara sería la
// forma de saltárselo justo el mes en que OpenAI falla.
import { business } from '../config.js';
import { getDb } from '../rag/store.js';
import { costUsd } from '../llm/usage.js';
import { getSetting, setSetting } from './settings.js';
import { emitEvent } from './events.js';

export type Nivel = 'sin_tope' | 'normal' | 'aviso' | 'ahorro' | 'agotado';

/** Desde qué fracción del tope empieza cada escalón. */
export const UMBRALES = { aviso: 0.8, ahorro: 0.9, agotado: 1 } as const;

export interface Presupuesto {
  /** USD al mes; null = sin tope. */
  tope: number | null;
  /** USD gastados desde el día 1 del mes, en la hora del negocio. */
  gastado: number;
  /** Lo gastado sobre el tope, redondeado; null sin tope. */
  porcentaje: number | null;
  nivel: Nivel;
  /** Dónde empieza y dónde acaba el mes que se está contando (ms). */
  desde: number;
  hasta: number;
  /** Se usó algún modelo sin tarifa conocida: lo gastado se queda corto y conviene decirlo. */
  sinPrecio: boolean;
}

/** Lo que se dice cuando se llega al tope y una llamada a la IA de pago no se hace. */
export class TopeAlcanzado extends Error {
  constructor() {
    super('se llegó al tope de gasto de IA de este mes');
  }
}

const CLAVE = 'presupuesto.topeUsdMes';
const AVISADO = 'presupuesto.avisado';

/** El tope en USD al mes: el que se puso desde la consola o, si nunca se puso, `TOPE_USD_MES` del `.env`. */
export function topeUsdMes(): number | null {
  const guardado = getSetting<number | null | undefined>(CLAVE, undefined);
  const v = guardado === undefined ? Number(process.env.TOPE_USD_MES || 0) : Number(guardado ?? 0);
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null;
}

/**
 * Pone el tope (USD al mes). Vacío, null o 0 lo quita. Se aplica al instante: no hace falta reiniciar.
 *
 * 🪤 Quitarlo se guarda como 0 y no se borra: borrado, volvería a valer el `TOPE_USD_MES` del `.env`, y quien lo
 * quitó desde la consola vería reaparecer un tope que creía haber quitado.
 */
export function ponerTope(usd: number | string | null): Presupuesto {
  const n = usd === null || usd === '' ? 0 : Number(String(usd).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) throw new Error('el tope es una cantidad de dólares, como 20 o 12.50');
  if (n > 100_000) throw new Error('ese tope es más de lo que gasta cualquier cliente en un año: revisa la cifra');
  setSetting(CLAVE, Math.round(n * 100) / 100);
  cache = null;
  return presupuesto();
}

// ---------- El mes, en la hora del negocio ----------
function partes(ms: number): { y: number; m: number; d: number; hh: number; mm: number } {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: business.timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms));
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return { y: get('year'), m: get('month'), d: get('day'), hh: get('hour'), mm: get('minute') };
}
/** El instante en que empieza el día 1 de ese mes, a medianoche en la hora del negocio. */
function inicioDeMes(y: number, m: number): number {
  const guess = Date.UTC(y, m - 1, 1, 0, 0);
  const p = partes(guess);
  return guess - (Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm) - guess);
}
export function mesDe(ahora: number): { desde: number; hasta: number; clave: string } {
  const { y, m } = partes(ahora);
  return { desde: inicioDeMes(y, m), hasta: m === 12 ? inicioDeMes(y + 1, 1) : inicioDeMes(y, m + 1), clave: `${y}-${String(m).padStart(2, '0')}` };
}

// ---------- Lo gastado ----------
function gastadoEntre(desde: number, hasta: number): { usd: number; sinPrecio: boolean } {
  const filas = getDb()
    .prepare(
      `SELECT engine, model, SUM(input_tokens) entrada, SUM(cached_tokens) cache, SUM(COALESCE(cache_write_tokens, 0)) guardados, SUM(output_tokens) salida,
              SUM(COALESCE(segundos, 0)) segundos
       FROM llm_usage WHERE ts >= ? AND ts < ? GROUP BY engine, model`,
    )
    .all(desde, hasta) as { engine: string; model: string; entrada: number; cache: number; guardados: number; salida: number; segundos: number }[];
  let usd = 0;
  let sinPrecio = false;
  for (const f of filas) {
    const c = costUsd(f.engine, f.model, f.entrada, f.cache, f.salida, f.segundos, f.guardados);
    if (c === null) sinPrecio = true;
    else usd += c;
  }
  return { usd, sinPrecio };
}

const nivelDe = (tope: number | null, gastado: number): Nivel => {
  if (tope === null) return 'sin_tope';
  const f = gastado / tope;
  return f >= UMBRALES.agotado ? 'agotado' : f >= UMBRALES.ahorro ? 'ahorro' : f >= UMBRALES.aviso ? 'aviso' : 'normal';
};

// Se consulta antes de cada llamada a un modelo: una consulta agrupada por mes es barata, pero no tanto como para
// repetirla varias veces por mensaje. Diez segundos de margen son, como mucho, unas pocas llamadas de más.
const VIGENCIA_MS = 10_000;
let cache: { en: number; p: Presupuesto } | null = null;

/** Cómo va el mes. `ahora` es para las pruebas: con él no se usa lo guardado. */
export function presupuesto(ahora?: number): Presupuesto {
  const t = ahora ?? Date.now();
  if (ahora === undefined && cache && t - cache.en < VIGENCIA_MS) return cache.p;
  const { desde, hasta, clave } = mesDe(t);
  const tope = topeUsdMes();
  const { usd, sinPrecio } = gastadoEntre(desde, hasta);
  const gastado = Math.round(usd * 10_000) / 10_000;
  const p: Presupuesto = {
    tope,
    gastado,
    porcentaje: tope === null ? null : Math.round((gastado / tope) * 100),
    nivel: nivelDe(tope, gastado),
    desde,
    hasta,
    sinPrecio,
  };
  if (ahora === undefined) cache = { en: t, p };
  avisarSiSubio(p, clave);
  return p;
}

// Se preguntan antes de cada llamada a un modelo. Sin tope no hay nada que sumar: se contesta sin mirar el gasto.
/** Lo específico baja al modelo barato. */
export const enAhorro = (): boolean => topeUsdMes() !== null && ['ahorro', 'agotado'].includes(presupuesto().nivel);
/** No se llama a la IA de pago. */
export const agotado = (): boolean => topeUsdMes() !== null && presupuesto().nivel === 'agotado';

// ---------- Avisos ----------
const ORDEN: Nivel[] = ['sin_tope', 'normal', 'aviso', 'ahorro', 'agotado'];

/**
 * Avisa una vez por escalón y por mes, cuando se sube. 🪤 Se anota en la base y no en memoria: un reinicio no
 * puede volver a mandar el WhatsApp de «van en el 80 %» a todo el equipo. Bajar —porque subieron el tope— no
 * avisa; volver a subir en el mismo mes al mismo escalón, tampoco.
 */
function avisarSiSubio(p: Presupuesto, mes: string): void {
  if (p.tope === null || ORDEN.indexOf(p.nivel) < ORDEN.indexOf('aviso')) return;
  const ya = getSetting<string>(AVISADO, '');
  const [mesAvisado, nivelAvisado] = ya.split(':');
  if (mesAvisado === mes && ORDEN.indexOf(nivelAvisado as Nivel) >= ORDEN.indexOf(p.nivel)) return;
  setSetting(AVISADO, `${mes}:${p.nivel}`);
  emitEvent('presupuesto', 'system', { nivel: p.nivel, gastado: p.gastado, tope: p.tope, porcentaje: p.porcentaje, texto: textoDelAviso(p) });
}

const usd = (n: number) => `$${n.toFixed(2)}`;

/** Lo que se le dice al equipo en cada escalón. Sale igual por la campana y por WhatsApp. */
export function textoDelAviso(p: Presupuesto): string {
  const cuanto = `${business.business.name} lleva ${usd(p.gastado)} de IA este mes, el ${p.porcentaje} % del tope de ${usd(p.tope ?? 0)}.`;
  if (p.nivel === 'agotado')
    return `${cuanto} Desde ahora aiva no usa la IA de pago hasta el mes siguiente o hasta que se suba el tope: lo que se resuelve sin IA sigue, y lo demás le llega al equipo para contestar a mano.`;
  if (p.nivel === 'ahorro') return `${cuanto} Para estirar lo que queda, lo específico lo contesta el modelo de responder, que es el barato.`;
  return `${cuanto} Todavía no cambia nada; al 90 % empieza a ahorrar y al 100 % deja de usar la IA de pago.`;
}

/** Para las pruebas: olvidar lo calculado. */
export function olvidarPresupuesto(): void {
  cache = null;
}
