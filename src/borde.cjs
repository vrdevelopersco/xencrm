// El borde: lo que el enrutador del paquete le pone a TODO lo que sale, y lo de adentro que no deja pasar.
//
// El enrutador es el único sitio por donde pasa cada respuesta —la portada, los archivos sueltos, /_salud, lo de
// cada cliente, la consola, la pantalla de «Arrancando»—, así que una regla puesta aquí no se olvida en ninguna
// ruta. Medido el 2026-11-07 con el verificador del estándar de seguridad (~/proyectos/AUDITORIA-SEGURIDAD.md): la
// consola traía sus cabeceras y la portada ninguna, porque cada página se las ponía por su cuenta.
//
// Va en CommonJS y aparte del lanzador por dos razones: el lanzador es una plantilla de texto (un acento grave la
// parte en dos), y así las pruebas (src/eval/blindaje.ts) lo cargan y lo prueban de verdad, no con expresiones
// sobre el código. Las páginas de adentro lo usan también (cabeceras.ts), para que la política sea una sola.
'use strict';
const { createHash } = require('node:crypto');

/**
 * Lo que lleva toda respuesta, sin excepción.
 *
 * HSTS para que el navegador no vuelva a intentar por http (ahí una galleta o una clave viajan a la vista).
 * `nosniff` para que un archivo no se interprete como algo distinto de lo que dice ser. `no-referrer` para que la
 * dirección de esta página no viaje a los sitios que se abren desde aquí. Y ningún permiso del aparato: XENCRM no
 * usa la cámara, el micrófono ni la ubicación, y una página que no los pide no se los puede dar a un guion ajeno.
 */
const DE_SIEMPRE = {
  'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
};

/**
 * Para lo que no es una página (JSON, imágenes, el logo de un cliente): nada puede correr. Un SVG abierto como
 * página ejecuta JavaScript, y el logo lo sube quien configura el cliente.
 */
const SIN_PAGINA = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";

/**
 * La CSP de una página: solo corren los guiones de la casa (por archivo) y los en línea que la página trae, cada
 * uno por su huella. Uno que inyecte un desconocido —un nombre de contacto con un `<script>` que se escapó— no
 * tiene huella y no corre.
 *
 * 🪤 `style-src 'unsafe-inline'` es un riesgo ACEPTADO, y queda escrito: las pantallas pintan con `style="…"` en
 * cientos de sitios y la hoja de estilos va dentro de cada página. Un estilo inyectado puede desordenar una
 * pantalla; no puede llevarse nada. Lo que sí roba —un guion— queda cerrado.
 */
