// Pruebas del ejemplo de XENCRM, XENTRIS LLC (una firma de software), sin modelo: pnpm test:ejemplo
//
// El ejemplo es lo primero que ve quien abre XENCRM: la configuración de la raíz, la semilla de la demostración y lo
// que dice la interfaz. Aquí se prueba que el ejemplo carga entero, que la semilla tiene lo que promete (el embudo de
// una firma de software, el plan de soporte de cada cliente, tickets con el formato que comparten las pantallas de
// Servicio) y que nada de lo que se ve nombra al ejemplo de antes (DUNOR, una boutique).
//
// 🪤 Las pruebas del resto de la batería NO usan este ejemplo: corren contra su propio negocio de mentira
// (src/eval/fixtures/boutique, «Atelier Demo»), para que cambiar el ejemplo no las rompa. Esta es la única que mira
// el ejemplo, y lo lee por su ruta, no por XENCRM_CONFIG.
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const tmp = mkdtempSync(join(tmpdir(), 'xencrm-ejemplo-'));
process.env.DB_PATH = join(tmp, 'xencrm.db');
// 🪤 «Todo debe ser configurable»: esta prueba corre con OTRO negocio —un taller que agenda «turnos» (masculino),
// con su bienvenida, sus ejemplos y su portada— y comprueba que lo que dice XENCRM sale de ahí y no de XENTRIS ni de
// la boutique. Si un texto de negocio quedara fijo en el código, aquí diría «cita» o «demo».
const OTRO = {
  ...JSON.parse(readFileSync('examples/xentris/xencrm.config.json', 'utf8')),
  business: { name: 'Taller Ruedas', description: 'Taller de motos', siteUrl: 'https://ruedas.example', currency: 'COP', humanContact: 'al 300' },
  // Su propio perfil (vacío): el nombre que se ve sale del perfil cuando lo hay, y el de XENTRIS taparía este.
  profileFile: '__PERFIL__',
  interfaz: {
    agenda: { singular: 'turno', plural: 'turnos', masculino: true },
    bienvenida: 'Así va el taller {negocio} esta mañana.',
    ejemplos: { datoPropio: 'Repuestos en bodega', vista: 'Motos de domicilio', documento: 'Garantía de reparación' },
    portada: { titulo: 'Tu taller, *al día*.', subtitulo: 'Turnos y repuestos sin papelito.', marca: 'RUEDAS', vista: [{ contacto: 'Moto Express', etapa: 'Turno asignado', rol: 'cita', valor: '$ 90 mil', paso: 'Turno mañana, 8:00 a. m.', tono: 'agenda', asignado: 'Pacho' }] },
  },
};
OTRO.profileFile = join(tmp, 'perfil.json');
writeFileSync(join(tmp, 'otro.config.json'), JSON.stringify(OTRO));
process.env.XENCRM_CONFIG = join(tmp, 'otro.config.json');
process.env.ADMIN_TOKEN = 'token-de-la-prueba-del-ejemplo-0123456789';

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};

const { loadBusinessConfig } = await import('../config.js');
const { ProfileSchema, pendingFields } = await import('../profile.js');

console.log('— El ejemplo es XENTRIS LLC, y es la configuración de la raíz');
const raiz = loadBusinessConfig('xencrm.config.json');
const ejemplo = loadBusinessConfig('examples/xentris/xencrm.config.json');
check('la raíz es XENTRIS LLC', raiz.business.name === 'XENTRIS LLC', raiz.business.name);
check('y es la misma del ejemplo (no se desincronizan)', readFileSync('xencrm.config.json', 'utf8') === readFileSync('examples/xentris/xencrm.config.json', 'utf8'));
check('una firma de software: aplicaciones, desarrollo a la medida y soporte con SLA', /software/i.test(ejemplo.business.description) && /SLA/.test(ejemplo.business.description));
check('en dólares', ejemplo.business.currency === 'USD');
const etapas = ejemplo.crm.stages.map((s) => `${s.id}:${s.rol}`).join(',');
check('el embudo: Nuevo → Calificado → Evaluando → Demo agendada → Ganado · Perdido', etapas === 'nuevo:inicio,calificado:activo,evaluando:interes,demo_agendada:cita,ganado:ganado,perdido:perdido', etapas);
check('lo que agenda es una demo de producto, por videollamada', ejemplo.appointments.enabled && /demo/i.test(ejemplo.appointments.service) && /videollamada/i.test(ejemplo.appointments.location ?? ''));
const campos = ejemplo.crm.fields.map((f) => f.name);
check('capta lo de una venta de software: producto, empresa, usuarios, plan de soporte y plazo', ['producto', 'empresa', 'usuarios', 'plan_soporte', 'plazo'].every((c) => campos.includes(c)), campos.join(','));
const rutas = [ejemplo.sources.productsFile, ejemplo.sources.knowledgeDir, ejemplo.dictionaryFile, ejemplo.profileFile, ejemplo.evalFile, ejemplo.seedFile].filter(Boolean) as string[];
check('todo lo que nombra existe, y dentro de examples/xentris', rutas.every((r) => existsSync(r) && r.startsWith('examples/xentris/')), rutas.join(' · '));
check('🪤 el ejemplo de antes ya no está (examples/dunor)', !existsSync('examples/dunor'));

