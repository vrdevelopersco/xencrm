// Respaldo y restauración de la **configuración** de un cliente: lo que costó construir y no se puede volver a
// escribir de memoria —cómo se llama, cómo habla, su perfil, su diccionario, su marca, sus citas—, en un solo
// archivo que se guarda o se lleva a otra máquina.
//
// Lo que NO va dentro, a propósito:
//   · **Las conversaciones y la base.** No es una copia de seguridad de los datos; para eso está `pnpm backup`,
//     que copia la base entera. Aquí se guarda la *configuración*, que es lo que uno quiere restaurar cuando
//     algo se tocó mal o cuando se monta el mismo negocio en otra parte.
//   · **Los secretos.** Ni el token del tablero ni la clave de OpenAI: un archivo de respaldo se manda por
//     correo, se sube a un Drive y se olvida ahí. Los secretos se ponen aparte, donde ya viven.
//
// 🪤 Restaurar **pisa** lo que haya. Por eso deja primero una copia de lo que estaba, con la fecha, y por eso el
// archivo dice de qué cliente salió: restaurar el respaldo de la boutique sobre la financiera sería un desastre
// silencioso, así que hay que confirmarlo a propósito.
import { BusinessConfigSchema } from '../config.js';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const VERSION = 1;

export interface Respaldo {
  version: number;
  slug: string;
  negocio: string;
  fecha: string;
  config: Record<string, unknown>;
  perfil: Record<string, unknown> | null;
  diccionario: Record<string, unknown> | null;
  /** El catálogo y lo que sabe el negocio: archivos de texto, tal cual. */
  catalogo: Record<string, unknown> | null;
  conocimiento: { nombre: string; texto: string }[];
}

