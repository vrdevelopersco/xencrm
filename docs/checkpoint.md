# Checkpoint

Dónde quedó el trabajo, para retomarlo sin releer la conversación. Se reescribe al cerrar cada sesión; el detalle de
cada cambio está en [`arreglos.md`](arreglos.md), con su commit.

## 2026-11-04, al cerrar

**En producción: `216264b`** (revisado en `pnpm salud`: la ficha y la entrada directa; bryan entró ayer a las 16:15).
**Por subir: el ZIP de `paquetes/aiva.zip`**, con el modo fácil de Nexora.

**Qué entró desde el checkpoint anterior.**

- **El modo fácil se viste de Nexora** (`7c2f4ec`, `2a3a44e`). DUNOR mandó Nexora (un CRM hecho en ChatGPT, por dentro
  «Vindex IA») como muestra: «que se vea igual, pero en nuestro producto». Se armó en local con su código público
  para copiarla sin entrar con clave. El fácil tiene su menú (Principal: Inicio, Analítica, Inbox; CRM: Contactos,
  Citas, Pipeline, Ventas, Seguimientos), su barra de arriba y su Inicio; las demás pantallas, su piel. El completo
  no cambia (`test:facil` lo vigila regla por regla). Reglas en `diseno-tablero.md` › «El modo fácil se viste de
  Nexora».
- **El candado deja leer Analítica, Ventas y Seguimientos** (están en el menú de la muestra). La configuración y lo
  que cuesta aiva siguen cerrados para todo DUNOR menos el super-admin.

**Después de subir.**

1. `pnpm salud` para confirmar la versión.
2. DUNOR ya tiene el modo fácil puesto: bryan lo verá al entrar. Si alguien de DUNOR lo quiere ver sin el candado,
   solo el super-admin lo quita, desde «⋯» en la consola.

**Para mirar.**

- Nexora tiene cosas que aiva no: «Oportunidades» con valor y fecha de cierre, «Tareas», ventas que se confirman a
  mano con monto, campos personalizados y calificación con pesos. En aiva la venta es la etapa de ganado y el valor
  sale del catálogo o se escribe en la ficha. Si DUNOR pide alguna, preguntar cuál antes de construir.
- Del audio de DUNOR sigue faltando **Google Sheets** con las medidas: hace falta la hoja (o una copia con dos o tres
  filas), sus columnas, si aiva lee, escribe o las dos, y con qué se reconoce a la misma persona.
- DUNOR y HRC no reciben mensajes (HRC hace 39 días). Si DUNOR está atendiendo, hay que revisar su WhatsApp.
- El Perfil de DUNOR sigue vacío y sus productos sin precio: «Valor del embudo» y Ventas salen sin plata. Con el
  candado lo llena el super-admin.
- Pendiente de bryan: en qué pantalla y a qué hora «no respondió el simulador».
- Lo decide el usuario: seguimiento automático (sugerencia: aiva propone, la persona aprueba), Instagram y
  Messenger, el módulo de alquileres, la retención (apagada en todos).
- Esta máquina corre Node 26 (ICU 79): abrevia «sep» y no «sept». Las pruebas ya aceptan los dos.
- El Chrome sin pantalla de las pruebas a veces no arranca si quedó otro vivo: `pkill -f "perfil-"` y repetir.
