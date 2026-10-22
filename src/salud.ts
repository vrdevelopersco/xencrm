// Si este cliente SIRVE, no si está vivo.
//
// `/_salud` del lanzador decía que los cuatro procesos respiraban, y eso es verdad y es poco: un proceso vivo
// con WhatsApp desvinculado, o con la llave de OpenAI vencida, contesta a todo menos a los clientes. El sitio
// se ve perfecto desde fuera y lleva una semana sin atender a nadie.
//
// 🪤 Todo lo de aquí se MIDE, no se declara. Nada de «whatsapp: ok» porque el módulo está cargado: se dice en
// qué estado está la conexión y cuándo fue la última vez que entró o salió un mensaje de verdad. La diferencia
// importa justo el día que algo se rompe en silencio, que es el único día que alguien abre esto.
//
// 🪤 Y se mira sabiendo que esto sale por una puerta SIN TOKEN. No puede llevar un número de teléfono, ni un
// trozo de conversación, ni una pista de la llave. Solo estados, cuentas y cuánto hace. Lo que se enseña aquí
// no le sirve a nadie para entrar; le sirve a quien mantiene esto para saber por dónde empezar.
import { existsSync, accessSync, constants } from 'node:fs';
import { business, env } from './config.js';
import { engineStatus, motorSinCosto } from './llm/engines.js';
import { presupuesto, type Nivel } from './crm/presupuesto.js';
import { version } from './version.js';
import { whatsappStatus } from './channels/whatsapp-estado.js';
import { canalesQueEntregan } from './crm/outbox.js';
import { carpeta as carpetaDeMedios, cuantoOcupa } from './crm/medios.js';
import { getDb } from './rag/store.js';

const MIN = 60_000;
/** Hace cuánto, en minutos, o null si nunca. Redondeado: aquí nadie necesita segundos. */
const haceMin = (ts: number | null | undefined): number | null =>
  ts && ts > 0 ? Math.max(0, Math.round((Date.now() - ts) / MIN)) : null;

export interface SaludDelCliente {
  negocio: string;
  /** El veredicto en una línea, que es lo único que mucha gente va a leer. */
  veredicto: string;
  /** Lo que hay que mirar, en orden. Vacío si no hay nada. */
  avisos: string[];
  whatsapp: { estado: string; desdeHaceMin: number | null; vinculado: boolean };
  /** Por dónde se le puede entregar algo a un cliente ahora mismo, y quién lleva archivos. */
  canales: { id: string; entrega: boolean; archivos: boolean }[];
  modelos: { motor: string; disponible: boolean; porque?: string }[];
  /** Lo último que de verdad pasó. Es lo que distingue «encendido» de «funcionando». */
  trafico: { ultimoEntranteHaceMin: number | null; ultimoSalienteHaceMin: number | null; mensajesHoy: number };
  medios: { carpetaEscribible: boolean; archivos: number; mb: number };
  base: { responde: boolean; contactos: number | null };
  /** En qué escalón del tope de gasto va el mes. Sin cifras: esta puerta no lleva token. */
  presupuesto: { nivel: Nivel };
  /** Qué código corre (src/version.ts). Antes de teorizar por qué algo empezó a fallar tras un despliegue. */
  version: string;
}

/** Qué se sabe de los mensajes, mirando la base y no lo que diga nadie. */
function trafico(): SaludDelCliente['trafico'] {
  const uno = (sql: string): number | null => {
    try {
      return ((getDb().prepare(sql).get() as { v: number | null } | undefined)?.v ?? null) as number | null;
    } catch {
      return null;
    }
  };
  return {
    ultimoEntranteHaceMin: haceMin(uno("SELECT MAX(ts) v FROM messages WHERE author = 'customer'")),
    ultimoSalienteHaceMin: haceMin(uno("SELECT MAX(ts) v FROM messages WHERE author <> 'customer'")),
    mensajesHoy: uno(`SELECT COUNT(*) v FROM messages WHERE ts > ${Date.now() - 24 * 60 * MIN}`) ?? 0,
  };
}

/**
 * 🪤 Se escribe de verdad para saber si se puede escribir. Mirar si la carpeta existe no dice nada: en un
 * alojamiento compartido lo que falla es el permiso o el disco lleno, y las dos cosas dejan la carpeta ahí,
 * visible y tan inútil como si no estuviera. Un archivo que llega y no se puede guardar se pierde sin ruido.
 */
