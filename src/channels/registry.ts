// Canales para el tablero: estado de cada uno, actividad, qué falta para conectarlo y qué copiar.
// Todo sale de la configuración del cliente (aiva.config.json + .env); nada es propio de un negocio en particular.
import { business, env } from '../config.js';
import { getDb } from '../rag/store.js';
import { metaStatus } from './meta.js';
import { soloEscucha, channelOn, setChannelOn, type ChannelId } from './switches.js';
// 🪤 Solo el estado: importar aquí la librería de WhatsApp costaba 77 MB en CADA proceso de cliente,
// tuviera WhatsApp encendido o no. Se carga cuando se enciende, no antes.
import { whatsappStatus, qrSvg } from './whatsapp-estado.js';
import { estadoPuente } from './puente.js';

export type CardState = 'conectado' | 'conectando' | 'esperando_qr' | 'esperando' | 'sin_configurar' | 'apagado' | 'error' | 'conflicto' | 'no_disponible';

export interface ChannelCard {
  id: ChannelId | 'instagram' | 'messenger';
  name: string;
  about: string;
  state: CardState;
  /** Una línea con lo que está pasando ("Conectado como 300 123 4567", "Aún no llega ningún mensaje de Meta"). */
  detail?: string;
  on: boolean;
  canToggle: boolean;
  /** Recibe y guarda, pero el asistente no contesta: responde una persona desde el tablero. */
  soloEscucha?: boolean;
  /** Mensajes de clientes en los últimos 7 días, cuántas personas y cuándo llegó el último (de siempre). */
  messages7d: number;
  people7d: number;
  lastInboundAt: number | null;
  copy: { label: string; value: string; secret?: boolean }[];
  /** Qué falta o qué hacer, en orden. */
  steps: string[];
  /** Advertencias que no impiden funcionar pero hay que atender. */
  warnings: string[];
  qrSvg?: string;
  /** WhatsApp oficial: lo que ya está guardado, sin los secretos completos (para el formulario de credenciales). */
  credentials?: { phoneId: string; tokenTail: string; appSecretTail: string; verifyToken: string; version: string; verified: { phone: string; name: string; at: number } | null };
}

const base = () => env.publicUrl || `http://localhost:${env.port}`;

function activity(): Map<string, { messages7d: number; people7d: number; lastInboundAt: number | null }> {
  const since = Date.now() - 7 * 86400_000;
  const rows = getDb()
    .prepare(
      `SELECT u.channel, SUM(m.ts >= ?) messages7d, COUNT(DISTINCT CASE WHEN m.ts >= ? THEN m.user_id END) people7d, MAX(m.ts) last
       FROM messages m JOIN users u ON u.id = m.user_id WHERE m.role = 'user' GROUP BY u.channel`,
    )
    .all(since, since) as { channel: string; messages7d: number; people7d: number; last: number | null }[];
  return new Map(rows.map((r) => [r.channel, { messages7d: Number(r.messages7d ?? 0), people7d: Number(r.people7d ?? 0), lastInboundAt: r.last }]));
}

