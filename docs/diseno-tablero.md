# Diseño del tablero: decisiones y valores medidos

Revisado con HRCAPOLO (sesión de UX) el 2026-09-11. Todo lo de abajo está medido con contraste WCAG compuesto,
no a ojo. Si tocas un color, vuelve a medir (el script está en el historial: luminancia relativa + composición alfa).

## Jerarquía
- Barra lateral agrupada: Trabajo (Hoy, Conversaciones, Calendario) · Ventas (Prospectos, Análisis) · Configuración (Agente, FAQ).
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

Decisiones:
- La página pública de la cita sigue el tema del sistema a propósito: es una utilidad de calendario, no una pieza de
  marca, porque aiva todavía no tiene la piel de cada cliente. Cuando la tenga, esa página debe usarla fija.
- El enlace secreto del calendario va enmascarado; "Copiar enlace" es la acción principal y "Mostrar" es opcional.

