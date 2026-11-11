// Retención automática: las conversaciones que llevan mucho tiempo quietas se anonimizan, o se borran, solas.
//
// Para qué: un CRM que guarda para siempre el nombre, el teléfono y todo lo que alguien escribió hace tres años es
// un riesgo que no le sirve a nadie. A una financiera, además, se lo piden. Lo que vale de esas conversaciones
// viejas —cuántas llegaron, hasta dónde avanzaron, cuánto costaron— se puede guardar sin saber de quién eran.
//
// Las dos acciones:
//
//   · **anonimizar** (la de por defecto). La ficha se queda, archivada, con otro identificador (`anon:…`) y sin
//     nombre, teléfono, número, datos, etiquetas, notas ni resumen. Los mensajes, los análisis, las preguntas por
//     verificar, las frases sin entender y las propuestas se borran. Las citas y los eventos se quedan, sin notas ni
//     detalles. El consumo de IA y los turnos se quedan con el identificador nuevo. Así las cuentas del embudo y del
//     gasto siguen cuadrando.
//   · **borrar**. Todo lo de esa persona se va. El consumo de IA se queda, con el identificador `borrado`: es gasto
//     real, y el informe del mes no puede encogerse porque alguien se borró.
//
// 🪤 Va apagada. Borrar datos de clientes no puede pasar porque alguien actualizó xencrm: lo enciende, cliente por
// cliente, quien administra XENCRM desde la consola, después de ver cuántas conversaciones tocaría.
//
// 🪤 Antes de tocar nada tiene que haber un respaldo de la base de menos de un día. Si no lo hay, se hace; si no se
// puede hacer, no se borra nada. Los respaldos se guardan 14 días (BACKUP_KEEP): ese es el tiempo para arrepentirse.
//
// 🪤 No se toca a quien tiene una cita por delante. Lleva meses sin escribir porque ya agendó, no porque se fue.
//
// 🪤 El historial importado (import_messages, de crm/importar.ts) no entra aquí: es viejo por naturaleza, así que
// la primera pasada se lo llevaría entero, y es de donde sale el estilo del asistente. Se borra desde donde se
// importa.
//
// 🪤 Quien vuelve a escribir después de anonimizado empieza de cero: su identificador de antes ya no existe, así
// que el canal le crea una ficha nueva. Es justo lo que significa que se olvidó.
import { randomBytes } from 'node:crypto';
import { getDb } from '../rag/store.js';
import { backupNow, backupStatus } from '../rag/backup.js';
import { borrar as borrarMedio } from './medios.js';
import { getSetting, setSetting } from './settings.js';
import { emitEvent } from './events.js';
import { reemplazarEnFijados } from './fijados.js';
import { forgetSiblings } from './merge.js';

export type Accion = 'anonimizar' | 'borrar';
export interface Politica {
  /** Días sin movimiento antes de actuar. */
  dias: number;
  accion: Accion;
}
export interface Pasada {
  ts: number;
  accion: Accion;
  dias: number;
  cuantos: number;
  /** Si quedaron más para la próxima pasada (se hacen por tandas). */
  quedan: number;
  error?: string;
}

/** Lo mínimo: menos de 90 días es borrar conversaciones que todavía se están atendiendo o se van a retomar. */
export const DIAS_MINIMO = 90;
export const DIAS_MAXIMO = 3650;
/** Lo que se sugiere al encenderla: un año sin escribir. */
export const DIAS_SUGERIDOS = 365;
/** Cuántas fichas por pasada: la primera vez pueden ser miles, y la base no puede quedarse ocupada minutos. */
const TANDA = 300;

const CLAVE = 'retencion.politica';
const CLAVE_ULTIMA = 'retencion.ultima';
const DIA = 86400_000;

/** La política de este cliente, o null si está apagada (que es como viene). */
export function politica(): Politica | null {
  const p = getSetting<Politica | null>(CLAVE, null);
  return p && Number.isFinite(p.dias) && (p.accion === 'anonimizar' || p.accion === 'borrar') ? p : null;
}

/**
 * Pone o apaga la política. `dias` vacío, null o 0 la apaga. Se valida aquí y no en la pantalla: la ruta se puede
 * llamar sin pasar por ella.
 */
export function ponerPolitica(entrada: { dias?: number | string | null; accion?: string | null }): Politica | null {
  const crudo = entrada.dias;
  if (crudo === null || crudo === undefined || crudo === '' || Number(crudo) === 0) {
    setSetting(CLAVE, null);
    return null;
  }
  const dias = Number(crudo);
  if (!Number.isInteger(dias)) throw new Error('los días son un número entero, como 365');
  if (dias < DIAS_MINIMO) throw new Error(`lo mínimo son ${DIAS_MINIMO} días: menos que eso borra conversaciones que todavía se pueden retomar`);
  if (dias > DIAS_MAXIMO) throw new Error(`lo máximo son ${DIAS_MAXIMO} días, que son diez años`);
  const accion = (entrada.accion ?? 'anonimizar') as Accion;
  if (accion !== 'anonimizar' && accion !== 'borrar') throw new Error('la acción es anonimizar o borrar');
  const p = { dias, accion };
  setSetting(CLAVE, p);
  return p;
}

