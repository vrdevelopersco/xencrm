// Las cuentas clave (KAM, key account management): los clientes que más importan, quién los lleva y cómo están.
//
// Hasta XENCRM todos los contactos pesaban igual. En un negocio de cita previa no es así: quien ya compró y volvió,
// o el novio que trae a sus padrinos, vale más que diez curiosos, y perderlo por no contestarle a tiempo cuesta más.
// Marcar una cuenta clave es una decisión de quien vende —no la toma ningún modelo— y queda con su nombre y su fecha.
//
// 🪤 La SALUD de una cuenta no es un número mágico: son reglas que se pueden leer, cada una con su frase. «En riesgo»
// sin decir por qué no le sirve a nadie para decidir qué hacer; con su porqué, la acción sale sola. Y nada se
// inventa: sin análisis no hay ánimo, sin precios no hay valor («—», nunca «$0»).
//
// 🪤 Las CANDIDATAS salen de reglas igual de claras (ya compró, volvió, vino a su cita, caliente con cita, de las de
// mayor valor). Se proponen, no se marcan solas: una lista que se llena sola deja de ser la de las que importan.
import { V } from '../vocabulario.js';
import { business } from '../config.js';
import { getDb } from '../rag/store.js';
import { addEvent, esPersona, getContact, listContacts, rolDe, STAGE_LABELS, type Contact } from './contacts.js';
import { emitEvent } from './events.js';
import { historiaDe, enUnaFrase } from './historia.js';
import { contextoDelPaso, proximoPaso, type ContextoPaso, type ProximoPaso } from './proximo.js';
import { sentimiento, type Animo, type NivelDeInteres } from './sentimiento.js';
import { valorDe } from './valor.js';

const DIA = 86400_000;
/** El plan de cuenta es una nota corta: lo que hay que saber antes de hablarle, no su historia entera. */
export const MAX_NOTA = 600;
/**
 * Cuánto silencio aguanta una cuenta clave. 🪤 No son los 24 h de Seguimientos: a un cliente que ya compró no se le
 * escribe cada día. Tres semanas sin hablar ya es para mirar; mes y medio, para preocuparse.
 */
export const DIAS_ATENCION = 21;
export const DIAS_RIESGO = 45;
/** Lo mismo que «caliente» en Hoy y en Seguimientos. */
const CALIENTE = 60;

export interface CuentaClave {
  id: string;
  /** Quién la marcó. */
  por: string;
  desde: number;
  nota: string;
  notaPor: string | null;
  notaAt: number | null;
}

type Fila = { user_id: string; por: string; desde: number; nota: string; nota_por: string | null; nota_at: number | null };
const aCuenta = (r: Fila): CuentaClave => ({ id: r.user_id, por: r.por, desde: r.desde, nota: r.nota, notaPor: r.nota_por, notaAt: r.nota_at });

export function esCuentaClave(id: string): CuentaClave | null {
  const r = getDb().prepare('SELECT * FROM cuentas_clave WHERE user_id = ?').get(id) as Fila | undefined;
  return r ? aCuenta(r) : null;
}

export function listarCuentasClave(): CuentaClave[] {
  return (getDb().prepare('SELECT * FROM cuentas_clave ORDER BY desde DESC').all() as Fila[]).map(aCuenta);
}

/**
 * Marcar o quitar. Marcar dos veces no cambia quién la marcó ni desde cuándo. Devuelve la cuenta, o null si se quitó.
 * La historia de la ficha lo cuenta con el nombre de quien lo hizo.
 */
export function marcarCuentaClave(id: string, on: boolean, por: string, now = Date.now()): CuentaClave | null {
  if (!getContact(id)) throw new Error('esa ficha no existe');
  const ya = esCuentaClave(id);
  const db = getDb();
  if (on && !ya) {
    db.prepare('INSERT INTO cuentas_clave (user_id, por, desde) VALUES (?, ?, ?)').run(id, por, now);
    addEvent(id, 'cuenta_clave', { on: true, by: por });
  } else if (!on && ya) {
    db.prepare('DELETE FROM cuentas_clave WHERE user_id = ?').run(id);
    addEvent(id, 'cuenta_clave', { on: false, by: por });
  }
  emitEvent('contact', id, { cuentaClave: on });
  return on ? esCuentaClave(id) : null;
}

