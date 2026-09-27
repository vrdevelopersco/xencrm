// Qué canales están encendidos. Se decide desde el tablero (sección Canales) y se guarda en la base; mientras nadie
// lo cambie, manda el .env. Módulo sin dependencias de los canales para que cualquiera lo consulte sin ciclos.
import { env } from '../config.js';
import { getSetting, setSetting } from '../crm/settings.js';

export type ChannelId = 'web' | 'whatsapp' | 'meta' | 'mcp';

const DEFAULTS: Record<ChannelId, () => boolean> = {
  web: () => true, // el chat del sitio; el servidor (y el tablero) dependen de WEB_ENABLED
  whatsapp: () => env.whatsappEnabled,
  meta: () => true, // si está configurado en .env, arranca encendido
  mcp: () => env.mcpEnabled,
};

export function channelOn(id: ChannelId): boolean {
  return getSetting(`channel.${id}.on`, DEFAULTS[id]());
}

export function setChannelOn(id: ChannelId, on: boolean): void {
  setSetting(`channel.${id}.on`, on);
}

/**
 * Solo escuchar: el canal recibe y todo entra al CRM, pero el asistente **no contesta**. Es como poner todas las
 * conversaciones en manos de una persona a la vez.
 *
 * Existe porque enchufar el WhatsApp de un negocio de verdad y que el asistente empiece a hablarle a sus
 * clientes el primer día es una decisión que nadie quiere tomar sin mirar antes. Con esto se enchufa, se ve
 * entrar todo, se aprende de cómo atienden, y se le da voz cuando el negocio diga.
 *
 * 🪤 No es solo «no mandar»: el mensaje ni siquiera pasa por el modelo, así que tampoco cuesta dinero.
 */
export function soloEscucha(id: ChannelId): boolean {
  return getSetting(`channel.${id}.soloEscucha`, id === 'whatsapp' ? env.whatsappSoloEscucha : false);
}

export function setSoloEscucha(id: ChannelId, on: boolean): void {
  setSetting(`channel.${id}.soloEscucha`, on);
}
