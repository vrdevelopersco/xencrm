// Análisis comercial por turno: sentimiento, interés, urgencia, objeciones y datos capturados,
// con un puntaje explicable de probabilidad de cita/venta. Corre en segundo plano tras cada respuesta.
import { business } from '../config.js';
import { classify, roleEngine, fallbackOrder, iaAgotada } from '../llm/engines.js';
import { openaiModel } from '../llm/openai.js';
import type { SchemaSpec } from '../llm/apple.js';
import { getHistory, getMessages, type StoredMessage } from '../agent/memory.js';
import { getDb } from '../rag/store.js';
import { etapaCon, rolDe, getContact, setStage, updateContact, type Contact, type ScoreFactor, type Stage } from './contacts.js';
import { emitEvent } from './events.js';
import { nextAppointmentFor } from './appointments.js';
import { isTrivial, ruleSignals } from './signals.js';

export interface Signals {
  sentimiento: 'positivo' | 'neutral' | 'negativo';
  interes: number; // 0..3
  urgencia: 'baja' | 'media' | 'alta';
  quiere_cita: boolean;
  pidio_precio: boolean;
  menciono_presupuesto: boolean;
  tiene_objecion: boolean;
  objecion: string;
  presupuesto: string;
  nombre: string;
  ciudad: string;
  telefono: string;
  resumen: string;
  [custom: string]: string | number | boolean;
}

function schema(): SchemaSpec {
  const custom = business.crm.fields.map((f) => ({ name: f.name, type: 'string' as const, description: `${f.description}. Vacío si no lo dijo.` }));
  return {
    properties: [
      { name: 'sentimiento', type: 'string', enum: ['positivo', 'neutral', 'negativo'], description: 'Ánimo del cliente en sus últimos mensajes' },
      { name: 'interes', type: 'integer', description: '0 = ninguno, 1 = curiosidad, 2 = interés claro, 3 = quiere comprar o agendar ya' },
      { name: 'urgencia', type: 'string', enum: ['baja', 'media', 'alta'] },
      { name: 'quiere_cita', type: 'boolean', description: 'Pidió o aceptó una cita, visita o toma de medidas' },
      { name: 'pidio_precio', type: 'boolean' },
      { name: 'menciono_presupuesto', type: 'boolean' },
      { name: 'tiene_objecion', type: 'boolean', description: 'Expresó un obstáculo que frena la compra: le parece caro, no le da el tiempo, le queda lejos, desconfía. Preguntar algo (precio, proceso, horario) no es una objeción' },
      { name: 'objecion', type: 'string', description: 'El obstáculo en pocas palabras, o vacío' },
      { name: 'presupuesto', type: 'string', description: 'Como lo dijo el cliente, o vacío' },
      { name: 'nombre', type: 'string', description: 'Nombre del cliente si lo dijo, o vacío' },
      { name: 'ciudad', type: 'string', description: 'Ciudad o zona donde está el cliente, si él la dijo (no la del negocio), o vacío' },
      { name: 'telefono', type: 'string', description: 'Teléfono si lo dio, o vacío' },
      ...custom,
      { name: 'resumen', type: 'string', description: 'Una frase de máximo 15 palabras con lo que los demás campos no dicen: qué le importa y en qué quedó' },
    ],
  };
}

function instructions(): string {
  return `Eres el analista comercial de "${business.business.name}" (${business.business.description}).
Lees la conversación entre el asistente y un cliente y extraes señales de venta con criterio: solo afirmas lo que el cliente dijo o dejó claro.
La fecha u hora de una cita en el negocio no es la fecha del evento del cliente (su boda, su grado): no las confundas.
Los campos en blanco ("") significan "no lo dijo". Responde SOLO con el JSON.`;
}

const line = (m: { role: string; content: string }) => `${m.role === 'user' ? 'Cliente' : 'Asistente'}: ${m.content.replace(/\s+/g, ' ').slice(0, 400)}`;

function transcript(userId: string): string {
  return getHistory(userId, 8).map(line).join('\n');
}

function emptySignals(): Signals {
  const s: Signals = {
    sentimiento: 'neutral',
    interes: 0,
    urgencia: 'baja',
    quiere_cita: false,
    pidio_precio: false,
    menciono_presupuesto: false,
    tiene_objecion: false,
    objecion: '',
    presupuesto: '',
    nombre: '',
    ciudad: '',
    telefono: '',
    resumen: '',
  };
  for (const field of business.crm.fields) s[field.name] = '';
  return s;
}

function lastAnalysis(userId: string): { ts: number; signals: Signals } | null {
  const r = getDb().prepare('SELECT ts, signals FROM analyses WHERE user_id = ? ORDER BY ts DESC LIMIT 1').get(userId) as { ts: number; signals: string } | undefined;
  return r ? { ts: r.ts, signals: { ...emptySignals(), ...(JSON.parse(r.signals || '{}') as Signals) } } : null;
}

