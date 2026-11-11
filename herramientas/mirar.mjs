// Abre una página en Chrome con una sesión puesta y guarda una captura, además de decir qué se ve.
//
// Por qué existe: probar por HTTP (curl) dice que el servidor contesta 200, pero no si la página SIRVE. Con esto
// salió un error que ninguna prueba veía: el tablero traía un `null.onclick` al cargarse, se caía el JavaScript
// entero y quedaba pidiendo un token que ya no hacía falta. El HTML era correcto; lo roto era el navegador.
//
//   node herramientas/mirar.mjs <url> <sesion> <salida.png>
//
// <sesion> es el valor de la galleta `xencrm_consola` (la que devuelve /api/entrar). Para el tablero de un cliente:
//
//   curl -s -c /tmp/g.txt -X POST http://127.0.0.1:3500/api/entrar \
//     -H 'content-type: application/json' -d '{"maestra":"TU_CONSOLA_TOKEN"}'
//   node herramientas/mirar.mjs http://127.0.0.1:3500/c/dunor/admin "$(grep xencrm_consola /tmp/g.txt | awk '{print $NF}')" /tmp/v.png
//
// Imprime la marca de la consola, si el login quedó oculto, qué negocio se lee y los errores de JavaScript que
// hubo. Eso último es lo que más sirve: un error ahí deja la página muerta sin que el servidor se entere.
import { spawn } from 'node:child_process';
const [url, galleta, salida] = process.argv.slice(2);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const perfil = '/tmp/perfil-chrome-xencrm';
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9222', `--user-data-dir=${perfil}`, '--hide-scrollbars', '--window-size=1340,820', 'about:blank'], { stdio: 'ignore' });
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
await esperar(2500);
const lista = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const ws = new WebSocket(lista.find((t) => t.type === 'page').webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const cmd = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise((r) => (ws.onopen = r));
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d.result); pend.delete(d.id); } };
const u = new URL(url);
await cmd('Network.enable');
await cmd('Network.setCookie', { name: 'xencrm_consola', value: galleta, domain: u.hostname, path: '/' });
await cmd('Page.enable');
await cmd('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__errs=[];addEventListener("error",function(e){window.__errs.push(e.message)});' });
await cmd('Page.navigate', { url });
await esperar(6000);
const { data } = await cmd('Page.captureScreenshot', { format: 'png' });
const ev = async (e) => (await cmd('Runtime.evaluate', { expression: e, returnByValue: true })).result.value;
console.log('XENCRM_CONSOLA   :', JSON.stringify(await ev('window.XENCRM_CONSOLA')));
console.log('login oculto   :', await ev('document.getElementById("login").hidden'));
console.log('negocio        :', await ev('document.getElementById("brand-biz").textContent'));
console.log('errores        :', await ev('(window.__errs||[]).join(" | ")'));
const fs = await import('node:fs');
fs.writeFileSync(salida, Buffer.from(data, 'base64'));
ws.close(); chrome.kill();
