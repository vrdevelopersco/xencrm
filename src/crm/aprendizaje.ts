// Llevarse lo aprendido a otra parte.
//
// Un negocio que lleva meses atendiendo con aiva ha ido dejando algo que no está en su configuración ni en su
// catálogo: **cómo atiende**. Las preguntas que le hacen de verdad, las palabras con las que contesta, los temas
// que alguien ya decidió que sí o que no. Eso no se puede volver a escribir a mano, y hasta ahora se quedaba
// atrás cada vez que la instancia se movía de sitio.
//
// Con esto se lleva. Y como el respaldo de configuración ya existe (`crm/respaldo.ts`), los dos juntos hacen que
// un cliente sea de verdad portátil: su forma de trabajar y su forma de atender.
//
// Dos decisiones que importan más de lo que parecen:
//
//  1. 🪤 **Se puede llevar sin las conversaciones.** El material en bruto son charlas reales de clientes finales,
//     con sus nombres y lo que contaron. Mover eso de servidor es mover datos de personas, y a veces lo único
//     que hace falta es lo aprendido: los temas y las decisiones. Por eso se puede exportar de las dos formas, y
//     la que no lleva conversaciones lo dice en el propio archivo.
//  2. 🪤 **Lo de un cliente no entra en otro.** Cada negocio atiende como atiende; mezclar el aprendizaje de una
//     boutique con el de una financiera no da un asistente mejor, da uno que suena a nadie. Al restaurar se
//     avisa si viene de otro cliente y hace falta decir que sí a propósito.
import { getDb } from '../rag/store.js';
import { guardarImportados, type MensajeImportado } from './historial.js';

export const VERSION_APRENDIZAJE = 1;

export interface Aprendizaje {
  version: number;
  /** De qué cliente salió y cuándo, para saber qué se está restaurando. */
  slug: string;
  negocio: string;
  fecha: string;
  /** Si lleva las conversaciones en bruto o solo lo decidido. */
  conConversaciones: boolean;
  conversaciones: MensajeImportado[];
  /** Los temas que alguien ya miró: aceptados y descartados. Es trabajo de una persona, y es lo que más cuesta. */
  temas: { clave: string; estado: string; titulo: string; ts: number }[];
}

/** Se lleva lo aprendido. Sin conversaciones va solo lo decidido, que no lleva datos de nadie. */
export function exportarAprendizaje(opts: { slug: string; negocio: string; conConversaciones?: boolean; hoy?: Date }): Aprendizaje {
  const db = getDb();
  const conConversaciones = opts.conConversaciones !== false;
  return {
    version: VERSION_APRENDIZAJE,
    slug: opts.slug,
    negocio: opts.negocio,
    fecha: (opts.hoy ?? new Date()).toISOString(),
    conConversaciones,
    conversaciones: conConversaciones
      ? (db.prepare('SELECT chat, autor, role, content, ts FROM import_messages ORDER BY ts').all() as unknown as MensajeImportado[])
      : [],
    temas: db.prepare('SELECT clave, estado, titulo, ts FROM import_temas').all() as unknown as Aprendizaje['temas'],
  };
}

/** Lo que se comprueba antes de dejar restaurar. Devuelve el problema, o qué se va a meter. */
export function revisarAprendizaje(
  crudo: unknown,
  slugDestino: string,
): { error: string } | { aprendizaje: Aprendizaje; otroCliente: boolean; conversaciones: number; temas: number } {
  if (!crudo || typeof crudo !== 'object') return { error: 'eso no es un archivo de aprendizaje de aiva' };
  const a = crudo as Partial<Aprendizaje>;
  if (a.version !== VERSION_APRENDIZAJE) return { error: `el archivo es de otra versión (${String(a.version)}), y no se puede leer` };
  if (!a.slug) return { error: 'el archivo no dice de qué cliente salió' };
  if (!Array.isArray(a.conversaciones) || !Array.isArray(a.temas)) return { error: 'al archivo le falta lo aprendido' };
  return {
    aprendizaje: a as Aprendizaje,
    otroCliente: a.slug !== slugDestino,
    conversaciones: a.conversaciones.length,
    temas: a.temas.length,
  };
}

/**
 * Mete lo aprendido en esta instancia. **Suma, no reemplaza**: lo que ya hubiera aquí se queda, y lo repetido no
 * se duplica (`guardarImportados` ya lo evita por chat, fecha y texto). Restaurar dos veces el mismo archivo deja
 * lo mismo que restaurarlo una.
 */
export function restaurarAprendizaje(a: Aprendizaje): { conversaciones: number; temas: number } {
  const db = getDb();
  const conversaciones = a.conversaciones.length ? guardarImportados(a.conversaciones, 'traído') : 0;
  const poner = db.prepare(
    `INSERT INTO import_temas (clave, estado, titulo, ts) VALUES (?, ?, ?, ?)
     ON CONFLICT(clave) DO UPDATE SET estado = excluded.estado, titulo = excluded.titulo, ts = excluded.ts
     WHERE excluded.ts > import_temas.ts`,
  );
  let temas = 0;
  for (const t of a.temas) {
    if (!t?.clave || !t.estado) continue;
    poner.run(t.clave, t.estado, t.titulo ?? '', Number(t.ts) || Date.now());
    temas++;
  }
  return { conversaciones, temas };
}
