# Bitácora de arreglos

Qué se arregló, qué fallaba y cómo se comprobó. Lo más nuevo, arriba. Cada entrada lleva su commit
(`git show <commit>` muestra el cambio completo). El arreglo se commitea primero y su entrada después, con el hash
ya definitivo.

El detalle técnico vive en [`arquitectura.md`](arquitectura.md), lo del tablero en
[`guia-del-tablero.md`](guia-del-tablero.md) y las reglas de diseño en [`diseno-tablero.md`](diseno-tablero.md).

## 2026-11-11

### Renombre completo: también lo de adentro dice XENCRM · `cc2bc9a`
El primer renombre dejó a propósito los nombres internos (variables, archivos, galleta, cabeceras) para no romper
datos ni despliegues. El usuario lo corrigió: «reemplaza todo a xencrm, ya que es una evolución del mismo». Ahora
todo dice XENCRM: `XENCRM_*`, `xencrm.config.json`, `data/xencrm.db`, `xencrm_consola`, `x-xencrm-*`, `xencrm.*` en el
navegador, pm2 `xencrm-<cliente>`, MCP `ask_xencrm`, el widget, y el asistente de fábrica, Xen. 1111 apariciones en
183 archivos, con reglas en orden (lo pegado a un identificador queda en minúscula, la prosa en XENCRM, el asistente
en Xen) y protegido lo que nombra algo de afuera (AIVA-CRYPTO, el repositorio, la carpeta de producción).
- **Lo que git no sigue** se migra con `herramientas/migrar-a-xencrm.mjs`: dice qué haría y con `--aplicar` lo hace,
  con respaldo `*.antes-de-xencrm` de cada archivo de texto. Es idempotente. Se probó primero en una copia de mentira,
  que encontró un fallo (las variables del lanzador de pm2 van dentro de un objeto, no al comienzo de la línea).
- 🪤 **Las copias de los clientes apuntaban a aiva**: `clientes/*/.env` tenía `DB_PATH` y `WHATSAPP_AUTH_DIR` en
  `~/proyectos/aiva/…`. Arrancar la consola desde aquí habría escrito en las bases de aiva. Ahora apuntan a las copias
  de esta carpeta, y la carpeta de aiva no se tocó.
- **Lo que el navegador guardaba** (`aiva.admin.…`, `aiva.consola.…`) se muda solo a `xencrm.…` la primera vez que se
  abre el tablero, la consola o el monitor: se comprobó entrando con las llaves viejas.
- Comprobado: batería completa 2794 bien, 0 fallas; `tsc` limpio; el tablero en Chrome sin errores.

### XENCRM: la siguiente generación, con la piel del modo fácil para todos · `43e7d87` … `b220ed4`
El usuario pidió cambiar la interfaz entera por la del modo fácil, con SendPulse (contactos, ficha, bandeja
omnicanal), ZapFast (bandeja tipo WhatsApp) y Dynamics 365 (IA) de inspiración, renombrar el proyecto a XENCRM y,
sobre la marcha, dejar el lenguaje genérico por el de un CRM de mensajería, una pantalla de sentimiento con emojis
(y la de voz, por desarrollar) y conectar modelos de varios proveedores. La carpeta es una copia de aiva: el remoto
sigue siendo el de aiva y no se subió nada. Todo en la rama `xencrm`; la guía está en `xencrm.md`.
- **Los cimientos** (`43e7d87`): la piel va detrás de `data-piel="xen"`, puesta de fábrica, y el modo fácil queda
  solo para esconder lo avanzado y el candado. Paleta, letras, menú con «Bandeja omnicanal» y «Tratos», y marcas
  para que cada agente rehiciera su pantalla sin pisar a los demás.
- **Seis agentes en paralelo**, cada uno en su worktree: Inicio con el copiloto XEN (`6e4e364`), el renombre con la
  consola y la portada (`fc4b591`), la Bandeja omnicanal (`ea551d8`), Modelos de IA (`6ebc74f`), Analítica con el
  sentimiento (`5339654`) y Contactos, ficha, Tratos y Citas (`864ff21`). Cuatro uniones chocaron solo en la línea
  `test` de `package.json` y una en `test:facil` (los dos agentes le enseñaron a saltarse algo distinto).
- 🪤 **Los worktrees nacieron en `main`, no en los cimientos.** Cada agente lo notó y se movió a `43e7d87` antes de
  trabajar; al encargar trabajo en worktrees, revisar la base de cada rama antes de unir.
- 🪤 **El mismo token, dos valores** (`e0a7314`): la bandeja y Contactos definieron `--fx-av-*` cada uno a su manera
  y la misma persona salía de dos colores. Una sola paleta y un solo cálculo por el id; `test:bandeja` lo vigila.
- **Arreglos heredados de XENCRM que salieron en el camino**: los tonos de las secciones de Hoy iban corridos un puesto
  (la prueba solo contaba cuántos había; ahora compara título por título); Ventas decía «$0» con ventas sin precio;
  la gráfica de orígenes tenía ejes de 7 px; `notifications.ts` decía «Xen» fijo en vez del nombre del asistente.
- **Comprobado**: batería completa 2794 bien, 0 fallas; `tsc` limpio; las nueve pantallas en Chrome a 1440 y 390,
  claro y oscuro, completo y fácil, sin errores de JavaScript ni desborde. Capturas en
  `capturas/xencrm-next-evolution/`.

## 2026-11-07

### Medido en producción, y la dirección de quien llama · `eaced5d`
Subido el blindaje (`c9016c8`), se midió allá: HSTS y nuestra CSP llegan (el alojamiento suma la suya de
`upgrade-insecure-requests`; el navegador aplica las dos); la galleta sale `HttpOnly; Secure; SameSite=Strict` y
se borra igual; `/consola` sin sesión pesa 37 KB y no trae la consola; el tablero solo por la consola, y sin una
nota 🪤; lo de servicio de cada cliente da 404, también disfrazado.
- 🪤 **La cadena del `x-forwarded-for`**, medida con `/_salud` › `tuPeticion` mandando direcciones inventadas: sin
  cabecera llega `R, R,R`; con `F`, `F, R, F, R,R`. Lo del navegador queda siempre antes y la última es la de verdad.
  Esa es ahora la de por defecto (`XENCRM_IP=0`); la cadena medida quedó como prueba en `test:blindaje`.
- **El verificador, corregido por AIVA-CRYPTO** con lo que salió de correrlo aquí: creía la última cabecera repetida
  (la CSP del alojamiento, y no la nuestra), y buscaba `security.txt` debajo de la ruta en vez de en la raíz. Con el
  guion corregido, **portada y consola: 8 OK · 1 MAL**. El MAL es `server: hcdn`, del alojamiento.

### Blindaje contra quien desarma XENCRM desde fuera · `3c96d5d`
El usuario lo pidió así: «blindarme ante ingeniería inversa necia». Se midió producción con el verificador del
estándar de HRC (`~/proyectos/AUDITORIA-SEGURIDAD.md`, salido de la auditoría externa de HRC-Check) y se miró lo que
se aprende de XENCRM sin entrar. Antes: portada **7 MAL**, consola **5 MAL**. En el ZIP: portada **0 MAL**. El detalle,
fila por fila, en `seguridad.md` › «El blindaje».
- **El código ya no se regala**: `/dunor/admin.js` (387 KB, con todos sus comentarios) se bajaba sin clave. El
  tablero ahora solo sale por la consola, la consola sin sesión es solo la puerta (37 KB en vez de 180) y al ZIP lo
  servido va sin comentarios (`src/afinar.ts`; 818 → 564 KB). `TABLERO_DIRECTO=si` reabre el tablero por su ruta.
- **Lo de servicio, cerrado**: `/_salud` sin token dice `{"ok":true}`; `/<cliente>/_servicio` y `/health` no pasan
  del enrutador (tampoco disfrazados: `/%61dmin`, `//admin`).
- **Todo lo que sale del enrutador, blindado** (`src/borde.cjs`): HSTS con preload, `nosniff`, `no-referrer`,
  `DENY`, ningún permiso del aparato, sin caché salvo que se diga, CSP con la huella de cada guion en línea, y
  `security.txt`.
- **La sesión, solo en la galleta** (`HttpOnly`, `Secure`, `SameSite=Strict`), borrada con sus atributos (en
  producción salía sin ellos). Ni en el cuerpo del login ni en el almacenamiento del navegador. La llave maestra ya
  no vale en la dirección.
- **El freno de intentos, de verdad** (`src/ingreso.ts`): tres barreras —dirección, dirección y cuenta, cuenta con
  1, 5, 15 y 60 minutos—, en disco (un despliegue ya no lo borra) y `Retry-After` en todo 429.
- 🪤 **La dirección de quien llama la escribía él**: el alojamiento AÑADE la de verdad al `x-forwarded-for` que mande
  el navegador, y la bitácora anotó tal cual una inventada. El enrutador ya manda una sola hacia adentro; falta medir
  en producción cuál es la buena (`/_salud` › `tuPeticion`) y fijarla con `XENCRM_IP`.
- 🪤 **Lo que vio Chrome y no las búsquedas**: el logo de cada cliente en la consola traía un `onerror` armado
  dentro de una cadena; la CSP lo frenó y quedaba la imagen rota. El recorrido en Chrome por todas las pantallas
  (fácil, completo, consola, monitor, portada, demo y chat) terminó con **0 violaciones de CSP y 0 errores**, y las
  fotos con y sin afinar salieron iguales (solo cambian las horas de los datos de ejemplo).
- `pnpm test:blindaje`: atrapó los 12 errores metidos a propósito; dos se escapaban al principio (dos barreras del
  freno que se tapaban entre sí) y se separaron. Suite completa: 2.558 bien, 0 fallas.

## 2026-11-04

### El modo fácil con el aspecto de Nexora · `7c2f4ec`
DUNOR mandó Nexora (un CRM hecho en ChatGPT) como muestra: «que se vea igual, pero en nuestro producto». Como pide
clave, se armó en local con su propio código público y datos de ejemplo, y se copió pantalla por pantalla.
- **El marco de Nexora**: el menú blanco con *Principal* (Inicio, Analítica, Inbox) y *CRM* (Contactos, Citas,
  Pipeline, Ventas, Seguimientos), la configuración y quién eres abajo; la barra de arriba con el buscador, «Crear»,
  la Ayuda, la campana y tu cuenta. En el celular, el menú se abre desde arriba. Letra Inter, la paleta pizarra y el
  azul 600, con su tema oscuro.
- **Inicio**: cuatro números, cómo va la semana (conversaciones nuevas y citas agendadas por día: `/series` trae
  ahora las citas), cuántos hay en cada etapa, lo último que pasó y el resumen del día. Los recuadros de Hoy con algo
  pendiente siguen, al final, y el resumen lleva a cada uno.
- **Las demás pantallas con su piel**: Inbox en tres columnas con «Tomar control»; Contactos con el buscador debajo
  del título y la ficha completa como página; Citas con sus controles en una tarjeta; Pipeline con columnas grises.
