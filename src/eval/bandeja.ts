// Pruebas de la Bandeja omnicanal de XENCRM, sin modelo ni navegador: pnpm test:bandeja
//
// La bandeja se rehízo como la de un CRM de mensajería (SendPulse) con la conversación de un cliente de WhatsApp de
// escritorio (ZapFast). Aquí se prueba que lo nuevo no inventó estado ni rutas: los filtros siguen siendo uno solo,
// la nota interna va por la misma ruta que «Guardar nota», pausar la automatización es el mismo interruptor Aiva/Tú
// y «Asignado a» es el mismo dato que la ficha. Y las trampas de siempre: [hidden] y la opacidad.
import { readFileSync } from 'node:fs';

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
const vista = html.slice(html.indexOf('<section class="view" id="view-inbox">'), html.indexOf('<!-- Pipeline -->'));

console.log('— Los filtros: Mías · Sin asignar · Todas, y «Todos los estados»');
const asig = /<div class="fx-asig" role="group"[^>]*>([\s\S]*?)<\/div>/.exec(vista)?.[1] ?? '';
check('el segmentado trae Mías, Sin asignar y Todas, en ese orden', [...asig.matchAll(/data-f="([a-z-]+)"/g)].map((m) => m[1]).join(',') === 'mios,sin-asignar,all', asig);
check('🪤 son botones de #filters: el filtro sigue siendo uno solo (state.filter), sin estado aparte', /<div class="filters" id="filters">\s*<div class="fx-asig"/.test(vista) && !/state\.(asignadas|asignacion|deQuien)\s*=/.test(js));
const estados = [...vista.matchAll(/<button data-(?:rol="[a-z]+" data-)?f="([a-z:_-]+)" class="fx-estado/g)].map((m) => m[1]);
check('los de estado siguen ahí como fuente del desplegable', ['unread', 'human', 'hot', 'stage:interesado', 'stage:cita_agendada', 'archived'].every((f) => estados.includes(f)), estados.join(','));
const pff = funcion('pintarFiltroFacil');
check('el desplegable empieza por «Todos los estados» y se arma con esos botones', /Todos los estados/.test(pff) && /#filters button\.fx-estado\[data-f\]/.test(pff));
check('🪤 en el modo fácil no ofrece lo que el modo esconde', /facil && b\.classList\.contains\('solo-completo'\)/.test(pff));
check('elegir un estado deja «Todas» encendido en el segmentado (el estado mira en todas)', /f === 'all' && !deQuien/.test(pff));
check('«Sin asignar» filtra con su regla en loadContacts', /if \(state\.filter === 'sin-asignar'\) list = list\.filter\(sinAsignar\);/.test(funcion('loadContacts')));
const sinAsignar = new Function(`${funcion('sinAsignar')}; return sinAsignar;`)() as (c: object) => boolean;
check('sin asignar = sin nadie en «Asignado a» (y los espacios no cuentan como alguien)', sinAsignar({ responsable: null }) && sinAsignar({ responsable: '  ' }) && sinAsignar({}) && !sinAsignar({ responsable: 'Laura' }));
check('«Mías» sigue con la regla de siempre (esMia, la misma del servidor)', /if \(state\.filter === 'mios'\) list = list\.filter\(esMia\);/.test(js));
check('«Marcar todo como leído» se queda (y dice su nombre aunque sea un ícono)', /id="marcar-leidas"[^>]*aria-label="Marcar todo como leído"/.test(vista));
check('vacío con salida: dice qué pasó y ofrece «Ver todas»', /Nada por aquí con este filtro/.test(funcion('renderRows')) && /id="fx-ver-todas"/.test(funcion('renderRows')));

console.log('— Las filas');
const rr = funcion('renderRows');
check('cada fila lleva su avatar con la insignia del canal, y el canal también en palabras', /avatarXen\(c, 'fx-av-fila solo-facil'\)/.test(rr) && /class="sr-only"> · ' \+ esc\(canal\.t\)/.test(rr));
check('los no leídos van en píldora, dichos también en palabras', /class="unread"[^\n]*sin leer/.test(rr));
check('las marcas que dicen algo van en su propio renglón (no se cortan)', /'<div class="fx-marcas">' \+ marcas/.test(rr));
check('con el teclado también se abre (Tab llega, Enter abre)', /r\.tabIndex = 0/.test(rr) && /e\.key === 'Enter' \|\| e\.key === ' '/.test(rr));
const tono = new Function(`${funcion('tonoXen')}; return tonoXen;`)() as (n: string) => number;
const nombres = ['Julián Torres', 'Camilo Restrepo', 'Ana', '', 'Visitante del sitio · 44fa', 'Ñoño Pérez'];
check('el tono del avatar es el mismo siempre para el mismo nombre, y uno de los seis', nombres.every((n) => tono(n) === tono(n) && tono(n) >= 1 && tono(n) <= 6), nombres.map(tono).join(','));

console.log('— Los avatares se leen (contraste medido)');
const lum = (h: string) => { const c = [0, 2, 4].map((i) => parseInt(h.slice(1 + i, 3 + i), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!; };
const ratio = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const bloqueAncla = html.slice(html.indexOf('/* ---------- XEN · Bandeja omnicanal'), html.indexOf('/* (fin de XEN · Bandeja omnicanal) */'));
const claro = /:root\[data-piel="xen"\]\{([^}]*)\}/.exec(bloqueAncla)?.[1] ?? '';
const oscuro = /:root\[data-piel="xen"\]\[data-theme=dark\]\{([^}]*)\}/.exec(bloqueAncla)?.[1] ?? '';
const tok = (css: string, k: string) => new RegExp(`--${k}:(#[0-9a-f]{6})`).exec(css)?.[1] ?? '';
const pares = [1, 2, 3, 4, 5, 6].flatMap((n) => [['claro', claro], ['oscuro', oscuro]].map(([t, css]) => ({ n, t, r: ratio(tok(css!, `fx-av-${n}-t`) || '#ffffff', tok(css!, `fx-av-${n}-s`) || '#ffffff') })));
check('los seis tonos, en claro y en oscuro, con sus iniciales a ≥ 4.5:1', pares.every((p) => p.r >= 4.5), pares.filter((p) => p.r < 4.5).map((p) => `${p.t} ${p.n}: ${p.r.toFixed(2)}`).join(', '));
check('🪤 y no son los de las etapas (un avatar rojo se leería «perdido»)', !/--fx-av-\d-[st]:var\(--fx-(rojo|verde|ambar|cielo|indigo)/.test(bloqueAncla));

console.log('— La conversación');
const cab = funcion('pintarCabeceraXen');
check('la cabecera dice quién responde en palabras: «Responde …» o «Automatización pausada · la lleva …»', /'Responde ' \+ esc\(agente\)/.test(cab) && /'Automatización pausada · la lleva ' \+ esc\(whoHas\(c\)\)/.test(cab));
check('«Pausar automatización» / «Reanudar automatización» es el mismo interruptor Aiva/Tú', /aria-label', c\.humanMode \? 'Reanudar automatización' : 'Pausar automatización'/.test(cab) &&
  /\$\('fx-control'\)\.onclick = function \(\) \{ if \(state\.detail\) \$\(state\.detail\.contact\.humanMode \? 'seg-bot' : 'seg-human'\)\.click\(\); \}/.test(js));
check('«Asignado a» de la cabecera es el mismo dato y el mismo guardado que la ficha (responsable)', /responsableHtml\(c, 'fx-asignado'\)/.test(cab) && /engancharResponsable\(\$\('fx-asignado'\), c,/.test(cab) && /fila\('Asignado a', responsableHtml\(c, 'f-resp'\)\)/.test(js));
check('🪤 nada de «desde hace ahora»', /r === 'ahora' \? ' desde ahora'/.test(funcion('desdeXen')) && /desdeXen\(c\.humanSince\)/.test(funcion('renderChat')));
check('el «¿por qué?» de cada respuesta sigue siendo solo del completo', /class="por-que solo-completo"/.test(funcion('bubble')));
check('lo que no le llegó al cliente sigue dicho en el mensaje (borde punteado y la palabra)', /No le llegó\./.test(funcion('bubble')) && /\.bubble\.fallo\{outline:1\.5px dashed var\(--fx-rojo-t\)/.test(html));
check('🪤 lo de antes de aiva se distingue sin opacidad', /:root\[data-piel="xen"\] \.bubble\.de-antes\{opacity:1;/.test(html));
check('la trama del papel sale de su token (máscara), no de un color metido en el dibujo', /\.chat::before\{[^}]*background:var\(--fx-papel-trama\)/.test(html) && /mask:url\(/.test(html));
check('cada quien habla en su color (el agente verde agua, el equipo arena)', /\.bubble\.bot\{background:var\(--fx-burbuja-xen\)\}/.test(html) && /\.bubble\.human\{background:var\(--fx-burbuja-equipo\)\}/.test(html) &&
  /\.bubble\.bot \.who\{color:var\(--fx-nombre-xen\)\}/.test(html) && /\.bubble\.human \.who\{color:var\(--fx-nombre-equipo\)\}/.test(html));

console.log('— El cajón: «Enviar mensaje» · «Nota interna»');
const nota = funcion('guardarNotaInterna');
const rutaDeSiempre = /api\('\/contacts\/' \+ encodeURIComponent\(c\.id\) \+ '\/notas', \{ method: 'POST', body: \{ texto: texto, por: state\.name \|\| '' \} \}\)/;
check('la nota interna va por la misma ruta que «Guardar nota» de la historia', rutaDeSiempre.test(nota) && rutaDeSiempre.test(funcion('renderDetails')));
check('🪤 no usa el cajón del mensaje (escribir en #reply toma la conversación)', /<textarea id="fx-nota"/.test(vista) && !/\$\('reply'\)/.test(nota) && !/\/human/.test(nota));
check('🪤 si falla, lo escrito no se borra', nota.indexOf("r.error) { toast(") > 0 && nota.indexOf("r.error) { toast(") < nota.indexOf("$('fx-nota').value = ''"));
check('🪤 lo escrito en una nota se queda con SU conversación', /cajon\.notas\[cajon\.de\] = v/.test(funcion('cajonDeLaConversacion')) && /cajonDeLaConversacion\(c\);\s*setMode\(c\.humanMode\);/.test(funcion('renderChat')));
check('se ve distinta: el cajón arena y dice que solo la ve el equipo', /\.composer\.en-nota\{background:var\(--fx-burbuja-equipo\)\}/.test(html) && /Solo la ve el equipo: no le llega al cliente\./.test(vista));
check('las pestañas son pestañas (role=tab, aria-selected, flechas)', /role="tablist"/.test(vista) && /role="tab" id="fx-tab-mensaje" aria-selected="true"/.test(vista) && /ArrowLeft/.test(js.slice(js.indexOf('// ---------- el cajón'))));
check('🪤 [hidden] gana dentro del cajón (.btn tiene display y «Guardar nota» salía en el mensaje)', /:root\[data-piel="xen"\] \.composer>\[hidden\]\{display:none!important\}/.test(html));
check('la ayuda dice lo que de verdad hace Enter', /Enter envía · Shift\+Enter, nueva línea/.test(vista) && /\$\('reply'\)\.onkeydown = function \(e\) \{ if \(e\.key === 'Enter' && !e\.shiftKey\)/.test(js));

console.log('— La ficha de al lado');
const det = funcion('renderDetails');
check('el lápiz abre «Corregir datos» y pone el cursor en el nombre', /id="fx-lapiz"/.test(det) && /details\[data-k="corregir"\]/.test(det) && /\$\('f-name'\)\.focus\(\)/.test(det));
check('cómo contactarlo sale con su ícono y con los enlaces de siempre (contactoHtml)', /mediosXen\(c\)/.test(det) && /contactoHtml\(c, fila\) \+/.test(funcion('mediosXen')));
check('«Lo que busca» va en el violeta de la IA', /\.details \.ficha-quiere\{[^}]*background:var\(--fx-ia-s\)/.test(html));
check('Origen y La lleva siguen siendo solo del completo', /fila\('Origen',[^\n]*'solo-completo'\)/.test(det) && /fila\('La lleva', llevaHtml\(c\), 'solo-completo'\)/.test(det));

console.log(fail ? `\n${fail} fallaron` : '\nTodo bien');
process.exit(fail ? 1 : 0);
