/* Tablero de Aiva: bandeja, pipeline, calendario, análisis, agente y conocimiento. Vanilla JS + SSE. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var state = { token: '', name: '', view: 'today', filter: 'all', q: '', contacts: [], current: null, detail: null, kind: 'knowledge', theme: 'light', sound: true, stageLabels: {}, es: null, notifs: [], notifSeen: 0, detailOpen: false };
  try { state.token = localStorage.getItem('aiva.admin.token') || ''; state.name = localStorage.getItem('aiva.admin.name') || ''; state.theme = localStorage.getItem('aiva.admin.theme') || 'light'; state.sound = localStorage.getItem('aiva.admin.sound') !== '0'; state.notifSeen = Number(localStorage.getItem('aiva.admin.notifSeen') || 0); } catch (e) {}

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
    store: '<path d="M3 9l1.5-5h15L21 9"/><path d="M4 9v11h16V9"/><path d="M9 20v-6h6v6"/><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/>'
  };
  document.querySelectorAll('.ic').forEach(function (el) { el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[el.getAttribute('data-ic')] || '') + '</svg>'; });

  // ---------- utilidades ----------
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
  function toast(text, onclick) { var t = document.createElement('div'); t.className = 'toast'; t.textContent = text; t.onclick = function () { t.remove(); if (onclick) onclick(); }; $('toasts').appendChild(t); setTimeout(function () { t.remove(); }, 6000); }
  var audio = null;
  function beep() { if (!state.sound) return; try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); var o = audio.createOscillator(), g = audio.createGain(); o.frequency.value = 880; g.gain.value = 0.05; o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + 0.12); } catch (e) {} }

  function api(path, opts) {
    opts = opts || {};
    var headers = { 'x-admin-token': state.token };
    if (opts.body) headers['content-type'] = 'application/json';
    return fetch('/admin/api' + path, { method: opts.method || 'GET', headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined }).then(function (r) {
      if (r.status === 401) { showLogin('Token inválido'); throw new Error('401'); }
      return r.json();
    });
  }

  // ---------- login / tema / sonido ----------
  function showLogin(err) { $('login').hidden = false; $('login-err').textContent = err || ''; $('login-name').value = state.name; ($('login-name').value ? $('login-token') : $('login-name')).focus(); }
  $('login-btn').onclick = function () {
    state.name = $('login-name').value.trim() || 'asesor'; state.token = $('login-token').value.trim();
    try { localStorage.setItem('aiva.admin.token', state.token); localStorage.setItem('aiva.admin.name', state.name); } catch (e) {}
    boot();
  };
  $('login-token').onkeydown = function (e) { if (e.key === 'Enter') $('login-btn').click(); };
  $('login-name').onkeydown = function (e) { if (e.key === 'Enter') $('login-token').focus(); };
  $('logout-btn').onclick = function () { try { localStorage.removeItem('aiva.admin.token'); } catch (e) {} location.reload(); };
  function applyTheme() { document.documentElement.setAttribute('data-theme', state.theme); $('theme-btn').textContent = state.theme === 'dark' ? '☀️' : '🌙'; }
  $('theme-btn').onclick = function () { state.theme = state.theme === 'dark' ? 'light' : 'dark'; try { localStorage.setItem('aiva.admin.theme', state.theme); } catch (e) {} applyTheme(); };
  function applySound() { $('sound-btn').classList.toggle('on', state.sound); $('sound-btn').textContent = state.sound ? '🔔' : '🔕'; }
  $('sound-btn').onclick = function () { state.sound = !state.sound; try { localStorage.setItem('aiva.admin.sound', state.sound ? '1' : '0'); } catch (e) {} applySound(); };
  applyTheme(); applySound();

  // ---------- navegación ----------
  document.querySelectorAll('.nav button').forEach(function (b) { b.onclick = function () { go(b.getAttribute('data-view')); }; });
  // ---------- celular: «Más» (Análisis, Configuración, tema, sonido y salir) ----------
  document.querySelectorAll('.nav .nav-2').forEach(function (b) {
    var item = document.createElement('button');
    item.setAttribute('data-view', b.getAttribute('data-view'));
    item.innerHTML = b.innerHTML;
    item.onclick = function () { go(item.getAttribute('data-view')); };
    $('more-grid').appendChild(item);
  });
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
  function go(view, opts) {
    state.view = view;
    document.querySelectorAll('.nav button').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-view') === view); });
    // Celular: «Más» se ve activo cuando la sección está dentro de él.
    $('nav-more').classList.toggle('active', Boolean(document.querySelector('.nav .nav-2[data-view="' + view + '"]')));
    $('more-grid').querySelectorAll('[data-view]').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-view') === view); });
    closeMore();
    document.querySelectorAll('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + view); });
    if (view === 'today') loadToday();
    if (view === 'inbox') { if (opts && opts.filter) setFilter(opts.filter); else loadContacts(); }
    if (view === 'pipeline') loadPipeline();
    if (view === 'calendar') loadCalendar();
    if (view === 'analysis') loadAnalysis();
    if (view === 'agent') loadAgent();
    if (view === 'profile') loadProfile();
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
      if (state.filter === 'hot') list = list.filter(function (c) { return c.score >= 60 || c.stage === 'cita_agendada'; });
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
    el.querySelectorAll('.row').forEach(function (r) { r.onclick = function () { openContact(r.getAttribute('data-id')); }; });
  }
  // Veredicto práctico: ¿es un prospecto o no? El detalle (factores, ánimo, urgencia) queda detrás de "Ver detalle".
  function verdict(c) {
    if (c.stage === 'vendido') return { label: 'Cliente', cls: 'v-cliente', why: 'Compró.' };
    if (c.stage === 'perdido') return { label: 'Perdido', cls: 'v-perdido', why: 'Se descartó.' };
    if (c.stage === 'cita_agendada') return { label: 'Prospecto con cita', cls: 'v-cita', why: 'Ya tiene cita agendada.' };
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
    $('chat-stage').textContent = state.stageLabels[c.stage] || c.stage; $('chat-stage').className = 'chip stage-' + c.stage;
    // Una línea de texto, no una tarjeta: temperatura primero (¿urge?), número de respaldo y el porqué de más peso.
    var top = (c.scoreFactors || []).slice().sort(function (a, b) { return Math.abs(b.points) - Math.abs(a.points); })[0];
    var v = verdict(c);
    $('chat-temp').innerHTML = '<b>' + esc(v.label) + '</b> · ' + c.score + (top ? ' · ' + esc(top.label) : '') + (c.scoreAt ? ' <span title="Calculado hace ' + rel(c.scoreAt) + '">· hace ' + rel(c.scoreAt) + '</span>' : '');
    $('chat-temp').className = 'meta-line' + (isStale(c) ? ' stale' : ''); $('chat-temp').title = isStale(c) ? 'Hay mensajes nuevos: el puntaje se recalcula en unos segundos' : '';
    var who = $('chat-who'); if (!who) { who = document.createElement('span'); who.id = 'chat-who'; who.className = 'chip who'; $('chat-temp').after(who); }
    who.hidden = !c.humanMode; who.textContent = c.humanMode ? 'La lleva ' + whoHas(c) + (c.humanSince ? ' · desde hace ' + rel(c.humanSince) : '') : '';
    setMode(c.humanMode);
    var m = $('msgs');
    m.innerHTML = d.messages.map(bubble).join('');
    if (c.humanMode) m.insertAdjacentHTML('beforeend', '<div class="sysline">Aiva está en pausa: esta conversación la lleva ' + esc(whoHas(c)) + (c.humanSince ? ' desde hace ' + rel(c.humanSince) : '') + '.</div>');
    m.scrollTop = m.scrollHeight;
  }
  function bubble(msg) {
    var who = msg.role === 'user' ? 'customer' : (msg.author === 'human' ? 'human' : 'bot');
    var label = who === 'customer' ? 'Cliente' : who === 'human' ? (msg.by ? msg.by + ' (equipo)' : 'Equipo') : 'Aiva';
    return '<div class="bubble ' + who + '"><span class="who">' + label + '</span>' + esc(msg.content) + '<span class="ts">' + hhmm(msg.ts) + '</span></div>';
  }
  function setMode(human) {
    $('seg-bot').classList.toggle('on', !human); $('seg-human').classList.toggle('on', human);
    $('seg').dataset.on = human ? 'human' : 'bot';
    $('seg-bot').setAttribute('aria-pressed', String(!human)); $('seg-human').setAttribute('aria-pressed', String(human));
    $('composer-hint').hidden = human; $('reply').hidden = !human; $('send').hidden = !human;
    if (human) $('reply').focus();
  }
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
        '<div class="small muted">Probabilidad ' + c.score + ' (en tarjetas y avisos: ' + esc(tempLabel(c.temperature)) + ')' + (c.scoreAt ? ' · hace ' + rel(c.scoreAt) : '') + (isStale(c) ? ' · <b style="color:var(--warn)">hay mensajes nuevos, se recalcula solo</b>' : '') + ' · <button class="linkbtn" id="toggle-detail">' + (state.detailOpen ? 'Ocultar detalle' : 'Ver detalle') + '</button></div>' +
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
    return '<div class="row" data-id="' + esc(c.id) + '"><div class="name"><span class="n">' + esc(nameOf(c)) + '</span>' + (c.unread ? '<span class="unread">' + c.unread + '</span>' : '') + '</div><div class="time">' + rel(c.lastMessageAt) + '</div><div class="snip">' + esc(extra || c.recap || c.summary || '') + '</div><div class="meta"><span class="chip stage-' + c.stage + '">' + esc(state.stageLabels[c.stage] || c.stage) + '</span>' + scoreChip(c) + (c.humanMode ? '<span class="chip who">La lleva ' + esc(whoHas(c)) + '</span>' : '') + '</div>' + (actions ? '<div class="acts">' + actions + '</div>' : '') + '</div>';
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
      $('today').innerHTML = down + helpBanner() + sections.map(function (s) { return '<div class="panel"><h3>' + esc(s.t) + '<span class="chip">' + s.n + '</span></h3>' + (s.html || '<div class="ok">' + esc(s.empty) + '</div>') + '</div>'; }).join('');
      $('today').querySelectorAll('.row').forEach(function (r) { r.onclick = function () { go('inbox'); openContact(r.getAttribute('data-id')); }; });
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
          if (o === 'vendido') done = done.then(function () { return api('/contacts/' + encodeURIComponent(user), { method: 'PATCH', body: { stage: 'vendido' } }); });
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
  $('notif-clear').onclick = function () { state.notifSeen = state.notifs.length ? Math.max.apply(null, state.notifs.map(function (n) { return n.id; })) : 0; try { localStorage.setItem('aiva.admin.notifSeen', String(state.notifSeen)); } catch (e) {} renderNotifs(); };

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
        return '<div class="col" data-stage="' + s + '"><h3>' + esc(state.stageLabels[s]) + '<span class="muted">' + cards.length + '</span></h3><div class="cards">' +
          cards.map(function (c) { return '<div class="card" draggable="true" data-id="' + esc(c.id) + '"><div class="body"><div class="t"><button type="button" class="card-open" title="Abrir la conversación">' + esc(nameOf(c)) + '</button>' + scoreChip(c) + '</div><div class="s">' + esc(c.recap || c.summary || channelIcon(c.channel)) + '</div>' + moveTo(c) + '</div></div>'; }).join('') +
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
  function loadAnalysis() {
    api('/stats').then(function (s) {
      var tiles = [
        { n: s.total, l: 'Contactos', f: 'all' },
        { n: s.unread, l: 'Mensajes sin leer', f: 'unread' },
        { n: s.hot, l: 'Prospectos claros', f: 'hot' },
        { n: s.human, l: 'Atendidos por una persona', f: 'human' },
        { n: s.byStage.interesado, l: 'Interesados', f: 'stage:interesado' },
        { n: s.byStage.cita_agendada, l: 'Con cita agendada', f: 'stage:cita_agendada' },
        { n: s.upcomingAppointments, l: 'Citas en los próximos 7 días', v: 'calendar' },
        { n: s.messagesToday, l: 'Mensajes de clientes (24 h)', f: 'all' },
      ];
      $('tiles').innerHTML = tiles.map(function (t, i) { return '<button class="tile" data-i="' + i + '"><b>' + t.n + '</b><span>' + esc(t.l) + '</span><span class="go">ver →</span></button>'; }).join('');
      $('tiles').querySelectorAll('.tile').forEach(function (b) { b.onclick = function () { var t = tiles[Number(b.getAttribute('data-i'))]; if (t.v) go(t.v); else go('inbox', { filter: t.f }); }; });
      var max = Math.max(1, s.total);
      $('funnel').innerHTML = Object.keys(s.stageLabels).map(function (k) { var n = s.byStage[k] || 0; return '<div class="f" data-f="stage:' + k + '"><span>' + esc(s.stageLabels[k]) + '</span><div class="bar"><i style="width:' + Math.round((n / max) * 100) + '%"></i></div><b>' + n + '</b></div>'; }).join('');
      $('funnel').querySelectorAll('.f').forEach(function (f) { f.onclick = function () { go('inbox', { filter: f.getAttribute('data-f') }); }; });
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
      '<div class="small muted">Costo estimado con la tarifa estándar de OpenAI' + (u.unpriced ? ' (hay modelos sin precio conocido: el total se queda corto)' : '') + '. Los modelos locales no cuestan. Detalle por consola: <code>pnpm usage</code>.</div></div>';
  }
  function calendarPanel(cfg) {
    var f = cfg.feed;
    var busy = cfg.busy.length
      ? '<ul>' + cfg.busy.map(function (s) { return '<li>' + (s.ok ? '✓ ' : '✗ ') + esc(s.label) + ' · ' + (s.ok ? s.intervals + ' eventos próximos' + (s.syncedAt ? ', leído ' + new Date(s.syncedAt).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' }) : '') : esc(s.error || 'sin leer todavía')) + '</li>'; }).join('') + '</ul><div class="small muted">Sus eventos ocupan la agenda: el bot no ofrece esas horas. Se leen cada 5 minutos.</div>'
      : '<div class="small muted">Para que el bot no ofrezca horas en las que estás ocupado, pega en <code>CALENDAR_BUSY_ICS</code> (.env) la dirección secreta de tu calendario. En Google Calendar: Configuración → tu calendario → Integrar el calendario → Dirección secreta en formato iCal.</div>';
    return '<div class="panel"><b>Calendario</b>' +
      '<div class="small">Suscríbete desde Google Calendar, Outlook o Apple Calendar para ver las citas. El enlace es secreto: quien lo tenga ve nombres y teléfonos.</div>' +
      // Secreto de larga vida: enmascarado por defecto; "Copiar" es la acción principal y rara vez hay que verlo.
      '<div class="feed-row"><input id="feed-url" type="password" readonly value="' + esc(f.https) + '" aria-label="Enlace secreto de suscripción"><button class="btn primary" id="feed-copy">Copiar enlace</button><button class="btn sm" id="feed-show" aria-pressed="false">Mostrar</button><a class="btn sm" href="' + esc(f.webcal) + '">Abrir en Apple Calendar</a></div>' +
      (f.public ? '' : '<div class="small muted">Sin <code>PUBLIC_URL</code> el enlace solo funciona en este Mac. Google y Outlook necesitan la URL pública del túnel.</div>') +
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
  function loadProfile() { api('/profile').then(function (d) { state.profile = d; renderProfile(); }); }
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
  function renderProfile(msg) {
    var d = state.profile, sections = [];
    d.fields.forEach(function (f, i) { var s = sections.filter(function (x) { return x.name === f.section; })[0]; if (!s) sections.push(s = { name: f.section, html: '' }); s.html += profField(d, f, i); });
    var pending = d.pending.length
      ? '<b>' + d.pending.length + (d.pending.length === 1 ? ' dato por confirmar' : ' datos por confirmar') + '</b><div class="small">Si un cliente pregunta por esto, ' + esc(d.agentName) + ' no lo supone: responde «' + esc(d.verifyPhrase) + '» y te llega a Hoy › Por verificar.</div><div class="dict-chips">' + d.pending.map(function (x) { return '<span class="chip v-posible">' + esc(x) + '</span>'; }).join('') + '</div>'
      : '<b>Todo confirmado</b><div class="small">' + esc(d.agentName) + ' responde con estos datos.</div>';
    $('profile').innerHTML = '<div class="panel">' + pending + '</div>' +
      sections.map(function (s) { return '<div class="panel prof"><b>' + esc(s.name) + '</b>' + s.html + '</div>'; }).join('') +
      '<div class="panel prof"><b>Otros datos</b><div class="small muted">Lo propio de este negocio: tallas, tiempos de entrega, lo que venden o no.</div><div id="pf-extras">' +
      d.profile.extras.map(function (x, i) { return profExtra(x, i, d.profile.notes); }).join('') + '</div><div class="feed-row"><button class="btn" type="button" id="pf-add">Agregar dato</button></div></div>' +
      '<div class="panel"><div class="feed-row"><button class="btn primary" id="pf-save">Guardar perfil</button></div><div id="pf-msg" class="small" role="status">' + (msg || '') + '</div><div class="small muted">Se guarda en <code>' + esc(d.file) + '</code> (con copia del anterior) y el bot lo usa al instante.</div></div>';
    $('pf-add').onclick = function () {
      var box = $('pf-extras'), i = box.children.length;
      box.insertAdjacentHTML('beforeend', profExtra({ title: '', text: '' }, i, null));
      bindExtraRemove(); box.lastElementChild.querySelector('input').focus();
    };
    bindExtraRemove();
    $('pf-save').onclick = saveProfileForm;
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
      renderProfile('Guardado: ' + esc(state.profile.agentName) + ' ya lo usa.' + (r.indexed ? '' : ' (La búsqueda lo incluye con pnpm ingest; con OpenAI ya va completo en cada respuesta.)'));
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
        '<div class="small muted">Lo que ' + esc(a.business.name) + ' le enseña a ' + esc(a.agent.name) + ' sin tocar código: temas que se responden con su información, cómo pregunta su gente por lo que ofrece y las expresiones propias de sus clientes. Se guarda en <code>' + esc(d.file) + '</code> y se aplica al instante.</div>' +
        '<div class="small">Temas (' + d.topics.length + ')</div>' + (topics ? '<ul class="dict-list">' + topics + '</ul>' : '<div class="small muted">Todavía ninguno. Lo genérico (dónde quedan, horario, pagos, envíos) ya viene incluido.</div>') +
        '<div class="small">Verbos para preguntar por lo que ofrece (' + d.offerVerbs.length + ')</div>' + (d.offerVerbs.length ? '<div class="dict-chips">' + d.offerVerbs.map(function (v) { return '<span class="chip">' + esc(v) + '</span>'; }).join('') + '</div>' : '<div class="small muted">Solo los genéricos: tienen, venden, manejan, hacen, trabajan.</div>') +
        '<div class="small">Expresiones (' + (d.expressions || []).length + ')</div>' + ((d.expressions || []).length ? '<ul class="dict-list">' + d.expressions.map(function (x) { return '<li>«' + esc(x.says) + '» quiere decir «' + esc(x.means) + '»</li>'; }).join('') + '</ul>' : '<div class="small muted">Todavía ninguna. Se enseñan desde «Frases que no entendimos».</div>') +
        '<div class="feed-row"><button class="btn" id="dict-export">Exportar</button><button class="btn" id="dict-merge">Sumar un archivo…</button><button class="btn" id="dict-replace">Reemplazar con un archivo…</button>' +
        '<input type="file" id="dict-file" accept="application/json,.json" hidden></div>' +
        '<div id="dict-msg" role="status" class="small"></div>';
      var mode = 'merge';
      $('dict-export').onclick = function () {
        fetch('/admin/api/dictionary/export', { headers: { 'x-admin-token': state.token } }).then(function (r) {
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
        '<div class="panel"><b>Conocimiento indexado</b><div class="small">' + (a.docs.product || 0) + ' productos · ' + (a.docs.knowledge || 0) + ' fragmentos de información. Se actualiza con <code>pnpm ingest</code>.</div></div>' +
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
    error: ['Revisar', 'v-perdido'], no_disponible: ['Todavía no', 'v-no']
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
    if (p.state === 'caida') return 'No responde desde hace ' + rel(p.failingSince) + ': ' + p.error + '. Mientras tanto no funcionan el chat del sitio, WhatsApp oficial, el calendario en Google u Outlook ni el tablero desde el celular. Reinicia el túnel; si es uno rápido (trycloudflare.com), su dirección cambia: actualiza PUBLIC_URL y el código del chat en el sitio.';
    if (p.state === 'otro_servidor') return 'La dirección responde, pero no desde este servidor. Revisa a dónde apunta el túnel.';
    if (p.state === 'sin_url') return 'Sin PUBLIC_URL, el chat del sitio, WhatsApp oficial y el calendario en Google u Outlook solo funcionan en este computador.';
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
      '<div class="small muted">Antes de guardar se verifican con Meta. Quedan en el archivo .env de este equipo, no en la base ni en el repositorio, y el tablero no vuelve a mostrar el token completo.</div>' +
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
      var steps = ch.steps.length ? (ch.steps.length > 1 ? '<ol class="ch-steps">' + ch.steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' : '<div class="small">' + esc(ch.steps[0]) + '</div>') : '';
      var warnings = ch.warnings.map(function (w) { return '<div class="ch-warn">' + esc(w) + '</div>'; }).join('');
      return '<div class="panel" id="ch-' + ch.id + '"><div class="ch-head"><h2>' + esc(ch.name) + '</h2><span class="chip ' + st[1] + '">' + esc(st[0]) + '</span></div>' +
        '<div class="small muted">' + esc(ch.about) + '</div>' +
        (ch.detail ? '<div class="small">' + esc(ch.detail) + '</div>' : '') +
        (channelStats(ch) ? '<div class="ch-stats">' + esc(channelStats(ch)) + '</div>' : '') +
        (ch.qrSvg ? '<div class="ch-qr" role="img" aria-label="Código QR para vincular WhatsApp">' + ch.qrSvg + '</div>' : '') +
        steps + warnings + copy + toggle + '<div class="ch-err" id="ch-err-' + ch.id + '" role="status"></div>' + (ch.id === 'meta' ? metaCredForm(ch) : '') + '</div>';
    }).join('');
    if (credDraft && $('meta-cred-form')) {
      $('meta-cred').open = credDraft.open; $('mc-token').value = credDraft.token; $('mc-phone').value = credDraft.phone; $('mc-secret').value = credDraft.secret;
      $('mc-verify').value = credDraft.verify; $('mc-version').value = credDraft.version; $('mc-msg').innerHTML = credDraft.msg;
    }
    bindMetaCred();
    $('channels').querySelectorAll('[data-set]').forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-ch'), on = b.getAttribute('data-set') === '1';
        $('channels').querySelectorAll('[data-ch="' + id + '"]').forEach(function (x) { x.disabled = true; });
        api('/channels/' + id, { method: 'POST', body: { on: on } }).then(function (r) {
          if (r && r.error) { $('ch-err-' + id).textContent = r.error; loadChannels(); } else renderChannels(r);
        });
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
  function renderChannelsLater() {
    clearTimeout(chTimer);
    chTimer = setTimeout(function () { if (state.view === 'channels') loadChannels(); }, 30000);
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
    var es = new EventSource('/admin/api/stream?token=' + encodeURIComponent(state.token));
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
        if (state.current !== ev.userId || document.hidden) { beep(); var c = state.contacts.find(function (x) { return x.id === ev.userId; }); toast((c ? nameOf(c) : short(ev.userId)) + ': ' + p.content.slice(0, 80), function () { go('inbox'); openContact(ev.userId); }); }
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
      if (n.kind === 'verify') { beep(); toast(n.title, function () { go('today'); }); }
      else if (n.kind === 'public') { beep(); toast(n.title, function () { go('channels'); }); }
      else if (n.kind === 'handoff' || n.kind === 'hot' || n.kind === 'fail' || n.kind === 'engine') { beep(); toast(n.title, function () { if (n.userId !== 'system') { go('inbox'); openContact(n.userId); } else { go('agent'); } }); }
      if (state.view === 'today') loadToday();
    });
  }

  // ---------- arranque ----------
  function boot() {
    if (!state.token) { showLogin(); return; }
    api('/me').then(function (me) {
      $('login').hidden = true;
      $('brand-name').firstChild.textContent = me.agent + ' ';
      $('brand-biz').textContent = me.business;
      state.bizName = me.business; state.agentName = me.agent;
      document.title = me.agent + ' · Tablero';
      return api('/stats');
    }).then(function (s) {
      state.stageLabels = s.stageLabels; $('foot-user').textContent = state.name || 'asesor'; connect(); loadNotifs(); loadCalendar();
      // Enlace directo a una conversación (p. ej. desde la cita en Google Calendar): /admin#c=<id>
      var m = /^#c=(.+)$/.exec(location.hash);
      if (m) { go('inbox'); openContact(decodeURIComponent(m[1])); history.replaceState(null, '', location.pathname); } else go('today');
    }).catch(function () {});
  }
  boot();
})();
