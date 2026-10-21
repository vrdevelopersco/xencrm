# Demo en vivo

Guion para mostrar aiva funcionando, con el cliente al lado: el celular hace de cliente y el computador muestra el
tablero moviéndose solo. Dura entre 8 y 10 minutos. Probado de punta a punta el 22 de septiembre de 2026.

La idea que tiene que quedar: **no es un chatbot que responde, es un CRM que trabaja solo** — atiende, entiende,
agenda, puntúa y le deja al equipo solo lo que necesita una persona.

## Antes de empezar (10 minutos)

1. **El servidor**: `pnpm dev` en el Mac. Debe decir `[web] escuchando`.
2. **La dirección pública** (el túnel), si no está arriba:
   ```
   cloudflared tunnel --url http://localhost:3000     # imprime la URL
   PUBLIC_URL=<la URL> pnpm dev                       # reinicia aiva con esa dirección
   ```
   Verifica en **Canales › Dirección pública › Revisar ahora**: tiene que decir que responde.
3. **Los canales**:
   - *Chat del sitio*: encendido. Copia de la tarjeta la **Página de prueba** y ábrela en el celular.
   - *WhatsApp (código QR)*: enciéndelo en Canales y **escanea el código** con el WhatsApp del negocio
     (Dispositivos vinculados). La tarjeta queda en "Conectado".
4. **El tablero** en el computador, en **Hoy**, con el sonido de la campana activado (menú *Más* en el celular, al
   pie en el computador).
5. **El celular** con dos cosas abiertas: la página del chat y WhatsApp.

## El guion

Cada paso es: escribes desde el celular y muestras lo que pasa en el tablero.

**1. Llega un cliente.** Desde el chat del sitio: *"hola, buenas tardes"*.
→ Suena la campana, la conversación aparece sola en Conversaciones y en Hoy. Sin recargar nada.

**2. Pregunta por lo que vende el negocio.** *"necesito un traje para el matrimonio de mi hermano"*.
→ Responde con lo que DUNOR ofrece, sin inventar. Muestra en la ficha (derecha) cómo ya capturó **prenda** y
**ocasión** sin preguntarlas.

**3. Pregunta algo que el negocio no le ha dicho.** *"¿tienen parqueadero ahí?"*.
→ Responde *"Deja te verifico eso con el equipo y te confirmo por aquí"*. **Este es el momento importante**: el
asistente no se lo inventó. En el tablero, Hoy › **Por verificar**, escribes la respuesta, dejas marcado *Agregar a
la información* y das **Enviar respuesta**: le llega al cliente en su mismo chat. Vuelve a preguntar lo mismo desde
el celular y ahora responde solo. *"Lo que el equipo le enseña una vez, ya lo sabe."*

**4. Agenda una cita.** *"¿puedo ir el jueves a probármelo?"* → ofrece tres horarios **de la agenda real** →
*"la 2"* → te pide el número → lo das → *"sí, confírmala"*.
→ Muestra: **Calendario** con la cita, la ficha con el puntaje ("Prospecto con cita"), **Por qué** con los factores,
y la **Línea de tiempo**. Menciona que la mañana de la cita sale el recordatorio solo.

**5. El mismo cliente, por WhatsApp.** Desde el WhatsApp del celular (el número que acabas de dar):
*"hola, ¿me confirmas la cita del jueves?"*.
→ El asistente **sabe que ya tiene cita** y se lo confirma, aunque haya escrito por otro canal.
→ En el tablero, esa ficha nueva muestra arriba **"¿Es la misma persona?"**. Das **Unir fichas** y queda una sola,
con las dos conversaciones, la cita y el análisis juntos.

**6. El tablero como producto.** Cierra mostrando, rápido:
- **Hoy**: lo que hay que atender hoy, ordenado por lo que cuesta dejarlo esperando.
- **Clientes › Por etapa**: el embudo; mueve una tarjeta de etapa arrastrándola o con *Mover…*.
- **Análisis**: los números y **Contactos (CSV)**, para que vean que los datos son suyos y se los pueden llevar.
- **Ayuda**: el tutorial que le queda al equipo.

## Si el Perfil está sin llenar

Mientras el Perfil no tenga dirección, horarios, precios ni formas de pago, **toda** pregunta sobre eso sale como
"deja te verifico". Una vez es una función; tres veces seguidas se ve vacío. Dos salidas:

- Llenar el Perfil antes (15 minutos de escribir) y el asistente responde al instante.
- O dejarlo así y decirlo de frente: *"todavía no le hemos cargado la información del negocio; lo que no sabe, no
  se lo inventa: se lo pregunta al equipo. Ese es el punto."* Y ahí mismo lo llenas en **Perfil** y se lo muestras
  funcionando.

## Lo que no hay que prometer

- **WhatsApp por código QR no es la vía oficial de Meta**: sirve para mostrar, pero puede bloquear el número. Para
  el cliente de verdad van las credenciales de Meta (Canales › WhatsApp oficial › Credenciales).
- **La dirección pública es un túnel temporal**: si se cae, el chat del sitio y WhatsApp dejan de entrar. aiva
  avisa en la campana y en Hoy. Para producción: túnel fijo con dominio propio.
- **Instagram y Messenger** todavía no están.
- El **puntaje** es un estimado calibrado con las primeras conversaciones; se afina con los resultados reales de
  las citas (Hoy › ¿Cómo les fue?).

## Después del demo

- Archiva o borra la conversación de prueba desde su ficha (Archivar la saca de las listas y de los números).
- Si usaste un número personal en WhatsApp, apaga el canal en Canales.
- Si el cliente quiere quedarse con algo: Análisis › **Contactos (CSV)** y **Citas (CSV)**.
