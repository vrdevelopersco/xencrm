# Checkpoint

Dónde quedó el trabajo, para retomarlo sin releer la conversación. Se reescribe al cerrar cada sesión; el detalle de
cada arreglo está en [`arreglos.md`](arreglos.md), con su commit.

## 2026-10-12

**Estado.** Rama `main`, todo commiteado. Nada de esto está desplegado todavía: el último paquete es de antes.

| Comprobación | Resultado |
|---|---|
| `pnpm test` (sin modelo) | 1.715 comprobaciones, cero fallos |
| `pnpm typecheck` | sin errores |
| `pnpm test:scenarios` de DUNOR | 40 de 40, con Gemma |

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

### Para desplegar

1. `pnpm paquete`. El paquete ahora lleva `version.json` con el commit, y `/_salud` lo dice: después de subirlo, lo
   primero es confirmar ahí que corre el commit esperado.
2. La base se migra sola al arrancar: tablas `entrantes` y `turnos`, y las columnas `appointments.sede`,
   `llm_usage.turno` y `messages.turno`. No hay que tocar nada a mano.
3. Variables nuevas, todas opcionales: `TOPE_USD_MES` (el tope inicial; el de la consola le gana),
   `CALENDAR_BUSY_ICS_<SEDE>` (el calendario de una sola sede) y `AIVA_VERSION` (si el panel quiere fijarla).
4. Antes de entregar el ZIP, probar el login como en producción, en un navegador de verdad: es lo que se ha roto
   dos veces al desplegar.

### Lo que espera una decisión

**La retención automática** de conversaciones viejas no se construyó, porque borra datos de clientes. Hace falta
decidir:

- cuántos días de inactividad antes de actuar;
- si se borra o se anonimiza (anonimizar conserva las cuentas del embudo y quita nombre, teléfono y mensajes);
- para qué clientes: solo CONFIA, por ser financiera, o todos.

Los respaldos guardan 14 días, así que lo borrado seguiría ahí ese tiempo.

### Pendientes conocidos

- **La clave de OpenAI** del `.env` de la raíz termina en «piMA» y da 401; la buena termina en «MMA».
- **El alta de un cliente nuevo no pregunta sedes.** Se ponen después, en El negocio.
- **Las direcciones de calendario se separan por comas**, la general y las de cada sede. Las de Google y Outlook no
  llevan comas; una dirección `data:` sí, y no sirve ahí.

### Cómo retomar

```bash
pnpm test               # todo, sin modelo
pnpm test:scenarios     # las conversaciones de DUNOR con los motores reales
pnpm paquete            # el ZIP para Hostinger
```

Lo nuevo de hoy tiene su prueba: `test:inyeccion`, `test:repetidos`, `test:presupuesto`, `test:sedes`,
`test:turnos` y `test:claves`.
