# La odisea del 503

El 29 de septiembre de 2026 el sitio estuvo caído casi toda la mañana. Se diagnosticó mal cinco veces seguidas.
Esto es el registro de esas cinco veces, porque el valor no está en la causa final —que es aburrida— sino en
entender **por qué cada diagnóstico equivocado parecía el bueno**.

## En una línea

El alojamiento no deja conectar por TCP entre nuestros propios procesos. Escuchar sí; conectarse no. El
enrutador tenía a sus cuatro hijos vivos y escuchando en `127.0.0.1` y no podía hablar con ninguno, así que todo
lo que pasaba por dentro devolvía *«Todavía está arrancando»*.

La causa estaba en una suposición de una línea, escrita meses antes, cuando era obviamente cierta:

```js
http.request({ host: '127.0.0.1', port: puerto, ... })
```

## Los cinco desvíos

### 1. «Hostinger recicla el proceso»

**Qué se vio:** el estado de WhatsApp se perdía entre peticiones.
**Qué se concluyó:** que la plataforma mata el proceso cuando nadie la usa.
**Por qué era falso:** se midió. Una sesión en memoria aguantó 10 de 10 llamadas en 3 minutos.
**Lección:** esto se descartó rápido porque se midió rápido. Fue el único desvío barato del día.

### 2. «Hostinger bloquea WhatsApp»

**Qué se vio:** al vincular, WhatsApp cerraba con 428 en bucle y el código QR no llegaba a salir.
**Qué se concluyó:** que la plataforma corta las conexiones salientes permanentes.
**Por qué era falso:** era `syncFullHistory: true`, puesto por nosotros. Pedir todo el historial al vincular
tumba la vinculación.
**Lo que lo alargó:** la conclusión sonaba razonable y era cómoda — si la culpa es del alojamiento, no hay nada
que arreglar en el código. **Un diagnóstico que te exime de trabajo merece el doble de desconfianza.** Lo cortó
él, no yo: *«por lo que mato tu deducción»*.

### 3. «Es la memoria: Baileys ocupa 77 MB por proceso»

**Qué se vio:** los cuatro procesos sin levantar, todo devolviendo 503.
**Qué se concluyó:** que no cabían en la memoria del plan.
**Por qué era falso a medias:** los 77 MB eran reales y medidos, y cargar WhatsApp solo al encenderlo fue una
mejora de verdad. Pero no era la causa de ese 503.
**La trampa:** *encontrar un problema real no significa haber encontrado **el** problema.* Arreglarlo da la
sensación de avanzar y consume el día.

### 4. «Son los tres segundos para escuchar»

**Qué se vio:** el sitio en bucle de reinicios.
**Qué se concluyó:** que el arranque tardaba más de lo que la plataforma tolera.
**Por qué era cierto… y aun así no bastaba:** era verdad, estaba documentado en el log del panel desde el
principio y se arregló. El sitio siguió caído.
**Lo que lo alargó:** llegar por eliminación a lo que el log decía en su primera línea. **Pedir el log del panel
antes de ponerse a descartar** habría ahorrado media mañana. Es lo único que no se ve desde fuera.

### 5. «Hay dos lanzadores peleándose»

**Qué se vio:** `440: Stream Errored (conflict)` cada tres segundos, durante horas.
**Qué se concluyó:** que la plataforma arrancaba la aplicación dos veces y cada copia abría el mismo WhatsApp.
**Por qué era cierto:** lo era. Dos arranques con 1,4 segundos de diferencia, ocho procesos donde iban cuatro.
Se arregló con un cerrojo.
**Y aun así el sitio seguía dando 503**, porque esto tampoco era la causa: era **una consecuencia**. Un lanzador
que no alcanza a sus hijos no puede limpiar a los de la versión anterior, y los huérfanos se acumulan.

## Lo que hizo que durara tanto

Tres cosas, y ninguna es «no se me ocurrió la respuesta».

**El diagnóstico mentía.** `/_salud` decía **«Todo arriba»** mientras el sitio entero devolvía 503. No estaba
roto: miraba si los procesos vivían, que es lo que yo le pedí que mirara. Pero un proceso vivo al que nadie
puede hablarle no está arriba para nadie. **Un diagnóstico que no mira lo mismo que el usuario es peor que no
tener diagnóstico**, porque cierra la línea de investigación correcta.

