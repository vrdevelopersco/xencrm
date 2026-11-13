# XENCRM · CRM conversacional con IA para WhatsApp

## Resumen del proyecto

XENCRM es un CRM conversacional para gestionar clientes, ventas y servicio desde WhatsApp y el chat de un sitio web. Combina una bandeja de atención, un agente de IA, seguimiento de prospectos, citas, tickets y métricas. Cada negocio puede configurar su propio flujo y operar en una instancia separada.

### Stack tecnológico

- **Aplicación:** TypeScript y Node.js 22.13 o superior, con pnpm; interfaz web en HTML, CSS y JavaScript.
- **Datos y conocimiento:** SQLite por cliente, búsqueda de texto completo y recuperación de información para el agente (RAG).
- **IA:** integración con OpenAI, Anthropic, Ollama y APIs compatibles con OpenAI; Apple Foundation Models mediante un componente Swift opcional.
- **Canales e integración:** WhatsApp, chat web, calendario y servidor MCP.

### Qué falta

- Implementar el análisis de sentimiento por voz y definir la retención de los audios; las notas de voz ya pueden transcribirse.
- Completar y validar los pendientes de despliegue e integraciones descritos en [el checkpoint](docs/checkpoint.md) y [la documentación de XENCRM](docs/xencrm.md).

### Posibles evoluciones

- Ampliar los canales e integraciones con herramientas comerciales y de atención.
- Mejorar la analítica y las recomendaciones para ventas y servicio con datos históricos.
- Facilitar el despliegue y la operación de múltiples negocios, manteniendo la separación de sus datos.

**XENCRM es la siguiente generación de un CRM conversacional** (hasta noviembre de 2026 se llamó aiva): el
mismo motor —agente de IA, citas, puntaje, traspaso a una persona— con una interfaz rehecha para trabajar como un
CRM de mensajería. Lo que cambia y por qué está en [`docs/xencrm.md`](docs/xencrm.md).

Qué cambia en esta generación:

- **Una sola piel.** La interfaz del modo fácil es la de todos, con identidad propia (bruma verde agua, tinta verde
  petróleo, el acento teal y el violeta solo para lo que dice la IA). El modo fácil sigue existiendo, pero ya no
  cambia el aspecto: solo esconde lo avanzado y pone el candado.
- **El vocabulario de un CRM de mensajería.** La bandeja es la **Bandeja omnicanal**; cada persona en su etapa, un
  **trato**; tomar una conversación es **pausar la automatización**.
- **Modelos de IA** en Configuración: conectar OpenAI, Anthropic, Apple Foundation Models, Ollama, LM Studio o
  cualquier API compatible con OpenAI, y elegir cuál hace cada cosa.
- **Sentimiento** en Analítica, con emojis por interés y desinterés, y el análisis por voz como pantalla por
  desarrollar.
- **Una suite de CRM, como Dynamics 365.** El menú va por áreas (**Ventas**, **Servicio**, **Configuración**) y
  grupos (Mi trabajo, Clientes, Ventas, Rendimiento), con Recientes y Fijados. Pantallas nuevas: **Embudo**, vistas y
  filtros guardados, **KPIs y metas**, **Cuentas clave** (KAM), **Optimización de ventas** y la **Lista de trabajo**.
- **Servicio con SLA.** **Tickets** con el reloj del SLA de cada plan (hábil o 24/7, en riesgo, incumplido), la
  pantalla **SLA** con el cumplimiento por plan y prioridad, y **Mantenimientos y actualizaciones** con los clientes
  afectados y el aviso mínimo de su plan (el aviso se prepara, nunca sale solo).
- **Todo configurable**, en tres capas (fábrica → `xencrm.config.json` → el tablero): Reglas y umbrales (64 reglas),
  SLA y tickets, Mantenimientos y actualizaciones, y el vocabulario del negocio (cita, demo, turno…).
- **El ejemplo es XENTRIS LLC**, una firma de software (`examples/xentris`). Capturas de todas las pantallas en
  [`docs/capturas/xencrm-next-evolution/`](docs/capturas/xencrm-next-evolution/).

XENCRM atiende clientes por WhatsApp y por el chat del sitio con un agente de IA que resuelve lo que puede con
reglas y usa el modelo cuando hace falta: OpenAI con un modelo por tarea, o motores que corren en el Mac (Gemma en
Ollama y Apple Foundation Models). Convierte cada conversación en un prospecto con **puntaje explicable**,
**análisis de sentimiento**, **datos capturados**, **citas agendadas con recordatorio** y **traspaso a una persona
del equipo**, desde un tablero en vivo. Lo que no sabe no lo inventa: lo verifica con el equipo y lo aprende.

> **El renombre es completo.** Todo dice XENCRM, también lo de adentro: las variables `XENCRM_*`, el archivo
> `xencrm.config.json`, la base `data/xencrm.db` y sus respaldos `xencrm-*.db`, la galleta `xencrm_consola`, las
> cabeceras `x-xencrm-*`, las llaves `xencrm.*` del navegador (las viejas se mudan solas la primera vez), los procesos
> `xencrm-<cliente>` de pm2 y la herramienta MCP `ask_xencrm`. Una instalación que venga de antes se migra con
> `node herramientas/migrar-a-xencrm.mjs` (dice qué haría; con `--aplicar` lo hace, con respaldo). El nombre del
> asistente lo pone cada negocio (`agent.name`); el de fábrica es «Xen».

