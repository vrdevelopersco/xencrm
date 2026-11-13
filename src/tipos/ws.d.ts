// Lo que XENCRM usa de `ws` (el puente de voz, src/voz/llamada.ts). Sin @types/ws: la librería ya venía con WhatsApp
// y sus tipos no, así que se declara solo lo que se usa.
declare module 'ws' {
  import type { IncomingMessage } from 'node:http';
  import type { Duplex } from 'node:stream';
  import { EventEmitter } from 'node:events';

  type Datos = Buffer | ArrayBuffer | Buffer[];

  export class WebSocket extends EventEmitter {
    static readonly CONNECTING: 0;
    static readonly OPEN: 1;
    static readonly CLOSING: 2;
    static readonly CLOSED: 3;
    readonly readyState: number;
    constructor(url: string, opciones?: { headers?: Record<string, string>; maxPayload?: number });
    send(datos: string | Buffer | ArrayBufferView, cb?: (err?: Error) => void): void;
    close(codigo?: number, razon?: string): void;
    terminate(): void;
    on(evento: 'message', l: (datos: Datos, esBinario: boolean) => void): this;
    on(evento: 'open', l: () => void): this;
    on(evento: 'close', l: (codigo: number, razon: Buffer) => void): this;
    on(evento: 'error', l: (err: Error) => void): this;
    on(evento: 'unexpected-response', l: (req: unknown, res: IncomingMessage) => void): this;
    once(evento: 'open', l: () => void): this;
    once(evento: 'close', l: (codigo: number, razon: Buffer) => void): this;
  }

  export class WebSocketServer extends EventEmitter {
    constructor(opciones: { noServer?: boolean; maxPayload?: number });
    handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, cb: (ws: WebSocket, req: IncomingMessage) => void): void;
    close(cb?: () => void): void;
  }

  export default WebSocket;
}
