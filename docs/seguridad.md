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

El blindaje contra quien desarma la aplicación desde fuera (2026-11-07) tiene su batería aparte, `pnpm
test:blindaje`, y su sección más abajo: «El blindaje».

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
- **Bitácora de accesos**: cada ingreso, fallo, tablero abierto y cambio de cuenta queda anotado, sin ninguna clave
  —tampoco la que alguien pega donde iba el usuario, que se guarda tapada—, y anotar nunca tumba el login. Solo se
  lee en `/_salud` con su token (`test:accesos`; ver `desplegar.md`).
- **Tablero**: sin token no contesta nada, ni las rutas que mueven datos.
- **Chat público**: corta al mensaje 21 por conversación, rechaza vacíos y enormes, y un identificador de
  conversación inventado no devuelve nada de nadie.
- **Lo que escribe un desconocido**: la función de escape del tablero y de la consola, y que el nombre de quien
  contestó no pueda meter etiquetas (ver abajo).
- **Cabeceras**: `nosniff`, `DENY` y `no-referrer` en la consola y en el tablero; en el despliegue, en TODO lo
  que sale del enrutador, con HSTS, `Permissions-Policy` y CSP (`test:blindaje`).
- **Webhook de Meta**: sin el secreto de la app no se acepta ningún aviso.
- **Exportación**: una fórmula en el nombre sale como texto, y un teléfono sigue saliendo igual.
- **Fuerza bruta**: probar claves a ciegas se frena (esta prueba va la última a propósito: el freno deja
  bloqueado a quien lo dispara). Las tres barreras, una por una y con reloj, en `test:blindaje`.
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
- **El calendario `.ics`** lleva nombre, teléfono y resumen de cada cita detrás de un enlace secreto permanente
  que, por diseño, se pega en Google Calendar o en Outlook.
- **La dirección de quien llama, todavía sin fijar del todo.** Medido el 2026-11-07: el alojamiento AÑADE la
  dirección de verdad al `x-forwarded-for` que mande el navegador, así que el primer elemento lo escribe quien
  llama. El enrutador ya manda hacia adentro una sola dirección y tira `cf-connecting-ip` y compañía, pero cuál
  elemento es el bueno depende de cuántos servidores del alojamiento hay delante: se mide en producción con
  `/_salud` (`tuPeticion`) y se fija con `AIVA_IP`. Hasta entonces se usa el primero, como antes: el tope por
  dirección del chat público y las barreras por dirección del ingreso se esquivan inventándola. La barrera por
  cuenta del ingreso no depende de la dirección.
  🪤 **Si algún día se pone Cloudflare delante** (es la vía para el WAF), la lectura cambia el MISMO día: hoy
  `borde.cjs` tira `cf-connecting-ip` porque cualquiera la puede mandar; con Cloudflare, esa pasa a ser la buena,
  pero solo si la petición viene de sus rangos. Migrar sin eso deja las barreras por dirección esquivables con una
  cabecera, y nada avisa. Lo midió AIVA-CRYPTO en HRC-Check (su proxy hoy limpia la cabecera; con un proxy de
  confianza delante, deja de hacerlo).
- **No hay tope de tamaño de cuerpo** en ninguna ruta: se lee entero y se mide después.
- **`style-src 'unsafe-inline'`, aceptado.** La CSP no deja correr ningún guion sin huella, pero sí estilos en
  línea: las pantallas pintan con `style="…"` en cientos de sitios. Un estilo inyectado desordena una pantalla; no
  se lleva nada.
- **Lo que pone el alojamiento y no se quita desde aquí**: `server: hcdn` en todas las respuestas, y su propia
  `Content-Security-Policy: upgrade-insecure-requests`, que va además de la nuestra. Tampoco hay WAF: llegaría
  poniendo un proveedor delante (Cloudflare o parecido), que es una decisión de infraestructura, no de código.
- **Sin rotación de tokens.** Ni el del tablero ni el del calendario caducan ni se pueden revocar sin cambiar la
  variable de entorno y reiniciar.
- **La consola queda publicada** en el despliegue en paquete: el enrutador manda a la consola todo lo que no sea
  un cliente. Escucha en 127.0.0.1, pero el enrutador está delante. Sin sesión solo se sirve la puerta (el
  formulario de entrar) y el ingreso tiene tres barreras, pero la llave maestra debe seguir siendo larga y
  aleatoria.

## El blindaje (2026-11-07)

Se midió aiva en producción con el verificador del estándar de HRC (`~/proyectos/AUDITORIA-SEGURIDAD.md`), que
nació de una auditoría externa de HRC-Check, y se miró además lo que se aprende de aiva sin entrar. El usuario lo
pidió así: «blindarme ante ingeniería inversa necia». Antes: la portada **7 MAL** y la consola **5 MAL**. En el ZIP,
antes de subir: la portada **0 MAL**. Pruebas en `pnpm test:blindaje`; el recorrido en Chrome contando cada
violación de CSP dio cero.

