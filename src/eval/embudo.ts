// Pruebas del embudo y el filtrado, sin modelo: pnpm test:embudo
//
// El usuario pidió el menú «como Dynamics 365: embudo, filtrado…». Aquí se prueba que el embudo dice la verdad
// (crm/embudo.ts: hasta dónde llegó cada trato y desde dónde se cayó, leído de la historia de etapas; sin historia
// no se inventa), que la cuenta del tablero sale bien (cuántos llegan, qué parte pasa, dónde se quedan), que los
// filtros filtran lo que dicen —y un valor que no se sabe no cumple «desde»—, que el candado deja leerlo, que el
// panel se cierra con Escape y devuelve el foco, y que con 500 tratos no se arrastra.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'xencrm-embudo-')), 'xencrm.db');
process.env.ADMIN_TOKEN = 'token-del-tablero-de-prueba-0123456789';
const { getDb } = await import('../rag/store.js');
const { pasosDelEmbudo, historiaDelEmbudo } = await import('../crm/embudo.js');
const { setStage, setArchived } = await import('../crm/contacts.js');
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

const ETAPAS = [
  { id: 'nuevo', label: 'Nuevo', rol: 'inicio' },
  { id: 'conversando', label: 'Conversando', rol: 'activo' },
  { id: 'interesado', label: 'Interesado', rol: 'interes' },
  { id: 'cita_agendada', label: 'Cita agendada', rol: 'cita' },
  { id: 'vendido', label: 'Vendido', rol: 'ganado' },
  { id: 'perdido', label: 'Perdido', rol: 'perdido' },
];
const T0 = Date.parse('2026-11-01T10:00:00-05:00');
const cambio = (userId: string, minutos: number, from: string, to: string) => ({ userId, ts: T0 + minutos * 60_000, from, to });

console.log('— Hasta dónde llegó cada trato (crm/embudo.ts)');
{
  const pasos = pasosDelEmbudo({
    etapas: ETAPAS,
    contactos: [
      { id: 'a', stage: 'perdido', firstSeen: T0 },
      { id: 'b', stage: 'cita_agendada', firstSeen: T0 },
      { id: 'c', stage: 'perdido', firstSeen: T0 },
      { id: 'd', stage: 'cita_agendada', firstSeen: T0 },
      { id: 'e', stage: 'vendido', firstSeen: T0 },
      { id: 'f', stage: 'conversando', firstSeen: T0 },
    ],
    cambios: [
      cambio('a', 1, 'nuevo', 'conversando'), cambio('a', 2, 'conversando', 'interesado'), cambio('a', 3, 'interesado', 'perdido'),
      // c: sin historia. d: saltó de nuevo a la cita.
      cambio('d', 1, 'nuevo', 'cita_agendada'),
      // e: se ganó, se perdió y se volvió a ganar: cerró la última vez que se ganó.
      cambio('e', 1, 'nuevo', 'vendido'), cambio('e', 5, 'vendido', 'perdido'), cambio('e', 9, 'perdido', 'vendido'),
      // f: pasó por una etapa que ya no existe en el embudo de hoy (se renombró): no cuenta, no rompe.
      cambio('f', 1, 'nuevo', 'etapa_vieja'), cambio('f', 2, 'etapa_vieja', 'conversando'),
    ],
  });
  const de = (id: string) => pasos.find((p) => p.id === id)!;
  check('llegó a la más avanzada que pasó, aunque hoy esté perdido', de('a').alcanzo === 'interesado', JSON.stringify(de('a')));
  check('y se cayó desde la etapa en la que estaba cuando se perdió', de('a').cayoDesde === 'interesado');
  check('cerró cuando lo movieron a perdido (el evento, no la última vez que escribió)', de('a').cerro === T0 + 3 * 60_000);
  check('🪤 sin historia no se inventa: cuenta por su etapa de hoy y se marca', de('b').alcanzo === 'cita_agendada' && de('b').conHistoria === false && de('b').cayoDesde === null);
  check('🪤 perdido y sin historia: no se sabe hasta dónde llegó ni desde dónde se cayó', de('c').alcanzo === null && de('c').cayoDesde === null && !de('c').conHistoria);
  check('quien salta etapas llega a donde saltó', de('d').alcanzo === 'cita_agendada');
  check('ganado, perdido y ganado otra vez: cerró la última vez que se ganó', de('e').cerro === T0 + 9 * 60_000 && de('e').alcanzo === 'vendido');
  check('una etapa que ya no existe no rompe la cuenta', de('f').alcanzo === 'conversando' && de('f').conHistoria);
  check('lo abierto no tiene cierre', de('b').cerro === null && de('f').cerro === null);
}

