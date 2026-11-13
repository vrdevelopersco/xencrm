// Pruebas del calendario más completo, sin modelo ni red: pnpm test:agenda
//
// El calendario dejó de ser solo una rejilla de citas: anuncia festivos, días bloqueados, mantenimientos y días casi
// llenos; cuenta el cupo de cada día; trae cada cita con sus datos y un panel «Hoy». Lo que se prueba:
//  · los festivos de Colombia (Emiliani y Semana Santa), calculados para cualquier año;
//  · bloquear y abrir un día, de todas las sedes o de una;
//  · que el asistente NO ofrezca un día bloqueado y que desde el tablero se pueda agendar igual;
//  · el cupo de cada día, con los mismos espacios que ofrece el asistente;
//  · los anuncios: festivo con citas, festivo bloqueado (uno, no dos), cierre, mantenimiento, casi lleno y lleno;
//  · el panel «Hoy»: la próxima, hoy, mañana, recordatorios y cupo;
//  · el enlace de la videollamada: limpio, en el recordatorio y en el .ics;
//  · las rutas, el candado y lo mínimo de la vista.
//
// 🪤 Todo en una carpeta temporal, con fechas fijas en Bogotá (enero de 2027) y un «ahora» que se pasa a mano: no
// depende del día en que se corra. Lo único que mira el reloj de verdad es «el asistente no ofrece un día bloqueado»,
// porque ofrecer espacios es siempre de hoy en adelante; ahí se escoge un día hábil de la semana que viene.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'xencrm-agenda-'));
const base = JSON.parse(readFileSync(new URL('../../xencrm.config.example.json', import.meta.url), 'utf8')) as Record<string, unknown>;
writeFileSync(
  join(dir, 'xencrm.config.json'),
  JSON.stringify({
    ...base,
    timezone: 'America/Bogota',
    // Tres espacios de una hora por la mañana, dos personas a la vez: seis por día.
    appointments: { enabled: true, service: 'demo', location: 'videollamada', durationMin: 60, days: [1, 2, 3, 4, 5], hours: [['09:00', '12:00']], capacity: 2, minLeadHours: 0, maxDaysAhead: 60, reminder: { enabled: true, at: '08:00' } },
  }),
);
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