Nació como asistente de compras y hoy es un CRM conversacional **multicliente**: cada negocio corre en su propia
instancia —su base, su WhatsApp, su token, su dominio— y se operan todos desde una consola (`pnpm consola`), donde
se dan de alta, se vigilan y se atienden. El embudo, los datos que captura y si agenda citas los pone cada negocio
en su configuración: una boutique agenda, una financiera resuelve solicitudes, una litografía cotiza y produce.

El ejemplo de XENCRM es **XENTRIS LLC**, un socio de tecnología, con la identidad y los servicios de xentris.tech:
software y apps a la medida, nube e infraestructura, IA y automatización, y consultoría y transformación digital; y da
soporte con SLA por planes (Básico, Pro, Enterprise): actualizaciones mensuales, mantenimientos con
aviso y tickets con tiempos garantizados. El embudo es Nuevo → Calificado → Evaluando → Demo agendada → Ganado ·
Perdido, y lo que agenda es una demo de producto por videollamada. Su configuración es la de la raíz y vive en
`examples/xentris` (catálogo, conocimiento, diccionario, perfil, escenarios y 23 contactos de ejemplo con sus tickets).
Otros ejemplos: `examples/boutique` (sastrería con precios) y `examples/casa-verde` (tienda de plantas). Las pruebas
no dependen del ejemplo: corren contra su propio negocio de mentira, `src/eval/fixtures/boutique` («Atelier Demo»).
Los clientes en producción corren con OpenAI: `gpt-5.4-mini`
para responder, clasificar y analizar, y `gpt-5.4` para las respuestas pesadas.

## Documentación

- Este README: qué hace, cómo se instala y cómo se configura un cliente.
- **Ayuda**, dentro del tablero: el tutorial rápido para el equipo del negocio.
- [`docs/xencrm.md`](docs/xencrm.md): XENCRM de punta a punta: la piel, los tokens y el glosario, el mapa de
  Dynamics, cada pantalla nueva, Servicio y el SLA, la configuración en tres capas y lo que queda abierto.
- [`docs/guia-del-tablero.md`](docs/guia-del-tablero.md): la referencia completa del tablero, para entrenar al
  equipo: qué hay en cada pantalla y qué hacer con cada cosa.
- [`docs/arquitectura.md`](docs/arquitectura.md): para quien cambia el código. Cubre el recorrido de un mensaje,
  los módulos, los datos, la configuración por capas, las pruebas y cómo extender XENCRM.
- [`docs/diseno-tablero.md`](docs/diseno-tablero.md): las reglas de diseño del tablero (contraste, material,
  colores de dato), con sus mediciones.
- [`docs/demo.md`](docs/demo.md): el guion del demo en vivo, con la lista de lo que hay que dejar listo antes.
- [`docs/aprender-del-historial.md`](docs/aprender-del-historial.md): cómo aprovechar las conversaciones que ya
  tiene un cliente (el estilo sí, los precios no) y qué hace falta antes de tocarlas.
- [`docs/migrar-a-hostinger.md`](docs/migrar-a-hostinger.md): qué apps de OCI caben en un hosting de apps y
  cuáles no, con el porqué de cada una.
- [`docs/consola.md`](docs/consola.md): operar varios clientes: montar uno nuevo, atenderlos a todos desde una
  pantalla, roles y qué pasa al dar de baja a un cliente.
- [`docs/desplegar.md`](docs/desplegar.md): subir todos los clientes en un solo despliegue, separados por ruta:
  qué queda publicado, qué variables van en el panel y dónde quedan los datos.
- [`docs/xencrm-producto.pdf`](docs/xencrm-producto.pdf): lo que hace XENCRM, en una hoja, para mostrarle a un cliente
  (se regenera con `pnpm producto`).
- [`herramientas/mirar.mjs`](herramientas/mirar.mjs): abre una pantalla en un navegador de verdad, con la sesión
  puesta, y dice qué se ve y qué errores de JavaScript hubo. Las pruebas no cogen eso.
- [`docs/arreglos.md`](docs/arreglos.md): la bitácora de arreglos: qué fallaba, qué cambió y cómo se comprobó, con
  su commit.
- [`docs/checkpoint.md`](docs/checkpoint.md): dónde quedó el trabajo al cerrar la última sesión, qué falta para
  desplegarlo y qué espera una decisión.
- `examples/xentris/`: el ejemplo completo (XENTRIS LLC), para enseñar XENCRM con datos que parecen de verdad.

## Qué hace

