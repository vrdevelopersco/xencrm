// Qué canales están encendidos. Se decide desde el tablero (sección Canales) y se guarda en la base; mientras nadie
// lo cambie, manda el .env. Módulo sin dependencias de los canales para que cualquiera lo consulte sin ciclos.
import { env } from '../config.js';
import { getSetting, setSetting } from '../crm/settings.js';

export type ChannelId = 'web' | 'whatsapp' | 'meta' | 'mcp' | 'voz' | 'telefono';

const DEFAULTS: Record<ChannelId, () => boolean> = {
  web: () => true, // el chat del sitio; el servidor (y el tablero) dependen de WEB_ENABLED
  whatsapp: () => env.whatsappEnabled,
  meta: () => true, // si está configurado en .env, arranca encendido
  mcp: () => env.mcpEnabled,
  // La voz (llamadas desde el chat) y el teléfono (SIP) arrancan prendidos: sin llave de xAI ni agente de voz no
  // hacen nada, y con ellos lo natural es que funcionen. Se apagan desde Canales.
  voz: () => true,
  telefono: () => true,
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
/**
 * Los tres modos de un canal, por orden de confianza: **mira · propone · contesta**.
 *
 * - `mira` — entra todo y XENCRM no dice nada. Es el modo aprendizaje: mira cómo atiende el negocio.
 * - `propone` — XENCRM prepara la respuesta y la deja lista; la manda una persona con un toque, o la corrige.
 * - `contesta` — responde sola.
 *
 * 🪤 El del medio es el que faltaba, y es el más valioso de los tres: sin él la decisión es «que no diga nada»
 * o «que le hable a mis clientes», y entre esas dos hay un abismo que nadie cruza tranquilo. Con este se pasa
 * de una a otra mirando, que es como se gana la confianza en algo que le habla a tus clientes.
 */
export type ModoCanal = 'mira' | 'propone' | 'contesta';

export function modoCanal(id: ChannelId): ModoCanal {
  const guardado = getSetting(`channel.${id}.modo`, '') as string;
  if (guardado === 'mira' || guardado === 'propone' || guardado === 'contesta') return guardado;
  // Lo de antes era un sí/no. Quien ya lo tenía puesto no se entera del cambio: se lee su ajuste viejo.
  const escuchaba = getSetting(`channel.${id}.soloEscucha`, id === 'whatsapp' ? env.whatsappSoloEscucha : false);
  return escuchaba ? 'mira' : 'contesta';
}

export function setModoCanal(id: ChannelId, modo: ModoCanal): void {
  setSetting(`channel.${id}.modo`, modo);
  // Se mantiene el ajuste viejo al día: si alguien vuelve a una versión anterior, no se encuentra a XENCRM
  // contestándole a sus clientes sin haberlo pedido.
  setSetting(`channel.${id}.soloEscucha`, modo !== 'contesta');
}

/** Xen no manda nada por su cuenta: ni mirando ni proponiendo. */
export function soloEscucha(id: ChannelId): boolean {
  return modoCanal(id) !== 'contesta';
}

/** Xen prepara la respuesta pero no la manda: la decide una persona. */
export function propone(id: ChannelId): boolean {
  return modoCanal(id) === 'propone';
}

export function setSoloEscucha(id: ChannelId, on: boolean): void {
  setModoCanal(id, on ? 'mira' : 'contesta');
}

/**
 * Ver los grupos de WhatsApp.
 *
 * Apagado de fábrica, y a propósito: en un grupo escribe mucha gente que nunca le escribió al negocio, y
 * guardar lo que dicen no es lo mismo que guardar una conversación uno a uno con un cliente. Eso lo decide el
 * negocio, no nosotros, y por eso se enciende a mano y con la explicación delante.
 *
 * Cuando está encendido, XENCRM **mira y aprende**: nunca escribe en un grupo, pase lo que pase con el
 * interruptor de «Contesta Xen». Un asistente metiéndose en la conversación de un grupo es el peor sitio
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
