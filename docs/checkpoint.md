# Checkpoint

Dónde quedó el trabajo, para retomarlo sin releer la conversación. Se reescribe al cerrar cada sesión; el detalle de
cada cambio está en [`arreglos.md`](arreglos.md), con su commit.

## 2026-11-03, al cerrar

**En producción: `5f8e6be`** (revisado en `pnpm salud`; arrancó hace 20 h y bryan entró a DUNOR hoy a las 14:39).
**Por subir: el ZIP de `paquetes/aiva.zip`**, con el candado del modo fácil.

**Qué entró desde el checkpoint anterior.**

- **Claude de respaldo** (`b72db16`): entra detrás de los motores de la máquina si `ANTHROPIC_API_KEY` está en el
  panel de Hostinger. La clave local vive en `~/aiva-credenciales/anthropic.txt`, nunca en el `.env` de la raíz.
- **La revisión de DUNOR** (`8fd13b9`…`5f8e6be`): modo fácil, quién hizo qué, A cargo, motivo de pérdida, mensajes
  que no salieron, «undefined COP», adjuntos por la consola.
- **El candado** (`33b8188`): con el modo fácil puesto, solo el super-admin lo quita y ve lo avanzado; todo DUNOR,
  bryan incluido, atiende y nada más. Lo cierra el servidor (`channels/candado.ts`, rol en `x-aiva-rol`).

**Después de subir.**

1. Consola › Clientes › DUNOR › «⋯» › **Poner el modo fácil** (solo lo ve el super-admin). Sin eso DUNOR sigue en
   completo: el ZIP no lo prende solo.
2. `pnpm salud` para confirmar la versión.

**Para mirar.**

- DUNOR y HRC no reciben mensajes (HRC hace 39 días). Si DUNOR está atendiendo, hay que revisar su WhatsApp.
- El Perfil de DUNOR sigue vacío y sus productos sin precio. Con el candado lo llenan desde la llave maestra.
- Con el candado, bryan ya no usa el simulador ni la configuración. Si DUNOR necesita algo de eso, se le quita el
  modo un rato desde la consola.
- Pendiente de bryan: en qué pantalla y a qué hora «no respondió el simulador».
- Lo decide el usuario: seguimiento automático (sugerencia: aiva propone, la persona aprueba), Instagram y
  Messenger, el módulo de alquileres, la retención (apagada en todos).
- Esta máquina corre Node 26 (ICU 79): abrevia «sep» y no «sept». Las pruebas ya aceptan los dos.
