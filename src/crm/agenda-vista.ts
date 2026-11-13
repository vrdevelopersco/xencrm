/**
 * Lo que el calendario del tablero muestra además de las citas:
 *
 * - **Cada cita con sus datos**: canal, etapa, puntaje, valor del trato y cuándo sale su recordatorio, para que la
 *   tarjeta y la vista rápida no tengan que pedir la ficha una por una.
 * - **El cupo de cada día**: cuántos espacios hay, cuántos están tomados y cuántos quedan (crm/appointments.ts,
 *   cupoPorDia: los mismos espacios que ofrece el asistente).
 * - **Los anuncios**: mantenimientos programados (Servicio), festivos, días bloqueados y días casi llenos o llenos.
 * - **El panel «Hoy»**: la próxima cita, las de hoy y mañana, los recordatorios y el cupo de los próximos días.
 *
 * Aquí se arman los datos; las palabras las pone el tablero, que tiene el vocabulario del negocio («demos»,
 * «turnos») y el formato de la persona que mira.
 */
import { business } from '../config.js';
import { regla } from '../reglas.js';
import { cupoPorDia, dayKey, listAppointments, tzParts, zoned, formatSlot, type Appointment, type CupoDia } from './appointments.js';
import { cierresEntre } from './cierres.js';
import { getContact, STAGE_LABELS } from './contacts.js';
import { festivosEntre, paisDeFestivos } from './festivos.js';
import { conAvisos, listarMantenimientos } from './mantenimientos.js';
import { remindersBoard, reminderTime } from './reminders.js';
import { sedes } from './sedes.js';
import { valorDe } from './valor.js';

const DIA = 86_400_000;

export interface CitaConDatos extends Appointment {
  label: string;
  /** Cuándo sale el recordatorio solo; null si no aplica (apagado, o la cita ya no está confirmada). */
  remindAt: number | null;
  canal: string;
  etapa: string | null;
  etapaNombre: string | null;
  puntaje: number | null;
  /** Lo que vale el trato (crm/valor.ts). 0 = no se sabe. */
  valor: number;
  empresa: string | null;
}

export function citaConDatos(a: Appointment): CitaConDatos {
  const c = getContact(a.userId);
  const empresa = c && typeof c.data.empresa === 'string' && c.data.empresa.trim() ? c.data.empresa.trim() : null;
  return {
    ...a,
    label: formatSlot(new Date(a.startsAt)),
    remindAt: business.appointments.reminder.enabled && a.status === 'confirmada' ? reminderTime(a.startsAt, a.sede) : null,
    canal: c?.channel ?? a.userId.split(':')[0] ?? '',
    etapa: c?.stage ?? null,
    etapaNombre: c ? (STAGE_LABELS[c.stage] ?? c.stage) : null,
    puntaje: c ? c.score : null,
    valor: c ? valorDe(c).valor : 0,
    empresa,
  };
}

/** El día (YYYY-MM-DD, en la hora del negocio) de un instante. */
export function diaDe(t: number): string {
  const p = tzParts(new Date(t));
  return dayKey(p.y, p.m, p.d);
}

/**
 * 🪤 La sede de una cita sin sede es la primera, igual que en la agenda (crm/appointments.ts, bookedCount): si aquí
 * se contara en ninguna, al filtrar por sede el calendario la escondería y el cupo diría otra cosa.
 */
const sedeDeCita = (a: Appointment): string | null => a.sede ?? sedes()[0]?.id ?? null;
const enLaSede = (sede: string | null) => (a: Appointment) => !sede || sedes().length < 2 || sedeDeCita(a) === sede;

export type TipoAnuncio = 'mantenimiento' | 'festivo' | 'cierre' | 'casi_lleno' | 'lleno';