**Los apaños escondían la causa.** Cuando los puertos estaban ocupados, el lanzador se corría a otro tramo y el
sitio volvía. Parecía robustez. Era lo contrario: dejaba vivos los procesos viejos —con la sesión de WhatsApp
del cliente abierta— y levantaba una segunda copia encima. **«Hace que vuelva» no es lo mismo que «está
arreglado».**

**Cada teoría era parcialmente cierta.** Los 77 MB, los tres segundos, los dos lanzadores: los tres reales, los
tres arreglados, ninguno era la causa. Es el peor escenario posible, porque cada arreglo produce la sensación de
avanzar y nada refuta la dirección equivocada.

## Lo que lo resolvió

Un dato, y llegó en cuanto se preguntó a quien sabía. En vez de creerle a los procesos —que decían «escuchando
en 4100»— o al padre —que decía «ECONNREFUSED»—, se le preguntó **al sistema**, leyendo `/proc/net/tcp`:

```
escuchando:  4100 → 127.0.0.1   4101 → 127.0.0.1   4102 → 127.0.0.1   4103 → 127.0.0.1
por:         confia=socket  dunor=socket  atlas=socket  consola=socket
```

Los cuatro escuchando donde debían. Los cuatro alcanzables solo por socket de archivo. Con eso se acabó la
discusión: **ahí el TCP entre nuestros procesos no pasa**, y no hace falta saber por qué para dejar de depender
de él.

## Para la próxima

**Por orden, y sin saltarse pasos:**

1. **Distinguir «el enrutador vive» de «el sitio vive».** Un `curl` a la portada y otro a una ruta de dentro. Si
   la portada da 200 y `/cliente/` da 503, el problema está **entre** nuestros procesos, y eso descarta de golpe
   memoria, arranque, código del cliente y la mitad de las teorías.
2. **Pedir el log del panel.** Es lo único que no se ve desde fuera. Dos minutos contra media mañana.
3. **Cuando dos fuentes se contradicen, preguntarle a una tercera que no sea parte.** Un proceso que dice que
   escucha y un padre que dice que no llega: el sistema tiene la respuesta (`/proc/net/tcp`, `ps`), y no opina.
4. **Medir antes de deducir.** Cada vez que se dedujo, se perdió tiempo; cada vez que se midió, se avanzó. Los
   simulacros —inutilizar la red entre procesos a propósito— encontraron dos fallos reales que ninguna lectura
   del código habría encontrado, entre ellos uno precioso: la puerta de emergencia se abría **dentro** del
   callback del puerto, o sea que solo existía cuando el puerto funcionaba.
5. **Escribir lo que se descarta.** `hostinger-reglas` tiene una sección «lo que NO es cierto, aunque lo
   parezca». Vale tanto como la de reglas: evita volver a pagar por el mismo callejón.
6. **Sospechar de lo viejo, no solo de lo nuevo.** El reflejo —«empezó tras un deploy, el sospechoso soy yo»— es
   bueno y hay que conservarlo. Pero aquí lo que falló llevaba meses escrito y funcionando: lo que cambió fue el
   suelo, no el código. Cuando ningún cambio reciente explica el síntoma, toca revisar las suposiciones que
   nadie ha vuelto a mirar porque «eso siempre ha funcionado».
7. **Que el diagnóstico responda la pregunta del usuario.** No «¿viven los procesos?» sino «¿se les puede
   hablar?». Por eso `/_salud` ahora dice `por` (por dónde se llega a cada uno) y `escuchando` (qué ve el
   sistema), y no solo `vivo`.

## Lo que quedó construido

Nada de esto existía por la mañana, y todo salió de un desvío:

| De dónde salió | Qué quedó |
| --- | --- |
| El bucle de WhatsApp | Un cerrojo: un solo lanzador levanta clientes; los demás solo reparten |
| Los huérfanos | Ningún proceso sobrevive a su lanzador: vigila su `ppid` y se va solo |
| El 428 | WhatsApp no reintenta en bucle: espera cada vez más y para si hay conflicto |
| El «5 de 5 no contestaron» | El sondeo dice el motivo, puerto por puerto |
| El 503 | Tres puertas hacia cada proceso —IPv4, IPv6 y socket de archivo— y se recuerda cuál abrió |
| Todo | `pnpm test:lanzador`: 17 comprobaciones, incluidas dos que matan procesos de verdad |

Y una regla de oficio que vale más que el código: **cada frase que falló se convirtió en una regla y en una
prueba.** Las pruebas de `eval/lanzador.ts` no describen cómo funciona el lanzador; describen cómo se rompió.

Ver también `desplegar.md` (el detalle técnico de cada arreglo) y la memoria `hostinger-reglas`.
