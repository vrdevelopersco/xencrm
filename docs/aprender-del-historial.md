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
3. **El diccionario.** Las expresiones locales de sus clientes ("de hoy en quince", "terno") salen de dos lugares:
   las fechas que las reglas no entienden (agrupadas por la frase de tiempo, así "¿me atienden de hoy en quince?" y
   "paso de hoy en quince" son una sola) y las palabras que repiten y no están en el catálogo, el perfil ni el
   diccionario. Pasan por el mismo camino que "Frases que no entendimos": se proponen y alguien las enseña, y solo
   se guardan si con eso las reglas ya entienden. *(Hecho.)*
4. **El CRM sembrado.** Contactos con su conversación y su fecha, para que el tablero no nazca vacío y el puntaje
   tenga con qué calibrarse. Esto es historia, no conocimiento: no alimenta las respuestas.

## Lo que nunca pasa

- El historial **no entra al índice de conocimiento**. Ni entero ni resumido.
- Ningún dato del historial se convierte en respuesta automática. Lo que se propone, una persona lo confirma —el
  mismo camino de *Por verificar* y *Enseñar*, que ya existe y ya está probado.
- Si un texto de estilo trae una cifra, se descarta: el estilo se describe, no se cita.

## Las credenciales se tapan antes de guardar

Un grupo de soporte no solo trae conversación: trae accesos. «Usuario: … Clave: …», claves temporales, tokens,
enlaces con la clave dentro. Eso no puede quedar guardado en un CRM ni salir en una pantalla, así que se tapa
**antes de escribir en la base**, no como filtro de después (`src/crm/secretos.ts`). Pasa por ahí todo lo que
entra: el chat que se trae como conversación y el mismo chat leído para aprender el estilo.

Tapa de más antes que de menos. Una etiqueta que abre renglón y lleva dos puntos anuncia un valor, y el valor se
va: si la etiqueta quedó sola («Clave temporal:»), se va el renglón siguiente completo. Lo que no se toca es la
frase donde solo se *habla* de una clave («recuérdanos la clave de administrador»), que es justo de donde se
aprende cómo atienden.

## Dos caminos, no uno

El mismo archivo exportado sirve para dos cosas distintas, y conviene no confundirlas:

| | `crm/historial.ts` | `crm/importar.ts` |
|---|---|---|
| Para qué | Aprender **cómo atienden** y qué les preguntan | Tener la conversación **en el tablero** |
| Dónde queda | Tabla `import_messages`, aparte | Como una ficha más, con prefijo `wa:hist-` |
| Qué se ve | Propuestas que una persona confirma | La conversación con su historial y quién contestó |
| Cómo se deshace | Borrar el historial importado | Quitar las traídas (no toca ninguna real) |

Lo del equipo entra como respuesta **de una persona**, con su nombre —nunca como si lo hubiera dicho el
asistente—, y la conversación cae en la columna que le corresponde por lo reciente que sea: un grupo que se
apagó hace meses no es trabajo pendiente.

🪤 WhatsApp exporta con el formato de fecha del teléfono que exportó: `11/08/26` es 11 de agosto en un archivo y
8 de noviembre en otro. El orden se deduce del archivo entero antes de leer nada; adivinar mal manda la
conversación al futuro. Y sus propios avisos (creó el grupo, añadió a alguien, multimedia omitido) vienen con un
carácter invisible al inicio: por ahí se reconocen, no por las frases, que cambian con el idioma del teléfono.

## Llevárselo a otra instancia

`src/crm/aprendizaje.ts` · pruebas: `pnpm test:aprendizaje` · en el tablero: **Perfil › Lo que aprendimos de sus chats**

Un negocio que lleva meses atendiendo ha ido dejando algo que no está en su configuración ni en su catálogo:
**cómo atiende**. Las preguntas que le hacen de verdad, las palabras con las que contesta, y los temas que
alguien ya miró uno por uno y decidió. Eso no se vuelve a escribir a mano, y hasta ahora se quedaba atrás cada
vez que la instancia cambiaba de sitio. Con el respaldo de configuración (`crm/respaldo.ts`), los dos juntos
hacen que un cliente sea de verdad portátil.

Se exporta de dos formas, y la diferencia importa:

- **Todo**: incluye las conversaciones en bruto. Es lo que hace falta para mudar un cliente de servidor.
- 🪤 **Sin conversaciones**: solo los temas y lo decidido. El material en bruto son charlas reales de clientes
  finales con sus nombres dentro; moverlo de servidor es mover datos de personas. Cuando lo único que hace falta
  es lo aprendido, esta es la que se usa, y el archivo dice que va sin ellas.

🪤 **Lo de un negocio no entra en otro sin que alguien lo decida.** Al traerlo se avisa si viene de otro cliente
y hay que confirmar: mezclar el aprendizaje de una boutique con el de una financiera no da un asistente mejor,
da uno que no suena a ninguno de los dos.

Al restaurar se **suma, no se reemplaza**, y lo repetido no se duplica: traer dos veces el mismo archivo deja lo
mismo que traerlo una.

## Antes de tocar un solo mensaje

Son datos personales de terceros (Ley 1581, Habeas Data). El negocio es el responsable y XENCRM el encargado:

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
