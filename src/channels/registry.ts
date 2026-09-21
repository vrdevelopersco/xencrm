// Canales para el tablero: estado de cada uno, actividad, qué falta para conectarlo y qué copiar.
// Todo sale de la configuración del cliente (aiva.config.json + .env); nada es propio de un negocio en particular.
import { business, env } from '../config.js';
import { getDb } from '../rag/store.js';
import { metaStatus } from './meta.js';
import { channelOn, setChannelOn, type ChannelId } from './switches.js';
import { startWhatsApp, stopWhatsApp, whatsappStatus } from './whatsapp.js';

export type CardState = 'conectado' | 'conectando' | 'esperando_qr' | 'esperando' | 'sin_configurar' | 'apagado' | 'error' | 'no_disponible';

export interface ChannelCard {
  id: ChannelId | 'instagram' | 'messenger';
  name: string;
  about: string;
  state: CardState;
  /** Una línea con lo que está pasando ("Conectado como 300 123 4567", "Aún no llega ningún mensaje de Meta"). */
  detail?: string;
  on: boolean;
  canToggle: boolean;
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
  const wa = whatsappStatus();
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
    ...stats('whatsapp'),
    copy: [],
    steps:
      waState === 'esperando_qr'
        ? ['En el teléfono del negocio abre WhatsApp › Dispositivos vinculados › Vincular un dispositivo.', 'Escanea este código. Se renueva solo cada pocos segundos.']
        : waState === 'error'
          ? [wa.error ?? 'La sesión se cerró.']
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
          ? 'Configurado, pero aún no llega ningún mensaje de Meta.'
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
          'Copia en .env el token (META_ACCESS_TOKEN), el ID del número (META_PHONE_NUMBER_ID), un token de verificación que inventes (META_VERIFY_TOKEN) y la clave secreta de la app (META_APP_SECRET). También sirve el asistente pnpm onboard.',
          'Reinicia aiva: aquí aparecerá la URL del webhook para registrarla en Meta y suscribir el campo "messages".',
          'Para probar sin tocar el número real, Meta da un número de prueba gratis.',
        ],
    warnings: meta.configured && !meta.signed ? ['Falta META_APP_SECRET: sin él aiva no verifica que los mensajes vengan de Meta, y cualquiera podría enviarle mensajes falsos.'] : [],
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
  if (id === 'meta' && !metaStatus().configured) throw new Error('WhatsApp oficial no está configurado en .env');
  setChannelOn(id, on);
  if (id === 'whatsapp') {
    if (on && whatsappStatus().state === 'apagado') await startWhatsApp();
    if (!on) await stopWhatsApp();
  }
}
