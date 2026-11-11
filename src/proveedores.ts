// Los proveedores de IA de un cliente: conectarlos desde el tablero (Configuración › Modelos de IA).
//
// Hasta XENCRM, conectar un motor era escribir el `.env` a mano: la llave de OpenAI se podía poner desde la consola,
// pero Claude, Ollama o una API compatible pedían una terminal. Aquí se conectan seis: OpenAI, Anthropic (Claude),
// Apple Foundation Models, Ollama, LM Studio y cualquier otra API compatible con OpenAI. Lo que cada uno hace —qué
// rol atiende— sigue en `motores.ts`; esto es solo el enchufe.
//
// Las tres reglas de `motores.ts` valen aquí igual:
//   1. Una llave NUNCA vuelve al navegador ni a los registros: solo si está puesta y una pista para reconocerla.
//   2. Una llave se comprueba ANTES de guardarla (una mal copiada se guarda igual de bien que una buena, y no se
//      nota hasta que escribe un cliente). Una dirección no: puede que lo vayan a encender después, y una dirección
//      sola no hace atender a nadie —para eso hay que ponerlo en un rol, y ahí sí se sondea—.
//   3. Lo guardado se aplica al REINICIAR. No se disimula: cada proveedor tocado queda marcado como pendiente.
import { readFileSync } from 'node:fs';
import { ENV_FILE, env } from './config.js';
import { quitarEnvValues, setEnvValues } from './envfile.js';
import { apple } from './llm/apple.js';
import { engineStatus, roleEngine, ROLES, type Engine, type Role } from './llm/engines.js';
import { openaiModel, probeCompatible } from './llm/openai.js';
import { anthropicModel } from './llm/anthropic.js';

export type ProveedorId = 'openai' | 'anthropic' | 'apple' | 'ollama' | 'lmstudio' | 'compat';
export const PROVEEDORES: ProveedorId[] = ['openai', 'anthropic', 'apple', 'ollama', 'lmstudio', 'compat'];

/** Cómo está, en palabras que se entienden sin saber de motores. */
export type Estado = 'conectado' | 'sin_llave' | 'sin_configurar' | 'no_disponible' | 'sin_probar';

/** Lo que se cuenta de un proveedor. Ni aquí ni en ninguna respuesta va una llave. */
export interface Proveedor {
  id: ProveedorId;
  nombre: string;
  /** Una línea: qué es y dónde corre. */
  queEs: string;
  /** Corre en la máquina: no cuesta, y no se puede usar en un servidor que no lo tenga. */
  deMaquina: boolean;
  dePago: boolean;
  estado: Estado;
  porque?: string;
  llave: null | { puesta: boolean; pista: string; deLaCasa: boolean; obligatoria: boolean; empiezaPor?: string };
  url: null | { valor: string; porDefecto: string };
  modelo: null | { valor: string; editable: boolean };
  /** El nombre que se le dio a la API compatible («OpenRouter»). */
  nombrePropio?: string;
  /** Los roles que lo usan ahora mismo. */
  enUso: Role[];
  /** Claude: entra cuando falla el motor de un rol. */
  respaldo: boolean;
  /** Se guardó algo que todavía no corre: se aplica al reiniciar. */
  pendiente: boolean;
}

interface Def {
  nombre: string;
  queEs: string;
  deMaquina: boolean;
  dePago: boolean;
  llave?: { variable: string; obligatoria: boolean; empiezaPor?: string };
  url?: { variable: string; porDefecto: string };
  modelo?: { variable: string; editable: boolean };
}

