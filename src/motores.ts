// Qué motor hace cada cosa, y poder cambiarlo sin entrar al servidor.
//
// Hasta ahora esto vivía solo en el `.env` de cada cliente y había que abrir una terminal para moverlo. Aquí se
// lee y se escribe lo mismo, con las dos reglas que hacen que no sea peligroso: no se guarda nada con lo que el
// cliente no pueda atender, y lo que cuesta dinero se dice antes, no después.
//
// 🪤 Esto se lee UNA vez, al arrancar —como el resto de la configuración—, así que guardar deja el archivo listo
// y el proceso sigue con lo viejo hasta que reinicie. No se disimula: `guardar()` lo dice y el tablero ofrece el
// reinicio. Fingir que se aplicó en caliente sería peor que pedir el reinicio, porque entonces nadie entiende
// por qué sigue contestando el motor de antes.
import { env } from './config.js';
import { quitarEnvValues, setEnvValues } from './envfile.js';
import { readFileSync } from 'node:fs';
import { ASIGNABLES, ROLES, engineStatus, type Engine, type Role } from './llm/engines.js';
import { sondearGuardado } from './proveedores.js';

/** Cómo se llama cada rol para quien no escribió el programa. */
export const ROL_NOMBRE: Record<Role, string> = {
  light: 'Responder',
  heavy: 'Lo específico',
  gate: 'Clasificar',
  analysis: 'Analizar',
};

/** Qué hace cada rol, en una frase, para poder decidir sin adivinar. */
export const ROL_QUE_HACE: Record<Role, string> = {
  light: 'La mayoría de los mensajes: saludar, orientar, responder lo de siempre. Es el que más se usa.',
  heavy: 'Lo que pide precisión: características, comparar, detalles técnicos, recomendar.',
  gate: 'Decide qué clase de mensaje llegó y a dónde va. No se ve, pero de él depende todo lo demás.',
  analysis: 'La ficha del contacto, el puntaje y el resumen. Nadie espera delante de la pantalla.',
};

/**
 * 🪤 El clasificador es el núcleo del CRM y no es donde se ahorra.
 *
 * Es el único rol que corre en TODOS los mensajes y del que dependen los demás: si clasifica mal, el mensaje va
 * al sitio equivocado y lo que pase después ya da igual lo bueno que sea el motor que lo atienda. Bajarlo de
 * categoría sale barato en la factura y se paga en conversaciones perdidas, que no aparecen en ninguna cuenta.
 *
 * No se prohíbe —puede haber razones— pero se avisa, y se avisa aquí para que el aviso no dependa de que alguien
 * se acuerde de ponerlo en la pantalla.
 */
export const CUIDADO: Partial<Record<Role, string>> = {
  gate: 'Es el único que corre en todos los mensajes y de él dependen los demás. Si clasifica mal, da igual lo bueno que sea el resto. Cambiarlo por ahorrar suele costar más de lo que ahorra.',
};

export interface MotorDeRol {
  rol: Role;
  motor: Engine;
  /** El modelo de OpenAI de ese rol. Vacío = el general (OPENAI_MODEL). Solo cuenta si el motor es openai. */
  modelo: string;
  /** El modelo de Claude de ese rol (ANTHROPIC_MODEL_<ROL>). Vacío = el general. Cuenta si el motor es anthropic. */
  modeloClaude: string;
  /** Esfuerzo de razonamiento. Vacío = el que traiga el modelo. */
  esfuerzo: string;
}

export interface Motores {
  /** 'router' = cada rol con el suyo. Cualquier otro fuerza ese motor para todo. */
  reparto: 'router' | Engine;
  roles: MotorDeRol[];
  /** Qué motores están disponibles AQUÍ y por qué no los que no. */
  disponibles: Record<Engine, { available: boolean; reason?: string }>;
  /** El modelo general de OpenAI, para los roles que no tienen uno propio. */
  modeloGeneral: string;
  /** Y el de Claude. */
  modeloClaudeGeneral: string;
  /** Los motores que se pueden poner en un rol. */
  asignables: Engine[];
  /** Si hay quien lo vuelva a levantar: sin eso, reiniciar deja al cliente sin atender a nadie. */
  puedeReiniciarse: boolean;
}

const ESFUERZOS = ['', 'none', 'minimal', 'low', 'medium', 'high'];

