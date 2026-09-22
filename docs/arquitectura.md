# Arquitectura

Para quien va a cambiar el código. El README explica qué hace aiva y cómo configurarlo; aquí está cómo está hecho
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

1. **Contacto**: se crea o se actualiza (`touchUser`).
2. **Modo humano**: si una persona tiene la conversación, se guarda el mensaje, se agenda el análisis y no se
   responde.
3. **Flujo de cita en curso** (`crm/booking.ts › bookingStep`): si hay uno y el mensaje encaja, responde el flujo.
   Si no encaja, el flujo se pausa y sigue el agente. Una respuesta corta que no encajó queda en "frases que no
   entendimos".
4. **Cambiar o cancelar**: con una cita próxima y una intención clara ("ya no puedo ir", "pásala para el jueves"),
   responde el flujo de citas.
5. **Clasificador** (`agent/gate.ts`): primero las reglas (`ruleIntent`: saludo, persona, cita, disponibilidad,
   temas del diccionario, precio o catálogo), leyendo antes las expresiones del diccionario. Si no alcanzan, decide
   el modelo del rol `gate` con salida JSON. Las intenciones son `compra`, `info_tienda`, `cita`, `saludo`,
   `humano` y `fuera_de_alcance`.
6. **Respuestas fijas**: fuera de alcance, pedir una persona (activa el modo humano) y cita (arranca el flujo).
7. **Búsqueda** (`rag/retriever.ts`): productos e información por vectores (bge-m3 en Ollama) y texto (FTS5).
8. **Motor** (`agent/router.ts › chooseEngine`): el pesado solo cuando el cliente pide algo específico
   (`heavyReason`):
   - recomendar o comparar;
   - detalles de una prenda (tela, corte, qué incluye);
   - medidas o tallas;
   - una prenda pedida con características ("quiero un traje azul oscuro");
   - el seguimiento corto de eso.

   Saludar, agendar, decir si hay o no algo (aunque traiga color o talla), dar un precio o tomar apuntes va al
   liviano. El otro motor queda de respaldo (`fallbackOrder`).
9. **Prompt** (`llm/engines.ts › generate`): la persona (idéntica para todos los clientes del negocio), el
   historial y lo del turno (información encontrada, nombre del cliente, nota). Con OpenAI, si toda la información
   del negocio cabe en `agent.fullInfoMaxTokens`, va entera y fija después de la persona (`businessSheet`: perfil,
   catálogo e información). Así el modelo la ve completa y OpenAI la cobra desde su caché.
10. **Guardas** (`agent/format.ts`):
    - Una cifra que no está en la información se rehace con el otro motor (`ungroundedNumbers`).
    - Una afirmación sin respaldo ("sí, tenemos wifi") o una negativa deducida ("no vendemos zapatos", cuando la
      información no los menciona) se rehace pidiendo no suponer; si insiste, sale la frase de verificación
      (`unsupportedAnswer`: `ungroundedClaim` y `ungroundedDenial`). Un "no" pasa si lo negado está en la información
      o si se apoya en el alcance del negocio según su descripción ("somos moda masculina", que también cubre
      "para hombres").
    - Lo que el Perfil marca "por confirmar" ("Zapatos") nunca recibe un sí ni un no. Se le avisa al modelo antes de
      generar y se verifica (`touchesPending`, solo con las palabras distintivas del dato).
    - Los enlaces se filtran a los de la información.
    - Se limpian los saludos repetidos.
11. **Verificación**: si la respuesta dice que lo verifica, se abre una pregunta en Hoy › Por verificar
    (`crm/verifications.ts`).
12. **Registro**: se guardan los dos mensajes, se emiten los eventos del tablero y se agenda el análisis unos
    segundos después.

## Módulos

