# XENCRM: la siguiente generación

XENCRM es la siguiente generación del CRM conversacional de HRC, que hasta noviembre de 2026 se llamó aiva (mismo
código, misma historia de git). Este documento es la
referencia de su interfaz: el brief, los tokens, el vocabulario y lo que hace cada pantalla. Las reglas de
`diseno-tablero.md` (jerarquía, puntaje, quién habla, contraste, colores de dato, trampas) siguen mandando; lo que
este documento cambia, lo dice.

## El brief

- **Sujeto**: el tablero donde el equipo de un negocio (DUNOR, una boutique con cita previa, es el primero) atiende
  lo que llega por WhatsApp y por el chat del sitio, donde XEN —el agente de IA— contesta primero. Cada persona es un
  contacto con su trato (etapa, valor, próximo paso) y sus citas.
- **Audiencia**: asesores de venta y quien administra. En el computador de la tienda casi siempre, y en el celular
  cuando están fuera. Con prisa: entre un cliente y otro.
- **El trabajo**: que nadie se quede esperando y que ningún trato se enfríe sin que alguien lo vea.

## Una sola piel

Hasta XENCRM el tablero tenía dos caras: el completo (blanco y azul) y el modo fácil (el aspecto de Nexora, que DUNOR
mandó como muestra). En XENCRM **la del modo fácil es la de todos**, rehecha con identidad propia:

- La piel va detrás de `:root[data-piel="xen"]`, que el `<html>` trae puesto de fábrica y `aplicarModo()` vuelve a
  poner. Todo lo de la piel está en un bloque de `admin.html` (`XENCRM: la piel de todos` … `fin de la piel de
  XENCRM`) y `pnpm test:facil` vigila que ninguna regla se salga de él.
- El **modo fácil sigue existiendo** pero ya no cambia el aspecto: solo esconde lo avanzado (`.solo-completo`: el
  puntaje y su porqué, el asistente, las trazas, los filtros de más) y pone **el candado** (DUNOR). Sin decir nada,
  un cliente entra en completo: la misma piel con todo a la vista.
- Lo que la piel muda de sitio (el buscador de Contactos, los controles del calendario) se queda mudado en los dos
  modos: `mudarParaElFacil(true)`.
- Los tokens conservan el prefijo `--fx-` de cuando eran del modo fácil. Cambiarlo era tocar cientos de líneas sin
  ganar nada.

## Vocabulario (el de un CRM de mensajería, como SendPulse)

El usuario pidió dejar el lenguaje genérico («Inbox», «Chats», «Pipeline») por el de un CRM de mensajería. Una
palabra para cada cosa, la misma en el menú, el título, el botón y el aviso:

| Antes | En XENCRM | Por qué |
|---|---|---|
| Inbox / Conversaciones | **Bandeja omnicanal** | WhatsApp, el chat del sitio y lo que venga, en un solo sitio |
| Pipeline / Por etapa | **Tratos** | Cada contacto en su etapa del embudo, con valor y próximo paso |
| Tomar control · Responde Xen / Tú | **Pausar automatización** · **Reanudar automatización** | Lo que se pausa es el agente de IA; la persona sigue |
| El asistente | Por su nombre configurado (`agent.name`, el que ve el cliente: «Xen» en DUNOR); en textos genéricos, **el agente de IA** | Que el equipo y el cliente lo llamen igual |
| Resumen del día (Inicio) | **Copiloto XEN** | El producto es XENCRM; el copiloto es suyo, no del agente del cliente |
| A cargo | **Asignado a** | |
| Sin dueño | **Sin asignar** | Filtros Mías · Sin asignar · Todas |
| Nota para el equipo | **Nota interna** | Pestaña junto a «Enviar mensaje» |
| Llegó por | **Origen** | |
| Lo que contó | **Datos del contacto** (cada uno es un campo) | |
| Estados del filtro | **Todos los estados** ▾ (Sin leer, Prospectos, Con una persona, Archivados) | |
| Última vez | **Última actividad** | |

