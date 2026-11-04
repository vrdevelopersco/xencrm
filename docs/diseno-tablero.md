# Diseño del tablero: decisiones y valores medidos

> **Ojo, 2026-10-12.** Desde el 2026-10-02 el tablero es **blanco, azul y plano**, «al estilo de una herramienta»,
> porque el cliente pidió que se pareciera al administrador de anuncios de Facebook (`442ce16`). Lo que este
> documento dice del vidrio, las manchas de luz, la crema con dorado y la hoja de bloc es historia: se quitó. Siguen
> vigentes las reglas de jerarquía, puntaje, quién habla, contraste, toque y las trampas. Lo último está al final,
> en «El orden de un CRM». **Antes de describir cómo se ve una pantalla, se toma una captura de la de verdad.**

Revisado con HRCAPOLO (sesión de UX) el 2026-09-11. Todo lo de abajo está medido con contraste WCAG compuesto,
no a ojo. Si tocas un color, vuelve a medir (el script está en el historial: luminancia relativa + composición alfa).

## Jerarquía
- Barra lateral agrupada: Trabajo (Hoy, Conversaciones, Calendario) · Ventas (Prospectos, Análisis) · Configuración (Perfil, Agente, Canales, Lo que sabe, Ayuda). En el celular, la barra de abajo lleva
  Hoy, Chats, Calendario, Prospectos y «Más»: una hoja con Análisis y Configuración en botones de 72 px, más tema,
  sonido y salir. «Más» se ve activo cuando la sección abierta está adentro; Escape o tocar fuera la cierran y el
  foco vuelve al botón.
- "Hoy" es la pantalla de entrada, ordenada por costo del silencio: esperan tu respuesta → pidieron una persona →
  citas de hoy → calientes sin seguimiento (>24 h, sin cita agendada) → sin leer con Aiva ya respondió → próximas citas.
  Las conversaciones vendidas o perdidas no piden acción.
- Una sola cola de calientes: Hoy manda; Análisis solo referencia el conteo (abre el filtro). Ninguna métrica es decorativa.
- Íconos monocromos con contadores numéricos aparte; el color queda para los chips de estado, y todo chip lleva texto.

## Puntaje
- Lo primero es el veredicto práctico, no el análisis: "Prospecto claro" (≥60), "Posible prospecto" (30-59),
  "Sin señales aún" (<30), "Prospecto con cita", "Cliente" (vendido) o "Perdido". Es lo único que aparece en listas,
  kanban y cabecera; factores, ánimo, urgencia y datos capturados van detrás de "Ver detalle" en la ficha.
- Nunca el número solo: "caliente · 72 · Pidió cita" (temperatura primero, número de respaldo, factor de más peso).
- Edad visible ("calculado hace X"). Si hay mensajes posteriores al último análisis, el puntaje está desactualizado:
  tono secundario en cursiva, chip con borde punteado y barra con trama. **Nunca opacidad**: con opacity .55 medía
  1.9:1 en claro y 2.6:1 en oscuro, invisible para media población.

## Quién habla
- El estado "la lleva Laura desde hace 10 min" vive en el servidor (users.human_by, human_since), no en un botón local,
  y lo ve cualquier asesor. Cada mensaje guarda su remitente real (customer / bot / human + nombre), nunca se infiere
  por posición. El segmentado "Responde: Aiva | Tú" va en su propia fila para no confundir responsable con puntaje.
- Que Aiva no pueda responder, o que un motor se caiga, son eventos de primera clase: notificación con sonido y la
  conversación entra en "esperan tu respuesta".
- Un estado se nombra por lo que el sistema sabe, no por lo que parece obvio. Cuando el bot pasa la conversación al
  equipo, human_by guarda "bot" (quién la pasó), pero nadie la ha tomado: el tablero dice "La lleva el equipo" hasta
  que una persona responda, nunca "La lleva bot" (2026-09-21, con HRCAPOLO).

## Vidrio (liquid glass)
Relleno rgba translúcido + `backdrop-filter: blur(24px) saturate(170%)` (barra) / `blur(20px) saturate(160%)` (resto),
sin degradado especular. El desenfoque solo en contenedores; filas y burbujas no lo llevan.

| Variable | Claro | Oscuro |
|---|---|---|
| `--glass` (contenedores) | rgba(255,255,255,.70) | rgba(24,28,36,.58) |
| `--glass-strong` (inputs, chips, tarjetas, burbuja del cliente) | rgba(255,255,255,.80) | rgba(24,28,36,.78) |
| `--glass-overlay` (notificaciones, avisos, login: flotan sobre contenido) | rgba(255,255,255,.92) | rgba(24,28,36,.92) |
| `--glass-border` | rgba(17,24,39,.08) hairline oscura | rgba(255,255,255,.09) |
| `--glass-inset` | inset 0 -1px 0 rgba(17,24,39,.06) (canto inferior, sin filo arriba) | inset 0 1px 0 rgba(255,255,255,.06) |
| `--muted` (texto secundario) | #5f6875 | #9aa3b2 |
| `--brand` | #276f45 | #5fbf86 |
| `--warn` (chip tibio) | #a3480a sobre #fef3c7 | #f59e0b sobre #3a2a08 |

Regla: las superficies que son hermanas en el flujo (barra, listas, ficha, kanban, cabecera del chat) tienen detrás solo
el lienzo fijo con la aurora; se miden contra su peor mancha. Las que flotan sobre contenido que puede desplazarse
(notificaciones, avisos, login, y el widget en el sitio del cliente) usan `--glass-overlay` (.92) y se miden contra
fondos pesimistas (negro puro bajo el panel claro, blanco puro bajo el oscuro).

