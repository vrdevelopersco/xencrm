import makeWASocket, {
  Browsers,
  DisconnectReason,
  isJidGroup,
  isJidNewsletter,
  isJidStatusBroadcast,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
  type WAMessage,
  type WAMessageKey,
  type WASocket,
  type proto,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { env } from '../config.js';
import { guardarImportados } from '../crm/historial.js';
import { anotarCursor, cursores } from '../crm/wa-cursor.js';
import { handleMessage } from '../agent/agent.js';
import { conFirma, registerSender } from '../crm/outbox.js';

const logger = pino({ level: 'silent' });

interface Pending {
  texts: string[];
  keys: WAMessageKey[];
  name?: string;
  timer: NodeJS.Timeout;
}
// Agrupa mensajes seguidos del mismo cliente ("hola" + "tienen macetas?") en una sola respuesta.
const pending = new Map<string, Pending>();

// ---------- Estado para el tablero (sección Canales) ----------
export type WhatsAppState = 'apagado' | 'conectando' | 'esperando_qr' | 'conectado' | 'sesion_cerrada';
const status: { state: WhatsAppState; qr?: string; me?: string; error?: string; since: number } = { state: 'apagado', since: Date.now() };
let current: WASocket | null = null;
let wanted = false; // se apagó desde el tablero: no reconectar

function setStatus(state: WhatsAppState, extra: { qr?: string; me?: string; error?: string } = {}) {
  Object.assign(status, { state, qr: undefined, error: undefined, ...extra, since: Date.now() });
}

/** Los últimos cortes, para ver el patrón: cuánto aguantó cada intento y con qué razón se cayó. */
export const cierres: { cuando: number; code: number | null; razon: string; duroSegundos: number }[] = [];

export function whatsappStatus() {
  return { ...status, qrSvg: status.qr ? qrSvg(status.qr) : undefined };
}

// El codificador QR que ya trae qrcode-terminal, dibujado como SVG para escanearlo desde el tablero.
const require = createRequire(import.meta.url);
export function qrSvg(text: string): string {
  const QRCode = require('qrcode-terminal/vendor/QRCode') as new (type: number, level: number) => {
    addData(d: string): void;
    make(): void;
    getModuleCount(): number;
    isDark(r: number, c: number): boolean;
  };
  const level = (require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel') as { L: number }).L;
  const qr = new QRCode(-1, level);
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 4;
  let path = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) path += `M${c + quiet} ${r + quiet}h1v1h-1z`;
  const size = n + quiet * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

export async function stopWhatsApp(): Promise<void> {
  wanted = false;
  const sock = current;
  current = null;
  sock?.end(undefined);
  setStatus('apagado');
}

/**
 * Pide a WhatsApp más historial hacia atrás, chat por chat, sin desvincular nada.
 *
 * Hace falta porque lo que WhatsApp manda al emparejar es solo lo reciente, y hasta ahora la única forma de
 * traer más era desvincular y volver a escanear —justo lo que nadie quiere hacer con el número de un negocio en
 * marcha—. Con esto, «traer más» es un botón.
 *
 * 🪤 Lo que se pide NO llega en la respuesta: llega después, por el mismo camino que el historial del
 * emparejamiento, y puede tardar minutos. Por eso esto devuelve cuántos chats se pidieron, no cuántos mensajes
 * llegaron.
 */
/**
 * Empezar de cero: cierra la sesión y borra las credenciales guardadas, para que la próxima vez salga un código
 * nuevo y se vincule como la primera vez.
 *
 * Hace falta de verdad y no es un capricho: al vincular, WhatsApp manda **una sola vez** lo que ya estaba
 * conversado, y eso es de donde el negocio aprende cómo atiende. Si se quiere volver a traer, hay que vincular
 * otra vez. Sin este botón habría que entrar al servidor a borrar una carpeta a mano —y quien usa el tablero no
 * tiene por qué entrar a ningún servidor—. Lo mismo cuando cierran la sesión desde el teléfono: sin esto, el
 * canal se quedaba atascado sin forma de arreglarlo desde aquí.
 */
export async function traerMasHistorial(porChat = 50, cuantosChats = 25): Promise<{ chats: number; quedan: number; error?: string }> {
  const sock = current;
  if (!sock || status.state !== 'conectado') return { chats: 0, quedan: 0, error: 'WhatsApp no está conectado ahora mismo.' };
  // 🪤 Por tandas y no todo de un tajo: pedir cien conversaciones a la vez es pedirle a WhatsApp que vuelque
  // media cuenta de golpe, y eso ni llega entero ni se sabe por dónde iba. Se piden unas cuantas, empezando por
  // las que tienen lo más antiguo, y se dice cuántas quedan para poder seguir.
  const todos = cursores(500);
  const pendientes = todos.slice(0, Math.max(1, cuantosChats));
  if (!pendientes.length) return { chats: 0, quedan: 0, error: 'Todavía no hay chats de los que pedir más: llegan al vincular el número.' };
  let pedidos = 0;
  for (const c of pendientes) {
    try {
      await sock.fetchMessageHistory(porChat, { remoteJid: c.chat, id: c.keyId, fromMe: c.fromMe }, Math.floor(c.ts / 1000));
      pedidos++;
    } catch (err) {
      console.error('[whatsapp] no pude pedir más historial de', c.chat.split('@')[0], (err as Error).message);
    }
  }
  console.log(`[whatsapp] pedido más historial de ${pedidos} chats; llega solo en los próximos minutos`);
  return { chats: pedidos, quedan: Math.max(0, todos.length - pendientes.length) };
}

export async function olvidarSesionWhatsApp(): Promise<void> {
  await stopWhatsApp();
  rmSync(env.whatsappAuthDir, { recursive: true, force: true });
  mkdirSync(env.whatsappAuthDir, { recursive: true });
  setStatus('apagado');
}

export async function startWhatsApp(): Promise<WASocket> {
  wanted = true;
  setStatus('conectando');
  const { state, saveCreds } = await useMultiFileAuthState(env.whatsappAuthDir);
  const sock = makeWASocket({
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
    logger,
    browser: Browsers.macOS('Desktop'),
    markOnlineOnConnect: false, // así el teléfono sigue recibiendo notificaciones
    // Traer lo ya conversado se pide a propósito (WHATSAPP_IMPORT_HISTORY): de ahí salen las preguntas que le
    // hacen al negocio y cómo atiende, nunca precios ni políticas (docs/aprender-del-historial.md).
    // 🪤 En `true` esto impide vincular: WhatsApp cierra la conexión con 428 antes de entregar el código, una y
    // otra vez. Comprobado a los dos lados —con la opción apagada el código sale en dos segundos, con ella
    // encendida no sale nunca—. Se deja porque hay cuentas donde sí funciona, pero nunca encendido de fábrica.
    syncFullHistory: env.whatsappImportHistory,
    generateHighQualityLinkPreview: false,
  });
  current = sock;

  sock.ev.on('creds.update', saveCreds);
  registerSender('whatsapp', async (userId, text) => {
    const jid = userId.replace(/^wa:/, '');
    await sock.sendMessage(jid, { text });
  });

  sock.ev.on('connection.update', (u) => {
    if (sock !== current) return; // un socket viejo (apagado o reemplazado) ya no manda
    if (u.qr) {
      console.log('\n[whatsapp] Escanea este QR (o desde el tablero, en Canales): WhatsApp > Dispositivos vinculados > Vincular dispositivo\n');
      qrcode.generate(u.qr, { small: true });
      setStatus('esperando_qr', { qr: u.qr });
    }
    if (u.connection === 'open') {
      console.log(`[whatsapp] conectado como ${sock.user?.id ?? '?'}`);
      setStatus('conectado', { me: jidNormalizedUser(sock.user?.id ?? '').split('@')[0] });
    }
    if (u.connection === 'close') {
      const code = (u.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.error(`[whatsapp] sesión cerrada desde el teléfono. Borra ${env.whatsappAuthDir} y vuelve a escanear el QR.`);
        setStatus('sesion_cerrada', { error: `Se cerró la sesión desde el teléfono. Borra la carpeta ${env.whatsappAuthDir} y vuelve a encender el canal para escanear un QR nuevo.` });
        return;
      }
      if (!wanted) return;
      // 🪤 El número del cierre no basta para saber qué pasó: 428 sale igual si el camino está cortado, si el
      // proceso se duerme o si WhatsApp rechaza la sesión de esta máquina. Lo que lo distingue es el mensaje y,
      // sobre todo, **cuánto aguantó abierta**: un rechazo corta a los pocos segundos, siempre igual.
      const razon = (u.lastDisconnect?.error as Error | undefined)?.message ?? '';
      const duro = Math.round((Date.now() - status.since) / 1000);
      cierres.unshift({ cuando: Date.now(), code: code ?? null, razon, duroSegundos: duro });
      cierres.splice(8);
      console.log(`[whatsapp] conexión cerrada (${code ?? 'sin código'}${razon ? `: ${razon}` : ''}) tras ${duro}s, reconectando en 3s...`);
      setStatus('conectando', { error: `Conexión cerrada (${code ?? 'sin código'}${razon ? `: ${razon}` : ''}) tras ${duro} s; reconectando.` });
      setTimeout(() => {
        if (wanted && sock === current) void startWhatsApp();
      }, 3000);
    }
  });

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages) onMessage(sock, m);
  });

  // Lo que ya estaba conversado cuando vincularon el número. Solo se lee y se guarda aparte: no se responde nada,
  // no entra a las conversaciones del CRM ni a lo que el asistente sabe.
  //
  // 🪤 Esto se escucha SIEMPRE, sin condición. Son dos cosas distintas que estuvieron atadas a la misma variable
  // y no lo están: `syncFullHistory` **pide** todo el historial —y eso impide vincular—, mientras que esto solo
  // **recoge** lo que WhatsApp manda por su cuenta al vincular, que es gratis y llega igual. Al apagar lo
  // primero se apagaba lo segundo, así que se vinculaba bien y no se aprendía nada: cero mensajes, sin un aviso.
  {
    sock.ev.on('messaging-history.set', ({ messages, isLatest }) => {
      const leidos = (messages ?? []).flatMap((m) => {
        const jid = m.key?.remoteJid;
        if (!jid || !m.message || isJidStatusBroadcast(jid) || isJidNewsletter(jid) || isJidGroup(jid)) return [];
        const texto = extractText(m.message);
        if (!texto) return [];
        const ts = Number(m.messageTimestamp ?? 0) * 1000;
        if (!ts) return [];
        return [{
          chat: jidNormalizedUser(jid),
          autor: m.key.fromMe ? 'negocio' : (m.pushName ?? jidNormalizedUser(jid).split('@')[0] ?? ''),
          role: (m.key.fromMe ? 'assistant' : 'user') as 'assistant' | 'user',
          content: texto,
          ts,
        }];
      });
      // Por dónde va cada chat: el mensaje más antiguo que tenemos. Es lo que hace falta para pedir más hacia
      // atrás después, sin desvincular el número.
      for (const m of messages ?? []) {
        const jid = m.key?.remoteJid;
        const ts = Number(m.messageTimestamp ?? 0) * 1000;
        if (!jid || !m.key?.id || !ts || isJidStatusBroadcast(jid) || isJidNewsletter(jid) || isJidGroup(jid)) continue;
        anotarCursor({ chat: jidNormalizedUser(jid), keyId: m.key.id, fromMe: Boolean(m.key.fromMe), ts });
      }
      const nuevos = leidos.length ? guardarImportados(leidos, 'whatsapp') : 0;
      if (nuevos) console.log(`[whatsapp] historial: ${nuevos} mensajes guardados para aprender (Perfil › Lo que aprendimos de sus chats)`);
      if (isLatest) console.log('[whatsapp] historial: terminó de sincronizar');
    });
  }

  return sock;
}

