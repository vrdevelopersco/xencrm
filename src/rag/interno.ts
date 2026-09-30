// Lo que aiva sabe del negocio y NO le cuenta a nadie.
//
// El catálogo y la información del negocio (`product`, `knowledge`) existen para contestarle a un cliente. Esto
// es lo contrario: con qué proveedor trabajan, qué margen manejan, qué cliente da problemas, qué producto no
// quieren empujar, qué pasó la última vez que subieron los precios. Sirve para que aiva ayude al EQUIPO —a
// decidir, a revisar lo que se va a mandar, a avisar de que algo no cuadra— y no puede salir por una
// conversación.
//
// 🪤 La separación no es por tema, es por audiencia. Un mismo dato —«el proveedor se demora tres semanas»—
// puede ser interno o público según a quién se le diga. Por eso lo decide quien lo escribe, no un clasificador.
import { randomUUID } from 'node:crypto';
import { embed } from '../llm/embeddings.js';
import { getDb, upsertDoc, type Doc } from './store.js';

export interface NotaInterna {
  id: string;
  titulo: string;
  contenido: string;
  /** De dónde salió: escrita a mano, o deducida por aiva y confirmada por alguien. */
  origen: string;
  actualizado: number;
}

export function notasInternas(): NotaInterna[] {
  const filas = getDb()
    .prepare("SELECT id, title, content, meta, updated_at FROM docs WHERE kind = 'interno' ORDER BY updated_at DESC LIMIT 200")
    .all() as { id: string; title: string; content: string; meta: string | null; updated_at: number }[];
  return filas.map((f) => ({
    id: f.id,
    titulo: f.title,
    contenido: f.content,
    origen: (() => {
      try {
        return (JSON.parse(f.meta ?? '{}') as { origen?: string }).origen ?? 'a mano';
      } catch {
        return 'a mano';
      }
    })(),
    actualizado: f.updated_at,
  }));
}

/**
 * Guarda una nota interna.
 *
 * 🪤 Si el motor de embeddings no contesta, se guarda igual y sin vector. Perder la nota porque un servicio
 * está caído sería lo peor de los dos mundos: alguien se tomó el trabajo de escribir lo que sabe del negocio y
 * lo pierde por algo que no tiene nada que ver. Sin vector se encuentra por texto, que para una nota escrita a
 * mano —con las palabras del negocio— suele bastar.
 */
export async function guardarNotaInterna(nota: { id?: string; titulo: string; contenido: string; origen?: string }): Promise<NotaInterna> {
  const id = nota.id || `interno:${randomUUID()}`;
  const titulo = nota.titulo.trim() || 'Sin título';
  const contenido = nota.contenido.trim();
  let embedding: number[] = [];
  try {
    embedding = (await embed([`${titulo}\n${contenido}`]))[0] ?? [];
  } catch (err) {
    console.error('[interno] sin vector (se guarda igual):', (err as Error).message);
  }
  const doc: Doc & { embedding: number[] } = {
    id,
    kind: 'interno',
    title: titulo,
    content: contenido,
    url: null,
    meta: { origen: nota.origen ?? 'a mano' },
    embedding,
  };
  upsertDoc(doc);
  return { id, titulo, contenido, origen: nota.origen ?? 'a mano', actualizado: Date.now() };
}

export function borrarNotaInterna(id: string): boolean {
  const db = getDb();
  db.prepare('DELETE FROM docs_fts WHERE id = ?').run(id);
  return Number(db.prepare("DELETE FROM docs WHERE id = ? AND kind = 'interno'").run(id).changes) > 0;
}