## Contrastes medidos (texto secundario, peor fondo)
- Claro: contenedor .70 → 5.1:1 · fuerte .80 → 5.3:1 · flotante .92 sobre negro → 4.7:1, sobre gris medio → 5.1:1.
- Oscuro: contenedor .58 → 6.2:1 · fuerte .78 → 6.4:1 · flotante .92 sobre blanco → 5.4:1, sobre gris medio → 6.2:1.
- Chips de estado (opacos, nunca vidrio): caliente 5.3:1 / 5.9:1 · tibio 5.4:1 / 6.5:1 · atenuado 5.3:1 / 6.4:1.
- Texto principal ≥ 12.7:1 en ambos temas. Texto sobre el botón primario 6.1:1 (claro) y 8.6:1 (oscuro, texto oscuro).

## Toque
Área mínima de 44 × 44 px en botones de navegación en celular (padding invisible con pseudo-elemento), corte único en 900 px.

## Material (capa 3): profundidad, tacto y grano — 2026-09-21, con criterio de HRCAPOLO
El usuario no quiere un tablero plano: las piezas tienen grosor y se hunden al presionarlas, y hay grano de vidrio
y cartulina. Probado en tres piezas: botón primario, switch "Responde: Aiva | Tú" y citas del calendario.

Reglas:
1. **Todo relleno de color lleva su `--on-*` medido contra esa superficie; nunca se asume blanco o negro.**
   Aiva lo descubrió con el blanco sobre `--brand` oscuro (2.26:1) y sobre `--bad` oscuro (~2.8:1); es la
   misma ley que `--brand-ink` en APOLO y el `--accent` oscurecido en Confía.
2. **La textura va en lo que se toca o se escanea de un vistazo, nunca en lo que se lee de corrido.** Sí: botones,
   switch, citas, chips, píldoras de navegación. No: tablas (Consumo de IA), paneles de datos densos, fondos grandes
   (la barra lateral no lleva grano), burbujas del chat, ni detrás de donde alguien escribe.
3. **Un relieve o un grabado se valida al tamaño real en que se usa.** El grabado (`--emboss`) solo va en el botón
   primario; en controles densos difumina el trazo.
4. **El texto sobre textura se mide contra el peor píxel del composite real** (captura con el texto oculto), no
   contra el color base. Sobre grano y rayado se usa `--muted-strong` (70 % `--muted` + 30 % `--text`):
   `--muted` daba 4.00:1 en el peor píxel de la cartulina clara.
5. **Un color de vocabulario no se reutiliza para otra cosa.** "Tú" (modo humano) usa el amarillo de `--human`
   (el de los mensajes del equipo), no el ámbar de `--warn`, que significa tibio / posible / desactualizado.
6. **Quitarle todo el tacto a algo para marcar un estado se lee como roto.** Las citas canceladas quedan planas pero
   conservan el borde punteado y el texto "Cancelada".

Valores medidos (peor píxel real):
| Pieza | Claro | Oscuro |
|---|---|---|
| Texto sobre botón primario | 6.1:1 | 8.6:1 |
| "Tú" (texto sobre perilla amarilla) · filo ocre contra el canal | 11.4:1 · 5.4:1 | 11.4:1 · 10.8:1 |
| Detalle de la cita (`--muted-strong`) sobre cartulina con grano | 5.76:1 | 6.25:1 |
| "Ocupado" 11 px (`--muted-strong`) sobre rayado | 6.31:1 | 6.83:1 |

Orden sugerido para extender el material: chips → tarjetas del pipeline (solo el marco, nunca la zona de datos) →
campos de formulario (bisel hundido, sin grano). Las burbujas del chat quedan planas.

### Chips (hecho)
Etiquetas esmaltadas: grano, bisel y un filo en su tono (`--tone` por variante). No se presionan, así que no tienen
grosor ni estado presionado. El filo es decorativo: el estado lo dice el texto. Los desactualizados quedan planos,
punteados e itálicos. Con grano, el texto de color bajó a ~4.3:1 en el peor píxel en claro (frío 3.96:1); cada chip
tiene su tinta: `color-mix(--tone 78 %, --text)` (en claro oscurece, en oscuro aclara) y los neutros `--muted-strong`.
Peor píxel medido en las 18 variantes: ≥ 5.57:1 en claro y ≥ 5.62:1 en oscuro. "La lleva…" usa el amarillo de
`--human` con filo `--human-edge`, igual que "Tú" en el switch.
La tinta se deriva con fórmula, no se elige a mano por variante: con 18 variantes a mano se desincroniza la primera
vez que alguien toque un tono. Al medir el peor píxel de una forma redondeada, se muestrea la franja central: el
antialiasing de la curva ensucia la lectura igual que un fondo en movimiento. Límite a vigilar: la itálica de los
desactualizados sirve en etiquetas cortas; si ese texto crece, itálica e interletrado apretado es lo primero que se
vuelve ilegible.

### Marco de las tarjetas del pipeline (hecho, 2026-09-21)
Las tarjetas se toman y se sueltan: son una pieza con marco de cartulina (grano, bisel y un filo en el tono de la
etapa de su columna: gris, ámbar, verde de marca, verde de venta, rojo). **Solo el marco lleva textura**: la zona de
datos es una etiqueta lisa y opaca (`--panel`, no el vidrio translúcido, para que el grano no asome detrás del
texto), así que su contraste es el de siempre (detalle 5.9:1 en claro y 7.0:1 en oscuro). El tono del marco repite
lo que dice el título de la columna: no es la única señal.

- Al pasar el cursor, se levanta.
- Al arrastrarla, deja su hueco punteado; la columna de destino se hunde (`--well`) con un tinte de su tono.
- Con movimiento reducido, no se mueve.

Se abre con Enter o espacio (`role="button"`, foco visible con `--ring`). El puntaje no se parte en dos líneas: el
que se parte es el nombre.

