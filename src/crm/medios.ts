// Los archivos que van y vienen por el chat: la foto que manda el cliente y el portafolio que le manda el
// negocio.
//
// Vive aparte de la base de datos a propósito. Una foto de tres megas metida en una columna hace lenta cada
// consulta de la conversación, infla el respaldo y no se puede servir por partes. Aquí los archivos son
// archivos: la base solo guarda a cuál apunta cada mensaje.
//
// 🪤 La carpeta es la DEL CLIENTE, hermana de su base. Cada cliente de XENCRM corre en su propio proceso con su
// propia carpeta, así que el aislamiento no hay que programarlo: es la misma frontera que ya separa sus
// conversaciones. Poner los medios en un sitio común sería abrir un agujero entre inquilinos para ahorrarse una
// variable.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { env } from '../config.js';

export type TipoDeMedio = 'imagen' | 'video' | 'audio' | 'documento';

export interface Medio {
  /** El nombre del archivo en disco, que es también cómo se pide de vuelta. */
  id: string;
  tipo: TipoDeMedio;
  /** Cómo se llamaba para quien lo mandó. Solo para enseñarlo y para descargarlo con ese nombre. */
  nombre: string;
  mime: string;
  bytes: number;
}

/**
 * Lo que se acepta, y con qué extensión se guarda.
 *
 * 🪤 La extensión sale de ESTA tabla, nunca del nombre que venga de fuera. Quien manda el archivo escoge cómo
 * se llama, y un «catalogo.pdf.html» o un «.svg» servidos desde el mismo dominio del tablero ejecutan lo que
 * quieran con la sesión de quien los abra. Aquí el nombre de fuera es solo una etiqueta para enseñar; lo que
 * decide el archivo en disco es el tipo que nosotros reconocimos.
 *
 * 🪤 Y por eso tampoco hay SVG ni HTML en la lista, aunque sean «imágenes» y «documentos». Son programas.
 */