| Pieza | Qué resuelve |
|---|---|
| **Agente** | Responde con la persona del negocio, solo con su catálogo, su información y su perfil. Guarda el alcance: nada de tareas, poemas ni temas ajenos. Las preguntas típicas (dónde quedan, horario, pagos, envíos, "¿en cuánto me responden un ticket con el plan Pro?") las clasifican reglas sin modelo; lo ambiguo o fuera de tema, el modelo (`pnpm test:gate` mide la cobertura). |
| **No inventa** | Guardas contra cifras, enlaces y afirmaciones sin respaldo. Lo que no sabe lo dice ("Deja te verifico eso…") y queda en **Hoy › Por verificar**; la respuesta del equipo le llega al cliente y el bot la aprende. |
| **No guarda claves** | Una clave, un PIN, un código de verificación o un número de tarjeta que escriba alguien se tapa antes de guardarse y antes de llegar al modelo, y el asistente le pide con tacto no mandarlos por el chat. El correo y el teléfono no se tocan. `pnpm test:claves`. |
| **Motores por rol** | Uno liviano para saludos, info y compras puntuales; uno pesado para recomendar, comparar y explicar; uno para clasificar y otro para el análisis. Cada uno puede ser OpenAI (con su modelo), Gemma u Apple, y hay respaldo si uno falla. |
| **Aprende las frases de sus clientes** | Lo que las reglas no entienden ("a la hora del cafecito", "la madrugadora") queda en **Frases que no entendimos** y se enseña desde el tablero; la próxima vez se entiende sin IA. |
| **Perfil del negocio** | Dirección, horarios, pagos, precios, políticas y datos propios, editables desde el tablero; lo vacío queda "por confirmar" y el bot no lo supone. |
| **Análisis comercial por turno** | Sentimiento, interés, urgencia, objeciones, presupuesto y los campos que defina cada negocio (en XENTRIS: producto, empresa, usuarios, plan de soporte, plazo). |
| **Puntaje explicable** | 0 a 100 con factores visibles ("Pidió demo +30", "Objeción −10"); los pesos y los cortes son reglas configurables. Las etapas las pone cada negocio (en XENTRIS: Nuevo, Calificado, Evaluando, Demo agendada, Ganado, Perdido). |
| **Citas** | Flujo determinista: ofrece espacios reales según tu agenda, entiende muletillas ("al medio día", "la que sea", "en ocho días"), confirma, cambia o cancela por el chat y **recuerda la cita la mañana del día**. El modelo nunca inventa fechas. |
| **Una ficha por persona** | Si el mismo cliente escribe por el chat del sitio y por WhatsApp, el tablero lo detecta por el número y ofrece unir las dos fichas en una: conversación, citas, análisis y consumo quedan juntos. |
| **Traspaso humano** | El cliente pide una persona o el equipo toma el control desde el tablero; el bot se calla y las respuestas humanas llegan al mismo chat (WhatsApp o widget). |
| **Tablero** | Una suite de CRM por áreas: Inicio con el Copiloto XEN, Bandeja omnicanal, Lista de trabajo, Citas, Contactos, Cuentas clave, Embudo, Tratos, Ventas, KPIs y metas, Optimización de ventas y Analítica. En vivo, en el computador o el celular. |
| **Servicio y SLA** | Tickets con el reloj del SLA del plan de cada cliente, cumplimiento por plan y prioridad, mantenimientos con sus clientes afectados y avisos a tiempo, y la cadencia de actualizaciones por producto. |
| **Todo configurable** | Cada umbral, peso, plan, prioridad, estado, plazo y texto de negocio tiene su valor de fábrica, el del archivo del cliente y el del tablero, con «Volver al de fábrica». |
| **Canales** | WhatsApp por QR (Baileys) o por Meta Cloud API (oficial, con credenciales desde el tablero), chat del sitio con la marca del cliente, MCP para otros agentes. |

## Arquitectura

```
WhatsApp (QR / Meta) ─┐    modo humano · flujo de citas (deterministas)
Chat del sitio ───────┼─► clasificador ─► búsqueda o ficha completa ─► enrutador ─► motor del rol ─► guardas ─► respuesta
MCP ──────────────────┘   (reglas → modelo)   (catálogo, info, perfil)              (OpenAI / Gemma / Apple)    │
                                                                                                                ├─► "por verificar" (equipo)
recordatorios (cada minuto) ─► WhatsApp / plantilla / a mano                                                    └─► análisis ─► ficha, puntaje, etapa ─► tablero (SSE)
```

