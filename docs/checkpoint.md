# Checkpoint

Dónde quedó el trabajo, para retomarlo sin releer la conversación. Se reescribe al cerrar cada sesión; el detalle de
cada cambio está en [`arreglos.md`](arreglos.md), con su commit.

## 2026-11-13 · Modo agéntico, varios agentes, voz con Grok y teléfono por SIP

**Hecho** (detalle en `arreglos.md` › 2026-11-13 y la referencia en `modo-agentico.md`): el asistente puede usar
herramientas con los clientes (apagado de fábrica) y el equipo tiene un copiloto en el tablero (prendido). Módulos
nuevos: `src/llm/herramientas.ts` y `src/agentico/` (`nucleo.ts`, `cliente.ts`, `equipo.ts`); rutas `PUT
/agent/agentico` y `POST /copiloto`; reglas `agentico.pasos` y `agentico.topeTurnoUsd`; prueba `pnpm test:agentico`.
Después, en la misma sesión: **varios agentes** (Configuración › Agente › Agentes: qué atiende cada uno y por dónde,
con relevo) y **voz con Grok** (llamadas desde `/chat`, XENCRM de puente en `/voz/ws`, `XAI_API_KEY`); módulos
`agentico/agentes.ts` y `voz/llamada.ts`, prueba `pnpm test:agentes` (`244bf97`). Y al final, el **teléfono por SIP**
(3CX o cualquier troncal, `voz/telefono.ts`, `XAI_SIP_SECRETO` y `XAI_SIP_DESVIO`) con el **omnicanal** (tarjetas de
voz y teléfono en Canales, la insignia y el aviso en la Bandeja, qué agente dijo cada cosa); prueba
`pnpm test:telefono`. **Batería: 3777 bien, 0 fallas.** Las instancias de prueba de esta sesión quedaron apagadas.

**Para retomar:**
- Una llamada con la llave real de xAI (`XAI_API_KEY`) y una troncal real (3CX o proveedor): hasta ahora, contra xAI
  simulado. En la primera llamada por teléfono, confirmar el formato de la firma del aviso (Standard Webhooks).
- Queda corriendo una demo de la consola del 12-nov (puerto 3913, en un scratchpad de esa sesión): apagarla si no se usa.
- Medirlo con un modelo real (los escenarios con el modo prendido contra el de siempre: calidad, costo, latencia)
  antes de prenderlo con clientes. Cuesta llamadas: decidir con Luis con qué motor y cuántas.
- Ideas que quedaron fuera a propósito: perfiles por especialidad (ventas, soporte), respuestas por partes y
  memoria del copiloto en el servidor.

## 2026-11-13 · El calendario más completo · `2512ce5`

**Las cuatro ideas del calendario, hechas** (detalle y porqués en `arreglos.md` › 2026-11-13; cómo se usa en
`guia-del-tablero.md` › Citas): timeline en franjas de media hora con las citas que se cruzan en carriles; tarjetas
con canal, recordatorio, enlace y valor, y una vista rápida con el **enlace de la videollamada**; el panel «Hoy»
(próxima con cuenta regresiva, hoy, mañana, recordatorios y cupo); y los anuncios: **festivos de Colombia**
calculados, **días bloqueados** (el asistente no los ofrece), mantenimientos y días casi llenos o llenos. Módulos
nuevos: `crm/festivos.ts`, `crm/cierres.ts`, `crm/agenda-vista.ts`; prueba nueva `pnpm test:agenda`.
**Batería: 3610 bien, 0 fallas.** Visto en Chrome (Playwright, `channel: 'chrome'`) a 1440 y 390, claro y oscuro.

**Supuestos tomados (para revisar con Luis):**
- Un festivo **no cierra** la agenda solo: lo anuncia y se bloquea con un clic. Si se prefiere que los festivos
  cierren solos, es una opción más en `appointments` (no está hecha).
