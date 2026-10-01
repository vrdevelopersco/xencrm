import { readFileSync, rmSync } from 'node:fs';
import { logoUrl, readLogo } from '../brand.js';
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createAdaptorServer, serve, type HttpBindings } from '@hono/node-server';
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
import { anotarOrigen, deLaUrl } from '../crm/origen.js';
import { atendiendoAhora } from '../crm/tiempos.js';
import { burbujaDe, paraCadenaJs, ventanaDe } from '../crm/chat-config.js';
import { mountAdmin } from './admin.js';
import { mountCalendar } from './calendar.js';
import { channelOn } from './switches.js';
import { preguntarAAiva } from '../crm/consulta.js';
import { deDondeViene, direccionPermitida, libretaConfig } from '../crm/libreta-config.js';
import { leerAdjunto, TOPE_ARCHIVO } from '../crm/adjuntos.js';
import { irseSiQuedaHuerfano } from '../huerfano.js';
import { metaConfigured, mountMeta } from './meta.js';
import { INSTANCE, startPublicCheck } from './public-check.js';
import { createMcpServer } from '../mcp/server.js';

export const app = new Hono<{ Bindings: HttpBindings }>();

const originOpt = env.allowedOrigins.includes('*') ? '*' : env.allowedOrigins;
app.use('/api/*', cors({ origin: originOpt }));
app.use('/mcp', cors({ origin: originOpt, allowHeaders: ['content-type', 'mcp-session-id', 'mcp-protocol-version', 'authorization'] }));

// ---------- Rate limit simple en memoria (por IP) ----------
const buckets = new Map<string, { n: number; reset: number }>();
// Exportada para poder probarla: es lo único que separa el chat público de que alguien gaste el dinero del
// cliente llamando al modelo en bucle.
export function rateLimited(key: string, limit = 30, windowMs = 60_000): boolean {
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

/**
 * Para meter texto del negocio dentro del HTML de una página.
 *
 * 🪤 El nombre, el color y la dirección del logo los escribe quien configura el cliente, y de ahí salen a una
 * página que ve gente de la calle. Un `"` en el nombre del negocio rompería el atributo donde cae; algo peor,
 * escrito a propósito, haría más que romperlo.
 */
const escaparHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);

// ---------- La libreta: preguntarle algo a aiva, sin pasar por el tablero ----------
//
// 🪤 Dos cerraduras, y hacen falta las dos. Un endpoint que llama al modelo y no pide nada en un dominio
// público se encuentra solo —los rastreadores prueban rutas todo el día— y quien lo encuentre gasta la clave
// de OpenAI del negocio.
//
//  1. La llave va en la dirección, que es lo que se pidió: «solo para quien la sepa». Pero es una llave de
//     verdad y sin ella la puerta NO EXISTE (404), no es que conteste que no: una puerta que dice «aquí hay
//     algo pero no te dejo» es una invitación a insistir.
//  2. Y el sello por dirección, que es lo que de verdad la cierra: una llave se filtra en un historial, en un
//     registro o en una captura; una dirección que no coincide no entra ni con la llave correcta.
//
// Las dos se ponen desde la consola, en Libreta.
/** Por dónde llegó la conexión de verdad. Esto no se falsifica; la cabecera sí. Ver deDondeViene(). */
const porDondeLlego = (c: unknown): string => {
  const env = (c as { env?: { incoming?: { socket?: { remoteAddress?: string } } } }).env;
  return env?.incoming?.socket?.remoteAddress ?? '';
};

const abierta = (c: { env?: unknown; req: { param: (n: string) => string; header: (n: string) => string | undefined } }): boolean => {
  const cfg = libretaConfig();
  if (!cfg.llave || cfg.llave.length < 16) return false;
  const dada = c.req.param('llave') ?? '';
  if (dada.length !== cfg.llave.length) return false;
  // Comparación de tiempo constante: con una normal, lo que tarda en fallar dice cuántos caracteres acertaste,
  // y con eso se adivina la llave carácter a carácter.
  let dif = 0;
  for (let i = 0; i < dada.length; i++) dif |= dada.charCodeAt(i) ^ cfg.llave.charCodeAt(i);
  if (dif !== 0) return false;
  const cabeceras = {
    'cf-connecting-ip': c.req.header('cf-connecting-ip'),
    'x-forwarded-for': c.req.header('x-forwarded-for'),
    'x-real-ip': c.req.header('x-real-ip'),
  };
  return direccionPermitida(deDondeViene(cabeceras, porDondeLlego(c)), cfg.ips);
};