- **El candado deja leer Analítica, Ventas y Seguimientos**, que están en el menú de la muestra; la configuración
  y lo que cuesta XENCRM siguen cerrados.
- 🪤 Fallos que salieron en las capturas y no en las pruebas: Inicio no se escondía al cambiar de pantalla (una regla
  le ponía `display` sin mirar si estaba activa); el arranque se cortaba por una lista usada antes de definirse; en
  el celular el menú salía acostado y sobraba una franja gris abajo (reglas de la barra de abajo del completo); el
  tablero por etapa empezaba corrido (el imán de las columnas); los campos sin `type` salían con el borde del
  navegador. Con el ZIP salieron dos más (`2a3a44e`): la fila de una cita no cabía en el panel de al lado (300 px)
  y las etapas en cero llevaban una rayita. Después se midió que ninguna pantalla se salga de lado, en escritorio y
  en celular.
- **Probado con el ZIP por la consola**, como en producción: bryan entra directo, las ocho secciones cargan, el
  servidor sigue cerrando la configuración y lo que cuesta (403, también fingiendo ser super), «Tomar control»
  funciona, la ficha se cierra al tocar el menú, y el super sigue viendo todo. Sin errores en el navegador.
- **El completo no cambia**: todo vive detrás de `:root[data-modo="facil"]`, y `test:facil` (62 pruebas) lo vigila
  regla por regla. Atrapó los 17 errores que se le metieron a propósito. Suite completa: 2.467 bien, 0 fallas.

## 2026-11-03

### La ficha de cada persona y la entrada directa al tablero · `aaabde6`
DUNOR mandó un audio con lo que quiere en los dos modos. De ahí salió esto:
- **Más datos del cliente.** «Modificar contacto» solo dejaba nombre y teléfono. Ahora la ficha tiene correo,
  WhatsApp (si es otro número), Instagram, Facebook y «Nos contactó por» (`crm.contactoPor`), para todos los
  clientes y en los dos modos: se ven como enlaces y se escriben en *Corregir datos*, en la ficha completa y en
  *Nuevo contacto*. Lo que contó (los campos de cada negocio, en DUNOR las medidas) también se corrige.
- 🪤 **Lo corregido no lo pisa el análisis.** Cada análisis volvía a escribir lo que sacaba de la conversación encima
  de lo que hubiera: una corrección duraba hasta el siguiente mensaje. Lo que escribe el equipo queda en
  `data._amano` y el análisis lo respeta; borrar también lo marca.
- **Se limpia lo pegado** (el enlace de Instagram queda en el usuario, el WhatsApp en dígitos), y lo que no se
  puede limpiar se rechaza entero, sin guardar medio formulario. Se busca por correo o por Instagram, va al final
  del Excel y queda en la historia con quién lo cambió.
- **Entrar directo al tablero.** Quien atiende un solo cliente ya no pasa por la consola ni abre otra pestaña: al
  entrar cae en su tablero. Vuelve a la consola (su Equipo, su cuenta) desde Configuración.
- 🪤 **«Salir» desde el tablero no salía.** Llevaba a `/`, que en el despliegue es la portada, con la sesión abierta;
  con la entrada directa, eso lo devolvía adentro. Ahora cierra la sesión. Y sin sesión el tablero manda a
  `/consola`, no a la portada.
- De paso: la ficha completa mandaba el `data` entero al guardar y podía pisar lo que el análisis captara mientras
  estaba abierta; ahora manda solo el valor.

Comprobado: `test:ficha` (58 comprobaciones), 13 errores metidos a propósito, los 13 atrapados; suite completa
2.397 ✓, 0 ✗. Con el ZIP, por el espejo y con Chrome: una cuenta admin de DUNOR entró por su clave y cayó directo
en su tablero (modo fácil, con candado), guardó correo, Instagram y «Nos contactó por» a través de la consola,
volvió a la consola sin que la devolviera al tablero y «Salir» le cerró la sesión; el super-admin se quedó en la
consola. Cero errores de JS.

### El candado del modo fácil · `33b8188`
DUNOR quiso el tablero mucho más simple y que nadie de su lado se saliera de él. Se le preguntó al usuario quién
quedaba adentro y dijo que todo DUNOR, bryan incluido: solo el super-admin quita el modo y ve lo avanzado.
- **Lo cierra el servidor.** `channels/candado.ts`: la consola manda el rol en `x-xencrm-rol`, de la sesión y no del
  navegador, y con el modo fácil quien no es super-admin solo cambia lo del día a día (una lista cerrada: una ruta
  nueva nace cerrada) y no lee Ventas, Seguimientos, trazas, exportaciones ni el simulador. El modo lo cambia solo
  el super-admin, también en completo: si no, el candado se abría desde adentro.
- **El tablero no enseña puertas cerradas.** Sin la configuración del cliente ni los interruptores propios, sin
  la guía de inicio en Hoy (bryan, por ser admin, la veía y lo mandaba al Perfil), sin «Borrar» una ficha, sin los
  avisos del sistema. `go()` frena las pantallas de quien administra aunque se llegue por un aviso, y la Ayuda
  quita los pasos y las preguntas que llevan a ellas.
- **Más sencillo para todos en el modo fácil.** Sin los cinco números de arriba de Hoy, sin Calientes y Míos en el
  riel (ya son filtros), sin la insignia roja de Seguimientos en Clientes (contaba una pestaña escondida), sin
  «Prospecto claro» ni «Posible prospecto» y sin «Bajar en Excel».
- **La consola** lo pone y lo quita desde «⋯ › Poner el modo fácil» de cada cliente, y la tarjeta dice «modo fácil».
- 🪤 **La pastilla vacía.** «La lleva …» escondido salía como una pastilla vacía en la cabecera de cada
  conversación: `.chip` es `inline-flex` y le gana al `[hidden]` del navegador. Se vio en una captura.
- 🪤 **«Más» en el celular sin íconos.** El primer `iconos()` corre antes de que existan esos botones.
- 🪤 **Dos pruebas que fallaban por fuera del código.** Node 26 (ICU 79) abrevia «sep» y no «sept», y una prueba de
  `proximo` usaba `\w`, que no acepta la tilde de «sáb» ni de «mié»: fallaba solo los días en que hoy más cuatro
  caía ahí.

Comprobado: `test:candado` (82 comprobaciones: la regla, el servidor con cada rol, el tablero con sus funciones
de verdad y la consola), +3 en `test:consola` (el rol sale de la cuenta aunque el navegador diga «super»). 16
errores metidos a propósito, los 16 atrapados. Suite completa 2.339 ✓, 0 ✗. Capturas en Chrome como admin del
cliente en modo fácil, a 1440 y a 390. Con el ZIP y sus dos lanzadores, por el espejo y con Chrome: el super-admin
lo puso desde «⋯» de la consola; una cuenta admin de DUNOR entró por su clave, quedó en fácil y con candado, solo
vio «Tú» y Ayuda en Configuración, y el servidor le negó quitar el modo, Ventas, el Excel, la configuración y
borrar (aunque el navegador mandara `x-xencrm-rol: super`) y le dejó mover la etapa y anotar. Cero errores de JS.

## 2026-10-23

### Lo que salió de la revisión de DUNOR, y el modo fácil · `8fd13b9`
Alguien de DUNOR (por la bitácora de entradas, bryan) dejó un PDF con catorce mejoras. La mitad ya existía y no
se vio porque el tablero estaba sin datos: DUNOR lleva diez días sin recibir mensajes y el Perfil tiene catorce
campos vacíos, que son justo «los 14 datos pendientes» del PDF. De lo que sí tenía razón salió esto:
- **Modo fácil.** El usuario lo pidió así: XENCRM puede seguir con todo, pero DUNOR quiere un XENCRM fácil, con un
  interruptor que no dañe lo hecho. Esconde (no quita) Análisis, Seguimientos, el puntaje y su porqué, «La lleva»,
  el «¿por qué?» de cada respuesta, la configuración del asistente, los filtros de más y los recuadros vacíos de
  Hoy. Lo pone el cliente para su equipo (en su base, no en `xencrm.config.json`, que en Hostinger no se pisa) y
  cada persona puede verlo distinto. Sin decir nada, completo. Reglas en `diseno-tablero.md`.
- **«undefined COP».** Los cinco productos de DUNOR no tienen precio (se define en la cita) y la ficha indexada
  decía «Precio: undefined COP». Sin precio, la línea ya no va; el catálogo que quedó así se reindexa solo al
  arrancar.
- **Mensajes que no salieron.** Se guardaban antes de salir y, si el canal fallaba, quedaban como dichos. Ahora
  quedan marcados con el motivo («WhatsApp no está conectado») y se reintentan desde la burbuja, sin duplicarse.
- **Quién hizo qué.** La historia decía «El equipo» para todo lo que se hacía desde el tablero. La consola manda
  ahora el nombre de la cuenta en `x-xencrm-quien` (y tira lo que mande el navegador), y quedan con nombre las
  etapas, las correcciones de datos, las notas borradas, archivar, unir, entregar y las citas. 🪤 Agendar desde
  el tablero se decidía por `by === 'admin'` para poder caer encima de un evento del dueño: con el nombre real
  eso dejaba de cumplirse, y ahora va con su propio aviso.
- **A cargo.** `users.responsable`: de quién es el cliente, aparte de quién lo atiende ahora, que se borraba cuando
  volvía el asistente y vaciaba «Míos». Lo pone quien toma la conversación si no había nadie, «Entregar a» o la
  ficha.
- **Motivo de pérdida.** Se pregunta, opcional, al pasar a perdido por cualquier camino. Ventas lo resume y cuenta
  aparte las que no dijeron por qué.
- 🪤 **Adjuntos por la consola.** La consola leía el cuerpo como texto y lo reenviaba como JSON: una foto mandada
  desde el tablero abierto por la consola llegaba rota y el cliente respondía «falta el archivo». Ahora va en bytes
  y con su tipo. Bryan entra por la consola.
- 🪤 **Colores de Hoy.** Diez recuadros, nueve colores: desde que entró «Te escribieron en un grupo», cada uno salía
  con el del vecino.

- **Tomar la conversación con nombre** (`597c893`). La prueba del ZIP por la consola enseñó «admin está atendiendo»:
  apretar «Tú» no decía quién. Ahora la toma quien la aprieta, y «Próximo paso» dice «El equipo» si no hay nombre.
  La llave maestra atiende pero no queda a cargo. Y si la respuesta quedó guardada sin salir, el cajón se vacía:
  dejarla escrita invitaba a mandarla dos veces.

Son 94 comprobaciones nuevas en `test:revision` y 9 más en `test:consola`, con un cliente de mentira que devuelve
lo que le llega. Se metieron 28 roturas a propósito y todas las detecta. Las capturas con Chrome, en fácil y en
completo, a 1440 y a 390 px, sacaron dos cosas que ninguna prueba veía: el puntaje seguía en la cabecera de la
conversación (`renderChat` reescribía la clase) y la ventana del motivo salía con el borde negro del navegador.
Batería completa: 2254 ✓, 0 ✗.

