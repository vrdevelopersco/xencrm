# Cuánto se tarda, quién contesta y qué trae clientes

Tres preguntas que un negocio hace en cuanto el CRM lleva unas semanas funcionando:

1. ¿Estamos contestando a tiempo?
2. ¿Quién contesta, y cuánto tarda cada quien?
3. ¿De dónde sale la gente que termina comprando?

Las tres se responden con lo que ya está guardado. No hay tabla que mantener ni proceso de noche: cada mensaje
sabe quién lo escribió y cuándo, y cada conversación sabe por dónde llegó. Se puede mirar hacia atrás desde el
primer día de cada cliente.

## Los tiempos de respuesta

`src/crm/tiempos.ts` · pruebas: `pnpm test:tiempos` · en el tablero: **Análisis**

La unidad no es el mensaje, es la **espera**: desde que alguien escribe y se queda sin respuesta hasta que
alguien le contesta. De cada una se sabe cuánto tardó, quién contestó —Aiva o una persona, con su nombre— y
cuántas veces insistió mientras esperaba.

Tres decisiones que cambian lo que dicen los números:

- **Varios mensajes seguidos son UNA espera.** Quien escribe «hola», «están?», «???» y recibe respuesta a los
  quince minutos esperó quince minutos una vez. Contarlo como tres esperas cortas maquillaría el número justo
  cuando el cliente está más molesto.
- 🪤 **El reloj se para fuera del horario.** Un mensaje del sábado a las diez de la noche contestado el lunes al
  abrir no son 34 horas de mala atención: son diez minutos. Sin esto, cualquier acuerdo sale incumplido todos
  los lunes y el número deja de mirarse. El horario sale de la configuración de cada cliente.
- **Lo que el negocio manda sin que nadie pregunte no cuenta.** Un recordatorio contaría como respuesta
  instantánea y bajaría la media sin que nadie haya atendido a nadie.

El compromiso (`sla.minutos`) se guarda **por cliente** y se cambia en caliente desde el tablero, sin reiniciar.
No hay un valor universal: una boutique y una financiera no prometen lo mismo.

En la pantalla, el tiempo **corrido** manda para quien está esperando ahora —es el que siente esa persona— y el
tiempo **hábil** manda en las medias y en el cumplimiento, que es donde tiene sentido descontar la noche.

### Dónde se ve

- **Tablero del cliente**, en Análisis: mediana, p90, cumplimiento, Aiva contra personas, quién contesta más
  rápido, y quién está esperando ahora mismo (cada nombre abre su conversación).
- **Consola**, en tres sitios: la cifra de arriba suma las personas esperando en todos los clientes; la fila de
  cada cliente marca en rojo «N min esperando de más»; y sale como aviso urgente, por encima de todo lo demás,
  porque es lo único de esa pantalla que se arregla ahora mismo.

## El aviso cuando nadie está mirando

`src/crm/vigilante.ts` · pruebas: `pnpm test:vigilante` · en el tablero: **Canales › Avisarme cuando nadie contesta**

Todo lo anterior necesita que alguien tenga la pestaña abierta. Si el equipo cierra el portátil a las seis, lo
que entre después se queda ahí — y con el asistente en «solo escuchar», que es como se enchufa el WhatsApp de un
negocio de verdad, eso significa que nadie contesta.

Así que cada minuto se mira quién lleva esperando más de lo prometido y se sale a buscar a una persona por donde
sí se la encuentra: **su propio WhatsApp**. No hace falta infraestructura nueva; se usa el canal que el cliente
ya tiene conectado.

Tres cosas lo hacen soportable, porque un vigilante que molesta se apaga y entonces no sirve de nada:

- **Apagado hasta que alguien diga a quién avisar.** Sin números configurados no manda nada.
- 🪤 **Un aviso por espera, no uno por minuto.** Se anota a quién se avisó y no se repite hasta que esa
  conversación se responda. Sin esto, una conversación olvidada un domingo manda cientos de mensajes.
- **Tope de doce avisos por hora.** Si de repente hay veinte personas esperando, algo va mal en otro sitio:
  mejor callarse que inundar a nadie.

Hay un botón para mandar uno de prueba: conviene comprobar que llega **antes** de confiar en esto.

## De dónde llega la gente

`src/crm/origen.ts` · pruebas: `pnpm test:origen` · en el tablero: **Análisis › Qué trae clientes**

Una fila por conversación con de dónde salió, y una tabla que cruza eso con en qué terminó: conversaciones,
citas, ganadas y conversión por campaña.

