// El embudo: hasta dónde llegó cada trato y, si se perdió, desde qué etapa se cayó.
//
// La etapa de hoy dice dónde está una ficha, no por dónde pasó. Para saber cuántos de los que llegaron a
// «Interesado» siguieron hasta la cita hace falta la historia: cada cambio de etapa queda guardado como un evento
// `stage` con { from, to } (crm/contacts.ts, setStage). Aquí se lee esa historia una sola vez para todas las fichas
// —una consulta, no una por contacto— y se resume en tres datos por trato: la etapa más avanzada que alcanzó, desde
// cuál se cayó si se perdió, y cuándo se cerró. El tablero cuenta con eso; no hay modelo ni red de por medio.
//
// 🪤 Una ficha sin historia (importada, o de antes de que se guardaran los cambios) no se inventa: cuenta por la
// etapa en la que está, y si está perdida, `cayoDesde` queda en null. La pantalla dice cuántas son, en vez de
// repartirlas como si se supiera dónde se cayeron.
import { getDb } from '../rag/store.js';
import { listContacts, STAGE_DEFS, type Stage } from './contacts.js';

export interface EtapaDelEmbudo {
  id: string;
  label: string;
  rol: string;
}
export interface PasoDelTrato {
  id: string;
  /** La etapa más avanzada a la que llegó (nunca una de perdido). null: perdida sin historia. */
  alcanzo: Stage | null;
  /** Si está perdida: la etapa en la que estaba cuando se perdió. null: no se sabe (sin historia). */
  cayoDesde: Stage | null;
  /** ¿Tiene al menos un cambio de etapa guardado? */
  conHistoria: boolean;
  /** Cuándo entró (la primera vez que escribió). */
  entro: number;
  /** Cuándo se cerró (ganada o perdida), por el evento que la cerró. null si sigue abierta o no se sabe. */
  cerro: number | null;
}
export interface CambioDeEtapa {
  userId: string;
  ts: number;
  from: string;
  to: string;
}

/**
 * La cuenta, sin base de datos: así se prueba con casos escritos a mano (test:embudo).
 *
 * El orden del embudo es el de la configuración del negocio sin las etapas de perdido: cada negocio pone las suyas
 * y en ese orden avanza un trato. «Llegó a» es la más avanzada entre la de hoy y todas las que pasó.
 */
export function pasosDelEmbudo(opts: {
  etapas: EtapaDelEmbudo[];
  contactos: { id: string; stage: string; firstSeen: number }[];
  cambios: CambioDeEtapa[];
}): PasoDelTrato[] {
  const rolDeEtapa = new Map(opts.etapas.map((e) => [e.id, e.rol]));
  const orden = opts.etapas.filter((e) => e.rol !== 'perdido').map((e) => e.id);
  const pos = (s: string) => orden.indexOf(s);
  const esPerdido = (s: string) => rolDeEtapa.get(s) === 'perdido';
  const cierra = (s: string) => ['ganado', 'perdido'].includes(rolDeEtapa.get(s) ?? '');
  const porContacto = new Map<string, CambioDeEtapa[]>();
  for (const c of opts.cambios) {
    const l = porContacto.get(c.userId);
    if (l) l.push(c);
    else porContacto.set(c.userId, [c]);
  }
  return opts.contactos.map((x) => {
    const cambios = (porContacto.get(x.id) ?? []).slice().sort((a, b) => a.ts - b.ts);
    let max = -1;
    const mirar = (s: string) => {
      const p = pos(s);
      if (p > max) max = p;
    };
    for (const e of cambios) {
      mirar(e.from);
      mirar(e.to);
    }
    const perdida = esPerdido(x.stage);
    if (!perdida) mirar(x.stage);
    let cayoDesde: Stage | null = null;
    if (perdida) {
      // Desde dónde: la etapa de la que salió la última vez que entró a perdido. Si esa no está en el embudo de
      // hoy (una etapa que ya no existe), la más avanzada que alcanzó antes.
      const entrada = cambios.filter((e) => esPerdido(e.to)).pop();
      if (entrada && pos(entrada.from) >= 0) cayoDesde = entrada.from;
      else if (cambios.length && max >= 0) cayoDesde = orden[max] ?? null;
    }
    // Cuándo se cerró: el último evento que la llevó a una etapa que cierra y que es del mismo papel que la de hoy
    // (quien se ganó, se perdió y se recuperó cerró cuando se ganó por última vez).
    const rolHoy = rolDeEtapa.get(x.stage);
    const cierre = cierra(x.stage) ? cambios.filter((e) => rolDeEtapa.get(e.to) === rolHoy).pop() : undefined;
    return {
      id: x.id,
      alcanzo: max >= 0 ? (orden[max] ?? null) : null,
      cayoDesde,
      conHistoria: cambios.length > 0,
      entro: x.firstSeen,
      cerro: cierre ? cierre.ts : null,
    };
  });
}

/** Lo mismo, leído de la base: las fichas que no están archivadas (sin grupos) y todos sus cambios de etapa. */
export function historiaDelEmbudo(limit = 2000): { etapas: EtapaDelEmbudo[]; tratos: PasoDelTrato[] } {
  const etapas = STAGE_DEFS.map((s) => ({ id: s.id, label: s.label, rol: s.rol ?? '' }));
  const contactos = listContacts({ limit }).filter((x) => !x.archived);
  const cambios = (getDb().prepare("SELECT user_id, ts, payload FROM events WHERE type = 'stage' ORDER BY ts").all() as { user_id: string; ts: number; payload: string }[])
    .map((r) => {
      let p: Record<string, unknown> = {};
      try {
        p = JSON.parse(r.payload || '{}') as Record<string, unknown>;
      } catch {
        /* un evento roto no tumba el embudo: se ignora */
      }
      return { userId: r.user_id, ts: Number(r.ts), from: String(p.from ?? ''), to: String(p.to ?? '') };
    });
  return { etapas, tratos: pasosDelEmbudo({ etapas, contactos, cambios }) };
}
