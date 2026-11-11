// Pruebas del candado del modo fácil, sin modelo: pnpm test:candado
//
// DUNOR pidió un aiva sencillo del que nadie de su lado se saliera: con el modo fácil puesto, solo quien administra
// aiva (el super-admin) lo quita y ve lo avanzado; el admin del cliente y los asesores atienden y nada más. Aquí se
// prueba la regla (channels/candado.ts), que el servidor la cumple de verdad, y que el tablero no enseña las
// puertas que el servidor no abre.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'aiva-candado-')), 'aiva.db');
process.env.ADMIN_TOKEN = 'token-del-tablero-de-prueba-0123456789';
const { touchUser, appendMessage } = await import('../agent/memory.js');
const { getContact } = await import('../crm/contacts.js');
const { frenoDelCandado, mandaEnElModo } = await import('../channels/candado.js');
const { Hono } = await import('hono');
const { mountAdmin } = await import('../channels/admin.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};

console.log('— La regla');
const puede = (ruta: string, metodo: string, rol: string | undefined, modo: 'facil' | 'completo' = 'facil') => frenoDelCandado(ruta, metodo, rol, modo) === null;
check('el token a secas no tiene candado: ese token abre cualquier ruta igual', puede('config', 'PUT', undefined) && puede('contacts/x', 'DELETE', undefined) && puede('ventas', 'GET', undefined));
check('el super-admin tampoco', puede('config', 'PUT', 'super') && puede('channels/whatsapp', 'POST', 'super') && puede('export/contactos', 'GET', 'super'));
check('solo mandan el super y el token', mandaEnElModo(undefined) && mandaEnElModo('') && mandaEnElModo('super') && !mandaEnElModo('admin') && !mandaEnElModo('asesor'));
for (const rol of ['admin', 'asesor']) {
  check(`sin el modo fácil, ${rol} sigue como estaba`, puede('config', 'PUT', rol, 'completo') && puede('contacts/x', 'DELETE', rol, 'completo') && puede('ventas', 'GET', rol, 'completo'));
  check(`🪤 pero el modo no lo cambia ${rol}, ni puesto ni quitado: el candado no se abre desde adentro`, !puede('tablero/modo', 'PUT', rol, 'completo') && !puede('tablero/modo', 'PUT', rol, 'facil'));
  check(`con el modo fácil, ${rol} atiende: contesta, adjunta, toma la conversación, anota`,
    ['contacts/wa%3A573001234567%40s.whatsapp.net/reply', 'contacts/web%3A1/adjunto', 'contacts/web%3A1/human', 'contacts/web%3A1/notas', 'contacts/web%3A1/presencia', 'contacts/web%3A1/archive', 'contacts/web%3A1/snooze', 'contacts/web%3A1/merge', 'contacts/web%3A1/mensajes/12/reintentar', 'contacts/leidas', 'contacts'].every((r) => puede(r, 'POST', rol)));
  check(`mueve etapas y agenda`, puede('contacts/web%3A1', 'PATCH', rol) && puede('appointments', 'POST', rol) && puede('appointments/7', 'PATCH', rol) && puede('appointments/7/reminded', 'POST', rol));
  check(`borra sus notas, fija conversaciones, contesta lo que aiva pregunta y lo que propone`,
    puede('contacts/web%3A1/notas/31', 'DELETE', rol) && puede('fijados', 'PUT', rol) && puede('verifications/3/answer', 'POST', rol) && puede('verifications/3/dismiss', 'POST', rol) && puede('propuestas/4/enviar', 'POST', rol) && puede('propuestas/4/descartar', 'POST', rol));
  check(`y lee lo que el tablero necesita para arrancar`, ['me', 'stats', 'cuentas', 'fijados', 'notifications', 'agent', 'contacts', 'contacts/web%3A1', 'contacts/web%3A1/duplicates', 'today', 'appointments', 'busy', 'slots', 'stream', 'rapidas', 'propuestas', 'medios/abc', 'config', 'profile', 'channels'].every((r) => puede(r, 'GET', rol)));
  check(`🪤 pero no configura: perfil, el negocio, canales, el asistente, lo que sabe`,
    !puede('profile', 'POST', rol) && !puede('config', 'PUT', rol) && !puede('config/restart', 'POST', rol) && !puede('channels/whatsapp', 'POST', rol) && !puede('channels/web/modo', 'POST', rol) &&
    !puede('whatsapp/desvincular', 'POST', rol) && !puede('agent/sugiere', 'PUT', rol) && !puede('documentos', 'POST', rol) && !puede('documentos/precios.pdf', 'DELETE', rol) &&
    !puede('interno', 'POST', rol) && !puede('rapidas', 'POST', rol) && !puede('catalogo', 'POST', rol) && !puede('misses/teach', 'POST', rol) && !puede('dictionary/import', 'POST', rol));
  check(`ni hace lo avanzado: borrar una ficha, reanalizar, el simulador, importar, respaldar`,
    !puede('contacts/web%3A1', 'DELETE', rol) && !puede('contacts/web%3A1/analyze', 'POST', rol) && !puede('prueba', 'POST', rol) && !puede('historial/importar', 'POST', rol) &&
    !puede('respaldo', 'POST', rol) && !puede('demo', 'POST', rol) && !puede('reindexar', 'POST', rol) && !puede('avisos', 'PUT', rol) && !puede('tiempos/acuerdo', 'PUT', rol));
  check(`ni lee el consumo ni se lleva los datos`,
    ['usage', 'export/contactos', 'respaldo', 'historial', 'dictionary/export', 'presupuesto', 'turnos/9', 'prueba', 'vivo', 'misses'].every((r) => !puede(r, 'GET', rol)));
  // 🪤 2026-11-04: Ventas, Seguimientos y Analítica están en el menú de Nexora, la muestra del modo fácil que mandó
  // DUNOR: son de quien vende. Antes se cerraban; ahora se leen (y siguen sin poder configurarse).
  check(`🪤 pero sí lee Ventas, Seguimientos y Analítica`, ['ventas', 'seguimientos', 'series', 'origenes', 'tiempos'].every((r) => puede(r, 'GET', rol)));
  check(`y el acuerdo de tiempos de Analítica no lo cambia`, !puede('tiempos/acuerdo', 'PUT', rol));
}
check('🪤 una ruta que no está en la lista nace cerrada: lo de mañana no queda abierto por olvido', !puede('algo-nuevo', 'POST', 'asesor') && !puede('contacts/web%3A1/algo-nuevo', 'POST', 'asesor'));
check('el método se lee sin importar mayúsculas', puede('contacts/web%3A1', 'patch', 'asesor') && !puede('config', 'put', 'asesor'));
check('un segmento de más no se cuela por una ruta permitida', !puede('contacts/web%3A1/reply/x', 'POST', 'asesor') && !puede('appointments/7/x', 'PATCH', 'asesor') && !puede('contacts/web%3A1/analyze/notas', 'POST', 'asesor'));

console.log('— El servidor la cumple');
const app = new Hono();
mountAdmin(app as never);
const T = { 'x-admin-token': process.env.ADMIN_TOKEN!, 'content-type': 'application/json' };
const pedir = (ruta: string, init: { method?: string; body?: unknown; rol?: string } = {}) =>
  app.request(`/admin/api${ruta}`, { method: init.method ?? 'GET', headers: init.rol ? { ...T, 'x-aiva-rol': init.rol } : T, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
const id = 'wa:573001234567@s.whatsapp.net', enc = encodeURIComponent(id);
touchUser(id, 'whatsapp', 'Andrés Peña');
appendMessage(id, 'user', 'hola, ¿tienen trajes para boda?', 'consulta');
const otro = 'web:candado-2';
touchUser(otro, 'web', 'Para borrar');

check('el admin del cliente no prende el modo fácil', (await pedir('/tablero/modo', { method: 'PUT', body: { modo: 'facil' }, rol: 'admin' })).status === 403);
check('un asesor tampoco', (await pedir('/tablero/modo', { method: 'PUT', body: { modo: 'facil' }, rol: 'asesor' })).status === 403);
const pone = await pedir('/tablero/modo', { method: 'PUT', body: { modo: 'facil' }, rol: 'super' });
check('el super-admin sí', pone.status === 200 && ((await pone.json()) as { modo: string }).modo === 'facil');
check('y lo dice /stats, que es de donde lo lee el tablero', ((await (await pedir('/stats', { rol: 'asesor' })).json()) as { modo: string }).modo === 'facil');
for (const rol of ['admin', 'asesor']) {
  const etapa = rol === 'admin' ? 'interesado' : 'conversando';
  const mueve = await pedir(`/contacts/${enc}`, { method: 'PATCH', body: { stage: etapa }, rol });
  check(`${rol}: mueve una etapa`, mueve.status === 200 && getContact(id)?.stage === etapa, `${mueve.status} ${getContact(id)?.stage}`);
  check(`${rol}: anota`, (await pedir(`/contacts/${enc}/notas`, { method: 'POST', body: { texto: `nota de ${rol}` }, rol })).status === 201);
  check(`${rol}: lee la lista`, (await pedir('/contacts', { rol })).status === 200);
  const config = await pedir('/config', { method: 'PUT', body: { negocio: { nombre: 'Otro' } }, rol });
  check(`${rol}: no toca la configuración, y dice por qué`, config.status === 403 && /modo fácil/.test(((await config.json()) as { error: string }).error));
  check(`${rol}: ve Ventas, que está en el menú del modo fácil`, (await pedir('/ventas', { rol })).status === 200);
  check(`${rol}: no ve lo que cuesta aiva`, (await pedir('/usage', { rol })).status === 403);
  check(`${rol}: no se baja los clientes en Excel`, (await pedir('/export/contactos', { rol })).status === 403);
  const borra = await pedir(`/contacts/${encodeURIComponent(otro)}`, { method: 'DELETE', rol });
  check(`${rol}: no borra una ficha, y la ficha sigue ahí`, borra.status === 403 && Boolean(getContact(otro)));
  check(`${rol}: no se quita el modo`, (await pedir('/tablero/modo', { method: 'PUT', body: { modo: 'completo' }, rol })).status === 403);
}
check('el super-admin sí ve lo que cuesta', (await pedir('/usage', { rol: 'super' })).status === 200);
check('🪤 el candado va DESPUÉS del token: sin token no se sabe ni que hay candado', (await app.request('/admin/api/usage', { headers: { 'x-aiva-rol': 'asesor' } })).status === 401);
check('el token a secas borra (es su token)', (await pedir(`/contacts/${encodeURIComponent(otro)}`, { method: 'DELETE' })).status === 200 && !getContact(otro));
check('el super-admin quita el modo', ((await (await pedir('/tablero/modo', { method: 'PUT', body: { modo: 'completo' }, rol: 'super' })).json()) as { modo: string }).modo === 'completo');
check('y el asesor vuelve a como estaba', (await pedir('/usage', { rol: 'asesor' })).status === 200);

console.log('— El tablero no enseña lo que el servidor no abre');
const js = readFileSync(new URL('../../public/admin.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../../public/admin.html', import.meta.url), 'utf8');
const consolaHtml = readFileSync(new URL('../../public/consola.html', import.meta.url), 'utf8');
/** Una función de admin.js por su nombre, entera (llaves balanceadas), para probarla con lo que se le dé. */
const funcion = (nombre: string): string => {
  const i = js.indexOf(`function ${nombre}(`);
  if (i < 0) throw new Error(`no está ${nombre}`);
  let n = 0;
  for (let j = js.indexOf('{', i); j < js.length; j++) {
    if (js[j] === '{') n++;
    else if (js[j] === '}' && --n === 0) return js.slice(i, j + 1);
  }
  throw new Error(`sin cerrar ${nombre}`);
};
type Modo = { esFacil(): boolean; enCandado(): boolean; mandaEnElModo(): boolean; visiblePara(d: object): boolean };
const tablero = (rol: string | undefined, equipo: string, mio = ''): Modo => {
  const guardado: Record<string, string> = { 'l:modo': mio };
  return new Function('window', 'state', 'localStorage', 'LLAVE',
    ['rolDeQuienEntro', 'esAdmin', 'mandaEnElModo', 'visiblePara', 'modoMio', 'modoDelEquipo', 'esFacil', 'enCandado'].map(funcion).join('\n') +
    '\nreturn { esFacil: esFacil, enCandado: enCandado, mandaEnElModo: mandaEnElModo, visiblePara: visiblePara };',
  )(rol === undefined ? {} : { AIVA_ROL: rol }, { modoCliente: equipo }, { getItem: (k: string) => guardado[k] || null }, (k: string) => 'l:' + k) as Modo;
};
check('con el modo fácil del equipo, bryan (admin) entra en fácil y con candado', tablero('admin', 'facil').esFacil() && tablero('admin', 'facil').enCandado());
check('🪤 y aunque su navegador recuerde «completo», no se sale', tablero('admin', 'facil', 'completo').esFacil() && tablero('asesor', 'facil', 'completo').esFacil());
check('el super-admin sí puede verlo completo desde su navegador', !tablero('super', 'facil', 'completo').esFacil() && !tablero('super', 'facil').enCandado());
check('con el token a secas, igual que el super', !tablero(undefined, 'facil', 'completo').esFacil() && !tablero(undefined, 'facil').enCandado());
check('sin el modo fácil no hay candado para nadie', !tablero('asesor', 'completo').enCandado() && !tablero('asesor', 'completo').esFacil());
check('🪤 y quien no manda no se pone el modo fácil a medias: sigue al equipo', !tablero('asesor', 'completo', 'facil').esFacil());
check('los dos interruptores son solo para quien manda', !tablero('admin', 'facil').visiblePara({ soloSuper: true }) && tablero('super', 'facil').visiblePara({ soloSuper: true }) && tablero(undefined, 'completo').visiblePara({ soloSuper: true }));
check('el de cada quien y el del equipo llevan soloSuper', /proxy: 'modo-equipo-btn'[^}]*soloSuper: true/.test(js) && /proxy: 'modo-btn'[^}]*soloSuper: true/.test(js));
check('el menú de «Tú» también pasa por el filtro (antes no pasaba por ninguno)', /CFG_TUYO\.filter\(visiblePara\)/.test(js));
check('y el del celular se esconde a quien no manda', /class="btn solo-quien-manda" data-proxy="modo-btn"/.test(html));
check('todo lo de «Este cliente» se va con el candado, con su título y su raya', /CFG_CLIENTE\.forEach\(function \(d\) \{ d\.candado = true; \}\)/.test(js) && /d\.candado \? ' de-quien-administra'/.test(js) && /deEsteCliente\.classList\.add\('de-quien-administra'\)/.test(js));
check('las reglas que lo esconden existen', /:root\[data-manda="no"\] \.solo-quien-manda\{display:none!important\}/.test(html) && /:root\[data-candado="si"\] \.de-quien-administra\{display:none!important\}/.test(html));
check('y la raíz las lleva puestas', /setAttribute\('data-manda'/.test(js) && /setAttribute\('data-candado', enCandado\(\)/.test(js));
check('borrar una ficha es de quien administra', /class="btn sm de-quien-administra" id="del-btn"/.test(js));
check('🪤 ninguna puerta abre lo de quien administra: go() lo frena aunque llegue por un aviso o un «cárgalos»', /if \(enCandado\(\) && VISTAS_DE_QUIEN_ADMINISTRA\[view\]\)/.test(funcion('go')));
const vistas = /var VISTAS_DE_QUIEN_ADMINISTRA = \{([^}]*)\}/.exec(js)?.[1] ?? '';
check('y esas son la configuración y lo avanzado', ['guia', 'profile', 'negocio', 'agent', 'channels', 'knowledge', 'trazas'].every((v) => new RegExp(`\\b${v}: 1`).test(vistas)), vistas);
check('🪤 Analítica, Ventas y Seguimientos no: están en el menú del modo fácil', ['analysis', 'ventas', 'seguimientos'].every((v) => !new RegExp(`\\b${v}: 1`).test(vistas)), vistas);
check('el «Ver todo XENCRM» de Inicio es solo para quien puede verlo, y solo en el modo fácil', /\(esFacil\(\) && mandaEnElModo\(\) \? '<button class="fx-todo" type="button" id="hoy-ver-todo">/.test(funcion('pintarResumenDelDia')));
check('los avisos del sistema no le llegan a quien no puede atenderlos', /function avisoParaMi/.test(js) && /list\.filter\(avisoParaMi\)/.test(js) && /if \(!avisoParaMi\(n\)\) return;/.test(js));
check('🪤 ni la guía de inicio de Hoy, que es toda de configuración (bryan, por ser admin, la veía)', /if \(!esAdmin\(\) \|\| enCandado\(\)\) return helpBanner\(\);/.test(funcion('bannerDeHoy')));
check('la Ayuda no manda a pantallas cerradas', /enCandado\(\) && VISTAS_DE_QUIEN_ADMINISTRA\[x\.s\.view\]/.test(js) && /q\[2\] === 'candado' && enCandado\(\)/.test(js));

console.log('— Más sencillo para todos en el modo fácil');
check('los números de arriba de Hoy no van', /class="kpis solo-completo" id="kpis"/.test(html));
check('Calientes y Míos del riel tampoco (ya son filtros); los fijados sí', /'<div class="solo-completo"><div class="rl-t">Listas<\/div>'/.test(js) && /'<div class="rl-t">Fijados<\/div>'/.test(js));
check('la insignia de Seguimientos no cuenta en el modo fácil, ni se pide', /class="badge solo-completo" id="badge-seg"/.test(html) && /if \(!esFacil\(\)\) api\('\/seguimientos'\)/.test(js));
check('«Prospecto claro» y «Posible prospecto» se van con el puntaje', /v\.cls === 'v-si' \|\| v\.cls === 'v-posible' \? ' solo-completo'/.test(funcion('verdictChip')));
check('«Bajar en Excel» no va', /class="btn sm solo-completo" id="cli-csv"/.test(html));
check('las cifras del embudo no se piden si no se ven', /if \(!esFacil\(\)\) api\('\/ventas\?days=30'\)/.test(js));
check('🪤 la pastilla vacía de «La lleva» en la cabecera ya no sale', /\.chip\[hidden\]\{display:none\}/.test(html));
check('🪤 los botones de «Más» en el celular salen con su ícono (se pintaban antes de existir)', /function openMore\(\) \{ iconos\(\$\('more-grid'\)\);/.test(js));
check('la pestaña recordada de un área no abre lo que el modo fácil esconde', /esFacil\(\) && SOLO_COMPLETO_VISTAS\[ultima\]/.test(js));

console.log('— La consola');
check('el super lo pone y lo quita desde «⋯» de cada cliente', /class="btn sm modo-facil"/.test(consolaHtml) && /cli\(slug \+ '\/tablero\/modo', \{ method: 'PUT'/.test(consolaHtml));
check('y solo el super ve ese botón', /\(esSuper \? '<hr>' \+\s*\n\s*\/\/[^\n]*\n\s*\(e\.arriba \? '<button class="btn sm modo-facil"/.test(consolaHtml));
const consola = readFileSync(new URL('../consola.ts', import.meta.url), 'utf8');
check('la consola manda el rol por las dos puertas', (consola.match(/'x-aiva-rol': (miRol|rol)/g) ?? []).length === 2);
check('y sabe en qué modo está cada cliente', /modo: stats\?\.modo === 'facil' \? 'facil' : 'completo'/.test(consola));

console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
