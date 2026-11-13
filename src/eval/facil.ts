// Pruebas del modo fácil con el aspecto de Nexora, sin modelo: pnpm test:facil
//
// DUNOR mandó Nexora como muestra de cómo quiere ver XENCRM («que se vea igual, pero en nuestro producto»). El modo
// fácil tomó su menú, su barra de arriba y su Inicio, con los datos y las acciones de XENCRM. Aquí se prueba que el
// menú es el de la muestra y que cada puerta abre (también con el candado), que la gráfica dice la verdad, que lo
// que se muda vuelve a su sitio y que el modo completo no cambió: todo lo nuevo vive detrás del modo fácil.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'xencrm-facil-')), 'xencrm.db');
process.env.ADMIN_TOKEN = 'token-del-tablero-de-prueba-0123456789';
const { getDb } = await import('../rag/store.js');
const { citasPorDia } = await import('../crm/series.js');
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
/** Una función de admin.js por su nombre, entera (llaves balanceadas). */
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

console.log('— El menú es el de la muestra');
const menu = js.slice(js.indexOf('var MENU_FACIL = ['), js.indexOf('var MENU_SERVICIO = ['));
// El vocabulario del negocio (VOC, xencrm.config.json › interfaz) se lee con sus valores de fábrica: «Citas» en el
// menú es un getter (get lbl() { return VOC.Citas; }) para que diga lo que agenda cada negocio.
const VOC_FABRICA: Record<string, string> = { cita: 'cita', citas: 'citas', Cita: 'Cita', Citas: 'Citas', la: 'la', La: 'La', las: 'las', una: 'una', Ninguna: 'Ninguna', otra: 'otra' };
const conVoc = (src: string) => src.replace(/get (\w+)\(\) \{ return VOC\.(\w+); \}/g, (_m, k: string, v: string) => `${k}: '${VOC_FABRICA[v] ?? v}'`)
  .replace(/VOC\.g\('([^']*)'\)/g, "'$1'").replace(/VOC\.(\w+)/g, (m, k: string) => (k in VOC_FABRICA ? `'${VOC_FABRICA[k]}'` : m)).replace(/'\s*\+\s*'/g, '');
const grupos = [...conVoc(menu).matchAll(/grupo: '([^']+)', items: \[([^\]]*)\]/g)].map((g) => ({ grupo: g[1], items: [...g[2]!.matchAll(/view: '([a-z]+)', lbl: '([^']+)'/g)].map((m) => [m[1], m[2]]) }));
check('el mapa de Dynamics 365: Mi trabajo, Clientes, Ventas, Rendimiento', grupos.map((g) => g.grupo).join(',') === 'Mi trabajo,Clientes,Ventas,Rendimiento', grupos.map((g) => g.grupo).join(','));
check('Mi trabajo: Inicio, Bandeja omnicanal, Lista de trabajo, Citas', grupos[0]?.items.map((x) => x[1]).join(',') === 'Inicio,Bandeja omnicanal,Lista de trabajo,Citas');
check('Clientes: Contactos y Cuentas clave · Ventas: Prospectos, Embudo, Tratos, Ventas · Rendimiento: KPIs y metas, Optimización de ventas, Analítica', grupos[1]?.items.map((x) => x[1]).join(',') === 'Contactos,Cuentas clave' && grupos[2]?.items.map((x) => x[1]).join(',') === 'Prospectos,Embudo,Tratos,Ventas' && grupos[3]?.items.map((x) => x[1]).join(',') === 'KPIs y metas,Optimización de ventas,Analítica');
const vistas = grupos.flatMap((g) => g.items.map((x) => x[0]!));
check('🪤 cada puerta lleva a una pantalla que existe (ninguna nueva: son las de siempre)', vistas.every((v) => html.includes(`id="view-${v}"`)), vistas.join(','));
const cerradas = /var VISTAS_DE_QUIEN_ADMINISTRA = \{([^}]*)\}/.exec(js)?.[1] ?? '';
const soloCompleto = /var SOLO_COMPLETO_VISTAS = \{([^}]*)\}/.exec(js)?.[1] ?? '';
check('🪤 ninguna es de las que cierra el candado: bryan no se topa con «Eso lo maneja quien administra XENCRM»', vistas.every((v) => !new RegExp(`\\b${v}: 1`).test(cerradas)), cerradas);
check('ni de las que el modo fácil esconde', vistas.every((v) => !new RegExp(`\\b${v}: 1`).test(soloCompleto)), soloCompleto);
check('la configuración sigue abajo, en el engranaje de siempre (con su candado)', /id="cfg-btn"/.test(html) && /CFG_CLIENTE\.forEach\(function \(d\) \{ d\.candado = true; \}\)/.test(js));

