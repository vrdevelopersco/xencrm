// De dónde salió cada conversación.
//
// Es la pregunta que paga la publicidad: «¿de este anuncio salió alguna venta?». Sin esto, un negocio sabe
// cuánto gastó y cuántas conversaciones tuvo, pero no cuáles vinieron de dónde — y termina renovando el anuncio
// que trae ruido y apagando el que trae clientes.
//
// De dónde sale el dato, según por dónde entre la gente:
//
//  - **Chat del sitio**: de la dirección de la página donde estaba (los `utm_…` que ponen las herramientas de
//    campañas) y de quién la mandó allí (el referente). Lo manda el widget con el primer mensaje.
//  - **WhatsApp por anuncio** (los de «enviar mensaje» de Meta): el propio aviso trae el anuncio, su titular y
//    la página desde la que pulsaron. Llega en el webhook, sin pedir nada.
//  - **WhatsApp por código QR**: no hay nada que capturar. Quien escribe al número directo no trae de dónde
//    viene, y aquí no se inventa: queda como directo.
//
// 🪤 **Se guarda el primero y no se pisa.** Si alguien llegó por un anuncio en marzo y en junio vuelve por una
// búsqueda, la conversación sigue siendo del anuncio: fue el que la trajo. Sobrescribir con lo último haría que
// toda la atribución terminara en «directo», que es donde acaba la gente que ya te conoce.
import { getDb } from '../rag/store.js';
import { STAGE_DEFS } from './contacts.js';

export interface Origen {
  /** De dónde: google, meta, instagram, un sitio que enlaza… */
  fuente: string;
  /** Cómo: cpc, orgánico, social, correo… */
  medio: string;
  campana: string;
  /** La pieza concreta: variante del anuncio, banner, enlace. */
  contenido: string;
  /** Lo que buscó, cuando la herramienta lo pasa. */
  termino: string;
  /** Identificador del anuncio, cuando viene de uno. Agrupa: varias personas llegan del mismo. */
  anuncio: string;
  /**
   * 🪤 El identificador del **clic** (gclid, fbclid, ctwa_clid). Es distinto para cada persona, así que NO
   * agrupa: usarlo para eso convertiría a cada cliente en su propia campaña y la tabla no serviría para decidir
   * nada. Se guarda porque es lo que hace falta para devolverle la venta a Google o a Meta más adelante.
   */
  clic: string;
  /** El titular que leyó antes de escribir: lo más útil para entender qué le prometieron. */
  titular: string;
  /** La página donde estaba. */
  url: string;
  /** Quién lo mandó a esa página. */
  referente: string;
}

const VACIO: Origen = { fuente: '', medio: '', campana: '', contenido: '', termino: '', anuncio: '', clic: '', titular: '', url: '', referente: '' };

const limpio = (v: unknown, max = 200): string =>
  String(v ?? '')
    .trim()
    .slice(0, max);

/** Lo que trae una dirección con parámetros de campaña. Devuelve null si no hay nada que anotar. */
export function deLaUrl(url: string, referente = ''): Origen | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const p = u.searchParams;
  const dato = (...nombres: string[]) => limpio(nombres.map((n) => p.get(n)).find(Boolean) ?? '');
  const o: Origen = {
    fuente: dato('utm_source'),
    medio: dato('utm_medium'),
    campana: dato('utm_campaign'),
    contenido: dato('utm_content'),
    termino: dato('utm_term'),
    anuncio: '',
    // Lo que ponen Google y Meta para identificar el clic. Por clic, no por anuncio: ver arriba.
    clic: dato('gclid', 'fbclid', 'ttclid', 'msclkid'),
    titular: '',
    url: limpio(`${u.origin}${u.pathname}`, 300),
    referente: limpio(referente, 300),
  };
  // Sin campaña ni anuncio, lo único que queda es quién lo mandó. Si tampoco hay, no hay nada que contar.
  if (!o.fuente && !o.campana && !o.clic && !o.referente) return null;
  if (!o.fuente && o.referente) {
    try {
      o.fuente = new URL(o.referente).hostname.replace(/^www\./, '');
      o.medio = o.medio || 'referencia';
    } catch {
      /* un referente que no es una dirección no dice nada */
    }
  }
  return o;
}

