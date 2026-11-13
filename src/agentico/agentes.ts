/**
 * Los agentes del negocio: uno o varios, cada uno con su nombre, lo que atiende, por dónde y cómo habla.
 *
 * Sin configurar nada hay uno solo, el de siempre (`business.agent`), que atiende todo por WhatsApp y el chat: así
 * un negocio que no toca esto no cambia en nada. Con varios, cada conversación queda con UN agente; si el cliente
 * cambia de tema a algo que ese agente no atiende y otro sí, la toma el otro y se presenta («te atiende Sofía, de
 * soporte»), como en un equipo de verdad.
 *
 * Lo que atiende un agente decide sus herramientas en el modo agéntico (agentico/cliente.ts): soporte consulta y
 * abre tickets; ventas, el catálogo y los espacios; agenda, las citas. Pasar a una persona y buscar en la
 * información los tienen todos.
 *
 * 🪤 El agente de una conversación se guarda aparte (`agente_de_conversacion`) y no en la ficha: lo de la ficha se
 * le enseña al equipo como datos del cliente, y «agente: soporte» no es un dato del cliente.
 */
import { z } from 'zod';
import { business } from '../config.js';
import { V } from '../vocabulario.js';
import { getDb } from '../rag/store.js';
import { getSetting, setSetting } from '../crm/settings.js';

export const AREAS = ['ventas', 'soporte', 'agenda', 'informacion'] as const;
export type Area = (typeof AREAS)[number];
export const CANALES_DE_AGENTE = ['whatsapp', 'web', 'voz', 'telefono'] as const;
export type CanalDeAgente = (typeof CANALES_DE_AGENTE)[number];

/** Las voces de Grok (GET /v1/tts/voices, consultado el 2026-11-13). La de fábrica es «eve». */
export const VOCES_GROK = ['eve', 'ara', 'leo', 'rex', 'sal', 'luna', 'iris', 'celeste', 'helix', 'orion', 'atlas', 'cosmo'] as const;

const Voz = z.object({
  voz: z.string().trim().regex(/^[a-z0-9_-]{2,40}$/, 'la voz va en minúsculas, como «eve»').default('eve'),
  /** Para entender mejor lo que dice el cliente. xAI pide la variante regional en español: «es-CO», «es-MX». */
  idioma: z.string().trim().regex(/^[a-z]{2}-[A-Z]{2}$/, 'el idioma va como «es-CO»').default('es-CO'),
});

export const AgenteSchema = z.object({
  id: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,29}$/, 'el id va en minúsculas y guiones, como «soporte»'),
  nombre: z.string().trim().min(2, 'el nombre lleva al menos dos letras').max(40),
  activo: z.boolean().default(true),
  atiende: z.array(z.enum(AREAS)).min(1, 'elige al menos una cosa que atiende'),
  canales: z.array(z.enum(CANALES_DE_AGENTE)).min(1, 'elige al menos un canal'),
  instrucciones: z.string().max(1500, 'las instrucciones van hasta 1.500 letras').default(''),
  voz: Voz.optional(),
});
export type Agente = z.infer<typeof AgenteSchema>;

export const NOMBRE_DEL_AREA: Record<Area, string> = { ventas: 'ventas', soporte: 'soporte', agenda: `la agenda de ${V.citas}`, informacion: 'información' };

/** El de siempre: el asistente del negocio, que atiende todo por WhatsApp y el chat. */
export function agentePrincipal(): Agente {
  return { id: 'principal', nombre: business.agent.name, activo: true, atiende: [...AREAS], canales: ['whatsapp', 'web'], instrucciones: '' };
}

/** Los que se configuraron en el tablero (vacío si nadie lo ha hecho). */
export function agentesConfigurados(): Agente[] {
  const crudos = getSetting<unknown[]>('agentes', []);
  const out: Agente[] = [];
  for (const c of Array.isArray(crudos) ? crudos : []) {
    const r = AgenteSchema.safeParse(c);
    if (r.success) out.push(r.data);
  }
  return out;
}

