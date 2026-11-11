// Las reglas de Mantenimientos y actualizaciones: TODO lo que decide cómo se cuentan sale de aquí, y nada está fijo
// en el código salvo el valor de fábrica.
//
// Tres capas, y manda la última que tenga valor:
//   1. la FÁBRICA (este archivo: lo que promete un plan de soporte típico);
//   2. el ARCHIVO del cliente, `servicio.mantenimientos` en xencrm.config.json (esquema en src/config.ts);
//   3. el TABLERO (Configuración › Mantenimientos y actualizaciones), guardado en settings con la llave `reglas.<id>`.
// Borrar lo del tablero (guardar null) vuelve a lo del archivo, y sin archivo, a la fábrica.
//
// 🪤 Los planes son los MISMOS del SLA: si el cliente tiene `servicio.sla` con sus planes, se usan esos nombres y aquí
// solo se pone cuánto aviso pide cada uno. Dos listas de planes con nombres distintos harían que «Pro» de un lado no
// fuera «Pro» del otro.
//
// 🪤 La lista de reglas se arma cada vez (no es una constante): los planes, los productos y los estados vienen de la
// configuración, y cada uno trae su propia regla (`mant.avisoHoras.Pro`, `mant.cadenciaDias.XENTRIS POS`…).
import { readFileSync } from 'node:fs';
import { business } from '../config.js';
import { getDb } from '../rag/store.js';
import { getSetting, setSetting } from './settings.js';
import { V } from '../vocabulario.js';

export type TipoRegla = 'numero' | 'texto' | 'si-no' | 'opciones' | 'lista';
export interface Opcion { valor: string; etiqueta: string }
/** Un parámetro suelto. La forma es la del registro común de reglas: se lee con la llave de settings `reglas.<id>`. */
export interface Regla {
  id: string;
  grupo: 'Mantenimientos';
  etiqueta: string;
  ayuda: string;
  tipo: TipoRegla;
  unidad?: string;
  min?: number;
  max?: number;
  defecto: unknown;
  opciones?: Opcion[];
}
export type Origen = 'fabrica' | 'archivo' | 'tablero';
export interface ReglaConValor extends Regla { valor: unknown; origen: Origen; delArchivo: unknown }

const sinTildes = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
export const clave = (s: string): string => sinTildes(s).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

// ---------- la fábrica ----------

export const PAPELES_MANT = ['programado', 'en_curso', 'hecho', 'cancelado'] as const;
export type PapelMant = (typeof PAPELES_MANT)[number];
export const PAPELES_ACT = ['publicada', 'planeada'] as const;
export type PapelAct = (typeof PAPELES_ACT)[number];

export const FABRICA = {
  planes: [
    { nombre: 'Básico', avisoHoras: 48 },
    { nombre: 'Pro', avisoHoras: 72 },
    { nombre: 'Enterprise', avisoHoras: 168 },
  ],
  /** El aviso de un plan que no está en la lista de fábrica (uno que venga del SLA, por ejemplo). */
  avisoHorasDeOtroPlan: 48,
  cadenciaDias: 31,
  toleranciaDias: 0,
  periodoDias: 30,
  estadosMantenimiento: [
    { id: 'programado', nombre: 'Programado', papel: 'programado' as PapelMant },
    { id: 'en_curso', nombre: 'En curso', papel: 'en_curso' as PapelMant },
    { id: 'hecho', nombre: 'Hecho', papel: 'hecho' as PapelMant },
    { id: 'cancelado', nombre: 'Cancelado', papel: 'cancelado' as PapelMant },
  ],
  estadosActualizacion: [
    { id: 'publicada', nombre: 'Publicada', papel: 'publicada' as PapelAct },
    { id: 'planeada', nombre: 'Planeada', papel: 'planeada' as PapelAct },
  ],
  afectados: {
    roles: ['ganado'],
    etapas: [] as string[],
    campoPlan: 'plan_soporte',
    campoProducto: 'producto',
    comparacion: 'palabras',
    sinProductoTocaATodos: true,
    incluirArchivados: false,
  },
  aviso: {
    plantilla:
      'Hola {primerNombre}. Te avisamos de un mantenimiento programado en {producto}: «{titulo}». Será el {dia}, de {inicio} a {fin} ({duracion}), ' +
      'y durante ese tiempo el servicio puede no estar disponible. Si esa ventana les complica, respóndenos por aquí y lo revisamos.',
    cuentaAl: 'salir',
  },
  quienPrograma: 'administra',
};

