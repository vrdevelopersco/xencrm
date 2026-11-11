// Optimización de ventas: dónde se pierden ventas y qué hacer distinto, con los datos de verdad.
//
// Es la idea de los «insights» de Dynamics 365 Sales, pero SIN modelo: reglas fijas sobre lo que XENCRM ya calcula
// (ventas y perdidas, la Lista de trabajo, los tiempos de respuesta, de dónde llega la gente, el sentimiento, lo que
// el asistente prometió verificar). Ninguna frase se genera: cada regla tiene su texto, y cada cifra va con su base
// («2 de 5»), porque un porcentaje sin base es la forma más fácil de engañar sin decir nada falso.
//
// 🪤 Umbral de evidencia. Con tres conversaciones cualquier «patrón» es ruido, y un hallazgo que sale con poca
// gente enseña a desconfiar de todos los demás. Cada regla tiene su mínimo; por debajo, el hallazgo no sale o sale
// marcado «poca evidencia» y dice cuánto falta.
//
// Se parte en dos: `hallazgosDe` son las reglas, puras (las prueba eval/optimizacion.ts sin base de datos), y
// `optimizacion` junta los datos de la base para dárselos.
import { fraccion, regla } from '../reglas.js';
import { business } from '../config.js';
import { getDb } from '../rag/store.js';
import { estaCerrada, listContacts, rolDe, STAGE_DEFS, STAGE_LABELS, type Stage } from './contacts.js';
import { listAppointments } from './appointments.js';
import { isSnoozed } from './followup.js';
import { valorDe, valorDelEmbudo } from './valor.js';
import { esperas, horarioDelNegocio, resumenTiempos } from './tiempos.js';
import { actividadPorHora } from './series.js';
import { porCampana } from './origen.js';
import { sentimiento } from './sentimiento.js';
import { listVerifications } from './verifications.js';
import { seguimientosPendientes, ventasDelPeriodo } from './resultados.js';

const DIA = 86400_000;

/** Los mínimos de cada regla. Por debajo, la regla calla o avisa que es poca evidencia. */
/**
 * Los mínimos de cada regla. Son reglas del registro (Configuración › Reglas y umbrales, grupo «Optimización de
 * ventas»): se leen cada vez, así un cambio desde el tablero se nota en la siguiente carga sin reiniciar. Los
 * porcentajes se guardan como los lee la gente («60 %») y aquí se usan como fracción (0.6).
 */
export const UMBRAL = {
  /** Cuántos tienen que haber llegado a una etapa para juzgar cuántos pasan a la siguiente. */
  get baseEmbudo() { return regla<number>('opt.baseEmbudo'); },
  /** Por debajo de esta tasa de paso, la etapa es «donde se caen». */
  get pasoBajo() { return fraccion('opt.pasoBajoPct'); },
  /** Por debajo de esta, el hallazgo es de prioridad alta. */
  get pasoMuyBajo() { return fraccion('opt.pasoMuyBajoPct'); },
  /** Días sin actividad para que un trato abierto cuente como estancado. */
  get diasEstancado() { return regla<number>('opt.diasEstancado'); },
  /** Tratos cerrados con tiempo de primera respuesta medido, y mínimo por grupo (rápidos / lentos). */
  get cerradosVelocidad() { return regla<number>('opt.cerradosVelocidad'); },
  get grupoVelocidad() { return regla<number>('opt.grupoVelocidad'); },
  /** Respuestas medidas para juzgar el acuerdo de servicio, desde qué parte fuera del acuerdo preocupa y desde cuál es alta. */
  get respondidas() { return regla<number>('opt.respondidas'); },
  get fueraDeAcuerdo() { return fraccion('opt.fueraDeAcuerdoPct'); },
  get fueraDeAcuerdoAlta() { return fraccion('opt.fueraDeAcuerdoAltaPct'); },
  /** Mensajes de clientes para hablar de horas, y desde qué parte fuera de horario se avisa. */
  get mensajesHoras() { return regla<number>('opt.mensajesHoras'); },
  get fueraDeHorario() { return fraccion('opt.fueraDeHorarioPct'); },
  /** Contactos por canal para comparar canales, y diferencia mínima (en puntos) para que valga la pena decirlo. */
  get porCanal() { return regla<number>('opt.porCanal'); },
  get difCanal() { return regla<number>('opt.difCanalPuntos') / 100; },
  /** Perdidos para hablar de motivos, desde qué parte sin motivo se avisa, y veces para que una objeción «se repita». */
  get perdidas() { return regla<number>('opt.perdidas'); },
  get sinMotivo() { return fraccion('opt.sinMotivoPct'); },
  get objecion() { return regla<number>('opt.objecion'); },
};

export type Prioridad = 'alta' | 'media' | 'baja';