export function channelCards(): ChannelCard[] {
  const act = activity();
  const stats = (channel: string) => act.get(channel) ?? { messages7d: 0, people7d: 0, lastInboundAt: null };
  const name = business.business.name;
  const cards: ChannelCard[] = [];

  // Chat del sitio web
  const webOn = channelOn('web');
  cards.push({
    id: 'web',
    name: 'Chat del sitio web',
    about: `El chat que se pega en el sitio de ${name} con una línea de código.`,
    state: webOn ? 'conectado' : 'apagado',
    detail: webOn ? undefined : 'Apagado: el chat del sitio responde que no está disponible.',
    on: webOn,
    canToggle: true,
    ...stats('web'),
    copy: [
      { label: 'Código para pegar en el sitio', value: `<script src="${base()}/widget.js" async></script>` },
      { label: 'Página de prueba', value: `${base()}/` },
    ],
    steps: env.publicUrl ? [] : ['Para usarlo en el sitio real hace falta una URL pública (PUBLIC_URL en .env, con el túnel).'],
    warnings:
      env.publicUrl && env.allowedOrigins.includes('*')
        ? [`Cualquier sitio puede usar este chat: pon en ALLOWED_ORIGINS el dominio de ${name} (${business.business.siteUrl}).`]
        : [],
  });

  // WhatsApp por QR (Baileys)
  // Con un conector en otra máquina, el estado de verdad es el que él reporta: aquí no hay ninguna sesión.
  const puente = env.whatsappModo === 'puente' ? estadoPuente() : null;
  const wa = puente ? { state: puente.estado, qr: puente.qr, me: puente.me, error: puente.error, since: puente.visto, qrSvg: puente.qr ? qrSvg(puente.qr) : undefined } : whatsappStatus();
  const waOn = channelOn('whatsapp');
  const waState: CardState = !waOn ? 'apagado' : wa.state === 'sesion_cerrada' ? 'error' : wa.state === 'apagado' ? 'conectando' : wa.state;
  cards.push({
    id: 'whatsapp',
    name: 'WhatsApp (código QR)',
    about: `Vincula el WhatsApp de ${name} escaneando un código, como WhatsApp Web. No es la vía oficial de Meta: sirve para empezar y para volúmenes bajos, y Meta puede bloquear el número.`,
    state: waState,
    detail:
      waState === 'conectado'
        ? `Conectado como ${wa.me ?? 'el número del negocio'}.`
        : waState === 'esperando_qr'
          ? 'Esperando que escanees el código.'
          : (wa.error ?? (waState === 'conectando' ? 'Conectando…' : undefined)),
    on: waOn,
    canToggle: true,
    soloEscucha: soloEscucha('whatsapp'),
    ...stats('whatsapp'),
    copy: [],
    steps:
      waState === 'esperando_qr'
        ? ['En el teléfono del negocio abre WhatsApp › Dispositivos vinculados › Vincular un dispositivo.', 'Escanea este código. Se renueva solo cada pocos segundos.']
        : waState === 'error'
          ? [wa.error ?? 'La sesión se cerró.']
          : // Aquí no vale «reintenta»: mientras el número esté abierto en dos sitios, cada intento echa al otro
            // y el otro vuelve. Lo que hay que hacer es cerrar uno, y por eso los pasos dicen dónde mirar.
            waState === 'conflicto'
            ? [
                'En el teléfono del negocio: WhatsApp › Dispositivos vinculados. Si hay más de una sesión de aiva, cierra las que sobren.',
                'Si tienes aiva corriendo en otra máquina (o un conector), apaga el canal de WhatsApp allá.',
                'Cuando quede en un solo sitio, apaga y vuelve a encender este canal.',
              ]
            : [],
    warnings: waOn && metaStatus().configured ? ['El WhatsApp oficial también está configurado: no conectes el mismo número por las dos vías.'] : [],
    qrSvg: waOn && wa.state === 'esperando_qr' ? wa.qrSvg : undefined,
  });

  // WhatsApp oficial (Meta Cloud API)
  const meta = metaStatus();
  const metaOn = channelOn('meta');
  const recentError = meta.lastErrorAt > Date.now() - 3600_000 && meta.lastErrorAt > meta.lastSentAt;
  const metaState: CardState = !meta.configured ? 'sin_configurar' : !metaOn ? 'apagado' : recentError ? 'error' : meta.lastWebhookAt ? 'conectado' : 'esperando';
  cards.push({
    id: 'meta',
    name: 'WhatsApp oficial (Meta)',
    about: 'La vía oficial de WhatsApp Business (Cloud API). Para producción: no se bloquea, pero Meta exige un negocio verificado y plantillas para escribir fuera de las 24 horas.',
    state: metaState,
    detail:
      metaState === 'error'
        ? `Último error: ${meta.lastError.slice(0, 160)}`
        : metaState === 'esperando'
          ? `${meta.verified ? `Verificado con Meta: ${meta.verified.phone}${meta.verified.name ? ` (${meta.verified.name})` : ''}. ` : 'Configurado. '}Aún no llega ningún mensaje de Meta.`
          : metaState === 'conectado'
            ? 'Recibiendo mensajes de Meta.'
            : undefined,
    on: meta.configured && metaOn,
    canToggle: meta.configured,
    ...stats('meta'),
    copy: meta.configured
      ? [
          { label: 'URL del webhook (en la app de Meta › WhatsApp › Configuración)', value: `${base()}/webhooks/meta` },
          { label: 'Token de verificación', value: meta.verifyToken, secret: true },
        ]
      : [],
    steps: meta.configured
      ? env.publicUrl
        ? []
        : ['Meta necesita una URL pública para el webhook: configura PUBLIC_URL (el túnel).']
      : [
          'En developers.facebook.com crea una app de tipo Negocio y agrégale el producto WhatsApp.',
          'En WhatsApp › Configuración de la API copia el token de acceso y el ID del número, y pégalos abajo en «Credenciales». La clave secreta está en Configuración de la app › Básica.',
          'Al guardar, aiva las verifica con Meta y muestra aquí la URL del webhook para registrarla en Meta (con el token de verificación) y suscribir el campo "messages".',
          'Para probar sin tocar el número real, Meta da un número de prueba gratis.',
        ],
    warnings: meta.configured && !meta.signed ? ['Falta la clave secreta de la app: sin ella aiva no verifica que los mensajes vengan de Meta, y cualquiera podría enviarle mensajes falsos.'] : [],
    credentials: { phoneId: meta.phoneId, tokenTail: meta.tokenTail, appSecretTail: meta.appSecretTail, verifyToken: meta.verifyToken, version: meta.version, verified: meta.verified },
  });

  // Instagram y Messenger: misma plataforma de Meta; el adaptador se construye cuando haya credenciales de prueba.
  const pending = (id: 'instagram' | 'messenger', title: string, about: string, needs: string[]): ChannelCard => ({
    id,
    name: title,
    about,
    state: 'no_disponible',
    detail: 'Aún no está en aiva: el adaptador se construye cuando haya credenciales para probarlo.',
    on: false,
    canToggle: false,
    messages7d: 0,
    people7d: 0,
    lastInboundAt: null,
    copy: [],
    steps: needs,
    warnings: [],
  });
  cards.push(
    pending('instagram', 'Instagram (mensajes directos)', `Responder los mensajes directos de la cuenta de Instagram de ${name}.`, [
      'Cuenta profesional de Instagram vinculada a una página de Facebook.',
      'Una app de Meta con el permiso de mensajería de Instagram (Meta la revisa antes de usarla con clientes reales).',
      'URL pública para el webhook (PUBLIC_URL).',
    ]),
    pending('messenger', 'Facebook Messenger', `Responder los mensajes de la página de Facebook de ${name}.`, [
      'Una página de Facebook y una app de Meta con el permiso de mensajería de páginas (con revisión de Meta).',
      'URL pública para el webhook (PUBLIC_URL). Usa la misma plataforma que Instagram: sale casi junto.',
    ]),
  );

  // Otros agentes de IA (MCP)
  const mcpOn = channelOn('mcp');
  cards.push({
    id: 'mcp',
    name: 'Otros asistentes de IA (MCP)',
    about: `Permite que otros asistentes (Claude, ChatGPT y similares) consulten el catálogo de ${name} y conversen con ${business.agent.name}.`,
    state: mcpOn ? 'conectado' : 'apagado',
    on: mcpOn,
    canToggle: true,
    ...stats('mcp'),
    copy: [{ label: 'Dirección MCP', value: `${base()}/mcp` }],
    steps: [],
    warnings: [],
  });
  return cards;
}

/** Enciende o apaga un canal desde el tablero; WhatsApp por QR arranca o se desconecta en el momento. */
export async function toggleChannel(id: ChannelId, on: boolean): Promise<void> {
  if (id === 'meta' && !metaStatus().configured) throw new Error('Primero guarda las credenciales de Meta (abajo, en «Credenciales»).');
  setChannelOn(id, on);
  if (id === 'whatsapp') {
    // Con conector, encender es solo dejarlo dicho: él lo consulta al dar su siguiente señal y actúa.
    if (env.whatsappModo === 'local') {
      const wa = await import('./whatsapp.js'); // aquí sí: es el momento de abrir o cerrar la sesión
      if (on && whatsappStatus().state === 'apagado') await wa.startWhatsApp();
      if (!on) await wa.stopWhatsApp();
    }
  }
}
