// El conector de WhatsApp: la única pieza que corre fuera del servidor.
//
//   pnpm conector            (con XENCRM_URL y XENCRM_TOKEN en el entorno o en conector.env)
//
// Qué es: un proceso pequeño que mantiene la sesión de WhatsApp de un cliente y se la presta al CRM, que sigue
// donde estaba. Existe porque WhatsApp rechaza las conexiones que salen de un alojamiento compartido —cierra al
// instante, sin decir por qué— mientras que desde un equipo normal funciona a la primera. Mover el CRM entero
// por eso sería mover los datos de un cliente por un problema de red; esto mueve solo el cable.
//
// Para quien usa el tablero no cambia nada: el código QR aparece en la misma pantalla de siempre y las
// conversaciones llegan donde siempre. Ni se entera de que hay otra máquina.
//
// 🪤 Todas las conversaciones las empieza el conector. Vive detrás del router de una casa o una oficina, así que
// el CRM no tiene a dónde llamarle: le deja en un buzón lo que hay que mandar y el conector pasa a recogerlo.
// Por eso aquí no hay servidor ni puerto abierto, y por eso no hace falta tocar nada en la red.
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
  type WASocket,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { existsSync, readFileSync } from 'node:fs';

// ---------- Lo que necesita saber ----------
for (const linea of existsSync('conector.env') ? readFileSync('conector.env', 'utf8').split('\n') : []) {
  const m = /^\s*([A-Z_]+)\s*=\s*(.*)$/.exec(linea);
  if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.trim().replace(/^["']|["']$/g, '');
}
const URL_CRM = (process.env.XENCRM_URL ?? '').replace(/\/$/, '');
const TOKEN = process.env.XENCRM_TOKEN ?? '';
const CARPETA = process.env.WHATSAPP_AUTH_DIR ?? 'auth-conector';
if (!URL_CRM || !TOKEN) {
  console.error(
    'Faltan datos. Crea un archivo `conector.env` junto a esto con:\n\n' +
      '  XENCRM_URL=https://xencrm.tu-dominio.com/<cliente>\n' +
      '  XENCRM_TOKEN=<el token del tablero de ese cliente>\n' +
      '  WHATSAPP_AUTH_DIR=auth-conector\n',
  );
  process.exit(1);
}

const logger = pino({ level: 'silent' });
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Una llamada al CRM. Si no contesta, se avisa y se sigue: el conector nunca se muere por eso. */
async function alCrm(ruta: string, cuerpo?: unknown): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(`${URL_CRM}/admin/api/puente/${ruta}`, {
      method: cuerpo === undefined ? 'GET' : 'POST',
      headers: { 'x-admin-token': TOKEN, ...(cuerpo === undefined ? {} : { 'content-type': 'application/json' }) },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) {
      console.error(`[conector] el CRM contestó ${r.status} en ${ruta}`);
      return null;
    }
    return (await r.json()) as Record<string, unknown>;
  } catch (err) {
    console.error(`[conector] no pude hablar con el CRM (${ruta}):`, (err as Error).message);
    return null;
  }
}

// ---------- Estado ----------
let sock: WASocket | null = null;
let quiereEstar = true;
let ultimoEstado = '';

async function contar(estado: string, extra: { qr?: string; me?: string; error?: string } = {}) {
  if (estado !== ultimoEstado) console.log(`[conector] ${estado}${extra.me ? ` como ${extra.me}` : ''}${extra.error ? `: ${extra.error}` : ''}`);
  ultimoEstado = estado;
  const r = await alCrm('estado', { estado, ...extra });
  // El CRM manda: si desde el tablero apagaron el canal, el conector cierra la sesión.
  if (r && r.debeEstarEncendido === false && quiereEstar) {
    console.log('[conector] apagaron WhatsApp desde el tablero; cierro la sesión.');
    quiereEstar = false;
    try {
      sock?.end(undefined);
    } catch {
      /* ya estaba cerrada */
    }
    sock = null;
  }
  if (r && r.debeEstarEncendido === true && !quiereEstar) {
    console.log('[conector] lo encendieron desde el tablero; abro la sesión.');
    quiereEstar = true;
    void abrir();
  }
}

/** El texto de un mensaje, o null si es una foto, un audio o algo que aquí no se lee. */
const textoDe = (m: WAMessage): string | null =>
  m.message?.conversation ??
  m.message?.extendedTextMessage?.text ??
  m.message?.imageMessage?.caption ??
  m.message?.videoMessage?.caption ??
  null;

async function abrir(): Promise<void> {
  const { state, saveCreds } = await useMultiFileAuthState(CARPETA);
  await contar('conectando');
  const s = makeWASocket({
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
    logger,
    browser: Browsers.macOS('Desktop'),
    markOnlineOnConnect: false, // que el teléfono del negocio siga recibiendo sus notificaciones
    // 🪤 Ver whatsapp.ts: en `true` WhatsApp no deja vincular (cierra con 428 antes del código).
    syncFullHistory: process.env.WHATSAPP_IMPORT_HISTORY === 'true',
    generateHighQualityLinkPreview: false,
  });
  sock = s;
  s.ev.on('creds.update', saveCreds);

  s.ev.on('connection.update', (u) => {
    if (sock !== s) return; // una sesión vieja ya no manda
    if (u.qr) {
      // El código se enseña en el tablero, que es donde la persona lo está esperando. En la terminal también,
      // por si quien lo monta está delante de esta máquina.
      qrcode.generate(u.qr, { small: true });
      void contar('esperando_qr', { qr: u.qr });
    }
    if (u.connection === 'open') void contar('conectado', { me: jidNormalizedUser(s.user?.id ?? '').split('@')[0] });
    if (u.connection === 'close') {
      const code = (u.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        void contar('sesion_cerrada', { error: `Cerraron la sesión desde el teléfono. Borra la carpeta ${CARPETA} y vuelve a escanear.` });
        quiereEstar = false;
        return;
      }
      if (!quiereEstar) return;
      void contar('conectando', { error: `Se cortó (${code ?? 'sin código'}); reconectando.` });
      setTimeout(() => {
        if (quiereEstar && sock === s) void abrir();
      }, 3000);
    }
  });

  // Lo que escriben los clientes: va al CRM, y lo que el CRM conteste se manda de vuelta.
  s.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages) void entrante(s, m);
  });

  // Lo ya conversado antes de vincular: de ahí sale cómo atiende el negocio.
  s.ev.on('messaging-history.set', ({ messages, isLatest }) => {
    const lote = (messages ?? []).flatMap((m) => {
      const jid = m.key?.remoteJid;
      if (!jid || !m.message || isJidStatusBroadcast(jid) || isJidNewsletter(jid) || isJidGroup(jid)) return [];
      const texto = textoDe(m);
      const ts = Number(m.messageTimestamp ?? 0) * 1000;
      if (!texto || !ts) return [];
      return [{
        chat: jidNormalizedUser(jid),
        autor: m.key.fromMe ? 'negocio' : (m.pushName ?? jidNormalizedUser(jid).split('@')[0] ?? ''),
        role: (m.key.fromMe ? 'assistant' : 'user') as 'assistant' | 'user',
        content: texto,
        ts,
      }];
    });
    if (!lote.length) return;
    void alCrm('historial', { mensajes: lote }).then((r) => {
      if (r) console.log(`[conector] historial: ${r.nuevos ?? 0} mensajes nuevos${isLatest ? ' (terminó de sincronizar)' : ''}`);
    });
  });
}

