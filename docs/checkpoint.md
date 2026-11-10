# Checkpoint

Dónde quedó el trabajo, para retomarlo sin releer la conversación. Se reescribe al cerrar cada sesión; el detalle de
cada cambio está en [`arreglos.md`](arreglos.md), con su commit.

## 2026-11-10, al cerrar

**En producción: `4f84cfc`** (el blindaje entero, con la dirección de quien llama ya medida; subido y comprobado el
7-nov: mandando una dirección inventada, la bitácora anota la de verdad). **Nada por subir**: lo que va después de
ese commit es solo documentación. El 10-nov `/_salud` decía `4f84cfc`, un solo lanzador (`con el mando`), cero caídas,
y en pie desde el 9-nov a las 17:41 (hora de Colombia): arrancó de nuevo ese día, sin caída de por medio.

**Cómo está medido (9-nov, verificador corregido; repetido el 10-nov, igual): portada y consola, 9 OK · 1 MAL · 6 por revisar.** El MAL es
`server: hcdn`, del alojamiento. Los «por revisar» no piden arreglo: `style-src 'unsafe-inline'` es un riesgo aceptado,
y lo de `/docs`, los guiones para medir y el sondeo público es como aiva está hecho.

**Qué entró desde el checkpoint anterior.**

- **El blindaje** (`3c96d5d`). El usuario pidió «blindarme ante ingeniería inversa necia» después de preguntarle a
  AIVA-CRYPTO por la AUDITORIA-SEGURIDAD. Esa auditoría era de HRC-Check, no de aiva: de ella salió el estándar de
  HRC (`~/proyectos/AUDITORIA-SEGURIDAD.md`, fuera de git) con su verificador
  (`bash ~/.claude/skills/auditoria-seguridad/verificar.sh <url>`). El detalle está en `seguridad.md` › «El
  blindaje». Lo que cambia para la gente: **el tablero de cada cliente ya no se abre por `/<cliente>/admin`**, solo
  desde la consola (`TABLERO_DIRECTO=si` en el panel lo reabre).
- **La clave del admin de la consola, cambiada** (a pedido del usuario, 7-nov). La de `consola.txt` era vieja: el
  servidor la rechazó (el usuario la había cambiado desde Mi cuenta). Se repuso con la llave maestra; la nueva quedó
  en `~/aiva-credenciales/consola.txt`. En la bitácora del 7-nov son míos: «falló · clave equivocada · programa» de
  las 9:55, los «usuario que no existe» (`so…(8)`, `so…(13)` y `so…(14)`) de las 10:09, 11:29 y 11:34, y los
  «entró / salió admin · programa» de las 10:10 y las 11:29, que fueron medidas de la galleta.

**Para mirar.**

- 🪤 **El respaldo con Claude no está puesto en producción.** Medido el 10-nov en `/_salud` › `modelos`: los tres
  clientes dicen `anthropic` «sin ANTHROPIC_API_KEY». Así que si OpenAI se cae, rechaza la llave o se queda sin
  saldo, aiva deja de contestar en los tres (allá no corren Ollama ni Apple). Lo arregla el usuario poniendo
  `ANTHROPIC_API_KEY` en el panel de Hostinger; la llave nunca pasa por el chat ni por el ZIP. Para confirmarlo
  después: `pnpm salud --json`, `anthropic` tiene que salir `disponible: true`.

- Del blindaje queda abierto: el WAF (llega poniendo Cloudflare o parecido delante, decisión de infraestructura), el
  `server: hcdn` del alojamiento y `style-src 'unsafe-inline'` (riesgo aceptado, escrito en `seguridad.md`). 🪤 Si
  se pone Cloudflare, la lectura de la dirección cambia ese mismo día (ver `seguridad.md`, la dirección de quien
  llama): AIVA-CRYPTO ofreció revisarlo juntos.
- Nexora tiene cosas que aiva no: «Oportunidades» con valor y fecha de cierre, «Tareas», ventas que se confirman a
  mano con monto, campos personalizados y calificación con pesos. Si DUNOR pide alguna, preguntar cuál.
- Del audio de DUNOR sigue faltando **Google Sheets** con las medidas: la hoja (o una copia con dos o tres filas),
  sus columnas, si aiva lee, escribe o las dos, y con qué se reconoce a la misma persona.
- DUNOR y HRC no reciben mensajes (el 10-nov: DUNOR hace 7 días, HRC 46). El WhatsApp de DUNOR sigue apagado y sin
  vincular, y el de HRC con la sesión cerrada. CONFIA, conectado y con 36 mensajes ese día. Si DUNOR está
  atendiendo, hay que revisarlo.
- El Perfil de DUNOR sigue vacío y sus productos sin precio. Con el candado lo llena el super-admin.
- Pendiente de bryan: en qué pantalla y a qué hora «no respondió el simulador».
- Lo decide el usuario: seguimiento automático, Instagram y Messenger, el módulo de alquileres, la retención.
- Esta máquina corre Node 26 (ICU 79). El Chrome sin pantalla a veces no arranca si quedó otro vivo:
  `pkill -f "perfil-"` y repetir.
