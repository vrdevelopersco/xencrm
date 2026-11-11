// Lo que se puede cambiar de `xencrm.config.json` sin tocar archivos: el negocio, el agente, la marca, la zona
// horaria y las citas. Se edita desde el tablero (Configuración › El negocio) y, por lo tanto, desde la consola,
// que sirve el tablero de cada cliente.
//
// Tres cosas que esto respeta:
//   1. **No todo se edita.** Las rutas (catálogo, conocimiento, diccionario, perfil) y el embudo salen del alta y
//      no se tocan desde aquí: un embudo cambiado en caliente dejaría fichas apuntando a etapas que ya no existen.
//   2. **Nunca se guarda algo con lo que el cliente no arranque.** Lo que se va a escribir se valida entero con el
//      mismo esquema con el que se lee al arrancar; si no pasa, no se escribe nada.
//   3. **Se guarda una copia** del archivo anterior antes de pisarlo.
//
// 🪤 La configuración se lee UNA vez, al arrancar. Guardar deja el archivo listo, pero el proceso sigue con lo
// viejo hasta que reinicie. Por eso `guardar()` dice si hace falta reiniciar y `puedeReiniciarse` dice si hay
// quien lo levante (el arranque del paquete o pm2); si no lo hay, no se ofrece: dejaría al cliente abajo.
import { V } from './vocabulario.js';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { BusinessConfigSchema, business } from './config.js';
import { listAppointments } from './crm/appointments.js';
import { idDeSede } from './sedes-texto.js';

const ARCHIVO = () => resolve(process.env.XENCRM_CONFIG || 'xencrm.config.json');

/** ¿Hay quien lo vuelva a levantar si se cae? El arranque del paquete lo marca; pm2 pone pm_id. */
export const puedeReiniciarse = (): boolean => Boolean(process.env.XENCRM_SUPERVISADO || process.env.pm_id);

const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'la hora va como HH:MM');

/** Las de por aquí, para no hacer elegir entre las cuatrocientas que existen. Igual se acepta cualquiera válida. */
export const ZONAS_HORARIAS = [
  'America/Bogota', 'America/Mexico_City', 'America/Lima', 'America/Santiago', 'America/Argentina/Buenos_Aires',
  'America/Caracas', 'America/Panama', 'America/Guayaquil', 'America/La_Paz', 'America/Montevideo',
  'America/Asuncion', 'America/Costa_Rica', 'America/Guatemala', 'America/Santo_Domingo', 'America/New_York',
  'America/Los_Angeles', 'Europe/Madrid',
];

const zonaDeVerdad = (z2: string) => {
  try {
    new Intl.DateTimeFormat('es', { timeZone: z2 });
    return true;
  } catch {
    return false;
  }
};

