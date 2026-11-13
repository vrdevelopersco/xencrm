/**
 * El modo agéntico: el modelo puede pedir herramientas, y el código decide si existen, si los argumentos sirven, si
 * quien está detrás puede hacerlo, y las ejecuta. Lo usan dos agentes con la misma maquinaria:
 *
 *   - **con los clientes** (agentico/cliente.ts): el asistente de WhatsApp y el chat del sitio consulta los tickets,
 *     las citas y los mantenimientos de ESE cliente, abre un ticket o pasa a una persona;
 *   - **con el equipo** (agentico/equipo.ts): el copiloto del tablero consulta el CRM y prepara acciones.
 *
 * Las reglas de la casa (docs/modo-agentico.md):
 *   1. **El contexto lo pone el código.** El cliente de cada herramienta del lado del cliente es el de la
 *      conversación (`ctx.userId`); el modelo ni siquiera tiene un argumento para pedir otro.
 *   2. **Tres efectos.** `lectura` consulta; `seguro` hace algo reversible y de bajo riesgo (abrir un ticket, anotar,
 *      pasar a una persona); `propuesto` NO se hace: queda para que alguien del equipo lo apruebe con un clic. Una
 *      herramienta propuesta no tiene con qué ejecutar (no tiene `ejecutar`, solo `proponer`): no es una promesa del
 *      prompt, es el tipo.
 *   3. **Los permisos son los del tablero.** Cada herramienta del equipo dice qué ruta de la API hace lo mismo, y el
 *      candado del modo fácil (channels/candado.ts) decide con esa ruta, igual que si la persona tocara el botón.
 *   4. **Acotado.** Pasos por turno (`agentico.pasos`) y tope de gasto por turno (`agentico.topeTurnoUsd`), además
 *      del tope del mes. Lo mismo dos veces en un turno no se hace dos veces.
 *   5. **Todo queda dicho.** Cada llamada, con lo que pidió, si sirvió y qué devolvió, va en el informe del turno;
 *      lo que devolvieron las herramientas es la evidencia contra la que se mide la respuesta (las guardas).
 */
import { z } from 'zod';
import { conversarConHerramientas, type Engine, type Role } from '../llm/engines.js';
import type { DefHerramienta, Llamada, Paso } from '../llm/herramientas.js';
import { regla } from '../reglas.js';
import { getSetting, setSetting } from '../crm/settings.js';
import { frenoDelCandado } from '../channels/candado.js';

export type Lado = 'cliente' | 'equipo';
export type Efecto = 'lectura' | 'seguro' | 'propuesto';

export interface Contexto {
  lado: Lado;
  /** Con un cliente: su conversación. La pone el código, nunca el modelo. */
  userId?: string;
  /** Quién queda en la historia: «Xen» con un cliente; «Laura (con Xen)» en el tablero. */
  por: string;
  /** En el tablero: el rol de quien pregunta y el modo del tablero, para el candado. */
  rol?: string;
  modo?: 'facil' | 'completo';
  now: number;
}

/** Una ruta de la API del tablero, sin `/admin/api/` delante: «contacts/wa:57…/notas». */
export interface Ruta {
  metodo: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  ruta: string;
  cuerpo?: unknown;
}

/** Algo para abrir desde la respuesta: una ficha, un ticket, una cita. */
export interface Enlace {
  tipo: 'contacto' | 'ticket' | 'cita';
  id: string;
  nombre: string;
}

/** Lo que una herramienta hizo de verdad (seguro): sale en el informe y en el tablero como «hecho». */
export interface Hecho {
  herramienta: string;
  resumen: string;
  enlace?: Enlace;
}

/** Lo que una herramienta dejó para aprobar: la ruta exacta que la hace, armada por el código. */
export interface Propuesta {
  id: string;
  herramienta: string;
  resumen: string;
  ruta: Ruta;
}

export interface Resultado {
  /** Lo que se le devuelve al modelo (va a JSON, recortado). */
  datos: unknown;
  hecho?: Hecho;
  enlaces?: Enlace[];
  /** Termina el turno aquí: el asistente no redacta, lo sigue otro (el flujo de citas, una persona). */
  termina?: 'cita' | 'persona';
}