export const ultimaPasada = (): Pasada | null => getSetting<Pasada | null>(CLAVE_ULTIMA, null);

/** Desde cuándo cuenta una ficha como quieta: lo último que escribió, o lo último que se supo de ella. */
const QUIETA_DESDE = 'MAX(COALESCE(u.last_message_at, 0), u.last_seen)';
const CON_CITA_POR_DELANTE = "EXISTS (SELECT 1 FROM appointments a WHERE a.user_id = u.id AND a.status = 'confirmada' AND a.starts_at >= ?)";

/** Las fichas a las que les toca, de la más vieja a la más nueva. */
export function candidatas(dias: number, ahora = Date.now(), limite = TANDA): string[] {
  const corte = ahora - dias * DIA;
  return (
    getDb()
      .prepare(`SELECT u.id FROM users u WHERE u.id NOT LIKE 'anon:%' AND ${QUIETA_DESDE} < ? AND NOT ${CON_CITA_POR_DELANTE} ORDER BY ${QUIETA_DESDE} LIMIT ?`)
      .all(corte, ahora, limite) as { id: string }[]
  ).map((r) => r.id);
}

/** Cuántas tocaría hoy con esos días, sin tocar nada. Es lo que se enseña antes de guardar. */
export function vistaPrevia(dias: number, ahora = Date.now()): { dias: number; cuantas: number; conCita: number; masVieja: number | null } {
  const corte = ahora - dias * DIA;
  const db = getDb();
  const r = db
    .prepare(`SELECT COUNT(*) n, MIN(${QUIETA_DESDE}) vieja FROM users u WHERE u.id NOT LIKE 'anon:%' AND ${QUIETA_DESDE} < ? AND NOT ${CON_CITA_POR_DELANTE}`)
    .get(corte, ahora) as { n: number; vieja: number | null };
  const conCita = db.prepare(`SELECT COUNT(*) n FROM users u WHERE u.id NOT LIKE 'anon:%' AND ${QUIETA_DESDE} < ? AND ${CON_CITA_POR_DELANTE}`).get(corte, ahora) as { n: number };
  return { dias, cuantas: Number(r.n), conCita: Number(conCita.n), masVieja: r.vieja == null ? null : Number(r.vieja) };
}

/** Los archivos que acompañan sus mensajes: se borran del disco después de confirmar la base. */
function mediosDe(userId: string): string[] {
  const filas = getDb().prepare('SELECT media FROM messages WHERE user_id = ? AND media IS NOT NULL').all(userId) as { media: string }[];
  return filas.flatMap((f) => {
    try {
      const id = (JSON.parse(f.media) as { id?: unknown }).id;
      return typeof id === 'string' ? [id] : [];
    } catch {
      return [];
    }
  });
}

/** Lo que tiene texto de la persona y no sirve sin saber de quién es: se va con las dos acciones. */
const CON_TEXTO = ['messages', 'analyses', 'verifications', 'misses', 'propuestas', 'wa_salida'];

const existe = (tabla: string) => Boolean(getDb().prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tabla));

/**
 * Anonimiza una ficha y devuelve su identificador nuevo. Todo en una transacción: o queda anónima entera, o no se
 * toca. 🪤 Las tablas que crea cada módulo al usarse por primera vez (propuestas, grupo_gente) pueden no existir
 * todavía en una base nueva: se preguntan antes.
 */
