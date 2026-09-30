/* Tablero de Aiva: bandeja, pipeline, calendario, análisis, agente y conocimiento. Vanilla JS + SSE. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  // Dónde vive este tablero. Servido en la raíz, BASE queda vacío; servido en /confia/admin, BASE es "/confia".
  // Así el mismo archivo sirve para una instancia por dominio y para varias bajo un dominio compartido.
  var BASE = location.pathname.replace(/\/admin\/?$/, '');
  // Servido desde la consola: ella le pone el token a cada petición, así que aquí no hace falta ninguno. La marca
  // la inyecta la consola al pasar la página.
  var PORLACONSOLA = typeof window.AIVA_CONSOLA === 'string';
  // 🪤 Todos los clientes viven en el MISMO dominio (aiva.../dunor, aiva.../confia), y el almacenamiento del
  // navegador es por dominio: sin separar las llaves, el nombre con el que respondes, el token y hasta el tema
  // se iban de un cliente a otro. Cada uno lleva su prefijo, que sale de su ruta.
  var QUIEN = (window.AIVA_CONSOLA || BASE || 'raiz').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'raiz';
  var LLAVE = function (que) { return 'aiva.admin.' + QUIEN + '.' + que; };
  // Lo que estaba guardado con la llave vieja (compartida) se muda una vez y se borra, para no dejar a nadie
  // fuera al actualizar.
  (function mudar() {
    try {
      ['token', 'name', 'theme', 'sound', 'notifSeen'].forEach(function (que) {
        var viejo = localStorage.getItem('aiva.admin.' + que);
        if (viejo !== null && localStorage.getItem(LLAVE(que)) === null) localStorage.setItem(LLAVE(que), viejo);
      });
      ['token', 'name'].forEach(function (que) { localStorage.removeItem('aiva.admin.' + que); });
    } catch (e) { /* sin almacenamiento, se entra como la primera vez */ }
  })();
  var state = { token: '', name: '', view: 'today', filter: 'all', q: '', contacts: [], current: null, detail: null, kind: 'knowledge', theme: 'light', sound: true, stageLabels: {}, stages: [], es: null, notifs: [], notifSeen: 0, detailOpen: false };
  // 🪤 Si se entró por la consola, el nombre de quien atiende sale de SU CUENTA y no del navegador: así se
  // mantiene al cambiar de equipo y no hay forma de que se cruce con el de otro cliente.
  // 🪤 Primero lo que se haya puesto PARA ESTE CLIENTE, y solo si no hay, el nombre de la cuenta. Al revés, el
  // nombre del super-admin se propagaría a todos los clientes a la vez.
  try { state.token = localStorage.getItem(LLAVE('token')) || ''; state.name = localStorage.getItem(LLAVE('name')) || (typeof window.AIVA_QUIEN === 'string' && window.AIVA_QUIEN) || ''; state.theme = localStorage.getItem(LLAVE('theme')) || 'light'; state.sound = localStorage.getItem(LLAVE('sound')) !== '0'; state.notifSeen = Number(localStorage.getItem(LLAVE('notifSeen')) || 0); } catch (e) {}

  // ---------- íconos (monocromos, el color de estado queda para los chips) ----------
  var ICONS = {
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    message: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    columns: '<rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="12" rx="1"/><rect x="17" y="3" width="4" height="8" rx="1"/>',
    chart: '<path d="M3 3v18h18"/><rect x="7" y="10" width="3" height="8"/><rect x="12" y="6" width="3" height="12"/><rect x="17" y="13" width="3" height="5"/>',
    bot: '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M12 8V4M8 4h8"/><circle cx="9" cy="14" r="1"/><circle cx="15" cy="14" r="1"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
    plug: '<path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0z"/><path d="M12 17v5"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    store: '<path d="M3 9l1.5-5h15L21 9"/><path d="M4 9v11h16V9"/><path d="M9 20v-6h6v6"/><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/>',
    sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h10M18 18h2"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    salir: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    alerta: '<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>'
  };
  // Dibuja los iconos de un trozo de página. Se llama también sobre lo que se crea después, que si no, sale vacío.
  function iconos(raiz) {
    (raiz || document).querySelectorAll('.ic').forEach(function (el) {
      el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[el.getAttribute('data-ic')] || '') + '</svg>';
    });
  }
  iconos();

  // ---------- utilidades ----------
  // El embudo lo pone cada negocio (una boutique agenda citas; una financiera estudia solicitudes). El tablero
  // pregunta por el papel de la etapa —dónde empieza, cuál es interés, cuál tener cita, ganada, perdida— y por eso
  // funciona igual con cualquier embudo.
  function rol(stage) { var e = (state.stages || []).find(function (x) { return x.id === stage; }); return (e && e.rol) || ''; }
  function etapaCon(r) { var e = (state.stages || []).find(function (x) { return x.rol === r; }); return e ? e.id : ''; }
  // Los filtros de etapa salen del embudo: si el negocio no agenda, no hay filtro "Con cita".
  function etapasDelNegocio() {
    document.querySelectorAll('#filters [data-rol]').forEach(function (b) {
      var id = etapaCon(b.getAttribute('data-rol'));
      if (!id) { b.hidden = true; return; }
      b.hidden = false;
      b.setAttribute('data-f', 'stage:' + id);
      b.textContent = state.stageLabels[id] || b.textContent;
    });
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  // Lo buscado, dentro de la frase donde apareció: un pedacito alrededor y resaltado (el texto va escapado).
  function mark(text, q) {
    var s = String(text || ''), i = q ? s.toLowerCase().indexOf(q.toLowerCase()) : -1;
    if (i < 0) return esc(s.slice(0, 90)) + (s.length > 90 ? '…' : '');
    var from = Math.max(0, i - 28), to = Math.min(s.length, i + q.length + 46);
    return (from ? '…' : '') + esc(s.slice(from, i)) + '<mark>' + esc(s.slice(i, i + q.length)) + '</mark>' + esc(s.slice(i + q.length, to)) + (to < s.length ? '…' : '');
  }
  function rel(ts) { if (!ts) return ''; var d = Date.now() - ts, m = Math.round(d / 60000); if (m < 1) return 'ahora'; if (m < 60) return m + ' min'; var h = Math.round(m / 60); if (h < 24) return h + ' h'; var dd = Math.round(h / 24); return dd + ' d'; }
  function hhmm(ts) { return new Date(ts).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' }); }
  function short(id) { var m = /^(wa|meta|web|cli|mcp):(.*)$/.exec(id); if (!m) return id; var v = m[2].replace(/@.*$/, ''); return m[1] === 'web' ? 'web · ' + v.slice(0, 8) : v; }
  function channelIcon(ch) { return { whatsapp: '🟢 WhatsApp', meta: '🟢 WhatsApp', web: '🌐 Web', cli: '⌨️ CLI', mcp: '🔌 MCP' }[ch] || ch; }
  function nameOf(c) { return c.name || short(c.id); }
  /**
   * Un aviso que aparece abajo a la derecha.
   *
   * Tres cosas que no tenía y se notaban: un icono que diga de qué va sin leerlo, el título en negrita —cuando
   * escribe un cliente, lo primero que uno busca es QUIÉN— y tiempo visible.
   *
   * 🪤 El reloj es la propia animación de la barra, no un setTimeout aparte. Así, al pasar el ratón por encima
   * se pausan los dos a la vez y el aviso no se va mientras lo estás leyendo. Con dos relojes separados se
   * desincronizan siempre: la barra llega al final y el aviso sigue ahí, o al revés.
   */
  function toast(texto, onclick, opts) {
    opts = opts || {};
    var t = document.createElement('div');
    var malo = /^No se pudo|^No pude/.test(texto);
    t.className = 'toast' + (malo ? ' malo' : '');
    var icono = opts.icono || (malo ? 'alerta' : 'check');
    t.innerHTML = '<i class="ic" data-ic="' + icono + '"></i><div class="cuerpo">'
      + (opts.titulo ? '<b>' + esc(opts.titulo) + '</b>' : '')
      + '<span' + (opts.titulo ? '' : ' class="solo"') + '>' + esc(texto) + '</span></div><i class="reloj"></i>';
    iconos(t);
    $('toasts').appendChild(t);

    var quieto = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var yendo = false;
    function irse() {
      if (yendo) return;
      yendo = true;
      if (!t.animate || quieto) { t.remove(); return; }
      // Se encoge además de irse: si solo se desvaneciera, los avisos de abajo pegarían un salto.
      var alto = t.offsetHeight;
      t.style.height = alto + 'px';
      var fin = t.animate(
        [{ opacity: 1, transform: 'none', height: alto + 'px', marginBottom: '0px' },
         { opacity: 0, transform: 'translateX(20px)', height: '0px', marginBottom: '-8px' }],
        { duration: 220, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' },
      );
      fin.finished.then(function () { t.remove(); }).catch(function () { t.remove(); });
    }
    t.onclick = function () { irse(); if (onclick) onclick(); };

    if (t.animate && !quieto) {
      t.animate(
        [{ opacity: 0, transform: 'translateX(28px) scale(.96)' }, { opacity: 1, transform: 'none' }],
        { duration: 300, easing: 'cubic-bezier(.16,1,.3,1)' },
      );
    }
    var barra = t.querySelector('.reloj');
    if (barra && barra.animate) {
      var vida = barra.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: 6000, easing: 'linear', fill: 'forwards' });
      vida.finished.then(irse).catch(function () { /* se canceló al tocarlo */ });
      t.onmouseenter = function () { vida.pause(); };
      t.onmouseleave = function () { vida.play(); };
    } else {
      setTimeout(irse, 6000);
    }
    return t;
  }
  var audio = null;
  // El aviso de que entró algo. Es un acorde, no un pitido: suena una vez, cae solo y no deja a nadie en
  // tensión. Antes era un tono plano de 880 Hz que parecía un monitor de hospital.
  //
  // Está sintetizado a propósito y no es un archivo: así no pesa nada, no hay nada que descargar, y no metemos
  // en el producto un sonido que es de otro. Las cuatro notas son un acorde mayor, entrando casi a la vez, con
  // un filtro que le quita el filo y una caída larga.
  function beep() {
    if (!state.sound) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      var t0 = audio.currentTime;
      var suave = audio.createBiquadFilter();
      suave.type = 'lowpass';
      suave.frequency.value = 2600; // sin esto suena a plástico
      var salida = audio.createGain();
      salida.gain.value = 0.9;
      suave.connect(salida);
      salida.connect(audio.destination);
      // Do, Mi, Sol y Do de la octava de arriba: entran escalonadas por milésimas, como una mano en un piano.
      [523.25, 659.25, 783.99, 1046.5].forEach(function (hz, i) {
        var o = audio.createOscillator(), g = audio.createGain();
        o.type = 'triangle';
        o.frequency.value = hz;
        var t = t0 + i * 0.018;
        var fuerza = 0.05 - i * 0.008; // las agudas, más bajitas: si no, chillan
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(fuerza, t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
        o.connect(g); g.connect(suave);
        o.start(t); o.stop(t + 0.95);
      });
    } catch (e) {}
  }

  function beep() {
    if (!state.sound) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      var t0 = audio.currentTime;
      // Sol5 y Do6: una quinta descendente, que es el gesto de «atiende un momento» sin sonar a alarma.
      [[784, 0], [1046.5, 0.09]].forEach(function (nota) {
        var o = audio.createOscillator(), g = audio.createGain();
        o.type = 'triangle'; // más suave que la onda por defecto, más cerca de una cuerda que de un pitido
        o.frequency.value = nota[0];
        var t = t0 + nota[1];
        // Un ataque corto y una caída larga: así suena a nota pulsada y no a tono encendido y apagado.
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.09, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
        o.connect(g); g.connect(audio.destination);
        o.start(t); o.stop(t + 0.45);
      });
    } catch (e) {}
  }

  function api(path, opts) {
    opts = opts || {};
    var headers = { 'x-admin-token': state.token };
    if (opts.body) headers['content-type'] = 'application/json';
    return fetch(BASE + '/admin/api' + path, { method: opts.method || 'GET', headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined }).then(function (r) {
      if (r.status === 401) { showLogin('Token inválido'); throw new Error('401'); }
      return r.json();
    });
  }

  // Descargar un archivo del tablero sin poner el token en la dirección (una dirección se comparte sin querer).
  function download(path, name) {
    return fetch(BASE + '/admin/api' + path, { headers: { 'x-admin-token': state.token } })
      .then(function (r) { if (r.status === 401) { showLogin('Token inválido'); throw new Error('401'); } return r.blob(); })
      .then(function (blob) {
        var url = URL.createObjectURL(blob), a = document.createElement('a');
        a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
      });
  }

  // ---------- login / tema / sonido ----------
  function showLogin(err) {
    // Entrando por la consola no hay token que pedir: si algo falla es que la sesión venció.
    if (PORLACONSOLA) { location.href = '/'; return; }
    $('login').hidden = false; $('login-err').textContent = err || ''; $('login-name').value = state.name; ($('login-name').value ? $('login-token') : $('login-name')).focus(); }
  $('login-btn').onclick = function () {
    state.name = $('login-name').value.trim(); state.token = $('login-token').value.trim();
    try { localStorage.setItem(LLAVE('token'), state.token); localStorage.setItem(LLAVE('name'), state.name); } catch (e) {}
    boot();
  };
  $('login-token').onkeydown = function (e) { if (e.key === 'Enter') $('login-btn').click(); };
  $('login-name').onkeydown = function (e) { if (e.key === 'Enter') $('login-token').focus(); };
  $('logout-btn').onclick = function () {
    if (PORLACONSOLA) { location.href = '/'; return; } // de vuelta a la consola, que es de donde se vino
    try { localStorage.removeItem(LLAVE('token')); } catch (e) {}
    location.reload();
  };
  // Tres temas: claro, oscuro y el del sistema. El del sistema es el que la gente espera hoy y el que sigue al
  // computador cuando cambia solo al anochecer.
  var DELSISTEMA = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function temaReal() { return state.theme === 'auto' ? (DELSISTEMA && DELSISTEMA.matches ? 'dark' : 'light') : state.theme; }
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', temaReal());
    $('theme-btn').textContent = state.theme === 'auto' ? '🌗' : temaReal() === 'dark' ? '☀️' : '🌙';
    $('theme-btn').title = state.theme === 'auto' ? 'Tema: el del sistema' : temaReal() === 'dark' ? 'Tema: oscuro' : 'Tema: claro';
  }
  function ponerTema(cual) {
    state.theme = cual;
    try { localStorage.setItem(LLAVE('theme'), cual); } catch (e) {}
    applyTheme();
  }
  if (DELSISTEMA && DELSISTEMA.addEventListener) DELSISTEMA.addEventListener('change', function () { if (state.theme === 'auto') applyTheme(); });
  // El botón rota entre los tres; la ficha de perfil los tiene con su nombre.
  $('theme-btn').onclick = function () { ponerTema(state.theme === 'light' ? 'dark' : state.theme === 'dark' ? 'auto' : 'light'); };
  function applySound() { $('sound-btn').classList.toggle('on', state.sound); $('sound-btn').textContent = state.sound ? '🔔' : '🔕'; }
  $('sound-btn').onclick = function () {
    state.sound = !state.sound;
    try { localStorage.setItem(LLAVE('sound'), state.sound ? '1' : '0'); } catch (e) {}
    applySound();
    // Al encenderlo suena una vez: así se sabe qué se acaba de activar sin tener que esperar a que entre algo.
    if (state.sound) beep();
  };
  applyTheme(); applySound();

  // ---------- navegación ----------
  document.querySelectorAll('.rail .nav button').forEach(function (b) { b.onclick = function () { go(b.getAttribute('data-view')); }; });
  if ($('marca-btn')) $('marca-btn').onclick = function () { go('today'); };

  // ---------- la configuración, agrupada por de quién es ----------
  // 🪤 Estos ajustes estaban sueltos en el menú principal, seis de once botones, compitiendo por atención con
  // lo que se usa cada minuto. Pero el lío de verdad no era el sitio: era que no se veía DE QUIÉN es cada cosa.
  // El nombre del asistente es del cliente; el tuyo es tuyo; la consola es de aiva. Confundir esos tres niveles
  // costó cuatro entregas persiguiendo un nombre que se «cruzaba entre clientes». Aquí se dice en voz alta.
  var CFG_CLIENTE = [
    { view: 'profile', ic: 'store', lbl: 'Perfil del negocio' },
    { view: 'negocio', ic: 'sliders', lbl: 'El negocio' },
    { view: 'agent', ic: 'bot', lbl: 'El asistente' },
    { view: 'channels', ic: 'plug', lbl: 'Canales' },
    { view: 'knowledge', ic: 'book', lbl: 'Lo que sabe' }
  ];
  var CFG_TUYO = [
    { proxy: 'foot-user', ic: 'user', lbl: 'Con qué nombre respondes' },
    { proxy: 'theme-btn', ic: 'sun', lbl: 'Tema claro u oscuro' },
    { proxy: 'sound-btn', ic: 'bell', lbl: 'Sonido de avisos' },
    { proxy: 'logout-btn', ic: 'salir', lbl: 'Salir' }
  ];
  function itemCfg(d, clase) {
    var b = document.createElement('button');
    b.className = clase;
    b.innerHTML = '<i class="ic" data-ic="' + d.ic + '"></i>' + esc(d.lbl);
    if (d.view) { b.setAttribute('data-view', d.view); b.onclick = function () { cerrarCfg(); go(d.view); }; }
    else b.onclick = function () { cerrarCfg(); closeMore(); $(d.proxy).click(); };
    return b;
  }
  (function armarCfg() {
    var pop = $('cfg-pop');
    if (!pop) return;
    // 🪤 El nombre va SIEMPRE, aunque todavía no se sepa: es lo que convierte «Este cliente» en «DUNOR
    // Boutique» y lo que evita que alguien cambie el nombre del asistente creyendo que cambia el suyo.
    var grupo = function (titulo, marca) {
      var d = document.createElement('div');
      d.className = 'group';
      d.innerHTML = esc(titulo) + (marca ? '<b id="' + marca + '"></b>' : '');
      return d;
    };
    // De aiva: solo tiene sentido si entró por la consola, que es de quien la maneja.
    if (window.AIVA_CONSOLA) {
      pop.appendChild(grupo('Organización', 'aiva'));
      var consola = document.createElement('button');
      consola.className = 'item';
      consola.innerHTML = '<i class="ic" data-ic="grid"></i>Volver a la consola';
      consola.onclick = function () { location.href = '/consola'; };
      pop.appendChild(consola);
      pop.appendChild(document.createElement('hr'));
    }
    pop.appendChild(grupo('Este cliente', 'cfg-biz'));
    CFG_CLIENTE.forEach(function (d) { pop.appendChild(itemCfg(d, 'item')); });
    pop.appendChild(document.createElement('hr'));
    pop.appendChild(grupo('Tú', 'cfg-yo'));
    CFG_TUYO.forEach(function (d) { pop.appendChild(itemCfg(d, 'item')); });
    pop.appendChild(document.createElement('hr'));
    var ayuda = itemCfg({ view: 'help', ic: 'help', lbl: 'Ayuda' }, 'item');
    pop.appendChild(ayuda);
    // El estado de la conexión ya no cabe a la vista en el riel, pero no se tira: quien sospeche que algo no
    // llega lo mira aquí, que es donde se viene a mirar cuando algo no va.
    var pie = document.createElement('div');
    pie.className = 'group';
    pie.style.paddingTop = '8px';
    var conn = $('conn');
    if (conn) { conn.hidden = false; pie.appendChild(conn); }
    pop.appendChild(pie);
    // El mismo contenido sirve en el celular, donde el popover se abre abajo.
    CFG_CLIENTE.concat([{ view: 'help', ic: 'help', lbl: 'Ayuda' }]).forEach(function (d) {
      $('more-grid').appendChild(itemCfg(d, ''));
    });
  })();
  function cerrarCfg(devolverFoco) {
    var pop = $('cfg-pop');
    if (!pop || pop.hidden) return;
    pop.hidden = true;
    $('cfg-btn').setAttribute('aria-expanded', 'false');
    if (devolverFoco) $('cfg-btn').focus();
  }
  $('cfg-btn').onclick = function (e) {
    e.stopPropagation();
    var pop = $('cfg-pop');
    if (pop.hidden) {
      // Los dos nombres pueden llegar después del primer pintado.
      if ($('cfg-biz')) $('cfg-biz').textContent = state.bizName || 'este cliente';
      if ($('cfg-yo')) $('cfg-yo').textContent = state.name || 'sin nombre';
      pop.hidden = false;
      $('cfg-btn').setAttribute('aria-expanded', 'true');
      iconos(pop);
      var primero = pop.querySelector('.item');
      if (primero) primero.focus();
    } else cerrarCfg(true);
  };
  document.addEventListener('click', function (e) {
    if (!$('cfg-pop').hidden && !$('cfg-pop').contains(e.target) && !$('cfg-btn').contains(e.target)) cerrarCfg();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('cfg-pop').hidden) cerrarCfg(true); });
  function openMore() { $('more-sheet').hidden = false; $('nav-more').setAttribute('aria-expanded', 'true'); var first = $('more-grid').querySelector('button'); if (first) first.focus(); }
  function closeMore(returnFocus) {
    if ($('more-sheet').hidden) return;
    $('more-sheet').hidden = true; $('nav-more').setAttribute('aria-expanded', 'false');
    if (returnFocus) $('nav-more').focus();
  }
  $('nav-more').onclick = function (e) { e.stopPropagation(); if ($('more-sheet').hidden) openMore(); else closeMore(true); };
  document.addEventListener('click', function (e) { if (!$('more-sheet').hidden && !$('more-sheet').contains(e.target) && !$('nav-more').contains(e.target)) closeMore(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('more-sheet').hidden) closeMore(true); });
  $('more-sheet').querySelectorAll('[data-proxy]').forEach(function (b) { b.onclick = function () { closeMore(); $(b.getAttribute('data-proxy')).click(); }; });
  // ---------- el panel de la sección ----------
  // 🪤 Solo aparece donde tiene algo que decir. Un panel vacío a la izquierda «para que se vea simétrico» es
  // espacio robado a lo único que importa en esta pantalla, que es la conversación.
  var CFG_VIEWS = { agent: 1, channels: 1, knowledge: 1, help: 1 };
  var TITULOS = { today: 'Hoy', inbox: 'Conversaciones', calendar: 'Calendario', pipeline: 'Prospectos', analysis: 'Análisis', agent: 'El asistente', channels: 'Canales', knowledge: 'Lo que sabe', help: 'Ayuda' };
  function pintarPanel(view) {
    var panel = $('subnav');
    if (!panel) return;
    var conPanel = view === 'inbox' || CFG_VIEWS[view];
    document.querySelector('.app').setAttribute('data-subnav', conPanel ? 'si' : 'no');
    if (!conPanel) return;
    $('subnav-titulo').textContent = TITULOS[view] || '';
    $('filters').hidden = view !== 'inbox';
    var cfg = $('subnav-cfg');
    cfg.hidden = !CFG_VIEWS[view];
    if (CFG_VIEWS[view] && !cfg.childElementCount) {
      CFG_CLIENTE.concat([{ view: 'help', ic: 'help', lbl: 'Ayuda' }]).forEach(function (d) { cfg.appendChild(itemCfg(d, 'item')); });
      iconos(cfg);
    }
    cfg.querySelectorAll('[data-view]').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-view') === view); });
  }

  function go(view, opts) {
    // Perfil y El negocio no son pantallas: son configuración, y se abren en un modal encima de lo que estabas
    // haciendo. Así no se pierde de vista la conversación ni hay que volver a navegar.
    if (view === 'profile' || view === 'negocio') { abrirConfig(view); return; }
    state.view = view;
    document.querySelectorAll('.rail .nav button').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-view') === view); });
    pintarPanel(view);
    // Celular: «Más» se ve activo cuando la sección está dentro de él.
    $('nav-more').classList.toggle('active', Boolean(CFG_VIEWS[view]));
    $('more-grid').querySelectorAll('[data-view]').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-view') === view); });
    closeMore();
    document.querySelectorAll('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + view); });
    if (view === 'today') loadToday();
    if (view === 'inbox') { if (opts && opts.filter) setFilter(opts.filter); else loadContacts(); }
    if (view === 'pipeline') loadPipeline();
    if (view === 'calendar') loadCalendar();
    if (view === 'analysis') loadAnalysis();
    if (view === 'agent') loadAgent();
    if (view === 'help') loadHelp();
    if (view === 'channels') loadChannels();
    if (view === 'knowledge') loadKnowledge();
  }

  // ---------- bandeja ----------
  function setFilter(f) { state.filter = f; document.querySelectorAll('#filters button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-f') === f); }); loadContacts(); }
  document.querySelectorAll('#filters button').forEach(function (b) { b.onclick = function () { setFilter(b.getAttribute('data-f')); }; });
  var qTimer; $('q').oninput = function () { clearTimeout(qTimer); qTimer = setTimeout(function () { state.q = $('q').value.trim(); loadContacts(); }, 250); };

  function loadContacts() {
    var params = [];
    if (state.q) params.push('q=' + encodeURIComponent(state.q));
    if (state.filter.indexOf('stage:') === 0) params.push('stage=' + state.filter.slice(6));
    if (state.filter === 'human') params.push('human=1');
    if (state.filter === 'archived') params.push('archived=1');
    return api('/contacts' + (params.length ? '?' + params.join('&') : '')).then(function (list) {
      if (state.filter === 'unread') list = list.filter(function (c) { return c.unread > 0; });
      if (state.filter === 'hot') list = list.filter(function (c) { return c.score >= 60 || rol(c.stage) === 'cita'; });
      state.contacts = list; renderRows(); updateBadges();
    });
  }
  function renderRows() {
    var el = $('rows');
    if (!state.contacts.length) { el.innerHTML = '<div class="empty">Nada por aquí con este filtro.</div>'; return; }
    el.innerHTML = state.contacts.map(function (c) {
      return '<div class="row' + (state.current === c.id ? ' sel' : '') + '" data-id="' + esc(c.id) + '">' +
        '<div class="name"><span class="n">' + esc(nameOf(c)) + '</span>' + (c.unread ? '<span class="unread">' + c.unread + '</span>' : '') + '</div>' +
        '<div class="time">' + rel(c.lastMessageAt) + '</div>' +
        (c.hit
          ? '<div class="snip hit"><span class="who">' + esc(c.hit.role === 'user' ? nameOf(c) : state.agentName || 'Aiva') + ':</span> ' + mark(c.hit.content, state.q) + '</div>'
          : '<div class="snip"' + (c.summary ? ' title="' + esc(c.summary) + '"' : '') + '>' + esc(c.recap || c.summary || '') + '</div>') +
        '<div class="meta">' + verdictChip(c) + (c.humanMode ? '<span class="chip who">La lleva ' + esc(whoHas(c)) + '</span>' : '') + '</div>' +
        '</div>';
    }).join('');
    el.querySelectorAll('.row').forEach(function (r) {
      r.onclick = function () { openContact(r.getAttribute('data-id')); };
      r.oncontextmenu = function (e) { e.preventDefault(); abrirMenu(e.clientX, e.clientY, r.getAttribute('data-id')); };
    });
  }
  // Veredicto práctico: ¿es un prospecto o no? El detalle (factores, ánimo, urgencia) queda detrás de "Ver detalle".
  function verdict(c) {
    if (rol(c.stage) === 'ganado') return { label: 'Cliente', cls: 'v-cliente', why: 'Compró.' };
    if (rol(c.stage) === 'perdido') return { label: 'Perdido', cls: 'v-perdido', why: 'Se descartó.' };
    if (rol(c.stage) === 'cita') return { label: 'Prospecto con cita', cls: 'v-cita', why: 'Ya tiene cita agendada.' };
    if (c.score >= 60) return { label: 'Prospecto claro', cls: 'v-si', why: topFactor(c) };
    if (c.score >= 30) return { label: 'Posible prospecto', cls: 'v-posible', why: topFactor(c) };
    return { label: 'Sin señales aún', cls: 'v-no', why: c.messageCount ? 'Todavía no muestra intención de compra.' : 'Acaba de escribir.' };
  }
  function topFactor(c) { var top = (c.scoreFactors || []).slice().sort(function (a, b) { return Math.abs(b.points) - Math.abs(a.points); })[0]; return top ? top.label + '.' : ''; }
  // Quién lleva la conversación: si la pasó el bot, la tiene el equipo hasta que alguien la tome.
  function whoHas(c) { return c.humanBy && c.humanBy !== 'bot' ? c.humanBy : 'el equipo'; }
  function verdictChip(c) { var v = verdict(c); return '<span class="chip ' + v.cls + (isStale(c) ? ' stale' : '') + '" title="Probabilidad ' + c.score + (c.scoreAt ? ' · calculada hace ' + rel(c.scoreAt) : '') + '">' + esc(v.label) + '</span>'; }
  function isStale(c) { return c.scoreAt && c.lastMessageAt && c.lastMessageAt > c.scoreAt + 20000; }
  function tempLabel(t) { return t === 'frio' ? 'frío' : t; } // el valor interno va sin tilde; la palabra, con
  function scoreChip(c) { return '<span class="chip t-' + c.temperature + (isStale(c) ? ' stale' : '') + '" title="' + (c.scoreAt ? 'Calculado hace ' + rel(c.scoreAt) : 'Sin análisis') + '">' + c.score + ' · ' + tempLabel(c.temperature) + (isStale(c) ? ' (desactualizado)' : '') + '</span>'; }
  function sentIcon(s) { return { positivo: '😊 positivo', neutral: '😐 neutral', negativo: '😠 negativo' }[s] || s; }
  function updateBadges() {
    var unread = state.contacts.reduce(function (a, c) { return a + (c.unread || 0); }, 0);
    $('badge-unread').textContent = unread ? String(unread) : '';
  }

  function openContact(id, draft) {
    state.current = id;
    renderRows();
    $('inbox').setAttribute('data-pane', 'chat');
    return api('/contacts/' + encodeURIComponent(id)).then(function (d) {
      state.detail = d; renderChat(); renderDetails();
      anunciarme(id, d.presentes || []);
      api('/contacts/' + encodeURIComponent(id) + '/duplicates').then(renderDuplicates); // ¿otra ficha de la misma persona?
      bindArchive();
      var row = state.contacts.find(function (c) { return c.id === id; }); if (row) { row.unread = 0; renderRows(); updateBadges(); }
      // Retomar a un caliente: la conversación pasa a la persona y el borrador queda listo para ajustarlo y enviarlo.
      if (draft) {
        var put = function () { $('reply').value = draft; $('reply').focus(); $('reply').setSelectionRange(draft.length, draft.length); toast('Borrador listo: revísalo y envíalo'); };
        if (d.contact.humanMode) put();
        else api('/contacts/' + encodeURIComponent(id) + '/human', { method: 'POST', body: { on: true } }).then(function () { return openContact(id); }).then(put);
      }
    });
  }
  // Ventana de 24 h de WhatsApp oficial: se avisa antes de escribir, no después de que Meta rechace el mensaje.
  function windowNote(w) {
    if (!w || !w.limited || !w.closesAt) return '';
    var left = w.closesAt - Date.now();
    if (!w.open) return 'WhatsApp no deja escribirle ahora: su último mensaje fue hace ' + rel(w.closesAt - 86400000) + '. Para retomar hace falta una plantilla aprobada por Meta, o esperar a que vuelva a escribir.';
    if (left < 3 * 3600000) return 'Responde pronto: WhatsApp deja escribirle solo hasta dentro de ' + Math.max(1, Math.round(left / 60000)) + ' min.';
    return '';
  }
  function renderChat() {
    var d = state.detail; if (!d) return;
    var c = d.contact;
    var note = windowNote(d.replyWindow);
    $('window-warn').hidden = !note; $('window-warn').textContent = note;
    $('chat-empty').hidden = true; $('chat-head').hidden = false; $('msgs').hidden = false; $('composer').hidden = false;
    $('chat-name').textContent = nameOf(c);
    $('chat-channel').textContent = channelIcon(c.channel);
    $('chat-stage').textContent = state.stageLabels[c.stage] || c.stage; $('chat-stage').className = 'chip stage-' + (rol(c.stage) || c.stage);
    // Una línea de texto, no una tarjeta: temperatura primero (¿urge?), número de respaldo y el porqué de más peso.
    var top = (c.scoreFactors || []).slice().sort(function (a, b) { return Math.abs(b.points) - Math.abs(a.points); })[0];
    var v = verdict(c);
    $('chat-temp').innerHTML = '<b>' + esc(v.label) + '</b> · ' + c.score + (top ? ' · ' + esc(top.label) : '') + (c.scoreAt ? ' <span title="Calculado hace ' + rel(c.scoreAt) + '">· hace ' + rel(c.scoreAt) + '</span>' : '');
    $('chat-temp').className = 'meta-line' + (isStale(c) ? ' stale' : ''); $('chat-temp').title = isStale(c) ? 'Hay mensajes nuevos: el puntaje se recalcula en unos segundos' : '';
    var who = $('chat-who'); if (!who) { who = document.createElement('span'); who.id = 'chat-who'; who.className = 'chip who'; $('chat-temp').after(who); }
    who.hidden = !c.humanMode; who.textContent = c.humanMode ? 'La lleva ' + whoHas(c) + (c.humanSince ? ' · desde hace ' + rel(c.humanSince) : '') : '';
    setMode(c.humanMode);
    var m = $('msgs');
    // 🪤 Primero lo que ya estaba conversado antes de que aiva entrara. Sin esto, el tablero enseñaba media
    // conversación —lo que escribió el cliente y ninguna respuesta— mientras el asistente sí tenía el contexto
    // entero y contestaba con él. Ver una sola voz da la sensación de que el producto perdió lo que el negocio
    // ya había escrito, que es lo contrario de lo que pasa.
    var antes = d.antes || [];
    m.innerHTML = (antes.length
      ? '<div class="sysline">Lo que ya estaba conversado antes de aiva · ' + antes.length + ' mensaje' + (antes.length === 1 ? '' : 's') + '</div>'
        + antes.map(burbujaDeAntes).join('')
        + '<div class="sysline">Desde aquí lo lleva aiva</div>'
      : '') + d.messages.map(bubble).join('');
    if (c.humanMode) m.insertAdjacentHTML('beforeend', '<div class="sysline">Aiva está en pausa: esta conversación la lleva ' + esc(whoHas(c)) + (c.humanSince ? ' desde hace ' + rel(c.humanSince) : '') + '.</div>');
    m.scrollTop = m.scrollHeight;
  }
  // Lo traído del historial se pinta igual pero apagado: es conversación de verdad, pero no pasó por aquí y no
  // se puede responder a ella. Que se vea distinto evita que alguien crea que aiva contestó eso.
  function burbujaDeAntes(msg) {
    var mio = msg.role === 'assistant';
    var quien = mio ? (msg.autor && msg.autor !== 'negocio' ? esc(msg.autor) : 'El negocio') : (msg.autor ? esc(msg.autor) : 'Cliente');
    return '<div class="bubble ' + (mio ? 'human' : 'customer') + ' de-antes"><span class="who">' + quien + '</span>' + esc(msg.content) + '<span class="ts">' + hhmm(msg.ts) + '</span></div>';
  }
  function bubble(msg) {
    var who = msg.role === 'user' ? 'customer' : (msg.author === 'human' ? 'human' : 'bot');
    // 🪤 `by` es el nombre de quien contestó, y NO siempre lo escribe alguien de la casa: de un chat de WhatsApp
    // importado sale tal cual del archivo. Sin escapar, quien mandó ese chat ejecuta JavaScript en la pantalla
    // de quien atiende —y de ahí se lleva el token del tablero—. Comprobado: se ejecutaba.
    var label = who === 'customer' ? 'Cliente' : who === 'human' ? (msg.by ? esc(msg.by) + ' (equipo)' : 'Equipo') : 'Aiva';
    return '<div class="bubble ' + who + '"><span class="who">' + label + '</span>' + esc(msg.content) + '<span class="ts">' + hhmm(msg.ts) + '</span></div>';
  }
  function setMode(human) {
    $('seg-bot').classList.toggle('on', !human); $('seg-human').classList.toggle('on', human);
    $('seg').dataset.on = human ? 'human' : 'bot';
    $('seg-bot').setAttribute('aria-pressed', String(!human)); $('seg-human').setAttribute('aria-pressed', String(human));
    // 🪤 El cajón de escribir ya no se esconde cuando contesta aiva. Estaba escondido, así que para tomar una
    // conversación había que acordarse de mover un interruptor ANTES de tener nada que decir — y lo natural es
    // al revés: uno empieza a escribir. Ahora escribir es la señal, como contestar desde el teléfono.
    $('composer-hint').hidden = human;
    $('composer-hint').innerHTML = 'Contesta Aiva. <b>Si escribes aquí, se queda callada</b> en esta conversación.';
    $('reply').hidden = false; $('send').hidden = !human;
    $('reply').placeholder = human ? 'Escribe tu respuesta… (Enter envía, Shift+Enter salto)' : 'Escribe para tomar esta conversación…';
    if (human) $('reply').focus();
  }
  // En cuanto se escribe la primera letra, aiva se hace a un lado. No al enviar: mientras uno piensa la
  // respuesta, ella podría contestar primero y el cliente recibiría dos versiones de lo mismo.
  var tomando = false;
  $('reply').addEventListener('input', function () {
    if (tomando || !state.current || !$('reply').value.trim()) return;
    if ($('seg').dataset.on === 'human') return;
    tomando = true;
    var loEscrito = $('reply').value;
    api('/contacts/' + encodeURIComponent(state.current) + '/human', { method: 'POST', body: { on: true } })
      .then(function () { return openContact(state.current); })
      .then(function () {
        // 🪤 Lo que ya había escrito NO se pierde al recargar la conversación: es trabajo suyo.
        $('reply').value = loEscrito;
        $('reply').focus();
        toast('Tomaste esta conversación: Aiva se queda callada aquí');
      })
      .finally(function () { tomando = false; });
  });
  $('seg-bot').onclick = function () { toggleHuman(false); };
  $('seg-human').onclick = function () { toggleHuman(true); };
  function toggleHuman(on) {
    if (!state.current) return;
    api('/contacts/' + encodeURIComponent(state.current) + '/human', { method: 'POST', body: { on: on } }).then(function () { return openContact(state.current); });
  }
  function sendReply() {
    var text = $('reply').value.trim(); if (!text || !state.current) return;
    $('send').disabled = true;
    api('/contacts/' + encodeURIComponent(state.current) + '/reply', { method: 'POST', body: { text: text, by: state.name } }).then(function (r) {
      if (r.error) toast('No se pudo enviar: ' + r.error); else $('reply').value = '';
    }).finally(function () { $('send').disabled = false; $('reply').focus(); });
  }
  $('send').onclick = sendReply;
  $('reply').onkeydown = function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); } };
  $('back-list').onclick = function () { $('inbox').setAttribute('data-pane', 'list'); };
  $('details-btn').onclick = function () { $('inbox').setAttribute('data-pane', 'details'); };
  if (window.innerWidth <= 900) { $('back-list').style.display = ''; $('details-btn').style.display = ''; }

  // Dos fichas de la misma persona (mismo número, otro canal): se pueden unir en una sola.
  function renderDuplicates(list) {
    var box = $('dup-panel'); if (!box) return;
    if (!list || !list.length) { box.innerHTML = ''; return; }
    var d = list[0], c = d.contact, mine = state.detail && state.detail.contact;
    if (!mine) return;
    var keepMine = d.keepId === mine.id;
    var keepName = keepMine ? nameOf(mine) + ' (' + channelIcon(mine.channel) + ')' : (c.name || short(c.id)) + ' (' + channelIcon(c.channel) + ')';
    box.innerHTML = '<div class="panel"><b>¿Es la misma persona?</b>' +
      '<div class="small">' + esc(c.name || short(c.id)) + ' · ' + esc(channelIcon(c.channel)) + ' · ' + c.messageCount + (c.messageCount === 1 ? ' mensaje' : ' mensajes') +
      (c.lastMessageAt ? ' · escribió hace ' + rel(c.lastMessageAt) : '') + ' · ' + esc(d.reason) + '</div>' +
      '<div class="feed-row"><button class="btn" id="dup-merge">Unir fichas</button></div><div class="small" id="dup-msg" role="status"></div></div>';
    $('dup-merge').onclick = function () {
      $('dup-msg').innerHTML = 'Se conserva <b>' + esc(keepName) + '</b> (donde escribió más recientemente) y se le suman la conversación, las citas y el análisis de la otra. No se puede deshacer.' +
        '<div class="feed-row"><button class="btn primary" id="dup-yes">Unir</button><button class="btn" id="dup-no">Cancelar</button></div>';
      $('dup-no').onclick = function () { $('dup-msg').textContent = ''; };
      $('dup-yes').onclick = function () {
        $('dup-yes').disabled = true;
        api('/contacts/' + encodeURIComponent(mine.id) + '/merge', { method: 'POST', body: { with: c.id } }).then(function (r) {
          if (r.error) { $('dup-msg').innerHTML = '<span class="ch-err">No se pudo unir:</span> ' + esc(r.error); return; }
          toast('Fichas unidas');
          loadContacts();
          openContact(r.keptId);
        });
      };
    };
  }
  // Archivar saca la conversación de las listas (vuelve sola si el cliente escribe); borrar no se deshace.
  function bindArchive() {
    var c = state.detail && state.detail.contact; if (!c || !$('arch-btn')) return;
    $('arch-btn').onclick = function () {
      api('/contacts/' + encodeURIComponent(c.id) + '/archive', { method: 'POST', body: { on: !c.archived } }).then(function (r) {
        if (r.error) { toast('No se pudo: ' + r.error); return; }
        toast(c.archived ? 'Conversación de vuelta en las listas' : 'Conversación archivada');
        loadContacts(); openContact(c.id);
      });
    };
    $('del-btn').onclick = function () {
      $('del-msg').innerHTML = 'Se borra la ficha de <b>' + esc(nameOf(c)) + '</b> con su conversación, sus citas y su análisis. No se puede deshacer.' +
        '<div class="feed-row"><button class="btn primary" id="del-yes">Borrar definitivamente</button><button class="btn" id="del-no">Cancelar</button></div>';
      $('del-no').onclick = function () { $('del-msg').textContent = ''; };
      $('del-yes').onclick = function () {
        $('del-yes').disabled = true;
        api('/contacts/' + encodeURIComponent(c.id), { method: 'DELETE' }).then(function (r) {
          if (r.error) { $('del-msg').innerHTML = '<span class="ch-err">No se pudo borrar:</span> ' + esc(r.error); return; }
          toast('Conversación borrada');
          state.detail = null; state.current = null;
          $('details').innerHTML = '<div class="empty">Sin ficha.</div>';
          $('inbox').setAttribute('data-pane', 'list');
          loadContacts();
        });
      };
    };
  }
  function renderDetails() {
    var d = state.detail; if (!d) return;
    var c = d.contact, data = c.data || {};
    var hidden = { booking: 1, interes: 1, urgencia: 1, pospuesto_hasta: 1 };
    var dataRows = Object.keys(data).filter(function (k) { return !hidden[k] && data[k] !== '' && data[k] != null; }).map(function (k) { return '<dt>' + esc(k.replace(/_/g, ' ')) + '</dt><dd>' + esc(data[k]) + '</dd>'; }).join('');
    var factors = (c.scoreFactors || []).map(function (f) { return '<li><span>' + esc(f.label) + '</span><span class="' + (f.points >= 0 ? 'pos' : 'neg') + '">' + (f.points >= 0 ? '+' : '') + f.points + '</span></li>'; }).join('') || '<li class="muted">Aún sin análisis.</li>';
    var stages = Object.keys(state.stageLabels).map(function (k) { return '<option value="' + k + '"' + (k === c.stage ? ' selected' : '') + '>' + esc(state.stageLabels[k]) + '</option>'; }).join('');
    var appts = d.appointments.map(function (a) { return '<div class="appt ' + a.status + '"><span class="t">' + esc(a.label || '') + '</span><span class="grow small muted">' + esc(a.service) + ' · ' + a.status + '</span></div>'; }).join('') || '<span class="muted small">Sin citas.</span>';
    var events = d.events.slice(-12).reverse().map(function (e) { return '<li>' + rel(e.ts) + ' · ' + esc(eventLabel(e)) + '</li>'; }).join('') || '<li>Sin eventos.</li>';
    var v = verdict(c);
    var quick = esc(c.recap || '');
    $('details').innerHTML =
      '<div id="dup-panel"></div><div class="verdict' + (isStale(c) ? ' stale' : '') + '"><h3>¿Es un prospecto?</h3><div class="big">' + esc(v.label) + '</div><div class="why">' + esc(v.why || '') + (c.summary ? ' ' + esc(c.summary) : '') + '</div>' +
        (quick ? '<div class="small">' + quick + '</div>' : '') +
        '<div class="bar' + (isStale(c) ? ' stale' : '') + '" title="Probabilidad ' + c.score + '"><i class="z-' + c.temperature + '" style="width:' + c.score + '%"></i></div><div class="bar-legend"><span>sin señales</span><span>posible</span><span>prospecto</span></div>' +
        '<div class="small muted">Probabilidad ' + c.score + ' (en tarjetas y avisos: ' + esc(tempLabel(c.temperature)) + ')' + (c.scoreBase > c.score ? ' · llegó a ' + c.scoreBase + ' cuando hablaron' : '') + (c.scoreAt ? ' · hace ' + rel(c.scoreAt) : '') + (isStale(c) ? ' · <b style="color:var(--warn)">hay mensajes nuevos, se recalcula solo</b>' : '') + ' · <button class="linkbtn" id="toggle-detail">' + (state.detailOpen ? 'Ocultar detalle' : 'Ver detalle') + '</button></div>' +
      '</div>' +
      '<div class="detail-more" id="detail-more"' + (state.detailOpen ? '' : ' hidden') + '>' +
        '<div><h3>Por qué</h3><ul class="factors">' + factors + '</ul>' + (c.sentiment ? '<div class="small muted" style="margin-top:6px">Ánimo: ' + sentIcon(c.sentiment) + (data.urgencia ? ' · urgencia ' + esc(data.urgencia) : '') + '</div>' : '') + '</div>' +
        '<div style="margin-top:12px"><h3>Datos capturados</h3>' + (dataRows ? '<dl class="kv">' + dataRows + '</dl>' : '<span class="muted small">Todavía nada. Se llenan solos mientras conversa.</span>') + '</div>' +
      '</div>' +
      '<div><h3>Ficha</h3><div style="display:flex;flex-direction:column;gap:6px">' +
        '<input type="text" id="f-name" placeholder="Nombre" value="' + esc(c.name || '') + '">' +
        '<input type="text" id="f-phone" placeholder="Teléfono" value="' + esc(c.phone || '') + '">' +
        (d.number
          ? '<div class="feed-row"><a class="btn sm" target="_blank" rel="noopener" href="https://wa.me/' + esc(d.number) + '">Escribirle por WhatsApp</a>' +
            '<a class="btn sm" href="tel:+' + esc(d.number) + '">Llamar</a></div>'
          : '<div class="small muted">Sin número: no dejó teléfono todavía.</div>') +
        // Por dónde llegó. Al atender cambia la conversación: no es lo mismo alguien que venía buscando trajes
        // de grado que alguien que pulsó un anuncio de alquiler para una boda.
        (d.origen
          ? '<div class="small muted" style="margin-top:6px">Llegó por <b>' + esc(d.origen.fuente || 'un origen desconocido') + '</b>' +
            (d.origen.campana ? ' · ' + esc(d.origen.campana) : '') +
            (d.origen.titular ? '<div class="small">«' + esc(d.origen.titular) + '»</div>' : '') +
            (d.origen.url ? '<div class="small muted">' + esc(d.origen.url) + '</div>' : '') + '</div>'
          : '') +
        '<select id="f-stage">' + stages + '</select>' +
        '<input type="text" id="f-tags" placeholder="Etiquetas separadas por coma" value="' + esc((c.tags || []).join(', ')) + '">' +
        '<textarea id="f-notes" placeholder="Notas internas">' + esc(c.notes || '') + '</textarea>' +
        '<div style="display:flex;gap:6px"><button class="btn sm primary" id="f-save">Guardar</button><button class="btn sm" id="f-analyze">Re-analizar</button></div>' +
        '<div class="feed-row" style="margin-top:8px"><button class="btn sm" id="arch-btn">' + (c.archived ? 'Devolver a las listas' : 'Archivar') + '</button><button class="btn sm" id="del-btn">Borrar</button></div><div class="small" id="del-msg" role="status"></div>' +
      '</div></div>' +
      '<div><h3>Citas</h3>' + appts + '</div>' +
      '<div><h3>Línea de tiempo</h3><ul class="timeline">' + events + '</ul></div>' +
      '<div class="small muted">' + esc(channelIcon(c.channel)) + ' · ' + esc(c.id) + '</div>';
    $('toggle-detail').onclick = function () { state.detailOpen = !state.detailOpen; $('detail-more').hidden = !state.detailOpen; $('toggle-detail').textContent = state.detailOpen ? 'Ocultar detalle' : 'Ver detalle'; };
    $('f-save').onclick = function () {
      api('/contacts/' + encodeURIComponent(c.id), { method: 'PATCH', body: { name: $('f-name').value, phone: $('f-phone').value, stage: $('f-stage').value, tags: $('f-tags').value.split(',').map(function (t) { return t.trim(); }).filter(Boolean), notes: $('f-notes').value } })
        .then(function () { toast('Ficha guardada'); openContact(c.id); loadContacts(); });
    };
    $('f-analyze').onclick = function () { $('f-analyze').disabled = true; api('/contacts/' + encodeURIComponent(c.id) + '/analyze', { method: 'POST' }).then(function () { openContact(c.id); loadContacts(); }); };
  }
  function eventLabel(e) {
    var p = e.payload || {};
    switch (e.type) {
      case 'stage': return 'Etapa: ' + (state.stageLabels[p.from] || p.from || '—') + ' → ' + (state.stageLabels[p.to] || p.to) + ' (' + (p.by || 'bot') + ')';
      case 'human_on': return 'Tomó el control: ' + (p.by === 'admin' ? 'equipo' : 'el cliente pidió una persona');
      case 'human_off': return 'Aiva retoma la conversación';
      case 'appointment_booked': return 'Cita agendada';
      case 'appointment_updated': return 'Cita ' + (p.status || 'actualizada');
      case 'followup_snooze': return 'Seguimiento pospuesto ' + (p.days || 7) + ' días';
      case 'appointment_cross': return p.desde ? 'Cita ' + esc(p.what) + ' por el cliente desde ' + esc(p.desde) : 'Cita ' + esc(p.what) + ', de su otra ficha';
      default: return e.type;
    }
  }

  // ---------- hoy ----------
  // Borrador para retomar a un prospecto caliente: solo con lo que él mismo dijo (prenda, ocasión). Sin precios ni
  // fechas inventadas, y queda en el cajón de escribir para que la persona lo ajuste antes de enviarlo.
  function followupDraft(c) {
    var d = c.data || {}, first = (nameOf(c) || '').split(' ')[0], biz = state.bizName ? ' de ' + state.bizName : '';
    var prenda = (d.prenda || d.servicio || '').toString().replace(/\s*\(.*?\)/g, '').trim();
    var ocasion = (d.ocasion || '').toString().replace(/\s*\(.*?\)/g, '').trim();
    var asunto = prenda ? 'lo de tu ' + prenda + (ocasion ? ' para tu ' + ocasion : '') : 'lo que hablamos' + (ocasion ? ' para tu ' + ocasion : '');
    return 'Hola' + (first && !/^(web|wa|meta|cli|mcp)$/.test(first) ? ' ' + first : '') + ' 🙂 Te escribo' + biz + ' para saber si seguimos con ' + asunto +
      '. Si quieres, te aparto una cita y lo vemos con calma; dime qué día te sirve.';
  }
  function contactRow(c, extra, actions) {
    return '<div class="row" data-id="' + esc(c.id) + '"><div class="name"><span class="n">' + esc(nameOf(c)) + '</span>' + (c.unread ? '<span class="unread">' + c.unread + '</span>' : '') + '</div><div class="time">' + rel(c.lastMessageAt) + '</div><div class="snip">' + esc(extra || c.recap || c.summary || '') + '</div><div class="meta"><span class="chip canal">' + esc(channelIcon(c.channel)) + '</span><span class="chip stage-' + (rol(c.stage) || c.stage) + '">' + esc(state.stageLabels[c.stage] || c.stage) + '</span>' + scoreChip(c) + (c.humanMode ? '<span class="chip who">La lleva ' + esc(whoHas(c)) + '</span>' : '') + '</div>' + (actions ? '<div class="acts">' + actions + '</div>' : '') + '</div>';
  }
  function loadToday() {
    api('/today').then(function (t) {
      var d = new Date();
      $('today-sub').textContent = d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }) + (state.name ? ' · ' + state.name : '');
      // Orden por costo del silencio: primero lo que alguien está esperando.
      var sections = [
        { t: 'Por verificar', n: t.verifications.length, html: t.verifications.map(verifyItem).join(''), empty: 'Nada pendiente: ' + (state.agentName || 'Aiva') + ' supo responder todo.' },
        { t: 'Esperan tu respuesta', n: t.unanswered.length, html: t.unanswered.map(function (c) { return contactRow(c, c.humanMode ? 'La última palabra la tiene el cliente y Aiva está en pausa.' : 'La última palabra la tiene el cliente y Aiva no respondió.'); }).join(''), empty: 'Nadie espera respuesta de una persona.' },
        { t: 'Pidieron una persona', n: t.handoffs.length, html: t.handoffs.map(function (c) { return contactRow(c); }).join(''), empty: 'Aiva lleva todas las conversaciones.' },
        { t: '¿Cómo les fue? (citas que ya pasaron)', n: (t.past || []).length, html: (t.past || []).map(pastItem).join(''), empty: 'Ninguna cita pasada sin resultado.' },
        { t: 'Recordar a mano', n: (t.remind || []).length, html: (t.remind || []).map(remindItem).join(''), empty: 'Los recordatorios de mañana salen solos.' },
        { t: 'Citas de hoy', n: t.appointments.length, html: t.appointments.map(function (a) { return '<div class="appt"><span class="t">' + esc(a.label) + '</span><span class="grow"><b>' + esc(a.contactName || short(a.userId)) + '</b> <span class="muted small">' + esc(a.service) + '</span>' + reminderChip(a) + '</span><button class="btn sm" data-open="' + esc(a.userId) + '">Chat</button></div>'; }).join(''), empty: 'Sin citas hoy.' },
        { t: 'Calientes sin seguimiento (más de 24 h)', n: t.hot.length, html: t.hot.map(function (c) {
          return contactRow(c, null, '<button class="btn sm primary" data-follow="' + esc(c.id) + '">Escribirle</button><button class="btn sm" data-snooze="' + esc(c.id) + '">Dejarlo por ahora</button>');
        }).join(''), empty: 'Ningún prospecto caliente abandonado.' },
        { t: 'Sin leer, Aiva ya respondió', n: t.unread.length, html: t.unread.map(function (c) { return contactRow(c); }).join(''), empty: 'Todo leído.' },
        { t: 'Próximas citas (3 días)', n: t.upcoming.length, html: t.upcoming.map(function (a) { return '<div class="appt"><span class="grow stack"><span class="small muted">' + esc(a.label) + '</span><b>' + esc(a.contactName || short(a.userId)) + '</b>' + reminderChip(a) + '</span><button class="btn sm" data-open="' + esc(a.userId) + '">Chat</button></div>'; }).join(''), empty: 'Nada agendado en los próximos días.' },
      ];
      var down = t.public && (t.public.state === 'caida' || t.public.state === 'otro_servidor')
        ? '<div class="panel help-first" role="alert"><span class="grow"><b>La dirección pública no responde.</b> <span class="small">' + esc(publicDetail(t.public)) + '</span></span><button class="btn primary" data-go="channels">Ver en Canales</button></div>'
        : '';
      // Cada sección con su color: lo urgente no puede verse igual que lo que ya está resuelto.
      var TONOS = ['verificar', 'esperan', 'persona', 'pasadas', 'recordar', 'citas', 'calientes', 'leidas', 'proximas'];
      $('today').innerHTML = down + helpBanner() + sections.map(function (s, i) {
        return '<div class="panel" data-tono="' + (TONOS[i] || '') + '"><h3>' + esc(s.t) + '<span class="chip">' + s.n + '</span></h3>' +
          (s.html || '<div class="ok">' + esc(s.empty) + '</div>') + '</div>';
      }).join('');
      $('today').querySelectorAll('.row').forEach(function (r) {
        r.onclick = function () { go('inbox'); openContact(r.getAttribute('data-id')); };
        r.oncontextmenu = function (e) { e.preventDefault(); abrirMenu(e.clientX, e.clientY, r.getAttribute('data-id')); };
      });
      $('today').querySelectorAll('[data-open]').forEach(function (b) { b.onclick = function () { go('inbox'); openContact(b.getAttribute('data-open')); }; });
      $('today').querySelectorAll('[data-go]').forEach(function (b) { b.onclick = function () { go(b.getAttribute('data-go')); }; });
      if ($('help-hide')) $('help-hide').onclick = function () { helpSet('aiva.help.seen', true); loadToday(); };
      bindVerifyItems();
      $('today').querySelectorAll('[data-follow]').forEach(function (b) {
        b.onclick = function (e) {
          e.stopPropagation();
          var c = t.hot.find(function (x) { return x.id === b.getAttribute('data-follow'); });
          go('inbox'); openContact(c.id, followupDraft(c));
        };
      });
      $('today').querySelectorAll('[data-snooze]').forEach(function (b) {
        b.onclick = function (e) {
          e.stopPropagation();
          b.disabled = true;
          api('/contacts/' + encodeURIComponent(b.getAttribute('data-snooze')) + '/snooze', { method: 'POST', body: { days: 7 } })
            .then(function () { toast('Lo dejamos por ahora: vuelve a la lista en una semana'); loadToday(); });
        };
      });
      $('today').querySelectorAll('[data-outcome]').forEach(function (b) {
        b.onclick = function () {
          var row = b.closest('.appt'), id = row.getAttribute('data-appt'), user = row.getAttribute('data-user'), o = b.getAttribute('data-outcome');
          row.querySelectorAll('button').forEach(function (x) { x.disabled = true; });
          var done = api('/appointments/' + id, { method: 'PATCH', body: { status: o === 'no_asistio' ? 'no_asistio' : 'completada' } });
          if (o === 'vendido' && etapaCon('ganado')) done = done.then(function () { return api('/contacts/' + encodeURIComponent(user), { method: 'PATCH', body: { stage: etapaCon('ganado') } }); });
          done.then(loadToday);
        };
      });
      $('today').querySelectorAll('[data-reminded]').forEach(function (b) {
        b.onclick = function () {
          b.disabled = true;
          api('/appointments/' + b.getAttribute('data-reminded') + '/reminded', { method: 'POST', body: { by: state.name } }).then(loadToday);
        };
      });
    });
  }
  // Citas que ya pasaron: el resultado queda registrado (y es el dato para calibrar el puntaje más adelante).
  function pastItem(a) {
    return '<div class="appt" data-appt="' + a.id + '" data-user="' + esc(a.userId) + '"><span class="grow stack"><span class="small muted">' + esc(a.label) + '</span><b>' + esc(a.contactName || short(a.userId)) + '</b></span>' +
      '<span class="feed-row"><button class="btn sm" data-outcome="completada">Vino</button><button class="btn sm" data-outcome="no_asistio">No vino</button><button class="btn sm" data-outcome="vendido">Compró</button></span></div>';
  }
  // Recordatorio del día antes: lo que respondió el cliente pesa más que si se envió.
  function reminderChip(a) {
    var r = a.reminder, html = '';
    if (a.reply === 'confirmó') html = '<span class="chip v-si">Confirmó</span>';
    else if (a.reply === 'no_puede') html = '<span class="chip v-perdido">No puede</span>';
    else if (r && r.status === 'enviado') html = '<span class="chip" title="' + esc((r.note || 'Enviado por ' + (state.agentName || 'Aiva')) + (r.at ? ' · hace ' + rel(r.at) : '')) + '">Recordada</span>';
    else if (r && r.status === 'a_mano') html = '<span class="chip v-posible">Recordar a mano</span>';
    else if (!r && a.remindAt && a.remindAt > Date.now()) {
      var at = new Date(a.remindAt), today = new Date(), tomorrow = new Date(Date.now() + 86400000);
      var day = at.toDateString() === today.toDateString() ? 'hoy' : at.toDateString() === tomorrow.toDateString() ? 'mañana' : at.toLocaleDateString('es-CO', { weekday: 'long' });
      html = '<span class="muted small">Se recuerda ' + day + ' a las ' + esc(at.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })) + '</span>';
    }
    return html ? '<span class="rem">' + html + '</span>' : '';
  }
  function remindItem(a) {
    var who = a.contactName || short(a.userId);
    var wa = a.number ? '<a class="btn primary" target="_blank" rel="noopener" href="https://wa.me/' + esc(a.number) + '?text=' + encodeURIComponent(a.text) + '">Abrir WhatsApp</a>' : '';
    return '<div class="verify"><div class="verify-q"><b>' + esc(who) + '</b> <span class="muted small">' + esc(a.label) + '</span>' +
      '<div class="small">' + esc(a.reminder && a.reminder.note || '') + '</div></div>' +
      '<div class="small muted">«' + esc(a.text) + '»</div>' +
      '<div class="feed-row">' + wa + '<button class="btn" data-reminded="' + a.id + '">Ya se lo recordé</button><button class="btn" data-open="' + esc(a.userId) + '">Chat</button></div></div>';
  }
  // "Deja te verifico eso": pregunta del cliente, respuesta del equipo y la opción de que el bot lo aprenda.
  function verifyItem(v) {
    var who = v.contactName || short(v.userId);
    var note = windowNote(v.window);
    return '<div class="verify" data-vid="' + v.id + '"><div class="verify-q"><b>' + esc(who) + '</b> <span class="muted small">hace ' + rel(v.createdAt) + '</span><div>«' + esc(v.question) + '»</div></div>' +
      (note ? '<div class="ch-warn">' + esc(note) + '</div>' : '') +
      '<label class="small muted" for="va-' + v.id + '">' + (v.contactName ? 'Respuesta para ' + esc(v.contactName) : 'Tu respuesta') + '</label><textarea id="va-' + v.id + '" rows="2" placeholder="Lo que le quieres responder"></textarea>' +
      '<label class="small verify-learn"><input type="checkbox" id="vl-' + v.id + '" checked> Agregar a la información de ' + esc(state.bizName || 'la tienda') + ': la próxima vez ' + esc(state.agentName || 'Aiva') + ' ya lo sabe</label>' +
      '<div class="feed-row"><button class="btn primary" data-vanswer="' + v.id + '">Enviar respuesta</button><button class="btn" data-vdismiss="' + v.id + '">Descartar</button><button class="btn" data-open="' + esc(v.userId) + '">Ver conversación</button></div>' +
      '<div class="small ch-err" id="ve-' + v.id + '" role="status"></div></div>';
  }
  function bindVerifyItems() {
    $('today').querySelectorAll('[data-vanswer]').forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-vanswer');
        b.disabled = true;
        api('/verifications/' + id + '/answer', { method: 'POST', body: { answer: $('va-' + id).value, by: state.name || 'equipo', learn: $('vl-' + id).checked } }).then(function (r) {
          b.disabled = false;
          if (r.error) { $('ve-' + id).textContent = r.error; return; }
          toast(r.verification.learned ? 'Respondido y aprendido' : 'Respondido');
          loadToday();
        });
      };
    });
    $('today').querySelectorAll('[data-vdismiss]').forEach(function (b) {
      b.onclick = function () { api('/verifications/' + b.getAttribute('data-vdismiss') + '/dismiss', { method: 'POST' }).then(loadToday); };
    });
  }
  $('today-refresh').onclick = loadToday;

  // ---------- notificaciones ----------
  function renderNotifs() {
    var unseen = state.notifs.filter(function (n) { return n.id > state.notifSeen; }).length;
    $('badge-notif').textContent = unseen ? String(unseen) : '';
    $('notif-list').innerHTML = state.notifs.length ? state.notifs.map(function (n) { return '<div class="n' + (n.id > state.notifSeen ? ' unseen' : '') + '" data-id="' + esc(n.userId) + '"><b>' + esc(n.title) + '</b><span>' + esc(n.body) + ' · ' + rel(n.ts) + '</span></div>'; }).join('') : '<div class="empty">Nada todavía.</div>';
    $('notif-list').querySelectorAll('.n').forEach(function (el) { el.onclick = function () { $('notif').classList.remove('open'); var id = el.getAttribute('data-id'); if (id === 'system') go('agent'); else { go('inbox'); openContact(id); } }; });
  }
  function loadNotifs() { api('/notifications').then(function (list) { state.notifs = list; renderNotifs(); }); }
  $('bell-btn').onclick = function (e) { e.stopPropagation(); $('notif').classList.toggle('open'); };
  document.addEventListener('click', function (e) { if (!$('notif').contains(e.target) && e.target !== $('bell-btn')) $('notif').classList.remove('open'); });
  $('notif-clear').onclick = function () { state.notifSeen = state.notifs.length ? Math.max.apply(null, state.notifs.map(function (n) { return n.id; })) : 0; try { localStorage.setItem(LLAVE('notifSeen'), String(state.notifSeen)); } catch (e) {} renderNotifs(); };

  // ---------- pipeline ----------
  function loadPipeline(focusId) {
    api('/contacts?limit=500').then(function (list) {
      // Al redibujar (también por un evento en vivo) el foco no se pierde: vuelve a la misma tarjeta.
      var active = document.activeElement && document.activeElement.closest ? document.activeElement.closest('#board .card') : null;
      focusId = focusId || (active && active.getAttribute('data-id'));
      var stages = Object.keys(state.stageLabels);
      var moveTo = function (c) {
        return '<select class="card-move" aria-label="Mover a ' + esc(nameOf(c)) + ' a otra etapa"><option value="" selected disabled>Mover a…</option>' +
          stages.filter(function (k) { return k !== c.stage; }).map(function (k) { return '<option value="' + k + '">' + esc(state.stageLabels[k]) + '</option>'; }).join('') + '</select>';
      };
      $('board').innerHTML = stages.map(function (s) {
        var cards = list.filter(function (c) { return c.stage === s; });
        // El color de la columna sale del PAPEL de la etapa, no de su nombre: cada negocio las llama distinto y
        // con los nombres fijos una financiera veía el tablero entero en gris.
        var def = (state.stages || []).find(function (x) { return x.id === s; }) || {};
        return '<div class="col" data-stage="' + s + '" data-rol="' + esc(def.rol || '') + '">' +
          '<h3>' + esc(state.stageLabels[s]) + '<span class="cuenta">' + cards.length + '</span></h3><div class="cards">' +
          cards.map(function (c) {
            return '<div class="card" draggable="true" data-id="' + esc(c.id) + '"><div class="body">' +
              '<div class="t">' + scoreChip(c) + '<span class="grow"></span><span class="cuando">' + esc(c.lastMessageAt ? rel(c.lastMessageAt) : '') + '</span></div>' +
              '<button type="button" class="card-open" title="Abrir la conversación">' + esc(nameOf(c)) + '</button>' +
              '<div class="s">' + esc(c.recap || c.summary || '') + '</div>' +
              '<div class="pie">' + channelIcon(c.channel) + (c.unread ? '<span class="chip sin-leer">' + c.unread + ' sin leer</span>' : '') +
                (c.humanMode ? '<span class="chip who">con una persona</span>' : '') + '</div>' +
              moveTo(c) + '</div></div>';
          }).join('') +
          '</div></div>';
      }).join('');
      $('board').querySelectorAll('.card').forEach(function (card) {
        // Clic en cualquier parte de la tarjeta abre la conversación (con teclado: el nombre es el botón); la lista no.
        card.onclick = function (e) { if (e.target.closest('.card-move')) return; go('inbox'); openContact(card.getAttribute('data-id')); };
        var move = card.querySelector('.card-move');
        move.onchange = function () { moveCard(card.getAttribute('data-id'), move.value); };
        card.ondragstart = function (e) {
          e.dataTransfer.setData('text/plain', card.getAttribute('data-id'));
          setTimeout(function () { card.classList.add('dragging'); }, 0); // después de que el navegador toma la imagen que arrastra
        };
        card.ondragend = function () { card.classList.remove('dragging'); };
      });
      $('board').querySelectorAll('.col').forEach(function (col) {
        col.ondragover = function (e) { e.preventDefault(); col.classList.add('over'); };
        col.ondragleave = function () { col.classList.remove('over'); };
        col.ondrop = function (e) { e.preventDefault(); col.classList.remove('over'); moveCard(e.dataTransfer.getData('text/plain'), col.getAttribute('data-stage')); };
      });
      // Después de mover con «Mover a…», el foco sigue a la tarjeta en su nueva columna.
      var moved = focusId && $('board').querySelector('.card[data-id="' + (window.CSS && CSS.escape ? CSS.escape(focusId) : focusId) + '"] .card-open');
      if (moved) { moved.focus(); moved.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    });
  }
  function moveCard(id, stage) {
    if (!id || !stage) return;
    api('/contacts/' + encodeURIComponent(id), { method: 'PATCH', body: { stage: stage } }).then(function (r) {
      $('board-status').textContent = r && r.error ? 'No se pudo mover: ' + r.error : 'Movida a ' + (state.stageLabels[stage] || stage) + '.';
      loadPipeline(id);
    });
  }

  // ---------- calendario (vista semanal tipo agenda) ----------
  // En el celular la semana no cabe (siete columnas): se abre en Agenda, que es una lista. Lo que elijas se recuerda.
  var onPhone = function () { return window.matchMedia('(max-width: 900px)').matches; };
  var cal = { mode: helpGet('aiva.cal.mode') || (onPhone() ? 'agenda' : 'week'), start: startOfWeek(new Date()), cfg: null, appts: [], busy: [] };
  var HOUR_PX = 56;
  function startOfWeek(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function hm(str) { var p = str.split(':'); return Number(p[0]) + Number(p[1] || 0) / 60; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function toLocalInput(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }

  function loadCalendar() {
    var p = cal.cfg ? Promise.resolve(cal.cfg) : api('/agent').then(function (a) { cal.cfg = a.appointments; return cal.cfg; });
    p.then(function () {
      var from = addDays(cal.start, -1).getTime(), to = addDays(cal.start, 8).getTime();
      return Promise.all([api('/appointments?from=' + from + '&to=' + to), api('/busy?from=' + from + '&to=' + to)]);
    }).then(function (r) {
      var list = r[0]; cal.busy = r[1] || [];
      cal.appts = list;
      $('badge-cal').textContent = list.filter(function (a) { return a.status === 'confirmada' && a.startsAt >= Date.now(); }).length || '';
      renderCalendar();
    });
    api('/contacts?limit=500').then(function (list) { $('book-contact').innerHTML = list.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(nameOf(c)) + '</option>'; }).join(''); });
  }
  function renderCalendar() {
    var end = addDays(cal.start, 6);
    var fmt = function (d) { return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }); };
    $('cal-label').textContent = fmt(cal.start) + ' – ' + fmt(end) + ' ' + end.getFullYear();
    $('cal-grid').hidden = cal.mode !== 'week'; $('cal-list').hidden = cal.mode !== 'agenda';
    $('cal-week-btn').classList.toggle('on', cal.mode === 'week'); $('cal-agenda-btn').classList.toggle('on', cal.mode === 'agenda');
    $('cal-seg').setAttribute('data-on', cal.mode === 'agenda' ? 'right' : 'left'); // la pastilla sigue al modo
    $('cal-week-btn').setAttribute('aria-pressed', String(cal.mode === 'week')); $('cal-agenda-btn').setAttribute('aria-pressed', String(cal.mode === 'agenda'));
    if (cal.mode === 'week') renderWeek(); else renderAgenda();
  }
  function renderWeek() {
    var cfg = cal.cfg || { days: [1, 2, 3, 4, 5], hours: [['09:00', '18:00']], durationMin: 45, enabled: false };
    var hours = cfg.hours && cfg.hours.length ? cfg.hours : [['09:00', '18:00']];
    var h0 = Math.max(0, Math.floor(Math.min.apply(null, hours.map(function (h) { return hm(h[0]); })) - 1));
    var h1 = Math.min(24, Math.ceil(Math.max.apply(null, hours.map(function (h) { return hm(h[1]); })) + 1));
    var total = h1 - h0, now = new Date();
    var days = []; for (var i = 0; i < 7; i++) days.push(addDays(cal.start, i));
    var head = '<div class="cal-head"><div class="d"></div>' + days.map(function (d) { return '<div class="d' + (sameDay(d, now) ? ' today' : '') + (cfg.days.indexOf(d.getDay()) < 0 ? ' closed' : '') + '">' + d.toLocaleDateString('es-CO', { weekday: 'short' }) + '<b>' + d.getDate() + '</b></div>'; }).join('') + '</div>';
    var hoursCol = '<div class="cal-hours" style="height:' + total * HOUR_PX + 'px">' + Array.from({ length: total + 1 }, function (_, i) { return '<div class="h" style="top:' + i * HOUR_PX + 'px">' + pad(h0 + i) + ':00</div>'; }).join('') + '</div>';
    var cols = days.map(function (d) {
      var open = cfg.days.indexOf(d.getDay()) >= 0;
      var closed = '';
      if (!open) closed = '<div class="closed" style="top:0;height:' + total * HOUR_PX + 'px"></div>';
      else {
        var cursor = h0;
        hours.slice().sort(function (a, b) { return hm(a[0]) - hm(b[0]); }).forEach(function (h) {
          var a = hm(h[0]), b = hm(h[1]);
          if (a > cursor) closed += '<div class="closed" style="top:' + (cursor - h0) * HOUR_PX + 'px;height:' + (a - cursor) * HOUR_PX + 'px"></div>';
          cursor = Math.max(cursor, b);
        });
        if (cursor < h1) closed += '<div class="closed" style="top:' + (cursor - h0) * HOUR_PX + 'px;height:' + (h1 - cursor) * HOUR_PX + 'px"></div>';
      }
      var evs = cal.appts.filter(function (a) { return sameDay(new Date(a.startsAt), d); }).map(function (a) {
        var st = new Date(a.startsAt), en = new Date(a.endsAt);
        var top = ((st.getHours() + st.getMinutes() / 60) - h0) * HOUR_PX, height = Math.max(22, ((en - st) / 3600000) * HOUR_PX - 2);
        // El estado va también en el texto: el color y el relieve nunca son la única señal.
        var mark = { completada: '✓ Asistió · ', no_asistio: '✗ No asistió · ', cancelada: 'Cancelada · ' }[a.status] || '';
        var who = a.contactName || short(a.userId);
        return '<div class="cal-ev ' + a.status + '" data-id="' + a.id + '" title="' + esc(who + ' · ' + mark + hhmm(a.startsAt) + ' · ' + a.service) + '" style="top:' + top + 'px;height:' + height + 'px"><b>' + esc(who) + '</b><span>' + esc(mark + hhmm(a.startsAt)) + '</span><span>' + esc(a.service) + '</span></div>';
      }).join('');
      // Eventos del calendario privado del dueño: el bot no ofrece esas horas.
      var dayStart = new Date(d).setHours(0, 0, 0, 0), dayEnd = dayStart + 86400000;
      var busy = cal.busy.map(function (b) {
        var s = Math.max(b.start, dayStart), e = Math.min(b.end, dayEnd);
        if (e <= s) return '';
        var top = Math.max(0, ((s - dayStart) / 3600000 - h0) * HOUR_PX), bottom = Math.min(total * HOUR_PX, ((e - dayStart) / 3600000 - h0) * HOUR_PX);
        return bottom > top ? '<div class="cal-busy" style="top:' + top + 'px;height:' + (bottom - top) + 'px" title="Ocupado en tu calendario: el bot no ofrece esta hora"><span>Ocupado</span></div>' : '';
      }).join('');
      var nowLine = sameDay(d, now) ? '<div class="cal-now" style="top:' + ((now.getHours() + now.getMinutes() / 60) - h0) * HOUR_PX + 'px"></div>' : '';
      return '<div class="cal-col' + (sameDay(d, now) ? ' today' : '') + '" data-day="' + d.getTime() + '" style="height:' + total * HOUR_PX + 'px;--hour-px:' + HOUR_PX + 'px">' + closed + busy + evs + nowLine + '</div>';
    }).join('');
    $('cal-grid').innerHTML = head + '<div class="cal-body">' + hoursCol + cols + '</div>';
    // clic en un hueco: prellena la fecha y hora del formulario (redondeado a la duración de la cita)
    $('cal-grid').querySelectorAll('.cal-col').forEach(function (col) {
      col.onclick = function (e) {
        if (e.target.closest('.cal-ev')) return;
        var rect = col.getBoundingClientRect();
        var hoursFromTop = (e.clientY - rect.top) / HOUR_PX + h0;
        var step = (cfg.durationMin || 30) / 60;
        var t = Math.floor(hoursFromTop / step) * step;
        var d = new Date(Number(col.getAttribute('data-day'))); d.setHours(Math.floor(t), Math.round((t % 1) * 60), 0, 0);
        $('book-when').value = toLocalInput(d); $('book-msg').textContent = 'Hueco elegido: ' + d.toLocaleString('es-CO', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
        $('book-contact').focus();
      };
    });
    $('cal-grid').querySelectorAll('.cal-ev').forEach(function (ev) { ev.onclick = function (e) { e.stopPropagation(); showApptPop(Number(ev.getAttribute('data-id')), e.clientX, e.clientY); }; });
    // desplazar a la primera hora de atención
    var firstOpen = Math.min.apply(null, hours.map(function (h) { return hm(h[0]); }));
    $('cal-grid').scrollTop = Math.max(0, (firstOpen - h0) * HOUR_PX - 8);
  }
  function showApptPop(id, x, y) {
    var a = cal.appts.find(function (z) { return z.id === id; }); if (!a) return;
    var pop = $('cal-pop');
    pop.innerHTML = '<b>' + esc(a.contactName || short(a.userId)) + '</b><span class="small muted">' + esc(a.label || '') + ' · ' + esc(a.service) + (a.location ? ' · ' + esc(a.location) : '') + '</span>' + (a.notes ? '<span class="small">' + esc(a.notes) + '</span>' : '') +
      '<span class="chip">' + esc(a.status) + '</span><div class="acts">' +
      (a.status === 'confirmada' ? '<button class="btn sm" data-act="completada">Asistió</button><button class="btn sm" data-act="no_asistio">No asistió</button><button class="btn sm danger" data-act="cancelada">Cancelar</button>' : '') +
      '<button class="btn sm" data-open="1">Chat</button><button class="btn sm" data-close="1">Cerrar</button></div>';
    pop.hidden = false;
    var w = 280, h = pop.offsetHeight || 160;
    pop.style.left = Math.min(x + 8, window.innerWidth - w - 12) + 'px'; pop.style.top = Math.min(y + 8, window.innerHeight - h - 12) + 'px';
    pop.querySelectorAll('[data-act]').forEach(function (b) { b.onclick = function () { api('/appointments/' + a.id, { method: 'PATCH', body: { status: b.getAttribute('data-act') } }).then(function () { pop.hidden = true; loadCalendar(); }); }; });
    pop.querySelector('[data-open]').onclick = function () { pop.hidden = true; go('inbox'); openContact(a.userId); };
    pop.querySelector('[data-close]').onclick = function () { pop.hidden = true; };
  }
  document.addEventListener('click', function (e) { var pop = $('cal-pop'); if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('.cal-ev')) pop.hidden = true; });
  function renderAgenda() {
    var list = cal.appts.filter(function (a) { return a.startsAt >= cal.start.getTime() && a.startsAt < addDays(cal.start, 7).getTime(); });
    if (!list.length) { $('cal-list').innerHTML = '<div class="empty">Sin citas esta semana.</div>'; return; }
    var byDay = {};
    list.forEach(function (a) { var day = new Date(a.startsAt).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }); (byDay[day] = byDay[day] || []).push(a); });
    $('cal-list').innerHTML = Object.keys(byDay).map(function (day) {
      return '<div class="day"><h3>' + esc(day) + '</h3>' + byDay[day].map(function (a) {
        return '<div class="appt ' + a.status + '"><span class="t">' + hhmm(a.startsAt) + '</span><span class="grow"><b>' + esc(a.contactName || short(a.userId)) + '</b> <span class="muted small">' + esc(a.service) + (a.notes ? ' · ' + esc(a.notes) : '') + '</span></span>' +
          (a.status === 'confirmada' ? '<button class="btn sm" data-act="completada" data-id="' + a.id + '">Asistió</button><button class="btn sm" data-act="no_asistio" data-id="' + a.id + '">No asistió</button><button class="btn sm danger" data-act="cancelada" data-id="' + a.id + '">Cancelar</button>' : '<span class="chip">' + a.status + '</span>') +
          '<button class="btn sm" data-open="' + esc(a.userId) + '">Chat</button></div>';
      }).join('') + '</div>';
    }).join('');
    $('cal-list').querySelectorAll('[data-act]').forEach(function (b) { b.onclick = function () { api('/appointments/' + b.getAttribute('data-id'), { method: 'PATCH', body: { status: b.getAttribute('data-act') } }).then(loadCalendar); }; });
    $('cal-list').querySelectorAll('[data-open]').forEach(function (b) { b.onclick = function () { go('inbox'); openContact(b.getAttribute('data-open')); }; });
  }
  $('cal-week-btn').onclick = function () { cal.mode = 'week'; helpSet('aiva.cal.mode', 'week'); renderCalendar(); };
  $('cal-agenda-btn').onclick = function () { cal.mode = 'agenda'; helpSet('aiva.cal.mode', 'agenda'); renderCalendar(); };
  $('cal-prev').onclick = function () { cal.start = addDays(cal.start, -7); loadCalendar(); };
  $('cal-next').onclick = function () { cal.start = addDays(cal.start, 7); loadCalendar(); };
  $('cal-today').onclick = function () { cal.start = startOfWeek(new Date()); loadCalendar(); };
  $('book-btn').onclick = function () {
    var userId = $('book-contact').value, when = $('book-when').value; if (!userId || !when) { $('book-msg').textContent = 'Elige contacto y fecha.'; return; }
    api('/appointments', { method: 'POST', body: { userId: userId, startsAt: new Date(when).toISOString(), notes: $('book-notes').value } }).then(function (r) { $('book-msg').textContent = r.error ? 'Error: ' + r.error : 'Cita agendada.'; if (!r.error) $('book-notes').value = ''; loadCalendar(); });
  };

  // ---------- análisis ----------
  function bindExport() {
    [['exp-contactos', 'contactos'], ['exp-citas', 'citas']].forEach(function (p) {
      $(p[0]).onclick = function () {
        var day = new Date().toISOString().slice(0, 10);
        $(p[0]).disabled = true;
        $('exp-msg').textContent = 'Preparando…';
        download('/export/' + p[1], p[1] + '-' + day + '.csv')
          .then(function () { $('exp-msg').textContent = 'Descargado: ' + p[1] + '-' + day + '.csv'; })
          .catch(function () { $('exp-msg').textContent = 'No se pudo descargar.'; })
          .then(function () { $(p[0]).disabled = false; });
      };
    });
  }
  function loadAnalysis() {
    cargarSeries();
    api('/stats').then(function (s) {
      var tiles = [
        { n: s.total, l: 'Contactos', f: 'all' },
        { n: s.unread, l: 'Mensajes sin leer', f: 'unread' },
        { n: s.hot, l: 'Prospectos claros', f: 'hot' },
        { n: s.human, l: 'Atendidos por una persona', f: 'human' },
        // Por papel, no por nombre: en un negocio de soporte no existe "interesado" ni "cita_agendada".
        { n: s.byStage[etapaCon('interes')] || 0, l: state.stageLabels[etapaCon('interes')] || 'Interesados', f: 'stage:' + etapaCon('interes') },
        { n: s.byStage[etapaCon('cita')] || 0, l: state.stageLabels[etapaCon('cita')] || 'Con cita', f: 'stage:' + etapaCon('cita') },
        { n: s.upcomingAppointments, l: 'Citas en los próximos 7 días', v: 'calendar' },
        { n: s.messagesToday, l: 'Mensajes de clientes (24 h)', f: 'all' },
      ];
      $('tiles').innerHTML = tiles.map(function (t, i) { return '<button class="tile" data-i="' + i + '"><b>' + t.n + '</b><span>' + esc(t.l) + '</span><span class="go">ver →</span></button>'; }).join('');
      $('tiles').querySelectorAll('.tile').forEach(function (b) { b.onclick = function () { var t = tiles[Number(b.getAttribute('data-i'))]; if (t.v) go(t.v); else go('inbox', { filter: t.f }); }; });
      var max = Math.max(1, s.total);
      $('funnel').innerHTML = Object.keys(s.stageLabels).map(function (k) { var n = s.byStage[k] || 0; return '<div class="f" data-f="stage:' + k + '"><span>' + esc(s.stageLabels[k]) + '</span><div class="bar"><i style="width:' + Math.round((n / max) * 100) + '%"></i></div><b>' + n + '</b></div>'; }).join('');
      $('funnel').querySelectorAll('.f').forEach(function (f) { f.onclick = function () { go('inbox', { filter: f.getAttribute('data-f') }); }; });
      bindExport();
      var sent = s.sentiments || {};
      $('sentiments').innerHTML = ['positivo', 'neutral', 'negativo'].map(function (k) { return '<div>' + sentIcon(k) + ': <b>' + (sent[k] || 0) + '</b></div>'; }).join('') + '<div class="muted">Puntaje promedio: ' + s.avgScore + '</div>';
    });
  }

  // ---------- agente ----------
  function usd(n) { return n === null || n === undefined ? 's/p' : '$' + (n < 0.01 ? n.toFixed(4) : n < 1 ? n.toFixed(3) : n.toFixed(2)); }
  var TASKS = { light: 'Responder (liviano)', heavy: 'Responder (pesado)', gate: 'Clasificar mensaje', analysis: 'Análisis y puntaje', when: 'Interpretar fechas' };
  function usagePanel(u) {
    if (!u.rows.length) return '<div class="panel"><b>Consumo de IA · 7 días</b><div class="small muted">Sin llamadas a modelos en los últimos 7 días.</div></div>';
    var rows = u.rows.map(function (r) {
      return '<tr><td>' + esc(TASKS[r.task] || r.task) + '</td><td>' + esc((r.engine === 'openai' ? '' : r.engine + ' · ') + r.model) + '</td><td class="n">' + r.calls + '</td><td class="n">' + Math.round(r.inputTokens / r.calls) + ' / ' + Math.round(r.outputTokens / r.calls) + '</td><td class="n">' + usd(r.costUsd) + '</td></tr>';
    }).join('');
    return '<div class="panel"><b>Consumo de IA · 7 días</b>' +
      '<div>' + usd(u.totalUsd) + ' en total' + (u.usdPerConversation !== null ? ' · ' + usd(u.usdPerConversation) + ' por conversación · ' + usd(u.usdPerMessage) + ' por mensaje del cliente' : '') + '</div>' +
      '<table class="usage"><thead><tr><th>Tarea</th><th>Modelo</th><th class="n">Llamadas</th><th class="n">Tokens por llamada (entrada / salida)</th><th class="n">Costo</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="small muted">Costo estimado con la tarifa estándar de OpenAI' + (u.unpriced ? ' (hay modelos sin precio conocido: el total se queda corto)' : '') + '. Los modelos locales no cuestan.</div></div>';
  }
  function calendarPanel(cfg) {
    var f = cfg.feed;
    var busy = cfg.busy.length
      ? '<ul>' + cfg.busy.map(function (s) { return '<li>' + (s.ok ? '✓ ' : '✗ ') + esc(s.label) + ' · ' + (s.ok ? s.intervals + ' eventos próximos' + (s.syncedAt ? ', leído ' + new Date(s.syncedAt).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' }) : '') : esc(s.error || 'sin leer todavía')) + '</li>'; }).join('') + '</ul><div class="small muted">Sus eventos ocupan la agenda: el bot no ofrece esas horas. Se leen cada 5 minutos.</div>'
      : '<div class="small muted">' + esc(state.agentName || 'El asistente') + ' todavía no ve tu calendario, así que puede ofrecer horas en las que ya estás ocupado. Se conecta una vez y queda: pídelo y lo dejamos listo.</div>';
    return '<div class="panel"><b>Calendario</b>' +
      '<div class="small">Suscríbete desde Google Calendar, Outlook o Apple Calendar para ver las citas. El enlace es secreto: quien lo tenga ve nombres y teléfonos.</div>' +
      // Secreto de larga vida: enmascarado por defecto; "Copiar" es la acción principal y rara vez hay que verlo.
      '<div class="feed-row"><input id="feed-url" type="password" readonly value="' + esc(f.https) + '" aria-label="Enlace secreto de suscripción"><button class="btn primary" id="feed-copy">Copiar enlace</button><button class="btn sm" id="feed-show" aria-pressed="false">Mostrar</button><a class="btn sm" href="' + esc(f.webcal) + '">Abrir en Apple Calendar</a></div>' +
      (f.public ? '' : '<div class="small muted">Este enlace solo funciona dentro de este equipo. Para verlo en Google o en Outlook hace falta la dirección pública: avísanos y la dejamos lista.</div>') +
      '<b class="small">Calendarios que bloquean la agenda</b>' + busy + '</div>';
  }

  // ---------- ayuda: tutorial rápido ----------
  // Los pasos llevan a la pantalla donde se hace cada cosa; "Ya lo hice" se recuerda en este navegador.
  function helpGet(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function helpSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function helpContent(a) {
    var ag = a.agent.name, biz = a.business.name, verify = a.agent.verifyPhrase;
    return {
      steps: [
        { view: 'today', go: 'Ir a Hoy', title: 'Empieza el día en Hoy', text: 'Arriba está lo que alguien espera: preguntas por verificar, clientes sin respuesta y quien pidió hablar con una persona. Si Hoy está vacío, ' + ag + ' está atendiendo todo.' },
        { view: 'today', go: 'Ir a Hoy', title: 'Responde lo que ' + ag + ' no sabía', text: 'Cuando no sabe algo, ' + ag + ' le dice al cliente «' + verify + '». En Por verificar escribe la respuesta y dale Enviar respuesta: le llega por el mismo chat. Con «Agregar a la información» marcado, la próxima vez responde solo.' },
        { view: 'inbox', go: 'Ir a Conversaciones', title: 'Toma una conversación cuando quieras', text: 'El switch «Responde: ' + ag + ' | Tú» decide quién contesta. En Tú, ' + ag + ' se calla y escribes tú; vuelve a ' + ag + ' cuando termines. Escribir a mano también te pasa la conversación.' },
        { view: 'profile', go: 'Ir a Perfil', title: 'Llena el Perfil de ' + biz, text: 'Dirección, horarios, pagos, precios… Lo que llenes, ' + ag + ' lo dice al instante. Lo que quede vacío sale como «Por confirmar» y no se lo inventa.' },
        { view: 'pipeline', go: 'Ir a Prospectos', title: 'Sigue a tus prospectos', text: 'Cada tarjeta es un cliente en su etapa. Arrástrala o usa «Mover a…», que también funciona en el celular. Tocar el nombre abre la conversación.' },
        { view: 'channels', go: 'Ir a Canales', title: 'Revisa por dónde llegan tus clientes', text: 'En Canales ves si WhatsApp y el chat del sitio están conectados y qué falta. WhatsApp oficial se configura ahí mismo, en Credenciales.' },
      ],
      faq: [
        ['¿Cómo le devuelvo la conversación a ' + ag + '?', 'En la conversación, pon el switch en «' + ag + '». Desde ese momento vuelve a responder solo.'],
        ['¿Qué hago con «Recordar a mano»?', 'Son citas de mañana cuyo recordatorio no pudo salir solo (por ejemplo, el cliente llegó por el chat del sitio). «Abrir WhatsApp» abre el chat con el mensaje ya escrito; después dale «Ya se lo recordé».'],
        ['¿Para qué sirve «¿Cómo les fue?» en Hoy?', 'Cuando una cita ya pasó, marca si el cliente vino, no vino o compró. Así el tablero sabe cómo terminó cada prospecto y, con el tiempo, el puntaje se ajusta a lo que de verdad pasa en el negocio.'],
        ['¿Qué significan «Confirmó» y «No puede» en una cita?', 'Es lo que respondió el cliente al recordatorio. Si no puede, ' + ag + ' ya le ofreció moverla o cancelarla, y te avisa.'],
        ['¿Por qué no puedo escribirle a un cliente de WhatsApp oficial?', 'WhatsApp solo deja escribir hasta 24 horas después del último mensaje del cliente. Pasado ese tiempo, toca esperar a que vuelva a escribir o usar una plantilla aprobada por Meta. El tablero lo avisa antes de que escribas.'],
        ['¿Qué pasa si dejo algo del Perfil vacío?', 'Queda «Por confirmar». Si un cliente pregunta por eso, ' + ag + ' no lo supone: responde «' + verify + '» y la pregunta te llega a Hoy.'],
        ['¿Cómo le enseño a ' + ag + ' una frase que no entendió?', 'En Agente › Frases que no entendimos, dale «Enseñar» y escribe qué quiere decir (por ejemplo, «a la hora del cafecito» quiere decir «a las 3»). Solo se guarda si con eso ya la entiende.'],
        ['¿«Caliente» y «Prospecto claro» son lo mismo?', 'Sí: es el mismo puntaje. En tarjetas y avisos se dice con temperatura (frío, tibio, caliente); en la ficha, con el veredicto. Los colores coinciden.'],
        ['En el celular, ¿dónde están Perfil, Canales o Salir?', 'En «Más», el último botón de la barra de abajo: ahí están Análisis, Perfil, Agente, Canales, Lo que sabe, Ayuda, el tema, el sonido y Salir.'],
        ['¿Qué es «Lo que sabe»?', 'La información que ' + ag + ' tiene de ' + biz + ': el catálogo y los textos del negocio. Sirve para buscar qué sabe de un tema.'],
      ],
      never: ['Inventar precios, fechas, políticas o productos: lo que no sabe, lo verifica con el equipo.', 'Elegir una fecha por su cuenta: las citas salen siempre de la agenda real.', 'Cancelar o mover una cita sin que el cliente lo confirme.', 'Escribir por WhatsApp oficial fuera de las 24 horas sin plantilla.', 'Seguir respondiendo cuando una persona del equipo tomó la conversación.'],
    };
  }
  function loadHelp() {
    helpSet('aiva.help.seen', true);
    api('/agent').then(function (a) {
      var h = helpContent(a), done = helpGet('aiva.help.done') || {};
      var count = h.steps.filter(function (s, i) { return done[i]; }).length;
      $('help').innerHTML =
        '<div class="panel"><b>Tutorial rápido</b><div class="small muted" id="help-progress">' + count + ' de ' + h.steps.length + ' hechos</div>' +
        h.steps.map(function (s, i) {
          return '<div class="help-step' + (done[i] ? ' done' : '') + '" data-step="' + i + '"><span class="n" aria-hidden="true">' + (done[i] ? '✓' : i + 1) + '</span><h3>' + esc(s.title) + '</h3><p>' + esc(s.text) + '</p>' +
            '<div class="feed-row"><button class="btn" data-go="' + s.view + '">' + esc(s.go) + '</button><button class="btn" data-done="' + i + '" aria-pressed="' + Boolean(done[i]) + '">' + (done[i] ? 'Hecho ✓' : 'Ya lo hice') + '</button></div></div>';
        }).join('') + '</div>' +
        '<div class="panel help-faq"><b>Preguntas frecuentes</b>' + h.faq.map(function (q) { return '<details><summary>' + esc(q[0]) + '</summary><p>' + esc(q[1]) + '</p></details>'; }).join('') + '</div>' +
        '<div class="panel"><b>Lo que ' + esc(a.agent.name) + ' nunca hace</b><ul class="ch-steps">' + h.never.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
      $('help').querySelectorAll('[data-go]').forEach(function (b) { b.onclick = function () { go(b.getAttribute('data-go')); }; });
      $('help').querySelectorAll('[data-done]').forEach(function (b) {
        b.onclick = function () {
          var i = b.getAttribute('data-done'), d = helpGet('aiva.help.done') || {};
          d[i] = !d[i]; helpSet('aiva.help.done', d); loadHelp();
        };
      });
    });
  }
  // Primera vez: un aviso en Hoy que lleva al tutorial (se va al abrir Ayuda o con "No mostrar más").
  function helpBanner() {
    if (helpGet('aiva.help.seen')) return '';
    return '<div class="panel help-first"><span class="grow"><b>¿Primera vez aquí?</b> <span class="small">El tutorial rápido te muestra lo esencial en dos minutos.</span></span>' +
      '<button class="btn primary" data-go="help">Ver tutorial</button><button class="btn" id="help-hide">No mostrar más</button></div>';
  }

  // ---------- perfil del negocio ----------
  // Lo confirmado es lo que el bot dice; lo vacío queda "por confirmar" (si preguntan, el bot dice que lo verifica).
  function loadProfile() {
    loadHistorial(); api('/profile').then(function (d) { state.profile = d; renderProfile(); }); }
  function profGet(p, k) { return k.split('.').reduce(function (o, x) { return o ? o[x] : undefined; }, p); }
  function profSet(p, k, v) { var ks = k.split('.'), o = p; for (var i = 0; i < ks.length - 1; i++) { o[ks[i]] = o[ks[i]] || {}; o = o[ks[i]]; } o[ks[ks.length - 1]] = v; }
  function profField(d, f, i) {
    var v = profGet(d.profile, f.key), id = 'pf-' + i, note = d.profile.notes && d.profile.notes[f.key];
    if (f.bool) return '<label class="prof-check" for="' + id + '"><input type="checkbox" id="' + id + '" data-key="' + f.key + '"' + (v ? ' checked' : '') + '> ' + esc(f.label) + '</label>';
    var empty = !String(v || '').trim();
    var input = f.long ? '<textarea id="' + id + '" data-key="' + f.key + '" rows="2">' + esc(v || '') + '</textarea>' : '<input type="text" id="' + id + '" data-key="' + f.key + '" value="' + esc(v || '') + '">';
    return '<div class="prof-field"><div class="lbl"><label class="small" for="' + id + '"><b>' + esc(f.label) + '</b></label>' + (empty ? '<span class="chip v-posible">Por confirmar</span>' : '') + '</div>' + input +
      (f.hint ? '<div class="small muted">' + esc(f.hint) + '</div>' : '') + (note ? '<div class="prof-note">Nota: ' + esc(note) + '</div>' : '') + '</div>';
  }
  function profExtra(x, i, notes) {
    var note = notes && notes[x.title];
    return '<div class="prof-extra" data-extra="' + i + '"><input type="text" aria-label="Dato" value="' + esc(x.title) + '" placeholder="Qué dato (por ejemplo: Tallas)"><button class="btn sm" type="button" data-rm="' + i + '">Quitar</button>' +
      '<textarea rows="2" aria-label="' + esc(x.title || 'Detalle') + '" placeholder="Vacío: queda por confirmar">' + esc(x.text) + '</textarea>' + (note ? '<div class="prof-note" style="grid-column:1/-1">Nota: ' + esc(note) + '</div>' : '') + '</div>';
  }
  // Lo que aprendimos de sus chats: las preguntas que más le hacen al negocio, para llenar el Perfil con lo que
  // sus clientes de verdad preguntan. Del historial salen las preguntas; las respuestas las pone el equipo.
  function loadHistorial() {
    return api('/historial').then(function (h) {
      state.historial = h;
      renderHistorial();
    });
  }
  function renderHistorial() {
    var h = state.historial;
    if (!h || !$('hist')) return;
    var r = h.resumen || {};
    var nuevos = (h.temas || []).filter(function (t) { return t.estado === 'nuevo'; });
    if (!r.mensajes) {
      $('hist').innerHTML = '<div class="panel"><b>¿Ya tienen conversaciones por WhatsApp?</b>' +
        '<div class="small muted">De ahí salen las preguntas que más les hacen, para no llenar este perfil adivinando. ' +
        'En WhatsApp: abre el chat › ⋮ › Más › <b>Exportar chat</b> › Sin archivos multimedia, y sube el .txt.</div>' +
        '<div class="feed-row" style="margin-top:8px"><input type="file" id="hist-file" accept=".txt" style="max-width:260px">' +
        '<button class="btn sm" id="hist-subir">Leer el chat</button></div>' +
        '<div class="small muted">No se guarda como información del negocio: de ahí solo salen preguntas y el tono. ' +
        'Los precios y las políticas se escriben aquí abajo, que son los de hoy.</div>' +
        '<div class="small" id="hist-msg" role="status"></div></div>';
    } else {
      $('hist').innerHTML = '<div class="panel"><b>Lo que aprendimos de sus chats</b>' +
        '<div class="small muted">' + r.mensajes + ' mensajes de ' + r.chats + ' conversaciones' +
          (r.desde ? ', desde ' + new Date(r.desde).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }) : '') +
          '. Nada de esto es información del negocio: son las preguntas que le hacen.</div>' +
        (nuevos.length
          ? '<div class="small" style="margin-top:8px">Lo que más preguntan. <b>Agregar al perfil</b> lo deja como dato por confirmar, para que escribas la respuesta de hoy.</div>' +
            nuevos.map(function (t, i) {
              return '<div class="feed-row" style="margin-top:8px;align-items:flex-start" data-tema="' + i + '">' +
                '<span class="chip">' + t.veces + '×</span>' +
                '<span class="grow"><b>' + esc(t.titulo) + '</b><div class="small muted">' + esc(t.ejemplos.slice(1).join(' · ').slice(0, 120)) + '</div></span>' +
                '<button class="btn sm primary" data-ok="' + i + '">Agregar al perfil</button>' +
                '<button class="btn sm" data-no="' + i + '">No aplica</button></div>';
            }).join('')
          : '<div class="ok" style="margin-top:8px">Ya revisaste todos los temas.</div>') +
        ((h.expresiones || []).length
          ? '<div style="margin-top:12px"><b>Cómo hablan sus clientes</b>' +
            '<div class="small muted">Frases que usan y el asistente todavía no entiende. Pasan a <b>Agente › Frases que no entendimos</b>, ' +
            'donde les pones el significado y se guardan solo si con eso ya se entienden.</div>' +
            '<ul class="timeline">' + h.expresiones.slice(0, 6).map(function (e) {
              return '<li>' + (e.veces > 1 ? '<b>' + e.veces + '×</b> ' : '') + esc(e.texto) +
                (e.pista ? ' <span class="chip v-posible">' + esc(e.pista) + '</span>' : '<span class="chip">fecha</span>') + '</li>';
            }).join('') + '</ul>' +
            '<div class="feed-row"><button class="btn sm" id="hist-expr">Llevarlas a «Frases que no entendimos»</button></div></div>'
          : '') +
        (h.estilo && h.estilo.length
          ? '<div style="margin-top:12px"><b>Así contestan ustedes</b><div class="small muted">Ejemplos sin cifras, para afinar el tono del asistente. Los precios y plazos nunca salen de aquí.</div>' +
            '<ul class="timeline">' + h.estilo.slice(0, 4).map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul></div>'
          : '') +
        // Llevarse lo aprendido: es lo único de aiva que no se puede volver a escribir a mano.
        '<div class="feed-row" style="margin-top:12px"><b class="small">Llevárselo a otra instancia</b></div>' +
        '<div class="feed-row"><button class="btn sm" id="ap-bajar">Exportar todo</button>' +
        '<button class="btn sm" id="ap-bajar-limpio">Exportar sin conversaciones</button>' +
        '<button class="btn sm" id="ap-subir">Traer de otra instancia…</button></div>' +
        '<div class="small muted">«Sin conversaciones» lleva solo los temas y lo que ya decidieron: no salen datos de ningún cliente final.</div>' +
        '<div class="small" id="ap-msg" role="status"></div>' +
        '<div class="feed-row" style="margin-top:10px"><button class="btn sm primary" id="hist-tablero">Traer estas conversaciones al tablero</button>' +
        '<button class="btn sm" id="hist-borrar">Borrar el historial importado</button></div>' +
        '<div class="small muted">Traerlas crea una ficha por conversación en <b>Conversaciones</b>, para verles la pista. Se quitan igual de fácil.</div>' +
        '<div class="small" id="hist-msg" role="status"></div></div>';
    }
    if ($('hist-subir')) $('hist-subir').onclick = subirChat;
    if ($('hist-expr')) $('hist-expr').onclick = function () {
      $('hist-expr').disabled = true;
      api('/historial/expresiones', { method: 'POST' }).then(function (r) {
        $('hist-msg').textContent = r.llevadas + ' frases quedaron en Agente › Frases que no entendimos, para enseñarlas.';
      });
    };
    var bajarAprendizaje = function (conConversaciones) {
      // Se descarga por fetch y no por enlace: así el token va en la cabecera y no en la dirección.
      fetch(BASE + '/admin/api/historial/exportar' + (conConversaciones ? '' : '?conversaciones=no'), { headers: { 'x-admin-token': state.token } })
        .then(function (r) { return r.blob(); })
        .then(function (b) {
          var a = document.createElement('a');
          a.href = URL.createObjectURL(b);
          a.download = 'aprendizaje' + (conConversaciones ? '' : '-sin-conversaciones') + '.json';
          a.click();
          setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
          $('ap-msg').textContent = 'Descargado.';
        })
        .catch(function () { $('ap-msg').textContent = 'No se pudo exportar.'; });
    };
    if ($('ap-bajar')) $('ap-bajar').onclick = function () { bajarAprendizaje(true); };
    if ($('ap-bajar-limpio')) $('ap-bajar-limpio').onclick = function () { bajarAprendizaje(false); };
    if ($('ap-subir')) $('ap-subir').onclick = function () {
      var campo = document.createElement('input');
      campo.type = 'file'; campo.accept = '.json,application/json';
      campo.onchange = function () {
        var f = campo.files && campo.files[0];
        if (!f) return;
        f.text().then(function (txt) {
          var datos;
          try { datos = JSON.parse(txt); } catch (e) { $('ap-msg').textContent = 'Ese archivo no es un aprendizaje de aiva.'; return; }
          var mandar = function (deOtroCliente) {
            api('/historial/importar-aprendizaje', { method: 'POST', body: { aprendizaje: datos, deOtroCliente: deOtroCliente } }).then(function (r) {
              if (r && r.otroCliente && !deOtroCliente) {
                if (confirm(r.error + '\n\n¿Lo traigo de todos modos?')) mandar(true);
                return;
              }
              if (r && r.error) { $('ap-msg').textContent = r.error; return; }
              $('ap-msg').textContent = 'Traído: ' + r.conversaciones + ' mensajes y ' + r.temas + ' temas decididos.';
              loadHistorial();
            });
          };
          mandar(false);
        });
      };
      campo.click();
    };
    if ($('hist-tablero')) $('hist-tablero').onclick = function () {
      var b = this; b.disabled = true; b.textContent = 'Trayendo…';
      api('/historial/al-tablero', { method: 'POST' }).then(function (r) {
        b.disabled = false; b.textContent = 'Traer estas conversaciones al tablero';
        $('hist-msg').textContent = r && r.error
          ? r.error
          : r.fichas + ' conversaciones y ' + r.mensajes + ' mensajes están ya en Conversaciones.';
      });
    };
    if ($('hist-borrar')) $('hist-borrar').onclick = function () {
      api('/historial', { method: 'DELETE' }).then(function () { loadHistorial(); });
    };
    $('hist').querySelectorAll('[data-ok],[data-no]').forEach(function (b) {
      b.onclick = function () {
        var ok = b.hasAttribute('data-ok');
        var t = nuevos[Number(b.getAttribute(ok ? 'data-ok' : 'data-no'))];
        b.disabled = true;
        api('/historial/tema', { method: 'POST', body: { clave: t.clave, titulo: t.titulo, estado: ok ? 'aceptado' : 'descartado' } })
          .then(function () { return loadProfile(); });
      };
    });
  }
  function subirChat() {
    var f = $('hist-file').files[0];
    if (!f) { $('hist-msg').textContent = 'Elige el archivo .txt que exportaste de WhatsApp.'; return; }
    $('hist-msg').textContent = 'Leyendo…';
    f.text().then(function (texto) {
      return api('/historial/importar', { method: 'POST', body: { texto: texto, delNegocio: [state.bizName], chat: f.name.replace(/\.txt$/i, '') } });
    }).then(function (r) {
      if (r.error) { $('hist-msg').textContent = r.error; return; }
      $('hist-msg').textContent = r.nuevos + ' mensajes leídos.';
      loadHistorial();
    });
  }
  function renderProfile(msg) {
    var d = state.profile, sections = [];
    d.fields.forEach(function (f, i) { var s = sections.filter(function (x) { return x.name === f.section; })[0]; if (!s) sections.push(s = { name: f.section, html: '' }); s.html += profField(d, f, i); });
    var pending = d.pending.length
      ? '<b>' + d.pending.length + (d.pending.length === 1 ? ' dato por confirmar' : ' datos por confirmar') + '</b><div class="small">Si un cliente pregunta por esto, ' + esc(d.agentName) + ' no lo supone: responde «' + esc(d.verifyPhrase) + '» y te llega a Hoy › Por verificar.</div><div class="dict-chips">' + d.pending.map(function (x) { return '<span class="chip v-posible">' + esc(x) + '</span>'; }).join('') + '</div>'
      : '<b>Todo confirmado</b><div class="small">' + esc(d.agentName) + ' responde con estos datos.</div>';
    $('profile').innerHTML = '<div class="panel">' + pending + '</div>' + '<div id="hist"></div>' +
      sections.map(function (s) { return '<div class="panel prof"><b>' + esc(s.name) + '</b>' + s.html + '</div>'; }).join('') +
      '<div class="panel prof"><b>Otros datos</b><div class="small muted">Lo propio de este negocio: tallas, tiempos de entrega, lo que venden o no.</div><div id="pf-extras">' +
      d.profile.extras.map(function (x, i) { return profExtra(x, i, d.profile.notes); }).join('') + '</div><div class="feed-row"><button class="btn" type="button" id="pf-add">Agregar dato</button></div></div>' +
      '<div class="panel"><div class="feed-row"><button class="btn primary" id="pf-save">Guardar perfil</button></div><div id="pf-msg" class="small" role="status">' + (msg || '') + '</div><div class="small muted">Se guarda al instante, con copia de lo anterior.</div></div>';
    $('pf-add').onclick = function () {
      var box = $('pf-extras'), i = box.children.length;
      box.insertAdjacentHTML('beforeend', profExtra({ title: '', text: '' }, i, null));
      bindExtraRemove(); box.lastElementChild.querySelector('input').focus();
    };
    bindExtraRemove();
    $('pf-save').onclick = saveProfileForm;
    renderHistorial(); // el panel vive dentro del Perfil: se pinta cuando el Perfil ya está en pantalla
  }
  function bindExtraRemove() { $('profile').querySelectorAll('[data-rm]').forEach(function (b) { b.onclick = function () { b.closest('.prof-extra').remove(); }; }); }
  function saveProfileForm() {
    var p = JSON.parse(JSON.stringify(state.profile.profile));
    $('profile').querySelectorAll('[data-key]').forEach(function (el) { profSet(p, el.getAttribute('data-key'), el.type === 'checkbox' ? el.checked : el.value); });
    p.extras = [].map.call($('profile').querySelectorAll('.prof-extra'), function (row) { return { title: row.querySelector('input').value.trim(), text: row.querySelector('textarea').value }; }).filter(function (x) { return x.title; });
    var btn = $('pf-save'); btn.disabled = true;
    api('/profile', { method: 'POST', body: { profile: p } }).then(function (r) {
      if (r.errors) { $('pf-msg').innerHTML = '<span class="ch-err">No se guardó:</span><ul class="ch-steps">' + r.errors.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>'; return; }
      state.profile.profile = r.profile; state.profile.pending = r.pending;
      state.bizName = r.profile.identity.name || state.bizName;
      renderProfile('Guardado: ' + esc(state.profile.agentName) + ' ya lo usa.' + (r.indexed ? '' : ''));
      $('pf-msg').scrollIntoView({ block: 'nearest' });
    }).finally(function () { if ($('pf-save')) $('pf-save').disabled = false; });
  }

  // ---------- respaldo de la base ----------
  function backupLine(bk) {
    if (!bk.last) return 'Todavía no hay respaldos: el primero se hace un minuto después de arrancar.';
    return 'Último: hace ' + rel(bk.last.at) + ' (' + Math.max(1, Math.round(bk.last.bytes / 1024)) + ' KB) · ' + bk.count + (bk.count === 1 ? ' copia' : ' copias') + ' en ' + bk.dir;
  }
  function backupPanel(bk) {
    return '<div class="panel" id="backup-panel"><b>Respaldo de la base</b><div class="small" id="backup-line">' + esc(backupLine(bk)) + '</div>' +
      '<div class="small muted">Una copia al día de contactos, conversaciones y citas; se guardan las últimas 14. Tienen datos de clientes: guárdalas también fuera de este computador (por ejemplo, con Time Machine).</div>' +
      '<div class="feed-row"><button class="btn" id="backup-now">Respaldar ahora</button></div></div>';
  }
  function bindBackup() {
    $('backup-now').onclick = function () {
      var b = this; b.disabled = true; b.textContent = 'Respaldando…';
      api('/backup', { method: 'POST' }).then(function (r) {
        $('backup-line').textContent = r.error ? 'No se pudo: ' + r.error : backupLine(r);
        b.disabled = false; b.textContent = 'Respaldar ahora';
      });
    };
  }

  // ---------- frases que no entendimos ----------
  // Lo que las reglas no entendieron: se enseña como expresión del diccionario y la próxima vez se entiende sin IA.
  var MISS_KIND = { fecha: 'Fecha u hora', frase: 'Frase', cita: 'En la cita' };
  function missItem(g, i) {
    var dot = function (s) { return /\.$/.test(s) ? s : s + '.'; }; // "p. m." ya trae su punto
    var said = !g.reading ? '' : g.kind === 'cita' ? 'El flujo ' + dot(g.reading) : 'La IA entendió: ' + dot(g.reading);
    return '<div class="verify" data-mi="' + i + '"><div class="verify-q"><span class="chip">' + esc(MISS_KIND[g.kind] || g.kind) + '</span> <b>«' + esc(g.text) + '»</b>' +
      ' <span class="muted small">' + (g.count > 1 ? g.count + ' veces' + (g.people > 1 ? ', ' + g.people + ' personas' : '') + ' · ' : '') + 'hace ' + rel(g.lastAt) + '</span>' +
      (said ? '<div class="small">' + esc(said) + '</div>' : '') + '</div>' +
      '<div class="feed-row"><button class="btn primary" data-mteach>Enseñar</button><button class="btn" data-mreview>Ya lo revisé</button><button class="btn" data-mopen>Ver conversación</button></div>' +
      '<div class="miss-teach" hidden>' +
      '<label class="small" for="ms-' + i + '">Cuando un cliente diga</label><input type="text" id="ms-' + i + '" maxlength="60" value="' + esc(g.text.slice(0, 60)) + '">' +
      '<label class="small" for="mm-' + i + '">quiere decir</label><input type="text" id="mm-' + i + '" maxlength="80" value="' + esc(g.suggestion || '') + '" placeholder="' + (g.kind === 'cita' ? 'por ejemplo: la primera' : g.kind === 'fecha' ? 'por ejemplo: a las 12' : 'por ejemplo: hola') + '">' +
      '<div class="small muted">Deja solo la parte que no se entendió: así sirve también para otras frases. Antes de guardar se comprueba que ya se entienda.</div>' +
      '<div class="feed-row"><button class="btn primary" data-msave>Guardar expresión</button><button class="btn" data-mcancel>Cancelar</button></div>' +
      '<div role="status" class="small" data-mmsg></div></div></div>';
  }
  function loadMissesPanel(a) {
    api('/misses').then(function (r) {
      var groups = r.groups || [];
      $('miss-panel').innerHTML = '<b>Frases que no entendimos' + (groups.length ? ' <span class="chip">' + groups.length + '</span>' : '') + '</b>' +
        '<div class="small muted">Lo que las reglas no entendieron: fechas y frases que tuvo que interpretar la IA, y respuestas que sacaron al cliente del flujo de la cita. Enséñalas y la próxima vez ' + esc(a.agent.name) + ' las entiende sola, sin gastar IA.</div>' +
        (groups.length ? groups.map(missItem).join('') : '<div class="small muted">Nada por ahora: todo lo que llegó lo entendieron las reglas.</div>');
      $('miss-panel').querySelectorAll('[data-mi]').forEach(function (el) {
        var g = groups[Number(el.getAttribute('data-mi'))], form = el.querySelector('.miss-teach'), msg = el.querySelector('[data-mmsg]');
        var body = function () { return { kind: g.kind, key: g.key }; };
        var done = function (text) { el.innerHTML = '<div class="small">' + esc(text) + '</div>'; setTimeout(function () { loadMissesPanel(a); loadDictionaryPanel(a); }, 1800); };
        el.querySelector('[data-mteach]').onclick = function () { form.hidden = false; this.hidden = true; el.querySelector('#ms-' + el.getAttribute('data-mi')).focus(); };
        el.querySelector('[data-mcancel]').onclick = function () { form.hidden = true; el.querySelector('[data-mteach]').hidden = false; msg.textContent = ''; };
        el.querySelector('[data-mopen]').onclick = function () { go('inbox'); openContact(g.userId); };
        el.querySelector('[data-mreview]').onclick = function () {
          api('/misses/review', { method: 'POST', body: body() }).then(function () { done('Revisada: sale de la lista.'); });
        };
        el.querySelector('[data-msave]').onclick = function () {
          var b = body(), btn = this;
          b.says = el.querySelector('#ms-' + el.getAttribute('data-mi')).value;
          b.means = el.querySelector('#mm-' + el.getAttribute('data-mi')).value;
          btn.disabled = true;
          api('/misses/teach', { method: 'POST', body: b }).then(function (res) {
            if (res.ok) return done('Listo: ahora «' + res.example + '» se entiende como ' + res.reading + ', sin IA.');
            msg.innerHTML = '<span class="ch-err">No lo guardé.</span> ' + esc(res.reason || res.error || 'Algo falló.');
          }).finally(function () { btn.disabled = false; });
        };
      });
    });
  }

  // ---------- diccionario del negocio ----------
  function dictSummary(d) {
    var ex = (d.expressions || []).length;
    return d.topics.length + (d.topics.length === 1 ? ' tema' : ' temas') + ', ' + d.offerVerbs.length + (d.offerVerbs.length === 1 ? ' verbo' : ' verbos') + ' y ' + ex + (ex === 1 ? ' expresión' : ' expresiones');
  }
  function loadDictionaryPanel(a) {
    api('/dictionary').then(function (d) {
      var topics = d.topics.map(function (t) {
        return '<li><b>' + esc(t.query) + '</b><div class="dict-chips">' + t.keywords.map(function (k) { return '<span class="chip">' + esc(k) + '</span>'; }).join('') + '</div></li>';
      }).join('');
      $('dict-panel').innerHTML = '<b>Diccionario del negocio</b>' +
        '<div class="small muted">Lo que ' + esc(a.business.name) + ' le enseña a ' + esc(a.agent.name) + ' sin tocar código: temas que se responden con su información, cómo pregunta su gente por lo que ofrece y las expresiones propias de sus clientes. Se aplica al instante.</div>' +
        '<div class="small">Temas (' + d.topics.length + ')</div>' + (topics ? '<ul class="dict-list">' + topics + '</ul>' : '<div class="small muted">Todavía ninguno. Lo genérico (dónde quedan, horario, pagos, envíos) ya viene incluido.</div>') +
        '<div class="small">Verbos para preguntar por lo que ofrece (' + d.offerVerbs.length + ')</div>' + (d.offerVerbs.length ? '<div class="dict-chips">' + d.offerVerbs.map(function (v) { return '<span class="chip">' + esc(v) + '</span>'; }).join('') + '</div>' : '<div class="small muted">Solo los genéricos: tienen, venden, manejan, hacen, trabajan.</div>') +
        '<div class="small">Expresiones (' + (d.expressions || []).length + ')</div>' + ((d.expressions || []).length ? '<ul class="dict-list">' + d.expressions.map(function (x) { return '<li>«' + esc(x.says) + '» quiere decir «' + esc(x.means) + '»</li>'; }).join('') + '</ul>' : '<div class="small muted">Todavía ninguna. Se enseñan desde «Frases que no entendimos».</div>') +
        '<div class="feed-row"><button class="btn" id="dict-export">Exportar</button><button class="btn" id="dict-merge">Sumar un archivo…</button><button class="btn" id="dict-replace">Reemplazar con un archivo…</button>' +
        '<input type="file" id="dict-file" accept="application/json,.json" hidden></div>' +
        '<div id="dict-msg" role="status" class="small"></div>';
      var mode = 'merge';
      $('dict-export').onclick = function () {
        fetch(BASE + '/admin/api/dictionary/export', { headers: { 'x-admin-token': state.token } }).then(function (r) {
          var name = (/filename="([^"]+)"/.exec(r.headers.get('content-disposition') || '') || [])[1] || 'diccionario.json';
          return r.blob().then(function (b) { var u = URL.createObjectURL(b), l = document.createElement('a'); l.href = u; l.download = name; document.body.appendChild(l); l.click(); l.remove(); URL.revokeObjectURL(u); });
        });
      };
      $('dict-merge').onclick = function () { mode = 'merge'; $('dict-file').value = ''; $('dict-file').click(); };
      $('dict-replace').onclick = function () { mode = 'replace'; $('dict-file').value = ''; $('dict-file').click(); };
      var send = function (dictionary) {
        api('/dictionary/import', { method: 'POST', body: { mode: mode, dictionary: dictionary } }).then(function (r) {
          if (r.errors) { $('dict-msg').innerHTML = '<span class="ch-err">No se importó:</span><ul class="ch-steps">' + r.errors.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>'; return; }
          loadDictionaryPanel(a);
          setTimeout(function () { $('dict-msg').textContent = (mode === 'merge' ? 'Sumado' : 'Reemplazado') + ': ahora hay ' + dictSummary(r) + '.' + (r.backup ? ' La versión anterior quedó en ' + r.backup + '.' : ''); }, 300);
        });
      };
      $('dict-file').onchange = function () {
        var f = this.files && this.files[0]; if (!f) return;
        f.text().then(function (txt) {
          var incoming; try { incoming = JSON.parse(txt); } catch (e) { $('dict-msg').innerHTML = '<span class="ch-err">El archivo no es un JSON válido.</span>'; return; }
          if (mode === 'merge') return send(incoming);
          // Reemplazar cambia todo lo que hay: se confirma diciendo qué por qué (queda copia de la versión anterior).
          var n = { topics: (incoming.topics || []), offerVerbs: (incoming.offerVerbs || []) };
          $('dict-msg').innerHTML = 'Vas a reemplazar ' + dictSummary(d) + ' por ' + dictSummary(n) + ' de «' + esc(f.name) + '». La versión actual queda guardada como copia. <div class="feed-row"><button class="btn primary" id="dict-confirm">Reemplazar diccionario</button><button class="btn" id="dict-cancel">Cancelar</button></div>';
          $('dict-confirm').onclick = function () { send(incoming); };
          $('dict-cancel').onclick = function () { $('dict-msg').textContent = ''; };
        });
      };
    });
  }

  function loadAgent() {
    Promise.all([api('/agent'), api('/usage?days=7'), api('/calendar'), api('/backup')]).then(function (r) {
      var a = r[0], usage = r[1], calCfg = r[2], bk = r[3];
      var eng = Object.keys(a.engines).map(function (k) { var e = a.engines[k]; return '<li><b>' + k + '</b>: ' + (e.available ? '✓ disponible' : '✗ ' + esc(e.reason || 'no disponible')) + '</li>'; }).join('');
      var ap = a.appointments;
      $('agent').innerHTML =
        '<div class="panel"><b>' + esc(a.agent.name) + '</b> · asistente de <b>' + esc(a.business.name) + '</b><div class="muted">' + esc(a.business.description) + '</div><div class="small">Estilo: ' + esc(a.agent.style) + '</div><div class="small">Contacto humano que ofrece: ' + esc(a.business.humanContact) + '</div></div>' +
        '<div class="panel"><b>Motores</b><ul>' + eng + '</ul><div class="small muted">Modo: ' + esc(a.roles.mode) + ' · liviano: ' + esc(a.roles.light) + ' · pesado: ' + esc(a.roles.heavy) + ' · gate: ' + esc(a.roles.gate) + ' · análisis: ' + esc(a.roles.analysis) + '</div><div class="small muted">Modelos: ' + esc(a.models.chat) + ' · embeddings ' + esc(a.models.embed) + ' · nube ' + esc(a.models.openai) + '</div></div>' +
        '<div class="panel"><b>Citas</b>' + (ap.enabled ? '<div class="small">' + esc(ap.service) + (ap.location ? ' en ' + esc(ap.location) : '') + ' · ' + ap.durationMin + ' min · días ' + ap.days.join(',') + ' · ' + ap.hours.map(function (h) { return h[0] + '–' + h[1]; }).join(', ') + ' · zona ' + esc(a.timezone) + '</div>' : '<div class="muted small">Desactivadas (appointments.enabled en aiva.config.json)</div>') + '</div>' +
        '<div class="panel"><b>Análisis comercial</b><div class="small">Campos capturados además de los básicos: ' + a.crmFields.map(function (f) { return '<code>' + esc(f.name) + '</code>'; }).join(' ') + '</div></div>' +
        '<div class="panel"><b>Conocimiento indexado</b><div class="small">' + (a.docs.product || 0) + ' productos · ' + (a.docs.knowledge || 0) + ' fragmentos de información.</div></div>' +
        backupPanel(bk) + usagePanel(usage) + calendarPanel(calCfg) + '<div class="panel" id="miss-panel"></div><div class="panel" id="dict-panel"></div>';
      bindBackup();
      loadMissesPanel(a);
      loadDictionaryPanel(a);
      $('feed-copy').onclick = function () {
        var input = $('feed-url');
        var done = function () { $('feed-copy').textContent = 'Enlace copiado'; };
        (navigator.clipboard ? navigator.clipboard.writeText(input.value) : Promise.reject()).then(done, function () {
          var t = input.type; input.type = 'text'; input.select(); document.execCommand('copy'); input.type = t; done();
        });
      };
      $('feed-show').onclick = function () {
        var input = $('feed-url'), show = input.type === 'password';
        input.type = show ? 'text' : 'password'; this.textContent = show ? 'Ocultar' : 'Mostrar'; this.setAttribute('aria-pressed', String(show));
      };
    });
  }

  // ---------- canales ----------
  var CH_STATE = {
    conectado: ['Conectado', 'v-si'], conectando: ['Conectando…', 'v-posible'], esperando_qr: ['Escanea el código', 'v-posible'],
    esperando: ['Esperando mensajes', 'v-posible'], sin_configurar: ['Sin configurar', 'v-no'], apagado: ['Apagado', 'v-no'],
    error: ['Revisar', 'v-perdido'], conflicto: ['Abierto en otro sitio', 'v-perdido'], no_disponible: ['Todavía no', 'v-no']
  };
  var chTimer;
  function loadChannels() {
    clearTimeout(chTimer);
    api('/channels').then(renderChannels);
    api('/public').then(renderPublic);
  }
  // Dirección pública (el túnel): si se cae, dejan de funcionar el chat del sitio, WhatsApp oficial y el tablero en el celular.
  var PUB = { ok: ['En línea', 'v-si'], revisando: ['Revisando…', 'v-no'], fallando: ['Revisando', 'v-posible'], caida: ['No responde', 'v-perdido'], otro_servidor: ['Apunta a otro servidor', 'v-perdido'], sin_url: ['Sin dirección pública', 'v-no'] };
  function publicDetail(p) {
    if (p.state === 'ok') return 'Responde · revisada hace ' + rel(p.checkedAt) + '.';
    if (p.state === 'fallando') return 'La última revisión falló: ' + p.error + '. Si sigue fallando, se avisa en unos minutos.';
    if (p.state === 'caida') return 'No responde desde hace ' + rel(p.failingSince) + ': ' + p.error + '. Mientras tanto no funcionan el chat del sitio, WhatsApp oficial, el calendario en Google u Outlook ni el tablero desde el celular. Suele resolverse solo; si sigue así en unos minutos, avísanos.';
    if (p.state === 'otro_servidor') return 'La dirección responde, pero no desde este servidor. Revisa a dónde apunta el túnel.';
    if (p.state === 'sin_url') return 'Todavía no hay dirección pública: el chat del sitio, WhatsApp oficial y el calendario en Google u Outlook solo funcionan dentro de este equipo. Avísanos y la dejamos lista.';
    return 'Se revisa unos segundos después de arrancar y luego cada 5 minutos.';
  }
  function renderPublic(p) {
    var st = PUB[p.state] || [p.state, 'v-no'];
    $('public-status').innerHTML = '<div class="ch-head"><h2>Dirección pública</h2><span class="chip ' + st[1] + '">' + esc(st[0]) + '</span></div>' +
      (p.url ? '<div class="small"><code>' + esc(p.url) + '</code></div>' : '') +
      '<div class="small">' + esc(publicDetail(p)) + '</div>' +
      (p.url ? '<div class="feed-row"><button class="btn" id="public-check">Revisar ahora</button></div>' : '');
    if ($('public-check')) $('public-check').onclick = function () {
      this.disabled = true; this.textContent = 'Revisando…';
      api('/public/check', { method: 'POST' }).then(renderPublic);
    };
  }
  function channelStats(ch) {
    if (ch.state === 'no_disponible') return '';
    if (ch.messages7d) return ch.messages7d + (ch.messages7d === 1 ? ' mensaje' : ' mensajes') + ' de ' + ch.people7d + (ch.people7d === 1 ? ' persona' : ' personas') + ' en 7 días · el último hace ' + rel(ch.lastInboundAt);
    return ch.lastInboundAt ? 'Sin mensajes esta semana · el último hace ' + rel(ch.lastInboundAt) : 'Aún no ha llegado ningún mensaje por aquí.';
  }
  // Credenciales de WhatsApp oficial: se verifican con Meta y quedan en .env; los secretos nunca vuelven completos.
  function metaCredForm(ch) {
    var k = ch.credentials || {};
    var saved = function (tailv) { return tailv ? 'Guardado (termina en ' + tailv.replace('…', '') + '). Vacío = no cambiar' : ''; };
    return '<details class="ch-cred" id="meta-cred"' + (ch.state === 'sin_configurar' ? ' open' : '') + '><summary>Credenciales</summary>' +
      '<form id="meta-cred-form" autocomplete="off" novalidate>' +
      '<label class="small" for="mc-token">Token de acceso</label><input type="password" id="mc-token" autocomplete="off" spellcheck="false" placeholder="' + esc(saved(k.tokenTail) || 'Pega el token de acceso') + '">' +
      '<label class="small" for="mc-phone">ID del número de teléfono</label><input type="text" id="mc-phone" inputmode="numeric" spellcheck="false" value="' + esc(k.phoneId || '') + '" placeholder="Solo dígitos; no es el número de teléfono">' +
      '<label class="small" for="mc-secret">Clave secreta de la app</label><input type="password" id="mc-secret" autocomplete="off" spellcheck="false" placeholder="' + esc(saved(k.appSecretTail) || 'Configuración de la app › Básica') + '">' +
      '<label class="small" for="mc-verify">Token de verificación del webhook</label><div class="cred-row"><input type="text" id="mc-verify" spellcheck="false" value="' + esc(k.verifyToken || '') + '" placeholder="Se genera solo si lo dejas vacío"><button type="button" class="btn" id="mc-gen">Generar</button></div>' +
      '<label class="small" for="mc-version">Versión de la API</label><input type="text" id="mc-version" spellcheck="false" value="' + esc(k.version || 'v26.0') + '">' +
      '<div class="small muted">Antes de guardar se verifican con Meta. Quedan guardadas en el servidor, fuera de la base de datos, y el tablero no vuelve a mostrarlas completas.</div>' +
      '<div class="feed-row"><button type="submit" class="btn primary">Guardar y verificar</button></div>' +
      '<div class="small" id="mc-msg" role="status"></div></form></details>';
  }
  function bindMetaCred() {
    var form = $('meta-cred-form'); if (!form) return;
    $('mc-gen').onclick = function () { var a = new Uint8Array(12); crypto.getRandomValues(a); $('mc-verify').value = Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); };
    form.onsubmit = function (e) {
      e.preventDefault();
      var btn = form.querySelector('[type=submit]'); btn.disabled = true; $('mc-msg').textContent = 'Verificando con Meta…';
      api('/channels/meta/credentials', { method: 'POST', body: { token: $('mc-token').value, phoneId: $('mc-phone').value, appSecret: $('mc-secret').value, verifyToken: $('mc-verify').value, version: $('mc-version').value } }).then(function (r) {
        if (!r.ok) { $('mc-msg').innerHTML = '<span class="ch-err">No se guardó.</span> ' + esc(r.error || 'Algo falló.'); return; }
        var msg = r.verified ? 'Verificado con Meta: ' + r.verified.phone + (r.verified.name ? ' (' + r.verified.name + ')' : '') + '. Ya puedes encenderlo y registrar el webhook en Meta.' : (r.warning || 'Guardado.');
        renderChannels(r.cards, { fresh: true }); // guardado: los campos secretos quedan vacíos
        var box = $('meta-cred'); if (box) box.open = true;
        if ($('mc-msg')) $('mc-msg').textContent = msg;
      }).finally(function () { btn.disabled = false; });
    };
  }
  var credDraft = null; // lo escrito en el formulario sobrevive a los redibujos automáticos
  // ---------- A quién avisar cuando nadie está mirando ----------
  // Todo lo demás del tablero necesita la pestaña abierta. Esto es lo único que funciona con el portátil
  // cerrado, y por eso va por WhatsApp: es lo que la gente mira.
  function pintarAvisos(d) {
    if (!d || d.error) { $('avisos').innerHTML = '<div class="small muted">No se pudo cargar.</div>'; return; }
    $('avisos').innerHTML =
      '<div class="small muted">Si alguien lleva más de <b>' + d.acuerdoMin + ' min</b> esperando respuesta, le llega un WhatsApp a estos números. ' +
      'Sin números, no se avisa a nadie.</div>' +
      '<div class="feed-row" style="margin-top:8px"><input type="text" id="av-nums" placeholder="573001112233, 573009998877" value="' + esc(d.numeros.join(', ')) + '" style="min-width:260px">' +
      '<button class="btn sm primary" id="av-guardar">Guardar</button>' +
      (d.numeros.length ? '<button class="btn sm" id="av-probar">Mandar uno de prueba</button>' : '') +
      '</div><div class="small" id="av-msg" role="status"></div>';
    $('av-guardar').onclick = function () {
      var nums = $('av-nums').value.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
      api('/avisos', { method: 'PUT', body: { numeros: nums } }).then(function (r) {
        if (r && r.error) { $('av-msg').textContent = r.error; return; }
        $('av-msg').textContent = r.numeros.length ? 'Guardado: se avisará a ' + r.numeros.length + '.' : 'Guardado: no se avisará a nadie.';
        cargarAvisos();
      });
    };
    if ($('av-probar')) $('av-probar').onclick = function () {
      var b = this; b.disabled = true; b.textContent = 'Mandando…';
      api('/avisos/probar', { method: 'POST', body: {} }).then(function (r) {
        b.disabled = false; b.textContent = 'Mandar uno de prueba';
        $('av-msg').textContent = r && r.error ? r.error
          : (r.entregados ? 'Mandado a ' + r.entregados + ' de ' + r.de + '. Mira el teléfono.' : 'No salió: ¿está WhatsApp conectado?');
      });
    };
  }

  function cargarAvisos() { api('/avisos').then(pintarAvisos).catch(function () {}); }

  function renderChannels(list, opts) {
    credDraft = null;
    if ($('meta-cred-form') && !(opts && opts.fresh)) credDraft = { open: $('meta-cred').open, token: $('mc-token').value, phone: $('mc-phone').value, secret: $('mc-secret').value, verify: $('mc-verify').value, version: $('mc-version').value, msg: $('mc-msg').innerHTML };
    $('channels').innerHTML = list.map(function (ch) {
      var st = CH_STATE[ch.state] || [ch.state, 'v-no'];
      var toggle = ch.canToggle
        ? '<div class="seg" role="group" aria-label="' + esc(ch.name) + '" data-on="' + (ch.on ? 'on' : 'off') + '"><button data-ch="' + ch.id + '" data-set="1" aria-pressed="' + ch.on + '"' + (ch.on ? ' class="on"' : '') + '>Encendido</button><button data-ch="' + ch.id + '" data-set="0" aria-pressed="' + !ch.on + '"' + (ch.on ? '' : ' class="on"') + '>Apagado</button></div>'
        : '';
      var copy = ch.copy.map(function (x, i) {
        return '<label class="small muted">' + esc(x.label) + '</label><div class="feed-row"><input readonly type="' + (x.secret ? 'password' : 'text') + '" value="' + esc(x.value) + '" id="cp-' + ch.id + '-' + i + '" aria-label="' + esc(x.label) + '">' +
          '<button class="btn sm" data-copy="cp-' + ch.id + '-' + i + '">Copiar</button>' + (x.secret ? '<button class="btn sm" data-show="cp-' + ch.id + '-' + i + '" aria-pressed="false">Mostrar</button>' : '') + '</div>';
      }).join('');
      // Solo escuchar: entra todo al CRM y contesta una persona. Es lo que se usa al enchufar el WhatsApp de un
      // negocio de verdad, para mirar antes de darle voz al asistente.
      var escucha = ch.soloEscucha === undefined ? '' :
        '<div class="fila" style="gap:10px;align-items:center;margin-top:10px">' +
          '<div class="seg" role="group" aria-label="Quién contesta en ' + esc(ch.name) + '" data-on="' + (ch.soloEscucha ? 'off' : 'on') + '">' +
            '<button data-esc="' + ch.id + '" data-set="0" aria-pressed="' + !ch.soloEscucha + '"' + (ch.soloEscucha ? '' : ' class="on"') + '>Contesta Aiva</button>' +
            '<button data-esc="' + ch.id + '" data-set="1" aria-pressed="' + ch.soloEscucha + '"' + (ch.soloEscucha ? ' class="on"' : '') + '>Solo escuchar</button>' +
          '</div>' +
          '<span class="small muted">' + (ch.soloEscucha ? 'Entra todo al tablero y contestas tú. Aiva no dice nada.' : 'Aiva responde sola a quien escriba.') + '</span>' +
        '</div>';
      // Los grupos, aparte: encender el canal es una decisión del negocio; mirar los grupos es una decisión
      // sobre datos de gente que no eligió estar aquí. No van en el mismo botón.
      var losGrupos = ch.grupos === undefined ? '' :
        '<div class="fila" style="gap:10px;align-items:center;margin-top:8px">' +
          '<button class="btn sm" data-grupos="' + ch.id + '" data-set="' + (ch.grupos ? '0' : '1') + '">' +
            (ch.grupos ? 'Dejar de ver los grupos' : 'Ver también los grupos') + '</button>' +
          '<span class="small muted">' + (ch.grupos
            ? 'Aiva aprende de lo que se habla en los grupos. Nunca escribe en ellos.'
            : 'Los grupos se ignoran: ni se guardan ni se aprenden.') + '</span>' +
        '</div>';
      // Cuando WhatsApp no levanta, lo primero que hay que saber es si este servidor puede siquiera hablar con
      // WhatsApp. Desde fuera, un fallo del programa y una puerta cerrada en el alojamiento se ven igual.
      // Desvincular: la única forma de volver a recibir lo ya conversado (WhatsApp lo manda solo al emparejar)
      // y la salida del atasco si cierran la sesión desde el teléfono.
      // Traer más historial: lo que llega al vincular es solo lo reciente, y esto pide más hacia atrás sin
      // tocar la sesión. Solo tiene sentido con el número conectado.
      var masHistorial = ch.id === 'whatsapp' && ch.state === 'conectado'
        ? '<div class="fila" style="gap:10px;align-items:center;margin-top:10px">' +
            '<button class="btn sm" id="wa-mas">Traer más historial</button>' +
            '<span class="small muted">Pide conversaciones más antiguas. Llegan solas, en unos minutos.</span>' +
          '</div><div id="wa-mas-r" class="small" role="status"></div>'
        : '';
      var desvincular = ch.id === 'whatsapp' && (ch.state === 'conectado' || ch.state === 'sesion_cerrada')
        ? '<div class="fila" style="gap:10px;align-items:center;margin-top:10px">' +
            '<button class="btn sm" id="wa-desvincular">Desvincular y empezar de cero</button>' +
            '<span class="small muted">Pide un código nuevo. Al vincular otra vez vuelve a llegar lo ya conversado.</span>' +
          '</div>'
        : '';
      var salida = ch.id === 'whatsapp' && ch.state !== 'conectado'
        ? '<div class="fila" style="gap:10px;align-items:center;margin-top:10px">' +
            '<button class="btn sm" id="wa-salida">Probar la salida</button>' +
            '<span class="small muted">¿Este servidor puede hablar con WhatsApp?</span>' +
          '</div><div id="wa-salida-r" class="small" role="status"></div>'
        : '';
      var steps = ch.steps.length ? (ch.steps.length > 1 ? '<ol class="ch-steps">' + ch.steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' : '<div class="small">' + esc(ch.steps[0]) + '</div>') : '';
      var warnings = ch.warnings.map(function (w) { return '<div class="ch-warn">' + esc(w) + '</div>'; }).join('');
      return '<div class="panel" id="ch-' + ch.id + '"><div class="ch-head"><h2>' + esc(ch.name) + '</h2><span class="chip ' + st[1] + '">' + esc(st[0]) + '</span></div>' +
        '<div class="small muted">' + esc(ch.about) + '</div>' +
        (ch.detail ? '<div class="small">' + esc(ch.detail) + '</div>' : '') +
        (channelStats(ch) ? '<div class="ch-stats">' + esc(channelStats(ch)) + '</div>' : '') +
        (ch.qrSvg ? '<div class="ch-qr" role="img" aria-label="Código QR para vincular WhatsApp">' + ch.qrSvg + '</div>' : '') +
        steps + warnings + copy + toggle + escucha + losGrupos + masHistorial + desvincular + salida + '<div class="ch-err" id="ch-err-' + ch.id + '" role="status"></div>' + (ch.id === 'meta' ? metaCredForm(ch) : '') + '</div>';
    }).join('');
    if (credDraft && $('meta-cred-form')) {
      $('meta-cred').open = credDraft.open; $('mc-token').value = credDraft.token; $('mc-phone').value = credDraft.phone; $('mc-secret').value = credDraft.secret;
      $('mc-verify').value = credDraft.verify; $('mc-version').value = credDraft.version; $('mc-msg').innerHTML = credDraft.msg;
    }
    bindMetaCred();
    cargarAvisos();
    $('channels').querySelectorAll('[data-set]').forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-ch'), on = b.getAttribute('data-set') === '1';
        $('channels').querySelectorAll('[data-ch="' + id + '"]').forEach(function (x) { x.disabled = true; });
        api('/channels/' + id, { method: 'POST', body: { on: on } }).then(function (r) {
          if (r && r.error) { $('ch-err-' + id).textContent = r.error; loadChannels(); } else renderChannels(r);
        });
      };
    });
    if (salidaHtml && $('wa-salida-r')) { $('wa-salida-r').innerHTML = salidaHtml; engancharOcultarSalida(); }
    if ($('wa-mas')) $('wa-mas').onclick = function () {
      var b = this; b.disabled = true; b.textContent = 'Pidiendo…';
      api('/whatsapp/mas-historial', { method: 'POST', body: {} }).then(function (r) {
        b.disabled = false; b.textContent = 'Traer más historial';
        $('wa-mas-r').textContent = r && r.error ? r.error
          : 'Pedido a ' + r.chats + ' conversaciones' + (r.quedan ? ' · quedan ' + r.quedan + ', dale otra vez cuando estas hayan llegado' : '') +
            '. Lo que llegue aparece solo en Perfil › Lo que aprendimos de sus chats.';
      });
    };
    if ($('wa-desvincular')) $('wa-desvincular').onclick = function () {
      if (!confirm('Se cierra la sesión de WhatsApp y hay que volver a escanear el código.\n\nLas conversaciones que ya están en el tablero NO se tocan. ¿Sigo?')) return;
      var b = this; b.disabled = true; b.textContent = 'Desvinculando…';
      api('/whatsapp/desvincular', { method: 'POST', body: {} }).then(function (r) {
        b.disabled = false; b.textContent = 'Desvincular y empezar de cero';
        if (r && r.error) { $('ch-err-whatsapp').textContent = r.error; loadChannels(); } else renderChannels(r);
      });
    };
    if ($('wa-salida')) $('wa-salida').onclick = function () {
      var b = this; b.disabled = true; b.textContent = 'Probando…';
      $('wa-salida-r').textContent = '';
      api('/whatsapp/salida').then(function (d) {
        b.disabled = false; b.textContent = 'Probar la salida';
        if (!d || d.error) { salidaHtml = ''; $('wa-salida-r').textContent = 'No se pudo probar.'; return; }
        salidaHtml = '<ul class="ch-steps">' + d.pruebas.map(function (p) {
          return '<li>' + (p.ok ? '✓ ' : '✗ ') + esc(p.que) + ' — <span class="muted">' + esc(p.detalle) + '</span></li>';
        }).join('') + '</ul><div class="ch-warn">' + esc(d.veredicto) + '</div>' +
          '<div class="feed-row"><button class="btn sm" id="wa-salida-x">Ocultar</button></div>';
        $('wa-salida-r').innerHTML = salidaHtml;
        engancharOcultarSalida();
      });
    };
    $('channels').querySelectorAll('[data-esc]').forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-esc'), solo = b.getAttribute('data-set') === '1';
        $('channels').querySelectorAll('[data-esc="' + id + '"]').forEach(function (x) { x.disabled = true; });
        api('/channels/' + id + '/escucha', { method: 'POST', body: { soloEscucha: solo } }).then(function (r) {
          if (r && r.error) { $('ch-err-' + id).textContent = r.error; loadChannels(); } else renderChannels(r);
        });
      };
    });
    // 🪤 Encender se pregunta; apagar, no. Pedir confirmación para dejar de mirar los grupos sería poner una
    // puerta en la salida: quien quiere que aiva deje de leerlos tiene que poder hacerlo de un clic.
    $('channels').querySelectorAll('[data-grupos]').forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-grupos'), encender = b.getAttribute('data-set') === '1';
        var mandar = function () {
          b.disabled = true;
          api('/channels/' + id + '/grupos', { method: 'POST', body: { grupos: encender } }).then(function (r) {
            if (r && r.error) { $('ch-err-' + id).textContent = r.error; loadChannels(); }
            else { renderChannels(r); toast(encender ? 'De aquí en adelante aprende de los grupos' : 'Los grupos vuelven a ignorarse', null, { icono: 'message' }); }
          });
        };
        if (!encender) return mandar();
        $('grupos-agente').textContent = state.agentName || 'Aiva';
        $('grupos-si').onclick = function () { $('dlg-grupos').close(); mandar(); };
        $('dlg-grupos').showModal();
      };
    });
    $('channels').querySelectorAll('[data-copy]').forEach(function (b) {
      b.onclick = function () {
        var input = $(b.getAttribute('data-copy'));
        var done = function () { b.textContent = 'Copiado'; };
        (navigator.clipboard ? navigator.clipboard.writeText(input.value) : Promise.reject()).then(done, function () { var t = input.type; input.type = 'text'; input.select(); document.execCommand('copy'); input.type = t; done(); });
      };
    });
    $('channels').querySelectorAll('[data-show]').forEach(function (b) {
      b.onclick = function () { var input = $(b.getAttribute('data-show')), show = input.type === 'password'; input.type = show ? 'text' : 'password'; b.textContent = show ? 'Ocultar' : 'Mostrar'; b.setAttribute('aria-pressed', String(show)); };
    });
    // Mientras se espera el QR o la conexión, se refresca seguido (el código cambia cada pocos segundos).
    var busy = list.some(function (ch) { return ch.state === 'esperando_qr' || ch.state === 'conectando'; });
    clearTimeout(chTimer);
    chTimer = setTimeout(function () {
      if (state.view !== 'channels') return;
      // Mientras alguien escribe las credenciales, no se redibuja.
      if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#meta-cred')) { renderChannelsLater(); return; }
      loadChannels();
    }, busy ? 4000 : 30000);
  }
  // Lo que el diagnóstico dejó en pantalla. Se guarda aparte porque la vista se repinta sola —cada 4 segundos
  // mientras hay un código QR esperando— y si no, lo que acabas de leer desaparece antes de terminar de leerlo.
  var salidaHtml = '';
  function engancharOcultarSalida() {
    if ($('wa-salida-x')) $('wa-salida-x').onclick = function () { salidaHtml = ''; $('wa-salida-r').innerHTML = ''; };
  }
  function renderChannelsLater() {
    clearTimeout(chTimer);
    chTimer = setTimeout(function () { if (state.view === 'channels') loadChannels(); }, 30000);
  }


  // ---------- Menú del segundo clic ----------
  // Lo que se quiere hacer sobre una conversación sin entrar en ella: echarle un ojo para decidir si urge, o
  // pasársela a quien le toca. Entrar a cada una para eso hace perder el hilo de la lista.
  var menuAbierto = null;
  function cerrarMenu() { if (menuAbierto) { menuAbierto.remove(); menuAbierto = null; } }
  document.addEventListener('click', cerrarMenu);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { cerrarMenu(); if ($('dlg-vistazo') && $('dlg-vistazo').open) $('dlg-vistazo').close(); } });

  function equipoDisponible() {
    var eq = Array.isArray(window.AIVA_EQUIPO) ? window.AIVA_EQUIPO : [];
    // Sin nadie más, la opción se enseña igual pero apagada: así se entiende que existe y por qué no se puede.
    return eq.filter(function (u) { return u && u.nombre; });
  }

  function abrirMenu(x, y, id) {
    cerrarMenu();
    var c = state.contacts.find(function (z) { return z.id === id; }) || { id: id };
    var eq = equipoDisponible();
    var m = document.createElement('div');
    m.className = 'menu-ctx';
    m.innerHTML =
      '<button data-acc="ver">Ver sin abrir</button>' +
      '<button data-acc="abrir">Abrir la conversación</button>' +
      '<div class="sep"></div>' +
      (eq.length
        ? '<div class="titulo">Entregar a</div>' + eq.map(function (u) {
            return '<button data-acc="dar" data-a="' + esc(u.nombre) + '">' + esc(u.nombre) + '</button>';
          }).join('')
        : '<button disabled title="No hay nadie más asignado a este cliente">Entregar a otra persona</button>') +
      '<div class="sep"></div>' +
      '<button data-acc="bot">Que siga ' + esc(state.agentName || 'el asistente') + '</button>';
    document.body.appendChild(m);
    m.style.left = Math.min(x, window.innerWidth - m.offsetWidth - 8) + 'px';
    m.style.top = Math.min(y, window.innerHeight - m.offsetHeight - 8) + 'px';
    menuAbierto = m;
    m.onclick = function (ev) { ev.stopPropagation(); };
    m.querySelectorAll('[data-acc]').forEach(function (b) {
      b.onclick = function () {
        var acc = b.getAttribute('data-acc');
        cerrarMenu();
        if (acc === 'abrir') { go('inbox'); openContact(id); return; }
        if (acc === 'ver') return vistazo(id);
        if (acc === 'dar') return entregar(id, b.getAttribute('data-a'));
        if (acc === 'bot') return entregar(id, null);
      };
    });
    void c;
  }

  function entregar(id, aQuien) {
    api('/contacts/' + encodeURIComponent(id) + '/human', { method: 'POST', body: { on: Boolean(aQuien), a: aQuien || undefined } })
      .then(function (r) {
        if (r && r.error) { toast('No se pudo: ' + r.error); return; }
        toast(aQuien ? 'Entregada a ' + aQuien : 'Vuelve a contestar ' + (state.agentName || 'el asistente'));
        loadContacts();
        if (state.current === id) openContact(id);
      });
  }

  // Una mirada rápida sin marcarla como leída ni entrar: lo justo para decidir si urge.
  function vistazo(id) {
    api('/contacts/' + encodeURIComponent(id) + '/vistazo').then(function (d) {
      if (!d || d.error) { toast('No se pudo abrir el vistazo'); return; }
      var c = d.contact || {};
      $('vistazo-quien').textContent = c.name || short(id);
      $('vistazo-meta').textContent = [channelIcon(c.channel), state.stageLabels[c.stage] || c.stage, c.recap || c.summary || ''].filter(Boolean).join(' · ');
      $('vistazo-msjs').innerHTML = (d.messages || []).map(bubble).join('') || '<div class="small muted">Sin mensajes.</div>';
      $('vistazo-abrir').onclick = function () { $('dlg-vistazo').close(); go('inbox'); openContact(id); };
      $('dlg-vistazo').showModal();
      var m = $('vistazo-msjs'); m.scrollTop = m.scrollHeight;
    });
  }

  // ---------- conocimiento ----------
  $('k-kn').onclick = function () { state.kind = 'knowledge'; $('k-kn').classList.add('on'); $('k-pr').classList.remove('on'); loadKnowledge(); };
  $('k-pr').onclick = function () { state.kind = 'product'; $('k-pr').classList.add('on'); $('k-kn').classList.remove('on'); loadKnowledge(); };
  var kTimer; $('k-q').oninput = function () { clearTimeout(kTimer); kTimer = setTimeout(loadKnowledge, 250); };
  function loadKnowledge() {
    api('/knowledge?kind=' + state.kind + '&q=' + encodeURIComponent($('k-q').value.trim())).then(function (docs) {
      $('k-list').innerHTML = docs.map(function (d) { return '<div class="doc"><h4>' + esc(d.title) + (d.url ? ' · <a href="' + esc(d.url) + '" target="_blank">enlace</a>' : '') + '</h4><p>' + esc(d.content) + '</p></div>'; }).join('') || '<div class="empty">Nada indexado con ese texto.</div>';
    });
  }

  // ---------- eventos en vivo ----------
  function connect() {
    if (state.es) state.es.close();
    var es = new EventSource(BASE + '/admin/api/stream?token=' + encodeURIComponent(state.token));
    state.es = es;
    es.onopen = function () { $('conn').textContent = '● en vivo'; $('conn').style.color = 'var(--ok)'; };
    es.onerror = function () { $('conn').textContent = '● reconectando…'; $('conn').style.color = 'var(--warn)'; };
    es.addEventListener('message', function (e) {
      var ev = JSON.parse(e.data), p = ev.payload;
      if (state.current === ev.userId && state.detail) {
        state.detail.messages.push({ role: p.role, author: p.author, by: p.by, content: p.content, ts: p.ts });
        var m = $('msgs'); m.insertAdjacentHTML('beforeend', bubble({ role: p.role, author: p.author, by: p.by, content: p.content, ts: p.ts })); m.scrollTop = m.scrollHeight;
        if (p.author === 'customer') api('/contacts/' + encodeURIComponent(ev.userId)).then(function () {}); // marca leído
      }
      if (p.author === 'customer') {
        if (state.current !== ev.userId || document.hidden) { beep(); var c = state.contacts.find(function (x) { return x.id === ev.userId; }); toast(p.content.slice(0, 90), function () { go('inbox'); openContact(ev.userId); }, { titulo: c ? nameOf(c) : short(ev.userId), icono: 'message' }); }
      }
      if (state.view === 'inbox') loadContacts();
      if (state.view === 'today') loadToday();
    });
    es.addEventListener('verification', function () { if (state.view === 'today') loadToday(); });
    es.addEventListener('contact', function () { if (state.view === 'inbox') loadContacts(); if (state.view === 'pipeline') loadPipeline(); });
    es.addEventListener('analysis', function (e) { var ev = JSON.parse(e.data); if (state.current === ev.userId) openContact(ev.userId); else if (state.view === 'inbox') loadContacts(); });
    es.addEventListener('handoff', function (e) { var ev = JSON.parse(e.data); if (state.current === ev.userId) openContact(ev.userId); if (state.view === 'inbox') loadContacts(); if (state.view === 'today') loadToday(); });
    es.addEventListener('appointment', function () { if (state.view === 'calendar') loadCalendar(); if (state.view === 'today') loadToday(); if (state.current) openContact(state.current); });
    setInterval(function () { if (state.view === 'calendar' && cal.mode === 'week') renderCalendar(); }, 60000); // mueve la línea de "ahora"
    es.addEventListener('notification', function (e) {
      var ev = JSON.parse(e.data), n = ev.payload.notification;
      state.notifs.unshift(n); if (state.notifs.length > 100) state.notifs.pop();
      renderNotifs();
      if (n.kind === 'verify') { beep(); toast(n.body, function () { go('today'); }, { titulo: n.title, icono: 'bell' }); }
      else if (n.kind === 'public') { beep(); toast(n.body, function () { go('channels'); }, { titulo: n.title, icono: 'plug' }); }
      else if (n.kind === 'handoff' || n.kind === 'hot' || n.kind === 'fail' || n.kind === 'engine') { beep(); toast(n.body, function () { if (n.userId !== 'system') { go('inbox'); openContact(n.userId); } else { go('agent'); } }, { titulo: n.title, icono: n.kind === 'hot' ? 'chart' : 'bell' }); }
      if (state.view === 'today') loadToday();
    });
  }

  // ---------- arranque ----------
  function boot() {
    if (PORLACONSOLA) state.token = state.token || 'por-la-consola'; // el valor da igual: la consola lo reemplaza
    if (!state.token) { showLogin(); return; }
    api('/me').then(function (me) {
      $('login').hidden = true;
      // Arriba va QUIÉN RESPONDE —que puede ser el asistente o una persona— y debajo el negocio. Los dos en el
      // color de la marca, ya ajustado para que se lea.
      if (me.colorClaro) document.documentElement.style.setProperty('--marca-clara', me.colorClaro);
      if (me.colorOscuro) document.documentElement.style.setProperty('--marca-oscura', me.colorOscuro);
      if ($('subnav-biz')) $('subnav-biz').textContent = me.business;
      if ($('marca-ini')) $('marca-ini').textContent = (me.business || 'A').trim().charAt(0).toUpperCase();
      if ($('marca-btn')) $('marca-btn').title = me.business || 'Inicio';
      pintarQuienSoy();
      state.bizName = me.business; state.agentName = me.agent;
      // El logo del negocio en su propia barra: entrar a su tablero tiene que sentirse suyo, no de aiva.
      if (me.logo) {
        var img = document.createElement('img');
        // 🪤 Con BASE delante: servido en /dunor/admin, un "/brand/logo" pelado apuntaría a la raíz del dominio.
        img.src = /^https?:/.test(me.logo) ? me.logo : BASE + me.logo;
        img.alt = me.business; img.className = 'logo-cliente';
        img.onerror = function () { img.remove(); };
        var marca = $('marca-btn');
        if (marca) { marca.innerHTML = ''; marca.appendChild(img); }
      }
      // 🪤 Aquí se rellenaba el nombre de quien atiende con el del ASISTENTE, y quedaba guardado. Como todos los
      // clientes suelen llamar igual a su asistente, el operador acababa llamándose «Aiva» en todos: parecía que
      // el perfil se cruzaba entre clientes y lo que pasaba es que se inventaba el nombre equivocado.
      //
      // Son dos cosas distintas y no se mezclan: el asistente es quien contesta solo, y el operador es la
      // persona que toma el teclado. Si no se sabe quién es, se deja en blanco y se pide; inventarlo es peor,
      // porque queda guardado y nadie vuelve a mirarlo.
      state.quienSoyPorCuenta = typeof window.AIVA_QUIEN === 'string' && Boolean(window.AIVA_QUIEN);
      // 🪤 Limpieza de lo que dejó el apaño viejo: si lo guardado es el nombre del ASISTENTE, no lo escribió
      // nadie —lo puso el propio tablero— y hay que quitarlo, o se arrastra para siempre y parece que el perfil
      // se cruza entre clientes.
      if (state.name && me.agent && state.name === me.agent) {
        state.name = '';
        try { localStorage.removeItem(LLAVE('name')); } catch (e) {}
      }
      // 🪤 Y si NO hay nada puesto para este cliente, se usa el nombre de la cuenta como punto de partida — pero
      // sin pisarlo. Cada cliente es un negocio aparte: quien atiende puede firmar distinto en una boutique que
      // en una financiera, y que el nombre del super-admin se propague a los tres de golpe es exactamente lo
      // que no debe pasar.
      if (!state.name && state.quienSoyPorCuenta) state.name = window.AIVA_QUIEN;
      pintarQuienSoy();
      document.title = me.agent + ' · Tablero';
      return api('/stats');
    }).then(function (s) {
      state.stageLabels = s.stageLabels; state.stages = s.stages || []; etapasDelNegocio(); pintarQuienSoy(); connect(); loadNotifs(); loadCalendar();
      // Enlace directo a una conversación (p. ej. desde la cita en Google Calendar): /admin#c=<id>
      var m = /^#c=(.+)$/.exec(location.hash);
      if (m) { go('inbox'); openContact(decodeURIComponent(m[1])); history.replaceState(null, '', location.pathname); } else go('today');
    }).catch(function () {});
  }

  // ---------- El negocio: la configuración del cliente, editable sin tocar archivos ----------
  // Lo que se guarda aquí va a `aiva.config.json`. Se lee al arrancar, así que hasta que el cliente no reinicie
  // sigue atendiendo con lo viejo: por eso el aviso de arriba y el botón de reiniciar, que solo aparece donde
  // hay quien lo vuelva a levantar.
  var DIAS = [['Dom', 0], ['Lun', 1], ['Mar', 2], ['Mié', 3], ['Jue', 4], ['Vie', 5], ['Sáb', 6]];

  function loadNegocio() { api('/config').then(function (d) { state.negocio = d; renderNegocio(); }); }

  function campo(id, etiqueta, valor, opts) {
    opts = opts || {};
    var entrada = opts.largo
      ? '<textarea id="' + id + '" rows="' + (opts.filas || 2) + '">' + esc(valor == null ? '' : valor) + '</textarea>'
      : '<input type="' + (opts.tipo || 'text') + '" id="' + id + '" value="' + esc(valor == null ? '' : valor) + '"' +
        (opts.min != null ? ' min="' + opts.min + '"' : '') + (opts.max != null ? ' max="' + opts.max + '"' : '') + '>';
    return '<div class="prof-field"><div class="lbl"><label class="small" for="' + id + '"><b>' + esc(etiqueta) + '</b></label></div>' + entrada +
      (opts.pista ? '<div class="small muted">' + esc(opts.pista) + '</div>' : '') + '</div>';
  }

  function renderNegocio() {
    var d = state.negocio, a = d.guardado, ci = a.citas;
    var aviso = d.alDia ? '' :
      '<div class="aviso" style="margin-bottom:12px"><b>Hay cambios guardados que todavía no se aplican.</b> ' +
      'El asistente sigue atendiendo con la configuración anterior hasta que reinicie. ' +
      (d.puedeReiniciarse ? '<button class="btn sm" id="neg-reiniciar">Reiniciar ahora</button>'
                          : '<span class="small muted">Reinícialo tú: aquí nadie lo volvería a levantar solo.</span>') + '</div>';

    var zonas = d.zonas.indexOf(a.timezone) === -1 ? [a.timezone].concat(d.zonas) : d.zonas;

    $('negocio').innerHTML = aviso +
      '<div class="card"><h2 class="h">El negocio</h2>' +
        '<div class="fila-2">' + campo('n-nombre', 'Nombre', a.negocio.name, { pista: 'Como lo nombra el asistente al presentarse.' }) +
          campo('n-sitio', 'Sitio web', a.negocio.siteUrl, { pista: 'Con https://' }) + '</div>' +
        campo('n-desc', 'En una línea', a.negocio.description, { largo: true, pista: 'Qué vende o qué hace. Va en lo que el asistente sabe de entrada.' }) +
        campo('n-humano', 'Cuando piden una persona', a.negocio.humanContact, { largo: true, pista: 'Lo que el asistente responde cuando alguien quiere hablar con alguien de carne y hueso.' }) +
        '<div class="fila-3">' + campo('n-pais', 'País', a.negocio.country) + campo('n-moneda', 'Moneda', a.negocio.currency) +
          campo('n-indicativo', 'Indicativo', a.negocio.phoneCountryCode, { pista: 'Sin el +' }) +
          campo('n-digitos', 'Dígitos del teléfono', a.negocio.phoneLocalDigits, { tipo: 'number', min: 6, max: 12 }) + '</div>' +
      '</div>' +

      '<div class="card"><h2 class="h">El asistente</h2>' +
        campo('n-agente', 'Se llama', a.agente.name) +
        campo('n-estilo', 'Cómo habla', a.agente.style, { largo: true, pista: 'Por ejemplo: cálido, cercano, tutea, mensajes cortos.' }) +
        campo('n-meta', 'Qué busca en cada conversación', a.agente.goal, { largo: true, pista: 'Vacío: solo responde y toma datos.' }) +
        campo('n-saludo', 'Primer saludo', a.agente.greeting, { largo: true, pista: 'Vacío: saluda con sus propias palabras.' }) +
        campo('n-verifico', 'Cuando no sabe algo', a.agente.verifyPhrase, { largo: true, pista: 'Lo que dice antes de que la pregunta te llegue a ti. Nunca inventa.' }) +
      '</div>' +

      '<div class="card"><h2 class="h">Marca y hora</h2>' +
        '<div class="fila-3">' +
          campo('n-color', 'Color', a.marca.color, { tipo: 'color' }) +
          '<div class="prof-field"><div class="lbl"><label class="small" for="n-fondo"><b>Su marca va sobre</b></label></div>' +
            '<select id="n-fondo"><option value="claro"' + (a.marca.fondo === 'claro' ? ' selected' : '') + '>Fondo claro</option>' +
            '<option value="oscuro"' + (a.marca.fondo === 'oscuro' ? ' selected' : '') + '>Fondo oscuro</option></select>' +
            '<div class="small muted">El chat del sitio y la página de la cita.</div></div>' +
          campo('n-logo', 'Logo (URL o archivo)', a.marca.logo) +
          campo('n-logo-oscuro', 'Logo para fondo oscuro', a.marca.logoOscuro, { pista: 'Si la marca tiene dos versiones.' }) +
          campo('n-favicon', 'Marca chica (favicon)', a.marca.favicon, { pista: 'El escudo o la inicial.' }) +
          '<div class="prof-field"><div class="lbl"><label class="small" for="n-zona"><b>Zona horaria</b></label></div>' +
            '<select id="n-zona">' + zonas.map(function (z) { return '<option' + (z === a.timezone ? ' selected' : '') + '>' + esc(z) + '</option>'; }).join('') + '</select>' +
            '<div class="small muted">Con esto entiende «mañana a las 3».</div></div>' +
        '</div>' +
      '</div>' +

      '<div class="card"><h2 class="h">Citas</h2>' +
        '<label class="prof-check" for="n-citas"><input type="checkbox" id="n-citas"' + (ci.enabled ? ' checked' : '') + '> Este negocio agenda citas</label>' +
        '<div id="n-citas-detalle"' + (ci.enabled ? '' : ' hidden') + '>' +
          '<div class="fila-3">' + campo('n-servicio', 'Cómo se llama la cita', ci.service) + campo('n-lugar', 'Dónde', ci.location) +
            campo('n-dura', 'Dura (minutos)', ci.durationMin, { tipo: 'number', min: 5, max: 480 }) + '</div>' +
          '<div class="fila-3">' + campo('n-cupo', 'Cuántas a la vez', ci.capacity, { tipo: 'number', min: 1, max: 50 }) +
            campo('n-aviso', 'Con cuánta anticipación (horas)', ci.minLeadHours, { tipo: 'number', min: 0, max: 720 }) +
            campo('n-hasta', 'Hasta cuántos días adelante', ci.maxDaysAhead, { tipo: 'number', min: 1, max: 365 }) + '</div>' +
          '<div class="prof-field"><div class="lbl"><b class="small">Días que atiende</b></div><div class="dias">' +
            DIAS.map(function (x) { return '<label class="prof-check"><input type="checkbox" class="n-dia" value="' + x[1] + '"' + (ci.days.indexOf(x[1]) !== -1 ? ' checked' : '') + '> ' + x[0] + '</label>'; }).join('') +
          '</div></div>' +
          '<div class="prof-field"><div class="lbl"><b class="small">Franjas del día</b></div><div id="n-franjas">' +
            ci.hours.map(franja).join('') + '</div><button class="btn sm" type="button" id="n-mas-franja">Agregar franja</button></div>' +
        '</div>' +
      '</div>' +

      '<div class="fila" style="gap:10px;align-items:center"><button class="btn primary" id="n-guardar">Guardar</button>' +
        '<span id="n-msg" class="small" role="status"></span></div>' +
      '<div class="small muted" style="margin-top:10px">El embudo y los datos que captura salen de cómo se dio de alta el cliente y no se cambian desde aquí: ' +
      'tocarlos en caliente dejaría fichas en etapas que ya no existen.</div>';

    $('n-citas').onchange = function () { $('n-citas-detalle').hidden = !this.checked; };
    $('n-mas-franja').onclick = function () { $('n-franjas').insertAdjacentHTML('beforeend', franja(['09:00', '13:00'])); enganchaFranjas(); };
    enganchaFranjas();
    if ($('neg-reiniciar')) $('neg-reiniciar').onclick = function () {
      this.disabled = true; this.textContent = 'Reiniciando…';
      api('/config/restart', { method: 'POST' }).catch(function () {});
      setTimeout(loadNegocio, 6000); // vuelve a preguntar cuando ya debería estar arriba
    };
    $('n-guardar').onclick = guardarNegocio;
  }

  function franja(h) {
    return '<div class="franja"><input type="time" value="' + esc(h[0]) + '" aria-label="Desde"> <span class="muted">a</span> ' +
      '<input type="time" value="' + esc(h[1]) + '" aria-label="Hasta"> <button class="btn sm" type="button" data-quitar>Quitar</button></div>';
  }
  function enganchaFranjas() {
    $('n-franjas').querySelectorAll('[data-quitar]').forEach(function (b) {
      b.onclick = function () { b.parentNode.remove(); };
    });
  }

  function guardarNegocio() {
    var num = function (id) { return Number($(id).value); };
    var cuerpo = {
      negocio: {
        name: $('n-nombre').value, description: $('n-desc').value, siteUrl: $('n-sitio').value,
        currency: $('n-moneda').value, country: $('n-pais').value, humanContact: $('n-humano').value,
        phoneCountryCode: $('n-indicativo').value, phoneLocalDigits: num('n-digitos')
      },
      agente: { name: $('n-agente').value, style: $('n-estilo').value, goal: $('n-meta').value, greeting: $('n-saludo').value, verifyPhrase: $('n-verifico').value },
      marca: {
        color: $('n-color').value, logo: $('n-logo').value,
        logoOscuro: $('n-logo-oscuro').value, favicon: $('n-favicon').value, fondo: $('n-fondo').value
      },
      timezone: $('n-zona').value,
      citas: {
        enabled: $('n-citas').checked,
        service: $('n-servicio') ? $('n-servicio').value : '',
        location: $('n-lugar') ? $('n-lugar').value : '',
        durationMin: $('n-dura') ? num('n-dura') : 45,
        days: Array.prototype.map.call(document.querySelectorAll('.n-dia:checked'), function (x) { return Number(x.value); }),
        hours: Array.prototype.map.call($('n-franjas').querySelectorAll('.franja'), function (f) {
          var e = f.querySelectorAll('input'); return [e[0].value, e[1].value];
        }),
        capacity: $('n-cupo') ? num('n-cupo') : 1,
        minLeadHours: $('n-aviso') ? num('n-aviso') : 0,
        maxDaysAhead: $('n-hasta') ? num('n-hasta') : 21
      }
    };
    $('n-msg').textContent = 'Guardando…';
    api('/config', { method: 'PUT', body: cuerpo }).then(function (r) {
      if (r.error) { $('n-msg').innerHTML = '<span class="v-no">' + esc(r.error) + '</span>'; return; }
      $('n-msg').textContent = r.hayQueReiniciar ? 'Guardado. Se aplica al reiniciar.' : 'Guardado.';
      loadNegocio();
    });
  }


  // ---------- Configuración en un modal ----------
  function abrirConfig(cual) {
    var dlg = $('dlg-config');
    $('negocio').hidden = cual !== 'negocio';
    $('profile').hidden = cual !== 'profile';
    document.querySelectorAll('.cfg-tabs [data-cfg]').forEach(function (b) {
      b.setAttribute('aria-selected', String(b.getAttribute('data-cfg') === cual));
    });
    $('cfg-titulo').textContent = cual === 'negocio' ? 'El negocio' : 'Perfil del negocio';
    $('cfg-sub').textContent = cual === 'negocio'
      ? 'Cómo se llama, cómo habla el asistente y cómo agenda'
      : 'Lo que confirmes aquí es lo que el asistente dice de tu negocio';
    if (cual === 'negocio') loadNegocio(); else loadProfile();
    if (!dlg.open) dlg.showModal();
    dlg.querySelector('.modal-cuerpo').scrollTop = 0;
    closeMore();
  }
  document.querySelectorAll('.cfg-tabs [data-cfg]').forEach(function (b) {
    b.onclick = function () { abrirConfig(b.getAttribute('data-cfg')); };
  });
  $('cfg-cerrar').onclick = function () { $('dlg-config').close(); };


  // ---------- Quién más está en esta conversación ----------
  // Varias personas del equipo pueden atender la misma conversación, y la IA sigue ahí: esto no bloquea a nadie,
  // solo hace visible quién está. Se refresca mientras la conversación siga abierta; el que cierra la pestaña no
  // avisa, así que del otro lado caduca solo.
  var latidoPresencia = null;
  function anunciarme(id, yaEstan) {
    pintarPresentes(yaEstan.filter(function (p) { return p.nombre !== state.name; }));
    var avisar = function () {
      if (state.current !== id) { clearInterval(latidoPresencia); return; }
      api('/contacts/' + encodeURIComponent(id) + '/presencia', { method: 'POST', body: { by: state.name || 'equipo' } })
        .then(function (r) { if (state.current === id) pintarPresentes((r && r.otros) || []); })
        .catch(function () {});
    };
    avisar();
    clearInterval(latidoPresencia);
    latidoPresencia = setInterval(avisar, 60000);
  }

  function pintarPresentes(otros) {
    var caja = $('presentes');
    if (!caja) return;
    caja.hidden = !otros.length;
    if (!otros.length) return;
    var nombres = otros.map(function (o) { return esc(o.nombre); }).join(', ');
    caja.innerHTML = '<span class="punto"></span>' +
      (otros.length === 1 ? '<b>' + nombres + '</b> también está aquí' : '<b>' + nombres + '</b> también están aquí') +
      ' <span class="muted">· pónganse de acuerdo para no contestar lo mismo</span>';
  }


  // ---------- Quién responde (el pie) ----------
  // No es un adorno: por WhatsApp este nombre va delante del mensaje que recibe el cliente. Por eso se puede
  // cambiar de un clic, con el ejemplo a la vista. Usuario, correo y clave no viven aquí: son de la consola.
  function inicialesDe(nombre) {
    var p = String(nombre || 'A').trim().split(/\s+/);
    return ((p[0] || 'A')[0] + (p[1] ? p[1][0] : '')).toUpperCase();
  }
  function pintarQuienSoy() {
    // 🪤 Sin nombre NO se cae al del asistente: son dos cosas distintas y confundirlas fue el origen del lío.
    // «Sin nombre» se ve como tal, y eso es lo que empuja a ponerlo.
    var nombre = state.name || 'sin nombre';
    $('foot-nombre').textContent = nombre;
    $('foot-ini').textContent = inicialesDe(nombre);
    $('foot-ini').style.background = miColor();
    $('foot-ini').style.color = '#fff';
    $('foot-ini').style.borderColor = 'transparent';
    $('foot-user').title = 'Respondes como ' + nombre;
    // Quién responde ahora mismo se ve en el avatar del riel (sus iniciales y su color) y al pasar por encima.
  }
  var COLORES_PERFIL = ['#7b660f', '#2b5ea8', '#2c6b3f', '#a4231b', '#6b3fa0', '#0f6b73', '#8a5a08', '#4a4740'];
  function miColor() {
    try {
      var c = localStorage.getItem(LLAVE('color'));
      if (c && COLORES_PERFIL.indexOf(c) !== -1) return c;
    } catch (e) {}
    var n = 0, nombre = state.name || 'a';
    for (var i = 0; i < nombre.length; i++) n = (n * 31 + nombre.charCodeAt(i)) % 100000;
    return COLORES_PERFIL[n % COLORES_PERFIL.length];
  }
  function pintarPaletaPerfil() {
    var puesto = miColor();
    $('yo-paleta').innerHTML = COLORES_PERFIL.map(function (c) {
      return '<button type="button" class="tinta' + (c === puesto ? ' puesto' : '') + '" data-color="' + c + '" style="background:' + c + '" aria-label="Color ' + c + '"></button>';
    }).join('');
    $('yo-paleta').querySelectorAll('.tinta').forEach(function (b) {
      b.onclick = function () {
        $('yo-paleta').querySelectorAll('.tinta').forEach(function (x) { x.classList.remove('puesto'); });
        b.classList.add('puesto');
        try { localStorage.setItem(LLAVE('color'), b.getAttribute('data-color')); } catch (e) {}
        pintarQuienSoy();
      };
    });
  }
  function pintarTema() {
    $('yo-tema').querySelectorAll('[data-tema]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-tema') === state.theme));
      b.classList.toggle('puesto', b.getAttribute('data-tema') === state.theme);
    });
  }
  function pintarAvisos() {
    var caja = $('yo-avisos');
    if (!('Notification' in window)) { caja.innerHTML = '<span class="muted">Este navegador no los tiene.</span>'; return; }
    var p = Notification.permission;
    if (p === 'granted') caja.innerHTML = '<span class="v-si">Activadas</span> <span class="muted">· te avisa aunque el tablero esté detrás.</span>';
    else if (p === 'denied') caja.innerHTML = '<span class="muted">Bloqueadas en este navegador. Se vuelven a permitir desde el candado de la barra de direcciones.</span>';
    else caja.innerHTML = '<button class="btn sm" type="button" id="yo-pedir-avisos">Activar avisos</button> <span class="muted">· suenan igual sin esto, pero solo si el tablero está abierto.</span>';
    if ($('yo-pedir-avisos')) $('yo-pedir-avisos').onclick = function () { Notification.requestPermission().then(pintarAvisos); };
  }

  $('foot-user').onclick = function () {
    // Ni aquí ni en ningún otro sitio se cae al nombre del asistente: el operador es una persona.
    $('yo-nombre').value = state.name || '';
    $('yo-ejemplo').textContent = state.name || 'tu nombre';
    $('yo-msg').textContent = '';
    $('yo-cuenta').hidden = !PORLACONSOLA;
    pintarPaletaPerfil(); pintarTema(); pintarAvisos();
    $('dlg-yo').showModal();
    $('yo-nombre').focus();
  };
  document.querySelectorAll('#yo-tema [data-tema]').forEach(function (b) {
    b.onclick = function () { ponerTema(b.getAttribute('data-tema')); pintarTema(); };
  });
  $('yo-nombre').oninput = function () { $('yo-ejemplo').textContent = this.value.trim() || 'tu nombre'; };
  $('yo-cerrar').onclick = function () { $('dlg-yo').close(); };
  $('yo-guardar').onclick = function () {
    var puesto = $('yo-nombre').value.trim();
    if (!puesto) { $('yo-msg').textContent = 'Pon tu nombre: es el que verá tu equipo en cada mensaje que contestes.'; return; }
    // 🪤 Con cuenta hay que preguntar DÓNDE. Cada cliente es un negocio aparte y quien atiende puede firmar
    // distinto en cada uno; dar por hecho que vale para todos fue el error que hizo que un nombre puesto en la
    // consola apareciera en los tres tableros.
    var enTodos = false;
    if (state.quienSoyPorCuenta || PORLACONSOLA) {
      enTodos = confirm('¿Lo pongo en todos los clientes (es tu nombre de cuenta)?\n\nAceptar: en todos.\nCancelar: solo en ' + (state.bizName || 'este cliente') + '.');
    }
    state.name = puesto;
    // 🪤 Con cuenta, el nombre es de LA PERSONA y se guarda en su perfil: así la sigue en cualquier cliente y en
    // cualquier equipo. En el navegador solo se guarda cuando no hay cuenta de la que colgarlo (entrada directa
    // con token), que es el único caso en que no hay otro sitio.
    if (enTodos) {
      // Cambia tu cuenta, y este cliente deja de tener uno propio para que siga al de la cuenta.
      try { localStorage.removeItem(LLAVE('name')); } catch (e) {}
      fetch('/api/yo', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nombre: puesto }) })
        .then(function (r) { return r.json(); })
        .then(function (d) { $('yo-msg').textContent = d && d.error ? d.error : 'Listo ✓ · en todos tus clientes'; })
        .catch(function () { $('yo-msg').textContent = 'Guardado aquí, pero no pude actualizarlo en tu perfil.'; });
    } else {
      try { localStorage.setItem(LLAVE('name'), puesto); } catch (e) {}
      $('yo-msg').textContent = 'Listo ✓ · solo en ' + (state.bizName || 'este cliente');
    }
    pintarQuienSoy();
    setTimeout(function () { $('dlg-yo').close(); }, 900);
  };


  // ---------- Las dos gráficas ----------
  // Dibujadas a mano en SVG: sin librería, sin ejes inventados y sin suavizar la curva, que suavizar es mentir
  // sobre la forma. Lo que no hay, no se pinta: un día en cero se ve en cero.
  function cargarSeries() {
    api('/series?dias=14').then(function (d) {
      pintarDeltas(d.semana);
      pintarNuevas(d.nuevas);
      pintarHoras(d.actividad);
    }).catch(function () {});
    cargarTiempos();
    cargarOrigenes();
  }

  // ---------- Qué trae clientes ----------
  // La tabla que decide dónde se pone el dinero de la publicidad. Se enseña también cuántos llegaron sin que se
  // sepa de dónde: sin ese número, el resto se lee como si fuera el total y las campañas parecen mejores.
  function cargarOrigenes() {
    api('/origenes?dias=30').then(function (d) {
      if (!d || d.error) { $('origenes').innerHTML = '<div class="small muted">No se pudo calcular.</div>'; return; }
      if (!d.campanas.length) {
        $('origenes').innerHTML = '<div class="small muted">Todavía no hay conversaciones con origen conocido. ' +
          'Llega solo cuando alguien entra por el chat del sitio con una campaña, o por un anuncio de WhatsApp.' +
          (d.sinOrigen ? ' Por ahora, ' + d.sinOrigen + ' conversaciones sin origen.' : '') + '</div>';
        return;
      }
      $('origenes').innerHTML = '<table class="tabla-origen"><thead><tr>' +
          '<th>De dónde</th><th>Campaña</th><th class="num">Conversaciones</th><th class="num">Citas</th><th class="num">Ganadas</th><th class="num">Conversión</th>' +
        '</tr></thead><tbody>' +
        d.campanas.map(function (c) {
          return '<tr><td>' + esc(c.fuente) + (c.medio ? ' <span class="muted">· ' + esc(c.medio) + '</span>' : '') + '</td>' +
            '<td>' + esc(c.campana || '—') + (c.titular ? '<div class="small muted">' + esc(c.titular) + '</div>' : '') + '</td>' +
            '<td class="num">' + c.conversaciones + '</td><td class="num">' + c.citas + '</td><td class="num">' + c.ganadas + '</td>' +
            '<td class="num">' + c.conversion + ' %</td></tr>';
        }).join('') +
        '</tbody></table>' +
        (d.sinOrigen ? '<div class="small muted" style="margin-top:8px">Y ' + d.sinOrigen + ' conversaciones más sin origen conocido: ' +
          'quien escribe al WhatsApp directo no trae de dónde viene.</div>' : '');
    }).catch(function () {});
  }

  // ---------- Cuánto se tarda en contestar ----------
  // El número con el que se juzga a gente, así que se enseña con lo que hace falta para leerlo bien: el acuerdo
  // con el que se midió, quién contestó, y sobre todo quién está esperando AHORA, que es lo único accionable.
  function duracion(ms) {
    var m = Math.round(ms / 60000);
    if (m < 1) return 'menos de un minuto';
    if (m < 60) return m + ' min';
    var h = Math.floor(m / 60);
    return h < 24 ? h + ' h ' + (m % 60) + ' min' : Math.floor(h / 24) + ' d ' + (h % 24) + ' h';
  }

  function cargarTiempos() {
    api('/tiempos?dias=14').then(function (d) {
      if (!d || d.error) { $('tiempos').innerHTML = '<div class="small muted">No se pudo calcular.</div>'; return; }
      var cumple = d.respondidas ? Math.round(((d.respondidas - d.fueraDeAcuerdo) / d.respondidas) * 100) : null;
      var html = '<div class="tiempos-cifras">' +
        '<div class="cifra"><b>' + (d.respondidas ? duracion(d.medianaMs) : '—') + '</b><span>la mitad, en menos de</span></div>' +
        '<div class="cifra"><b>' + (d.respondidas ? duracion(d.p90Ms) : '—') + '</b><span>nueve de cada diez</span></div>' +
        '<div class="cifra"><b>' + (cumple === null ? '—' : cumple + ' %') + '</b><span>dentro de los ' + d.acuerdoMin + ' min acordados</span></div>' +
        '<div class="cifra"><b>' + d.esperando.length + '</b><span>esperando ahora mismo</span></div>' +
        '</div>';
      if (d.respondidas) {
        html += '<div class="tiempos-quien">' +
          '<span class="chip">Aiva: ' + d.porQuien.aiva.n + ' · ' + duracion(d.porQuien.aiva.medianaMs) + '</span>' +
          '<span class="chip">Personas: ' + d.porQuien.persona.n + ' · ' + duracion(d.porQuien.persona.medianaMs) + '</span>' +
          d.personas.map(function (p) { return '<span class="chip who">' + esc(p.nombre) + ': ' + duracion(p.medianaMs) + ' (' + p.n + ')</span>'; }).join('') +
          '</div>';
      }
      if (d.esperando.length) {
        html += '<div style="margin-top:6px"><b class="small">Sin respuesta ahora</b>' +
          d.esperando.slice(0, 6).map(function (e) {
            // 🪤 Aquí manda el tiempo CORRIDO, que es el que siente quien espera. El hábil va al lado cuando
            // difiere: decirle a alguien que lleva «menos de un minuto» a las nueve de la noche, porque el
            // negocio está cerrado, es cierto y no sirve para nada.
            var corrido = duracion(e.ms);
            var habil = duracion(e.msHabiles);
            return '<div class="espera-larga"><a href="#" data-espera="' + esc(e.userId) + '">' + esc(e.nombre || short(e.userId)) + '</a>' +
              '<span class="muted small">lleva ' + corrido +
              (e.msHabiles < 60000 ? ' · llegó fuera de horario' : (habil !== corrido ? ' (' + habil + ' en horario)' : '')) +
              (e.mensajes > 1 ? ' · escribió ' + e.mensajes + ' veces' : '') + '</span></div>';
          }).join('') + '</div>';
      } else if (d.respondidas) {
        html += '<div class="small v-si">Nadie esperando respuesta.</div>';
      }
      if (!d.respondidas && !d.esperando.length) {
        html += '<div class="small muted">Todavía no hay conversaciones suficientes para medir.</div>';
      }
      html += '<div class="feed-row" style="margin-top:10px"><label class="small muted" for="sla-min">Nos comprometemos a contestar en</label>' +
        '<input type="number" id="sla-min" min="1" max="10080" value="' + d.acuerdoMin + '" style="width:80px"><span class="small muted">minutos</span>' +
        '<button class="btn sm" id="sla-guardar">Guardar</button><span class="small" id="sla-msg" role="status"></span></div>';
      $('tiempos').innerHTML = html;

      $('tiempos').querySelectorAll('[data-espera]').forEach(function (a) {
        a.onclick = function (ev) { ev.preventDefault(); go('inbox'); openContact(a.getAttribute('data-espera')); };
      });
      $('sla-guardar').onclick = function () {
        var minutos = Number($('sla-min').value);
        api('/tiempos/acuerdo', { method: 'PUT', body: { minutos: minutos } }).then(function (r) {
          $('sla-msg').textContent = r && r.error ? r.error : 'Guardado.';
          if (!r.error) cargarTiempos();
        });
      };
    }).catch(function () {});
  }

  function chipCambio(c) {
    if (c.delta === null) return '<span class="cambio igual">primera semana</span>';
    if (c.delta === 0) return '<span class="cambio igual">igual</span>';
    var sube = c.delta > 0;
    return '<span class="cambio ' + (sube ? 'sube' : 'baja') + '">' + (sube ? '+' : '') + c.delta + ' %</span>';
  }

  function pintarDeltas(s) {
    var datos = [
      { q: 'Conversaciones nuevas', c: s.conversaciones },
      { q: 'Mensajes de clientes', c: s.mensajes },
      { q: 'Citas agendadas', c: s.citas },
    ];
    $('deltas').innerHTML = datos.map(function (d) {
      return '<div class="delta"><b>' + d.c.ahora + '</b><span class="que">' + d.q + ' · 7 días</span><br>' + chipCambio(d.c) + '</div>';
    }).join('');
  }

  var DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  function etiquetaDia(iso) {
    var p = iso.split('-');
    var f = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return DIAS_CORTOS[f.getDay()] + ' ' + p[2];
  }

  // Área apilada: WhatsApp abajo, el chat del sitio encima. Si alguien no usa un canal, esa banda no aparece.
  function pintarNuevas(dias) {
    var caja = $('g-nuevas');
    var total = dias.reduce(function (a, d) { return a + d.total; }, 0);
    if (!total) { caja.innerHTML = '<div class="sin-datos">Todavía no ha entrado nadie en estos días.</div>'; return; }
    var W = 620, H = 170, izq = 26, abajo = 22;
    var max = Math.max.apply(null, dias.map(function (d) { return d.total; })) || 1;
    var x = function (i) { return izq + (i * (W - izq - 6)) / Math.max(1, dias.length - 1); };
    var y = function (v) { return H - abajo - (v * (H - abajo - 10)) / max; };
    var banda = function (hasta, color) {
      var arriba = dias.map(function (d, i) { return x(i) + ',' + y(hasta(d)); });
      var base = dias.map(function (d, i) { return x(i) + ',' + y(0); }).reverse();
      return '<polygon points="' + arriba.concat(base).join(' ') + '" fill="' + color + '" fill-opacity=".85"></polygon>';
    };
    var linea = function (hasta, color) {
      return '<polyline points="' + dias.map(function (d, i) { return x(i) + ',' + y(hasta(d)); }).join(' ') +
        '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round"></polyline>';
    };
    var reglas = [0, Math.round(max / 2), max].map(function (v) {
      return '<line x1="' + izq + '" y1="' + y(v) + '" x2="' + W + '" y2="' + y(v) + '" stroke="currentColor" stroke-opacity=".12"></line>' +
        '<text class="eje" x="0" y="' + (y(v) + 3) + '">' + v + '</text>';
    }).join('');
    var etiquetas = dias.map(function (d, i) {
      return i % 2 ? '' : '<text class="eje" x="' + x(i) + '" y="' + (H - 6) + '" text-anchor="middle">' + etiquetaDia(d.dia) + '</text>';
    }).join('');
    caja.innerHTML = '<svg class="grafica" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Conversaciones nuevas por día">' +
      reglas +
      banda(function (d) { return d.total; }, 'var(--cita)') +
      banda(function (d) { return d.whatsapp + d.otros; }, 'var(--brand)') +
      linea(function (d) { return d.total; }, 'var(--cita)') +
      etiquetas + '</svg>' +
      '<div class="leyenda"><span><i style="background:var(--brand)"></i>WhatsApp</span>' +
      '<span><i style="background:var(--cita)"></i>Chat del sitio</span>' +
      '<span class="muted">' + total + ' en 14 días</span></div>';
  }

  // Mapa de calor: cuanto más oscura la celda, más mensajes a esa hora ese día.
  function pintarHoras(a) {
    var caja = $('g-horas');
    if (!a.total) { caja.innerHTML = '<div class="sin-datos">Sin mensajes en estos días.</div>'; return; }
    var izq = 30, arriba = 4, celda = 15, hueco = 3;
    var W = izq + a.dias.length * (celda + hueco), H = arriba + a.horas.length * (celda + hueco) + 16;
    var cuadros = a.celdas.map(function (fila, f) {
      return fila.map(function (n, c) {
        var fuerza = n ? 0.18 + 0.82 * (n / a.max) : 0;
        return '<rect class="celda" x="' + (izq + c * (celda + hueco)) + '" y="' + (arriba + f * (celda + hueco)) + '" ' +
          'width="' + celda + '" height="' + celda + '" rx="4" fill="var(--brand)" fill-opacity="' + fuerza.toFixed(2) + '">' +
          '<title>' + etiquetaDia(a.dias[c]) + ' · ' + a.horas[f] + ':00 · ' + n + (n === 1 ? ' mensaje' : ' mensajes') + '</title></rect>';
      }).join('');
    }).join('');
    var horas = a.horas.map(function (h, f) {
      return '<text class="eje" x="0" y="' + (arriba + f * (celda + hueco) + 11) + '">' + h + ':00</text>';
    }).join('');
    var dias = a.dias.map(function (d, c) {
      return c % 2 ? '' : '<text class="eje" x="' + (izq + c * (celda + hueco) + celda / 2) + '" y="' + (H - 4) + '" text-anchor="middle">' + d.slice(8) + '</text>';
    }).join('');
    // A tamaño natural: estirado a lo ancho, un mapa de calor se vuelve una pared de bloques.
    caja.innerHTML = '<svg class="grafica mapa" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Mensajes por hora y día">' +
      cuadros + horas + dias + '</svg>' +
      '<div class="leyenda"><span class="muted">Lo más cargado: ' + a.max + (a.max === 1 ? ' mensaje' : ' mensajes') + ' en una hora · ' + a.total + ' en 14 días</span></div>';
  }

  boot();
})();
