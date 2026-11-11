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
renombre a XENCRM de la consola, la portada, el README y los textos. Batería: 2794 bien, 0 fallas.

**Cómo verlo en local, sin tocar nada real**: una base aparte y sin llaves —
`DB_PATH=<carpeta temporal>/demo.db PORT=3711 ADMIN_TOKEN=<inventado> OPENAI_API_KEY= ANTHROPIC_API_KEY=
WHATSAPP_ENABLED=false XENCRM_ENV_FILE=<archivo vacío> npx tsx src/seed.ts` y luego `npx tsx src/index.ts` con lo
mismo; el tablero en `http://127.0.0.1:3711/admin` con ese token.

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
- Lo abierto de la interfaz está en `xencrm.md` › «Lo que queda abierto» (el «⋯» de la ficha, el aviso de nota
  duplicado en la bandeja, el tema oscuro de consola y portada).
- Sentimiento por voz: falta el modelo que escuche el audio. La pantalla no muestra cifras hasta entonces.
- `docs/firebase.txt` (sin seguir en git) tiene claves en texto plano: sacarlo de la carpeta.
- De aiva siguen valiendo, para cuando XENCRM tenga clientes: el respaldo con Claude sin llave en producción, Google
  Sheets de DUNOR, los WhatsApp de DUNOR y HRC sin vincular (ver el checkpoint del 10-nov en el historial de git).
