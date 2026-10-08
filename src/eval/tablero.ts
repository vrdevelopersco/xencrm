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
for (const clase of ['propuesta', 'login', 'detail-more', 'adj-listo']) {
  const ponenDisplay = new RegExp(`\\.${clase}\\{[^}]*display:`).test(html);
  const seApagan = new RegExp(`\\.${clase}\\[hidden\\]\\{display:none`).test(html);
  check(`🪤 .${clase} se esconde de verdad cuando lleva [hidden]`, !ponenDisplay || seApagan,
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

console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