/** Los agentes del negocio: los configurados, o el principal si no hay ninguno. */
export function agentes(): Agente[] {
  const c = agentesConfigurados();
  return c.length ? c : [agentePrincipal()];
}

/** Guarda la lista entera, todo o nada: si algo no sirve, no se guarda nada y se dice qué y dónde. */
export function guardarAgentes(entrada: unknown): { agentes: Agente[] } | { error: string; campo: string } {
  if (!Array.isArray(entrada)) return { error: 'llega una lista de agentes', campo: 'agentes' };
  if (entrada.length > 12) return { error: 'van hasta doce agentes', campo: 'agentes' };
  const lista: Agente[] = [];
  for (let i = 0; i < entrada.length; i++) {
    const r = AgenteSchema.safeParse(entrada[i]);
    if (!r.success) {
      const p = r.error.issues[0]!;
      return { error: `Agente ${i + 1}: ${p.message}`, campo: `agentes.${i}.${p.path.join('.')}` };
    }
    // Un agente de voz sin voz elegida toma la de fábrica.
    const hablado = r.data.canales.includes('voz') || r.data.canales.includes('telefono');
    const a = hablado && !r.data.voz ? { ...r.data, voz: Voz.parse({}) } : r.data;
    if (lista.some((x) => x.id === a.id)) return { error: `Agente ${i + 1}: ya hay otro con el id «${a.id}»`, campo: `agentes.${i}.id` };
    lista.push(a);
  }
  if (lista.length && !lista.some((a) => a.activo)) return { error: 'deja al menos un agente activo (o borra todos para volver al de siempre)', campo: 'agentes' };
  setSetting('agentes', lista);
  return { agentes: lista };
}

/**
 * Quién saluda en un canal antes de que el cliente diga nada: el que lleva información ahí, o el primero que lo
 * atiende. Es el mismo que va a contestar un saludo (agenteParaMensaje), así que el nombre no cambia en el camino.
 */
export function nombreParaCanal(canal: CanalDeAgente): string {
  const delCanal = agentesConfigurados().filter((a) => a.activo && a.canales.includes(canal));
  return (delCanal.find((a) => a.atiende.includes('informacion')) ?? delCanal[0])?.nombre ?? business.agent.name;
}

// ---------- de qué trata un mensaje ----------
// Por reglas y sin modelo: es para escoger quién atiende, no para entender el mensaje (eso lo hace el agente).
const SOPORTE = /\b(no (me )?(funciona|sirve|carga|abre|sincroniza|deja|aparece|llega|responde)|fall[aó]|falla|error|se (cay[oó]|cae|trab[oó]|traba|colg[oó])|ca[ií]d[oa]|soporte|ticket|reclamo|queja|da[ñn]ad[oa]|problema|bug|lent[oa]|no puedo (entrar|ingresar|acceder)|garant[ií]a)/i;
const VENTAS = /\b(precios?|cu[aá]nto (cuesta|vale|sale|cobran)|comprar|compra|cotiza|cotizaci[oó]n|planes|tarifa|descuento|contratar|adquirir|presupuesto|me interesa)/i;
function agendaRe(): RegExp {
  const voc = [V.cita, V.citas].map((x) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase());
  return new RegExp(`\\b(agendar|agenda|reservar|reserva|reagendar|cancelar|horarios? disponibles?|espacio libre|${voc.join('|')})\\b`, 'i');
}

/** De qué trata el mensaje, o null si no se nota (un saludo, un «gracias»). */
export function areaDe(texto: string): Area | null {
  const t = texto.normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (SOPORTE.test(texto) || SOPORTE.test(t)) return 'soporte';
  if (agendaRe().test(t)) return 'agenda';
  if (VENTAS.test(texto) || VENTAS.test(t)) return 'ventas';
  return null;
}

