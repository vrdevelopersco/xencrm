// Pruebas de los tickets y el SLA, sin modelo ni red: pnpm test:sla
//
// Con este número se le responde a un cliente que paga por un plan: si dice «a tiempo» cuando el plazo se fue un
// sábado, o «incumplido» cuando el equipo llamó y lo marcó, el SLA se vuelve papel. Se prueba:
//  · las tres capas de la configuración —fábrica < archivo del cliente (servicio.sla) < tablero— en ese orden;
//  · que cambiar cada regla cambie de verdad el resultado (umbral, primera respuesta, pausa, reloj, horario, plan…);
//  · el reloj hábil, la pausa de «esperando al cliente» y la regla de la primera respuesta;
//  · el cumplimiento del periodo con sus bases («2 de 3»), quién puede qué, el candado, la limpieza al borrar,
//    fusionar o anonimizar una ficha, la semilla de la demostración y lo mínimo del tablero.
//
// 🪤 Todo en una carpeta temporal, con un archivo de cliente de mentira y horas fijas en Bogotá: no depende de la
// hora a la que se corra ni de la configuración de nadie.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'xencrm-sla-'));
const base = JSON.parse(readFileSync(new URL('../../xencrm.config.example.json', import.meta.url), 'utf8')) as Record<string, unknown>;
// La capa del archivo: el umbral de riesgo y UN objetivo; lo demás, de fábrica. Y otra parte de Servicio (como la de
// Mantenimientos) que no se puede perder al leer la del SLA.
const DEL_ARCHIVO = { riesgoPct: 80, objetivos: { basico: { baja: { respuestaMin: 600 } } } };
writeFileSync(join(dir, 'xencrm.config.json'), JSON.stringify({ ...base, timezone: 'America/Bogota', servicio: { sla: DEL_ARCHIVO, otraParte: { deOtraParte: true } } }));
writeFileSync(join(dir, '.env'), '');
Object.assign(process.env, {
  XENCRM_CONFIG: join(dir, 'xencrm.config.json'),
  XENCRM_ENV_FILE: join(dir, '.env'),
  DB_PATH: join(dir, 'xencrm.db'),
  WHATSAPP_ENABLED: 'false',
  ADMIN_TOKEN: 'token-del-tablero-de-prueba-0123456789',
});
globalThis.fetch = (async (url: string | URL | Request) => {
  throw new Error(`la prueba no sale a la red: ${String(url)}`);
}) as typeof fetch;

