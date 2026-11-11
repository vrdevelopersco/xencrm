# Checkpoint

Dónde quedó el trabajo, para retomarlo sin releer la conversación. Se reescribe al cerrar cada sesión; el detalle de
cada cambio está en [`arreglos.md`](arreglos.md), con su commit.

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
  de producción (el ZIP ahora arma `xencrm.hrctechnologies.com`, que no existe todavía). Decide el usuario: crear el
  repositorio y el dominio de XENCRM.
- Lo abierto de la interfaz está en `xencrm.md` › «Lo que queda abierto»: el Copiloto todavía sin los tickets en
  riesgo, los avisos de mantenimiento al unir fichas, pronombres de «cita» en algunas respuestas al cliente, cuatro
  plazos por llevar a Reglas, el «⋯» de la ficha, el aviso de nota duplicado en la bandeja y el tema oscuro de la
  consola y la portada.
- Sentimiento por voz: falta el modelo que escuche el audio. La pantalla no muestra cifras hasta entonces.
- `docs/firebase.txt` (sin seguir en git) tiene claves en texto plano: sacarlo de la carpeta.
- De aiva siguen valiendo, para cuando XENCRM tenga clientes: el respaldo con Claude sin llave en producción, Google
  Sheets de DUNOR, los WhatsApp de DUNOR y HRC sin vincular (ver el checkpoint del 10-nov en el historial de git).
