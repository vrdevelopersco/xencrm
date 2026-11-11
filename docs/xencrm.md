# XENCRM: la siguiente generación

XENCRM es la siguiente generación del CRM conversacional de HRC, que hasta noviembre de 2026 se llamó aiva (mismo
código, misma historia de git). Este documento es la
referencia de su interfaz: el brief, los tokens, el vocabulario y lo que hace cada pantalla. Las reglas de
`diseno-tablero.md` (jerarquía, puntaje, quién habla, contraste, colores de dato, trampas) siguen mandando; lo que
este documento cambia, lo dice.

## El brief

- **Sujeto**: el tablero donde el equipo de un negocio (el ejemplo es XENTRIS LLC, una firma de software) atiende
  lo que llega por WhatsApp y por el chat del sitio, donde XEN —el agente de IA— contesta primero. Cada persona es un
  contacto con su trato (etapa, valor, próximo paso), sus citas (o demos: la palabra la pone el negocio) y, si ya es
  cliente, sus tickets.
- **Audiencia**: asesores de venta, soporte y quien administra. En el computador de la oficina casi siempre, y en el celular
  cuando están fuera. Con prisa: entre un cliente y otro. Y el equipo de soporte, que vive en Servicio.
- **El trabajo**: que nadie se quede esperando, que ningún trato se enfríe sin que alguien lo vea y que lo prometido
  a cada cliente (su SLA) se cumpla.

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
| Seguimientos | **Lista de trabajo** | Lo que hay que hacer hoy, en orden (el «acelerador» de Dynamics) |
| Clientes importantes | **Cuentas clave** (KAM: *key account management*) | |
| Pipeline como gráfica | **Embudo** | Tratos es el tablero; Embudo, cuánto pasa de una etapa a la otra |
| Última vez | **Última actividad** | |

Se tutea siempre. Sentence case en títulos y botones. Los verbos dicen lo que pasa («Pausar automatización», no
«Tomar control»).

## El mapa: una suite de CRM, como Dynamics 365 (2026-11-11)

El menú se ordena como el de Dynamics 365 Sales. Arriba, **Recientes** (las últimas fichas y conversaciones que uno
abrió, en su navegador) y **Fijados** (los de siempre, por persona); debajo, cuatro grupos; abajo, el **cambio de
área**. El ≡ lo contrae a íconos (cada quien, en su navegador).

| Área | Grupo | Pantallas |
|---|---|---|
| Ventas | Mi trabajo | Inicio · Bandeja omnicanal · **Lista de trabajo** (antes Seguimientos) · Citas |
| | Clientes | Contactos · **Cuentas clave** (panel KAM) |
| | Ventas | **Embudo** · Tratos · Ventas |
| | Rendimiento | **KPIs y metas** · **Optimización de ventas** · Analítica |
| Configuración | El negocio · El asistente y la IA · Canales · Sistema | Lo del engranaje, con los mismos filtros (quién entró, el candado) |

- Abrir una pantalla de otra área cambia de área, para que lo elegido siempre se vea marcado.
- Las dos áreas se arman una vez y se alternan con `[hidden]`: repintarlas dejaba en blanco los contadores.
- El engranaje del pie pasa a llamarse **Ajustes** (tema, sonido, modo, tu nombre): «Configuración» es el área.
- Cada pantalla nueva se carga sola con `alAbrir(vista, fn)`: `go()` avisa con el evento `xen:vista` al terminar.


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

## Servicio y el ejemplo de XENTRIS LLC (2026-11-11, tercera ronda)

El ejemplo de XENCRM deja de ser DUNOR (una boutique) y pasa a ser **XENTRIS LLC**, una firma de software: vende
aplicaciones (XENTRIS POS, Field y Stock), desarrollo a la medida y **soporte con SLA** (actualizaciones mensuales,
mantenimientos programados con aviso, tickets con tiempos garantizados por plan). Está en `examples/xentris/` y es la
configuración de la raíz. El embudo: Nuevo → Calificado → Evaluando → Demo agendada → Ganado · Perdido.

