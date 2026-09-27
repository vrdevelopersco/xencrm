// ¿Puede esta máquina hablar con WhatsApp?
//
// Existe por un caso concreto: el mismo código que en un portátil entrega el código QR en dos segundos, en un
// hosting compartido se queda dando vueltas con «conexión cerrada (428)» y nunca enseña nada. Desde fuera no se
// distingue un fallo del programa de una puerta cerrada en el servidor, y eso deja la conversación en el terreno
// de la sospecha. Esto la saca de ahí.
//
// WhatsApp por código QR no es una API que se llama y contesta: es una conexión que se abre y se queda abierta
// (un WebSocket contra sus servidores). Muchos alojamientos compartidos dejan salir peticiones normales y NO
// dejan abrir ese tipo de conexión. Por eso se prueban las dos cosas por separado, y cada una contra WhatsApp y
// contra un destino neutral: así se sabe si lo que falla es *este servidor*, *este tipo de conexión* o
// *WhatsApp en concreto*.
import { randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';

export interface Prueba {
  que: string;
  ok: boolean;
  ms: number;
  detalle: string;
}

const cronometrar = async (que: string, fn: () => Promise<string>): Promise<Prueba> => {
  const t0 = Date.now();
  try {
    return { que, ok: true, ms: Date.now() - t0, detalle: await fn() };
  } catch (err) {
    return { que, ok: false, ms: Date.now() - t0, detalle: (err as Error).message || String(err) };
  }
};

/**
 * El saludo de una conexión permanente, hecho a mano.
 *
 * 🪤 No sirve el WebSocket que trae Node: no deja poner la cabecera `Origin`, y WhatsApp rechaza sin ella. Con
 * eso, la prueba fallaba **también en una máquina donde el código QR funciona**, que es la peor clase de
 * diagnóstico: el que acusa al sitio equivocado. Así se distingue lo que de verdad importa: si no llega
 * respuesta, el camino está cortado (el alojamiento); si llega una respuesta que no es «abro», el camino está
 * abierto y quien dice que no es el otro extremo.
 */
function saludoDeConexion(host: string, path: string, origin: string, ms = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    const pide = request({
      host,
      path,
      method: 'GET',
      timeout: ms,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
        Origin: origin,
      },
    });
    pide.on('upgrade', (res, socket) => {
      socket.destroy();
      resolve(`la conexión abrió (${res.statusCode})`);
    });
    pide.on('response', (res) => {
      res.destroy();
      reject(new Error(`el camino llega, pero contestó ${res.statusCode} en vez de abrir la conexión`));
    });
    pide.on('timeout', () => {
      pide.destroy();
      reject(new Error(`sin respuesta en ${ms / 1000} s`));
    });
    pide.on('error', (e) => reject(e));
    pide.end();
  });
}

/**
 * Las cinco preguntas, en orden de «¿hay internet?» a «¿me deja WhatsApp?». Se leen de arriba abajo: la primera
 * que falle dice dónde está el muro.
 */
export async function diagnosticoDeSalida(): Promise<{ pruebas: Prueba[]; veredicto: string }> {
  const pruebas = [
    await cronometrar('Resolver el nombre de WhatsApp', async () => {
      const r = await lookup('web.whatsapp.com');
      return `web.whatsapp.com → ${r.address}`;
    }),
    await cronometrar('Salir a internet (destino neutral)', async () => {
      const r = await fetch('https://example.com/', { method: 'HEAD', signal: AbortSignal.timeout(8000) });
      return `contestó ${r.status}`;
    }),
    await cronometrar('Petición normal a WhatsApp', async () => {
      const r = await fetch('https://web.whatsapp.com/', { method: 'HEAD', signal: AbortSignal.timeout(8000) });
      return `contestó ${r.status}`;
    }),
    await cronometrar('Conexión permanente a un destino neutral', () => saludoDeConexion('ws.postman-echo.com', '/raw', 'https://ws.postman-echo.com')),
    await cronometrar('Conexión permanente a WhatsApp (la que hace falta)', () => saludoDeConexion('web.whatsapp.com', '/ws/chat', 'https://web.whatsapp.com')),
  ];

  const [dns, internet, httpWa, wsNeutro, wsWa] = pruebas as [Prueba, Prueba, Prueba, Prueba, Prueba];
  // 🪤 El destino neutral es de un tercero y puede desaparecer, así que nunca decide él solo: solo sirve para
  // matizar. Lo que manda es si la conexión con WhatsApp abre, y si no, si llegó a haber respuesta.
  const nadieContesto = /sin respuesta|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|socket hang up/i.test(wsWa.detalle);
  let veredicto: string;
  if (!dns.ok) veredicto = 'Este servidor no resuelve el nombre de WhatsApp: el problema es de DNS, antes que nada.';
  else if (!internet.ok) veredicto = 'Este servidor no sale a internet: no es cosa de WhatsApp.';
  else if (!httpWa.ok) veredicto = 'Sale a internet, pero no alcanza WhatsApp: hay un filtro por destino.';
  else if (wsWa.ok) veredicto = 'Puede hablar con WhatsApp: la conexión que hace falta abre. Si el código QR no aparece, el problema está en otra parte.';
  else if (nadieContesto && wsNeutro.ok) veredicto = 'Las conexiones permanentes funcionan hacia otros sitios, pero hacia WhatsApp no llega respuesta: el camino a WhatsApp está cortado desde este servidor.';
  else if (nadieContesto) veredicto = 'Este servidor no deja abrir conexiones permanentes (WebSocket), que es lo que WhatsApp por código QR necesita. Aquí no va a funcionar: tiene que correr en una máquina propia.';
  else veredicto = `El camino llega, pero WhatsApp no acepta la conexión de este servidor (${wsWa.detalle}). Suele pasar con direcciones de centros de datos compartidos.`;

  return { pruebas, veredicto };
}