function politica(huellas) {
  return [
    "default-src 'self'",
    "script-src 'self'" + huellas.map((h) => " 'sha256-" + h + "'").join(''),
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "connect-src 'self'",
    "frame-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

const EN_LINEA = /<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script\s*>/gi;

/** Las huellas de los guiones en línea de una página, tal como van escritos (es lo que el navegador mide). */
function huellasDe(html) {
  const huellas = [];
  for (const m of String(html).matchAll(EN_LINEA)) {
    const h = createHash('sha256').update(m[1], 'utf8').digest('base64');
    if (!huellas.includes(h)) huellas.push(h);
  }
  return huellas;
}

const cspDePagina = (html) => politica(huellasDe(html));

/**
 * Las cabeceras de una respuesta, ya blindadas. Lo que diga la de adentro manda en lo suyo (su CSP, su caché, si
 * deja que la enmarquen); lo de siempre se pone encima, porque no hay ruta que pueda prescindir de ello.
 *
 * 🪤 Lo que no dice nada de su caché queda SIN caché. Al revés —cachear salvo que se diga— una página que cambia
 * según quién entró (la consola con sesión o sin ella) acaba servida a otro desde la caché del alojamiento.
 */
function blindar(cabeceras) {
  const fuera = {};
  for (const k of Object.keys(cabeceras || {})) if (cabeceras[k] !== undefined) fuera[k.toLowerCase()] = cabeceras[k];
  // El servidor no se presenta: qué programa y qué versión es lo primero que mira quien busca un fallo conocido.
  delete fuera.server;
  delete fuera['x-powered-by'];
  Object.assign(fuera, DE_SIEMPRE);
  if (!fuera['x-frame-options']) fuera['x-frame-options'] = 'DENY';
  if (!fuera['content-security-policy'] && !/text\/html/i.test(String(fuera['content-type'] || ''))) fuera['content-security-policy'] = SIN_PAGINA;
  if (!fuera['cache-control']) fuera['cache-control'] = 'no-store';
  return fuera;
}

/**
 * Lo de adentro de cada cliente que no se sirve desde fuera.
 *
 * El tablero de un cliente se abre desde la consola (`/c/<cliente>/admin`), que pide sesión y le pone el token al
 * pasar. Por la ruta del cliente (`/<cliente>/admin`) cualquiera bajaba la página y su código entero —con sus
 * comentarios— sin haber entrado nunca: el mapa completo de la API servido a un desconocido. Y `/_servicio` y
 * `/health` contaban el estado del WhatsApp, los motores y los modelos: son para el lanzador, que les habla por
 * adentro, no para quien pregunta desde la calle.
 *
 * `TABLERO_DIRECTO=si` en el panel vuelve a abrir el tablero por su ruta (con su token), por si alguien lo
 * necesita mientras se pasa a la consola. Lo de servicio no se abre nunca.
 *
 * 🪤 Se mira la ruta como la va a leer el de adentro: decodificada y sin barras repetidas. `/%61dmin` y `//admin`
 * llegan a la misma página que `/admin`, y una regla que no los reconozca es una puerta con el cartel cambiado.
 */
const SOLO_ADENTRO = /^\/(?:_servicio|health)(?:\/|$)/i;
const DEL_TABLERO = /^\/admin(?:\.js|\/|$)/i;
function cerradoDesdeFuera(ruta, env) {
  let camino = String(ruta || '/').split('?')[0].split('#')[0];
  try {
    camino = decodeURIComponent(camino);
  } catch (e) {
    return true; // una ruta que ni se puede leer no la pide ningún navegador nuestro
  }
  camino = ('/' + camino).replace(/\\/g, '/').replace(/\/(?:\.\/)+/g, '/').replace(/\/{2,}/g, '/');
  if (SOLO_ADENTRO.test(camino)) return true;
  return DEL_TABLERO.test(camino) && String((env && env.TABLERO_DIRECTO) || '').toLowerCase() !== 'si';
}

/**
 * Desde qué dirección llama quien llama.
 *
 * 🪤 Medido en producción el 2026-11-07: el alojamiento AÑADE la dirección de verdad al `x-forwarded-for` que
 * mande el navegador, en vez de reemplazarlo. Así que el primer elemento —el que se usaba— lo escribe quien
 * llama: la bitácora anotó tal cual una dirección inventada, y con eso se esquivan el freno de intentos y la
 * lista de direcciones de la libreta. La dirección buena está más a la derecha, a tantos saltos del final como
 * servidores del alojamiento haya detrás de quien la anota.
 *
 * Medido después de subir (2026-11-07, /_salud › tuPeticion): sin cabecera llega `R, R,R`; mandando `F` llega
 * `F, R, F, R,R`; mandando `F1, F2`, `F1, F2, R, F1, F2, R,R`. Lo que mande el navegador queda siempre ANTES, y el
 * último elemento es siempre la dirección de verdad: lo pone el último servidor del alojamiento.
 *
 * `XENCRM_IP` dice cuántos saltos desde la derecha: un número (0 = el último, que es lo medido y lo de por defecto)
 * o `primera` para volver a lo de antes. 🪤 Si algún día se pone Cloudflare delante, esto cambia ese mismo día:
 * ver docs/seguridad.md.
 */
const SALTOS_MEDIDOS = 0;
function direccionDeQuienLlama(cabeceras, regla) {
  const lista = String((cabeceras && cabeceras['x-forwarded-for']) || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!lista.length) return '';
  const r = String(regla == null ? '' : regla).trim().toLowerCase();
  if (r === 'primera') return lista[0];
  const saltos = /^\d+$/.test(r) ? Number(r) : SALTOS_MEDIDOS;
  return lista[Math.max(0, lista.length - 1 - saltos)];
}

/**
 * Las cabeceras de quien llama, sin las que dicen de dónde viene salvo la que se acaba de decidir. Adentro se
 * cree a `cf-connecting-ip` antes que a nada, y aquí no hay Cloudflare delante: cualquiera la puede mandar.
 */
const SUPLANTAN = ['cf-connecting-ip', 'x-real-ip', 'true-client-ip', 'x-client-ip', 'forwarded'];
function sinSuplantar(cabeceras, ip) {
  const fuera = {};
  for (const k of Object.keys(cabeceras || {})) if (!SUPLANTAN.includes(k.toLowerCase())) fuera[k] = cabeceras[k];
  delete fuera['x-forwarded-for'];
  if (ip) fuera['x-forwarded-for'] = ip;
  return fuera;
}

/**
 * /.well-known/security.txt (RFC 9116): a quién escribirle si alguien encuentra un fallo. Sin esto, quien lo
 * encuentra con buena fe no sabe a quién decírselo, y quien lo encuentra con mala fe no tiene ese problema.
 * Vence al año de armado el paquete: si nadie sube una versión en un año, que lo diga.
 */
function securityTxt(host, contacto, armadoEl) {
  const desde = Date.parse(armadoEl || '') || Date.now();
  return [
    // Sin contacto configurado (SEGURIDAD_CONTACTO), el buzón de siempre del propio dominio.
    'Contact: ' + (contacto || 'mailto:security@' + host),
    'Expires: ' + new Date(desde + 365 * 864e5).toISOString(),
    'Preferred-Languages: es, en',
    'Canonical: https://' + host + '/.well-known/security.txt',
    '',
  ].join('\n');
}

module.exports = { DE_SIEMPRE, SIN_PAGINA, blindar, cerradoDesdeFuera, cspDePagina, direccionDeQuienLlama, huellasDe, politica, securityTxt, sinSuplantar };
