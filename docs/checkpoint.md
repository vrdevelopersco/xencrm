# Checkpoint

Dónde quedó el trabajo, para retomarlo sin releer la conversación. Se reescribe al cerrar cada sesión; el detalle de
cada cambio está en [`arreglos.md`](arreglos.md), con su commit.

## 2026-11-09, al cerrar

**En producción: `4f84cfc`** (el blindaje entero, con la dirección de quien llama ya medida; subido y comprobado el
7-nov: mandando una dirección inventada, la bitácora anota la de verdad). **Nada por subir**: lo que va después de
ese commit es solo documentación.

**Cómo está medido (9-nov, verificador corregido): portada y consola, 8 OK · 1 MAL.** El MAL es `server: hcdn`, del
alojamiento. Los «por revisar» no piden arreglo: `style-src 'unsafe-inline'` es un riesgo aceptado y lo demás (sin
`/docs`, sin activos con huella, sin sondeo público) es como aiva está hecho.

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

- Del blindaje queda abierto: el WAF (llega poniendo Cloudflare o parecido delante, decisión de infraestructura), el
  `server: hcdn` del alojamiento y `style-src 'unsafe-inline'` (riesgo aceptado, escrito en `seguridad.md`). 🪤 Si
  se pone Cloudflare, la lectura de la dirección cambia ese mismo día (ver `seguridad.md`, la dirección de quien
  llama): AIVA-CRYPTO ofreció revisarlo juntos.
- Nexora tiene cosas que aiva no: «Oportunidades» con valor y fecha de cierre, «Tareas», ventas que se confirman a
  mano con monto, campos personalizados y calificación con pesos. Si DUNOR pide alguna, preguntar cuál.
- Del audio de DUNOR sigue faltando **Google Sheets** con las medidas: la hoja (o una copia con dos o tres filas),
  sus columnas, si aiva lee, escribe o las dos, y con qué se reconoce a la misma persona.
- DUNOR y HRC no reciben mensajes (el 9-nov: DUNOR hace 6 días, HRC 45). El WhatsApp de DUNOR estaba apagado y sin
  vincular. Si DUNOR está atendiendo, hay que revisarlo.
- El Perfil de DUNOR sigue vacío y sus productos sin precio. Con el candado lo llena el super-admin.
- Pendiente de bryan: en qué pantalla y a qué hora «no respondió el simulador».
- Lo decide el usuario: seguimiento automático, Instagram y Messenger, el módulo de alquileres, la retención.
- Esta máquina corre Node 26 (ICU 79). El Chrome sin pantalla a veces no arranca si quedó otro vivo:
  `pkill -f "perfil-"` y repetir.