| Carpeta | Qué hay |
|---|---|
| `src/agent/` | `agent.ts` (el recorrido), `gate.ts` (clasificador), `router.ts` (motor por turno), `prompts.ts` (persona y reglas), `format.ts` (guardas y post-proceso), `dictionary.ts` (diccionario y expresiones), `teach.ts` (enseñar una frase), `memory.ts` (historial) |
| `src/llm/` | `engines.ts` (roles, respaldo y operaciones), `openai.ts` (modelo por rol, razonamiento, caché), `ollama.ts`, `apple.ts` + `sidecar/`, `usage.ts` (consumo y costos) |
| `src/rag/` | `store.ts` (SQLite: tablas, vectores, FTS5, migraciones), `retriever.ts` (búsqueda y ficha completa), `ingest.ts` (catálogo, markdown, sitio, Shopify, perfil), `profile-index.ts` |
| `src/crm/` | `contacts.ts`, `analyzer.ts` (análisis y puntaje), `signals.ts` (datos exactos por código), `recap.ts`, `appointments.ts` (agenda y zona horaria), `when.ts` (fechas y franjas), `booking.ts` (flujo de citas), `reminders.ts` (recordatorio del día antes), `calendar.ts` + `busy.ts` (iCalendar), `verifications.ts`, `misses.ts` (frases que no entendimos), `outbox.ts` (enviar al cliente, ventana de 24 h, plantillas), `notifications.ts`, `events.ts` (bus en memoria), `settings.ts` |
| `src/channels/` | `web.ts` (servidor, widget, página demo), `admin.ts` (API del tablero y SSE), `whatsapp.ts` (Baileys), `meta.ts` (Cloud API) + `meta-credentials.ts`, `registry.ts` + `switches.ts` (Canales), `calendar.ts` (rutas públicas), `public-check.ts` (¿responde la dirección pública?) |
| `src/` | `config.ts` (esquemas y variables), `profile.ts` (perfil del negocio), `brand.ts` (color, contraste y logo), `envfile.ts` (escribir `.env`), `index.ts` (arranque), `onboard.ts`, `cli.ts`, `seed.ts` |
| `src/eval/` | pruebas sin modelo, escenarios, repasos y consumo |
| `public/` | `admin.html` + `admin.js` (tablero, sin framework), `widget.js`, `demo.html` |

## Datos

Una base SQLite por cliente (`DB_PATH`, WAL):

| Tabla | Qué guarda |
|---|---|
| `docs` (+ `docs_fts`) | catálogo e información indexados, con su vector y su fuente (`knowledge`, `site`, `profile`) |
| `users` | contactos: canal, nombre, teléfono, etapa (y si se fijó a mano), puntaje y factores, ánimo, modo humano y quién lo tiene, datos capturados, etiquetas, notas, resumen |
| `messages` | la conversación, con autor (`customer`, `bot`, `human`) y quién del equipo escribió |
| `analyses` | cada análisis: motor, ánimo, señales, puntaje y factores (el costo está en `llm_usage`) |
| `appointments` | citas con estado, recordatorio (estado, cuándo, por qué) y respuesta del cliente |
| `events` | línea de tiempo de cada contacto |
| `llm_usage` | cada llamada a un modelo: tarea, modelo, tokens (entrada, caché, salida, razonamiento), milisegundos |
| `verifications` | preguntas por verificar y sus respuestas |
| `misses` | frases que las reglas no entendieron, con lo que entendió el modelo |
| `settings` | decisiones del tablero (qué canales están encendidos) |

Las columnas nuevas se agregan en `store.ts › migrate()`, porque SQLite no tiene `ADD COLUMN IF NOT EXISTS`.

## Configuración por capas

| Capa | Archivo | Quién la edita |
|---|---|---|
| El negocio y cómo atiende | `aiva.config.json` (`AIVA_CONFIG` elige otro) | quien instala (`pnpm onboard`) |
| La máquina y los secretos | `.env` (`AIVA_ENV_FILE` elige otro) | quien instala; las credenciales de Meta, también el tablero |
| Lo que el dueño confirma | `profileFile` | el tablero (Perfil) |
| Lo que el negocio enseña | `dictionaryFile` | el tablero (Diccionario, Frases que no entendimos) |
| Canales encendidos | tabla `settings` | el tablero (Canales) |

Precedencia:

- El nombre, la descripción, el sitio y el contacto humano del perfil pisan los de `aiva.config.json`. Si un
  campo del perfil está vacío, vale el de la configuración.
- Una variable del proceso pisa la de `.env`.
- Guardar desde el tablero aplica al instante: el perfil y el diccionario en memoria, y las credenciales de Meta en
  el canal en marcha. Los archivos se guardan con copia del anterior (`.anterior.json`).

## Motores y costo

- **Cuatro roles** (liviano, pesado, clasificador y análisis), cada uno con su motor (Apple, Ollama u OpenAI). Con
  OpenAI, cada rol tiene su modelo y su esfuerzo de razonamiento.