**El área Servicio** (como Dynamics 365 Customer Service), al lado de Ventas y Configuración: Mi trabajo (Bandeja,
**Tickets**) · Clientes (Contactos, Cuentas clave) · Servicio (**SLA**, **Mantenimientos y actualizaciones**).

Lo que comparten las pantallas de Servicio (el contrato):

- **El plan de soporte** de cada cliente vive en la ficha, en `data.plan_soporte` (un dato captado de XENTRIS que el
  equipo corrige a mano): `Básico`, `Pro` o `Enterprise` (sin importar tildes ni mayúsculas). Sin plan, no hay SLA
  comprometido, y se dice así.
- **Tickets en la semilla**: cada contacto de `seed.json` puede traer `tickets: [{ asunto, tipo
  (incidente·solicitud·actualizacion·mantenimiento), prioridad (critica·alta·media·baja), estado
  (abierto·en_progreso·esperando_cliente·resuelto·cerrado), producto, haceHoras, primeraRespuestaEnMin|null,
  resueltoEnHoras|null, asignado }]`. Los siembra `crm/tickets-demo.ts`.
- **`servicio.json`**, junto a la semilla: `{ mantenimientos: [{ titulo, producto, inicioEnHoras (negativo: ya
  pasó), duracionMin, avisoHorasAntes, planes[], estado }], actualizaciones: [{ version, producto, haceDias | enDias,
  notas, estado (publicada·planeada) }] }`. Lo siembra `crm/servicio-demo.ts`.


### Cómo quedó Servicio y la configuración

**Todo configurable.** El usuario lo pidió así: «todo debe ser configurable; la configuración hazla tan extensa como
sea posible, no dejando nada por fuera». Toda regla de negocio se resuelve en **tres capas**, y manda la última que
tenga valor: la **fábrica** (en el código) → el **archivo del cliente** (`xencrm.config.json`) → el **tablero**
(Configuración, solo quien administra; en settings). Cada pantalla de configuración dice de qué capa sale cada valor
y tiene «Volver al de fábrica»; guardar es todo o nada y lo escrito no se borra si algo no vale.

| Dónde | Qué se configura |
|---|---|
| Configuración › **Reglas y umbrales** (`src/reglas.ts`, `reglas.<id>`, sección `reglas` del archivo) | 64 reglas: los cortes y los 16 pesos del puntaje, el silencio, seguimientos, cuentas clave (los 21 y 45 días), los 16 mínimos de Optimización, el embudo, Inicio, el acuerdo de respuesta, contactos, fijados, presencia, respuestas rápidas. Y la lista de lo que se configura en otro sitio, con su enlace |
| Configuración › **SLA y tickets** (`crm/tickets.ts`, `servicio.sla`) | Planes (con alias), «sin plan», prioridades, tipos, estados (cuáles cierran y cuáles pausan), objetivos de primera respuesta y solución por plan × prioridad en reloj hábil o 24/7, el horario de soporte, «En riesgo» (75 %), la regla de primera respuesta, los campos de plan y producto, y quién crea, mueve y cambia las políticas |
| Configuración › **Mantenimientos y actualizaciones** (`crm/mantenimientos-reglas.ts`, `servicio.mantenimientos`) | Aviso mínimo por plan (48 h · 72 h · 7 días), cadencia de actualizaciones (31 días, y por aplicación), días de gracia, aplicaciones, estados, quién cuenta como afectado y cómo se compara la aplicación, la plantilla del aviso (12 variables, con vista previa), si el aviso cuenta al salir o al prepararse, y quién programa. Los planes son los vigentes del SLA (las tres capas) |
| `xencrm.config.json` › **`interfaz`** (`src/vocabulario.ts`) | Cómo se llama lo que se agenda (cita, demo, turno… y su género: «el turno agendado»), la bienvenida, los ejemplos de los campos y la portada. Unos 70 textos del tablero y 20 del servidor salen de aquí |
| Lo que ya existía | El negocio, Perfil, El asistente, Modelos de IA, Lo que sabe, Canales, las metas de KPIs, el embudo (`crm.stages`), los datos captados (`crm.fields`), la agenda (`appointments`) |