const DEFS: Record<ProveedorId, Def> = {
  openai: {
    nombre: 'OpenAI',
    queEs: 'GPT en la nube. Cobra por uso, con la llave de quien la pone.',
    deMaquina: false,
    dePago: true,
    llave: { variable: 'OPENAI_API_KEY', obligatoria: true, empiezaPor: 'sk-' },
    url: { variable: 'OPENAI_BASE_URL', porDefecto: 'https://api.openai.com/v1' },
  },
  anthropic: {
    nombre: 'Anthropic (Claude)',
    queEs: 'Claude en la nube. Es el respaldo de todos los roles y también puede hacer uno.',
    deMaquina: false,
    dePago: true,
    llave: { variable: 'ANTHROPIC_API_KEY', obligatoria: true, empiezaPor: 'sk-ant-' },
  },
  apple: {
    nombre: 'Apple Foundation Models',
    queEs: 'El modelo de Apple Intelligence, en un Mac. Sin llave y sin costo.',
    deMaquina: true,
    dePago: false,
  },
  ollama: {
    nombre: 'Ollama',
    queEs: 'Modelos abiertos (Gemma, Llama…) en esta máquina o en otra de tu red. Sin costo por uso.',
    deMaquina: true,
    dePago: false,
    url: { variable: 'OLLAMA_URL', porDefecto: 'http://localhost:11434' },
    modelo: { variable: 'CHAT_MODEL', editable: false },
  },
  lmstudio: {
    nombre: 'LM Studio',
    queEs: 'El servidor local de LM Studio, que habla como OpenAI. Sin llave y sin costo por uso.',
    deMaquina: true,
    dePago: false,
    url: { variable: 'LMSTUDIO_URL', porDefecto: 'http://localhost:1234/v1' },
    modelo: { variable: 'LMSTUDIO_MODEL', editable: true },
  },
  compat: {
    nombre: 'Otra API compatible con OpenAI',
    queEs: 'OpenRouter, Groq, Together, un servidor propio… cualquiera que hable como OpenAI.',
    deMaquina: false,
    dePago: true,
    llave: { variable: 'COMPAT_API_KEY', obligatoria: false },
    url: { variable: 'COMPAT_URL', porDefecto: '' },
    modelo: { variable: 'COMPAT_MODEL', editable: true },
  },
};

/** Dónde duerme la llave de OpenAI apagada desde la consola (motores.ts, PARQUEADA). Quitarla también la borra. */
const OPENAI_APARCADA = 'OPENAI_API_KEY_APAGADA';

/** Lo que corre, por variable: el `.env` leído al arrancar. */
function loQueCorre(variable: string): string {
  const v: Record<string, string> = {
    OPENAI_API_KEY: env.openaiApiKey,
    OPENAI_BASE_URL: env.openaiBaseUrl,
    ANTHROPIC_API_KEY: env.anthropicApiKey,
    OLLAMA_URL: env.ollamaUrl,
    CHAT_MODEL: env.chatModel,
    LMSTUDIO_URL: env.lmstudioUrl,
    LMSTUDIO_MODEL: env.lmstudioModel,
    COMPAT_URL: env.compatUrl,
    COMPAT_API_KEY: env.compatApiKey,
    COMPAT_MODEL: env.compatModel,
    COMPAT_NOMBRE: env.compatNombre,
  };
  return v[variable] ?? '';
}

/**
 * Lo que dice el archivo de ESTE cliente, sin la herencia del de la raíz.
 *
 * 🪤 Por qué el archivo y no `process.env`: en `process.env` ya está resuelta la herencia, y una llave de la casa
 * parecería del cliente (la misma trampa que `claveDelCliente()` en motores.ts).
 */
export function enElArchivo(variable: string, archivo = ENV_FILE): string {
  try {
    return (
      readFileSync(archivo, 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith(`${variable}=`))
        .map((l) => l.slice(variable.length + 1).trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)[0] ?? ''
    );
  } catch {
    return '';
  }
}

/** Lo que valdrá al reiniciar: lo del archivo y, si no hay, lo que corre (lo heredado o lo de fábrica). */
const loGuardado = (variable: string): string => enElArchivo(variable) || loQueCorre(variable);

/** Para reconocer una llave sin enseñarla: «sk-proj…f2a9». Las cortas no dan pista: serían media llave. */
export const pistaDe = (k: string): string => (k.length < 16 ? (k ? '…' : '') : `${k.slice(0, 7)}…${k.slice(-4)}`);

/** Los proveedores tocados desde que arrancó: lo suyo se aplica al reiniciar. */
const tocados = new Set<ProveedorId>();

/** Los roles que usa cada motor, según lo que corre. */
function rolesDe(motor: Engine): Role[] {
  return ROLES.filter((r) => roleEngine(r) === motor);
}

