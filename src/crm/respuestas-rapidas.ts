// Respuestas rápidas: lo que se pregunta mucho, contestado una vez y bien.
//
// Un negocio contesta lo mismo todo el día —«¿cuándo me desembolsan?», «¿por qué me bloquearon?»— y cada vez que
// lo contesta alguien de nuevo, tarda. Aquí se escribe una vez, la aprueba quien sabe, y a partir de ahí sale
// sola: como sugerencia lista para enviar si el canal está en «Propone», o enviada directamente si está en
// «Contesta». No hay interruptor nuevo; manda el modo del canal, que es el que ya existe.
//
// 🪤 El tema y la respuesta son DOS COSAS SEPARADAS y vienen de sitios distintos. El tema («de qué preguntan»)
// se puede sacar del historial, que es un hecho observable. La respuesta («qué se contesta») NO: eso es una
// política del negocio, cambia, y deducirla de lo que alguien contestó una vez es la forma de dejar escrito en
// piedra un plazo que ya no se cumple. Por eso un tema nace en `borrador`, sin respuesta, y no se usa para nada
// hasta que una persona la escribe y la marca lista. Ver docs/aprender-del-historial.md.
import { regla } from '../reglas.js';
import { embed } from '../llm/embeddings.js';
import { getDb } from '../rag/store.js';

export type EstadoRespuesta = 'borrador' | 'lista';

export interface RespuestaRapida {
  id: number;
  /** De qué trata, en palabras del negocio: «Plazo de desembolso». */
  tema: string;
  /** Cómo lo pregunta la gente, en SUS palabras. De aquí sale el reconocimiento. */
  ejemplos: string[];
  /** Lo que se contesta. Vacío mientras sea borrador. */
  respuesta: string;
  estado: EstadoRespuesta;
  /** De dónde salió el tema: «del historial», «a mano». Para saber qué hay que revisar. */
  origen: string;
  veces: number;
  creada: number;
  actualizada: number;
}

/**
 * Qué tan parecido tiene que ser para darla por buena.
 *
 * 🪤 Alto a propósito. Lo que está en juego cuando se pasa es mandarle a un cliente una respuesta sobre un tema
 * que no preguntó, con la seguridad de una respuesta aprobada; y en «Contesta» eso sale sin que nadie lo mire.
 * Es mucho mejor no reconocer una pregunta —entonces contesta el modelo, como siempre— que reconocerla mal.
 */
// 82 % de fábrica: manda la regla rapidas.parecidoPct (Configuración › Reglas y umbrales).

/** Más largo que esto no es una pregunta de las de siempre: es un caso, y los casos no se contestan con plantilla. */
// 320 letras de fábrica: manda la regla rapidas.largoMaximo.

let lista = false;
function tabla() {
  const db = getDb();
  if (!lista) {
    db.exec(`
      -- Lo que se pregunta mucho y su respuesta aprobada. Ver crm/respuestas-rapidas.ts.
      CREATE TABLE IF NOT EXISTS respuestas_rapidas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tema TEXT NOT NULL,
        respuesta TEXT NOT NULL DEFAULT '',
        estado TEXT NOT NULL DEFAULT 'borrador',
        origen TEXT NOT NULL DEFAULT '',
        veces INTEGER NOT NULL DEFAULT 0,
        creada INTEGER NOT NULL,
        actualizada INTEGER NOT NULL
      );
      -- 🪤 Cada forma de preguntar, con SU vector, en vez de un vector promedio por tema. El promedio de
      -- «¿cuándo me desembolsan?» y «no me ha llegado la plata» cae en medio de las dos y no se parece a
      -- ninguna: se reconocerían peor las dos preguntas que si hubiera una sola. Se compara contra todas y
      -- manda la que más se parezca.
      CREATE TABLE IF NOT EXISTS respuestas_ejemplos (
        respuesta_id INTEGER NOT NULL,
        texto TEXT NOT NULL,
        vector BLOB NOT NULL,
        PRIMARY KEY (respuesta_id, texto)
      );
      CREATE INDEX IF NOT EXISTS respuestas_estado ON respuestas_rapidas(estado);
    `);
    lista = true;
  }
  return db;
}