const ACEPTADOS: Record<string, { ext: string; tipo: TipoDeMedio }> = {
  'image/jpeg': { ext: 'jpg', tipo: 'imagen' },
  'image/png': { ext: 'png', tipo: 'imagen' },
  'image/webp': { ext: 'webp', tipo: 'imagen' },
  'image/gif': { ext: 'gif', tipo: 'imagen' },
  'image/heic': { ext: 'heic', tipo: 'imagen' },
  'video/mp4': { ext: 'mp4', tipo: 'video' },
  'video/3gpp': { ext: '3gp', tipo: 'video' },
  'video/quicktime': { ext: 'mov', tipo: 'video' },
  'audio/ogg': { ext: 'ogg', tipo: 'audio' },
  'audio/mpeg': { ext: 'mp3', tipo: 'audio' },
  'audio/mp4': { ext: 'm4a', tipo: 'audio' },
  'audio/amr': { ext: 'amr', tipo: 'audio' },
  'application/pdf': { ext: 'pdf', tipo: 'documento' },
  'application/msword': { ext: 'doc', tipo: 'documento' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: 'docx', tipo: 'documento' },
  'application/vnd.ms-excel': { ext: 'xls', tipo: 'documento' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { ext: 'xlsx', tipo: 'documento' },
  'text/plain': { ext: 'txt', tipo: 'documento' },
};

/**
 * El tope por archivo.
 *
 * WhatsApp admite hasta 16 MB en imagen y video y 100 MB en documento, pero esto corre en un alojamiento
 * compartido con disco contado y lo que entra no lo decide uno: lo decide quien escribe. Dieciséis megas cubren
 * cualquier foto de un teléfono y un portafolio en PDF con holgura, y un catálogo entero en video no es algo
 * que deba entrar por el chat sin que alguien lo decida.
 */
export const MAXIMO_BYTES = 16 * 1024 * 1024;

/** La carpeta de este cliente. Hermana de su base, no dentro: el respaldo es un JSON y no debe cargar con esto. */
export function carpeta(): string {
  const dir = join(dirname(env.dbPath), '..', 'medios');
  mkdirSync(dir, { recursive: true });
  return resolve(dir);
}

export function tipoDe(mime: string): TipoDeMedio | null {
  return ACEPTADOS[(mime ?? '').toLowerCase().split(';')[0]!.trim()]?.tipo ?? null;
}

export function seAcepta(mime: string): boolean {
  return tipoDe(mime) !== null;
}

/** Los tipos que el negocio puede mandar, para enseñarlos en el selector de archivos del tablero. */
export const MIMES_ACEPTADOS = Object.keys(ACEPTADOS);

/** Un nombre que se pueda enseñar y descargar sin que arrastre rutas ni comillas. */
function nombreVisible(nombre: string, ext: string): string {
  const limpio = (nombre ?? '')
    .replace(/[\\/]/g, ' ') // nada de rutas
    .replace(/[\u0000-\u001f"'`<>|]/g, '')
    // Los puntos seguidos se juntan en uno y los del principio se van: «../../etc/passwd» queda en «etc passwd»
    // en vez de «.. .. etc passwd». No es seguridad —esto no se usa nunca como ruta— es que un nombre así en la
    // conversación parece un error del programa, y quien atiende no tiene por qué descifrarlo.
    .replace(/\.{2,}/g, '.')
    .replace(/^[.\s]+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 120);
  if (!limpio) return `archivo.${ext}`;
  return limpio.toLowerCase().endsWith(`.${ext}`) ? limpio : `${limpio}.${ext}`;
}

export class MedioRechazado extends Error {}

/**
 * Guarda un archivo y devuelve con qué apuntarlo desde un mensaje.
 *
 * 🪤 El nombre en disco lo ponemos nosotros, al azar y en hexadecimal. Si se usara el nombre de quien lo manda,
 * dos clientes que suban «foto.jpg» se pisarían el archivo —el segundo vería la foto del primero— y además el
 * nombre viajaría hasta una ruta de disco, que es por donde se sale de la carpeta.
 */
export function guardar(datos: Uint8Array, opts: { mime: string; nombre?: string }): Medio {
  const info = ACEPTADOS[(opts.mime ?? '').toLowerCase().split(';')[0]!.trim()];
  if (!info) throw new MedioRechazado(`no manejo archivos de tipo "${opts.mime || 'desconocido'}"`);
  if (!datos.length) throw new MedioRechazado('el archivo llegó vacío');
  if (datos.length > MAXIMO_BYTES) {
    throw new MedioRechazado(`el archivo pesa ${(datos.length / 1024 / 1024).toFixed(1)} MB y el tope son ${MAXIMO_BYTES / 1024 / 1024} MB`);
  }
  const id = `${randomBytes(16).toString('hex')}.${info.ext}`;
  writeFileSync(join(carpeta(), id), datos, { mode: 0o600 });
  return { id, tipo: info.tipo, nombre: nombreVisible(opts.nombre ?? '', info.ext), mime: opts.mime, bytes: datos.length };
}

/**
 * La ruta en disco de un medio, o null si no existe o el identificador no es de los nuestros.
 *
 * 🪤 El identificador se comprueba con una expresión ANCLADA antes de tocar el disco, y además se vuelve a
 * mirar que la ruta resuelta siga dentro de la carpeta. Lo primero ya basta, pero esto es lo que convierte
 * «dame el archivo X» en «lee cualquier archivo del servidor» si algún día alguien afloja la expresión: dos
 * cierres para una puerta que da al sistema de archivos entero no sobran.
 */
export function rutaDe(id: string): string | null {
  if (!/^[0-9a-f]{32}\.[a-z0-9]{2,5}$/.test(id ?? '')) return null;
  const ruta = resolve(join(carpeta(), id));
  if (!ruta.startsWith(carpeta() + '/')) return null;
  return existsSync(ruta) ? ruta : null;
}

export function borrar(id: string): boolean {
  const ruta = rutaDe(id);
  if (!ruta) return false;
  rmSync(ruta, { force: true });
  return true;
}

/** Qué tanto disco llevan ocupado, para poder enseñarlo y para saber cuándo hay que limpiar. */
export function cuantoOcupa(): { archivos: number; bytes: number } {
  const dir = carpeta();
  let bytes = 0;
  let archivos = 0;
  for (const f of readdirSync(dir)) {
    try {
      const s = statSync(join(dir, f));
      if (s.isFile()) {
        bytes += s.size;
        archivos++;
      }
    } catch {
      /* desapareció entre leer la lista y mirarlo: no es asunto de esta cuenta */
    }
  }
  return { archivos, bytes };
}

/**
 * Borra los archivos más viejos que `dias`.
 *
 * Hace falta porque nadie los borra y nadie los mira: cada foto que manda un cliente se queda ahí para
 * siempre. En un alojamiento compartido con disco contado eso no es un problema esta semana, es un problema
 * dentro de unos meses y de golpe — y cuando el disco se llena no falla esto, falla todo.
 *
 * 🪤 Se borra el ARCHIVO y se deja el mensaje. La conversación es el registro de lo que pasó y no se toca:
 * sigue diciendo que ese día entró una foto, y quien la abra verá que ya no está. Borrar también el mensaje
 * sería reescribir la historia del cliente para ahorrar disco.
 *
 * 🪤 Y se mide por la fecha del archivo, no por la del mensaje. Son lo mismo casi siempre, pero el archivo es
 * lo que ocupa, y preguntarle al disco por lo que hay en el disco evita que un desajuste entre la base y la
 * carpeta deje huérfanos que nadie vuelve a contar.
 */
export function limpiar(dias: number, ahora = Date.now()): { borrados: number; bytes: number } {
  if (!Number.isFinite(dias) || dias <= 0) return { borrados: 0, bytes: 0 };
  const corte = ahora - dias * 86400_000;
  const dir = carpeta();
  let borrados = 0;
  let bytes = 0;
  for (const f of readdirSync(dir)) {
    try {
      const ruta = join(dir, f);
      const s = statSync(ruta);
      if (!s.isFile() || s.mtimeMs >= corte) continue;
      bytes += s.size;
      rmSync(ruta, { force: true });
      borrados++;
    } catch {
      /* desapareció o no se deja borrar: no es motivo para abandonar el resto */
    }
  }
  return { borrados, bytes };
}

/** Cuántos días se guardan los archivos. Se puede cambiar por cliente; 0 o menos = no se borra nada. */
export const DIAS_QUE_SE_GUARDAN = Number(process.env.MEDIOS_DIAS ?? 90);

let reloj: NodeJS.Timeout | null = null;
/** Pasa la escoba una vez al día. Se llama al arrancar. */
export function empezarALimpiar(dias = DIAS_QUE_SE_GUARDAN): void {
  if (reloj || dias <= 0) return;
  const barrer = () => {
    try {
      const r = limpiar(dias);
      if (r.borrados) console.log(`[medios] borrados ${r.borrados} archivos de más de ${dias} días (${(r.bytes / 1048576).toFixed(1)} MB)`);
    } catch (err) {
      console.warn('[medios] no pude limpiar:', (err as Error).message);
    }
  };
  reloj = setInterval(barrer, 24 * 3600_000);
  reloj.unref();
  // 🪤 Al arrancar se espera un minuto, no se barre de una. Lo primero que tiene que hacer el proceso es abrir
  // el puerto —el alojamiento da tres segundos— y recorrer una carpeta con miles de archivos no cabe ahí.
  setTimeout(barrer, 60_000).unref();
}
