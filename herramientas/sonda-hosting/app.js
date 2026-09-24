// Sonda de hosting: se despliega en un hosting cualquiera (Hostinger, Render, Railway…) y responde si ahí puede
// vivir aiva o no. No prueba "si corre Node" —eso lo dice cualquiera—: prueba las cuatro cosas que aiva necesita y
// que un hosting compartido suele NO tener.
//
//   1. Que el proceso siga vivo sin que nadie lo visite (WhatsApp exige un socket abierto 24/7).
//   2. Que pueda abrir una conexión WebSocket hacia afuera y sostenerla (así habla Baileys con WhatsApp).
//   3. Que el disco sea de verdad: lo que escribe hoy tiene que seguir ahí mañana (la base es un archivo SQLite).
//   4. Cuánta memoria hay y si el proceso se reinicia solo.
//
// Sin dependencias: solo Node 20 o más nuevo. Arranca con `node app.js`.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const PUERTO = process.env.PORT || 3000;
const ARCHIVO = path.join(process.env.SONDA_DIR || __dirname, 'sonda-estado.json');
const ARRANQUE = Date.now();

// ---------- 1 y 4: ¿el proceso sobrevive y cuántas veces lo reiniciaron? ----------
let estado = { arranques: 0, primerArranque: ARRANQUE, ultimoLatido: ARRANQUE, latidos: 0, discoEscribe: false };
try {
  if (fs.existsSync(ARCHIVO)) estado = { ...estado, ...JSON.parse(fs.readFileSync(ARCHIVO, 'utf8')) };
} catch (e) {
  estado.errorLectura = String(e);
}
estado.arranques += 1;
estado.esteArranque = ARRANQUE;

function guardar() {
  try {
    fs.writeFileSync(ARCHIVO, JSON.stringify(estado, null, 2));
    estado.discoEscribe = true;
  } catch (e) {
    estado.discoEscribe = false;
    estado.errorDisco = String(e);
  }
}
guardar();

// Late cada 15 segundos sin que nadie lo visite: si los latidos se detienen, el hosting duerme el proceso.
setInterval(() => {
  estado.latidos += 1;
  estado.ultimoLatido = Date.now();
  guardar();
}, 15000).unref?.();

// ---------- 2: ¿puede abrir un WebSocket hacia afuera y sostenerlo? ----------
const ws = { estado: 'probando', abiertoDesde: null, error: null, mensajes: 0 };
function probarWebSocket() {
  if (typeof WebSocket === 'undefined') {
    ws.estado = 'node viejo';
    ws.error = 'Este Node no trae WebSocket (hace falta Node 20+)';
    return;
  }
  try {
    const s = new WebSocket('wss://ws.postman-echo.com/raw');
    s.addEventListener('open', () => {
      ws.estado = 'abierto';
      ws.abiertoDesde = Date.now();
      s.send('hola');
      setInterval(() => {
        try {
          s.send('sigo aqui');
        } catch {
          /* si se cayó, el evento close lo cuenta */
        }
      }, 20000).unref?.();
    });
    s.addEventListener('message', () => {
      ws.mensajes += 1;
    });
    s.addEventListener('error', () => {
      ws.estado = 'bloqueado';
      ws.error = 'no se pudo abrir la conexión hacia afuera';
    });
    s.addEventListener('close', () => {
      if (ws.estado === 'abierto') {
        ws.estado = 'se cerró';
        ws.cerradoA = Date.now();
      }
      setTimeout(probarWebSocket, 10000); // reintenta, a ver si es intermitente
    });
  } catch (e) {
    ws.estado = 'bloqueado';
    ws.error = String(e);
  }
}
probarWebSocket();

