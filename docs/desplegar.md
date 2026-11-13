# Subir XENCRM a un hosting de apps

Un solo despliegue atiende a todos los clientes, separados por ruta. Se arma con `pnpm paquete` y sale un
`paquetes/xencrm.zip` que se sube tal cual al panel.

```
pnpm paquete tu-dominio.com        (o XENCRM_DOMINIO en el entorno; sin dominio no arma nada)
pnpm paquete midominio.com
```

## Qué queda publicado

| Ruta | Qué es |
|---|---|
| `/` | La portada: qué es XENCRM. Es lo único que ve quien llega al dominio pelado. |
| `/consola` | La consola de vigilancia y atención: todos los clientes en una pantalla. |
| `/dunor/` | El chat del sitio de ese cliente. Su tablero se abre desde la consola (`/c/dunor/admin`): por `/dunor/admin` ya no se sirve (2026-11-07, ver `seguridad.md`). |
| `/.well-known/security.txt` | A quién escribirle si alguien encuentra un fallo (RFC 9116). |
| `/_salud` | Sin token, solo `{"ok":true}`. Con su token (`pnpm salud`), el diagnóstico entero. |
| `/confia/`, `/atlas/`, … | Igual, uno por cliente dado de alta. |

Adentro corre **un proceso por cliente** —cada uno con su base, su WhatsApp y su configuración— más uno para la
consola, y delante un enrutador que reparte por el primer tramo de la ruta y le quita el prefijo al de adentro.
Lo que no se mezcla no se puede filtrar: esa es toda la razón de que sean procesos aparte y no uno solo con un
campo `cliente` en cada tabla.

Por eso `consola`, `api`, `admin`, `public`, `index`, `assets`, `static` y `widget` **no se pueden usar como
identificador de un cliente**: los tapa el enrutador. `pnpm cliente nuevo` los rechaza al crear.

## En el panel, al desplegar

```
Versión de Node ........ 24
Archivo de inicio ...... app.js
Comando de compilación . npm install --omit=dev
Comando de inicio ...... npm start
```

`PORT` lo pone la plataforma: no se define.

### 🪤 El archivo de inicio tiene que ser `app.js`

Estas plataformas **no ejecutan `npm start`**. El servidor (LiteSpeed, con su `lsnode.js`) hace `require()` del
archivo de inicio dentro de su propio proceso. De ahí salen dos trampas:

1. Si el panel queda apuntando a `dist/index.js` —que es el servidor de **un** cliente— no arranca el enrutador
   ni los demás, aunque el ZIP esté bien.
2. Un `require()` de un módulo ESM con `await` arriba revienta con `ERR_REQUIRE_ASYNC_MODULE`. Todo lo compilado
   es ESM, así que ninguno de esos archivos sirve como inicio.

Por eso `app.js` es **CommonJS** y la raíz del paquete no declara `"type": "module"`: lo declara `dist/package.json`,
que manda sobre lo que cuelgue de ahí. Los clientes arrancan como procesos aparte, con `node`, y siguen siendo
ESM sin problema.

Si el error aparece, no es el código: es el campo del panel.

## Variables de entorno

Ningún secreto viaja dentro del ZIP. Se ponen en el panel, y el `LEEME.txt` de adentro las trae listas para
copiar. En esta máquina están juntas en `~/xencrm-credenciales/` (permisos 700, cada archivo 600).

🪤 Ahí, y no en `paquetes/`: esa carpeta es la salida del empaquetador.

- `OPENAI_API_KEY` — la clave. Sin ella no responde nadie.
- `CONSOLA_TOKEN` — la llave maestra de la consola.
- `TOKEN_<CLIENTE>` — el token del tablero de cada cliente (`TOKEN_DUNOR`, `TOKEN_CONFIA`, …). Es el mismo que
  está en `clientes/<slug>/.env` en la máquina donde se armó el paquete.

Opcionales del blindaje (2026-11-07; el porqué en `seguridad.md` › «El blindaje»):

- `XENCRM_IP` — cuántos saltos desde la derecha del `x-forwarded-for` está la dirección de verdad de quien llama.
  Sin definir, `0` (la última): es lo medido en Hostinger el 2026-11-07. `primera` vuelve a lo de antes, que deja
  a quien llama escribir su dirección. Se mide con `/_salud` (con su token) mandando una dirección inventada:
  `tuPeticion` enseña la cadena entera.
