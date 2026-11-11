// Lo mínimo que debe decir el servidor en cada respuesta.
//
// No arregla ningún agujero: le quita alcance a los que aparezcan. `nosniff` impide que un archivo se interprete
// como algo distinto de lo que dice ser (un CSV exportado, el logo de un cliente); `DENY` impide meter el tablero
// o la consola dentro de un marco de otra página, que es como se engaña a alguien para que pulse «Dar de baja»
// creyendo que pulsa otra cosa; y `no-referrer` evita que la dirección de esta página —con lo que lleve dentro—
// viaje a los sitios que se abren desde aquí.
import type { Context, Next } from 'hono';
import { createRequire } from 'node:module';

// La política de las páginas es la del borde (borde.cjs), para que el enrutador y lo de adentro digan lo mismo.
const borde = createRequire(import.meta.url)('./borde.cjs') as { cspDePagina(html: string): string };

/**
 * La CSP de una página: solo corren los guiones de la casa y los en línea que ella misma trae, por su huella. Se
 * calcula sobre la página TAL COMO SE SIRVE —ya con lo que se le reemplaza o se le inyecta—, que es lo que mide el
 * navegador.
 */
export const cspDePagina = (html: string): string => borde.cspDePagina(html);

/** Sirve una página con su CSP y sin caché (lo que se pinta cambia con la configuración del cliente). */
export function paginaConCsp(c: Context, html: string) {
  c.header('content-security-policy', cspDePagina(html));
  c.header('cache-control', 'no-store');
  return c.html(html);
}

export const CABECERAS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
};

export async function cabecerasDeSiempre(c: Context, next: Next) {
  await next();
  for (const [k, v] of Object.entries(CABECERAS)) c.header(k, v);
}

/**
 * 🪤 Freno de peticiones disparadas desde otra página (CSRF). Hoy lo único que lo impide es que la galleta sea
 * `SameSite=Lax`, y eso no cubre el caso que de verdad importa aquí: en el despliegue en un solo dominio, la
 * consola y la página pública de cada cliente comparten origen, así que un script que llegue a correr en
 * cualquiera de ellas hablaría con la consola como si fuera ella.
 *
 * La regla es simple: si la petición dice de dónde viene y no es de aquí, no se ejecuta. Cuando no dice nada
 * —curl, una app, el propio proxy de la consola llamando por dentro— se deja pasar: un navegador SIEMPRE manda
 * `Origin` en una petición que cambia algo, así que el ataque que se quiere frenar nunca llega sin él.
 */
export async function soloDesdeAqui(c: Context, next: Next) {
  const cambia = !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method);
  const origen = c.req.header('origin');
  if (!cambia || !origen) return next();

  // 🪤 Con qué se compara: NO con la dirección que ve este proceso. Detrás del servidor del hosting, XENCRM vive
  // en un puerto interno y ve `127.0.0.1:3900`, mientras el navegador dice `Origin: https://xencrm.<dominio>`. Eso
  // nunca coincide, y comparar contra la dirección interna dejó a todo el mundo fuera con un «esa petición no
  // viene de aquí» en el login. Lo que vale es el nombre con el que llamaron, que viaja en las cabeceras.
  const candidatos = new Set(
    [c.req.header('x-forwarded-host'), c.req.header('host'), (() => {
      try {
        return new URL(c.req.url).host;
      } catch {
        return undefined;
      }
    })()]
      .flatMap((h) => (h ? h.split(',') : []))
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );

  let deFuera = false;
  try {
    const suyo = new URL(origen).host.toLowerCase();
    // Solo se rechaza cuando se sabe con quién comparar Y no coincide con ninguno. Si no hay con qué comparar,
    // se deja pasar: quedarse sin poder entrar es peor que el ataque que esto frena.
    deFuera = candidatos.size > 0 && !candidatos.has(suyo);
  } catch {
    deFuera = true; // un Origin que ni siquiera es una dirección no viene de un navegador nuestro
  }
  if (deFuera) return c.json({ error: 'esa petición no viene de aquí' }, 403);
  await next();
}