interface Base<A> {
  nombre: string;
  /** Para el modelo: qué hace y cuándo usarla. */
  descripcion: string;
  lado: Lado;
  args: z.ZodType<A>;
  /** En el tablero: la ruta de la API que hace lo mismo, para el candado (y, si es propuesta, para aprobarla). */
  ruta?: (a: A, ctx: Contexto) => Ruta;
}
export type Herramienta<A = any> =
  | (Base<A> & { efecto: 'lectura' | 'seguro'; ejecutar: (a: A, ctx: Contexto) => Resultado | Promise<Resultado> })
  | (Base<A> & { efecto: 'propuesto'; ruta: (a: A, ctx: Contexto) => Ruta; proponer: (a: A, ctx: Contexto) => { resumen: string; enlace?: Enlace } });

export function definicion(h: Herramienta): DefHerramienta {
  const esquema = z.toJSONSchema(h.args) as Record<string, unknown>;
  delete esquema.$schema;
  return { nombre: h.nombre, descripcion: h.descripcion, parametros: esquema };
}

// ---------- interruptores (Configuración › Agente) ----------
/** Con los clientes: apagado de fábrica. Cambia lo que le pasa a un cliente: lo prende quien paga, sabiendo. */
export const agenticoConClientes = (): boolean => getSetting('agentico.clientes', false);
/** El copiloto del equipo: prendido de fábrica. Solo gasta cuando alguien le pregunta. */
export const copilotoEncendido = (): boolean => getSetting('agentico.equipo', true);
export function ponerAgentico(cambios: { clientes?: boolean; equipo?: boolean }): void {
  if (typeof cambios.clientes === 'boolean') setSetting('agentico.clientes', cambios.clientes);
  if (typeof cambios.equipo === 'boolean') setSetting('agentico.equipo', cambios.equipo);
}

// ---------- el bucle ----------
export interface LlamadaDelInforme {
  nombre: string;
  args: unknown;
  ok: boolean;
  /** Lo que se le devolvió al modelo, recortado para el registro. */
  respuesta: string;
}

export interface Informe {
  texto: string;
  motor: Engine;
  pasos: number;
  costoUsd: number;
  /** Por qué no terminó solo: 'pasos' o 'costo'. Vacío si contestó. */
  agotado: '' | 'pasos' | 'costo';
  llamadas: LlamadaDelInforme[];
  hechos: Hecho[];
  propuestas: Propuesta[];
  enlaces: Enlace[];
  /** Lo que devolvieron las herramientas: lo que respalda la respuesta. */
  evidencia: string[];
  termina?: 'cita' | 'persona';
}

/** Lo que salió de atender una llamada: lo que se le devuelve al modelo y lo que pasó. */
export interface Ejecucion {
  contenido: string;
  error: boolean;
  hecho?: Hecho;
  propuesta?: Omit<Propuesta, 'id'>;
  enlaces?: Enlace[];
  termina?: 'cita' | 'persona';
}

/**
 * Atiende UNA llamada a una herramienta: que exista para este lado, que los datos sirvan, que el candado la deje, y
 * que no se repita lo que ya se hizo en este turno (`yaHechas`). La usan el bucle de texto (`correr`) y la voz
 * (voz/llamada.ts), que recibe las llamadas del modelo por su cuenta: las mismas reglas por los dos caminos.
 */
export async function ejecutarUna(porNombre: Map<string, Herramienta>, nombre: string, args: unknown, ctx: Contexto, yaHechas: Map<string, string> = new Map()): Promise<Ejecucion> {
  const mal = (contenido: string): Ejecucion => ({ contenido, error: true });
  const h = porNombre.get(nombre);
  if (!h || h.lado !== ctx.lado) return mal(`No existe la herramienta «${nombre}». Usa solo las que tienes.`);
  const a = h.args.safeParse(args ?? {});
  if (!a.success) return mal(`Los datos no sirven: ${z.prettifyError(a.error).replace(/\s+/g, ' ')}`);
  if (ctx.lado === 'equipo' && h.ruta) {
    const r = h.ruta(a.data, ctx);
    const freno = frenoDelCandado(r.ruta, r.metodo, ctx.rol, ctx.modo ?? 'completo');
    if (freno) return mal(`No se puede: ${freno}.`);
  }
  // Lo mismo dos veces en un turno no se hace dos veces (un reintento del modelo, una llamada repetida).
  const clave = `${h.nombre}:${JSON.stringify(a.data)}`;
  if (h.efecto !== 'lectura' && yaHechas.has(clave)) return { contenido: yaHechas.get(clave)!, error: false };
  const out: Ejecucion = { contenido: '', error: false };
  if (h.efecto === 'propuesto') {
    const p = h.proponer(a.data, ctx);
    out.propuesta = { herramienta: h.nombre, resumen: p.resumen, ruta: h.ruta(a.data, ctx) };
    if (p.enlace) out.enlaces = [p.enlace];
    out.contenido = JSON.stringify({ propuesto: true, resumen: p.resumen, nota: 'No está hecho: queda para que alguien del equipo lo apruebe con un clic. Dilo así.' });
  } else {
    let r: Resultado;
    try {
      r = await h.ejecutar(a.data, ctx);
    } catch (err) {
      return mal(`No se pudo: ${(err as Error).message}`);
    }
    if (r.hecho) out.hecho = r.hecho;
    if (r.enlaces) out.enlaces = r.enlaces;
    if (r.termina) out.termina = r.termina;
    out.contenido = recortar(JSON.stringify(r.datos ?? null));
  }
  if (h.efecto !== 'lectura') yaHechas.set(clave, out.contenido);
  return out;
}

