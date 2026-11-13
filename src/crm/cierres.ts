/**
 * Días bloqueados de la agenda: el negocio no atiende ese día (un festivo, un viaje, inventario) y el asistente no lo
 * ofrece. Se bloquean y se abren desde el calendario del tablero.
 *
 * Un cierre es de todas las sedes (sede '') o de una. La fecha es el día civil en la hora del negocio (YYYY-MM-DD),
 * igual que la que arma crm/appointments.ts con dayKey: así «el lunes 16» es el mismo día aquí y en la agenda.
 *
 * 🪤 Bloquear NO cancela lo que ya estaba agendado ese día. Cancelar le cambia el plan a un cliente y eso se hace
 * cita por cita, hablando con él; el calendario anuncia «Bloqueado con 2 citas» para que nadie lo olvide.
 *
 * 🪤 Desde el tablero se puede agendar igual en un día bloqueado, como encima de un evento personal del dueño: quien
 * agenda a mano sabe lo que hace (crm/appointments.ts, isSlotFree con includeBusy: false).
 */
import { getDb } from '../rag/store.js';

export interface Cierre {
  fecha: string;
  /** '' = todas las sedes. */
  sede: string;
  motivo: string;
  por: string;
  creado: number;
}

let lista = false;
function db() {
  const d = getDb();
  if (!lista) {
    d.exec(`
      CREATE TABLE IF NOT EXISTS agenda_cierres (
        fecha TEXT NOT NULL,
        sede TEXT NOT NULL DEFAULT '',
        motivo TEXT NOT NULL DEFAULT '',
        por TEXT NOT NULL DEFAULT '',
        creado INTEGER NOT NULL,
        PRIMARY KEY (fecha, sede)
      )
    `);
    lista = true;
  }
  return d;
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
export const esFecha = (s: unknown): s is string => typeof s === 'string' && FECHA.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));

/** Los cierres entre dos días (ambos incluidos). Con sede, los de todas y los suyos; sin sede, todos. */
export function cierresEntre(desde: string, hasta: string, sede?: string | null): Cierre[] {
  const filas = db()
    .prepare(`SELECT * FROM agenda_cierres WHERE fecha >= ? AND fecha <= ?${sede ? " AND (sede = '' OR sede = ?)" : ''} ORDER BY fecha, sede`)
    .all(...(sede ? [desde, hasta, sede] : [desde, hasta])) as unknown as Cierre[];
  return filas;
}

/** ¿Ese día está bloqueado para esa sede? (Un cierre de todas vale para cualquiera.) */
export function diaCerrado(fecha: string, sede?: string | null): boolean {
  const r = db()
    .prepare(`SELECT 1 FROM agenda_cierres WHERE fecha = ? AND (sede = ''${sede ? ' OR sede = ?' : ''}) LIMIT 1`)
    .get(...(sede ? [fecha, sede] : [fecha]));
  return Boolean(r);
}

/** Bloquea el día. Si ya estaba, le cambia el motivo. */
export function cerrarDia(fecha: string, opts: { sede?: string | null; motivo?: string; por?: string } = {}, now = Date.now()): Cierre {
  if (!esFecha(fecha)) throw new Error('la fecha va como AAAA-MM-DD');
  const sede = opts.sede ?? '';
  const motivo = (opts.motivo ?? '').toString().trim().slice(0, 80);
  const por = (opts.por ?? '').toString().trim().slice(0, 40);
  db()
    .prepare('INSERT INTO agenda_cierres (fecha, sede, motivo, por, creado) VALUES (?, ?, ?, ?, ?) ON CONFLICT(fecha, sede) DO UPDATE SET motivo = excluded.motivo, por = excluded.por')
    .run(fecha, sede, motivo, por, now);
  return db().prepare('SELECT * FROM agenda_cierres WHERE fecha = ? AND sede = ?').get(fecha, sede) as unknown as Cierre;
}

/** Lo abre otra vez. Devuelve si había algo que abrir. */
export function abrirDia(fecha: string, sede?: string | null): boolean {
  return Number(db().prepare('DELETE FROM agenda_cierres WHERE fecha = ? AND sede = ?').run(fecha, sede ?? '').changes) > 0;
}
