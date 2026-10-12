// Pasar una nota de voz a texto.
//
// Es lo que convierte un callejón sin salida en una conversación normal. Hasta ahora, una nota de voz se
// guardaba y ahí moría: alguien tenía que escucharla y escribir. Transcrita, entra en toda la máquina igual que
// cualquier mensaje — el clasificador la lee, el asistente la contesta, el análisis saca la ocasión y la fecha.
//
// 🪤 Esto TRANSCRIBE, no interpreta. Pasa a texto lo que la persona dijo, palabra por palabra, y ese texto
// sigue el camino de siempre. No se le pide al modelo que resuma la nota ni que diga de qué va: eso sería
// ponerle a hablar de algo que nadie comprobó, y es exactamente lo que no se quiere.
import { readFileSync, statSync } from 'node:fs';
import { env } from '../config.js';
import { recordUsage } from './usage.js';
import { agotado } from '../crm/presupuesto.js';

/**
 * Lo máximo que se transcribe, en segundos.
 *
 * 🪤 Un minuto, y es a propósito. Lo que llega por el chat de un negocio son notas de diez o veinte segundos;
 * un audio de diez minutos no es una pregunta, es otra cosa, y transcribirlo cuesta de verdad y produce un
 * muro de texto que nadie va a leer ni va a servir para contestar. Lo que pase de aquí va a una persona, que es
 * donde debía ir desde el principio.
 */
export const TOPE_SEGUNDOS = 60;

/** El modelo por minuto más barato que hace bien el español. Se puede cambiar por cliente. */
export const MODELO = process.env.OPENAI_MODEL_TRANSCRIBE || 'gpt-4o-mini-transcribe';

export class NoSeTranscribe extends Error {}

/**
 * Devuelve lo que se dijo en el audio.
 *
 * `segundos` es lo que declara WhatsApp en el propio mensaje; se mira ANTES de leer el archivo y antes de
 * gastar, que es lo único que hace que el tope sirva de algo.
 */
export async function transcribir(ruta: string, opts: { segundos?: number; userId?: string } = {}): Promise<string> {
  // 🪤 El tope ANTES que la llave, y no al revés. Una nota de diez minutos es demasiado larga haya llave o no,
  // y el registro tiene que decir eso y no «falta la llave»: el motivo correcto es lo que evita que alguien se
  // pase una tarde buscando un problema de configuración que no existe.
  const segundos = Math.max(0, Math.round(opts.segundos ?? 0));
  if (segundos > TOPE_SEGUNDOS) {
    throw new NoSeTranscribe(`la nota dura ${segundos} s y el tope es ${TOPE_SEGUNDOS} s`);
  }
  if (!env.openaiApiKey) throw new NoSeTranscribe('no hay llave de OpenAI configurada');
  // Transcribir se cobra por minuto como cualquier otra llamada: con el tope alcanzado, la nota queda guardada
  // para el equipo, igual que cuando no hay llave.
  if (agotado()) throw new NoSeTranscribe('se llegó al tope de gasto de IA de este mes');

  const datos = readFileSync(ruta);
  // Si WhatsApp no declaró la duración, se estima por el tamaño para no cobrar cero. El audio de WhatsApp va a
  // unos 2 KB por segundo; es una aproximación y solo se usa para la cuenta, nunca para decidir el tope.
  const parasCobrar = segundos || Math.max(1, Math.round(statSync(ruta).size / 2048));

  const forma = new FormData();
  forma.append('file', new Blob([new Uint8Array(datos)]), ruta.split('/').pop() || 'audio.ogg');
  forma.append('model', MODELO);
  // El idioma se dice: sin esto, una nota corta en español con una palabra en inglés sale transcrita en inglés.
  forma.append('language', (env.openaiTranscribeLang || 'es').slice(0, 5));

  const empezo = Date.now();
  let res: Response;
  try {
    res = await fetch(`${env.openaiBaseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.openaiApiKey}` },
      body: forma,
      // 🪤 Reloj propio y generoso: un minuto de audio tarda unos segundos, pero si la red va mal esto no puede
      // quedarse colgado — quien mandó la nota está esperando una respuesta en el chat.
      signal: AbortSignal.timeout(45_000),
    });
  } catch (err) {
    throw new NoSeTranscribe(`sin conexión con OpenAI: ${(err as Error).message}`);
  }
  if (!res.ok) throw new NoSeTranscribe(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const cuerpo = (await res.json()) as { text?: string };
  const texto = (cuerpo.text ?? '').trim();
  recordUsage({ task: 'transcripcion', userId: opts.userId, engine: 'openai', model: MODELO, inputTokens: 0, outputTokens: 0, segundos: parasCobrar, ms: Date.now() - empezo });
  if (!texto) throw new NoSeTranscribe('no se entendió nada en el audio');
  return texto;
}
