// El sentimiento de la cartera: cuánto interés hay, de qué ánimo está la gente y qué la frena.
//
// No se calcula nada nuevo ni se le pregunta a ningún modelo: todo sale de lo que el análisis por turno ya guardó
// (crm/analyzer.ts). Cada contacto lleva su ánimo (`users.sentiment`), su interés de 0 a 3 (`data.interes`) y su
// objeción (`data.objecion`); cada análisis queda en `analyses` con su fecha y sus señales. Aquí solo se cuenta.
//
// 🪤 El interés y el ánimo son DOS cosas, y no se mezclan en una sola escala. Alguien puede querer comprar ya y estar
// molesto porque nadie le contesta: ese es justo el que hay que cuidar, y en una escala única se perdería (o
// saldría como «molesto» y nadie vería que quería comprar). Por eso van por separado y además cruzados.
//
// 🪤 Lo que el equipo corrigió a mano en la ficha manda sobre lo que dijo el análisis (crm/ficha.ts marca esos
// campos). Por eso el interés y la objeción se leen primero de `data`, y solo si no están, de la última señal.
import { business } from '../config.js';
import { getDb } from '../rag/store.js';

export type Animo = 'positivo' | 'neutral' | 'negativo';
export type NivelDeInteres = 0 | 1 | 2 | 3;

const DIA = 86400_000;
const ANIMOS: Animo[] = ['positivo', 'neutral', 'negativo'];

/** Lo que hace falta de un contacto (sin archivar ni grupos: eso lo filtra quien lee la base). */
export interface ContactoParaSentimiento {
  id: string;
  name: string | null;
  phone: string | null;
  channel: string | null;
  stage: string;
  sentiment: string | null;
  data: Record<string, unknown>;
  summary: string | null;
}

/** Un análisis guardado: cuándo, de quién, con qué ánimo y qué señales. */
export interface AnalisisParaSentimiento {
  userId: string;
  ts: number;
  sentiment: string | null;
  signals: Record<string, unknown>;
}

export interface FilaDeSentimiento {
  id: string;
  nombre: string | null;
  telefono: string | null;
  canal: string | null;
  etapa: string;
  /** null: el análisis no dejó dato de interés (por ejemplo, una ficha que vino de una importación). */
  interes: NivelDeInteres | null;
  animo: Animo | null;
  urgencia: string | null;
  objecion: string | null;
  resumen: string | null;
  /** Cuándo fue el último análisis; null si el ánimo vino sin análisis guardado. */
  analizadoEn: number | null;
}

export interface Sentimiento {
  /** Contactos activos (sin archivar, sin grupos). */
  total: number;
  /** Los que tienen algo que contar: un análisis guardado o al menos su ánimo. */
  analizados: number;
  sinAnalizar: number;
  /** Cuántos en cada nivel de interés (solo los que tienen el dato). */
  interes: Record<NivelDeInteres, number>;
  interesSinDato: number;
  animo: Record<Animo, number>;
  animoSinDato: number;
  /** Interés × ánimo: `cruce[interes][animo]`. Solo los que tienen los dos datos. */
  cruce: Record<NivelDeInteres, Record<Animo, number>>;
  /** Las objeciones que se repiten, de la más a la menos, con quiénes la dijeron. */
  objeciones: { texto: string; n: number; ids: string[] }[];
  /** Por día (en la zona del negocio): el último análisis de cada contacto ese día, contado por ánimo. */
  serie: { dia: string; positivo: number; neutral: number; negativo: number; interesMedio: number | null }[];
  dias: number;
  contactos: FilaDeSentimiento[];
}

/** El día (año-mes-día) de un instante en la zona del negocio. Igual que crm/series.ts. */
export function diaEnLaZona(ts: number, zona = business.timezone): string {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ts));
  const parte = (t: string) => f.find((p) => p.type === t)?.value ?? '00';
  return `${parte('year')}-${parte('month')}-${parte('day')}`;
}

