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
  'a al el la los las un una unos unas de del y o e en para por con sin su sus mi mis lo le les que algo alguna alguno algun mas muy tambien ustedes usted aqui alla ahi clientes cliente gente personas persona servicio servicios tienda boutique local negocio gratis gratuito disponible disponibles opcion opciones cosa cosas tipo pagar comprar llevar traer usar hacer tener venir ir mismo misma ese esa este esta eso esto'.split(' '),
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

// Negativas sin respaldo: "¿venden zapatos?" → "No, no vendemos zapatos" cuando la información no los menciona. El
// modelo lo dedujo; puede ser falso (el negocio sí los tiene y no está escrito). Lo honesto es verificarlo.
const DENY_START_RE = /^[\s¡!"'«]*(?:no|nop|lamentablemente|desafortunadamente|por (?:ahora|el momento) no|de momento no|actualmente no)\b/;
const DENY_VERB = String.raw`\bno\s+(?:\w+\s+)?(?:tenemos|contamos con|manejamos|aceptamos|ofrecemos|vendemos|alquilamos|hacemos|incluimos|incluye|permitimos|recibimos|trabajamos con|hay|se puede)\b`;
// "No lo tengo confirmado, lo verifico": eso no es negar, es lo que se le pide al modelo.
const HONEST_RE = /\b(?:verific\w*|averigu\w*|consult\w* con el equipo|te confirmo|te confirmamos|no (?:te lo |lo )?(?:puedo|podemos) confirmar|no (?:te lo )?tengo (?:confirmado|a la mano|claro))\b/;

// "No, somos una boutique de moda masculina": negar por el alcance del negocio, si ese alcance está en su descripción.
const SCOPE_RE =
  /\b(?:somos|solo|solamente|unicamente|exclusivamente|nos especializamos en|nos enfocamos en|nos dedicamos a|trabajamos|atendemos|es (?:una|un) (?:boutique|tienda|negocio|marca|empresa|sastreria|almacen|local))\b([^.!?\n]{0,90})/g;

// El público se dice de varias formas: "moda masculina" y "para hombres" son el mismo alcance.
const AUDIENCE: [RegExp, string][] = [
  [/\b(?:masculin\w*|hombres?|caballeros?)\b/g, 'hombre'],
  [/\b(?:femenin\w*|mujer(?:es)?|damas?)\b/g, 'mujer'],
  [/\b(?:infantil\w*|ninos?|ninas?)\b/g, 'nino'],
];
const audience = (s: string) => AUDIENCE.reduce((t, [re, to]) => t.replace(re, to), s);

/** ¿La respuesta dice que lo verifica o que no lo tiene confirmado? */
export function isHonest(reply: string): boolean {
  return HONEST_RE.test(foldText(reply));
}

/**
 * Lo que el cliente preguntó ("¿venden zapatos?") y la respuesta niega sin respaldo. Devuelve esas palabras
 * ("zapatos"), o null si lo negado está en la información, si la negación se apoya en el alcance del negocio
 * (`scope`, su descripción: "No, somos moda masculina"), si la respuesta no niega o si es honesta.
 */
export function ungroundedDenial(question: string, reply: string, reference: string, scope = ''): string | null {
  const ask = ASKS_RE.exec(question);
  if (!ask) return null;
  const words = foldText(ask[1]!)
    .replace(/[^a-zñ0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !NOT_SUBJECT.has(w));
  if (!words.length) return null;
  const r = foldText(reply);
  if (HONEST_RE.test(r)) return null;
  // Cada frase cuenta: "Hola, soy Aiva. No, eso no lo vendemos" también niega.
  const denied = r.split(/(?<=[.!?:\n])\s+/).some((s) => DENY_START_RE.test(s)) || words.some((w) => new RegExp(`${DENY_VERB}[^.!?\\n]{0,40}\\b${stem(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(r));
  if (!denied) return null;
  const ref = foldText(reference);
  const missing = words.filter((w) => !ref.includes(stem(w)));
  if (!missing.length) return null;
  const scoped = audience(foldText(scope));
  if (scoped) {
    for (const m of r.matchAll(SCOPE_RE)) {
      const reason = audience(m[1]!).replace(/[^a-zñ0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !NOT_SUBJECT.has(w));
      if (reason.some((w) => scoped.includes(stem(w)))) return null;
    }
  }
  return missing.join(' ');
}

/** Un "sí" o un "no" sobre algo que la información no menciona. */
export function unsupportedAnswer(question: string, reply: string, reference: string, scope = ''): string | null {
  return ungroundedClaim(question, reply, reference) ?? ungroundedDenial(question, reply, reference, scope);
}

/**
 * Si la pregunta toca algo que el negocio marcó "por confirmar" en su perfil ("Zapatos"), ese dato. Solo cuentan las
 * palabras distintivas del dato, las que la información del negocio (`reference`) no menciona: "Tiempos del diseño a
 * la medida" se activa con "tiempos", no con "diseño", que es lo que el negocio hace.
 */
export function touchesPending(question: string, pending: string[], reference = ''): string | null {
  const words = foldText(question)
    .replace(/[^a-zñ0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !NOT_SUBJECT.has(w));
  const ref = foldText(reference);
  for (const title of pending) {
    const t = foldText(title)
      .replace(/[^a-zñ0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !NOT_SUBJECT.has(w) && !ref.includes(stem(w)));
    if (t.some((a) => words.some((b) => stem(a) === stem(b)))) return title;
  }
  return null;
}

// "Te esperamos en la cita", "quedó agendada": el modelo da por hecha una cita. Solo el flujo de citas agenda; si el
// cliente no tiene ninguna, esa frase es una promesa falsa.
const BOOKED_RE =
  /\bte esperamos (?:el|la|en (?:la|tu) cita|manana|pasado|hoy|este|esta|a las)\b|\b(?:tu|la) cita (?:ya )?(?:esta|quedo) (?:agendada|confirmada|lista|reservada)\b|\bquedo (?:agendad|reservad|confirmad)\w*|\bya (?:tienes|estas) agendad\w*|\b(?:agende|reserve|agendamos|reservamos) (?:tu|la) cita\b|\btu cita (?:agendada|confirmada)\b/;

/** ¿La respuesta da por hecha una cita? (Se revisa solo si el cliente no tiene ninguna.) */
export function claimsBooked(reply: string): boolean {
  return BOOKED_RE.test(foldText(reply));
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
