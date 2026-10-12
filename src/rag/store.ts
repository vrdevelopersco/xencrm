import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { env } from '../config.js';

/**
 * Lo que aiva sabe, por audiencia.
 *
 * `product` y `knowledge` son lo que se le puede CONTAR a un cliente: el catálogo y la información del negocio
 * —qué hace cada programa, cómo funciona el proceso, qué incluye—. Esa parte hace falta y mucho: sin ella, el
 * asistente de un negocio de software no sabe explicar su propio producto.
 *
 * 🪤 `interno` es lo contrario: lo que aiva necesita saber para ayudar AL EQUIPO y no debe salir nunca por una
 * conversación. Con qué proveedor trabajan, qué margen manejan, qué cliente da problemas, qué producto no
 * quieren empujar. Va aparte porque la diferencia no es de tema, es de a quién se le puede decir.
 */
export type DocKind = 'product' | 'knowledge' | 'interno';

/**
 * 🪤 Lo interno hay que pedirlo POR SU NOMBRE para que salga.
 *
 * Buscar sin decir de qué tipo devolvía de todo, y eso convierte un `retrieve(pregunta)` escrito de buena fe en
 * una filtración: el buscador hace su trabajo, encuentra el documento que mejor encaja, y resulta ser el que
 * dice cuánto le cuesta cada traje al negocio. No habría un error que buscar, porque no habría ningún error.
 *
 * Así que lo peligroso se excluye por defecto y quien lo quiera tiene que nombrarlo. Un descuido futuro se
 * queda en «no encontró nada», que es un fallo que se ve y no hace daño.
 */
const PARA_EL_CLIENTE: DocKind[] = ['product', 'knowledge'];
const paraBuscar = (kinds?: DocKind[]): DocKind[] => kinds ?? PARA_EL_CLIENTE;

export interface Doc {
  id: string;
  kind: DocKind;
  title: string;
  content: string;
  url: string | null;
  meta: Record<string, unknown>;
}

export interface ScoredDoc extends Doc {
  score: number; // RRF combinado
  vectorSim: number; // coseno (0..1), 0 si no apareció en la búsqueda vectorial
  ftsHit: boolean;
}

let db: DatabaseSync | undefined;
// Índice vectorial en memoria: para catálogos de miles de ítems la búsqueda
// por fuerza bruta tarda milisegundos y evita dependencias nativas.
let vectors: { id: string; vec: Float32Array }[] = [];