export interface Hallazgo {
  id: string;
  prioridad: Prioridad;
  titulo: string;
  /** La cifra que se ve grande («2 de 5», «4»). */
  cifra: string;
  /** Sobre qué se contó: sin esto la cifra no significa nada. */
  base: string;
  porQue: string;
  queHacer: string;
  /** La pantalla que lo resuelve. `soloAdmin`: es de configuración (con el candado, no se abre). */
  ir: { vista: string; etiqueta: string; filtro?: string; soloAdmin?: boolean };
  evidencia: 'suficiente' | 'poca';
  /** Para ordenar dentro de la misma prioridad: más alto, más arriba. */
  peso: number;
}

export interface FilaEstancada {
  id: string;
  nombre: string | null;
  canal: string;
  etapa: Stage;
  titulo: string;
  rol: string;
  diasSinActividad: number;
  /** Desde cuándo está en su etapa (la última vez que cambió de etapa; si nunca, cuando llegó). */
  enEtapaDesde: number;
  /** Quién lo lleva: el asignado; si no hay, quien tomó la conversación; si no, null. */
  quien: string | null;
  valor: number;
  puntaje: number;
  resumen: string | null;
}

/** Lo que necesitan las reglas, ya contado. Todo sale de la base en `optimizacion`, o de una prueba. */
export interface Entradas {
  dias: number;
  /** Las etapas abiertas y ganada en orden (por papel), con cuántos de los que llegaron en el periodo alcanzaron cada una. */
  embudo: { rol: string; titulo: string; llegaron: number }[];
  /** De qué etapa se fueron los que se perdieron en el periodo. */
  perdidasDesde: { titulo: string; n: number }[];
  entraron: number;
  estancados: FilaEstancada[];
  abiertos: number;
  velocidad: { acuerdoMin: number; rapidos: { ganados: number; cerrados: number }; lentos: { ganados: number; cerrados: number } };
  tiempos: { respondidas: number; fueraDeAcuerdo: number; acuerdoMin: number };
  horas: { total: number; pico: { desde: number; hasta: number; n: number } | null; fuera: number | null };
  canales: { canal: string; nombre: string; contactos: number; ganados: number }[];
  campana: { nombre: string; conversaciones: number; ganadas: number } | null;
  perdidas: { cuantas: number; sinMotivo: number; motivos: { motivo: string; n: number }[] };
  seguimientos: { cuantos: number; calientes: number };
  objeciones: { texto: string; n: number }[];
  cuidar: number;
  verificaciones: { pendientes: number; enTratosVivos: number };
  precios: { abiertos: number; conValor: number; catalogoSinPrecios: boolean };
}

const de = (a: number, b: number) => `${a} de ${b}`;
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
const hora = (h: number) => `${h}:00`;

/** Qué hacer cuando la gente se queda entre dos etapas, según el papel de la etapa donde se quedan. */
const QUE_HACER_EN: Record<string, string> = {
  inicio: 'Revisa el primer mensaje del asistente y que conteste en minutos: quien escribe y no recibe nada útil enseguida no sigue la conversación.',
  activo: 'Conversan pero no muestran interés: revisa que el catálogo y los precios estén cargados en Lo que sabe, para que el asistente pueda concretar en vez de dar vueltas.',
  interes: 'Muestran interés pero no dan el siguiente paso: ofrece la cita (o la propuesta) antes, y retoma a los interesados desde la Lista de trabajo.',
  cita: 'Agendan pero no compran: después de cada cita registra cómo les fue y, si se pierden, el motivo. Así se ve qué pasa en la cita.',
};