## 2026-10-22

### Claude de respaldo: si OpenAI falla, contesta Claude · `b72db16`
En el servidor no corren Ollama ni Apple, así que si OpenAI se caía, rechazaba la llave o se quedaba sin saldo, XENCRM
dejaba de contestar en los tres clientes: la lista de respaldo existía, pero no tenía a quién pasar. Ahora, con
`ANTHROPIC_API_KEY` en el panel, contesta Claude (`src/llm/anthropic.ts`). Usa **Haiku 5.5** para lo de todos los
días y el análisis, y **Sonnet 5.5** para lo específico y para el clasificador, que no baja de categoría ni siendo
el suplente. No se ofrece en la consola: si alguien lo pusiera de titular, dejaría de ser respaldo. Mientras OpenAI
conteste no sale una sola llamada a Claude, y lo que gaste cuenta para el tope de cada cliente.
- **Sin esperar a OpenAI:** si OpenAI se acaba de caer, durante ese minuto va de último en la lista. Antes, cada
  mensaje habría esperado su timeout, hasta 60 s sin red, antes de llegar al respaldo.
- **Sin saldo en OpenAI:** responde con un 429 como si fuera exceso de velocidad. Ahora se reconoce
  (`insufficient_quota`) y deja a OpenAI fuera un rato. Sin saldo en Claude es un 400 «credit balance», con el
  mismo trato.
- **Caché:** con Claude no es automática ni gratis. Guardar cuesta 1,25 × y dura 5 minutos. Se marcan la persona
  (con la ficha completa del negocio, igual que con OpenAI) y el final del historial. Lo del turno va pegado al
  mensaje del cliente, al final, para no romper lo guardado.
- **Gasto:** lo que se guarda en caché queda en `llm_usage.cache_write_tokens`. El informe da las dos cifras: lo que
  ahorró leer y lo que costó guardar. Con mensajes más espaciados que 5 minutos, la caché sale más cara que no
  tenerla.
- **Salud:** con OpenAI caído y Claude arriba, dice «está contestando Claude, el respaldo», no «no puede
  contestar».
- **Probarlo de titular** con las frases de siempre: `pnpm test:scenarios --engine=anthropic`. La llave sale de
  `~/xencrm-credenciales/anthropic.txt`, no del `.env` de la raíz, que leería cualquier prueba.

Son 68 comprobaciones en `test:claude`, con OpenAI y Claude simulados. Se metieron nueve roturas a propósito y
todas las detecta. La primera vez se escapaba una: que Claude no recibiera la ficha completa. Se agregó la
comprobación que la detecta. Batería completa: 2151 ✓, 0 ✗.

## 2026-10-21

### El tablero decía «Xen» aunque el asistente se llamara de otra forma · `7858597`
Salió al probar el paquete antes de entregarlo: ahí el asistente de DUNOR se llama **Arthur**, y Hoy decía «Xen
lleva todas las conversaciones» y «Sin leer, Xen ya respondió». El interruptor de la conversación decía
«Responde: Xen | Tú» y las burbujas del asistente iban firmadas «Xen». Eran nueve textos escritos a mano. Ahora
salen con el nombre de cada cliente, y `test:tablero` revisa todo `admin.js`: falla si vuelve a aparecer «Xen»
fuera del respaldo `state.agentName || 'Xen'`. Una rotura puesta a propósito lo detecta. Batería completa: 2082 ✓,
0 ✗.

### Guía de inicio: los pasos se marcan solos · `b9e6f9d`
El usuario la pidió después de ver la de Vocero: pasos que quedan listos cuando de verdad lo están, con el motivo
exacto de lo que falta. El tutorial de Ayuda no servía para eso: explica el tablero y guarda «ya lo hice» en el
navegador, así que puede decir que algo está hecho sin estarlo. `GET /admin/api/guia` (`src/crm/guia.ts`) mira lo
mismo que el asistente para contestar, sin modelo y sin red:
- **Perfil:** dirección, horarios y formas de pago, que es lo que más preguntan («Faltan los horarios y las formas
  de pago»).
- **Lo que ofrece:** catálogo o información en Lo que sabe. Los **precios** van aparte, opcionales y solo si hay
  productos (al fusionar: con un solo paso, un negocio sin precio de lista nunca completaba la guía).
- **Canal:** WhatsApp recibiendo, o el chat del sitio encendido con la dirección pública respondiendo, según el
  último chequeo.
- **Prueba:** que haya escrito alguien de verdad; la demostración y los grupos no cuentan.
- **Citas:** solo si el negocio agenda. 🪤 El horario siempre tiene valor, el de ejemplo, y el asistente ofrecería
  esas horas como si fueran las del negocio: hecho es que alguien lo haya escrito en el archivo.
- **Nombre** de quien atiende, que se arma en el navegador, y el **calendario**, opcional.

Está en Configuración › Guía de inicio, solo para quien administra. En Hoy, una línea con el siguiente paso y su
botón reemplaza al «¿Primera vez aquí?» mientras falte algo obligatorio; **Ocultar por ahora** la quita una semana,
y el asesor sigue viendo el tutorial. Son 32 comprobaciones en `test:guia` y 7 en `test:tablero`. Dos roturas
puestas a propósito (contar la demo como prueba, enseñarle la tarjeta al asesor) las detecta. Se miró a 1440 y 390
px contra un servidor aparte con una copia de la base, y otra vez ya fusionada con las tarjetas nuevas: con los
datos locales de DUNOR quedan 4 de 6 (faltan el perfil y la dirección pública; los precios, opcionales). Batería
completa ya fusionada: 2080 ✓, 0 ✗, y `tsc` limpio.

### Tarjetas más simples y cuatro arreglos del tablero · `2e4f8ba`
El usuario pidió tarjetas más simples. Cada tarjeta de **Por etapa** llevaba ocho cosas (puntaje, días, nombre,
resumen, próximo paso, quién la lleva, canal, sin leer) más un selector a todo el ancho. Ahora cada pieza sale solo
si dice algo, con la misma regla que ya tenía la lista de conversaciones:
- el puntaje, si es un caliente;
- el próximo paso, si urge o es una cita, y en su propia línea, porque compartiendo fila con el selector quedaba en
  «Atender: l…»;
- el valor, si se sabe;
- quién la lleva, si es una persona.

El canal salió de la tarjeta. Pasó de unos 170 px a entre 108 y 129.
- 🪤 **«Mover…» no se quitó**, aunque era lo que más pesaba. Existe porque en el celular no se puede arrastrar
  (con HRCAPOLO, 2026-09-21). Quedó compacto, al pie, y con 44 px al tacto.
- **Sin precios**, arriba salían dos cifras diciendo «Sin precios». Ahora sale una sola, **Valor en juego**, con
  **Cargar precios**, que lleva a Lo que sabe. «Ponderado por puntaje» pasó a «Probable, según el puntaje».
- 🪤 **La insignia de Seguimientos** solo se llenaba al entrar a Seguimientos, así que quien no entraba nunca veía
  que había calientes esperando. Ahora se pide con las cuentas de la barra.
- **«No pude cargar la imagen»** salía en fotos que se habían borrado a propósito: los archivos viejos se limpian
  para no llenar el disco y el mensaje se queda. Con un 404 ahora dice «Esta foto ya no está guardada».
- **Las «veces» de una respuesta rápida** contaban también las que XENCRM solo propuso mientras la llevaba una
  persona.

Son 10 comprobaciones nuevas en `test:tablero`. Tres roturas puestas a propósito (el puntaje en todas, sin «Mover…»
y la insignia solo al entrar) las detecta. Se miró a 1440 y a 390 px. Batería completa: 2039 ✓, 0 ✗, y `tsc` limpio.

### La franja amarilla vacía arriba de cada conversación · `8abb5ab`
Salió en las capturas para comparar con Vocero: arriba de todas las conversaciones había una franja amarilla sin
texto. Era el aviso de «Camila también está aquí», que debía estar escondido: su clase ponía `display:flex` y eso le
gana al `[hidden]` del navegador. Es la trampa que `test:tablero` ya vigilaba, pero con una lista de cuatro clases
escrita a mano, y esta no estaba. Pasaba igual con la cabecera, los mensajes y el cajón antes de escoger una
conversación. Ahora la prueba mira **todas** las clases de lo que nace con `hidden` en el HTML; con la lista vieja
habría seguido sin verse. Se comprobó en Chrome sin pantalla que los ocho elementos quedan en `display:none`.
- **«La lleva admin»:** cuando la toma alguien sin nombre, el servidor guarda `admin`, y el encabezado lo decía tal
  cual. Ahora dice «La lleva el equipo», como ya lo decía el panel.

### Cuando la lleva una persona, XENCRM deja lista la respuesta a lo que sabe · `fd1055d`
De la comparación con Boba, el usuario tomó lo de «se mete en la charla cuando es útil» y escogió dónde: en la
conversación que lleva una persona, no en los grupos. Hasta hoy XENCRM se callaba del todo ahí. Ahora, si el cliente
pregunta un producto o un dato de la tienda que XENCRM sabe, la respuesta queda escrita encima del cajón con el título
*Xen puede contestar esto*. Quien atiende la envía, la corrige o la descarta, y la conversación sigue siendo suya.
Es la misma propuesta del modo «Propone», marcada `con_persona`.
- **Nunca escribe sola ahí:** ni la respuesta ni el «dame un segundito», que se colaba igual que en «Propone».
- 🪤 **Solo lo que sabe:** un «déjame verificar», una cifra o una afirmación sin respaldo, una promesa o una cita
  inventada no se dejan, y tampoco abren *Por verificar* ni avisan. Saludos, citas y «quiero hablar con alguien»
  no se redactan.
- 🪤 **Sin reintentos:** fuera de este modo, lo que no se sostiene se rehace pagando otra llamada. Aquí no: una
  redacción por mensaje como máximo, más el clasificador (que no se tocó). Una cita a medias o el tope de gasto
  cortan antes, sin gastar nada.
- **Sin campana:** la persona ya recibió el mensaje del cliente; la propuesta aparece en la conversación y punto.
- **Si contesta con sus palabras**, lo que XENCRM dejó se aparta, en vez de quedarse diciendo «se quedó atrás».
- Se apaga por cliente en **Configuración › El asistente › Cuando la llevas tú** (`PUT /admin/api/agent/sugiere`). Viene encendido.

Son 47 comprobaciones en `test:sugiere`, y dos roturas puestas a propósito (el aviso sin el freno, rehacer lo que
no tenía respaldo) las detectan. Con el ajuste apagado todo es como antes: callada, sin una llamada al modelo.