Se tutea siempre. Sentence case en títulos y botones. Los verbos dicen lo que pasa («Pausar automatización», no
«Tomar control»).

## Tokens

Todos en el bloque de la piel, con su versión oscura. Ninguna pieza lleva un color suelto.

| Grupo | Claro | Oscuro | Para qué |
|---|---|---|---|
| `--fx-fondo` | `#eef3f2` | `#0b1517` | La bruma verde agua de fondo |
| `--fx-panel` / `--fx-panel-2` | `#fff` / `#f5f8f7` | `#101d20` / `#142427` | Superficies y pozos (campos, filas) |
| `--fx-borde` / `--fx-borde-2` | `#dae3e1` / `#e8eeed` | `#1f3236` / `#182a2d` | |
| `--fx-t0` … `--fx-t3` | `#0a2227` · `#12333a` · `#4d666c` · `#5c7177` | `#f2f7f6` · `#dce7e6` · `#9cb1b4` · `#85999d` | Tinta verde petróleo, de títulos a etiquetas |
| `--fx-acento` (+ `-2`, `-t`, `--fx-sobre-acento`) | `#0b7466` con texto blanco | `#2fb5a0` con texto `#04201c` | Lo que se hace: botones, enlaces, selección |
| `--fx-suave` (+ `-t`, `-borde`) | `#e2f2ee` | `#14302e` | Selección suave (menú, filas) |
| `--fx-ia` (+ `-s`, `-t`, `-borde`) | `#6d4fe0` | `#9d86ff` | **Solo lo que dice la IA**: resúmenes, sugerencias, el copiloto |
| Datos | verde (ganado, caliente), ámbar (interés, urge), rojo (perdido, error), cielo (conversando), índigo (cita) | | Aparte del acento |
| Conversación | `--fx-papel` `#f2efe9`, `--fx-burbuja-xen` `#d6f2e8`, `--fx-burbuja-equipo` `#fcefd2` | sus oscuros | Cliente en blanco, XEN verde agua, el equipo arena |
| Letra | `--fx-letra` Figtree (la de la casa) · `--fx-display` Bricolage Grotesque | | La display solo en títulos de página y cifras grandes |
| Forma | `--fx-r-md` 10 · `--fx-r-lg` 12 · `--fx-r-xl` 16 · `--fx-r-pill` | | Base 4 para el espacio |
| Movimiento | `--fx-t-rapido` 120 ms · `--fx-t-medio` 220 ms | | Con `prefers-reduced-motion`, quieto |

### Contrastes (calculados sobre el color de base; los de píxel pintado van en la bitácora)

Todo texto ≥ 4.5:1. Lo más justo: `--fx-t3` sobre el fondo, 4.59:1 (solo etiquetas; sobre el panel blanco da 5.14).
Texto principal 13.5:1 en claro y 13.6:1 en oscuro; secundario 6.1:1 y 7.7:1; blanco sobre el acento 5.67:1;
tinta sobre el acento oscuro 6.71:1; las seis etiquetas de dato entre 5.4:1 y 8.5:1 en claro y ≥ 8:1 en oscuro;
la hora dentro de la burbuja de XEN 5.56:1.

## Las pantallas

El memorable es **uno**: el copiloto de Inicio (el resumen y las siguientes acciones, con el violeta de la IA). Todo
lo demás, callado.

- **Inicio** (inspiración: Dynamics 365): saludo; el **copiloto XEN** con el resumen del día y las siguientes mejores
  acciones sacadas de los datos de verdad (quién espera respuesta, calientes sin seguimiento, citas de hoy, lo que
  hay que verificar), cada una con su verbo y su botón; cuatro cifras; la semana; el embudo por etapa con el color de
  cada etapa; la actividad reciente. Nada inventado: sin datos, la tarjeta lo dice.
- **Bandeja omnicanal** (SendPulse + ZapFast): lista con avatar de color, la insignia del canal sobre el avatar,
  hora, no leídos en píldora; filtros Mías · Sin asignar · Todas y «Todos los estados»; la conversación sobre papel
  con trama, burbujas con su cola, quien habla arriba en su color y la hora abajo; el cajón con pestañas «Enviar
  mensaje» · «Nota interna»; a la derecha la ficha del contacto como la de SendPulse (avatar grande, acciones,
  contacto con sus íconos, Asignado a, etapa, el último trato, origen, pausar automatización).