console.log('— Y cada puerta abre, también con el candado');
// Lo que lee cada pantalla del menú. Si una se queda sin datos con el candado, se ve vacía y nadie sabe por qué.
const lee: Record<string, string[]> = {
  today: ['today', 'series', 'stats', 'notifications', 'contacts'],
  analysis: ['stats', 'series', 'tiempos', 'origenes', 'sentimiento'],
  inbox: ['contacts', 'contacts/web%3A1', 'contacts/web%3A1/duplicates'],
  clientes: ['contacts'],
  calendar: ['appointments', 'busy', 'calendar'],
  pipeline: ['contacts', 'stats', 'embudo'],
  ventas: ['ventas'],
  seguimientos: ['seguimientos'],
  // Las pantallas de la suite (Dynamics 365). Cada agente pone aquí lo que su pantalla lee, en su renglón.
  // XEN · Embudo y filtrado
  embudo: ['contacts', 'embudo'],
  // XEN · Panel KAM
  kam: ['cuentas-clave'],
  // XEN · KPIs y metas
  kpis: ['kpis', 'metas'],
  // XEN · Optimización de ventas
  optimizacion: ['optimizacion'],
  // XEN · Tickets y SLA
  tickets: ['tickets', 'tickets/1', 'contacts'],
  sla: ['sla', 'sla/config', 'tickets/1'],
  // XEN · Mantenimientos y actualizaciones
  mantenimientos: ['mantenimientos', 'mantenimientos/cumplimiento'],
  // XEN · Prospectos
  prospectos: ['prospectos'],
  // (fin de las pantallas de la suite)
};
for (const v of [...vistas, 'tickets', 'sla', 'mantenimientos']) {
  for (const rol of ['admin', 'asesor']) {
    const frenadas = (lee[v] ?? []).filter((r) => frenoDelCandado(r, 'GET', rol, 'facil') !== null);
    check(`${v} (${rol}, modo fácil): lee todo lo que pinta`, Boolean(lee[v]) && !frenadas.length, frenadas.join(', ') || 'sin lista de lo que lee');
  }
}
const app = new Hono();
mountAdmin(app as never);
const T = { 'x-admin-token': process.env.ADMIN_TOKEN!, 'content-type': 'application/json' };
await app.request('/admin/api/tablero/modo', { method: 'PUT', headers: { ...T, 'x-xencrm-rol': 'super' }, body: JSON.stringify({ modo: 'facil' }) });
for (const ruta of ['/ventas', '/seguimientos', '/series?dias=7', '/tiempos', '/origenes', '/sentimiento']) {
  check(`el servidor la abre de verdad: ${ruta} con el candado`, (await app.request(`/admin/api${ruta}`, { headers: { ...T, 'x-xencrm-rol': 'asesor' } })).status === 200);
}
check('🪤 y lo que cuesta XENCRM sigue cerrado', (await app.request('/admin/api/usage', { headers: { ...T, 'x-xencrm-rol': 'asesor' } })).status === 403);