export const AjustesSchema = z.object({
  negocio: z.object({
    name: z.string().trim().min(1, 'el negocio necesita un nombre').max(80),
    description: z.string().trim().max(600),
    siteUrl: z.string().trim().url('la dirección del sitio tiene que ser una URL completa'),
    currency: z.string().trim().min(1).max(8),
    country: z.string().trim().max(60),
    humanContact: z.string().trim().max(300),
    phoneCountryCode: z.string().trim().regex(/^\d{1,3}$/, 'el indicativo son de 1 a 3 dígitos'),
    phoneLocalDigits: z.number().int().min(6).max(12),
  }),
  agente: z.object({
    name: z.string().trim().min(1, 'el asistente necesita un nombre').max(40),
    style: z.string().trim().max(400),
    goal: z.string().trim().max(600),
    greeting: z.string().trim().max(300),
    verifyPhrase: z.string().trim().min(1).max(200),
  }),
  marca: z.object({
    color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'el color va en formato #rrggbb'),
    logo: z.string().trim().max(300),
    /** El logo para fondo oscuro, si la marca tiene dos versiones. */
    logoOscuro: z.string().trim().max(300),
    /** La marca chica: la pestaña del navegador y donde no cabe el logo entero. */
    favicon: z.string().trim().max(300),
    fondo: z.enum(['claro', 'oscuro']),
  }),
  timezone: z.string().trim().min(1).refine(zonaDeVerdad, 'esa zona horaria no existe (va como America/Bogota)'),
  citas: z.object({
    enabled: z.boolean(),
    service: z.string().trim().max(80),
    location: z.string().trim().max(200),
    durationMin: z.number().int().min(5).max(480),
    days: z.array(z.number().int().min(0).max(6)).max(7),
    hours: z.array(z.tuple([hora, hora])).max(6),
    capacity: z.number().int().min(1).max(50),
    minLeadHours: z.number().min(0).max(720),
    maxDaysAhead: z.number().int().min(1).max(365),
  }),
  /**
   * Las sedes (crm/sedes.ts). 🪤 Opcional a propósito: un tablero viejo en la caché de alguien manda el formulario
   * sin este campo, y si eso se leyera como «ninguna sede» las borraría todas al guardar otra cosa.
   */
  sedes: z
    .array(
      z.object({
        /** Vacío en una sede nueva: el id sale del nombre. El de una que ya existe no cambia aunque cambie el nombre. */
        id: z.string().trim().max(40).default(''),
        nombre: z.string().trim().min(1, 'cada sede necesita un nombre').max(80),
        direccion: z.string().trim().max(200),
        apodos: z.array(z.string().trim().min(2, 'un apodo de sede tiene al menos dos letras').max(60)).max(20),
        days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
        hours: z.array(z.tuple([hora, hora])).max(6).optional(),
        capacity: z.number().int().min(1).max(50).optional(),
      }),
    )
    .max(30)
    .optional(),
});
export type Ajustes = z.infer<typeof AjustesSchema>;

/** Lo que está corriendo ahora mismo, tal como lo ve el asistente. */
export function ajustesDe(cfg = business): Ajustes {
  const c = cfg.appointments;
  return {
    negocio: {
      name: cfg.business.name,
      description: cfg.business.description,
      siteUrl: cfg.business.siteUrl,
      currency: cfg.business.currency,
      country: cfg.business.country,
      humanContact: cfg.business.humanContact,
      phoneCountryCode: cfg.business.phoneCountryCode,
      phoneLocalDigits: cfg.business.phoneLocalDigits,
    },
    agente: {
      name: cfg.agent.name,
      style: cfg.agent.style,
      goal: cfg.agent.goal ?? '',
      greeting: cfg.agent.greeting ?? '',
      verifyPhrase: cfg.agent.verifyPhrase,
    },
    marca: {
      color: cfg.brand?.color ?? '#276f45',
      logo: cfg.brand?.logo ?? '',
      logoOscuro: cfg.brand?.logoOscuro ?? '',
      favicon: cfg.brand?.favicon ?? '',
      fondo: cfg.brand?.fondo ?? 'claro',
    },
    timezone: cfg.timezone,
    citas: {
      enabled: c.enabled,
      service: c.service,
      location: c.location,
      durationMin: c.durationMin,
      days: c.days,
      hours: c.hours.map(([a, b]) => [a, b] as [string, string]),
      capacity: c.capacity,
      minLeadHours: c.minLeadHours,
      maxDaysAhead: c.maxDaysAhead,
    },
    sedes: cfg.sedes.map((s) => ({
      id: s.id,
      nombre: s.nombre,
      direccion: s.direccion,
      apodos: s.apodos,
      ...(s.days ? { days: s.days } : {}),
      ...(s.hours ? { hours: s.hours.map(([x, y]) => [x, y] as [string, string]) } : {}),
      ...(s.capacity ? { capacity: s.capacity } : {}),
    })),
  };
}

/** El id de una sede nueva: su nombre sin «Sede» ni el del negocio, en minúsculas y sin tildes (sedes-texto.ts). */
const idDe = (nombre: string, usados: Set<string>): string => idDeSede(nombre, business.business.name, usados);

/** Lo guardado en el archivo, que puede ser más nuevo que lo que corre (si ya guardaron y no han reiniciado). */
export function ajustesEnDisco(): Ajustes {
  return ajustesDe(BusinessConfigSchema.parse(JSON.parse(readFileSync(ARCHIVO(), 'utf8'))));
}

