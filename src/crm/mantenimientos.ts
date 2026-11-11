// Mantenimientos y actualizaciones (Servicio): lo que se va a tocar, a quién afecta y si se le avisó a tiempo.
//
// Una firma de software le promete a cada cliente, según su plan de soporte, dos cosas que no son tickets: que un
// mantenimiento se avisa con tiempo y que cada aplicación recibe sus actualizaciones. Esto lleva las dos cuentas, sin
// modelo y sin red: qué está programado, quiénes quedan afectados, a quién ya se le avisó y cuándo, y qué aplicación
// lleva demasiado sin actualizarse.
//
// 🪤 NADA de negocio está fijo aquí: los planes y su aviso mínimo, la cadencia de cada aplicación, los estados, quién
// cuenta como cliente afectado, la plantilla del aviso, cuándo cuenta el aviso y quién programa salen de las reglas
// (crm/mantenimientos-reglas.ts: fábrica → xencrm.config.json › servicio.mantenimientos → tablero).
//
// 🪤 El aviso NUNCA sale solo. «Preparar aviso» deja el mensaje escrito en la conversación de cada cliente afectado
// (como lo que XENCRM deja listo: crm/propuestas.ts) y alguien del equipo lo lee y lo manda. De fábrica cuenta como
// dado cuando de verdad salió (la propuesta se mandó y el mensaje no quedó marcado como «no le llegó») o cuando alguien
// dice que avisó por otro medio, con su nombre. Una regla puede hacer que cuente al prepararse.
//
// 🪤 Los AFECTADOS se calculan en cada lectura, no se guardan: si alguien cambia de plan, de aplicación o de etapa, o se
// cambia una regla, la lista cambia sola. Lo único que se guarda por cliente es su aviso.
import { business } from '../config.js';
import { getDb } from '../rag/store.js';
import { getContact, listContacts, rolDe, type Contact } from './contacts.js';
import {
  avisoCuentaAl,
  cadenciaDe,
  clave,
  estadosDeActualizacion,
  estadosDeMantenimiento,
  periodoDias,
  plantillaDelAviso,
  planes,
  productos,
  programarEsDelEquipo,
  reglaAfectados,
  toleranciaDias,
  VARIABLES_AVISO,
  type PapelAct,
  type PapelMant,
  type PlanConfig,
} from './mantenimientos-reglas.js';
import { proponer } from './propuestas.js';

const HORA = 3600_000;
const DIA = 24 * HORA;

const sinTildes = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// ---------- el plan ----------

/**
 * El plan de soporte escrito como lo escriba la gente («Pro», «plan pro», «ENTERPRISE», «Básico»), contra los planes
 * configurados. Primero el nombre exacto; si no, el plan cuyas palabras están todas en lo escrito (el de nombre más
 * largo primero, para que «Pro Plus» no se lea como «Pro»). null si no tiene o no se reconoce: sin plan no hay aviso
 * comprometido, y se dice así.
 */
export function planDe(valor: unknown, lista: PlanConfig[] = planes()): PlanConfig | null {
  const k = clave(String(valor ?? ''));
  if (!k) return null;
  const exacto = lista.find((p) => p.id === k);
  if (exacto) return exacto;
  const palabras = new Set(k.split('_'));
  return [...lista].sort((a, b) => b.id.length - a.id.length).find((p) => p.id.split('_').every((w) => palabras.has(w))) ?? null;
}

// ---------- el producto ----------

const tokens = (s: string, genericas: string[]): string[] => sinTildes(s).split(/[^a-z0-9]+/).filter((w) => w && !genericas.includes(w));

/**
 * ¿La aplicación del cliente es la del mantenimiento? Según la regla:
 * - «palabras» (de fábrica): coincide si TODAS las palabras que distinguen al producto del mantenimiento («pos» en
 *   «XENTRIS POS») están en lo que dice la ficha. Así «XENTRIS POS + Stock» cuenta para POS y para Stock, y la marca
 *   sola no hace coincidir nada.
 * - «contiene»: el nombre entero del producto aparece en la ficha.
 * - «exacta»: la ficha dice exactamente el producto.
 * Un mantenimiento sin aplicación toca a todas, salvo que la regla diga que no.
 */
export function productoCoincide(delMantenimiento: string, delCliente: unknown, r = reglaAfectados()): boolean {
  const m = delMantenimiento.trim();
  if (!m) return r.sinProductoTocaATodos;
  const c = String(delCliente ?? '');
  if (r.comparacion === 'exacta') return sinTildes(c) === sinTildes(m);
  if (r.comparacion === 'contiene') return sinTildes(c).includes(sinTildes(m));
  const buscadas = tokens(m, r.palabrasGenericas);
  if (!buscadas.length) return r.sinProductoTocaATodos;
  const tiene = new Set(tokens(c, r.palabrasGenericas));
  return buscadas.every((w) => tiene.has(w));
}

// ---------- las tablas ----------

