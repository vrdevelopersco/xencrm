// Los tickets de soporte y su SLA (Servicio › Tickets y Servicio › SLA), como los casos y los SLA de Dynamics 365
// Customer Service. Un ticket es algo que un cliente reportó y que se le debe resolver en el tiempo de su plan.
//
// 🪤 NADA DEL NEGOCIO VA FIJO AQUÍ. Los planes, las prioridades, los tipos, los estados (cuáles cierran, cuáles
// pausan el reloj), los objetivos por plan × prioridad, el horario de soporte, el umbral de «en riesgo», la regla de
// la primera respuesta, el campo de la ficha donde vive el plan y quién puede hacer qué salen de la configuración,
// en tres capas; manda la última que tenga valor:
//
//   1. los valores de fábrica (FABRICA, aquí abajo);
//   2. lo que trae el cliente en xencrm.config.json › servicio.sla (esquema en src/config.ts);
//   3. lo que se cambia desde el tablero (Configuración › SLA y tickets): las estructuras en el ajuste `sla.config`,
//      y los parámetros sueltos (REGLAS_SLA) cada uno en `reglas.<id>`.
//
// Las reglas que cambian lo que dicen los números (sus valores de fábrica):
//
//  1. **Sin plan no hay SLA** (configurable: `sinPlan` puede ser un plan). Un cliente sin plan se atiende igual,
//     pero su ticket no cuenta como cumplido ni incumplido: inventarle un plan inflaría o hundiría el cumplimiento.
//  2. 🪤 **El reloj hábil se para fuera del horario de soporte**, como en crm/tiempos.ts. Un ticket del viernes a las
//     6 p. m. con 4 horas hábiles vence el lunes, no el sábado. Los objetivos 24/7 corren siempre.
//  3. 🪤 **Los estados que pausan** (de fábrica, «Esperando al cliente») paran el reloj de la solución, no el de la
//     primera respuesta: mientras la pelota está en el lado del cliente, el tiempo no es del equipo. La pausa se mide
//     en el mismo reloj del objetivo (hábil o 24/7) y se suma al vencimiento.
//  4. **La primera respuesta** es lo primero que pase, después de abrir el ticket, de lo que esté encendido: un
//     mensaje del equipo en la conversación (no del agente de IA: «ya lo reporté» no es atenderlo), marcarla a mano,
//     o cerrarlo. Se calcula cada vez desde lo guardado: no hay que acordarse de marcar nada para que cuente.
//  5. **En riesgo** es haber gastado el umbral (75 % de fábrica) o más sin cumplir. Incumplido, pasarse.
import { business } from '../config.js';
import { getDb } from '../rag/store.js';
import { addEvent, getContact, listEvents, type Contact } from './contacts.js';
import { emitEvent } from './events.js';
import { getSetting, setSetting } from './settings.js';
import { msHabiles, sumarHabiles } from './tiempos.js';

const MIN = 60_000;
const DIA = 86400_000;

// ---------- La configuración ----------

export type Reloj = 'habil' | 'corrido';
export type Permiso = 'equipo' | 'admins' | 'quien_administra';
/** Los tonos con que se pinta una prioridad: los colores de dato de la piel (nunca el acento). */
export const TONOS = ['rojo', 'ambar', 'cielo', 'indigo', 'verde', 'neutro'] as const;
export type Tono = (typeof TONOS)[number];

export interface PlanCfg { id: string; nombre: string; alias: string[] }
export interface PrioridadCfg { id: string; nombre: string; tono: Tono }
export interface TipoCfg { id: string; nombre: string }
export interface EstadoCfg { id: string; nombre: string; cierra: boolean; pausa: boolean }
export interface Objetivo {
  /** Minutos para la primera respuesta. */
  respuestaMin: number;
  /** Minutos para la solución (sin contar las pausas). */
  solucionMin: number;
  reloj: Reloj;
}
export interface ConfigSla {
  /** El dato de la ficha donde vive el plan de soporte. */
  campoPlan: string;
  /** El dato de la ficha con el producto (para llenar el ticket nuevo). */
  campoProducto: string;
  planes: PlanCfg[];
  /** '' = un cliente sin plan no tiene SLA; o el id del plan con que se le mide. */
  sinPlan: string;
  /** En orden, de la más grave a la más leve. */
  prioridades: PrioridadCfg[];
  prioridadDeFabrica: string;
  tipos: TipoCfg[];
  tipoDeFabrica: string;
  /** En orden; el primero que no cierra ni pausa es el de un ticket nuevo. */
  estados: EstadoCfg[];
  /** El horario de soporte: el reloj hábil solo corre aquí. */
  horario: { dias: number[]; desde: string; hasta: string };
  /** objetivos[plan][prioridad]. */
  objetivos: Record<string, Record<string, Objetivo>>;
  /** El porcentaje del tiempo gastado a partir del cual un ticket está «en riesgo». */
  riesgoPct: number;
  /** Qué cuenta como primera respuesta (lo primero que pase de lo encendido). */
  primeraRespuesta: { delEquipo: boolean; aMano: boolean; alResolver: boolean };
  /** Quién puede abrir tickets, moverlos (estado, prioridad, asignado) y cambiar esta configuración. */
  permisos: { crear: Permiso; mover: Permiso; politicas: Permiso };
}

const h = (n: number) => n * 60;
/** Una jornada de soporte de fábrica: de 8:00 a 18:00 son diez horas. */
const JORNADA = h(10);
const o = (respuestaMin: number, solucionMin: number, reloj: Reloj = 'habil'): Objetivo => ({ respuestaMin, solucionMin, reloj });

/**
 * Los de fábrica: los de examples/xentris/knowledge/soporte-y-sla.md (primera respuesta 8 h · 4 h · 1 h 24/7; un
 * crítico en 3 días · 1 día · 8 h). Lo que esa tabla no dice (alta, media, baja) va escalonado y se ajusta en
 * Configuración › SLA y tickets.
 */
export const FABRICA: ConfigSla = {
  campoPlan: 'plan_soporte',
  campoProducto: 'producto',
  planes: [
    { id: 'enterprise', nombre: 'Enterprise', alias: ['empresarial'] },
    { id: 'pro', nombre: 'Pro', alias: ['profesional'] },
    { id: 'basico', nombre: 'Básico', alias: ['basic'] },
  ],
  sinPlan: '',
  prioridades: [
    { id: 'critica', nombre: 'Crítica', tono: 'rojo' },
    { id: 'alta', nombre: 'Alta', tono: 'ambar' },
    { id: 'media', nombre: 'Media', tono: 'cielo' },
    { id: 'baja', nombre: 'Baja', tono: 'neutro' },
  ],
  prioridadDeFabrica: 'media',
  tipos: [
    { id: 'incidente', nombre: 'Incidente' },
    { id: 'solicitud', nombre: 'Solicitud' },
    { id: 'actualizacion', nombre: 'Actualización' },
    { id: 'mantenimiento', nombre: 'Mantenimiento' },
  ],
  tipoDeFabrica: 'incidente',
  estados: [
    { id: 'abierto', nombre: 'Abierto', cierra: false, pausa: false },
    { id: 'en_progreso', nombre: 'En progreso', cierra: false, pausa: false },
    { id: 'esperando_cliente', nombre: 'Esperando al cliente', cierra: false, pausa: true },
    { id: 'resuelto', nombre: 'Resuelto', cierra: true, pausa: false },
    { id: 'cerrado', nombre: 'Cerrado', cierra: true, pausa: false },
  ],
  horario: { dias: [1, 2, 3, 4, 5], desde: '08:00', hasta: '18:00' },
  objetivos: {
    basico: { critica: o(h(8), 3 * JORNADA), alta: o(h(8), 5 * JORNADA), media: o(h(8), 10 * JORNADA), baja: o(h(16), 20 * JORNADA) },
    pro: { critica: o(h(4), JORNADA), alta: o(h(4), 2 * JORNADA), media: o(h(4), 5 * JORNADA), baja: o(h(8), 10 * JORNADA) },
    enterprise: { critica: o(60, h(8), 'corrido'), alta: o(h(2), JORNADA), media: o(h(4), 3 * JORNADA), baja: o(h(8), 5 * JORNADA) },
  },
  riesgoPct: 75,
  primeraRespuesta: { delEquipo: true, aMano: true, alResolver: true },
  permisos: { crear: 'equipo', mover: 'equipo', politicas: 'quien_administra' },
};

