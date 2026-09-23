# Bitácora de arreglos

Qué se arregló, qué fallaba y cómo se comprobó. Lo más nuevo, arriba. Cada entrada lleva su commit
(`git show <commit>` muestra el cambio completo). El arreglo se commitea primero y su entrada después, con el hash
ya definitivo.

El detalle técnico vive en [`arquitectura.md`](arquitectura.md), lo del tablero en
[`guia-del-tablero.md`](guia-del-tablero.md) y las reglas de diseño en [`diseno-tablero.md`](diseno-tablero.md).

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
