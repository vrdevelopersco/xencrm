// La guía de inicio: lo que falta para que el asistente atienda solo, con el motivo exacto de cada cosa.
//
// Cada paso se da por hecho SOLO cuando de verdad lo está, mirando lo mismo que mira el asistente para contestar:
// el perfil que lee, el catálogo con el que cotiza, el canal por el que le escriben. Nada de «ya lo hice» guardado
// en el navegador, que es lo que hace el tutorial de Ayuda: aquí un paso marcado y un paso hecho son lo mismo.
//
// 🪤 Sin modelo y sin red. Esto se pide cada vez que alguien abre Hoy, así que todo sale de lo que ya está en
// memoria o en la base: la dirección pública se lee del último chequeo (channels/public-check lo hace cada 5
// minutos), no se vuelve a llamar desde aquí.
//
// 🪤 Multicliente: los pasos salen de la configuración del negocio. Quien no agenda citas no ve pasos de citas.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { business } from '../config.js';
import { getDb } from '../rag/store.js';
import { getProfile } from '../profile.js';
import { channelCards } from '../channels/registry.js';
import { channelOn } from '../channels/switches.js';
import { publicStatus } from '../channels/public-check.js';
import { busyStatus } from './busy.js';
import { estadoDelCatalogo } from './valor.js';

export interface PasoGuia {
  id: string;
  titulo: string;
  hecho: boolean;
  opcional: boolean;
  /** Qué falta, en palabras de persona. Vacío cuando está hecho. */
  falta: string;
  /** La pantalla del tablero que lo arregla: un nombre de go(). */
  ir: string;
}

type Perfil = ReturnType<typeof getProfile>;

/**
 * Lo del perfil que el asistente más necesita para contestar. No todo el perfil: un Instagram vacío no impide
 * atender; unos horarios vacíos sí, porque el cliente los pregunta y el asistente tiene que decir «lo verifico».
 */
const ESENCIALES: { leer: (p: Perfil) => unknown; nombre: string }[] = [
  { leer: (p) => p.service.address, nombre: 'la dirección' },
  { leer: (p) => p.service.hours, nombre: 'los horarios' },
  { leer: (p) => p.payments.methods, nombre: 'las formas de pago' },
];

/** «la dirección», «la dirección y los horarios», «la dirección, los horarios y las formas de pago». */
function enLista(cosas: string[]): string {
  return cosas.length <= 1 ? cosas.join('') : `${cosas.slice(0, -1).join(', ')} y ${cosas[cosas.length - 1]}`;
}

function pasoPerfil(): PasoGuia {
  const p = getProfile();
  const faltan = ESENCIALES.filter((e) => !String(e.leer(p) ?? '').trim()).map((e) => e.nombre);
  // «Falta la dirección», pero «Faltan los horarios»: el verbo va con lo que falta, no con cuántas cosas son.
  const plural = faltan.length > 1 || /^(los|las) /.test(faltan[0] ?? '');
  return {
    id: 'perfil',
    titulo: 'Llena el perfil del negocio',
    hecho: faltan.length === 0,
    opcional: false,
    falta: faltan.length
      ? `${plural ? 'Faltan' : 'Falta'} ${enLista(faltan)}. Si un cliente lo pregunta, ${business.agent.name} tiene que decirle que lo verifica.`
      : '',
    ir: 'profile',
  };
}

// 🪤 Lo que ofrece y lo que cuesta son DOS pasos, y solo el primero es obligatorio. Con uno solo («productos con
// precio»), una financiera o un servicio de soporte —que no venden nada con precio de lista— nunca tenían la guía
// completa: aiva es multicliente, y lo que se exige para empezar es que el asistente tenga de qué hablar. El
// precio mejora el embudo (cuánto vale cada prospecto), pero sin él aiva atiende igual.
function pasoCatalogo(): PasoGuia {
  const { productos, informacion } = estadoDelCatalogo();
  return {
    id: 'catalogo',
    titulo: 'Cuéntale lo que ofreces',
    hecho: productos > 0 || informacion > 0,
    opcional: false,
    falta: productos > 0 || informacion > 0
      ? ''
      : `${business.agent.name} todavía no sabe nada de lo que ofreces: carga tu catálogo o escríbele la información.`,
    ir: 'knowledge',
  };
}

/** Los precios, solo si hay catálogo: sin productos no hay a qué ponerle precio, y el paso no sale. */
function pasoPrecios(): PasoGuia | null {
  const { productos, conPrecio } = estadoDelCatalogo();
  if (!productos) return null;
  return {
    id: 'precios',
    titulo: 'Ponle precio a tu catálogo',
    hecho: conPrecio > 0,
    opcional: true,
    falta: conPrecio > 0 ? '' : 'Tu catálogo no tiene precios: así no se sabe cuánto vale cada prospecto ni cuánto hay en juego.',
    ir: 'knowledge',
  };
}

/**
 * Por dónde le escriben. Hecho si WhatsApp (por QR u oficial) está recibiendo, o si el chat del sitio está
 * encendido y su dirección pública responde. El motivo dice lo que está más cerca de funcionar, que es lo que hay
 * que terminar: si WhatsApp espera el código, eso; si no hay nada encendido, eso.
 */
