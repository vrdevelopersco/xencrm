// Pruebas de los mantenimientos y las actualizaciones (Servicio), sin modelo ni red: pnpm test:mantenimientos
//
// Lo que se prueba: que las reglas manden (fábrica → archivo del cliente → tablero) y que cambiar una cambie el
// resultado; quiénes quedan afectados y cómo se comparan la aplicación y el plan; que el aviso NUNCA salga solo y solo
// cuente cuando de verdad salió (o al prepararse, si la regla lo dice); la cadencia de las actualizaciones; la forma
// exacta del cumplimiento que lee SLA; el candado y quién programa; y que la pantalla no traiga nada fijo de negocio.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// El archivo del cliente para la prueba: XENTRIS con algunas reglas puestas (la capa «archivo»).
const dir = mkdtempSync(join(tmpdir(), 'xencrm-mant-'));
const base = JSON.parse(readFileSync('examples/xentris/xencrm.config.json', 'utf8')) as Record<string, unknown>;
base.servicio = { mantenimientos: { cadenciaDias: 20, avisoHoras: { Pro: 60 } } };
writeFileSync(join(dir, 'xencrm.config.json'), JSON.stringify(base));
process.env.XENCRM_CONFIG = join(dir, 'xencrm.config.json');
process.env.DB_PATH = join(dir, 'xencrm.db');
process.env.ADMIN_TOKEN = 'token-del-tablero-de-prueba-0123456789';
process.env.XENCRM_ENV_FILE = join(dir, 'vacio.env');
writeFileSync(join(dir, 'vacio.env'), '');