export interface Anuncio {
  tipo: TipoAnuncio;
  fecha: string;
  /** El nombre propio: el del festivo, el del mantenimiento o el motivo del bloqueo. */
  titulo: string;
  /** Citas confirmadas ese día (en la sede que se mira). */
  agendadas: number;
  /** Festivo o cierre: el día está bloqueado y el asistente no lo ofrece. */
  cerrado?: boolean;
  /** Cierre de una sola sede: cuál. */
  sede?: string;
  /** Mantenimiento: su id, cuándo empieza y termina, qué servicio toca y cómo va su aviso. */
  id?: number;
  inicio?: number;
  fin?: number;
  producto?: string;
  afectados?: number;
  porAvisar?: number;
  /** Casi lleno o lleno: lo que queda. */
  total?: number;
  ocupados?: number;
  libres?: number;
}

/** El cupo y los anuncios entre dos instantes, para la semana o el mes que se mira. */
export function vistaDeAgenda(desde: number, hasta: number, sede: string | null = null, now = Date.now()): { cupo: CupoDia[]; anuncios: Anuncio[]; festivos: string } {
  const d0 = diaDe(desde), d1 = diaDe(hasta), hoy = diaDe(now);
  const citasPorDia = new Map<string, number>();
  for (const a of listAppointments({ from: desde, to: hasta, status: 'confirmada', limit: 5000 }).filter(enLaSede(sede))) {
    const k = diaDe(a.startsAt);
    citasPorDia.set(k, (citasPorDia.get(k) ?? 0) + 1);
  }
  const citas = (k: string) => citasPorDia.get(k) ?? 0;
  const anuncios: Anuncio[] = [];

  // Festivos y días bloqueados. Un festivo bloqueado es UN anuncio (el festivo, cerrado), no dos.
  const cierres = cierresEntre(d0, d1, sede);
  const festivos = festivosEntre(d0, d1);
  const deFestivo = new Set(festivos.map((f) => f.fecha));
  const nombreSede = (id: string) => sedes().find((s) => s.id === id)?.nombre ?? id;
  for (const f of festivos) {
    const cierre = cierres.find((x) => x.fecha === f.fecha && (x.sede === '' || x.sede === sede));
    anuncios.push({ tipo: 'festivo', fecha: f.fecha, titulo: f.nombre, agendadas: citas(f.fecha), cerrado: Boolean(cierre) });
  }
  for (const c of cierres) {
    if (deFestivo.has(c.fecha) && (c.sede === '' || c.sede === sede)) continue;
    anuncios.push({ tipo: 'cierre', fecha: c.fecha, titulo: c.motivo, agendadas: citas(c.fecha), cerrado: true, ...(c.sede ? { sede: nombreSede(c.sede) } : {}) });
  }

  // Mantenimientos programados que caen en el rango (los cancelados no). Van en el día en que empiezan.
  for (const m of listarMantenimientos()) {
    if (m.papel === 'cancelado' || m.fin < desde || m.inicio > hasta) continue;
    const v = conAvisos(m, now);
    anuncios.push({
      tipo: 'mantenimiento', fecha: diaDe(m.inicio), titulo: m.titulo, agendadas: citas(diaDe(m.inicio)),
      id: m.id, inicio: m.inicio, fin: m.fin, producto: m.producto,
      afectados: v.resumen.afectados, porAvisar: v.momento === 'proximo' ? v.afectados.filter((x) => !x.avisado).length : 0,
    });
  }

  // Casi lleno y lleno: solo de hoy en adelante (de un día que ya pasó no hay nada que hacer).
  const cupo = cupoPorDia(desde, hasta, { sede, now });
  const pct = regla<number>('agenda.casiLlenoPct') / 100;
  for (const d of cupo) {
    if (d.fecha < hoy || !d.abierto || !d.total) continue;
    const lleno = d.ocupados >= d.total;
    if (lleno || d.ocupados / d.total >= pct) anuncios.push({ tipo: lleno ? 'lleno' : 'casi_lleno', fecha: d.fecha, titulo: '', agendadas: citas(d.fecha), total: d.total, ocupados: d.ocupados, libres: d.libres });
  }

  const orden: Record<TipoAnuncio, number> = { cierre: 0, festivo: 1, lleno: 2, casi_lleno: 3, mantenimiento: 4 };
  anuncios.sort((a, b) => a.fecha.localeCompare(b.fecha) || orden[a.tipo] - orden[b.tipo] || (a.inicio ?? 0) - (b.inicio ?? 0));
  return { cupo, anuncios, festivos: paisDeFestivos() };
}

