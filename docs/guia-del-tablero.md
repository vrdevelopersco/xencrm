# Guía del tablero

Para quien atiende a los clientes del negocio: qué hay en cada pantalla y qué hacer con cada cosa. No hace falta
saber nada técnico. Los ejemplos son de XENTRIS LLC (el ejemplo de XENCRM: una firma de software), pero el tablero
es igual para cualquier negocio.

Lo esencial está dentro del mismo tablero, en **Ayuda**: un tutorial rápido de seis pasos (cada uno lleva a su
pantalla), preguntas frecuentes y lo que el asistente nunca hace. La primera vez que alguien entra, Hoy le muestra
un aviso que lleva al tutorial. Esta guía es la referencia completa, para entrenar al equipo.

## Cómo entrar

**Si eres del equipo de XENCRM**, entra por la consola y abre el tablero del cliente desde su fila: no te va a pedir
nada, porque ya entraste allá.

**Si eres el negocio**, abre la dirección del tablero (termina en `/admin`) desde el computador o el celular y
escribe el token que te dieron. En el computador las secciones van en la barra lateral; en el celular, abajo.

El menú está ordenado como una suite de CRM (como Dynamics 365), en **áreas**. Abajo del menú, el botón **Área**
cambia entre ellas:

| Área | Grupo | Pantallas |
|---|---|---|
| **Ventas** | Mi trabajo | **Inicio** · **Bandeja omnicanal** · **Lista de trabajo** · **Citas** (o como las llame tu negocio: en XENTRIS, *Demos*) |
| | Clientes | **Contactos** · **Cuentas clave** |
| | Ventas | **Embudo** · **Tratos** · **Ventas** |
| | Rendimiento | **KPIs y metas** · **Optimización de ventas** · **Analítica** |
| **Servicio** | Mi trabajo · Clientes · Servicio | Bandeja omnicanal · **Tickets** · Contactos · Cuentas clave · **SLA** · **Mantenimientos y actualizaciones** |
| **Configuración** | El negocio · El asistente y la IA · Canales · Servicio · Sistema | Guía de inicio, Perfil, El negocio, El asistente, Modelos de IA, Lo que sabe, Canales, SLA y tickets, Mantenimientos y actualizaciones, Reglas y umbrales, Trazabilidad y Ayuda (lo que puede ver cada quien) |

Arriba del menú van **Recientes** (lo último que abriste) y **Fijados**. El **≡** de arriba lo contrae a íconos. Al
pie, **Ajustes** (tu nombre, el tema claro u oscuro, el sonido, el modo fácil) y tu cuenta, con **Salir**. En el
celular, el menú se abre desde la barra de arriba.

Si venías de antes, los nombres cambiaron: *Hoy* es **Inicio**; *Conversaciones*, **Bandeja omnicanal**; *Clientes ›
Lista*, **Contactos**; *Por etapa*, **Tratos**; *Seguimientos*, **Lista de trabajo**; *Análisis*, **Analítica**; y tomar
una conversación es **Pausar automatización**.

**Perfil** y **El negocio** no son pantallas: abren un **modal con dos pestañas** encima de lo que estés haciendo,
y al cerrarlo vuelves donde estabas.

## La idea

El asistente (Xen, o el nombre que tenga tu negocio) responde solo, a cualquier hora. Tú entras cuando hace
falta una persona:

- el asistente no sabía algo;
- el cliente pidió hablar con alguien;
- hay que recordar una cita a mano;
- quieres tomar tú la conversación.

Todo se actualiza en vivo: no hace falta recargar. La campana avisa lo importante (conversación nueva, alguien pidió
una persona, un prospecto se puso caliente, una cita agendada, movida o cancelada, alguien que no puede ir, una
pregunta que el asistente no supo responder, un cliente que apareció por otro canal, o un mensaje que el asistente
no pudo responder por una falla).

## Guía de inicio

Lo que falta para que el asistente atienda solo, en una lista que **se marca sola**: un paso queda listo cuando de
verdad lo está, no cuando alguien le da clic. Está en **Configuración › Guía de inicio** (solo para quien
administra), y mientras falte algo obligatorio, Hoy lo dice en una línea arriba («Deja listo a Xen: 3 de 6 ·
Siguiente: …») con el botón que lleva a arreglarlo. **Ocultar por ahora** la quita una semana.

Los pasos, y cuándo quedan listos:

- **Llena el perfil del negocio**: cuando tiene dirección, horarios y formas de pago, que es lo que más preguntan.
- **Cuéntale lo que ofreces**: cuando Lo que sabe tiene catálogo o información. Un negocio que no vende con precio
  de lista (una financiera, un servicio) lo completa con su información.
- **Conecta por dónde te escriben**: cuando WhatsApp (por código o el oficial) está recibiendo, o el chat del sitio
  está encendido y su dirección pública responde.
- **Haz una prueba**: cuando ya escribió alguien de verdad (la demostración y los grupos no cuentan).
- **Pon tu horario de citas**, si el negocio agenda: cuando alguien escribió los días y las franjas. El horario de
  ejemplo no cuenta.
- **Pon con qué nombre respondes**: es tuyo, no del negocio, y en WhatsApp va antes de cada mensaje tuyo.
- **Ponle precio a tu catálogo** (opcional, si hay productos): sin precios no se sabe cuánto vale cada prospecto.
- **Conecta tu calendario** (opcional, si agenda): para que el asistente no ofrezca horas en que estás ocupado.

Lo que falta dice por qué, con el motivo exacto («Faltan los horarios y las formas de pago», «la dirección pública
no responde»). Cuando lo obligatorio está hecho, dice **Todo listo** y Hoy deja de mostrarlo. La guía se vuelve a
revisar al abrirla, al volver a la pestaña y al cerrar el perfil o El negocio. El **tutorial** de Ayuda sigue ahí:
el tutorial explica el tablero; la guía deja listo el negocio.

## Inicio

Lo que hay que atender, ordenado por lo que cuesta dejarlo esperando. Cada fila abre la conversación.

- **Por verificar**: preguntas que el asistente no pudo responder con lo que sabe. Al cliente ya le dijo «Deja te
  verifico eso con el equipo y te confirmo por aquí». Escribe la respuesta y dale **Enviar respuesta**: le llega al
  cliente por el mismo chat, sin quitarle la conversación al asistente. Si dejas marcado «Agregar a la
  información», el asistente lo aprende y la próxima vez responde solo. Si no aplica, **Descartar**.
