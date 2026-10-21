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
//
// Y cuando la conversación la lleva una persona, aiva tampoco se aparta del todo: si el cliente pregunta algo que
// sabe —un precio, el horario, la dirección—, deja la respuesta lista aquí mismo y quien atiende la manda de un
// toque o sigue a lo suyo. Nunca escribe sola en una conversación que tiene alguien (ver agent.ts, «acompaña»).
import { getDb } from '../rag/store.js';
import { emitEvent } from './events.js';
import { getSetting, setSetting } from './settings.js';

export interface Propuesta {
  id: number;
  userId: string;
  texto: string;
  intent: string;
  /** El grupo donde se dijo, si fue en uno. Vacío en una conversación normal. */
  grupo: string;
  /**
   * A qué contesta, con quién lo preguntó. 🪤 Quien decide si esto se manda necesita ver la PREGUNTA: una
   * respuesta suelta, fuera de la conversación donde nació, no se puede juzgar. Y en un grupo, donde no hay
   * conversación en el tablero que abrir, es lo único que la hace entendible.
   */
  sobre: string;
  /** El último mensaje del cliente cuando se redactó: si ya no es el último, la propuesta se quedó vieja. */
  sobreMensaje: number;
  creado: number;
  /**
   * Se redactó mientras la llevaba una persona. 🪤 Esa persona ya está en la conversación: la propuesta aparece
   * ahí y punto, sin campana ni aviso. Avisarle a alguien de lo que tiene delante es ruido, y con ruido se apaga.
   */
  conPersona: boolean;
}

/**
 * Que aiva deje respuestas listas cuando la conversación la lleva una persona. Encendido de fábrica: el usuario
 * lo eligió así el 2026-10-21. Cuesta una pasada por el modelo por cada mensaje del cliente mientras alguien la
 * lleva, y por eso se puede apagar por cliente desde el tablero.
 */
export function sugiereConPersona(): boolean {
  return getSetting('agente.sugiereEnHumano', true);
}

export function ponerSugiereConPersona(on: boolean): void {
  setSetting('agente.sugiereEnHumano', on);
}

type Fila = { id: number; user_id: string; texto: string; intent: string; grupo: string; sobre: string; sobre_mensaje: number; creado: number; con_persona: number };
const COLUMNAS = 'id, user_id, texto, intent, grupo, sobre, sobre_mensaje, creado, con_persona';
const deFila = (f: Fila): Propuesta => ({
  id: f.id,
  userId: f.user_id,
  texto: f.texto,
  intent: f.intent,
  grupo: f.grupo,
  sobre: f.sobre,
  sobreMensaje: f.sobre_mensaje,
  creado: f.creado,
  conPersona: Boolean(f.con_persona),
});

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
        grupo TEXT NOT NULL DEFAULT '',
        sobre TEXT NOT NULL DEFAULT '',
        con_persona INTEGER NOT NULL DEFAULT 0,
        estado TEXT NOT NULL DEFAULT 'pendiente',
        creado INTEGER NOT NULL,
        resuelto INTEGER,
        por TEXT
      );
      CREATE INDEX IF NOT EXISTS propuestas_pendientes ON propuestas(estado, user_id);
    `);
    // 🪤 CREATE TABLE IF NOT EXISTS no añade columnas a una tabla que ya existe. Quien tenga la de ayer se
    // quedaría con un «no such column: grupo» en la primera propuesta, y sin saber de dónde sale.
    const cols = new Set((db.prepare('PRAGMA table_info(propuestas)').all() as { name: string }[]).map((c) => c.name));
    if (!cols.has('grupo')) db.exec("ALTER TABLE propuestas ADD COLUMN grupo TEXT NOT NULL DEFAULT ''");
    if (!cols.has('sobre')) db.exec("ALTER TABLE propuestas ADD COLUMN sobre TEXT NOT NULL DEFAULT ''");
    if (!cols.has('con_persona')) db.exec('ALTER TABLE propuestas ADD COLUMN con_persona INTEGER NOT NULL DEFAULT 0');
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
export function proponer(userId: string, texto: string, intent = '', grupo = '', sobre = '', opts: { conPersona?: boolean } = {}): Propuesta {
  const db = tabla();
  db.prepare("UPDATE propuestas SET estado = 'reemplazada', resuelto = ? WHERE user_id = ? AND estado = 'pendiente'").run(Date.now(), userId);
  const creado = Date.now();
  const ultimo = ultimoMensaje(userId);
  const conPersona = Boolean(opts.conPersona);
  const id = Number(
    db
      .prepare('INSERT INTO propuestas (user_id, texto, intent, grupo, sobre, sobre_mensaje, creado, con_persona) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(userId, texto, intent, grupo, sobre, ultimo, creado, conPersona ? 1 : 0).lastInsertRowid,
  );
  const p: Propuesta = { id, userId, texto, intent, grupo, sobre, sobreMensaje: ultimo, creado, conPersona };
  emitEvent('propuesta', userId, { propuesta: p });
  return p;
}

/** La que está esperando en esa conversación, si hay. */
export function propuestaDe(userId: string): (Propuesta & { vieja: boolean }) | null {
  const f = tabla().prepare(`SELECT ${COLUMNAS} FROM propuestas WHERE user_id = ? AND estado = 'pendiente' ORDER BY id DESC LIMIT 1`).get(userId) as Fila | undefined;
  if (!f) return null;
  // Llegó algo después de redactarla: ya no contesta a lo último que dijeron.
  return { ...deFila(f), vieja: ultimoMensaje(userId) > f.sobre_mensaje };
}

/** Todas las que esperan, para la pantalla de Hoy. */
export function propuestasPendientes(limite = 50): Propuesta[] {
  return (tabla().prepare(`SELECT ${COLUMNAS} FROM propuestas WHERE estado = 'pendiente' ORDER BY creado DESC LIMIT ?`).all(limite) as Fila[]).map(deFila);
}

export function cerrarPropuesta(id: number, estado: 'enviada' | 'descartada', por = ''): boolean {
  return Number(tabla().prepare('UPDATE propuestas SET estado = ?, resuelto = ?, por = ? WHERE id = ?').run(estado, Date.now(), por, id).changes) > 0;
}

/**
 * Una persona contestó a mano: lo que aiva dejó listo en esa conversación ya sobra.
 *
 * 🪤 Sin esto, quien lleva la conversación contesta con sus palabras y encima del cajón se queda la propuesta
 * diciendo «esta respuesta se quedó atrás · escribió otra vez después», como si el cliente hubiera escrito. Es
 * falso, y es ruido justo donde la persona está trabajando.
 */
export function apartarPropuestas(userId: string, por = ''): void {
  tabla().prepare("UPDATE propuestas SET estado = 'reemplazada', resuelto = ?, por = ? WHERE user_id = ? AND estado = 'pendiente'").run(Date.now(), por, userId);
}

export function verPropuesta(id: number): Propuesta | null {
  const f = tabla().prepare(`SELECT ${COLUMNAS} FROM propuestas WHERE id = ? AND estado = 'pendiente'`).get(id) as Fila | undefined;
  return f ? deFila(f) : null;
}
