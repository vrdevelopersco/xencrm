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
// La regla es que NO baste el fondo: quien no distinga ese tono tiene que seguir viendo dónde está. Se prueba
// que haya tres señales a la vez, sin atarse a qué color concreto lleva cada una —el riel pasó a oscuro con su
// propia paleta el 2026-10-02 y la regla sigue valiendo igual.
check('🪤 la sección activa se marca de más de una forma',
  /\.rail \.rb\.active::before\{content:""/.test(html) &&
    /\.rail \.rb\.active \.ic\{color:var\(--[a-z-]+\)\}/.test(html) &&
    /\.rail \.rb\.active\{[^}]*color:/.test(html),
  'hacen falta la pestaña del borde, el icono en color y el texto, no solo el fondo');

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
// 🪤 Opaco del todo, no translúcido. Antes bastaba con el desenfoque del vidrio; al quitarlo, cualquier
// transparencia deja leer las conversaciones de los clientes detrás del cajón del token.
check('🪤 y cuando se enseña, tapa lo que hay detrás', /\.login\{[^}]*background:var\(--bg\)\}/.test(html) && !/\.login\{[^}]*transparent/.test(html),
  'transparente deja ver las conversaciones detrás del cajón del token');

// El bloc de notas, a este tamaño, contaba más ruido que información.
// La tarjeta ya no es un bloc de notas (2026-10-02), pero de qué etapa es se sigue diciendo con color: ahora
// una línea arriba, en el tono de la columna. Lo que se prueba es eso, no el adorno de turno.
check('la tarjeta dice su etapa con color', /\.card::before\{content:"";display:block;height:3px;background:var\(--tone/.test(html));

// Los avisos: icono, quién en negrita, y tiempo a la vista.
check('el aviso lleva icono y el título en negrita', /<i class="ic" data-ic="' \+ icono \+ '"><\/i>/.test(js) && /opts\.titulo \? '<b>' \+ esc\(opts\.titulo\)/.test(js));
check('quien escribe va en el título, no pegado al mensaje', /titulo: c \? nameOf\(c\) : short\(ev\.userId\), icono: 'message'/.test(js),
  'antes salía «Nombre: mensaje» de corrido y había que leerlo entero para saber de quién era');
// 🪤 Un solo reloj: la animación de la barra ES el temporizador. Con dos, se desincronizan y el aviso se va
// mientras lo lees —o la barra llega al final y el aviso se queda—.
check('🪤 el reloj se para si pasas el ratón por encima', /vida\.finished\.then\(irse\)/.test(js) && /t\.onmouseenter = function \(\) \{ vida\.pause\(\); \}/.test(js));
check('y hay salida para quien no quiere animaciones', /prefers-reduced-motion/.test(js) && /if \(!t\.animate \|\| quieto\)/.test(js));
check('sin andamios de prueba colgando', !/__toast|ANDAMIO/.test(js), 'el gancho de las fotos no se sube');

// 🪤 El tablero lo abre el NEGOCIO, no quien lo monta. Un texto que dice «ejecuta pnpm ingest» o «pega esto en
// CALENDAR_BUSY_ICS» le pide a un cliente algo que no puede hacer y que además no tiene por qué saber: le
// enseña las tripas y lo deja sin salida. Lo que sí puede hacer se le dice; lo que no, se le dice a quién
// pedírselo. (Se miran solo los textos: los comentarios del código sí pueden nombrar variables.)
const textos = js
  .split('\n')
  .filter((l) => !l.trim().startsWith('//'))
  .join('\n');
// 🪤 Y no solo en el tablero: media pantalla de Canales la escribe el SERVIDOR. La primera versión de esta
// prueba solo miraba admin.js y admin.html, así que dejó pasar un «PUBLIC_URL en .env» que el cliente veía en
// letra grande. Lo que se mira es todo lo que le llega a él.
const dichoAlCliente = [textos, html, readFileSync(new URL('../channels/registry.ts', import.meta.url), 'utf8')
  .split('\n')
  .filter((l) => !l.trim().startsWith('//'))
  .join('\n')].join('\n');
for (const jerga of ['pnpm ', 'CALENDAR_BUSY_ICS', 'PUBLIC_URL', 'ADMIN_TOKEN', 'ALLOWED_ORIGINS', 'OPENAI_API_KEY']) {
  check(`🪤 al cliente no se le nombra «${jerga.trim()}»`, !dichoAlCliente.includes(jerga),
    'eso lo sabe quien monta el sistema, no quien atiende a sus clientes');
}

// ---------- Los grupos de WhatsApp ----------
const sw = readFileSync(new URL('../channels/switches.ts', import.meta.url), 'utf8');
check('🪤 los grupos vienen apagados', /getSetting\(`channel\.\$\{id\}\.grupos`, false\)/.test(sw),
  'en un grupo escribe gente que nunca le escribió al negocio: eso se enciende a mano');
// 🪤 Nunca, pase lo que pase con «Contesta Aiva». Equivocarse en un grupo es equivocarse delante de todos a la
// vez y no hay forma de recogerlo. Si alguien conecta el envío a los grupos, esto lo dice.
const dentroDelGrupo = wa.slice(wa.indexOf('if (isJidGroup(jid)) {'), wa.indexOf('if (env.whatsappAllowedNumbers.length)'));
check('🪤 aiva nunca escribe en un grupo', dentroDelGrupo.includes('return;') && !/mandar\(|sendMessage\(/.test(dentroDelGrupo),
  dentroDelGrupo.slice(0, 200));
check('lo del grupo va al aprendizaje, no al tablero', /function anotarDelGrupo/.test(wa) && /'whatsapp-grupo'/.test(wa) && !/anotarDelGrupo[\s\S]{0,400}appendMessage/.test(wa),
  'un grupo no es un prospecto: como conversación llenaría las listas de fichas que nadie atiende');
check('🪤 y no se pone al día: el historial sigue sin traer grupos', /isJidGroup\(jid\)\) return \[\]/.test(wa),
  'traer meses de grupos de golpe es meter en casa conversaciones de mucha gente que no eligió estar ahí');

// Encender se pregunta; apagar, no: pedir confirmación para salir sería poner una puerta en la salida.
check('encender los grupos pasa por un modal', /\$\('dlg-grupos'\)\.showModal\(\)/.test(js) && html.includes('id="dlg-grupos"'));
check('y apagarlos es de un clic', /if \(!encender\) return mandar\(\);/.test(js));

// ---------- El retrato: lo que aiva entendió del negocio ----------
const ret = readFileSync(new URL('../rag/retrato.ts', import.meta.url), 'utf8');
// 🪤 Un retrato equivocado es peor que no tener ninguno: aiva aconsejaría con seguridad sobre una premisa falsa
// y nadie sabría de dónde salió. Por eso NO se guarda solo y dice de qué se dedujo.
check('🪤 el retrato es un borrador: no se guarda solo', !/guardarNotaInterna/.test(ret) && /Nada de esto se ha guardado todav/.test(js),
  'guardarlo solo sería poner en boca del negocio lo que dedujo una máquina');
check('y dice de qué se dedujo', /desde: \{ conversaciones/.test(ret) && /corrígeme lo que esté mal/.test(js));
check('lo que se acepta queda marcado como deducido', /origen: 'deducido y confirmado'/.test(js),
  'hay que poder distinguir lo que escribió una persona de lo que dedujo la máquina');
// 🪤 Con dos conversaciones, cualquier retrato encaja en cualquier negocio.
check('🪤 con poco material dice que hay poco, en vez de inventar', /const flaco = desde\.conversaciones < 3/.test(ret));
// 🪤 «18 segundos» redondeado a minutos es «0 minutos», y el modelo lo repite con seguridad.
check('🪤 un dato que no se puede decir bien, no se dice', /menos de un minuto/.test(ret),
  'redondear a cero convierte el retrato en una frase falsa dicha con confianza');
check('el retrato sale como nota interna, no como información del cliente', !/kind: 'knowledge'/.test(ret));

// ---------- Mira · Propone · Contesta ----------
const sw2 = readFileSync(new URL('../channels/switches.ts', import.meta.url), 'utf8');
const ag2 = readFileSync(new URL('../agent/agent.ts', import.meta.url), 'utf8');
const prop = readFileSync(new URL('../crm/propuestas.ts', import.meta.url), 'utf8');
const adm = readFileSync(new URL('../channels/admin.ts', import.meta.url), 'utf8');

check('hay tres modos, no dos', /'mira' \| 'propone' \| 'contesta'/.test(sw2));
// 🪤 Quien ya tenía el canal en «solo escuchar» no debe encontrarse a aiva hablándole a sus clientes.
check('🪤 el ajuste viejo se respeta al actualizar', /escuchaba \? 'mira' : 'contesta'/.test(sw2),
  'sin esto, actualizar pondría el canal en «contesta» a quien lo tenía callado');
// 🪤 «Propone» tiene que pasar por el modelo: ese es su trabajo. Solo «mira» se corta antes.
check('🪤 solo «mira» se corta antes del modelo', /modoCanal\(msg\.channel as ChannelId\) === 'mira'/.test(ag2));
// 🪤 Anotar como dicho algo que nadie mandó deja al asistente siguiendo la conversación como si ya hubiera
// contestado eso, y al cliente viendo una respuesta que no recibió.
check('🪤 lo propuesto NO se anota como dicho por aiva', /if \(propone\(msg\.channel as ChannelId\)\) \{[\s\S]{0,300}?proponer\(/.test(ag2) && !/proponer\([\s\S]{0,200}?recordBotReply/.test(ag2));
// 🪤 Del propio asistente no se aprende nada; de lo que escribe una persona, sí.
check('🪤 sin corregir la manda aiva; corregida, la manda la persona', /corregida \? 'human' : 'bot'/.test(adm),
  'si va siempre como humana, aiva acabaría aprendiendo de sí misma');
// 🪤 Una respuesta preparada hace veinte minutos, con tres mensajes nuevos encima, ya no contesta a nada.
check('🪤 la propuesta caduca cuando el cliente vuelve a escribir', /vieja: ultimoMensaje\(userId\) > f\.sobre_mensaje/.test(prop));
check('y solo hay una esperando por conversación', /estado = 'reemplazada'/.test(prop));

// ---------- Propone, en grupos ----------
const cont = readFileSync(new URL('../crm/contacts.ts', import.meta.url), 'utf8');
// 🪤 Un grupo de veinte personas son cientos de mensajes al día. Si el disparador fuera «alguien escribió»,
// sería plata quemada y un aviso cada tres minutos hasta que alguien lo apague de puro cansancio.
check('🪤 en un grupo solo se propone si le hablan al negocio', /function meHablanAMi/.test(wa) && /mentionedJid/.test(wa) && /quotedMessage/.test(wa),
  'el disparador no puede ser «alguien escribió»');
check('y aiva sigue sin mandar nada a un grupo por su cuenta', /if \(propone\('whatsapp'\) && meHablanAMi/.test(wa) && !/proponerEnGrupo[\s\S]{0,400}?mandar\(/.test(wa));
// 🪤 El camino de una conversación da de alta al que escribe. Un grupo acabaría en las listas y en el embudo
// como un prospecto: fichas que nadie va a atender y un embudo mentiroso.
check('🪤 un grupo nunca entra al CRM como contacto', /u\.id NOT LIKE '%@g\.us'/.test(cont) && /id NOT LIKE '%@g\.us'/.test(cont));
check('lo del grupo se manda suelto, sin ficha', /if \(p\.grupo\) \{[\s\S]{0,200}?enviarSuelto\('whatsapp'/.test(adm),
  'sendToContact revienta con «no existe» porque un grupo no es un contacto');
check('y se ve en Hoy, que es donde no tiene conversación', /enGrupos: propuestasPendientes\(\)/.test(adm) && /filter\(\(p\) => p\.grupo\)/.test(adm) && /Te escribieron en un grupo/.test(js));
// 🪤 Una tabla que ya existe no gana columnas con CREATE TABLE IF NOT EXISTS.
check('🪤 la tabla vieja se actualiza sola', /ALTER TABLE propuestas ADD COLUMN grupo/.test(prop),
  'quien tenga la de ayer se quedaría con «no such column: grupo» sin saber de dónde sale');

// ---------- Seguirle la cuerda al grupo ----------
const hist = readFileSync(new URL('../crm/historial.ts', import.meta.url), 'utf8');
// 🪤 «¿y eso cuánto vale?» no se entiende solo: depende de lo que otro preguntó tres mensajes antes. Y sin
// nombres, aiva le contesta a Marcela lo que preguntó Jorge.
check('🪤 en un grupo se le pasa el hilo, con nombres', /hilo: antes/.test(wa) && /x\.autor \|\| 'alguien'/.test(wa),
  'contestar un mensaje suelto en un grupo es contestar a medias');
// 🪤 mensajesDeChat ordena de viejo a nuevo y corta con LIMIT: devuelve los PRIMEROS.
check('🪤 el hilo son los ÚLTIMOS mensajes, no los primeros', /ORDER BY ts DESC LIMIT \?/.test(hist) && /return filas\.reverse\(\)/.test(hist),
  'pedir «los últimos» y recibir los del año pasado no salta a la vista');
check('y no se le repite el mensaje que acaba de llegar', /filter\(\(x\) => x\.content !== texto\)/.test(wa));
// 🪤 Una respuesta suelta, fuera de la conversación donde nació, no se puede juzgar.
check('🪤 la propuesta guarda a qué contesta', /sobre: string;/.test(prop) && /p\.sobre \? '<div class="small muted"/.test(js),
  'en un grupo no hay conversación en el tablero que abrir para ir a ver la pregunta');

// ---------- Quién es quién en un grupo ----------
const gg = readFileSync(new URL('../crm/grupo-gente.ts', import.meta.url), 'utf8');
// 🪤 En un grupo el remitente real va en `participant`; `remoteJid` es el grupo. Confundirlos daría una sola
// ficha por grupo, con el nombre de quien escribió de último.
check('🪤 se anota a quien escribe, no al grupo', /anotarParticipante\(jid, jidNormalizedUser\(m\.key\.participant/.test(wa));
// 🪤 WhatsApp no siempre manda el pushName: machacar «Marcela» con vacío deja la ficha en un número.
check('🪤 un nombre vacío no borra el que ya había', /WHEN excluded\.nombre <> '' THEN excluded\.nombre ELSE grupo_gente\.nombre END/.test(gg));
// 🪤 Quien escribe en un grupo no le escribió al negocio: no tiene etapa, ni puntaje, ni cita.
check('🪤 la gente de un grupo no entra al CRM', !/touchUser|updateContact|appendMessage/.test(gg),
  'meterlos en las listas llenaría el embudo de gente que nunca pidió nada');
check('el modelo recibe quién es quién', /gente: quienes/.test(wa) && /Quién es quién en ese grupo/.test(ag2));
check('y quien atiende también lo ve', /genteDelGrupo\(p\.userId/.test(adm) && /g\.nombre \|\| String\(g\.persona\)/.test(js),
  'una respuesta sin saber a quién se le contesta no se puede juzgar');

// 🪤 Lo que se esconde con [hidden] y además lleva display: sin su propia regla, se ve siempre. El navegador
// pone display:none por [hidden], pero cualquier `display:flex` de una clase le gana. Pasó con el chip del
// archivo adjunto —salía vacío, con su botón de Quitar, sin que nadie hubiera escogido nada— y se vio en una
// captura, no en una prueba. Esto lo caza para todos los que vengan.
// 🪤 2026-10-21: la lista de arriba era a mano y se quedó corta. «.presentes» (el «Camila también está aquí») salía
// como una franja amarilla vacía en todas las conversaciones, y nadie la había puesto en la lista. Ahora se miran
// TODAS las clases de lo que nace con hidden en el HTML. Vale la regla con o sin un padre delante (.chat .head).
const nacenEscondidas = new Set<string>();
for (const m of html.matchAll(/<[a-z]+\b[^>]*\bclass="([^"]+)"[^>]*>/g)) {
  if (/\shidden(\s|>|=)/.test(m[0])) for (const c of m[1]!.split(/\s+/)) nacenEscondidas.add(c);
}
for (const clase of new Set([...nacenEscondidas, 'propuesta', 'login', 'detail-more', 'adj-listo'])) {
  const ponenDisplay = new RegExp(`(^|[},\\s])\\.${clase}\\{[^}]*display:`, 'm').test(html);
  const seApagan = new RegExp(`\\.${clase}\\[hidden\\][^{]*\\{display:none`).test(html);
  if (ponenDisplay) check(`🪤 .${clase} se esconde de verdad cuando lleva [hidden]`, seApagan,
    'tiene display: en su clase, así que [hidden] no lo apaga; hace falta .' + clase + '[hidden]{display:none}');
}

// 🪤 Trazabilidad se esconde para quien solo atiende, y el menú de Configuración se pinta en TRES sitios: el
// desplegable, la lista de la sección y el del celular. Filtrarlo en uno dejaba la entrada visible en los
// otros dos — un filtro repartido por tres sitios es un filtro que algún día se aplica en dos.
const menus = readFileSync('public/admin.js', 'utf8');
check('🪤 lo de solo-admin se filtra en TODOS los menús, no en uno', (menus.match(/\.filter\(visiblePara\)/g) || []).length >= 3,
  `solo ${(menus.match(/\.filter\(visiblePara\)/g) || []).length} de 3 sitios lo filtran`);
check('y el rol sale de quien entró por la consola', /window\.AIVA_ROL/.test(menus));
// Con el token a secas no hay rol y se ve todo: con ese token se puede llamar a la ruta igual, así que
// esconder el botón no protegería nada. Es orden de pantalla, no un cerrojo.
check('sin rol (token a secas) se ve todo', /return !r \|\| r === 'super' \|\| r === 'admin'/.test(menus), 'cambió la regla de quién es admin');

// 🪤 Ninguna clase nueva puede repetir el nombre de una que ya exista en esta hoja. Pasó con `.paleta`: la
// búsqueda global y los colores de la marca compartían nombre, y el `flex-wrap:wrap` del segundo mandaba los
// resultados a una columna nueva, FUERA del diálogo. Se veía una caja en blanco con todo medido y «visible»
// según el DOM. Una colisión de nombres no da error: da una pantalla que miente.
//
// Repetir una clase a propósito sí vale —el mismo componente se reestiliza en capas, como `.seg`: la base, la
// piel de vidrio y la versión final—. Lo que no vale es que DOS COSAS DISTINTAS compartan nombre. Como eso no
// se distingue leyendo el archivo, las intencionales van en esta lista: añadir una obliga a pensar si de
// verdad es la misma cosa, que es justo la pregunta que no se hizo con `.paleta`.
const ENCAPAS = new Set(['seg']);
const clasesConDisplay = [...html.matchAll(/^\.([a-z][a-z0-9-]*)\{[^}]*display:/gm)].map((m) => m[1]!);
const repetidas = [...new Set(clasesConDisplay.filter((c, i) => clasesConDisplay.indexOf(c) !== i))].filter((c) => !ENCAPAS.has(c));
check('🪤 ninguna clase nueva repite el nombre de otra', repetidas.length === 0,
  `se repiten: ${repetidas.join(', ')} — si son el mismo componente en capas, ponlo en ENCAPAS; si no, cámbiale el nombre a uno`);
check('la búsqueda global no se llama como los colores de la marca', /dialog\.buscador\{/.test(html) && !/dialog\.paleta\{/.test(html));

// — El orden de un CRM (2026-10-12): la ficha en dos columnas, la historia, «3 de 23» y fijar.
// 🪤 Trampa 3 de diseno-tablero.md: lo que el JavaScript engancha al cargar tiene que estar ANTES del <script>, o
// un `null.onclick` tumba el tablero entero.
const antesDelScript = html.slice(0, html.indexOf('<script src="admin.js'));
const enganchados = ['pf-ant', 'pf-sig', 'pf-fijar', 'pf-pos', 'pf-nav', 'pf-ini', 'marcar-leidas', 'rail-listas', 'pip-cifras', 'cuenta-cli', 'cli-filtros'];
// (cuenta-pip ya no está en el HTML: va en la pestaña «Por etapa», que arma el JavaScript; ver la prueba de las áreas.)
const faltan = enganchados.filter((id) => !antesDelScript.includes(`id="${id}"`));
check('🪤 lo que se engancha al cargar existe antes del <script>', html.includes('<script src="admin.js') && faltan.length === 0, `faltan antes del script: ${faltan.join(', ')}`);
// 🪤 Trampa 2: el display de un <dialog> va en [open]; suelto deja la ficha a la vista estando cerrada.
check('🪤 la ficha solo se muestra abierta', /dialog\.perfil\.ficha\[open\]\{display:flex/.test(html) && !/dialog\.perfil\.ficha\{[^}]*display:/.test(html));
// La historia cuenta en palabras: un tipo de evento que no sabe nombrar no sale, en vez de salir como «human_on».
const historia = js.slice(js.indexOf('function historiaHtml'), js.indexOf('function historiaHtml') + 6000);
check('la historia no enseña tipos de evento internos', /default: return;/.test(historia) && !/default: return e\.type/.test(historia));
check('🪤 la historia nunca dice «bot» ni «admin» como si fueran alguien', /by === 'bot' \? agente/.test(historia) && /by === 'admin' \|\| by === 'equipo' \? 'El equipo'/.test(historia));
check('borrar una nota pide un segundo clic, sin ventanas del navegador', /function engancharBorrarNotas/.test(js) && !/confirm\(/.test(js.slice(js.indexOf('function engancharBorrarNotas'), js.indexOf('function engancharBorrarNotas') + 900)));
check('los fijados son de este cliente, no de todos los del dominio', /localStorage\.getItem\(LLAVE\('fijados'\)\)/.test(js) && !/localStorage\.getItem\('aiva\.fijados/.test(js));
check('el dinero sale en la moneda del negocio, no en pesos fijos', /currency: state\.moneda \|\| 'COP'/.test(js) && !/currency: 'COP'/.test(js));
check('🪤 sin valor es «—», nunca «$0»', /function valorHtml\(c, corto\) \{\s*return c\.valor \?/.test(js));
check('los filtros de Conversaciones van encima de la lista, no en un panel que le quita sitio al chat', /<div class="list">[\s\S]*?id="filters"/.test(html) && /var conPanel = CFG_VIEWS\[view\];/.test(js));

// — La consola, con la piel del tablero (2026-10-12).
const consola = readFileSync(new URL('../../public/consola.html', import.meta.url), 'utf8');
const pielNueva = consola.slice(consola.indexOf('La piel del tablero, también aquí'));
check('🪤 la entrada de la consola no cambia: los colores nuevos solo mandan con la aplicación a la vista',
  /:root:has\(#app:not\(\[hidden\]\)\)\{/.test(pielNueva) && !/\n:root\{/.test(pielNueva));
check('lo de una vez al mes va en «⋯» sin perder sus clases, que es por donde se enganchan',
  ['respaldar', 'restaurar', 'copiar', 'baja', 'prio'].every((k) => new RegExp(`<details class="mas">[\\s\\S]*?class="[^"]*\\b${k}\\b`).test(consola)));
check('el menú «⋯» se cierra al hacer clic fuera o con Escape', /details\.mas\[open\][\s\S]{0,120}d\.open = false/.test(consola) && /e\.key === 'Escape'[\s\S]{0,120}details\.mas\[open\]/.test(consola));
check('la hoja de la consola no repite reglas copiadas dos veces', (consola.match(/\.micro\{display:grid/g) || []).length === 1);
// Cada color de consola que acepta el servidor tiene su pintura en la hoja; el azul es la base.
const { ACENTOS } = await import('../consola-usuarios.js');
const sinPintar = ACENTOS.filter((a) => a !== 'azul').filter((a) => !new RegExp(`:root\\[data-acento=${a}\\]:has\\(#app:not\\(\\[hidden\\]\\)\\)\\{[^}]*--brand:`).test(consola) || !consola.includes(`.acento[data-acento=${a}] i{`));
check('cada color de consola de la lista tiene su pintura y su muestra', sinPintar.length === 0 && consola.includes('.acento[data-acento=azul] i{'), `sin pintar: ${sinPintar.join(', ')}`);
check('🪤 al guardar «Mi cuenta» el botón del perfil no se queda en texto plano', !/\$\('yo'\)\.textContent = yo\./.test(consola) && /function pintarYo\(\)/.test(consola));
// El acceso de cada cliente (2026-10-16): el super-admin no sabía con qué usuario entraba cada negocio, y la clave
// guardada no se puede mostrar (es una huella). Se crea o se reemplaza desde la fila del cliente y se ve una sola vez.
const acceso = consola.slice(consola.indexOf('function claveAlAzar'), consola.indexOf("$('form-acceso').onsubmit"));
check('la clave nueva sale del azar del navegador, no de Math.random', /crypto\.getRandomValues/.test(acceso) && !/Math\.random/.test(acceso));
check('la clave nueva no se guarda en el navegador y se borra al cerrar', !/localStorage|sessionStorage/.test(acceso) &&
  /'dlg-acceso'\)\.addEventListener\('close', function \(\) \{ \$\('a-clave'\)\.value = ''; \$\('a-mensaje'\)\.textContent = ''/.test(acceso));
check('🪤 el mensaje de acceso lleva la dirección de la consola, no la raíz (en el paquete la raíz es la portada)',
  /location\.origin \+ location\.pathname/.test(acceso) && !/location\.origin \+ '\/'/.test(acceso));
check('«sin admin del cliente» solo se dice si el equipo llegó de verdad', /\(esSuper && equipoLeido\s/.test(consola) && /equipoLeido = Array\.isArray\(d\.usuarios\)/.test(consola));
check('el repintado de cada minuto no cierra «Ver más» ni pisa lo que se escribe', /var abiertos = /.test(consola) && /!escribiendoEnLaLista\(\)\) cargar\(\)/.test(consola));
check('la gráfica de la consola tiene dos colores, no el acento dos veces', /--serie-wa:#[0-9a-f]{6}; --serie-sitio:#[0-9a-f]{6}/.test(consola) && !/banda\(function \(p\) \{ return p\.total; \}, 'var\(--oro-claro\)'\)/.test(consola));

// — La portada (2026-10-12): el usuario la sintió con mucho texto. Pasó de 385 palabras a menos de 250, y la vista
// del tablero dice lo que antes decían los párrafos. Esto avisa si se vuelve a llenar.
const portada = readFileSync(new URL('../../public/inicio.html', import.meta.url), 'utf8');
const principal = portada.slice(portada.indexOf('<main>'), portada.indexOf('</main>')).replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ');
const palabras = principal.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
check('la portada no vuelve a llenarse de texto (menos de 260 palabras)', palabras < 260, `tiene ${palabras}`);
check('la vista del tablero en la portada se lee como una imagen con su descripción', /class="vista" role="img" aria-label="[^"]{30,}"/.test(portada));

// — Más sencillo para quien empieza (2026-10-21). Salió de comparar aiva con Vocero: «complejo de usar».
// 🪤 Con una columna llena, las tarjetas se aplastaban a 48 px y solo se veía la pastilla y medio nombre.
check('🪤 las tarjetas del tablero por etapa no se aplastan cuando la columna se llena', /\.col \.cards>\.card\{flex-shrink:0\}/.test(html),
  'sin flex-shrink:0, el overflow:hidden de .card deja que la columna las encoja');
check('un visitante sin nombre se ve como visitante, no como un código', /'Visitante del sitio · '/.test(js) && !/'web · '/.test(js));
check('🪤 el borrador para retomar saluda con el nombre de verdad, no con «Visitante»', /first = \(c\.name \|\| ''\)/.test(js));
check('los datos capturados se ven como palabras («Ocasión»), no como variables', (js.match(/fila\(etiquetaDato\(k\)/g) || []).length === 2 && /ocasion: 'ocasión'/.test(js));

// El riel: cinco secciones. Lo demás vive dentro de un área, como pestañas; nada se quitó.
const rielNuevo = html.slice(html.indexOf('<nav class="nav">'), html.indexOf('</nav>'));
const enRiel = [...rielNuevo.matchAll(/class="rb[^"]*" data-view="([a-z]+)"/g)].map((m) => m[1]);
check('el riel tiene cinco secciones', enRiel.join(',') === 'today,inbox,calendar,clientes,analysis', enRiel.join(','));
const areas = js.slice(js.indexOf('var AREAS = ['), js.indexOf('var AREA_DE'));
const dentro = [...areas.matchAll(/view: '([a-z]+)'/g)].map((m) => m[1]);
check('🪤 lo que salió del riel sigue a un clic: cada pantalla quitada está en un área', ['pipeline', 'seguimientos', 'ventas'].every((v) => dentro.includes(v) && html.includes(`id="view-${v}"`)),
  'una pantalla que no está ni en el riel ni en un área es una pantalla a la que no se llega');
check('cada área se abre en la pantalla que lleva su botón del riel', /\{ id: 'clientes', lbl: 'Clientes', subs: \[\{ view: 'clientes'/.test(areas) && /\{ id: 'analisis', lbl: 'Análisis', subs: \[\{ view: 'analysis'/.test(areas));
check('🪤 las pestañas nacen dentro del documento (si no, la cuenta de «Por etapa» no se encuentra)', /if \(h0\) h0\.after\(g\)/.test(js) && /if \(\$\('cuenta-pip'\)\)/.test(js));
check('el riel marca el área aunque se esté en una de sus pestañas', /enRiel = area \? area\.subs\[0\]\.view : view/.test(js));
check('la insignia de seguimientos gana a la cifra gris, que va en el mismo sitio', /\.rail \.rb \.badge:not\(:empty\)~\.cuenta\{display:none\}/.test(html) &&
  /id="badge-seg"><\/span><span class="cuenta" id="cuenta-cli">/.test(html));

// El panel de la conversación es el perfil: primero quién es y qué quiere; el formulario, detrás de «Corregir».
const panel = js.slice(js.indexOf('  function renderDetails() {'), js.indexOf('  // ---------- hoy ----------'));
check('el perfil al lado de la conversación dice qué quiere y lo que contó antes que nada editable',
  panel.indexOf('ficha-quiere') > 0 && panel.indexOf('Lo que contó') > 0 && panel.indexOf('Lo que contó') < panel.indexOf('<summary>Corregir datos'));
check('el formulario de la ficha vive detrás de «Corregir datos»', /<details class="corregir" data-k="corregir"><summary>Corregir datos<\/summary>[\s\S]*id="f-name"[\s\S]*id="del-btn"/.test(panel));
check('🪤 repintar el perfil no borra lo que se estaba escribiendo', /var borradores = borradoresDelPerfil\(c\.id\)/.test(panel) && /devolverBorradores\(borradores\)/.test(panel) &&
  (panel.match(/data-borrador/g) || []).length >= 5, 'llega un análisis cada pocos segundos y repinta el panel entero');
check('🪤 y tampoco pierde el aviso de «¿es la misma persona?» ni los botones de archivar', /renderDuplicates\(state\.dups\.list\)/.test(panel) && /bindArchive\(\)/.test(panel));
check('en el celular, del perfil se vuelve a la conversación', /id="back-chat"/.test(panel) && /\.volver-chat\{display:none\}/.test(html));

// — Tarjetas más simples (2026-10-21): cada pieza sale solo si dice algo.
const tarjetaJs = js.slice(js.indexOf('      var tarjeta = function (c) {'), js.indexOf('      $(\'board\').innerHTML = stages.map'));
check('la tarjeta enseña el puntaje solo si es un caliente', /esCaliente\(c\) \? scoreChip\(c\) : ''/.test(tarjetaJs) && (tarjetaJs.match(/scoreChip\(/g) || []).length === 1);
check('el próximo paso sale en la tarjeta solo si urge o es una cita', /c\.proximo\.urgente \|\| c\.proximo\.tipo === 'cita'/.test(tarjetaJs));
check('🪤 el paso va en su propia línea (compartiendo fila con «Mover…» quedaba en «Atender: l…»)', /'<div class="paso-linea">' \+ paso/.test(tarjetaJs));
check('la tarjeta ya no lleva la fila del canal', !/channelIcon\(/.test(tarjetaJs) && !/class="pie"/.test(tarjetaJs));
check('🪤 «Mover…» sigue en cada tarjeta: en el celular no se puede arrastrar', /moveTo\(c\)/.test(tarjetaJs) && /<select class="card-move" aria-label="Mover a /.test(js),
  'quitarlo deja el tablero sin forma de mover nada desde el teléfono (diseno-tablero.md, 2026-09-21)');
check('y compacto, al pie, con 44 px al tacto', /\.card \.cifra \.card-move\{width:auto;max-width:104px/.test(html) && /@media \(pointer:coarse\)\{\.card \.cifra \.card-move\{min-height:44px/.test(html));
check('🪤 sin precios sale UNA cifra que lleva a cargarlos, no dos «Sin precios»', /cifra\('abierto', 'Valor en juego'/.test(js) && /\$\('pip-precios'\)\.onclick = function \(\) \{ go\('knowledge'\); \}/.test(js));
check('🪤 la insignia de seguimientos se pide con las cuentas, no solo al entrar a Seguimientos', /pintarListas\(\);\s*api\('\/seguimientos'\)\.then\(pintarInsigniaSeg\)/.test(js));
check('🪤 un archivo que ya se borró dice que ya no está, no que algo falló', /estado === 404 \? 'Esta foto ya no está guardada'/.test(js) && /estado === 404 \? 'Ese archivo ya no está guardado\.'/.test(js));
const agenteJs = readFileSync(new URL('../agent/agent.ts', import.meta.url), 'utf8');
check('🪤 una respuesta rápida que solo se propuso no cuenta como usada', /if \(!acompana\) anotarUso\(rapida\.respuesta\.id\)/.test(agenteJs));

console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