**Servicio**, pantalla por pantalla:

- **Tickets**: cada uno con el estado del SLA en palabra e ícono (Incumplido · En riesgo · A tiempo · En pausa ·
  Cumplido · Sin SLA) y el reloj en una frase («Responder antes de las 3:40 p. m. · en 2 h»); vistas Mis tickets,
  Sin asignar, En riesgo, Incumplidos, Terminados; «Crear ticket» desde la Bandeja y la ficha, que muestra sus tickets.
  El reloj hábil solo corre en el horario de soporte; «Esperando al cliente» pausa la solución (no la primera
  respuesta); la primera respuesta es lo primero de: un mensaje de una persona del equipo (el agente de IA no
  cuenta), «Marcar como respondido» o el cierre. Tabla `tickets`; se borran, unen y anonimizan con la ficha.
- **SLA**: cumplimiento a 7 · 30 · 90 días con su base («4 de 5 tickets»), por plan y prioridad, medianas contra el
  objetivo, lo que está en riesgo, y el resumen de mantenimientos y actualizaciones.
- **Mantenimientos y actualizaciones**: ventanas con sus clientes afectados (ganados con el plan y la aplicación), el
  estado del aviso de cada uno, y la cadencia por aplicación. **Ningún aviso sale solo**: «Preparar aviso» deja el
  texto como propuesta en cada conversación y cuenta cuando de verdad salió (o con «Ya le avisé»).

**El ejemplo** tiene 23 contactos por todo el embudo, planes en los ganados, 10 tickets en 8 clientes, 3 demos,
mantenimientos y actualizaciones. **Las pruebas ya no dependen del ejemplo**: corren con su propio fixture
(`src/eval/fixtures/boutique/`, «Atelier Demo», el antiguo contenido de DUNOR con datos de ficción), fijado con
`XENCRM_CONFIG` en cada guion de `package.json`. Batería completa: 3433 bien, 0 fallas.

## La suite (2026-11-11, segunda ronda)

Sobre el mapa de Dynamics, cuatro pantallas nuevas, hechas en paralelo y unidas en `xencrm`. Todas se calculan en el
servidor sobre lo guardado, **sin modelo y sin red**, y lo que no se sabe se dice («—», «Sin precios», «poca
evidencia»), nunca un cero inventado.