- **Esperan tu respuesta**: el cliente dijo lo último y nadie le ha contestado.
- **Pidieron una persona**: el asistente se calló y le avisó al cliente que alguien del equipo le escribe.
- **¿Cómo les fue?**: citas que ya pasaron y siguen sin resultado. Toca **Vino**, **No vino** o **Compró** (esta
  última además pasa al cliente a Vendido). Con esos resultados, más adelante se ajusta el puntaje de los
  prospectos a lo que de verdad pasa en el negocio.
- **Recordar a mano**: citas de mañana cuyo recordatorio no pudo salir solo. Muestra el porqué (llegó por el chat del
  sitio, la conversación la lleva una persona, WhatsApp no está conectado…) y el texto listo. **Abrir WhatsApp** abre
  el chat con el mensaje escrito; después dale **Ya se lo recordé**.
- **Citas de hoy** y **Próximas citas**: cada una dice cómo va su recordatorio: *Se recuerda hoy a las 5:00 p. m.*,
  *Recordada*, *Confirmó* (dijo que viene) o *No puede* (dijo que no puede; el asistente ya le ofreció moverla o
  cancelarla).
- **Calientes sin seguimiento**: buenos prospectos que llevan más de un día sin hablar, no tienen cita y no están
  esperando el resultado de una que ya pasó (esos están arriba, en *¿Cómo les fue?*). Aquí entran por lo que
  llegaron a ser en la conversación, aunque ya se hayan enfriado: son justo los que hay que retomar. Cada uno
  trae dos botones: **Escribirle** abre su conversación, te la pasa a ti y deja un borrador listo con lo que él
  mismo dijo ("lo de la app de pedidos"), para que lo ajustes y lo envíes; **Dejarlo por ahora** lo saca de la
  lista una semana (si escribe antes, vuelve enseguida). Así la lista se puede vaciar y se puede confiar en ella.
- **Sin leer, el asistente ya respondió**: para darles una mirada.

Si una conversación llegó por **WhatsApp oficial** y pasaron más de 24 horas desde el último mensaje del cliente,
WhatsApp no deja escribirle. El tablero lo advierte antes de que escribas. Toca esperar a que el cliente vuelva a
escribir o usar una plantilla aprobada por Meta.

## Bandeja omnicanal

Todos los canales (WhatsApp, el chat del sitio) en un solo sitio. A la izquierda la lista: cada conversación con su
avatar y la insignia de su canal, la hora (en verde si hay algo sin leer) y lo que dijo. Encima, **Mías · Sin asignar
· Todas** y el desplegable **Todos los estados** (*Sin leer*, *Prospectos* y, en el modo completo, *Con una
persona*, *Interesados*, *Con cita* y *Archivados*). El ✓✓ es **Marcar todo como leído**, para el día que se atendió
todo desde el teléfono. En el centro, el chat. A la derecha, **la ficha del contacto**: quién es, cómo contactarlo,
a quién está asignado, su etapa, el próximo paso, «Lo que busca» (en violeta: lo resumió la IA), lo que contó y su
historia, para atenderlo sin leerse la conversación entera. Desde ahí, **Crear ticket** si es un cliente con un
problema. En el celular se abre con el
botón **Ficha** de arriba del chat, y **‹ Volver a la conversación** te devuelve.

**¿Por qué contestó eso?** Si administras, debajo de cada respuesta del asistente hay un **¿por qué?**. Dice qué
entendió, por dónde lo mandó, qué modelo contestó y en cuánto tiempo, qué guardas saltaron (una cifra sin respaldo,
una promesa de descuento que no salió), cuánto costó y con qué versión. Es lo primero que hay que mirar cuando una
respuesta te parece rara.

**Buscar.** El buscador de arriba mira el nombre, el teléfono, el resumen y **lo que se dijo en la conversación**:
escribe "facturación electrónica" y salen las conversaciones donde aparece, cada una con el pedacito donde se dijo y quién lo
dijo.

**Quién responde.** Arriba del chat, **Pausar automatización** detiene al asistente en esta conversación y la
tomas tú (queda «Automatización pausada · la lleva Laura»); **Reanudar automatización** se la devuelve. Escribir a
mano también la pausa. Al lado, **Asignado a** dice de quién es el cliente (no es lo mismo que quién contesta ahora).

**Nota interna.** El cajón de escribir tiene dos pestañas: **Enviar mensaje** (le llega al cliente) y **Nota
interna** (se vuelve arena y dice «Solo la ve el equipo»: queda en la historia de la ficha y el cliente no la ve). En WhatsApp el
cliente ve tu nombre antes de tu mensaje, porque siempre le escribe el mismo número.

**Cuando la llevas tú, Xen acompaña.** Si el cliente pregunta algo que Xen sabe —un precio, el horario, si hacen
envíos—, deja la respuesta escrita encima del cajón con el título *Xen puede contestar esto*. **Enviar** la manda
tal cual (y la conversación sigue siendo tuya), **Corregir** la pasa al cajón para que la ajustes, y **Descartar** la
quita. Nunca escribe sola, no suena y no abre nada en *Por verificar*: lo que no sabe, simplemente no lo propone, y
tampoco se mete en saludos, citas ni en quien pide una persona. Si contestas con tus palabras, la propuesta se
aparta. Se apaga en **Configuración › El asistente › Cuando la llevas tú**: cada pregunta que redacta es una llamada al modelo.

**El perfil**, de arriba abajo:

- **Quién es y qué quiere**: el nombre, por dónde escribió y, en una frase, lo que busca. Si tiene **nota fija**
  (lo que siempre hay que saber de esa persona), va justo debajo.
- **Escribirle por WhatsApp** y **Llamar**, si dejó teléfono.
- **Detalles**: la **etapa**, que se cambia ahí mismo; **¿Prospecto?**, el veredicto con su puntaje (*Sin señales
  aún*, *Posible prospecto*, *Prospecto claro*, *Prospecto con cita*, *Cliente*, *Perdido*); el **próximo paso**,
  el **valor**, **quién la lleva** y por dónde llegó.