const leerJson = (ruta: string): Record<string, unknown> | null => {
  try {
    return existsSync(ruta) ? (JSON.parse(readFileSync(ruta, 'utf8')) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/** Los .md de la carpeta de conocimiento, que es de donde sale lo que el asistente sabe del negocio. */
function leerConocimiento(dir: string): { nombre: string; texto: string }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.(md|txt)$/i.test(f) && statSync(join(dir, f)).isFile())
    .sort()
    .map((nombre) => ({ nombre, texto: readFileSync(join(dir, nombre), 'utf8') }));
}

/** Lo que hay que saber de un cliente para armar (o restaurar) su respaldo. */
export interface DondeVive {
  slug: string;
  nombre: string;
  config: string;
  perfil?: string;
  diccionario?: string;
  catalogo?: string;
  conocimiento?: string;
}

/** De un cliente, un respaldo. Los secretos no entran: se limpian antes de escribir nada. */
export function armar(donde: DondeVive, hoy = new Date()): Respaldo {
  const config = leerJson(donde.config) ?? {};
  // Las rutas son de la máquina donde vive hoy: no significan nada en otra, y al restaurar se vuelven a poner.
  for (const clave of ['dictionaryFile', 'profileFile', 'sources', 'evalFile', 'seedFile']) delete config[clave];
  // La marca guarda archivos: adentro va solo el nombre, que es lo único que sirve en otra máquina. Una URL
  // https sí se guarda tal cual, porque esa sí significa lo mismo en todas partes.
  const marca = config.brand as Record<string, unknown> | undefined;
  if (marca) {
    config.brand = { ...marca };
    for (const cual of ['logo', 'logoOscuro', 'favicon']) {
      const v = (config.brand as Record<string, unknown>)[cual];
      if (typeof v === 'string' && v && !/^https?:/.test(v)) (config.brand as Record<string, unknown>)[cual] = v.split(/[/\\]/).pop();
    }
  }
  return {
    version: VERSION,
    slug: donde.slug,
    negocio: donde.nombre,
    fecha: hoy.toISOString(),
    config,
    perfil: donde.perfil ? leerJson(donde.perfil) : null,
    diccionario: donde.diccionario ? leerJson(donde.diccionario) : null,
    catalogo: donde.catalogo ? leerJson(donde.catalogo) : null,
    conocimiento: donde.conocimiento ? leerConocimiento(donde.conocimiento) : [],
  };
}

/** Lo que se comprueba antes de dejar restaurar. Devuelve el problema, o null si está bien. */
export function revisar(crudo: unknown, slugDestino: string): { error: string } | { respaldo: Respaldo; otroCliente: boolean } {
  if (!crudo || typeof crudo !== 'object') return { error: 'eso no es un respaldo de XENCRM' };
  const r = crudo as Partial<Respaldo>;
  if (r.version !== VERSION) return { error: `el respaldo es de otra versión (${String(r.version)}), y no se puede leer` };
  if (!r.config || typeof r.config !== 'object') return { error: 'al respaldo le falta la configuración' };
  if (!r.slug) return { error: 'el respaldo no dice de qué cliente salió' };
  return { respaldo: r as Respaldo, otroCliente: r.slug !== slugDestino };
}

/**
 * Restaura sobre un cliente. Antes de pisar nada deja una copia de lo que estaba en `<carpeta>/respaldos/`, que
 * es la red por si el respaldo resulta ser el equivocado.
 */
export function restaurar(
  donde: DondeVive,
  respaldo: Respaldo,
  opts: { carpetaCopias: string; hoy?: Date },
): { copiaEn: string; escrito: string[] } {
  const hoy = opts.hoy ?? new Date();
  const sello = hoy.toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const copiaEn = join(opts.carpetaCopias, `antes-de-restaurar-${sello}.json`);
  mkdirSync(opts.carpetaCopias, { recursive: true });
  writeFileSync(copiaEn, `${JSON.stringify(armar(donde, hoy), null, 2)}\n`);

  const escrito: string[] = [];
  // La configuración vuelve con las rutas de ESTA máquina: las del respaldo se borraron al armarlo.
  const actual = leerJson(donde.config) ?? {};
  const nueva = { ...respaldo.config } as Record<string, unknown>;
  for (const clave of ['dictionaryFile', 'profileFile', 'sources', 'evalFile', 'seedFile']) {
    if (actual[clave] !== undefined) nueva[clave] = actual[clave];
  }
  // La marca vuelve a apuntar a la carpeta de ESTE cliente: en el respaldo solo iba el nombre del archivo.
  const marcaNueva = nueva.brand as Record<string, unknown> | undefined;
  const marcaVieja = (actual.brand ?? {}) as Record<string, unknown>;
  if (marcaNueva) {
    for (const cual of ['logo', 'logoOscuro', 'favicon']) {
      const v = marcaNueva[cual];
      if (typeof v !== 'string' || !v || /^https?:/.test(v)) continue;
      const antes = marcaVieja[cual];
      const carpeta = typeof antes === 'string' && antes.includes('/') ? antes.slice(0, antes.lastIndexOf('/')) : join(donde.config, '..', 'marca');
      marcaNueva[cual] = join(carpeta, v);
    }
  }
  // 🪤 Esta es la configuración de la que el cliente arranca. Si queda rota, el proceso no vuelve a levantar —y
  // con un supervisor detrás, se reinicia para siempre—. Se comprueba ya compuesta (con las rutas de esta
  // máquina puestas) y ANTES de escribirla: es la única oportunidad de decir «este respaldo no sirve» en vez de
  // dejar al cliente abajo. La copia de lo que había ya quedó guardada más arriba.
  const comoQuedaria = BusinessConfigSchema.safeParse(nueva);
  if (!comoQuedaria.success) {
    const donde1 = comoQuedaria.error.issues[0];
    throw new Error(`no restauré nada: la configuración quedaría rota (${donde1?.path.join('.') || 'configuración'}: ${donde1?.message ?? 'no se pudo leer'})`);
  }
  writeFileSync(donde.config, `${JSON.stringify(nueva, null, 2)}\n`);
  escrito.push('configuración');

  if (donde.perfil && respaldo.perfil) {
    writeFileSync(donde.perfil, `${JSON.stringify(respaldo.perfil, null, 2)}\n`);
    escrito.push('perfil');
  }
  if (donde.diccionario && respaldo.diccionario) {
    writeFileSync(donde.diccionario, `${JSON.stringify(respaldo.diccionario, null, 2)}\n`);
    escrito.push('diccionario');
  }
  if (donde.catalogo && respaldo.catalogo) {
    mkdirSync(join(donde.catalogo, '..'), { recursive: true });
    writeFileSync(donde.catalogo, `${JSON.stringify(respaldo.catalogo, null, 2)}\n`);
    escrito.push('catálogo');
  }
  if (donde.conocimiento && respaldo.conocimiento.length) {
    mkdirSync(donde.conocimiento, { recursive: true });
    for (const doc of respaldo.conocimiento) {
      // Solo el nombre del archivo: un respaldo no puede escribir fuera de su carpeta.
      const nombre = doc.nombre.replace(/[/\\]/g, '_');
      writeFileSync(join(donde.conocimiento, nombre), doc.texto);
    }
    escrito.push(`${respaldo.conocimiento.length} documentos de lo que sabe`);
  }
  return { copiaEn, escrito };
}