| Por dónde entra | Qué se captura | Cómo |
|---|---|---|
| Chat del sitio | Campaña (`utm_…`), página y quién lo mandó | El widget lo manda con el primer mensaje |
| WhatsApp por anuncio | El anuncio, su titular y la página | Viene en el aviso de Meta, sin pedir nada |
| WhatsApp por código QR | Nada | Quien escribe al número directo no trae origen |

Ese último caso importa: la tabla dice siempre **cuántas conversaciones llegaron sin origen conocido**. Sin ese
renglón, lo demás se lee como si fuera el total y las campañas parecen el doble de buenas.

🪤 **Se guarda el primero y no se pisa.** Si alguien llegó por un anuncio en marzo y vuelve en junio por una
búsqueda, la conversación sigue siendo del anuncio: fue el que la trajo. Sobrescribir con lo último haría que
toda la atribución terminara en «directo», que es donde acaba la gente que ya te conoce.

🪤 **El identificador del clic no es la campaña.** El `ctwa_clid` de Meta y el `gclid` de Google parecen
identificar la campaña y son **distintos para cada persona**: agrupar por ellos convierte a cada cliente en su
propia fila y la tabla deja de servir para decidir nada. Se agrupa por campaña y por anuncio; el identificador
del clic se guarda aparte, que es lo que hará falta el día que se quiera devolver la venta a Google o a Meta
para que optimicen.

En cada ficha se ve por dónde llegó esa persona, con el titular del anuncio que leyó. Al atender cambia la
conversación: no es lo mismo alguien que buscaba trajes de grado que alguien que vino de un anuncio de bodas.

## Traer más historial sin desvincular

`src/channels/whatsapp.ts` · `src/crm/wa-cursor.ts` · en el tablero: **Canales › Traer más historial**

Al vincular, WhatsApp manda lo reciente de cada conversación y nada más. Durante un tiempo, la única forma de
traer lo de antes era desvincular y volver a escanear — justo lo que nadie quiere hacer con el número de un
negocio en marcha.

Se puede pedir más apuntando al mensaje más antiguo que ya se tiene, así que se va guardando cuál es (tabla
`wa_cursor`). 🪤 Ese cursor **solo retrocede**: si avanzara con cada mensaje nuevo acabaría apuntando al último,
y pedir «más historial» traería una y otra vez lo que ya está.

🪤 Lo pedido **no llega en la respuesta**: llega después, por el mismo camino que el historial del
emparejamiento, y puede tardar minutos. Por eso el botón dice cuántas conversaciones se pidieron, no cuántos
mensajes llegaron.

## Con quién cree el cliente que está hablando

`src/crm/outbox.ts` (`conFirma`)

Por WhatsApp el cliente ve siempre el mismo número, y por ese número contestan dos: el asistente y las personas
del equipo. Así que todo lo que sale va firmado con **el papel**, no con la persona:

- El asistente firma con su nombre, el que el negocio le puso (`agent.name`): `*Aiva:* …`
- Una persona firma como el equipo (`crm.firmaHumano`, por defecto «Operador»): `*Operador:* …`
- En el chat del sitio **no se firma**: ahí ya se ve en pantalla quién habla.

🪤 Antes iba el **nombre de quien escribía desde el tablero**, así que al cliente le llegaba «*Arthur:*» — un
nombre que para él no significa nada y que de paso expone a quien atiende. El nombre de la persona sigue
guardándose, pero solo para adentro: en el tablero se ve quién contestó cada mensaje.

## Los tres nombres

Esto es lo que más confunde de aiva, y conviene decirlo entero: **hay tres nombres distintos** y cada uno se
cambia en un sitio.

| Cuál | Qué es | Dónde se cambia | Quién lo ve |
|---|---|---|---|
| **El asistente** (p. ej. «Aiva») | Cómo se llama el asistente de ese negocio | *El negocio* | El cliente final, firmando lo que contesta el asistente |
| **Tu nombre** | El de tu cuenta, el mismo en toda la consola | Tu perfil | El equipo, en la consola y como punto de partida en cada tablero |
| **Cómo firmas aquí** | Con qué nombre atiendes en **ese** cliente | La ficha de perfil del tablero de ese cliente | El equipo, en cada mensaje que contestes ahí |

Y dos reglas, en este orden:

1. **Lo que se haya puesto para un cliente manda.** Puedes firmar «Camila» en la boutique y «Soporte» en la
   financiera: son negocios distintos y no se contagian.
2. **Tu nombre de cuenta es el punto de partida**, el que se usa mientras ese cliente no tenga uno propio.