/** Las palabras que no distinguen un producto de otro: la marca del negocio y los conectores. */
export function palabrasGenericasDeFabrica(): string[] {
  const marca = sinTildes(business.business.name).split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !['llc', 'sas', 'sa', 'inc', 'ltda'].includes(w));
  return [...new Set([...marca, 'de', 'del', 'la', 'el', 'a', 'y', 'para', 'app', 'aplicacion', 'software'])];
}

/** Los productos de fábrica: los del catálogo, sin los planes de soporte (no son una aplicación que se actualice). */
export function productosDeFabrica(): string[] {
  try {
    const raw = business.sources?.productsFile ? JSON.parse(readFileSync(business.sources.productsFile, 'utf8')) : [];
    return (raw as { name?: string; category?: string }[]).filter((p) => p.name && !/soporte|plan/i.test(p.category ?? '')).map((p) => String(p.name));
  } catch {
    return [];
  }
}

export const VARIABLES_AVISO: { nombre: string; que: string }[] = [
  { nombre: 'nombre', que: 'el nombre completo del cliente' },
  { nombre: 'primerNombre', que: 'solo su primer nombre' },
  { nombre: 'empresa', que: 'su empresa (de la ficha)' },
  { nombre: 'plan', que: 'su plan de soporte' },
  { nombre: 'titulo', que: 'el título del mantenimiento' },
  { nombre: 'producto', que: 'la aplicación (o «nuestras aplicaciones» si es de todas)' },
  { nombre: 'dia', que: 'el día en que empieza (miércoles, 13 de diciembre)' },
  { nombre: 'inicio', que: 'la hora en que empieza' },
  { nombre: 'fin', que: 'la hora en que termina' },
  { nombre: 'duracion', que: 'cuánto dura (2 h, 45 min)' },
  { nombre: 'notas', que: 'las notas del mantenimiento' },
  { nombre: 'negocio', que: 'el nombre del negocio' },
];

// ---------- el archivo ----------

type Archivo = NonNullable<NonNullable<(typeof business)['servicio']>['mantenimientos']>;
const archivo = (): Partial<Archivo> => (business.servicio?.mantenimientos ?? {}) as Partial<Archivo>;

/**
 * Los planes del SLA, si el cliente los tiene (`servicio.sla.planes`): una lista de nombres o de objetos con
 * `nombre` (o `id`). Se lee con cuidado porque esa sección es de otra pantalla y puede crecer.
 */
export function planesDelSla(): string[] | null {
  const sla = (business.servicio as Record<string, unknown> | undefined)?.sla as { planes?: unknown } | undefined;
  if (!sla || !Array.isArray(sla.planes) || !sla.planes.length) return null;
  const nombres = sla.planes
    .map((p) => (typeof p === 'string' ? p : p && typeof p === 'object' ? String((p as { nombre?: unknown; id?: unknown }).nombre ?? (p as { id?: unknown }).id ?? '') : ''))
    .map((s) => s.trim())
    .filter(Boolean);
  return nombres.length ? [...new Set(nombres)] : null;
}

// ---------- el tablero ----------

const LLAVE = (id: string) => `reglas.${id}`;
function delTablero(id: string): unknown {
  const v = getSetting<unknown>(LLAVE(id), null);
  return v === null || v === undefined ? undefined : v;
}

// ---------- la lista de reglas ----------

const ROLES: Opcion[] = [
  { valor: 'inicio', etiqueta: 'Nuevo (inicio)' },
  { valor: 'activo', etiqueta: 'Conversando (activo)' },
  { valor: 'interes', etiqueta: 'Interesado (interés)' },
  { valor: 'cita', etiqueta: `Con ${V.cita}` },
  { valor: 'ganado', etiqueta: 'Cliente (ganado)' },
  { valor: 'perdido', etiqueta: 'Perdido' },
];

