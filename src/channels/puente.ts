// El lado del CRM cuando la sesión de WhatsApp vive en otra máquina.
//
// Por qué existe: WhatsApp por código QR rechaza las conexiones que salen de un alojamiento compartido. Cierra
// la sesión al instante, sin decir por qué (comprobado: ocho cierres seguidos, todos a los 0-1 segundos, con el
// camino de red abierto, un solo proceso, el reloj en hora y la versión del protocolo correcta). Desde un equipo
// normal, el mismo código entrega el código QR en dos segundos.
//
// La salida no es mudar el CRM a ese equipo —los datos de un cliente no se mueven por un problema de red—, sino
// dejar allá **solo la pieza que habla con WhatsApp** y que el CRM siga donde está. Para quien usa el tablero,
// esto es invisible: escanea el código en la misma pantalla de siempre y las conversaciones aparecen donde
// siempre. Lo único que cambia es de qué máquina sale la conexión.
//
// 🪤 El conector vive detrás del router de una casa o una oficina: no tiene dirección a la que llamar. Así que
// todas las conversaciones las empieza él. El CRM nunca le habla; le deja lo que hay que mandar en una cola y el
// conector pasa a recogerlo. Por eso esto no es un webhook, sino un buzón.
import { getDb } from '../rag/store.js';
import { getSetting, setSetting } from '../crm/settings.js';

/** Lo último que el conector contó de sí mismo. Es lo que el tablero enseña como estado de WhatsApp. */
export interface EstadoPuente {
  estado: 'apagado' | 'conectando' | 'esperando_qr' | 'conectado' | 'sesion_cerrada';
  qr?: string;
  me?: string;
  error?: string;
  /** Cuándo lo dijo: si hace rato que no dice nada, el conector se cayó. */
  visto: number;
}

/** Sin noticias en este tiempo, se da por ausente: manda menos de un latido por minuto solo si algo va mal. */
const SILENCIO_MAX = 90_000;

export const estadoPuente = (ahora = Date.now()): EstadoPuente | null => {
  const e = getSetting<EstadoPuente | null>('puente.whatsapp.estado', null);
  if (!e) return null;
  return ahora - e.visto > SILENCIO_MAX ? { ...e, estado: 'apagado', error: 'El conector de WhatsApp lleva un rato sin dar señales.' } : e;
};

export const anotarEstadoPuente = (e: Omit<EstadoPuente, 'visto'>, ahora = Date.now()): void =>
  setSetting('puente.whatsapp.estado', { ...e, visto: ahora });

/** Deja un mensaje en el buzón para que el conector lo recoja y lo mande. */
export function encolarSalida(userId: string, texto: string, ahora = Date.now()): void {
  getDb().prepare('INSERT INTO wa_salida (user_id, texto, ts) VALUES (?, ?, ?)').run(userId, texto, ahora);
}

/**
 * Lo que está esperando salir. Marca lo entregado en la misma llamada: si el conector se cae después de recoger,
 * ese mensaje se pierde en vez de repetirse. Es a propósito —mandarle dos veces lo mismo a un cliente se ve peor
 * que no mandarlo, y el equipo ve en el tablero lo que quedó sin entregar.
 */
export function recogerSalida(limite = 20, ahora = Date.now()): { id: number; userId: string; texto: string }[] {
  const db = getDb();
  const filas = db.prepare('SELECT id, user_id, texto FROM wa_salida WHERE entregado_at IS NULL ORDER BY id LIMIT ?').all(limite) as {
    id: number;
    user_id: string;
    texto: string;
  }[];
  const marcar = db.prepare('UPDATE wa_salida SET entregado_at = ? WHERE id = ?');
  for (const f of filas) marcar.run(ahora, f.id);
  return filas.map((f) => ({ id: f.id, userId: f.user_id, texto: f.texto }));
}

/** Cuántos mensajes llevan esperando a que el conector pase: si crece, es que no está viniendo. */
export const sinEntregar = (): number =>
  (getDb().prepare('SELECT COUNT(*) n FROM wa_salida WHERE entregado_at IS NULL').get() as { n: number }).n;

/** Limpia lo ya entregado de hace días: esta cola es un buzón, no un archivo. */
export function limpiarSalida(antesDe = Date.now() - 7 * 86400_000): number {
  return Number(getDb().prepare('DELETE FROM wa_salida WHERE entregado_at IS NOT NULL AND entregado_at < ?').run(antesDe).changes);
}
