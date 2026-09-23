import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

// ---------- Variables de entorno (.env) ----------
// Node >= 20.6 puede cargar .env con --env-file; aquí lo hacemos manualmente para
// que funcione igual con `tsx` y sin flags.
/** El archivo de secretos de la máquina. AIVA_ENV_FILE elige otro (pruebas aisladas que no tocan el real). */
export const ENV_FILE = process.env.AIVA_ENV_FILE || '.env';
function loadDotEnv(path = ENV_FILE) {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    const hash = value.indexOf(' #');
    if (hash !== -1) value = value.slice(0, hash).trim();
    value = value.replace(/^["']|["']$/g, '');
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadDotEnv();
// Con varios clientes, cada uno tiene su .env (token, puerto, base, dominio) y lo compartido de la máquina
// (claves de OpenAI, URL de Ollama) sigue en el .env de la raíz: lo que el cliente no define, lo hereda.
if (ENV_FILE !== '.env') loadDotEnv('.env');

const bool = (v: string | undefined, def: boolean) =>
  v === undefined || v === '' ? def : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
const num = (v: string | undefined, def: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : def);
const list = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const env = {
  ollamaUrl: (process.env.OLLAMA_URL ?? 'http://localhost:11434').replace(/\/$/, ''),
  chatModel: process.env.CHAT_MODEL || 'gemma4:e4b',
  gateModel: process.env.GATE_MODEL || process.env.CHAT_MODEL || 'gemma4:e4b',
  embedModel: process.env.EMBED_MODEL || 'bge-m3',
  numCtx: num(process.env.NUM_CTX, 8192),
  keepAlive: process.env.KEEP_ALIVE || "1h",
  temperature: num(process.env.TEMPERATURE, 0.7),

  port: num(process.env.PORT, 3000),
  webEnabled: bool(process.env.WEB_ENABLED, true),
  mcpEnabled: bool(process.env.MCP_ENABLED, true),
  allowedOrigins: list(process.env.ALLOWED_ORIGINS || '*'),
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, ''),

  whatsappEnabled: bool(process.env.WHATSAPP_ENABLED, true),
  whatsappAuthDir: process.env.WHATSAPP_AUTH_DIR || './auth',
  whatsappIgnoreGroups: bool(process.env.WHATSAPP_IGNORE_GROUPS, true),
  whatsappAllowedNumbers: list(process.env.WHATSAPP_ALLOWED_NUMBERS),
  debounceMs: num(process.env.DEBOUNCE_MS, 1500),

  dbPath: process.env.DB_PATH || './data/aiva.db',
  historyTurns: num(process.env.HISTORY_TURNS, 8),

  // Motores por rol. 'router' reparte por tipo de turno entre LIGHT_ENGINE y HEAVY_ENGINE;
  // LLM_ENGINE=ollama|apple|openai fuerza uno solo para todo.
  llmEngine: (['router', 'ollama', 'apple', 'openai'].includes(process.env.LLM_ENGINE ?? '') ? process.env.LLM_ENGINE : 'router') as
    | 'router'
    | 'ollama'
    | 'apple'
    | 'openai',
  lightEngine: engineName(process.env.LIGHT_ENGINE, 'apple'),
  heavyEngine: engineName(process.env.HEAVY_ENGINE, 'ollama'),
  gateEngine: engineName(process.env.GATE_ENGINE, 'ollama'),
  analysisEngine: engineName(process.env.ANALYSIS_ENGINE, engineName(process.env.GATE_ENGINE, 'ollama')),
  appleSidecarBin: process.env.APPLE_SIDECAR_BIN || './sidecar/bin/aiva-afm',
  appleMaxPromptTokens: num(process.env.APPLE_MAX_PROMPT_TOKENS, 2800),

  // OpenAI (o cualquier API compatible): motor de nube opcional.
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiBaseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  // Modelo por rol (vacío = OPENAI_MODEL): un mini para responder rápido y uno mayor donde nadie espera (análisis).
  openaiRoleModels: {
    light: process.env.OPENAI_MODEL_LIGHT || '',
    heavy: process.env.OPENAI_MODEL_HEAVY || '',
    gate: process.env.OPENAI_MODEL_GATE || '',
    analysis: process.env.OPENAI_MODEL_ANALYSIS || '',
  },
  // Esfuerzo de razonamiento por rol (none | minimal | low | medium | high; vacío = el del modelo).
  // Solo aplica a modelos de razonamiento; los tokens de razonamiento se cobran como salida.
  openaiRoleEffort: {
    light: process.env.OPENAI_EFFORT_LIGHT || '',
    heavy: process.env.OPENAI_EFFORT_HEAVY || '',
    gate: process.env.OPENAI_EFFORT_GATE || '',
    analysis: process.env.OPENAI_EFFORT_ANALYSIS || '',
  },

  // Tablero de administración
  adminToken: process.env.ADMIN_TOKEN || '',

  // Calendario: token del enlace de suscripción (vacío = derivado de ADMIN_TOKEN) y calendarios privados del
  // dueño en formato iCal (coma-separado) cuyos eventos ocupan la agenda.
  calendarToken: process.env.CALENDAR_TOKEN || '',
  calendarBusyIcs: list(process.env.CALENDAR_BUSY_ICS),
};

function engineName(v: string | undefined, def: 'ollama' | 'apple' | 'openai'): 'ollama' | 'apple' | 'openai' {
  return v === 'ollama' || v === 'apple' || v === 'openai' ? v : def;
}

// ---------- Configuración del negocio (aiva.config.json) ----------
const BusinessConfig = z.object({
  business: z.object({
    name: z.string(),
    description: z.string(),
    siteUrl: z.string().url(),
    currency: z.string().default('COP'),
    country: z.string().default('Colombia'),
    /** Indicativo del país y dígitos de un número local: con ellos se entienden "300 123 4567" y se guardan como +57… */
    phoneCountryCode: z.string().regex(/^\d{1,3}$/).default('57'),
    phoneLocalDigits: z.number().int().min(6).max(12).default(10),
    humanContact: z.string(),
  }),
  agent: z.object({
    name: z.string().default('Aiva'),
    style: z.string().default('cálido, cercano, tutea, mensajes cortos tipo WhatsApp'),
    language: z.string().default('es'),
    greeting: z.string().optional(),
    /** Objetivo comercial del asistente (p. ej. "llevar al cliente a agendar su cita"). */
    goal: z.string().optional(),
    /** Lo que dice cuando no sabe algo: la pregunta queda "por verificar" en el tablero y el equipo responde. */
    verifyPhrase: z.string().default('Deja te verifico eso con el equipo y te confirmo por aquí 🙂'),
    /**
     * Con OpenAI, si toda la información del negocio (catálogo + información + páginas) cabe en estos tokens, va
     * entera y fija al inicio del prompt: el modelo la ve completa y OpenAI la cobra desde su caché (90 % menos).
     * Catálogos más grandes, Apple y Ollama usan la búsqueda. 0 = siempre la búsqueda.
     */
    fullInfoMaxTokens: z.number().int().min(0).default(6000),
  }),
  sources: z.object({
    productsFile: z.string().default('data/catalog/products.json'),
    knowledgeDir: z.string().default('data/knowledge'),
    sitePages: z.array(z.string().url()).default([]),
    shopifyUrl: z.string().url().optional(),
  }),
  timezone: z.string().default('America/Bogota'),
  /** Agendamiento de citas (toma de medidas, prueba, visita...). */
  appointments: z
    .object({
      enabled: z.boolean().default(false),
      service: z.string().default('cita'),
      location: z.string().default(''),
      durationMin: z.number().int().positive().default(45),
      /** Días de la semana con atención: 0=domingo ... 6=sábado */
      days: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
      /** Franjas horarias [inicio, fin] en HH:MM */
      hours: z.array(z.tuple([z.string(), z.string()])).default([['09:00', '13:00'], ['14:00', '18:00']]),
      capacity: z.number().int().positive().default(1),
      minLeadHours: z.number().nonnegative().default(12),
      maxDaysAhead: z.number().int().positive().default(21),
      /** Pedir un número para confirmar (si el canal no lo trae, como el chat web) y ofrecer dejar el correo. */
      askPhone: z.boolean().default(true),
      askEmail: z.boolean().default(true),
      /** Recordatorio el día antes, por el canal del cliente; lo que no se puede enviar solo queda en Hoy para hacerlo a mano. */
      reminder: z
        .object({
          enabled: z.boolean().default(true),
          /** Hora local del día anterior a la que se envía (HH:MM). */
          at: z.string().regex(/^\d{2}:\d{2}$/).default('17:00'),
          /** WhatsApp oficial fuera de las 24 h: plantilla aprobada en Meta con {{1}} = nombre y {{2}} = fecha y hora. */
          metaTemplate: z.object({ name: z.string().min(1), language: z.string().default('es') }).optional(),
        })
        .prefault({}),
    })
    .prefault({}),
  /** CRM: campos que el análisis debe capturar además de los básicos. */
  crm: z
    .object({
      fields: z
        .array(z.object({ name: z.string().regex(/^[a-z_][a-z0-9_]*$/), description: z.string() }))
        .default([{ name: 'producto_interes', description: 'Producto o servicio que le interesa al cliente, si lo dijo' }]),
      /**
       * El análisis corre cuando la conversación lleva este silencio (segundos): un cliente que escribe cada 30 s no
       * paga un análisis por mensaje. Con la conversación activa, a más tardar `analysisMaxWaitSeconds` después del
       * primer mensaje sin analizar, para que el puntaje y el aviso de "caliente" no se atrasen.
       */
      analysisQuietSeconds: z.number().min(0).default(60),
      analysisMaxWaitSeconds: z.number().min(0).default(300),
    })
    .prefault({}),
  /**
   * Archivo del diccionario del negocio (lo que cada cliente le enseña a aiva sin tocar código: temas que se
   * responden con su información y verbos con que su gente pregunta). Se importa y exporta desde el tablero.
   * Ver src/agent/dictionary.ts.
   */
  dictionaryFile: z.string().default('dictionary.json'),
  /** Perfil del negocio (dirección, horarios, pagos, precios, contacto…), editable desde el tablero. Ver src/profile.ts. */
  profileFile: z.string().default('profile.json'),
  /** La marca del cliente en lo que ve su gente (chat del sitio, página de la cita). El contraste se ajusta solo. */
  brand: z
    .object({
      /** Color principal, hex (#C5A47E). */
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#2f7d4f'),
      /** Logo: URL https o archivo local (png, jpg, svg, webp) que aiva sirve en /brand/logo. */
      logo: z.string().optional(),
    })
    .prefault({}),
  /** Versiones anteriores lo traían aquí mismo; si el archivo no existe todavía, se usa esto. */
  dictionary: z.unknown().optional(),
  /** Batería de escenarios de este cliente (pnpm test:scenarios). */
  evalFile: z.string().default('data/scenarios.json'),
  /** Datos de demostración (pnpm seed). */
  seedFile: z.string().optional(),
});
export type BusinessConfig = z.infer<typeof BusinessConfig>;

export function loadBusinessConfig(path = 'aiva.config.json'): BusinessConfig {
  const abs = resolve(path);
  if (!existsSync(abs)) {
    throw new Error(`No existe ${path}. Copia aiva.config.example.json a aiva.config.json y ajústalo.`);
  }
  return BusinessConfig.parse(JSON.parse(readFileSync(abs, 'utf8')));
}

// AIVA_CONFIG elige otro archivo: un proceso por cliente, o una copia para pruebas que no toquen el diccionario real.
export const business = loadBusinessConfig(process.env.AIVA_CONFIG || 'aiva.config.json');