/** El plan de cuenta. Solo de una cuenta clave: una nota suelta ya tiene su sitio en las notas de la ficha. */
export function notaDeCuenta(id: string, nota: unknown, por: string, now = Date.now()): CuentaClave {
  if (!esCuentaClave(id)) throw new Error('esa ficha no es una cuenta clave');
  const limpia = String(nota ?? '').replace(/\r\n/g, '\n').trim();
  if (limpia.length > MAX_NOTA) throw new Error(`el plan de cuenta va hasta ${MAX_NOTA} letras (tiene ${limpia.length})`);
  getDb().prepare('UPDATE cuentas_clave SET nota = ?, nota_por = ?, nota_at = ? WHERE user_id = ?').run(limpia, limpia ? por : null, limpia ? now : null, id);
  return esCuentaClave(id)!;
}

/**
 * Al unir dos fichas (crm/merge.ts, dentro de su transacción). Si solo la que se va era cuenta clave, la que queda lo
 * pasa a ser; si las dos lo eran, se queda la marca de la que queda y los dos planes se juntan.
 */
export function unirCuentasClave(keepId: string, dropId: string): void {
  const db = getDb();
  const drop = db.prepare('SELECT * FROM cuentas_clave WHERE user_id = ?').get(dropId) as Fila | undefined;
  if (!drop) return;
  const keep = db.prepare('SELECT * FROM cuentas_clave WHERE user_id = ?').get(keepId) as Fila | undefined;
  if (!keep) {
    db.prepare('UPDATE cuentas_clave SET user_id = ? WHERE user_id = ?').run(keepId, dropId);
    return;
  }
  const nota = [keep.nota, drop.nota].map((n) => n.trim()).filter(Boolean).join('\n').slice(0, MAX_NOTA);
  db.prepare('UPDATE cuentas_clave SET nota = ?, desde = ? WHERE user_id = ?').run(nota, Math.min(keep.desde, drop.desde), keepId);
  db.prepare('DELETE FROM cuentas_clave WHERE user_id = ?').run(dropId);
}

// ---------- la salud de una cuenta ----------

export type Salud = 'sana' | 'atencion' | 'riesgo';
/** Cada regla que pesó: lo que preocupa (atención, riesgo) y lo que va bien, para que la salud se pueda discutir. */
export interface Motivo {
  nivel: Salud | 'bien';
  texto: string;
}

export interface DatosDeSalud {
  now: number;
  /** La última vez que se habló (mensaje de cualquiera de los dos lados). */
  ultima: number | null;
  animo: Animo | null;
  paso: ProximoPaso;
  responsable: string | null;
  etapaRol: string | null;
  /** Citas a las que faltó, y si tiene una por venir. */
  falto: number;
  proximaCita: number | null;
}

const hace = (ms: number): string => {
  const d = Math.floor(ms / DIA);
  if (d >= 1) return d === 1 ? '1 día' : `${d} días`;
  const h = Math.max(1, Math.floor(ms / 3600_000));
  return h === 1 ? '1 hora' : `${h} horas`;
};

