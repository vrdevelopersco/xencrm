// La configuración general del aplicativo: lo que vale para todos los clientes mientras uno no diga otra cosa.
//
// Hasta ahora cada ajuste global terminaba siendo su propia pestaña en la consola —la libreta fue el primero—, y
// eso no escala: al quinto ajuste la consola es una lista de pestañas y nadie sabe dónde está nada. Aquí viven
// todos juntos, en un archivo, con la misma forma.
//
// 🪤 DOS NIVELES, y el de abajo manda. Lo que se pone aquí es el valor POR DEFECTO de todos los clientes; lo que
// un cliente haya decidido en su propio tablero le gana, siempre. Un CRM multicliente donde el de arriba pisa lo
// que el negocio configuró es un CRM que un día le cambia el saludo a un cliente sin que nadie de ese negocio
// haya tocado nada, y eso no se perdona. Por eso `resolver()` mira primero lo del cliente.
//
// Dónde vive cada cosa:
//   - Este archivo (general.json, en la carpeta compartida): el defecto para todos. Lo escribe la consola.
//   - La tabla `settings` de la base de cada cliente: lo que ese cliente decidió. Lo escribe su tablero.
//
// Y por qué en un archivo y no en una base: lo escribe la consola, que es un proceso, y lo leen los procesos de
// los clientes, que son otros. La carpeta compartida es lo único que los tres ya ven. Es el mismo camino que
// libreta.json, que lleva funcionando desde que se hizo.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Cómo se comporta la burbuja que el cliente pega en su sitio web. */
export interface Burbuja {
  /** El primer mensaje. Vacío = el de siempre, armado con el nombre del asistente y del negocio. */
  saludo: string;
  posicion: 'derecha' | 'izquierda';
  /**
   * Segundos hasta que se abre sola. 0 = nunca.
   *
   * 🪤 El defecto es 0 y debe seguir siéndolo. Una burbuja que se abre sola tapa el sitio de un cliente que
   * está intentando leerlo; sube las conversaciones y baja todo lo demás. Que lo encienda quien lo quiera.
   */
  abreSola: number;
  /** Si solo aparece dentro del horario de atención. Fuera de él, el sitio queda limpio. */
  soloEnHorario: boolean;
}

/** La ventana de chat de cada cliente, en /chat: su puerta web. */
export interface Ventana {
  /** Lo que dice la barra de arriba. Vacío = el nombre del negocio. */
  titulo: string;
  /** La línea de abajo. Vacío = la de siempre. */
  pie: string;
  /** Qué se lee cuando el chat está apagado. Vacío = lo que el negocio puso en «cómo contactar a una persona». */
  cerradaDice: string;
}

export interface General {
  burbuja: Burbuja;
  ventana: Ventana;
}

/**
 * Lo que vale cuando nadie ha configurado nada.
 *
 * 🪤 Todo lo que aquí está en su valor apagado lo está a propósito: un cliente recién dado de alta no debe
 * estrenar comportamientos que nadie pidió. Lo vacío significa «lo de siempre», no «sin nada».
 */
export const DEFECTOS: General = {
  burbuja: { saludo: '', posicion: 'derecha', abreSola: 0, soloEnHorario: false },
  ventana: { titulo: '', pie: '', cerradaDice: '' },
};

const carpeta = (): string => process.env.XENCRM_CLIENTES_DIR || join(process.cwd(), 'clientes');
const archivo = (): string => join(carpeta(), 'general.json');

const texto = (v: unknown, tope = 400): string => (typeof v === 'string' ? v.trim().slice(0, tope) : '');
const numero = (v: unknown, min: number, max: number, si: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : si;
};

/** Deja lo que venga con la forma correcta, sea lo que sea que traiga. Nada de aquí se cree sin mirarlo. */
export function limpiar(crudo: unknown): General {
  const c = (crudo ?? {}) as Partial<Record<keyof General, Record<string, unknown>>>;
  const b = c.burbuja ?? {};
  const v = c.ventana ?? {};
  return {
    burbuja: {
      saludo: texto(b.saludo),
      posicion: b.posicion === 'izquierda' ? 'izquierda' : 'derecha',
      // Menos de 3 segundos es un salto en la cara; más de 5 minutos es que nunca.
      abreSola: b.abreSola === 0 || b.abreSola == null ? 0 : numero(b.abreSola, 3, 300, 0),
      soloEnHorario: b.soloEnHorario === true,
    },
    ventana: { titulo: texto(v.titulo, 60), pie: texto(v.pie, 200), cerradaDice: texto(v.cerradaDice) },
  };
}

// Se relee cada pocos segundos, como la libreta: quien cambia un saludo quiere verlo ya, no en el próximo
// reinicio. Cinco segundos es suficientemente rápido para quien lo está probando y suficientemente lento para
// no leer un archivo en cada visita a la página.
let cache: { cuando: number; valor: General } | null = null;

/** La configuración general, la que vale para todos los clientes mientras no digan otra cosa. */
export function general(): General {
  if (cache && Date.now() - cache.cuando < 5000) return cache.valor;
  let valor = DEFECTOS;
  try {
    valor = limpiar(JSON.parse(readFileSync(archivo(), 'utf8')));
  } catch {
    /* no hay archivo: valen los defectos, que es el estado correcto de un sistema recién instalado */
  }
  cache = { cuando: Date.now(), valor };
  return valor;
}

export function guardarGeneral(entra: unknown): General {
  const dir = carpeta();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const limpio = limpiar(entra);
  writeFileSync(archivo(), JSON.stringify(limpio, null, 2) + '\n');
  cache = null;
  return limpio;
}

/**
 * Lo general con lo del cliente encima.
 *
 * 🪤 Aquí está toda la regla de convivencia entre los dos niveles, y es una sola: **lo que el cliente decidió
 * gana**. Un campo que el cliente no tocó no existe en `suyo` y se queda con el general; uno que tocó manda,
 * aunque lo general cambie después. Lo que NO se hace es mezclar a medias —tomar el saludo de uno y la posición
 * del otro sin que se note—: cada campo viene de un sitio y se puede decir de cuál.
 *
 * Un `undefined` en `suyo` es «no lo he tocado». Una cadena vacía NO lo es: es una decisión («no quiero pie»),
 * y por eso se respeta.
 */
export function resolver<T extends object>(deTodos: T, suyo: Partial<T> | null | undefined): T {
  if (!suyo) return deTodos;
  const salida = { ...deTodos };
  for (const clave of Object.keys(suyo) as (keyof T)[]) {
    const v = suyo[clave];
    if (v !== undefined) salida[clave] = v as T[keyof T];
  }
  return salida;
}
