// KPIs y metas: cómo va el negocio contra lo que se propuso, como los objetivos de Dynamics 365.
//
// Todo sale de lo que ya está guardado —quién llegó y cuándo, cada espera y quién la cerró, cada cita, cada cambio
// de etapa—, sin modelo y sin red. Se reutiliza lo que ya calculan otras pantallas en vez de calcularlo dos veces:
// las esperas de tiempos.ts (con el reloj parado fuera del horario), el valor de valor.ts (a mano manda sobre el
// catálogo) y la regla de /ventas para saber CUÁNDO se cerró un trato.
//
// Cuatro decisiones que cambian lo que dicen los números:
//
//  1. 🪤 **Un trato se cierra cuando lo dice su evento, no cuando escribió por última vez.** Es la regla de /ventas:
//     quien compró en agosto y volvió a escribir ayer no es una venta de ayer.
//  2. **Se compara contra el periodo anterior igual de largo.** «12 citas» no dice nada; «12, contra 8 los 30 días
//     anteriores» sí. El valor del embudo es una foto de ahora: no tiene periodo anterior y no se inventa uno.
//  3. **Lo que no se puede medir no se muestra como cero.** Sin citas marcadas no hay asistencia (es null, no 0 %);
//     sin precios, las ventas dicen «Sin precios», no «$0». Cero diría que salió mal; null dice que no se sabe.
//  4. **Por persona solo lo que se puede atribuir de verdad.** Las respuestas son de quien las escribió (cada
//     mensaje guarda su autor). Lo ganado y lo vendido es de quien tiene asignado el contacto: es su cuenta, aunque
//     el cierre lo haya movido el agente de IA. Lo que nadie tiene asignado no se reparte.
import { regla } from '../reglas.js';
import { cuandoPasoA } from './resultados.js';
import { business } from '../config.js';
import { getDb } from '../rag/store.js';
import { esPersona, listContacts, rolDe, type Contact, type Stage } from './contacts.js';
import { getSetting, setSetting } from './settings.js';
import { esperas, type Espera } from './tiempos.js';
import { valorDe, valorDelEmbudo } from './valor.js';

const DIA = 86400_000;

export type KpiId = 'nuevas' | 'respuesta' | 'aTiempo' | 'citas' | 'asistencia' | 'ganados' | 'perdidos' | 'cierre' | 'ventas' | 'embudo';
/** Cómo se lleva la meta: 'acumula' se va sumando en la semana o el mes; 'umbral' es un nivel que hay que sostener. */
export type TipoMeta = 'acumula' | 'umbral';

export interface DefKpi {
  id: KpiId;
  nombre: string;
  /** Qué mide, en una frase, para la tarjeta. */
  que: string;
  unidad: 'n' | 'min' | 'pct' | 'plata';
  /** Hacia dónde es mejor: más citas es mejor; más minutos de respuesta, peor. */
  mejor: 'sube' | 'baja';
  /** Si admite meta y de qué tipo. Perdidos no lleva meta: nadie se propone perder. */
  meta: TipoMeta | null;
}

export const KPIS: DefKpi[] = [
  { id: 'nuevas', nombre: 'Conversaciones nuevas', que: 'Personas que escribieron por primera vez', unidad: 'n', mejor: 'sube', meta: 'acumula' },
  { id: 'respuesta', nombre: 'Tiempo de respuesta', que: 'La mitad se contestó en menos de esto (en horario)', unidad: 'min', mejor: 'baja', meta: 'umbral' },
  { id: 'aTiempo', nombre: 'Contestadas a tiempo', que: 'Dentro del acuerdo de servicio', unidad: 'pct', mejor: 'sube', meta: 'umbral' },
  { id: 'citas', nombre: 'Citas agendadas', que: 'Agendadas en el periodo (no el día de la cita)', unidad: 'n', mejor: 'sube', meta: 'acumula' },
  { id: 'asistencia', nombre: 'Asistencia a citas', que: 'De las citas ya pasadas y marcadas, las que se cumplieron', unidad: 'pct', mejor: 'sube', meta: 'umbral' },
  { id: 'ganados', nombre: 'Tratos ganados', que: 'Pasaron a ganado en el periodo', unidad: 'n', mejor: 'sube', meta: 'acumula' },
  { id: 'perdidos', nombre: 'Tratos perdidos', que: 'Pasaron a perdido en el periodo', unidad: 'n', mejor: 'baja', meta: null },
  { id: 'cierre', nombre: 'Tasa de cierre', que: 'De los tratos cerrados, los que se ganaron', unidad: 'pct', mejor: 'sube', meta: 'umbral' },
  { id: 'ventas', nombre: 'Ventas', que: 'El valor de lo ganado en el periodo', unidad: 'plata', mejor: 'sube', meta: 'acumula' },
  { id: 'embudo', nombre: 'Valor del embudo abierto', que: 'Lo que todavía se puede ganar, hoy', unidad: 'plata', mejor: 'sube', meta: 'umbral' },
];
const DEF = new Map(KPIS.map((k) => [k.id, k]));

