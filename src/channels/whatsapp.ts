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
import { business, env } from '../config.js';
import { aprenderDeLaRespuesta, contactosDelHistorial, guardarImportados, ultimosDeChat } from '../crm/historial.js';
import { appendMessage, touchUser } from '../agent/memory.js';
import { getContact, setHumanMode, updateContact } from '../crm/contacts.js';
import { emitEvent } from '../crm/events.js';
import { anotarCursor, cursores } from '../crm/wa-cursor.js';
import { anotarParticipante, quienEsQuien } from '../crm/grupo-gente.js';
import { handleMessage } from '../agent/agent.js';
import { conFirma, registerSender } from '../crm/outbox.js';
import { grupos, propone, soloEscucha } from './switches.js';
import { cierres, setStatus, status, whatsappStatus, type WhatsAppState } from './whatsapp-estado.js';

export { cierres, whatsappStatus, qrSvg } from './whatsapp-estado.js';
export type { WhatsAppState } from './whatsapp-estado.js';

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
// La sesión abierta ahora mismo y si se la quiere abierta. Vive aquí porque es la librería la que la sostiene;
// el estado que mira el tablero está en whatsapp-estado.ts, que no carga nada pesado.
let current: WASocket | null = null;
let wanted = false;
// Los mensajes que salieron de aiva por este socket: WhatsApp los devuelve marcados como propios y, sin esta
// lista, se guardarían otra vez como si los hubiera escrito una persona.
const enviadosPorAiva = new Set<string>();
async function mandar(sock: WASocket, jid: string, texto: string): Promise<void> {
  const enviado = await sock.sendMessage(jid, { text: texto });
  const id = enviado?.key?.id;
  if (id) {
    enviadosPorAiva.add(id);
    if (enviadosPorAiva.size > 300) enviadosPorAiva.delete(enviadosPorAiva.values().next().value as string);
  }
}
// Cortes seguidos sin haber llegado a aguantar abierta. Sirve para dos cosas: esperar cada vez un poco más en
// vez de golpear cada tres segundos, y darse cuenta de cuándo no tiene sentido seguir.
let seguidas = 0;

export async function stopWhatsApp(): Promise<void> {
  wanted = false;
  seguidas = 0; // apagar y volver a encender es lo que hace alguien que ya resolvió el problema: se empieza de cero
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
    await mandar(sock, userId.replace(/^wa:/, ''), text);
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
      const comoSeCerro = `${code ?? 'sin código'}${razon ? `: ${razon}` : ''}`;
      // Si aguantó un rato, lo de antes ya no cuenta: fue un corte suelto, no una pelea.
      seguidas = duro >= 60 ? 0 : seguidas + 1;

      // 🪤 Dos sitios con el mismo número: WhatsApp echa a uno, el echado vuelve y echa al otro, y así para
      // siempre. Reintentar no lo arregla, lo mantiene vivo — y machacar la reconexión con el número de un
      // negocio real es además la mejor forma de que se lo bloqueen. Así que a la cuarta se para y se dice.
      if ((code === 440 || /conflict/i.test(razon)) && seguidas >= 4) {
        console.error('[whatsapp] este número lo tiene abierto otro sitio: cada uno echa al otro. Dejo de reintentar.');
        setStatus('conflicto', {
          error:
            'Este WhatsApp está abierto en otro sitio a la vez (otra copia del servidor, otra máquina o el teléfono vinculado dos veces) y cada uno echa al otro. ' +
            'Déjalo en un solo sitio y vuelve a encender el canal aquí.',
        });
        return;
      }

      // Cada vez se espera un poco más: si es algo pasajero se recupera igual de rápido, y si no lo es, no se
      // pasa la noche llamando a la puerta.
      const espera = [3, 3, 6, 12, 30, 60][Math.min(seguidas, 5)]!;
      console.log(`[whatsapp] conexión cerrada (${comoSeCerro}) tras ${duro}s, reconectando en ${espera}s...`);
      setStatus('conectando', { error: `Conexión cerrada (${comoSeCerro}) tras ${duro} s; reconectando en ${espera} s.` });
      setTimeout(() => {
        if (wanted && sock === current) void startWhatsApp();
      }, espera * 1000);
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
      // Lo traído no se queda en un limbo: cada chat se puede abrir y leer entero desde Conversaciones.
      if (nuevos) {
        const altas = contactosDelHistorial();
        if (altas) console.log(`[whatsapp] historial: ${altas} conversaciones nuevas para abrir en el tablero`);
      }
      if (nuevos) console.log(`[whatsapp] historial: ${nuevos} mensajes guardados para aprender (Perfil › Lo que aprendimos de sus chats)`);
      if (isLatest) console.log('[whatsapp] historial: terminó de sincronizar');
    });
  }

  return sock;
}

