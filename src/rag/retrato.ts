// El retrato del negocio: lo que aiva entendió, escrito por ella para que alguien lo corrija.
//
// La idea es no pedirle a nadie que se siente a escribir en blanco lo que su negocio hace. aiva ya tiene el
// material: la configuración, las conversaciones que se trajeron al vincular, los temas que se repiten, cómo
// contestan, cuánto tardan, qué se gana y qué se pierde. Con eso puede redactar un primer borrador y pedir que
// lo enmienden, que es una tarea mucho más fácil —y mucho más honesta— que la de la hoja en blanco.
//
// 🪤 Lo que sale de aquí es un BORRADOR y se dice en voz alta. Un retrato equivocado es peor que no tener
// ninguno: aiva aconsejaría con seguridad sobre premisas falsas, y nadie sabría de dónde salió la premisa. Por
// eso cada nota lleva de cuántas conversaciones se dedujo, no se guarda sola, y al guardarla queda marcada como
// «deducido y confirmado»: se sabe que la escribió ella y que alguien la miró.
//
// Y sale como notas INTERNAS, no como información del cliente. Esto se deduce de conversaciones privadas: lo
// que el negocio quiera contar públicamente lo decide él, copiándolo a la información del negocio.
import { business } from '../config.js';
import { generate, roleEngine } from '../llm/engines.js';
import { stats } from '../crm/contacts.js';
import { muestraDeEstilo, resumenImportado, temasFrecuentes } from '../crm/historial.js';
import { resumenTiempos } from '../crm/tiempos.js';

export interface NotaPropuesta {
  titulo: string;
  contenido: string;
}

export interface Retrato {
  notas: NotaPropuesta[];
  /** De qué se dedujo, para poder decirlo en pantalla y para que nadie confunda esto con un dato duro. */
  desde: { conversaciones: number; mensajes: number; temas: number; contactos: number };
  /** Si no había casi nada de dónde deducir, se dice en vez de inventar. */
  flaco: boolean;
}

/** Lo que sabemos del negocio, apretado en un texto que quepa en una llamada. */
function material(): { texto: string; desde: Retrato['desde'] } {
  const imp = resumenImportado();
  const temas = temasFrecuentes({ limite: 12 });
  const s = stats();
  const t = resumenTiempos({});
  const estilo = muestraDeEstilo(8);

  const partes: string[] = [];
  partes.push(`Negocio: ${business.business.name}. Asistente: ${business.agent.name}.`);
  if (business.business.description) partes.push(`Se describe así: ${business.business.description}`);
  partes.push(`Etapas por las que pasa un cliente: ${business.crm.stages.map((e) => e.label).join(' → ')}`);
  if (imp.chats) {
    partes.push(`Conversaciones traídas de WhatsApp: ${imp.chats}, con ${imp.mensajes} mensajes (${imp.delNegocio} los escribió el negocio).`);
  }
  if (temas.length) {
    partes.push(`Lo que más les preguntan, de lo más frecuente a lo menos:\n${temas.map((x) => `- ${x.titulo} (${x.veces} veces). Ejemplo: "${(x.ejemplos[0] ?? '').slice(0, 120)}"`).join('\n')}`);
  }
  if (estilo.length) {
    partes.push(`Así contestan ellos (muestras reales):\n${estilo.map((x) => `- "${x.slice(0, 160)}"`).join('\n')}`);
  }
  partes.push(`Ahora mismo: ${s.total} contactos. Por etapa: ${Object.entries(s.byStage).map(([k, v]) => `${k}=${v}`).join(', ')}.`);
  // 🪤 Redondear a minutos convertía «18 segundos» en «0 minutos», y el modelo lo repetía tal cual: una frase
  // falsa dicha con seguridad, que es exactamente el fallo del que hay que cuidarse aquí. Si un dato no se
  // puede decir bien, no se dice.
  if (t && typeof t.medianaMs === 'number' && t.medianaMs > 0) {
    const min = Math.round(t.medianaMs / 60000);
    partes.push(`Tardan en contestar, mediana: ${min >= 1 ? `${min} minutos` : 'menos de un minuto'} de horario de atención.`);
  }

  return {
    texto: partes.join('\n\n'),
    desde: { conversaciones: imp.chats, mensajes: imp.mensajes, temas: temas.length, contactos: s.total },
  };
}

const INSTRUCCIONES = `Eres quien acompaña a un negocio a poner en marcha su asistente. Te dan datos reales de ese negocio y escribes un retrato breve: qué hace, cómo atiende y qué conviene tener presente.

Reglas:
- Escribe en español de Colombia, natural y directo, como le hablarías al dueño. Tutea.
- Entre cuatro y seis apartados. Cada uno: un título corto y dos o tres frases.
- Solo lo que se desprenda de los datos. Si algo no está, no lo inventes ni lo rellenes con generalidades.
- Nada de elogios ni de vender. No es un informe de consultoría: es una nota para que la corrijan.
- Cuando algo sea una deducción y no un hecho, dilo con sus palabras ("parece que", "casi siempre").
- Si los datos no alcanzan para un apartado, escribe menos apartados.

Formato exacto, sin nada antes ni después:
### Título del apartado
Dos o tres frases.

### Otro título
Dos o tres frases.`;

/** Parte el texto del modelo en notas. Si no vino con el formato, se devuelve entero como una sola nota. */
export function partirEnNotas(texto: string): NotaPropuesta[] {
  const limpio = texto.trim();
  if (!limpio) return [];
  const bloques = limpio.split(/^###\s+/m).filter((b) => b.trim());
  if (bloques.length < 2 && !limpio.startsWith('###')) {
    return [{ titulo: 'Lo que entendí del negocio', contenido: limpio }];
  }
  return bloques
    .map((b) => {
      const salto = b.indexOf('\n');
      const titulo = (salto === -1 ? b : b.slice(0, salto)).trim().replace(/[:#]+$/, '');
      const contenido = (salto === -1 ? '' : b.slice(salto + 1)).trim();
      return { titulo: titulo.slice(0, 80), contenido };
    })
    .filter((n) => n.titulo && n.contenido);
}

/** Redacta el retrato. No guarda nada: eso lo decide quien lo lea. */
export async function retratoDelNegocio(): Promise<Retrato> {
  const { texto, desde } = material();
  // 🪤 Con dos conversaciones y sin temas, lo que salga va a ser un horóscopo: frases que encajan en cualquier
  // negocio. Más vale decir que todavía no hay de dónde que entregar algo que suena bien y no dice nada.
  const flaco = desde.conversaciones < 3 && desde.contactos < 5;
  if (flaco) return { notas: [], desde, flaco };

  const crudo = await generate(roleEngine('analysis'), {
    sessionId: 'retrato',
    persona: INSTRUCCIONES,
    context: texto,
    userText: 'Escribe el retrato de este negocio con los datos de arriba.',
    history: [],
  });
  return { notas: partirEnNotas(crudo).slice(0, 6), desde, flaco: false };
}