const aBlob = (v: number[]): Uint8Array => new Uint8Array(new Float32Array(v).buffer);
const deBlob = (b: Uint8Array): Float32Array => new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);

/** Los vectores vienen ya normalizados, así que el coseno es el producto punto y nada más. */
function parecido(a: number[], b: Float32Array): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i]! * b[i]!;
  return s;
}

function normalizar(v: number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n);
  return n > 0 ? v.map((x) => x / n) : v;
}

function filaA(r: Record<string, unknown>, ejemplos: string[]): RespuestaRapida {
  return {
    id: Number(r.id),
    tema: String(r.tema ?? ''),
    ejemplos,
    respuesta: String(r.respuesta ?? ''),
    estado: r.estado === 'lista' ? 'lista' : 'borrador',
    origen: String(r.origen ?? ''),
    veces: Number(r.veces ?? 0),
    creada: Number(r.creada ?? 0),
    actualizada: Number(r.actualizada ?? 0),
  };
}

function ejemplosDe(id: number): string[] {
  return (tabla().prepare('SELECT texto FROM respuestas_ejemplos WHERE respuesta_id = ? ORDER BY rowid').all(id) as { texto: string }[]).map((x) => x.texto);
}

/** Todas, para el tablero. */
export function respuestasRapidas(): RespuestaRapida[] {
  const filas = tabla().prepare('SELECT * FROM respuestas_rapidas ORDER BY estado, veces DESC, tema').all() as Record<string, unknown>[];
  return filas.map((f) => filaA(f, ejemplosDe(Number(f.id))));
}

