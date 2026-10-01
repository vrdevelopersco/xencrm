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
import { setEnvValues } from './envfile.js';
import { ENGINES, ROLES, engineStatus, probarMotor, type Engine, type Role } from './llm/engines.js';

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
  heavy: 'Lo que pide precisión: tipo de prenda, color, medidas, detalles, recomendar.',
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
  /** Si hay quien lo vuelva a levantar: sin eso, reiniciar deja al cliente sin atender a nadie. */
  puedeReiniciarse: boolean;
}

const ESFUERZOS = ['', 'none', 'minimal', 'low', 'medium', 'high'];

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
      esfuerzo: env.openaiRoleEffort[rol],
    })),
    disponibles: engineStatus(),
    modeloGeneral: env.openaiModel,
    puedeReiniciarse: Boolean(process.env.AIVA_SUPERVISADO || process.env.pm_id),
  };
}

export interface CambioMotores {
  reparto?: 'router' | Engine;
  roles?: { rol: Role; motor?: Engine; modelo?: string; esfuerzo?: string }[];
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
export async function guardarMotores(cambio: CambioMotores, sondeo: Sondeo = probarMotor): Promise<{ motores: Motores; hayQueReiniciar: boolean }> {
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
    if (!ENGINES.includes(motor)) throw new Error(`"${motor}" no es un motor que yo conozca`);
    if (!sondeado.has(motor)) sondeado.set(motor, await sondeo(motor));
    const e = sondeado.get(motor)!;
    if (!e.available) throw new Error(`${donde}: ${motor} no responde aquí${e.reason ? ` (${e.reason})` : ''}. No lo guardo: dejaría al cliente sin contestar.`);
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
