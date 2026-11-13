/**
 * Llamadas de voz con Grok (xAI Voice Agent API): un agente conversacional que habla con el cliente desde la ventana
 * de chat del sitio, con sus herramientas, y deja la conversación transcrita en el CRM.
 *
 *   navegador ──(audio PCM16, WebSocket propio /voz/ws)──▶ XENCRM ──(wss://api.x.ai/v1/realtime, con la llave)──▶ Grok
 *
 * 🪤 XENCRM hace de PUENTE, no se le da al navegador un token para hablar directo con xAI. El token efímero de xAI
 * fija el modelo pero no las instrucciones: quien lo tuviera podría usarlo para conversar de cualquier cosa con
 * nuestros minutos. Con el puente, la llave y las instrucciones no salen del servidor, las herramientas corren aquí
 * con el cliente que puso el código (nucleo.ts, ejecutarUna), la transcripción se guarda aquí (no la manda el
 * navegador, que podría inventarla) y la llamada se corta aquí al llegar al tope. Lo único que va y viene del
 * navegador es audio y avisos.
 *
 * El flujo: el chat pide una llamada (POST /voz/llamada, channels/web.ts) → se le da un boleto firmado, de un solo
 * uso, que dura un minuto → abre /voz/ws?b=<boleto> → aquí se abre la conexión con Grok, se le manda la sesión
 * (instrucciones, voz, audio, herramientas) y se pasan audio y eventos de un lado a otro.
 *
 * 🪤 En voz las guardas no pueden rehacer nada: lo que se dijo, se dijo. Por eso el agente de voz va con
 * instrucciones más estrictas, sin agendar (el flujo de citas es de texto y pide confirmar por escrito), y todo
 * queda transcrito en la conversación para que el equipo lo vea.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { business, env } from '../config.js';
import { V } from '../vocabulario.js';
import { regla } from '../reglas.js';
import { agotado } from '../crm/presupuesto.js';
import { appendMessage, touchUser } from '../agent/memory.js';
import { addEvent, getContact, updateContact } from '../crm/contacts.js';
import { emitEvent } from '../crm/events.js';
import { scheduleAnalysis } from '../crm/analyzer.js';
import { recordUsage } from '../llm/usage.js';
import { personaPrompt } from '../agent/prompts.js';
import { businessSheet } from '../rag/retriever.js';
import { channelOn } from '../channels/switches.js';
import { agentes, loSuyo, type Agente } from '../agentico/agentes.js';
import { herramientasDe, INSTRUCCIONES_DEL_CLIENTE } from '../agentico/cliente.js';
import { definicion, ejecutarUna, type Contexto, type Herramienta } from '../agentico/nucleo.js';

// ---------- ¿hay voz? ----------
/** El agente que atiende por voz: el primero activo con el canal «voz». */
export function agenteDeVoz(): Agente | null {
  return agentes().find((a) => a.activo && a.canales.includes('voz')) ?? null;
}

/** Si se puede llamar ahora, y si no, por qué (dicho para el equipo; al cliente se le dice menos). */
export function vozDisponible(): { ok: boolean; motivo?: string; agente?: string } {
  const a = agenteDeVoz();
  if (!env.xaiApiKey) return { ok: false, motivo: 'Falta XAI_API_KEY en el .env (la llave de xAI para la voz de Grok).' };
  if (!a) return { ok: false, motivo: 'Ningún agente activo atiende por voz: marca «Voz» en uno (Configuración › Agentes).' };
  if (!channelOn('web')) return { ok: false, motivo: 'El chat del sitio está apagado (Canales): la llamada se abre desde ahí.' };
  if (agotado()) return { ok: false, motivo: 'Se llegó al tope de gasto del mes.' };
  return { ok: true, agente: a.nombre };
}

// ---------- el boleto ----------
// Firmado con un secreto del proceso: un boleto vale para este servidor y para un minuto, y una sola vez.
const SECRETO = env.adminToken ? createHmac('sha256', env.adminToken).update('xencrm-voz').digest() : randomBytes(32);
const usados = new Map<string, number>();
const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');

interface Boleto {
  u: string; // la conversación (web:<sesión del chat>)
  a: string; // el agente
  e: number; // vence
  n: string; // de un solo uso
}

export function firmarBoleto(userId: string, agente: string, now = Date.now()): string {
  const datos = b64(JSON.stringify({ u: userId, a: agente, e: now + 60_000, n: randomBytes(9).toString('base64url') } satisfies Boleto));
  return `${datos}.${b64(createHmac('sha256', SECRETO).update(datos).digest())}`;
}

