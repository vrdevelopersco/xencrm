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
    // Ventas: un billete. Seguimientos: una flecha que vuelve, que es justo lo que es.
    venta: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
    volver: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
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
    // Dos personas: el directorio de clientes. Aparte de `user`, que es «mi cuenta» — el mismo dibujo para dos
    // cosas distintas hace dudar un segundo cada vez que se mira el riel.
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M2.6 19.4a6.6 6.6 0 0 1 12.8 0"/><path d="M16.5 5.5a3.2 3.2 0 0 1 0 6"/><path d="M18 14.2a6.6 6.6 0 0 1 3.4 5.2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    salir: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    alerta: '<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
    // Los del modo fácil: los mismos dibujos de Nexora, que son los de Lucide.
    inicio: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
    analitica: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    contacto: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M7 21v-2a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2"/>',
    citas: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"/>',
    kanban: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M8 7v7"/><path d="M12 7v4"/><path d="M16 7v9"/>',
    dolar: '<circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/>',
    reloj: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    engranaje: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    buscar: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    mas: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    abajo: '<path d="m6 9 6 6 6-6"/>',
    derecha: '<path d="m9 18 6-6-6-6"/>',
    cerrar: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    panel: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
    burbuja: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    embudo: '<path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/>',
    'mas-h': '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    objetivo: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    chispa: '<path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.14 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"/><path d="M20 3v4M22 5h-4M4 17v2M5 18H3"/>',
    actividad: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
    externo: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    escudo: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    enviar: '<path d="M14.54 21.69a.5.5 0 0 0 .94-.03l6.5-19a.5.5 0 0 0-.64-.64l-19 6.5a.5.5 0 0 0-.02.94l7.93 3.18a2 2 0 0 1 1.11 1.11z"/><path d="m21.85 2.15-10.94 10.94"/>',
    correo: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    telefono: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>'
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
  // 🪤 Quien escribe por el chat del sitio sin dar su nombre no tiene ni nombre ni número: salía «web · 44fa379b»,
  // que para quien atiende es un código, no una persona. Se dice qué es, y las cuatro letras quedan solo para
  // distinguir a dos visitantes que escribieron a la misma hora.
  function short(id) { var m = /^(wa|meta|web|cli|mcp):(.*)$/.exec(id); if (!m) return id; var v = m[2].replace(/@.*$/, ''); return m[1] === 'web' ? 'Visitante del sitio · ' + v.slice(0, 4) : v; }
  /** El canal sin su dibujito, para donde el color ya lo pone otra cosa (el punto verde del modo fácil). */
  function canalSolo(ch) { return String(channelIcon(ch)).replace(/^[^\wÀ-ÿ]+\s*/, ''); }
  function channelIcon(ch) { return { whatsapp: '🟢 WhatsApp', meta: '🟢 WhatsApp', web: '🌐 Web', cli: '⌨️ CLI', mcp: '🔌 MCP' }[ch] || ch; }
  function nameOf(c) { return c.name || short(c.id); }
  // 🪤 Los datos que captura el análisis tienen nombre de variable (`ocasion`, `fecha_evento`, `talla_o_medidas`)
  // porque así los escribe el negocio en su configuración, y así salían en la ficha: en minúscula y sin tilde. Se
  // enseñan como palabras. Las tildes que faltan se ponen solo en las palabras que se sabe que la llevan; inventar
  // una sería peor que dejarla sin.
  var TILDES = { ocasion: 'ocasión', direccion: 'dirección', telefono: 'teléfono', numero: 'número', categoria: 'categoría', dia: 'día', informacion: 'información', ubicacion: 'ubicación', descripcion: 'descripción', ultima: 'última', ultimo: 'último', ano: 'año', anos: 'años', medicion: 'medición', condicion: 'condición', tamano: 'tamaño' };
  function etiquetaDato(k) {
    var t = String(k || '').split('_').filter(Boolean).map(function (w) { return TILDES[w.toLowerCase()] || w; }).join(' ');
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  // ---------- lo que cada fila dice además del nombre ----------
  // Etapa, valor, quién la lleva y el próximo paso. El valor y el paso los calcula el servidor (crm/valor.ts y
  // crm/proximo.ts); aquí solo se pintan, y se pintan IGUAL en Clientes, Prospectos, la ficha y la conversación:
  // si el mismo dato se viera distinto en dos pantallas, alguien pensaría que son dos datos.
  function abierta(c) { var r = rol(c.stage); return r !== 'ganado' && r !== 'perdido'; }
  // Lo mismo que «calientes» en Hoy y en la barra: abierta y con 60 o más.
  function esCaliente(c) { return abierta(c) && (c.score || 0) >= 60; }
  // «Míos»: las que están a cargo de quien mira, o que está atendiendo ahora, por el nombre con el que responde.
  // Sin nombre no hay «míos». 🪤 La misma regla que esDe en crm/contacts.ts: es la que da la cifra de la barra.
  function mismoNombre(a, b) { return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase(); }
  function esMia(c) { return Boolean(state.name) && (mismoNombre(c.responsable, state.name) || (Boolean(c.humanMode) && mismoNombre(c.humanBy, state.name))); }
  /** La etapa como pastilla: punto de color Y el nombre. El punto solo no lo distingue todo el mundo. */
  function pastillaEtapa(stage) {
    return '<span class="chip etapa stage-' + esc(rol(stage) || 'activo') + '"><i class="punto" aria-hidden="true"></i>' + esc(etiquetaEtapa(stage)) + '</span>';
  }
  /**
   * Quién la lleva. Mientras conversa solo, el asistente; si la pasó al equipo y nadie la ha tomado, «El equipo».
   * 🪤 Nunca «bot» ni «admin»: son valores internos de quién la pasó, no nombres de nadie.
   */
  function llevaDe(c) {
    if (!c.humanMode) return { nombre: state.agentName || 'Aiva', es: 'asistente' };
    var b = c.humanBy;
    if (!b || b === 'bot' || b === 'admin' || b === 'equipo') return { nombre: 'El equipo', es: 'equipo' };
    return { nombre: b, es: 'persona' };
  }
  function llevaHtml(c) {
    var l = llevaDe(c);
    return '<span class="lleva ' + l.es + '"><span class="ini" aria-hidden="true">' + esc(inicialesDe(l.nombre)) + '</span><span class="nom">' + esc(l.nombre) + '</span></span>';
  }
  function pasoHtml(p) {
    if (!p || !p.texto) return '<span class="paso vacio">—</span>';
    return '<span class="paso t-' + esc(p.tipo) + (p.urgente ? ' urgente' : '') + '">' + esc(p.texto) + '</span>';
  }
  // 🪤 Sin valor es «—», no «$0»: cero diría que no vale nada, y lo que pasa es que no se sabe.
  function valorHtml(c, corto) {
    return c.valor ? '<span class="valor" title="' + esc(c.valorOrigen === 'a mano' ? 'Puesto a mano' : 'Sacado del catálogo') + '">' + esc(corto ? plataCorta(c.valor) : plata(c.valor)) + '</span>'
      : '<span class="valor vacio" title="Sin precio: ni puesto a mano ni en el catálogo">—</span>';
  }
  /** «$480 mil», «$1,2 M»: para tarjetas y cifras de arriba, donde no cabe el número entero. */
  // A mano y no con `notation: 'compact'`: según el navegador eso da «480 k» o «480 mil», y aquí se dice «mil».
  function plataCorta(n) {
    var simbolo = '$';
    try { simbolo = (new Intl.NumberFormat('es-CO', { style: 'currency', currency: state.moneda || 'COP' }).formatToParts(0).find(function (p) { return p.type === 'currency'; }) || {}).value || '$'; } catch (e) {}
    var a = Math.abs(n), cifra;
    if (a >= 1e6) cifra = (Math.round(n / 1e5) / 10).toLocaleString('es-CO') + ' M';
    else if (a >= 1e4) cifra = Math.round(n / 1e3).toLocaleString('es-CO') + ' mil';
    else cifra = Math.round(n).toLocaleString('es-CO');
    return simbolo + cifra;
  }


  // ---------- fijados ----------
  // Las fichas que alguien quiere tener a mano. Son de quien mira, no del negocio: cada asesor fija a los suyos. Se
  // guardan en la base del cliente con el nombre con el que responde (crm/fijados.ts), así lo siguen a otro
  // computador o al celular. Sin nombre no hay a quién guardárselos: viven en este navegador hasta que lo ponga.
  function fijadosLocales() { try { return JSON.parse(localStorage.getItem(LLAVE('fijados')) || '[]'); } catch (e) { return []; } }
  function fijados() { return state.name ? (state.fijados || []) : fijadosLocales(); }
  function estaFijado(id) { return fijados().some(function (f) { return f.id === id; }); }
  // El servidor manda el nombre de la ficha tal como está hoy: si alguien le corrigió el nombre, sale el nuevo.
  function aFijados(l) { return (l || []).map(function (f) { return { id: f.id, nombre: f.nombre || nameOf({ id: f.id, name: f.name }) }; }); }
  function cargarFijados() {
    if (!state.name) { pintarListas(); return; }
    return api('/fijados?yo=' + encodeURIComponent(state.name)).then(function (r) {
      if (!r || r.error) return;
      var locales = fijadosLocales();
      // 🪤 Lo que alguien fijó cuando esto vivía en el navegador no se pierde: la primera vez se sube a la base y
      // se olvida de aquí. Sin esto, el día del cambio todos amanecían sin fijados.
      if (!(r.fijados || []).length && locales.length) {
        return guardarFijadosEn(locales.map(function (f) { return f.id; })).then(function () {
          try { localStorage.removeItem(LLAVE('fijados')); } catch (e) {}
        });
      }
      state.fijados = aFijados(r.fijados);
      pintarListas();
    });
  }
  function guardarFijadosEn(ids) {
    return api('/fijados', { method: 'PUT', body: { yo: state.name, ids: ids } }).then(function (r) {
      if (!r || r.error) { toast((r && r.error) || 'No pude guardar los fijados'); return; }
      state.fijados = aFijados(r.fijados);
      pintarListas();
      if (state.view === 'clientes') renderClientes();
    });
  }
  function fijar(c, on) {
    var l = fijados().filter(function (f) { return f.id !== c.id; });
    if (on) l.unshift({ id: c.id, nombre: nameOf(c) });
    l = l.slice(0, 12);
    // Se pinta ya y se guarda detrás: esperar al servidor para ver la estrella puesta se siente roto.
    if (state.name) { state.fijados = l; pintarListas(); guardarFijadosEn(l.map(function (f) { return f.id; })); return; }
    try { localStorage.setItem(LLAVE('fijados'), JSON.stringify(l)); } catch (e) {}
    pintarListas();
  }
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
    // Quién está haciendo esto, para la historia de cada ficha. Entrando por la consola, la consola la cambia por
    // el nombre de la cuenta; con el token a secas, vale el nombre con que se responde (channels/admin.ts).
    if (state.name) headers['x-aiva-quien'] = encodeURIComponent(state.name);
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
    // 🪤 Entrando por la consola, «Salir» cierra la sesión de la consola. Antes llevaba a /, que en el despliegue es
    // la portada, y la sesión seguía abierta: desde que quien lleva un solo cliente entra directo a su tablero,
    // eso lo devolvía adentro sin haber salido. «Volver a la consola» es otra cosa y tiene su propio botón.
    if (PORLACONSOLA) {
      fetch('/api/salir', { method: 'POST' }).catch(function () {}).then(function () {
        try { localStorage.removeItem('aiva.consola.sesion'); localStorage.removeItem('aiva.consola.token'); } catch (e) {}
        location.href = '/consola';
      });
      return;
    }
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
  // Un área (Clientes, Análisis) se abre en la pestaña donde se dejó: quien vive en «Por etapa» no tiene por qué
  // pasar por la lista cada vez. AREA_DE y ultimaDelArea están más abajo, con las pestañas.
  document.querySelectorAll('.rail .nav button').forEach(function (b) {
    b.onclick = function () {
      var v = b.getAttribute('data-view'), a = AREA_DE[v], ultima = a && ultimaDelArea[a.id];
      // 🪤 La pestaña recordada puede ser una que el modo fácil esconde (Seguimientos): se abría sin pestaña marcada.
      go(ultima && !(esFacil() && SOLO_COMPLETO_VISTAS[ultima]) ? ultima : v);
    };
  });
  if ($('marca-btn')) $('marca-btn').onclick = function () { go('today'); };

  // ---------- la configuración, agrupada por de quién es ----------
  // 🪤 Estos ajustes estaban sueltos en el menú principal, seis de once botones, compitiendo por atención con
  // lo que se usa cada minuto. Pero el lío de verdad no era el sitio: era que no se veía DE QUIÉN es cada cosa.
  // El nombre del asistente es del cliente; el tuyo es tuyo; la consola es de aiva. Confundir esos tres niveles
  // costó cuatro entregas persiguiendo un nombre que se «cruzaba entre clientes». Aquí se dice en voz alta.
  var CFG_CLIENTE = [
    // Arriba de todo: es lo primero que hay que hacer con un negocio nuevo. Solo para quien administra, porque
    // cada paso lleva a una pantalla que un asesor no toca (el perfil, el catálogo, los canales).
    { view: 'guia', ic: 'check', lbl: 'Guía de inicio', soloAdmin: true },
    { view: 'profile', ic: 'store', lbl: 'Perfil del negocio' },
    { view: 'negocio', ic: 'sliders', lbl: 'El negocio' },
    { view: 'agent', ic: 'bot', lbl: 'El asistente', soloCompleto: true },
    { view: 'channels', ic: 'plug', lbl: 'Canales' },
    { view: 'knowledge', ic: 'book', lbl: 'Lo que sabe' },
    // 🪤 Solo para quien administra, y es por RUIDO, no por secreto. Quien atiende todo el día no necesita ver
    // llamadas al modelo ni centavos en cada pantalla; mezclarlo con lo del día a día hace que se deje de leer
    // todo. Quien entra con el token a secas lo ve igual: con ese token puede llamar a la ruta directamente, y
    // esconder un botón no protege nada — creerse protegido por eso sí hace daño.
    { view: 'trazas', ic: 'chart', lbl: 'Trazabilidad', soloAdmin: true, soloCompleto: true },
    // Cómo entra todo el equipo. Lo decide quien administra aiva y nadie más: es el candado (ver «modo fácil»).
    { proxy: 'modo-equipo-btn', ic: 'users', lbl: 'Modo fácil para el equipo', soloSuper: true, modo: 'equipo' }
  ];
  // Todo lo de «Este cliente» es configuración: con el candado puesto no se enseña (ver «modo fácil»).
  CFG_CLIENTE.forEach(function (d) { d.candado = true; });
  var CFG_TUYO = [
    { proxy: 'foot-user', ic: 'user', lbl: 'Con qué nombre respondes' },
    { proxy: 'modo-btn', ic: 'sliders', lbl: 'Modo fácil', modo: 'yo', soloSuper: true },
    { proxy: 'theme-btn', ic: 'sun', lbl: 'Tema claro u oscuro' },
    { proxy: 'sound-btn', ic: 'bell', lbl: 'Sonido de avisos' },
    { proxy: 'logout-btn', ic: 'salir', lbl: 'Salir' }
  ];
  /**
   * Quién entró. Por la consola llega su rol; con el token a secas no hay rol y se ve todo, que es lo correcto:
   * ese token ya abre cualquier ruta.
   */
  function rolDeQuienEntro() { return typeof window.AIVA_ROL === 'string' ? window.AIVA_ROL : ''; }
  function esAdmin() {
    var r = rolDeQuienEntro();
    return !r || r === 'super' || r === 'admin';
  }
  /** Quién manda en el modo fácil: quien administra aiva, o el token a secas. La misma regla que channels/candado.ts. */
  function mandaEnElModo() {
    var r = rolDeQuienEntro();
    return !r || r === 'super';
  }

  // 🪤 El menú de Configuración se pinta en TRES sitios —el desplegable, la lista de la sección y el menú del
  // celular—. Filtrar en uno solo dejaba la entrada visible en los otros dos: lo descubrió una sonda que
  // buscaba el botón antes de abrir ningún menú y lo encontró igual. Un filtro repartido por tres sitios es un
  // filtro que algún día se aplica en dos.
  function visiblePara(d) {
    return (!d.soloAdmin || esAdmin()) && (!d.soloSuper || mandaEnElModo());
  }

  function itemCfg(d, clase) {
    var b = document.createElement('button');
    b.className = clase + (d.soloCompleto ? ' solo-completo' : '') + (d.candado ? ' de-quien-administra' : '');
    b.innerHTML = '<i class="ic" data-ic="' + d.ic + '"></i>' + esc(d.lbl) +
      // Los interruptores dicen cómo están, en palabras: un botón que cambia algo y no dice qué hay hoy obliga a probar.
      (d.modo ? '<span class="estado-modo" data-modo-estado="' + d.modo + '"></span>' : '');
    if (d.modo) { b.setAttribute('data-modo-toggle', d.modo); b.setAttribute('aria-pressed', 'false'); }
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
      // #consola: quien atiende un solo cliente entra directo a su tablero, y sin esto volver aquí lo devolvería.
      consola.onclick = function () { location.href = '/consola#consola'; };
      pop.appendChild(consola);
      pop.appendChild(document.createElement('hr'));
    }
    var deEsteCliente = grupo('Este cliente', 'cfg-biz'), raya = document.createElement('hr');
    deEsteCliente.classList.add('de-quien-administra'); raya.className = 'de-quien-administra';
    pop.appendChild(deEsteCliente);
    CFG_CLIENTE.filter(visiblePara).forEach(function (d) { pop.appendChild(itemCfg(d, 'item')); });
    pop.appendChild(raya);
    pop.appendChild(grupo('Tú', 'cfg-yo'));
    CFG_TUYO.filter(visiblePara).forEach(function (d) { pop.appendChild(itemCfg(d, 'item')); });
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
    CFG_CLIENTE.concat([{ view: 'help', ic: 'help', lbl: 'Ayuda' }]).filter(visiblePara).forEach(function (d) {
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

  // ---------- modo fácil ----------
  // DUNOR pidió un aiva «sencillo de usar», y aiva es mucho más que eso. El modo fácil ESCONDE lo que no es del día
  // a día —el puntaje y su porqué, Análisis, Seguimientos, la configuración del asistente, las trazas, los filtros
  // de más— y no quita nada: lo escondido lleva la clase `solo-completo` y vuelve con un clic. Es la regla de
  // siempre (sencillo por fuera, todo a un clic adentro), con un interruptor en vez de un nivel más de menú.
  //
  // Dos interruptores, y los dos son de quien administra aiva: el del cliente (cómo entra todo su equipo, vive en su
  // base) y el suyo (cómo lo ve él, en su navegador, para revisar lo avanzado sin sacar a nadie del modo).
  //
  // 🪤 El CANDADO. Con el modo fácil puesto, nadie más se sale de él: ni el admin del cliente. DUNOR lo pidió así
  // —un aiva sencillo del que nadie de su lado se salga sin querer—, y por eso quien no manda no tiene interruptor
  // propio y tampoco ve la configuración del cliente. El servidor cumple la misma regla (channels/candado.ts):
  // aquí solo se dejan de enseñar puertas que allá no abren.
  //
  // 🪤 Analítica, Ventas y Seguimientos SÍ van en el modo fácil. Primero no iban —parecían lo avanzado—, pero DUNOR
  // mandó la muestra de cómo lo quería (Nexora) y las tres están en su menú: son del que vende, no del que
  // administra aiva. El servidor las abre igual (channels/candado.ts).
  var SOLO_COMPLETO_VISTAS = { agent: 1, trazas: 1 };
  var VISTAS_DE_QUIEN_ADMINISTRA = { guia: 1, profile: 1, negocio: 1, agent: 1, channels: 1, knowledge: 1, trazas: 1 };
  var FILTROS_COMPLETOS = /^(human|archived|stage:)/;
  function modoMio() { try { return localStorage.getItem(LLAVE('modo')) || ''; } catch (e) { return ''; } }
  function modoDelEquipo() {
    if (state.modoCliente) return state.modoCliente;
    try { return localStorage.getItem(LLAVE('modoCliente')) || 'completo'; } catch (e) { return 'completo'; }
  }
  function esFacil() { return ((mandaEnElModo() && modoMio()) || modoDelEquipo()) === 'facil'; }
  /** Con el candado puesto: modo fácil y quien entró no manda en él. */
  function enCandado() { return !mandaEnElModo() && modoDelEquipo() === 'facil'; }
  function aplicarModo() {
    var facil = esFacil();
    // XENCRM: la piel del fácil es la de todos (data-piel="xen" viene en el <html>), así que lo que se muda para ella
    // se queda mudado en los dos modos. El modo solo decide qué se esconde y si hay candado.
    document.documentElement.setAttribute('data-piel', 'xen');
    mudarParaElFacil(true);
    document.documentElement.setAttribute('data-modo', facil ? 'facil' : 'completo');
    document.documentElement.setAttribute('data-manda', mandaEnElModo() ? 'si' : 'no');
    document.documentElement.setAttribute('data-candado', enCandado() ? 'si' : 'no');
    document.querySelectorAll('[data-modo-toggle]').forEach(function (b) {
      var on = b.getAttribute('data-modo-toggle') === 'equipo' ? modoDelEquipo() === 'facil' : facil;
      b.setAttribute('aria-pressed', String(on));
    });
    document.querySelectorAll('[data-modo-estado]').forEach(function (el) {
      el.textContent = (el.getAttribute('data-modo-estado') === 'equipo' ? modoDelEquipo() === 'facil' : facil) ? 'Sí' : 'No';
    });
    return facil;
  }
  /** Después de cambiar de modo: lo que estaba a la vista se vuelve a pintar, y si se escondió, se va a Hoy. */
  function trasCambiarDeModo(facil) {
    if (facil && FILTROS_COMPLETOS.test(state.filter)) state.filter = 'all';
    go(facil && SOLO_COMPLETO_VISTAS[state.view] ? 'today' : state.view);
  }
  $('modo-btn').onclick = function () {
    var nuevo = esFacil() ? 'completo' : 'facil';
    try { localStorage.setItem(LLAVE('modo'), nuevo); } catch (e) {}
    trasCambiarDeModo(aplicarModo());
    toast(nuevo === 'facil' ? 'Modo fácil: lo del día a día. Lo demás vuelve con este mismo botón.' : 'Ahora ves todo XENCRM');
  };
  $('modo-equipo-btn').onclick = function () {
    var nuevo = modoDelEquipo() === 'facil' ? 'completo' : 'facil';
    api('/tablero/modo', { method: 'PUT', body: { modo: nuevo } }).then(function (r) {
      if (!r || r.error) { toast('No se pudo: ' + ((r && r.error) || 'sin respuesta')); return; }
      state.modoCliente = r.modo;
      // Quien lo cambia pasa a verlo como lo verá su equipo: si no, lo cambiaría sin ver qué cambió.
      try { localStorage.setItem(LLAVE('modoCliente'), r.modo); localStorage.removeItem(LLAVE('modo')); } catch (e) {}
      trasCambiarDeModo(aplicarModo());
      toast(r.modo === 'facil'
        ? 'El equipo de ' + (state.bizName || 'este cliente') + ' entra en modo fácil y no puede salirse. Tú ves todo desde Configuración › Modo fácil.'
        : 'El equipo de ' + (state.bizName || 'este cliente') + ' entra viendo todo');
    });
  };
  aplicarModo();
  // 🪤 Los íconos de aquí se pintan al abrir: el primer iconos() corre antes de que armarCfg cree estos botones, y
  // en el celular todo «Más» salía con el hueco del ícono vacío.
  function openMore() { iconos($('more-grid')); $('more-sheet').hidden = false; $('nav-more').setAttribute('aria-expanded', 'true'); var first = $('more-grid').querySelector('button'); if (first) first.focus(); }
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
  var CFG_VIEWS = { guia: 1, agent: 1, channels: 1, knowledge: 1, help: 1, trazas: 1 };
  // 🪤 En las pantallas de configuración el panel decía lo mismo que el título de la página, dos veces en la
  // misma fila. Aquí dice el ÁREA —dónde estás— y la lista de abajo dice la pantalla: cada uno aporta algo.
  var TITULOS = { today: 'Hoy', inbox: 'Conversaciones', calendar: 'Calendario', pipeline: 'Clientes', clientes: 'Clientes', ventas: 'Análisis', seguimientos: 'Clientes', analysis: 'Análisis', agent: 'Configuración', channels: 'Configuración', knowledge: 'Configuración', help: 'Configuración', trazas: 'Configuración', guia: 'Configuración' };
  function pintarPanel(view) {
    var panel = $('subnav');
    if (!panel) return;
    var conPanel = CFG_VIEWS[view];
    document.querySelector('.app').setAttribute('data-subnav', conPanel ? 'si' : 'no');
    if (!conPanel) return;
    $('subnav-titulo').textContent = TITULOS[view] || '';
    var cfg = $('subnav-cfg');
    cfg.hidden = !CFG_VIEWS[view];
    if (CFG_VIEWS[view] && !cfg.childElementCount) {
      CFG_CLIENTE.concat([{ view: 'help', ic: 'help', lbl: 'Ayuda' }]).filter(visiblePara).forEach(function (d) { cfg.appendChild(itemCfg(d, 'item')); });
      iconos(cfg);
    }
    cfg.querySelectorAll('[data-view]').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-view') === view); });
    aplicarModo(); // los interruptores de aquí nacen tarde: que digan cómo están
  }

  // ---------- las áreas y sus pestañas ----------
  // 🪤 El riel tenía ocho secciones y la mitad eran la misma gente vista de otra forma (Prospectos, Clientes,
  // Seguimientos) o los mismos números (Análisis, Ventas). Para quien empieza eran ocho puertas sin saber cuál
  // abrir. Ahora son áreas: el riel lleva al área y arriba de la pantalla van sus pestañas. Nada se quitó, quedó
  // un clic más adentro: quien quiera exprimir aiva lo encuentra donde estaba.
  //
  // 🪤 Pestañas en la barra de arriba y NO en el panel de la sección: ese panel le quita 212 px al tablero y a la
  // tabla, que son justo las pantallas que necesitan el ancho (por eso se quitó también de Conversaciones).
  var AREAS = [
    // Seguimientos no va en el modo fácil: los calientes que esperan ya salen en Hoy, que es donde se miran.
    { id: 'clientes', lbl: 'Clientes', subs: [{ view: 'clientes', lbl: 'Lista' }, { view: 'pipeline', lbl: 'Por etapa', cuenta: 'cuenta-pip' }, { view: 'seguimientos', lbl: 'Seguimientos', soloCompleto: true }] },
    { id: 'analisis', lbl: 'Análisis', subs: [{ view: 'analysis', lbl: 'Resumen' }, { view: 'ventas', lbl: 'Ventas' }] }
  ];
  var AREA_DE = {};
  var ultimaDelArea = {};
  try { ultimaDelArea = JSON.parse(localStorage.getItem(LLAVE('areas')) || '{}') || {}; } catch (e) {}
  AREAS.forEach(function (a) {
    a.subs.forEach(function (x) { AREA_DE[x.view] = a; });
    var g = document.createElement('div');
    g.className = 'tabs area-tabs';
    g.setAttribute('role', 'group');
    g.setAttribute('aria-label', 'Qué ver en ' + a.lbl);
    g.innerHTML = a.subs.map(function (x) {
      return '<button data-sub="' + x.view + '" aria-pressed="false"' + (x.soloCompleto ? ' class="solo-completo"' : '') + '>' + esc(x.lbl) + (x.cuenta ? '<span class="n-tab" id="' + x.cuenta + '"></span>' : '') + '</button>';
    }).join('');
    g.querySelectorAll('[data-sub]').forEach(function (b) { b.onclick = function () { go(b.getAttribute('data-sub')); }; });
    a.tabs = g;
    // El título de cada pantalla del área dice el ÁREA, y la pestaña dice cuál: lo mismo que Configuración.
    a.subs.forEach(function (x) { var h = document.querySelector('#view-' + x.view + ' .topbar h1'); if (h) h.textContent = a.lbl; });
    // 🪤 Las pestañas son UN solo nodo que se muda de pantalla en pantalla (así sus id no se repiten), y nace ya
    // dentro del documento: fuera de él, getElementById no lo encuentra y la cuenta de «Por etapa» reventaba.
    var h0 = document.querySelector('#view-' + a.subs[0].view + ' .topbar h1');
    if (h0) h0.after(g);
  });
  function pintarPestanasArea(view) {
    var a = AREA_DE[view]; if (!a) return;
    var h = document.querySelector('#view-' + view + ' .topbar h1');
    if (h && h.nextSibling !== a.tabs) h.after(a.tabs);
    a.tabs.querySelectorAll('[data-sub]').forEach(function (b) { var on = b.getAttribute('data-sub') === view; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    ultimaDelArea[a.id] = view;
    try { localStorage.setItem(LLAVE('areas'), JSON.stringify(ultimaDelArea)); } catch (e) {}
  }

  // ---------- el menú del modo fácil ----------
  // 🪤 Es el de Nexora, la muestra que mandó DUNOR: dos grupos y cada pantalla con su puerta, sin pestañas
  // adentro. Las mismas pantallas del completo —ninguna nueva—: lo que cambia es cómo se llega a ellas.
  // XENCRM habla como un CRM de mensajería (SendPulse): la bandeja es la «Bandeja omnicanal» —todos los canales en
  // un solo sitio— y cada persona en su etapa es un «trato». Mismas pantallas y mismas rutas; cambian el orden y
  // los nombres (ver el glosario en docs/xencrm.md).
  var MENU_FACIL = [
    { grupo: 'Principal', items: [{ view: 'today', lbl: 'Inicio', ic: 'inicio' }, { view: 'inbox', lbl: 'Bandeja omnicanal', ic: 'inbox', n: 'fx-n-inbox' }, { view: 'analysis', lbl: 'Analítica', ic: 'analitica' }] },
    { grupo: 'CRM', items: [{ view: 'clientes', lbl: 'Contactos', ic: 'contacto' }, { view: 'pipeline', lbl: 'Tratos', ic: 'kanban' }, { view: 'calendar', lbl: 'Citas', ic: 'citas', n: 'fx-n-citas' }, { view: 'ventas', lbl: 'Ventas', ic: 'dolar' }, { view: 'seguimientos', lbl: 'Seguimientos', ic: 'reloj' }] }
  ];
  (function armarMenuFacil() {
    var nav = $('nav-fx');
    if (!nav) return;
    nav.innerHTML = MENU_FACIL.map(function (g) {
      return '<div class="fx-grupo">' + esc(g.grupo) + '</div><ul>' + g.items.map(function (x) {
        return '<li><button class="fx-item" data-view="' + x.view + '"><i class="ic" data-ic="' + x.ic + '"></i><span>' + esc(x.lbl) + '</span>' +
          (x.n ? '<span class="fx-n" id="' + x.n + '"></span>' : '') + '</button></li>';
      }).join('') + '</ul>';
    }).join('');
    iconos(nav);
    nav.querySelectorAll('[data-view]').forEach(function (b) { b.onclick = function () { go(b.getAttribute('data-view')); }; });
  })();
  // Celular: el menú se abre desde la barra de arriba y se cierra al elegir, al tocar fuera o con Escape.
  function menuFacil(abrir) {
    var app = document.querySelector('.app');
    if (!app) return;
    var estaba = app.getAttribute('data-menu') === 'abierto';
    if (abrir) app.setAttribute('data-menu', 'abierto'); else app.removeAttribute('data-menu');
    if ($('fx-velo')) $('fx-velo').hidden = !abrir;
    if ($('fx-abrir-menu')) $('fx-abrir-menu').setAttribute('aria-expanded', String(Boolean(abrir)));
    if (abrir) { var a = document.querySelector('#nav-fx .fx-item.active') || document.querySelector('#nav-fx .fx-item'); if (a) a.focus(); }
    else if (estaba && $('fx-abrir-menu') && onPhoneFacil()) $('fx-abrir-menu').focus();
  }
  function onPhoneFacil() { return window.matchMedia('(max-width: 900px)').matches; }
  if ($('fx-abrir-menu')) $('fx-abrir-menu').onclick = function () { menuFacil(true); };
  if ($('fx-cerrar-menu')) $('fx-cerrar-menu').onclick = function () { menuFacil(false); };
  if ($('fx-velo')) $('fx-velo').onclick = function () { menuFacil(false); };

  // ---------- la barra de arriba del modo fácil ----------
  // Cada botón abre lo que ya existía: la búsqueda de Ctrl+K, la ficha nueva, la Ayuda, la campana, tu nombre.
  // Ninguno trae una función propia, así que no hay dos formas distintas de hacer lo mismo.
  function cerrarPopsFacil(menos) {
    [['fx-crear', 'fx-crear-pop'], ['fx-yo', 'fx-yo-pop']].forEach(function (p) {
      if (p[1] === menos || !$(p[1]) || $(p[1]).hidden) return;
      $(p[1]).hidden = true; $(p[0]).setAttribute('aria-expanded', 'false');
    });
  }
  function popFacil(boton, pop) {
    if (!$(boton)) return;
    $(boton).onclick = function (e) {
      e.stopPropagation();
      var abrir = $(pop).hidden;
      cerrarPopsFacil(pop);
      $(pop).hidden = !abrir;
      $(boton).setAttribute('aria-expanded', String(abrir));
      if (abrir) { iconos($(pop)); var b = $(pop).querySelector('button'); if (b) b.focus(); }
    };
  }
  popFacil('fx-crear', 'fx-crear-pop');
  popFacil('fx-yo', 'fx-yo-pop');
  document.addEventListener('click', function (e) { if (!e.target.closest || !e.target.closest('.fx-pop')) cerrarPopsFacil(); });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var abierto = ['fx-crear-pop', 'fx-yo-pop'].filter(function (p) { return $(p) && !$(p).hidden; })[0];
    if (abierto) { cerrarPopsFacil(); $(abierto === 'fx-crear-pop' ? 'fx-crear' : 'fx-yo').focus(); return; }
    if (document.querySelector('.app[data-menu="abierto"]')) menuFacil(false);
  });
  document.querySelectorAll('[data-crear]').forEach(function (b) {
    b.onclick = function (e) {
      e.stopPropagation(); cerrarPopsFacil();
      if (b.getAttribute('data-crear') === 'contacto') { $('cli-nuevo').click(); return; }
      go('calendar');
      setTimeout(function () { if ($('book-contact')) $('book-contact').focus(); }, 300);
    };
  });
  // 🪤 Los de «tu cuenta» paran el clic: cada uno abre algo que se cierra al primer clic fuera de él, y este clic,
  // al subir, contaba como «fuera» y lo cerraba en el mismo instante en que se abría.
  document.querySelectorAll('[data-yo]').forEach(function (b) {
    b.onclick = function (e) {
      e.stopPropagation(); cerrarPopsFacil();
      // El engranaje se abre junto a donde se tocó: arriba a la derecha, y no abajo en el menú.
      if (b.getAttribute('data-yo') === 'cfg-btn') $('cfg-pop').classList.add('desde-arriba');
      $(b.getAttribute('data-yo')).click();
    };
  });
  if ($('cfg-btn')) $('cfg-btn').addEventListener('click', function (e) { if (e.isTrusted) $('cfg-pop').classList.remove('desde-arriba'); });
  if ($('fx-buscar')) $('fx-buscar').onclick = function () { abrirPaleta(); };
  if ($('fx-ayuda')) $('fx-ayuda').onclick = function () { go('help'); };
  if ($('fx-campana')) $('fx-campana').onclick = function (e) { e.stopPropagation(); cerrarPopsFacil(); $('notif').classList.toggle('open'); };

  // La cabecera de cada pantalla en el modo fácil: un título grande y una línea que dice para qué sirve. Va aparte
  // del h1 del completo (que dice el ÁREA, con sus pestañas al lado) para no tocar ese.
  function saludo() { var h = new Date().getHours(); return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches'; }
  function cabeceraFacil(view) {
    var biz = state.bizName || 'tu negocio', nombre = (state.name || '').trim().split(/\s+/)[0];
    var c = {
      today: [saludo() + (nombre ? ', ' + nombre : ''), 'Este es el pulso de ' + biz + ' hoy.'],
      analysis: ['Analítica', 'Cómo llega la gente, a qué horas escribe y cuánto se tarda en contestar.'],
      clientes: ['Contactos', 'Todas las personas que han hablado con ' + biz + '.'],
      calendar: ['Citas', 'La agenda de ' + biz + ': haz clic en un hueco libre para agendar.'],
      pipeline: ['Tratos', 'Cada contacto en su etapa del embudo: arrastra la tarjeta o usa «Mover…».'],
      ventas: ['Ventas', 'Lo que se vendió y lo que se perdió, con el porqué.'],
      seguimientos: ['Seguimientos', 'A quién hay que escribirle y por qué.'],
      help: ['Ayuda', 'Lo esencial del tablero en dos minutos.']
    }[view];
    var barra = document.querySelector('#view-' + view + ' > .topbar');
    if (!barra) return;
    var cab = barra.querySelector('.fx-cab');
    if (!cab) {
      cab = document.createElement('div');
      cab.className = 'fx-cab solo-facil';
      cab.innerHTML = '<h1></h1><p></p>';
      barra.insertBefore(cab, barra.firstChild);
    }
    var h1 = barra.querySelector(':scope > h1');
    cab.querySelector('h1').textContent = c ? c[0] : (h1 ? h1.textContent : '');
    cab.querySelector('p').textContent = c ? c[1] : '';
  }

  function go(view, opts) {
    // 🪤 Con el candado, lo de quien administra no se abre por ninguna puerta: no solo el menú, también un aviso
    // del sistema, el «cárgalos» de los precios o la última pantalla que el navegador recordaba.
    if (enCandado() && VISTAS_DE_QUIEN_ADMINISTRA[view]) {
      // Desde una pantalla que sí puede ver, se queda donde estaba. Si ya estaba en una de esas (el candado se
      // puso mientras miraba), a Hoy.
      if (state.view !== view && !VISTAS_DE_QUIEN_ADMINISTRA[state.view]) { toast('Eso lo maneja quien administra aiva.'); return; }
      view = 'today';
    }
    // Perfil y El negocio no son pantallas: son configuración, y se abren en un modal encima de lo que estabas
    // haciendo. Así no se pierde de vista la conversación ni hay que volver a navegar.
    if (view === 'profile' || view === 'negocio') { abrirConfig(view); return; }
    state.view = view;
    var area = AREA_DE[view], enRiel = area ? area.subs[0].view : view;
    document.querySelectorAll('.rail .nav button').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-view') === enRiel); });
    pintarPestanasArea(view);
    pintarPanel(view);
    // Celular: «Más» se ve activo cuando la sección está dentro de él.
    $('nav-more').classList.toggle('active', Boolean(CFG_VIEWS[view]));
    $('more-grid').querySelectorAll('[data-view]').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-view') === view); });
    closeMore();
    // El menú del modo fácil marca la pantalla misma (allí no hay áreas con pestañas) y se cierra en el celular.
    document.querySelectorAll('#nav-fx [data-view]').forEach(function (b) {
      var on = b.getAttribute('data-view') === view;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    cabeceraFacil(view);
    menuFacil(false);
    document.querySelectorAll('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + view); });
    if (view === 'today') loadToday();
    if (view === 'inbox') { if (opts && opts.filter) setFilter(opts.filter); else loadContacts(); }
    if (view === 'pipeline') loadPipeline();
    if (view === 'clientes') loadClientes();
    if (view === 'calendar') loadCalendar();
    if (view === 'analysis') loadAnalysis();
    if (view === 'agent') loadAgent();
    if (view === 'help') loadHelp();
    if (view === 'guia') cargarGuia();
    if (view === 'channels') loadChannels();
    // Al entrar se pasa por pestanaSabe y no por loadKnowledge a secas: es pestanaSabe quien decide qué
    // pestaña está puesta y qué se enseña con ella. Llamando solo a loadKnowledge, la pantalla salía con la
    // pestaña «Información» marcada pero sin su caja de cargar documentos, que es justo lo que se viene a hacer.
    if (view === 'knowledge') pestanaSabe(state.kind || 'knowledge');
    if (view === 'trazas') cargarTrazas(state.tzDias || 7);
    if (view === 'ventas') cargarVentas(state.venDias || 90);
    if (view === 'seguimientos') cargarSeguimientos();
  }

  // ---------- bandeja ----------
  function setFilter(f) { state.filter = f; document.querySelectorAll('#filters button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-f') === f); }); loadContacts(); }
  document.querySelectorAll('#filters button[data-f]').forEach(function (b) { b.onclick = function () { setFilter(b.getAttribute('data-f')); }; });
  $('marcar-leidas').onclick = function () {
    api('/contacts/leidas', { method: 'POST' }).then(function (r) {
      if (r && r.error) { toast(r.error); return; }
      toast(r.cuantas ? (r.cuantas === 1 ? 'Una conversación marcada como leída' : r.cuantas + ' conversaciones marcadas como leídas') : 'No había nada sin leer');
      loadContacts();
    });
  };
  var qTimer; $('q').oninput = function () { clearTimeout(qTimer); qTimer = setTimeout(function () { state.q = $('q').value.trim(); loadContacts(); }, 250); };

  function loadContacts() {
    var params = [];
    if (state.q) params.push('q=' + encodeURIComponent(state.q));
    if (state.filter.indexOf('stage:') === 0) params.push('stage=' + state.filter.slice(6));
    if (state.filter === 'human') params.push('human=1');
    if (state.filter === 'archived') params.push('archived=1');
    return api('/contacts' + (params.length ? '?' + params.join('&') : '')).then(function (list) {
      if (state.filter === 'unread') list = list.filter(function (c) { return c.unread > 0; });
      if (state.filter === 'mios') list = list.filter(esMia);
      if (state.filter === 'sin-asignar') list = list.filter(sinAsignar);
      if ($('f-mios')) $('f-mios').hidden = !state.name;
      if (state.filter === 'hot') list = list.filter(function (c) { return c.score >= 60 || rol(c.stage) === 'cita'; });
      state.contacts = list; renderRows(); updateBadges(); pintarFiltroFacil();
    });
  }
  // La Bandeja omnicanal: un solo filtro (state.filter), enseñado en dos controles. Arriba, de quién son (Mías ·
  // Sin asignar · Todas); abajo, «Todos los estados», que se arma con los botones de estado de #filters. Elegir un
  // estado mira en todas (el segmentado vuelve a «Todas»); elegir Mías o Sin asignar deja el estado en «Todos».
  // 🪤 Los de solo-completo se ofrecen solo fuera del modo fácil: escondidos como botón, no pueden volver por aquí.
  var FILTROS_DE_QUIEN = { mios: 1, 'sin-asignar': 1 };
  function pintarFiltroFacil() {
    var sel = $('fx-filtro');
    if (!sel) return;
    var facil = esFacil();
    var opciones = Array.prototype.filter.call(document.querySelectorAll('#filters button.fx-estado[data-f]'), function (b) {
      return !b.hidden && !(facil && b.classList.contains('solo-completo'));
    });
    var deQuien = FILTROS_DE_QUIEN[state.filter];
    sel.innerHTML = '<option value="all"' + (deQuien || state.filter === 'all' ? ' selected' : '') + '>Todos los estados</option>' + opciones.map(function (b) {
      var f = b.getAttribute('data-f');
      return '<option value="' + esc(f) + '"' + (f === state.filter ? ' selected' : '') + '>' + esc(b.textContent) + '</option>';
    }).join('');
    document.querySelectorAll('#filters .fx-asig button[data-f]').forEach(function (b) {
      var f = b.getAttribute('data-f'), on = f === state.filter || (f === 'all' && !deQuien);
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
    });
    var n = state.contacts.length;
    if ($('fx-inbox-n')) $('fx-inbox-n').textContent = n === 1 ? '1 conversación' : n + ' conversaciones';
  }
  if ($('fx-filtro')) $('fx-filtro').onchange = function () { setFilter($('fx-filtro').value); };
  function renderRows() {
    var el = $('rows');
    if (!state.contacts.length) {
      // Vacío con salida: qué filtro dejó la lista en cero y cómo volver a verlas todas.
      var conFiltro = state.filter !== 'all' || state.q;
      el.innerHTML = '<div class="empty fx-vacio-bandeja"><b>' + (conFiltro ? 'Nada por aquí con este filtro' : 'Todavía no hay conversaciones') + '</b>' +
        '<span>' + (conFiltro ? 'Prueba con «Todas» o borra la búsqueda.' : 'Lo que escriban por WhatsApp o por el chat del sitio llega aquí.') + '</span>' +
        (conFiltro ? '<button class="btn sm" type="button" id="fx-ver-todas">Ver todas</button>' : '') + '</div>';
      if ($('fx-ver-todas')) $('fx-ver-todas').onclick = function () { if (state.q) { $('q').value = ''; state.q = ''; } setFilter('all'); };
      return;
    }
    el.innerHTML = state.contacts.map(function (c) {
      // 🪤 Dos líneas, no tres. El estado subía a su propia fila y una conversación ocupaba lo mismo que tres
      // de un chat normal: con doce en pantalla hay que bajar para ver quién lleva esperando. Las etiquetas se
      // van arriba, al lado de la hora, donde ya se estaba mirando.
      //
      // 🪤 Y siguen siendo TEXTO, no un punto de color. Un punto es más compacto y deja fuera a quien no
      // distinga ese matiz —y con el contraste alto del sistema, a todo el mundo—. Compacto no puede salir a
      // costa de que deje de leerse.
      // 🪤 El veredicto solo se enseña cuando DICE algo. Casi todas las conversaciones están en «Sin señales
      // aún», así que esa etiqueta aparecía en nueve de cada diez filas: una etiqueta que se repite en todas no
      // informa, ocupa. Quitándola de las que no dicen nada, las que sí —«Prospecto con cita», «Cliente»—
      // saltan a la vista, y de paso cabe la conversación en dos renglones sin recortar nada.
      var v = verdict(c);
      var marcas = (v.cls === 'v-no' ? '' : verdictChip(c)) +
        (c.humanMode ? '<span class="chip who">La lleva ' + esc(whoHas(c)) + '</span>' : '');
      var texto = c.hit
        ? '<span class="snip hit"><span class="who">' + esc(c.hit.role === 'user' ? nameOf(c) : state.agentName || 'Aiva') + ':</span> ' + mark(c.hit.content, state.q) + '</span>'
        : '<span class="snip"' + (c.summary ? ' title="' + esc(c.summary) + '"' : '') + '>' + esc(c.recap || c.summary || '') + '</span>';
      // La fila de la Bandeja omnicanal: el avatar con la insignia de su canal, el nombre y la hora (en el acento
      // si hay algo sin leer), y debajo lo que dijo con los no leídos en píldora. Las marcas que dicen algo van en
      // su propio renglón, enteras: «La lleva…» cortado en «La lle…» no es una marca.
      var canal = canalDeXen(c.channel);
      return '<div class="row' + (state.current === c.id ? ' sel' : '') + (c.unread ? ' con-nuevos' : '') + '" data-id="' + esc(c.id) + '">' +
        avatarXen(c, 'fx-av-fila solo-facil') +
        '<div class="name"><span class="n">' + esc(nameOf(c)) + '</span><span class="sr-only"> · ' + esc(canal.t) + '</span></div>' +
        '<div class="time">' + rel(c.lastMessageAt) + '</div>' +
        // Segunda línea: lo que dijo, y los no leídos al final. Lo que cede es el texto, que para eso lleva el
        // resumen entero en el título.
        '<div class="linea2">' + texto + (c.unread ? '<span class="unread" title="' + c.unread + ' sin leer">' + c.unread + '<span class="sr-only"> sin leer</span></span>' : '') + '</div>' +
        (marcas || c.responsable ? '<div class="fx-marcas">' + marcas + (c.responsable ? '<span class="fx-asig-mini" title="Asignado a ' + esc(c.responsable) + '"><span aria-hidden="true">' + esc(inicialesDe(c.responsable)) + '</span><span class="sr-only">Asignado a ' + esc(c.responsable) + '</span></span>' : '') + '</div>' : '') +
        '</div>';
    }).join('');
    el.querySelectorAll('.row').forEach(function (r) {
      r.onclick = function () { openContact(r.getAttribute('data-id')); };
      r.oncontextmenu = function (e) { e.preventDefault(); abrirMenu(e.clientX, e.clientY, r.getAttribute('data-id')); };
      // Con el teclado también: Tab llega a cada conversación y Enter (o espacio) la abre.
      r.tabIndex = 0; r.setAttribute('role', 'button');
      r.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openContact(r.getAttribute('data-id')); } };
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
  // 🪤 «bot» y «admin» no son nombres (regla de diseno-tablero.md): «La lleva admin» no le dice a nadie quién es.
  function whoHas(c) { return c.humanBy && c.humanBy !== 'bot' && c.humanBy !== 'admin' ? c.humanBy : 'el equipo'; }
  // «Prospecto claro» y «Posible prospecto» salen del puntaje: en el modo fácil se van con él. Los de la etapa
  // (con cita, cliente, perdido) se quedan, que esos los entiende cualquiera.
  function verdictChip(c) { var v = verdict(c); return '<span class="chip ' + v.cls + (v.cls === 'v-si' || v.cls === 'v-posible' ? ' solo-completo' : '') + (isStale(c) ? ' stale' : '') + '" title="Probabilidad ' + c.score + (c.scoreAt ? ' · calculada hace ' + rel(c.scoreAt) : '') + '">' + esc(v.label) + '</span>'; }
  function isStale(c) { return c.scoreAt && c.lastMessageAt && c.lastMessageAt > c.scoreAt + 20000; }
  function tempLabel(t) { return t === 'frio' ? 'frío' : t; } // el valor interno va sin tilde; la palabra, con
  // En el modo fácil solo queda la de «caliente»: es la única que pide hacer algo. «0 · frío» es una cuenta interna.
  function scoreChip(c) { return '<span class="chip t-' + c.temperature + (c.temperature === 'caliente' ? '' : ' solo-completo') + (isStale(c) ? ' stale' : '') + '" title="' + (c.scoreAt ? 'Calculado hace ' + rel(c.scoreAt) : 'Sin análisis') + '">' + c.score + ' · ' + tempLabel(c.temperature) + (isStale(c) ? ' (desactualizado)' : '') + '</span>'; }
  function sentIcon(s) { return { positivo: '😊 positivo', neutral: '😐 neutral', negativo: '😠 negativo' }[s] || s; }
  function updateBadges() {
    var unread = state.contacts.reduce(function (a, c) { return a + (c.unread || 0); }, 0);
    $('badge-unread').textContent = unread ? String(unread) : '';
    // En el menú del modo fácil, como en Nexora: cuántas conversaciones tienen algo sin leer (no cuántos mensajes).
    if ($('fx-n-inbox')) { var conAlgo = state.contacts.filter(function (c) { return c.unread > 0; }).length; $('fx-n-inbox').textContent = conAlgo ? String(conAlgo) : ''; }
  }

  function openContact(id, draft) {
    state.current = id;
    renderRows();
    $('inbox').setAttribute('data-pane', 'chat');
    return api('/contacts/' + encodeURIComponent(id)).then(function (d) {
      state.detail = d; renderChat(); renderDetails();
      anunciarme(id, d.presentes || []);
      // ¿Otra ficha de la misma persona? Se guarda para que el panel no la pierda al volver a pintarse.
      api('/contacts/' + encodeURIComponent(id) + '/duplicates').then(function (l) { state.dups = { id: id, list: l }; renderDuplicates(l); });
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
    // 🪤 La clase se reescribe entera en cada pintado: el `solo-completo` del HTML se perdía aquí y el modo fácil
    // seguía enseñando el puntaje en la cabecera de cada conversación.
    $('chat-temp').className = 'meta-line solo-completo' + (isStale(c) ? ' stale' : ''); $('chat-temp').title = isStale(c) ? 'Hay mensajes nuevos: el puntaje se recalcula en unos segundos' : '';
    var who = $('chat-who'); if (!who) { who = document.createElement('span'); who.id = 'chat-who'; who.className = 'chip who'; $('chat-temp').after(who); }
    who.hidden = !c.humanMode; who.textContent = c.humanMode ? 'La lleva ' + whoHas(c) + (c.humanSince ? ' · desde hace ' + rel(c.humanSince) : '') : '';
    cajonDeLaConversacion(c);
    setMode(c.humanMode);
    // La cabecera de la Bandeja omnicanal. Quién responde va dicho en palabras, no solo en el color de la pastilla:
    // si contesta el agente de IA o si la automatización está en pausa y quién la lleva.
    if ($('fx-chat-ini')) pintarCabeceraXen(d);
    pintarPropuesta(d.propuesta);
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
    if (c.humanMode) m.insertAdjacentHTML('beforeend', '<div class="sysline">' + esc(state.agentName || 'Aiva') + ' está en pausa: esta conversación la lleva ' + esc(whoHas(c)) + (c.humanSince ? desdeXen(c.humanSince) : '') + '.</div>');
    pintarAdjuntos(m);
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
    var label = who === 'customer' ? 'Cliente' : who === 'human' ? (msg.by ? esc(msg.by) + ' (equipo)' : 'Equipo') : esc(state.agentName || 'Aiva');
    // «¿por qué?»: el turno que produjo esta respuesta (src/crm/turnos.ts). Solo para quien administra, por ruido.
    var porQue = who === 'bot' && msg.turno && esAdmin()
      ? '<button class="por-que solo-completo" type="button" data-turno="' + esc(msg.turno) + '" aria-expanded="false">¿por qué?</button>' : '';
    // 🪤 Lo que no le llegó al cliente se dice EN el mensaje, con el motivo y cómo volver a mandarlo. Quien lo
    // mandó vio el error en ese momento; quien abra la conversación mañana solo lo sabe si queda aquí.
    var noSalio = msg.fallo && who !== 'customer'
      ? '<span class="no-salio"><b>No le llegó.</b> ' + esc(msg.fallo) + ' <button class="linkbtn" type="button" data-reintentar="' + esc(String(msg.id)) + '">Volver a intentar</button></span>' : '';
    return '<div class="bubble ' + who + (msg.fallo ? ' fallo' : '') + '"><span class="who">' + label + '</span>' + adjunto(msg.media) + esc(msg.content) +
      noSalio + '<span class="ts">' + hhmm(msg.ts) + porQue + '</span></div>';
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-reintentar]');
    if (!b || !state.current) return;
    var id = state.current;
    b.disabled = true; b.textContent = 'Mandando…';
    api('/contacts/' + encodeURIComponent(id) + '/mensajes/' + encodeURIComponent(b.getAttribute('data-reintentar')) + '/reintentar', { method: 'POST' })
      .then(function (r) {
        toast(r && r.error ? 'Tampoco salió: ' + r.error : 'Ahora sí le llegó');
        if (state.current === id) openContact(id);
      })
      .catch(function () { b.disabled = false; b.textContent = 'Volver a intentar'; toast('No pude intentarlo otra vez.'); });
  });

  // Las guardas como se dicen: lo que el asistente iba a decir y por qué no salió así.
  function guardaLegible(g) {
    var i = g.indexOf(':'), k = i < 0 ? g : g.slice(0, i), v = i < 0 ? '' : g.slice(i + 1);
    return ({
      'cifras': 'traía cifras que no están en la información (' + v + ')',
      'sin_respaldo': 'afirmaba algo sin respaldo («' + v + '»): se pasó a verificar',
      'promesa': 'prometía plata que el negocio no ofrece («' + v + '»): no salió',
      'recito': 'recitaba sus instrucciones: salió una respuesta fija',
      'cita_inventada': 'daba por hecha una cita que no existe',
      'tope': 'tope de gasto alcanzado: pasó al equipo',
      'falló': 'falló el motor ' + v
    })[k] || g;
  }
  function trazaHtml(t) {
    var usd = function (n) { return '$' + (n < 0.01 ? n.toFixed(4) : n.toFixed(3)); };
    var lineas = [
      '<b>Entendió</b> ' + esc(t.intent || '—') + (t.via ? ' (' + esc(t.via) + ')' : ''),
      t.ruta ? '<b>Ruta</b> ' + esc(t.ruta) : '',
      '<b>Contestó</b> ' + esc(t.motor || '—') + (t.modelo ? ' · ' + esc(t.modelo) : '') + (t.rol ? ' · ' + esc(t.rol) : '') + (t.ms != null ? ' · ' + t.ms + ' ms' : ''),
      t.guardas && t.guardas.length ? '<b>Guardas</b> ' + t.guardas.map(function (g) { return esc(guardaLegible(g)); }).join(' · ') : '<b>Guardas</b> ninguna saltó',
      '<b>Costó</b> ' + usd(t.costoUsd || 0) + ' en ' + (t.llamadas || []).length + ' llamada' + ((t.llamadas || []).length === 1 ? '' : 's') + (t.sinPrecio ? ' (hay un modelo sin tarifa: se queda corto)' : ''),
      '<b>Versión</b> ' + esc(t.version || '—') + (t.prompt ? ' · prompt ' + esc(t.prompt) : ''),
      t.error ? '<b>Error</b> ' + esc(t.error) : ''
    ];
    return lineas.filter(Boolean).join('<br>');
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.por-que');
    if (!b) return;
    var burbuja = b.closest('.bubble');
    var sig = burbuja.nextElementSibling;
    if (sig && sig.classList.contains('traza')) { sig.remove(); b.setAttribute('aria-expanded', 'false'); return; }
    b.setAttribute('aria-expanded', 'true');
    api('/turnos/' + encodeURIComponent(b.getAttribute('data-turno'))).then(function (t) {
      var div = document.createElement('div');
      div.className = 'traza';
      div.innerHTML = t && t.id ? trazaHtml(t) : esc((t && t.error) || 'No encontré ese turno.');
      burbuja.insertAdjacentElement('afterend', div);
    }).catch(function () { toast('No pude traer por qué contestó eso.'); });
  });

  /**
   * El archivo que vino o se mandó con un mensaje.
   *
   * 🪤 La imagen se pide con el token en la cabecera, no con el token en la dirección: una dirección con el
   * token dentro se va al historial del navegador, a los registros del servidor y al Referer de cualquier sitio
   * que se abra desde ahí. Por eso se baja a un blob y se enseña desde ahí.
   */
  function adjunto(m) {
    if (!m || !m.id) return '';
    var nombre = esc(m.nombre || 'archivo');
    var peso = m.bytes ? ' · ' + (m.bytes > 1048576 ? (m.bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(m.bytes / 1024)) + ' KB') : '';
    if (m.tipo === 'imagen') {
      return '<figure class="adj"><img alt="' + nombre + '" data-medio="' + esc(m.id) + '" data-nombre="' + nombre + '">' +
        '<figcaption>' + nombre + peso + '</figcaption></figure>';
    }
    var icono = m.tipo === 'video' ? '🎬' : m.tipo === 'audio' ? '🎤' : '📄';
    return '<button class="adj-archivo" data-medio="' + esc(m.id) + '" data-nombre="' + nombre + '">' +
      '<span class="ic-adj">' + icono + '</span><span class="n">' + nombre + '</span><span class="p">' + peso.replace(' · ', '') + '</span></button>';
  }

  /** Baja un medio con el token puesto y devuelve una dirección temporal que el navegador sí puede abrir. */
  function traerMedio(id) {
    return fetch(BASE + '/admin/api/medios/' + encodeURIComponent(id), { headers: { 'x-admin-token': state.token } })
      .then(function (r) { return r.ok ? r.blob() : Promise.reject(r.status); })
      .then(function (b) { return URL.createObjectURL(b); });
  }

  // Las miniaturas se llenan después de pintar: así la conversación aparece de una y las fotos van entrando.
  function pintarAdjuntos(raiz) {
    Array.prototype.forEach.call((raiz || document).querySelectorAll('img[data-medio]:not([src])'), function (img) {
      // 🪤 Un 404 no es una falla: los archivos viejos se borran para no llenar el disco y el mensaje se queda
      // (crm/medios.ts › limpiar). Decir «No pude cargar» ahí hacía pensar que algo estaba roto.
      traerMedio(img.dataset.medio).then(function (url) { img.src = url; }).catch(function (estado) {
        img.replaceWith(Object.assign(document.createElement('div'), { className: 'adj-roto', textContent: estado === 404 ? 'Esta foto ya no está guardada' : 'No pude cargar la imagen' }));
      });
    });
  }

  // 🪤 La descarga se hace con un enlace temporal que se revoca: sin revocar, cada archivo abierto se queda en
  // memoria del navegador hasta que se recargue la página, y quien atiende tiene el tablero abierto todo el día.
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.adj-archivo, figure.adj img');
    if (!b) return;
    var id = b.dataset.medio;
    if (!id) return;
    traerMedio(id).then(function (url) {
      var a = document.createElement('a');
      a.href = url;
      a.download = b.dataset.nombre || 'archivo';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
    }).catch(function (estado) { toast(estado === 404 ? 'Ese archivo ya no está guardado.' : 'No pude bajar el archivo.'); });
  });
  // ---------- lo que aiva dejó listo ----------
  var propuestaActual = null;
  function pintarPropuesta(p) {
    propuestaActual = p || null;
    var caja = $('propuesta');
    if (!caja) return;
    caja.hidden = !p;
    if (!p) return;
    caja.classList.toggle('vieja', Boolean(p.vieja));
    // La que se dejó mientras la llevabas tú no es «la respuesta»: es una ayuda que puedes usar o no.
    $('propuesta-titulo').textContent = p.vieja ? 'Esta respuesta se quedó atrás' : p.conPersona ? (state.agentName || 'Aiva') + ' puede contestar esto' : 'Respuesta lista';
    // 🪤 Si llegó algo después de redactarla, ya no contesta a lo último que dijeron. Mandarla de un toque
    // sería peor que no tener el modo: el cliente recibiría una respuesta a una pregunta que ya cambió.
    $('propuesta-meta').textContent = p.vieja
      ? 'escribió otra vez después · léela antes de mandarla'
      : esc(state.agentName || 'Aiva') + ' la escribió hace ' + rel(p.creado);
    $('propuesta-texto').textContent = p.texto;
    $('propuesta-si').classList.toggle('primary', !p.vieja);
  }
  function cerrarPropuestaUI() { pintarPropuesta(null); }
  $('propuesta-si').onclick = function () {
    if (!propuestaActual) return;
    $('propuesta-si').disabled = true;
    api('/propuestas/' + propuestaActual.id + '/enviar', { method: 'POST', body: { by: state.name } }).then(function (r) {
      $('propuesta-si').disabled = false;
      if (r && r.error) { toast('No se pudo: ' + r.error); return; }
      cerrarPropuestaUI(); openContact(state.current);
      toast('Enviada', null, { icono: 'check' });
    });
  };
  $('propuesta-editar').onclick = function () {
    if (!propuestaActual) return;
    // Se pasa al cajón tal cual: corregir es más rápido que escribir, y al mandarla corregida cuenta como tuya
    // —se aprende de ella— en vez de como suya.
    $('reply').value = propuestaActual.texto;
    $('reply').focus();
    $('reply').setSelectionRange(propuestaActual.texto.length, propuestaActual.texto.length);
    toast('Córrgela y envíala: así queda como tuya y se aprende de ella', null, { icono: 'user' });
  };
  $('propuesta-no').onclick = function () {
    if (!propuestaActual) return;
    var id = propuestaActual.id;
    cerrarPropuestaUI();
    api('/propuestas/' + id + '/descartar', { method: 'POST', body: { by: state.name } });
  };

  function setMode(human) {
    $('seg-bot').classList.toggle('on', !human); $('seg-human').classList.toggle('on', human);
    $('seg').dataset.on = human ? 'human' : 'bot';
    $('seg-bot').setAttribute('aria-pressed', String(!human)); $('seg-human').setAttribute('aria-pressed', String(human));
    // 🪤 El cajón de escribir ya no se esconde cuando contesta aiva. Estaba escondido, así que para tomar una
    // conversación había que acordarse de mover un interruptor ANTES de tener nada que decir — y lo natural es
    // al revés: uno empieza a escribir. Ahora escribir es la señal, como contestar desde el teléfono.
    $('composer-hint').hidden = human;
    $('composer-hint').innerHTML = 'Responde ' + esc(state.agentName || 'Aiva') + '. <b>Si escribes aquí, la automatización se pausa</b> en esta conversación.';
    $('reply').hidden = false; $('send').hidden = !human;
    // 🪤 El botón de adjuntar solo donde el canal sabe entregarlo. Ofrecerlo en el chat del sitio sería prometer
    // algo que no pasa: el archivo quedaría en la conversación y el cliente no lo recibiría nunca.
    $('adj-btn').hidden = !human || !(state.detail && state.detail.llevaArchivos);
    $('reply').placeholder = human ? 'Escribe tu respuesta… (Enter envía, Shift+Enter salto)' : 'Escribe para tomar esta conversación…';
    if (human) $('reply').focus();
    pintarCajon();
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
        toast('Tomaste esta conversación: ' + (state.agentName || 'Aiva') + ' se queda callada aquí');
      })
      .finally(function () { tomando = false; });
  });
  $('seg-bot').onclick = function () { toggleHuman(false); };
  $('seg-human').onclick = function () { toggleHuman(true); };
  function toggleHuman(on) {
    if (!state.current) return;
    api('/contacts/' + encodeURIComponent(state.current) + '/human', { method: 'POST', body: { on: on } }).then(function () { return openContact(state.current); });
  }
  // ---------- adjuntar una foto o un documento ----------
  var adjPendiente = null;
  $('adj-btn').onclick = function () { $('adj-file').click(); };
  $('adj-file').onchange = function () {
    var f = $('adj-file').files && $('adj-file').files[0];
    $('adj-file').value = ''; // así volver a escoger el mismo archivo también cuenta
    if (!f) return;
    adjPendiente = f;
    $('adj-nombre').textContent = f.name + ' · ' + (f.size > 1048576 ? (f.size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(f.size / 1024)) + ' KB');
    $('adj-listo').hidden = false;
    $('reply').placeholder = 'Escribe algo para acompañarlo (opcional)…';
    $('reply').focus();
  };
  function quitarAdjunto() {
    adjPendiente = null;
    $('adj-listo').hidden = true;
    $('reply').placeholder = 'Escribe tu respuesta… (Enter envía, Shift+Enter salto)';
  }
  $('adj-quitar').onclick = quitarAdjunto;

  function sendReply() {
    var text = $('reply').value.trim();
    if (!state.current) return;
    // 🪤 Con archivo, el texto es opcional: mandar una foto sola es una respuesta entera. Sin archivo, un
    // mensaje vacío no se manda.
    if (!text && !adjPendiente) return;
    $('send').disabled = true;
    var envio;
    if (adjPendiente) {
      var fd = new FormData();
      fd.append('archivo', adjPendiente);
      fd.append('texto', text);
      fd.append('by', state.name || '');
      envio = fetch(BASE + '/admin/api/contacts/' + encodeURIComponent(state.current) + '/adjunto', {
        method: 'POST', headers: state.name ? { 'x-admin-token': state.token, 'x-aiva-quien': encodeURIComponent(state.name) } : { 'x-admin-token': state.token }, body: fd,
      }).then(function (r) { return r.json(); });
    } else {
      envio = api('/contacts/' + encodeURIComponent(state.current) + '/reply', { method: 'POST', body: { text: text, by: state.name } });
    }
    envio.then(function (r) {
      if (r && r.error) {
        toast('No se pudo enviar: ' + r.error);
        // 🪤 Si quedó guardado y marcado, el texto ya está en la conversación con su «Volver a intentar»: dejarlo
        // también en el cajón invita a darle Enviar otra vez y que el cliente lo reciba dos veces.
        if (r.fallo) { $('reply').value = ''; quitarAdjunto(); }
        return;
      }
      $('reply').value = '';
      quitarAdjunto();
    }).catch(function () { toast('No se pudo enviar.'); })
      .finally(function () { $('send').disabled = false; $('reply').focus(); });
  }
  $('send').onclick = sendReply;
  $('reply').onkeydown = function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); } };
  $('back-list').onclick = function () { $('inbox').setAttribute('data-pane', 'list'); };
  $('details-btn').onclick = function () { $('inbox').setAttribute('data-pane', 'details'); };
  if ($('fx-control')) $('fx-control').onclick = function () { if (state.detail) $(state.detail.contact.humanMode ? 'seg-bot' : 'seg-human').click(); };
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
  // ---------- el perfil, al lado de la conversación ----------
  // 🪤 Este panel ERA un formulario: Nombre, Teléfono, Etiquetas, Nota fija, Guardar, Re-analizar, Archivar,
  // Borrar. Quien atiende pasa el día aquí, y lo que veía al lado de la conversación eran campos por llenar, no a
  // la persona; el perfil de verdad (lo que contó, la historia) vivía en otra ventana a la que se llegaba desde
  // Clientes. Ahora es al revés: primero quién es y qué quiere, como en la ficha completa y con sus mismas
  // piezas, y el formulario detrás de «Corregir datos», que es lo que se toca una vez y no a cada mensaje.
  //
  // 🪤 Y se vuelve a pintar SOLO cada vez que llega un análisis o un mensaje. Sin guardar lo que se estaba
  // escribiendo, una nota a medio escribir o un nombre corregido se borraban en mitad de la frase.
  function borradoresDelPerfil(id) {
    var caja = $('details');
    if (!caja || caja.getAttribute('data-id') !== id) return null;
    var b = { abiertos: {}, campos: {} };
    caja.querySelectorAll('details[data-k]').forEach(function (x) { b.abiertos[x.getAttribute('data-k')] = x.open; });
    caja.querySelectorAll('[data-borrador]').forEach(function (x) { if (x.value !== x.defaultValue) b.campos[x.id] = x.value; });
    return b;
  }
  function devolverBorradores(b) {
    if (!b) return;
    $('details').querySelectorAll('details[data-k]').forEach(function (x) { var k = x.getAttribute('data-k'); if (k in b.abiertos) x.open = b.abiertos[k]; });
    Object.keys(b.campos).forEach(function (id) { var x = $(id); if (x) x.value = b.campos[id]; });
  }
  function renderDetails() {
    var d = state.detail; if (!d) return;
    var c = d.contact, data = c.data || {}, h = d.historia || {};
    var borradores = borradoresDelPerfil(c.id);
    // Lo mismo que esconde la ficha completa: lo que no es algo que la persona contó, sino cuentas internas. Lo de
    // contacto (correo, Instagram…) tampoco: tiene su propio bloque, con enlaces.
    var ocultos = Object.assign({ booking: 1, interes: 1, urgencia: 1, pospuesto_hasta: 1, pospuesto_desde: 1, valor: 1, sede: 1, motivo_perdida: 1 }, DE_CONTACTO);
    var capturados = Object.keys(data).filter(function (k) { return !ocultos[k] && data[k] !== '' && data[k] != null && typeof data[k] !== 'object'; });
    // Lo que se esconde en el modo fácil lleva la clase en la fila: el dato y su rótulo se van juntos.
    var fila = function (k, html, clase) { return '<dt' + (clase ? ' class="' + clase + '"' : '') + '>' + esc(k) + '</dt><dd' + (clase ? ' class="' + clase + '"' : '') + '>' + html + '</dd>'; };
    var factors = (c.scoreFactors || []).map(function (f) { return '<li><span>' + esc(f.label) + '</span><span class="' + (f.points >= 0 ? 'pos' : 'neg') + '">' + (f.points >= 0 ? '+' : '') + f.points + '</span></li>'; }).join('') || '<li class="muted">Aún sin análisis.</li>';
    var etapas = (state.stages || []).map(function (e) { return '<option value="' + esc(e.id) + '"' + (e.id === c.stage ? ' selected' : '') + '>' + esc(e.label) + '</option>'; }).join('');
    var appts = d.appointments.map(function (a) { return '<div class="appt ' + a.status + '"><span class="t">' + esc(a.label || '') + '</span><span class="grow small muted">' + esc(a.service) + ' · ' + esc(estadoCita(a.status)) + '</span></div>'; }).join('') || '<span class="muted small">Sin citas.</span>';
    var v = verdict(c), viejo = isStale(c);
    var sub = [channelIcon(c.channel), c.phone || '', h.frase || ''].filter(Boolean).join(' · ');
    var canal = canalDeXen(c.channel), tel = d.number ? '+' + d.number : (c.phone || '');
    $('details').setAttribute('data-id', c.id);
    $('details').innerHTML =
      // En el celular el perfil tapa la conversación: sin esto, la única salida era el riel de abajo.
      '<button class="btn sm volver-chat" id="back-chat">‹ Volver a la conversación</button>' +
      '<div id="dup-panel"></div>' +
      // Quién es, como la ficha de contacto de un CRM de mensajería: el avatar grande con la insignia de su canal,
      // el nombre con su lápiz (abre «Corregir datos»), el teléfono y las acciones. En el celular este panel se ve
      // solo, sin la conversación al lado, así que dice el nombre.
      '<div class="perfil-quien fx-cto">' + avatarXen(c, 'fx-av-cto') +
        '<div class="ficha-titulo"><div class="fx-cto-nombre"><b>' + esc(nameOf(c)) + '</b>' +
          '<button class="fx-lapiz" type="button" id="fx-lapiz" title="Corregir datos" aria-label="Corregir los datos de ' + esc(nameOf(c)) + '">' + svgXen('lapiz') + '</button></div>' +
          '<div class="small muted fx-cto-sub">' + esc(tel ? tel + ' · ' + canal.t : sub) + '</div>' +
          (h.frase ? '<div class="small muted">' + esc(h.frase) + '</div>' : '') + '</div></div>' +
      '<div class="fx-cto-acciones">' +
        '<button class="btn sm fx-360" type="button" id="fx-ficha">' + svgXen('externo') + 'Abrir la ficha completa</button>' +
        (d.number
          ? '<a class="btn sm fx-cto-ic" target="_blank" rel="noopener" href="https://wa.me/' + esc(d.number) + '" title="Escribirle por WhatsApp" aria-label="Escribirle por WhatsApp">' + svgXen('wa') + '</a>' +
            '<a class="btn sm fx-cto-ic" href="tel:+' + esc(d.number) + '" title="Llamar" aria-label="Llamar a ' + esc(nameOf(c)) + '">' + svgXen('telefono') + '</a>'
          : '') + '</div>' +
      mediosXen(c) +
      (h.amago ? '<div class="pf-amago">⚠ Se le fue una venta: tuvo cita y no acabó en compra, y no tiene otra agendada.</div>' : '') +
      (c.notes ? '<div class="perfil-nota"><b>Nota fija</b> ' + esc(c.notes) + '</div>' : '') +
      '<dl class="det fx-kv">' +
        fila('Asignado a', responsableHtml(c, 'f-resp')) +
        // La etapa se cambia aquí mismo: es lo que más se toca, y no tiene por qué esperar a «Corregir datos».
        fila('Etapa', '<select id="f-etapa" aria-label="Etapa">' + etapas + '</select>' + motivoHtml(c, 'f-motivo')) +
        // «Nunca el número solo»: el veredicto primero y el puntaje de respaldo. El porqué, detrás de un clic.
        fila('¿Prospecto?', '<span class="' + (viejo ? 'stale' : '') + '"><b>' + esc(v.label) + '</b> · ' + esc(String(c.score == null ? '—' : c.score)) + '</span>' +
          (viejo ? '<div class="small" style="color:var(--warn)">Hay mensajes nuevos: se recalcula solo.</div>' : ''), 'solo-completo') +
        fila('Próximo paso', pasoHtml(c.proximo)) +
        fila('Valor', valorHtml(c)) +
        fila('La lleva', llevaHtml(c), 'solo-completo') +
        (d.origen && d.origen.fuente ? fila('Origen', esc(d.origen.fuente + (d.origen.campana ? ' · ' + d.origen.campana : '')) + (d.origen.titular ? '<div class="small muted">«' + esc(d.origen.titular) + '»</div>' : ''), 'solo-completo') : '') +
        (variasSedes() && data.sede ? fila('Sede', esc(nombreSede(data.sede))) : '') +
        (c.lastMessageAt ? fila('Última actividad', esc(rel(c.lastMessageAt) === 'ahora' ? 'ahora' : 'hace ' + rel(c.lastMessageAt))) : '') +
      '</dl>' +
      // Lo que busca: lo resumió el agente de IA, por eso va en su violeta.
      (c.summary ? '<p class="ficha-quiere">' + esc(c.summary) + '</p>' : '<p class="ficha-quiere muted">Todavía no se sabe qué busca: se llena solo mientras conversa.</p>') +
      '<details class="perfil-por solo-completo" data-k="por"><summary>Por qué ese puntaje</summary>' +
        '<ul class="factors">' + factors + '</ul>' +
        (c.sentiment ? '<div class="small muted" style="margin-top:6px">Ánimo: ' + sentIcon(c.sentiment) + (data.urgencia ? ' · urgencia ' + esc(data.urgencia) : '') + '</div>' : '') +
        '<div class="small muted" style="margin-top:6px">' + (c.scoreBase > c.score ? 'Llegó a ' + c.scoreBase + ' cuando hablaron. ' : '') + (c.scoreAt ? 'Calculado hace ' + rel(c.scoreAt) + '. ' : '') +
          '<button class="linkbtn" id="f-analyze">Volver a analizar</button></div>' +
      '</details>' +
      '<div><h3>Datos del contacto</h3>' + (capturados.length
        ? '<dl class="det">' + capturados.map(function (k) { return fila(etiquetaDato(k), esc(data[k])); }).join('') + '</dl>'
        : '<span class="muted small">Todavía nada. Se llena solo mientras conversa.</span>') + '</div>' +
      '<div><h3>Citas</h3>' + appts + '</div>' +
      // La historia, corta: lo último que pasó y una nota a mano mientras se conversa. Entera, en la ficha.
      '<div><h3>Historia</h3><div class="nota-nueva"><label class="sr-only" for="chat-nota">Nota nueva</label>' +
        '<textarea id="chat-nota" data-borrador rows="2" maxlength="2000" placeholder="Nota para el equipo…"></textarea><button class="btn sm" id="chat-nota-ok">Guardar nota</button></div>' +
        historiaHtml(d, { max: 6, borrar: true }) +
        '<button class="linkbtn small" id="chat-ficha">Ver la ficha completa</button></div>' +
      '<details class="corregir" data-k="corregir"><summary>Corregir datos</summary><div class="pf-campos">' +
        '<div class="ancho"><label for="f-name">Nombre</label><input id="f-name" data-borrador value="' + esc(c.name || '') + '"></div>' +
        '<div class="ancho"><label for="f-phone">Teléfono</label><input id="f-phone" data-borrador inputmode="tel" value="' + esc(c.phone || '') + '"></div>' +
        camposFichaHtml(c, 'f-x-', { borrador: true }) +
        '<div class="ancho"><label for="f-tags">Etiquetas, separadas por coma</label><input id="f-tags" data-borrador value="' + esc((c.tags || []).join(', ')) + '"></div>' +
        '<div class="ancho"><label for="f-notes">Nota fija</label><textarea id="f-notes" data-borrador rows="2" placeholder="Lo que siempre hay que saber de esta persona">' + esc(c.notes || '') + '</textarea></div>' +
      '</div><div class="fila" style="gap:8px;margin-top:10px"><button class="btn sm primary" id="f-save">Guardar</button></div>' +
      '<div class="feed-row" style="margin-top:14px"><button class="btn sm" id="arch-btn">' + (c.archived ? 'Devolver a las listas' : 'Archivar') + '</button><button class="btn sm de-quien-administra" id="del-btn">Borrar</button></div><div class="small" id="del-msg" role="status"></div>' +
      '<div class="small muted" style="margin-top:10px">' + esc(channelIcon(c.channel)) + ' · ' + esc(c.id) + '</div></details>';
    devolverBorradores(borradores);
    bindArchive();
    if (state.dups && state.dups.id === c.id) renderDuplicates(state.dups.list);
    $('back-chat').onclick = function () { $('inbox').setAttribute('data-pane', 'chat'); };
    $('chat-ficha').onclick = function () { abrirPerfil(c.id); };
    $('fx-ficha').onclick = function () { abrirPerfil(c.id); };
    // El lápiz abre «Corregir datos» y pone el cursor en el nombre.
    $('fx-lapiz').onclick = function () {
      var caja = $('details').querySelector('details[data-k="corregir"]');
      if (caja) { caja.open = true; caja.scrollIntoView({ block: 'nearest', behavior: reducirMovimiento() ? 'auto' : 'smooth' }); }
      if ($('f-name')) $('f-name').focus();
    };
    if ($('f-resp')) { $('f-resp').setAttribute('aria-label', 'Asignado a'); sinAsignarComoOpcion($('f-resp')); }
    $('chat-nota-ok').onclick = function () {
      var texto = $('chat-nota').value.trim();
      if (!texto) { $('chat-nota').focus(); return; }
      api('/contacts/' + encodeURIComponent(c.id) + '/notas', { method: 'POST', body: { texto: texto, por: state.name || '' } }).then(function (r) {
        if (r && r.error) { toast(r.error); return; }
        $('chat-nota').value = '';
        d.events = r.events || d.events; renderDetails();
      });
    };
    engancharBorrarNotas($('details'), c.id, function (events) { d.events = events; renderDetails(); });
    $('f-etapa').onchange = function () {
      var nueva = $('f-etapa').value;
      cambiarEtapa(c, nueva, function (r) {
        if (!r) { $('f-etapa').value = c.stage; return; }
        if (r.error) { toast(r.error); return; }
        toast('Etapa: ' + etiquetaEtapa(nueva));
        openContact(c.id); loadContacts();
      });
    };
    if ($('f-motivo')) $('f-motivo').onclick = function () { cambiarEtapa(c, c.stage, function (r) { if (r && !r.error) openContact(c.id); }); };
    engancharResponsable($('f-resp'), c, function () { openContact(c.id); loadContacts(); });
    $('f-save').onclick = function () {
      api('/contacts/' + encodeURIComponent(c.id), { method: 'PATCH', body: { name: $('f-name').value, phone: $('f-phone').value, tags: $('f-tags').value.split(',').map(function (t) { return t.trim(); }).filter(Boolean), notes: $('f-notes').value, ficha: leerFicha('f-x-') } })
        .then(function (r) {
          if (r && r.error) { toast(r.error); return; }
          // Guardado: lo escrito ya no es un borrador que haya que proteger del siguiente repintado.
          ['f-name', 'f-phone', 'f-tags', 'f-notes'].concat(idsDeFicha('f-x-')).forEach(function (id) { if ($(id)) $(id).defaultValue = $(id).value; });
          toast('Ficha guardada'); openContact(c.id); loadContacts();
        });
    };
    $('f-analyze').onclick = function () { $('f-analyze').disabled = true; api('/contacts/' + encodeURIComponent(c.id) + '/analyze', { method: 'POST' }).then(function () { openContact(c.id); loadContacts(); }); };
  }


  // ---------- hoy ----------
  // Borrador para retomar a un prospecto caliente: solo con lo que él mismo dijo (prenda, ocasión). Sin precios ni
  // fechas inventadas, y queda en el cajón de escribir para que la persona lo ajuste antes de enviarlo.
  function followupDraft(c) {
    // 🪤 Del nombre de verdad, no de nameOf: sin nombre, nameOf dice «Visitante del sitio» y el borrador saldría
    // «Hola Visitante 🙂».
    var d = c.data || {}, first = (c.name || '').trim().split(' ')[0], biz = state.bizName ? ' de ' + state.bizName : '';
    var prenda = (d.prenda || d.servicio || '').toString().replace(/\s*\(.*?\)/g, '').trim();
    var ocasion = (d.ocasion || '').toString().replace(/\s*\(.*?\)/g, '').trim();
    var asunto = prenda ? 'lo de tu ' + prenda + (ocasion ? ' para tu ' + ocasion : '') : 'lo que hablamos' + (ocasion ? ' para tu ' + ocasion : '');
    return 'Hola' + (first && !/^(web|wa|meta|cli|mcp)$/.test(first) ? ' ' + first : '') + ' 🙂 Te escribo' + biz + ' para saber si seguimos con ' + asunto +
      '. Si quieres, te aparto una cita y lo vemos con calma; dime qué día te sirve.';
  }
  function contactRow(c, extra, actions) {
    return '<div class="row" data-id="' + esc(c.id) + '"><div class="name"><span class="n">' + esc(nameOf(c)) + '</span>' + (c.unread ? '<span class="unread">' + c.unread + '</span>' : '') + '</div><div class="time">' + rel(c.lastMessageAt) + '</div><div class="snip">' + esc(extra || c.recap || c.summary || '') + '</div><div class="meta"><span class="chip canal">' + esc(channelIcon(c.channel)) + '</span><span class="chip stage-' + (rol(c.stage) || c.stage) + '">' + esc(state.stageLabels[c.stage] || c.stage) + '</span>' + scoreChip(c) + (c.humanMode ? '<span class="chip who">La lleva ' + esc(whoHas(c)) + '</span>' : '') + '</div>' + (actions ? '<div class="acts">' + actions + '</div>' : '') + '</div>';
  }

  /**
   * Los cuatro números de arriba.
   *
   * 🪤 Cada uno LLEVA A ALGUNA PARTE. Un número que solo se mira es decoración, y la primera regla de este
   * tablero es que ninguna métrica lo sea: se tocan y abren la lista que los explica.
   */
  function pintarKpis(r, embudo) {
    var tarjetas = [
      { k: 'activas', ic: 'message', t: 'Conversaciones activas', p: 'Ni ganadas ni perdidas', ir: function () { go('inbox'); setFilter('all'); } },
      { k: 'nuevos', ic: 'user', t: 'Prospectos nuevos', p: 'Escribieron hoy por primera vez', ir: function () { go('inbox'); setFilter('all'); } },
      { k: 'calientes', ic: 'chart', t: 'Prospectos calientes', p: 'Puntaje de 60 para arriba', ir: function () { go('inbox'); setFilter('hot'); } },
      { k: 'citasHoy', ic: 'calendar', t: 'Citas hoy', p: d2(), ir: function () { go('calendar'); } },
    ];
    // La quinta: lo que hay en el embudo, en dinero.
    //
    // 🪤 Cero NO se pinta como un número más. Si el catálogo no tiene precios, lo que falta es cargarlos, y
    // enseñar «$0» a secas junto a cuatro cifras de verdad le dice a quien mira que el negocio no vale nada.
    // Dice qué falta y lleva a arreglarlo.
    if (embudo) {
      var hay = embudo.total > 0;
      tarjetas.push({
        k: '_embudo', ic: 'chart', t: 'Valor del embudo',
        valor: hay ? plata(embudo.total) : 'Sin precios',
        p: embudo.catalogoSinPrecios ? 'Tu catálogo no tiene precios: cárgalos'
          : hay ? embudo.conValor + ' de ' + (embudo.conValor + embudo.sinValor) + ' con valor conocido'
          : 'Ninguno coincide con el catálogo',
        ir: function () { embudo.catalogoSinPrecios ? go('knowledge') : go('pipeline'); },
      });
    }
    $('kpis').innerHTML = tarjetas.map(function (x) {
      return '<button class="kpi" data-k="' + x.k + '"><i class="ic" data-ic="' + x.ic + '"></i>' +
        '<span class="t">' + esc(x.t) + '</span>' +
        '<span class="n' + (x.valor && !/^\$/.test(x.valor) ? ' flojo' : '') + '">' + esc(x.valor != null ? x.valor : (r[x.k] == null ? '—' : String(r[x.k]))) + '</span>' +
        '<span class="p">' + esc(x.p) + '</span></button>';
    }).join('');
    iconos($('kpis'));
    Array.prototype.forEach.call($('kpis').querySelectorAll('.kpi'), function (b) {
      var x = tarjetas.filter(function (y) { return y.k === b.dataset.k; })[0];
      if (x) b.onclick = x.ir;
    });
  }

  /** Dinero en pesos, sin decimales y con el punto de los miles, que es como se escribe aquí. */
  function plata(n) {
    // La moneda del negocio (business.currency), no la de aquí: un cliente que cobra en dólares no vende en pesos.
    try { return new Intl.NumberFormat('es-CO', { style: 'currency', currency: state.moneda || 'COP', maximumFractionDigits: 0 }).format(n); }
    catch (e) { return '$' + Math.round(n).toLocaleString('es-CO'); }
  }
  function d2() { return new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }); }


  function loadToday() {
    api('/today').then(function (t) {
      var d = new Date();
      $('today-sub').textContent = d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }) + (state.name ? ' · ' + state.name : '');
      pintarKpis(t.resumen || {}, t.embudo || null);
      // Orden por costo del silencio: primero lo que alguien está esperando.
      var sections = [
        { t: 'Por verificar', n: t.verifications.length, html: t.verifications.map(verifyItem).join(''), empty: 'Nada pendiente: ' + (state.agentName || 'Aiva') + ' supo responder todo.' },
        // Lo de los grupos va primero: es lo único de esta pantalla donde alguien está esperando en público.
        { t: 'Te escribieron en un grupo', n: (t.enGrupos || []).length, html: (t.enGrupos || []).map(function (p) {
            return '<div class="card"><div class="body">'
              + '<div class="fila" style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap">'
              + '<b>' + esc(p.grupo) + '</b><span class="small muted">hace ' + rel(p.creado) + '</span></div>'
              // 🪤 La pregunta primero. Una respuesta suelta, fuera de la conversación donde nació, no se puede
              // juzgar — y en un grupo no hay conversación en el tablero que abrir para ir a verla.
              + (p.sobre ? '<div class="small muted" style="margin-top:6px">' + esc(p.sobre) + '</div>' : '')
              // Quién es quién ahí dentro: quien más escribe suele ser el que organiza, y eso cambia a quién
              // le estás contestando. Sin esto, la tarjeta es una respuesta sin destinatario.
              + ((p.gente || []).length
                  ? '<div class="fila" style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px">'
                    + p.gente.map(function (g) {
                        return '<span class="chip" title="' + esc(String(g.mensajes)) + ' mensajes en este grupo">'
                          + esc(g.nombre || String(g.persona).split('@')[0]) + ' · ' + g.mensajes + '</span>';
                      }).join('') + '</div>'
                  : '')
              + '<div class="small" style="margin-top:6px;white-space:pre-wrap;border-left:3px solid var(--brand);padding-left:8px">' + esc(p.texto) + '</div>'
              + '<div class="fila" style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">'
              + '<button class="btn sm primary" data-gr-si="' + p.id + '">Enviar al grupo</button>'
              + '<button class="btn sm" data-gr-no="' + p.id + '">Descartar</button></div></div></div>';
          }).join(''), empty: 'Nadie te ha escrito en un grupo.' },
        { t: 'Esperan tu respuesta', n: t.unanswered.length, html: t.unanswered.map(function (c) { return contactRow(c, c.humanMode ? 'La última palabra la tiene el cliente y ' + (state.agentName || 'Aiva') + ' está en pausa.' : 'La última palabra la tiene el cliente y ' + (state.agentName || 'Aiva') + ' no respondió.'); }).join(''), empty: 'Nadie espera respuesta de una persona.' },
        { t: 'Pidieron una persona', n: t.handoffs.length, html: t.handoffs.map(function (c) { return contactRow(c); }).join(''), empty: (state.agentName || 'Aiva') + ' lleva todas las conversaciones.' },
        { t: '¿Cómo les fue? (citas que ya pasaron)', n: (t.past || []).length, html: (t.past || []).map(pastItem).join(''), empty: 'Ninguna cita pasada sin resultado.' },
        { t: 'Recordar a mano', n: (t.remind || []).length, html: (t.remind || []).map(remindItem).join(''), empty: 'Los recordatorios de mañana salen solos.' },
        { t: 'Citas de hoy', n: t.appointments.length, html: t.appointments.map(function (a) { return '<div class="appt"><span class="t">' + esc(a.label) + '</span><span class="grow"><b>' + esc(a.contactName || short(a.userId)) + '</b> <span class="muted small">' + esc(a.service + conSede(a)) + '</span>' + reminderChip(a) + '</span><button class="btn sm" data-open="' + esc(a.userId) + '">Chat</button></div>'; }).join(''), empty: 'Sin citas hoy.' },
        { t: 'Calientes sin seguimiento (más de 24 h)', n: t.hot.length, html: t.hot.map(function (c) {
          return contactRow(c, null, '<button class="btn sm primary" data-follow="' + esc(c.id) + '">Escribirle</button><button class="btn sm" data-snooze="' + esc(c.id) + '">Dejarlo por ahora</button>');
        }).join(''), empty: 'Ningún prospecto caliente abandonado.' },
        { t: 'Sin leer, ' + (state.agentName || 'Aiva') + ' ya respondió', n: t.unread.length, html: t.unread.map(function (c) { return contactRow(c); }).join(''), empty: 'Todo leído.' },
        { t: 'Próximas citas (3 días)', n: t.upcoming.length, html: t.upcoming.map(function (a) { return '<div class="appt"><span class="grow stack"><span class="small muted">' + esc(a.label + conSede(a)) + '</span><b>' + esc(a.contactName || short(a.userId)) + '</b>' + reminderChip(a) + '</span><button class="btn sm" data-open="' + esc(a.userId) + '">Chat</button></div>'; }).join(''), empty: 'Nada agendado en los próximos días.' },
      ];
      var down = t.public && (t.public.state === 'caida' || t.public.state === 'otro_servidor')
        ? '<div class="panel help-first" role="alert"><span class="grow"><b>La dirección pública no responde.</b> <span class="small">' + esc(publicDetail(t.public)) + '</span></span><button class="btn primary" data-go="channels">Ver en Canales</button></div>'
        : '';
      // Cada sección con su color: lo urgente no puede verse igual que lo que ya está resuelto.
      var TONOS = ['verificar', 'esperan', 'grupos', 'persona', 'pasadas', 'recordar', 'citas', 'calientes', 'leidas', 'proximas'];
      sections.forEach(function (s, i) { s.tono = TONOS[i] || ''; });
      // 🪤 En el modo fácil solo sale lo que tiene algo. Nueve recuadros, siete diciendo «nada pendiente», es lo
      // que hacía sentir a aiva complicado: hay que leerlos todos para descubrir que no hay que hacer nada.
      // XENCRM: Inicio es el de la piel para todos, y esta es su fila de «lo que espera a alguien».
      var facil = true;
      var visibles = facil ? sections.filter(function (s) { return s.n > 0; }) : sections;
      $('today').innerHTML = down + bannerDeHoy() + visibles.map(function (s) {
        return '<div class="panel" data-tono="' + s.tono + '"><h3>' + esc(s.t) + '<span class="chip">' + s.n + '</span></h3>' +
          (s.html || '<div class="ok">' + esc(s.empty) + '</div>') + '</div>';
      }).join('');
      // En el modo fácil, Inicio es el de Nexora (pintarInicio) y estos recuadros son la fila de lo que espera a
      // alguien: si no hay nada, no hay fila —el «Todo al día» lo dice el resumen del día, a la derecha—.
      $('today').hidden = facil && !$('today').childElementCount;
      if (facil) pintarInicio(t, sections);
      $('today').querySelectorAll('.row').forEach(function (r) {
        r.onclick = function () { go('inbox'); openContact(r.getAttribute('data-id')); };
        r.oncontextmenu = function (e) { e.preventDefault(); abrirMenu(e.clientX, e.clientY, r.getAttribute('data-id')); };
      });
      $('today').querySelectorAll('[data-gr-si]').forEach(function (b) {
        b.onclick = function () {
          b.disabled = true;
          api('/propuestas/' + b.getAttribute('data-gr-si') + '/enviar', { method: 'POST', body: { by: state.name } })
            .then(function (r) {
              if (r && r.error) { b.disabled = false; toast('No se pudo: ' + r.error); return; }
              toast('Enviada al grupo', null, { icono: 'check' }); loadToday();
            });
        };
      });
      $('today').querySelectorAll('[data-gr-no]').forEach(function (b) {
        b.onclick = function () {
          b.disabled = true;
          api('/propuestas/' + b.getAttribute('data-gr-no') + '/descartar', { method: 'POST', body: { by: state.name } })
            .then(function () { loadToday(); });
        };
      });
      $('today').querySelectorAll('[data-open]').forEach(function (b) { b.onclick = function () { go('inbox'); openContact(b.getAttribute('data-open')); }; });
      $('today').querySelectorAll('[data-go]').forEach(function (b) { b.onclick = function () { go(b.getAttribute('data-go')); }; });
      if ($('help-hide')) $('help-hide').onclick = function () { helpSet('aiva.help.seen', true); loadToday(); };
      pintarGuiaEnHoy();
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
  // ---------- Inicio en el modo fácil ----------
  // El de Nexora: cuatro números, cómo va la semana, dónde está cada persona, lo último que pasó y el resumen del
  // día. 🪤 Todo sale de lo que aiva ya sabe —/today, /series, /stats, las notificaciones—; ninguna cifra se
  // estima ni se rellena para que la tarjeta no quede vacía: si no hay datos, la tarjeta lo dice.
  var FX = { dias: 7, serie: null };
  function pintarInicio(t, sections) {
    var r = t.resumen || {};
    var tarjetas = [
      { k: 'activas', t: 'Conversaciones activas', ic: 'burbuja', tono: '', p: 'Ni ganadas ni perdidas', ir: function () { go('inbox', { filter: 'all' }); } },
      { k: 'nuevos', t: 'Prospectos nuevos', ic: 'users', tono: 'violeta', p: 'Escribieron hoy por primera vez', ir: function () { go('inbox', { filter: 'all' }); } },
      { k: 'calientes', t: 'Prospectos calientes', ic: 'objetivo', tono: 'verde', p: 'Con ganas de comprar', ir: function () { go('inbox', { filter: 'hot' }); } },
      { k: 'citasHoy', t: 'Citas hoy', ic: 'reloj', tono: '', p: d2(), ir: function () { go('calendar'); } }
    ];
    $('fx-kpis').innerHTML = tarjetas.map(function (x) {
      return '<button class="fx-kpi" data-k="' + x.k + '"><span class="fx-kpi-cab"><span class="t">' + esc(x.t) + '</span>' +
        '<span class="fx-ic ' + x.tono + '"><i class="ic" data-ic="' + x.ic + '"></i></span></span>' +
        '<span class="n">' + esc(r[x.k] == null ? '—' : String(r[x.k])) + '</span><span class="p">' + esc(x.p) + '</span></button>';
    }).join('');
    iconos($('fx-kpis'));
    $('fx-kpis').querySelectorAll('.fx-kpi').forEach(function (b) {
      var x = tarjetas.filter(function (y) { return y.k === b.getAttribute('data-k'); })[0];
      if (x) b.onclick = x.ir;
    });
    pintarResumenDelDia(sections);
    cargarSerieFacil();
    api('/stats').then(pintarEtapasFacil).catch(function () {});
    pintarActividadFacil();
  }

  // El resumen del día, en la tarjeta oscura: lo que espera a alguien, contado, y cada cosa lleva a su recuadro.
  function pintarResumenDelDia(sections) {
    // Lo que pide que alguien haga algo. Las citas de hoy, las próximas y lo ya leído no: eso se mira, no se atiende.
    var pend = (sections || []).filter(function (s) { return s.n > 0 && ['citas', 'leidas', 'proximas'].indexOf(s.tono) < 0; });
    var total = pend.reduce(function (a, s) { return a + s.n; }, 0);
    var agente = state.agentName || 'Aiva';
    $('fx-resumen').innerHTML = '<div class="fx-oscura-cab"><i class="ic" data-ic="chispa"></i>Resumen del día</div>' +
      '<h2>' + (total ? (total === 1 ? 'Una cosa espera a alguien' : total + ' cosas esperan a alguien') : 'Todo al día') + '</h2>' +
      '<p>' + esc(total ? 'Esto es lo que no puede esperar. Lo demás lo va llevando ' + agente + '.' : 'Nadie espera respuesta, no hay citas sin resultado y ' + agente + ' supo contestar todo.') + '</p>' +
      '<div class="fx-caja">' + (pend.length
        ? pend.map(function (s) { return '<button data-tono="' + s.tono + '"><span>' + esc(s.t) + '</span><b>' + s.n + '</b></button>'; }).join('')
        : '<div class="nada">Nada pendiente por ahora.</div>') + '</div>' +
      (esFacil() && mandaEnElModo() ? '<button class="fx-todo" type="button" id="hoy-ver-todo">Estás en el modo fácil · Ver todo XENCRM</button>' : '');
    iconos($('fx-resumen'));
    $('fx-resumen').querySelectorAll('[data-tono]').forEach(function (b) {
      b.onclick = function () {
        var p = document.querySelector('#today .panel[data-tono="' + b.getAttribute('data-tono') + '"]');
        if (p) { p.scrollIntoView({ behavior: 'smooth', block: 'start' }); p.classList.add('fx-resalta'); setTimeout(function () { p.classList.remove('fx-resalta'); }, 1600); }
      };
    });
    if ($('hoy-ver-todo')) $('hoy-ver-todo').onclick = function () { $('modo-btn').click(); };
  }

  // Cómo va la semana: conversaciones nuevas (área azul) y citas agendadas (línea verde), por día.
  function cargarSerieFacil() {
    api('/series?dias=' + Math.max(7, FX.dias)).then(function (d) {
      if (!d || d.error || !d.nuevas) { $('fx-serie').innerHTML = vacioFacil('No se pudo cargar', 'Vuelve a intentarlo con «Actualizar».'); return; }
      var citas = {};
      (d.citas || []).forEach(function (c) { citas[c.dia] = c.citas; });
      FX.serie = d.nuevas.slice(-FX.dias).map(function (n) { return { dia: n.dia, a: n.total, b: citas[n.dia] || 0 }; });
      var s = d.semana && d.semana.conversaciones;
      $('fx-serie-sub').textContent = s
        ? 'Esta semana: ' + s.ahora + (s.ahora === 1 ? ' conversación nueva' : ' conversaciones nuevas') + (s.delta == null ? '' : ' (' + (s.delta >= 0 ? '+' : '') + s.delta + ' % contra la anterior)')
        : 'Conversaciones nuevas y citas agendadas';
      dibujarSerieFacil();
    }).catch(function () {});
  }
  function vacioFacil(t, d) { return '<div class="fx-vacio"><b>' + esc(t) + '</b><span>' + esc(d) + '</span></div>'; }
  function diaCorto(iso) { return new Date(iso + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'short' }).replace('.', ''); }
  function diaLargo(iso) { return new Date(iso + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'short' }).replace('.', ''); }
  /**
   * La curva que pasa por los puntos sin pasarse de ellos (monótona, la de Fritsch y Carlson). 🪤 Una curva
   * cualquiera bajaba de cero entre dos días sin nada y dibujaba «−0,4 conversaciones»: esta no sale de los datos.
   */
  function curvaSuave(p) {
    var n = p.length, i;
    if (n < 2) return n ? 'M' + p[0][0] + ',' + p[0][1] : '';
    var d = [], m = [];
    for (i = 0; i < n - 1; i++) d.push((p[i + 1][1] - p[i][1]) / (p[i + 1][0] - p[i][0]));
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      var a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
      if (s > 9) { var k = 3 / Math.sqrt(s); m[i] = k * a * d[i]; m[i + 1] = k * b * d[i]; }
    }
    var out = 'M' + p[0][0] + ',' + p[0][1];
    for (i = 0; i < n - 1; i++) {
      var h = (p[i + 1][0] - p[i][0]) / 3;
      out += 'C' + (p[i][0] + h) + ',' + (p[i][1] + m[i] * h) + ' ' + (p[i + 1][0] - h) + ',' + (p[i + 1][1] - m[i + 1] * h) + ' ' + p[i + 1][0] + ',' + p[i + 1][1];
    }
    return out;
  }
  function dibujarSerieFacil() {
    var caja = $('fx-serie'), datos = FX.serie;
    if (!caja || !datos) return;
    if (!datos.some(function (x) { return x.a || x.b; })) { caja.innerHTML = vacioFacil('Sin actividad todavía', 'Cuando lleguen conversaciones, aquí se ve cómo va cada día.'); return; }
    var W = Math.max(280, caja.clientWidth), H = 288, izq = 30, der = 8, arr = 10, aba = 26;
    var max = Math.max(1, Math.max.apply(null, datos.map(function (x) { return Math.max(x.a, x.b); })));
    // Con aire arriba, como Nexora: el día más alto no toca el techo de la gráfica.
    var tope = Math.ceil((max + 0.5) / 4) * 4, paso = (W - izq - der) / Math.max(1, datos.length - 1);
    var X = function (i) { return izq + i * paso; }, Y = function (v) { return arr + (H - arr - aba) * (1 - v / tope); };
    var pa = datos.map(function (x, i) { return [X(i), Y(x.a)]; }), pb = datos.map(function (x, i) { return [X(i), Y(x.b)]; });
    var cada = Math.ceil(datos.length / 8);
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(datos.map(function (x) { return diaLargo(x.dia) + ': ' + x.a + ' nuevas, ' + x.b + ' citas'; }).join('; ')) + '">' +
      '<defs><linearGradient id="fx-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stop-color="#2563eb" stop-opacity=".24"/><stop offset="95%" stop-color="#2563eb" stop-opacity="0"/></linearGradient></defs>';
    for (var g = 0; g <= 4; g++) {
      var v = tope / 4 * g, y = Y(v);
      svg += '<line class="rejilla" x1="' + izq + '" x2="' + (W - der) + '" y1="' + y + '" y2="' + y + '"/><text class="eje" x="' + (izq - 8) + '" y="' + (y + 4) + '" text-anchor="end">' + v + '</text>';
    }
    datos.forEach(function (x, i) { if (i % cada === 0 || i === datos.length - 1) svg += '<text class="eje" x="' + X(i) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(diaCorto(x.dia)) + '</text>'; });
    var curva = curvaSuave(pa);
    svg += '<path d="' + curva + 'L' + X(datos.length - 1) + ',' + Y(0) + 'L' + X(0) + ',' + Y(0) + 'Z" fill="url(#fx-grad)"/>' +
      '<path class="linea-azul" d="' + curva + '"/><path class="linea-verde" d="' + curvaSuave(pb) + '"/>';
    datos.forEach(function (x, i) {
      svg += '<g class="col" data-i="' + i + '"><rect class="zona" x="' + (X(i) - paso / 2) + '" y="' + arr + '" width="' + paso + '" height="' + (H - arr - aba) + '"/>' +
        '<circle class="punto" cx="' + X(i) + '" cy="' + Y(x.a) + '" r="4" stroke="#2563eb"/><circle class="punto" cx="' + X(i) + '" cy="' + Y(x.b) + '" r="4" stroke="#10b981"/></g>';
    });
    caja.innerHTML = svg + '</svg><div class="fx-globo" id="fx-globo" hidden></div>';
    caja.querySelectorAll('.col').forEach(function (c) {
      c.onmouseenter = function () {
        var i = Number(c.getAttribute('data-i')), x = datos[i], gl = $('fx-globo');
        gl.innerHTML = '<b>' + esc(diaLargo(x.dia)) + '</b><span class="a">Conversaciones nuevas: ' + x.a + '</span><br><span class="v">Citas agendadas: ' + x.b + '</span>';
        gl.hidden = false;
        var izqG = Math.min(Math.max(0, X(i) + 12), caja.clientWidth - gl.offsetWidth);
        gl.style.left = (X(i) + 12 + gl.offsetWidth > caja.clientWidth ? X(i) - 12 - gl.offsetWidth : izqG) + 'px';
        gl.style.top = Math.max(0, Math.min(Y(x.a), Y(x.b)) - 20) + 'px';
      };
      c.onmouseleave = function () { $('fx-globo').hidden = true; };
    });
  }
  if ($('fx-serie-dias')) $('fx-serie-dias').onchange = function () { FX.dias = Number($('fx-serie-dias').value) || 7; cargarSerieFacil(); };
  var fxResize;
  window.addEventListener('resize', function () { clearTimeout(fxResize); fxResize = setTimeout(function () { if (state.view === 'today') dibujarSerieFacil(); }, 150); });

  // Dónde está cada persona hoy: una barra por etapa, en el orden del embudo del negocio.
  function pintarEtapasFacil(s) {
    var caja = $('fx-etapas');
    if (!caja || !s || !s.byStage) return;
    var etapas = (state.stages || []).length ? state.stages : Object.keys(s.stageLabels || {}).map(function (k) { return { id: k, label: s.stageLabels[k] }; });
    var max = Math.max(1, Math.max.apply(null, etapas.map(function (e) { return s.byStage[e.id] || 0; })));
    if (!etapas.some(function (e) { return s.byStage[e.id]; })) { caja.innerHTML = vacioFacil('Nadie en el embudo todavía', 'Aquí se ve cuántas personas hay en cada etapa.'); return; }
    caja.innerHTML = etapas.map(function (e) {
      var n = s.byStage[e.id] || 0;
      return '<button class="fx-barra" data-stage="' + esc(e.id) + '" title="Ver en el pipeline"><span class="nom">' + esc(e.label || e.id) + '</span>' +
        // Cero es nada: ni una rayita, que se lee como «casi nada».
        '<span class="pista"><i' + (n ? '' : ' class="cero"') + ' style="width:' + Math.round((n / max) * 100) + '%"></i></span><span class="cuantos">' + n + '</span></button>';
    }).join('');
    caja.querySelectorAll('.fx-barra').forEach(function (b) { b.onclick = function () { go('pipeline'); }; });
  }
  if ($('fx-ir-pipeline')) $('fx-ir-pipeline').onclick = function () { go('pipeline'); };

  // Lo último que pasó: los avisos (quién escribió por primera vez, quién pidió una persona, qué cita se agendó).
  // Si el servidor acaba de arrancar y todavía no hay avisos, las últimas conversaciones: algo pasó, y es eso.
  function pintarActividadFacil() {
    var caja = $('fx-actividad');
    if (!caja) return;
    var tono = function (k) { return k === 'appointment' || k === 'recordatorio' ? ['citas', 'verde'] : k === 'handoff' || k === 'verify' ? ['user', 'ambar'] : k === 'new' ? ['users', ''] : k === 'hot' ? ['objetivo', 'verde'] : ['actividad', '']; };
    var fila = function (x) {
      return '<button class="fx-act" data-id="' + esc(x.id) + '"><span class="fx-ic ' + x.tono[1] + '"><i class="ic" data-ic="' + x.tono[0] + '"></i></span>' +
        '<span class="cuerpo"><span class="t">' + esc(x.t) + '</span><span class="d">' + esc(x.d) + '</span></span><time>' + esc(x.cuando ? 'hace ' + rel(x.cuando) : '') + '</time></button>';
    };
    var pintar = function (lista) {
      caja.innerHTML = lista.length ? lista.map(fila).join('') : vacioFacil('Sin actividad reciente', 'Aquí aparece lo que va pasando: quién escribe, quién pide una persona, qué cita se agenda.');
      iconos(caja);
      caja.querySelectorAll('.fx-act').forEach(function (b) {
        b.onclick = function () { var id = b.getAttribute('data-id'); if (id && id !== 'system') { go('inbox'); openContact(id); } };
      });
    };
    var avisos = (state.notifs || []).filter(avisoParaMi).slice(0, 5);
    if (avisos.length) {
      pintar(avisos.map(function (n) { return { id: n.userId, t: n.title, d: n.body, cuando: n.ts, tono: tono(n.kind) }; }));
      return;
    }
    api('/contacts').then(function (l) {
      pintar((Array.isArray(l) ? l : []).filter(function (c) { return c.lastMessageAt; }).sort(function (a, b) { return b.lastMessageAt - a.lastMessageAt; }).slice(0, 5)
        .map(function (c) { return { id: c.id, t: nameOf(c) + ' escribió', d: c.recap || c.summary || channelIcon(c.channel), cuando: c.lastMessageAt, tono: ['burbuja', ''] }; }));
    }).catch(function () { pintar([]); });
  }
  if ($('fx-ver-todo')) $('fx-ver-todo').onclick = function (e) { e.stopPropagation(); if ((state.notifs || []).length) $('notif').classList.add('open'); else go('inbox'); };

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
    if ($('fx-punto')) $('fx-punto').hidden = !unseen;
    $('notif-list').innerHTML = state.notifs.length ? state.notifs.map(function (n) { return '<div class="n' + (n.id > state.notifSeen ? ' unseen' : '') + '" data-id="' + esc(n.userId) + '"><b>' + esc(n.title) + '</b><span>' + esc(n.body) + ' · ' + rel(n.ts) + '</span></div>'; }).join('') : '<div class="empty">Nada todavía.</div>';
    $('notif-list').querySelectorAll('.n').forEach(function (el) { el.onclick = function () { $('notif').classList.remove('open'); var id = el.getAttribute('data-id'); if (id === 'system') go('agent'); else { go('inbox'); openContact(id); } }; });
  }
  // Con el candado no van los avisos del sistema (los motores, el enlace público): quien atiende no puede hacer nada
  // con ellos y llevan a pantallas que no ve. Quien administra aiva los sigue viendo.
  function avisoParaMi(n) { return !(enCandado() && n && (n.userId === 'system' || n.kind === 'public' || n.kind === 'engine')); }
  function loadNotifs() { api('/notifications').then(function (list) { state.notifs = Array.isArray(list) ? list.filter(avisoParaMi) : list; renderNotifs(); }); }
  $('bell-btn').onclick = function (e) { e.stopPropagation(); $('notif').classList.toggle('open'); };
  document.addEventListener('click', function (e) { if (!$('notif').contains(e.target) && e.target !== $('bell-btn')) $('notif').classList.remove('open'); });
  $('notif-clear').onclick = function () { state.notifSeen = state.notifs.length ? Math.max.apply(null, state.notifs.map(function (n) { return n.id; })) : 0; try { localStorage.setItem(LLAVE('notifSeen'), String(state.notifSeen)); } catch (e) {} renderNotifs(); };

  // ---------- pipeline ----------
  // Con varias sedes, el equipo de cada una mira sus prospectos. Quien todavía no escogió sede no es de ninguna: sale
  // en «Todas» y en «Sin sede todavía», que es justo donde hay que ir a preguntarle.
  var pipSede = helpGet('aiva.pip.sede') || '';
  function pintarSedesPip() {
    if (!variasSedes()) { $('pip-sede').hidden = true; return; }
    if (pipSede && pipSede !== '_ninguna' && !nombreSede(pipSede)) pipSede = '';
    $('pip-sede').innerHTML = '<option value="">Todas las sedes</option>' +
      state.sedes.map(function (s) { return '<option value="' + esc(s.id) + '"' + (s.id === pipSede ? ' selected' : '') + '>' + esc(s.nombre) + '</option>'; }).join('') +
      '<option value="_ninguna"' + (pipSede === '_ninguna' ? ' selected' : '') + '>Sin sede todavía</option>';
    $('pip-sede').hidden = false;
  }
  $('pip-sede').onchange = function () { pipSede = this.value; helpSet('aiva.pip.sede', pipSede); loadPipeline(); };
  function deLaSede(c) {
    if (!pipSede || !variasSedes()) return true;
    var s = c.data && c.data.sede;
    return pipSede === '_ninguna' ? !s : s === pipSede;
  }

  function sumaColumna(cards) {
    var n = cards.reduce(function (a, c) { return a + (c.valor || 0); }, 0);
    return n ? '<span class="suma">' + esc(plataCorta(n)) + '</span>' : '';
  }
  /**
   * Las cifras de arriba de Prospectos: cuánto hay en juego y dónde. Cada una dice de dónde sale, porque un
   * número sin explicación se lee como el que uno espera y no como el que es.
   */
  function pintarCifrasEmbudo(list) {
    var abiertas = list.filter(abierta);
    var suma = function (l) { return l.reduce(function (a, c) { return a + (c.valor || 0); }, 0); };
    var total = suma(abiertas);
    var conPrecio = abiertas.filter(function (c) { return c.valor; }).length;
    var ponderado = abiertas.reduce(function (a, c) { return a + (c.valor || 0) * Math.min(100, Math.max(0, c.score || 0)) / 100; }, 0);
    var conCita = abiertas.filter(function (c) { return c.proximo && c.proximo.tipo === 'cita'; });
    var cifra = function (k, t, n, p) { return '<div class="pc" data-k="' + k + '"><span class="t">' + t + '</span><span class="n' + (n ? '' : ' flojo') + '">' + esc(n || 'Sin precios') + '</span><span class="p">' + p + '</span></div>'; };
    // 🪤 Cero no se pinta como «$0»: sin precios lo que falta es cargarlos, y un cero diría que no vale nada.
    var el = $('pip-cifras');
    // 🪤 Sin ningún precio, «Embudo abierto» y «Ponderado» decían los dos «Sin precios»: dos cifras para un solo
    // hecho. Entonces va una sola, que dice qué falta y lleva a arreglarlo.
    el.innerHTML = (total
      ? cifra('abierto', 'Embudo abierto', plataCorta(total), conPrecio + ' de ' + abiertas.length + ' con precio') +
        cifra('ponderado', 'Probable, según el puntaje', plataCorta(ponderado), 'Cada valor por su probabilidad')
      : cifra('abierto', 'Valor en juego', '', '<button class="linkbtn" id="pip-precios" title="Ni el catálogo ni las fichas tienen precios">Cargar precios</button>')) +
      cifra('cita', 'Con cita por delante', suma(conCita) ? plataCorta(suma(conCita)) : (conCita.length ? '' : '—'), conCita.length + (conCita.length === 1 ? ' persona con cita' : ' personas con cita')) +
      cifra('vendido', 'Vendido en 30 días', '…', variasSedes() && pipSede ? 'todas las sedes' : '&nbsp;') +
      // La barra reparte el embudo abierto por etapa, con el color de cada una. Es lo mismo que dicen las sumas de
      // las columnas, de un vistazo: por eso va oculta para un lector de pantalla, que ya tiene las columnas.
      (total ? '<div class="pc-barra" aria-hidden="true">' + (state.stages || []).filter(function (e) { return e.rol !== 'ganado' && e.rol !== 'perdido'; }).map(function (e) {
        var n = suma(abiertas.filter(function (c) { return c.stage === e.id; }));
        return n ? '<i data-rol="' + esc(e.rol || '') + '" style="flex:' + n + '" title="' + esc(e.label + ': ' + plataCorta(n)) + '"></i>' : '';
      }).join('') + '</div>' : '');
    if ($('pip-precios')) $('pip-precios').onclick = function () { go('knowledge'); };
    // Las cifras no se ven en el modo fácil, y con el candado el servidor ni las da: no se piden.
    if (!esFacil()) api('/ventas?days=30').then(function (v) {
      var b = el.querySelector('[data-k=vendido]');
      if (!b || !v || v.error) return;
      b.querySelector('.n').textContent = v.total ? plataCorta(v.total) : (v.cuantas ? 'Sin precios' : '—');
      b.querySelector('.n').classList.toggle('flojo', !v.total);
      b.querySelector('.p').textContent = (v.cuantas || 0) + (v.cuantas === 1 ? ' venta' : ' ventas') + (variasSedes() && pipSede ? ' · todas las sedes' : '');
    });
  }
  function loadPipeline(focusId) {
    pintarSedesPip();
    api('/contacts?limit=2000').then(function (todos) {
      var list = todos.filter(deLaSede);
      state.pipeLista = list;
      pintarCifrasEmbudo(list);
      // Al redibujar (también por un evento en vivo) el foco no se pierde: vuelve a la misma tarjeta.
      var active = document.activeElement && document.activeElement.closest ? document.activeElement.closest('#board .card') : null;
      focusId = focusId || (active && active.getAttribute('data-id'));
      var stages = Object.keys(state.stageLabels);
      // «Mover» sigue en cada tarjeta, porque en el celular arrastrar no funciona (diseno-tablero.md, 2026-09-21),
      // pero compacto, al final de la fila de abajo: entero y a todo el ancho pesaba más que el nombre del cliente.
      var moveTo = function (c) {
        return '<select class="card-move" aria-label="Mover a ' + esc(nameOf(c)) + ' a otra etapa"><option value="" selected disabled>Mover…</option>' +
          stages.filter(function (k) { return k !== c.stage; }).map(function (k) { return '<option value="' + k + '">' + esc(state.stageLabels[k]) + '</option>'; }).join('') + '</select>';
      };
      // 🪤 Tarjetas más simples (2026-10-21): llevaban ocho cosas —puntaje, días, nombre, resumen, próximo paso,
      // quién la lleva, canal, sin leer— más un selector a todo el ancho. Ahora cada pieza sale solo si DICE algo,
      // como en la lista de conversaciones: el puntaje si es caliente, el paso si urge o es una cita, el valor si
      // se sabe, quién la lleva si es una persona. Lo demás está a un clic, en la conversación y su perfil.
      var tarjeta = function (c) {
        var paso = c.proximo && c.proximo.texto && (c.proximo.urgente || c.proximo.tipo === 'cita') ? pasoHtml(c.proximo) : '';
        var sede = variasSedes() && c.data && c.data.sede ? '<span class="chip">' + esc(nombreSede(c.data.sede)) + '</span>' : '';
        var texto = c.recap || c.summary || '';
        return '<div class="card" draggable="true" data-id="' + esc(c.id) + '"><div class="body">' +
          '<div class="t"><button type="button" class="card-open" title="Abrir la conversación">' + esc(nameOf(c)) + '</button>' +
            (c.unread ? '<span class="unread" title="' + c.unread + ' sin leer">' + c.unread + '</span>' : '') +
            '<span class="grow"></span><span class="cuando">' + esc(c.lastMessageAt ? rel(c.lastMessageAt) : '') + '</span></div>' +
          (texto ? '<div class="s">' + esc(texto) + '</div>' : '') +
          // El paso que urge va en su propia línea: compartiendo fila con «Mover…» quedaba en «Atender: l…».
          (paso ? '<div class="paso-linea">' + paso + '</div>' : '') +
          '<div class="cifra">' + (esCaliente(c) ? scoreChip(c) : '') + sede + (c.valor ? valorHtml(c, true) : '') +
            (c.humanMode ? '<span class="lleva-mini" title="La lleva ' + esc(llevaDe(c).nombre) + '">' + llevaHtml(c) + '</span>' : '') +
            moveTo(c) + '</div>' +
          '</div></div>';
      };
      $('board').innerHTML = stages.map(function (s) {
        var cards = list.filter(function (c) { return c.stage === s; });
        // El color de la columna sale del PAPEL de la etapa, no de su nombre: cada negocio las llama distinto y
        // con los nombres fijos una financiera veía el tablero entero en gris.
        var def = (state.stages || []).find(function (x) { return x.id === s; }) || {};
        // Una etapa vacía no necesita el mismo ancho que una llena: encogida deja ver más del tablero sin
        // esconderla, que sigue siendo un sitio donde soltar una tarjeta.
        return '<div class="col' + (cards.length ? '' : ' vacia') + '" data-stage="' + s + '" data-rol="' + esc(def.rol || '') + '">' +
          // Cuántas y cuánto suman: la columna dice dónde está la plata, no solo dónde está la gente.
          '<h3><span class="nom">' + esc(state.stageLabels[s]) + '</span><span class="cuenta">' + cards.length + '</span>' + sumaColumna(cards) + '</h3><div class="cards">' +
          cards.map(tarjeta).join('') +
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
      // Después de mover con «Mover…», el foco sigue a la tarjeta en su nueva columna.
      var moved = focusId && $('board').querySelector('.card[data-id="' + (window.CSS && CSS.escape ? CSS.escape(focusId) : focusId) + '"] .card-open');
      if (moved) { moved.focus(); moved.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    });
  }
  function moveCard(id, stage) {
    if (!id || !stage) return;
    var c = (state.pipeLista || []).find(function (x) { return x.id === id; }) || { id: id };
    if (c.stage === stage) return;
    cambiarEtapa(c, stage, function (r) {
      // Sin respuesta es que se arrepintió en la pregunta de por qué se perdió: la tarjeta vuelve a su sitio.
      $('board-status').textContent = !r ? 'Se quedó donde estaba.' : r.error ? 'No se pudo mover: ' + r.error : 'Movida a ' + (state.stageLabels[stage] || stage) + '.';
      loadPipeline(id);
    });
  }

  // ---------- por qué se perdió ----------
  // 🪤 Se pregunta al pasar a perdido, en una ventana y no con un campo más de la ficha: es el único momento en
  // que alguien sabe la respuesta. Pero es OPCIONAL —el botón mueve igual sin motivo—: una pregunta obligatoria
  // para mover una tarjeta enseña a contestar cualquier cosa, y entonces el informe miente.
  var perdida = null;
  function cambiarEtapa(c, stage, listo) {
    if (rol(stage) !== 'perdido') { pedirEtapa(c.id, stage, null, listo); return; }
    var dlg = $('dlg-perdida');
    perdida = { c: c, stage: stage, listo: listo, elegido: '', hecho: false };
    $('perdida-quien').textContent = nameOf(c);
    $('perdida-ok').textContent = c.stage === stage ? 'Guardar' : 'Pasar a ' + etiquetaEtapa(stage);
    $('perdida-otro').value = '';
    $('perdida-motivos').innerHTML = (state.motivosPerdida || []).map(function (m) {
      return '<button type="button" class="motivo" aria-pressed="false" data-motivo="' + esc(m) + '">' + esc(m) + '</button>';
    }).join('');
    Array.prototype.forEach.call($('perdida-motivos').querySelectorAll('[data-motivo]'), function (b) {
      b.onclick = function () {
        var on = b.getAttribute('aria-pressed') !== 'true';
        Array.prototype.forEach.call($('perdida-motivos').querySelectorAll('[data-motivo]'), function (x) { x.setAttribute('aria-pressed', String(on && x === b)); });
        perdida.elegido = on ? b.getAttribute('data-motivo') : '';
        if (on) $('perdida-otro').value = '';
      };
    });
    dlg.showModal();
    var primero = $('perdida-motivos').querySelector('button');
    (primero || $('perdida-otro')).focus();
  }
  function pedirEtapa(id, stage, motivo, listo) {
    var body = { stage: stage };
    if (motivo) body.motivo = motivo;
    api('/contacts/' + encodeURIComponent(id), { method: 'PATCH', body: body }).then(function (r) { listo(r || {}); });
  }
  if ($('dlg-perdida')) {
    // Escribir otro motivo apaga el que estuviera escogido: los dos a la vez no se sabría cuál vale.
    $('perdida-otro').oninput = function () {
      if (!$('perdida-otro').value.trim()) return;
      perdida.elegido = '';
      Array.prototype.forEach.call($('perdida-motivos').querySelectorAll('[data-motivo]'), function (x) { x.setAttribute('aria-pressed', 'false'); });
    };
    $('perdida-ok').onclick = function () {
      if (!perdida) return;
      var p = perdida, motivo = p.elegido || $('perdida-otro').value.trim();
      p.hecho = true;
      $('dlg-perdida').close();
      pedirEtapa(p.c.id, p.stage, motivo || null, p.listo);
    };
    $('perdida-cancelar').onclick = function () { $('dlg-perdida').close(); };
    // Cerrar con Escape o con «No moverla» es lo mismo: la ficha se queda en su etapa y quien llamó lo sabe.
    $('dlg-perdida').addEventListener('close', function () {
      var p = perdida; perdida = null;
      if (p && !p.hecho) p.listo(null);
    });
  }
  /** Debajo de la etapa, si está perdida: por qué, o el botón para decirlo. */
  function motivoHtml(c, id) {
    if (rol(c.stage) !== 'perdido') return '';
    var m = c.data && c.data.motivo_perdida;
    return '<div class="small muted motivo-perdida">' + (m ? 'Por qué: ' + esc(m) + ' · ' : '') +
      '<button class="linkbtn" type="button" id="' + id + '">' + (m ? 'Cambiar' : 'Decir por qué') + '</button></div>';
  }

  // ---------- quién está a cargo ----------
  // 🪤 «La lleva» es quién contesta AHORA, y se borra cuando el asistente vuelve a atender. «A cargo» es de quién es
  // el cliente, y se queda: lo que pedía quien revisó aiva era poder decir «este es de Laura» y filtrarlo.
  function genteDelEquipo(c) {
    var nombres = equipoDisponible().map(function (u) { return u.nombre; });
    // Con el token a secas no se sabe quién es el equipo: por lo menos uno mismo.
    if (!nombres.length && state.name) nombres.push(state.name);
    if (c.responsable && !nombres.some(function (n) { return mismoNombre(n, c.responsable); })) nombres.unshift(c.responsable);
    return nombres;
  }
  function responsableHtml(c, id) {
    return '<select id="' + id + '" aria-label="Quién está a cargo">' +
      '<option value=""' + (c.responsable ? '' : ' selected') + '>Nadie todavía</option>' +
      genteDelEquipo(c).map(function (n) {
        return '<option value="' + esc(n) + '"' + (mismoNombre(n, c.responsable) ? ' selected' : '') + '>' + esc(n) + (mismoNombre(n, state.name) ? ' (tú)' : '') + '</option>';
      }).join('') + '</select>';
  }
  function engancharResponsable(sel, c, listo) {
    if (!sel) return;
    sel.onchange = function () {
      var a = sel.value || null;
      api('/contacts/' + encodeURIComponent(c.id), { method: 'PATCH', body: { responsable: a } }).then(function (r) {
        if (r && r.error) { toast(r.error); sel.value = c.responsable || ''; return; }
        toast(a ? 'A cargo: ' + a : 'Sin nadie a cargo');
        cuentasLuego();
        listo();
      });
    };
  }

  // ---------- calendario (vista semanal tipo agenda) ----------
  // En el celular la semana no cabe (siete columnas): se abre en Agenda, que es una lista. Lo que elijas se recuerda.
  var onPhone = function () { return window.matchMedia('(max-width: 900px)').matches; };
  var cal = { mode: helpGet('aiva.cal.mode') || (onPhone() ? 'agenda' : 'week'), start: startOfWeek(new Date()), cfg: null, appts: [], todas: [], busy: [], sede: helpGet('aiva.cal.sede') || '', sedesAg: [] };
  var HOUR_PX = 56;
  function startOfWeek(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function hm(str) { var p = str.split(':'); return Number(p[0]) + Number(p[1] || 0) / 60; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function toLocalInput(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }

  // ---------- sedes (src/crm/sedes.ts) ----------
  // 🪤 Una cita sin sede es de antes de que el negocio tuviera sedes, y se cuenta en la primera, igual que en la
  // agenda del servidor: si aquí se contara en ninguna, el calendario la escondería al filtrar por sede.
  function variasSedes() { return (state.sedes || []).length > 1; }
  function sedeDe(a) { return a.sede || ((state.sedes || [])[0] || {}).id || ''; }
  function nombreSede(id) { var s = (state.sedes || []).filter(function (x) { return x.id === id; })[0]; return s ? s.nombre : ''; }
  function conSede(a) { return variasSedes() && sedeDe(a) ? ' · ' + nombreSede(sedeDe(a)) : ''; }
  function filtrarSede(list) { return cal.sede && variasSedes() ? list.filter(function (a) { return sedeDe(a) === cal.sede; }) : list; }
  // Lo que se pinta abierto: el de la sede que se mira, o con «todas», lo que abre cualquiera.
  function agendaVista(def) {
    var base = cal.cfg || def;
    var ss = cal.sedesAg || [];
    if (ss.length < 2) return base;
    var una = ss.filter(function (s) { return s.id === cal.sede; })[0];
    if (una) return Object.assign({}, base, { days: una.days, hours: una.hours });
    var days = [], hours = [];
    ss.forEach(function (s) { s.days.forEach(function (d) { if (days.indexOf(d) < 0) days.push(d); }); s.hours.forEach(function (h) { hours.push(h); }); });
    return Object.assign({}, base, { days: days, hours: hours });
  }
  function pintarSedesCal() {
    var ss = cal.sedesAg || [];
    if (ss.length < 2) { $('cal-sede').hidden = true; $('book-sede-l').hidden = true; return; }
    if (cal.sede && !ss.some(function (s) { return s.id === cal.sede; })) cal.sede = '';
    $('cal-sede').innerHTML = '<option value="">Todas las sedes</option>' + ss.map(function (s) { return '<option value="' + esc(s.id) + '"' + (s.id === cal.sede ? ' selected' : '') + '>' + esc(s.nombre) + '</option>'; }).join('');
    $('cal-sede').hidden = false;
    // Al agendar a mano se escoge sede, siempre: sin ella la cita no se agenda (y escoger una por defecto mandaría a
    // alguien a la otra punta). Si se está mirando una, esa viene puesta.
    var puesta = $('book-sede').value || cal.sede;
    $('book-sede').innerHTML = '<option value="">Escoge la sede</option>' + ss.map(function (s) { return '<option value="' + esc(s.id) + '"' + (s.id === puesta ? ' selected' : '') + '>' + esc(s.nombre) + '</option>'; }).join('');
    $('book-sede-l').hidden = false;
  }

  function loadCalendar() {
    var p = cal.cfg ? Promise.resolve(cal.cfg) : api('/agent').then(function (a) { cal.cfg = a.appointments; cal.sedesAg = a.sedes || []; pintarSedesCal(); return cal.cfg; });
    p.then(function () {
      // 🪤 «Agenda» son LAS PRÓXIMAS CITAS, no las de la semana que estés mirando. Pedía solo el rango de la
      // semana y luego filtraba por ella, así que una cita del lunes siguiente salía como «sin citas» estando
      // a tres días. Quien lo ve no piensa «estoy en otra semana»: piensa que la cita se perdió.
      var from, to;
      if (cal.mode === 'agenda') { from = Date.now() - 86400000; to = Date.now() + 120 * 86400000; }
      else if (cal.mode === 'month') {
        // El mes entero más el borde: la rejilla enseña días del mes anterior y del siguiente, y si no se piden
        // esas citas, las primeras y últimas casillas salen vacías aunque haya algo.
        var m0 = new Date(cal.start.getFullYear(), cal.start.getMonth(), 1);
        from = addDays(m0, -7).getTime();
        to = addDays(new Date(cal.start.getFullYear(), cal.start.getMonth() + 1, 1), 7).getTime();
      } else { from = addDays(cal.start, -1).getTime(); to = addDays(cal.start, 8).getTime(); }
      // Los bloques ocupados de la sede que se mira: los del dueño y los de su calendario (src/crm/busy.ts).
      var deLaSede = cal.sede && variasSedes() ? '&sede=' + encodeURIComponent(cal.sede) : '';
      return Promise.all([api('/appointments?from=' + from + '&to=' + to), api('/busy?from=' + from + '&to=' + to + deLaSede)]);
    }).then(function (r) {
      var list = r[0]; cal.busy = r[1] || [];
      cal.todas = list;
      cal.appts = filtrarSede(list);
      $('badge-cal').textContent = list.filter(function (a) { return a.status === 'confirmada' && a.startsAt >= Date.now(); }).length || '';
      if ($('fx-n-citas')) $('fx-n-citas').textContent = $('badge-cal').textContent;
      renderCalendar();
    });
    api('/contacts?limit=500').then(function (list) { $('book-contact').innerHTML = list.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(nameOf(c)) + '</option>'; }).join(''); });
  }
  function renderCalendar() {
    var end = addDays(cal.start, 6);
    var fmt = function (d) { return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }); };
    $('cal-label').textContent = fmt(cal.start) + ' – ' + fmt(end) + ' ' + end.getFullYear();
    $('cal-grid').hidden = cal.mode !== 'week';
    $('cal-list').hidden = cal.mode !== 'agenda';
    if ($('cal-month')) $('cal-month').hidden = cal.mode !== 'month';
    // Las flechas no pintan nada en Agenda, que enseña todo lo que viene. En Mes mueven de mes en mes.
    if ($('cal-prev')) { $('cal-prev').hidden = cal.mode === 'agenda'; $('cal-prev').setAttribute('aria-label', cal.mode === 'month' ? 'Mes anterior' : 'Semana anterior'); }
    if ($('cal-next')) { $('cal-next').hidden = cal.mode === 'agenda'; $('cal-next').setAttribute('aria-label', cal.mode === 'month' ? 'Mes siguiente' : 'Semana siguiente'); }
    $('cal-week-btn').classList.toggle('on', cal.mode === 'week');
    $('cal-month-btn').classList.toggle('on', cal.mode === 'month');
    $('cal-agenda-btn').classList.toggle('on', cal.mode === 'agenda');
    $('cal-week-btn').setAttribute('aria-pressed', String(cal.mode === 'week'));
    $('cal-month-btn').setAttribute('aria-pressed', String(cal.mode === 'month'));
    $('cal-agenda-btn').setAttribute('aria-pressed', String(cal.mode === 'agenda'));
    if (cal.mode === 'week') renderWeek(); else if (cal.mode === 'month') renderMonth(); else renderAgenda();
  }
  function renderWeek() {
    var cfg = agendaVista({ days: [1, 2, 3, 4, 5], hours: [['09:00', '18:00']], durationMin: 45, enabled: false });
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
        return '<div class="cal-ev ' + a.status + '" data-id="' + a.id + '" title="' + esc(who + ' · ' + mark + hhmm(a.startsAt) + ' · ' + a.service + conSede(a)) + '" style="top:' + top + 'px;height:' + height + 'px"><b>' + esc(who) + '</b><span>' + esc(mark + hhmm(a.startsAt)) + '</span><span>' + esc(a.service) + '</span></div>';
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

  /**
   * El mes, como un calendario de pared: la rejilla manda y las citas son renglones dentro del día.
   *
   * 🪤 Se dibujan seis semanas SIEMPRE, no las que haga falta. Un mes ocupa cinco o seis según en qué día caiga
   * el uno, y una rejilla que cambia de alto hace saltar la pantalla entera cada vez que se pasa de mes.
   */
  function renderMonth() {
    var y = cal.start.getFullYear(), mo = cal.start.getMonth();
    var cfg = agendaVista({ days: [1, 2, 3, 4, 5] });
    $('cal-label').textContent = new Date(y, mo, 1).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
    var primero = new Date(y, mo, 1);
    var inicio = addDays(primero, -((primero.getDay() + 6) % 7)); // la rejilla arranca en lunes
    var hoy = new Date();
    var cab = '<div class="mes-cab">' + ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'].map(function (d) { return '<div>' + d + '</div>'; }).join('') + '</div>';
    var celdas = [];
    for (var i = 0; i < 42; i++) {
      var d = addDays(inicio, i);
      var delMes = d.getMonth() === mo;
      var abierto = cfg.days.indexOf(d.getDay()) >= 0;
      var citas = cal.appts.filter(function (a) { return sameDay(new Date(a.startsAt), d); })
        .sort(function (a, b) { return a.startsAt - b.startsAt; });
      var dentro = citas.slice(0, 3).map(function (a) {
        return '<button class="cita ' + a.status + '" data-id="' + a.id + '" title="' + esc((a.contactName || short(a.userId)) + ' · ' + (a.service || '')) + '">' +
          hhmm(a.startsAt) + ' ' + esc(a.contactName || short(a.userId)) + '</button>';
      }).join('');
      if (citas.length > 3) dentro += '<div class="mas">+' + (citas.length - 3) + ' más</div>';
      celdas.push('<div class="dia' + (delMes ? '' : ' otro') + (abierto ? '' : ' cerrado') + (sameDay(d, hoy) ? ' hoy' : '') + '">' +
        '<span class="n">' + d.getDate() + '</span>' + dentro + '</div>');
    }
    $('cal-month').innerHTML = cab + '<div class="mes">' + celdas.join('') + '</div>';
    // Tocar una cita abre su conversación, que es lo que uno quiere hacer desde un calendario.
    Array.prototype.forEach.call($('cal-month').querySelectorAll('.cita'), function (b) {
      b.onclick = function () {
        var a = cal.appts.filter(function (x) { return String(x.id) === b.dataset.id; })[0];
        if (a) { go('inbox'); openContact(a.userId); }
      };
    });
  }

  function renderAgenda() {
    // Todo lo que viene, en orden, sin importar qué semana esté puesta arriba.
    var list = cal.appts.filter(function (a) { return a.startsAt >= Date.now() - 2 * 3600000; })
      .sort(function (a, b) { return a.startsAt - b.startsAt; });
    if (!list.length) { $('cal-list').innerHTML = '<div class="empty">No hay citas próximas.</div>'; return; }
    var byDay = {};
    list.forEach(function (a) { var day = new Date(a.startsAt).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }); (byDay[day] = byDay[day] || []).push(a); });
    $('cal-list').innerHTML = Object.keys(byDay).map(function (day) {
      return '<div class="day"><h3>' + esc(day) + '</h3>' + byDay[day].map(function (a) {
        return '<div class="appt ' + a.status + '"><span class="t">' + hhmm(a.startsAt) + '</span><span class="grow"><b>' + esc(a.contactName || short(a.userId)) + '</b> <span class="muted small">' + esc(a.service + conSede(a)) + (a.notes ? ' · ' + esc(a.notes) : '') + '</span></span>' +
          (a.status === 'confirmada' ? '<button class="btn sm" data-act="completada" data-id="' + a.id + '">Asistió</button><button class="btn sm" data-act="no_asistio" data-id="' + a.id + '">No asistió</button><button class="btn sm danger" data-act="cancelada" data-id="' + a.id + '">Cancelar</button>' : '<span class="chip">' + a.status + '</span>') +
          '<button class="btn sm" data-open="' + esc(a.userId) + '">Chat</button></div>';
      }).join('') + '</div>';
    }).join('');
    $('cal-list').querySelectorAll('[data-act]').forEach(function (b) { b.onclick = function () { api('/appointments/' + b.getAttribute('data-id'), { method: 'PATCH', body: { status: b.getAttribute('data-act') } }).then(loadCalendar); }; });
    $('cal-list').querySelectorAll('[data-open]').forEach(function (b) { b.onclick = function () { go('inbox'); openContact(b.getAttribute('data-open')); }; });
  }
  // 🪤 Cambiar de modo RECARGA, no solo repinta: Semana pide una semana y Agenda pide cuatro meses. Repintando
  // a secas, Agenda enseñaba lo que había traído Semana —una semana— y seguía diciendo que no hay citas.
  $('cal-week-btn').onclick = function () { cal.mode = 'week'; helpSet('aiva.cal.mode', 'week'); loadCalendar(); };
  $('cal-agenda-btn').onclick = function () { cal.mode = 'agenda'; helpSet('aiva.cal.mode', 'agenda'); loadCalendar(); };
  $('cal-month-btn').onclick = function () {
    cal.mode = 'month';
    // 🪤 Se ancla al mes de MITAD de semana, no al del lunes. La semana del 28 de septiembre tiene su lunes en
    // septiembre y casi toda ella en octubre: entrando desde ahí un 2 de octubre, el mes abría en septiembre y
    // parecía que el calendario se había ido al pasado.
    var medio = addDays(cal.start, 3);
    cal.start = new Date(medio.getFullYear(), medio.getMonth(), 1);
    helpSet('aiva.cal.mode', 'month');
    loadCalendar();
  };
  var mover = function (signo) {
    if (cal.mode === 'month') cal.start = new Date(cal.start.getFullYear(), cal.start.getMonth() + signo, 1);
    else cal.start = addDays(cal.start, 7 * signo);
    loadCalendar();
  };
  $('cal-prev').onclick = function () { mover(-1); };
  $('cal-next').onclick = function () { mover(1); };
  $('cal-today').onclick = function () { cal.start = startOfWeek(new Date()); loadCalendar(); };
  $('cal-sede').onchange = function () {
    cal.sede = $('cal-sede').value;
    helpSet('aiva.cal.sede', cal.sede);
    if (cal.sede) $('book-sede').value = cal.sede;
    // Se recarga y no solo se repinta: los bloques ocupados también cambian con la sede.
    loadCalendar();
  };
  $('book-btn').onclick = function () {
    var userId = $('book-contact').value, when = $('book-when').value; if (!userId || !when) { $('book-msg').textContent = 'Elige contacto y fecha.'; return; }
    if (variasSedes() && !$('book-sede').value) { $('book-msg').textContent = 'Elige en qué sede.'; return; }
    api('/appointments', { method: 'POST', body: { userId: userId, startsAt: new Date(when).toISOString(), notes: $('book-notes').value, sede: variasSedes() ? $('book-sede').value : undefined } }).then(function (r) { $('book-msg').textContent = r.error ? 'Error: ' + r.error : 'Cita agendada.'; if (!r.error) $('book-notes').value = ''; loadCalendar(); });
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
  // El mes y su tope (src/crm/presupuesto.ts). Aquí solo se lee: el tope lo pone quien administra aiva.
  var TOPE_DICE = {
    aviso: 'Al 90 % empieza a ahorrar.',
    ahorro: 'Ahorrando: lo específico lo contesta el modelo de responder, que es el barato.',
    agotado: 'Llegó al tope: hasta el mes siguiente, lo que necesita IA te llega a ti para contestarlo a mano. Lo que se resuelve sin IA, como las citas, sigue igual.'
  };
  function topeLinea(p) {
    if (!p || p.error) return '';
    if (p.tope == null) return '<div class="small">Este mes van ' + usd(p.gastado) + ' en IA.</div>';
    var texto = 'Este mes van <b>' + usd(p.gastado) + '</b> de un tope de <b>' + usd(p.tope) + '</b> (' + p.porcentaje + ' %). ' + esc(TOPE_DICE[p.nivel] || '');
    // .aviso es una fila flexible: el texto va en un solo <span> para que no se parta en pedazos separados por el hueco.
    return p.nivel === 'agotado' ? '<div class="aviso small" style="margin:6px 0"><span>' + texto + '</span></div>' : '<div class="small">' + texto + '</div>';
  }
  function usagePanel(u, tope) {
    if (!u.rows.length) return '<div class="panel"><b>Consumo de IA · 7 días</b>' + topeLinea(tope) + '<div class="small muted">Sin llamadas a modelos en los últimos 7 días.</div></div>';
    var rows = u.rows.map(function (r) {
      return '<tr><td>' + esc(TASKS[r.task] || r.task) + '</td><td>' + esc((r.engine === 'openai' || r.engine === 'anthropic' ? '' : r.engine + ' · ') + r.model) + '</td><td class="n">' + r.calls + '</td><td class="n">' + Math.round(r.inputTokens / r.calls) + ' / ' + Math.round(r.outputTokens / r.calls) + '</td><td class="n">' + usd(r.costUsd) + '</td></tr>';
    }).join('');
    return '<div class="panel"><b>Consumo de IA · 7 días</b>' + topeLinea(tope) +
      '<div>' + usd(u.totalUsd) + ' en total' + (u.usdPerConversation !== null ? ' · ' + usd(u.usdPerConversation) + ' por conversación · ' + usd(u.usdPerMessage) + ' por mensaje del cliente' : '') + '</div>' +
      '<table class="usage"><thead><tr><th>Tarea</th><th>Modelo</th><th class="n">Llamadas</th><th class="n">Tokens por llamada (entrada / salida)</th><th class="n">Costo</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      cacheLineas(u.cache) +
      '<div class="small muted">Costo estimado con la tarifa estándar de cada proveedor' + (u.unpriced ? ' (hay modelos sin precio conocido: el total se queda corto)' : '') + '. Los modelos locales no cuestan.</div></div>';
  }
  // Lo que hizo la caché (src/llm/usage.ts › efectoCache). 🪤 Con Claude guardar cuesta, y si los mensajes llegan
  // más espaciados que los 5 minutos que dura, la caché sale más cara que no tenerla: por eso las dos cifras.
  var PROVEEDOR = { openai: 'OpenAI', anthropic: 'Claude' };
  function cacheLineas(cache) {
    return (cache || []).map(function (c) {
      var neto = c.ahorroUsd - c.guardarUsd;
      return '<div class="small">Caché de ' + esc(PROVEEDOR[c.engine] || c.engine) + ': releer lo ya leído ahorró ' + usd(c.ahorroUsd) +
        (c.guardarUsd > 0 ? '; guardarlo costó ' + usd(c.guardarUsd) + ' de más. ' + (neto >= 0 ? 'Neto, ahorró ' + usd(neto) + '.' : 'Neto, costó ' + usd(-neto) + ' más que no tenerla.') : '.') + '</div>';
    }).join('');
  }
  function calendarPanel(cfg) {
    var f = cfg.feed;
    var busy = cfg.busy.length
      ? '<ul>' + cfg.busy.map(function (s) { return '<li>' + (s.ok ? '✓ ' : '✗ ') + esc(s.label) + (s.sede ? ' · solo ' + esc(nombreSede(s.sede) || s.sede) : '') + ' · ' + (s.ok ? s.intervals + ' eventos próximos' + (s.syncedAt ? ', leído ' + new Date(s.syncedAt).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' }) : '') : esc(s.error || 'sin leer todavía')) + '</li>'; }).join('') + '</ul><div class="small muted">Sus eventos ocupan la agenda: el bot no ofrece esas horas. Se leen cada 5 minutos.</div>'
      : '<div class="small muted">' + esc(state.agentName || 'El asistente') + ' todavía no ve tu calendario, así que puede ofrecer horas en las que ya estás ocupado. Se conecta una vez y queda: pídelo y lo dejamos listo.</div>';
    return '<div class="panel"><b>Calendario</b>' +
      '<div class="small">Suscríbete desde Google Calendar, Outlook o Apple Calendar para ver las citas. El enlace es secreto: quien lo tenga ve nombres y teléfonos.</div>' +
      // Secreto de larga vida: enmascarado por defecto; "Copiar" es la acción principal y rara vez hay que verlo.
      '<div class="feed-row"><input id="feed-url" type="password" readonly value="' + esc(f.https) + '" aria-label="Enlace secreto de suscripción"><button class="btn primary" id="feed-copy">Copiar enlace</button><button class="btn sm" id="feed-show" aria-pressed="false">Mostrar</button><a class="btn sm" href="' + esc(f.webcal) + '">Apple Calendar</a>' +
        // Google suscribe por URL, no por archivo: este enlace abre su pantalla de «añadir por dirección» con
        // el enlace ya puesto. Hay que darle a Añadir allá, que es como Google quiere que se haga.
        '<a class="btn sm" href="https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(f.https) + '" target="_blank" rel="noopener">Google Calendar</a></div>' +
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
        { view: 'pipeline', go: 'Ir a Clientes › Por etapa', title: 'Sigue a tus prospectos', text: 'En Clientes, la pestaña «Por etapa» tiene una tarjeta por cliente en su etapa. Arrástrala o usa «Mover…», que también funciona en el celular. Tocar el nombre abre la conversación.' },
        { view: 'channels', go: 'Ir a Canales', title: 'Revisa por dónde llegan tus clientes', text: 'En Canales ves si WhatsApp y el chat del sitio están conectados y qué falta. WhatsApp oficial se configura ahí mismo, en Credenciales.' },
      ],
      faq: [
        ['¿Cómo le devuelvo la conversación a ' + ag + '?', 'En la conversación, pon el switch en «' + ag + '». Desde ese momento vuelve a responder solo.'],
        ['¿Qué hago con «Recordar a mano»?', 'Son citas de mañana cuyo recordatorio no pudo salir solo (por ejemplo, el cliente llegó por el chat del sitio). «Abrir WhatsApp» abre el chat con el mensaje ya escrito; después dale «Ya se lo recordé».'],
        ['¿Para qué sirve «¿Cómo les fue?» en Hoy?', 'Cuando una cita ya pasó, marca si el cliente vino, no vino o compró. Así el tablero sabe cómo terminó cada prospecto y, con el tiempo, el puntaje se ajusta a lo que de verdad pasa en el negocio.'],
        ['¿Qué significan «Confirmó» y «No puede» en una cita?', 'Es lo que respondió el cliente al recordatorio. Si no puede, ' + ag + ' ya le ofreció moverla o cancelarla, y te avisa.'],
        ['¿Por qué no puedo escribirle a un cliente de WhatsApp oficial?', 'WhatsApp solo deja escribir hasta 24 horas después del último mensaje del cliente. Pasado ese tiempo, toca esperar a que vuelva a escribir o usar una plantilla aprobada por Meta. El tablero lo avisa antes de que escribas.'],
        // El tercer dato dice cuándo NO va: 'candado' si habla de algo que con el candado no se ve, 'facil' si es del
        // puntaje, que el modo fácil esconde. Una respuesta que manda a una pantalla que no está confunde más que no tenerla.
        ['¿Qué pasa si dejo algo del Perfil vacío?', 'Queda «Por confirmar». Si un cliente pregunta por eso, ' + ag + ' no lo supone: responde «' + verify + '» y la pregunta te llega a Hoy.', 'candado'],
        ['¿Cómo le enseño a ' + ag + ' una frase que no entendió?', 'En Agente › Frases que no entendimos, dale «Enseñar» y escribe qué quiere decir (por ejemplo, «a la hora del cafecito» quiere decir «a las 3»). Solo se guarda si con eso ya la entiende.', 'candado'],
        ['¿«Caliente» y «Prospecto claro» son lo mismo?', 'Sí: es el mismo puntaje. En tarjetas y avisos se dice con temperatura (frío, tibio, caliente); en la ficha, con el veredicto. Los colores coinciden.', 'facil'],
        ['En el celular, ¿dónde están Perfil, Canales o Salir?', 'En «Más», el último botón de la barra de abajo: ahí están Análisis, Perfil, Agente, Canales, Lo que sabe, Ayuda, el tema, el sonido y Salir.', 'candado'],
        ['¿Qué es «Lo que sabe»?', 'La información que ' + ag + ' tiene de ' + biz + ': el catálogo y los textos del negocio. Sirve para buscar qué sabe de un tema.', 'candado'],
      ],
      never: ['Inventar precios, fechas, políticas o productos: lo que no sabe, lo verifica con el equipo.', 'Elegir una fecha por su cuenta: las citas salen siempre de la agenda real.', 'Cancelar o mover una cita sin que el cliente lo confirme.', 'Escribir por WhatsApp oficial fuera de las 24 horas sin plantilla.', 'Seguir respondiendo cuando una persona del equipo tomó la conversación.'],
    };
  }
  function loadHelp() {
    helpSet('aiva.help.seen', true);
    api('/agent').then(function (a) {
      var h = helpContent(a), done = helpGet('aiva.help.done') || {};
      // Con el candado no van los pasos que llevan a lo de quien administra. Cada paso guarda su número de siempre,
      // que es con el que se recuerda si ya se hizo.
      var pasos = h.steps.map(function (s, i) { return { s: s, i: i }; }).filter(function (x) { return !(enCandado() && VISTAS_DE_QUIEN_ADMINISTRA[x.s.view]); });
      var faq = h.faq.filter(function (q) { return !(q[2] === 'candado' && enCandado()) && !(q[2] === 'facil' && esFacil()); });
      var count = pasos.filter(function (x) { return done[x.i]; }).length;
      $('help').innerHTML =
        '<div class="panel"><b>Tutorial rápido</b><div class="small muted" id="help-progress">' + count + ' de ' + pasos.length + ' hechos</div>' +
        pasos.map(function (x) {
          var s = x.s, i = x.i;
          return '<div class="help-step' + (done[i] ? ' done' : '') + '" data-step="' + i + '"><span class="n" aria-hidden="true">' + (done[i] ? '✓' : i + 1) + '</span><h3>' + esc(s.title) + '</h3><p>' + esc(s.text) + '</p>' +
            '<div class="feed-row"><button class="btn" data-go="' + s.view + '">' + esc(s.go) + '</button><button class="btn" data-done="' + i + '" aria-pressed="' + Boolean(done[i]) + '">' + (done[i] ? 'Hecho ✓' : 'Ya lo hice') + '</button></div></div>';
        }).join('') + '</div>' +
        '<div class="panel help-faq"><b>Preguntas frecuentes</b>' + faq.map(function (q) { return '<details><summary>' + esc(q[0]) + '</summary><p>' + esc(q[1]) + '</p></details>'; }).join('') + '</div>' +
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

  // ---------- la guía de inicio ----------
  // Lo que falta para que el asistente atienda solo. 🪤 Cada paso lo marca el SERVIDOR mirando lo que de verdad hay
  // (crm/guia.ts), no un «ya lo hice» guardado aquí como el tutorial: un paso marcado y un paso hecho son lo mismo.
  // Solo el del nombre se arma aquí, porque el nombre es de quien mira, no del negocio.
  //
  // 🪤 Se vuelve a pedir al entrar y al volver a la pestaña, no con un temporizador: lo normal es salir a otra
  // pantalla o a otra pestaña (Meta, el catálogo en Excel) a arreglar el paso y volver a mirar si quedó.
  var ACCION_GUIA = { profile: 'Abrir el perfil', knowledge: 'Ir a Lo que sabe', channels: 'Ir a Canales', negocio: 'Abrir El negocio', agent: 'Ir a El asistente', nombre: 'Poner mi nombre' };
  function pasosDeLaGuia(d) {
    var pasos = (d && d.pasos ? d.pasos : []).slice();
    var nombre = { id: 'nombre', titulo: 'Pon con qué nombre respondes', hecho: Boolean(state.name), opcional: false, ir: 'nombre',
      falta: state.name ? '' : 'En WhatsApp tu nombre va antes de cada mensaje que escribes: sin él, el cliente no sabe quién le habla.' };
    // Antes de los opcionales: es obligatorio y se hace en un minuto.
    var i = pasos.findIndex(function (p) { return p.opcional; });
    pasos.splice(i < 0 ? pasos.length : i, 0, nombre);
    return pasos;
  }
  function cuentaGuia(pasos) {
    var obligatorios = pasos.filter(function (p) { return !p.opcional; });
    var hechos = obligatorios.filter(function (p) { return p.hecho; }).length;
    return { total: obligatorios.length, hechos: hechos, siguiente: obligatorios.filter(function (p) { return !p.hecho; })[0] || null };
  }
  function irAlPaso(ir) { if (ir === 'nombre') $('foot-user').click(); else go(ir); }
  function cargarGuia() {
    if (!$('guia')) return Promise.resolve();
    if (!state.guia) $('guia').innerHTML = '<div class="small muted">Revisando qué falta…</div>';
    var fallo = function (msg) {
      $('guia').innerHTML = '<div class="empty">No se pudo revisar la guía' + (msg ? ': ' + esc(msg) : '') + '. <button class="linkbtn" id="guia-otra">Intentar otra vez</button></div>';
      $('guia-otra').onclick = cargarGuia;
    };
    return api('/guia').catch(function () { return { error: 'no hubo respuesta del servidor' }; }).then(function (d) {
      if (!d || d.error) { fallo(d && d.error); return; }
      state.guia = d;
      pintarGuia();
    });
  }
  function pintarGuia() {
    var d = state.guia; if (!d || !$('guia')) return;
    var ag = esc(d.agente || state.agentName || 'el asistente');
    var pasos = pasosDeLaGuia(d), n = cuentaGuia(pasos);
    $('guia-sub').textContent = 'Lo que falta para que ' + (d.agente || state.agentName || 'el asistente') + ' atienda solo';
    $('guia').innerHTML =
      '<div class="guia-cab"><b>Deja listo a ' + ag + ' en ' + n.total + ' pasos</b>' +
        '<div class="guia-barra" role="progressbar" aria-label="Pasos listos" aria-valuemin="0" aria-valuemax="' + n.total + '" aria-valuenow="' + n.hechos + '"><i style="width:' + Math.round(100 * n.hechos / Math.max(1, n.total)) + '%"></i></div>' +
        '<span class="small muted">' + n.hechos + ' de ' + n.total + ' listos</span></div>' +
      (n.siguiente ? '' : '<div class="panel guia-fin"><b>Todo listo: ' + ag + ' ya atiende solo.</b> <span class="small">Lo opcional de abajo lo mejora, pero no hace falta para empezar.</span></div>') +
      '<ol class="guia-pasos">' + pasos.map(function (p) {
        var esSiguiente = n.siguiente && n.siguiente.id === p.id;
        var accion = ACCION_GUIA[p.ir] || 'Ir';
        return '<li class="guia-paso ' + (p.hecho ? 'hecho' : esSiguiente ? 'siguiente' : 'pendiente') + '" data-paso="' + esc(p.id) + '">' +
          '<span class="guia-marca" aria-hidden="true">' + (p.hecho ? '✓' : '') + '</span>' +
          // 🪤 El ámbar es para lo que urge: lo opcional que falta va en gris. Y lo hecho no repite «listo»: ya lo
          // dicen el ✓ y su botón.
          '<div class="grow"><b>' + esc(p.titulo) + '</b>' + (p.opcional ? ' <span class="chip">Opcional</span>' : '') +
            (p.hecho ? '' : '<div class="small ' + (p.opcional ? 'muted' : 'guia-falta') + '">' + esc(p.falta) + '</div>') + '</div>' +
          (p.hecho
            ? '<button class="btn sm" data-guia-ir="' + esc(p.ir) + '">Listo · revisar</button>'
            : '<button class="btn' + (esSiguiente ? ' primary' : '') + '" data-guia-ir="' + esc(p.ir) + '">' + esc(accion) + '</button>') +
          '</li>';
      }).join('') + '</ol>';
    $('guia').querySelectorAll('[data-guia-ir]').forEach(function (b) { b.onclick = function () { irAlPaso(b.getAttribute('data-guia-ir')); }; });
  }

  // En Hoy, para quien administra y mientras falte algo obligatorio, la guía en una línea en vez del tutorial. El
  // asesor sigue viendo el tutorial: los pasos de la guía son de quien administra.
  function guiaOculta() {
    try { return Number(localStorage.getItem(LLAVE('guia-oculta')) || 0) > Date.now(); } catch (e) { return false; }
  }
  function bannerDeHoy() {
    // Con el candado tampoco: cada paso de la guía lleva a la configuración, que es de quien administra aiva.
    if (!esAdmin() || enCandado()) return helpBanner();
    // Un sitio reservado: se llena cuando llega la guía. Con lo último que se supo, para que Hoy no salte.
    return '<div id="guia-hoy" class="guia-hoy-sitio">' + tarjetaGuiaHoy() + '</div>';
  }
  function tarjetaGuiaHoy() {
    // Si la guía no llegó, el tutorial de siempre: mejor eso que un hueco.
    if (!state.guia) return state.guiaFallo ? helpBanner() : '';
    var pasos = pasosDeLaGuia(state.guia), n = cuentaGuia(pasos);
    if (!n.siguiente || guiaOculta()) return helpBanner();
    var ag = esc(state.guia.agente || state.agentName || 'el asistente');
    return '<div class="panel help-first guia-hoy"><span class="grow"><b>Deja listo a ' + ag + ': ' + n.hechos + ' de ' + n.total + '</b> ' +
      '<span class="small">Siguiente: ' + esc(n.siguiente.titulo) + '. <span class="guia-falta">' + esc(n.siguiente.falta) + '</span></span></span>' +
      '<button class="btn primary" data-guia-ir="' + esc(n.siguiente.ir) + '">' + esc(ACCION_GUIA[n.siguiente.ir] || 'Ir') + '</button>' +
      '<button class="btn" data-go="guia">Ver la guía</button><button class="btn" id="guia-ocultar">Ocultar por ahora</button></div>';
  }
  function pintarGuiaEnHoy() {
    if (!esAdmin() || !$('guia-hoy')) return;
    var pintar = function () {
      var sitio = $('guia-hoy'); if (!sitio) return;
      sitio.innerHTML = tarjetaGuiaHoy();
      sitio.querySelectorAll('[data-guia-ir]').forEach(function (b) { b.onclick = function () { irAlPaso(b.getAttribute('data-guia-ir')); }; });
      sitio.querySelectorAll('[data-go]').forEach(function (b) { b.onclick = function () { go(b.getAttribute('data-go')); }; });
      if ($('help-hide')) $('help-hide').onclick = function () { helpSet('aiva.help.seen', true); loadToday(); };
      // «Por ahora» es una semana, como «Dejarlo por ahora» en los seguimientos: después vuelve, si sigue faltando.
      if ($('guia-ocultar')) $('guia-ocultar').onclick = function () { try { localStorage.setItem(LLAVE('guia-oculta'), String(Date.now() + 7 * 86400000)); } catch (e) {} pintar(); };
    };
    pintar();
    api('/guia').then(function (d) {
      if (d && !d.error) state.guia = d; else state.guiaFallo = true;
      pintar();
    }).catch(function () { state.guiaFallo = true; pintar(); });
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden && state.view === 'guia') cargarGuia(); });
  // Al cerrar el perfil, El negocio o «con qué nombre respondes» se vuelve a mirar: es donde se arreglan los pasos.
  ['dlg-config', 'dlg-yo'].forEach(function (id) {
    var dlg = $(id); if (!dlg) return;
    dlg.addEventListener('close', function () { if (state.view === 'guia') cargarGuia(); });
  });

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
  // Qué pasa con las conversaciones viejas (src/crm/retencion.ts). Aquí solo se lee: la pone quien administra aiva.
  function retencionLinea(r) {
    if (!r || r.error) return '';
    var p = r.politica, u = r.ultima;
    if (!p) return '<div class="small muted">Las conversaciones se guardan sin límite de tiempo. Si prefieres que las viejas se anonimicen solas, pídelo.</div>';
    var que = p.accion === 'borrar' ? 'se borran del todo' : 'se anonimizan: se quitan el nombre, el teléfono y los mensajes, y quedan las cuentas del embudo';
    var cuando = u && !u.error && u.cuantos ? ' La última vez, el ' + new Date(u.ts).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }) + ', fueron ' + u.cuantos + '.' : '';
    return '<div class="small">Las conversaciones sin movimiento en ' + p.dias + ' días ' + que + '. Nunca las de alguien con una cita por delante.' + cuando + '</div>';
  }
  function backupPanel(bk, ret) {
    return '<div class="panel" id="backup-panel"><b>Respaldo de la base</b><div class="small" id="backup-line">' + esc(backupLine(bk)) + '</div>' +
      '<div class="small muted">Una copia al día de contactos, conversaciones y citas; se guardan las últimas 14. Tienen datos de clientes: guárdalas también fuera de este computador (por ejemplo, con Time Machine).</div>' + retencionLinea(ret) +
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

  // Cuando la llevas tú: si aiva deja lista la respuesta a lo que sabe (crm/propuestas.ts). Nunca escribe sola ahí.
  function sugierePanel(a) {
    var on = a.sugiereConPersona !== false, ag = esc(a.agent.name || 'Aiva');
    return '<div class="panel" id="sugiere-panel"><b>Cuando la llevas tú</b>' +
      '<div class="fila" style="gap:10px;align-items:center;margin-top:8px">' +
        '<button class="btn sm" id="sugiere-btn" aria-pressed="' + on + '">' + (on ? 'Dejar de sugerir' : 'Sugerir respuestas') + '</button>' +
        '<span class="small muted">' + (on
          ? 'Cuando la llevas tú, ' + ag + ' deja lista la respuesta a lo que sabe; tú decides si la mandas.'
          : 'Cuando la llevas tú, ' + ag + ' se queda callada del todo.') + '</span>' +
      '</div></div>';
  }
  function bindSugiere(a) {
    var b = $('sugiere-btn');
    if (!b) return;
    b.onclick = function () {
      b.disabled = true;
      api('/agent/sugiere', { method: 'PUT', body: { on: a.sugiereConPersona === false } }).then(function (r) {
        if (!r || r.error) { b.disabled = false; toast('No se pudo: ' + ((r && r.error) || 'sin respuesta')); return; }
        a.sugiereConPersona = r.sugiereConPersona;
        $('sugiere-panel').outerHTML = sugierePanel(a);
        bindSugiere(a);
      }).catch(function () { b.disabled = false; toast('No se pudo: revisa la conexión'); });
    };
  }
  function loadAgent() {
    Promise.all([api('/agent'), api('/usage?days=7'), api('/calendar'), api('/backup'), api('/presupuesto').catch(function () { return null; }), api('/retencion').catch(function () { return null; })]).then(function (r) {
      var a = r[0], usage = r[1], calCfg = r[2], bk = r[3], tope = r[4], ret = r[5];
      var eng = Object.keys(a.engines).map(function (k) { var e = a.engines[k]; return '<li><b>' + (k === 'anthropic' ? 'claude (respaldo)' : k) + '</b>: ' + (e.available ? '✓ disponible' : '✗ ' + esc(e.reason || 'no disponible')) + '</li>'; }).join('');
      var ap = a.appointments;
      $('agent').innerHTML =
        '<div class="panel"><b>' + esc(a.agent.name) + '</b> · asistente de <b>' + esc(a.business.name) + '</b><div class="muted">' + esc(a.business.description) + '</div><div class="small">Estilo: ' + esc(a.agent.style) + '</div><div class="small">Contacto humano que ofrece: ' + esc(a.business.humanContact) + '</div></div>' +
        sugierePanel(a) +
        '<div class="panel"><b>Motores</b><ul>' + eng + '</ul><div class="small muted">Modo: ' + esc(a.roles.mode) + ' · liviano: ' + esc(a.roles.light) + ' · pesado: ' + esc(a.roles.heavy) + ' · gate: ' + esc(a.roles.gate) + ' · análisis: ' + esc(a.roles.analysis) + '</div><div class="small muted">Modelos: ' + esc(a.models.chat) + ' · embeddings ' + esc(a.models.embed) + ' · nube ' + esc(a.models.openai) + '</div></div>' +
        '<div class="panel"><b>Citas</b>' + (ap.enabled ? '<div class="small">' + esc(ap.service) + (ap.location ? ' en ' + esc(ap.location) : '') + ' · ' + ap.durationMin + ' min · días ' + ap.days.join(',') + ' · ' + ap.hours.map(function (h) { return h[0] + '–' + h[1]; }).join(', ') + ' · zona ' + esc(a.timezone) + '</div>' : '<div class="muted small">Desactivadas (appointments.enabled en aiva.config.json)</div>') + '</div>' +
        '<div class="panel"><b>Análisis comercial</b><div class="small">Campos capturados además de los básicos: ' + a.crmFields.map(function (f) { return '<code>' + esc(f.name) + '</code>'; }).join(' ') + '</div></div>' +
        '<div class="panel"><b>Conocimiento indexado</b><div class="small">' + (a.docs.product || 0) + ' productos · ' + (a.docs.knowledge || 0) + ' fragmentos de información.</div></div>' +
        backupPanel(bk, ret) + usagePanel(usage, tope) + calendarPanel(calCfg) + '<div class="panel" id="miss-panel"></div><div class="panel" id="dict-panel"></div>';
      bindBackup();
      bindSugiere(a);
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
      // Los tres modos, por orden de confianza. El del medio es el que faltaba: sin él la decisión es «que no
      // diga nada» o «que le hable a mis clientes», y entre esas dos hay un abismo que nadie cruza tranquilo.
      var MODOS = [
        { id: 'mira', lbl: 'Mira', dice: 'Entra todo al tablero y contestas tú. ' + esc(state.agentName || 'Aiva') + ' no dice nada: mira cómo atiendes y aprende.' },
        { id: 'propone', lbl: 'Propone', dice: 'Deja la respuesta escrita y la mandas tú con un toque, o la corriges. No manda nada sola.' },
        { id: 'contesta', lbl: 'Contesta', dice: 'Responde sola a quien escriba.' }
      ];
      var modo = ch.modo || (ch.soloEscucha ? 'mira' : 'contesta');
      var escucha = ch.modo === undefined && ch.soloEscucha === undefined ? '' :
        '<div class="fila" style="gap:10px;align-items:center;margin-top:10px;flex-wrap:wrap">' +
          '<div class="tabs" role="group" aria-label="Qué hace ' + esc(state.agentName || 'Aiva') + ' en ' + esc(ch.name) + '">' +
            MODOS.map(function (m) {
              return '<button data-modo="' + ch.id + '" data-set="' + m.id + '" aria-pressed="' + (modo === m.id) + '"'
                + (modo === m.id ? ' class="on"' : '') + '>' + m.lbl + '</button>';
            }).join('') +
          '</div>' +
          '<span class="small muted" style="flex:1;min-width:220px">' + (MODOS.find(function (m) { return m.id === modo; }) || MODOS[0]).dice + '</span>' +
        '</div>';
      // Los grupos, aparte: encender el canal es una decisión del negocio; mirar los grupos es una decisión
      // sobre datos de gente que no eligió estar aquí. No van en el mismo botón.
      var losGrupos = ch.grupos === undefined ? '' :
        '<div class="fila" style="gap:10px;align-items:center;margin-top:8px">' +
          '<button class="btn sm" data-grupos="' + ch.id + '" data-set="' + (ch.grupos ? '0' : '1') + '">' +
            (ch.grupos ? 'Dejar de ver los grupos' : 'Ver también los grupos') + '</button>' +
          '<span class="small muted">' + (ch.grupos
            ? (state.agentName || 'Aiva') + ' aprende de lo que se habla en los grupos. Nunca escribe en ellos.'
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
    $('channels').querySelectorAll('[data-modo]').forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-modo'), modo = b.getAttribute('data-set');
        $('channels').querySelectorAll('[data-modo="' + id + '"]').forEach(function (x) { x.disabled = true; });
        api('/channels/' + id + '/modo', { method: 'POST', body: { modo: modo } }).then(function (r) {
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
  function pestanaSabe(cual) {
    state.kind = cual;
    ['kn', 'pr', 'ra', 'in'].forEach(function (x) {
      var mapa = { kn: 'knowledge', pr: 'product', ra: 'rapidas', in: 'interno' };
      $('k-' + x).classList.toggle('on', mapa[x] === cual);
    });
    var interno = cual === 'interno';
    var rapidas = cual === 'rapidas';
    $('k-interno').hidden = !interno;
    $('k-rapidas').hidden = !rapidas;
    // La lista de fragmentos indexados no pinta nada en estas dos: una es lo que no se le cuenta a nadie y la
    // otra son respuestas escritas a mano, no trozos de documento.
    $('k-list').hidden = interno || rapidas;
    $('k-q').hidden = interno || rapidas;
    // Cada pestaña enseña cómo se le mete contenido a ESA pestaña. Un único cajón de subida para las tres
    // obligaría a elegir primero el tipo, y elegir mal significa que un catálogo acabe troceado como texto.
    $('k-cargar').hidden = cual !== 'knowledge';
    $('k-catalogo').hidden = cual !== 'product';
    if (interno) cargarNotas(); else if (rapidas) cargarRapidas(); else loadKnowledge();
    if (cual === 'knowledge') cargarDocumentos();
  }
  $('k-kn').onclick = function () { pestanaSabe('knowledge'); };
  $('k-pr').onclick = function () { pestanaSabe('product'); };
  $('k-ra').onclick = function () { pestanaSabe('rapidas'); };
  $('k-in').onclick = function () { pestanaSabe('interno'); };

  // ---------- lo que no se le cuenta a nadie ----------
  var notaEditando = null;
  function cargarNotas() {
    if ($('k-agente')) $('k-agente').textContent = state.agentName || 'el asistente';
    api('/interno').then(function (notas) {
      $('k-notas').innerHTML = (notas || []).length
        ? notas.map(function (n) {
            return '<div class="panel" style="padding:10px 12px;margin-bottom:8px">'
              + '<div class="fila" style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap"><b>' + esc(n.titulo) + '</b>'
              + '<span class="small muted">' + esc(n.origen) + ' · ' + rel(n.actualizado) + '</span><span class="grow"></span>'
              + '<button class="btn sm" data-nota-edit="' + esc(n.id) + '">Corregir</button>'
              + '<button class="btn sm" data-nota-del="' + esc(n.id) + '">Borrar</button></div>'
              + '<div class="small" style="margin-top:6px;white-space:pre-wrap">' + esc(n.contenido) + '</div></div>';
          }).join('')
        : '<div class="empty">Todavía no hay nada. Escribe abajo lo primero que se te ocurra que ' + esc(state.agentName || 'el asistente') + ' debería saber de tu negocio y no decirle a nadie.</div>';
      $('k-notas').querySelectorAll('[data-nota-edit]').forEach(function (b) {
        b.onclick = function () {
          var n = notas.find(function (x) { return x.id === b.getAttribute('data-nota-edit'); });
          if (!n) return;
          notaEditando = n.id;
          $('k-nota-titulo').value = n.titulo; $('k-nota-texto').value = n.contenido;
          $('k-nota-edit').textContent = 'Corrigiendo «' + n.titulo + '»';
          $('k-nota-limpiar').hidden = false;
          $('k-nota-texto').focus();
        };
      });
      $('k-notas').querySelectorAll('[data-nota-del]').forEach(function (b) {
        b.onclick = function () {
          b.disabled = true;
          api('/interno/' + encodeURIComponent(b.getAttribute('data-nota-del')), { method: 'DELETE' })
            .then(function () { toast('Borrada'); cargarNotas(); });
        };
      });
    });
  }
  function limpiarNota() {
    notaEditando = null;
    $('k-nota-titulo').value = ''; $('k-nota-texto').value = '';
    $('k-nota-edit').textContent = ''; $('k-nota-limpiar').hidden = true;
  }
  // 🪤 El borrador se enseña y NO se guarda. Guardarlo solo sería poner en boca del negocio cosas que dedujo
  // una máquina de sus conversaciones; y si algo estuviera mal, aiva aconsejaría con seguridad sobre una
  // premisa falsa sin que nadie sepa de dónde salió. Cada nota se acepta —o se corrige— una por una.
  $('k-retrato').onclick = function () {
    $('k-retrato').disabled = true;
    $('k-retrato-nota').textContent = 'Leyendo lo que ya tiene…';
    api('/interno/retrato', { method: 'POST', body: {} }).then(function (r) {
      $('k-retrato').disabled = false;
      $('k-retrato-nota').textContent = 'Lee lo que ya tiene —conversaciones, temas, tiempos— y redacta un borrador para que lo corrijas.';
      if (!r || r.error) { toast('No se pudo: ' + ((r && r.error) || 'sin respuesta')); return; }
      if (r.flaco) {
        $('k-propuesta').innerHTML = '<div class="empty">Todavía hay poco de dónde deducir ('
          + r.desde.conversaciones + ' conversaciones, ' + r.desde.contactos + ' contactos). Con tan poco, lo que salga encaja en cualquier negocio y no dice nada del tuyo. Vuelve a intentarlo cuando haya más.</div>';
        return;
      }
      if (!r.notas.length) { $('k-propuesta').innerHTML = '<div class="empty">No alcanzó a sacar nada en limpio. Inténtalo otra vez.</div>'; return; }
      $('k-propuesta').innerHTML = '<div class="panel" style="padding:12px;margin-bottom:12px">'
        + '<div class="fila" style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap"><b>Esto es lo que entendí</b>'
        + '<span class="small muted">deducido de ' + [
            r.desde.conversaciones ? r.desde.conversaciones + ' conversaciones' : '',
            r.desde.temas ? r.desde.temas + ' temas que se repiten' : '',
            r.desde.contactos ? r.desde.contactos + ' contactos' : ''
          ].filter(Boolean).join(', ') + ' · corrígeme lo que esté mal</span></div>'
        + r.notas.map(function (n, i) {
            return '<div class="panel" style="padding:10px 12px;margin-top:8px">'
              + '<div class="fila" style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap"><b>' + esc(n.titulo) + '</b><span class="grow"></span>'
              + '<button class="btn sm" data-prop-edit="' + i + '">Corregir</button>'
              + '<button class="btn sm primary" data-prop-ok="' + i + '">Está bien</button></div>'
              + '<div class="small" style="margin-top:6px;white-space:pre-wrap">' + esc(n.contenido) + '</div></div>';
          }).join('')
        + '<div class="small muted" style="margin-top:10px">Nada de esto se ha guardado todavía.</div></div>';
      $('k-propuesta').querySelectorAll('[data-prop-ok]').forEach(function (b) {
        b.onclick = function () {
          var n = r.notas[Number(b.getAttribute('data-prop-ok'))];
          b.disabled = true;
          api('/interno', { method: 'POST', body: { titulo: n.titulo, contenido: n.contenido, origen: 'deducido y confirmado' } })
            .then(function () { b.closest('.panel').remove(); cargarNotas(); toast('Guardado', null, { icono: 'check' }); });
        };
      });
      $('k-propuesta').querySelectorAll('[data-prop-edit]').forEach(function (b) {
        b.onclick = function () {
          var n = r.notas[Number(b.getAttribute('data-prop-edit'))];
          $('k-nota-titulo').value = n.titulo; $('k-nota-texto').value = n.contenido;
          $('k-nota-edit').textContent = 'Corrigiendo lo que propuso ' + (state.agentName || 'el asistente');
          $('k-nota-limpiar').hidden = false;
          $('k-nota-texto').focus();
          b.closest('.panel').remove();
        };
      });
    });
  };
  $('k-nota-limpiar').onclick = limpiarNota;
  $('k-nota-guardar').onclick = function () {
    var texto = $('k-nota-texto').value.trim();
    if (!texto) return;
    $('k-nota-guardar').disabled = true;
    api('/interno', { method: 'POST', body: { id: notaEditando || undefined, titulo: $('k-nota-titulo').value, contenido: texto } })
      .then(function (r) {
        $('k-nota-guardar').disabled = false;
        if (r && r.error) { toast('No se pudo: ' + r.error); return; }
        limpiarNota(); cargarNotas();
        toast('Guardado. Esto no sale en ninguna conversación.', null, { icono: 'book' });
      });
  };
  var kTimer; $('k-q').oninput = function () { clearTimeout(kTimer); kTimer = setTimeout(loadKnowledge, 250); };

  // ---------- los documentos del negocio ----------
  //
  // Lo que el asistente puede contarle a un cliente. Cada documento es un archivo de verdad en la carpeta del
  // negocio: ver src/rag/documentos.ts para por qué no basta con meterlo en la base.
  function cargarDocumentos() {
    return api('/documentos').then(function (d) {
      var docs = d.documentos || [];
      $('k-docs').innerHTML = docs.length
        ? '<div class="small muted" style="margin:14px 0 6px">' + docs.length + (docs.length === 1 ? ' documento cargado' : ' documentos cargados') + '</div>' +
          docs.map(function (x) {
            return '<div class="doc-fila">' +
              '<div><b>' + esc(x.titulo) + '</b>' +
                '<div class="small muted">' + esc(x.archivo) + ' · ' + Math.max(1, Math.round(x.bytes / 1024)) + ' KB · ' +
                // 🪤 Un archivo con 0 fragmentos está cargado pero NO indexado, así que el asistente no lo ve.
                // Decir solo «cargado» ahí haría creer que ya está contestando con él.
                (x.fragmentos ? x.fragmentos + (x.fragmentos === 1 ? ' fragmento' : ' fragmentos') : '<span class="aviso-cero">sin indexar todavía</span>') +
                '</div></div>' +
              '<button class="btn sm borrar-doc" data-a="' + esc(x.archivo) + '">Quitar</button>' +
            '</div>';
          }).join('')
        : '<div class="empty" style="margin-top:14px">Todavía no le has cargado nada. Sin esto, el asistente solo sabe lo que diga el perfil del negocio.</div>';
      Array.prototype.forEach.call($('k-docs').querySelectorAll('.borrar-doc'), function (b) {
        b.onclick = function () {
          // Quitar un documento es rehacer el índice, así que se dice qué se va antes de irse.
          if (!confirm('¿Quitar "' + b.dataset.a + '"? El asistente dejará de saber lo que dice.')) return;
          b.disabled = true;
          api('/documentos/' + encodeURIComponent(b.dataset.a), { method: 'DELETE' }).then(function (r) {
            if (r.error) { $('k-cargar-msg').textContent = r.error; b.disabled = false; return; }
            $('k-cargar-msg').textContent = 'Quitado.';
            cargarDocumentos(); loadKnowledge();
          });
        };
      });
    });
  }

  function subirDocumentos(archivos) {
    if (!archivos || !archivos.length) return;
    var datos = new FormData();
    for (var i = 0; i < archivos.length && i < 10; i++) datos.append('archivo', archivos[i], archivos[i].name);
    // Indexar lleva unos segundos —hay que calcular los vectores— y sin decirlo parece que no pasó nada y la
    // gente vuelve a darle al botón.
    $('k-cargar-msg').textContent = 'Leyendo e indexando…';
    fetch(BASE + '/admin/api/documentos', { method: 'POST', headers: { 'x-admin-token': state.token }, body: datos })
      .then(function (r) { return r.json(); })
      .then(function (r) {
        if (r.error) { $('k-cargar-msg').textContent = r.error; return; }
        var n = (r.documentos || []).length;
        // Si subieron cinco y entraron tres, se dicen los dos números y por qué faltan los otros. Decir solo
        // «listo» dejaría a alguien creyendo que su PDF entró.
        $('k-cargar-msg').textContent = n + (n === 1 ? ' documento cargado.' : ' documentos cargados.') +
          ((r.fallos || []).length ? ' No pude con: ' + r.fallos.join(' ') : '');
        cargarDocumentos(); loadKnowledge();
      })
      .catch(function () { $('k-cargar-msg').textContent = 'No pude subirlo. Intenta de nuevo.'; });
  }

  $('k-subir').onclick = function () { $('k-archivos').click(); };
  $('k-archivos').onchange = function () { subirDocumentos(this.files); this.value = ''; };
  $('k-doc-guardar').onclick = function () {
    var titulo = $('k-doc-titulo').value.trim(), texto = $('k-doc-texto').value.trim();
    if (!titulo || !texto) { $('k-cargar-msg').textContent = 'Ponle un título y un texto.'; return; }
    $('k-cargar-msg').textContent = 'Guardando e indexando…';
    api('/documentos', { method: 'POST', body: { titulo: titulo, contenido: texto } }).then(function (r) {
      if (r.error) { $('k-cargar-msg').textContent = r.error; return; }
      $('k-doc-titulo').value = ''; $('k-doc-texto').value = '';
      $('k-escribir').open = false;
      $('k-cargar-msg').textContent = 'Guardado.';
      cargarDocumentos(); loadKnowledge();
    });
  };

  // Arrastrar y soltar sobre el recuadro, que es como se sube un archivo cuando ya lo tienes delante.
  (function () {
    var caja = $('k-soltar');
    if (!caja) return;
    ['dragenter', 'dragover'].forEach(function (ev) {
      caja.addEventListener(ev, function (e) { e.preventDefault(); caja.classList.add('encima'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      caja.addEventListener(ev, function (e) { e.preventDefault(); caja.classList.remove('encima'); });
    });
    caja.addEventListener('drop', function (e) { subirDocumentos(e.dataTransfer && e.dataTransfer.files); });
  })();

  $('k-cat-subir').onclick = function () { $('k-cat-archivo').click(); };
  $('k-cat-archivo').onchange = function () {
    var f = this.files && this.files[0];
    this.value = '';
    if (!f) return;
    $('k-cat-msg').textContent = 'Leyendo e indexando…';
    var datos = new FormData();
    datos.append('archivo', f, f.name);
    fetch(BASE + '/admin/api/catalogo', { method: 'POST', headers: { 'x-admin-token': state.token }, body: datos })
      .then(function (r) { return r.json(); })
      .then(function (r) {
        $('k-cat-msg').textContent = r.error ? r.error : r.productos + (r.productos === 1 ? ' producto en el catálogo.' : ' productos en el catálogo.');
        if (!r.error) loadKnowledge();
      })
      .catch(function () { $('k-cat-msg').textContent = 'No pude subirlo.'; });
  };


  // ---------- respuestas rápidas ----------
  //
  // Lo que se pregunta mucho, escrito una vez. Dónde sale lo decide el modo del canal, no un interruptor de
  // aquí: en «Propone» queda esperando a una persona, en «Contesta» sale sola.
  var RAPIDAS = [];
  var PROPUESTOS = [];

  function cargarRapidas() {
    return api('/rapidas').then(function (d) {
      RAPIDAS = d.rapidas || [];
      pintarRapidas();
    });
  }

  function fichaRapida(r) {
    var listo = r.estado === 'lista';
    return '<div class="ra" data-id="' + r.id + '">' +
      '<div class="cab"><b>' + esc(r.tema) + '</b>' +
        '<span class="estado ' + r.estado + '">' + (listo ? 'Lista' : 'Borrador') + '</span>' +
        (r.origen ? '<span class="small muted">' + esc(r.origen) + '</span>' : '') +
        (r.veces ? '<span class="veces">usada ' + r.veces + (r.veces === 1 ? ' vez' : ' veces') + '</span>' : '') +
      '</div>' +
      '<div class="frases">' + r.ejemplos.map(function (e) { return '<span>' + esc(e) + '</span>'; }).join('') + '</div>' +
      '<textarea rows="3" class="ra-texto" placeholder="Lo que se contesta. Escríbelo como se lo dirías a un cliente.">' + esc(r.respuesta || '') + '</textarea>' +
      '<div class="fila" style="gap:8px;justify-content:flex-end;margin-top:8px">' +
        '<span class="small muted grow ra-msg"></span>' +
        '<button class="btn sm ra-borrar">Quitar</button>' +
        // 🪤 Marcar «lista» es lo que hace que empiece a salirle a un cliente, así que el botón dice eso y no
        // «guardar»: son dos acciones distintas y confundirlas es publicar sin querer.
        '<button class="btn sm ra-guardar">Guardar borrador</button>' +
        (listo ? '<button class="btn sm ra-pausar">Dejar de usarla</button>' : '<button class="btn primary sm ra-publicar">Empezar a usarla</button>') +
      '</div>' +
    '</div>';
  }

  function pintarRapidas() {
    var listas = RAPIDAS.filter(function (r) { return r.estado === 'lista'; });
    var borradores = RAPIDAS.filter(function (r) { return r.estado !== 'lista'; });
    $('k-ra-lista').innerHTML =
      (borradores.length ? '<div class="small muted" style="margin:16px 0 6px">' + borradores.length + ' sin contestar todavía — el asistente no las usa hasta que escribas la respuesta</div>' + borradores.map(fichaRapida).join('') : '') +
      (listas.length ? '<div class="small muted" style="margin:16px 0 6px">' + listas.length + ' en uso</div>' + listas.map(fichaRapida).join('') : '') +
      (RAPIDAS.length ? '' : '<div class="empty" style="margin-top:14px">Todavía no hay ninguna. Saca los temas de un historial, o escribe una.</div>');
    enganchaRapidas();
  }

  function enganchaRapidas() {
    Array.prototype.forEach.call($('k-ra-lista').querySelectorAll('.ra'), function (caja) {
      var id = Number(caja.dataset.id);
      var r = RAPIDAS.filter(function (x) { return x.id === id; })[0];
      if (!r) return;
      var msg = caja.querySelector('.ra-msg');
      var guardar = function (estado) {
        var texto = caja.querySelector('.ra-texto').value.trim();
        if (estado === 'lista' && !texto) { msg.textContent = 'Escribe la respuesta antes de usarla.'; return; }
        msg.textContent = 'Guardando…';
        api('/rapidas', { method: 'POST', body: { id: id, tema: r.tema, ejemplos: r.ejemplos, respuesta: texto, estado: estado } })
          .then(function (d) {
            if (d.error) { msg.textContent = d.error; return; }
            cargarRapidas();
          });
      };
      caja.querySelector('.ra-guardar').onclick = function () { guardar('borrador'); };
      var pub = caja.querySelector('.ra-publicar');
      if (pub) pub.onclick = function () { guardar('lista'); };
      var pau = caja.querySelector('.ra-pausar');
      if (pau) pau.onclick = function () { guardar('borrador'); };
      caja.querySelector('.ra-borrar').onclick = function () {
        if (!confirm('¿Quitar "' + r.tema + '"?')) return;
        api('/rapidas/' + id, { method: 'DELETE' }).then(cargarRapidas);
      };
    });
  }

  // Los temas que salen de un historial: se enseñan para aceptarlos uno a uno, no se guardan solos. Un
  // documento que alguien dejó en una carpeta no puede volverse configuración del asistente sin que nadie mire.
  function pintarPropuestos() {
    $('k-ra-propuestas').innerHTML = !PROPUESTOS.length ? '' :
      '<div class="panel" style="padding:14px;margin-top:12px">' +
        '<b>' + PROPUESTOS.length + ' temas encontrados</b>' +
        '<div class="small muted" style="margin-bottom:10px">Ninguno trae respuesta, a propósito: lo que se contestó entonces puede no ser lo que prometes hoy. Acepta los que te sirvan y escríbelas tú.</div>' +
        PROPUESTOS.map(function (t, i) {
          return '<div class="ra" data-i="' + i + '">' +
            '<div class="cab"><b>' + esc(t.tema) + '</b></div>' +
            '<div class="frases">' + t.ejemplos.map(function (e) { return '<span>' + esc(e) + '</span>'; }).join('') + '</div>' +
            (t.pista ? '<div class="pista">Para contestarlo: ' + esc(t.pista) + '</div>' : '') +
            '<div class="fila" style="gap:8px;justify-content:flex-end">' +
              '<button class="btn sm prop-no">No me sirve</button>' +
              '<button class="btn primary sm prop-si">Añadirlo</button>' +
            '</div>' +
          '</div>';
        }).join('') +
      '</div>';
    Array.prototype.forEach.call($('k-ra-propuestas').querySelectorAll('.ra'), function (caja) {
      var i = Number(caja.dataset.i);
      caja.querySelector('.prop-no').onclick = function () { PROPUESTOS.splice(i, 1); pintarPropuestos(); };
      caja.querySelector('.prop-si').onclick = function () {
        var t = PROPUESTOS[i];
        caja.querySelector('.prop-si').disabled = true;
        api('/rapidas', { method: 'POST', body: { tema: t.tema, ejemplos: t.ejemplos, respuesta: '', estado: 'borrador', origen: 'del historial' } })
          .then(function (d) {
            if (d.error) { $('k-ra-msg').textContent = d.error; caja.querySelector('.prop-si').disabled = false; return; }
            PROPUESTOS.splice(i, 1);
            pintarPropuestos();
            cargarRapidas();
          });
      };
    });
  }

  $('k-ra-material').onclick = function () { $('k-ra-archivo').click(); };
  $('k-ra-archivo').onchange = function () {
    var f = this.files && this.files[0];
    this.value = '';
    if (!f) return;
    // Leerlo entero y sacar los temas tarda; decirlo evita que le den tres veces al botón.
    $('k-ra-msg').textContent = 'Leyendo el historial y buscando temas… puede tardar un poco.';
    var datos = new FormData();
    datos.append('archivo', f, f.name);
    fetch(BASE + '/admin/api/rapidas/del-material', { method: 'POST', headers: { 'x-admin-token': state.token }, body: datos })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.error) { $('k-ra-msg').textContent = d.error; return; }
        PROPUESTOS = d.temas || [];
        $('k-ra-msg').textContent = PROPUESTOS.length ? '' : 'No saqué temas claros de ahí.';
        pintarPropuestos();
      })
      .catch(function () { $('k-ra-msg').textContent = 'No pude leerlo.'; });
  };

  // Ensayar: lo que de verdad hace falta antes de enseñar aiva en vivo. Dice si la pregunta sale por el guion o
  // se va al modelo, sin mandarle nada a nadie.
  function ensayar() {
    var texto = $('k-ra-ensayo').value.trim();
    if (!texto) return;
    $('k-ra-resultado').innerHTML = '<div class="small muted" style="margin-top:6px">Probando…</div>';
    api('/rapidas/probar', { method: 'POST', body: { texto: texto } }).then(function (r) {
      if (r.error) { $('k-ra-resultado').innerHTML = '<div class="small muted">' + esc(r.error) + '</div>'; return; }
      $('k-ra-resultado').innerHTML = r.acierta
        ? '<div class="veredicto si"><b>✓ Sale por el guion — «' + esc(r.tema) + '»</b>' +
          'Se parece un ' + r.parecido + '% a «' + esc(r.comoLoPreguntan) + '». Contesta al instante, sin pasar por el modelo.' +
          '<div class="dicho">' + esc(r.respuesta) + '</div></div>'
        // 🪤 Que NO acierte no es un error: es información. Lo que no puede pasar es salir al escenario creyendo
        // que hay guion donde no lo hay, así que se dice qué va a ocurrir en vez de un «no encontrado».
        : '<div class="veredicto no"><b>⚠ Esta se va al modelo</b>' +
          'Contestará, pero tarda unos segundos y puede decir que no tiene el dato. Si es una de las que vas a ' +
          'enseñar, añádela arriba con esta forma exacta de preguntarla.</div>';
    });
  }
  $('k-ra-probar').onclick = ensayar;
  $('k-ra-ensayo').onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); ensayar(); } };

  $('k-ra-crear').onclick = function () {
    var tema = $('k-ra-tema').value.trim();
    var como = $('k-ra-como').value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
    if (!tema || !como.length) { $('k-ra-msg').textContent = 'Ponle un tema y al menos una forma de preguntarlo.'; return; }
    api('/rapidas', { method: 'POST', body: { tema: tema, ejemplos: como, respuesta: '', estado: 'borrador', origen: 'a mano' } })
      .then(function (d) {
        if (d.error) { $('k-ra-msg').textContent = d.error; return; }
        $('k-ra-tema').value = ''; $('k-ra-como').value = '';
        $('k-ra-escribir').open = false;
        $('k-ra-msg').textContent = 'Añadida. Escríbele la respuesta abajo y dale a «Empezar a usarla».';
        cargarRapidas();
      });
  };

  function loadKnowledge() {
    api('/knowledge?kind=' + state.kind + '&q=' + encodeURIComponent($('k-q').value.trim())).then(function (docs) {
      $('k-list').innerHTML = docs.map(function (d) { return '<div class="doc"><h4>' + esc(d.title) + (d.url ? ' · <a href="' + esc(d.url) + '" target="_blank">enlace</a>' : '') + '</h4><p>' + esc(d.content) + '</p></div>'; }).join('') || '<div class="empty">Nada indexado con ese texto.</div>';
    });
  }


  // ---------- Clientes: el directorio de personas ----------
  //
  // Otra cosa que Prospectos. Aquel es un tablero para MOVER fichas de etapa; esto es para ENCONTRAR a alguien y
  // ver quién es de un vistazo — lo que uno hace cuando suena el teléfono, o cuando quiere saber a quién llamar.
  // Por eso es una tabla y no tarjetas: una tabla se recorre con la vista, un tablero se recorre con el ratón.
  var cli = { grupo: 'todos', q: '', lista: [] };

  // 🪤 El grupo sale del ROL de la etapa, no de su nombre. Cada negocio tiene su embudo: una boutique tiene
  // «Vendido» y una financiera «Resuelto», y una lista de nombres fijos dejaría media cartera sin clasificar.
  function grupoDe(c) {
    var r = rol(c.stage);
    if (r === 'ganado') return 'cliente';
    if (r === 'perdido') return 'perdido';
    return 'prospecto';
  }

  function loadClientes() {
    var params = cli.q ? '?q=' + encodeURIComponent(cli.q) + '&limit=500' : '?limit=500';
    return api('/contacts' + params).then(function (list) { cli.lista = list; renderClientes(); });
  }

  // Las pestañas de arriba, cada una con su número. «Míos» solo existe si quien mira tiene nombre.
  var GRUPOS_CLI = [
    { g: 'todos', t: 'Todos', es: function () { return true; } },
    { g: 'mios', t: 'Míos', es: esMia, hay: function () { return Boolean(state.name); } },
    { g: 'calientes', t: '🔥 Calientes', es: esCaliente },
    { g: 'prospecto', t: 'Prospectos', es: function (c) { return grupoDe(c) === 'prospecto'; } },
    { g: 'cliente', t: 'Clientes', es: function (c) { return grupoDe(c) === 'cliente'; } },
    { g: 'perdido', t: 'Perdidos', es: function (c) { return grupoDe(c) === 'perdido'; } },
  ];
  // Por qué columna se ordena. Lo de siempre es el puntaje: arriba está a quien llamar.
  var ORDEN_CLI = {
    nombre: function (a, b) { return nameOf(a).localeCompare(nameOf(b), 'es'); },
    puntaje: function (a, b) { return (b.score || 0) - (a.score || 0) || (b.lastMessageAt || 0) - (a.lastMessageAt || 0); },
    valor: function (a, b) { return (b.valor || 0) - (a.valor || 0) || ORDEN_CLI.puntaje(a, b); },
    // Primero lo que espera a alguien del equipo; después, lo que tiene fecha, de la más cercana a la más lejana.
    paso: function (a, b) {
      var pa = a.proximo || {}, pb = b.proximo || {};
      return (pb.urgente ? 1 : 0) - (pa.urgente ? 1 : 0) || (pa.cuando || Infinity) - (pb.cuando || Infinity) || ORDEN_CLI.puntaje(a, b);
    },
    vez: function (a, b) { return (b.lastMessageAt || 0) - (a.lastMessageAt || 0); },
  };

  function renderClientes() {
    var grupos = GRUPOS_CLI.filter(function (g) { return !g.hay || g.hay(); });
    if (!grupos.some(function (g) { return g.g === cli.grupo; })) cli.grupo = 'todos';
    var g = grupos.find(function (x) { return x.g === cli.grupo; });
    $('cli-filtros').innerHTML = grupos.map(function (x) {
      var n = cli.lista.filter(x.es).length;
      return '<button data-g="' + x.g + '" class="' + (x.g === cli.grupo ? 'on' : '') + '" aria-pressed="' + (x.g === cli.grupo) + '">' + esc(x.t) + '<span class="cuenta">' + n + '</span></button>';
    }).join('');
    Array.prototype.forEach.call($('cli-filtros').querySelectorAll('button'), function (b) {
      b.onclick = function () { cli.grupo = b.dataset.g; renderClientes(); };
    });
    // Modo fácil: los mismos grupos, con su número, en un desplegable.
    if ($('fx-cli-grupo')) $('fx-cli-grupo').innerHTML = grupos.map(function (x) {
      return '<option value="' + x.g + '"' + (x.g === cli.grupo ? ' selected' : '') + '>' + esc(x.t.replace(/^\S+\s(?=\S)/, function (m) { return /\w/.test(m) ? m : ''; })) + ' (' + cli.lista.filter(x.es).length + ')</option>';
    }).join('');

    var orden = cli.orden || 'puntaje', al = cli.al || 1;
    var list = cli.lista.filter(g.es).sort(function (a, b) { return al * ORDEN_CLI[orden](a, b); });
    cli.ids = list.map(function (c) { return c.id; });

    if (!list.length) {
      $('cli-tabla').innerHTML = (cli.q ? '<div class="cli-resumen">Buscando «' + esc(cli.q) + '»</div>' : '') + '<div class="empty">Nadie por aquí con ese filtro.</div>';
      return;
    }
    var suma = 0, sinPrecio = 0;
    list.forEach(function (c) { if (c.valor) suma += c.valor; else sinPrecio++; });
    // La cabecera se ordena con un clic; el que manda lleva su flecha y `aria-sort`, que es lo que lee un lector.
    var th = function (k, t, clase) {
      var on = orden === k;
      return '<th class="' + (clase || '') + '"' + (on ? ' aria-sort="' + (al === 1 ? 'descending' : 'ascending') + '"' : '') + '><button class="orden' + (on ? ' on' : '') + '" data-orden="' + k + '">' + t + (on ? (al === 1 ? ' ↓' : ' ↑') : '') + '</button></th>';
    };
    $('cli-tabla').innerHTML = (cli.q ? '<div class="cli-resumen">Buscando «' + esc(cli.q) + '»</div>' : '') +
      '<table class="cli-tabla"><thead><tr>' +
        th('nombre', 'Quién') + '<th>Etapa</th>' + th('puntaje', 'Puntaje', 'num solo-completo') + th('valor', 'Valor', 'num') + th('paso', 'Próximo paso') + '<th>A cargo</th><th class="solo-completo">La lleva</th>' + th('vez', 'Última vez', 'num') +
      '</tr></thead><tbody>' +
      list.map(function (c) {
        var v = verdict(c);
        return '<tr>' +
          '<td data-rot="Quién"><button class="quien" data-id="' + esc(c.id) + '">' + esc(nameOf(c)) + '</button>' +
            (esCaliente(c) ? ' <span class="fuego" title="Caliente: puntaje de 60 para arriba">🔥</span>' : '') +
            (estaFijado(c.id) ? ' <span class="fijo" title="Fijado">★</span>' : '') +
            // Sin teléfono (llegó por Instagram, por ejemplo), lo que sí se tenga para ubicarlo: su @ o su correo.
            '<div class="dato">' + esc([c.phone || (c.data && c.data.instagram ? '@' + c.data.instagram : '') || (c.data && c.data.correo) || '', channelIcon(c.channel), variasSedes() && c.data && c.data.sede ? nombreSede(c.data.sede) : ''].filter(Boolean).join(' · ')) + '</div></td>' +
          '<td data-rot="Etapa">' + pastillaEtapa(c.stage) + '</td>' +
          // El puntaje nunca solo: va con su veredicto en palabras, que es la regla de siempre.
          '<td data-rot="Puntaje" class="num solo-completo">' + (c.score == null ? '—' : c.score) + '<div class="dato">' + esc(v && v.label ? v.label : '') + '</div></td>' +
          '<td data-rot="Valor" class="num">' + valorHtml(c) + '</td>' +
          '<td data-rot="Próximo paso" class="proximo">' + pasoHtml(c.proximo) +
            (c.summary || c.recap ? '<div class="quiere" title="' + esc(c.summary || c.recap) + '">' + esc(c.summary || c.recap) + '</div>' : '') + '</td>' +
          '<td data-rot="A cargo">' + (c.responsable ? '<span class="lleva persona"><span class="ini" aria-hidden="true">' + esc(inicialesDe(c.responsable)) + '</span><span class="nom">' + esc(c.responsable) + '</span></span>' : '<span class="muted">—</span>') + '</td>' +
          '<td data-rot="La lleva" class="solo-completo">' + llevaHtml(c) + '</td>' +
          '<td data-rot="Última vez" class="num dato">' + esc(rel(c.lastMessageAt)) + '</td>' +
        '</tr>';
      }).join('') + '</tbody>' +
      // Al pie, cuántos y cuánto suman. Lo que no tiene precio se dice al lado: una suma baja por falta de precios
      // y un mes malo son dos problemas muy distintos.
      '<tfoot><tr><td colspan="2">' + list.length + (list.length === 1 ? ' persona' : ' personas') + '</td>' +
        '<td class="solo-completo"></td><td class="num">' + (suma ? '<span class="dato">Suma</span> <b>' + esc(plata(suma)) + '</b>' : '') + '</td>' +
        '<td colspan="2" class="dato">' + (sinPrecio && suma ? sinPrecio + ' sin precio' : '') + '</td><td class="solo-completo"></td><td></td></tr></tfoot></table>';
    enganchaClientes();
  }

  if ($('fx-cli-grupo')) $('fx-cli-grupo').onchange = function () { cli.grupo = $('fx-cli-grupo').value; renderClientes(); };
  // 🪤 Lo que en el fácil va en otro sitio se MUDA, no se copia: el buscador de Contactos (debajo del título) y los
  // controles del calendario (en su tarjeta). Dos copias serían dos estados que se desincronizan —se busca en una y
  // la otra sigue diciendo otra cosa—. Cada pieza deja una marca donde vivía, para volver ahí en el completo.
  //
  // 🪤 La lista va DENTRO de la función: aplicarModo() la llama al arrancar, antes de llegar a esta parte del
  // archivo, y una `var` de aquí todavía valía undefined. El error cortaba el arranque entero.
  function mudarParaElFacil(facil) {
    var marcasDeMudanza = mudarParaElFacil.marcas = mudarParaElFacil.marcas || {};
    [['cli-q', 'fx-cli-herr', true], ['cal-prev', 'fx-cal-izq'], ['cal-next', 'fx-cal-izq'], ['cal-today', 'fx-cal-izq'], ['cal-label', 'fx-cal-izq'], ['cal-sede', 'fx-cal-izq'], ['cal-seg', 'fx-cal-der']].forEach(function (m) {
      var el = $(m[0]), destino = $(m[1]);
      if (!el || !destino) return;
      if (!marcasDeMudanza[m[0]]) { marcasDeMudanza[m[0]] = document.createComment(' aquí vive #' + m[0] + ' en el completo '); el.parentNode.insertBefore(marcasDeMudanza[m[0]], el); }
      var marca = marcasDeMudanza[m[0]];
      if (facil && el.parentNode !== destino) { if (m[2]) destino.insertBefore(el, destino.firstChild); else destino.appendChild(el); }
      if (!facil && el.previousSibling !== marca) marca.parentNode.insertBefore(el, marca.nextSibling);
    });
  }
  function enganchaClientes() {
    Array.prototype.forEach.call($('cli-tabla').querySelectorAll('.quien'), function (b) {
      // 🪤 Abre la FICHA, no el chat. Ir de golpe a la conversación obliga a leerse veinte mensajes para saber
      // quién es; lo que uno quiere al buscar a alguien es verlo de un vistazo, y el chat a un botón.
      // Con la lista en el orden en que se ve, para pasar a la siguiente sin volver aquí.
      b.onclick = function () { abrirPerfil(b.dataset.id, cli.ids); };
    });
    Array.prototype.forEach.call($('cli-tabla').querySelectorAll('[data-orden]'), function (b) {
      b.onclick = function () {
        var k = b.dataset.orden;
        if (cli.orden === k || (!cli.orden && k === 'puntaje')) cli.al = -(cli.al || 1); else { cli.orden = k; cli.al = 1; }
        renderClientes();
      };
    });
  }



  // ---------- la barra: cuántos hay, las listas y los fijados ----------
  var cuentasTimer = null;
  function cargarCuentas() {
    return api('/cuentas' + (state.name ? '?yo=' + encodeURIComponent(state.name) : '')).then(function (n) {
      if (!n || n.error) return;
      state.cuentas = n;
      // En gris y sin fondo: dicen cuántos hay, no que algo urja. Lo que urge va en rojo, en las insignias.
      if ($('cuenta-pip')) $('cuenta-pip').textContent = n.abiertos ? String(n.abiertos) : '';
      if ($('cuenta-cli')) $('cuenta-cli').textContent = n.total ? String(n.total) : '';
      pintarListas();
      // La insignia de Clientes cuenta Seguimientos, que en el modo fácil no está: un «1» que no lleva a nada.
      if (!esFacil()) api('/seguimientos').then(pintarInsigniaSeg);
    });
  }
  // Se recalcula cuando algo cambia, pero no a cada evento: una conversación viva manda varios por minuto.
  function cuentasLuego() { clearTimeout(cuentasTimer); cuentasTimer = setTimeout(cargarCuentas, 4000); }
  function pintarListas() {
    var el = $('rail-listas');
    if (!el) return;
    var n = state.cuentas || {};
    var listas = [{ k: 'calientes', ic: '🔥', t: 'Calientes', n: n.calientes }];
    if (state.name) listas.push({ k: 'mios', ic: inicialesDe(state.name), t: 'Míos', n: n.mios, ini: true });
    var fij = fijados();
    // En el modo fácil no van: Calientes y Míos ya son filtros de Conversaciones y de Clientes. Los fijados sí,
    // que los puso uno mismo.
    el.innerHTML = '<div class="solo-completo"><div class="rl-t">Listas</div>' +
      listas.map(function (l) {
        return '<button class="rl-i" data-lista="' + l.k + '"><span class="rl-ic' + (l.ini ? ' ini' : '') + '" aria-hidden="true">' + esc(l.ic) + '</span>' +
          '<span class="rl-n">' + esc(l.t) + '</span><span class="cuenta">' + (l.n ? l.n : '') + '</span></button>';
      }).join('') + '</div>' +
      (fij.length ? '<div class="rl-t">Fijados</div>' + fij.map(function (f) {
        return '<button class="rl-i" data-fijado="' + esc(f.id) + '" title="' + esc(f.nombre) + '"><span class="rl-ic ini" aria-hidden="true">' + esc(inicialesDe(f.nombre)) + '</span><span class="rl-n">' + esc(f.nombre) + '</span></button>';
      }).join('') : '');
    Array.prototype.forEach.call(el.querySelectorAll('[data-lista]'), function (b) {
      b.onclick = function () { cli.grupo = b.dataset.lista; go('clientes'); };
    });
    Array.prototype.forEach.call(el.querySelectorAll('[data-fijado]'), function (b) {
      b.onclick = function () { abrirPerfil(b.dataset.fijado, fijados().map(function (f) { return f.id; })); };
    });
  }

  // ---------- la ficha de una persona ----------
  // Dos columnas, como la ficha de un CRM: a la izquierda lo que pasó (historia, citas, notas) y a la derecha los
  // datos que se consultan de un vistazo. Arriba, «3 de 23» para pasar a la siguiente sin volver a la lista.
  var PF = null, PF_LISTA = null, PF_TAB = 'historia';

  function abrirPerfil(id, lista) {
    // La lista viaja con la ficha solo si la contiene: abrir desde un sitio y navegar por la lista de otro sería
    // pasar a gente que no se estaba mirando.
    PF_LISTA = lista && lista.indexOf(id) >= 0 && lista.length > 1 ? lista : null;
    $('pf-nombre').textContent = '…';
    $('pf-sub').textContent = '';
    $('pf-ini').textContent = '';
    $('pf-nav').hidden = true;
    $('pf-cuerpo').innerHTML = '<div class="small muted">Cargando…</div>';
    if (!$('dlg-perfil').open) $('dlg-perfil').showModal();
    api('/contacts/' + encodeURIComponent(id)).then(function (d) {
      if (d.error) { $('pf-cuerpo').innerHTML = '<div class="empty">' + esc(d.error) + '</div>'; return; }
      PF = d;
      pintarPerfil(d);
    });
  }
  function moverFicha(paso) {
    if (!PF_LISTA || !PF) return;
    var i = PF_LISTA.indexOf(PF.contact.id) + paso;
    if (i >= 0 && i < PF_LISTA.length) abrirPerfil(PF_LISTA[i], PF_LISTA);
  }
  $('pf-ant').onclick = function () { moverFicha(-1); };
  $('pf-sig').onclick = function () { moverFicha(1); };
  // Con las flechas del teclado también, salvo mientras se escribe: ahí la flecha mueve el cursor.
  $('dlg-perfil').addEventListener('keydown', function (e) {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); moverFicha(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); moverFicha(1); }
  });
  $('pf-fijar').onclick = function () {
    if (!PF) return;
    fijar(PF.contact, !estaFijado(PF.contact.id));
    pintarFijar();
    if (state.view === 'clientes') renderClientes();
  };
  function pintarFijar() {
    var on = PF && estaFijado(PF.contact.id);
    $('pf-fijar').setAttribute('aria-pressed', String(Boolean(on)));
    $('pf-fijar').textContent = on ? '★ Fijada' : '☆ Fijar';
  }

  function pintarPerfil(d) {
    var c = d.contact, h = d.historia || {}, v = d.valor || {};
    $('pf-nombre').textContent = nameOf(c);
    $('pf-ini').textContent = c.name ? inicialesDe(c.name) : '';
    $('pf-sub').textContent = [channelIcon(c.channel), c.phone || '', h.frase || ''].filter(Boolean).join(' · ');
    if (PF_LISTA) {
      var i = PF_LISTA.indexOf(c.id);
      $('pf-nav').hidden = false;
      $('pf-pos').textContent = (i + 1) + ' de ' + PF_LISTA.length;
      $('pf-ant').disabled = i <= 0;
      $('pf-sig').disabled = i >= PF_LISTA.length - 1;
    }
    pintarFijar();

    var ver = verdict(c);
    var notas = (d.events || []).filter(function (e) { return e.type === 'nota' && e.payload && e.payload.texto; });
    var citas = d.appointments || [];
    var data = c.data || {};
    var ocultos = Object.assign({ booking: 1, interes: 1, urgencia: 1, pospuesto_hasta: 1, pospuesto_desde: 1, valor: 1, sede: 1, motivo_perdida: 1 }, DE_CONTACTO);
    var capturados = Object.keys(data).filter(function (k) { return !ocultos[k] && data[k] !== '' && data[k] != null && typeof data[k] !== 'object'; });
    var fila = function (k, html, clase) { return '<dt' + (clase ? ' class="' + clase + '"' : '') + '>' + esc(k) + '</dt><dd' + (clase ? ' class="' + clase + '"' : '') + '>' + html + '</dd>'; };

    $('pf-cuerpo').innerHTML =
      '<div class="ficha-cols"><div class="ficha-main">' +
        // 🪤 Lo primero, lo accionable: si se le fue una venta, eso manda sobre cualquier otro dato de la ficha.
        (h.amago ? '<div class="pf-amago">⚠ Se le fue una venta: tuvo cita y no acabó en compra, y no tiene otra agendada.</div>' : '') +
        (c.summary ? '<p class="ficha-quiere">' + esc(c.summary) + '</p>' : '') +
        '<div class="ficha-tabs" role="tablist" aria-label="Qué ver de esta persona">' +
          [['historia', 'Historia', null], ['citas', 'Citas', citas.length], ['notas', 'Notas', notas.length + (c.notes ? 1 : 0)]].map(function (t) {
            return '<button role="tab" data-tab="' + t[0] + '" aria-selected="' + (PF_TAB === t[0]) + '" class="' + (PF_TAB === t[0] ? 'on' : '') + '">' + t[1] + (t[2] ? '<span class="cuenta">' + t[2] + '</span>' : '') + '</button>';
          }).join('') +
        '</div><div id="pf-tab" role="tabpanel"></div>' +
      '</div><aside class="ficha-lado"><h4>Detalles</h4><dl class="det">' +
        fila('Etapa', '<select id="pf-etapa" aria-label="Etapa">' + (state.stages || []).map(function (e) { return '<option value="' + esc(e.id) + '"' + (e.id === c.stage ? ' selected' : '') + '>' + esc(e.label) + '</option>'; }).join('') + '</select>' + motivoHtml(c, 'pf-motivo')) +
        fila('Puntaje', esc((c.score == null ? '—' : c.score) + (ver && ver.label ? ' · ' + ver.label : '')), 'solo-completo') +
        fila('Valor', v.valor ? esc(plata(v.valor)) + ' <span class="muted small">' + esc(v.origen === 'a mano' ? 'a mano' : 'del catálogo') + '</span>' : '<span class="muted">sin precio</span>') +
        fila('A cargo', responsableHtml(c, 'pf-resp')) +
        fila('La lleva', llevaHtml(c), 'solo-completo') +
        fila('Próximo paso', pasoHtml(c.proximo)) +
        fila('Volvió', esc(h.volvio ? h.volvio + (h.volvio === 1 ? ' vez' : ' veces') : 'no ha vuelto'), 'solo-completo') +
        fila('Última vez', esc(c.lastMessageAt ? 'hace ' + rel(c.lastMessageAt) : '—')) +
        fila('Desde', esc(h.desde ? new Date(h.desde).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'), 'solo-completo') +
        (d.origen && d.origen.fuente ? fila('Llegó por', esc(d.origen.fuente + (d.origen.campana ? ' · ' + d.origen.campana : '')), 'solo-completo') : '') +
        (variasSedes() && data.sede ? fila('Sede', esc(nombreSede(data.sede))) : '') +
        contactoHtml(c, fila) +
      '</dl>' +
      (capturados.length ? '<h4>Lo que contó</h4><dl class="det">' + capturados.map(function (k) { return fila(etiquetaDato(k), esc(data[k])); }).join('') + '</dl>' : '') +
      '<details class="corregir"><summary>Corregir datos</summary><div class="pf-campos">' +
        '<div class="ancho"><label for="pf-f-nombre">Nombre</label><input id="pf-f-nombre" value="' + esc(c.name || '') + '"></div>' +
        '<div class="ancho"><label for="pf-f-tel">Teléfono</label><input id="pf-f-tel" value="' + esc(c.phone || '') + '"></div>' +
        camposFichaHtml(c, 'pf-x-') +
        // 🪤 El valor a mano manda sobre el del catálogo, y se dice aquí: si no, quien lo escriba no sabrá por
        // qué su número sobrevive a un reindexado y el deducido no.
        '<div class="ancho"><label for="pf-f-valor">Valor (manda sobre el del catálogo)</label><input id="pf-f-valor" type="number" min="0" value="' + (v.origen === 'a mano' ? v.valor : '') + '" placeholder="' + (v.valor ? v.valor : 'sin precio') + '"></div>' +
        '<div class="ancho"><label for="pf-f-notas">Nota fija</label><textarea id="pf-f-notas" rows="2" placeholder="Lo que siempre hay que saber de esta persona">' + esc(c.notes || '') + '</textarea></div>' +
      '</div><div class="fila" style="gap:8px;margin-top:10px"><button class="btn primary sm" id="pf-guardar">Guardar</button>' +
      '<span class="grow"></span><span class="small" id="pf-msg" role="status"></span></div></details>' +
      '</aside></div>';

    pintarPestana();
    Array.prototype.forEach.call($('pf-cuerpo').querySelectorAll('[data-tab]'), function (b) {
      b.onclick = function () {
        PF_TAB = b.dataset.tab;
        Array.prototype.forEach.call($('pf-cuerpo').querySelectorAll('[data-tab]'), function (x) { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', String(x === b)); });
        pintarPestana();
      };
    });
    // La etapa se cambia aquí mismo, sin pasar por «Corregir»: es lo que más se toca.
    $('pf-etapa').onchange = function () {
      var nueva = $('pf-etapa').value;
      cambiarEtapa(c, nueva, function (r) {
        if (!r) { $('pf-etapa').value = c.stage; return; }
        if (r.error) { toast(r.error); return; }
        toast('Etapa: ' + etiquetaEtapa(nueva));
        recargarListas();
        abrirPerfil(c.id, PF_LISTA);
      });
    };
    if ($('pf-motivo')) $('pf-motivo').onclick = function () { cambiarEtapa(c, c.stage, function (r) { if (r && !r.error) abrirPerfil(c.id, PF_LISTA); }); };
    engancharResponsable($('pf-resp'), c, function () { recargarListas(); abrirPerfil(c.id, PF_LISTA); });
    $('pf-guardar').onclick = function () {
      var valor = Number($('pf-f-valor').value);
      var cuerpo = {
        name: $('pf-f-nombre').value.trim(),
        phone: $('pf-f-tel').value.trim(),
        notes: $('pf-f-notas').value.trim(),
        // Solo el valor, no el `data` entero: el servidor lo mezcla con lo que haya, y mandarlo todo pisaba lo que el
        // análisis hubiera captado mientras la ficha estaba abierta. Vacío va como 0, que el servidor lee como «quitarlo».
        data: { valor: Number.isFinite(valor) && valor > 0 ? valor : 0 },
        ficha: leerFicha('pf-x-'),
      };
      $('pf-msg').textContent = 'Guardando…';
      api('/contacts/' + encodeURIComponent(c.id), { method: 'PATCH', body: cuerpo }).then(function (r) {
        if (r && r.error) { $('pf-msg').textContent = r.error; return; }
        $('pf-msg').textContent = 'Guardado.';
        recargarListas();
        abrirPerfil(c.id, PF_LISTA);
      });
    };
  }

  /** Lo que haya abierto que muestre esta ficha, para que no quede diciendo lo de antes. */
  function recargarListas() {
    if (state.view === 'clientes') loadClientes();
    if (state.view === 'pipeline') loadPipeline();
    if (state.view === 'inbox') loadContacts();
  }

  function pintarPestana() {
    var d = PF; if (!d) return;
    var c = d.contact, el = $('pf-tab');
    if (PF_TAB === 'citas') {
      el.innerHTML = (d.appointments || []).length ? d.appointments.map(function (a) {
        return '<div class="appt ' + a.status + '"><span class="t">' + esc(a.label || '') + '</span>' +
          '<span class="grow small muted">' + esc((a.service || '') + conSede(a)) + '</span><span class="chip">' + esc(estadoCita(a.status)) + '</span></div>';
      }).join('') : '<div class="empty">Sin citas todavía.</div>';
      return;
    }
    var soloNotas = PF_TAB === 'notas';
    el.innerHTML = '<div class="nota-nueva"><label class="sr-only" for="pf-nota">Nota nueva</label>' +
        '<textarea id="pf-nota" rows="2" maxlength="2000" placeholder="Agregar una nota para el equipo…"></textarea>' +
        '<button class="btn sm primary" id="pf-nota-ok">Guardar nota</button></div>' +
      (c.notes ? '<div class="h-item nota fija"><div class="h-cab"><b>Nota fija</b><span class="muted small">se cambia en «Corregir datos»</span></div><div class="h-texto">' + esc(c.notes) + '</div></div>' : '') +
      historiaHtml(d, { soloNotas: soloNotas, borrar: true });
    $('pf-nota-ok').onclick = function () {
      var texto = $('pf-nota').value.trim();
      if (!texto) { $('pf-nota').focus(); return; }
      $('pf-nota-ok').disabled = true;
      api('/contacts/' + encodeURIComponent(c.id) + '/notas', { method: 'POST', body: { texto: texto, por: state.name || '' } }).then(function (r) {
        $('pf-nota-ok').disabled = false;
        if (r && r.error) { toast(r.error); return; }
        d.events = r.events || d.events;
        pintarPerfil(d);
      });
    };
    engancharBorrarNotas(el, c.id, function (events) { d.events = events; pintarPerfil(d); });
  }

  /** Borrar una nota pide dos clics: el primero pregunta en el mismo botón, sin ventanas encima. */
  function engancharBorrarNotas(raiz, id, listo) {
    Array.prototype.forEach.call(raiz.querySelectorAll('[data-borrar-nota]'), function (b) {
      b.onclick = function () {
        if (b.dataset.seguro !== '1') {
          b.dataset.seguro = '1'; b.textContent = '¿Borrarla? Sí';
          setTimeout(function () { b.dataset.seguro = ''; b.textContent = 'Borrar'; }, 4000);
          return;
        }
        api('/contacts/' + encodeURIComponent(id) + '/notas/' + b.dataset.borrarNota, { method: 'DELETE' }).then(function (r) {
          if (r && r.error) { toast(r.error); return; }
          listo(r.events || []);
        });
      };
    });
  }

  function estadoCita(s) { return { confirmada: 'confirmada', completada: 'cumplida', no_asistio: 'no vino', cancelada: 'cancelada' }[s] || s; }

  /**
   * La historia de una persona: lo que pasó, de lo más nuevo a lo más viejo y agrupado por día. Junta tres
   * fuentes —los eventos (etapas, traspasos, citas, notas), las conversaciones y nada más— y las cuenta en
   * palabras: «Laura la tomó», no «human_on (Laura)».
   *
   * 🪤 Lo que no se sabe nombrar no se enseña. Un tipo de evento nuevo saldría aquí como su nombre interno, y
   * eso es peor que no salir.
   */
  /** «nombre, teléfono y nota fija». */
  function enLista(xs) { return xs.length < 2 ? String(xs[0] || '') : xs.slice(0, -1).join(', ') + ' y ' + xs[xs.length - 1]; }
  function historiaHtml(d, opts) {
    opts = opts || {};
    var agente = state.agentName || 'Aiva';
    var quien = function (by) { return !by || by === 'bot' ? agente : by === 'admin' || by === 'equipo' ? 'El equipo' : by; };
    var items = [];
    (d.events || []).forEach(function (e) {
      var p = e.payload || {}, t = null, tipo = 'evento';
      switch (e.type) {
        case 'nota': if (!p.texto) return; items.push({ ts: e.ts, tipo: 'nota', id: e.id, por: p.por || 'El equipo', texto: p.texto }); return;
        case 'stage': t = quien(p.by) + ' la pasó de ' + (state.stageLabels[p.from] || p.from || '—') + ' a ' + (state.stageLabels[p.to] || p.to) + (p.motivo ? ' · ' + p.motivo : ''); tipo = 'etapa'; break;
        case 'motivo_perdida': t = quien(p.by) + ' dijo por qué se perdió: ' + p.motivo; tipo = 'etapa'; break;
        case 'responsable': t = p.a ? (p.a === p.by ? p.a + ' quedó a cargo' : quien(p.by) + ' dejó a ' + p.a + ' a cargo') : quien(p.by) + ' la dejó sin nadie a cargo'; tipo = 'traspaso'; break;
        case 'entregada': t = quien(p.by) + ' se la entregó a ' + p.a; tipo = 'traspaso'; break;
        case 'editado': if (!(p.campos || []).length) return; t = quien(p.by) + ' corrigió ' + enLista(p.campos); break;
        case 'nota_borrada': t = quien(p.by) + ' borró una nota'; break;
        case 'human_on': t = p.by === 'bot' ? agente + ' la pasó al equipo' + (p.motivo === 'tope' ? ' (se llegó al tope de gasto)' : '') : quien(p.by) + ' tomó la conversación'; tipo = 'traspaso'; break;
        case 'human_off': t = agente + ' volvió a atenderla'; tipo = 'traspaso'; break;
        case 'appointment_booked': t = 'Cita agendada' + (p.startsAt ? ' para el ' + new Date(p.startsAt).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }) : '') + (p.by && p.by !== 'bot' ? ' por ' + quien(p.by) : ''); tipo = 'cita'; break;
        case 'appointment_updated': if (!p.status) return; t = 'La cita quedó ' + estadoCita(p.status) + (p.by && p.by !== 'bot' ? ' · ' + quien(p.by) : ''); tipo = 'cita'; break;
        case 'reminder_reply': t = 'Contestó el recordatorio de la cita'; tipo = 'cita'; break;
        case 'followup_snooze': t = 'Seguimiento pospuesto ' + (p.days || 7) + ' días'; break;
        case 'archivada': t = p.by ? quien(p.by) + ' la archivó' : 'Se archivó'; break;
        case 'desarchivada': t = p.by ? quien(p.by) + ' la devolvió a las listas' : 'Volvió a las listas'; break;
        case 'contacts_merged': t = (p.by ? quien(p.by) + ' la unió' : 'Se unió') + ' con otra ficha de la misma persona'; break;
        case 'cross_channel': t = 'Escribió también por otro canal'; break;
        default: return;
      }
      items.push({ ts: e.ts, tipo: tipo, texto: t });
    });
    if (opts.soloNotas) items = items.filter(function (x) { return x.tipo === 'nota'; });
    else {
      // Las conversaciones, una por día: cuántos mensajes y cómo empezó. El chat entero está a un botón.
      var dias = {};
      (d.messages || []).forEach(function (m) {
        var k = new Date(m.ts).toDateString();
        var x = dias[k] || (dias[k] = { ts: m.ts, suyos: 0, primero: '' });
        if (m.role === 'user') { x.suyos++; if (!x.primero) x.primero = m.content || ''; }
      });
      Object.keys(dias).forEach(function (k) {
        var x = dias[k];
        if (!x.suyos) return;
        items.push({ ts: x.ts, tipo: 'charla', texto: 'Escribió ' + x.suyos + (x.suyos === 1 ? ' mensaje' : ' mensajes'), cita: x.primero });
      });
    }
    items.sort(function (a, b) { return b.ts - a.ts; });
    if (opts.max) items = items.slice(0, opts.max);
    if (!items.length) return '<div class="empty">' + (opts.soloNotas ? 'Sin notas. Lo que el equipo deba saber de esta persona, aquí.' : 'Todavía no hay historia.') + '</div>';

    var hoy = new Date().toDateString(), ayer = new Date(Date.now() - 86400000).toDateString(), dia = '';
    return '<div class="historia">' + items.map(function (x) {
      var k = new Date(x.ts).toDateString(), cab = '';
      if (k !== dia) {
        dia = k;
        cab = '<div class="h-dia">' + (k === hoy ? 'Hoy' : k === ayer ? 'Ayer' : esc(new Date(x.ts).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }))) + '</div>';
      }
      if (x.tipo === 'nota') {
        return cab + '<div class="h-item nota"><div class="h-cab"><b>' + esc(x.por) + '</b><span class="muted small">dejó una nota · ' + esc(hhmm(x.ts)) + '</span>' +
          (opts.borrar ? '<span class="grow"></span><button class="linkbtn small" data-borrar-nota="' + x.id + '">Borrar</button>' : '') + '</div>' +
          '<div class="h-texto">' + esc(x.texto) + '</div></div>';
      }
      return cab + '<div class="h-item ' + x.tipo + '"><i class="h-punto" aria-hidden="true"></i><span class="h-linea">' + esc(x.texto) +
        (x.cita ? '<span class="h-cita">«' + esc(x.cita.length > 140 ? x.cita.slice(0, 140) + '…' : x.cita) + '»</span>' : '') +
        '</span><span class="muted small">' + esc(hhmm(x.ts)) + '</span></div>';
    }).join('') + '</div>';
  }


  // ---------- la ficha: lo de contacto y lo que capta el negocio (crm/ficha.ts) ----------
  // DUNOR lo pidió así: «modificar contacto» solo dejaba nombre y teléfono, y quien llega por Instagram no tenía
  // dónde dejar su usuario. Los campos los dice el servidor (/stats): los de contacto valen para todos, y los del
  // negocio son los que aiva capta de la conversación (en DUNOR, la talla o las medidas). Se ven igual en los dos
  // modos: atender bien a alguien no es «avanzado».
  var DE_CONTACTO = { correo: 1, whatsapp: 1, instagram: 1, facebook: 1, contacto_por: 1 };
  function fichaDelNegocio() { return state.ficha || { contacto: [], contactoPor: [], delNegocio: [] }; }
  /** Lo de contacto que tiene, como algo que se toca: escribirle, abrir su Instagram. Solo lo que hay. */
  function contactoHtml(c, fila) {
    var data = c.data || {};
    return fichaDelNegocio().contacto.map(function (x) {
      var v = data[x.k];
      if (!v) return '';
      var s = String(v), html = esc(s);
      if (x.k === 'correo') html = '<a href="mailto:' + esc(s) + '">' + esc(s) + '</a>';
      else if (x.k === 'whatsapp') html = '<a target="_blank" rel="noopener" href="https://wa.me/' + esc(s.replace(/\D/g, '')) + '">' + esc(s) + '</a>';
      else if (x.k === 'instagram') html = '<a target="_blank" rel="noopener" href="https://instagram.com/' + encodeURIComponent(s) + '">@' + esc(s) + '</a>';
      // Un nombre con espacios no es un enlace: es como aparece, y se busca a mano.
      else if (x.k === 'facebook' && !/\s/.test(s)) html = '<a target="_blank" rel="noopener" href="https://facebook.com/' + esc(s) + '">' + esc(s) + '</a>';
      return fila(x.etiqueta, html);
    }).join('');
  }
  /**
   * Los campos de la ficha para «Corregir datos». `p` es el prefijo de sus id: la de la conversación y la completa
   * pueden estar pintadas a la vez.
   */
  function camposFichaHtml(c, p, opts) {
    opts = opts || {};
    var data = c.data || {}, f = fichaDelNegocio(), b = opts.borrador ? ' data-borrador' : '';
    var campo = function (k, etiqueta, entrada) { return '<div class="ancho"><label for="' + p + k + '">' + esc(etiqueta) + '</label>' + entrada + '</div>'; };
    // 🪤 Sin type="email": esa regla de estilo es otra y el correo salía redondo entre campos cuadrados. El teclado
    // del celular lo da inputmode; que sea un correo lo revisa el servidor.
    var PISTAS = { correo: ' inputmode="email" autocomplete="off" placeholder="nombre@correo.com"', whatsapp: ' inputmode="tel" placeholder="Si es otro número"', instagram: ' autocomplete="off" placeholder="@usuario"', facebook: ' autocomplete="off" placeholder="Usuario o nombre como aparece"' };
    var contacto = f.contacto.filter(function (x) { return !(opts.sin && opts.sin[x.k]); }).map(function (x) {
      if (x.k === 'contacto_por') {
        return campo(x.k, x.etiqueta, '<select id="' + p + x.k + '"><option value="">Sin decir</option>' +
          f.contactoPor.map(function (o) { return '<option' + (o === data[x.k] ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>');
      }
      return campo(x.k, x.etiqueta, '<input id="' + p + x.k + '"' + b + ' value="' + esc(data[x.k] || '') + '"' + (PISTAS[x.k] || '') + '>');
    }).join('');
    if (opts.soloContacto || !f.delNegocio.length) return contacto;
    // Lo del negocio, con lo que aiva ya captó escrito: aquí se corrige, y lo corregido el análisis ya no lo pisa.
    return contacto + '<div class="ancho sub-ficha">Lo que contó</div>' + f.delNegocio.map(function (x) {
      var val = data[x.k] == null ? '' : String(data[x.k]);
      // Lo largo (unas medidas completas) en dos renglones: en un campo de una línea se leía solo el principio.
      var entrada = val.length > 40
        ? '<textarea id="' + p + x.k + '"' + b + ' rows="2" title="' + esc(x.ayuda || '') + '">' + esc(val) + '</textarea>'
        : '<input id="' + p + x.k + '"' + b + ' value="' + esc(val) + '" title="' + esc(x.ayuda || '') + '">';
      return campo(x.k, etiquetaDato(x.k), entrada);
    }).join('');
  }
  function idsDeFicha(p) {
    var f = fichaDelNegocio();
    return f.contacto.concat(f.delNegocio).map(function (x) { return p + x.k; });
  }
  /** Lo que se escribió en los campos de la ficha que estén pintados con ese prefijo. */
  function leerFicha(p) {
    var f = fichaDelNegocio(), out = {};
    f.contacto.concat(f.delNegocio).forEach(function (x) { var el = $(p + x.k); if (el) out[x.k] = el.value.trim(); });
    return out;
  }

  // ---------- dar de alta a alguien a mano ----------
  $('cli-nuevo').onclick = function () {
    $('nv-nombre').value = '';
    $('nv-tel').value = '';
    $('nv-notas').value = '';
    $('nv-msg').textContent = '';
    // WhatsApp no: el teléfono de arriba ya es su WhatsApp.
    $('nv-ficha').innerHTML = camposFichaHtml({ data: {} }, 'nv-x-', { soloContacto: true, sin: { whatsapp: 1 } });
    $('nv-etapa').innerHTML = (state.stages || []).map(function (e) { return '<option value="' + esc(e.id) + '">' + esc(e.label) + '</option>'; }).join('');
    // Con varias sedes, a cuál llegó: si no, sale en Prospectos como «sin sede» aunque haya entrado por una.
    $('nv-sede-l').hidden = !variasSedes();
    $('nv-sede').innerHTML = '<option value="">Todavía no sé</option>' + (state.sedes || []).map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.nombre) + '</option>'; }).join('');
    $('dlg-nuevo').showModal();
    $('nv-nombre').focus();
  };

  $('nv-crear').onclick = function () {
    var nombre = $('nv-nombre').value.trim();
    var tel = $('nv-tel').value.trim();
    if (!nombre && !tel) { $('nv-msg').textContent = 'Dime al menos el nombre o el teléfono.'; return; }
    $('nv-msg').textContent = 'Creando…';
    api('/contacts', { method: 'POST', body: { name: nombre, phone: tel, stage: $('nv-etapa').value, notes: $('nv-notas').value.trim(), sede: variasSedes() ? $('nv-sede').value || undefined : undefined, ficha: leerFicha('nv-x-') } })
      .then(function (r) {
        if (!r || r.error) { $('nv-msg').textContent = (r && r.error) || 'No se pudo crear.'; return; }
        $('dlg-nuevo').close();
        loadClientes();
        // 🪤 Si ya existía se dice, y se abre la que hay: crear "otra" ficha de la misma persona es precisamente
        // lo que parte la historia en dos, y quien lo hace no se entera hasta que le falta la mitad.
        if (r.yaExistia) toast('Esa persona ya tenía ficha: te la abro.');
        abrirPerfil(r.contact.id);
      });
  };

  $('pf-cerrar').onclick = function () { $('dlg-perfil').close(); };
  // 🪤 En el modo fácil la ficha se ve como una página (la «Cliente 360» de Nexora), con el menú y la barra de
  // arriba a la vista. Pero es un diálogo modal, y lo de fuera no responde: un clic en «Citas» no hacía nada. Aquí
  // ese clic cierra la ficha y sigue hasta donde iba.
  $('dlg-perfil').addEventListener('click', function (e) {
    if (e.target !== $('dlg-perfil')) return;
    var caja = $('dlg-perfil').getBoundingClientRect();
    if (e.clientX >= caja.left && e.clientX <= caja.right && e.clientY >= caja.top && e.clientY <= caja.bottom) return;
    $('dlg-perfil').close();
    var debajo = document.elementFromPoint(e.clientX, e.clientY);
    var boton = debajo && debajo.closest && debajo.closest('button, a');
    if (boton) boton.click();
  });
  $('pf-chat').onclick = function () {
    if (!PF) return;
    $('dlg-perfil').close();
    go('inbox');
    openContact(PF.contact.id);
  };


  // ---------- Búsqueda global (Ctrl/Cmd + K) ----------
  //
  // 🪤 Busca lo mismo que la lista de Conversaciones —nombre, teléfono y lo que dijeron— y por eso reutiliza su
  // ruta en vez de inventar otra. Dos búsquedas distintas en el mismo producto acaban dando resultados
  // distintos para lo mismo, y el día que pasa nadie vuelve a confiar en ninguna de las dos.
  var palSel = 0;
  var palItems = [];
  var palTimer = null;

  function abrirPaleta() {
    var d = $('dlg-buscar');
    if (d.open) return;
    $('pal-q').value = '';
    $('pal-res').innerHTML = '';
    palItems = [];
    d.showModal();
    $('pal-q').focus();
  }

  function pintarPaleta(lista, q) {
    palItems = lista;
    palSel = 0;
    if (!lista.length) {
      $('pal-res').innerHTML = '<div class="pal-grupo">' + (q ? 'Nadie con eso' : '') + '</div>';
      return;
    }
    $('pal-res').innerHTML = '<div class="pal-grupo">' + lista.length + (lista.length === 1 ? ' resultado' : ' resultados') + '</div>' +
      lista.map(function (c, i) {
        // 🪤 `hit` es el mensaje donde apareció lo buscado —{role, content, ts}—, no una cadena. Pintarlo tal
        // cual dejaba un «[object Object]» en cada fila: se ve en cuanto se abre y aun así hay que mirarlo.
        var trozo = c.hit && c.hit.content ? c.hit.content : c.summary || '';
        var sub = [c.phone ? '+' + c.phone : '', resaltar(trozo, q)].filter(Boolean).join(' · ');
        return '<button class="pal-i" role="option" data-i="' + i + '" aria-selected="' + (i === 0) + '">' +
          '<i class="ic" data-ic="' + (c.channel === 'whatsapp' ? 'message' : 'user') + '"></i>' +
          '<span class="col"><span class="n">' + esc(nameOf(c)) + '</span><span class="d">' + sub + '</span></span></button>';
      }).join('');
    iconos($('pal-res'));
    Array.prototype.forEach.call($('pal-res').querySelectorAll('.pal-i'), function (b) {
      b.onclick = function () { abrirDeLaPaleta(Number(b.dataset.i)); };
    });
  }

  /**
   * Lo buscado, marcado dentro del trozo donde apareció.
   *
   * 🪤 Se escapa PRIMERO y se marca después, sobre el texto ya escapado. Al revés —marcar y luego escapar— el
   * propio <mark> saldría escrito en pantalla; y marcar sin escapar deja que el mensaje de un cliente meta
   * etiquetas en el tablero, que es el agujero que esta casa ya tapó una vez.
   */
  function resaltar(texto, q) {
    var limpio = esc(String(texto || '').slice(0, 120));
    if (!q) return limpio;
    var aguja = esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return limpio.replace(new RegExp('(' + aguja + ')', 'ig'), '<mark>$1</mark>');
  }

  function abrirDeLaPaleta(i) {
    var c = palItems[i];
    if (!c) return;
    $('dlg-buscar').close();
    go('inbox');
    openContact(c.id);
  }

  function moverPaleta(paso) {
    if (!palItems.length) return;
    palSel = (palSel + paso + palItems.length) % palItems.length;
    Array.prototype.forEach.call($('pal-res').querySelectorAll('.pal-i'), function (b, i) {
      b.setAttribute('aria-selected', String(i === palSel));
      if (i === palSel) b.scrollIntoView({ block: 'nearest' });
    });
  }

  $('pal-q').addEventListener('input', function () {
    var q = $('pal-q').value.trim();
    clearTimeout(palTimer);
    if (q.length < 2) { pintarPaleta([], ''); return; }
    // Se espera a que deje de escribir: una consulta por tecla satura al servidor y hace parpadear la lista.
    palTimer = setTimeout(function () {
      api('/contacts?q=' + encodeURIComponent(q)).then(function (r) {
        if ($('pal-q').value.trim() !== q) return; // llegó tarde: ya escribió otra cosa
        pintarPaleta((r || []).slice(0, 12), q);
      });
    }, 180);
  });

  $('pal-q').addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); moverPaleta(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moverPaleta(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); abrirDeLaPaleta(palSel); }
  });

  // 🪤 El atajo se escucha en captura y comprueba que no haya un diálogo encima: sin eso, Cmd+K dentro de la
  // ficha abriría la búsqueda por detrás del modal y quedaría escribiendo en un campo que no se ve.
  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      var abierto = document.querySelector('dialog[open]');
      if (abierto && abierto.id !== 'dlg-buscar') return;
      abrirPaleta();
    }
  }, true);

  // ---------- Ventas ----------
  function cargarVentas(dias) {
    state.venDias = dias;
    Array.prototype.forEach.call($('ven-dias').children, function (b) { b.classList.toggle('on', Number(b.dataset.d) === dias); });
    $('ven-lista').innerHTML = '<div class="small muted">Cargando…</div>';
    api('/ventas?days=' + dias).then(function (d) {
      $('ven-kpis').innerHTML =
        tarjeta(plata(d.total || 0), 'vendido en ' + (dias === 365 ? 'un año' : dias + ' días')) +
        tarjeta(String(d.cuantas || 0), d.cuantas === 1 ? 'venta' : 'ventas') +
        tarjeta(d.promedio ? plata(Math.round(d.promedio)) : '—', 'promedio por venta') +
        // 🪤 Cuántas no tienen precio se enseña al lado del total. Sin esto, un total bajo parece un mal mes
        // cuando lo que pasa es que al catálogo le faltan precios: dos problemas muy distintos.
        tarjeta(String(d.sinPrecio || 0), 'sin precio todavía');
      $('ven-lista').innerHTML = (d.ventas || []).length
        ? '<div class="envoltura"><table class="tz-tabla"><thead><tr><th>Quién</th><th>Qué quería</th><th>Cuándo</th><th class="num">Valor</th></tr></thead><tbody>' +
          d.ventas.map(function (v) {
            return '<tr><td><button class="quien" data-id="' + esc(v.id) + '">' + esc(nameOf({ id: v.id, name: v.nombre, channel: v.canal })) + '</button>' +
              (v.phone ? '<div class="dato">+' + esc(v.phone) + '</div>' : '') + '</td>' +
              '<td class="quiere">' + esc(v.resumen || '—') + '</td>' +
              '<td class="small muted">' + (v.cuando ? new Date(v.cuando).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }) : '—') + '</td>' +
              '<td class="num">' + (v.valor && v.valor.valor ? plata(v.valor.valor) : '<span class="muted">sin precio</span>') + '</td></tr>';
          }).join('') + '</tbody></table></div>'
        : '<div class="empty">Todavía no hay ventas en este periodo. Una ficha cuenta como venta cuando pasa a la etapa de ganado.</div>';
      engancharFichas($('ven-lista'));
      // 🪤 Las que no dicen motivo se cuentan aparte y a la vista: sin eso, «Precio: 3» parecería el problema cuando
      // de veinte perdidas nadie dijo nada de diecisiete.
      var pd = d.perdidas || { cuantas: 0, motivos: [], sinMotivo: 0 };
      $('ven-perdidas').innerHTML = pd.cuantas
        ? '<div class="panel"><h3>Por qué se pierden<span class="chip">' + pd.cuantas + '</span></h3>' +
          (pd.motivos.length ? '<ul class="motivos-lista">' + pd.motivos.map(function (m) {
            return '<li><span class="t">' + esc(m.motivo) + '</span><span class="barra" aria-hidden="true"><i style="width:' + Math.round(100 * m.n / pd.cuantas) + '%"></i></span><span class="n">' + m.n + '</span></li>';
          }).join('') + '</ul>' : '') +
          (pd.sinMotivo ? '<div class="small muted">' + pd.sinMotivo + (pd.sinMotivo === 1 ? ' se perdió' : ' se perdieron') + ' sin decir por qué. Se pregunta al pasarla a la etapa de perdido.</div>' : '') + '</div>'
        : '';
    });
  }

  // ---------- Seguimientos ----------
  // 🪤 La insignia de Clientes (calientes esperando seguimiento) solo se llenaba al ENTRAR a Seguimientos: quien no
  // entraba nunca veía que había alguien esperando. Ahora se pide con las cuentas de la barra, que se recalculan
  // cuando algo cambia.
  function pintarInsigniaSeg(d) {
    var badge = $('badge-seg');
    if (badge && d && !d.error) { badge.textContent = d.calientes || ''; badge.style.display = d.calientes ? '' : 'none'; }
  }
  function cargarSeguimientos() {
    $('seg-lista').innerHTML = '<div class="small muted">Cargando…</div>';
    api('/seguimientos').then(function (d) {
      var n = d.cuantos || 0;
      $('seg-resumen').textContent = n ? n + (n === 1 ? ' persona esperando' : ' personas esperando') + (d.calientes ? ' · ' + d.calientes + ' calientes' : '') : '';
      pintarInsigniaSeg(d);
      $('seg-lista').innerHTML = (d.seguimientos || []).length
        ? '<div class="envoltura"><table class="tz-tabla"><thead><tr><th>Quién</th><th>Por qué</th><th>Qué quería</th><th class="num">Puntaje</th><th></th></tr></thead><tbody>' +
          d.seguimientos.map(function (f) {
            return '<tr><td><button class="quien" data-id="' + esc(f.id) + '">' + esc(nameOf({ id: f.id, name: f.nombre, channel: f.canal })) + '</button>' +
              (f.phone ? '<div class="dato">+' + esc(f.phone) + '</div>' : '') + '</td>' +
              '<td class="small">' + esc(f.porque) + '</td>' +
              '<td class="quiere">' + esc(f.resumen || '—') + '</td>' +
              '<td class="num">' + (f.puntaje || 0) + '</td>' +
              '<td><button class="btn sm" data-escribir="' + esc(f.id) + '">Escribirle</button></td></tr>';
          }).join('') + '</tbody></table></div>'
        : '<div class="empty">Nadie esperando. Todo el mundo tiene cita, acaba de escribir, o ya está pospuesto.</div>';
      engancharFichas($('seg-lista'));
      Array.prototype.forEach.call($('seg-lista').querySelectorAll('[data-escribir]'), function (b) {
        b.onclick = function () { go('inbox'); openContact(b.dataset.escribir); };
      });
    });
  }

  /** Abrir la ficha desde cualquier tabla que liste gente. */
  function engancharFichas(raiz) {
    // Con la lista en el orden de la tabla: desde la ficha se pasa a la siguiente sin volver aquí.
    var ids = Array.prototype.map.call(raiz.querySelectorAll('.quien[data-id]'), function (b) { return b.dataset.id; });
    Array.prototype.forEach.call(raiz.querySelectorAll('.quien[data-id]'), function (b) {
      b.onclick = function () { abrirPerfil(b.dataset.id, ids); };
    });
  }

  // ---------- Trazabilidad ----------
  var TAREAS = {
    light: 'Responder (liviano)', heavy: 'Responder (pesado)', gate: 'Clasificar la entrada',
    analysis: 'Analizar la conversación', when: 'Entender fechas', embeddings: 'Búsqueda',
    consulta: 'Consulta del equipo', transcripcion: 'Transcribir notas de voz',
  };
  function plataFina(n) { return '$' + (n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2)); }

  function cargarTrazas(dias) {
    state.tzDias = dias;
    Array.prototype.forEach.call($('tz-dias').children, function (b) { b.classList.toggle('on', Number(b.dataset.d) === dias); });
    $('tz-tabla').innerHTML = '<div class="small muted">Cargando…</div>';
    Promise.all([api('/usage?days=' + dias), api('/medios')]).then(function (r) {
      var u = r[0] || {}, m = r[1] || {};
      var filas = (u.rows || []).slice().sort(function (a, b) { return (b.costUsd || 0) - (a.costUsd || 0); });
      $('tz-kpis').innerHTML =
        tarjeta(plataFina(u.totalUsd || 0), 'gastado en ' + dias + (dias === 1 ? ' día' : ' días')) +
        tarjeta(String(u.conversations || 0), 'conversaciones') +
        tarjeta(plataFina(u.usdPerConversation || 0), 'por conversación') +
        tarjeta(String(filas.reduce(function (a, f) { return a + (f.calls || 0); }, 0)), 'llamadas al modelo');
      $('tz-tabla').innerHTML = filas.length
        ? '<div class="envoltura"><table class="tz-tabla"><thead><tr><th>Para qué</th><th>Modelo</th>' +
          '<th class="num">Llamadas</th><th class="num">Entrada</th><th class="num">Salida</th><th class="num">Segundos</th><th class="num">Costo</th></tr></thead><tbody>' +
          filas.map(function (f) {
            return '<tr><td>' + esc(TAREAS[f.task] || f.task) + '</td><td class="small muted">' + esc(f.model) + '</td>' +
              '<td class="num">' + (f.calls || 0) + '</td><td class="num">' + (f.inputTokens || 0).toLocaleString('es-CO') + '</td>' +
              '<td class="num">' + (f.outputTokens || 0).toLocaleString('es-CO') + '</td>' +
              '<td class="num">' + (f.segundos ? f.segundos : '—') + '</td>' +
              '<td class="num">' + (f.costUsd == null ? 'sin precio' : plataFina(f.costUsd)) + '</td></tr>';
          }).join('') + '</tbody></table></div>'
        : '<div class="empty">Todavía no se ha llamado al modelo en este periodo.</div>';
      $('tz-medios').innerHTML = '<div class="kpis">' +
        tarjeta(String(m.archivos || 0), 'archivos guardados') +
        tarjeta(((m.bytes || 0) / 1048576).toFixed(1) + ' MB', 'en disco') +
        tarjeta(Math.round((m.maximoPorArchivo || 0) / 1048576) + ' MB', 'tope por archivo') + '</div>';
      // 🪤 Se dice de dónde sale la cifra y qué NO incluye. Un número de dinero sin su origen acaba en una
      // reunión como si fuera la factura, y esto cuenta lo que gastó ESTE cliente, no lo que cobra OpenAI.
      $('tz-nota').textContent = 'Lo que este cliente le pidió al modelo, contado aquí mismo. La factura de OpenAI puede incluir otros clientes y otros servicios si comparten la misma llave.' +
        (u.unpriced ? ' Hay modelos sin precio conocido: su costo no está sumado.' : '');
    });
  }
  function tarjeta(n, p) { return '<div class="kpi"><span class="n">' + esc(n) + '</span><span class="p">' + esc(p) + '</span></div>'; }
  Array.prototype.forEach.call($('tz-dias').children, function (b) {
    b.onclick = function () { cargarTrazas(Number(b.dataset.d)); };
  });
  Array.prototype.forEach.call($('ven-dias').children, function (b) {
    b.onclick = function () { cargarVentas(Number(b.dataset.d)); };
  });

  function etiquetaEtapa(id) {
    var e = (state.stages || []).find(function (x) { return x.id === id; });
    return (e && e.label) || id || '';
  }

  var cliTimer;
  $('cli-q').oninput = function () {
    clearTimeout(cliTimer);
    var v = this.value.trim();
    // Se espera a que deje de teclear: una consulta por letra castiga al servidor y hace parpadear la tabla.
    cliTimer = setTimeout(function () { cli.q = v; loadClientes(); }, 300);
  };
  $('cli-csv').onclick = function () { download('/export/contactos', 'clientes.csv'); };


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
        state.detail.messages.push({ id: p.id, role: p.role, author: p.author, by: p.by, content: p.content, ts: p.ts });
        var m = $('msgs'); m.insertAdjacentHTML('beforeend', bubble({ id: p.id, role: p.role, author: p.author, by: p.by, content: p.content, ts: p.ts })); m.scrollTop = m.scrollHeight;
        if (p.author === 'customer') api('/contacts/' + encodeURIComponent(ev.userId)).then(function () {}); // marca leído
      }
      if (p.author === 'customer') {
        if (state.current !== ev.userId || document.hidden) { beep(); var c = state.contacts.find(function (x) { return x.id === ev.userId; }); toast(p.content.slice(0, 90), function () { go('inbox'); openContact(ev.userId); }, { titulo: c ? nameOf(c) : short(ev.userId), icono: 'message' }); }
      }
      if (state.view === 'inbox') loadContacts();
      if (state.view === 'today') loadToday();
    });
    // Un mensaje que no salió (o que salió al reintentarlo): la conversación abierta se vuelve a pintar con su marca.
    es.addEventListener('message_estado', function (e) {
      var ev = JSON.parse(e.data);
      if (state.current === ev.userId) openContact(ev.userId);
    });
    // Aiva dejó algo listo: si estás en esa conversación aparece sola; si no, suena y se avisa.
    es.addEventListener('propuesta', function (e) {
      var ev = JSON.parse(e.data), p = ev.payload.propuesta;
      if (state.current === ev.userId) { openContact(ev.userId); return; }
      // 🪤 La que se deja mientras la lleva una persona no suena: esa persona ya recibió el mensaje del cliente, y
      // un segundo aviso por cada pregunta es justo lo que hace que alguien apague el sonido.
      if (p && p.conPersona) return;
      beep();
      var c = state.contacts.find(function (x) { return x.id === ev.userId; });
      toast(String(p.texto || '').slice(0, 90), function () { go('inbox'); openContact(ev.userId); },
        { titulo: 'Lista para ' + (c ? nameOf(c) : short(ev.userId)), icono: 'bot' });
    });
    es.addEventListener('verification', function () { if (state.view === 'today') loadToday(); });
    es.addEventListener('contact', function () { cuentasLuego(); if (state.view === 'inbox') loadContacts(); if (state.view === 'pipeline') loadPipeline(); if (state.view === 'clientes') loadClientes(); });
    es.addEventListener('analysis', function (e) { var ev = JSON.parse(e.data); if (state.current === ev.userId) openContact(ev.userId); else if (state.view === 'inbox') loadContacts(); });
    es.addEventListener('handoff', function (e) { cuentasLuego(); var ev = JSON.parse(e.data); if (state.current === ev.userId) openContact(ev.userId); if (state.view === 'inbox') loadContacts(); if (state.view === 'today') loadToday(); });
    // 🪤 Antes esto solo refrescaba las vistas: una cita entraba, el contador se ponía en rojo y NADIE decía qué
    // se había agendado ni con quién. Quien no estuviera mirando el calendario en ese momento se enteraba de
    // casualidad. Una cita es la mejor noticia que da este sistema y era la única que no se anunciaba.
    es.addEventListener('appointment', function (e) {
      if (state.view === 'calendar') loadCalendar();
      if (state.view === 'today') loadToday();
      if (state.current) openContact(state.current);
      var ev, a;
      try { ev = JSON.parse(e.data); a = ev.payload && ev.payload.appointment; } catch (err) { return; }
      if (!a || a.status === 'cancelada') return;
      // Solo las que vienen: avisar de una cita que ya pasó —al reconstruir el historial, por ejemplo— sería
      // dar una noticia vieja como si acabara de ocurrir.
      if (a.startsAt && a.startsAt < Date.now()) return;
      var c = state.contacts.find(function (x) { return x.id === ev.userId; });
      var quien = a.contactName || (c ? nameOf(c) : short(ev.userId));
      var cuando = new Date(a.startsAt).toLocaleString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
      beep();
      toast(quien + ' · ' + cuando, function () { go('calendar'); }, { titulo: 'Cita agendada', icono: 'calendar' });
    });
    setInterval(function () { if (state.view === 'calendar' && cal.mode === 'week') renderCalendar(); }, 60000); // mueve la línea de "ahora"
    es.addEventListener('notification', function (e) {
      var ev = JSON.parse(e.data), n = ev.payload.notification;
      if (!avisoParaMi(n)) return;
      state.notifs.unshift(n); if (state.notifs.length > 100) state.notifs.pop();
      renderNotifs();
      if (n.kind === 'verify') { beep(); toast(n.body, function () { go('today'); }, { titulo: n.title, icono: 'bell' }); }
      else if (n.kind === 'propuesta') { /* ya se avisó por el evento propuesta */ }
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
      if ($('fx-biz')) $('fx-biz').textContent = me.business || 'Tu negocio';
      if ($('fx-yo-biz')) $('fx-yo-biz').textContent = me.business || '';
      if ($('fx-logo')) $('fx-logo').textContent = (me.business || 'A').trim().charAt(0).toUpperCase();
      pintarQuienSoy();
      state.bizName = me.business; state.agentName = me.agent;
      // 🪤 El asistente no siempre se llama Aiva (el de DUNOR en el paquete se llama Arthur): lo que el HTML trae escrito
      // con «Aiva» se cambia aquí, al saberse el nombre. Lo que pinta el JavaScript usa state.agentName.
      if (me.agent && $('seg-bot')) $('seg-bot').textContent = me.agent;
      state.sedes = me.sedes || [];
      // El logo del negocio en su propia barra: entrar a su tablero tiene que sentirse suyo, no de aiva.
      if (me.logo) {
        var img = document.createElement('img');
        // 🪤 Con BASE delante: servido en /dunor/admin, un "/brand/logo" pelado apuntaría a la raíz del dominio.
        img.src = /^https?:/.test(me.logo) ? me.logo : BASE + me.logo;
        img.alt = me.business; img.className = 'logo-cliente';
        img.onerror = function () { img.remove(); };
        var marca = $('marca-btn');
        if (marca) { marca.innerHTML = ''; marca.appendChild(img); }
        if ($('fx-logo')) {
          var otra = img.cloneNode(), inicial = $('fx-logo').textContent;
          otra.onerror = function () { otra.remove(); $('fx-logo').textContent = inicial; };
          $('fx-logo').textContent = ''; $('fx-logo').appendChild(otra);
        }
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
      state.stageLabels = s.stageLabels; state.stages = s.stages || []; state.moneda = s.moneda || 'COP'; state.motivosPerdida = s.motivosPerdida || [];
      state.ficha = s.ficha || null;
      // El modo que puso el cliente se recuerda para el próximo arranque: así se pinta bien desde el primer cuadro.
      state.modoCliente = s.modo === 'facil' ? 'facil' : 'completo';
      try { localStorage.setItem(LLAVE('modoCliente'), state.modoCliente); } catch (e) {}
      aplicarModo();
      etapasDelNegocio(); pintarListas(); cargarCuentas(); cargarFijados(); pintarQuienSoy(); connect(); loadNotifs(); loadCalendar();
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

      // Las sedes van aparte de las citas: dónde queda cada una sirve aunque el negocio no agende.
      '<div class="card"><h2 class="h">Sedes</h2>' +
        '<div class="small muted" style="margin-bottom:10px">Si atiende en varios sitios con este mismo número. Con dos o más, el asistente pregunta en cuál antes de ofrecer horarios y dice la dirección al confirmar. Sin sedes, es un solo sitio: el «Dónde» de las citas.</div>' +
        '<div id="n-sedes">' + (a.sedes || []).map(sedeFila).join('') + '</div>' +
        '<button class="btn sm" type="button" id="n-mas-sede">Agregar sede</button>' +
      '</div>' +

      '<div class="fila" style="gap:10px;align-items:center"><button class="btn primary" id="n-guardar">Guardar</button>' +
        '<span id="n-msg" class="small" role="status"></span></div>' +
      '<div class="small muted" style="margin-top:10px">El embudo y los datos que captura salen de cómo se dio de alta el cliente y no se cambian desde aquí: ' +
      'tocarlos en caliente dejaría fichas en etapas que ya no existen.</div>';

    $('n-citas').onchange = function () { $('n-citas-detalle').hidden = !this.checked; };
    $('n-mas-franja').onclick = function () { $('n-franjas').insertAdjacentHTML('beforeend', franja(['09:00', '13:00'])); enganchaFranjas(); };
    enganchaFranjas();
    $('n-mas-sede').onclick = function () { $('n-sedes').insertAdjacentHTML('beforeend', sedeFila(null)); enganchaSedes(); };
    enganchaSedes();
    if ($('neg-reiniciar')) $('neg-reiniciar').onclick = function () {
      this.disabled = true; this.textContent = 'Reiniciando…';
      api('/config/restart', { method: 'POST' }).catch(function () {});
      setTimeout(loadNegocio, 6000); // vuelve a preguntar cuando ya debería estar arriba
    };
    $('n-guardar').onclick = guardarNegocio;
  }

  // Una sede en el formulario. 🪤 Su id no se ve ni se edita: lo llevan las citas y la ficha, así que cambiarle el
  // nombre no puede cambiarlo. Una sede nueva lo recibe del servidor, sacado de su nombre.
  var sedeN = 0;
  function sedeFila(s) {
    s = s || { id: '', nombre: '', direccion: '', apodos: [] };
    var k = ++sedeN, ci = state.negocio.guardado.citas;
    var propio = Boolean(s.days || s.hours || s.capacity);
    var dias = s.days || ci.days, horas = s.hours || ci.hours;
    var c = function (cls, etiqueta, valor, pista) {
      return '<div class="prof-field"><div class="lbl"><label class="small" for="' + cls + '-' + k + '"><b>' + esc(etiqueta) + '</b></label></div>' +
        '<input type="text" id="' + cls + '-' + k + '" class="' + cls + '" value="' + esc(valor == null ? '' : valor) + '">' +
        (pista ? '<div class="small muted">' + esc(pista) + '</div>' : '') + '</div>';
    };
    return '<div class="sede-fila" data-id="' + esc(s.id) + '">' +
      '<div class="fila-2">' + c('s-nombre', 'Nombre', s.nombre, 'Como se le dice al cliente: «Sede Norte».') + c('s-dir', 'Dirección', s.direccion) + '</div>' +
      c('s-apodos', 'Cómo le dice la gente', (s.apodos || []).join(', '), 'Separados por comas: la del norte, alto prado.') +
      '<label class="prof-check"><input type="checkbox" class="s-propio"' + (propio ? ' checked' : '') + '> Tiene su propio horario o cupo</label>' +
      '<div class="s-horario"' + (propio ? '' : ' hidden') + '>' +
        '<div class="prof-field"><div class="lbl"><b class="small">Días que atiende</b></div><div class="dias">' +
          DIAS.map(function (x) { return '<label class="prof-check"><input type="checkbox" class="s-dia" value="' + x[1] + '"' + (dias.indexOf(x[1]) !== -1 ? ' checked' : '') + '> ' + x[0] + '</label>'; }).join('') +
        '</div></div>' +
        '<div class="prof-field"><div class="lbl"><b class="small">Franjas del día</b></div><div class="s-franjas">' + horas.map(franja).join('') + '</div>' +
          '<button class="btn sm s-mas-franja" type="button">Agregar franja</button></div>' +
        '<div class="prof-field"><div class="lbl"><label class="small" for="s-cupo-' + k + '"><b>Cuántas a la vez</b></label></div>' +
          '<input type="number" min="1" max="50" id="s-cupo-' + k + '" class="s-cupo" value="' + esc(s.capacity || ci.capacity) + '"></div>' +
      '</div>' +
      '<button class="btn sm danger s-quitar" type="button">Quitar esta sede</button>' +
    '</div>';
  }
  function enganchaSedes() {
    $('n-sedes').querySelectorAll('.sede-fila').forEach(function (f) {
      f.querySelector('.s-propio').onchange = function () { f.querySelector('.s-horario').hidden = !this.checked; };
      f.querySelector('.s-mas-franja').onclick = function () { f.querySelector('.s-franjas').insertAdjacentHTML('beforeend', franja(['09:00', '13:00'])); enganchaSedes(); };
      f.querySelectorAll('.s-franjas [data-quitar]').forEach(function (b) { b.onclick = function () { b.parentNode.remove(); }; });
      // Quitarla aquí no borra nada todavía: se aplica al guardar, y el servidor no deja si tiene citas por delante.
      f.querySelector('.s-quitar').onclick = function () { f.remove(); };
    });
  }
  function sedesDelFormulario() {
    return Array.prototype.map.call($('n-sedes').querySelectorAll('.sede-fila'), function (f) {
      var s = {
        id: f.getAttribute('data-id') || '',
        nombre: f.querySelector('.s-nombre').value.trim(),
        direccion: f.querySelector('.s-dir').value.trim(),
        apodos: f.querySelector('.s-apodos').value.split(',').map(function (x) { return x.trim(); }).filter(Boolean)
      };
      if (f.querySelector('.s-propio').checked) {
        s.days = Array.prototype.map.call(f.querySelectorAll('.s-dia:checked'), function (x) { return Number(x.value); });
        s.hours = Array.prototype.map.call(f.querySelectorAll('.s-franjas .franja'), function (x) { var e = x.querySelectorAll('input'); return [e[0].value, e[1].value]; });
        s.capacity = Number(f.querySelector('.s-cupo').value) || 1;
      }
      return s;
    });
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
      },
      sedes: sedesDelFormulario()
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
    // Lo mismo en el menú y la barra del modo fácil.
    if ($('fx-nombre')) $('fx-nombre').textContent = nombre;
    if ($('fx-yo-ini')) $('fx-yo-ini').textContent = inicialesDe(nombre);
    if ($('fx-yo-nombre')) $('fx-yo-nombre').textContent = nombre;
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
    cargarCuentas(); // «Míos» depende del nombre: con otro nombre son otras
    cargarFijados(); // y los fijados también son de ese nombre
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
          '<span class="chip">' + esc(state.agentName || 'Aiva') + ': ' + d.porQuien.aiva.n + ' · ' + duracion(d.porQuien.aiva.medianaMs) + '</span>' +
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


  // ===== XEN · Inicio: lo nuevo del agente de Inicio (lo de antes sigue en su sitio) =====
  // (fin de XEN · Inicio)

  // ===== XEN · Bandeja omnicanal: lo nuevo del agente de la bandeja =====
  // La bandeja de XENCRM, como la de un CRM de mensajería (SendPulse) y con la conversación de un cliente de
  // WhatsApp de escritorio (ZapFast): todos los canales en una lista, la insignia del canal sobre cada avatar, y al
  // lado la ficha del contacto. Lo de aquí son piezas; las pinta lo de siempre (renderRows, renderChat,
  // renderDetails), que sigue siendo el dueño de los datos.

  // Los dibujos que solo usa la bandeja. Propios, del mismo trazo que los demás (Lucide): ningún logo de marca.
  ICONS.wa = '<path d="M3.5 20.5l1.4-4.2A8.5 8.5 0 1 1 8.2 19.4z"/><path d="M9.2 8.6c.2 2.9 2.9 5.6 5.8 5.8l1.1-1.4-1.9-1.1-.8.7a4 4 0 0 1-2.4-2.4l.7-.8-1.1-1.9z"/>';
  ICONS.globo = '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z"/>';
  ICONS.lapiz = '<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/><path d="m15 5 4 4"/>';
  ICONS.pausa = '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>';
  ICONS.reanudar = '<path d="M7 4.5v15l12.5-7.5z"/>';
  ICONS['candado-nota'] = '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>';
  ICONS.instagram = '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5h.01"/>';
  ICONS.facebook = '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>';
  ICONS.leidas = '<path d="M2 12.5l4.5 4.5L15 8.5"/><path d="M11.5 16.5l.5.5L22 7"/>';
  iconos($('view-inbox'));
  /** Un dibujo ya armado, para lo que se pinta muchas veces (las filas): sin pasar después por iconos(). */
  function svgXen(nombre) {
    return '<svg class="fx-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (ICONS[nombre] || '') + '</svg>';
  }
  /** «desde hace 5 min», o «desde ahora» (no «desde hace ahora»). */
  function desdeXen(ts) { var r = rel(ts); return r === 'ahora' ? ' desde ahora' : ' desde hace ' + r; }
  function reducirMovimiento() { return Boolean(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); }
  /** Por dónde escribe, dicho con palabras y con su insignia. */
  function canalDeXen(ch) {
    if (ch === 'whatsapp' || ch === 'meta') return { k: 'wa', t: 'WhatsApp', ic: 'wa' };
    if (ch === 'web') return { k: 'web', t: 'Chat del sitio', ic: 'globo' };
    return { k: 'otro', t: canalSolo(ch) || 'Otro canal', ic: 'burbuja' };
  }
  // «Sin asignar»: sin nadie en «Asignado a» (c.responsable), que es lo que pone quien la toma si no había nadie.
  function sinAsignar(c) { return !String(c.responsable || '').trim(); }
  /**
   * El tono del avatar, el mismo siempre para el mismo nombre. Seis tonos propios (--fx-av-*), aparte de los de
   * las etapas: un avatar rojo se leería «perdido». Medidos: ≥ 6:1 en claro y ≥ 7.9:1 en oscuro.
   */
  function tonoXen(nombre) {
    var h = 0, t = String(nombre || '');
    for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
    return 1 + (h % 6);
  }
  function avatarXen(c, clase) {
    var canal = canalDeXen(c.channel);
    return '<span class="fx-av ' + (clase || '') + ' av-' + tonoXen(nameOf(c)) + '" aria-hidden="true"><span class="fx-av-ini">' + esc(inicialesDe(nameOf(c))) + '</span>' +
      '<i class="fx-canal-ins fx-canal-' + canal.k + '">' + svgXen(canal.ic) + '</i></span>';
  }
  function sinAsignarComoOpcion(sel) { var o = sel && sel.querySelector('option[value=""]'); if (o) o.textContent = 'Sin asignar'; }

  /** La cabecera de la conversación: quién es, quién responde, a quién está asignada y pausar o reanudar. */
  function pintarCabeceraXen(d) {
    var c = d.contact, agente = state.agentName || 'Aiva', canal = canalDeXen(c.channel), ini = $('fx-chat-ini');
    ini.className = 'fx-av fx-av-chat solo-facil av-' + tonoXen(nameOf(c));
    ini.innerHTML = '<span class="fx-av-ini">' + esc(inicialesDe(nameOf(c))) + '</span><i class="fx-canal-ins fx-canal-' + canal.k + '">' + svgXen(canal.ic) + '</i>';
    $('fx-chat-nombre').textContent = nameOf(c);
    var estado = c.humanMode
      ? '<span class="fx-pill humano">' + svgXen('pausa') + 'Automatización pausada · la lleva ' + esc(whoHas(c)) + '</span>'
      : '<span class="fx-pill ia">' + svgXen('chispa') + 'Responde ' + esc(agente) + '</span>';
    $('fx-chat-linea').innerHTML = estado + (d.number ? '<span>+' + esc(d.number) + '</span>' : '') + '<span>' + esc(canal.t) + '</span>';
    // El puntaje de la cabecera (solo en el completo) va debajo del nombre, no suelto en la fila de botones.
    var quien = $('fx-chat-nombre').parentNode;
    if ($('chat-temp') && $('chat-temp').parentNode !== quien) quien.appendChild($('chat-temp'));
    // Lo que se pausa es la automatización (el agente de IA): la persona sigue. Es el mismo interruptor Aiva/Tú.
    $('fx-control').innerHTML = svgXen(c.humanMode ? 'reanudar' : 'pausa') + '<span>' + (c.humanMode ? 'Reanudar' : 'Pausar') + '<span class="fx-largo"> automatización</span></span>';
    $('fx-control').setAttribute('aria-label', c.humanMode ? 'Reanudar automatización' : 'Pausar automatización');
    $('fx-control').title = c.humanMode ? agente + ' vuelve a contestar esta conversación' : agente + ' deja de contestar aquí: contestas tú';
    $('fx-control').classList.toggle('pausada', Boolean(c.humanMode));
    // «Asignado a»: el mismo dato y el mismo guardado que la ficha de al lado (c.responsable). Dos controles, un dato.
    $('fx-asignado-sel').innerHTML = responsableHtml(c, 'fx-asignado');
    $('fx-asignado').setAttribute('aria-label', 'Asignado a');
    sinAsignarComoOpcion($('fx-asignado'));
    engancharResponsable($('fx-asignado'), c, function () { openContact(c.id); loadContacts(); });
  }

  /**
   * Cómo contactarlo, con su ícono: correo, WhatsApp, Instagram, Facebook y por dónde llegó. Solo lo que hay. Los
   * enlaces y el escape son los de contactoHtml: aquí solo cambia cómo se ven.
   */
  var ICONO_MEDIO = { correo: 'correo', whatsapp: 'wa', instagram: 'instagram', facebook: 'facebook', contacto_por: 'objetivo' };
  function mediosXen(c) {
    var defs = fichaDelNegocio().contacto;
    var fila = function (etiqueta, html) {
      var x = defs.filter(function (d) { return d.etiqueta === etiqueta; })[0], k = x ? x.k : '';
      return '<li class="fx-medio"><span class="fx-medio-ic" aria-hidden="true">' + svgXen(ICONO_MEDIO[k] || 'burbuja') + '</span>' +
        (k === 'contacto_por' ? '<span class="fx-medio-k">' + esc(etiqueta) + '</span> ' : '<span class="sr-only">' + esc(etiqueta) + ': </span>') +
        '<span class="fx-medio-v">' + html + '</span></li>';
    };
    var lis = contactoHtml(c, fila) + '';
    return lis ? '<ul class="fx-medios" aria-label="Cómo contactarlo">' + lis + '</ul>' : '';
  }

  // ---------- el cajón: «Enviar mensaje» · «Nota interna» ----------
  // 🪤 La nota NO usa el cajón del mensaje: escribir en #reply toma la conversación (la automatización se pausa en
  // cuanto se escribe la primera letra). Una nota no le llega al cliente y no tiene por qué callar al agente.
  // 🪤 Lo escrito en una nota se queda con SU conversación: al pasar a otra, se guarda aparte y vuelve al volver.
  // Llevarla a la siguiente sería anotarle algo a la persona equivocada.
  var cajon = { modo: 'mensaje', notas: {}, de: null };
  function cajonDeLaConversacion(c) {
    if (cajon.de === c.id) return;
    if (cajon.de) { var v = $('fx-nota').value; if (v.trim()) cajon.notas[cajon.de] = v; else delete cajon.notas[cajon.de]; }
    cajon.de = c.id;
    $('fx-nota').value = cajon.notas[c.id] || '';
    cajon.modo = cajon.notas[c.id] ? 'nota' : 'mensaje';
  }
  function pintarCajon() {
    var nota = cajon.modo === 'nota';
    [['fx-tab-mensaje', !nota], ['fx-tab-nota', nota]].forEach(function (t) {
      var b = $(t[0]); if (!b) return;
      b.setAttribute('aria-selected', String(t[1])); b.tabIndex = t[1] ? 0 : -1; b.classList.toggle('on', t[1]);
    });
    $('composer').classList.toggle('en-nota', nota);
    $('fx-nota').hidden = !nota; $('fx-nota-ok').hidden = !nota; $('fx-nota-aviso').hidden = !nota;
    $('fx-cajon-ayuda').textContent = nota ? 'Enter guarda la nota · Shift+Enter, nueva línea' : 'Enter envía · Shift+Enter, nueva línea';
  }
  function cambiarCajon(modo, enfocar) {
    cajon.modo = modo;
    if (state.detail) setMode(state.detail.contact.humanMode); else pintarCajon();
    if (enfocar) $(modo === 'nota' ? 'fx-nota' : 'reply').focus();
  }
  $('fx-tab-mensaje').onclick = function () { cambiarCajon('mensaje', true); };
  $('fx-tab-nota').onclick = function () { cambiarCajon('nota', true); };
  // Las pestañas, con las flechas (el patrón de pestañas de siempre): una sola parada de Tab.
  [$('fx-tab-mensaje'), $('fx-tab-nota')].forEach(function (b) {
    b.onkeydown = function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
      e.preventDefault();
      var aNota = e.key === 'End' || (e.key !== 'Home' && cajon.modo === 'mensaje');
      cambiarCajon(aNota ? 'nota' : 'mensaje');
      $(aNota ? 'fx-tab-nota' : 'fx-tab-mensaje').focus();
    };
  });
  /** La nota interna va a la historia de la ficha por la misma ruta que «Guardar nota». Si falla, no se borra. */
  function guardarNotaInterna() {
    var c = state.detail && state.detail.contact;
    if (!c) return;
    var texto = $('fx-nota').value.trim();
    if (!texto) { $('fx-nota').focus(); return; }
    $('fx-nota-ok').disabled = true;
    api('/contacts/' + encodeURIComponent(c.id) + '/notas', { method: 'POST', body: { texto: texto, por: state.name || '' } }).then(function (r) {
      if (!r || r.error) { toast('No se pudo guardar la nota: ' + ((r && r.error) || 'sin respuesta')); return; }
      if (cajon.de === c.id) $('fx-nota').value = '';
      delete cajon.notas[c.id];
      if (state.detail && state.detail.contact.id === c.id) { state.detail.events = r.events || state.detail.events; renderDetails(); }
      toast('Nota guardada en la historia de ' + nameOf(c), null, { icono: 'check' });
    }).catch(function () { toast('No se pudo guardar la nota. Lo escrito sigue aquí.'); })
      .finally(function () { $('fx-nota-ok').disabled = false; });
  }
  $('fx-nota-ok').onclick = guardarNotaInterna;
  $('fx-nota').onkeydown = function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); guardarNotaInterna(); } };
  // (fin de XEN · Bandeja omnicanal)

  // ===== XEN · Contactos, ficha y tratos: lo nuevo del agente de Contactos =====
  // (fin de XEN · Contactos, ficha y tratos)

  // ===== XEN · Analítica y sentimiento: lo nuevo del agente de Analítica =====
  // (fin de XEN · Analítica y sentimiento)

  // ===== XEN · Modelos de IA: lo nuevo del agente de Modelos =====
  // (fin de XEN · Modelos de IA)

  boot();
})();

// Los botones que solo cierran su diálogo (`data-cerrar="dlg-…"`). 🪤 Iban con `onclick` escrito en la página, y la
// CSP no deja correr nada escrito en línea que no traiga su huella: con ella puesta, «Ahora no» y «Cerrar» dejaban
// de hacer nada sin decir por qué.
document.addEventListener('click', function (e) {
  var b = e.target && e.target.closest && e.target.closest('[data-cerrar]');
  var dlg = b && document.getElementById(b.getAttribute('data-cerrar'));
  if (dlg && dlg.open) dlg.close();
});