console.log('— La gráfica de Inicio dice la verdad');
const DIA = 86400_000, ahora = Date.parse('2026-11-04T15:00:00-05:00');
const cita = getDb().prepare("INSERT INTO appointments (user_id, starts_at, ends_at, service, status, notes, created_at) VALUES ('web:x', ?, ?, 'prueba', 'confirmada', '', ?)");
cita.run(ahora + 5 * DIA, ahora + 5 * DIA + 3600_000, ahora - 1000);
cita.run(ahora + 6 * DIA, ahora + 6 * DIA + 3600_000, ahora - 2 * 3600_000);
cita.run(ahora + 7 * DIA, ahora + 7 * DIA + 3600_000, ahora - 2 * DIA);
// 🪤 23:30 en Barranquilla ya es el día siguiente en Londres: cuenta en el día del negocio.
cita.run(ahora, ahora + 3600_000, Date.parse('2026-11-02T23:30:00-05:00'));
const dias = citasPorDia(7, ahora);
check('una casilla por día, del más viejo a hoy', dias.length === 7 && dias.at(-1)?.dia === '2026-11-04' && dias[0]?.dia === '2026-10-29', JSON.stringify(dias.map((d) => d.dia)));
check('cuenta el día en que se agendó, no el de la cita', dias.at(-1)?.citas === 2 && dias.find((d) => d.dia === '2026-11-02')?.citas === 2, JSON.stringify(dias));
check('los días sin nada dicen cero, no faltan', dias.filter((d) => d.citas === 0).length === 5);
const serie = (await (await app.request('/admin/api/series?dias=7', { headers: T })).json()) as { citas: { dia: string; citas: number }[]; nuevas: { dia: string }[] };
check('/series trae las citas junto a las conversaciones nuevas, día por día', Array.isArray(serie.citas) && serie.citas.length === serie.nuevas.length && serie.citas.every((c, i) => c.dia === serie.nuevas[i]!.dia));

const curvaSuave = new Function(`${funcion('curvaSuave')}; return curvaSuave;`)() as (p: number[][]) => string;
/** Los y de todos los puntos de control de la curva: si alguno se sale de los datos, la curva se pasa. */
const ys = (d: string) => [...d.matchAll(/-?\d+(\.\d+)?,(-?\d+(\.\d+)?)/g)].map((m) => Number(m[2]));
// 🪤 Asimétrico a propósito: con un valle simétrico la pendiente da cero aunque no se recorte, y la prueba no veía nada.
const plana = curvaSuave([[0, 100], [10, 100], [20, 0], [30, 20], [40, 20]]);
check('🪤 la curva no baja de cero entre dos días sin nada (en pantalla, y mayor es más abajo)', Math.max(...ys(plana)) <= 100 && Math.min(...ys(plana)) >= 0, plana);
const subida = curvaSuave([[0, 50], [10, 40], [20, 0], [30, 0]]);
check('ni se pasa del día más alto', Math.min(...ys(subida)) >= 0 && Math.max(...ys(subida)) <= 50, subida);
check('pasa por cada punto', ['0,50', '10,40', '20,0', '30,0'].every((p) => subida.includes(p)), subida);
check('con un solo día no revienta', curvaSuave([[5, 5]]) === 'M5,5' && curvaSuave([]) === '');
check('🪤 la escala deja aire arriba: el día más alto no toca el techo', /var tope = Math\.ceil\(\(max \+ 0\.5\) \/ 4\) \* 4/.test(funcion('dibujarSerieFacil')));
check('🪤 sin actividad la tarjeta lo dice, no dibuja una raya en cero', /Sin actividad todavía/.test(funcion('dibujarSerieFacil')));