/** El boleto, si es nuestro, no ha vencido y no se ha usado. Al leerlo queda usado. */
export function leerBoleto(boleto: string, now = Date.now()): Boleto | null {
  const [datos, firma] = String(boleto || '').split('.');
  if (!datos || !firma) return null;
  const esperada = createHmac('sha256', SECRETO).update(datos).digest();
  const dada = Buffer.from(firma, 'base64url');
  if (dada.length !== esperada.length || !timingSafeEqual(dada, esperada)) return null;
  let b: Boleto;
  try {
    b = JSON.parse(Buffer.from(datos, 'base64url').toString('utf8')) as Boleto;
  } catch {
    return null;
  }
  if (!b.u || !b.a || !b.n || b.e < now || usados.has(b.n)) return null;
  for (const [n, vence] of usados) if (vence < now) usados.delete(n);
  usados.set(b.n, b.e);
  return b;
}

// ---------- pedir una llamada ----------
const recientes = new Map<string, number[]>();
/** ¿Esta clave ya pidió demasiadas en la última hora? Cuenta la de ahora si no. */
function demasiadas(clave: string, tope: number, now: number): boolean {
  const lista = (recientes.get(clave) ?? []).filter((t) => now - t < 3600_000);
  if (lista.length >= tope) return true;
  lista.push(now);
  recientes.set(clave, lista);
  return false;
}

/**
 * El chat pide una llamada. Se dice que no si no hay voz, si esa conversación o esa dirección ya pidieron muchas en
 * la última hora (cada minuto de voz se paga), o si se llegó al tope del mes.
 */
export function pedirLlamada(o: { sessionId: string; ip: string; now?: number }): { boleto: string; agente: string; maxSegundos: number } | { error: string; status: 403 | 429 | 503 } {
  const now = o.now ?? Date.now();
  const d = vozDisponible();
  if (!d.ok) return { error: 'La llamada no está disponible ahora. Escríbenos por aquí y te atendemos.', status: 503 };
  const tope = regla<number>('voz.llamadasPorHora');
  if (demasiadas(`s:${o.sessionId}`, tope, now) || demasiadas(`ip:${o.ip}`, tope * 3, now)) return { error: 'Ya hiciste varias llamadas seguidas. Escríbenos por aquí, que también te atendemos.', status: 429 };
  const a = agenteDeVoz()!;
  return { boleto: firmarBoleto(`web:${o.sessionId}`, a.id, now), agente: a.nombre, maxSegundos: regla<number>('voz.minutosMax') * 60 };
}

// ---------- lo que se le dice a Grok ----------
const POR_VOZ = `## Por voz
Estás en una llamada: hablas, no escribes.
- Frases cortas y naturales, como al teléfono. Una idea a la vez y una sola pregunta por turno.
- Sin listas, sin emojis, sin títulos. No leas enlaces, correos ni direcciones web: di que se los dejas en el chat de esta misma ventana.
- Las cifras y los precios, dichos como se dicen («ciento veinte mil pesos»).
- Si el cliente te interrumpe, para y escúchalo.
- Para agendar ${V.una} ${V.cita}: consulta los espacios si te los pide, y dile que en el chat de esta ventana escoge y confirma (por voz no agendas).
- Si no le entiendes, pídele que lo repita; no supongas.`;

/** Las instrucciones de la llamada: la persona del agente, lo suyo, cómo se habla por voz, sus herramientas y lo que sabe del negocio. */
export function instruccionesDeVoz(a: Agente): string {
  const hoja = businessSheet();
  const cabe = business.agent.fullInfoMaxTokens > 0 && hoja.tokens <= business.agent.fullInfoMaxTokens;
  return [personaPrompt(a.nombre), loSuyo(a), POR_VOZ, INSTRUCCIONES_DEL_CLIENTE, cabe ? hoja.text : ''].filter(Boolean).join('\n\n');
}

/** La sesión que se le manda a Grok al conectar (session.update). */
export function sesionDeVoz(a: Agente, herramientas: Herramienta[]) {
  return {
    type: 'session.update',
    session: {
      instructions: instruccionesDeVoz(a),
      voice: a.voz?.voz ?? 'eve',
      turn_detection: { type: 'server_vad' },
      audio: {
        input: { format: { type: 'audio/pcm', rate: 24000 }, transcription: { language_hint: a.voz?.idioma ?? 'es-CO' } },
        output: { format: { type: 'audio/pcm', rate: 24000 } },
      },
      tools: herramientas.map((h) => {
        const d = definicion(h);
        return { type: 'function', name: d.nombre, description: d.descripcion, parameters: d.parametros };
      }),
    },
  };
}

