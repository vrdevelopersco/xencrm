// Cuando alguien quiere cancelar su cita: entender por qué antes de cancelar, y solo insistir cuando insistir
// sirve de algo.
//
// Un asistente que cancela a la primera pierde citas que no estaban perdidas: mucha gente escribe «cancélala»
// cuando lo que quiere es moverla, o cuando le dio pereza, o cuando le entró el miedo de que la cita sea un
// compromiso de compra. Y un asistente que se pone a rogar es peor: deja la marca por el piso y además no
// funciona.
//
// De dónde sale lo que se hace aquí:
//
// - **Reactancia** (Brehm). Cuando alguien siente que le quitan la libertad de elegir, la recupera yéndose. Un
//   segundo intento después de un «no» no baja la cancelación: sube la probabilidad de perder al cliente para
//   siempre. De ahí la regla del intento único.
// - **Entrevista motivacional** (Miller y Rollnick). Lo que alguien dice a favor de no seguir no es resistencia,
//   es ambivalencia, y rebatirla la aumenta. Por eso aquí no se discute: se refleja y se baja el riesgo.
// - **Sobrecarga de elección** e **intenciones de implementación** (Milkman et al., PNAS 2011). Dos horarios
//   concretos convierten mucho mejor que «¿cuándo te sirve?», que es la forma documentada de perder la cita.
// - **Regla pico-final** (Kahneman). El último mensaje de una cancelación es el que queda como recuerdo de toda
//   la relación. Por eso el cierre es cálido y sin reproche, incluso cuando se pierde.
// - **Ley 2300 de 2023** (Colombia, «dejen de fregar»): no se puede contactar a alguien más de una vez el mismo
//   día ni por varios canales en la misma semana. La ley del país del cliente ya zanjó el debate sobre insistir.
// - Y la línea de los reguladores donde esto ya se abusó: la FTC permite ofrecer algo antes de cancelar, pero
//   persigue que la oferta se vuelva un obstáculo —en los casos de Uber y Chegg lo sancionado fue la asimetría:
//   que quedarse fuera más fácil que irse—. Cancelar tiene que costar lo mismo o menos que agendar.
//
// 🪤 Lo que NO sostiene nada de esto son las neuroventas. Su base —el «cerebro reptiliano» que decide el 85 % de
// las compras— es un neuromito desacreditado. Algunas de sus recomendaciones coinciden con lo de arriba, pero
// porque lo de arriba está medido, no porque lo diga el reptil. Se cita la fuente que sí aguanta.
//
// 🪤 LAS CUATRO REGLAS, que son el diseño entero:
//
//   1. Un solo intento, nunca dos. Y queda anotado, para que no se repita ni dentro de un mes.
//   2. Cada mensaje de retención lleva la salida escrita. «Y si prefieres cancelarla, me dices y lo hago.»
//   3. Nunca se exige un motivo. Quien no quiere decir por qué, cancela igual y en el mismo mensaje.
//   4. Nunca se inventa urgencia. Lo único que se puede usar es lo que de verdad sabemos: la fecha de su
//      evento, que está en su ficha. Si falta poco, eso es una pérdida REAL y decirlo es un favor, no una
//      presión. Si no la sabemos, no hay prisa que inventar.
import { V } from '../vocabulario.js';
import type { Contact } from './contacts.js';

/** Por qué quiere cancelar. Lo que decide si se insiste o no. */
export type Motivo =
  /** Se le cruzó algo de logística: un viaje, un turno, le movieron la fecha del evento. Se le ofrece mover. */
  | 'impedimento'
  /**
   * Algo serio: duelo, enfermedad, lo echaron del trabajo, se quedó sin plata.
   *
   * 🪤 Es distinto de «impedimento» y por eso tiene su propio camino. A quien se le cruzó un viaje se le ofrece
   * el jueves o el sábado y le sirve. A quien acaba de perder el trabajo, ofrecerle dos fechas de la semana
   * entrante es sordo: su problema no es el día. Aquí la puerta se deja abierta SIN fecha.
   */
  | 'duro'
  /** Se enfrió, lo va a pensar, le pareció caro, ya no lo ve necesario. Aquí sí vale preguntar una vez. */
  | 'duda'
  /** No quiere hablar del tema, o ya lo pidió otra vez. Se cancela y punto. */
  | 'insiste'
  /** No se entiende qué dijo. */
  | null;

/**
 * 🪤 Esto se mira ANTES que lo demás y manda sobre todo. Son las formas de decir «no me preguntes más»: si
 * alguien las usa y aun así se le vuelve a preguntar, deja de ser servicio y pasa a ser acoso. Incluye el
 * «ya te dije» porque repetir es la señal más clara de que la primera respuesta no se respetó.
 */