/** Un proveedor, tal como se le cuenta al tablero. */
export function proveedor(id: ProveedorId): Proveedor {
  const d = DEFS[id];
  const st = engineStatus()[id as Engine];
  const llaveCorre = d.llave ? loQueCorre(d.llave.variable) : '';
  const llaveArchivo = d.llave ? enElArchivo(d.llave.variable) : '';
  const llave = d.llave ? llaveArchivo || llaveCorre : '';
  const enUso = rolesDe(id);
  let estado: Estado;
  let porque = st?.reason;
  if (tocados.has(id)) {
    estado = 'sin_probar';
    porque = 'Guardaste cambios: se aplican al reiniciar.';
  } else if (d.llave?.obligatoria && !llave) {
    estado = 'sin_llave';
    porque = undefined;
  } else if ((id === 'lmstudio' && !process.env.LMSTUDIO_URL && !env.lmstudioModel) || (id === 'compat' && !env.compatUrl)) {
    estado = 'sin_configurar';
    porque = undefined;
  } else if ((id === 'lmstudio' && !env.lmstudioModel) || (id === 'compat' && !env.compatModel)) {
    // Contesta o no, sin modelo no puede atender: le falta un paso, no está roto.
    estado = 'sin_configurar';
    porque = 'Falta elegir el modelo: prueba la conexión para ver los que hay.';
  } else if (st?.available) {
    estado = 'conectado';
    porque = undefined;
  } else if (id === 'apple' && !enUso.length) {
    // Apple solo se sondea al arrancar si hace un rol (es un programa aparte que hay que despertar).
    estado = 'sin_probar';
    porque = 'Nadie lo usa todavía: pruébalo para saber si funcionaría aquí.';
  } else {
    estado = 'no_disponible';
  }
  return {
    id,
    nombre: d.nombre,
    queEs: d.queEs,
    deMaquina: d.deMaquina,
    dePago: d.dePago,
    estado,
    ...(porque ? { porque } : {}),
    llave: d.llave
      ? { puesta: Boolean(llave), pista: pistaDe(llave), deLaCasa: Boolean(!llaveArchivo && llaveCorre), obligatoria: d.llave.obligatoria, ...(d.llave.empiezaPor ? { empiezaPor: d.llave.empiezaPor } : {}) }
      : null,
    url: d.url ? { valor: loGuardado(d.url.variable) || d.url.porDefecto, porDefecto: d.url.porDefecto } : null,
    modelo: d.modelo ? { valor: loGuardado(d.modelo.variable), editable: d.modelo.editable } : null,
    ...(id === 'compat' ? { nombrePropio: loGuardado('COMPAT_NOMBRE') } : {}),
    enUso,
    respaldo: id === 'anthropic',
    pendiente: tocados.has(id),
  };
}

export function proveedores(): Proveedor[] {
  return PROVEEDORES.map(proveedor);
}

export const esProveedor = (x: string): x is ProveedorId => (PROVEEDORES as string[]).includes(x);

// ── Validar lo que se escribe ───────────────────────────────────────────────

