// Pruebas de Contactos, la ficha y Tratos con la piel de XENCRM, sin modelo ni servidor: pnpm test:contactos
//
// XENCRM rehízo estas pantallas con SendPulse de muestra: cada contacto es una fila-tarjeta con su último trato y sus
// datos como etiquetas, la ficha tiene la cabecera de un trato (etapa y asignado que se cambian ahí mismo) y Tratos
// pinta cada columna con el color de su etapa. Aquí se prueba que eso dice la verdad, que no se cae con datos
// raros, que cada estado (cargando, error, vacío, parcial) dice qué pasa y qué hacer, y que nada se sale de la piel.
import { readFileSync } from 'node:fs';

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};
const js = readFileSync(new URL('../../public/admin.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../../public/admin.html', import.meta.url), 'utf8');
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
const bloque = html.slice(html.indexOf('/* ===== XENCRM: la piel de todos'), html.indexOf('/* ===== fin de la piel de XENCRM ===== */'));

// Las funciones nuevas, sueltas, con lo mínimo de alrededor.
type Piezas = {
  tonoAvatar(k: string): string;
  avatarHtml(n: string, k?: string, extra?: string): string;
  datosHtml(c: object): string;
  datosCapturados(c: object): string[];
  canalHtml(ch: string): string;
};
const piezas = new Function(
  ['esc', 'inicialesDe', 'etiquetaDato', 'channelIcon', 'canalSolo', 'tonoAvatar', 'avatarHtml', 'datosCapturados', 'datosHtml', 'canalHtml'].map(funcion).join('\n') +
    '\nvar TILDES = { ocasion: "ocasión" };\nvar DE_CONTACTO = { correo: 1, whatsapp: 1, instagram: 1, facebook: 1, contacto_por: 1 };' +
    '\nreturn { tonoAvatar: tonoAvatar, avatarHtml: avatarHtml, datosHtml: datosHtml, datosCapturados: datosCapturados, canalHtml: canalHtml };',
)() as Piezas;