export function respuestaRapida(id: number): RespuestaRapida | null {
  const f = tabla().prepare('SELECT * FROM respuestas_rapidas WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return f ? filaA(f, ejemplosDe(id)) : null;
}

/** Cuántas hay listas. Si no hay ninguna, el atajo ni se intenta y no cuesta nada. */
export function cuantasListas(): number {
  return (tabla().prepare("SELECT count(*) n FROM respuestas_rapidas WHERE estado = 'lista' AND respuesta <> ''").get() as { n: number }).n;
}

export interface GuardarRespuesta {
  id?: number;
  tema: string;
  ejemplos: string[];
  respuesta?: string;
  estado?: EstadoRespuesta;
  origen?: string;
}

/**
 * Crea o corrige una respuesta rápida.
 *
 * 🪤 Sin respuesta escrita NO se puede marcar lista, se pida como se pida. Una respuesta rápida «lista» y vacía
 * le mandaría a un cliente un mensaje en blanco con toda la confianza del mundo, y en «Contesta» eso sale sin
 * que nadie lo vea.
 */
export async function guardarRespuestaRapida(e: GuardarRespuesta): Promise<RespuestaRapida> {
  const tema = e.tema.trim();
  if (!tema) throw new Error('ponle un tema');
  const ejemplos = [...new Set(e.ejemplos.map((x) => x.trim()).filter(Boolean))].slice(0, 12);
  if (!ejemplos.length) throw new Error('hace falta al menos una forma de preguntarlo');
  const respuesta = (e.respuesta ?? '').trim();
  const estado: EstadoRespuesta = e.estado === 'lista' ? 'lista' : 'borrador';
  if (estado === 'lista' && !respuesta) throw new Error('no puedo darla por lista sin la respuesta escrita');

  const db = tabla();
  const ahora = Date.now();
  let id = e.id ?? 0;
  if (id) {
    db.prepare('UPDATE respuestas_rapidas SET tema = ?, respuesta = ?, estado = ?, actualizada = ? WHERE id = ?').run(tema, respuesta, estado, ahora, id);
  } else {
    const r = db
      .prepare('INSERT INTO respuestas_rapidas (tema, respuesta, estado, origen, creada, actualizada) VALUES (?, ?, ?, ?, ?, ?)')
      .run(tema, respuesta, estado, (e.origen ?? 'a mano').slice(0, 60), ahora, ahora);
    id = Number(r.lastInsertRowid);
  }

  // Los ejemplos se rehacen enteros: son pocos y así no hay que llevar la cuenta de cuál se quitó.
  const antes = new Map(
    (db.prepare('SELECT texto, vector FROM respuestas_ejemplos WHERE respuesta_id = ?').all(id) as { texto: string; vector: Uint8Array }[]).map((x) => [x.texto, x.vector]),
  );
  // Solo se piden los vectores de los ejemplos NUEVOS: corregir el texto de una respuesta no tiene por qué
  // volver a pagar los vectores de unas frases que no se han tocado.
  const faltan = ejemplos.filter((t) => !antes.has(t));
  const nuevos = faltan.length ? await embed(faltan) : [];
  db.prepare('DELETE FROM respuestas_ejemplos WHERE respuesta_id = ?').run(id);
  const meter = db.prepare('INSERT INTO respuestas_ejemplos (respuesta_id, texto, vector) VALUES (?, ?, ?)');
  for (const texto of ejemplos) {
    const viejo = antes.get(texto);
    const vector = viejo ?? aBlob(normalizar(nuevos[faltan.indexOf(texto)] ?? []));
    meter.run(id, texto, vector);
  }
  return respuestaRapida(id)!;
}

export function borrarRespuestaRapida(id: number): boolean {
  const db = tabla();
  db.prepare('DELETE FROM respuestas_ejemplos WHERE respuesta_id = ?').run(id);
  return db.prepare('DELETE FROM respuestas_rapidas WHERE id = ?').run(id).changes > 0;
}

export interface Acierto {
  respuesta: RespuestaRapida;
  /** Cuánto se parecía, para poder calibrar el umbral con datos y no a ojo. */
  parecido: number;
  /** Con cuál de las formas de preguntar casó: es lo que se le enseña a quien revisa. */
  comoLoPreguntan: string;
}

/**
 * ¿Esto que acaba de llegar es una de las de siempre?
 *
 * Devuelve null cuando no lo sabe, que es casi siempre y está bien: entonces contesta el modelo, como hasta
 * ahora. Esto no sustituye a nadie, se adelanta a lo evidente.
 *
 * 🪤 Si el negocio no tiene ninguna respuesta lista, se sale ANTES de pedir el vector. Sin eso, cada mensaje de
 * cada cliente que no usa esta función pagaría una llamada de embeddings para no encontrar nada.
 */
export async function buscarRespuestaRapida(texto: string): Promise<Acierto | null> {
  const limpio = texto.trim();
  if (!limpio || limpio.length > regla<number>('rapidas.largoMaximo')) return null;
  if (!cuantasListas()) return null;

  const filas = tabla()
    .prepare(
      `SELECT r.id, e.texto, e.vector FROM respuestas_rapidas r
       JOIN respuestas_ejemplos e ON e.respuesta_id = r.id
       WHERE r.estado = 'lista' AND r.respuesta <> ''`,
    )
    .all() as { id: number; texto: string; vector: Uint8Array }[];
  if (!filas.length) return null;

  let vec: number[];
  try {
    const [v] = await embed([limpio]);
    if (!v) return null;
    vec = normalizar(v);
  } catch {
    // Sin embeddings no hay atajo, y ya está: la conversación sigue por el camino normal. Esto no puede ser el
    // motivo de que un cliente se quede sin respuesta.
    return null;
  }

  let mejor: { id: number; texto: string; sim: number } | null = null;
  for (const f of filas) {
    const v = deBlob(f.vector);
    if (!v.length) continue;
    const sim = parecido(vec, v);
    if (!mejor || sim > mejor.sim) mejor = { id: f.id, texto: f.texto, sim };
  }
  if (!mejor || mejor.sim < regla<number>('rapidas.parecidoPct') / 100) return null;
  const r = respuestaRapida(mejor.id);
  return r ? { respuesta: r, parecido: mejor.sim, comoLoPreguntan: mejor.texto } : null;
}

/** Que se usó una vez: así se ve cuáles sirven de verdad y cuáles no las pregunta nadie. */
export function anotarUso(id: number): void {
  tabla().prepare('UPDATE respuestas_rapidas SET veces = veces + 1 WHERE id = ?').run(id);
}
