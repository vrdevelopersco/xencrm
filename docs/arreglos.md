# Bitácora de arreglos

Qué se arregló, qué fallaba y cómo se comprobó. Lo más nuevo, arriba. Cada entrada lleva su commit
(`git show <commit>` muestra el cambio completo). El arreglo se commitea primero y su entrada después, con el hash
ya definitivo.

El detalle técnico vive en [`arquitectura.md`](arquitectura.md), lo del tablero en
[`guia-del-tablero.md`](guia-del-tablero.md) y las reglas de diseño en [`diseno-tablero.md`](diseno-tablero.md).

## 2026-10-12

### El calendario de una sede ocupa solo esa, y quien se crea a mano llega a una · `b45bbfb`
El calendario personal ocupaba todas las sedes. Ahora cada sede puede tener el suyo en `CALENDAR_BUSY_ICS_<SEDE>`,
que solo ocupa esa; el general sigue ocupando todas. 🪤 En el `.env`, no en la configuración: son direcciones
secretas. El tablero pinta los bloques de la sede que se mira. Y crear a mano a una persona ahora pregunta a qué sede
llegó, para que no salga «sin sede» en Prospectos. Visto en Chrome con un calendario de Buenavista servido por HTTP.

### La consola ya no grita «no contesta» por una dirección que nadie configuró · `9554254`
Cualquier estado de la dirección pública distinto de «ok» era «Su dirección pública no contesta», urgente: también
no tenerla configurada y una falla suelta que la instancia todavía no da por caída. Ahora solo «caída» es ese ticket,
«contesta desde otro servidor» se dice así, y lo demás no es ticket. Cuatro casos nuevos en `pnpm test:consola`.

### A un «hola» no se le contesta «dame un segundito que lo consulto» · `eebcd58`
El aviso de demora salía siempre que el turno iba al pesado, también cuando iba ahí porque el otro motor estaba
caído: un saludo recibía «dame un segundito que lo consulto». Ahora sale solo si el pesado es por lo que pidió el
cliente. Salió en el «¿por qué?» de una conversación de prueba sin OpenAI.

### La fecha del formulario de agendar, como los demás campos · `ff21b08`
El campo de fecha quedaba suelto al lado de su etiqueta, sin el borde de los selectores. Ahora mide y se ve igual.

### El recordatorio cuenta los días en la hora del negocio · `bc7771c`
🪤 El día de la semana salía de `getDay()`, en la hora de la máquina. En un servidor en UTC, un recordatorio a las
7:30 p. m. de Bogotá ya es el día siguiente, y un domingo cerrado pasaba por un lunes abierto. Ahora se cuenta en la
hora del negocio; probado con `TZ=UTC`. De paso, el recordatorio a mano decía «La conversación la lleva bot» cuando
el traspaso lo hizo el asistente, y el README seguía diciendo que el recordatorio sale el día antes a las 5 p. m.,
cuando desde el 3 de octubre sale la mañana de la cita. Las dos pruebas nuevas fallan con el código de antes.

### Los escenarios de DUNOR esperan la cancelación de hoy · `c1d4c67`
Dos turnos de los escenarios esperaban «¿confirmas que cancelo?», que dejó de existir el 3 de octubre con la
retención de citas. Ahora esperan la pregunta de qué pasó y la cancelación cuando el cliente insiste. Con Gemma,
40 de 40.

### Una clave o una tarjeta escrita en el chat no se guarda ni llega al modelo · `ce06a07`
«Mi clave es 4567, no puedo entrar» quedaba en claro en el CRM y se le mandaba a OpenAI; el tapador que existía solo
corría en los chats importados. Ahora una clave, un PIN, un código de verificación, una llave o una tarjeta se tapan
antes de que nada los lea, y otra vez al guardar cualquier mensaje. El asistente le pide al cliente, con tacto, que
no los mande por el chat. 🪤 No sirve el tapador de los importados: también tapa «Correo:» y borraría el correo de
la cita. Una tarjeta se reconoce por longitud, red y dígito de control juntos. `pnpm test:claves` (21 casos).

### Cada respuesta con su «¿por qué?», y la versión que corre a la vista · `fa9fb3f`
«¿Por qué le contestó eso?» se contestaba con logs que se perdían al reiniciar. Ahora cada mensaje corre en un turno
que se guarda 90 días: qué entendió, la ruta, el motor y el modelo, cuánto tardó, qué guardas saltaron, cuánto costó,
la huella del prompt y la versión. Sus llamadas al modelo y sus mensajes llevan el mismo id, que viaja solo con
AsyncLocalStorage. Quien administra tiene **¿por qué?** debajo de cada respuesta. 🪤 El análisis que deja
programado un turno corre fuera de él, para que su gasto no se le cargue a esa respuesta. La versión sale de git o
del `version.json` que ahora deja `pnpm paquete`, y la dicen `/_salud`, el lanzador, la consola y cada turno.
`pnpm test:turnos` (20 casos) y visto en Chrome con una conversación real contra Gemma.

