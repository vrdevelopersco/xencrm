// Lo que ya entró, para no atenderlo dos veces.
//
// Meta lo advierte en su documentación: una notificación del webhook puede llegar más de una vez, y si no le
// respondemos 200 a tiempo la reintenta durante días. Sin esto, el mismo «hola» entra dos veces: dos mensajes en el
// CRM y dos respuestas al cliente, o —si el repetido cae dentro de la espera que junta los mensajes seguidos— un
// «hola\nhola» que el modelo contesta como si el cliente hubiera insistido.
//
// 🪤 En la base y no en memoria. Un reinicio —un despliegue— es justo cuando Meta reintenta lo que quedó sin
// confirmar, y un conjunto en memoria llega vacío a ese momento.
//
// WhatsApp por QR (Baileys) no pasa por aquí: en lo que tienen guardado los clientes que lo usan (2026-10-12) no
// hay ni un mensaje repetido, y Baileys puede entregar primero un mensaje que no logró descifrar y después el mismo
// id ya descifrado. Marcar «ya visto» el primer intento se tragaría el bueno.
import { getDb } from '../rag/store.js';

/** Lo que se recuerda: Meta deja de reintentar mucho antes. */
const SIETE_DIAS = 7 * 24 * 3600_000;
const CADA_HORA = 3600_000;
let ultimaLimpieza = 0;

/**
 * true la primera vez que llega ese mensaje por ese canal; false si ya había llegado. Sin id no hay con qué
 * compararlo, y se atiende: perder un mensaje es peor que contestarlo dos veces.
 */
export function primeraVez(canal: string, id: string | null | undefined, ahora = Date.now()): boolean {
  if (!id) return true;
  const db = getDb();
  if (ahora - ultimaLimpieza > CADA_HORA) {
    ultimaLimpieza = ahora;
    db.prepare('DELETE FROM entrantes WHERE ts < ?').run(ahora - SIETE_DIAS);
  }
  const r = db.prepare('INSERT OR IGNORE INTO entrantes (canal, id, ts) VALUES (?, ?, ?)').run(canal, id, ahora);
  return Number(r.changes) > 0;
}