export function getDb(): DatabaseSync {
  if (db) return db;
  mkdirSync(dirname(env.dbPath), { recursive: true });
  db = new DatabaseSync(env.dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS docs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      url TEXT,
      meta TEXT NOT NULL DEFAULT '{}',
      embedding BLOB NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS docs_kind ON docs(kind);
    CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
      id UNINDEXED, title, content, tokenize = 'unicode61 remove_diacritics 2'
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      name TEXT,
      first_seen INTEGER NOT NULL,
      last_seen INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      intent TEXT,
      ts INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_user_ts ON messages(user_id, ts);
    CREATE TABLE IF NOT EXISTS analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      engine TEXT,
      sentiment TEXT,
      signals TEXT NOT NULL DEFAULT '{}',
      score INTEGER NOT NULL DEFAULT 0,
      factors TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS analyses_user_ts ON analyses(user_id, ts);
    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      starts_at INTEGER NOT NULL,
      ends_at INTEGER NOT NULL,
      service TEXT NOT NULL,
      location TEXT,
      status TEXT NOT NULL DEFAULT 'confirmada',
      notes TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS appointments_starts ON appointments(starts_at);
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS events_user_ts ON events(user_id, ts);
    -- Consumo de los modelos (tokens por llamada); no se borra al purgar un contacto: es gasto real.
    CREATE TABLE IF NOT EXISTS llm_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      user_id TEXT,
      task TEXT NOT NULL,
      engine TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      cached_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL,
      reasoning_tokens INTEGER NOT NULL DEFAULT 0,
      ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS llm_usage_ts ON llm_usage(ts);
    -- Preguntas que el bot no supo responder: quedan "por verificar" hasta que el equipo responde.
    CREATE TABLE IF NOT EXISTS verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      question TEXT NOT NULL,
      topic TEXT,
      status TEXT NOT NULL DEFAULT 'pendiente',
      answer TEXT,
      answered_by TEXT,
      learned INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      answered_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS verifications_status ON verifications(status, created_at);
    -- Frases que las reglas no entendieron (una fecha, un saludo, una respuesta en la cita): se enseñan desde el tablero.
    CREATE TABLE IF NOT EXISTS misses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      key TEXT NOT NULL,
      reading TEXT,
      suggestion TEXT,
      status TEXT NOT NULL DEFAULT 'nueva',
      ts INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS misses_status ON misses(status, kind, key);
    -- Historial que trae un cliente cuando conecta su WhatsApp: vive aparte y NUNCA entra al índice de
    -- conocimiento. De aquí salen las preguntas que le hacen y cómo atiende, no los precios ni las políticas.
    CREATE TABLE IF NOT EXISTS import_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat TEXT NOT NULL,
      autor TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      ts INTEGER NOT NULL,
      origen TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS import_chat ON import_messages(chat, ts);
    -- Lo que ya se decidió sobre un tema del historial: aceptado (pasó al Perfil) o descartado.
    CREATE TABLE IF NOT EXISTS import_temas (
      clave TEXT PRIMARY KEY,
      estado TEXT NOT NULL,
      titulo TEXT NOT NULL,
      ts INTEGER NOT NULL
    );
    -- Por dónde va el historial de cada chat de WhatsApp: el mensaje más antiguo que tenemos. Sirve para pedir
    -- «más hacia atrás» sin desvincular el número, que es lo único que WhatsApp deja hacer después de emparejar.
    CREATE TABLE IF NOT EXISTS wa_cursor (
      chat TEXT PRIMARY KEY,
      key_id TEXT NOT NULL,
      from_me INTEGER NOT NULL DEFAULT 0,
      ts INTEGER NOT NULL
    );
    -- De dónde salió cada conversación (campaña, anuncio, quién la mandó). Una fila por contacto y SOLO la
    -- primera vez: lo que trajo a alguien no cambia porque vuelva por otro lado. Ver crm/origen.ts.
    CREATE TABLE IF NOT EXISTS origen (
      user_id TEXT PRIMARY KEY,
      fuente TEXT NOT NULL DEFAULT '',
      medio TEXT NOT NULL DEFAULT '',
      campana TEXT NOT NULL DEFAULT '',
      contenido TEXT NOT NULL DEFAULT '',
      termino TEXT NOT NULL DEFAULT '',
      anuncio TEXT NOT NULL DEFAULT '',
      clic TEXT NOT NULL DEFAULT '',
      titular TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      referente TEXT NOT NULL DEFAULT '',
      ts INTEGER NOT NULL
    );
    -- Lo que el CRM quiere mandar por WhatsApp cuando quien tiene la sesión es un conector en otra máquina. El
    -- conector no es alcanzable desde aquí (vive detrás de un router de casa), así que no se le empuja: viene él
    -- a recoger. Se guarda en la base y no en memoria para que un reinicio no se trague una respuesta.
    CREATE TABLE IF NOT EXISTS wa_salida (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      texto TEXT NOT NULL,
      ts INTEGER NOT NULL,
      entregado_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_wa_salida_pend ON wa_salida(entregado_at, id);
    -- Mensajes que ya entraron por un canal que los puede repetir (Meta reenvía la misma notificación). Solo el id:
    -- ni contenido ni a quién. Se borran solos a los 7 días. Ver crm/entrantes.ts.
    CREATE TABLE IF NOT EXISTS entrantes (
      canal TEXT NOT NULL,
      id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      PRIMARY KEY (canal, id)
    );
    CREATE INDEX IF NOT EXISTS entrantes_ts ON entrantes(ts);
    -- Decisiones tomadas desde el tablero (p. ej. qué canales están encendidos); los secretos siguen en .env.
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  migrate(db);
  loadVectors();
  return db;
}

/** Columnas añadidas después de la primera versión (SQLite no tiene ADD COLUMN IF NOT EXISTS). */
function migrate(d: DatabaseSync) {
  const cols = (table: string) => new Set((d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((r) => r.name));
  const users = cols('users');
  const addUser = (name: string, ddl: string) => {
    if (!users.has(name)) d.exec(`ALTER TABLE users ADD COLUMN ${name} ${ddl}`);
  };
  addUser('phone', 'TEXT');
  addUser('stage', "TEXT NOT NULL DEFAULT 'nuevo'");
  addUser('stage_locked', 'INTEGER NOT NULL DEFAULT 0');
  addUser('score', 'INTEGER NOT NULL DEFAULT 0');
  addUser('score_factors', "TEXT NOT NULL DEFAULT '[]'");
  addUser('sentiment', 'TEXT');
  addUser('human_mode', 'INTEGER NOT NULL DEFAULT 0');
  addUser('data', "TEXT NOT NULL DEFAULT '{}'");
  addUser('tags', "TEXT NOT NULL DEFAULT '[]'");
  addUser('notes', "TEXT NOT NULL DEFAULT ''");
  addUser('summary', 'TEXT');
  addUser('unread', 'INTEGER NOT NULL DEFAULT 0');
  addUser('last_message_at', 'INTEGER');
  addUser('human_by', 'TEXT');
  // Quiénes están metidos en la conversación ahora mismo (varias personas a la vez). Caduca sola: ver crm/presencia.ts.
  addUser('presentes', "TEXT NOT NULL DEFAULT '[]'");
  addUser('human_since', 'INTEGER');
  addUser('archived', 'INTEGER NOT NULL DEFAULT 0'); // conversaciones guardadas: no salen en las listas
  // El número normalizado (con indicativo). Buscar "la misma persona" por aquí es una consulta indexada; antes
  // había que recorrer todos los contactos en cada mensaje.
  addUser('number', 'TEXT');
  d.exec('CREATE INDEX IF NOT EXISTS users_number ON users(number)');
  const appts = cols('appointments');
  // Recordatorio del día antes: estado (enviado, a_mano, no_hace_falta), cuándo, por qué, y qué respondió el cliente.
  // La sede de la cita, si el negocio tiene sedes (crm/sedes.ts).
  for (const [name, ddl] of [['reminder_status', 'TEXT'], ['reminder_at', 'INTEGER'], ['reminder_note', 'TEXT'], ['customer_reply', 'TEXT'], ['sede', 'TEXT']] as const)
    if (!appts.has(name)) d.exec(`ALTER TABLE appointments ADD COLUMN ${name} ${ddl}`);
  const messages = cols('messages');
  if (!messages.has('author')) d.exec("ALTER TABLE messages ADD COLUMN author TEXT NOT NULL DEFAULT 'bot'");
  if (!messages.has('by')) d.exec('ALTER TABLE messages ADD COLUMN by TEXT');
  // El archivo que acompaña a un mensaje (una foto, un PDF). Aquí solo va a cuál apunta —identificador, tipo,
  // nombre y tamaño—; el archivo vive en la carpeta del cliente. Ver crm/medios.ts.
  if (!messages.has('media')) d.exec('ALTER TABLE messages ADD COLUMN media TEXT');
  // Los segundos de audio de una transcripción. Va aparte de los tokens porque se cobra por minuto: meterlo en
  // la columna de tokens daría una cifra falsa justo en el informe que se mira para decidir qué dejar encendido.
  if (!cols('llm_usage').has('segundos')) d.exec('ALTER TABLE llm_usage ADD COLUMN segundos INTEGER NOT NULL DEFAULT 0');
}

function loadVectors() {
  const rows = getDb().prepare('SELECT id, embedding FROM docs').all() as { id: string; embedding: Uint8Array }[];
  vectors = rows.map((r) => ({ id: r.id, vec: toFloat32(r.embedding) }));
}

function toFloat32(blob: Uint8Array): Float32Array {
  return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
}

function normalize(v: number[]): Float32Array {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return Float32Array.from(v, (x) => x / n);
}

// ---------- Escritura ----------

/** Agrega o actualiza un solo documento (p. ej. una respuesta del equipo) sin reconstruir el índice. */
export function upsertDoc(doc: Doc & { embedding: number[] }) {
  const d = getDb();
  const vec = normalize(doc.embedding);
  d.exec('BEGIN');
  try {
    d.prepare('DELETE FROM docs_fts WHERE id = ?').run(doc.id);
    d.prepare('INSERT OR REPLACE INTO docs (id, kind, title, content, url, meta, embedding, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      doc.id,
      doc.kind,
      doc.title,
      doc.content,
      doc.url,
      JSON.stringify(doc.meta),
      new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength),
      Date.now(),
    );
    d.prepare('INSERT INTO docs_fts (id, title, content) VALUES (?, ?, ?)').run(doc.id, doc.title, doc.content);
    d.exec('COMMIT');
  } catch (err) {
    d.exec('ROLLBACK');
    throw err;
  }
  loadVectors();
}

export function replaceDocs(kind: DocKind, docs: (Doc & { embedding: number[] })[], sourceTag?: string) {
  const d = getDb();
  const now = Date.now();
  const insert = d.prepare(
    'INSERT OR REPLACE INTO docs (id, kind, title, content, url, meta, embedding, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const insertFts = d.prepare('INSERT INTO docs_fts (id, title, content) VALUES (?, ?, ?)');
  d.exec('BEGIN');
  try {
    // Reconstrucción por tipo (o por fuente dentro del tipo) para que lo borrado desaparezca.
    if (sourceTag) {
      const ids = (
        d.prepare("SELECT id FROM docs WHERE kind = ? AND json_extract(meta, '$.source') = ?").all(kind, sourceTag) as {
          id: string;
        }[]
      ).map((r) => r.id);
      const del = d.prepare('DELETE FROM docs WHERE id = ?');
      const delFts = d.prepare('DELETE FROM docs_fts WHERE id = ?');
      for (const id of ids) {
        del.run(id);
        delFts.run(id);
      }
    } else {
      d.prepare('DELETE FROM docs_fts WHERE id IN (SELECT id FROM docs WHERE kind = ?)').run(kind);
      d.prepare('DELETE FROM docs WHERE kind = ?').run(kind);
    }
    for (const doc of docs) {
      const vec = normalize(doc.embedding);
      insert.run(
        doc.id,
        doc.kind,
        doc.title,
        doc.content,
        doc.url,
        JSON.stringify(doc.meta),
        new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength),
        now,
      );
      insertFts.run(doc.id, doc.title, doc.content);
    }
    d.exec('COMMIT');
  } catch (err) {
    d.exec('ROLLBACK');
    throw err;
  }
  loadVectors();
}

let titleCache: { id: string; title: string; keys: string[] }[] | undefined;
const fold = (t: string) =>
  t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Ids de los productos cuyo nombre aparece en un texto (p. ej. la última respuesta del asistente). */
export function productsMentionedIn(text: string): string[] {
  if (!titleCache) {
    const rows = getDb().prepare("SELECT id, title FROM docs WHERE kind = 'product'").all() as { id: string; title: string }[];
    titleCache = rows.map((r) => {
      const words = fold(r.title).split(' ').filter((w) => w.length >= 3 && !['de', 'con', 'para', 'los', 'las'].includes(w));
      const keys = new Set<string>([fold(r.title)]);
      if (words.length >= 2) keys.add(words.slice(0, 2).join(' '));
      if (words[0] && words[0].length >= 6) keys.add(words[0]);
      return { id: r.id, title: r.title, keys: [...keys] };
    });
  }
  const t = ' ' + fold(text) + ' ';
  return titleCache.filter((p) => p.keys.some((k) => t.includes(' ' + k + ' ') || t.includes(' ' + k))).map((p) => p.id);
}

export function countDocs(): Record<string, number> {
  const rows = getDb().prepare('SELECT kind, COUNT(*) n FROM docs GROUP BY kind').all() as { kind: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.kind, r.n]));
}