console.log('— Lo que sabe, completo');
const productos = JSON.parse(readFileSync(ejemplo.sources.productsFile!, 'utf8')) as { name: string; category: string }[];
check('el catálogo: los cuatro servicios de xentris.tech y los tres planes de soporte', ['Software y apps a la medida', 'Nube e infraestructura', 'IA y automatización', 'Consultoría y transformación digital', 'Soporte Básico', 'Soporte Pro', 'Soporte Enterprise'].every((n) => productos.some((p) => p.name === n)), productos.map((p) => p.name).join(','));
const conocimiento = readdirSync(ejemplo.sources.knowledgeDir!).filter((f) => f.endsWith('.md'));
check('el conocimiento: nosotros, productos, soporte y SLA, implementación, precios y preguntas de soporte', ['nosotros.md', 'productos.md', 'soporte-y-sla.md', 'implementacion.md', 'precios.md', 'preguntas-frecuentes.md'].every((f) => conocimiento.includes(f)), conocimiento.join(','));
const sla = readFileSync(join(ejemplo.sources.knowledgeDir!, 'soporte-y-sla.md'), 'utf8');
check('el SLA de cada plan está escrito (Básico 8 h, Pro 4 h, Enterprise 1 h)', /Básico \| 8 horas/.test(sla) && /Pro \| 4 horas/.test(sla) && /Enterprise \| 1 hora/.test(sla));
check('🪤 los precios los cotiza el equipo: el asistente no da cifras', /cotiza el equipo/i.test(readFileSync(join(ejemplo.sources.knowledgeDir!, 'precios.md'), 'utf8')));
const perfil = ProfileSchema.parse(JSON.parse(readFileSync(ejemplo.profileFile!, 'utf8')));
check('el perfil, sin huecos (nada queda «por confirmar»)', pendingFields(perfil).length === 0, pendingFields(perfil).join(', '));
const dicc = JSON.parse(readFileSync(ejemplo.dictionaryFile!, 'utf8')) as { topics: { query: string }[]; offerVerbs: string[] };
check('el diccionario habla de software: SLA, mantenimientos, actualizaciones, tickets', ['SLA', 'mantenimientos', 'actualizaciones', 'reportar'].every((q) => dicc.topics.some((t) => t.query.includes(q))), dicc.topics.map((t) => t.query).join(' | '));
const escenarios = JSON.parse(readFileSync(ejemplo.evalFile!, 'utf8')) as { name: string }[];
check('los escenarios: una app a la medida con demo, precio, una falla que pasa a soporte y el SLA del plan', escenarios.length >= 4 && /a la medida/.test(escenarios[0]!.name) && escenarios.some((e) => /soporte/.test(e.name)) && escenarios.some((e) => /SLA/.test(e.name)), escenarios.map((e) => e.name).join(' · '));

