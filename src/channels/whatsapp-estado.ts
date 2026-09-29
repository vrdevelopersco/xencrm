// El estado de WhatsApp, sin cargar WhatsApp.
//
// 🪤 Existe por una razón muy concreta: la librería que habla con WhatsApp ocupa **77 MB por proceso** solo con
// importarla (medido). Con un proceso por cliente, tres clientes son 230 MB que se pagan aunque ninguno tenga
// WhatsApp encendido — y en un alojamiento con límite de memoria eso es la diferencia entre arrancar y no
// arrancar. Pasó: los cuatro procesos dejaron de levantar y el sitio se quedó devolviendo «todavía está
// arrancando» en todo.
//
// Así que el estado vive aquí, que no depende de nada, y la librería se carga **solo cuando se enciende el
// canal**. El tablero puede preguntar «¿cómo va WhatsApp?» sin pagar esos megas.
import { createRequire } from 'node:module';

// 🪤 `conflicto` es un estado propio y no un error cualquiera. Significa que este mismo número lo tiene abierto
// otro sitio (otra copia del proceso, otro servidor, el portátil de alguien), y los dos se echan sin parar. No
// se arregla reintentando —reintentar es justo lo que lo alimenta—, así que se deja de intentar y se dice qué
// pasa, que es distinto de «se cayó».
export type WhatsAppState = 'apagado' | 'conectando' | 'esperando_qr' | 'conectado' | 'sesion_cerrada' | 'conflicto';

export const status: { state: WhatsAppState; qr?: string; me?: string; error?: string; since: number } = {
  state: 'apagado',
  since: Date.now(),
};

export function setStatus(state: WhatsAppState, extra: { qr?: string; me?: string; error?: string } = {}): void {
  Object.assign(status, { state, qr: undefined, error: undefined, ...extra, since: Date.now() });
}

/** Los últimos cortes, para ver el patrón: cuánto aguantó cada intento y con qué razón se cayó. */
export const cierres: { cuando: number; code: number | null; razon: string; duroSegundos: number }[] = [];

/** El código QR dibujado para el tablero. Usa el codificador de `qrcode-terminal`, que pesa poco. */
export function qrSvg(text: string): string {
  const require = createRequire(import.meta.url);
  const QRCode = require('qrcode-terminal/vendor/QRCode') as new (type: number, level: number) => {
    addData: (s: string) => void;
    make: () => void;
    getModuleCount: () => number;
    isDark: (r: number, c: number) => boolean;
  };
  const level = (require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel') as { L: number }).L;
  const qr = new QRCode(-1, level);
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 2;
  const lado = n + quiet * 2;
  let path = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) path += `M${c + quiet} ${r + quiet}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado} ${lado}" shape-rendering="crispEdges" width="240" height="240"><rect width="${lado}" height="${lado}" fill="#fff"/><path d="${path}" fill="#111"/></svg>`;
}

export const whatsappStatus = () => ({ ...status, qrSvg: status.qr ? qrSvg(status.qr) : undefined });