### Más sencillo para quien empieza: el perfil al lado del chat y cinco secciones · `4ed68be`
Al usuario le dijeron que XENCRM es «complejo de usar» y le sugirieron la cara de Vocero, con su insistencia en «el
perfil del cliente». Comparado con capturas de los dos, el perfil ya existía y era mejor que el de Vocero, pero
estaba escondido: al lado de la conversación había un formulario. Ahora ese panel es el perfil (quién es, qué
quiere, Detalles, «Lo que contó», citas, historia) y el formulario quedó detrás de **Corregir datos**. El riel bajó de
ocho secciones a cinco, y Prospectos, Seguimientos y Ventas son pestañas dentro de Clientes y Análisis: el usuario
pidió que no se viera cargado pero que quien sepa pueda «necear para exprimir XENCRM». Detalle en
`diseno-tablero.md` › «Más sencillo para quien empieza».
- 🪤 **Tarjetas aplastadas en Por etapa:** con una columna llena, cada tarjeta medía 48 px y su contenido 166. Venía
  del `overflow:hidden` de la piel del 2026-10-02, y DUNOR lo tenía así en producción.
- 🪤 **El panel borraba lo que se escribía:** se repinta con cada análisis. Una nota a medias o un nombre corregido
  se perdían en mitad de la frase. Ahora se guardan y se devuelven, solo si es la misma persona.
- **Visitantes y datos con nombre de persona:** «Visitante del sitio · 44fa» en vez de «web · 44fa379b», y
  «Ocasión» en vez de «ocasion». El borrador para retomar saluda con el nombre de verdad, no con «Hola Visitante».
- **En el celular** el perfil tapaba la conversación sin forma de volver; ahora tiene **‹ Volver a la conversación**.

Son 15 comprobaciones nuevas en `test:tablero`. Tres roturas puestas a propósito (sin `flex-shrink:0`, sin devolver
los borradores, sacando Seguimientos del área) las detecta. Se miró con capturas de Chrome sin pantalla a 1440 y a
390 px, y en el navegador se probó el repintado: con un análisis disparado a mano, el nombre a medias, la nota y
los desplegables abiertos siguen ahí, y al abrir otra conversación no se arrastra nada. Batería completa: 1974 ✓,
0 ✗, y `tsc` limpio.

## 2026-10-19

### Quién entró a la consola, en `/_salud` con su token · `5b9fa5b`
El usuario le pasó su acceso a DUNOR y preguntó si habían entrado. No había forma de saberlo: las sesiones y los
fallos viven en memoria y de un ingreso no quedaba nada. Pidió verlo en `/_salud`, con un token guardado en este
Mac que yo pueda leer. Ahora la consola anota en `accesos.jsonl` cada ingreso, cada fallo y su motivo (clave
equivocada, cuenta desactivada, usuario que no existe, frenado), cada tablero abierto, cada salida y cada cambio de
cuenta, con dirección y navegador. `/_salud` lo trae con la cabecera `x-salud-token`, y `pnpm salud` lo pinta en hora
de Colombia (`--usuario`, `--seguir`).
- **El token:** `pnpm paquete` lo creó en `~/xencrm-credenciales/salud-token.txt` y al ZIP va solo su huella, así que
  no hay variable nueva en el panel. Abre `/_salud` y nada más.
- 🪤 **Lo escrito como usuario:** si no es una cuenta que exista, va tapado (`cl…(18)`), porque es donde la gente
  pega la clave por error. Ninguna clave entra al archivo, y anotar nunca tumba el login.

Son 42 comprobaciones en `test:accesos`. Tres roturas puestas a propósito (sin tapar, anotar cada llamada del
tablero, escribir el cuerpo del cambio) las detecta. El paquete se probó con dos lanzadores a la vez, como arranca
Hostinger: por el espejo y por el que manda se lee lo mismo, sin token o con uno equivocado no sale nada, y en el
archivo no hay ninguna de las claves usadas. El dueño de prueba entró en Chrome sin pantalla y quedó anotado.

### Desplegado `7adbbec` y revisado en `/_salud`
El usuario subió el paquete en la mañana. `/_salud` contesta `7adbbec` en Node 24, y en el sondeo todos contestan:
los cuatro procesos van por socket. Respondió un espejo del lanzador 1446257, que es el doble arranque de siempre
(ver `desplegar.md`). Que el lanzador con el mando también corre el código nuevo se ve en la consola, que ya sirve
«Crear acceso». En el login de producción, con el `Origin` del dominio, un usuario inventado da 401: llega hasta
comprobar la clave y el filtro de origen no lo frena. El Chrome sin pantalla no pasa de la verificación de Hostinger
(«Checking your browser…»), y eso no se esquiva. La entrada en un navegador de verdad la hace el usuario.

### El mensaje de acceso apuntaba a la portada · `7adbbec`
Salió al revisar el despliegue, antes de armar el ZIP. En el paquete la consola vive en `/consola` y la raíz es la
portada, pero el mensaje de acceso mandaba a la raíz: el dueño del negocio iba a llegar a una página sin dónde poner
usuario y clave. Ahora lleva la dirección de la página en la que se creó. El paquete se probó como lo arranca
Hostinger (`require('./app.js')`):
- Entrar con el `Host` y el `Origin` del dominio da 200, y desde otro sitio da 403.
- En Chrome sin pantalla, el super-admin le creó el acceso a DUNOR desde su fila, y el enlace salió `…/consola`.
- El dueño entró, solo ve DUNOR, creó una asesora y abre su tablero (200). No abre el de CONFIA (403) ni cambia
  motores por la segunda puerta (403).

## 2026-10-16

### El acceso de cada cliente, desde su fila · `59c15f8`
El usuario entraba a xencrm.confiafintech.com como super-admin, pero no sabía con qué usuario y clave entraba cada
negocio. Lo primero no estaba a la vista y lo segundo no se puede saber: se guarda la huella, no la clave. Ahora
cada fila de Clientes dice `admin: <usuario>` o **sin admin del cliente** en rojo. En **Ver más › Quién entra a este
cliente** se crea el acceso (si no hay admin, viene marcado ese rol), se le pone una clave nueva a alguien y se
cambia el rol. La clave la propone la consola: doce caracteres del azar del navegador. Se ve una vez, dentro de un
mensaje listo para copiar, y se borra al cerrar. Equipo usa el mismo diálogo en vez del `prompt()`. 🪤 Si la lista
del equipo no llega, no se dice «sin admin», porque sería mentira. De paso, el repintado de cada minuto cerraba
«Ver más» y borraba lo que se estuviera escribiendo dentro; ya no. Visto en Chrome sin pantalla como super-admin y
como admin del cliente. Con la clave nueva se entra (200), la vieja ya no sirve (401) y «Ver más» sigue abierto
después del repintado. Son 4 comprobaciones nuevas en `test:tablero`.

### El admin de cada cliente maneja a su gente · `52a46b0`
El usuario no podía darle al dueño de DUNOR una cuenta con la que creara a sus empleados: había dos roles, y Equipo
era solo del super-admin. Ahora hay tres. El **admin del cliente** abre Equipo, ve a la gente de sus clientes y
crea asesores u otros admins de su negocio, les cambia la clave, los desactiva o los quita. El **asesor** hace lo
mismo que hacía «Atiende» (todo en su cliente menos Equipo), como lo decidió el usuario. Quien tenía `agente` quedó
como admin del cliente para que nadie perdiera nada al desplegar. 🪤 Al super-admin y a quien atiende además otro
negocio, el admin del cliente los ve solo por su nombre: mostrarle sus clientes le contaba qué otros negocios tiene
XENCRM. Si intenta tocarlos, recibe «no existe». Tampoco puede bajarse ni desactivarse a sí mismo. Son unas 40 comprobaciones
nuevas en `test:usuarios`. Visto en Chrome sin pantalla como dueño, asesora y super-admin: la casilla que el
servidor rechaza vuelve a como estaba.

### Lo de XENCRM pasaba por la segunda puerta · `52a46b0`
Motores, la clave de OpenAI, el tope de gasto y encender la retención solo se frenaban en `/api/c/<slug>/…`. Por
`/c/<slug>/admin/api/…`, la que usa el tablero abierto desde la consola, alguien con «Atiende» los cambiaba. La
clave no se podía leer (sale tapada), pero sí reemplazar. Se comprobó pasando antes de tocar nada (502 en vez de
403) y frenado después. Las dos puertas usan ahora `vedado()`, y `test:seguridad` prueba la segunda. Una ruta
codificada (`%6Dotores`) no lo esquiva: llega decodificada al freno. **Está en producción hasta el próximo
despliegue.**

## 2026-10-12

### Desplegado `53693f6` y revisado en `/_salud`
El usuario subió el paquete en la tarde. `/_salud` contesta `53693f6` en Node 24, con el enrutador en 67 MB y los
cuatro procesos vivos, sin caídas y con un solo arranque cada uno. La portada, la consola y los tres tableros
responden 200. El primer vistazo dio otra hora de arranque, cuatro segundos antes: es el doble arranque del
alojamiento que explica `desplegar.md`, y después se quedó quieto. Los avisos de DUNOR, sin mensajes hace 3 días, y
de HRC, sin mensajes hace 17, vienen de antes del despliegue: no los causó este cambio.

### Los fijados en la base de cada cliente · `0f4c870`
Vivían en el navegador y no seguían a nadie a otro computador. Ahora van en `settings` con el nombre con el que
responde cada quien, como «Míos». Lo que estaba en el navegador se sube solo la primera vez. 🪤 Un identificador de
WhatsApp es un teléfono: al borrar, anonimizar o unir una ficha se quita de los fijados de todos, o la retención
dejaría el número guardado en los ajustes. Tres roturas a propósito, tres fallos. Visto en Chrome con dos
navegadores.

### El color de la consola, a gusto de cada quien · `95e4964`
El usuario la prefiere en azul y pidió que fuera de cada perfil. En Mi cuenta se escoge entre azul, dorado, grafito
y morado. Se ve al instante, y si se cierra sin guardar vuelve el que estaba. El azul no se guarda. Los cuatro
medidos sobre 4.5:1. 🪤 Al guardar Mi cuenta, el botón del perfil se quedaba en texto plano, sin la inicial ni la
flecha.

### La portada, con la mitad del texto · `08ddbb7`
El usuario la sintió con mucho texto: 385 palabras, casi todo párrafos. Ahora cada sección dice una cosa en una
línea y quedan menos de 250. Lo que decían los párrafos lo enseña una vista del tablero hecha con HTML. Los pasos
pasan a una fila de verbos. `test:tablero` avisa si vuelve a pasar de 260 palabras, y falla con la portada vieja
(365 contadas así). Vista en Chrome a 1340 y 390 px.

