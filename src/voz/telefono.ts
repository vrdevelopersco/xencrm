/**
 * El teléfono: llamadas por SIP atendidas por un agente de voz con Grok (xAI Voice Agent API).
 *
 *   cliente ──▶ tu número (3CX, Twilio, Telnyx…) ──SIP──▶ sip:<número>@sip.voice.x.ai ──audio──▶ Grok
 *                                                              │ aviso firmado (realtime.call.incoming)
 *                                                              ▼
 *                                   XENCRM /voz/sip ──▶ se une por call_id (wss, con la llave) y la controla
 *
 * El audio va directo entre la troncal y xAI (sin pasar por aquí: es lo que deja el retraso en lo mínimo). XENCRM
 * pone las instrucciones y las herramientas, guarda lo que se dice en la conversación de ese número, transfiere a una
 * persona (SIP REFER a la extensión o cola de 3CX que diga XAI_SIP_DESVIO) y cuelga.
 *
 * 🪤 El aviso de xAI se verifica antes de hacer nada (Standard Webhooks: HMAC-SHA256 sobre «id.timestamp.cuerpo», con
 * el secreto whsec_… que xAI da UNA vez al registrar el número). Sin eso, cualquiera que adivine la ruta le haría a
 * XENCRM unirse a llamadas, y cada minuto se paga.
 *
 * 🪤 Es el mismo contacto que su WhatsApp: la ficha es `tel:+57…` y su número se normaliza igual (crm/contacts.ts),
 * así que el CRM las reconoce como la misma persona y el agente sabe de qué se habló por escrito.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { WebSocket } from 'ws';
import { env } from '../config.js';
import { regla } from '../reglas.js';
import { agotado } from '../crm/presupuesto.js';
import { touchUser } from '../agent/memory.js';
import { addEvent, getContact, guardarNumero, updateContact } from '../crm/contacts.js';
import { findDuplicates } from '../crm/merge.js';
import { emitEvent } from '../crm/events.js';
import { scheduleAnalysis } from '../crm/analyzer.js';
import { recordUsage } from '../llm/usage.js';
import { channelOn } from '../channels/switches.js';
import { herramientasDe } from '../agentico/cliente.js';
import { ejecutarUna, type Contexto } from '../agentico/nucleo.js';
import { agenteDeVoz, conectarConGrok, guardar, sesionDeVoz } from './llamada.js';

/** Si el teléfono puede atender ahora, y si no, por qué (para quien administra). */
export function telefonoListo(): { ok: boolean; motivo?: string; agente?: string } {
  const a = agenteDeVoz('telefono');
  if (!env.xaiApiKey) return { ok: false, motivo: 'Falta XAI_API_KEY en el .env.' };
  if (!env.xaiSipSecreto) return { ok: false, motivo: 'Falta XAI_SIP_SECRETO: el secreto (whsec_…) que da xAI al registrar el número.' };
  if (!a) return { ok: false, motivo: 'Ningún agente activo atiende por teléfono: marca «Teléfono» en uno (Configuración › Agentes).' };
  if (!channelOn('telefono')) return { ok: false, motivo: 'El canal Teléfono está apagado.' };
  if (agotado()) return { ok: false, motivo: 'Se llegó al tope de gasto del mes.' };
  return { ok: true, agente: a.nombre };
}

// ---------- el aviso de xAI ----------
const vistos = new Map<string, number>();

/**
 * ¿El aviso viene de xAI? Standard Webhooks: la firma es base64(HMAC-SHA256(secreto, «id.timestamp.cuerpo»)), el
 * secreto viene como «whsec_» + base64, y la cabecera puede traer varias firmas «v1,…» separadas por espacio (para
 * cambiar el secreto sin cortar). Se rechaza lo de más de cinco minutos y lo que ya se vio (un aviso repetido).
 */
export function avisoValido(cuerpo: string, cab: { id?: string | null; ts?: string | null; firma?: string | null }, secreto = env.xaiSipSecreto, now = Date.now()): boolean {
  const { id, ts, firma } = cab;
  if (!secreto || !id || !ts || !firma) return false;
  const segundos = Number(ts);
  if (!Number.isFinite(segundos) || Math.abs(now / 1000 - segundos) > 300) return false;
  const llave = secreto.startsWith('whsec_') ? Buffer.from(secreto.slice(6), 'base64') : Buffer.from(secreto, 'utf8');
  const esperada = createHmac('sha256', llave).update(`${id}.${ts}.${cuerpo}`).digest();
  const coincide = firma.split(' ').some((f) => {
    const [version, valor] = f.split(',');
    if (version !== 'v1' || !valor) return false;
    const dada = Buffer.from(valor, 'base64');
    return dada.length === esperada.length && timingSafeEqual(dada, esperada);
  });
  if (!coincide) return false;
  for (const [k, t] of vistos) if (now - t > 600_000) vistos.delete(k);
  if (vistos.has(id)) return false;
  vistos.set(id, now);
  return true;
}