- **Por qué ese puntaje** (se abre con un clic): los puntos que suman o restan ("Pidió cita +30", "Objeción −10"),
  el ánimo y **Volver a analizar**, que lee otra vez toda la conversación.

  El puntaje **se enfría solo**: a los 3 días sin hablar baja 10, a la semana 25 y a las dos semanas 40, y la ficha
  dice hasta dónde llegó cuando hablaron ("llegó a 65 cuando hablaron"). Quien tiene cita o ya compró no se enfría:
  el siguiente paso ya está puesto. Lo que más pesa es pedir cita o tenerla, el interés que muestre, el afán y
  tener claro qué quiere; dar el nombre o preguntar el precio pesan poco. Son pesos **estimados** con las primeras
  conversaciones del negocio: se afinan cuando haya unas 20 citas con su resultado marcado en Hoy › *¿Cómo les
  fue?*.
- **Correo, WhatsApp, Instagram, Facebook y Nos contactó por**: lo de contacto que se tenga, para tocarlo y
  escribirle o abrir su perfil. Solo sale lo que está escrito.
- **Lo que contó**: lo que el asistente entendió de la conversación, sin preguntarlo (en XENTRIS: el producto, la
  empresa, cuántos usuarios, el plan de soporte, para cuándo…). Se llena solo mientras conversa, y se corrige en *Corregir datos*.
- **Citas** y **Historia**: lo último que pasó, con una caja para dejar una nota sin salir de la conversación.
  **Ver la ficha completa** abre la historia entera.
- **Corregir datos** (se abre con un clic): nombre, teléfono, correo, WhatsApp si es otro número, Instagram,
  Facebook, por dónde nos contactó, lo que contó, etiquetas y nota fija, con **Guardar**. El Instagram o el
  Facebook se pueden pegar como enlace: queda el usuario. Lo que corrijas a mano el asistente ya no lo cambia. Ahí
  mismo están **Archivar** y **Borrar**. Si mientras escribes llega un mensaje o un análisis nuevo, lo que llevabas
  escrito no se pierde.
- **Escribirle por WhatsApp** abre desde tu propio número, no desde el del negocio: sirve para buscarlo por fuera
  del tablero (si llegó por el chat del sitio o ya pasaron las 24 horas de WhatsApp oficial).
- **Archivar**: saca la conversación de las listas, del embudo y de los números, sin perder nada. Sirve para
  pruebas, equivocados o spam. Si esa persona vuelve a escribir, reaparece sola. Con el filtro *Archivados* las ves
  y las devuelves.
- **Borrar**: elimina la ficha con su conversación, sus citas y su análisis. No se puede deshacer, así que pide
  confirmación (si algo se va por error, está el respaldo del día anterior).
  Mientras las unes, el asistente ya trata la cita como suya: si agendó por el chat del sitio y después escribe por
  WhatsApp, no le ofrece horarios otra vez ni la deja con dos citas. La cita se queda en la ficha donde se agendó
  (ahí está su historia), y si la cambia o la cancela desde el otro canal queda anotado en las dos líneas de
  tiempo.
  Y el asistente **llega sabiendo**: cuando alguien que ya venía hablando por un canal escribe por otro, abre con
  *"Vi que veníamos hablando por el chat del sitio; ya me puse al tanto"* y sigue la conversación donde iba, porque
  lee las dos. La campana te avisa para que puedas unirlas.
- **¿Es la misma persona?**: si otra ficha tiene el mismo número (por ejemplo, escribió por el chat del sitio y
  después por WhatsApp), aparece arriba con **Unir fichas**. Se conserva la ficha donde escribió más recientemente,
  que es por donde le llegan las respuestas, y se le suman la conversación, las citas y el análisis de la otra.
  No se puede deshacer, así que pide confirmación.
Si llegaron mensajes nuevos después del último análisis, la ficha lo dice y se recalcula sola.

### Cuando son varios atendiendo

Si alguien más del equipo tiene abierta la misma conversación, sale un aviso arriba del chat: «Camila también
está aquí». Nadie queda bloqueado —el asistente sigue ahí y varias personas pueden escribir—, pero así no
contestan lo mismo dos veces. El aviso desaparece solo cuando el otro cierra o se va.

Cada respuesta va firmada con el nombre de quien la escribió, así que en el chat se ve quién dijo qué.

## Citas

La semana con las citas, en franjas de media hora. Cada cita ocupa lo que dura, y si dos caen a la misma hora van
una al lado de la otra. La tarjeta dice quién, la hora y la empresa, y con dibujos el canal, el recordatorio
(reloj: sale solo; campana: ya salió o hay que mandarlo a mano; chulo: confirmó), si tiene enlace de videollamada y
lo que vale el trato. **Tócala** y se abre su vista rápida: cuándo, qué, dónde, el trato, el recordatorio en
palabras, la nota y el **enlace de la videollamada** (pégalo ahí y sale en el recordatorio y en el calendario del
cliente). Desde ahí se marca *Asistió*, *No asistió* o se cancela; cancelar pide confirmar y XENCRM **no le avisa**
al cliente: díselo en el chat. Escape la cierra. O agenda una a mano. En el celular abre en **Agenda**, la lista de
lo que viene; con **Semana** ves la cuadrícula (se desliza en horizontal). Lo que elijas se recuerda.

**El panel de la derecha** empieza por la **próxima** cita, con la cuenta regresiva («En 2 h 15 min»; «En curso ·
termina en 20 min») y el botón para abrir su videollamada o su chat. Debajo, las de **hoy** y **mañana**, los
**recordatorios** (los que hay que mandar a mano traen «Abrir WhatsApp» y «Ya se lo recordé») y el **cupo** de los
próximos días: cuántos espacios quedan, con una barra que se pone ámbar cuando el día está casi lleno. Tocar un día
del cupo te lleva a él. En el celular la próxima sale arriba del calendario y lo demás debajo.

**Los avisos** salen en la fila de arriba de la semana (y como íconos en el mes, y entre los días de la Agenda):
- **Festivo**: los de Colombia salen solos. Un festivo no cierra la agenda: el asistente sigue ofreciéndolo hasta que
  lo bloquees. Si ya hay citas ese día, el aviso sale en ámbar para que no se te pase.