async function entrante(s: WASocket, m: WAMessage): Promise<void> {
  if (!m.message || m.key.fromMe) return;
  const jid = m.key.remoteJid;
  if (!jid || isJidStatusBroadcast(jid) || isJidNewsletter(jid) || isJidGroup(jid)) return;
  const texto = textoDe(m);
  if (!texto) return;
  try {
    await s.readMessages([m.key]);
  } catch {
    /* si no se pudo marcar como leído, da igual */
  }
  const r = await alCrm('entrante', { jid: jidNormalizedUser(jid), texto, nombre: m.pushName ?? null });
  // El CRM manda el texto ya firmado: aquí no se decide nada sobre cómo se ve.
  const responder = r?.responder;
  if (typeof responder === 'string' && responder.trim()) {
    await s.sendMessage(jidNormalizedUser(jid), { text: responder });
  }
}

/** El buzón: lo que el equipo escribió desde el tablero y está esperando salir. */
async function recogerYMandar(): Promise<void> {
  if (!sock || ultimoEstado !== 'conectado') return;
  const r = await alCrm('salida');
  const mensajes = (r?.mensajes ?? []) as { userId: string; texto: string }[];
  for (const msj of mensajes) {
    const jid = msj.userId.replace(/^wa:/, '');
    try {
      await sock.sendMessage(jid, { text: msj.texto });
      console.log(`[conector] enviado a ${jid.split('@')[0]}`);
    } catch (err) {
      console.error(`[conector] no pude enviar a ${jid.split('@')[0]}:`, (err as Error).message);
    }
  }
}

console.log(`[conector] hablando con ${URL_CRM}`);
await abrir();
// Dos ritmos: recoger lo que hay que mandar, y dar señales de vida para que el tablero sepa que esto está aquí.
for (;;) {
  await esperar(2000);
  await recogerYMandar();
  if (Date.now() % 30_000 < 2000) await contar(ultimoEstado || 'conectando');
}
