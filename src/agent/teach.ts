// Enseñar una frase que no entendimos: se agrega como expresión al diccionario solo si, con ella, las reglas ya
// entienden la frase del cliente. Si no, el diccionario queda como estaba y se dice por qué.
import { DictionarySchema, expandExpressions, explainErrors, getDictionary, importDictionary, mergeDictionaries, useDictionary } from './dictionary.js';
import { ruleIntent } from './gate.js';
import { bookingReading } from '../crm/booking.js';
import { closeMisses, getMissGroup, type MissKind } from '../crm/misses.js';
import { parseWhen } from '../crm/when.js';

export type TeachResult =
  | { ok: true; example: string; reading: string; closed: number }
  | { ok: false; example: string; reason: string };

const INTENT_READING: Record<string, string> = {
  saludo: 'un saludo',
  cita: 'quiere una cita',
  humano: 'quiere hablar con una persona',
  info_tienda: 'pregunta de la tienda',
  compra: 'pregunta por el catálogo',
};

/** Lo que las reglas entienden hoy en la frase, según dónde se quedó sin entender. */
export function ruleReading(kind: MissKind, text: string): string | null {
  if (kind === 'fecha') return parseWhen(text)?.label ?? null;
  if (kind === 'cita') return bookingReading(text);
  const r = ruleIntent(text);
  if (!r) return null;
  const about = r.query && r.intent !== 'saludo' && r.intent !== 'cita' && r.intent !== 'humano' ? `: ${r.query}` : '';
  return `${INTENT_READING[r.intent] ?? r.intent}${about}`;
}

export function teachExpression(kind: MissKind, key: string, says: string, means: string): TeachResult {
  const example = getMissGroup(kind, key)?.text ?? says;
  const lesson = DictionarySchema.safeParse({ expressions: [{ says, means }] });
  if (!lesson.success) return { ok: false, example, reason: explainErrors(lesson.error).join(' · ') };
  const before = getDictionary();
  useDictionary(mergeDictionaries(before, lesson.data));
  if (expandExpressions(example) === example) {
    useDictionary(before);
    return { ok: false, example, reason: `«${says.trim()}» no aparece en «${example}». Copia la parte de la frase que no se entendió.` };
  }
  const reading = ruleReading(kind, example);
  if (!reading) {
    useDictionary(before);
    return {
      ok: false,
      example,
      reason: `Con eso las reglas todavía no entienden «${example}»: prueba a decirlo como lo diría cualquier cliente${kind === 'fecha' ? ' ("a las 12", "el sábado en la tarde")' : kind === 'cita' ? ' ("la primera", "sí", "la de las 3")' : ''}.`,
    };
  }
  importDictionary(lesson.data, 'merge'); // guarda el archivo (con copia del anterior) y lo aplica
  return { ok: true, example, reading, closed: closeMisses(kind, key, 'enseñada') };
}