const R = await import('../crm/mantenimientos-reglas.js');
const M = await import('../crm/mantenimientos.js');
const { cargar, quitar } = await import('../crm/demo.js');
const { cerrarPropuesta, propuestaDe } = await import('../crm/propuestas.js');
const { getDb } = await import('../rag/store.js');
const { frenoDelCandado } = await import('../channels/candado.js');
const { BusinessConfigSchema } = await import('../config.js');
const { Hono } = await import('hono');
const { mountAdmin } = await import('../channels/admin.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};
const HORA = 3600_000;
const DIA = 24 * HORA;
const now = Date.now();
cargar({ archivo: 'examples/xentris/seed.json', now });
const porTitulo = (t: string) => M.listarMantenimientos().find((m) => m.titulo.includes(t))!;
const estadosDe = (t: string) => M.afectadosDe(porTitulo(t), Date.now()).map((a) => `${a.nombre}:${a.estado}`).join(', ');
const origen = (id: string) => R.reglasConValor().find((r) => r.id === id)!;

console.log('— Las reglas: fábrica → archivo del cliente → tablero');
check('lo que nadie dijo, de fábrica (días de gracia: 0)', origen('mant.toleranciaDias').valor === 0 && origen('mant.toleranciaDias').origen === 'fabrica');
check('lo del archivo manda sobre la fábrica (cadencia 20 días, Pro 60 h)', origen('mant.cadenciaDias').valor === 20 && origen('mant.cadenciaDias').origen === 'archivo' && origen('mant.avisoHoras.Pro').valor === 60 && origen('mant.avisoHoras.Pro').origen === 'archivo');
check('y el plan que el archivo no nombra sigue de fábrica (Básico 48 h, Enterprise 168 h)', origen('mant.avisoHoras.Básico').valor === 48 && origen('mant.avisoHoras.Enterprise').valor === 168);
let g = R.guardarReglas({ 'mant.cadenciaDias': 10 });
check('lo del tablero manda sobre el archivo', 'ok' in g && origen('mant.cadenciaDias').valor === 10 && origen('mant.cadenciaDias').origen === 'tablero');
g = R.guardarReglas({ 'mant.cadenciaDias': null });
check('🪤 quitarlo del tablero vuelve a lo del archivo (no a la fábrica)', 'ok' in g && origen('mant.cadenciaDias').valor === 20 && origen('mant.cadenciaDias').origen === 'archivo');
check('se leen con la llave de settings reglas.<id>', (() => { R.guardarReglas({ 'mant.toleranciaDias': 3 }); const r = getDb().prepare("SELECT value FROM settings WHERE key = 'reglas.mant.toleranciaDias'").get() as { value: string } | undefined; R.guardarReglas({ 'mant.toleranciaDias': null }); return r?.value === '3'; })());

console.log('— La lista de reglas tiene la forma del registro común');
const lista = R.reglasDeMantenimientos();
const TIPOS = ['numero', 'texto', 'si-no', 'opciones', 'lista'];
check(`todas con id «mant.…», grupo, etiqueta, ayuda, tipo y defecto (${lista.length})`, lista.length > 15 && lista.every((r) => r.id.startsWith('mant.') && r.grupo === 'Mantenimientos' && r.etiqueta && r.ayuda && TIPOS.includes(r.tipo) && 'defecto' in r));
check('las de opciones traen sus opciones', lista.filter((r) => r.tipo === 'opciones').every((r) => Array.isArray(r.opciones) && r.opciones.length > 1));
check('🪤 no se le escapa cómo se lee del archivo (es interno)', lista.every((r) => !('archivo' in r)));
const ids = new Set(lista.map((r) => r.id));
check('nada de negocio fijo: aviso por plan, cadencia general y por aplicación, gracia, aplicaciones, estados, afectados, plantilla, cuándo cuenta, quién programa, periodo',
  ['mant.planes', 'mant.avisoHoras.Básico', 'mant.avisoHoras.Pro', 'mant.avisoHoras.Enterprise', 'mant.cadenciaDias', 'mant.cadenciaDias.XENTRIS POS', 'mant.toleranciaDias', 'mant.productos', 'mant.estadoMant.programado', 'mant.estadoAct.publicada',
    'mant.afectados.roles', 'mant.afectados.etapas', 'mant.afectados.campoPlan', 'mant.afectados.campoProducto', 'mant.afectados.comparacion', 'mant.afectados.palabrasGenericas', 'mant.afectados.sinProductoTocaATodos', 'mant.afectados.incluirArchivados',
    'mant.aviso.plantilla', 'mant.aviso.cuentaAl', 'mant.quienPrograma', 'mant.periodoDias'].every((id) => ids.has(id)), [...ids].join(', '));
check('las aplicaciones de fábrica son las del catálogo, sin los planes de soporte', JSON.stringify(R.productos()) === JSON.stringify(['XENTRIS POS', 'XENTRIS Field', 'XENTRIS Stock', 'Desarrollo a la medida']), JSON.stringify(R.productos()));
check('el archivo valida lo que trae (una cadencia de 0 días no pasa)', !BusinessConfigSchema.safeParse({ ...base, servicio: { mantenimientos: { cadenciaDias: 0 } } }).success);
check('🪤 y conserva lo de otras pantallas en servicio (servicio.sla)', (BusinessConfigSchema.parse({ ...base, servicio: { sla: { planes: [{ id: 'oro', nombre: 'Oro' }] } } }).servicio as Record<string, unknown>).sla !== undefined);

console.log('— Guardar desde el tablero: todo o nada, limpio');
g = R.guardarReglas({ 'mant.avisoHoras.Pro': 12, 'mant.avisoHoras.Enterprise': 'abc' });
check('si una no sirve, no se guarda ninguna y se dice cuál', 'error' in g && g.campo === 'mant.avisoHoras.Enterprise' && origen('mant.avisoHoras.Pro').valor === 60, JSON.stringify(g));
g = R.guardarReglas({ 'mant.aviso.plantilla': 'Hola {cliente}, el {dia}' });
check('una variable que no existe en la plantilla se rechaza diciendo cuáles hay', 'error' in g && /\{cliente\}/.test(g.error) && /\{primerNombre\}/.test(g.error));
g = R.guardarReglas({ 'mant.productos': 'XENTRIS POS\n  XENTRIS POS \n\nXENTRIS Field' });
check('una lista se limpia (renglones, espacios, repetidos)', 'ok' in g && JSON.stringify(R.productos()) === JSON.stringify(['XENTRIS POS', 'XENTRIS Field']));
R.guardarReglas({ 'mant.productos': null });
g = R.guardarReglas({ 'mant.planes': '' });
check('sin planes no se puede', 'error' in g);
g = R.guardarReglas({ 'mant.quienPrograma': 'nadie' });
check('una opción que no está, no', 'error' in g);
g = R.guardarReglas({ 'mant.regla.inventada': 1 });
check('una regla que no existe, no', 'error' in g);

console.log('— El plan y la aplicación');
const planes = R.planes();
check('el plan se lee como lo escriba la gente («plan pro», «ENTERPRISE», «Básico»)', M.planDe('plan pro', planes)?.nombre === 'Pro' && M.planDe('ENTERPRISE', planes)?.nombre === 'Enterprise' && M.planDe('basico', planes)?.nombre === 'Básico');
check('un plan que no existe no se inventa', M.planDe('Oro', planes) === null && M.planDe('', planes) === null);
check('🪤 el de nombre más largo primero («Pro Plus» no se lee como «Pro»)', M.planDe('Pro Plus', [...planes, { id: 'pro_plus', nombre: 'Pro Plus', avisoHoras: 24 }])?.nombre === 'Pro Plus');
const reglaBase = R.reglaAfectados();
check('por palabras: «XENTRIS POS + Stock» cuenta para POS y para Stock', M.productoCoincide('XENTRIS POS', 'XENTRIS POS + Stock', reglaBase) && M.productoCoincide('XENTRIS Stock', 'XENTRIS POS + Stock', reglaBase));
check('🪤 la marca sola no hace coincidir nada', !M.productoCoincide('XENTRIS Field', 'XENTRIS POS', reglaBase));
check('«contiene» y «exacta» comparan como dicen', M.productoCoincide('XENTRIS POS', 'Usa XENTRIS POS en caja', { ...reglaBase, comparacion: 'contiene' }) && !M.productoCoincide('XENTRIS POS', 'XENTRIS POS + Stock', { ...reglaBase, comparacion: 'exacta' }) && M.productoCoincide('XENTRIS POS', 'xentris pos', { ...reglaBase, comparacion: 'exacta' }));
check('un mantenimiento sin aplicación toca a todas, salvo que la regla diga que no', M.productoCoincide('', 'lo que sea', reglaBase) && !M.productoCoincide('', 'lo que sea', { ...reglaBase, sinProductoTocaATodos: false }));

console.log('— La demostración (servicio.json junto a la semilla)');
check('siembra los mantenimientos y las actualizaciones de ejemplo', M.listarMantenimientos().length === 4 && M.listarActualizaciones().length === 4, `${M.listarMantenimientos().length} · ${M.listarActualizaciones().length}`);
check('uno avisado a tiempo, uno tarde y uno atrasado, sin inventar mensajes', /a_tiempo/.test(estadosDe('Migración')) && /tarde/.test(estadosDe('Cambio de servidores')) && /atrasado/.test(estadosDe('Parche')), `${estadosDe('Migración')} | ${estadosDe('Cambio')} | ${estadosDe('Parche')}`);
const vida = porTitulo('Clínica');
const horaVida = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' }).format(vida.inicio);
check('🪤 la ventana de Clínica Vida es la que se le dijo a Sofía (11 p. m. a 2 a. m., hora del negocio), no una inventada', horaVida === '23:00' && vida.duracionMin === 180, horaVida);
check('afectados: los ganados con ese plan y esa aplicación (Laura y Juan Pablo en POS; Camilo en Field)', /Laura Gómez/.test(estadosDe('Migración')) && /Juan Pablo Ochoa/.test(estadosDe('Migración')) && !/Camilo/.test(estadosDe('Migración')) && /Camilo Duarte/.test(estadosDe('Parche')));

console.log('— Cambiar una regla cambia el resultado');
R.guardarReglas({ 'mant.avisoHoras.Enterprise': 24 });
check('Enterprise con 24 h de aviso: el parche (en 70 h) pasa de atrasado a por avisar', /por_avisar/.test(estadosDe('Parche')), estadosDe('Parche'));
R.guardarReglas({ 'mant.avisoHoras.Enterprise': null });
check('y al volver a fábrica (7 días), atrasado otra vez', /atrasado/.test(estadosDe('Parche')));
R.guardarReglas({ 'mant.afectados.comparacion': 'exacta' });
check('con comparación exacta, «XENTRIS POS + Stock» ya no cuenta para la migración de POS', !/Laura/.test(estadosDe('Migración')) && /Juan Pablo/.test(estadosDe('Migración')), estadosDe('Migración'));
R.guardarReglas({ 'mant.afectados.comparacion': null });
R.guardarReglas({ 'mant.afectados.campoPlan': 'producto' });
check('si el plan se lee de otro dato de la ficha, nadie tiene plan y nadie queda afectado', M.afectadosDe(porTitulo('Migración')).length === 0);
R.guardarReglas({ 'mant.afectados.campoPlan': null, 'mant.afectados.roles': [], 'mant.afectados.etapas': ['demo_agendada'] });
check('quién cuenta como cliente: sin el papel «ganado», los clientes dejan de recibir avisos', M.afectadosDe(porTitulo('Migración')).length === 0);
R.guardarReglas({ 'mant.afectados.roles': null, 'mant.afectados.etapas': null });
const pos = M.actualizacionesPorProducto().find((p) => p.producto === 'XENTRIS POS')!;
check('cadencia del archivo (20 días): POS, con la última hace 18, va al día', pos.alDia === true && pos.cadenciaDias === 20, JSON.stringify({ d: pos.diasDesdeLaUltima, c: pos.cadenciaDias }));
R.guardarReglas({ 'mant.cadenciaDias.XENTRIS POS': 10 });
check('una cadencia propia para POS (10 días): va atrasada', M.actualizacionesPorProducto().find((p) => p.producto === 'XENTRIS POS')!.alDia === false);
R.guardarReglas({ 'mant.toleranciaDias': 10 });
check('con 10 días de gracia, al día otra vez', M.actualizacionesPorProducto().find((p) => p.producto === 'XENTRIS POS')!.alDia === true);
R.guardarReglas({ 'mant.cadenciaDias.XENTRIS POS': null, 'mant.toleranciaDias': null });
R.guardarReglas({ 'mant.estadoMant.hecho': 'Terminado' });
check('el nombre de un estado se cambia sin tocar lo guardado', R.estadosDeMantenimiento().find((e) => e.id === 'hecho')?.nombre === 'Terminado' && porTitulo('Cambio de servidores').papel === 'hecho');
R.guardarReglas({ 'mant.estadoMant.hecho': null });

console.log('— El aviso: nunca sale solo, y cuenta cuando salió');
const clinica = porTitulo('Clínica');
const sofia = M.afectadosDe(clinica)[0]!;
const r1 = M.prepararAvisos(clinica.id, { por: 'Laura' })!;
const prop = propuestaDe(sofia.id);
const mensajesAntes = (getDb().prepare("SELECT COUNT(*) n FROM messages WHERE user_id = ? AND role = 'assistant'").get(sofia.id) as { n: number }).n;
check('preparar deja el aviso escrito en su conversación (una propuesta), sin mandar nada', r1.preparados.includes(sofia.id) && prop?.intent === 'aviso_mantenimiento' && /Clínica Vida/.test(prop?.texto ?? ''));
check('y queda «preparado», no avisado', M.afectadosDe(clinica)[0]!.estado === 'preparado' && M.afectadosDe(clinica)[0]!.avisado === null);
check('prepararlo otra vez no lo duplica', M.prepararAvisos(clinica.id)!.preparados.length === 0);
// Se manda con el canal sin conectar: el mensaje queda guardado y marcado como que no salió.
const ts = Date.now();
getDb().prepare("INSERT INTO messages (user_id, role, content, ts, author, fallo) VALUES (?, 'assistant', ?, ?, 'bot', 'WhatsApp no está conectado')").run(sofia.id, prop!.texto, ts);
cerrarPropuesta(prop!.id, 'enviada', 'Laura');
check('🪤 «enviada» pero no le llegó: «No salió», no avisado', M.afectadosDe(clinica)[0]!.estado === 'no_salio' && !M.afectadosDe(clinica)[0]!.avisado, M.afectadosDe(clinica)[0]!.estado);
check('y no se vuelve a preparar encima: se reintenta el mensaje', M.prepararAvisos(clinica.id)!.omitidos[0]?.porque.includes('reinténtalo') === true);
getDb().prepare('UPDATE messages SET fallo = NULL WHERE user_id = ? AND ts = ?').run(sofia.id, ts);
const sofiaYa = M.afectadosDe(clinica)[0]!;
check('cuando el reintento salió, queda avisado a tiempo, por mensaje', sofiaYa.estado === 'a_tiempo' && sofiaYa.como === 'mensaje' && sofiaYa.avisado === ts, JSON.stringify(sofiaYa));
check('ya había un mensaje del asistente en su conversación antes (prueba honesta)', mensajesAntes >= 1);
const parche = porTitulo('Parche');
const camilo = M.afectadosDe(parche)[0]!;
M.prepararAvisos(parche.id);
R.guardarReglas({ 'mant.aviso.cuentaAl': 'preparar' });
check('con la regla «cuenta al prepararse», lo preparado ya cuenta (tarde: el plazo pasó)', M.afectadosDe(parche)[0]!.estado === 'tarde' && M.afectadosDe(parche)[0]!.como === 'preparado');
R.guardarReglas({ 'mant.aviso.cuentaAl': null });
check('y de fábrica no: sigue «preparado»', M.afectadosDe(parche)[0]!.estado === 'preparado');
const otro = M.marcarAvisado(parche.id, camilo.id, 'Bryan');
check('«Ya le avisé» por otro medio, con nombre, cuenta desde ese momento', otro !== null && 'ok' in otro && M.afectadosDe(parche)[0]!.como === 'otro medio' && M.afectadosDe(parche)[0]!.por === 'Bryan');
check('sin nombre no se marca', (() => { const r = M.marcarAvisado(parche.id, camilo.id, ' '); return r !== null && 'error' in r; })());

console.log('— La plantilla del aviso');
const m0 = { ...clinica, inicio: Date.UTC(2026, 11, 13, 4, 0), fin: Date.UTC(2026, 11, 13, 7, 0), duracionMin: 180 };
const texto = M.textoDelAviso(m0, { nombre: 'Sofía Herrera', empresa: 'Clínica Vida', planNombre: 'Enterprise' }, 'Hola {primerNombre} ({empresa}): {titulo}, el {dia} de {inicio} a {fin} ({duracion}). Plan {plan}. {negocio}');
check('las variables se llenan en la hora del negocio', /Hola Sofía \(Clínica Vida\)/.test(texto) && /sábado, 12 de diciembre/.test(texto) && /11:00/.test(texto) && /\(3 h\)/.test(texto) && /Plan Enterprise/.test(texto) && /XENTRIS LLC/.test(texto), texto);
check('🪤 una variable vacía no deja huecos («Hola .»)', M.llenarAviso('Hola {primerNombre}. ({empresa})', { nombre: '', titulo: 't', producto: '', inicio: now, fin: now, duracionMin: 5 }) === 'Hola.');
R.guardarReglas({ 'mant.aviso.plantilla': 'Aviso para {nombre}: {titulo}.' });
check('cambiar la plantilla cambia el aviso que se prepara', M.textoDelAviso(clinica, { nombre: 'Sofía Herrera' }) === `Aviso para Sofía Herrera: ${clinica.titulo}.`);
check('y la vista previa usa al primer afectado del próximo mantenimiento', /^Aviso para /.test(M.vistaPreviaDelAviso('Aviso para {nombre}: {titulo}.').texto));
R.guardarReglas({ 'mant.aviso.plantilla': null });

console.log('— El cumplimiento que lee SLA (forma exacta)');
const c = M.cumplimiento(30);
check('las llaves son exactamente las acordadas', JSON.stringify(Object.keys(c)) === '["periodoDias","mantenimientos","actualizaciones"]' && JSON.stringify(Object.keys(c.mantenimientos)) === '["total","avisadosATiempo","sinAviso","proximos"]' && JSON.stringify(Object.keys(c.actualizaciones)) === '["publicadasEnPeriodo","productosAtrasados"]', JSON.stringify(c));
check('los números de la demostración: 1 en el periodo (avisado tarde: ni a tiempo ni sin aviso), 3 próximos', c.mantenimientos.total === 1 && c.mantenimientos.avisadosATiempo === 0 && c.mantenimientos.sinAviso === 0 && c.mantenimientos.proximos === 3, JSON.stringify(c.mantenimientos));
check('Stock atrasada con sus días (cadencia del archivo: 20)', c.actualizaciones.productosAtrasados.some((p) => p.producto === 'XENTRIS Stock' && p.diasDesdeLaUltima === 46) && c.actualizaciones.publicadasEnPeriodo === 2, JSON.stringify(c.actualizaciones));

console.log('— Quién puede qué (candado y servidor)');
check('con el candado, avisar es de todos', frenoDelCandado('mantenimientos/3/avisos/preparar', 'POST', 'asesor', 'facil') === null && frenoDelCandado('mantenimientos/3/avisos/wa%3A1/avisado', 'POST', 'asesor', 'facil') === null);
check('programar, no (de fábrica es de quien administra)', frenoDelCandado('mantenimientos', 'POST', 'asesor', 'facil') !== null && frenoDelCandado('actualizaciones/2', 'PATCH', 'asesor', 'facil') !== null);
R.guardarReglas({ 'mant.quienPrograma': 'equipo' });
check('si la regla lo abre al equipo, el candado también lo deja', frenoDelCandado('mantenimientos', 'POST', 'asesor', 'facil') === null);
check('🪤 las reglas siguen cerradas con el candado', frenoDelCandado('mantenimientos/config', 'PUT', 'asesor', 'facil') !== null);
R.guardarReglas({ 'mant.quienPrograma': null });
const app = new Hono();
mountAdmin(app as never);
const T = { 'x-admin-token': process.env.ADMIN_TOKEN!, 'content-type': 'application/json' };
const nuevo = { titulo: 'Ventana de prueba', producto: 'XENTRIS POS', inicio: now + 10 * DIA, duracionMin: 60, planes: ['Pro'] };
check('un asesor no programa (aunque no haya candado)', (await app.request('/admin/api/mantenimientos', { method: 'POST', headers: { ...T, 'x-xencrm-rol': 'asesor' }, body: JSON.stringify(nuevo) })).status === 403);
check('quien administra sí', (await app.request('/admin/api/mantenimientos', { method: 'POST', headers: T, body: JSON.stringify(nuevo) })).status === 201);
const malo = await app.request('/admin/api/mantenimientos', { method: 'POST', headers: T, body: JSON.stringify({ ...nuevo, duracionMin: 2 }) });
check('lo que no sirve se dice con su campo', malo.status === 400 && ((await malo.json()) as { campo: string }).campo === 'duracionMin');
const cumpl = (await (await app.request('/admin/api/mantenimientos/cumplimiento?dias=30', { headers: { ...T, 'x-xencrm-rol': 'asesor' } })).json()) as Record<string, unknown>;
check('el cumplimiento se lee por HTTP, también con el candado', 'mantenimientos' in cumpl && 'actualizaciones' in cumpl);
const cfg = (await (await app.request('/admin/api/mantenimientos/config', { headers: T })).json()) as { reglas: { id: string; origen: string }[] };
check('la configuración dice de dónde sale cada regla', cfg.reglas.find((r) => r.id === 'mant.cadenciaDias')?.origen === 'archivo' && cfg.reglas.find((r) => r.id === 'mant.periodoDias')?.origen === 'fabrica');
const put = await app.request('/admin/api/mantenimientos/config', { method: 'PUT', headers: T, body: JSON.stringify({ valores: { 'mant.periodoDias': 'x' } }) });
check('guardar una regla mala por HTTP: 400 con su campo', put.status === 400 && ((await put.json()) as { campo: string }).campo === 'mant.periodoDias');

console.log('— La pantalla no trae nada fijo de negocio');
const js = readFileSync(new URL('../../public/admin.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../../public/admin.html', import.meta.url), 'utf8');
const mio = js.slice(js.indexOf('// ===== XEN · Mantenimientos y actualizaciones'), js.lastIndexOf('// (fin de XEN · Mantenimientos y actualizaciones)'));
check('se carga sola al abrirse (alAbrir) y su configuración también', /alAbrir\('mantenimientos', cargarMantenimientos\)/.test(mio) && /alAbrir\('cfg-mantenimientos', cargarCfgMantenimientos\)/.test(mio));
check('🪤 ni planes, ni horas de aviso, ni cadencias escritas a mano', !/'basico'|'enterprise'|Básico|Enterprise|48 h|72 h|7 días|31 días/.test(mio), (mio.match(/'basico'|'enterprise'|Básico|Enterprise|48 h|72 h|7 días|31 días/) ?? [''])[0]);
check('la configuración es una vista de Configuración, de quien administra', /\{ view: 'cfg-mantenimientos', ic: 'llave', lbl: 'Mantenimientos y actualizaciones', soloAdmin: true \}/.test(js) && /VISTAS_DE_QUIEN_ADMINISTRA = \{[^}]*'cfg-mantenimientos': 1/.test(js) && /CFG_VIEWS = \{[^}]*'cfg-mantenimientos': 1/.test(js) && /id="view-cfg-mantenimientos"/.test(html));
check('el aviso se manda desde la conversación (no hay un «mandar a todos»)', !/sendToContact|\/enviar'/.test(mio));
const bloque = html.slice(html.indexOf('/* ---------- XEN · Mantenimientos y actualizaciones'), html.indexOf('/* (fin de XEN · Mantenimientos y actualizaciones) */'));
const reglasCss = bloque.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@keyframes[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '').match(/[^{}@]+(?=\{)/g) ?? [];
const sueltas = reglasCss.flatMap((s) => s.split(',').map((x) => x.trim())).filter((x) => x && !x.startsWith(':root[data-piel="xen"]') && !x.startsWith('(') && !/^media/.test(x));
check(`sus estilos viven en la piel (${reglasCss.length} reglas, todas detrás de :root[data-piel="xen"])`, reglasCss.length > 100 && !sueltas.length, sueltas.slice(0, 5).join(' | '));
check('sin colores sueltos: todo sale de los tokens', !/#[0-9a-fA-F]{3,6}\b|rgb\(/.test(bloque));

quitar();
check('quitar la demostración se lleva sus mantenimientos y actualizaciones (y deja lo creado a mano)', M.listarMantenimientos().every((m) => !m.demo) && M.listarActualizaciones().length === 0 && M.listarMantenimientos().some((m) => m.titulo === 'Ventana de prueba'));

console.log(fail ? `\n${fail} fallas` : '\n✓ todo bien');
process.exit(fail ? 1 : 0);
