// Señales que el código saca solo, sin modelo: datos exactos (teléfono, correo, presupuesto, si preguntó
// precio) y si un mensaje aporta algo al análisis. Lo subjetivo (ánimo, interés, objeciones, resumen) sigue
// en el modelo; aquí se decide cuándo vale la pena llamarlo.
import { business } from '../config.js';
import { GREETING_RE } from '../agent/gate.js';

// Secuencias con cara de teléfono: dígitos con espacios, guiones, puntos o paréntesis, con o sin +.
const PHONE_CANDIDATE_RE = /\+?\d[\d\s().-]{6,}\d/g;

/**
 * Teléfono en formato internacional para guardar, según el país del negocio (phoneCountryCode y phoneLocalDigits en
 * aiva.config.json): en Colombia "300 123 4567", "+57 300-123-4567" o "605 3601234" → "+573001234567". Un número de
 * otro país se acepta con su + (8 a 15 dígitos).
 */
export function parsePhone(text: string): string | null {
  const cc = business.business.phoneCountryCode;
  const n = business.business.phoneLocalDigits;
  // En Colombia un número local empieza en 3 (móvil) o 60 (fijo); en otros países basta con la cantidad de dígitos.
  const local = (d: string) => d.length === n && (cc !== '57' || /^(3|60)/.test(d));
  for (const m of text.match(PHONE_CANDIDATE_RE) ?? []) {
    const digits = m.replace(/\D/g, '');
    if (local(digits)) return `+${cc}${digits}`;
    if (digits.startsWith(cc) && local(digits.slice(cc.length))) return `+${digits}`;
    if (m.trim().startsWith('+') && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  }
  return null;
}

/** "+573001234567" → "300 123 4567": los del país del negocio sin indicativo y agrupados; los de otro país, con su +. */
export function formatPhone(e164: string): string {
  const cc = business.business.phoneCountryCode;
  const local = e164.startsWith(`+${cc}`) ? e164.slice(cc.length + 1) : '';
  if (local.length !== business.business.phoneLocalDigits) return e164;
  const groups = local.length === 10 ? [3, 3, 4] : local.length === 9 ? [3, 3, 3] : local.length === 8 ? [4, 4] : [local.length];
  let i = 0;
  return groups.map((g) => local.slice(i, (i += g))).join(' ');
}

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const PRICE_RE = /cu[aá]nto (?:vale|valen|cuesta|cuestan|sale|salen|cobran|es|ser[ií]a)|\bprecios?\b|\bvalor(?:es)?\b|\btarifas?\b|\bcostos?\b|\bcotiza/i;
// Monto: "$800.000", "2 millones", "1,5 millones", "800 mil", "800k", "2 palos", "un millón"
const AMOUNT = String.raw`(?:\$\s?\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?\s?(?:millones|mill[oó]n|palos?|mil|k)\b|(?:un|medio)\s+mill[oó]n|\d{1,3}(?:\.\d{3}){1,2}\b)`;
const BUDGET_RE = new RegExp(
  String.raw`(?:presupuesto|tengo|hasta|m[aá]ximo|no\s+(?:m[aá]s|pase|pasar)\s+de|alcanza|gastar|invertir|cuento\s+con|menos\s+de|por\s+ah[ií]\s+de)[^.?!\n]{0,30}?${AMOUNT}`,
  'i',
);

const LIMIT_RE = /\b(?:hasta|m[aá]ximo|no\s+(?:m[aá]s|pase|pasar)\s+de|m[aá]s\s+de|menos\s+de|tope)\b/i;

/** Recorta en el último espacio antes del límite, con puntos suspensivos. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;.:]+$/, '')}…`;
}

/** Presupuesto corto para el recap: "no quiero gastar más de 2 millones" → "hasta 2 millones". */
export function shortBudget(text: string): string {
  const amount = new RegExp(AMOUNT, 'i').exec(text)?.[0];
  if (!amount) return clip(text, 40);
  return LIMIT_RE.test(text) ? `hasta ${amount}` : amount;
}

export interface RuleSignals {
  telefono?: string;
  correo?: string;
  presupuesto?: string;
  pidioPrecio: boolean;
}

/** La frase del cliente que contiene el monto ("no quiero gastar más de 2 millones"). */
function clauseAround(text: string, index: number): string {
  // Un punto o una coma entre dígitos es de miles o decimales ("$1.500.000", "1,5 millones"), no corta la frase.
  const cuts = (i: number, chars: string) => chars.includes(text[i]!) && !(/\d/.test(text[i - 1] ?? '') && /\d/.test(text[i + 1] ?? ''));
  let start = index;
  while (start > 0 && !cuts(start - 1, '.?!\n,;')) start--;
  let end = index;
  while (end < text.length && !cuts(end, '.?!\n;')) end++;
  return text.slice(start, end).trim().slice(0, 90);
}

/** Datos exactos en los mensajes del cliente (el más reciente gana). */
export function ruleSignals(customerMessages: string[]): RuleSignals {
  const out: RuleSignals = { pidioPrecio: false };
  for (const text of customerMessages) {
    const phone = parsePhone(text);
    if (phone) out.telefono = phone;
    const email = EMAIL_RE.exec(text);
    if (email) out.correo = email[0].toLowerCase();
    const budget = BUDGET_RE.exec(text);
    if (budget) out.presupuesto = clauseAround(text, budget.index);
    if (PRICE_RE.test(text)) out.pidioPrecio = true;
  }
  return out;
}

export interface CustomerMessage {
  content: string;
  intent: string | null;
}

/**
 * ¿Este mensaje no le dice nada nuevo al análisis? Pasos cortos del flujo de citas (el nombre, "la 2", "sí",
 * "el sábado en la tarde": los entiende el código) y cortesías cortas ("ok", "gracias", "dale").
 * No lo son: un "la 2" fuera del flujo (depende de lo que ofreció el bot), un mensaje largo que abre la cita
 * ("necesito un traje para este sábado, ¿me lo tienen mañana?") ni un "gracias, el traje quedó perfecto".
 */
export function isTrivial(m: CustomerMessage): boolean {
  const t = m.content.trim();
  if (m.intent === 'cita') return t.split(/\s+/).length <= 6;
  return t.length <= 40 && GREETING_RE.test(t);
}
