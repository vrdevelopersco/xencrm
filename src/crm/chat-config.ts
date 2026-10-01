// Lo que este cliente decidió sobre su chat, con lo general debajo.
//
// Vive aparte de `general.ts` a propósito: aquel lo lee también la consola, que no tiene la base de ningún
// cliente, y meterle aquí un `import` de sqlite la obligaría a cargar media aplicación para leer un archivo.
//
// 🪤 Lo que sale de la base NO se cree tal cual. Es un JSON que escribió otra versión del programa, o una
// restauración de un respaldo viejo, o alguien con la llave del tablero: `limpiar()` lo deja con la forma buena
// antes de que llegue a una página que ve gente de la calle.
import { getSetting, setSetting } from './settings.js';
import { general, limpiar, resolver, type Burbuja, type Ventana } from './general.js';

const suyo = <T>(clave: string): Partial<T> | null => {
  const crudo = getSetting<Record<string, unknown> | null>(clave, null);
  return crudo && typeof crudo === 'object' ? (crudo as Partial<T>) : null;
};

/** Cómo se comporta la burbuja de ESTE cliente: lo suyo si lo tiene, lo general si no. */
export function burbujaDe(): Burbuja {
  const mezcla = resolver(general().burbuja, suyo<Burbuja>('chat.burbuja'));
  return limpiar({ burbuja: mezcla }).burbuja;
}

/** Cómo se ve la ventana de ESTE cliente. */
export function ventanaDe(): Ventana {
  const mezcla = resolver(general().ventana, suyo<Ventana>('chat.ventana'));
  return limpiar({ ventana: mezcla }).ventana;
}

/**
 * Guarda lo que decidió este cliente.
 *
 * 🪤 Se guarda SOLO lo que se manda. Si el tablero manda el saludo y nada más, la posición sigue viniendo de lo
 * general —y sigue cambiando si lo general cambia—, que es lo que quiere decir «no lo he tocado». Guardar el
 * objeto entero congelaría aquí todos los valores generales de hoy, y el cliente dejaría de recibir los cambios
 * de arriba sin haber pedido nunca esa independencia.
 */
export function guardarSuyo(cual: 'burbuja' | 'ventana', campos: Record<string, unknown>): void {
  const clave = `chat.${cual}`;
  const antes = suyo<Record<string, unknown>>(clave) ?? {};
  const junto = { ...antes, ...campos };
  // Se valida contra la forma completa y se vuelve a quedar solo con las claves que de verdad se han tocado.
  const bueno = limpiar({ [cual]: { ...general()[cual], ...junto } })[cual] as unknown as Record<string, unknown>;
  const recorte: Record<string, unknown> = {};
  for (const k of Object.keys(junto)) if (k in bueno) recorte[k] = bueno[k];
  setSetting(clave, recorte);
}

/** Olvida lo de este cliente y vuelve a lo general. */
export function volverAloGeneral(cual: 'burbuja' | 'ventana'): void {
  setSetting(`chat.${cual}`, null);
}

/** Qué campos tiene decididos este cliente por su cuenta: para poder decirlo en el tablero. */
export function loQueDecidio(cual: 'burbuja' | 'ventana'): string[] {
  return Object.keys(suyo<Record<string, unknown>>(`chat.${cual}`) ?? {});
}

/**
 * Deja un texto listo para meterlo DENTRO de una cadena de JavaScript escrita con comillas simples.
 *
 * 🪤 `JSON.stringify` no basta: escapa las comillas DOBLES, y el archivo que recibe esto —`public/widget.js`—
 * está escrito con simples. Un saludo como «¿qué 'buscas' hoy?» cerraba la cadena ahí mismo y dejaba sin chat
 * a todos los visitantes del sitio de ese cliente, por haber escrito un apóstrofo en una caja de texto.
 *
 * Vive aquí, y no suelto en el servidor, para que la prueba use exactamente esto y no una copia parecida: una
 * copia que se queda atrás es una prueba que dice que todo va bien mientras el archivo de verdad está roto.
 */
export function paraCadenaJs(texto: string): string {
  return JSON.stringify(texto).slice(1, -1).replace(/'/g, "\\'");
}