### Varias sedes con un mismo número · `dba1be5`, `4bc5cf7`, `387fd4f`
Un negocio con varias sedes y un solo WhatsApp tenía que escoger entre varios números o un asistente que no sabe a
cuál mandar a cada quien. Ahora las sedes van en su configuración, con nombre, dirección, apodos y, si cambia, su
propio horario y cupo. El asistente pregunta en cuál antes de ofrecer horarios, entiende «la del norte» o «la de la
72», ofrece los espacios de esa sede y, si lo pedido no existe ahí pero sí en otra, lo dice y ofrece la otra. La
confirmación, el recordatorio y el calendario dicen la dirección, y el modelo ve las sedes para «¿dónde quedan?».
En el tablero, el calendario y Prospectos filtran por sede, agendar a mano la pide y se editan en El negocio. 🪤 Una sede no es
otro cliente; si el mensaje nombra dos sedes se vuelve a preguntar, y una sede con citas por delante no se puede
quitar. Al probarlo en Chrome salió que «la del centro comercial» nombraba también a «la del centro»: ahora vale el
apodo más largo. `pnpm test:sedes` (49 casos, sin modelo) y visto en escritorio y celular.

### En el celular, el panel de agendar ya no tapa las citas · `ed54349`
En el calendario del celular, la lista de citas podía quedar más baja que su contenido y el panel de agendar se
montaba encima: del día se veía la primera cita a medias. Ya pasaba antes de las sedes; salió al revisarlas. Con
las filas al alto de su contenido, medido en Chrome en Agenda y en Semana, el calendario termina antes del panel.

### Cada cliente con su tope de gasto de IA, y nadie sin respuesta al llegar · `148e438`
El gasto se medía pero nada lo frenaba, y es lo primero que pregunta quien pone su propia llave de OpenAI. Ahora cada
cliente tiene un tope en dólares al mes, que pone el super-admin en Configuración › Motores y se aplica al instante.
Al 80 % avisa por la campana, la consola y WhatsApp; al 90 % lo específico pasa al modelo barato; al 100 % no sale
ni una llamada a la IA de pago, lo que se resuelve sin IA sigue y lo demás pasa al equipo con aviso al cliente. Si
hay un motor en la máquina, contesta ese. 🪤 Mes calendario en la hora del negocio, no los últimos 30 días, y el
freno de último recurso está en el motor, para que ningún camino olvidado se lo salte. `pnpm test:presupuesto` (52
casos, cada llamada contada) y visto en Chrome en escritorio y celular: la tarjeta, guardar desde ella, el panel de
Consumo del tablero y la campana.

### La sigla del cliente vuelve a salir cuando su logo no carga · `abffeb4`
El respaldo del logo en la lista de clientes armaba su `onerror` con las comillas de `JSON.stringify` dentro de un
atributo con comillas: el navegador no lo podía leer y quedaba la imagen rota. Salió al revisar la consola en Chrome
para el tope: un cliente sin archivo de logo daba «Unexpected end of input». Escapado, sale la sigla y ningún error.

### Lo que las reglas prohíben ya no lo respaldan, y la plata no se promete · `459ea37`
🪤 Las guardas de «no inventa» medían el respaldo contra la persona entera, y la persona nombra wifi, parqueadero,
mascotas, descuentos y envíos como ejemplos de lo que no se supone. Esas palabras respaldaban: «¿tienen wifi?»
contestado con «Sí, tenemos wifi» pasaba en producción desde el primer commit, y las pruebas no lo veían porque
medían contra la información sola. Ahora el respaldo es lo que se sabe del negocio. Encima, lo que pide el brief
de agentes sobre inyección de prompt: un descuento, un porcentaje, algo gratis o un precio regateado que la
información no ofrece no sale, una respuesta que recita las instrucciones se cambia por una fija, y el nombre y la
información entran como datos. `pnpm test:inyeccion` (65 casos) pasa el recorrido entero con un modelo falso que
siempre se deja convencer; quitar cualquiera de las cinco defensas la hace fallar. Sobre 93 respuestas reales de
DUNOR, HRC y CONFIA, ninguna queda marcada de más. Escenarios de DUNOR con Gemma, porque OpenAI no estaba
disponible: 38 de 40, y los dos que fallan ya fallaban (la retención de citas del 3 de octubre cambió el texto de
cancelar).

### WhatsApp oficial no atiende dos veces lo que Meta manda dos veces · `2bf1951`
Meta advierte que una notificación puede llegar más de una vez y reintenta durante días. El mismo «hola» entraba
dos veces y se contestaba dos veces, o se volvía un «hola\nhola». El id de cada mensaje queda 7 días en la base, no
en memoria, porque un despliegue es justo cuando Meta reintenta. De paso, en «Mira» y «Propone» el canal ya no
marca leído, no muestra «escribiendo…» ni contesta «solo puedo leer texto», igual que WhatsApp por QR. Baileys
queda fuera a propósito: no hay repetidos en las bases y puede entregar el mismo id al descifrar.
`pnpm test:repetidos` (18 casos, contra la ruta de verdad y con firma de Meta).

## 2026-09-25