Detalle de cada paso, los módulos y los datos en [`docs/arquitectura.md`](docs/arquitectura.md). En corto:
`src/agent/` (recorrido, clasificador, guardas, diccionario), `src/llm/` (motores y consumo), `src/rag/` (índice e
ingesta), `src/crm/` (contactos, análisis, citas, recordatorios, verificaciones), `src/channels/` (canales y API del
tablero), `public/` (tablero y widget), `examples/` (clientes), `sidecar/` (Apple Foundation Models).

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
pnpm onboard                # asistente: desde un ejemplo (xentris | boutique | casa-verde) o desde cero
pnpm ingest                 # indexa catálogo + información + páginas del sitio
pnpm test:scenarios         # batería de conversaciones del cliente
pnpm dev                    # web (:3000), tablero (/admin) y WhatsApp (QR)
```

XENCRM no está amarrado a un negocio: todo lo propio de cada cliente vive en su configuración.

| Dónde | Qué va | Ejemplos |
|---|---|---|
| `xencrm.config.json` | El negocio y cómo atiende | nombre, descripción, sitio, moneda, país e indicativo telefónico (`phoneCountryCode`, `phoneLocalDigits`), contacto humano; nombre y estilo del agente, su objetivo y lo que dice cuando no sabe algo (`agent.verifyPhrase`); fuentes (catálogo, información, páginas); zona horaria; agenda de citas (servicio, lugar, días, franjas, `askPhone`, `askEmail`); **sedes**, si atiende en varios sitios; campos que captura el análisis (`crm.fields`); archivo del **diccionario** (`dictionaryFile`) y del **perfil** (`profileFile`); **marca** (`brand.color`, `brand.logo`); escenarios y datos de demostración |
| `.env` | La máquina y los secretos | motores y modelos por rol, claves de OpenAI y Meta, puerto, `PUBLIC_URL`, token del tablero, calendarios del dueño, tope de gasto inicial (`TOPE_USD_MES`) |
| Tablero › Perfil | Lo que el dueño confirma de su negocio | dirección, horarios, zona, contacto, pagos y abono, precios, políticas y datos propios (tallas, tiempos…) |
| Tablero › Canales | Lo que se decide en el día a día | encender o apagar el chat web, WhatsApp (con su QR), WhatsApp oficial y MCP, sin reiniciar; credenciales de WhatsApp oficial |

El **diccionario** es lo que cada cliente le enseña a XENCRM sin tocar código: temas que se responden
con su información (palabras que los disparan y con qué se busca), los verbos con que su gente
pregunta por lo que ofrece y las **expresiones** propias de sus clientes, que se leen como otra cosa
antes de aplicar las reglas (fechas, temas y el flujo de la cita), sin importar tildes ni mayúsculas.
Vive en su propio archivo (`dictionaryFile` en `xencrm.config.json`; el de
XENTRIS es `examples/xentris/dictionary.json`):

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

El **perfil** (Configuración › Perfil) es lo que el dueño confirma de su negocio: nombre, qué hace, sitio, ciudad,
dirección, horarios, zona que atienden, si es solo con cita, contacto, cómo hablar con una persona, formas de
pago, abono, precios, políticas y datos propios del negocio (planes, tiempos, lo que ofrecen o no). Vive en su
archivo (`profileFile`; el de XENTRIS es `examples/xentris/profile.json`), se guarda con copia del anterior y se
aplica al instante.

- Lo confirmado va en la información fija del prompt y en la búsqueda; si contradice otra información, vale el perfil.
- El nombre, la descripción, el sitio y el contacto humano del perfil reemplazan los de `xencrm.config.json`.
- Lo vacío queda **por confirmar**: el bot no lo supone. Si le preguntan, dice la frase de verificación y la
  pregunta llega a Hoy › Por verificar.
- Las notas para el equipo ("el sitio muestra un número y los botones otro") se ven en el formulario, pero no
  llegan al bot.

Pruebas: `pnpm test:profile`.

La **marca** (`brand`: `color` en hex y `logo`, una URL https o un archivo png, jpg, svg o webp que XENCRM
sirve en `/brand/logo`) se ve en el chat del sitio (cabecera, burbujas, botones y el logo) y en la página
de la cita. El color puede ser cualquiera: XENCRM calcula si el texto encima va blanco u oscuro y, si
ninguno se lee a 4.5:1, oscurece o aclara el color lo justo, en claro y en oscuro (`pnpm test:brand`
lo prueba con 500 colores). `data-color` en el `<script>` del chat lo cambia solo en ese sitio.
`pnpm onboard` pregunta la marca.

Un cliente por proceso: para varios clientes, una carpeta, un `.env` y un puerto por cada uno
(`pnpm onboard` arma los dos archivos, desde cero o desde un ejemplo). `XENCRM_CONFIG` y `DB_PATH`
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

**La fecha del evento no es la de la cita.** "El evento es este viernes", "la boda es el 15" o "es para mañana"
fijan un plazo: el bot ofrece espacios **antes** del evento, no ese mismo día. Si el cliente dice "sí" sin decir
cuál horario, se le pregunta cuál (nunca se da por agendada); si en el paso del teléfono responde algo que no es un
número, se le vuelve a pedir sin perder el horario elegido. Y si una respuesta del modelo da por hecha una cita que
no existe ("te esperamos en la cita"), se rehace: solo el flujo de citas agenda.

**Cambiar o cancelar por el chat.** Si el cliente tiene una cita próxima y escribe "quiero cancelar mi
cita", "ya no puedo ir", "¿la puedo pasar para el jueves en la tarde?" o "córremela para mañana", lo
atiende el flujo de citas (nunca el modelo, que podría decir "listo, cancelada" sin haberlo hecho):
cancelar pide confirmación; cambiar ofrece espacios con las mismas reglas de fechas y franjas, agenda
la nueva y solo después cancela la anterior. Si solo dice "sobre mi cita", pregunta si quiere
cambiarla o cancelarla. El equipo recibe aviso cuando un cliente cancela o mueve su cita.

**Varias sedes.** Un negocio que atiende en varios sitios con un mismo número las pone en `sedes` de su
`xencrm.config.json`. Cada sede tiene su nombre, su dirección, cómo la llama la gente y, si hace falta, sus propios días,
franjas y cupo; lo que no diga lo hereda de `appointments`:

```json
"sedes": [
  { "id": "norte", "nombre": "Sede Norte", "direccion": "Cra 53 # 82-20", "apodos": ["la del norte", "alto prado"] },
  { "id": "sur", "nombre": "Sede Sur", "direccion": "Calle 72 # 45-10", "apodos": ["la de la 72"], "days": [1, 2, 3, 4, 5, 6], "hours": [["08:00", "12:00"]] }
]
```

Con dos o más, el bot pregunta en cuál antes de ofrecer horarios, o la toma si el cliente ya la nombró ("una cita en
la del norte el sábado"). Entiende el número de la lista, el nombre y los apodos, y si nombra dos vuelve a preguntar.
Ofrece los espacios de esa sede, y si lo que pidió no existe ahí pero sí en otra, se lo dice y le ofrece la otra.
"Mejor en la del sur" cambia de sede a mitad del flujo. Cada sede tiene su cupo, la cita guarda la sede y la
confirmación, el recordatorio y el calendario del cliente dicen la dirección. La ficha recuerda la sede para la
próxima vez. Las sedes también van en la información del negocio, así que "¿dónde quedan?" se responde con todas.
Una sede no es otro cliente: si cada una tiene dueño, número y precios propios, son clientes aparte. Se editan
desde el tablero, en El negocio, y el calendario filtra por sede. También se pueden poner al dar de alta el cliente,
en la consola o con `pnpm cliente nuevo`: una por línea, con el nombre y la dirección. Sin sedes, que es lo de casi
todos, el asistente no oye hablar de ellas: nada en el prompt y ninguna pregunta de más al agendar. Si alguien pregunta
por sedes, se contesta con el Perfil, como cualquier otra pregunta. Pruebas: `pnpm test:sedes`.

**Recordatorio de la cita** (`appointments.reminder`: `at`, por defecto `"08:00"`, y `enabled`). Sale el mismo día de
la cita a esa hora, si queda al menos una hora antes. Si no, o si ese día la sede no atiende, sale el último día que
sí atiende, a la misma hora. Los días se cuentan en la hora del negocio, no en la del servidor.
Sale solo por el canal del cliente: WhatsApp por QR, o WhatsApp oficial dentro de las 24 horas.
Fuera de las 24 horas, WhatsApp oficial solo acepta una plantilla aprobada por Meta
(`reminder.metaTemplate`: `name`, `language`; cuerpo con `{{1}}` = nombre y `{{2}}` = fecha y hora).
Lo que no puede salir solo queda en **Hoy › Recordar a mano**, con el motivo, el texto listo y un botón
que abre WhatsApp con el mensaje escrito:

- el cliente llegó por el chat del sitio;
- la conversación la lleva una persona;
- WhatsApp no está conectado;
- no hay plantilla para escribir fuera de las 24 horas.

Si agendó poco antes de la hora del recordatorio, no se le envía. La respuesta la entiende el flujo de citas:

- "sí, ahí estaré" queda como **Confirmó**;
- "no puedo" o "se me complicó" queda como **No puede** y le pregunta si la pasamos o la cancela, con aviso al equipo;
- "cancélala" o "mejor el jueves" hacen lo de siempre.

Cada cita en Hoy muestra su estado. Pruebas: `pnpm test:reminders` (usa una base temporal y no toca las citas
reales).

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
  encima de un evento personal. Con sedes, ese calendario ocupa todas, porque es el del dueño; el de una
  sola sede va en `CALENDAR_BUSY_ICS_<SEDE>` (por ejemplo `CALENDAR_BUSY_ICS_NORTE`) y solo ocupa esa. Van en
  el `.env` y no en la configuración: son direcciones secretas. Pruebas: `pnpm test:calendar` y `pnpm test:sedes`.
- **En el tablero**: la semana en franjas de media hora (las citas que se cruzan, una al lado de la otra), una vista
  rápida por cita con el **enlace de la videollamada** (sale en el recordatorio y en el `.ics`), el panel «Hoy» con la
  próxima y su cuenta regresiva, y los **avisos**: festivos, días bloqueados, mantenimientos y días casi llenos.
  Los festivos de Colombia se calculan solos (`appointments.festivos`: `"CO"`, o `""` para ninguno; sin decirlo, sale
  de la zona horaria) y no cierran la agenda: se bloquea el día con un clic, y desde ahí el asistente no lo ofrece.
  Pruebas: `pnpm test:agenda`.

### Consumo de IA
Cada llamada a un modelo queda registrada (tokens de entrada, caché, salida y razonamiento). El
tablero (Agente → Consumo) y `pnpm usage [--days=7]` muestran el costo por tarea, por conversación y
por mensaje, con la tarifa estándar de OpenAI. `pnpm replay` repasa las conversaciones sintéticas del
cliente (`seedFile` y `evalFile`) con los motores configurados y proyecta el costo por 1.000
conversaciones. Simula un mensaje del cliente cada 30 s (`--gap=`) y corre el análisis con la misma regla que
en producción; `--fast` manda los mensajes seguidos.

**Cada turno queda guardado.** Cada respuesta del asistente deja su turno: qué entendió, por dónde lo mandó, con qué
motor y modelo, qué guardas saltaron, cuánto costó y con qué versión del código y del prompt salió. Sus llamadas al
modelo y sus mensajes llevan el mismo identificador. En la conversación, quien administra tiene **¿por qué?** debajo
de cada respuesta. Se guardan 90 días. La versión que corre la dicen `/_salud`, la consola y el tablero. Pruebas:
`pnpm test:turnos`.

**Tope de gasto.** Cada cliente puede tener un tope en dólares al mes, que se pone en la consola (Configuración ›
Motores, solo el super-admin) o con `TOPE_USD_MES` en su `.env`. Se cuenta el mes calendario en la hora del
negocio, y solo lo de OpenAI: los motores de la máquina no cuestan. Se aplica al instante, sin reiniciar.

| Al llegar a | Pasa esto |
|---|---|
| 80 % | Aviso por la campana, un ticket en la consola y un WhatsApp al equipo si hay a quién avisar |
| 90 % | Lo específico lo contesta el modelo de responder, que es el barato |
| 100 % | No se llama a la IA de pago hasta el mes siguiente o hasta subir el tope |

Al 100 % nadie se queda sin respuesta. Lo que se resuelve sin IA sigue igual: citas, pedir una persona y
respuestas rápidas. Lo demás pasa al equipo y al cliente se le dice que le contesta una persona. Esas
conversaciones se quedan con el equipo hasta que alguien se las devuelva al asistente, como cuando alguien pide una
persona. Si hay un motor en
la máquina, como Ollama o Apple, sigue contestando ese. La ficha se actualiza con lo que sabe el código y las notas
de voz quedan guardadas sin transcribir. Cada aviso sale una vez por escalón y por mes.
Pruebas: `pnpm test:presupuesto`.

**Caché de OpenAI.** OpenAI cobra 90 % menos por el inicio del prompt que ya vio. En la práctica,
con `gpt-5.4-mini` solo pega cuando el inicio común pasa de unos 1.450 tokens (medido, no
documentado). La persona y las reglas solas (unos 1.100) no alcanzan. Por eso, si toda la
información del negocio cabe en `agent.fullInfoMaxTokens` (6.000 por defecto), va entera y fija
después de la persona: el modelo la ve completa y el inicio común pasa de 3.000 tokens. Lo que
cambia en cada turno (nombre del cliente, pistas de la búsqueda, nota) va después del historial.
En los escenarios de DUNOR, con la caché caliente, una respuesta liviana bajó de $0.0015 a $0.0009
(87 % de la entrada desde caché) y una pesada de $0.0067 a $0.0053. Con la caché fría cuesta más
que antes, por eso se pide retención de 24 horas (`prompt_cache_retention`) y una clave por negocio
y tarea (`prompt_cache_key`). Si la API no los acepta, se omiten solos. Catálogos grandes, Apple y
Ollama siguen con la búsqueda. El clasificador y el análisis no llegan al mínimo y no usan caché.

### Análisis comercial
`crm.fields`: además de sentimiento, interés, urgencia, objeciones, presupuesto, nombre y ciudad,
el análisis captura los campos que definas (para XENTRIS: producto, empresa, usuarios, plan de soporte y
plazo; para una boutique serían la prenda, la ocasión o la talla). El puntaje es una suma de factores visibles en la ficha; cuando haya historial
de resultados (vendido/perdido) los pesos se pueden calibrar con datos.

Para no gastar tokens de más (`src/crm/signals.ts`):
- **Datos exactos por código**: teléfono, correo, presupuesto ("no más de 2 millones", "800 mil", "2 palos"),
  si preguntó precio y si pidió o tiene cita. Pisan lo que diga el modelo.
- **Sin modelo cuando no hace falta**: si lo nuevo son pasos cortos de la cita o cortesías ("ok",
  "gracias"), el código actualiza la ficha y recalcula el puntaje (motor "reglas" en el historial).
- **Cuando la conversación hace una pausa**: el análisis corre tras 60 s de silencio
  (`crm.analysisQuietSeconds`) y, si la conversación sigue activa, a más tardar a los 5 minutos del primer mensaje
  sin analizar (`crm.analysisMaxWaitSeconds`). Medido con las conversaciones de DUNOR a un mensaje cada 30 s:
  8 análisis en vez de 17 (−53 % en análisis, −19 % en el total por conversación). "Re-analizar" corre ya.
- **Solo lo nuevo**: el modelo recibe la ficha anterior y los mensajes nuevos, no toda la conversación.
  Lo ya dicho (nombre, ciudad, presupuesto, campos del cliente) no se borra si el modelo no lo repite.
  "Reanalizar" en el tablero manda la conversación completa.
- `OPENAI_EFFORT_ANALYSIS` (none … high) ajusta cuánto razona el modelo del análisis: sus tokens de
  razonamiento se cobran como salida. Pruebas: `pnpm test` (sin modelo) y `pnpm replay` (costo real).

## Tablero

`http://localhost:3000/admin` con el token `ADMIN_TOKEN` (si está vacío, el servidor imprime uno al arrancar).
Todo se actualiza en vivo y funciona en el celular (el menú se abre desde la barra de arriba). El menú va por áreas:

- **Ventas** — *Mi trabajo*: Inicio (el Copiloto XEN y lo que espera a alguien), Bandeja omnicanal, Lista de trabajo,
  Citas (o como las llame el negocio). *Clientes*: Contactos, Cuentas clave. *Ventas*: Embudo, Tratos, Ventas.
  *Rendimiento*: KPIs y metas, Optimización de ventas, Analítica (con Sentimiento).
- **Servicio** — Bandeja omnicanal, Tickets, Contactos, Cuentas clave, SLA, Mantenimientos y actualizaciones.
- **Configuración** — Guía de inicio, Perfil, El negocio, El asistente, Modelos de IA, Lo que sabe, Canales, SLA y
  tickets, Mantenimientos y actualizaciones, Reglas y umbrales, Trazabilidad y Ayuda (según quién entró).

La guía para el equipo está en [`docs/guia-del-tablero.md`](docs/guia-del-tablero.md) y las reglas de diseño en
[`docs/diseno-tablero.md`](docs/diseno-tablero.md).

## Canales

La sección **Canales** del tablero muestra cada canal con su estado (conectado, esperando el QR, sin
configurar, error), cuántos mensajes llegaron en la semana, qué falta para conectarlo y los datos a
copiar (código del widget, URL del webhook, token enmascarado). WhatsApp por QR se vincula
escaneando el código desde ahí mismo. Encender o apagar un canal se guarda en la base y aplica sin
reiniciar; los secretos siguen en `.env`. Instagram y Messenger aparecen con lo que se necesita:
el adaptador se construye cuando haya credenciales de prueba de Meta.