let lista = false;
function db() {
  const d = getDb();
  if (!lista) {
    d.exec(`
      -- Mantenimientos programados. Ver crm/mantenimientos.ts. planes: las claves de los planes afectados.
      CREATE TABLE IF NOT EXISTS mantenimientos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        titulo TEXT NOT NULL,
        producto TEXT NOT NULL DEFAULT '',
        inicio INTEGER NOT NULL,
        duracion_min INTEGER NOT NULL,
        planes TEXT NOT NULL DEFAULT '[]',
        estado TEXT NOT NULL DEFAULT 'programado',
        notas TEXT NOT NULL DEFAULT '',
        demo INTEGER NOT NULL DEFAULT 0,
        creado INTEGER NOT NULL,
        por TEXT NOT NULL DEFAULT '',
        actualizado INTEGER
      );
      -- El aviso de un mantenimiento a cada cliente: cuándo se preparó, cuándo salió de verdad, cómo y quién.
      CREATE TABLE IF NOT EXISTS mantenimiento_avisos (
        mantenimiento_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        propuesta_id INTEGER,
        preparado INTEGER,
        avisado INTEGER,
        como TEXT,
        por TEXT,
        mensaje_id INTEGER,
        PRIMARY KEY (mantenimiento_id, user_id)
      );
      -- Las actualizaciones de cada aplicación, publicadas o planeadas.
      CREATE TABLE IF NOT EXISTS actualizaciones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version TEXT NOT NULL,
        producto TEXT NOT NULL,
        fecha INTEGER NOT NULL,
        notas TEXT NOT NULL DEFAULT '',
        estado TEXT NOT NULL DEFAULT 'publicada',
        demo INTEGER NOT NULL DEFAULT 0,
        creado INTEGER NOT NULL,
        por TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS mantenimientos_inicio ON mantenimientos(inicio);
      CREATE INDEX IF NOT EXISTS actualizaciones_producto ON actualizaciones(producto, fecha);
    `);
    lista = true;
  }
  return d;
}

// ---------- los estados ----------

/** El papel de un estado guardado. Uno que ya no está en la configuración se lee como «programado» (no se pierde). */
function papelMant(estado: string): PapelMant {
  return estadosDeMantenimiento().find((e) => e.id === estado)?.papel ?? 'programado';
}
function papelAct(estado: string): PapelAct {
  return estadosDeActualizacion().find((e) => e.id === estado)?.papel ?? 'publicada';
}
/** El primer estado que cumple un papel (para crear con «programado» o «publicada» de fábrica). */
const estadoConPapelMant = (p: PapelMant): string => estadosDeMantenimiento().find((e) => e.papel === p)?.id ?? p;
const estadoConPapelAct = (p: PapelAct): string => estadosDeActualizacion().find((e) => e.papel === p)?.id ?? p;

// ---------- mantenimientos ----------

export interface Mantenimiento {
  id: number;
  titulo: string;
  producto: string;
  inicio: number;
  duracionMin: number;
  fin: number;
  /** Las claves de los planes afectados. */
  planes: string[];
  /** El estado guardado (su id) y el papel que cumple. */
  estado: string;
  papel: PapelMant;
  notas: string;
  demo: boolean;
  creado: number;
  por: string;
}

type FilaMant = { id: number; titulo: string; producto: string; inicio: number; duracion_min: number; planes: string; estado: string; notas: string; demo: number; creado: number; por: string };
const aMant = (r: FilaMant): Mantenimiento => {
  let planesGuardados: string[] = [];
  try { planesGuardados = (JSON.parse(r.planes) as string[]).map((p) => clave(String(p))).filter(Boolean); } catch { /* lista rota: sin planes */ }
  return {
    id: r.id, titulo: r.titulo, producto: r.producto, inicio: r.inicio, duracionMin: r.duracion_min, fin: r.inicio + r.duracion_min * 60_000,
    planes: planesGuardados, estado: r.estado, papel: papelMant(r.estado), notas: r.notas, demo: Boolean(r.demo), creado: r.creado, por: r.por,
  };
};

export function verMantenimiento(id: number): Mantenimiento | null {
  const r = db().prepare('SELECT * FROM mantenimientos WHERE id = ?').get(id) as FilaMant | undefined;
  return r ? aMant(r) : null;
}
export function listarMantenimientos(): Mantenimiento[] {
  return (db().prepare('SELECT * FROM mantenimientos ORDER BY inicio').all() as FilaMant[]).map(aMant);
}

/** Lo que llega del tablero, limpio. Todo o nada: si algo no sirve, no se guarda nada y se dice qué. */
export interface DatosMant { titulo?: unknown; producto?: unknown; inicio?: unknown; duracionMin?: unknown; planes?: unknown; estado?: unknown; notas?: unknown }
export type Limpio<T> = { ok: T } | { error: string; campo: string };
type CamposMant = Pick<Mantenimiento, 'titulo' | 'producto' | 'inicio' | 'duracionMin' | 'planes' | 'estado' | 'notas'>;

