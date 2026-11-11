// Las reglas y umbrales de XENCRM: todo número, plazo o tope que decide algo de negocio, en un solo registro.
//
// El usuario lo pidió así: «todo debe ser configurable, no dejando nada por fuera». Hasta aquí cada pantalla traía
// sus umbrales escritos en el código (21 días para mirar una cuenta clave, 60 puntos para «caliente», 7 días para
// un trato estancado…): razonables, pero iguales para una boutique y para una firma de software. Ahora cada uno es
// una regla con su nombre, su porqué y su rango, y se lee en TRES CAPAS (manda la última que tenga valor):
//
//   1. el valor de fábrica, escrito aquí (es el de antes: registrar una regla no cambia ningún resultado);
//   2. lo que trae el cliente en `xencrm.config.json`, sección `reglas` ({ "kam.diasAtencion": 30 });
//   3. lo que se cambia desde el tablero (Configuración › Reglas y umbrales), guardado en settings `reglas.<id>`.
//
// 🪤 Un valor que no vale para su regla (fuera de rango, de otro tipo) no se usa: se cae a la capa de abajo y la
// pantalla lo dice. Un archivo con un error de dedo no puede tumbar el arranque ni volver loco un cálculo.
//
// 🪤 `regla()` NO abre la base: si nadie la ha abierto (una prueba de una función pura), solo mira el archivo y el
// valor de fábrica. En el servidor la base siempre está abierta.
//
// Otros módulos registran las suyas con `registrarReglas` (el SLA y los mantenimientos traen listas con esta misma
// forma y la misma llave de settings).
import { business } from './config.js';
import { getSetting, quitarSetting, setSetting } from './crm/settings.js';
import { baseAbierta } from './rag/store.js';

export type TipoRegla = 'numero' | 'texto' | 'si-no' | 'opciones' | 'lista';
export type ValorRegla = number | string | boolean | string[];

export interface Regla {
  id: string;
  grupo: string;
  etiqueta: string;
  /** Qué cambia si la mueves: en una frase, para decidir sin leer el código. */
  ayuda: string;
  tipo: TipoRegla;
  unidad?: string;
  min?: number;
  max?: number;
  /** Solo números enteros (días, veces, puntos). */
  entero?: boolean;
  defecto: ValorRegla;
  opciones?: { valor: string; etiqueta: string }[];
  /** Largo máximo de un texto o de cada elemento de una lista; cuántos elementos como mucho. */
  largo?: number;
  maxElementos?: number;
  /** Si se aplica sin reiniciar (lo normal: se lee cada vez) o al reiniciar. */
  aplica?: 'en-vivo' | 'al-reiniciar';
  /** Otra llave de settings, para una regla que ya existía con su propio nombre (p. ej. `sla.minutos`). */
  llave?: string;
}

/** Algo que se configura, pero en otra pantalla o en el archivo: se nombra aquí con su sitio, sin duplicarlo. */
export interface EnOtroSitio {
  grupo: string;
  etiqueta: string;
  donde: string;
  /** La pantalla del tablero que lo cambia, si hay una. */
  vista?: string;
}

/** Dos reglas que tienen que ir en orden (el tibio por debajo del caliente…). Se mira con los valores que mandan. */
export interface Coherencia {
  menor: string;
  mayor: string;
  dice: string;
}

const REGISTRO = new Map<string, Regla>();
const ORDEN_DE_GRUPOS: string[] = [];
const COHERENCIAS: Coherencia[] = [];

export function registrarReglas(lista: Regla[], coherencias: Coherencia[] = []): void {
  for (const r of lista) {
    if (!/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/.test(r.id)) throw new Error(`regla con un id raro: ${r.id}`);
    const v = validar(r, r.defecto);
    if ('error' in v) throw new Error(`la regla ${r.id} trae un valor de fábrica que no vale: ${v.error}`);
    REGISTRO.set(r.id, r);
    if (!ORDEN_DE_GRUPOS.includes(r.grupo)) ORDEN_DE_GRUPOS.push(r.grupo);
  }
  COHERENCIAS.push(...coherencias);
}

export const llaveDe = (r: Regla): string => r.llave ?? `reglas.${r.id}`;

const definicion = (id: string): Regla => {
  const r = REGISTRO.get(id);
  if (!r) throw new Error(`no hay una regla «${id}» registrada`);
  return r;
};

// ---------- validar ----------