### Campos de formulario (hecho, 2026-09-21)
Un campo es un hueco donde se escribe: bisel hundido (`--sunk`: sombra adentro arriba, filo de luz afuera abajo),
sin grano porque ahí se lee y se escribe. Antes llevaban `--rim`, que es relieve: la dirección contraria. En claro
el hueco es papel blanco; en oscuro es más oscuro que la superficie (`#0f1217`), como se ve un hueco de verdad.

Al medir apareció que el foco no cumplía: la marca al 45 % daba ~1.9:1 sobre el panel claro (el mínimo para un
indicador de foco es 3:1). Ahora los campos llevan contorno de 2 px en la marca sólida (6.1:1 claro, 7.7:1 oscuro)
y `--ring` (botones, switch, tarjetas) es un filo del color del panel más la marca sólida, que se ve sobre cualquier
fondo, incluido el botón primario. El texto de ejemplo de los campos usa `--muted` (5.6:1 claro, 7.4:1 oscuro); el
texto escrito en oscuro queda a 15:1.

Con esto queda recorrido el orden de HRCAPOLO (chips → marco del pipeline → campos). Las burbujas del chat siguen planas.

### Colores de dato aparte del acento (2026-09-21, pregunta de HRCAPOLO)
La etapa "Cita agendada", la etiqueta "Tiene cita" y las citas del calendario usaban `--brand`, el mismo acento de
los botones; el "Sí" del veredicto y la zona "prospecto" de la barra de probabilidad, también. Si el acento cambia
(otra marca, otro tema), una etapa cambiaría de significado sin querer. Ahora los datos llevan su token: `--cita`
(citas) y `--si` (veredicto "sí"). Hoy tienen el mismo valor que la marca; lo que importa es que ya no dependen de
ella. `--brand` queda para acciones, selección y navegación.