### La consola, con la misma piel del tablero · `8b1a237`
La consola seguía con crema, dorado, vidrio y hojas de bloc, y el tablero es blanco y azul desde el 2 de octubre:
abrir uno desde la otra se sentía como cambiar de producto. Ahora hablan igual por dentro. La fila de cada cliente
deja a la vista «Abrir tablero» y «Ver más»; lo de una vez al mes pasa a «⋯». 🪤 La entrada no cambia, porque es
el puente desde la portada: los colores nuevos mandan solo con la aplicación a la vista. 🪤 Había media hoja de
estilos copiada dentro de la regla del celular. Dos roturas a propósito en las comprobaciones nuevas, dos fallos.
Visto en Chrome a 1340 y 390 px.

### El orden de un CRM en el tablero · `b21f93d`
El usuario vio un CRM tipo Attio y le gustó. Se quedó el estilo de hoy y se tomó del video lo demás. Cada ficha trae
su **próximo paso**, escrito con reglas y sin modelo, y su **valor**. Clientes tiene pestañas con su número, orden
por columna y suma al pie. Prospectos tiene cifras arriba y suma por columna. La ficha va en dos columnas, con
historia, notas con autor y fecha, «3 de 23» y fijar. La barra lleva números, las listas *Calientes* y *Míos* y los
fijados. 🪤 La lista de contactos ignoraba el `limit` y devolvía 200 aunque se pidieran 500, sin decirlo. 🪤 El dinero
salía siempre en pesos. `test:proximo` comprueba que «Retomar» coincida con Seguimientos. Tres roturas a propósito,
tres fallos. Visto en Chrome a 1340 y 390 px, en claro y oscuro.

### Sedes al dar de alta un cliente, y sin sedes ni una palabra de sedes · `cc155fa`
El alta de un cliente no preguntaba sedes: se ponían después, en El negocio. Ahora la consola, `pnpm cliente nuevo` y
`pnpm onboard` las aceptan, una por línea con el nombre y la dirección. Una línea sin nombre se rechaza antes de
crear la carpeta. 🪤 Vacío, que es lo normal, no escribe la clave `sedes`: sin sedes, nada de lo que ve el modelo
dice «sede» y al agendar no se pregunta en cuál. No hay una instrucción de «no hables de sedes», que sería gastar
tokens en lo que no existe. `test:sedes` lo fija y falla si `sedesComoInformacion` dice algo sin sedes. Visto en
Chrome: el alta con dos sedes deja `norte` y `centro` en la configuración.

### Retención automática de conversaciones · `a3044d6`
Quedaba pendiente desde el brief: un CRM que guarda para siempre el nombre, el teléfono y todo lo que alguien
escribió hace años. Ahora las conversaciones quietas se anonimizan o se borran solas. Viene apagada y la enciende el
super-admin en la consola, viendo antes cuántas tocaría; el negocio la ve en su tablero y no la puede cambiar.
Anonimizar deja las cuentas del embudo y del gasto con otro identificador. 🪤 Sin un respaldo de menos de un día no
toca nada, no toca a quien tiene una cita por delante y nunca baja de 90 días. La prueba recorre la base entera
buscando el nombre, el teléfono y el correo después de anonimizar. Siete roturas a propósito, siete fallos. Visto
en Chrome: la vista previa, guardar, la pasada y el panel del tablero.

### El calendario de una sede ocupa solo esa, y quien se crea a mano llega a una · `b45bbfb`
El calendario personal ocupaba todas las sedes. Ahora cada sede puede tener el suyo en `CALENDAR_BUSY_ICS_<SEDE>`,
que solo ocupa esa; el general sigue ocupando todas. 🪤 En el `.env`, no en la configuración: son direcciones
secretas. El tablero pinta los bloques de la sede que se mira. Y crear a mano a una persona ahora pregunta a qué sede
llegó, para que no salga «sin sede» en Prospectos. Visto en Chrome con un calendario de Buenavista servido por HTTP.

### La consola ya no grita «no contesta» por una dirección que nadie configuró · `9554254`
Cualquier estado de la dirección pública distinto de «ok» era «Su dirección pública no contesta», urgente: también
no tenerla configurada y una falla suelta que la instancia todavía no da por caída. Ahora solo «caída» es ese ticket,
«contesta desde otro servidor» se dice así, y lo demás no es ticket. Cuatro casos nuevos en `pnpm test:consola`.

### A un «hola» no se le contesta «dame un segundito que lo consulto» · `eebcd58`
El aviso de demora salía siempre que el turno iba al pesado, también cuando iba ahí porque el otro motor estaba
caído: un saludo recibía «dame un segundito que lo consulto». Ahora sale solo si el pesado es por lo que pidió el
cliente. Salió en el «¿por qué?» de una conversación de prueba sin OpenAI.

### La fecha del formulario de agendar, como los demás campos · `ff21b08`
El campo de fecha quedaba suelto al lado de su etiqueta, sin el borde de los selectores. Ahora mide y se ve igual.

### El recordatorio cuenta los días en la hora del negocio · `bc7771c`
🪤 El día de la semana salía de `getDay()`, en la hora de la máquina. En un servidor en UTC, un recordatorio a las
7:30 p. m. de Bogotá ya es el día siguiente, y un domingo cerrado pasaba por un lunes abierto. Ahora se cuenta en la
hora del negocio; probado con `TZ=UTC`. De paso, el recordatorio a mano decía «La conversación la lleva bot» cuando
el traspaso lo hizo el asistente, y el README seguía diciendo que el recordatorio sale el día antes a las 5 p. m.,
cuando desde el 3 de octubre sale la mañana de la cita. Las dos pruebas nuevas fallan con el código de antes.

### Los escenarios de DUNOR esperan la cancelación de hoy · `c1d4c67`
Dos turnos de los escenarios esperaban «¿confirmas que cancelo?», que dejó de existir el 3 de octubre con la
retención de citas. Ahora esperan la pregunta de qué pasó y la cancelación cuando el cliente insiste. Con Gemma,
40 de 40.

### Una clave o una tarjeta escrita en el chat no se guarda ni llega al modelo · `ce06a07`
«Mi clave es 4567, no puedo entrar» quedaba en claro en el CRM y se le mandaba a OpenAI; el tapador que existía solo
corría en los chats importados. Ahora una clave, un PIN, un código de verificación, una llave o una tarjeta se tapan
antes de que nada los lea, y otra vez al guardar cualquier mensaje. El asistente le pide al cliente, con tacto, que
no los mande por el chat. 🪤 No sirve el tapador de los importados: también tapa «Correo:» y borraría el correo de
la cita. Una tarjeta se reconoce por longitud, red y dígito de control juntos. `pnpm test:claves` (21 casos).

### Cada respuesta con su «¿por qué?», y la versión que corre a la vista · `fa9fb3f`
«¿Por qué le contestó eso?» se contestaba con logs que se perdían al reiniciar. Ahora cada mensaje corre en un turno
que se guarda 90 días: qué entendió, la ruta, el motor y el modelo, cuánto tardó, qué guardas saltaron, cuánto costó,
la huella del prompt y la versión. Sus llamadas al modelo y sus mensajes llevan el mismo id, que viaja solo con
AsyncLocalStorage. Quien administra tiene **¿por qué?** debajo de cada respuesta. 🪤 El análisis que deja
programado un turno corre fuera de él, para que su gasto no se le cargue a esa respuesta. La versión sale de git o
del `version.json` que ahora deja `pnpm paquete`, y la dicen `/_salud`, el lanzador, la consola y cada turno.
`pnpm test:turnos` (20 casos) y visto en Chrome con una conversación real contra Gemma.

### Varias sedes con un mismo número · `dba1be5`, `4bc5cf7`, `387fd4f`
Un negocio con varias sedes y un solo WhatsApp tenía que escoger entre varios números o un asistente que no sabe a
cuál mandar a cada quien. Ahora las sedes van en su configuración, con nombre, dirección, apodos y, si cambia, su
propio horario y cupo. El asistente pregunta en cuál antes de ofrecer horarios, entiende «la del norte» o «la de la
72», ofrece los espacios de esa sede y, si lo pedido no existe ahí pero sí en otra, lo dice y ofrece la otra. La
confirmación, el recordatorio y el calendario dicen la dirección, y el modelo ve las sedes para «¿dónde quedan?».
En el tablero, el calendario y Prospectos filtran por sede, agendar a mano la pide y se editan en El negocio. 🪤 Una sede no es
otro cliente; si el mensaje nombra dos sedes se vuelve a preguntar, y una sede con citas por delante no se puede
quitar. Al probarlo en Chrome salió que «la del centro comercial» nombraba también a «la del centro»: ahora vale el
apodo más largo. `pnpm test:sedes` (49 casos, sin modelo) y visto en escritorio y celular.

### En el celular, el panel de agendar ya no tapa las citas · `ed54349`
En el calendario del celular, la lista de citas podía quedar más baja que su contenido y el panel de agendar se
montaba encima: del día se veía la primera cita a medias. Ya pasaba antes de las sedes; salió al revisarlas. Con
las filas al alto de su contenido, medido en Chrome en Agenda y en Semana, el calendario termina antes del panel.

### Cada cliente con su tope de gasto de IA, y nadie sin respuesta al llegar · `148e438`
El gasto se medía pero nada lo frenaba, y es lo primero que pregunta quien pone su propia llave de OpenAI. Ahora cada
cliente tiene un tope en dólares al mes, que pone el super-admin en Configuración › Motores y se aplica al instante.
Al 80 % avisa por la campana, la consola y WhatsApp; al 90 % lo específico pasa al modelo barato; al 100 % no sale
ni una llamada a la IA de pago, lo que se resuelve sin IA sigue y lo demás pasa al equipo con aviso al cliente. Si
hay un motor en la máquina, contesta ese. 🪤 Mes calendario en la hora del negocio, no los últimos 30 días, y el
freno de último recurso está en el motor, para que ningún camino olvidado se lo salte. `pnpm test:presupuesto` (52
casos, cada llamada contada) y visto en Chrome en escritorio y celular: la tarjeta, guardar desde ella, el panel de
Consumo del tablero y la campana.

### La sigla del cliente vuelve a salir cuando su logo no carga · `abffeb4`
El respaldo del logo en la lista de clientes armaba su `onerror` con las comillas de `JSON.stringify` dentro de un
atributo con comillas: el navegador no lo podía leer y quedaba la imagen rota. Salió al revisar la consola en Chrome
para el tope: un cliente sin archivo de logo daba «Unexpected end of input». Escapado, sale la sigla y ningún error.