/** Un número como lo escribe la gente: «4,5», «90 %», «1.200» (miles), «-15». */
function aNumero(x: unknown): number | null {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (typeof x !== 'string') return null;
  let t = x.trim().replace(/[%\s$]/g, '');
  if (!t) return null;
  // «1.200» y «1.200,5»: el punto de miles se va; la coma decimal pasa a punto.
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** «1 día», «2 días», «1 punto», «60 %»: la unidad en singular cuando toca. */
function conUnidad(n: number, unidad?: string): string {
  if (!unidad) return String(n);
  if (unidad === '%') return `${n} %`;
  return `${n} ${Math.abs(n) === 1 && unidad.endsWith('s') ? unidad.slice(0, -1) : unidad}`;
}

/** Lo que vale para la regla, ya limpio; o por qué no. */
export function validar(r: Regla, crudo: unknown): { valor: ValorRegla } | { error: string } {
  switch (r.tipo) {
    case 'numero': {
      const n = aNumero(crudo);
      if (n === null) return { error: 'tiene que ser un número' };
      if (r.entero && !Number.isInteger(n)) return { error: 'tiene que ser un número entero' };
      if (r.min !== undefined && n < r.min) return { error: `no puede ser menos de ${conUnidad(r.min, r.unidad)}` };
      if (r.max !== undefined && n > r.max) return { error: `no puede ser más de ${conUnidad(r.max, r.unidad)}` };
      return { valor: n };
    }
    case 'si-no': {
      if (typeof crudo === 'boolean') return { valor: crudo };
      if (crudo === 'si' || crudo === 'sí' || crudo === 'true') return { valor: true };
      if (crudo === 'no' || crudo === 'false') return { valor: false };
      return { error: 'tiene que ser sí o no' };
    }
    case 'opciones': {
      const t = typeof crudo === 'string' ? crudo.trim() : '';
      if (!(r.opciones ?? []).some((o) => o.valor === t)) return { error: `tiene que ser una de: ${(r.opciones ?? []).map((o) => o.etiqueta).join(', ')}` };
      return { valor: t };
    }
    case 'texto': {
      if (typeof crudo !== 'string') return { error: 'tiene que ser un texto' };
      const t = crudo.trim();
      if (!t) return { error: 'no puede quedar vacío' };
      if (r.largo && t.length > r.largo) return { error: `como mucho ${r.largo} letras` };
      return { valor: t };
    }
    case 'lista': {
      const lista = Array.isArray(crudo) ? crudo : typeof crudo === 'string' ? crudo.split(/[\n,]/) : null;
      if (!lista) return { error: 'tiene que ser una lista' };
      const limpia = [...new Set(lista.map((x) => String(x).trim()).filter(Boolean))];
      if (!limpia.length) return { error: 'la lista no puede quedar vacía' };
      if (r.maxElementos && limpia.length > r.maxElementos) return { error: `como mucho ${r.maxElementos} elementos` };
      if (r.largo && limpia.some((x) => x.length > r.largo!)) return { error: `cada elemento, como mucho ${r.largo} letras` };
      return { valor: limpia };
    }
  }
}

// ---------- leer ----------

/** Lo que trae el archivo del cliente para esta regla: el valor, o por qué no se usa. */
function delArchivo(r: Regla): { valor: ValorRegla } | { error: string } | null {
  const crudo = (business.reglas ?? {})[r.id];
  if (crudo === undefined) return null;
  return validar(r, crudo);
}

/**
 * Lo que se puso desde el tablero. Se guarda un momento: `regla()` se llama dentro de bucles de cientos de fichas y
 * cada lectura sería una consulta. Lo que se escribe por aquí lo borra al instante; una escritura por otra puerta
 * (la ruta vieja del acuerdo de respuesta) se ve en cuanto vence el momento.
 */
const VIGENCIA_MS = 2000;
const guardado = new Map<string, { hasta: number; v: { valor: ValorRegla } | { error: string } | null }>();
function delTablero(r: Regla): { valor: ValorRegla } | { error: string } | null {
  if (!baseAbierta()) return null;
  const ahora = Date.now();
  const g = guardado.get(r.id);
  if (g && g.hasta > ahora) return g.v;
  const crudo = getSetting<unknown>(llaveDe(r), undefined);
  const v = crudo === undefined || crudo === null ? null : validar(r, crudo);
  guardado.set(r.id, { hasta: ahora + VIGENCIA_MS, v });
  return v;
}

export type Fuente = 'fabrica' | 'archivo' | 'tablero';

export function leerConFuente(id: string): { valor: ValorRegla; fuente: Fuente } {
  const r = definicion(id);
  const t = delTablero(r);
  if (t && 'valor' in t) return { valor: t.valor, fuente: 'tablero' };
  const a = delArchivo(r);
  if (a && 'valor' in a) return { valor: a.valor, fuente: 'archivo' };
  return { valor: r.defecto, fuente: 'fabrica' };
}

/** El valor que manda hoy para esta regla. */
export function regla<T extends ValorRegla = number>(id: string): T {
  return leerConFuente(id).valor as T;
}

/** Un porcentaje guardado como «60» (lo que lee la gente), como fracción para calcular (0.6). */
export const fraccion = (id: string): number => regla<number>(id) / 100;

// ---------- escribir ----------

/**
 * Cambia reglas desde el tablero, todo o nada: si una no vale, no se guarda ninguna y se dice cuál. `null` quita lo
 * del tablero (vuelve a mandar el archivo del cliente o, si no trae nada, el valor de fábrica).
 */
export function cambiarReglas(cambios: Record<string, unknown>): { ok: true; cambiadas: string[] } | { ok: false; errores: Record<string, string> } {
  const errores: Record<string, string> = {};
  const limpios = new Map<string, ValorRegla | null>();
  for (const [id, crudo] of Object.entries(cambios ?? {})) {
    const r = REGISTRO.get(id);
    if (!r) { errores[id] = 'no existe esa regla'; continue; }
    if (crudo === null) { limpios.set(id, null); continue; }
    const v = validar(r, crudo);
    if ('error' in v) errores[id] = v.error;
    else limpios.set(id, v.valor);
  }
  // Las que tienen que ir en orden, con lo que quedaría mandando después del cambio.
  const quedaria = (id: string): ValorRegla => {
    if (limpios.has(id)) {
      const v = limpios.get(id);
      if (v !== null && v !== undefined) return v;
      const a = delArchivo(definicion(id));
      return a && 'valor' in a ? a.valor : definicion(id).defecto;
    }
    return regla(id);
  };
  for (const c of COHERENCIAS) {
    if (!limpios.has(c.menor) && !limpios.has(c.mayor)) continue;
    if (!REGISTRO.has(c.menor) || !REGISTRO.has(c.mayor)) continue;
    if (!(Number(quedaria(c.menor)) < Number(quedaria(c.mayor)))) errores[limpios.has(c.menor) ? c.menor : c.mayor] = c.dice;
  }
  if (Object.keys(errores).length) return { ok: false, errores };
  for (const [id, v] of limpios) {
    const r = definicion(id);
    if (v === null) quitarSetting(llaveDe(r));
    else setSetting(llaveDe(r), v);
    guardado.delete(id);
  }
  return { ok: true, cambiadas: [...limpios.keys()] };
}

/** Para las pruebas y para quien cambia una regla desde el código: lo mismo que el tablero. */
export function ponerRegla(id: string, valor: unknown): void {
  const r = cambiarReglas({ [id]: valor });
  if (!r.ok) throw new Error(Object.values(r.errores).join('; '));
}
export function quitarRegla(id: string): void {
  cambiarReglas({ [id]: null });
}

// ---------- lo que ve la pantalla ----------

export interface ReglaVista extends Regla {
  valor: ValorRegla;
  fuente: Fuente;
  archivo: ValorRegla | null;
  archivoError: string | null;
  tablero: ValorRegla | null;
  tableroError: string | null;
}

export function registro(): { grupos: string[]; reglas: ReglaVista[]; enOtroSitio: EnOtroSitio[] } {
  const reglas = [...REGISTRO.values()].map((r) => {
    const a = delArchivo(r);
    guardado.delete(r.id); // la pantalla lee fresco
    const t = delTablero(r);
    const { valor, fuente } = leerConFuente(r.id);
    return {
      ...r,
      valor,
      fuente,
      archivo: a && 'valor' in a ? a.valor : null,
      archivoError: a && 'error' in a ? a.error : null,
      tablero: t && 'valor' in t ? t.valor : null,
      tableroError: t && 'error' in t ? t.error : null,
    };
  });
  return { grupos: [...ORDEN_DE_GRUPOS], reglas, enOtroSitio: EN_OTRO_SITIO };
}

/** Solo los valores, para el tablero (que pinta con ellos): `{ id: valor }`. */
export function valoresDeReglas(): Record<string, ValorRegla> {
  const out: Record<string, ValorRegla> = {};
  for (const id of REGISTRO.keys()) out[id] = regla(id);
  return out;
}

// ============================================================================================================
// Las reglas de fábrica. Cada defecto es el valor que tenía el código antes de este registro.
// ============================================================================================================

const PUNTOS = { tipo: 'numero' as const, unidad: 'puntos', min: -100, max: 100, entero: true };
const DIAS = { tipo: 'numero' as const, unidad: 'días', min: 1, max: 3650, entero: true };
const VECES = { tipo: 'numero' as const, min: 1, max: 100_000, entero: true };
const PCT = { tipo: 'numero' as const, unidad: '%', min: 1, max: 100 };

registrarReglas(
  [
    // ---------- Puntaje (crm/analyzer.ts, crm/score.ts) ----------
    { id: 'puntaje.caliente', grupo: 'Puntaje', etiqueta: 'Caliente desde', ayuda: 'Desde este puntaje alguien es «caliente» («Prospecto claro» en la ficha): sale en Calientes, en Hoy, en Seguimientos y avisa al cruzarlo.', tipo: 'numero', unidad: 'puntos', min: 1, max: 100, entero: true, defecto: 60 },
    { id: 'puntaje.tibio', grupo: 'Puntaje', etiqueta: 'Tibio desde', ayuda: 'Desde este puntaje (y por debajo del de caliente) alguien es «tibio» («Posible prospecto»). Por debajo, «frío».', tipo: 'numero', unidad: 'puntos', min: 0, max: 99, entero: true, defecto: 30 },
    { id: 'puntaje.peso.citaAgendada', grupo: 'Puntaje', etiqueta: 'Cita agendada', ayuda: 'Lo que suma tener una cita confirmada.', ...PUNTOS, defecto: 40 },
    { id: 'puntaje.peso.pidioCita', grupo: 'Puntaje', etiqueta: 'Pidió cita', ayuda: 'Lo que suma pedir una cita que todavía no se agenda.', ...PUNTOS, defecto: 30 },
    { id: 'puntaje.peso.quiereComprar', grupo: 'Puntaje', etiqueta: 'Quiere comprar o agendar ya', ayuda: 'El interés más alto que ve el análisis.', ...PUNTOS, defecto: 20 },
    { id: 'puntaje.peso.interesClaro', grupo: 'Puntaje', etiqueta: 'Interés claro', ayuda: 'Pregunta en serio por lo que se vende.', ...PUNTOS, defecto: 10 },
    { id: 'puntaje.peso.curiosidad', grupo: 'Puntaje', etiqueta: 'Curiosidad', ayuda: 'Está mirando, sin decidirse.', ...PUNTOS, defecto: 3 },
    { id: 'puntaje.peso.pidioPrecio', grupo: 'Puntaje', etiqueta: 'Preguntó precio', ayuda: 'Lo que suma preguntar cuánto cuesta.', ...PUNTOS, defecto: 6 },
    { id: 'puntaje.peso.presupuesto', grupo: 'Puntaje', etiqueta: 'Mencionó presupuesto', ayuda: 'Dijo cuánto quiere o puede gastar.', ...PUNTOS, defecto: 8 },
    { id: 'puntaje.peso.urgenciaAlta', grupo: 'Puntaje', etiqueta: 'Urgencia alta', ayuda: 'Lo que suma que el análisis vea que lo necesita ya.', ...PUNTOS, defecto: 10 },
    { id: 'puntaje.peso.urgenciaMedia', grupo: 'Puntaje', etiqueta: 'Urgencia media', ayuda: 'Lo que suma que el análisis vea que lo necesita pronto.', ...PUNTOS, defecto: 4 },
    { id: 'puntaje.peso.nombre', grupo: 'Puntaje', etiqueta: 'Dio su nombre', ayuda: 'Lo que suma saber cómo se llama.', ...PUNTOS, defecto: 2 },
    { id: 'puntaje.peso.ciudadTelefono', grupo: 'Puntaje', etiqueta: 'Dio ciudad o teléfono', ayuda: 'Lo que suma tener cómo ubicarlo.', ...PUNTOS, defecto: 2 },
    { id: 'puntaje.peso.primerDato', grupo: 'Puntaje', etiqueta: 'Primer dato captado', ayuda: 'Lo que suma el primer dato del negocio que dijo (servicio, producto…); cada dato siguiente suma uno menos, hasta 1.', ...PUNTOS, min: 0, defecto: 4 },
    { id: 'puntaje.peso.sostenida', grupo: 'Puntaje', etiqueta: 'Conversación sostenida', ayuda: 'Lo que suma haber escrito varias veces.', ...PUNTOS, defecto: 5 },
    { id: 'puntaje.mensajesSostenida', grupo: 'Puntaje', etiqueta: 'Mensajes para «sostenida»', ayuda: 'Cuántos mensajes del cliente hacen una conversación sostenida.', ...VECES, max: 100, defecto: 4 },
    { id: 'puntaje.peso.animoPositivo', grupo: 'Puntaje', etiqueta: 'Ánimo positivo', ayuda: 'Lo que suma escribir a gusto.', ...PUNTOS, defecto: 5 },
    { id: 'puntaje.peso.animoNegativo', grupo: 'Puntaje', etiqueta: 'Ánimo negativo', ayuda: 'Lo que resta estar molesto (va en negativo).', ...PUNTOS, defecto: -15 },
    { id: 'puntaje.peso.objecion', grupo: 'Puntaje', etiqueta: 'Tiene una objeción', ayuda: 'Lo que resta una objeción (va en negativo).', ...PUNTOS, defecto: -10 },
    { id: 'puntaje.silencio.dias1', grupo: 'Puntaje', etiqueta: 'Silencio: primer tramo desde', ayuda: 'Días sin hablar desde los que el puntaje empieza a bajar (no aplica con cita o ya ganado).', ...DIAS, max: 365, defecto: 3 },
    { id: 'puntaje.silencio.descuento1', grupo: 'Puntaje', etiqueta: 'Silencio: descuento del primer tramo', ayuda: 'Cuánto baja el puntaje en el primer tramo.', ...PUNTOS, min: 0, defecto: 10 },
    { id: 'puntaje.silencio.dias2', grupo: 'Puntaje', etiqueta: 'Silencio: segundo tramo desde', ayuda: 'Días sin hablar del segundo tramo.', ...DIAS, max: 365, defecto: 7 },
    { id: 'puntaje.silencio.descuento2', grupo: 'Puntaje', etiqueta: 'Silencio: descuento del segundo tramo', ayuda: 'Cuánto baja en el segundo tramo.', ...PUNTOS, min: 0, defecto: 25 },
    { id: 'puntaje.silencio.dias3', grupo: 'Puntaje', etiqueta: 'Silencio: tercer tramo desde', ayuda: 'Días sin hablar del tercer tramo (y de ahí en adelante).', ...DIAS, max: 365, defecto: 14 },
    { id: 'puntaje.silencio.descuento3', grupo: 'Puntaje', etiqueta: 'Silencio: descuento del tercer tramo', ayuda: 'Cuánto baja del tercer tramo en adelante.', ...PUNTOS, min: 0, defecto: 40 },

    // ---------- Seguimientos y Lista de trabajo (resultados.ts, followup.ts, la ruta de Hoy) ----------
    { id: 'seg.horasSinSeguimiento', grupo: 'Seguimientos', etiqueta: 'Sin seguimiento desde', ayuda: 'Horas sin mensajes para que un trato abierto salga en la Lista de trabajo (y un caliente en Hoy).', tipo: 'numero', unidad: 'horas', min: 1, max: 24 * 90, entero: true, defecto: 24 },
    { id: 'seg.diasEsperandoResultado', grupo: 'Seguimientos', etiqueta: 'Esperar el resultado de una cita', ayuda: 'Días después de una cita en que se espera anotar cómo le fue (mientras tanto no sale como seguimiento).', ...DIAS, max: 90, defecto: 14 },
    { id: 'seg.posponerDias', grupo: 'Seguimientos', etiqueta: 'Posponer, por defecto', ayuda: 'Cuántos días aparta «Dejarlo por ahora» si no se dice otra cosa.', ...DIAS, max: 365, defecto: 7 },
    { id: 'seg.posponerMaxDias', grupo: 'Seguimientos', etiqueta: 'Posponer, como mucho', ayuda: 'El tope de días que se puede apartar un seguimiento.', ...DIAS, max: 3650, defecto: 90 },

    // ---------- Cuentas clave (crm/cuentas-clave.ts) ----------
    { id: 'kam.diasAtencion', grupo: 'Cuentas clave', etiqueta: 'Atención desde', ayuda: 'Días sin hablar para que una cuenta clave pase a «Atención».', ...DIAS, defecto: 21 },
    { id: 'kam.diasRiesgo', grupo: 'Cuentas clave', etiqueta: 'En riesgo desde', ayuda: 'Días sin hablar para que una cuenta clave pase a «En riesgo».', ...DIAS, defecto: 45 },
    { id: 'kam.horasSinRespuesta', grupo: 'Cuentas clave', etiqueta: 'Sin respuesta, en riesgo', ayuda: 'Horas que una cuenta clave puede esperar respuesta antes de quedar «En riesgo» (antes, «Atención»).', tipo: 'numero', unidad: 'horas', min: 1, max: 24 * 30, entero: true, defecto: 24 },
    { id: 'kam.valorAltoPct', grupo: 'Cuentas clave', etiqueta: 'Candidatas: el tramo de mayor valor', ayuda: 'Qué porcentaje de las fichas con precio (las de más valor) se proponen como cuenta clave.', ...PCT, defecto: 25 },
    { id: 'kam.valorAltoMinPrecios', grupo: 'Cuentas clave', etiqueta: 'Candidatas: precios mínimos para comparar', ayuda: 'Con menos fichas con precio, la regla del mayor valor no se aplica (sería azar).', ...VECES, max: 1000, defecto: 4 },
    { id: 'kam.volvioVeces', grupo: 'Cuentas clave', etiqueta: 'Candidatas: volvió', ayuda: 'Cuántas vueltas hacen candidata a una ficha que todavía no compra.', ...VECES, max: 100, defecto: 2 },
    { id: 'kam.maxNota', grupo: 'Cuentas clave', etiqueta: 'Largo del plan de cuenta', ayuda: 'Cuántas letras caben en el plan de cuenta.', tipo: 'numero', unidad: 'letras', min: 100, max: 5000, entero: true, defecto: 600 },

    // ---------- Optimización de ventas (crm/optimizacion.ts) ----------
    { id: 'opt.baseEmbudo', grupo: 'Optimización de ventas', etiqueta: 'Dónde se caen: base mínima', ayuda: 'Cuántos tienen que haber llegado a una etapa para juzgar cuántos pasan a la siguiente.', ...VECES, max: 10_000, defecto: 5 },
    { id: 'opt.pasoBajoPct', grupo: 'Optimización de ventas', etiqueta: 'Dónde se caen: paso bajo', ayuda: 'Por debajo de este porcentaje de paso, la etapa es «donde se caen».', ...PCT, defecto: 60 },
    { id: 'opt.pasoMuyBajoPct', grupo: 'Optimización de ventas', etiqueta: 'Dónde se caen: prioridad alta', ayuda: 'Por debajo de este porcentaje de paso, el hallazgo es de prioridad alta.', ...PCT, defecto: 30 },
    { id: 'opt.diasEstancado', grupo: 'Optimización de ventas', etiqueta: 'Trato estancado', ayuda: 'Días sin actividad para que un trato abierto (sin cita ni posponer) cuente como estancado.', ...DIAS, max: 365, defecto: 7 },
    { id: 'opt.cerradosVelocidad', grupo: 'Optimización de ventas', etiqueta: 'Contestar rápido: cerrados', ayuda: 'Tratos cerrados con tiempo de respuesta medido para comparar rápidos contra lentos.', ...VECES, max: 10_000, defecto: 10 },
    { id: 'opt.grupoVelocidad', grupo: 'Optimización de ventas', etiqueta: 'Contestar rápido: mínimo por grupo', ayuda: 'Cuántos rápidos y cuántos lentos hacen falta en cada lado.', ...VECES, max: 10_000, defecto: 4 },
    { id: 'opt.respondidas', grupo: 'Optimización de ventas', etiqueta: 'Acuerdo de respuesta: base', ayuda: 'Respuestas medidas para juzgar el acuerdo de servicio.', ...VECES, max: 100_000, defecto: 10 },
    { id: 'opt.fueraDeAcuerdoPct', grupo: 'Optimización de ventas', etiqueta: 'Acuerdo de respuesta: preocupa desde', ayuda: 'Parte de respuestas fuera del acuerdo desde la que sale el hallazgo.', ...PCT, defecto: 20 },
    { id: 'opt.fueraDeAcuerdoAltaPct', grupo: 'Optimización de ventas', etiqueta: 'Acuerdo de respuesta: prioridad alta', ayuda: 'Parte fuera del acuerdo desde la que es prioridad alta.', ...PCT, defecto: 40 },
    { id: 'opt.mensajesHoras', grupo: 'Optimización de ventas', etiqueta: 'Horas pico: base', ayuda: 'Mensajes de clientes para hablar de horas.', ...VECES, max: 1_000_000, defecto: 30 },
    { id: 'opt.fueraDeHorarioPct', grupo: 'Optimización de ventas', etiqueta: 'Fuera de horario: preocupa desde', ayuda: 'Parte de los mensajes fuera del horario de atención desde la que se avisa.', ...PCT, defecto: 30 },
    { id: 'opt.porCanal', grupo: 'Optimización de ventas', etiqueta: 'Canales: contactos por canal', ayuda: 'Contactos por canal para comparar canales (y campañas).', ...VECES, max: 100_000, defecto: 5 },
    { id: 'opt.difCanalPuntos', grupo: 'Optimización de ventas', etiqueta: 'Canales: diferencia mínima', ayuda: 'Puntos porcentuales de diferencia en conversión para que valga la pena decirlo.', tipo: 'numero', unidad: 'puntos', min: 1, max: 100, defecto: 10 },
    { id: 'opt.perdidas', grupo: 'Optimización de ventas', etiqueta: 'Motivos de pérdida: base', ayuda: 'Perdidos en el periodo para hablar de motivos.', ...VECES, max: 100_000, defecto: 3 },
    { id: 'opt.sinMotivoPct', grupo: 'Optimización de ventas', etiqueta: 'Perdidos sin motivo: preocupa desde', ayuda: 'Parte de los perdidos sin motivo anotado desde la que se avisa.', ...PCT, defecto: 50 },
    { id: 'opt.objecion', grupo: 'Optimización de ventas', etiqueta: 'Objeción repetida', ayuda: 'Veces que tiene que salir una objeción para que «se repita».', ...VECES, max: 10_000, defecto: 2 },

    // ---------- Embudo, Inicio, KPIs y atención ----------
    { id: 'embudo.minParaMarcar', grupo: 'Embudo', etiqueta: '«Aquí se quedan más» desde', ayuda: 'Cuántos tratos tienen que haber llegado a una etapa para marcarla como la que más pierde.', ...VECES, max: 10_000, defecto: 3 },
    { id: 'inicio.maxAcciones', grupo: 'Inicio', etiqueta: 'Acciones del copiloto', ayuda: 'Cuántas siguientes acciones muestra el Copiloto XEN antes de «Y N más».', ...VECES, max: 20, defecto: 5 },
    { id: 'inicio.maxAvisos', grupo: 'Inicio', etiqueta: 'Actividad reciente', ayuda: 'Cuántos avisos muestra la actividad reciente de Inicio.', ...VECES, max: 50, defecto: 5 },
    { id: 'atencion.acuerdoMinutos', grupo: 'Atención', etiqueta: 'Acuerdo de primera respuesta', ayuda: 'Minutos en que se promete contestar (con el reloj parado fuera del horario): mide «contestadas a tiempo» en KPIs, Analítica y Optimización, y los avisos de quien espera.', tipo: 'numero', unidad: 'minutos', min: 1, max: 10_080, entero: true, defecto: 15, llave: 'sla.minutos' },

    // ---------- Contactos, bandeja y equipo ----------
    { id: 'contactos.tope', grupo: 'Contactos', etiqueta: 'Contactos por lista', ayuda: 'Cuántos contactos (los de actividad más reciente) trae la lista de Contactos; más allá, se busca.', tipo: 'numero', min: 50, max: 2000, entero: true, defecto: 500 },
    { id: 'contactos.volvioDias', grupo: 'Contactos', etiqueta: '«Volvió» después de', ayuda: 'Días de silencio que separan una pausa de una vuelta (cuenta en «Volvió», en candidatas y en la historia).', ...DIAS, max: 365, defecto: 14 },
    { id: 'contactos.mismaPersonaDias', grupo: 'Contactos', etiqueta: 'Misma persona por otro canal', ayuda: 'Días hacia atrás en que se busca la ficha de la misma persona en otro canal para ofrecer unirlas.', ...DIAS, max: 3650, defecto: 30 },
    { id: 'fijados.maximo', grupo: 'Contactos', etiqueta: 'Fichas fijadas por persona', ayuda: 'Cuántas fichas puede fijar cada quien.', ...VECES, max: 100, defecto: 12 },
    { id: 'presencia.minutos', grupo: 'Equipo', etiqueta: '«Está mirando» dura', ayuda: 'Minutos que alguien sigue figurando en una conversación después de abrirla.', tipo: 'numero', unidad: 'minutos', min: 1, max: 60, entero: true, defecto: 3 },
    { id: 'rapidas.parecidoPct', grupo: 'Respuestas rápidas', etiqueta: 'Parecido mínimo', ayuda: 'Qué tan parecida tiene que ser una pregunta a una ya contestada para sugerir la misma respuesta.', ...PCT, min: 50, defecto: 82 },
    { id: 'rapidas.largoMaximo', grupo: 'Respuestas rápidas', etiqueta: 'Largo máximo', ayuda: 'Las respuestas más largas que esto no se proponen como rápidas.', tipo: 'numero', unidad: 'letras', min: 40, max: 4000, entero: true, defecto: 320 },
    { id: 'vigilante.topePorHora', grupo: 'Equipo', etiqueta: 'Avisos al equipo por hora', ayuda: 'Cuántos avisos de «alguien espera» manda XENCRM por hora como mucho (si se pasa, algo va mal y mejor callarse).', ...VECES, max: 200, defecto: 12 },
  ],
  [
    { menor: 'puntaje.tibio', mayor: 'puntaje.caliente', dice: 'el puntaje de «tibio» tiene que quedar por debajo del de «caliente»' },
    { menor: 'puntaje.silencio.dias1', mayor: 'puntaje.silencio.dias2', dice: 'los tramos del silencio van en orden: el primero antes que el segundo' },
    { menor: 'puntaje.silencio.dias2', mayor: 'puntaje.silencio.dias3', dice: 'los tramos del silencio van en orden: el segundo antes que el tercero' },
    { menor: 'kam.diasAtencion', mayor: 'kam.diasRiesgo', dice: '«Atención» tiene que llegar antes que «En riesgo»' },
    { menor: 'opt.pasoMuyBajoPct', mayor: 'opt.pasoBajoPct', dice: 'el paso de prioridad alta tiene que ser menor que el paso bajo' },
    { menor: 'opt.fueraDeAcuerdoPct', mayor: 'opt.fueraDeAcuerdoAltaPct', dice: 'la prioridad alta del acuerdo tiene que estar por encima de donde empieza a preocupar' },
    { menor: 'seg.posponerDias', mayor: 'seg.posponerMaxDias', dice: 'posponer por defecto no puede pasar del máximo' },
  ],
);

/**
 * Lo que también se configura, pero en otro sitio: se nombra para que «Reglas y umbrales» sea el mapa de todo lo
 * configurable, sin tener dos sitios para cambiar lo mismo.
 */
const EN_OTRO_SITIO: EnOtroSitio[] = [
  { grupo: 'El negocio', etiqueta: 'Nombre, descripción, moneda, país y horario de atención', donde: 'Configuración › El negocio', vista: 'negocio' },
  { grupo: 'El negocio', etiqueta: 'Dirección, horarios, pagos, precios y políticas que dice el asistente', donde: 'Configuración › Perfil del negocio', vista: 'profile' },
  { grupo: 'El negocio', etiqueta: 'Etapas del embudo, su nombre y su papel', donde: 'xencrm.config.json › crm.stages' },
  { grupo: 'El negocio', etiqueta: 'Datos que capta el análisis (campos de la ficha)', donde: 'xencrm.config.json › crm.fields' },
  { grupo: 'El negocio', etiqueta: 'Horario, duración, cupo y antelación de las citas', donde: 'xencrm.config.json › appointments' },
  { grupo: 'El asistente y la IA', etiqueta: 'Nombre, estilo y objetivo del asistente', donde: 'Configuración › El asistente', vista: 'agent' },
  { grupo: 'El asistente y la IA', etiqueta: 'Qué modelo hace cada cosa, proveedores y tope de gasto', donde: 'Configuración › Modelos de IA', vista: 'modelos' },
  { grupo: 'El asistente y la IA', etiqueta: 'Lo que sabe: catálogo, información y diccionario del negocio', donde: 'Configuración › Lo que sabe', vista: 'knowledge' },
  { grupo: 'Canales', etiqueta: 'WhatsApp, chat del sitio y modos de cada canal', donde: 'Configuración › Canales', vista: 'channels' },
  { grupo: 'Rendimiento', etiqueta: 'Metas de cada KPI', donde: 'Rendimiento › KPIs y metas', vista: 'kpis' },
  { grupo: 'Equipo', etiqueta: 'Modo fácil y candado del equipo', donde: 'Ajustes (el engranaje del pie del menú)' },
  { grupo: 'Datos', etiqueta: 'Cuánto tiempo se guardan las conversaciones', donde: 'La consola › el cliente › Retención' },
];