/** Lo que manda Meta cuando alguien llega desde un anuncio de «enviar mensaje». */
export function deMeta(referral: Record<string, unknown> | undefined | null): Origen | null {
  if (!referral) return null;
  const o: Origen = {
    ...VACIO,
    fuente: 'meta',
    medio: limpio(referral.source_type) === 'post' ? 'publicacion' : 'anuncio',
    anuncio: limpio(referral.source_id),
    clic: limpio(referral.ctwa_clid, 200),
    titular: limpio(referral.headline, 300),
    url: limpio(referral.source_url, 300),
    // 🪤 Aquí NO va el `ctwa_clid`: parece un identificador de campaña y es de **cada clic**, así que agrupar
    // por él convertiría a cada persona en su propia campaña y la tabla no diría nada. Lo que agrupa es el
    // anuncio (`source_id`); el titular es para reconocerlo de un vistazo.
  };
  return o.anuncio || o.url || o.titular ? o : null;
}

/**
 * Anota de dónde vino una conversación. 🪤 Solo la primera vez: lo que trajo a alguien no cambia porque vuelva.
 * Devuelve true si se anotó (o sea, si era la primera).
 */
export function anotarOrigen(userId: string, o: Origen | null, ahora = Date.now()): boolean {
  if (!o) return false;
  const r = getDb()
    .prepare(
      `INSERT INTO origen (user_id, fuente, medio, campana, contenido, termino, anuncio, clic, titular, url, referente, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO NOTHING`,
    )
    .run(userId, o.fuente, o.medio, o.campana, o.contenido, o.termino, o.anuncio, o.clic, o.titular, o.url, o.referente, ahora);
  return Number(r.changes) > 0;
}

export const origenDe = (userId: string): (Origen & { ts: number }) | null =>
  (getDb().prepare('SELECT * FROM origen WHERE user_id = ?').get(userId) as (Origen & { ts: number }) | undefined) ?? null;

export interface FilaCampana {
  fuente: string;
  medio: string;
  campana: string;
  /** El anuncio, cuando no hay nombre de campaña (Meta no lo manda). */
  anuncio: string;
  titular: string;
  conversaciones: number;
  /** Cuántas llegaron a pedir cita. */
  citas: number;
  /** Cuántas se ganaron. */
  ganadas: number;
  /** De las conversaciones, qué parte terminó en ganada. */
  conversion: number;
}

/**
 * El embudo por campaña: cuántas conversaciones trajo cada una y en qué terminaron. Las etapas se miran por su
 * **papel** (cita, ganado) y no por su nombre, porque cada negocio las llama a su manera.
 */
export function porCampana(opts: { desde?: number } = {}): { campanas: FilaCampana[]; sinOrigen: number } {
  const desde = opts.desde ?? 0;
  const conRol = (rol: string) => STAGE_DEFS.filter((e) => e.rol === rol).map((e) => e.id);
  const citas = conRol('cita');
  const ganadas = conRol('ganado');
  const db = getDb();
  const filas = db
    .prepare(
      `SELECT o.fuente, o.medio, o.campana, o.titular, o.anuncio, u.stage
         FROM origen o JOIN users u ON u.id = o.user_id
        WHERE o.ts >= ?`,
    )
    .all(desde) as { fuente: string; medio: string; campana: string; titular: string; anuncio: string; stage: string }[];

  const por = new Map<string, FilaCampana>();
  for (const f of filas) {
    // Se agrupa también por anuncio: en Meta no hay nombre de campaña, y sin esto todos los anuncios de un
    // cliente caerían en la misma fila y no se sabría cuál trae gente.
    const llave = `${f.fuente}|${f.medio}|${f.campana}|${f.anuncio}`;
    const fila = por.get(llave) ?? {
      fuente: f.fuente || 'directo',
      medio: f.medio,
      campana: f.campana,
      anuncio: f.anuncio,
      titular: f.titular,
      conversaciones: 0,
      citas: 0,
      ganadas: 0,
      conversion: 0,
    };
    fila.conversaciones++;
    if (citas.includes(f.stage)) fila.citas++;
    if (ganadas.includes(f.stage)) fila.ganadas++;
    if (!fila.titular && f.titular) fila.titular = f.titular;
    por.set(llave, fila);
  }
  const campanas = [...por.values()].map((f) => ({ ...f, conversion: f.conversaciones ? Math.round((f.ganadas / f.conversaciones) * 100) : 0 }));
  campanas.sort((a, b) => b.conversaciones - a.conversaciones);

  const total = (db.prepare('SELECT COUNT(*) n FROM users WHERE first_seen >= ?').get(desde) as { n: number }).n;
  return { campanas, sinOrigen: Math.max(0, total - filas.length) };
}
