# Checkpoint

Dónde quedó el trabajo, para retomarlo sin releer la conversación. Se reescribe al cerrar cada sesión; el detalle de
cada arreglo está en [`arreglos.md`](arreglos.md), con su commit.

## 2026-10-12 (tarde): el orden de un CRM

**Estado.** Rama `main`, todo commiteado. El paquete para subir quedó en `paquetes/aiva.zip`, con el commit de este
checkpoint en su `version.json`. Nada de esto está desplegado todavía, ni lo de la mañana.

| Comprobación | Resultado |
|---|---|
| `pnpm test` (sin modelo) | 1.865 comprobaciones, cero fallos |
| `pnpm typecheck` | sin errores |
| Pantallas nuevas, en Chrome | a 1340 y a 390 px, en claro y en oscuro, sin errores de JavaScript |
| El paquete, descomprimido aparte | la consola entra con un `Origin` y un `Host` de afuera |

### Lo que se hizo

El usuario vio el video de un CRM tipo Attio y le gustó la interfaz. Se le preguntó por el estilo y eligió
**quedarse con el de hoy** (blanco, azul y plano) y tomar del video las pantallas, las funciones y los detalles.
Después pidió también la portada, porque la sentía con mucho texto.

| Qué | Commit |
|---|---|
| Tablero: próximo paso y valor en cada ficha, Clientes con pestañas y orden, cifras y sumas en Prospectos, la ficha en dos columnas con historia y notas, «3 de 23», fijados, listas en la barra, filtros encima de la lista | `b21f93d` |
| Consola: la misma piel del tablero por dentro, la entrada intacta, y lo de una vez al mes de cada cliente en «⋯» | `8b1a237` |
| Portada: de 385 a menos de 250 palabras, con una vista del tablero en vez de párrafos | `08ddbb7` |
| El color de la consola, a gusto de cada quien en Mi cuenta, con el azul por defecto | `95e4964` |
| Los fijados en la base de cada cliente: siguen a la persona a otro computador | `0f4c870` |

Arreglos que salieron por el camino: la lista de contactos ignoraba el `limit` y devolvía 200 aunque se pidieran 500;
el dinero salía siempre en pesos; la consola tenía media hoja de estilos copiada dentro de la regla del celular.

### Para desplegar

1. Subir `paquetes/aiva.zip`. Lo primero, confirmar en `/_salud` que corre el commit esperado.
2. Nada que migrar: las notas nuevas son eventos de tipo `nota` en la tabla `events`, que ya existía.
3. Nada nuevo en variables. La moneda sale de `business.currency` de cada cliente, que ya existía.

### Pendientes conocidos

- **La clave de OpenAI** del `.env` de la raíz da 401. La buena termina en «MMA».
- **«Míos» y los fijados** van por el nombre con el que responde cada quien. Si dos personas firman igual,
  comparten los dos. El tablero no tiene usuarios propios, y el nombre es lo único que las distingue.

### Cómo retomar

```bash
pnpm test               # todo, sin modelo
pnpm test:proximo       # el próximo paso, las notas y los números de la barra
pnpm test:fijados       # los fijados en la base, y que no quede un teléfono guardado ahí
pnpm test:tablero       # el esqueleto del tablero, la consola y la portada
pnpm paquete            # el ZIP para Hostinger
```

## 2026-10-12 (mañana)


**Estado.** Lo de la mañana va dentro del paquete de la tarde: no hay que subir dos.

| Comprobación | Resultado |
|---|---|
| `pnpm test` (sin modelo) | 1.782 comprobaciones, cero fallos |
| `pnpm typecheck` | sin errores |
| `pnpm test:scenarios` de DUNOR | 40 de 40, con Gemma |
| El paquete, descomprimido aparte | la consola entra con usuario y clave, con un `Origin` y un `Host` de afuera |

Los escenarios corrieron con Gemma porque la clave de OpenAI del `.env` de la raíz responde 401.

### Lo que se hizo

Partió del brief de agentes múltiples (`docs/brief-agentes-multiples.md`, sin commitear porque no es nuestro). La
conclusión fue que su filosofía ya era la de aiva y que había cinco brechas reales; se cerraron y se sumaron sedes.

