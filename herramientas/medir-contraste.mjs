// Mide el contraste REAL del tablero en oscuro, sobre los píxeles pintados.
//
// El método es el del documento: se oculta el texto (color transparente), se captura, y se busca el PEOR píxel
// del fondo dentro del recuadro de ese texto — el que más se le parece en luminancia—. Un número calculado sobre
// el color base miente en cuanto hay grano, vidrio o un degradado debajo.
//
//   node medir-oscuro.mjs <url> <token> <salida.png>
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const [url, token, salida] = process.argv.slice(2);
const perfil = mkdtempSync(join(tmpdir(), 'chrome-med-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new','--remote-debugging-port=9351','--user-data-dir='+perfil,'--no-first-run','--hide-scrollbars','--window-size=1280,1000','about:blank'], { stdio: 'ignore' });
const esperar=(ms)=>new Promise(r=>setTimeout(r,ms));
let d=null; for(let i=0;i<40&&!d;i++){await esperar(250);try{d=(await fetch('http://127.0.0.1:9351/json/list').then(r=>r.json())).find(t=>t.type==='page');}catch{}}
const ws=new WebSocket(d.webSocketDebuggerUrl); await new Promise(r=>ws.onopen=r);
let n=0; const p=new Map(); ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&p.has(m.id)){p.get(m.id)(m.result);p.delete(m.id);}};
const cdp=(m,q={})=>new Promise(r=>{const id=++n;p.set(id,r);ws.send(JSON.stringify({id,method:m,params:q}));});
const js=async(expr)=>{const r=await cdp('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});
  if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value;};
await cdp('Page.enable'); await cdp('Runtime.enable');
// Escala 1: así un píxel de la captura es un píxel del recuadro y no hay que convertir nada.
await cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
await cdp('Page.navigate',{url}); await esperar(2500);

await js(`(()=>{document.getElementById('login-name').value='Luigi';document.getElementById('login-token').value=${JSON.stringify(token)};document.getElementById('login-btn').click();return 1})()`);
await esperar(3500);
// Al oscuro, por el botón (el tablero fija el tema al arrancar y pisa lo que se ponga a mano).
for (let i = 0; i < 4; i++) {
  const t = await js(`document.documentElement.getAttribute('data-theme')`);
  if (t === 'dark') break;
  await js(`(()=>{document.getElementById('theme-btn').click();return 1})()`);
  await esperar(600);
}
const tema = await js(`document.documentElement.getAttribute('data-theme')`);
// A Prospectos, que es donde viven las tarjetas de papel y los chips.
await js(`(()=>{const b=document.querySelector('[data-view="pipeline"]');if(b)b.click();return 1})()`);
await esperar(3000);

// Lo que se mide: cada entrada es un selector y una etiqueta.
const OBJETIVOS = [
  ['.card .card-open', 'nombre en la tarjeta (hoja de bloc)'],
  ['.card .cuando', 'detalle de la tarjeta, sobre los renglones'],
  ['.card .body', 'cuerpo de la tarjeta'],
  ['.card .chip.who', 'chip «la lleva…» sobre la tarjeta'],
  ['.col .cuenta', 'contador de la columna'],
  ['.btn.primary', 'texto del botón primario'],
  ['.topbar h1', 'título de la pantalla'],
];
const encontrados = await js(`(${JSON.stringify(OBJETIVOS)}).map(([sel,etq])=>{
  const e=document.querySelector(sel);
  if(!e) return {etq, falta:true};
  const r=e.getBoundingClientRect();
  if(r.width<4||r.height<4) return {etq, falta:true};
  return {etq, sel, color:getComputedStyle(e).color, x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height), texto:(e.textContent||'').trim().slice(0,28)};
})`);

// Ocultar el texto de los que se van a medir, dejando el fondo.
await js(`(()=>{const s=document.createElement('style');s.id='sin-texto';
  s.textContent=${JSON.stringify(OBJETIVOS.map(o=>o[0]).join(','))}+'{color:transparent!important;text-shadow:none!important}';
  document.head.appendChild(s);return 1})()`);
await esperar(400);
const foto = await cdp('Page.captureScreenshot',{format:'png'});
writeFileSync(salida, Buffer.from(foto.data,'base64'));

// La captura vuelve al navegador y se lee con canvas: así no hay que decodificar PNG a mano aquí.
const medidas = await js(`(async()=>{
  const img=new Image();
  await new Promise(r=>{img.onload=r;img.src='data:image/png;base64,${foto.data}';});
  const c=document.createElement('canvas');c.width=img.width;c.height=img.height;
  const g=c.getContext('2d');g.drawImage(img,0,0);
  const lum=(R,G,B)=>{const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)};return 0.2126*f(R)+0.7152*f(G)+0.0722*f(B)};
  const deColor=(s)=>{const m=s.match(/[\\d.]+/g).map(Number);return lum(m[0],m[1],m[2])};
  const objetivos=${JSON.stringify(encontrados)};
  return objetivos.map(o=>{
    if(o.falta) return o;
    const Lt=deColor(o.color);
    const d=g.getImageData(o.x,o.y,Math.max(1,o.w),Math.max(1,o.h)).data;
    let peor=null;
    for(let i=0;i<d.length;i+=4){
      const L=lum(d[i],d[i+1],d[i+2]);
      const ratio=(Math.max(L,Lt)+0.05)/(Math.min(L,Lt)+0.05);
      if(peor===null||ratio<peor.ratio) peor={ratio,rgb:[d[i],d[i+1],d[i+2]]};
    }
    return {etq:o.etq, texto:o.texto, color:o.color, peorPixel:'rgb('+peor.rgb.join(',')+')', ratio:Math.round(peor.ratio*100)/100};
  });
})()`);
console.log(JSON.stringify({ tema, medidas }, null, 1));
ws.close(); chrome.kill(); process.exit(0);
