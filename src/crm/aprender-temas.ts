// Sacar de un documento del historial QUÉ pregunta la gente, para no tener que adivinarlo.
//
// El material de aprendizaje —un recap de tickets, una exportación de PQR— tiene dentro la lista de lo que un
// negocio contesta todos los días. Leerlo a mano y escribir las respuestas rápidas una por una es trabajo de una
// tarde que nadie hace nunca, y por eso los negocios siguen contestando lo mismo a mano durante meses.
//
// 🪤 De aquí salen TEMAS, nunca respuestas. Es la misma línea que marca docs/aprender-del-historial.md y la
// razón es que son cosas de distinta naturaleza: «de qué preguntan» es un hecho observable que se puede deducir
// de un historial, y «qué se contesta» es una política del negocio —un plazo, un requisito, un precio— que
// cambia y que nadie autorizó a deducir. Una respuesta sacada de lo que alguien contestó una vez en marzo se
// convierte, sin que nadie lo decida, en lo que el negocio promete en octubre.
//
// Así que cada tema nace en `borrador`, con sus formas de preguntarlo y la respuesta VACÍA, y no se usa para
// nada hasta que alguien del negocio la escribe y la aprueba. Lo que esto ahorra es la lista, no el criterio.
import { generate, roleEngine } from '../llm/engines.js';
import { business } from '../config.js';

export interface TemaPropuesto {
  tema: string;
  ejemplos: string[];
  /** Lo que el documento dejaba ver sobre ese tema, para quien vaya a escribir la respuesta. */
  pista: string;
}

const INSTRUCCIONES = `Lees material sobre cómo atiende un negocio —tickets, reclamos, conversaciones resumidas— y sacas la lista de LO QUE LA GENTE PREGUNTA.

Devuelve SOLO un JSON, sin nada alrededor, con esta forma:
{"temas":[{"tema":"...","ejemplos":["...","..."],"pista":"..."}]}

- "tema": de qué trata, en 2 a 5 palabras y en lenguaje del negocio. Ej.: "Plazo de desembolso".
- "ejemplos": entre 2 y 5 formas REALES de preguntarlo, en las palabras del cliente, como se escriben en un chat
  (con su tono, sus abreviaturas y sus errores si los hay). Son para reconocer la pregunta cuando vuelva.
- "pista": en una frase, qué hace falta saber para poder contestar eso. No la respuesta: lo que hay que
  averiguar. Ej.: "hay que confirmar el plazo vigente y desde qué momento se cuenta".

🪤 NUNCA escribas la respuesta, ni la insinúes, ni copies una que aparezca en el material. Aunque el documento
diga claramente qué se contestó, eso era de ese día y puede haber cambiado; quien decide qué se promete hoy es
el negocio, no tú. Si te dan ganas de poner un plazo, un precio o un requisito concreto, ponlo en "pista" como
algo por confirmar.

Entre 5 y 12 temas, los que de verdad se repitan. Si el material no da para tanto, devuelve menos.`;

/**
 * Lee material de aprendizaje y propone temas.
 *
 * No guarda nada: devuelve una lista para que una persona la mire. Guardar directo convertiría un documento que
 * alguien dejó en una carpeta en configuración viva del asistente, sin que nadie lo hubiera aprobado.
 */
export async function temasDelMaterial(texto: string): Promise<TemaPropuesto[]> {
  const material = texto.trim();
  if (material.length < 200) throw new Error('ese material es muy corto para sacar temas');

  const salida = await generate(roleEngine('analysis'), {
    sessionId: 'aprender-temas',
    persona: INSTRUCCIONES,
    context: `El negocio es ${business.business.name}.`,
    // Un recap entero puede ser largo; se recorta por arriba porque los temas suelen estar en la primera mitad
    // y porque un contexto enorme encarece sin mejorar la lista.
    userText: `Material:\n\n${material.slice(0, 24_000)}`,
    history: [],
    task: 'analysis',
    maxTokens: 1600,
  });

  return limpiarTemas(salida);
}

/**
 * Deja la respuesta del modelo con la forma buena, o vacía.
 *
 * 🪤 Lo que vuelve de un modelo no se cree: puede traer el JSON envuelto en explicaciones, con campos de más, o
 * —lo que importa aquí— con una respuesta ya escrita pese a que las instrucciones lo prohíben. Lo que no quepa
 * en la forma se tira, y de la respuesta no se hace caso ni aunque venga: la escribe una persona.
 */
export function limpiarTemas(salida: string): TemaPropuesto[] {
  const bruto = salida.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  const desde = bruto.indexOf('{');
  const hasta = bruto.lastIndexOf('}');
  if (desde === -1 || hasta <= desde) return [];
  let datos: unknown;
  try {
    datos = JSON.parse(bruto.slice(desde, hasta + 1));
  } catch {
    return [];
  }
  const lista = (datos as { temas?: unknown[] })?.temas;
  if (!Array.isArray(lista)) return [];

  const vistos = new Set<string>();
  const salidas: TemaPropuesto[] = [];
  for (const x of lista) {
    const t = x as { tema?: unknown; ejemplos?: unknown; pista?: unknown };
    const tema = typeof t.tema === 'string' ? t.tema.trim().slice(0, 60) : '';
    if (!tema || vistos.has(tema.toLowerCase())) continue;
    const ejemplos = Array.isArray(t.ejemplos)
      ? [...new Set(t.ejemplos.filter((e): e is string => typeof e === 'string').map((e) => e.trim()).filter((e) => e.length > 2 && e.length < 200))].slice(0, 5)
      : [];
    if (ejemplos.length < 1) continue; // un tema sin forma de reconocerlo no sirve para nada
    vistos.add(tema.toLowerCase());
    salidas.push({ tema, ejemplos, pista: typeof t.pista === 'string' ? t.pista.trim().slice(0, 300) : '' });
    if (salidas.length >= 12) break;
  }
  return salidas;
}
