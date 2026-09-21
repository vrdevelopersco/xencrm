// Diccionario del negocio: lo que cada cliente le enseña a aiva sin tocar código (temas que se responden con su
// información, verbos con que su gente pregunta por lo que ofrece y expresiones propias: "a la hora del almuerzo"
// quiere decir "a las 12"). Vive en un archivo por cliente
// (aiva.config.json > dictionaryFile), se importa y exporta desde el tablero y se aplica sin reiniciar.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { business } from '../config.js';

export const DictionarySchema = z.object({
  topics: z
    .array(
      z.object({
        keywords: z.array(z.string().trim().min(2).max(60)).min(1).max(50),
        query: z.string().trim().min(2).max(120),
      }),
    )
    .max(200)
    .default([]),
  offerVerbs: z.array(z.string().trim().min(3).max(30)).max(100).default([]),
  expressions: z
    .array(
      z.object({
        says: z.string().trim().min(2).max(60),
        means: z.string().trim().min(1).max(80),
      }),
    )
    .max(300)
    .default([]),
});
export type Dictionary = z.infer<typeof DictionarySchema>;
/** Lo mismo, pero con las listas opcionales (un archivo sin expresiones sigue siendo válido). */
export type DictionaryInput = z.input<typeof DictionarySchema>;

const HELP =
  'Diccionario del negocio para aiva. "topics": temas que se responden con la información del negocio; "keywords" son las palabras que los disparan (sin importar tildes ni mayúsculas) y "query" es con qué se busca en la información. "offerVerbs": verbos con que la gente pregunta por lo que se ofrece ("¿alquilan…?", "¿venden…?"). "expressions": lo que la gente dice a su manera; "says" se lee como "means" antes de aplicar las reglas (fechas, temas y el flujo de la cita), sin importar tildes ni mayúsculas. Se importa desde el tablero (Agente › Diccionario del negocio).';

let current: Dictionary | null = null;
let version = 0;

const file = () => business.dictionaryFile;

/** El diccionario del archivo; si no existe, el que venga dentro de aiva.config.json (versiones anteriores) o vacío. */
function load(): Dictionary {
  if (existsSync(file())) return DictionarySchema.parse(JSON.parse(readFileSync(file(), 'utf8')));
  return DictionarySchema.parse(business.dictionary ?? {});
}

export function getDictionary(): Dictionary {
  current ??= load();
  return current;
}

/** Cambia cada vez que el diccionario cambia: quien compila reglas con él sabe cuándo recompilarlas. */
export function dictionaryVersion(): number {
  getDictionary();
  return version;
}

/** Aplica un diccionario en memoria (sin tocar el archivo): para pruebas y después de guardar. */
export function useDictionary(d: DictionaryInput): void {
  current = DictionarySchema.parse(d);
  version++;
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/** Suma dos diccionarios: los verbos sin repetir; los temas con la misma consulta juntan sus palabras. */
export function mergeDictionaries(baseIn: DictionaryInput, extraIn: DictionaryInput): Dictionary {
  const base = DictionarySchema.parse(baseIn);
  const extra = DictionarySchema.parse(extraIn);
  const topics = base.topics.map((t) => ({ ...t, keywords: [...t.keywords] }));
  for (const t of extra.topics) {
    const same = topics.find((x) => norm(x.query) === norm(t.query));
    if (!same) topics.push({ ...t, keywords: [...t.keywords] });
    else for (const k of t.keywords) if (!same.keywords.some((x) => norm(x) === norm(k))) same.keywords.push(k);
  }
  const offerVerbs = [...base.offerVerbs];
  for (const v of extra.offerVerbs) if (!offerVerbs.some((x) => norm(x) === norm(v))) offerVerbs.push(v);
  // La misma expresión con otro significado: gana la nueva.
  const expressions = base.expressions.filter((x) => !extra.expressions.some((e) => norm(e.says) === norm(x.says)));
  expressions.push(...extra.expressions);
  return { topics, offerVerbs, expressions };
}

/** Errores de validación en palabras de persona: "temas › 2 › palabras: debe tener al menos 1". */
export function explainErrors(err: z.ZodError): string[] {
  const names: Record<string, string> = { topics: 'temas', keywords: 'palabras', query: 'consulta', offerVerbs: 'verbos', expressions: 'expresiones', says: 'dice', means: 'significa' };
  return err.issues.slice(0, 8).map((i) => {
    const where = i.path.map((p) => (typeof p === 'number' ? String(p + 1) : (names[String(p)] ?? String(p)))).join(' › ');
    return `${where || 'archivo'}: ${i.message}`;
  });
}

/**
 * Importa: valida, suma o reemplaza, guarda una copia del archivo anterior (.anterior.json) y aplica al instante.
 * Lanza un Error con la lista de problemas si el contenido no es válido.
 */
export function importDictionary(raw: unknown, mode: 'merge' | 'replace'): { dictionary: Dictionary; backup: string | null } {
  const parsed = DictionarySchema.safeParse(raw);
  if (!parsed.success) throw new Error(explainErrors(parsed.error).join('\n'));
  const next = mode === 'merge' ? mergeDictionaries(getDictionary(), parsed.data) : parsed.data;
  let backup: string | null = null;
  if (existsSync(file())) {
    backup = file().replace(/\.json$/, '') + '.anterior.json';
    copyFileSync(file(), backup);
  }
  writeFileSync(file(), JSON.stringify(exportDictionary(next), null, 2) + '\n');
  useDictionary(next);
  return { dictionary: next, backup };
}

/** Lo que se descarga: el diccionario con una nota que explica el formato. */
export function exportDictionary(d: Dictionary = getDictionary()): { _ayuda: string } & Dictionary {
  return { _ayuda: HELP, topics: d.topics, offerVerbs: d.offerVerbs, expressions: d.expressions };
}

// ---------- Expresiones: "says" se lee como "means" antes de las reglas ----------
// Sin tildes ni mayúsculas y por palabras completas ("de una" no toca "de unas"). Las más largas van primero.
const ACCENTS: Record<string, string> = { a: '[aáàä]', e: '[eéèë]', i: '[iíìï]', o: '[oóòö]', u: '[uúùü]', n: '[nñ]' };
const pattern = (says: string) =>
  norm(says)
    .split(/\s+/)
    .map((w) => [...w].map((ch) => ACCENTS[ch] ?? ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(''))
    .join('\\s+');
let expr: { version: number; re: RegExp | null; means: Map<string, string> } | null = null;

/** El texto con las expresiones del negocio traducidas; si ninguna aparece, el mismo texto. */
export function expandExpressions(text: string): string {
  const v = dictionaryVersion();
  if (expr?.version !== v) {
    const list = [...getDictionary().expressions].sort((a, b) => b.says.length - a.says.length);
    expr = {
      version: v,
      re: list.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${list.map((x) => pattern(x.says)).join('|')})(?![\\p{L}\\p{N}])`, 'giu') : null,
      means: new Map(list.map((x) => [norm(x.says).replace(/\s+/g, ' '), x.means])),
    };
  }
  if (!expr.re) return text;
  const { means } = expr;
  return text.replace(expr.re, (m) => means.get(norm(m).replace(/\s+/g, ' ')) ?? m);
}