/** Cómo se llama cada motor en un mensaje para quien no escribió el programa. */
const NOMBRE_MOTOR: Partial<Record<Engine, string>> = {
  ollama: 'Ollama',
  apple: 'Apple',
  openai: 'OpenAI',
  anthropic: 'Claude',
  lmstudio: 'LM Studio',
  compat: 'la API compatible',
};

const VAR_MOTOR: Record<Role, string> = {
  light: 'LIGHT_ENGINE',
  heavy: 'HEAVY_ENGINE',
  gate: 'GATE_ENGINE',
  analysis: 'ANALYSIS_ENGINE',
};
const VAR_MODELO: Record<Role, string> = {
  light: 'OPENAI_MODEL_LIGHT',
  heavy: 'OPENAI_MODEL_HEAVY',
  gate: 'OPENAI_MODEL_GATE',
  analysis: 'OPENAI_MODEL_ANALYSIS',
};
const VAR_MODELO_CLAUDE: Record<Role, string> = {
  light: 'ANTHROPIC_MODEL_LIGHT',
  heavy: 'ANTHROPIC_MODEL_HEAVY',
  gate: 'ANTHROPIC_MODEL_GATE',
  analysis: 'ANTHROPIC_MODEL_ANALYSIS',
};
const VAR_ESFUERZO: Record<Role, string> = {
  light: 'OPENAI_EFFORT_LIGHT',
  heavy: 'OPENAI_EFFORT_HEAVY',
  gate: 'OPENAI_EFFORT_GATE',
  analysis: 'OPENAI_EFFORT_ANALYSIS',
};

const delRol = (rol: Role): Engine =>
  rol === 'light' ? env.lightEngine : rol === 'heavy' ? env.heavyEngine : rol === 'gate' ? env.gateEngine : env.analysisEngine;

/** Lo que este cliente tiene puesto ahora mismo. */
export function motoresDe(): Motores {
  return {
    reparto: env.llmEngine,
    roles: ROLES.map((rol) => ({
      rol,
      motor: delRol(rol),
      modelo: env.openaiRoleModels[rol],
      modeloClaude: env.anthropicRoleModels[rol],
      esfuerzo: env.openaiRoleEffort[rol],
    })),
    disponibles: engineStatus(),
    modeloGeneral: env.openaiModel,
    modeloClaudeGeneral: env.anthropicModel,
    asignables: ASIGNABLES,
    puedeReiniciarse: Boolean(process.env.XENCRM_SUPERVISADO || process.env.pm_id),
  };
}

export interface CambioMotores {
  reparto?: 'router' | Engine;
  roles?: { rol: Role; motor?: Engine; modelo?: string; modeloClaude?: string; esfuerzo?: string }[];
}

/** Preguntarle a un motor si respondería. Entra por parámetro para que la prueba decida qué contesta. */
export type Sondeo = (motor: Engine) => Promise<{ available: boolean; reason?: string }>;

/**
 * Guarda los motores en el `.env` de este cliente.
 *
 * 🪤 Lo primero que se comprueba es que el motor elegido EXISTA aquí, y es lo que convierte esta pantalla en
 * algo que se puede usar sin miedo. Poner `apple` en una máquina sin el sidecar, o `openai` sin clave, deja al
 * cliente sin atender a nadie hasta que alguien entre por ssh a deshacerlo — y como solo se ve al reiniciar,
 * nadie relaciona una cosa con la otra. Antes de escribir nada se dice que no y por qué.
 */
