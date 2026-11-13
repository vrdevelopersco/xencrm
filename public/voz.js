/* La llamada de voz de la ventana de chat (src/voz/llamada.ts). Lo único que va y viene es audio y avisos: la
   conversación con Grok la lleva el servidor, que es quien tiene la llave, las instrucciones y las herramientas.

   Lo que se dice en la llamada queda en la MISMA conversación que lo escrito: el servidor lo guarda, y aquí se
   le pasa al chat (widget.js) para que se vea como cualquier mensaje. */
(function () {
  'use strict';
  var script = document.currentScript;
  var BASE = script && script.src ? script.src.replace(/\/voz\.js(\?.*)?$/, '') : '';
  var KEY = 'xencrm.session.' + BASE; // la misma llave que widget.js: la misma conversación
  var $ = function (id) { return document.getElementById(id); };
  var boton = $('voz-llamar'), franja = $('voz-llamada'), estado = $('voz-estado'), tiempo = $('voz-tiempo'), colgarBtn = $('voz-colgar');
  if (!boton || !franja) return;
  var agente = boton.getAttribute('data-agente') || 'el asistente';
  var MIC = 'xencrm-microfono';

  var ws = null, ctx = null, mic = null, nodo = null, fuente = null, sonando = [], cabeza = 0, empezo = 0, reloj = null, enLlamada = false, cerrando = false;

  function decir(texto, detalle) {
    estado.innerHTML = '';
    estado.appendChild(document.createTextNode(texto));
    if (detalle) { var s = document.createElement('small'); s.textContent = detalle; estado.appendChild(s); }
  }
  function sesion() {
    var id = null;
    try { id = localStorage.getItem(KEY); } catch (e) {}
    if (!id || !/^[\w-]{8,64}$/.test(id)) {
      id = (window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2)).replace(/[^\w-]/g, '');
      try { localStorage.setItem(KEY, id); } catch (e) {}
    }
    return id;
  }
  // Al chat: lo que se dijo, como mensajes de la conversación.
  function alChat(detalle) { try { window.dispatchEvent(new CustomEvent('xencrm-voz', { detail: detalle })); } catch (e) {} }

  // ---------- el audio que llega: PCM16 a 24 kHz, en orden y sin huecos ----------
  function sonar(buf) {
    if (!ctx) return;
    var pcm = new Int16Array(buf), f = new Float32Array(pcm.length);
    for (var i = 0; i < pcm.length; i++) f[i] = pcm[i] / 0x8000;
    var ab = ctx.createBuffer(1, f.length, 24000);
    ab.copyToChannel(f, 0);
    var s = ctx.createBufferSource();
    s.buffer = ab;
    s.connect(ctx.destination);
    cabeza = Math.max(cabeza, ctx.currentTime + 0.03);
    s.start(cabeza);
    cabeza += ab.duration;
    sonando.push(s);
    s.onended = function () {
      sonando = sonando.filter(function (x) { return x !== s; });
      if (!sonando.length) { franja.classList.remove('sonando'); if (enLlamada) decir('Te escucho…'); }
    };
    franja.classList.add('sonando');
    decir(agente + ' está hablando');
  }
  // El cliente interrumpió: se calla lo que estaba sonando, como haría una persona.
  function callar() {
    sonando.forEach(function (s) { try { s.stop(); } catch (e) {} });
    sonando = [];
    cabeza = 0;
    franja.classList.remove('sonando');
  }

  function cuenta() {
    var s = Math.floor((Date.now() - empezo) / 1000);
    tiempo.textContent = Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }

  function terminar(mensaje) {
    if (cerrando) return;
    cerrando = true;
    enLlamada = false;
    clearInterval(reloj);
    callar();
    try { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ tipo: 'colgar' })); } catch (e) {}
    try { if (ws) ws.close(); } catch (e) {}
    try { if (mic) mic.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
    try { if (ctx) ctx.close(); } catch (e) {}
    ws = ctx = mic = nodo = fuente = null;
    franja.hidden = true;
    boton.hidden = false;
    boton.disabled = false;
    if (mensaje) alChat({ sistema: mensaje });
    boton.focus();
  }

  function llamar() {
    boton.disabled = true;
    boton.hidden = true; // durante la llamada, lo que se toca es «Colgar»
    cerrando = false;
    franja.hidden = false;
    franja.classList.remove('sonando');
    tiempo.textContent = '0:00';
    decir('Conectando…', 'Te pediremos permiso para usar el micrófono.');
    var id = sesion();
    alChat({ sessionId: id });
    // El micrófono y la llamada se piden a la vez: cada uno tarda lo suyo y así no se suman.
    var pidiendoMic = navigator.mediaDevices && navigator.mediaDevices.getUserMedia
      ? navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } })
      : Promise.reject(Object.assign(new Error('sin micrófono'), { name: 'NotFoundError' }));
    var pidiendoLlamada = fetch(BASE + '/voz/llamada', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: id }) })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok || d.error) throw Object.assign(new Error(d.error || 'No se pudo llamar.'), { deServidor: true }); return d; }); });
    Promise.all([pidiendoMic, pidiendoLlamada]).then(function (r) {
      mic = r[0];
      var d = r[1];
      try { ctx = new AudioContext({ sampleRate: 24000 }); } catch (e) { ctx = new AudioContext(); }
      return ctx.audioWorklet.addModule(BASE + '/voz-procesador.js').then(function () {
        fuente = ctx.createMediaStreamSource(mic);
        nodo = new AudioWorkletNode(ctx, MIC, { processorOptions: { desde: ctx.sampleRate } });
        fuente.connect(nodo);
        // 🪤 A la salida, con volumen cero: un nodo que no llega a ninguna parte algunos navegadores no lo procesan,
        // y el micrófono se quedaba mudo sin decir por qué.
        var mudo = ctx.createGain();
        mudo.gain.value = 0;
        nodo.connect(mudo);
        mudo.connect(ctx.destination);
        var url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + new URL(BASE + '/voz/ws', location.href).pathname + '?b=' + encodeURIComponent(d.boleto);
        ws = new WebSocket(url);
        ws.binaryType = 'arraybuffer';
        var pendiente = [];
        nodo.port.onmessage = function (e) {
          if (ws && ws.readyState === 1) { while (pendiente.length) ws.send(pendiente.shift()); ws.send(e.data); }
          else if (ws && ws.readyState === 0) pendiente.push(e.data); // lo dicho antes de abrir no se pierde
        };
        ws.onmessage = function (e) {
          if (typeof e.data !== 'string') { sonar(e.data); return; }
          var m = {};
          try { m = JSON.parse(e.data); } catch (err) { return; }
          if (m.tipo === 'lista') {
            enLlamada = true;
            empezo = Date.now();
            reloj = setInterval(cuenta, 500);
            decir('Habla, te escucho', 'Con ' + (m.agente || agente) + '. Cuelga cuando quieras.');
            colgarBtn.focus();
          } else if (m.tipo === 'habla') callar();
          else if (m.tipo === 'parcial') { /* el subtítulo en vivo lo trae «agente» completo al terminar */ }
          else if (m.tipo === 'herramienta') decir('Un momento, lo consulto…');
          else if (m.tipo === 'cliente') alChat({ texto: m.texto, de: 'cliente' });
          else if (m.tipo === 'agente') alChat({ texto: m.texto, de: 'agente' });
          else if (m.tipo === 'error') terminar(m.texto || 'Se cortó la llamada.');
          else if (m.tipo === 'fin') terminar(m.motivo === 'tope' ? 'La llamada llegó a su tiempo máximo. Puedes seguir escribiendo por aquí.' : 'Llamada terminada.');
        };
        ws.onclose = function () { if (!cerrando) terminar(enLlamada ? 'Llamada terminada.' : 'No se pudo conectar la llamada. Escríbenos por aquí.'); };
        ws.onerror = function () { /* el cierre dice lo que pasó */ };
      });
    }).catch(function (err) {
      var msg = err && err.deServidor ? err.message
        : err && (err.name === 'NotAllowedError' || err.name === 'SecurityError') ? 'Para hablar necesito permiso para usar el micrófono. Puedes seguir escribiendo por aquí.'
        : err && err.name === 'NotFoundError' ? 'No encontré un micrófono en este aparato. Puedes seguir escribiendo por aquí.'
        : 'No se pudo conectar la llamada. Escríbenos por aquí.';
      terminar(msg);
    });
  }

  boton.hidden = false;
  boton.onclick = llamar;
  colgarBtn.onclick = function () { terminar('Llamada terminada.'); };
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !franja.hidden) terminar('Llamada terminada.'); });
  window.addEventListener('pagehide', function () { if (!franja.hidden) terminar(''); });
})();
