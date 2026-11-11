// Pruebas de las reglas y umbrales configurables (src/reglas.ts), sin modelo: pnpm test:reglas
//
// El usuario: «todo debe ser configurable, no dejando nada por fuera». Cada número que decide algo de negocio es una
// regla con su valor de fábrica, lo que trae el archivo del cliente y lo que se cambia desde el tablero, en ese orden
// de precedencia. Aquí se prueba: las tres capas; que mover una regla de cada grupo cambia lo que calcula su módulo;
// que nada inventado (un valor fuera de rango, de otro tipo, o que rompe el orden) se guarda; que el candado y la
// consola cierran el cambio; que el tablero pinta con los mismos valores de fábrica; y que ningún resultado de hoy
// cambió (los defectos son los valores de antes).
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'xencrm-reglas-'));
process.env.DB_PATH = join(dir, 'xencrm.db');
process.env.ADMIN_TOKEN = 'token-de-prueba-de-reglas-0123456789';
// El archivo del cliente: la configuración de siempre con una sección `reglas` (una buena y una que no vale).
const base = JSON.parse(readFileSync('xencrm.config.json', 'utf8'));
base.reglas = { 'kam.diasAtencion': 30, 'opt.diasEstancado': 'nueve', 'puntaje.peso.objecion': -12 };
const cfg = join(dir, 'xencrm.config.json');
writeFileSync(cfg, JSON.stringify(base));
process.env.XENCRM_CONFIG = cfg;

