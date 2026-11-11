// Quién es quién en cada grupo.
//
// En una conversación uno a uno el contacto ES la persona. En un grupo no: hay diez, entran y salen, y la
// pregunta de hoy la hace alguien que lleva un mes ahí o alguien que acaba de llegar. Sin saber eso, XENCRM
// redacta igual para todos y quien atiende no sabe a quién le está contestando.
//
// 🪤 Esto NO es un contacto del CRM y no debe serlo. Quien escribe en un grupo no le escribió al negocio: no
// tiene etapa, ni puntaje, ni cita, y meterlo en las listas llenaría el embudo de gente que nunca pidió nada.
// Es una ficha de grupo: sirve para entender la conversación y para nada más.
//
// Lo que se guarda es lo barato y lo que de verdad ayuda: cómo se llama, cuánto habla y desde cuándo. Quien
// más escribe suele ser el que organiza; quien llegó ayer todavía no sabe lo que ya se dijo. Con eso y el hilo,
// XENCRM contesta a la persona y no al mensaje.
import { getDb } from '../rag/store.js';

export interface GenteDeGrupo {
  persona: string;
  nombre: string;
  mensajes: number;
  primera: number;
  ultima: number;
}

let lista = false;
function tabla() {
  const db = getDb();
  if (!lista) {
    db.exec(`
      -- Quién escribe en cada grupo. No son contactos del CRM: ver crm/grupo-gente.ts.
      CREATE TABLE IF NOT EXISTS grupo_gente (
        grupo TEXT NOT NULL,
        persona TEXT NOT NULL,
        nombre TEXT NOT NULL DEFAULT '',
        mensajes INTEGER NOT NULL DEFAULT 0,
        primera INTEGER NOT NULL,
        ultima INTEGER NOT NULL,
        PRIMARY KEY (grupo, persona)
      );
    `);
    lista = true;
  }
  return db;
}

/**
 * Anota que esta persona habló en este grupo.
 *
 * 🪤 El nombre solo se actualiza si viene uno: WhatsApp no siempre manda el pushName, y machacar «Marcela» con
 * una cadena vacía dejaría la ficha con un número y sin forma de recuperar el nombre hasta que esa persona
 * vuelva a escribir desde un teléfono que sí lo mande.
 */
export function anotarParticipante(grupo: string, persona: string, nombre: string, ts = Date.now()): void {
  if (!grupo || !persona) return;
  tabla()
    .prepare(
      `INSERT INTO grupo_gente (grupo, persona, nombre, mensajes, primera, ultima) VALUES (?, ?, ?, 1, ?, ?)
       ON CONFLICT(grupo, persona) DO UPDATE SET
         mensajes = grupo_gente.mensajes + 1,
         ultima = excluded.ultima,
         nombre = CASE WHEN excluded.nombre <> '' THEN excluded.nombre ELSE grupo_gente.nombre END`,
    )
    .run(grupo, persona, nombre ?? '', ts, ts);
}

/** La gente de un grupo, de quien más habla a quien menos. */
export function genteDelGrupo(grupo: string, tope = 12): GenteDeGrupo[] {
  return tabla()
    .prepare('SELECT persona, nombre, mensajes, primera, ultima FROM grupo_gente WHERE grupo = ? ORDER BY mensajes DESC LIMIT ?')
    .all(grupo, tope) as unknown as GenteDeGrupo[];
}

/** En una línea por persona, para dárselo al modelo sin gastar medio contexto. */
export function quienEsQuien(grupo: string, ahora = Date.now()): string {
  const dias = (ts: number) => Math.max(0, Math.round((ahora - ts) / 86400_000));
  return genteDelGrupo(grupo)
    .map((g) => {
      const desde = dias(g.primera);
      const cuanto = g.mensajes === 1 ? 'ha escrito una vez' : `ha escrito ${g.mensajes} veces`;
      return `- ${g.nombre || g.persona.split('@')[0]}: ${cuanto}${desde > 0 ? `, desde hace ${desde} día${desde === 1 ? '' : 's'}` : ', llegó hoy'}`;
    })
    .join('\n');
}
