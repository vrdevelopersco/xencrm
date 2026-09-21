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
import { createRequire } from 'node:module';
import { env } from '../config.js';
import { handleMessage } from '../agent/agent.js';
import { registerSender } from '../crm/outbox.js';

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

export function whatsappStatus() {
  return { ...status, qrSvg: status.qr ? qrSvg(status.qr) : undefined };
}

// El codificador QR que ya trae qrcode-terminal, dibujado como SVG para escanearlo desde el tablero.
const require = createRequire(import.meta.url);
function qrSvg(text: string): string {
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

export async function startWhatsApp(): Promise<WASocket> {
  wanted = true;
  setStatus('conectando');
  const { state, saveCreds } = await useMultiFileAuthState(env.whatsappAuthDir);
  const sock = makeWASocket({
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
    logger,
    browser: Browsers.macOS('Desktop'),
    markOnlineOnConnect: false, // así el teléfono sigue recibiendo notificaciones
    syncFullHistory: false,
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
      console.log(`[whatsapp] conexión cerrada (${code ?? 'sin código'}), reconectando en 3s...`);
      setStatus('conectando', { error: `Conexión cerrada (${code ?? 'sin código'}); reconectando.` });
      setTimeout(() => {
        if (wanted && sock === current) void startWhatsApp();
      }, 3000);
    }
  });

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages) onMessage(sock, m);
  });

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
    await sock.sendMessage(jid, { text: reply.text });
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
