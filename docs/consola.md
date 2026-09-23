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

La pestaña **Atender** junta en una sola bandeja lo que espera a una persona en **todos** los clientes:

- **Por verificar**: el asistente no supo y el cliente está esperando la respuesta del equipo.
- **Pidió una persona**: el asistente se calló y avisó que alguien escribiría.
- **Espera respuesta**: la última palabra la tiene el cliente.

Cada fila dice de qué cliente es, y el orden es **urgencia × prioridad del cliente**: lo urgente de un cliente
grande va antes que lo urgente de uno chico. Al abrir una se ve la conversación y se responde ahí mismo: la consola
habla por ese cliente con su token, sin abrir cinco tableros ni repartir llaves. Lo que envíes queda a tu nombre
(el que pongas en «Respondes como»).

Cuando entra algo nuevo de tus clientes **suena un pito**, el número queda en el título de la pestaña y, si tienes
la ventana atrás, sale una notificación del navegador. Se silencia con la campana.

## Vigilar

La pestaña **Clientes** tiene una tarjeta por cliente con su estado, sus números (contactos, calientes, citas,
consumo de IA de 30 días) y **tickets que salen solos**:

| Ticket | Urgencia |
|---|---|
| La instancia no responde | alta |
| La dirección pública no responde | alta |
| WhatsApp pidiendo código | media |
| Preguntas sin responder | media |
| Gente esperando respuesta | media |
| Citas sin resultado | baja |

La **prioridad** de cada cliente se cambia ahí mismo y es la que pesa en el orden de todo.

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
