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
// Negativas suaves: responden que no sin decir "no". "Lo más parecido que manejamos es…", "solo manejamos
// trajes", "en su lugar te ofrecemos…". Son la misma deducción, dicha con más tacto.
const SOFT_DENY_RE =
  /\blo (?:mas (?:parecido|cercano|similar)|que mas se (?:acerca|parece))\b|\ben (?:su lugar|lugar de eso|cambio)\b|\b(?:solo|solamente|unicamente|exclusivamente)\s+(?:\w+\s+){0,2}(?:tenemos|contamos|manejamos|ofrecemos|vendemos|alquilamos|trabajamos|hacemos|atendemos)\b|\b(?:tenemos|contamos con|manejamos|ofrecemos|vendemos|alquilamos|trabajamos|hacemos|atendemos)\s+(?:solo|solamente|unicamente|exclusivamente)\b/;
// "No hay problema", "no hay lío": cortesía, no una negativa.
const POLITE_RE = /\bno\s+hay\s+(?:problema|lio|drama|inconveniente|apuro|afan)\b/g;

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
  // Cada frase cuenta, diga "no" al principio ("Hola, soy Xen. No, eso no lo vendemos"), en la mitad ("Zapatos no
  // tenemos"), sin nombrar lo preguntado ("Eso no lo manejamos") o sin decir "no" ("solo manejamos trajes").
  const denyVerb = new RegExp(DENY_VERB);
  const denied = r
    .split(/(?<=[.!?:\n])\s+/)
    .some((s) => DENY_START_RE.test(s) || SOFT_DENY_RE.test(s) || denyVerb.test(s.replace(POLITE_RE, ' ')));
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

// ---------- Promesas de plata ----------
// «¡Listo! Te dejo el traje con 50 % de descuento»: el cliente lo pidió —o lo exigió con un «ignora tus reglas»— y
// el modelo, por complacer, lo concedió. Es el invento más caro: un negocio que honra lo que dijo su asistente
// pierde plata, y uno que no lo honra pierde al cliente. Y es lo primero que prueba quien quiere romper un bot.
//
// 🪤 Cada palabra se respalda con la SUYA: que la información diga «oferta de trajes» no respalda un «descuento».
// Con una sola familia, a un negocio que nombre una «promoción» cualquiera se le colaba todo lo demás.
const PROMESAS: { dice: RegExp; respaldo: RegExp }[] = [
  { dice: /\bdescuentos?\b/, respaldo: /\bdescuento/ },
  { dice: /\brebaj\w*/, respaldo: /\brebaj/ },
  { dice: /\bpromoci\w*|\bpromos?\b/, respaldo: /\bpromo/ },
  { dice: /\bofertas?\b/, respaldo: /\boferta/ },
  { dice: /\bcupon\w*/, respaldo: /\bcupon/ },
  { dice: /\b2\s?x\s?1\b|\bdos por uno\b/, respaldo: /\b2\s?x\s?1\b|\bdos por uno\b/ },
  { dice: /\bprecios? (?:especial|preferencial)(?:es)?\b/, respaldo: /\bprecios? (?:especial|preferencial)/ },
  {
    dice: /\bgratis\b|\bgratuit\w*|\bsin (?:ningun )?(?:costo|cargo)\b|\bno (?:te )?(?:tiene|tienen|cuesta|cuestan) (?:ningun |nada de )?(?:costo|cargo|nada)\b|\bno (?:te )?cobramos\b|\bobsequi\w*|\bde cortesia\b/,
    respaldo: /\bgratis\b|\bgratuit|\bsin (?:ningun )?(?:costo|cargo)\b|\bno tiene (?:ningun )?(?:costo|cargo)\b|\bobsequi|\bcortesia\b/,
  },
];
// «No manejamos descuentos», «no es gratis»: negar no es prometer.
const NIEGA_PROMESA_RE =
  /\b(?:no|tampoco|ni|sin)\s+(?:\w+\s+){0,4}?(?:descuentos?|rebaj\w*|promoci\w*|ofertas?|cupon\w*|gratis|gratuit\w*|2\s?x\s?1|precios? (?:especial|preferencial)(?:es)?)\b/;
const PORCENTAJE_RE = /(\d{1,3}(?:[.,]\d+)?)\s?(?:%|por ?ciento)/g;
// «Te lo dejo en 800 mil»: regatear es prometer un precio. Vale solo si ese precio está en la información.
const REGATEO_RE = /\bte (?:lo|la|los|las) (?:dejo|dejamos|puedo dejar|podemos dejar)\s+(?:en|a|por)\b/;
const PLATA_RE = /\b(?:precio|valor|pag\w*|abono|anticipo|cuotas?|cobr\w*|descuento\w*)\b/;