/**
 * Lo que el negocio contesta desde SU PROPIO teléfono.
 *
 * 🪤 Esto se descartaba en la primera línea (`if (m.key.fromMe) return`), y era razonable mientras aiva fuera
 * la única que contestaba. Con el canal en «solo escuchar» deja de serlo: el negocio sigue atendiendo desde su
 * teléfono y el tablero enseñaba **media conversación** —lo que escribía el cliente y ninguna respuesta—.
 * Quien miraba creía que se había perdido lo que ya había escrito.
 *
 * Así que se guarda, como lo que es: una persona del negocio respondiendo. Y entra al aprendizaje igual que lo
 * que se contesta desde el tablero, porque es exactamente lo mismo: su forma de atender.
 */
function anotarLoDelNegocio(m: WAMessage, jid: string, texto: string): void {
  // Lo que mandó aiva por este mismo socket también vuelve marcado como propio: ya está guardado, no se duplica.
  if (m.key.id && enviadosPorAiva.has(m.key.id)) return;
  const userId = `wa:${jid}`;
  try {
    touchUser(userId, 'whatsapp', null);
    const quien = business.crm.firmaHumano || 'desde el teléfono';
    const id = appendMessage(userId, 'assistant', texto, undefined, 'human', quien);
    emitEvent('message', userId, { id, role: 'assistant', author: 'human', by: quien, content: texto, ts: Date.now() });
    // Contestaron: ya no está esperando a nadie.
    updateContact(userId, { unread: 0 }, { silent: true });
    // 🪤 Y aiva se calla en esta conversación, igual que cuando se contesta desde el tablero: contestar A MANO
    // toma el control, venga del tablero o del teléfono. Si no, los dos responden a la vez al mismo cliente —y
    // el cliente recibe dos versiones de lo mismo, que es peor que no recibir ninguna.
    // Se devuelve cuando alguien mueva el interruptor a «Aiva» en el tablero: esa decisión es de una persona.
    const c = getContact(userId);
    if (c && !c.humanMode) setHumanMode(userId, true, quien);
    aprenderDeLaRespuesta(userId, texto, quien);
  } catch (err) {
    console.error('[whatsapp] no pude guardar lo que contestó el negocio:', (err as Error).message);
  }
}

/**
 * Lo que se habla en un grupo: se guarda para aprender, y nada más.
 *
 * 🪤 A la tabla de aprendizaje y NO al CRM, que es la diferencia que importa. Un grupo no es un prospecto: no
 * tiene una persona detrás a la que puntuar, ni una etapa, ni una cita. Meterlo como conversación llenaría el
 * tablero de fichas que nadie va a atender y estropearía el embudo, que es de donde el negocio saca sus
 * decisiones. Lo que sí vale de un grupo es cómo contesta ahí el negocio, y eso es aprendizaje.
 */