- **Bloqueado**: un día que cerraste.
- **Mantenimiento**: los programados en Servicio, con su hora y si falta avisar a alguien.
- **Casi lleno** (desde el 80 % del cupo, se cambia en Reglas y umbrales › Agenda) y **Lleno**.

**Toca el día** (su nombre arriba, o el número en el mes) y ves todo lo de ese día: sus avisos, el cupo, las citas,
*Agendar este día* y, si administras XENCRM, **Bloquear el día** (con un motivo, si quieres) o **Abrir el día**.
Bloqueado, el asistente no lo ofrece; lo que ya estaba agendado se queda, así que muévelo o atiéndelo. Desde aquí sí
puedes agendar a mano en un día bloqueado. Con varias sedes, se bloquea la sede que estás mirando (o todas, con
«Todas las sedes»). Si el dueño conectó su calendario personal, sus eventos salen como bloques *Ocupado* y el
asistente no ofrece esas horas; desde aquí sí puedes agendar encima si hace falta.

Si el negocio tiene **varias sedes**, arriba sale a cuál mirar. Con una escogida ves solo sus citas y su horario;
con **Todas las sedes** ves todo y lo que abre cualquiera. Cada cita dice en qué sede es, aquí, en Hoy y en la
ficha, y agendar a mano pide la sede: sin ella la cita no se agenda. La ficha queda en la sede de su última cita.
Los bloques *Ocupado* también son de la sede que miras: el calendario del dueño ocupa todas, y si una sede tiene el
suyo, ese solo ocupa esa sede. Al crear una persona a mano en Clientes, se escoge a qué sede llegó.

## Contactos y Tratos

Todas las personas que te han escrito, en tres pestañas: **Lista** para buscar a alguien, **Por etapa** para
moverlas por el embudo y **Seguimientos** para retomar a quien se quedó callado. Quien escribe por el chat del sitio
sin dar su nombre sale como *Visitante del sitio*, con cuatro letras para distinguirlo de otro.

### Tratos (por etapa)

Una columna por etapa. Las etapas son **las de tu negocio**: XENTRIS va *Nuevo → Calificado → Evaluando → Demo
agendada → Ganado*; una boutique, *Nuevo → Conversando → Interesado → Cita agendada → Vendido*; una financiera, *Nuevo → En revisión → Con un asesor → Resuelto*; una litografía,
*Nuevo → Tomando datos → Cotizado → En producción → Entregado*. Se eligen al montar el negocio y se ajustan en su
configuración. Para cambiar a
alguien de etapa, arrastra la tarjeta o usa **Mover…**, al pie de cada una, que también funciona en el celular.
Tocar la tarjeta abre la conversación, con su perfil al lado. El asistente mueve las etapas solo según la
conversación; lo que muevas tú, él no lo deshace.

**Cada tarjeta dice solo lo que importa:** el nombre, los mensajes sin leer, hace cuánto escribió y qué quiere. Debajo,
en ámbar, lo que urge («Contestar», «Atender», «Retomar») o su cita. Al pie, el puntaje si es un caliente, el valor
si se sabe y quién la lleva si es una persona. Lo demás (el canal, el puntaje de los que no están calientes, el paso
que no urge) está en la conversación y en su perfil.

Arriba van las cifras: el **embudo abierto**, lo **probable según el puntaje** (cada valor por su probabilidad), lo
que está **con cita por delante** y lo **vendido en 30 días**. Debajo, una barra con el color de cada etapa dice
dónde está la plata, y cada columna suma lo suyo. Si nada tiene precio, en vez de las dos primeras sale una sola,
**Valor en juego · Sin precios**, con **Cargar precios**, que lleva a Lo que sabe; también se pueden poner a mano en
la ficha.

Con varias sedes, arriba se escoge cuál mirar, y cada tarjeta dice la suya. **Sin sede todavía** junta a quienes no
han escogido: es donde hay que ir a preguntarles.

### Contactos (la lista)

El directorio de todas las personas, para buscar a alguien y saber de un vistazo qué pasa con cada una. Arriba,
pestañas con su número: *Todos*, *Míos* (las que llevas tú), *🔥 Calientes*, *Prospectos*, *Clientes* y
*Perdidos*. Cada fila dice la etapa, el puntaje, el **valor**, el **próximo paso** y **quién la lleva**. Un clic en
la cabecera de una columna ordena por ella. Al pie, cuántas son y cuánto suman.

**El próximo paso** lo escribe XENCRM sola, con reglas y sin gastar en modelos, en el mismo orden que Hoy:
*Contestar* si la última palabra es del cliente, *Atender* si la pasaron al equipo, la cita si tiene una,
*Retomar* si es un caliente que lleva un día callado. En ámbar va lo que espera a alguien del equipo.

**La ficha** se abre con el nombre. A la izquierda, lo que quiere y su **historia**: conversaciones, cambios de
etapa, citas, traspasos y notas, de lo más nuevo a lo más viejo. Las **notas** quedan con fecha y con quién las
escribió; la *nota fija* es la de siempre, para lo que nunca hay que olvidar. A la derecha, los detalles: la etapa se
cambia ahí mismo. Arriba, **3 de 23** pasa a la siguiente de la lista sin volver a ella; también con las flechas del
teclado. **Fijar** la deja en la barra lateral, debajo de las listas. Los fijados son tuyos: cada quien fija a los
suyos. Se guardan con el nombre con el que respondes, así que te siguen a otro computador o al celular.

### Lista de trabajo

Quienes llevan días sin escribir y valdría la pena retomar, los calientes primero. Si hay calientes esperando, la
sección Clientes lo dice con un número en rojo.

### Las vistas y los filtros

Contactos, Tratos y Embudo comparten la misma forma de filtrar, como en Dynamics:

- **Vistas** arriba, cada una con su número: *Todos*, *Tratos abiertos*, *Mis tratos*, *Sin asignar*, *Calientes*,
  *Con cita*, *Ganados este mes*, *Perdidos este mes* (en Contactos, además, los grupos de siempre).
- **Filtros** abre un panel: etapa, asignado a, canal, temperatura (en el modo completo), valor desde y hasta,
  última actividad y un dato captado. Cada condición queda como una píldora con **×** para quitarla.