// ---------- Las medidas de un periodo ----------

/** Lo que se cerró (ganado o perdido) y cuándo, una vez para todos los periodos. */
interface Cierre {
  contacto: Contact;
  rol: 'ganado' | 'perdido';
  cuando: number;
}

/**
 * 🪤 La misma regla de /ventas, y la misma función (crm/resultados.ts, cuandoPasoA): el cierre es el ÚLTIMO evento
 * que llevó la ficha a ese papel. Si no hay evento (una
 * ficha vieja o importada), se usa la última vez que se vio, que es lo que /ventas hace también.
 */
function cierres(): Cierre[] {
  const out: Cierre[] = [];
  for (const c of listContacts({ limit: 5000 })) {
    const rol = rolDe(c.stage as Stage);
    if (rol !== 'ganado' && rol !== 'perdido') continue;
    out.push({ contacto: c, rol, cuando: cuandoPasoA(c.id, rol) ?? c.lastSeen ?? c.firstSeen ?? 0 });
  }
  return out;
}

export interface Medidas {
  nuevas: number;
  /** Mediana del tiempo hábil de respuesta, en ms. null si no se contestó nada. */
  respuestaMs: number | null;
  respondidas: number;
  /** % contestado dentro del acuerdo. null si no se contestó nada. */
  aTiempo: number | null;
  citas: number;
  /** % de asistencia de las citas pasadas y marcadas. null si no hay ninguna marcada. */
  asistencia: number | null;
  citasMarcadas: number;
  /** Citas que ya pasaron y nadie marcó si vino: se dicen aparte, para que la asistencia no engañe. */
  citasSinMarcar: number;
  ganados: number;
  perdidos: number;
  /** % de cierre: ganados entre cerrados. null si no se cerró nada. */
  cierre: number | null;
  ventas: number;
  /** Cuántos de los ganados tienen precio. Si es 0 con ganados, la cifra es «Sin precios», no «$0». */
  ventasConPrecio: number;
}

const mediana = (v: number[]): number | null => {
  if (!v.length) return null;
  const o = [...v].sort((a, b) => a - b);
  return o[Math.min(o.length - 1, Math.floor(o.length / 2))]!;
};
const pct = (parte: number, total: number): number | null => (total > 0 ? Math.round((parte / total) * 1000) / 10 : null);

function medir(ini: number, fin: number, ahora: number, todas: Espera[], todosLosCierres: Cierre[], acuerdoMin: number): Medidas {
  const db = getDb();
  const nuevas = (db.prepare("SELECT COUNT(*) n FROM users WHERE archived = 0 AND id NOT LIKE '%@g.us' AND first_seen >= ? AND first_seen < ?").get(ini, fin) as { n: number }).n;

  const respondidas = todas.filter((e) => e.hasta !== null && e.desde >= ini && e.desde < fin);
  const tiempos = respondidas.map((e) => e.msHabiles);
  const aTiempo = respondidas.filter((e) => e.msHabiles <= acuerdoMin * 60_000).length;

  const citas = (db.prepare('SELECT COUNT(*) n FROM appointments WHERE created_at >= ? AND created_at < ?').get(ini, fin) as { n: number }).n;
  const pasadas = db
    .prepare("SELECT status, COUNT(*) n FROM appointments WHERE starts_at >= ? AND starts_at < ? AND ends_at <= ? AND status != 'cancelada' GROUP BY status")
    .all(ini, fin, ahora) as { status: string; n: number }[];
  const deEstado = (s: string) => pasadas.find((p) => p.status === s)?.n ?? 0;
  const cumplidas = deEstado('completada');
  const faltaron = deEstado('no_asistio');

  const enPeriodo = todosLosCierres.filter((x) => x.cuando >= ini && x.cuando < fin);
  const ganados = enPeriodo.filter((x) => x.rol === 'ganado');
  const perdidos = enPeriodo.filter((x) => x.rol === 'perdido').length;
  const valores = ganados.map((x) => valorDe(x.contacto).valor);

  return {
    nuevas,
    respuestaMs: mediana(tiempos),
    respondidas: respondidas.length,
    aTiempo: pct(aTiempo, respondidas.length),
    citas,
    asistencia: pct(cumplidas, cumplidas + faltaron),
    citasMarcadas: cumplidas + faltaron,
    citasSinMarcar: deEstado('confirmada'),
    ganados: ganados.length,
    perdidos,
    cierre: pct(ganados.length, ganados.length + perdidos),
    ventas: valores.reduce((a, v) => a + v, 0),
    ventasConPrecio: valores.filter((v) => v > 0).length,
  };
}

