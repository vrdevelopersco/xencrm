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

## Lo que todavía no hay

- **Avisos por correo o push del navegador.** Hoy el aviso externo es solo por WhatsApp. El push real necesita
  un *service worker* y claves VAPID, y en iPhone exige que la web se instale en la pantalla de inicio.
- **Horarios propios de atención.** El horario se toma del de citas. Un negocio que atienda por WhatsApp en un
  horario distinto del de su agenda necesitaría el suyo.
- **Festivos.** Un lunes festivo cuenta como día hábil.
- **Devolver las conversiones a Google y a Meta.** El identificador del clic ya se guarda; falta mandarlo.
