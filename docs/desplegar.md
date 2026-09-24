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
Comando de compilación . npm install --omit=dev
Comando de inicio ...... npm start
```

`PORT` lo pone la plataforma: no se define.

## Variables de entorno

Ningún secreto viaja dentro del ZIP. Se ponen en el panel, y el `LEEME.txt` de adentro las trae listas para
copiar:

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
  CONSOLA_TOKEN=x TOKEN_DUNOR=x TOKEN_CONFIA=x TOKEN_HRC=x node arranque.js
```

Y del otro lado: `/` y `/consola` dan 200, y `/<cliente>/health` responde con el nombre del negocio.

🪤 Si una prueba anterior quedó viva, el puerto sigue ocupado y las peticiones le llegan **a la vieja**: da 404
en el cliente nuevo y uno se vuelve loco buscando el error en el paquete. Antes de arrancar:
`lsof -ti :3500 | xargs -r kill -9`.