- **Contactos** (SendPulse): título grande, fila de acciones (Agregar contacto, Exportar…), buscador y filtro; cada
  contacto es una fila-tarjeta con su nombre y cómo contactarlo, el último trato (etapa + próximo paso), los datos
  como etiquetas de color, a quién está asignado y la última actividad.
- **Ficha del contacto**: la cabecera de un trato de SendPulse (nombre con lápiz, etapa en píldora, asignado,
  acciones) y pestañas.
- **Tratos**: el tablero por etapa con columnas del color de su etapa.
- **Analítica**: incluye el **sentimiento** con emojis por interés y desinterés, y el **análisis por voz** como
  pantalla «por desarrollar» (dice lo que hará, no finge datos).
- **Configuración › Modelos de IA**: conectar OpenAI, Anthropic (Claude), Apple Foundation Models, Ollama, LM Studio
  y cualquier API compatible con OpenAI; elegir qué modelo hace cada rol. Las llaves no vuelven al navegador.

## Reglas para quien toque la interfaz

1. Todo dentro de la piel: `:root[data-piel="xen"] …` o una pieza propia (`fx-…`). Nada suelto.
2. Esconder lo avanzado con `.solo-completo`, nunca con un `if` por pantalla.
3. Los cinco estados de cada vista: vacío que invita, cargando con la forma del contenido, error con salida,
   parcial, y datos hostiles (nombres larguísimos, mil filas, cero).
4. Una pantalla nueva no está probada hasta que se abre en un navegador de verdad, a 1440 y a 390 px, en claro y
   en oscuro, y se mide lo pintado.

## Cómo quedó (2026-11-11)

Hecho en paralelo por seis agentes, cada uno en su worktree sobre los cimientos (`43e7d87`) y en su sección marcada
del bloque de la piel y de `admin.js` (`XEN · …`), y unido en la rama `xencrm`. Capturas de todas las pantallas en
[`capturas/xencrm-next-evolution/`](capturas/xencrm-next-evolution/).

