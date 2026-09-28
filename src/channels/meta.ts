// WhatsApp Cloud API (Meta, oficial): webhook de entrada y envío por Graph API.
// Necesita META_ACCESS_TOKEN, META_PHONE_NUMBER_ID, META_VERIFY_TOKEN (y META_APP_SECRET para validar firmas)
// y una URL pública (túnel) apuntando a POST /webhooks/meta. Se configuran en .env o desde el tablero (Canales),
// que verifica con Meta, las guarda en .env y las aplica sin reiniciar.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Hono } from 'hono';
import type { HttpBindings } from '@hono/node-server';
import { env } from '../config.js';
import { handleMessage } from '../agent/agent.js';
import { conFirma, registerSender, registerTemplateSender, type Template } from '../crm/outbox.js';
import { anotarOrigen, deMeta } from '../crm/origen.js';
import { channelOn } from './switches.js';

export interface MetaCredentials {
  token: string;
  phoneId: string;
  verifyToken: string;
  appSecret: string;
  version: string;
}
const meta: MetaCredentials = {
  token: process.env.META_ACCESS_TOKEN || '',
  phoneId: process.env.META_PHONE_NUMBER_ID || '',
  verifyToken: process.env.META_VERIFY_TOKEN || '',
  appSecret: process.env.META_APP_SECRET || '',
  version: process.env.META_API_VERSION || 'v26.0',
};
export const metaConfigured = () => Boolean(meta.token && meta.phoneId);

// Para el tablero (sección Canales): qué tan viva está la conexión con Meta.
const activity = { lastWebhookAt: 0, lastSentAt: 0, lastError: '', lastErrorAt: 0, verified: null as { phone: string; name: string; at: number } | null };
const tail = (s: string) => (s ? `…${s.slice(-4)}` : '');
/** Estado para el tablero: los secretos nunca salen completos (solo sus últimos caracteres). */
export function metaStatus() {
  return {
    configured: metaConfigured(),
    signed: Boolean(meta.appSecret),
    verifyToken: meta.verifyToken,
    version: meta.version,
    phoneId: meta.phoneId,
    tokenTail: tail(meta.token),
    appSecretTail: tail(meta.appSecret),
    ...activity,
  };
}

