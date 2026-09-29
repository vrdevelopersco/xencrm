// Pruebas del esqueleto del tablero: pnpm test:tablero
//
// Son de código fuente, no de pantalla: una pantalla se mira, y para eso están las fotos con un navegador de
// verdad. Esto vigila lo que no se ve al mirarla y se borra sin querer en cualquier edición — y que cuando se
// rompe, se rompe entero y en silencio.
import { readFileSync } from 'node:fs';

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};

const html = readFileSync(new URL('../../public/admin.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../../public/admin.js', import.meta.url), 'utf8');

// 🪤 El panel de la sección se esconde donde no aporta, y al esconderlo la colocación automática de la rejilla
// metía el contenido en la columna del panel —que mide cero— y la pantalla salía EN BLANCO. Sin un error en la
// consola, sin nada roto que buscar: solo el fondo. Por eso cada pieza tiene su columna dicha a mano.
check('🪤 cada pieza del esqueleto tiene su sitio en la rejilla', /\.app>\.rail\{grid-column:1\}/.test(html) && /\.app>\.subnav\{grid-column:2\}/.test(html) && /\.app>\.main\{grid-column:3\}/.test(html),
  'sin grid-column explícito, esconder el panel deja la pantalla en blanco');

// El riel son iconos sin texto: sin nombre accesible, para un lector de pantalla son cinco botones sin nombre.
const riel = html.slice(html.indexOf('<aside class="rail">'), html.indexOf('</aside>'));
const botones = riel.match(/<button[^>]*class="rb[^"]*"/g) || [];
const conNombre = (riel.match(/<button[^>]*class="rb[^"]*"[^>]*aria-label="/g) || []).length;
check('todos los botones del riel se llaman de alguna forma', botones.length > 0 && conNombre === botones.length, `${conNombre} de ${botones.length} tienen aria-label`);
check('y dicen qué son al pasar por encima', (riel.match(/data-tip="/g) || []).length >= 5);

// 🪤 El relieve no puede ser la única señal de en qué sección estás: con el contraste alto del sistema, o para
// quien no distinga ese matiz, el riel se queda sin decir dónde está uno.
check('🪤 la sección activa se marca de más de una forma', /\.rail \.rb\.active::before\{content:""/.test(html) && /\.rail \.rb\.active \.ic\{color:var\(--brand\)\}/.test(html),
  'hace falta la pestaña del borde y el icono en color, no solo el fondo');

// El celular: ocho botones en 390 px no caben, y al no caber ensanchan la rejilla y cortan la página entera
// por la derecha. Se encogen, y el área de toque de 44 px la pone el pseudo-elemento.
check('🪤 en el celular el riel se encoge en vez de desbordar', /\.rail \.rb\{width:38px;height:38px/.test(html) && /\.rail\{grid-row:3[^}]*overflow:hidden\}/.test(html),
  'si el riel desborda, la lista y la búsqueda salen cortadas sin que nada parezca roto');

// Los tres niveles de la configuración: de aiva, del cliente y tuyo. Confundirlos costó cuatro entregas
// persiguiendo un nombre que parecía cruzarse entre clientes.
check('🪤 la configuración dice de quién es cada cosa', /grupo\('Este cliente', 'cfg-biz'\)/.test(js) && /grupo\('Tú', 'cfg-yo'\)/.test(js));
check('y pone el nombre de verdad, no la etiqueta', /\$\('cfg-biz'\)\.textContent = state\.bizName/.test(js) && /\$\('cfg-yo'\)\.textContent = state\.name/.test(js));

// Lo que se saca del menú principal tiene que seguir alcanzable: si un ajuste solo vive en un sitio y ese sitio
// desaparece, deja de existir para quien lo necesitaba.
for (const cual of ['theme-btn', 'sound-btn', 'logout-btn', 'foot-user', 'conn']) {
  check(`sigue habiendo dónde tocar «${cual}»`, html.includes(`id="${cual}"`), 'lo usa el resto del tablero; quitarlo revienta al arrancar');
}

// 🪤 Escribir es la señal de que hay una persona. El cajón estaba escondido mientras contestaba aiva, así que
// para tomar una conversación había que mover un interruptor ANTES de tener nada que decir; y aiva podía
// contestar primero mientras uno pensaba la respuesta, dejando al cliente con dos versiones de lo mismo.
check('🪤 el cajón de escribir está siempre, no solo en modo persona', /\$\('reply'\)\.hidden = false;/.test(js),
  'si se esconde, escribir no puede ser la señal');
check('🪤 escribir toma la conversación antes de enviar', /addEventListener\('input'/.test(js) && /body: \{ on: true \}/.test(js));
check('y no se pierde lo que ya habías escrito', /\$\('reply'\)\.value = loEscrito;/.test(js), 'recargar la conversación borraba tu texto');

const wa = readFileSync(new URL('../channels/whatsapp.ts', import.meta.url), 'utf8');
check('🪤 contestar desde el teléfono también toma la conversación', /if \(c && !c\.humanMode\) setHumanMode\(userId, true, quien\)/.test(wa),
  'si no, aiva y la persona contestan a la vez al mismo cliente');
check('y lo que contesta el negocio se guarda de verdad', /function anotarLoDelNegocio/.test(wa) && /enviadosPorAiva/.test(wa));

// ---------- «Solo escuchar» es modo aprendizaje: aiva mira, no se mete ----------
// 🪤 Los tres sitios por donde se asomaba. Ninguno era una respuesta del modelo, y por eso ninguno saltaba a la
// vista: una contestación a las notas de voz, el doble check azul y el «escribiendo…». El cliente veía señales
// de que había alguien y luego no le contestaba nadie, que es peor que no hacer nada.
check('🪤 en modo escucha no contesta a los audios ni a las fotos', /if \(soloEscucha\('whatsapp'\)\) return;/.test(wa),
  'esa respuesta estaba antes de mirar el modo: se disparaba siempre');
check('🪤 ni marca como leído ni pone «escribiendo…»', /const callado = soloEscucha\('whatsapp'\);/.test(wa) && /if \(!callado\) \{\n      await sock\.readMessages/.test(wa));

// Un recordatorio automático rompería el modo justo donde más se nota. Se recuerda igual, pero por la campana.
const rec = readFileSync(new URL('../crm/reminders.ts', import.meta.url), 'utf8');
check('🪤 en modo escucha el recordatorio no sale solo', /if \(soloEscucha\(c\.channel as ChannelId\)\) return/.test(rec));
check('y el equipo se entera por la campana', /avisarRecordatorio\(a\.userId/.test(rec), 'quedarse callado y no avisar a nadie es perder la cita');

// 🪤 Comandos de pruebas abiertos al público: /reset borraba historial, ficha y citas de quien lo escribiera.
const ag = readFileSync(new URL('../agent/agent.ts', import.meta.url), 'utf8');
check("🪤 /reset solo vale desde la consola de pruebas", /text === '\/reset' && msg\.channel === 'cli'/.test(ag),
  'un cliente travieso se borraba a sí mismo y nadie se enteraba de por qué');

// 🪤 Al recargar se veía el cajón del token flotando sobre el tablero ya dibujado: venía visible en el HTML y
// era transparente. Parecía que la sesión se había caído, y no. Y cuando la sesión sí vence, ese cajón salía
// encima de las conversaciones de los clientes, a la vista de cualquiera que pasara por ahí.
check('🪤 el login arranca escondido, no visible', /<div class="login" id="login" hidden>/.test(html),
  'visible de entrada parpadea en cada recarga aunque ya hayas entrado');
check('🪤 y cuando se enseña, tapa lo que hay detrás', !/\.login\{[^}]*background:transparent/.test(html) && /\.login\{[^}]*backdrop-filter:blur/.test(html),
  'transparente deja ver las conversaciones detrás del cajón del token');

// El bloc de notas, a este tamaño, contaba más ruido que información.
check('en Prospectos el cabezal del bloc va a media voz', /\.col \.card::before\{height:6px/.test(html) && /\.col \.card \.body::before\{display:none\}/.test(html));

console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