interface Def extends Regla { /** Lo que dice el archivo del cliente (undefined: nada). */ archivo: () => unknown }

/** Los planes: los del SLA si los hay; si no, el tablero, el archivo o la fábrica (en ese orden). */
export function nombresDePlanes(): string[] {
  const sla = planesDelSla();
  if (sla) return sla;
  const t = delTablero('mant.planes');
  if (Array.isArray(t) && t.length) return t.map(String);
  const a = archivo().planes;
  if (a?.length) return a.map((p) => p.nombre);
  return FABRICA.planes.map((p) => p.nombre);
}

function estadosMant(): { id: string; nombre: string; papel: PapelMant }[] {
  return archivo().estadosMantenimiento?.length ? (archivo().estadosMantenimiento as { id: string; nombre: string; papel: PapelMant }[]) : FABRICA.estadosMantenimiento;
}
function estadosAct(): { id: string; nombre: string; papel: PapelAct }[] {
  return archivo().estadosActualizacion?.length ? (archivo().estadosActualizacion as { id: string; nombre: string; papel: PapelAct }[]) : FABRICA.estadosActualizacion;
}

function defs(): Def[] {
  const a = archivo();
  const af = a.afectados ?? {};
  const out: Def[] = [];
  const sla = planesDelSla();
  out.push({
    id: 'mant.planes', grupo: 'Mantenimientos', etiqueta: 'Planes de soporte', tipo: 'lista',
    ayuda: sla ? 'Vienen del SLA (servicio.sla): se cambian allí, para que «Pro» sea el mismo plan en las dos pantallas.' : 'Los planes que puede tener un cliente. Uno por renglón.',
    defecto: FABRICA.planes.map((p) => p.nombre), archivo: () => (a.planes?.length ? a.planes.map((p) => p.nombre) : undefined),
  });
  const avisoArchivo = (plan: string): number | undefined => {
    const k = clave(plan);
    const deMapa = a.avisoHoras ? Object.entries(a.avisoHoras).find(([n]) => clave(n) === k)?.[1] : undefined;
    return deMapa ?? a.planes?.find((p) => clave(p.nombre) === k)?.avisoHoras;
  };
  for (const plan of nombresDePlanes()) {
    const fab = FABRICA.planes.find((p) => clave(p.nombre) === clave(plan))?.avisoHoras ?? FABRICA.avisoHorasDeOtroPlan;
    out.push({
      id: `mant.avisoHoras.${plan}`, grupo: 'Mantenimientos', etiqueta: `Aviso mínimo · ${plan}`, tipo: 'numero', unidad: 'horas', min: 0, max: 24 * 60,
      ayuda: `Con cuántas horas de anticipación hay que avisarle un mantenimiento a un cliente del plan ${plan}. 168 horas son 7 días.`,
      defecto: fab, archivo: () => avisoArchivo(plan),
    });
  }
  out.push(
    { id: 'mant.cadenciaDias', grupo: 'Mantenimientos', etiqueta: 'Cada cuánto sale una actualización', tipo: 'numero', unidad: 'días', min: 1, max: 730, ayuda: 'La cadencia que se promete por aplicación. Se puede cambiar para una sola aplicación abajo.', defecto: FABRICA.cadenciaDias, archivo: () => a.cadenciaDias },
    { id: 'mant.toleranciaDias', grupo: 'Mantenimientos', etiqueta: 'Días de gracia antes de «atrasada»', tipo: 'numero', unidad: 'días', min: 0, max: 365, ayuda: 'Una aplicación va atrasada cuando pasan más de cadencia + estos días sin publicar.', defecto: FABRICA.toleranciaDias, archivo: () => a.toleranciaDias },
    { id: 'mant.productos', grupo: 'Mantenimientos', etiqueta: 'Aplicaciones', tipo: 'lista', ayuda: 'Las aplicaciones que reciben mantenimientos y actualizaciones. De fábrica, las del catálogo (sin los planes de soporte). Una por renglón.', defecto: productosDeFabrica(), archivo: () => (a.productos?.length ? a.productos : undefined) },
  );
  for (const p of productos()) {
    const deArchivo = a.cadenciaPorProducto ? Object.entries(a.cadenciaPorProducto).find(([n]) => clave(n) === clave(p))?.[1] : undefined;
    out.push({
      id: `mant.cadenciaDias.${p}`, grupo: 'Mantenimientos', etiqueta: `Cadencia · ${p}`, tipo: 'numero', unidad: 'días', min: 1, max: 730,
      ayuda: `Cada cuánto debe salir una actualización de ${p}. Vacío: la general.`, defecto: null, archivo: () => deArchivo,
    });
  }
  for (const e of estadosMant()) {
    out.push({ id: `mant.estadoMant.${e.id}`, grupo: 'Mantenimientos', etiqueta: `Nombre del estado «${e.id}»`, tipo: 'texto', max: 40, ayuda: `Cómo se dice en pantalla el estado ${e.id} de un mantenimiento (papel: ${e.papel}).`, defecto: FABRICA.estadosMantenimiento.find((x) => x.id === e.id)?.nombre ?? e.nombre, archivo: () => (archivo().estadosMantenimiento?.find((x) => x.id === e.id)?.nombre) });
  }
  for (const e of estadosAct()) {
    out.push({ id: `mant.estadoAct.${e.id}`, grupo: 'Mantenimientos', etiqueta: `Nombre del estado «${e.id}»`, tipo: 'texto', max: 40, ayuda: `Cómo se dice en pantalla el estado ${e.id} de una actualización (papel: ${e.papel}).`, defecto: FABRICA.estadosActualizacion.find((x) => x.id === e.id)?.nombre ?? e.nombre, archivo: () => (archivo().estadosActualizacion?.find((x) => x.id === e.id)?.nombre) });
  }
  const etapas: Opcion[] = business.crm.stages.map((s) => ({ valor: s.id, etiqueta: s.label }));
  const campos: Opcion[] = business.crm.fields.map((f) => ({ valor: f.name, etiqueta: f.name }));
  out.push(
    { id: 'mant.afectados.roles', grupo: 'Mantenimientos', etiqueta: 'Quién cuenta como cliente', tipo: 'lista', opciones: ROLES, ayuda: 'Los papeles de etapa que reciben avisos de mantenimiento. De fábrica, solo los ganados.', defecto: FABRICA.afectados.roles, archivo: () => af.roles },
    { id: 'mant.afectados.etapas', grupo: 'Mantenimientos', etiqueta: 'Etapas que también cuentan', tipo: 'lista', opciones: etapas, ayuda: 'Etapas concretas que también reciben avisos aunque su papel no esté arriba (por ejemplo, una etapa de implementación).', defecto: FABRICA.afectados.etapas, archivo: () => af.etapas },
    { id: 'mant.afectados.campoPlan', grupo: 'Mantenimientos', etiqueta: 'Dato de la ficha con el plan', tipo: 'opciones', opciones: campos.length ? campos : [{ valor: 'plan_soporte', etiqueta: 'plan_soporte' }], ayuda: 'El dato captado de la ficha donde está el plan de soporte del cliente.', defecto: FABRICA.afectados.campoPlan, archivo: () => af.campoPlan },
    { id: 'mant.afectados.campoProducto', grupo: 'Mantenimientos', etiqueta: 'Dato de la ficha con la aplicación', tipo: 'opciones', opciones: campos.length ? campos : [{ valor: 'producto', etiqueta: 'producto' }], ayuda: 'El dato captado de la ficha donde está la aplicación que usa el cliente.', defecto: FABRICA.afectados.campoProducto, archivo: () => af.campoProducto },
    {
      id: 'mant.afectados.comparacion', grupo: 'Mantenimientos', etiqueta: 'Cómo se compara la aplicación', tipo: 'opciones',
      opciones: [
        { valor: 'palabras', etiqueta: 'Por palabras: todas las que distinguen al producto están en la ficha' },
        { valor: 'contiene', etiqueta: 'Contiene: el nombre entero del producto aparece en la ficha' },
        { valor: 'exacta', etiqueta: 'Exacta: la ficha dice exactamente el producto' },
      ],
      ayuda: 'Con «por palabras», «XENTRIS POS + Stock» cuenta para un mantenimiento de POS y para uno de Stock, y la marca sola no hace coincidir nada.',
      defecto: FABRICA.afectados.comparacion, archivo: () => af.comparacion,
    },
    { id: 'mant.afectados.palabrasGenericas', grupo: 'Mantenimientos', etiqueta: 'Palabras que no distinguen un producto', tipo: 'lista', ayuda: 'Se ignoran al comparar por palabras: la marca y los conectores. Una por renglón.', defecto: palabrasGenericasDeFabrica(), archivo: () => af.palabrasGenericas },
    { id: 'mant.afectados.sinProductoTocaATodos', grupo: 'Mantenimientos', etiqueta: 'Un mantenimiento sin aplicación toca a todas', tipo: 'si-no', ayuda: 'Si es no, un mantenimiento sin aplicación no afecta a nadie.', defecto: FABRICA.afectados.sinProductoTocaATodos, archivo: () => af.sinProductoTocaATodos },
    { id: 'mant.afectados.incluirArchivados', grupo: 'Mantenimientos', etiqueta: 'Avisar también a los archivados', tipo: 'si-no', ayuda: 'Un cliente archivado sigue usando la aplicación aunque nadie le escriba.', defecto: FABRICA.afectados.incluirArchivados, archivo: () => af.incluirArchivados },
    { id: 'mant.aviso.plantilla', grupo: 'Mantenimientos', etiqueta: 'Texto del aviso', tipo: 'texto', max: 1000, ayuda: 'El mensaje que se deja listo en la conversación de cada cliente. Variables entre llaves: ' + VARIABLES_AVISO.map((v) => '{' + v.nombre + '}').join(', ') + '.', defecto: FABRICA.aviso.plantilla, archivo: () => a.aviso?.plantilla },
    {
      id: 'mant.aviso.cuentaAl', grupo: 'Mantenimientos', etiqueta: 'El aviso cuenta como dado', tipo: 'opciones',
      opciones: [{ valor: 'salir', etiqueta: 'Cuando el mensaje de verdad salió' }, { valor: 'preparar', etiqueta: 'Cuando se dejó listo en la conversación' }],
      ayuda: 'De fábrica, solo cuenta lo que salió: un mensaje que nadie mandó no le avisó a nadie.', defecto: FABRICA.aviso.cuentaAl, archivo: () => a.aviso?.cuentaAl,
    },
    {
      id: 'mant.quienPrograma', grupo: 'Mantenimientos', etiqueta: 'Quién programa mantenimientos y actualizaciones', tipo: 'opciones',
      opciones: [{ valor: 'administra', etiqueta: 'Solo quien administra XENCRM' }, { valor: 'equipo', etiqueta: 'Todo el equipo' }],
      ayuda: 'Avisar a los clientes es siempre de todo el equipo; programar y publicar, de quien se diga aquí.', defecto: FABRICA.quienPrograma, archivo: () => a.quienPrograma,
    },
    { id: 'mant.periodoDias', grupo: 'Mantenimientos', etiqueta: 'Periodo del cumplimiento', tipo: 'numero', unidad: 'días', min: 1, max: 365, ayuda: 'Cuántos días mira el cumplimiento cuando no se pide otro periodo.', defecto: FABRICA.periodoDias, archivo: () => a.periodoDias },
  );
  return out;
}