console.log('— Leído de la base, y por la ruta del tablero');
{
  const db = getDb();
  const alta = (id: string, nombre: string) =>
    db.prepare('INSERT INTO users (id, channel, name, phone, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?)').run(id, 'whatsapp', nombre, null, T0, T0);
  alta('wa:1@s.whatsapp.net', 'Ana');
  alta('wa:2@s.whatsapp.net', 'Bea');
  alta('wa:3@s.whatsapp.net', 'Caro');
  alta('120363@g.us', 'Un grupo');
  setStage('wa:1@s.whatsapp.net', 'interesado');
  setStage('wa:1@s.whatsapp.net', 'perdido', { motivo: 'El precio' });
  setStage('wa:2@s.whatsapp.net', 'cita_agendada');
  setStage('wa:3@s.whatsapp.net', 'vendido');
  setArchived('wa:3@s.whatsapp.net', true);
  const h = historiaDelEmbudo();
  const ana = h.tratos.find((t) => t.id === 'wa:1@s.whatsapp.net');
  check('las etapas van en el orden del negocio, con su rol', h.etapas.map((e) => e.rol).join(',') === 'inicio,activo,interes,cita,ganado,perdido', JSON.stringify(h.etapas));
  check('la historia de verdad: llegó a Interesado y se cayó ahí', ana?.alcanzo === 'interesado' && ana?.cayoDesde === 'interesado' && ana?.conHistoria === true, JSON.stringify(ana));
  check('🪤 los archivados y los grupos no cuentan (un grupo no es un trato)', !h.tratos.some((t) => t.id === 'wa:3@s.whatsapp.net' || t.id.endsWith('@g.us')), h.tratos.map((t) => t.id).join(','));
  const app = new Hono();
  mountAdmin(app as never);
  const r = await app.request('/admin/api/embudo', { headers: { 'x-admin-token': process.env.ADMIN_TOKEN! } });
  const j = (await r.json()) as { tratos: { id: string }[]; etapas: unknown[] };
  check('GET /admin/api/embudo da lo mismo', r.status === 200 && j.tratos.length === h.tratos.length && j.etapas.length === 6);
  const sin = await app.request('/admin/api/embudo');
  check('sin token, no', sin.status === 401);
  check('con el candado se lee (es del que vende, como Ventas)', frenoDelCandado('embudo', 'GET', 'asesor', 'facil') === null && frenoDelCandado('embudo', 'GET', 'admin', 'facil') === null);
  check('y no hay nada que cambiar por ahí', frenoDelCandado('embudo', 'POST', 'asesor', 'facil') !== null);
}