/** El valor de un KPI dentro de unas medidas, en su unidad (minutos para la respuesta). null = no se sabe. */
export function valorDeKpi(id: KpiId, m: Medidas, embudo?: number | null): number | null {
  switch (id) {
    case 'nuevas': return m.nuevas;
    case 'respuesta': return m.respuestaMs === null ? null : Math.round((m.respuestaMs / 60_000) * 10) / 10;
    case 'aTiempo': return m.aTiempo;
    case 'citas': return m.citas;
    case 'asistencia': return m.asistencia;
    case 'ganados': return m.ganados;
    case 'perdidos': return m.perdidos;
    case 'cierre': return m.cierre;
    case 'ventas': return m.ganados > 0 && m.ventasConPrecio === 0 ? null : m.ventas;
    case 'embudo': return embudo ?? null;
  }
}

// ---------- El calendario del negocio (para las metas) ----------

/** El instante UTC de la medianoche de un día (año, mes, día) en la zona del negocio. */
function medianoche(anio: number, mes: number, dia: number, zona = business.timezone): number {
  let t = Date.UTC(anio, mes - 1, dia);
  // Dos pasadas por si el desfase cambia ese día (horario de verano): con una, una zona con cambio quedaría corrida.
  for (let i = 0; i < 2; i++) {
    const p = partes(t, zona);
    const comoUtc = Date.UTC(p.anio, p.mes - 1, p.dia, p.hora, p.minuto);
    t -= comoUtc - Date.UTC(anio, mes - 1, dia);
  }
  return t;
}
function partes(ts: number, zona = business.timezone) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false }).formatToParts(new Date(ts));
  const v = (k: string) => f.find((x) => x.type === k)?.value ?? '0';
  const dias: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { anio: Number(v('year')), mes: Number(v('month')), dia: Number(v('day')), hora: Number(v('hour')) % 24, minuto: Number(v('minute')), diaSemana: dias[v('weekday')] ?? 0 };
}

/**
 * Dónde empieza y termina la semana o el mes de hoy, en la zona del negocio. La semana empieza el lunes, como se
 * cuenta aquí. Las metas se llevan por el calendario —«este mes»— y no por «los últimos 30 días»: así se puede
 * decir «va 8 de 20 y faltan 12 días», que es lo que se le pregunta a una meta.
 */
export function periodoDelCalendario(periodo: 'semana' | 'mes', ahora = Date.now(), zona = business.timezone): { desde: number; hasta: number } {
  const p = partes(ahora, zona);
  if (periodo === 'mes') {
    const desde = medianoche(p.anio, p.mes, 1, zona);
    const sig = p.mes === 12 ? { a: p.anio + 1, m: 1 } : { a: p.anio, m: p.mes + 1 };
    return { desde, hasta: medianoche(sig.a, sig.m, 1, zona) };
  }
  const atras = (p.diaSemana + 6) % 7; // lunes = 0
  const lunes = new Date(Date.UTC(p.anio, p.mes - 1, p.dia - atras));
  const desde = medianoche(lunes.getUTCFullYear(), lunes.getUTCMonth() + 1, lunes.getUTCDate(), zona);
  const domingoSig = new Date(Date.UTC(p.anio, p.mes - 1, p.dia - atras + 7));
  return { desde, hasta: medianoche(domingoSig.getUTCFullYear(), domingoSig.getUTCMonth() + 1, domingoSig.getUTCDate(), zona) };
}