console.log('— El avatar: un color estable por persona, que no dice nada');
const nombres = Array.from({ length: 60 }, (_, i) => `wa:57300${1000000 + i * 7919}@s.whatsapp.net`);
const tonos = nombres.map((n) => piezas.tonoAvatar(n));
check('el mismo contacto, el mismo color (sale de su id, no del orden de la lista)', nombres.every((n, i) => piezas.tonoAvatar(n) === tonos[i]));
check('siempre uno de los seis tonos de avatar', tonos.every((t) => /^a[1-6]$/.test(t)), tonos.join(','));
check('y se reparten: con sesenta personas salen los seis', new Set(tonos).size === 6, [...new Set(tonos)].join(','));
check('🪤 un nombre con HTML no se cuela', !piezas.avatarHtml('<img src=x onerror=alert(1)>').includes('<img'));
check('el avatar es decorativo para un lector de pantalla (el nombre ya está al lado)', /aria-hidden="true"/.test(piezas.avatarHtml('Ana Ruiz')));
// Los seis pares se miden aquí, en claro y en oscuro: si alguien toca un tono, la prueba dice si se dejó de leer.
const lum = (h: string) => { const c = [0, 2, 4].map((i) => parseInt(h.slice(1 + i, 3 + i), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!; };
const contraste = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const claro = /:root\[data-piel="xen"\]\{(--fx-av-1-s[^}]*)\}/.exec(bloque)?.[1] ?? '';
const oscuro = /:root\[data-piel="xen"\]\[data-theme=dark\]\{(--fx-av-1-s[^}]*)\}/.exec(bloque)?.[1] ?? '';
const pares = (decl: string) => [1, 2, 3, 4, 5, 6].map((n) => [new RegExp(`--fx-av-${n}-s:(#[0-9a-f]{6})`).exec(decl)?.[1], new RegExp(`--fx-av-${n}-t:(#[0-9a-f]{6})`).exec(decl)?.[1]]);
const medidas = [...pares(claro), ...pares(oscuro)].map(([s, t]) => (s && t ? contraste(t, s) : 0));
check('los seis tonos, en claro y en oscuro, se leen (≥ 4.5:1)', medidas.length === 12 && medidas.every((m) => m >= 4.5), medidas.map((m) => m.toFixed(2)).join(' '));
check('🪤 y no son los colores de dato (un avatar verde no puede leerse como «vendido»)', !/--fx-av-\d-s:var\(--fx-(verde|rojo|ambar|indigo|cielo)/.test(bloque));

console.log('— Los datos como etiquetas');
const c = { tags: ['vip'], data: { servicio: 'alquiler premium', ocasion: 'boda (padrino)', fecha_evento: '18 de octubre', correo: 'a@b.co', valor: 900000, interes: 'alto', _amano: { servicio: 1 } } };
const tags = piezas.datosHtml(c);
check('primero las etiquetas del equipo, luego lo captado', tags.indexOf('vip') < tags.indexOf('alquiler premium'), tags);
check('a lo sumo dos, y «+n» con el resto', (tags.match(/class="fx-ct-tag a\d"/g) ?? []).length === 2 && />\+2</.test(tags), tags);
check('el «+n» le dice a un lector de pantalla cuáles son', /<span class="sr-only"> más: Ocasión: boda \(padrino\), Fecha evento: 18 de octubre<\/span>/.test(tags), tags);
check('🪤 nada interno ni de contacto se cuela como etiqueta (valor, interés, correo, lo marcado a mano)', !/900000|alto|a@b\.co|_amano/.test(tags), tags);
check('el color va por el campo: «servicio» es del mismo tono en todas las filas', piezas.datosHtml({ data: { servicio: 'x' } }).includes(`fx-ct-tag ${piezas.tonoAvatar('servicio')}`));
check('sin datos, «—» (no un hueco)', piezas.datosHtml({ data: {} }) === '<span class="fx-ct-sin">—</span>');
check('🪤 lo que escribió alguien no se cuela como HTML', !piezas.datosHtml({ data: { servicio: '<b onclick=x>' } }).includes('<b '));
check('la ficha y la tabla usan el mismo filtro de lo captado', /var capturados = datosCapturados\(c\);/.test(funcion('pintarPerfil')) && /datosCapturados\(c\)/.test(funcion('datosHtml')));
check('el canal se dice en palabras, sin el emoji que cada sistema pinta distinto', piezas.canalHtml('whatsapp').includes('>WhatsApp<') && !piezas.canalHtml('whatsapp').includes('🟢'));

console.log('— Contactos: los estados que no son «hay datos»');
const render = funcion('renderClientes');
const estado = funcion('estadoClientes');
const carga = funcion('loadClientes');
check('mientras carga se ve la forma de la tabla (esqueleto), no «nadie por aquí»', /cli\.cargando \? estadoClientes\('cargando'\)/.test(render) && /aria-busy="true"/.test(estado));
check('🪤 y los grupos van sin número: «0» diría que no hay nadie', /var sinCuenta = \(cli\.cargando \|\| cli\.error\) && !cli\.lista\.length;/.test(render) && /var n = sinCuenta \? '' :/.test(render));
check('si falla, lo dice y deja volver a intentar', /error: \['alerta', 'No se pudieron cargar los contactos'/.test(estado) && /if \(que === 'reintentar'\) loadClientes\(\);/.test(funcion('enganchaEstadoClientes')));
check('🪤 una recarga que falla no borra la lista que ya se veía', /if \(cli\.lista\.length\) \{ toast\('No se pudo actualizar la lista: '/.test(carga));
check('🪤 y una respuesta rara no revienta la tabla (antes: list.filter de un objeto)', /if \(!Array\.isArray\(list\)\)/.test(carga));
check('sin nadie todavía: cómo llegan y un botón para agregar', /nadie: \['contacto', 'Todavía no hay contactos'/.test(estado) && /else if \(que === 'agregar'\) \$\('cli-nuevo'\)\.click\(\);/.test(funcion('enganchaEstadoClientes')));
check('una búsqueda sin nadie dice qué se busca y se borra de un clic', /busqueda: \['buscar', 'Nadie coincide con «' \+ cli\.q/.test(estado) && /\$\('cli-q'\)\.value = ''; cli\.q = ''; loadClientes\(\);/.test(funcion('enganchaEstadoClientes')));
check('un grupo vacío lleva a ver todos', /grupo: \['embudo'/.test(estado) && /cli\.grupo = 'todos'; renderClientes\(\);/.test(funcion('enganchaEstadoClientes')));
check('🪤 la lista llena (el tope de 500) se avisa ARRIBA, no al pie después de 500 filas', /var parcial = cli\.lista\.length >= 500;/.test(render) && /limit=500/.test(carga) && render.indexOf("(parcial ? '<div class=\"cli-resumen fx-ct-parcial\"") < render.indexOf("'<table class=\"cli-tabla\">"));

console.log('— Contactos: cada fila, una tarjeta');
check('columnas de un CRM de mensajería: contacto, último trato, datos, asignado, valor, última actividad (Datos se va por debajo de 1600 px, como en Dynamics)', /th\('nombre', 'Contacto'\)[\s\S]*ordBtn\('paso', 'Último trato'\)[\s\S]*<th class="fx-ct-datos">Datos<\/th><th>Asignado a<\/th>' \+ th\('valor', 'Valor', 'num'\) \+ th\('vez', 'Última actividad', 'num'\)/.test(render));
check('🪤 el puntaje nunca solo, y solo en el completo: «89 · caliente» dentro del último trato', /'<span class="solo-completo">' \+ scoreChip\(c\) \+ '<\/span>'/.test(render) && /ordBtn\('puntaje', '· puntaje', 'solo-completo fx-ct-ord2'\)/.test(render));
check('«La lleva» va debajo de «Asignado a», solo en el completo', /'<div class="dato solo-completo">' \+ esc\(\(c\.humanMode \? 'La lleva ' : 'Responde '\) \+ l\.nombre\)/.test(render));
check('sin asignar se dice así (no «—»)', /'<span class="fx-ct-sin">Sin asignar<\/span>'/.test(render));
const engancha = funcion('enganchaClientes');
check('la fila entera abre la ficha, salvo lo que ya es un botón o un enlace', /tr\.onclick = function \(e\) \{ if \(e\.target\.closest\('button, a, select, input'\)\) return; abrirPerfil\(tr\.dataset\.id, cli\.ids\); \};/.test(engancha));
check('el próximo paso abre el chat, como el trato en SendPulse', /data-chat="' \+ esc\(c\.id\)/.test(render) && /go\('inbox'\); openContact\(b\.dataset\.chat\);/.test(engancha));
check('con el teclado se llega por el nombre (es el botón), y la fila marca el foco', /\.cli-tabla tbody tr:focus-within td\{border-color:var\(--fx-acento\)\}/.test(bloque));
check('las acciones van bajo el título, la principal primero, y se llaman como en SendPulse', /id="cli-nuevo"><i class="ic" data-ic="mas"><\/i>Agregar contacto</.test(html) && /#view-clientes>\.topbar #cli-nuevo\{order:1\}/.test(bloque));
check('🪤 exportar sigue siendo del completo', /class="btn sm solo-completo" id="cli-csv"/.test(html));
check('🪤 un nombre de setenta letras no se come la tabla', /\.fx-ct-nom\{max-width:300px\}/.test(bloque) && /\.cli-tabla \.quien\{[^}]*text-overflow:ellipsis/.test(bloque));
// En el celular: rótulos de cada dato, salvo el del contacto, y ese «salvo» va DESPUÉS de la regla general.
const movil = bloque.slice(bloque.indexOf('@media (max-width:760px){', bloque.indexOf('XEN · Contactos, ficha y tratos')));
check('🪤 en el celular el rótulo «Contacto» se quita después de la regla que los pone (gana la última)', movil.indexOf('td[data-rot]::before{display:block') > -1 && movil.indexOf('td[data-rot]::before{display:block') < movil.indexOf('td.fx-ct-quien::before{display:none}'));
check('y los grupos se deslizan en una fila en vez de partirse en tres renglones', /#cli-filtros\{flex-wrap:nowrap;overflow-x:auto/.test(movil));

console.log('— La ficha: la cabecera de un trato');
const perfil = funcion('pintarPerfil');
check('etapa y asignado se cambian en la cabecera', /\$\('pf-ctl'\)\.innerHTML =/.test(perfil) && /<select id="pf-etapa"/.test(perfil) && /responsableHtml\(c, 'pf-resp'\)/.test(perfil));
check('🪤 un solo control para cada cosa: la etapa no se repite abajo', (js.match(/id="pf-etapa"/g) ?? []).length === 1 && !/fila\('Etapa'/.test(perfil));
check('la etapa lleva su color Y su nombre (punto y texto)', /'<label class="fx-ct-etapa stage-' \+ esc\(r\) \+ '"><span class="sr-only">Etapa<\/span><i class="punto"/.test(perfil));
check('el lápiz abre «Corregir datos» y pone el cursor en el nombre', /<button type="button" class="fx-ct-lapiz" id="pf-editar" aria-label="Corregir datos"/.test(html) && /det\.open = true;[\s\S]*\$\('pf-f-nombre'\)\.focus/.test(perfil));
check('🪤 lo que la ficha engancha existe antes del <script>', ['pf-editar', 'pf-ctl'].every((id) => html.slice(0, html.indexOf('<script src="admin.js')).includes(`id="${id}"`)));
check('«Abrir chat» es la acción principal', /<button class="btn sm primary" id="pf-chat"><i class="ic" data-ic="burbuja"><\/i>Abrir chat<\/button>/.test(html));
check('«Lo que busca» va con el violeta de la IA (lo resumió el análisis, no lo escribió nadie)', /\.fx-ct-busca\{[^}]*var\(--fx-ia-borde\)[^}]*var\(--fx-ia-s\)/.test(bloque));
check('el vocabulario: Sobre el contacto, Origen, Agregado el, Última actividad', ['Sobre el contacto', "fila('Origen'", "fila('Agregado el'", "fila('Última actividad'"].every((x) => perfil.includes(x)));
check('🪤 lo de solo-completo sigue escondido en el fácil (puntaje, la lleva, origen, agregado, volvió)', ["fila('Puntaje'", "fila('La lleva'", "fila('Origen'", "fila('Agregado el'", "fila('Volvió'"].every((x) => new RegExp(x.replace(/[()]/g, '\\$&') + "[^\\n]*'solo-completo'\\)").test(perfil)));
const anchoMenu = /:root\[data-piel="xen"\] \.app\{grid-template-columns:(\d+)px /.exec(bloque)?.[1];
check('la ficha empieza donde acaba el menú', Boolean(anchoMenu) && bloque.includes(`dialog.perfil.ficha{position:fixed;inset:64px 0 0 ${anchoMenu}px`), String(anchoMenu));

console.log('— Tratos y Citas');
check('cada columna con el color de su etapa, por su papel (no por su nombre)', ['activo', 'interes', 'cita', 'ganado', 'perdido'].every((r) => new RegExp(`\\.col\\[data-rol=${r}\\]\\{--tone:var\\(--fx-`).test(bloque)));
check('la etapa con punto Y nombre, y su cuenta', /\.col h3 \.nom::before\{content:"";[^}]*background:var\(--tone\)/.test(bloque) && /\.col h3 \.cuenta\{[^}]*background:var\(--tone-s\);color:var\(--tone-t\)/.test(bloque));
check('la tarjeta lleva el avatar del contacto, el mismo de Contactos', /'<div class="t">' \+ avatarHtml\(nameOf\(c\), c\.id, 'sm'\)/.test(js));
check('🪤 una columna vacía dice que lo está (y sigue siendo donde soltar)', /\.col\.vacia \.cards::after\{content:"Sin tratos en esta etapa"/.test(bloque));
check('las citas en índigo, cumplidas en verde, no asistió en rojo, canceladas tachadas', /\.cal-ev,:root\[data-piel="xen"\] \.cal-ev\.completada,:root\[data-piel="xen"\] \.cal-ev\.no_asistio\{--tag:var\(--fx-indigo\)/.test(bloque) && /\.cal-ev\.completada\{--tag:var\(--fx-verde\)/.test(bloque) && /\.cal-ev\.no_asistio\{--tag:var\(--fx-rojo\)/.test(bloque) && /\.cal-ev\.cancelada\{[^}]*line-through/.test(bloque));
check('con movimiento reducido, las tarjetas no se levantan', /@media \(prefers-reduced-motion:reduce\)\{:root\[data-piel="xen"\] \.card,:root\[data-piel="xen"\] \.card:hover\{transition:none;transform:none\}\}/.test(bloque));

console.log('— Nada se sale de la piel');
const seccion = bloque.slice(bloque.indexOf('/* ---------- XEN · Contactos, ficha y tratos'), bloque.indexOf('/* (fin de XEN · Contactos, ficha y tratos) */'));
check('lo nuevo vive en su sección del bloque', seccion.length > 2000);
check('🪤 ningún color suelto en las piezas nuevas (solo en la definición de los tonos de avatar)', !/#[0-9a-f]{3,6}\b/i.test(seccion.replace(/--fx-av-\d-[st]:#[0-9a-f]{6}/gi, '')), (seccion.replace(/--fx-av-\d-[st]:#[0-9a-f]{6}/gi, '').match(/#[0-9a-f]{3,6}\b/gi) ?? []).join(','));

console.log(fail ? `\n✗ ${fail} fallas` : '\n✓ todo bien');
process.exit(fail ? 1 : 0);