const R = await import('../reglas.js');
const { getDb } = await import('../rag/store.js');
const { getSetting, setSetting } = await import('../crm/settings.js');
const { computeScore, temperature } = await import('../crm/analyzer.js');
const { silencePenalty } = await import('../crm/score.js');
const { saludDe, umbralDeValorAlto, porQueCandidata, DIAS_ATENCION, DIAS_RIESGO, MAX_NOTA } = await import('../crm/cuentas-clave.js');
const { UMBRAL, optimizacion } = await import('../crm/optimizacion.js');
const { snoozeFollowup } = await import('../crm/followup.js');
const { touchUser, appendMessage } = await import('../agent/memory.js');
const { MAXIMO_FIJADOS } = await import('../crm/fijados.js');
const { DURACION_MS } = await import('../crm/presencia.js');
const { frenoDelCandado } = await import('../channels/candado.js');
const { Hono } = await import('hono');
const { mountAdmin } = await import('../channels/admin.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};
const DIA = 86400_000;

console.log('— El registro');
const reg = R.registro();
const ids = reg.reglas.map((r) => r.id);
check(`trae las reglas de fábrica (${ids.length}) en sus grupos`, ids.length >= 60 && reg.grupos.includes('Puntaje') && reg.grupos.includes('Cuentas clave') && reg.grupos.includes('Optimización de ventas'), reg.grupos.join(', '));
check('ningún id repetido', new Set(ids).size === ids.length);
check('cada una dice qué cambia si se mueve (ayuda) y tiene etiqueta', reg.reglas.every((r) => r.ayuda.length > 20 && r.etiqueta.length > 2), reg.reglas.filter((r) => r.ayuda.length <= 20).map((r) => r.id).join(', '));
check('cada valor de fábrica vale para su propia regla (tipo y rango)', reg.reglas.every((r) => 'valor' in R.validar(r, r.defecto)));
check('y lo que se configura en otro sitio se nombra con su sitio, sin duplicarlo', reg.enOtroSitio.length >= 8 && reg.enOtroSitio.some((o) => o.vista === 'modelos'));

console.log('— Las tres capas: fábrica → archivo del cliente → tablero');
getDb(); // en el servidor la base siempre está abierta
check('sin nada, manda la fábrica', R.leerConFuente('kam.diasRiesgo').valor === 45 && R.leerConFuente('kam.diasRiesgo').fuente === 'fabrica');
check('lo del archivo manda sobre la fábrica', R.regla('kam.diasAtencion') === 30 && R.leerConFuente('kam.diasAtencion').fuente === 'archivo');
R.ponerRegla('kam.diasAtencion', 10);
check('lo del tablero manda sobre el archivo', R.regla('kam.diasAtencion') === 10 && R.leerConFuente('kam.diasAtencion').fuente === 'tablero');
check('y se guarda en settings con su llave reglas.<id>', getSetting('reglas.kam.diasAtencion', null) === 10);
R.quitarRegla('kam.diasAtencion');
check('«Volver al de antes» quita lo del tablero y vuelve a mandar el archivo', R.regla('kam.diasAtencion') === 30 && getSetting('reglas.kam.diasAtencion', null) === null);
const malo = R.registro().reglas.find((r) => r.id === 'opt.diasEstancado')!;
check('🪤 un valor del archivo que no vale no se usa: manda la fábrica y la pantalla dice por qué', malo.valor === 7 && malo.fuente === 'fabrica' && Boolean(malo.archivoError), JSON.stringify(malo.archivoError));
check('un número negativo del archivo, si cabe en su rango, vale', R.regla('puntaje.peso.objecion') === -12);
setSetting('reglas.kam.diasRiesgo', 'muchos');
const malaDelTablero = R.registro().reglas.find((r) => r.id === 'kam.diasRiesgo')!;
check('🪤 y uno guardado mal en la base tampoco: se cae a la capa de abajo', malaDelTablero.valor === 45 && malaDelTablero.fuente === 'fabrica' && Boolean(malaDelTablero.tableroError));
R.quitarRegla('kam.diasRiesgo');

console.log('— Nada que no valga se guarda');
const fuera = R.cambiarReglas({ 'kam.diasAtencion': 0 });
check('fuera de rango se rechaza y dice el rango', !fuera.ok && /menos de 1/.test(fuera.errores['kam.diasAtencion'] ?? ''), JSON.stringify(fuera));
const texto = R.cambiarReglas({ 'opt.diasEstancado': 'una semana' });
check('un texto donde va un número se rechaza', !texto.ok && /número/.test(texto.errores['opt.diasEstancado'] ?? ''));
const decimal = R.cambiarReglas({ 'kam.diasRiesgo': '2,5' });
check('un decimal donde va un entero se rechaza', !decimal.ok && /entero/.test(decimal.errores['kam.diasRiesgo'] ?? ''));
const mitad = R.cambiarReglas({ 'opt.objecion': 3, 'opt.perdidas': -1 });
check('🪤 todo o nada: si una no vale, no se guarda ninguna', !mitad.ok && R.regla('opt.objecion') === 2);
const orden = R.cambiarReglas({ 'puntaje.tibio': 70 });
check('🪤 el orden se cuida: «tibio» no puede quedar por encima de «caliente»', !orden.ok && /caliente/.test(orden.errores['puntaje.tibio'] ?? ''), JSON.stringify(orden));
const orden2 = R.cambiarReglas({ 'kam.diasRiesgo': 20 });
check('ni «En riesgo» llegar antes que «Atención» (con el 30 del archivo)', !orden2.ok);
R.ponerRegla('opt.difCanalPuntos', '7,5');
check('se escribe como la gente: «7,5» vale donde caben decimales', R.regla('opt.difCanalPuntos') === 7.5);
R.ponerRegla('opt.pasoBajoPct', '55 %');
check('y «55 %» es 55', R.regla('opt.pasoBajoPct') === 55);
R.quitarRegla('opt.difCanalPuntos'); R.quitarRegla('opt.pasoBajoPct');
const noExiste = R.cambiarReglas({ 'kam.inventada': 3 });
check('una regla que no existe no se inventa', !noExiste.ok && Boolean(noExiste.errores['kam.inventada']));

console.log('— Mover una regla de cada grupo cambia lo que calcula su módulo');
// Puntaje: el peso y los cortes.
const ficha = { id: 'web:x', name: null, phone: null, messageCount: 1 } as never;
const senales = { sentimiento: 'neutral', interes: 0, urgencia: 'baja', quiere_cita: true, pidio_precio: false, menciono_presupuesto: false, tiene_objecion: false, objecion: '', presupuesto: '', nombre: '', ciudad: '', telefono: '', resumen: '' } as never;
const antesCita = computeScore(ficha, senales, { hasAppointment: false }).factors.find((f) => f.label === 'Pidió cita')?.points;
R.ponerRegla('puntaje.peso.pidioCita', 45);
const despuesCita = computeScore(ficha, senales, { hasAppointment: false }).factors.find((f) => f.label === 'Pidió cita')?.points;
check('Puntaje: «Pidió cita» suma lo que diga su regla (30 → 45)', antesCita === 30 && despuesCita === 45, `${antesCita} → ${despuesCita}`);
R.quitarRegla('puntaje.peso.pidioCita');
check('Puntaje: con los cortes de fábrica, 70 es caliente', temperature(70) === 'caliente' && temperature(45) === 'tibio' && temperature(10) === 'frio');
R.ponerRegla('puntaje.caliente', 80);
check('Puntaje: con «caliente desde 80», 70 pasa a tibio', temperature(70) === 'tibio');
R.quitarRegla('puntaje.caliente');
const hace4 = Date.now() - 4 * DIA;
const penaAntes = silencePenalty(hace4, 'conversando' as never);
R.ponerRegla('puntaje.silencio.descuento1', 15);
check('Puntaje: el descuento por silencio es el de su tramo (4 días: 10 → 15)', penaAntes === 10 && silencePenalty(hace4, 'conversando' as never) === 15, `${penaAntes}`);
R.quitarRegla('puntaje.silencio.descuento1');

// Cuentas clave: la salud y las candidatas.
const paso = { tipo: 'nada', texto: '', urgente: false, cuando: null } as never;
const ahora = Date.now();
const salud = () => saludDe({ now: ahora, ultima: ahora - 10 * DIA, animo: 'neutral' as never, paso, responsable: 'Laura', etapaRol: 'ganado', falto: 0, proximaCita: null }).salud;
R.ponerRegla('kam.diasAtencion', 21);
const sanaAntes = salud();
R.ponerRegla('kam.diasAtencion', 7);
check('Cuentas clave: bajar «Atención desde» vuelve «Atención» una cuenta que era «Sana»', sanaAntes === 'sana' && salud() === 'atencion', `${sanaAntes} → ${salud()}`);
R.quitarRegla('kam.diasAtencion');
check('Cuentas clave: con 3 precios no hay «mayor valor» (hacen falta 4)', umbralDeValorAlto([100, 200, 300]) === null);
R.ponerRegla('kam.valorAltoMinPrecios', 3);
check('… y con la regla en 3, sí', umbralDeValorAlto([100, 200, 300]) === 300);
R.quitarRegla('kam.valorAltoMinPrecios');
const cand = { etapaRol: 'interes', volvio: 1, citasCumplidas: 0, proximaCita: null, scoreBase: 0, valor: 0, valorAlto: null };
R.ponerRegla('kam.volvioVeces', 1);
check('Cuentas clave: «volvió» propone candidata desde las veces de su regla', porQueCandidata(cand).some((x) => /Volvió/.test(x)));
R.quitarRegla('kam.volvioVeces');
check('… y con las 2 de fábrica, una vuelta no basta', !porQueCandidata(cand).some((x) => /Volvió/.test(x)));

// Optimización: los mínimos de cada hallazgo.
check('Optimización: de fábrica, 7 días y 60 % (como antes)', UMBRAL.diasEstancado === 7 && UMBRAL.pasoBajo === 0.6 && UMBRAL.difCanal === 0.1);
R.ponerRegla('opt.diasEstancado', 3);
check('Optimización: el informe usa la regla (estancado desde 3 días)', optimizacion(30).umbral.diasEstancado === 3);
R.quitarRegla('opt.diasEstancado');

// Seguimientos: posponer.
touchUser('web:ana', 'web', 'Ana');
appendMessage('web:ana', 'user', 'quiero ver la demo', 'consulta');
const p1 = snoozeFollowup('web:ana', undefined, ahora)!;
R.ponerRegla('seg.posponerDias', 3);
const p2 = snoozeFollowup('web:ana', undefined, ahora)!;
R.ponerRegla('seg.posponerMaxDias', 10);
const p3 = snoozeFollowup('web:ana', 999, ahora)!;
check('Seguimientos: «Dejarlo por ahora» aparta los días de su regla (7 → 3) y nunca más del máximo', p1.until === ahora + 7 * DIA && p2.until === ahora + 3 * DIA && p3.until === ahora + 10 * DIA);
R.quitarRegla('seg.posponerDias'); R.quitarRegla('seg.posponerMaxDias');

// Contactos y equipo: «está mirando», fijados y «Volvió».
const { entrar } = await import('../crm/presencia.js');
R.ponerRegla('presencia.minutos', 10);
const yo = entrar('web:ana', 'Laura', ahora).find((x) => x.nombre === 'Laura');
check('Equipo: «está mirando» dura los minutos de su regla (3 → 10)', yo?.hasta === ahora + 10 * 60_000, String(yo && yo.hasta - ahora));
R.quitarRegla('presencia.minutos');
const { guardarFijados } = await import('../crm/fijados.js');
for (const n of ['b', 'c', 'd']) touchUser(`web:${n}`, 'web', n.toUpperCase());
R.ponerRegla('fijados.maximo', 2);
check('Contactos: cada quien fija hasta el máximo de su regla', guardarFijados('Laura', ['web:ana', 'web:b', 'web:c', 'web:d']).length === 2);
R.quitarRegla('fijados.maximo');
const { historiaDe } = await import('../crm/historia.js');
getDb().prepare('INSERT INTO messages (user_id, role, content, intent, ts, author) VALUES (?, ?, ?, ?, ?, ?)').run('web:d', 'user', 'hola', null, ahora - 25 * DIA, 'customer');
getDb().prepare('INSERT INTO messages (user_id, role, content, intent, ts, author) VALUES (?, ?, ?, ?, ?, ?)').run('web:d', 'user', 'volví', null, ahora - 12 * DIA, 'customer');
const volvioAntes = historiaDe('web:d', { ahora }).volvio;
R.ponerRegla('contactos.volvioDias', 12);
check('Contactos: «Volvió» cuenta una vuelta tras los días de silencio de su regla (13 días callado: con 14 no, con 12 sí)', volvioAntes === 0 && historiaDe('web:d', { ahora }).volvio === 1, `${volvioAntes} → ${historiaDe('web:d', { ahora }).volvio}`);
R.quitarRegla('contactos.volvioDias');

// Atención: el acuerdo de respuesta conserva su llave de siempre.
R.ponerRegla('atencion.acuerdoMinutos', 20);
check('Atención: el acuerdo de respuesta se guarda en «sla.minutos», la llave que ya usaban KPIs y Analítica', getSetting<number>('sla.minutos', 15) === 20);
setSetting('sla.minutos', 25);
check('… y lo que escriba la ruta vieja se ve en el registro', R.registro().reglas.find((r) => r.id === 'atencion.acuerdoMinutos')!.valor === 25);
R.quitarRegla('atencion.acuerdoMinutos');

console.log('— Ningún resultado de hoy cambió: los de fábrica son los de antes');
const defecto = (id: string) => reg.reglas.find((r) => r.id === id)!.defecto;
check('cuentas clave: 21 y 45 días, plan de 600 letras', defecto('kam.diasAtencion') === DIAS_ATENCION && defecto('kam.diasRiesgo') === DIAS_RIESGO && defecto('kam.maxNota') === MAX_NOTA);
check('fijados (12) y «está mirando» (3 min)', defecto('fijados.maximo') === MAXIMO_FIJADOS && defecto('presencia.minutos') === DURACION_MS / 60_000);
check('puntaje: 60 y 30', defecto('puntaje.caliente') === 60 && defecto('puntaje.tibio') === 30);
check('el acuerdo de respuesta: 15 min', defecto('atencion.acuerdoMinutos') === 15);

console.log('— Lo que estaba fijo en el código ahora lee su regla');
const fuente = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const lee: Record<string, string[]> = {
  'crm/analyzer.ts': ['puntaje.caliente', 'puntaje.tibio', 'puntaje.mensajesSostenida'],
  'crm/score.ts': ['puntaje.silencio.'],
  'crm/cuentas-clave.ts': ['kam.diasAtencion', 'kam.diasRiesgo', 'kam.horasSinRespuesta', 'kam.valorAltoPct', 'kam.valorAltoMinPrecios', 'kam.volvioVeces', 'kam.maxNota'],
  'crm/optimizacion.ts': ['opt.baseEmbudo', 'opt.diasEstancado', 'opt.objecion', 'atencion.acuerdoMinutos'],
  'crm/resultados.ts': ['seg.horasSinSeguimiento', 'seg.diasEsperandoResultado', 'puntaje.caliente'],
  'crm/proximo.ts': ['seg.horasSinSeguimiento', 'puntaje.caliente'],
  'crm/followup.ts': ['seg.posponerDias', 'seg.posponerMaxDias'],
  'crm/kpis.ts': ['atencion.acuerdoMinutos'],
  'crm/vigilante.ts': ['atencion.acuerdoMinutos', 'vigilante.topePorHora'],
  'crm/notifications.ts': ['puntaje.caliente'],
  'crm/historia.ts': ['contactos.volvioDias'],
  'crm/cross.ts': ['contactos.mismaPersonaDias'],
  'crm/fijados.ts': ['fijados.maximo'],
  'crm/presencia.ts': ['presencia.minutos'],
  'crm/respuestas-rapidas.ts': ['rapidas.parecidoPct', 'rapidas.largoMaximo'],
  'channels/admin.ts': ['puntaje.caliente', 'seg.horasSinSeguimiento', 'seg.diasEsperandoResultado', 'atencion.acuerdoMinutos'],
};
for (const [f, rs] of Object.entries(lee)) {
  const t = fuente(f);
  const faltan = rs.filter((id) => !t.includes(`'${id}`) && !t.includes('`' + id));
  check(`${f} lee ${rs.join(', ')}`, !faltan.length, faltan.join(', '));
}
check('🪤 el 60 de «caliente» ya no está escrito a mano en el servidor', !/(score|scoreBase|puntaje)\s*>=\s*60\b/.test(['crm/notifications.ts', 'crm/contacts.ts', 'crm/resultados.ts', 'crm/optimizacion.ts', 'crm/vivo.ts', 'crm/export.ts', 'channels/admin.ts', 'crm/analyzer.ts', 'crm/cuentas-clave.ts'].map(fuente).join('\n')));
check('ni el «sla.minutos» con su 15 suelto', !/getSetting\('sla\.minutos', 15\)/.test(['crm/optimizacion.ts', 'crm/kpis.ts', 'crm/vigilante.ts', 'channels/admin.ts'].map(fuente).join('\n')));

console.log('— El tablero pinta con las mismas reglas');
const js = readFileSync(new URL('../../public/admin.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../../public/admin.html', import.meta.url), 'utf8');
const usos = [...js.matchAll(/\bR\('([a-zA-Z.]+)', ([^)]+)\)/g)].map((m) => ({ id: m[1]!, def: m[2]!.trim() }));
check(`usa reglas para pintar (${usos.length} sitios)`, usos.length >= 8, usos.map((u) => u.id).join(', '));
const desfasados = usos.filter((u) => {
  if (!ids.includes(u.id)) return true;
  const d = defecto(u.id);
  return /^\d/.test(u.def) ? Number(u.def) !== d : u.def !== 'XK_NOTA_MAX' || d !== MAX_NOTA;
});
check('🪤 y su valor de respaldo es el mismo de fábrica (si no, sin red el tablero diría otra cosa)', !desfasados.length, desfasados.map((u) => `${u.id}=${u.def}`).join(', '));
check('arranca con las reglas ya leídas (y si tardan, con las de fábrica)', /arrancarConReglas\(\);\n\}\)\(\);/.test(js) && /setTimeout\(seguir, 1500\)/.test(js));
check('la pantalla «Reglas y umbrales» está en Configuración, solo para quien administra', /\{ view: 'reglas', ic: 'sliders', lbl: 'Reglas y umbrales', soloAdmin: true \}/.test(js) && /VISTAS_DE_QUIEN_ADMINISTRA = \{[^}]*reglas: 1/.test(js) && /CFG_VIEWS = \{[^}]*reglas: 1/.test(js));
check('con su vista, su buscador y su barra de cambios sin guardar', html.includes('id="view-reglas"') && html.includes('id="xr-q"') && html.includes('id="xr-barra"'));
check('se carga sola al abrirse', /alAbrir\('reglas', function \(\) \{ cargarReglas\(\); \}\)/.test(js));
check('guarda todo o nada y lo escrito se queda si falla (no borra el borrador)', /XR\.errores = \(r && r\.errores\) \|\| \{\}/.test(js) && !/XR\.borrador = \{\};\s*XR\.errores = \{\};\s*toast\('No se pudo/.test(js));
const css = html.slice(html.indexOf('/* ---------- XEN · Reglas y umbrales'), html.indexOf('/* (fin de XEN · Reglas y umbrales) */'));
check('el estilo vive en su sección y sin colores sueltos', css.length > 500 && !/#[0-9a-fA-F]{3,6}\b/.test(css));

console.log('— Cambiarlas es de quien administra');
check('con el candado, un asesor no puede cambiarlas', frenoDelCandado('reglas', 'PUT', 'asesor', 'facil') !== null);
check('pero sí leerlas (el tablero pinta con ellas)', frenoDelCandado('reglas/valores', 'GET', 'asesor', 'facil') === null && frenoDelCandado('reglas', 'GET', 'asesor', 'facil') === null);
check('por la consola, solo el super-admin las cambia', /SOLO_SUPER_CAMBIA = \/\^\([^)]*reglas/.test(fuente('consola.ts')));

console.log('— Las rutas');
const app = new Hono();
mountAdmin(app as never);
const T = { 'x-admin-token': process.env.ADMIN_TOKEN!, 'content-type': 'application/json' };
const g = await app.request('/admin/api/reglas', { headers: T });
const gj = (await g.json()) as { reglas: { id: string; fuente: string }[] };
check('GET trae el registro con la fuente de cada una', g.status === 200 && gj.reglas.find((r) => r.id === 'kam.diasAtencion')?.fuente === 'archivo');
const v = (await (await app.request('/admin/api/reglas/valores', { headers: T })).json()) as Record<string, unknown>;
check('GET /valores trae solo { id: valor }, para el tablero', v['puntaje.caliente'] === 60 && v['kam.diasAtencion'] === 30);
const malPut = await app.request('/admin/api/reglas', { method: 'PUT', headers: T, body: JSON.stringify({ cambios: { 'kam.diasAtencion': 9999 } }) });
const malJ = (await malPut.json()) as { errores?: Record<string, string> };
check('PUT con un valor que no vale: 400 y el error junto a su regla', malPut.status === 400 && Boolean(malJ.errores?.['kam.diasAtencion']));
const bien = await app.request('/admin/api/reglas', { method: 'PUT', headers: T, body: JSON.stringify({ cambios: { 'inicio.maxAcciones': 7 } }) });
check('PUT bueno: se guarda y se aplica desde ya', bien.status === 200 && R.regla('inicio.maxAcciones') === 7);
const vuelta = await app.request('/admin/api/reglas', { method: 'PUT', headers: T, body: JSON.stringify({ cambios: { 'inicio.maxAcciones': null } }) });
check('PUT con null: vuelve al de fábrica', vuelta.status === 200 && R.regla('inicio.maxAcciones') === 5);
await app.request('/admin/api/tablero/modo', { method: 'PUT', headers: { ...T, 'x-xencrm-rol': 'super' }, body: JSON.stringify({ modo: 'facil' }) });
const candado = await app.request('/admin/api/reglas', { method: 'PUT', headers: { ...T, 'x-xencrm-rol': 'asesor' }, body: JSON.stringify({ cambios: { 'inicio.maxAcciones': 3 } }) });
check('🪤 con el candado, el servidor cierra el PUT de verdad (403) y no cambia nada', candado.status === 403 && R.regla('inicio.maxAcciones') === 5);
const leeConCandado = await app.request('/admin/api/reglas/valores', { headers: { ...T, 'x-xencrm-rol': 'asesor' } });
check('… pero las sigue leyendo', leeConCandado.status === 200);
const acuerdo = await app.request('/admin/api/tiempos/acuerdo', { method: 'PUT', headers: T, body: JSON.stringify({ minutos: 30 }) });
check('la ruta vieja del acuerdo de respuesta escribe en la misma regla (y se ve al instante)', acuerdo.status === 200 && R.regla('atencion.acuerdoMinutos') === 30);

console.log(fail ? `\n${fail} fallas` : '\n✓ todo bien');
process.exit(fail ? 1 : 0);