function onMessage(sock: WASocket, m: WAMessage) {
  if (!m.message || m.key.fromMe) return;
  const jid = m.key.remoteJid;
  if (!jid || isJidStatusBroadcast(jid) || isJidNewsletter(jid)) return;
  if (isJidGroup(jid) && env.whatsappIgnoreGroups) return;

  if (env.whatsappAllowedNumbers.length) {
    // Con LIDs (jid @lid) el número real viene en remoteJidAlt; se aceptan ambos.
    const alt = (m.key as { remoteJidAlt?: string | null }).remoteJidAlt ?? '';
    const numbers = [jid, alt].filter(Boolean).map((j) => jidNormalizedUser(j).split('@')[0] ?? '');
    if (!numbers.some((n) => env.whatsappAllowedNumbers.includes(n))) return;
  }

  const text = extractText(m.message);
  const key = m.key;
  const name = m.pushName ?? undefined;

  if (text === null) {
    // Audio, imagen sin texto, sticker, etc.
    void sock.readMessages([key]);
    void sock.sendMessage(jid, { text: 'Por ahora solo puedo leer mensajes de texto 🙂 ¿Me lo escribes?' });
    return;
  }

  const p = pending.get(jid);
  if (p) {
    clearTimeout(p.timer);
    p.texts.push(text);
    p.keys.push(key);
    p.timer = setTimeout(() => void flush(sock, jid), env.debounceMs);
  } else {
    pending.set(jid, { texts: [text], keys: [key], name, timer: setTimeout(() => void flush(sock, jid), env.debounceMs) });
  }
}