app.get('/libreta/:llave', (c) => {
  if (!abierta(c)) return c.notFound();
  return c.html(readFileSync(new URL('../../public/libreta.html', import.meta.url), 'utf8').replaceAll('__NEGOCIO__', business.business.name));
});

app.post('/libreta/:llave', async (c) => {
  if (!abierta(c)) return c.notFound();
  // Tope de uso: aunque la llave y la dirección estén bien, nadie necesita cien preguntas por minuto.
  if (rateLimited('libreta', 12, 60_000)) return c.json({ error: 'Muchas preguntas seguidas; espera un momento.' }, 429);
  // Viene como formulario para poder traer archivos. Nada de lo que llegue se guarda: se lee y se olvida.
  const form = await c.req.parseBody({ all: true }).catch(() => null);
  if (!form) return c.json({ error: 'no entendí la pregunta' }, 400);
  const pregunta = String(form.pregunta ?? '').trim();
  if (!pregunta) return c.json({ error: 'escribe la pregunta' }, 400);
  if (pregunta.length > 4000) return c.json({ error: 'la pregunta es demasiado larga' }, 400);
  let antes: { pregunta: string; respuesta: string }[] = [];
  try {
    const crudo = JSON.parse(String(form.antes ?? '[]')) as { pregunta: string; respuesta: string }[];
    if (Array.isArray(crudo)) antes = crudo.slice(-4);
  } catch {
    /* sin hilo previo */
  }
  const sueltos = form.archivo === undefined ? [] : Array.isArray(form.archivo) ? form.archivo : [form.archivo];
  const archivos = sueltos.filter((x): x is File => typeof x === 'object' && x !== null && 'arrayBuffer' in x);
  if (archivos.length > 4) return c.json({ error: 'máximo cuatro archivos por pregunta' }, 400);
  const adjuntos = [];
  for (const f of archivos) {
    if (f.size > TOPE_ARCHIVO) return c.json({ error: `"${f.name}" pesa demasiado (máximo 2 MB)` }, 400);
    try {
      adjuntos.push(leerAdjunto(f.name, new Uint8Array(await f.arrayBuffer())));
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  }
  try {
    return c.json(await preguntarAAiva({ pregunta, antes, adjuntos }));
  } catch (err) {
    return c.json({ error: (err as Error).message }, 502);
  }
});

app.post('/api/chat', async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    sessionId?: string;
    message?: string;
    name?: string;
    origen?: { url?: string; referente?: string };
  } | null;
  const message = body?.message?.toString().trim();
  if (!message) return c.json({ error: 'message requerido' }, 400);
  if (!channelOn('web')) return c.json({ error: 'El chat está apagado por ahora.' }, 503);
  if (message.length > 2000) return c.json({ error: 'mensaje demasiado largo' }, 400);
  const sessionId = (body?.sessionId && /^[\w-]{8,64}$/.test(body.sessionId) ? body.sessionId : null) ?? randomUUID();
  // Límite por conversación (una persona no escribe 20 mensajes por minuto) y tope alto por IP (varios clientes tras un NAT).
  if (rateLimited(`s:${sessionId}`, 20) || rateLimited(`ip:${clientIp(c)}`, 200)) {
    return c.json({ error: 'Demasiados mensajes, espera un momento.' }, 429);
  }
  // De dónde vino, antes de atender: si la conversación es nueva queda anotado con su campaña.
  if (body?.origen?.url) anotarOrigen(`web:${sessionId}`, deLaUrl(String(body.origen.url), String(body.origen.referente ?? '')));
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
  const b = burbujaDe();
  // Fuera de horario la burbuja no se pinta: se devuelve un archivo que no hace nada. Es a propósito que sea
  // aquí y no en el navegador —así el sitio del cliente queda literalmente limpio, sin un botón muerto— y a
  // propósito que el cache sea corto, porque si no la burbuja tardaría en volver al abrir el negocio.
  if (b.soloEnHorario && !atendiendoAhora()) {
    return c.body('/* fuera del horario de atención */', 200, { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'public, max-age=60' });
  }
  const js = readFileSync(new URL('../../public/widget.js', import.meta.url), 'utf8')
    .replace('__AGENT_NAME__', business.agent.name)
    .replace('__STORE_NAME__', business.business.name)
    .replace('__BRAND_COLOR__', business.brand.color)
    .replace('__BRAND_LOGO__', logoUrl() ?? '')
    // Esto se mete DENTRO de comillas simples en el archivo: ver paraCadenaJs() para lo que puede pasar.
    .replace('__SALUDO__', paraCadenaJs(b.saludo))
    .replace('__POSICION__', b.posicion)
    .replace('__ABRE_SOLA__', String(b.abreSola));
  return c.body(js, 200, { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'public, max-age=60' });
});

