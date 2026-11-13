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
import { saludDelCliente } from '../salud.js';
import { rutaDe as rutaDeMedio } from '../crm/medios.js';
import { anotarOrigen, deLaUrl } from '../crm/origen.js';
import { atendiendoAhora } from '../crm/tiempos.js';
import { burbujaDe, paraCadenaJs, ventanaDe } from '../crm/chat-config.js';
import { mountAdmin } from './admin.js';
import { mountCalendar } from './calendar.js';
import { channelOn } from './switches.js';
import { preguntarAXencrm } from '../crm/consulta.js';
import { deDondeViene, direccionPermitida, libretaConfig } from '../crm/libreta-config.js';
import { leerAdjunto, TOPE_ARCHIVO } from '../crm/adjuntos.js';
import { irseSiQuedaHuerfano } from '../huerfano.js';
import { metaConfigured, mountMeta } from './meta.js';
import { paginaConCsp } from '../cabeceras.js';
import { adjuntarVoz, pedirLlamada, vozDisponible } from '../voz/llamada.js';
import { atenderLlamadaTelefonica, avisoValido } from '../voz/telefono.js';
import { nombreParaCanal } from '../agentico/agentes.js';
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
 * Si este cliente SIRVE, para que el lanzador lo recoja en /_salud.
 *
 * 🪤 Sin token, igual que /_salud, y por eso lo que sale de aquí está elegido para que no le sirva a nadie
 * para entrar: estados, cuentas y cuánto hace. Ni un número de teléfono, ni un trozo de conversación, ni una
 * pista de la llave. Ver salud.ts, que es quien decide qué se puede contar.
 */
app.get('/_servicio', (c) => c.json(saludDelCliente()));

/**
 * Para meter texto del negocio dentro del HTML de una página.
 *
 * 🪤 El nombre, el color y la dirección del logo los escribe quien configura el cliente, y de ahí salen a una
 * página que ve gente de la calle. Un `"` en el nombre del negocio rompería el atributo donde cae; algo peor,
 * escrito a propósito, haría más que romperlo.
 */
const escaparHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);

// ---------- La libreta: preguntarle algo a XENCRM, sin pasar por el tablero ----------
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
  return paginaConCsp(c, readFileSync(new URL('../../public/libreta.html', import.meta.url), 'utf8').replaceAll('__NEGOCIO__', business.business.name));
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
    return c.json(await preguntarAXencrm({ pregunta, antes, adjuntos }));
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

/**
 * El archivo de un mensaje, para el cliente que está en el chat del sitio.
 *
 * 🪤 Solo se entrega si ese archivo está en SU conversación. La sesión es lo único que hay para identificarlo
 * —no hay cuenta ni contraseña—, así que sin esta comprobación bastaría con tener cualquier sesión válida y
 * probar identificadores para bajarse los archivos de otros clientes del negocio. Se pregunta a la base si ese
 * medio aparece en un mensaje suyo; si no, no existe.
 */
app.get('/api/medio/:mid', (c) => {
  const sessionId = c.req.query('sessionId') ?? '';
  const mid = c.req.param('mid');
  if (!SESSION_RE.test(sessionId)) return c.json({ error: 'no existe' }, 404);
  const suyo = getMessages(`web:${sessionId}`, 200).some((m) => m.media?.id === mid);
  if (!suyo) return c.json({ error: 'no existe' }, 404);
  const ruta = rutaDeMedio(mid);
  if (!ruta) return c.json({ error: 'ya no está' }, 404);
  return new Response(new Uint8Array(readFileSync(ruta)), {
    headers: {
      // Como descarga y sin adivinar el tipo, igual que en el tablero: un archivo que mandó un desconocido no
      // se abre dentro de la página del negocio.
      'content-type': 'application/octet-stream',
      'content-disposition': 'attachment',
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, max-age=300',
    },
  });
});

