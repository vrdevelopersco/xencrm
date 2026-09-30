// Quién puede abrir la libreta: la llave y desde qué direcciones.
//
// 🪤 Vive en un archivo y no en la base de un cliente porque lo escribe la consola —que es de quien opera el
// sistema— y lo leen los procesos de los clientes, que son otros. Un archivo en la carpeta que los dos ya
// comparten es lo más simple que funciona: sin pedirle nada a nadie por la red, y sin que la consola tenga que
// ir uno por uno avisando del cambio.
//
// Se relee cada pocos segundos: quien quita una dirección quiere que deje de entrar YA, no en el próximo
// reinicio.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface LibretaConfig {
  /** Sin llave, la libreta no existe. No es que conteste que no: devuelve 404. */
  llave: string;
  /**
   * Desde qué direcciones se puede abrir. Vacío = desde ninguna.
   *
   * 🪤 El valor por defecto es «ninguna», no «todas». Si alguien pone la llave y se olvida de las direcciones,
   * lo peor que pasa es que no le funcione a él; con el defecto al revés, lo peor que pasa es que le funcione
   * a cualquiera.
   */
  ips: string[];
}

const VACIA: LibretaConfig = { llave: '', ips: [] };

function archivo(): string {
  const dir = process.env.AIVA_CLIENTES_DIR || join(process.cwd(), 'clientes');
  return join(dir, 'libreta.json');
}

let cache: { cuando: number; valor: LibretaConfig } | null = null;

export function libretaConfig(): LibretaConfig {
  if (cache && Date.now() - cache.cuando < 5000) return cache.valor;
  let valor = VACIA;
  try {
    const crudo = JSON.parse(readFileSync(archivo(), 'utf8')) as Partial<LibretaConfig>;
    valor = {
      llave: typeof crudo.llave === 'string' ? crudo.llave.trim() : '',
      ips: Array.isArray(crudo.ips) ? crudo.ips.map((x) => String(x).trim()).filter(Boolean) : [],
    };
  } catch {
    /* no hay archivo todavía: la libreta está cerrada, que es el estado correcto por defecto */
  }
  cache = { cuando: Date.now(), valor };
  return valor;
}

export function guardarLibretaConfig(c: LibretaConfig): LibretaConfig {
  const dir = process.env.AIVA_CLIENTES_DIR || join(process.cwd(), 'clientes');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const limpio: LibretaConfig = {
    llave: c.llave.trim(),
    ips: [...new Set(c.ips.map((x) => x.trim()).filter(Boolean))],
  };
  writeFileSync(archivo(), JSON.stringify(limpio, null, 2) + '\n');
  cache = null;
  return limpio;
}

/**
 * La misma máquina tiene dos nombres, `::1` y `127.0.0.1`, y cuál te toca depende de por dónde entres. Quien
 * añade su dirección en la consola añade una sola, y no tiene por qué saber que existe la otra: aquí se dejan
 * como la misma para que «añadí la mía y sigue sin abrir» no pase.
 */
const mismaCasa = (ip: string): string => (ip === '::1' || ip === '0:0:0:0:0:0:0:1' ? '127.0.0.1' : ip);

/** Direcciones de la propia máquina o de la red interna: de ahí solo puede venir un servidor de delante. */
function esDeCasa(ip: string): boolean {
  const limpia = ip.replace(/^::ffff:/, '');
  return (
    limpia === '::1' ||
    /^127\./.test(limpia) ||
    /^10\./.test(limpia) ||
    /^192\.168\./.test(limpia) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(limpia) ||
    /^f[cd]/i.test(limpia) // fc00::/7, direcciones privadas de IPv6
  );
}

/**
 * De dónde viene quien llama.
 *
 * 🪤 `x-forwarded-for` LO ESCRIBE QUIEN QUIERA. Fiarse de esa cabecera a secas convierte el sello por dirección
 * en decoración: quien tuviera la llave la mandaría diciendo que viene de la dirección permitida y entraría
 * desde cualquier parte del mundo.
 *
 * Así que primero se mira por dónde llegó de verdad la conexión, que eso no se falsifica, y la cabecera solo se
 * cree cuando la conexión viene de casa —del servidor del alojamiento, que está en la misma máquina y es quien
 * la reescribe—. Si la petición llega directa desde fuera, manda la dirección del socket y la cabecera se
 * ignora, venga lo que venga escrito en ella.
 *
 * `directa` vacío es «no sé por dónde llegó»: entonces no queda más que la cabecera, y por eso la llave sigue
 * haciendo falta además de la dirección.
 */
export function deDondeViene(cabeceras: Record<string, string | undefined>, directa = ''): string {
  const dePaso = mismaCasa(((cabeceras['cf-connecting-ip'] || cabeceras['x-forwarded-for'] || cabeceras['x-real-ip'] || '').split(',')[0] ?? '').trim().replace(/^::ffff:/, ''));
  const real = mismaCasa(directa.replace(/^::ffff:/, '').trim());
  if (!real) return dePaso;
  if (!esDeCasa(real)) return real; // llegó directa de internet: lo que diga la cabecera no vale nada
  return dePaso || real; // vino del servidor de delante; si no anotó nada, es que estamos en la misma máquina
}

/** Compara direcciones. Admite comodín al final (`190.24.` entra para toda esa red). */
export function direccionPermitida(ip: string, permitidas: string[]): boolean {
  if (!ip || !permitidas.length) return false;
  return permitidas.some((p) => (p.endsWith('.') ? ip.startsWith(p) : ip === p));
}