- **Guardar vista** le pone nombre a lo que tienes filtrado (hasta 20 por persona; se guardan en tu navegador).
- En **Tratos** puedes cambiar entre **Tablero** y **Lista**.

## Prospectos

Ventas › Prospectos: quien dejó su nombre y su WhatsApp en el registro de la portada de XENCRM o de la puerta de la
consola («Pruébalo con tu negocio», «Pedir una demo»). Llega al instante, ya como ficha de WhatsApp con su negocio y
lo que quiere resolver, y el menú lleva la cuenta de los nuevos.

- Las cifras de arriba filtran: *Nuevos*, *Contactados*, *En el embudo*, *Descartados*.
- **Escribirle** abre su conversación. **Marcar contactado**, **Pasar al embudo** (lo lleva de la etapa de entrada a
  la primera activa, para que aparezca en Tratos) y **Descartar** cambian su estado y quedan en su historia.
- Si alguien se registra otra vez no se duplica: es la misma ficha, dice cuántas veces se registró y, si estaba
  descartado, vuelve a *Nuevos*.
- Solo lo recibe el CRM que la consola tenga configurado para eso (`PROSPECTOS_CLIENTE`, ver `consola.md`).

## Embudo

Cuántos tratos **llegaron** a cada etapa (o más allá), qué parte pasa a la siguiente, cuántos están **hoy** en cada
una y cuánto valen. Donde más se queda la gente lo marca «Aquí se quedan más» (cuando hay suficientes tratos para
decirlo). A la derecha, **Dónde se caen**: los perdidos por la etapa en que estaban y sus motivos. Tocar una etapa
abre Tratos filtrado por ella. Arriba eliges desde cuándo entraron los tratos que se cuentan.

## Cuentas clave

Los clientes que más importan (el *key account management*). Una cuenta se marca con la **estrella** de su ficha o
desde las **candidatas** que propone la pantalla (ya compró, compró y volvió, vino a su cita, caliente con cita,
entre los de mayor valor), cada una con su porqué. Nunca se marcan solas.

Cada cuenta muestra quién la lleva (**KAM**: el «Asignado a»), lo vendido y lo abierto, el último trato con su próximo
paso, el ánimo y el interés del último análisis, y su **salud**: *Sana*, *Atención* o *En riesgo*, con el motivo al
tocarla (por ejemplo, «escribió hace más de 24 h y nadie contestó», «más de 45 días sin hablar», «molesto en su
último análisis»). El **plan de cuenta** se escribe ahí mismo. Arriba, las cifras: cuántas, su valor, en riesgo y
sin KAM. Los días y las reglas que deciden la salud se cambian en **Reglas y umbrales**.


## Analítica

En dos pestañas: **Resumen** y **Ventas** (lo vendido en 30 días, 90 días o un año). En Resumen, los números del
negocio: embudo por etapa, ánimo de los clientes y más. Cada número abre la lista de conversaciones
que lo explica.

**Llevarse los datos.** Abajo, **Contactos (CSV)** y **Citas (CSV)** bajan una hoja de cálculo con lo que hay hoy,
lista para abrir en Excel o Google Sheets (con acentos y en columnas). Los contactos traen nombre, teléfono, canal,
etapa, puntaje, qué busca, ocasión, fecha del evento, etiquetas y notas; las citas, fecha, cliente, teléfono,
servicio, estado, lugar y cómo fue el recordatorio. Las conversaciones archivadas no salen. El archivo lleva
teléfonos y notas de clientes: trátalo como la base misma.

### Las dos gráficas

En **Análisis**, arriba de todo:

- **De dónde llega la gente**: conversaciones nuevas por día, partidas por canal (WhatsApp abajo, el chat del
  sitio encima). Es lo que dice dónde vale la pena poner la plata.
- **A qué horas te escriben**: un mapa de hora × día; cuanto más oscura la casilla, más mensajes a esa hora. Es
  lo que dice si hace falta alguien a las 7 de la noche o si el asistente está solo a esa hora.

Y tres números con su comparación contra la semana pasada: conversaciones nuevas, mensajes de clientes y citas
agendadas. La primera semana no hay con qué comparar y lo dice, en vez de inventar un porcentaje.

🪤 Los días y las horas se cuentan en la **zona horaria del negocio** (la de Configuración › El negocio), no en
la del servidor: un mensaje de las 11 de la noche no puede aparecer al día siguiente.

### Sentimiento

La segunda pestaña de Analítica. Sale del análisis de cada conversación (sin preguntarle a nadie más):

- **Interés**, de más a menos: 🤩 *Quiere comprar* · 🙂 *Interés claro* · 🤔 *Curiosidad* · 😶 *Sin interés*.
- **Ánimo**: 😊 *Contento* · 😐 *Neutral* · 😠 *Molesto*.
- Toca un nivel y salen esas personas; cada una abre su ficha.
- **Interés × ánimo** marca a quien quiere comprar y está molesto: es a quien hay que cuidar primero.
- **Lo que frena** son las objeciones que más se repiten, y **Cómo cambió**, el ánimo día por día.
- **Sentimiento por voz** está **por desarrollar**: la tarjeta dice qué hará y qué falta, y no muestra cifras.

## KPIs y metas

Diez indicadores del periodo (7, 30 o 90 días) comparados con el anterior igual de largo: conversaciones nuevas,
tiempo de respuesta, contestadas a tiempo, citas, asistencia, tratos ganados y perdidos, tasa de cierre, ventas y
valor del embudo. Lo que no se sabe sale «—», nunca cero.

Las **metas** (por semana o por mes) llevan su barra y una raya de dónde deberías ir hoy, con *A tiempo*, *Atrasada*
o *Cumple*. Solo quien administra las pone y las cambia (**Editar metas**); el equipo las ve. Abajo, **Por persona**:
lo ganado y lo vendido es de quien tiene asignado el contacto; las respuestas, de quien las escribió; el asistente va
en su propia fila.

## Optimización de ventas

Hallazgos con reglas fijas sobre tus datos, sin inteligencia artificial: dónde se caen los tratos, cuáles están
estancados, quién espera que le escriban, quién quiere comprar y está molesto, respuestas fuera del acuerdo de
tiempo, si contestar rápido vende más, motivos de pérdida y objeciones que se repiten, horas pico, canales… Cada uno
trae **su cifra con su base** («6 de 15»), por qué importa, **qué hacer** y un botón a la pantalla que lo resuelve.
Si hay pocos datos, dice «poca evidencia» en vez de sacar conclusiones. Abajo, **Tratos estancados** con
**Retomar**. Los mínimos de cada regla se cambian en **Reglas y umbrales**.