### Con quién firmas es de cada cliente, y varias personas caben en un chat · `d93506e`
🪤 El nombre con el que se responde era **uno solo para todos los clientes**: poner "Arthur" atendiendo a la
boutique lo dejaba firmando en la financiera. Ahora vive dentro de la conversación y se guarda por cliente. De
paso, el botón de la cuenta dice tu nombre y abre Mi cuenta, y el correo de cada quien se edita en la fila de su
cliente. Y lo nuevo: la conversación lleva **quiénes están metidos ahora mismo**, en la consola y en el tablero,
con aviso de «Camila también está aquí»; no bloquea a nadie, avisa. Caduca sola a los 3 minutos porque quien
cierra la pestaña no avisa. `pnpm test:presencia` (13 casos) y comprobado sobre el paquete con dos personas.

### Cada cliente se estira con su micro-tablero y su equipo · `fd085a2`
La fila decía qué atender pero no cómo iba el negocio: ahora **Ver más** abre mensajes de hoy, conversaciones,
calientes, puntaje promedio, cuántas llegaron a cita, cuántas se ganaron, efectividad y gasto de IA. La
efectividad se calcula por el **papel** de las etapas (`cita`, `ganado`), no por su nombre, que cada negocio las
llama distinto. Debajo, quién lo atiende, con cambiar clave, quitar y asignar a la mano.

### El tablero ya no pide token entrando por la consola, y no se moría al cargar · `d907f47`
Dos cosas encadenadas. El tablero, sin token guardado en el navegador, ni lo intentaba: enseñaba su pantalla de
token, aunque entrando por la consola no hace falta ninguno. Y peor: el diálogo de configuración había quedado
**después** del `<script>`, así que `$('cfg-cerrar').onclick` reventaba con null y se caía el JavaScript entero
del tablero. Lo que se veía era la pantalla de token porque no arrancaba nada.

🪤 El HTTP daba 200 y el HTML era correcto: ninguna prueba lo vio. Salió abriendo la página en un navegador de
verdad con la sesión puesta, con `node herramientas/mirar.mjs`, que imprime los errores de JavaScript. Una
pantalla nueva no está probada hasta que se abre en un navegador.

### El tablero del cliente, con el lenguaje de la casa · `2270c30`
Se pasaba de la consola a un tablero verde con vidrio esmerilado y se sentía otra aplicación. Cambiado por los
tokens, no regla por regla: acento dorado, papel cálido, Figtree, y el vidrio de 24 px de desenfoque a 14. El
verde se queda donde significa algo. Contrastes en `docs/diseno-tablero.md`.

### Perfil y El negocio se abren en un modal · `a4627c1`
Eran dos páginas largas a las que había que navegar. Son configuración: ahora un modal de dos pestañas encima de
lo que estabas haciendo, con los campos cortos en dos columnas.

### Atender es un tablero por columnas · `a67eeb6`
La bandeja era una lista donde todo pesaba igual. Ahora tres columnas —piden una persona, no supo, esperan
respuesta— con su cuenta, lo que más ha esperado arriba, y la conversación en un panel al lado.

### La consola y la portada, con la marca de HRC · `26183ff`, `f99de66`
La portada salió calcada de otros sitios de la casa y en oscuro; rehecha en claro con Figtree, el dorado y el
logo. La consola iba por su lado: entrar es una pantalla partida, y los clientes pasan de tarjetas a filas con su
vistazo.

🪤 De ahí salieron dos trampas de CSS que dan el mismo síntoma: un `display` suelto le gana al `display:none` que
el navegador pone en `[hidden]` y en un `<dialog>` cerrado. Está en `docs/diseno-tablero.md`.

### Mi cuenta, y usuarios con correo · `7d52b8c`
Para cambiar una clave había que ser super-admin. Ahora cada quien se cambia su nombre, su correo y su clave
—pidiendo la actual—, y quien tenga correo puede entrar con él.

### El empaquetador borra solo lo que él crea · `9934d5f`
`pnpm paquete` barría `paquetes/` entera y se llevó por delante unas credenciales que había dejado ahí. Ahora
borra su directorio de trabajo y el zip, nada más. Las credenciales de la máquina viven en `~/aiva-credenciales`.

### La configuración de cada cliente se edita desde el tablero · `4afb5eb`
Nombre, asistente, marca, zona horaria y citas salían del archivo a mano. Se validan con el mismo esquema con el
que se leen al arrancar, se guarda copia del anterior, y como la configuración se lee al arrancar, el tablero
avisa que hay cambios sin aplicar y ofrece reiniciar donde hay quien lo levante.

### El tablero de cada cliente se abre desde la consola · `d16085e`
Entrar como super-admin y que el cliente pidiera otro token rompía el modelo. La consola sirve el tablero en
`/c/<slug>/admin` y le pone el token al pasar; la sesión viaja en una galleta porque una navegación y un
EventSource no pueden poner cabeceras.

## 2026-09-24

### Una portada en la raíz, y la consola en /consola · `becf4b0`
El dominio pelado mostraba la consola: quien llegaba se topaba con una pantalla de trabajo pidiendo clave. Ahora
la raíz explica qué es aiva y la consola vive en `/consola`; la sirve el enrutador mismo, sin proceso extra, y las
llamadas de la consola siguen saliendo de la raíz. Salieron tres cosas más al probar el paquete: un cliente
llamado "consola" o "api" habría quedado tapado por el enrutador (ahora se rechaza al crear); los motores
arrancan en OpenAI solos, porque en un hosting de apps no hay Ollama y una variable olvidada dejaba al cliente
esperando un modelo que no existe; y **WhatsApp arranca apagado**, que antes los tres clientes escupían el QR al
primer arranque. Comprobado con el ZIP descomprimido aparte: `/`, `/consola` y `/<cliente>/health` dan 200,
`/dunor/admin` carga su JavaScript y lo que no existe da 404. `pnpm test:clientes` con dos casos nuevos.