export function limpiarMantenimiento(b: DatosMant, parcial = false): Limpio<Partial<CamposMant>> {
  const out: Partial<CamposMant> = {};
  if (b.titulo !== undefined || !parcial) {
    const t = String(b.titulo ?? '').replace(/\s+/g, ' ').trim();
    if (t.length < 3) return { error: 'ponle un título de al menos 3 letras', campo: 'titulo' };
    out.titulo = t.slice(0, 120);
  }
  if (b.producto !== undefined || !parcial) out.producto = String(b.producto ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (b.inicio !== undefined || !parcial) {
    const n = typeof b.inicio === 'number' ? b.inicio : Date.parse(String(b.inicio ?? ''));
    if (!Number.isFinite(n) || n <= 0) return { error: 'falta la fecha y la hora de inicio', campo: 'inicio' };
    out.inicio = Math.round(n);
  }
  if (b.duracionMin !== undefined || !parcial) {
    const n = Math.round(Number(String(b.duracionMin ?? '').replace(',', '.')));
    if (!Number.isFinite(n) || n < 5 || n > 72 * 60) return { error: 'la duración va de 5 minutos a 72 horas', campo: 'duracionMin' };
    out.duracionMin = n;
  }
  if (b.planes !== undefined || !parcial) {
    const lista = planes();
    const crudo = Array.isArray(b.planes) ? b.planes : String(b.planes ?? '').split(/[,;]/);
    const elegidos = [...new Set(crudo.map((x) => planDe(x, lista)?.id).filter((p): p is string => Boolean(p)))];
    if (!elegidos.length) return { error: 'elige al menos un plan afectado', campo: 'planes' };
    out.planes = lista.map((p) => p.id).filter((id) => elegidos.includes(id));
  }
  if (b.estado !== undefined) {
    const e = String(b.estado);
    if (!estadosDeMantenimiento().some((x) => x.id === e)) return { error: 'ese estado no existe', campo: 'estado' };
    out.estado = e;
  }
  if (b.notas !== undefined) out.notas = String(b.notas ?? '').trim().slice(0, 600);
  return { ok: out };
}

export function crearMantenimiento(b: DatosMant, por = '', now = Date.now(), demo = false): Limpio<Mantenimiento> {
  const l = limpiarMantenimiento(b);
  if ('error' in l) return l;
  const v = l.ok;
  const id = Number(
    db()
      .prepare('INSERT INTO mantenimientos (titulo, producto, inicio, duracion_min, planes, estado, notas, demo, creado, por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(v.titulo ?? '', v.producto ?? '', v.inicio ?? 0, v.duracionMin ?? 0, JSON.stringify(v.planes ?? []), v.estado ?? estadoConPapelMant('programado'), v.notas ?? '', demo ? 1 : 0, now, por).lastInsertRowid,
  );
  return { ok: verMantenimiento(id)! };
}

export function cambiarMantenimiento(id: number, b: DatosMant, por = '', now = Date.now()): Limpio<Mantenimiento> | null {
  const antes = verMantenimiento(id);
  if (!antes) return null;
  const l = limpiarMantenimiento(b, true);
  if ('error' in l) return l;
  const v = { ...antes, ...l.ok };
  db()
    .prepare('UPDATE mantenimientos SET titulo = ?, producto = ?, inicio = ?, duracion_min = ?, planes = ?, estado = ?, notas = ?, actualizado = ?, por = ? WHERE id = ?')
    .run(v.titulo, v.producto, v.inicio, v.duracionMin, JSON.stringify(v.planes), v.estado, v.notas, now, por || antes.por, id);
  return { ok: verMantenimiento(id)! };
}

// ---------- quiénes quedan afectados y cómo va su aviso ----------

export type EstadoAviso =
  /** Salió antes del plazo de su plan. */
  | 'a_tiempo'
  /** Salió, pero después del plazo. */
  | 'tarde'
  /** Se preparó y la propuesta espera en su conversación: falta que alguien la mande. */
  | 'preparado'
  /** Alguien lo mandó, pero el mensaje no le llegó (el canal no estaba conectado o lo rechazó): hay que reintentarlo. */
  | 'no_salio'
  /** Nadie le ha avisado y todavía hay tiempo. */
  | 'por_avisar'
  /** Ya pasó el plazo y el mantenimiento no ha empezado: hay que avisar ya, aunque sea tarde. */
  | 'atrasado'
  /** El mantenimiento pasó (o empezó) y nunca se le avisó. */
  | 'sin_aviso';

export interface Afectado {
  id: string;
  nombre: string;
  empresa: string;
  /** La clave del plan y cómo se dice. */
  plan: string;
  planNombre: string;
  producto: string;
  /** Hasta cuándo hay que avisarle para cumplir su plan. */
  plazo: number;
  estado: EstadoAviso;
  preparado: number | null;
  avisado: number | null;
  /** «mensaje» (salió por la conversación), «preparado» (la regla lo cuenta al prepararse) u «otro medio». */
  como: string | null;
  por: string | null;
}

type FilaAviso = { mantenimiento_id: number; user_id: string; propuesta_id: number | null; preparado: number | null; avisado: number | null; como: string | null; por: string | null; mensaje_id: number | null };

/**
 * Lo que pasó con la propuesta del aviso. 🪤 La propuesta vive en otra tabla y puede cambiar sin pasar por aquí:
 * alguien la mandó desde la conversación (enviada), la descartó, o XENCRM dejó otra respuesta encima (reemplazada).
 */
function estadoDePropuesta(id: number | null): { estado: string; resuelto: number | null; por: string | null } | null {
  if (!id) return null;
  try {
    return (getDb().prepare('SELECT estado, resuelto, por FROM propuestas WHERE id = ?').get(id) as { estado: string; resuelto: number | null; por: string | null } | undefined) ?? null;
  } catch {
    return null; // la tabla de propuestas nace con la primera; sin ella no hay nada preparado
  }
}

/**
 * El mensaje que salió cuando alguien mandó la propuesta del aviso: el último del asistente en esa conversación
 * entre que se preparó y que se cerró. 🪤 «Enviada» en la propuesta no quiere decir que llegó: con el canal sin
 * conectar, el mensaje se guarda igual y queda marcado («no le llegó»). Solo cuenta lo que de verdad salió.
 */
function mensajeDelAviso(userId: string, desde: number, hasta: number): { id: number; ts: number; fallo: string | null } | null {
  return (
    (getDb()
      .prepare("SELECT id, ts, fallo FROM messages WHERE user_id = ? AND role = 'assistant' AND ts >= ? AND ts <= ? ORDER BY ts DESC LIMIT 1")
      .get(userId, desde, hasta + 5000) as { id: number; ts: number; fallo: string | null } | undefined) ?? null
  );
}
const mensajePorId = (userId: string, id: number) =>
  (getDb().prepare('SELECT id, ts, fallo FROM messages WHERE id = ? AND user_id = ?').get(id, userId) as { id: number; ts: number; fallo: string | null } | undefined) ?? null;

function avisosDe(mantId: number): Map<string, FilaAviso> {
  const filas = db().prepare('SELECT * FROM mantenimiento_avisos WHERE mantenimiento_id = ?').all(mantId) as FilaAviso[];
  const m = new Map<string, FilaAviso>();
  const apuntar = (f: FilaAviso, avisado: number | null, mensajeId: number | null, por: string | null) => {
    db()
      .prepare("UPDATE mantenimiento_avisos SET avisado = ?, como = CASE WHEN ? IS NULL THEN como ELSE 'mensaje' END, por = ?, mensaje_id = ? WHERE mantenimiento_id = ? AND user_id = ?")
      .run(avisado, avisado, por, mensajeId, mantId, f.user_id);
    f.avisado = avisado;
    if (avisado) f.como = 'mensaje';
    f.por = por;
    f.mensaje_id = mensajeId;
  };
  for (const f of filas) {
    if (!f.avisado && f.mensaje_id) {
      // Ya se había mandado y no salió: si alguien lo reintentó y salió, queda avisado. 🪤 El reintento no guarda su
      // hora; cuenta la del mensaje, que es cuando alguien quiso avisar (de más a tiempo por lo que tardó el reintento).
      const msg = mensajePorId(f.user_id, f.mensaje_id);
      if (msg && !msg.fallo) apuntar(f, msg.ts, msg.id, f.por);
    } else if (!f.avisado && f.propuesta_id && f.preparado) {
      const p = estadoDePropuesta(f.propuesta_id);
      if (p?.estado === 'enviada' && p.resuelto) {
        const msg = mensajeDelAviso(f.user_id, f.preparado, p.resuelto);
        if (msg && !msg.fallo) apuntar(f, msg.ts, msg.id, p.por || f.por);
        else if (msg) apuntar(f, null, msg.id, p.por || f.por); // se mandó y no llegó: «No salió»
      }
    }
    m.set(f.user_id, f);
  }
  return m;
}

const nombreDe = (c: Contact): string => (c.name || '').trim() || (c.phone ? String(c.phone) : 'Sin nombre');

/** Los contactos que pueden recibir avisos según la regla (papeles de etapa, etapas concretas, archivados). */
function candidatos(r = reglaAfectados()): Contact[] {
  const todos = listContacts({ limit: 5000 }).concat(r.incluirArchivados ? listContacts({ limit: 5000, archived: true }) : []);
  return todos.filter((c) => r.roles.includes(rolDe(c.stage) ?? '') || r.etapas.includes(c.stage));
}

/** Los clientes a los que toca este mantenimiento, con el estado de su aviso. */
export function afectadosDe(m: Mantenimiento, now = Date.now()): Afectado[] {
  if (m.papel === 'cancelado') return [];
  const r = reglaAfectados();
  const lista = planes();
  const cuentaAlPreparar = avisoCuentaAl() === 'preparar';
  const avisos = avisosDe(m.id);
  const out: Afectado[] = [];
  for (const c of candidatos(r)) {
    const plan = planDe(c.data?.[r.campoPlan], lista);
    if (!plan || !m.planes.includes(plan.id)) continue;
    if (!productoCoincide(m.producto, c.data?.[r.campoProducto], r)) continue;
    const plazo = m.inicio - plan.avisoHoras * HORA;
    const a = avisos.get(c.id);
    // Con la regla «cuenta al prepararse», lo preparado ya es avisado (a la hora en que se preparó).
    const avisado = a?.avisado ?? (cuentaAlPreparar && a?.preparado && !a?.mensaje_id ? a.preparado : null);
    const como = a?.avisado ? (a.como ?? null) : avisado ? 'preparado' : null;
    let estado: EstadoAviso;
    if (avisado) estado = avisado <= plazo ? 'a_tiempo' : 'tarde';
    else if (now >= m.inicio) estado = 'sin_aviso';
    else if (a?.mensaje_id) estado = 'no_salio';
    else if (a?.propuesta_id && estadoDePropuesta(a.propuesta_id)?.estado === 'pendiente') estado = 'preparado';
    else estado = now <= plazo ? 'por_avisar' : 'atrasado';
    out.push({
      id: c.id, nombre: nombreDe(c), empresa: String(c.data?.empresa ?? ''), plan: plan.id, planNombre: plan.nombre, producto: String(c.data?.[r.campoProducto] ?? ''),
      plazo, estado, preparado: a?.preparado ?? null, avisado, como, por: a?.por ?? null,
    });
  }
  return out.sort((x, y) => x.plazo - y.plazo || x.nombre.localeCompare(y.nombre, 'es'));
}

export type Momento = 'proximo' | 'en_curso' | 'pasado' | 'cancelado';

export interface MantenimientoConAvisos extends Mantenimiento {
  /** Dónde está en el tiempo (lo que se ve), aparte de lo guardado. */
  momento: Momento;
  afectados: Afectado[];
  resumen: { afectados: number; avisados: number; aTiempo: number; tarde: number; preparados: number; noSalio: number; porAvisar: number; atrasados: number; sinAviso: number };
  /** El primer plazo que falta cumplir (el más cercano de quien no tiene aviso). */
  proximoPlazo: number | null;
  /** Cómo va su aviso, en una palabra que el tablero dice. */
  aviso: 'sin_afectados' | 'a_tiempo' | 'tarde' | 'sin_aviso' | 'pendiente';
}

export function conAvisos(m: Mantenimiento, now = Date.now()): MantenimientoConAvisos {
  const afectados = afectadosDe(m, now);
  const cuenta = (e: EstadoAviso) => afectados.filter((a) => a.estado === e).length;
  const resumen = {
    afectados: afectados.length,
    avisados: afectados.filter((a) => a.avisado).length,
    aTiempo: cuenta('a_tiempo'),
    tarde: cuenta('tarde'),
    preparados: cuenta('preparado'),
    noSalio: cuenta('no_salio'),
    porAvisar: cuenta('por_avisar'),
    atrasados: cuenta('atrasado'),
    sinAviso: cuenta('sin_aviso'),
  };
  const momento: Momento = m.papel === 'cancelado' ? 'cancelado' : m.papel === 'hecho' || now >= m.fin ? 'pasado' : now >= m.inicio || m.papel === 'en_curso' ? 'en_curso' : 'proximo';
  const faltan = afectados.filter((a) => !a.avisado);
  const aviso: MantenimientoConAvisos['aviso'] = !afectados.length ? 'sin_afectados' : resumen.sinAviso ? 'sin_aviso' : faltan.length ? 'pendiente' : resumen.tarde ? 'tarde' : 'a_tiempo';
  return { ...m, momento, afectados, resumen, proximoPlazo: faltan.length ? Math.min(...faltan.map((a) => a.plazo)) : null, aviso };
}

// ---------- el aviso ----------

const fmt = (ts: number, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('es-CO', { timeZone: business.timezone, ...opts }).format(ts);
export const duracionEnPalabras = (min: number): string => (min >= 60 ? (min % 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min / 60} h`) : `${min} min`);

export interface DatosDelAviso { nombre: string; empresa?: string; plan?: string; titulo: string; producto: string; inicio: number; fin: number; duracionMin: number; notas?: string }

/**
 * La plantilla con sus variables puestas, en la hora del negocio. Una variable vacía no deja huecos («Hola .»): se
 * cierran los espacios que sobran. Lo que no es una variable conocida se deja tal cual (la validación ya lo avisó).
 */
export function llenarAviso(plantilla: string, d: DatosDelAviso): string {
  const valores: Record<string, string> = {
    nombre: d.nombre,
    primerNombre: d.nombre.split(/\s+/)[0] ?? '',
    empresa: d.empresa ?? '',
    plan: d.plan ?? '',
    titulo: d.titulo,
    producto: d.producto || 'nuestras aplicaciones',
    dia: fmt(d.inicio, { weekday: 'long', day: 'numeric', month: 'long' }),
    inicio: fmt(d.inicio, { hour: 'numeric', minute: '2-digit' }),
    fin: fmt(d.fin, { hour: 'numeric', minute: '2-digit' }),
    duracion: duracionEnPalabras(d.duracionMin),
    notas: d.notas ?? '',
    negocio: business.business.name,
  };
  return plantilla
    .replace(/\{([a-zA-Z]+)\}/g, (todo, n: string) => (n in valores ? valores[n]! : todo))
    .replace(/[ \t]+([.,;:!?)])/g, '$1')
    .replace(/\([ \t]*\)/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function textoDelAviso(m: Mantenimiento, a: { nombre: string; empresa?: string; planNombre?: string }, plantilla = plantillaDelAviso()): string {
  return llenarAviso(plantilla, { nombre: a.nombre, empresa: a.empresa, plan: a.planNombre, titulo: m.titulo, producto: m.producto, inicio: m.inicio, fin: m.fin, duracionMin: m.duracionMin, notas: m.notas });
}

/** La vista previa de una plantilla: con el primer afectado del próximo mantenimiento, o con un ejemplo. */
export function vistaPreviaDelAviso(plantilla: string, now = Date.now()): { texto: string; con: string } {
  for (const m of listarMantenimientos()) {
    if (m.fin < now || m.papel === 'cancelado') continue;
    const a = afectadosDe(m, now)[0];
    if (a) return { texto: textoDelAviso(m, a, plantilla), con: `${a.nombre} · ${m.titulo}` };
  }
  const inicio = Math.ceil((now + 3 * DIA) / HORA) * HORA;
  const ejemplo: DatosDelAviso = { nombre: 'Laura Gómez', empresa: 'Ferretería El Tornillo', plan: planes()[1]?.nombre ?? planes()[0]?.nombre ?? '', titulo: 'Migración de la base', producto: productos()[0] ?? '', inicio, fin: inicio + 2 * HORA, duracionMin: 120 };
  return { texto: llenarAviso(plantilla, ejemplo), con: 'un cliente de ejemplo' };
}

/**
 * Deja el aviso escrito en la conversación de cada afectado que todavía no lo tiene (o solo de los que se pidan).
 * NO lo manda: queda como propuesta para que alguien lo lea y lo mande. Devuelve a quiénes se les preparó.
 */
export function prepararAvisos(id: number, opts: { soloIds?: string[]; por?: string; now?: number } = {}): { preparados: string[]; omitidos: { id: string; porque: string }[] } | null {
  const m = verMantenimiento(id);
  if (!m) return null;
  const now = opts.now ?? Date.now();
  const preparados: string[] = [];
  const omitidos: { id: string; porque: string }[] = [];
  for (const a of conAvisos(m, now).afectados) {
    if (opts.soloIds && !opts.soloIds.includes(a.id)) continue;
    if (a.avisado) { omitidos.push({ id: a.id, porque: 'ya se le avisó' }); continue; }
    if (a.estado === 'sin_aviso') { omitidos.push({ id: a.id, porque: 'el mantenimiento ya empezó' }); continue; }
    if (a.estado === 'preparado') { omitidos.push({ id: a.id, porque: 'ya tiene el aviso listo en su conversación' }); continue; }
    if (a.estado === 'no_salio') { omitidos.push({ id: a.id, porque: 'el aviso se mandó y no le llegó: reinténtalo desde su conversación' }); continue; }
    const p = proponer(a.id, textoDelAviso(m, a), 'aviso_mantenimiento', '', `Aviso de mantenimiento: ${m.titulo}`);
    db()
      .prepare(
        'INSERT INTO mantenimiento_avisos (mantenimiento_id, user_id, propuesta_id, preparado, por) VALUES (?, ?, ?, ?, ?) ' +
          'ON CONFLICT(mantenimiento_id, user_id) DO UPDATE SET propuesta_id = excluded.propuesta_id, preparado = excluded.preparado, por = excluded.por, mensaje_id = NULL',
      )
      .run(id, a.id, p.id, now, opts.por ?? '');
    preparados.push(a.id);
  }
  return { preparados, omitidos };
}

/** Avisó por otro medio (un correo, una llamada): lo dice alguien con su nombre, y desde ese momento cuenta. */
export function marcarAvisado(id: number, userId: string, por: string, now = Date.now()): Limpio<true> | null {
  const m = verMantenimiento(id);
  if (!m) return null;
  if (!getContact(userId)) return { error: 'ese contacto no existe', campo: 'userId' };
  if (!por.trim()) return { error: 'falta quién avisó', campo: 'por' };
  db()
    .prepare(
      "INSERT INTO mantenimiento_avisos (mantenimiento_id, user_id, avisado, como, por) VALUES (?, ?, ?, 'otro medio', ?) " +
        "ON CONFLICT(mantenimiento_id, user_id) DO UPDATE SET avisado = excluded.avisado, como = 'otro medio', por = excluded.por",
    )
    .run(id, userId, now, por.trim());
  return { ok: true };
}

// ---------- actualizaciones ----------

export interface Actualizacion { id: number; version: string; producto: string; fecha: number; notas: string; estado: string; papel: PapelAct; demo: boolean; creado: number; por: string }
type FilaAct = { id: number; version: string; producto: string; fecha: number; notas: string; estado: string; demo: number; creado: number; por: string };
const aAct = (r: FilaAct): Actualizacion => ({ id: r.id, version: r.version, producto: r.producto, fecha: r.fecha, notas: r.notas, estado: r.estado, papel: papelAct(r.estado), demo: Boolean(r.demo), creado: r.creado, por: r.por });

export function listarActualizaciones(): Actualizacion[] {
  return (db().prepare('SELECT * FROM actualizaciones ORDER BY fecha DESC').all() as FilaAct[]).map(aAct);
}
export function verActualizacion(id: number): Actualizacion | null {
  const r = db().prepare('SELECT * FROM actualizaciones WHERE id = ?').get(id) as FilaAct | undefined;
  return r ? aAct(r) : null;
}

export interface DatosAct { version?: unknown; producto?: unknown; fecha?: unknown; notas?: unknown; estado?: unknown }
type CamposAct = Pick<Actualizacion, 'version' | 'producto' | 'fecha' | 'notas' | 'estado'>;
export function limpiarActualizacion(b: DatosAct, parcial = false): Limpio<Partial<CamposAct>> {
  const out: Partial<CamposAct> = {};
  if (b.version !== undefined || !parcial) {
    const v = String(b.version ?? '').trim().replace(/^v(?=\d)/i, '');
    if (!v || v.length > 30) return { error: 'falta la versión (por ejemplo 7.4)', campo: 'version' };
    out.version = v;
  }
  if (b.producto !== undefined || !parcial) {
    const p = String(b.producto ?? '').replace(/\s+/g, ' ').trim();
    if (p.length < 2) return { error: 'falta la aplicación', campo: 'producto' };
    // Se escribe como en la lista de aplicaciones si coincide: «xentris pos» y «XENTRIS POS» son la misma.
    out.producto = (productos().find((x) => clave(x) === clave(p)) ?? p).slice(0, 80);
  }
  if (b.fecha !== undefined || !parcial) {
    const n = typeof b.fecha === 'number' ? b.fecha : Date.parse(String(b.fecha ?? ''));
    if (!Number.isFinite(n) || n <= 0) return { error: 'falta la fecha', campo: 'fecha' };
    out.fecha = Math.round(n);
  }
  if (b.estado !== undefined || !parcial) {
    const e = b.estado === undefined ? estadoConPapelAct('publicada') : String(b.estado);
    if (!estadosDeActualizacion().some((x) => x.id === e)) return { error: 'ese estado no existe', campo: 'estado' };
    out.estado = e;
  }
  if (b.notas !== undefined) out.notas = String(b.notas ?? '').trim().slice(0, 600);
  return { ok: out };
}

export function crearActualizacion(b: DatosAct, por = '', now = Date.now(), demo = false): Limpio<Actualizacion> {
  const l = limpiarActualizacion(b);
  if ('error' in l) return l;
  const v = l.ok;
  const id = Number(
    db()
      .prepare('INSERT INTO actualizaciones (version, producto, fecha, notas, estado, demo, creado, por) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(v.version ?? '', v.producto ?? '', v.fecha ?? 0, v.notas ?? '', v.estado ?? estadoConPapelAct('publicada'), demo ? 1 : 0, now, por).lastInsertRowid,
  );
  return { ok: verActualizacion(id)! };
}

export function cambiarActualizacion(id: number, b: DatosAct, por = ''): Limpio<Actualizacion> | null {
  const antes = verActualizacion(id);
  if (!antes) return null;
  const l = limpiarActualizacion(b, true);
  if ('error' in l) return l;
  const v = { ...antes, ...l.ok };
  db().prepare('UPDATE actualizaciones SET version = ?, producto = ?, fecha = ?, notas = ?, estado = ?, por = ? WHERE id = ?').run(v.version, v.producto, v.fecha, v.notas, v.estado, por || antes.por, id);
  return { ok: verActualizacion(id)! };
}

export interface ProductoAlDia {
  producto: string;
  ultima: Actualizacion | null;
  /** Días desde la última publicada (null si nunca se publicó una). */
  diasDesdeLaUltima: number | null;
  proxima: Actualizacion | null;
  /** La cadencia de esta aplicación y los días de gracia que mandan hoy. */
  cadenciaDias: number;
  toleranciaDias: number;
  /** Al día con su cadencia. null si no hay ninguna publicada: no se puede medir. */
  alDia: boolean | null;
  historial: Actualizacion[];
}

/** Cada aplicación (las de la lista y las que tengan actualizaciones) con su última versión y si va al día. */
export function actualizacionesPorProducto(now = Date.now()): ProductoAlDia[] {
  const todas = listarActualizaciones();
  const nombres: string[] = [];
  for (const p of [...productos(), ...todas.map((a) => a.producto)]) if (!nombres.some((x) => clave(x) === clave(p))) nombres.push(p);
  const tol = toleranciaDias();
  return nombres
    .map((producto) => {
      const suyas = todas.filter((a) => clave(a.producto) === clave(producto)).sort((a, b) => b.fecha - a.fecha);
      const publicadas = suyas.filter((a) => a.papel === 'publicada' && a.fecha <= now);
      const ultima = publicadas[0] ?? null;
      const dias = ultima ? Math.floor((now - ultima.fecha) / DIA) : null;
      const proxima = suyas.filter((a) => a.papel === 'planeada' || a.fecha > now).sort((a, b) => a.fecha - b.fecha)[0] ?? null;
      const cadencia = cadenciaDe(producto);
      return { producto, ultima, diasDesdeLaUltima: dias, proxima, cadenciaDias: cadencia, toleranciaDias: tol, alDia: dias === null ? null : dias <= cadencia + tol, historial: suyas };
    })
    .sort((a, b) => (a.alDia === b.alDia ? a.producto.localeCompare(b.producto, 'es') : a.alDia === false ? -1 : b.alDia === false ? 1 : 0));
}

// ---------- lo que lee la pantalla y lo que lee SLA ----------

export function panelMantenimientos(dias = periodoDias(), now = Date.now()) {
  const todos = listarMantenimientos().map((m) => conAvisos(m, now));
  const proximos = todos.filter((m) => m.momento === 'proximo' || m.momento === 'en_curso').sort((a, b) => a.inicio - b.inicio);
  const pasados = todos.filter((m) => m.momento === 'pasado' || m.momento === 'cancelado').sort((a, b) => b.inicio - a.inicio);
  const productosAlDia = actualizacionesPorProducto(now);
  const c = cumplimiento(dias, now);
  return {
    zona: business.timezone,
    ahora: now,
    planes: planes(),
    estadosMantenimiento: estadosDeMantenimiento(),
    estadosActualizacion: estadosDeActualizacion(),
    variables: VARIABLES_AVISO,
    /** Quién programa: «administra» (solo quien administra XENCRM) o «equipo» (todos). */
    quienPrograma: programarEsDelEquipo() ? 'equipo' : 'administra',
    cifras: {
      proximos: proximos.length,
      porAvisar: proximos.reduce((n, m) => n + m.resumen.porAvisar + m.resumen.atrasados + m.resumen.preparados + m.resumen.noSalio, 0),
      avisosATiempo: c.mantenimientos.avisadosATiempo,
      mantenimientosEnPeriodo: c.mantenimientos.total,
      productosAtrasados: c.actualizaciones.productosAtrasados.length,
      productosMedidos: productosAlDia.filter((p) => p.alDia !== null).length,
    },
    periodoDias: dias,
    proximos,
    pasados: pasados.slice(0, 50),
    productos: productosAlDia,
    /** Lo que se puede escribir en «aplicación»: la lista configurada, para no inventar nombres del mismo producto. */
    catalogo: productos(),
  };
}

/**
 * El cumplimiento del periodo, para la pantalla SLA (la de Tickets y SLA lo lee tal cual, con esta forma exacta).
 * - mantenimientos.total: los que empezaron en los últimos `dias` (sin cancelados).
 * - avisadosATiempo: de esos, a los que TODOS sus afectados se les avisó dentro del plazo de su plan (o no tenían
 *   afectados: no había a quién avisar, y eso no es incumplir).
 * - sinAviso: de esos, a los que al menos un afectado nunca se le avisó. (Los que avisaron tarde no son ni lo uno ni
 *   lo otro: total = a tiempo + tarde + sin aviso.)
 * - proximos: los que todavía no empiezan (sin cancelados).
 * - actualizaciones.publicadasEnPeriodo: las publicadas en los últimos `dias`.
 * - productosAtrasados: las aplicaciones que pasaron su cadencia (+ los días de gracia) sin una publicada. Solo las
 *   que tienen alguna: sin historia no se puede medir.
 */
export function cumplimiento(dias = periodoDias(), now = Date.now()) {
  const desde = now - dias * DIA;
  const todos = listarMantenimientos().filter((m) => m.papel !== 'cancelado');
  const enPeriodo = todos.filter((m) => m.inicio >= desde && m.inicio <= now).map((m) => conAvisos(m, now));
  const atrasados = actualizacionesPorProducto(now)
    .filter((p) => p.alDia === false)
    .map((p) => ({ producto: p.producto, diasDesdeLaUltima: p.diasDesdeLaUltima as number }));
  return {
    periodoDias: dias,
    mantenimientos: {
      total: enPeriodo.length,
      avisadosATiempo: enPeriodo.filter((m) => m.aviso === 'a_tiempo' || m.aviso === 'sin_afectados').length,
      sinAviso: enPeriodo.filter((m) => m.aviso === 'sin_aviso').length,
      proximos: todos.filter((m) => m.inicio > now).length,
    },
    actualizaciones: {
      publicadasEnPeriodo: listarActualizaciones().filter((a) => a.papel === 'publicada' && a.fecha >= desde && a.fecha <= now).length,
      productosAtrasados: atrasados,
    },
  };
}

// ---------- la demostración ----------

/** Quita solo lo sembrado (los mantenimientos y actualizaciones de ejemplo, con sus avisos). */
export function quitarDemo(): void {
  const d = db();
  d.prepare('DELETE FROM mantenimiento_avisos WHERE mantenimiento_id IN (SELECT id FROM mantenimientos WHERE demo = 1)').run();
  d.prepare('DELETE FROM mantenimientos WHERE demo = 1').run();
  d.prepare('DELETE FROM actualizaciones WHERE demo = 1').run();
}

export interface ServicioDemo {
  /** `hora` («23:00», en la hora del negocio) fija la hora de inicio ese día; sin ella, la hora en punto más cercana. */
  mantenimientos?: { titulo: string; producto?: string; inicioEnHoras: number; hora?: string; duracionMin: number; avisoHorasAntes?: number | null; planes?: string[]; estado?: string; notas?: string }[];
  actualizaciones?: { version: string; producto: string; haceDias?: number; enDias?: number; notas?: string; estado?: string }[];
}

/** Ese mismo día (en la zona del negocio), a la hora «HH:MM» de la pared del negocio. */
function aLaHoraDelNegocio(ts: number, hora: string): number {
  const [hh, mm] = hora.split(':').map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return ts;
  const partes = (t: number) =>
    Object.fromEntries(
      new Intl.DateTimeFormat('en-US', { timeZone: business.timezone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
        .formatToParts(t)
        .map((x) => [x.type, Number(x.value)]),
    ) as Record<string, number>;
  const d = partes(ts);
  const deseado = Date.UTC(d.year!, d.month! - 1, d.day!, hh!, mm!);
  let t = deseado;
  for (let i = 0; i < 2; i++) {
    const v = partes(t);
    t += deseado - Date.UTC(v.year!, v.month! - 1, v.day!, v.hour!, v.minute!);
  }
  return t;
}

/**
 * Siembra lo de un `servicio.json`. Los mantenimientos de ejemplo traen `avisoHorasAntes`: a cada afectado se le
 * apunta el aviso a esa distancia del inicio, por «otro medio», si esa hora ya pasó. Así la demostración tiene uno
 * avisado a tiempo, uno tarde y uno por avisar sin inventar mensajes que nadie mandó.
 */
export function sembrarDemo(s: ServicioDemo, now = Date.now()): { mantenimientos: number; actualizaciones: number } {
  quitarDemo();
  let nm = 0;
  let na = 0;
  const estadoMant = (e?: string) => (e && estadosDeMantenimiento().some((x) => x.id === e) ? e : estadosDeMantenimiento().find((x) => x.papel === e)?.id);
  const estadoAct = (e?: string) => (e && estadosDeActualizacion().some((x) => x.id === e) ? e : estadosDeActualizacion().find((x) => x.papel === e)?.id);
  for (const m of s.mantenimientos ?? []) {
    const cerca = Math.round((now + m.inicioEnHoras * HORA) / HORA) * HORA;
    const r = crearMantenimiento(
      { titulo: m.titulo, producto: m.producto ?? '', inicio: m.hora ? aLaHoraDelNegocio(cerca, m.hora) : cerca, duracionMin: m.duracionMin, planes: m.planes ?? planes().map((p) => p.nombre), estado: estadoMant(m.estado), notas: m.notas ?? '' },
      'demostración',
      now - 14 * DIA,
      true,
    );
    if ('error' in r) continue;
    nm++;
    if (m.avisoHorasAntes != null) {
      const cuando = r.ok.inicio - m.avisoHorasAntes * HORA;
      if (cuando <= now) {
        for (const a of afectadosDe(r.ok, now)) {
          db()
            .prepare("INSERT OR REPLACE INTO mantenimiento_avisos (mantenimiento_id, user_id, avisado, como, por) VALUES (?, ?, ?, 'otro medio', 'demostración')")
            .run(r.ok.id, a.id, cuando);
        }
      }
    }
  }
  for (const a of s.actualizaciones ?? []) {
    const fecha = a.enDias != null ? now + a.enDias * DIA : now - (a.haceDias ?? 0) * DIA;
    const papel: PapelAct = fecha > now ? 'planeada' : 'publicada';
    const r = crearActualizacion({ version: a.version, producto: a.producto, fecha, notas: a.notas ?? '', estado: estadoAct(a.estado) ?? estadoAct(papel) }, 'demostración', now, true);
    if (!('error' in r)) na++;
  }
  return { mantenimientos: nm, actualizaciones: na };
}