// ---------- Las metas ----------

export interface Meta {
  valor: number;
  /** Para las que se acumulan: la semana o el mes del calendario. Las de umbral se miran en el mes. */
  periodo: 'semana' | 'mes';
}
export type Metas = Partial<Record<KpiId, Meta>>;

export const leerMetas = (): Metas => {
  const crudo = getSetting<Record<string, unknown>>('kpis.metas', {});
  const out: Metas = {};
  for (const [k, v] of Object.entries(crudo ?? {})) {
    const d = DEF.get(k as KpiId);
    const m = v as Partial<Meta> | null;
    if (!d?.meta || !m || !Number.isFinite(Number(m.valor)) || Number(m.valor) <= 0) continue;
    out[d.id] = { valor: Number(m.valor), periodo: m.periodo === 'semana' ? 'semana' : 'mes' };
  }
  return out;
};

/**
 * Un número escrito como lo escribe la gente: «$ 1.500.000», «20 citas», «85 %», «4,5». Se limpia en vez de
 * rechazarlo. 🪤 El punto es separador de miles aquí (1.500.000) y la coma, el decimal (4,5): al revés que en
 * inglés. Un solo punto seguido de tres cifras es de miles («1.500»); con otra cantidad de cifras, decimal («4.5»).
 */
export function numeroEscrito(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v ?? '').trim().replace(/[^\d.,-]/g, '');
  if (!s || s === '-') return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Los límites de cada unidad: una meta fuera de esto es un error de dedo, no una meta. */
const LIMITES: Record<DefKpi['unidad'], { min: number; max: number; entero: boolean; dice: string }> = {
  n: { min: 1, max: 100_000, entero: true, dice: 'un número entero mayor que cero' },
  min: { min: 0.5, max: 10_080, dice: 'los minutos, entre medio minuto y una semana', entero: false },
  pct: { min: 1, max: 100, entero: false, dice: 'un porcentaje entre 1 y 100' },
  plata: { min: 1, max: 1e13, entero: true, dice: 'un valor mayor que cero' },
};

/**
 * Valida y limpia lo que llega del tablero. Todo o nada: si una meta está mal, no se guarda ninguna (guardar la
 * mitad de un formulario confunde más que no guardar). Una meta vacía o en 0 se quita.
 */
export function limpiarMetas(entrada: unknown): { metas: Metas } | { error: string; campo: KpiId } {
  const obj = (entrada && typeof entrada === 'object' ? entrada : {}) as Record<string, unknown>;
  const metas: Metas = {};
  for (const [k, crudo] of Object.entries(obj)) {
    const d = DEF.get(k as KpiId);
    if (!d || !d.meta) continue; // lo que no admite meta se ignora, no se guarda
    const m = (crudo && typeof crudo === 'object' ? crudo : { valor: crudo }) as { valor?: unknown; periodo?: unknown };
    const vacio = m.valor === null || m.valor === undefined || String(m.valor).trim() === '';
    if (vacio) continue;
    const n = numeroEscrito(m.valor);
    if (n === 0) continue;
    const l = LIMITES[d.unidad];
    if (n === null || n < l.min || n > l.max) return { error: `${d.nombre}: pon ${l.dice}`, campo: d.id };
    metas[d.id] = { valor: l.entero ? Math.round(n) : Math.round(n * 10) / 10, periodo: m.periodo === 'semana' ? 'semana' : 'mes' };
  }
  return { metas };
}

export function guardarMetas(metas: Metas): Metas {
  setSetting('kpis.metas', metas);
  return leerMetas();
}

export interface AvanceDeMeta {
  kpi: KpiId;
  tipo: TipoMeta;
  meta: number;
  periodo: 'semana' | 'mes';
  /** Lo que va en el periodo del calendario (null si no se sabe: sin respuestas, sin citas marcadas…). */
  valor: number | null;
  desde: number;
  hasta: number;
  /** Cuánto del periodo ya pasó, de 0 a 1. */
  transcurrido: number;
  /** Para las que se acumulan: lo que pedía el ritmo a estas alturas. */
  esperado: number | null;
  estado: 'cumplida' | 'a_tiempo' | 'atrasada' | 'cumple' | 'no_cumple' | 'sin_datos';
}

