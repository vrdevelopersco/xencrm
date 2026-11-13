# Modo agéntico

XENCRM tenía un solo agente que contesta siguiendo un recorrido fijo (reglas → clasificador → búsqueda → un modelo
redacta → guardas). En el modo agéntico el modelo puede **pedir herramientas**: consultar datos del CRM y hacer cosas.
El código decide si la herramienta existe, si los datos sirven, si quien está detrás puede hacerlo, y la ejecuta.

Hay dos agentes con la misma maquinaria (`src/agentico/`):

| | Con los clientes | Con el equipo (copiloto) |
|---|---|---|
| Dónde | WhatsApp y el chat del sitio, dentro de `agent.ts` | El botón «Pregúntale a Xen» del tablero |
| Interruptor | Configuración › Agente › Modo agéntico · **apagado de fábrica** | Igual · **prendido de fábrica** |
| Lee | catálogo, información, su próxima cita, espacios libres, **sus** tickets, los mantenimientos que **lo** afectan | contactos, una ficha, citas, tickets, mantenimientos, lo pendiente de hoy, el cupo |
| Hace (seguro) | abrir un ticket, pasar a una persona, pedir una cita (la sigue el flujo de citas) | crear un ticket, anotar una nota |
| Propone | — | mover de etapa, asignar, agendar, cambiar un ticket, preparar avisos, escribirle a un cliente |

## Decisiones (2026-11-13)

- **Clientes y equipo a la vez**, con **autonomía «actúa en lo seguro»**: hace solo lo reversible y de bajo riesgo; lo
  demás lo propone para que alguien lo apruebe con un clic. Agendar sigue siendo del flujo de citas, que pide
  confirmar.
- **Un agente con herramientas, no varios agentes sueltos.** Los «especialistas» (ventas, soporte) serían perfiles del
  mismo bucle —otras herramientas, otras instrucciones— y se separan solo si una medición dice que mejora algo.
- **Con los clientes viene apagado**: cambia lo que les pasa y cuesta más por mensaje; lo prende quien paga.

## Las reglas de la casa

1. **El contexto lo pone el código.** Las herramientas del cliente no tienen un argumento para decir *de quién*: el
   cliente es el de la conversación (`ctx.userId`). «Muéstrame los tickets de Distribuidora Duarte», escrito por
   cualquiera, solo devuelve los suyos. Una prueba revisa que ningún esquema tenga un campo de contacto.
2. **Tres efectos, garantizados por el tipo.** `lectura`, `seguro` y `propuesto`. Una herramienta propuesta no tiene
   `ejecutar`, solo `proponer`: no puede hacer nada aunque el modelo insista.
3. **Los permisos son los del tablero.** Cada herramienta del equipo declara qué ruta de la API hace lo mismo
   (`ruta`), y el candado del modo fácil decide con esa ruta. Aprobar una propuesta es llamar esa ruta desde el
   navegador: la misma validación, la misma firma, el mismo candado que el botón de siempre.
4. **Acotado.** `agentico.pasos` (4) vueltas con herramientas y `agentico.topeTurnoUsd` (US$ 0,10) por mensaje, en
   Reglas y umbrales › Modo agéntico; aparte del tope del mes. Al llegar, una última vuelta *sin* herramientas
   (`tool_choice: none`) para que conteste con lo que ya sabe. Lo mismo dos veces en un turno se hace una vez.
5. **No afirma lo que no hizo.** Lo que devuelven las herramientas se suma a lo que respalda la respuesta, y las
   guardas de siempre miden contra eso. Una nueva, `ticketSinRespaldo`, rehace la respuesta si da un código de
   ticket que nadie devolvió o dice «te abrí un ticket» sin haberlo abierto (igual que `claimsBooked` con las citas).
6. **El copiloto nunca le escribe a un cliente**: «mensaje_al_cliente» solo propone; que salga es de quien lo aprueba.
7. **Lo que devuelven las herramientas son datos, no órdenes** (pueden traer texto escrito por clientes), y se dice
   así en las instrucciones.