- **Baileys** (QR con el número de la tienda): no necesita túnel ni cuenta de negocio, pero es
  protocolo no oficial; úsalo para pruebas y volúmenes bajos.
- **Meta Cloud API** (oficial, para producción): las credenciales (`META_ACCESS_TOKEN`,
  `META_PHONE_NUMBER_ID`, `META_VERIFY_TOKEN`, `META_APP_SECRET`, `META_API_VERSION`, por defecto v26.0) se llenan en
  **Canales › WhatsApp oficial › Credenciales** o en `.env`. Al guardarlas:
  - XENCRM las verifica con Meta y, si Meta las rechaza, no las guarda;
  - las escribe en `.env` (no en la base ni en el repositorio) y las aplica sin reiniciar;
  - el tablero nunca vuelve a mostrar el token completo, solo sus últimos caracteres.

  Luego se registra el webhook `https://TU-DOMINIO/webhooks/meta` en Meta, con el token de verificación.
  Meta puede mandar la misma notificación más de una vez: XENCRM recuerda el id de cada mensaje durante 7 días y lo
  repetido no entra ni se contesta dos veces. Con el canal en «Mira» o «Propone» no marca leído ni muestra
  «escribiendo…». Pruebas: `pnpm test:meta` y `pnpm test:repetidos`. Requiere negocio verificado y plantillas para escribir fuera de la ventana de
  24 horas. XENCRM respeta esa ventana: si pasaron más de 24 horas desde el último mensaje del
  cliente, no envía (ni guarda como enviado) lo que Meta rechazaría. El tablero lo advierte en la
  conversación y en "Por verificar" (con cuánto tiempo queda cuando faltan menos de 3 horas), y la
  verificación sigue pendiente hasta que el cliente vuelva a escribir. Este adaptador está escrito
  contra la documentación pero **no se ha probado con credenciales reales**.