- Bloquear un día es de quien administra (el candado no lo deja); poner el enlace de la videollamada es de todos.
- «Casi lleno» desde el 80 % (`agenda.casiLlenoPct`) y cinco días de cupo en el panel (`agenda.diasCupo`).

**Para retomar:** subido a `vrdevelopersco/xencrm` (`main`). Siguen los pendientes del 12-nov (`PROSPECTOS_CLIENTE`, dominio de `pnpm paquete`, el caso con fecha
de `test:scenarios`).

## 2026-11-12, al cerrar · XENCRM público

**El repositorio es `vrdevelopersco/xencrm` (público)**, con el historial reescrito; su estado y cómo se publicó están
en `checkpoint_repo.md` (sin seguimiento, en la raíz). Lo de esta sesión, con su porqué, en `arreglos.md` › 2026-11-12:
tickets como tablero, la portada y la puerta con olas y registro, Ventas › Prospectos, Configuración en dos paneles (y
el arreglo del Guardar de SLA), tickets y prospectos de cada cliente en la consola, sin marca de terceros y el ejemplo
XENTRIS con la identidad de xentris.tech. **Batería: 3537 bien, 0 fallas.**

**Para retomar:**
- Configurar `PROSPECTOS_CLIENTE` en el despliegue (el slug del CRM que recibe los registros) y pasar el dominio a
  `pnpm paquete` (ya no hay uno por defecto).
- Pendiente de decidir con Luis: el calendario más rico (timeline detallado, tarjetas con más datos, panel «Hoy»,
  anuncios);.
- `pnpm test:scenarios` tiene un caso que depende de la fecha («después del puente festivo de octubre»): falla pasado
  octubre. No está en `pnpm test`.

## 2026-11-11, al cerrar · XENCRM

**Esta carpeta es XENCRM**, la siguiente generación de aiva: una copia de su repositorio (mismo historial hasta
`0057343`) en la rama **`xencrm`**. 🪤 **El remoto `origin` sigue siendo `vrdevelopersco/aiva`**: no se subió nada y
no hay que subir nada desde aquí hasta que XENCRM tenga su propio repositorio (decisión del usuario). Producción de
aiva no cambió: su último checkpoint, el del 10-nov, sigue valiendo para ~/proyectos/aiva.

**Qué hay en la rama** (detalle en `xencrm.md` › «Cómo quedó»): una sola piel —la del modo fácil— para todos, con
identidad propia y el vocabulario de un CRM de mensajería; Inicio con el copiloto XEN; la Bandeja omnicanal; Contactos,
la ficha, Tratos y Citas al estilo SendPulse; Analítica con el sentimiento por emojis y la voz «por desarrollar»;
Configuración › Modelos de IA (OpenAI, Anthropic, Apple FM, Ollama, LM Studio y cualquier compatible con OpenAI); y el
renombre a XENCRM de la consola, la portada, el README y los textos. Batería de entonces: 2794 bien, 0 fallas.

**La suite (segunda ronda)**: el menú se ordena como Dynamics 365 (Mi trabajo · Clientes · Ventas · Rendimiento, con
el cambio de área a Configuración) y hay cuatro pantallas nuevas: Embudo (con el filtrado y las vistas guardadas en
Contactos y Tratos), KPIs y metas, Cuentas clave (KAM) y Optimización de ventas. Detalle en `xencrm.md` › «La suite».
Batería de entonces: 3069 bien, 0 fallas.

**Servicio y XENTRIS (tercera ronda)**: el ejemplo de XENCRM es **XENTRIS LLC**, una firma de software
(`examples/xentris`, la configuración de la raíz); DUNOR solo queda como historia y, con datos de ficción, como el
fixture de las pruebas («Atelier Demo», `src/eval/fixtures/boutique/`). Hay un área nueva, **Servicio** (Tickets, SLA,
Mantenimientos y actualizaciones), y **todo es configurable** en tres capas (fábrica → `xencrm.config.json` →
tablero): Reglas y umbrales (64 reglas), SLA y tickets, Mantenimientos y actualizaciones, y el vocabulario de la
interfaz (`interfaz`: «demo», «turno»…). Detalle en `xencrm.md` › «Servicio y el ejemplo de XENTRIS LLC».
**Batería: 3433 bien, 0 fallas.** Último commit de código: `2d7c011` (la unión de Tickets y SLA); después,
solo documentación y capturas.

