# Aprender del historial de un cliente

Cuando un negocio conecta su WhatsApp, trae consigo meses o años de conversaciones. Ahí está cómo atienden de
verdad: con qué palabras, en qué orden, qué les preguntan todos los días. Es lo más valioso que tiene un cliente
nuevo y hoy se desperdicia: cada instancia arranca sin saber nada de su negocio.

Este documento es el diseño de cómo aprovecharlo **sin que el asistente empiece a repetir cosas vencidas**.

## La regla

> **Del historial se aprende la forma de contestar y de atender. Nunca los precios ni las políticas.**

| Sí se aprende | No se aprende |
|---|---|
| El tono: cómo saludan, cómo cierran, si tutean o tratan de usted | Precios, tarifas, tasas, cuotas |
| Cómo piden los datos que necesitan y en qué orden | Horarios, direcciones, zonas de cobertura |
| Cómo manejan una queja, una demora, un "está muy caro" | Plazos y tiempos de entrega |
| El vocabulario del negocio y las muletillas de sus clientes | Promociones, cupos, disponibilidad |
| **Qué preguntan** (el tema, no la respuesta) | Condiciones, políticas, requisitos |

El motivo es simple: una respuesta de hace ocho meses trae un precio de hace ocho meses, y el asistente la
repetiría con toda la autoridad del mundo. Es justo lo que las guardas (`ungroundedNumbers`, `unsupportedAnswer`)
existen para impedir. Si además ese dato entrara al índice de conocimiento, la guarda lo daría por respaldado: el
error quedaría "verificado" por nosotros mismos.

Por eso: **el historial llena las preguntas, el negocio llena las respuestas.**

## Qué sale de ahí, en concreto

1. **Los temas frecuentes.** Agrupar lo que más preguntan da el listado real de lo que el negocio tiene que tener
   respondido. Cada tema entra al **Perfil** como un dato *por confirmar*, para que el equipo escriba el valor de
   hoy. Así, un cliente nuevo no arranca con un Perfil en blanco sino con la lista de lo que sus clientes
   preguntan de verdad.
2. **El estilo.** De una muestra de respuestas del negocio (no de las del bot) sale una descripción del tono que
   va a `agent.style`, revisable en el tablero. Sin cifras: solo la manera.
3. **El diccionario.** Las expresiones locales de sus clientes ("me regala", "a la hora del almuerzo", "el otro
   finde") pasan por el mismo camino que "Frases que no entendimos": se proponen con su significado y alguien las
   aprueba.
4. **El CRM sembrado.** Contactos con su conversación y su fecha, para que el tablero no nazca vacío y el puntaje
   tenga con qué calibrarse. Esto es historia, no conocimiento: no alimenta las respuestas.

## Lo que nunca pasa

- El historial **no entra al índice de conocimiento**. Ni entero ni resumido.
- Ningún dato del historial se convierte en respuesta automática. Lo que se propone, una persona lo confirma —el
  mismo camino de *Por verificar* y *Enseñar*, que ya existe y ya está probado.
- Si un texto de estilo trae una cifra, se descarta: el estilo se describe, no se cita.

## Antes de tocar un solo mensaje

Son datos personales de terceros (Ley 1581, Habeas Data). El negocio es el responsable y aiva el encargado:

- Autorización escrita del cliente para procesar su historial, con la finalidad dicha (entrenar la atención).
- Finalidad limitada: nada de cruzar datos entre clientes. Cada tenant tiene su base, y eso se mantiene.
- Con una financiera hay además datos financieros: se procesa lo mínimo y no se guarda lo que no se necesita.
- Si el número es personal además de comercial, hay conversaciones privadas de por medio: se acuerda el rango de
  fechas y se excluye lo que no sea del negocio.

## Por dónde se empieza

1. Traer el historial al vincular WhatsApp (Baileys ya puede: hoy `syncFullHistory: false` en
   `src/channels/whatsapp.ts`), sin responder nada, solo leer.
2. Pantalla **"Lo que aprendimos de sus chats"**: los temas frecuentes y las expresiones encontradas, para
   confirmar con un clic. Nada se aplica solo.
3. Sembrar el CRM con los contactos y sus conversaciones.
