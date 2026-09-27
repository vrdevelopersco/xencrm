import { business, env } from '../config.js';
import { soloEscucha, type ChannelId } from '../channels/switches.js';
import { businessSheet, retrieve, formatContext } from '../rag/retriever.js';
import { getDocs, productsMentionedIn, type ScoredDoc } from '../rag/store.js';
import { generate, estimateTokens, fallbackOrder, type Engine } from '../llm/engines.js';
import { openaiModel } from '../llm/openai.js';
import { appendMessage, clearHistory, getHistory, touchUser } from './memory.js';
import { classify } from './gate.js';
import { chooseEngine } from './router.js';
import { claimsBooked, dropRepeatedFacts, isHonest, postProcess, stripRepeatedGreeting, touchesPending, unsupportedAnswer, ungroundedNumbers } from './format.js';
import { pendingTopics } from '../profile.js';
import { openVerification, saysWillVerify } from '../crm/verifications.js';
import { ERROR_REPLIES, HUMAN_REPLIES, OUT_OF_SCOPE_REPLIES, personaPrompt, pick, type Intent } from './prompts.js';
import { crossChannelGreeting } from '../crm/cross.js';
import { getContact, purgeContact, setHumanMode, updateContact } from '../crm/contacts.js';
import { emitEvent } from '../crm/events.js';
import { scheduleAnalysis } from '../crm/analyzer.js';
import { bookingStep, hasBookingInProgress, manageIntent, startBooking } from '../crm/booking.js';
import { nextAppointmentFor } from '../crm/appointments.js';

export type Channel = 'whatsapp' | 'meta' | 'web' | 'cli' | 'mcp';

export interface IncomingMessage {
  userId: string; // identificador estable por canal (jid de WhatsApp, sessionId web...)
  channel: Channel;
  text: string;
  userName?: string | null;
}

export interface AgentReply {
  text: string;
  /** true cuando la conversación está en manos de una persona: no hay respuesta automática. */
  silent?: boolean;
  intent: Intent;
  /** Quién generó la respuesta: un motor, una plantilla, o nadie (error / modo humano). */
  engine: Engine | 'template' | 'none';
  /** Modelo de OpenAI que respondió (vacío con motores locales). */
  model?: string;
  /** Rol que atendió el turno cuando lo respondió el motor elegido por el enrutador. */
  role?: 'light' | 'heavy';
  /** Motivo de la ruta elegida (para logs y la batería de escenarios). */
  route: string;
  gateVia: string;
  sources: { title: string; url: string | null; kind: string }[];
  ms: number;
}

// Señales de lo que pide el cliente dentro de una compra (para orientar al modelo en ese turno).
const DETAILS_RE = /informaci[oó]n|especificaci|detalle|caracter[ií]stica|cuidad|c[oó]mo se (usa|cuida|riega|hace|confecciona)|(?<!a la )medida|tama[ñn]o|material|tela|de qu[eé] (es|est[aá]|tama)|qu[eé] (trae|incluye)|descri|cu[aá]nto (tarda|demora)/i;
const STOCK_RE = /\b(stock|disponible|disponibilidad|hay|tienen|queda[n]?)\b/i;
// "¿Cómo funciona?", "¿qué tengo que hacer?": el cliente quiere el proceso, no solo el producto.
const PROCESS_RE = /c[oó]mo (funciona|es el proceso|se hace|se pide|se compra|se agenda|empiezo|empezamos|lo hacemos)|qu[eé] (tengo|debo|hay) que hacer|cu[aá]les son los pasos|paso a paso/i;
// Si el cliente no pregunta por precio ni enlace, no hay que repetir los del turno anterior.
const ASKS_PRICE_OR_LINK_RE = /cu[aá]nto|\bvale|cuesta|costo|precio|tarifa|valor|link|enlace|url|d[oó]nde (lo|la) (veo|compro)/i;
// Seguimientos que dependen del producto recién mencionado ("y cómo se cuida?", "la tienen en rojo?", "qué trae?").
const FOLLOWUP_START_RE = /^(y |e |o |c[oó]mo|qu[eé]|cu[aá]nto|cu[aá]l|la |el |es[aeo]|est[aeo]|tiene|trae|viene|sirve|se puede|me pasas|dame|pásame|link|enlace|precio)\b/i;

// Cola por usuario: garantiza que los mensajes de una misma persona se procesan en orden.
const queues = new Map<string, Promise<unknown>>();
// Último motor que respondió a cada usuario: si cambia, Apple rehace su sesión con el historial.
const lastEngine = new Map<string, Engine>();
// Último rol que respondió: un seguimiento corto tras una recomendación sigue con el rol pesado.
const lastRole = new Map<string, 'light' | 'heavy'>();