🪤 Lo que costó media hora: una prueba anterior seguía viva en el 3500 y las peticiones le llegaban **a la
vieja**, que no conocía a dunor. El paquete estaba bien desde el principio. Antes de probar,
`lsof -ti :3500 | xargs -r kill -9`.

## 2026-09-22

### El embudo lo pone cada negocio · `0a03709`
Las etapas estaban fijas en el código ("cita_agendada", "vendido"): con eso, una financiera o una litografía
entraban con el embudo de una boutique. Ahora salen de `crm.stages`, con un **papel** por etapa (inicio, activo,
interés, cita, ganado, perdido) que es lo único que el código conoce; los nombres los pone el negocio. Sin etapa
de "cita", simplemente no agenda. El tablero pinta por papel y esconde los filtros que no apliquen, y una ficha
con una etapa que ya no existe cae a la primera sin romperse. El alta arranca preguntando **cómo atiende el
negocio** con tres plantillas —citas, soporte y cotización—, cada una con su embudo, si agenda y qué datos
captura. `pnpm test:etapas` (14 casos con un negocio de soporte), `test:clientes` (8 nuevos) y las 27 suites; el
tablero de DUNOR quedó idéntico.

### Del historial también sale cómo hablan sus clientes · `ee73db8`
Segundo paso: además de las preguntas, del historial salen las frases que sus clientes usan y el asistente no
entiende. Las fechas a la colombiana se agrupan por **la frase de tiempo**, no por el mensaje, así que "¿me pueden
atender de hoy en quince?" y "paso de hoy en quince entonces" son una sola cosa que enseñar; y las palabras que
repiten y no están en el catálogo, el perfil ni el diccionario se proponen aparte ("terno"), con las de tiempo
filtradas para que "quince" no parezca un producto. Nada se aprende solo: pasan a *Frases que no entendimos*, donde
alguien les pone el significado y solo se guardan si con eso las reglas ya entienden. Probado de punta a punta:
propuso "terno", al enseñarlo las reglas pasaron a leer "¿tienen terno para grado?" como una pregunta por el
catálogo. `pnpm test:historial` (29 casos) y 29 suites.

### Aprender del historial: las preguntas, no los precios · `46807cf`
Un cliente nuevo llegaba con el Perfil en blanco aunque tuviera meses de WhatsApp conversado. Ahora ese historial
se puede traer —el `.txt` de "Exportar chat" o la sincronización al vincular el número— y de ahí salen **las
preguntas que más le hacen** (agrupadas por las palabras que comparten: "¿hay parqueadero en la tienda?" y
"¿tienen parqueadero por ahí?" son un solo tema) y **una muestra del tono**, que descarta entera cualquier
respuesta con cifras. Aceptar un tema lo escribe en el Perfil como dato *por confirmar*: el historial pone la
pregunta, el negocio pone la respuesta de hoy. El historial vive en su propia tabla y **nunca** entra al índice de
conocimiento, que es lo que evita repetir un precio vencido con autoridad. `pnpm test:historial` (23 casos) y
probado con un chat exportado: agrupó los 3 "trajes para matrimonio" y los 2 "parqueadero", dejó el precio fuera
del tono y el Perfil pasó de 12 a 13 pendientes.

### Dar de baja un cliente sin dejar usuarios a la deriva · `191c3c4`
No había cómo dar de baja un tenant y, peor, si lo hubiera habido sus usuarios quedaban atendiendo a un cliente que
ya no existe. Ahora dar de baja lo saca del índice y **guarda** su carpeta en `clientes/_dados-de-baja/` (base,
conversaciones, WhatsApp: no se borra nada), y en el mismo acto limpia a sus usuarios: a quien atendía solo a ese
cliente se le desactiva el acceso —no tendría nada que ver— y queda listado en Equipo para reasignarlo. Al
super-admin no se le toca, que su lista vacía significa "todos". Y asignar un cliente que no existe se rechaza al
crear y al editar un usuario. `pnpm test:usuarios` (37 casos) y probado de punta a punta.

### La consola también atiende, y cada quien ve solo sus clientes · `a907db9`
La consola servía para mirar, no para trabajar. Ahora **Atender** junta en una sola bandeja lo que espera a una
persona en todos los clientes y se responde ahí mismo: la consola habla por el cliente con su token, así que no hay
que abrir cinco tableros ni repartirlos. Y entra cada quien con su usuario y su clave: el super-admin ve y atiende
todo y maneja el equipo; quien atiende un cliente solo ve —y solo le suena— lo de ese cliente (bandeja, estado y
proxy filtrados; 403 si intenta otro). Cuando entra algo nuevo de los tuyos suena un pito, el número queda en el
título y en segundo plano sale notificación del navegador. `pnpm test:usuarios` (25 casos), `test:consola` (26) y
28 suites. Probado de verdad: una pregunta de un cliente de CONFIA FINTECH respondida desde la consola le llegó a
su chat, y el usuario de soporte de HRC recibe 403 al intentar ver CONFIA.