export function anonimizar(userId: string): string | null {
  const db = getDb();
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)) return null;
  const nuevo = `anon:${randomBytes(6).toString('hex')}`;
  const medios = mediosDe(userId);
  db.exec('BEGIN');
  try {
    for (const t of CON_TEXTO) if (existe(t)) db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(userId);
    if (existe('grupo_gente')) db.prepare('DELETE FROM grupo_gente WHERE grupo = ? OR persona = ?').run(userId, userId);
    // Las citas y los eventos son el embudo: se quedan, sin lo que se escribió en ellos.
    db.prepare('UPDATE appointments SET user_id = ?, notes = \'\', reminder_note = NULL, customer_reply = NULL WHERE user_id = ?').run(nuevo, userId);
    db.prepare("UPDATE events SET user_id = ?, payload = '{}' WHERE user_id = ?").run(nuevo, userId);
    db.prepare('UPDATE llm_usage SET user_id = ? WHERE user_id = ?').run(nuevo, userId);
    db.prepare('UPDATE turnos SET user_id = ? WHERE user_id = ?').run(nuevo, userId);
    // De dónde vino se queda (la campaña, el anuncio), sin lo que identifica el clic ni la página exacta.
    db.prepare("UPDATE origen SET user_id = ?, clic = '', url = '', referente = '' WHERE user_id = ?").run(nuevo, userId);
    // 🪤 El identificador viejo es su teléfono: tampoco se queda en los fijados de nadie.
    reemplazarEnFijados(userId, null);
    db.prepare(
      `UPDATE users SET id = ?, name = NULL, phone = NULL, number = NULL, data = '{}', tags = '[]', notes = '', summary = NULL,
         score_factors = '[]', human_mode = 0, human_by = NULL, human_since = NULL, presentes = '[]', unread = 0, archived = 1
       WHERE id = ?`,
    ).run(nuevo, userId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  for (const m of medios) borrarMedio(m);
  return nuevo;
}

/** Borra una ficha y todo lo suyo. El consumo de IA se queda, a nombre de `borrado`. */
export function borrarDelTodo(userId: string): boolean {
  const db = getDb();
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)) return false;
  const medios = mediosDe(userId);
  db.exec('BEGIN');
  try {
    for (const t of [...CON_TEXTO, 'appointments', 'events', 'turnos', 'origen']) if (existe(t)) db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(userId);
    if (existe('grupo_gente')) db.prepare('DELETE FROM grupo_gente WHERE grupo = ? OR persona = ?').run(userId, userId);
    db.prepare("UPDATE llm_usage SET user_id = 'borrado' WHERE user_id = ?").run(userId);
    reemplazarEnFijados(userId, null);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  for (const m of medios) borrarMedio(m);
  return true;
}

/** Hay un respaldo de menos de un día, o se hace ahora. false si no se pudo: entonces no se borra nada. */
function hayRespaldoReciente(ahora: number): boolean {
  try {
    const ultimo = backupStatus().last;
    if (ultimo && ahora - ultimo.at < DIA) return true;
    backupNow(new Date(ahora));
    return true;
  } catch (err) {
    console.warn('[retención] no pude respaldar, así que no toco nada:', (err as Error).message);
    return false;
  }
}

/**
 * Una pasada: si la política está encendida y hay respaldo, aplica la acción a una tanda de fichas quietas.
 * Devuelve lo que hizo, o null si está apagada.
 */
export function aplicarRetencion(ahora = Date.now()): Pasada | null {
  const p = politica();
  if (!p) return null;
  const base = { ts: ahora, accion: p.accion, dias: p.dias };
  const lista = candidatas(p.dias, ahora);
  if (!lista.length) {
    const r = { ...base, cuantos: 0, quedan: 0 };
    setSetting(CLAVE_ULTIMA, r);
    return r;
  }
  if (!hayRespaldoReciente(ahora)) {
    const r = { ...base, cuantos: 0, quedan: vistaPrevia(p.dias, ahora).cuantas, error: 'no se pudo hacer el respaldo de antes, así que no se tocó nada' };
    setSetting(CLAVE_ULTIMA, r);
    return r;
  }
  let cuantos = 0;
  for (const id of lista) {
    try {
      if (p.accion === 'borrar' ? borrarDelTodo(id) : anonimizar(id)) {
        cuantos++;
        emitEvent('contact', id, { deleted: true });
      }
    } catch (err) {
      console.warn(`[retención] no pude con una ficha: ${(err as Error).message}`);
    }
  }
  if (cuantos) forgetSiblings();
  const r = { ...base, cuantos, quedan: vistaPrevia(p.dias, ahora).cuantas };
  setSetting(CLAVE_ULTIMA, r);
  return r;
}

let reloj: NodeJS.Timeout | null = null;
/**
 * Mira cada hora; pasa una vez al día, o seguido mientras queden tandas. 🪤 La primera mirada es a los diez
 * minutos de arrancar, no al arrancar: el alojamiento da tres segundos para abrir el puerto, y el respaldo del día
 * se hace al minuto, así que para entonces ya está y no hace falta otro.
 */
export function empezarRetencion(): void {
  if (reloj) return;
  const mirar = () => {
    try {
      const ultima = ultimaPasada();
      const toca = !ultima || ultima.quedan > 0 || ultima.error || Date.now() - ultima.ts > DIA - 3600_000;
      if (!politica() || !toca) return;
      const r = aplicarRetencion();
      if (r?.cuantos) console.log(`[retención] ${r.accion === 'borrar' ? 'borradas' : 'anonimizadas'} ${r.cuantos} conversaciones de más de ${r.dias} días${r.quedan ? ` (quedan ${r.quedan})` : ''}`);
      if (r?.error) console.warn(`[retención] ${r.error}`);
    } catch (err) {
      console.warn('[retención] no pude pasar:', (err as Error).message);
    }
  };
  reloj = setInterval(mirar, 3600_000);
  reloj.unref();
  setTimeout(mirar, 10 * 60_000).unref();
}