export async function guardarMotores(cambio: CambioMotores, sondeo: Sondeo = sondearGuardado): Promise<{ motores: Motores; hayQueReiniciar: boolean }> {
  const valores: Record<string, string> = {};
  // Se sondea de verdad, y no se mira `engineStatus()`, por el círculo cerrado que explica `probarMotor()`: ahí
  // Apple sale como no disponible porque nadie lo usa, así que nunca se podría empezar a usar. Y se guarda el
  // resultado por motor para no sondear cuatro veces lo mismo cuando se cambian los cuatro roles a la vez.
  //
  // El sondeo entra por parámetro para que la prueba decida qué responde: lo que hay que probar aquí es la
  // DECISIÓN —qué se guarda y qué se rechaza—, y atarla a que la máquina de turno tenga Ollama encendido haría
  // una prueba que pasa o falla según dónde se corra, que es una prueba que no dice nada.
  const sondeado = new Map<Engine, { available: boolean; reason?: string }>();
  const comprobar = async (motor: Engine, donde: string) => {
    if (!ASIGNABLES.includes(motor)) throw new Error(`"${motor}" no es un motor que yo conozca`);
    if (!sondeado.has(motor)) sondeado.set(motor, await sondeo(motor));
    const e = sondeado.get(motor)!;
    if (!e.available) throw new Error(`${donde}: ${NOMBRE_MOTOR[motor] ?? motor} no responde aquí${e.reason ? ` (${e.reason.replace(/\.$/, '')})` : ''}. No lo guardo: dejaría al cliente sin contestar.`);
  };

  if (cambio.reparto !== undefined) {
    if (cambio.reparto !== 'router') await comprobar(cambio.reparto, 'para todos los roles');
    valores.LLM_ENGINE = cambio.reparto;
  }

  for (const r of cambio.roles ?? []) {
    if (!ROLES.includes(r.rol)) throw new Error(`"${r.rol}" no es un rol`);
    if (r.motor !== undefined) {
      await comprobar(r.motor, ROL_NOMBRE[r.rol]);
      valores[VAR_MOTOR[r.rol]] = r.motor;
    }
    if (r.modelo !== undefined) {
      const m = r.modelo.trim();
      // 🪤 El nombre del modelo acaba en una línea de un archivo `.env`, donde un espacio o una comilla lo parten.
      // `setEnvValues` ya se niega, pero el aviso de allá habla de variables de entorno y aquí hay que decirlo
      // en términos de lo que la persona acaba de escribir.
      if (/[\s#"']/.test(m)) throw new Error(`El modelo de ${ROL_NOMBRE[r.rol]} no puede llevar espacios ni comillas`);
      if (m.length > 80) throw new Error(`El modelo de ${ROL_NOMBRE[r.rol]} es demasiado largo`);
      valores[VAR_MODELO[r.rol]] = m;
    }
    if (r.modeloClaude !== undefined) {
      const m = r.modeloClaude.trim();
      if (/[\s#"']/.test(m)) throw new Error(`El modelo de Claude de ${ROL_NOMBRE[r.rol]} no puede llevar espacios ni comillas`);
      if (m.length > 80) throw new Error(`El modelo de Claude de ${ROL_NOMBRE[r.rol]} es demasiado largo`);
      valores[VAR_MODELO_CLAUDE[r.rol]] = m;
    }
    if (r.esfuerzo !== undefined) {
      if (!ESFUERZOS.includes(r.esfuerzo)) throw new Error(`"${r.esfuerzo}" no es un esfuerzo válido`);
      valores[VAR_ESFUERZO[r.rol]] = r.esfuerzo;
    }
  }

  if (!Object.keys(valores).length) return { motores: motoresDe(), hayQueReiniciar: false };
  setEnvValues(valores);
  // setEnvValues ya dejó esto en process.env, pero `env` se congeló al arrancar: lo que devolvemos sigue siendo
  // lo que CORRE, no lo que se acaba de guardar. Es a propósito, y por eso va con `hayQueReiniciar`.
  return { motores: motoresDe(), hayQueReiniciar: true };
}

// ── La clave de OpenAI de cada cliente ──────────────────────────────────────
//
// Un cliente puede traer la suya y pagar lo que gasta. Es lo que hace que esto sea un producto y no una cuenta
// de OpenAI compartida: sin esto, cada negocio nuevo que entra es más factura para quien monta el sistema.
//
// Ya funcionaba —el `.env` del cliente gana sobre el de la raíz— pero solo editando archivos en el servidor.

/** Lo que se puede contar de la clave de un cliente. NUNCA la clave. */
export interface ClaveDelCliente {
  /** true = tiene la suya encendida y paga él. false = usa la de la casa. */
  propia: boolean;
  /** Tiene una suya guardada aunque ahora mismo esté apagada: se puede encender sin volver a pegarla. */
  guardada: boolean;
  /** Para reconocerla sin enseñarla: «sk-proj…f2a9». */
  pista: string;
}

/**
 * Dónde duerme la clave de un cliente mientras está apagada.
 *
 * 🪤 Apagar NO puede ser dejar `OPENAI_API_KEY=` vacía: una cadena vacía SÍ está definida, así que el cliente
 * dejaría de heredar la de la casa y se quedaría sin ninguna. Y tampoco puede ser borrarla, porque entonces hay
 * que volver a pegarla para encenderla —y una clave que se pega a mano cada vez se acaba pegando mal justo el
 * día que importa—. Así que se aparca con otro nombre, que XENCRM no lee, y encender es devolverla a su sitio.
 */
const PARQUEADA = 'OPENAI_API_KEY_APAGADA';

const pistaDe = (k: string): string => (k.length < 12 ? '' : `${k.slice(0, 7)}…${k.slice(-4)}`);

/**
 * 🪤 Se mira el ARCHIVO del cliente, no `process.env`. En `process.env` ya está resuelta la herencia: si el
 * cliente no tiene la suya, ahí aparece la de la casa y el tablero diría «tiene la suya» de todos los clientes
 * a la vez. La pregunta no es qué clave se está usando, es de quién es.
 */
function delArchivo(clave: string): string {
  const archivo = process.env.XENCRM_ENV_FILE || '.env';
  try {
    return (
      readFileSync(archivo, 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith(`${clave}=`))
        .map((l) => l.slice(clave.length + 1).trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)[0] ?? ''
    );
  } catch {
    return '';
  }
}

export function claveDelCliente(): ClaveDelCliente {
  const encendida = delArchivo('OPENAI_API_KEY');
  const apagada = delArchivo(PARQUEADA);
  if (encendida) return { propia: true, guardada: true, pista: pistaDe(encendida) };
  return { propia: false, guardada: Boolean(apagada), pista: pistaDe(apagada || env.openaiApiKey) };
}

/** Encender la suya: la aparcada vuelve a su sitio. */
export function encenderClaveDelCliente(): ClaveDelCliente {
  const apagada = delArchivo(PARQUEADA);
  if (!apagada) throw new Error('este cliente no tiene ninguna clave guardada');
  setEnvValues({ OPENAI_API_KEY: apagada });
  quitarEnvValues([PARQUEADA]);
  return { propia: true, guardada: true, pista: pistaDe(apagada) };
}

/** Apagar la suya: se aparca y vuelve a heredar la de la casa, sin perderla. */
export function apagarClaveDelCliente(): ClaveDelCliente {
  const encendida = delArchivo('OPENAI_API_KEY');
  if (encendida) setEnvValues({ [PARQUEADA]: encendida });
  // 🪤 Borrar la línea, no vaciarla: una cadena vacía está definida y cortaría la herencia de la de la casa.
  quitarEnvValues(['OPENAI_API_KEY']);
  return { propia: false, guardada: Boolean(encendida || delArchivo(PARQUEADA)), pista: pistaDe(encendida || env.openaiApiKey) };
}

/**
 * Guarda la clave de este cliente, después de comprobar que sirve.
 *
 * 🪤 Se prueba contra OpenAI ANTES de escribirla. Una clave mal copiada, caducada o sin saldo se guarda igual de
 * bien que una buena y no se nota hasta que un cliente escribe —o hasta que uno está enseñando el producto
 * delante de gente—. Treinta segundos de comprobación aquí valen más que cualquier mensaje de error de allá.
 */
export async function ponerClaveDelCliente(clave: string): Promise<ClaveDelCliente> {
  const k = clave.trim();
  if (!k.startsWith('sk-')) throw new Error('una clave de OpenAI empieza por "sk-"');
  if (/[\s#"']/.test(k)) throw new Error('esa clave lleva espacios o comillas: cópiala otra vez');
  let r: Response;
  try {
    r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new Error('no pude hablar con OpenAI para comprobarla. Mira la conexión y vuelve a intentar.');
  }
  if (r.status === 401) throw new Error('OpenAI dice que esa clave no vale');
  if (r.status === 429) throw new Error('la clave es válida pero no tiene saldo: cárgale antes de usarla');
  if (!r.ok) throw new Error(`OpenAI contestó ${r.status} al comprobarla`);
  setEnvValues({ OPENAI_API_KEY: k });
  quitarEnvValues([PARQUEADA]); // si había una aparcada, la nueva la reemplaza: dos claves guardadas confunden
  return { propia: true, guardada: true, pista: pistaDe(k) };
}

/** Olvidarla del todo: ni encendida ni aparcada. */
export function quitarClaveDelCliente(): ClaveDelCliente {
  quitarEnvValues(['OPENAI_API_KEY', PARQUEADA]);
  return { propia: false, guardada: false, pista: pistaDe(env.openaiApiKey) };
}