app.get('/', (c) => {
  const html = readFileSync(new URL('../../public/demo.html', import.meta.url), 'utf8').replaceAll('__STORE_NAME__', business.business.name);
  return c.html(html);
});

/**
 * La ventana de chat del negocio: su puerta web, para enlazar desde su sitio o mandar por WhatsApp.
 *
 * Es la misma conversación que la burbuja —el mismo `/api/chat`, la misma sesión, el mismo paso a una persona—,
 * solo que a pantalla completa y con la marca del negocio alrededor. Quien escriba aquí entra al CRM como
 * contacto del canal `web`, con su origen anotado, igual que si hubiera escrito desde la burbuja.
 *
 * 🪤 Se entra sin decir quién eres. Pedir el nombre en la puerta parece que ordena el embudo y lo que hace es
 * vaciarlo: quien solo iba a preguntar a qué hora abren se da la vuelta. El nombre lo pide el asistente cuando
 * la conversación llega a un punto en que hace falta, que es como ya funciona por WhatsApp.
 */
app.get('/chat', (c) => {
  const sigla = business.business.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
  const logo = logoUrl();
  const marca = logo ? `<img class="logo" src="${escaparHtml(logo)}" alt="">` : `<span class="sigla" aria-hidden="true">${escaparHtml(sigla)}</span>`;

  const v = ventanaDe();
  const prendido = channelOn('web');
  const atendiendo = atendiendoAhora();
  // Lo que dice la barra: lo que de verdad va a pasar cuando escriban. Prometer «responde en minutos» de
  // madrugada deja a alguien esperando delante de una pantalla.
  const estado = !prendido
    ? '<span class="pulso frio"></span>El chat está cerrado'
    : atendiendo
      ? '<span class="pulso"></span>En línea · suele responder en segundos'
      : '<span class="pulso frio"></span>Fuera de horario · te responden apenas abran';

  const cuerpo = prendido
    ? `<div id="aiva-ventana"></div>\n<p class="pie">${escaparHtml(v.pie || 'Esta conversación queda guardada en este navegador.')}</p>\n<script src="widget.js" data-modo="ventana" async></script>`
    : // No se deja una caja de texto que se traga los mensajes: se dice que está cerrado y por dónde sí llegan.
      // Lo que se ofrece es lo que el propio negocio escribió en «cómo contactar a una persona», que es lo
      // único que aquí se sabe de cierto; inventar un enlace a WhatsApp con un número que no tenemos sería
      // mandar a la gente a una puerta que no existe.
      `<div class="cerrado"><h2>Ahora mismo no estamos en el chat</h2><p>${escaparHtml(v.cerradaDice || business.business.humanContact || 'Vuelve en un rato y con gusto te atendemos.')}</p></div>`;

  const html = readFileSync(new URL('../../public/chat.html', import.meta.url), 'utf8')
    .replaceAll('__STORE_NAME__', escaparHtml(v.titulo || business.business.name))
    .replaceAll('__AGENT_NAME__', escaparHtml(business.agent.name))
    .replaceAll('__BRAND_COLOR__', /^#[0-9a-fA-F]{6}$/.test(business.brand.color) ? business.brand.color : '#2f7d4f')
    .replaceAll('__MARCA__', marca)
    .replaceAll('__ESTADO__', estado)
    .replaceAll('__CUERPO__', cuerpo);
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

/**
 * 🪤 Una segunda puerta, de archivo, que no pasa por la red.
 *
 * El enrutador del paquete le habla a este proceso por 127.0.0.1. En el servidor eso dejó de funcionar sin que
 * nada lo anunciara: el proceso vivo, escuchando su puerto según su propio registro, y el padre recibiendo
 * ECONNREFUSED. El sitio entero devolviendo «todavía está arrancando» y ni un error donde agarrarse.
 *
 * Un socket de archivo no depende de direcciones, ni de IPv4 contra IPv6, ni de reglas de red: si los dos
 * procesos ven la misma carpeta, se hablan. Solo se abre cuando el lanzador dice por dónde (AIVA_SOCK); a mano
 * no sobra nada. Si falla, se avisa y se sigue: el puerto es la puerta principal, esta es la de servicio.
 */
function abrirPuertaDeServicio(): void {
  const ruta = process.env.AIVA_SOCK;
  if (!ruta) return;
  try {
    rmSync(ruta, { force: true }); // el del arranque anterior, que si no, no deja abrir
  } catch {
    /* si no se puede borrar, el listen dirá por qué */
  }
  const puerta = createAdaptorServer({ fetch: app.fetch });
  puerta.on('error', (e: Error) => console.error(`[web] no pude abrir el socket ${ruta}: ${e.message}`));
  puerta.listen(ruta, () => console.log(`[web] y también por ${ruta}`));
}

export function startWeb() {
  return new Promise<void>((resolve) => {
    // 🪤 La puerta de servicio se abre ANTES que el puerto, y no dentro de su callback. Parece un detalle de
    // orden y no lo es: si el puerto no abre, ese callback no se llama nunca — o sea que la puerta pensada
    // justo para cuando el puerto falla solo existía cuando el puerto funcionaba. Lo encontró un simulacro.
    abrirPuertaDeServicio();
    let anunciado = false;
    const enPie = () => {
      if (anunciado) return;
      anunciado = true;
      startPublicCheck();
      // Si el lanzador se muere, este proceso se va con él: si no, se queda agarrando el puerto y —lo caro—
      // la sesión de WhatsApp del cliente, y la versión siguiente levanta una segunda copia que se pelea con
      // esta por el mismo número. Sin despedida: cerrar WhatsApp bonito costaría importar la librería aquí, que
      // son 77 MB por proceso. Al irse, el socket se cae solo y WhatsApp se entera igual.
      irseSiQuedaHuerfano();
      resolve();
    };
    // AIVA_BIND lo pone el lanzador (127.0.0.1): así este proceso no queda expuesto y, sobre todo, queda en una
    // dirección conocida en vez de en la que el sistema decida por su cuenta.
    const servidor = serve({ fetch: app.fetch, port: env.port, hostname: process.env.AIVA_BIND || undefined }, (info) => {
      const base = env.publicUrl || `http://localhost:${info.port}`;
      console.log(`[web] escuchando en http://localhost:${info.port}`);
      console.log(`[web] demo: ${base}/   widget: <script src="${base}/widget.js" async></script>`);
      if (channelOn('mcp')) console.log(`[web] MCP remoto: ${base}/mcp`);
      console.log(`[web] tablero: ${base}/admin`);
      if (metaConfigured()) console.log(`[meta] webhook de WhatsApp Cloud API: ${base}/webhooks/meta`);
      enPie();
    });
    // Que no abra el puerto ya no es motivo para morirse: con la puerta de servicio abierta se sigue
    // atendiendo, y el enrutador entra por ahí. Antes esto tumbaba el proceso y el lanzador lo reintentaba
    // cada cinco segundos, en bucle, sin que nadie viera por qué.
    servidor.on('error', (e: Error) => {
      console.error(`[web] no pude abrir el puerto ${env.port}: ${e.message}`);
      enPie();
    });
  });
}