| Qué | Commits |
|---|---|
| Guardas contra inyección de prompt, y la referencia de las guardas sin las reglas del prompt («Sí, tenemos wifi» pasaba desde el primer commit) | `459ea37` |
| WhatsApp oficial no atiende dos veces lo que Meta repite; en «Mira» no marca leído | `2bf1951` |
| Tope de gasto de IA en USD por cliente: aviso al 80 %, ahorro al 90 %, al 100 % nada de pago y lo demás al equipo | `148e438` |
| Varias sedes con un mismo número: flujo de citas, tablero, El negocio, Prospectos, calendarios por sede | `dba1be5`, `4bc5cf7`, `387fd4f`, `b45bbfb` |
| Cada respuesta con su «¿por qué?» (turnos guardados 90 días) y la versión que corre en `/_salud`, la consola y el paquete | `fa9fb3f` |
| Claves y tarjetas tapadas en vivo, antes de guardarse y antes del modelo | `ce06a07` |
| Retención automática: las conversaciones quietas se anonimizan o se borran solas | `a3044d6` |
| Sedes al dar de alta un cliente; sin sedes, ni una palabra de sedes en el prompt | `cc155fa` |

Y los arreglos que salieron por el camino:

| Arreglo | Commit |
|---|---|
| La sigla del cliente cuando su logo no carga | `abffeb4` |
| En el celular, el panel de agendar tapaba las citas del calendario | `ed54349` |
| Los escenarios de DUNOR esperaban la cancelación de antes de la retención de citas | `c1d4c67` |
| El recordatorio contaba los días en la hora del servidor; decía «la lleva bot»; el README decía 5 p. m. | `bc7771c` |
| La consola daba «no contesta» por una dirección pública sin configurar | `9554254` |
| A un «hola» le llegaba «dame un segundito que lo consulto» con un motor caído | `eebcd58` |
| La fecha del formulario de agendar, suelta al lado de su etiqueta | `ff21b08` |

### La retención, con qué se decidió

No hubo respuesta a las tres preguntas, así que se construyó con lo más prudente y todo se puede cambiar por cliente:

- **Viene apagada en todos.** La enciende el super-admin en la consola, en Configuración › Motores, debajo del tope.
  Antes de guardar dice cuántas conversaciones tocaría ese día.
- **Anonimizar es lo de por defecto.** Quita nombre, teléfono, datos y mensajes, y deja las cuentas del embudo y del
  gasto. Borrar del todo es la otra opción y pide confirmación.
- **Mínimo 90 días; se sugieren 365.** Nunca toca a quien tiene una cita por delante.
- **Siempre con un respaldo de menos de un día detrás.** Si no se puede respaldar, no toca nada. Lo anonimizado se
  recupera de los respaldos durante 14 días.

Para CONFIA, por ser financiera, lo natural es encenderla con 365 días y anonimizar. Eso queda para cuando se decida.

### Para desplegar

1. Subir `paquetes/aiva.zip`. Después, lo primero es confirmar en `/_salud` que corre el commit esperado.
2. La base se migra sola al arrancar: tablas `entrantes` y `turnos`, y las columnas `appointments.sede`,
   `llm_usage.turno` y `messages.turno`. La retención no necesita nada: vive en `settings`.
3. Variables nuevas, todas opcionales: `TOPE_USD_MES` (el tope inicial; el de la consola le gana),
   `CALENDAR_BUSY_ICS_<SEDE>` (el calendario de una sola sede) y `AIVA_VERSION` (si el panel quiere fijarla).

### Pendientes conocidos

- **La clave de OpenAI** del `.env` de la raíz da 401. La buena termina en «MMA».
- **Las direcciones de calendario se separan por comas**, la general y las de cada sede. Las de Google y Outlook no
  llevan comas; una dirección `data:` sí, y no sirve ahí.
- **La retención anonimiza de a 300 por hora.** Un cliente con miles de conversaciones viejas tarda unas horas la
  primera vez. Es a propósito, para no ocupar la base.

### Cómo retomar

```bash
pnpm test               # todo, sin modelo
pnpm test:scenarios     # las conversaciones de DUNOR con los motores reales
pnpm paquete            # el ZIP para Hostinger
```

Lo nuevo de hoy tiene su prueba: `test:inyeccion`, `test:repetidos`, `test:presupuesto`, `test:sedes`,
`test:turnos`, `test:claves` y `test:retencion`.