| Pantalla | Qué hace | Ruta y archivo |
|---|---|---|
| **Embudo** | Cuántos llegaron a cada etapa (de la historia de cambios de etapa), qué parte pasa a la siguiente, cuántos hay hoy y cuánto valen; «Aquí se quedan más» con 3 o más; dónde se caen los perdidos y por qué. Tocar una etapa abre Tratos filtrado | `GET /admin/api/embudo` · `crm/embudo.ts` |
| **Filtrado** | En Contactos, Tratos y Embudo: vistas del sistema con su número (Todos, Abiertos, Mis tratos, Sin asignar, Calientes, Con cita, Ganados y Perdidos este mes), panel Filtros (etapa, asignado, canal, temperatura en completo, valor, última actividad, dato captado), condiciones como píldoras con ×, y **Guardar vista** (hasta 20, en el navegador de cada quien). Tratos gana Tablero \| Lista | en el tablero |
| **KPIs y metas** | Diez KPIs del periodo (7 · 30 · 90 días) contra el anterior; metas por semana o mes con su barra, la raya del ritmo de hoy y «A tiempo / Atrasada / Cumple»; «Por persona» (lo ganado es de quien tiene asignado el contacto; las respuestas, de quien las escribió; el agente de IA en su fila). Las metas solo las cambia quien administra | `GET /admin/api/kpis`, `GET/PUT /admin/api/metas` (settings `kpis.metas`) · `crm/kpis.ts` |
| **Cuentas clave** (KAM) | La marca de cuenta clave con su plan de cuenta (quién y cuándo), en tarjetas con KAM, valor, último trato, ánimo e interés y la **salud** (Sana · Atención · En riesgo) con su porqué; las candidatas con sus razones; la estrella en la ficha. Marcar y el plan entran en lo que el candado deja cambiar (es del que vende) | `GET /admin/api/cuentas-clave`, `PUT /admin/api/contacts/:id/cuenta-clave` · tabla `cuentas_clave` · `crm/cuentas-clave.ts` |
| **Optimización de ventas** | Catorce reglas fijas: dónde se caen, estancados, seguimientos, lo que el asistente prometió verificar, quien quiere comprar y está molesto, respuestas fuera del acuerdo, si contestar rápido vende más, motivos de pérdida, objeciones, horas y canales… Cada hallazgo con su cifra y su base («6 de 15»), por qué importa, qué hacer y su botón; la tabla de estancados con «Retomar» | `GET /admin/api/optimizacion` · `crm/optimizacion.ts`, `crm/resultados.ts` |

- 🪤 **Tres cálculos de «cuándo se cerró un trato»**: KPIs, Ventas/Optimización y el Embudo lo tenían cada uno.
  KPIs y Ventas usan ahora `cuandoPasoA` (`crm/resultados.ts`); el Embudo lee la historia de una vez y, sin
  historia, dice «no se sabe» en vez de usar la última visita (a propósito).
- 🪤 **En una tabla, el `max-width` de una celda no limita nada**: Contactos se cortaba a 1440 en cuanto había
  valores. Se limita lo de adentro de cada celda y, por debajo de 1600 px, la columna Datos se va.
- Pruebas nuevas: `test:embudo`, `test:kpis`, `test:kam`, `test:optimizacion`. Batería completa: 3069 bien, 0 fallas.

### Lo que queda abierto
- Servicio: el Copiloto de Inicio todavía no propone los tickets en riesgo (su cifra es la suma de los recuadros de
  Hoy; hay que rehacerla para sumarlos).
- Tickets: en reloj hábil, el tiempo gastado deja de contarse a los 62 días (el vencimiento sí se decide bien).
- Mantenimientos: preparar un aviso reemplaza la propuesta que hubiera en esa conversación (hay una sola por
  conversación); los avisos de una ficha no se mudan al unir fichas.
- Vocabulario: algunas respuestas al cliente conservan el pronombre de «cita» («yo la cancelo») con un nombre
  masculino; la consola, `onboard` y las plantillas de `clientes/` siguen diciendo «cita».
- Reglas: quedan por revisar la hora de los recordatorios (8:00 del día antes), `modo-prueba` (12 h), `entrantes`
  (7 días) y `retener` (45 días).

- La ficha como página no tiene «⋯»: el menú contextual de siempre cae debajo del diálogo.
- Cuentas clave no se actualiza en vivo (se recarga al abrirla y tras cada acción); quitar y volver a marcar reinicia
  el «desde». (Sus umbrales ya son reglas.)
- KPIs: la asistencia cuenta solo citas pasadas y marcadas (las sin marcar se dicen aparte).
- Optimización: la regla de horario cuenta por horas enteras.
- El aviso de nota del panel (`chat-nota`) sigue además de la pestaña «Nota interna»: las pruebas de borradores lo
  vigilan. Unificarlo es lo siguiente en la bandeja.
- El modelo de Ollama no se cambia desde Modelos de IA (`CHAT_MODEL` es de toda la máquina).
- La consola y la portada no tienen tema oscuro.
- Sentimiento por voz: falta el modelo que escuche el audio y decidir cuánto se guarda cada nota.