// 🪤 Y «déjalo así» NO está aquí, aunque suene a «no me preguntes más». En una conversación sobre una cita, lo
// que quiere decir casi siempre es lo contrario: «deja la cita como está», o sea CONSÉRVALA. Tenerlo en esta
// lista hacía que a quien se arrepintió de cancelar se le cancelara la cita por decir que la dejaran quieta, y
// eso es el peor error posible de este módulo: destruye justo lo que vino a cuidar.
const BASTA_RE =
  /\bya te (?:dije|respond[ií]|expliqu[eé])\b|\bno (?:me )?insist\w*\b|\bno (?:quiero|voy a) (?:dar|decir|explicar)\b|\bes personal\b|\bno te importa\b|\bsolo canc[eé]l\w*\b|\bcanc[eé]l\w*\s+(?:y ya|de una|nom[aá]s|no m[aá]s)\b|\bno quiero hablar\b/i;

/**
 * Algo le pasó. Aquí no se insiste: se acompaña y se ofrece mover.
 *
 * 🪤 La lista es generosa a propósito, y eso es una decisión, no un descuido. Equivocarse hacia «impedimento»
 * cuesta una cita que quizá se podía salvar; equivocarse hacia «duda» cuesta preguntarle «¿y eso por qué?» a
 * alguien que acaba de decir que se le murió el papá. Los dos errores no valen lo mismo.
 */
// 🪤 El final de cada alternativa es `(?![a-záéíóúñ])`, NO `\b`. En JavaScript, `\b` mira si cambia de carácter
// de palabra a carácter que no lo es, y una vocal acentuada no cuenta como carácter de palabra: después de
// «murió» no hay frontera que valga, así que `muri[oó]\b` no reconocía «se me murió mi abuelo». En español eso
// deja fuera media lista —salió, falleció, aplazó, cruzó, presentó— y el fallo es silencioso: la frase cae en
// «duda» y a quien se le murió un familiar se le contesta con argumentos de venta.
const FIN = '(?![a-záéíóúñ])';
const IMPEDIMENTO_RE = [
  'viaje|viajo|me voy de viaje|me sali[oó] un viaje|estoy fuera|no estoy en la ciudad|me toc[oó] salir',
  'me sali[oó] (?:un |una )?(?:trabajo|reuni[oó]n|turno|vuelta|diligencia)|me cambiaron el turno|tengo que trabajar|me toca trabajar|se me cruz[oó]\\w*',
  'se (?:aplaz[oó]|corri[oó]|cancel[oó]|movi[oó]) (?:la boda|el evento|el grado|la fiesta|el matrimonio)|aplazaron|corrieron la fecha|cambiaron la fecha',
  'emergencia|imprevisto|se me present[oó] algo|me surgi[oó] algo|problema familiar|asunto familiar',
]
  .map((parte) => `\\b(?:${parte})${FIN}`)
  .join('|');

const ES_IMPEDIMENTO = new RegExp(IMPEDIMENTO_RE, 'i');

/**
 * Lo serio. Aquí no se ofrece nada, no se pregunta nada y no se pone fecha: solo se acompaña.
 *
 * 🪤 Un problema de plata DECLARADO va aquí, y la diferencia con «está caro» importa. «Está caro» es una
 * percepción y se puede responder una vez; «no me alcanza» o «me quedé sin trabajo» es un hecho, y a un hecho
 * no se le rebate: se le respeta. Insistirle a quien acaba de decir que no tiene con qué es la forma más rápida
 * de que no vuelva nunca, y de paso lo humilla.
 */
const ES_DURO = new RegExp(
  [
    'me enferm\\w*|estoy enfermo|enferm[oó]|gripa|covid|cirug[ií]a|hospital|incapacidad|me accident\\w*|accidente',
    'se (?:me |nos )?muri[oó]|falleci[oó]|duelo|velorio|funeral|luto',
    'no me alcanza|no tengo (?:la )?plata|sin plata|me qued[eé] sin (?:trabajo|empleo)|me despidieron|no me qued[oó] plata|estoy sin (?:trabajo|empleo)|se me fue la plata',
  ]
    .map((parte) => `\\b(?:${parte})${FIN}`)
    .join('|'),
  'i',
);