export function handleMessage(msg: IncomingMessage): Promise<AgentReply> {
  const prev = queues.get(msg.userId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(() => process(msg));
  queues.set(msg.userId, next);
  next.finally(() => {
    if (queues.get(msg.userId) === next) queues.delete(msg.userId);
  });
  return next;
}

function recordCustomerMessage(userId: string, text: string, intent?: string) {
  const id = appendMessage(userId, 'user', text, intent, 'customer');
  const c = getContact(userId);
  if (c) updateContact(userId, { unread: c.unread + 1 }, { silent: true });
  emitEvent('message', userId, { id, role: 'user', author: 'customer', content: text, intent: intent ?? null, ts: Date.now() });
}

function recordBotReply(userId: string, text: string) {
  const id = appendMessage(userId, 'assistant', text, undefined, 'bot');
  emitEvent('message', userId, { id, role: 'assistant', author: 'bot', content: text, ts: Date.now() });
}

async function process(msg: IncomingMessage): Promise<AgentReply> {
  const started = Date.now();
  const text = msg.text.trim();
  const user = touchUser(msg.userId, msg.channel, msg.userName);
  const contact = getContact(msg.userId);
  const base = { sources: [] as AgentReply['sources'], route: '', gateVia: '' };
  // Si venía hablando por otro canal, se le dice una vez (y el historial de allá ya entró en el contexto). Se
  // resuelve al responder: si la conversación la tiene una persona, no hay respuesta y no se da por dicho.
  let crossNote: string | null | undefined;
  const finish = (answer: string, intent: Intent, engine: AgentReply['engine'], extra: Partial<AgentReply> = {}): AgentReply => {
    if (crossNote === undefined) crossNote = contact ? crossChannelGreeting(msg.userId) : null;
    const reply = crossNote ? `${crossNote}\n\n${answer}` : answer;
    recordCustomerMessage(msg.userId, text, intent);
    recordBotReply(msg.userId, reply);
    scheduleAnalysis(msg.userId);
    const ms = Date.now() - started;
    console.log(`[agent] ${msg.channel}:${msg.userId.slice(0, 14)} intent=${intent}(${extra.gateVia ?? 'rule'}) engine=${engine}${extra.model ? `:${extra.model}` : ''}${extra.route ? ` [${extra.route}]` : ''} ${ms}ms`);
    return { ...base, text: reply, intent, engine, ms, ...extra };
  };

  if (text === '/reset') {
    // Borra todo lo del contacto (historial, ficha, citas): es un comando de pruebas.
    clearHistory(msg.userId);
    lastEngine.delete(msg.userId);
    lastRole.delete(msg.userId);
    if (contact) purgeContact(msg.userId);
    return { ...base, text: 'Listo, empezamos de cero 🙂', intent: 'saludo', engine: 'template', ms: Date.now() - started };
  }

  // El canal está en «solo escuchar»: entra todo al CRM, contesta una persona. Se corta aquí, antes del
  // modelo, así que además no cuesta nada.
  if (soloEscucha(msg.channel as ChannelId)) {
    recordCustomerMessage(msg.userId, text, 'humano');
    scheduleAnalysis(msg.userId);
    console.log(`[agent] ${msg.channel}:${msg.userId.slice(0, 14)} canal en solo escuchar, sin respuesta automática`);
    return { ...base, text: '', silent: true, intent: 'humano', engine: 'none', route: 'solo escuchar', ms: Date.now() - started };
  }

  // Una persona del equipo tiene la conversación: se registra y analiza, pero no se responde.
  if (contact?.humanMode) {
    recordCustomerMessage(msg.userId, text, 'humano');
    scheduleAnalysis(msg.userId);
    console.log(`[agent] ${msg.channel}:${msg.userId.slice(0, 14)} en modo humano, sin respuesta automática`);
    return { ...base, text: '', silent: true, intent: 'humano', engine: 'none', route: 'modo humano', ms: Date.now() - started };
  }

  // Flujo de cita en curso: fechas y horas las maneja un flujo determinista, no el modelo.
  if (hasBookingInProgress(msg.userId)) {
    const step = await bookingStep(msg.userId, text);
    if (step !== null) return finish(step, 'cita', 'template', { route: 'flujo de cita' });
  }

  // "Quiero cancelar mi cita", "¿la puedo pasar para el jueves?": si tiene una cita próxima, lo maneja el flujo de citas
  // (con confirmación), nunca el modelo, que podría decir "listo, cancelada" sin haberlo hecho.
  if (business.appointments.enabled && manageIntent(text, { strict: true }) && nextAppointmentFor(msg.userId)) {
    return finish(await startBooking(msg.userId, text), 'cita', 'template', { route: 'cambiar o cancelar cita' });
  }

  const history = getHistory(msg.userId);
  const gate = await classify(text, history, msg.userId);

  if (gate.intent === 'fuera_de_alcance') return finish(pick(OUT_OF_SCOPE_REPLIES), gate.intent, 'template', { gateVia: gate.via });
  if (gate.intent === 'cita') return finish(await startBooking(msg.userId, text), gate.intent, 'template', { gateVia: gate.via, route: 'flujo de cita' });
  if (gate.intent === 'humano') {
    const reply = finish(pick(HUMAN_REPLIES), gate.intent, 'template', { gateVia: gate.via, route: 'traspaso a humano' });
    setHumanMode(msg.userId, true, 'bot'); // a partir de aquí el bot se calla hasta que el equipo lo devuelva
    return reply;
  }

  const query = gate.query || text;
  let products: ScoredDoc[] = [];
  let knowledge: ScoredDoc[] = [];
  try {
    if (gate.intent === 'compra') {
      [products, knowledge] = await Promise.all([
        retrieve(query, { kinds: ['product'], k: 4 }),
        retrieve(query, { kinds: ['knowledge'], k: 2, minSim: 0.5 }),
      ]);
    } else if (gate.intent === 'info_tienda') {
      [knowledge, products] = await Promise.all([
        retrieve(query, { kinds: ['knowledge'], k: 4 }),
        retrieve(query, { kinds: ['product'], k: 2, minSim: 0.55 }),
      ]);
    }
    if (PROCESS_RE.test(text)) {
      // Añade la explicación del proceso (cita, medidas, pruebas, tiempos) aunque la pregunta venga con un producto.
      const process = await retrieve('cómo funciona el proceso paso a paso, cita, pruebas y tiempos', { kinds: ['knowledge'], k: 2, minSim: 0.4 });
      knowledge = [...process, ...knowledge.filter((k) => !process.some((p) => p.id === k.id))].slice(0, 4);
    }
  } catch (err) {
    console.warn('[agent] retrieve falló, sigo sin contexto:', (err as Error).message);
  }
  // Seguimiento corto ("y cómo se cuida?", "la tienen en rojo?"): el cliente habla del producto que acaba de
  // mencionar el asistente. Se anclan esos productos al inicio del contexto para que la búsqueda no los desplace.
  if (gate.intent === 'compra' && text.split(/\s+/).length <= 8 && FOLLOWUP_START_RE.test(text)) {
    const lastAssistant = [...history].reverse().find((m) => m.role === 'assistant')?.content ?? '';
    const mentionedIds = productsMentionedIn(lastAssistant);
    const anchoredIds = mentionedIds.filter((id) => !products.some((p) => p.id === id));
    if (anchoredIds.length) {
      const docs = getDocs(anchoredIds.slice(0, 2));
      const anchored = [...docs.values()].map((d) => ({ ...d, score: 1, vectorSim: 1, ftsHit: true }));
      products = [...anchored, ...products].slice(0, 4);
    } else if (mentionedIds.length) {
      const mentioned = new Set(mentionedIds);
      products = [...products.filter((p) => mentioned.has(p.id)), ...products.filter((p) => !mentioned.has(p.id))];
    }
  }
  const sources = [...products, ...knowledge];

  const persona = personaPrompt();
  let note: string | undefined;
  const details = gate.intent === 'compra' && DETAILS_RE.test(text);
  if (details) {
    note =
      'El cliente pide información o detalles de un producto: usa la descripción y la ficha técnica completas (medidas, material, tiempos, qué incluye), en 3 a 6 frases naturales, sin lista de precio ni enlace. Si no nombra el producto, se refiere al último del que hablaron (el primero de la lista). No repitas nada que ya le hayas dicho; si ya diste la descripción corta, amplía con lo que falta. Si no hay más datos en la ficha, dilo con naturalidad y ofrece confirmar lo puntual con el equipo.';
  } else if (gate.intent === 'compra' && STOCK_RE.test(text)) {
    note = 'El cliente pregunta por disponibilidad: responde con el dato de "Disponibilidad" del producto; si no está en la lista, di que no lo tenemos.';
  } else if (PROCESS_RE.test(text)) {
    note = `El cliente pregunta cómo funciona: explica el proceso en 3 o 4 pasos cortos con la "Información de la tienda" (cita, medidas, pruebas, tiempos y pago), menciona la prenda que le interesa si la dijo, y termina ofreciendo agendar${business.appointments.enabled ? ' la cita por aquí mismo' : ''}. Sin listar precios salvo que los pida.`;
  }
  if (gate.intent === 'saludo') {
    note =
      user.messageCount === 0
        ? `Es el primer mensaje de este cliente: salúdalo, preséntate en una frase como ${business.agent.name} de ${business.business.name} y pregúntale en qué le puedes ayudar.`
        : 'El cliente solo saluda, agradece o se despide: responde en una o dos frases, cálido, sin ofrecer productos concretos ni enlaces.';
  }
  // Contexto completo para los motores grandes; recortado para Apple (ventana de 4096 tokens).
  const ctxOpts = { omitEmptyProducts: gate.intent !== 'compra' };
  const fullContext = formatContext(products, knowledge, ctxOpts);
  const liteContext = formatContext(products.slice(0, 3), knowledge.slice(0, 3), ctxOpts);
  const estimatedTokens = estimateTokens(persona + liteContext + text) + Math.min(history.length, 12) * 60;

  const chosen = chooseEngine({ intent: gate.intent, userText: text, estimatedTokens, lastRole: lastRole.get(msg.userId) });
  const order = fallbackOrder(chosen.engine);
  // Negocio chico + OpenAI: toda la información va fija al inicio del prompt (completa y desde la caché de OpenAI);
  // de la búsqueda solo queda una pista de qué es lo más relacionado con el mensaje.
  const maxSheet = business.agent.fullInfoMaxTokens;
  const sheet = maxSheet > 0 && order.includes('openai') ? businessSheet() : null;
  const useSheet = Boolean(sheet && sheet.tokens <= maxSheet);
  const related = [...new Set(sources.map((d) => d.title))].slice(0, 4);
  // Lo que el negocio marcó "por confirmar" en su perfil ("Zapatos"): ni sí ni no, se verifica. Se avisa antes de
  // generar para no gastar una respuesta que después hay que rehacer.
  const pendingHit = touchesPending(text, pendingTopics(), `${persona}\n${useSheet ? sheet!.text : fullContext}`);
  if (pendingHit) note = [note, `El negocio todavía no confirma «${pendingHit}»: no digas que sí ni que no; di que lo verificas con el equipo, con una frase como «${business.agent.verifyPhrase}».`].filter(Boolean).join('\n');
  const scope = business.business.description; // "No, somos moda masculina" se apoya en esto
  const hint = related.length ? `Lo más relacionado con este mensaje en la información: ${related.join('; ')}.` : '';
  let raw: string | undefined;
  let verifyTopic: string | null = null;
  let fakeBooking = false; // la respuesta daba por hecha una cita que no existe // lo que no sabía, si la guarda de afirmaciones lo detectó
  let engine: AgentReply['engine'] = 'none';
  let route = `${chosen.reason} → sin motor`;
  for (let i = 0; i < order.length; i++) {
    const e = order[i]!;
    const withSheet = useSheet && e === 'openai';
    try {
      const input = {
        sessionId: msg.userId,
        persona: withSheet ? `${persona}\n\n${sheet!.text}` : persona,
        context: withSheet ? '' : e === 'apple' ? liteContext : fullContext,
        note: withSheet ? [note, hint].filter(Boolean).join('\n') || undefined : note,
        customerName: user.name,
        userText: text,
        history,
        fresh: e === 'apple' && lastEngine.get(msg.userId) !== 'apple',
        temperature: env.temperature,
        role: chosen.role,
      };
      let candidate = await generate(e, input);
      // Verificación de cifras: un precio que no está en el contexto (ni lo dijo el cliente) es inventado -> probar el otro motor.
      const reference = [input.persona, input.context, text, ...history.slice(-4).map((m) => m.content)].join('\n');
      const bad = ungroundedNumbers(candidate, reference);
      if (bad.length && i < order.length - 1) {
        console.warn(`[agent] ${e} inventó cifras (${bad.join(', ')}); reintento con ${order[i + 1]}`);
        lastEngine.delete(msg.userId); // el turno se rehace: Apple no debe conservar esa respuesta en su sesión
        continue;
      }
      if (bad.length) console.warn(`[agent] ${e} respondió con cifras no fundamentadas: ${bad.join(', ')}`);
      // Afirmaciones sin respaldo: "¿tienen wifi?" → "Sí, tenemos wifi" sin que la información lo diga. Se rehace
      // pidiendo no suponer; si insiste, una respuesta fija y honesta.
      const grounding = `${input.persona}\n${input.context}`;
      // Un "sí" o un "no" sin respaldo, o cualquier respuesta firme sobre algo por confirmar.
      const claim = unsupportedAnswer(text, candidate, grounding, scope) ?? (pendingHit && !isHonest(candidate) ? pendingHit : null);
      if (claim) {
        verifyTopic = claim;
        console.warn(`[agent] ${e} respondió sobre «${claim}» sin respaldo en la información; se rehace para que lo verifique: «${candidate.replace(/\s+/g, ' ').slice(0, 160)}»`);
        lastEngine.delete(msg.userId);
        const honest = `La información disponible no menciona «${claim}». No digas que sí ni que no, ni lo supongas: di con naturalidad que lo verificas con el equipo, con una frase como «${business.agent.verifyPhrase}». El equipo le responde por este mismo chat.`;
        const retry = await generate(e, { ...input, note: [note, honest].filter(Boolean).join('\n'), fresh: e === 'apple' });
        candidate = unsupportedAnswer(text, retry, grounding, scope) || (pendingHit && !isHonest(retry)) ? business.agent.verifyPhrase : retry;
      }
      // Una cita que no existe ("te esperamos en la cita"): solo el flujo de citas agenda.
      if (business.appointments.enabled && claimsBooked(candidate) && !nextAppointmentFor(msg.userId)) {
        console.warn(`[agent] ${e} dio por hecha una cita que no existe; se rehace: «${candidate.replace(/\s+/g, ' ').slice(0, 160)}»`);
        const noAppt = 'El cliente todavía NO tiene una cita agendada: no digas que la tiene, que quedó agendada ni "te esperamos". Si quiere agendar, ofrécele buscarle un espacio.';
        const retry = await generate(e, { ...input, note: [input.note, noAppt].filter(Boolean).join('\n') });
        candidate = claimsBooked(retry) ? 'Todavía no tienes una cita agendada 🙂 ¿Quieres que te busque un espacio?' : retry;
        fakeBooking = true;
      }
      raw = candidate;
      engine = e;
      route = (e === chosen.engine ? chosen.reason : `${chosen.reason} → respaldo ${e}`) + (claim ? ` · sin afirmar «${claim}»` : '') + (fakeBooking ? ' · sin dar por hecha una cita' : '');
      break;
    } catch (err) {
      console.warn(`[agent] ${e} falló (${chosen.reason}): ${(err as Error).message}`);
    }
  }

  let reply: string;
  if (raw === undefined) {
    reply = pick(ERROR_REPLIES);
    emitEvent('bot_failed', msg.userId, { reason: route, text });
  } else {
    // Enlaces permitidos: los de las fuentes de este turno y los que aparecen en la información que vio el modelo.
    const seen = engine === 'openai' && useSheet ? sheet!.text : fullContext;
    const allowed = [...sources.flatMap((s) => (s.url ? [s.url] : [])), ...(seen.match(/https?:\/\/[^\s<>()"']+/g) ?? [])];
    let cleaned = history.length > 0 ? stripRepeatedGreeting(raw) : raw;
    if (details || !ASKS_PRICE_OR_LINK_RE.test(text)) {
      const lastAssistant = [...history].reverse().find((m) => m.role === 'assistant')?.content ?? '';
      cleaned = dropRepeatedFacts(cleaned, lastAssistant);
    }
    reply = postProcess(cleaned, allowed) ?? pick(OUT_OF_SCOPE_REPLIES);
  }
  if (engine !== 'none') lastEngine.set(msg.userId, engine);
  // "Deja te verifico eso": la pregunta queda por verificar en el tablero para que el equipo responda.
  if (raw !== undefined && saysWillVerify(reply)) openVerification(msg.userId, text, verifyTopic);
  if (engine === chosen.engine) lastRole.set(msg.userId, chosen.role);
  else lastRole.delete(msg.userId);

  return finish(reply, gate.intent, engine, {
    route,
    ...(engine === 'openai' ? { model: openaiModel(chosen.role) } : {}),
    ...(engine === chosen.engine ? { role: chosen.role } : {}),
    gateVia: gate.via,
    sources: sources.map((s) => ({ title: s.title, url: s.url, kind: s.kind })),
  });
}
