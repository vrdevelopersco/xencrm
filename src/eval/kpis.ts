// Pruebas de los KPIs y las metas, sin modelo: pnpm test:kpis
//
// Los objetivos de Dynamics 365 con los datos de XENCRM (crm/kpis.ts). Aquí se prueba que cada cifra sale de lo que
// pasó de verdad y cae en su periodo (un trato se cierra cuando lo dice su evento, no cuando escribió por última vez),
// que lo que no se sabe no se dice cero, que por persona solo cuenta lo atribuible, que las metas se limpian como las
// escribe la gente y se guardan todo o nada, que el ritmo del mes se mide en la zona del negocio, y que las metas
// solo las cambia quien administra (el candado y la consola).
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'xencrm-kpis-')), 'xencrm.db');
process.env.ADMIN_TOKEN = 'token-del-tablero-de-prueba-0123456789';
const { getDb } = await import('../rag/store.js');
const { calcularKpis, limpiarMetas, numeroEscrito, periodoDelCalendario, guardarMetas, leerMetas, KPIS } = await import('../crm/kpis.js');
const { frenoDelCandado } = await import('../channels/candado.js');
const { Hono } = await import('hono');
const { mountAdmin } = await import('../channels/admin.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};
const js = readFileSync(new URL('../../public/admin.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../../public/admin.html', import.meta.url), 'utf8');
const consola = readFileSync(new URL('../consola.ts', import.meta.url), 'utf8');

const DIA = 86400_000;
// Un «ahora» fijo, a media mañana de un martes en Bogotá (2026-11-10 10:30 −05:00), para que el mes y la semana
// del calendario no dependan del día en que se corra la prueba.
const AHORA = Date.UTC(2026, 10, 10, 15, 30);
const db = getDb();
const usuario = db.prepare('INSERT INTO users (id, channel, name, first_seen, last_seen, stage, data, archived, responsable) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
const mensaje = db.prepare('INSERT INTO messages (user_id, role, content, ts, author, by) VALUES (?, ?, ?, ?, ?, ?)');
const evento = db.prepare('INSERT INTO events (user_id, ts, type, payload) VALUES (?, ?, ?, ?)');
const cita = db.prepare('INSERT INTO appointments (user_id, starts_at, ends_at, service, status, created_at) VALUES (?, ?, ?, ?, ?, ?)');
const hace = (dias: number, horas = 0) => AHORA - dias * DIA - horas * 3600_000;

// En el periodo (los últimos 30 días): cuatro conversaciones nuevas, una de ellas en un grupo (no cuenta) y una archivada (tampoco).
usuario.run('wa:1@s.whatsapp.net', 'whatsapp', 'Ana', hace(5), hace(1), 'vendido', JSON.stringify({ valor: 1_000_000 }), 0, 'Laura');
usuario.run('wa:2@s.whatsapp.net', 'whatsapp', 'Beto', hace(6), hace(1), 'perdido', '{}', 0, 'Bryan');
usuario.run('wa:3@s.whatsapp.net', 'whatsapp', 'Caro', hace(7), hace(2), 'interesado', JSON.stringify({ valor: 500_000 }), 0, 'Laura');
usuario.run('wa:4@s.whatsapp.net', 'web', 'Dani', hace(8), hace(3), 'vendido', '{}', 0, 'bot');
usuario.run('120363@g.us', 'whatsapp', 'Grupo', hace(9), hace(1), 'nuevo', '{}', 0, null);
usuario.run('wa:5@s.whatsapp.net', 'whatsapp', 'Archivada', hace(9), hace(9), 'nuevo', '{}', 1, null);
// En el periodo anterior (30 a 60 días): una nueva, ganada entonces, y que volvió a escribir AYER.
usuario.run('wa:6@s.whatsapp.net', 'whatsapp', 'Eva', hace(40), hace(1), 'vendido', JSON.stringify({ valor: 2_000_000 }), 0, 'Laura');

// Los cierres, por su evento: Ana ganó hace 2 días; Dani ganó hace 3 (sin valor); Beto perdió hace 4; Eva ganó hace 35.
evento.run('wa:1@s.whatsapp.net', hace(2), 'stage', JSON.stringify({ from: 'interesado', to: 'vendido', by: 'Laura' }));
evento.run('wa:4@s.whatsapp.net', hace(3), 'stage', JSON.stringify({ from: 'nuevo', to: 'vendido', by: 'bot' }));
evento.run('wa:2@s.whatsapp.net', hace(4), 'stage', JSON.stringify({ from: 'nuevo', to: 'perdido', by: 'Bryan' }));
evento.run('wa:6@s.whatsapp.net', hace(35), 'stage', JSON.stringify({ from: 'interesado', to: 'vendido', by: 'Laura' }));

// Las esperas: Ana espera 2 min y contesta el agente; Caro espera 30 min y contesta Laura; Beto espera 10 min y contesta
// «admin» (el token a secas: no es una persona). Todo un martes a media mañana, dentro de cualquier horario razonable.
const martes = Date.UTC(2026, 10, 3, 15, 0); // 2026-11-03 10:00 en Bogotá
mensaje.run('wa:1@s.whatsapp.net', 'user', 'hola', martes, 'customer', null);
mensaje.run('wa:1@s.whatsapp.net', 'assistant', 'hola, ¿en qué te ayudo?', martes + 2 * 60_000, 'bot', null);
mensaje.run('wa:3@s.whatsapp.net', 'user', 'precio?', martes + 3600_000, 'customer', null);
mensaje.run('wa:3@s.whatsapp.net', 'assistant', 'te cuento', martes + 3600_000 + 30 * 60_000, 'human', 'Laura');
mensaje.run('wa:2@s.whatsapp.net', 'user', 'hola', martes + 7200_000, 'customer', null);
mensaje.run('wa:2@s.whatsapp.net', 'assistant', 'hola', martes + 7200_000 + 10 * 60_000, 'human', 'admin');
// Una que sigue esperando ahora.
mensaje.run('wa:4@s.whatsapp.net', 'user', '¿siguen ahí?', AHORA - 5 * 60_000, 'customer', null);

// Citas: dos agendadas en el periodo (una cumplida, una que pasó sin marcar); una agendada en el periodo anterior.
cita.run('wa:1@s.whatsapp.net', hace(3), hace(3) + 3600_000, 'asesoría', 'completada', hace(6));
cita.run('wa:3@s.whatsapp.net', hace(2), hace(2) + 3600_000, 'asesoría', 'confirmada', hace(5));
cita.run('wa:6@s.whatsapp.net', hace(36), hace(36) + 3600_000, 'asesoría', 'no_asistio', hace(38));

console.log('— Las cifras del periodo, y contra el anterior');
const k = calcularKpis({ dias: 30, acuerdoMin: 15, ahora: AHORA });
check('conversaciones nuevas: 4 (sin el grupo ni la archivada), contra 1 antes', k.actual.nuevas === 4 && k.anterior.nuevas === 1, `${k.actual.nuevas} / ${k.anterior.nuevas}`);
check('🪤 Eva ganó hace 35 días y escribió ayer: cuenta en el periodo ANTERIOR, por su evento', k.actual.ganados === 2 && k.anterior.ganados === 1, `${k.actual.ganados} / ${k.anterior.ganados}`);
check('perdidos: 1 y tasa de cierre 66,7 % (2 de 3)', k.actual.perdidos === 1 && k.actual.cierre === 66.7, `${k.actual.perdidos} · ${k.actual.cierre}`);
check('ventas: solo lo que tiene valor ($1.000.000) y se dice cuántos lo tienen (1 de 2)', k.actual.ventas === 1_000_000 && k.actual.ventasConPrecio === 1);
check('respuesta: la mediana de 2, 10 y 30 min es 10 min', k.valores.actual.respuesta === 10, String(k.valores.actual.respuesta));
check('contestadas a tiempo (acuerdo de 15 min): 2 de 3 = 66,7 %', k.actual.aTiempo === 66.7, String(k.actual.aTiempo));
check('citas agendadas: 2, contra 1 antes', k.actual.citas === 2 && k.anterior.citas === 1);
check('asistencia: 1 de 1 marcada (la que nadie marcó se dice aparte, no cuenta como falta)', k.actual.asistencia === 100 && k.actual.citasMarcadas === 1 && k.actual.citasSinMarcar === 1, JSON.stringify(k.actual));
check('y la del periodo anterior: 0 % (la marcaron «no vino»), que sí es un cero de verdad', k.anterior.asistencia === 0);
check('lo que sigue esperando ahora se cuenta (1)', k.esperandoAhora === 1, String(k.esperandoAhora));

console.log('— Lo que no se sabe no es cero');
const vacio = calcularKpis({ dias: 7, acuerdoMin: 15, ahora: AHORA - 300 * DIA });
check('sin respuestas, el tiempo de respuesta es null (no «0 min»)', vacio.valores.actual.respuesta === null && vacio.valores.actual.aTiempo === null);
check('sin cerrados, la tasa de cierre es null (no «0 %»)', vacio.valores.actual.cierre === null);
check('sin citas marcadas, la asistencia es null', vacio.valores.actual.asistencia === null);
check('🪤 ganados sin ningún precio: las ventas son null («Sin precios»), no $0', (() => {
  const solo = calcularKpis({ dias: 7, acuerdoMin: 15, ahora: hace(0) - 2.5 * DIA }); // en esa semana solo ganó Dani, sin valor
  return solo.actual.ganados >= 1 && solo.actual.ventasConPrecio === 0 ? solo.valores.actual.ventas === null : false;
})());
check('el embudo es una foto de hoy: en el periodo anterior es null, no se inventa', k.valores.anterior.embudo === null);
check('el embudo abierto vale lo de Caro ($500.000)', k.valores.actual.embudo === 500_000, String(k.valores.actual.embudo));

console.log('— Por persona, solo lo atribuible');
const laura = k.porPersona.find((p) => p.nombre === 'Laura');
const bryan = k.porPersona.find((p) => p.nombre === 'Bryan');
check('Laura: ganó a Ana ($1.000.000) en el periodo; Eva es del anterior', laura?.ganados === 1 && laura?.ventas === 1_000_000, JSON.stringify(laura));
check('Laura: 1 asignado abierto (Caro), 1 respuesta en 30 min', laura?.asignados === 1 && laura?.respuestas === 1 && laura?.respuestaMs === 30 * 60_000, JSON.stringify(laura));
check('Bryan: perdió a Beto y no tiene nada abierto: no suma ganados ni la respuesta de «admin» (ni siquiera sale)', !bryan || (bryan.ganados === 0 && bryan.respuestas === 0), JSON.stringify(bryan));
check('🪤 «bot» y «admin» no son personas: no salen en la tabla', !k.porPersona.some((p) => /^(bot|admin)$/i.test(p.nombre)), k.porPersona.map((p) => p.nombre).join(','));
check('el agente de IA va aparte, con sus respuestas (1, en 2 min)', k.agente.respuestas === 1 && k.agente.respuestaMs === 2 * 60_000, JSON.stringify(k.agente));
check('la tabla va de quien más ganó a quien menos', k.porPersona[0]?.nombre === 'Laura');

console.log('— El calendario del negocio');
const mes = periodoDelCalendario('mes', AHORA, 'America/Bogota');
const semana = periodoDelCalendario('semana', AHORA, 'America/Bogota');
check('el mes empieza el 1 a medianoche en Bogotá (05:00 UTC), no a medianoche del servidor', mes.desde === Date.UTC(2026, 10, 1, 5) && mes.hasta === Date.UTC(2026, 11, 1, 5), new Date(mes.desde).toISOString());
check('la semana empieza el lunes', semana.desde === Date.UTC(2026, 10, 9, 5) && semana.hasta === Date.UTC(2026, 10, 16, 5), new Date(semana.desde).toISOString());
const dic = periodoDelCalendario('mes', Date.UTC(2026, 11, 31, 20), 'America/Bogota');
check('diciembre termina el 1 de enero del año siguiente', dic.hasta === Date.UTC(2027, 0, 1, 5));

console.log('— Las metas se escriben como las escribe la gente');
check('«$ 8.000.000» son ocho millones', numeroEscrito('$ 8.000.000') === 8_000_000);
check('«4,5» es cuatro y medio; «1.500» es mil quinientos; «4.5» es cuatro y medio', numeroEscrito('4,5') === 4.5 && numeroEscrito('1.500') === 1500 && numeroEscrito('4.5') === 4.5);
check('«90 %» y «20 citas» se limpian', numeroEscrito('90 %') === 90 && numeroEscrito('20 citas') === 20);
const bien = limpiarMetas({ citas: { valor: '20 citas', periodo: 'mes' }, ventas: { valor: '$ 8.000.000' }, respuesta: '5', nuevas: { valor: '15', periodo: 'semana' }, perdidos: { valor: 3 }, cierre: { valor: '' } });
check('se guardan limpias, con su periodo', 'metas' in bien && bien.metas.citas?.valor === 20 && bien.metas.ventas?.valor === 8_000_000 && bien.metas.respuesta?.valor === 5 && bien.metas.nuevas?.periodo === 'semana', JSON.stringify(bien));
check('perdidos no admite meta (nadie se propone perder) y una vacía se quita', 'metas' in bien && !bien.metas.perdidos && !bien.metas.cierre);
const mal = limpiarMetas({ citas: { valor: 20 }, cierre: { valor: '150' } });
check('🪤 un porcentaje de 150 se rechaza, nombra el campo y no se guarda NINGUNA (todo o nada)', 'error' in mal && mal.campo === 'cierre' && /porcentaje entre 1 y 100/.test(mal.error), JSON.stringify(mal));
check('un número negativo o letras sueltas también', 'error' in limpiarMetas({ citas: { valor: '-3' } }) && 'error' in limpiarMetas({ ganados: { valor: 'muchos' } }));

console.log('— El avance de las metas y su ritmo');
guardarMetas({ citas: { valor: 4, periodo: 'mes' }, ganados: { valor: 2, periodo: 'mes' }, ventas: { valor: 900_000, periodo: 'mes' }, respuesta: { valor: 5, periodo: 'mes' }, cierre: { valor: 50, periodo: 'mes' } });
const conMetas = calcularKpis({ dias: 30, acuerdoMin: 15, ahora: AHORA });
const av = (id: string) => conMetas.avance.find((a) => a.kpi === id);
check('leerMetas devuelve lo guardado', Object.keys(leerMetas()).length === 5);
check('citas: van 2 de 4 el 10 de noviembre; el ritmo pedía 1,2 → a tiempo', av('citas')?.valor === 2 && Math.abs((av('citas')?.esperado ?? 0) - 1.2) < 0.15 && av('citas')?.estado === 'a_tiempo', JSON.stringify(av('citas')));
check('ganados: 2 de 2 → cumplida', av('ganados')?.estado === 'cumplida');
check('ventas: $1.000.000 de $900.000 → cumplida', av('ventas')?.estado === 'cumplida');
check('respuesta: 10 min contra un máximo de 5 → no cumple (más es peor)', av('respuesta')?.estado === 'no_cumple' && av('respuesta')?.valor === 10);
check('cierre: 66,7 % contra un mínimo de 50 → cumple', av('cierre')?.estado === 'cumple');
const lejos = calcularKpis({ dias: 30, acuerdoMin: 15, ahora: AHORA - 300 * DIA });
check('sin datos en el mes, la meta dice «sin datos» y no se juzga', lejos.avance.find((a) => a.kpi === 'respuesta')?.estado === 'sin_datos');
check('sin ventas en el mes, las ventas van en 0 y atrasadas (no hay precios que faltar: no hubo ventas)', ['atrasada', 'a_tiempo'].includes(String(lejos.avance.find((a) => a.kpi === 'ventas')?.estado)));

console.log('— Por HTTP, y quién puede cambiar las metas');
const app = new Hono();
mountAdmin(app as never);
const T = { 'x-admin-token': process.env.ADMIN_TOKEN!, 'content-type': 'application/json' };
const r = await app.request('/admin/api/kpis?dias=7', { headers: T });
const cuerpo = (await r.json()) as { dias: number; valores?: unknown; definiciones?: unknown[] };
check('GET /admin/api/kpis contesta con los valores y las definiciones', r.status === 200 && cuerpo.dias === 7 && Boolean(cuerpo.valores) && cuerpo.definiciones?.length === KPIS.length);
check('un periodo raro vuelve a 30 días', ((await (await app.request('/admin/api/kpis?dias=13', { headers: T })).json()) as { dias: number }).dias === 30);
check('y sin token, no', (await app.request('/admin/api/kpis')).status === 401);
const malo = await app.request('/admin/api/metas', { method: 'PUT', headers: T, body: JSON.stringify({ metas: { citas: { valor: 30 }, aTiempo: { valor: '300' } } }) });
check('🪤 PUT con una meta mal: 400 con el campo, y lo guardado sigue igual', malo.status === 400 && ((await malo.json()) as { campo: string }).campo === 'aTiempo' && leerMetas().citas?.valor === 4);
const bueno = await app.request('/admin/api/metas', { method: 'PUT', headers: T, body: JSON.stringify({ metas: { citas: { valor: '25', periodo: 'semana' } } }) });
check('PUT bien: se guarda (y lo que no viene se quita: el formulario manda entero)', bueno.status === 200 && leerMetas().citas?.valor === 25 && leerMetas().citas?.periodo === 'semana' && !leerMetas().ganados);
await app.request('/admin/api/tablero/modo', { method: 'PUT', headers: { ...T, 'x-xencrm-rol': 'super' }, body: JSON.stringify({ modo: 'facil' }) });
const asesor = await app.request('/admin/api/metas', { method: 'PUT', headers: { ...T, 'x-xencrm-rol': 'asesor' }, body: JSON.stringify({ metas: {} }) });
check('con el candado, un asesor NO cambia las metas (403) y no se borran', asesor.status === 403 && leerMetas().citas?.valor === 25);
check('pero sí las lee, y lee los KPIs (son del que vende)', (await app.request('/admin/api/metas', { headers: { ...T, 'x-xencrm-rol': 'asesor' } })).status === 200 && (await app.request('/admin/api/kpis', { headers: { ...T, 'x-xencrm-rol': 'asesor' } })).status === 200);
check('el freno del candado: PUT metas cerrado para admin y asesor; para el super, abierto', frenoDelCandado('metas', 'PUT', 'admin', 'facil') !== null && frenoDelCandado('metas', 'PUT', 'asesor', 'facil') !== null && frenoDelCandado('metas', 'PUT', 'super', 'facil') === null);
check('🪤 por la consola, las metas las cambia solo el super-admin (también fuera del modo fácil)', /const SOLO_SUPER_CAMBIA = \/\^\(retencion\|metas\)\(\\\/\|\$\)\/;/.test(consola), consola.match(/const SOLO_SUPER_CAMBIA = .*/)?.[0] ?? '');

console.log('— Lo que promete la pantalla');
const bloque = js.slice(js.indexOf('// ===== XEN · KPIs y metas'), js.indexOf('// (fin de XEN · KPIs y metas)'));
check('se carga sola al abrirse (alAbrir), sin tocar go()', /alAbrir\('kpis', cargarKpis\)/.test(bloque));
check('el periodo es 7 · 30 · 90 días, y se recuerda en el navegador', /data-dias="7"[\s\S]*data-dias="30"[\s\S]*data-dias="90"/.test(html) && /LLAVE\('kpisDias'\)/.test(bloque));
check('«Editar metas» y «Poner meta» solo para quien administra (mandaEnElModo)', /\$\('xp-editar'\)\.hidden = !puede/.test(bloque) && /var d = XP\.datos, puede = mandaEnElModo\(\)/.test(bloque) && /if \(!mandaEnElModo\(\) \|\| !XP\.datos\) return;/.test(bloque));
check('la comparación va con palabras y flecha, no solo con color', /'más rápido' : 'más lento'/.test(bloque) && /\(dif > 0 \? '↑ ' : '↓ '\)/.test(bloque));
check('🪤 en plata, un periodo sin ventas se dice «sin ventas», no «$0»', /v === 0 \? 'sin ventas'/.test(bloque));
check('sin dato, la tarjeta dice por qué (asistencia, respuesta, cierre, ventas, embudo)', /VOC\.Ninguna \+ ' ' \+ VOC\.cita \+ ' de este periodo ha pasado todavía\.'/.test(bloque) && /Nadie esperó respuesta/.test(bloque) && /No se cerró ningún trato/.test(bloque) && /ponlo en la ficha de cada trato/.test(bloque) && /Ningún trato abierto tiene valor/.test(bloque));
check('la barra de la meta es un progressbar con su texto, y el ritmo es una raya (no un color)', /role="progressbar"/.test(bloque) && /xp-ritmo/.test(bloque) && /El ritmo pedía/.test(bloque));
check('cinco estados: esqueleto al cargar, error con «Volver a intentar», respuesta tardía descartada', /xpEsqueleto\(\)/.test(bloque) && /Volver a intentar/.test(bloque) && /if \(mio !== XP\.pedido\) return;/.test(bloque));
check('🪤 el editor no borra lo escrito si falla: marca el campo que dijo el servidor', /campo\.setAttribute\('aria-invalid', 'true'\)/.test(bloque) && !/form\.reset\(\)/.test(bloque));
check('Escape cierra el editor y el foco vuelve a «Editar metas»', /e\.key === 'Escape'[\s\S]{0,80}xpCerrarEditor\(true\)/.test(bloque) && /if \(devolver\) \$\('xp-editar'\)\.focus\(\)/.test(bloque));
const css = html.slice(html.indexOf('/* ---------- XEN · KPIs y metas'), html.indexOf('/* (fin de XEN · KPIs y metas) */'));
check('🪤 el panel se desplaza por dentro (sin esto estiraba el documento entero)', /#xp-kpis\{flex:1 1 auto;min-height:0;overflow:auto/.test(css));
check('🪤 la caja de la tabla es position:relative (el caption sr-only se iba al fondo de la página)', /\.xp-tabla-caja\{position:relative/.test(css));
check('en el celular la tabla se vuelve tarjetas con su etiqueta', /@media \(max-width:720px\)[\s\S]*\.xp-tabla td::before\{content:attr\(data-l\)/.test(css));
check('ningún color suelto: todo sale de los tokens', !/#[0-9a-f]{3,6}\b/i.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), (css.replace(/\/\*[\s\S]*?\*\//g, '').match(/#[0-9a-f]{3,6}\b/gi) ?? []).join(' '));
check('con movimiento reducido, el esqueleto no parpadea', /prefers-reduced-motion:reduce\)\{[^}]*\.xp-esq i[^}]*animation:none/.test(css));

process.exit(fail ? 1 : 0);