/** Ficha anterior + solo lo nuevo (con el mensaje previo como contexto), en vez de toda la conversación. */
function incrementalPrompt(prev: Signals, messages: StoredMessage[], since: number): string {
  const first = messages.findIndex((m) => m.ts > since);
  const window = messages.slice(Math.max(0, first - 1)).slice(-16);
  const ficha = Object.entries(prev)
    .filter(([, v]) => v !== '' && v !== false)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join('\n');
  return `Ficha actual del cliente (de lo que dijo antes):\n${ficha || '(vacía)'}\n\nMensajes nuevos:\n${window.map(line).join('\n')}\n\nActualiza la ficha con los mensajes nuevos: conserva lo que siga vigente y cambia lo que ahora sea distinto. El ánimo, el interés y la urgencia son los de ahora; el resumen cubre toda la conversación.`;
}

// Datos que no se "olvidan" si el modelo no los repite al actualizar: una vez dichos, siguen siendo ciertos.
const STICKY_TEXT = ['nombre', 'ciudad', 'telefono', 'presupuesto'];
const STICKY_FLAGS = ['pidio_precio', 'menciono_presupuesto', 'quiere_cita'] as const;

/**
 * Puntaje 0-100 con factores explicables. Los pesos son un estimado calibrado con lo que hay (10 conversaciones
 * reales de DUNOR, 3 con cita, 1 venta): pedir cita, el interés declarado, la urgencia y tener claro qué quiere
 * son lo que de verdad aparece antes de una cita; dar el nombre o preguntar el precio aparecían igual o más en
 * los que no agendaron. El descuento por silencio no va aquí: se aplica al leer la ficha (`crm/score.ts`), porque
 * el puntaje solo se recalcula cuando llega un mensaje y si no se quedaría congelado en su mejor momento.
 */
export function computeScore(c: Contact, s: Signals, opts: { hasAppointment: boolean }): { score: number; factors: ScoreFactor[] } {
  const f: ScoreFactor[] = [];
  const add = (label: string, points: number, when = true) => {
    if (when && points !== 0) f.push({ label, points });
  };
  add('Cita agendada', 40, opts.hasAppointment);
  add('Pidió cita', 30, !opts.hasAppointment && s.quiere_cita);
  add('Quiere comprar o agendar ya', 20, s.interes >= 3);
  add('Interés claro', 10, s.interes === 2);
  add('Curiosidad', 3, s.interes === 1);
  add('Preguntó precio', 6, s.pidio_precio);
  add('Mencionó presupuesto', 8, s.menciono_presupuesto || Boolean(s.presupuesto));
  add('Urgencia alta', 10, s.urgencia === 'alta');
  add('Urgencia media', 4, s.urgencia === 'media');
  add('Dio su nombre', 2, Boolean(s.nombre || c.name));
  add('Dio ciudad o teléfono', 2, Boolean(s.ciudad || s.telefono || c.phone));
  // Saber qué quiere pesa, pero el cuarto dato no vale lo mismo que el primero: 4, 3, 2, 1…
  let captured = 0;
  for (const field of business.crm.fields) {
    if (!s[field.name]) continue;
    add(`Dijo ${field.name.replace(/_/g, ' ')}`, Math.max(1, 4 - captured));
    captured++;
  }
  add('Conversación sostenida', 5, c.messageCount >= 4);
  add('Ánimo positivo', 5, s.sentimiento === 'positivo');
  add('Ánimo negativo', -15, s.sentimiento === 'negativo');
  add('Tiene una objeción', -10, s.tiene_objecion);
  const score = Math.max(0, Math.min(100, f.reduce((a, b) => a + b.points, 0)));
  return { score, factors: f };
}

export function temperature(score: number): 'caliente' | 'tibio' | 'frio' {
  return score >= 60 ? 'caliente' : score >= 30 ? 'tibio' : 'frio';
}

// El embudo es el del negocio (crm.stages): aquí se decide por el papel de cada etapa, no por su nombre.
function nextStage(c: Contact, s: Signals, score: number, hasAppointment: boolean): Stage {
  const rol = rolDe(c.stage);
  if (c.stageLocked || rol === 'ganado' || rol === 'perdido') return c.stage;
  const conCita = etapaCon('cita');
  if (hasAppointment && conCita) return conCita;
  if (rol === 'cita') return c.stage;
  const interes = etapaCon('interes');
  if (interes && (score >= 40 || s.interes >= 2)) return interes;
  const activo = etapaCon('activo');
  if (activo && rol === 'inicio' && c.messageCount >= 1) return activo;
  return c.stage;
}