/** Un recordatorio para el panel: los que hay que mandar a mano llevan el texto y el número. */
export interface RecordatorioDelPanel {
  id: number;
  userId: string;
  contactName: string | null;
  startsAt: number;
  remindAt: number;
  estado: 'a_mano' | 'programado' | 'enviado' | 'confirmó' | 'no_puede';
  text?: string;
  number?: string | null;
}

/** El panel «Hoy» del calendario. Independiente de la semana que se mire: siempre es hoy. */
export function panelHoy(sede: string | null = null, now = Date.now()) {
  const p = tzParts(new Date(now));
  const inicioHoy = zoned(p.y, p.m, p.d, 0, 0).getTime();
  const pm = tzParts(new Date(inicioHoy + 36 * 3600_000));
  const inicioManana = zoned(pm.y, pm.m, pm.d, 0, 0).getTime();
  const pp = tzParts(new Date(inicioManana + 36 * 3600_000));
  const inicioPasado = zoned(pp.y, pp.m, pp.d, 0, 0).getTime();
  const deLaSede = enLaSede(sede);

  const dosDias = listAppointments({ from: inicioHoy, to: inicioPasado - 1, limit: 500 }).filter(deLaSede).filter((a) => a.status !== 'cancelada');
  // La próxima: la primera confirmada que no ha terminado (la que está en curso cuenta: «termina en 20 min»).
  const proxima = listAppointments({ from: now - 12 * 3600_000, status: 'confirmada', limit: 200 }).filter(deLaSede).find((a) => a.endsAt > now) ?? null;

  const recordatorios: RecordatorioDelPanel[] = remindersBoard(now)
    .filter(deLaSede)
    .map((a) => {
      const estado: RecordatorioDelPanel['estado'] = a.reply ?? (a.reminder?.status === 'a_mano' ? 'a_mano' : a.reminder?.status === 'enviado' ? 'enviado' : 'programado');
      return { id: a.id, userId: a.userId, contactName: a.contactName ?? null, startsAt: a.startsAt, remindAt: a.remindAt, estado, ...(estado === 'a_mano' ? { text: a.text, number: a.number } : {}) };
    })
    .filter((r) => r.estado !== 'programado' || r.remindAt > now);

  // El cupo de los próximos días que se atienden (los bloqueados también salen: «Bloqueado» es cupo cero a propósito).
  const n = regla<number>('agenda.diasCupo');
  const festivos = new Map(festivosEntre(diaDe(inicioHoy), diaDe(inicioHoy + 30 * DIA)).map((f) => [f.fecha, f.nombre]));
  const cupo = cupoPorDia(inicioHoy, inicioHoy + 30 * DIA, { sede, now })
    .filter((d) => d.abierto || d.cerrado)
    .slice(0, n)
    .map((d) => ({ ...d, ...(festivos.has(d.fecha) ? { festivo: festivos.get(d.fecha) } : {}) }));

  return {
    ahora: now,
    proxima: proxima ? citaConDatos(proxima) : null,
    hoy: dosDias.filter((a) => a.startsAt < inicioManana).map(citaConDatos),
    manana: dosDias.filter((a) => a.startsAt >= inicioManana && a.status === 'confirmada').map(citaConDatos),
    recordatorios: { activos: business.appointments.enabled && business.appointments.reminder.enabled, lista: recordatorios },
    cupo,
  };
}