### Consola del super-admin · `7272210`
Con varios clientes hacía falta verlos a todos y poder dar de alta uno nuevo. `pnpm consola` muestra una tarjeta
por cliente con su prioridad, sus números y **tickets que salen solos del estado** (instancia caída, dirección
pública caída, WhatsApp pidiendo código, preguntas sin responder, gente esperando, citas sin resultado), ordenados
por urgencia × prioridad. El alta es del super-admin, desde ahí: crea carpeta, token y puerto, y dice qué falta;
arrancar la instancia sigue siendo pm2, a propósito. Escucha solo en 127.0.0.1 porque tiene la llave de todos los
tableros. `pnpm test:consola` (21 casos) y probada contra la instancia real de DUNOR: destapó de una que el túnel
se había vuelto a caer.

### Varios clientes en la misma máquina · `a4754dc`
Para atender negocios distintos (boutique, financiera, litografía) hacía falta poder montar varios sin que se
puedan mezclar. Quedó **un proceso por cliente**, no una base compartida: cada uno en `clientes/<slug>/` con su
configuración, su base, su WhatsApp, su token y su dominio, y lo compartido de la máquina (claves de OpenAI,
Ollama) una sola vez en el `.env` de la raíz. `pnpm cliente` da de alta, lista con estado, y genera el pm2 y el
túnel. Comprobado con dos instancias a la vez: DUNOR con sus 10 contactos y una financiera nueva en 0, y el token
de una devuelve 401 en la otra. `pnpm test:clientes` (21 casos).

### El asistente sabe que ya venías hablando por el otro canal · `114f571`
Empezaba la gestión por el chat del sitio y en la tarde escribía por WhatsApp: para el cliente es la misma
conversación, pero aiva lo saludaba como a un desconocido y le preguntaba todo otra vez. Ahora, cuando el número
coincide con otra ficha suya, la conversación de allá entra en el contexto y lo dice una sola vez: *"Hola, Marta 🙂
Vi que veníamos hablando por el chat del sitio; ya me puse al tanto"*, y sigue respondiendo con lo que ya sabía (el
traje, la ocasión, la cita). El equipo lo ve en la campana y une las fichas con un botón. **No se unen solas**: cada
ficha es la historia de su canal y esa decisión es de una persona.

De paso, dos muletillas que las reglas no entendían: preguntar por la cita ("¿a qué hora era?", "¿sigue en pie?")
lo ponía a ofrecer cambiarla en vez de responder, y "cámbiala" con tilde no la reconocía ninguna regla.
`pnpm test:cross` (12 casos), `pnpm test:booking` (4 nuevos), 24 suites y escenarios con OpenAI real: 40/40.

### "El jueves" es el de esta semana · `1ca28cb`
Un día de la semana suelto era un filtro abierto —cualquier jueves—, así que si ese jueves estaba lleno el
asistente ofrecía el de la semana siguiente sin avisar, cuando el cliente estaba hablando de esta. Ahora "el
jueves" es el jueves que viene de esta semana, salvo que diga otra cosa ("el otro jueves", "el jueves de la
próxima"), y dicho el mismo día de la semana es el de la otra, porque para hoy se dice "hoy". Con ese día lleno
responde "El jueves ya no me quedan espacios 😕 Lo más cercano que tengo:" y ofrece alternativas. "Entre semana"
no se ancla, que es una disponibilidad y no un día.

