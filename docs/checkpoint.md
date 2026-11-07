# Checkpoint

Dónde quedó el trabajo, para retomarlo sin releer la conversación. Se reescribe al cerrar cada sesión; el detalle de
cada cambio está en [`arreglos.md`](arreglos.md), con su commit.

## 2026-11-07, al cerrar

**En producción: `d7d17cb`** (el modo fácil de Nexora; revisado en `pnpm salud`).
**Por subir: el ZIP de `paquetes/aiva.zip`**, con el blindaje (`3c96d5d`).

**Qué entró desde el checkpoint anterior.**

- **El blindaje** (`3c96d5d`). El usuario pidió «blindarme ante ingeniería inversa necia» después de preguntarle a
  AIVA-CRYPTO por la AUDITORIA-SEGURIDAD. Esa auditoría era de HRC-Check, no de aiva: de ella salió el estándar de
  HRC (`~/proyectos/AUDITORIA-SEGURIDAD.md`, fuera de git) con su verificador
  (`bash ~/.claude/skills/auditoria-seguridad/verificar.sh <url>`). El detalle está en `seguridad.md` › «El
  blindaje». Lo que cambia para la gente: **el tablero de cada cliente ya no se abre por `/<cliente>/admin`**, solo
  desde la consola (`TABLERO_DIRECTO=si` en el panel lo reabre).
- **La clave del admin de la consola, cambiada** (a pedido del usuario, 7-nov). La de `consola.txt` era vieja: el
  servidor la rechazó (el usuario la había cambiado desde Mi cuenta). Se repuso con la llave maestra; la nueva quedó
  en `~/aiva-credenciales/consola.txt`. En la bitácora queda un «falló · clave equivocada · programa» de las 9:55,
  que fue esa prueba, y dos «falló · usuario que no existe» (`so…(8)`) de las 10:09, que fueron las sondas de la
  dirección.

**Después de subir.**

1. `pnpm salud` para confirmar la versión.
2. Medir de nuevo con el verificador: `https://aiva.hrctechnologies.com` y `/consola`. Antes estaban en 7 y 5 MAL. 🪤
   El MAL de «sin security.txt» en `/consola` es del verificador, que lo busca debajo de esa ruta. Mirar a mano
   que **HSTS y nuestra CSP** lleguen (el alojamiento suma su `upgrade-insecure-requests`: deben verse las dos).
3. **Fijar `AIVA_IP`**: pedir `/_salud` con su token mandando `x-forwarded-for: 203.0.113.8` y mirar
   `tuPeticion.xForwardedFor`. La dirección de verdad queda a la derecha de la inventada; contar cuántos saltos hay
   desde la derecha y ponerlo en el panel (o como valor por defecto en `borde.cjs`, con su prueba).
4. Que entrar siga funcionando como siempre: bryan entra directo a su tablero; el super, a la consola. Un enlace a la
   consola desde WhatsApp abre la puerta y entra solo si la sesión sigue viva (la galleta es Strict).
5. Avisarle a AIVA-CRYPTO la medida de HSTS y la CSP (lo dejó pendiente en el estándar, §A).

**Para mirar.**

- Del blindaje queda abierto: el WAF (llega poniendo Cloudflare o parecido delante, decisión de infraestructura), el
  `server: hcdn` del alojamiento y `style-src 'unsafe-inline'` (riesgo aceptado, escrito en `seguridad.md`).
- Nexora tiene cosas que aiva no: «Oportunidades» con valor y fecha de cierre, «Tareas», ventas que se confirman a
  mano con monto, campos personalizados y calificación con pesos. Si DUNOR pide alguna, preguntar cuál.
- Del audio de DUNOR sigue faltando **Google Sheets** con las medidas: la hoja (o una copia con dos o tres filas),
  sus columnas, si aiva lee, escribe o las dos, y con qué se reconoce a la misma persona.
- DUNOR y HRC no reciben mensajes (DUNOR hace 4 días, HRC 43). El WhatsApp de DUNOR sale apagado y sin vincular.
- El Perfil de DUNOR sigue vacío y sus productos sin precio. Con el candado lo llena el super-admin.
- Pendiente de bryan: en qué pantalla y a qué hora «no respondió el simulador».
- Lo decide el usuario: seguimiento automático, Instagram y Messenger, el módulo de alquileres, la retención.
- Esta máquina corre Node 26 (ICU 79). El Chrome sin pantalla a veces no arranca si quedó otro vivo:
  `pkill -f "perfil-"` y repetir.
