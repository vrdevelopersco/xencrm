// Imprime la hoja de producto (docs/producto.html) a PDF: pnpm producto
// Usa el Chrome que ya está instalado, sin dependencias nuevas. La hoja es HTML para poder cambiarla sin abrir un
// editor raro: se edita el archivo, se vuelve a correr esto y queda el PDF.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const FUENTE = process.argv[2] ?? 'docs/producto.html';
const DESTINO = process.argv[3] ?? 'docs/xencrm-producto.pdf';
const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
].find((p) => existsSync(p));

if (!existsSync(FUENTE)) {
  console.error(`No encuentro ${FUENTE}`);
  process.exit(1);
}
if (!CHROME) {
  console.error('No encuentro Chrome para imprimir el PDF. Instálalo o abre docs/producto.html y usa "Imprimir → Guardar como PDF".');
  process.exit(1);
}

const perfil = mkdtempSync(join(tmpdir(), 'xencrm-pdf-'));
const puerto = 9400 + Math.floor(Math.random() * 100);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${puerto}`, `--user-data-dir=${perfil}`, 'about:blank'], { stdio: 'ignore' });
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Respuesta = { id?: number; result?: { data?: string } };
let objetivo: { webSocketDebuggerUrl: string } | undefined;
for (let i = 0; i < 40 && !objetivo; i++) {
  await dormir(250);
  try {
    objetivo = ((await (await fetch(`http://127.0.0.1:${puerto}/json`)).json()) as { type: string; webSocketDebuggerUrl: string }[]).find((t) => t.type === 'page');
  } catch {
    /* todavía arrancando */
  }
}
if (!objetivo) {
  chrome.kill();
  console.error('Chrome no respondió.');
  process.exit(1);
}

const ws = new WebSocket(objetivo.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pendientes = new Map<number, (m: Respuesta) => void>();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(String(e.data)) as Respuesta;
  if (m.id && pendientes.has(m.id)) {
    pendientes.get(m.id)!(m);
    pendientes.delete(m.id);
  }
});
const enviar = (method: string, params: Record<string, unknown> = {}) =>
  new Promise<Respuesta>((r) => {
    const i = ++id;
    pendientes.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

await enviar('Page.navigate', { url: `file://${resolve(FUENTE)}` });
await dormir(1200); // que cargue tipografías y pinte
const pdf = await enviar('Page.printToPDF', {
  printBackground: true,
  preferCSSPageSize: true,
  displayHeaderFooter: false,
});
ws.close();
chrome.kill();

const datos = pdf.result?.data;
if (!datos) {
  console.error('No se pudo imprimir el PDF.');
  process.exit(1);
}
writeFileSync(DESTINO, Buffer.from(datos, 'base64'));
const kb = Math.round(Buffer.from(datos, 'base64').length / 1024);
console.log(`✓ ${DESTINO} (${kb} KB) · se regenera con: pnpm producto`);
process.exit(0);