/** Las reglas. Puras: mismas entradas, mismos hallazgos, en el mismo orden. */
export function hallazgosDe(e: Entradas): Hallazgo[] {
  const h: Hallazgo[] = [];

  // 1. Dónde se caen: la etapa que menos gente deja pasar a la siguiente.
  const pasos = e.embudo
    .slice(0, -1)
    .map((x, i) => ({ de: x, a: e.embudo[i + 1]!, tasa: x.llegaron ? e.embudo[i + 1]!.llegaron / x.llegaron : 1 }))
    .filter((p) => p.de.llegaron >= UMBRAL.baseEmbudo);
  const peor = [...pasos].sort((a, b) => a.tasa - b.tasa)[0];
  if (peor && peor.tasa < UMBRAL.pasoBajo) {
    const perdidosAhi = e.perdidasDesde.find((p) => p.titulo === peor.de.titulo);
    h.push({
      id: 'embudo-caida',
      prioridad: peor.tasa < UMBRAL.pasoMuyBajo ? 'alta' : 'media',
      titulo: `Donde más se quedan: entre «${peor.de.titulo}» y «${peor.a.titulo}»`,
      cifra: de(peor.a.llegaron, peor.de.llegaron),
      base: `de los que llegaron a «${peor.de.titulo}» en ${e.dias} días pasaron a «${peor.a.titulo}»` +
        (perdidosAhi && perdidosAhi.n ? `; ${plural(perdidosAhi.n, 'se perdió', 'se perdieron')} justo ahí` : ''),
      porQue: 'Es el paso del embudo que más gente pierde: mejorar ese solo paso mueve todo lo que viene después.',
      queHacer: QUE_HACER_EN[peor.de.rol] ?? QUE_HACER_EN.interes!,
      ir: { vista: 'embudo', etiqueta: 'Ver el embudo' },
      evidencia: 'suficiente',
      peso: 100 - Math.round(peor.tasa * 100),
    });
  } else if (!pasos.length && e.entraron > 0) {
    h.push({
      id: 'embudo-poca',
      prioridad: 'baja',
      titulo: 'Todavía no se puede ver dónde se caen los tratos',
      cifra: String(e.entraron),
      base: `${plural(e.entraron, 'contacto llegó', 'contactos llegaron')} en ${e.dias} días; hacen falta ${UMBRAL.baseEmbudo} en una misma etapa para comparar con la siguiente`,
      porQue: 'Con menos gente, cualquier diferencia entre etapas es casualidad.',
      queHacer: 'Prueba con un periodo más largo (90 días) o vuelve cuando hayan entrado más conversaciones.',
      ir: { vista: 'embudo', etiqueta: 'Ver el embudo' },
      evidencia: 'poca',
      peso: 0,
    });
  }

  // 2. Tratos estancados: abiertos y quietos. Es lo más fácil de recuperar: ya conocen el negocio.
  if (e.estancados.length) {
    const conValor = e.estancados.filter((x) => x.valor > 0);
    const calientes = e.estancados.filter((x) => x.puntaje >= regla<number>('puntaje.caliente')).length;
    h.push({
      id: 'estancados',
      prioridad: conValor.length || calientes ? 'alta' : 'media',
      titulo: `${plural(e.estancados.length, 'trato lleva', 'tratos llevan')} ${UMBRAL.diasEstancado} días o más sin moverse`,
      cifra: de(e.estancados.length, e.abiertos),
      base: `tratos abiertos sin actividad en ${UMBRAL.diasEstancado} días o más, sin cita por delante y sin posponer` + (calientes ? ` (${plural(calientes, 'caliente', 'calientes')})` : ''),
      porQue: 'Un trato quieto se enfría solo: quien ya preguntó por algo es más fácil de recuperar que alguien nuevo.',
      queHacer: 'Escríbeles hoy, empezando por los que valen más o tienen mejor puntaje; si de verdad no es el momento, déjalos «por ahora» para que no ensucien la lista.',
      ir: { vista: 'optimizacion', etiqueta: 'Ver los estancados', filtro: 'estancados' },
      evidencia: 'suficiente',
      peso: 90 + Math.min(9, calientes),
    });
  }

  // 3. Seguimientos pendientes: la Lista de trabajo.
  if (e.seguimientos.cuantos) {
    h.push({
      id: 'seguimientos',
      prioridad: e.seguimientos.calientes ? 'alta' : 'media',
      titulo: `${plural(e.seguimientos.cuantos, 'persona espera', 'personas esperan')} que alguien le escriba`,
      cifra: String(e.seguimientos.cuantos),
      base: 'tratos abiertos sin mensajes en más de 24 horas, sin cita y sin posponer' + (e.seguimientos.calientes ? ` (${plural(e.seguimientos.calientes, 'caliente', 'calientes')})` : ''),
      porQue: 'Cada día sin respuesta baja la probabilidad de cerrar, y los calientes se enfrían primero.',
      queHacer: 'Abre la Lista de trabajo y escríbeles en ese orden: arriba van los que más valen la pena.',
      ir: { vista: 'seguimientos', etiqueta: 'Abrir la Lista de trabajo' },
      evidencia: 'suficiente',
      peso: 80 + Math.min(9, e.seguimientos.calientes),
    });
  }

  // 4. Lo que el asistente prometió verificar y nadie ha contestado.
  if (e.verificaciones.pendientes) {
    h.push({
      id: 'verificar',
      prioridad: e.verificaciones.enTratosVivos ? 'alta' : 'media',
      titulo: `El asistente prometió verificar ${plural(e.verificaciones.pendientes, 'cosa', 'cosas')} y siguen sin respuesta`,
      cifra: String(e.verificaciones.pendientes),
      base: e.verificaciones.enTratosVivos ? `${de(e.verificaciones.enTratosVivos, e.verificaciones.pendientes)} son de tratos con interés o con cita` : 'preguntas que el asistente no supo contestar y dejó para el equipo',
      porQue: 'Quien preguntó está esperando esa respuesta para decidir; mientras no llegue, el trato no avanza.',
      queHacer: 'Contéstalas en Inicio › Por verificar y marca «Agregar a la información»: la próxima vez el asistente lo sabrá solo.',
      ir: { vista: 'today', etiqueta: 'Ir a Por verificar' },
      evidencia: 'suficiente',
      peso: 70,
    });
  }

  // 5. Quieren comprar pero están molestos.
  if (e.cuidar) {
    h.push({
      id: 'cuidar',
      prioridad: 'alta',
      titulo: `${plural(e.cuidar, 'persona quiere', 'personas quieren')} comprar y está molesta`,
      cifra: String(e.cuidar),
      base: 'con interés claro o queriendo comprar, y ánimo molesto en su último análisis',
      porQue: 'Son ventas casi hechas que se pueden ir por cómo se les atendió, no por el producto.',
      queHacer: 'Tómales la conversación tú (pausa la automatización) y atiéndelos con nombre propio.',
      ir: { vista: 'analysis', etiqueta: 'Ver en Sentimiento' },
      evidencia: 'suficiente',
      peso: 75,
    });
  }

  // 6. Velocidad de respuesta: el acuerdo de servicio, y si contestar rápido vende más.
  if (e.tiempos.respondidas >= UMBRAL.respondidas) {
    const parte = e.tiempos.fueraDeAcuerdo / e.tiempos.respondidas;
    if (parte >= UMBRAL.fueraDeAcuerdo) {
      h.push({
        id: 'acuerdo',
        prioridad: parte >= UMBRAL.fueraDeAcuerdoAlta ? 'alta' : 'media',
        titulo: `Una de cada ${Math.max(2, Math.round(1 / parte))} respuestas tarda más de ${e.tiempos.acuerdoMin} minutos`,
        cifra: de(e.tiempos.fueraDeAcuerdo, e.tiempos.respondidas),
        base: `respuestas de los últimos ${e.dias} días fuera del acuerdo de ${e.tiempos.acuerdoMin} minutos (en horario de atención)`,
        porQue: 'La primera respuesta es cuando más interés hay: cada minuto de espera es gente que le escribe a otro.',
        queHacer: 'Reparte la bandeja (Mías · Sin asignar) para que nada quede sin dueño, y pon a quién avisar por WhatsApp cuando alguien espera de más.',
        ir: { vista: 'inbox', etiqueta: 'Abrir la bandeja' },
        evidencia: 'suficiente',
        peso: 60 + Math.round(parte * 10),
      });
    }
  }
  const { rapidos, lentos } = e.velocidad;
  const cerrados = rapidos.cerrados + lentos.cerrados;
  if (cerrados >= UMBRAL.cerradosVelocidad && rapidos.cerrados >= UMBRAL.grupoVelocidad && lentos.cerrados >= UMBRAL.grupoVelocidad) {
    const tr = rapidos.ganados / rapidos.cerrados;
    const tl = lentos.ganados / lentos.cerrados;
    if (tr - tl >= 0.1) {
      h.push({
        id: 'velocidad',
        prioridad: 'media',
        titulo: 'Los que se contestaron rápido compraron más',
        cifra: `${de(rapidos.ganados, rapidos.cerrados)} · ${de(lentos.ganados, lentos.cerrados)}`,
        base: `tratos cerrados en ${e.dias} días: contestados en ${e.velocidad.acuerdoMin} minutos o menos · contestados después`,
        porQue: 'En este negocio, la velocidad de la primera respuesta se nota en las ventas.',
        queHacer: 'Que lo nuevo nunca espere: el asistente contesta solo, pero lo que pide una persona tiene que tomarse en minutos.',
        ir: { vista: 'inbox', etiqueta: 'Abrir la bandeja' },
        evidencia: 'suficiente',
        peso: 55,
      });
    }
  } else if (cerrados > 0) {
    h.push({
      id: 'velocidad-poca',
      prioridad: 'baja',
      titulo: 'Aún no se puede saber si contestar rápido vende más',
      cifra: String(cerrados),
      base: `${plural(cerrados, 'trato cerrado', 'tratos cerrados')} con tiempo de respuesta medido en ${e.dias} días; hacen falta ${UMBRAL.cerradosVelocidad}, con al menos ${UMBRAL.grupoVelocidad} rápidos y ${UMBRAL.grupoVelocidad} lentos`,
      porQue: 'Con menos tratos, una diferencia entre rápidos y lentos sería casualidad.',
      queHacer: 'Marca cada trato como vendido o perdido cuando se cierre: de eso sale esta comparación.',
      ir: { vista: 'pipeline', etiqueta: 'Ir a Tratos' },
      evidencia: 'poca',
      peso: 0,
    });
  }

  // 7. Motivos de pérdida.
  if (e.perdidas.cuantas >= UMBRAL.perdidas) {
    const top = e.perdidas.motivos[0];
    if (top && top.n >= 2) {
      h.push({
        id: 'motivo',
        prioridad: 'media',
        titulo: `«${top.motivo}» es el motivo de pérdida que más se repite`,
        cifra: de(top.n, e.perdidas.cuantas),
        base: `tratos perdidos en ${e.dias} días`,
        porQue: 'Si un mismo motivo se lleva varias ventas, atacarlo rinde más que cualquier otra cosa.',
        queHacer: 'Prepara una respuesta para ese motivo (una alternativa, una condición, un ejemplo) y déjala en Lo que sabe para que el asistente la use.',
        ir: { vista: 'ventas', etiqueta: 'Ver las perdidas' },
        evidencia: 'suficiente',
        peso: 50,
      });
    }
    if (e.perdidas.sinMotivo / e.perdidas.cuantas >= UMBRAL.sinMotivo) {
      h.push({
        id: 'sin-motivo',
        prioridad: 'media',
        titulo: 'No se sabe por qué se pierde la mayoría',
        cifra: de(e.perdidas.sinMotivo, e.perdidas.cuantas),
        base: `tratos perdidos en ${e.dias} días sin motivo anotado`,
        porQue: 'Sin el motivo no hay qué corregir: el precio, el tiempo o la atención se ven igual desde fuera.',
        queHacer: 'Al pasar un trato a Perdido, elige el motivo: es un clic y es lo único que dice qué cambiar.',
        ir: { vista: 'ventas', etiqueta: 'Ver las perdidas' },
        evidencia: 'suficiente',
        peso: 45,
      });
    }
  }

  // 8. Objeciones que se repiten.
  const obj = e.objeciones.find((o) => o.n >= UMBRAL.objecion);
  if (obj) {
    h.push({
      id: 'objecion',
      prioridad: 'media',
      titulo: `Se repite una objeción: «${obj.texto}»`,
      cifra: String(obj.n),
      base: 'contactos con esa misma objeción en su último análisis',
      porQue: 'Una objeción que se repite es una pregunta que el negocio todavía no contesta bien.',
      queHacer: 'Escribe cómo se responde en Lo que sabe (respuestas del equipo): el asistente la contestará siempre igual y bien.',
      ir: { vista: 'knowledge', etiqueta: 'Ir a Lo que sabe', soloAdmin: true },
      evidencia: 'suficiente',
      peso: 40 + Math.min(9, obj.n),
    });
  }

  // 9. Sin precios no hay embudo en dinero.
  if (e.precios.abiertos > 0 && e.precios.conValor === 0) {
    h.push({
      id: 'sin-precios',
      prioridad: 'media',
      titulo: 'Ningún trato abierto tiene valor',
      cifra: de(0, e.precios.abiertos),
      base: e.precios.catalogoSinPrecios ? 'tratos abiertos con valor (el catálogo no tiene precios)' : 'tratos abiertos con valor',
      porQue: 'Sin precios no se puede saber cuánto hay en juego, qué trato importa más ni cuánto se pierde en los estancados.',
      queHacer: 'Carga el catálogo con precios en Lo que sabe, o pon el valor a mano en la ficha de cada trato.',
      ir: { vista: 'knowledge', etiqueta: 'Ir a Lo que sabe', soloAdmin: true },
      evidencia: 'suficiente',
      peso: 35,
    });
  }

  // 10. Cuándo escribe la gente.
  if (e.horas.total >= UMBRAL.mensajesHoras && e.horas.pico) {
    const p = e.horas.pico;
    const fuera = e.horas.fuera;
    const muchoFuera = fuera !== null && fuera / e.horas.total >= UMBRAL.fueraDeHorario;
    h.push({
      id: 'horas',
      prioridad: muchoFuera ? 'media' : 'baja',
      // El título no repite la cifra (va grande justo debajo): dice qué tanto es.
      titulo: muchoFuera ? `${fuera! / e.horas.total >= 0.5 ? 'La mayoría' : 'Muchos'} de los mensajes llegan fuera del horario de atención` : `La gente escribe más entre las ${hora(p.desde)} y las ${hora(p.hasta)}`,
      cifra: muchoFuera ? de(fuera!, e.horas.total) : de(p.n, e.horas.total),
      base: muchoFuera
        ? `mensajes de clientes en ${Math.min(e.dias, 60)} días; el pico es entre las ${hora(p.desde)} y las ${hora(p.hasta)}`
        : `mensajes de clientes en ${Math.min(e.dias, 60)} días, en esas tres horas`,
      porQue: muchoFuera
        ? 'El asistente contesta a cualquier hora, pero lo que pide una persona espera hasta que alguien llegue.'
        : 'Es cuando más gente hay del otro lado: ahí rinde tener a alguien atento a la bandeja.',
      queHacer: muchoFuera
        ? 'Retoma a primera hora lo que llegó fuera de horario (Lista de trabajo), o amplía el horario de atención si hay quien lo cubra.'
        : 'Pon a alguien pendiente de la bandeja en esa franja y deja las tareas largas para otras horas.',
      ir: muchoFuera ? { vista: 'seguimientos', etiqueta: 'Abrir la Lista de trabajo' } : { vista: 'analysis', etiqueta: 'Ver en Analítica' },
      evidencia: 'suficiente',
      peso: muchoFuera ? 30 : 20,
    });
  }

  // 11. Canales: cuál convierte mejor (solo si hay gente de sobra en al menos dos).
  const canales = e.canales.filter((c) => c.contactos >= UMBRAL.porCanal);
  if (canales.length >= 2) {
    const orden = [...canales].sort((a, b) => b.ganados / b.contactos - a.ganados / a.contactos || b.contactos - a.contactos);
    const mejor = orden[0]!;
    const peorCanal = orden[orden.length - 1]!;
    if (mejor.ganados / mejor.contactos - peorCanal.ganados / peorCanal.contactos >= UMBRAL.difCanal) {
      h.push({
        id: 'canales',
        prioridad: 'baja',
        titulo: `${mejor.nombre} convierte más que ${peorCanal.nombre}`,
        cifra: `${de(mejor.ganados, mejor.contactos)} · ${de(peorCanal.ganados, peorCanal.contactos)}`,
        base: `contactos que llegaron en ${e.dias} días y compraron, por canal`,
        porQue: 'Si un canal trae gente que compra más, conviene llevar más gente por ahí.',
        queHacer: `Lleva más gente a ${mejor.nombre} (el botón en tu sitio, tus anuncios) y revisa qué le falta a ${peorCanal.nombre}.`,
        ir: { vista: 'analysis', etiqueta: 'Ver de dónde llega la gente' },
        evidencia: 'suficiente',
        peso: 15,
      });
    }
  }
  if (e.campana) {
    h.push({
      id: 'campana',
      prioridad: 'baja',
      titulo: `«${e.campana.nombre}» trae a los que más compran`,
      cifra: de(e.campana.ganadas, e.campana.conversaciones),
      base: `conversaciones de esa campaña en ${e.dias} días que terminaron en venta`,
      porQue: 'Es la campaña que mejor convierte de las que trajeron gente suficiente para juzgarla.',
      queHacer: 'Dale más presupuesto o repite lo que dice ese anuncio en las otras.',
      ir: { vista: 'analysis', etiqueta: 'Ver de dónde llega la gente' },
      evidencia: 'suficiente',
      peso: 10,
    });
  }

  const RANGO: Record<Prioridad, number> = { alta: 0, media: 1, baja: 2 };
  // Empatados, por id: si no, dos que pesan igual cambiarían de puesto cada vez que se abre.
  return h.sort((a, b) => RANGO[a.prioridad] - RANGO[b.prioridad] || (a.evidencia === b.evidencia ? 0 : a.evidencia === 'poca' ? 1 : -1) || b.peso - a.peso || a.id.localeCompare(b.id));
}