/** La lista de reglas sueltas, con la forma del registro común (sin cómo se leen del archivo). */
export function reglasDeMantenimientos(): Regla[] {
  return defs().map(({ archivo: _a, ...r }) => r);
}

/** El valor que manda de una regla y de dónde salió. */
export function resolver(d: Def): { valor: unknown; origen: Origen; delArchivo: unknown } {
  const delArchivo = d.archivo();
  const t = delTablero(d.id);
  if (t !== undefined && !(d.id === 'mant.planes' && planesDelSla())) return { valor: t, origen: 'tablero', delArchivo };
  if (delArchivo !== undefined && delArchivo !== null) return { valor: delArchivo, origen: 'archivo', delArchivo };
  return { valor: d.defecto, origen: 'fabrica', delArchivo };
}

export function reglasConValor(): ReglaConValor[] {
  return defs().map((d) => {
    const { archivo: _a, ...r } = d;
    return { ...r, ...resolver(d) };
  });
}

/** El valor de una regla por su id (lo que manda: tablero, archivo o fábrica). */
export function regla<T = unknown>(id: string): T {
  const d = defs().find((x) => x.id === id);
  if (!d) throw new Error(`no existe la regla ${id}`);
  return resolver(d).valor as T;
}

// ---------- lecturas con nombre (lo que usa crm/mantenimientos.ts) ----------