const F = await import('../crm/festivos.js');
const C = await import('../crm/cierres.js');
const A = await import('../crm/appointments.js');
const V = await import('../crm/agenda-vista.js');
const { touchUser } = await import('../agent/memory.js');
const { getContact, updateContact } = await import('../crm/contacts.js');
const { reminderText } = await import('../crm/reminders.js');
const { appointmentIcs } = await import('../crm/calendar.js');
const { crearMantenimiento } = await import('../crm/mantenimientos.js');
const { planes } = await import('../crm/mantenimientos-reglas.js');
const { frenoDelCandado } = await import('../channels/candado.js');
const { Hono } = await import('hono');
const { mountAdmin } = await import('../channels/admin.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};
/** Una hora de Bogotá (UTC−5, sin cambio de hora): «2027-01-13T09:00». */
const bog = (s: string) => new Date(`${s}:00-05:00`).getTime();
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const cliente = (id: string, nombre: string, data: Record<string, unknown> = {}) => {
  touchUser(id, 'whatsapp', nombre);
  updateContact(id, { data }, { silent: true });
  return id;
};
let n = 0;
const alguien = () => cliente(`57300222${String(++n).padStart(4, '0')}`, `Cliente ${n}`);
const agendar = (cuando: string, quien = alguien()) => A.bookAppointment(quien, new Date(bog(cuando)), { by: 'Laura', desdeElTablero: true });

// ---------------------------------------------------------------------------------------------------------------
console.log('— Festivos de Colombia');
check('la Pascua de 2025, 2026 y 2027', iso(F.pascua(2025)) === '2025-04-20' && iso(F.pascua(2026)) === '2026-04-05' && iso(F.pascua(2027)) === '2027-03-28');
const de2026 = F.festivosCO(2026).map((f) => f.fecha);
const esperados2026 = ['2026-01-01', '2026-01-12', '2026-03-23', '2026-04-02', '2026-04-03', '2026-05-01', '2026-05-18', '2026-06-08', '2026-06-15', '2026-06-29', '2026-07-20', '2026-08-07', '2026-08-17', '2026-10-12', '2026-11-02', '2026-11-16', '2026-12-08', '2026-12-25'];
check('los dieciocho de 2026, en orden', JSON.stringify(de2026) === JSON.stringify(esperados2026), de2026.join(' '));
const de2027 = new Map(F.festivosCO(2027).map((f) => [f.fecha, f.nombre]));
check('2027: Reyes y San José se corren al lunes; Semana Santa cae jueves y viernes', de2027.get('2027-01-11') === 'Reyes Magos' && de2027.get('2027-03-22') === 'San José' && de2027.get('2027-03-25') === 'Jueves Santo' && de2027.get('2027-03-26') === 'Viernes Santo');
check('2027: el 1 de noviembre ya es lunes y se queda; el 11 se va al 15', de2027.get('2027-11-01') === 'Todos los Santos' && de2027.get('2027-11-15') === 'Independencia de Cartagena');
const corridos = ['Reyes Magos', 'San José', 'Ascensión del Señor', 'Corpus Christi', 'Sagrado Corazón', 'San Pedro y San Pablo', 'Asunción de la Virgen', 'Día de la Raza', 'Todos los Santos', 'Independencia de Cartagena'];
check('los de la Ley Emiliani siempre caen en lunes (2020–2035)', Array.from({ length: 16 }, (_, i) => 2020 + i).every((y) => F.festivosCO(y).filter((f) => corridos.includes(f.nombre)).every((f) => new Date(`${f.fecha}T12:00:00Z`).getUTCDay() === 1)));
check('entre dos fechas, solo los de ese rango', JSON.stringify(F.festivosEntre('2026-11-01', '2026-11-30').map((f) => f.fecha)) === '["2026-11-02","2026-11-16"]');
check('el país sale de la zona horaria si no se dice (Bogotá: Colombia)', F.paisDeFestivos() === 'CO');
check('sin país, ningún festivo', F.festivosEntre('2026-01-01', '2026-12-31', '').length === 0);

// ---------------------------------------------------------------------------------------------------------------
console.log('— Bloquear y abrir un día');
C.cerrarDia('2027-02-01', { motivo: 'Inventario', por: 'Laura' });
check('un día bloqueado para todas vale para cualquier sede', C.diaCerrado('2027-02-01') && C.diaCerrado('2027-02-01', 'norte'));
C.cerrarDia('2027-02-02', { sede: 'norte', motivo: 'Fumigación' });
check('el de una sede no cierra la otra ni el negocio entero', C.diaCerrado('2027-02-02', 'norte') && !C.diaCerrado('2027-02-02', 'sur') && !C.diaCerrado('2027-02-02'));
C.cerrarDia('2027-02-01', { motivo: 'Inventario anual' });
const febrero = C.cierresEntre('2027-02-01', '2027-02-28');
check('bloquear dos veces cambia el motivo, no duplica', febrero.filter((c) => c.fecha === '2027-02-01').length === 1 && febrero.find((c) => c.fecha === '2027-02-01')?.motivo === 'Inventario anual');
check('con sede, la lista trae los de todas y los suyos', C.cierresEntre('2027-02-01', '2027-02-28', 'sur').length === 1 && C.cierresEntre('2027-02-01', '2027-02-28', 'norte').length === 2);
check('abrir dice si había algo que abrir', C.abrirDia('2027-02-01') && !C.abrirDia('2027-02-01') && !C.diaCerrado('2027-02-01'));
C.abrirDia('2027-02-02', 'norte');
check('una fecha mal escrita no se guarda', (() => { try { C.cerrarDia('2027-13-01'); return false; } catch { return true; } })() && !C.esFecha('mañana') && C.esFecha('2027-02-03'));

// ---------------------------------------------------------------------------------------------------------------
console.log('— El asistente no ofrece un día bloqueado');
// Un día hábil de la semana que viene (lo que ofrece el asistente es siempre de hoy en adelante).
const hoyB = A.tzParts(new Date());
let objetivo = '';
for (let i = 3; i < 14 && !objetivo; i++) {
  const p = A.tzParts(new Date(Date.UTC(hoyB.y, hoyB.m - 1, hoyB.d + i, 17)));
  if (p.wd >= 1 && p.wd <= 5) objetivo = A.dayKey(p.y, p.m, p.d);
}
const ese = { days: [objetivo], label: 'ese día' };
const antes = A.availableSlots({ when: ese, count: 10 });
check('antes de bloquearlo, ese día tiene sus tres espacios', antes.length === 3, `${objetivo}: ${antes.length}`);
C.cerrarDia(objetivo, { motivo: 'Viaje' });
check('bloqueado, no ofrece ninguno', A.availableSlots({ when: ese, count: 10 }).length === 0);
check('ni lo mete entre los próximos', A.availableSlots({ count: 8, spreadDays: false }).every((s) => { const p = A.tzParts(s.startsAt); return A.dayKey(p.y, p.m, p.d) !== objetivo; }));
const espacio = antes[0]!.startsAt;
check('para el asistente ese espacio no está libre; para quien agenda a mano, sí', !A.isSlotFree(espacio) && A.isSlotFree(espacio, { includeBusy: false }));
const delBot = (() => { try { A.bookAppointment(alguien(), espacio, { by: 'bot' }); return 'agendó'; } catch (e) { return (e as Error).message; } })();
check('el asistente no puede agendarlo', delBot === 'ese espacio ya no está disponible', delBot);
check('desde el tablero se agenda igual (quien agenda a mano sabe lo que hace)', A.bookAppointment(alguien(), espacio, { by: 'Laura', desdeElTablero: true }).status === 'confirmada');
C.abrirDia(objetivo);
check('abierto otra vez, vuelve a ofrecerlo', A.availableSlots({ when: ese, count: 10 }).length === 3, String(A.availableSlots({ when: ese, count: 10 }).length));

// ---------------------------------------------------------------------------------------------------------------
console.log('— El cupo de cada día');
const antesDeTodo = bog('2027-01-10T08:00'); // domingo
agendar('2027-01-12T09:00');
agendar('2027-01-12T09:00');
const martes = A.cupoPorDia(bog('2027-01-12T00:00'), bog('2027-01-12T23:59'), { now: antesDeTodo })[0]!;
check('seis espacios (tres horas × dos a la vez); dos tomados, cuatro libres', martes.total === 6 && martes.ocupados === 2 && martes.libres === 4, JSON.stringify(martes));
const enLaMañana = A.cupoPorDia(bog('2027-01-12T00:00'), bog('2027-01-12T23:59'), { now: bog('2027-01-12T10:30') })[0]!;
check('el mismo día a media mañana, libres solo cuenta lo que aún se puede agendar', enLaMañana.libres === 2 && enLaMañana.ocupados === 2, JSON.stringify(enLaMañana));
const finde = A.cupoPorDia(bog('2027-01-16T00:00'), bog('2027-01-17T23:59'), { now: antesDeTodo });
check('el fin de semana no se atiende: ni abierto ni bloqueado', finde.length === 2 && finde.every((d) => !d.abierto && !d.cerrado && d.total === 0));
C.cerrarDia('2027-01-15', { motivo: 'Capacitación del equipo' });
const viernes = A.cupoPorDia(bog('2027-01-15T00:00'), bog('2027-01-15T23:59'), { now: antesDeTodo })[0]!;
check('un día bloqueado: cerrado y sin cupo', viernes.cerrado && !viernes.abierto && viernes.total === 0);

// ---------------------------------------------------------------------------------------------------------------
console.log('— Los anuncios');
const valentina = cliente('573001119001', 'Valentina Ríos', { empresa: 'Café Aroma', valor: 4800 });
const reyes1 = agendar('2027-01-11T09:00', valentina);
agendar('2027-01-11T09:00');
for (const h of ['09:00', '09:00', '10:00', '10:00', '11:00']) agendar(`2027-01-13T${h}`); // 5 de 6
for (const h of ['09:00', '09:00', '10:00', '10:00', '11:00', '11:00']) agendar(`2027-01-14T${h}`); // 6 de 6
const plan = planes()[0]?.id ?? '';
const mant = crearMantenimiento({ titulo: 'Migración a la nube nueva', producto: 'Nube e infraestructura', inicio: bog('2027-01-12T22:00'), duracionMin: 120, planes: [plan] }, 'Laura', antesDeTodo);
check('(un mantenimiento programado el martes por la noche)', 'ok' in mant, JSON.stringify(mant));
const semana = () => V.vistaDeAgenda(bog('2027-01-11T00:00'), bog('2027-01-17T23:59'), null, antesDeTodo);
let vista = semana();
const del = (fecha: string, tipo: string) => vista.anuncios.filter((a) => a.fecha === fecha && a.tipo === tipo);
check('el festivo de Reyes, con las dos citas que ya tiene, y abierto', del('2027-01-11', 'festivo').length === 1 && del('2027-01-11', 'festivo')[0]!.titulo === 'Reyes Magos' && del('2027-01-11', 'festivo')[0]!.agendadas === 2 && !del('2027-01-11', 'festivo')[0]!.cerrado);
check('el mantenimiento, en el día en que empieza, con su hora', del('2027-01-12', 'mantenimiento').length === 1 && del('2027-01-12', 'mantenimiento')[0]!.inicio === bog('2027-01-12T22:00') && del('2027-01-12', 'mantenimiento')[0]!.producto === 'Nube e infraestructura');
check('el miércoles, con 5 de 6, casi lleno (desde el 80 %), y lo que le queda', del('2027-01-13', 'casi_lleno').length === 1 && del('2027-01-13', 'casi_lleno')[0]!.libres === 1);
check('el jueves, con 6 de 6, lleno', del('2027-01-14', 'lleno').length === 1 && del('2027-01-14', 'casi_lleno').length === 0);
check('el martes, con 2 de 6, sin aviso de cupo', del('2027-01-12', 'casi_lleno').length === 0 && del('2027-01-12', 'lleno').length === 0);
check('el viernes bloqueado, con su motivo', del('2027-01-15', 'cierre').length === 1 && del('2027-01-15', 'cierre')[0]!.titulo === 'Capacitación del equipo' && del('2027-01-15', 'cierre')[0]!.cerrado === true);
check('en orden de fecha', vista.anuncios.map((a) => a.fecha).join() === vista.anuncios.map((a) => a.fecha).sort().join());
C.cerrarDia('2027-01-11', { motivo: 'Reyes Magos' });
vista = semana();
check('🪤 un festivo bloqueado es UN anuncio (el festivo, cerrado), no dos', del('2027-01-11', 'festivo').length === 1 && del('2027-01-11', 'festivo')[0]!.cerrado === true && del('2027-01-11', 'cierre').length === 0);
C.abrirDia('2027-01-11');
check('de un día que ya pasó no se anuncia «casi lleno»', V.vistaDeAgenda(bog('2027-01-11T00:00'), bog('2027-01-17T23:59'), null, bog('2027-01-14T12:00')).anuncios.every((a) => !(a.tipo === 'casi_lleno' && a.fecha === '2027-01-13')));
check('dice de qué país son los festivos', vista.festivos === 'CO');

// ---------------------------------------------------------------------------------------------------------------
console.log('— Cada cita con sus datos');
const conDatos = V.citaConDatos(reyes1);
check('canal, empresa, etapa y el valor puesto a mano', conDatos.canal === 'whatsapp' && conDatos.empresa === 'Café Aroma' && conDatos.valor === 4800 && Boolean(conDatos.etapaNombre), JSON.stringify({ canal: conDatos.canal, empresa: conDatos.empresa, valor: conDatos.valor, etapa: conDatos.etapaNombre }));
check('y cuándo sale su recordatorio (la mañana de la cita, a las 8:00)', conDatos.remindAt === bog('2027-01-11T08:00'));

// ---------------------------------------------------------------------------------------------------------------
console.log('— El panel «Hoy»');
const panel = V.panelHoy(null, bog('2027-01-13T08:30'));
check('la próxima es la primera de hoy que no ha terminado', panel.proxima !== null && panel.proxima.startsAt === bog('2027-01-13T09:00'));
check('hoy trae las cinco de hoy y mañana las seis del jueves', panel.hoy.length === 5 && panel.manana.length === 6, `${panel.hoy.length} / ${panel.manana.length}`);
check('el cupo de los próximos días que se atienden (cinco, la regla), con el bloqueado', panel.cupo.length === 5 && panel.cupo.some((c) => c.fecha === '2027-01-15' && c.cerrado) && panel.cupo.every((c) => c.abierto || c.cerrado));
check('los recordatorios de mañana, programados', panel.recordatorios.activos && panel.recordatorios.lista.filter((r) => r.estado === 'programado').length === 6);
const enCurso = V.panelHoy(null, bog('2027-01-13T09:30'));
check('la que está en curso sigue siendo «la próxima» hasta que termina', enCurso.proxima?.startsAt === bog('2027-01-13T09:00'));
check('un festivo en el cupo lleva su nombre', V.panelHoy(null, bog('2027-01-08T08:00')).cupo.some((c) => c.fecha === '2027-01-11' && (c as { festivo?: string }).festivo === 'Reyes Magos'));

// ---------------------------------------------------------------------------------------------------------------
console.log('— El enlace de la videollamada');
check('se completa lo pegado sin https://', A.enlaceLimpio('meet.google.com/abc-defg-hij') === 'https://meet.google.com/abc-defg-hij');
check('🪤 solo http(s): ni javascript: ni ftp:', A.enlaceLimpio('javascript:alert(1)') === null && A.enlaceLimpio('ftp://archivos.ejemplo.com') === null && A.enlaceLimpio('https://zoom.us/j/123') === 'https://zoom.us/j/123');
check('vacío lo quita; uno larguísimo no entra', A.enlaceLimpio('  ') === '' && A.enlaceLimpio(`https://x.co/${'a'.repeat(600)}`) === null);
const sinEnlace = reminderText(reyes1, getContact(valentina), bog('2027-01-11T08:00'));
check('sin enlace, el recordatorio es el de siempre', !sinEnlace.includes('Para entrar') && sinEnlace.includes('. ¿Nos confirmas que vienes?'), sinEnlace);
const conEnlace = A.updateAppointment(reyes1.id, { enlace: 'https://meet.google.com/abc-defg-hij' }, 'Laura')!;
check('se guarda con la cita', conEnlace.enlace === 'https://meet.google.com/abc-defg-hij');
const texto = reminderText(conEnlace, getContact(valentina), bog('2027-01-11T08:00'));
check('y sale en el recordatorio, en su propio renglón', texto.includes('\nPara entrar: https://meet.google.com/abc-defg-hij\n¿Nos confirmas'), texto);
const ics = appointmentIcs(conEnlace);
check('y en el .ics de la cita (URL y descripción)', ics.includes('URL:https://meet.google.com/abc-defg-hij') && ics.includes('Para entrar: https://meet.google.com/abc-defg-hij'));

// ---------------------------------------------------------------------------------------------------------------
console.log('— Las rutas y el candado');
const app = new Hono();
mountAdmin(app as never);
const H = { 'x-admin-token': process.env.ADMIN_TOKEN!, 'content-type': 'application/json' };
const pedir = (ruta: string, init: { method?: string; body?: unknown } = {}) => app.request(`/admin/api${ruta}`, { method: init.method ?? 'GET', headers: H, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
const r1 = await pedir(`/agenda?from=${bog('2027-01-11T00:00')}&to=${bog('2027-01-17T23:59')}`);
const j1 = (await r1.json()) as { cupo: unknown[]; anuncios: { tipo: string }[] };
check('/agenda da el cupo de los siete días y los anuncios', r1.status === 200 && j1.cupo.length === 7 && j1.anuncios.some((a) => a.tipo === 'festivo'));
check('un rango de más de 62 días o mal escrito se rechaza', (await pedir(`/agenda?from=0&to=${bog('2027-01-17T00:00')}`)).status === 400 && (await pedir('/agenda?from=ayer&to=hoy')).status === 400);
check('/agenda/hoy contesta', (await pedir('/agenda/hoy')).status === 200);
const bloquea = await pedir('/agenda/cierres', { method: 'POST', body: { fecha: '2027-03-01', motivo: 'Viaje' } });
check('POST /agenda/cierres bloquea el día', bloquea.status === 200 && C.diaCerrado('2027-03-01'));
check('con una fecha mal escrita o una sede que no existe, 400', (await pedir('/agenda/cierres', { method: 'POST', body: { fecha: 'lunes' } })).status === 400 && (await pedir('/agenda/cierres', { method: 'POST', body: { fecha: '2027-03-02', sede: 'luna' } })).status === 400);
const abre = (await (await pedir('/agenda/cierres/2027-03-01', { method: 'DELETE' })).json()) as { abierto: boolean };
check('DELETE /agenda/cierres/:fecha lo abre', abre.abierto === true && !C.diaCerrado('2027-03-01'));
check('el enlace se cambia con el PATCH de siempre, y uno peligroso da 400', (await pedir(`/appointments/${reyes1.id}`, { method: 'PATCH', body: { enlace: 'javascript:alert(1)' } })).status === 400 && ((await (await pedir(`/appointments/${reyes1.id}`, { method: 'PATCH', body: { enlace: 'zoom.us/j/9' } })).json()) as { appointment: { enlace: string } }).appointment.enlace === 'https://zoom.us/j/9');
const lista = (await (await pedir(`/appointments?from=${bog('2027-01-11T00:00')}&to=${bog('2027-01-11T23:59')}`)).json()) as { canal: string; remindAt: number | null; empresa: string | null }[];
check('/appointments trae cada cita con sus datos', lista.length === 2 && lista.every((a) => a.canal === 'whatsapp' && typeof a.remindAt === 'number') && lista.some((a) => a.empresa === 'Café Aroma'));
check('el candado deja ver el calendario', frenoDelCandado('agenda', 'GET', 'asesor', 'facil') === null && frenoDelCandado('agenda/hoy', 'GET', 'asesor', 'facil') === null);
check('🪤 pero bloquear o abrir un día es de quien administra (cambia lo que ofrece el asistente)', frenoDelCandado('agenda/cierres', 'POST', 'asesor', 'facil') !== null && frenoDelCandado('agenda/cierres/2027-03-01', 'DELETE', 'asesor', 'facil') !== null);
check('poner el enlace es atender: el candado lo deja', frenoDelCandado(`appointments/${reyes1.id}`, 'PATCH', 'asesor', 'facil') === null);

// ---------------------------------------------------------------------------------------------------------------
console.log('— Lo mínimo de la vista');
const html = readFileSync(new URL('../../public/admin.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../../public/admin.js', import.meta.url), 'utf8');
const bloque = js.slice(js.indexOf('// ---------- calendario (vista semanal tipo agenda)'), js.indexOf('// ---------- análisis ----------'));
const vistaHtml = html.slice(html.indexOf('<section class="view" id="view-calendar">'), html.indexOf('<!-- Análisis -->'));
check('pide el cupo y los anuncios del rango que se mira, y el panel', bloque.includes("'/agenda?from='") && bloque.includes("'/agenda/hoy'"));
check('las citas que se cruzan van en carriles, una al lado de la otra', bloque.includes('function carriles(') && bloque.includes("left:calc(' + (x.carril * ancho)"));
check('rayas cada media hora (cada cuarto con citas cortas)', bloque.includes("(cfg.durationMin || 30) < 30 ? 15 : 30") && html.includes('background-size:100% var(--hour-px),100% var(--sub-px,var(--hour-px))'));
check('cada cita es un botón con su etiqueta para lectores de pantalla', bloque.includes('<button type="button" class="cal-ev \'') && bloque.includes("aria-label=\"' + esc(etiquetaCita(a))"));
check('cancelar se confirma diciendo cuál y que XENCRM no le avisa', bloque.includes('XENCRM no le avisa: díselo tú en el chat.') && bloque.includes("data-si>Sí, cancelar '"));
check('la vista rápida se cierra con Escape y devuelve el foco', bloque.includes("e.key === 'Escape' && !$('cal-pop').hidden") && bloque.includes('el.focus()'));
check('🪤 un botón que se reemplaza al tocarlo no cierra la vista («Cancelar…» → confirmación)', bloque.includes('e.target.isConnected && !pop.contains(e.target)'));
check('quien tiene el candado no ve «Bloquear el día»', bloque.includes('var bloquear = enCandado() ||'));
check('el lado: «Próxima», «Hoy» y agendar; la vista rápida es un diálogo y hay un anunciador', vistaHtml.includes('id="cal-proxima"') && vistaHtml.includes('id="cal-hoy"') && vistaHtml.includes('class="cal-pop" id="cal-pop" role="dialog"') && vistaHtml.includes('id="cal-anuncio" role="status"'));
check('en el celular «Próxima» sube encima del calendario', /@media \(max-width:900px\)\{\s*:root\[data-piel="xen"\] \.cal-lado\{display:contents\}\s*:root\[data-piel="xen"\] #view-calendar \.cal-proxima\{order:-1\}/.test(html));
check('el latido de «Próxima» respeta el movimiento reducido', html.includes('@media (prefers-reduced-motion:reduce){:root[data-piel="xen"] .cal-proxima.pronto .hp-cuenta::before{animation:none}}'));

console.log(fail ? `\n${fail} prueba(s) fallaron` : '\nTodo bien');
process.exit(fail ? 1 : 0);