function anotarDelGrupo(m: WAMessage, jid: string, texto: string): void {
  const mio = Boolean(m.key.fromMe);
  try {
    // Quién lo dijo. En un grupo el remitente real va en `participant`, no en `remoteJid` —ese es el grupo—.
    if (!mio) anotarParticipante(jid, jidNormalizedUser(m.key.participant ?? ''), m.pushName ?? '', Number(m.messageTimestamp ?? 0) * 1000 || Date.now());
    guardarImportados(
      [{
        chat: jid,
        autor: mio ? 'negocio' : (m.pushName ?? 'alguien del grupo'),
        role: mio ? 'assistant' : 'user',
        content: texto,
        ts: Number(m.messageTimestamp ?? 0) * 1000 || Date.now(),
      }],
      'whatsapp-grupo',
    );
  } catch (err) {
    console.error('[whatsapp] no pude guardar lo del grupo:', (err as Error).message);
  }
}

/**
 * 🪤 En un grupo el disparador NO puede ser «alguien escribió».
 *
 * Un grupo de veinte personas son cientos de mensajes al día. Pasarlos todos por el modelo es plata quemada y
 * un aviso cada tres minutos hasta que alguien apague el modo de puro cansancio. Lo que de verdad pide una
 * respuesta es otra cosa: **que le estén hablando al negocio**.
 *
 * Y eso sí se sabe sin gastar nada, mirando el propio mensaje: o mencionan su número, o están respondiendo a
 * algo que escribió él. Lo demás es la conversación del grupo, que se aprende igual pero no se contesta.
 */
function meHablanAMi(m: WAMessage, yo: string): boolean {
  const inner = m.message?.ephemeralMessage?.message ?? m.message?.viewOnceMessageV2?.message ?? m.message ?? {};
  const ctx = (inner.extendedTextMessage?.contextInfo ?? (inner as { contextInfo?: proto.IContextInfo }).contextInfo) as proto.IContextInfo | undefined;
  if (!ctx || !yo) return false;
  const mio = jidNormalizedUser(yo);
  const mencionado = (ctx.mentionedJid ?? []).some((j) => jidNormalizedUser(j ?? '') === mio);
  // Responder a un mensaje del negocio es hablarle a él aunque no lo mencione: es lo más normal en un grupo.
  const contestandome = Boolean(ctx.quotedMessage) && jidNormalizedUser(ctx.participant ?? '') === mio;
  return mencionado || contestandome;
}

/** El nombre del grupo, para que en pantalla diga «Novios Diciembre» y no un número con arroba. */
const nombresDeGrupo = new Map<string, string>();
async function nombreDelGrupo(sock: WASocket, jid: string): Promise<string> {
  const ya = nombresDeGrupo.get(jid);
  if (ya) return ya;
  try {
    const meta = await sock.groupMetadata(jid);
    const nombre = meta?.subject || jid.split('@')[0] || jid;
    nombresDeGrupo.set(jid, nombre);
    return nombre;
  } catch {
    return jid.split('@')[0] || jid;
  }
}

/**
 * Le hablaron al negocio en un grupo y el canal está en «Propone»: aiva redacta y espera a una persona.
 *
 * 🪤 Redacta y NADA MÁS. En un grupo, aiva no manda ni aunque el canal estuviera en «Contesta»: equivocarse
 * ahí es equivocarse delante de todos a la vez y no hay forma de recogerlo. Lo que sale de un grupo siempre lo
 * manda una persona, mensaje por mensaje.
 */
