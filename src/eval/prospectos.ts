// Pruebas de Ventas › Prospectos y del registro público, sin modelo ni red de afuera: pnpm test:prospectos
//
// Quien se registra en la portada tiene que aparecer en el CRM una sola vez, con su WhatsApp, y quedarse a la vista
// hasta que alguien lo atienda. Se prueba:
//  · lo que acepta el registro público, la trampa para bots (que no se entera) y el freno por dirección;
//  · el alta: la ficha con su número, sus datos y su origen; que no se duplique; que volver lo reabra;
//  · los estados, el paso al embudo, y que borrar, fusionar o anonimizar la ficha se lleve el prospecto;
//  · las rutas del tablero, el candado del modo fácil y el camino entero: portada → consola → CRM.
//
// 🪤 Todo en carpetas temporales y en puertos altos: no toca los clientes de verdad ni choca con nada corriendo.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'xencrm-prospectos-'));
const base = JSON.parse(readFileSync(new URL('../../xencrm.config.example.json', import.meta.url), 'utf8')) as Record<string, unknown>;
writeFileSync(join(dir, 'xencrm.config.json'), JSON.stringify({ ...base, timezone: 'America/Bogota' }));
writeFileSync(join(dir, '.env'), '');
const TOKEN = 'token-del-crm-de-prueba-0123456789';
Object.assign(process.env, {
  XENCRM_CONFIG: join(dir, 'xencrm.config.json'),
  XENCRM_ENV_FILE: join(dir, '.env'),
  DB_PATH: join(dir, 'xencrm.db'),
  WHATSAPP_ENABLED: 'false',
  ADMIN_TOKEN: TOKEN,
  XENCRM_CLIENTES_DIR: mkdtempSync(join(tmpdir(), 'xencrm-prospectos-clientes-')),
  CONSOLA_TOKEN: 'token-de-la-consola-de-prueba',
});
globalThis.fetch = (async (url: string | URL | Request) => {
  throw new Error(`la prueba no sale a la red: ${String(url)}`);
}) as typeof fetch;