function avance(id: KpiId, meta: Meta, ahora: number, todas: Espera[], todosLosCierres: Cierre[], acuerdoMin: number, embudo: number | null): AvanceDeMeta {
  const d = DEF.get(id)!;
  const { desde, hasta } = periodoDelCalendario(meta.periodo, ahora);
  const transcurrido = Math.min(1, Math.max(0, (ahora - desde) / (hasta - desde)));
  const valor = valorDeKpi(id, medir(desde, ahora, ahora, todas, todosLosCierres, acuerdoMin), embudo);
  const base = { kpi: id, tipo: d.meta!, meta: meta.valor, periodo: meta.periodo, valor, desde, hasta, transcurrido };
  if (d.meta === 'acumula') {
    const esperado = Math.round(meta.valor * transcurrido * 10) / 10;
    const v = valor ?? 0;
    // 🪤 «Ventas» sin precios no es «va $0»: no se sabe. Sin dato no se juzga el ritmo.
    if (valor === null) return { ...base, esperado, estado: 'sin_datos' };
    return { ...base, esperado, estado: v >= meta.valor ? 'cumplida' : v >= esperado ? 'a_tiempo' : 'atrasada' };
  }
  if (valor === null) return { ...base, esperado: null, estado: 'sin_datos' };
  const cumple = d.mejor === 'baja' ? valor <= meta.valor : valor >= meta.valor;
  return { ...base, esperado: null, estado: cumple ? 'cumple' : 'no_cumple' };
}

// ---------- Por persona ----------

export interface FilaPersona {
  nombre: string;
  /** Tratos abiertos que tiene asignados hoy. */
  asignados: number;
  /** Ganados en el periodo de lo que tiene asignado. */
  ganados: number;
  /** El valor de esos ganados, y cuántos tenían precio. */
  ventas: number;
  ventasConPrecio: number;
  /** Citas agendadas en el periodo para lo que tiene asignado. */
  citas: number;
  /** Esperas que cerró con su respuesta en el periodo, y su mediana. */
  respuestas: number;
  respuestaMs: number | null;
}

function porPersona(ini: number, fin: number, todas: Espera[], todosLosCierres: Cierre[]): FilaPersona[] {
  const n = (s: string | null | undefined) => (s ?? '').trim();
  const clave = (s: string) => s.toLowerCase();
  const filas = new Map<string, FilaPersona>();
  const fila = (nombre: string): FilaPersona => {
    const k = clave(nombre);
    let f = filas.get(k);
    if (!f) filas.set(k, (f = { nombre, asignados: 0, ganados: 0, ventas: 0, ventasConPrecio: 0, citas: 0, respuestas: 0, respuestaMs: null }));
    return f;
  };
  const tiempos = new Map<string, number[]>();

  for (const c of listContacts({ limit: 5000 })) {
    const r = n(c.responsable);
    if (!esPersona(r)) continue;
    const rol = rolDe(c.stage as Stage);
    if (rol !== 'ganado' && rol !== 'perdido') fila(r).asignados++;
  }
  for (const x of todosLosCierres) {
    if (x.rol !== 'ganado' || x.cuando < ini || x.cuando >= fin) continue;
    const r = n(x.contacto.responsable);
    if (!esPersona(r)) continue;
    const v = valorDe(x.contacto).valor;
    const f = fila(r);
    f.ganados++;
    f.ventas += v;
    if (v > 0) f.ventasConPrecio++;
  }
  const citas = getDb()
    .prepare("SELECT u.responsable r, COUNT(*) n FROM appointments a JOIN users u ON u.id = a.user_id WHERE a.created_at >= ? AND a.created_at < ? AND u.responsable IS NOT NULL AND u.responsable != '' GROUP BY u.responsable")
    .all(ini, fin) as { r: string; n: number }[];
  for (const c of citas) if (esPersona(c.r)) fila(n(c.r)).citas += c.n;
  for (const e of todas) {
    if (e.hasta === null || e.quien !== 'persona' || e.desde < ini || e.desde >= fin) continue;
    const quien = n(e.por);
    if (!esPersona(quien)) continue;
    fila(quien).respuestas++;
    const k = clave(quien);
    tiempos.set(k, [...(tiempos.get(k) ?? []), e.msHabiles]);
  }
  for (const [k, f] of filas) f.respuestaMs = mediana(tiempos.get(k) ?? []);
  // Primero lo que se ganó; a igualdad, quien más contestó. Es el orden de un tablero de rendimiento.
  return [...filas.values()].sort((a, b) => b.ganados - a.ganados || b.ventas - a.ventas || b.respuestas - a.respuestas || a.nombre.localeCompare(b.nombre, 'es'));
}