/** ¿Lo que corre es lo que está guardado? Si no, hay cambios esperando un reinicio. */
export function alDia(): boolean {
  try {
    return JSON.stringify(ajustesEnDisco()) === JSON.stringify(ajustesDe());
  } catch {
    return true; // si el archivo no se puede leer, no se inventa un aviso
  }
}

/**
 * Guarda los ajustes en el archivo del cliente. Devuelve si hace falta reiniciar para que se apliquen.
 * Lanza con un mensaje entendible si algo no pasa la validación: no se escribe nada a medias.
 */
export function guardar(entran: unknown): { ajustes: Ajustes; hayQueReiniciar: boolean } {
  const a = AjustesSchema.parse(entran);
  if (a.citas.enabled && (a.citas.days.length === 0 || a.citas.hours.length === 0)) {
    throw new Error(`para agendar ${V.citas} hace falta al menos un día y una franja horaria`);
  }
  for (const [desde, hasta] of a.citas.hours) {
    if (desde >= hasta) throw new Error(`la franja ${desde}–${hasta} termina antes de empezar`);
  }
  let sedes: NonNullable<Ajustes['sedes']> | undefined;
  if (a.sedes) {
    const usados = new Set(a.sedes.map((s) => s.id).filter(Boolean));
    sedes = a.sedes.map((s) => {
      const id = s.id || idDe(s.nombre, usados);
      usados.add(id);
      if (s.days && !s.days.length) throw new Error(`${s.nombre} tiene horario propio pero ningún día`);
      for (const [desde, hasta] of s.hours ?? []) {
        if (desde >= hasta) throw new Error(`en ${s.nombre}, la franja ${desde}–${hasta} termina antes de empezar`);
      }
      if (s.hours && !s.hours.length) throw new Error(`${s.nombre} tiene horario propio pero ninguna franja`);
      return { ...s, id };
    });
    // 🪤 Quitar una sede con citas por delante dejaría esas citas en un sitio que ya no existe: nadie las cuenta en
    // ningún cupo y el recordatorio manda a una dirección que el negocio ya no ofrece. Primero se mueven.
    const quedan = new Set(sedes.map((s) => s.id));
    for (const vieja of business.sedes.filter((s) => !quedan.has(s.id))) {
      const proximas = listAppointments({ from: Date.now(), status: 'confirmada', limit: 1000 }).filter((x) => x.sede === vieja.id).length;
      if (proximas) throw new Error(`${vieja.nombre} tiene ${proximas} ${proximas === 1 ? V.cita : V.citas} por delante: muévelas o cancélalas antes de quitarla`);
    }
  }

  const archivo = ARCHIVO();
  const actual = JSON.parse(readFileSync(archivo, 'utf8')) as Record<string, any>;
  const nuevo = {
    ...actual,
    business: { ...actual.business, ...a.negocio },
    agent: { ...actual.agent, ...a.agente },
    brand: { ...(actual.brand ?? {}), ...a.marca },
    timezone: a.timezone,
    appointments: { ...actual.appointments, ...a.citas },
    ...(sedes ? { sedes } : {}),
  };
  // El mismo esquema con el que se lee al arrancar: si no pasa, el cliente no levantaría.
  BusinessConfigSchema.parse(nuevo);

  if (existsSync(archivo)) copyFileSync(archivo, `${archivo}.anterior`);
  writeFileSync(archivo, `${JSON.stringify(nuevo, null, 2)}\n`);
  const guardados = ajustesDe(BusinessConfigSchema.parse(nuevo));
  return { ajustes: guardados, hayQueReiniciar: JSON.stringify(guardados) !== JSON.stringify(ajustesDe()) };
}

/** Un mensaje que se entienda, en vez del volcado de zod. */
export function comoSeLee(err: unknown): string {
  if (err instanceof z.ZodError) {
    return err.issues.map((i) => `${i.path.join(' › ') || 'algo'}: ${i.message}`).join(' · ');
  }
  return (err as Error).message;
}