export function productos(): string[] {
  const t = delTablero('mant.productos');
  if (Array.isArray(t) && t.length) return t.map(String);
  const a = archivo().productos;
  if (a?.length) return a;
  return productosDeFabrica();
}

export interface PlanConfig { id: string; nombre: string; avisoHoras: number }
export function planes(): PlanConfig[] {
  return nombresDePlanes().map((nombre) => ({ id: clave(nombre), nombre, avisoHoras: Number(regla(`mant.avisoHoras.${nombre}`)) }));
}
export function cadenciaDe(producto: string): number {
  const p = productos().find((x) => clave(x) === clave(producto));
  if (p) {
    const v = regla<number | null>(`mant.cadenciaDias.${p}`);
    if (v != null && Number(v) > 0) return Number(v);
  }
  return Number(regla('mant.cadenciaDias'));
}
export const toleranciaDias = (): number => Number(regla('mant.toleranciaDias'));
export const periodoDias = (): number => Number(regla('mant.periodoDias'));

export function estadosDeMantenimiento(): { id: string; nombre: string; papel: PapelMant }[] {
  return estadosMant().map((e) => ({ ...e, nombre: String(regla(`mant.estadoMant.${e.id}`) || e.nombre) }));
}
export function estadosDeActualizacion(): { id: string; nombre: string; papel: PapelAct }[] {
  return estadosAct().map((e) => ({ ...e, nombre: String(regla(`mant.estadoAct.${e.id}`) || e.nombre) }));
}