/** Pura: las reglas, en orden, y la salud que sale de la peor. */
export function saludDe(x: DatosDeSalud): { salud: Salud; motivos: Motivo[] } {
  const m: Motivo[] = [];
  const callado = x.ultima == null ? null : x.now - x.ultima;

  if (x.etapaRol === 'perdido') m.push({ nivel: 'riesgo', texto: 'El último trato se perdió' });
  if (x.animo === 'negativo') m.push({ nivel: 'riesgo', texto: 'Molesto en su último análisis' });

  // Lo que espera a alguien del equipo (las mismas reglas del próximo paso de cada ficha).
  if (x.paso.tipo === 'responder') {
    const espera = x.paso.cuando != null ? x.now - x.paso.cuando : 0;
    m.push(espera >= DIA ? { nivel: 'riesgo', texto: `Escribió hace ${hace(espera)} y nadie le ha contestado` } : { nivel: 'atencion', texto: `Escribió hace ${hace(espera)}: falta contestarle` });
  } else if (x.paso.tipo === 'persona') m.push({ nivel: 'atencion', texto: 'Pidió hablar con una persona' });
  else if (x.paso.tipo === 'verificar') m.push({ nivel: 'atencion', texto: 'Quedó algo por averiguarle' });
  else if (x.paso.tipo === 'resultado') m.push({ nivel: 'atencion', texto: `Falta anotar cómo le fue en ${V.la} ${V.cita}` });

  // El silencio, con la vara de una cuenta clave (no la de un prospecto). Si ya hay algo esperando respuesta, el
  // silencio no se cuenta dos veces.
  if (callado == null) m.push({ nivel: 'atencion', texto: 'Todavía no hay conversación con esta cuenta' });
  else if (x.paso.tipo !== 'responder') {
    if (callado >= DIAS_RIESGO * DIA) m.push({ nivel: 'riesgo', texto: `${hace(callado)} sin hablar (más de ${DIAS_RIESGO})` });
    else if (callado >= DIAS_ATENCION * DIA) m.push({ nivel: 'atencion', texto: `${hace(callado)} sin hablar (más de ${DIAS_ATENCION})` });
  }

  if (!x.responsable || !esPersona(x.responsable)) m.push({ nivel: 'atencion', texto: 'Nadie la tiene asignada' });
  if (x.falto > 0 && !x.proximaCita) m.push({ nivel: 'atencion', texto: x.falto === 1 ? `Faltó a ${V.una} ${V.cita} y no tiene ${V.otra}` : `Faltó a ${x.falto} ${V.citas} y no tiene ${V.otra}` });

  // Lo que va bien: también se dice, para que «Sana» no sea un silencio.
  if (callado != null && callado < DIAS_ATENCION * DIA && x.paso.tipo !== 'responder') m.push({ nivel: 'bien', texto: callado < DIA ? 'Habló hoy' : `Habló hace ${hace(callado)}` });
  if (x.animo === 'positivo') m.push({ nivel: 'bien', texto: 'Contento en su último análisis' });
  if (x.proximaCita) m.push({ nivel: 'bien', texto: `Tiene ${V.cita} por delante` });
  if (x.etapaRol === 'ganado') m.push({ nivel: 'bien', texto: 'Ya compró' });

  const salud: Salud = m.some((y) => y.nivel === 'riesgo') ? 'riesgo' : m.some((y) => y.nivel === 'atencion') ? 'atencion' : 'sana';
  return { salud, motivos: m };
}

// ---------- las candidatas ----------

export interface DatosDeCandidata {
  etapaRol: string | null;
  volvio: number;
  citasCumplidas: number;
  proximaCita: number | null;
  scoreBase: number;
  valor: number;
  /** El valor desde el que una ficha está entre el 25 % de mayor valor; null si hay muy pocas con precio para decirlo. */
  valorAlto: number | null;
}

/** Pura: por qué esta ficha podría ser cuenta clave. Vacío: no lo es. */
export function porQueCandidata(x: DatosDeCandidata): string[] {
  if (x.etapaRol === 'perdido') return [];
  const r: string[] = [];
  if (x.etapaRol === 'ganado') r.push(x.volvio > 0 ? (x.volvio === 1 ? 'Compró y volvió' : `Compró y volvió ${x.volvio} veces`) : 'Ya compró');
  else if (x.volvio >= 2) r.push(`Volvió ${x.volvio} veces`);
  if (x.valorAlto != null && x.valor > 0 && x.valor >= x.valorAlto) r.push('Entre el 25 % de mayor valor');
  if (x.scoreBase >= CALIENTE && x.proximaCita) r.push(`Caliente y con ${V.cita}`);
  if (x.citasCumplidas > 0) r.push(x.citasCumplidas === 1 ? `Vino a su ${V.cita}` : `Vino a ${x.citasCumplidas} ${V.citas}`);
  return r;
}

