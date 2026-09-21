import { business } from '../config.js';

/**
 * Post-procesa la respuesta del modelo para WhatsApp/chat:
 * - Quita razonamiento residual y markdown que WhatsApp no renderiza.
 * - Elimina enlaces que no provienen del contexto (anti-alucinación).
 * - Recorta respuestas demasiado largas.
 * Devuelve null si la respuesta parece haberse salido del alcance (código, etc.).
 */
export function postProcess(raw: string, allowedUrls: Iterable<string>): string | null {
  let s = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (/```/.test(s)) return null; // el modelo generó código: fuera de alcance

  // Markdown -> formato WhatsApp
  s = s
    .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/__(.+?)__/g, '_$1_')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, text: string, url: string) =>
      /^https?:\/\//.test(text.trim()) ? url : `${text}: ${url}`,
    )
    .replace(/^\s*[-*•]\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n');

  // Solo se permiten enlaces que estaban en el contexto de ESTE turno, o la portada del sitio.
  // (Un modelo con sesión persistente puede repetir enlaces de turnos anteriores que ya no vienen al caso.)
  // Si una frase trae un enlace no permitido, se elimina la frase completa para no dejar "Mira el enlace:" colgando.
  const allowed = new Set([...allowedUrls].map(normUrl));
  const site = normUrl(business.business.siteUrl);
  const urlOk = (url: string) => {
    const n = normUrl(url.replace(/[.,;:!?)]+$/, ''));
    return allowed.has(n) || n === site;
  };
  s = s
    .split('\n')
    .map((line) =>
      line
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => (sentence.match(/https?:\/\/[^\s<>()"'\]]+/g) ?? []).every(urlOk))
        .join(' '),
    )
    .join('\n');
  // Placeholders que escriben los modelos pequeños ("[enlace]", "[link]") y frases que quedaron sin enlace.
  s = s
    .split('\n')
    .map((line) =>
      line
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => !/\[(enlace|link|url|aquí)\]/i.test(sentence) && !/\b(aqu[ií]|ac[aá]|en este enlace|en el siguiente enlace)\s*:\s*[.!?]?\s*$/i.test(sentence))
        .join(' '),
    )
    .join('\n');
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  // Recorte por longitud (WhatsApp: mensajes largos se leen mal)
  const MAX = 1500;
  if (s.length > MAX) {
    const cut = s.lastIndexOf('\n', MAX);
    s = s.slice(0, cut > MAX * 0.5 ? cut : MAX).trim() + ' …';
  }
  return s || null;
}

function normUrl(u: string): string {
  return u.trim().replace(/\/+$/, '').toLowerCase();
}

/**
 * Cifras de 3+ dígitos (precios, montos) que aparecen en la respuesta pero no en el texto de referencia
 * (persona + contexto). Un modelo pequeño tiende a "redondear" o inventar precios: si devuelve algo,
 * la respuesta no está fundamentada y conviene regenerarla con el otro motor.
 */
export function ungroundedNumbers(reply: string, reference: string): string[] {
  const norm = (s: string) => s.replace(/(\d)[.,](?=\d{3}\b)/g, '$1'); // 14.000 -> 14000, 1,200 -> 1200
  const ref = norm(reference);
  const found = norm(reply).match(/\d{3,}/g) ?? [];
  return [...new Set(found)].filter((n) => !ref.includes(n));
}

// ---------- Afirmaciones sin respaldo ----------
// "¿tienen wifi?" → "Sí, tenemos wifi" cuando la información del negocio no dice nada de wifi: el modelo lo supuso.
const ASKS_RE =
  /\b(?:tienen|tendr[aá]n|hay|cuentan con|manejan|aceptan|venden|hacen|ofrecen|trabajan con|reciben|se puede|puedo|permiten|incluyen?)\b\s+([^?.!]{2,60})/i;
// Sobre el texto sin tildes: en JavaScript \b no reconoce la "í" como letra ("Sí," no calzaría).
const AFFIRM_START_RE = /^[\s¡!"'«]*(?:si|claro|por supuesto|obvio|desde luego|efectivamente|asi es)\b/;
const AFFIRM_VERB = String.raw`\b(?:tenemos|contamos con|manejamos|aceptamos|ofrecemos|vendemos|hacemos|incluimos|incluye|permitimos|recibimos|si hay|si se puede|si puedes)\b`;
const NEGATION_RE =
  /\b(?:no|tampoco|aun no|todavia no)\s+(?:\w+\s+)?(?:tenemos|contamos|manejamos|aceptamos|ofrecemos|vendemos|hacemos|hay|incluye|permitimos|recibimos|se puede)\b|\bno (?:te lo |lo )?(?:puedo|podemos) confirmar\b|\bno (?:te lo )?tengo (?:confirmado|a la mano)\b|\bno lo tengo\b/;
// Palabras que no dicen de qué se habla (artículos, relleno) o que son demasiado generales para decidirlo.
const NOT_SUBJECT = new Set(
  'a al el la los las un una unos unas de del y o e en para por con sin su sus mi mis lo le les que algo alguna alguno algun mas muy tambien ustedes usted aqui alla ahi clientes cliente gente personas persona servicio servicios tienda boutique local negocio gratis gratuito disponible opcion opciones cosa cosas tipo pagar comprar llevar traer usar hacer tener venir ir mismo misma ese esa este esta eso esto'.split(' '),
);
const foldText = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const stem = (w: string) => (w.length > 4 ? w.replace(/(?:es|s)$/, '') : w); // "azules" → "azul", "trajes" → "traj"

/**
 * Lo que el cliente preguntó ("¿tienen wifi?") y la respuesta afirma sin que la información del negocio lo diga.
 * Devuelve esas palabras ("wifi"), o null si está respaldado, si la respuesta no lo afirma o si no aplica.
 * `reference` es lo que el modelo tenía a mano (persona + información), sin el mensaje del cliente.
 */
export function ungroundedClaim(question: string, reply: string, reference: string): string | null {
  const ask = ASKS_RE.exec(question);
  if (!ask) return null;
  const words = foldText(ask[1]!)
    .replace(/[^a-zñ0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !NOT_SUBJECT.has(w));
  if (!words.length) return null;
  const r = foldText(reply);
  if (NEGATION_RE.test(r)) return null;
  const affirmed =
    AFFIRM_START_RE.test(r) || words.some((w) => new RegExp(`${AFFIRM_VERB}[^.!?\\n]{0,40}\\b${stem(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(r));
  if (!affirmed) return null;
  const ref = foldText(reference);
  const missing = words.filter((w) => !ref.includes(stem(w)));
  return missing.length ? missing.join(' ') : null;
}

/**
 * Quita el saludo y la auto-presentación con que los modelos pequeños abren cada mensaje aunque la
 * conversación ya empezó: "¡Hola, Andrés! 😊", "Hola de nuevo 🌿", "Soy Aiva, del equipo de Casa Verde."
 */
export function stripRepeatedGreeting(reply: string): string {
  // Saludo: insensible a mayúsculas. Nombre propio detrás: sensible (solo palabras con mayúscula inicial).
  const head = /^\s*[¡!]?\s*(hola+|holi+|hey|buenas?(\s+(d[ií]as|tardes|noches))?|qu[eé] tal)(?!\p{L})(\s+(de\s+nuevo|otra\s+vez))?/iu;
  const tail = /^(\s*,?\s*\p{Lu}[\p{L}\p{N}]+(\s+\p{Lu}[\p{L}\p{N}]+){0,2})?\s*[!.,;:]*\s*(\p{Extended_Pictographic}\uFE0F?\s*)*/u;
  let s = reply;
  const m = head.exec(s);
  if (m) s = s.slice(m[0].length).replace(tail, '');
  // Auto-presentación: "Soy Aiva, del equipo de Casa Verde." / "Es Aiva de Casa Verde:"
  const agent = business.agent.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const intro = new RegExp(`^\\s*[¡!,]?\\s*(soy|es|habla|te habla|aqu[ií])\\s+${agent}\\b[^.!?:\\n]*[.!?:]*\\s*`, 'iu');
  const noIntro = s.replace(intro, '');
  if (noIntro.trim()) s = noIntro;
  if (!s.trim()) return reply;
  if (/^https?:\/\//i.test(s)) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * En una respuesta de detalle, elimina las frases que solo repiten el precio o el enlace que el
 * asistente ya dio en su mensaje anterior. Deja el resto intacto.
 */
export function dropRepeatedFacts(reply: string, previousAssistant: string): string {
  if (!previousAssistant) return reply;
  const prevUrls = new Set((previousAssistant.match(/https?:\/\/[^\s<>()"']+/g) ?? []).map((u) => u.replace(/[.,;:!?)]+$/, '')));
  const prevPrices = new Set((previousAssistant.match(/\d{1,3}(?:[.,]\d{3})+/g) ?? []).map((n) => n.replace(/[.,]/g, '')));
  if (prevUrls.size === 0 && prevPrices.size === 0) return reply;
  const out = reply
    .split('\n')
    .map((line) =>
      line
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => {
          const urls = (sentence.match(/https?:\/\/[^\s<>()"']+/g) ?? []).map((u) => u.replace(/[.,;:!?)]+$/, ''));
          const prices = (sentence.match(/\d{1,3}(?:[.,]\d{3})+/g) ?? []).map((n) => n.replace(/[.,]/g, ''));
          const repeatsUrl = urls.length > 0 && urls.every((u) => prevUrls.has(u));
          const repeatsPrice = prices.length > 0 && prices.every((n) => prevPrices.has(n));
          // Solo se quitan frases cortas que son pura repetición; una frase larga trae información nueva además del dato.
          return !((repeatsUrl || repeatsPrice) && sentence.length <= 100);
        })
        .join(' '),
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  // Si se perdió más de la mitad del mensaje, mejor dejarlo como estaba.
  return out && out.length >= reply.length * 0.5 ? out : reply;
}
