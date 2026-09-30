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

/**
 * Ver los grupos de WhatsApp.
 *
 * Apagado de fábrica, y a propósito: en un grupo escribe mucha gente que nunca le escribió al negocio, y
 * guardar lo que dicen no es lo mismo que guardar una conversación uno a uno con un cliente. Eso lo decide el
 * negocio, no nosotros, y por eso se enciende a mano y con la explicación delante.
 *
 * Cuando está encendido, aiva **mira y aprende**: nunca escribe en un grupo, pase lo que pase con el
 * interruptor de «Contesta Aiva». Un asistente metiéndose en la conversación de un grupo es el peor sitio
 * posible para equivocarse, porque se equivoca delante de todos a la vez.
 *
 * 🪤 Y no se pone al día: entra lo que se hable DESDE que se enciende. Lo de antes no se trae, ni cuando se
 * vincula el número. Es una decisión, no una limitación: traer meses de grupos de golpe es meter en casa las
 * conversaciones de mucha gente que no eligió estar ahí.
 */
export function grupos(id: ChannelId): boolean {
  return getSetting(`channel.${id}.grupos`, false);
}

export function setGrupos(id: ChannelId, on: boolean): void {
  setSetting(`channel.${id}.grupos`, on);
}