**Dónde está cada cosa escrita**: `xencrm.md` (la referencia de XENCRM: piel, glosario, mapa, cada pantalla, Servicio,
la configuración en tres capas y lo abierto), `guia-del-tablero.md` (para entrenar al equipo: ya con el menú por
áreas, Embudo y vistas, Cuentas clave, Sentimiento, KPIs, Optimización, Servicio, Modelos de IA y «Todo es
configurable»), `arquitectura.md` (módulos, tablas y reglas de XENCRM, y cómo corren las pruebas), el README y la
bitácora. Las capturas, en `capturas/xencrm-next-evolution/` (21 pantallas a 1440 y a 390, en claro).

**Cómo verlo en local, sin tocar nada real**: una base aparte y sin llaves —
`DB_PATH=<carpeta temporal>/demo.db PORT=3711 ADMIN_TOKEN=<inventado> OPENAI_API_KEY= ANTHROPIC_API_KEY=
WHATSAPP_ENABLED=false XENCRM_ENV_FILE=<archivo vacío> npx tsx src/seed.ts` y luego `npx tsx src/index.ts` con lo
mismo; el tablero en `http://127.0.0.1:3711/admin` con ese token. Sin `XENCRM_CONFIG`, carga el ejemplo de
XENTRIS. 🪤 Las pruebas fijan su propio `XENCRM_CONFIG`; correr una suite suelta con `npx tsx src/eval/x.ts` usa la
raíz y puede fallar: usar `pnpm test:x`.

**Para mirar.**

- **El renombre es completo** (a pedido del usuario: «es una evolución del mismo»), también lo de adentro: `XENCRM_*`,
  `xencrm.config.json`, `data/xencrm.db`, la galleta, las cabeceras, las llaves del navegador, pm2, MCP. Lo local se
  migró con `herramientas/migrar-a-xencrm.mjs --aplicar` (respaldos `*.antes-de-xencrm`, que git no sigue).
  🪤 Las copias de los clientes en `clientes/*/.env` apuntaban a las bases y sesiones de WhatsApp de
  `~/proyectos/aiva`: ahora apuntan a las copias de esta carpeta. Aun así, **no arrancar los clientes con WhatsApp
  desde aquí**: las sesiones copiadas son las de aiva y conectarlas podría cerrar las de producción.
- Lo de afuera que todavía se llama aiva, y que el código ya no nombra: el repositorio de GitHub (`origin`), la carpeta
  de llaves `~/aiva-credenciales` (las herramientas ahora buscan `~/xencrm-credenciales`, que no existe) y el dominio
  de producción (el ZIP se arma con el dominio que se le pase: `pnpm paquete tu-dominio.com`). Decide el usuario: crear el
  repositorio y el dominio de XENCRM.
- Lo abierto de la interfaz está en `xencrm.md` › «Lo que queda abierto»: el Copiloto todavía sin los tickets en
  riesgo, los avisos de mantenimiento al unir fichas, pronombres de «cita» en algunas respuestas al cliente, cuatro
  plazos por llevar a Reglas, el «⋯» de la ficha, el aviso de nota duplicado en la bandeja y el tema oscuro de la
  consola y la portada.
- Sentimiento por voz: falta el modelo que escuche el audio. La pantalla no muestra cifras hasta entonces.
- `docs/firebase.txt` (sin seguir en git) tiene claves en texto plano: sacarlo de la carpeta.
- De aiva siguen valiendo, para cuando XENCRM tenga clientes: el respaldo con Claude sin llave en producción, Google
  Sheets de DUNOR, los WhatsApp de DUNOR y ATLAS sin vincular (ver el checkpoint del 10-nov en el historial de git).