// ---------- El veredicto ----------
function veredicto() {
  const minutosVivo = (Date.now() - ARRANQUE) / 60000;
  const latidoFresco = Date.now() - estado.ultimoLatido < 45000;
  const problemas = [];
  const bien = [];

  if (estado.latidos === 0 && minutosVivo < 0.5) {
    problemas.push('Recién arrancó: el primer latido sale a los 15 segundos.');
  } else if (latidoFresco && estado.latidos > 0) {
    bien.push(`El proceso late solo: ${estado.latidos} latidos sin que nadie lo visite.`);
  } else {
    problemas.push('El proceso NO late solo: el hosting lo duerme entre peticiones. WhatsApp no funcionaría.');
  }

  if (ws.estado === 'abierto') bien.push(`WebSocket saliente abierto hace ${Math.round((Date.now() - ws.abiertoDesde) / 60000)} min (${ws.mensajes} mensajes).`);
  else if (ws.estado === 'probando') problemas.push('El WebSocket todavía está conectando: recarga en un minuto.');
  else problemas.push(`WebSocket saliente: ${ws.estado}${ws.error ? ` (${ws.error})` : ''}. Sin esto, WhatsApp por QR no sirve.`);

  (estado.discoEscribe ? bien : problemas).push(
    estado.discoEscribe ? 'El disco acepta escrituras (la base de cada cliente es un archivo).' : `El disco NO acepta escrituras: ${estado.errorDisco ?? ''}`,
  );

  if (estado.arranques > 1) bien.push(`El archivo sobrevivió a ${estado.arranques - 1} reinicio(s): el disco es persistente.`);
  else problemas.push('Todavía no se ha reiniciado: reinicia la app desde el panel y vuelve a mirar, para saber si el disco sobrevive.');

  if (minutosVivo < 30) problemas.push(`Lleva ${Math.round(minutosVivo)} min corriendo. Déjala una hora sin visitarla y vuelve: ahí se ve si la duermen.`);

  return { sirve: problemas.length === 0, bien, problemas };
}

http
  .createServer((req, res) => {
    const v = veredicto();
    const cuerpo = {
      veredicto: v.sirve ? 'Aquí puede vivir aiva' : 'Todavía no se puede concluir (o no sirve)',
      bien: v.bien,
      problemas: v.problemas,
      detalle: {
        node: process.version,
        plataforma: `${os.platform()} ${os.arch()}`,
        memoriaTotalGB: +(os.totalmem() / 1024 ** 3).toFixed(1),
        memoriaLibreGB: +(os.freemem() / 1024 ** 3).toFixed(1),
        cpus: os.cpus().length,
        pid: process.pid,
        vivoMinutos: +((Date.now() - ARRANQUE) / 60000).toFixed(1),
        arranques: estado.arranques,
        latidos: estado.latidos,
        websocket: ws,
        archivoDeEstado: ARCHIVO,
        puerto: PUERTO,
      },
    };
    if ((req.url || '').startsWith('/json')) {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(cuerpo, null, 2));
    }
    const lista = (xs, icono) => xs.map((x) => `<li>${icono} ${x}</li>`).join('');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Sonda · ¿cabe aiva aquí?</title>
<meta http-equiv="refresh" content="30">
<style>body{font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;color:#111827}
h1{font-size:20px}h2{font-size:15px;margin-top:24px}ul{padding-left:20px}li{margin-bottom:6px}
.v{padding:12px 14px;border-radius:12px;font-weight:600;background:${v.sirve ? '#dcfce7' : '#fef3c7'};color:${v.sirve ? '#166534' : '#a3480a'}}
pre{background:#f3f4f6;padding:12px;border-radius:10px;overflow:auto;font-size:12px}</style></head><body>
<h1>Sonda de hosting · ¿cabe aiva aquí?</h1>
<p class="v">${cuerpo.veredicto}</p>
${v.bien.length ? `<h2>Lo que sí</h2><ul>${lista(v.bien, '✅')}</ul>` : ''}
${v.problemas.length ? `<h2>Lo que falta o falla</h2><ul>${lista(v.problemas, '⚠️')}</ul>` : ''}
<h2>Detalle</h2><pre>${JSON.stringify(cuerpo.detalle, null, 2)}</pre>
<p style="color:#5f6875;font-size:13px">Esta página se recarga sola cada 30 s. Lo importante es volver <b>una hora después sin visitarla</b>:
si los latidos siguieron subiendo, el hosting deja vivir el proceso.</p>
</body></html>`);
  })
  .listen(PUERTO, () => console.log(`[sonda] escuchando en ${PUERTO} · estado en ${ARCHIVO}`));