/** Una dirección: http o https, sin espacios ni comillas (acaba en una línea del `.env`), sin la barra final. */
export function urlLimpia(raw: string, nombre: string): string {
  const u = raw.trim().replace(/\/+$/, '');
  if (!u) throw new Error(`Escribe la dirección de ${nombre}.`);
  if (u.length > 200) throw new Error(`La dirección de ${nombre} es demasiado larga.`);
  if (/[\s#"']/.test(u)) throw new Error(`La dirección de ${nombre} no puede llevar espacios ni comillas.`);
  let p: URL;
  try {
    p = new URL(u);
  } catch {
    throw new Error(`«${u.slice(0, 60)}» no es una dirección. Empieza por http:// o https://.`);
  }
  if (p.protocol !== 'http:' && p.protocol !== 'https:') throw new Error('La dirección tiene que empezar por http:// o https://.');
  if (p.username || p.password) throw new Error('No pongas usuario ni clave dentro de la dirección: la llave va en su campo.');
  return u;
}

/** Un nombre de modelo: va a una línea del `.env`, donde un espacio o una comilla lo parten. */
export function modeloLimpio(raw: string, nombre: string): string {
  const m = raw.trim();
  if (/[\s#"']/.test(m)) throw new Error(`El modelo de ${nombre} no puede llevar espacios ni comillas.`);
  if (m.length > 120) throw new Error(`El modelo de ${nombre} es demasiado largo.`);
  return m;
}

/** Cómo se le dice en una frase: «Anthropic dice que…», «OpenRouter contestó…». */
export function nombreCorto(id: ProveedorId): string {
  if (id === 'anthropic') return 'Anthropic';
  if (id === 'compat') return loGuardado('COMPAT_NOMBRE') || 'La API compatible';
  return DEFS[id].nombre;
}

/** ¿Sirve esta llave? Entra por parámetro para que la prueba decida qué contesta, sin red. */
export type ComprobarLlave = (id: ProveedorId, llave: string, url: string) => Promise<void>;

/**
 * Pregunta la lista de modelos con la llave: no genera nada, así que no gasta.
 *
 * 🪤 El error dice lo que pasó en términos de quien la pegó (no vale, no tiene saldo, no hubo red), nunca la llave.
 */
export const comprobarDeVerdad: ComprobarLlave = async (id, llave, url) => {
  const nombre = nombreCorto(id);
  let r: Response;
  try {
    r =
      id === 'anthropic'
        ? await fetch(`${env.anthropicBaseUrl}/models`, { headers: { 'x-api-key': llave, 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(15_000) })
        : await fetch(`${url}/models`, { headers: { authorization: `Bearer ${llave}` }, signal: AbortSignal.timeout(15_000), redirect: 'error' });
  } catch {
    throw new Error(`No pude hablar con ${nombre} para comprobarla. Mira la conexión y vuelve a intentar.`);
  }
  if (r.status === 401 || r.status === 403) throw new Error(`${nombre} dice que esa llave no vale.`);
  if (r.status === 429) throw new Error('La llave es válida pero no tiene saldo: cárgale antes de usarla.');
  if (!r.ok) throw new Error(`${nombre} contestó ${r.status} al comprobarla.`);
};

export interface CambioProveedor {
  llave?: string;
  url?: string;
  modelo?: string;
  nombre?: string;
}

/**
 * Guarda lo que se cambió de un proveedor. La llave, después de comprobarla; la dirección y el modelo, limpios.
 * Devuelve el proveedor como se le cuenta al tablero (sin la llave) y que hay que reiniciar.
 */
export async function guardarProveedor(id: ProveedorId, cambio: CambioProveedor, comprobar: ComprobarLlave = comprobarDeVerdad): Promise<{ proveedor: Proveedor; hayQueReiniciar: boolean }> {
  const d = DEFS[id];
  const valores: Record<string, string> = {};
  if (cambio.url !== undefined) {
    if (!d.url) throw new Error(`${d.nombre} no lleva dirección.`);
    // La de OpenAI se puede dejar vacía: vuelve a la de siempre.
    if (id === 'openai' && !cambio.url.trim()) valores[d.url.variable] = '';
    else valores[d.url.variable] = urlLimpia(cambio.url, d.nombre);
  }
  if (cambio.modelo !== undefined) {
    if (!d.modelo?.editable) throw new Error(`El modelo de ${d.nombre} no se cambia aquí.`);
    valores[d.modelo.variable] = modeloLimpio(cambio.modelo, d.nombre);
  }
  if (cambio.nombre !== undefined) {
    if (id !== 'compat') throw new Error(`${d.nombre} ya tiene nombre.`);
    const n = cambio.nombre.trim();
    if (n && !/^[\p{L}\p{N}._-]{1,40}$/u.test(n)) throw new Error('El nombre va sin espacios ni signos raros (por ejemplo, OpenRouter).');
    valores.COMPAT_NOMBRE = n;
  }
  if (cambio.llave !== undefined) {
    if (!d.llave) throw new Error(`${d.nombre} no pide llave.`);
    const k = cambio.llave.trim();
    if (!k) throw new Error('Pega la llave. Para quitarla, usa «Quitar».');
    if (/[\s#"']/.test(k)) throw new Error('Esa llave lleva espacios o comillas: cópiala otra vez.');
    if (k.length > 300) throw new Error('Eso es demasiado largo para ser una llave.');
    if (d.llave.empiezaPor && !k.startsWith(d.llave.empiezaPor)) throw new Error(`Una llave de ${d.nombre} empieza por «${d.llave.empiezaPor}».`);
    const url = valores[d.url?.variable ?? ''] || (d.url ? loGuardado(d.url.variable) || d.url.porDefecto : '');
    if (id === 'compat' && !url) throw new Error('Pon primero la dirección de la API: la llave se comprueba contra ella.');
    await comprobar(id, k, url);
    valores[d.llave.variable] = k;
  }
  if (!Object.keys(valores).length) return { proveedor: proveedor(id), hayQueReiniciar: false };
  // 🪤 Vaciar no es quitar (envfile.ts): una línea `X=` corta la herencia de la raíz. Lo vacío se quita.
  const vacios = Object.keys(valores).filter((k) => !valores[k]);
  const llenos = Object.fromEntries(Object.entries(valores).filter(([, v]) => v));
  if (Object.keys(llenos).length) setEnvValues(llenos);
  if (vacios.length) quitarEnvValues(vacios);
  // La llave nueva de OpenAI reemplaza a la aparcada: dos guardadas confunden (motores.ts, ponerClaveDelCliente).
  if (id === 'openai' && llenos.OPENAI_API_KEY) quitarEnvValues([OPENAI_APARCADA]);
  tocados.add(id);
  return { proveedor: proveedor(id), hayQueReiniciar: true };
}

/** Olvidar la llave de este cliente. Si la casa tiene una, vuelve a heredarla al reiniciar. */
export function quitarLlave(id: ProveedorId): { proveedor: Proveedor; hayQueReiniciar: boolean } {
  const d = DEFS[id];
  if (!d.llave) throw new Error(`${d.nombre} no pide llave.`);
  quitarEnvValues(id === 'openai' ? [d.llave.variable, OPENAI_APARCADA] : [d.llave.variable]);
  tocados.add(id);
  return { proveedor: proveedor(id), hayQueReiniciar: true };
}

// ── Probar la conexión ──────────────────────────────────────────────────────

export interface Prueba {
  ok: boolean;
  /** Algo contestó en esa dirección (aunque falte el modelo o la llave no valga). */
  contesta: boolean;
  porque?: string;
  /** Los modelos que ofrece, para elegir en vez de escribir de memoria. */
  modelos: string[];
}

/** Para las pruebas: qué contesta cada pregunta a la red. */
export interface Red {
  compatible: typeof probeCompatible;
  ollama: (url: string) => Promise<{ ok: boolean; modelos: string[] }>;
  anthropic: (llave: string) => Promise<{ ok: boolean; status: number; modelos: string[] }>;
  apple: () => Promise<{ ok: boolean; reason?: string }>;
}

const redDeVerdad: Red = {
  compatible: probeCompatible,
  ollama: async (url) => {
    try {
      const r = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(8_000), redirect: 'error' });
      if (!r.ok) return { ok: false, modelos: [] };
      const d = (await r.json()) as { models?: { name?: unknown }[] };
      return { ok: true, modelos: (d.models ?? []).map((m) => (typeof m.name === 'string' ? m.name.slice(0, 120) : '')).filter(Boolean).slice(0, 200) };
    } catch {
      return { ok: false, modelos: [] };
    }
  },
  anthropic: async (llave) => {
    try {
      const r = await fetch(`${env.anthropicBaseUrl}/models?limit=100`, { headers: { 'x-api-key': llave, 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(15_000) });
      if (!r.ok) return { ok: false, status: r.status, modelos: [] };
      const d = (await r.json()) as { data?: { id?: unknown }[] };
      return { ok: true, status: r.status, modelos: (d.data ?? []).map((m) => (typeof m.id === 'string' ? m.id : '')).filter(Boolean) };
    } catch {
      return { ok: false, status: 0, modelos: [] };
    }
  },
  apple: () => apple.probe(),
};

/**
 * Prueba lo GUARDADO —lo que correrá al reiniciar—, no lo que corre. Así se sabe si un cambio sirve antes de
 * reiniciar por él. No genera texto: pregunta qué modelos hay, así que no gasta.
 */
export async function probarProveedor(id: ProveedorId, red: Red = redDeVerdad): Promise<Prueba> {
  const d = DEFS[id];
  if (id === 'apple') {
    const a = await red.apple();
    if (a.ok) return { ok: true, contesta: true, modelos: [] };
    // 🪤 El motivo de abajo habla de archivos («falta ./sidecar/bin/aiva-afm»): se dice qué significa para quien
    // configura, y el detalle va al final para quien lo vaya a instalar.
    const porque = /^falta /.test(a.reason ?? '')
      ? 'Esta máquina no tiene el puente con Apple: solo corre en un Mac con Apple Intelligence (se instala con pnpm build:sidecar).'
      : `Apple no responde aquí${a.reason ? ` (${a.reason})` : ''}.`;
    return { ok: false, contesta: false, modelos: [], porque };
  }
  if (id === 'anthropic') {
    const llave = loGuardado('ANTHROPIC_API_KEY');
    if (!llave) return { ok: false, contesta: false, porque: 'Falta la llave.', modelos: [] };
    const r = await red.anthropic(llave);
    if (r.status === 401 || r.status === 403) return { ok: false, contesta: true, porque: 'Anthropic dice que la llave no vale.', modelos: [] };
    if (!r.ok) return { ok: false, contesta: r.status > 0, porque: r.status ? `Anthropic contestó ${r.status}.` : 'No pude hablar con Anthropic.', modelos: [] };
    const faltan = [...new Set(ROLES.map(anthropicModel))].filter((m) => r.modelos.length && !r.modelos.some((x) => x === m || x.startsWith(`${m}-`)));
    return { ok: !faltan.length, contesta: true, modelos: r.modelos, ...(faltan.length ? { porque: `Esa llave no tiene ${faltan.join(', ')}.` } : {}) };
  }
  if (id === 'ollama') {
    const url = loGuardado('OLLAMA_URL') || d.url!.porDefecto;
    const r = await red.ollama(url);
    if (!r.ok) return { ok: false, contesta: false, porque: `No hay un Ollama contestando en ${url}.`, modelos: [] };
    const has = (m: string) => r.modelos.includes(m) || r.modelos.includes(`${m}:latest`);
    return { ok: has(env.chatModel), contesta: true, modelos: r.modelos, ...(has(env.chatModel) ? {} : { porque: `Contesta, pero no tiene ${env.chatModel} (ollama pull ${env.chatModel}).` }) };
  }
  // OpenAI, LM Studio y el compatible: los tres hablan igual.
  const url = (d.url ? loGuardado(d.url.variable) : '') || d.url?.porDefecto || '';
  const llave = d.llave ? loGuardado(d.llave.variable) : '';
  if (!url) return { ok: false, contesta: false, porque: 'Falta la dirección.', modelos: [] };
  if (d.llave?.obligatoria && !llave) return { ok: false, contesta: false, porque: 'Falta la llave.', modelos: [] };
  const modelo = d.modelo ? loGuardado(d.modelo.variable) : '';
  const r = await red.compatible(url, llave, modelo || undefined);
  const contesta = r.ok || r.modelos.length > 0 || /modelo|cargado/.test(r.reason ?? '');
  if (!r.ok) return { ok: false, contesta, porque: capitalizar(r.reason ?? 'no contestó'), modelos: r.modelos };
  if (d.modelo?.editable && !modelo) return { ok: false, contesta: true, porque: 'Contesta. Falta elegir el modelo.', modelos: r.modelos };
  if (id === 'openai') {
    // Los modelos de cada rol tienen que estar para esta llave: es lo que sondeaba la consola (probeOpenAI).
    const faltan = [...new Set(ROLES.map(openaiModel))].filter((m) => r.modelos.length && !r.modelos.includes(m));
    if (faltan.length) return { ok: false, contesta: true, porque: `Esa llave no tiene ${faltan.join(', ')}.`, modelos: r.modelos.slice(0, 200) };
  }
  return { ok: true, contesta: true, modelos: r.modelos.slice(0, 200) };
}

const capitalizar = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) + (/[.!?]$/.test(s) ? '' : '.') : s);

/**
 * El sondeo que usa `guardarMotores()` para no dejar un rol en un motor que no contesta: con lo GUARDADO, que es
 * lo que el rol usará al reiniciar. Con lo que corre, una llave recién puesta obligaba a reiniciar dos veces —una
 * para la llave, otra para el rol—.
 */
export async function sondearGuardado(motor: Engine): Promise<{ available: boolean; reason?: string }> {
  if (!esProveedor(motor)) return { available: false, reason: 'no lo conozco' };
  const p = await probarProveedor(motor);
  return { available: p.ok, ...(p.porque ? { reason: p.porque } : {}) };
}
