// Los tickets de la demostración (Servicio › Tickets). Cada contacto de la semilla puede traer `tickets`; el formato
// está en docs/xencrm.md › «Servicio». Lo llena el agente de Tickets y SLA: hasta entonces no siembra nada.
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

export function sembrarTicketsDe(_userId: string, _tickets: TicketDemo[], _now: number): void {
  /* lo llena el agente de Tickets y SLA */
}
