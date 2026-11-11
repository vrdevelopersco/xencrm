// La historia comercial de una persona: qué pasó con ella, no en qué casilla está.
//
// La etapa dice dónde está hoy. No dice si ya vino una vez y no compró, si lleva tres meses volviendo, o si
// agendó dos citas y faltó a las dos. Eso es lo que decide cómo se le habla, y hasta ahora había que leerse la
// conversación entera para saberlo.
//
// 🪤 Todo lo de aquí se DEDUCE de lo que ya está guardado —citas y mensajes— y no se escribe en ninguna parte.
// Un campo «amagó» que alguien tiene que marcar a mano se queda sin marcar, y entonces miente: dice que no pasó
// cuando lo que pasa es que nadie lo apuntó. Calculado, siempre está al día y nadie tiene que acordarse.
import { V } from '../vocabulario.js';
import { listAppointments } from './appointments.js';
import { getMessages } from '../agent/memory.js';
import { rolDe, type Stage } from './contacts.js';

export interface Historia {
  /** Desde cuándo se le conoce y cuándo fue la última vez. */
  desde: number | null;
  ultima: number | null;
  mensajes: number;
  /**
   * Cuántas veces volvió después de un silencio largo.
   *
   * 🪤 Un silencio de más de 14 días y luego escribe: eso es volver. Con un umbral corto —un par de días— se
   * contarían como «vueltas» las pausas normales de cualquier conversación, y el número dejaría de significar
   * nada justo cuando se pone en una ficha para decidir cómo tratar a alguien.
   */
  volvio: number;
  citas: { total: number; cumplidas: number; falto: number; canceladas: number; proxima: number | null };
  /**
   * Llegó a tener cita y no acabó en venta. Es lo que en una tienda se llama «se me fue»: la señal más clara de
   * que hay algo que atender, porque el interés estuvo.
   */
  amago: boolean;
}

export interface ComoVa {
  /** Cuándo se mira. Solo para poder probarlo sin esperar. */
  ahora?: number;
  /**
   * En qué etapa está, para saber si la cosa acabó en venta.
   *
   * 🪤 Sin esto, quien vino a su cita y COMPRÓ sale marcado como venta perdida, porque por fuera se ve igual que
   * quien vino y no volvió: cita cumplida y ninguna por venir. Es un letrero rojo en la ficha del mejor cliente,
   * y de los que alguien enseña en una reunión.
   */
  etapa?: string;
}

const DIA = 86400_000;
/** Lo que separa una pausa de una vuelta. Catorce días: menos de eso es una conversación que respira. */
const SILENCIO = 14 * DIA;

export function historiaDe(userId: string, opts: ComoVa = {}): Historia {
  const ahora = opts.ahora ?? Date.now();
  const msgs = getMessages(userId, 500).filter((m) => m.author === 'customer');
  const citas = listAppointments({ userId, limit: 50 });

  let volvio = 0;
  for (let i = 1; i < msgs.length; i++) {
    if (msgs[i]!.ts - msgs[i - 1]!.ts >= SILENCIO) volvio++;
  }

  const cumplidas = citas.filter((a) => a.status === 'completada').length;
  const falto = citas.filter((a) => a.status === 'no_asistio').length;
  const canceladas = citas.filter((a) => a.status === 'cancelada').length;
  const proximas = citas.filter((a) => a.status === 'confirmada' && a.startsAt >= ahora).map((a) => a.startsAt);

  return {
    desde: msgs.length ? msgs[0]!.ts : null,
    ultima: msgs.length ? msgs[msgs.length - 1]!.ts : null,
    mensajes: msgs.length,
    volvio,
    citas: { total: citas.length, cumplidas, falto, canceladas, proxima: proximas.length ? Math.min(...proximas) : null },
    // Hubo cita, ya pasó, no quedó ninguna por venir, y no acabó en venta: el interés estuvo y no se cerró.
    amago:
      citas.length > 0 &&
      !proximas.length &&
      cumplidas + falto + canceladas > 0 &&
      rolDe((opts.etapa ?? '') as Stage) !== 'ganado',
  };
}

/** La historia en una frase, para leerla de un vistazo sin interpretar números. */
export function enUnaFrase(h: Historia): string {
  const partes: string[] = [];
  if (h.volvio > 0) partes.push(h.volvio === 1 ? 'volvió una vez' : `volvió ${h.volvio} veces`);
  if (h.citas.cumplidas) partes.push(h.citas.cumplidas === 1 ? `vino a ${V.una} ${V.cita}` : `vino a ${h.citas.cumplidas} ${V.citas}`);
  if (h.citas.falto) partes.push(h.citas.falto === 1 ? `faltó a ${V.una} ${V.cita}` : `faltó a ${h.citas.falto} ${V.citas}`);
  if (h.citas.canceladas) partes.push(h.citas.canceladas === 1 ? `canceló ${V.una}` : `canceló ${h.citas.canceladas}`);
  if (h.citas.proxima) partes.push(`tiene ${V.cita}`);
  if (!partes.length) return h.mensajes ? 'solo ha escrito' : 'sin historia todavía';
  return partes.join(' · ');
}