- `TABLERO_DIRECTO=si` — vuelve a abrir el tablero de cada cliente por `/<cliente>/admin` con su token. Sin esto,
  solo se abre desde la consola.
- `SEGURIDAD_CONTACTO` — a quién escribir según `security.txt` (por defecto, `security@` el dominio desplegado).
- `PROSPECTOS_CLIENTE` — el slug del cliente cuyo CRM recibe los registros de la portada y de la puerta de la
  consola (Ventas › Prospectos). Sin esto, el registro dice que no está abierto. Ver `consola.md`.
- `XENCRM_DOMINIO` — en la máquina donde se arma el paquete, el dominio si no se pasa como argumento
  (`pnpm paquete tu-dominio.com`). Sin ninguno de los dos, `pnpm paquete` y `pnpm salud` no arrancan.
- `XENCRM_SIN_AFINAR=1` — al ARMAR el ZIP (no en el panel): deja el código servido legible, con sus comentarios,
  para mirar un fallo en el servidor.

Los motores (`LIGHT_ENGINE`, `HEAVY_ENGINE`, `GATE_ENGINE`, `ANALYSIS_ENGINE`, `EMBED_ENGINE`) **arrancan en
`openai` solos**: en un hosting de apps no hay Ollama ni lo va a haber, y una variable que se olvide no puede
dejar a XENCRM esperando un modelo local que no existe. Si se ponen en el panel, manda el panel.

## Dónde quedan los datos

Estas plataformas estrenan carpeta en cada actualización, así que lo que se escriba al lado del código se pierde.
El arranque busca dónde guardar y se queda con el primero donde pueda escribir:

```
$XENCRM_DATOS  →  ~/xencrm-datos  →  ../../../../xencrm-datos  →  el temporal del sistema
```

Ahí adentro va una carpeta por cliente con su base, su sesión de WhatsApp, su perfil, su diccionario, su catálogo
y su conocimiento. Por eso actualizar no borra nada. Si el panel no deja escribir en ninguno de esos sitios,
se define `XENCRM_DATOS` con una ruta que sí.

## WhatsApp

**Arranca apagado en todos los clientes.** Se enciende desde el tablero de cada uno, en Canales, cuando vayan a
escanear el código; una vez prendido queda prendido, porque eso se guarda en la base del cliente y no en una
variable.

🪤 Una sesión de WhatsApp es de una sola máquina. Si el mismo cliente sigue corriendo en el Mac y se prende
también en el hosting, se pelean la sesión y se cae la conexión a cada rato. Antes de prenderlo allá, hay que
apagarlo acá.

## Comprobar el paquete antes de subirlo

Se descomprime aparte, se le apunta a una carpeta de datos de mentira y se levanta en un puerto libre:

```bash
cd /tmp && rm -rf prueba && mkdir prueba && cd prueba
unzip -q ~/proyectos/xencrm/paquetes/xencrm.zip
ln -s ~/proyectos/xencrm/node_modules node_modules
PORT=3500 XENCRM_DATOS=/tmp/prueba-datos OPENAI_API_KEY=sk-de-prueba \
  CONSOLA_TOKEN=x TOKEN_DUNOR=x TOKEN_CONFIA=x TOKEN_ATLAS=x node app.js
```

Para probarlo **como lo arranca la plataforma** —que es distinto— se le hace `require()` desde CommonJS, igual
que `lsnode.js`:

```bash
echo "require('./app.js')" > simula.cjs && node simula.cjs
```

Y del otro lado: `/` y `/consola` dan 200, y `/<cliente>/health` responde con el nombre del negocio.

🪤 Si una prueba anterior quedó viva, el puerto sigue ocupado y las peticiones le llegan **a la vieja**: da 404
en el cliente nuevo y uno se vuelve loco buscando el error en el paquete. Antes de arrancar:
`lsof -ti :3500 | xargs -r kill -9`.

## Cuando algo no arranca: `/_salud`