/** Se enfrió o le entró la duda. Lo que de verdad frena suele ser el miedo a que la cita comprometa a comprar. */
const DUDA_RE =
  /\b(?:lo voy a pensar|lo pienso|d[eé]jame pensarlo|m[aá]s adelante|despu[eé]s|luego|otro d[ií]a sin falta)\b|\b(?:ya no (?:lo )?(?:necesito|quiero|me interesa|creo)|cambi[eé] de (?:idea|opini[oó]n)|me arrepent[ií])\b|\b(?:est[aá] (?:muy )?caro|carito|muy costoso|el presupuesto)\b|\b(?:encontr[eé] (?:otro|otra)|voy a mirar en otro|en otra parte|ya consegu[ií])\b|\b(?:no s[eé]|no estoy seguro|tal vez|quiz[aá]s?)\b/i;

/**
 * Qué dijo cuando se le preguntó.
 *
 * `yaSeIntento` manda sobre todo lo demás: si ya se le preguntó una vez por esta cita, lo que diga ahora se
 * respeta sin más vueltas.
 */
export function motivoDeCancelar(texto: string, yaSeIntento = false): Motivo {
  const t = (texto ?? '').trim();
  if (!t) return null;
  if (yaSeIntento || BASTA_RE.test(t)) return 'insiste';
  // Lo serio se mira ANTES que lo logístico: «me enfermé y me sale un viaje» es enfermedad, no viaje.
  if (ES_DURO.test(t)) return 'duro';
  if (ES_IMPEDIMENTO.test(t)) return 'impedimento';
  if (DUDA_RE.test(t)) return 'duda';
  return null;
}

/** Cuántos días faltan para el evento del cliente, si lo sabemos y se entiende. */
export function diasParaElEvento(c: Contact | null, ahora = Date.now()): number | null {
  const crudo = (c?.data as Record<string, unknown> | null)?.['fecha_evento'];
  if (typeof crudo !== 'string' || !crudo.trim()) return null;
  // Solo se usa si la fecha se entiende de verdad. Una fecha a medias («en diciembre») no sirve para decirle a
  // nadie que le queda poco tiempo, y decirlo mal sería justo la urgencia inventada que esto quiere evitar.
  const d = new Date(crudo);
  if (Number.isNaN(d.getTime())) return null;
  // 🪤 Se cuentan DÍAS DE CALENDARIO, no cachos de 24 horas. Con la resta cruda, una fecha a catorce días daba
  // trece porque sobraban unas horas, y el mensaje le decía al cliente un número que no cuadra con el que él
  // tiene en la cabeza. En un mensaje cuyo único propósito es que se fíe de uno, eso es caro.
  const soloDia = (ms: number) => {
    const x = new Date(ms);
    return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
  };
  const dias = Math.round((soloDia(d.getTime()) - soloDia(ahora)) / 86400_000);
  return dias >= 0 && dias < 400 ? dias : null;
}

/** Lo que falta para que una confección a la medida alcance. Por debajo de esto, perder la cita cuesta de verdad. */
export const DIAS_JUSTOS = 45;

export interface Salida {
  /** Lo que se le contesta. */
  texto: string;
  /** Si hay que cancelar ya. */
  cancelar: boolean;
  /** Si este mensaje gastó el único intento. */
  gastaIntento: boolean;
}

/**
 * La primera respuesta: se pregunta qué pasó, con la salida puesta en el mismo mensaje.
 *
 * 🪤 Se pregunta y se ofrece mover A LA VEZ, y la cancelación se nombra sin rodeos. Preguntar «¿por qué?» a
 * secas suena a que hay que justificarse ante una máquina para que lo deje ir a uno, que es exactamente la
 * sensación que convierte un trámite en un mal recuerdo de la marca.
 */
export function preguntaQuePaso(cita: string): string {
  // 🪤 Se nombran LAS DOS salidas, y «ya no estoy tan seguro» se dice en voz alta como una respuesta válida. Si
  // solo se pregunta «¿qué día te sirve?», al que se arrepintió no le queda más que inventarse una excusa o
  // pelear, y las dos cosas terminan igual de mal. Darle permiso para decir que ya no quiere es lo que hace que
  // conteste de verdad — y solo sabiendo cuál de las dos es se puede ayudar sin empujar.
  //
  // 🪤 Y NO dice «listo, lo cancelo» antes de preguntar, aunque así suene más amable. Sería decirle a alguien
  // que su cita quedó cancelada cuando todavía no lo está: si no vuelve a escribir, se queda con una cita en
  // pie que él cree muerta, y encima le llega el recordatorio. Prometer la cancelación y no hacerla es peor que
  // preguntar.
  return `Claro. Dime una cosa para ayudarte bien${cita ? ` con tu ${cita}` : ''}: ¿es que no te sirve ese día, o es que ya no estás tan seguro? Con cualquiera de las dos te ayudo — y si prefieres que la cancele de una, me lo dices y listo 🙂`;
}