### Lo que las reglas prohíben ya no lo respaldan, y la plata no se promete · `459ea37`
🪤 Las guardas de «no inventa» medían el respaldo contra la persona entera, y la persona nombra wifi, parqueadero,
mascotas, descuentos y envíos como ejemplos de lo que no se supone. Esas palabras respaldaban: «¿tienen wifi?»
contestado con «Sí, tenemos wifi» pasaba en producción desde el primer commit, y las pruebas no lo veían porque
medían contra la información sola. Ahora el respaldo es lo que se sabe del negocio. Encima, lo que pide el brief
de agentes sobre inyección de prompt: un descuento, un porcentaje, algo gratis o un precio regateado que la
información no ofrece no sale, una respuesta que recita las instrucciones se cambia por una fija, y el nombre y la
información entran como datos. `pnpm test:inyeccion` (65 casos) pasa el recorrido entero con un modelo falso que
siempre se deja convencer; quitar cualquiera de las cinco defensas la hace fallar. Sobre 93 respuestas reales de
DUNOR, HRC y CONFIA, ninguna queda marcada de más. Escenarios de DUNOR con Gemma, porque OpenAI no estaba
disponible: 38 de 40, y los dos que fallan ya fallaban (la retención de citas del 3 de octubre cambió el texto de
cancelar).

### WhatsApp oficial no atiende dos veces lo que Meta manda dos veces · `2bf1951`
Meta advierte que una notificación puede llegar más de una vez y reintenta durante días. El mismo «hola» entraba
dos veces y se contestaba dos veces, o se volvía un «hola\nhola». El id de cada mensaje queda 7 días en la base, no
en memoria, porque un despliegue es justo cuando Meta reintenta. De paso, en «Mira» y «Propone» el canal ya no
marca leído, no muestra «escribiendo…» ni contesta «solo puedo leer texto», igual que WhatsApp por QR. Baileys
queda fuera a propósito: no hay repetidos en las bases y puede entregar el mismo id al descifrar.
`pnpm test:repetidos` (18 casos, contra la ruta de verdad y con firma de Meta).

## 2026-09-25

### Con quién firmas es de cada cliente, y varias personas caben en un chat · `d93506e`
🪤 El nombre con el que se responde era **uno solo para todos los clientes**: poner "Arthur" atendiendo a la
boutique lo dejaba firmando en la financiera. Ahora vive dentro de la conversación y se guarda por cliente. De
paso, el botón de la cuenta dice tu nombre y abre Mi cuenta, y el correo de cada quien se edita en la fila de su
cliente. Y lo nuevo: la conversación lleva **quiénes están metidos ahora mismo**, en la consola y en el tablero,
con aviso de «Camila también está aquí»; no bloquea a nadie, avisa. Caduca sola a los 3 minutos porque quien
cierra la pestaña no avisa. `pnpm test:presencia` (13 casos) y comprobado sobre el paquete con dos personas.

### Cada cliente se estira con su micro-tablero y su equipo · `fd085a2`
La fila decía qué atender pero no cómo iba el negocio: ahora **Ver más** abre mensajes de hoy, conversaciones,
calientes, puntaje promedio, cuántas llegaron a cita, cuántas se ganaron, efectividad y gasto de IA. La
efectividad se calcula por el **papel** de las etapas (`cita`, `ganado`), no por su nombre, que cada negocio las
llama distinto. Debajo, quién lo atiende, con cambiar clave, quitar y asignar a la mano.

### El tablero ya no pide token entrando por la consola, y no se moría al cargar · `d907f47`
Dos cosas encadenadas. El tablero, sin token guardado en el navegador, ni lo intentaba: enseñaba su pantalla de
token, aunque entrando por la consola no hace falta ninguno. Y peor: el diálogo de configuración había quedado
**después** del `<script>`, así que `$('cfg-cerrar').onclick` reventaba con null y se caía el JavaScript entero
del tablero. Lo que se veía era la pantalla de token porque no arrancaba nada.

🪤 El HTTP daba 200 y el HTML era correcto: ninguna prueba lo vio. Salió abriendo la página en un navegador de
verdad con la sesión puesta, con `node herramientas/mirar.mjs`, que imprime los errores de JavaScript. Una
pantalla nueva no está probada hasta que se abre en un navegador.

### El tablero del cliente, con el lenguaje de la casa · `2270c30`
Se pasaba de la consola a un tablero verde con vidrio esmerilado y se sentía otra aplicación. Cambiado por los
tokens, no regla por regla: acento dorado, papel cálido, Figtree, y el vidrio de 24 px de desenfoque a 14. El
verde se queda donde significa algo. Contrastes en `docs/diseno-tablero.md`.

### Perfil y El negocio se abren en un modal · `a4627c1`
Eran dos páginas largas a las que había que navegar. Son configuración: ahora un modal de dos pestañas encima de
lo que estabas haciendo, con los campos cortos en dos columnas.

### Atender es un tablero por columnas · `a67eeb6`
La bandeja era una lista donde todo pesaba igual. Ahora tres columnas —piden una persona, no supo, esperan
respuesta— con su cuenta, lo que más ha esperado arriba, y la conversación en un panel al lado.

### La consola y la portada, con la marca de HRC · `26183ff`, `f99de66`
La portada salió calcada de otros sitios de la casa y en oscuro; rehecha en claro con Figtree, el dorado y el
logo. La consola iba por su lado: entrar es una pantalla partida, y los clientes pasan de tarjetas a filas con su
vistazo.

🪤 De ahí salieron dos trampas de CSS que dan el mismo síntoma: un `display` suelto le gana al `display:none` que
el navegador pone en `[hidden]` y en un `<dialog>` cerrado. Está en `docs/diseno-tablero.md`.

### Mi cuenta, y usuarios con correo · `7d52b8c`
Para cambiar una clave había que ser super-admin. Ahora cada quien se cambia su nombre, su correo y su clave
—pidiendo la actual—, y quien tenga correo puede entrar con él.

### El empaquetador borra solo lo que él crea · `9934d5f`
`pnpm paquete` barría `paquetes/` entera y se llevó por delante unas credenciales que había dejado ahí. Ahora
borra su directorio de trabajo y el zip, nada más. Las credenciales de la máquina viven en `~/xencrm-credenciales`.

### La configuración de cada cliente se edita desde el tablero · `4afb5eb`
Nombre, asistente, marca, zona horaria y citas salían del archivo a mano. Se validan con el mismo esquema con el
que se leen al arrancar, se guarda copia del anterior, y como la configuración se lee al arrancar, el tablero
avisa que hay cambios sin aplicar y ofrece reiniciar donde hay quien lo levante.

### El tablero de cada cliente se abre desde la consola · `d16085e`
Entrar como super-admin y que el cliente pidiera otro token rompía el modelo. La consola sirve el tablero en
`/c/<slug>/admin` y le pone el token al pasar; la sesión viaja en una galleta porque una navegación y un
EventSource no pueden poner cabeceras.

## 2026-09-24

### Una portada en la raíz, y la consola en /consola · `becf4b0`
El dominio pelado mostraba la consola: quien llegaba se topaba con una pantalla de trabajo pidiendo clave. Ahora
la raíz explica qué es XENCRM y la consola vive en `/consola`; la sirve el enrutador mismo, sin proceso extra, y las
llamadas de la consola siguen saliendo de la raíz. Salieron tres cosas más al probar el paquete: un cliente
llamado "consola" o "api" habría quedado tapado por el enrutador (ahora se rechaza al crear); los motores
arrancan en OpenAI solos, porque en un hosting de apps no hay Ollama y una variable olvidada dejaba al cliente
esperando un modelo que no existe; y **WhatsApp arranca apagado**, que antes los tres clientes escupían el QR al
primer arranque. Comprobado con el ZIP descomprimido aparte: `/`, `/consola` y `/<cliente>/health` dan 200,
`/dunor/admin` carga su JavaScript y lo que no existe da 404. `pnpm test:clientes` con dos casos nuevos.

🪤 Lo que costó media hora: una prueba anterior seguía viva en el 3500 y las peticiones le llegaban **a la
vieja**, que no conocía a dunor. El paquete estaba bien desde el principio. Antes de probar,
`lsof -ti :3500 | xargs -r kill -9`.

## 2026-09-22

### El embudo lo pone cada negocio · `0a03709`
Las etapas estaban fijas en el código ("cita_agendada", "vendido"): con eso, una financiera o una litografía
entraban con el embudo de una boutique. Ahora salen de `crm.stages`, con un **papel** por etapa (inicio, activo,
interés, cita, ganado, perdido) que es lo único que el código conoce; los nombres los pone el negocio. Sin etapa
de "cita", simplemente no agenda. El tablero pinta por papel y esconde los filtros que no apliquen, y una ficha
con una etapa que ya no existe cae a la primera sin romperse. El alta arranca preguntando **cómo atiende el
negocio** con tres plantillas —citas, soporte y cotización—, cada una con su embudo, si agenda y qué datos
captura. `pnpm test:etapas` (14 casos con un negocio de soporte), `test:clientes` (8 nuevos) y las 27 suites; el
tablero de DUNOR quedó idéntico.

### Del historial también sale cómo hablan sus clientes · `ee73db8`
Segundo paso: además de las preguntas, del historial salen las frases que sus clientes usan y el asistente no
entiende. Las fechas a la colombiana se agrupan por **la frase de tiempo**, no por el mensaje, así que "¿me pueden
atender de hoy en quince?" y "paso de hoy en quince entonces" son una sola cosa que enseñar; y las palabras que
repiten y no están en el catálogo, el perfil ni el diccionario se proponen aparte ("terno"), con las de tiempo
filtradas para que "quince" no parezca un producto. Nada se aprende solo: pasan a *Frases que no entendimos*, donde
alguien les pone el significado y solo se guardan si con eso las reglas ya entienden. Probado de punta a punta:
propuso "terno", al enseñarlo las reglas pasaron a leer "¿tienen terno para grado?" como una pregunta por el
catálogo. `pnpm test:historial` (29 casos) y 29 suites.

### Aprender del historial: las preguntas, no los precios · `46807cf`
Un cliente nuevo llegaba con el Perfil en blanco aunque tuviera meses de WhatsApp conversado. Ahora ese historial
se puede traer —el `.txt` de "Exportar chat" o la sincronización al vincular el número— y de ahí salen **las
preguntas que más le hacen** (agrupadas por las palabras que comparten: "¿hay parqueadero en la tienda?" y
"¿tienen parqueadero por ahí?" son un solo tema) y **una muestra del tono**, que descarta entera cualquier
respuesta con cifras. Aceptar un tema lo escribe en el Perfil como dato *por confirmar*: el historial pone la
pregunta, el negocio pone la respuesta de hoy. El historial vive en su propia tabla y **nunca** entra al índice de
conocimiento, que es lo que evita repetir un precio vencido con autoridad. `pnpm test:historial` (23 casos) y
probado con un chat exportado: agrupó los 3 "trajes para matrimonio" y los 2 "parqueadero", dejó el precio fuera
del tono y el Perfil pasó de 12 a 13 pendientes.

### Dar de baja un cliente sin dejar usuarios a la deriva · `191c3c4`
No había cómo dar de baja un tenant y, peor, si lo hubiera habido sus usuarios quedaban atendiendo a un cliente que
ya no existe. Ahora dar de baja lo saca del índice y **guarda** su carpeta en `clientes/_dados-de-baja/` (base,
conversaciones, WhatsApp: no se borra nada), y en el mismo acto limpia a sus usuarios: a quien atendía solo a ese
cliente se le desactiva el acceso —no tendría nada que ver— y queda listado en Equipo para reasignarlo. Al
super-admin no se le toca, que su lista vacía significa "todos". Y asignar un cliente que no existe se rechaza al
crear y al editar un usuario. `pnpm test:usuarios` (37 casos) y probado de punta a punta.