Al cambiarlo desde un tablero se pregunta **dónde vale**: solo en ese cliente o en todos. No se decide por ti.

🪤 **Lo que el cliente final ve no es ninguno de estos tres.** Por WhatsApp va el papel —el asistente con su
nombre, una persona como «Operador»—, nunca el nombre de quien atiende (ver *Con quién cree el cliente que está
hablando*). El nombre de la persona es para adentro: para que el equipo sepa quién contestó.

### Por qué está escrito con tanto detalle

Este modelo costó cuatro entregas. Los dos errores, para que nadie los repita:

- 🪤 **El tablero rellenaba el nombre de quien atiende con el del ASISTENTE** cuando estaba vacío, y lo dejaba
  guardado. Como casi todos los clientes llaman igual al suyo, el operador acababa llamándose «Aiva» en todos y
  parecía que los perfiles se cruzaban entre clientes. No se cruzaba nada: se inventaba el nombre equivocado, y
  al quedar guardado volvía a aparecer aunque se quitara el apaño.
- 🪤 **El arreglo siguiente se pasó al otro extremo**: unificarlo en la cuenta hizo que el nombre del
  super-admin pisara el de todos los clientes a la vez. En un CRM multicliente eso no es un detalle de
  interfaz — es el aislamiento entre negocios roto.

Hay dos pruebas en `pnpm test:seguridad` que leen el propio tablero y fallan si alguien vuelve a meter
cualquiera de los dos.

## El segundo clic sobre una conversación

`public/admin.js` (menú contextual) · `GET /admin/api/contacts/:id/vistazo`

Lo que se quiere hacer sobre una conversación sin entrar en ella:

- **Ver sin abrir**: los últimos mensajes en una ventana. 🪤 No la marca como leída — mirar para decidir si urge
  no es atender, y si el vistazo borrara el «sin leer», la lista dejaría de decir la verdad.
- **Entregar a**: pasársela a alguien por su nombre. La lista sale de quién atiende a ese cliente, que la consola
  le dice al tablero al servir la página (el tablero habla con un token, no con cuentas, así que por su cuenta no
  puede saberlo). Sin nadie más asignado, la opción se ve **en gris**: así se entiende que existe y por qué no se
  puede usar.
- **Que siga el asistente**: devuelve la conversación al bot.

### Dónde vive cada uno

Tu nombre de cuenta vive en el servidor, en tu perfil: por eso te sigue en cualquier equipo y no se pierde al
cambiar de navegador. La consola se lo dice al tablero al servirle la página —el tablero habla con un token, no
con cuentas, así que por su cuenta no puede saberlo—.

Lo que firmas en un cliente concreto vive en el navegador, separado por cliente. Quien entra directo al tablero
con el token, sin pasar por la consola, solo tiene esto: ahí no hay cuenta de la que partir.

## El sonido del aviso

`public/admin.js` (`beep`)

Un acorde mayor de cuatro notas entrando escalonadas por milésimas, con un filtro que le quita el filo y una
caída de casi un segundo. Suena una vez, cae solo y no deja a nadie en tensión.

Está **sintetizado, no es un archivo**: no pesa nada, no hay nada que descargar y no mete en el producto un
sonido que es de otro. Al encender el aviso suena una vez, para saber qué se acaba de activar sin esperar a que
entre un mensaje.

Antes era un tono plano de 880 Hz, y para algo que suena veinte veces al día eso importa: parecía un monitor de
hospital.

## Lo que todavía no hay

- **Avisos por correo o push del navegador.** Hoy el aviso externo es solo por WhatsApp. El push real necesita
  un *service worker* y claves VAPID, y en iPhone exige que la web se instale en la pantalla de inicio.
- **Horarios propios de atención.** El horario se toma del de citas. Un negocio que atienda por WhatsApp en un
  horario distinto del de su agenda necesitaría el suyo.
- **Festivos.** Un lunes festivo cuenta como día hábil.
- **Traer más historial en el conector.** El botón funciona con la sesión en la propia máquina; el conector de
  `src/conector.ts` todavía no lo expone.
- **Devolver las conversiones a Google y a Meta.** El identificador del clic ya se guarda; falta mandarlo.
- **Enseñar los tres nombres juntos.** Hoy se editan en tres sitios distintos y nada en pantalla dice cuál es
  cuál; al cambiar el de un cliente se pregunta con un diálogo del navegador. Debería ser una sola ficha que los
  muestre los tres y dos botones explícitos: «guardar solo aquí» y «guardar en todos mis clientes».