// ---------- el puente ----------
/** Lo que el navegador recibe en texto (el audio va en binario). */
type AlNavegador =
  | { tipo: 'lista'; agente: string; maxSegundos: number }
  | { tipo: 'habla' }
  | { tipo: 'cliente'; texto: string }
  | { tipo: 'agente'; texto: string }
  | { tipo: 'parcial'; texto: string }
  | { tipo: 'herramienta'; nombre: string }
  | { tipo: 'fin'; motivo: string }
  | { tipo: 'error'; texto: string };

const WSS = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

/** Engancha la voz al servidor HTTP: solo `/voz/ws` sube a WebSocket, y solo con un boleto válido. */
export function adjuntarVoz(servidor: Server): void {
  servidor.on('upgrade', (req: IncomingMessage, socket: Duplex, cabeza: Buffer) => {
    const url = new URL(req.url || '/', 'http://x');
    if (url.pathname !== '/voz/ws') {
      socket.destroy();
      return;
    }
    const b = leerBoleto(url.searchParams.get('b') || '');
    if (!b) {
      socket.end('HTTP/1.1 403 Forbidden\r\nconnection: close\r\ncontent-length: 0\r\n\r\n');
      return;
    }
    WSS.handleUpgrade(req, socket, cabeza, (ws) => atenderLlamada(ws, b));
  });
}

/** Abre la conexión con Grok (con la llave, desde el servidor). Aparte para poder cambiarla en las pruebas. */
export let conectarConGrok = (): WebSocket => new WebSocket(`${env.xaiRealtimeUrl}?model=${encodeURIComponent(env.xaiVoiceModel)}`, { headers: { Authorization: `Bearer ${env.xaiApiKey}` } });
export function cambiarConexion(f: () => WebSocket): void {
  conectarConGrok = f;
}

function guardar(userId: string, rol: 'user' | 'assistant', texto: string, agente: string): void {
  const limpio = texto.trim();
  if (!limpio) return;
  const id = rol === 'user' ? appendMessage(userId, 'user', limpio, undefined, 'customer') : appendMessage(userId, 'assistant', limpio, undefined, 'bot');
  if (rol === 'user') {
    const c = getContact(userId);
    if (c) updateContact(userId, { unread: c.unread + 1 }, { silent: true });
  }
  emitEvent('message', userId, { id, role: rol, author: rol === 'user' ? 'customer' : 'bot', content: limpio, ts: Date.now(), voz: agente });
}