### La consola también atiende, y cada quien ve solo sus clientes · `a907db9`
La consola servía para mirar, no para trabajar. Ahora **Atender** junta en una sola bandeja lo que espera a una
persona en todos los clientes y se responde ahí mismo: la consola habla por el cliente con su token, así que no hay
que abrir cinco tableros ni repartirlos. Y entra cada quien con su usuario y su clave: el super-admin ve y atiende
todo y maneja el equipo; quien atiende un cliente solo ve —y solo le suena— lo de ese cliente (bandeja, estado y
proxy filtrados; 403 si intenta otro). Cuando entra algo nuevo de los tuyos suena un pito, el número queda en el
título y en segundo plano sale notificación del navegador. `pnpm test:usuarios` (25 casos), `test:consola` (26) y
28 suites. Probado de verdad: una pregunta de un cliente de CONFIA FINTECH respondida desde la consola le llegó a
su chat, y el usuario de soporte de HRC recibe 403 al intentar ver CONFIA.

### Consola del super-admin · `7272210`
Con varios clientes hacía falta verlos a todos y poder dar de alta uno nuevo. `pnpm consola` muestra una tarjeta
por cliente con su prioridad, sus números y **tickets que salen solos del estado** (instancia caída, dirección
pública caída, WhatsApp pidiendo código, preguntas sin responder, gente esperando, citas sin resultado), ordenados
por urgencia × prioridad. El alta es del super-admin, desde ahí: crea carpeta, token y puerto, y dice qué falta;
arrancar la instancia sigue siendo pm2, a propósito. Escucha solo en 127.0.0.1 porque tiene la llave de todos los
tableros. `pnpm test:consola` (21 casos) y probada contra la instancia real de DUNOR: destapó de una que el túnel
se había vuelto a caer.

### Varios clientes en la misma máquina · `a4754dc`
Para atender negocios distintos (boutique, financiera, litografía) hacía falta poder montar varios sin que se
puedan mezclar. Quedó **un proceso por cliente**, no una base compartida: cada uno en `clientes/<slug>/` con su
configuración, su base, su WhatsApp, su token y su dominio, y lo compartido de la máquina (claves de OpenAI,
Ollama) una sola vez en el `.env` de la raíz. `pnpm cliente` da de alta, lista con estado, y genera el pm2 y el
túnel. Comprobado con dos instancias a la vez: DUNOR con sus 10 contactos y una financiera nueva en 0, y el token
de una devuelve 401 en la otra. `pnpm test:clientes` (21 casos).

### El asistente sabe que ya venías hablando por el otro canal · `114f571`
Empezaba la gestión por el chat del sitio y en la tarde escribía por WhatsApp: para el cliente es la misma
conversación, pero XENCRM lo saludaba como a un desconocido y le preguntaba todo otra vez. Ahora, cuando el número
coincide con otra ficha suya, la conversación de allá entra en el contexto y lo dice una sola vez: *"Hola, Marta 🙂
Vi que veníamos hablando por el chat del sitio; ya me puse al tanto"*, y sigue respondiendo con lo que ya sabía (el
traje, la ocasión, la cita). El equipo lo ve en la campana y une las fichas con un botón. **No se unen solas**: cada
ficha es la historia de su canal y esa decisión es de una persona.

De paso, dos muletillas que las reglas no entendían: preguntar por la cita ("¿a qué hora era?", "¿sigue en pie?")
lo ponía a ofrecer cambiarla en vez de responder, y "cámbiala" con tilde no la reconocía ninguna regla.
`pnpm test:cross` (12 casos), `pnpm test:booking` (4 nuevos), 24 suites y escenarios con OpenAI real: 40/40.

### "El jueves" es el de esta semana · `1ca28cb`
Un día de la semana suelto era un filtro abierto —cualquier jueves—, así que si ese jueves estaba lleno el
asistente ofrecía el de la semana siguiente sin avisar, cuando el cliente estaba hablando de esta. Ahora "el
jueves" es el jueves que viene de esta semana, salvo que diga otra cosa ("el otro jueves", "el jueves de la
próxima"), y dicho el mismo día de la semana es el de la otra, porque para hoy se dice "hoy". Con ese día lleno
responde "El jueves ya no me quedan espacios 😕 Lo más cercano que tengo:" y ofrece alternativas. "Entre semana"
no se ancla, que es una disponibilidad y no un día.