export interface ReglaAfectados { roles: string[]; etapas: string[]; campoPlan: string; campoProducto: string; comparacion: 'palabras' | 'contiene' | 'exacta'; palabrasGenericas: string[]; sinProductoTocaATodos: boolean; incluirArchivados: boolean }
export function reglaAfectados(): ReglaAfectados {
  return {
    roles: (regla<string[]>('mant.afectados.roles') ?? []).map(String),
    etapas: (regla<string[]>('mant.afectados.etapas') ?? []).map(String),
    campoPlan: String(regla('mant.afectados.campoPlan')),
    campoProducto: String(regla('mant.afectados.campoProducto')),
    comparacion: regla<ReglaAfectados['comparacion']>('mant.afectados.comparacion'),
    palabrasGenericas: (regla<string[]>('mant.afectados.palabrasGenericas') ?? []).map((w) => sinTildes(String(w))),
    sinProductoTocaATodos: Boolean(regla('mant.afectados.sinProductoTocaATodos')),
    incluirArchivados: Boolean(regla('mant.afectados.incluirArchivados')),
  };
}
export const plantillaDelAviso = (): string => String(regla('mant.aviso.plantilla'));
export const avisoCuentaAl = (): 'salir' | 'preparar' => (regla('mant.aviso.cuentaAl') === 'preparar' ? 'preparar' : 'salir');
export const programarEsDelEquipo = (): boolean => regla('mant.quienPrograma') === 'equipo';

// ---------- guardar desde el tablero ----------

export type Guardado = { ok: ReglaConValor[] } | { error: string; campo: string };