/** El valor desde el que se está en el cuarto de arriba. Con menos de 4 precios, no se dice: sería azar. */
export function umbralDeValorAlto(valores: number[]): number | null {
  const v = valores.filter((n) => n > 0).sort((a, b) => a - b);
  if (v.length < 4) return null;
  return v[Math.floor(v.length * 0.75)]!;
}

// ---------- el panel ----------

export interface FilaKam {
  id: string;
  nombre: string | null;
  telefono: string | null;
  canal: string;
  kam: string | null;
  valor: number;
  valorOrigen: string;
  vendido: boolean;
  etapa: string;
  etapaNombre: string;
  etapaRol: string | null;
  paso: { tipo: string; texto: string; urgente: boolean };
  ultima: number | null;
  animo: Animo | null;
  interes: NivelDeInteres | null;
  salud: Salud;
  motivos: Motivo[];
  historia: string;
  desde: number;
  por: string;
  nota: string;
  notaPor: string | null;
  notaAt: number | null;
  archivada: boolean;
}

export interface Candidata {
  id: string;
  nombre: string | null;
  telefono: string | null;
  canal: string;
  kam: string | null;
  etapa: string;
  etapaNombre: string;
  etapaRol: string | null;
  valor: number;
  motivos: string[];
}

export interface PanelKam {
  cuentas: FilaKam[];
  candidatas: Candidata[];
  cifras: { cuentas: number; valor: number; conValor: number; vendido: number; enRiesgo: number; atencion: number; sinKam: number };
  moneda: string;
  /** Las personas que ya llevan alguna cuenta o contacto: para filtrar y asignar sin escribir nombres de memoria. */
  equipo: string[];
  umbrales: { diasAtencion: number; diasRiesgo: number };
}

const ORDEN_SALUD: Record<Salud, number> = { riesgo: 0, atencion: 1, sana: 2 };
const esGrupo = (id: string) => id.endsWith('@g.us');
const numeroDe = (c: Contact): string | null => c.phone || (/^wa:(\d{7,15})@/.exec(c.id)?.[1] ?? null);

