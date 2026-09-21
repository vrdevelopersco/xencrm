# Aiva · CRM conversacional con IA local para WhatsApp

Aiva atiende clientes por WhatsApp y por un widget web con un agente de IA que **corre en tu Mac**
(Apple Foundation Models + Gemma en Ollama, u OpenAI si lo prefieres), y convierte cada
conversación en un prospecto con **puntaje explicable de probabilidad de cita o venta**,
**análisis de sentimiento**, **datos capturados**, **citas agendadas** y **traspaso a una persona
del equipo** desde un tablero en vivo.

Nació como asistente de compras y hoy es un CRM conversacional configurable por cliente. El primer
cliente es **DUNOR Boutique** (dunor.co): alquiler premium y diseño a la medida de moda masculina en
Barranquilla, solo con cita previa. Su configuración está en `examples/dunor` (con `POR-CONFIRMAR.md`:
lo que el sitio no publica y hay que preguntarle al cliente). Otros ejemplos: `examples/boutique`
(sastrería con precios) y `examples/casa-verde` (tienda de plantas).

## Qué hace

| Pieza | Qué resuelve |
|---|---|
| **Agente** | Responde con la persona del negocio, solo con su catálogo e información (RAG). Guarda el alcance: nada de tareas, poemas ni temas ajenos. Las preguntas típicas (dónde quedan, horario, pagos, envíos, "¿cuánto cuesta el alquiler de un esmoquin?") las clasifican reglas sin modelo; lo ambiguo o fuera de tema, el modelo (`pnpm test:gate` mide la cobertura). |
| **Dos motores por rol** | Uno liviano y rápido (Apple) para saludos, info y compras puntuales; uno pesado (Gemma u OpenAI) para recomendar, comparar y explicar. Cada uno es respaldo del otro. |
| **Análisis comercial por turno** | Sentimiento, interés, urgencia, objeciones, presupuesto y los campos que definas (prenda, ocasión, fecha del evento…). |
| **Puntaje explicable** | 0 a 100 con factores visibles ("Pidió cita +30", "Objeción −10"). Etapas: nuevo, conversando, interesado, cita agendada, vendido, perdido. |
| **Citas** | Flujo determinista: ofrece espacios reales según tu agenda, confirma y registra. El modelo nunca inventa fechas. |
| **Traspaso humano** | El cliente pide una persona o el equipo toma el control desde el tablero; el bot se calla y las respuestas humanas llegan al mismo chat (WhatsApp o widget). |
| **Tablero** | Bandeja en vivo, conversación, ficha, pipeline arrastrable, calendario, análisis accionable, estado del agente y base de conocimiento. |
| **Canales** | WhatsApp por Baileys (QR) o por Meta Cloud API (oficial), widget web embebible, MCP para otros agentes. |

## Arquitectura

```
WhatsApp (Baileys / Meta) ─┐                               ┌─► Apple FM  (liviano)
Widget web ────────────────┼─► gate ─► RAG ─► enrutador ───┼─► Gemma/Ollama (pesado) ─► post-proceso ─► respuesta
MCP ───────────────────────┘    │                          └─► OpenAI (nube, opcional)         │
                                │                                                              │
                                └──► modo humano / flujo de citas (deterministas)              └─► análisis por turno ─► ficha, puntaje, etapa ─► tablero (SSE)
```

- `src/agent/` gate de intención, enrutador, prompts, post-proceso.
- `src/llm/` motores (`ollama.ts`, `apple.ts` + `sidecar/`, `openai.ts`) y la capa por roles (`engines.ts`).
- `src/rag/` índice SQLite (vectorial + FTS5) e ingesta de catálogo, markdown, páginas del sitio o Shopify.
- `src/crm/` contactos, análisis y puntaje, citas, flujo de agendamiento, eventos, envío al cliente.
- `src/channels/` WhatsApp (Baileys), Meta Cloud API, web + widget, API del tablero.
- `public/` widget embebible y tablero. `examples/` clientes de ejemplo. `sidecar/` Apple Foundation Models.

## Requisitos