// ---------- Todo junto ----------

export interface Kpis {
  dias: number;
  desde: number;
  hasta: number;
  zona: string;
  moneda: string;
  acuerdoMin: number;
  definiciones: DefKpi[];
  actual: Medidas;
  anterior: Medidas;
  /** Cada KPI en su unidad (null = no se sabe), para que la pantalla no repita la regla de valorDeKpi. */
  valores: { actual: Record<KpiId, number | null>; anterior: Record<KpiId, number | null> };
  /** El embudo abierto es una foto de hoy: no tiene periodo anterior. */
  embudo: { total: number | null; conValor: number; sinValor: number; catalogoSinPrecios: boolean };
  /** Lo que sigue esperando respuesta ahora mismo. */
  esperandoAhora: number;
  porPersona: FilaPersona[];
  /** El agente de IA, aparte: compararlo con las personas mezcla dos cosas distintas, pero verlo al lado ayuda. */
  agente: { nombre: string; respuestas: number; respuestaMs: number | null };
  metas: Metas;
  avance: AvanceDeMeta[];
}

/** Los KPIs de los últimos `dias` días (7, 30 o 90) contra los `dias` anteriores, y el avance de las metas. */
export function calcularKpis(opts: { dias?: number; acuerdoMin?: number; ahora?: number } = {}): Kpis {
  const dias = [7, 30, 90].includes(Number(opts.dias)) ? Number(opts.dias) : 30;
  const ahora = opts.ahora ?? Date.now();
  const acuerdoMin = opts.acuerdoMin ?? regla<number>('atencion.acuerdoMinutos');
  const ini = ahora - dias * DIA;
  const iniAnterior = ini - dias * DIA;
  const metas = leerMetas();
  // Las esperas se reconstruyen UNA vez, desde lo más viejo que haga falta (el periodo anterior o el inicio del
  // mes de una meta), y cada medida filtra las suyas. Reconstruirlas por periodo era recorrer los mensajes tres veces.
  const inicioMetas = Math.min(periodoDelCalendario('mes', ahora).desde, periodoDelCalendario('semana', ahora).desde);
  const todas = esperas({ desde: Math.min(iniAnterior, inicioMetas), ahora });
  const todosLosCierres = cierres();
  const e = valorDelEmbudo();
  const embudoTotal = e.conValor > 0 ? e.total : null;

  const agenteRespuestas = todas.filter((x) => x.hasta !== null && x.quien === 'xencrm' && x.desde >= ini && x.desde < ahora);
  const actual = medir(ini, ahora, ahora, todas, todosLosCierres, acuerdoMin);
  const anterior = medir(iniAnterior, ini, ahora, todas, todosLosCierres, acuerdoMin);
  const valores = (m: Medidas, embudo: number | null) => Object.fromEntries(KPIS.map((k) => [k.id, valorDeKpi(k.id, m, embudo)])) as Record<KpiId, number | null>;
  return {
    dias,
    desde: ini,
    hasta: ahora,
    zona: business.timezone,
    moneda: business.business.currency,
    acuerdoMin,
    definiciones: KPIS,
    actual,
    anterior,
    // El embudo es una foto de hoy: en el periodo anterior no se sabe (null), no se inventa.
    valores: { actual: valores(actual, embudoTotal), anterior: valores(anterior, null) },
    embudo: { total: embudoTotal, conValor: e.conValor, sinValor: e.sinValor, catalogoSinPrecios: e.catalogoSinPrecios },
    esperandoAhora: todas.filter((x) => x.hasta === null).length,
    porPersona: porPersona(ini, ahora, todas, todosLosCierres),
    agente: { nombre: business.agent.name, respuestas: agenteRespuestas.length, respuestaMs: mediana(agenteRespuestas.map((x) => x.msHabiles)) },
    metas,
    avance: (Object.entries(metas) as [KpiId, Meta][]).map(([id, m]) => avance(id, m, ahora, todas, todosLosCierres, acuerdoMin, embudoTotal)),
  };
}