const nivel = (v: unknown): NivelDeInteres | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 3 ? (n as NivelDeInteres) : null;
};
const animoDe = (v: unknown): Animo | null => (ANIMOS.includes(v as Animo) ? (v as Animo) : null);
const texto = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s : null;
};
/** Para agrupar objeciones que son la misma dicha distinto: sin mayúsculas, tildes, signos ni espacios de más. */
export const claveDeObjecion = (s: string): string =>
  s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();

/** Cuenta. Pura: recibe los contactos y sus análisis, y no toca la base ni la red. */
export function agregarSentimiento(entrada: {
  contactos: ContactoParaSentimiento[];
  analisis: AnalisisParaSentimiento[];
  dias?: number;
  now?: number;
  zona?: string;
}): Sentimiento {
  const dias = Math.max(7, Math.min(90, Math.round(entrada.dias ?? 30)));
  const now = entrada.now ?? Date.now();
  const zona = entrada.zona ?? business.timezone;
  const ids = new Set(entrada.contactos.map((c) => c.id));

  // El último análisis de cada contacto.
  const ultimo = new Map<string, AnalisisParaSentimiento>();
  for (const a of entrada.analisis) {
    if (!ids.has(a.userId)) continue;
    const ya = ultimo.get(a.userId);
    if (!ya || a.ts > ya.ts) ultimo.set(a.userId, a);
  }

  const interes: Record<NivelDeInteres, number> = { 3: 0, 2: 0, 1: 0, 0: 0 };
  const animo: Record<Animo, number> = { positivo: 0, neutral: 0, negativo: 0 };
  const cruce = Object.fromEntries(([3, 2, 1, 0] as NivelDeInteres[]).map((k) => [k, { positivo: 0, neutral: 0, negativo: 0 }])) as Sentimiento['cruce'];
  let interesSinDato = 0;
  let animoSinDato = 0;
  const filas: FilaDeSentimiento[] = [];
  const objeciones = new Map<string, { formas: Map<string, number>; ids: string[] }>();

  for (const c of entrada.contactos) {
    const a = ultimo.get(c.id);
    const s = a?.signals ?? {};
    const elAnimo = animoDe(c.sentiment) ?? animoDe(a?.sentiment) ?? animoDe(s.sentimiento);
    // Sin análisis y sin ánimo, no hay nada que contar de esta persona: va a «sin analizar».
    if (!a && !elAnimo) continue;
    const elInteres = nivel(c.data?.interes) ?? nivel(s.interes);
    const objecion = texto(c.data?.objecion) ?? (s.tiene_objecion ? texto(s.objecion) : null);
    filas.push({
      id: c.id,
      nombre: texto(c.name),
      telefono: texto(c.phone),
      canal: c.channel,
      etapa: c.stage,
      interes: elInteres,
      animo: elAnimo,
      urgencia: texto(c.data?.urgencia) ?? texto(s.urgencia),
      objecion,
      resumen: texto(c.summary),
      analizadoEn: a?.ts ?? null,
    });
    if (elInteres === null) interesSinDato++;
    else interes[elInteres]++;
    if (elAnimo === null) animoSinDato++;
    else animo[elAnimo]++;
    if (elInteres !== null && elAnimo !== null) cruce[elInteres][elAnimo]++;
    if (objecion) {
      const k = claveDeObjecion(objecion);
      if (k) {
        const g = objeciones.get(k) ?? { formas: new Map<string, number>(), ids: [] as string[] };
        g.formas.set(objecion, (g.formas.get(objecion) ?? 0) + 1);
        g.ids.push(c.id);
        objeciones.set(k, g);
      }
    }
  }

  // Por día: lo último de cada contacto ese día, para que alguien que escribió veinte veces no pese veinte.
  const diasDeLaSerie: string[] = [];
  for (let i = dias - 1; i >= 0; i--) diasDeLaSerie.push(diaEnLaZona(now - i * DIA, zona));
  const enLaSerie = new Set(diasDeLaSerie);
  const delDia = new Map<string, AnalisisParaSentimiento>();
  for (const a of entrada.analisis) {
    if (!ids.has(a.userId) || a.ts > now || a.ts < now - dias * DIA) continue;
    const dia = diaEnLaZona(a.ts, zona);
    if (!enLaSerie.has(dia)) continue;
    const k = `${dia}|${a.userId}`;
    const ya = delDia.get(k);
    if (!ya || a.ts > ya.ts) delDia.set(k, a);
  }
  const porDia = new Map(diasDeLaSerie.map((dia) => [dia, { dia, positivo: 0, neutral: 0, negativo: 0, suma: 0, conInteres: 0 }]));
  for (const [k, a] of delDia) {
    const casilla = porDia.get(k.slice(0, 10))!;
    const elAnimo = animoDe(a.sentiment) ?? animoDe(a.signals?.sentimiento);
    if (elAnimo) casilla[elAnimo]++;
    const n = nivel(a.signals?.interes);
    if (n !== null) {
      casilla.suma += n;
      casilla.conInteres++;
    }
  }

  filas.sort((x, y) => (y.analizadoEn ?? 0) - (x.analizadoEn ?? 0));
  return {
    total: entrada.contactos.length,
    analizados: filas.length,
    sinAnalizar: entrada.contactos.length - filas.length,
    interes,
    interesSinDato,
    animo,
    animoSinDato,
    cruce,
    objeciones: [...objeciones.values()]
      .map((g) => ({ texto: [...g.formas].sort((x, y) => y[1] - x[1])[0]![0], n: g.ids.length, ids: g.ids }))
      .sort((x, y) => y.n - x.n || x.texto.localeCompare(y.texto, 'es'))
      .slice(0, 8),
    serie: [...porDia.values()].map((d) => ({
      dia: d.dia,
      positivo: d.positivo,
      neutral: d.neutral,
      negativo: d.negativo,
      interesMedio: d.conInteres ? Math.round((d.suma / d.conInteres) * 10) / 10 : null,
    })),
    dias,
    contactos: filas,
  };
}