- macOS con Apple Silicon. Probado en M1 Pro 16 GB; el Mac Mini M4 es el destino.
- [Ollama](https://ollama.com) ≥ 0.20, Node ≥ 22.13, pnpm.
- Motor Apple (opcional): macOS 26+, Apple Intelligence activo y Command Line Tools.
- Motor OpenAI (opcional): `OPENAI_API_KEY`.

```bash
ollama pull gemma4:e4b && ollama pull bge-m3
pnpm install
pnpm build:sidecar          # motor Apple (si aplica)
```

## Configurar un cliente

```bash
pnpm onboard                # asistente: desde un ejemplo (dunor | boutique | casa-verde) o desde cero
pnpm ingest                 # indexa catálogo + información + páginas del sitio
pnpm test:scenarios         # batería de conversaciones del cliente
pnpm dev                    # web (:3000), tablero (/admin) y WhatsApp (QR)
```

Aiva no está amarrada a un negocio: todo lo propio de cada cliente vive en su configuración.

| Dónde | Qué va | Ejemplos |
|---|---|---|
| `aiva.config.json` | El negocio y cómo atiende | nombre, descripción, sitio, moneda, país e indicativo telefónico (`phoneCountryCode`, `phoneLocalDigits`), contacto humano; nombre y estilo del agente, su objetivo y lo que dice cuando no sabe algo (`agent.verifyPhrase`); fuentes (catálogo, información, páginas); zona horaria; agenda de citas (servicio, lugar, días, franjas, `askPhone`, `askEmail`); campos que captura el análisis (`crm.fields`); archivo del **diccionario** (`dictionaryFile`); escenarios y datos de demostración |
| `.env` | La máquina y los secretos | motores y modelos por rol, claves de OpenAI y Meta, puerto, `PUBLIC_URL`, token del tablero, calendarios del dueño |
| Tablero › Canales | Lo que se decide en el día a día | encender o apagar el chat web, WhatsApp (con su QR), WhatsApp oficial y MCP, sin reiniciar |

El **diccionario** es lo que cada cliente le enseña a aiva sin tocar código: temas que se responden
con su información (palabras que los disparan y con qué se busca), los verbos con que su gente
pregunta por lo que ofrece y las **expresiones** propias de sus clientes, que se leen como otra cosa
antes de aplicar las reglas (fechas, temas y el flujo de la cita), sin importar tildes ni mayúsculas.
Vive en su propio archivo (`dictionaryFile` en `aiva.config.json`; el de
DUNOR es `examples/dunor/dictionary.json`):

```json
{
  "offerVerbs": ["alquilan", "confeccionan", "arreglan", "diseñan"],
  "topics": [{ "keywords": ["nequi", "daviplata", "pse", "bancolombia"], "query": "formas de pago" }],
  "expressions": [{ "says": "a la hora del cafecito", "means": "a las 3" }]
}
```

En el tablero (Agente › Diccionario del negocio) se ve lo que tiene, se **exporta** (descarga el JSON
con una nota que explica el formato) y se **importa**: *sumar* agrega un paquete sin repetir (por
ejemplo, uno de pagos de Colombia para cualquier cliente colombiano) y *reemplazar* lo cambia todo
después de confirmar. Se valida antes de guardar (los errores dicen qué y dónde), se guarda una copia
de la versión anterior (`.anterior.json`) y se aplica sin reiniciar. Pruebas: `pnpm test:dictionary`.

Lo genérico del español (dónde quedan, horario, pagos, envíos, cambios, parqueadero, "¿tienen…?",
"¿venden…?") ya viene en el código. Lo que un cliente real no logra que las reglas entiendan queda en
**Agente › Frases que no entendimos**:

- **Fechas y horas** que tuvo que interpretar la IA ("a la hora del almuerzo").
- **Frases cortas** que clasificó la IA y una regla podría resolver (un saludo, un pedido de cita,
  pedir una persona, una pregunta de la tienda).
- **Respuestas cortas** que sacaron al cliente del flujo de la cita ("la que sea").

Se agrupan por frase (sin tildes ni mayúsculas) con cuántas veces y cuántas personas. Con
**Enseñar** se escribe qué quiere decir y se guarda como expresión del diccionario, solo si con eso
las reglas ya entienden la frase; si no, no se guarda y se dice por qué. La próxima vez se resuelve
sin IA. Lo que sea del español en general va mejor a las reglas del código, con su prueba sin modelo
(`pnpm test`). Pruebas: `pnpm test:misses`.

Un cliente por proceso: para varios clientes, una carpeta, un `.env` y un puerto por cada uno
(`pnpm onboard` arma los dos archivos, desde cero o desde un ejemplo). `AIVA_CONFIG` y `DB_PATH`
permiten usar otro archivo de configuración y otra base desde la misma carpeta (por ejemplo, una
copia para pruebas que no toquen el diccionario ni los datos reales).

### Catálogo e información
- `sources.productsFile`: JSON o CSV con `id, name, description, price, currency, category, tags, url, inStock, image` y opcionalmente `specs` (ficha técnica clave/valor: lo que el bot usa cuando piden detalles).
- `sources.knowledgeDir`: un `.md` por tema (proceso, pagos, tiempos, garantía, ubicación…).
- `sources.sitePages` / `sources.shopifyUrl`: páginas del sitio o tienda Shopify a leer.

### Citas
`appointments`: servicio, lugar, duración, días (0=domingo…6=sábado), franjas, cupos, antelación
mínima y horizonte. El bot ofrece tres espacios reales, entiende "la 2", "el sábado en la tarde",
"mañana después de las 5", "el 2 de octubre a las 4", "la otra semana temprano" u "otro día", confirma y
registra. Las fechas las interpretan reglas (`src/crm/when.ts`, pruebas con `pnpm test:when`); solo si el
cliente habla de tiempo y las reglas no lo entienden ("después del puente"), el modelo traduce la frase a
un filtro. Los espacios siempre salen de la agenda: el modelo nunca elige la fecha. Si no hay espacio en
lo pedido, dice por qué (día sin atención, fuera de horario, agenda no abierta) y ofrece lo más cercano.
Al escoger el horario, si el canal no trae el número (el chat web; WhatsApp sí lo trae), el bot pregunta a qué
número confirmar y ofrece dejar el correo (opcional). El número se guarda en formato internacional (+57…); sin
número no se agenda y se ofrece el contacto directo. Se configura con `appointments.askPhone` y `askEmail`.
Frases como "al medio día", "la de las 12", "la última" o "sisas" escogen de la lista ya ofrecida; las pruebas
de estas muletillas están en `pnpm test:booking` (sin modelo).

**Cambiar o cancelar por el chat.** Si el cliente tiene una cita próxima y escribe "quiero cancelar mi
cita", "ya no puedo ir", "¿la puedo pasar para el jueves en la tarde?" o "córremela para mañana", lo
atiende el flujo de citas (nunca el modelo, que podría decir "listo, cancelada" sin haberlo hecho):
cancelar pide confirmación; cambiar ofrece espacios con las mismas reglas de fechas y franjas, agenda
la nueva y solo después cancela la anterior. Si solo dice "sobre mi cita", pregunta si quiere
cambiarla o cancelarla. El equipo recibe aviso cuando un cliente cancela o mueve su cita.

Desde el tablero también se agenda a mano.

### Lo que el bot no sabe: "deja te verifico eso"
Si le preguntan algo que no está en la información del negocio (wifi, parqueadero, una política),
el bot no lo supone: responde con la frase del negocio (`agent.verifyPhrase`, por defecto "Deja te
verifico eso con el equipo y te confirmo por aquí 🙂") y la pregunta queda en **Hoy › Por
verificar**, con aviso al equipo. Desde ahí se responde (le llega al cliente por su mismo canal, sin
quitarle la conversación al bot) o se descarta. Con "Agregar a la información", la respuesta se
suma a `respuestas-del-equipo.md` dentro de la información del cliente y se indexa al instante: la
próxima vez el bot ya lo sabe. Pruebas: `pnpm test:verifications`.

### Calendario (Google, Outlook, Apple)
Todo en formato iCalendar estándar, sin cuentas conectadas ni tokens de IA:
- **Suscripción a las citas**: el tablero (Agente → Calendario) muestra un enlace secreto
  `/calendar/<token>.ics` para suscribirse desde Google Calendar, Outlook o Apple Calendar. Google y
  Outlook necesitan `PUBLIC_URL` (el túnel) y refrescan cada varias horas; Apple Calendar cada 15 min.
- **Para el cliente**: con `PUBLIC_URL`, la confirmación de la cita trae un enlace a una página con
  botones para Google Calendar, Apple (iPhone/Mac), Outlook y Outlook.com, con recordatorios un día y
  dos horas antes.
- **Tu calendario bloquea la agenda**: pon en `CALENDAR_BUSY_ICS` la dirección secreta iCal de tu
  calendario personal y el bot no ofrecerá esas horas (se lee cada 5 min; entiende eventos repetidos,
  excepciones, días completos y zonas horarias de Google y Outlook). Desde el tablero sí se puede agendar
  encima de un evento personal. Pruebas: `pnpm test:calendar`.

### Consumo de IA
Cada llamada a un modelo queda registrada (tokens de entrada, caché, salida y razonamiento). El
tablero (Agente → Consumo) y `pnpm usage [--days=7]` muestran el costo por tarea, por conversación y
por mensaje, con la tarifa estándar de OpenAI. `pnpm replay` repasa las conversaciones sintéticas del
cliente (`seedFile` y `evalFile`) con los motores configurados y proyecta el costo por 1.000
conversaciones.

### Análisis comercial
`crm.fields`: además de sentimiento, interés, urgencia, objeciones, presupuesto, nombre y ciudad,
el análisis captura los campos que definas (para la boutique: prenda, ocasión, fecha del evento,
talla o medidas). El puntaje es una suma de factores visibles en la ficha; cuando haya historial
de resultados (vendido/perdido) los pesos se pueden calibrar con datos.

Para no gastar tokens de más (`src/crm/signals.ts`):
- **Datos exactos por código**: teléfono, correo, presupuesto ("no más de 2 millones", "800 mil", "2 palos"),
  si preguntó precio y si pidió o tiene cita. Pisan lo que diga el modelo.
- **Sin modelo cuando no hace falta**: si lo nuevo son pasos cortos de la cita o cortesías ("ok",
  "gracias"), el código actualiza la ficha y recalcula el puntaje (motor "reglas" en el historial).
- **Solo lo nuevo**: el modelo recibe la ficha anterior y los mensajes nuevos, no toda la conversación.
  Lo ya dicho (nombre, ciudad, presupuesto, campos del cliente) no se borra si el modelo no lo repite.
  "Reanalizar" en el tablero manda la conversación completa.
- `OPENAI_EFFORT_ANALYSIS` (none … high) ajusta cuánto razona el modelo del análisis: sus tokens de
  razonamiento se cobran como salida. Pruebas: `pnpm test` (sin modelo) y `pnpm replay` (costo real).

## Tablero

`http://localhost:3000/admin` con el token `ADMIN_TOKEN` (si está vacío, el servidor imprime uno
al arrancar). Todo se actualiza en vivo. Cada número del Análisis abre la lista que lo explica.
"Responde: Aiva | Tú" cambia quién lleva cada conversación; escribir a mano toma el control.

## Canales

La sección **Canales** del tablero muestra cada canal con su estado (conectado, esperando el QR, sin
configurar, error), cuántos mensajes llegaron en la semana, qué falta para conectarlo y los datos a
copiar (código del widget, URL del webhook, token enmascarado). WhatsApp por QR se vincula
escaneando el código desde ahí mismo. Encender o apagar un canal se guarda en la base y aplica sin
reiniciar; los secretos siguen en `.env`. Instagram y Messenger aparecen con lo que se necesita:
el adaptador se construye cuando haya credenciales de prueba de Meta.

- **Baileys** (QR con el número de la tienda): no necesita túnel ni cuenta de negocio, pero es
  protocolo no oficial; úsalo para pruebas y volúmenes bajos.
- **Meta Cloud API** (oficial, para producción): `META_ACCESS_TOKEN`, `META_PHONE_NUMBER_ID`,
  `META_VERIFY_TOKEN`, `META_APP_SECRET` en `.env` y el webhook `https://TU-DOMINIO/webhooks/meta`
  registrado en Meta. Requiere negocio verificado y plantillas para escribir fuera de la ventana de
  24 horas. aiva respeta esa ventana: si pasaron más de 24 horas desde el último mensaje del
  cliente, no envía (ni guarda como enviado) lo que Meta rechazaría. El tablero lo advierte en la
  conversación y en "Por verificar" (con cuánto tiempo queda cuando faltan menos de 3 horas), y la
  verificación sigue pendiente hasta que el cliente vuelva a escribir. Este adaptador está escrito
  contra la documentación pero **no se ha probado con credenciales reales**.
- **Widget**: `<script src="https://TU-DOMINIO/widget.js" async></script>`. Carga el historial,
  muestra las respuestas del equipo en vivo y avisa cuando atiende una persona.
- **Túnel** para el widget, el tablero y el webhook: `cloudflared tunnel --url http://localhost:3000`
  (pon la URL en `PUBLIC_URL` y restringe `ALLOWED_ORIGINS`).

## Motores

| Rol | Variable | Por defecto | Para qué |
|---|---|---|---|
| liviano | `LIGHT_ENGINE` | apple | saludos, info de tienda, compras puntuales |
| pesado | `HEAVY_ENGINE` | ollama | recomendar, comparar, detalles, montos, seguimientos |
| gate | `GATE_ENGINE` | ollama | clasificación de intención (JSON) |
| análisis | `ANALYSIS_ENGINE` | = gate | análisis comercial por turno |

`LLM_ENGINE=ollama|apple|openai` fuerza un solo motor. Si varios roles usan OpenAI, cada uno puede
tener su modelo (`OPENAI_MODEL_LIGHT`, `_HEAVY`, `_GATE`, `_ANALYSIS`; vacío = `OPENAI_MODEL`): por
ejemplo un mini para responder y uno mayor para el análisis, que corre en segundo plano. Los modelos de
razonamiento (gpt-5, gpt-5.5…) se detectan solos: no reciben `temperature` y tienen margen para pensar. Con `HEAVY_ENGINE=openai` el cliente que ya
paga OpenAI recibe la nube donde más aporta y lo local donde basta. Guardas independientes del
motor: filtro de enlaces (solo los del contexto), verificación de cifras (un precio que no está en
el contexto se descarta y se regenera con el otro motor), afirmaciones sin respaldo ("¿tienen
wifi?" → "sí, tenemos wifi" sin que la información lo diga: se rehace pidiendo no suponer y, si
insiste, se responde que se confirma con el equipo), limpieza de saludos repetidos. Pruebas:
`pnpm test:guards`.

## Capacidad y memoria

Medido en un M1 Pro de 16 GB con otras apps abiertas: turnos livianos de 3 a 5 s, pesados de 6 a
9 s, ~20 mensajes por minuto sostenidos con 6 clientes a la vez. Los motores procesan de a uno;
con concurrencia la latencia crece por cola. El análisis corre 4 s después del último mensaje para
no competir con la respuesta. Si la máquina se comparte, `NUM_CTX=4096` y `OLLAMA_NUM_PARALLEL=1`
reducen memoria. En el Mac Mini dedicado no hace falta.

## Dejarlo corriendo

```bash
pnpm add -g pm2
pm2 start "pnpm start" --name aiva --cwd /ruta/a/aiva
pm2 save && pm2 startup
```

## Advertencias

- Un cliente por proceso: para varios clientes, una carpeta, un `.env` y un puerto por cada uno.
- Apple Foundation Models aplica un límite de peticiones en segundo plano (no documentado) y sus
  guardrails pueden rechazar mensajes inocuos: en ambos casos el turno cae al otro motor.
- El puntaje es una estimación explicable, no una probabilidad calibrada, hasta tener resultados
  reales para ajustar pesos.
- Mandar los chats a OpenAI es una decisión de privacidad del cliente; la opción local existe para
  quien no quiera hacerlo.