console.log('— La semilla promete lo que tiene');
type Ticket = { asunto: string; tipo?: string; prioridad?: string; estado?: string; producto?: string; haceHoras: number; primeraRespuestaEnMin?: number | null; resueltoEnHoras?: number | null; asignado?: string };
type Semilla = { id: string; name: string | null; stage: string; data: Record<string, unknown>; humanMode?: boolean; appointmentInHours?: number; messages: { role: string; text: string }[]; tickets?: Ticket[] };
const semilla = JSON.parse(readFileSync(ejemplo.seedFile!, 'utf8')) as Semilla[];
const ids = new Set(ejemplo.crm.stages.map((s) => s.id));
check(`unos 22 contactos (${semilla.length})`, semilla.length >= 20 && semilla.length <= 30);
check('cada uno en una etapa del embudo de XENTRIS', semilla.every((s) => ids.has(s.stage)), semilla.filter((s) => !ids.has(s.stage)).map((s) => s.stage).join(','));
check('y todo el embudo tiene a alguien', [...ids].every((id) => semilla.some((s) => s.stage === id)));
const ganados = semilla.filter((s) => s.stage === 'ganado');
const plan = (s: Semilla) => String(s.data.plan_soporte ?? '');
check('cada cliente ganado tiene su plan de soporte (Básico, Pro o Enterprise)', ganados.length >= 5 && ganados.every((s) => ['Básico', 'Pro', 'Enterprise'].includes(plan(s))), ganados.map((s) => `${s.name}:${plan(s)}`).join(', '));
check('y hay de los tres planes', ['Básico', 'Pro', 'Enterprise'].every((p) => ganados.some((s) => plan(s) === p)));
check('los perdidos dicen por qué', semilla.filter((s) => s.stage === 'perdido').every((s) => String(s.data.motivo_perdida ?? '').trim()));
check('2 o 3 con demo agendada (y su cita a futuro)', semilla.filter((s) => s.stage === 'demo_agendada' && (s.appointmentInHours ?? -1) > 0).length >= 2);
check('algunos con la conversación tomada por una persona', semilla.filter((s) => s.humanMode).length >= 2);
check('algunos con el valor del trato', semilla.filter((s) => Number(s.data.valor) > 0).length >= 6);
check('ninguna conversación vacía', semilla.every((s) => s.messages.length > 0));
const conTickets = semilla.filter((s) => s.tickets?.length);
const tickets = conTickets.flatMap((s) => s.tickets!);
check(`tickets en 8 o 9 clientes (${conTickets.length})`, conTickets.length >= 8 && conTickets.length <= 9);
check('🪤 solo los clientes (ganados) tienen tickets: el soporte es de quien ya compró', conTickets.every((s) => s.stage === 'ganado'));
const TIPOS = ['incidente', 'solicitud', 'actualizacion', 'mantenimiento'], PRIOS = ['critica', 'alta', 'media', 'baja'], ESTADOS = ['abierto', 'en_progreso', 'esperando_cliente', 'resuelto', 'cerrado'];
const malos = tickets.filter((t) => !t.asunto || !TIPOS.includes(t.tipo ?? '') || !PRIOS.includes(t.prioridad ?? '') || !ESTADOS.includes(t.estado ?? '') || !(t.haceHoras > 0)
  || !(t.primeraRespuestaEnMin === null || (typeof t.primeraRespuestaEnMin === 'number' && t.primeraRespuestaEnMin >= 0))
  || !(t.resueltoEnHoras === null || (typeof t.resueltoEnHoras === 'number' && t.resueltoEnHoras > 0)));
check('cada ticket con el formato del contrato (docs/xencrm.md › «Servicio»)', !malos.length, malos.map((t) => t.asunto).join(' | '));
const cerrado = (t: Ticket) => t.estado === 'resuelto' || t.estado === 'cerrado';
check('los resueltos tienen cuándo se resolvieron, y los abiertos no', tickets.every((t) => cerrado(t) === (typeof t.resueltoEnHoras === 'number')), tickets.filter((t) => cerrado(t) !== (typeof t.resueltoEnHoras === 'number')).map((t) => t.asunto).join(' | '));
check('🪤 nada se resolvió ni se contestó antes de abrirse', tickets.every((t) => (t.resueltoEnHoras ?? 0) <= t.haceHoras && (t.primeraRespuestaEnMin ?? 0) / 60 <= t.haceHoras));
check('hay un crítico sin primera respuesta (lo urgente de verdad)', tickets.some((t) => t.prioridad === 'critica' && t.primeraRespuestaEnMin === null && !cerrado(t)));
check('y de todo: de las cuatro prioridades y varios resueltos', PRIOS.every((p) => tickets.some((t) => t.prioridad === p)) && tickets.filter(cerrado).length >= 3);
check('🪤 uno ya incumplió su primera respuesta (Básico, 8 h hábiles: contestado a las 22 h)', tickets.some((t) => (t.primeraRespuestaEnMin ?? 0) > 8 * 60 && cerrado(t)));