- **Modelos de razonamiento**: se reconocen al primer error por `temperature`. Desde ahí se omite ese parámetro y se
  les da presupuesto para pensar. Lo mismo con `reasoning_effort`, la clave y la retención de caché: si la API no los
  acepta, se aprende y se omiten.
- **Caché de OpenAI**: con `gpt-5.4-mini` solo pega cuando el inicio común del prompt pasa de unos 1.450 tokens
  (medido, no documentado). Por eso existe la ficha completa fija al inicio. Todo en `llm/openai.ts` y
  `rag/retriever.ts`.
- **Consumo**: cada llamada se registra con su costo según la tarifa de `usage.ts`. `pnpm usage` y el tablero lo
  muestran; `pnpm replay` proyecta el costo por 1.000 conversaciones.
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
- **Flujo** (`crm/booking.ts`): pasos `nombre`, `elegir`, `telefono`, `confirmar`, `gestionar`, `cancelar` y
  `recordatorio`. El estado vive en `users.data.booking`. Mover una cita agenda primero la nueva y después cancela la
  anterior.
- **Recordatorio** (`crm/reminders.ts`): un temporizador revisa cada minuto qué citas ya tienen su hora de
  recordatorio. Envía por WhatsApp o por plantilla, y si no puede, lo deja a mano con el motivo.
- **Calendario**: iCalendar estándar. Suscripción secreta, página por cita con firma HMAC y calendarios del dueño
  que bloquean la agenda.

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

| Comando | Qué prueba | Modelo |
|---|---|---|
| `pnpm test` | todas las de abajo, en orden | no |
| `pnpm test:when` | fechas, franjas y muletillas | no |
| `pnpm test:calendar` | iCalendar, suscripción y calendarios que bloquean | no |
| `pnpm test:signals` | teléfono, correo, presupuesto, cortesías | no |
| `pnpm test:gate` | cobertura de las reglas del clasificador | no |
| `pnpm test:booking` | el flujo de citas con muletillas; falla si llamó al modelo | no |
| `pnpm test:dictionary` | diccionario: aplicar, sumar, reemplazar, errores | no |
| `pnpm test:guards` | afirmaciones y cifras sin respaldo | no |
| `pnpm test:verifications` | por verificar, aprender, ventana de 24 h | no |
| `pnpm test:misses` | frases que no entendimos y expresiones | no |
| `pnpm test:reminders` | recordatorio: cuándo, por qué canal, a mano, respuesta | no |
| `pnpm test:brand` | contraste de la marca con 500 colores | no |
| `pnpm test:meta` | credenciales de Meta: validar, verificar, guardar | no (Meta simulado) |
| `pnpm test:profile` | perfil: guardar, aplicar, lo que llega al bot | no |
| `pnpm test:router` | qué modelo responde: el pesado solo para lo específico | no |
| `pnpm test:schedule` | cuándo corre el análisis: ráfaga, conversación activa, flush | no |
| `pnpm test:public` | aviso de dirección pública caída: 3 fallas, aviso al caer y al volver, otro servidor | no |
| `pnpm test:scenarios` | las conversaciones del cliente (`evalFile`), con su consumo | sí |
| `pnpm replay` | las conversaciones sintéticas con los motores configurados; proyecta el costo | sí |

Reglas para probar sin romper nada:

- Las pruebas que escriben usan una base, un archivo o un `.env` temporales (`DB_PATH`, `AIVA_ENV_FILE` y el
  archivo del perfil o del diccionario en una carpeta temporal). Las que usan la base real trabajan con contactos
  `test:` y los borran al terminar.
- **Nunca se escriben hechos de prueba en la información real del cliente.**
- Para probar en el navegador o con conversación real sin tocar lo real, se levanta un servidor aparte con una copia
  de la base y de la configuración:

  ```bash
  sqlite3 data/aiva.db ".backup /tmp/aiva-prueba/aiva.db"
  # copia aiva.config.json a /tmp/aiva-prueba y apunta dictionaryFile y profileFile a copias allí
  AIVA_CONFIG=/tmp/aiva-prueba/aiva.config.json DB_PATH=/tmp/aiva-prueba/aiva.db PORT=3100 WHATSAPP_ENABLED=false npx tsx src/index.ts
  ```

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
- Túnel fijo con dominio propio y despliegue en el Mac Mini (con pm2).
- Calibrar los pesos del puntaje cuando haya resultados reales (vendido o perdido).