const { business } = await import('../config.js');
const { getDb } = await import('../rag/store.js');
const { touchUser } = await import('../agent/memory.js');
const { updateContact, deleteContact, listEvents } = await import('../crm/contacts.js');
const { getSetting } = await import('../crm/settings.js');
const { mergeContacts } = await import('../crm/merge.js');
const { anonimizar, borrarDelTodo } = await import('../crm/retencion.js');
const { msHabiles, sumarHabiles } = await import('../crm/tiempos.js');
const T = await import('../crm/tickets.js');
const { sembrarTicketsDe } = await import('../crm/tickets-demo.js');
const { frenoDelCandado } = await import('../channels/candado.js');
const { Hono } = await import('hono');
const { mountAdmin } = await import('../channels/admin.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};

const MIN = 60_000;
const HORA = 60 * MIN;
/** Una hora de Bogotá (UTC−5, sin cambio de hora): «2026-09-22T10:00». */
const bog = (s: string) => new Date(`${s}:00-05:00`).getTime();
const iso = (ts: number | null | undefined) => (ts == null ? String(ts) : new Date(ts - 5 * HORA).toISOString().slice(0, 16));
const db = getDb();
const cliente = (id: string, nombre: string, plan?: string, extra: Record<string, unknown> = {}) => {
  touchUser(id, 'whatsapp', nombre);
  updateContact(id, { data: { ...(plan ? { plan_soporte: plan } : {}), ...extra } }, { silent: true });
  return id;
};
const contesta = (quien: string, ts: number, autor: 'bot' | 'human', por: string | null = null) =>
  db.prepare("INSERT INTO messages (user_id, role, content, ts, author, by) VALUES (?, 'assistant', 'listo', ?, ?, ?)").run(quien, ts, autor, por);
const ver = (id: number, now: number) => T.verTicket(id, now)!;
const abrir = (contacto: string, prioridad: string, now: number, asunto = 'No abre el módulo de facturación') => T.crearTicket({ contacto, asunto, prioridad }, 'Laura', now);
const regla = (reglas: Record<string, unknown>) => {
  const r = T.guardarConfigSla({ reglas });
  if ('error' in r) throw new Error(r.error);
};
const estructura = (e: unknown, reglas?: Record<string, unknown>) => {
  const r = T.guardarConfigSla({ estructura: e, reglas });
  if ('error' in r) throw new Error(r.error);
};
const limpio = () => T.olvidarConfigDelTablero();
const cuantos = (userId: string) => (db.prepare('SELECT COUNT(*) n FROM tickets WHERE user_id = ?').get(userId) as { n: number }).n;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const negocio = business as any;
const archivoOriginal = negocio.servicio;

// ---------------------------------------------------------------------------------------------------------------
console.log('— Las tres capas: fábrica < archivo del cliente < tablero');
check('el archivo del cliente se lee con su subclave servicio.sla', negocio.servicio?.sla?.riesgoPct === 80);
check('🪤 y las otras partes de Servicio no se pierden al leerlo', negocio.servicio?.otraParte?.deOtraParte === true);
check('de fábrica, «en riesgo» es a partir del 75 %', T.FABRICA.riesgoPct === 75);
check('el archivo manda sobre la fábrica', T.configSla().riesgoPct === 80 && T.capasDe()['sla.riesgoPct'] === 'archivo', JSON.stringify([T.configSla().riesgoPct, T.capasDe()['sla.riesgoPct']]));
regla({ 'sla.riesgoPct': 60 });
check('el tablero manda sobre el archivo', T.configSla().riesgoPct === 60 && T.capasDe()['sla.riesgoPct'] === 'tablero');
check('y se guarda como regla suelta, en reglas.<id>', getSetting<unknown>('reglas.sla.riesgoPct', null) === 60);
limpio();
check('olvidar lo del tablero vuelve a lo del archivo', T.configSla().riesgoPct === 80 && T.capasDe()['sla.riesgoPct'] === 'archivo');
negocio.servicio = undefined;
check('sin archivo, vuelve a lo de fábrica', T.configSla().riesgoPct === 75 && T.capasDe()['sla.riesgoPct'] === 'fabrica');
regla({ 'sla.riesgoPct': 60 });
check('y el tablero manda también sobre la fábrica', T.configSla().riesgoPct === 60);
limpio();
negocio.servicio = archivoOriginal;

const ob = () => T.configSla().objetivos;
check('el archivo cambia UN objetivo (Básico · Baja, primera respuesta)…', ob().basico!.baja!.respuestaMin === 600, String(ob().basico!.baja!.respuestaMin));
check('…sin borrar su otra mitad ni los demás planes', ob().basico!.baja!.solucionMin === T.FABRICA.objetivos.basico!.baja!.solucionMin && JSON.stringify(ob().pro) === JSON.stringify(T.FABRICA.objetivos.pro));
estructura({ objetivos: { basico: { baja: { respuestaMin: 300 } } } });
check('el tablero cambia ese mismo objetivo encima del archivo', ob().basico!.baja!.respuestaMin === 300 && T.capasDe().objetivos === 'tablero');
limpio();
check('y al olvidarlo vuelve el del archivo', ob().basico!.baja!.respuestaMin === 600 && T.capasDe().objetivos === 'archivo');
check('lo que nadie cambió dice que es de fábrica', T.capasDe().estados === 'fabrica' && T.capasDe()['sla.primeraRespuesta.aMano'] === 'fabrica');

negocio.servicio = { sla: { riesgoPct: 500, estados: [{ id: 'unico', nombre: 'Único' }], prioridadDeFabrica: 'no_existe', horario: { desde: '25:00' }, objetivos: { pro: { alta: { respuestaMin: -3 } } } } };
const roto = T.configSla();
check(
  '🪤 un archivo a medias no tumba el SLA: lo que no sirve vuelve a algo que sí',
  roto.riesgoPct === 99 && roto.estados.some((e) => e.cierra) && roto.prioridades.some((p) => p.id === roto.prioridadDeFabrica) && roto.horario.desde === '08:00' && roto.objetivos.pro!.alta!.respuestaMin === T.FABRICA.objetivos.pro!.alta!.respuestaMin,
  JSON.stringify({ r: roto.riesgoPct, e: roto.estados.map((e) => e.id), p: roto.prioridadDeFabrica, h: roto.horario }),
);
negocio.servicio = archivoOriginal;

// ---------------------------------------------------------------------------------------------------------------
console.log('— Cada regla suelta se cambia desde el tablero y cambia la configuración que manda');
const reglas = T.reglasSla();
const TIPOS = ['numero', 'texto', 'si-no', 'opciones', 'lista'];
check('cada regla trae id, grupo, etiqueta, ayuda, tipo y defecto', reglas.every((r) => r.id.startsWith('sla.') && r.grupo && r.etiqueta && r.ayuda && TIPOS.includes(r.tipo) && r.defecto !== undefined));
check('sin ids repetidos', new Set(reglas.map((r) => r.id)).size === reglas.length);
const en = (c: unknown, ruta: string[]) => ruta.reduce<unknown>((x, k) => (x && typeof x === 'object' ? (x as Record<string, unknown>)[k] : undefined), c);
const sinDefecto = reglas.filter((r) => JSON.stringify(en(T.FABRICA, r.ruta)) !== JSON.stringify(r.defecto));
check('el defecto de cada una es el de fábrica', !sinDefecto.length, sinDefecto.map((r) => r.id).join(', '));
const OTRO_TEXTO: Record<string, string> = { 'sla.horario.desde': '07:00', 'sla.horario.hasta': '19:00', 'sla.campoPlan': 'nivel', 'sla.campoProducto': 'equipo' };
const otroValor = (r: (typeof reglas)[number]): unknown => {
  switch (r.tipo) {
    case 'numero': return r.defecto === 50 ? 60 : 50;
    case 'si-no': return !r.defecto;
    case 'opciones': return r.opciones!.find((x) => x.valor !== r.defecto)!.valor;
    case 'lista': return [1, 2, 3, 4, 5, 6];
    default: return OTRO_TEXTO[r.id] ?? 'otro_dato';
  }
};
for (const r of reglas) {
  const v = otroValor(r);
  const g = T.guardarConfigSla({ reglas: { [r.id]: v } });
  const hay = en(T.configSla(), r.ruta);
  check(`«${r.etiqueta}» (${r.id})`, !('error' in g) && JSON.stringify(hay) === JSON.stringify(v) && T.capasDe()[r.id] === 'tablero', JSON.stringify({ g: 'error' in g ? g : 'ok', v, hay }));
  limpio();
}

// ---------------------------------------------------------------------------------------------------------------
console.log('— Lo que no valida no se guarda, y dice dónde');
const mal = T.guardarConfigSla({ reglas: { 'sla.riesgoPct': 150 } });
check('un umbral fuera de rango se rechaza con su campo', 'error' in mal && mal.campo === 'sla.riesgoPct', JSON.stringify(mal));
check('y no se guarda', T.configSla().riesgoPct === 80);
const aMedias = T.guardarConfigSla({ estructura: { objetivos: { pro: { alta: { respuestaMin: 45 } } } }, reglas: { 'sla.horario.desde': '8 de la mañana' } });
check('🪤 todo o nada: si una parte no valida, la otra tampoco se guarda', 'error' in aMedias && aMedias.campo === 'horario.desde' && ob().pro!.alta!.respuestaMin === T.FABRICA.objetivos.pro!.alta!.respuestaMin, JSON.stringify(aMedias));
const sinCierre = T.guardarConfigSla({ estructura: { estados: [{ id: 'abierto', nombre: 'Abierto' }, { id: 'esperando', nombre: 'Esperando', pausa: true }] } });
check('sin un estado que cierre el ticket, no', 'error' in sinCierre && sinCierre.campo === 'estados', JSON.stringify(sinCierre));
const alReves = T.guardarConfigSla({ estructura: { objetivos: { pro: { alta: { respuestaMin: 600, solucionMin: 60 } } } } });
check('una solución antes que la primera respuesta, tampoco', 'error' in alReves && alReves.campo === 'objetivos.pro.alta.solucionMin', JSON.stringify(alReves));
const repetido = T.guardarConfigSla({ estructura: { tipos: [{ id: 'falla', nombre: 'Falla' }, { id: 'falla', nombre: 'Falla' }] } });
check('un nombre repetido, tampoco', 'error' in repetido && repetido.campo === 'tipos.1.nombre', JSON.stringify(repetido));
check('una regla que no existe, tampoco', 'error' in T.guardarConfigSla({ reglas: { 'sla.inventada': 1 } }));
const PLANES_CON_ORO = [...T.FABRICA.planes, { id: 'oro', nombre: 'Oro', alias: ['gold'] }];
const sinTiempos = T.guardarConfigSla({ estructura: { planes: PLANES_CON_ORO } });
check('un plan nuevo sin sus tiempos: se dice cuál falta', 'error' in sinTiempos && sinTiempos.campo === 'objetivos.oro.critica', JSON.stringify(sinTiempos));
check('y nada de eso quedó guardado', T.capasDe().planes === 'fabrica' && T.capasDe().estados === 'fabrica' && T.capasDe().tipos === 'fabrica' && T.capasDe().objetivos === 'archivo');

// ---------------------------------------------------------------------------------------------------------------
console.log('— El plan de cada cliente sale de su ficha');
const pl = (v: unknown) => T.planDe({ data: { plan_soporte: v } } as never);
check('por el nombre, sin importar mayúsculas ni tildes', pl('ENTERPRISE') === 'enterprise' && pl('basico') === 'basico' && pl('Básico') === 'basico');
check('dentro de una frase («plan pro»)', pl('plan pro') === 'pro');
check('por un alias («profesional», «basic»)', pl('Profesional') === 'pro' && pl('basic') === 'basico');
check('🪤 «Pro» no se cuela en «Producto premium»', pl('Producto premium') === null);
check('sin plan, o con uno que no existe: sin SLA', pl('') === null && pl('Oro') === null && T.planDe({ data: {} } as never) === null);

// ---------------------------------------------------------------------------------------------------------------
console.log('— El reloj hábil (crm/tiempos.ts) en el horario de soporte');
const hs = T.horarioDeSoporte(T.FABRICA);
check('cuatro horas un martes a las 10 vencen a las 2 de la tarde', sumarHabiles(bog('2026-09-22T10:00'), 4 * HORA, hs) === bog('2026-09-22T14:00'));
check('a las 4 de la tarde siguen al otro día: miércoles a las 10', sumarHabiles(bog('2026-09-22T16:00'), 4 * HORA, hs) === bog('2026-09-23T10:00'));
check('🪤 un viernes a las 5 con dos horas: el lunes a las 9 (el fin de semana no cuenta)', sumarHabiles(bog('2026-09-25T17:00'), 2 * HORA, hs) === bog('2026-09-28T09:00'), iso(sumarHabiles(bog('2026-09-25T17:00'), 2 * HORA, hs)));
check('abierto un sábado: el reloj arranca el lunes a las 8', sumarHabiles(bog('2026-09-26T12:00'), 30 * MIN, hs) === bog('2026-09-28T08:30'));
const desdes = [bog('2026-09-22T10:00'), bog('2026-09-25T17:30'), bog('2026-09-27T03:00')];
const plazos = [MIN, 59 * MIN, 8 * HORA, 10 * HORA, 25 * HORA, 30 * HORA];
check('y es el inverso de msHabiles: sumar un plazo y medirlo da el mismo plazo', desdes.every((d) => plazos.every((ms) => msHabiles(d, sumarHabiles(d, ms, hs), hs) === ms)));

// ---------------------------------------------------------------------------------------------------------------
console.log('— El reloj de un ticket: a tiempo, en riesgo, incumplido');
const ENT = cliente('wa:ent', 'Camilo Duarte', 'Enterprise');
const PRO = cliente('wa:pro', 'Laura Gómez', 'Plan Pro');
const BAS = cliente('wa:bas', 'Andrés Mejía', 'Básico');
const SIN = cliente('wa:sin', 'Marta Ruiz');
const t0 = bog('2026-09-22T10:00'); // martes
const crit = abrir(ENT, 'critica', t0);
check('un ticket nuevo nace en el primer estado que no cierra ni pausa, con su código', crit.estado === 'abierto' && crit.codigo === `TK-${String(crit.id).padStart(4, '0')}`);
check('Enterprise crítico: primera respuesta en 60 min, 24/7', crit.plan === 'enterprise' && crit.sla?.respuesta.objetivoMin === 60 && crit.sla.respuesta.reloj === 'corrido' && crit.sla.respuesta.vence === t0 + HORA);
check('a los 20 min va a tiempo', ver(crit.id, t0 + 20 * MIN).sla!.estado === 'a_tiempo');
check('a los 46 min (77 %) sigue a tiempo con el umbral del archivo (80 %)', ver(crit.id, t0 + 46 * MIN).sla!.estado === 'a_tiempo');
regla({ 'sla.riesgoPct': 75 });
check('🪤 con el umbral en 75 % desde el tablero, ese mismo ticket sale en riesgo', ver(crit.id, t0 + 46 * MIN).sla!.estado === 'en_riesgo');
limpio();
check('a los 50 min (83 %), en riesgo', ver(crit.id, t0 + 50 * MIN).sla!.estado === 'en_riesgo');
const tarde = ver(crit.id, t0 + 80 * MIN);
check('a los 80 min sin respuesta: incumplido, y se sabe desde cuándo', tarde.sla!.estado === 'incumplido' && tarde.sla!.respuesta.vence === t0 + HORA && tarde.sla!.activo === 'respuesta');

console.log('— La primera respuesta: lo primero que pase de lo encendido');
contesta(ENT, t0 - 10 * MIN, 'human', 'Marcela');
contesta(ENT, t0 + 5 * MIN, 'bot');
check('🪤 ni lo que el equipo dijo antes de abrir el ticket ni lo que contestó el agente de IA cuentan', ver(crit.id, t0 + 30 * MIN).respondido === null);
contesta(ENT, t0 + 20 * MIN, 'human', 'Marcela');
const r1 = ver(crit.id, t0 + 80 * MIN);
check('el primer mensaje de una persona del equipo después de abrirlo, sí', r1.respondido === t0 + 20 * MIN && r1.respondidoComo === 'equipo' && r1.respondidoPor === 'Marcela', JSON.stringify([iso(r1.respondido), r1.respondidoComo]));
check('y la primera respuesta quedó cumplida: ahora corre la solución', r1.sla!.respuesta.estado === 'cumplido' && r1.sla!.activo === 'solucion');
regla({ 'sla.primeraRespuesta.delEquipo': false });
const r2 = ver(crit.id, t0 + 80 * MIN);
check('con «un mensaje del equipo» apagado, ese mensaje ya no cuenta', r2.respondido === null && r2.sla!.respuesta.estado === 'incumplido');
limpio();

const manual = abrir(PRO, 'alta', t0);
T.cambiarTicket(manual.id, { respondido: true }, 'Laura', t0 + 30 * MIN);
const m1 = ver(manual.id, t0 + HORA);
check('marcarla a mano (fue una llamada) cuenta, con quién la marcó', m1.respondidoComo === 'a_mano' && m1.respondido === t0 + 30 * MIN && m1.respondidoPor === 'Laura');
regla({ 'sla.primeraRespuesta.aMano': false });
check('con «marcarla a mano» apagado, la marca no cuenta', ver(manual.id, t0 + HORA).respondido === null);
const otroPro = abrir(PRO, 'media', t0);
let noSeMarca = false;
try {
  T.cambiarTicket(otroPro.id, { respondido: true }, 'Laura', t0 + HORA);
} catch {
  noSeMarca = true;
}
check('y ya no se deja marcar', noSeMarca);
limpio();

const alCerrar = abrir(BAS, 'critica', t0); // Básico crítico: 8 h hábiles para responder → martes 18:00
T.cambiarTicket(alCerrar.id, { estado: 'resuelto' }, 'Laura', t0 + 2 * HORA);
const c1 = ver(alCerrar.id, t0 + 3 * HORA);
check('resuelto sin haber contestado antes: el cierre cuenta como respuesta', c1.respondidoComo === 'al_resolver' && c1.sla!.respuesta.estado === 'cumplido' && c1.terminado && c1.sla!.estado === 'cumplido');
regla({ 'sla.primeraRespuesta.alResolver': false });
const c2 = ver(alCerrar.id, bog('2026-09-23T16:00'));
check('con «cerrarlo» apagado, queda sin primera respuesta y, pasado el plazo, incumplida', c2.respondido === null && c2.sla!.respuesta.estado === 'incumplido');
limpio();

// ---------------------------------------------------------------------------------------------------------------
console.log('— Esperando al cliente: el reloj de la solución se para');
// Pro alta: la solución en 2 jornadas (20 h hábiles). Sin pausa, del martes a las 10 vence el jueves a las 10.
check('sin pausa, vencería el jueves a las 10', sumarHabiles(t0, 20 * HORA, hs) === bog('2026-09-24T10:00'));
const pz = abrir(PRO, 'alta', t0);
T.cambiarTicket(pz.id, { respondido: true }, 'Laura', t0 + 30 * MIN);
T.cambiarTicket(pz.id, { estado: 'esperando_cliente' }, 'Laura', bog('2026-09-22T11:00'));
const parado = ver(pz.id, bog('2026-09-23T09:00'));
check('mientras espera, el reloj está parado y no hay vencimiento', parado.enPausa && parado.sla!.solucion.estado === 'en_pausa' && parado.sla!.solucion.vence === null && parado.sla!.estado === 'en_pausa');
T.cambiarTicket(pz.id, { estado: 'en_progreso' }, 'Laura', bog('2026-09-23T11:00'));
const vuelta = ver(pz.id, bog('2026-09-23T12:00'));
check('al volver, el plazo se corre lo que estuvo parado (10 h hábiles): vence el viernes a las 10', vuelta.sla!.solucion.vence === bog('2026-09-25T10:00'), iso(vuelta.sla!.solucion.vence));
check('y lo gastado no cuenta la pausa: 2 h de 20 (el 10 %)', Math.abs(vuelta.sla!.solucion.consumido - 0.1) < 1e-9, String(vuelta.sla!.solucion.consumido));
estructura({ estados: T.FABRICA.estados.map((e) => (e.id === 'esperando_cliente' ? { ...e, pausa: false } : e)) });
const np = abrir(PRO, 'alta', t0);
T.cambiarTicket(np.id, { respondido: true }, 'Laura', t0 + 30 * MIN);
T.cambiarTicket(np.id, { estado: 'esperando_cliente' }, 'Laura', bog('2026-09-22T11:00'));
const sigue = ver(np.id, bog('2026-09-23T09:00'));
check('🪤 si ese estado ya no pausa (se cambió en el tablero), el reloj sigue: vence el jueves', !sigue.enPausa && sigue.sla!.solucion.vence === bog('2026-09-24T10:00'), iso(sigue.sla!.solucion.vence));
limpio();
estructura({ estados: T.FABRICA.estados.map((e) => (e.id === 'en_progreso' ? { ...e, pausa: true } : e)) });
const otraPausa = abrir(PRO, 'alta', t0);
T.cambiarTicket(otraPausa.id, { estado: 'en_progreso' }, 'Laura', t0 + HORA);
check('y el que se marque como pausa, pausa', ver(otraPausa.id, t0 + 2 * HORA).enPausa);
limpio();

// ---------------------------------------------------------------------------------------------------------------
console.log('— Hábil o 24/7, y el horario de soporte');
const b17 = abrir(BAS, 'media', bog('2026-09-22T17:00'));
check('Básico media (8 h hábiles) abierto a las 5 de la tarde: vence el miércoles a las 3', b17.sla!.respuesta.vence === bog('2026-09-23T15:00'), iso(b17.sla!.respuesta.vence));
estructura({ objetivos: { basico: { media: { reloj: 'corrido' } } } });
check('el mismo objetivo en 24/7 vence esa noche, a la 1 de la mañana', ver(b17.id, bog('2026-09-22T17:30')).sla!.respuesta.vence === bog('2026-09-23T01:00'));
limpio();
regla({ 'sla.horario.hasta': '20:00' });
check('con soporte hasta las 8 de la noche, vence el miércoles a la 1 de la tarde', ver(b17.id, bog('2026-09-22T17:30')).sla!.respuesta.vence === bog('2026-09-23T13:00'), iso(ver(b17.id, bog('2026-09-22T17:30')).sla!.respuesta.vence));
limpio();
const vie = abrir(ENT, 'alta', bog('2026-09-25T17:30')); // Enterprise alta: 2 h hábiles
check('Enterprise alta (2 h hábiles) un viernes a las 5:30: vence el lunes a las 9:30', vie.sla!.respuesta.vence === bog('2026-09-28T09:30'), iso(vie.sla!.respuesta.vence));
regla({ 'sla.horario.dias': [1, 2, 3, 4, 5, 6] });
check('con soporte los sábados, vence el sábado a las 9:30', ver(vie.id, bog('2026-09-25T18:00')).sla!.respuesta.vence === bog('2026-09-26T09:30'));
limpio();

// ---------------------------------------------------------------------------------------------------------------
console.log('— Los planes, las prioridades, los tipos y los estados son de cada negocio');
const sp = abrir(SIN, 'alta', t0);
check('un cliente sin plan: el ticket va sin SLA', sp.plan === null && sp.sla === null);
regla({ 'sla.sinPlan': 'basico' });
const sp2 = ver(sp.id, t0 + HORA);
check('con «un cliente sin plan se mide como Básico», el mismo ticket tiene ese SLA', sp2.plan === 'basico' && sp2.sla?.respuesta.objetivoMin === T.configSla().objetivos.basico!.alta!.respuestaMin);
limpio();

const NIV = cliente('wa:niv', 'Sofía Herrera', undefined, { nivel: 'Enterprise', producto: 'XenPOS', equipo: 'Servidor 3' });
const nv = abrir(NIV, 'media', t0);
check('el plan se lee de plan_soporte: sin ese dato, sin SLA', nv.sla === null);
check('y el producto del ticket nuevo, del dato «producto» de la ficha', nv.producto === 'XenPOS');
regla({ 'sla.campoPlan': 'nivel', 'sla.campoProducto': 'equipo' });
check('🪤 con el dato del plan cambiado a «nivel», el mismo ticket es Enterprise', ver(nv.id, t0 + HORA).plan === 'enterprise');
check('y con el del producto cambiado a «equipo», el ticket nuevo lo toma de ahí', abrir(NIV, 'media', t0).producto === 'Servidor 3');
limpio();

const TIEMPOS_ORO = { critica: { respuestaMin: 30, solucionMin: 240, reloj: 'corrido' }, alta: { respuestaMin: 60, solucionMin: 480 }, media: { respuestaMin: 120, solucionMin: 600 }, baja: { respuestaMin: 240, solucionMin: 1200 } };
estructura({ planes: PLANES_CON_ORO, objetivos: { oro: TIEMPOS_ORO } });
const ORO = cliente('wa:oro', 'Grupo Andino', 'gold');
const tOro = abrir(ORO, 'critica', t0);
check('un plan nuevo (Oro, con el alias «gold») y sus tiempos miden sus tickets', tOro.plan === 'oro' && tOro.sla?.respuesta.objetivoMin === 30 && tOro.sla.respuesta.vence === t0 + 30 * MIN);
check('y sale en el cumplimiento por plan', T.slaDelPeriodo(30, t0 + HORA).porPlan.some((p) => p.plan === 'oro' && p.nombre === 'Oro'));
limpio();
check('al quitarlo, ese cliente vuelve a no tener SLA', ver(tOro.id, t0 + HORA).sla === null);

const deBaja = abrir(PRO, 'baja', t0);
estructura({ prioridades: T.FABRICA.prioridades.filter((p) => p.id !== 'baja') });
check('una prioridad que se quita: sus tickets se miden como la de un ticket nuevo', ver(deBaja.id, t0 + HORA).sla?.respuesta.objetivoMin === T.configSla().objetivos.pro!.media!.respuestaMin);
let noAbre = false;
try {
  abrir(PRO, 'baja', t0);
} catch {
  noAbre = true;
}
check('y ya no se abren tickets con ella', noAbre);
limpio();

estructura({ tipos: [{ id: 'falla', nombre: 'Falla' }, { id: 'consulta', nombre: 'Consulta' }] }, { 'sla.tipoDeFabrica': 'consulta' });
check('tipos propios: un ticket nuevo toma el tipo de fábrica de este negocio', abrir(PRO, 'media', t0).tipo === 'consulta');
limpio();
estructura({ estados: [{ id: 'nuevo', nombre: 'Nuevo' }, { id: 'listo', nombre: 'Listo', cierra: true }] });
const propio = abrir(PRO, 'media', t0);
check('estados propios: el ticket nuevo nace en «Nuevo»', propio.estado === 'nuevo');
const listo = T.cambiarTicket(propio.id, { estado: 'listo' }, 'Laura', t0 + HORA);
check('y «Listo», que cierra, lo cierra', listo.terminado && listo.resuelto === t0 + HORA);
const reabre = T.cambiarTicket(propio.id, { estado: 'nuevo' }, 'Laura', t0 + 2 * HORA);
check('volver a uno que no cierra lo reabre', !reabre.terminado && reabre.resuelto === null);
limpio();

// ---------------------------------------------------------------------------------------------------------------
console.log('— El cumplimiento del periodo, siempre con su base');
// Una semana aparte (marzo de 2027) para que lo de arriba no se mezcle: del martes 2 a las 10, mirado el viernes 5.
const p0 = bog('2027-03-02T10:00');
const E2 = cliente('wa:hotel', 'Hotel Caribe', 'Enterprise');
const P2 = cliente('wa:clinica', 'Clínica Norte', 'Pro');
const S2 = cliente('wa:cafe', 'Café Central');
const a1 = abrir(E2, 'critica', p0);
T.cambiarTicket(a1.id, { respondido: true }, 'Laura', p0 + 30 * MIN);
T.cambiarTicket(a1.id, { estado: 'resuelto' }, 'Laura', p0 + 4 * HORA);
const a2 = abrir(E2, 'critica', p0);
T.cambiarTicket(a2.id, { respondido: true }, 'Laura', p0 + 90 * MIN);
T.cambiarTicket(a2.id, { estado: 'resuelto' }, 'Laura', p0 + 10 * HORA);
const a3 = abrir(P2, 'media', p0);
T.cambiarTicket(a3.id, { respondido: true }, 'Laura', p0 + HORA);
abrir(S2, 'alta', p0);
const per = T.slaDelPeriodo(7, bog('2027-03-05T12:00'));
check('cuenta los tickets abiertos en el periodo, y cuántos son sin plan', per.tickets === 4 && per.sinPlan === 1, JSON.stringify([per.tickets, per.sinPlan]));
check('primera respuesta: 2 de 3 a tiempo (el que no tiene plan no entra en la base)', per.respuesta.a === 2 && per.respuesta.de === 3, JSON.stringify(per.respuesta));
check('solución: 1 de 2; el que sigue abierto y a tiempo todavía no cuenta', per.solucion.a === 1 && per.solucion.de === 2 && per.corriendo.solucion === 1, JSON.stringify([per.solucion, per.corriendo]));
const ent2 = per.porPlan.find((p) => p.plan === 'enterprise')!;
check('por plan: Enterprise, 1 de 2 en la primera respuesta', ent2.tickets === 2 && ent2.respuesta.a === 1 && ent2.respuesta.de === 2);
const porCrit = per.porPrioridad.find((p) => p.prioridad === 'critica')!;
check('por prioridad: Crítica, 1 de 2 en la solución', porCrit.tickets === 2 && porCrit.solucion.a === 1 && porCrit.solucion.de === 2);
const tc = per.tiempos.find((x) => x.plan === 'enterprise' && x.prioridad === 'critica')!;
check('la mediana real contra el objetivo: 60 min de primera respuesta contra 60', tc.respuestaMs === 60 * MIN && tc.objetivoRespuestaMin === 60 && tc.solucionMs === 7 * HORA, JSON.stringify(tc));
check('sin tickets no hay porcentaje: 0 de 0', T.slaDelPeriodo(7, bog('2028-01-10T12:00')).respuesta.de === 0);

// ---------------------------------------------------------------------------------------------------------------
console.log('— La historia de la ficha');
T.cambiarTicket(pz.id, { prioridad: 'critica', asignado: 'Marcela' }, 'Laura', bog('2026-09-23T12:00'));
const hist = T.verTicket(pz.id)!.historia;
const acciones = hist.map((x) => x.accion);
check('cada cambio queda en la historia, con quién lo hizo', ['creado', 'respondido', 'prioridad', 'asignado'].every((a) => acciones.includes(a)) && acciones.filter((a) => a === 'estado').length === 2 && hist.every((x) => x.por === 'Laura'), JSON.stringify(acciones));
check('y en la de la ficha del cliente', listEvents(PRO, 500).some((e) => e.type === 'ticket' && e.payload.accion === 'asignado' && e.payload.a === 'Marcela'));

// ---------------------------------------------------------------------------------------------------------------
console.log('— La semilla de la demostración');
const SEM = cliente('wa:semilla', 'Distribuidora Sol', 'Pro');
const ahoraS = bog('2026-09-24T15:00'); // jueves
sembrarTicketsDe(
  SEM,
  [
    { asunto: 'Caída del servidor', prioridad: 'critica', estado: 'abierto', haceHoras: 2 },
    { asunto: 'Cambio de clave', tipo: 'solicitud', prioridad: 'baja', estado: 'resuelto', haceHoras: 30, primeraRespuestaEnMin: 20, resueltoEnHoras: 5 },
    { asunto: 'Esperando el respaldo', estado: 'esperando_cliente', haceHoras: 3, primeraRespuestaEnMin: 10 },
    { asunto: 'Con lo que no existe', estado: 'inventado', prioridad: 'urgentisima', tipo: 'otro', haceHoras: 1 },
  ],
  ahoraS,
);
const sem = T.listarTickets({ contacto: SEM, now: ahoraS });
const de = (a: string) => sem.find((t) => t.asunto === a)!;
check('siembra cada ticket', sem.length === 4);
check('y se miden con el mismo reloj que uno de verdad (Pro crítico: 4 h hábiles)', de('Caída del servidor').sla?.respuesta.vence === bog('2026-09-24T17:00'), iso(de('Caída del servidor').sla?.respuesta.vence));
check('el resuelto trae su respuesta y su cierre', de('Cambio de clave').terminado && de('Cambio de clave').respondido === ahoraS - 30 * HORA + 20 * MIN && de('Cambio de clave').resuelto === ahoraS - 25 * HORA);
check('el que espera al cliente nace en pausa', de('Esperando el respaldo').enPausa && de('Esperando el respaldo').sla?.solucion.estado === 'en_pausa');
const raro = de('Con lo que no existe');
check('🪤 lo que la semilla trae y no existe cae a lo de este negocio', raro.estado === T.estadoInicial() && raro.prioridad === T.configSla().prioridadDeFabrica && raro.tipo === T.configSla().tipoDeFabrica);
check('cada uno queda en la historia de la ficha', listEvents(SEM, 50).filter((e) => e.type === 'ticket' && e.payload.accion === 'creado').length === 4);

// ---------------------------------------------------------------------------------------------------------------
console.log('— Borrar, fusionar y anonimizar se llevan los tickets');
const B1 = cliente('wa:borrar', 'Para borrar', 'Pro');
abrir(B1, 'alta', t0);
deleteContact(B1);
check('borrar una ficha borra sus tickets', cuantos(B1) === 0);
const K = cliente('wa:queda', 'Ferretería La 30', 'Pro');
const D = cliente('wa:sefunde', 'Ferreteria la 30', 'Pro');
abrir(K, 'alta', t0);
abrir(D, 'alta', t0);
abrir(D, 'media', t0);
mergeContacts(K, D, 'Laura');
check('fusionar dos fichas junta sus tickets en la que queda', cuantos(K) === 3 && cuantos(D) === 0, JSON.stringify([cuantos(K), cuantos(D)]));
const A = cliente('wa:anon', 'Datos personales', 'Pro');
abrir(A, 'alta', t0, 'Juan Pérez no puede entrar a su cuenta');
const anonimo = anonimizar(A);
const fila = db.prepare('SELECT asunto FROM tickets WHERE user_id = ?').get(anonimo) as { asunto: string } | undefined;
check('anonimizar pasa el ticket a la ficha anónima y le borra el asunto (puede traer nombres)', cuantos(A) === 0 && fila?.asunto === '', JSON.stringify(fila));
const Z = cliente('wa:todo', 'Borrar del todo', 'Pro');
abrir(Z, 'alta', t0);
borrarDelTodo(Z);
check('borrar del todo, también', cuantos(Z) === 0);

// ---------------------------------------------------------------------------------------------------------------
console.log('— Quién puede qué (y lo decide la configuración)');
check('de fábrica, abrir y mover tickets es de todo el equipo', T.FABRICA.permisos.crear === 'equipo' && T.FABRICA.permisos.mover === 'equipo' && T.puede('equipo', 'asesor'));
check('«los administradores»: el admin del negocio sí, el asesor no', T.puede('admins', 'admin') && !T.puede('admins', 'asesor'));
check('«solo quien administra XENCRM»: ni el admin del negocio; el super y el token a secas, sí', !T.puede('quien_administra', 'admin') && T.puede('quien_administra', 'super') && T.puede('quien_administra', undefined));

const app = new Hono();
mountAdmin(app as never);
const H = { 'x-admin-token': process.env.ADMIN_TOKEN!, 'content-type': 'application/json' };
const pedir = (ruta: string, init: { method?: string; body?: unknown; rol?: string } = {}) =>
  app.request(`/admin/api${ruta}`, { method: init.method ?? 'GET', headers: init.rol ? { ...H, 'x-xencrm-rol': init.rol } : H, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
const nuevoTicket = (rol: string) => pedir('/tickets', { method: 'POST', rol, body: { contacto: PRO, asunto: 'La impresora fiscal no imprime', prioridad: 'alta' } });
const crea = await nuevoTicket('asesor');
check('un asesor abre un ticket', crea.status === 200, String(crea.status));
const creado = (await crea.json()) as { id: number; creadoPor: string };
check('y lo mueve', (await pedir(`/tickets/${creado.id}`, { method: 'PATCH', rol: 'asesor', body: { estado: 'en_progreso' } })).status === 200);
const sinAsunto = await pedir('/tickets', { method: 'POST', rol: 'asesor', body: { contacto: PRO, asunto: 'x' } });
check('un ticket sin asunto vuelve con por qué', sinAsunto.status === 400 && /asunto/.test(((await sinAsunto.json()) as { error: string }).error));
check('el asesor no cambia la configuración del SLA', (await pedir('/sla/config', { method: 'PUT', rol: 'asesor', body: { reglas: { 'sla.riesgoPct': 70 } } })).status === 403);
check('ni el admin del negocio, de fábrica', (await pedir('/sla/config', { method: 'PUT', rol: 'admin', body: { reglas: { 'sla.riesgoPct': 70 } } })).status === 403);
const pone = await pedir('/sla/config', { method: 'PUT', rol: 'super', body: { reglas: { 'sla.permisos.crear': 'admins', 'sla.permisos.mover': 'quien_administra' } } });
check('quien administra XENCRM, sí', pone.status === 200, String(pone.status));
check('🪤 y lo que decide manda: con «abrir tickets: los administradores», el asesor ya no abre y el admin sí', (await nuevoTicket('asesor')).status === 403 && (await nuevoTicket('admin')).status === 200);
check('con «moverlos: solo quien administra», el admin del negocio ya no mueve', (await pedir(`/tickets/${creado.id}`, { method: 'PATCH', rol: 'admin', body: { estado: 'resuelto' } })).status === 403);
const lista = (await (await pedir('/tickets', { rol: 'asesor' })).json()) as { puede: { crear: boolean; mover: boolean } };
check('y el tablero lo sabe, para no ofrecer botones que no abren', lista.puede.crear === false && lista.puede.mover === false);
const fuera = await pedir('/sla/config', { method: 'PUT', rol: 'super', body: { reglas: { 'sla.riesgoPct': 150 } } });
check('lo que no valida vuelve con su campo, para marcarlo', fuera.status === 400 && ((await fuera.json()) as { campo: string }).campo === 'sla.riesgoPct');
const vista = (await (await pedir('/sla/config', { rol: 'asesor' })).json()) as { puedeEditar: boolean; tieneArchivo: boolean; capas: Record<string, string>; reglas: unknown[]; fabrica: { riesgoPct: number } };
check('la configuración se lee, pero dice que el asesor no la edita', vista.puedeEditar === false && vista.tieneArchivo === true && vista.capas['sla.permisos.crear'] === 'tablero' && vista.reglas.length === reglas.length && vista.fabrica.riesgoPct === 75);
check('volver a lo del archivo es de quien puede cambiarla', (await pedir('/sla/config', { method: 'DELETE', rol: 'admin' })).status === 403);
const vuelve = await pedir('/sla/config', { method: 'DELETE', rol: 'super' });
check('y quien puede, vuelve', vuelve.status === 200 && ((await vuelve.json()) as { config: { permisos: { crear: string } } }).config.permisos.crear === 'equipo');
const sla = (await (await pedir('/sla?dias=7', { rol: 'asesor' })).json()) as { respuesta: { a: number; de: number }; config: { planes: unknown[] } };
check('el SLA se lee con sus bases y los nombres de este negocio', typeof sla.respuesta.de === 'number' && sla.config.planes.length === 3);

console.log('— El candado del modo fácil');
check('deja abrir y mover tickets: es atender', frenoDelCandado('tickets', 'POST', 'asesor', 'facil') === null && frenoDelCandado('tickets/12', 'PATCH', 'asesor', 'facil') === null);
check('y leer Tickets, el SLA y su configuración', ['tickets', 'tickets/12', 'sla', 'sla/config'].every((r) => frenoDelCandado(r, 'GET', 'asesor', 'facil') === null));
check('pero no cambiar la configuración del SLA, ni el admin del negocio', frenoDelCandado('sla/config', 'PUT', 'admin', 'facil') !== null && frenoDelCandado('sla/config', 'DELETE', 'admin', 'facil') !== null);
check('ni un segmento de más por la ruta de un ticket', frenoDelCandado('tickets/12/borrar', 'PATCH', 'asesor', 'facil') !== null && frenoDelCandado('tickets/12', 'DELETE', 'asesor', 'facil') !== null);

// ---------------------------------------------------------------------------------------------------------------
console.log('— Lo mínimo del tablero');
const html = readFileSync(new URL('../../public/admin.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../../public/admin.js', import.meta.url), 'utf8');
const ini = js.indexOf('// ===== XEN · Tickets y SLA');
const bloque = js.slice(ini, js.indexOf('// (fin de XEN · Tickets y SLA)'));
check('el código va en su ancla', ini > 0 && bloque.length > 1000);
check('y el estilo en la suya', html.includes('/* ---------- XEN · Tickets y SLA') && html.includes('/* (fin de XEN · Tickets y SLA) */'));
check('las tres pantallas tienen su contenedor', /id="view-tickets"[^]*?id="xt-tickets"/.test(html) && /id="view-sla"[^]*?id="xs-sla"/.test(html) && /id="view-cfg-sla"[^]*?id="xc-cfg"/.test(html));
check('y se cargan al abrirlas', ["alAbrir('tickets'", "alAbrir('sla'", "alAbrir('cfg-sla'"].every((s) => bloque.includes(s)));
check('Configuración › SLA y tickets es de quien administra', /view: 'cfg-sla'[^}]*soloAdmin: true/.test(js) && /VISTAS_DE_QUIEN_ADMINISTRA = \{[^}]*'cfg-sla': 1/.test(js));
const deFabrica = [...T.FABRICA.planes, ...T.FABRICA.prioridades, ...T.FABRICA.tipos, ...T.FABRICA.estados].flatMap((x) => [`'${x.id}'`, `'${x.nombre}'`]).concat([`'${T.FABRICA.campoPlan}'`]);
const aMano = deFabrica.filter((s) => bloque.includes(s));
check('🪤 nada del negocio escrito en el tablero: ni planes, ni prioridades, ni tipos, ni estados de fábrica', !aMano.length, aMano.join(' '));
check('el estado del SLA va siempre con su palabra, no solo con color', ['Incumplido', 'En riesgo', 'A tiempo', 'En pausa', 'Cumplido'].every((w) => bloque.includes(`'${w}'`)) && bloque.includes('Sin SLA'));
check('los diálogos van en el body (no dentro de una vista escondida)', bloque.includes('document.body.appendChild'));
check('el SLA lee el cumplimiento de Mantenimientos, y lo dice si todavía no hay', bloque.includes("'/mantenimientos/cumplimiento") && bloque.includes('Sin datos de mantenimientos todavía'));
check('las políticas en la pantalla del SLA son de lectura, con el camino a Configuración', bloque.includes('Cambiar en Configuración'));

console.log(fail ? `\n${fail} prueba(s) fallaron` : '\nTodo bien');
process.exit(fail ? 1 : 0);
