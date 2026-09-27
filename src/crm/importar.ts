// Traer un chat exportado de WhatsApp **como conversación** al tablero: el grupo de soporte de un cliente se
// vuelve una ficha con su historial, no un archivo que nadie vuelve a abrir.
//
// Es distinto de `historial.ts`, que lee esos mismos chats para aprender **cómo se atiende**. Aquí no se aprende
// nada: se copia la conversación tal cual para que el equipo la tenga a mano y la ficha exista desde el día uno.
//
// Dos cosas que este módulo hace y hay que entender:
//
//  1. 🪤 **Tapa credenciales.** Un grupo de soporte está lleno de «Usuario: … Clave: …». Eso no puede quedar
//     guardado en un CRM ni salir en una pantalla: se reemplaza por una marca antes de escribir nada. Es lo
//     primero que pasa con cada mensaje, no un filtro de después.
//  2. **Se puede quitar exacto.** Todo lo importado lleva el prefijo `wa:hist-` en el id, igual que los datos de
//     demostración llevan el suyo. Si se importó el chat equivocado, se borra sin tocar nada más.
//
// Quién es quién: los mensajes de la gente del negocio entran como respuestas **de una persona** (con su
// nombre), no del asistente. Sería mentira marcarlas como suyas, y además el tablero ya sabe mostrar quién
// contestó.
import { business } from '../config.js';
import { getDb } from '../rag/store.js';
import { getContact, purgeContact } from './contacts.js';
import { leerChatExportado, type MensajeImportado } from './historial.js';
import { taparSecretos } from './secretos.js';

export { taparSecretos } from './secretos.js';

export const PREFIJO = 'wa:hist-';

const slugificar = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'chat';

/**
 * En qué columna cae un chat traído. Un grupo de soporte de hace dos meses no es una conversación «nueva»: el
 * tablero se leería como si hubiera trabajo sin atender que no existe. Lo que siguió esta semana entra como
 * activo y lo que se apagó, como cerrado. Por rol, nunca por el nombre de la etapa: cada negocio las llama
 * distinto. Si el negocio no definió esos roles, se queda en la primera columna y una persona lo mueve.
 */
function etapaPorRecencia(hasta: number, ahora: number): string {
  const conRol = (rol: string) => business.crm.stages.find((e) => e.rol === rol)?.id;
  const reciente = ahora - hasta < 14 * 86400_000;
  return (reciente ? conRol('activo') : conRol('ganado')) ?? business.crm.stages[0]!.id;
}

export interface Importada {
  id: string;
  nombre: string;
  mensajes: number;
  delNegocio: number;
  tapados: number;
  desde: number | null;
  hasta: number | null;
}

/** Cuántas conversaciones importadas hay. */
export const cuantas = (): number =>
  (getDb().prepare('SELECT COUNT(*) n FROM users WHERE id LIKE ?').get(`${PREFIJO}%`) as { n: number }).n;

/** Quita **solo** las importadas. */
export function quitar(): number {
  const db = getDb();
  const ids = (db.prepare('SELECT id FROM users WHERE id LIKE ?').all(`${PREFIJO}%`) as { id: string }[]).map((r) => r.id);
  for (const id of ids) {
    purgeContact(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }
  return ids.length;
}

/**
 * Convierte un chat exportado en una conversación del tablero.
 *
 * `delNegocio` son los nombres con los que escribe el equipo (como salen en el export). Lo que escriban ellos
 * entra como respuesta de una persona; lo demás, como mensajes del cliente.
 */
export function importarChat(
  texto: string,
  opts: { nombre: string; delNegocio: string[]; etapa?: string; ahora?: number },
): Importada {
  const mensajes = leerChatExportado(texto, { delNegocio: opts.delNegocio, chat: opts.nombre });
  if (!mensajes.length) throw new Error('no reconocí ningún mensaje en ese archivo');
  return importarMensajes(mensajes, opts);
}

/**
 * Lo mismo, pero partiendo de mensajes ya leídos. Sirve para lo que llega solo al vincular WhatsApp: ese
 * historial se guarda aparte para aprender, y desde ahí se puede traer al tablero como conversaciones de verdad.
 */
export function importarMensajes(
  mensajes: MensajeImportado[],
  opts: { nombre: string; etapa?: string; ahora?: number },
): Importada {
  if (!mensajes.length) throw new Error('no hay mensajes que traer');

  const db = getDb();
  const id = `${PREFIJO}${slugificar(opts.nombre)}`;
  if (getContact(id)) {
    purgeContact(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }

  const ordenados = [...mensajes].sort((a, b) => a.ts - b.ts);
  const desde = ordenados[0]!.ts;
  const hasta = ordenados[ordenados.length - 1]!.ts;
  const ahora = opts.ahora ?? Date.now();
  db.prepare('INSERT INTO users (id, channel, name, first_seen, last_seen, stage) VALUES (?, ?, ?, ?, ?, ?)').run(
    id,
    'whatsapp',
    opts.nombre,
    desde,
    hasta,
    opts.etapa ?? etapaPorRecencia(hasta, ahora),
  );

  let tapados = 0;
  let delNegocio = 0;
  const poner = db.prepare('INSERT INTO messages (user_id, role, content, intent, ts, author, by) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const m of ordenados as MensajeImportado[]) {
    const limpio = taparSecretos(m.content);
    tapados += limpio.tapados;
    const esDelNegocio = m.role === 'assistant'; // el lector ya decidió quién es quién con `delNegocio`
    if (esDelNegocio) delNegocio++;
    // Lo que escribió el equipo fue una persona, no el asistente: se guarda como tal, con su nombre.
    poner.run(id, m.role, limpio.texto, null, m.ts, esDelNegocio ? 'human' : 'customer', esDelNegocio ? m.autor : null);
  }

  const ultimos = ordenados
    .slice(-6)
    .map((m) => `${m.role === 'assistant' ? 'equipo' : 'cliente'}: ${taparSecretos(m.content).texto}`)
    .join(' · ');
  db.prepare('UPDATE users SET last_message_at = ?, summary = ?, unread = 0 WHERE id = ?').run(hasta, ultimos.slice(0, 400), id);

  return { id, nombre: opts.nombre, mensajes: ordenados.length, delNegocio, tapados, desde, hasta };
}
