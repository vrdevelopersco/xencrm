// Los tickets de la demostración (Servicio › Tickets). Cada contacto de la semilla puede traer `tickets`; el formato
// está en docs/xencrm.md › «Servicio». Se siembran con las mismas columnas que un ticket de verdad (crm/tickets.ts),
// así el reloj del SLA los mide igual: nada de un estado de SLA escrito a mano en la semilla.
import { getDb } from '../rag/store.js';
import { configSla, estadoInicial } from './tickets.js';

export interface TicketDemo {
  asunto: string;
  /** incidente · solicitud · actualizacion · mantenimiento */
  tipo?: string;
  /** critica · alta · media · baja */
  prioridad?: string;
  /** abierto · en_progreso · esperando_cliente · resuelto · cerrado */
  estado?: string;
  producto?: string;
  /** Hace cuántas horas se abrió. */
  haceHoras: number;
  /** A los cuántos minutos de abierto se contestó por primera vez (null: todavía no). */
  primeraRespuestaEnMin?: number | null;
  /** A las cuántas horas de abierto se resolvió (null: sigue abierto). */
  resueltoEnHoras?: number | null;
  asignado?: string;
}

const HORA = 3600_000;

export function sembrarTicketsDe(userId: string, tickets: TicketDemo[], now: number): void {
  if (!tickets.length) return;
  const db = getDb();
  // Con los planes, prioridades, tipos y estados de ESTE negocio: lo que la semilla traiga y no exista, cae al de fábrica.
  const cfg = configSla();
  for (const t of tickets) {
    const creado = Math.round(now - Math.max(0, Number(t.haceHoras) || 0) * HORA);
    const est = cfg.estados.find((e) => e.id === t.estado) ?? cfg.estados.find((e) => e.id === estadoInicial(cfg))!;
    const estado = est.id;
    const prioridad = cfg.prioridades.some((p) => p.id === t.prioridad) ? String(t.prioridad) : cfg.prioridadDeFabrica;
    const tipo = cfg.tipos.some((x) => x.id === t.tipo) ? String(t.tipo) : cfg.tipoDeFabrica;
    const asignado = t.asignado?.trim() || null;
    // Lo que no puede haber pasado todavía (contestado o resuelto «en el futuro») se recorta a ahora.
    const enElPasado = (ts: number) => Math.min(now, ts);
    const respondido = t.primeraRespuestaEnMin == null ? null : enElPasado(creado + t.primeraRespuestaEnMin * 60_000);
    let resuelto = t.resueltoEnHoras == null ? null : enElPasado(creado + t.resueltoEnHoras * HORA);
    if (est.cierra && !resuelto) resuelto = enElPasado(creado + HORA);
    if (!est.cierra) resuelto = null;
    const cerrado = est.cierra ? resuelto : null;
    // En un estado que pausa (esperando al cliente): desde hace un rato (la mitad de su vida, como mucho dos horas).
    const pausaDesde = est.pausa ? Math.max(respondido ?? creado, now - Math.min(2 * HORA, (now - creado) / 2)) : null;
    const r = db
      .prepare(
        'INSERT INTO tickets (user_id, asunto, tipo, prioridad, estado, producto, asignado, creado, creado_por, respondido, respondido_por, resuelto, cerrado, pausa_desde, pausa_ms, actualizado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)',
      )
      .run(
        userId,
        String(t.asunto ?? '').slice(0, 140),
        tipo,
        prioridad,
        estado,
        String(t.producto ?? '').slice(0, 60),
        asignado,
        creado,
        asignado ?? 'equipo',
        respondido,
        respondido ? (asignado ?? 'equipo') : null,
        resuelto,
        cerrado,
        pausaDesde,
        now,
      );
    db.prepare('INSERT INTO events (user_id, ts, type, payload) VALUES (?, ?, ?, ?)').run(
      userId,
      creado,
      'ticket',
      JSON.stringify({ ticket: Number(r.lastInsertRowid), accion: 'creado', a: t.asunto, prioridad, by: asignado ?? 'equipo' }),
    );
  }
}
