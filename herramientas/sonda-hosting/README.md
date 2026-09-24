# Sonda de hosting

Una app mínima (sin dependencias) que se despliega en un hosting y responde **si ahí puede vivir aiva**.

No prueba "si corre Node" —eso lo dice cualquier panel—; prueba las cuatro cosas que aiva necesita y que un
hosting compartido normalmente **no** tiene:

1. **Que el proceso siga vivo sin que nadie lo visite.** WhatsApp mantiene un socket abierto; si el hosting duerme
   la app entre peticiones, el número se desconecta y aiva deja de recibir mensajes.
2. **Que pueda abrir un WebSocket hacia afuera y sostenerlo.** Así habla Baileys con WhatsApp.
3. **Que el disco sea de verdad y persista.** La base de cada cliente es un archivo SQLite.
4. **Cuánta memoria hay y si el proceso se reinicia solo.**

## Cómo usarla

1. Sube esta carpeta a un repositorio (o usa el de aiva y apunta a `herramientas/sonda-hosting`).
2. En el panel del hosting, "Desplegar app web" desde GitHub, con `npm start` como comando de arranque.
3. Abre la URL. La página se recarga sola cada 30 segundos.
4. **Lo importante: vuelve una hora después sin haberla visitado.** Si los latidos siguieron subiendo, el hosting
   deja vivir el proceso. Si se quedaron congelados, lo durmió.
5. Reinicia la app desde el panel y vuelve a abrirla: si dice que el archivo sobrevivió al reinicio, el disco es
   persistente.

`/json` devuelve lo mismo en JSON, por si lo quieres revisar desde la terminal.

## Cómo leer el resultado

| Lo que dice | Qué significa para aiva |
|---|---|
| El proceso late solo | ✅ Puede sostener WhatsApp |
| El proceso NO late solo | ❌ Sirve para el chat del sitio, no para WhatsApp |
| WebSocket saliente abierto | ✅ Baileys va a poder conectarse |
| WebSocket bloqueado | ❌ WhatsApp por QR no funciona ahí |
| El archivo sobrevivió al reinicio | ✅ La base de datos está a salvo |
| El disco no acepta escrituras | ❌ No sirve: cada cliente necesita su archivo |

## La quinta pregunta, que es la que muerde

Hay hostings que despliegan en una carpeta nueva cada vez (`…/versions/<uuid>/`). Ahí, lo que la app escriba al
lado de su código **sobrevive a un reinicio pero no a un redespliegue**: la versión nueva estrena carpeta y los
datos quedan huérfanos en la vieja. Para una base SQLite eso es perderlo todo en la primera actualización.

Por eso la sonda busca además **un sitio estable fuera de la carpeta del despliegue** y cuenta los arranques ahí
por separado. Para comprobarlo:

1. Despliega y abre la sonda. Anota los dos números: `arranques` y `arranquesEnSitioEstable`.
2. **Vuelve a desplegar** (sube el mismo ZIP otra vez).
3. Abre de nuevo. Si `arranques` volvió a 1 pero `arranquesEnSitioEstable` siguió subiendo, ahí es donde va la base
   de datos, y el hosting sirve. Si los dos volvieron a 1, no hay dónde guardar nada que dure.

Si todo sale bien, falta una sola cosa antes de mover aiva ahí: **cuántas apps permite el plan**. aiva corre un
proceso por cliente más la consola, así que con tres clientes son cuatro apps (o un VPS donde corren todas).