🪤 Cuando ninguno de los procesos de dentro levanta, **todo** responde «todavía está arrancando» y desde fuera no
hay forma de saber si es memoria, un puerto pillado o un error del código. Pasó, y se fue media mañana
adivinando.

Por eso el enrutador —que sigue vivo aunque sus hijos no— sirve un sitio donde mirar:

```
curl -H "x-consola-token: <CONSOLA_TOKEN>" https://<dominio>/_salud
```

Dice, en una llamada: qué commit va en el paquete (`version`, del `version.json` que deja `pnpm paquete`), cuánto
lleva en pie, qué versión de Node, qué puertos pidió y cuáles usa de verdad, y por
cada proceso de dentro si está vivo, su pid, cuántas veces se ha levantado, cuántas se ha caído, con qué código
salió la última vez y cuándo. Y una línea de **veredicto** que dice qué mirar primero:

- *«Ninguno de adentro está vivo»* → mirar `ultimoCodigo`: si es 1, revienta al arrancar.
- *«Hay procesos reiniciándose en bucle»* → memoria o error de arranque.
- *«Este lanzador no manda»* → hay dos arrancados y este solo reparte. Es lo correcto; ver la sección de abajo.
- *«Todo arriba»* → el problema está en otra parte.

Dos campos que existen por lo que costó no tenerlos:

- **`papel`**, lo primero que se lee: «con el mando» o «espejo del lanzador N». Sin esto, dos lanzadores decían
  los dos «Todo arriba» mientras entre ambos había ocho procesos peleándose el WhatsApp del cliente.
- **`sondeo`**, el motivo por el que un puerto de dentro no contesta, puerto por puerto. Antes el registro solo
  decía «5 de 5 no contestaron a tiempo», que no distingue un proceso que aún no abrió el puerto
  (`ECONNREFUSED`) de uno que abrió y está tan ahogado que no alcanza a responder. Son dos problemas distintos y
  no se arreglan igual.

Los pids y los puertos internos piden `CONSOLA_TOKEN`; el estado y el veredicto no, porque esto se mira justo
cuando nada funciona y pedir una credencial en ese momento es poner una puerta delante del extintor.

### Quién ha entrado a la consola: la bitácora de accesos

Con su token, `/_salud` trae al final **`accesos`**: quién entró, quién falló al intentarlo y por qué, quién abrió
qué tablero y qué se le hizo a cada cuenta (creada, clave nueva, rol, desactivada, quitada). Va un resumen por
persona (último ingreso, cuántas veces, fallos desde entonces) y las últimas líneas, con dirección y navegador.
Nació el 2026-10-19: se le pasó su acceso a DUNOR y no había forma de saber si habían entrado.

```
pnpm salud tu-dominio.com           en hora de Colombia (o XENCRM_DOMINIO en el entorno)
pnpm salud --usuario dueno.dunor    solo lo de esa persona
pnpm salud --seguir                 se queda mirando y pinta lo nuevo cada 20 segundos
pnpm salud --json                   la respuesta tal cual
```

- **El token** lo crea `pnpm paquete` la primera vez, en `~/xencrm-credenciales/salud-token.txt` (600), y no lo
  vuelve a cambiar. Al ZIP va solo su huella (`salud.json`), así que no hay variable nueva en el panel y el ZIP no
  lleva ningún secreto. Abre `/_salud` y nada más: no entra a la consola ni a ningún tablero. 🪤 Un paquete armado
  en otra máquina trae la huella de *ese* token. Si `pnpm salud` dice que no lo reconoce, es eso.
- Se manda en la cabecera `x-salud-token`. También valen `SALUD_TOKEN` en el panel y la llave maestra.
- **Lo escribe la consola** en `accesos.jsonl`, junto a `usuarios.json`, en la carpeta de datos. Se conserva entre
  despliegues y pasando de un mega se queda con las últimas 2000 líneas. Cuenta desde el primer paquete que la
  trae: de antes no hay nada.
- **Ninguna clave entra ahí.** Lo que alguien escribió como usuario tampoco, si no es una cuenta que exista,
  porque a veces es la clave pegada donde no era: va tapado (`mi…(18)`).
- La dirección es la que manda el servidor de delante en `x-forwarded-for`. Sirve para reconocer desde dónde,
  no como prueba.

