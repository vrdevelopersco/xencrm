// Preguntarle algo a aiva, en corto, por una puerta aparte.
//
// No es el asistente que atiende clientes ni pasa por el tablero: es una libreta para quien monta y opera el
// sistema. Se abre con una llave larga en la dirección, sin sesión, y sirve para lo que uno necesita a mitad de
// un día de trabajo: redactar algo, revisar una idea, preguntar una tontería sin cambiar de aplicación.
//
// Sabe de qué negocio se le habla —tiene su perfil—, así que «escríbeme un recordatorio de cita» sale con el
// tono de ese negocio y no genérico. Pero no ve conversaciones ni lo interno: ver más abajo el porqué.
//
// 🪤 Cuando no tiene el dato, lo dice y lo pide. Un asistente que contesta igual de seguro sepa o no sepa es
// peor que no tenerlo: el error no se ve, se reparte. Está en las instrucciones y no es decorativo.
//
// Solo texto. Y sin memoria en el servidor: el hilo lo lleva el navegador y al recargar se pierde, que es lo
// que se pidió y además lo correcto para algo que no pide sesión.
import { business } from '../config.js';
import { generate, roleEngine } from '../llm/engines.js';
import { profileText } from '../profile.js';
import type { Adjunto } from './adjuntos.js';

export interface Consulta {
  pregunta: string;
  /**
   * Lo dicho antes en esta misma consulta, para poder repreguntar sin repetirlo todo.
   *
   * 🪤 Lo manda el navegador y aquí no se guarda nada. Si recargas la página, se pierde —a propósito—: esto es
   * una libreta, no un archivo. Guardarlo en el servidor sería empezar a acumular, sin que nadie lo haya
   * pedido, conversaciones que igual llevan datos de clientes dentro.
   */
  antes?: { pregunta: string; respuesta: string }[];
  /** Documentos que vienen con la pregunta. Se leen, se usan y se olvidan: aquí no se guarda ninguno. */
  adjuntos?: Adjunto[];
}

const INSTRUCCIONES = `Ayudas al equipo de un negocio. Te preguntan en corto, mientras atienden, y necesitan una respuesta que puedan usar ya.

🪤 Quien te escribe TRABAJA en el negocio: no es un cliente. Nunca le ofrezcas el WhatsApp, la dirección ni los
horarios del negocio como si fuera a contactarlo —es suyo—, y nunca le hables como se le habla a un cliente. Si
falta un dato, pídeselo a él, que es quien lo tiene.

Cómo respondes:
- En español de Colombia, directo y sin rodeos. Tutea.
- Corto: dos o tres frases, o una lista de tres puntos. Nada de introducciones ni de resumir la pregunta.
- Si la pregunta pide dos cosas, contesta las dos. Quedarse en la primera obliga a preguntar otra vez.
- Si te piden un mensaje para un cliente, escribe el mensaje y nada más, listo para copiar.
- Usa lo que sabes del negocio. Si adjuntan un documento, manda lo que dice el documento, pero avisa si contradice lo que sabías.

🪤 Lo más importante: **si no tienes el dato, dilo y pide lo que falta.** No supongas precios, fechas,
políticas ni disponibilidad. Decir "no tengo ese dato, ¿me lo pasas?" es una respuesta correcta y útil;
inventarlo es un error que nadie va a notar hasta que un cliente lo reciba.`;

/**
 * Lo que aiva sabe del negocio, apretado para una pregunta suelta.
 *
 * 🪤 Lo INTERNO no entra aquí. Esta puerta no pide sesión —se abre con una llave en la dirección— y quien
 * tenga esa llave podría sacar, preguntando, lo que el equipo escribió para uso interno: márgenes, proveedores,
 * qué cliente da problemas. Una llave que se filtra en un historial de navegador o en un registro no puede
 * costar eso. Lo interno se consulta desde el tablero, que sí pide sesión.
 */
function contexto(adjuntos: Adjunto[] = []): string {
  const partes: string[] = [`El negocio es ${business.business.name}. El asistente se llama ${business.agent.name}.`];
  const perfil = profileText();
  if (perfil) partes.push(`Lo que se sabe del negocio:\n${perfil.slice(0, 2500)}`);
  // Los documentos van al final y bien marcados: si algo de ahí contradice lo que sabe del negocio, manda lo
  // que le acaban de dar —para eso lo adjuntaron— pero tiene que decir que se contradicen.
  for (const a of adjuntos) partes.push(`Documento adjunto "${a.nombre}":\n${a.texto}`);
  return partes.join('\n\n');
}

export async function preguntarAAiva(c: Consulta): Promise<{ respuesta: string }> {
  const pregunta = c.pregunta.trim();
  if (!pregunta) throw new Error('escribe la pregunta');
  const historia = (c.antes ?? []).slice(-4).flatMap((t) => [
    { role: 'user' as const, content: t.pregunta },
    { role: 'assistant' as const, content: t.respuesta },
  ]);
  const respuesta = await generate(roleEngine('analysis'), {
    sessionId: 'consulta',
    persona: INSTRUCCIONES,
    context: contexto(c.adjuntos ?? []),
    userText: pregunta,
    history: historia,
    task: 'consulta',
    maxTokens: 700,
  });
  return { respuesta: respuesta.trim() };
}