## Servicio

El área de lo que se le debe a quien ya es cliente. Se entra con **Área › Servicio**.

### Tickets

Lo que reportan los clientes. Cada ticket dice su prioridad, su estado, quién lo lleva y **el reloj del SLA** en una
frase: «Responder antes de las 3:40 p. m. · en 2 h», «La primera respuesta venció hace 31 min». El estado del SLA va
con palabra e ícono: *A tiempo*, *En riesgo* (gastó el 75 % de su tiempo), *Incumplido*, *En pausa*, *Cumplido* o
*Sin SLA* (el cliente no tiene plan).

- **Nuevo ticket** aquí, o **Crear ticket** desde la Bandeja y desde la ficha del contacto (que también muestra sus
  tickets).
- Vistas: *Abiertos*, *Mis tickets*, *Sin asignar*, *En riesgo*, *Incumplidos*, *Terminados*; filtros por prioridad,
  plan y asignado.
- Al abrir un ticket cambias su estado, prioridad o quién lo lleva, y ves su historia.
- **Lista | Tablero** (arriba a la derecha; se recuerda): el tablero es un kanban con una columna por estado, en el
  orden de Configuración › SLA y tickets. Dentro de cada columna, primero lo que más urge según el SLA. Para mover un
  ticket se arrastra la tarjeta a otra columna, o se usa **Mover…** en la tarjeta (con teclado y en el celular): es lo
  mismo que cambiarle el estado al abrirlo, con su permiso, su reloj y su historia. Las columnas que cierran
  (*Resuelto*, *Cerrado*) muestran los últimos 30 días. Si se quita un estado que tenía tickets, esos tickets aparecen
  en una columna *Sin estado* para moverlos a uno que exista. Para otros sistemas: `GET /admin/api/tickets/tablero`
  (filtros `prioridad`, `plan`, `asignado`, `dias`, `tope`).
- El reloj corre solo en el horario de soporte (o 24/7 si el plan lo dice). *Esperando al cliente* pausa el reloj de
  la solución. La primera respuesta cuenta con el primer mensaje de una persona del equipo después de abrirlo (el
  asistente no cuenta), con **Marcar como respondido** o al cerrarlo.

### SLA

Si se está cumpliendo lo prometido a cada plan: el porcentaje de primeras respuestas y de soluciones a tiempo (con su
base: «8 de 9 tickets»), por plan y por prioridad; lo que hay que mirar ya; y cómo van los mantenimientos y las
actualizaciones. Los objetivos se ven aquí y se cambian en **Configuración › SLA y tickets**.

### Mantenimientos y actualizaciones

- **Próximos mantenimientos**: la ventana (inicio y fin), la aplicación, los planes y los **clientes afectados**, cada
  uno con su aviso: *A tiempo*, *Por avisar* (con la fecha límite según su plan), *Atrasado*, *Preparado*, *No salió*.
- **Preparar aviso** deja el mensaje listo en la conversación de cada afectado para que alguien lo revise y lo mande:
  **nunca se envía solo**. El aviso cuenta cuando de verdad salió, o con **Ya le avisé** si avisaste por otro medio.
- **Actualizaciones** por aplicación: la última versión, hace cuánto, la próxima y si va al día con su cadencia.
- **Programar mantenimiento** y **Registrar actualización** son de quien administra (se puede abrir al equipo).


## Configuración

Al elegir **Configuración** en el selector de área, el menú de la izquierda se queda en íconos y aparecen dos
paneles: a la izquierda las funciones, en grupos (El negocio · El asistente y la IA · Canales · Servicio · Sistema),
cada una con lo que trae en una línea y con un buscador («whatsapp», «horario», «IA»…; Enter abre la primera); a la
derecha, la función elegida. Todo en la misma página: **El negocio** y **Perfil** ya no se abren en un diálogo
encima. Al volver a Ventas o Servicio, el menú queda como lo tenías. En el celular las funciones están en el menú.

## Perfil

Lo que el asistente dice de tu negocio: nombre, dirección, horarios, zona que atienden, contacto, formas de pago,
abono, precios, políticas y datos propios (planes, tiempos, lo que ofrecen o no).

- Lo que llenes, el asistente lo usa **al instante** y manda sobre cualquier otra información.
- Lo que quede vacío sale como **Por confirmar**. Si un cliente pregunta por eso, el asistente no se lo inventa:
  responde «Deja te verifico eso…» y la pregunta te llega a Hoy › Por verificar.
- Las **notas** en gris son para el equipo (por ejemplo, qué falta averiguar); el asistente no las ve.
- **Agregar dato** suma algo propio del negocio. Si lo dejas sin texto, queda por confirmar.
- **Lo que aprendimos de sus chats**: si ya tienen conversaciones por WhatsApp, se pueden traer (en WhatsApp: el
  chat › ⋮ › Más › *Exportar chat* › sin archivos, y subes el .txt). De ahí salen **las preguntas que más les
  hacen**, para llenar este perfil con lo que sus clientes preguntan de verdad y no adivinando. **Agregar al
  perfil** deja la pregunta como dato por confirmar, para que escribas la respuesta. De los chats **no** salen
  precios ni políticas: esos cambian y se escriben aquí, que son los de hoy.
- **Cómo hablan sus clientes**: del mismo historial salen las frases que usan y el asistente todavía no entiende
  ("de hoy en quince", "terno"). Con **Llevarlas a «Frases que no entendimos»** quedan en Agente, donde les pones
  el significado como siempre: solo se guardan si con eso ya se entienden.
- **Guardar perfil** guarda y deja una copia de la versión anterior.

### Tu perfil

Arriba a la izquierda, en el color de la marca del negocio: **quién responde** —el asistente o la persona que
tomó el turno— y debajo el nombre del negocio.

Abajo, tu ficha: el icono con tus iniciales y tu nombre. Se hace clic y se abre todo lo tuyo:

