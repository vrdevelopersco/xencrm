// El registro público de la portada y de la puerta de la consola («Pruébalo con tu negocio»), antes de que llegue a
// un CRM: qué se acepta, qué se frena y qué se le contesta a un bot. Sin red: la consola (consola.ts, POST
// /api/prospecto) lo usa y después lo pasa a la instancia que recibe los prospectos (PROSPECTOS_CLIENTE).
//
// 🪤 A un bot no se le dice que lo pillaron: si llenó la trampa (el campo «sitio», que una persona no ve) o mandó el
// formulario más rápido de lo que alguien lo llena, se le contesta lo mismo que a una persona y no se guarda nada.
// Un «rechazado por spam» le enseña a esquivar la trampa la próxima vez.

export interface ProspectoLimpio {
  nombre: string;
  /** Solo dígitos, con el indicativo: «573001234567». */
  whatsapp: string;
  empresa: string;
  interes: '' | 'ventas' | 'soporte' | 'cotizacion';
  desde: 'portada' | 'consola';
}

export type Revision = { ok: ProspectoLimpio } | { bot: true } | { error: string; campo: string };

/** Menos que esto no lo llena una persona (nombre, WhatsApp, casilla y botón). */
export const MS_MINIMOS = 2500;
const INTERESES = ['ventas', 'soporte', 'cotizacion'];

const texto = (v: unknown, max: number) =>
  String(v ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

export function revisarProspecto(body: Record<string, unknown>): Revision {
  if (texto(body.sitio, 200)) return { bot: true };
  const ms = Number(body.ms);
  if (Number.isFinite(ms) && ms >= 0 && ms < MS_MINIMOS) return { bot: true };
  const nombre = texto(body.nombre, 80);
  if (nombre.length < 2) return { error: 'Escribe tu nombre.', campo: 'nombre' };
  // Un nombre con un enlace no es un nombre.
  if (/https?:|www\.|<|>/i.test(nombre)) return { error: 'Escribe solo tu nombre.', campo: 'nombre' };
  const whatsapp = String(body.whatsapp ?? '').replace(/\D/g, '');
  if (whatsapp.length < 10 || whatsapp.length > 15) return { error: 'Ese número no parece de WhatsApp: escríbelo con el indicativo, como +57 300 123 4567.', campo: 'whatsapp' };
  if (body.acepto !== true) return { error: 'Necesitamos tu permiso para escribirte.', campo: 'acepto' };
  const interes = INTERESES.includes(String(body.interes)) ? (String(body.interes) as ProspectoLimpio['interes']) : '';
  const desde = body.desde === 'consola' ? 'consola' : 'portada';
  return { ok: { nombre, whatsapp, empresa: texto(body.empresa, 80), interes, desde } };
}

/**
 * El freno: pocos registros por dirección y un techo para todos. En memoria: si el proceso se reinicia, empieza de
 * cero, y está bien (el freno es contra una ráfaga, no un registro de quién se registró).
 */
export const POR_IP = { veces: 5, ventanaMs: 15 * 60_000 };
export const PARA_TODOS = { veces: 120, ventanaMs: 60 * 60_000 };
const vistos = new Map<string, number[]>();
const todos: number[] = [];

/** null si puede pasar (y lo anota); si no, en cuántos segundos puede volver a intentarlo. */
export function frenoDelProspecto(ip: string, ahora = Date.now()): number | null {
  const propios = (vistos.get(ip) ?? []).filter((t) => ahora - t < POR_IP.ventanaMs);
  while (todos.length && ahora - todos[0]! >= PARA_TODOS.ventanaMs) todos.shift();
  if (propios.length >= POR_IP.veces) return Math.ceil((POR_IP.ventanaMs - (ahora - propios[0]!)) / 1000);
  if (todos.length >= PARA_TODOS.veces) return Math.ceil((PARA_TODOS.ventanaMs - (ahora - todos[0]!)) / 1000);
  propios.push(ahora);
  todos.push(ahora);
  vistos.set(ip, propios);
  // Que el mapa no crezca sin fin con direcciones que no vuelven.
  if (vistos.size > 5000) for (const [k, v] of vistos) if (!v.some((t) => ahora - t < POR_IP.ventanaMs)) vistos.delete(k);
  return null;
}

/** Solo para las pruebas. */
export function olvidarFrenos(): void {
  vistos.clear();
  todos.length = 0;
}