console.log('— Y se siembra de verdad');
const { cargar, cuantas } = await import('../crm/demo.js');
const n = cargar({ archivo: ejemplo.seedFile });
check(`la semilla carga entera (${n} de ${semilla.length})`, n === semilla.length && cuantas() === semilla.length);

console.log('— Lo que se ve ya no es la boutique');
// Las líneas que se pintan (no los comentarios, que cuentan la historia de por qué algo es así).
const visibles = (archivo: string) => readFileSync(archivo, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*|<!--)/.test(l));
const PUBLICO = ['public/admin.html', 'public/admin.js', 'public/consola.html', 'public/inicio.html', 'public/widget.js', 'public/chat.html', 'public/demo.html', 'public/monitor.html', 'public/libreta.html'];
const conDunor = PUBLICO.flatMap((a) => visibles(a).filter((l) => /dunor/i.test(l)).map((l) => `${a}: ${l.trim().slice(0, 80)}`));
check('🪤 ninguna pantalla nombra a DUNOR', !conDunor.length, conDunor.slice(0, 4).join(' | '));
const boutique = PUBLICO.flatMap((a) => visibles(a).filter((l) => /esmoquin|cita privada|barranquilla|tipo de prenda|por ejemplo: tallas/i.test(l)).map((l) => `${a}: ${l.trim().slice(0, 80)}`));
check('ni habla de esmóquines, citas privadas, tallas ni Barranquilla', !boutique.length, boutique.slice(0, 4).join(' | '));
const recorrer = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? recorrer(join(dir, f)) : [join(dir, f)]));
const ejemplos = [...recorrer('examples'), 'xencrm.config.json', 'xencrm.config.example.json'].filter((f) => /dunor/i.test(readFileSync(f, 'utf8')));
check('ni los ejemplos ni la configuración de la raíz', !ejemplos.length, ejemplos.join(', '));
const portada = readFileSync('public/inicio.html', 'utf8');
check('la vista del tablero de la portada es de XENTRIS (contactos de una firma de software)', /<b>XENTRIS<\/b>/.test(portada) && /Demo agendada/.test(portada) && /US\$/.test(portada));
check('el borrador para retomar a alguien ofrece lo que el negocio agenda (no «una cita» a secas)', /state\.agendaQue = me\.agenda/.test(readFileSync('public/admin.js', 'utf8')) && /agenda: business\.appointments\.enabled \? business\.appointments\.service/.test(readFileSync('src/channels/admin.ts', 'utf8')));

console.log('— Todo lo que es del negocio sale de la configuración (con OTRO negocio, dice lo de ese otro)');
const ej = loadBusinessConfig('examples/xentris/xencrm.config.json');
check('el ejemplo pone a la vista todo lo de la interfaz: lo que agenda, la bienvenida, los ejemplos y la portada',
  ej.interfaz.agenda.singular === 'demo' && /XENTRIS/.test(ej.interfaz.bienvenida) && Object.keys(ej.interfaz.ejemplos).length >= 7 && ej.interfaz.portada.vista.length >= 4);
const crudo = JSON.parse(readFileSync('examples/xentris/xencrm.config.json', 'utf8')) as Record<string, Record<string, unknown>>;
const faltan = ['greeting', 'verifyPhrase', 'fullInfoMaxTokens'].filter((k) => !(k in crudo.agent!))
  .concat(['askPhone', 'askEmail', 'reminder'].filter((k) => !(k in crudo.appointments!)))
  .concat(['firmaHumano', 'motivosPerdida', 'contactoPor', 'analysisQuietSeconds', 'analysisMaxWaitSeconds'].filter((k) => !(k in crudo.crm!)))
  .concat(['sedes', 'brand', 'interfaz'].filter((k) => !(k in crudo)));
