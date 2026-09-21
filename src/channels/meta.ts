// WhatsApp Cloud API (Meta, oficial): webhook de entrada y envío por Graph API.
// Necesita META_ACCESS_TOKEN, META_PHONE_NUMBER_ID, META_VERIFY_TOKEN (y META_APP_SECRET para validar firmas)
// y una URL pública (túnel) apuntando a POST /webhooks/meta.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Hono } from 'hono';
import type { HttpBindings } from '@hono/node-server';
import { env } from '../config.js';
import { handleMessage } from '../agent/agent.js';
import { registerSender } from '../crm/outbox.js';
import { channelOn } from './switches.js';

const meta = {
  token: process.env.META_ACCESS_TOKEN || '',
  phoneId: process.env.META_PHONE_NUMBER_ID || '',
  verifyToken: process.env.META_VERIFY_TOKEN || '',
  appSecret: process.env.META_APP_SECRET || '',
  version: process.env.META_API_VERSION || 'v21.0',
};
export const metaEnabled = Boolean(meta.token && meta.phoneId);

// Para el tablero (sección Canales): qué tan viva está la conexión con Meta.
const activity = { lastWebhookAt: 0, lastSentAt: 0, lastError: '', lastErrorAt: 0 };
export function metaStatus() {
  return { configured: metaEnabled, signed: Boolean(meta.appSecret), verifyToken: meta.verifyToken, version: meta.version, ...activity };
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
    await sendMetaText(waId, reply.text);
  } catch (err) {
    failed(err);
    console.error('[meta] error respondiendo:', (err as Error).message);
  }
}

function validSignature(raw: string, header: string | undefined): boolean {
  if (!meta.appSecret) return true; // sin secreto no se valida (solo para pruebas)
  if (!header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', meta.appSecret).update(raw).digest('hex');
  const got = header.slice(7);
  return expected.length === got.length && timingSafeEqual(Buffer.from(expected), Buffer.from(got));
}

export function mountMeta(app: Hono<{ Bindings: HttpBindings }>) {
  if (!metaEnabled) return;
  registerSender('meta', (userId, text) => sendMetaText(userId.replace(/^meta:/, ''), text));

  // Verificación del webhook (la hace Meta al registrar la URL)
  app.get('/webhooks/meta', (c) => {
    const mode = c.req.query('hub.mode');
    const token = c.req.query('hub.verify_token');
    const challenge = c.req.query('hub.challenge') ?? '';
    if (mode === 'subscribe' && token && token === meta.verifyToken) return c.text(challenge);
    return c.text('forbidden', 403);
  });

  app.post('/webhooks/meta', async (c) => {
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
          enqueue(m.from, text, m.id, names.get(m.from));
        }
      }
    }
    return c.text('ok'); // Meta reintenta si no respondemos 200 rápido
  });
}