/** Quién llama, de las cabeceras SIP: «"Ana Duarte" <sip:+573001234567@troncal.com>;tag=…». */
export function quienLlama(sipHeaders: { name?: string; value?: string }[] | undefined): { numero: string | null; nombre: string | null } {
  const from = (sipHeaders ?? []).find((h) => /^(from|p-asserted-identity)$/i.test(String(h.name)))?.value ?? '';
  const nombre = /^\s*"([^"]{1,60})"/.exec(from)?.[1]?.trim() || null;
  const usuario = /<?(?:sips?|tel):\+?([^@;>]+)/i.exec(from)?.[1] ?? '';
  const digitos = usuario.replace(/\D/g, '');
  // «anonymous», una extensión de tres dígitos o nada: no es un número al que se pueda volver.
  const numero = digitos.length >= 8 && digitos.length <= 15 ? digitos : null;
  return { numero, nombre: nombre && !/^(anonymous|unknown|desconocido)$/i.test(nombre) ? nombre : null };
}

// ---------- la API REST de una llamada ----------
async function alaLlamada(callId: string, accion: 'hangup' | 'refer', cuerpo?: unknown): Promise<{ ok: boolean; status: number; texto: string }> {
  try {
    const r = await fetch(`${env.xaiApiUrl}/realtime/calls/${encodeURIComponent(callId)}/${accion}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.xaiApiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(cuerpo ?? {}),
      signal: AbortSignal.timeout(accion === 'refer' ? 45_000 : 10_000),
    });
    return { ok: r.ok, status: r.status, texto: (await r.text()).slice(0, 200) };
  } catch (err) {
    return { ok: false, status: 0, texto: (err as Error).message };
  }
}
export const colgarLlamada = (callId: string) => alaLlamada(callId, 'hangup');
export const transferirLlamada = (callId: string, destino: string) => alaLlamada(callId, 'refer', { target_uri: destino });

// ---------- atender ----------
const activas = new Set<string>();
export const llamadasActivas = (): number => activas.size;

/** Las dos herramientas que solo tiene el teléfono. Se atienden aquí, no en el núcleo: son de la llamada. */
const COLGAR = { type: 'function', name: 'colgar', description: 'Cuelga la llamada. Úsala cuando el cliente ya se despidió y tú también.', parameters: { type: 'object', properties: {} } };

/**
 * Llega una llamada (el aviso ya verificado): se une a ella y la atiende. Si no se puede (sin agente, sin cupo, el
 * tope del mes), la pasa a una persona si hay a dónde, o la cuelga: una llamada que nadie contesta es peor.
 */
export async function atenderLlamadaTelefonica(callId: string, sipHeaders: { name?: string; value?: string }[] | undefined, now = Date.now()): Promise<'atendida' | 'desviada' | 'colgada'> {
  const listo = telefonoListo();
  const a = agenteDeVoz('telefono');
  if (!listo.ok || !a || activas.size >= regla<number>('voz.telefonoSimultaneas')) {
    console.warn(`[telefono] ${callId}: no se atiende (${listo.motivo ?? 'sin cupo de llamadas a la vez'})`);
    if (env.xaiSipDesvio && (await transferirLlamada(callId, env.xaiSipDesvio)).ok) return 'desviada';
    await colgarLlamada(callId);
    return 'colgada';
  }
  activas.add(callId);
  const { numero, nombre } = quienLlama(sipHeaders);
  const userId = numero ? `tel:+${numero}` : `tel:anonimo-${callId.slice(-12)}`;
  touchUser(userId, 'telefono', nombre);
  if (numero) {
    updateContact(userId, { phone: `+${numero}` }, { silent: true });
    guardarNumero(userId, `+${numero}`);
  }
  // Omnicanal: si este número ya escribió por WhatsApp o dejó su número en el chat, el agente lo sabe.
  const otras = numero ? findDuplicates(userId).slice(0, 2) : [];
  const conocido = getContact(userId);
  const quien = [
    nombre || conocido?.name ? `Llama ${nombre || conocido?.name}${numero ? ` desde el +${numero}` : ''}.` : numero ? `Llama el +${numero}.` : 'Llama un número oculto.',
    ...otras.map((o) => `Ya habló con nosotros por ${o.contact.channel === 'web' ? 'el chat del sitio' : 'WhatsApp'}${o.contact.name ? ` como ${o.contact.name}` : ''}${o.contact.summary ? `: ${o.contact.summary}` : '.'}`),
  ].join(' ');

  const herramientas = herramientasDe(a, 'telefono');
  const porNombre = new Map(herramientas.map((h) => [h.nombre, h]));
  const ctx: Contexto = { lado: 'cliente', userId, por: `${a.nombre} (teléfono)`, now };
  const yaHechas = new Map<string, string>();
  const maxSegundos = regla<number>('voz.minutosMax') * 60;
  const empezo = Date.now();
  const usadas: string[] = [];
  let terminada = false, colgarAlTerminar = false, transferida = false;
  const pendientes: { call_id: string; name: string; arguments: string }[] = [];
  const grok = conectarConGrok(callId);

  const terminar = (motivo: string) => {
    if (terminada) return;
    terminada = true;
    activas.delete(callId);
    clearTimeout(reloj);
    try { grok.close(); } catch { /* ya cerrada */ }
    const segundos = Math.round((Date.now() - empezo) / 1000);
    recordUsage({ engine: 'xai', model: env.xaiVoiceModel, task: 'voz', userId, inputTokens: 0, outputTokens: 0, segundos, ms: Date.now() - empezo });
    addEvent(userId, 'llamada', { canal: 'telefono', agente: a.nombre, segundos, motivo, herramientas: usadas, ...(numero ? { numero: `+${numero}` } : {}) });
    emitEvent('contact', userId, { llamada: true });
    scheduleAnalysis(userId);
  };
  // 🪤 El tope lo pone el servidor: se cuelga por la API, no se espera a que alguien se canse.
  const reloj = setTimeout(() => void colgarLlamada(callId).finally(() => terminar('tope')), maxSegundos * 1000);

  grok.on('open', () => {
    grok.send(JSON.stringify(sesionDeVoz(a, herramientas, 'telefono', { quienLlama: `## Quién llama\n${quien}`, extras: [COLGAR] })));
    // Que conteste él: por teléfono el que llama espera oír algo primero.
    grok.send(JSON.stringify({ type: 'response.create' }));
  });
  grok.on('error', (err) => {
    console.warn(`[telefono] ${callId}: ${err.message}`);
    terminar('error');
  });
  grok.on('close', () => terminar(transferida ? 'transferida' : 'colgó'));
  grok.on('message', async (datos) => {
    let e: Record<string, any>;
    try {
      e = JSON.parse(String(datos));
    } catch {
      return;
    }
    if (e.type === 'conversation.item.input_audio_transcription.completed' && typeof e.transcript === 'string') guardar(userId, 'user', e.transcript, a.nombre);
    else if (e.type === 'response.output_audio_transcript.done' && typeof e.transcript === 'string') guardar(userId, 'assistant', e.transcript, a.nombre);
    else if (e.type === 'response.function_call_arguments.done') pendientes.push({ call_id: String(e.call_id), name: String(e.name), arguments: String(e.arguments ?? '{}') });
    else if (e.type === 'error') console.warn(`[telefono] Grok: ${String(e.error?.message ?? e.message ?? 'error').slice(0, 200)}`);
    else if (e.type === 'response.done') {
      // Se despidió y pidió colgar: se deja sonar la despedida antes de cortar (la respuesta termina de generarse
      // antes de terminar de oírse).
      if (colgarAlTerminar && !pendientes.length) {
        colgarAlTerminar = false;
        setTimeout(() => void colgarLlamada(callId).finally(() => terminar('se despidió')), 3500);
        return;
      }
      if (!pendientes.length) return;
      const lote = pendientes.splice(0);
      let pasar: string | null = null;
      for (const p of lote) {
        let args: unknown = {};
        try { args = JSON.parse(p.arguments || '{}'); } catch { args = null; }
        let salida: string;
        if (p.name === 'colgar') {
          colgarAlTerminar = true;
          salida = JSON.stringify({ ok: true, nota: 'Despídete en una frase; la llamada se cuelga al terminar.' });
          usadas.push('colgar');
        } else {
          const r = await ejecutarUna(porNombre, p.name, args, { ...ctx, now: Date.now() }, yaHechas);
          usadas.push(`${p.name}${r.error ? ':error' : ''}`);
          salida = r.contenido;
          if (r.termina === 'persona') {
            // pasar_a_persona ya puso a una persona a cargo de la ficha; por teléfono además se transfiere la llamada.
            pasar = (args as { motivo?: string } | null)?.motivo ?? 'pidió una persona';
            salida = env.xaiSipDesvio
              ? JSON.stringify({ pasada: true, nota: 'Dile en una frase que lo comunicas con alguien del equipo; la llamada se transfiere.' })
              : JSON.stringify({ pasada: true, nota: 'No hay a quién transferir ahora: dile que alguien del equipo lo llama o le escribe por WhatsApp a este número, y despídete.' });
          }
        }
        if (grok.readyState === WebSocket.OPEN) grok.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: p.call_id, output: salida } }));
      }
      if (grok.readyState === WebSocket.OPEN) grok.send(JSON.stringify({ type: 'response.create' }));
      if (pasar && env.xaiSipDesvio) {
        // Que alcance a decir «te comunico» antes de transferir.
        setTimeout(async () => {
          const r = await transferirLlamada(callId, env.xaiSipDesvio);
          if (r.ok) {
            transferida = true;
            addEvent(userId, 'llamada_transferida', { a: env.xaiSipDesvio, motivo: pasar });
            terminar('transferida');
          } else console.warn(`[telefono] ${callId}: no se pudo transferir (${r.status} ${r.texto})`);
        }, 3000);
      } else if (pasar) colgarAlTerminar = true;
    }
  });
  return 'atendida';
}

/** Lo que el tablero muestra del teléfono: si está listo, por qué no, y lo que hay que copiar en xAI y en la troncal. */
export function estadoDelTelefono(base: string) {
  return { ...telefonoListo(), webhook: `${base}/voz/sip`, destinoSip: 'sip:<tu número>@sip.voice.x.ai;transport=tls', desvio: env.xaiSipDesvio || null, activas: activas.size };
}
