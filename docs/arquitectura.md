# Arquitectura

Para quien va a cambiar el código. El README explica qué hace XENCRM y cómo configurarlo; aquí está cómo está hecho
y por qué.

## Principios

1. **Reglas primero, modelo de respaldo.** Lo que se puede resolver con código se resuelve con código: saludos,
   temas frecuentes, fechas y franjas, elegir de una lista, datos exactos (teléfono, correo, presupuesto). El modelo
   entra cuando las reglas no alcanzan, y lo que no entienden queda anotado para enseñárselo (ver "Aprender").
2. **El modelo nunca decide lo que tiene efecto.** Las citas, los cambios y las cancelaciones los hace un flujo
   determinista con confirmación. El modelo nunca elige una fecha ni dice "listo, cancelada".
3. **No inventar.** Guardas contra cifras, enlaces y afirmaciones sin respaldo. Lo que el bot no sabe lo dice y queda
   "por verificar" para el equipo.
4. **Todo lo del cliente en configuración.** Nombre, contacto, diccionario, perfil, marca, flujo de citas y campos
   del análisis. Nada propio de DUNOR vive en el código.
5. **Medir antes de afirmar.** Contraste, costo, caché y latencia se miden; los números del README salen de
   corridas reales.

## Recorrido de un mensaje

`src/agent/agent.ts › process()`, en orden:

0. **Claves y tarjetas** (`crm/secretos.ts › taparEnVivo`): una clave, un PIN, un código de verificación, una llave
   o un número de tarjeta se tapan antes de que nada los lea, y si había alguno se le pide al modelo que le diga al
   cliente, con tacto, que no los comparta. `appendMessage` vuelve a tapar al guardar, venga de quien venga el
   mensaje. 🪤 No es `taparSecretos`, el de los chats importados: ese también tapa «Correo:» y «Usuario:», y en vivo
   borraría el correo que el cliente deja al agendar.
1. **Contacto**: se crea o se actualiza (`touchUser`).
2. **Modo humano**: si una persona tiene la conversación, se guarda el mensaje, se agenda el análisis y no se
   responde.
3. **Flujo de cita en curso** (`crm/booking.ts › bookingStep`): si hay uno y el mensaje encaja, responde el flujo.
   Si no encaja, el flujo se pausa y sigue el agente. Una respuesta corta que no encajó queda en "frases que no
   entendimos".
4. **Cambiar o cancelar**: con una cita próxima y una intención clara ("ya no puedo ir", "pásala para el jueves"),
   responde el flujo de citas.
5. **Tope de gasto**: si se llegó al tope del mes y no hay un motor de la máquina, lo que no resuelven las reglas
   como cita o persona pasa al equipo, sin llamar a ningún modelo (ver "Motores y costo").
6. **Clasificador** (`agent/gate.ts`): primero las reglas (`ruleIntent`: saludo, persona, cita, disponibilidad,
   temas del diccionario, precio o catálogo), leyendo antes las expresiones del diccionario. Si no alcanzan, decide
   el modelo del rol `gate` con salida JSON. Las intenciones son `compra`, `info_tienda`, `cita`, `saludo`,
   `humano` y `fuera_de_alcance`.
7. **Respuestas fijas**: fuera de alcance, pedir una persona (activa el modo humano) y cita (arranca el flujo).
8. **Búsqueda** (`rag/retriever.ts`): productos e información por vectores (bge-m3 en Ollama) y texto (FTS5).
9. **Motor** (`agent/router.ts › chooseEngine`): el pesado solo cuando el cliente pide algo específico
   (`heavyReason`):
   - recomendar o comparar;
   - detalles de una prenda (tela, corte, qué incluye);
   - medidas o tallas;
   - una prenda pedida con características ("quiero un traje azul oscuro");
   - el seguimiento corto de eso.

   Saludar, agendar, decir si hay o no algo (aunque traiga color o talla), dar un precio o tomar apuntes va al
   liviano. El otro motor queda de respaldo (`fallbackOrder`).
10. **Prompt** (`llm/engines.ts › generate`): la persona (idéntica para todos los clientes del negocio), el
   historial y lo del turno (información encontrada, nombre del cliente, nota). Con OpenAI, si toda la información
   del negocio cabe en `agent.fullInfoMaxTokens`, va entera y fija después de la persona (`businessSheet`: perfil,
   catálogo e información). Así el modelo la ve completa y OpenAI la cobra desde su caché.