const NOMBRE_CANAL: Record<string, string> = { whatsapp: 'WhatsApp', web: 'el chat del sitio', meta: 'WhatsApp oficial', instagram: 'Instagram', messenger: 'Messenger' };
const esDeAlguien = (quien: string | null | undefined) => {
  const q = (quien ?? '').trim();
  return q && !/^(bot|xencrm|admin)$/i.test(q) ? q : null;
};

/** Las tres horas seguidas con más mensajes de la rejilla de actividadPorHora. */
export function picoDeHoras(horas: number[], celdas: number[][]): { desde: number; hasta: number; n: number } | null {
  const porHora = horas.map((h, i) => ({ h, n: (celdas[i] ?? []).reduce((a, b) => a + b, 0) }));
  let mejor: { desde: number; hasta: number; n: number } | null = null;
  for (let i = 0; i < porHora.length; i++) {
    const tramo = porHora.slice(i, i + 3);
    const n = tramo.reduce((a, x) => a + x.n, 0);
    if (n > 0 && (!mejor || n > mejor.n)) mejor = { desde: tramo[0]!.h, hasta: tramo[tramo.length - 1]!.h + 1, n };
  }
  return mejor;
}

export interface Optimizacion {
  dias: number;
  generado: number;
  /** Contactos activos: con cero, no hay de qué sacar conclusiones. */
  contactos: number;
  sinDatos: boolean;
  resumen: { hallazgos: number; alta: number; media: number; baja: number; pocaEvidencia: number };
  /** El valor en juego en los estancados, solo si alguno tiene precio (si no, no hay cifra que dar). */
  impacto: { estancados: { valor: number; conValor: number; cuantos: number } | null };
  hallazgos: Hallazgo[];
  estancados: FilaEstancada[];
  estancadosTotal: number;
  umbral: Record<keyof typeof UMBRAL, number>;
  moneda: string;
}

