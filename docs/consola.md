# La consola: varios clientes en una máquina

Guía para quien opera aiva —no para el equipo del negocio, que usa el tablero (ese está en
[`guia-del-tablero.md`](guia-del-tablero.md)). Aquí está cómo se monta un cliente nuevo, cómo se atiende a todos
desde una sola pantalla y quién ve qué.

## La idea en una línea

**Un proceso por cliente, una consola para todos.** Cada negocio tiene su instancia con su base, su WhatsApp, su
token y su dominio; lo que no se mezcla no se puede filtrar. La consola no guarda nada: le pregunta a cada
instancia y habla por ella cuando hay que responder.

## Montar un cliente

Desde la consola (`pnpm consola`, en `http://localhost:3900`), botón **Nuevo cliente**. O desde la terminal con
`pnpm cliente nuevo`, que pregunta lo mismo.

Lo primero que se pregunta es **cómo atiende ese negocio**, porque de ahí sale todo lo demás:

| Plantilla | Para | Embudo |
|---|---|---|
| **Citas** | Boutique, consultorio, taller | Nuevo → Conversando → Interesado → Cita agendada → Vendido |
| **Soporte** | Financiera, posventa, software | Nuevo → En revisión → Con un asesor → Resuelto |
| **Cotización y producción** | Impresión industrial, fabricación | Nuevo → Tomando datos → Cotizado → En producción → Entregado |

Queda creada su carpeta en `clientes/<slug>/` con su configuración, su base, su catálogo, su diccionario, su perfil
y su `.env` (puerto, token, dominio). Las claves compartidas de la máquina —OpenAI, Ollama— siguen **una sola vez**
en el `.env` de la raíz: cada cliente hereda lo que no define.

**El alta no arranca la instancia**, a propósito: así nadie deja un cliente corriendo sin querer. Para arrancarlos:

```
pnpm cliente pm2                      # escribe ecosystem.config.cjs con todos
pm2 start ecosystem.config.cjs        # los levanta
pm2 save && pm2 startup               # y vuelven solos al prender la máquina
```

Y para que entren por internet, un solo túnel con un subdominio por cliente:

```
pnpm cliente tunel                    # escribe clientes/cloudflared.yml
cloudflared tunnel --config clientes/cloudflared.yml run
```

Después queda: llenar su **Perfil** desde su tablero (o traer su historial, ver
[`aprender-del-historial.md`](aprender-del-historial.md)) y conectar sus canales.

## Atender

La pestaña **Atender** es un tablero con lo que espera a una persona en **todos** los clientes, repartido en tres
columnas:

| Columna | Qué es |
|---|---|
| **Piden una persona** | El asistente se calló y avisó que alguien escribiría. |
| **No supo: por verificar** | No supo algo y el cliente está esperando la respuesta del equipo. |
| **Esperan respuesta** | La última palabra la tiene el cliente. |

Cada tarjeta dice de qué cliente es y cuánto lleva esperando; dentro de cada columna, lo que más ha esperado va
arriba. Al abrir una, la conversación sale en un **panel al lado** —no parte la pantalla— con el chat, la pregunta
pendiente y la caja para responder. La consola habla por ese cliente con su token: no hay que abrir cinco tableros
ni repartir llaves. Lo que envíes queda a tu nombre (el que pongas en «Respondes como»).

**Con quién firmas es de cada cliente, y no es un adorno**: por WhatsApp ese nombre se le antepone al mensaje que
recibe el cliente (*Camila:* …). El campo «Respondes como» vive dentro de la conversación, se recuerda por cliente
y **arranca con el nombre del asistente de ese negocio** —el que sus clientes ya conocen—, no con el tuyo, que
allá no le dice nada a nadie. Si quien contesta quiere firmar con su nombre, lo cambia ahí.

