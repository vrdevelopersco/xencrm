# Seguridad de aiva

aiva atiende a varios negocios a la vez, con conversaciones de sus clientes finales dentro. Lo que hay que
proteger, por orden:

1. Que **un negocio no vea lo de otro**.
2. Que **un desconocido no llegue** al tablero ni a la consola.
3. Que **lo que escribe un cliente final** —que es cualquiera con un teléfono— no se convierta en una orden
   dentro de la pantalla de quien atiende.
4. Que **nadie gaste el dinero** del cliente llamando al modelo en bucle.

La batería vive en `src/eval/seguridad.ts` y se corre con `pnpm test:seguridad` (va también dentro de
`pnpm test`). Hace las peticiones contra la aplicación de verdad, el mismo camino que un navegador, no contra
las funciones por dentro: lo que se quiere probar es el guardia, y el guardia vive en el middleware. Todo ocurre
en una carpeta temporal con clientes inventados (`AIVA_CLIENTES_DIR`), así que no toca ni los clientes reales ni
el archivo de usuarios.

## Lo que quedó probado

- **Entrar**: clave mala, usuario inexistente y mensaje idéntico en los dos casos (no delata qué cuentas
  existen). La galleta es HttpOnly y SameSite.
- **Aislamiento**: quien atiende a un negocio solo ve ese negocio; no alcanza el tablero, el logo ni el token de
  administración de otro.
- **Privilegios**: un asesor no ve el equipo, no crea usuarios, no le cambia la clave a otro, no borra a nadie,
  no da de alta clientes, y al editar «lo mío» no se asciende ni se asigna clientes ajenos.
- **El admin de un cliente** maneja a su gente y a nadie más: no crea super-admins, no reparte clientes ajenos, no
  toca a quien atiende además otro negocio ni al super-admin («no existe», igual que un usuario inventado), no se
  entera de qué otros clientes tiene aiva y no se baja ni se desactiva a sí mismo (`test:usuarios`).
- **Lo de quien administra aiva** (motores, clave de OpenAI, tope de gasto y encender la retención) se frena en las
  dos puertas al cliente: `/api/c/<slug>/…` y `/c/<slug>/admin/api/…`.
- **Retención**: el negocio ve la suya pero no la cambia; encenderla, que anonimiza o borra conversaciones, es solo
  del super-admin. Al anonimizar, ni el nombre ni el teléfono quedan en ninguna tabla de la base (`test:retencion`
  la recorre entera buscándolos).
- **Sesiones**: salir la cierra; desactivar a alguien la cierra; **cambiarle la clave también la cierra**.
- **Tablero**: sin token no contesta nada, ni las rutas que mueven datos.
- **Chat público**: corta al mensaje 21 por conversación, rechaza vacíos y enormes, y un identificador de
  conversación inventado no devuelve nada de nadie.
- **Lo que escribe un desconocido**: la función de escape del tablero y de la consola, y que el nombre de quien
  contestó no pueda meter etiquetas (ver abajo).
- **Cabeceras**: `nosniff`, `DENY` y `no-referrer` en la consola y en el tablero.
- **Webhook de Meta**: sin el secreto de la app no se acepta ningún aviso.
- **Exportación**: una fórmula en el nombre sale como texto, y un teléfono sigue saliendo igual.
- **Fuerza bruta**: probar claves a ciegas se frena (esta prueba va la última a propósito: el freno deja
  bloqueado quince minutos a quien lo dispara).
- **Otra página**: una petición lanzada desde un sitio ajeno no se ejecuta.

## Lo que se encontró y se arregló

Salió de cuatro revisiones en paralelo del código y de probarlo en un navegador de verdad.

