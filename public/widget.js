/* Widget de XENCRM (el chat del sitio de cada cliente) — se embebe con: <script src="https://TU-DOMINIO/widget.js" async></script>
   Atributos opcionales en el <script>: data-color="#2f7d4f" data-greeting="¡Hola! ..." data-position="left"
   El color y el logo salen de la marca del cliente (aiva.config.json > brand); data-color la cambia solo en ese sitio. */
(function () {
  if (window.__aivaLoaded) return;
  window.__aivaLoaded = true;
  var script = document.currentScript;
  // La base sale de la dirección del propio script, sin quedarse solo con el dominio: si aiva vive en
  // https://…/confia/widget.js, las llamadas tienen que ir a https://…/confia/api/…, no a la raíz.
  var BASE = script && script.src ? script.src.replace(/\/widget\.js(\?.*)?$/, '') : '';
  var RAW = (script && script.getAttribute('data-color')) || '__BRAND_COLOR__';
  if (!/^#[0-9a-fA-F]{6}$/.test(RAW)) RAW = '#2f7d4f';
  var LOGO = '__BRAND_LOGO__';
  if (LOGO && LOGO.charAt(0) === '/') LOGO = BASE + LOGO;
  // Contraste (WCAG): el texto sobre el color de marca y el color de marca sobre blanco se ajustan para leerse.
  function rgb(h) { return [1, 3, 5].map(function (i) { return parseInt(h.slice(i, i + 2), 16); }); }
  function hex(c) { return '#' + c.map(function (v) { return ('0' + Math.round(v).toString(16)).slice(-2); }).join(''); }
  function lum(h) { var c = rgb(h).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
  function ratio(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function mix(a, b, t) { var x = rgb(a), y = rgb(b); return hex(x.map(function (v, i) { return v + (y[i] - v) * t; })); }
  function toward(c, target, bg, min) { var out = c; for (var t = 0.05; ratio(out, bg) < min && t <= 1; t += 0.05) out = mix(c, target, t); return out; }
  var ON = ratio(RAW, '#ffffff') >= ratio(RAW, '#111827') ? '#ffffff' : '#111827';
  var COLOR = toward(RAW, ON === '#ffffff' ? '#000000' : '#ffffff', ON, 4.5); // fondo de marca con su texto a 4.5:1
  var ACCENT = toward(RAW, '#000000', '#ffffff', 4.5); // marca como texto sobre blanco
  var EDGE = toward(RAW, '#000000', '#ffffff', 3); // marca como borde o foco sobre blanco
  var AGENT = '__AGENT_NAME__';
  var STORE = '__STORE_NAME__';
  // 🪤 Orden de mando, de más fuerte a más débil: el atributo del <script>, lo que decidió este cliente, lo
  // general del aplicativo, y el código. El atributo va primero porque es lo más concreto que hay —alguien lo
  // escribió PARA ESTE SITIO—, y porque un cliente puede pegar la burbuja en dos páginas distintas y querer un
  // saludo distinto en cada una sin tener dos configuraciones.
  var GREETING = (script && script.getAttribute('data-greeting')) || '__SALUDO__' || ('¡Hola! Soy ' + AGENT + ', de ' + STORE + '. ¿Qué estás buscando hoy?');
  var POS = (script && script.getAttribute('data-position')) || '__POSICION__';
  var LEFT = POS === 'left' || POS === 'izquierda';
  var ABRE_SOLA = Number('__ABRE_SOLA__') || 0;
  // Dos presentaciones del MISMO chat: la burbuja que se pega en el sitio de un cliente, y la ventana completa
  // que vive en /chat. Es una sola implementación a propósito: la sesión, el historial, el paso a una persona y
  // el registro de dónde vino el visitante son exactamente lo mismo, y tenerlo dos veces significa arreglar
  // cada error dos veces —y acordarse de los dos sitios, que es lo que no pasa.
  var VENTANA = script && script.getAttribute('data-modo') === 'ventana';
  var KEY = 'aiva.session.' + BASE;

  // 🪤 De aquí abajo y hasta el `;`, todo es UNA cadena de JavaScript sostenida con barras al final de cada
  // línea. Un comentario de varias líneas metido aquí dentro corta la cadena en la primera y rompe el archivo
  // entero en el sitio del cliente —pasó—, así que aquí dentro solo van comentarios de una línea, con su barra.
  //
  // Sobre `.aiva-msgs > :first-child{margin-top:auto}`: hace que los mensajes se apoyen ABAJO, contra la caja
  // de escribir, como en cualquier chat. Sin eso una conversación de dos frases queda colgada del techo con
  // medio metro de vacío debajo, y lo último que se dijo acaba lo más lejos posible de donde se está
  // escribiendo. El `auto` del primero empuja todo hacia abajo y deja el scroll intacto cuando ya no cabe.
  var css = '\
  .aiva-btn{position:fixed;bottom:20px;' + (LEFT ? 'left' : 'right') + ':20px;width:58px;height:58px;border-radius:50%;border:0;background:' + COLOR + ';color:' + ON + ';box-shadow:0 6px 20px rgba(0,0,0,.25);cursor:pointer;z-index:2147483000;display:flex;align-items:center;justify-content:center;transition:transform .15s}\
  .aiva-btn:hover{transform:scale(1.06)}\
  .aiva-btn svg{width:28px;height:28px}\
  .aiva-panel{position:fixed;bottom:90px;' + (LEFT ? 'left' : 'right') + ':20px;width:360px;max-width:calc(100vw - 32px);height:520px;max-height:calc(100vh - 110px);background:rgba(255,255,255,.92);-webkit-backdrop-filter:blur(24px) saturate(170%);backdrop-filter:blur(24px) saturate(170%);border:1px solid rgba(255,255,255,.7);border-radius:20px;box-shadow:inset 0 1px 0 rgba(255,255,255,.5),0 16px 48px rgba(0,0,0,.24);display:none;flex-direction:column;overflow:hidden;z-index:2147483000;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1f2937}\
  .aiva-panel.open{display:flex}\
  .aiva-head{background:' + COLOR + ';color:' + ON + ';padding:14px 16px;display:flex;align-items:center;gap:10px}\
  .aiva-logo{width:36px;height:36px;border-radius:50%;object-fit:cover;background:#fff;box-shadow:0 0 0 2px rgba(255,255,255,.6);flex:0 0 36px}\
  .aiva-head b{font-size:15px}.aiva-head small{opacity:.85;display:block;font-size:12px}\
  .aiva-close{margin-left:auto;background:none;border:0;color:' + ON + ';font-size:22px;cursor:pointer;line-height:1}\
  .aiva-msgs{flex:1 1 auto;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:14px;display:flex;flex-direction:column;gap:8px;background:rgba(246,247,249,.6)}\
  .aiva-m{max-width:85%;padding:9px 12px;border-radius:14px;white-space:pre-wrap;word-wrap:break-word}\
  .aiva-adj{display:block;max-width:100%;max-height:260px;border-radius:10px;margin-bottom:6px;background:rgba(0,0,0,.06);min-height:48px}\
  .aiva-adj-f{display:flex;align-items:center;gap:8px;margin-bottom:6px;padding:9px 11px;border-radius:10px;\
    background:rgba(0,0,0,.06);color:inherit;text-decoration:none;font-weight:600;font-size:13.5px;min-height:44px}\
  .aiva-m.bot{background:#fff;border-bottom-left-radius:4px;align-self:flex-start;box-shadow:0 1px 2px rgba(0,0,0,.08)}\
  .aiva-m.me{background:' + COLOR + ';color:' + ON + ';border-bottom-right-radius:4px;align-self:flex-end}\
  .aiva-m.human{border-left:3px solid ' + EDGE + '}\
  .aiva-m.human::before{content:attr(data-author);display:block;font-size:11px;color:' + ACCENT + ';font-weight:600;margin-bottom:2px}\
  .aiva-sys{background:transparent;box-shadow:none;color:#6b7280;font-size:12px;align-self:center;text-align:center}\
  .aiva-m a{color:inherit;text-decoration:underline}\
  .aiva-typing span{display:inline-block;width:6px;height:6px;margin:0 2px;background:#9ca3af;border-radius:50%;animation:aivab 1s infinite}\
  .aiva-typing span:nth-child(2){animation-delay:.15s}.aiva-typing span:nth-child(3){animation-delay:.3s}\
  @keyframes aivab{0%,80%,100%{opacity:.3}40%{opacity:1}}\
  .aiva-form{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:10px 10px calc(10px + env(safe-area-inset-bottom));border-top:1px solid rgba(0,0,0,.06);background:rgba(255,255,255,.7)}\
  .aiva-form input{flex:1 1 auto;min-width:0;border:1px solid #e5e7eb;border-radius:22px;padding:11px 14px;font:inherit;font-size:16px;outline:none;background:#fff}\
  .aiva-form input:focus{border-color:' + EDGE + ';box-shadow:0 0 0 1px ' + EDGE + '}\
  .aiva-form button{flex:0 0 auto;width:42px;height:42px;border:0;border-radius:50%;background:' + COLOR + ';color:' + ON + ';display:flex;align-items:center;justify-content:center;cursor:pointer}\
  .aiva-form button svg{width:20px;height:20px}\
  .aiva-form button:disabled{opacity:.45;cursor:default}\
  @media(max-width:480px){.aiva-panel{position:fixed;inset:0;width:100%;max-width:100%;height:100dvh;max-height:100dvh;border-radius:0}.aiva-btn{bottom:16px}}\
  .aiva-panel.ventana{position:relative;inset:auto;bottom:auto;right:auto;left:auto;width:100%;max-width:820px;height:100%;max-height:none;margin:0 auto;display:flex;border-radius:0;box-shadow:none;border:0;background:transparent}\
  .aiva-panel.ventana .aiva-msgs{background:transparent;padding:20px 16px;gap:10px}\
  /* Se apoyan abajo, contra la caja de escribir: ver el porqué arriba, donde empieza este CSS. */\
  .aiva-panel.ventana .aiva-msgs > :first-child{margin-top:auto}\
  .aiva-panel.ventana .aiva-m{max-width:min(85%,620px);font-size:15px;padding:11px 14px}\
  .aiva-panel.ventana .aiva-form{background:transparent;border-top:0;padding:8px 16px calc(16px + env(safe-area-inset-bottom))}\
  .aiva-panel.ventana .aiva-form input{border-radius:26px;padding:14px 18px;box-shadow:0 1px 2px rgba(0,0,0,.06),0 8px 24px rgba(0,0,0,.06)}\
  .aiva-panel.ventana .aiva-form button{width:46px;height:46px}\
  @media(max-width:480px){.aiva-panel.ventana{position:relative;height:100%;max-height:none}}';
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var btn = document.createElement('button');
  btn.className = 'aiva-btn';
  btn.setAttribute('aria-label', 'Abrir chat');
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z"/></svg>';

  var panel = document.createElement('div');
  panel.className = 'aiva-panel' + (VENTANA ? ' ventana open' : '');
  panel.innerHTML =
    // En la ventana la cabecera sobra: la página ya dice de quién es y con quién hablas, y repetirlo le roba
    // alto a la conversación, que es lo único que importa ahí.
    (VENTANA ? '' : '<div class="aiva-head">' + (LOGO ? '<img class="aiva-logo" alt="" src="' + esc(LOGO) + '">' : '') + '<div><b>' + esc(AGENT) + '</b><small>' + esc(STORE) + ' · normalmente responde en segundos</small></div><button class="aiva-close" aria-label="Cerrar">×</button></div>') +
    '<div class="aiva-msgs"></div>' +
    '<form class="aiva-form"><input type="text" placeholder="Escribe tu mensaje..." maxlength="1000" autocomplete="off" enterkeyhint="send"><button type="submit" aria-label="Enviar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg></button></form>';
  // La ventana se monta donde la página diga; la burbuja siempre flota sobre el sitio ajeno.
  var donde = VENTANA ? (document.getElementById('aiva-ventana') || document.body) : document.body;
  if (!VENTANA) document.body.appendChild(btn);
  donde.appendChild(panel);

  var msgs = panel.querySelector('.aiva-msgs');
  var form = panel.querySelector('form');
  var input = panel.querySelector('input');
  var send = panel.querySelector('.aiva-form button');
  var opened = false;
  var sessionId = null;
  try { sessionId = localStorage.getItem(KEY); } catch (e) {}

  var stream = null;
  function connectStream() {
    if (stream || !sessionId || typeof EventSource === 'undefined') return;
    try {
      stream = new EventSource(BASE + '/api/stream?sessionId=' + encodeURIComponent(sessionId));
      stream.addEventListener('message', function (e) {
        try { var d = JSON.parse(e.data); addMsg(d.content, 'bot', 'human', d.by); } catch (err) {}
      });
      stream.addEventListener('handoff', function (e) {
        try { var d = JSON.parse(e.data); setHuman(!!d.on); } catch (err) {}
      });
      stream.onerror = function () { /* el navegador reintenta solo */ };
    } catch (e) { stream = null; }
  }
  var humanBanner = null;
  function setHuman(on) {
    if (on && !humanBanner) {
      humanBanner = document.createElement('div');
      humanBanner.className = 'aiva-m bot aiva-sys';
      humanBanner.textContent = 'Ahora te atiende una persona del equipo.';
      msgs.appendChild(humanBanner);
      msgs.scrollTop = msgs.scrollHeight;
    } else if (!on && humanBanner) {
      humanBanner.remove();
      humanBanner = null;
    }
  }
  function loadHistory() {
    if (!sessionId) return Promise.resolve(false);
    return fetch(BASE + '/api/history?sessionId=' + encodeURIComponent(sessionId))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        (d.messages || []).forEach(function (m) { addMsg(m.content, m.role === 'user' ? 'me' : 'bot', m.author, m.by, m.media); });
        setHuman(!!d.human);
        return (d.messages || []).length > 0;
      })
      .catch(function () { return false; });
  }
  function open() {
    panel.classList.add('open');
    if (!VENTANA && window.innerWidth <= 480) btn.style.display = 'none';
    if (!opened) {
      opened = true;
      loadHistory().then(function (had) { if (!had) addMsg(GREETING, 'bot'); connectStream(); });
    }
    input.focus();
  }
  if (VENTANA) {
    open();
  } else {
    btn.onclick = function () { panel.classList.contains('open') ? panel.classList.remove('open') : open(); };
    panel.querySelector('.aiva-close').onclick = function () { panel.classList.remove('open'); btn.style.display = ''; };
    // Abrirse sola: solo si alguien lo encendió, solo una vez por visita, y nunca si ya hay conversación
    // empezada —quien ya habló no necesita que le abran nada— ni en un teléfono, donde el panel ocupa la
    // pantalla entera y taparía el sitio que la persona está leyendo.
    if (ABRE_SOLA > 0 && !sessionId && window.innerWidth > 480) {
      setTimeout(function () { if (!panel.classList.contains('open')) open(); }, ABRE_SOLA * 1000);
    }
  }

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function linkify(s) {
    return esc(s).replace(/(https?:\/\/[^\s<]+)/g, function (u) {
      var clean = u.replace(/[.,;:!?)]+$/, '');
      return '<a href="' + clean + '" target="_blank" rel="noopener">' + clean + '</a>' + u.slice(clean.length);
    }).replace(/\*([^*\n]+)\*/g, '<b>$1</b>');
  }
  function addMsg(text, who, author, by, media) {
    var d = document.createElement('div');
    d.className = 'aiva-m ' + who + (author === 'human' ? ' human' : '');
    d.innerHTML = (media ? adjunto(media) : '') + (who === 'bot' ? linkify(text) : esc(text));
    if (media) ponerAdjunto(d, media);
    if (author === 'human') d.setAttribute('data-author', by ? by + ' · ' + STORE : 'Equipo · ' + STORE);
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
    return d;
  }
  /**
   * El archivo que mandó el negocio. Se pide con la sesión, que es lo único que identifica a este cliente.
   *
   * El nombre va escapado: lo escogió quien mandó el archivo, y aquí se pinta dentro de la página del negocio.
   */
  function adjunto(m) {
    if (!m || !m.id) return '';
    var n = esc(m.nombre || 'archivo');
    if (m.tipo === 'imagen') return '<img class="aiva-adj" alt="' + n + '" data-mid="' + esc(m.id) + '">';
    return '<a class="aiva-adj-f" href="#" data-mid="' + esc(m.id) + '">📄 ' + n + '</a>';
  }
  function urlDelMedio(id) {
    return BASE + '/api/medio/' + encodeURIComponent(id) + '?sessionId=' + encodeURIComponent(sessionId);
  }
  function ponerAdjunto(d, m) {
    var el = d.querySelector('[data-mid]');
    if (!el) return;
    // 🪤 Se baja a un blob en vez de poner la dirección en el src. La dirección lleva la sesión dentro, y una
    // imagen con la sesión en su src se va al historial del navegador y al Referer de cualquier enlace que
    // abra el cliente desde el chat. La sesión es lo único que protege su conversación.
    fetch(urlDelMedio(m.id)).then(function (r) { return r.ok ? r.blob() : Promise.reject(r.status); })
      .then(function (b) {
        var u = URL.createObjectURL(b);
        if (el.tagName === 'IMG') { el.src = u; return; }
        el.onclick = function (e) {
          e.preventDefault();
          var a = document.createElement('a');
          a.href = u; a.download = m.nombre || 'archivo'; a.click();
        };
      })
      .catch(function () { el.replaceWith(document.createTextNode('(el archivo ya no está disponible)')); });
  }

  function typing() {
    var d = document.createElement('div');
    d.className = 'aiva-m bot aiva-typing';
    d.innerHTML = '<span></span><span></span><span></span>';
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
    return d;
  }

  form.onsubmit = function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    addMsg(text, 'me');
    send.disabled = true;
    var t = typing();
    fetch(BASE + '/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // De dónde viene: la dirección de la página (con los utm_ de la campaña) y quién lo mandó. Solo hace
      // falta con el primer mensaje —después ya está anotado—, pero mandarlo siempre sale más barato que
      // llevar la cuenta, y el servidor guarda únicamente el primero.
      body: JSON.stringify({ sessionId: sessionId, message: text, origen: { url: location.href, referente: document.referrer || '' } })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        t.remove();
        if (data.sessionId && data.sessionId !== sessionId) {
          sessionId = data.sessionId;
          try { localStorage.setItem(KEY, sessionId); } catch (e) {}
          connectStream();
        }
        if (data.silent) { setHuman(true); return; }
        addMsg(data.reply || data.error || 'Hubo un problema, intenta de nuevo.', 'bot');
      })
      .catch(function () { t.remove(); addMsg('No pude conectar. Intenta de nuevo en un momento.', 'bot'); })
      .finally(function () { send.disabled = false; input.focus(); });
  };
})();