**Varias personas pueden atender la misma conversación.** Si alguien más está adentro, sale el aviso «Camila
también está aquí». No bloquea a nadie a propósito —la idea es que la IA y el equipo convivan en el chat, no que
uno se adueñe—, pero evita que dos contesten lo mismo. La presencia caduca sola a los tres minutos: quien cierra
la pestaña no avisa.

Cuando entra algo nuevo de tus clientes **suena un pito**, el número queda en el título de la pestaña y, si tienes
la ventana atrás, sale una notificación del navegador. Se silencia con la campana.

## Vigilar

La pestaña **Clientes** es una lista con una fila por cliente. De un vistazo, sin entrar a nada: **sin leer ·
esperan · por verificar · citas · calientes · contactos**. Lo que está en cero no se pinta, para que el ruido no
esconda lo que sí pasa.

Debajo de cada fila salen los **tickets, que aparecen solos** según el estado:

| Ticket | Urgencia |
|---|---|
| La instancia no responde | alta |
| La dirección pública no responde | alta |
| WhatsApp pidiendo código | media |
| Preguntas sin responder | media |
| Gente esperando respuesta | media |
| Citas sin resultado | baja |

**Ver más** estira la fila con el micro-tablero del negocio:

```
61 mensajes hoy · 38 conversaciones · 5 calientes · 54 puntaje promedio
9 llegaron a cita · 6 ganadas · 39 % efectividad · $1.42 de IA (30 días)
```

La **efectividad** es cuántas de las conversaciones abiertas llegaron a cita o se ganaron. Se calcula por el
**papel** de las etapas (`cita`, `ganado`), no por su nombre: cada negocio las llama distinto y el papel es lo
único que significa lo mismo en todos.

Ahí mismo sale **quién atiende a ese cliente**, con lo que se necesita a la mano: cambiarle la clave a alguien,
quitarlo de ese cliente o asignarle a otra persona, sin ir hasta Equipo.

La **prioridad** de cada cliente se cambia en su fila y es la que pesa en el orden de todo.

### Abrir el tablero de un cliente

**Abrir tablero** lo abre *dentro de la consola*, en `/c/<slug>/admin`: la consola le pone el token del cliente a
cada petición y el tablero entra con tu sesión. No hay que volver a identificarse ni repartir los `ADMIN_TOKEN`.
Quien atiende a un cliente entra al suyo y a ningún otro, ni sabiéndose la dirección. «Salir» devuelve a la
consola, que es de donde se vino.

## Quién entra y qué ve

- **Super-admin**: ve y atiende todos los clientes, da de alta, da de baja y maneja el equipo.
- **Quien atiende**: solo ve —y solo le suena— lo de los clientes que tiene asignados. Si pide otro, recibe un no.

Se administran en la pestaña **Equipo**: agregar a alguien con su clave, marcarle qué clientes atiende, cambiarle
la clave, desactivarlo o quitarlo. Las claves se guardan cifradas (scrypt), nunca en claro.

El **`CONSOLA_TOKEN`** del `.env` es la llave maestra del super-admin: con eso se entra la primera vez —cuando
todavía no hay usuarios— y cuando alguien pierde su clave.

La consola escucha **solo en `127.0.0.1`**. Es deliberado: quien entre ahí tiene acceso a todos los tableros. Para
usarla desde afuera va detrás del túnel **con autenticación** (Cloudflare Access), nunca abierta.

## Dar de baja un cliente

Desde su tarjeta, **Dar de baja**. Lo que pasa:

1. Sale de la consola y deja de aparecer en todo.
2. Su carpeta se guarda en `clientes/_dados-de-baja/<slug>-<fecha>/`. **No se borra nada**: su base, sus
   conversaciones, su WhatsApp y su configuración quedan ahí, por si hay que volver o si el cliente pide sus datos.
3. Se limpia a la gente que lo atendía. A quien atendía **solo** a ese cliente se le desactiva el acceso —no
   tendría nada que ver al entrar— y queda listado en Equipo para reasignarlo o quitarlo.