- **Con qué nombre respondes** (con el ejemplo de cómo le llega al cliente).
- **Tu color**, para reconocerte cuando son varios atendiendo.
- **El tema**: claro, oscuro o el del sistema —este último sigue al computador cuando cambia solo al anochecer.
- **Los avisos del navegador**, que te avisan aunque el tablero esté detrás de otra ventana.

🪤 El nombre no es un adorno: **por WhatsApp va delante del mensaje** que recibe el cliente (*Camila:* claro que
sí, con gusto). Arranca con el nombre del asistente, así que si lo dejas así el cliente no nota el cambio de
persona; si prefieres firmar con tu nombre, lo escribes.

Tu usuario, tu correo y tu clave no se manejan aquí: este tablero es del negocio. Eso vive en la consola, en
**Mi cuenta**.

## El negocio

La configuración del negocio, en la otra pestaña del mismo modal del Perfil. Aquí se cambia **sin tocar archivos**:

- **El negocio**: nombre, la línea que lo describe, sitio, país, moneda, el indicativo y los dígitos del teléfono,
  y qué responde cuando piden una persona.
- **El asistente**: cómo se llama, cómo habla, qué busca en cada conversación, cómo saluda y qué dice cuando no
  sabe algo.
- **Marca y hora**: el color, el **logo**, el **logo para fondo oscuro**, la **marca chica** (el favicon) y sobre
  qué fondo va su marca en lo que ve su gente. Muchas marcas tienen dos versiones del logo —una negra para fondo
  claro y una dorada para fondo oscuro— y usar la que no es se ve como un error de imprenta. Más la zona horaria, con la
  que entiende «mañana a las 3».
- **Citas**: si agenda, cómo se llama la cita, dónde, cuánto dura, cuántas a la vez, con cuánta anticipación,
  hasta cuántos días adelante, qué días y qué franjas.
- **Sedes**: si atiende en varios sitios con el mismo número. De cada una, el nombre, la dirección y cómo le dice
  la gente («la del norte», «alto prado»). Si una abre otros días u horas, o atiende a más gente a la vez, se marca
  *Tiene su propio horario o cupo*. Con dos o más, el asistente pregunta en cuál antes de ofrecer horarios. Una sede
  con citas por delante no se puede quitar: primero se mueven o se cancelan.

El **embudo** y los datos que captura no se tocan aquí: salen de cómo se dio de alta el cliente. Cambiarlos en
caliente dejaría fichas en etapas que ya no existen.

🪤 **Guardar no basta.** La configuración se lee al arrancar, así que el asistente sigue atendiendo con lo
anterior hasta que su proceso reinicie. El modal lo avisa arriba y, donde hay quien lo vuelva a levantar, ofrece
**Reiniciar ahora** (tarda unos segundos). Donde no lo hay, no se ofrece: salir dejaría al cliente sin atender a
nadie.

Nada se guarda sin validar, y antes de pisar el archivo queda una copia del anterior.

## Agente

- **Modo agéntico**: dos interruptores. **Con los clientes** (apagado de fábrica): en WhatsApp y el chat del sitio el
  asistente consulta los tickets, la cita y los mantenimientos de quien escribe, abre un ticket cuando reporta una
  falla y pasa a una persona cuando hace falta; cuesta algo más por mensaje. **Copiloto del equipo** (prendido de
  fábrica): el botón «Pregúntale a Xen» de arriba. Los prende y los apaga quien administra XENCRM. Los límites —pasos
  y gasto por mensaje— están en Reglas y umbrales › Modo agéntico.
- **Agentes**: quién atiende a tus clientes. Sin ninguno, atiende el asistente de siempre todo por WhatsApp y el chat.
  Con **Agregar un agente** le pones nombre, qué atiende (ventas, soporte, demos o citas, información), por dónde
  (WhatsApp, chat del sitio, voz) e instrucciones propias («ofrece primero el descubrimiento sin costo»). Cada
  conversación queda con un agente; si el cliente cambia a un tema que lleva otro, lo toma ese y se presenta. Un agente
  con **Voz** atiende llamadas desde la ventana de chat (botón «Hablar con…»): eliges su voz de Grok y el idioma de
  quien llama. Arriba dice si la voz está lista o qué le falta (la llave de xAI la pone quien administra XENCRM). Lo
  edita quien administra.
- **Respaldo de la base**: cuándo fue la última copia y el botón para hacer una ya. Si tu negocio tiene retención,
  dice también cada cuánto se anonimizan o se borran las conversaciones quietas y cuántas fueron la última vez.
  Quien tiene una cita por delante nunca entra. La retención la pone quien administra XENCRM.
- **Consumo de IA**: cuánto cuestan las respuestas por conversación y por mensaje. Si tu negocio tiene tope de gasto
  al mes, arriba dice cuánto llevas. Al llegar al tope, lo que necesita IA te llega a ti para contestarlo a mano
  hasta el mes siguiente; las citas y lo demás que no necesita IA siguen igual.
- **Calendario**: el enlace para ver las citas en Google Calendar, Outlook o Apple Calendar. Es secreto: quien lo
  tenga ve nombres y teléfonos.