## Cómo está armado

| Pieza | Qué hace |
|---|---|
| `llm/herramientas.ts` | Habla con la API: Chat Completions (OpenAI, LM Studio, compatible) y Messages API (Claude). Un formato neutro de pasos (`Paso`) que cada motor traduce justo antes de llamar, así el respaldo sigue el mismo turno. |
| `llm/engines.ts › conversarConHerramientas` | Una vuelta del bucle con un motor, con el tope del mes y el aviso de caída, como `generate`. `conHerramientas(e)`: OpenAI, los compatibles y Claude. Apple y Ollama no: con ellos el asistente sigue el recorrido de siempre. |
| `agentico/nucleo.ts` | Tipos, interruptores y `correr()`: el bucle con validación (zod), candado, idempotencia, topes y el informe del turno (llamadas, hechos, propuestas, enlaces, evidencia). |
| `agentico/cliente.ts` | Las herramientas del cliente, `responderConHerramientas()` (lo llama `agent.ts` en lugar de `generate` para compras y preguntas) y la guarda `ticketSinRespaldo`. |
| `agentico/equipo.ts` | Las herramientas del copiloto y `preguntarAlCopiloto()` (el motor del rol pesado y sus respaldos que llaman herramientas). |
| `channels/admin.ts` | `PUT /agent/agentico`, el estado en `GET /agent` y `POST /copiloto`. |

En `agent.ts` el modo agéntico entra solo en el paso de generar (compras y preguntas), nunca acompañando a una persona.
Si el motor no sabe de herramientas o la API las rechaza, el turno sigue sin ellas. `pedir_cita` le pasa la
conversación al flujo de citas y `pasar_a_persona` la deja en manos del equipo, como el clasificador.

## Lo que queda anotado

- Cada herramienta del cliente queda en las guardas del turno (`herramienta:abrir_ticket`, `…:error`), y la ruta dice
  `agente (mis_tickets, abrir_ticket)`: se ve en Trazas.
- El consumo va en `llm_usage` con las tareas `agente` y `copiloto`, aparte de las de siempre.
- Lo que hace el agente del cliente lo firma «Xen (agente)»; lo del copiloto, «Laura (con Xen)».

## Varios agentes (Configuración › Agente › Agentes)

Uno o varios agentes, cada uno con **nombre**, **qué atiende** (ventas, soporte, agenda, información), **por dónde**
(WhatsApp, chat del sitio, voz), **instrucciones** propias y, si atiende por voz, su **voz** de Grok. Viven en
`agentico/agentes.ts` (ajuste `agentes`, validado con zod, todo o nada) y se editan en el tablero (`GET/PUT
/agentes`, de quien administra).

- **Sin configurar nada no cambia nada**: atiende el de siempre (`business.agent`), todo, por WhatsApp y el chat, y su
  persona es idéntica a la de antes (una prueba lo compara).
- **Cada conversación queda con un agente** (tabla `agente_de_conversacion`, no la ficha: «agente: soporte» no es un
  dato del cliente). De qué trata un mensaje se decide por reglas (`areaDe`: soporte, agenda, ventas o nada); si el
  tema es de otro agente del mismo canal, lo toma ese y **se presenta** (`notaDeRelevo`: «te atiende Sofía»). Un
  «gracias» no la cambia de manos.
- La persona lleva el nombre del agente (`personaPrompt(nombre)`) y «## Lo tuyo» (qué atiende y sus instrucciones),
  fija por agente para la caché. En el modo agéntico sus herramientas salen de lo que atiende (`herramientasDe`):
  soporte, tickets y mantenimientos; ventas, catálogo y espacios; agenda, citas; todos buscan en la información y
  pueden pasar a una persona. Lo que abre un agente lo firma él («Sofía (agente)», «Eve (voz)»).
