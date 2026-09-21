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