async function proponerEnGrupo(sock: WASocket, m: WAMessage, jid: string, texto: string): Promise<void> {
  try {
    const quien = m.pushName ?? 'alguien del grupo';
    const nombre = await nombreDelGrupo(sock, jid);
    // 🪤 El hilo, con nombres. En un grupo la pregunta casi nunca se entiende sola: «¿y eso cuánto vale?»
    // depende de lo que otro preguntó tres mensajes antes. Y sin saber quién es quién, aiva le contesta a
    // Marcela lo que preguntó Jorge. Sale de lo que ya se guarda del grupo, así que no cuesta nada más.
    const antes = ultimosDeChat(`wa:${jid}`, 12)
      .filter((x) => x.content !== texto)
      .map((x) => `${x.role === 'assistant' ? 'Nosotros' : x.autor || 'alguien'}: ${x.content.slice(0, 180)}`)
      .join('\n');
    const quienes = quienEsQuien(jid);
    const respuesta = await handleMessage({
      userId: `wa:${jid}`,
      channel: 'whatsapp',
      text: texto,
      userName: quien,
      grupo: nombre, // sin esto, aiva contestaría como si hablara a solas con quien escribió
      hilo: antes,
      gente: quienes,
    });
    if (!respuesta.silent) console.log(`[whatsapp] grupo ${nombre}: propuesta lista`);
  } catch (err) {
    console.error('[whatsapp] no pude preparar la respuesta del grupo:', (err as Error).message);
  }
}

function onMessage(sock: WASocket, m: WAMessage) {
  if (!m.message) return;
  const losGrupos = grupos('whatsapp');
  if (m.key.fromMe) {
    const suyo = m.key.remoteJid;
    const texto = extractText(m.message);
    if (!suyo || !texto || isJidStatusBroadcast(suyo) || isJidNewsletter(suyo)) return;
    // En un grupo, lo que contesta el negocio es justo lo que vale la pena aprender.
    if (isJidGroup(suyo)) {
      if (losGrupos) anotarDelGrupo(m, suyo, texto);
      return;
    }
    anotarLoDelNegocio(m, suyo, texto);
    return;
  }
  const jid = m.key.remoteJid;
  if (!jid || isJidStatusBroadcast(jid) || isJidNewsletter(jid)) return;
  // 🪤 Aiva NUNCA escribe en un grupo, esté como esté el interruptor de «Contesta Aiva». Equivocarse en un
  // grupo es equivocarse delante de todos a la vez, y no hay forma de recogerlo. Se mira y se aprende.
  if (isJidGroup(jid)) {
    const texto = extractText(m.message);
    if (!losGrupos || !texto) return;
    anotarDelGrupo(m, jid, texto);
    // Y si le hablaron a él y el canal está en «Propone», se deja la respuesta lista para una persona.
    if (propone('whatsapp') && meHablanAMi(m, sock.user?.id ?? '')) void proponerEnGrupo(sock, m, jid, texto);
    return;
  }

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
    // 🪤 Audio, imagen sin texto, sticker… Esto contestaba SIEMPRE, incluso con el canal en «solo escuchar»,
    // porque estaba antes de mirarlo. Y en un negocio de verdad media clientela manda notas de voz: el modo
    // aprendizaje se delataba justo ahí, con un mensaje de robot en una conversación que llevaba una persona.
    if (soloEscucha('whatsapp')) return;
    void sock.readMessages([key]);
    void mandar(sock, jid, 'Por ahora solo puedo leer mensajes de texto 🙂 ¿Me lo escribes?');
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
    // 🪤 En «solo escuchar» aiva no marca como leído ni pone «escribiendo…». Parecen inofensivos y son lo
    // contrario: el cliente ve el doble check azul y que alguien teclea, y luego no le contesta nadie. Es peor
    // que no hacer nada. Quien lee de verdad es el negocio, desde su teléfono, y su teléfono ya lo marcará.
    const callado = soloEscucha('whatsapp');
    if (!callado) {
      await sock.readMessages(p.keys);
      await sock.sendPresenceUpdate('composing', jid);
    }
    const reply = await handleMessage({
      userId: `wa:${jid}`,
      channel: 'whatsapp',
      text: p.texts.join('\n'),
      userName: p.name ?? null,
    });
    if (!callado) await sock.sendPresenceUpdate('paused', jid);
    if (reply.silent || !reply.text) return; // una persona del equipo responderá desde el tablero
    // Firmado igual que lo que manda una persona desde el tablero: por este número contestan los dos, y el
    // cliente tiene derecho a saber con quién está hablando.
    await mandar(sock, jid, conFirma(reply.text, 'bot', 'whatsapp'));
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