console.log('— La cuenta del embudo en el tablero (calcularEmbudo)');
{
  // R: las reglas del tablero (src/reglas.ts); aquí, sin red, el valor de fábrica, como en el tablero antes de leerlas.
  const calcularEmbudo = new Function(`var R = function (id, d) { return d; }; ${funcion('calcularEmbudo')}; return calcularEmbudo;`)() as (l: unknown[], p: unknown, e: unknown[]) => {
    total: number; tramos: { id: string; llegaron: number; ahora: number; valor: number; sinPrecio: number; perdidos: number; pasan: number | null }[]; peor: number | null;
    perdidos: { total: number; sinSaber: number; motivos: { motivo: string; n: number }[] }; sinHistoria: number; abiertos: number; valorAbierto: number; sinPrecioAbierto: number; ganados: number;
  };
  const c = (id: string, stage: string, valor = 0, motivo = '') => ({ id, stage, valor, data: motivo ? { motivo_perdida: motivo } : {} });
  const p = (alcanzo: string | null, cayoDesde: string | null = null, conHistoria = true) => ({ alcanzo, cayoDesde, conHistoria });
  const lista = [c('1', 'nuevo'), c('2', 'conversando'), c('3', 'interesado', 500), c('4', 'cita_agendada', 900), c('5', 'vendido', 600), c('6', 'perdido', 0, 'El precio'), c('7', 'perdido'), c('8', 'interesado')];
  const pasos = { 1: p('nuevo'), 2: p('conversando'), 3: p('interesado'), 4: p('cita_agendada'), 5: p('vendido'), 6: p('interesado', 'interesado'), 7: p(null, null, false), 8: p('interesado', null, false) };
  const m = calcularEmbudo(lista, pasos, ETAPAS);
  const ll = m.tramos.map((t) => t.llegaron);
  check('cuántos llegaron a cada etapa (o más allá), sin perdido en el camino', ll.join(',') === '8,6,5,2,1' && m.tramos.length === 5, ll.join(','));
  check('un embudo nunca se ensancha: cada etapa tiene a lo sumo los de la anterior', ll.every((n, i) => i === 0 || n <= ll[i - 1]!));
  check('qué parte pasa a la siguiente', m.tramos[2]!.pasan === 0.4 && m.tramos[3]!.pasan === 0.5 && m.tramos[4]!.pasan === null, String(m.tramos.map((t) => t.pasan)));
  check('dónde se quedan más: el paso más bajo con al menos tres que llegaron', m.peor === 2, String(m.peor));
  check('los perdidos, por la etapa desde la que se cayeron; sin historia, «sin saber dónde»', m.tramos[2]!.perdidos === 1 && m.perdidos.total === 2 && m.perdidos.sinSaber === 1);
  check('por qué, de lo que dijo el equipo', m.perdidos.motivos.length === 1 && m.perdidos.motivos[0]!.motivo === 'El precio');
  check('hoy en cada etapa, y cuánto vale lo que se sabe', m.tramos[2]!.ahora === 2 && m.tramos[2]!.valor === 500 && m.tramos[2]!.sinPrecio === 1);
  check('abiertos, ganados y el valor en juego (lo ganado no está en juego)', m.abiertos === 5 && m.ganados === 1 && m.valorAbierto === 1400 && m.sinPrecioAbierto === 3);
  check('se dice cuántos no tienen historia', m.sinHistoria === 2);
  const poco = calcularEmbudo([c('1', 'nuevo'), c('2', 'conversando')], { 1: p('nuevo'), 2: p('conversando') }, ETAPAS);
  check('🪤 con menos de tres no se señala «aquí se quedan más»: un solo caso no es un patrón', poco.peor === null);
  const xeValor = new Function('plataCorta', `${funcion('xeValor')}; return xeValor;`)((n: number) => `$${n}`) as (v: number, n: number, s: number) => string;
  check('🪤 nunca «$0»: sin precios lo dice, y sin nadie es «—»', xeValor(0, 3, 3) === 'Sin precios' && xeValor(0, 0, 0) === '—' && xeValor(500, 2, 1) === '$500 · 1 sin precio');
  // 500 tratos: el tablero filtra y cuenta en el navegador, en cada clic.
  const muchos = Array.from({ length: 500 }, (_, i) => c(String(i), ETAPAS[i % 6]!.id, i % 3 ? 1000 * i : 0));
  const muchosPasos = Object.fromEntries(muchos.map((x) => [x.id, p(x.stage === 'perdido' ? 'interesado' : x.stage, x.stage === 'perdido' ? 'interesado' : null)]));
  const t = performance.now();
  for (let i = 0; i < 20; i++) calcularEmbudo(muchos, muchosPasos, ETAPAS);
  const ms = (performance.now() - t) / 20;
  check(`con 500 tratos se cuenta en un instante (${ms.toFixed(2)} ms)`, ms < 25);
}