/**
 * Los parámetros sueltos (umbrales, sí/no, números, textos): cada uno se lee del ajuste `reglas.<id>` (la capa del
 * tablero) y se conecta al registro común de reglas. `ruta` es dónde va dentro de ConfigSla.
 */
export interface Regla {
  id: string;
  grupo: string;
  etiqueta: string;
  ayuda: string;
  tipo: 'numero' | 'texto' | 'si-no' | 'opciones' | 'lista';
  unidad?: string;
  min?: number;
  max?: number;
  defecto: unknown;
  opciones?: { valor: string; etiqueta: string }[];
  /** Interno: dónde va en ConfigSla. */
  ruta: string[];
}
const PERMISOS_OPC = [
  { valor: 'equipo', etiqueta: 'Todo el equipo' },
  { valor: 'admins', etiqueta: 'Los administradores del negocio y quien administra XENCRM' },
  { valor: 'quien_administra', etiqueta: 'Solo quien administra XENCRM' },
];
/** La lista de reglas sueltas, con las opciones que dependen de la configuración de este momento (planes, tipos…). */
export function reglasSla(cfg: ConfigSla = configSla()): Regla[] {
  return [
    { id: 'sla.riesgoPct', grupo: 'SLA', etiqueta: 'En riesgo a partir de', ayuda: 'El porcentaje del tiempo gastado a partir del cual un ticket sale «En riesgo».', tipo: 'numero', unidad: '%', min: 1, max: 99, defecto: FABRICA.riesgoPct, ruta: ['riesgoPct'] },
    { id: 'sla.primeraRespuesta.delEquipo', grupo: 'SLA', etiqueta: 'Cuenta como primera respuesta: un mensaje del equipo', ayuda: 'El primer mensaje de una persona del equipo en la conversación, después de abrir el ticket (el agente de IA no cuenta).', tipo: 'si-no', defecto: true, ruta: ['primeraRespuesta', 'delEquipo'] },
    { id: 'sla.primeraRespuesta.aMano', grupo: 'SLA', etiqueta: 'Cuenta como primera respuesta: marcarla a mano', ayuda: 'El botón «Marcar como respondido» del ticket (una llamada, un correo).', tipo: 'si-no', defecto: true, ruta: ['primeraRespuesta', 'aMano'] },
    { id: 'sla.primeraRespuesta.alResolver', grupo: 'SLA', etiqueta: 'Cuenta como primera respuesta: cerrarlo', ayuda: 'Si se resuelve sin haber contestado antes, el cierre cuenta como respuesta.', tipo: 'si-no', defecto: true, ruta: ['primeraRespuesta', 'alResolver'] },
    { id: 'sla.sinPlan', grupo: 'SLA', etiqueta: 'Un cliente sin plan', ayuda: 'Si no tiene plan en su ficha: sin SLA (no cuenta en el cumplimiento) o medido como uno de los planes.', tipo: 'opciones', defecto: FABRICA.sinPlan, opciones: [{ valor: '', etiqueta: 'No tiene SLA' }, ...cfg.planes.map((p) => ({ valor: p.id, etiqueta: `Se mide como ${p.nombre}` }))], ruta: ['sinPlan'] },
    { id: 'sla.prioridadDeFabrica', grupo: 'Tickets', etiqueta: 'Prioridad de un ticket nuevo', ayuda: 'La que trae el formulario al abrir un ticket.', tipo: 'opciones', defecto: FABRICA.prioridadDeFabrica, opciones: cfg.prioridades.map((p) => ({ valor: p.id, etiqueta: p.nombre })), ruta: ['prioridadDeFabrica'] },
    { id: 'sla.tipoDeFabrica', grupo: 'Tickets', etiqueta: 'Tipo de un ticket nuevo', ayuda: 'El que trae el formulario al abrir un ticket.', tipo: 'opciones', defecto: FABRICA.tipoDeFabrica, opciones: cfg.tipos.map((t) => ({ valor: t.id, etiqueta: t.nombre })), ruta: ['tipoDeFabrica'] },
    { id: 'sla.campoPlan', grupo: 'Tickets', etiqueta: 'Dato de la ficha con el plan de soporte', ayuda: 'El nombre del dato captado donde vive el plan de cada cliente (de fábrica, plan_soporte).', tipo: 'texto', defecto: FABRICA.campoPlan, ruta: ['campoPlan'] },
    { id: 'sla.campoProducto', grupo: 'Tickets', etiqueta: 'Dato de la ficha con el producto', ayuda: 'Con él se llena el producto de un ticket nuevo (de fábrica, producto).', tipo: 'texto', defecto: FABRICA.campoProducto, ruta: ['campoProducto'] },
    { id: 'sla.horario.dias', grupo: 'SLA', etiqueta: 'Días de soporte', ayuda: 'Los días en que corre el reloj hábil (0 es domingo, 1 lunes… 6 sábado).', tipo: 'lista', defecto: FABRICA.horario.dias, opciones: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'].map((d, i) => ({ valor: String(i), etiqueta: d })), ruta: ['horario', 'dias'] },
    { id: 'sla.horario.desde', grupo: 'SLA', etiqueta: 'El soporte empieza a las', ayuda: 'Hora en que empieza a correr el reloj hábil (24 h, como 08:00).', tipo: 'texto', defecto: FABRICA.horario.desde, ruta: ['horario', 'desde'] },
    { id: 'sla.horario.hasta', grupo: 'SLA', etiqueta: 'El soporte termina a las', ayuda: 'Hora en que se para el reloj hábil (24 h, como 18:00).', tipo: 'texto', defecto: FABRICA.horario.hasta, ruta: ['horario', 'hasta'] },
    { id: 'sla.permisos.crear', grupo: 'Tickets', etiqueta: 'Quién puede abrir tickets', ayuda: 'Desde Tickets, la conversación o la ficha.', tipo: 'opciones', defecto: FABRICA.permisos.crear, opciones: PERMISOS_OPC, ruta: ['permisos', 'crear'] },
    { id: 'sla.permisos.mover', grupo: 'Tickets', etiqueta: 'Quién puede moverlos', ayuda: 'Cambiar estado, prioridad, asignado o marcar la primera respuesta.', tipo: 'opciones', defecto: FABRICA.permisos.mover, opciones: PERMISOS_OPC, ruta: ['permisos', 'mover'] },
    { id: 'sla.permisos.politicas', grupo: 'SLA', etiqueta: 'Quién puede cambiar esta configuración', ayuda: 'Planes, prioridades, tipos, estados, objetivos y estas reglas.', tipo: 'opciones', defecto: FABRICA.permisos.politicas, opciones: PERMISOS_OPC, ruta: ['permisos', 'politicas'] },
  ];
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const aMinutos = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
/** Un año: más que eso no es un plazo, es un error al escribirlo. */
const TOPE_MIN = 365 * 24 * 60;
const copia = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const esObj = (x: unknown): x is Record<string, unknown> => Boolean(x) && typeof x === 'object' && !Array.isArray(x);
/** «Plan Pro», «Esperando al cliente» → «plan_pro», «esperando_al_cliente»: el id que se le da a lo nuevo. */
export const idDe = (nombre: string) =>
  nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30);
const textoCorto = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Mezcla una capa sobre lo que hay: las listas se reemplazan enteras, los objetivos se mezclan plan por plan y
 * prioridad por prioridad, lo demás valor por valor. Lo que la capa no trae (o trae vacío) no toca nada.
 */
function mezclar(base: ConfigSla, capa: unknown): ConfigSla {
  if (!esObj(capa)) return base;
  const c = copia(base);
  for (const k of ['campoPlan', 'campoProducto', 'sinPlan', 'prioridadDeFabrica', 'tipoDeFabrica'] as const) if (typeof capa[k] === 'string') c[k] = capa[k] as string;
  if (typeof capa.riesgoPct === 'number') c.riesgoPct = capa.riesgoPct;
  for (const k of ['planes', 'prioridades', 'tipos', 'estados'] as const) if (Array.isArray(capa[k]) && (capa[k] as unknown[]).length) (c as unknown as Record<string, unknown>)[k] = copia(capa[k]);
  if (esObj(capa.horario)) for (const k of ['dias', 'desde', 'hasta'] as const) if (capa.horario[k] !== undefined) (c.horario as Record<string, unknown>)[k] = copia(capa.horario[k]);
  for (const k of ['primeraRespuesta', 'permisos'] as const) if (esObj(capa[k])) Object.assign(c[k], copia(capa[k]));
  if (esObj(capa.objetivos))
    for (const [plan, porPrio] of Object.entries(capa.objetivos)) {
      if (!esObj(porPrio)) continue;
      c.objetivos[plan] ??= {};
      for (const [prio, ob] of Object.entries(porPrio)) if (esObj(ob)) c.objetivos[plan]![prio] = { ...(c.objetivos[plan]![prio] ?? o(h(8), 5 * JORNADA)), ...(ob as Partial<Objetivo>) };
    }
  return c;
}
function ponerEn(c: ConfigSla, ruta: string[], valor: unknown) {
  let x = c as unknown as Record<string, unknown>;
  for (const k of ruta.slice(0, -1)) x = x[k] as Record<string, unknown>;
  x[ruta[ruta.length - 1]!] = copia(valor);
}

/**
 * Revisa una configuración entera y dice el primer problema (con el campo, para marcarlo en la pantalla), o null.
 * Lo usa el tablero antes de guardar; la configuración resuelta pasa por `normalizar`, que nunca falla.
 */
export function problemaDe(c: ConfigSla): { error: string; campo: string } | null {
  const lista = (k: 'planes' | 'prioridades' | 'tipos' | 'estados', minimo: number, nombre: string) => {
    const xs = c[k] as { id: string; nombre: string }[];
    if (!Array.isArray(xs) || xs.length < minimo) return { error: `hace falta al menos ${minimo === 1 ? 'un' : minimo} ${nombre}`, campo: k };
    const vistos = new Set<string>();
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i]!;
      if (!x.id || !/^[a-z0-9_]{1,30}$/.test(x.id)) return { error: `${nombre} ${i + 1}: el identificador va en minúsculas, sin espacios`, campo: `${k}.${i}.id` };
      if (!textoCorto(x.nombre, 40)) return { error: `${nombre} ${i + 1}: falta el nombre`, campo: `${k}.${i}.nombre` };
      if (vistos.has(x.id)) return { error: `«${x.nombre}» está repetido`, campo: `${k}.${i}.nombre` };
      vistos.add(x.id);
    }
    return null;
  };
  const e = lista('planes', 1, 'plan') ?? lista('prioridades', 1, 'prioridad') ?? lista('tipos', 1, 'tipo') ?? lista('estados', 2, 'estado');
  if (e) return e;
  if (!c.estados.some((x) => x.cierra)) return { error: 'algún estado tiene que cerrar el ticket (Resuelto, por ejemplo)', campo: 'estados' };
  if (!c.estados.some((x) => !x.cierra && !x.pausa)) return { error: 'hace falta un estado abierto que no pause el reloj: el de un ticket nuevo', campo: 'estados' };
  if (c.estados.some((x) => x.cierra && x.pausa)) return { error: 'un estado que cierra no puede pausar', campo: 'estados' };
  if (!c.prioridades.some((p) => p.id === c.prioridadDeFabrica)) return { error: 'la prioridad de un ticket nuevo tiene que ser una de la lista', campo: 'prioridadDeFabrica' };
  if (!c.tipos.some((t) => t.id === c.tipoDeFabrica)) return { error: 'el tipo de un ticket nuevo tiene que ser uno de la lista', campo: 'tipoDeFabrica' };
  if (c.sinPlan && !c.planes.some((p) => p.id === c.sinPlan)) return { error: 'el plan de quien no tiene plan tiene que ser uno de la lista', campo: 'sinPlan' };
  if (!/^[a-zA-Z0-9_]{1,40}$/.test(c.campoPlan)) return { error: 'el dato del plan va como un nombre de dato (plan_soporte)', campo: 'campoPlan' };
  if (!/^[a-zA-Z0-9_]{1,40}$/.test(c.campoProducto)) return { error: 'el dato del producto va como un nombre de dato (producto)', campo: 'campoProducto' };
  if (!Array.isArray(c.horario.dias) || !c.horario.dias.length || c.horario.dias.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return { error: 'el soporte necesita al menos un día', campo: 'horario.dias' };
  if (!HHMM.test(c.horario.desde)) return { error: 'la hora de inicio va como 08:00', campo: 'horario.desde' };
  if (!HHMM.test(c.horario.hasta)) return { error: 'la hora de cierre va como 18:00', campo: 'horario.hasta' };
  if (aMinutos(c.horario.hasta) <= aMinutos(c.horario.desde)) return { error: 'el cierre tiene que ser después del inicio', campo: 'horario.hasta' };
  if (!(c.riesgoPct >= 1 && c.riesgoPct <= 99)) return { error: '«en riesgo» va entre 1 % y 99 %', campo: 'riesgoPct' };
  for (const p of ['crear', 'mover', 'politicas'] as const) if (!PERMISOS_OPC.some((x) => x.valor === c.permisos[p])) return { error: 'ese permiso no existe', campo: `permisos.${p}` };
  for (const pl of c.planes)
    for (const pr of c.prioridades) {
      const ob = c.objetivos[pl.id]?.[pr.id];
      const campo = `objetivos.${pl.id}.${pr.id}`;
      if (!ob) return { error: `${pl.nombre} · ${pr.nombre}: faltan sus tiempos`, campo };
      if (!(ob.respuestaMin > 0)) return { error: `${pl.nombre} · ${pr.nombre}: la primera respuesta tiene que ser un tiempo mayor que cero`, campo: `${campo}.respuestaMin` };
      if (!(ob.solucionMin > 0)) return { error: `${pl.nombre} · ${pr.nombre}: la solución tiene que ser un tiempo mayor que cero`, campo: `${campo}.solucionMin` };
      if (ob.respuestaMin > TOPE_MIN || ob.solucionMin > TOPE_MIN) return { error: `${pl.nombre} · ${pr.nombre}: más de un año no es un plazo`, campo };
      if (ob.solucionMin < ob.respuestaMin) return { error: `${pl.nombre} · ${pr.nombre}: la solución no puede ser antes que la primera respuesta`, campo: `${campo}.solucionMin` };
    }
  return null;
}