console.log('— Lo que se muda vuelve a su sitio');
const mudar = funcion('mudarParaElFacil');
const mudanzas = [...mudar.matchAll(/\['([a-z-]+)', '([a-z-]+)'/g)].map((m) => [m[1]!, m[2]!]);
check('el buscador de Contactos y los controles del calendario', mudanzas.map((m) => m[0]).join(',') === 'cli-q,cal-prev,cal-next,cal-today,cal-label,cal-sede,cal-seg', mudanzas.join(' '));
check('todo lo que se muda y su destino existen', mudanzas.every(([a, b]) => html.includes(`id="${a}"`) && html.includes(`id="${b}"`)));
check('🪤 se muda, no se copia: un solo buscador (dos se desincronizan)', (html.match(/id="cli-q"/g) ?? []).length === 1 && !/cloneNode/.test(mudar));
check('🪤 XENCRM: lo llama aplicarModo siempre con la piel puesta, así que quitar el modo fácil no lo devuelve al completo', /function aplicarModo\(\) \{[\s\S]{0,400}?mudarParaElFacil\(true\);/.test(js));
// La mudanza de verdad, con un documento de juguete: va, vuelve al mismo sitio y vuelve a ir.
type Nodo = { id: string; parentNode: Nodo | null; hijos: Nodo[]; previousSibling: Nodo | null; nextSibling: Nodo | null; firstChild: Nodo | null; insertBefore(n: Nodo, ref: Nodo | null): void; appendChild(n: Nodo): void };
const nodo = (id: string): Nodo => {
  const n: Nodo = {
    id, parentNode: null, hijos: [],
    get previousSibling() { const h = n.parentNode?.hijos ?? []; return h[h.indexOf(n) - 1] ?? null; },
    get nextSibling() { const h = n.parentNode?.hijos ?? []; return h[h.indexOf(n) + 1] ?? null; },
    get firstChild() { return n.hijos[0] ?? null; },
    insertBefore(x, ref) { if (x.parentNode) x.parentNode.hijos.splice(x.parentNode.hijos.indexOf(x), 1); x.parentNode = n; const i = ref ? n.hijos.indexOf(ref) : -1; n.hijos.splice(i < 0 ? n.hijos.length : i, 0, x); },
    appendChild(x) { n.insertBefore(x, null); },
  } as Nodo;
  return n;
};
const ids: Record<string, Nodo> = {};
const barra = nodo('barra'), herr = nodo('fx-cli-herr'), izq = nodo('fx-cal-izq'), der = nodo('fx-cal-der');
for (const x of [herr, izq, der]) ids[x.id] = x;
for (const id of ['antes', 'cli-q', 'cal-prev', 'cal-today', 'cal-next', 'cal-label', 'cal-sede', 'cal-seg', 'despues']) { ids[id] = nodo(id); barra.appendChild(ids[id]!); }
const doc = { createComment: (t: string) => nodo('#' + t) };
const correr = new Function('$', 'document', `${mudar}; return mudarParaElFacil;`)((id: string) => ids[id] ?? null, doc) as (f: boolean) => void;
const orden = () => barra.hijos.filter((h) => !h.id.startsWith('#')).map((h) => h.id).join(',');
const antes = orden();
correr(true);
check('en el fácil cada pieza está en su tarjeta', ids['cli-q']!.parentNode === herr && izq.hijos.map((h) => h.id).join(',') === 'cal-prev,cal-next,cal-today,cal-label,cal-sede' && ids['cal-seg']!.parentNode === der, izq.hijos.map((h) => h.id).join(','));
correr(false);
check('🪤 y al volver al completo, cada una en su sitio exacto (no al final de la barra)', orden() === antes, orden());
correr(true); correr(false); correr(false);
check('ir y volver varias veces no deja nada fuera de lugar', orden() === antes && !herr.hijos.length && !izq.hijos.length, orden());

console.log('— La piel de XENCRM vive en su bloque, y el modo fácil ya no la cambia');
// XENCRM: la piel del fácil es la de todos. Va detrás de :root[data-piel="xen"] (que el <html> trae puesto) y el modo
// fácil solo esconde lo avanzado. Una regla suelta de aquí se le escaparía a la piel y tocaría lo de antes.
const bloque = html.slice(html.indexOf('/* ===== XENCRM: la piel de todos'), html.indexOf('/* ===== fin de la piel de XENCRM ===== */'));
check('la piel tiene su bloque de estilos', bloque.length > 1000);
check('y el <html> la trae puesta de fábrica', /<html lang="es" data-theme="light" data-piel="xen">/.test(html) && /setAttribute\('data-piel', 'xen'\)/.test(js));
check('🪤 el modo fácil no cambia el aspecto: dentro del bloque no hay ni una regla por data-modo', !/data-modo/.test(bloque.replace(/\/\*[\s\S]*?\*\//g, '')));
const sinComentarios = bloque.replace(/\/\*[\s\S]*?\*\//g, '');
const selectores: string[] = [];
const recorrer = (css: string) => {
  let i = 0;
  while (i < css.length) {
    const abre = css.indexOf('{', i);
    if (abre < 0) break;
    const cab = css.slice(i, abre).trim();
    let n = 1, j = abre + 1;
    for (; j < css.length && n; j++) { if (css[j] === '{') n++; else if (css[j] === '}') n--; }
    // @container también solo envuelve: la conversación de la bandeja se acomoda a su propio ancho.
    if (cab.startsWith('@media') || cab.startsWith('@supports') || cab.startsWith('@container')) recorrer(css.slice(abre + 1, j - 1));
    // Una animación (el brillo de los esqueletos de Inicio) no es una regla: no pinta nada hasta que una regla de
    // la piel la nombra. Sus «0%» y «to» no son selectores.
    else if (cab.startsWith('@keyframes')) { /* nada que vigilar */ }
    else if (cab) selectores.push(...cab.split(',').map((x) => x.trim()));
    i = j;
  }
};
recorrer(sinComentarios);
const sueltos = selectores.filter((sel) => !/^:root\[data-piel="xen"\]/.test(sel) && !/^:root:not\(\[data-piel="xen"\]\)/.test(sel) && !/^[.#](fx-|nav-fx|solo-facil)/.test(sel));
check(`🪤 ninguna de sus ${selectores.length} reglas se sale de la piel`, selectores.length > 100 && !sueltos.length, sueltos.slice(0, 8).join(' | '));
check('lo de la piel solo se ve con la piel puesta', /:root:not\(\[data-piel="xen"\]\) \.solo-facil\{display:none!important\}/.test(html));
const conClaseFacil = [...html.matchAll(/<[a-z]+\b[^>]*class="([^"]*\bfx-[^"]*)"[^>]*>/g)].map((m) => m[0]);
check('y todo lo de la piel nueva lleva solo-facil o vive dentro de algo que lo lleva', /class="fx-marca solo-facil"/.test(html) && /class="nav-fx solo-facil"/.test(html) && /class="fx-top solo-facil"/.test(html) && /class="fx-kpis solo-facil"/.test(html), String(conClaseFacil.length));
check('las dos letras de XENCRM (Bricolage Grotesque para títulos, Figtree para leer) en un solo enlace', /family=Bricolage\+Grotesque:[^"]*&family=Figtree:/.test(html));
check('y tiene sus colores para el tema oscuro', /:root\[data-piel="xen"\]\[data-theme=dark\]\{/.test(bloque));

console.log('— Las piezas de la barra de arriba abren lo que ya había');
const delYo = [...html.matchAll(/data-yo="([a-z-]+)"/g)].map((m) => m[1]!);
check('tu cuenta: tu nombre, el engranaje y salir (los mismos botones de siempre)', delYo.join(',') === 'foot-user,cfg-btn,logout-btn' && delYo.every((id) => html.includes(`id="${id}"`)));
check('«Crear» abre la ficha nueva de siempre y la agenda', /\$\('cli-nuevo'\)\.click\(\)/.test(js) && /go\('calendar'\)/.test(js.slice(js.indexOf("document.querySelectorAll('[data-crear]')"))));
check('el buscador es la búsqueda de Ctrl+K', /\$\('fx-buscar'\)\.onclick = function \(\) \{ abrirPaleta\(\); \}/.test(js));
const delBloqueYo = js.slice(js.indexOf("document.querySelectorAll('[data-yo]')"), js.indexOf("if ($('cfg-btn')) $('cfg-btn').addEventListener"));
check('🪤 los botones de «tu cuenta» paran el clic (si no, lo que abren se cerraba al instante)', delBloqueYo.length > 0 && delBloqueYo.length < 800 && /b\.onclick = function \(e\) \{\s*e\.stopPropagation\(\);/.test(delBloqueYo), String(delBloqueYo.length));
check('«Tomar control» toca el mismo interruptor de Xen/Tú', /\$\('fx-control'\)\.onclick = function \(\) \{ if \(state\.detail\) \$\(state\.detail\.contact\.humanMode \? 'seg-bot' : 'seg-human'\)\.click\(\); \}/.test(js));
// XENCRM: la ficha empieza justo donde acaba el menú. Se compara con el ancho del menú en vez de fijar un número:
// cuando el menú cambió de 256 a 248 px, un número fijo habría dejado una franja de 8 px o tapado el borde.
const anchoMenu = /:root\[data-piel="xen"\] \.app\{grid-template-columns:(\d+)px /.exec(bloque)?.[1];
check('🪤 la ficha como página: un clic en el menú la cierra y sigue hasta donde iba', /document\.elementFromPoint\(e\.clientX, e\.clientY\)/.test(js) && Boolean(anchoMenu) && new RegExp(`dialog\\.perfil\\.ficha\\{position:fixed;inset:64px 0 0 ${anchoMenu}px`).test(bloque), String(anchoMenu));

console.log('— Inicio');
const inicio = funcion('pintarInicio');
check('los cuatro números salen de /today (nada estimado)', ['activas', 'nuevos', 'calientes', 'citasHoy'].every((k) => inicio.includes(`k: '${k}'`)) && /r\[x\.k\] == null \? '—'/.test(inicio));
const resumen = funcion('pintarResumenDelDia');
check('el resumen del día cuenta lo que espera a alguien, sin las citas ni lo ya leído', /\['citas', 'leidas', 'proximas'\]\.indexOf\(s\.tono\) < 0/.test(resumen));
check('y cada cosa lleva a su recuadro', /#today \.panel\[data-tono="/.test(resumen) && /scrollIntoView/.test(resumen));
check('🪤 lo que espera a alguien sigue en Inicio: no se perdió nada de Hoy al vestirlo de Nexora', /if \(facil\) pintarInicio\(t, sections\);/.test(js) && /\$\('today'\)\.hidden = facil && !\$\('today'\)\.childElementCount;/.test(js));

console.log('— El copiloto XEN (Inicio de XENCRM)');
check('la cifra del copiloto es la suma de las de los recuadros, nada estimado', /var total = pend\.reduce\(function \(a, s\) \{ return a \+ s\.n; \}, 0\);/.test(resumen));
check('se pinta con /today entero (pintarInicio se lo pasa)', /pintarResumenDelDia\(sections, t\);/.test(inicio));
// Los recuadros de Hoy y sus colores, en el mismo orden. 🪤 Iban corridos: «Esperan tu respuesta» llevaba el tono de
// los grupos (rojo y gris cambiados) y el copiloto buscaba a quién contestar entre los grupos.
const deHoy = conVoc(js.slice(js.indexOf('function loadToday()'), js.indexOf('var TONOS')));
const titulos = [...deHoy.matchAll(/\{ t: '([^']+)'/g)].map((m) => m[1]!);
const tonosHoy = ((js.match(/var TONOS = \[([^\]]*)\]/)?.[1] ?? '').match(/'([a-z]+)'/g) || []).map((x) => x.slice(1, -1));
const tonoDe: Record<string, string> = { 'Por verificar': 'verificar', 'Te escribieron en un grupo': 'grupos', 'Esperan tu respuesta': 'esperan', 'Pidieron una persona': 'persona', '¿Cómo les fue? (citas que ya pasaron)': 'pasadas', 'Recordar a mano': 'recordar', 'Citas de hoy': 'citas', 'Calientes sin seguimiento (más de 24 h)': 'calientes', 'Próximas citas (3 días)': 'proximas' };
check('🪤 cada recuadro de Hoy lleva SU tono, en el mismo orden (no solo la misma cuenta)', titulos.length === tonosHoy.length && titulos.every((t, i) => (tonoDe[t] ?? (t.startsWith('Sin leer') ? 'leidas' : '?')) === tonosHoy[i]), titulos.map((t, i) => `${t} → ${tonosHoy[i]}`).join(' | '));
// Las acciones, de verdad: con un /today de juguete, cada acción es una fila de un recuadro pendiente, en su orden.
const acciones = new Function('rel', 'nameOf', 'short', 'go', 'openContact', 'followupDraft', `${funcion('accionesDelCopiloto')}; return accionesDelCopiloto;`)(
  () => '5 min', (c: { name?: string; id: string }) => c.name || c.id, (id: string) => id.split('@')[0], () => {}, () => {}, () => 'borrador',
) as (pend: { tono: string; n: number }[], t: Record<string, unknown[]>, ir: (tono: string) => void) => { que: string; tono: string; boton: string; detalle: string }[];
const hoyDeJuguete = {
  unanswered: [{ id: 'a', name: 'Ana', lastMessageAt: 1, recap: 'traje azul' }, { id: 'b', name: 'Beto', lastMessageAt: 1 }],
  handoffs: [{ id: 'c', name: 'Caro' }],
  hot: [{ id: 'd', name: 'Dani', lastMessageAt: 1 }],
  verifications: [{ id: 1, userId: 'e@x', contactName: 'Eva', question: '¿Tienen parqueadero?' }],
  appointments: [{ userId: 'f@x', contactName: 'Fabio', label: '5:00 p. m.' }],
  unread: [{ id: 'g', name: 'Gabi' }],
};
const pendDeJuguete = [{ tono: 'verificar', n: 1 }, { tono: 'esperan', n: 2 }, { tono: 'persona', n: 1 }, { tono: 'calientes', n: 1 }];
const salen = acciones(pendDeJuguete, hoyDeJuguete, () => {});
check('una acción por cada fila pendiente, en el orden de Hoy (el costo del silencio)', salen.map((x) => x.que).join(' | ') === 'Verificar lo que preguntó Eva | Contestar a Ana | Contestar a Beto | Atender a Caro | Retomar a Dani', salen.map((x) => x.que).join(' | '));
check('🪤 nada inventado: lo que dice cada acción sale de su fila (lo que preguntó, de qué habló)', salen[0]!.detalle === '«¿Tienen parqueadero?»' && /traje azul/.test(salen[1]!.detalle) && !/traje azul/.test(salen[2]!.detalle));
check('las citas de hoy y lo ya leído no son acciones: se miran, no se atienden', !salen.some((x) => /Fabio|Gabi/.test(x.que)));
check('cada acción tiene un verbo en su botón', salen.every((x) => /^(Responder|Contestar|Atender|Escribirle|Revisar|Anotar|Recordar)$/.test(x.boton)));
check('sin pendientes, el copiloto dice «Todo al día» y no se inventa trabajo', /'Todo al día'/.test(resumen) && acciones([], hoyDeJuguete, () => {}).length === 0);
check('🪤 sin /today, Inicio lo dice y ofrece reintentar (no se queda en esqueleto)', /if \(!t \|\| t\.error \|\| !Array\.isArray\(t\.unanswered\)\) \{ pintarErrorDeInicio\(t && t\.error\); return; \}/.test(js) && /Reintentar/.test(funcion('pintarErrorDeInicio')) && /\.catch\(function \(e\) \{[\s\S]{0,200}pintarErrorDeInicio\(\);/.test(js));
check('🪤 y lo que no depende de /today se carga igual (la semana, el embudo, la actividad)', ['cargarSerieFacil()', "api('/stats')", 'pintarActividadFacil()'].every((x) => funcion('pintarErrorDeInicio').includes(x)));
check('el violeta es solo de la IA: ninguna de las cuatro cifras lo usa', !/tono: 'violeta'/.test(inicio));
check('la gráfica no trae colores a pelo: los pone la hoja con los tokens (y siguen al tema)', !/#[0-9a-fA-F]{3,6}\b/.test(funcion('dibujarSerieFacil')) && /\.fx-grafica \.fx-stop\{stop-color:var\(--fx-acento\)\}/.test(bloque));
check('y las citas van punteadas además de en su color (no solo el color distingue las dos líneas)', /\.linea-citas\{[^}]*stroke-dasharray/.test(bloque));
check('el embudo pinta cada etapa con el color de su papel, el mismo de Tratos', /data-rol="' \+ esc\(e\.rol/.test(funcion('pintarEtapasFacil')) && ['inicio', 'activo', 'interes', 'cita', 'ganado', 'perdido'].every((r) => bloque.includes(`.fx-barra[data-rol="${r}"] .pista i{`)));
check('mientras carga, cada pieza enseña su esqueleto (nada salta al llegar los datos)', ['fx-resumen', 'fx-kpis', 'fx-serie', 'fx-etapas', 'fx-actividad'].every((id) => html.indexOf(`id="${id}"`) > 0 && html.slice(html.indexOf(`id="${id}"`), html.indexOf(`id="${id}"`) + 600).includes('class="fx-esq')) && /@media \(prefers-reduced-motion:reduce\)\{\.fx-esq\{animation:none\}/.test(bloque));

console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