console.log('— Los filtros (xfCumple)');
{
  const xfCumple = new Function(`${funcion('xfCumple')}; return xfCumple;`)() as (c: Record<string, unknown>, cond: Record<string, unknown>, ctx?: Record<string, unknown>) => boolean;
  const ahora = Date.parse('2026-11-11T15:00:00-05:00');
  const ctx = { ahora, facil: false };
  const c = { stage: 'interesado', responsable: 'Laura Gómez', channel: 'whatsapp', temperature: 'caliente', valor: 500000, lastMessageAt: ahora - 3600_000, data: { servicio: 'Alquiler Premium', ocasion: 'boda' } };
  check('sin condiciones, todo pasa', xfCumple(c, {}, ctx));
  check('etapa: una de las marcadas', xfCumple(c, { etapas: ['interesado', 'cita_agendada'] }, ctx) && !xfCumple(c, { etapas: ['nuevo'] }, ctx));
  check('asignado: sin importar mayúsculas ni tildes', xfCumple(c, { asignado: 'laura gomez' }, ctx) && !xfCumple(c, { asignado: 'Bryan' }, ctx));
  check('«sin asignar» es que no hay nadie (y espacios no son alguien)', xfCumple({ ...c, responsable: '  ' }, { asignado: '__nadie' }, ctx) && !xfCumple(c, { asignado: '__nadie' }, ctx));
  check('canal', xfCumple(c, { canal: 'whatsapp' }, ctx) && !xfCumple(c, { canal: 'web' }, ctx));
  check('temperatura en el completo', xfCumple(c, { temp: 'caliente' }, ctx) && !xfCumple(c, { temp: 'frio' }, ctx));
  check('🪤 en el modo fácil la temperatura no cuenta (va con el puntaje, que no se ve)', xfCumple(c, { temp: 'frio' }, { ...ctx, facil: true }));
  check('valor desde y hasta', xfCumple(c, { vmin: 400000, vmax: 600000 }, ctx) && !xfCumple(c, { vmin: 600000 }, ctx));
  check('🪤 un valor que no se sabe no cumple «desde» ni «hasta»: no se sabe si cumple', !xfCumple({ ...c, valor: 0 }, { vmax: 1000000 }, ctx) && !xfCumple({ ...c, valor: 0 }, { vmin: 1 }, ctx));
  check('última actividad: hoy, 7 días y hace más de 30', xfCumple(c, { act: 'hoy' }, ctx) && xfCumple(c, { act: '7' }, ctx) && !xfCumple(c, { act: 'mas30' }, ctx) && xfCumple({ ...c, lastMessageAt: ahora - 40 * 86400_000 }, { act: 'mas30' }, ctx));
  check('un dato captado: que lo tenga, y que diga algo (sin importar tildes)', xfCumple(c, { datoK: 'ocasion' }, ctx) && xfCumple(c, { datoK: 'servicio', datoV: 'premiúm' }, ctx) && !xfCumple(c, { datoK: 'servicio', datoV: 'medida' }, ctx) && !xfCumple(c, { datoK: 'ciudad' }, ctx));
  check('las condiciones se suman', !xfCumple(c, { etapas: ['interesado'], canal: 'web' }, ctx));
}