const json = (v: unknown): Record<string, unknown> => {
  try {
    const o = v ? JSON.parse(String(v)) : {};
    return o && typeof o === 'object' ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

/** Lo de la base: los contactos activos y sus análisis. Sin modelo y sin red. */
export function sentimiento(dias = 30, now = Date.now()): Sentimiento {
  const db = getDb();
  const contactos = (
    db.prepare("SELECT id, name, phone, channel, stage, sentiment, data, summary FROM users WHERE archived = 0 AND id NOT LIKE '%@g.us'").all() as {
      id: string;
      name: string | null;
      phone: string | null;
      channel: string | null;
      stage: string;
      sentiment: string | null;
      data: string | null;
      summary: string | null;
    }[]
  ).map((r) => ({ ...r, data: json(r.data) }));
  // Los análisis de esos contactos: el último de cada uno (para el ánimo y el interés de hoy) y los de la ventana
  // de la serie. Se leen todos los de la ventana y, aparte, el último de cada contacto aunque sea más viejo.
  const desde = now - Math.max(7, Math.min(90, dias)) * DIA;
  const recientes = db.prepare('SELECT user_id, ts, sentiment, signals FROM analyses WHERE ts >= ?').all(desde) as { user_id: string; ts: number; sentiment: string | null; signals: string }[];
  const ultimos = db
    .prepare('SELECT a.user_id, a.ts, a.sentiment, a.signals FROM analyses a JOIN (SELECT user_id, MAX(ts) ts FROM analyses GROUP BY user_id) u ON u.user_id = a.user_id AND u.ts = a.ts')
    .all() as { user_id: string; ts: number; sentiment: string | null; signals: string }[];
  const vistos = new Set<string>();
  const analisis: AnalisisParaSentimiento[] = [];
  for (const r of [...recientes, ...ultimos]) {
    const k = `${r.user_id}|${r.ts}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    analisis.push({ userId: r.user_id, ts: r.ts, sentiment: r.sentiment, signals: json(r.signals) });
  }
  return agregarSentimiento({ contactos, analisis, dias, now });
}
