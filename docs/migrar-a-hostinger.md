# ¿Qué se puede mover de OCI a Hostinger?

Revisión de las seis apps desplegadas en las dos cuentas de OCI, mirando **qué necesita cada una para vivir** —que
es lo que decide, no el lenguaje ni el tamaño.

## La regla

Un hosting de apps (como el de Hostinger) sirve cuando la app **responde peticiones y ya**. Deja de servir cuando
necesita alguna de estas cuatro:

1. Un **proceso vivo** aunque nadie la visite (una conexión de WhatsApp, un socket de audio, una cola).
2. **Varios servicios** a la vez (contenedores, una base de datos servidor, un proxy propio).
3. **Cosas pesadas**: un navegador headless, visión por computador, un modelo local.
4. **Puertos o red propios** más allá del que le asignan.

## La matriz

| App | Dónde vive hoy | Qué es | ¿Se puede mover? |
|---|---|---|---|
| **daia** | `bpo-demo` · Micro | Dos HTML servidos por Caddy | **Sí, hoy mismo.** Es un sitio estático; Caddy solo está para TLS y una clave, y eso Hostinger lo da. Ni siquiera necesita "web app": va como sitio. |
| **votantes** | principal · A1 1/6 | FastAPI (Python 3.13) + SQLite + Tailwind | **Sí, si el plan corre Python.** Sin base servidor ni tareas de fondo. Es el candidato bueno. |
| **check** | principal · Micro | Node + Python, base servidor, contenedores | No. Varios servicios. |
| **confia** | principal · E3 **pagada** | Node con base servidor y conexión viva | No. Y es la única que cuesta dinero: ahí sí vale la pena mirar si se puede achicar. |
| **erp** | principal · A1 1/6 | Node + Python, base servidor, navegador/visión, contenedores | No. Es la más pesada de todas. |
| **bpo-demo** (callqa) | `bpo-demo` · Micro | Copilot de traducción simultánea: audio en tiempo real por WebSocket | No, y de las que menos: vive o muere por la latencia y la conexión abierta. |

## Qué se gana moviendo las dos que sí

En la cuenta principal el cupo que está agotado **no es CPU ni RAM: es el disco** (200/200 GB). Sacar `votantes`
libera su volumen —y de paso 1 OCPU y 6 GB de A1—, que es justo lo que hace falta para poder crear algo nuevo ahí
sin empezar a pagar almacenamiento.

Mover `daia` libera un Micro en la cuenta `bpo-demo`, que hoy tiene los dos ocupados.

Ninguna de las dos ahorra dinero (el A1 y el Micro son gratis, y Hostinger ya está pagado): lo que ganas es
**cupo libre** en OCI y una cosa menos que administrar por tu cuenta.

## Lo que falta saber del plan de Hostinger

Antes de mover nada, tres preguntas. La sonda (`herramientas/sonda-hosting/`) responde la primera; las otras dos
las responde el panel o el MCP de Hostinger:

1. **¿Mantiene el proceso vivo?** — para `votantes` no es crítico (FastAPI responde peticiones), pero define si
   algún día cabe algo más.
2. **¿Corre Python, o solo Node?** — `votantes` es FastAPI. Si el plan solo hace Node, no se mueve.
3. **¿Cuántas apps permite?** — si es una sola, hay que elegir; si son varias, caben `daia` (como sitio) y
   `votantes` (como app) a la vez.

## El orden que yo seguiría

1. **daia primero.** Es estático, el riesgo es cero y se revierte cambiando un DNS. Sirve además para aprender el
   panel de despliegue con algo que no duele si falla.
2. **votantes después**, si el plan corre Python. Ojo con una cosa: su base es **SQLite, un archivo**. Antes de
   mover, confirmar con la sonda que el disco sobrevive a un reinicio; si no, se pierden los datos en el primer
   redespliegue.
3. **El resto se queda en OCI.** No por capricho: necesitan contenedores, bases servidor o conexiones vivas.