/**
 * Qué se contesta según el motivo.
 *
 * `opciones` son los espacios reales que hay libres, ya en texto. 🪤 Se ofrecen DOS concretos en vez de
 * preguntar «¿cuándo te sirve?»: una fecha concreta se acepta o se rechaza en un segundo, mientras que la
 * pregunta abierta obliga a abrir el calendario mental y es donde se cae la conversación.
 */
export function respuesta(motivo: Motivo, opts: { cita: string; opciones: string[]; diasEvento: number | null }): Salida {
  const mover = opts.opciones.length
    // Sin punto al final si la última opción ya lo trae ("11:00 a. m."), que si no queda "a. m..".
    ? ` Tengo ${opts.opciones.slice(0, 2).join(' o ')}`.replace(/\.$/, '') + '.'
    : '';

  if (motivo === 'insiste') {
    return { texto: '', cancelar: true, gastaIntento: false };
  }

  if (motivo === 'duro') {
    // 🪤 Ni oferta, ni fecha, ni pregunta. A quien se le murió alguien, o acaba de quedarse sin trabajo, no se
    // le propone «el jueves a las 2»: su problema no es el día, y ponerle una fecha es no haberlo escuchado.
    // Solo se le quita la cita de encima y se le deja la puerta abierta, sin plazo.
    return {
      texto: `Uy, qué pena contigo, de verdad. No te preocupes por ${V.la} ${V.cita}, yo la cancelo y ya está. Cuando estés listo me escribes por aquí y la volvemos a agendar, sin afán.`,
      cancelar: true,
      gastaIntento: false,
    };
  }

  if (motivo === 'impedimento') {
    // Se le cruzó algo: no se le insiste, se le resuelve. Dos fechas concretas, que convierten mejor que
    // preguntar «¿cuándo te sirve?» —la forma documentada de perder la cita—.
    return {
      texto: `Uy, qué pena.${mover ? ` ¿Te sirve que la movamos?${mover}` : ' Cuando se te acomode me escribes y la movemos.'} Y si prefieres que la cancele mientras tanto, me dices y listo.`,
      cancelar: false,
      gastaIntento: false, // no se gastó: no se le insistió en nada
    };
  }

  if (motivo === 'duda') {
    // El único intento, y no se discute lo que dijo: se le quita el riesgo.
    //
    // 🪤 Y se le quita EL RIESGO QUE DE VERDAD TIENE. En una boutique de hombres lo que frena casi nunca es la
    // plata: es el miedo a que no le quede, a verse disfrazado, a que lo midan y lo juzguen. Contestar con el
    // precio es responderle a una objeción que no hizo, y deja intacta la que sí tenía.
    const apuro =
      opts.diasEvento !== null && opts.diasEvento <= DIAS_JUSTOS
        ? ` Lo único que te digo: faltan ${opts.diasEvento} días para lo tuyo, y si al final te animas por algo a la medida, la confección y las pruebas se ponen justas.`
        : '';
    return {
      texto:
        `Te entiendo. Si sirve de algo: en ${V.la} ${V.cita} no tienes que decidir nada ni llevarte nada. Es ver qué te` +
        ` queda bien y que te digan con franqueza qué te sirve y qué no.${apuro}` +
        ` ¿La dejamos y miras sin compromiso, o te la cancelo?`,
      cancelar: false,
      gastaIntento: true,
    };
  }

  // No se entendió qué dijo. No se insiste a ciegas: se ofrece mover y se deja la puerta de salida.
  return {
    texto: `Entiendo.${mover ? ` ¿Quieres que la movamos?${mover}` : ' ¿Quieres que la movamos para otro día?'} O si prefieres que la cancele, me dices y la cancelo de una.`,
    cancelar: false,
    gastaIntento: false,
  };
}

/** Lo que se le dice al cancelar de verdad: corto, cálido y sin reproche. */
export function alCancelar(servicio: string, cuando: string): string {
  return `Listo, cancelé tu ${servicio} del ${cuando}. Cuando quieras retomar me escribes por aquí y te busco espacio 🙂`;
}

const MARCA = 'retencion_cita';

/** ¿Ya se le preguntó por ESTA cita? */
export function yaSeIntento(c: Contact | null, citaId: number): boolean {
  return Number((c?.data as Record<string, unknown> | null)?.[MARCA]) === citaId;
}

/** Deja anotado que el único intento se gastó, para que no haya un segundo. */
export function anotarIntento(data: Record<string, unknown> | null, citaId: number): Record<string, unknown> {
  return { ...(data ?? {}), [MARCA]: citaId };
}