function pasoCanal(): PasoGuia {
  const cards = channelCards();
  const wa = cards.find((c) => c.id === 'whatsapp');
  const meta = cards.find((c) => c.id === 'meta');
  const pub = publicStatus();
  // Sin dirección configurada no hay nada que esperar: el chequeo de cada 5 minutos diría «revisando» un rato.
  const estado = pub.url ? pub.state : 'sin_url';
  const webOn = channelOn('web');
  const hecho = wa?.state === 'conectado' || meta?.state === 'conectado' || (webOn && estado === 'ok');
  let falta = '';
  if (!hecho) {
    if (wa?.on && wa.state !== 'apagado') falta = `WhatsApp: ${wa.detail ?? 'todavía no está conectado.'}`;
    else if (meta?.on) falta = `WhatsApp oficial: ${meta.detail ?? 'todavía no recibe mensajes.'}`;
    else if (webOn) {
      falta =
        estado === 'sin_url'
          ? 'El chat del sitio está encendido, pero falta la dirección pública: sin ella solo funciona en este equipo.'
          : estado === 'revisando'
            ? 'El chat del sitio está encendido; falta comprobar que la dirección pública responda.'
            : `El chat del sitio está encendido, pero la dirección pública no responde (${pub.error || 'sin respuesta'}).`;
    } else falta = 'Ningún canal está recibiendo mensajes: conecta WhatsApp o enciende el chat del sitio.';
  }
  return { id: 'canal', titulo: 'Conecta por dónde te escriben', hecho, opcional: false, falta, ir: 'channels' };
}

/**
 * Que ya haya entrado una conversación de verdad. 🪤 Sin contar los grupos (no son conversaciones del CRM) ni la
 * demostración (`wa:seed-`): cargar la demo no prueba que a uno le lleguen los mensajes.
 */
function pasoPrueba(): PasoGuia {
  const r = getDb()
    .prepare("SELECT 1 FROM messages WHERE role = 'user' AND user_id NOT LIKE '%@g.us' AND user_id NOT LIKE 'wa:seed-%' LIMIT 1")
    .get();
  return {
    id: 'prueba',
    titulo: 'Haz una prueba',
    hecho: Boolean(r),
    opcional: false,
    falta: r
      ? ''
      : `Escríbele a ${business.agent.name} desde la página de prueba (en Canales, en la tarjeta del chat del sitio) o desde otro WhatsApp, y mira cómo contesta.`,
    ir: 'channels',
  };
}

/**
 * El horario de citas, solo si el negocio agenda. 🪤 El horario siempre «existe»: si nadie lo pone, vale el de
 * ejemplo (lunes a viernes, de 9 a 1 y de 2 a 6), y el asistente ofrecería esas horas como si fueran las del
 * negocio. Por eso se mira el archivo guardado: hecho es que alguien lo haya escrito, no que haya uno.
 */
function pasoCitas(): PasoGuia | null {
  if (!business.appointments.enabled) return null;
  let escrito = true;
  try {
    const crudo = JSON.parse(readFileSync(resolve(process.env.AIVA_CONFIG || 'aiva.config.json'), 'utf8')) as {
      appointments?: { days?: unknown[]; hours?: unknown[] };
      sedes?: { hours?: unknown[] }[];
    };
    const propio = Boolean(crudo.appointments?.days?.length && crudo.appointments?.hours?.length);
    const enSedes = Boolean(crudo.sedes?.length && crudo.sedes.every((s) => s.hours?.length));
    escrito = propio || enSedes;
  } catch {
    // Si el archivo no se puede leer, no se inventa un pendiente: se da por bueno lo que corre.
  }
  const sinHorario = !business.appointments.days.length || !business.appointments.hours.length;
  return {
    id: 'citas',
    titulo: 'Pon tu horario de citas',
    hecho: escrito && !sinHorario,
    opcional: false,
    falta: sinHorario
      ? 'No hay días ni franjas de atención: así no se puede agendar nada.'
      : !escrito
        ? `Está el horario de ejemplo (lunes a viernes, de 9 a 1 y de 2 a 6), y ${business.agent.name} ofrecería esas horas. Pon el tuyo.`
        : '',
    ir: 'negocio',
  };
}

/** El calendario del dueño, para no ofrecer horas en que está ocupado. Opcional, y solo si agenda. */
function pasoCalendario(): PasoGuia | null {
  if (!business.appointments.enabled) return null;
  const fuentes = busyStatus();
  const bien = fuentes.some((s) => s.ok);
  const rota = fuentes.find((s) => !s.ok && s.error);
  return {
    id: 'calendario',
    titulo: 'Conecta tu calendario',
    hecho: bien,
    opcional: true,
    falta: bien
      ? ''
      : rota
        ? `El calendario no se pudo leer: ${rota.error}.`
        : `${business.agent.name} no ve tu calendario y puede ofrecer horas en que ya estás ocupado. Se conecta una vez: pídelo y lo dejamos listo.`,
    ir: 'agent',
  };
}

export function pasosDeLaGuia(): PasoGuia[] {
  // Los opcionales al final: el navegador mete «con qué nombre respondes» justo antes del primero.
  return [pasoPerfil(), pasoCatalogo(), pasoCanal(), pasoPrueba(), pasoCitas(), pasoPrecios(), pasoCalendario()].filter((p): p is PasoGuia => p !== null);
}