function mediosEscribibles(): boolean {
  try {
    const dir = carpetaDeMedios();
    if (!existsSync(dir)) return false;
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function saludDelCliente(): SaludDelCliente {
  const wa = whatsappStatus();
  const motores = Object.entries(engineStatus()).map(([motor, s]) => ({ motor, disponible: s.available, porque: s.reason }));
  const canales = canalesQueEntregan();
  const t = trafico();
  const uso = mediosEscribibles() ? cuantoOcupa() : { archivos: 0, bytes: 0 };
  let contactos: number | null = null;
  try {
    contactos = ((getDb().prepare('SELECT COUNT(*) v FROM users').get() as { v: number }).v);
  } catch {
    contactos = null;
  }

  const avisos: string[] = [];
  // El orden es el orden en que conviene mirarlos: primero lo que deja al negocio sin atender a nadie.
  if (contactos === null) avisos.push('La base de datos no contesta: este cliente no puede guardar ni leer nada.');
  if (!canales.some((c) => c.entrega)) avisos.push('No hay ningún canal por el que entregarle un mensaje a un cliente.');
  const motorPrincipal = motores.find((m) => m.motor === env.lightEngine) ?? motores.find((m) => m.disponible);
  if (motorPrincipal && !motorPrincipal.disponible) {
    // Con el respaldo arriba sigue contestando, y decir «no puede contestar» mandaría a alguien a apagar un incendio
    // que no hay. Pero se avisa igual: el respaldo cuesta, tiene saldo limitado y no es el motor que se eligió.
    const respaldo = motores.find((m) => m.motor === 'anthropic' && m.disponible);
    avisos.push(
      `El motor ${motorPrincipal.motor} está caído${motorPrincipal.porque ? ` (${motorPrincipal.porque})` : ''}: ` +
        (respaldo ? 'está contestando Claude, el respaldo.' : 'el asistente no puede contestar.'),
    );
  }
  let nivel: Nivel = 'sin_tope';
  try {
    nivel = presupuesto().nivel;
  } catch {
    // la base no contesta: ya quedó dicho arriba
  }
  if (nivel === 'agotado') {
    avisos.push(
      motorSinCosto()
        ? 'Llegó al tope de gasto de IA del mes: contesta el motor de la máquina, que no cuesta.'
        : 'Llegó al tope de gasto de IA del mes: lo que necesita IA lo contesta el equipo, a mano.',
    );
  }
  if (env.whatsappEnabled && wa.state !== 'conectado') {
    avisos.push(`WhatsApp está en «${wa.state}»${wa.state === 'esperando_qr' ? ': hay que escanear el código otra vez' : ''}.`);
  }
  if (!mediosEscribibles()) avisos.push('No se puede escribir en la carpeta de archivos: las fotos que lleguen se perderán.');
  // 🪤 Un silencio largo con los canales encendidos es la avería que NO da error. Todo responde, nada falla, y
  // simplemente no entra un solo mensaje porque el número se desvinculó o el widget dejó de cargar. Dos días es
  // el umbral: un fin de semana no es una avería, pero el lunes a mediodía sí.
  if (t.ultimoEntranteHaceMin !== null && t.ultimoEntranteHaceMin > 2 * 24 * 60) {
    avisos.push(`Hace ${Math.round(t.ultimoEntranteHaceMin / 60 / 24)} días que no entra un mensaje. Si el negocio está abierto, algo se cortó.`);
  }

  return {
    negocio: business.business.name,
    veredicto: avisos.length ? avisos[0]! : t.ultimoEntranteHaceMin === null ? 'Todo en pie; todavía no ha escrito nadie.' : 'Atendiendo con normalidad.',
    avisos,
    whatsapp: { estado: wa.state, desdeHaceMin: haceMin(wa.since), vinculado: Boolean(wa.me) },
    canales,
    modelos: motores,
    trafico: t,
    medios: { carpetaEscribible: mediosEscribibles(), archivos: uso.archivos, mb: Math.round((uso.bytes / 1048576) * 10) / 10 },
    base: { responde: contactos !== null, contactos },
    presupuesto: { nivel },
    version: version().commit,
  };
}
