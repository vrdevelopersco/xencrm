// Quién está metido en una conversación **ahora mismo**. Varias personas a la vez, no una sola.
//
// Por qué hace falta: el modo humano ya deja que el equipo escriba, pero no dice quién más está adentro. Dos
// personas contestando lo mismo al mismo cliente es peor que no contestar, y ninguna de las dos se entera. Esto
// no reparte permisos ni bloquea a nadie: solo hace visible quién está, que es lo que evita el choque.
//
// Se guarda en la ficha del contacto (`presentes`), no en memoria: la consola y el tablero son procesos distintos
// —y hay uno por cliente—, así que lo que uno vea tiene que salir de la base.
//
// 🪤 La presencia **caduca sola**. Quien cierra la pestaña no avisa, así que si no se refresca, a los pocos
// minutos deja de aparecer. Sin eso, la lista se llenaría de gente que se fue hace horas.
import { regla } from '../reglas.js';
import { getDb } from '../rag/store.js';

/** Cuánto vale una presencia sin refrescar. Más corto molesta al que lee despacio; más largo deja fantasmas. */
export const DURACION_MS = 3 * 60_000; // el de fábrica: manda la regla presencia.minutos
const duracionMs = (): number => regla<number>('presencia.minutos') * 60_000;

export interface Presente {
  /** El nombre con el que firma, que es el que ve el cliente. */
  nombre: string;
  /** Hasta cuándo cuenta como presente si no refresca. */
  hasta: number;
  /** Última vez que dio señales: para decir "hace un momento" sin mentir. */
  visto: number;
}

const leer = (userId: string): Presente[] => {
  const fila = getDb().prepare('SELECT presentes FROM users WHERE id = ?').get(userId) as { presentes?: string } | undefined;
  if (!fila) return [];
  try {
    const lista = JSON.parse(fila.presentes || '[]') as Presente[];
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
};

const guardar = (userId: string, lista: Presente[]) => {
  getDb().prepare('UPDATE users SET presentes = ? WHERE id = ?').run(JSON.stringify(lista), userId);
};

/** Los que siguen adentro, sin los que ya caducaron. Ordenados por quién llegó primero. */
export function quienesEstan(userId: string, now = Date.now()): Presente[] {
  return leer(userId)
    .filter((p) => p.hasta > now)
    .sort((a, b) => a.visto - b.visto);
}

/**
 * Entrar o seguir adentro. Se llama al abrir la conversación y cada tanto mientras esté abierta.
 * Devuelve quiénes están, incluido uno mismo.
 */
export function entrar(userId: string, nombre: string, now = Date.now()): Presente[] {
  const quien = nombre.trim();
  if (!quien) return quienesEstan(userId, now);
  const otros = quienesEstan(userId, now).filter((p) => p.nombre !== quien);
  const lista = [...otros, { nombre: quien, hasta: now + duracionMs(), visto: now }].slice(-12);
  guardar(userId, lista);
  return lista.sort((a, b) => a.visto - b.visto);
}

/** Salir a propósito (cerrar el panel). Lo normal es que nadie avise y caduque solo. */
export function salir(userId: string, nombre: string, now = Date.now()): Presente[] {
  const lista = quienesEstan(userId, now).filter((p) => p.nombre !== nombre.trim());
  guardar(userId, lista);
  return lista;
}

/** Los otros: para avisar "Ana también está aquí" sin nombrarse a uno mismo. */
export const otrosQueEstan = (userId: string, yo: string, now = Date.now()): Presente[] =>
  quienesEstan(userId, now).filter((p) => p.nombre !== yo.trim());