- El chat del sitio saluda con el agente que lo atiende (`nombreParaCanal`).

## Voz con Grok (llamadas desde el chat del sitio)

Un agente con el canal **Voz** atiende llamadas desde la ventana de chat (`/chat`): el botón «Hablar con Eve» abre
una llamada con el [Voice Agent API de xAI](https://docs.x.ai/developers/model-capabilities/audio/voice-agent)
(`grok-voice-latest`), con la llave en `XAI_API_KEY`.

```
navegador ──(audio PCM16 24 kHz, /voz/ws)──▶ XENCRM ──(wss://api.x.ai/v1/realtime, Bearer XAI_API_KEY)──▶ Grok
```

- 🪤 **XENCRM hace de puente.** El token efímero de xAI fija el modelo pero no las instrucciones: dárselo al navegador
  sería regalar minutos para hablar de cualquier cosa. Con el puente, la llave, las instrucciones y las herramientas
  no salen del servidor; el navegador solo manda audio y solo puede colgar (`voz/llamada.ts`).
- **El boleto**: `POST /voz/llamada` (con la sesión del chat) da un boleto firmado (HMAC), de un solo uso, que vence en
  un minuto; `/voz/ws?b=…` sin boleto válido no sube a WebSocket (403). Freno: `voz.llamadasPorHora` por
  conversación (el triple por dirección de red).
- **La llamada**: el servidor manda la sesión (`session.update`: persona del agente + «## Por voz» + sus herramientas
  + lo que sabe del negocio, voz, audio a 24 kHz, `server_vad`, idioma de quien llama), pasa el audio en los dos
  sentidos, avisa cuando el cliente habla encima (el navegador calla lo que suena), ejecuta las herramientas con
  `ejecutarUna` —las mismas reglas que el texto— y después un solo `response.create`, y guarda **cada frase en la
  misma conversación del chat**, que también la muestra. Al colgar: la llamada en la historia de la ficha, el
  consumo en minutos (`llm_usage`, motor `xai`, US$ 0,08/min según terceros: revisar el precio oficial) y el
  análisis de siempre. `voz.minutosMax` corta la llamada desde el servidor.
- **Por voz no se agenda**: el flujo de citas es de texto y pide confirmar por escrito; el agente consulta los espacios
  y deja escoger en el chat. Y en voz las guardas no pueden rehacer (lo dicho, dicho está): instrucciones más
  estrictas y todo transcrito.
- **El micrófono**: está cerrado en todo el sitio (`permissions-policy`); la página del chat con la voz disponible lo
  pide con una marca de adentro (`x-xencrm-microfono`) que el borde cambia por `microphone=(self)` y quita.
- **En producción**: el enrutador del paquete pasa el WebSocket (`upgrade`) de `/<cliente>/voz/ws` al cliente que le
  toca, y solo esa ruta.
- En el navegador (`public/voz.js` + `voz-procesador.js`, un AudioWorklet): micrófono con cancelación de eco,
  remuestreo a 24 kHz si hace falta, la voz en orden y sin huecos, errores en palabras (sin permiso, sin micrófono,
  sin cupo), Escape cuelga.

## Teléfono por SIP (3CX y otros proveedores)

Las llamadas al número del negocio las contesta un agente con el canal **Teléfono** (`voz/telefono.ts`), con el
[SIP de xAI](https://docs.x.ai/developers/model-capabilities/audio/voice-agent/sip):

```
cliente ──▶ tu número (3CX, Twilio, Telnyx…) ──SIP──▶ sip:<número>@sip.voice.x.ai ──audio──▶ Grok
                                                            │ aviso firmado (realtime.call.incoming)
                                                            ▼
                                 XENCRM /voz/sip ──▶ se une por call_id (wss, con la llave) y la controla
```

- **El audio no pasa por XENCRM**: va entre la troncal y xAI (el retraso, en lo mínimo). XENCRM pone instrucciones y
  herramientas, guarda lo dicho, transfiere y cuelga por la API (`/realtime/calls/{id}/refer` y `/hangup`).
- 🪤 **El aviso se verifica antes de nada** (Standard Webhooks: HMAC-SHA256 sobre «id.timestamp.cuerpo» con el
  secreto `whsec_…` que xAI da una vez al registrar el número con `origin: byo_trunk`, en `XAI_SIP_SECRETO`), con
  cinco minutos de margen y sin repetir un aviso ya visto. Sin firma buena, 401 y no se toca la llamada.
- **Quién llama** sale del `From` SIP: la ficha es `tel:+57…` (canal `telefono`), con su número normalizado igual que
  el de WhatsApp, así que el CRM la reconoce como la misma persona («¿Es la misma persona?» › Unir fichas) y el agente
  sabe de qué habló por escrito. Número oculto: una ficha de esa llamada.
- **La sesión de teléfono**: sin formato de audio (lo pone la troncal, G.711), con el idioma, «## Por teléfono»
  (saludar primero, sin «déjalo en el chat», transferir, despedirse), sus herramientas sin `pedir_cita` y `colgar`.
  XENCRM manda `response.create` para que conteste él.
- **Pasar a una persona** transfiere la llamada (SIP REFER) a `XAI_SIP_DESVIO` —la extensión o cola de 3CX,
  `sip:100@empresa.3cx.us`, o un número `tel:`— después de que diga «te comunico»; sin desvío, la ficha queda con el
  equipo y el agente se despide. **Colgar**: se deja sonar la despedida y se cuelga por la API.
- **Límites**: `voz.telefonoSimultaneas` (3) a la vez y `voz.minutosMax`; pasado el cupo, sin agente o con el tope
  del mes, la llamada va al desvío o se cuelga (una llamada que nadie contesta es peor).
- **3CX**: una troncal SIP genérica hacia `sip.voice.x.ai` (TLS 5061, o TCP), G.711, con la autenticación que se
  registró en xAI (por IP o usuario y clave), y la regla de entrada del número hacia esa troncal. **Twilio, Telnyx**:
  el número o su troncal elástica apuntando a `sip:<número>@sip.voice.x.ai;transport=tls`. La tarjeta Teléfono de
  Canales trae esto mismo, con lo que hay que copiar.

## El omnicanal

Todos los canales entran a la misma Bandeja: WhatsApp (QR u oficial), el chat del sitio, las llamadas desde el chat
(que quedan en la conversación del chat) y el teléfono (`tel:+57…`, con su insignia). Canales tiene una tarjeta por
cada uno (estado, actividad, qué copiar, qué falta) y los dos de voz se prenden y apagan como los demás. Cada
mensaje del asistente guarda qué agente lo dijo, y la burbuja lo muestra. A una llamada no se le escribe: en vez del
cajón, su otra conversación o su WhatsApp.

## Lo que no está (todavía)

- **Medirlo con un modelo de verdad.** Las pruebas (`pnpm test:agentico`) simulan la API; falta correr los escenarios
  con el modo prendido contra el recorrido de siempre (calidad, costo y latencia) antes de prenderlo con clientes.
- Especialistas separados, respuestas por partes (streaming) y memoria del copiloto en el servidor: su conversación
  vive en el navegador de quien pregunta.
- Herramientas con Ollama o Apple.
- **La voz con una llave real de xAI**: está probada contra un Grok de mentira (el mismo protocolo, en las pruebas y en
  Chrome con micrófono falso); falta una llamada de verdad. Tampoco hay voz en la burbuja que se pega en otros
  sitios (sí en la ventana `/chat` y por teléfono).
- **El teléfono con una troncal real** (3CX o un proveedor): probado contra la API de xAI simulada, con el formato de
  firma de Standard Webhooks (las tres cabeceras de xAI coinciden con ese estándar, pero la página no lo nombra:
  confirmarlo en la primera llamada). Tampoco hay llamadas salientes (el agente llamando al cliente).
