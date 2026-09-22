import { readFileSync } from 'node:fs';
import { logoUrl, readLogo } from '../brand.js';
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve, type HttpBindings } from '@hono/node-server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { env, business } from '../config.js';
import { handleMessage } from '../agent/agent.js';
import { streamSSE } from 'hono/streaming';
import { countDocs } from '../rag/store.js';
import { engineStatus } from '../llm/engines.js';
import { getMessages } from '../agent/memory.js';
import { getContact } from '../crm/contacts.js';
import { onEvent } from '../crm/events.js';
import { registerSender } from '../crm/outbox.js';
import { mountAdmin } from './admin.js';
import { mountCalendar } from './calendar.js';
import { channelOn } from './switches.js';
import { metaConfigured, mountMeta } from './meta.js';
import { INSTANCE, startPublicCheck } from './public-check.js';
import { createMcpServer } from '../mcp/server.js';

const app = new Hono<{ Bindings: HttpBindings }>();

const originOpt = env.allowedOrigins.includes('*') ? '*' : env.allowedOrigins;
app.use('/api/*', cors({ origin: originOpt }));
app.use('/mcp', cors({ origin: originOpt, allowHeaders: ['content-type', 'mcp-session-id', 'mcp-protocol-version', 'authorization'] }));

// ---------- Rate limit simple en memoria (por IP) ----------
const buckets = new Map<string, { n: number; reset: number }>();
function rateLimited(key: string, limit = 30, windowMs = 60_000): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { n: 1, reset: now + windowMs });
    return false;
  }
  b.n++;
  return b.n > limit;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
}, 60_000).unref();

function clientIp(c: { req: { header: (h: string) => string | undefined }; env: HttpBindings }): string {
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.env.incoming.socket.remoteAddress ?? 'unknown';
}

// ---------- Rutas ----------
app.get('/health', (c) =>
  c.json({ ok: true, instance: INSTANCE, agent: business.agent.name, store: business.business.name, model: env.chatModel, mode: env.llmEngine, engines: engineStatus(), docs: countDocs() }),
);

app.post('/api/chat', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { sessionId?: string; message?: string; name?: string } | null;
  const message = body?.message?.toString().trim();
  if (!message) return c.json({ error: 'message requerido' }, 400);
  if (!channelOn('web')) return c.json({ error: 'El chat está apagado por ahora.' }, 503);
  if (message.length > 2000) return c.json({ error: 'mensaje demasiado largo' }, 400);
  const sessionId = (body?.sessionId && /^[\w-]{8,64}$/.test(body.sessionId) ? body.sessionId : null) ?? randomUUID();
  // Límite por conversación (una persona no escribe 20 mensajes por minuto) y tope alto por IP (varios clientes tras un NAT).
  if (rateLimited(`s:${sessionId}`, 20) || rateLimited(`ip:${clientIp(c)}`, 200)) {
    return c.json({ error: 'Demasiados mensajes, espera un momento.' }, 429);
  }
  const reply = await handleMessage({
    userId: `web:${sessionId}`,
    channel: 'web',
    text: message,
    userName: body?.name?.toString().slice(0, 60) || null,
  });
  return c.json({ sessionId, reply: reply.text, silent: Boolean(reply.silent), intent: reply.intent, engine: reply.engine, sources: reply.sources });
});

const SESSION_RE = /^[\w-]{8,64}$/;

// Historial de la conversación (el widget lo carga al abrir) y estado de atención.
app.get('/api/history', (c) => {
  const sessionId = c.req.query('sessionId') ?? '';
  if (!SESSION_RE.test(sessionId)) return c.json({ messages: [], human: false });
  const userId = `web:${sessionId}`;
  const contact = getContact(userId);
  return c.json({
    human: Boolean(contact?.humanMode),
    messages: getMessages(userId, 40).map((m) => ({ role: m.role, author: m.author, by: m.by, content: m.content, ts: m.ts })),
  });
});

// Eventos en vivo para el widget: respuestas de una persona del equipo y cambios de modo.
app.get('/api/stream', (c) => {
  const sessionId = c.req.query('sessionId') ?? '';
  if (!SESSION_RE.test(sessionId)) return c.json({ error: 'sessionId inválido' }, 400);
  const userId = `web:${sessionId}`;
  return streamSSE(c, async (stream) => {
    let closed = false;
    const off = onEvent((ev) => {
      if (closed || ev.userId !== userId) return;
      if (ev.type === 'message' && ev.payload.author === 'human') {
        void stream.writeSSE({ event: 'message', data: JSON.stringify({ content: ev.payload.content, author: 'human', by: ev.payload.by ?? null, ts: ev.ts }) }).catch(() => undefined);
      } else if (ev.type === 'handoff') {
        void stream.writeSSE({ event: 'handoff', data: JSON.stringify({ on: ev.payload.on }) }).catch(() => undefined);
      }
    });
    stream.onAbort(() => {
      closed = true;
      off();
    });
    while (!closed) {
      await stream.sleep(25_000);
      if (!closed) await stream.writeSSE({ event: 'ping', data: '' }).catch(() => undefined);
    }
  });
});

// Las respuestas humanas al widget viajan por el stream; si el cliente no está conectado quedan en el historial.
registerSender('web', async () => undefined);

mountAdmin(app);
mountMeta(app);
mountCalendar(app);

// Logo del cliente cuando es un archivo local (aiva.config.json > brand.logo).
app.get('/brand/logo', (c) => {
  const logo = readLogo();
  if (!logo) return c.text('sin logo', 404);
  return c.body(new Uint8Array(logo.body), 200, { 'content-type': logo.type, 'cache-control': 'public, max-age=3600', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" });
});

app.get('/widget.js', (c) => {
  const js = readFileSync(new URL('../../public/widget.js', import.meta.url), 'utf8')
    .replace('__AGENT_NAME__', business.agent.name)
    .replace('__STORE_NAME__', business.business.name)
    .replace('__BRAND_COLOR__', business.brand.color)
    .replace('__BRAND_LOGO__', logoUrl() ?? '');
  return c.body(js, 200, { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'public, max-age=60' });
});

app.get('/', (c) => {
  const html = readFileSync(new URL('../../public/demo.html', import.meta.url), 'utf8').replaceAll('__STORE_NAME__', business.business.name);
  return c.html(html);
});

// ---------- MCP remoto (Streamable HTTP, sin estado) ----------
{
  // Siempre montado; se prende y apaga desde el tablero (Canales).
  app.all('/mcp', async (c) => {
    if (!channelOn('mcp')) return c.json({ error: 'MCP apagado' }, 503);
    if (rateLimited('mcp:' + clientIp(c), 120)) return c.json({ error: 'rate limited' }, 429);
    // Sin estado: cada petición crea su servidor+transporte (patrón recomendado por el SDK).
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    const server = createMcpServer();
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });
}

export function startWeb() {
  return new Promise<void>((resolve) => {
    serve({ fetch: app.fetch, port: env.port }, (info) => {
      const base = env.publicUrl || `http://localhost:${info.port}`;
      console.log(`[web] escuchando en http://localhost:${info.port}`);
      console.log(`[web] demo: ${base}/   widget: <script src="${base}/widget.js" async></script>`);
      if (channelOn('mcp')) console.log(`[web] MCP remoto: ${base}/mcp`);
      console.log(`[web] tablero: ${base}/admin`);
      if (metaConfigured()) console.log(`[meta] webhook de WhatsApp Cloud API: ${base}/webhooks/meta`);
      startPublicCheck();
      resolve();
    });
  });
}
