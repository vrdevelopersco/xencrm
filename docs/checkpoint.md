# Checkpoint

Dónde quedó el trabajo, para retomarlo sin releer la conversación. Se reescribe al cerrar cada sesión; el detalle de
cada cambio está en [`arreglos.md`](arreglos.md), con su commit.

## 2026-11-11, al cerrar · XENCRM

**Esta carpeta es XENCRM**, la siguiente generación de aiva: una copia del repositorio de aiva (mismo historial hasta
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
WHATSAPP_ENABLED=false AIVA_ENV_FILE=<archivo vacío> npx tsx src/seed.ts` y luego `npx tsx src/index.ts` con lo
mismo; el tablero en `http://127.0.0.1:3711/admin` con ese token.

**Para mirar.**

- Decide el usuario: crear el repositorio de XENCRM (y cambiar `origin`), y si los nombres internos (`AIVA_*`,
  `aiva.config.json`, la galleta, las cabeceras `x-aiva-*`) se renombran algún día. Hoy se quedaron a propósito: son
  compatibilidad con los datos y despliegues de aiva.
- Lo abierto de la interfaz está en `xencrm.md` › «Lo que queda abierto» (el «⋯» de la ficha, el aviso de nota
  duplicado en la bandeja, el tema oscuro de consola y portada).
- Sentimiento por voz: falta el modelo que escuche el audio. La pantalla no muestra cifras hasta entonces.
- `docs/firebase.txt` (sin seguir en git) tiene claves en texto plano: sacarlo de la carpeta.
- De aiva siguen valiendo, para cuando XENCRM tenga clientes: el respaldo con Claude sin llave en producción, Google
  Sheets de DUNOR, los WhatsApp de DUNOR y HRC sin vincular (ver el checkpoint del 10-nov en el historial de git).