// Historial de la conversación (el widget lo carga al abrir) y estado de atención.
app.get('/api/history', (c) => {
  const sessionId = c.req.query('sessionId') ?? '';
  if (!SESSION_RE.test(sessionId)) return c.json({ messages: [], human: false });
  const userId = `web:${sessionId}`;
  const contact = getContact(userId);
  return c.json({
    human: Boolean(contact?.humanMode),
    // El adjunto va con su mensaje: sin esto, el equipo manda una foto y el cliente ve un mensaje vacío.
    messages: getMessages(userId, 40).map((m) => ({ role: m.role, author: m.author, by: m.by, content: m.content, ts: m.ts, media: m.media ?? null })),
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
// 🪤 El chat del sitio no «envía»: el widget recoge lo que haya en la conversación. Por eso el emisor no hace
// nada y aun así DECLARA que lleva archivos — lo que importa no es quién los empuja, es si el cliente acaba
// viéndolos. Sin declararlo, el tablero escondía el botón de adjuntar en todas las conversaciones del sitio.
registerSender('web', async () => undefined, { medios: true });

mountAdmin(app);
mountMeta(app);
mountCalendar(app);

// Logo del cliente cuando es un archivo local (xencrm.config.json > brand.logo).
app.get('/brand/logo', (c) => {
  const logo = readLogo();
  if (!logo) return c.text('sin logo', 404);
  return c.body(new Uint8Array(logo.body), 200, { 'content-type': logo.type, 'cache-control': 'public, max-age=3600', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" });
});

// ---------- Voz (src/voz/llamada.ts) ----------
// Los dos archivos de la llamada: el cliente y el procesador del micrófono (un AudioWorklet, que se carga por URL).
for (const archivo of ['voz.js', 'voz-procesador.js']) {
  app.get(`/${archivo}`, (c) => c.body(readFileSync(new URL(`../../public/${archivo}`, import.meta.url), 'utf8'), 200, { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'public, max-age=300' }));
}

/**
 * El chat pide una llamada: un boleto firmado, de un solo uso, que dura un minuto, para abrir /voz/ws. Con la misma
 * sesión del chat, así lo que se diga queda en la misma conversación.
 */
app.post('/voz/llamada', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { sessionId?: unknown } | null;
  const sessionId = typeof body?.sessionId === 'string' && SESSION_RE.test(body.sessionId) ? body.sessionId : null;
  if (!sessionId) return c.json({ error: 'Falta la sesión del chat.' }, 400);
  const r = pedirLlamada({ sessionId, ip: clientIp(c) });
  if ('error' in r) return c.json({ error: r.error }, r.status);
  return c.json(r);
});

/**
 * El aviso de xAI de que entró una llamada por teléfono (voz/telefono.ts). Se verifica la firma ANTES de leer nada;
 * se contesta enseguida y la llamada se atiende aparte (xAI no espera a que el agente termine de saludar).
 */
app.post('/voz/sip', async (c) => {
  const cuerpo = await c.req.text();
  if (!avisoValido(cuerpo, { id: c.req.header('webhook-id'), ts: c.req.header('webhook-timestamp'), firma: c.req.header('webhook-signature') })) return c.json({ error: 'firma inválida' }, 401);
  let aviso: { type?: string; data?: { call_id?: string; sip_headers?: { name?: string; value?: string }[] } };
  try {
    aviso = JSON.parse(cuerpo);
  } catch {
    return c.json({ error: 'cuerpo inválido' }, 400);
  }
  // Otros avisos de xAI se reciben y no hacen nada: contestar 200 evita que los reintente.
  if (aviso.type !== 'realtime.call.incoming' || !aviso.data?.call_id) return c.json({ ok: true });
  void atenderLlamadaTelefonica(aviso.data.call_id, aviso.data.sip_headers).catch((err: Error) => console.warn(`[telefono] ${err.message}`));
  return c.json({ ok: true });
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
    // Saluda el agente que atiende el chat (agentico/agentes.ts): el mismo que va a contestar.
    .replace('__AGENT_NAME__', nombreParaCanal('web'))
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
  return paginaConCsp(c, html);
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
  // 🪤 El asistente contesta SIEMPRE: el horario del negocio es de las PERSONAS, no suyo. Para eso está.
  //
  // Esto decía «fuera de horario» mirando las franjas de las CITAS, y un negocio que agenda de 10 a 13 y de 15
  // a 19 tiene un hueco a las 14:30 que es el almuerzo, no el cierre. Resultado: le dijo a un cliente que no
  // esperara respuesta —delante de gente— mientras el asistente contestaba igual de bien. Un rótulo que
  // contradice lo que la pantalla está haciendo es peor que no tener rótulo.
  //
  // Fuera de la jornada solo cambia el matiz: contesta igual, y lo que tarda es que entre una persona.
  const atendiendo = atendiendoAhora();
  const estado = !prendido
    ? '<span class="pulso frio"></span>El chat está cerrado'
    : atendiendo
      ? '<span class="pulso"></span>En línea · suele responder en segundos'
      : '<span class="pulso"></span>En línea · si hace falta una persona, te escribe apenas abran';

  const cuerpo = prendido
    ? `<div id="xencrm-ventana"></div>\n<p class="pie">${escaparHtml(v.pie || 'Esta conversación queda guardada en este navegador.')}</p>\n<script src="widget.js" data-modo="ventana" async></script>`
    : // No se deja una caja de texto que se traga los mensajes: se dice que está cerrado y por dónde sí llegan.
      // Lo que se ofrece es lo que el propio negocio escribió en «cómo contactar a una persona», que es lo
      // único que aquí se sabe de cierto; inventar un enlace a WhatsApp con un número que no tenemos sería
      // mandar a la gente a una puerta que no existe.
      `<div class="cerrado"><h2>Ahora mismo no estamos en el chat</h2><p>${escaparHtml(v.cerradaDice || business.business.humanContact || 'Vuelve en un rato y con gusto te atendemos.')}</p></div>`;

  // La llamada de voz, si el negocio tiene un agente de voz (Configuración › Agentes) y la llave de xAI.
  const voz = prendido ? vozDisponible() : { ok: false };
  const icono = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/></svg>';
  const vozBoton = voz.ok && voz.agente
    ? `<button class="llamar" id="voz-llamar" type="button" data-agente="${escaparHtml(voz.agente)}" hidden>${icono}<span>Hablar con ${escaparHtml(voz.agente)}</span></button>`
    : '';
  const vozFranja = voz.ok
    ? '<div class="llamada" id="voz-llamada" role="region" aria-label="Llamada de voz" hidden><span class="onda" aria-hidden="true"><i></i><i></i><i></i></span><span class="estado" id="voz-estado" role="status"></span><span class="tiempo" id="voz-tiempo">0:00</span><button class="colgar" id="voz-colgar" type="button">Colgar</button></div>\n<script src="voz.js" defer></script>'
    : '';
  // 🪤 El micrófono está cerrado para todas las páginas (borde.cjs): esta lo pide con una marca de adentro que el
  // enrutador cambia por microphone=(self) y quita antes de salir. Solo aquí y solo con la voz disponible.
  if (voz.ok) c.header('x-xencrm-microfono', 'si');
  const html = readFileSync(new URL('../../public/chat.html', import.meta.url), 'utf8')
    .replaceAll('__VOZ_BOTON__', vozBoton)
    .replaceAll('__VOZ_FRANJA__', vozFranja)
    .replaceAll('__STORE_NAME__', escaparHtml(v.titulo || business.business.name))
    .replaceAll('__AGENT_NAME__', escaparHtml(nombreParaCanal('web')))
    .replaceAll('__BRAND_COLOR__', /^#[0-9a-fA-F]{6}$/.test(business.brand.color) ? business.brand.color : '#2f7d4f')
    .replaceAll('__MARCA__', marca)
    .replaceAll('__ESTADO__', estado)
    .replaceAll('__CUERPO__', cuerpo);
  return paginaConCsp(c, html);
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
 * procesos ven la misma carpeta, se hablan. Solo se abre cuando el lanzador dice por dónde (XENCRM_SOCK); a mano
 * no sobra nada. Si falla, se avisa y se sigue: el puerto es la puerta principal, esta es la de servicio.
 */
function abrirPuertaDeServicio(): void {
  const ruta = process.env.XENCRM_SOCK;
  if (!ruta) return;
  try {
    rmSync(ruta, { force: true }); // el del arranque anterior, que si no, no deja abrir
  } catch {
    /* si no se puede borrar, el listen dirá por qué */
  }
  const puerta = createAdaptorServer({ fetch: app.fetch });
  puerta.on('error', (e: Error) => console.error(`[web] no pude abrir el socket ${ruta}: ${e.message}`));
  adjuntarVoz(puerta as unknown as import('node:http').Server); // el enrutador entra por aquí: la voz también
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
    // XENCRM_BIND lo pone el lanzador (127.0.0.1): así este proceso no queda expuesto y, sobre todo, queda en una
    // dirección conocida en vez de en la que el sistema decida por su cuenta.
    const servidor = serve({ fetch: app.fetch, port: env.port, hostname: process.env.XENCRM_BIND || undefined }, (info) => {
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
    // La voz sube a WebSocket por /voz/ws (src/voz/llamada.ts).
    adjuntarVoz(servidor as unknown as import('node:http').Server);
    servidor.on('error', (e: Error) => {
      console.error(`[web] no pude abrir el puerto ${env.port}: ${e.message}`);
      enPie();
    });
  });
}