/** Junta los datos de la base y aplica las reglas. Solo lee: sin modelo y sin red. */
export function optimizacion(diasPedidos = 30, now = Date.now()): Optimizacion {
  const dias = Math.min(365, Math.max(7, Math.round(diasPedidos) || 30));
  const desde = now - dias * DIA;
  const contactos = listContacts({ limit: 2000 }).filter((c) => !c.archived);

  // Las etapas por papel, en el orden del embudo (perdido aparte: no es un paso, es una salida).
  const roles: { rol: string; titulo: string }[] = [];
  for (const s of STAGE_DEFS) {
    if (!s.rol || s.rol === 'perdido' || roles.some((r) => r.rol === s.rol)) continue;
    roles.push({ rol: s.rol, titulo: s.label });
  }
  const rango = new Map(roles.map((r, i) => [r.rol, i]));

  // Los cambios de etapa, de una vez (no una consulta por contacto).
  const cambios = getDb().prepare("SELECT user_id, ts, payload FROM events WHERE type = 'stage' ORDER BY ts").all() as { user_id: string; ts: number; payload: string }[];
  const maxRango = new Map<string, number>();
  const ultimoCambio = new Map<string, number>();
  const perdidasDesde = new Map<string, number>();
  for (const c of cambios) {
    let p: { from?: string; to?: string } = {};
    try { p = JSON.parse(c.payload) as typeof p; } catch { /* un evento roto no tumba la pantalla */ }
    ultimoCambio.set(c.user_id, c.ts);
    const r = rango.get(rolDe(String(p.to ?? '')) ?? '');
    if (r !== undefined) maxRango.set(c.user_id, Math.max(maxRango.get(c.user_id) ?? 0, r));
    if (rolDe(String(p.to ?? '')) === 'perdido' && c.ts >= desde) {
      const titulo = STAGE_LABELS[String(p.from ?? '')] ?? 'otra etapa';
      perdidasDesde.set(titulo, (perdidasDesde.get(titulo) ?? 0) + 1);
    }
  }

  // El embudo de los que llegaron en el periodo: hasta qué etapa alcanzó cada uno.
  const entraron = contactos.filter((c) => (c.firstSeen ?? 0) >= desde && (c.firstSeen ?? 0) <= now);
  const llegaron = new Array(roles.length).fill(0) as number[];
  for (const c of entraron) {
    const actual = rango.get(rolDe(c.stage) ?? '');
    const alcanzo = Math.max(actual ?? 0, maxRango.get(c.id) ?? 0);
    for (let i = 0; i <= alcanzo && i < llegaron.length; i++) llegaron[i]!++;
  }

  // Estancados: abiertos, sin cita por delante, sin posponer y quietos hace días.
  const conCita = new Set(listAppointments({ from: now, status: 'confirmada', limit: 1000 }).map((a) => a.userId));
  const abiertos = contactos.filter((c) => !estaCerrada(c.stage));
  const estancados: FilaEstancada[] = abiertos
    .filter((c) => !conCita.has(c.id) && !isSnoozed(c, now))
    .map((c) => {
      const ultima = Math.max(c.lastMessageAt ?? 0, c.lastSeen ?? 0, ultimoCambio.get(c.id) ?? 0, c.firstSeen ?? 0);
      return { c, ultima };
    })
    .filter((x) => x.ultima > 0 && now - x.ultima >= UMBRAL.diasEstancado * DIA)
    .map(({ c, ultima }) => ({
      id: c.id,
      nombre: c.name,
      canal: c.channel,
      etapa: c.stage,
      titulo: STAGE_LABELS[c.stage] ?? c.stage,
      rol: rolDe(c.stage) ?? '',
      diasSinActividad: Math.floor((now - ultima) / DIA),
      enEtapaDesde: ultimoCambio.get(c.id) ?? c.firstSeen ?? ultima,
      quien: esDeAlguien(c.responsable) ?? esDeAlguien(c.humanMode ? c.humanBy : null),
      valor: valorDe(c).valor,
      puntaje: c.scoreBase,
      resumen: c.summary,
    }))
    .sort((a, b) => b.valor - a.valor || b.puntaje - a.puntaje || b.diasSinActividad - a.diasSinActividad || a.id.localeCompare(b.id));

  // Velocidad: la primera respuesta de cada conversación, contra cómo terminó.
  const acuerdoMin = regla<number>('atencion.acuerdoMinutos');
  const primera = new Map<string, number>();
  for (const w of esperas({ desde, ahora: now })) {
    if (w.hasta === null || primera.has(w.userId)) continue;
    primera.set(w.userId, w.msHabiles);
  }
  const vel = { acuerdoMin, rapidos: { ganados: 0, cerrados: 0 }, lentos: { ganados: 0, cerrados: 0 } };
  for (const c of contactos) {
    if (!estaCerrada(c.stage) || !primera.has(c.id)) continue;
    const g = primera.get(c.id)! <= acuerdoMin * 60_000 ? vel.rapidos : vel.lentos;
    g.cerrados++;
    if (rolDe(c.stage) === 'ganado') g.ganados++;
  }
  const t = resumenTiempos({ desde, acuerdoMin, ahora: now });

  // Horas: el pico, y cuántos mensajes caen fuera del horario de atención (si el negocio lo dijo).
  const act = actividadPorHora(Math.min(dias, 60), now);
  const horario = horarioDelNegocio();
  let fuera: number | null = null;
  if (horario.franjas.length) {
    fuera = 0;
    act.dias.forEach((dia, col) => {
      const diaSemana = new Date(dia + 'T12:00:00Z').getUTCDay();
      act.horas.forEach((h, fila) => {
        const n = act.celdas[fila]?.[col] ?? 0;
        if (!n) return;
        const dentro = horario.dias.includes(diaSemana) && horario.franjas.some(([a, b]) => h * 60 >= a && h * 60 < b);
        if (!dentro) fuera! += n;
      });
    });
  }

  // Canales de entrada: de los que llegaron en el periodo, cuántos compraron.
  const porCanal = new Map<string, { contactos: number; ganados: number }>();
  for (const c of entraron) {
    const k = c.channel || 'otro';
    const x = porCanal.get(k) ?? { contactos: 0, ganados: 0 };
    x.contactos++;
    if (rolDe(c.stage) === 'ganado') x.ganados++;
    porCanal.set(k, x);
  }
  const camp = porCampana({ desde }).campanas
    .filter((x) => x.conversaciones >= UMBRAL.porCanal && x.ganadas > 0 && x.fuente !== 'directo')
    .sort((a, b) => b.ganadas / b.conversaciones - a.ganadas / a.conversaciones || b.conversaciones - a.conversaciones)[0];

  const ven = ventasDelPeriodo(dias, now);
  const seg = seguimientosPendientes(now);
  const sen = sentimiento(dias, now);
  const vivos = new Set(contactos.filter((c) => ['interes', 'cita'].includes(rolDe(c.stage) ?? '') || c.scoreBase >= regla<number>('puntaje.caliente')).map((c) => c.id));
  const pendientes = listVerifications('pendiente', 500);
  const emb = valorDelEmbudo();

  const entradas: Entradas = {
    dias,
    embudo: roles.map((r, i) => ({ ...r, llegaron: llegaron[i] ?? 0 })),
    perdidasDesde: [...perdidasDesde].map(([titulo, n]) => ({ titulo, n })),
    entraron: entraron.length,
    estancados,
    abiertos: abiertos.length,
    velocidad: vel,
    tiempos: { respondidas: t.respondidas, fueraDeAcuerdo: t.fueraDeAcuerdo, acuerdoMin },
    horas: { total: act.total, pico: picoDeHoras(act.horas, act.celdas), fuera },
    canales: [...porCanal].map(([canal, x]) => ({ canal, nombre: NOMBRE_CANAL[canal] ?? canal, ...x })),
    campana: camp ? { nombre: camp.campana || camp.titular || camp.anuncio || camp.fuente, conversaciones: camp.conversaciones, ganadas: camp.ganadas } : null,
    perdidas: ven.perdidas,
    seguimientos: { cuantos: seg.cuantos, calientes: seg.calientes },
    objeciones: sen.objeciones.map((o) => ({ texto: o.texto, n: o.n })),
    cuidar: (sen.cruce[3]?.negativo ?? 0) + (sen.cruce[2]?.negativo ?? 0),
    verificaciones: { pendientes: pendientes.length, enTratosVivos: pendientes.filter((v) => vivos.has(v.userId)).length },
    precios: { abiertos: emb.conValor + emb.sinValor, conValor: emb.conValor, catalogoSinPrecios: emb.catalogoSinPrecios },
  };
  const hallazgos = contactos.length ? hallazgosDe(entradas) : [];
  const conValor = estancados.filter((x) => x.valor > 0);
  return {
    dias,
    generado: now,
    contactos: contactos.length,
    sinDatos: contactos.length === 0,
    resumen: {
      hallazgos: hallazgos.length,
      alta: hallazgos.filter((x) => x.prioridad === 'alta').length,
      media: hallazgos.filter((x) => x.prioridad === 'media').length,
      baja: hallazgos.filter((x) => x.prioridad === 'baja').length,
      pocaEvidencia: hallazgos.filter((x) => x.evidencia === 'poca').length,
    },
    impacto: { estancados: conValor.length ? { valor: conValor.reduce((a, x) => a + x.valor, 0), conValor: conValor.length, cuantos: estancados.length } : null },
    hallazgos,
    estancados: estancados.slice(0, 50),
    estancadosTotal: estancados.length,
    umbral: { ...UMBRAL },
    moneda: business.business.currency,
  };
}

