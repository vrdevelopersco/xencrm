// Las sedes de un negocio escritas a mano, una por línea, convertidas en lo que va en `sedes` de la configuración.
//
// Lo usan el alta de un cliente (la consola y `pnpm cliente nuevo`), `pnpm onboard` y El negocio del tablero. Vive
// aparte de crm/sedes.ts a propósito: aquel lee la configuración del cliente que corre, y la consola, que da de alta
// clientes, no corre ninguno. Esto no lee nada: recibe el texto y el nombre del negocio.
//
// 🪤 Vacío es «sin sedes», que es lo de casi todos. Entonces no se escribe la clave en la configuración y el
// asistente no oye hablar de sedes: ni en el prompt, ni al agendar.

export interface SedeNueva {
  id: string;
  nombre: string;
  direccion: string;
  apodos: string[];
}

export const MAXIMO_SEDES = 20;
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/**
 * El id de una sede: su nombre sin «Sede» ni el nombre del negocio, en minúsculas y sin tildes. «Sede Norte» da
 * «norte»; «DUNOR Centro», «centro». Si ya está usado, se le pone un número.
 */
export function idDeSede(nombre: string, negocio: string, usados: Set<string>): string {
  const n = fold(nombre);
  const neg = fold(negocio);
  const sinNegocio = neg && n.startsWith(`${neg} `) ? n.slice(neg.length + 1) : n;
  const base = sinNegocio.replace(/^sede\s+/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 36) || 'sede';
  let id = base;
  for (let i = 2; usados.has(id); i++) id = `${base}-${i}`;
  return id;
}

/**
 * Entre el nombre y la dirección vale « · », « | », « — », « - » (con espacios: «82-20» es parte de una dirección),
 * dos puntos o un tabulador. Lo primero que aparezca parte la línea; el resto es la dirección tal cual.
 */
const SEPARADOR = /\s*(?:·|\||—|–|\t|:|\s-\s)\s*/;

/** Las sedes de un texto, una por línea. Lanza con un mensaje que se puede enseñar si algo no cabe. */
export function sedesDeTexto(texto: string, negocio: string): SedeNueva[] {
  const lineas = String(texto ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lineas.length > MAXIMO_SEDES) throw new Error(`son ${lineas.length} sedes; el máximo es ${MAXIMO_SEDES}`);
  const usados = new Set<string>();
  return lineas.map((linea) => {
    const m = SEPARADOR.exec(linea);
    const nombre = (m ? linea.slice(0, m.index) : linea).trim();
    const direccion = (m ? linea.slice(m.index + m[0].length) : '').trim();
    if (!nombre) throw new Error(`a «${linea}» le falta el nombre de la sede`);
    if (nombre.length > 80) throw new Error(`el nombre de una sede va hasta 80 letras: «${nombre.slice(0, 30)}…»`);
    if (direccion.length > 200) throw new Error(`la dirección de ${nombre} va hasta 200 letras`);
    const id = idDeSede(nombre, negocio, usados);
    usados.add(id);
    return { id, nombre, direccion, apodos: [] };
  });
}