export function atenderLlamada(cliente: WebSocket, b: Boleto): void {
  const a = agentes().find((x) => x.id === b.a && x.activo && x.canales.includes('voz'));
  const decir = (m: AlNavegador) => cliente.readyState === WebSocket.OPEN && cliente.send(JSON.stringify(m));
  if (!a) {
    decir({ tipo: 'error', texto: 'La llamada no está disponible ahora.' });
    cliente.close(1011, 'sin agente');
    return;
  }
  const userId = b.u;
  touchUser(userId, 'web', null);
  const herramientas = herramientasDe(a, 'voz');
  const porNombre = new Map(herramientas.map((h) => [h.nombre, h]));
  const ctx: Contexto = { lado: 'cliente', userId, por: `${a.nombre} (voz)`, now: Date.now() };
  const yaHechas = new Map<string, string>();
  const maxSegundos = regla<number>('voz.minutosMax') * 60;
  const empezo = Date.now();
  let grok: WebSocket;
  try {
    grok = conectarConGrok();
  } catch {
    decir({ tipo: 'error', texto: 'No pude conectar la llamada ahora.' });
    cliente.close(1011, 'sin grok');
    return;
  }
  let terminada = false;
  const pendientes: { call_id: string; name: string; arguments: string }[] = [];
  let usadas: string[] = [];

  const terminar = (motivo: string) => {
    if (terminada) return;
    terminada = true;
    clearTimeout(reloj);
    decir({ tipo: 'fin', motivo });
    try { grok.close(); } catch { /* ya cerrada */ }
    try { cliente.close(1000, motivo); } catch { /* ya cerrada */ }
    const segundos = Math.round((Date.now() - empezo) / 1000);
    // Cada minuto se paga: queda en el consumo como cualquier llamada a un modelo, y cuenta para el tope del mes.
    recordUsage({ engine: 'xai', model: env.xaiVoiceModel, task: 'voz', userId, inputTokens: 0, outputTokens: 0, segundos, ms: Date.now() - empezo });
    addEvent(userId, 'llamada', { agente: a.nombre, segundos, motivo, herramientas: usadas });
    emitEvent('contact', userId, { llamada: true });
    scheduleAnalysis(userId);
  };
  // 🪤 El tope de duración lo pone el servidor: si lo pusiera el navegador, bastaría con no colgar.
  const reloj = setTimeout(() => terminar('tope'), maxSegundos * 1000);

  grok.on('open', () => {
    grok.send(JSON.stringify(sesionDeVoz(a, herramientas)));
  });
  grok.on('unexpected-response', () => {
    decir({ tipo: 'error', texto: 'No pude conectar la llamada ahora.' });
    terminar('error');
  });
  grok.on('error', () => {
    decir({ tipo: 'error', texto: 'Se cortó la conexión con la voz.' });
    terminar('error');
  });
  grok.on('close', () => terminar('grok'));
  grok.on('message', async (datos) => {
    let e: Record<string, any>;
    try {
      e = JSON.parse(String(datos));
    } catch {
      return;
    }
    switch (e.type) {
      case 'session.updated':
        decir({ tipo: 'lista', agente: a.nombre, maxSegundos });
        break;
      case 'input_audio_buffer.speech_started':
        // El cliente empezó a hablar: el navegador corta lo que estaba sonando (que lo interrumpa es natural).
        decir({ tipo: 'habla' });
        break;
      case 'response.output_audio.delta':
      case 'response.audio.delta':
        if (typeof e.delta === 'string' && cliente.readyState === WebSocket.OPEN) cliente.send(Buffer.from(e.delta, 'base64'));
        break;
      case 'response.output_audio_transcript.delta':
        if (typeof e.delta === 'string') decir({ tipo: 'parcial', texto: e.delta });
        break;
      case 'response.output_audio_transcript.done':
        if (typeof e.transcript === 'string') {
          guardar(userId, 'assistant', e.transcript, a.nombre);
          decir({ tipo: 'agente', texto: e.transcript });
        }
        break;
      case 'conversation.item.input_audio_transcription.completed':
        if (typeof e.transcript === 'string') {
          guardar(userId, 'user', e.transcript, a.nombre);
          decir({ tipo: 'cliente', texto: e.transcript });
        }
        break;
      case 'response.function_call_arguments.done':
        pendientes.push({ call_id: String(e.call_id), name: String(e.name), arguments: String(e.arguments ?? '{}') });
        break;
      case 'response.done': {
        // Primero todas las respuestas de las herramientas, y después un solo response.create (lo pide xAI: si se
        // pide antes, contesta sin tener todo).
        if (!pendientes.length) break;
        const lote = pendientes.splice(0);
        for (const p of lote) {
          let args: unknown = {};
          try { args = JSON.parse(p.arguments || '{}'); } catch { args = null; }
          decir({ tipo: 'herramienta', nombre: p.name });
          const r = await ejecutarUna(porNombre, p.name, args, { ...ctx, now: Date.now() }, yaHechas);
          usadas.push(`${p.name}${r.error ? ':error' : ''}`);
          const salida = r.termina === 'persona' ? JSON.stringify({ pasada: true, nota: 'Ya quedó con una persona del equipo: despídete y dile que le escriben por el chat de esta ventana.' }) : r.contenido;
          if (grok.readyState === WebSocket.OPEN) grok.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: p.call_id, output: salida } }));
        }
        usadas = usadas.slice(-20);
        if (grok.readyState === WebSocket.OPEN) grok.send(JSON.stringify({ type: 'response.create' }));
        break;
      }
      case 'error':
        // La sesión sigue conectada; se registra para quien administra, al cliente no se le dice nada técnico.
        console.warn(`[voz] Grok: ${String(e.error?.message ?? e.message ?? 'error').slice(0, 200)}`);
        break;
    }
  });

  cliente.on('message', (datos, esBinario) => {
    if (terminada) return;
    if (esBinario) {
      // El audio del micrófono: PCM16 a 24 kHz, en trozos de ~100 ms.
      const audio = Buffer.isBuffer(datos) ? datos : Buffer.from(datos as ArrayBuffer);
      if (grok.readyState === WebSocket.OPEN && audio.length) grok.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: audio.toString('base64') }));
      return;
    }
    // Lo único que el navegador puede pedir: colgar. No hay forma de cambiar las instrucciones desde ahí.
    try {
      if ((JSON.parse(String(datos)) as { tipo?: string }).tipo === 'colgar') terminar('colgó');
    } catch { /* nada */ }
  });
  cliente.on('close', () => terminar('colgó'));
  cliente.on('error', () => terminar('error'));
}