check('🪤 y lo que el esquema permite está escrito explícito (no por defecto escondido)', !faltan.length, faltan.join(', '));
const { V, vocabularioDe } = await import('../vocabulario.js');
check('el vocabulario del servidor es el de la configuración en uso (turno, masculino)', V.Citas === 'Turnos' && V.la === 'el' && V.g('agendadas') === 'agendados' && V.Ninguna === 'Ningún');
check('y con el de fábrica, «cita» en femenino', vocabularioDe({ singular: 'cita', plural: 'citas', masculino: false }).g('agendada') === 'agendada');
const { KPIS } = await import('../crm/kpis.js');
check('los KPIs dicen lo que agenda ESTE negocio («Turnos agendados», «Asistencia a turnos»)', KPIS.find((k) => k.id === 'citas')?.nombre === 'Turnos agendados' && KPIS.find((k) => k.id === 'asistencia')?.nombre === 'Asistencia a turnos', KPIS.filter((k) => /citas|asistencia/.test(k.id)).map((k) => k.nombre).join(' · '));
const { Hono } = await import('hono');
const { mountAdmin } = await import('../channels/admin.js');
const app = new Hono();
mountAdmin(app as never);
const me = (await (await app.request('/admin/api/me', { headers: { 'x-admin-token': process.env.ADMIN_TOKEN! } })).json()) as { business: string; agenda: string; interfaz: { agenda: { singular: string }; bienvenida: string; ejemplos: { vista: string } } };
check('/me le pasa al tablero el vocabulario, la bienvenida y los ejemplos de ESTE negocio', me.business === 'Taller Ruedas' && me.interfaz.agenda.singular === 'turno' && /Así va el taller/.test(me.interfaz.bienvenida) && me.interfaz.ejemplos.vista === 'Motos de domicilio', JSON.stringify(me.interfaz));
// El tablero: el mismo VOC que arma el navegador, sacado de admin.js tal cual.
const js = readFileSync('public/admin.js', 'utf8');
const fuente = js.slice(js.indexOf('function ponerVocabulario('), js.indexOf('ponerVocabulario(null);'));
const VOCDe = new Function(`var VOC; ${fuente}; return function (i) { ponerVocabulario(i); return VOC; };`)() as (i: unknown) => Record<string, string> & { g: (f: string) => string };
const voc = VOCDe(me.interfaz);
check('el tablero arma su vocabulario con lo que llega de /me', voc.Citas === 'Turnos' && voc.una === 'un' && voc.g('Próximas') === 'Próximos' && voc.bienvenida === 'Así va el taller {negocio} esta mañana.');
check('y sin /me (antes de que llegue), el de fábrica', VOCDe(null).Citas === 'Citas' && VOCDe(null).la === 'la');
// Ningún texto visible del tablero lleva «cita» escrita a mano: todo pasa por VOC (o es un identificador o un dato).
const lineasJs = js.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
const fijas = lineasJs.filter((l) => /['">][^'"<]*\b[Cc]itas?\b[^'"<]*['"<]/.test(l))
  // Lo que sí puede decir «cita» porque no se lee: identificadores, datos, clases CSS (t-cita, h-cita) y propiedades (x.cita).
  .map((l) => l.replace(/VOC\.\w+|'cita'|data-k="citas"|'citas'|"citas"|k: 'citas'|id: 'citas'|cita_agendada|data-ic="citas"|ic: 'citas'|=== 'cita'|'cita'\)|data-cita|class="cita|\.cita'|linea-citas|punto citas|fx-n-citas|'\/appointments'|c\.citas|n-citas|citas\.length|'exp-citas', 'citas'|get cita\(\)|\['citas', |-cita\b|\b\w+\.cita\b|\bcitas\b(?=\s*[.,;)\]])/g, ''))
  .filter((l) => /['">][^'"<]*\b[Cc]itas?\b[^'"<]*['"<]/.test(l));
check('🪤 ningún texto del tablero dice «cita» fijo (todo sale de VOC)', !fijas.length, fijas.slice(0, 3).map((l) => l.trim().slice(0, 90)).join(' | '));
const html = readFileSync('public/admin.html', 'utf8');
const fijasHtml = html.split('\n').filter((l) => !/^\s*(<!--|\/\*|\*)/.test(l) && />[^<]*\b[Cc]itas?\b[^<]*</.test(l) && !/data-voc=/.test(l));
check('ni en el HTML: lo fijo que dice «cita» lleva su plantilla (data-voc)', !fijasHtml.length, fijasHtml.slice(0, 3).map((l) => l.trim().slice(0, 90)).join(' | '));
check('el menú, la cabecera de la agenda y la bienvenida de Inicio salen de VOC', /view: 'calendar', get lbl\(\) \{ return VOC\.Citas; \}/.test(js) && /calendar: \[VOC\.Citas,/.test(js) && /VOC\.bienvenida\.replace\(\/\\\{negocio\\\}\/g, biz\)/.test(js));
check('los ejemplos de los campos salen de la configuración', /VOC\.ej\.datoPropio/.test(js) && /VOC\.ej\.vista/.test(js) && /\['k-doc-titulo', ej\.documento\]/.test(js));
// Lo que arma el servidor (respuestas del flujo de agendar, recordatorios, el próximo paso, la historia, los motivos
// de la salud, la guía…) también: con el taller, el próximo paso de alguien con turno dice «Turno …».
const { proximoPaso } = await import('../crm/proximo.js').catch(() => ({ proximoPaso: null }));
check('el próximo paso arma su texto con el vocabulario (V.Cita), no con «Cita» fija', /paso\('cita', `\$\{V\.Cita\} \$\{cuandoCorto\(cita, now\)\}`/.test(readFileSync('src/crm/proximo.ts', 'utf8')) && proximoPaso !== undefined);
const recorrerTs = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? (f === 'eval' ? [] : recorrerTs(join(dir, f))) : f.endsWith('.ts') ? [join(dir, f)] : []));
// Lo que puede decir «cita» fijo porque no es del negocio: la terminal de alta (onboard, clientes: el tipo de plantilla
// se llama «Citas»), la consola (atiende a varios negocios a la vez), nombres de archivo (citas.ics), consultas internas
// al índice y la ayuda del diccionario.
// src/config.ts: los valores de fábrica del esquema (la etapa «Cita agendada» del embudo por defecto), que se cambian
// en la configuración.
const PERMITIDOS = ['src/config.ts', 'src/onboard.ts', 'src/clientes.ts', 'src/consola.ts', 'src/crm/series.ts', 'src/channels/calendar.ts', 'src/agent/dictionary.ts', 'src/portada.ts'];
const servidorFijo = recorrerTs('src').filter((f) => !PERMITIDOS.includes(f)).flatMap((f) => readFileSync(f, 'utf8').split('\n')
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && !/_RE\b|\/\^|\/\\b|'\/cita|\/cita\//.test(l))
  .map((l) => l.replace(/V\.\w+|\b\w+\.citas?\b|\$\{cita \?|\(cita,|, cita\)|'citas?'|noteMiss\([^)]*\)|cita_agendada|\$\{cita\}|cómo visitar la tienda, horarios y citas/g, ''))
  .filter((l) => /`[^`]*\b[Cc]itas?\b[^`]*`|'[^']*\b[Cc]itas?\b[^']*'/.test(l)).map((l) => `${f}: ${l.trim().slice(0, 80)}`));
check('🪤 ningún texto del servidor dice «cita» fijo (fuera de la terminal, la consola y los nombres de archivo)', !servidorFijo.length, servidorFijo.slice(0, 4).join(' | '));
const { pintarPortada } = await import('../portada.js');
const { business: otro } = await import('../config.js');
const portadaOtra = pintarPortada(readFileSync('public/inicio.html', 'utf8'), otro.interfaz.portada);
check('la portada dice el titular, la marca y la vista de ESTE negocio', /<h1>Tu taller, <em>al día<\/em>\.<\/h1>/.test(portadaOtra) && /<b>RUEDAS<\/b>/.test(portadaOtra) && /Moto Express/.test(portadaOtra) && /Turnos y repuestos/.test(portadaOtra));
check('🪤 y ya no la del ejemplo', !/Café Aroma|<b>XENTRIS<\/b>|soporte, atendidos/.test(portadaOtra));
check('la portada del repositorio es la de XENTRIS pintada con su configuración (no se desincronizan)', pintarPortada(readFileSync('public/inicio.html', 'utf8'), ej.interfaz.portada) === readFileSync('public/inicio.html', 'utf8'));

console.log(fail ? `\n${fail} fallas` : '\ntodo bien');
process.exit(fail ? 1 : 0);