11. **Guardas** (`agent/format.ts`):
    - Una cifra que no está en la información se rehace con el otro motor (`ungroundedNumbers`).
    - Una afirmación sin respaldo ("sí, tenemos wifi") o una negativa deducida ("no vendemos zapatos", cuando la
      información no los menciona) se rehace pidiendo no suponer; si insiste, sale la frase de verificación
      (`unsupportedAnswer`: `ungroundedClaim` y `ungroundedDenial`). Un "no" pasa si lo negado está en la información
      o si se apoya en el alcance del negocio según su descripción ("somos moda masculina", que también cubre
      "para hombres"). La negativa cuenta dígala como la diga: al derecho ("no tenemos zapatos"), al revés
      ("zapatos no tenemos"), sin nombrarla ("eso no lo manejamos") o sin decir "no" ("lo más parecido que
      manejamos es…", "solo manejamos trajes"). La cortesía no cuenta ("no hay problema").
    - Una respuesta que da por hecha una cita que no existe ("te esperamos en la cita") se rehace: solo el flujo de
      citas agenda (`claimsBooked` + `nextAppointmentFor`).
    - Lo que el Perfil marca "por confirmar" ("Zapatos") nunca recibe un sí ni un no. Se le avisa al modelo antes de
      generar y se verifica (`touchesPending`, solo con las palabras distintivas del dato).
    - Un descuento, una rebaja, una promoción, un porcentaje, algo gratis o un precio regateado que la información
      no ofrece se rehace pidiendo no prometer; si insiste, sale la frase de verificación y la pregunta llega a Por
      verificar (`promesaSinRespaldo`). Cada palabra se respalda con la suya: una «oferta de trajes» no respalda un
      «descuento», y cada porcentaje tiene que estar escrito tal cual.
    - Una respuesta que recita las instrucciones (los títulos del prompt, o doce palabras seguidas de las reglas) se
      cambia por una respuesta fija, sin rehacer (`filtraInstrucciones`). La sesión de Apple arranca de cero el turno
      siguiente.
    - Los enlaces se filtran a los de la información.
    - Se limpian los saludos repetidos.

    🪤 **Contra qué se mide el respaldo.** Contra lo que se sabe del negocio (`datosDeLaPersona` más la información),
    nunca contra la persona entera. Las reglas nombran wifi, parqueadero, mascotas, descuentos y envíos como ejemplos
    de lo que no se supone, y desde el primer commit hasta el 2026-10-12 esas palabras respaldaban «Sí, tenemos
    wifi» en producción. Las cifras sí se miden también contra lo que dijo el cliente («el de 800 mil»); las
    promesas de plata, no.

    **Lo que entra como dato.** El nombre lo escribe quien conversa (perfil de WhatsApp, chat del sitio): va al prompt
    solo si parece un nombre (`nombreParaElPrompt`). A la información se le quitan las marcas de encabezado
    (`comoDato`), para que un «## Nota para este turno» escrito en una página no se vea como una sección del prompt, y
    va marcada como datos, no órdenes. Lo que sí no se puede evitar: lo escrito en la información del negocio vale
    como dicho por el negocio. Quien puede escribir ahí —el tablero— manda.
12. **Verificación**: si la respuesta dice que lo verifica, se abre una pregunta en Hoy › Por verificar
    (`crm/verifications.ts`).
13. **Registro**: se guardan los dos mensajes, se emiten los eventos del tablero y se agenda el análisis unos
    segundos después.

## Módulos

| Carpeta | Qué hay |
|---|---|
| `src/agent/` | `agent.ts` (el recorrido), `gate.ts` (clasificador), `router.ts` (motor por turno), `prompts.ts` (persona y reglas), `format.ts` (guardas y post-proceso), `dictionary.ts` (diccionario y expresiones), `teach.ts` (enseñar una frase), `memory.ts` (historial) |
| `src/llm/` | `engines.ts` (roles, respaldo y operaciones), `openai.ts` (modelo por rol, razonamiento, caché), `ollama.ts`, `apple.ts` + `sidecar/`, `usage.ts` (consumo y costos), `herramientas.ts` (llamar herramientas con OpenAI y Claude) |
| `src/agentico/` | `nucleo.ts` (tipos, interruptores, `ejecutarUna` y el bucle), `cliente.ts` (las herramientas del asistente con los clientes), `equipo.ts` (las del copiloto), `agentes.ts` (los agentes del negocio: quién atiende qué y por dónde) |
| `src/voz/` | `llamada.ts` (llamadas con Grok: el boleto, el puente `/voz/ws`, la sesión, las herramientas y la transcripción); en el navegador, `public/voz.js` y `public/voz-procesador.js` |
| `src/rag/` | `store.ts` (SQLite: tablas, vectores, FTS5, migraciones), `retriever.ts` (búsqueda y ficha completa), `ingest.ts` (catálogo, markdown, sitio, Shopify, perfil), `profile-index.ts` |
| `src/crm/` | `contacts.ts`, `merge.ts` (fichas de la misma persona en dos canales), `analyzer.ts` (análisis y puntaje), `score.ts` (el puntaje se enfría solo), `cross.ts` (la misma persona por dos canales), `followup.ts` (posponer seguimiento), `export.ts` (CSV), `signals.ts` (datos exactos por código), `recap.ts`, `appointments.ts` (agenda y zona horaria), `when.ts` (fechas y franjas), `booking.ts` (flujo de citas), `reminders.ts` (recordatorio de la cita), `calendar.ts` + `busy.ts` (iCalendar), `verifications.ts`, `misses.ts` (frases que no entendimos), `outbox.ts` (enviar al cliente, ventana de 24 h, plantillas), `notifications.ts`, `events.ts` (bus en memoria), `settings.ts`, `retencion.ts` (conversaciones viejas), `proximo.ts` (el próximo paso de cada ficha, con reglas y sin modelo), `fijados.ts` (las fichas que cada quien fija, por su nombre) |
| `src/channels/` | `web.ts` (servidor, widget, página demo), `admin.ts` (API del tablero y SSE), `whatsapp.ts` (Baileys), `meta.ts` (Cloud API) + `meta-credentials.ts`, `registry.ts` + `switches.ts` (Canales), `calendar.ts` (rutas públicas), `public-check.ts` (¿responde la dirección pública?) |
| `src/` | `config.ts` (esquemas y variables), `profile.ts` (perfil del negocio), `ajustes.ts` (lo editable de la configuración desde el tablero), `brand.ts` (color, contraste y logo), `envfile.ts` (escribir `.env`), `index.ts` (arranque), `onboard.ts`, `cli.ts`, `seed.ts` |
| `src/` (varios clientes) | `clientes.ts` (alta, baja, índice, tokens), `consola.ts` (tickets, bandeja, proxy del tablero), `consola-usuarios.ts` (quién entra: claves, roles, sesiones), `paquete.ts` (el ZIP del despliegue) |
| `src/crm/` (XENCRM) | `embudo.ts` (hasta dónde llegó cada trato, de la historia de etapas), `kpis.ts` (KPIs y metas), `cuentas-clave.ts` (KAM: marca, plan, salud y candidatas), `optimizacion.ts` (hallazgos por reglas fijas), `resultados.ts` (ventas, seguimientos y `cuandoPasoA`, la única regla de «cuándo se cerró»), `sentimiento.ts` (interés y ánimo agregados), `tickets.ts` (tickets, SLA, reloj hábil, políticas y su configuración), `mantenimientos.ts` + `mantenimientos-reglas.ts` (ventanas, afectados, avisos, cadencia y sus reglas), `tickets-demo.ts` y `servicio-demo.ts` (la semilla de Servicio) |
| `src/` (XENCRM) | `reglas.ts` (el registro común de reglas en tres capas), `vocabulario.ts` (la palabra de la agenda y su concordancia: «la cita», «el turno»), `proveedores.ts` (Modelos de IA: OpenAI, Anthropic, Apple, Ollama, LM Studio y API compatible) |
| `src/eval/` | pruebas sin modelo, escenarios, repasos y consumo; `fixtures/boutique/` es el negocio de las pruebas («Atelier Demo») |
| `public/` | `admin.html` + `admin.js` (tablero, sin framework), `consola.html` (la consola), `inicio.html` (la portada), `widget.js`, `demo.html` |
| `herramientas/` | `mirar.mjs` (abrir una pantalla en un navegador de verdad y ver sus errores), `sonda-hosting/` |

## Datos

Una base SQLite por cliente (`DB_PATH`, WAL):

| Tabla | Qué guarda |
|---|---|
| `docs` (+ `docs_fts`) | catálogo e información indexados, con su vector y su fuente (`knowledge`, `site`, `profile`) |
| `users` | contactos: canal, nombre, teléfono, etapa (y si se fijó a mano), puntaje y factores, ánimo, modo humano y quién lo tiene, **quién está a cargo** (`responsable`, que no se borra cuando vuelve a contestar el asistente), datos capturados (el motivo de pérdida va en `data.motivo_perdida`; lo de contacto —`correo`, `whatsapp`, `instagram`, `facebook`, `contacto_por`— también va en `data`, y lo que el equipo escribió a mano queda en `data._amano`, que el análisis no pisa: `crm/ficha.ts`), etiquetas, notas, resumen, archivada |
| `messages` | la conversación, con autor (`customer`, `bot`, `human`), quién del equipo escribió y, si no le llegó al cliente, **por qué** (`fallo`; se reintenta desde el tablero y es el mismo mensaje) |
| `analyses` | cada análisis: motor, ánimo, señales, puntaje y factores (el costo está en `llm_usage`) |
| `cuentas_clave` | la marca de cuenta clave de un contacto: quién la marcó, desde cuándo y su plan de cuenta (XENCRM) |
| `tickets` | los tickets de Servicio: contacto, asunto, tipo, prioridad, estado, producto, asignado, primera respuesta, solución, pausas y su historia (XENCRM) |
| `mantenimientos` · `mantenimiento_avisos` · `actualizaciones` | las ventanas programadas, el aviso de cada cliente afectado (preparado, salió, a mano) y las versiones publicadas o planeadas (XENCRM) |

Todas las de XENCRM se limpian con la ficha: borrar y `purgeContact` las quitan, unir fichas las pasa a la que queda
(`merge.ts`) y anonimizar vacía su texto (`retencion.ts`, `CON_TEXTO`). 🪤 Los avisos de mantenimiento todavía no se
mudan al unir fichas (anotado en `xencrm.md`).

**Aprender del historial** (`crm/historial.ts`, pantalla en Perfil › *Lo que aprendimos de sus chats*): lo que el
cliente ya tiene conversado entra a la tabla `import_messages` —aparte, **nunca al índice de conocimiento**— por
dos caminos: el `.txt` de "Exportar chat" de WhatsApp (`leerChatExportado`) o la sincronización al vincular el
número (`WHATSAPP_IMPORT_HISTORY=true`, que enciende `syncFullHistory` y escucha `messaging-history.set`). De ahí
salen **las preguntas** (`temasFrecuentes` agrupa por las palabras que las preguntas comparten), **el tono**
(`muestraDeEstilo`, que descarta entera cualquier respuesta con cifras) y **cómo hablan sus clientes**
(`expresionesCandidatas`: fechas a la colombiana que las reglas no entienden —agrupadas por la frase de tiempo,
`fraseDeTiempo`— y palabras que repiten y no están en el catálogo, el perfil ni el diccionario). Esas frases pasan
a *Frases que no entendimos* con `noteMiss`, donde ya existe el camino para enseñarlas: alguien les pone el
significado y solo se guardan si con eso las reglas ya entienden. Aceptar un tema lo escribe en el Perfil
como dato *por confirmar*: el historial pone la pregunta, el negocio pone la respuesta de hoy. La regla y el
porqué, en [`aprender-del-historial.md`](aprender-del-historial.md).

**El embudo es del negocio.** `crm.stages` en `xencrm.config.json` define las etapas: id, nombre y **papel**
(`inicio`, `activo`, `interes`, `cita`, `ganado`, `perdido`). El código nunca usa los nombres —pregunta por el
papel (`etapaCon('ganado')`, `rolDe(stage)`, `estaCerrada`)—, así que una financiera puede ir "Nuevo → En revisión
→ Con un asesor → Resuelto" sin tocar una línea. Un negocio sin `cita` simplemente no agenda: el flujo de citas se
apaga con `appointments.enabled` y nada queda colgando. El tablero recibe las etapas con su papel y pinta por
papel (`stage-<rol>`); los filtros de etapa aparecen solo si ese papel existe. Una ficha con una etapa que ya no
está en la configuración cae a la primera, sin romperse.

**Plantillas de alta** (`plantillas/`): `citas` (boutique, consultorio: termina en cita agendada), `soporte`
(financiera, posventa: consultas y reclamos) y `cotizacion` (impresión industrial: cotizar, producir, entregar).
Cada una trae su embudo, si agenda citas y qué datos capturar; se mezclan sobre `xencrm.config.example.json` al dar
de alta un cliente. Es la primera pregunta del alta, porque de ahí sale cómo trabaja ese CRM.

**Los vectores de búsqueda** (`llm/embeddings.ts`) salen de Ollama (`bge-m3`, local y gratis, pide ~3 GB) o de
OpenAI (`text-embedding-3-small`, $0.02 por millón de tokens), según `EMBED_ENGINE`. Con OpenAI desaparece la
única dependencia pesada, que es lo que permite correr XENCRM en una máquina chica o en un hosting de apps. **Al
cambiar de motor hay que reindexar** (`pnpm ingest`): los vectores de dos modelos no se comparan.

**Desplegar en una plataforma de apps** (`pnpm paquete`): arma un `.zip` con todo XENCRM compilado a JavaScript.
Adentro, `arranque.js` levanta **un proceso por cliente** —cada uno con su base, su WhatsApp y su configuración— y
pone delante un enrutador que reparte por la ruta: `/confia/...` va al proceso de CONFIA sin el prefijo, y el resto
a la consola. Así un solo despliegue y un solo dominio atienden a todos los clientes sin mezclar sus datos. Dos
detalles que lo hacen funcionar: el tablero y el widget calculan su base de la URL donde están servidos (por eso
`admin.html` pide `admin.js` en relativo), y los datos se guardan **fuera de la carpeta del despliegue**, que en
esas plataformas cambia en cada actualización. Ningún secreto viaja en el `.zip`: van como variables del panel.

**Varios clientes en una máquina.** Un proceso por cliente, no una base compartida: son negocios distintos (una
boutique, una financiera, una litografía) y lo que no se mezcla no se puede filtrar. Cada uno vive en
`clientes/<slug>/` con su `xencrm.config.json`, su `.env` (puerto, base, carpeta de WhatsApp, token, dominio), su
base, su diccionario y su perfil; lo compartido de la máquina (claves de OpenAI, URL de Ollama) queda una sola vez
en el `.env` de la raíz y lo heredan todos, porque `config.ts` carga primero el del cliente y después el de la
raíz sin pisar lo ya definido. `pnpm cliente` da de alta, lista, y genera el `ecosystem.config.cjs` de pm2 (una
app por cliente, con reinicio) y el ingress de cloudflared (un túnel, un subdominio por cliente). El aislamiento se
comprobó levantando dos instancias a la vez: bases distintas y el token de una devuelve 401 en la otra.

**La consola** (`pnpm consola`, `src/consola.ts` + `public/consola.html`) es de vigilancia **y de atención**: en
*Atender* junta en una sola bandeja lo que espera a una persona en todos los clientes (preguntas por verificar,
quien pidió una persona, quien espera respuesta) y se responde ahí mismo —la consola habla por el cliente con su
token, por `/api/c/<slug>/…`—, así que no hay que abrir cinco tableros ni repartir tokens. En *Clientes* está el
estado de cada uno y es donde se da de alta uno nuevo.

**Dar de baja un cliente** (`darDeBajaCliente`): sale del índice y su carpeta —base, conversaciones, WhatsApp,
configuración— se guarda en `clientes/_dados-de-baja/<slug>-<fecha>/`. **No se borra nada**: si hay que volver, o
si el cliente pide sus datos, ahí están. Y lo que evita el problema silencioso: sus usuarios se limpian en el mismo
acto (`quitarClienteDeUsuarios`), y quien atendía *solo* a ese cliente queda **desactivado** y a la vista en Equipo
para reasignarlo o quitarlo; a un super-admin no se le toca, que su lista vacía significa "todos". Por el otro
lado, asignar un cliente que no existe se rechaza al crear o al editar un usuario: no nacen usuarios apuntando al
aire. Apagar la instancia en pm2 sigue siendo manual, a propósito.

**Quién entra y qué ve** (`src/consola-usuarios.ts`): cada persona tiene usuario y clave (hash scrypt, archivo
`clientes/usuarios.json` con permisos 600) y un rol. El **super-admin** ve y atiende todos los clientes y maneja el
equipo; quien **atiende** un cliente solo ve —y solo le suena— lo de los clientes que tiene asignados: la bandeja,
el estado y hasta el proxy se filtran por ahí (403 si intenta otro). Las sesiones viven en memoria (12 h) y releen
el usuario en cada petición, así que quitarle un cliente o desactivarlo tiene efecto al instante. El
`CONSOLA_TOKEN` queda como llave maestra del super-admin: para entrar la primera vez y para emergencias.

La consola avisa: cuando aparece algo nuevo de tus clientes suena un pito corto, el número queda en el título de la
pestaña y, si la ventana está en segundo plano, sale una notificación del navegador. No guarda nada propio: le pregunta a cada instancia
por su API con el token de ese cliente (`clientes/<slug>/.env`) y arma **tickets** que salen solos del estado —
instancia caída, dirección pública caída, WhatsApp pidiendo código, preguntas sin responder, gente esperando,
citas sin resultado—, ordenados por urgencia × prioridad del cliente. Escucha solo en `127.0.0.1` porque tiene la
llave de todos los tableros; para entrar desde afuera va detrás de un túnel con autenticación. El alta **no**
arranca la instancia: eso queda en pm2, a propósito.

**La misma persona por dos canales.** Empieza por el chat del sitio y en la tarde escribe por WhatsApp: para ella
es la misma gestión. `crm/merge.ts › siblingIds` encuentra las otras fichas suyas por el número (con caché de un
minuto), `agent/memory.ts › getHistory` mete esa conversación en el contexto —así el asistente llega sabiendo de
qué hablaban— y `crm/cross.ts` lo dice una sola vez ("Vi que veníamos hablando por el chat del sitio; ya me puse al
tanto") y avisa al equipo en la campana. Las citas se leen igual entre fichas (`nextAppointmentForPerson`). Lo que
**no** pasa solo es unir las fichas: esa decisión es de una persona, desde el tablero, porque cada ficha es la
historia de su canal.

**Fechas sueltas.** Un día de la semana sin más ("el jueves") es el de la semana en curso, el que viene: se
entiende que se está hablando de esta semana salvo que el cliente diga otra cosa ("el otro jueves", "el jueves de
la próxima"). Dicho el mismo día de la semana ("el martes", un martes) es el de la otra semana, porque para hoy se
dice "hoy". Si ese día ya no tiene espacios, se dice y se ofrece lo más cercano, en vez de saltar a la semana
siguiente sin avisar (`crm/when.ts` y `whyNoSlots` en `crm/booking.ts`).

**El puntaje.** `computeScore` (en `analyzer.ts`) suma factores explicables con las señales del análisis; se guarda
en `users.score` y solo se recalcula cuando llega un mensaje. Al leer la ficha, `crm/score.ts` le descuenta el
silencio (3 días −10, una semana −25, dos semanas −40; nada si tiene cita o ya compró) y agrega ese descuento como
un factor más: `contact.score` es el de hoy y `contact.scoreBase` el que llegó a tener en la conversación —"Calientes
sin seguimiento" usa el segundo, porque son justo los que se enfriaron. Los pesos son un estimado hecho con las
primeras conversaciones reales; `pnpm rescore` recalcula las fichas viejas con los pesos de hoy usando los análisis
ya guardados (no llama al modelo; `--write` para guardar).
| `appointments` | citas con estado, sede, recordatorio (estado, cuándo, por qué) y respuesta del cliente |
| `events` | línea de tiempo de cada contacto: etapas, traspasos, citas y las **notas del equipo** (tipo `nota`, con texto y autor). `users.notes` es aparte: una sola nota fija que se sobrescribe |
| `llm_usage` | cada llamada a un modelo: tarea, modelo, tokens (entrada, caché, salida, razonamiento), milisegundos |
| `verifications` | preguntas por verificar y sus respuestas |
| `misses` | frases que las reglas no entendieron, con lo que entendió el modelo |
| `turnos` | cada turno del asistente: intención, vía, ruta, motor, modelo, rol, ms, guardas que saltaron, huella del prompt, versión y error. Se podan a los 90 días (`crm/turnos.ts`) |
| `settings` | decisiones del tablero (qué canales están encendidos), el tope de gasto de IA con su último aviso y la retención de conversaciones con su última pasada |
| `entrantes` | el id de cada mensaje que ya entró por WhatsApp oficial, para no atender dos veces lo que Meta repite (se borra a los 7 días; `crm/entrantes.ts`) |

Las columnas nuevas se agregan en `store.ts › migrate()`, porque SQLite no tiene `ADD COLUMN IF NOT EXISTS`.
Respaldo diario con `VACUUM INTO` a `data/backups/` (`rag/backup.ts`), con las últimas 14 copias y permisos 600.

**Retención** (`crm/retencion.ts`): apagada hasta que el super-admin la pone (`settings › retencion.politica`, días y
acción). Mira cada hora y pasa una vez al día, o seguido mientras queden tandas de 300. Cuenta como quieta una ficha
por `MAX(last_message_at, last_seen)` y se salta a quien tiene una cita confirmada por delante. Antes de tocar nada
exige un respaldo de menos de un día; si no lo hay lo hace, y si falla no toca nada y lo deja dicho en
`retencion.ultima`. Anonimizar es una transacción por ficha: le cambia el id a `anon:<12 hex>` en `users`,
`appointments`, `events`, `llm_usage`, `turnos` y `origen`, vacía lo que tiene texto (notas, `payload`, el clic y la
página del origen) y borra `messages`, `analyses`, `verifications`, `misses`, `propuestas`, `wa_salida` y su gente de
grupos. Los archivos del chat se borran del disco después de confirmar. Borrar se lleva todo menos `llm_usage`, que
queda a nombre de `borrado`. `import_messages` no entra: la primera pasada se lo llevaría entero. Las rutas son
`GET /admin/api/retencion` (con `?dias=` da la vista previa) y `PUT`, que la consola solo deja al super-admin.

## Configuración por capas

| Capa | Archivo | Quién la edita |
|---|---|---|
| El negocio y cómo atiende | `xencrm.config.json` (`XENCRM_CONFIG` elige otro) | quien instala (`pnpm onboard`) |
| La máquina y los secretos | `.env` (`XENCRM_ENV_FILE` elige otro) | quien instala; las credenciales de Meta, también el tablero |
| Lo que el dueño confirma | `profileFile` | el tablero (Perfil) |
| Nombre, asistente, marca, hora, citas y sedes | `xencrm.config.json` | el tablero (El negocio) — se aplica **al reiniciar** |
| Lo que el negocio enseña | `dictionaryFile` | el tablero (Diccionario, Frases que no entendimos) |
| Canales encendidos | tabla `settings` | el tablero (Canales) |

Precedencia:

- El nombre, la descripción, el sitio y el contacto humano del perfil pisan los de `xencrm.config.json`. Si un
  campo del perfil está vacío, vale el de la configuración.
- Una variable del proceso pisa la de `.env`.
- Guardar desde el tablero aplica al instante: el perfil y el diccionario en memoria, y las credenciales de Meta en
  el canal en marcha. Los archivos se guardan con copia del anterior (`.anterior.json`).
- 🪤 **Menos la configuración del negocio** (`El negocio`): `xencrm.config.json` se lee **una vez, al arrancar**.
  Guardar deja el archivo listo y el tablero avisa que hay cambios sin aplicar; se aplican al reiniciar ese
  cliente. Por eso `ajustes.ts` valida contra el mismo esquema con el que se lee al arrancar: lo que se guarde
  tiene que poder levantar el proceso.

### Reglas: fábrica → archivo → tablero (XENCRM)

Toda regla de negocio de XENCRM tiene **tres capas** y manda la última que tenga un valor válido: el **defecto en el
código**, lo que trae el cliente en **`xencrm.config.json`**, y lo que se cambia **desde el tablero** (tabla
`settings`). Lo que no vale en una capa se ignora con un aviso y se usa la de abajo; nunca tumba el arranque.

| Qué | Código | Archivo | Tablero |
|---|---|---|---|
| Umbrales y pesos (64 reglas) | `src/reglas.ts` (`regla(id)`, `registrarReglas`) | `reglas: { "<id>": valor }` | `reglas.<id>` · Configuración › Reglas y umbrales |
| SLA y tickets | `crm/tickets.ts` (`FABRICA`, `configSla()`) | `servicio.sla` | `sla.config` + `reglas.sla.*` · Configuración › SLA y tickets |
| Mantenimientos y actualizaciones | `crm/mantenimientos-reglas.ts` | `servicio.mantenimientos` | `reglas.mant.*` · Configuración › Mantenimientos y actualizaciones |
| Metas de KPIs | `crm/kpis.ts` | — | `kpis.metas` · Rendimiento › KPIs y metas |
| Vocabulario e interfaz | `src/vocabulario.ts` (defecto neutro) | `interfaz` | — |

- Las reglas se aplican en vivo (caché de 2 s que el tablero borra al guardar), salvo lo que diga su pantalla.
- Guardar es todo o nada; `PUT /admin/api/reglas` responde 400 con los errores por regla y no guarda ninguna.
- Los planes de Mantenimientos son los vigentes del SLA (`configSla().planes`): un solo «Pro» en las dos pantallas.
- Cambiar reglas, metas y la configuración de Mantenimientos es de quien administra: el candado no las deja pasar
  y la consola las cierra a quien no es super-admin (`SOLO_SUPER_CAMBIA`). Quién cambia el SLA es configurable y lo
  decide su ruta con el rol de la sesión.

## Varios clientes

Un **proceso por cliente**, no una base compartida con `tenant_id`: son negocios distintos y lo que no se mezcla
no se puede filtrar. Cada uno tiene su `xencrm.config.json`, su base, su WhatsApp y su `ADMIN_TOKEN`.

La **consola** (`src/consola.ts`) no guarda nada propio: le pregunta a cada instancia por su API con el token de
ese cliente. De ahí salen los tickets y la bandeja única.

Para no repartir tokens, la consola **sirve el tablero de cada cliente** en `/c/<slug>/admin` y le pone el token
al pasar cada petición. Tres detalles que lo hacen funcionar:

1. El tablero calcula solo dónde vive (`BASE` sale de la ruta), así que servido ahí sus llamadas caen en
   `/c/<slug>/admin/api/...` y vuelven a pasar por la consola. No hubo que tocarlo.
2. La sesión viaja en una **galleta** (`xencrm_consola`, HttpOnly, 12 h) además de la cabecera: una navegación
   normal y un `EventSource` no pueden poner cabeceras.
3. La consola le deja una **marca** a la página al pasarla (`window.XENCRM_CONSOLA`). Sin eso el tablero, al no
   encontrar un token en el navegador, enseñaba su pantalla de token aunque no hiciera falta ninguno.
4. Cada petición lleva **quién y con qué rol**, sacados de la sesión y nunca del navegador: `x-xencrm-quien` (el
   nombre, para la historia de cada ficha) y `x-xencrm-rol` (`super`, `admin` o `asesor`). Con el modo fácil puesto,
   el cliente usa el rol para el candado (`channels/candado.ts`): quien no es super-admin solo hace lo del día a
   día. El token a secas no lleva rol y no tiene candado.

Por la consola solo se llega al tablero de un cliente, no al resto de su instancia, y quien atiende a un cliente
no entra a los otros ni sabiéndose la dirección.

## Motores y costo

- **Cuatro roles** (liviano, pesado, clasificador y análisis), cada uno con su motor (Apple, Ollama u OpenAI). Con
  OpenAI, cada rol tiene su modelo y su esfuerzo de razonamiento.
- **Modelos de razonamiento**: se reconocen al primer error por `temperature`. Desde ahí se omite ese parámetro y se
  les da presupuesto para pensar. Lo mismo con `reasoning_effort`, la clave y la retención de caché: si la API no los
  acepta, se aprende y se omiten.
- **Caché de OpenAI**: con `gpt-5.4-mini` solo pega cuando el inicio común del prompt pasa de unos 1.450 tokens
  (medido, no documentado). Por eso existe la ficha completa fija al inicio. Todo en `llm/openai.ts` y
  `rag/retriever.ts`.
- **Claude de respaldo** (`llm/anthropic.ts`, desde el 2026-10-22): con `ANTHROPIC_API_KEY` puesta, `fallbackOrder`
  lo agrega detrás de los motores de la máquina (`RESPALDOS`). No tiene rol y la consola no lo ofrece. Modelos:
  `claude-haiku-5-5` para liviano y análisis, y `claude-sonnet-5-5` para pesado y clasificador, que no baja de
  categoría (`ANTHROPIC_MODEL[_ROL]`).
  - **Cuándo entra:** OpenAI caído, sin red, sin saldo (un 429 `insufficient_quota` → `sin_saldo`) o con la llave
    revocada. Si el preferido está en su minuto de enfriamiento (`enfriando`), pasa al final de la lista, para que
    los mensajes de ese minuto no esperen su timeout antes de llegar al respaldo.
  - **Saldo de Claude:** sin saldo devuelve un 400 «credit balance», también `sin_saldo`.
  - **Arranque:** un sondeo fallido con llave se reintenta al minuto, no al siguiente reinicio.
  - **Caché:** no es automática. Se marcan `system` (la persona con la ficha completa, que Claude recibe igual que
    OpenAI, `conInfoCompleta`) y el final del historial. Lo del turno va pegado al último mensaje del cliente, porque
    Claude no acepta `system` a mitad de la conversación y así no rompe el prefijo. Guardar cuesta 1,25 × la entrada y
    dura 5 minutos. `llm_usage.cache_write_tokens` lo registra aparte, y `usageSummary().cache` da lo que ahorró
    leer y lo que costó guardar: con mensajes más espaciados que 5 minutos, la caché sale más cara que no tenerla.
  - **Tope:** cuenta para el mismo tope que OpenAI (`DE_PAGO`).
  - **Probarlo de titular:** `pnpm test:scenarios --engine=anthropic`, con la llave en
    `~/xencrm-credenciales/anthropic.txt`.
- **Consumo**: cada llamada se registra con su costo según la tarifa de `usage.ts`. `pnpm usage` y el tablero lo
  muestran; `pnpm replay` proyecta el costo por 1.000 conversaciones.
- **Tope de gasto** (`crm/presupuesto.ts`): USD al mes por cliente, en `settings` (`presupuesto.topeUsdMes`) o, si
  nunca se puso, `TOPE_USD_MES`. Lo gastado es una consulta agrupada sobre `llm_usage` desde el día 1 en la hora del
  negocio, guardada 10 s. Los escalones:
  - **80 %**: evento `presupuesto`. La campana, el ticket de la consola y el WhatsApp del vigilante salen de ahí,
    una vez por escalón y por mes (`presupuesto.avisado`, en la base para que un reinicio no repita).
  - **90 %** (`enAhorro`): `chooseEngine` manda lo específico al rol liviano.
  - **100 %** (`agotado`): `fallbackOrder` saca a OpenAI y a Claude si queda un motor de la máquina (`motorSinCosto`). Si no
    queda ninguno (`iaAgotada`), el agente decide antes del clasificador: lo que resuelven las reglas como cita o
    persona sigue, y lo demás pasa al equipo con `TOPE_REPLIES` y `setHumanMode(…, 'tope')`. El análisis toma el
    camino de reglas y `transcribir` no transcribe. `generate` y `classify` lanzan `TopeAlcanzado` antes de
    cualquier llamada a OpenAI, como freno de último recurso para caminos que se olviden de mirar.

  Cambiarlo va por `PUT /admin/api/motores/tope`: bajo `motores/`, que la consola reserva al super-admin. Verlo es
  `GET /admin/api/presupuesto`, abierto a quien vea el tablero.
- **Análisis barato**:
  - Corre cuando la conversación hace una pausa (`crm.analysisQuietSeconds`, 60 s) o a más tardar
    `crm.analysisMaxWaitSeconds` (300 s) después del primer mensaje sin analizar (`scheduleAnalysis`).
  - Los datos exactos salen del código (`signals.ts`) y los pasos triviales no llaman al modelo.
  - El modelo recibe solo lo nuevo junto con la ficha anterior.
  - `flushAnalyses` corre lo pendiente de una vez (Re-analizar, escenarios y repasos).

## Citas

- **Fechas** (`crm/when.ts › parseWhen`): días relativos y explícitos, franjas (mañana, mediodía, almuerzo, tarde,
  noche, última hora), rangos y muletillas colombianas. Lee antes las expresiones del diccionario. Solo si el
  mensaje habla de tiempo y las reglas no lo entienden, el modelo lo traduce a un filtro (`askModelWhen`), y eso
  queda en "frases que no entendimos".
- **La fecha del evento** (`when.ts › eventDeadline`): "el evento es el viernes" no pide cita el viernes; fija un
  plazo (desde hoy hasta el día antes). Se usa en todos los pasos del flujo.
- **Flujo** (`crm/booking.ts`): pasos `nombre`, `elegir`, `telefono`, `confirmar`, `gestionar`, `cancelar` y
  `recordatorio`. El estado vive en `users.data.booking`. Mover una cita agenda primero la nueva y después cancela la
  anterior.
- **Recordatorio** (`crm/reminders.ts`): un temporizador revisa cada minuto qué citas ya tienen su hora de
  recordatorio. Envía por WhatsApp o por plantilla, y si no puede, lo deja a mano con el motivo.
- **Sedes** (`crm/sedes.ts`): todo lo de la agenda se pide por `agendaDe(sede)`, que hereda de `appointments` lo
  que la sede no diga. Sin sedes es la agenda de siempre, así que el caso de casi todos los clientes no se piensa en
  ningún otro sitio. Decisiones:
  - El cupo es por sede. Las citas sin sede, de antes de que el negocio tuviera sedes, se le cuentan a la primera;
    contarlas en ninguna dejaría ese espacio libre dos veces. El calendario privado del dueño
    (`CALENDAR_BUSY_ICS`) ocupa todas; el de una sede (`CALENDAR_BUSY_ICS_<SEDE>`), solo esa (`crm/busy.ts`).
  - Con varias sedes, `bookAppointment` no agenda sin sede. Escoger una por defecto mandaría a alguien a la otra punta
    de la ciudad.
  - El flujo tiene el paso `sede`, entre el nombre y los horarios. `sedeEn` reconoce nombre, id y apodos sin tildes;
    si el mensaje nombra dos sedes devuelve null y se vuelve a preguntar, porque leer la negación no es de reglas.
  - La sede se guarda en `users.data.sede` y en `appointments.sede`; `location` lleva el nombre con la dirección,
    que es lo que ya leían el recordatorio, el calendario y la exportación.
  - El recordatorio se va al último día que atiende la sede de esa cita, no la agenda general.
  - Sin sedes no entra nada: `sedesComoInformacion()` devuelve vacío, la ficha del negocio no tiene «### Sedes» y el
    flujo no tiene el paso. No hay ninguna instrucción de «no hables de sedes»: sería gastar tokens en poner al
    modelo a pensar en lo que no existe. `test:sedes` revisa que nada de lo que ve el modelo diga «sede».
  - Las sedes escritas a mano, una por línea, las lee `sedes-texto.ts`, que no carga ninguna configuración. Lo usan
    el alta de un cliente (la consola y `pnpm cliente nuevo`), `pnpm onboard` y El negocio, que comparten el cálculo
    del id: «Sede Norte» da `norte` y «DUNOR Centro», `centro`.
- **Calendario**: iCalendar estándar. Suscripción secreta, página por cita con firma HMAC y calendarios del dueño
  que bloquean la agenda. El enlace de la videollamada (`appointments.link`, solo http(s): `enlaceLimpio`) va en el
  recordatorio y en el `.ics` (`URL` y descripción).
- **Días bloqueados** (`crm/cierres.ts`, tabla `agenda_cierres`: fecha civil del negocio y sede, '' = todas):
  `availableSlots` los salta e `isSlotFree` los cuenta como ocupados para el asistente; con `includeBusy: false`
  (agendar desde el tablero) no. `whyNoSlots` dice «ese día no atendemos». Bloquear no cancela lo agendado.
- **Festivos** (`crm/festivos.ts`): los de Colombia, calculados (Pascua por el algoritmo gregoriano y la Ley
  Emiliani). Solo se anuncian; el país sale de `appointments.festivos` o de la zona horaria.
- **Lo que ve el calendario** (`crm/agenda-vista.ts`): `citaConDatos` (canal, etapa, valor, empresa, cuándo sale el
  recordatorio), `cupoPorDia` (en `appointments.ts`: los mismos espacios que ofrece el asistente, por la capacidad;
  con varias sedes y ninguna escogida, la suma), `vistaDeAgenda` (cupo y anuncios de un rango: festivos, cierres,
  mantenimientos, casi lleno desde `agenda.casiLlenoPct`, lleno) y `panelHoy` (próxima, hoy, mañana, recordatorios y
  el cupo de `agenda.diasCupo` días). Rutas: `/admin/api/agenda`, `/agenda/hoy` y `/agenda/cierres` (esta última,
  fuera de lo que el candado deja cambiar).

## Modo agéntico

El modelo pide herramientas y el código decide y ejecuta. Dos agentes con la misma maquinaria: con los clientes
(dentro de `agent.ts`, en lugar de `generate` para compras y preguntas) y el copiloto del equipo (`POST /copiloto`).
Todo en [`modo-agentico.md`](modo-agentico.md): decisiones, reglas (el contexto lo pone el código, tres efectos
garantizados por el tipo, permisos por la ruta equivalente y el candado, topes de pasos y de gasto, la guarda
`ticketSinRespaldo`), los **varios agentes** (`agentico/agentes.ts`, tabla `agente_de_conversacion`) y la **voz con
Grok** (`voz/llamada.ts`: XENCRM hace de puente en `/voz/ws`; el enrutador del paquete pasa ese WebSocket), y lo que
falta.

## Turnos

Cada mensaje que atiende el agente corre dentro de un **turno** (`crm/turnos.ts`), con un identificador que viaja
solo por AsyncLocalStorage desde `handleMessage` hasta la respuesta. `recordUsage` y `appendMessage` lo toman de
ahí, así que cada llamada a un modelo (`llm_usage.turno`) y cada mensaje (`messages.turno`) quedan unidos a su
turno sin pasar el id por ninguna firma. Al terminar, `conTraza` guarda el turno, también si el turno revienta.

- Las guardas se anotan con `anotarGuarda` donde saltan: `cifras`, `sin_respaldo:<tema>`, `promesa:<qué>`,
  `recito`, `cita_inventada`, `tope`, `falló:<motor>`.
- 🪤 El análisis que programa un turno corre fuera de él (`fueraDelTurno` en `scheduleAnalysis`): cubre varios
  mensajes y su gasto no es de esa respuesta.
- `GET /admin/api/turnos/:id` devuelve el turno con sus llamadas, su costo y sus mensajes. Es lo que abre el
  **¿por qué?** de cada respuesta en la conversación, solo para quien administra.
- La huella del prompt son ocho caracteres del SHA-256 de las reglas: no dice qué cambió, pero sí si dos
  respuestas salieron del mismo prompt.

**La versión** (`src/version.ts`) sale de `XENCRM_VERSION`, del `version.json` que deja `pnpm paquete` en la raíz
del paquete o de git, con `+cambios` si hay cosas sin commitear. La dicen `/_salud` de cada cliente, la del
lanzador, la fila de cada cliente en la consola y cada turno guardado.

## En vivo

`crm/events.ts` es un bus en memoria. El tablero lo recibe por SSE (`/admin/api/stream`) y las notificaciones se
derivan de él (`notifications.ts`). Cada canal registra cómo entregar un mensaje (`outbox.ts › registerSender`):

- **WhatsApp oficial**: tiene ventana de 24 horas y plantillas.
- **WhatsApp por QR**: sin ventana.
- **Chat web**: guarda el mensaje; el widget lo muestra en vivo.

## Aprender

- **Por verificar → información**: la respuesta del equipo se suma a `respuestas-del-equipo.md` y se indexa.
- **Frases que no entendimos → diccionario**: una expresión solo se guarda si con ella las reglas ya entienden la
  frase original (`agent/teach.ts`).
- **Español general → código**: una muletilla que le puede pasar a cualquier cliente va a las reglas, con su prueba
  sin modelo.

## Pruebas

🪤 **Cada guion de prueba fija su negocio** (`XENCRM_CONFIG=src/eval/fixtures/boutique/xencrm.config.json`, en
`package.json`): así cambiar el ejemplo de la raíz no rompe la batería. Una suite suelta se corre con `pnpm test:x`,
no con `npx tsx src/eval/x.ts` (esa usaría la configuración de la raíz).

| Comando | Qué prueba | Modelo |
|---|---|---|
| `pnpm test` | todas las de abajo, en orden | no |
| `pnpm test:when` | fechas, franjas y muletillas | no |
| `pnpm test:calendar` | iCalendar, suscripción y calendarios que bloquean | no |
| `pnpm test:agenda` | festivos, días bloqueados, cupo, anuncios, panel «Hoy», enlace de la videollamada | no |
| `pnpm test:agentico` | herramientas en los dos formatos, el bucle y sus topes, el agente del cliente, el copiloto y su ruta | no (simula la API) |
| `pnpm test:agentes` | los agentes y el relevo, la voz: boleto, freno, sesión, una llamada con un Grok de mentira, el WebSocket, la página, el micrófono y el enrutador | no (simula xAI) |
| `pnpm test:signals` | teléfono, correo, presupuesto, cortesías | no |
| `pnpm test:gate` | cobertura de las reglas del clasificador | no |
| `pnpm test:booking` | el flujo de citas con muletillas; falla si llamó al modelo | no |
| `pnpm test:dictionary` | diccionario: aplicar, sumar, reemplazar, errores | no |
| `pnpm test:guards` | afirmaciones y cifras sin respaldo | no |
| `pnpm test:verifications` | por verificar, aprender, ventana de 24 h | no |
| `pnpm test:misses` | frases que no entendimos y expresiones | no |
| `pnpm test:reminders` | recordatorio: cuándo, por qué canal, a mano, respuesta | no |
| `pnpm test:brand` | contraste de la marca con 500 colores | no |
| `pnpm test:bandeja` · `test:contactos` · `test:sentimiento` · `test:modelos` | la Bandeja omnicanal, Contactos/ficha/Tratos, el sentimiento, los proveedores de IA | no |
| `pnpm test:embudo` · `test:kpis` · `test:kam` · `test:optimizacion` | el embudo y el filtrado, KPIs y metas, cuentas clave, los hallazgos | no |
| `pnpm test:sla` · `test:mantenimientos` · `test:reglas` | tickets y SLA, mantenimientos y avisos, el registro de reglas (las tres capas) | no |
| `pnpm test:ejemplo` | el ejemplo XENTRIS y que nada visible de negocio quede fijo en el código | no |
| `pnpm test:meta` | credenciales de Meta: validar, verificar, guardar | no (Meta simulado) |
| `pnpm test:profile` | perfil: guardar, aplicar, lo que llega al bot | no |
| `pnpm test:ajustes` | configuración del negocio: qué se guarda, qué se rechaza, qué no se toca | no |
| `pnpm test:router` | qué modelo responde: el pesado solo para lo específico | no |
| `pnpm test:schedule` | cuándo corre el análisis: ráfaga, conversación activa, flush | no |
| `pnpm test:archive` | archivar (sale de listas y cuentas, vuelve al escribir) y borrar | no |
| `pnpm test:merge` | unir fichas: detección por número y que no se pierda nada | no |
| `pnpm test:buscar` | buscar dentro de la conversación y el número para escribir o llamar | no |
| `pnpm test:followup` | posponer el seguimiento de un caliente y su regreso a la lista | no |
| `pnpm test:proximo` | el próximo paso regla por regla, que coincida con Seguimientos, el valor en la lista, las notas y los números de la barra | no |
| `pnpm test:fijados` | los fijados en la base: por nombre, sin repetidos, y que el teléfono no quede guardado al borrar, unir o anonimizar | no |
| `pnpm test:export` | contactos y citas en CSV: columnas, comillas y archivados fuera | no |
| `pnpm test:score` | pesos del puntaje y el descuento por silencio al leer la ficha | no |
| `pnpm test:cross` | la misma persona por dos canales: contexto, aviso y fichas separadas | no |
| `pnpm test:clientes` | alta de un cliente: carpeta, puerto, token, pm2 y túnel | no |
| `pnpm test:embeddings` | el selector de vectores (Ollama u OpenAI) y su consumo | no |
| `pnpm test:consola` | tickets, orden de atención y el alta desde la consola | no |
| `pnpm test:etapas` | un negocio con otro embudo (soporte, sin citas) funciona igual | no |
| `pnpm test:usuarios` | quién entra a la consola y qué clientes alcanza a ver y atender | no |
| `pnpm test:historial` | aprender del historial: agrupar preguntas, estilo sin cifras, leer el .txt | no |
| `pnpm test:backup` | respaldo: la copia trae los datos, permisos 600, conserva las últimas N | no |
| `pnpm test:public` | aviso de dirección pública caída: 3 fallas, aviso al caer y al volver, otro servidor | no |
| `pnpm test:inyeccion` | inyección de prompt: promesas de plata, instrucciones recitadas, nombre y documentos con órdenes, y el recorrido entero con un modelo falso que siempre cae | no (modelo simulado) |
| `pnpm test:presupuesto` | tope de gasto: mes del negocio, escalones, avisos una vez, ahorro al 90 % y al 100 % ni una llamada de pago sin dejar a nadie sin respuesta | no (OpenAI y Ollama simulados) |
| `pnpm test:sedes` | varias sedes: preguntar en cuál, apodos, cambiar a mitad del flujo, cupo por sede, la otra sede cuando la suya no abre, recordatorio y lo que ve el modelo | no |
| `pnpm test:turnos` | cada respuesta con su turno: ruta, modelo, guardas, costo y versión; llamadas y mensajes unidos; el análisis y lo del equipo fuera | no (OpenAI simulado) |
| `pnpm test:claves` | claves y tarjetas en vivo: qué se tapa, qué no (correo, teléfono), que no llegue al modelo ni se guarde | no (OpenAI simulado) |
| `pnpm test:retencion` | retención: apagada por defecto, mínimo 90 días, sin respaldo no toca nada, ni el nombre ni el teléfono quedan en ninguna tabla, el embudo y el gasto sí, citas por delante, tandas, borrar, y la ruta | no |
| `pnpm test:repetidos` | WhatsApp oficial: lo que Meta manda dos veces entra y se contesta una vez; en «Mira» no marca leído ni contesta | no (Meta simulado) |
| `pnpm test:scenarios` | las conversaciones del cliente (`evalFile`), con su consumo | sí |
| `pnpm replay` | las conversaciones sintéticas con los motores configurados; proyecta el costo | sí |

Reglas para probar sin romper nada:

- Las pruebas que escriben usan una base, un archivo o un `.env` temporales (`DB_PATH`, `XENCRM_ENV_FILE` y el
  archivo del perfil o del diccionario en una carpeta temporal). Las que usan la base real trabajan con contactos
  `test:` y los borran al terminar.
- **Nunca se escriben hechos de prueba en la información real del cliente.**
- Para probar en el navegador o con conversación real sin tocar lo real, se levanta un servidor aparte con una copia
  de la base y de la configuración:

  ```bash
  sqlite3 data/xencrm.db ".backup /tmp/xencrm-prueba/xencrm.db"
  # copia xencrm.config.json a /tmp/xencrm-prueba y apunta dictionaryFile y profileFile a copias allí
  XENCRM_CONFIG=/tmp/xencrm-prueba/xencrm.config.json DB_PATH=/tmp/xencrm-prueba/xencrm.db PORT=3100 WHATSAPP_ENABLED=false npx tsx src/index.ts
  ```

### Lo que las pruebas no cogen

Todas las de arriba prueban el servidor. Ninguna abre una pantalla, así que un error de JavaScript en el
navegador deja la página muerta mientras el HTTP sigue dando 200 y el HTML sigue siendo correcto. Ya pasó: un
`<dialog>` puesto después del `<script>` tumbó el tablero entero durante un día.

Para eso está `node herramientas/mirar.mjs <url> <sesion> <salida.png>`: abre la pantalla en Chrome con la sesión
puesta, guarda una captura y **imprime los errores de JavaScript**. Una pantalla nueva no está probada hasta que
se abre en un navegador.

## Extender

- **Un cliente nuevo**: `pnpm onboard` (desde un ejemplo o desde cero), luego su catálogo y su información,
  `pnpm ingest`, y `evalFile` con sus conversaciones de prueba. Después se llena el Perfil desde el tablero.
- **Una muletilla que falló**: si es del español general, va a las reglas (`when.ts`, `gate.ts` o `booking.ts`) con
  su caso en la prueba. Si es del negocio, se enseña desde el tablero y queda en su diccionario.
- **Un canal**: un adaptador en `src/channels/` que llame a `handleMessage` y registre su emisor
  (`registerSender`), más su tarjeta en `registry.ts`.
- **Un dato del perfil**: agregarlo a `ProfileSchema` y a `PROFILE_FIELDS` en `src/profile.ts`. El formulario y el
  texto para el bot salen de ahí.
- **El tablero**: seguir `docs/diseno-tablero.md`. Todo color sale de un token. El texto se mide a 4.5:1 y los
  bordes, filos y anillos a 3:1. Los colores de dato no se mezclan con el acento de marca.

## Pendiente

- WhatsApp oficial está escrito contra la documentación de Meta, pero no se ha probado con credenciales reales.
- Instagram y Messenger: el adaptador se construye cuando haya credenciales de prueba.
- Aprender del historial de cada cliente (estilo y preguntas frecuentes, nunca precios ni políticas):
  [`aprender-del-historial.md`](aprender-del-historial.md). Baileys ya puede traerlo (`syncFullHistory`).
- Túnel fijo con dominio propio y despliegue en el Mac Mini (con pm2).
- Afinar los pesos del puntaje con resultados reales: hoy son un estimado con 10 conversaciones (3 con cita, 1
  venta). Con ~20 citas con resultado marcado en Hoy › ¿Cómo les fue? se pueden medir de verdad.