/** Pregunta a Meta por el número con estas credenciales: si responde, son buenas. */
export async function verifyMeta(c: Pick<MetaCredentials, 'token' | 'phoneId' | 'version'>): Promise<{ ok: true; phone: string; name: string } | { ok: false; error: string; network?: boolean }> {
  try {
    const res = await fetch(`https://graph.facebook.com/${encodeURIComponent(c.version)}/${encodeURIComponent(c.phoneId)}?fields=display_phone_number,verified_name`, {
      headers: { authorization: `Bearer ${c.token}` },
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { display_phone_number?: string; verified_name?: string; error?: { message?: string } };
    if (!res.ok) return { ok: false, error: `Meta respondió ${res.status}: ${body.error?.message ?? 'sin detalle'}`.slice(0, 300) };
    return { ok: true, phone: body.display_phone_number ?? c.phoneId, name: body.verified_name ?? '' };
  } catch (err) {
    return { ok: false, network: true, error: `No se pudo hablar con Meta: ${(err as Error).message}` };
  }
}

let sendersOn = false;
function registerMetaSenders() {
  if (sendersOn || !metaConfigured()) return;
  sendersOn = true;
  registerSender('meta', (userId, text) => sendMetaText(userId.replace(/^meta:/, ''), text));
  registerTemplateSender('meta', (userId, t) => sendMetaTemplate(userId.replace(/^meta:/, ''), t));
}

/** Aplica credenciales nuevas al proceso en marcha (el tablero ya las guardó en .env). */
export function applyMetaCredentials(next: Partial<MetaCredentials>, verified?: { phone: string; name: string }): void {
  Object.assign(meta, next);
  if (verified) activity.verified = { ...verified, at: Date.now() };
  activity.lastError = '';
  activity.lastErrorAt = 0;
  registerMetaSenders();
}
function failed(err: unknown) {
  activity.lastError = (err as Error).message;
  activity.lastErrorAt = Date.now();
}

interface MetaMessage {
  from: string;
  id: string;
  type: string;
  text?: { body: string };
  button?: { text: string };
  interactive?: { button_reply?: { title: string }; list_reply?: { title: string } };
  image?: { caption?: string };
  video?: { caption?: string };
  document?: { caption?: string };
}
interface MetaValue {
  messages?: MetaMessage[];
  contacts?: { wa_id: string; profile?: { name?: string } }[];
}

async function graph(path: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`https://graph.facebook.com/${meta.version}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${meta.token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Meta ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

export async function sendMetaText(to: string, text: string): Promise<void> {
  try {
    await graph(`${meta.phoneId}/messages`, { messaging_product: 'whatsapp', to, type: 'text', text: { body: text, preview_url: false } });
    activity.lastSentAt = Date.now();
  } catch (err) {
    failed(err);
    throw err;
  }
}

/** Plantilla aprobada en Meta, con los parámetros del cuerpo en orden ({{1}}, {{2}}…). */
export async function sendMetaTemplate(to: string, t: Template): Promise<void> {
  try {
    await graph(`${meta.phoneId}/messages`, {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: { name: t.name, language: { code: t.language }, components: [{ type: 'body', parameters: t.params.map((text) => ({ type: 'text', text })) }] },
    });
    activity.lastSentAt = Date.now();
  } catch (err) {
    failed(err);
    throw err;
  }
}

async function markReadAndTyping(messageId: string): Promise<void> {
  await graph(`${meta.phoneId}/messages`, { messaging_product: 'whatsapp', status: 'read', message_id: messageId, typing_indicator: { type: 'text' } }).catch(() => undefined);
}

function extractText(m: MetaMessage): string | null {
  switch (m.type) {
    case 'text':
      return m.text?.body?.trim() || null;
    case 'button':
      return m.button?.text ?? null;
    case 'interactive':
      return m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null;
    case 'image':
    case 'video':
    case 'document':
      return (m as { image?: { caption?: string } }).image?.caption ?? m.video?.caption ?? m.document?.caption ?? null;
    default:
      return null;
  }
}

interface Pending {
  texts: string[];
  lastId: string;
  name?: string;
  timer: NodeJS.Timeout;
}
const pending = new Map<string, Pending>();

function enqueue(waId: string, text: string, messageId: string, name?: string) {
  const p = pending.get(waId);
  if (p) {
    clearTimeout(p.timer);
    p.texts.push(text);
    p.lastId = messageId;
    p.timer = setTimeout(() => void flush(waId), env.debounceMs);
  } else {
    pending.set(waId, { texts: [text], lastId: messageId, name, timer: setTimeout(() => void flush(waId), env.debounceMs) });
  }
}

async function flush(waId: string) {
  const p = pending.get(waId);
  if (!p) return;
  pending.delete(waId);
  try {
    await markReadAndTyping(p.lastId);
    const reply = await handleMessage({ userId: `meta:${waId}`, channel: 'meta', text: p.texts.join('\n'), userName: p.name ?? null });
    if (reply.silent || !reply.text) return;
    // Igual que en WhatsApp por QR: por el mismo número contestan el asistente y las personas, así que se firma.
    await sendMetaText(waId, conFirma(reply.text, 'bot', 'meta'));
  } catch (err) {
    failed(err);
    console.error('[meta] error respondiendo:', (err as Error).message);
  }
}

export function validSignature(raw: string, header: string | undefined): boolean {
  // 🪤 Sin secreto NO se acepta nada. Antes esto devolvía `true` «solo para pruebas», y el tablero deja guardar
  // las credenciales de Meta sin el secreto: cualquiera que supiera la dirección del webhook podía inventar
  // conversaciones en el CRM y, peor, hacer que el número verificado del negocio le escribiera a terceros.
  if (!meta.appSecret) return false;
  if (!header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', meta.appSecret).update(raw).digest('hex');
  const got = header.slice(7);
  return expected.length === got.length && timingSafeEqual(Buffer.from(expected), Buffer.from(got));
}

export function mountMeta(app: Hono<{ Bindings: HttpBindings }>) {
  // Las rutas se montan siempre: las credenciales pueden llegar después, desde el tablero.
  registerMetaSenders();

  // Verificación del webhook (la hace Meta al registrar la URL)
  app.get('/webhooks/meta', (c) => {
    const mode = c.req.query('hub.mode');
    const token = c.req.query('hub.verify_token');
    const challenge = c.req.query('hub.challenge') ?? '';
    if (mode === 'subscribe' && token && meta.verifyToken && token === meta.verifyToken) return c.text(challenge);
    return c.text('forbidden', 403);
  });

  app.post('/webhooks/meta', async (c) => {
    if (!metaConfigured()) return c.text('no configurado', 404);
    const raw = await c.req.text();
    if (!validSignature(raw, c.req.header('x-hub-signature-256'))) return c.text('bad signature', 401);
    activity.lastWebhookAt = Date.now();
    // Apagado desde el tablero: se responde 200 para que Meta no reintente, pero no se atiende.
    if (!channelOn('meta')) return c.text('ok');
    let body: { entry?: { changes?: { field?: string; value?: MetaValue }[] }[] };
    try {
      body = JSON.parse(raw);
    } catch {
      return c.text('bad json', 400);
    }
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'messages') continue;
        const value = change.value ?? {};
        const names = new Map((value.contacts ?? []).map((ct) => [ct.wa_id, ct.profile?.name]));
        for (const m of value.messages ?? []) {
          const text = extractText(m);
          if (text === null) {
            void sendMetaText(m.from, 'Por ahora solo puedo leer mensajes de texto 🙂 ¿Me lo escribes?').catch(() => undefined);
            continue;
          }
          // Si llegó pulsando un anuncio de «enviar mensaje», el aviso trae cuál y con qué titular. Es lo único
          // que permite decirle después al negocio qué anuncio le trajo clientes de verdad.
          anotarOrigen(`meta:${m.from}`, deMeta((m as { referral?: Record<string, unknown> }).referral));
          enqueue(m.from, text, m.id, names.get(m.from));
        }
      }
    }
    return c.text('ok'); // Meta reintenta si no respondemos 200 rápido
  });
}
