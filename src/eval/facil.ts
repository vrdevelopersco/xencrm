// Pruebas del modo fácil con el aspecto de Nexora, sin modelo: pnpm test:facil
//
// DUNOR mandó Nexora como muestra de cómo quiere ver aiva («que se vea igual, pero en nuestro producto»). El modo
// fácil tomó su menú, su barra de arriba y su Inicio, con los datos y las acciones de aiva. Aquí se prueba que el
// menú es el de la muestra y que cada puerta abre (también con el candado), que la gráfica dice la verdad, que lo
// que se muda vuelve a su sitio y que el modo completo no cambió: todo lo nuevo vive detrás del modo fácil.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'aiva-facil-')), 'aiva.db');
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
const menu = js.slice(js.indexOf('var MENU_FACIL = ['), js.indexOf('(function armarMenuFacil()'));
const grupos = [...menu.matchAll(/grupo: '([^']+)', items: \[([^\]]*)\]/g)].map((g) => ({ grupo: g[1], items: [...g[2]!.matchAll(/view: '([a-z]+)', lbl: '([^']+)'/g)].map((m) => [m[1], m[2]]) }));
check('dos grupos, como Nexora: Principal y CRM', grupos.map((g) => g.grupo).join(',') === 'Principal,CRM', JSON.stringify(grupos));
check('Principal: Inicio, Bandeja omnicanal, Analítica (el vocabulario de un CRM de mensajería)', grupos[0]?.items.map((x) => x[1]).join(',') === 'Inicio,Bandeja omnicanal,Analítica');
check('CRM: Contactos, Tratos, Citas, Ventas, Seguimientos', grupos[1]?.items.map((x) => x[1]).join(',') === 'Contactos,Tratos,Citas,Ventas,Seguimientos');
const vistas = grupos.flatMap((g) => g.items.map((x) => x[0]!));
check('🪤 cada puerta lleva a una pantalla que existe (ninguna nueva: son las de siempre)', vistas.every((v) => html.includes(`id="view-${v}"`)), vistas.join(','));
const cerradas = /var VISTAS_DE_QUIEN_ADMINISTRA = \{([^}]*)\}/.exec(js)?.[1] ?? '';
const soloCompleto = /var SOLO_COMPLETO_VISTAS = \{([^}]*)\}/.exec(js)?.[1] ?? '';
check('🪤 ninguna es de las que cierra el candado: bryan no se topa con «Eso lo maneja quien administra aiva»', vistas.every((v) => !new RegExp(`\\b${v}: 1`).test(cerradas)), cerradas);
check('ni de las que el modo fácil esconde', vistas.every((v) => !new RegExp(`\\b${v}: 1`).test(soloCompleto)), soloCompleto);
check('la configuración sigue abajo, en el engranaje de siempre (con su candado)', /id="cfg-btn"/.test(html) && /CFG_CLIENTE\.forEach\(function \(d\) \{ d\.candado = true; \}\)/.test(js));

console.log('— Y cada puerta abre, también con el candado');
// Lo que lee cada pantalla del menú. Si una se queda sin datos con el candado, se ve vacía y nadie sabe por qué.
const lee: Record<string, string[]> = {
  today: ['today', 'series', 'stats', 'notifications', 'contacts'],
  analysis: ['stats', 'series', 'tiempos', 'origenes'],
  inbox: ['contacts', 'contacts/web%3A1', 'contacts/web%3A1/duplicates'],
  clientes: ['contacts'],
  calendar: ['appointments', 'busy', 'calendar'],
  pipeline: ['contacts', 'stats'],
  ventas: ['ventas'],
  seguimientos: ['seguimientos'],
};
for (const v of vistas) {
  for (const rol of ['admin', 'asesor']) {
    const frenadas = (lee[v] ?? []).filter((r) => frenoDelCandado(r, 'GET', rol, 'facil') !== null);
    check(`${v} (${rol}, modo fácil): lee todo lo que pinta`, Boolean(lee[v]) && !frenadas.length, frenadas.join(', ') || 'sin lista de lo que lee');
  }
}
const app = new Hono();
mountAdmin(app as never);
const T = { 'x-admin-token': process.env.ADMIN_TOKEN!, 'content-type': 'application/json' };
await app.request('/admin/api/tablero/modo', { method: 'PUT', headers: { ...T, 'x-aiva-rol': 'super' }, body: JSON.stringify({ modo: 'facil' }) });
for (const ruta of ['/ventas', '/seguimientos', '/series?dias=7', '/tiempos', '/origenes']) {
  check(`el servidor la abre de verdad: ${ruta} con el candado`, (await app.request(`/admin/api${ruta}`, { headers: { ...T, 'x-aiva-rol': 'asesor' } })).status === 200);
}
check('🪤 y lo que cuesta aiva sigue cerrado', (await app.request('/admin/api/usage', { headers: { ...T, 'x-aiva-rol': 'asesor' } })).status === 403);

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
    if (cab.startsWith('@media') || cab.startsWith('@supports')) recorrer(css.slice(abre + 1, j - 1));
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
check('«Tomar control» toca el mismo interruptor de Aiva/Tú', /\$\('fx-control'\)\.onclick = function \(\) \{ if \(state\.detail\) \$\(state\.detail\.contact\.humanMode \? 'seg-bot' : 'seg-human'\)\.click\(\); \}/.test(js));
check('🪤 la ficha como página: un clic en el menú la cierra y sigue hasta donde iba', /document\.elementFromPoint\(e\.clientX, e\.clientY\)/.test(js) && /dialog\.perfil\.ficha\{position:fixed;inset:64px 0 0 256px/.test(bloque));

console.log('— Inicio');
const inicio = funcion('pintarInicio');
check('los cuatro números salen de /today (nada estimado)', ['activas', 'nuevos', 'calientes', 'citasHoy'].every((k) => inicio.includes(`k: '${k}'`)) && /r\[x\.k\] == null \? '—'/.test(inicio));
const resumen = funcion('pintarResumenDelDia');
check('el resumen del día cuenta lo que espera a alguien, sin las citas ni lo ya leído', /\['citas', 'leidas', 'proximas'\]\.indexOf\(s\.tono\) < 0/.test(resumen));
check('y cada cosa lleva a su recuadro', /#today \.panel\[data-tono="/.test(resumen) && /scrollIntoView/.test(resumen));
check('🪤 lo que espera a alguien sigue en Inicio: no se perdió nada de Hoy al vestirlo de Nexora', /if \(facil\) pintarInicio\(t, sections\);/.test(js) && /\$\('today'\)\.hidden = facil && !\$\('today'\)\.childElementCount;/.test(js));

console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