const running = new Set<string>();
// Mensajes que llegaron mientras se analizaba: al terminar se repite con la conversación completa.
const rerun = new Set<string>();

/**
 * Analiza la conversación de un contacto y actualiza ficha, puntaje y etapa. Idempotente y en segundo plano.
 * Si lo nuevo son pasos de la cita o cortesías, no llama al modelo: el código actualiza lo que sabe y recalcula.
 * `full` (botón "Reanalizar" del tablero) manda la conversación completa al modelo.
 */
export async function analyzeContact(userId: string, opts: { full?: boolean } = {}): Promise<void> {
  if (running.has(userId)) {
    rerun.add(userId);
    return;
  }
  running.add(userId);
  try {
    const c = getContact(userId);
    if (!c || c.messageCount === 0) return;
    const prev = lastAnalysis(userId);
    const messages = getMessages(userId, 60);
    const newCustomer = messages.filter((m) => m.role === 'user' && (!prev || m.ts > prev.ts));
    if (prev && !newCustomer.length && !opts.full) return;
    const rules = ruleSignals(newCustomer.map((m) => m.content));
    const hasAppointment = Boolean(nextAppointmentFor(userId)) || rolDe(c.stage) === 'cita';
    const inBooking = Boolean(c.data.booking);

    let s: Signals;
    let engineUsed = '';
    // 🪤 Con el tope de gasto alcanzado y sin motor de la máquina, la ficha sigue al día con lo que sabe el código
    // (teléfono, presupuesto, cita, puntaje), igual que con una cortesía: sin esto, cada análisis fallaba en
    // silencio y la ficha se quedaba congelada en el último mensaje antes del tope.
    if ((!opts.full && newCustomer.every(isTrivial)) || iaAgotada()) {
      s = { ...(prev?.signals ?? emptySignals()) };
      engineUsed = 'reglas';
    } else {
      const incremental = prev && !opts.full;
      const prompt = incremental ? incrementalPrompt(prev.signals, messages, prev.ts) : `Conversación:\n${transcript(userId)}\n\nExtrae las señales del cliente.`;
      let raw: string | undefined;
      for (const engine of fallbackOrder(roleEngine('analysis'))) {
        try {
          raw = await classify(engine, { sessionId: 'analysis', instructions: instructions(), prompt, schema: schema(), maxTurns: 1, role: 'analysis', userId });
          engineUsed = engine === 'openai' ? `openai:${openaiModel('analysis')}` : engine;
          break;
        } catch (err) {
          console.warn(`[crm] análisis con ${engine} falló: ${(err as Error).message}`);
        }
      }
      if (!raw) return;
      let parsed: Partial<Signals>;
      try {
        parsed = JSON.parse(raw) as Partial<Signals>;
      } catch {
        console.warn('[crm] análisis devolvió JSON inválido');
        return;
      }
      s = {
        sentimiento: (['positivo', 'neutral', 'negativo'] as const).includes(parsed.sentimiento as 'neutral') ? (parsed.sentimiento as Signals['sentimiento']) : 'neutral',
        interes: Math.max(0, Math.min(3, Number(parsed.interes ?? 0) || 0)),
        urgencia: (['baja', 'media', 'alta'] as const).includes(parsed.urgencia as 'baja') ? (parsed.urgencia as Signals['urgencia']) : 'baja',
        quiere_cita: Boolean(parsed.quiere_cita),
        pidio_precio: Boolean(parsed.pidio_precio),
        menciono_presupuesto: Boolean(parsed.menciono_presupuesto),
        tiene_objecion: Boolean(parsed.tiene_objecion),
        objecion: String(parsed.objecion ?? '').trim(),
        presupuesto: String(parsed.presupuesto ?? '').trim(),
        nombre: String(parsed.nombre ?? '').trim(),
        ciudad: String(parsed.ciudad ?? '').trim(),
        telefono: String(parsed.telefono ?? '').trim(),
        resumen: String(parsed.resumen ?? '').trim(),
      };
      for (const field of business.crm.fields) s[field.name] = String((parsed as Record<string, unknown>)[field.name] ?? '').trim();
      if (incremental) {
        for (const k of [...STICKY_TEXT, ...business.crm.fields.map((f) => f.name)]) if (!s[k] && prev.signals[k]) s[k] = prev.signals[k]!;
        for (const k of STICKY_FLAGS) s[k] = s[k] || prev.signals[k];
        if (!s.resumen) s.resumen = prev.signals.resumen;
      }
    }

    // Lo exacto lo pone el código: teléfono, presupuesto, si preguntó precio y si pidió o tiene cita.
    if (rules.telefono) s.telefono = rules.telefono;
    if (rules.presupuesto) {
      s.presupuesto = rules.presupuesto;
      s.menciono_presupuesto = true;
    }
    if (rules.pidioPrecio) s.pidio_precio = true;
    if (inBooking || hasAppointment) {
      s.quiere_cita = true;
      s.interes = Math.max(s.interes, 3);
    }

    // Datos capturados: lo nuevo no vacío pisa lo anterior; lo demás se conserva.
    const data: Record<string, unknown> = { ...c.data };
    const capture: Record<string, string> = { presupuesto: s.presupuesto, ciudad: s.ciudad, telefono: s.telefono, objecion: s.objecion, nombre: s.nombre };
    for (const field of business.crm.fields) capture[field.name] = String(s[field.name] ?? '');
    for (const [k, v] of Object.entries(capture)) if (v) data[k] = v;
    if (rules.correo) data.correo = rules.correo;
    data.urgencia = s.urgencia;
    data.interes = s.interes;

    const { score, factors } = computeScore(c, s, { hasAppointment });
    const stage = nextStage(c, s, score, hasAppointment);

    getDb()
      .prepare('INSERT INTO analyses (user_id, ts, engine, sentiment, signals, score, factors) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(userId, Date.now(), engineUsed, s.sentimiento, JSON.stringify(s), score, JSON.stringify(factors));

    updateContact(
      userId,
      {
        score,
        scoreFactors: factors,
        sentiment: s.sentimiento,
        summary: s.resumen || c.summary,
        data,
        ...(s.nombre && !c.name ? { name: s.nombre } : {}),
        ...(s.telefono && !c.phone ? { phone: s.telefono } : {}),
      },
      { silent: true },
    );
    if (stage !== c.stage) setStage(userId, stage, { by: 'bot' });
    const fresh = getContact(userId);
    emitEvent('analysis', userId, { contact: fresh, signals: s, engine: engineUsed, prevScore: c.score, score });
    console.log(`[crm] ${userId.slice(0, 18)} ${s.sentimiento} · interés ${s.interes} · score ${score} (${temperature(score)}) · etapa ${stage} · ${engineUsed}`);
  } catch (err) {
    console.warn('[crm] análisis falló:', (err as Error).message);
  } finally {
    running.delete(userId);
    if (rerun.delete(userId)) void analyzeContact(userId);
  }
}

const scheduled = new Map<string, { timer: NodeJS.Timeout; since: number }>();
/**
 * Analiza cuando la conversación queda en silencio (crm.analysisQuietSeconds) y, si sigue activa, a más tardar
 * crm.analysisMaxWaitSeconds después del primer mensaje sin analizar. Así una conversación de 10 mensajes paga
 * uno o dos análisis y no diez, y el análisis no compite con la respuesta siguiente.
 */
export function scheduleAnalysis(userId: string) {
  const quiet = business.crm.analysisQuietSeconds * 1000;
  const maxWait = business.crm.analysisMaxWaitSeconds * 1000;
  const prev = scheduled.get(userId);
  if (prev) clearTimeout(prev.timer);
  const since = prev?.since ?? Date.now();
  const delay = Math.max(0, Math.min(quiet, since + maxWait - Date.now()));
  const timer = setTimeout(() => {
    scheduled.delete(userId);
    void analyzeContact(userId);
  }, delay);
  timer.unref();
  scheduled.set(userId, { timer, since });
}

/** Corre ya lo que estaba esperando silencio (de un contacto o de todos). */
export function flushAnalyses(userId?: string): void {
  for (const [id, s] of [...scheduled]) {
    if (userId && id !== userId) continue;
    clearTimeout(s.timer);
    scheduled.delete(id);
    void analyzeContact(id);
  }
}

/** Corre lo pendiente y espera a que no quede ningún análisis en curso (escenarios y repasos). */
export async function analysesSettled(timeoutMs = 120_000): Promise<boolean> {
  flushAnalyses();
  const until = Date.now() + timeoutMs;
  while (scheduled.size || running.size) {
    if (Date.now() > until) return false;
    await new Promise((r) => setTimeout(r, 250));
  }
  return true;
}

export function listAnalyses(userId: string, limit = 20) {
  const rows = getDb().prepare('SELECT id, ts, engine, sentiment, signals, score, factors FROM analyses WHERE user_id = ? ORDER BY ts DESC LIMIT ?').all(userId, limit) as {
    id: number;
    ts: number;
    engine: string;
    sentiment: string;
    signals: string;
    score: number;
    factors: string;
  }[];
  return rows.map((r) => ({ ...r, signals: JSON.parse(r.signals || '{}'), factors: JSON.parse(r.factors || '[]') })).reverse();
}