// ---------- Lectura ----------

function rowToDoc(r: Record<string, unknown>): Doc {
  return {
    id: r.id as string,
    kind: r.kind as DocKind,
    title: r.title as string,
    content: r.content as string,
    url: (r.url as string | null) ?? null,
    meta: JSON.parse((r.meta as string) || '{}'),
  };
}

/** Todos los documentos de estos tipos, siempre en el mismo orden (el prompt que se arma con ellos debe ser idéntico). */
export function allDocs(kinds: DocKind[]): Doc[] {
  const placeholders = kinds.map(() => '?').join(',');
  return (getDb().prepare(`SELECT id, kind, title, content, url, meta FROM docs WHERE kind IN (${placeholders}) ORDER BY kind, id`).all(...kinds) as Record<string, unknown>[]).map(rowToDoc);
}

export function getDocs(ids: string[]): Map<string, Doc> {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const rows = getDb()
    .prepare(`SELECT id, kind, title, content, url, meta FROM docs WHERE id IN (${placeholders})`)
    .all(...ids) as Record<string, unknown>[];
  return new Map(rows.map((r) => [r.id as string, rowToDoc(r)]));
}

export function vectorSearch(queryEmbedding: number[], k: number, kinds?: DocKind[]): { id: string; sim: number }[] {
  const q = normalize(queryEmbedding);
  const allowed = kindIndex(paraBuscar(kinds));
  const hits: { id: string; sim: number }[] = [];
  for (const { id, vec } of vectors) {
    if (!vec.length) continue; // guardado sin vector (el motor no contestó): se encuentra por texto, no por parecido
    if (!allowed.has(id)) continue;
    let dot = 0;
    for (let i = 0; i < vec.length; i++) dot += vec[i]! * q[i]!;
    hits.push({ id, sim: dot });
  }
  hits.sort((a, b) => b.sim - a.sim);
  return hits.slice(0, k);
}