También quedó la trazabilidad entre canales: la cita se queda en la ficha donde se agendó —ahí está su historia— y
lo que se haga desde el otro canal se anota en las dos líneas de tiempo ("Cancelada por el cliente desde
WhatsApp"). Y la prueba de citas dejó de escribir en la base del negocio: corre con su propia agenda temporal.
`pnpm test:when` (6 actualizados), `pnpm test:booking` (el día lleno), `pnpm test:merge` (5 nuevos) y escenarios con
OpenAI real: 40/40.

### La cita vale en los dos canales, y preguntar por ella no la mueve · `7c6ca72`
Ensayando el demo completo (chat del sitio + WhatsApp) salieron dos fallas seguidas, las dos visibles para el
cliente:
- Agendó por el chat del sitio y escribió después por WhatsApp: como esa ficha era nueva, el asistente le ofreció
  horarios como si no tuviera cita y la habría dejado con dos. Ahora busca la cita también en las otras fichas de
  la misma persona (mismo número, otro canal), aunque todavía no se hayan unido.
- "¿me confirmas la cita del jueves?" nombra el día de su propia cita y el flujo lo leía como "muévela". Ahora eso
  es una pregunta por la cita ("Ya tienes tu cita del jueves… ¿quieres cambiarla o cancelarla?"); pedir otra hora
  del mismo día sigue moviéndola.

`pnpm test:booking` (2 casos nuevos), `pnpm test:merge` (3 nuevos) y el ensayo repetido de punta a punta. De paso,
la prueba de posponer dejó de depender del milisegundo exacto.

### El puntaje se enfría solo, y los pesos calibrados con lo que pasó · `29645de`
El puntaje solo se recalculaba al llegar un mensaje, así que quedaba congelado en su mejor momento: en la base real
había tres fichas en 100 con once y doce días sin hablar, y una en 87 de hace doce días. Así la lista de calientes
no sirve para decidir a quién llamar hoy.
- Ahora envejece al leer la ficha: 3 días −10, una semana −25, dos semanas −40, con el motivo a la vista. Con cita
  agendada o ya vendido no se enfría, porque el siguiente paso ya está puesto.
- La ficha guarda el puntaje de la conversación y lo dice ("llegó a 65 cuando hablaron"); "Calientes sin
  seguimiento" se arma con ese, que es justo lo que hay que retomar, y ya no repite a quien está esperando el
  resultado de una cita pasada.
- Los pesos son un **estimado** con las 10 conversaciones reales (3 con cita, 1 venta): pedir cita, el interés y el
  afán son lo que aparece antes de una cita; dar el nombre (5→2) y preguntar precio (10→6) aparecían igual o más en
  los que no agendaron, y los datos capturados pasaron de 6 cada uno a 4, 3, 2, 1 porque cuatro datos saturaban el
  100 y nadie se podía ordenar. Se afinan cuando haya ~20 citas con resultado.
- `pnpm rescore` pasa las fichas viejas a la escala nueva con los análisis ya guardados, sin llamar al modelo.

Medido sobre una copia de la base real: los tres con cita quedan en 92/89/83 (antes 100/100/100), el vendido en 75
y el prospecto de hace 12 días pasa de "87 caliente" a "40 tibio, llegó a 65". `pnpm test:score` (25 casos) y las
23 suites en verde.

### Llevarse los contactos y las citas en CSV · `e5f1ac3`
Los datos son del negocio y no había forma de sacarlos sin abrir la base a mano. Análisis tiene ahora **Contactos
(CSV)** y **Citas (CSV)**, con separador ";" y BOM (lo que Excel en español abre bien de una vez), la etapa con su
nombre, puntaje y temperatura, qué busca, ocasión, fecha del evento, etiquetas y notas; las citas van con cliente,
teléfono, estado, lugar y cómo fue el recordatorio. Los archivados no salen y la descarga manda el token en la
cabecera, no en la dirección, para que una URL copiada no se lleve el acceso. `pnpm test:export` (14 casos, con
notas que traen comillas, ";" y saltos de línea) y probado en el tablero y por HTTP: 51 filas, 401 sin token.

### Calientes sin seguimiento: escribirles y poder posponer · `04f5a1f`
La lista solo listaba: no había qué hacer con ella, así que los mismos nombres volvían todos los días y dejaba de
mirarse. Cada fila tiene ahora **Escribirle** —abre la conversación, se la pasa a la persona y deja un borrador
armado solo con lo que el cliente dijo (prenda, ocasión), sin precios ni fechas, para revisarlo antes de enviar— y
**Dejarlo por ahora**, que lo pospone una semana sin perder lo capturado y lo anota en la línea de tiempo; si el
cliente escribe antes, vuelve enseguida. `pnpm test:followup` (11 casos) y probado en el tablero: el borrador salió
con nombre, prenda y ocasión, y posponer bajó la lista de 3 a 2.

### Negativas suaves: las que no dicen "no" · `58f4549`
La guarda contra negativas inventadas solo veía el "no" explícito y junto a lo preguntado. Se le escapaban "Zapatos
no tenemos" (al revés), "Eso no lo manejamos" (sin nombrarlo), "Lo más parecido que manejamos es…", "Por ahora solo
manejamos trajes" y "En su lugar te ofrecemos…": la misma deducción que puede ser falsa, dicha con más tacto. Ahora
se busca frase por frase en cualquiera de esas formas, y la cortesía no cuenta ("no hay problema"). Comprobado con
`pnpm test:guards` (5 casos nuevos, 28 en total), 8 respuestas buenas del histórico que siguen pasando derecho y los
escenarios con OpenAI real: 40/40.

### Escribirle al cliente y buscar dentro de los mensajes · `eaa6d57`
El buscador de Conversaciones solo miraba nombre, teléfono y resumen: lo que el cliente dijo ("esmoquin azul", "para
el 12") no aparecía. Ahora busca también dentro de la conversación y cada fila trae el pedacito donde aparece, con
quién lo dijo y lo buscado resaltado. Y el teléfono de la ficha era texto muerto: ahora tiene **Escribirle por
WhatsApp** y **Llamar**. El número se arma igual que para unir fichas (el que dejó o el de su dirección de
WhatsApp, con indicativo), y esa función quedó en un solo lugar: el recordatorio a mano ya no puede armar un wa.me
con un número local sin indicativo. `pnpm test:buscar` (14 casos) y probado en el tablero: «esmoquin» dio 14
conversaciones con su fragmento resaltado y la ficha abrió wa.me/573005551234 y tel:+573005551234, con botones de
44 px.

### Archivar y borrar conversaciones · `33e7083`
Las pruebas, los equivocados y el spam solo se podían limpiar por código, así que ensuciaban listas, embudo y
números. La ficha ahora tiene **Archivar** (sale de las listas, del embudo y de las cuentas sin perder nada; vuelve
sola si el cliente escribe; filtro «Archivados» para verlas y devolverlas) y **Borrar** (se lleva ficha,
conversación, citas, análisis, eventos, verificaciones y consumo; pide confirmación porque no se deshace, con el
respaldo diario como red). `pnpm test:archive` (10 casos) y probado en el tablero: archivar bajó la lista de 51 a
50, el filtro mostró las archivadas y borrar limpió la ficha.

### Unir fichas de la misma persona · `9a0d2e5`
Si alguien escribía por el chat del sitio, dejaba su número y después escribía por WhatsApp, quedaban dos contactos,
dos historias y dos puntajes. La ficha ahora muestra "¿Es la misma persona?" cuando otra tiene el mismo número
(aunque uno lo tenga en la dirección de WhatsApp y el otro lo haya escrito). Al unir, mensajes, citas, análisis,
eventos, verificaciones y consumo pasan a la ficha que se conserva —la del canal donde escribió más recientemente,
porque por ahí le llegan las respuestas—, con el nombre y el número que haya, la etapa más avanzada, las etiquetas
de ambas y una nota de la unión. No se puede deshacer, así que se pide confirmación (el respaldo diario es la red).
`pnpm test:merge` (12 casos) y probado en el tablero: dos fichas de "Marta" quedaron en una con sus 3 mensajes.

### Calendario en el celular · `04f5c19`
La semana (siete columnas) medía 562 px en una pantalla de 390: tocaba desplazarse en horizontal, el selector
«Semana | Agenda» salía cortado, el rango de fechas ocupaba cuatro líneas y el formulario "Agendar cita" se salía.
Además, la fila de cada cita pedía 455 px porque sus seis elementos iban en una sola línea.
- En el celular el calendario abre en **Agenda** (una lista); lo que elijas se recuerda en ese navegador.
- La barra deja el rango en su propia línea, sin recortar el selector.
- Las filas de citas se parten en dos líneas y el formulario queda apilado, sin salirse.
- La pastilla del selector seguía marcando "Semana" aunque el modo fuera Agenda (solo sabía moverse en el switch de
  Conversaciones); ahora sigue al modo, con `aria-pressed`.
- Los botones pequeños (citas, avisos) pasan a 44 px con el dedo.

Comprobado en el servidor aislado a 390 px: nada se sale de la pantalla, y en escritorio la barra sigue en una
línea.

### Citas: fecha del evento, "sí" sin decir cuál y citas inventadas · `7e31cfd`
Repitiendo contra el código de hoy la conversación real del 21 (Arnulfo, por el chat del sitio) aparecieron tres fallas:
- "El evento es este viernes" arrancaba el agendamiento **el viernes**, el mismo día del evento. Ahora es un plazo:
  espacios antes del evento (`when.ts › eventDeadline`), en todos los pasos del flujo.
- En el paso del teléfono, una respuesta corta que no era un número sacaba del flujo y volvía a ofrecer horarios
  desde cero, perdiendo el elegido. Ahora vuelve a pedir el número.
- Con tres horarios ofrecidos, "Si" no se entendía y el modelo respondía "Te esperamos en la cita privada" **sin que
  existiera ninguna cita**. Ahora el flujo pregunta cuál, y una guarda (`claimsBooked`) rehace cualquier respuesta que
  dé por hecha una cita que no existe.

Comprobado: `pnpm test:booking`, `pnpm test:guards`, escenarios 40/40 y la conversación completa repetida, que
vuelve a terminar con la cita agendada.

### Hoy: «¿Cómo les fue?» para las citas que ya pasaron · `596237b`
Una cita pasada quedaba "confirmada" para siempre y el negocio nunca decía cómo terminó. Hoy lista las de los
últimos 14 días sin resultado, con **Vino**, **No vino** y **Compró** (esta última pasa el contacto a Vendido). Son
los resultados que hacen falta para calibrar el puntaje. Probado aislado.

### Respaldo diario de la base y token fuera de los registros · `48e73e4`
No había ningún respaldo: contactos, conversaciones y citas vivían en un solo archivo. Ahora una copia al día con
`VACUUM INTO` en `data/backups/` (las últimas 14, permisos 600, fuera de git), con "Respaldar ahora" en Agente.
Además, el token del tablero ya no se imprime completo al arrancar. Primer respaldo real: 452 KB, 10 contactos,
61 mensajes, 3 citas. `pnpm test:backup`.

### Modelo pesado solo para lo específico · `590ec51`
El modelo caro respondía por historial largo, varias preguntas o palabras sueltas ("para una boda", "mejor",
"presupuesto"), y "diseño a la medida" se confundía con pedir medidas. Ahora el pesado es solo para recomendar o
comparar, detalles de una prenda, medidas o tallas, una prenda pedida con características y su seguimiento corto.
Medido con las 8 conversaciones de DUNOR: 1 respuesta pesada de 15 (antes 5 de 14) y $0.0047 por conversación
(antes $0.0065). Las respuestas que pasaron al liviano se compararon lado a lado. `pnpm test:router`.

### WhatsApp oficial: API de Meta v26.0 por defecto · `fa058de`
v21.0 ya no aparece entre las versiones vigentes del changelog de Graph API.

### Análisis cuando la conversación hace una pausa · `0fcd15c`
Corría 2,5 s después de cada mensaje: con un cliente que escribe cada 20–40 s se pagaba un análisis por mensaje.
Ahora corre tras 60 s de silencio o, si la conversación sigue activa, a más tardar a los 5 minutos. Medido: 8
análisis en vez de 17 (−53 % en análisis, −19 % por conversación). `pnpm test:schedule`.

### Aviso cuando la dirección pública (el túnel) se cae · `ff25073`
El túnel rápido de Cloudflare se cerró esa mañana ("Tunnel not found") y nadie se enteró: sin él no funcionan el
chat del sitio, WhatsApp oficial, el calendario en Google/Outlook ni el tablero desde el celular. Ahora aiva se
llama a sí misma por `PUBLIC_URL` cada 5 minutos comparando un código único del proceso; tras 3 fallas seguidas
avisa en la campana, en Hoy y en Canales, y avisa también cuando vuelve. `pnpm test:public`.

### Celular: botón «Más» en la barra de abajo · `d1f13e2`
Perfil, Agente, Canales, Lo que sabe, Ayuda, el tema y Salir quedaban escondidos a la derecha, sin pista de que
había que deslizar. Ahora la barra lleva Hoy, Chats, Calendario, Prospectos y «Más», y ya no se desborda a 390 px.

### Guarda de negativas inventadas · `ce2d762`
"¿Venden zapatos?" → "No, no vendemos zapatos" era una deducción que podía ser falsa. Ahora un "no" sin respaldo se
rehace para que lo verifique; pasa si lo negado está en la información o si se apoya en el alcance del negocio
("somos moda masculina", que también cubre "para hombres"). Lo que el Perfil marca "por confirmar" nunca recibe sí
ni no. Probado en vivo con novia, zapatos, wifi y esmoquin. `pnpm test:guards`.

## 2026-09-21

### Tablero: sección Ayuda con tutorial rápido · `0b26b48`
Seis pasos que llevan a su pantalla, preguntas frecuentes y lo que el asistente nunca hace. La primera vez, Hoy
muestra un aviso que lleva ahí. «FAQ» pasó a llamarse «Lo que sabe».

### Documentación: guía del tablero, arquitectura y README al día · `0d6cfda`
Guía para el equipo del negocio, documento de arquitectura y README como puerta de entrada.

### Perfil del negocio y credenciales de Meta desde el tablero · `52abae0`
La información del negocio (dirección, horarios, pagos, precios, políticas y datos propios) se llena desde el
tablero y el bot la usa al instante; lo vacío queda "por confirmar" y no se lo inventa. Las credenciales de
WhatsApp oficial se verifican con Meta antes de guardarse y quedan en `.env`, no en la base ni en el repositorio.
`pnpm test:profile`, `pnpm test:meta`.

### Material del tablero y colores de dato · `ff49b97`, `2fd47a1`, `b353804`, `13cc8f4`, `cfe7d3a`, `107f4c6`
Con criterio de HRCAPOLO: marco de cartulina en las tarjetas del pipeline, campos hundidos, foco sólido que cumple
3:1 (antes daba ~1,9:1), «Mover a…» para cambiar de etapa sin arrastrar (en el celular arrastrar no funciona con el
dedo) y colores de dato (`--cita`, `--si`) separados del acento de marca. La temperatura pasó a los colores del
veredicto: el mismo 100 se veía rojo en la tarjeta y verde en la barra, y el rojo de "caliente" era el de "Perdido".

### La marca de cada cliente en el chat del sitio y la página de la cita · `a414572`
Color y logo por cliente, con el contraste ajustado solo (probado con 500 colores). `pnpm test:brand`.

### Recordatorio de la cita el día antes · `f533307`
Sale solo por WhatsApp (QR, u oficial dentro de las 24 h o con plantilla); lo que no puede salir solo queda en
Hoy › Recordar a mano con el texto listo. La respuesta del cliente queda como Confirmó o No puede.
`pnpm test:reminders`.

### Caché de OpenAI: información completa fija al inicio del prompt · `e763143`
Medido: con `gpt-5.4-mini` la caché solo pega cuando el inicio común pasa de ~1.450 tokens, y la persona sola
(~1.100) no alcanzaba. Si toda la información del negocio cabe, va entera después de la persona. Con la caché
caliente, una respuesta liviana bajó de $0.0015 a $0.0009.

### Muletillas del español que destapó el reporte · `159b780`
"a la hora del almuerzo", "en ocho días", "de hoy en quince", "el otro fin de semana" y, al elegir horario, "la que
sea" o "me da igual".

### Frases que no entendimos: reporte y expresiones del diccionario · `81f519e`
Lo que las reglas no entienden queda anotado y se enseña desde el tablero, solo si con eso ya se entiende.
`pnpm test:misses`.

### WhatsApp oficial: respetar la ventana de 24 horas · `0f59ca3`
Pasadas 24 horas desde el último mensaje del cliente, aiva no envía (ni guarda como enviado) lo que Meta
rechazaría, y el tablero lo advierte antes de escribir.

### Tablero en celular: "Chats" en la barra de abajo · `afe0834`
"Conversaciones" y "Calendario" quedaban pegados a 390 px.

### Primer commit · `92079c4`
El proyecto quedó bajo control de versiones (antes no lo estaba), con `.env`, la base y las claves fuera de git.
