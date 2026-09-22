// Pruebas de qué modelo responde (sin modelo): pnpm test:router
// El pesado solo cuando el cliente pide algo específico (tipo de prenda con características, color, medidas o
// detalles puntuales, recomendar o comparar). Saludar, agendar, decir si hay o no, un precio o tomar apuntes: liviano.
import { heavyReason } from '../agent/router.js';
import type { Intent } from '../agent/prompts.js';

let fail = 0;
const cases: [string, Intent, string, boolean, ('light' | 'heavy')?][] = [
  // Liviano
  ['saludo', 'saludo', 'hola, buenas tardes', false],
  ['información de la tienda', 'info_tienda', '¿dónde quedan y hasta qué hora atienden?', false],
  ['información con montos', 'info_tienda', '¿cuánto cuesta el envío a Bogotá?', false],
  ['hay o no hay', 'compra', '¿tienen esmoquin?', false],
  ['hay o no hay, con color', 'compra', '¿tienen trajes azules?', false],
  ['hay o no hay, con talla', 'compra', '¿tienen el traje gris en talla 42?', false],
  ['hay o no hay, con saludo', 'compra', 'hola, ¿manejan corbatines?', false],
  ['precio puntual', 'compra', '¿cuánto cuesta el alquiler del esmoquin negro?', false],
  ['tomar apuntes del evento', 'compra', 'mi boda es el 15 de diciembre y somos 5 padrinos', false],
  ['tomar apuntes del presupuesto', 'compra', 'tengo un presupuesto de menos de 500 mil', false],
  ['servicio: diseño a la medida', 'compra', '¿hacen diseño a la medida?', false],
  ['varias preguntas simples', 'compra', '¿tienen zapatos? ¿y corbatas?', false],
  ['qué incluye un servicio (no una prenda)', 'compra', 'qué incluye la asesoría de imagen?', false],
  ['un "ok" tras una recomendación', 'saludo', 'ok, gracias', false, 'heavy'],
  // Pesado
  ['recomendar', 'compra', '¿qué me recomiendas para una boda de noche?', true],
  ['comparar', 'compra', '¿qué diferencia hay entre el azul noche y el gris Oxford?', true],
  ['cuál me queda mejor', 'compra', 'soy bajito, ¿cuál me queda mejor?', true],
  ['detalle: tela', 'compra', '¿de qué tela es el esmoquin negro?', true],
  ['detalle: qué incluye', 'compra', '¿el alquiler del traje azul qué incluye?', true],
  ['detalle: ajustes', 'compra', '¿el saco se puede ajustar de mangas?', true],
  ['medidas', 'compra', 'mido 1,80 y peso 85 kilos, ¿qué talla me quedaría?', true],
  ['talla dicha, sin preguntar si hay', 'compra', 'yo uso talla 42 de saco', true],
  ['prenda con características', 'compra', 'quiero un traje azul oscuro slim para una boda de noche', true],
  ['prenda con color, pedida', 'compra', 'busco un esmoquin azul noche para mi grado', true],
  ['seguimiento corto de lo específico', 'compra', '¿y en azul?', true, 'heavy'],
  ['el mismo seguimiento sin contexto específico: liviano', 'compra', '¿y en azul?', false, 'light'],
];
for (const [name, intent, text, heavy, last] of cases) {
  const why = heavyReason(intent, text, last);
  const ok = Boolean(why) === heavy;
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${heavy ? 'pesado ' : 'liviano'} · ${name}: «${text}»${why ? ` → ${why}` : ''}`);
}
console.log(`\n${fail ? `${fail} fallos` : 'todo ok'}`);
process.exit(fail ? 1 : 0);