| Qué | Cómo se explotaba | Dónde |
|---|---|---|
| **El código entero, servido a quien no entró** | `/dunor/admin.js` (387 KB) y la consola (180 KB) se bajaban sin clave, con todos sus comentarios: cada ruta de la API, cada permiso que se comprueba y, en las notas 🪤, dónde estuvo cada fallo. El mapa completo, regalado. Ahora el tablero solo sale por la consola (con sesión), la consola sin sesión es solo la puerta (37 KB), y al ZIP el código va sin comentarios. | `src/borde.cjs` (`cerradoDesdeFuera`), `src/consola.ts` (`partirLaConsola`), `src/afinar.ts` |
| **Lo de servicio, publicado** | `/_salud` sin token contaba la versión, la de Node, qué clientes hay y cuál lleva días sin mensajes; `/<cliente>/_servicio` y `/<cliente>/health`, el estado del WhatsApp, los motores y los modelos. La versión dice qué fallos probar; la lista de clientes, a quién. Ahora `/_salud` sin token dice `{"ok":true}` y lo de cada cliente no pasa del enrutador. | `src/paquete.ts`, `src/borde.cjs` |
| **La dirección de quien llama la escribía él** | La bitácora anotó tal cual una dirección inventada en `x-forwarded-for` (medido en producción). Con eso se esquivan el freno de intentos y la lista de direcciones de la libreta. El enrutador ya manda una sola hacia adentro y tira las que se pueden inventar; falta fijar la posición buena (`AIVA_IP`, ver «Lo que sigue abierto»). | `src/borde.cjs` (`direccionDeQuienLlama`, `sinSuplantar`) |
| **La portada sin una sola cabecera; nada de HSTS, CSP ni `security.txt`** | Cada página se ponía las suyas, y la portada, que es del enrutador, no era de nadie. Ahora todo lo que sale del enrutador pasa por `blindar`: HSTS con preload, `nosniff`, `no-referrer`, `DENY`, ningún permiso del aparato, sin caché salvo que se diga, y una CSP con la huella de cada guion en línea de cada página. | `src/borde.cjs`, `src/cabeceras.ts` |
| **Manejadores en línea** | Con la CSP puesta, un `onclick`/`onerror` escrito en la página no corre. Había tres: dos botones de cerrar del tablero y el logo de cada cliente en la consola, este armado dentro de una cadena de JavaScript — una búsqueda que pedía un espacio antes de `on` no lo vio; lo vio la CSP en Chrome. | `public/admin.html`, `public/consola.html` |
| **La sesión, en el almacenamiento del navegador** | El login la devolvía en el cuerpo y la consola la guardaba ahí, donde la lee cualquier guion que llegue a correr en la página: un fallo de escape se llevaba la credencial a otro sitio. Ahora viaja solo en la galleta (`HttpOnly`, `Secure`, `SameSite=Strict`). | `src/consola.ts`, `public/consola.html` |
| **Salir no borraba la galleta con sus atributos** | Salía `Max-Age=0; Path=/` a secas (medido en producción): borrar no hereda los atributos del alta, y un navegador que los compara puede no darla por borrada. La sesión sí moría en el servidor. | `src/consola.ts` (`quitarGalleta`) |
| **El freno de intentos olvidaba todo en cada despliegue** | Vivía en memoria, con una espera fija y sin la barrera del medio (dirección + cuenta). Ahora son tres barreras (10 por dirección en 15 min, 5 por dirección y cuenta en un minuto, y la cuenta con 1, 5, 15 y 60 minutos), en disco, y todo 429 trae `Retry-After` cuadrado con el texto. | `src/ingreso.ts` |
| **La llave maestra por la dirección** | Se aceptaba en `?token=`, y lo que va en la dirección queda en los registros del alojamiento. Ahora solo por cabecera. | `src/consola.ts` (`quienEs`) |
| **Los errores le contaban al de fuera qué se rompió** | `Falló /ruta: <mensaje interno>`. El detalle va al registro del servidor; afuera, la ruta y la hora. | `src/consola.ts` |

🪤 **widget.js no se minifica.** Sus marcas van dentro de comillas simples y quien las llena escapa para esa
comilla; el minificador las pasa a dobles (un saludo con `"` rompería la cadena) y pliega `'__SALUDO__' || …`.
A ese solo se le quitan las líneas de comentario.

## Si algo de esto cambia

Cualquier pantalla nueva que muestre algo escrito por un cliente final pasa por la función de escape, sin
excepción; el sitio donde falló fue justamente uno que parecía «de la casa» (el nombre de quien contesta). Y
cualquier ruta nueva del tablero o de la consola nace detrás del guardia: la batería comprueba que las que
mueven datos no contesten sin token, pero solo las que conoce.
