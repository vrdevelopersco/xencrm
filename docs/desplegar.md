# Subir aiva a un hosting de apps

Un solo despliegue atiende a todos los clientes, separados por ruta. Se arma con `pnpm paquete` y sale un
`paquetes/aiva.zip` que se sube tal cual al panel.

```
pnpm paquete                       usa aiva.hrctechnologies.com
pnpm paquete midominio.com
```

## Qué queda publicado

| Ruta | Qué es |
|---|---|
| `/` | La portada: qué es aiva. Es lo único que ve quien llega al dominio pelado. |
| `/consola` | La consola de vigilancia y atención: todos los clientes en una pantalla. |
| `/dunor/` | El chat del sitio de ese cliente; su tablero en `/dunor/admin`. |
| `/confia/`, `/hrc/`, … | Igual, uno por cliente dado de alta. |

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
copiar. En esta máquina están juntas en `~/aiva-credenciales/` (permisos 700, cada archivo 600).

🪤 Ahí, y no en `paquetes/`: esa carpeta es la salida del empaquetador.

- `OPENAI_API_KEY` — la clave. Sin ella no responde nadie.
- `CONSOLA_TOKEN` — la llave maestra de la consola.
- `TOKEN_<CLIENTE>` — el token del tablero de cada cliente (`TOKEN_DUNOR`, `TOKEN_CONFIA`, …). Es el mismo que
  está en `clientes/<slug>/.env` en la máquina donde se armó el paquete.

Los motores (`LIGHT_ENGINE`, `HEAVY_ENGINE`, `GATE_ENGINE`, `ANALYSIS_ENGINE`, `EMBED_ENGINE`) **arrancan en
`openai` solos**: en un hosting de apps no hay Ollama ni lo va a haber, y una variable que se olvide no puede
dejar a aiva esperando un modelo local que no existe. Si se ponen en el panel, manda el panel.

## Dónde quedan los datos

Estas plataformas estrenan carpeta en cada actualización, así que lo que se escriba al lado del código se pierde.
El arranque busca dónde guardar y se queda con el primero donde pueda escribir:

```
$AIVA_DATOS  →  ~/aiva-datos  →  ../../../../aiva-datos  →  el temporal del sistema
```

Ahí adentro va una carpeta por cliente con su base, su sesión de WhatsApp, su perfil, su diccionario, su catálogo
y su conocimiento. Por eso actualizar no borra nada. Si el panel no deja escribir en ninguno de esos sitios,
se define `AIVA_DATOS` con una ruta que sí.

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
unzip -q ~/proyectos/aiva/paquetes/aiva.zip
ln -s ~/proyectos/aiva/node_modules node_modules
PORT=3500 AIVA_DATOS=/tmp/prueba-datos OPENAI_API_KEY=sk-de-prueba \
  CONSOLA_TOKEN=x TOKEN_DUNOR=x TOKEN_CONFIA=x TOKEN_HRC=x node app.js
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

Dice, en una llamada: cuánto lleva en pie, qué versión de Node, qué puertos pidió y cuáles usa de verdad, y por
cada proceso de dentro si está vivo, su pid, cuántas veces se ha levantado, cuántas se ha caído, con qué código
salió la última vez y cuándo. Y una línea de **veredicto** que dice qué mirar primero:

- *«Ninguno de adentro está vivo»* → mirar `ultimoCodigo`: si es 1, revienta al arrancar.
- *«Hay procesos reiniciándose en bucle»* → memoria o error de arranque.
- *«Todo arriba»* → el problema está en otra parte.

Va protegido con el `CONSOLA_TOKEN` porque enseña puertos y pids.

## Los puertos de dentro se mueven solos

🪤 Cuando el servidor del alojamiento mata el proceso principal sin dejarle despedirse, sus hijos quedan vivos
agarrando sus puertos. La versión nueva arranca, no puede abrirlos y sus hijos mueren en bucle: el sitio queda
respondiendo «todavía está arrancando» para siempre, y en el código nuevo no hay nada roto que encontrar.

Así que el lanzador ya no pelea por un puerto: busca un **tramo libre** y lo usa, avisando en el registro. Los
huérfanos siguen ahí hasta que alguien los mate, pero ya no impiden que el sitio vuelva. El índice que usa la
consola para hablar con cada cliente se escribe **después**, con los puertos de verdad.

## 🪤 Tres segundos para escuchar

El servidor de Hostinger da la aplicación por colgada si no llama a `listen()` en **tres segundos**: la mata y la
rearranca. Y como cada intento deja hijos huérfanos agarrando los puertos, el siguiente arranque tampoco puede
abrirlos y entra en un bucle del que no sale solo. En el registro se ve así:

```
App did not call listen() within 3 seconds… App is hanging at startup
[aiva] los puertos 4100+ estaban ocupados (¿versión anterior sin cerrar?); uso 4104+
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