const P = await import('../crm/prospectos.js');
const { revisarProspecto, frenoDelProspecto, olvidarFrenos, POR_IP, MS_MINIMOS } = await import('../prospecto-publico.js');
const { getContact, listEvents, deleteContact, STAGE_DEFS } = await import('../crm/contacts.js');
const { touchUser } = await import('../agent/memory.js');
const { origenDe } = await import('../crm/origen.js');
const { mergeContacts } = await import('../crm/merge.js');
const { anonimizar } = await import('../crm/retencion.js');
const { frenoDelCandado } = await import('../channels/candado.js');
const { Hono } = await import('hono');
const { mountAdmin } = await import('../channels/admin.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};
const bien = (b: Record<string, unknown>) => ({ nombre: 'Ana Gómez', whatsapp: '573001112233', acepto: true, ms: 9000, ...b });

// ---------------------------------------------------------------------------------------------------------------
console.log('— El registro público');
const r1 = revisarProspecto(bien({ empresa: '  Café   Aroma ', interes: 'soporte', desde: 'consola' }));
check('un registro completo pasa, limpio', 'ok' in r1 && r1.ok.nombre === 'Ana Gómez' && r1.ok.empresa === 'Café Aroma' && r1.ok.interes === 'soporte' && r1.ok.desde === 'consola', JSON.stringify(r1));
check('el número queda en dígitos, venga como venga', 'ok' in revisarProspecto(bien({ whatsapp: '+57 300-111 2233' })) && (revisarProspecto(bien({ whatsapp: '+57 300-111 2233' })) as { ok: { whatsapp: string } }).ok.whatsapp === '573001112233');
check('lo que no se conoce no entra: interés vacío y «portada»', (() => { const r = revisarProspecto(bien({ interes: 'hackear', desde: 'otra' })); return 'ok' in r && r.ok.interes === '' && r.ok.desde === 'portada'; })());
const sinNombre = revisarProspecto(bien({ nombre: ' a ' }));
check('sin nombre vuelve con su campo', 'error' in sinNombre && sinNombre.campo === 'nombre');
check('un «nombre» con un enlace, tampoco', 'error' in revisarProspecto(bien({ nombre: 'Mira www.spam.co' })));
const malNumero = revisarProspecto(bien({ whatsapp: '12345' }));
check('un número corto vuelve con su campo y cómo escribirlo', 'error' in malNumero && malNumero.campo === 'whatsapp' && /\+57/.test(malNumero.error));
const sinPermiso = revisarProspecto(bien({ acepto: false }));
check('sin el permiso para escribirle no se guarda', 'error' in sinPermiso && sinPermiso.campo === 'acepto');
check('🪤 la trampa llena es un bot, y se le contesta como a todos', 'bot' in revisarProspecto(bien({ sitio: 'http://x' })));
check('🪤 y uno que llena todo en menos de lo que tarda una persona, también', 'bot' in revisarProspecto(bien({ ms: MS_MINIMOS - 1 })) && 'ok' in revisarProspecto(bien({ ms: MS_MINIMOS })));
olvidarFrenos();
const t0 = 1_800_000_000_000;
const pasan = Array.from({ length: POR_IP.veces }, (_, i) => frenoDelProspecto('1.2.3.4', t0 + i));
check(`deja ${POR_IP.veces} registros por dirección`, pasan.every((x) => x === null));
const frenado = frenoDelProspecto('1.2.3.4', t0 + 10);
check('el siguiente se frena, y dice en cuánto puede volver', typeof frenado === 'number' && frenado > 0 && frenado <= POR_IP.ventanaMs / 1000, String(frenado));
check('otra dirección sigue pasando', frenoDelProspecto('5.6.7.8', t0 + 10) === null);
check('y pasada la ventana, la primera vuelve a pasar', frenoDelProspecto('1.2.3.4', t0 + POR_IP.ventanaMs + 1) === null);
olvidarFrenos();

// ---------------------------------------------------------------------------------------------------------------
console.log('— El alta en el CRM');
const ahora = Date.parse('2026-11-12T15:00:00-05:00');
const a = P.registrarProspecto({ nombre: 'Ana Gómez', whatsapp: '573001112233', empresa: 'Café Aroma', interes: 'ventas', desde: 'portada' }, ahora);
const ficha = getContact(a.prospecto.id);
check('entra como ficha de WhatsApp, con su número y su nombre', a.prospecto.id === 'wa:573001112233@s.whatsapp.net' && ficha?.name === 'Ana Gómez' && ficha?.phone === '573001112233' && !a.yaExistia, JSON.stringify(ficha));
check('con su empresa y lo que quiere resolver en sus datos', ficha?.data?.empresa === 'Café Aroma' && ficha?.data?.interes === 'ventas');
check('y queda como prospecto nuevo, de la portada', a.prospecto.estado === 'nuevo' && a.prospecto.desde === 'portada' && a.prospecto.veces === 1 && a.prospecto.creado === ahora);
const o = origenDe(a.prospecto.id);
check('su origen dice que vino del formulario', o?.fuente === 'formulario' && o?.medio === 'portada', JSON.stringify(o));
check('y su historia lo cuenta', listEvents(a.prospecto.id, 50).some((e) => e.type === 'prospecto' && e.payload.accion === 'registro'));
const otraVez = P.registrarProspecto({ nombre: 'Anita', whatsapp: '+57 300 111 2233', empresa: 'Otra', desde: 'consola' }, ahora + 1000);
check('🪤 si se registra otra vez, no se duplica: misma ficha, dos veces', otraVez.yaExistia && otraVez.prospecto.id === a.prospecto.id && otraVez.prospecto.veces === 2 && P.listarProspectos().prospectos.length === 1);
check('y lo que ya tenía no se pisa (el nombre, la empresa, de dónde vino)', getContact(a.prospecto.id)?.name === 'Ana Gómez' && otraVez.prospecto.empresa === 'Café Aroma' && otraVez.prospecto.desde === 'portada' && otraVez.prospecto.ultimoRegistro === ahora + 1000);
touchUser('wa:573004445566@s.whatsapp.net', 'whatsapp', 'Carlos (escribió antes)');
const deAntes = P.registrarProspecto({ nombre: 'Carlos Pérez', whatsapp: '573004445566', interes: 'soporte' }, ahora + 2000);
check('quien ya había escrito por WhatsApp se vuelve prospecto en su misma ficha', deAntes.yaExistia && deAntes.prospecto.id === 'wa:573004445566@s.whatsapp.net' && getContact(deAntes.prospecto.id)?.data?.interes === 'soporte');
const local = P.registrarProspecto({ nombre: 'Beto', whatsapp: '3007778899' }, ahora + 3000);
check('un número sin indicativo toma el de este negocio', local.prospecto.id === 'wa:573007778899@s.whatsapp.net', local.prospecto.id);
check('sin nombre o sin un WhatsApp de verdad, no entra', (() => { try { P.registrarProspecto({ nombre: 'X', whatsapp: '573001' }); return false; } catch { return true; } })());

// ---------------------------------------------------------------------------------------------------------------
console.log('— Los estados');
const lista = P.listarProspectos();
check('los más recientes arriba, con cuántos hay de cada estado', lista.prospectos[0]!.id === local.prospecto.id && lista.cuentas.nuevo === 3 && lista.cuentas.descartado === 0, JSON.stringify(lista.cuentas));
check('se filtran por estado', P.listarProspectos({ estado: 'nuevo' }).prospectos.length === 3 && P.listarProspectos({ estado: 'contactado' }).prospectos.length === 0);
const contactado = P.cambiarProspecto(a.prospecto.id, { estado: 'contactado' }, 'Laura', ahora + 5000);
check('se marca contactado, con quién lo movió', contactado.estado === 'contactado' && contactado.por === 'Laura' && listEvents(a.prospecto.id, 50).some((e) => e.type === 'prospecto' && e.payload.a === 'contactado' && e.payload.by === 'Laura'));
const etapaInicial = getContact(a.prospecto.id)!.stage;
const alEmbudo = P.cambiarProspecto(a.prospecto.id, { estado: 'en_embudo' }, 'Laura', ahora + 6000);
const activa = STAGE_DEFS.find((s) => s.rol === 'activo')!.id;
check('pasarlo al embudo lo saca de la etapa de entrada a la primera activa', STAGE_DEFS.find((s) => s.id === etapaInicial)?.rol === 'inicio' && alEmbudo.etapa === activa, `${etapaInicial} → ${alEmbudo.etapa}`);
check('un estado que no existe vuelve con por qué', (() => { try { P.cambiarProspecto(a.prospecto.id, { estado: 'ganado' }, 'Laura'); return false; } catch (e) { return /estado/.test((e as Error).message); } })());
check('y un prospecto que no existe, también', (() => { try { P.cambiarProspecto('wa:0@s.whatsapp.net', { estado: 'nuevo' }, 'Laura'); return false; } catch (e) { return /no existe/.test((e as Error).message); } })());
P.cambiarProspecto(local.prospecto.id, { estado: 'descartado' }, 'Laura', ahora + 7000);
const vuelve = P.registrarProspecto({ nombre: 'Beto', whatsapp: '3007778899' }, ahora + 8000);
check('🪤 un descartado que se registra otra vez vuelve a «nuevo»: está pidiendo que lo atiendan', vuelve.prospecto.estado === 'nuevo' && vuelve.prospecto.veces === 2);

// ---------------------------------------------------------------------------------------------------------------
console.log('— Lo que pasa con la ficha');
const b1 = P.registrarProspecto({ nombre: 'Doble Uno', whatsapp: '573005550001' }, ahora).prospecto.id;
touchUser('web:sesion-de-doble', 'web', 'Doble Web');
const fusion = mergeContacts(b1, 'web:sesion-de-doble');
check('al fusionar, el prospecto sigue con la ficha que queda', 'error' in (fusion as object) ? false : P.listarProspectos().prospectos.some((p) => p.id === b1), JSON.stringify(fusion));
const b2 = P.registrarProspecto({ nombre: 'Sobra', whatsapp: '573005550002' }, ahora).prospecto.id;
const b3 = P.registrarProspecto({ nombre: 'Queda', whatsapp: '573005550003' }, ahora).prospecto.id;
mergeContacts(b3, b2);
check('🪤 si las dos eran prospecto, queda uno (no choca la llave)', P.listarProspectos().prospectos.filter((p) => p.id === b3 || p.id === b2).length === 1);
deleteContact(b3);
check('borrar la ficha se lleva su prospecto', !P.listarProspectos().prospectos.some((p) => p.id === b3));
const b4 = P.registrarProspecto({ nombre: 'Anónimo', whatsapp: '573005550004', empresa: 'Su Empresa' }, ahora).prospecto.id;
anonimizar(b4);
check('anonimizarla también: su empresa es texto sobre la persona', !P.listarProspectos().prospectos.some((p) => p.empresa === 'Su Empresa'));

// ---------------------------------------------------------------------------------------------------------------
console.log('— Las rutas del tablero');
const app = new Hono();
mountAdmin(app as never);
const H = { 'x-admin-token': TOKEN, 'content-type': 'application/json' };
const pedir = (ruta: string, init: { method?: string; body?: unknown; rol?: string } = {}) =>
  app.request(`/admin/api${ruta}`, { method: init.method ?? 'GET', headers: init.rol ? { ...H, 'x-xencrm-rol': init.rol } : H, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
const nuevo = await pedir('/prospectos', { method: 'POST', body: { nombre: 'Por Ruta', whatsapp: '573006660001', interes: 'cotizacion' } });
check('el POST crea el prospecto (201)', nuevo.status === 201, String(nuevo.status));
check('el mismo otra vez dice que ya existía (200)', (await pedir('/prospectos', { method: 'POST', body: { nombre: 'Por Ruta', whatsapp: '573006660001' } })).status === 200);
check('sin datos útiles vuelve con 400', (await pedir('/prospectos', { method: 'POST', body: { nombre: '' } })).status === 400);
check('sin token, nada', (await app.request('/admin/api/prospectos')).status === 401);
const leidos = (await (await pedir('/prospectos?estado=nuevo', { rol: 'asesor' })).json()) as { prospectos: { id: string }[]; cuentas: Record<string, number> };
check('el GET lista y cuenta', leidos.prospectos.some((p) => p.id === 'wa:573006660001@s.whatsapp.net') && typeof leidos.cuentas.nuevo === 'number');
const mueve = await pedir(`/prospectos/${encodeURIComponent('wa:573006660001@s.whatsapp.net')}`, { method: 'PATCH', rol: 'asesor', body: { estado: 'contactado' } });
check('el PATCH lo mueve', mueve.status === 200 && ((await mueve.json()) as { estado: string }).estado === 'contactado');
check('y uno que no existe da 404', (await pedir(`/prospectos/${encodeURIComponent('wa:1@s.whatsapp.net')}`, { method: 'PATCH', body: { estado: 'nuevo' } })).status === 404);
check('el candado del modo fácil deja mover prospectos: es atender', frenoDelCandado('prospectos/wa%3A1%40s.whatsapp.net', 'PATCH', 'asesor', 'facil') === null && frenoDelCandado('prospectos', 'GET', 'asesor', 'facil') === null);

// ---------------------------------------------------------------------------------------------------------------
console.log('— De la portada al CRM, pasando por la consola');
const { serve } = await import('@hono/node-server');
const PUERTO = 39231;
const instancia = serve({ fetch: app.fetch, port: PUERTO, hostname: 'localhost' });
const { crearCliente } = await import('../clientes.js');
crearCliente({ nombre: 'La Casa', slug: 'casa', puerto: PUERTO });
process.env.TOKEN_CASA = TOKEN;
const { mountConsola } = await import('../consola.js');
const consola = new Hono();
mountConsola(consola);
const registrar = (body: Record<string, unknown>) => consola.request('http://local/api/prospecto', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
delete process.env.PROSPECTOS_CLIENTE;
const cerrado = await registrar(bien({ whatsapp: '573007770001' }));
check('sin PROSPECTOS_CLIENTE el registro está cerrado y lo dice (503)', cerrado.status === 503);
process.env.PROSPECTOS_CLIENTE = 'casa';
olvidarFrenos();
const llega = await registrar(bien({ nombre: 'Desde La Portada', whatsapp: '+57 300 777 0002', empresa: 'Panadería Sol', interes: 'ventas' }));
check('🪤 sin haber entrado a la consola, el registro pasa y llega al CRM', llega.status === 200 && P.listarProspectos().prospectos.some((p) => p.id === 'wa:573007770002@s.whatsapp.net' && p.empresa === 'Panadería Sol'), String(llega.status));
const malo = await registrar(bien({ whatsapp: '12' }));
check('lo que no sirve vuelve con su campo, sin tocar el CRM', malo.status === 400 && ((await malo.json()) as { campo: string }).campo === 'whatsapp');
const antesBot = P.listarProspectos().prospectos.length;
const bot = await registrar(bien({ whatsapp: '573007770003', sitio: 'lleno' }));
check('🪤 a un bot se le contesta 200 y no se guarda nada', bot.status === 200 && P.listarProspectos().prospectos.length === antesBot);
olvidarFrenos();
let ultimo = 0;
for (let i = 0; i < POR_IP.veces + 1; i++) ultimo = (await registrar(bien({ whatsapp: `57300888000${i}` }))).status;
check('la ráfaga desde una dirección se frena (429)', ultimo === 429);
check('el resto de /api sigue pidiendo sesión', (await consola.request('http://local/api/clientes')).status === 401);
instancia.close();
olvidarFrenos();

// ---------------------------------------------------------------------------------------------------------------
console.log('— La portada y la puerta');
const portada = readFileSync(new URL('../../public/inicio.html', import.meta.url), 'utf8');
const consolaHtml = readFileSync(new URL('../../public/consola.html', import.meta.url), 'utf8');
const olasDe = (h: string) => { const i = h.indexOf('/* ===== Olas:'), j = h.indexOf('/* ===== (fin de las olas) ===== */'); return i >= 0 && j > i ? h.slice(i, j) : ''; };
check('las olas están en las dos', olasDe(portada).length > 2000 && olasDe(consolaHtml).length > 2000);
check('🪤 y son el mismo código (si se toca uno, se toca el otro)', olasDe(portada) === olasDe(consolaHtml));
check('respetan «reducir movimiento» y se paran cuando nadie mira', /prefers-reduced-motion/.test(olasDe(portada)) && /visibilitychange/.test(olasDe(portada)) && /IntersectionObserver/.test(olasDe(portada)));
check('las dos mandan el registro a la consola, con la trampa y el tiempo', /data-prospecto="api\/prospecto"/.test(portada) && /fetch\('\/api\/prospecto'/.test(consolaHtml) && [portada, consolaHtml].every((h) => /sitio:/.test(h) && /ms: Date\.now\(\) - t0/.test(h) && /acepto: true/.test(h)));
check('y lo escrito no se borra si falla', [portada, consolaHtml].every((h) => /Tus datos siguen aquí/.test(h)));
const puerta = consolaHtml.slice(consolaHtml.indexOf('<div id="login"'), consolaHtml.indexOf('<div id="app"'));
check('🪤 la marca es la palabra XENCRM: ni la portada ni la puerta cargan logos de imagen', ![portada, puerta].some((h) => /<img\b/i.test(h)) && /<span>XEN<\/span>CRM/.test(portada) && /<span>XEN<\/span>CRM/.test(puerta));

console.log(fail ? `\n${fail} prueba(s) fallaron` : '\nTodo bien');
process.exit(fail ? 1 : 0);