- **Frases que no entendimos**: fechas, frases cortas o respuestas que el asistente no entendió por sus reglas
  ("a la hora del cafecito", "la madrugadora"). Con **Enseñar** escribes qué quieren decir ("a las 3", "la
  primera"); solo se guarda si con eso ya se entiende. La próxima vez lo entiende sin gastar IA. **Ya lo revisé** la
  saca de la lista.
- **Diccionario del negocio**: los temas, verbos y expresiones que el asistente ya conoce. Se puede exportar e
  importar como archivo.

## Modelos de IA

Solo para quien administra (Configuración › El asistente y la IA). Conecta los proveedores —OpenAI, Anthropic
(Claude), Apple Foundation Models, Ollama, LM Studio u otra API compatible con OpenAI— y elige cuál hace cada cosa
(responder, lo específico, clasificar, analizar). Cada proveedor dice su estado (*Conectado*, *Sin llave*, *No
disponible*…) y tiene **Probar conexión**, que no gasta. La llave se pega y no vuelve a mostrarse entera. Lo que se
guarda se aplica al reiniciar, y la pantalla lo dice.


## Canales

Por dónde llegan los clientes. Cada canal dice si está conectado, cuántos mensajes llegaron en la semana y qué
falta. Encender o apagar un canal aplica al momento.

Arriba está la **Dirección pública**, la que usan el chat del sitio, WhatsApp oficial y el tablero desde el
celular. XENCRM la revisa cada 5 minutos. Si deja de responder, avisa en la campana y en Hoy, y dice qué hacer;
**Revisar ahora** la prueba en el momento.

- **Chat del sitio web**: el código para pegar en el sitio. Lleva el color y el logo del negocio.
- **WhatsApp (código QR)**: se vincula escaneando el código desde WhatsApp › Dispositivos vinculados. Sirve para
  empezar; no es la vía oficial de Meta y puede bloquear el número.
- **WhatsApp oficial (Meta)**: en **Credenciales** se pegan el token de acceso, el ID del número y la clave secreta
  de la app, que están en la app del negocio en developers.facebook.com. Al darle **Guardar y verificar**, se
  comprueban con Meta: si Meta las rechaza, no se guardan y te dice por qué. El token no se vuelve a mostrar
  completo. Después hay que registrar en Meta la URL del webhook y el token de verificación que aparecen en la
  tarjeta.
- **Instagram** y **Messenger**: todavía no están; la tarjeta dice qué hace falta.
- **Otros asistentes de IA (MCP)**: para que asistentes como Claude o ChatGPT consulten el catálogo.

## Lo que sabe

La información que el asistente tiene (catálogo y textos del negocio), para buscar qué sabe de un tema.

## Todo es configurable

Lo que decide algo en XENCRM tiene un valor de fábrica, puede traer otro en el archivo del negocio y se puede cambiar
desde el tablero (solo quien administra). Manda lo último. Cada pantalla dice de dónde sale cada valor y tiene
**Volver al de fábrica**; si algo no vale, no se guarda nada y lo escrito no se borra.

- **SLA y tickets**: los planes de soporte, las prioridades, los tipos y estados de un ticket (cuáles lo cierran y
  cuáles pausan el reloj), los objetivos de primera respuesta y de solución por plan y prioridad, el horario de
  soporte o 24/7, desde cuándo un ticket está *En riesgo* y quién puede abrir, mover y cambiar las políticas.
- **Mantenimientos y actualizaciones**: el aviso mínimo por plan (de fábrica, 48 h, 72 h y 7 días), cada cuánto debe
  salir una actualización, quién cuenta como afectado y la plantilla del aviso, con vista previa.
- **Reglas y umbrales**: 64 reglas por grupo, con buscador. Por ejemplo, desde qué puntaje alguien es *caliente* (60)
  o *tibio* (30), cuánto suma cada señal, los días de una cuenta clave, los mínimos de Optimización, las horas para
  que un caliente pida seguimiento o el tope de contactos. Abajo dice lo que se configura en otro sitio, con su
  enlace.
- La palabra con que el negocio llama a lo que se agenda (cita, demo, turno), la bienvenida y los ejemplos de los
  campos vienen del archivo del negocio.


## Ayuda

- **Tutorial rápido**: seis pasos, cada uno con un botón a su pantalla y «Ya lo hice», que se recuerda en ese
  navegador.
- **Preguntas frecuentes**.
- **Lo que el asistente nunca hace**.

## Pregúntale a Xen (el copiloto)

El botón violeta de arriba abre una conversación al lado del tablero, sin dejar lo que estás mirando. Pregúntale por
tu CRM en tus palabras: «¿qué tengo pendiente hoy?», «¿qué tickets Enterprise están vencidos?», «¿quiénes son los
calientes sin asignar?», «anota en la ficha de Duarte que pidió la demo de rutas».

- **Consulta** contactos, fichas, citas, tickets, mantenimientos, lo pendiente de hoy y el cupo de la agenda, y te
  dice de dónde salió la respuesta («Consultó tickets»).
- **Hace al momento** solo dos cosas: crear un ticket y anotar una nota. Salen con un chulo verde y quedan firmadas
  «Tu nombre (con Xen)».
- **Propone** lo demás —mover de etapa, asignar, agendar, cambiar un ticket, preparar los avisos de un mantenimiento,
  escribirle a un cliente— en tarjetas violetas con **Hacerlo** (o **Enviar mensaje**) y **Descartar**. Nada de eso
  pasa hasta que lo apruebas, y al aprobar pasa por el mismo camino que el botón de siempre: si no puedes hacerlo
  desde la pantalla, tampoco por aquí.
- **Nunca le escribe a un cliente por su cuenta.**
- Los botones de abajo abren la ficha o el ticket que nombra la respuesta.

La conversación es tuya: vive en este navegador y se borra al cerrar la pestaña (o con el botón de empezar otra).
Escape lo cierra. En el celular ocupa la pantalla.

## Llamadas de voz

Si un agente atiende por voz, la ventana de chat del negocio (`/chat`) tiene arriba **Hablar con…**. El cliente da
permiso para el micrófono y habla con el agente como por teléfono; si habla encima, el agente se calla y escucha. Lo
que se dice queda escrito en la misma conversación: en el chat del cliente y en la Bandeja, como cualquier mensaje, y
en la ficha queda la llamada con su duración. Puede consultar sus tickets y la información, abrir un ticket o pasar
con una persona; para agendar, le dice que escoja el espacio en el chat. La llamada se corta sola al llegar al tiempo
máximo (Reglas y umbrales › Voz) y cada minuto cuenta para el consumo de IA.

## Lo que el asistente nunca hace

- Inventar precios, fechas, políticas o productos. Lo que no sabe, lo verifica con el equipo.
- Elegir una fecha por su cuenta: las citas salen siempre de la agenda real.
- Cancelar o mover una cita sin que el cliente lo confirme.
- Escribirle por WhatsApp oficial a alguien fuera de las 24 horas sin plantilla.
- Seguir respondiendo cuando una persona del equipo tomó la conversación.
- En el modo agéntico: decir que abrió un ticket que no abrió, mirar los datos de otro cliente o hacer algo más que
  lo seguro (abrir un ticket, pasar a una persona); agendar sigue siendo del flujo de citas, con confirmación.
- Guardar una clave o una tarjeta. Si alguien la escribe, en la conversación sale «omitido» y el asistente le pide
  que no la mande por el chat. El correo y el teléfono sí se guardan, que son los que hacen falta para la cita.