/** Todo lo del panel, de la base. Sin modelo y sin red. */
export function panelKam(now = Date.now()): PanelKam {
  const marcadas = listarCuentasClave();
  const ctx: ContextoPaso = contextoDelPaso(now);
  const animoInteres = new Map<string, { animo: Animo | null; interes: NivelDeInteres | null }>();
  for (const f of sentimiento(30, now).contactos) animoInteres.set(f.id, { animo: f.animo, interes: f.interes });

  const cuentas: FilaKam[] = [];
  for (const k of marcadas) {
    const c = getContact(k.id);
    if (!c) continue; // borrada por fuera: no se enseña (y deleteContact ya limpia la marca)
    const rol = rolDe(c.stage);
    const h = historiaDe(c.id, { ahora: now, etapa: c.stage });
    const paso = proximoPaso(c, ctx);
    const ai = animoInteres.get(c.id) ?? { animo: (['positivo', 'neutral', 'negativo'] as Animo[]).find((a) => a === c.sentiment) ?? null, interes: null };
    const ultima = c.lastMessageAt ?? null;
    const { salud, motivos } = saludDe({ now, ultima, animo: ai.animo, paso, responsable: c.responsable, etapaRol: rol, falto: h.citas.falto, proximaCita: h.citas.proxima });
    const v = valorDe(c);
    cuentas.push({
      id: c.id,
      nombre: c.name,
      telefono: numeroDe(c),
      canal: c.channel,
      kam: c.responsable && esPersona(c.responsable) ? c.responsable : null,
      valor: v.valor,
      valorOrigen: v.origen,
      vendido: rol === 'ganado',
      etapa: c.stage,
      etapaNombre: STAGE_LABELS[c.stage] ?? c.stage,
      etapaRol: rol,
      paso: { tipo: paso.tipo, texto: paso.texto, urgente: paso.urgente },
      ultima,
      animo: ai.animo,
      interes: ai.interes,
      salud,
      motivos,
      historia: enUnaFrase(h),
      desde: k.desde,
      por: k.por,
      nota: k.nota,
      notaPor: k.notaPor,
      notaAt: k.notaAt,
      archivada: c.archived,
    });
  }
  // Lo que más preocupa arriba; entre iguales, lo que vale más y lo que lleva más tiempo callado.
  cuentas.sort((a, b) => ORDEN_SALUD[a.salud] - ORDEN_SALUD[b.salud] || b.valor - a.valor || (a.ultima ?? 0) - (b.ultima ?? 0));

  // Candidatas: las fichas activas que cumplen alguna regla y todavía no son cuenta clave.
  const yaSon = new Set(marcadas.map((k) => k.id));
  const activas = listContacts({ limit: 2000 }).filter((c) => !c.archived && !esGrupo(c.id) && !yaSon.has(c.id));
  const valores = new Map(activas.map((c) => [c.id, valorDe(c).valor]));
  const valorAlto = umbralDeValorAlto([...valores.values()]);
  const candidatas: (Candidata & { peso: number })[] = [];
  for (const c of activas) {
    const rol = rolDe(c.stage);
    if (rol === 'perdido') continue;
    const valor = valores.get(c.id) ?? 0;
    // La historia lee la conversación: solo se pide para quien puede cumplir alguna regla que la necesita.
    const necesita = rol === 'ganado' || ctx.proximaCita.has(c.id) || c.scoreBase >= CALIENTE;
    const h = necesita ? historiaDe(c.id, { ahora: now, etapa: c.stage }) : null;
    const motivos = porQueCandidata({
      etapaRol: rol,
      volvio: h?.volvio ?? 0,
      citasCumplidas: h?.citas.cumplidas ?? 0,
      proximaCita: ctx.proximaCita.get(c.id) ?? null,
      scoreBase: c.scoreBase,
      valor,
      valorAlto,
    });
    if (!motivos.length) continue;
    candidatas.push({
      id: c.id,
      nombre: c.name,
      telefono: numeroDe(c),
      canal: c.channel,
      kam: c.responsable && esPersona(c.responsable) ? c.responsable : null,
      etapa: c.stage,
      etapaNombre: STAGE_LABELS[c.stage] ?? c.stage,
      etapaRol: rol,
      valor,
      motivos,
      peso: motivos.length * 1000 + Math.min(999, c.scoreBase),
    });
  }
  candidatas.sort((a, b) => b.peso - a.peso || b.valor - a.valor);

  const equipo = new Set<string>();
  for (const c of listContacts({ limit: 2000 })) if (c.responsable && esPersona(c.responsable)) equipo.add(c.responsable);
  for (const k of cuentas) if (k.kam) equipo.add(k.kam);

  return {
    cuentas,
    candidatas: candidatas.slice(0, 6).map(({ peso: _peso, ...x }) => x),
    cifras: {
      cuentas: cuentas.length,
      valor: cuentas.reduce((s, k) => s + k.valor, 0),
      conValor: cuentas.filter((k) => k.valor > 0).length,
      vendido: cuentas.filter((k) => k.vendido).reduce((s, k) => s + k.valor, 0),
      enRiesgo: cuentas.filter((k) => k.salud === 'riesgo').length,
      atencion: cuentas.filter((k) => k.salud === 'atencion').length,
      sinKam: cuentas.filter((k) => !k.kam).length,
    },
    moneda: business.business.currency || 'COP',
    equipo: [...equipo].sort((a, b) => a.localeCompare(b, 'es')),
    umbrales: { diasAtencion: DIAS_ATENCION, diasRiesgo: DIAS_RIESGO },
  };
}