| Qué | Cómo se explotaba | Dónde |
|---|---|---|
| **El nombre de quien contestó se pintaba sin escapar** | Un chat de WhatsApp importado trae ese nombre del archivo, o sea lo escribe un desconocido. Con `<img src=x onerror=…>` se ejecutaba JavaScript en la pantalla de quien atiende, y de ahí sale el token del tablero. **Comprobado ejecutándose**, y comprobado corregido. | `public/admin.js` (`bubble`) |
| **El webhook de WhatsApp aceptaba cualquier cosa sin firma** | Si el cliente guardaba las credenciales de Meta sin el secreto de la app (el tablero lo permite), cualquiera que supiera la dirección inventaba conversaciones **y hacía que el número verificado del negocio le escribiera a terceros**. | `src/channels/meta.ts` |
| **Probar claves a ciegas no costaba nada** | La consola alcanza el tablero de todos los clientes y su login no tenía freno: ni contador, ni bloqueo, ni retraso. La llave maestra ni siquiera pasa por el hash, así que se probaba a miles por segundo. | `src/consola.ts` |
| **Peticiones desde otra página** | Con la sesión abierta, una página cualquiera podía hacer que el navegador creara un super-admin. Lo único que lo frenaba era la galleta `SameSite`, que no cubre el caso real: en el despliegue de un solo dominio, la consola y la página pública de cada cliente comparten origen. | `src/cabeceras.ts` |
| **La llave maestra se reenviaba al cliente** | Se acepta por `?token=`, y el proxy copiaba la dirección entera hacia arriba: abrir `/c/<cliente>/admin?token=<llave>` dejaba la llave de **todos** los clientes escrita en el registro de acceso de la instancia de uno solo. | `src/consola.ts` |
| **El token del tablero viajaba por la URL** | Se aceptaba en cualquier ruta, y el tablero lo pone en la dirección del flujo en vivo en cada reconexión: queda en los registros del servidor, del túnel y de cualquier proxy. Ahora solo se acepta en el flujo en vivo, que es lo único que no puede mandar cabeceras. | `src/channels/admin.ts` |
| **La llave maestra se guardaba en el navegador** | Al entrar con ella quedaba en el almacenamiento local, que lee cualquier script del origen. Ya no se guarda: la sesión alcanza para todo. | `public/consola.html` |
| **Fórmulas en el CSV** | El nombre lo pone el cliente desde WhatsApp, y Excel ejecuta lo que empieza por `=`, `+`, `-` o `@`. Un prospecto con `=HYPERLINK(…)` de nombre se llevaba la fila cuando el dueño abría el archivo. | `src/crm/export.ts` |
| **Cambiar la clave no echaba a nadie** | A una cuenta comprometida se le cambiaba la clave y quien había entrado seguía dentro hasta doce horas: lo contrario de lo que uno cree que acaba de hacer. | `src/consola-usuarios.ts` |
| **Lo de quien administra aiva pasaba por la segunda puerta** | El freno para motores, clave y retención estaba solo en `/api/c/<slug>/…`. Por `/c/<slug>/admin/api/…`, la que usa el tablero abierto desde la consola, cualquiera con un cliente asignado cambiaba los motores, ponía una clave de OpenAI o encendía la retención que borra conversaciones. La clave no se podía leer (sale tapada), pero sí reemplazar. **Comprobado pasando** y comprobado frenado (2026-10-16). Ahora las dos puertas usan la misma función. | `src/consola.ts` (`vedado`) |
| **Un respaldo malo dejaba al cliente sin arrancar** | La configuración se escribía sin comprobar. Si quedaba rota, el proceso no volvía a levantar —y con un supervisor detrás, reiniciándose para siempre—. Ahora se valida ya compuesta y antes de escribir. | `src/crm/respaldo.ts` |
| **Identificador de conversación adivinable en MCP** | Sin identificador se usaba `anon-<reloj>`, adivinable dentro del mismo segundo: quien lo adivinara retomaba la conversación de otro con su historial dentro del contexto del modelo. | `src/mcp/server.ts` |
| **Mensajes sin tope por MCP** | El chat del sitio corta en 2000 caracteres; por MCP no había corte, así que un mensaje enorme entraba entero al modelo y lo pagaba el cliente. | `src/mcp/server.ts` |
| **El logo de otro, servido sin CSP** | La consola re-sirve el logo de cada cliente; un logo puede ser un SVG, y un SVG abierto como página ejecuta JavaScript —en el origen donde vive la sesión que alcanza a todos los clientes—. | `src/consola.ts` |

## Lo que sigue abierto

Nada de esto es explotable hoy por un desconocido, pero conviene tenerlo escrito.

- **Un asesor hace en su cliente todo lo que hace su admin, menos Equipo.** El proxy comprueba de quién es el
  cliente, no qué se hace con él: quien atiende conversaciones puede además bajar el CSV con los teléfonos,
  cambiar la configuración, restaurar un respaldo y reiniciar el proceso. El usuario lo decidió así el
  2026-10-16. Si algún día el asesor tiene que ser solo chat, hay que filtrar rutas y métodos, no solo el cliente.
- **Dos admins del mismo cliente se pueden cambiar la clave entre sí.** Es su negocio y su gente; si uno deja al
  otro por fuera, lo arregla el super-admin.
- **La ruta del logo no está confinada.** `marca.logo` acepta cualquier ruta del disco y `/brand/logo` se sirve
  sin autenticación (solo se limita la extensión). Hace falta ser admin del cliente y reiniciar.
- **`/health` es público** y dice el nombre del negocio, el del asistente, el modelo y el estado de los motores.
- **El calendario `.ics`** lleva nombre, teléfono y resumen de cada cita detrás de un enlace secreto permanente
  que, por diseño, se pega en Google Calendar o en Outlook.
- **La dirección de quien llama se cree a pies juntillas** (`cf-connecting-ip`, `x-forwarded-for`), así que el
  tope por dirección del chat público se esquiva cambiando esa cabecera. El tope por conversación sigue de pie.
- **No hay tope de tamaño de cuerpo** en ninguna ruta: se lee entero y se mide después.
- **No hay CSP.** Las páginas traen estilos y guiones en línea, así que ponerla pide moverlos a archivos o usar
  un sello por respuesta.
- **Sin rotación de tokens.** Ni el del tablero ni el del calendario caducan ni se pueden revocar sin cambiar la
  variable de entorno y reiniciar.
- **La consola queda publicada** en el despliegue en paquete: el enrutador manda a la consola todo lo que no sea
  un cliente. Escucha en 127.0.0.1, pero el enrutador está delante. Con el freno de intentos ya no es una puerta
  abierta, pero la llave maestra debe seguir siendo larga y aleatoria.

## Si algo de esto cambia

Cualquier pantalla nueva que muestre algo escrito por un cliente final pasa por la función de escape, sin
excepción; el sitio donde falló fue justamente uno que parecía «de la casa» (el nombre de quien contesta). Y
cualquier ruta nueva del tablero o de la consola nace detrás del guardia: la batería comprueba que las que
mueven datos no contesten sin token, pero solo las que conoce.
