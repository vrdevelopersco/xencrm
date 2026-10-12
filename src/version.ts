// Qué versión del código está corriendo.
//
// 🪤 Existe por una regla que costó aprender: cuando algo empieza a fallar después de un despliegue, lo primero es
// saber QUÉ está desplegado, antes de teorizar. Hasta ahora la única forma era bajar el archivo servido y buscar en
// él un cambio conocido. Con esto, /_salud, la consola y cada turno guardado dicen el commit.
//
// De dónde sale, en orden: AIVA_VERSION (si el panel la pone), el version.json que deja `pnpm paquete` en la raíz del
// paquete, o git si esto es una copia de trabajo. Sin ninguno, «desconocida», que también es una respuesta: dice
// que no se puede confiar en ese despliegue para saber qué tiene.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface Version {
  /** El commit corto («dba1be5»), con «+cambios» si la copia de trabajo tiene cosas sin commitear. */
  commit: string;
  /** Cuándo se armó: la fecha del paquete, o la del commit. */
  fecha: string;
  origen: 'entorno' | 'paquete' | 'git' | 'desconocida';
}

let guardada: Version | null = null;

export function version(): Version {
  if (guardada) return guardada;
  guardada = leer();
  return guardada;
}

function leer(): Version {
  if (process.env.AIVA_VERSION) return { commit: process.env.AIVA_VERSION, fecha: '', origen: 'entorno' };
  const archivo = fileURLToPath(new URL('../version.json', import.meta.url));
  if (existsSync(archivo)) {
    try {
      const v = JSON.parse(readFileSync(archivo, 'utf8')) as { commit?: string; fecha?: string };
      if (v.commit) return { commit: v.commit, fecha: v.fecha ?? '', origen: 'paquete' };
    } catch {
      // un version.json roto no tumba el arranque: se sigue buscando
    }
  }
  try {
    const raiz = fileURLToPath(new URL('..', import.meta.url));
    const git = (...a: string[]) => execFileSync('git', a, { cwd: raiz, stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).toString().trim();
    const commit = git('rev-parse', '--short', 'HEAD');
    // Lo que está sin commitear también corre: decirlo evita creer que corre exactamente el commit.
    const sucio = git('status', '--porcelain', '--untracked-files=no').length > 0;
    return { commit: `${commit}${sucio ? '+cambios' : ''}`, fecha: git('log', '-1', '--format=%cs'), origen: 'git' };
  } catch {
    return { commit: 'desconocida', fecha: '', origen: 'desconocida' };
  }
}
