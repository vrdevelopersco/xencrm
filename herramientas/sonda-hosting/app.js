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
const tls = require('node:tls');
const crypto = require('node:crypto');

const PUERTO = process.env.PORT || 3000;
const ARCHIVO = path.join(process.env.SONDA_DIR || __dirname, 'sonda-estado.json');
const ARRANQUE = Date.now();

// ---------- 5: ¿hay un sitio donde los datos sobrevivan a un DESPLIEGUE? ----------
// Algunos hostings despliegan en una carpeta nueva cada vez (.../versions/<uuid>/), así que lo que la app escriba
// al lado de su código se queda huérfano en la versión vieja. Para una base SQLite eso es perder los datos en la
// primera actualización. Aquí se busca un sitio estable FUERA de esa carpeta y se cuenta aparte.
function sitiosEstables() {
  const fuera = path.resolve(__dirname, '..', '..', '..', '..'); // arriba de versions/<uuid>/nodejs
  return [
    process.env.SONDA_DATOS,
    path.join(os.homedir(), 'datos-persistentes'),
    path.join(fuera, 'datos-persistentes'),
    path.join(os.tmpdir(), 'datos-persistentes'),
  ].filter(Boolean);
}
const estable = { ruta: null, arranques: 0, error: null };
for (const dir of sitiosEstables()) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, 'sonda-persistente.json');
    const previo = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { arranques: 0 };
    estable.arranques = (previo.arranques || 0) + 1;
    estable.ruta = f;
    fs.writeFileSync(f, JSON.stringify({ arranques: estable.arranques, ultimo: new Date().toISOString() }, null, 2));
    break;
  } catch (e) {
    estable.error = `${dir}: ${e.message || e}`;
  }
}

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
// Node 20 todavía no trae WebSocket global (llegó en la 22), así que si no está se hace el handshake a mano sobre
// TLS: es exactamente lo que necesita Baileys —salir por el 443 y que el hosting deje pasar el Upgrade.
const ws = { estado: 'probando', via: null, abiertoDesde: null, error: null, mensajes: 0 };
const HOST_WS = 'ws.postman-echo.com';
const RUTA_WS = '/raw';

function probarConGlobal() {
  const s = new WebSocket(`wss://${HOST_WS}${RUTA_WS}`);
  s.addEventListener('open', () => {
    ws.estado = 'abierto';
    ws.via = 'WebSocket de Node';
    ws.abiertoDesde = Date.now();
    s.send('hola');
    setInterval(() => {
      try {
        s.send('sigo aqui');
      } catch {
        /* si se cayó, el close lo cuenta */
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
    setTimeout(probarWebSocket, 10000);
  });
}

function probarAMano() {
  const clave = crypto.randomBytes(16).toString('base64');
  const s = tls.connect({ host: HOST_WS, port: 443, servername: HOST_WS }, () => {
    s.write(
      `GET ${RUTA_WS} HTTP/1.1\r\nHost: ${HOST_WS}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${clave}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
    );
  });
  s.once('data', (d) => {
    const primera = d.toString('latin1').split('\r\n')[0];
    if (/\b101\b/.test(primera)) {
      ws.estado = 'abierto';
      ws.via = 'handshake a mano (Node sin WebSocket)';
      ws.abiertoDesde = Date.now();
      // Un ping cada 20 s para sostenerla: frame 0x89 con máscara, como manda el protocolo del lado del cliente.
      setInterval(() => {
        try {
          s.write(Buffer.concat([Buffer.from([0x89, 0x80]), crypto.randomBytes(4)]));
          ws.mensajes += 1;
        } catch {
          /* el close lo cuenta */
        }
      }, 20000).unref?.();
    } else {
      ws.estado = 'bloqueado';
      ws.error = `el hosting respondió "${primera}" en vez de aceptar el Upgrade`;
    }
  });
  s.on('error', (e) => {
    ws.estado = 'bloqueado';
    ws.error = String(e.message || e);
  });
  s.on('close', () => {
    if (ws.estado === 'abierto') {
      ws.estado = 'se cerró';
      ws.cerradoA = Date.now();
    }
    setTimeout(probarWebSocket, 10000);
  });
}

function probarWebSocket() {
  try {
    if (typeof WebSocket !== 'undefined') return probarConGlobal();
    return probarAMano();
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

  if (ws.estado === 'abierto') bien.push(`WebSocket saliente abierto hace ${Math.round((Date.now() - ws.abiertoDesde) / 60000)} min · ${ws.via}.`);
  else if (ws.estado === 'probando') problemas.push('El WebSocket todavía está conectando: recarga en un minuto.');
  else problemas.push(`WebSocket saliente: ${ws.estado}${ws.error ? ` (${ws.error})` : ''}. Sin esto, WhatsApp por QR no sirve.`);

  (estado.discoEscribe ? bien : problemas).push(
    estado.discoEscribe ? 'El disco acepta escrituras (la base de cada cliente es un archivo).' : `El disco NO acepta escrituras: ${estado.errorDisco ?? ''}`,
  );

  if (estado.arranques > 1) bien.push(`El archivo de al lado del código sobrevivió a ${estado.arranques - 1} arranque(s).`);
  else problemas.push('Todavía no se ha reiniciado: reinicia la app desde el panel y vuelve a mirar.');

  // Lo que de verdad decide para una base SQLite: sobrevivir a un DESPLIEGUE, no a un reinicio.
  const versionado = /versions?\/[0-9a-f-]{8,}/i.test(ARCHIVO);
  if (versionado) {
    problemas.push(`Ojo: la app vive en una carpeta por despliegue (…${ARCHIVO.slice(-72)}). Lo que escriba ahí se queda en la versión vieja cuando redespliegues.`);
  }
  if (estable.ruta) {
    bien.push(`Sitio estable fuera del despliegue: ${estable.ruta} (lleva ${estable.arranques} arranque(s) contados ahí).`);
    if (estable.arranques > estado.arranques) bien.push('Ese sitio YA sobrevivió a un redespliegue: ahí va la base de datos.');
    else problemas.push('Vuelve a desplegar la app y mira este número: si el estable sigue subiendo y el otro se reinicia en 1, la base va en el estable.');
  } else {
    problemas.push(`No encontré dónde guardar datos fuera de la carpeta del despliegue${estable.error ? ` (${estable.error})` : ''}. Sin eso, una base SQLite se pierde al actualizar.`);
  }

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
        arranquesEnSitioEstable: estable.arranques,
        sitioEstable: estable.ruta,
        carpetaPorDespliegue: /versions?\/[0-9a-f-]{8,}/i.test(ARCHIVO),
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
