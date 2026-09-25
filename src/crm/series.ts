// Las dos preguntas que un dueño se hace mirando el mes: **cuánta gente nueva llega y por dónde**, y **a qué
// horas le escriben**. Ninguna se responde con un número suelto; las dos se ven de un vistazo en una gráfica.
//
// Todo sale de lo que ya está en la base: cuándo se vio por primera vez cada conversación y cuándo escribió cada
// cliente. Nada que calcular de noche ni tabla que mantener.
//
// 🪤 Los días y las horas se cuentan en la **zona del negocio**, no en la del servidor. Un mensaje de las 11 de
// la noche en Barranquilla no puede caer en el día siguiente porque el servidor esté en Londres; y "a qué horas
// me escriben" con las horas corridas no sirve para nada.
import { business } from '../config.js';
import { getDb } from '../rag/store.js';

const DIA = 86400_000;

/** Partes de una fecha en la zona del negocio: año-mes-día y hora. */
function enLaZona(ts: number, zona = business.timezone): { dia: string; hora: number } {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ts));
  const parte = (t: string) => f.find((p) => p.type === t)?.value ?? '00';
  return { dia: `${parte('year')}-${parte('month')}-${parte('day')}`, hora: Number(parte('hour')) % 24 };
}

/** Los últimos `dias` días, del más viejo al de hoy, en la zona del negocio. */
function ultimosDias(dias: number, now: number): string[] {
  const out: string[] = [];
  for (let i = dias - 1; i >= 0; i--) out.push(enLaZona(now - i * DIA).dia);
  return out;
}

export interface DiaNuevas {
  dia: string;
  whatsapp: number;
  web: number;
  otros: number;
  total: number;
}

/**
 * Conversaciones nuevas por día, partidas por canal. Responde "¿de dónde me está llegando la gente?", que es lo
 * que decide dónde poner la plata.
 */
export function nuevasPorDia(dias = 14, now = Date.now()): DiaNuevas[] {
  const desde = now - dias * DIA;
  const filas = getDb()
    .prepare('SELECT first_seen ts, channel FROM users WHERE archived = 0 AND first_seen >= ?')
    .all(desde) as { ts: number; channel: string | null }[];
  const porDia = new Map<string, DiaNuevas>();
  for (const dia of ultimosDias(dias, now)) porDia.set(dia, { dia, whatsapp: 0, web: 0, otros: 0, total: 0 });
  for (const f of filas) {
    const casilla = porDia.get(enLaZona(f.ts).dia);
    if (!casilla) continue;
    const canal = (f.channel ?? '').toLowerCase();
    if (canal.includes('whatsapp') || canal === 'meta') casilla.whatsapp++;
    else if (canal === 'web') casilla.web++;
    else casilla.otros++;
    casilla.total++;
  }
  return [...porDia.values()];
}

export interface Actividad {
  /** Las horas que de verdad tienen algo, para no pintar la madrugada vacía. */
  horas: number[];
  dias: string[];
  /** celdas[hora][dia] = cuántos mensajes del cliente. */
  celdas: number[][];
  max: number;
  total: number;
}

/**
 * A qué horas escriben los clientes, por día. Es lo que dice si hace falta alguien a las 7 de la noche o si el
 * asistente está solo a esa hora.
 */
export function actividadPorHora(dias = 14, now = Date.now()): Actividad {
  const desde = now - dias * DIA;
  const filas = getDb().prepare("SELECT ts FROM messages WHERE role = 'user' AND ts >= ?").all(desde) as { ts: number }[];
  const listaDias = ultimosDias(dias, now);
  const indice = new Map(listaDias.map((d, i) => [d, i]));
  const rejilla = Array.from({ length: 24 }, () => new Array(listaDias.length).fill(0) as number[]);
  let total = 0;
  for (const f of filas) {
    const { dia, hora } = enLaZona(f.ts);
    const col = indice.get(dia);
    if (col === undefined) continue;
    rejilla[hora]![col]!++;
    total++;
  }
  // Solo las horas con algo, y un poco de margen para que no queden pegadas al borde.
  const conAlgo = rejilla.map((fila, h) => ({ h, suma: fila.reduce((a, b) => a + b, 0) })).filter((x) => x.suma > 0);
  const desdeHora = conAlgo.length ? Math.max(0, Math.min(...conAlgo.map((x) => x.h)) - 1) : 8;
  const hastaHora = conAlgo.length ? Math.min(23, Math.max(...conAlgo.map((x) => x.h)) + 1) : 20;
  const horas: number[] = [];
  for (let h = desdeHora; h <= hastaHora; h++) horas.push(h);
  return {
    horas,
    dias: listaDias,
    celdas: horas.map((h) => rejilla[h]!),
    max: Math.max(1, ...rejilla.flat()),
    total,
  };
}

export interface Comparado {
  ahora: number;
  antes: number;
  /** Diferencia en porcentaje; null cuando antes era cero y no hay con qué comparar. */
  delta: number | null;
}

// 🪤 La ventana de "esta semana" no lleva tope: lo que acaba de entrar —con la marca justo en `now`— tiene que
// contar. Con `< now` se quedaba fuera lo de este segundo, que es lo que uno está mirando.
const comparar = (ahora: number, antes: number): Comparado => ({
  ahora,
  antes,
  delta: antes === 0 ? null : Math.round(((ahora - antes) / antes) * 100),
});

/** Esta semana contra la anterior: conversaciones nuevas, mensajes de clientes y citas agendadas. */
export function semanaContraSemana(now = Date.now()): { conversaciones: Comparado; mensajes: Comparado; citas: Comparado } {
  const db = getDb();
  const semana = 7 * DIA;
  const desde = (sql: string, d: number) => (db.prepare(sql).get(d) as { n: number }).n;
  const entre = (sql: string, d: number, h: number) => (db.prepare(sql).get(d, h) as { n: number }).n;
  const nuevas = 'SELECT COUNT(*) n FROM users WHERE archived = 0 AND first_seen >= ?';
  const msgs = "SELECT COUNT(*) n FROM messages WHERE role = 'user' AND ts >= ?";
  const citas = 'SELECT COUNT(*) n FROM appointments WHERE created_at >= ?';
  return {
    conversaciones: comparar(desde(nuevas, now - semana), entre(`${nuevas} AND first_seen < ?`, now - 2 * semana, now - semana)),
    mensajes: comparar(desde(msgs, now - semana), entre(`${msgs} AND ts < ?`, now - 2 * semana, now - semana)),
    citas: comparar(desde(citas, now - semana), entre(`${citas} AND created_at < ?`, now - 2 * semana, now - semana)),
  };
}