console.log('— Las vistas y la barra');
check('Contactos: los grupos son las vistas del sistema, con Sin asignar y «Con» lo que agenda el negocio (Con cita, Con demo)', /\{ g: 'sinasignar', t: 'Sin asignar', es: xfSinAsignar \}/.test(js) && /\{ g: 'concita', get t\(\) \{ return 'Con ' \+ VOC\.cita; \}, es: xfConCita \}/.test(js));
check('🪤 un solo estado: en Contactos la vista sigue siendo cli.grupo, y los filtros van encima', /var grupos = xfGruposClientes\(\);/.test(funcion('renderClientes')) && /g\.es\(c\) && pasa\(c\)/.test(funcion('renderClientes')) && /return p === 'clientes' \? cli\.grupo : xfE\(p\)\.vista;/.test(js));
check('los números de las vistas cuentan con los filtros puestos', /cli\.lista\.filter\(function \(c\) \{ return x\.es\(c\) && pasa\(c\); \}\)\.length/.test(funcion('renderClientes')));
const vistasTratos = funcion('xfVistasSistema');
check('Tratos: todos, abiertos, míos, sin asignar, calientes, con cita, ganados y perdidos este mes', ['Todos los tratos', 'Tratos abiertos', 'Mis tratos', 'Sin asignar', '🔥 Calientes', 'Ganados este mes', 'Perdidos este mes'].every((t) => vistasTratos.includes(`'${t}'`)) && /get t\(\) \{ return 'Con ' \+ VOC\.cita; \}/.test(vistasTratos));
check('🪤 «este mes» sale de cuándo se cerró (la historia), no de la última vez que escribió', /p\.cerro/.test(funcion('xfEsteMes')) && /historia: true/.test(vistasTratos));
check('🪤 y mientras no llega la historia, esas vistas van sin número («0» diría que no hubo ninguno)', /v\.historia && !XF_HIST\.pasos \? ''/.test(funcion('xfPintarVistas')));
check('las vistas guardadas son de cada quien, en su navegador, con su nombre', /LLAVE\('vistas\.' \+ p\)/.test(js) && /l\.slice\(0, 20\)/.test(js));
check('🪤 guardar sin nombre o con uno repetido se dice junto al campo, sin borrar lo escrito', /Ponle un nombre para encontrarla después/.test(js) && /Ya tienes una vista con ese nombre/.test(js));
check('borrar una vista se deshace tocando el aviso', /Toca aquí para deshacer/.test(funcion('xfEnganchar')));
const engancha = funcion('xfEnganchar');
check('Escape cierra el panel y devuelve el foco al botón Filtros', /ev\.key !== 'Escape'/.test(engancha) && /cerrarPanel\(true\)/.test(engancha) && /if \(devolver\) btn\.focus\(\)/.test(engancha));
check('el panel dice si está abierto (aria-expanded) y qué controla (aria-controls)', /aria-expanded="false" aria-controls="xf-' \+ p \+ '-panel"/.test(funcion('xfPintarBarra')));
check('cada píldora se quita con su × y la × dice qué quita', /aria-label="Quitar el filtro «' \+ esc\(c\.t\) \+ '»"/.test(funcion('xfPintarBarra')));
check('🪤 la temperatura del panel es del completo (solo-completo), y en el fácil no se dice como puesta', /class="xf-campo solo-completo"><label for="' \+ id\('temp'\)/.test(funcion('xfPintarPanel')) && /if \(c\.temp && !esFacil\(\)\)/.test(funcion('xfCondiciones')));
check('🪤 una cifra mal escrita en el valor se dice junto al campo y no se aplica', /setCustomValidity\('Escribe una cifra \(solo números\)\.'\)/.test(funcion('xfPintarPanel')));
check('Tratos: Tablero | Lista, y la lista se ordena por columna', /data-modo="tablero"/.test(funcion('xfPintarBarra')) && /data-modo="lista"/.test(funcion('xfPintarBarra')) && /data-xf-orden/.test(funcion('xfPintarListaTratos')));
check('🪤 filtrar no vuelve a pedir nada: Tratos se pinta con lo que ya llegó', /state\.pipeTodos = todos;\s*pintarPipeline\(focusId\);/.test(funcion('loadPipeline')) && /state\.pipeTodos\) pintarPipeline\(\)/.test(funcion('xfRepintar')));
check('tocar una etapa del embudo abre Tratos con esa etapa de filtro', /e\.cond = \{ etapas: etapas\.slice\(\) \};[\s\S]*go\('pipeline'\)/.test(funcion('xfIrATratos')));
check('la pantalla Embudo se carga sola al abrirse (alAbrir)', /alAbrir\('embudo', cargarEmbudo\);/.test(js));
const pinta = funcion('pintarEmbudo');
check('los cinco estados del embudo: cargando con su forma, error con salida, sin tratos, vacío por filtros o periodo, y con datos', /aria-busy="true"/.test(pinta) && /No se pudo armar el embudo/.test(pinta) && /Volver a intentar/.test(pinta) && /Todavía no hay tratos/.test(pinta) && /Ver desde siempre/.test(pinta) && /Quitar los filtros/.test(pinta));
check('🪤 lo que no tiene historia se dice en la pantalla, no se reparte', /no tienen' : ' tratos no tienen'\) \+ ' historia de etapas|no tiene' : ' tratos no tienen'\) \+ ' historia de etapas/.test(pinta) && /Sin saber dónde/.test(pinta));
check('🪤 el tope de 2.000 se dice arriba', /Se cuentan los 2\.000 tratos con actividad más reciente/.test(pinta));
check('lo que la barra engancha existe antes del <script>', ['xf-pipeline', 'xf-pipeline-lista', 'xf-clientes', 'xf-embudo', 'xe-cuerpo'].every((id) => html.slice(0, html.indexOf('<script src="admin.js')).includes(`id="${id}"`)));
const css = html.slice(html.indexOf('/* ---------- XEN · Embudo y filtrado'), html.indexOf('/* (fin de XEN · Embudo y filtrado) */'));
check('los colores de cada etapa son los de su rol (los mismos de Tratos), con tokens', /\.xe-tramo\[data-rol="interes"\]\{--xe-c:var\(--fx-ambar\)\}/.test(css) && /\.xe-tramo\[data-rol="cita"\]\{--xe-c:var\(--fx-indigo\)\}/.test(css) && !/#[0-9a-f]{3,6}\b/i.test(css.replace(/\/\*[\s\S]*?\*\//g, '')));
check('en el celular el panel se abre a lo ancho y las vistas se deslizan', /@media \(max-width:640px\)\{[\s\S]*\.xf-panel,:root\[data-piel="xen"\] \.xf-guardar\{position:fixed/.test(css) && /\.xf-vistas\{flex-wrap:nowrap;overflow-x:auto/.test(css));
check('con movimiento reducido, los esqueletos quietos', /prefers-reduced-motion:reduce\)\{[^}]*\.xe-esq-cifras i/.test(css));

process.exit(fail ? 1 : 0);