## 🪤 El alojamiento puede arrancar la aplicación dos veces a la vez

Esto costó una mañana entera y no se parecía en nada a su causa.

El 29 de septiembre de 2026 el registro del panel mostraba **dos arranques con 1,4 segundos de diferencia**: dos
lanzadores, cada uno con sus tres clientes y su consola. Ocho procesos donde iban cuatro. El sitio respondía, así
que nadie miraba por ahí. Lo que no respondía era WhatsApp:

```
[whatsapp] conectado como 573008263714:4@s.whatsapp.net
[whatsapp] conexión cerrada (440: Stream Errored (conflict)) tras 3s, reconectando en 3s...
```

…en bucle, para siempre. Dos procesos abriendo el mismo número: cada uno echaba al otro y el echado volvía.
Y `/_salud` decía **«Todo arriba»**, porque cada lanzador solo sabe de sus hijos y sus hijos estaban perfectos.

Tres cosas lo sostienen ahora, y las tres hacen falta:

1. **Un cerrojo: el puerto 4099.** El lanzador que lo abre, manda y levanta a los clientes. El que no puede
   abrirlo sabe que hay otro y se limita a **repartir** hacia los puertos del primero, que lee del índice. Un
   puerto y no un archivo, porque el sistema lo suelta solo al morir el proceso: no quedan cerrojos trabados.
   Si el que mandaba desaparece, el otro lo nota en cuatro segundos y toma el relevo.
2. **Ningún hijo sobrevive a su padre.** Cada proceso de cliente —y la consola— vigila su `ppid`; cuando lo
   adopta `init`, se va solo. Es lo que impide que un SIGKILL al lanzador deje cuatro procesos agarrando
   puertos y sesiones de WhatsApp. La consola necesita `XENCRM_SUPERVISADO=1` para esto, igual que los clientes:
   sin esa variable se quedaba viva ella sola y obligaba al siguiente lanzador a correrse de tramo.
3. **Correrse de puerto es el último recurso.** Antes se echa a los procesos de la versión anterior (se
   reconocen porque cuelgan de la carpeta de este dominio y son uno de nuestros dos guiones) y se espera doce
   segundos a que suelten. Solo si después de eso siguen ahí se busca otro tramo, avisando fuerte — porque un
   tramo distinto significa dos copias vivas, que es justo lo que hay que evitar.

`/_salud` ahora dice en su primera línea `papel`: «con el mando» o «espejo del lanzador N». Si dos peticiones
seguidas dan lanzadores distintos, eso es lo normal con dos arrancados; lo que no puede pasar es que los dos
digan «con el mando».

Se prueba con `pnpm test:lanzador`, que además mata un proceso de verdad para comprobar que su hijo se va solo.

## 🪤 No dar por hecho por dónde se llega a los de adentro

El 29 de septiembre de 2026, con el sitio entero devolviendo «todavía está arrancando», `/_salud` dijo esto:

```
sondeo:  4103 ECONNREFUSED · 4100 ECONNREFUSED · 4101 ECONNREFUSED · 4102 ECONNREFUSED
adentro: los cuatro vivos, arranques 1, caídas 0
```

Los cuatro procesos vivos, cada uno anunciando en su registro que escuchaba su puerto, y el enrutador —su propio
padre— sin poder conectarse a ninguno. La causa no estaba en el código nuevo: estaba en una suposición de una
línea que llevaba meses ahí, `host: '127.0.0.1'`, escrita cuando eso era obviamente cierto.

Ahora no se supone. Para cada proceso de adentro se prueban tres puertas en orden y se recuerda cuál abrió:

1. `127.0.0.1` — la de siempre.
2. `::1` — la misma máquina por IPv6. Un proceso que abre el puerto sin decir en qué dirección puede acabar solo
   en IPv6, y entonces quien llame por IPv4 recibe ECONNREFUSED como si no hubiera nadie.
3. **Un socket de archivo**, que no pasa por la red. Si los dos procesos ven la misma carpeta, se hablan: da
   igual qué pase con direcciones, familias o reglas de red.