let kindCache: { key: string; ids: Set<string> } | undefined;
function kindIndex(kinds: DocKind[]): Set<string> {
  const key = kinds.sort().join('|') + ':' + vectors.length;
  if (kindCache?.key === key) return kindCache.ids;
  const placeholders = kinds.map(() => '?').join(',');
  const rows = getDb().prepare(`SELECT id FROM docs WHERE kind IN (${placeholders})`).all(...kinds) as { id: string }[];
  kindCache = { key, ids: new Set(rows.map((r) => r.id)) };
  return kindCache.ids;
}

/**
 * Convierte texto libre en una consulta FTS5 segura: "cafetera" OR "italiana".
 * Las palabras largas se buscan por prefijo sin la terminación de plural ("macetas" -> "macet"*),
 * porque el tokenizador unicode61 no hace stemming en español.
 */
export function toFtsQuery(text: string): string | null {
  const tokens = text
    .toLowerCase()
    .match(/[\p{L}\p{N}]{2,}/gu)
    ?.filter((t) => !STOPWORDS.has(t));
  if (!tokens || tokens.length === 0) return null;
  return [...new Set(tokens)]
    .map((t) => {
      if (t.length < 5) return `"${t}"`;
      const stem = t.endsWith('es') && t.length - 2 >= 4 ? t.slice(0, -2) : t.endsWith('s') ? t.slice(0, -1) : t;
      return `"${stem}"*`;
    })
    .join(' OR ');
}

export function ftsSearch(text: string, k: number, kinds?: DocKind[]): string[] {
  const q = toFtsQuery(text);
  if (!q) return [];
  const tipos = paraBuscar(kinds);
  const kindFilter = `AND d.kind IN (${tipos.map(() => '?').join(',')})`;
  try {
    const rows = getDb()
      .prepare(
        `SELECT f.id FROM docs_fts f JOIN docs d ON d.id = f.id
         WHERE docs_fts MATCH ? ${kindFilter}
         ORDER BY bm25(docs_fts, 2.0, 1.0) LIMIT ?`,
      )
      .all(q, ...tipos, k) as { id: string }[];
    return rows.map((r) => r.id);
  } catch {
    return [];
  }
}

const STOPWORDS = new Set(
  'de la el los las un una unos unas y o a en que es por para con del al se su sus lo le les me mi te tu como más mas pero si no hay tiene tienen quiero busco hola gracias ya muy este esta esto ese esa eso'.split(
    ' ',
  ),
);