async function flush(sock: WASocket, jid: string) {
  const p = pending.get(jid);
  if (!p) return;
  pending.delete(jid);
  try {
    await sock.readMessages(p.keys);
    await sock.sendPresenceUpdate('composing', jid);
    const reply = await handleMessage({
      userId: `wa:${jid}`,
      channel: 'whatsapp',
      text: p.texts.join('\n'),
      userName: p.name ?? null,
    });
    await sock.sendPresenceUpdate('paused', jid);
    if (reply.silent || !reply.text) return; // una persona del equipo responderá desde el tablero
    // Firmado igual que lo que manda una persona desde el tablero: por este número contestan los dos, y el
    // cliente tiene derecho a saber con quién está hablando.
    await sock.sendMessage(jid, { text: conFirma(reply.text, 'bot', 'whatsapp') });
  } catch (err) {
    console.error('[whatsapp] error respondiendo:', err);
  }
}

/** Devuelve el texto del mensaje, o null si no es un mensaje de texto (audio, sticker...). */
function extractText(message: proto.IMessage): string | null {
  const inner =
    message.ephemeralMessage?.message ??
    message.viewOnceMessage?.message ??
    message.viewOnceMessageV2?.message ??
    message.documentWithCaptionMessage?.message ??
    message;
  const text =
    inner.conversation ??
    inner.extendedTextMessage?.text ??
    inner.imageMessage?.caption ??
    inner.videoMessage?.caption ??
    inner.documentMessage?.caption ??
    null;
  if (text && text.trim()) return text.trim();
  // Mensajes de protocolo (reacciones, eliminados, claves) se ignoran en silencio.
  if (inner.protocolMessage || inner.reactionMessage || inner.senderKeyDistributionMessage) return '';
  return null;
}