Cada cliente y la consola abren su socket en `<datos>/_sockets/<slug>.sock` (o en la carpeta temporal si esa
ruta pasa de 100 caracteres, que es el límite del sistema y falla con un `EINVAL` que no explica nada). El
enrutador lo usa solo si las otras dos fallan, y `/_salud` dice por cuál va cada uno.

Dos detalles que costaron su propio error:

- **El socket se abre ANTES que el puerto**, no dentro de su callback. Estaba dentro, que es el único sitio
  donde no sirve: si el puerto no abre, ese callback no se llama nunca, así que la puerta pensada justo para
  cuando el puerto falla solo existía cuando el puerto funcionaba.
- **No abrir el puerto ya no tumba al proceso.** Con el socket abierto se sigue atendiendo; antes moría y el
  lanzador lo reintentaba cada cinco segundos, en bucle, sin que nadie viera por qué.

Y `/_salud` trae ahora **`escuchando`**, que es lo que dice el sistema (`/proc/net/tcp`), no lo que dice cada
proceso de sí mismo: en qué dirección quedó abierto cada puerto de verdad. Cuando esos dos datos no coinciden,
la respuesta está justo ahí. Es el dato que faltó aquella mañana.

**La consola también.** Le pregunta a cada cliente por su cuenta, no a través del enrutador, así que tenía el
mismo problema y por eso enseñaba los tres clientes como «sin conexión» mientras los tres atendían. Ahora usa
`llamarACliente`, que prueba por red y cae al socket igual, y recuerda cuál funcionó.

**Lo que se vio en el servidor**, y es el motivo de todo esto:

```
escuchando:  4100 → 127.0.0.1   4101 → 127.0.0.1   4102 → 127.0.0.1   4103 → 127.0.0.1
por:         confia=socket  dunor=socket  atlas=socket  consola=socket
```

El sistema confirmando que los cuatro escuchan en `127.0.0.1`, y los cuatro alcanzables **solo** por socket. Ahí
las conexiones TCP entre nuestros propios procesos no pasan. No hace falta saber por qué para dejar de depender
de ellas.

Se prueba con `pnpm test:lanzador`, que levanta el paquete con la red entre procesos inutilizada y comprueba que
el sitio sigue en pie y que la consola sigue viendo a sus clientes.

## Y si WhatsApp entra en conflicto

Cuando el mismo número está abierto en dos sitios, el canal queda en estado **`conflicto`** y **deja de
reintentar**: reintentar es lo que alimenta la pelea, y machacar la reconexión con el número de un negocio real
es la mejor forma de que Meta lo bloquee. El tablero lo muestra como «Abierto en otro sitio» y dice qué hacer;
la consola lo saca como ticket de urgencia alta. Se sale de ahí dejando el número en un solo sitio y apagando y
encendiendo el canal.

Los cortes que no son conflicto tampoco se reintentan cada tres segundos: la espera sube 3 · 3 · 6 · 12 · 30 · 60.

## 🪤 Tres segundos para escuchar

El servidor de Hostinger da la aplicación por colgada si no llama a `listen()` en **tres segundos**: la mata y la
rearranca. Y como cada intento deja hijos huérfanos agarrando los puertos, el siguiente arranque tampoco puede
abrirlos y entra en un bucle del que no sale solo. En el registro se ve así:

```
App did not call listen() within 3 seconds… App is hanging at startup
[xencrm] los puertos 4100+ estaban ocupados (¿versión anterior sin cerrar?); uso 4104+
```

Por eso el enrutador **escucha antes de levantar a nadie** (arranca en menos de medio segundo) y los procesos de
cada cliente se levantan después. Mientras no estén, contesta «todavía está arrancando», que es la verdad y dura
unos segundos.

Nada que se haga en el arranque puede ir antes de ese `listen()`: ni esperar a los hijos, ni leer archivos
grandes, ni comprobar puertos. Si hace falta hacerlo, se hace después.

## Nada de acentos graves en el código del lanzador

`src/paquete.ts` genera `app.js` dentro de una plantilla de texto. Un acento grave en un comentario —escribir el
nombre de una función entre ellos, por ejemplo— **cierra la plantilla** y rompe la compilación con errores que
no señalan al sitio. Ha pasado tres veces. En ese bloque, comillas normales.