// ---------- quién atiende cada conversación ----------
let tabla = false;
function db() {
  const d = getDb();
  if (!tabla) {
    d.exec('CREATE TABLE IF NOT EXISTS agente_de_conversacion (user_id TEXT PRIMARY KEY, agente TEXT NOT NULL, desde INTEGER NOT NULL)');
    tabla = true;
  }
  return d;
}
export function agenteGuardado(userId: string): string | null {
  return (db().prepare('SELECT agente FROM agente_de_conversacion WHERE user_id = ?').get(userId) as { agente: string } | undefined)?.agente ?? null;
}
function guardarAgenteDe(userId: string, agente: string, now: number): void {
  db().prepare('INSERT INTO agente_de_conversacion (user_id, agente, desde) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET agente = excluded.agente, desde = excluded.desde').run(userId, agente, now);
}

export const canalDeAgente = (canal: string): CanalDeAgente | null => (canal === 'whatsapp' || canal === 'meta' ? 'whatsapp' : canal === 'web' ? 'web' : canal === 'voz' ? 'voz' : canal === 'telefono' ? 'telefono' : null);

export interface Asignacion {
  agente: Agente;
  /** Si la conversación venía con otro agente y la toma este: quién la llevaba. */
  antes: Agente | null;
  area: Area | null;
}

/**
 * Quién atiende este mensaje. Se queda el de la conversación mientras atienda el tema; si el tema es de otro
 * agente del mismo canal, lo toma ese. Sin agentes configurados, siempre el principal (y no se guarda nada).
 */
export function agenteParaMensaje(userId: string, canal: string, texto: string, now = Date.now()): Asignacion {
  const configurados = agentesConfigurados();
  const area = areaDe(texto);
  if (!configurados.length) return { agente: agentePrincipal(), antes: null, area };
  const c = canalDeAgente(canal);
  const delCanal = configurados.filter((a) => a.activo && c && a.canales.includes(c));
  // Un canal que ningún agente atiende (el negocio los configuró solo para voz, por ejemplo) lo atiende el
  // primero activo: dejar a alguien sin respuesta por una casilla sin marcar sería peor.
  const lista = delCanal.length ? delCanal : configurados.filter((a) => a.activo);
  const idActual = agenteGuardado(userId);
  const actual = lista.find((a) => a.id === idActual) ?? null;
  if (actual && (!area || actual.atiende.includes(area))) return { agente: actual, antes: null, area };
  const elegido = (area && lista.find((a) => a.atiende.includes(area))) || actual || lista.find((a) => a.atiende.includes('informacion')) || lista[0]!;
  if (elegido.id !== idActual) guardarAgenteDe(userId, elegido.id, now);
  const antes = idActual ? (configurados.find((a) => a.id === idActual) ?? null) : null;
  return { agente: elegido, antes: antes && antes.id !== elegido.id ? antes : null, area };
}

/** Lo que el agente le suma a la persona: quién es, qué atiende y sus instrucciones. Fijo por agente (va en caché). */
export function loSuyo(a: Agente): string {
  if (a.id === 'principal' && !a.instrucciones) return '';
  const atiende = a.atiende.map((x) => NOMBRE_DEL_AREA[x]).join(', ');
  return `## Lo tuyo\nAtiendes ${atiende}. Si el cliente necesita otra cosa, ayúdale con lo que puedas o pásalo a una persona del equipo.${a.instrucciones.trim() ? `\n${a.instrucciones.trim()}` : ''}`;
}

/** La nota del turno cuando un agente toma la conversación de otro. */
export function notaDeRelevo(asig: Asignacion): string | null {
  if (!asig.antes) return null;
  return `Esta conversación la llevaba ${asig.antes.nombre}; ahora la atiendes tú, ${asig.agente.nombre}${asig.area ? `, porque es de ${NOMBRE_DEL_AREA[asig.area]}` : ''}. Preséntate en una frase («te atiende ${asig.agente.nombre}») y sigue con lo que necesita.`;
}