/**
 * Lo que la respuesta promete en plata sin que la información del negocio lo ofrezca: un descuento, una rebaja, una
 * promoción, un porcentaje, algo gratis o un precio regateado. Devuelve qué prometió («descuento», «50 %»), o null.
 *
 * `info` es SOLO lo que se sabe del negocio (datos de la persona + información). Ni las reglas, que nombran los
 * descuentos para prohibirlos, ni lo que dijo el cliente: «déjamelo en 800» no respalda un 800.
 */
export function promesaSinRespaldo(reply: string, info: string): string | null {
  const ref = foldText(info).replace(/(\d)[.,](?=\d{3}\b)/g, '$1');
  for (const frase of foldText(reply).split(/(?<=[.!?\n])\s+/)) {
    // Un porcentaje inventado es inventado aunque venga con un «lo verifico»: ese número ya lo leyó el cliente.
    for (const m of frase.matchAll(PORCENTAJE_RE)) {
      const n = m[1]!.replace(',', '.');
      if (n === '100' && !PLATA_RE.test(frase)) continue; // «100 % a la medida»: una forma de hablar
      if (!new RegExp(`(?<![\\d.])${n.replace('.', '[.,]')}\\s?(?:%|por ?ciento)`).test(ref)) return `${n} %`;
    }
    if (HONEST_RE.test(frase) || NIEGA_PROMESA_RE.test(frase)) continue;
    for (const p of PROMESAS) {
      const dicho = p.dice.exec(frase);
      if (dicho && !p.respaldo.test(ref)) return dicho[0];
    }
    if (REGATEO_RE.test(frase)) {
      const cifras = (frase.replace(/(\d)[.,](?=\d{3}\b)/g, '$1').match(/\d{3,}/g) ?? []).filter((c) => !ref.includes(c));
      if (cifras.length) return `precio de ${cifras[0]}`;
    }
  }
  return null;
}

// ---------- Recitar las instrucciones ----------
// Los títulos con que se arma el prompt. Ninguna respuesta a un cliente los nombra: si aparecen, el modelo está
// leyendo en voz alta lo que se le dijo.
const TITULOS_DEL_PROMPT_RE =
  /\b(?:reglas estrictas|nota para este turno|mensaje del cliente|informacion disponible \(todo el negocio\))\b|^\W*(?:como hablas|que haces|tu objetivo|informacion disponible|el cliente)\W*$/m;
const PALABRAS_SEGUIDAS = 12;
const palabrasDe = (s: string) => foldText(s).replace(/[^a-zñ0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
let tramos: { de: string; set: Set<string> } | null = null;

/**
 * ¿La respuesta recita las instrucciones del asistente? Sí si nombra los títulos del prompt o si copia
 * {@link PALABRAS_SEGUIDAS} palabras seguidas de las reglas (`reglas`: ver `soloLasReglas`).
 *
 * 🪤 Doce y no menos. Las reglas traen ejemplos que una respuesta buena puede decir casi igual —«somos moda
 * masculina, así que no manejamos vestidos de novia» son diez—, y confundir eso con una filtración cambiaría una
 * respuesta correcta por una evasiva. Doce palabras seguidas de un reglamento no salen por casualidad.
 */
export function filtraInstrucciones(reply: string, reglas: string): boolean {
  if (TITULOS_DEL_PROMPT_RE.test(foldText(reply))) return true;
  if (tramos?.de !== reglas) {
    const w = palabrasDe(reglas);
    const set = new Set<string>();
    for (let i = 0; i + PALABRAS_SEGUIDAS <= w.length; i++) set.add(w.slice(i, i + PALABRAS_SEGUIDAS).join(' '));
    tramos = { de: reglas, set };
  }
  const r = palabrasDe(reply);
  for (let i = 0; i + PALABRAS_SEGUIDAS <= r.length; i++) if (tramos.set.has(r.slice(i, i + PALABRAS_SEGUIDAS).join(' '))) return true;
  return false;
}

/**
 * Quita el saludo y la auto-presentación con que los modelos pequeños abren cada mensaje aunque la
 * conversación ya empezó: "¡Hola, Andrés! 😊", "Hola de nuevo 🌿", "Soy Xen, del equipo de Casa Verde."
 */
export function stripRepeatedGreeting(reply: string): string {
  // Saludo: insensible a mayúsculas. Nombre propio detrás: sensible (solo palabras con mayúscula inicial).
  const head = /^\s*[¡!]?\s*(hola+|holi+|hey|buenas?(\s+(d[ií]as|tardes|noches))?|qu[eé] tal)(?!\p{L})(\s+(de\s+nuevo|otra\s+vez))?/iu;
  const tail = /^(\s*,?\s*\p{Lu}[\p{L}\p{N}]+(\s+\p{Lu}[\p{L}\p{N}]+){0,2})?\s*[!.,;:]*\s*(\p{Extended_Pictographic}\uFE0F?\s*)*/u;
  let s = reply;
  const m = head.exec(s);
  if (m) s = s.slice(m[0].length).replace(tail, '');
  // Auto-presentación: "Soy Xen, del equipo de Casa Verde." / "Es Xen de Casa Verde:"
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