- **Widget**: `<script src="https://TU-DOMINIO/widget.js" async></script>`. Carga el historial,
  muestra las respuestas del equipo en vivo y avisa cuando atiende una persona.
- **Túnel** para el widget, el tablero y el webhook: `cloudflared tunnel --url http://localhost:3000`
  (pon la URL en `PUBLIC_URL` y restringe `ALLOWED_ORIGINS`). XENCRM se llama a sí mismo por esa dirección cada
  5 minutos, comparando un código único del proceso. Si falla 3 veces seguidas, avisa en la campana, en Hoy y en
  **Canales › Dirección pública** (con "Revisar ahora"), y avisa otra vez cuando vuelve. Una falla suelta, como
  justo después de crear el túnel, no da alarma. Pruebas: `pnpm test:public`.

## Pruebas

```bash
pnpm test              # todas las pruebas sin modelo (fechas, citas, recordatorios, guardas, diccionario, perfil…)
pnpm test:scenarios    # las conversaciones del cliente con los motores reales, con su consumo
pnpm replay            # repasa conversaciones sintéticas y proyecta el costo por 1.000 conversaciones
pnpm typecheck
```

Las pruebas que escriben usan una base, un `.env` y archivos temporales, o contactos `test:` que se borran al
terminar: nunca tocan la información real del cliente. La lista completa y cómo levantar un servidor aislado
(`XENCRM_CONFIG`, `DB_PATH`, `XENCRM_ENV_FILE`) están en [`docs/arquitectura.md`](docs/arquitectura.md#pruebas).

## Motores

| Rol | Variable | Por defecto | Para qué |
|---|---|---|---|
| liviano | `LIGHT_ENGINE` | apple | casi todo: saludos, info de la tienda, si hay o no una prenda, precios, tomar apuntes |
| pesado | `HEAVY_ENGINE` | ollama | cuando el cliente pide algo específico: recomendar o comparar, detalles de una prenda (tela, corte, qué incluye), medidas o tallas, una prenda con características ("quiero un traje azul oscuro slim"), y su seguimiento corto |
| gate | `GATE_ENGINE` | ollama | clasificación de intención (JSON) |
| análisis | `ANALYSIS_ENGINE` | = gate | análisis comercial por turno |

`LLM_ENGINE=ollama|apple|openai` fuerza un solo motor. Si varios roles usan OpenAI, cada uno puede
tener su modelo (`OPENAI_MODEL_LIGHT`, `_HEAVY`, `_GATE`, `_ANALYSIS`; vacío = `OPENAI_MODEL`): por
ejemplo un mini para responder y uno mayor para el análisis, que corre en segundo plano. Los modelos de
razonamiento (gpt-5, gpt-5.5…) se detectan solos: no reciben `temperature` y tienen margen para pensar. Con `HEAVY_ENGINE=openai` el cliente que ya
paga OpenAI recibe la nube donde más aporta y lo local donde basta. Guardas independientes del
motor: filtro de enlaces (solo los del contexto), verificación de cifras (un precio que no está en
el contexto se descarta y se regenera con el otro motor), afirmaciones y negativas sin respaldo ("¿tienen
wifi?" → "sí, tenemos wifi", o "¿venden zapatos?" → "no vendemos zapatos", sin que la información lo diga: se
rehace pidiendo no suponer y, si insiste, se responde que se confirma con el equipo). Un "no" pasa si se apoya en
el alcance del negocio ("somos moda masculina"), y lo que el Perfil marca "por confirmar" siempre se verifica.
Un descuento, un porcentaje, algo gratis o un precio regateado que la información no ofrece tampoco sale: se
rehace y, si insiste, se verifica con el equipo, que es quien decide si hace un descuento. Una respuesta que recita
las instrucciones del asistente se cambia por una fija. El respaldo se mide solo contra lo que se sabe del negocio,
nunca contra las reglas del prompt ni contra lo que dijo el cliente. También limpia los saludos repetidos. Pruebas:
`pnpm test:guards` y `pnpm test:inyeccion`, que pasa todo el recorrido con un modelo falso que siempre se deja
convencer.

## Capacidad y memoria

Medido en un M1 Pro de 16 GB con otras apps abiertas: turnos livianos de 3 a 5 s, pesados de 6 a
9 s, ~20 mensajes por minuto sostenidos con 6 clientes a la vez. Los motores procesan de a uno;
con concurrencia la latencia crece por cola. El análisis corre 4 s después del último mensaje para
no competir con la respuesta. Si la máquina se comparte, `NUM_CTX=4096` y `OLLAMA_NUM_PARALLEL=1`
reducen memoria. En el Mac Mini dedicado no hace falta.

## Dejarlo corriendo

```bash
pnpm add -g pm2
pm2 start "pnpm start" --name XENCRM --cwd /ruta/a/xencrm
pm2 save && pm2 startup
```

**Respaldos.** Una vez al día (y al arrancar, si el último tiene más de un día) XENCRM copia la base con
`VACUUM INTO` a `data/backups/` (`BACKUP_DIR`) y conserva las últimas 14 (`BACKUP_KEEP`). Las copias solo las lee
el dueño del equipo (600) y no van al repositorio: tienen datos de clientes. El tablero (Agente › Respaldo de la
base) muestra el último y tiene "Respaldar ahora". Conviene que también queden fuera del equipo (Time Machine o
similar). Para restaurar: detener XENCRM, copiar el respaldo elegido sobre `data/xencrm.db` y arrancar.
Pruebas: `pnpm test:backup`.

**Retención de conversaciones.** Las conversaciones que llevan mucho tiempo quietas se pueden anonimizar o borrar
solas. Viene apagada. La enciende el super-admin, cliente por cliente, en la consola (Configuración › Motores), y
antes de guardar ve cuántas tocaría ese día. El negocio la ve en su tablero, en el panel del respaldo.

| Acción | Qué se va | Qué queda |
|---|---|---|
| Anonimizar, la de por defecto | Nombre, teléfono, número, datos, etiquetas, notas, resumen, mensajes y sus archivos, análisis, pendientes y propuestas | La ficha archivada con otro identificador, su etapa y su puntaje, sus citas y eventos sin notas, de dónde vino y el gasto |
| Borrar | Todo lo de esa persona | El gasto de IA, a nombre de nadie |

Lo mínimo son 90 días sin movimiento; se sugieren 365. No toca a quien tiene una cita por delante. Antes de cada
pasada tiene que haber un respaldo de menos de un día, y si no se puede hacer, no se toca nada: lo anonimizado se
recupera de los respaldos durante 14 días. Pasa una vez al día, de a 300 conversaciones. Si la persona vuelve a
escribir, empieza de cero. El historial importado de WhatsApp no entra: es de donde sale el estilo del asistente y
se borra desde donde se importa. Pruebas: `pnpm test:retencion`.

## Advertencias

- Un cliente por proceso: para varios clientes, una carpeta, un `.env` y un puerto por cada uno.
- WhatsApp oficial (Meta) está escrito contra la documentación, pero no se ha probado con credenciales reales.
  Instagram y Messenger aún no están.
- El túnel de `cloudflared` sin cuenta cambia de dirección al reiniciarse: para producción hace falta un túnel fijo
  con dominio propio.
- Apple Foundation Models aplica un límite de peticiones en segundo plano (no documentado) y sus
  guardrails pueden rechazar mensajes inocuos: en ambos casos el turno cae al otro motor.
- El puntaje es una estimación explicable, no una probabilidad calibrada, hasta tener resultados
  reales para ajustar pesos.
- Mandar los chats a OpenAI es una decisión de privacidad del cliente; la opción local existe para
  quien no quiera hacerlo.