También quedó la trazabilidad entre canales: la cita se queda en la ficha donde se agendó —ahí está su historia— y
lo que se haga desde el otro canal se anota en las dos líneas de tiempo ("Cancelada por el cliente desde
WhatsApp"). Y la prueba de citas dejó de escribir en la base del negocio: corre con su propia agenda temporal.
`pnpm test:when` (6 actualizados), `pnpm test:booking` (el día lleno), `pnpm test:merge` (5 nuevos) y escenarios con
OpenAI real: 40/40.

### La cita vale en los dos canales, y preguntar por ella no la mueve · `7c6ca72`
Ensayando el demo completo (chat del sitio + WhatsApp) salieron dos fallas seguidas, las dos visibles para el
cliente:
- Agendó por el chat del sitio y escribió después por WhatsApp: como esa ficha era nueva, el asistente le ofreció
  horarios como si no tuviera cita y la habría dejado con dos. Ahora busca la cita también en las otras fichas de
  la misma persona (mismo número, otro canal), aunque todavía no se hayan unido.
- "¿me confirmas la cita del jueves?" nombra el día de su propia cita y el flujo lo leía como "muévela". Ahora eso
  es una pregunta por la cita ("Ya tienes tu cita del jueves… ¿quieres cambiarla o cancelarla?"); pedir otra hora
  del mismo día sigue moviéndola.

`pnpm test:booking` (2 casos nuevos), `pnpm test:merge` (3 nuevos) y el ensayo repetido de punta a punta. De paso,
la prueba de posponer dejó de depender del milisegundo exacto.

### El puntaje se enfría solo, y los pesos calibrados con lo que pasó · `29645de`
El puntaje solo se recalculaba al llegar un mensaje, así que quedaba congelado en su mejor momento: en la base real
había tres fichas en 100 con once y doce días sin hablar, y una en 87 de hace doce días. Así la lista de calientes
no sirve para decidir a quién llamar hoy.
- Ahora envejece al leer la ficha: 3 días −10, una semana −25, dos semanas −40, con el motivo a la vista. Con cita
  agendada o ya vendido no se enfría, porque el siguiente paso ya está puesto.
- La ficha guarda el puntaje de la conversación y lo dice ("llegó a 65 cuando hablaron"); "Calientes sin
  seguimiento" se arma con ese, que es justo lo que hay que retomar, y ya no repite a quien está esperando el
  resultado de una cita pasada.
- Los pesos son un **estimado** con las 10 conversaciones reales (3 con cita, 1 venta): pedir cita, el interés y el
  afán son lo que aparece antes de una cita; dar el nombre (5→2) y preguntar precio (10→6) aparecían igual o más en
  los que no agendaron, y los datos capturados pasaron de 6 cada uno a 4, 3, 2, 1 porque cuatro datos saturaban el
  100 y nadie se podía ordenar. Se afinan cuando haya ~20 citas con resultado.
- `pnpm rescore` pasa las fichas viejas a la escala nueva con los análisis ya guardados, sin llamar al modelo.

Medido sobre una copia de la base real: los tres con cita quedan en 92/89/83 (antes 100/100/100), el vendido en 75
y el prospecto de hace 12 días pasa de "87 caliente" a "40 tibio, llegó a 65". `pnpm test:score` (25 casos) y las
23 suites en verde.

### Llevarse los contactos y las citas en CSV · `e5f1ac3`
Los datos son del negocio y no había forma de sacarlos sin abrir la base a mano. Análisis tiene ahora **Contactos
(CSV)** y **Citas (CSV)**, con separador ";" y BOM (lo que Excel en español abre bien de una vez), la etapa con su
nombre, puntaje y temperatura, qué busca, ocasión, fecha del evento, etiquetas y notas; las citas van con cliente,
teléfono, estado, lugar y cómo fue el recordatorio. Los archivados no salen y la descarga manda el token en la
cabecera, no en la dirección, para que una URL copiada no se lleve el acceso. `pnpm test:export` (14 casos, con
notas que traen comillas, ";" y saltos de línea) y probado en el tablero y por HTTP: 51 filas, 401 sin token.

### Calientes sin seguimiento: escribirles y poder posponer · `04f5a1f`
La lista solo listaba: no había qué hacer con ella, así que los mismos nombres volvían todos los días y dejaba de
mirarse. Cada fila tiene ahora **Escribirle** —abre la conversación, se la pasa a la persona y deja un borrador
armado solo con lo que el cliente dijo (prenda, ocasión), sin precios ni fechas, para revisarlo antes de enviar— y
**Dejarlo por ahora**, que lo pospone una semana sin perder lo capturado y lo anota en la línea de tiempo; si el
cliente escribe antes, vuelve enseguida. `pnpm test:followup` (11 casos) y probado en el tablero: el borrador salió
con nombre, prenda y ocasión, y posponer bajó la lista de 3 a 2.

### Negativas suaves: las que no dicen "no" · `58f4549`
La guarda contra negativas inventadas solo veía el "no" explícito y junto a lo preguntado. Se le escapaban "Zapatos
no tenemos" (al revés), "Eso no lo manejamos" (sin nombrarlo), "Lo más parecido que manejamos es…", "Por ahora solo
manejamos trajes" y "En su lugar te ofrecemos…": la misma deducción que puede ser falsa, dicha con más tacto. Ahora
se busca frase por frase en cualquiera de esas formas, y la cortesía no cuenta ("no hay problema"). Comprobado con
`pnpm test:guards` (5 casos nuevos, 28 en total), 8 respuestas buenas del histórico que siguen pasando derecho y los
escenarios con OpenAI real: 40/40.

### Escribirle al cliente y buscar dentro de los mensajes · `eaa6d57`
El buscador de Conversaciones solo miraba nombre, teléfono y resumen: lo que el cliente dijo ("esmoquin azul", "para
el 12") no aparecía. Ahora busca también dentro de la conversación y cada fila trae el pedacito donde aparece, con
quién lo dijo y lo buscado resaltado. Y el teléfono de la ficha era texto muerto: ahora tiene **Escribirle por
WhatsApp** y **Llamar**. El número se arma igual que para unir fichas (el que dejó o el de su dirección de
WhatsApp, con indicativo), y esa función quedó en un solo lugar: el recordatorio a mano ya no puede armar un wa.me
con un número local sin indicativo. `pnpm test:buscar` (14 casos) y probado en el tablero: «esmoquin» dio 14
conversaciones con su fragmento resaltado y la ficha abrió wa.me/573005551234 y tel:+573005551234, con botones de
44 px.

### Archivar y borrar conversaciones · `33e7083`
Las pruebas, los equivocados y el spam solo se podían limpiar por código, así que ensuciaban listas, embudo y
números. La ficha ahora tiene **Archivar** (sale de las listas, del embudo y de las cuentas sin perder nada; vuelve
sola si el cliente escribe; filtro «Archivados» para verlas y devolverlas) y **Borrar** (se lleva ficha,
conversación, citas, análisis, eventos, verificaciones y consumo; pide confirmación porque no se deshace, con el
respaldo diario como red). `pnpm test:archive` (10 casos) y probado en el tablero: archivar bajó la lista de 51 a
50, el filtro mostró las archivadas y borrar limpió la ficha.

### Unir fichas de la misma persona · `9a0d2e5`
Si alguien escribía por el chat del sitio, dejaba su número y después escribía por WhatsApp, quedaban dos contactos,
dos historias y dos puntajes. La ficha ahora muestra "¿Es la misma persona?" cuando otra tiene el mismo número
(aunque uno lo tenga en la dirección de WhatsApp y el otro lo haya escrito). Al unir, mensajes, citas, análisis,
eventos, verificaciones y consumo pasan a la ficha que se conserva —la del canal donde escribió más recientemente,
porque por ahí le llegan las respuestas—, con el nombre y el número que haya, la etapa más avanzada, las etiquetas
de ambas y una nota de la unión. No se puede deshacer, así que se pide confirmación (el respaldo diario es la red).
`pnpm test:merge` (12 casos) y probado en el tablero: dos fichas de "Marta" quedaron en una con sus 3 mensajes.

### Calendario en el celular · `04f5c19`
La semana (siete columnas) medía 562 px en una pantalla de 390: tocaba desplazarse en horizontal, el selector
«Semana | Agenda» salía cortado, el rango de fechas ocupaba cuatro líneas y el formulario "Agendar cita" se salía.
Además, la fila de cada cita pedía 455 px porque sus seis elementos iban en una sola línea.
- En el celular el calendario abre en **Agenda** (una lista); lo que elijas se recuerda en ese navegador.
- La barra deja el rango en su propia línea, sin recortar el selector.
- Las filas de citas se parten en dos líneas y el formulario queda apilado, sin salirse.
- La pastilla del selector seguía marcando "Semana" aunque el modo fuera Agenda (solo sabía moverse en el switch de
  Conversaciones); ahora sigue al modo, con `aria-pressed`.
- Los botones pequeños (citas, avisos) pasan a 44 px con el dedo.

Comprobado en el servidor aislado a 390 px: nada se sale de la pantalla, y en escritorio la barra sigue en una
línea.

### Citas: fecha del evento, "sí" sin decir cuál y citas inventadas · `7e31cfd`
Repitiendo contra el código de hoy la conversación real del 21 (Arnulfo, por el chat del sitio) aparecieron tres fallas:
- "El evento es este viernes" arrancaba el agendamiento **el viernes**, el mismo día del evento. Ahora es un plazo:
  espacios antes del evento (`when.ts › eventDeadline`), en todos los pasos del flujo.
- En el paso del teléfono, una respuesta corta que no era un número sacaba del flujo y volvía a ofrecer horarios
  desde cero, perdiendo el elegido. Ahora vuelve a pedir el número.
- Con tres horarios ofrecidos, "Si" no se entendía y el modelo respondía "Te esperamos en la cita privada" **sin que
  existiera ninguna cita**. Ahora el flujo pregunta cuál, y una guarda (`claimsBooked`) rehace cualquier respuesta que
  dé por hecha una cita que no existe.

Comprobado: `pnpm test:booking`, `pnpm test:guards`, escenarios 40/40 y la conversación completa repetida, que
vuelve a terminar con la cita agendada.

### Hoy: «¿Cómo les fue?» para las citas que ya pasaron · `596237b`
Una cita pasada quedaba "confirmada" para siempre y el negocio nunca decía cómo terminó. Hoy lista las de los
últimos 14 días sin resultado, con **Vino**, **No vino** y **Compró** (esta última pasa el contacto a Vendido). Son
los resultados que hacen falta para calibrar el puntaje. Probado aislado.

### Respaldo diario de la base y token fuera de los registros · `48e73e4`
No había ningún respaldo: contactos, conversaciones y citas vivían en un solo archivo. Ahora una copia al día con
`VACUUM INTO` en `data/backups/` (las últimas 14, permisos 600, fuera de git), con "Respaldar ahora" en Agente.
Además, el token del tablero ya no se imprime completo al arrancar. Primer respaldo real: 452 KB, 10 contactos,
61 mensajes, 3 citas. `pnpm test:backup`.

### Modelo pesado solo para lo específico · `590ec51`
El modelo caro respondía por historial largo, varias preguntas o palabras sueltas ("para una boda", "mejor",
"presupuesto"), y "diseño a la medida" se confundía con pedir medidas. Ahora el pesado es solo para recomendar o
comparar, detalles de una prenda, medidas o tallas, una prenda pedida con características y su seguimiento corto.
Medido con las 8 conversaciones de DUNOR: 1 respuesta pesada de 15 (antes 5 de 14) y $0.0047 por conversación
(antes $0.0065). Las respuestas que pasaron al liviano se compararon lado a lado. `pnpm test:router`.

### WhatsApp oficial: API de Meta v26.0 por defecto · `fa058de`
v21.0 ya no aparece entre las versiones vigentes del changelog de Graph API.

### Análisis cuando la conversación hace una pausa · `0fcd15c`
Corría 2,5 s después de cada mensaje: con un cliente que escribe cada 20–40 s se pagaba un análisis por mensaje.
Ahora corre tras 60 s de silencio o, si la conversación sigue activa, a más tardar a los 5 minutos. Medido: 8
análisis en vez de 17 (−53 % en análisis, −19 % por conversación). `pnpm test:schedule`.

### Aviso cuando la dirección pública (el túnel) se cae · `ff25073`
El túnel rápido de Cloudflare se cerró esa mañana ("Tunnel not found") y nadie se enteró: sin él no funcionan el
chat del sitio, WhatsApp oficial, el calendario en Google/Outlook ni el tablero desde el celular. Ahora XENCRM se
llama a sí misma por `PUBLIC_URL` cada 5 minutos comparando un código único del proceso; tras 3 fallas seguidas
avisa en la campana, en Hoy y en Canales, y avisa también cuando vuelve. `pnpm test:public`.

### Celular: botón «Más» en la barra de abajo · `d1f13e2`
Perfil, Agente, Canales, Lo que sabe, Ayuda, el tema y Salir quedaban escondidos a la derecha, sin pista de que
había que deslizar. Ahora la barra lleva Hoy, Chats, Calendario, Prospectos y «Más», y ya no se desborda a 390 px.

### Guarda de negativas inventadas · `ce2d762`
"¿Venden zapatos?" → "No, no vendemos zapatos" era una deducción que podía ser falsa. Ahora un "no" sin respaldo se
rehace para que lo verifique; pasa si lo negado está en la información o si se apoya en el alcance del negocio
("somos moda masculina", que también cubre "para hombres"). Lo que el Perfil marca "por confirmar" nunca recibe sí
ni no. Probado en vivo con novia, zapatos, wifi y esmoquin. `pnpm test:guards`.

## 2026-09-21

### Tablero: sección Ayuda con tutorial rápido · `0b26b48`
Seis pasos que llevan a su pantalla, preguntas frecuentes y lo que el asistente nunca hace. La primera vez, Hoy
muestra un aviso que lleva ahí. «FAQ» pasó a llamarse «Lo que sabe».

### Documentación: guía del tablero, arquitectura y README al día · `0d6cfda`
Guía para el equipo del negocio, documento de arquitectura y README como puerta de entrada.

### Perfil del negocio y credenciales de Meta desde el tablero · `52abae0`
La información del negocio (dirección, horarios, pagos, precios, políticas y datos propios) se llena desde el
tablero y el bot la usa al instante; lo vacío queda "por confirmar" y no se lo inventa. Las credenciales de
WhatsApp oficial se verifican con Meta antes de guardarse y quedan en `.env`, no en la base ni en el repositorio.
`pnpm test:profile`, `pnpm test:meta`.

### Material del tablero y colores de dato · `ff49b97`, `2fd47a1`, `b353804`, `13cc8f4`, `cfe7d3a`, `107f4c6`
Con criterio de HRCAPOLO: marco de cartulina en las tarjetas del pipeline, campos hundidos, foco sólido que cumple
3:1 (antes daba ~1,9:1), «Mover a…» para cambiar de etapa sin arrastrar (en el celular arrastrar no funciona con el
dedo) y colores de dato (`--cita`, `--si`) separados del acento de marca. La temperatura pasó a los colores del
veredicto: el mismo 100 se veía rojo en la tarjeta y verde en la barra, y el rojo de "caliente" era el de "Perdido".

### La marca de cada cliente en el chat del sitio y la página de la cita · `a414572`
Color y logo por cliente, con el contraste ajustado solo (probado con 500 colores). `pnpm test:brand`.

### Recordatorio de la cita el día antes · `f533307`
Sale solo por WhatsApp (QR, u oficial dentro de las 24 h o con plantilla); lo que no puede salir solo queda en
Hoy › Recordar a mano con el texto listo. La respuesta del cliente queda como Confirmó o No puede.
`pnpm test:reminders`.

### Caché de OpenAI: información completa fija al inicio del prompt · `e763143`
Medido: con `gpt-5.4-mini` la caché solo pega cuando el inicio común pasa de ~1.450 tokens, y la persona sola
(~1.100) no alcanzaba. Si toda la información del negocio cabe, va entera después de la persona. Con la caché
caliente, una respuesta liviana bajó de $0.0015 a $0.0009.

### Muletillas del español que destapó el reporte · `159b780`
"a la hora del almuerzo", "en ocho días", "de hoy en quince", "el otro fin de semana" y, al elegir horario, "la que
sea" o "me da igual".

### Frases que no entendimos: reporte y expresiones del diccionario · `81f519e`
Lo que las reglas no entienden queda anotado y se enseña desde el tablero, solo si con eso ya se entiende.
`pnpm test:misses`.

### WhatsApp oficial: respetar la ventana de 24 horas · `0f59ca3`
Pasadas 24 horas desde el último mensaje del cliente, XENCRM no envía (ni guarda como enviado) lo que Meta
rechazaría, y el tablero lo advierte antes de escribir.

### Tablero en celular: "Chats" en la barra de abajo · `afe0834`
"Conversaciones" y "Calendario" quedaban pegados a 390 px.

### Primer commit · `92079c4`
El proyecto quedó bajo control de versiones (antes no lo estaba), con `.env`, la base y las claves fuera de git.