/** Limpia un valor según su regla. Lo que se puede limpiar se limpia (espacios, comas, renglones); lo demás se rechaza. */
export function limpiarValor(r: Regla, v: unknown): { ok: unknown } | { error: string } {
  if (v === null) return { ok: null };
  if (r.tipo === 'numero') {
    if (v === '' && r.defecto === null) return { ok: null };
    const n = typeof v === 'number' ? v : Number(String(v).replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(n)) return { error: `${r.etiqueta}: escribe un número` };
    if (r.min !== undefined && n < r.min) return { error: `${r.etiqueta}: el mínimo es ${r.min}${r.unidad ? ' ' + r.unidad : ''}` };
    if (r.max !== undefined && n > r.max) return { error: `${r.etiqueta}: el máximo es ${r.max}${r.unidad ? ' ' + r.unidad : ''}` };
    return { ok: Math.round(n * 100) / 100 };
  }
  if (r.tipo === 'texto') {
    const t = String(v).replace(/\r\n/g, '\n').trim();
    if (!t) return { error: `${r.etiqueta}: no puede quedar vacío (para volver al de fábrica, usa «Volver al de fábrica»)` };
    if (r.max !== undefined && t.length > r.max) return { error: `${r.etiqueta}: máximo ${r.max} letras` };
    if (r.id === 'mant.aviso.plantilla') {
      const desconocidas = [...t.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]!).filter((n) => !VARIABLES_AVISO.some((x) => x.nombre === n));
      if (desconocidas.length) return { error: `${r.etiqueta}: no existe la variable {${desconocidas[0]}}. Usa ${VARIABLES_AVISO.map((x) => '{' + x.nombre + '}').join(', ')}` };
    }
    return { ok: t };
  }
  if (r.tipo === 'si-no') {
    if (typeof v === 'boolean') return { ok: v };
    const t = sinTildes(String(v));
    if (['si', 'true', '1'].includes(t)) return { ok: true };
    if (['no', 'false', '0'].includes(t)) return { ok: false };
    return { error: `${r.etiqueta}: es sí o no` };
  }
  if (r.tipo === 'opciones') {
    const t = String(v);
    if (!r.opciones?.some((o) => o.valor === t)) return { error: `${r.etiqueta}: elige una de las opciones` };
    return { ok: t };
  }
  // lista: un arreglo, o un texto con un elemento por renglón (o separado por comas)
  const crudo = Array.isArray(v) ? v.map(String) : String(v).split(/\r?\n|,/);
  const limpio = [...new Set(crudo.map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean))];
  if (r.opciones) {
    const mala = limpio.find((x) => !r.opciones!.some((o) => o.valor === x));
    if (mala) return { error: `${r.etiqueta}: «${mala}» no es una opción` };
  }
  // Sin planes o sin aplicaciones no hay a quién avisar ni qué actualizar: al menos uno. (Quién cuenta como cliente
  // sí puede quedar vacío si se nombran etapas concretas.)
  if (!limpio.length && (r.id === 'mant.planes' || r.id === 'mant.productos')) return { error: `${r.etiqueta}: pon al menos uno` };
  if (limpio.some((x) => x.length > 80)) return { error: `${r.etiqueta}: cada renglón, máximo 80 letras` };
  return { ok: limpio };
}

/**
 * Guarda lo que llega del tablero. TODO o nada: si un valor no sirve, no se guarda ninguno y se dice cuál (el
 * tablero no borra lo escrito). null en un valor lo quita del tablero: vuelve a mandar el archivo o la fábrica.
 */
export function guardarReglas(valores: Record<string, unknown>): Guardado {
  const todas = defs();
  const limpios: [string, unknown][] = [];
  for (const [id, v] of Object.entries(valores ?? {})) {
    const r = todas.find((x) => x.id === id);
    if (!r) return { error: `no existe la regla ${id}`, campo: id };
    if (id === 'mant.planes' && planesDelSla() && v !== null) return { error: 'los planes vienen del SLA: se cambian allí', campo: id };
    const l = limpiarValor(r, v);
    if ('error' in l) return { error: l.error, campo: id };
    limpios.push([id, l.ok]);
  }
  for (const [id, v] of limpios) setSetting(LLAVE(id), v);
  return { ok: reglasConValor() };
}

/** Quitar del tablero todo lo de Mantenimientos (vuelve a archivo y fábrica). Para las pruebas y para «Volver todo». */
export function olvidarTablero(): void {
  getDb().prepare("DELETE FROM settings WHERE key LIKE 'reglas.mant.%'").run();
}