export interface Corrida {
  motor: Engine;
  role?: Role;
  sistema: string;
  /** La conversación hasta este turno, terminando en el mensaje que se atiende. */
  pasos: Paso[];
  herramientas: Herramienta[];
  ctx: Contexto;
  task: 'agente' | 'copiloto';
  maxTokens?: number;
  limites?: { pasos?: number; topeUsd?: number };
}

const TOPE_RESPUESTA = 6000;
const recortar = (s: string, n = TOPE_RESPUESTA) => (s.length > n ? `${s.slice(0, n)}… (recortado)` : s);

export async function correr(c: Corrida): Promise<Informe> {
  const limPasos = c.limites?.pasos ?? regla<number>('agentico.pasos');
  const limUsd = c.limites?.topeUsd ?? regla<number>('agentico.topeTurnoUsd');
  const propias = c.herramientas.filter((h) => h.lado === c.ctx.lado);
  const porNombre = new Map(propias.map((h) => [h.nombre, h]));
  const defs = propias.map(definicion);
  const pasos = [...c.pasos];
  const inf: Informe = { texto: '', motor: c.motor, pasos: 0, costoUsd: 0, agotado: '', llamadas: [], hechos: [], propuestas: [], enlaces: [], evidencia: [] };
  const yaHechas = new Map<string, string>();

  const atender = async (l: Llamada): Promise<{ contenido: string; error: boolean }> => {
    const r = await ejecutarUna(porNombre, l.nombre, l.args, c.ctx, yaHechas);
    if (r.hecho) inf.hechos.push(r.hecho);
    if (r.propuesta) inf.propuestas.push({ id: `p${inf.propuestas.length + 1}`, ...r.propuesta });
    if (r.enlaces) inf.enlaces.push(...r.enlaces);
    if (r.termina) inf.termina = r.termina;
    return { contenido: r.contenido, error: r.error };
  };

  for (let vuelta = 0; ; vuelta++) {
    // Sin más pasos o sin presupuesto: una última vuelta sin herramientas, para que conteste con lo que ya sabe.
    const sinMas = vuelta >= limPasos || inf.costoUsd >= limUsd;
    if (sinMas) inf.agotado = vuelta >= limPasos ? 'pasos' : 'costo';
    const r = await conversarConHerramientas(c.motor, {
      sistema: c.sistema,
      pasos,
      herramientas: defs,
      sinHerramientas: sinMas,
      role: c.role,
      maxTokens: c.maxTokens,
      usage: { task: c.task, userId: c.ctx.userId },
    });
    inf.pasos++;
    inf.costoUsd += r.costoUsd ?? 0;
    if (!r.llamadas.length || sinMas) {
      inf.texto = r.texto;
      return inf;
    }
    pasos.push({ rol: 'asistente', texto: r.texto, llamadas: r.llamadas });
    const resultados: { id: string; contenido: string; error?: boolean }[] = [];
    for (const l of r.llamadas) {
      const { contenido, error } = await atender(l);
      resultados.push({ id: l.id, contenido, ...(error ? { error } : {}) });
      inf.llamadas.push({ nombre: l.nombre, args: l.args, ok: !error, respuesta: recortar(contenido, 400) });
      if (!error) inf.evidencia.push(contenido);
    }
    pasos.push({ rol: 'resultados', resultados });
    // El flujo de citas o una persona toman la conversación: el asistente no redacta nada más.
    if (inf.termina) return inf;
  }
}