Temperatura y veredicto eran el mismo puntaje (0–100, cortes en 60 y 30, `temperature()` en el analizador y
`verdict()` en el tablero) pintado con dos reglas: "100 · caliente" salía **rojo** en la tarjeta y la barra del
detalle, **verde**. Peor: el rojo de "caliente" (el mejor prospecto) era el mismo de "Perdido" (el peor). Se unificó
por el veredicto: caliente usa `--si` (verde), tibio el ámbar de "posible", frío el gris de "sin señales". El rojo
queda solo para perdido y errores. Las palabras siguen siendo dos ("caliente" en tarjetas, avisos y Hoy; "prospecto
claro" en la ficha); el color ya no las contradice. Por criterio de HRCAPOLO las palabras **no** se unifican: el
color es lo que tiene que ser uno solo; "caliente" es lenguaje de momento (tarjetas, avisos, Hoy: mirar ahora) y
"prospecto claro" es lenguaje de juicio (la ficha: evaluar con calma). Como puente, la ficha dice bajo la barra
"Probabilidad 100 (en tarjetas y avisos: caliente)": nombra el mismo número en el otro vocabulario, sin inventar una
explicación del puntaje (no es de actividad: sale de las señales de compra de la conversación). "Frío" se muestra
con tilde (el valor interno sigue siendo `frio`).

### Cambiar de etapa sin arrastrar (2026-09-21, pregunta de HRCAPOLO)
Solo se podía arrastrando con el mouse (o desde la ficha del contacto). En el celular, arrastrar no funciona con el
dedo, así que desde el teléfono el tablero no dejaba mover nada. Cada tarjeta tiene ahora «Mover a…», una lista
nativa (teclado, lector de pantalla y selector del teléfono) con las otras etapas: 32 px con mouse y 44 px con el
dedo (`pointer: coarse`). Después de mover, el foco sigue a la tarjeta en su nueva columna y se anuncia "Movida a …"
(región `role=status`). Para no anidar controles dentro de un botón, la tarjeta ya no es `role=button`: el nombre es
el botón que abre la conversación (el clic en cualquier otra parte de la tarjeta también la abre, salvo en la lista).
Al redibujarse por un evento en vivo, el foco vuelve a la misma tarjeta.

Decisiones:
- La página pública de la cita sigue el tema del sistema a propósito: es una utilidad de calendario, no una pieza de
  marca, porque aiva todavía no tiene la piel de cada cliente. Cuando la tenga, esa página debe usarla fija.
- El enlace secreto del calendario va enmascarado; "Copiar enlace" es la acción principal y "Mostrar" es opcional.


## La marca de la casa (2026-09-25)

Hasta aquí cada pantalla se había diseñado sola: la portada por un lado, la consola por otro, el tablero por otro.
Se sentía cambiar de aplicación al pasar de una a otra. Ahora las tres hablan el lenguaje de
**hrctechnologies.com**, que es de donde viene el producto:

| | Valor |
|---|---|
| Tipografía | **Figtree** (400/500/600/700), con fallback del sistema |
| Papel | `#f6f5f1` claro · `#14120d` oscuro |
| Tinta | `#14110c` claro · `#f0ece4` oscuro |
| Acento | **dorado** `#7b660f` claro · `#e2c04c` oscuro |
| Dorado vivo | `#f1cb05`, el del chip del logo: solo en manchas pequeñas, nunca debajo de texto |
| Línea | `#e8e4da` claro · `#2e2a22` oscuro |

El **verde se queda donde significa algo** —confirmado, cita cumplida— y no como acento: un dato no debe cambiar de
sentido porque cambie la marca. Es la misma regla de «colores de dato aparte del acento», ahora que el acento
cambió de verdad.

El logo de HRC viene blanco sobre transparente (solo sirve en oscuro); para fondo claro hay una versión con el
texto en tinta y el chip con su dorado intacto, en `public/hrc-technologies.png`.

### Contrastes medidos (2026-09-25)

| Sobre | Ratio |
|---|---|
| Tinta sobre papel, claro | 17.3:1 |
| Gris secundario sobre papel, claro | 6.4:1 |
| Dorado sobre papel, claro | 5.4:1 |
| Blanco sobre el botón dorado | 5.6:1 |
| Tinta sobre papel, oscuro | 15.9:1 |
| Gris secundario, oscuro | 6.8:1 |
| Dorado sobre papel, oscuro | 10.6:1 |

### El modo oscuro, ya renderizado y medido (2026-10-01)

Hasta hoy los valores de oscuro estaban **calculados, no vistos**: el tablero fija el tema al arrancar y pisa lo que
uno ponga a mano en una maqueta. HRCAPOLO se negó a validarlos por eso, y tenía razón.

Ya está pintado, con Chrome de verdad: entrar, darle al 🌙 hasta que `data-theme` diga `dark`, ir a Prospectos, y
medir **sobre los píxeles**: se oculta el texto (`color:transparent`), se captura, y se busca dentro del recuadro de
ese texto el peor píxel —el que más se le parece en luminancia—. Así es como se midieron los chips en septiembre.

| Pieza | Calculado | **Medido** |
|---|---|---|
| Nombre en la tarjeta (hoja de bloc) | 13.8:1 | **11.63:1** |
| Detalle de la tarjeta, sobre los renglones | 6.4:1 | **5.41:1** |
| Título de la pantalla, sobre el vidrio | 15.9:1 | **14.59:1** |

🪤 **Los tres salieron entre 1 y 2 puntos por debajo de lo calculado, y en la misma dirección.** Ninguno incumple
—el mínimo es 4.5:1 y el peor queda en 5.41— pero el margen real es menor del que decía esta tabla. La causa es la
de siempre: el cálculo usa el color base de la superficie y lo que hay pintado lleva encima el grano del papel, el
renglonado y el vidrio con la aurora detrás. Quien toque estos colores no tiene 2 puntos de margen que creía tener.

🪤 Y una advertencia sobre el método: medir el recuadro de un CONTENEDOR no sirve. La caja de `.card .body`
incluye los chips con su propio fondo, así que el «peor píxel» que sale es el de un chip verde y el número no
significa nada. Solo vale sobre el recuadro del texto en sí.

### El tablero de prospectos se pinta por el papel de la etapa (2026-09-25)

Las columnas tenían el tono fijado por el **nombre** de la etapa (`interesado`, `cita_agendada`, `vendido`). Con
el embudo por negocio eso significa que cualquier cliente que no fuera una boutique veía el tablero **entero en
gris**: una financiera tiene "En revisión" y "Resuelto", que no están en esa lista. Ahora el tono sale del
`rol` (`activo`, `interes`, `cita`, `ganado`, `perdido`), que es lo único que significa lo mismo en todos los
negocios. La cita tiene tono propio (azul) en vez de compartir el dorado del acento: es un estado distinto, no
"lo más importante".

### Cada tarjeta es una hoja de bloc (2026-09-25)

Donde una tarjeta representa **a una persona** —un prospecto en el tablero, algo por atender en la consola— la
tarjeta es una hoja de bloc de notas: cabezal de color con su costura, la perforación de arrancar mordiendo el
cabezal, papel con renglones cada 22 px y el margen rojo a la izquierda. El texto va con `line-height: 22px`
para que se siente **sobre** los renglones: ese es el detalle que lo vende.

Por qué, y no como capricho: esto no es otro CRM de filas grises. Lo que hay en esa tarjeta es lo que alguien
apuntaría en una libreta —quién llamó, qué quería, para cuándo—, y el objeto lo dice antes de leerlo.

Tres reglas para que no se vuelva disfraz:
- **El color sigue significando lo mismo.** El papel es igual en todas; lo que cambia es el cabezal, que lleva el
  tono de la columna (su etapa, o su urgencia en la consola). El adorno no pisa el dato.
- **Solo donde hay una persona detrás.** Las filas de clientes, los paneles de Hoy y los modales siguen siendo
  vidrio: convertir todo en papel sería ruido.
- **El texto se mide igual.** Sobre el papel claro, 18.4:1 el principal y 6.8:1 el secundario; sobre el oscuro,
  13.8:1 y 6.4:1.

### Vidrio, y por qué necesita luz debajo (2026-09-25)

El material vuelve a ser **vidrio**, ahora en las tres pantallas: superficies translúcidas (50 % de blanco),
`blur(22px) saturate(180%)` y un filo de luz arriba (`inset 0 1px 0 rgba(255,255,255,.9)`). Antes solo el
contenedor era vidrio y el contenido iba sólido encima: el efecto no se leía.

🪤 **El vidrio sin nada detrás es gris.** Necesita color debajo para desenfocar, así que las tres pantallas
llevan manchas de luz fijas (`body::before`): dorado arriba a la izquierda, azul a la derecha, y una rosada y una
cálida abajo. Sin ellas se pierde media hora subiendo el desenfoque sin entender por qué no pasa nada.

Lo que **no** cambia: el texto nunca va sobre el vidrio sin medir. Lo peor que puede quedar debajo de una
superficie translúcida es una mancha clara, y ahí el texto principal sigue en 16:1 y el secundario sobre 6:1.

### La consola tiene cuerpo de aplicación (2026-09-25)

Era una barra con todo encima y nada más: sin menú, sin sitio donde estar. Ahora tiene la misma forma que el
tablero de un cliente —barra lateral con la marca, las secciones y, abajo, el perfil con su avatar— porque son
dos aplicaciones hermanas y cambiar de una a otra no debería sentirse como cambiar de producto. Bajo 900 px la
barra lateral se acuesta arriba.

### El color de una marca casi nunca se lee (2026-09-25)

El dorado de DUNOR (#b6a16d, el del logo, medido del manual) da **2.24:1** sobre el papel claro: como texto es
ilegible. Por eso el servidor no manda el color de la marca a secas, sino **ya ajustado a cada fondo**
(`accentOn`): #766947 sobre claro (4.79:1) y el dorado intacto sobre oscuro (7.4:1), que ahí sí se lee. La marca
se conserva donde es relleno —el chip, el botón, el logo— y se oscurece solo donde tiene que leerse.

### Tres trampas que costaron caro

Las tres dan el mismo síntoma —«la página no hace nada»— y ninguna la coge una prueba de HTTP.

1. **`display` suelto le gana a `[hidden]`.** `.entrada{display:grid}` en el login: el navegador le pone
   `display:none` a `[hidden]`, pero una regla propia manda más. Después de entrar, el login se quedaba encima de
   la consola. Sale con `[hidden]{display:none!important}`.
2. **Lo mismo con `<dialog>`.** `dialog.panel{display:flex}` dejaba el panel a la vista con el diálogo cerrado. El
   `display` va en `dialog[open]`, nunca suelto.
3. **El marcado que el JavaScript engancha tiene que existir antes que el `<script>`.** Un `<dialog>` puesto
   *después* de `<script src="admin.js">` hacía que `$('cfg-cerrar').onclick` reventara con `null` y se cayera el
   JavaScript **entero** del tablero: se veía la pantalla de token porque no llegaba a arrancar nada.

La tercera vivió un día entero sin que nadie la viera: el servidor contestaba 200 y el HTML era correcto. Salió
abriendo la página en un navegador de verdad con la sesión puesta (`node herramientas/mirar.mjs`), que imprime los
errores de JavaScript. **Una pantalla nueva no está probada hasta que se abre en un navegador.**


## Dos formas de que una pantalla esté rota sin que nada lo diga (2026-10-01)

Al documento ya le costó caro la tercera trampa de arriba, y la lección que dejó —«una pantalla nueva no está
probada hasta que se abre en un navegador»— resultó estar incompleta. Faltaban dos formas más, y las dos
aparecieron el mismo día:

1. **En el ancho en que de verdad se usa.** La consola se desbordaba 104 px a 390 px: la página entera medía 494 y
   se desplazaba en horizontal. Causa: añadirle una cuarta pestaña al riel, que en móvil es una fila; sin
   `min-width:0` en la cadena de flex/grid, un hijo no baja de su ancho natural y empuja al padre, el padre a la
   página, y la página se lleva por delante toda la pantalla. Abrirla en un navegador no basta si se abre a 1280.
2. **Con la regla que de verdad gana.** El arreglo de arriba no se aplicaba: estaba escrito en un bloque `@media`
   que va ANTES de la regla base en la hoja, y entre dos reglas de la misma especificidad gana la última. No da
   error, no lo ve TypeScript, el servidor contesta 200 y el HTML es correcto. Solo se ve en una captura a 390 px.

De ahí la regla ampliada: **una pantalla nueva no está probada hasta que se abre en un navegador de verdad, al
ancho de un teléfono, y se mide lo que quedó pintado** — no lo que dice la hoja de estilos que debería quedar.

## El orden de un CRM (2026-10-12)

El usuario vio un CRM tipo Attio que le gustó mucho. Se le preguntó si quería ese estilo y eligió **quedarse con el de
hoy** y tomar del video las pantallas, las funciones y los detalles. Se tomó el orden, no el estilo:

| Del video | En aiva |
|---|---|
| Números al lado de cada sección | En gris, Prospectos abiertos y Clientes. Las insignias rojas siguen siendo solo para lo que urge |
| Listas guardadas y favoritos | *Calientes* y *Míos* en la barra, y las fichas **fijadas**, que son de quien mira y se guardan en la base con su nombre |
| Tabla con dueño, valor y próximo paso | Clientes: *La lleva*, *Valor*, *Próximo paso*; pestañas con su número; orden por columna; suma al pie |
| Kanban con valor por columna | Prospectos: cuatro cifras arriba, barra por etapa, suma por columna, valor y paso en cada tarjeta |
| Ficha con historia, detalles y «1 de 23» | La ficha en dos columnas, notas con autor y fecha, etapa editable ahí mismo, fijar |
| Bandeja de tres paneles | Los filtros pasan encima de la lista; el panel aparte le quitaba 212 px a la conversación |

Las reglas de antes siguen mandando sobre lo nuevo:

- **La etapa es pastilla con punto Y nombre.** El punto solo no lo distingue todo el mundo.
- **Lo urgente es ámbar Y empieza por un verbo** («Contestar», «Retomar»). El color no es la única señal.
- **Sin valor es «—», nunca «$0».** Cero diría que no vale nada; lo que pasa es que no se sabe. Si nada tiene
  precio, las cifras de arriba dicen «Sin precios», como Hoy.
- **El próximo paso no usa modelo** (`src/crm/proximo.ts`): sigue el orden de Hoy, y «Retomar» o «Escribirle» son
  exactamente los de Seguimientos. `test:proximo` falla si alguna vez dejan de coincidir.
- **«bot» y «admin» no son nombres.** En la historia y en *La lleva* salen como el nombre del asistente o «El
  equipo».
- **La barra de colores de Prospectos va oculta para un lector de pantalla.** Repite lo que dicen las sumas de las
  columnas, que sí se leen.

### La consola, con la misma piel (2026-10-12)

La consola seguía con crema, dorado, vidrio y hojas de bloc: abrir un tablero desde ella se sentía como cambiar de
producto. Por dentro ahora habla igual que el tablero: barra oscura con rótulos y números, superficies blancas,
el mismo azul y las tarjetas de Atender lisas con la franja de su urgencia a la izquierda, como Hoy. Lo de una vez al
mes de cada cliente pasó a un menú **⋯**.

🪤 **La entrada no cambia.** Es el puente desde la portada y se parece a ella. Por eso los colores nuevos no van en
`:root` a secas sino en `:root:has(#app:not([hidden]))`: mandan solo con la aplicación a la vista, y así también
alcanzan a los diálogos, que viven fuera de `#app`. `test:tablero` falla si alguien los sube a `:root`.


### La portada, con menos texto (2026-10-12)

El usuario la sintió con mucho texto, y tenía razón: 385 palabras en siete bloques, casi todo párrafos. Ahora cada
sección dice una cosa en una línea y quedan menos de 250 palabras. Lo que decían los párrafos lo dice una **vista
del tablero** hecha con HTML, con sus colores de verdad (blanco, azul, barra oscura), aunque la página siga con el
dorado de la casa: enseña lo que uno va a ver al entrar. Lleva `role="img"` y su descripción, porque para un lector de
pantalla una tabla de ejemplo sería ruido. `test:tablero` avisa si la portada vuelve a pasar de 260 palabras.

## Más sencillo para quien empieza (2026-10-21)

Le dijeron al usuario que aiva era «complejo de usar» y le mostraron Vocero, un CRM de WhatsApp de código abierto.
Se comparó con capturas de los dos: Vocero se ve sencillo porque hace menos (desde su 2.0 no trae agente, no
puntúa, y su ficha arranca vacía), así que copiarle la cara no habría simplificado nada. Lo que sí se tomó:

| De dónde | En aiva |
|---|---|
| Su panel de la conversación ES el perfil | El panel derecho de Conversaciones pasó de formulario a perfil: quién es, qué quiere, nota fija, Detalles, «Lo que contó», citas e historia. El formulario, detrás de **Corregir datos** |
| Pocas secciones | El riel bajó de ocho a cinco: Hoy, Conversaciones, Calendario, **Clientes** (Lista · Por etapa · Seguimientos) y **Análisis** (Resumen · Ventas). Nada se quitó: lo demás son pestañas arriba de la pantalla |
| — | Visitantes sin nombre como «Visitante del sitio · 44fa», no «web · 44fa379b». Datos capturados como palabras («Ocasión», «Talla o medidas»), no como variables |

Reglas que salen de aquí:

- **El área en el riel, la pantalla en la pestaña.** El título de cada pantalla de un área dice el área («Clientes»)
  y la pestaña encendida dice cuál. Es la misma regla de Configuración: cada nivel aporta algo, nadie repite.
- **Pestañas arriba, no un panel de sección al lado.** El panel le quita 212 px justo a las pantallas que más ancho
  necesitan (el tablero por etapa y la tabla). Por eso se quitó también de Conversaciones.
- **Un área se abre donde se dejó.** Quien vive en «Por etapa» no pasa por la lista cada vez. Es comodidad de cada
  quien, en su navegador (`aiva.admin.<cliente>.areas`), y si no hay nada guardado se abre la primera pestaña.
- **Lo urgente gana al conteo.** El botón de Clientes lleva la cifra gris de cuántos hay; si hay calientes esperando
  seguimiento, la insignia roja ocupa ese sitio y la cifra se calla.
- **Repintar no borra lo que se escribe.** El perfil se vuelve a pintar con cada análisis y cada mensaje. Lo que
  lleva `data-borrador` y los `<details data-k>` abiertos se guardan antes y se devuelven después, solo si es la misma
  persona. Cualquier campo nuevo del panel lleva `data-borrador`.
- **«Lo que contó» va a la vista en el perfil.** La regla del puntaje sigue en pie (en listas, tablero y cabecera, el
  veredicto y nada más; el porqué detrás de un clic), pero en el perfil lo que la persona contó ES el perfil, y por
  eso no se esconde. Lo que sí va detrás de un clic es el porqué del puntaje.

- **La tarjeta del tablero enseña una pieza solo si dice algo** (2026-10-21, `2e4f8ba`), la misma regla que la
  lista de conversaciones. El puntaje, si es caliente; el paso, si urge o es cita, y en su propia línea (al lado del
  selector se cortaba); el valor, si se sabe; quién la lleva, si es una persona. **«Mover…» se queda en todas**: es
  lo único que deja mover desde el celular. Achicarlo sí; quitarlo, no.

🪤 **Las tarjetas aplastadas.** Desde la piel blanca y azul (2026-10-02), `.card` lleva `overflow:hidden` para la
franja de color de arriba. En una columna flexible eso deja que el navegador encoja las tarjetas hasta 48 px cuando
la columna se llena, y solo se veía la pastilla «0 · frío» y medio nombre. Con pocas tarjetas no pasa, así que en
una demostración no se ve; con un cliente de verdad, sí. `.col .cards>.card{flex-shrink:0}` lo arregla: la que se
desliza es la columna, no la tarjeta.

### La guía de inicio (2026-10-21)

La de Vocero, en aiva: pasos que se marcan solos, con el motivo de lo que falta. Reglas:

- **Hecho lo dice el servidor, no el navegador.** `GET /admin/api/guia` (`src/crm/guia.ts`) mira lo mismo que el
  asistente para contestar: el perfil que lee, el catálogo con el que cotiza, el canal que recibe. El tutorial de
  Ayuda guarda «ya lo hice» en el navegador y puede mentir; la guía no guarda nada salvo «Ocultar por ahora».
- **Lo que existe por defecto no cuenta como hecho.** El horario de citas siempre tiene valor (el de ejemplo), así
  que «hecho» es que alguien lo haya escrito en el archivo, no que haya uno. Lo mismo vale para cualquier paso nuevo
  con un valor de fábrica.
- **Sin modelo y sin red.** Se pide cada vez que se abre Hoy. La dirección pública se lee del último chequeo;
  `test:guia` falla si pedir la guía hace una sola llamada a la red.
- **Ámbar para lo obligatorio que falta; gris para lo opcional.** El ámbar es lo que urge (regla de «El orden de
  un CRM»), y lo opcional no urge. Cada título es un verbo («Llena», «Conecta», «Pon») y el botón dice adónde
  lleva («Abrir el perfil»), igual en Hoy y en la guía.
- **Para quien administra.** Los pasos llevan a pantallas que un asesor no toca; el asesor sigue viendo el
  tutorial en Hoy.

## El modo fácil (2026-10-23)

Quien revisó aiva para DUNOR pidió un tablero sencillo, y el usuario lo dijo así: aiva puede seguir siendo lo
más completo, pero DUNOR quiere un «aiva modo fácil», con un interruptor para no dañar lo hecho. Es la regla de
siempre (sencillo por fuera, todo a un clic adentro) con un interruptor en vez de un nivel más de menú.

| Se esconde en el modo fácil | Se queda |
|---|---|
| Análisis (el riel queda en cuatro) y la pestaña Seguimientos | Hoy, Conversaciones, Calendario, Clientes (Lista · Por etapa) |
| El puntaje: la fila «¿Prospecto?», «Por qué ese puntaje», la línea de la cabecera, la columna de Clientes y las pastillas «0 · frío» | La pastilla «caliente», que sí pide hacer algo |
| «La lleva», «Llegó por», «Volvió», «Desde» | Etapa, Próximo paso, Valor y **A cargo** |
| El «¿por qué?» de cada respuesta, las cifras de arriba de Por etapa | La conversación entera, con sus marcas |
| Filtros «Con una persona», por etapa y «Archivados» | Todos · Sin leer · **Míos** · Prospectos |
| El asistente y Trazabilidad, en Configuración | Guía, Perfil, El negocio, Canales y Lo que sabe |
| En Hoy, los recuadros vacíos | Los que tienen algo, o «Todo al día» si no hay nada |

Desde el 2026-11-04 el modo fácil tiene el menú de Nexora y Analítica, Ventas y Seguimientos vuelven a él (ver
«El modo fácil se viste de Nexora», abajo). Lo demás de esta tabla sigue igual.

Reglas:

- **Esconder, nunca quitar.** Lo escondido lleva la clase `solo-completo` y lo apaga una sola regla de CSS
  (`:root[data-modo="facil"]`). Ni un `if` por pantalla: así lo que se agregue mañana se esconde marcándolo, y no
  hay dos versiones del tablero que mantener.
- **Dos interruptores, los dos de quien administra aiva** (desde el 2026-11-03, ver «El candado» abajo). El del
  cliente (Configuración › *Modo fácil para el equipo*, o «⋯ › Poner el modo fácil» en la consola) vive en su base,
  en `settings`, y no en `aiva.config.json`: la configuración de cada cliente en Hostinger es la de sus datos y el
  ZIP no la pisa. El suyo (Configuración › *Modo fácil*) vive en su navegador, para revisar lo avanzado sin sacar
  a nadie del modo. Quien cambia el del equipo pasa a verlo como su equipo.
- **El interruptor dice cómo está** («Sí»/«No»), y en Hoy, abajo, «Ver todo lo de aiva» (solo para quien manda).
  Un modo que no se sabe que existe es una función que se perdió.
- 🪤 **Lo que se pinta con JavaScript reescribe la clase.** La línea del puntaje de la cabecera tenía
  `solo-completo` en el HTML y `renderChat` le ponía `className` entero: el modo fácil la seguía enseñando. Se vio
  en la captura, no en las pruebas; `test:revision` vigila ahora ese caso.
- **Sin decir nada, completo.** HRC y CONFIA siguen como estaban; DUNOR se pone en fácil desde su tablero.

### El candado (2026-11-03)

DUNOR quiso más: que se viera mucho más simple y que nadie de su lado pudiera salirse, ni su admin. Desde entonces,
con el modo fácil puesto, **solo el super-admin** lo quita y ve lo avanzado; el admin del cliente y los asesores
atienden y nada más.

| Con el candado | Quién |
|---|---|
| Prende o apaga el modo, ve lo avanzado desde su navegador | super-admin (y el token a secas) |
| Atiende: contesta, adjunta, toma y entrega conversaciones, mueve etapas, anota, agenda, archiva, une fichas, contesta lo que aiva pregunta | todos |
| Configura (Perfil, El negocio, Canales, El asistente, Lo que sabe, la guía), ve lo que cuesta aiva, baja en Excel, borra fichas, el simulador | solo el super-admin |

Desde el 2026-11-04, Analítica, Ventas y Seguimientos **sí** se ven con el candado: están en el menú de Nexora, la
muestra del modo fácil (ver abajo), y son del que vende. Siguen cerradas la configuración y lo que cuesta.

Reglas:

- **Lo cierra el servidor, no el botón** (`src/channels/candado.ts`). La consola manda el rol en `x-aiva-rol`,
  sacado de la sesión (y tira el que mande el navegador), y el cliente lo cumple según su modo. Sin esa cabecera
  no hay candado: es el token a secas, que abre cualquier ruta igual.
- 🪤 **Lo que se puede cambiar es una lista cerrada** de lo del día a día; lo que se puede leer es todo menos lo
  avanzado. Así una ruta de configuración nueva nace cerrada para el candado, y el tablero no se queda en blanco
  por cerrar de más lo que lee al arrancar.
- **Ninguna puerta abre lo cerrado**: ni el menú, ni un aviso del sistema, ni el «cárgalos» de los precios, ni la
  guía de inicio de Hoy, ni la Ayuda. `go()` frena las pantallas de quien administra, los avisos del sistema no le
  llegan, y la Ayuda quita los pasos y preguntas que llevan a ellas.
- **Más sencillo para todos en el modo fácil**: sin los números de arriba de Hoy, sin Calientes y Míos en el riel
  (ya son filtros; los fijados se quedan), sin la insignia de Seguimientos, sin «Prospecto claro» ni «Posible
  prospecto» (se van con el puntaje) y sin «Bajar en Excel».

### La ficha y la entrada directa (2026-11-03)

DUNOR mandó un audio: «modificar contacto» solo dejaba nombre y teléfono, y al entrar había que pasar por la
consola y darle a «Abrir tablero» para que se abriera otra página.

- **Lo de contacto, para todos los clientes y en los dos modos**: correo, WhatsApp (si es otro número), Instagram,
  Facebook y «Nos contactó por» (opciones en `crm.contactoPor`). Salen como enlaces que se tocan (`mailto:`,
  `wa.me`, el perfil) y solo lo que hay. Atender bien a alguien no es «avanzado»: nada de esto lleva `solo-completo`.
- **Lo que contó se corrige**, con los campos que capta cada negocio (`crm.fields`). Lo que escribe el equipo queda
  marcado (`data._amano`) y el análisis no lo vuelve a pisar; borrar también marca.
- **Se limpia, no se rechaza**: el Instagram o el Facebook pegados como enlace quedan en el usuario, el WhatsApp en
  dígitos, el correo en minúscula. Lo que no se puede limpiar (un correo sin arroba) se rechaza entero, sin guardar
  la mitad del formulario, y lo escrito se queda en pantalla para corregirlo.
- **Quien atiende un solo cliente entra directo a su tablero** al iniciar sesión. Vuelve a la consola (su Equipo, su
  cuenta) desde Configuración › Volver a la consola, y «Salir» cierra la sesión de verdad.

### El modo fácil se viste de Nexora (2026-11-04)

DUNOR mandó Nexora (un CRM hecho en ChatGPT, que por dentro se llama «Vindex IA») como muestra: «que se vea igual,
pero en nuestro producto». El modo fácil tomó su piel y su estructura; aiva sigue igual por dentro. Para copiarla
sin entrar con clave se armó en local con su propio código público y datos de ejemplo.

| De Nexora | En aiva |
|---|---|
| El menú blanco con dos grupos: *Principal* (Inicio, Analítica, Inbox) y *CRM* (Contactos, Citas, Pipeline, Ventas, Seguimientos); abajo Configuración y quién eres | Las mismas pantallas de siempre, cada una con su puerta (`MENU_FACIL`): ninguna nueva |
| La barra de arriba: buscar (⌘ K), «Crear», ayuda, avisos, tu cuenta | La búsqueda de Ctrl+K, la ficha nueva y la agenda, la Ayuda, la campana, tu nombre / Configuración / Salir |
| Inicio: cuatro números, *Rendimiento comercial*, *Pipeline por etapa*, *Actividad reciente*, *Resumen inteligente* | Los números de /today, conversaciones nuevas y citas agendadas por día, cuántos hay en cada etapa, los avisos, y el resumen del día (lo que espera a alguien, contado). Los recuadros de Hoy con algo van al final |
| Inbox en tres columnas; la conversación con «Tomar control»; el resumen al lado con «Abrir Cliente 360°» | La bandeja de siempre con iniciales y canal en cada fila; «Tomar control» toca el mismo Aiva/Tú; la ficha de al lado con «Lo que busca» |
| Contactos en una tabla con buscador y filtro; Cliente 360 como página | La tabla de Clientes, el buscador y los grupos debajo del título; la ficha completa ocupa la zona de trabajo |
| Citas, Pipeline, Ventas, Seguimientos, Analítica | Las de aiva, con sus controles en tarjetas y sus columnas grises |

Reglas:

- **Todo detrás del modo fácil.** Los estilos van en un bloque aparte (`Modo fácil: el aspecto de Nexora`) y cada
  regla empieza por `:root[data-modo="facil"]` o es de una pieza que solo existe ahí (`fx-…`, `solo-facil`).
  `test:facil` lee el bloque regla por regla: una suelta cambiaría también el completo.
- **Se muda, no se copia.** El buscador de Contactos y los controles del calendario van a otro sitio en el fácil, y
  se mudan (`mudarParaElFacil`): dos copias serían dos estados que se desincronizan. Cada pieza deja una marca
  donde vivía y vuelve a su sitio exacto al quitar el modo en vivo.
- **Nada inventado.** Ninguna cifra se estima para llenar una tarjeta: si no hay datos, la tarjeta lo dice. La curva
  de la gráfica es monótona: no baja de cero entre dos días sin nada ni se pasa del día más alto.
- 🪤 **La ficha como página sigue siendo un diálogo**, y lo de fuera no responde: un clic en el menú la cierra y
  sigue hasta donde iba.
- 🪤 **El celular no tiene la barra de abajo**: el menú se abre desde la barra de arriba, como en Nexora. Las reglas
  de la barra de abajo del completo (`.rail nav` en fila, el alto que se le restaba al contenido) se anulan aquí.
- **Los colores son los de Nexora** (la paleta pizarra y el azul 600), en tokens `--fx-…`, con su tema oscuro, y la
  letra es Inter. Lo de aiva que no se rehízo toma los mismos tokens y no desentona.

### Lo que también salió de la revisión

- **A cargo** no es **La lleva**: la lleva quien contesta ahora (se borra cuando vuelve el asistente); a cargo es de
  quién es el cliente, y se queda. Lo pone quien toma la conversación si no había nadie, «Entregar a», o la ficha.
  «Míos» es lo que está a cargo de uno o lo que uno atiende ahora, con la misma regla en el servidor (`esDe`) y en
  el tablero (`esMia`).
- **Por qué se perdió** se pregunta al pasar a perdido, desde cualquiera de los cuatro caminos (la ficha, el
  perfil, arrastrar y «Mover…»), y es opcional: una pregunta obligatoria para mover una tarjeta enseña a contestar
  cualquier cosa. Ventas cuenta los motivos y, aparte y a la vista, las que no dijeron por qué.
- **Lo que no le llegó al cliente** se marca en el mensaje (borde punteado y la palabra, no solo el rojo), con el
  motivo y «Volver a intentar».
- 🪤 **Los colores de Hoy estaban corridos un puesto** desde que entró «Te escribieron en un grupo»: diez recuadros
  y nueve colores, así que «Esperan tu respuesta» salía azul en vez de rojo. `test:revision` compara las dos cuentas.