| Pieza | Qué quedó | Dónde |
|---|---|---|
| Inicio | El **copiloto XEN** (borde teal→violeta): cuántas cosas esperan, hasta cinco acciones con verbo, persona y botón, los pendientes y la agenda de hoy. Todo sale de `/today`; sin pendientes, «Todo al día». Cifras con la letra display, la semana con tokens, el embudo con el color de cada etapa, esqueletos al cargar y «Reintentar» si falla | `pintarInicio`, `pintarResumenDelDia` |
| Bandeja omnicanal | Mías · Sin asignar · Todas + «Todos los estados» (un solo `state.filter`); avatar con la insignia del canal; papel con trama propia; burbujas con cola; «Pausar / Reanudar automatización» (el mismo Xen/Tú); «Asignado a» en la cabecera; pestañas **Enviar mensaje · Nota interna** (la nota va por `/contacts/:id/notas`, no toma la conversación y no se borra si falla); la ficha de al lado como la de SendPulse. La conversación se acomoda a su ancho con `@container conversacion` | ancla `XEN · Bandeja omnicanal` |
| Contactos | Acciones arriba (Agregar contacto, Exportar a Excel), grupos como píldoras con su número, filas-tarjeta (contacto, último trato, datos como etiquetas, asignado, valor, última actividad), esqueleto, error con salida, vacíos con salida y aviso a los 500 | ancla `XEN · Contactos…` |
| Ficha del contacto | Cabecera de trato: nombre con lápiz, etapa y «Asignado a» como píldoras que se cambian ahí, «Abrir chat»; «Lo que busca» en violeta; «Sobre el contacto», «Contacto» y «Datos del contacto» | ídem |
| Tratos y Citas | Columnas con la franja y el punto de su etapa, cuenta y suma; citas en índigo, cumplidas verdes, no asistió en rojo | ídem |
| Analítica | Pestañas **Resumen · Sentimiento**. Interés 🤩 Quiere comprar · 🙂 Interés claro · 🤔 Curiosidad · 😶 Sin interés; ánimo 😊 Contento · 😐 Neutral · 😠 Molesto (emoji con su palabra, `aria-hidden` en el emoji); el cruce interés × ánimo («Cuidar a N»); lo que frena; cómo cambió por día. **Sentimiento por voz: «Por desarrollar»**, con lo que hará, lo que hay (las notas de voz ya se transcriben) y lo que falta; el interruptor está apagado de verdad y la vista previa no tiene cifras | `GET /admin/api/sentimiento` (`src/crm/sentimiento.ts`, solo lectura, sin modelo; el candado la deja leer) |
| Modelos de IA | Configuración › Modelos de IA (solo super-admin): OpenAI, Anthropic, Apple FM, Ollama, LM Studio y «Otra API compatible con OpenAI», con su estado, llave de solo escritura (vuelve solo la pista), «Probar conexión» que no gasta, y qué modelo hace cada rol. Claude ahora puede hacer un rol y sigue de respaldo; LM Studio y la compatible son motores nuevos (`lmstudio`, `compat`) que reusan el cliente de OpenAI con su dirección. Lo guardado aplica al reiniciar | `src/proveedores.ts`, `/admin/api/motores/proveedores`; variables `LMSTUDIO_URL`, `LMSTUDIO_MODEL`, `COMPAT_URL`, `COMPAT_API_KEY`, `COMPAT_MODEL`, `COMPAT_NOMBRE` |
| Renombre | XENCRM en la consola (con la piel nueva y el verde agua de fábrica), la portada, la hoja de producto (`docs/xencrm-producto.pdf`), el README, `package.json` y los textos del servidor que ve una persona. El asistente de fábrica se llama **Xen** | README › «El renombre es completo» |
| Renombre completo | También lo de adentro: `XENCRM_*`, `xencrm.config.json`, `data/xencrm.db`, `xencrm_consola`, `x-xencrm-*`, `xencrm.*` en el navegador (las llaves viejas se mudan solas), pm2 `xencrm-<cliente>`, MCP `ask_xencrm`. Lo local que git no sigue (la `.env`, `clientes/`, las bases, el lanzador, el sidecar) se migra con `herramientas/migrar-a-xencrm.mjs` | `migrar-a-xencrm.mjs` |

Tokens que se sumaron en las secciones: `--fx-av-1…6-s/-t` (seis tonos de avatar, ≥ 6.5:1 en claro y ≥ 8.6:1 en
oscuro; **uno solo para todo XENCRM**, definido con Contactos) y `--fx-canal-wa/web/otro` (la insignia del canal).

🪤 **Dos agentes, el mismo token.** La bandeja y Contactos definieron cada uno `--fx-av-*` con otros valores y su
propia forma de elegir el tono (una por el nombre, la otra por el id): la misma persona salía de dos colores, y en
CSS gana la última definición sin avisar. Quedó una paleta y un cálculo (`tonoAvatar`, por el id: corregir el
nombre no cambia el color). `test:bandeja` vigila que se definan una sola vez y que las dos pantallas coincidan.

Pruebas nuevas: `test:bandeja`, `test:contactos`, `test:sentimiento`, `test:modelos`. Batería completa al unir:
2794 bien, 0 fallas.

### Lo que queda abierto

- La ficha como página no tiene «⋯»: el menú contextual de siempre cae debajo del diálogo.
- El aviso de nota del panel (`chat-nota`) sigue además de la pestaña «Nota interna»: las pruebas de borradores lo
  vigilan. Unificarlo es lo siguiente en la bandeja.
- El modelo de Ollama no se cambia desde Modelos de IA (`CHAT_MODEL` es de toda la máquina).
- La consola y la portada no tienen tema oscuro.
- Sentimiento por voz: falta el modelo que escuche el audio y decidir cuánto se guarda cada nota.