La confirmación dice cuántas personas lo atienden antes de que decidas. Lo que **no** hace es apagar su instancia:
eso se hace con `pm2 stop aiva-<slug>`, a propósito.

## Lo que hay que mirar de vez en cuando

- Que no queden personas **sin clientes** en Equipo (la consola lo avisa arriba).
- Que la **dirección pública** de cada cliente responda: si se cae, no entran ni el chat del sitio ni WhatsApp.
- El **consumo de IA** por cliente, que es lo que se factura.
- Los **respaldos**: cada instancia guarda una copia diaria de su base (14 días) en su carpeta.

## La configuración de cada cliente

Desde el tablero de un cliente —al que se entra por la consola—, en **El negocio**, se cambia sin tocar archivos.
Se abre en un **modal con dos pestañas** (El negocio · Perfil) encima de lo que estuvieras haciendo, no en otra
pantalla: es configuración, y al cerrar uno vuelve donde estaba.

| Qué | Para qué sirve |
|---|---|
| Nombre, descripción, sitio, país, moneda | Lo que el asistente sabe de entrada sobre el negocio |
| Indicativo y dígitos del teléfono | Con eso entiende «300 123 4567» y lo guarda como +57… |
| Cuando piden una persona | Lo que responde cuando alguien quiere hablar con alguien de carne y hueso |
| Cómo se llama el asistente, cómo habla, qué busca, cómo saluda | La persona que atiende |
| Cuando no sabe algo | La frase antes de que la pregunta le llegue al equipo |
| Color y logo | La marca en el chat del sitio y en la página de la cita |
| Zona horaria | Con eso entiende «mañana a las 3» |
| Citas: si agenda, cómo se llama, dónde, duración, cupo, días y franjas | La agenda de verdad |

**El embudo y los datos que captura no se tocan desde ahí**: salen de cómo se dio de alta el cliente (citas,
soporte o cotización). Cambiarlos en caliente dejaría fichas en etapas que ya no existen.

🪤 La configuración se lee **una vez, al arrancar**. Guardar deja el archivo listo, pero el asistente sigue
atendiendo con lo anterior hasta que su proceso reinicie: por eso aparece el aviso y, donde hay quien lo vuelva a
levantar (el arranque del paquete o pm2), el botón **Reiniciar ahora**. Donde no lo hay, no se ofrece: salir
dejaría al cliente sin atender a nadie.

Nada se guarda sin validar contra el mismo esquema con el que se lee al arrancar, y antes de pisar el archivo se
deja una copia en `aiva.config.json.anterior`. Una actualización del despliegue tampoco pisa lo editado: si el
cliente ya tiene su configuración en los datos, manda esa; la que trae el paquete solo se usa la primera vez.

## Cuentas

Cada quien entra con **usuario y clave**, o con su **correo** y la clave si lo tiene puesto. El botón con tu
nombre, arriba a la derecha, abre **Mi cuenta**: ahí cambias tu nombre, tu correo y tu clave sin pedirle nada al
super-admin. Para cambiar la clave hay que poner la actual —si no, cualquiera que se siente frente a una sesión
abierta te deja afuera—. El rol y los clientes que atiendes no se tocan ahí: eso lo decide el super-admin en
**Equipo**.

La llave maestra (`CONSOLA_TOKEN`) **no es una cuenta**: es la salida de emergencia para entrar la primera vez,
antes de que exista un solo usuario, o si alguien pierde la suya. Entrando con ella no hay nada que cambiar en
Mi cuenta.

🪤 `ADMIN_TOKEN` y `CONSOLA_TOKEN` **se inventan solos en cada arranque si no están en el entorno**. Sirve para
probar en la máquina de uno, pero en un despliegue significa que el token cambia cada vez que el proceso
reinicia. Por eso van siempre en el panel (o en el `.env` del cliente). Entrando por la consola esto ya casi no
se nota —los tableros se abren con tu sesión, no con el token—, pero el día que alguien quiera abrir
`/<cliente>/admin` directo, lo va a necesitar.