/**
 * Deja una configuración usable pase lo que pase (lo del archivo pudo venir a medias): limpia nombres, quita
 * repetidos, y lo que apunta a algo que no existe vuelve a algo que sí. Nunca falla.
 */
function normalizar(c: ConfigSla): ConfigSla {
  const limpiar = <T extends { id: string; nombre: string }>(xs: T[], respaldo: T[]): T[] => {
    const vistos = new Set<string>();
    const out = (Array.isArray(xs) ? xs : [])
      .map((x) => ({ ...x, id: idDe(String(x.id || x.nombre || '')), nombre: textoCorto(x.nombre, 40) }))
      .filter((x) => x.id && x.nombre && !vistos.has(x.id) && vistos.add(x.id));
    return out.length ? out : copia(respaldo);
  };
  c.planes = limpiar(c.planes, FABRICA.planes).map((p) => ({ ...p, alias: (Array.isArray(p.alias) ? p.alias : []).map((a) => textoCorto(a, 30)).filter(Boolean) }));
  c.prioridades = limpiar(c.prioridades, FABRICA.prioridades).map((p) => ({ ...p, tono: TONOS.includes(p.tono) ? p.tono : 'neutro' }));
  c.tipos = limpiar(c.tipos, FABRICA.tipos);
  c.estados = limpiar(c.estados, FABRICA.estados).map((e) => ({ ...e, cierra: Boolean(e.cierra), pausa: Boolean(e.pausa) && !e.cierra }));
  if (!c.estados.some((e) => e.cierra) || !c.estados.some((e) => !e.cierra && !e.pausa)) c.estados = copia(FABRICA.estados);
  if (!c.prioridades.some((p) => p.id === c.prioridadDeFabrica)) c.prioridadDeFabrica = c.prioridades[Math.floor(c.prioridades.length / 2)]!.id;
  if (!c.tipos.some((t) => t.id === c.tipoDeFabrica)) c.tipoDeFabrica = c.tipos[0]!.id;
  if (c.sinPlan && !c.planes.some((p) => p.id === c.sinPlan)) c.sinPlan = '';
  if (!/^[a-zA-Z0-9_]{1,40}$/.test(c.campoPlan)) c.campoPlan = FABRICA.campoPlan;
  if (!/^[a-zA-Z0-9_]{1,40}$/.test(c.campoProducto)) c.campoProducto = FABRICA.campoProducto;
  const dias = Array.isArray(c.horario.dias) ? [...new Set(c.horario.dias.map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort() : [];
  c.horario = HHMM.test(c.horario.desde) && HHMM.test(c.horario.hasta) && aMinutos(c.horario.hasta) > aMinutos(c.horario.desde) && dias.length ? { ...c.horario, dias } : copia(FABRICA.horario);
  c.riesgoPct = Number.isFinite(c.riesgoPct) ? Math.min(99, Math.max(1, Math.round(c.riesgoPct))) : FABRICA.riesgoPct;
  for (const p of ['crear', 'mover', 'politicas'] as const) if (!PERMISOS_OPC.some((x) => x.valor === c.permisos[p])) c.permisos[p] = FABRICA.permisos[p];
  for (const k of ['delEquipo', 'aMano', 'alResolver'] as const) c.primeraRespuesta[k] = c.primeraRespuesta[k] !== false;
  // Cada plan × prioridad tiene sus tiempos: lo que falte toma los de fábrica de la misma prioridad, o los de la del
  // medio. Un objetivo que no valida, igual.
  const objetivos: ConfigSla['objetivos'] = {};
  for (const pl of c.planes) {
    objetivos[pl.id] = {};
    for (const [i, pr] of c.prioridades.entries()) {
      const ob = c.objetivos[pl.id]?.[pr.id];
      const ok = ob && ob.respuestaMin > 0 && ob.solucionMin >= ob.respuestaMin && ob.solucionMin <= TOPE_MIN;
      const respaldo = FABRICA.objetivos[pl.id]?.[pr.id] ?? Object.values(FABRICA.objetivos.pro!)[Math.min(i, 3)]!;
      objetivos[pl.id]![pr.id] = ok ? { respuestaMin: Math.round(ob.respuestaMin), solucionMin: Math.round(ob.solucionMin), reloj: ob.reloj === 'corrido' ? 'corrido' : 'habil' } : copia(respaldo);
    }
  }
  c.objetivos = objetivos;
  return c;
}

/** La capa del archivo del cliente (xencrm.config.json › servicio.sla). */
const delArchivo = (): unknown => (business as { servicio?: { sla?: unknown } }).servicio?.sla ?? null;

/** De dónde sale cada parte de la configuración, para decirlo en la pantalla. */
export type Capa = 'fabrica' | 'archivo' | 'tablero';

/** La configuración que manda ahora: fábrica, encima el archivo, encima el tablero (estructuras y reglas sueltas). */
export function configSla(): ConfigSla {
  let c = mezclar(copia(FABRICA), delArchivo());
  c = mezclar(c, getSetting<unknown>('sla.config', null));
  for (const r of reglasSla(c)) {
    const v = getSetting<unknown>(`reglas.${r.id}`, undefined);
    if (v !== undefined && v !== null) ponerEn(c, r.ruta, v);
  }
  return normalizar(c);
}

/** De qué capa sale cada parte (la última que la trae). */
export function capasDe(): Record<string, Capa> {
  const archivo = delArchivo() as Record<string, unknown> | null;
  const tablero = getSetting<Record<string, unknown> | null>('sla.config', null);
  const out: Record<string, Capa> = {};
  for (const k of Object.keys(FABRICA)) out[k] = tablero && tablero[k] !== undefined ? 'tablero' : archivo && archivo[k] !== undefined ? 'archivo' : 'fabrica';
  for (const r of reglasSla(FABRICA)) {
    if (getSetting<unknown>(`reglas.${r.id}`, null) !== null) out[r.id] = 'tablero';
    else {
      let x: unknown = archivo;
      for (const k of r.ruta) x = esObj(x) ? x[k] : undefined;
      out[r.id] = x !== undefined ? 'archivo' : 'fabrica';
    }
  }
  return out;
}

/**
 * Guarda lo que llega del tablero. Las estructuras van a `sla.config`; los parámetros sueltos, cada uno a
 * `reglas.<id>`. Todo o nada: si algo no valida, no se guarda nada y se dice qué (con el campo, para marcarlo).
 */
export function guardarConfigSla(entrada: { estructura?: unknown; reglas?: Record<string, unknown> }): { config: ConfigSla } | { error: string; campo?: string } {
  const actual = configSla();
  let nueva = mezclar(actual, entrada.estructura);
  const reglas = reglasSla(nueva);
  const sueltas: Record<string, unknown> = {};
  for (const [id, v] of Object.entries(entrada.reglas ?? {})) {
    const r = reglas.find((x) => x.id === id);
    if (!r) return { error: `no existe la regla ${id}`, campo: id };
    const limpio = limpiarRegla(r, v);
    if ('error' in limpio) return { error: limpio.error, campo: id };
    sueltas[id] = limpio.valor;
    ponerEn(nueva, r.ruta, limpio.valor);
  }
  const p = problemaDe(nueva);
  if (p) return p;
  nueva = normalizar(nueva);
  if (entrada.estructura !== undefined) {
    const e = esObj(entrada.estructura) ? entrada.estructura : {};
    const guardar: Record<string, unknown> = {};
    for (const k of ['planes', 'prioridades', 'tipos', 'estados', 'objetivos'] as const) if (e[k] !== undefined) guardar[k] = nueva[k];
    if (Object.keys(guardar).length) setSetting('sla.config', { ...(getSetting<Record<string, unknown> | null>('sla.config', null) ?? {}), ...guardar });
  }
  for (const [id, v] of Object.entries(sueltas)) setSetting(`reglas.${id}`, v);
  return { config: configSla() };
}

/** Borra la capa del tablero: vuelve a lo del archivo, o a lo de fábrica si el archivo no dice nada. */
export function olvidarConfigDelTablero(): ConfigSla {
  const db = getDb();
  db.prepare("DELETE FROM settings WHERE key = 'sla.config' OR key LIKE 'reglas.sla.%'").run();
  return configSla();
}

/** Valida un parámetro suelto según su tipo. */
export function limpiarRegla(r: Regla, v: unknown): { valor: unknown } | { error: string } {
  switch (r.tipo) {
    case 'numero': {
      const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.').replace(/[^\d.-]/g, ''));
      if (!Number.isFinite(n)) return { error: `${r.etiqueta}: escribe un número` };
      if (r.min !== undefined && n < r.min) return { error: `${r.etiqueta}: el mínimo es ${r.min}${r.unidad ? ' ' + r.unidad : ''}` };
      if (r.max !== undefined && n > r.max) return { error: `${r.etiqueta}: el máximo es ${r.max}${r.unidad ? ' ' + r.unidad : ''}` };
      return { valor: n };
    }
    case 'si-no':
      if (typeof v === 'boolean') return { valor: v };
      if (v === 'si' || v === 'true') return { valor: true };
      if (v === 'no' || v === 'false') return { valor: false };
      return { error: `${r.etiqueta}: va sí o no` };
    case 'opciones': {
      const s = String(v ?? '');
      return r.opciones?.some((x) => x.valor === s) ? { valor: s } : { error: `${r.etiqueta}: esa opción no existe` };
    }
    case 'lista': {
      const xs = Array.isArray(v) ? v : String(v ?? '').split(',');
      const vals = [...new Set(xs.map((x) => String(x).trim()).filter(Boolean))];
      if (r.opciones && vals.some((x) => !r.opciones!.some((o2) => o2.valor === x))) return { error: `${r.etiqueta}: hay una opción que no existe` };
      if (!vals.length) return { error: `${r.etiqueta}: elige al menos una` };
      return { valor: r.id === 'sla.horario.dias' ? vals.map(Number).sort() : vals };
    }
    default: {
      const s = textoCorto(v, 80);
      return s ? { valor: s } : { error: `${r.etiqueta}: no puede quedar vacío` };
    }
  }
}

/** ¿Puede este rol hacer esto? El rol llega en x-xencrm-rol (lo pone la consola; sin él, es el token a secas). */
export function puede(permiso: Permiso, rol: string | undefined): boolean {
  if (!rol || rol === 'super') return true;
  if (permiso === 'equipo') return true;
  if (permiso === 'admins') return rol === 'admin';
  return false;
}

/** El horario de soporte en la forma que usa el reloj de crm/tiempos.ts. */
export function horarioDeSoporte(c = configSla()): { dias: number[]; franjas: [number, number][] } {
  return { dias: c.horario.dias, franjas: [[aMinutos(c.horario.desde), aMinutos(c.horario.hasta)]] };
}

/** Los minutos de una jornada de soporte (para decir «3 días hábiles» en vez de «1.800 min»). */
export const minutosDeJornada = (c = configSla()) => aMinutos(c.horario.hasta) - aMinutos(c.horario.desde);

// ---------- El plan de un cliente ----------

const llano = (v: unknown) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * El plan de una ficha, por su nombre, su id o un alias, como lo haya escrito quien sea («Pro», «plan básico»,
 * «ENTERPRISE»). Sin plan: el que diga `sinPlan`, o null (sin SLA).
 */
export function planDe(c: Pick<Contact, 'data'> | null | undefined, cfg = configSla()): string | null {
  const v = llano(c?.data?.[cfg.campoPlan]);
  if (v) {
    const palabras = ` ${v} `;
    // Primero el nombre más largo: «Pro Plus» antes que «Pro».
    const candidatos = cfg.planes
      .flatMap((p) => [p.nombre, p.id.replace(/_/g, ' '), ...p.alias].map((n) => ({ id: p.id, n: llano(n) })))
      .filter((x) => x.n)
      .sort((a, b) => b.n.length - a.n.length);
    const hallado = candidatos.find((x) => palabras.includes(` ${x.n} `));
    if (hallado) return hallado.id;
  }
  return cfg.sinPlan || null;
}

// ---------- El reloj de un ticket ----------

export type EstadoSla = 'cumplido' | 'incumplido' | 'en_riesgo' | 'a_tiempo' | 'en_pausa';

export interface RelojDeObjetivo {
  objetivoMin: number;
  reloj: Reloj;
  /** Cuándo vence (null mientras está en pausa: depende de cuándo vuelva). */
  vence: number | null;
  /** Cuándo se cumplió (respondió o resolvió); null si sigue corriendo. */
  hecho: number | null;
  /** Lo gastado del objetivo: 0,5 es la mitad; más de 1, pasado. */
  consumido: number;
  estado: EstadoSla;
}

interface Fila {
  id: number;
  user_id: string;
  asunto: string;
  tipo: string;
  prioridad: string;
  estado: string;
  producto: string;
  asignado: string | null;
  creado: number;
  creado_por: string;
  respondido: number | null;
  respondido_por: string | null;
  resuelto: number | null;
  cerrado: number | null;
  pausa_desde: number | null;
  pausa_ms: number;
  actualizado: number;
}

export interface Ticket {
  id: number;
  /** «TK-0012»: como se nombra en la conversación con el cliente. */
  codigo: string;
  contacto: { id: string; nombre: string | null; telefono: string | null };
  /** El id del plan (o null: sin SLA). */
  plan: string | null;
  asunto: string;
  tipo: string;
  prioridad: string;
  estado: string;
  producto: string;
  asignado: string | null;
  creado: number;
  creadoPor: string;
  /** La primera respuesta que cuenta (regla 4) y de dónde salió. */
  respondido: number | null;
  respondidoPor: string | null;
  respondidoComo: 'equipo' | 'a_mano' | 'al_resolver' | null;
  resuelto: number | null;
  /** Si su estado cierra el ticket. */
  terminado: boolean;
  /** Si su estado pausa el reloj de la solución. */
  enPausa: boolean;
  /** null: sin plan, sin SLA. */
  sla: {
    respuesta: RelojDeObjetivo;
    solucion: RelojDeObjetivo;
    /** El de este momento: incumplido si alguno se pasó; si no, el del objetivo que corre ahora. */
    estado: EstadoSla;
    /** Cuál corre ahora: la respuesta mientras no haya, y después la solución. null si ya terminó. */
    activo: 'respuesta' | 'solucion' | null;
  } | null;
}

export const codigoDe = (id: number) => `TK-${String(id).padStart(4, '0')}`;
const estadoCfg = (cfg: ConfigSla, id: string) => cfg.estados.find((e) => e.id === id) ?? null;
/** Una prioridad que ya no existe (se quitó de la configuración) se mide como la de fábrica. */
const prioridadParaMedir = (cfg: ConfigSla, id: string) => (cfg.prioridades.some((p) => p.id === id) ? id : cfg.prioridadDeFabrica);

/** El tiempo de un reloj entre dos instantes. */
function gastado(desde: number, hasta: number, reloj: Reloj, horario: ReturnType<typeof horarioDeSoporte>): number {
  if (hasta <= desde) return 0;
  return reloj === 'habil' ? msHabiles(desde, hasta, horario) : hasta - desde;
}
function vencimiento(desde: number, ms: number, reloj: Reloj, horario: ReturnType<typeof horarioDeSoporte>): number {
  return reloj === 'habil' ? sumarHabiles(desde, ms, horario) : desde + ms;
}

/** La primera respuesta del equipo en la conversación después de abrir el ticket (regla 4). */
function respuestaDelEquipo(userId: string, desde: number): { ts: number; por: string | null } | null {
  const r = getDb()
    .prepare("SELECT ts, by FROM messages WHERE user_id = ? AND role = 'assistant' AND author = 'human' AND ts >= ? ORDER BY ts LIMIT 1")
    .get(userId, desde) as { ts: number; by: string | null } | undefined;
  return r ? { ts: r.ts, por: r.by } : null;
}

/** Lo que hay que saber de un ticket para atenderlo, con su SLA calculado a `now`. */
export function vistaDe(f: Fila, now = Date.now(), cfg = configSla(), contacto?: Contact | null): Ticket {
  const c = contacto === undefined ? getContact(f.user_id) : contacto;
  const plan = planDe(c, cfg);
  const est = estadoCfg(cfg, f.estado);
  // Un estado que ya no existe en la configuración: si el ticket tiene fecha de cierre, cerrado; si no, abierto.
  const terminado = est ? est.cierra : Boolean(f.resuelto);
  const enPausa = Boolean(est?.pausa) && f.pausa_desde !== null;
  const reglas = cfg.primeraRespuesta;
  const candidatas: { ts: number; por: string | null; como: 'equipo' | 'a_mano' | 'al_resolver' }[] = [];
  if (reglas.aMano && f.respondido) candidatas.push({ ts: f.respondido, por: f.respondido_por, como: 'a_mano' });
  if (reglas.delEquipo) {
    const delEquipo = respuestaDelEquipo(f.user_id, f.creado);
    if (delEquipo) candidatas.push({ ts: delEquipo.ts, por: delEquipo.por, como: 'equipo' });
  }
  const fin = f.resuelto ?? f.cerrado;
  if (reglas.alResolver && fin && terminado) candidatas.push({ ts: fin, por: null, como: 'al_resolver' });
  candidatas.sort((a, b) => a.ts - b.ts);
  const primera = candidatas[0] ?? null;
  const umbral = cfg.riesgoPct / 100;

  let sla: Ticket['sla'] = null;
  if (plan && cfg.objetivos[plan]) {
    const obj = cfg.objetivos[plan]![prioridadParaMedir(cfg, f.prioridad)]!;
    const horario = horarioDeSoporte(cfg);
    // La primera respuesta: no se pausa.
    const msR = obj.respuestaMin * MIN;
    const venceR = vencimiento(f.creado, msR, obj.reloj, horario);
    const hechoR = primera?.ts ?? null;
    const usadoR = gastado(f.creado, hechoR ?? now, obj.reloj, horario);
    const respuesta: RelojDeObjetivo = {
      objetivoMin: obj.respuestaMin,
      reloj: obj.reloj,
      vence: venceR,
      hecho: hechoR,
      consumido: usadoR / msR,
      estado: hechoR ? (hechoR <= venceR ? 'cumplido' : 'incumplido') : now > venceR ? 'incumplido' : usadoR / msR >= umbral ? 'en_riesgo' : 'a_tiempo',
    };
    // La solución: sin contar lo que estuvo en un estado que pausa.
    const msS = obj.solucionMin * MIN;
    const pausa = f.pausa_ms + (enPausa ? gastado(f.pausa_desde!, now, obj.reloj, horario) : 0);
    const hechoS = terminado ? (fin ?? f.actualizado) : null;
    const usadoS = Math.max(0, gastado(f.creado, hechoS ?? (enPausa ? f.pausa_desde! : now), obj.reloj, horario) - (enPausa ? f.pausa_ms : pausa));
    const venceS = enPausa ? null : vencimiento(f.creado, msS + pausa, obj.reloj, horario);
    const solucion: RelojDeObjetivo = {
      objetivoMin: obj.solucionMin,
      reloj: obj.reloj,
      vence: venceS,
      hecho: hechoS,
      consumido: usadoS / msS,
      estado: hechoS
        ? usadoS <= msS ? 'cumplido' : 'incumplido'
        : enPausa ? (usadoS > msS ? 'incumplido' : 'en_pausa')
          : venceS !== null && now > venceS ? 'incumplido' : usadoS / msS >= umbral ? 'en_riesgo' : 'a_tiempo',
    };
    const activo = terminado ? null : hechoR ? 'solucion' : 'respuesta';
    const estadoGeneral: EstadoSla =
      respuesta.estado === 'incumplido' || solucion.estado === 'incumplido' ? 'incumplido'
        : terminado ? 'cumplido'
          : activo === 'respuesta' ? respuesta.estado : solucion.estado;
    sla = { respuesta, solucion, estado: estadoGeneral, activo };
  }
  return {
    id: f.id,
    codigo: codigoDe(f.id),
    contacto: { id: f.user_id, nombre: c?.name ?? null, telefono: c?.phone ?? null },
    plan,
    asunto: f.asunto,
    tipo: f.tipo,
    prioridad: f.prioridad,
    estado: f.estado,
    producto: f.producto,
    asignado: f.asignado,
    creado: f.creado,
    creadoPor: f.creado_por,
    respondido: primera?.ts ?? null,
    respondidoPor: primera?.por ?? null,
    respondidoComo: primera?.como ?? null,
    resuelto: terminado ? (fin ?? null) : null,
    terminado,
    enPausa,
    sla,
  };
}

// ---------- Leer ----------

const fila = (id: number) => getDb().prepare('SELECT * FROM tickets WHERE id = ?').get(id) as Fila | undefined;

/** Lo que va primero en la lista: lo incumplido y en riesgo arriba, después lo que vence antes. */
const PESO: Record<EstadoSla, number> = { incumplido: 0, en_riesgo: 1, a_tiempo: 2, en_pausa: 3, cumplido: 4 };

/**
 * Los tickets: todos los abiertos y los terminados de los últimos `dias`. Con `contacto`, solo los de esa ficha
 * (todos los suyos, sin importar cuándo).
 */
export function listarTickets(opts: { contacto?: string; dias?: number; now?: number } = {}): Ticket[] {
  const now = opts.now ?? Date.now();
  const cfg = configSla();
  const db = getDb();
  const desde = now - Math.min(365, Math.max(1, opts.dias ?? 90)) * DIA;
  const filas = opts.contacto
    ? (db.prepare('SELECT * FROM tickets WHERE user_id = ? ORDER BY creado DESC').all(opts.contacto) as unknown as Fila[])
    : (db.prepare('SELECT * FROM tickets WHERE resuelto IS NULL OR resuelto >= ? OR creado >= ? ORDER BY creado DESC LIMIT 2000').all(desde, desde) as unknown as Fila[]);
  const fichas = new Map<string, Contact | null>();
  const lista = filas.map((f) => {
    if (!fichas.has(f.user_id)) fichas.set(f.user_id, getContact(f.user_id));
    return vistaDe(f, now, cfg, fichas.get(f.user_id));
  });
  const venceDe = (t: Ticket) => (t.sla?.activo ? t.sla[t.sla.activo].vence : null) ?? Number.MAX_SAFE_INTEGER;
  return lista.sort((a, b) => {
    if (a.terminado !== b.terminado) return a.terminado ? 1 : -1;
    if (a.terminado) return (b.resuelto ?? b.creado) - (a.resuelto ?? a.creado);
    const pa = a.sla ? PESO[a.sla.estado] : 5, pb = b.sla ? PESO[b.sla.estado] : 5;
    return pa - pb || venceDe(a) - venceDe(b) || a.creado - b.creado;
  });
}

/** Un ticket con su historia (los cambios, contados en la historia de la ficha). */
export function verTicket(id: number, now = Date.now()): (Ticket & { historia: { ts: number; accion: string; de?: unknown; a?: unknown; por: string }[] }) | null {
  const f = fila(id);
  if (!f) return null;
  const historia = listEvents(f.user_id, 500)
    .filter((e) => e.type === 'ticket' && Number(e.payload.ticket) === id)
    .map((e) => ({ ts: e.ts, accion: String(e.payload.accion ?? ''), de: e.payload.de, a: e.payload.a, por: String(e.payload.by ?? 'equipo') }))
    .sort((a, b) => a.ts - b.ts);
  return { ...vistaDe(f, now), historia };
}

// ---------- Crear y cambiar ----------

const texto = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
/** El estado de un ticket nuevo: el primero que no cierra ni pausa. */
export const estadoInicial = (cfg = configSla()) => cfg.estados.find((e) => !e.cierra && !e.pausa)!.id;

export function crearTicket(entrada: { contacto?: unknown; asunto?: unknown; tipo?: unknown; prioridad?: unknown; producto?: unknown; asignado?: unknown }, por: string, now = Date.now()): Ticket {
  const cfg = configSla();
  const id = String(entrada.contacto ?? '');
  const c = id ? getContact(id) : null;
  if (!c) throw new Error('elige a qué cliente es el ticket');
  const asunto = texto(entrada.asunto, 140);
  if (asunto.length < 3) throw new Error('el asunto dice qué pasa: al menos tres letras');
  if (entrada.tipo !== undefined && entrada.tipo !== '' && !cfg.tipos.some((t) => t.id === entrada.tipo)) throw new Error('ese tipo de ticket no existe');
  if (entrada.prioridad !== undefined && entrada.prioridad !== '' && !cfg.prioridades.some((p) => p.id === entrada.prioridad)) throw new Error('esa prioridad no existe');
  const tipo = cfg.tipos.some((t) => t.id === entrada.tipo) ? String(entrada.tipo) : cfg.tipoDeFabrica;
  const prioridad = cfg.prioridades.some((p) => p.id === entrada.prioridad) ? String(entrada.prioridad) : cfg.prioridadDeFabrica;
  const producto = entrada.producto !== undefined ? texto(entrada.producto, 60) : texto(c.data?.[cfg.campoProducto], 60);
  const asignado = texto(entrada.asignado, 40) || null;
  const r = getDb()
    .prepare('INSERT INTO tickets (user_id, asunto, tipo, prioridad, estado, producto, asignado, creado, creado_por, actualizado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, asunto, tipo, prioridad, estadoInicial(cfg), producto, asignado, now, por, now);
  const nuevo = Number(r.lastInsertRowid);
  addEvent(id, 'ticket', { ticket: nuevo, accion: 'creado', a: asunto, prioridad, by: por });
  emitEvent('contact', id, { ticket: nuevo });
  return vistaDe(fila(nuevo)!, now, cfg);
}

/**
 * Cambia lo que se puede cambiar: estado, prioridad, asignado, la primera respuesta a mano, el asunto, el tipo y el
 * producto. Cada cambio queda en la historia de la ficha con el nombre de quien lo hizo.
 */
export function cambiarTicket(
  id: number,
  cambios: { estado?: unknown; prioridad?: unknown; asignado?: unknown; respondido?: unknown; asunto?: unknown; tipo?: unknown; producto?: unknown },
  por: string,
  now = Date.now(),
): Ticket {
  const f = fila(id);
  if (!f) throw new Error('ese ticket no existe');
  const cfg = configSla();
  const db = getDb();
  const ev = (accion: string, de: unknown, a: unknown) => addEvent(f.user_id, 'ticket', { ticket: id, accion, de, a, by: por });
  const set: Record<string, unknown> = {};

  if (cambios.estado !== undefined) {
    const a = estadoCfg(cfg, String(cambios.estado));
    if (!a) throw new Error('ese estado no existe');
    const de = estadoCfg(cfg, f.estado);
    if (a.id !== f.estado) {
      // Salir de un estado que pausa suma la pausa, en el reloj del objetivo de este ticket.
      if (f.pausa_desde !== null && !a.pausa) {
        const plan = planDe(getContact(f.user_id), cfg);
        const reloj: Reloj = plan && cfg.objetivos[plan] ? cfg.objetivos[plan]![prioridadParaMedir(cfg, f.prioridad)]!.reloj : 'corrido';
        set.pausa_ms = f.pausa_ms + gastado(f.pausa_desde, now, reloj, horarioDeSoporte(cfg));
        set.pausa_desde = null;
      }
      if (a.pausa && f.pausa_desde === null) set.pausa_desde = now;
      if (a.cierra) { set.resuelto = f.resuelto ?? now; set.cerrado = now; }
      // Reabrir: vuelve a correr desde donde iba (lo que ya se gastó, gastado está).
      if (!a.cierra && (de?.cierra || f.resuelto)) { set.resuelto = null; set.cerrado = null; }
      set.estado = a.id;
      ev('estado', f.estado, a.id);
    }
  }
  if (cambios.prioridad !== undefined) {
    if (!cfg.prioridades.some((p) => p.id === cambios.prioridad)) throw new Error('esa prioridad no existe');
    if (cambios.prioridad !== f.prioridad) { set.prioridad = cambios.prioridad; ev('prioridad', f.prioridad, cambios.prioridad); }
  }
  if (cambios.asignado !== undefined) {
    const a = texto(cambios.asignado, 40) || null;
    if (a !== f.asignado) { set.asignado = a; ev('asignado', f.asignado, a); }
  }
  if (cambios.respondido === true && !f.respondido) {
    if (!cfg.primeraRespuesta.aMano) throw new Error('en este negocio la primera respuesta no se marca a mano');
    set.respondido = now; set.respondido_por = por; ev('respondido', null, now);
  }
  if (cambios.asunto !== undefined) {
    const a = texto(cambios.asunto, 140);
    if (a.length < 3) throw new Error('el asunto dice qué pasa: al menos tres letras');
    if (a !== f.asunto) { set.asunto = a; ev('asunto', f.asunto, a); }
  }
  if (cambios.tipo !== undefined) {
    if (!cfg.tipos.some((t) => t.id === cambios.tipo)) throw new Error('ese tipo de ticket no existe');
    if (cambios.tipo !== f.tipo) { set.tipo = cambios.tipo; ev('tipo', f.tipo, cambios.tipo); }
  }
  if (cambios.producto !== undefined) {
    const a = texto(cambios.producto, 60);
    if (a !== f.producto) { set.producto = a; ev('producto', f.producto, a); }
  }
  if (Object.keys(set).length) {
    set.actualizado = now;
    const cols = Object.keys(set);
    db.prepare(`UPDATE tickets SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((k) => set[k] as never), id);
    emitEvent('contact', f.user_id, { ticket: id });
  }
  return vistaDe(fila(id)!, now, cfg);
}

// ---------- El cumplimiento ----------

export interface Conteo { a: number; de: number }
const conteo = (ts: Ticket[], cual: 'respuesta' | 'solucion'): Conteo => {
  const decididos = ts.filter((t) => t.sla && (t.sla[cual].estado === 'cumplido' || t.sla[cual].estado === 'incumplido'));
  return { a: decididos.filter((t) => t.sla![cual].estado === 'cumplido').length, de: decididos.length };
};
const mediana = (xs: number[]) => {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export interface SlaDelPeriodo {
  dias: number;
  desde: number;
  /** Tickets abiertos en el periodo. */
  tickets: number;
  /** De esos, cuántos son de clientes sin plan (sin SLA: no cuentan en el cumplimiento). */
  sinPlan: number;
  /** Cuántos todavía corren (ni cumplidos ni incumplidos): tampoco cuentan todavía. */
  corriendo: { respuesta: number; solucion: number };
  respuesta: Conteo;
  solucion: Conteo;
  porPlan: { plan: string; nombre: string; tickets: number; respuesta: Conteo; solucion: Conteo }[];
  porPrioridad: { prioridad: string; nombre: string; tickets: number; respuesta: Conteo; solucion: Conteo }[];
  /** Tiempo real contra el objetivo, por plan y prioridad (solo donde hubo tickets). En el reloj del objetivo. */
  tiempos: { plan: string; prioridad: string; tickets: number; objetivoRespuestaMin: number; respuestaMs: number | null; objetivoSolucionMin: number; solucionMs: number | null; reloj: Reloj }[];
  /** Lo que hoy está en riesgo o incumplido (abierto). */
  ahora: Ticket[];
  abiertos: number;
}

export function slaDelPeriodo(diasPedidos: number, now = Date.now()): SlaDelPeriodo {
  const dias = Math.min(365, Math.max(1, Math.round(diasPedidos) || 30));
  const desde = now - dias * DIA;
  const cfg = configSla();
  const horario = horarioDeSoporte(cfg);
  const todos = listarTickets({ dias: 365, now });
  const delPeriodo = todos.filter((t) => t.creado >= desde);
  const conPlan = delPeriodo.filter((t) => t.sla);
  const tiempos: SlaDelPeriodo['tiempos'] = [];
  for (const plan of cfg.planes)
    for (const p of cfg.prioridades) {
      const ts = conPlan.filter((t) => t.plan === plan.id && prioridadParaMedir(cfg, t.prioridad) === p.id);
      if (!ts.length) continue;
      const obj = cfg.objetivos[plan.id]![p.id]!;
      tiempos.push({
        plan: plan.id,
        prioridad: p.id,
        tickets: ts.length,
        objetivoRespuestaMin: obj.respuestaMin,
        respuestaMs: mediana(ts.filter((t) => t.respondido).map((t) => gastado(t.creado, t.respondido!, obj.reloj, horario))),
        objetivoSolucionMin: obj.solucionMin,
        // La solución, sin las pausas: lo que de verdad corrió para el equipo.
        solucionMs: mediana(ts.filter((t) => t.sla!.solucion.hecho).map((t) => t.sla!.solucion.consumido * obj.solucionMin * MIN)),
        reloj: obj.reloj,
      });
    }
  const abiertos = todos.filter((t) => !t.terminado);
  return {
    dias,
    desde,
    tickets: delPeriodo.length,
    sinPlan: delPeriodo.length - conPlan.length,
    corriendo: {
      respuesta: conPlan.filter((t) => ['a_tiempo', 'en_riesgo'].includes(t.sla!.respuesta.estado)).length,
      solucion: conPlan.filter((t) => ['a_tiempo', 'en_riesgo', 'en_pausa'].includes(t.sla!.solucion.estado)).length,
    },
    respuesta: conteo(conPlan, 'respuesta'),
    solucion: conteo(conPlan, 'solucion'),
    porPlan: cfg.planes.map((plan) => {
      const ts = conPlan.filter((t) => t.plan === plan.id);
      return { plan: plan.id, nombre: plan.nombre, tickets: ts.length, respuesta: conteo(ts, 'respuesta'), solucion: conteo(ts, 'solucion') };
    }),
    porPrioridad: cfg.prioridades.map((p) => {
      const ts = conPlan.filter((t) => prioridadParaMedir(cfg, t.prioridad) === p.id);
      return { prioridad: p.id, nombre: p.nombre, tickets: ts.length, respuesta: conteo(ts, 'respuesta'), solucion: conteo(ts, 'solucion') };
    }),
    tiempos,
    ahora: abiertos.filter((t) => t.sla && (t.sla.estado === 'incumplido' || t.sla.estado === 'en_riesgo')),
    abiertos: abiertos.length,
  };
}

/** Lo que el tablero necesita para pintar con los nombres y tonos de este negocio. */
export function vistaDeConfig(cfg = configSla()) {
  return {
    planes: cfg.planes,
    prioridades: cfg.prioridades,
    tipos: cfg.tipos,
    estados: cfg.estados,
    sinPlan: cfg.sinPlan,
    prioridadDeFabrica: cfg.prioridadDeFabrica,
    tipoDeFabrica: cfg.tipoDeFabrica,
    estadoInicial: estadoInicial(cfg),
    campoPlan: cfg.campoPlan,
    campoProducto: cfg.campoProducto,
    riesgoPct: cfg.riesgoPct,
    primeraRespuesta: cfg.primeraRespuesta,
    permisos: cfg.permisos,
    jornadaMin: minutosDeJornada(cfg),
  };
}
