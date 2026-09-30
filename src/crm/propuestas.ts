// Lo que aiva dejó listo para que una persona lo mande.
//
// En el modo «Propone», aiva hace todo el trabajo —lee, busca, redacta— y se detiene justo antes de hablar.
// Quien atiende encuentra la respuesta escrita encima del cajón de escribir y decide: la manda, la corrige o la
// descarta. Es el paso intermedio entre «que no diga nada» y «que le hable a mis clientes».
//
// 🪤 Una propuesta CADUCA. Una respuesta preparada hace veinte minutos, para un cliente que mientras tanto
// escribió otras tres cosas, ya no responde a nada: mandarla de un toque sería peor que no tener el modo. Por
// eso se guarda con el mensaje que la provocó, y si llegó algo después, se marca como vieja y no se ofrece
// para mandar de un clic.
import { getDb } from '../rag/store.js';
import { emitEvent } from './events.js';

export interface Propuesta {
  id: number;
  userId: string;
  texto: string;
  intent: string;
  /** El último mensaje del cliente cuando se redactó: si ya no es el último, la propuesta se quedó vieja. */
  sobreMensaje: number;
  creado: number;
}

let lista = false;
function tabla() {
  const db = getDb();
  if (!lista) {
    db.exec(`
      -- Respuestas que aiva dejó listas y todavía no ha mandado nadie. Ver crm/propuestas.ts.
      CREATE TABLE IF NOT EXISTS propuestas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        texto TEXT NOT NULL,
        intent TEXT NOT NULL DEFAULT '',
        sobre_mensaje INTEGER NOT NULL DEFAULT 0,
        estado TEXT NOT NULL DEFAULT 'pendiente',
        creado INTEGER NOT NULL,
        resuelto INTEGER,
        por TEXT
      );
      CREATE INDEX IF NOT EXISTS propuestas_pendientes ON propuestas(estado, user_id);
    `);
    lista = true;
  }
  return db;
}

const ultimoMensaje = (userId: string): number =>
  Number((tabla().prepare('SELECT COALESCE(MAX(id), 0) n FROM messages WHERE user_id = ?').get(userId) as { n: number }).n);

/**
 * Guarda una propuesta. Solo una pendiente por conversación: si aiva redacta otra, la anterior sobra — es la
 * misma pregunta con más contexto, y dos respuestas a medias no ayudan a nadie a decidir.
 */
export function proponer(userId: string, texto: string, intent = ''): Propuesta {
  const db = tabla();
  db.prepare("UPDATE propuestas SET estado = 'reemplazada', resuelto = ? WHERE user_id = ? AND estado = 'pendiente'").run(Date.now(), userId);
  const creado = Date.now();
  const sobre = ultimoMensaje(userId);
  const id = Number(
    db.prepare('INSERT INTO propuestas (user_id, texto, intent, sobre_mensaje, creado) VALUES (?, ?, ?, ?, ?)').run(userId, texto, intent, sobre, creado)
      .lastInsertRowid,
  );
  const p: Propuesta = { id, userId, texto, intent, sobreMensaje: sobre, creado };
  emitEvent('propuesta', userId, { propuesta: p });
  return p;
}

/** La que está esperando en esa conversación, si hay. */
export function propuestaDe(userId: string): (Propuesta & { vieja: boolean }) | null {
  const f = tabla()
    .prepare("SELECT id, user_id, texto, intent, sobre_mensaje, creado FROM propuestas WHERE user_id = ? AND estado = 'pendiente' ORDER BY id DESC LIMIT 1")
    .get(userId) as { id: number; user_id: string; texto: string; intent: string; sobre_mensaje: number; creado: number } | undefined;
  if (!f) return null;
  return {
    id: f.id,
    userId: f.user_id,
    texto: f.texto,
    intent: f.intent,
    sobreMensaje: f.sobre_mensaje,
    creado: f.creado,
    // Llegó algo después de redactarla: ya no contesta a lo último que dijeron.
    vieja: ultimoMensaje(userId) > f.sobre_mensaje,
  };
}

/** Todas las que esperan, para la pantalla de Hoy. */
export function propuestasPendientes(limite = 50): Propuesta[] {
  return tabla()
    .prepare("SELECT id, user_id AS userId, texto, intent, sobre_mensaje AS sobreMensaje, creado FROM propuestas WHERE estado = 'pendiente' ORDER BY creado DESC LIMIT ?")
    .all(limite) as unknown as Propuesta[];
}

export function cerrarPropuesta(id: number, estado: 'enviada' | 'descartada', por = ''): boolean {
  return Number(tabla().prepare('UPDATE propuestas SET estado = ?, resuelto = ?, por = ? WHERE id = ?').run(estado, Date.now(), por, id).changes) > 0;
}

export function verPropuesta(id: number): Propuesta | null {
  const f = tabla()
    .prepare("SELECT id, user_id, texto, intent, sobre_mensaje, creado FROM propuestas WHERE id = ? AND estado = 'pendiente'")
    .get(id) as { id: number; user_id: string; texto: string; intent: string; sobre_mensaje: number; creado: number } | undefined;
  return f ? { id: f.id, userId: f.user_id, texto: f.texto, intent: f.intent, sobreMensaje: f.sobre_mensaje, creado: f.creado } : null;
}
