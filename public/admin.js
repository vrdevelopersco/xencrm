/* Tablero de Xen: bandeja, pipeline, calendario, análisis, agente y conocimiento. Vanilla JS + SSE. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  // Dónde vive este tablero. Servido en la raíz, BASE queda vacío; servido en /confia/admin, BASE es "/confia".
  // Así el mismo archivo sirve para una instancia por dominio y para varias bajo un dominio compartido.
  var BASE = location.pathname.replace(/\/admin\/?$/, '');
  // Servido desde la consola: ella le pone el token a cada petición, así que aquí no hace falta ninguno. La marca
  // la inyecta la consola al pasar la página.
  var PORLACONSOLA = typeof window.XENCRM_CONSOLA === 'string';
  // 🪤 Todos los clientes viven en el MISMO dominio (XENCRM.../dunor, XENCRM.../confia), y el almacenamiento del
  // navegador es por dominio: sin separar las llaves, el nombre con el que respondes, el token y hasta el tema
  // se iban de un cliente a otro. Cada uno lleva su prefijo, que sale de su ruta.
  var QUIEN = (window.XENCRM_CONSOLA || BASE || 'raiz').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'raiz';
  var LLAVE = function (que) { return 'xencrm.admin.' + QUIEN + '.' + que; };
  // XENCRM: lo que el navegador guardó cuando esto se llamaba aiva (las llaves «aiva.…»: token, nombre, tema, la
  // última vista) se muda una vez a «xencrm.…» y se borra. Así nadie vuelve a poner su token ni pierde su tema.
  (function deAivaAXencrm() {
    try {
      var viejas = [];
      for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf('ai' + 'va.') === 0) viejas.push(k); }
      viejas.forEach(function (k) {
        var nueva = 'xencrm.' + k.slice(5);
        if (localStorage.getItem(nueva) === null) localStorage.setItem(nueva, localStorage.getItem(k));
        localStorage.removeItem(k);
      });
    } catch (e) { /* sin almacenamiento, no hay nada que mudar */ }
  })();
  // Lo que estaba guardado con la llave vieja (compartida) se muda una vez y se borra, para no dejar a nadie
  // fuera al actualizar.
  (function mudar() {
    try {
      ['token', 'name', 'theme', 'sound', 'notifSeen'].forEach(function (que) {
        var viejo = localStorage.getItem('xencrm.admin.' + que);
        if (viejo !== null && localStorage.getItem(LLAVE(que)) === null) localStorage.setItem(LLAVE(que), viejo);
      });
      ['token', 'name'].forEach(function (que) { localStorage.removeItem('xencrm.admin.' + que); });
    } catch (e) { /* sin almacenamiento, se entra como la primera vez */ }
  })();
  // ---------- las palabras del negocio (xencrm.config.json › interfaz) ----------
  // 🪤 Lo que depende del negocio no se escribe fijo: «Citas» es de una boutique, XENTRIS agenda «demos» y un taller,
  // «turnos». Llega con /me (`interfaz`); mientras tanto rigen los valores de fábrica, los mismos del esquema
  // (src/config.ts). VOC.g() hace concordar un adjetivo escrito en femenino con un nombre masculino («agendada» →
  // «agendado»), y los artículos vienen hechos (VOC.la, VOC.una…).
  var VOC = {};
  function ponerVocabulario(i) {
    var a = (i && i.agenda) || {}, s = a.singular || 'cita', p = a.plural || 'citas', m = Boolean(a.masculino);
    var may = function (x) { return x.charAt(0).toUpperCase() + x.slice(1); };
    VOC = {
      cita: s, citas: p, Cita: may(s), Citas: may(p), masculino: m,
      la: m ? 'el' : 'la', La: m ? 'El' : 'La', las: m ? 'los' : 'las', una: m ? 'un' : 'una', Ninguna: m ? 'Ningún' : 'Ninguna', otra: m ? 'otro' : 'otra',
      g: function (f) { return m ? f.replace(/as$/, 'os').replace(/a$/, 'o') : f; },
      bienvenida: (i && i.bienvenida) || 'Este es el pulso de {negocio} hoy.',
      ej: (i && i.ejemplos) || {}
    };
  }
  ponerVocabulario(null);
  /** Lo que se pintó antes de saber el vocabulario (el menú, los ejemplos de los campos fijos del HTML) se pone al día. */
  function pintarVocabulario() {
    document.querySelectorAll('#nav-fx [data-view="calendar"]').forEach(function (b) {
      var l = b.querySelector('.fx-lbl'); if (l) l.textContent = VOC.Citas; b.title = VOC.Citas;
    });
    var ej = VOC.ej || {};
    [['k-doc-titulo', ej.documento], ['k-ra-tema', ej.respuestaTema], ['k-ra-como', ej.respuestaComo], ['k-nota-titulo', ej.nota ? 'De qué se trata (ej.: ' + ej.nota + ')' : '']].forEach(function (x) {
      if (x[1] && $(x[0])) $(x[0]).placeholder = x[1];
    });
    document.querySelectorAll('[data-voc]').forEach(function (el) {
      el.textContent = el.getAttribute('data-voc').replace(/\{g:([^}]+)\}/g, function (m, f) { return VOC.g(f); }).replace(/\{(\w+)\}/g, function (m, k) { return typeof VOC[k] === 'string' ? VOC[k] : m; });
    });
    if (state.view) cabeceraFacil(state.view);
  }
  var state = { token: '', name: '', view: 'today', filter: 'all', q: '', contacts: [], current: null, detail: null, kind: 'knowledge', theme: 'light', sound: true, stageLabels: {}, stages: [], es: null, notifs: [], notifSeen: 0, detailOpen: false };
  // 🪤 Si se entró por la consola, el nombre de quien atiende sale de SU CUENTA y no del navegador: así se
  // mantiene al cambiar de equipo y no hay forma de que se cruce con el de otro cliente.
  // 🪤 Primero lo que se haya puesto PARA ESTE CLIENTE, y solo si no hay, el nombre de la cuenta. Al revés, el
  // nombre del super-admin se propagaría a todos los clientes a la vez.
  try { state.token = localStorage.getItem(LLAVE('token')) || ''; state.name = localStorage.getItem(LLAVE('name')) || (typeof window.XENCRM_QUIEN === 'string' && window.XENCRM_QUIEN) || ''; state.theme = localStorage.getItem(LLAVE('theme')) || 'light'; state.sound = localStorage.getItem(LLAVE('sound')) !== '0'; state.notifSeen = Number(localStorage.getItem(LLAVE('notifSeen')) || 0); } catch (e) {}

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
    prospecto: '<circle cx="9" cy="8" r="4"/><path d="M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1"/><path d="M19 8v6M16 11h6"/>',
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
  function channelIcon(ch) { return { whatsapp: '🟢 WhatsApp', meta: '🟢 WhatsApp', web: '🌐 Web', cli: '⌨️ CLI', mcp: '🔌 MCP', telefono: '📞 Teléfono' }[ch] || ch; }
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
  function esCaliente(c) { return abierta(c) && (c.score || 0) >= R('puntaje.caliente', 60); }
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
    if (!c.humanMode) return { nombre: state.agentName || 'Xen', es: 'asistente' };
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
    if (state.name) headers['x-xencrm-quien'] = encodeURIComponent(state.name);
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
        try { localStorage.removeItem('xencrm.consola.sesion'); localStorage.removeItem('xencrm.consola.token'); } catch (e) {}
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
  // El nombre del asistente es del cliente; el tuyo es tuyo; la consola es de XENCRM. Confundir esos tres niveles
  // costó cuatro entregas persiguiendo un nombre que se «cruzaba entre clientes». Aquí se dice en voz alta.
  var CFG_CLIENTE = [
    // Arriba de todo: es lo primero que hay que hacer con un negocio nuevo. Solo para quien administra, porque
    // cada paso lleva a una pantalla que un asesor no toca (el perfil, el catálogo, los canales).
    { view: 'guia', ic: 'check', lbl: 'Guía de inicio', soloAdmin: true },
    { view: 'profile', ic: 'store', lbl: 'Perfil del negocio' },
    { view: 'negocio', ic: 'sliders', lbl: 'El negocio' },
    { view: 'agent', ic: 'bot', lbl: 'El asistente', soloCompleto: true },
    // Qué proveedores de IA están conectados y cuál hace cada rol. Solo quien administra XENCRM: decide a quién se
    // le factura, y la consola cierra `motores/` a los demás (consola.ts, SOLO_SUPER).
    { view: 'modelos', ic: 'chispa', lbl: 'Modelos de IA', soloSuper: true },
    // Cada umbral que decide algo de negocio, en un solo sitio (src/reglas.ts). Es de quien administra: el candado y la
    // consola cierran el cambio a los demás.
    { view: 'reglas', ic: 'sliders', lbl: 'Reglas y umbrales', soloAdmin: true },
    // Las reglas de Mantenimientos y actualizaciones (Servicio): las ve quien administra, las cambia el super-admin.
    { view: 'cfg-mantenimientos', ic: 'llave', lbl: 'Mantenimientos y actualizaciones', soloAdmin: true },
    // XEN · Tickets y SLA: planes, prioridades, tipos, estados, objetivos y reglas del SLA (crm/tickets.ts).
    { view: 'cfg-sla', ic: 'ticket', lbl: 'SLA y tickets', soloAdmin: true },
    { view: 'channels', ic: 'plug', lbl: 'Canales' },
    { view: 'knowledge', ic: 'book', lbl: 'Lo que sabe' },
    // 🪤 Solo para quien administra, y es por RUIDO, no por secreto. Quien atiende todo el día no necesita ver
    // llamadas al modelo ni centavos en cada pantalla; mezclarlo con lo del día a día hace que se deje de leer
    // todo. Quien entra con el token a secas lo ve igual: con ese token puede llamar a la ruta directamente, y
    // esconder un botón no protege nada — creerse protegido por eso sí hace daño.
    { view: 'trazas', ic: 'chart', lbl: 'Trazabilidad', soloAdmin: true, soloCompleto: true },
    // Cómo entra todo el equipo. Lo decide quien administra XENCRM y nadie más: es el candado (ver «modo fácil»).
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
  function rolDeQuienEntro() { return typeof window.XENCRM_ROL === 'string' ? window.XENCRM_ROL : ''; }
  function esAdmin() {
    var r = rolDeQuienEntro();
    return !r || r === 'super' || r === 'admin';
  }
  /** Quién manda en el modo fácil: quien administra XENCRM, o el token a secas. La misma regla que channels/candado.ts. */
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
    // De xencrm: solo tiene sentido si entró por la consola, que es de quien la maneja.
    if (window.XENCRM_CONSOLA) {
      pop.appendChild(grupo('Organización', 'xencrm'));
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
  // DUNOR pidió un XENCRM «sencillo de usar», y XENCRM es mucho más que eso. El modo fácil ESCONDE lo que no es del día
  // a día —el puntaje y su porqué, Análisis, Seguimientos, la configuración del asistente, las trazas, los filtros
  // de más— y no quita nada: lo escondido lleva la clase `solo-completo` y vuelve con un clic. Es la regla de
  // siempre (sencillo por fuera, todo a un clic adentro), con un interruptor en vez de un nivel más de menú.
  //
  // Dos interruptores, y los dos son de quien administra xencrm: el del cliente (cómo entra todo su equipo, vive en su
  // base) y el suyo (cómo lo ve él, en su navegador, para revisar lo avanzado sin sacar a nadie del modo).
  //
  // 🪤 El CANDADO. Con el modo fácil puesto, nadie más se sale de él: ni el admin del cliente. DUNOR lo pidió así
  // —un XENCRM sencillo del que nadie de su lado se salga sin querer—, y por eso quien no manda no tiene interruptor
  // propio y tampoco ve la configuración del cliente. El servidor cumple la misma regla (channels/candado.ts):
  // aquí solo se dejan de enseñar puertas que allá no abren.
  //
  // 🪤 Analítica, Ventas y Seguimientos SÍ van en el modo fácil. Primero no iban —parecían lo avanzado—, pero DUNOR
  // mandó la muestra de cómo lo quería (Nexora) y las tres están en su menú: son del que vende, no del que
  // administra XENCRM. El servidor las abre igual (channels/candado.ts).
  var SOLO_COMPLETO_VISTAS = { agent: 1, trazas: 1 };
  var VISTAS_DE_QUIEN_ADMINISTRA = { guia: 1, profile: 1, negocio: 1, agent: 1, channels: 1, knowledge: 1, trazas: 1, modelos: 1, reglas: 1, 'cfg-mantenimientos': 1, 'cfg-sla': 1 };
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
  var CFG_VIEWS = { guia: 1, profile: 1, negocio: 1, agent: 1, channels: 1, knowledge: 1, help: 1, trazas: 1, modelos: 1, reglas: 1, 'cfg-mantenimientos': 1, 'cfg-sla': 1 };
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
      xcfgArmar(cfg, CFG_CLIENTE.concat([{ view: 'help', ic: 'help', lbl: 'Ayuda' }]).filter(visiblePara));
      iconos(cfg);
    }
    cfg.querySelectorAll('[data-view]').forEach(function (b) { var si = b.getAttribute('data-view') === view; b.classList.toggle('active', si); if (si) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    aplicarModo(); // los interruptores de aquí nacen tarde: que digan cómo están
  }

  // ---------- las áreas y sus pestañas ----------
  // 🪤 El riel tenía ocho secciones y la mitad eran la misma gente vista de otra forma (Prospectos, Clientes,
  // Seguimientos) o los mismos números (Análisis, Ventas). Para quien empieza eran ocho puertas sin saber cuál
  // abrir. Ahora son áreas: el riel lleva al área y arriba de la pantalla van sus pestañas. Nada se quitó, quedó
  // un clic más adentro: quien quiera exprimir XENCRM lo encuentra donde estaba.
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

  // ---------- el mapa del sitio, como el de Dynamics 365 ----------
  // XENCRM se ordena como una suite de CRM (Dynamics 365 Sales): arriba lo reciente y lo fijado, y debajo las
  // pantallas en cuatro grupos —Mi trabajo, Clientes, Ventas, Rendimiento—. Abajo, el cambio de ÁREA: «Ventas» es el
  // día a día y «Configuración» trae su propio mapa (lo que antes solo vivía en el engranaje). Cada pantalla tiene
  // su puerta, sin pestañas adentro, y el vocabulario es el de un CRM de mensajería (docs/xencrm.md).
  //
  // 🪤 Las dos áreas se arman UNA vez y se alternan con [hidden]: si se volvieran a pintar, los contadores del menú
  // (Bandeja, Citas) quedarían en blanco hasta el próximo aviso. Solo la de Configuración se rehace al abrirla,
  // porque lo que se ve allí depende de quién entró (soloAdmin, soloSuper, el candado) y no lleva contadores.
  ICONS.estrella = '<path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5-4.8-4.6 6.6-.9z"/>';
  ICONS.rayo = '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>';
  ICONS.fijado = '<path d="M9 4h6l-1 6 3 3H7l3-3z"/><path d="M12 13v8"/>';
  ICONS.reciente = '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>';
  ICONS.menu = '<path d="M4 6h16M4 12h16M4 18h16"/>';
  ICONS.ticket = '<path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z"/><path d="M13 6v12" stroke-dasharray="2 2"/>';
  ICONS.llave = '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>';
  ICONS.areas = '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M17.5 14v7M14 17.5h7"/>';
  var MENU_FACIL = [
    { grupo: 'Mi trabajo', items: [{ view: 'today', lbl: 'Inicio', ic: 'inicio' }, { view: 'inbox', lbl: 'Bandeja omnicanal', ic: 'inbox', n: 'fx-n-inbox' }, { view: 'seguimientos', lbl: 'Lista de trabajo', ic: 'volver' }, { view: 'calendar', get lbl() { return VOC.Citas; }, ic: 'citas', n: 'fx-n-citas' }] },
    { grupo: 'Clientes', items: [{ view: 'clientes', lbl: 'Contactos', ic: 'contacto' }, { view: 'kam', lbl: 'Cuentas clave', ic: 'estrella' }] },
    { grupo: 'Ventas', items: [{ view: 'prospectos', lbl: 'Prospectos', ic: 'prospecto', n: 'fx-n-prospectos' }, { view: 'embudo', lbl: 'Embudo', ic: 'embudo' }, { view: 'pipeline', lbl: 'Tratos', ic: 'kanban' }, { view: 'ventas', lbl: 'Ventas', ic: 'dolar' }] },
    { grupo: 'Rendimiento', items: [{ view: 'kpis', lbl: 'KPIs y metas', ic: 'objetivo' }, { view: 'optimizacion', lbl: 'Optimización de ventas', ic: 'rayo' }, { view: 'analysis', lbl: 'Analítica', ic: 'analitica' }] }
  ];
  /**
   * Servicio, como Dynamics 365 Customer Service: lo que se le debe a quien ya es cliente (sus tickets, el SLA de su
   * plan, los mantenimientos y las actualizaciones). La Bandeja y los Contactos también están aquí: el soporte entra
   * por la misma bandeja. Sin contadores (sus id son de Ventas: repetirlos rompería getElementById).
   */
  var MENU_SERVICIO = [
    { grupo: 'Mi trabajo', items: [{ view: 'inbox', lbl: 'Bandeja omnicanal', ic: 'inbox' }, { view: 'tickets', lbl: 'Tickets', ic: 'ticket' }] },
    { grupo: 'Clientes', items: [{ view: 'clientes', lbl: 'Contactos', ic: 'contacto' }, { view: 'kam', lbl: 'Cuentas clave', ic: 'estrella' }] },
    { grupo: 'Servicio', items: [{ view: 'sla', lbl: 'SLA', ic: 'escudo' }, { view: 'mantenimientos', lbl: 'Mantenimientos y actualizaciones', ic: 'llave' }] }
  ];
  /** Las áreas de la suite. Configuración no lleva lista fija: sale de CFG_CLIENTE según quién entró. */
  var AREAS_SUITE = [
    { id: 'ventas', lbl: 'Ventas', ic: 'kanban', dice: 'Contactos, tratos y rendimiento', inicio: 'today' },
    { id: 'servicio', lbl: 'Servicio', ic: 'escudo', dice: 'Tickets, SLA y mantenimientos', inicio: 'tickets' },
    { id: 'config', lbl: 'Configuración', ic: 'sliders', dice: 'El negocio, el asistente y los canales' }
  ];
  var VISTAS_DE_AREA = { ventas: {}, servicio: {} };
  MENU_FACIL.forEach(function (g) { g.items.forEach(function (x) { VISTAS_DE_AREA.ventas[x.view] = 1; }); });
  MENU_SERVICIO.forEach(function (g) { g.items.forEach(function (x) { VISTAS_DE_AREA.servicio[x.view] = 1; }); });
  /**
   * En qué área vive cada pantalla. Si la que se abre está también en el área de ahora (la Bandeja, Contactos), se
   * queda en ella: cambiar de área por abrir la Bandeja desde Servicio desorientaría.
   */
  function areaDeVista(view) {
    if (CFG_VIEWS[view]) return 'config';
    if (state.area !== 'config' && VISTAS_DE_AREA[state.area] && VISTAS_DE_AREA[state.area][view]) return state.area;
    return VISTAS_DE_AREA.servicio[view] && !VISTAS_DE_AREA.ventas[view] ? 'servicio' : 'ventas';
  }
  state.area = 'ventas';
  // 🪤 Va aquí arriba y no junto a pintarRecientes: armarMenuFacil() corre en cuanto se define, y una `var` de más
  // abajo todavía valdría undefined (el arranque se caía entero).
  var mapaAbierto = { recientes: false, fijados: true };
  function itemMapa(x) {
    return '<li><button class="fx-item" data-view="' + x.view + '" title="' + esc(x.lbl) + '"><i class="ic" data-ic="' + x.ic + '"></i><span class="fx-lbl">' + esc(x.lbl) + '</span>' +
      (x.n ? '<span class="fx-n" id="' + x.n + '"></span>' : '') + '</button></li>';
  }
  function armarMenuFacil() {
    var nav = $('nav-fx');
    if (!nav) return;
    nav.innerHTML =
      '<div class="mapa-area" data-area="ventas">' +
        // Recientes y Fijados: lo que uno estaba mirando, a un clic. Se pliegan como en Dynamics.
        '<div class="mapa-plegable" id="mapa-recientes"></div><div class="mapa-plegable" id="mapa-fijados"></div>' +
        MENU_FACIL.map(function (g) { return '<div class="fx-grupo">' + esc(g.grupo) + '</div><ul>' + g.items.map(itemMapa).join('') + '</ul>'; }).join('') +
      '</div>' +
      '<div class="mapa-area" data-area="servicio" hidden>' +
        MENU_SERVICIO.map(function (g) { return '<div class="fx-grupo">' + esc(g.grupo) + '</div><ul>' + g.items.map(itemMapa).join('') + '</ul>'; }).join('') +
      '</div>' +
      '<div class="mapa-area" data-area="config" hidden></div>';
    iconos(nav);
    nav.querySelectorAll('[data-view]').forEach(function (b) { b.onclick = function () { go(b.getAttribute('data-view')); }; });
    pintarRecientes();
  }
  armarMenuFacil();
  /** El mapa de Configuración: los mismos destinos del engranaje, con sus mismos filtros (quién entró, el candado). */
  function armarMapaConfig() {
    var caja = document.querySelector('#nav-fx [data-area="config"]');
    if (!caja) return;
    var vis = CFG_CLIENTE.concat([{ view: 'help', ic: 'help', lbl: 'Ayuda' }]).filter(visiblePara).filter(function (d) { return d.view; });
    var grupos = [
      { grupo: 'El negocio', vistas: { guia: 1, profile: 1, negocio: 1 } },
      { grupo: 'El asistente y la IA', vistas: { agent: 1, modelos: 1, knowledge: 1 } },
      { grupo: 'Canales', vistas: { channels: 1 } },
      { grupo: 'Servicio', vistas: { 'cfg-sla': 1, 'cfg-mantenimientos': 1 } },
      { grupo: 'Sistema', vistas: { reglas: 1, trazas: 1, help: 1 } }
    ];
    var usadas = {};
    var html = grupos.map(function (g) {
      var items = vis.filter(function (d) { return g.vistas[d.view]; });
      items.forEach(function (d) { usadas[d.view] = 1; });
      return items.length ? '<div class="fx-grupo">' + esc(g.grupo) + '</div><ul>' + items.map(function (d) { return itemMapa({ view: d.view, lbl: d.lbl, ic: d.ic }); }).join('') + '</ul>' : '';
    }).join('');
    var otras = vis.filter(function (d) { return !usadas[d.view]; });
    if (otras.length) html += '<div class="fx-grupo">Más</div><ul>' + otras.map(function (d) { return itemMapa({ view: d.view, lbl: d.lbl, ic: d.ic }); }).join('') + '</ul>';
    caja.innerHTML = html || '<p class="mapa-nada">Lo de configuración lo maneja quien administra XENCRM.</p>';
    iconos(caja);
    caja.querySelectorAll('[data-view]').forEach(function (b) {
      b.onclick = function () { go(b.getAttribute('data-view')); };
      b.classList.toggle('active', b.getAttribute('data-view') === state.view);
    });
  }
  /** Cambiar de área: se alternan los mapas; el de Configuración se rehace con lo que hoy puede ver quien entró. */
  function ponerArea(id) {
    state.area = id;
    var nav = $('nav-fx');
    if (!nav) return;
    if (id === 'config') armarMapaConfig();
    nav.querySelectorAll('.mapa-area').forEach(function (a) { a.hidden = a.getAttribute('data-area') !== id; });
    var ar = AREAS_SUITE.filter(function (x) { return x.id === id; })[0] || AREAS_SUITE[0];
    if ($('area-btn')) {
      $('area-btn').innerHTML = '<i class="ic" data-ic="' + ar.ic + '"></i><span class="fx-lbl"><small>Área</small><b>' + esc(ar.lbl) + '</b></span><i class="ic fx-flecha" data-ic="abajo"></i>';
      $('area-btn').title = 'Área: ' + ar.lbl + '. Cambiar de área';
      iconos($('area-btn'));
    }
    xcfgRiel(id);
  }
  (function armarCambioDeArea() {
    var b = $('area-btn'), pop = $('area-pop');
    if (!b || !pop) return;
    pop.innerHTML = AREAS_SUITE.map(function (a) {
      return '<button type="button" role="menuitemradio" data-area="' + a.id + '"><i class="ic" data-ic="' + a.ic + '"></i><span><b>' + esc(a.lbl) + '</b><small>' + esc(a.dice) + '</small></span></button>';
    }).join('');
    iconos(pop);
    function cerrar(devolver) { pop.hidden = true; b.setAttribute('aria-expanded', 'false'); if (devolver) b.focus(); }
    b.onclick = function (e) {
      e.stopPropagation();
      var abrir = pop.hidden;
      pop.hidden = !abrir;
      b.setAttribute('aria-expanded', String(abrir));
      pop.querySelectorAll('[data-area]').forEach(function (x) { x.setAttribute('aria-checked', String(x.getAttribute('data-area') === state.area)); });
      if (abrir) { var on = pop.querySelector('[aria-checked="true"]') || pop.querySelector('button'); if (on) on.focus(); }
    };
    pop.querySelectorAll('[data-area]').forEach(function (x) {
      x.onclick = function () {
        var id = x.getAttribute('data-area');
        cerrar(false);
        ponerArea(id);
        // Al entrar a un área se abre su primera pantalla, como en Dynamics; volver a Ventas lleva a Inicio.
        // Servicio abre en Tickets (no en la Bandeja, que comparte con Ventas).
        var area = AREAS_SUITE.filter(function (x) { return x.id === id; })[0] || {};
        var primera = document.querySelector('#nav-fx [data-area="' + id + '"] [data-view]');
        var destino = area.inicio || (primera && primera.getAttribute('data-view'));
        if (destino && !(VISTAS_DE_AREA[id] && VISTAS_DE_AREA[id][state.view]) && !(id === 'config' && CFG_VIEWS[state.view])) go(destino);
      };
    });
    document.addEventListener('click', function (e) { if (!pop.hidden && !pop.contains(e.target) && e.target !== b) cerrar(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !pop.hidden) cerrar(true); });
    ponerArea('ventas');
  })();
  // El menú contraído: solo íconos (con su nombre en el title), como el ≡ de Dynamics. Es comodidad de cada quien.
  (function armarContraer() {
    var b = $('mapa-contraer');
    if (!b) return;
    // 🪤 Su ícono (≡) se define aquí arriba, después de la primera pasada de iconos(): sin esto el botón salía vacío.
    iconos(b);
    function poner(corto) {
      document.querySelector('.app').setAttribute('data-mapa', corto ? 'corto' : 'largo');
      b.setAttribute('aria-pressed', String(corto));
      b.setAttribute('aria-label', corto ? 'Mostrar el menú completo' : 'Contraer el menú');
      b.title = b.getAttribute('aria-label');
    }
    var corto = false;
    try { corto = localStorage.getItem(LLAVE('mapa')) === 'corto'; } catch (e) {}
    poner(corto);
    b.onclick = function () {
      corto = !corto;
      poner(corto);
      try { localStorage.setItem(LLAVE('mapa'), corto ? 'corto' : 'largo'); } catch (e) {}
    };
  })();
  // Recientes: las últimas fichas y conversaciones abiertas, de quien mira (en su navegador). Fijados: los de siempre.
  function recientes() { try { return JSON.parse(localStorage.getItem(LLAVE('recientes')) || '[]') || []; } catch (e) { return []; } }
  function recordarReciente(c) {
    if (!c || !c.id) return;
    var l = recientes().filter(function (x) { return x.id !== c.id; });
    l.unshift({ id: c.id, nombre: nameOf(c) });
    try { localStorage.setItem(LLAVE('recientes'), JSON.stringify(l.slice(0, 6))); } catch (e) {}
    pintarRecientes();
  }
  function pintarRecientes() {
    [['mapa-recientes', 'recientes', 'Recientes', 'reciente', recientes()], ['mapa-fijados', 'fijados', 'Fijados', 'fijado', typeof fijados === 'function' ? fijados() : []]].forEach(function (m) {
      var caja = $(m[0]);
      if (!caja) return;
      var lista = m[4] || [], abierto = mapaAbierto[m[1]];
      if (!lista.length) { caja.innerHTML = ''; caja.hidden = true; return; }
      caja.hidden = false;
      caja.innerHTML = '<button class="fx-item mapa-pliegue" type="button" aria-expanded="' + abierto + '" title="' + m[2] + '"><i class="ic" data-ic="' + m[3] + '"></i><span class="fx-lbl">' + m[2] + '</span><i class="ic mapa-chev" data-ic="derecha"></i></button>' +
        '<ul class="mapa-sub"' + (abierto ? '' : ' hidden') + '>' + lista.map(function (x) {
          return '<li><button type="button" class="mapa-persona" data-persona="' + esc(x.id) + '" title="' + esc(x.nombre) + '"><span class="mapa-ini" aria-hidden="true">' + esc(inicialesDe(x.nombre)) + '</span><span class="fx-lbl">' + esc(x.nombre) + '</span></button></li>';
        }).join('') + '</ul>';
      iconos(caja);
      caja.querySelector('.mapa-pliegue').onclick = function () { mapaAbierto[m[1]] = !mapaAbierto[m[1]]; pintarRecientes(); };
      caja.querySelectorAll('[data-persona]').forEach(function (b) { b.onclick = function () { abrirPerfil(b.getAttribute('data-persona'), lista.map(function (x) { return x.id; })); }; });
    });
  }
  /**
   * Cada pantalla nueva se carga sola al abrirse: alAbrir('kpis', cargarKpis). go() avisa con el evento
   * «xen:vista» al terminar, así una pantalla nueva no necesita tocar go().
   */
  function alAbrir(view, fn) { document.addEventListener('xen:vista', function (e) { if (e.detail && e.detail.view === view) fn(e.detail); }); }
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
      today: [saludo() + (nombre ? ', ' + nombre : ''), VOC.bienvenida.replace(/\{negocio\}/g, biz)],
      analysis: ['Analítica', 'Cómo llega la gente, a qué horas escribe y cuánto se tarda en contestar.'],
      clientes: ['Contactos', 'Todas las personas que han hablado con ' + biz + '.'],
      calendar: [VOC.Citas, 'La agenda de ' + biz + ': haz clic en un hueco libre para agendar ' + VOC.una + ' ' + VOC.cita + '.'],
      pipeline: ['Tratos', 'Cada contacto en su etapa del embudo: arrastra la tarjeta o usa «Mover…».'],
      ventas: ['Ventas', 'Lo que se vendió y lo que se perdió, con el porqué.'],
      seguimientos: ['Lista de trabajo', 'A quién escribirle hoy y por qué: el siguiente paso de cada trato, en orden.'],
      embudo: ['Embudo', 'Cuántos tratos hay en cada etapa, cuánto valen y dónde se quedan.'],
      kam: ['Cuentas clave', 'Los clientes que más importan: quién los lleva, cómo están y qué sigue.'],
      kpis: ['KPIs y metas', 'Cómo va el negocio contra sus metas, y cada quien del equipo.'],
      optimizacion: ['Optimización de ventas', 'Dónde se pierden ventas y qué hacer distinto, con los datos de verdad.'],
      tickets: ['Tickets', 'Lo que reportan los clientes, con el reloj de su SLA corriendo.'],
      prospectos: ['Prospectos', 'Quienes dejaron sus datos para que les escribas. Atiéndelos antes de que se enfríen.'],
      sla: ['SLA', 'Si se está cumpliendo lo prometido a cada plan: respuesta, solución, actualizaciones y mantenimientos.'],
      mantenimientos: ['Mantenimientos y actualizaciones', 'Lo que se va a tocar, a quién afecta y si se avisó a tiempo.'],
      'cfg-mantenimientos': ['Mantenimientos y actualizaciones', 'Las reglas: el aviso de cada plan, la cadencia de cada aplicación, a quién se avisa y con qué texto.'],
      modelos: ['Modelos de IA', 'Conecta los proveedores de IA y elige cuál hace cada cosa.'],
      reglas: ['Reglas y umbrales', 'Cada número que decide algo: cuándo es caliente, cuánto aguanta una cuenta clave, desde cuándo preocupa.'],
      negocio: ['El negocio', 'Cómo se llama, cómo habla el asistente y cómo agenda.'],
      profile: ['Perfil del negocio', 'Contacto, horario, dirección, pagos y políticas: lo que el asistente dice de tu negocio.'],
      'cfg-sla': ['SLA y tickets', 'Los planes, las prioridades, los estados y los tiempos que se le prometen a cada cliente.'],
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
      if (state.view !== view && !VISTAS_DE_QUIEN_ADMINISTRA[state.view]) { toast('Eso lo maneja quien administra XENCRM.'); return; }
      view = 'today';
    }
    // Perfil y El negocio no son pantallas: son configuración, y se abren en un modal encima de lo que estabas
    // haciendo. Así no se pierde de vista la conversación ni hay que volver a navegar.
    // El negocio y Perfil ya no se abren en un diálogo: son pantallas como las demás (XEN · Configuración en dos paneles).
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
    // En Dynamics, abrir una pantalla de otra área cambia de área: así lo elegido siempre se ve marcado en el menú.
    if (areaDeVista(view) !== state.area) ponerArea(areaDeVista(view));
    else if (state.area === 'config') armarMapaConfig();
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
    try { document.dispatchEvent(new CustomEvent('xen:vista', { detail: { view: view } })); } catch (e) { /* un navegador sin CustomEvent: las pantallas nuevas no cargan solas */ }
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
      if (state.filter === 'hot') list = list.filter(function (c) { return c.score >= R('puntaje.caliente', 60) || rol(c.stage) === 'cita'; });
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
        ? '<span class="snip hit"><span class="who">' + esc(c.hit.role === 'user' ? nameOf(c) : state.agentName || 'Xen') + ':</span> ' + mark(c.hit.content, state.q) + '</span>'
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
    if (rol(c.stage) === 'cita') return { label: 'Prospecto con ' + VOC.cita, cls: 'v-cita', why: 'Ya tiene ' + VOC.una + ' ' + VOC.cita + ' ' + VOC.g('agendada') + '.' };
    if (c.score >= R('puntaje.caliente', 60)) return { label: 'Prospecto claro', cls: 'v-si', why: topFactor(c) };
    if (c.score >= R('puntaje.tibio', 30)) return { label: 'Posible prospecto', cls: 'v-posible', why: topFactor(c) };
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
      recordarReciente(d.contact);
      anunciarme(id, d.presentes || []);
      // ¿Otra ficha de la misma persona? Se guarda para que el panel no la pierda al volver a pintarse.
      api('/contacts/' + encodeURIComponent(id) + '/duplicates').then(function (l) { state.dups = { id: id, list: l }; renderDuplicates(l); avisoDeLlamada(); });
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
  // El teléfono (src/voz/telefono.ts): a una llamada no se le escribe. En vez del cajón, cómo seguirle: su otra
  // conversación (WhatsApp, el chat del sitio) si el CRM ya la conoce por el número, o su WhatsApp directo.
  function avisoDeLlamada() {
    var d = state.detail, c = d && d.contact;
    var porTelefono = Boolean(c && c.channel === 'telefono');
    $('composer').classList.toggle('sin-texto', porTelefono);
    if (!porTelefono) return;
    var otra = state.dups && state.dups.id === c.id ? (state.dups.list || [])[0] : null;
    var num = String(c.phone || '').replace(/\D/g, '');
    $('window-warn').hidden = false;
    $('window-warn').innerHTML = 'Esta conversación es de una llamada: por aquí no se le puede escribir. ' +
      (otra ? '<button type="button" class="btn sm" id="tel-otra">Abrir su conversación de ' + esc(canalSolo(otra.contact.channel)) + '</button>'
        : num ? '<a class="btn sm" target="_blank" rel="noopener noreferrer" href="https://wa.me/' + esc(num) + '">Escribirle por WhatsApp</a>' : '');
    if ($('tel-otra')) $('tel-otra').onclick = function () { openContact(otra.contact.id); };
  }
  function renderChat() {
    var d = state.detail; if (!d) return;
    var c = d.contact;
    var note = windowNote(d.replyWindow);
    $('window-warn').hidden = !note; $('window-warn').textContent = note;
    avisoDeLlamada();
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
    // 🪤 Primero lo que ya estaba conversado antes de que XENCRM entrara. Sin esto, el tablero enseñaba media
    // conversación —lo que escribió el cliente y ninguna respuesta— mientras el asistente sí tenía el contexto
    // entero y contestaba con él. Ver una sola voz da la sensación de que el producto perdió lo que el negocio
    // ya había escrito, que es lo contrario de lo que pasa.
    var antes = d.antes || [];
    m.innerHTML = (antes.length
      ? '<div class="sysline">Lo que ya estaba conversado antes de XENCRM · ' + antes.length + ' mensaje' + (antes.length === 1 ? '' : 's') + '</div>'
        + antes.map(burbujaDeAntes).join('')
        + '<div class="sysline">Desde aquí lo lleva ' + esc(state.agentName || 'Xen') + '</div>'
      : '') + d.messages.map(bubble).join('');
    if (c.humanMode) m.insertAdjacentHTML('beforeend', '<div class="sysline">' + esc(state.agentName || 'Xen') + ' está en pausa: esta conversación la lleva ' + esc(whoHas(c)) + (c.humanSince ? desdeXen(c.humanSince) : '') + '.</div>');
    pintarAdjuntos(m);
    m.scrollTop = m.scrollHeight;
  }
  // Lo traído del historial se pinta igual pero apagado: es conversación de verdad, pero no pasó por aquí y no
  // se puede responder a ella. Que se vea distinto evita que alguien crea que XENCRM contestó eso.
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
    // Lo del asistente, con el nombre del agente que lo dijo si hay varios (msg.by); si no, el del negocio.
    var label = who === 'customer' ? 'Cliente' : who === 'human' ? (msg.by ? esc(msg.by) + ' (equipo)' : 'Equipo') : esc(msg.by || state.agentName || 'Xen');
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
      get cita_inventada() { return 'daba por hecha ' + VOC.una + ' ' + VOC.cita + ' que no existe'; },
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
  // ---------- lo que XENCRM dejó listo ----------
  var propuestaActual = null;
  function pintarPropuesta(p) {
    propuestaActual = p || null;
    var caja = $('propuesta');
    if (!caja) return;
    caja.hidden = !p;
    if (!p) return;
    caja.classList.toggle('vieja', Boolean(p.vieja));
    // La que se dejó mientras la llevabas tú no es «la respuesta»: es una ayuda que puedes usar o no.
    $('propuesta-titulo').textContent = p.vieja ? 'Esta respuesta se quedó atrás' : p.conPersona ? (state.agentName || 'Xen') + ' puede contestar esto' : 'Respuesta lista';
    // 🪤 Si llegó algo después de redactarla, ya no contesta a lo último que dijeron. Mandarla de un toque
    // sería peor que no tener el modo: el cliente recibiría una respuesta a una pregunta que ya cambió.
    $('propuesta-meta').textContent = p.vieja
      ? 'escribió otra vez después · léela antes de mandarla'
      : esc(state.agentName || 'Xen') + ' la escribió hace ' + rel(p.creado);
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
    // 🪤 El cajón de escribir ya no se esconde cuando contesta XENCRM. Estaba escondido, así que para tomar una
    // conversación había que acordarse de mover un interruptor ANTES de tener nada que decir — y lo natural es
    // al revés: uno empieza a escribir. Ahora escribir es la señal, como contestar desde el teléfono.
    $('composer-hint').hidden = human;
    $('composer-hint').innerHTML = 'Responde ' + esc(state.agentName || 'Xen') + '. <b>Si escribes aquí, la automatización se pausa</b> en esta conversación.';
    $('reply').hidden = false; $('send').hidden = !human;
    // 🪤 El botón de adjuntar solo donde el canal sabe entregarlo. Ofrecerlo en el chat del sitio sería prometer
    // algo que no pasa: el archivo quedaría en la conversación y el cliente no lo recibiría nunca.
    $('adj-btn').hidden = !human || !(state.detail && state.detail.llevaArchivos);
    $('reply').placeholder = human ? 'Escribe tu respuesta… (Enter envía, Shift+Enter salto)' : 'Escribe para tomar esta conversación…';
    if (human) $('reply').focus();
    pintarCajon();
  }
  // En cuanto se escribe la primera letra, XENCRM se hace a un lado. No al enviar: mientras uno piensa la
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
        toast('Tomaste esta conversación: ' + (state.agentName || 'Xen') + ' se queda callada aquí');
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
        method: 'POST', headers: state.name ? { 'x-admin-token': state.token, 'x-xencrm-quien': encodeURIComponent(state.name) } : { 'x-admin-token': state.token }, body: fd,
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
      $('dup-msg').innerHTML = 'Se conserva <b>' + esc(keepName) + '</b> (donde escribió más recientemente) y se le suman la conversación, ' + VOC.las + ' ' + VOC.citas + ' y el análisis de la otra. No se puede deshacer.' +
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
      $('del-msg').innerHTML = 'Se borra la ficha de <b>' + esc(nameOf(c)) + '</b> con su conversación, sus ' + VOC.citas + ' y su análisis. No se puede deshacer.' +
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
    var appts = d.appointments.map(function (a) { return '<div class="appt ' + a.status + '"><span class="t">' + esc(a.label || '') + '</span><span class="grow small muted">' + esc(a.service) + ' · ' + esc(estadoCita(a.status)) + '</span></div>'; }).join('') || '<span class="muted small">Sin ' + esc(VOC.citas) + '.</span>';
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
      (h.amago ? '<div class="pf-amago">⚠ Se le fue una venta: tuvo ' + VOC.cita + ' y no acabó en compra, y no tiene ' + VOC.otra + ' ' + VOC.g('agendada') + '.</div>' : '') +
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
      '<div><h3>' + VOC.Citas + '</h3>' + appts + '</div>' +
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
  // Borrador para retomar a un prospecto caliente: solo con lo que él mismo dijo (el producto o servicio que le
  // interesa y, si lo hay, para qué). Sin precios ni fechas inventadas, y queda en el cajón de escribir para que la
  // persona lo ajuste antes de enviarlo. Sirve para cualquier negocio: toma el primer dato que exista de los que
  // suelen nombrar lo que se busca (producto en una firma de software, servicio o prenda en una tienda).
  // XENCRM: lo que se ofrece al final es lo que el negocio agenda (su `appointments.service`), no «una cita» a secas.
  function followupDraft(c) {
    // 🪤 Del nombre de verdad, no de nameOf: sin nombre, nameOf dice «Visitante del sitio» y el borrador saldría
    // «Hola Visitante 🙂».
    var d = c.data || {}, first = (c.name || '').trim().split(' ')[0], biz = state.bizName ? ' de ' + state.bizName : '';
    var tema = (d.producto || d.servicio || d.prenda || '').toString().replace(/\s*\(.*?\)/g, '').trim();
    var paraQue = (d.ocasion || '').toString().replace(/\s*\(.*?\)/g, '').trim();
    var asunto = tema ? 'lo de ' + tema + (paraQue ? ' para tu ' + paraQue : '') : 'lo que hablamos' + (paraQue ? ' para tu ' + paraQue : '');
    var agendar = state.agendaQue ? 'agendamos ' + (/^(un|una|el|la)\s/i.test(state.agendaQue) ? '' : 'la ') + state.agendaQue : 'lo vemos juntos';
    return 'Hola' + (first && !/^(web|wa|meta|cli|mcp)$/.test(first) ? ' ' + first : '') + ' 🙂 Te escribo' + biz + ' para saber si seguimos con ' + asunto +
      '. Si quieres, ' + agendar + ' con calma; dime qué día te sirve.';
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
      { k: 'citasHoy', ic: 'calendar', t: VOC.Citas + ' hoy', p: d2(), ir: function () { go('calendar'); } },
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
      // XENCRM: sin /today, Inicio lo dice en el copiloto y ofrece reintentar, en vez de quedarse en esqueleto.
      if (!t || t.error || !Array.isArray(t.unanswered)) { pintarErrorDeInicio(t && t.error); return; }
      var d = new Date();
      $('today-sub').textContent = d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }) + (state.name ? ' · ' + state.name : '');
      pintarKpis(t.resumen || {}, t.embudo || null);
      // Orden por costo del silencio: primero lo que alguien está esperando.
      var sections = [
        { t: 'Por verificar', n: t.verifications.length, html: t.verifications.map(verifyItem).join(''), empty: 'Nada pendiente: ' + (state.agentName || 'Xen') + ' supo responder todo.' },
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
        { t: 'Esperan tu respuesta', n: t.unanswered.length, html: t.unanswered.map(function (c) { return contactRow(c, c.humanMode ? 'La última palabra la tiene el cliente y ' + (state.agentName || 'Xen') + ' está en pausa.' : 'La última palabra la tiene el cliente y ' + (state.agentName || 'Xen') + ' no respondió.'); }).join(''), empty: 'Nadie espera respuesta de una persona.' },
        { t: 'Pidieron una persona', n: t.handoffs.length, html: t.handoffs.map(function (c) { return contactRow(c); }).join(''), empty: (state.agentName || 'Xen') + ' lleva todas las conversaciones.' },
        { t: '¿Cómo les fue? (' + VOC.citas + ' que ya pasaron)', n: (t.past || []).length, html: (t.past || []).map(pastItem).join(''), empty: VOC.Ninguna + ' ' + VOC.cita + ' ' + VOC.g('pasada') + ' sin resultado.' },
        { t: 'Recordar a mano', n: (t.remind || []).length, html: (t.remind || []).map(remindItem).join(''), empty: 'Los recordatorios de mañana salen solos.' },
        { t: VOC.Citas + ' de hoy', n: t.appointments.length, html: t.appointments.map(function (a) { return '<div class="appt"><span class="t">' + esc(a.label) + '</span><span class="grow"><b>' + esc(a.contactName || short(a.userId)) + '</b> <span class="muted small">' + esc(a.service + conSede(a)) + '</span>' + reminderChip(a) + '</span><button class="btn sm" data-open="' + esc(a.userId) + '">Chat</button></div>'; }).join(''), empty: 'Sin ' + VOC.citas + ' hoy.' },
        { t: 'Calientes sin seguimiento (más de 24 h)', n: t.hot.length, html: t.hot.map(function (c) {
          return contactRow(c, null, '<button class="btn sm primary" data-follow="' + esc(c.id) + '">Escribirle</button><button class="btn sm" data-snooze="' + esc(c.id) + '">Dejarlo por ahora</button>');
        }).join(''), empty: 'Ningún prospecto caliente abandonado.' },
        { t: 'Sin leer, ' + (state.agentName || 'Xen') + ' ya respondió', n: t.unread.length, html: t.unread.map(function (c) { return contactRow(c); }).join(''), empty: 'Todo leído.' },
        { t: VOC.g('Próximas') + ' ' + VOC.citas + ' (3 días)', n: t.upcoming.length, html: t.upcoming.map(function (a) { return '<div class="appt"><span class="grow stack"><span class="small muted">' + esc(a.label + conSede(a)) + '</span><b>' + esc(a.contactName || short(a.userId)) + '</b>' + reminderChip(a) + '</span><button class="btn sm" data-open="' + esc(a.userId) + '">Chat</button></div>'; }).join(''), empty: 'Nada agendado en los próximos días.' },
      ];
      var down = t.public && (t.public.state === 'caida' || t.public.state === 'otro_servidor')
        ? '<div class="panel help-first" role="alert"><span class="grow"><b>La dirección pública no responde.</b> <span class="small">' + esc(publicDetail(t.public)) + '</span></span><button class="btn primary" data-go="channels">Ver en Canales</button></div>'
        : '';
      // Cada sección con su color: lo urgente no puede verse igual que lo que ya está resuelto.
      // 🪤 En el MISMO orden que los recuadros de arriba. Iba 'esperan' antes que 'grupos' (al revés que los recuadros),
      // así que «Esperan tu respuesta» se pintaba como el de los grupos y el copiloto no encontraba a quién contestar.
      var TONOS = ['verificar', 'grupos', 'esperan', 'persona', 'pasadas', 'recordar', 'citas', 'calientes', 'leidas', 'proximas'];
      sections.forEach(function (s, i) { s.tono = TONOS[i] || ''; });
      // 🪤 En el modo fácil solo sale lo que tiene algo. Nueve recuadros, siete diciendo «nada pendiente», es lo
      // que hacía sentir a XENCRM complicado: hay que leerlos todos para descubrir que no hay que hacer nada.
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
      // Si no hay nada que atender, la columna de al lado no está: la actividad ocupa la fila entera.
      if ($('today').closest('.fx-atender')) $('today').closest('.fx-atender').hidden = $('today').hidden;
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
      if ($('help-hide')) $('help-hide').onclick = function () { helpSet('xencrm.help.seen', true); loadToday(); };
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
    }).catch(function (e) {
      // 🪤 El 401 ya lo atiende api() (pide el token): aquí solo la red caída o una respuesta rota.
      if (e && e.message === '401') return;
      console.error('[inicio]', e);
      pintarErrorDeInicio();
    });
  }
  // ---------- Inicio en el modo fácil ----------
  // El de Nexora: cuatro números, cómo va la semana, dónde está cada persona, lo último que pasó y el resumen del
  // día. 🪤 Todo sale de lo que XENCRM ya sabe —/today, /series, /stats, las notificaciones—; ninguna cifra se
  // estima ni se rellena para que la tarjeta no quede vacía: si no hay datos, la tarjeta lo dice.
  var FX = { dias: 7, serie: null };
  function pintarInicio(t, sections) {
    var r = t.resumen || {};
    var tarjetas = [
      { k: 'activas', t: 'Conversaciones activas', ic: 'burbuja', tono: '', p: 'Ni ganadas ni perdidas', ir: function () { go('inbox', { filter: 'all' }); } },
      { k: 'nuevos', t: 'Prospectos nuevos', ic: 'users', tono: 'cielo', p: 'Escribieron hoy por primera vez', ir: function () { go('inbox', { filter: 'all' }); } },
      { k: 'calientes', t: 'Prospectos calientes', ic: 'objetivo', tono: 'verde', p: 'Con ganas de comprar', ir: function () { go('inbox', { filter: 'hot' }); } },
      { k: 'citasHoy', t: VOC.Citas + ' hoy', ic: 'reloj', tono: 'indigo', p: d2(), ir: function () { go('calendar'); } }
    ];
    $('fx-kpis').removeAttribute('aria-busy');
    $('fx-kpis').innerHTML = tarjetas.map(function (x) {
      return '<button class="fx-kpi" data-k="' + x.k + '"><span class="fx-kpi-cab"><span class="t">' + esc(x.t) + '</span>' +
        '<span class="fx-ic ' + x.tono + '"><i class="ic" data-ic="' + x.ic + '"></i></span></span>' +
        '<span class="n">' + esc(r[x.k] == null ? '—' : Number(r[x.k]).toLocaleString('es-CO')) + '</span><span class="p">' + esc(x.p) + '</span></button>';
    }).join('');
    iconos($('fx-kpis'));
    $('fx-kpis').querySelectorAll('.fx-kpi').forEach(function (b) {
      var x = tarjetas.filter(function (y) { return y.k === b.getAttribute('data-k'); })[0];
      if (x) b.onclick = x.ir;
    });
    pintarResumenDelDia(sections, t);
    cargarSerieFacil();
    api('/stats').then(pintarEtapasFacil).catch(function (e) { if ((!e || e.message !== '401') && $('fx-etapas')) $('fx-etapas').innerHTML = vacioFacil('No se pudo cargar', 'Vuelve a intentarlo con «Actualizar».'); });
    pintarActividadFacil();
  }

  // El copiloto XEN (antes «Resumen del día», en la tarjeta oscura): lo que espera a alguien, contado, y las
  // siguientes acciones, cada una con su verbo y su botón (la idea del panel de recomendaciones de Dynamics 365).
  // 🪤 Todo sale de /today: la cifra es la suma de las `n` de los recuadros y cada acción es una fila de esos mismos
  // recuadros, en el orden de Hoy (el costo del silencio). Nada se estima ni se adorna: si no hay nada, lo dice.
  function pintarResumenDelDia(sections, t) {
    // Lo que pide que alguien haga algo. Las citas de hoy, las próximas y lo ya leído no: eso se mira, no se atiende.
    var pend = (sections || []).filter(function (s) { return s.n > 0 && ['citas', 'leidas', 'proximas'].indexOf(s.tono) < 0; });
    var total = pend.reduce(function (a, s) { return a + s.n; }, 0);
    var agente = state.agentName || 'Xen';
    var caja = $('fx-resumen');
    // Ir al recuadro donde eso se atiende, resaltarlo un momento y dejarle el foco a quien va con el teclado.
    var irAlRecuadro = function (tono) {
      var p = document.querySelector('#today .panel[data-tono="' + tono + '"]');
      if (!p) return;
      var quieto = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      p.scrollIntoView({ behavior: quieto ? 'auto' : 'smooth', block: 'start' });
      p.setAttribute('tabindex', '-1'); p.focus({ preventScroll: true });
      p.classList.add('fx-resalta'); setTimeout(function () { p.classList.remove('fx-resalta'); }, 1600);
    };
    var acciones = accionesDelCopiloto(pend, t || {}, irAlRecuadro);
    var visibles = acciones.slice(0, R('inicio.maxAcciones', 5)), resto = acciones.length - visibles.length;
    var hoy = ((t && t.appointments) || []);
    var hora = new Date().toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
    caja.removeAttribute('aria-busy');
    caja.innerHTML = '<div class="fx-cop-cab"><span class="fx-cop-marca" aria-hidden="true"><i class="ic" data-ic="chispa"></i></span>' +
      '<span class="fx-cop-nombre" id="fx-cop-titulo">Copiloto XEN</span><span class="fx-cop-hora">Con lo que pasó hasta las ' + esc(hora) + '</span></div>' +
      '<div class="fx-cop-cuerpo"><div class="fx-cop-main">' +
      '<h2>' + (total ? (total === 1 ? 'Una cosa espera a alguien' : total + ' cosas esperan a alguien') : 'Todo al día') + '</h2>' +
      '<p>' + esc(total ? 'Esto es lo que no puede esperar, en orden. Lo demás lo va llevando ' + agente + '.' : 'Nadie espera respuesta, no hay ' + VOC.citas + ' sin resultado y ' + agente + ' supo contestar todo.') + '</p>' +
      (visibles.length ? '<ol class="fx-cop-acciones" aria-label="Siguientes acciones">' + visibles.map(function (x, i) {
        return '<li class="fx-cop-accion"><span class="fx-cop-ic ' + x.color + '" aria-hidden="true"><i class="ic" data-ic="' + x.ic + '"></i></span>' +
          '<span class="fx-cop-txt"><b>' + esc(x.que) + '</b>' + (x.detalle ? '<span title="' + esc(x.detalle) + '">' + esc(x.detalle) + '</span>' : '') + '</span>' +
          '<button class="btn sm' + (i === 0 ? ' primary' : '') + '" type="button" data-accion="' + i + '">' + esc(x.boton) + '</button></li>';
      }).join('') + '</ol>' : '') +
      (resto > 0 ? '<button class="fx-cop-mas" type="button" id="fx-cop-mas">Y ' + (resto === 1 ? 'una más' : resto + ' más') + ' en «Para atender»</button>' : '') +
      '</div><div class="fx-cop-lado">' +
      '<h3>Pendientes</h3>' + (pend.length
        ? '<div class="fx-cop-pend">' + pend.map(function (s) { return '<button type="button" data-tono="' + s.tono + '"><span>' + esc(s.t) + '</span><b>' + s.n + '</b></button>'; }).join('') + '</div>'
        : '<div class="fx-cop-nada">Nada pendiente por ahora.</div>') +
      '<h3>Hoy en la agenda</h3>' + (hoy.length
        ? '<div class="fx-cop-agenda">' + hoy.map(function (a) {
            return '<button type="button" data-cita="' + esc(a.userId) + '"><time>' + esc(a.label || '') + '</time><span>' + esc(a.contactName || short(a.userId)) + '</span></button>';
          }).join('') + '</div>'
        : '<div class="fx-cop-nada">Sin ' + VOC.citas + ' hoy.</div>') +
      '</div></div>' +
      (esFacil() && mandaEnElModo() ? '<button class="fx-todo" type="button" id="hoy-ver-todo">Estás en el modo fácil · Ver todo XENCRM</button>' : '');
    iconos(caja);
    caja.querySelectorAll('[data-accion]').forEach(function (b) { b.onclick = function () { visibles[Number(b.getAttribute('data-accion'))].ir(); }; });
    caja.querySelectorAll('[data-tono]').forEach(function (b) { b.onclick = function () { irAlRecuadro(b.getAttribute('data-tono')); }; });
    caja.querySelectorAll('[data-cita]').forEach(function (b) { b.onclick = function () { go('inbox'); openContact(b.getAttribute('data-cita')); }; });
    if ($('fx-cop-mas')) $('fx-cop-mas').onclick = function () { irAlRecuadro(acciones[visibles.length].tono); };
    if ($('hoy-ver-todo')) $('hoy-ver-todo').onclick = function () { $('modo-btn').click(); };
  }

  // Cómo va la semana: conversaciones nuevas (área del acento) y citas agendadas (línea índigo, el color de la cita), por día.
  function cargarSerieFacil() {
    api('/series?dias=' + Math.max(7, FX.dias)).then(function (d) {
      if (!d || d.error || !d.nuevas) { $('fx-serie').innerHTML = vacioFacil('No se pudo cargar', 'Vuelve a intentarlo con «Actualizar».'); return; }
      var citas = {};
      (d.citas || []).forEach(function (c) { citas[c.dia] = c.citas; });
      FX.serie = d.nuevas.slice(-FX.dias).map(function (n) { return { dia: n.dia, a: n.total, b: citas[n.dia] || 0 }; });
      var s = d.semana && d.semana.conversaciones;
      $('fx-serie-sub').textContent = s
        ? 'Esta semana: ' + s.ahora + (s.ahora === 1 ? ' conversación nueva' : ' conversaciones nuevas') + (s.delta == null ? '' : ' (' + (s.delta >= 0 ? '+' : '') + s.delta + ' % contra la anterior)')
        : 'Conversaciones nuevas y ' + VOC.citas + ' ' + VOC.g('agendadas');
      dibujarSerieFacil();
    }).catch(function (e) { if (!e || e.message !== '401') $('fx-serie').innerHTML = vacioFacil('No se pudo cargar', 'Vuelve a intentarlo con «Actualizar».'); });
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
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(datos.map(function (x) { return diaLargo(x.dia) + ': ' + x.a + ' nuevas, ' + x.b + ' ' + VOC.citas; }).join('; ')) + '">' +
      // Los colores los pone la hoja (stop-color y stroke son propiedades de CSS): así siguen al tema y a los tokens.
      '<defs><linearGradient id="fx-grad" x1="0" y1="0" x2="0" y2="1"><stop class="fx-stop" offset="5%" stop-opacity=".22"/><stop class="fx-stop" offset="95%" stop-opacity="0"/></linearGradient></defs>';
    for (var g = 0; g <= 4; g++) {
      var v = tope / 4 * g, y = Y(v);
      svg += '<line class="rejilla" x1="' + izq + '" x2="' + (W - der) + '" y1="' + y + '" y2="' + y + '"/><text class="eje" x="' + (izq - 8) + '" y="' + (y + 4) + '" text-anchor="end">' + v + '</text>';
    }
    datos.forEach(function (x, i) { if (i % cada === 0 || i === datos.length - 1) svg += '<text class="eje" x="' + X(i) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(diaCorto(x.dia)) + '</text>'; });
    var curva = curvaSuave(pa);
    svg += '<path d="' + curva + 'L' + X(datos.length - 1) + ',' + Y(0) + 'L' + X(0) + ',' + Y(0) + 'Z" fill="url(#fx-grad)"/>' +
      '<path class="linea-nuevas" d="' + curva + '"/><path class="linea-citas" d="' + curvaSuave(pb) + '"/>';
    datos.forEach(function (x, i) {
      svg += '<g class="col" data-i="' + i + '"><rect class="zona" x="' + (X(i) - paso / 2) + '" y="' + arr + '" width="' + paso + '" height="' + (H - arr - aba) + '"/>' +
        '<circle class="punto nuevas" cx="' + X(i) + '" cy="' + Y(x.a) + '" r="4"/><circle class="punto citas" cx="' + X(i) + '" cy="' + Y(x.b) + '" r="4"/></g>';
    });
    caja.innerHTML = svg + '</svg><div class="fx-globo" id="fx-globo" hidden></div>';
    caja.querySelectorAll('.col').forEach(function (c) {
      c.onmouseenter = function () {
        var i = Number(c.getAttribute('data-i')), x = datos[i], gl = $('fx-globo');
        gl.innerHTML = '<b>' + esc(diaLargo(x.dia)) + '</b><span class="nuevas">Conversaciones nuevas: ' + x.a + '</span><br><span class="citas">' + VOC.Citas + ' ' + VOC.g('agendadas') + ': ' + x.b + '</span>';
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
    if (!caja) return;
    if (!s || !s.byStage) { caja.innerHTML = vacioFacil('No se pudo cargar', 'Vuelve a intentarlo con «Actualizar».'); return; }
    var etapas = (state.stages || []).length ? state.stages : Object.keys(s.stageLabels || {}).map(function (k) { return { id: k, label: s.stageLabels[k] }; });
    var max = Math.max(1, Math.max.apply(null, etapas.map(function (e) { return s.byStage[e.id] || 0; })));
    if (!etapas.some(function (e) { return s.byStage[e.id]; })) { caja.innerHTML = vacioFacil('Nadie en el embudo todavía', 'Aquí se ve cuántas personas hay en cada etapa.'); return; }
    caja.innerHTML = etapas.map(function (e) {
      var n = s.byStage[e.id] || 0;
      return '<button class="fx-barra" data-stage="' + esc(e.id) + '" data-rol="' + esc(e.rol || '') + '" title="Ver en Tratos" aria-label="' + esc((e.label || e.id) + ': ' + n + (n === 1 ? ' contacto' : ' contactos')) + '"><span class="nom">' + esc(e.label || e.id) + '</span>' +
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
    var tono = function (k) { return k === 'appointment' || k === 'recordatorio' ? ['citas', 'indigo'] : k === 'handoff' || k === 'verify' ? ['user', 'ambar'] : k === 'new' ? ['users', 'cielo'] : k === 'hot' ? ['objetivo', 'verde'] : ['actividad', '']; };
    var fila = function (x) {
      return '<button class="fx-act" data-id="' + esc(x.id) + '"><span class="fx-ic ' + x.tono[1] + '"><i class="ic" data-ic="' + x.tono[0] + '"></i></span>' +
        '<span class="cuerpo"><span class="t">' + esc(x.t) + '</span><span class="d">' + esc(x.d) + '</span></span><time>' + esc(x.cuando ? 'hace ' + rel(x.cuando) : '') + '</time></button>';
    };
    var pintar = function (lista) {
      caja.innerHTML = lista.length ? lista.map(fila).join('') : vacioFacil('Sin actividad reciente', 'Aquí aparece lo que va pasando: quién escribe, quién pide una persona, qué ' + VOC.cita + ' se agenda.');
      iconos(caja);
      caja.querySelectorAll('.fx-act').forEach(function (b) {
        b.onclick = function () { var id = b.getAttribute('data-id'); if (id && id !== 'system') { go('inbox'); openContact(id); } };
      });
    };
    var avisos = (state.notifs || []).filter(avisoParaMi).slice(0, R('inicio.maxAvisos', 5));
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
    else if (r && r.status === 'enviado') html = '<span class="chip" title="' + esc((r.note || 'Enviado por ' + (state.agentName || 'Xen')) + (r.at ? ' · hace ' + rel(r.at) : '')) + '">Recordada</span>';
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
      '<label class="small verify-learn"><input type="checkbox" id="vl-' + v.id + '" checked> Agregar a la información de ' + esc(state.bizName || 'la tienda') + ': la próxima vez ' + esc(state.agentName || 'Xen') + ' ya lo sabe</label>' +
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
  // con ellos y llevan a pantallas que no ve. Quien administra XENCRM los sigue viendo.
  function avisoParaMi(n) { return !(enCandado() && n && (n.userId === 'system' || n.kind === 'public' || n.kind === 'engine')); }
  function loadNotifs() { api('/notifications').then(function (list) { state.notifs = Array.isArray(list) ? list.filter(avisoParaMi) : list; renderNotifs(); }); }
  $('bell-btn').onclick = function (e) { e.stopPropagation(); $('notif').classList.toggle('open'); };
  document.addEventListener('click', function (e) { if (!$('notif').contains(e.target) && e.target !== $('bell-btn')) $('notif').classList.remove('open'); });
  $('notif-clear').onclick = function () { state.notifSeen = state.notifs.length ? Math.max.apply(null, state.notifs.map(function (n) { return n.id; })) : 0; try { localStorage.setItem(LLAVE('notifSeen'), String(state.notifSeen)); } catch (e) {} renderNotifs(); };

  // ---------- pipeline ----------
  // Con varias sedes, el equipo de cada una mira sus prospectos. Quien todavía no escogió sede no es de ninguna: sale
  // en «Todas» y en «Sin sede todavía», que es justo donde hay que ir a preguntarle.
  var pipSede = helpGet('xencrm.pip.sede') || '';
  function pintarSedesPip() {
    if (!variasSedes()) { $('pip-sede').hidden = true; return; }
    if (pipSede && pipSede !== '_ninguna' && !nombreSede(pipSede)) pipSede = '';
    $('pip-sede').innerHTML = '<option value="">Todas las sedes</option>' +
      state.sedes.map(function (s) { return '<option value="' + esc(s.id) + '"' + (s.id === pipSede ? ' selected' : '') + '>' + esc(s.nombre) + '</option>'; }).join('') +
      '<option value="_ninguna"' + (pipSede === '_ninguna' ? ' selected' : '') + '>Sin sede todavía</option>';
    $('pip-sede').hidden = false;
  }
  $('pip-sede').onchange = function () { pipSede = this.value; helpSet('xencrm.pip.sede', pipSede); loadPipeline(); };
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
      cifra('cita', 'Con ' + VOC.cita + ' por delante', suma(conCita) ? plataCorta(suma(conCita)) : (conCita.length ? '' : '—'), conCita.length + (conCita.length === 1 ? ' persona con ' + VOC.cita : ' personas con ' + VOC.cita)) +
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
    xfPintarBarra('pipeline');
    // Las vistas «este mes» necesitan cuándo se cerró cada trato (la historia de etapas): se pide junto.
    xfCargarHistoria();
    api('/contacts?limit=2000').then(function (todos) {
      if (!Array.isArray(todos)) { toast('No se pudieron cargar los tratos: ' + ((todos && todos.error) || 'sin respuesta del servidor')); return; }
      state.pipeTodos = todos;
      pintarPipeline(focusId);
    });
  }
  /** El tablero (o la lista) con lo que ya llegó: cambiar de vista o de filtro no vuelve a pedir nada. */
  function pintarPipeline(focusId) {
    var todos = state.pipeTodos || [];
    xfPintarBarra('pipeline');
    (function () {
      var list = todos.filter(deLaSede).filter(xfFiltro('pipeline'));
      state.pipeLista = list;
      xfPintarVistas('pipeline', todos.filter(deLaSede));
      if (xfE('pipeline').modo === 'lista') { $('board').hidden = true; $('xf-pipeline-lista').hidden = false; xfPintarListaTratos(list); pintarCifrasEmbudo(list); return; }
      $('board').hidden = false; $('xf-pipeline-lista').hidden = true;
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
          // XENCRM: el avatar con su color, el mismo que en Contactos y en la ficha: así se reconoce de una pantalla a otra.
          '<div class="t">' + avatarHtml(nameOf(c), c.id, 'sm') + '<button type="button" class="card-open" title="Abrir la conversación">' + esc(nameOf(c)) + '</button>' +
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
    })();
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
  // el cliente, y se queda: lo que pedía quien revisó XENCRM era poder decir «este es de Laura» y filtrarlo.
  function genteDelEquipo(c) {
    var nombres = equipoDisponible().map(function (u) { return u.nombre; });
    // Con el token a secas no se sabe quién es el equipo: por lo menos uno mismo.
    if (!nombres.length && state.name) nombres.push(state.name);
    if (c.responsable && !nombres.some(function (n) { return mismoNombre(n, c.responsable); })) nombres.unshift(c.responsable);
    return nombres;
  }
  function responsableHtml(c, id) {
    return '<select id="' + id + '" aria-label="Quién está a cargo">' +
      '<option value=""' + (c.responsable ? '' : ' selected') + '>Sin asignar</option>' +
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
  // La cámara de la videollamada (Lucide, el mismo trazo que los demás): en la tarjeta, la vista rápida y el panel.
  ICONS.video = '<path d="m16 13 5.2 3.5a.5.5 0 0 0 .8-.4V7.9a.5.5 0 0 0-.8-.4L16 11"/><rect x="2" y="6" width="14" height="12" rx="2"/>';
  var cal = { mode: helpGet('xencrm.cal.mode') || (onPhone() ? 'agenda' : 'week'), start: startOfWeek(new Date()), cfg: null, appts: [], todas: [], busy: [], sede: helpGet('xencrm.cal.sede') || '', sedesAg: [], vista: null, hoy: null, hoyError: false, error: false, disparador: null, abrirDia: '' };
  // Una hora mide esto en la semana. 64 px: una cita de 45 min (48 px) cabe con nombre, hora y una línea de datos.
  var HOUR_PX = 64;
  function startOfWeek(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function hm(str) { var p = str.split(':'); return Number(p[0]) + Number(p[1] || 0) / 60; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function toLocalInput(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  // El día como lo dice el servidor (YYYY-MM-DD): así se cruzan las citas con los anuncios y el cupo.
  // 🪤 Es la fecha del navegador. El equipo mira en la hora del negocio; uno que mire desde otra zona vería los
  // anuncios corridos un día en las horas del borde, igual que ya veía las citas.
  function claveDia(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function diaDeClave(k) { var p = k.split('-'); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
  // La hora corta de la rejilla, en 24 h como su eje («9:00–9:45»). En el panel y la vista rápida va la de siempre.
  function h24(ts) { var d = new Date(ts); return d.getHours() + ':' + pad(d.getMinutes()); }
  function fechaLarga(d) { return d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }); }
  function fechaCorta(d) { return d.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric' }); }
  function agenteXen() { return state.agentName || 'Xen'; }
  // «08:00» de la configuración, dicho como las demás horas del tablero («8:00 a. m.»).
  function horaDe(hhmmTexto) { var d = new Date(); d.setHours(Math.floor(hm(hhmmTexto)), Math.round((hm(hhmmTexto) % 1) * 60), 0, 0); return hhmm(d.getTime()); }
  function citasN(n) { return n + ' ' + (n === 1 ? VOC.cita : VOC.citas); }

  // ---------- sedes (src/crm/sedes.ts) ----------
  // 🪤 Una cita sin sede es de antes de que el negocio tuviera sedes, y se cuenta en la primera, igual que en la
  // agenda del servidor: si aquí se contara en ninguna, el calendario la escondería al filtrar por sede.
  function variasSedes() { return (state.sedes || []).length > 1; }
  function sedeDe(a) { return a.sede || ((state.sedes || [])[0] || {}).id || ''; }
  function nombreSede(id) { var s = (state.sedes || []).filter(function (x) { return x.id === id; })[0]; return s ? s.nombre : ''; }
  function conSede(a) { return variasSedes() && sedeDe(a) ? ' · ' + nombreSede(sedeDe(a)) : ''; }
  function filtrarSede(list) { return cal.sede && variasSedes() ? list.filter(function (a) { return sedeDe(a) === cal.sede; }) : list; }
  function deLaSedeQs(primero) { return cal.sede && variasSedes() ? (primero ? '?' : '&') + 'sede=' + encodeURIComponent(cal.sede) : ''; }
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

  // ---------- cupo y anuncios (src/crm/agenda-vista.ts) ----------
  // El rango que se mira, para pedir su cupo y sus anuncios: la semana, las seis semanas del mes, o los próximos 60
  // días en Agenda.
  function rangoVisible() {
    if (cal.mode === 'agenda') { var h = new Date(); h.setHours(0, 0, 0, 0); return { from: h.getTime(), to: addDays(h, 60).getTime() - 1 }; }
    if (cal.mode === 'month') {
      var m0 = new Date(cal.start.getFullYear(), cal.start.getMonth(), 1), ini = addDays(m0, -((m0.getDay() + 6) % 7));
      return { from: ini.getTime(), to: addDays(ini, 42).getTime() - 1 };
    }
    return { from: cal.start.getTime(), to: addDays(cal.start, 7).getTime() - 1 };
  }
  function anunciosDel(k) { return ((cal.vista && cal.vista.anuncios) || []).filter(function (a) { return a.fecha === k; }); }
  function cupoDel(k) { return ((cal.vista && cal.vista.cupo) || []).filter(function (c) { return c.fecha === k; })[0] || null; }
  function diaBloqueado(k) { var c = cupoDel(k); return Boolean(c && c.cerrado); }
  /**
   * Cada anuncio dicho en palabras, con su tono y su dibujo. Un solo sitio: la semana, el mes, la agenda, la vista del
   * día y el formulario de agendar dicen lo mismo con las mismas palabras.
   * Tonos: aviso (ámbar: hay algo que hacer), lleno (rojo), cerrado (gris), festivo (violeta), servicio (cielo).
   */
  function textoAnuncio(a) {
    var hay = a.agendadas ? ' Hay ' + citasN(a.agendadas) + ' ' + VOC.g('agendadas') + '.' : '';
    var bloqueado = 'Bloqueado: ' + agenteXen() + ' no ofrece este día.' + (a.agendadas ? ' ' + (a.agendadas === 1 ? 'Queda' : 'Quedan') + ' ' + citasN(a.agendadas) + ' ' + VOC.g('agendadas') + ': ' + (a.agendadas === 1 ? 'muévela o atiéndela' : 'muévelas o atiéndelas') + '.' : '');
    if (a.tipo === 'festivo') return { ic: 'estrella', tono: a.cerrado ? 'cerrado' : a.agendadas ? 'aviso' : 'festivo', corto: 'Festivo', titulo: 'Festivo · ' + a.titulo, detalle: a.cerrado ? bloqueado : 'La agenda sigue abierta: ' + agenteXen() + ' ofrece este día.' + hay };
    if (a.tipo === 'cierre') return { ic: 'candado-nota', tono: 'cerrado', corto: 'Bloqueado', titulo: (a.titulo ? 'Bloqueado · ' + a.titulo : 'Día bloqueado') + (a.sede ? ' en ' + a.sede : ''), detalle: bloqueado };
    if (a.tipo === 'mantenimiento') {
      var aviso = a.porAvisar ? 'Falta avisar a ' + a.porAvisar + (a.porAvisar === 1 ? ' cliente' : ' clientes') + '.' : a.afectados ? a.afectados + (a.afectados === 1 ? ' cliente afectado.' : ' clientes afectados.') : 'Sin clientes afectados.';
      return { ic: 'llave', tono: a.porAvisar ? 'aviso' : 'servicio', corto: h24(a.inicio) + ' ' + a.titulo, titulo: 'Mantenimiento · ' + a.titulo, detalle: (a.producto ? a.producto + ' · ' : '') + h24(a.inicio) + '–' + h24(a.fin) + '. ' + aviso };
    }
    if (a.tipo === 'lleno') return { ic: 'alerta', tono: 'lleno', corto: 'Lleno', titulo: 'Día lleno', detalle: 'No quedan espacios: ' + agenteXen() + ' ofrece el siguiente día con cupo.' };
    return { ic: 'alerta', tono: 'aviso', corto: 'Casi lleno', titulo: 'Casi lleno', detalle: 'Quedan ' + a.libres + ' de ' + a.total + ' espacios.' };
  }
  // Un anuncio como etiqueta (la semana y el mes): abre la vista del día, que lo explica y tiene sus acciones.
  function chipAnuncio(a, conTexto) {
    var t = textoAnuncio(a);
    return '<button type="button" class="cal-aviso ta-' + t.tono + '" data-dia="' + esc(a.fecha) + '" title="' + esc(t.titulo + '. ' + t.detalle) + '">' + svgXen(t.ic) + '<span' + (conTexto === false ? ' class="sr-only"' : '') + '>' + esc(t.corto) + '</span></button>';
  }
  // Un anuncio entero (la agenda y la vista del día).
  function filaAnuncio(a, comoBoton) {
    var t = textoAnuncio(a), etiqueta = comoBoton ? 'button type="button" data-dia="' + esc(a.fecha) + '"' : 'div';
    return '<' + etiqueta + ' class="cal-aviso-fila ta-' + t.tono + '">' + svgXen(t.ic) + '<span><b>' + esc(t.titulo) + '</b><span>' + esc(t.detalle) + '</span></span></' + (comoBoton ? 'button' : 'div') + '>';
  }
  function medidorCupo(c) {
    if (!c || !c.total) return '';
    var pct = Math.round((c.ocupados / c.total) * 100), lim = R('agenda.casiLlenoPct', 80);
    return '<span class="cal-cupo' + (c.ocupados >= c.total ? ' lleno' : pct >= lim ? ' casi' : '') + '" aria-hidden="true"><i style="width:' + pct + '%"></i></span>';
  }
  function textoCupo(c, hoy) {
    if (!c) return '';
    if (c.cerrado) return 'Bloqueado';
    if (!c.abierto) return 'No se atiende';
    if (!c.total) return 'Sin espacios';
    if (c.ocupados >= c.total) return 'Lleno';
    // Hoy cuenta solo lo que aún se puede agendar (con la antelación mínima por delante): por eso puede ser menos que
    // lo que no está tomado.
    return c.libres + (c.libres === 1 ? ' libre' : ' libres');
  }

  // ---------- cargar ----------
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
      var r = rangoVisible();
      // Los bloques ocupados de la sede que se mira: los del dueño y los de su calendario (src/crm/busy.ts).
      // El cupo y los anuncios no tumban el calendario si fallan: sin ellos se ve igual que antes.
      return Promise.all([api('/appointments?from=' + from + '&to=' + to), api('/busy?from=' + from + '&to=' + to + deLaSedeQs()),
        api('/agenda?from=' + r.from + '&to=' + r.to + deLaSedeQs()).catch(function () { return null; })]);
    }).then(function (r) {
      var list = r[0];
      if (!Array.isArray(list)) throw new Error('citas');
      cal.error = false;
      cal.busy = Array.isArray(r[1]) ? r[1] : [];
      cal.vista = r[2] && !r[2].error ? r[2] : { cupo: [], anuncios: [] };
      cal.todas = list;
      cal.appts = filtrarSede(list);
      $('badge-cal').textContent = list.filter(function (a) { return a.status === 'confirmada' && a.startsAt >= Date.now(); }).length || '';
      if ($('fx-n-citas')) $('fx-n-citas').textContent = $('badge-cal').textContent;
      renderCalendar();
      if (cal.abrirDia) { var k = cal.abrirDia; cal.abrirDia = ''; var b = document.querySelector('#view-calendar [data-dia="' + k + '"]'); vistaDelDia(k, b); }
    }).catch(function (e) {
      if (String(e && e.message) === '401') return;
      cal.error = true;
      renderCalendar();
    });
    cargarHoy();
    api('/contacts?limit=' + R('contactos.tope', 500)).then(function (list) { $('book-contact').innerHTML = list.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(nameOf(c)) + '</option>'; }).join(''); });
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
    if (cal.error) { pintarErrorCal(); return; }
    if (cal.mode === 'week') renderWeek(); else if (cal.mode === 'month') renderMonth(); else renderAgenda();
  }
  // Si no llegan las citas: decirlo, con la salida, en el sitio donde iban (y no una rejilla vacía que parece «no hay nada»).
  function pintarErrorCal() {
    var caja = cal.mode === 'week' ? $('cal-grid') : cal.mode === 'month' ? $('cal-month') : $('cal-list');
    caja.innerHTML = '<div class="cal-vacio" role="alert"><b>No se pudo cargar el calendario.</b><span>Puede ser la conexión. Lo que ya estaba agendado sigue igual.</span><button type="button" class="btn" data-reintentar>Reintentar</button></div>';
    caja.querySelector('[data-reintentar]').onclick = loadCalendar;
  }

  // ---------- la semana ----------
  /**
   * Las citas que se cruzan van una al lado de la otra, no encimadas. Se agrupan en racimos —las que se tocan en
   * cadena— y cada racimo se reparte en tantos carriles como citas a la vez llegó a tener. Con capacidad 2, dos
   * citas a las 9:00 son dos tarjetas de media columna, cada una con su nombre.
   */
  function carriles(lista) {
    var orden = lista.slice().sort(function (a, b) { return a.startsAt - b.startsAt || b.endsAt - a.endsAt; });
    var out = [], racimo = [], fines = [], finRacimo = -Infinity;
    function cerrar() { var n = fines.length; racimo.forEach(function (x) { x.n = n; }); racimo = []; fines = []; }
    orden.forEach(function (a) {
      if (a.startsAt >= finRacimo) { cerrar(); finRacimo = -Infinity; }
      var c = -1;
      for (var i = 0; i < fines.length; i++) if (fines[i] <= a.startsAt) { c = i; break; }
      if (c < 0) { c = fines.length; fines.push(a.endsAt); } else fines[c] = a.endsAt;
      var x = { a: a, carril: c, n: 1 };
      racimo.push(x); out.push(x);
      finRacimo = Math.max(finRacimo, a.endsAt);
    });
    cerrar();
    return out;
  }
  // El recordatorio en un dibujo, para la tarjeta (en palabras va en la vista rápida).
  function iconoRecordatorio(a) {
    if (a.status !== 'confirmada') return '';
    if (a.reply === 'confirmó') return '<span class="ev-ic ok" title="Confirmó que viene">' + svgXen('check') + '</span>';
    if (a.reply === 'no_puede') return '<span class="ev-ic mal" title="Dijo que no puede">' + svgXen('alerta') + '</span>';
    if (a.reminder && a.reminder.status === 'a_mano') return '<span class="ev-ic aviso" title="Hay que recordarle a mano">' + svgXen('bell') + '</span>';
    if (a.reminder && a.reminder.status === 'enviado') return '<span class="ev-ic" title="Recordada">' + svgXen('bell') + '</span>';
    return a.remindAt ? '<span class="ev-ic" title="' + esc('El recordatorio sale solo ' + cuandoSale(a.remindAt)) + '">' + svgXen('reloj') + '</span>' : '';
  }
  function cuandoSale(ts) {
    var at = new Date(ts), hoy = new Date(), man = addDays(hoy, 1);
    var dia = sameDay(at, hoy) ? 'hoy' : sameDay(at, man) ? 'mañana' : 'el ' + at.toLocaleDateString('es-CO', { weekday: 'long' });
    return dia + ' a las ' + hhmm(ts);
  }
  function etiquetaCita(a) {
    var est = { completada: 'asistió', no_asistio: 'no asistió', cancelada: 'cancelada' }[a.status] || VOC.g('confirmada');
    return (a.contactName || short(a.userId)) + (a.empresa ? ', ' + a.empresa : '') + '. ' + fechaLarga(new Date(a.startsAt)) + ', de ' + hhmm(a.startsAt) + ' a ' + hhmm(a.endsAt) + '. ' + a.service + '. ' + est + '.';
  }
  function tarjetaCita(x, h0) {
    var a = x.a, st = new Date(a.startsAt), en = new Date(a.endsAt);
    var top = ((st.getHours() + st.getMinutes() / 60) - h0) * HOUR_PX, alto = Math.max(24, ((en - st) / 3600000) * HOUR_PX - 2);
    var ancho = 100 / x.n;
    var estilo = 'top:' + top + 'px;height:' + alto + 'px;left:calc(' + (x.carril * ancho) + '% + 3px);width:calc(' + ancho + '% - 6px)';
    // El estado va también en el texto: el color y el relieve nunca son la única señal.
    var mark = { completada: '✓ ', no_asistio: '✗ ', cancelada: '' }[a.status] || '';
    var ch = canalDeXen(a.canal);
    var datos = '<span class="ev-ic" title="' + esc(ch.t) + '">' + svgXen(ch.ic) + '</span>' + iconoRecordatorio(a) + (a.enlace ? '<span class="ev-ic" title="Tiene enlace de videollamada">' + svgXen('video') + '</span>' : '') + (a.valor ? '<span class="ev-valor">' + esc(plataCorta(a.valor)) + '</span>' : '');
    // En un carril estrecho (dos o más a la vez) cabe el primer nombre y la hora; lo demás, en la vista rápida.
    var nombre = a.contactName || short(a.userId), estrecha = x.n > 1;
    var l2 = estrecha ? h24(a.startsAt) : h24(a.startsAt) + '–' + h24(a.endsAt) + (a.empresa ? ' · ' + a.empresa : ' · ' + a.service);
    return '<button type="button" class="cal-ev ' + a.status + (alto < 44 ? ' corta' : '') + (estrecha ? ' estrecha' : '') + '" data-id="' + a.id + '" style="' + estilo + '" aria-label="' + esc(etiquetaCita(a)) + '" title="' + esc(nombre + ' · ' + h24(a.startsAt) + '–' + h24(a.endsAt)) + '">' +
      '<b>' + esc(mark + (estrecha ? nombre.split(' ')[0] : nombre)) + '</b><span class="ev-l2">' + esc(l2) + '</span><span class="ev-datos">' + datos + '</span></button>';
  }
  function renderWeek() {
    var cfg = agendaVista({ days: [1, 2, 3, 4, 5], hours: [['09:00', '18:00']], durationMin: 45, enabled: false });
    var hours = cfg.hours && cfg.hours.length ? cfg.hours : [['09:00', '18:00']];
    var h0 = Math.max(0, Math.floor(Math.min.apply(null, hours.map(function (h) { return hm(h[0]); })) - 1));
    var h1 = Math.min(24, Math.ceil(Math.max.apply(null, hours.map(function (h) { return hm(h[1]); })) + 1));
    var total = h1 - h0, now = new Date();
    // Las rayas finas: cada media hora, o cada cuarto si las citas son cortas.
    var paso = (cfg.durationMin || 30) < 30 ? 15 : 30;
    var days = []; for (var i = 0; i < 7; i++) days.push(addDays(cal.start, i));
    var hayAvisos = days.some(function (d) { return anunciosDel(claveDia(d)).length; });
    var head = '<div class="cal-head' + (hayAvisos ? ' con-avisos' : '') + '"><div class="d"></div>' + days.map(function (d) {
      var k = claveDia(d), cu = cupoDel(k), cerrado = cfg.days.indexOf(d.getDay()) < 0 || diaBloqueado(k);
      var dice = fechaLarga(d) + (cu && cu.cerrado ? ', bloqueado' : cu && cu.total ? ', ' + cu.ocupados + ' de ' + cu.total + ' espacios tomados' : '') + '. Ver el día';
      return '<button type="button" class="d' + (sameDay(d, now) ? ' today' : '') + (cerrado ? ' closed' : '') + '" data-dia="' + k + '" aria-label="' + esc(dice) + '">' + d.toLocaleDateString('es-CO', { weekday: 'short' }) + '<b>' + d.getDate() + '</b>' + medidorCupo(cu) + '</button>';
    }).join('') + (hayAvisos ? '<div class="av av-l small">Avisos</div>' + days.map(function (d) {
      var l = anunciosDel(claveDia(d));
      return '<div class="av">' + l.slice(0, 2).map(function (a) { return chipAnuncio(a); }).join('') + (l.length > 2 ? '<button type="button" class="cal-aviso ta-mas" data-dia="' + claveDia(d) + '">+' + (l.length - 2) + '</button>' : '') + '</div>';
    }).join('') : '') + '</div>';
    var hoursCol = '<div class="cal-hours" style="height:' + total * HOUR_PX + 'px">' + Array.from({ length: total + 1 }, function (_, i) { return '<div class="h" style="top:' + i * HOUR_PX + 'px">' + pad(h0 + i) + ':00</div>'; }).join('') + '</div>';
    var cols = days.map(function (d) {
      var k = claveDia(d), bloqueado = diaBloqueado(k);
      var open = cfg.days.indexOf(d.getDay()) >= 0 && !bloqueado;
      var closed = '';
      if (!open) closed = '<div class="closed' + (bloqueado ? ' bloqueado' : '') + '" style="top:0;height:' + total * HOUR_PX + 'px">' + (bloqueado ? '<span>' + svgXen('candado-nota') + 'Bloqueado</span>' : '') + '</div>';
      else {
        var cursor = h0;
        hours.slice().sort(function (a, b) { return hm(a[0]) - hm(b[0]); }).forEach(function (h) {
          var a = hm(h[0]), b = hm(h[1]);
          if (a > cursor) closed += '<div class="closed" style="top:' + (cursor - h0) * HOUR_PX + 'px;height:' + (a - cursor) * HOUR_PX + 'px"></div>';
          cursor = Math.max(cursor, b);
        });
        if (cursor < h1) closed += '<div class="closed" style="top:' + (cursor - h0) * HOUR_PX + 'px;height:' + (h1 - cursor) * HOUR_PX + 'px"></div>';
      }
      var evs = carriles(cal.appts.filter(function (a) { return sameDay(new Date(a.startsAt), d); })).map(function (x) { return tarjetaCita(x, h0); }).join('');
      // Eventos del calendario privado del dueño: el bot no ofrece esas horas.
      var dayStart = new Date(d).setHours(0, 0, 0, 0), dayEnd = dayStart + 86400000;
      var busy = cal.busy.map(function (b) {
        var s = Math.max(b.start, dayStart), e = Math.min(b.end, dayEnd);
        if (e <= s) return '';
        var top = Math.max(0, ((s - dayStart) / 3600000 - h0) * HOUR_PX), bottom = Math.min(total * HOUR_PX, ((e - dayStart) / 3600000 - h0) * HOUR_PX);
        return bottom > top ? '<div class="cal-busy" style="top:' + top + 'px;height:' + (bottom - top) + 'px" title="Ocupado en tu calendario: el bot no ofrece esta hora"><span>Ocupado</span></div>' : '';
      }).join('');
      var nowLine = sameDay(d, now) ? '<div class="cal-now" style="top:' + ((now.getHours() + now.getMinutes() / 60) - h0) * HOUR_PX + 'px"></div>' : '';
      return '<div class="cal-col' + (sameDay(d, now) ? ' today' : '') + '" data-day="' + d.getTime() + '" style="height:' + total * HOUR_PX + 'px;--hour-px:' + HOUR_PX + 'px;--sub-px:' + (HOUR_PX * paso / 60) + 'px">' + closed + busy + evs + nowLine + '</div>';
    }).join('');
    // 🪤 Los días que no se atienden y no tienen nada (el fin de semana, casi siempre) se angostan: su ancho se lo
    // llevan los días con citas, donde dos a la misma hora comparten la columna. Con siete columnas iguales, cada
    // carril quedaba en 48 px y se leía «Val…».
    var movil = onPhone();
    $('cal-grid').style.setProperty('--cal-cols', (movil ? '44px ' : '56px ') + days.map(function (d) {
      var k = claveDia(d), vacio = (cfg.days.indexOf(d.getDay()) < 0 || diaBloqueado(k)) && !anunciosDel(k).length && !cal.appts.some(function (a) { return sameDay(new Date(a.startsAt), d); });
      return vacio ? (movil ? 'minmax(36px,.35fr)' : 'minmax(44px,.35fr)') : (movil ? 'minmax(64px,1fr)' : 'minmax(84px,1fr)');
    }).join(' '));
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
        elegirHueco(d);
      };
    });
    enlazarCal($('cal-grid'));
    // desplazar a la primera hora de atención
    var firstOpen = Math.min.apply(null, hours.map(function (h) { return hm(h[0]); }));
    $('cal-grid').scrollTop = Math.max(0, (firstOpen - h0) * HOUR_PX - 8);
  }
  // Lo que se toca en cualquier vista: una cita abre su vista rápida; un día (su cabecera, un aviso) abre la del día.
  function enlazarCal(raiz) {
    raiz.querySelectorAll('[data-id]').forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); vistaRapida(Number(b.getAttribute('data-id')), b); }; });
    raiz.querySelectorAll('[data-dia]').forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); vistaDelDia(b.getAttribute('data-dia'), b); }; });
  }
  // Un hueco elegido (en la rejilla o en la vista del día) va al formulario de agendar.
  function elegirHueco(d) {
    $('book-when').value = toLocalInput(d);
    $('book-msg').textContent = 'Hueco elegido: ' + d.toLocaleString('es-CO', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) + avisoDelDia(claveDia(d));
    $('book-contact').focus();
  }
  // Si el día que se agenda tiene un festivo o está bloqueado, se dice antes de agendar (se puede igual: es a mano).
  function avisoDelDia(k) {
    var l = anunciosDel(k).filter(function (a) { return a.tipo === 'festivo' || a.tipo === 'cierre' || a.tipo === 'lleno'; });
    if (!l.length) return '';
    var a = l[0];
    if (a.tipo === 'lleno') return '. Ojo: ese día ya está lleno.';
    if (a.cerrado) return '. Ojo: ese día está bloqueado; a mano se puede agendar igual.';
    return '. Ojo: es festivo (' + a.titulo + ').';
  }

  // ---------- la vista rápida (una cita) y la vista del día ----------
  function abrirPop(html, disparador, clase) {
    var pop = $('cal-pop');
    pop.className = 'cal-pop' + (clase ? ' ' + clase : '') + (window.matchMedia('(max-width: 600px)').matches ? ' hoja' : '');
    pop.innerHTML = html;
    pop.hidden = false;
    cal.disparador = disparador ? { el: disparador, sel: disparador.getAttribute('data-id') ? '[data-id="' + disparador.getAttribute('data-id') + '"]' : disparador.getAttribute('data-dia') ? '[data-dia="' + disparador.getAttribute('data-dia') + '"]' : '' } : null;
    if (!pop.classList.contains('hoja') && disparador) {
      var r = disparador.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
      var left = r.right + 8;
      if (left + w > window.innerWidth - 12) left = r.left - w - 8;
      if (left < 12) left = Math.max(12, Math.min(window.innerWidth - w - 12, r.left));
      var top = Math.max(12, Math.min(r.top, window.innerHeight - h - 12));
      pop.style.left = left + 'px'; pop.style.top = top + 'px';
    } else { pop.style.left = ''; pop.style.top = ''; }
    var foco = pop.querySelector('h2');
    if (foco) { foco.setAttribute('tabindex', '-1'); foco.focus(); }
    pop.querySelector('[data-cerrar-pop]').onclick = cerrarPop;
  }
  function cerrarPop() {
    var pop = $('cal-pop');
    if (pop.hidden) return;
    pop.hidden = true; pop.innerHTML = '';
    // El foco vuelve a lo que abrió la vista. Si se repintó (una acción recarga el calendario), al que lo reemplazó.
    var d = cal.disparador; cal.disparador = null;
    if (!d) return;
    var el = document.contains(d.el) ? d.el : d.sel ? document.querySelector('#view-calendar ' + d.sel) : null;
    if (el) el.focus();
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('cal-pop').hidden) { e.stopPropagation(); cerrarPop(); } });
  // Un clic afuera cierra. 🪤 Un botón que se reemplaza al tocarlo («Cancelar…» pasa a la confirmación) ya no está en
  // la página cuando el clic llega aquí, así que tampoco está «dentro»: sin mirar isConnected, la vista se cerraba
  // justo al pedir la confirmación.
  document.addEventListener('click', function (e) { var pop = $('cal-pop'); if (!pop.hidden && e.target.isConnected && !pop.contains(e.target) && !e.target.closest('#view-calendar [data-id], #view-calendar [data-dia]')) cerrarPop(); });
  function anunciar(t) { if ($('cal-anuncio')) { $('cal-anuncio').textContent = ''; setTimeout(function () { $('cal-anuncio').textContent = t; }, 30); } }
  function citaPorId(id) {
    var de = function (l) { return (l || []).filter(function (z) { return z.id === id; })[0]; };
    var h = cal.hoy || {};
    return de(cal.todas) || de(h.hoy) || de(h.manana) || (h.proxima && h.proxima.id === id ? h.proxima : null);
  }
  function textoRecordatorio(a) {
    var r = a.reminder;
    if (a.reply === 'confirmó') return { t: 'Confirmó que viene.', tono: 'ok' };
    if (a.reply === 'no_puede') return { t: 'Dijo que no puede: escríbele para moverla.', tono: 'mal' };
    if (r && r.status === 'enviado') return { t: 'Recordada' + (r.at ? ' hace ' + rel(r.at) : '') + (r.note ? ' · ' + r.note : '') + '. Aún no responde.', tono: '' };
    if (r && r.status === 'a_mano') return { t: 'No se pudo enviar solo: hay que recordarle a mano. ' + (r.note || ''), tono: 'aviso', aMano: true };
    if (a.status !== 'confirmada') return null;
    if (a.remindAt && a.remindAt > Date.now()) return { t: 'Sale solo ' + cuandoSale(a.remindAt).replace(/\.?$/, '.'), tono: '' };
    return { t: 'Sin recordatorio automático.', tono: '' };
  }
  var VIDEO = /video|llamada|meet|zoom|teams|en l[ií]nea|virtual|online/i;
  function vistaRapida(id, disparador) {
    var a = citaPorId(id); if (!a) return;
    var who = a.contactName || short(a.userId), d = new Date(a.startsAt), dur = Math.round((a.endsAt - a.startsAt) / 60000);
    var ch = canalDeXen(a.canal), rec = textoRecordatorio(a);
    var deDia = anunciosDel(claveDia(d)).filter(function (x) { return x.tipo === 'festivo' || x.tipo === 'cierre'; })[0];
    var fila = function (k, v, extra) { return v ? '<dt>' + k + '</dt><dd' + (extra ? ' class="' + extra + '"' : '') + '>' + v + '</dd>' : ''; };
    var trato = a.etapaNombre ? esc(a.etapaNombre) + (a.valor ? ' · <span class="num">' + esc(plata(a.valor)) + '</span>' : '') + (a.puntaje != null ? ' · puntaje ' + a.puntaje : '') : '';
    var online = a.enlace || VIDEO.test(a.location || '') || VIDEO.test(a.service || '');
    var enlace = a.enlace
      ? '<div class="qv-enlace"><a class="btn primary" href="' + esc(a.enlace) + '" target="_blank" rel="noopener noreferrer">' + svgXen('video') + 'Abrir videollamada</a><button type="button" class="btn" data-copiar>Copiar enlace</button><button type="button" class="btn sin-borde" data-cambiar>Cambiar</button></div>'
      : '';
    var campo = '<div class="qv-campo"' + (a.enlace || !online ? ' hidden' : '') + '><label for="qv-enlace">Enlace de la videollamada</label><div class="qv-fila"><input id="qv-enlace" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://meet.google.com/…" value="' + esc(a.enlace || '') + '" aria-describedby="qv-enlace-msg"><button type="button" class="btn" data-guardar-enlace>Guardar enlace</button></div><div class="small" id="qv-enlace-msg" role="status">' + (a.enlace ? '' : 'Va en el recordatorio y en el calendario del cliente.') + '</div></div>';
    var agregar = !a.enlace && !online ? '<button type="button" class="btn sin-borde sm" data-agregar-enlace>' + svgXen('video') + 'Agregar enlace de videollamada</button>' : '';
    var acciones = a.status === 'confirmada'
      ? '<button type="button" class="btn primary" data-chat>Abrir chat</button><button type="button" class="btn" data-act="completada">Asistió</button><button type="button" class="btn" data-act="no_asistio">No asistió</button><button type="button" class="btn danger sin-borde" data-cancelar>Cancelar…</button>'
      : '<span class="chip">' + esc(estadoCita(a.status)) + '</span><button type="button" class="btn primary" data-chat>Abrir chat</button>';
    var html = '<div class="qv-cab"><span class="qv-av">' + esc((who.trim()[0] || '?').toUpperCase()) + '</span><div><h2 id="qv-t">' + esc(who) + '</h2><span class="small">' + esc([a.empresa, ch.t].filter(Boolean).join(' · ')) + '</span></div><button type="button" class="btn sin-borde sm qv-x" data-cerrar-pop aria-label="Cerrar">' + svgXen('cerrar') + '</button></div>' +
      (deDia ? filaAnuncio(deDia) : '') +
      '<dl class="qv-datos">' +
      fila('Cuándo', esc(fechaLarga(d)) + ' · ' + esc(hhmm(a.startsAt)) + ' a ' + esc(hhmm(a.endsAt)) + ' <span class="muted">(' + dur + ' min)</span>') +
      fila('Qué', esc(a.service + conSede(a))) +
      fila('Dónde', a.location ? esc(a.location) : '') +
      fila('Trato', trato) +
      fila('Recordatorio', rec ? esc(rec.t) + (rec.aMano ? ' <button type="button" class="btn sm" data-recordado>Ya se lo recordé</button>' : '') : '', rec && rec.tono ? 'ta-' + rec.tono : '') +
      fila('Nota', a.notes ? esc(a.notes) : '') +
      '</dl>' + enlace + campo + agregar +
      '<div class="acts" data-acts>' + acciones + '</div><div class="small" role="status" data-msg></div>';
    abrirPop(html, disparador, 'qv');
    var pop = $('cal-pop');
    pop.setAttribute('aria-labelledby', 'qv-t');
    var msg = pop.querySelector('[data-msg]');
    var tras = function (texto) { anunciar(texto); toast(texto); cerrarPop(); loadCalendar(); };
    pop.querySelector('[data-chat]').onclick = function () { cerrarPop(); go('inbox'); openContact(a.userId); };
    pop.querySelectorAll('[data-act]').forEach(function (b) {
      b.onclick = function () {
        b.disabled = true;
        api('/appointments/' + a.id, { method: 'PATCH', body: { status: b.getAttribute('data-act') } })
          .then(function (r) { if (r && r.error) throw new Error(r.error); tras(b.getAttribute('data-act') === 'completada' ? who + ': asistió.' : who + ': no asistió.'); })
          .catch(function () { b.disabled = false; msg.textContent = 'No se pudo guardar. Vuelve a intentar.'; });
      };
    });
    var cancelar = pop.querySelector('[data-cancelar]');
    if (cancelar) cancelar.onclick = function () {
      // Cancelar le cambia el plan a alguien: se confirma diciendo cuál, y que XENCRM no le avisa.
      var caja = pop.querySelector('[data-acts]');
      caja.innerHTML = '<p class="qv-confirma">¿Cancelar ' + VOC.la + ' ' + VOC.cita + ' de <b>' + esc(who) + '</b> del ' + esc(fechaLarga(d)) + ' a las ' + esc(hhmm(a.startsAt)) + '? XENCRM no le avisa: díselo tú en el chat.</p>' +
        '<button type="button" class="btn danger" data-si>Sí, cancelar ' + VOC.la + ' ' + VOC.cita + '</button><button type="button" class="btn" data-no>No, ' + VOC.g('dejarla') + '</button>';
      caja.querySelector('[data-no]').focus();
      caja.querySelector('[data-no]').onclick = function () { vistaRapida(a.id, cal.disparador && cal.disparador.el); };
      caja.querySelector('[data-si]').onclick = function () {
        this.disabled = true;
        api('/appointments/' + a.id, { method: 'PATCH', body: { status: 'cancelada' } })
          .then(function (r) { if (r && r.error) throw new Error(r.error); tras(VOC.Cita + ' de ' + who + ' ' + VOC.g('cancelada') + '.'); })
          .catch(function () { msg.textContent = 'No se pudo cancelar. Vuelve a intentar.'; });
      };
    };
    var recordado = pop.querySelector('[data-recordado]');
    if (recordado) recordado.onclick = function () {
      recordado.disabled = true;
      api('/appointments/' + a.id + '/reminded', { method: 'POST', body: { by: state.name } }).then(function () { tras('Recordatorio de ' + who + ' marcado.'); }).catch(function () { recordado.disabled = false; msg.textContent = 'No se pudo guardar. Vuelve a intentar.'; });
    };
    var copiar = pop.querySelector('[data-copiar]');
    if (copiar) copiar.onclick = function () {
      var ok = function () { msg.textContent = 'Enlace copiado.'; }, mal = function () { msg.textContent = 'No se pudo copiar: selecciónalo en «Cambiar».'; };
      try { navigator.clipboard.writeText(a.enlace).then(ok, mal); } catch (e) { mal(); }
    };
    var mostrarCampo = function () { pop.querySelector('.qv-campo').hidden = false; var i = $('qv-enlace'); i.focus(); i.select(); };
    if (pop.querySelector('[data-cambiar]')) pop.querySelector('[data-cambiar]').onclick = mostrarCampo;
    if (pop.querySelector('[data-agregar-enlace]')) pop.querySelector('[data-agregar-enlace]').onclick = function () { this.hidden = true; mostrarCampo(); };
    var guardar = pop.querySelector('[data-guardar-enlace]');
    var input = $('qv-enlace');
    // Se valida al guardar y, después de un error, mientras se corrige: no mientras se escribe la primera vez.
    var huboError = false;
    var valido = function (v) { return !v.trim() || /^(https?:\/\/)?[^\s/]+\.[^\s]+$/i.test(v.trim()); };
    input.oninput = function () { if (huboError) { var ok = valido(input.value); input.setAttribute('aria-invalid', String(!ok)); $('qv-enlace-msg').textContent = ok ? '' : 'Pega el enlace completo, como https://meet.google.com/abc-defg-hij'; } };
    input.onkeydown = function (e) { if (e.key === 'Enter') guardar.click(); };
    guardar.onclick = function () {
      if (!valido(input.value)) { huboError = true; input.setAttribute('aria-invalid', 'true'); $('qv-enlace-msg').textContent = 'Pega el enlace completo, como https://meet.google.com/abc-defg-hij'; input.focus(); return; }
      guardar.disabled = true;
      api('/appointments/' + a.id, { method: 'PATCH', body: { enlace: input.value.trim() } }).then(function (r) {
        guardar.disabled = false;
        if (r && r.error) { huboError = true; input.setAttribute('aria-invalid', 'true'); $('qv-enlace-msg').textContent = r.error; input.focus(); return; }
        tras(input.value.trim() ? 'Enlace guardado: va en el recordatorio.' : 'Enlace quitado.');
      }).catch(function () { guardar.disabled = false; $('qv-enlace-msg').textContent = 'No se pudo guardar. Lo que pegaste sigue ahí: vuelve a intentar.'; });
    };
  }
  function vistaDelDia(k, disparador) {
    var d = diaDeClave(k), cu = cupoDel(k), avisos = anunciosDel(k);
    var citas = cal.appts.filter(function (a) { return claveDia(new Date(a.startsAt)) === k; }).sort(function (a, b) { return a.startsAt - b.startsAt; });
    var cfg = agendaVista({ days: [1, 2, 3, 4, 5], hours: [['09:00', '18:00']] });
    var seAtiende = cfg.days.indexOf(d.getDay()) >= 0;
    var bloqueado = diaBloqueado(k) || avisos.some(function (a) { return a.tipo === 'cierre' || (a.tipo === 'festivo' && a.cerrado); });
    var festivo = avisos.filter(function (a) { return a.tipo === 'festivo'; })[0];
    var mant = avisos.filter(function (a) { return a.tipo === 'mantenimiento'; });
    var hoy = sameDay(d, new Date()), pasado = d < new Date(new Date().setHours(0, 0, 0, 0));
    var cupo = cu && cu.total ? '<div class="qd-cupo">' + medidorCupo(cu) + '<span>' + cu.ocupados + ' de ' + cu.total + ' espacios tomados · ' + esc(textoCupo(cu, hoy)) + '</span></div>' : '<div class="qd-cupo"><span>' + esc(bloqueado ? 'Bloqueado' : seAtiende ? 'Sin espacios en la agenda' : 'Este día no se atiende') + '</span></div>';
    var lista = citas.length ? '<ul class="qd-lista">' + citas.map(function (a) { return '<li><button type="button" class="qd-cita ' + a.status + '" data-cita="' + a.id + '"><span class="t">' + esc(hhmm(a.startsAt)) + '</span><span>' + esc(a.contactName || short(a.userId)) + '</span>' + (a.status !== 'confirmada' ? '<span class="chip">' + esc(estadoCita(a.status)) + '</span>' : '') + '</button></li>'; }).join('') + '</ul>' : '<p class="small muted">' + VOC.Ninguna + ' ' + VOC.cita + ' este día.</p>';
    // Bloquear cambia lo que ofrece el asistente a todos: es de quien administra (channels/candado.ts no lo deja).
    var dondeSede = cal.sede && variasSedes() ? ' en ' + nombreSede(cal.sede) : '';
    var bloquear = enCandado() || pasado || !seAtiende ? '' : bloqueado
      ? '<button type="button" class="btn" data-abrir-dia>' + svgXen('candado-nota') + 'Abrir el día' + esc(dondeSede) + '</button>'
      : '<details class="qd-bloquear"><summary class="btn">' + svgXen('candado-nota') + 'Bloquear el día' + esc(dondeSede) + '</summary><label for="qd-motivo">Motivo (opcional)</label><div class="qv-fila"><input id="qd-motivo" maxlength="80" autocomplete="off" value="' + esc(festivo ? festivo.titulo : '') + '" placeholder="Festivo, viaje, inventario…"><button type="button" class="btn primary" data-bloquear>Bloquear</button></div><p class="small muted">' + esc(agenteXen()) + ' deja de ofrecerlo. Lo ya agendado se queda: muévelo o atiéndelo.</p></details>';
    var html = '<div class="qv-cab"><div><h2 id="qd-t">' + esc(fechaLarga(d)) + '</h2><span class="small">' + esc(hoy ? 'Hoy' : festivo ? 'Festivo' : seAtiende ? 'Se atiende' : 'No se atiende') + '</span></div><button type="button" class="btn sin-borde sm qv-x" data-cerrar-pop aria-label="Cerrar">' + svgXen('cerrar') + '</button></div>' +
      (avisos.length ? '<div class="qd-avisos">' + avisos.map(function (a) { return filaAnuncio(a); }).join('') + '</div>' : '') +
      cupo + lista +
      '<div class="acts">' + (seAtiende && !pasado ? '<button type="button" class="btn primary" data-agendar>Agendar este día</button>' : '') + (mant.length ? '<button type="button" class="btn" data-mant>Ver mantenimientos</button>' : '') + bloquear + '</div><div class="small" role="status" data-msg></div>';
    abrirPop(html, disparador, 'qd');
    var pop = $('cal-pop');
    pop.setAttribute('aria-labelledby', 'qd-t');
    var msg = pop.querySelector('[data-msg]');
    pop.querySelectorAll('[data-cita]').forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); vistaRapida(Number(b.getAttribute('data-cita')), cal.disparador && cal.disparador.el); }; });
    if (pop.querySelector('[data-agendar]')) pop.querySelector('[data-agendar]').onclick = function () {
      // A la primera hora que abre ese día (o la siguiente media hora, si es hoy).
      var h = cfg.hours && cfg.hours.length ? cfg.hours.slice().sort(function (a, b) { return hm(a[0]) - hm(b[0]); })[0][0] : '09:00';
      var t = new Date(d); t.setHours(Math.floor(hm(h)), Math.round((hm(h) % 1) * 60), 0, 0);
      if (hoy && t < new Date()) { t = new Date(); t.setMinutes(t.getMinutes() < 30 ? 30 : 60, 0, 0); }
      cerrarPop(); elegirHueco(t);
    };
    if (pop.querySelector('[data-mant]')) pop.querySelector('[data-mant]').onclick = function () { cerrarPop(); go('mantenimientos'); };
    if (pop.querySelector('[data-bloquear]')) {
      var motivo = $('qd-motivo');
      motivo.onkeydown = function (e) { if (e.key === 'Enter') pop.querySelector('[data-bloquear]').click(); };
      pop.querySelector('[data-bloquear]').onclick = function () {
        var b = this; b.disabled = true;
        api('/agenda/cierres', { method: 'POST', body: { fecha: k, sede: cal.sede && variasSedes() ? cal.sede : '', motivo: motivo.value } }).then(function (r) {
          if (r && r.error) { b.disabled = false; msg.textContent = r.error; return; }
          var t = 'Día bloqueado: ' + agenteXen() + ' no ofrece el ' + fechaLarga(d) + '.'; anunciar(t); toast(t); cerrarPop(); loadCalendar();
        }).catch(function () { b.disabled = false; msg.textContent = 'No se pudo bloquear. Vuelve a intentar.'; });
      };
    }
    if (pop.querySelector('[data-abrir-dia]')) pop.querySelector('[data-abrir-dia]').onclick = function () {
      var b = this; b.disabled = true;
      api('/agenda/cierres/' + k + deLaSedeQs(true), { method: 'DELETE' }).then(function (r) {
        if (r && r.error) { b.disabled = false; msg.textContent = r.error; return; }
        // Abrir solo quita el bloqueo de quien se mira. Si el día sigue cerrado (bloqueado para todas las sedes), se dice.
        var t = r && r.abierto ? 'Día abierto: ' + agenteXen() + ' vuelve a ofrecerlo.' : 'Este día está bloqueado para todas las sedes: ábrelo desde «Todas las sedes».';
        anunciar(t); toast(t); cerrarPop(); loadCalendar();
      }).catch(function () { b.disabled = false; msg.textContent = 'No se pudo abrir. Vuelve a intentar.'; });
    };
  }

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
      var d = addDays(inicio, i), k = claveDia(d);
      var delMes = d.getMonth() === mo;
      var abierto = cfg.days.indexOf(d.getDay()) >= 0 && !diaBloqueado(k);
      var citas = cal.appts.filter(function (a) { return sameDay(new Date(a.startsAt), d); })
        .sort(function (a, b) { return a.startsAt - b.startsAt; });
      var dentro = citas.slice(0, 3).map(function (a) {
        return '<button type="button" class="cita ' + a.status + '" data-id="' + a.id + '" aria-label="' + esc(etiquetaCita(a)) + '">' +
          h24(a.startsAt) + ' ' + esc(a.contactName || short(a.userId)) + '</button>';
      }).join('');
      if (citas.length > 3) dentro += '<button type="button" class="mas" data-dia="' + k + '">+' + (citas.length - 3) + ' más</button>';
      var avisos = anunciosDel(k).map(function (a) { return chipAnuncio(a, false); }).join('');
      celdas.push('<div class="dia' + (delMes ? '' : ' otro') + (abierto ? '' : ' cerrado') + (sameDay(d, hoy) ? ' hoy' : '') + '">' +
        '<div class="dia-cab"><span class="dia-avisos">' + avisos + '</span><button type="button" class="n" data-dia="' + k + '" aria-label="' + esc(fechaLarga(d) + '. Ver el día') + '">' + d.getDate() + '</button></div>' + dentro + '</div>');
    }
    $('cal-month').innerHTML = cab + '<div class="mes">' + celdas.join('') + '</div>';
    enlazarCal($('cal-month'));
  }

  // ---------- Agenda: lo que viene, en lista ----------
  function renderAgenda() {
    // Todo lo que viene, en orden, sin importar qué semana esté puesta arriba. Los días con un anuncio salen aunque
    // no tengan citas: un festivo o un mantenimiento la semana entrante también es «lo que viene».
    var desde = Date.now() - 2 * 3600000;
    var list = cal.appts.filter(function (a) { return a.startsAt >= desde; }).sort(function (a, b) { return a.startsAt - b.startsAt; });
    var porDia = {};
    list.forEach(function (a) { var k = claveDia(new Date(a.startsAt)); (porDia[k] = porDia[k] || []).push(a); });
    ((cal.vista && cal.vista.anuncios) || []).forEach(function (a) { if (a.fecha >= claveDia(new Date())) porDia[a.fecha] = porDia[a.fecha] || []; });
    var claves = Object.keys(porDia).sort();
    if (!claves.length) {
      $('cal-list').innerHTML = '<div class="cal-vacio"><b>No hay ' + VOC.citas + ' ' + VOC.g('próximas') + '.</b><span>Cuando ' + esc(agenteXen()) + ' agende ' + VOC.una + ', sale aquí. También puedes agendar desde el panel.</span><button type="button" class="btn" data-ir-agendar>Agendar ' + VOC.una + ' ' + VOC.cita + '</button></div>';
      $('cal-list').querySelector('[data-ir-agendar]').onclick = function () { $('book-contact').focus(); };
      return;
    }
    var ahora = Date.now();
    $('cal-list').innerHTML = claves.map(function (k) {
      return '<div class="day"><h3>' + esc(fechaLarga(diaDeClave(k))) + '</h3>' + anunciosDel(k).map(function (a) { return filaAnuncio(a, true); }).join('') + porDia[k].map(function (a) {
        var ch = canalDeXen(a.canal), empezo = a.startsAt <= ahora;
        return '<div class="appt ' + a.status + '"><span class="t">' + hhmm(a.startsAt) + '<small>' + Math.round((a.endsAt - a.startsAt) / 60000) + ' min</small></span>' +
          '<span class="grow"><button type="button" class="appt-quien" data-id="' + a.id + '"><b>' + esc(a.contactName || short(a.userId)) + '</b>' + (a.empresa ? ' <span class="muted">· ' + esc(a.empresa) + '</span>' : '') + '</button>' +
          '<span class="appt-datos small"><span class="ev-ic" title="' + esc(ch.t) + '">' + svgXen(ch.ic) + '</span>' + esc(a.service + conSede(a)) + (a.valor ? ' · <span class="num">' + esc(plata(a.valor)) + '</span>' : '') + (a.enlace ? ' · ' + svgXen('video') + 'con enlace' : '') + '</span>' + reminderChip(a) + '</span>' +
          // Asistió y No asistió, en la fila, solo cuando ya empezó: antes no hay nada que anotar. Lo demás, en la vista rápida.
          (a.status === 'confirmada' && empezo ? '<button class="btn sm" data-act="completada" data-aid="' + a.id + '">Asistió</button><button class="btn sm" data-act="no_asistio" data-aid="' + a.id + '">No asistió</button>' : a.status !== 'confirmada' ? '<span class="chip">' + esc(estadoCita(a.status)) + '</span>' : '') +
          '<button class="btn sm" data-open="' + esc(a.userId) + '">Chat</button></div>';
      }).join('') + '</div>';
    }).join('');
    $('cal-list').querySelectorAll('[data-act]').forEach(function (b) { b.onclick = function () { b.disabled = true; api('/appointments/' + b.getAttribute('data-aid'), { method: 'PATCH', body: { status: b.getAttribute('data-act') } }).then(loadCalendar); }; });
    $('cal-list').querySelectorAll('[data-open]').forEach(function (b) { b.onclick = function () { go('inbox'); openContact(b.getAttribute('data-open')); }; });
    enlazarCal($('cal-list'));
  }

  // ---------- el panel «Hoy» ----------
  function cargarHoy() {
    if (!cal.hoy) pintarHoy();
    api('/agenda/hoy' + deLaSedeQs(true)).then(function (d) {
      if (!d || d.error) throw new Error('hoy');
      cal.hoy = d; cal.hoyError = false; pintarHoy();
    }).catch(function (e) { if (String(e && e.message) === '401') return; cal.hoyError = true; pintarHoy(); });
  }
  /**
   * La cuenta regresiva de la próxima cita, en palabras: «en 12 min», «en 3 h 20 min», «en 2 d 4 h». Mientras
   * dura, «en curso · termina en 20 min». Se repinta cada 30 s sin pedir nada al servidor.
   */
  function cuentaRegresiva(a, ahora) {
    var falta = a.startsAt - ahora;
    if (falta <= 0) { var queda = Math.max(1, Math.round((a.endsAt - ahora) / 60000)); return { t: 'En curso · termina en ' + queda + ' min', ya: true }; }
    var min = Math.ceil(falta / 60000);
    if (min < 60) return { t: 'Empieza en ' + min + ' min', ya: true };
    var h = Math.floor(min / 60), m = min % 60;
    if (h < 24) return { t: 'En ' + h + ' h' + (m ? ' ' + m + ' min' : ''), ya: false };
    var dd = Math.floor(h / 24), hh = h % 24;
    return { t: 'En ' + dd + ' d' + (hh ? ' ' + hh + ' h' : ''), ya: false };
  }
  function pintarCuenta() {
    var el = $('cal-cuenta'), p = cal.hoy && cal.hoy.proxima;
    if (!el || !p) return;
    if (p.endsAt <= Date.now()) { cargarHoy(); return; }
    var c = cuentaRegresiva(p, Date.now());
    el.textContent = c.t;
    $('cal-proxima').classList.toggle('pronto', c.ya);
  }
  setInterval(function () { if (state.view === 'calendar') pintarCuenta(); }, 30000);
  function filaHoy(a) {
    var est = a.status !== 'confirmada' ? '<span class="chip">' + esc(estadoCita(a.status)) + '</span>' : iconoRecordatorio(a);
    return '<li><button type="button" class="hp-fila ' + a.status + '" data-id="' + a.id + '" aria-label="' + esc(etiquetaCita(a)) + '"><span class="t">' + esc(hhmm(a.startsAt)) + '</span><span class="q">' + esc(a.contactName || short(a.userId)) + '</span>' + est + '</button></li>';
  }
  function pintarHoy() {
    var px = $('cal-proxima'), ph = $('cal-hoy');
    if (!px || !ph) return;
    var d = cal.hoy;
    if (!d && !cal.hoyError) {
      // Cargando: la forma de lo que viene, para que el panel no salte al llegar.
      px.innerHTML = '<span class="fx-esq fx-esq-linea" style="width:40%"></span><span class="fx-esq fx-esq-titulo" style="width:60%"></span><span class="fx-esq fx-esq-linea" style="width:80%"></span><span class="fx-esq fx-esq-linea" style="width:55%"></span>';
      ph.innerHTML = '<span class="fx-esq fx-esq-linea" style="width:30%"></span><span class="fx-esq fx-esq-linea" style="width:90%"></span><span class="fx-esq fx-esq-linea" style="width:85%"></span><span class="fx-esq fx-esq-linea" style="width:30%;margin-top:12px"></span><span class="fx-esq fx-esq-linea" style="width:90%"></span>';
      px.setAttribute('aria-busy', 'true'); ph.setAttribute('aria-busy', 'true');
      return;
    }
    px.removeAttribute('aria-busy'); ph.removeAttribute('aria-busy');
    if (cal.hoyError && !d) {
      px.innerHTML = '<div class="cal-vacio" role="alert"><b>No se pudo cargar lo de hoy.</b><span>El calendario sigue funcionando.</span><button type="button" class="btn sm" data-reintentar>Reintentar</button></div>';
      px.querySelector('[data-reintentar]').onclick = cargarHoy;
      ph.innerHTML = ''; ph.hidden = true;
      return;
    }
    ph.hidden = false;
    var p = d.proxima;
    var proxima = VOC.g('Próxima') + ' ' + VOC.cita;
    if (p) {
      var c = cuentaRegresiva(p, Date.now()), ch = canalDeXen(p.canal);
      var cu = (d.cupo || []).filter(function (x) { return x.fecha === claveDia(new Date(p.startsAt)); })[0];
      px.classList.toggle('pronto', c.ya);
      px.innerHTML = '<h2 class="hp-k">' + esc(proxima) + '</h2>' +
        '<p class="hp-cuenta" id="cal-cuenta">' + esc(c.t) + '</p>' +
        '<p class="hp-quien"><b>' + esc(p.contactName || short(p.userId)) + '</b>' + (p.empresa ? '<span>' + esc(p.empresa) + '</span>' : '') + '</p>' +
        '<p class="hp-cuando">' + esc(fechaLarga(new Date(p.startsAt))) + ' · ' + esc(hhmm(p.startsAt)) + ' a ' + esc(hhmm(p.endsAt)) + '<br>' + svgXen(ch.ic) + esc(ch.t) + (p.valor ? ' · <span class="num">' + esc(plata(p.valor)) + '</span>' : '') + '</p>' +
        (cu && cu.festivo ? '<p class="hp-ojo">' + svgXen('estrella') + 'Ese día es festivo: ' + esc(cu.festivo) + '.</p>' : '') +
        (p.reply === 'no_puede' ? '<p class="hp-ojo">' + svgXen('alerta') + 'Dijo que no puede: escríbele para moverla.</p>' : '') +
        '<div class="hp-acc">' + (p.enlace ? '<a class="btn primary" href="' + esc(p.enlace) + '" target="_blank" rel="noopener noreferrer">' + svgXen('video') + 'Abrir videollamada</a>' : '<button type="button" class="btn primary" data-chat>Abrir chat</button>') +
        '<button type="button" class="btn" data-id="' + p.id + '">Ver detalle</button></div>';
      if (px.querySelector('[data-chat]')) px.querySelector('[data-chat]').onclick = function () { go('inbox'); openContact(p.userId); };
    } else {
      px.classList.remove('pronto');
      px.innerHTML = '<h2 class="hp-k">' + esc(proxima) + '</h2><p class="hp-nada">' + VOC.Ninguna + ' ' + VOC.cita + ' por delante.</p><p class="small">Cuando ' + esc(agenteXen()) + ' agende ' + VOC.una + ', sale aquí con su cuenta regresiva.</p><div class="hp-acc"><button type="button" class="btn" data-ir-agendar>Agendar ' + VOC.una + ' ' + VOC.cita + '</button></div>';
      px.querySelector('[data-ir-agendar]').onclick = function () { $('book-contact').focus(); };
    }
    var rec = d.recordatorios || { activos: false, lista: [] };
    var aMano = rec.lista.filter(function (r) { return r.estado === 'a_mano'; });
    var otros = rec.lista.filter(function (r) { return r.estado !== 'a_mano'; });
    var recHtml = !rec.activos ? '' : '<h3>Recordatorios</h3>' + (aMano.length ? aMano.map(function (r) {
      var wa = r.number ? '<a class="btn sm primary" target="_blank" rel="noopener" href="https://wa.me/' + esc(r.number) + '?text=' + encodeURIComponent(r.text || '') + '">Abrir WhatsApp</a>' : '';
      return '<div class="hp-rec aviso"><span><b>' + esc(r.contactName || short(r.userId)) + '</b> · ' + esc(hhmm(r.startsAt)) + '<br><span class="small">Hay que recordarle a mano.</span></span><span class="hp-acc">' + wa + '<button type="button" class="btn sm" data-recordado="' + r.id + '">Ya se lo recordé</button></span></div>';
    }).join('') : '') + (otros.length ? '<ul class="hp-lista">' + otros.map(function (r) {
      var t = { programado: 'sale solo ' + cuandoSale(r.remindAt), enviado: 'recordada, sin respuesta', 'confirmó': 'confirmó', no_puede: 'dijo que no puede' }[r.estado];
      return '<li class="hp-mini' + (r.estado === 'no_puede' ? ' mal' : r.estado === 'confirmó' ? ' ok' : '') + '"><b>' + esc(r.contactName || short(r.userId)) + '</b> ' + esc(t) + '</li>';
    }).join('') + '</ul>' : '') + (!aMano.length && !otros.length ? '<p class="small muted">Nada pendiente. Los de mañana salen solos a las ' + esc(horaDe((cal.cfg && cal.cfg.reminder && cal.cfg.reminder.at) || '08:00')).replace(/\.?$/, '.') + '</p>' : '');
    var cupoHtml = (d.cupo || []).length ? '<h3>Cupo</h3><ul class="hp-cupos">' + d.cupo.map(function (c) {
      var dia = diaDeClave(c.fecha), esHoy = sameDay(dia, new Date());
      return '<li><button type="button" class="hp-cupo" data-ir-dia="' + c.fecha + '" aria-label="' + esc(fechaLarga(dia) + ': ' + textoCupo(c, esHoy) + (c.festivo ? ', festivo' : '') + '. Ver el día') + '"><span class="d">' + esc(esHoy ? 'Hoy' : fechaCorta(dia)) + (c.festivo ? ' <span class="hp-fest" title="' + esc(c.festivo) + '">Festivo</span>' : '') + '</span>' + medidorCupo(c) + '<span class="n">' + esc(textoCupo(c, esHoy)) + '</span></button></li>';
    }).join('') + '</ul>' : '';
    ph.innerHTML = '<h3>Hoy <span class="muted">· ' + esc(fechaLarga(new Date())) + '</span></h3>' + (d.hoy.length ? '<ul class="hp-lista">' + d.hoy.map(filaHoy).join('') + '</ul>' : '<p class="small muted">' + VOC.Ninguna + ' ' + VOC.cita + ' hoy.</p>') +
      '<h3>Mañana</h3>' + (d.manana.length ? '<ul class="hp-lista">' + d.manana.map(filaHoy).join('') + '</ul>' : '<p class="small muted">Nada agendado.</p>') +
      recHtml + cupoHtml;
    enlazarCal(px); enlazarCal(ph);
    ph.querySelectorAll('[data-recordado]').forEach(function (b) {
      b.onclick = function () { b.disabled = true; api('/appointments/' + b.getAttribute('data-recordado') + '/reminded', { method: 'POST', body: { by: state.name } }).then(function () { toast('Recordatorio marcado.'); loadCalendar(); }).catch(function () { b.disabled = false; }); };
    });
    // El cupo de un día lleva a su semana y abre ese día.
    ph.querySelectorAll('[data-ir-dia]').forEach(function (b) {
      b.onclick = function () {
        var k = b.getAttribute('data-ir-dia'), dia = diaDeClave(k);
        if (cal.mode === 'month') cal.start = new Date(dia.getFullYear(), dia.getMonth(), 1); else if (cal.mode === 'week') cal.start = startOfWeek(dia);
        cal.abrirDia = k;
        loadCalendar();
      };
    });
  }

  // 🪤 Cambiar de modo RECARGA, no solo repinta: Semana pide una semana y Agenda pide cuatro meses. Repintando
  // a secas, Agenda enseñaba lo que había traído Semana —una semana— y seguía diciendo que no hay citas.
  $('cal-week-btn').onclick = function () { cal.mode = 'week'; helpSet('xencrm.cal.mode', 'week'); loadCalendar(); };
  $('cal-agenda-btn').onclick = function () { cal.mode = 'agenda'; helpSet('xencrm.cal.mode', 'agenda'); loadCalendar(); };
  $('cal-month-btn').onclick = function () {
    cal.mode = 'month';
    // 🪤 Se ancla al mes de MITAD de semana, no al del lunes. La semana del 28 de septiembre tiene su lunes en
    // septiembre y casi toda ella en octubre: entrando desde ahí un 2 de octubre, el mes abría en septiembre y
    // parecía que el calendario se había ido al pasado.
    var medio = addDays(cal.start, 3);
    cal.start = new Date(medio.getFullYear(), medio.getMonth(), 1);
    helpSet('xencrm.cal.mode', 'month');
    loadCalendar();
  };
  var mover = function (signo) {
    if (cal.mode === 'month') cal.start = new Date(cal.start.getFullYear(), cal.start.getMonth() + signo, 1);
    else cal.start = addDays(cal.start, 7 * signo);
    loadCalendar();
  };
  $('cal-prev').onclick = function () { mover(-1); };
  $('cal-next').onclick = function () { mover(1); };
  $('cal-today').onclick = function () { cal.start = cal.mode === 'month' ? new Date(new Date().getFullYear(), new Date().getMonth(), 1) : startOfWeek(new Date()); loadCalendar(); };
  $('cal-sede').onchange = function () {
    cal.sede = $('cal-sede').value;
    helpSet('xencrm.cal.sede', cal.sede);
    if (cal.sede) $('book-sede').value = cal.sede;
    // Se recarga y no solo se repinta: los bloques ocupados, el cupo y el panel también cambian con la sede.
    loadCalendar();
  };
  $('book-when').onchange = function () { var v = $('book-when').value; $('book-msg').textContent = v ? avisoDelDia(v.slice(0, 10)).replace(/^\. /, '') : ''; };
  $('book-btn').onclick = function () {
    var userId = $('book-contact').value, when = $('book-when').value; if (!userId || !when) { $('book-msg').textContent = 'Elige contacto y fecha.'; return; }
    if (variasSedes() && !$('book-sede').value) { $('book-msg').textContent = 'Elige en qué sede.'; return; }
    $('book-btn').disabled = true;
    api('/appointments', { method: 'POST', body: { userId: userId, startsAt: new Date(when).toISOString(), notes: $('book-notes').value, sede: variasSedes() ? $('book-sede').value : undefined } }).then(function (r) { $('book-btn').disabled = false; $('book-msg').textContent = r.error ? 'Error: ' + r.error : VOC.Cita + ' ' + VOC.g('agendada') + '.'; if (!r.error) $('book-notes').value = ''; loadCalendar(); })
      .catch(function () { $('book-btn').disabled = false; $('book-msg').textContent = 'No se pudo agendar. Vuelve a intentar.'; });
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
    // XEN: Analítica abre en la pestaña que se dejó, y el sentimiento se pide siempre (el Resumen también lo cuenta).
    xaPestana(XA.tab);
    cargarSentimiento();
    cargarSeries();
    api('/stats').then(function (s) {
      var tiles = [
        { n: s.total, l: 'Contactos', f: 'all' },
        { n: s.unread, l: 'Mensajes sin leer', f: 'unread' },
        // «Prospecto claro» es lenguaje del puntaje: en el modo fácil, que no lo enseña, se dice como su filtro.
        { n: s.hot, l: esFacil() ? 'Prospectos' : 'Prospectos claros', f: 'hot' },
        { n: s.human, l: 'Atendidos por una persona', f: 'human' },
        // Por papel, no por nombre: en un negocio de soporte no existe "interesado" ni "cita_agendada".
        { n: s.byStage[etapaCon('interes')] || 0, l: state.stageLabels[etapaCon('interes')] || 'Interesados', f: 'stage:' + etapaCon('interes') },
        { n: s.byStage[etapaCon('cita')] || 0, l: state.stageLabels[etapaCon('cita')] || 'Con ' + VOC.cita, f: 'stage:' + etapaCon('cita') },
        { n: s.upcomingAppointments, l: VOC.Citas + ' en los próximos 7 días', v: 'calendar' },
        { n: s.messagesToday, l: 'Mensajes de clientes (24 h)', f: 'all' },
      ];
      // 🪤 Las que abren un filtro que el modo fácil esconde (con una persona, por etapa) se esconden con él: si no,
      // llevaban a la bandeja con un filtro puesto que no se ve y no se puede quitar.
      $('tiles').innerHTML = tiles.map(function (t, i) { return '<button class="tile' + (t.f && FILTROS_COMPLETOS.test(t.f) ? ' solo-completo' : '') + '" data-i="' + i + '"><b>' + t.n + '</b><span>' + esc(t.l) + '</span><span class="go">ver →</span></button>'; }).join('');
      $('tiles').querySelectorAll('.tile').forEach(function (b) { b.onclick = function () { var t = tiles[Number(b.getAttribute('data-i'))]; if (t.v) go(t.v); else go('inbox', { filter: t.f }); }; });
      var max = Math.max(1, s.total);
      $('funnel').innerHTML = Object.keys(s.stageLabels).map(function (k) { var n = s.byStage[k] || 0; return '<div class="f" data-rol="' + esc(rol(k) || '') + '" data-f="stage:' + k + '"><span>' + esc(s.stageLabels[k]) + '</span><div class="bar"><i style="width:' + Math.round((n / max) * 100) + '%"></i></div><b>' + n + '</b></div>'; }).join('');
      $('funnel').querySelectorAll('.f').forEach(function (f) { f.onclick = function () { go('inbox', { filter: f.getAttribute('data-f') }); }; });
      bindExport();
      // El ánimo de aquí es el mismo de la pestaña Sentimiento (crm/sentimiento.ts: sin archivados ni grupos); de
      // /stats solo se toma el puntaje promedio, que es del completo.
      XA.puntaje = s.avgScore;
      pintarMiniSentimiento();
    });
  }

  // ---------- agente ----------
  function usd(n) { return n === null || n === undefined ? 's/p' : '$' + (n < 0.01 ? n.toFixed(4) : n < 1 ? n.toFixed(3) : n.toFixed(2)); }
  var TASKS = { light: 'Responder (liviano)', heavy: 'Responder (pesado)', gate: 'Clasificar mensaje', analysis: 'Análisis y puntaje', when: 'Interpretar fechas', agente: 'Responder con herramientas', copiloto: 'Copiloto del equipo' };
  // El mes y su tope (src/crm/presupuesto.ts). Aquí solo se lee: el tope lo pone quien administra XENCRM.
  var TOPE_DICE = {
    aviso: 'Al 90 % empieza a ahorrar.',
    ahorro: 'Ahorrando: lo específico lo contesta el modelo de responder, que es el barato.',
    agotado: 'Llegó al tope: hasta el mes siguiente, lo que necesita IA te llega a ti para contestarlo a mano. Lo que se resuelve sin IA, como ' + VOC.las + ' ' + VOC.citas + ', sigue igual.'
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
      '<div class="small">Suscríbete desde Google Calendar, Outlook o Apple Calendar para ver ' + VOC.las + ' ' + VOC.citas + '. El enlace es secreto: quien lo tenga ve nombres y teléfonos.</div>' +
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
        ['¿Qué hago con «Recordar a mano»?', 'Son ' + VOC.citas + ' de mañana cuyo recordatorio no pudo salir solo (por ejemplo, el cliente llegó por el chat del sitio). «Abrir WhatsApp» abre el chat con el mensaje ya escrito; después dale «Ya se lo recordé».'],
        ['¿Para qué sirve «¿Cómo les fue?» en Hoy?', 'Cuando ' + VOC.una + ' ' + VOC.cita + ' ya pasó, marca si el cliente vino, no vino o compró. Así el tablero sabe cómo terminó cada prospecto y, con el tiempo, el puntaje se ajusta a lo que de verdad pasa en el negocio.'],
        ['¿Qué significan «Confirmó» y «No puede» en ' + VOC.una + ' ' + VOC.cita + '?', 'Es lo que respondió el cliente al recordatorio. Si no puede, ' + ag + ' ya le ofreció moverla o cancelarla, y te avisa.'],
        ['¿Por qué no puedo escribirle a un cliente de WhatsApp oficial?', 'WhatsApp solo deja escribir hasta 24 horas después del último mensaje del cliente. Pasado ese tiempo, toca esperar a que vuelva a escribir o usar una plantilla aprobada por Meta. El tablero lo avisa antes de que escribas.'],
        // El tercer dato dice cuándo NO va: 'candado' si habla de algo que con el candado no se ve, 'facil' si es del
        // puntaje, que el modo fácil esconde. Una respuesta que manda a una pantalla que no está confunde más que no tenerla.
        ['¿Qué pasa si dejo algo del Perfil vacío?', 'Queda «Por confirmar». Si un cliente pregunta por eso, ' + ag + ' no lo supone: responde «' + verify + '» y la pregunta te llega a Hoy.', 'candado'],
        ['¿Cómo le enseño a ' + ag + ' una frase que no entendió?', 'En Agente › Frases que no entendimos, dale «Enseñar» y escribe qué quiere decir (por ejemplo, «a la hora del cafecito» quiere decir «a las 3»). Solo se guarda si con eso ya la entiende.', 'candado'],
        ['¿«Caliente» y «Prospecto claro» son lo mismo?', 'Sí: es el mismo puntaje. En tarjetas y avisos se dice con temperatura (frío, tibio, caliente); en la ficha, con el veredicto. Los colores coinciden.', 'facil'],
        ['En el celular, ¿dónde están Perfil, Canales o Salir?', 'En «Más», el último botón de la barra de abajo: ahí están Análisis, Perfil, Agente, Canales, Lo que sabe, Ayuda, el tema, el sonido y Salir.', 'candado'],
        ['¿Qué es «Lo que sabe»?', 'La información que ' + ag + ' tiene de ' + biz + ': el catálogo y los textos del negocio. Sirve para buscar qué sabe de un tema.', 'candado'],
      ],
      never: ['Inventar precios, fechas, políticas o productos: lo que no sabe, lo verifica con el equipo.', 'Elegir una fecha por su cuenta: ' + VOC.las + ' ' + VOC.citas + ' salen siempre de la agenda real.', 'Cancelar o mover ' + VOC.una + ' ' + VOC.cita + ' sin que el cliente lo confirme.', 'Escribir por WhatsApp oficial fuera de las 24 horas sin plantilla.', 'Seguir respondiendo cuando una persona del equipo tomó la conversación.'],
    };
  }
  function loadHelp() {
    helpSet('xencrm.help.seen', true);
    api('/agent').then(function (a) {
      var h = helpContent(a), done = helpGet('xencrm.help.done') || {};
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
          var i = b.getAttribute('data-done'), d = helpGet('xencrm.help.done') || {};
          d[i] = !d[i]; helpSet('xencrm.help.done', d); loadHelp();
        };
      });
    });
  }
  // Primera vez: un aviso en Hoy que lleva al tutorial (se va al abrir Ayuda o con "No mostrar más").
  function helpBanner() {
    if (helpGet('xencrm.help.seen')) return '';
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
    // Con el candado tampoco: cada paso de la guía lleva a la configuración, que es de quien administra XENCRM.
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
      if ($('help-hide')) $('help-hide').onclick = function () { helpSet('xencrm.help.seen', true); loadToday(); };
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
    return '<div class="prof-extra" data-extra="' + i + '"><input type="text" aria-label="Dato" value="' + esc(x.title) + '" placeholder="Qué dato (por ejemplo: ' + esc(VOC.ej.datoPropio || 'Tiempos de entrega') + ')"><button class="btn sm" type="button" data-rm="' + i + '">Quitar</button>' +
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
        // Llevarse lo aprendido: es lo único de XENCRM que no se puede volver a escribir a mano.
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
          try { datos = JSON.parse(txt); } catch (e) { $('ap-msg').textContent = 'Ese archivo no es un aprendizaje de XENCRM (ni de XENCRM).'; return; }
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
      '<div class="panel prof"><b>Otros datos</b><div class="small muted">Lo propio de este negocio: ' + esc(VOC.ej.datosPropios || 'tiempos de entrega, garantías, lo que ofrecen o no') + '.</div><div id="pf-extras">' +
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
  // Qué pasa con las conversaciones viejas (src/crm/retencion.ts). Aquí solo se lee: la pone quien administra XENCRM.
  function retencionLinea(r) {
    if (!r || r.error) return '';
    var p = r.politica, u = r.ultima;
    if (!p) return '<div class="small muted">Las conversaciones se guardan sin límite de tiempo. Si prefieres que las viejas se anonimicen solas, pídelo.</div>';
    var que = p.accion === 'borrar' ? 'se borran del todo' : 'se anonimizan: se quitan el nombre, el teléfono y los mensajes, y quedan las cuentas del embudo';
    var cuando = u && !u.error && u.cuantos ? ' La última vez, el ' + new Date(u.ts).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }) + ', fueron ' + u.cuantos + '.' : '';
    return '<div class="small">Las conversaciones sin movimiento en ' + p.dias + ' días ' + que + '. Nunca las de alguien con ' + VOC.una + ' ' + VOC.cita + ' por delante.' + cuando + '</div>';
  }
  function backupPanel(bk, ret) {
    return '<div class="panel" id="backup-panel"><b>Respaldo de la base</b><div class="small" id="backup-line">' + esc(backupLine(bk)) + '</div>' +
      '<div class="small muted">Una copia al día de contactos, conversaciones y ' + VOC.citas + '; se guardan las últimas 14. Tienen datos de clientes: guárdalas también fuera de este computador (por ejemplo, con Time Machine).</div>' + retencionLinea(ret) +
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
  var MISS_KIND = { fecha: 'Fecha u hora', frase: 'Frase', get cita() { return 'En ' + VOC.la + ' ' + VOC.cita; } };
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
        '<div class="small muted">Lo que las reglas no entendieron: fechas y frases que tuvo que interpretar la IA, y respuestas que sacaron al cliente del flujo de ' + VOC.la + ' ' + VOC.cita + '. Enséñalas y la próxima vez ' + esc(a.agent.name) + ' las entiende sola, sin gastar IA.</div>' +
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

  // Cuando la llevas tú: si XENCRM deja lista la respuesta a lo que sabe (crm/propuestas.ts). Nunca escribe sola ahí.
  function sugierePanel(a) {
    var on = a.sugiereConPersona !== false, ag = esc(a.agent.name || 'Xen');
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
        sugierePanel(a) + agenticoPanel(a) + agentesPanel() +
        '<div class="panel"><b>Motores</b><ul>' + eng + '</ul><div class="small muted">Modo: ' + esc(a.roles.mode) + ' · liviano: ' + esc(a.roles.light) + ' · pesado: ' + esc(a.roles.heavy) + ' · gate: ' + esc(a.roles.gate) + ' · análisis: ' + esc(a.roles.analysis) + '</div><div class="small muted">Modelos: ' + esc(a.models.chat) + ' · embeddings ' + esc(a.models.embed) + ' · nube ' + esc(a.models.openai) + '</div></div>' +
        '<div class="panel"><b>' + VOC.Citas + '</b>' + (ap.enabled ? '<div class="small">' + esc(ap.service) + (ap.location ? ' en ' + esc(ap.location) : '') + ' · ' + ap.durationMin + ' min · días ' + ap.days.join(',') + ' · ' + ap.hours.map(function (h) { return h[0] + '–' + h[1]; }).join(', ') + ' · zona ' + esc(a.timezone) + '</div>' : '<div class="muted small">Desactivadas (appointments.enabled en xencrm.config.json)</div>') + '</div>' +
        '<div class="panel"><b>Análisis comercial</b><div class="small">Campos capturados además de los básicos: ' + a.crmFields.map(function (f) { return '<code>' + esc(f.name) + '</code>'; }).join(' ') + '</div></div>' +
        '<div class="panel"><b>Conocimiento indexado</b><div class="small">' + (a.docs.product || 0) + ' productos · ' + (a.docs.knowledge || 0) + ' fragmentos de información.</div></div>' +
        backupPanel(bk, ret) + usagePanel(usage, tope) + calendarPanel(calCfg) + '<div class="panel" id="miss-panel"></div><div class="panel" id="dict-panel"></div>';
      bindBackup();
      bindSugiere(a);
      bindAgentico(a);
      cargarAgentes();
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
        { id: 'mira', lbl: 'Mira', dice: 'Entra todo al tablero y contestas tú. ' + esc(state.agentName || 'Xen') + ' no dice nada: mira cómo atiendes y aprende.' },
        { id: 'propone', lbl: 'Propone', dice: 'Deja la respuesta escrita y la mandas tú con un toque, o la corriges. No manda nada sola.' },
        { id: 'contesta', lbl: 'Contesta', dice: 'Responde sola a quien escriba.' }
      ];
      var modo = ch.modo || (ch.soloEscucha ? 'mira' : 'contesta');
      var escucha = ch.modo === undefined && ch.soloEscucha === undefined ? '' :
        '<div class="fila" style="gap:10px;align-items:center;margin-top:10px;flex-wrap:wrap">' +
          '<div class="tabs" role="group" aria-label="Qué hace ' + esc(state.agentName || 'Xen') + ' en ' + esc(ch.name) + '">' +
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
            ? (state.agentName || 'Xen') + ' aprende de lo que se habla en los grupos. Nunca escribe en ellos.'
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
    // puerta en la salida: quien quiere que XENCRM deje de leerlos tiene que poder hacerlo de un clic.
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
        $('grupos-agente').textContent = state.agentName || 'Xen';
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
    var eq = Array.isArray(window.XENCRM_EQUIPO) ? window.XENCRM_EQUIPO : [];
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
  // una máquina de sus conversaciones; y si algo estuviera mal, XENCRM aconsejaría con seguridad sobre una
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

  // Ensayar: lo que de verdad hace falta antes de enseñar XENCRM en vivo. Dice si la pregunta sale por el guion o
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
    // El tope de la lista es una regla (contactos.tope, 500 de fábrica): más allá, se busca.
    var tope = R('contactos.tope', 500);
    var params = cli.q ? '?q=' + encodeURIComponent(cli.q) + '&limit=' + tope : '?limit=' + tope;
    // XENCRM: mientras llega la lista se ve su forma (esqueleto), no «Nadie por aquí»: eso decía que no había
    // nadie cuando lo que pasaba es que todavía no se sabía. Y si falla, se dice con una salida, no se revienta.
    cli.cargando = true; cli.error = '';
    if (!cli.lista.length) renderClientes();
    return api('/contacts' + params).then(function (list) {
      cli.cargando = false;
      if (!Array.isArray(list)) {
        var porQue = (list && list.error) || 'sin respuesta del servidor';
        // 🪤 Si ya había una lista a la vista, se queda: una recarga que falla (llegan varias por minuto con los
        // eventos en vivo) no puede dejar la pantalla en blanco. Se avisa y ya.
        if (cli.lista.length) { toast('No se pudo actualizar la lista: ' + porQue); return; }
        cli.error = porQue; renderClientes(); return;
      }
      cli.lista = list; renderClientes();
    });
  }

  // Las pestañas de arriba, cada una con su número. «Míos» solo existe si quien mira tiene nombre.
  var GRUPOS_CLI = [
    { g: 'todos', t: 'Todos', es: function () { return true; } },
    { g: 'mios', t: 'Míos', es: esMia, hay: function () { return Boolean(state.name); } },
    // XENCRM (Dynamics 365): los grupos son las VISTAS del sistema de Contactos. Las que guarda cada quien se suman
    // detrás (xfGruposClientes), y los filtros van encima de la vista elegida: un solo estado, `cli.grupo` + `cli.cond`.
    { g: 'sinasignar', t: 'Sin asignar', es: xfSinAsignar },
    { g: 'calientes', t: '🔥 Calientes', es: esCaliente },
    { g: 'prospecto', t: 'Prospectos', es: function (c) { return grupoDe(c) === 'prospecto'; } },
    { g: 'concita', get t() { return 'Con ' + VOC.cita; }, es: xfConCita },
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
    var grupos = xfGruposClientes();
    var pasa = function (c) { return xfCumple(c, xfE('clientes').cond, xfCtx()); };
    if (!grupos.some(function (g) { return g.g === cli.grupo; })) cli.grupo = 'todos';
    var g = grupos.find(function (x) { return x.g === cli.grupo; });
    // Mientras carga la primera vez, los grupos van sin número: «0» diría que no hay nadie, y no se sabe todavía.
    var sinCuenta = (cli.cargando || cli.error) && !cli.lista.length;
    $('cli-filtros').innerHTML = grupos.map(function (x) {
      var n = sinCuenta ? '' : cli.lista.filter(function (c) { return x.es(c) && pasa(c); }).length;
      return '<button data-g="' + esc(x.g) + '" class="' + (x.g === cli.grupo ? 'on' : '') + (x.guardada ? ' xf-guardada' : '') + '" aria-pressed="' + (x.g === cli.grupo) + '">' + esc(x.t) + '<span class="cuenta">' + n + '</span></button>';
    }).join('');
    Array.prototype.forEach.call($('cli-filtros').querySelectorAll('button'), function (b) {
      b.onclick = function () { cli.grupo = b.dataset.g; xfGuardar('clientes'); renderClientes(); };
    });
    xfPintarBarra('clientes');
    // Modo fácil: los mismos grupos, con su número, en un desplegable.
    if ($('fx-cli-grupo')) $('fx-cli-grupo').innerHTML = grupos.map(function (x) {
      return '<option value="' + x.g + '"' + (x.g === cli.grupo ? ' selected' : '') + '>' + esc(x.t.replace(/^\S+\s(?=\S)/, function (m) { return /\w/.test(m) ? m : ''; })) + ' (' + cli.lista.filter(x.es).length + ')</option>';
    }).join('');

    var orden = cli.orden || 'puntaje', al = cli.al || 1;
    var list = cli.lista.filter(function (c) { return g.es(c) && pasa(c); }).sort(function (a, b) { return al * ORDEN_CLI[orden](a, b); });
    cli.ids = list.map(function (c) { return c.id; });

    // Los estados que no son «hay datos»: cargando, falló, nadie en absoluto, nadie con esa búsqueda o ese grupo.
    if (cli.error) { $('cli-tabla').innerHTML = estadoClientes('error'); enganchaEstadoClientes(); return; }
    if (!list.length) {
      $('cli-tabla').innerHTML = cli.cargando ? estadoClientes('cargando') : estadoClientes(cli.q ? 'busqueda' : !cli.lista.length ? 'nadie' : xfHayCond('clientes') ? 'filtros' : 'grupo', g);
      enganchaEstadoClientes();
      return;
    }
    var suma = 0, sinPrecio = 0;
    list.forEach(function (c) { if (c.valor) suma += c.valor; else sinPrecio++; });
    // La cabecera se ordena con un clic; el que manda lleva su flecha y `aria-sort`, que es lo que lee un lector.
    var ordBtn = function (k, t, clase) {
      var on = orden === k;
      return '<button class="orden' + (on ? ' on' : '') + (clase ? ' ' + clase : '') + '" data-orden="' + k + '">' + t + (on ? (al === 1 ? ' ↓' : ' ↑') : '') + '</button>';
    };
    var aria = function (on) { return on ? ' aria-sort="' + (al === 1 ? 'descending' : 'ascending') + '"' : ''; };
    var th = function (k, t, clase) { return '<th class="' + (clase || '') + '"' + aria(orden === k) + '>' + ordBtn(k, t) + '</th>'; };
    // XENCRM (SendPulse): cada contacto es una fila-tarjeta. Quién es y cómo ubicarlo; su último trato (la etapa y
    // lo que toca hacer); lo que contó, como etiquetas; a quién está asignado; cuánto vale y cuándo fue lo último.
    // «La lleva» (quién contesta ahora) no tiene columna propia: va debajo de «Asignado a», que es su pariente.
    // 🪤 La lista llega con tope (los 500 con actividad más reciente: crm/contacts.ts). Si se llenó, se dice ARRIBA:
    // al pie, después de 500 filas, nadie lo lee y parecería que ese es todo el directorio.
    var parcial = cli.lista.length >= R('contactos.tope', 500);
    $('cli-tabla').innerHTML = (cli.q ? '<div class="cli-resumen">Buscando «' + esc(cli.q) + '»</div>' : '') +
      (parcial ? '<div class="cli-resumen fx-ct-parcial" role="note">Se muestran los ' + R('contactos.tope', 500) + ' contactos con actividad más reciente. Para encontrar a alguien más, búscalo por su nombre o su número.</div>' : '') +
      '<table class="cli-tabla"><thead><tr>' +
        // El puntaje ya no tiene columna (no cabía junto a lo demás): va en el último trato, y se ordena desde ahí.
        th('nombre', 'Contacto') + '<th' + aria(orden === 'paso' || orden === 'puntaje') + '>' + ordBtn('paso', 'Último trato') + ordBtn('puntaje', '· puntaje', 'solo-completo fx-ct-ord2') + '</th>' +
        '<th class="fx-ct-datos">Datos</th><th>Asignado a</th>' + th('valor', 'Valor', 'num') + th('vez', 'Última actividad', 'num') +
      '</tr></thead><tbody>' +
      list.map(function (c) {
        var l = llevaDe(c);
        // Sin teléfono (llegó por Instagram, por ejemplo), lo que sí se tenga para ubicarlo: su @ o su correo.
        var ubicar = c.phone || (c.data && c.data.instagram ? '@' + c.data.instagram : '') || (c.data && c.data.correo) || '';
        return '<tr data-id="' + esc(c.id) + '">' +
          '<td data-rot="Contacto" class="fx-ct-quien"><div class="fx-ct-persona">' + avatarHtml(nameOf(c), c.id) + '<div class="fx-ct-nom">' +
            '<div class="fx-ct-linea1"><button class="quien" data-id="' + esc(c.id) + '">' + esc(nameOf(c)) + '</button>' +
            (esCaliente(c) ? '<span class="fuego" title="Caliente: puntaje de 60 para arriba" aria-label="Caliente">🔥</span>' : '') +
            (estaFijado(c.id) ? '<span class="fijo" title="Fijado" aria-label="Fijado">★</span>' : '') + '</div>' +
            '<div class="dato">' + (ubicar ? '<span class="fx-ct-ubicar">' + esc(ubicar) + '</span>' : '') + canalHtml(c.channel) +
              (variasSedes() && c.data && c.data.sede ? '<span>' + esc(nombreSede(c.data.sede)) + '</span>' : '') + '</div>' +
          '</div></div></td>' +
          // El puntaje nunca solo: con su temperatura en palabras («89 · caliente»), y solo en el completo.
          '<td data-rot="Último trato" class="fx-ct-trato proximo"><div class="fx-ct-trato1">' + pastillaEtapa(c.stage) +
            (c.score == null ? '' : '<span class="solo-completo">' + scoreChip(c) + '</span>') + '</div><div class="fx-ct-paso">' +
            // El paso es un enlace al chat, como el nombre del trato en SendPulse: «Contestar» se hace allá.
            (c.proximo && c.proximo.texto ? '<button type="button" class="fx-ct-ir" data-chat="' + esc(c.id) + '" title="Abrir el chat">' + pasoHtml(c.proximo) + '</button>' : pasoHtml(c.proximo)) + '</div>' +
            (c.summary || c.recap ? '<div class="quiere" title="' + esc(c.summary || c.recap) + '">' + esc(c.summary || c.recap) + '</div>' : '') + '</td>' +
          '<td data-rot="Datos" class="fx-ct-datos">' + datosHtml(c) + '</td>' +
          '<td data-rot="Asignado a" class="fx-ct-asignado">' + (c.responsable ? '<span class="fx-ct-quienes">' + avatarHtml(c.responsable, c.responsable, 'sm') + '<span class="nom">' + esc(c.responsable) + '</span></span>' : '<span class="fx-ct-sin">Sin asignar</span>') +
            '<div class="dato solo-completo">' + esc((c.humanMode ? 'La lleva ' : 'Responde ') + l.nombre) + '</div></td>' +
          '<td data-rot="Valor" class="num">' + valorHtml(c) + '</td>' +
          '<td data-rot="Última actividad" class="num dato" title="' + esc(c.lastMessageAt ? new Date(c.lastMessageAt).toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short' }) : '') + '">' + esc(c.lastMessageAt ? rel(c.lastMessageAt) : '—') + '</td>' +
        '</tr>';
      }).join('') + '</tbody>' +
      // Al pie, cuántos y cuánto suman. Lo que no tiene precio se dice al lado: una suma baja por falta de precios
      // y un mes malo son dos problemas muy distintos.
      '<tfoot><tr><td colspan="3">' + list.length + (list.length === 1 ? ' contacto' : ' contactos') + (parcial ? ' (de los 500 más recientes)' : '') + '</td>' +
        '<td class="dato">' + (sinPrecio && suma ? sinPrecio + ' sin precio' : '') + '</td>' +
        '<td class="num">' + (suma ? '<span class="dato">Suma</span> <b>' + esc(plata(suma)) + '</b>' : '') + '</td><td></td></tr></tfoot></table>';
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
    // XENCRM: la fila entera es la tarjeta del contacto, como en SendPulse. Con el teclado se llega por el nombre,
    // que es el botón; el clic en el resto de la fila es solo comodidad del ratón.
    Array.prototype.forEach.call($('cli-tabla').querySelectorAll('tbody tr[data-id]'), function (tr) {
      tr.onclick = function (e) { if (e.target.closest('button, a, select, input')) return; abrirPerfil(tr.dataset.id, cli.ids); };
    });
    Array.prototype.forEach.call($('cli-tabla').querySelectorAll('[data-chat]'), function (b) {
      b.onclick = function () { go('inbox'); openContact(b.dataset.chat); };
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
    pintarRecientes();
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
    $('pf-ctl').innerHTML = '';
    $('pf-nav').hidden = true;
    $('pf-cuerpo').innerHTML = '<div class="small muted">Cargando…</div>';
    if (!$('dlg-perfil').open) $('dlg-perfil').showModal();
    api('/contacts/' + encodeURIComponent(id)).then(function (d) {
      if (d.error) { $('pf-cuerpo').innerHTML = '<div class="empty">' + esc(d.error) + '</div>'; return; }
      PF = d;
      pintarPerfil(d);
      recordarReciente(d.contact);
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
    $('pf-ini').textContent = inicialesDe(nameOf(c));
    $('pf-ini').className = 'ficha-ini fx-ct-av ' + tonoAvatar(c.id);
    // XENCRM: debajo del nombre, de dónde llegó y desde cuándo (lo de SendPulse: «25 sep · Chatbot»).
    $('pf-sub').innerHTML = canalHtml(c.channel) + (c.phone ? '<span>' + esc(c.phone) + '</span>' : '') + (h.frase ? '<span>' + esc(h.frase) + '</span>' : '');
    if (PF_LISTA) {
      var i = PF_LISTA.indexOf(c.id);
      $('pf-nav').hidden = false;
      $('pf-pos').textContent = (i + 1) + ' de ' + PF_LISTA.length;
      $('pf-ant').disabled = i <= 0;
      $('pf-sig').disabled = i >= PF_LISTA.length - 1;
    }
    pintarFijar();
    pintarClaveFicha(d); // XEN · Panel KAM: el botón «★ Cuenta clave»

    var ver = verdict(c);
    var notas = (d.events || []).filter(function (e) { return e.type === 'nota' && e.payload && e.payload.texto; });
    var citas = d.appointments || [];
    var data = c.data || {};
    var capturados = datosCapturados(c);
    var fila = function (k, html, clase) { return '<dt' + (clase ? ' class="' + clase + '"' : '') + '>' + esc(k) + '</dt><dd' + (clase ? ' class="' + clase + '"' : '') + '>' + html + '</dd>'; };
    var fecha = function (ts) { return ts ? new Date(ts).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'; };
    var proxima = citas.filter(function (a) { return a.status === 'confirmada' && a.startsAt >= Date.now(); }).sort(function (a, b) { return a.startsAt - b.startsAt; })[0];
    var deContacto = contactoHtml(c, fila);

    // La etapa y a quién está asignado van en la cabecera, como en un trato de SendPulse: es lo que más se toca y
    // se cambia aquí mismo. Un solo control para cada cosa (no se repiten abajo): dos serían dos estados.
    var r = rol(c.stage) || 'activo';
    $('pf-ctl').innerHTML =
      '<label class="fx-ct-etapa stage-' + esc(r) + '"><span class="sr-only">Etapa</span><i class="punto" aria-hidden="true"></i>' +
        '<select id="pf-etapa" aria-label="Etapa">' + (state.stages || []).map(function (e) { return '<option value="' + esc(e.id) + '"' + (e.id === c.stage ? ' selected' : '') + '>' + esc(e.label) + '</option>'; }).join('') + '</select></label>' +
      '<label class="fx-ct-asig"><span class="fx-ct-asig-l">Asignado a</span>' + (c.responsable ? avatarHtml(c.responsable, c.responsable, 'sm') : '<span class="fx-ct-av sm vacio" aria-hidden="true"><i class="ic" data-ic="user"></i></span>') +
        responsableHtml(c, 'pf-resp') + '</label>' +
      motivoHtml(c, 'pf-motivo');
    iconos($('pf-ctl'));

    $('pf-cuerpo').innerHTML =
      '<div class="ficha-cols"><div class="ficha-main">' +
        // 🪤 Lo primero, lo accionable: si se le fue una venta, eso manda sobre cualquier otro dato de la ficha.
        (h.amago ? '<div class="pf-amago">⚠ Se le fue una venta: tuvo ' + VOC.cita + ' y no acabó en compra, y no tiene ' + VOC.otra + ' ' + VOC.g('agendada') + '.</div>' : '') +
        // Lo que busca lo resume el análisis: va con el violeta de la IA, y así se sabe que no lo escribió nadie.
        (c.summary ? '<div class="fx-ct-busca"><span class="fx-ct-busca-t"><i class="ic" data-ic="chispa"></i>Lo que busca</span><p class="ficha-quiere">' + esc(c.summary) + '</p></div>' : '') +
        '<div class="ficha-tabs" role="tablist" aria-label="Qué ver de este contacto">' +
          [['historia', 'Historia', null], ['citas', VOC.Citas, citas.length], ['notas', 'Notas', notas.length + (c.notes ? 1 : 0)]].map(function (t) {
            return '<button role="tab" data-tab="' + t[0] + '" aria-selected="' + (PF_TAB === t[0]) + '" class="' + (PF_TAB === t[0] ? 'on' : '') + '">' + t[1] + (t[2] ? '<span class="cuenta">' + t[2] + '</span>' : '') + '</button>';
          }).join('') +
        '</div><div id="pf-tab" role="tabpanel"></div>' +
      '</div><aside class="ficha-lado"><h4>Sobre el contacto</h4><dl class="det">' +
        fila('Próximo paso', pasoHtml(c.proximo)) +
        fila('Valor', v.valor ? esc(plata(v.valor)) + ' <span class="muted small">' + esc(v.origen === 'a mano' ? 'a mano' : 'del catálogo') + '</span>' : '<span class="muted">sin precio</span>') +
        fila('Puntaje', esc((c.score == null ? '—' : c.score) + (ver && ver.label ? ' · ' + ver.label : '')), 'solo-completo') +
        fila('La lleva', llevaHtml(c), 'solo-completo') +
        (proxima ? fila(VOC.g('Próxima') + ' ' + VOC.cita, '<span class="paso t-cita">' + esc(proxima.label || new Date(proxima.startsAt).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })) + '</span>') : '') +
        (d.origen && d.origen.fuente ? fila('Origen', esc(d.origen.fuente + (d.origen.campana ? ' · ' + d.origen.campana : '')), 'solo-completo') : '') +
        (variasSedes() && data.sede ? fila('Sede', esc(nombreSede(data.sede))) : '') +
        fila('Agregado el', esc(fecha(h.desde)), 'solo-completo') +
        fila('Última actividad', esc(c.lastMessageAt ? 'hace ' + rel(c.lastMessageAt) : '—')) +
        fila('Volvió', esc(h.volvio ? h.volvio + (h.volvio === 1 ? ' vez' : ' veces') : 'no ha vuelto'), 'solo-completo') +
      '</dl>' +
      // Cómo contactarlo: el teléfono y lo que haya (correo, Instagram…), cada uno como algo que se toca.
      '<h4>Contacto</h4><dl class="det fx-ct-contacto">' +
        (c.phone ? fila('Teléfono', '<a href="tel:' + esc(c.phone.replace(/[^\d+]/g, '')) + '">' + esc(c.phone) + '</a>') : '') +
        deContacto +
        (!c.phone && !deContacto ? fila('Contacto', '<span class="muted">Solo por el chat. Agrégalo con el lápiz.</span>') : '') +
      '</dl>' +
      (capturados.length ? '<h4>Datos del contacto</h4><dl class="det">' + capturados.map(function (k) { return fila(etiquetaDato(k), esc(data[k])); }).join('') + '</dl>' : '') +
      '<details class="corregir" id="pf-corregir"><summary>Corregir datos</summary><div class="pf-campos">' +
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
    iconos($('pf-cuerpo'));
    xtEnLaFicha(d); // XEN · Tickets y SLA: sus tickets y «Crear ticket», en la columna de la derecha
    // El lápiz de la cabecera abre «Corregir datos» y pone el cursor en el nombre.
    $('pf-editar').onclick = function () {
      var det = $('pf-corregir'); if (!det) return;
      det.open = true;
      det.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      $('pf-f-nombre').focus({ preventScroll: true });
    };

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
      }).join('') : '<div class="empty">Sin ' + VOC.citas + ' todavía.</div>';
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
    var agente = state.agentName || 'Xen';
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
        case 'appointment_booked': t = VOC.Cita + ' ' + VOC.g('agendada') + (p.startsAt ? ' para el ' + new Date(p.startsAt).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }) : '') + (p.by && p.by !== 'bot' ? ' por ' + quien(p.by) : ''); tipo = 'cita'; break;
        case 'appointment_updated': if (!p.status) return; t = VOC.La + ' ' + VOC.cita + ' quedó ' + estadoCita(p.status) + (p.by && p.by !== 'bot' ? ' · ' + quien(p.by) : ''); tipo = 'cita'; break;
        case 'reminder_reply': t = 'Contestó el recordatorio de ' + VOC.la + ' ' + VOC.cita; tipo = 'cita'; break;
        case 'followup_snooze': t = 'Seguimiento pospuesto ' + (p.days || 7) + ' días'; break;
        case 'archivada': t = p.by ? quien(p.by) + ' la archivó' : 'Se archivó'; break;
        case 'desarchivada': t = p.by ? quien(p.by) + ' la devolvió a las listas' : 'Volvió a las listas'; break;
        case 'cuenta_clave': t = quien(p.by) + (p.on ? ' la marcó como cuenta clave' : ' le quitó la marca de cuenta clave'); break;
        case 'ticket': t = fraseDeTicket(p, quien); if (!t) return; break;
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
  // negocio son los que XENCRM capta de la conversación (en DUNOR, la talla o las medidas). Se ven igual en los dos
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
    // Lo del negocio, con lo que XENCRM ya captó escrito: aquí se corrige, y lo corregido el análisis ya no lo pisa.
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
        // 🪤 Con ventas y ninguna con precio, «$0» decía que no valieron nada; lo que pasa es que no se sabe. Es la
        // misma regla de Tratos y de Hoy: sin precio, «Sin precios». Sin ventas, cero sí es la verdad.
        tarjeta(d.total ? plata(d.total) : d.cuantas ? 'Sin precios' : plata(0), 'vendido en ' + (dias === 365 ? 'un año' : dias + ' días')) +
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
        : '<div class="empty">Nadie esperando. Todo el mundo tiene ' + VOC.cita + ', acaba de escribir, o ya está pospuesto.</div>';
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
    // Xen dejó algo listo: si estás en esa conversación aparece sola; si no, suena y se avisa.
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
      toast(quien + ' · ' + cuando, function () { go('calendar'); }, { titulo: VOC.Cita + ' ' + VOC.g('agendada'), icono: 'calendar' });
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
      state.bizName = me.business; state.agentName = me.agent; state.agendaQue = me.agenda || '';
      if ($('fx-copiloto-t')) $('fx-copiloto-t').textContent = 'Pregúntale a ' + (state.agentName || 'Xen');
      ponerVocabulario(me.interfaz); pintarVocabulario();
      // 🪤 El asistente no siempre se llama Xen (el de DUNOR en el paquete se llama Arthur): lo que el HTML trae escrito
      // con «Xen» se cambia aquí, al saberse el nombre. Lo que pinta el JavaScript usa state.agentName.
      if (me.agent && $('seg-bot')) $('seg-bot').textContent = me.agent;
      state.sedes = me.sedes || [];
      // El logo del negocio en su propia barra: entrar a su tablero tiene que sentirse suyo, no de XENCRM.
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
      // clientes suelen llamar igual a su asistente, el operador acababa llamándose «Xen» en todos: parecía que
      // el perfil se cruzaba entre clientes y lo que pasaba es que se inventaba el nombre equivocado.
      //
      // Son dos cosas distintas y no se mezclan: el asistente es quien contesta solo, y el operador es la
      // persona que toma el teclado. Si no se sabe quién es, se deja en blanco y se pide; inventarlo es peor,
      // porque queda guardado y nadie vuelve a mirarlo.
      state.quienSoyPorCuenta = typeof window.XENCRM_QUIEN === 'string' && Boolean(window.XENCRM_QUIEN);
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
      if (!state.name && state.quienSoyPorCuenta) state.name = window.XENCRM_QUIEN;
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
      // #v=<vista>: la consola abre directo una pantalla (Tickets, Prospectos…), si existe.
      var v = /^#v=([a-z-]+)$/.exec(location.hash);
      if (m) { go('inbox'); openContact(decodeURIComponent(m[1])); history.replaceState(null, '', location.pathname); }
      else if (v && document.getElementById('view-' + v[1])) { go(v[1]); history.replaceState(null, '', location.pathname); }
      else go('today');
    }).catch(function () {});
  }

  // ---------- El negocio: la configuración del cliente, editable sin tocar archivos ----------
  // Lo que se guarda aquí va a `xencrm.config.json`. Se lee al arrancar, así que hasta que el cliente no reinicie
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
            '<div class="small muted">El chat del sitio y la página de ' + VOC.la + ' ' + VOC.cita + '.</div></div>' +
          campo('n-logo', 'Logo (URL o archivo)', a.marca.logo) +
          campo('n-logo-oscuro', 'Logo para fondo oscuro', a.marca.logoOscuro, { pista: 'Si la marca tiene dos versiones.' }) +
          campo('n-favicon', 'Marca chica (favicon)', a.marca.favicon, { pista: 'El escudo o la inicial.' }) +
          '<div class="prof-field"><div class="lbl"><label class="small" for="n-zona"><b>Zona horaria</b></label></div>' +
            '<select id="n-zona">' + zonas.map(function (z) { return '<option' + (z === a.timezone ? ' selected' : '') + '>' + esc(z) + '</option>'; }).join('') + '</select>' +
            '<div class="small muted">Con esto entiende «mañana a las 3».</div></div>' +
        '</div>' +
      '</div>' +

      '<div class="card"><h2 class="h">' + VOC.Citas + '</h2>' +
        '<label class="prof-check" for="n-citas"><input type="checkbox" id="n-citas"' + (ci.enabled ? ' checked' : '') + '> Este negocio agenda ' + VOC.citas + '</label>' +
        '<div id="n-citas-detalle"' + (ci.enabled ? '' : ' hidden') + '>' +
          '<div class="fila-3">' + campo('n-servicio', 'Cómo se llama ' + VOC.la + ' ' + VOC.cita, ci.service) + campo('n-lugar', 'Dónde', ci.location) +
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
        '<div class="small muted" style="margin-bottom:10px">Si atiende en varios sitios con este mismo número. Con dos o más, el asistente pregunta en cuál antes de ofrecer horarios y dice la dirección al confirmar. Sin sedes, es un solo sitio: el «Dónde» de ' + VOC.las + ' ' + VOC.citas + '.</div>' +
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


  // ---------- El negocio y Perfil (antes, un diálogo) ----------
  /** El negocio y Perfil eran un diálogo; ahora son pantallas. Quien todavía llame esto, va a la pantalla. */
  function abrirConfig(cual) { closeMore(); go(cual === 'negocio' ? 'negocio' : 'profile'); }
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
          '<th>De dónde</th><th>Campaña</th><th class="num">Conversaciones</th><th class="num">' + VOC.Citas + '</th><th class="num">Ganadas</th><th class="num">Conversión</th>' +
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
          '<span class="chip">' + esc(state.agentName || 'Xen') + ': ' + d.porQuien.xencrm.n + ' · ' + duracion(d.porQuien.xencrm.medianaMs) + '</span>' +
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
      { q: VOC.Citas + ' ' + VOC.g('agendadas'), c: s.citas },
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
    XA.nuevas = dias;
    var total = dias.reduce(function (a, d) { return a + d.total; }, 0);
    if (!total) { caja.innerHTML = '<div class="sin-datos">Todavía no ha entrado nadie en estos días.</div>'; return; }
    // XEN: al ancho de verdad de su tarjeta (escalada, el texto de los ejes bajaba a 7 px). Escondida mide cero, y
    // entonces se queda en 620 hasta que se vuelva a ver (xaPestana la redibuja).
    var W = Math.max(300, caja.clientWidth || 620), H = 180, izq = 26, abajo = 22;
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
    caja.innerHTML = '<svg class="grafica" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Conversaciones nuevas por día">' +
      reglas +
      // XEN: los canales son datos, con su color aparte del acento: WhatsApp verde y el chat del sitio cielo.
      banda(function (d) { return d.total; }, 'var(--fx-cielo)') +
      banda(function (d) { return d.whatsapp + d.otros; }, 'var(--fx-verde)') +
      linea(function (d) { return d.total; }, 'var(--fx-cielo)') +
      etiquetas + '</svg>' +
      '<div class="leyenda"><span><i style="background:var(--fx-verde)"></i>WhatsApp</span>' +
      '<span><i style="background:var(--fx-cielo)"></i>Chat del sitio</span>' +
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
          'width="' + celda + '" height="' + celda + '" rx="4" fill="var(--fx-cielo)" fill-opacity="' + fuerza.toFixed(2) + '">' +
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
  /**
   * Las siguientes acciones del copiloto: una por cada fila de los recuadros que piden hacer algo, en su orden.
   * 🪤 Solo filas de /today, con sus datos tal cual: el nombre, cuándo escribió, lo que preguntó. Si un recuadro
   * nuevo aparece en Hoy y no está aquí, simplemente no sale como acción (la cifra de arriba sí lo cuenta).
   */
  function accionesDelCopiloto(pend, t, irAlRecuadro) {
    var fuente = { verificar: t.verifications, grupos: t.enGrupos, esperan: t.unanswered, persona: t.handoffs, pasadas: t.past, recordar: t.remind, calientes: t.hot };
    var hace = function (ts) { return ts ? 'hace ' + rel(ts) : ''; };
    var alRecuadro = function (tono) { return function () { irAlRecuadro(tono); }; };
    var alChat = function (c, conBorrador) { return function () { go('inbox'); openContact(c.id, conBorrador ? followupDraft(c) : undefined); }; };
    var quienCita = function (a) { return a.contactName || short(a.userId); };
    var una = {
      verificar: function (v) { return { que: 'Verificar lo que preguntó ' + (v.contactName || short(v.userId)), detalle: v.question ? '«' + v.question + '»' : '', boton: 'Responder', ic: 'check', color: 'ambar', ir: alRecuadro('verificar') }; },
      grupos: function (p) { return { que: 'Contestar en el grupo ' + p.grupo, detalle: p.sobre || p.texto || '', boton: 'Revisar', ic: 'users', color: 'ambar', ir: alRecuadro('grupos') }; },
      esperan: function (c) { return { que: 'Contestar a ' + nameOf(c), detalle: [c.lastMessageAt ? 'Escribió ' + hace(c.lastMessageAt) : '', c.recap || c.summary || ''].filter(Boolean).join(' · '), boton: 'Contestar', ic: 'burbuja', color: 'rojo', ir: alChat(c) }; },
      persona: function (c) { return { que: 'Atender a ' + nameOf(c), detalle: 'Pidió hablar con una persona' + (c.lastMessageAt ? ' · ' + hace(c.lastMessageAt) : ''), boton: 'Atender', ic: 'user', color: 'ambar', ir: alChat(c) }; },
      pasadas: function (a) { return { que: 'Anotar cómo le fue a ' + quienCita(a), detalle: a.label ? VOC.Cita + ': ' + a.label : '', boton: 'Anotar', ic: 'citas', color: 'indigo', ir: alRecuadro('pasadas') }; },
      recordar: function (a) { return { que: 'Recordarle ' + VOC.la + ' ' + VOC.cita + ' a ' + quienCita(a), detalle: a.label || '', boton: 'Recordar', ic: 'bell', color: 'indigo', ir: alRecuadro('recordar') }; },
      calientes: function (c) { return { que: 'Retomar a ' + nameOf(c), detalle: 'Caliente y sin seguimiento' + (c.lastMessageAt ? ' · su último mensaje fue ' + hace(c.lastMessageAt) : ''), boton: 'Escribirle', ic: 'objetivo', color: 'verde', ir: alChat(c, true) }; }
    };
    var out = [];
    pend.forEach(function (s) {
      if (!una[s.tono]) return;
      (fuente[s.tono] || []).forEach(function (x) { var a = una[s.tono](x); a.tono = s.tono; out.push(a); });
    });
    return out;
  }
  // Sin /today no hay Inicio: el copiloto lo dice, con salida. Lo demás se queda como esté (las gráficas piden lo suyo).
  function pintarErrorDeInicio(motivo) {
    var caja = $('fx-resumen');
    if (!caja) return;
    caja.removeAttribute('aria-busy');
    caja.innerHTML = '<div class="fx-cop-cab"><span class="fx-cop-marca" aria-hidden="true"><i class="ic" data-ic="chispa"></i></span><span class="fx-cop-nombre" id="fx-cop-titulo">Copiloto XEN</span></div>' +
      '<div class="fx-cop-error" role="alert"><h2>No se pudo cargar lo de hoy</h2><p>' + esc(motivo ? 'El servidor contestó: ' + motivo + '.' : 'No hubo respuesta del servidor. Revisa la conexión y vuelve a intentarlo.') + '</p>' +
      '<button class="btn primary" type="button" id="fx-cop-reintentar">Reintentar</button></div>';
    iconos(caja);
    $('fx-cop-reintentar').onclick = function () { caja.setAttribute('aria-busy', 'true'); loadToday(); };
    if ($('fx-kpis') && $('fx-kpis').getAttribute('aria-busy')) { $('fx-kpis').removeAttribute('aria-busy'); $('fx-kpis').innerHTML = ''; }
    // 🪤 La semana, el embudo y la actividad no dependen de /today: sin esto se quedaban en esqueleto para siempre.
    if ($('today').closest('.fx-atender')) $('today').closest('.fx-atender').hidden = true;
    cargarSerieFacil();
    api('/stats').then(pintarEtapasFacil).catch(function (e) { if ((!e || e.message !== '401') && $('fx-etapas')) $('fx-etapas').innerHTML = vacioFacil('No se pudo cargar', 'Vuelve a intentarlo con «Actualizar».'); });
    pintarActividadFacil();
  }
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
    if (ch === 'telefono') return { k: 'tel', t: 'Teléfono', ic: 'telefono' };
    return { k: 'otro', t: canalSolo(ch) || 'Otro canal', ic: 'burbuja' };
  }
  // «Sin asignar»: sin nadie en «Asignado a» (c.responsable), que es lo que pone quien la toma si no había nadie.
  function sinAsignar(c) { return !String(c.responsable || '').trim(); }
  /**
   * El tono del avatar, el mismo siempre para el mismo nombre. Seis tonos propios (--fx-av-*), aparte de los de
   * las etapas: un avatar rojo se leería «perdido». Medidos: ≥ 6:1 en claro y ≥ 7.9:1 en oscuro.
   */
  // 🪤 Un solo color por persona en todo XENCRM: la bandeja y Contactos lo sacaban cada uno a su manera (una del
  // nombre, la otra del id) y la misma persona salía de dos colores. Ahora los dos salen de tonoAvatar con su id,
  // que no cambia si alguien corrige el nombre.
  function tonoXen(clave) { return Number(tonoAvatar(clave).slice(1)); }
  function avatarXen(c, clase) {
    var canal = canalDeXen(c.channel);
    return '<span class="fx-av ' + (clase || '') + ' av-' + tonoXen(c.id) + '" aria-hidden="true"><span class="fx-av-ini">' + esc(inicialesDe(nameOf(c))) + '</span>' +
      '<i class="fx-canal-ins fx-canal-' + canal.k + '">' + svgXen(canal.ic) + '</i></span>';
  }
  function sinAsignarComoOpcion(sel) { var o = sel && sel.querySelector('option[value=""]'); if (o) o.textContent = 'Sin asignar'; }

  /** La cabecera de la conversación: quién es, quién responde, a quién está asignada y pausar o reanudar. */
  function pintarCabeceraXen(d) {
    var c = d.contact, agente = state.agentName || 'Xen', canal = canalDeXen(c.channel), ini = $('fx-chat-ini');
    ini.className = 'fx-av fx-av-chat solo-facil av-' + tonoXen(c.id);
    ini.innerHTML = '<span class="fx-av-ini">' + esc(inicialesDe(nameOf(c))) + '</span><i class="fx-canal-ins fx-canal-' + canal.k + '">' + svgXen(canal.ic) + '</i>';
    $('fx-chat-nombre').textContent = nameOf(c);
    var estado = c.humanMode
      ? '<span class="fx-pill humano">' + svgXen('pausa') + 'Automatización pausada · la lleva ' + esc(whoHas(c)) + '</span>'
      : '<span class="fx-pill ia">' + svgXen('chispa') + 'Responde ' + esc(agente) + '</span>';
    $('fx-chat-linea').innerHTML = estado + (d.number ? '<span>+' + esc(d.number) + '</span>' : '') + '<span>' + esc(canal.t) + '</span>';
    // El puntaje de la cabecera (solo en el completo) va debajo del nombre, no suelto en la fila de botones.
    var quien = $('fx-chat-nombre').parentNode;
    if ($('chat-temp') && $('chat-temp').parentNode !== quien) quien.appendChild($('chat-temp'));
    // Lo que se pausa es la automatización (el agente de IA): la persona sigue. Es el mismo interruptor Xen/Tú.
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
  // Los dibujos que faltaban (Lucide, como los demás). Lo que ya estaba en la página se repinta aquí: el primer
  // iconos() corre antes de que existan.
  ICONS.descargar = '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>';
  ICONS.lapiz = '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>';
  ['cli-csv', 'cli-nuevo', 'pf-editar', 'pf-chat'].forEach(function (id) { if ($(id)) iconos($(id)); });

  /**
   * El color del avatar de una persona: estable (sale de su id, no del orden de la lista) y uno de seis tonos
   * propios de los avatares (--fx-av-*). 🪤 No son los colores de dato: un avatar verde no puede leerse como
   * «vendido» ni uno rojo como «perdido». Decora, no dice nada.
   */
  function tonoAvatar(clave) {
    var n = 0, t = String(clave || '');
    for (var i = 0; i < t.length; i++) n = (n * 31 + t.charCodeAt(i)) % 100003;
    return 'a' + (n % 6 + 1);
  }
  function avatarHtml(nombre, clave, extra) {
    return '<span class="fx-ct-av ' + tonoAvatar(clave || nombre) + (extra ? ' ' + extra : '') + '" aria-hidden="true">' + esc(inicialesDe(nombre)) + '</span>';
  }
  /** El canal con un punto de su color y su nombre en palabras (sin el emoji, que cada sistema pinta distinto). */
  function canalHtml(ch) {
    var nombre = canalSolo(ch);
    return nombre ? '<span class="fx-ct-canal c-' + esc(ch || '') + '"><i aria-hidden="true"></i>' + esc(nombre) + '</span>' : '';
  }
  /**
   * Lo que el análisis o el equipo captó de una persona (servicio, ocasión, fecha…), sin lo interno ni lo de
   * contacto. Lo usan la tabla (como etiquetas) y la ficha (como lista): el mismo filtro en los dos sitios.
   */
  function datosCapturados(c) {
    // 🪤 La lista va DENTRO: una `var` de esta parte del archivo vale undefined si alguien la usa antes de que el
    // arranque llegue hasta aquí (la trampa que ya cortó el arranque una vez, ver mudarParaElFacil).
    var DATOS_INTERNOS = { booking: 1, interes: 1, urgencia: 1, pospuesto_hasta: 1, pospuesto_desde: 1, valor: 1, sede: 1, motivo_perdida: 1 };
    var data = c.data || {};
    return Object.keys(data).filter(function (k) { return !DATOS_INTERNOS[k] && !DE_CONTACTO[k] && data[k] !== '' && data[k] != null && typeof data[k] !== 'object'; });
  }
  /**
   * Las etiquetas de la columna «Datos», como las de SendPulse: pastel, cortas y a lo sumo dos, con «+n» para el
   * resto. El tono va por el CAMPO (servicio siempre del mismo color), no por el valor. Primero las etiquetas que
   * haya puesto el equipo (tags), después lo captado.
   */
  function datosHtml(c) {
    var data = c.data || {};
    var todas = (c.tags || []).filter(Boolean).map(function (t) { return { k: 'etiqueta', t: String(t), rotulo: 'Etiqueta' }; })
      .concat(datosCapturados(c).map(function (k) { return { k: k, t: String(data[k]), rotulo: etiquetaDato(k) }; }));
    if (!todas.length) return '<span class="fx-ct-sin">—</span>';
    var vis = todas.slice(0, 2), resto = todas.slice(2);
    return '<span class="fx-ct-tags">' + vis.map(function (x) {
      return '<span class="fx-ct-tag ' + tonoAvatar(x.k) + '" title="' + esc(x.rotulo + ': ' + x.t) + '"><span class="sr-only">' + esc(x.rotulo) + ': </span>' + esc(x.t) + '</span>';
    }).join('') + (resto.length ? '<span class="fx-ct-tag mas" title="' + esc(resto.map(function (x) { return x.rotulo + ': ' + x.t; }).join(' · ')) + '">+' + resto.length +
      '<span class="sr-only"> más: ' + esc(resto.map(function (x) { return x.rotulo + ': ' + x.t; }).join(', ')) + '</span></span>' : '') + '</span>';
  }
  /**
   * Lo que se ve en Contactos cuando no hay filas que pintar. Cada caso dice qué pasa y qué hacer: un «Sin
   * resultados» a secas no deja saber si es la búsqueda, el grupo o que de verdad no hay nadie.
   */
  function estadoClientes(tipo, g) {
    if (tipo === 'cargando') {
      var fila = '<div class="fx-ct-esq-fila"><i class="av"></i><span><i style="width:42%"></i><i style="width:26%"></i></span><span><i style="width:58%"></i><i style="width:40%"></i></span><span><i style="width:50%"></i></span></div>';
      return '<div class="fx-ct-esq" aria-busy="true" aria-label="Cargando los contactos">' + fila + fila + fila + fila + fila + '</div>';
    }
    var caso = {
      error: ['alerta', 'No se pudieron cargar los contactos', 'El servidor dijo: ' + cli.error + '. Vuelve a intentarlo en un momento.', 'reintentar', 'Volver a intentar'],
      nadie: ['contacto', 'Todavía no hay contactos', 'Llegan solos cuando alguien escribe por WhatsApp o por el chat del sitio. Si alguien llegó por el local o por una llamada, agrégalo a mano.', 'agregar', 'Agregar contacto'],
      busqueda: ['buscar', 'Nadie coincide con «' + cli.q + '»', 'Se busca por nombre, teléfono y lo que la persona escribió. Prueba con menos letras o con el número.', 'limpiar', 'Borrar la búsqueda'],
      grupo: ['embudo', 'Nadie en «' + (g ? g.t.replace(/^[^\wÀ-ÿ]+\s*/, '') : '') + '» por ahora', 'Cuando alguien cumpla con este grupo, aparece aquí solo.', 'todos', 'Ver todos los contactos'],
      filtros: ['embudo', 'Nadie cumple estos filtros', 'Hay ' + xfCuantasCond('clientes') + (xfCuantasCond('clientes') === 1 ? ' condición puesta' : ' condiciones puestas') + ' en «' + (g ? g.t.replace(/^[^\wÀ-ÿ]+\s*/, '') : '') + '». Quita alguna arriba, o todas de una vez.', 'quitar-filtros', 'Quitar los filtros']
    }[tipo];
    return '<div class="fx-ct-vacio' + (tipo === 'error' ? ' error' : '') + '" role="' + (tipo === 'error' ? 'alert' : 'status') + '"><span class="fx-ct-vacio-ic"><i class="ic" data-ic="' + caso[0] + '"></i></span><b>' + esc(caso[1]) + '</b><p>' + esc(caso[2]) + '</p>' +
      '<button class="btn sm' + (caso[3] === 'agregar' ? ' primary' : '') + '" type="button" data-estado="' + caso[3] + '">' + esc(caso[4]) + '</button></div>';
  }
  function enganchaEstadoClientes() {
    var el = $('cli-tabla');
    iconos(el);
    var b = el.querySelector('[data-estado]');
    if (!b) return;
    b.onclick = function () {
      var que = b.getAttribute('data-estado');
      if (que === 'reintentar') loadClientes();
      else if (que === 'agregar') $('cli-nuevo').click();
      else if (que === 'limpiar') { $('cli-q').value = ''; cli.q = ''; loadClientes(); $('cli-q').focus(); }
      else if (que === 'todos') { cli.grupo = 'todos'; renderClientes(); }
      else if (que === 'quitar-filtros') { xfE('clientes').cond = {}; xfGuardar('clientes'); renderClientes(); }
    };
  }
  // (fin de XEN · Contactos, ficha y tratos)

  // ===== XEN · Analítica y sentimiento: lo nuevo del agente de Analítica =====
  // Analítica es UNA puerta del menú con dos pestañas: Resumen (lo de siempre) y Sentimiento. El sentimiento no se
  // calcula aquí ni se le pregunta a ningún modelo: lo cuenta el servidor (crm/sentimiento.ts) con lo que el
  // análisis de cada conversación ya guardó. Aquí solo se pinta, y cada nivel lleva su emoji Y su palabra: el emoji
  // solo no lo lee igual todo el mundo, y para un lector de pantalla es ruido (va con aria-hidden).
  //
  // 🪤 El interés y el ánimo son dos escalas aparte. Quien quiere comprar y está molesto es justo a quien hay que
  // cuidar primero; en una escala única de «interesado a molesto» se perdería. Por eso van separadas y cruzadas.
  //
  // 🪤 Nada se rellena para que se vea bonito: un nivel sin nadie dice 0, un día sin análisis no tiene barra y, sin
  // análisis, la pestaña explica de dónde sale el sentimiento en vez de enseñar ceros como si fueran datos.
  var XA_INTERES = [
    { k: 3, e: '🤩', lbl: 'Quiere comprar', d: 'Quiere comprar o agendar ya', tono: 'var(--xa-i3)' },
    { k: 2, e: '🙂', lbl: 'Interés claro', d: 'Pregunta en serio por lo que vendes', tono: 'var(--xa-i2)' },
    { k: 1, e: '🤔', lbl: 'Curiosidad', d: 'Está mirando, sin decidirse', tono: 'var(--xa-i1)' },
    { k: 0, e: '😶', lbl: 'Sin interés', d: 'No muestra ganas de comprar', tono: 'var(--xa-i0)' }
  ];
  var XA_ANIMO = [
    { k: 'positivo', e: '😊', lbl: 'Contento', d: 'Escribe a gusto', tono: 'var(--xa-pos)' },
    { k: 'neutral', e: '😐', lbl: 'Neutral', d: 'Ni a gusto ni a disgusto', tono: 'var(--xa-neu)' },
    { k: 'negativo', e: '😠', lbl: 'Molesto', d: 'Algo le incomodó', tono: 'var(--xa-neg)' }
  ];
  var XA_LISTA_MAX = 50;
  var XA = { tab: 'resumen', datos: null, filtro: null, dias: 30, pidiendo: 0, puntaje: null, todos: false, nuevas: null };
  try { XA.tab = localStorage.getItem(LLAVE('analitica')) === 'sentimiento' ? 'sentimiento' : 'resumen'; } catch (e) {}
  var XA_SUB = {
    resumen: 'Cómo llega la gente, a qué horas escribe y cuánto se tarda en contestar.',
    sentimiento: 'Cuánto interés hay y de qué ánimo está la gente, según el análisis de cada conversación.'
  };
  function xaE(e) { return '<span class="e" aria-hidden="true">' + e + '</span>'; }
  function xaPct(n, de) { return de ? Math.round((n / de) * 100) : 0; }
  function xaPlural(n, uno, varios) { return n === 1 ? uno : varios; }
  function xaDe(lista, k) { return lista.filter(function (x) { return x.k === k; })[0] || null; }
  function xaNombre(f) {
    var c = (state.contacts || []).filter(function (x) { return x.id === f.id; })[0];
    return c ? nameOf(c) : (f.nombre || f.telefono || short(f.id));
  }
  function xaHace(ts) { if (!ts) return '—'; var r = rel(ts); return r === 'ahora' ? 'ahora' : 'hace ' + r; }

  // ---- las pestañas ----
  function xaPestana(t, foco) {
    XA.tab = t === 'sentimiento' ? 'sentimiento' : 'resumen';
    try { localStorage.setItem(LLAVE('analitica'), XA.tab); } catch (e) {}
    ['resumen', 'sentimiento'].forEach(function (k) {
      var on = k === XA.tab, b = $('xa-tab-' + k), panel = $('xa-' + k);
      if (!b || !panel) return;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      panel.hidden = !on;
      if (on && foco) b.focus();
    });
    var p = document.querySelector('#view-analysis .fx-cab p');
    if (p) p.textContent = XA_SUB[XA.tab];
    // La gráfica por día mide el ancho donde vive: escondida mide cero, así que se dibuja al enseñarla.
    if (XA.tab === 'sentimiento') { if (XA.datos) xaDibujarSerie(); else cargarSentimiento(); }
    else if (XA.nuevas && $('g-nuevas') && $('g-nuevas').clientWidth) pintarNuevas(XA.nuevas);
  }
  ['resumen', 'sentimiento'].forEach(function (k) {
    if ($('xa-tab-' + k)) $('xa-tab-' + k).onclick = function () { xaPestana(k); };
  });
  if (document.querySelector('#view-analysis .xa-pestanas')) document.querySelector('#view-analysis .xa-pestanas').addEventListener('keydown', function (e) {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(e.key) < 0) return;
    e.preventDefault();
    var otra = e.key === 'Home' ? 'resumen' : e.key === 'End' ? 'sentimiento' : XA.tab === 'resumen' ? 'sentimiento' : 'resumen';
    xaPestana(otra, true);
  });

  // ---- traer y pintar ----
  function cargarSentimiento() {
    var caja = $('xa-sent');
    if (!caja) return;
    var n = ++XA.pidiendo;
    if (!XA.datos) {
      caja.setAttribute('aria-busy', 'true');
      caja.innerHTML = '<div class="xa-esqueleto" aria-hidden="true"><i style="height:72px"></i><div class="xa-fila xa-fila-35"><i style="height:250px"></i><i style="height:250px"></i></div><i style="height:220px"></i></div>' +
        '<p class="sr-only">Cargando el sentimiento…</p>';
    }
    var fallo = function (por) {
      if (n !== XA.pidiendo) return;
      caja.removeAttribute('aria-busy');
      if (XA.datos) { toast('No se pudo actualizar el sentimiento: ' + (por || 'sin respuesta')); return; }
      caja.innerHTML = xaVacio('⚠️', 'No se pudo cargar el sentimiento', (por ? 'El servidor dijo: ' + por + '. ' : 'No hubo respuesta del servidor. ') + 'Lo demás de Analítica sigue funcionando.', 'Volver a intentar', 'reintentar');
      pintarMiniSentimiento();
    };
    api('/sentimiento?dias=' + XA.dias).then(function (d) {
      if (n !== XA.pidiendo) return;
      if (!d || d.error) { fallo(d && d.error); return; }
      caja.removeAttribute('aria-busy');
      XA.datos = d;
      pintarSentimiento();
      pintarMiniSentimiento();
    }).catch(function (e) { if (String(e && e.message) !== '401') fallo(''); });
  }
  function xaVacio(e, titulo, texto, boton, accion) {
    return '<div class="xa-vacio">' + xaE(e) + '<b>' + esc(titulo) + '</b><span>' + esc(texto) + '</span>' +
      (boton ? '<button type="button" class="btn sm" data-xa-ir="' + esc(accion) + '">' + esc(boton) + '</button>' : '') + '</div>';
  }
  function xaCuidar(d) { return d.cruce[3].negativo + d.cruce[2].negativo; }

  function pintarSentimiento() {
    var d = XA.datos, caja = $('xa-sent');
    if (!d || !caja) return;
    if (!d.total) {
      caja.innerHTML = xaVacio('🗂️', 'Todavía no hay contactos', 'Cuando alguien escriba por WhatsApp o por el chat del sitio, su conversación se analiza y aquí se cuenta cuánto interés trae y de qué ánimo está.', 'Abrir la bandeja omnicanal', 'inbox');
      return;
    }
    if (!d.analizados) {
      caja.innerHTML = xaVacio('🔎', 'Aún no hay sentimiento que contar',
        'Sale del análisis que la IA hace de cada conversación cuando se queda en silencio: el ánimo (contento, neutral, molesto), el interés (de la curiosidad a querer comprar) y lo que frena la compra. Hay ' +
        d.total + ' ' + xaPlural(d.total, 'contacto', 'contactos') + ' y todavía no se ha analizado ninguno.', 'Abrir la bandeja omnicanal', 'inbox');
      return;
    }
    var conInteres = d.interes[3] + d.interes[2], molestos = d.animo.negativo, cuidar = xaCuidar(d);
    var titular = '<div class="xa-titular"><p>De <b>' + d.analizados + '</b> ' + xaPlural(d.analizados, 'contacto analizado', 'contactos analizados') + ', <b>' + conInteres + '</b> ' +
      xaPlural(conInteres, 'tiene interés claro o quiere comprar', 'tienen interés claro o quieren comprar') + ' y <b>' + molestos + '</b> ' + xaPlural(molestos, 'está molesto', 'están molestos') + '.' +
      (d.sinAnalizar ? '<span class="xa-sin">' + d.sinAnalizar + ' ' + xaPlural(d.sinAnalizar, 'contacto todavía no se ha analizado', 'contactos todavía no se han analizado') + ': no cuentan aquí.</span>' : '') + '</p>' +
      '<span class="xa-ia"><span aria-hidden="true">✦</span>Según el análisis de IA de cada conversación</span>' +
      (cuidar ? '<button type="button" class="xa-cuidar" data-xa="cuidar" data-v="1" aria-pressed="false"><span aria-hidden="true">⚠️</span>Cuidar a ' + cuidar + ' ' + xaPlural(cuidar, 'con interés y molesto', 'con interés y molestos') + '</button>' : '') +
      '</div>';
    var conI = d.analizados - d.interesSinDato, conA = d.analizados - d.animoSinDato;
    var escala = function (titulo, sub, tipo, lista, cuentas, de, sinDato) {
      return '<section class="xa-card" aria-labelledby="xa-t-' + tipo + '"><div class="xa-card-cab"><div><h2 id="xa-t-' + tipo + '">' + esc(titulo) + '</h2><p>' + esc(sub) + '</p></div></div>' +
        '<div class="xa-termo" aria-hidden="true">' + lista.map(function (x) { var n = cuentas[x.k] || 0; return n ? '<i style="flex:' + n + ';--tono:' + x.tono + '"></i>' : ''; }).join('') + '</div>' +
        '<div class="xa-niveles" data-n="' + lista.length + '" style="--n:' + lista.length + '">' + lista.map(function (x) { return xaNivel(tipo, x, cuentas[x.k] || 0, de); }).join('') + '</div>' +
        (sinDato ? '<p class="xa-nota">' + sinDato + ' ' + xaPlural(sinDato, 'contacto analizado no tiene', 'contactos analizados no tienen') + ' este dato.</p>' : '') + '</section>';
    };
    caja.innerHTML = titular +
      '<div class="xa-fila xa-fila-35">' +
        escala('Interés', 'De querer comprar ya a no tener interés. Toca un nivel para ver quiénes son.', 'interes', XA_INTERES, d.interes, conI, d.interesSinDato) +
        escala('Ánimo', 'Cómo se siente al escribir, en su último análisis.', 'animo', XA_ANIMO, d.animo, conA, d.animoSinDato) +
      '</div>' +
      '<section class="xa-card xa-lista" aria-labelledby="xa-lista-t"><div class="xa-card-cab"><div><h2 id="xa-lista-t"></h2><p id="xa-lista-sub"></p></div><button type="button" class="btn sm" id="xa-lista-todos" data-xa-ir="todos" hidden>Ver todos</button></div><div id="xa-lista-cuerpo"></div></section>' +
      '<div class="xa-fila">' +
        '<section class="xa-card" aria-labelledby="xa-t-cruce"><div class="xa-card-cab"><div><h2 id="xa-t-cruce">Interés × ánimo</h2><p>Quien quiere comprar y está molesto es a quien hay que cuidar primero.</p></div></div>' + xaCruce(d) + '</section>' +
        '<section class="xa-card" aria-labelledby="xa-t-obj"><div class="xa-card-cab"><div><h2 id="xa-t-obj">Lo que frena</h2><p>Las objeciones que se repiten, de su último análisis.</p></div></div>' + xaObjeciones(d) + '</section>' +
      '</div>' +
      '<section class="xa-card" aria-labelledby="xa-t-serie"><div class="xa-card-cab"><div><h2 id="xa-t-serie">Cómo cambió</h2><p id="xa-serie-sub"></p></div>' +
        '<label><span class="sr-only">Cuántos días ver</span><select id="xa-dias">' + [14, 30, 90].map(function (n) { return '<option value="' + n + '"' + (n === d.dias ? ' selected' : '') + '>Últimos ' + n + ' días</option>'; }).join('') + '</select></label></div>' +
        '<div class="xa-serie" id="xa-serie"></div>' +
        '<div class="xa-leyenda">' + XA_ANIMO.map(function (a) { return '<span><i style="--tono:' + a.tono + '"></i>' + xaE(a.e) + ' ' + esc(a.lbl) + '</span>'; }).join('') + '</div>' +
        '<details class="xa-tabla-dias"><summary>Ver como tabla</summary><div id="xa-serie-tabla"></div></details>' +
      '</section>';
    $('xa-dias').onchange = function () { XA.dias = Number($('xa-dias').value) || 30; cargarSentimiento(); };
    xaPintarLista();
    xaDibujarSerie();
  }
  function xaNivel(tipo, x, n, de) {
    var p = xaPct(n, de);
    return '<button type="button" class="xa-nivel" data-xa="' + tipo + '" data-v="' + x.k + '" aria-pressed="false" style="--tono:' + x.tono + '"' +
      ' aria-label="' + esc(x.lbl + ': ' + n + ' ' + xaPlural(n, 'contacto', 'contactos') + ', ' + p + ' %. ' + x.d) + '">' +
      xaE(x.e) + '<span class="l">' + esc(x.lbl) + '</span><span class="d">' + esc(x.d) + '</span>' +
      '<span class="n"><b>' + n + '</b><span>' + p + ' %</span></span><span class="pista"><i style="width:' + p + '%"></i></span></button>';
  }
  function xaCruce(d) {
    var max = 1;
    XA_INTERES.forEach(function (i) { XA_ANIMO.forEach(function (a) { max = Math.max(max, d.cruce[i.k][a.k]); }); });
    return '<table class="xa-cruce"><caption class="sr-only">Cuántos contactos hay en cada nivel de interés según su ánimo</caption><thead><tr><th scope="col"><span class="sr-only">Interés</span></th>' +
      XA_ANIMO.map(function (a) { return '<th scope="col">' + xaE(a.e) + '<span class="lbl">' + esc(a.lbl) + '</span></th>'; }).join('') + '</tr></thead><tbody>' +
      XA_INTERES.map(function (i) {
        return '<tr><th scope="row">' + xaE(i.e) + '<span class="lbl">' + esc(i.lbl) + '</span></th>' + XA_ANIMO.map(function (a) {
          var n = d.cruce[i.k][a.k], cuidar = i.k >= 2 && a.k === 'negativo';
          // Tinta según cuántos (de 8 % a 32 %): la cifra se sigue leyendo encima, en claro y en oscuro.
          var p = n ? Math.round(8 + (n / max) * 24) : 0;
          return '<td><button type="button" class="xa-celda' + (n ? '' : ' vacia') + (cuidar ? ' cuidar' : '') + '"' + (n ? '' : ' disabled') +
            ' data-xa="cruce" data-v="' + i.k + '|' + a.k + '" aria-pressed="false" style="--tono:' + a.tono + ';--p:' + p + '%"' +
            ' aria-label="' + esc(i.lbl + ' y ' + a.lbl.toLowerCase() + ': ' + n + ' ' + xaPlural(n, 'contacto', 'contactos') + (cuidar && n ? '. Para cuidar primero' : '')) + '">' + n + '</button></td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table>' +
      '<div class="xa-leyenda">' + XA_ANIMO.map(function (a) { return '<span><i style="--tono:' + a.tono + '"></i>' + esc(a.lbl) + '</span>'; }).join('') +
      '<span><i class="borde"></i>Interés con molestia</span></div>';
  }
  function xaObjeciones(d) {
    if (!d.objeciones.length) return '<div class="xa-vacio" style="min-height:140px">' + xaE('🙌') + '<b>Nadie ha puesto una objeción</b><span>Cuando alguien diga que le queda lejos, que le parece caro o que no le da el tiempo, sale aquí con cuántos lo dijeron.</span></div>';
    var max = d.objeciones[0].n || 1;
    return '<ul class="xa-obj">' + d.objeciones.map(function (o, i) {
      var t = o.texto.charAt(0).toUpperCase() + o.texto.slice(1);
      return '<li><button type="button" data-xa="objecion" data-v="' + i + '" aria-pressed="false" aria-label="' + esc(t + ': ' + o.n + ' ' + xaPlural(o.n, 'contacto', 'contactos')) + '">' +
        '<span class="t">' + esc(t) + '</span><b>' + o.n + '</b><span class="pista" aria-hidden="true"><i style="width:' + xaPct(o.n, max) + '%"></i></span></button></li>';
    }).join('') + '</ul>';
  }

  // ---- la lista de quiénes ----
  function xaFiltrados(d) {
    var f = XA.filtro, L = d.contactos.slice();
    if (f) L = L.filter(function (c) {
      if (f.tipo === 'interes') return c.interes === Number(f.v);
      if (f.tipo === 'animo') return c.animo === f.v;
      if (f.tipo === 'cruce') { var p = f.v.split('|'); return c.interes === Number(p[0]) && c.animo === p[1]; }
      if (f.tipo === 'objecion') { var o = d.objeciones[Number(f.v)]; return Boolean(o) && o.ids.indexOf(c.id) >= 0; }
      if (f.tipo === 'cuidar') return c.interes !== null && c.interes >= 2 && c.animo === 'negativo';
      return true;
    });
    // Primero quien más interés trae; entre iguales, el análisis más reciente.
    return L.sort(function (a, b) { return (b.interes === null ? -1 : b.interes) - (a.interes === null ? -1 : a.interes) || (b.analizadoEn || 0) - (a.analizadoEn || 0); });
  }
  function xaTituloDelFiltro(d) {
    var f = XA.filtro;
    if (!f) return 'Todos los analizados';
    if (f.tipo === 'interes') { var i = xaDe(XA_INTERES, Number(f.v)); return i.e + ' ' + i.lbl; }
    if (f.tipo === 'animo') { var a = xaDe(XA_ANIMO, f.v); return a.e + ' ' + a.lbl; }
    if (f.tipo === 'cruce') { var p = f.v.split('|'), ii = xaDe(XA_INTERES, Number(p[0])), aa = xaDe(XA_ANIMO, p[1]); return ii.e + ' ' + ii.lbl + ' y ' + aa.e + ' ' + aa.lbl.toLowerCase(); }
    if (f.tipo === 'objecion') { var o = d.objeciones[Number(f.v)]; return 'Frena: «' + (o ? o.texto : '') + '»'; }
    return '⚠️ Para cuidar: interés con molestia';
  }
  function xaDato(lista, k, que) {
    var x = k === null || k === undefined ? null : xaDe(lista, k);
    return x ? '<span class="dato"><span class="sr-only">' + que + ': </span>' + xaE(x.e) + '<span>' + esc(x.lbl) + '</span></span>'
      : '<span class="dato sin"><span class="sr-only">' + que + ': </span>Sin dato</span>';
  }
  function xaPintarLista() {
    var d = XA.datos, cuerpo = $('xa-lista-cuerpo');
    if (!d || !cuerpo) return;
    var L = xaFiltrados(d), visibles = XA.todos ? L : L.slice(0, XA_LISTA_MAX);
    var titulo = xaTituloDelFiltro(d);
    // El emoji del título es decoración: se le pinta aparte para que el lector no lo lea.
    $('xa-lista-t').innerHTML = esc(titulo).replace(/^(\S+) /, function (m, e) { return /[A-Za-zÁ-ú«]/.test(e) ? m : xaE(e) + ' '; });
    $('xa-lista-sub').textContent = L.length + ' ' + xaPlural(L.length, 'contacto', 'contactos') + (L.length ? ' · toca uno para abrir su ficha' : '');
    $('xa-lista-todos').hidden = !XA.filtro;
    document.querySelectorAll('#xa-sent [data-xa]').forEach(function (b) {
      var on = Boolean(XA.filtro) && XA.filtro.tipo === b.getAttribute('data-xa') && String(XA.filtro.v) === b.getAttribute('data-v');
      b.setAttribute('aria-pressed', String(on));
    });
    if (!L.length) { cuerpo.innerHTML = '<div class="xa-vacio" style="min-height:120px"><b>Nadie en este grupo</b><span>Prueba con otro nivel o vuelve a ver todos.</span></div>'; return; }
    cuerpo.innerHTML = '<ul>' + visibles.map(function (c) {
      var nombre = xaNombre(c), linea = c.objecion ? 'Frena: ' + c.objecion : (c.resumen || c.telefono || '');
      return '<li><button type="button" class="xa-persona" data-id="' + esc(c.id) + '">' +
        '<span class="ini" aria-hidden="true">' + esc(inicialesDe(nombre)) + '</span>' +
        '<span class="quien"><b>' + esc(nombre) + '</b>' + (linea ? '<small' + (c.objecion ? ' class="frena"' : '') + '>' + esc(linea) + '</small>' : '') + '</span>' +
        '<span class="etapa-celda">' + pastillaEtapa(c.etapa) + '</span>' +
        xaDato(XA_INTERES, c.interes, 'Interés') + xaDato(XA_ANIMO, c.animo, 'Ánimo') +
        '<span class="cuando"><span class="sr-only">Último análisis: </span>' + esc(xaHace(c.analizadoEn)) + '</span></button></li>';
    }).join('') + '</ul>' +
      (L.length > visibles.length ? '<p class="xa-lista-pie">Se ven ' + visibles.length + ' de ' + L.length + '. <button type="button" class="linkbtn" data-xa-ir="mas">Ver los ' + L.length + '</button></p>' : '');
  }
  function xaElegir(tipo, v, desde) {
    var igual = XA.filtro && XA.filtro.tipo === tipo && String(XA.filtro.v) === String(v);
    XA.filtro = igual ? null : { tipo: tipo, v: v };
    XA.todos = false;
    xaPintarLista();
    if ($('xa-anuncio')) $('xa-anuncio').textContent = $('xa-lista-t').textContent + ': ' + $('xa-lista-sub').textContent;
    // Si se eligió desde abajo (el cruce, lo que frena), la lista queda arriba: se lleva a la vista.
    var lista = document.querySelector('#xa-sent .xa-lista');
    if (lista && desde && lista.getBoundingClientRect().top < 0) lista.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }
  if ($('xa-sent')) $('xa-sent').addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    var persona = t.closest('.xa-persona');
    if (persona) { abrirPerfil(persona.getAttribute('data-id'), xaFiltrados(XA.datos).map(function (c) { return c.id; })); return; }
    var ir = t.closest('[data-xa-ir]');
    if (ir) {
      var a = ir.getAttribute('data-xa-ir');
      if (a === 'reintentar') cargarSentimiento();
      else if (a === 'todos') { XA.filtro = null; XA.todos = false; xaPintarLista(); }
      else if (a === 'mas') { XA.todos = true; xaPintarLista(); }
      else go(a);
      return;
    }
    var b = t.closest('[data-xa]');
    if (b && !b.disabled) xaElegir(b.getAttribute('data-xa'), b.getAttribute('data-v'), b.closest('.xa-fila:not(.xa-fila-35)') || b.classList.contains('xa-cuidar'));
  });

  // ---- cómo cambió: barras apiladas por día ----
  function xaBarraArriba(x, y, w, h, r) {
    r = Math.min(r, h, w / 2);
    return '<path d="M' + x + ',' + (y + h) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h) + 'Z"';
  }
  function xaDibujarSerie() {
    var d = XA.datos, caja = $('xa-serie');
    if (!d || !caja || XA.tab !== 'sentimiento') return;
    var dias = d.serie || [], hay = dias.some(function (x) { return x.positivo + x.neutral + x.negativo; });
    var conAlgo = dias.filter(function (x) { return x.positivo + x.neutral + x.negativo; }).length;
    $('xa-serie-sub').textContent = hay ? 'El ánimo del último análisis de cada contacto, día por día (' + conAlgo + ' ' + xaPlural(conAlgo, 'día con análisis', 'días con análisis') + ' de ' + d.dias + ').' : 'El ánimo del último análisis de cada contacto, día por día.';
    if (!hay) {
      caja.innerHTML = '<div class="xa-vacio" style="min-height:160px"><b>Sin análisis en los últimos ' + d.dias + ' días</b><span>Cuando se analice una conversación, su ánimo de ese día sale aquí.</span></div>';
      $('xa-serie-tabla').innerHTML = '';
      return;
    }
    var W = Math.max(280, caja.clientWidth || 640), H = 220, izq = 28, abajo = 24, arriba = 8;
    var max = Math.max.apply(null, dias.map(function (x) { return x.positivo + x.neutral + x.negativo; })) || 1;
    var paso = (W - izq) / dias.length, ancho = Math.max(3, Math.min(24, paso * 0.62));
    var Y = function (v) { return H - abajo - (v * (H - abajo - arriba)) / max; };
    var cada = Math.max(1, Math.ceil(dias.length / 8));
    var svg = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Ánimo por día en los últimos ' + d.dias + ' días. El detalle está en «Ver como tabla».">';
    [0, Math.ceil(max / 2), max].filter(function (v, i, a) { return a.indexOf(v) === i; }).forEach(function (v) {
      svg += '<line class="rejilla" x1="' + izq + '" x2="' + W + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/><text class="eje" x="' + (izq - 8) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + v + '</text>';
    });
    dias.forEach(function (x, i) {
      var cx = izq + paso * i + (paso - ancho) / 2, base = Y(0), trozos = [];
      XA_ANIMO.forEach(function (a) { if (x[a.k]) trozos.push({ a: a, n: x[a.k] }); });
      var total = trozos.reduce(function (s, t) { return s + t.n; }, 0);
      svg += '<g class="col" data-i="' + i + '"' + (total ? ' tabindex="0" role="img" aria-label="' + esc(etiquetaDia(x.dia) + ': ' + trozos.map(function (t) { return t.n + ' ' + t.a.lbl.toLowerCase(); }).join(', ')) + '"' : '') + '>' +
        '<rect class="zona" x="' + (izq + paso * i) + '" y="' + arriba + '" width="' + paso + '" height="' + (H - abajo - arriba) + '" rx="4"/>';
      var y = base;
      trozos.forEach(function (t, j) {
        var h = Math.max(2, (t.n * (H - abajo - arriba)) / max - (j < trozos.length - 1 ? 2 : 0));
        y -= h;
        svg += j === trozos.length - 1 ? xaBarraArriba(cx, y, ancho, h, 4) + ' fill="' + t.a.tono + '"/>' : '<rect x="' + cx + '" y="' + y + '" width="' + ancho + '" height="' + h + '" fill="' + t.a.tono + '"/>';
        y -= 2;
      });
      svg += '</g>';
      if (i % cada === 0 || i === dias.length - 1) svg += '<text class="eje" x="' + (izq + paso * i + paso / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(etiquetaDia(x.dia)) + '</text>';
    });
    caja.innerHTML = svg + '</svg><div class="xa-globo" id="xa-globo" hidden></div>';
    var globo = $('xa-globo');
    caja.querySelectorAll('.col').forEach(function (g) {
      var mostrar = function () {
        var x = dias[Number(g.getAttribute('data-i'))], n = x.positivo + x.neutral + x.negativo;
        if (!n) { globo.hidden = true; return; }
        globo.innerHTML = '<b>' + esc(etiquetaDia(x.dia)) + '</b>' + XA_ANIMO.map(function (a) { return x[a.k] ? xaE(a.e) + ' ' + x[a.k] + ' ' + esc(a.lbl.toLowerCase()) : ''; }).filter(Boolean).join(' · ') +
          (x.interesMedio !== null ? '<br>Interés medio: ' + String(x.interesMedio).replace('.', ',') + ' de 3' : '');
        globo.hidden = false;
        var r = g.getBoundingClientRect(), rc = caja.getBoundingClientRect();
        var left = r.left - rc.left + r.width / 2 - globo.offsetWidth / 2;
        globo.style.left = Math.max(0, Math.min(rc.width - globo.offsetWidth, left)) + 'px';
        globo.style.top = '0px';
      };
      g.onmouseenter = mostrar; g.onfocus = mostrar;
      g.onmouseleave = function () { globo.hidden = true; }; g.onblur = function () { globo.hidden = true; };
    });
    $('xa-serie-tabla').innerHTML = '<table class="tz-tabla"><thead><tr><th scope="col">Día</th>' + XA_ANIMO.map(function (a) { return '<th scope="col">' + esc(a.lbl) + '</th>'; }).join('') + '<th scope="col">Interés medio</th></tr></thead><tbody>' +
      dias.filter(function (x) { return x.positivo + x.neutral + x.negativo; }).map(function (x) {
        return '<tr><th scope="row">' + esc(etiquetaDia(x.dia)) + '</th>' + XA_ANIMO.map(function (a) { return '<td>' + x[a.k] + '</td>'; }).join('') + '<td>' + (x.interesMedio === null ? '—' : String(x.interesMedio).replace('.', ',') + ' de 3') + '</td></tr>';
      }).join('') + '</tbody></table>';
  }
  var xaAlRedimensionar;
  window.addEventListener('resize', function () { clearTimeout(xaAlRedimensionar); xaAlRedimensionar = setTimeout(function () {
    if (state.view !== 'analysis') return;
    if (XA.tab === 'sentimiento') xaDibujarSerie(); else if (XA.nuevas) pintarNuevas(XA.nuevas);
  }, 150); });

  // ---- el sentimiento en el Resumen: tres cifras y la puerta ----
  function pintarMiniSentimiento() {
    var el = $('sentiments'), d = XA.datos;
    if (!el) return;
    var puntaje = XA.puntaje === null ? '' : '<div class="small muted solo-completo">Puntaje promedio: ' + XA.puntaje + '</div>';
    var boton = '<button type="button" class="btn sm" data-xa-mini="sentimiento">Ver el sentimiento</button>';
    if (!d) { el.innerHTML = '<div class="small muted">Cargando…</div>'; return; }
    if (!d.analizados) { el.innerHTML = '<div class="small muted">Todavía no hay conversaciones analizadas.</div>' + puntaje + boton; return; }
    el.innerHTML = '<div class="xa-mini-fila">' + XA_ANIMO.map(function (a) {
      return '<div>' + xaE(a.e) + '<b>' + d.animo[a.k] + '</b><span>' + esc(a.lbl) + '</span></div>';
    }).join('') + '</div>' + puntaje + boton;
  }
  if ($('sentiments')) $('sentiments').addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('[data-xa-mini]')) { xaPestana('sentimiento', true); }
  });
  // (fin de XEN · Analítica y sentimiento)

  // ===== XEN · Embudo y filtrado: lo nuevo del agente del embudo (se carga con alAbrir('embudo', …)) =====
  // El filtrado de Dynamics 365, en las tres pantallas de la gente con trato —Contactos, Tratos y Embudo—: arriba la
  // VISTA (las del sistema y las que guarda cada quien, cada una con su número) y encima de la vista, los FILTROS
  // (etapa, asignado, canal, temperatura, valor, última actividad, un dato captado), que se ven como píldoras y se
  // quitan con ×. Lo que se arma se puede guardar con nombre, y queda en el navegador de quien lo guardó.
  //
  // 🪤 Un solo estado por pantalla. En Contactos la vista ES el grupo de siempre (`cli.grupo`): los grupos pasaron
  // a ser las vistas del sistema, y por eso no hay una segunda fila que diga otra cosa. En Tratos y Embudo vive en
  // xfE(p). Nada se pide de nuevo al filtrar: se filtra lo que ya llegó.
  //
  // 🪤 La temperatura va con el puntaje: en el modo fácil no se ofrece, y si había quedado puesta, no cuenta.
  //
  // El Embudo cuenta hasta dónde LLEGÓ cada trato (la historia de cambios de etapa, crm/embudo.ts) y no solo dónde
  // está hoy: así «de cada diez que llegan a Interesado, seis piden cita» sale de lo que pasó. Una ficha sin
  // historia cuenta por su etapa de hoy, y la pantalla dice cuántas son en vez de repartirlas como si se supiera.
  ICONS.filtros = '<path d="M3 5h18M6 12h12M10 19h4"/>';
  ICONS.lista = '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>';
  ICONS.guardar = '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>';
  var XF_NOMBRE = { clientes: 'Contactos', pipeline: 'Tratos', embudo: 'Embudo' };
  var XF_ACTIVIDAD = [['', 'Cualquiera'], ['hoy', 'Hoy'], ['7', 'En los últimos 7 días'], ['30', 'En los últimos 30 días'], ['mas30', 'Hace más de 30 días']];
  var XF_TEMP = [['', 'Cualquiera'], ['caliente', 'Caliente'], ['tibio', 'Tibio'], ['frio', 'Frío']];
  var XF_DIAS = [['7', 'en los últimos 7 días'], ['30', 'en los últimos 30 días'], ['90', 'en los últimos 90 días'], ['365', 'en el último año'], ['0', 'desde siempre']];
  var XF_ESTADOS = {};
  var XF_HIST = { pasos: null, etapas: null, cargando: false, error: '' };

  function xfSinAsignar(c) { return !String(c.responsable || '').trim(); }
  function xfConCita(c) { return rol(c.stage) === 'cita' || Boolean(c.proximo && c.proximo.tipo === 'cita'); }
  function xfAbierto(c) { var r = rol(c.stage); return r !== 'ganado' && r !== 'perdido'; }
  /** ¿Se cerró en este mes del calendario? Sale del evento que la cerró, no de la última vez que escribió. */
  function xfEsteMes(id) {
    var p = XF_HIST.pasos && XF_HIST.pasos[id];
    if (!p || !p.cerro) return false;
    var d = new Date(p.cerro), h = new Date();
    return d.getFullYear() === h.getFullYear() && d.getMonth() === h.getMonth();
  }
  function xfCtx() { return { facil: esFacil(), ahora: Date.now() }; }
  /** El estado de una pantalla (vista, filtros y lo demás), recuperado del navegador la primera vez. */
  function xfE(p) {
    if (XF_ESTADOS[p]) return XF_ESTADOS[p];
    var e = { vista: 'todos', cond: {}, modo: 'tablero', dias: '90' };
    try {
      var g = JSON.parse(localStorage.getItem(LLAVE('xf.' + p)) || 'null');
      if (g && typeof g === 'object') {
        if (typeof g.vista === 'string') e.vista = g.vista;
        if (g.cond && typeof g.cond === 'object') e.cond = g.cond;
        if (g.modo === 'lista') e.modo = 'lista';
        if (/^(7|30|90|365|0)$/.test(String(g.dias))) e.dias = String(g.dias);
      }
    } catch (er) { /* sin almacenamiento: se empieza de cero */ }
    // En Contactos la vista es el grupo: se recupera solo si nadie eligió otro antes (las listas del riel lo hacen).
    if (p === 'clientes' && cli.grupo === 'todos' && e.vista !== 'todos') cli.grupo = e.vista;
    XF_ESTADOS[p] = e;
    return e;
  }
  function xfVista(p) { return p === 'clientes' ? cli.grupo : xfE(p).vista; }
  function xfGuardar(p) {
    var e = xfE(p);
    try { localStorage.setItem(LLAVE('xf.' + p), JSON.stringify({ vista: xfVista(p), cond: e.cond, modo: e.modo, dias: e.dias })); } catch (er) { /* sin almacenamiento: se olvida al cerrar */ }
  }
  function xfGuardadas(p) {
    try { var l = JSON.parse(localStorage.getItem(LLAVE('vistas.' + p)) || '[]'); return Array.isArray(l) ? l.filter(function (v) { return v && v.id && v.nombre; }) : []; } catch (er) { return []; }
  }
  function xfPonerGuardadas(p, l) {
    try { localStorage.setItem(LLAVE('vistas.' + p), JSON.stringify(l.slice(0, 20))); return true; } catch (er) { toast('No se pudo guardar la vista: este navegador no deja guardar nada.'); return false; }
  }
  /** Las vistas del sistema de cada pantalla: solo las que se calculan con datos de verdad. */
  function xfVistasSistema(p) {
    if (p === 'clientes') return GRUPOS_CLI.filter(function (g) { return !g.hay || g.hay(); }).map(function (g) { return { id: g.g, t: g.t, es: g.es }; });
    return [
      { id: 'todos', t: 'Todos los tratos', es: function () { return true; } },
      { id: 'abiertos', t: 'Tratos abiertos', es: xfAbierto },
      { id: 'mios', t: 'Mis tratos', es: esMia, hay: function () { return Boolean(state.name); } },
      { id: 'sinasignar', t: 'Sin asignar', es: xfSinAsignar },
      { id: 'calientes', t: '🔥 Calientes', es: esCaliente },
      { id: 'concita', get t() { return 'Con ' + VOC.cita; }, es: xfConCita },
      { id: 'ganados_mes', t: 'Ganados este mes', historia: true, es: function (c) { return rol(c.stage) === 'ganado' && xfEsteMes(c.id); } },
      { id: 'perdidos_mes', t: 'Perdidos este mes', historia: true, es: function (c) { return rol(c.stage) === 'perdido' && xfEsteMes(c.id); } }
    ].filter(function (v) { return !v.hay || v.hay(); });
  }
  /** Las del sistema y, detrás, las guardadas (su vista de abajo y sus filtros). */
  function xfVistas(p) {
    var sis = xfVistasSistema(p);
    var porId = {};
    sis.forEach(function (v) { porId[v.id] = v; });
    return sis.concat(xfGuardadas(p).map(function (g) {
      var base = porId[g.base] || sis[0];
      return { id: 'v:' + g.id, t: g.nombre, guardada: g, es: function (c) { return base.es(c) && xfCumple(c, g.cond, xfCtx()); } };
    }));
  }
  /** Los grupos de Contactos con las vistas guardadas detrás, en la forma de GRUPOS_CLI. */
  function xfGruposClientes() {
    xfE('clientes');
    return xfVistas('clientes').map(function (v) { return { g: v.id, t: v.guardada ? '★ ' + v.t : v.t, es: v.es, guardada: Boolean(v.guardada) }; });
  }
  function xfVistaActual(p) {
    var l = xfVistas(p), id = xfVista(p);
    return l.filter(function (v) { return v.id === id; })[0] || l[0];
  }
  /** Vista + filtros de una pantalla, como una sola prueba por trato. */
  function xfFiltro(p) {
    var v = xfVistaActual(p), cond = xfE(p).cond, ctx = xfCtx();
    return function (c) { return v.es(c) && xfCumple(c, cond, ctx); };
  }
  /**
   * ¿Cumple las condiciones? Pura (test:embudo): no mira nada de fuera más que lo que se le pasa.
   * Un valor que no se sabe no cumple «desde» ni «hasta»: no se sabe si cumple, y meterlo diría que sí.
   */
  function xfCumple(c, cond, ctx) {
    if (!cond) return true;
    ctx = ctx || {};
    var norm = function (x) { return String(x == null ? '' : x).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim(); };
    if (cond.etapas && cond.etapas.length && cond.etapas.indexOf(c.stage) < 0) return false;
    if (cond.asignado) {
      var r = norm(c.responsable);
      if (cond.asignado === '__nadie' ? r : r !== norm(cond.asignado)) return false;
    }
    if (cond.canal && c.channel !== cond.canal) return false;
    if (cond.temp && !ctx.facil && c.temperature !== cond.temp) return false;
    var v = Number(c.valor) || 0;
    if (cond.vmin != null && cond.vmin !== '' && !(v > 0 && v >= Number(cond.vmin))) return false;
    if (cond.vmax != null && cond.vmax !== '' && !(v > 0 && v <= Number(cond.vmax))) return false;
    if (cond.act) {
      var ahora = ctx.ahora || Date.now(), t = c.lastMessageAt || c.lastSeen || 0, dia = 86400000;
      var hoy = new Date(ahora);
      hoy.setHours(0, 0, 0, 0);
      if (cond.act === 'hoy' && t < hoy.getTime()) return false;
      if (cond.act === '7' && ahora - t > 7 * dia) return false;
      if (cond.act === '30' && ahora - t > 30 * dia) return false;
      if (cond.act === 'mas30' && ahora - t <= 30 * dia) return false;
    }
    if (cond.datoK) {
      var d = c.data && c.data[cond.datoK];
      if (d === '' || d == null || typeof d === 'object') return false;
      if (cond.datoV && norm(d).indexOf(norm(cond.datoV)) < 0) return false;
    }
    return true;
  }
  /** Las condiciones puestas, cada una con su texto (lo que dice la píldora) y cómo quitarla. */
  function xfCondiciones(p) {
    var c = xfE(p).cond, out = [];
    if (c.etapas && c.etapas.length) out.push({ k: 'etapas', t: 'Etapa: ' + c.etapas.map(function (id) { return state.stageLabels[id] || id; }).join(', ') });
    if (c.asignado) out.push({ k: 'asignado', t: 'Asignado a: ' + (c.asignado === '__nadie' ? 'nadie' : c.asignado) });
    if (c.canal) out.push({ k: 'canal', t: 'Canal: ' + canalSolo(c.canal) });
    if (c.temp && !esFacil()) out.push({ k: 'temp', t: 'Temperatura: ' + ({ caliente: 'caliente', tibio: 'tibio', frio: 'frío' }[c.temp] || c.temp) });
    var hayMin = c.vmin != null && c.vmin !== '', hayMax = c.vmax != null && c.vmax !== '';
    if (hayMin || hayMax) out.push({ k: 'valor', t: 'Valor: ' + (hayMin && hayMax ? 'entre ' + plataCorta(Number(c.vmin)) + ' y ' + plataCorta(Number(c.vmax)) : hayMin ? 'desde ' + plataCorta(Number(c.vmin)) : 'hasta ' + plataCorta(Number(c.vmax))) });
    if (c.act) out.push({ k: 'act', t: 'Última actividad: ' + (XF_ACTIVIDAD.filter(function (x) { return x[0] === c.act; })[0] || ['', c.act])[1].toLowerCase() });
    if (c.datoK) out.push({ k: 'dato', t: etiquetaDato(c.datoK) + ': ' + (c.datoV ? 'dice «' + c.datoV + '»' : 'con dato') });
    return out;
  }
  function xfCuantasCond(p) { return xfCondiciones(p).length; }
  function xfHayCond(p) { return xfCuantasCond(p) > 0; }
  function xfQuitar(p, k) {
    var c = xfE(p).cond;
    if (k === 'valor') { delete c.vmin; delete c.vmax; } else if (k === 'dato') { delete c.datoK; delete c.datoV; } else delete c[k];
  }
  /** Volver a pintar lo que la pantalla muestra con lo que ya llegó (sin pedir nada). */
  function xfRepintar(p) {
    xfGuardar(p);
    if (p === 'clientes') renderClientes();
    else if (p === 'pipeline') { if (state.pipeTodos) pintarPipeline(); else xfPintarBarra('pipeline'); }
    else if (p === 'embudo') pintarEmbudo();
  }
  function xfDatosDe(p) {
    if (p === 'clientes') return cli.lista || [];
    if (p === 'pipeline') return (state.pipeTodos || []).filter(deLaSede);
    return (XE.contactos || []).filter(deLaSede);
  }
  /** La historia de etapas (cuándo se cerró cada trato): la usan las vistas «este mes» y el Embudo. */
  function xfCargarHistoria(listo) {
    if (XF_HIST.cargando && !listo) return;
    XF_HIST.cargando = true;
    api('/embudo').then(function (r) {
      XF_HIST.cargando = false;
      if (!r || r.error || !Array.isArray(r.tratos)) { XF_HIST.error = (r && r.error) || 'sin respuesta del servidor'; if (listo) listo(false); return; }
      XF_HIST.error = '';
      XF_HIST.pasos = {};
      r.tratos.forEach(function (t) { XF_HIST.pasos[t.id] = t; });
      XF_HIST.etapas = r.etapas;
      if (listo) listo(true);
      // Si ya se estaba mirando Tratos, las vistas «este mes» se cuentan con la historia que acaba de llegar.
      else if (state.view === 'pipeline' && state.pipeTodos) pintarPipeline();
    });
  }

  /** La fila de las vistas (Tratos y Embudo; en Contactos son los grupos de siempre), cada una con su número. */
  function xfPintarVistas(p, datos) {
    var caja = $('xf-' + p + '-vistas');
    if (!caja || p === 'clientes') return;
    var cond = xfE(p).cond, ctx = xfCtx(), act = xfVista(p);
    var vistas = xfVistas(p);
    if (!vistas.some(function (v) { return v.id === act; })) xfE(p).vista = act = vistas[0].id;
    caja.innerHTML = vistas.map(function (v) {
      // Mientras no llega la historia, las vistas «este mes» van sin número: «0» diría que no hubo ninguno.
      var n = v.historia && !XF_HIST.pasos ? '' : datos.filter(function (c) { return v.es(c) && xfCumple(c, cond, ctx); }).length;
      var on = v.id === act;
      return '<button type="button" data-vista="' + esc(v.id) + '" class="' + (on ? 'on' : '') + (v.guardada ? ' xf-guardada' : '') + '" aria-pressed="' + on + '">' + esc((v.guardada ? '★ ' : '') + v.t) + '<span class="cuenta">' + n + '</span></button>';
    }).join('');
    caja.querySelectorAll('[data-vista]').forEach(function (b) {
      b.onclick = function () { xfE(p).vista = b.getAttribute('data-vista'); xfRepintar(p); };
    });
  }
  /**
   * La barra de una pantalla: la fila de las vistas (salvo en Contactos), y debajo el botón Filtros con su panel,
   * las condiciones como píldoras, Guardar vista y, según la pantalla, Tablero | Lista o el periodo.
   */
  function xfPintarBarra(p) {
    var caja = $('xf-' + p);
    if (!caja) return;
    var e = xfE(p);
    if (!caja.getAttribute('data-armada')) {
      caja.setAttribute('data-armada', '1');
      caja.innerHTML = (p === 'clientes' ? '' : '<div class="filters xf-vistas" id="xf-' + p + '-vistas" role="group" aria-label="Vistas de ' + XF_NOMBRE[p] + '"></div>') +
        '<div class="xf-fila2">' +
          '<div class="xf-caja-filtros"><button type="button" class="btn sm xf-btn-filtros" id="xf-' + p + '-btn" aria-expanded="false" aria-controls="xf-' + p + '-panel"><i class="ic" data-ic="filtros"></i>Filtros<span class="xf-n" id="xf-' + p + '-n"></span></button>' +
            '<div class="xf-panel" id="xf-' + p + '-panel" role="dialog" aria-label="Filtros de ' + XF_NOMBRE[p] + '" hidden></div></div>' +
          '<ul class="xf-chips" id="xf-' + p + '-chips" aria-label="Filtros puestos"></ul>' +
          '<span class="grow"></span>' +
          (p === 'pipeline' ? '<div class="xf-seg" role="group" aria-label="Cómo ver los tratos"><button type="button" data-modo="tablero"><i class="ic" data-ic="kanban"></i>Tablero</button><button type="button" data-modo="lista"><i class="ic" data-ic="lista"></i>Lista</button></div>' : '') +
          (p === 'embudo' ? '<label class="xf-periodo"><span>Entraron</span><select id="xe-dias">' + XF_DIAS.map(function (d) { return '<option value="' + d[0] + '">' + esc(d[1]) + '</option>'; }).join('') + '</select></label>' : '') +
          '<div class="xf-caja-guardar"><button type="button" class="btn sm" id="xf-' + p + '-guardar" aria-expanded="false" aria-controls="xf-' + p + '-form"><i class="ic" data-ic="guardar"></i>Guardar vista</button>' +
            '<form class="xf-guardar" id="xf-' + p + '-form" hidden><label for="xf-' + p + '-nombre">Nombre de la vista</label><input type="text" id="xf-' + p + '-nombre" maxlength="40" autocomplete="off" placeholder="Ej.: ' + esc(VOC.ej.vista || 'Clientes de este mes') + '">' +
            '<span class="xf-guardar-err" id="xf-' + p + '-err" role="alert"></span><div class="xf-guardar-acc"><button type="button" class="btn sm" data-cancelar>Cancelar</button><button type="submit" class="btn sm primary">Guardar</button></div></form></div>' +
          '<button type="button" class="btn sm danger xf-borrar" id="xf-' + p + '-borrar" hidden>Eliminar vista</button>' +
        '</div>';
      iconos(caja);
      xfEnganchar(p);
    }
    // Lo que cambia con cada filtro: el número del botón, las píldoras, Tablero | Lista, el periodo y «Eliminar».
    var conds = xfCondiciones(p);
    $('xf-' + p + '-n').textContent = conds.length ? String(conds.length) : '';
    $('xf-' + p + '-btn').setAttribute('aria-label', conds.length ? 'Filtros: ' + conds.length + (conds.length === 1 ? ' puesto' : ' puestos') : 'Filtros');
    $('xf-' + p + '-chips').innerHTML = conds.map(function (c) {
      return '<li class="xf-chip"><span>' + esc(c.t) + '</span><button type="button" data-quitar="' + c.k + '" aria-label="Quitar el filtro «' + esc(c.t) + '»"><i class="ic" data-ic="cerrar"></i></button></li>';
    }).join('') + (conds.length > 1 ? '<li><button type="button" class="linkbtn xf-limpiar" data-quitar="*">Quitar todos</button></li>' : '');
    iconos($('xf-' + p + '-chips'));
    $('xf-' + p + '-chips').querySelectorAll('[data-quitar]').forEach(function (b) {
      b.onclick = function () {
        var k = b.getAttribute('data-quitar');
        if (k === '*') xfE(p).cond = {}; else xfQuitar(p, k);
        xfRepintar(p);
        // El foco no se pierde en la nada: vuelve al botón Filtros.
        $('xf-' + p + '-btn').focus();
      };
    });
    caja.querySelectorAll('[data-modo]').forEach(function (b) { var on = b.getAttribute('data-modo') === e.modo; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    if (p === 'embudo' && $('xe-dias')) $('xe-dias').value = e.dias;
    var actual = xfVistaActual(p);
    $('xf-' + p + '-borrar').hidden = !(actual && actual.guardada);
    if (actual && actual.guardada) $('xf-' + p + '-borrar').textContent = 'Eliminar «' + actual.t + '»';
  }
  function xfEnganchar(p) {
    var btn = $('xf-' + p + '-btn'), panel = $('xf-' + p + '-panel'), gbtn = $('xf-' + p + '-guardar'), form = $('xf-' + p + '-form');
    function cerrarPanel(devolver) { if (panel.hidden) return; panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); if (devolver) btn.focus(); }
    function cerrarForm(devolver) { if (form.hidden) return; form.hidden = true; gbtn.setAttribute('aria-expanded', 'false'); if (devolver) gbtn.focus(); }
    btn.onclick = function (ev) {
      ev.stopPropagation();
      if (!panel.hidden) { cerrarPanel(true); return; }
      cerrarForm(false);
      xfPintarPanel(p);
      panel.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      var primero = panel.querySelector('input, select, button');
      if (primero) primero.focus();
    };
    gbtn.onclick = function (ev) {
      ev.stopPropagation();
      if (!form.hidden) { cerrarForm(true); return; }
      cerrarPanel(false);
      form.hidden = false;
      gbtn.setAttribute('aria-expanded', 'true');
      $('xf-' + p + '-err').textContent = '';
      $('xf-' + p + '-nombre').value = '';
      $('xf-' + p + '-nombre').focus();
    };
    form.querySelector('[data-cancelar]').onclick = function () { cerrarForm(true); };
    form.onsubmit = function (ev) {
      ev.preventDefault();
      var nombre = $('xf-' + p + '-nombre').value.trim().replace(/\s+/g, ' ');
      // El nombre se queda escrito si algo falla: se corrige, no se vuelve a escribir.
      if (!nombre) { $('xf-' + p + '-err').textContent = 'Ponle un nombre para encontrarla después.'; $('xf-' + p + '-nombre').focus(); return; }
      var l = xfGuardadas(p);
      if (l.some(function (v) { return v.nombre.toLowerCase() === nombre.toLowerCase(); })) { $('xf-' + p + '-err').textContent = 'Ya tienes una vista con ese nombre.'; $('xf-' + p + '-nombre').focus(); return; }
      if (l.length >= 20) { $('xf-' + p + '-err').textContent = 'Ya tienes 20 vistas guardadas: elimina alguna antes.'; return; }
      var actual = xfVistaActual(p);
      // Lo que se guarda es lo que se ve: la vista de abajo (si era guardada, la suya) y todos los filtros juntos.
      var base = actual.guardada ? actual.guardada.base : actual.id;
      var cond = JSON.parse(JSON.stringify(actual.guardada ? actual.guardada.cond : {}));
      var ahora = xfE(p).cond;
      Object.keys(ahora).forEach(function (k) { cond[k] = ahora[k]; });
      var nueva = { id: Date.now().toString(36), nombre: nombre, base: base, cond: cond };
      l.push(nueva);
      if (!xfPonerGuardadas(p, l)) return;
      xfE(p).cond = {};
      if (p === 'clientes') cli.grupo = 'v:' + nueva.id; else xfE(p).vista = 'v:' + nueva.id;
      cerrarForm(false);
      xfRepintar(p);
      toast('Vista «' + nombre + '» guardada: está arriba, con las demás.');
    };
    $('xf-' + p + '-borrar').onclick = function () {
      var actual = xfVistaActual(p);
      if (!actual || !actual.guardada) return;
      var g = actual.guardada;
      xfPonerGuardadas(p, xfGuardadas(p).filter(function (v) { return v.id !== g.id; }));
      if (p === 'clientes') cli.grupo = 'todos'; else xfE(p).vista = 'todos';
      xfRepintar(p);
      // Se puede deshacer: tocar el aviso la devuelve tal cual.
      toast('Vista «' + g.nombre + '» eliminada. Toca aquí para deshacer.', function () {
        var l = xfGuardadas(p);
        if (!l.some(function (v) { return v.id === g.id; })) { l.push(g); xfPonerGuardadas(p, l); }
        if (p === 'clientes') cli.grupo = 'v:' + g.id; else xfE(p).vista = 'v:' + g.id;
        xfRepintar(p);
      });
    };
    $('xf-' + p).querySelectorAll('[data-modo]').forEach(function (b) {
      b.onclick = function () { xfE(p).modo = b.getAttribute('data-modo'); xfRepintar(p); };
    });
    if (p === 'embudo' && $('xe-dias')) $('xe-dias').onchange = function () { xfE('embudo').dias = $('xe-dias').value; xfRepintar('embudo'); };
    // Escape cierra lo que se abrió y devuelve el foco a quien lo abrió; un clic fuera, también.
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape') return;
      if (!panel.hidden) { ev.stopPropagation(); cerrarPanel(true); } else if (!form.hidden) { ev.stopPropagation(); cerrarForm(true); }
    });
    document.addEventListener('click', function (ev) {
      if (!panel.hidden && !panel.contains(ev.target) && !btn.contains(ev.target)) cerrarPanel(false);
      if (!form.hidden && !form.contains(ev.target) && !gbtn.contains(ev.target)) cerrarForm(false);
    });
  }
  /** El panel de Filtros, con lo que hay de verdad en los datos de esa pantalla (canales, asignados, campos). */
  function xfPintarPanel(p) {
    var panel = $('xf-' + p + '-panel'), c = xfE(p).cond, datos = xfDatosDe(p);
    var asignados = {}, canales = {}, campos = {};
    datos.forEach(function (x) {
      var r = String(x.responsable || '').trim();
      if (r) asignados[r] = 1;
      if (x.channel) canales[x.channel] = 1;
      datosCapturados(x).forEach(function (k) { campos[k] = 1; });
    });
    if (state.name) asignados[state.name] = 1;
    if (c.asignado && c.asignado !== '__nadie') asignados[c.asignado] = 1;
    if (c.canal) canales[c.canal] = 1;
    if (c.datoK) campos[c.datoK] = 1;
    var opc = function (lista, sel) { return lista.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === (sel == null ? '' : String(sel)) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join(''); };
    var id = function (k) { return 'xf-' + p + '-' + k; };
    var etapas = (state.stages || []).map(function (e) {
      var on = (c.etapas || []).indexOf(e.id) >= 0;
      return '<label class="xf-etapa"><input type="checkbox" value="' + esc(e.id) + '"' + (on ? ' checked' : '') + '><i class="punto" data-rol="' + esc(e.rol || '') + '" aria-hidden="true"></i>' + esc(e.label) + '</label>';
    }).join('');
    panel.innerHTML =
      '<div class="xf-panel-cab"><b>Filtros</b><span>Se aplican encima de la vista «' + esc(xfVistaActual(p).t.replace(/^[^\wÀ-ÿ]+\s*/, '')) + '».</span></div>' +
      '<fieldset class="xf-campo xf-etapas"><legend>Etapa</legend>' + etapas + '</fieldset>' +
      '<div class="xf-campo"><label for="' + id('asignado') + '">Asignado a</label><select id="' + id('asignado') + '" data-k="asignado">' +
        opc([['', 'Cualquiera'], ['__nadie', 'Sin asignar']].concat(Object.keys(asignados).sort().map(function (n) { return [n, n]; })), c.asignado) + '</select></div>' +
      '<div class="xf-campo"><label for="' + id('canal') + '">Canal</label><select id="' + id('canal') + '" data-k="canal">' +
        opc([['', 'Cualquiera']].concat(Object.keys(canales).map(function (k) { return [k, canalSolo(k)]; })), c.canal) + '</select></div>' +
      '<div class="xf-campo solo-completo"><label for="' + id('temp') + '">Temperatura</label><select id="' + id('temp') + '" data-k="temp">' + opc(XF_TEMP, c.temp) + '</select></div>' +
      '<fieldset class="xf-campo xf-valor"><legend>Valor</legend><label><span>Desde</span><input type="number" min="0" step="any" inputmode="numeric" id="' + id('vmin') + '" data-k="vmin" value="' + esc(c.vmin == null ? '' : c.vmin) + '"></label>' +
        '<label><span>Hasta</span><input type="number" min="0" step="any" inputmode="numeric" id="' + id('vmax') + '" data-k="vmax" value="' + esc(c.vmax == null ? '' : c.vmax) + '"></label><small>Los que no tienen valor no entran: no se sabe si cumplen.</small></fieldset>' +
      '<div class="xf-campo"><label for="' + id('act') + '">Última actividad</label><select id="' + id('act') + '" data-k="act">' + opc(XF_ACTIVIDAD, c.act) + '</select></div>' +
      '<fieldset class="xf-campo xf-dato"><legend>Un dato captado</legend><select id="' + id('datoK') + '" data-k="datoK" aria-label="Qué dato">' +
        opc([['', 'Ninguno']].concat(Object.keys(campos).sort().map(function (k) { return [k, etiquetaDato(k)]; })), c.datoK) + '</select>' +
        '<input type="text" id="' + id('datoV') + '" data-k="datoV" placeholder="que diga… (opcional)" aria-label="Qué debe decir el dato" value="' + esc(c.datoV || '') + '"' + (c.datoK ? '' : ' disabled') + '></fieldset>' +
      '<div class="xf-panel-pie"><button type="button" class="btn sm" data-limpiar>Quitar los filtros</button><button type="button" class="btn sm primary" data-listo>Listo</button></div>';
    var aplicar = function () { xfRepintar(p); };
    panel.querySelectorAll('.xf-etapas input').forEach(function (i) {
      i.onchange = function () {
        var l = Array.prototype.filter.call(panel.querySelectorAll('.xf-etapas input'), function (x) { return x.checked; }).map(function (x) { return x.value; });
        if (l.length) xfE(p).cond.etapas = l; else delete xfE(p).cond.etapas;
        aplicar();
      };
    });
    panel.querySelectorAll('select[data-k], input[data-k]').forEach(function (el) {
      el.onchange = function () {
        var k = el.getAttribute('data-k'), v = el.value.trim();
        // Una cifra que no es cifra se dice junto al campo y no se aplica; lo escrito se queda para corregirlo.
        if ((k === 'vmin' || k === 'vmax') && v !== '' && !(Number(v) >= 0)) { el.setCustomValidity('Escribe una cifra (solo números).'); el.reportValidity(); return; }
        el.setCustomValidity('');
        if (v === '') delete xfE(p).cond[k]; else xfE(p).cond[k] = (k === 'vmin' || k === 'vmax') ? Number(v) : v;
        if (k === 'datoK') { $(id('datoV')).disabled = !v; if (!v) { delete xfE(p).cond.datoV; $(id('datoV')).value = ''; } }
        aplicar();
      };
    });
    panel.querySelector('[data-limpiar]').onclick = function () { xfE(p).cond = {}; aplicar(); xfPintarPanel(p); panel.querySelector('input, select').focus(); };
    panel.querySelector('[data-listo]').onclick = function () { panel.hidden = true; $('xf-' + p + '-btn').setAttribute('aria-expanded', 'false'); $('xf-' + p + '-btn').focus(); };
  }
  /** Tratos en lista (Dynamics: la vista de cuadrícula): las columnas de un trato, ordenables con un clic. */
  var XF_LISTA = { orden: 'vez', al: 1 };
  function xfPintarListaTratos(list) {
    var caja = $('xf-pipeline-lista');
    if (!list.length) {
      var hay = xfHayCond('pipeline');
      caja.innerHTML = '<div class="fx-ct-vacio" role="status"><span class="fx-ct-vacio-ic"><i class="ic" data-ic="embudo"></i></span><b>' + (hay ? 'Ningún trato cumple estos filtros' : 'Ningún trato en esta vista por ahora') + '</b>' +
        '<p>' + (hay ? 'Quita alguno de los filtros de arriba.' : 'Cuando alguien cumpla con la vista, aparece aquí solo.') + '</p>' +
        '<button type="button" class="btn sm" data-ver-todos>' + (hay ? 'Quitar los filtros' : 'Ver todos los tratos') + '</button></div>';
      iconos(caja);
      caja.querySelector('[data-ver-todos]').onclick = function () { if (hay) xfE('pipeline').cond = {}; else xfE('pipeline').vista = 'todos'; xfRepintar('pipeline'); };
      return;
    }
    var etapasEnOrden = Object.keys(state.stageLabels);
    var ORD = {
      nombre: function (a, b) { return nameOf(a).localeCompare(nameOf(b), 'es'); },
      etapa: function (a, b) { return etapasEnOrden.indexOf(a.stage) - etapasEnOrden.indexOf(b.stage); },
      valor: function (a, b) { return (b.valor || 0) - (a.valor || 0); },
      vez: function (a, b) { return (b.lastMessageAt || 0) - (a.lastMessageAt || 0); }
    };
    var l = list.slice().sort(function (a, b) { return XF_LISTA.al * ORD[XF_LISTA.orden](a, b); });
    var ids = l.map(function (c) { return c.id; });
    var th = function (k, t, clase) {
      var on = XF_LISTA.orden === k;
      return '<th class="' + (clase || '') + '"' + (on ? ' aria-sort="' + (XF_LISTA.al === 1 ? 'descending' : 'ascending') + '"' : '') + '><button class="orden' + (on ? ' on' : '') + '" data-xf-orden="' + k + '">' + t + (on ? (XF_LISTA.al === 1 ? ' ↓' : ' ↑') : '') + '</button></th>';
    };
    var suma = 0, sinPrecio = 0;
    l.forEach(function (c) { if (c.valor) suma += c.valor; else sinPrecio++; });
    caja.innerHTML = '<table class="cli-tabla xf-tabla"><thead><tr>' + th('nombre', 'Trato') + th('etapa', 'Etapa') + '<th>Próximo paso</th><th>Asignado a</th>' + th('valor', 'Valor', 'num') + th('vez', 'Última actividad', 'num') + '</tr></thead><tbody>' +
      l.map(function (c) {
        return '<tr data-id="' + esc(c.id) + '"><td data-rot="Trato" class="fx-ct-quien"><div class="fx-ct-persona">' + avatarHtml(nameOf(c), c.id, 'sm') + '<div class="fx-ct-nom"><button class="quien" data-id="' + esc(c.id) + '">' + esc(nameOf(c)) + '</button><div class="dato">' + canalHtml(c.channel) + '</div></div></div></td>' +
          '<td data-rot="Etapa">' + pastillaEtapa(c.stage) + '</td>' +
          '<td data-rot="Próximo paso" class="proximo">' + pasoHtml(c.proximo) + '</td>' +
          '<td data-rot="Asignado a">' + (c.responsable ? esc(c.responsable) : '<span class="fx-ct-sin">Sin asignar</span>') + '</td>' +
          '<td data-rot="Valor" class="num">' + valorHtml(c) + '</td>' +
          '<td data-rot="Última actividad" class="num dato">' + esc(c.lastMessageAt ? rel(c.lastMessageAt) : '—') + '</td></tr>';
      }).join('') + '</tbody><tfoot><tr><td colspan="3">' + l.length + (l.length === 1 ? ' trato' : ' tratos') + '</td><td class="dato">' + (sinPrecio && suma ? sinPrecio + ' sin precio' : '') + '</td><td class="num">' + (suma ? '<span class="dato">Suma</span> <b>' + esc(plata(suma)) + '</b>' : '') + '</td><td></td></tr></tfoot></table>';
    caja.querySelectorAll('[data-xf-orden]').forEach(function (b) {
      b.onclick = function () { var k = b.getAttribute('data-xf-orden'); if (XF_LISTA.orden === k) XF_LISTA.al = -XF_LISTA.al; else { XF_LISTA.orden = k; XF_LISTA.al = 1; } xfPintarListaTratos(list); };
    });
    caja.querySelectorAll('tbody tr').forEach(function (tr) {
      tr.onclick = function (ev) { if (ev.target.closest('a, select, input')) return; abrirPerfil(tr.getAttribute('data-id'), ids); };
    });
  }

  // ---------- la pantalla Embudo ----------
  var XE = { contactos: null, cargando: false, error: '' };
  /**
   * El embudo de una lista de tratos, pura (test:embudo). Por cada etapa del camino (todas menos perdido, en el
   * orden del negocio): cuántos llegaron a ella o más allá, cuántos están ahí hoy y cuánto valen, y qué parte pasa
   * a la siguiente. Los perdidos van aparte, por la etapa desde la que se cayeron.
   */
  function calcularEmbudo(lista, pasos, etapas) {
    var camino = etapas.filter(function (e) { return e.rol !== 'perdido'; });
    var idx = {}, rolDe = {};
    camino.forEach(function (e, i) { idx[e.id] = i; });
    etapas.forEach(function (e) { rolDe[e.id] = e.rol; });
    var tramos = camino.map(function (e) { return { id: e.id, label: e.label, rol: e.rol, llegaron: 0, ahora: 0, valor: 0, sinPrecio: 0, perdidos: 0, pasan: null }; });
    var perdidos = { total: 0, sinSaber: 0, motivos: [] }, motivos = {}, sinHistoria = 0, abiertos = 0, valorAbierto = 0, sinPrecioAbierto = 0, ganados = 0;
    lista.forEach(function (c) {
      var p = pasos && pasos[c.id];
      var perdido = rolDe[c.stage] === 'perdido';
      if (!p || !p.conHistoria) sinHistoria++;
      // Hasta dónde llegó: lo que dice la historia; sin ella, la etapa de hoy; perdido y sin historia, solo entró.
      var hasta = p && p.alcanzo != null && idx[p.alcanzo] != null ? idx[p.alcanzo] : (!perdido && idx[c.stage] != null ? idx[c.stage] : 0);
      for (var i = 0; i <= hasta && i < tramos.length; i++) tramos[i].llegaron++;
      if (perdido) {
        perdidos.total++;
        var desde = p && p.cayoDesde != null && idx[p.cayoDesde] != null ? idx[p.cayoDesde] : null;
        if (desde == null) perdidos.sinSaber++; else tramos[desde].perdidos++;
        var m = String((c.data && c.data.motivo_perdida) || '').trim();
        if (m) motivos[m] = (motivos[m] || 0) + 1;
        return;
      }
      var t = tramos[idx[c.stage]];
      if (!t) return;
      t.ahora++;
      var v = Number(c.valor) || 0;
      if (v > 0) t.valor += v; else t.sinPrecio++;
      if (rolDe[c.stage] === 'ganado') ganados++;
      else { abiertos++; if (v > 0) valorAbierto += v; else sinPrecioAbierto++; }
    });
    tramos.forEach(function (t, i) { var sig = tramos[i + 1]; t.pasan = sig && t.llegaron ? sig.llegaron / t.llegaron : null; });
    // Dónde se quedan más: el paso con la menor proporción, entre los que tienen al menos tres que llegaron (con
    // menos, un solo caso decide el porcentaje y la pantalla señalaría un problema que no existe).
    var peor = null;
    tramos.forEach(function (t, i) { if (t.pasan != null && t.llegaron >= R('embudo.minParaMarcar', 3) && t.pasan < 1 && (peor == null || t.pasan < tramos[peor].pasan)) peor = i; });
    perdidos.motivos = Object.keys(motivos).map(function (k) { return { motivo: k, n: motivos[k] }; }).sort(function (a, b) { return b.n - a.n || a.motivo.localeCompare(b.motivo, 'es'); });
    return { total: lista.length, tramos: tramos, peor: peor, perdidos: perdidos, sinHistoria: sinHistoria, abiertos: abiertos, valorAbierto: valorAbierto, sinPrecioAbierto: sinPrecioAbierto, ganados: ganados };
  }
  function xePct(x) { return x == null ? '—' : Math.round(x * 100) + ' %'; }
  /** Un valor que se sabe, o lo que se sabe de él: nunca «$0» (cero diría que no vale nada). */
  function xeValor(v, cuantos, sinPrecio) {
    if (!cuantos) return '—';
    if (!v) return 'Sin precios';
    return plataCorta(v) + (sinPrecio ? ' · ' + sinPrecio + ' sin precio' : '');
  }
  function cargarEmbudo() {
    xfPintarBarra('embudo');
    XE.cargando = true;
    XE.error = '';
    if (!XE.contactos || !XF_HIST.pasos) pintarEmbudo();
    var faltan = 2, falla = '';
    var listo = function () { if (--faltan) return; XE.cargando = false; XE.error = falla; pintarEmbudo(); };
    api('/contacts?limit=2000').then(function (l) {
      if (Array.isArray(l)) XE.contactos = l; else falla = (l && l.error) || 'sin respuesta del servidor';
      listo();
    });
    xfCargarHistoria(function (ok) { if (!ok) falla = falla || XF_HIST.error; listo(); });
  }
  alAbrir('embudo', cargarEmbudo);
  function pintarEmbudo() {
    var caja = $('xe-cuerpo');
    if (!caja) return;
    xfPintarBarra('embudo');
    var todos = (XE.contactos || []).filter(deLaSede);
    xfPintarVistas('embudo', todos);
    if (XE.error && (!XE.contactos || !XF_HIST.pasos)) {
      caja.innerHTML = '<div class="fx-ct-vacio error" role="alert"><span class="fx-ct-vacio-ic"><i class="ic" data-ic="alerta"></i></span><b>No se pudo armar el embudo</b><p>El servidor dijo: ' + esc(XE.error) + '. Vuelve a intentarlo en un momento.</p><button type="button" class="btn sm" data-xe="reintentar">Volver a intentar</button></div>';
      iconos(caja);
      caja.querySelector('[data-xe]').onclick = cargarEmbudo;
      return;
    }
    if (!XE.contactos || !XF_HIST.pasos) {
      // Cargando: la forma de lo que viene (cuatro cifras y el embudo que se angosta), para que nada salte al llegar.
      caja.innerHTML = '<div class="xe-esq" aria-busy="true" aria-label="Cargando el embudo"><div class="xe-esq-cifras"><i></i><i></i><i></i><i></i></div>' +
        '<div class="xe-esq-tramos">' + [100, 82, 64, 46, 30].map(function (w) { return '<i style="width:' + w + '%"></i>'; }).join('') + '</div></div>';
      return;
    }
    var e = xfE('embudo'), dias = Number(e.dias) || 0, desde = dias ? Date.now() - dias * 86400000 : 0;
    var lista = todos.filter(xfFiltro('embudo')).filter(function (c) { return !desde || (c.firstSeen || 0) >= desde; });
    var etapas = XF_HIST.etapas || state.stages || [];
    var periodo = (XF_DIAS.filter(function (d) { return d[0] === e.dias; })[0] || XF_DIAS[2])[1];
    if (!todos.length) {
      caja.innerHTML = '<div class="fx-ct-vacio" role="status"><span class="fx-ct-vacio-ic"><i class="ic" data-ic="embudo"></i></span><b>Todavía no hay tratos</b><p>Cada persona que escribe por WhatsApp o por el chat del sitio entra sola al embudo, en la primera etapa.</p><button type="button" class="btn sm" data-xe="bandeja">Ir a la Bandeja omnicanal</button></div>';
      iconos(caja);
      caja.querySelector('[data-xe]').onclick = function () { go('inbox'); };
      return;
    }
    if (!lista.length) {
      var hay = xfHayCond('embudo');
      caja.innerHTML = '<div class="fx-ct-vacio" role="status"><span class="fx-ct-vacio-ic"><i class="ic" data-ic="embudo"></i></span><b>Ningún trato entró ' + esc(periodo) + (hay ? ' con estos filtros' : ' en esta vista') + '</b>' +
        '<p>' + (dias ? 'Prueba con un periodo más largo' + (hay ? ' o quita algún filtro' : '') + '.' : 'Quita algún filtro o cambia de vista.') + '</p>' +
        '<div class="xe-acc">' + (dias ? '<button type="button" class="btn sm" data-xe="siempre">Ver desde siempre</button>' : '') + (hay ? '<button type="button" class="btn sm" data-xe="limpiar">Quitar los filtros</button>' : '') +
        (!dias && !hay ? '<button type="button" class="btn sm" data-xe="todos">Ver todos los tratos</button>' : '') + '</div></div>';
      iconos(caja);
      caja.querySelectorAll('[data-xe]').forEach(function (b) {
        b.onclick = function () { var q = b.getAttribute('data-xe'); if (q === 'siempre') e.dias = '0'; if (q === 'limpiar') e.cond = {}; if (q === 'todos') e.vista = 'todos'; xfRepintar('embudo'); };
      });
      return;
    }
    var m = calcularEmbudo(lista, XF_HIST.pasos, etapas);
    var max = Math.max(1, m.tramos.length ? m.tramos[0].llegaron : 1);
    var perdidoIds = etapas.filter(function (x) { return x.rol === 'perdido'; }).map(function (x) { return x.id; });
    var cifra = function (k, t, n, p) { return '<div class="xe-cifra" data-k="' + k + '"><span class="t">' + esc(t) + '</span><b class="n">' + esc(n) + '</b><span class="p">' + esc(p) + '</span></div>'; };
    var sinMotivo = m.perdidos.total - m.perdidos.motivos.reduce(function (s, x) { return s + x.n; }, 0);
    caja.innerHTML = '<div class="xe-cifras">' +
        cifra('entraron', 'Entraron', String(m.total), periodo) +
        cifra('abiertos', 'Siguen abiertos', String(m.abiertos), !m.abiertos ? 'Ninguno abierto' : !m.valorAbierto ? 'Sin precios' :
          plataCorta(m.valorAbierto) + ' en juego' + (m.sinPrecioAbierto ? ' · ' + m.sinPrecioAbierto + ' sin precio' : '')) +
        cifra('ganados', 'Ganados', String(m.ganados), xePct(m.total ? m.ganados / m.total : null) + ' de los que entraron') +
        cifra('perdidos', 'Perdidos', String(m.perdidos.total), xePct(m.total ? m.perdidos.total / m.total : null) + ' de los que entraron') +
      '</div>' +
      ((XE.contactos || []).length >= 2000 ? '<p class="cli-resumen fx-ct-parcial" role="note">Se cuentan los 2.000 tratos con actividad más reciente.</p>' : '') +
      '<div class="xe-fila">' +
        '<section class="panel xe-caja" aria-labelledby="xe-t-embudo"><div class="xe-cab"><h2 id="xe-t-embudo">El embudo</h2><p>Cuántos llegaron a cada etapa (o más allá) y qué parte pasa a la siguiente. Toca una etapa para ver sus tratos.</p></div>' +
        '<ol class="xe-tramos">' + m.tramos.map(function (t, i) {
          var ancho = Math.max(6, Math.round(t.llegaron / max * 100));
          var paso = t.pasan == null ? '' : '<div class="xe-paso' + (m.peor === i ? ' peor' : '') + '"><i class="ic" data-ic="abajo"></i><span><b>' + xePct(t.pasan) + '</b> pasa a ' + esc(m.tramos[i + 1].label) +
            ' <span class="xe-de">(' + m.tramos[i + 1].llegaron + ' de ' + t.llegaron + ')</span></span>' + (m.peor === i ? '<span class="xe-alerta">Aquí se quedan más</span>' : '') + '</div>';
          return '<li><button type="button" class="xe-tramo" data-stage="' + esc(t.id) + '" data-rol="' + esc(t.rol || '') + '" aria-label="' + esc(t.label + ': llegaron ' + t.llegaron + ', hoy ' + t.ahora + '. Ver sus tratos') + '">' +
            '<span class="xe-et"><i class="punto" aria-hidden="true"></i><b>' + esc(t.label) + '</b><small>Llegaron ' + t.llegaron + '</small></span>' +
            '<span class="xe-pista" aria-hidden="true"><span class="xe-barra" style="width:' + ancho + '%"></span></span>' +
            '<span class="xe-ahora"><b>' + (t.ahora ? t.ahora + ' aquí hoy' : 'Nadie aquí hoy') + '</b><small>' + esc(xeValor(t.valor, t.ahora, t.sinPrecio)) + '</small></span>' +
          '</button>' + paso + '</li>';
        }).join('') + '</ol>' +
        (m.sinHistoria ? '<p class="xe-nota">' + m.sinHistoria + (m.sinHistoria === 1 ? ' trato no tiene' : ' tratos no tienen') + ' historia de etapas (se importaron o vienen de antes): ' + (m.sinHistoria === 1 ? 'cuenta' : 'cuentan') + ' por la etapa en la que ' + (m.sinHistoria === 1 ? 'está' : 'están') + ' hoy.</p>' : '') +
        '</section>' +
        '<section class="panel xe-caja xe-caidas" aria-labelledby="xe-t-caidas"><div class="xe-cab"><h2 id="xe-t-caidas">Dónde se caen</h2><p>Los que se perdieron, por la etapa en la que estaban cuando se perdieron.</p></div>' +
        (m.perdidos.total ? '<ul class="xe-caida-lista">' + m.tramos.filter(function (t) { return t.perdidos; }).sort(function (a, b) { return b.perdidos - a.perdidos; }).map(function (t) {
            return '<li><span class="xe-caida-et"><i class="punto" data-rol="' + esc(t.rol || '') + '" aria-hidden="true"></i>' + esc(t.label) + '</span><span class="xe-caida-pista" aria-hidden="true"><i style="width:' + Math.round(t.perdidos / m.perdidos.total * 100) + '%"></i></span><b>' + t.perdidos + '</b></li>';
          }).join('') +
          (m.perdidos.sinSaber ? '<li class="xe-sin-saber"><span class="xe-caida-et">Sin saber dónde</span><span class="xe-caida-pista" aria-hidden="true"><i style="width:' + Math.round(m.perdidos.sinSaber / m.perdidos.total * 100) + '%"></i></span><b>' + m.perdidos.sinSaber + '</b></li>' : '') + '</ul>' +
          (m.perdidos.sinSaber ? '<p class="xe-nota">De ' + (m.perdidos.sinSaber === 1 ? 'uno' : m.perdidos.sinSaber) + ' no se sabe en qué etapa estaba: ' + (m.perdidos.sinSaber === 1 ? 'no tiene' : 'no tienen') + ' historia de etapas.</p>' : '') +
          '<h3 class="xe-sub">Por qué</h3>' + (m.perdidos.motivos.length ? '<ul class="xe-motivos">' + m.perdidos.motivos.slice(0, 4).map(function (x) { return '<li><span>' + esc(x.motivo) + '</span><b>' + x.n + '</b></li>'; }).join('') + '</ul>' : '') +
          (sinMotivo ? '<p class="xe-nota">' + sinMotivo + (sinMotivo === 1 ? ' no dijo por qué.' : ' no dijeron por qué.') + '</p>' : '') +
          (perdidoIds.length ? '<button type="button" class="btn sm" data-xe="perdidos">Ver los perdidos en Tratos</button>' : '')
        : '<div class="xe-vacio-mini"><b>Ninguno se perdió</b><span>De los que entraron ' + esc(periodo) + ' en esta vista, ninguno está en una etapa de perdido.</span></div>') +
        '</section>' +
      '</div>';
    iconos(caja);
    caja.querySelectorAll('.xe-tramo').forEach(function (b) { b.onclick = function () { xfIrATratos([b.getAttribute('data-stage')]); }; });
    var bp = caja.querySelector('[data-xe="perdidos"]');
    if (bp) bp.onclick = function () { xfIrATratos(perdidoIds); };
  }
  /** Tocar una etapa del embudo abre Tratos con esa etapa como filtro (con todos los tratos, para no esconder nada). */
  function xfIrATratos(etapas) {
    var e = xfE('pipeline');
    e.vista = 'todos';
    e.cond = { etapas: etapas.slice() };
    xfGuardar('pipeline');
    go('pipeline');
  }
  // (fin de XEN · Embudo y filtrado)

  // ===== XEN · KPIs y metas: lo nuevo del agente de KPIs (alAbrir('kpis', …)) =====
  // Los objetivos de Dynamics 365 con los datos de XENCRM (src/crm/kpis.ts): cada KPI del periodo contra el anterior
  // igual de largo, su meta de la semana o del mes del calendario, y por persona lo que se puede atribuir.
  //
  // 🪤 Una cifra que no se sabe no es cero. Sin citas marcadas la asistencia es «—» y la tarjeta dice por qué; sin
  // precios, las ventas dicen «Sin precios». Un 0 % de asistencia o un «$0» se llevan a una reunión y no son verdad.
  //
  // 🪤 La comparación se dice con palabras y flecha, no solo con color («↓ 1,2 min más rápido»): un rojo o un verde
  // solos no los distingue todo el mundo, y «baja» no es malo en el tiempo de respuesta.
  //
  // Las metas las pone quien administra XENCRM (mandaEnElModo). El servidor también lo cumple: con el candado la
  // ruta está cerrada y por la consola solo el super-admin la cambia. Aquí solo se deja de enseñar la puerta.
  var XP = { dias: 30, datos: null, pedido: 0, abierto: false };
  try { var xpGuardado = Number(localStorage.getItem(LLAVE('kpisDias'))); if ([7, 30, 90].indexOf(xpGuardado) >= 0) XP.dias = xpGuardado; } catch (e) {}
  var XP_ESTADO = {
    cumplida: ['Cumplida', 'bien'], a_tiempo: ['A tiempo', 'bien'], atrasada: ['Atrasada', 'urge'],
    cumple: ['Cumple', 'bien'], no_cumple: ['No cumple', 'urge'], sin_datos: ['Sin datos', 'neutro']
  };
  /** A qué pantalla lleva cada tarjeta, para mirar el detalle (como el «drill-down» de Dynamics). */
  var XP_VER = {
    nuevas: ['inbox', 'Ver la bandeja'], respuesta: ['analysis', 'Ver Analítica'], aTiempo: ['analysis', 'Ver Analítica'],
    get citas() { return ['calendar', 'Ver ' + VOC.las + ' ' + VOC.citas]; }, get asistencia() { return ['calendar', 'Ver ' + VOC.las + ' ' + VOC.citas]; }, ganados: ['ventas', 'Ver las ventas'],
    perdidos: ['ventas', 'Ver por qué se perdieron'], cierre: ['ventas', 'Ver las ventas'], ventas: ['ventas', 'Ver las ventas'], embudo: ['embudo', 'Ver el embudo']
  };
  function xpNum(n, dec) { return Number(n).toLocaleString('es-CO', { maximumFractionDigits: dec == null ? 0 : dec }); }
  function xpMin(min) { return min < 1 ? 'menos de 1 min' : min < 60 ? xpNum(min, 1) + ' min' : duracion(min * 60000); }
  /** Un valor en la unidad de su KPI. «—» cuando no se sabe. */
  function xpValor(def, v, corto) {
    if (v === null || v === undefined) return '—';
    if (def.unidad === 'pct') return xpNum(v, 1) + ' %';
    if (def.unidad === 'min') return xpMin(v);
    // 🪤 Un periodo sin ventas no se dice «$0»: en plata, el cero se lee como «no vale nada». Se dice lo que pasó.
    if (def.unidad === 'plata') return v === 0 ? 'sin ventas' : corto ? plataCorta(v) : plata(v);
    return xpNum(v);
  }
  /** Contra el periodo anterior, dicho con palabras. null si no hay cifra de ahora con qué comparar. */
  function xpComparar(def, a, b, dias) {
    if (def.id === 'embudo') return { t: 'Foto de hoy: el embudo no tiene periodo anterior', tono: 'neutro' };
    if (a === null || a === undefined) return null;
    var antes = 'los ' + dias + ' días anteriores';
    if (b === null || b === undefined) return { t: 'Sin datos de ' + antes + ' para comparar', tono: 'neutro' };
    var dif = a - b;
    if (Math.abs(dif) < 1e-9) return { t: 'Igual que ' + antes, tono: 'neutro' };
    var mejora = def.mejor === 'sube' ? dif > 0 : dif < 0;
    var abs = Math.abs(dif), cuanto, sentido;
    if (def.unidad === 'pct') { cuanto = xpNum(abs, 1) + (abs === 1 ? ' punto' : ' puntos'); sentido = dif > 0 ? 'más' : 'menos'; }
    else if (def.unidad === 'min') { cuanto = xpMin(abs); sentido = dif < 0 ? 'más rápido' : 'más lento'; }
    else { cuanto = def.unidad === 'plata' ? plataCorta(abs) : xpNum(abs); sentido = dif > 0 ? 'más' : 'menos'; }
    var rel = (def.unidad === 'n' || def.unidad === 'plata') && b > 0 ? ' (' + (dif > 0 ? '+' : '−') + xpNum((abs / b) * 100) + ' %)' : '';
    return { t: (dif > 0 ? '↑ ' : '↓ ') + cuanto + ' ' + sentido + rel + ' que ' + antes + ' (' + xpValor(def, b, true) + ')', tono: mejora ? 'bien' : 'mal' };
  }
  /** Por qué no hay cifra, o el dato que la acompaña. Sale de las medidas, nunca de una suposición. */
  function xpDetalle(def, d) {
    var m = d.actual, acuerdo = d.acuerdoMin + ' min';
    switch (def.id) {
      case 'respuesta': return m.respondidas ? 'De ' + xpNum(m.respondidas) + (m.respondidas === 1 ? ' respuesta' : ' respuestas') + (d.esperandoAhora ? ' · ' + d.esperandoAhora + ' esperando ahora' : '') : 'Nadie esperó respuesta en este periodo.';
      case 'aTiempo': return m.respondidas ? 'Dentro de ' + acuerdo + ', el acuerdo de servicio' : 'Nadie esperó respuesta en este periodo.';
      case 'asistencia':
        if (m.citasMarcadas) return 'De ' + m.citasMarcadas + (m.citasMarcadas === 1 ? ' ' + VOC.cita + ' ' + VOC.g('marcada') : ' ' + VOC.citas + ' ' + VOC.g('marcadas')) + (m.citasSinMarcar ? ' · ' + m.citasSinMarcar + ' sin marcar' : '');
        return m.citasSinMarcar ? m.citasSinMarcar + (m.citasSinMarcar === 1 ? ' ' + VOC.cita + ' pasó y nadie ' + VOC.la + ' marcó' : ' ' + VOC.citas + ' pasaron y nadie ' + VOC.las + ' marcó') + ': márca' + VOC.las + ' en ' + VOC.Citas + '.' : VOC.Ninguna + ' ' + VOC.cita + ' de este periodo ha pasado todavía.';
      case 'cierre': return m.ganados + m.perdidos ? m.ganados + ' ganados de ' + (m.ganados + m.perdidos) + ' cerrados' : 'No se cerró ningún trato en este periodo.';
      case 'ventas':
        if (!m.ganados) return 'No se ganó ningún trato en este periodo.';
        if (!m.ventasConPrecio) return m.ganados + (m.ganados === 1 ? ' ganado sin valor' : ' ganados sin valor') + ': ponlo en la ficha de cada trato.';
        return 'De ' + m.ganados + (m.ganados === 1 ? ' trato ganado' : ' tratos ganados') + (m.ventasConPrecio < m.ganados ? ' · ' + (m.ganados - m.ventasConPrecio) + ' sin valor' : '');
      case 'embudo':
        if (!d.embudo.conValor) return d.embudo.sinValor ? 'Ningún trato abierto tiene valor: ponlo en su ficha o carga precios en el catálogo.' : 'No hay tratos abiertos.';
        return d.embudo.conValor + ' con valor' + (d.embudo.sinValor ? ' · ' + d.embudo.sinValor + ' sin precio' : '');
      default: return def.que;
    }
  }
  /** La meta de una tarjeta: su barra con el ritmo, o la invitación a ponerla (solo a quien puede). */
  function xpMeta(def, av, puede) {
    if (!def.meta) return '';
    if (!av) return puede ? '<button type="button" class="xp-poner" data-poner="' + def.id + '"><i class="ic" data-ic="mas"></i>Poner meta</button>' : '<p class="xp-sin-meta">Sin meta</p>';
    var est = XP_ESTADO[av.estado] || XP_ESTADO.sin_datos;
    var cuando = av.periodo === 'semana' ? 'esta semana' : 'este mes';
    var chip = '<span class="xp-estado ' + est[1] + '">' + esc(est[0]) + '</span>';
    if (av.tipo === 'acumula') {
      var v = av.valor === null ? 0 : av.valor;
      var lleno = Math.max(0, Math.min(100, (v / av.meta) * 100));
      var ritmo = Math.max(0, Math.min(100, av.transcurrido * 100));
      // 🪤 Aquí va la cifra entera, no la corta: «va $2,8 M y el ritmo pedía $2,8 M» con la etiqueta «Atrasada» al
      // lado parecía un error, y era $2.750.000 contra $2.812.276. Lo abreviado va en la cabecera, donde no se compara.
      var dice = av.estado === 'sin_datos' ? 'Sin datos para medirla' : 'Va ' + xpValor(def, av.valor) + ' de ' + xpValor(def, av.meta);
      var ritmoTxt = av.estado === 'cumplida' ? 'Ya se cumplió' : av.estado === 'sin_datos' ? '' : 'El ritmo pedía ' + xpValor(def, def.unidad === 'n' ? Math.ceil(av.esperado - 1e-9) : av.esperado) + ' a hoy';
      return '<div class="xp-meta"><div class="xp-meta-cab"><span>Meta de ' + cuando + ': <b>' + esc(xpValor(def, av.meta, true)) + '</b></span>' + chip + '</div>' +
        '<div class="xp-pista" role="progressbar" aria-label="' + esc(def.nombre + ': ' + dice) + '" aria-valuemin="0" aria-valuemax="' + av.meta + '" aria-valuenow="' + v + '">' +
        '<i class="' + est[1] + '" style="width:' + lleno.toFixed(1) + '%"></i><b class="xp-ritmo" style="left:' + ritmo.toFixed(1) + '%" title="Donde debería ir hoy"></b></div>' +
        '<p class="xp-meta-pie">' + esc(dice) + (ritmoTxt ? ' · ' + esc(ritmoTxt) : '') + '</p></div>';
    }
    var tope = (def.mejor === 'baja' ? 'Máximo ' : 'Mínimo ') + xpValor(def, av.meta, true);
    return '<div class="xp-meta"><div class="xp-meta-cab"><span>Meta: <b>' + esc(tope) + '</b></span>' + chip + '</div>' +
      '<p class="xp-meta-pie">' + (av.valor === null ? 'Sin datos de ' + cuando + ' para medirla' : 'En ' + cuando + ' va ' + esc(xpValor(def, av.valor, true))) + '</p></div>';
  }
  function xpTarjeta(def, d, puede) {
    var a = d.valores.actual[def.id], b = d.valores.anterior[def.id];
    var av = (d.avance || []).filter(function (x) { return x.kpi === def.id; })[0] || null;
    var cmp = xpComparar(def, a, b, d.dias);
    var sinNada = a === null || a === undefined;
    var cifra = sinNada ? (def.unidad === 'plata' && (def.id === 'embudo' ? d.embudo.sinValor : d.actual.ganados) ? 'Sin precios' : '—') : xpValor(def, a);
    var ver = XP_VER[def.id];
    return '<article class="xp-kpi" data-kpi="' + def.id + '" aria-labelledby="xp-t-' + def.id + '">' +
      '<div class="xp-kpi-cab"><h3 id="xp-t-' + def.id + '">' + esc(def.nombre) + '</h3>' +
      (ver ? '<button type="button" class="xp-ver" data-ver="' + ver[0] + '" title="' + esc(ver[1]) + '" aria-label="' + esc(ver[1]) + '"><i class="ic" data-ic="derecha"></i></button>' : '') + '</div>' +
      '<p class="xp-cifra' + (cifra.length > 12 ? ' larga' : '') + (sinNada ? ' sin' : '') + '">' + esc(cifra) + '</p>' +
      '<p class="xp-detalle">' + esc(xpDetalle(def, d)) + '</p>' +
      (cmp ? '<p class="xp-cmp ' + cmp.tono + '">' + esc(cmp.t) + '</p>' : '') +
      xpMeta(def, av, puede) + '</article>';
  }
  function xpTabla(d) {
    var filas = d.porPersona || [], ag = d.agente || { respuestas: 0 };
    if (!filas.length && !ag.respuestas) return '<div class="xp-vacio"><b>Todavía no hay nada que atribuir</b><span>Asigna cada contacto a alguien del equipo desde su ficha («Asignado a»): lo ganado y lo vendido se le cuenta a esa persona.</span></div>';
    var celda = function (l, v, cls) { return '<td data-l="' + esc(l) + '"' + (cls ? ' class="' + cls + '"' : '') + '>' + v + '</td>'; };
    var ventas = function (f) { return !f.ganados ? '—' : !f.ventasConPrecio ? 'Sin precios' : esc(plata(f.ventas)); };
    var cuerpo = filas.map(function (f) {
      return '<tr><th scope="row"><span class="xp-quien">' + avatarHtml(f.nombre, f.nombre, 'sm') + '<span>' + esc(f.nombre) + '</span></span></th>' +
        celda('Asignados', xpNum(f.asignados), 'num') + celda('Ganados', xpNum(f.ganados), 'num') + celda('Ventas', ventas(f), 'num') +
        celda(VOC.Citas, xpNum(f.citas), 'num') + celda('Respuestas', xpNum(f.respuestas), 'num') +
        celda('Mediana de respuesta', f.respuestaMs === null ? '—' : esc(duracion(f.respuestaMs)), 'num') + '</tr>';
    }).join('');
    if (ag.respuestas) {
      var na = '<span class="xp-na" title="Al agente de IA no se le asignan contactos">—</span>';
      cuerpo += '<tr class="xp-agente"><th scope="row"><span class="xp-quien"><span class="xp-ia" aria-hidden="true"><i class="ic" data-ic="chispa"></i></span><span>' + esc(ag.nombre || state.agentName || 'Xen') + '<small>agente de IA</small></span></span></th>' +
        celda('Asignados', na, 'num') + celda('Ganados', na, 'num') + celda('Ventas', na, 'num') + celda(VOC.Citas, na, 'num') +
        celda('Respuestas', xpNum(ag.respuestas), 'num') + celda('Mediana de respuesta', ag.respuestaMs === null ? '—' : esc(duracion(ag.respuestaMs)), 'num') + '</tr>';
    }
    return '<div class="xp-tabla-caja"><table class="xp-tabla"><caption class="sr-only">Por persona, en los últimos ' + d.dias + ' días</caption><thead><tr><th scope="col">Persona</th><th scope="col" class="num">Asignados</th><th scope="col" class="num">Ganados</th>' +
      '<th scope="col" class="num">Ventas</th><th scope="col" class="num">' + VOC.Citas + '</th><th scope="col" class="num">Respuestas</th><th scope="col" class="num">Mediana de respuesta</th></tr></thead><tbody>' + cuerpo + '</tbody></table></div>' +
      '<p class="xp-nota">Asignados: tratos abiertos que tiene hoy. Ganados, ventas y ' + VOC.citas + ': del periodo, de lo que tiene asignado. Respuestas: las que escribió en el periodo, con el reloj parado fuera del horario.</p>';
  }
  function xpPeriodo() {
    document.querySelectorAll('#xp-kpis .xp-periodo [data-dias]').forEach(function (b) { b.setAttribute('aria-pressed', String(Number(b.getAttribute('data-dias')) === XP.dias)); });
  }
  function xpEsqueleto() {
    $('xp-grid').innerHTML = [0, 1, 2, 3, 4, 5, 6, 7].map(function () { return '<div class="xp-kpi xp-esq" aria-hidden="true"><i></i><i></i><i></i></div>'; }).join('');
    if (!XP.datos) $('xp-tabla').innerHTML = '<div class="xp-esq-tabla" aria-hidden="true"><i></i><i></i><i></i></div>';
  }
  function pintarKpis() {
    var d = XP.datos, puede = mandaEnElModo();
    if (!d) return;
    var fecha = function (ts) { return new Date(ts).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }); };
    $('xp-contra').textContent = 'Del ' + fecha(d.desde) + ' a hoy, contra los ' + d.dias + ' días anteriores';
    $('xp-editar').hidden = !puede;
    $('xp-grid').innerHTML = d.definiciones.map(function (def) { return xpTarjeta(def, d, puede); }).join('');
    $('xp-grid').setAttribute('aria-busy', 'false');
    $('xp-tabla').innerHTML = xpTabla(d);
    iconos($('xp-grid')); iconos($('xp-tabla'));
    $('xp-grid').querySelectorAll('[data-ver]').forEach(function (b) { b.onclick = function () { go(b.getAttribute('data-ver')); }; });
    $('xp-grid').querySelectorAll('[data-poner]').forEach(function (b) { b.onclick = function () { xpAbrirEditor(b.getAttribute('data-poner')); }; });
  }
  function cargarKpis() {
    var mio = ++XP.pedido;
    xpPeriodo();
    $('xp-grid').setAttribute('aria-busy', 'true');
    xpEsqueleto();
    api('/kpis?dias=' + XP.dias).then(function (d) {
      if (mio !== XP.pedido) return; // llegó tarde: ya se pidió otro periodo
      if (!d || d.error || !d.valores) throw new Error((d && d.error) || 'El servidor no mandó los KPIs');
      XP.datos = d;
      pintarKpis();
      if (XP.abierto) xpPintarEditor();
    }).catch(function (e) {
      if (mio !== XP.pedido || String(e && e.message) === '401') return;
      $('xp-grid').setAttribute('aria-busy', 'false');
      var porque = String((e && e.message) || 'Sin respuesta del servidor');
      porque = porque.charAt(0).toUpperCase() + porque.slice(1);
      $('xp-grid').innerHTML = '<div class="xp-error" role="alert"><b>No se pudieron cargar los KPIs</b><span>' + esc(porque) + '. Lo demás del tablero sigue funcionando.</span><button type="button" class="btn" id="xp-reintentar">Volver a intentar</button></div>';
      $('xp-tabla').innerHTML = '';
      $('xp-reintentar').onclick = cargarKpis;
      $('xp-reintentar').focus();
    });
  }
  // ---- el editor de metas ----
  var XP_UNIDAD = { min: 'min como máximo', pct: '% como mínimo' };
  function xpPintarEditor(foco) {
    var d = XP.datos, form = $('xp-editor');
    if (!d || !form) return;
    var defs = d.definiciones.filter(function (k) { return k.meta; });
    var metas = d.metas || {};
    form.innerHTML = '<div class="xp-editor-cab"><h2 id="xp-editor-t">Metas</h2><p>Las que se suman (conversaciones, ' + VOC.citas + ', ganados, ventas) se llevan por semana o por mes del calendario; las de nivel —tiempo, porcentajes, el embudo— se miden en el mes. Deja vacía la que no quieras.</p></div>' +
      '<div class="xp-campos">' + defs.map(function (k) {
        var m = metas[k.id], val = m ? (k.unidad === 'plata' || k.unidad === 'n' ? xpNum(m.valor) : xpNum(m.valor, 1)) : '';
        var unidad = k.unidad === 'plata' ? (state.moneda || 'COP') : XP_UNIDAD[k.unidad] || '';
        return '<div class="xp-campo" data-campo="' + k.id + '"><label for="xp-m-' + k.id + '">' + esc(k.nombre) + '</label>' +
          '<div class="xp-campo-fila"><input type="text" inputmode="decimal" autocomplete="off" id="xp-m-' + k.id + '" value="' + esc(val) + '" aria-describedby="xp-m-' + k.id + '-err" placeholder="' + (k.meta === 'umbral' ? (k.mejor === 'baja' ? 'Máximo' : 'Mínimo') : 'Sin meta') + '">' +
          (unidad ? '<span class="xp-unidad">' + esc(unidad) + '</span>' : '') +
          (k.meta === 'acumula' ? '<select id="xp-p-' + k.id + '" aria-label="' + esc('Periodo de la meta de ' + k.nombre) + '"><option value="mes"' + (!m || m.periodo !== 'semana' ? ' selected' : '') + '>al mes</option><option value="semana"' + (m && m.periodo === 'semana' ? ' selected' : '') + '>a la semana</option></select>' : '') +
          '</div><p class="xp-campo-err" id="xp-m-' + k.id + '-err" aria-live="polite"></p></div>';
      }).join('') + '</div>' +
      '<div class="xp-editor-pie"><button type="submit" class="btn primary" id="xp-guardar">Guardar metas</button><button type="button" class="btn" id="xp-cancelar">Cancelar</button><span class="xp-editor-msg" id="xp-editor-msg" role="status"></span></div>';
    $('xp-cancelar').onclick = function () { xpCerrarEditor(true); };
    var f = foco && $('xp-m-' + foco);
    (f || form.querySelector('input')).focus();
  }
  function xpAbrirEditor(foco) {
    if (!mandaEnElModo() || !XP.datos) return;
    XP.abierto = true;
    $('xp-editor').hidden = false;
    $('xp-editar').setAttribute('aria-expanded', 'true');
    xpPintarEditor(foco);
    $('xp-editor').scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  function xpCerrarEditor(devolver) {
    XP.abierto = false;
    $('xp-editor').hidden = true;
    $('xp-editar').setAttribute('aria-expanded', 'false');
    if (devolver) $('xp-editar').focus();
  }
  if ($('xp-editar')) {
    $('xp-editar').onclick = function () { if (XP.abierto) xpCerrarEditor(true); else xpAbrirEditor(); };
    $('xp-editor').addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); xpCerrarEditor(true); } });
    // 🪤 Lo escrito no se borra si algo falla: el servidor dice cuál campo está mal, se marca ese y lo demás se queda.
    $('xp-editor').onsubmit = function (e) {
      e.preventDefault();
      var form = $('xp-editor'), metas = {};
      form.querySelectorAll('[data-campo]').forEach(function (c) {
        var id = c.getAttribute('data-campo'), inp = $('xp-m-' + id), per = $('xp-p-' + id);
        inp.removeAttribute('aria-invalid'); $('xp-m-' + id + '-err').textContent = '';
        if (inp.value.trim()) metas[id] = { valor: inp.value.trim(), periodo: per ? per.value : 'mes' };
      });
      $('xp-guardar').disabled = true;
      $('xp-editor-msg').textContent = 'Guardando…';
      api('/metas', { method: 'PUT', body: { metas: metas } }).then(function (r) {
        $('xp-guardar').disabled = false;
        if (!r || r.error) {
          $('xp-editor-msg').textContent = '';
          var campo = r && r.campo && $('xp-m-' + r.campo);
          if (campo) { campo.setAttribute('aria-invalid', 'true'); $('xp-m-' + r.campo + '-err').textContent = r.error; campo.focus(); }
          else $('xp-editor-msg').textContent = 'No se guardó: ' + ((r && r.error) || 'sin respuesta');
          return;
        }
        toast('Metas guardadas', null, { icono: 'check' });
        xpCerrarEditor(true);
        cargarKpis();
      }).catch(function () { $('xp-guardar').disabled = false; $('xp-editor-msg').textContent = 'No se guardó: sin respuesta del servidor. Lo escrito sigue aquí.'; });
    };
  }
  document.querySelectorAll('#xp-kpis .xp-periodo [data-dias]').forEach(function (b) {
    b.onclick = function () {
      XP.dias = Number(b.getAttribute('data-dias'));
      try { localStorage.setItem(LLAVE('kpisDias'), String(XP.dias)); } catch (e) {}
      cargarKpis();
    };
  });
  if ($('xp-kpis')) iconos($('xp-kpis'));
  alAbrir('kpis', cargarKpis);
  // (fin de XEN · KPIs y metas)

  // ===== XEN · Panel KAM: lo nuevo del agente de cuentas clave (alAbrir('kam', …)) =====
  // Las cuentas clave (KAM): los clientes que más importan, quién los lleva, cuánto valen y cómo están. Lo calcula el
  // servidor (crm/cuentas-clave.ts) sin modelo: aquí solo se pinta, se filtra y se marca.
  //
  // 🪤 La salud siempre va con su palabra (Sana · Atención · En riesgo) y su porqué a un toque: un color solo no
  // dice qué hacer, y una cifra mágica no se puede discutir. El ánimo y el interés, con emoji Y palabra (el emoji
  // va con aria-hidden: un lector de pantalla diría «cara sonriente con ojos de estrella» en vez de «Quiere comprar»).
  //
  // 🪤 Sin precio, el valor es «—», nunca «$0»: cero diría que no vale nada, y lo que pasa es que no se sabe.
  //
  // 🪤 El plan de cuenta se escribe aquí mismo y NO se borra si guardar falla: lo escrito se queda (en XK.borradores,
  // así sobrevive a que el panel se vuelva a pintar) con el porqué del fallo al lado.
  var XK = { datos: null, cargando: false, error: null, kam: '', salud: '', abiertos: {}, editando: {}, borradores: {}, errores: {}, quitando: {}, marcando: {} };
  var XK_SALUD = { riesgo: { lbl: 'En riesgo', ic: 'alerta' }, atencion: { lbl: 'Atención', ic: 'reloj' }, sana: { lbl: 'Sana', ic: 'check' } };
  var XK_ANIMO = { positivo: ['😊', 'Contento'], neutral: ['😐', 'Neutral'], negativo: ['😠', 'Molesto'] };
  var XK_INTERES = { 3: ['🤩', 'Quiere comprar'], 2: ['🙂', 'Interés claro'], 1: ['🤔', 'Curiosidad'], 0: ['😶', 'Sin interés'] };
  var XK_NIVEL_IC = { riesgo: 'alerta', atencion: 'reloj', bien: 'check' };
  var XK_NOTA_MAX = 600; // el de fábrica: el que manda es la regla kam.maxNota (ver xkNotaMax)
  ICONS.quitar = '<path d="M18 6 6 18M6 6l12 12"/>';

  function xkCarita(par) { return par ? '<span class="xk-carita"><span aria-hidden="true">' + par[0] + '</span> ' + esc(par[1]) + '</span>' : '<span class="xk-nada">Sin análisis</span>'; }
  function xkValor(v, vendido) {
    if (!v) return '<span class="xk-nada" title="Sin precio: ni puesto a mano ni en el catálogo">—</span>';
    return '<b class="xk-plata">' + esc(plata(v)) + '</b> <small>' + (vendido ? 'vendido' : 'abierto') + '</small>';
  }
  function xkFiltradas() {
    var d = XK.datos;
    if (!d) return [];
    return d.cuentas.filter(function (k) {
      if (XK.salud && k.salud !== XK.salud) return false;
      if (XK.kam === '__nadie') return !k.kam;
      if (XK.kam) return mismoNombre(k.kam, XK.kam);
      return true;
    });
  }
  function xkSel(attr, id) { return '[' + attr + '="' + String(id).replace(/["\\]/g, '\\$&') + '"]'; }

  function cargarKam() {
    if (XK.cargando) return;
    var caja = $('xk-kam');
    if (!caja) return;
    XK.cargando = true;
    caja.setAttribute('aria-busy', 'true');
    // Cargando: la forma de lo que viene (cifras y tres cuentas), para que nada salte al llegar.
    if (!XK.datos) caja.innerHTML = '<div class="xk-cifras">' + [1, 2, 3, 4].map(function () { return '<div class="xk-cifra-c xk-esq" aria-hidden="true"><i></i><i></i></div>'; }).join('') + '</div>' +
      '<div class="xk-lista">' + [1, 2, 3].map(function () { return '<div class="xk-cuenta xk-esq" aria-hidden="true"><i></i><i></i><i></i></div>'; }).join('') + '</div>';
    api('/cuentas-clave').then(function (d) {
      XK.cargando = false;
      caja.removeAttribute('aria-busy');
      if (!d || d.error) { XK.error = (d && d.error) || 'el servidor no contestó'; pintarKam(); return; }
      XK.error = null;
      XK.datos = d;
      if (d.moneda && !state.moneda) state.moneda = d.moneda;
      pintarKam();
    }).catch(function (e) {
      XK.cargando = false;
      caja.removeAttribute('aria-busy');
      if (String(e && e.message) === '401') return;
      XK.error = 'no hubo conexión con el servidor';
      pintarKam();
    });
  }
  alAbrir('kam', cargarKam);

  function pintarKam() {
    var caja = $('xk-kam');
    if (!caja) return;
    // Lo que se estaba escribiendo en un plan se guarda antes de repintar (y vuelve después).
    caja.querySelectorAll('textarea[data-xk-nota]').forEach(function (t) { XK.borradores[t.getAttribute('data-xk-nota')] = t.value; });
    if (XK.error && !XK.datos) {
      caja.innerHTML = '<div class="xk-error" role="alert"><b>No se pudieron cargar las cuentas clave</b><span>' + esc(XK.error) + '. Lo que ya marcaste sigue guardado.</span>' +
        '<button class="btn sm" type="button" id="xk-reintentar">Volver a intentar</button></div>';
      $('xk-reintentar').onclick = function () { XK.error = null; cargarKam(); };
      return;
    }
    var d = XK.datos;
    if (!d) return;
    var c = d.cifras;
    var cifras = [
      { t: 'Cuentas clave', n: String(c.cuentas), p: c.cuentas ? (c.cuentas === 1 ? 'la que más importa' : 'las que más importan') : 'todavía ninguna', ic: 'estrella', tono: 'acento' },
      { t: 'Valor de las cuentas', n: c.conValor ? plataCorta(c.valor) : '—', p: c.conValor ? (c.vendido ? plataCorta(c.vendido) + ' ya vendido' : 'todo abierto') + (c.conValor < c.cuentas ? ' · ' + (c.cuentas - c.conValor) + ' sin precio' : '') : (c.cuentas ? 'Sin precios en estas cuentas' : 'Se suma al marcarlas'), ic: 'dolar', tono: 'verde', flojo: !c.conValor },
      { t: 'En riesgo', n: String(c.enRiesgo), p: c.enRiesgo ? 'mira su porqué y actúa hoy' : (c.atencion ? c.atencion + ' para mirar' : 'ninguna en riesgo'), ic: 'alerta', tono: c.enRiesgo ? 'rojo' : 'neutro', salud: c.cuentas ? 'riesgo' : '' },
      { t: 'Sin KAM', n: String(c.sinKam), p: c.sinKam ? 'nadie las tiene asignadas' : (c.cuentas ? 'todas tienen quién las lleve' : 'cada cuenta, con su responsable'), ic: 'user', tono: c.sinKam ? 'ambar' : 'neutro', kam: c.cuentas ? '__nadie' : '' }
    ];
    var html = '<div class="xk-cifras">' + cifras.map(function (x) {
      var filtra = x.salud || x.kam;
      var on = (x.salud && XK.salud === x.salud) || (x.kam && XK.kam === x.kam);
      return '<' + (filtra ? 'button type="button" aria-pressed="' + Boolean(on) + '"' : 'div') + ' class="xk-cifra-c t-' + x.tono + '"' + (x.salud ? ' data-xk-salud="' + x.salud + '"' : '') + (x.kam ? ' data-xk-kam="' + x.kam + '"' : '') + '>' +
        '<span class="xk-cifra-cab"><span>' + esc(x.t) + '</span><span class="xk-cifra-ic"><i class="ic" data-ic="' + x.ic + '"></i></span></span>' +
        '<b class="xk-n' + (x.flojo ? ' flojo' : '') + '">' + esc(x.n) + '</b><small>' + esc(x.p) + '</small></' + (filtra ? 'button' : 'div') + '>';
    }).join('') + '</div>';

    if (!c.cuentas) {
      html += '<section class="xk-vacio"><span class="xk-vacio-ic"><i class="ic" data-ic="estrella"></i></span><div><h2>Una cuenta clave es un cliente que pesa más que el resto</h2>' +
        '<p>Ya compró, vuelve, trae a otros o vale más. Márcala y XENCRM vigila su salud por ti: si lleva mucho sin hablar, si escribió y nadie le contestó, si está molesta o si nadie la tiene asignada.</p>' +
        '<p>Márcalas aquí abajo, entre las candidatas, o desde la ficha de cualquier contacto con <b>★ Marcar como cuenta clave</b>.</p></div></section>';
    } else {
      var kams = d.equipo.slice();
      d.cuentas.forEach(function (k) { if (k.kam && !kams.some(function (n) { return mismoNombre(n, k.kam); })) kams.push(k.kam); });
      var cuantas = function (s) { return d.cuentas.filter(function (k) { return !s || k.salud === s; }).length; };
      html += '<div class="xk-herr">' +
        '<label class="xk-f-kam"><span>KAM</span><select id="xk-f-kam" aria-label="Filtrar por KAM"><option value="">Todos</option>' +
          kams.map(function (n) { return '<option value="' + esc(n) + '"' + (mismoNombre(n, XK.kam) ? ' selected' : '') + '>' + esc(n) + (mismoNombre(n, state.name) ? ' (tú)' : '') + '</option>'; }).join('') +
          '<option value="__nadie"' + (XK.kam === '__nadie' ? ' selected' : '') + '>Sin asignar</option></select></label>' +
        '<div class="xk-seg" role="group" aria-label="Filtrar por salud">' +
          [['', 'Todas'], ['riesgo', 'En riesgo'], ['atencion', 'Atención'], ['sana', 'Sanas']].map(function (s) {
            return '<button type="button" data-xk-f="' + s[0] + '" aria-pressed="' + (XK.salud === s[0]) + '"' + (s[0] ? ' class="s-' + s[0] + '"' : '') + '>' + (s[0] ? '<i class="xk-punto" aria-hidden="true"></i>' : '') + esc(s[1]) + ' <span class="xk-cuenta-n">' + cuantas(s[0]) + '</span></button>';
          }).join('') + '</div></div>';
      var lista = xkFiltradas();
      html += lista.length
        ? '<div class="xk-lista">' + lista.map(xkCuentaHtml).join('') + '</div>'
        : '<div class="xk-sin"><b>Ninguna cuenta con este filtro</b><span>Hay ' + c.cuentas + (c.cuentas === 1 ? ' cuenta clave' : ' cuentas clave') + ' en total.</span><button class="btn sm" type="button" id="xk-ver-todas">Ver todas</button></div>';
    }

    html += '<section class="xk-cand" aria-labelledby="xk-cand-t"><div class="xk-cand-cab"><h2 id="xk-cand-t">Candidatas a cuenta clave</h2>' +
      '<p>Contactos que cumplen alguna regla: ya compraron, volvieron, vinieron a su ' + VOC.cita + ', están calientes y con ' + VOC.cita + ', o están entre las de mayor valor. Se proponen; las marcas tú.</p></div>' +
      (d.candidatas.length
        ? '<ul class="xk-cand-l">' + d.candidatas.map(function (k) {
            return '<li class="xk-cand-f">' + avatarHtml(k.nombre || k.telefono || k.id, k.id) +
              '<div class="xk-quien"><button type="button" class="xk-nombre" data-xk-ficha="' + esc(k.id) + '">' + esc(k.nombre || k.telefono || 'Sin nombre') + '</button>' +
              '<span class="xk-sub"><span class="chip stage-' + esc(k.etapaRol || 'activo') + '">' + esc(k.etapaNombre) + '</span>' + (k.valor ? '<span>' + esc(plata(k.valor)) + '</span>' : '') + '</span></div>' +
              '<div class="xk-porque">' + k.motivos.map(function (m) { return '<span class="xk-tag">' + esc(m) + '</span>'; }).join('') + '</div>' +
              '<button type="button" class="btn sm" data-xk-marcar="' + esc(k.id) + '"' + (XK.marcando[k.id] ? ' disabled' : '') + '><i class="ic" data-ic="estrella"></i>' + (XK.marcando[k.id] ? 'Marcando…' : 'Marcar como cuenta clave') + '</button></li>';
          }).join('') + '</ul>'
        : '<div class="xk-sin"><b>Por ahora no hay candidatas</b><span>Aparecen cuando alguien compra, vuelve después de un tiempo o viene a su ' + VOC.cita + '. También puedes marcar a cualquiera desde su ficha.</span></div>') +
      '</section>';

    caja.innerHTML = html;
    iconos(caja);
    xkEnganchar(caja);
  }

  function xkCuentaHtml(k, i) {
    var s = XK_SALUD[k.salud] || XK_SALUD.atencion;
    var abierto = Boolean(XK.abiertos[k.id]);
    var mid = 'xk-m-' + i;
    var porque = k.motivos.filter(function (m) { return m.nivel !== 'bien'; }).map(function (m) { return m.texto; }).join(' · ') || 'Todo en orden';
    var urgente = k.paso && k.paso.urgente;
    return '<article class="xk-cuenta s-' + k.salud + '" data-xk-id="' + esc(k.id) + '">' +
      '<header class="xk-cab">' + avatarHtml(k.nombre || k.telefono || k.id, k.id) +
        '<div class="xk-quien"><button type="button" class="xk-nombre" data-xk-ficha="' + esc(k.id) + '">' + esc(k.nombre || k.telefono || 'Sin nombre') + '</button>' +
        '<span class="xk-sub">' + canalHtml(k.canal) + (k.telefono ? '<span>' + esc(k.telefono) + '</span>' : '') + (k.archivada ? '<span>archivada</span>' : '') + '</span></div>' +
        '<button type="button" class="xk-salud s-' + k.salud + '" aria-expanded="' + abierto + '" aria-controls="' + mid + '" data-xk-motivos="' + esc(k.id) + '" title="' + esc(s.lbl + ': ' + porque) + '">' +
          '<i class="ic" data-ic="' + s.ic + '"></i>' + esc(s.lbl) + '<span class="sr-only">. Por qué: ' + esc(porque) + '</span><i class="ic xk-chev" data-ic="abajo"></i></button>' +
      '</header>' +
      '<ul class="xk-motivos" id="' + mid + '" aria-label="Por qué está ' + esc(s.lbl.toLowerCase()) + '"' + (abierto ? '' : ' hidden') + '>' + k.motivos.map(function (m) {
        return '<li class="m-' + m.nivel + '"><i class="ic" data-ic="' + XK_NIVEL_IC[m.nivel] + '"></i>' + esc(m.texto) + '</li>';
      }).join('') + '</ul>' +
      '<dl class="xk-datos">' +
        '<div class="xk-d-kam"><dt>KAM</dt><dd>' + responsableHtml({ id: k.id, responsable: k.kam }, 'xk-r-' + i) + '</dd></div>' +
        '<div><dt>Valor</dt><dd>' + xkValor(k.valor, k.vendido) + '</dd></div>' +
        '<div class="xk-d-trato"><dt>Último trato</dt><dd><span class="chip stage-' + esc(k.etapaRol || 'activo') + '">' + esc(k.etapaNombre) + '</span>' +
          (k.paso && k.paso.texto ? '<span class="xk-paso' + (urgente ? ' urgente' : '') + '">' + esc(k.paso.texto) + '</span>' : '') + '</dd></div>' +
        '<div><dt>Última actividad</dt><dd>' + (k.ultima ? 'hace ' + esc(rel(k.ultima)) : '<span class="xk-nada">Sin conversación</span>') + '</dd></div>' +
        '<div><dt>Ánimo</dt><dd>' + xkCarita(XK_ANIMO[k.animo]) + '</dd></div>' +
        '<div><dt>Interés</dt><dd>' + xkCarita(k.interes == null ? null : XK_INTERES[k.interes]) + '</dd></div>' +
      '</dl>' +
      xkPlanHtml(k) +
      '<footer class="xk-acc">' +
        '<button type="button" class="btn sm primary" data-xk-chat="' + esc(k.id) + '"><i class="ic" data-ic="burbuja"></i>Abrir chat</button>' +
        '<button type="button" class="btn sm" data-xk-ficha="' + esc(k.id) + '">Ver ficha</button>' +
        '<span class="xk-desde">Desde el ' + esc(new Date(k.desde).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })) + (k.por ? ' · la marcó ' + esc(k.por) : '') + '</span>' +
        (XK.quitando[k.id]
          ? '<span class="xk-quitar-si" role="group" aria-label="Confirmar"><span>¿Quitarla de las cuentas clave?</span><button type="button" class="btn sm danger" data-xk-quitar-si="' + esc(k.id) + '">Sí, quitar</button><button type="button" class="btn sm" data-xk-quitar-no="' + esc(k.id) + '">No</button></span>'
          : '<button type="button" class="btn sm xk-quitar" data-xk-quitar="' + esc(k.id) + '" aria-label="Quitar de cuentas clave" title="Quitar de cuentas clave"><i class="ic" data-ic="quitar"></i><span>Quitar</span></button>') +
      '</footer></article>';
  }

  function xkPlanHtml(k) {
    var id = esc(k.id);
    if (XK.editando[k.id]) {
      var val = XK.borradores[k.id] != null ? XK.borradores[k.id] : k.nota;
      return '<div class="xk-plan editando"><label class="xk-plan-l" for="xk-n-' + id + '">Plan de cuenta</label>' +
        '<textarea id="xk-n-' + id + '" data-xk-nota="' + id + '" data-borrador maxlength="' + R('kam.maxNota', XK_NOTA_MAX) + '" rows="3" placeholder="Lo que hay que saber antes de hablarle: qué compra, cuándo vuelve, a quién trae, qué no le gusta…">' + esc(val) + '</textarea>' +
        '<div class="xk-plan-pie"><span class="xk-cuantas" data-xk-cuantas="' + id + '">' + String(val || '').length + ' / ' + R('kam.maxNota', XK_NOTA_MAX) + '</span>' +
        (XK.errores[k.id] ? '<span class="xk-err" role="alert">No se guardó: ' + esc(XK.errores[k.id]) + '. Lo escrito sigue aquí.</span>' : '') +
        '<button type="button" class="btn sm primary" data-xk-guardar="' + id + '">Guardar plan</button><button type="button" class="btn sm" data-xk-cancelar="' + id + '">Cancelar</button></div></div>';
    }
    if (!k.nota) return '<div class="xk-plan"><button type="button" class="xk-plan-vacio" data-xk-editar="' + id + '"><i class="ic" data-ic="lapiz"></i>Escribir el plan de cuenta</button></div>';
    return '<div class="xk-plan"><span class="xk-plan-l">Plan de cuenta</span><p class="xk-plan-t">' + esc(k.nota) + '</p>' +
      '<div class="xk-plan-pie"><small>' + (k.notaPor ? esc(k.notaPor) : '') + (k.notaAt ? ' · hace ' + esc(rel(k.notaAt)) : '') + '</small>' +
      '<button type="button" class="btn sm" data-xk-editar="' + id + '"><i class="ic" data-ic="lapiz"></i>Editar plan</button></div></div>';
  }

  function xkEnganchar(caja) {
    var cada = function (sel, fn) { caja.querySelectorAll(sel).forEach(fn); };
    if ($('xk-f-kam')) $('xk-f-kam').onchange = function () { XK.kam = this.value; pintarKam(); };
    if ($('xk-ver-todas')) $('xk-ver-todas').onclick = function () { XK.kam = ''; XK.salud = ''; pintarKam(); };
    cada('[data-xk-f]', function (b) { b.onclick = function () { XK.salud = b.getAttribute('data-xk-f'); pintarKam(); }; });
    cada('[data-xk-salud]', function (b) { b.onclick = function () { var s = b.getAttribute('data-xk-salud'); XK.salud = XK.salud === s ? '' : s; pintarKam(); }; });
    cada('[data-xk-kam]', function (b) { b.onclick = function () { var k = b.getAttribute('data-xk-kam'); XK.kam = XK.kam === k ? '' : k; pintarKam(); }; });
    var ids = function () { return xkFiltradas().map(function (k) { return k.id; }); };
    cada('[data-xk-ficha]', function (b) { b.onclick = function () { var id = b.getAttribute('data-xk-ficha'), l = ids(); abrirPerfil(id, l.indexOf(id) >= 0 ? l : null); }; });
    cada('[data-xk-chat]', function (b) { b.onclick = function () { go('inbox'); openContact(b.getAttribute('data-xk-chat')); }; });
    cada('[data-xk-motivos]', function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-xk-motivos'), abrir = !XK.abiertos[id];
        XK.abiertos[id] = abrir;
        b.setAttribute('aria-expanded', String(abrir));
        var ul = $(b.getAttribute('aria-controls'));
        if (ul) ul.hidden = !abrir;
      };
    });
    // KAM: el mismo «Asignado a» de la ficha (misma ruta, misma regla), y el panel se vuelve a pedir.
    cada('.xk-d-kam select', function (sel) {
      var art = sel.closest('[data-xk-id]'), id = art && art.getAttribute('data-xk-id');
      var k = XK.datos.cuentas.filter(function (x) { return x.id === id; })[0];
      if (k) { sel.setAttribute('aria-label', 'KAM de ' + (k.nombre || 'esta cuenta')); engancharResponsable(sel, { id: k.id, responsable: k.kam }, cargarKam); }
    });
    cada('[data-xk-editar]', function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-xk-editar');
        XK.editando[id] = true; delete XK.errores[id];
        pintarKam();
        var t = caja.querySelector('textarea' + xkSel('data-xk-nota', id));
        if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); }
      };
    });
    cada('[data-xk-cancelar]', function (b) { b.onclick = function () { var id = b.getAttribute('data-xk-cancelar'); delete XK.editando[id]; delete XK.borradores[id]; delete XK.errores[id]; pintarKam(); }; });
    cada('textarea[data-xk-nota]', function (t) {
      t.oninput = function () {
        var id = t.getAttribute('data-xk-nota');
        XK.borradores[id] = t.value;
        var n = caja.querySelector(xkSel('data-xk-cuantas', id));
        if (n) n.textContent = t.value.length + ' / ' + R('kam.maxNota', XK_NOTA_MAX);
      };
      t.onkeydown = function (e) {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        var b = caja.querySelector(xkSel('data-xk-cancelar', t.getAttribute('data-xk-nota')));
        if (b) b.click();
      };
    });
    cada('[data-xk-guardar]', function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-xk-guardar'), t = caja.querySelector('textarea' + xkSel('data-xk-nota', id));
        var texto = t ? t.value : '';
        XK.borradores[id] = texto;
        b.disabled = true; b.textContent = 'Guardando…';
        api('/contacts/' + encodeURIComponent(id) + '/cuenta-clave', { method: 'PUT', body: { nota: texto } }).then(function (r) {
          if (!r || r.error) { XK.errores[id] = (r && r.error) || 'el servidor no contestó'; pintarKam(); return; }
          delete XK.editando[id]; delete XK.borradores[id]; delete XK.errores[id];
          toast('Plan de cuenta guardado', null, { icono: 'check' });
          cargarKam();
        }).catch(function (e) { if (String(e && e.message) === '401') return; XK.errores[id] = 'no hubo conexión'; pintarKam(); });
      };
    });
    cada('[data-xk-quitar]', function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-xk-quitar');
        XK.quitando[id] = true; pintarKam();
        var no = caja.querySelector(xkSel('data-xk-quitar-no', id));
        if (no) no.focus();
      };
    });
    cada('[data-xk-quitar-no]', function (b) { b.onclick = function () { delete XK.quitando[b.getAttribute('data-xk-quitar-no')]; pintarKam(); }; });
    cada('[data-xk-quitar-si]', function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-xk-quitar-si');
        b.disabled = true;
        xkMarcar(id, false).then(function (ok) { delete XK.quitando[id]; if (ok) cargarKam(); else pintarKam(); });
      };
    });
    cada('[data-xk-marcar]', function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-xk-marcar');
        XK.marcando[id] = true; pintarKam();
        xkMarcar(id, true).then(function () { delete XK.marcando[id]; cargarKam(); });
      };
    });
  }

  /** Marcar o quitar, desde el panel o desde la ficha. Devuelve si se pudo. */
  function xkMarcar(id, on) {
    return api('/contacts/' + encodeURIComponent(id) + '/cuenta-clave', { method: 'PUT', body: { on: on } }).then(function (r) {
      if (!r || r.error) { toast('No se pudo: ' + ((r && r.error) || 'el servidor no contestó')); return false; }
      toast(on ? 'Ahora es cuenta clave' : 'Ya no es cuenta clave', null, { icono: 'check' });
      return true;
    }).catch(function (e) { if (String(e && e.message) !== '401') toast('No se pudo: no hubo conexión'); return false; });
  }

  /** El botón «★ Cuenta clave» de la ficha: dice si lo es (y desde cuándo) y la marca o la quita. */
  function pintarClaveFicha(d) {
    var b = $('pf-clave');
    if (!b) return;
    var k = d && d.cuentaClave;
    b.hidden = false;
    b.setAttribute('aria-pressed', String(Boolean(k)));
    b.classList.toggle('on', Boolean(k));
    b.title = k ? 'Cuenta clave desde el ' + new Date(k.desde).toLocaleDateString('es-CO', { day: 'numeric', month: 'long' }) + (k.por ? ', la marcó ' + k.por : '') + '. Toca para quitarla.' : 'Marcar como cuenta clave';
    b.innerHTML = '<i class="ic" data-ic="estrella"></i><span>' + (k ? 'Cuenta clave' : 'Marcar como cuenta clave') + '</span>';
    iconos(b);
    b.onclick = function () {
      if (!PF || !PF.contact) return;
      var id = PF.contact.id, on = !PF.cuentaClave;
      b.disabled = true;
      xkMarcar(id, on).then(function (ok) {
        b.disabled = false;
        if (!ok) return;
        api('/contacts/' + encodeURIComponent(id)).then(function (r) {
          if (r && !r.error && PF && PF.contact && PF.contact.id === id) { PF.cuentaClave = r.cuentaClave; pintarClaveFicha(PF); }
        });
        if (state.view === 'kam') cargarKam();
      });
    };
  }
  // (fin de XEN · Panel KAM)

  // ===== XEN · Optimización de ventas: lo nuevo del agente de optimización (alAbrir('optimizacion', …)) =====
  // Dónde se pierden ventas y qué hacer distinto (la idea de los «insights» de Dynamics 365), pero SIN modelo: el
  // servidor aplica reglas fijas sobre los datos de verdad (crm/optimizacion.ts) y aquí solo se pintan. Ninguna
  // frase se inventa en el navegador, y cada cifra lleva su base («2 de 5»).
  //
  // 🪤 No lleva el violeta de la IA: esto no lo dice ningún modelo, son reglas. El violeta en una pantalla de reglas
  // haría creer que XENCRM «opina», y la gente le daría a estas cifras el crédito (o la desconfianza) equivocado.
  var XO = { dias: 30, datos: null, pide: 0 };
  try { XO.dias = [7, 30, 90].indexOf(Number(localStorage.getItem(LLAVE('xo.dias')))) >= 0 ? Number(localStorage.getItem(LLAVE('xo.dias'))) : 30; } catch (e) {}
  var XO_PRIORIDAD = {
    alta: { t: 'alta', ic: 'alerta', uno: 'urge', varios: 'urgen' },
    media: { t: 'media', ic: 'objetivo', uno: 'importa', varios: 'importan' },
    baja: { t: 'baja', ic: 'analitica', uno: 'para tener en cuenta', varios: 'para tener en cuenta' }
  };
  /** Las pantallas de configuración no se abren con el candado: el botón no ofrece una puerta cerrada. */
  function xoPuedeIr(ir) { return Boolean(ir) && !(ir.soloAdmin && enCandado()); }
  function xoEsqueleto() {
    return '<div class="xo-resumen xo-esq" aria-hidden="true"><i></i><i></i></div>' +
      '<div class="xo-hallazgos">' + [1, 2, 3].map(function () { return '<div class="xo-h xo-esq" aria-hidden="true"><i></i><i></i><i></i></div>'; }).join('') + '</div>' +
      '<span class="sr-only">Buscando dónde se pierden ventas…</span>';
  }
  function pintarDiasOptimizacion() {
    Array.prototype.forEach.call(($('xo-dias') || { children: [] }).children, function (b) {
      var on = Number(b.getAttribute('data-d')) === XO.dias;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }
  function xoError(caja, porque) {
    caja.innerHTML = '<div class="xo-vacio xo-error" role="alert"><b>No se pudo revisar dónde se pierden ventas</b><span>' + esc(porque) +
      ' No se cambió nada.</span><button class="btn" type="button" id="xo-reintentar">Volver a intentar</button></div>';
    $('xo-reintentar').onclick = cargarOptimizacion;
  }
  function cargarOptimizacion() {
    var caja = $('xo-opt');
    if (!caja) return;
    pintarDiasOptimizacion();
    var pide = ++XO.pide;
    caja.setAttribute('aria-busy', 'true');
    // Cargando: la forma de lo que viene. Si ya había datos del mismo periodo, se quedan mientras llega lo nuevo.
    if (!XO.datos || XO.datos.dias !== XO.dias) caja.innerHTML = xoEsqueleto();
    api('/optimizacion?dias=' + XO.dias).then(function (d) {
      if (pide !== XO.pide) return; // llegó tarde: ya se pidió otro periodo
      caja.setAttribute('aria-busy', 'false');
      if (!d || d.error) { xoError(caja, (d && d.error) || 'El servidor no contestó.'); return; }
      XO.datos = d;
      pintarOptimizacion(d);
    }, function () {
      if (pide !== XO.pide) return;
      caja.setAttribute('aria-busy', 'false');
      xoError(caja, 'Sin conexión con el servidor.');
    });
  }
  function xoHallazgo(h) {
    var p = XO_PRIORIDAD[h.prioridad] || XO_PRIORIDAD.baja;
    var accion = xoPuedeIr(h.ir)
      ? '<button class="btn sm" type="button" data-xo-ir="' + esc(h.id) + '">' + esc(h.ir.etiqueta) + '<i class="ic" data-ic="derecha"></i></button>'
      : '<span class="xo-solo-admin">Esto lo hace quien administra XENCRM.</span>';
    return '<article class="xo-h p-' + esc(h.prioridad) + (h.evidencia === 'poca' ? ' poca' : '') + '" aria-labelledby="xo-t-' + esc(h.id) + '">' +
      '<div class="xo-h-cab"><span class="xo-pri p-' + esc(h.prioridad) + '"><i class="ic" data-ic="' + p.ic + '"></i>Prioridad ' + p.t + '</span>' +
        (h.evidencia === 'poca' ? '<span class="xo-poca" title="Hay pocos datos: tómalo como una pista, no como una conclusión">Poca evidencia</span>' : '') + '</div>' +
      '<h3 id="xo-t-' + esc(h.id) + '">' + esc(h.titulo) + '</h3>' +
      '<p class="xo-cifra"><b>' + esc(h.cifra) + '</b><span>' + esc(h.base) + '</span></p>' +
      '<p class="xo-porque"><span class="xo-rot">Por qué importa</span>' + esc(h.porQue) + '</p>' +
      '<div class="xo-hacer"><i class="ic" data-ic="check"></i><p><span class="xo-rot">Qué hacer</span>' + esc(h.queHacer) + '</p></div>' +
      '<div class="xo-h-pie">' + accion + '</div>' +
    '</article>';
  }
  function xoEstancados(d) {
    var l = d.estancados || [];
    var cab = '<div class="xo-sec-cab"><div><h2 id="xo-est-t" tabindex="-1">Tratos estancados</h2><p>Abiertos y sin actividad hace ' + d.umbral.diasEstancado +
      ' días o más, sin ' + VOC.cita + ' por delante y sin posponer. Primero los que valen más; después, por puntaje.</p></div>' +
      (d.estancadosTotal ? '<span class="xo-cuenta" aria-label="' + d.estancadosTotal + ' estancados">' + d.estancadosTotal + '</span>' : '') + '</div>';
    if (!l.length) {
      return '<section class="xo-sec" id="xo-estancados" aria-labelledby="xo-est-t">' + cab +
        '<div class="xo-vacio xo-bien"><b>Ningún trato está estancado</b><span>Todos los abiertos se movieron en los últimos ' + d.umbral.diasEstancado + ' días, tienen ' + VOC.cita + ' o los dejaron «por ahora».</span></div></section>';
    }
    return '<section class="xo-sec" id="xo-estancados" aria-labelledby="xo-est-t">' + cab +
      '<div class="envoltura xo-tabla-caja"><table class="tz-tabla xo-tabla"><thead><tr><th>Contacto</th><th>Etapa</th><th class="num">Sin actividad</th><th>En la etapa desde</th><th>Lo lleva</th><th class="num">Valor</th><th><span class="sr-only">Acción</span></th></tr></thead><tbody>' +
      l.map(function (x) {
        var nombre = nameOf({ id: x.id, name: x.nombre, channel: x.canal });
        return '<tr>' +
          '<td class="xo-quien" data-th="Contacto">' + avatarHtml(nombre, x.id, 'sm') + '<div class="xo-quien-txt"><button class="quien" type="button" data-id="' + esc(x.id) + '">' + esc(nombre) + '</button>' +
            (x.resumen ? '<span class="dato" title="' + esc(x.resumen) + '">' + esc(x.resumen) + '</span>' : '') + '</div></td>' +
          '<td data-th="Etapa"><span class="chip stage-' + esc(x.rol || 'inicio') + '">' + esc(x.titulo) + '</span></td>' +
          '<td class="num" data-th="Sin actividad"><b>' + x.diasSinActividad + '</b> ' + (x.diasSinActividad === 1 ? 'día' : 'días') + '</td>' +
          '<td data-th="En la etapa desde">' + esc(new Date(x.enEtapaDesde).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })) + '</td>' +
          '<td data-th="Lo lleva">' + (x.quien ? esc(x.quien) : '<span class="muted">Sin asignar</span>') + '</td>' +
          '<td class="num" data-th="Valor">' + (x.valor ? esc(plataCorta(x.valor)) : '<span class="muted" title="Sin precio: ni puesto a mano ni en el catálogo">—</span>') + '</td>' +
          '<td class="xo-acc"><button class="btn sm primary" type="button" data-xo-retomar="' + esc(x.id) + '" aria-label="Retomar a ' + esc(nombre) + '">Retomar</button></td>' +
        '</tr>';
      }).join('') + '</tbody></table></div>' +
      (d.estancadosTotal > l.length ? '<p class="xo-nota">Se ven los ' + l.length + ' primeros de ' + d.estancadosTotal + '.</p>' : '') +
      '</section>';
  }
  function pintarOptimizacion(d) {
    var caja = $('xo-opt');
    if (d.sinDatos) {
      caja.innerHTML = '<div class="xo-vacio"><b>Todavía no hay de qué sacar conclusiones</b><span>Esta pantalla mira las conversaciones, los tratos y cómo terminan. ' +
        'En cuanto entren las primeras, aquí aparecen dónde se caen los tratos, los que se quedaron quietos y qué hacer con cada cosa.</span>' +
        '<button class="btn" type="button" id="xo-a-bandeja">Ir a la bandeja</button></div>';
      $('xo-a-bandeja').onclick = function () { go('inbox'); };
      return;
    }
    var r = d.resumen, hs = d.hallazgos || [];
    var partes = ['alta', 'media', 'baja'].filter(function (k) { return r[k]; }).map(function (k) {
      var p = XO_PRIORIDAD[k];
      return '<span class="xo-pri p-' + k + '"><i class="ic" data-ic="' + p.ic + '"></i>' + r[k] + ' ' + (r[k] === 1 ? p.uno : p.varios) + '</span>';
    }).join('');
    var firmes = r.hallazgos - r.pocaEvidencia;
    var frase = !hs.length ? 'Nada que corregir con lo que hay'
      : !firmes ? (r.hallazgos === 1 ? 'Una pista, con pocos datos todavía' : r.hallazgos + ' pistas, con pocos datos todavía')
      : (firmes === 1 ? 'Una cosa para vender más' : firmes + ' cosas para vender más');
    var imp = d.impacto && d.impacto.estancados;
    var impacto = imp
      ? '<div class="xo-impacto"><span class="xo-rot">En juego</span><b>' + esc(plataCorta(imp.valor)) + '</b><span>en ' + imp.conValor + (imp.conValor === 1 ? ' trato estancado con precio' : ' tratos estancados con precio') +
        (imp.cuantos > imp.conValor ? ' (de ' + imp.cuantos + ' estancados)' : '') + '</span></div>'
      // Sin precio no hay cifra: decir «$0» sería decir que no vale nada.
      : (d.estancadosTotal ? '<div class="xo-impacto sin"><span class="xo-rot">En juego</span><b>Sin cifra</b><span>Ningún trato estancado tiene precio: no se puede decir cuánto vale.</span></div>' : '');
    caja.innerHTML =
      '<section class="xo-resumen" aria-labelledby="xo-frase">' +
        '<span class="xo-resumen-ic" aria-hidden="true"><i class="ic" data-ic="rayo"></i></span>' +
        '<div class="xo-resumen-txt"><h2 id="xo-frase">' + esc(frase) + '</h2>' +
          '<p>Con lo que pasó en los últimos ' + d.dias + ' días. Reglas fijas sobre tus datos, sin IA: cada cifra dice sobre cuántos se contó.</p>' +
          (partes ? '<div class="xo-resumen-pri">' + partes + '</div>' : '') + '</div>' +
        impacto +
      '</section>' +
      (hs.length
        ? '<div class="xo-hallazgos">' + hs.map(xoHallazgo).join('') + '</div>'
        : '<div class="xo-vacio xo-bien"><b>Nada que corregir con lo que hay</b><span>Ninguna regla encontró algo que pida cambiar. Con más conversaciones (o un periodo más largo) puede salir algo que hoy no se ve.</span></div>') +
      xoEstancados(d) +
      '<details class="xo-como"><summary>Cómo se decide cada cosa</summary><ul>' +
        '<li>Dónde se caen: la etapa que menos gente deja pasar a la siguiente, con al menos ' + d.umbral.baseEmbudo + ' que llegaron a ella; sale si pasa menos del ' + Math.round(d.umbral.pasoBajo * 100) + ' %.</li>' +
        '<li>Estancados: tratos abiertos sin actividad en ' + d.umbral.diasEstancado + ' días o más, sin ' + VOC.cita + ' por delante y sin posponer.</li>' +
        '<li>Velocidad: hacen falta ' + d.umbral.cerradosVelocidad + ' tratos cerrados con tiempo de respuesta medido (' + d.umbral.grupoVelocidad + ' rápidos y ' + d.umbral.grupoVelocidad + ' lentos) para comparar.</li>' +
        '<li>Acuerdo de servicio: con ' + d.umbral.respondidas + ' respuestas o más, sale si el ' + Math.round(d.umbral.fueraDeAcuerdo * 100) + ' % o más tardó de más.</li>' +
        '<li>Motivos de pérdida: con ' + d.umbral.perdidas + ' perdidos o más. Objeciones: las que se repiten ' + d.umbral.objecion + ' veces o más.</li>' +
        '<li>Horas: con ' + d.umbral.mensajesHoras + ' mensajes o más. Canales: con ' + d.umbral.porCanal + ' contactos o más en cada uno.</li>' +
      '</ul></details>';
    iconos(caja);
    Array.prototype.forEach.call(caja.querySelectorAll('[data-xo-ir]'), function (b) {
      b.onclick = function () {
        var h = hs.filter(function (x) { return x.id === b.getAttribute('data-xo-ir'); })[0];
        if (!h) return;
        if (h.ir.vista === 'optimizacion' && h.ir.filtro === 'estancados') {
          // 🪤 Se desplaza SOLO la caja de esta pantalla. scrollIntoView mueve también los contenedores de afuera
          // (aunque tengan overflow:hidden) y corría el marco entero de la aplicación hacia arriba: en el celular
          // quedaba media pantalla vacía debajo y la barra de arriba fuera de la vista.
          var sec = $('xo-estancados');
          if (sec) {
            caja.scrollTo({ top: sec.getBoundingClientRect().top - caja.getBoundingClientRect().top + caja.scrollTop - 8, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
            $('xo-est-t').focus({ preventScroll: true });
          }
          return;
        }
        go(h.ir.vista, h.ir.filtro ? { filter: h.ir.filtro } : undefined);
      };
    });
    var ids = (d.estancados || []).map(function (x) { return x.id; });
    Array.prototype.forEach.call(caja.querySelectorAll('.xo-tabla .quien[data-id]'), function (b) {
      b.onclick = function () { abrirPerfil(b.dataset.id, ids); };
    });
    // Retomar: la conversación, como «Escribirle» en la Lista de trabajo.
    Array.prototype.forEach.call(caja.querySelectorAll('[data-xo-retomar]'), function (b) {
      b.onclick = function () { go('inbox'); openContact(b.getAttribute('data-xo-retomar')); };
    });
  }
  if ($('xo-dias')) Array.prototype.forEach.call($('xo-dias').children, function (b) {
    b.onclick = function () {
      XO.dias = Number(b.getAttribute('data-d')) || 30;
      try { localStorage.setItem(LLAVE('xo.dias'), String(XO.dias)); } catch (e) {}
      cargarOptimizacion();
    };
  });
  alAbrir('optimizacion', cargarOptimizacion);
  // (fin de XEN · Optimización de ventas)

  // ===== XEN · Tickets y SLA: lo nuevo del agente de Tickets y SLA (alAbrir('tickets', …), alAbrir('sla', …)) =====
  // Servicio › Tickets, Servicio › SLA y Configuración › SLA y tickets, como los casos y los SLA de Dynamics 365
  // Customer Service. El servidor (crm/tickets.ts) calcula el reloj de cada ticket con el plan del cliente y la
  // configuración; aquí solo se pinta, se filtra y se cambia.
  //
  // 🪤 Nada del negocio va fijo aquí: los nombres de los planes, las prioridades (y su tono), los tipos, los estados
  // (cuáles cierran, cuáles pausan) y quién puede qué llegan del servidor en `config`. Un negocio que llame «Urgente»
  // a lo crítico, o que tenga un plan «Oro», se ve con sus palabras sin tocar una línea de esto.
  //
  // 🪤 El estado del SLA va SIEMPRE con su palabra y su ícono (Incumplido · En riesgo · A tiempo · En pausa · Sin
  // SLA), y el reloj dice qué hay que hacer y para cuándo («Responder antes de las 3:40 p. m. · en 2 h»).
  //
  // 🪤 Los diálogos (el ticket y el ticket nuevo) se crean en el <body> y no dentro de una pantalla: se abren desde la
  // Bandeja y desde la ficha, y un <dialog> dentro de una pantalla escondida no se puede mostrar.
  ICONS.ticket = ICONS.ticket || '<path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z"/>';
  ICONS.subir = ICONS.subir || '<path d="M12 19V5M5 12l7-7 7 7"/>';
  ICONS.bajar = ICONS.bajar || '<path d="M12 5v14M19 12l-7 7-7-7"/>';
  ICONS.caja = ICONS.caja || '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>';
  TITULOS['cfg-sla'] = 'Configuración';
  var XT = { datos: null, cfg: null, puede: { crear: true, mover: true }, cargando: false, error: null, vista: 'abiertos', prioridad: '', plan: '', asignado: '', q: '', contactos: null,
    // El tablero (kanban): lo pide /tickets/tablero con los filtros puestos; `ruta` descarta una respuesta vieja.
    modo: 'lista', tablero: null, tabError: null, tabRuta: '', arrastrando: false, pendiente: false };
  var XT_SLA = { incumplido: ['Incumplido', 'alerta'], en_riesgo: ['En riesgo', 'reloj'], a_tiempo: ['A tiempo', 'check'], en_pausa: ['En pausa', 'pausa'], cumplido: ['Cumplido', 'check'] };
  var XT_VISTAS = [['abiertos', 'Abiertos'], ['mios', 'Mis tickets'], ['sin_asignar', 'Sin asignar'], ['riesgo', 'En riesgo'], ['incumplidos', 'Incumplidos'], ['terminados', 'Terminados']];
  /** La columna de los tickets cuyo estado se quitó de la configuración (crm/tickets.ts, SIN_ESTADO). */
  var XT_SIN_ESTADO = '__sin_estado';
  try { XT.vista = localStorage.getItem(LLAVE('tickets.vista')) || 'abiertos'; } catch (e) {}
  try { XT.modo = localStorage.getItem(LLAVE('tickets.modo')) === 'tablero' ? 'tablero' : 'lista'; } catch (e) {}

  /** El nombre de algo de la configuración (plan, prioridad, tipo, estado) por su id; si ya no existe, el id. */
  function xtNombre(lista, id) { var x = ((XT.cfg && XT.cfg[lista]) || []).filter(function (y) { return y.id === id; })[0]; return x ? x.nombre : String(id || ''); }
  function xtTono(id) { var x = ((XT.cfg && XT.cfg.prioridades) || []).filter(function (y) { return y.id === id; })[0]; return x ? x.tono : 'neutro'; }
  /** «20 min», «2 h 30 min», «3 días». Redondeado a lo que se entiende de un vistazo. */
  function xtDuracion(ms) {
    var m = Math.max(0, Math.round(ms / 60000));
    if (m < 60) return m + ' min';
    var hh = Math.floor(m / 60), r = m % 60;
    if (hh < 24) return hh + ' h' + (r && hh < 6 ? ' ' + r + ' min' : '');
    var d = Math.round(hh / 24);
    return d + (d === 1 ? ' día' : ' días');
  }
  /** «3:40 p. m.», «mañana, 8:30 a. m.», «jue 13 nov, 8:30 a. m.». */
  function xtHora(ts) {
    var d = new Date(ts), hoy = new Date(), manana = new Date(); manana.setDate(hoy.getDate() + 1);
    var hora = d.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
    if (d.toDateString() === hoy.toDateString()) return hora;
    if (d.toDateString() === manana.toDateString()) return 'mañana, ' + hora;
    return d.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' }) + ', ' + hora;
  }
  var xtAntes = function (ts) { var x = xtHora(ts); return (/^\d/.test(x) ? 'las ' : '') + x; };
  /** Un objetivo en palabras: «4 h hábiles», «3 días hábiles», «1 h · 24/7». */
  function xtObjetivo(min, reloj, jornada) {
    var habil = reloj !== 'corrido';
    var t = habil && jornada && min >= jornada && min % jornada === 0 ? (min / jornada) + (min / jornada === 1 ? ' día hábil' : ' días hábiles')
      : min % 60 === 0 ? (min / 60) + ' h' + (habil ? ' hábiles' : '')
        : min + ' min' + (habil ? ' hábiles' : '');
    return habil ? t : t + ' · 24/7';
  }
  function xtChipPlan(plan) { return plan ? '<span class="xt-plan">' + esc(xtNombre('planes', plan)) + '</span>' : '<span class="xt-plan sin">Sin plan</span>'; }
  function xtChipPrio(p) { return '<span class="xt-prio t-' + esc(xtTono(p)) + '"><i aria-hidden="true"></i>' + esc(xtNombre('prioridades', p)) + '</span>'; }
  function xtChipEstado(t) { return '<span class="xt-estado' + (t.terminado ? ' fin' : t.enPausa ? ' pausa' : '') + '">' + esc(xtNombre('estados', t.estado)) + '</span>'; }

  /**
   * El reloj de un ticket en una frase: qué hay que hacer y para cuándo. Devuelve { estado, html }.
   * 🪤 Con el objetivo que corre AHORA: la primera respuesta mientras no haya, y después la solución.
   */
  function xtReloj(t, ahora) {
    if (!t.sla) return { estado: 'sin', html: '<span class="xt-reloj s-sin"><i class="ic" data-ic="escudo"></i><b>Sin SLA</b><span>el cliente no tiene plan de soporte</span></span>' };
    var s = t.sla, est = s.estado, par = XT_SLA[est] || ['', 'reloj'], txt;
    if (t.terminado) {
      txt = xtNombre('estados', t.estado) + (est === 'cumplido' ? ' a tiempo' : ' fuera de tiempo') + (t.resuelto ? ' · ' + xtHora(t.resuelto) : '');
    } else {
      var cual = s.activo || 'solucion', o = s[cual], verbo = cual === 'respuesta' ? 'Responder' : 'Resolver';
      if (cual === 'solucion' && o.estado === 'en_pausa') txt = xtNombre('estados', t.estado) + ': el reloj de la solución está parado';
      else if (o.vence && ahora > o.vence) txt = (cual === 'respuesta' ? 'La primera respuesta' : 'La solución') + ' venció hace ' + xtDuracion(ahora - o.vence);
      else if (o.vence) txt = verbo + ' antes de ' + xtAntes(o.vence) + ' · en ' + xtDuracion(o.vence - ahora);
      else txt = verbo;
      if (est === 'incumplido' && cual === 'solucion' && s.respuesta.estado === 'incumplido' && o.estado !== 'incumplido') txt = 'La primera respuesta llegó tarde · ' + txt.charAt(0).toLowerCase() + txt.slice(1);
    }
    return { estado: est, html: '<span class="xt-reloj s-' + est + '"><i class="ic" data-ic="' + par[1] + '"></i><b>' + esc(par[0]) + '</b><span>' + esc(txt) + '</span></span>' };
  }
  /** Lo que dice la historia de la ficha de un cambio de ticket. La usa historiaHtml. */
  function fraseDeTicket(p, quien) {
    var cod = 'el ticket TK-' + String(p.ticket || '').padStart(4, '0');
    switch (p.accion) {
      case 'creado': return quien(p.by) + ' abrió ' + cod + (p.a ? ': ' + p.a : '');
      case 'estado': return quien(p.by) + ' pasó ' + cod + ' a ' + xtNombre('estados', p.a);
      case 'prioridad': return quien(p.by) + ' le cambió la prioridad a ' + cod + ': ' + xtNombre('prioridades', p.a);
      case 'asignado': return p.a ? quien(p.by) + ' le asignó ' + cod + ' a ' + p.a : quien(p.by) + ' dejó ' + cod + ' sin asignar';
      case 'respondido': return quien(p.by) + ' marcó la primera respuesta de ' + cod;
      default: return null;
    }
  }

  function xtFiltrados() {
    var d = XT.datos;
    if (!d) return [];
    var q = XT.q.trim().toLowerCase();
    return d.tickets.filter(function (t) {
      switch (XT.vista) {
        case 'terminados': if (!t.terminado) return false; break;
        case 'mios': if (t.terminado || !mismoNombre(t.asignado, state.name)) return false; break;
        case 'sin_asignar': if (t.terminado || t.asignado) return false; break;
        case 'riesgo': if (t.terminado || !t.sla || t.sla.estado !== 'en_riesgo') return false; break;
        case 'incumplidos': if (!t.sla || t.sla.estado !== 'incumplido') return false; break;
        default: if (t.terminado) return false;
      }
      if (XT.prioridad && t.prioridad !== XT.prioridad) return false;
      if (XT.plan === '__sin' ? t.plan : XT.plan && t.plan !== XT.plan) return false;
      if (XT.asignado === '__nadie' ? t.asignado : XT.asignado && !mismoNombre(t.asignado, XT.asignado)) return false;
      if (q && (t.asunto + ' ' + t.codigo + ' ' + (t.contacto.nombre || '') + ' ' + (t.producto || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }

  /** `foco`: el id del ticket que se acaba de mover en el tablero, para que el foco lo siga a su nueva columna. */
  function cargarTickets(foco) {
    // El tablero se pide aparte (y a la par): las cifras de arriba y la lista salen de /tickets, como siempre.
    if (XT.modo === 'tablero') cargarTablero(foco);
    if (XT.cargando) return;
    var caja = $('xt-tickets');
    if (!caja) return;
    XT.cargando = true;
    caja.setAttribute('aria-busy', 'true');
    if (!XT.datos) caja.innerHTML = '<div class="xt-cifras">' + [1, 2, 3, 4].map(function () { return '<div class="xt-cifra xt-esq" aria-hidden="true"><i></i><i></i></div>'; }).join('') + '</div>' +
      '<ul class="xt-lista">' + [1, 2, 3, 4].map(function () { return '<li class="xt-fila xt-esq" aria-hidden="true"><i></i><i></i></li>'; }).join('') + '</ul>';
    api('/tickets?dias=90').then(function (d) {
      XT.cargando = false;
      caja.removeAttribute('aria-busy');
      if (!d || d.error || !d.tickets) { XT.error = (d && d.error) || 'el servidor no contestó'; pintarTickets(); return; }
      XT.error = null;
      XT.datos = d;
      XT.cfg = d.config;
      XT.puede = d.puede || XT.puede;
      pintarTickets();
    }).catch(function (e) {
      XT.cargando = false;
      caja.removeAttribute('aria-busy');
      if (String(e && e.message) === '401') return;
      XT.error = 'no hubo conexión con el servidor';
      pintarTickets();
    });
  }
  alAbrir('tickets', cargarTickets);
  // El reloj corre: mientras se mira, cada minuto se vuelve a pedir (el servidor calcula el SLA a la hora de ahora).
  setInterval(function () {
    if (document.hidden) return;
    if (state.view === 'tickets' && XT.datos) cargarTickets();
    if (state.view === 'sla' && XS.datos) cargarSla(true);
  }, 60000);

  function xtFilaHtml(t, ahora) {
    var r = xtReloj(t, ahora);
    return '<li class="xt-fila s-' + r.estado + '" data-xt-fila="' + t.id + '">' +
      '<div class="xt-f-cab"><button type="button" class="xt-abrir" data-xt-id="' + t.id + '"><span class="xt-cod">' + esc(t.codigo) + '</span><b>' + esc(t.asunto || 'Ticket sin asunto') + '</b></button>' +
      xtChipPrio(t.prioridad) + '</div>' +
      '<div class="xt-f-quien">' + avatarHtml(t.contacto.nombre || t.contacto.telefono || '?', t.contacto.id, 'sm') +
        '<span class="xt-nom">' + esc(t.contacto.nombre || t.contacto.telefono || 'Sin nombre') + '</span>' + xtChipPlan(t.plan) +
        (t.producto ? '<span class="xt-prod"><i class="ic" data-ic="caja" aria-hidden="true"></i><span class="sr-only">Producto: </span>' + esc(t.producto) + '</span>' : '') + '</div>' +
      '<div class="xt-f-pie">' + r.html + '<span class="xt-f-der">' + xtChipEstado(t) +
        '<span class="xt-asig">' + (t.asignado ? avatarHtml(t.asignado, t.asignado, 'sm') + '<span>' + esc(t.asignado) + '</span>' : '<span class="xt-asig-sin">Sin asignar</span>') + '</span></span></div>' +
    '</li>';
  }

  /** `foco`: en el tablero, el id del ticket que debe quedar con el foco (el que se acaba de mover). */
  function pintarTickets(foco) {
    var caja = $('xt-tickets');
    if (!caja) return;
    // 🪤 Mientras se arrastra una tarjeta no se redibuja (el reloj de cada minuto, una respuesta que llega): la tarjeta
    // desaparecería de debajo del puntero. Se redibuja al soltarla.
    if (XT.arrastrando) { XT.pendiente = true; return; }
    if (XT.error && !XT.datos) {
      caja.innerHTML = '<div class="xt-error" role="alert"><b>No se pudieron cargar los tickets</b><span>' + esc(XT.error) + '. Los tickets siguen guardados.</span><button class="btn sm" type="button" id="xt-reintentar">Volver a intentar</button></div>';
      $('xt-reintentar').onclick = function () { XT.error = null; cargarTickets(); };
      return;
    }
    var d = XT.datos;
    if (!d) return;
    var ahora = d.ahora || Date.now();
    var abiertos = d.tickets.filter(function (t) { return !t.terminado; });
    var cuenta = function (f) { return abiertos.filter(f).length; };
    var cifras = [
      { v: 'abiertos', t: 'Abiertos', n: abiertos.length, p: abiertos.length ? 'esperan algo del equipo' : 'nada pendiente', ic: 'ticket', tono: 'acento' },
      { v: 'riesgo', t: 'En riesgo', n: cuenta(function (t) { return t.sla && t.sla.estado === 'en_riesgo'; }), p: XT.cfg ? 'gastaron el ' + XT.cfg.riesgoPct + ' % de su tiempo' : '', ic: 'reloj', tono: 'ambar' },
      { v: 'incumplidos', t: 'Incumplidos', n: cuenta(function (t) { return t.sla && t.sla.estado === 'incumplido'; }), p: 'abiertos y ya pasados', ic: 'alerta', tono: 'rojo' },
      { v: 'sin_asignar', t: 'Sin asignar', n: cuenta(function (t) { return !t.asignado; }), p: 'nadie los tiene', ic: 'user', tono: 'neutro' }
    ];
    var html = '<div class="xt-acciones">' + (XT.puede.crear
      ? '<button class="btn primary" type="button" id="xt-nuevo"><i class="ic" data-ic="mas"></i>Nuevo ticket</button>'
      : '<p class="xt-nada">En este negocio los tickets los abre quien administra.</p>') +
      (mandaEnElModo() ? '<button class="btn" type="button" id="xt-a-config"><i class="ic" data-ic="sliders"></i>Configurar SLA y tickets</button>' : '') +
      (d.tickets.length ? xtModoHtml() : '') + '</div>' +
      // En el tablero, una cifra lleva a la lista con esa vista: el tablero no tiene vistas, tiene columnas.
      '<div class="xt-cifras">' + cifras.map(function (x) {
        return '<button type="button" class="xt-cifra t-' + (x.n ? x.tono : 'neutro') + '" data-xt-vista="' + x.v + '" aria-pressed="' + (XT.modo === 'lista' && XT.vista === x.v) + '">' +
          '<span class="xt-cifra-cab"><span>' + esc(x.t) + '</span><i class="ic" data-ic="' + x.ic + '"></i></span><b>' + x.n + '</b><small>' + esc(x.p) + '</small></button>';
      }).join('') + '</div>';
    if (!d.tickets.length) {
      html += '<section class="xt-vacio"><span class="xt-vacio-ic"><i class="ic" data-ic="ticket"></i></span><div><h2>Un ticket es algo que un cliente reportó y que se le debe resolver</h2>' +
        '<p>Cada ticket corre con el reloj del plan de soporte del cliente (' + esc(((XT.cfg && XT.cfg.planes) || []).map(function (p) { return p.nombre; }).join(', ')) + '): XENCRM avisa cuando está en riesgo y cuando se pasó.</p>' +
        '<p>Ábrelo con <b>Nuevo ticket</b>, o desde la conversación y la ficha del cliente con <b>Crear ticket</b>.</p></div></section>';
      caja.innerHTML = html;
      xtEnganchar(caja);
      return;
    }
    var personas = [];
    d.tickets.forEach(function (t) { if (t.asignado && !personas.some(function (n) { return mismoNombre(n, t.asignado); })) personas.push(t.asignado); });
    var sel = function (id, lbl, val, ops) {
      return '<label class="xt-f"><span>' + esc(lbl) + '</span><select id="' + id + '">' + ops.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === val ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></label>';
    };
    html += '<div class="xt-herr">' +
      (XT.modo === 'lista' ? '<div class="xt-vistas" role="group" aria-label="Qué tickets ver">' + XT_VISTAS.map(function (v) {
        var n = v[0] === 'abiertos' ? abiertos.length : v[0] === 'terminados' ? d.tickets.length - abiertos.length : null;
        return '<button type="button" data-xt-vista="' + v[0] + '" aria-pressed="' + (XT.vista === v[0]) + '">' + esc(v[1]) + (n !== null ? '<span class="xt-n">' + n + '</span>' : '') + '</button>';
      }).join('') + '</div>' : '') +
      '<div class="xt-filtros"><label class="xt-buscar"><span class="sr-only">Buscar tickets</span><input type="search" id="xt-q" placeholder="Buscar por asunto, cliente o código" value="' + esc(XT.q) + '"></label>' +
        sel('xt-f-prio', 'Prioridad', XT.prioridad, [['', 'Todas']].concat(XT.cfg.prioridades.map(function (p) { return [p.id, p.nombre]; }))) +
        sel('xt-f-plan', 'Plan', XT.plan, [['', 'Todos']].concat(XT.cfg.planes.map(function (p) { return [p.id, p.nombre]; })).concat([['__sin', 'Sin plan']])) +
        sel('xt-f-asig', 'Asignado a', XT.asignado, [['', 'Todos']].concat(personas.map(function (n) { return [n, n + (mismoNombre(n, state.name) ? ' (tú)' : '')]; })).concat([['__nadie', 'Sin asignar']])) +
      '</div></div>';
    if (XT.modo === 'tablero') html += xtTableroHtml(ahora);
    else {
      var lista = xtFiltrados();
      html += lista.length
        ? '<ul class="xt-lista" aria-label="Tickets">' + lista.map(function (t) { return xtFilaHtml(t, ahora); }).join('') + '</ul>'
        : '<div class="xt-sin"><b>Ningún ticket con este filtro</b><span>Hay ' + abiertos.length + (abiertos.length === 1 ? ' abierto' : ' abiertos') + ' en total.</span><button class="btn sm" type="button" id="xt-limpiar">Ver los abiertos</button></div>';
    }
    // Al redibujar (el reloj de cada minuto, una tarjeta movida) el tablero no salta: se queda en la misma columna y
    // a la misma altura, y el foco vuelve a la misma tarjeta.
    var antes = $('xt-tablero'), scroll = antes ? { x: antes.scrollLeft, cols: {} } : null;
    if (antes) antes.querySelectorAll('.col[data-estado]').forEach(function (c) { scroll.cols[c.getAttribute('data-estado')] = c.querySelector('.cards').scrollTop; });
    var enfocada = document.activeElement && document.activeElement.closest ? document.activeElement.closest('#xt-tablero [data-xt-tarjeta]') : null;
    foco = foco || (enfocada && Number(enfocada.getAttribute('data-xt-tarjeta')));
    caja.innerHTML = html;
    xtEnganchar(caja);
    if (XT.modo === 'tablero') xtEngancharTablero(caja, foco, scroll);
  }

  function xtEnganchar(caja) {
    iconos(caja);
    if ($('xt-nuevo')) $('xt-nuevo').onclick = function () { abrirTicketNuevo(null); };
    if ($('xt-a-config')) $('xt-a-config').onclick = function () { go('cfg-sla'); };
    caja.querySelectorAll('[data-xt-modo]').forEach(function (b) { b.onclick = function () { xtModo(b.getAttribute('data-xt-modo')); }; });
    caja.querySelectorAll('[data-xt-vista]').forEach(function (b) {
      b.onclick = function () {
        XT.vista = b.getAttribute('data-xt-vista');
        try { localStorage.setItem(LLAVE('tickets.vista'), XT.vista); } catch (e) {}
        if (XT.modo !== 'tablero') { pintarTickets(); return; }
        xtModo('lista');
        // El foco se queda en la cifra que se pulsó (redibujada), no en «Lista».
        var cifra = document.querySelector('#xt-tickets .xt-cifra[data-xt-vista="' + XT.vista + '"]');
        if (cifra) cifra.focus();
      };
    });
    // Prioridad, plan y asignado los filtra el servidor en el tablero (/tickets/tablero): cambiarlos lo vuelve a pedir.
    var cambia = function (id, k) { if ($(id)) $(id).onchange = function () { XT[k] = $(id).value; if (XT.modo === 'tablero') cargarTablero(); pintarTickets(); }; };
    cambia('xt-f-prio', 'prioridad'); cambia('xt-f-plan', 'plan'); cambia('xt-f-asig', 'asignado');
    var qT;
    if ($('xt-q')) $('xt-q').oninput = function () {
      clearTimeout(qT);
      qT = setTimeout(function () { XT.q = $('xt-q').value; var pos = $('xt-q').selectionStart; pintarTickets(); $('xt-q').focus(); try { $('xt-q').setSelectionRange(pos, pos); } catch (e) {} }, 200);
    };
    if ($('xt-limpiar')) $('xt-limpiar').onclick = function () { XT.vista = 'abiertos'; XT.prioridad = XT.plan = XT.asignado = XT.q = ''; if (XT.modo === 'tablero') cargarTablero(); pintarTickets(); };
    caja.querySelectorAll('[data-xt-fila]').forEach(function (li) {
      li.onclick = function (e) { if (e.target.closest('button') && !e.target.closest('.xt-abrir')) return; abrirTicket(Number(li.getAttribute('data-xt-fila'))); };
    });
  }

  // ---------- Tickets como tablero (kanban) ----------
  // Una columna por estado —los de este negocio, en su orden—, como Tratos: se arrastra una tarjeta a otra columna, o
  // se usa «Mover…», que es lo que sirve con teclado, con lector de pantalla y en el celular. Mover es el mismo PATCH
  // que el selector de estado del ticket: el servidor pausa o reanuda el reloj, reabre, revisa el permiso y lo deja
  // en la historia de la ficha. Aquí no se decide nada de eso.

  /** Lista | Tablero, como en Tratos. */
  function xtModoHtml() {
    return '<div class="xf-seg xt-modo" role="group" aria-label="Cómo ver los tickets">' +
      '<button type="button" data-xt-modo="lista"' + (XT.modo === 'lista' ? ' class="on"' : '') + ' aria-pressed="' + (XT.modo === 'lista') + '"><i class="ic" data-ic="lista"></i>Lista</button>' +
      '<button type="button" data-xt-modo="tablero"' + (XT.modo === 'tablero' ? ' class="on"' : '') + ' aria-pressed="' + (XT.modo === 'tablero') + '"><i class="ic" data-ic="kanban"></i>Tablero</button></div>';
  }
  function xtModo(m) {
    XT.modo = m === 'tablero' ? 'tablero' : 'lista';
    try { localStorage.setItem(LLAVE('tickets.modo'), XT.modo); } catch (e) {}
    if (XT.modo === 'tablero') cargarTablero();
    pintarTickets();
    var b = document.querySelector('#xt-tickets [data-xt-modo="' + XT.modo + '"]');
    if (b) b.focus();
  }

  function cargarTablero(foco) {
    var p = ['dias=30'];
    if (XT.prioridad) p.push('prioridad=' + encodeURIComponent(XT.prioridad));
    if (XT.plan) p.push('plan=' + encodeURIComponent(XT.plan));
    if (XT.asignado) p.push('asignado=' + encodeURIComponent(XT.asignado));
    var ruta = '/tickets/tablero?' + p.join('&');
    XT.tabRuta = ruta;
    var pintar = function () { if (XT.modo === 'tablero' && state.view === 'tickets') pintarTickets(foco); };
    api(ruta).then(function (d) {
      if (XT.tabRuta !== ruta) return; // llegó tarde: ya se pidió con otros filtros
      // Si el servidor dice que no (un filtro que ya no existe), el tablero viejo no se queda: mostraría otra cosa.
      if (!d || d.error || !d.columnas) { XT.tablero = null; XT.tabError = (d && d.error) || 'el servidor no contestó'; pintar(); return; }
      XT.tabError = null;
      XT.tablero = d;
      XT.cfg = d.config || XT.cfg;
      XT.puede = d.puede || XT.puede;
      pintar();
    }).catch(function (e) {
      if (String(e && e.message) === '401' || XT.tabRuta !== ruta) return;
      // Sin conexión, el tablero que ya se veía se queda (como la lista); el error solo si no había nada.
      XT.tabError = 'no hubo conexión con el servidor';
      pintar();
    });
  }

  function xtTableroHtml(ahora) {
    var tab = XT.tablero;
    if (!tab && XT.tabError) return '<div class="xt-error" role="alert"><b>No se pudo cargar el tablero</b><span>' + esc(XT.tabError) + '. Los tickets siguen guardados.</span><button class="btn sm" type="button" id="xt-tab-reintentar">Volver a intentar</button></div>';
    if (!tab) return '<div class="board xt-tablero" aria-hidden="true">' + [1, 2, 3, 4].map(function () {
      return '<div class="col"><div class="cards"><div class="xt-esq"><i></i><i></i></div><div class="xt-esq"><i></i><i></i></div></div></div>';
    }).join('') + '</div>';
    var q = XT.q.trim().toLowerCase();
    var coincide = function (t) { return !q || (t.asunto + ' ' + t.codigo + ' ' + (t.contacto.nombre || '') + ' ' + (t.producto || '')).toLowerCase().indexOf(q) >= 0; };
    var destinos = tab.columnas.filter(function (c) { return c.id !== XT_SIN_ESTADO; });
    var hay = 0;
    var cols = tab.columnas.map(function (col) {
      var cards = col.tickets.filter(coincide);
      var n = q ? cards.length : col.total;
      var faltan = q ? 0 : col.total - col.tickets.length;
      hay += n;
      // El color sale de lo que HACE el estado (el de un ticket nuevo, sigue, pausa el reloj, cierra), no de su
      // nombre: cada negocio los llama distinto.
      var tipo = col.id === XT_SIN_ESTADO ? 'sin' : col.cierra ? 'cierra' : col.pausa ? 'pausa' : XT.cfg && col.id === XT.cfg.estadoInicial ? 'inicio' : 'curso';
      var nota = col.id === XT_SIN_ESTADO ? 'ya no existe' : col.cierra ? 'últimos ' + tab.dias + ' días' : col.pausa ? 'pausa el reloj' : '';
      return '<section class="col' + (cards.length ? '' : ' vacia') + '" data-estado="' + esc(col.id) + '" data-xt-tipo="' + tipo + '">' +
        '<h3><span class="nom">' + esc(col.nombre) + '</span><span class="cuenta">' + n + '<span class="sr-only">' + (n === 1 ? ' ticket' : ' tickets') + '</span></span>' +
          (nota ? '<span class="xt-col-nota">' + esc(nota) + '</span>' : '') + '</h3>' +
        '<div class="cards">' + cards.map(function (t) { return xtTarjetaHtml(t, ahora, destinos); }).join('') +
          (faltan > 0 ? '<button type="button" class="linkbtn xt-col-mas" data-xt-a-lista="' + (col.cierra ? 'terminados' : 'abiertos') + '">Y ' + faltan + ' más: verlos en la lista</button>' : '') +
        '</div></section>';
    }).join('');
    var filtrado = q || XT.prioridad || XT.plan || XT.asignado;
    return (XT.puede.mover ? '' : '<p class="xt-nada">En este negocio los tickets los mueve quien administra: aquí se ven, pero no se mueven.</p>') +
      (!hay && filtrado ? '<div class="xt-sin"><b>Ningún ticket con estos filtros</b><span>El tablero trae los abiertos y los terminados de los últimos ' + tab.dias + ' días.</span><button class="btn sm" type="button" id="xt-limpiar">Quitar los filtros</button></div>' : '') +
      '<div class="board xt-tablero" id="xt-tablero">' + cols + '</div>';
  }

  /** Una tarjeta: lo que se necesita para decidir a dónde va (qué pasa, de quién, su reloj, su prioridad, quién lo tiene). */
  function xtTarjetaHtml(t, ahora, destinos) {
    var r = xtReloj(t, ahora);
    var mover = XT.puede.mover ? '<select class="card-move" aria-label="Mover ' + esc(t.codigo) + ' a otro estado"><option value="" selected disabled>Mover…</option>' +
      destinos.filter(function (e) { return e.id !== t.estado; }).map(function (e) { return '<option value="' + esc(e.id) + '">' + esc(e.nombre) + '</option>'; }).join('') + '</select>' : '';
    return '<article class="card xt-tarjeta s-' + r.estado + '"' + (XT.puede.mover ? ' draggable="true"' : '') + ' data-xt-tarjeta="' + t.id + '"><div class="body">' +
      '<button type="button" class="xt-abrir" data-xt-id="' + t.id + '"><span class="xt-cod">' + esc(t.codigo) + '</span><b>' + esc(t.asunto || 'Ticket sin asunto') + '</b></button>' +
      '<div class="xt-f-quien">' + avatarHtml(t.contacto.nombre || t.contacto.telefono || '?', t.contacto.id, 'sm') +
        '<span class="xt-nom">' + esc(t.contacto.nombre || t.contacto.telefono || 'Sin nombre') + '</span>' + xtChipPlan(t.plan) + '</div>' +
      r.html +
      '<div class="xt-t-pie">' + xtChipPrio(t.prioridad) +
        '<span class="xt-asig">' + (t.asignado ? avatarHtml(t.asignado, t.asignado, 'sm') + '<span>' + esc(t.asignado) + '</span>' : '<span class="xt-asig-sin">Sin asignar</span>') + '</span>' +
        mover + '</div>' +
    '</div></article>';
  }

  function xtEngancharTablero(caja, foco, scroll) {
    if ($('xt-tab-reintentar')) $('xt-tab-reintentar').onclick = function () { XT.tabError = null; cargarTablero(); pintarTickets(); };
    caja.querySelectorAll('[data-xt-a-lista]').forEach(function (b) {
      b.onclick = function () { XT.vista = b.getAttribute('data-xt-a-lista'); try { localStorage.setItem(LLAVE('tickets.vista'), XT.vista); } catch (e) {} xtModo('lista'); };
    });
    var tab = $('xt-tablero');
    if (!tab) return;
    if (scroll) {
      tab.scrollLeft = scroll.x;
      tab.querySelectorAll('.col[data-estado]').forEach(function (c) { var y = scroll.cols[c.getAttribute('data-estado')]; if (y) c.querySelector('.cards').scrollTop = y; });
    }
    tab.querySelectorAll('[data-xt-tarjeta]').forEach(function (card) {
      var id = Number(card.getAttribute('data-xt-tarjeta'));
      // Clic en cualquier parte de la tarjeta abre el ticket (con teclado, el asunto es el botón); «Mover…» no.
      card.onclick = function (e) { if (e.target.closest('.card-move')) return; abrirTicket(id); };
      var sel = card.querySelector('.card-move');
      if (sel) sel.onchange = function () { xtMover(id, sel.value); };
      if (!XT.puede.mover) return;
      card.ondragstart = function (e) {
        XT.arrastrando = true;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', 'ticket:' + id);
        setTimeout(function () { card.classList.add('dragging'); }, 0); // después de que el navegador toma la imagen que arrastra
      };
      card.ondragend = function () {
        card.classList.remove('dragging');
        XT.arrastrando = false;
        if (XT.pendiente) { XT.pendiente = false; pintarTickets(); }
      };
    });
    if (XT.puede.mover) tab.querySelectorAll('.col[data-estado]').forEach(function (col) {
      var estado = col.getAttribute('data-estado');
      // 🪤 En «Sin estado» no se suelta nada: es un estado que ya no existe, y el servidor lo rechazaría.
      if (estado === XT_SIN_ESTADO) return;
      col.ondragover = function (e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; col.classList.add('over'); };
      col.ondragleave = function (e) { if (!col.contains(e.relatedTarget)) col.classList.remove('over'); };
      col.ondrop = function (e) {
        e.preventDefault();
        col.classList.remove('over');
        // Solo una tarjeta de ticket: un texto arrastrado desde otro lado no mueve nada.
        var m = /^ticket:(\d+)$/.exec(e.dataTransfer.getData('text/plain') || '');
        if (m) xtMover(Number(m[1]), estado);
      };
    });
    var movida = foco && tab.querySelector('[data-xt-tarjeta="' + foco + '"] .xt-abrir');
    if (movida) { movida.focus(); movida.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  }

  function xtDelTablero(id) {
    var hallado = null;
    ((XT.tablero && XT.tablero.columnas) || []).some(function (c) { hallado = c.tickets.filter(function (t) { return t.id === id; })[0] || null; return hallado; });
    return hallado;
  }
  function xtMover(id, estado) {
    if (!id || !estado) return;
    var t = xtDelTablero(id);
    if (t && t.estado === estado) return;
    var cod = t ? t.codigo : 'TK-' + String(id).padStart(4, '0');
    var nombre = xtNombre('estados', estado);
    var aviso = $('xt-tab-status');
    var card = document.querySelector('#xt-tablero [data-xt-tarjeta="' + id + '"]');
    if (card) card.setAttribute('aria-busy', 'true');
    var seQuedo = function (por) {
      if (aviso) aviso.textContent = cod + ' se quedó donde estaba: ' + por + '.';
      toast('No se pudo mover ' + cod + ': ' + por);
      cargarTablero(id);
    };
    api('/tickets/' + id, { method: 'PATCH', body: { estado: estado } }).then(function (r) {
      if (!r || r.error) { seQuedo((r && r.error) || 'el servidor no contestó'); return; }
      if (aviso) aviso.textContent = r.codigo + ' pasó a ' + nombre + '.';
      toast(r.codigo + ' pasó a ' + nombre, null, { icono: 'check' });
      cargarTickets(id); // el tablero y las cifras de arriba
      if (XS.datos) cargarSla(true);
      xtRefrescarFicha(r.contacto.id);
    }).catch(function (e) {
      if (String(e && e.message) === '401') return;
      seQuedo('no hubo conexión con el servidor');
    });
  }

  // ---------- El ticket abierto ----------
  var XT_DLG = null;
  function xtDialogo(id, clase) {
    var d = document.getElementById(id);
    if (d) return d;
    d = document.createElement('dialog');
    d.id = id;
    d.className = 'perfil xt-dlg ' + (clase || '');
    d.setAttribute('aria-labelledby', id + '-t');
    document.body.appendChild(d);
    d.addEventListener('click', function (e) { if (e.target === d) d.close(); });
    return d;
  }
  /** Antes de abrir un ticket hace falta la configuración (los nombres): si todavía no llegó, se pide. */
  function xtConConfig(fn) {
    if (XT.cfg) { fn(); return; }
    api('/tickets?dias=1').then(function (d) { if (d && d.config) { XT.cfg = d.config; XT.puede = d.puede || XT.puede; } fn(); }).catch(function () { fn(); });
  }
  function abrirTicket(id) {
    var dlg = xtDialogo('xt-dlg-ticket');
    XT_DLG = id;
    dlg.innerHTML = '<div class="xt-dlg-cuerpo"><p class="xt-dlg-cargando" id="xt-dlg-ticket-t">Cargando el ticket…</p></div>';
    if (!dlg.open) dlg.showModal();
    xtConConfig(function () {
      api('/tickets/' + id).then(function (t) {
        if (XT_DLG !== id) return;
        if (!t || t.error) { dlg.innerHTML = '<div class="xt-dlg-cuerpo"><div class="xt-error" role="alert"><b id="xt-dlg-ticket-t">No se pudo abrir el ticket</b><span>' + esc((t && t.error) || 'el servidor no contestó') + '</span><button class="btn sm" type="button" data-cerrar="xt-dlg-ticket">Cerrar</button></div></div>'; return; }
        pintarTicket(t);
      }).catch(function () { /* el 401 ya lo muestra la pantalla de entrada */ });
    });
  }
  function xtMedidor(nombre, o, ahora, jornada, extra) {
    var par = XT_SLA[o.estado] || ['', 'reloj'];
    var pct = Math.max(0, Math.min(100, Math.round(o.consumido * 100)));
    var linea = o.hecho
      ? (o.estado === 'cumplido' ? 'Cumplido' : 'Fuera de tiempo') + ' · ' + xtHora(o.hecho)
      : o.estado === 'en_pausa' ? 'En pausa: el tiempo del cliente no cuenta'
        : o.vence ? (ahora > o.vence ? 'Venció hace ' + xtDuracion(ahora - o.vence) : 'Vence ' + (/^\d/.test(xtHora(o.vence)) ? 'a las ' : '') + xtHora(o.vence) + ' · en ' + xtDuracion(o.vence - ahora)) : '';
    return '<div class="xt-medidor s-' + o.estado + '"><div class="xt-med-cab"><b>' + esc(nombre) + '</b><span class="xt-med-obj">Objetivo: ' + esc(xtObjetivo(o.objetivoMin, o.reloj, jornada)) + '</span></div>' +
      '<div class="xt-barra" role="img" aria-label="' + esc(nombre + ': ' + pct + ' % del tiempo gastado') + '"><i style="width:' + pct + '%"></i></div>' +
      '<div class="xt-med-pie"><span class="xt-med-est"><i class="ic" data-ic="' + par[1] + '"></i>' + esc(par[0]) + '</span><span>' + esc(linea) + '</span></div>' + (extra || '') + '</div>';
  }
  function xtFraseHistoria(h) {
    var quien = h.por === 'bot' ? (state.agentName || 'Xen') : h.por === 'equipo' || h.por === 'admin' ? 'El equipo' : h.por;
    switch (h.accion) {
      case 'creado': return quien + ' abrió el ticket';
      case 'estado': return quien + ' lo pasó de ' + xtNombre('estados', h.de) + ' a ' + xtNombre('estados', h.a);
      case 'prioridad': return quien + ' cambió la prioridad de ' + xtNombre('prioridades', h.de) + ' a ' + xtNombre('prioridades', h.a);
      case 'asignado': return h.a ? quien + ' se lo asignó a ' + h.a : quien + ' lo dejó sin asignar';
      case 'respondido': return quien + ' marcó la primera respuesta';
      case 'asunto': return quien + ' corrigió el asunto';
      case 'tipo': return quien + ' lo cambió a ' + xtNombre('tipos', h.a);
      case 'producto': return quien + ' cambió el producto' + (h.a ? ' a ' + h.a : '');
      default: return null;
    }
  }
  function pintarTicket(t) {
    var dlg = xtDialogo('xt-dlg-ticket'), ahora = Date.now(), cfg = XT.cfg || { estados: [], prioridades: [], tipos: [], primeraRespuesta: {} }, jornada = cfg.jornadaMin || 600;
    var gente = genteDelEquipo({ responsable: t.asignado });
    var mover = XT.puede.mover;
    var opts = function (lista, val) { return lista.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === val ? ' selected' : '') + '>' + esc(x.nombre) + '</option>'; }).join('') + (lista.some(function (x) { return x.id === val; }) ? '' : '<option value="' + esc(val) + '" selected>' + esc(val) + '</option>'); };
    var dis = mover ? '' : ' disabled';
    var resp = t.respondido
      ? '<p class="xt-resp"><i class="ic" data-ic="check"></i>Primera respuesta ' + xtHora(t.respondido) + (t.respondidoPor ? ' · ' + esc(t.respondidoPor) : '') +
        ' <small>(' + esc(t.respondidoComo === 'equipo' ? 'el equipo contestó en la conversación' : t.respondidoComo === 'al_resolver' ? 'contó al cerrarlo' : 'marcada a mano') + ')</small></p>'
      : '<p class="xt-resp falta"><i class="ic" data-ic="reloj"></i>Todavía sin primera respuesta.' + (cfg.primeraRespuesta.delEquipo ? ' Cuenta sola cuando alguien del equipo le contesta en la conversación.' : '') + '</p>' +
        (cfg.primeraRespuesta.aMano && mover ? '<button class="btn sm" type="button" id="xt-respondido">Marcar como respondido</button>' : '');
    var historia = (t.historia || []).map(function (h) { var f = xtFraseHistoria(h); return f ? '<li><span>' + esc(f) + '</span><time>' + esc(xtHora(h.ts)) + '</time></li>' : ''; }).join('');
    var pausa = cfg.estados.filter(function (e) { return e.pausa; }).map(function (e) { return '«' + e.nombre + '»'; }).join(' o ');
    dlg.innerHTML = '<div class="xt-dlg-cab"><div><span class="xt-cod">' + esc(t.codigo) + ' · ' + esc(xtNombre('tipos', t.tipo)) + (t.producto ? ' · ' + esc(t.producto) : '') + '</span>' +
        '<h2 id="xt-dlg-ticket-t">' + esc(t.asunto || 'Ticket sin asunto') + '</h2>' +
        '<div class="xt-dlg-quien">' + avatarHtml(t.contacto.nombre || '?', t.contacto.id, 'sm') + '<b>' + esc(t.contacto.nombre || t.contacto.telefono || 'Sin nombre') + '</b>' + xtChipPlan(t.plan) + '</div></div>' +
        '<button class="fx-ico" type="button" data-cerrar="xt-dlg-ticket" aria-label="Cerrar"><i class="ic" data-ic="cerrar"></i></button></div>' +
      '<div class="xt-dlg-cuerpo">' +
        '<div class="xt-ctl">' +
          '<label><span>Estado</span><select id="xt-c-estado"' + dis + '>' + opts(cfg.estados, t.estado) + '</select></label>' +
          '<label><span>Prioridad</span><select id="xt-c-prio"' + dis + '>' + opts(cfg.prioridades, t.prioridad) + '</select></label>' +
          '<label><span>Asignado a</span><select id="xt-c-asig"' + dis + '><option value="">Sin asignar</option>' + gente.map(function (n) { return '<option value="' + esc(n) + '"' + (mismoNombre(n, t.asignado) ? ' selected' : '') + '>' + esc(n) + (mismoNombre(n, state.name) ? ' (tú)' : '') + '</option>'; }).join('') + '</select></label>' +
        '</div>' +
        (mover ? '' : '<p class="xt-nada">En este negocio los tickets los mueve quien administra.</p>') +
        '<p class="xt-msg" id="xt-c-msg" role="status" aria-live="polite"></p>' +
        (t.sla
          ? '<div class="xt-medidores">' + xtMedidor('Primera respuesta', t.sla.respuesta, ahora, jornada) + xtMedidor('Solución', t.sla.solucion, ahora, jornada, pausa ? '<p class="xt-med-nota">Mientras está en ' + esc(pausa) + ', lo que tarde el cliente no cuenta.</p>' : '') + '</div>'
          : '<p class="xt-sin-sla"><i class="ic" data-ic="escudo"></i>Sin SLA: este cliente no tiene plan de soporte. Ponlo en su ficha (Datos del contacto) para que el ticket corra con su reloj.</p>') +
        resp +
        '<div class="xt-dlg-acc"><button class="btn sm primary" type="button" id="xt-a-chat"><i class="ic" data-ic="burbuja"></i>Abrir la conversación</button><button class="btn sm" type="button" id="xt-a-ficha">Ver la ficha</button></div>' +
        '<h3>Historia</h3>' + (historia ? '<ul class="xt-historia">' + historia + '</ul>' : '<p class="xt-nada">Sin cambios todavía.</p>') +
      '</div>';
    iconos(dlg);
    var cambiar = function (cambios, sel) {
      var msg = $('xt-c-msg');
      msg.textContent = 'Guardando…';
      api('/tickets/' + t.id, { method: 'PATCH', body: cambios }).then(function (r) {
        if (!r || r.error) { msg.textContent = 'No se pudo: ' + ((r && r.error) || 'sin respuesta'); if (sel) sel.focus(); return; }
        toast(r.codigo + ': guardado', null, { icono: 'check' });
        abrirTicket(t.id);
        if (XT.datos) cargarTickets();
        if (XS.datos) cargarSla(true);
        xtRefrescarFicha(t.contacto.id);
      });
    };
    $('xt-c-estado').onchange = function () { cambiar({ estado: this.value }, this); };
    $('xt-c-prio').onchange = function () { cambiar({ prioridad: this.value }, this); };
    $('xt-c-asig').onchange = function () { cambiar({ asignado: this.value || null }, this); };
    if ($('xt-respondido')) $('xt-respondido').onclick = function () { cambiar({ respondido: true }, this); };
    $('xt-a-chat').onclick = function () { dlg.close(); if ($('dlg-perfil') && $('dlg-perfil').open) $('dlg-perfil').close(); go('inbox'); openContact(t.contacto.id); };
    $('xt-a-ficha').onclick = function () { dlg.close(); abrirPerfil(t.contacto.id); };
  }

  // ---------- El ticket nuevo ----------
  function abrirTicketNuevo(contactoId, alCrear) {
    var dlg = xtDialogo('xt-dlg-nuevo', 'xt-dlg-chico');
    dlg.innerHTML = '<div class="xt-dlg-cuerpo"><p class="xt-dlg-cargando" id="xt-dlg-nuevo-t">Cargando los clientes…</p></div>';
    if (!dlg.open) dlg.showModal();
    xtConConfig(function () {
      var cfg = XT.cfg;
      if (!cfg) { dlg.innerHTML = '<div class="xt-dlg-cuerpo"><div class="xt-error" role="alert"><b id="xt-dlg-nuevo-t">No se pudo preparar el ticket</b><span>No llegó la configuración del SLA.</span><button class="btn sm" type="button" data-cerrar="xt-dlg-nuevo">Cerrar</button></div></div>'; return; }
      if (!XT.puede.crear) { dlg.innerHTML = '<div class="xt-dlg-cuerpo"><div class="xt-error" role="alert"><b id="xt-dlg-nuevo-t">No puedes abrir tickets</b><span>En este negocio los abre quien administra.</span><button class="btn sm" type="button" data-cerrar="xt-dlg-nuevo">Cerrar</button></div></div>'; return; }
      var borrador = { contacto: contactoId || '', asunto: '', tipo: cfg.tipoDeFabrica, prioridad: cfg.prioridadDeFabrica, producto: null, asignado: '' };
      var pintar = function (contactos, error) {
        var c = contactos.filter(function (x) { return x.id === borrador.contacto; })[0];
        var datos = (c && c.data) || {};
        if (borrador.producto === null) borrador.producto = datos[cfg.campoProducto] ? String(datos[cfg.campoProducto]) : '';
        var plan = datos[cfg.campoPlan];
        var gente = genteDelEquipo({ responsable: (c && c.responsable) || null });
        var opts = function (lista, val) { return lista.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === val ? ' selected' : '') + '>' + esc(x.nombre) + '</option>'; }).join(''); };
        dlg.innerHTML = '<form class="xt-form" id="xt-form" novalidate><div class="xt-dlg-cab"><h2 id="xt-dlg-nuevo-t">Nuevo ticket</h2><button class="fx-ico" type="button" data-cerrar="xt-dlg-nuevo" aria-label="Cerrar"><i class="ic" data-ic="cerrar"></i></button></div>' +
          '<div class="xt-dlg-cuerpo">' +
            '<label class="xt-campo"><span>Cliente</span><select id="xt-n-contacto" required><option value="">Elige el cliente</option>' + contactos.map(function (x) {
              var pl = x.data && x.data[cfg.campoPlan];
              return '<option value="' + esc(x.id) + '"' + (x.id === borrador.contacto ? ' selected' : '') + '>' + esc(nameOf(x)) + (pl ? ' · ' + esc(pl) : '') + '</option>';
            }).join('') + '</select></label>' +
            (c ? '<p class="xt-plan-de">' + (plan ? 'Plan de soporte: <b>' + esc(plan) + '</b>. El ticket corre con su reloj.' : cfg.sinPlan ? 'Sin plan en su ficha: se mide como <b>' + esc(xtNombre('planes', cfg.sinPlan)) + '</b>.' : 'Este cliente no tiene plan de soporte: el ticket se atiende igual, sin SLA.') + '</p>' : '') +
            '<label class="xt-campo"><span>Asunto</span><input type="text" id="xt-n-asunto" maxlength="140" required placeholder="Qué pasa, en una línea" value="' + esc(borrador.asunto) + '"></label>' +
            '<div class="xt-fila2"><label class="xt-campo"><span>Tipo</span><select id="xt-n-tipo">' + opts(cfg.tipos, borrador.tipo) + '</select></label>' +
            '<label class="xt-campo"><span>Prioridad</span><select id="xt-n-prio">' + opts(cfg.prioridades, borrador.prioridad) + '</select></label></div>' +
            '<div class="xt-fila2"><label class="xt-campo"><span>Producto</span><input type="text" id="xt-n-prod" maxlength="60" value="' + esc(borrador.producto || '') + '"></label>' +
            '<label class="xt-campo"><span>Asignado a</span><select id="xt-n-asig"><option value="">Sin asignar</option>' + gente.map(function (n) { return '<option value="' + esc(n) + '"' + (mismoNombre(n, borrador.asignado) ? ' selected' : '') + '>' + esc(n) + (mismoNombre(n, state.name) ? ' (tú)' : '') + '</option>'; }).join('') + '</select></label></div>' +
            '<p class="xt-msg error" id="xt-n-msg" role="alert">' + esc(error || '') + '</p>' +
          '</div><div class="xt-dlg-pie"><button class="btn" type="button" data-cerrar="xt-dlg-nuevo">Cancelar</button><button class="btn primary" type="submit" id="xt-n-ok">Abrir ticket</button></div></form>';
        iconos(dlg);
        var guardarBorrador = function () {
          borrador.contacto = $('xt-n-contacto').value; borrador.asunto = $('xt-n-asunto').value; borrador.tipo = $('xt-n-tipo').value;
          borrador.prioridad = $('xt-n-prio').value; borrador.producto = $('xt-n-prod').value; borrador.asignado = $('xt-n-asig').value;
        };
        $('xt-n-contacto').onchange = function () { guardarBorrador(); borrador.producto = null; pintar(contactos); $('xt-n-asunto').focus(); };
        $('xt-form').onsubmit = function (e) {
          e.preventDefault();
          guardarBorrador();
          // 🪤 Si algo falla, lo escrito se queda: el formulario se vuelve a pintar con el borrador y el porqué.
          if (!borrador.contacto) { pintar(contactos, 'Elige a qué cliente es el ticket.'); $('xt-n-contacto').focus(); return; }
          if (borrador.asunto.trim().length < 3) { pintar(contactos, 'El asunto dice qué pasa: escribe al menos tres letras.'); $('xt-n-asunto').focus(); return; }
          $('xt-n-ok').disabled = true;
          api('/tickets', { method: 'POST', body: { contacto: borrador.contacto, asunto: borrador.asunto, tipo: borrador.tipo, prioridad: borrador.prioridad, producto: borrador.producto, asignado: borrador.asignado || null } }).then(function (r) {
            if (!r || r.error) { pintar(contactos, 'No se pudo abrir: ' + ((r && r.error) || 'el servidor no contestó')); return; }
            dlg.close();
            toast(r.codigo + ' abierto' + (r.sla ? '' : ' (sin SLA: el cliente no tiene plan)'), null, { icono: 'check' });
            if (XT.datos || state.view === 'tickets') cargarTickets();
            if (XS.datos) cargarSla(true);
            xtRefrescarFicha(r.contacto.id);
            if (alCrear) alCrear(r);
          }).catch(function () { pintar(contactos, 'No hubo conexión con el servidor: el ticket no se abrió.'); });
        };
        if (borrador.contacto) $('xt-n-asunto').focus(); else $('xt-n-contacto').focus();
      };
      var conContactos = function (l) {
        var lista = (Array.isArray(l) ? l : []).slice().sort(function (a, b) { return nameOf(a).localeCompare(nameOf(b), 'es'); });
        XT.contactos = lista;
        pintar(lista);
      };
      api('/contacts?limit=1000').then(conContactos).catch(function () { pintar(XT.contactos || [], 'No se pudieron cargar los clientes.'); });
    });
  }

  // ---------- En la ficha y en la Bandeja ----------
  /** La sección «Tickets» de la ficha: los de esta persona y «Crear ticket». La llama pintarPerfil. */
  function xtEnLaFicha(d) {
    var lado = $('pf-cuerpo') && $('pf-cuerpo').querySelector('.ficha-lado');
    if (!lado || !d || !d.contact) return;
    var id = d.contact.id;
    var sec = document.createElement('section');
    sec.className = 'xt-pf';
    sec.setAttribute('data-xt-pf', id);
    sec.innerHTML = '<div class="xt-pf-cab"><h4>Tickets</h4><button class="btn sm" type="button" data-xt-pf-nuevo><i class="ic" data-ic="mas"></i>Crear ticket</button></div><div class="xt-pf-cuerpo"><p class="xt-nada">Cargando…</p></div>';
    // Va después de «Sobre el contacto» (el primer bloque de la columna), antes de cómo contactarlo.
    var segundo = lado.querySelectorAll('h4')[1];
    if (segundo) lado.insertBefore(sec, segundo); else lado.appendChild(sec);
    iconos(sec);
    sec.querySelector('[data-xt-pf-nuevo]').onclick = function () { abrirTicketNuevo(id); };
    api('/tickets?contacto=' + encodeURIComponent(id)).then(function (r) {
      if (!document.body.contains(sec) || !r || !r.tickets) return;
      if (r.config && !XT.cfg) { XT.cfg = r.config; XT.puede = r.puede || XT.puede; }
      if (r.puede && !r.puede.crear) sec.querySelector('[data-xt-pf-nuevo]').hidden = true;
      var ts = r.tickets, ahora = r.ahora || Date.now();
      sec.querySelector('.xt-pf-cuerpo').innerHTML = ts.length
        ? '<ul class="xt-pf-l">' + ts.slice(0, 6).map(function (t) {
            return '<li><button type="button" class="xt-pf-t" data-xt-id="' + t.id + '"><span class="xt-cod">' + esc(t.codigo) + '</span><b>' + esc(t.asunto || 'Ticket sin asunto') + '</b></button>' +
              '<div class="xt-pf-m">' + xtChipPrio(t.prioridad) + xtChipEstado(t) + '</div>' + xtReloj(t, ahora).html + '</li>';
          }).join('') + '</ul>' + (ts.length > 6 ? '<p class="xt-nada">Y ' + (ts.length - 6) + ' más en Servicio › Tickets.</p>' : '')
        : '<p class="xt-nada">Sin tickets. Si reporta algo, ábrelo aquí y correrá con el SLA de su plan.</p>';
      iconos(sec);
      sec.querySelectorAll('[data-xt-id]').forEach(function (b) { b.onclick = function () { abrirTicket(Number(b.getAttribute('data-xt-id'))); }; });
    }).catch(function () {});
  }
  /** Después de crear o cambiar un ticket, la ficha abierta de esa persona lo muestra. */
  function xtRefrescarFicha(contactoId) {
    if (!$('dlg-perfil') || !$('dlg-perfil').open || !PF || !PF.contact || PF.contact.id !== contactoId) return;
    var viejo = $('pf-cuerpo').querySelector('[data-xt-pf]');
    if (viejo) viejo.remove();
    xtEnLaFicha(PF);
  }
  // «Crear ticket» en la cabecera de la conversación: con la persona ya puesta.
  if ($('xt-crear-chat')) { iconos($('xt-crear-chat')); $('xt-crear-chat').onclick = function () { if (state.detail && state.detail.contact) abrirTicketNuevo(state.detail.contact.id); }; }

  // ---------- SLA ----------
  var XS = { datos: null, conf: null, dias: 30, cargando: false, error: null, mant: null };
  try { XS.dias = Number(localStorage.getItem(LLAVE('sla.dias'))) || 30; } catch (e) {}
  function cargarSla(callado) {
    if (XS.cargando) return;
    var caja = $('xs-sla');
    if (!caja) return;
    XS.cargando = true;
    caja.setAttribute('aria-busy', 'true');
    if (!XS.datos && !callado) caja.innerHTML = '<div class="xt-cifras">' + [1, 2, 3, 4].map(function () { return '<div class="xt-cifra xt-esq" aria-hidden="true"><i></i><i></i></div>'; }).join('') + '</div><div class="xs-tabla xt-esq" aria-hidden="true"><i></i><i></i><i></i></div>';
    Promise.all([api('/sla?dias=' + XS.dias), api('/sla/config')]).then(function (r) {
      XS.cargando = false;
      caja.removeAttribute('aria-busy');
      if (!r[0] || r[0].error || !r[1] || r[1].error) { XS.error = (r[0] && r[0].error) || (r[1] && r[1].error) || 'el servidor no contestó'; pintarSla(); return; }
      XS.error = null;
      XS.datos = r[0];
      XS.conf = r[1];
      XT.cfg = r[0].config;
      pintarSla();
    }).catch(function (e) {
      XS.cargando = false;
      caja.removeAttribute('aria-busy');
      if (String(e && e.message) === '401') return;
      XS.error = 'no hubo conexión con el servidor';
      pintarSla();
    });
    // Mantenimientos y actualizaciones: los da otra pantalla. Si no hay ruta o falla, la sección lo dice y ya.
    api('/mantenimientos/cumplimiento?dias=' + XS.dias).then(function (m) { XS.mant = m && !m.error && m.mantenimientos ? m : false; if (XS.datos) pintarSla(); }).catch(function () { XS.mant = false; if (XS.datos) pintarSla(); });
  }
  alAbrir('sla', function () { cargarSla(false); });

  var xsPct = function (c) { return c.de ? Math.round((c.a / c.de) * 100) : null; };
  function xsConteo(c) {
    var p = xsPct(c);
    if (p === null) return '<span class="xs-nada">Sin casos decididos</span>';
    return '<span class="xs-pct ' + (p >= 90 ? 'bien' : p >= 75 ? 'medio' : 'mal') + '"><b>' + p + ' %</b><small>' + c.a + ' de ' + c.de + '</small></span>' +
      '<span class="xs-mini" aria-hidden="true"><i style="width:' + p + '%"></i></span>';
  }
  function pintarSla() {
    var caja = $('xs-sla');
    if (!caja) return;
    if (XS.error && !XS.datos) {
      caja.innerHTML = '<div class="xt-error" role="alert"><b>No se pudo calcular el SLA</b><span>' + esc(XS.error) + '.</span><button class="btn sm" type="button" id="xs-reintentar">Volver a intentar</button></div>';
      $('xs-reintentar').onclick = function () { XS.error = null; cargarSla(false); };
      return;
    }
    var d = XS.datos, conf = XS.conf;
    if (!d || !conf) return;
    var jornada = conf.jornadaMin;
    var pR = xsPct(d.respuesta), pS = xsPct(d.solucion);
    var riesgo = d.ahora.filter(function (t) { return t.sla.estado === 'en_riesgo'; }).length, incumplidos = d.ahora.length - riesgo;
    var tonoPct = function (p) { return p === null ? 'neutro' : p >= 90 ? 'verde' : p >= 75 ? 'ambar' : 'rojo'; };
    var html = '<div class="xs-herr"><span class="xs-periodo">Tickets abiertos en los últimos ' + d.dias + ' días</span><div class="xt-vistas" role="group" aria-label="Periodo">' +
      [7, 30, 90].map(function (n) { return '<button type="button" data-xs-dias="' + n + '" aria-pressed="' + (XS.dias === n) + '">' + n + ' días</button>'; }).join('') + '</div></div>';
    html += '<div class="xt-cifras">' +
      '<div class="xt-cifra t-' + tonoPct(pR) + '"><span class="xt-cifra-cab"><span>Primera respuesta a tiempo</span><i class="ic" data-ic="burbuja"></i></span><b>' + (pR === null ? '—' : pR + ' %') + '</b><small>' + (d.respuesta.de ? d.respuesta.a + ' de ' + d.respuesta.de + (d.respuesta.de === 1 ? ' ticket' : ' tickets') : 'ninguno decidido todavía') + (d.corriendo.respuesta ? ' · ' + d.corriendo.respuesta + ' corriendo' : '') + '</small></div>' +
      '<div class="xt-cifra t-' + tonoPct(pS) + '"><span class="xt-cifra-cab"><span>Solución a tiempo</span><i class="ic" data-ic="check"></i></span><b>' + (pS === null ? '—' : pS + ' %') + '</b><small>' + (d.solucion.de ? d.solucion.a + ' de ' + d.solucion.de + (d.solucion.de === 1 ? ' ticket' : ' tickets') : 'ninguno decidido todavía') + (d.corriendo.solucion ? ' · ' + d.corriendo.solucion + ' corriendo' : '') + '</small></div>' +
      '<div class="xt-cifra t-' + (incumplidos ? 'rojo' : riesgo ? 'ambar' : 'neutro') + '"><span class="xt-cifra-cab"><span>Ahora</span><i class="ic" data-ic="alerta"></i></span><b>' + d.ahora.length + '</b><small>' + (d.ahora.length ? incumplidos + (incumplidos === 1 ? ' incumplido · ' : ' incumplidos · ') + riesgo + ' en riesgo' : 'nada en riesgo de ' + d.abiertos + (d.abiertos === 1 ? ' abierto' : ' abiertos')) + '</small></div>' +
      '<div class="xt-cifra t-neutro"><span class="xt-cifra-cab"><span>Sin SLA</span><i class="ic" data-ic="escudo"></i></span><b>' + d.sinPlan + '</b><small>' + (d.sinPlan ? (d.sinPlan === 1 ? 'ticket de un cliente sin plan: no cuenta' : 'tickets de clientes sin plan: no cuentan') : 'todos con plan') + '</small></div>' +
    '</div>';
    if (!d.tickets) html += '<section class="xt-vacio"><span class="xt-vacio-ic"><i class="ic" data-ic="escudo"></i></span><div><h2>Sin tickets en estos ' + d.dias + ' días</h2><p>El cumplimiento sale de los tickets: cuántos se respondieron y se resolvieron dentro del tiempo del plan de cada cliente. Ábrelos en Servicio › Tickets.</p></div></section>';
    if (d.ahora.length) html += '<section class="xs-sec"><h2>Lo que hay que mirar ya</h2><p class="xs-sub">Abiertos que se pasaron o gastaron el ' + conf.config.riesgoPct + ' % de su tiempo.</p><ul class="xt-lista">' + d.ahora.map(function (t) { return xtFilaHtml(t, Date.now()); }).join('') + '</ul></section>';
    var tabla = function (titulo, sub, filas, col0) {
      var vivas = filas.filter(function (f) { return f.tickets; });
      return '<section class="xs-sec"><h2>' + esc(titulo) + '</h2><p class="xs-sub">' + esc(sub) + '</p>' + (vivas.length
        ? '<div class="xs-tabla"><table><thead><tr><th scope="col">' + esc(col0) + '</th><th scope="col" class="num">Tickets</th><th scope="col">Primera respuesta a tiempo</th><th scope="col">Solución a tiempo</th></tr></thead><tbody>' +
          vivas.map(function (f) { return '<tr><th scope="row">' + f.cab + '</th><td class="num" data-rot="Tickets">' + f.tickets + '</td><td data-rot="Primera respuesta">' + xsConteo(f.respuesta) + '</td><td data-rot="Solución">' + xsConteo(f.solucion) + '</td></tr>'; }).join('') +
          '</tbody></table></div>'
        : '<p class="xt-nada">Sin tickets con plan en el periodo.</p>') + '</section>';
    };
    html += '<div class="xs-dos">' +
      tabla('Por plan', 'Lo prometido a cada plan, contra lo que pasó.', d.porPlan.map(function (x) { return { cab: xtChipPlan(x.plan), tickets: x.tickets, respuesta: x.respuesta, solucion: x.solucion }; }), 'Plan') +
      tabla('Por prioridad', 'De la más grave a la más leve.', d.porPrioridad.map(function (x) { return { cab: xtChipPrio(x.prioridad), tickets: x.tickets, respuesta: x.respuesta, solucion: x.solucion }; }), 'Prioridad') +
    '</div>';
    if (d.tiempos.length) {
      var vs = function (ms, objMin) {
        if (ms === null) return '<span class="xs-nada">—</span>';
        var ok = ms <= objMin * 60000;
        return '<span class="xs-vs ' + (ok ? 'bien' : 'mal') + '"><b>' + esc(xtDuracion(ms)) + '</b><small>' + (ok ? 'dentro' : 'pasado') + '</small></span>';
      };
      html += '<section class="xs-sec"><h2>Tiempos contra el objetivo</h2><p class="xs-sub">La mediana de lo que tardó el equipo, medida en el reloj de cada objetivo (hábil o 24/7) y sin las pausas.</p>' +
        '<div class="xs-tabla"><table><thead><tr><th scope="col">Plan · prioridad</th><th scope="col" class="num">Tickets</th><th scope="col">Primera respuesta</th><th scope="col">Objetivo</th><th scope="col">Solución</th><th scope="col">Objetivo</th></tr></thead><tbody>' +
        d.tiempos.map(function (x) {
          return '<tr><th scope="row">' + xtChipPlan(x.plan) + ' ' + xtChipPrio(x.prioridad) + '</th><td class="num" data-rot="Tickets">' + x.tickets + '</td><td data-rot="Primera respuesta">' + vs(x.respuestaMs, x.objetivoRespuestaMin) + '</td><td data-rot="Objetivo" class="xs-obj">' + esc(xtObjetivo(x.objetivoRespuestaMin, x.reloj, jornada)) + '</td>' +
            '<td data-rot="Solución">' + vs(x.solucionMs, x.objetivoSolucionMin) + '</td><td data-rot="Objetivo" class="xs-obj">' + esc(xtObjetivo(x.objetivoSolucionMin, x.reloj, jornada)) + '</td></tr>';
        }).join('') + '</tbody></table></div></section>';
    }
    var m = XS.mant;
    html += '<section class="xs-sec"><h2>Mantenimientos y actualizaciones</h2>' + (m
      ? '<div class="xs-mant"><div><b>' + m.mantenimientos.avisadosATiempo + ' de ' + m.mantenimientos.total + '</b><span>mantenimientos avisados con el tiempo del plan</span></div>' +
          '<div><b>' + m.mantenimientos.sinAviso + '</b><span>sin aviso</span></div>' +
          '<div><b>' + m.mantenimientos.proximos + '</b><span>próximos</span></div>' +
          '<div><b>' + m.actualizaciones.publicadasEnPeriodo + '</b><span>actualizaciones publicadas en ' + (m.periodoDias || XS.dias) + ' días</span></div></div>' +
          (m.actualizaciones.productosAtrasados && m.actualizaciones.productosAtrasados.length
            ? '<p class="xs-atraso"><i class="ic" data-ic="alerta"></i>Atrasados con su actualización: ' + m.actualizaciones.productosAtrasados.map(function (p) { return '<b>' + esc(p.producto) + '</b> (hace ' + p.diasDesdeLaUltima + ' días)'; }).join(', ') + '.</p>' : '') +
          '<button class="btn sm" type="button" id="xs-ver-mant">Ver Mantenimientos y actualizaciones</button>'
      : '<p class="xt-nada">' + (m === null ? 'Cargando…' : 'Sin datos de mantenimientos todavía.') + '</p>') + '</section>';
    // Las políticas, en lectura: se cambian en Configuración › SLA y tickets.
    var cfg = conf.config;
    html += '<section class="xs-sec xs-pol"><div class="xs-pol-cab"><div><h2>Políticas de SLA</h2><p class="xs-sub">Lo que se le promete a cada plan. Soporte ' + xcDias(cfg.horario.dias) + ', de ' + esc(cfg.horario.desde) + ' a ' + esc(cfg.horario.hasta) + ' (el reloj hábil solo corre ahí).</p></div>' +
      (conf.puedeEditar ? '<button class="btn sm" type="button" id="xs-a-config"><i class="ic" data-ic="sliders"></i>Cambiar en Configuración</button>' : '') + '</div>' +
      '<div class="xs-tabla"><table><thead><tr><th scope="col">Plan</th>' + cfg.prioridades.map(function (p) { return '<th scope="col">' + xtChipPrio(p.id) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      cfg.planes.map(function (pl) {
        return '<tr><th scope="row">' + xtChipPlan(pl.id) + '</th>' + cfg.prioridades.map(function (p) {
          var o = cfg.objetivos[pl.id][p.id];
          return '<td data-rot="' + esc(p.nombre) + '"><span class="xs-pol-c"><span>Responder: <b>' + esc(xtObjetivo(o.respuestaMin, o.reloj, jornada)) + '</b></span><span>Resolver: <b>' + esc(xtObjetivo(o.solucionMin, o.reloj, jornada)) + '</b></span></span></td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>' + (conf.puedeEditar ? '' : '<p class="xs-sub">Las políticas las cambia quien administra.</p>') + '</section>';
    caja.innerHTML = html;
    iconos(caja);
    caja.querySelectorAll('[data-xs-dias]').forEach(function (b) {
      b.onclick = function () { XS.dias = Number(b.getAttribute('data-xs-dias')); try { localStorage.setItem(LLAVE('sla.dias'), String(XS.dias)); } catch (e) {} XS.mant = null; cargarSla(true); };
    });
    caja.querySelectorAll('[data-xt-fila]').forEach(function (li) { li.onclick = function () { abrirTicket(Number(li.getAttribute('data-xt-fila'))); }; });
    if ($('xs-ver-mant')) $('xs-ver-mant').onclick = function () { go('mantenimientos'); };
    if ($('xs-a-config')) $('xs-a-config').onclick = function () { go('cfg-sla'); };
  }

  // ---------- Configuración › SLA y tickets ----------
  // Todo lo del SLA, editable aquí por quien tenga permiso (`permisos.politicas`): planes, prioridades, tipos,
  // estados, el horario, los objetivos y las reglas sueltas. Encima de lo de fábrica y de lo del archivo del cliente
  // (xencrm.config.json › servicio.sla): lo que se guarda aquí manda, y «Volver a lo del archivo» lo borra.
  //
  // 🪤 Lo escrito no se pierde: el borrador vive en XC y cada repintado lo lee antes; si el servidor dice que algo
  // está mal, se marca ese campo (aria-invalid) y lo demás se queda como estaba.
  var XC_DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  var XC_TONOS = [['rojo', 'Rojo'], ['ambar', 'Ámbar'], ['cielo', 'Azul cielo'], ['indigo', 'Índigo'], ['verde', 'Verde'], ['neutro', 'Gris']];
  // 🪤 XCS y xcs…, no XC y xc…: Mantenimientos (más abajo) declara los mismos nombres en el mismo ámbito, y el
  // último gana. Con nombres iguales, «Guardar» de SLA y tickets corría el guardar de Mantenimientos.
  var XCS = { conf: null, b: null, reglas: null, error: null, campo: null, cargando: false, guardando: false, olvidando: false, nuevo: 0 };
  function xcDias(dias) { return dias.map(function (d) { return XC_DIAS[d].slice(0, 3); }).join(', '); }
  function cargarCfgSla() {
    var caja = $('xc-cfg');
    if (!caja || XCS.cargando) return;
    XCS.cargando = true;
    if (!XCS.conf) caja.innerHTML = '<div class="xs-tabla xt-esq" aria-hidden="true"><i></i><i></i><i></i></div>';
    api('/sla/config').then(function (r) {
      XCS.cargando = false;
      if (!r || r.error || !r.config) { caja.innerHTML = '<div class="xt-error" role="alert"><b>No se pudo cargar la configuración del SLA</b><span>' + esc((r && r.error) || 'el servidor no contestó') + '</span><button class="btn sm" type="button" id="xc-reintentar">Volver a intentar</button></div>'; $('xc-reintentar').onclick = cargarCfgSla; return; }
      xcTomar(r);
      pintarCfgSla();
    }).catch(function (e) {
      XCS.cargando = false;
      if (String(e && e.message) === '401') return;
      caja.innerHTML = '<div class="xt-error" role="alert"><b>No hubo conexión con el servidor</b><span>La configuración sigue guardada.</span><button class="btn sm" type="button" id="xc-reintentar">Volver a intentar</button></div>';
      $('xc-reintentar').onclick = cargarCfgSla;
    });
  }
  alAbrir('cfg-sla', cargarCfgSla);
  /** De lo que manda en el servidor, un borrador para editar (los tiempos, como se escriben: «4 h», «3 d»). */
  function xcTomar(r) {
    XCS.conf = r;
    var c = r.config, j = r.jornadaMin;
    XCS.b = {
      planes: c.planes.map(function (p) { return { id: p.id, nombre: p.nombre, alias: (p.alias || []).join(', ') }; }),
      prioridades: c.prioridades.map(function (p) { return { id: p.id, nombre: p.nombre, tono: p.tono }; }),
      tipos: c.tipos.map(function (t) { return { id: t.id, nombre: t.nombre }; }),
      estados: c.estados.map(function (e) { return { id: e.id, nombre: e.nombre, cierra: e.cierra, pausa: e.pausa }; }),
      objetivos: {}
    };
    c.planes.forEach(function (pl) { XCS.b.objetivos[pl.id] = {}; c.prioridades.forEach(function (p) { var o = c.objetivos[pl.id][p.id]; XCS.b.objetivos[pl.id][p.id] = { r: xcTexto(o.respuestaMin, o.reloj, j), s: xcTexto(o.solucionMin, o.reloj, j), reloj: o.reloj }; }); });
    XCS.reglas = {};
    r.reglas.forEach(function (g) { var v = g.ruta.reduce(function (x, k) { return x == null ? x : x[k]; }, c); XCS.reglas[g.id] = v; });
    XCS.error = null; XCS.campo = null;
  }
  /** «4 h», «3 d», «45 min», «1,5 h» → minutos. Un día es una jornada de soporte si el reloj es hábil, 24 h si no. */
  function xcMinutos(txt, reloj, jornada) {
    var m = /^\s*(\d+(?:[.,]\d+)?)\s*(min|minutos?|m|h|horas?|d|d[ií]as?)?\s*$/i.exec(String(txt || ''));
    if (!m) return NaN;
    var n = Number(m[1].replace(',', '.')), u = (m[2] || 'h').toLowerCase();
    if (/^m/.test(u)) return Math.round(n);
    if (/^d/.test(u)) return Math.round(n * (reloj === 'corrido' ? 1440 : jornada));
    return Math.round(n * 60);
  }
  function xcTexto(min, reloj, jornada) {
    if (reloj !== 'corrido' && jornada && min >= jornada && min % jornada === 0) return (min / jornada) + ' d';
    if (reloj === 'corrido' && min >= 1440 && min % 1440 === 0) return (min / 1440) + ' d';
    if (min % 60 === 0) return (min / 60) + ' h';
    return min + ' min';
  }
  /** Lee lo que hay en pantalla al borrador (antes de repintar o guardar). */
  function xcsLeer() {
    var caja = $('xc-cfg'), b = XCS.b;
    if (!caja || !b) return;
    caja.querySelectorAll('[data-xc-l]').forEach(function (x) {
      var lista = x.getAttribute('data-xc-l'), i = Number(x.getAttribute('data-xc-i')), k = x.getAttribute('data-xc-k');
      if (!b[lista] || !b[lista][i]) return;
      b[lista][i][k] = x.type === 'checkbox' ? x.checked : x.value;
    });
    caja.querySelectorAll('[data-xc-o]').forEach(function (x) {
      var p = x.getAttribute('data-xc-o').split('|');
      if (b.objetivos[p[0]] && b.objetivos[p[0]][p[1]]) b.objetivos[p[0]][p[1]][p[2]] = x.value;
    });
    caja.querySelectorAll('[data-xc-r]').forEach(function (x) {
      var id = x.getAttribute('data-xc-r');
      if (x.type === 'checkbox' && x.getAttribute('data-xc-v') !== null) {
        // Lista (los días): una casilla por opción.
        var todas = caja.querySelectorAll('[data-xc-r="' + id + '"]');
        XCS.reglas[id] = Array.prototype.filter.call(todas, function (c) { return c.checked; }).map(function (c) { return Number(c.getAttribute('data-xc-v')); });
      } else if (x.type === 'checkbox') XCS.reglas[id] = x.checked;
      else XCS.reglas[id] = x.value;
    });
  }
  function xcInvalido(campo) { return XCS.campo && (XCS.campo === campo || XCS.campo.indexOf(campo + '.') === 0) ? ' aria-invalid="true"' : ''; }
  function xcCapa(clave) {
    var c = XCS.conf.capas[clave];
    return c === 'tablero' ? '<span class="xc-capa t">Cambiado aquí</span>' : c === 'archivo' ? '<span class="xc-capa a">Del archivo del cliente</span>' : '<span class="xc-capa f">De fábrica</span>';
  }
  /** Una lista editable (planes, prioridades, tipos, estados): nombre y lo suyo, mover, quitar y agregar. */
  function xcLista(lista, titulo, ayuda, columnas, puede, min) {
    var b = XCS.b[lista];
    return '<section class="xs-sec xc-sec" id="xc-' + lista + '"><div class="xc-cab"><h2>' + esc(titulo) + '</h2>' + xcCapa(lista) + '</div><p class="xs-sub">' + ayuda + '</p>' +
      '<ul class="xc-lista"' + xcInvalido(lista) + '>' + b.map(function (x, i) {
        return '<li class="xc-item">' +
          '<label class="xt-campo xc-nombre"><span class="sr-only">Nombre</span><input type="text" maxlength="40" data-xc-l="' + lista + '" data-xc-i="' + i + '" data-xc-k="nombre" value="' + esc(x.nombre) + '"' + (puede ? '' : ' disabled') + xcInvalido(lista + '.' + i) + '></label>' +
          columnas.map(function (col) { return col(x, i); }).join('') +
          (puede ? '<span class="xc-mover"><button class="fx-ico" type="button" data-xc-arriba="' + lista + '|' + i + '" aria-label="Subir ' + esc(x.nombre) + '"' + (i ? '' : ' disabled') + '><i class="ic" data-ic="subir"></i></button>' +
            '<button class="fx-ico" type="button" data-xc-abajo="' + lista + '|' + i + '" aria-label="Bajar ' + esc(x.nombre) + '"' + (i < b.length - 1 ? '' : ' disabled') + '><i class="ic" data-ic="bajar"></i></button>' +
            '<button class="fx-ico xc-quitar" type="button" data-xc-quita="' + lista + '|' + i + '" aria-label="Quitar ' + esc(x.nombre) + '"' + (b.length > min ? '' : ' disabled') + '><i class="ic" data-ic="cerrar"></i></button></span>' : '') +
        '</li>';
      }).join('') + '</ul>' + (puede ? '<button class="btn sm" type="button" data-xc-agrega="' + lista + '"><i class="ic" data-ic="mas"></i>Agregar</button>' : '') + '</section>';
  }
  function xcRegla(id, puede) {
    var g = XCS.conf.reglas.filter(function (x) { return x.id === id; })[0];
    if (!g) return '';
    var v = XCS.reglas[id], dis = puede ? '' : ' disabled', inv = xcInvalido(id);
    var control;
    if (g.tipo === 'si-no') control = '<label class="xc-si"><input type="checkbox" data-xc-r="' + id + '"' + (v ? ' checked' : '') + dis + inv + '><span>' + esc(g.etiqueta) + '</span></label>';
    else if (g.tipo === 'opciones') control = '<label class="xt-campo"><span>' + esc(g.etiqueta) + '</span><select data-xc-r="' + id + '"' + dis + inv + '>' + g.opciones.map(function (o) { return '<option value="' + esc(o.valor) + '"' + (String(v) === o.valor ? ' selected' : '') + '>' + esc(o.etiqueta) + '</option>'; }).join('') + '</select></label>';
    else if (g.tipo === 'lista') control = '<fieldset class="xc-dias"' + inv + '><legend>' + esc(g.etiqueta) + '</legend>' + [1, 2, 3, 4, 5, 6, 0].map(function (d) { return '<label class="xs-dia"><input type="checkbox" data-xc-r="' + id + '" data-xc-v="' + d + '"' + ((v || []).indexOf(d) >= 0 ? ' checked' : '') + dis + '>' + XC_DIAS[d].slice(0, 3) + '</label>'; }).join('') + '</fieldset>';
    else control = '<label class="xt-campo"><span>' + esc(g.etiqueta) + (g.unidad ? ' (' + esc(g.unidad) + ')' : '') + '</span><input type="text"' + (g.tipo === 'numero' ? ' inputmode="decimal"' : '') + ' data-xc-r="' + id + '" value="' + esc(v == null ? '' : v) + '"' + dis + inv + '></label>';
    return '<div class="xc-regla">' + control + '<p class="xc-ayuda">' + esc(g.ayuda) + ' ' + xcCapa(id) + '</p></div>';
  }
  function pintarCfgSla() {
    var caja = $('xc-cfg');
    if (!caja || !XCS.conf || !XCS.b) return;
    var conf = XCS.conf, puede = conf.puedeEditar, b = XCS.b, jornada = conf.jornadaMin;
    var html = '<div class="xc-intro"><p>Todo lo del SLA de este negocio: los planes que se venden, las prioridades, los tipos y los estados de un ticket, los tiempos que se le prometen a cada plan y las reglas con que se miden. ' +
      (conf.tieneArchivo ? 'Este cliente trae su SLA en su archivo de configuración; lo que cambies aquí manda sobre él.' : 'Lo que no se cambia aquí es lo de fábrica.') + '</p>' +
      (puede ? '' : '<p class="xt-nada">Lo ves en lectura: esta configuración la cambia quien administra.</p>') + '</div>';
    html += xcLista('planes', 'Planes de soporte', 'Los que se le venden a los clientes. El plan de cada uno se lee del dato <b>' + esc(XCS.reglas['sla.campoPlan'] || XCS.conf.config.campoPlan) + '</b> de su ficha, por su nombre o por otras formas de escribirlo.', [
      function (x, i) { return '<label class="xt-campo xc-alias"><span class="sr-only">Otras formas de escribirlo</span><input type="text" placeholder="Otras formas de escribirlo, separadas por coma" data-xc-l="planes" data-xc-i="' + i + '" data-xc-k="alias" value="' + esc(x.alias) + '"' + (puede ? '' : ' disabled') + '></label>'; }
    ], puede, 1);
    html += xcLista('prioridades', 'Prioridades', 'De la más grave a la más leve: así se ordenan los tickets y las tablas.', [
      function (x, i) { return '<label class="xt-campo xc-tono"><span class="sr-only">Color</span><select data-xc-l="prioridades" data-xc-i="' + i + '" data-xc-k="tono"' + (puede ? '' : ' disabled') + '>' + XC_TONOS.map(function (t) { return '<option value="' + t[0] + '"' + (t[0] === x.tono ? ' selected' : '') + '>' + t[1] + '</option>'; }).join('') + '</select></label>' + '<span class="xt-prio t-' + esc(x.tono) + '" aria-hidden="true"><i></i>' + esc(x.nombre) + '</span>'; }
    ], puede, 1);
    html += xcLista('tipos', 'Tipos de ticket', 'Qué clase de cosa es: un incidente, una solicitud…', [], puede, 1);
    html += xcLista('estados', 'Estados', 'En orden. Un ticket nuevo empieza en el primero que ni cierra ni pausa. «Cierra» lo da por resuelto; «pausa» para el reloj de la solución mientras se espera al cliente.', [
      function (x, i) { return '<label class="xc-si"><input type="checkbox" data-xc-l="estados" data-xc-i="' + i + '" data-xc-k="cierra"' + (x.cierra ? ' checked' : '') + (puede ? '' : ' disabled') + '><span>Cierra</span></label>'; },
      function (x, i) { return '<label class="xc-si"><input type="checkbox" data-xc-l="estados" data-xc-i="' + i + '" data-xc-k="pausa"' + (x.pausa ? ' checked' : '') + (puede ? '' : ' disabled') + '><span>Pausa el reloj</span></label>'; }
    ], puede, 2);
    // Los tiempos de cada plan × prioridad.
    html += '<section class="xs-sec xc-sec" id="xc-objetivos"><div class="xc-cab"><h2>Tiempos por plan y prioridad</h2>' + xcCapa('objetivos') + '</div>' +
      '<p class="xs-sub">Escribe como <b>45 min</b>, <b>4 h</b> o <b>3 d</b>. Un día hábil es una jornada de soporte (hoy, ' + Math.round(jornada / 60 * 10) / 10 + ' h); en 24/7, un día son 24 horas.</p>' +
      '<div class="xs-tabla"><table class="xs-edit"><thead><tr><th scope="col">Plan · prioridad</th><th scope="col">Primera respuesta</th><th scope="col">Solución</th><th scope="col">Reloj</th></tr></thead><tbody>' +
      b.planes.map(function (pl) {
        return b.prioridades.map(function (p) {
          var o = b.objetivos[pl.id] && b.objetivos[pl.id][p.id];
          if (!o) { b.objetivos[pl.id] = b.objetivos[pl.id] || {}; o = b.objetivos[pl.id][p.id] = { r: '8 h', s: '5 d', reloj: 'habil' }; }
          var k = 'objetivos.' + pl.id + '.' + p.id, dis = puede ? '' : ' disabled';
          return '<tr><th scope="row"><span class="xt-plan">' + esc(pl.nombre || 'Plan sin nombre') + '</span> <span class="xt-prio t-' + esc(p.tono) + '"><i aria-hidden="true"></i>' + esc(p.nombre || 'Sin nombre') + '</span></th>' +
            '<td data-rot="Primera respuesta"><input type="text" aria-label="' + esc(pl.nombre + ' ' + p.nombre + ': primera respuesta') + '" data-xc-o="' + pl.id + '|' + p.id + '|r" value="' + esc(o.r) + '"' + dis + xcInvalido(k + '.respuestaMin') + xcInvalido(k) + '></td>' +
            '<td data-rot="Solución"><input type="text" aria-label="' + esc(pl.nombre + ' ' + p.nombre + ': solución') + '" data-xc-o="' + pl.id + '|' + p.id + '|s" value="' + esc(o.s) + '"' + dis + xcInvalido(k + '.solucionMin') + '></td>' +
            '<td data-rot="Reloj"><select aria-label="' + esc(pl.nombre + ' ' + p.nombre + ': reloj') + '" data-xc-o="' + pl.id + '|' + p.id + '|reloj"' + dis + '><option value="habil"' + (o.reloj !== 'corrido' ? ' selected' : '') + '>Hábil</option><option value="corrido"' + (o.reloj === 'corrido' ? ' selected' : '') + '>24/7</option></select></td></tr>';
        }).join('');
      }).join('') + '</tbody></table></div></section>';
    // Las reglas sueltas, por grupo.
    html += '<section class="xs-sec xc-sec" id="xc-reglas"><div class="xc-cab"><h2>Reglas</h2></div><p class="xs-sub">El horario de soporte, cuándo un ticket está en riesgo, qué cuenta como primera respuesta, de dónde se leen el plan y el producto, y quién puede qué.</p>' +
      '<div class="xc-grupo"><h3>Horario y medición</h3>' + ['sla.horario.dias', 'sla.horario.desde', 'sla.horario.hasta', 'sla.riesgoPct', 'sla.sinPlan'].map(function (id) { return xcRegla(id, puede); }).join('') + '</div>' +
      '<div class="xc-grupo"><h3>Primera respuesta</h3><p class="xc-ayuda">Cuenta lo primero que pase de lo que esté encendido.</p>' + ['sla.primeraRespuesta.delEquipo', 'sla.primeraRespuesta.aMano', 'sla.primeraRespuesta.alResolver'].map(function (id) { return xcRegla(id, puede); }).join('') + '</div>' +
      '<div class="xc-grupo"><h3>Un ticket nuevo</h3>' + ['sla.prioridadDeFabrica', 'sla.tipoDeFabrica', 'sla.campoPlan', 'sla.campoProducto'].map(function (id) { return xcRegla(id, puede); }).join('') + '</div>' +
      '<div class="xc-grupo"><h3>Quién puede qué</h3>' + ['sla.permisos.crear', 'sla.permisos.mover', 'sla.permisos.politicas'].map(function (id) { return xcRegla(id, puede); }).join('') + '</div></section>';
    if (puede) html += '<div class="xc-pie"><p class="xt-msg error" id="xc-msg" role="alert">' + esc(XCS.error || '') + '</p>' +
      (XCS.olvidando
        ? '<span class="xc-seguro">¿Borrar todo lo cambiado aquí y volver a ' + (conf.tieneArchivo ? 'lo del archivo del cliente' : 'lo de fábrica') + '? <button class="btn sm danger" type="button" id="xc-olvidar-si">Sí, volver</button><button class="btn sm" type="button" id="xc-olvidar-no">No</button></span>'
        : '<button class="btn" type="button" id="xc-olvidar">Volver a ' + (conf.tieneArchivo ? 'lo del archivo' : 'lo de fábrica') + '</button>') +
      '<button class="btn" type="button" id="xc-cancelar">Descartar cambios</button><button class="btn primary" type="button" id="xcs-guardar"' + (XCS.guardando ? ' disabled' : '') + '>Guardar</button></div>';
    caja.innerHTML = html;
    iconos(caja);
    xcsEnganchar(caja);
  }
  function xcsEnganchar(caja) {
    var repintar = function () { xcsLeer(); pintarCfgSla(); };
    caja.querySelectorAll('[data-xc-arriba],[data-xc-abajo]').forEach(function (bt) {
      bt.onclick = function () {
        xcsLeer();
        var p = (bt.getAttribute('data-xc-arriba') || bt.getAttribute('data-xc-abajo')).split('|'), l = XCS.b[p[0]], i = Number(p[1]), j = bt.hasAttribute('data-xc-arriba') ? i - 1 : i + 1;
        if (j < 0 || j >= l.length) return;
        var t = l[i]; l[i] = l[j]; l[j] = t;
        pintarCfgSla();
        var otro = caja.querySelector('[data-xc-' + (bt.hasAttribute('data-xc-arriba') ? 'arriba' : 'abajo') + '="' + p[0] + '|' + j + '"]');
        if (otro && !otro.disabled) otro.focus();
      };
    });
    caja.querySelectorAll('[data-xc-quita]').forEach(function (bt) {
      bt.onclick = function () { xcsLeer(); var p = bt.getAttribute('data-xc-quita').split('|'); XCS.b[p[0]].splice(Number(p[1]), 1); pintarCfgSla(); };
    });
    caja.querySelectorAll('[data-xc-agrega]').forEach(function (bt) {
      bt.onclick = function () {
        xcsLeer();
        var l = bt.getAttribute('data-xc-agrega'), lista = XCS.b[l], base = { planes: 'plan', prioridades: 'prioridad', tipos: 'tipo', estados: 'estado' }[l];
        // Un id estable y nuevo: el nombre se escribe después y no lo cambia (los tiempos cuelgan del id).
        var id; do { XCS.nuevo++; id = base + '_' + XCS.nuevo; } while (lista.some(function (x) { return x.id === id; }));
        var nuevo = { id: id, nombre: '' };
        if (l === 'planes') nuevo.alias = '';
        if (l === 'prioridades') nuevo.tono = 'neutro';
        if (l === 'estados') { nuevo.cierra = false; nuevo.pausa = false; }
        lista.push(nuevo);
        pintarCfgSla();
        var inp = caja.querySelector('[data-xc-l="' + l + '"][data-xc-i="' + (lista.length - 1) + '"][data-xc-k="nombre"]');
        if (inp) inp.focus();
      };
    });
    // Un cambio de color se ve enseguida (sin perder lo demás). El nombre no repinta al salir del campo: quitaría el
    // foco a quien va con el teclado; la tabla de tiempos lo toma en el próximo repintado.
    caja.querySelectorAll('[data-xc-k="tono"]').forEach(function (x) { x.addEventListener('change', function () { repintar(); var y = caja.querySelector('[data-xc-l="' + x.getAttribute('data-xc-l') + '"][data-xc-i="' + x.getAttribute('data-xc-i') + '"][data-xc-k="tono"]'); if (y) y.focus(); }); });
    if ($('xc-cancelar')) $('xc-cancelar').onclick = function () { cargarCfgSla(); };
    if ($('xc-olvidar')) $('xc-olvidar').onclick = function () { xcsLeer(); XCS.olvidando = true; pintarCfgSla(); if ($('xc-olvidar-no')) $('xc-olvidar-no').focus(); };
    if ($('xc-olvidar-no')) $('xc-olvidar-no').onclick = function () { XCS.olvidando = false; pintarCfgSla(); if ($('xc-olvidar')) $('xc-olvidar').focus(); };
    if ($('xc-olvidar-si')) $('xc-olvidar-si').onclick = function () {
      api('/sla/config', { method: 'DELETE' }).then(function (r) {
        XCS.olvidando = false;
        if (!r || r.error) { XCS.error = 'No se pudo: ' + ((r && r.error) || 'sin respuesta'); pintarCfgSla(); return; }
        xcTomar(r); pintarCfgSla(); xtTrasCambiarConfig();
        toast('Volvió a ' + (r.tieneArchivo ? 'lo del archivo del cliente' : 'lo de fábrica'), null, { icono: 'check' });
      });
    };
    if ($('xcs-guardar')) $('xcs-guardar').onclick = xcsGuardar;
  }
  function xcsGuardar() {
    xcsLeer();
    var b = XCS.b, conf = XCS.conf;
    // La jornada con que se cuentan los «días»: la del horario que se está guardando.
    var hm = function (s) { var x = /^(\d{1,2}):(\d{2})$/.exec(String(s || '')); return x ? Number(x[1]) * 60 + Number(x[2]) : NaN; };
    var jornada = hm(XCS.reglas['sla.horario.hasta']) - hm(XCS.reglas['sla.horario.desde']);
    if (!(jornada > 0)) jornada = conf.jornadaMin;
    var malo = null, objetivos = {};
    b.planes.forEach(function (pl) {
      objetivos[pl.id] = {};
      b.prioridades.forEach(function (p) {
        var o = b.objetivos[pl.id][p.id], r = xcMinutos(o.r, o.reloj, jornada), s = xcMinutos(o.s, o.reloj, jornada), k = 'objetivos.' + pl.id + '.' + p.id;
        if (!malo && !(r > 0)) malo = { error: (pl.nombre || 'Plan') + ' · ' + (p.nombre || 'prioridad') + ': la primera respuesta va como 45 min, 4 h o 3 d', campo: k + '.respuestaMin' };
        if (!malo && !(s > 0)) malo = { error: (pl.nombre || 'Plan') + ' · ' + (p.nombre || 'prioridad') + ': la solución va como 45 min, 4 h o 3 d', campo: k + '.solucionMin' };
        objetivos[pl.id][p.id] = { respuestaMin: r, solucionMin: s, reloj: o.reloj };
      });
    });
    if (malo) { XCS.error = malo.error; XCS.campo = malo.campo; pintarCfgSla(); xcEnfocar(); return; }
    var estructura = {
      planes: b.planes.map(function (x) { return { id: x.id, nombre: x.nombre.trim(), alias: String(x.alias || '').split(',').map(function (a) { return a.trim(); }).filter(Boolean) }; }),
      prioridades: b.prioridades.map(function (x) { return { id: x.id, nombre: x.nombre.trim(), tono: x.tono }; }),
      tipos: b.tipos.map(function (x) { return { id: x.id, nombre: x.nombre.trim() }; }),
      estados: b.estados.map(function (x) { return { id: x.id, nombre: x.nombre.trim(), cierra: Boolean(x.cierra), pausa: Boolean(x.pausa) }; }),
      objetivos: objetivos
    };
    // Solo las reglas que cambiaron: las demás siguen saliendo de su capa (fábrica o archivo).
    var antes = {}, reglas = {};
    conf.reglas.forEach(function (g) { antes[g.id] = g.ruta.reduce(function (x, k) { return x == null ? x : x[k]; }, conf.config); });
    Object.keys(XCS.reglas).forEach(function (id) { if (JSON.stringify(XCS.reglas[id]) !== JSON.stringify(antes[id])) reglas[id] = XCS.reglas[id]; });
    XCS.guardando = true;
    $('xcs-guardar').disabled = true;
    api('/sla/config', { method: 'PUT', body: { estructura: estructura, reglas: reglas } }).then(function (r) {
      XCS.guardando = false;
      if (!r || r.error) { XCS.error = 'No se guardó: ' + ((r && r.error) || 'el servidor no contestó'); XCS.campo = (r && r.campo) || null; pintarCfgSla(); xcEnfocar(); return; }
      xcTomar(r); pintarCfgSla(); xtTrasCambiarConfig();
      toast('SLA y tickets guardados: los tickets se miden así desde ya', null, { icono: 'check' });
    }).catch(function () { XCS.guardando = false; XCS.error = 'No hubo conexión con el servidor: nada se guardó.'; pintarCfgSla(); });
  }
  function xcEnfocar() { var x = $('xc-cfg').querySelector('[aria-invalid="true"]') || $('xc-msg'); if (x) { if (x.scrollIntoView) x.scrollIntoView({ block: 'center' }); if (x.focus) x.focus(); } }
  /** Lo que se pinta con la configuración vieja se vuelve a pedir. */
  function xtTrasCambiarConfig() { XT.cfg = null; XT.contactos = null; if (XT.datos) cargarTickets(); if (XS.datos) cargarSla(true); }
  // (fin de XEN · Tickets y SLA)

  // ===== XEN · Prospectos: Ventas › Prospectos (alAbrir('prospectos', …)) =====
  // Quien dejó sus datos en el registro de la portada o de la puerta de la consola (crm/prospectos.ts). Entra como
  // ficha de WhatsApp y además queda aquí, con su estado, hasta que alguien lo atienda: escribirle, marcarlo
  // contactado, pasarlo al embudo o descartarlo. Las cifras de arriba filtran, como en Tickets.
  var XP = { datos: null, cargando: false, error: null, estado: 'nuevo' };
  var XP_ESTADOS = [['nuevo', 'Nuevos', 'esperan que les escribas', 'prospecto', 'acento'], ['contactado', 'Contactados', 'ya les escribieron', 'burbuja', 'neutro'], ['en_embudo', 'En el embudo', 'pasaron a Tratos', 'kanban', 'verde'], ['descartado', 'Descartados', 'no era para ahora', 'cerrar', 'neutro']];
  var XP_NOMBRE = { nuevo: 'Nuevo', contactado: 'Contactado', en_embudo: 'En el embudo', descartado: 'Descartado' };
  var XP_INTERES = { ventas: 'Quiere vender', soporte: 'Quiere soporte', cotizacion: 'Quiere cotizar' };
  var XP_DESDE = { portada: 'la portada', consola: 'la puerta de la consola' };
  try { XP.estado = localStorage.getItem(LLAVE('prospectos.estado')) || 'nuevo'; } catch (e) {}
  /** «573104567890» → «+57 310 456 7890»; lo que no tiene esa forma, con su + delante. */
  function xpNumero(n) {
    var d = String(n || '').replace(/\D/g, '');
    if (/^57\d{10}$/.test(d)) return '+57 ' + d.slice(2, 5) + ' ' + d.slice(5, 8) + ' ' + d.slice(8);
    return d ? '+' + d : '';
  }
  function xpCuenta(d) { var n = d && d.cuentas ? d.cuentas.nuevo : 0; if ($('fx-n-prospectos')) $('fx-n-prospectos').textContent = n ? String(n) : ''; }

  function cargarProspectos() {
    if (XP.cargando) return;
    var caja = $('xp-prospectos');
    if (!caja) return;
    XP.cargando = true;
    caja.setAttribute('aria-busy', 'true');
    if (!XP.datos) caja.innerHTML = '<div class="xt-cifras">' + [1, 2, 3, 4].map(function () { return '<div class="xt-cifra xt-esq" aria-hidden="true"><i></i><i></i></div>'; }).join('') + '</div>' +
      '<ul class="xt-lista">' + [1, 2, 3].map(function () { return '<li class="xt-fila xt-esq" aria-hidden="true"><i></i><i></i></li>'; }).join('') + '</ul>';
    api('/prospectos').then(function (d) {
      XP.cargando = false;
      caja.removeAttribute('aria-busy');
      if (!d || d.error || !d.prospectos) { XP.error = (d && d.error) || 'el servidor no contestó'; pintarProspectos(); return; }
      XP.error = null;
      XP.datos = d;
      xpCuenta(d);
      pintarProspectos();
    }).catch(function (e) {
      XP.cargando = false;
      caja.removeAttribute('aria-busy');
      if (String(e && e.message) === '401') return;
      XP.error = 'no hubo conexión con el servidor';
      pintarProspectos();
    });
  }
  alAbrir('prospectos', cargarProspectos);
  // La cuenta del menú, al arrancar y cada minuto: quien llega no espera a que alguien abra la pantalla.
  function xpSoloCuenta() { if (!document.hidden && state.token) api('/prospectos?estado=nuevo').then(function (d) { if (d && d.cuentas) xpCuenta(d); }).catch(function () {}); }
  setTimeout(xpSoloCuenta, 1500);
  setInterval(function () { if (state.view === 'prospectos' && XP.datos) cargarProspectos(); else xpSoloCuenta(); }, 60000);

  function xpFilaHtml(p) {
    var nombre = p.nombre || xpNumero(p.telefono) || 'Sin nombre';
    var acciones = [];
    if (p.estado === 'nuevo') acciones.push(['contactado', 'Marcar contactado']);
    if (p.estado === 'nuevo' || p.estado === 'contactado') acciones.push(['en_embudo', 'Pasar al embudo'], ['descartado', 'Descartar']);
    if (p.estado === 'descartado' || p.estado === 'en_embudo') acciones.push(['nuevo', 'Volver a nuevos']);
    return '<li class="xt-fila xp-fila" data-xp="' + esc(p.id) + '">' +
      '<div class="xt-f-cab"><span class="xp-quien">' + avatarHtml(nombre, p.id, 'sm') + '<b>' + esc(nombre) + '</b>' + (p.empresa ? '<span class="xp-empresa">' + esc(p.empresa) + '</span>' : '') + '</span>' +
        '<span class="xt-estado' + (p.estado === 'descartado' ? ' fin' : '') + '">' + esc(XP_NOMBRE[p.estado] || p.estado) + '</span></div>' +
      '<div class="xp-datos">' + (p.telefono ? '<span><i class="ic" data-ic="burbuja" aria-hidden="true"></i>' + esc(xpNumero(p.telefono)) + '</span>' : '') +
        (p.interes ? '<span class="xp-interes">' + esc(XP_INTERES[p.interes] || p.interes) + '</span>' : '') +
        '<span class="xp-cuando">Se registró en ' + esc(XP_DESDE[p.desde] || p.desde) + ' · hace ' + esc(rel(p.ultimoRegistro)) + (p.veces > 1 ? ' · ' + p.veces + ' veces' : '') + '</span></div>' +
      '<div class="xp-acciones"><button class="btn sm primary" type="button" data-xp-chat><i class="ic" data-ic="burbuja"></i>Escribirle</button>' +
        acciones.map(function (a) { return '<button class="btn sm" type="button" data-xp-a="' + a[0] + '">' + esc(a[1]) + '</button>'; }).join('') + '</div>' +
    '</li>';
  }

  function pintarProspectos() {
    var caja = $('xp-prospectos');
    if (!caja) return;
    if (XP.error && !XP.datos) {
      caja.innerHTML = '<div class="xt-error" role="alert"><b>No se pudieron cargar los prospectos</b><span>' + esc(XP.error) + '. Los registros siguen guardados.</span><button class="btn sm" type="button" id="xp-reintentar">Volver a intentar</button></div>';
      $('xp-reintentar').onclick = function () { XP.error = null; cargarProspectos(); };
      return;
    }
    var d = XP.datos;
    if (!d) return;
    var html = '<div class="xt-cifras">' + XP_ESTADOS.map(function (x) {
      var n = d.cuentas[x[0]] || 0;
      return '<button type="button" class="xt-cifra t-' + (n ? x[4] : 'neutro') + '" data-xp-estado="' + x[0] + '" aria-pressed="' + (XP.estado === x[0]) + '">' +
        '<span class="xt-cifra-cab"><span>' + esc(x[1]) + '</span><i class="ic" data-ic="' + x[3] + '"></i></span><b>' + n + '</b><small>' + esc(x[2]) + '</small></button>';
    }).join('') + '</div>';
    if (!d.prospectos.length) {
      html += '<section class="xt-vacio"><span class="xt-vacio-ic"><i class="ic" data-ic="prospecto"></i></span><div><h2>Aquí llega quien quiere probar ' + esc(state.bizName || 'tu negocio') + '</h2>' +
        '<p>Cuando alguien deja su nombre y su WhatsApp en el registro de tu página, aparece aquí al instante, con su ficha lista para escribirle.</p></div></section>';
      caja.innerHTML = html;
      xpEnganchar(caja);
      return;
    }
    var lista = d.prospectos.filter(function (p) { return p.estado === XP.estado; });
    html += lista.length
      ? '<ul class="xt-lista" aria-label="Prospectos">' + lista.map(xpFilaHtml).join('') + '</ul>'
      : '<div class="xt-sin"><b>Ninguno ' + esc((XP_NOMBRE[XP.estado] || '').toLowerCase()) + ' por ahora</b><span>Hay ' + d.cuentas.nuevo + (d.cuentas.nuevo === 1 ? ' nuevo' : ' nuevos') + '.</span><button class="btn sm" type="button" id="xp-ver-nuevos">Ver los nuevos</button></div>';
    caja.innerHTML = html;
    xpEnganchar(caja);
  }

  function xpEnganchar(caja) {
    iconos(caja);
    caja.querySelectorAll('[data-xp-estado]').forEach(function (b) {
      b.onclick = function () { XP.estado = b.getAttribute('data-xp-estado'); try { localStorage.setItem(LLAVE('prospectos.estado'), XP.estado); } catch (e) {} pintarProspectos(); };
    });
    if ($('xp-ver-nuevos')) $('xp-ver-nuevos').onclick = function () { XP.estado = 'nuevo'; pintarProspectos(); };
    caja.querySelectorAll('[data-xp]').forEach(function (li) {
      var id = li.getAttribute('data-xp');
      li.querySelector('[data-xp-chat]').onclick = function () { go('inbox'); openContact(id); };
      li.querySelectorAll('[data-xp-a]').forEach(function (b) {
        b.onclick = function () {
          var estado = b.getAttribute('data-xp-a');
          b.disabled = true;
          api('/prospectos/' + encodeURIComponent(id), { method: 'PATCH', body: { estado: estado } }).then(function (r) {
            if (!r || r.error) { b.disabled = false; toast('No se pudo: ' + ((r && r.error) || 'sin respuesta del servidor')); return; }
            toast((r.nombre || 'El prospecto') + ': ' + (XP_NOMBRE[estado] || estado).toLowerCase(), null, { icono: 'check' });
            cargarProspectos();
          }).catch(function () { b.disabled = false; toast('No se pudo: no hubo conexión con el servidor'); });
        };
      });
    });
  }
  // (fin de XEN · Prospectos)

  // ===== XEN · Configuración en dos paneles =====
  // Al elegir Configuración el menú se queda en íconos y aparecen dos paneles: a la izquierda las funciones —en
  // grupos, con lo que trae cada una en una línea y un buscador— y a la derecha la función elegida, siempre en la
  // misma página. Antes unas opciones eran pantallas y otras un diálogo encima (El negocio y Perfil), que además
  // se quedaba abierto al cambiar de opción.
  //
  // 🪤 El panel es la columna #subnav que ya existía (pintarPanel la muestra solo en las vistas de CFG_VIEWS), no una
  // vista que envuelva a las otras: go() prende y apaga TODAS las .view, y una dentro de otra se apagaba sola.
  var XCFG_GRUPOS = [['El negocio', ['guia', 'profile', 'negocio']], ['El asistente y la IA', ['agent', 'modelos', 'knowledge']], ['Canales', ['channels']], ['Servicio', ['cfg-sla', 'cfg-mantenimientos']], ['Sistema', ['reglas', 'trazas', 'modo-equipo-btn', 'help']]];
  var XCFG_DICE = {
    guia: ['Los pasos para dejar listo al asistente', 'empezar pasos inicio'],
    profile: ['Contacto, horario, dirección, pagos y políticas', 'whatsapp telefono correo direccion horario pagos precios politicas instagram'],
    negocio: ['Nombre, cómo habla el asistente y cómo agenda', 'nombre pais moneda saludo estilo agenda dias horas sedes'],
    agent: ['Qué hace y cuándo te pasa la conversación', 'asistente respuestas persona traspaso sugerencias'],
    modelos: ['Qué IA hace cada tarea y cuánto cuesta', 'ia openai claude gemini ollama modelo costo tope gasto'],
    knowledge: ['Catálogo, documentos y lo que ha aprendido', 'catalogo productos precios documentos conocimiento aprender diccionario'],
    channels: ['WhatsApp, el chat de tu sitio y cómo se conectan', 'whatsapp chat web widget qr meta grupos'],
    'cfg-sla': ['Planes, prioridades, estados y tiempos garantizados', 'tickets sla planes prioridades estados objetivos horario soporte'],
    'cfg-mantenimientos': ['Cada cuánto, con cuánto aviso y quién programa', 'mantenimientos actualizaciones aviso cadencia'],
    reglas: ['Los números que deciden algo del negocio', 'reglas umbrales puntaje caliente cuenta clave'],
    trazas: ['Las llamadas a la IA, sus tiempos y su costo', 'trazas costos tokens tiempos'],
    'modo-equipo-btn': ['Con candado: el equipo atiende y nada más', 'modo facil candado equipo'],
    help: ['Cómo se usa, paso a paso', 'ayuda manual']
  };
  var xcfgLlano = function (t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); };
  /** El árbol de funciones, en `caja` (#subnav-cfg). `lista` ya viene filtrada por quién puede ver qué. */
  function xcfgArmar(caja, lista) {
    var porClave = {};
    lista.forEach(function (d) { porClave[d.view || d.proxy] = d; });
    var cab = document.createElement('div');
    cab.className = 'xcfg-cab';
    cab.innerHTML = '<b class="xcfg-titulo" id="xcfg-titulo">Configuración</b>' +
      '<label class="xcfg-buscar"><span class="sr-only">Buscar un ajuste</span><input type="search" id="xcfg-q" placeholder="Buscar un ajuste" autocomplete="off" aria-describedby="xcfg-nada"></label>';
    caja.appendChild(cab);
    var arbol = document.createElement('nav');
    arbol.className = 'xcfg-arbol';
    arbol.setAttribute('aria-labelledby', 'xcfg-titulo');
    var usados = {};
    var grupos = XCFG_GRUPOS.map(function (g) { return [g[0], g[1].filter(function (k) { return porClave[k]; })]; });
    var resto = Object.keys(porClave).filter(function (k) { return !XCFG_GRUPOS.some(function (g) { return g[1].indexOf(k) >= 0; }); });
    if (resto.length) grupos.push(['Más', resto]);
    grupos.forEach(function (g, n) {
      if (!g[1].length) return;
      var grupo = document.createElement('div');
      grupo.className = 'xcfg-grupo';
      grupo.setAttribute('role', 'group');
      grupo.setAttribute('aria-labelledby', 'xcfg-g' + n);
      grupo.innerHTML = '<span class="xcfg-grupo-t" id="xcfg-g' + n + '">' + esc(g[0]) + '</span>';
      g[1].forEach(function (k) {
        var d = porClave[k], dice = XCFG_DICE[k] || ['', ''];
        usados[k] = 1;
        var b = itemCfg(d, 'item xcfg-item');
        b.innerHTML = '<i class="ic" data-ic="' + d.ic + '"></i><span class="xcfg-txt"><span class="xcfg-lbl">' + esc(d.lbl) + '</span>' + (dice[0] ? '<small>' + esc(dice[0]) + '</small>' : '') + '</span>' +
          (d.modo ? '<span class="estado-modo" data-modo-estado="' + d.modo + '"></span>' : '');
        b.setAttribute('data-busca', xcfgLlano(d.lbl + ' ' + dice[0] + ' ' + dice[1] + ' ' + g[0]));
        grupo.appendChild(b);
      });
      arbol.appendChild(grupo);
    });
    caja.appendChild(arbol);
    var nada = document.createElement('p');
    nada.className = 'xcfg-nada';
    nada.id = 'xcfg-nada';
    nada.setAttribute('role', 'status');
    caja.appendChild(nada);
    var q = cab.querySelector('#xcfg-q');
    q.addEventListener('input', function () {
      var t = xcfgLlano(q.value).trim(), hay = 0;
      arbol.querySelectorAll('.xcfg-grupo').forEach(function (g) {
        var visibles = 0;
        g.querySelectorAll('.xcfg-item').forEach(function (b) { var si = !t || b.getAttribute('data-busca').indexOf(t) >= 0; b.hidden = !si; if (si) visibles++; });
        g.hidden = !visibles;
        hay += visibles;
      });
      nada.textContent = t && !hay ? 'Nada con «' + q.value.trim() + '». Prueba con otra palabra: WhatsApp, horario, IA…' : '';
    });
    // Escape limpia la búsqueda; Enter abre la primera que quedó.
    q.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && q.value) { q.value = ''; q.dispatchEvent(new Event('input')); }
      if (e.key === 'Enter') { var primera = arbol.querySelector('.xcfg-item:not([hidden])'); if (primera) primera.click(); }
    });
  }
  /** En Configuración el menú de la izquierda se queda en íconos (si cabe), y al salir vuelve a como lo tenía cada quien. */
  function xcfgRiel(area) {
    var app = document.querySelector('.app');
    if (!app) return;
    if (area === 'config') {
      if (!app.hasAttribute('data-mapa-antes')) app.setAttribute('data-mapa-antes', app.getAttribute('data-mapa') || 'largo');
      app.setAttribute('data-mapa', 'corto');
    } else if (app.hasAttribute('data-mapa-antes')) {
      app.setAttribute('data-mapa', app.getAttribute('data-mapa-antes'));
      app.removeAttribute('data-mapa-antes');
    }
  }
  // El negocio y Perfil salen del diálogo a su pantalla. Se mueven los mismos nodos (#negocio, #profile): todo lo que
  // los llena (loadNegocio, renderProfile…) sigue funcionando igual.
  (function () {
    [['negocio', 'vista-negocio'], ['profile', 'vista-profile']].forEach(function (x) {
      var panel = $(x[0]), destino = $(x[1]);
      if (panel && destino) { destino.appendChild(panel); panel.hidden = false; }
    });
  })();
  alAbrir('negocio', function () { loadNegocio(); });
  alAbrir('profile', function () { loadProfile(); });
  // (fin de XEN · Configuración en dos paneles)

  // ===== XEN · Mantenimientos y actualizaciones: lo nuevo de su agente (alAbrir('mantenimientos', …)) =====
  // Servicio › Mantenimientos y actualizaciones: lo que se va a tocar, a quién afecta y si se le avisó a tiempo. Lo
  // calcula el servidor (crm/mantenimientos.ts) sin modelo: aquí se pinta, se programa y se prepara el aviso.
  //
  // 🪤 El aviso NUNCA sale solo. «Preparar aviso» deja el mensaje escrito en la conversación de cada cliente (como lo
  // que XENCRM deja listo) y alguien lo lee y lo manda; cuenta como dado cuando de verdad salió. Por eso aquí se dice
  // «Preparado: falta mandarlo» y «No salió», y no «Avisado» hasta que el mensaje llegó.
  //
  // 🪤 Las fechas van en la hora del NEGOCIO (la zona que manda el servidor), no en la del navegador: quien programa
  // desde otro país vería la ventana corrida. El campo de fecha se lee y se escribe en esa zona (xuEnZona).
  //
  // 🪤 Lo que se escribe en el formulario NO se borra si guardar falla: queda en XU.borrador y el error va junto al
  // campo que lo causó.
  var XU = { datos: null, cargando: false, error: null, dias: 30, abiertos: {}, form: null, borrador: null, errorForm: null, guardando: false, cancelando: {}, preparando: {} };
  var XU_AVISO = {
    a_tiempo: ['A tiempo', 'check', 'verde'], tarde: ['Avisado tarde', 'reloj', 'ambar'], preparado: ['Preparado: falta mandarlo', 'enviar', 'cielo'],
    no_salio: ['No salió: reinténtalo', 'alerta', 'rojo'], por_avisar: ['Por avisar', 'bell', 'neutro'], atrasado: ['Atrasado: avisar ya', 'alerta', 'rojo'], sin_aviso: ['Sin aviso', 'alerta', 'rojo']
  };
  ICONS.llave = ICONS.llave || '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>';
  ICONS.paquete = '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>';

  function xuZona() { return (XU.datos && XU.datos.zona) || undefined; }
  function xuFmt(ts, o) { try { return new Intl.DateTimeFormat('es-CO', Object.assign({ timeZone: xuZona() }, o)).format(ts); } catch (e) { return new Date(ts).toLocaleString('es-CO', o); } }
  function xuDia(ts) { return xuFmt(ts, { weekday: 'long', day: 'numeric', month: 'long' }); }
  function xuHora(ts) { return xuFmt(ts, { hour: 'numeric', minute: '2-digit' }); }
  function xuCuando(ts) { return xuFmt(ts, { weekday: 'short', day: 'numeric', month: 'short' }) + ', ' + xuHora(ts); }
  function xuEn(ts) {
    var d = ts - Date.now(), abs = Math.abs(d), h = Math.round(abs / 3600000), dias = Math.round(abs / 86400000);
    var t = abs < 3600000 ? Math.max(1, Math.round(abs / 60000)) + ' min' : h < 48 ? h + ' h' : dias + ' días';
    return d >= 0 ? 'en ' + t : 'hace ' + t;
  }
  /** La pared del reloj del negocio («2026-12-13T23:00») a un instante, sin importar la zona del navegador. */
  function xuEnZona(valor) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(valor || '');
    if (!m) return NaN;
    var supuesto = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    var zona = xuZona();
    if (!zona) return new Date(valor).getTime();
    // Lo que esa zona marca en el instante supuesto; la diferencia es su desfase (dos pasadas por si cambia la hora).
    var desfase = function (ts) {
      var p = {};
      new Intl.DateTimeFormat('en-US', { timeZone: zona, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(ts).forEach(function (x) { p[x.type] = x.value; });
      return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - ts;
    };
    var ts = supuesto - desfase(supuesto);
    return supuesto - desfase(ts);
  }
  /** Un instante en la pared del reloj del negocio, para el campo datetime-local. */
  function xuAZona(ts) {
    var p = {};
    try { new Intl.DateTimeFormat('en-US', { timeZone: xuZona(), hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(ts).forEach(function (x) { p[x.type] = x.value; }); } catch (e) { return ''; }
    return p.year + '-' + p.month + '-' + p.day + 'T' + (p.hour === '24' ? '00' : p.hour) + ':' + p.minute;
  }
  /** Programar es de quien diga la regla `mant.quienPrograma` (de fábrica, quien administra XENCRM). El servidor lo cumple igual. */
  function xuPuedeProgramar() { return (XU.datos && XU.datos.quienPrograma === 'equipo') || mandaEnElModo(); }
  function xuPlan(id) { var p = ((XU.datos && XU.datos.planes) || []).filter(function (x) { return x.id === id; })[0]; return p ? p.nombre : id; }
  function xuNombreEstadoAct(id) { var e = ((XU.datos && XU.datos.estadosActualizacion) || []).filter(function (x) { return x.id === id; })[0]; return e ? e.nombre : id; }
  function xuHoras(h) { return h % 24 === 0 && h >= 48 ? (h / 24) + ' días' : h + ' h'; }
  function xuAvisosDePlanes() { return ((XU.datos && XU.datos.planes) || []).map(function (p) { return p.nombre + ' ' + xuHoras(p.avisoHoras); }).join(', '); }
  function xuPill(estado, texto) {
    var a = XU_AVISO[estado] || ['—', 'reloj', 'neutro'];
    return '<span class="xu-pill t-' + a[2] + '"><i class="ic" data-ic="' + a[1] + '"></i>' + esc(texto || a[0]) + '</span>';
  }

  function cargarMantenimientos() {
    if (XU.cargando) return;
    var caja = $('xu-mant');
    if (!caja) return;
    XU.cargando = true;
    caja.setAttribute('aria-busy', 'true');
    // Cargando: la forma de lo que viene, para que nada salte al llegar.
    if (!XU.datos) caja.innerHTML = '<div class="xu-cifras">' + [1, 2, 3, 4].map(function () { return '<div class="xu-cifra xu-esq" aria-hidden="true"><i></i><i></i></div>'; }).join('') + '</div>' +
      '<div class="xu-lista">' + [1, 2].map(function () { return '<div class="xu-mant xu-esq" aria-hidden="true"><i></i><i></i><i></i></div>'; }).join('') + '</div>';
    api('/mantenimientos' + (XU.diasElegido ? '?dias=' + XU.dias : '')).then(function (d) {
      XU.cargando = false;
      caja.removeAttribute('aria-busy');
      if (!d || d.error) { XU.error = (d && d.error) || 'el servidor no contestó'; pintarMantenimientos(); return; }
      XU.error = null;
      XU.datos = d;
      if (!XU.diasElegido) XU.dias = d.periodoDias;
      pintarMantenimientos();
    }).catch(function (e) {
      XU.cargando = false;
      caja.removeAttribute('aria-busy');
      if (String(e && e.message) === '401') return;
      XU.error = 'no hubo conexión con el servidor';
      pintarMantenimientos();
    });
  }
  alAbrir('mantenimientos', cargarMantenimientos);

  /** El estado del aviso de un mantenimiento, dicho como se actúa. */
  function xuAvisoDe(m) {
    var r = m.resumen;
    if (m.momento === 'cancelado') return '<span class="xu-pill t-neutro"><i class="ic" data-ic="cerrar"></i>Cancelado</span>';
    if (!r.afectados) return '<span class="xu-pill t-neutro"><i class="ic" data-ic="user"></i>Sin clientes afectados</span>';
    var faltan = r.porAvisar + r.atrasados + r.preparados + r.noSalio;
    if (m.momento === 'proximo' && faltan) {
      if (r.atrasados) return xuPill('atrasado', 'Avisar ya: ' + r.atrasados + (r.atrasados === 1 ? ' fuera de plazo' : ' fuera de plazo'));
      if (r.noSalio) return xuPill('no_salio', r.noSalio === 1 ? '1 aviso no salió' : r.noSalio + ' avisos no salieron');
      if (r.porAvisar) return xuPill('por_avisar', 'Avisar antes del ' + xuCuando(m.proximoPlazo));
      return xuPill('preparado', r.preparados === 1 ? '1 aviso por mandar' : r.preparados + ' avisos por mandar');
    }
    if (r.sinAviso) return xuPill('sin_aviso', 'Sin aviso: ' + r.sinAviso + ' de ' + r.afectados);
    if (r.tarde) return xuPill('tarde', 'Avisados ' + r.avisados + ' de ' + r.afectados + ' · ' + r.tarde + ' tarde');
    return xuPill('a_tiempo', 'Avisados ' + r.avisados + ' de ' + r.afectados + ', a tiempo');
  }

  function xuAfectado(m, a) {
    var detalle = a.avisado
      ? (a.como === 'mensaje' ? 'Le llegó el aviso ' : a.como === 'preparado' ? 'Cuenta como avisado desde que se preparó, ' : 'Avisado por otro medio ') + xuCuando(a.avisado) + (a.por && a.por !== 'demostración' ? ' · ' + esc(a.por) : '')
      : a.estado === 'preparado' ? 'Está escrito en su conversación: ábrela, léelo y mándalo'
      : a.estado === 'no_salio' ? 'Se mandó y no le llegó: reinténtalo desde su conversación'
      : a.estado === 'sin_aviso' ? 'El mantenimiento empezó y nunca se le avisó'
      : a.estado === 'atrasado' ? 'Su plan pedía avisar antes del ' + xuCuando(a.plazo) + ': avísale ya'
      : 'Su plan (' + esc(a.planNombre) + ') pide avisar antes del ' + xuCuando(a.plazo);
    var acciones = '';
    if (m.momento === 'proximo' || m.momento === 'en_curso') {
      acciones += '<button type="button" class="btn sm" data-xu-chat="' + esc(a.id) + '"><i class="ic" data-ic="burbuja"></i>Abrir chat</button>';
      if (!a.avisado && m.momento === 'proximo') acciones += '<button type="button" class="btn sm" data-xu-avisado="' + esc(a.id) + '" data-xu-m="' + m.id + '" title="Le avisaste por correo, llamada u otro medio">Ya le avisé</button>';
    }
    return '<li class="xu-af"><span class="xu-af-quien">' + avatarHtml(a.nombre, a.id, 'sm') + '<span class="xu-af-nom"><b>' + esc(a.nombre) + '</b>' +
      (a.empresa ? '<small>' + esc(a.empresa) + '</small>' : '') + '</span></span>' +
      '<span class="xu-plan">' + esc(a.planNombre) + '</span>' +
      '<span class="xu-af-estado">' + xuPill(a.estado) + '<small>' + detalle + '</small></span>' +
      (acciones ? '<span class="xu-af-acc">' + acciones + '</span>' : '') + '</li>';
  }

  function xuTarjeta(m) {
    var abierto = XU.abiertos[m.id] !== undefined ? XU.abiertos[m.id] : (m.momento !== 'pasado' && m.momento !== 'cancelado' && (m.resumen.porAvisar + m.resumen.atrasados + m.resumen.noSalio) > 0);
    var faltan = m.resumen.porAvisar + m.resumen.atrasados;
    var puede = xuPuedeProgramar();
    var mismoDia = xuFmt(m.inicio, { day: 'numeric', month: 'numeric' }) === xuFmt(m.fin, { day: 'numeric', month: 'numeric' });
    var ventana = xuDia(m.inicio) + ', ' + xuHora(m.inicio) + ' – ' + (mismoDia ? '' : xuDia(m.fin) + ', ') + xuHora(m.fin);
    var dur = m.duracionMin >= 60 ? (m.duracionMin % 60 ? (m.duracionMin / 60).toFixed(1).replace('.', ',') + ' h' : m.duracionMin / 60 + ' h') : m.duracionMin + ' min';
    var acciones = '';
    if (m.momento === 'proximo' && faltan) acciones += '<button type="button" class="btn sm primary" data-xu-preparar="' + m.id + '"' + (XU.preparando[m.id] ? ' disabled' : '') + '><i class="ic" data-ic="enviar"></i>' + (XU.preparando[m.id] ? 'Preparando…' : 'Preparar aviso (' + faltan + ')') + '</button>';
    if (puede && m.momento !== 'cancelado') {
      acciones += '<button type="button" class="btn sm" data-xu-editar="' + m.id + '"><i class="ic" data-ic="lapiz"></i>Editar</button>';
      if (m.momento === 'en_curso' || (m.momento === 'pasado' && m.papel !== 'hecho')) acciones += '<button type="button" class="btn sm" data-xu-hecho="' + m.id + '"><i class="ic" data-ic="check"></i>Marcar hecho</button>';
      if (m.momento === 'proximo') acciones += XU.cancelando[m.id]
        ? '<span class="xu-confirma" role="group" aria-label="Confirmar la cancelación">¿Cancelarlo? <button type="button" class="btn sm danger" data-xu-cancelar-si="' + m.id + '">Sí, cancelar mantenimiento</button><button type="button" class="btn sm" data-xu-cancelar-no="' + m.id + '">No</button></span>'
        : '<button type="button" class="btn sm" data-xu-cancelar="' + m.id + '">Cancelar</button>';
    }
    var estados = (XU.datos && XU.datos.estadosMantenimiento) || [];
    var nombreEstado = function (papel) { var e = estados.filter(function (x) { return x.id === m.estado && x.papel === papel; })[0] || estados.filter(function (x) { return x.papel === papel; })[0]; return e ? e.nombre : papel; };
    var momento = m.momento === 'en_curso' ? '<span class="xu-momento en-curso">' + esc(nombreEstado('en_curso')) + '</span>' : m.momento === 'proximo' ? '<span class="xu-momento">' + esc(xuEn(m.inicio)) + '</span>' : m.momento === 'cancelado' ? '<span class="xu-momento">' + esc(nombreEstado('cancelado')) + '</span>' : '<span class="xu-momento">' + (m.papel === 'hecho' ? esc(nombreEstado('hecho')) : 'Terminó, sin cerrar') + '</span>';
    return '<article class="xu-mant m-' + m.momento + '" data-xu-id="' + m.id + '">' +
      '<div class="xu-fecha" aria-hidden="true"><b>' + esc(xuFmt(m.inicio, { day: 'numeric' })) + '</b><span>' + esc(xuFmt(m.inicio, { month: 'short' }).replace('.', '')) + '</span><small>' + esc(xuHora(m.inicio)) + '</small></div>' +
      '<div class="xu-cuerpo"><div class="xu-cab"><h3>' + esc(m.titulo) + '</h3>' + momento + '</div>' +
        '<p class="xu-ventana"><i class="ic" data-ic="calendar"></i><span>' + esc(ventana) + ' <small>(' + esc(dur) + ')</small></span></p>' +
        '<p class="xu-etiquetas">' + (m.producto ? '<span class="xu-prod"><i class="ic" data-ic="paquete"></i>' + esc(m.producto) + '</span>' : '<span class="xu-prod">Todas las aplicaciones</span>') +
          m.planes.map(function (p) { return '<span class="xu-plan">' + esc(xuPlan(p)) + '</span>'; }).join('') + '</p>' +
        (m.notas ? '<p class="xu-notas">' + esc(m.notas) + '</p>' : '') +
        '<div class="xu-aviso">' + xuAvisoDe(m) +
          (m.resumen.afectados ? '<button type="button" class="xu-ver" aria-expanded="' + Boolean(abierto) + '" data-xu-ver="' + m.id + '">' + (m.resumen.afectados === 1 ? '1 cliente afectado' : m.resumen.afectados + ' clientes afectados') + '<i class="ic" data-ic="abajo"></i></button>' : '') + '</div>' +
        (m.resumen.afectados && abierto ? '<ul class="xu-afectados">' + m.afectados.map(function (a) { return xuAfectado(m, a); }).join('') + '</ul>' : '') +
        (acciones ? '<div class="xu-acc">' + acciones + '</div>' : '') +
      '</div></article>';
  }

  function xuProducto(p) {
    var u = p.ultima;
    var estado = p.alDia === null ? '<span class="xu-pill t-neutro"><i class="ic" data-ic="reloj"></i>Sin publicadas: no se puede medir</span>'
      : p.alDia ? '<span class="xu-pill t-verde"><i class="ic" data-ic="check"></i>Al día</span>'
      : '<span class="xu-pill t-rojo"><i class="ic" data-ic="alerta"></i>Atrasada: ' + p.diasDesdeLaUltima + ' días sin publicar</span>';
    var cad = 'Cadencia: cada ' + p.cadenciaDias + (p.cadenciaDias === 1 ? ' día' : ' días') + (p.toleranciaDias ? ' (+' + p.toleranciaDias + ' de gracia)' : '');
    return '<article class="xu-prod-c' + (p.alDia === false ? ' atrasado' : '') + '">' +
      '<div class="xu-prod-cab"><h3>' + esc(p.producto) + '</h3>' + estado + '</div><p class="xu-cad">' + esc(cad) + '</p>' +
      '<dl class="xu-prod-dl">' +
        '<div><dt>Última</dt><dd>' + (u ? '<b>v' + esc(u.version) + '</b> · ' + esc(xuFmt(u.fecha, { day: 'numeric', month: 'short', year: 'numeric' })) + ' <small>(' + esc(p.diasDesdeLaUltima === 0 ? 'hoy' : 'hace ' + p.diasDesdeLaUltima + (p.diasDesdeLaUltima === 1 ? ' día' : ' días')) + ')</small>' : '<span class="xu-nada">—</span>') + '</dd></div>' +
        '<div><dt>Próxima</dt><dd>' + (p.proxima ? '<b>v' + esc(p.proxima.version) + '</b> · ' + esc(xuFmt(p.proxima.fecha, { day: 'numeric', month: 'short' })) + ' <small>(planeada)</small>' : '<span class="xu-nada">Ninguna planeada</span>') + '</dd></div>' +
      '</dl>' +
      (u && u.notas ? '<p class="xu-notas">' + esc(u.notas) + '</p>' : '') +
      (p.historial.length > 1 ? '<details class="xu-hist"><summary>Todas las versiones (' + p.historial.length + ')</summary><ul>' + p.historial.map(function (a) {
        return '<li><b>v' + esc(a.version) + '</b><span>' + esc(xuFmt(a.fecha, { day: 'numeric', month: 'short', year: 'numeric' })) + '</span><span class="xu-hist-e">' + esc(xuNombreEstadoAct(a.estado)) + '</span>' + (a.notas ? '<small>' + esc(a.notas) + '</small>' : '') + '</li>';
      }).join('') + '</ul></details>' : '') +
      '</article>';
  }

  function xuFormulario() {
    var f = XU.form, b = XU.borrador || {}, e = XU.errorForm || {};
    var err = function (campo) { return e.campo === campo ? '<span class="xu-err" id="xu-err-' + campo + '" role="alert">' + esc(e.error) + '</span>' : ''; };
    var desc = function (campo) { return e.campo === campo ? ' aria-invalid="true" aria-describedby="xu-err-' + campo + '"' : ''; };
    var catalogo = (XU.datos && XU.datos.catalogo) || [];
    var lista = '<datalist id="xu-catalogo">' + catalogo.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>';
    var cab = function (t, sub) { return '<div class="xu-form-cab"><h2 id="xu-form-t">' + esc(t) + '</h2>' + (sub ? '<p>' + esc(sub) + '</p>' : '') + '</div>'; };
    var pie = '<div class="xu-form-pie">' + (e.error && !e.campo ? '<span class="xu-err" role="alert">' + esc(e.error) + '</span>' : '') +
      '<button type="button" class="btn" id="xu-form-no">Cancelar</button><button type="submit" class="btn primary"' + (XU.guardando ? ' disabled' : '') + '>' + (XU.guardando ? 'Guardando…' : 'Guardar') + '</button></div>';
    if (f.tipo === 'act') {
      return '<form class="xu-form" id="xu-form" aria-labelledby="xu-form-t" novalidate>' + cab(f.id ? 'Editar actualización' : 'Registrar una actualización', 'Cada aplicación tiene su cadencia; con esto se sabe si va al día.') + lista +
        '<div class="xu-campos">' +
          '<label class="xu-c"><span>Versión</span><input type="text" name="version" maxlength="30" placeholder="7.4" value="' + esc(b.version || '') + '"' + desc('version') + '>' + err('version') + '</label>' +
          '<label class="xu-c xu-c-ancho"><span>Aplicación</span><input type="text" name="producto" list="xu-catalogo" maxlength="80" placeholder="Nube e infraestructura" value="' + esc(b.producto || '') + '"' + desc('producto') + '>' + err('producto') + '</label>' +
          '<label class="xu-c"><span>Fecha</span><input type="date" name="fecha" value="' + esc(b.fecha || '') + '"' + desc('fecha') + '>' + err('fecha') + '</label>' +
          '<label class="xu-c"><span>Estado</span><select name="estado">' + ((XU.datos && XU.datos.estadosActualizacion) || []).map(function (x) { return '<option value="' + esc(x.id) + '"' + (b.estado === x.id ? ' selected' : '') + '>' + esc(x.nombre) + '</option>'; }).join('') + '</select></label>' +
          '<label class="xu-c xu-c-todo"><span>Qué trae <small>(opcional)</small></span><textarea name="notas" rows="2" maxlength="600">' + esc(b.notas || '') + '</textarea></label>' +
        '</div>' + pie + '</form>';
    }
    var todosLosPlanes = (XU.datos && XU.datos.planes) || [];
    var planes = b.planes || todosLosPlanes.map(function (p) { return p.id; });
    return '<form class="xu-form" id="xu-form" aria-labelledby="xu-form-t" novalidate>' + cab(f.id ? 'Editar mantenimiento' : 'Programar un mantenimiento', 'La hora es la del negocio. Cada plan pide su aviso: ' + xuAvisosDePlanes() + '.') + lista +
      '<div class="xu-campos">' +
        '<label class="xu-c xu-c-todo"><span>Qué se va a hacer</span><input type="text" name="titulo" maxlength="120" placeholder="Migración de la base de datos a la nube nueva" value="' + esc(b.titulo || '') + '"' + desc('titulo') + '>' + err('titulo') + '</label>' +
        '<label class="xu-c xu-c-ancho"><span>Aplicación <small>(vacío: todas)</small></span><input type="text" name="producto" list="xu-catalogo" maxlength="80" value="' + esc(b.producto || '') + '"></label>' +
        '<label class="xu-c"><span>Empieza</span><input type="datetime-local" name="inicio" value="' + esc(b.inicio || '') + '"' + desc('inicio') + '>' + err('inicio') + '</label>' +
        '<label class="xu-c"><span>Dura (minutos)</span><input type="number" name="duracionMin" min="5" max="4320" step="5" inputmode="numeric" value="' + esc(b.duracionMin || '') + '"' + desc('duracionMin') + '>' + err('duracionMin') + '</label>' +
        '<fieldset class="xu-c xu-c-todo xu-planes"' + desc('planes') + '><legend>Planes afectados</legend>' + todosLosPlanes.map(function (p) {
          return '<label class="xu-check"><input type="checkbox" name="planes" value="' + esc(p.id) + '"' + (planes.indexOf(p.id) >= 0 ? ' checked' : '') + '><span>' + esc(p.nombre) + ' <small>aviso ' + esc(xuHoras(p.avisoHoras)) + '</small></span></label>';
        }).join('') + err('planes') + '</fieldset>' +
        '<label class="xu-c xu-c-todo"><span>Notas <small>(opcional)</small></span><textarea name="notas" rows="2" maxlength="600">' + esc(b.notas || '') + '</textarea></label>' +
      '</div>' + pie + '</form>';
  }

  function pintarMantenimientos() {
    var caja = $('xu-mant');
    if (!caja) return;
    // Lo que se estaba escribiendo en el formulario se guarda antes de repintar.
    var form = $('xu-form');
    if (form && XU.form) XU.borrador = xuLeerFormulario(form);
    if (XU.error && !XU.datos) {
      caja.innerHTML = '<div class="xu-error" role="alert"><b>No se pudieron cargar los mantenimientos</b><span>' + esc(XU.error) + '. Lo programado sigue guardado.</span>' +
        '<button class="btn sm" type="button" id="xu-reintentar">Volver a intentar</button></div>';
      $('xu-reintentar').onclick = function () { XU.error = null; cargarMantenimientos(); };
      return;
    }
    var d = XU.datos;
    if (!d) return;
    var c = d.cifras, puede = xuPuedeProgramar();
    var cifras = [
      { t: 'Próximos mantenimientos', n: String(c.proximos), p: c.proximos ? (d.proximos[0] ? 'el primero ' + xuEn(d.proximos[0].inicio) : '') : 'nada programado', ic: 'llave', tono: 'acento' },
      { t: 'Clientes por avisar', n: String(c.porAvisar), p: c.porAvisar ? 'con el aviso pendiente o sin mandar' : (c.proximos ? 'todos avisados' : 'nadie por avisar'), ic: 'bell', tono: c.porAvisar ? 'ambar' : 'neutro' },
      { t: 'Avisos a tiempo', n: c.mantenimientosEnPeriodo ? c.avisosATiempo + ' de ' + c.mantenimientosEnPeriodo : '—', p: c.mantenimientosEnPeriodo ? 'mantenimientos de los últimos ' + d.periodoDias + ' días' : 'ningún mantenimiento en ' + d.periodoDias + ' días', ic: 'check', tono: c.mantenimientosEnPeriodo && c.avisosATiempo < c.mantenimientosEnPeriodo ? 'rojo' : 'verde', flojo: !c.mantenimientosEnPeriodo },
      { t: 'Actualizaciones atrasadas', n: c.productosMedidos ? String(c.productosAtrasados) : '—', p: c.productosMedidos ? (c.productosAtrasados ? 'pasaron su cadencia sin publicar' : 'todas al día con su cadencia') : 'sin actualizaciones registradas', ic: 'paquete', tono: c.productosAtrasados ? 'rojo' : 'verde', flojo: !c.productosMedidos }
    ];
    var html = '<div class="xu-cifras">' + cifras.map(function (x) {
      return '<div class="xu-cifra t-' + x.tono + '"><span class="xu-cifra-cab"><span>' + esc(x.t) + '</span><span class="xu-cifra-ic"><i class="ic" data-ic="' + x.ic + '"></i></span></span>' +
        '<b class="xu-n' + (x.flojo ? ' flojo' : '') + '">' + esc(x.n) + '</b><small>' + esc(x.p) + '</small></div>';
    }).join('') + '</div>';
    html += '<div class="xu-herr"><label class="xu-periodo"><span>Cumplimiento de</span><select id="xu-dias" aria-label="Periodo del cumplimiento">' +
      [[30, 'los últimos 30 días'], [90, 'los últimos 90 días'], [365, 'el último año']].map(function (o) { return '<option value="' + o[0] + '"' + (XU.dias === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
      '<span class="grow"></span>' +
      (puede ? '<button type="button" class="btn" id="xu-nueva-act"><i class="ic" data-ic="paquete"></i>Registrar actualización</button><button type="button" class="btn primary" id="xu-nuevo"><i class="ic" data-ic="mas"></i>Programar mantenimiento</button>' : '<span class="xu-solo-ver">Programar es de quien administra XENCRM; avisar a los clientes, de todos.</span>') +
      (mandaEnElModo() ? '<button type="button" class="btn" id="xu-a-config" title="Configuración › Mantenimientos y actualizaciones"><i class="ic" data-ic="sliders"></i>Reglas</button>' : '') + '</div>';
    if (XU.form) html += xuFormulario();

    var nada = !d.proximos.length && !d.pasados.length;
    html += '<section class="xu-sec" aria-labelledby="xu-t-prox"><h2 id="xu-t-prox">Próximos mantenimientos</h2>';
    if (nada) {
      html += '<div class="xu-vacio"><span class="xu-vacio-ic"><i class="ic" data-ic="llave"></i></span><div><h3>Nada programado todavía</h3>' +
        '<p>Un mantenimiento es una ventana en la que una aplicación puede no estar disponible. Prográmalo aquí y XENCRM te dice a qué clientes toca, según su plan y su aplicación, y hasta cuándo hay que avisarles (' + esc(xuAvisosDePlanes()) + ').</p>' +
        (puede ? '<button type="button" class="btn primary" id="xu-nuevo-vacio"><i class="ic" data-ic="mas"></i>Programar el primero</button>' : '') + '</div></div>';
    } else if (!d.proximos.length) {
      html += '<p class="xu-nada-aqui">No hay mantenimientos por venir. Los que ya pasaron están abajo.</p>';
    } else {
      html += '<div class="xu-lista">' + d.proximos.map(xuTarjeta).join('') + '</div>';
    }
    html += '</section>';
    if (d.pasados.length) html += '<section class="xu-sec" aria-labelledby="xu-t-pas"><h2 id="xu-t-pas">Pasados</h2><div class="xu-lista xu-pasados">' + d.pasados.map(xuTarjeta).join('') + '</div></section>';

    html += '<section class="xu-sec" aria-labelledby="xu-t-act"><h2 id="xu-t-act">Actualizaciones</h2><p class="xu-sec-sub">Cada aplicación tiene su cadencia: si pasa sin una publicada, va atrasada.</p>';
    html += d.productos.length ? '<div class="xu-prods">' + d.productos.map(xuProducto).join('') + '</div>'
      : '<div class="xu-vacio"><span class="xu-vacio-ic"><i class="ic" data-ic="paquete"></i></span><div><h3>Sin actualizaciones registradas</h3><p>Registra cada versión que publiques: así se ve si cada aplicación va al día con la actualización mensual que promete el SLA.</p>' +
        (puede ? '<button type="button" class="btn" id="xu-nueva-act-vacio"><i class="ic" data-ic="paquete"></i>Registrar la primera</button>' : '') + '</div></div>';
    html += '</section>';
    caja.innerHTML = html;
    iconos(caja);
    xuEnganchar(caja);
  }

  function xuLeerFormulario(form) {
    var b = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name) return;
      if (el.name === 'planes') { b.planes = b.planes || []; if (el.checked) b.planes.push(el.value); return; }
      b[el.name] = el.value;
    });
    return b;
  }
  function xuAbrirFormulario(tipo, id) {
    var b = {};
    if (tipo === 'mant' && id) {
      var m = XU.datos.proximos.concat(XU.datos.pasados).filter(function (x) { return x.id === id; })[0];
      if (m) b = { titulo: m.titulo, producto: m.producto, inicio: xuAZona(m.inicio), duracionMin: String(m.duracionMin), planes: m.planes.slice(), notas: m.notas };
    } else if (tipo === 'mant') {
      // Por omisión: el próximo sábado a las 11:00 p. m. del negocio, dos horas, todos los planes.
      var t = new Date(Date.now() + 86400000 * ((6 - new Date().getDay() + 7) % 7 || 7));
      b = { inicio: xuAZona(t.getTime()).slice(0, 11) + '23:00', duracionMin: '120', planes: ((XU.datos && XU.datos.planes) || []).map(function (p) { return p.id; }) };
    } else {
      var pub = ((XU.datos && XU.datos.estadosActualizacion) || []).filter(function (x) { return x.papel === 'publicada'; })[0];
      b = { fecha: xuAZona(Date.now()).slice(0, 10), estado: pub ? pub.id : '' };
    }
    XU.form = { tipo: tipo, id: id || null };
    XU.borrador = b;
    XU.errorForm = null;
    pintarMantenimientos();
    var primero = $('xu-form') && $('xu-form').querySelector('input');
    if (primero) primero.focus();
  }
  function xuCerrarFormulario(volverA) {
    XU.form = null; XU.borrador = null; XU.errorForm = null; XU.guardando = false;
    pintarMantenimientos();
    if (volverA && $(volverA)) $(volverA).focus();
  }
  function xuGuardar(form) {
    var b = xuLeerFormulario(form), f = XU.form;
    XU.borrador = b;
    var cuerpo, ruta;
    if (f.tipo === 'act') {
      var fecha = b.fecha ? xuEnZona(b.fecha + 'T12:00') : NaN;
      cuerpo = { version: b.version, producto: b.producto, fecha: isNaN(fecha) ? '' : fecha, estado: b.estado, notas: b.notas };
      ruta = f.id ? '/actualizaciones/' + f.id : '/actualizaciones';
    } else {
      var inicio = xuEnZona(b.inicio);
      cuerpo = { titulo: b.titulo, producto: b.producto, inicio: isNaN(inicio) ? '' : inicio, duracionMin: b.duracionMin, planes: b.planes || [], notas: b.notas };
      ruta = f.id ? '/mantenimientos/' + f.id : '/mantenimientos';
    }
    XU.guardando = true; XU.errorForm = null;
    pintarMantenimientos();
    api(ruta, { method: f.id ? 'PATCH' : 'POST', body: cuerpo }).then(function (r) {
      XU.guardando = false;
      if (!r || r.error) {
        XU.errorForm = { error: (r && r.error) || 'no se pudo guardar', campo: (r && r.campo) || '' };
        pintarMantenimientos();
        var mal = r && r.campo && $('xu-form') && $('xu-form').querySelector('[name="' + r.campo + '"]');
        if (mal) mal.focus();
        return;
      }
      toast(f.tipo === 'act' ? 'Actualización guardada' : (f.id ? 'Mantenimiento guardado' : 'Mantenimiento programado: revisa a quién hay que avisar'), null, { icono: 'check' });
      XU.form = null; XU.borrador = null;
      cargarMantenimientos();
    }).catch(function () {
      XU.guardando = false;
      XU.errorForm = { error: 'no hubo conexión: lo escrito sigue aquí, vuelve a intentarlo', campo: '' };
      pintarMantenimientos();
    });
  }
  function xuCambiarEstado(id, papel, okTexto) {
    var e = ((XU.datos && XU.datos.estadosMantenimiento) || []).filter(function (x) { return x.papel === papel; })[0];
    api('/mantenimientos/' + id, { method: 'PATCH', body: { estado: e ? e.id : papel } }).then(function (r) {
      if (!r || r.error) { toast('No se pudo: ' + ((r && r.error) || 'sin respuesta')); return; }
      delete XU.cancelando[id];
      toast(okTexto, null, { icono: 'check' });
      cargarMantenimientos();
    });
  }

  function xuEnganchar(caja) {
    var q = function (sel) { return caja.querySelectorAll(sel); };
    if ($('xu-dias')) $('xu-dias').onchange = function () { XU.dias = Number(this.value) || 30; XU.diasElegido = true; cargarMantenimientos(); };
    if ($('xu-a-config')) $('xu-a-config').onclick = function () { go('cfg-mantenimientos'); };
    ['xu-nuevo', 'xu-nuevo-vacio'].forEach(function (id) { if ($(id)) $(id).onclick = function () { xuAbrirFormulario('mant'); }; });
    ['xu-nueva-act', 'xu-nueva-act-vacio'].forEach(function (id) { if ($(id)) $(id).onclick = function () { xuAbrirFormulario('act'); }; });
    var form = $('xu-form');
    if (form) {
      form.onsubmit = function (e) { e.preventDefault(); if (!XU.guardando) xuGuardar(form); };
      $('xu-form-no').onclick = function () { xuCerrarFormulario(XU.form && XU.form.tipo === 'act' ? 'xu-nueva-act' : 'xu-nuevo'); };
      form.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); xuCerrarFormulario(XU.form && XU.form.tipo === 'act' ? 'xu-nueva-act' : 'xu-nuevo'); } });
    }
    q('[data-xu-ver]').forEach(function (b) {
      b.onclick = function () {
        var id = Number(b.getAttribute('data-xu-ver'));
        XU.abiertos[id] = b.getAttribute('aria-expanded') !== 'true';
        pintarMantenimientos();
        var otra = $('xu-mant').querySelector('[data-xu-ver="' + id + '"]');
        if (otra) otra.focus();
      };
    });
    q('[data-xu-preparar]').forEach(function (b) {
      b.onclick = function () {
        var id = Number(b.getAttribute('data-xu-preparar'));
        XU.preparando[id] = true;
        pintarMantenimientos();
        api('/mantenimientos/' + id + '/avisos/preparar', { method: 'POST', body: {} }).then(function (r) {
          delete XU.preparando[id];
          if (!r || r.error) { toast('No se pudo preparar el aviso: ' + ((r && r.error) || 'sin respuesta')); pintarMantenimientos(); return; }
          XU.abiertos[id] = true;
          var n = r.preparados.length;
          toast(n ? (n === 1 ? 'Aviso listo en 1 conversación: ábrela, léelo y mándalo' : 'Aviso listo en ' + n + ' conversaciones: ábrelas, léelo y mándalo') : 'Nadie por avisar: ' + ((r.omitidos[0] && r.omitidos[0].porque) || 'ya estaban avisados'), null, { icono: n ? 'check' : undefined });
          cargarMantenimientos();
        });
      };
    });
    q('[data-xu-avisado]').forEach(function (b) {
      b.onclick = function () {
        var id = Number(b.getAttribute('data-xu-m')), quien = b.getAttribute('data-xu-avisado');
        b.disabled = true;
        api('/mantenimientos/' + id + '/avisos/' + encodeURIComponent(quien) + '/avisado', { method: 'POST', body: {} }).then(function (r) {
          if (!r || r.error) { b.disabled = false; toast('No se pudo: ' + ((r && r.error) || 'sin respuesta')); return; }
          toast('Anotado: se le avisó por otro medio', null, { icono: 'check' });
          cargarMantenimientos();
        });
      };
    });
    q('[data-xu-chat]').forEach(function (b) { b.onclick = function () { go('inbox'); openContact(b.getAttribute('data-xu-chat')); }; });
    q('[data-xu-editar]').forEach(function (b) { b.onclick = function () { xuAbrirFormulario('mant', Number(b.getAttribute('data-xu-editar'))); }; });
    q('[data-xu-hecho]').forEach(function (b) { b.onclick = function () { xuCambiarEstado(Number(b.getAttribute('data-xu-hecho')), 'hecho', 'Marcado como hecho'); }; });
    q('[data-xu-cancelar]').forEach(function (b) {
      b.onclick = function () {
        var id = Number(b.getAttribute('data-xu-cancelar'));
        XU.cancelando[id] = true; pintarMantenimientos();
        var si = $('xu-mant').querySelector('[data-xu-cancelar-no="' + id + '"]'); if (si) si.focus();
      };
    });
    q('[data-xu-cancelar-no]').forEach(function (b) {
      b.onclick = function () {
        var id = Number(b.getAttribute('data-xu-cancelar-no'));
        delete XU.cancelando[id]; pintarMantenimientos();
        var v = $('xu-mant').querySelector('[data-xu-cancelar="' + id + '"]'); if (v) v.focus();
      };
    });
    q('[data-xu-cancelar-si]').forEach(function (b) { b.onclick = function () { xuCambiarEstado(Number(b.getAttribute('data-xu-cancelar-si')), 'cancelado', 'Mantenimiento cancelado'); }; });
  }

  // ---------- Configuración › Mantenimientos y actualizaciones: las reglas ----------
  // TODO lo que decide cómo se cuenta: el aviso de cada plan, la cadencia de cada aplicación, quién recibe avisos, la
  // plantilla del aviso, los estados, quién programa. Cada regla dice de dónde sale su valor (fábrica, el archivo del
  // cliente o este tablero) y se puede devolver con un clic. Las ve quien administra; las cambia el super-admin (la
  // consola cierra el guardado a los demás, y aquí se dice antes de que alguien escriba de balde).
  //
  // 🪤 Se guarda TODO o nada: si una regla no sirve, el servidor dice cuál y no guarda ninguna; lo escrito se queda
  // (XC.borrador) con el error junto a esa regla.
  TITULOS['cfg-mantenimientos'] = 'Configuración';
  var XC = { datos: null, cargando: false, error: null, borrador: {}, volver: {}, errorCampo: null, guardando: false, previa: null, previaT: 0 };
  var XC_SECCIONES = [
    { t: 'Planes y aviso mínimo', d: 'Con cuánto tiempo hay que avisarle un mantenimiento a cada plan.', de: function (id) { return id === 'mant.planes' || id.indexOf('mant.avisoHoras.') === 0; } },
    { t: 'Actualizaciones', d: 'Cada cuánto debe salir una versión de cada aplicación, y cuándo se dice que va atrasada.', de: function (id) { return id === 'mant.productos' || id === 'mant.toleranciaDias' || id.indexOf('mant.cadenciaDias') === 0; } },
    { t: 'Quién recibe los avisos', d: 'Qué contactos cuentan como clientes afectados por un mantenimiento.', de: function (id) { return id.indexOf('mant.afectados.') === 0; } },
    { t: 'El aviso', d: 'El texto que se deja listo en cada conversación y cuándo cuenta como dado.', de: function (id) { return id.indexOf('mant.aviso.') === 0; } },
    { t: 'Estados', d: 'Cómo se dice cada estado en pantalla.', de: function (id) { return id.indexOf('mant.estadoMant.') === 0 || id.indexOf('mant.estadoAct.') === 0; } },
    { t: 'Permisos y periodo', d: 'Quién programa, y qué periodo mira el cumplimiento.', de: function (id) { return id === 'mant.quienPrograma' || id === 'mant.periodoDias'; } }
  ];
  var XC_ORIGEN = { fabrica: 'De fábrica', archivo: 'Del archivo del cliente', tablero: 'Cambiado aquí' };

  function xcPuedeCambiar() { return mandaEnElModo(); }
  function xcAttr(id) { return String(id).replace(/["\\]/g, '\\$&'); }
  function xcValorTexto(r, v) {
    if (v === null || v === undefined) return '';
    if (r.tipo === 'lista' && Array.isArray(v)) return v.join('\n');
    return String(v);
  }
  /** Lo que muestra el campo: lo escrito si hay borrador; si no, lo que manda hoy. */
  function xcActual(r) {
    if (Object.prototype.hasOwnProperty.call(XC.borrador, r.id)) return XC.borrador[r.id];
    if (XC.volver[r.id]) return r.origen === 'tablero' ? (r.delArchivo !== undefined && r.delArchivo !== null ? r.delArchivo : r.defecto) : r.valor;
    return r.valor;
  }
  function xcCambio(r) {
    if (XC.volver[r.id]) return true;
    if (!Object.prototype.hasOwnProperty.call(XC.borrador, r.id)) return false;
    var b = XC.borrador[r.id], v = r.valor;
    if (r.tipo === 'lista') return (Array.isArray(b) ? b : String(b).split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean)).join('\n') !== (Array.isArray(v) ? v : []).join('\n');
    if (r.tipo === 'si-no') return Boolean(b) !== Boolean(v);
    return String(b) !== xcValorTexto(r, v);
  }

  function cargarCfgMantenimientos() {
    if (XC.cargando) return;
    var caja = $('xu-cfg');
    if (!caja) return;
    XC.cargando = true;
    caja.setAttribute('aria-busy', 'true');
    if (!XC.datos) caja.innerHTML = '<div class="xc-sec xu-esq" aria-hidden="true"><i></i><i></i><i></i></div><div class="xc-sec xu-esq" aria-hidden="true"><i></i><i></i></div>';
    api('/mantenimientos/config').then(function (d) {
      XC.cargando = false;
      caja.removeAttribute('aria-busy');
      if (!d || d.error) { XC.error = (d && d.error) || 'el servidor no contestó'; pintarCfgMantenimientos(); return; }
      XC.error = null; XC.datos = d;
      pintarCfgMantenimientos();
      xcVistaPrevia();
    }).catch(function (e) {
      XC.cargando = false;
      caja.removeAttribute('aria-busy');
      if (String(e && e.message) === '401') return;
      XC.error = 'no hubo conexión con el servidor';
      pintarCfgMantenimientos();
    });
  }
  alAbrir('cfg-mantenimientos', cargarCfgMantenimientos);

  function xcCampo(r, puede) {
    var v = xcActual(r), dis = puede ? '' : ' disabled', idc = 'xc-' + r.id.replace(/[^a-zA-Z0-9]+/g, '-');
    var mal = XC.errorCampo && XC.errorCampo.campo === r.id;
    var aria = ' aria-describedby="' + idc + '-ayuda' + (mal ? ' ' + idc + '-err' : '') + '"' + (mal ? ' aria-invalid="true"' : '');
    var bloqueado = r.id === 'mant.planes' && XC.datos.planesDelSla;
    if (bloqueado) dis = ' disabled';
    var control;
    if (r.tipo === 'numero') {
      control = '<span class="xc-num"><input type="number" id="' + idc + '" data-xc="' + esc(r.id) + '"' + (r.min !== undefined ? ' min="' + r.min + '"' : '') + (r.max !== undefined ? ' max="' + r.max + '"' : '') + ' step="1" inputmode="numeric" value="' + esc(xcValorTexto(r, v)) + '"' +
        (r.defecto === null ? ' placeholder="la general"' : '') + dis + aria + '>' + (r.unidad ? '<span>' + esc(r.unidad) + '</span>' : '') + '</span>' +
        (r.unidad === 'horas' && Number(v) >= 24 ? '<small class="xc-equiv">= ' + esc(String(Math.round(Number(v) / 24 * 10) / 10).replace('.', ',')) + ' días</small>' : '');
    } else if (r.tipo === 'texto' && r.id === 'mant.aviso.plantilla') {
      var vars = (XC.datos.variables || []).map(function (x) { return '<button type="button" class="xc-var" data-xc-var="' + esc(x.nombre) + '" title="' + esc(x.que) + '"' + dis + '>{' + esc(x.nombre) + '}</button>'; }).join('');
      control = '<textarea id="' + idc + '" data-xc="' + esc(r.id) + '" rows="5" maxlength="' + (r.max || 1000) + '"' + dis + aria + '>' + esc(xcValorTexto(r, v)) + '</textarea>' +
        '<div class="xc-vars" role="group" aria-label="Variables para el texto">' + vars + '</div>' +
        '<div class="xc-previa" aria-live="polite"><span class="xc-previa-t">Vista previa' + (XC.previa && XC.previa.con ? ' · con ' + esc(XC.previa.con) : '') + '</span>' +
          '<p>' + (XC.previa ? (XC.previa.error ? '<span class="xu-err">' + esc(XC.previa.error) + '</span>' : esc(XC.previa.texto)) : '<span class="xu-nada">Escribiendo…</span>') + '</p></div>';
    } else if (r.tipo === 'texto') {
      control = '<input type="text" id="' + idc + '" data-xc="' + esc(r.id) + '" maxlength="' + (r.max || 200) + '" value="' + esc(xcValorTexto(r, v)) + '"' + dis + aria + '>';
    } else if (r.tipo === 'si-no') {
      control = '<label class="xc-switch"><input type="checkbox" id="' + idc + '" data-xc="' + esc(r.id) + '"' + (v ? ' checked' : '') + dis + aria + '><span>' + (v ? 'Sí' : 'No') + '</span></label>';
    } else if (r.tipo === 'opciones' && r.opciones.length <= 3) {
      control = '<div class="xc-radios" role="radiogroup" aria-labelledby="' + idc + '-l">' + r.opciones.map(function (o, i) {
        return '<label class="xc-radio"><input type="radio" name="' + idc + '" data-xc="' + esc(r.id) + '" value="' + esc(o.valor) + '"' + (String(v) === o.valor ? ' checked' : '') + dis + (i === 0 ? aria : '') + '><span>' + esc(o.etiqueta) + '</span></label>';
      }).join('') + '</div>';
    } else if (r.tipo === 'opciones') {
      control = '<select id="' + idc + '" data-xc="' + esc(r.id) + '"' + dis + aria + '>' + r.opciones.map(function (o) { return '<option value="' + esc(o.valor) + '"' + (String(v) === o.valor ? ' selected' : '') + '>' + esc(o.etiqueta) + '</option>'; }).join('') + '</select>';
    } else if (r.tipo === 'lista' && r.opciones) {
      var marcados = Array.isArray(v) ? v : String(v || '').split(/\r?\n/);
      control = '<div class="xc-checks" role="group" aria-labelledby="' + idc + '-l">' + r.opciones.map(function (o) {
        return '<label class="xu-check"><input type="checkbox" data-xc="' + esc(r.id) + '" data-xc-lista="1" value="' + esc(o.valor) + '"' + (marcados.indexOf(o.valor) >= 0 ? ' checked' : '') + dis + '><span>' + esc(o.etiqueta) + '</span></label>';
      }).join('') + '</div>';
    } else {
      control = '<textarea id="' + idc + '" data-xc="' + esc(r.id) + '" rows="' + Math.min(8, Math.max(3, (Array.isArray(v) ? v.length : 3) + 1)) + '"' + dis + aria + ' placeholder="Uno por renglón">' + esc(xcValorTexto(r, v)) + '</textarea>';
    }
    var origen = XC.volver[r.id] ? 'Vuelve a ' + (r.delArchivo !== undefined && r.delArchivo !== null ? 'lo del archivo' : 'lo de fábrica') + ' al guardar' : XC_ORIGEN[r.origen];
    var volver = puede && !bloqueado && r.origen === 'tablero' && !XC.volver[r.id]
      ? '<button type="button" class="xc-volver" data-xc-volver="' + esc(r.id) + '">Volver a ' + (r.delArchivo !== undefined && r.delArchivo !== null ? 'lo del archivo' : 'lo de fábrica') + '</button>' : '';
    return '<div class="xc-campo' + (xcCambio(r) ? ' cambiado' : '') + (mal ? ' mal' : '') + '" data-xc-campo="' + esc(r.id) + '">' +
      '<div class="xc-cab"><label id="' + idc + '-l"' + (/^(numero|texto|opciones)$/.test(r.tipo) && !(r.tipo === 'opciones' && r.opciones.length <= 3) ? ' for="' + idc + '"' : '') + '>' + esc(r.etiqueta) + '</label>' +
        '<span class="xc-origen o-' + (XC.volver[r.id] ? 'volver' : r.origen) + '">' + esc(origen) + '</span>' + volver + '</div>' +
      control +
      '<small class="xc-ayuda" id="' + idc + '-ayuda">' + esc(r.ayuda) + '</small>' +
      (mal ? '<span class="xu-err" id="' + idc + '-err" role="alert">' + esc(XC.errorCampo.error) + '</span>' : '') + '</div>';
  }

  function pintarCfgMantenimientos() {
    var caja = $('xu-cfg');
    if (!caja) return;
    if (XC.error && !XC.datos) {
      caja.innerHTML = '<div class="xu-error" role="alert"><b>No se pudieron cargar las reglas</b><span>' + esc(XC.error) + '. Las reglas guardadas siguen igual.</span><button class="btn sm" type="button" id="xc-reintentar">Volver a intentar</button></div>';
      $('xc-reintentar').onclick = function () { XC.error = null; cargarCfgMantenimientos(); };
      return;
    }
    if (!XC.datos) return;
    var foco = document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute('data-xc');
    var puede = xcPuedeCambiar();
    var reglas = XC.datos.reglas || [];
    var cambios = reglas.filter(xcCambio).length;
    var html = '<div class="xc-intro">' +
      '<p>Tres capas, y manda la última que tenga valor: <b>de fábrica</b> (lo que promete un plan de soporte típico), <b>el archivo del cliente</b> (<code>servicio.mantenimientos</code> en xencrm.config.json) y <b>lo que se cambia aquí</b>. «Volver a…» quita lo de aquí.</p>' +
      (puede ? '' : '<p class="xc-solo-ver" role="note"><i class="ic" data-ic="alerta"></i>Estas reglas las cambia quien administra XENCRM. Aquí las ves tal como cuentan hoy.</p>') +
      '<button type="button" class="btn sm" id="xc-ir-mant"><i class="ic" data-ic="llave"></i>Ver Mantenimientos y actualizaciones</button></div>';
    html += XC_SECCIONES.map(function (sec, i) {
      var suyas = reglas.filter(function (r) { return sec.de(r.id); });
      if (!suyas.length) return '';
      return '<section class="xc-sec" aria-labelledby="xc-s' + i + '"><div class="xc-sec-cab"><h2 id="xc-s' + i + '">' + esc(sec.t) + '</h2><p>' + esc(sec.d) + '</p></div>' +
        '<div class="xc-campos">' + suyas.map(function (r) { return xcCampo(r, puede); }).join('') + '</div></section>';
    }).join('');
    if (puede) html += '<div class="xc-pie' + (cambios ? ' con-cambios' : '') + '" role="region" aria-label="Guardar las reglas">' +
      '<span>' + (XC.errorCampo && !XC.errorCampo.campo ? '<span class="xu-err" role="alert">' + esc(XC.errorCampo.error) + '</span>' : cambios ? (cambios === 1 ? '1 regla cambiada sin guardar' : cambios + ' reglas cambiadas sin guardar') : 'Sin cambios') + '</span>' +
      '<button type="button" class="btn" id="xc-descartar"' + (cambios ? '' : ' disabled') + '>Descartar</button>' +
      '<button type="button" class="btn primary" id="xc-guardar"' + (cambios && !XC.guardando ? '' : ' disabled') + '>' + (XC.guardando ? 'Guardando…' : 'Guardar cambios') + '</button></div>';
    caja.innerHTML = html;
    iconos(caja);
    xcEnganchar(caja);
    if (foco) { var f = caja.querySelector('[data-xc="' + xcAttr(foco) + '"]'); if (f) { f.focus(); if (f.setSelectionRange && typeof f.value === 'string' && f.type !== 'number' && f.type !== 'checkbox' && f.type !== 'radio') try { f.setSelectionRange(f.value.length, f.value.length); } catch (e) {} } }
  }

  function xcLeer(caja, id) {
    var els = caja.querySelectorAll('[data-xc="' + xcAttr(id) + '"]');
    if (!els.length) return undefined;
    var el = els[0];
    if (el.getAttribute('data-xc-lista')) return Array.prototype.filter.call(els, function (x) { return x.checked; }).map(function (x) { return x.value; });
    if (el.type === 'radio') { var on = Array.prototype.filter.call(els, function (x) { return x.checked; })[0]; return on ? on.value : ''; }
    if (el.type === 'checkbox') return el.checked;
    return el.value;
  }
  function xcVistaPrevia() {
    var r = ((XC.datos && XC.datos.reglas) || []).filter(function (x) { return x.id === 'mant.aviso.plantilla'; })[0];
    if (!r) return;
    var plantilla = String(xcActual(r) || '');
    var mia = ++XC.previaT;
    var desconocidas = (plantilla.match(/\{([^{}]*)\}/g) || []).map(function (m) { return m.slice(1, -1); }).filter(function (n) { return !(XC.datos.variables || []).some(function (x) { return x.nombre === n; }); });
    if (desconocidas.length) { XC.previa = { error: 'No existe la variable {' + desconocidas[0] + '}: usa las de los botones.' }; xcPintarPrevia(); return; }
    api('/mantenimientos/config/vista-previa', { method: 'POST', body: { plantilla: plantilla } }).then(function (p) {
      if (mia !== XC.previaT) return; // llegó una más nueva
      XC.previa = !p || p.error ? { error: (p && p.error) || 'sin vista previa' } : p;
      xcPintarPrevia();
    });
  }
  /** Solo la vista previa, sin repintar todo (para no quitarle el cursor a quien escribe). */
  function xcPintarPrevia() {
    var caja = $('xu-cfg'), pv = caja && caja.querySelector('.xc-previa');
    if (!pv) return;
    pv.innerHTML = '<span class="xc-previa-t">Vista previa' + (XC.previa && XC.previa.con ? ' · con ' + esc(XC.previa.con) : '') + '</span><p>' +
      (XC.previa ? (XC.previa.error ? '<span class="xu-err">' + esc(XC.previa.error) + '</span>' : esc(XC.previa.texto)) : '') + '</p>';
  }
  var xcPreviaTimer = 0;
  function xcEnganchar(caja) {
    if ($('xc-ir-mant')) $('xc-ir-mant').onclick = function () { go('mantenimientos'); };
    caja.querySelectorAll('[data-xc]').forEach(function (el) {
      var id = el.getAttribute('data-xc');
      var cambiar = function () {
        XC.borrador[id] = xcLeer(caja, id);
        delete XC.volver[id];
        if (XC.errorCampo && XC.errorCampo.campo === id) XC.errorCampo = null;
        // El pie y la marca de «cambiado» sin repintar los campos (el cursor sigue donde estaba).
        var r = XC.datos.reglas.filter(function (x) { return x.id === id; })[0];
        var campo = caja.querySelector('[data-xc-campo="' + xcAttr(id) + '"]');
        if (campo && r) campo.classList.toggle('cambiado', xcCambio(r));
        xcPintarPie(caja);
        if (id === 'mant.aviso.plantilla') { clearTimeout(xcPreviaTimer); xcPreviaTimer = setTimeout(xcVistaPrevia, 350); }
        if (el.type === 'checkbox' && !el.getAttribute('data-xc-lista')) { var s = el.parentNode.querySelector('span'); if (s) s.textContent = el.checked ? 'Sí' : 'No'; }
      };
      el.addEventListener('input', cambiar);
      el.addEventListener('change', cambiar);
    });
    caja.querySelectorAll('[data-xc-var]').forEach(function (b) {
      b.onclick = function () {
        var t = caja.querySelector('[data-xc="mant.aviso.plantilla"]');
        if (!t) return;
        var ins = '{' + b.getAttribute('data-xc-var') + '}', i = t.selectionStart || t.value.length, j = t.selectionEnd || i;
        t.value = t.value.slice(0, i) + ins + t.value.slice(j);
        t.focus(); t.setSelectionRange(i + ins.length, i + ins.length);
        t.dispatchEvent(new Event('input'));
      };
    });
    caja.querySelectorAll('[data-xc-volver]').forEach(function (b) {
      b.onclick = function () { var id = b.getAttribute('data-xc-volver'); XC.volver[id] = true; delete XC.borrador[id]; pintarCfgMantenimientos(); if (id === 'mant.aviso.plantilla') xcVistaPrevia(); };
    });
    if ($('xc-descartar')) $('xc-descartar').onclick = function () { XC.borrador = {}; XC.volver = {}; XC.errorCampo = null; pintarCfgMantenimientos(); xcVistaPrevia(); };
    if ($('xc-guardar')) $('xc-guardar').onclick = xcGuardar;
  }
  function xcPintarPie(caja) {
    var pie = caja.querySelector('.xc-pie');
    if (!pie) return;
    var n = XC.datos.reglas.filter(xcCambio).length;
    pie.classList.toggle('con-cambios', n > 0);
    pie.querySelector('span').textContent = n ? (n === 1 ? '1 regla cambiada sin guardar' : n + ' reglas cambiadas sin guardar') : 'Sin cambios';
    $('xc-descartar').disabled = !n;
    $('xc-guardar').disabled = !n || XC.guardando;
  }
  function xcGuardar() {
    var valores = {};
    XC.datos.reglas.forEach(function (r) {
      if (XC.volver[r.id]) valores[r.id] = null;
      else if (xcCambio(r)) valores[r.id] = XC.borrador[r.id];
    });
    if (!Object.keys(valores).length) return;
    XC.guardando = true; XC.errorCampo = null;
    pintarCfgMantenimientos();
    api('/mantenimientos/config', { method: 'PUT', body: { valores: valores } }).then(function (r) {
      XC.guardando = false;
      if (!r || r.error) {
        XC.errorCampo = { error: (r && r.error) || 'no se pudo guardar', campo: (r && r.campo) || '' };
        pintarCfgMantenimientos();
        var mal = r && r.campo && $('xu-cfg').querySelector('[data-xc="' + xcAttr(r.campo) + '"]');
        if (mal) mal.focus();
        return;
      }
      XC.datos = r; XC.borrador = {}; XC.volver = {};
      XU.datos = null; // Mantenimientos se vuelve a pedir con las reglas nuevas
      pintarCfgMantenimientos();
      xcVistaPrevia();
      toast('Reglas guardadas: ya cuentan así', null, { icono: 'check' });
    }).catch(function () {
      XC.guardando = false;
      XC.errorCampo = { error: 'no hubo conexión: lo escrito sigue aquí, vuelve a intentarlo', campo: '' };
      pintarCfgMantenimientos();
    });
  }
  // (fin de XEN · Mantenimientos y actualizaciones)

  // ===== XEN · Modelos de IA: lo nuevo del agente de Modelos =====
  // Configuración › Modelos de IA: conectar los proveedores (src/proveedores.ts) y decir cuál hace cada rol
  // (src/motores.ts). Es de quien administra XENCRM: la consola cierra `motores/` a los demás.
  //
  // 🪤 Una llave solo viaja de ida: se pega, el servidor la comprueba contra su proveedor y la guarda, y lo que vuelve
  // es una pista («sk-proj…f2a9»). El campo se vacía en cuanto se guardó: una llave que se queda en la página acaba
  // en una captura de pantalla.
  //
  // 🪤 Lo guardado se aplica al REINICIAR, como en la consola. La pantalla lo dice arriba, fijo, y cada proveedor
  // tocado queda «Sin probar» hasta entonces. Fingir que ya corre haría pensar que contesta lo nuevo.
  ICONS.nube = '<path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9z"/>';
  ICONS.chip = '<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>';
  TITULOS.modelos = 'Configuración';
  var XM = { datos: null, motores: null, pruebas: {}, cambiando: {}, quitando: {}, reinicio: false, cargando: false };
  var XM_ESTADO = {
    conectado: ['Conectado', 'ok'], sin_llave: ['Sin llave', 'falta'], sin_configurar: ['Sin configurar', 'neutro'],
    no_disponible: ['No disponible', 'mal'], sin_probar: ['Sin probar', 'neutro']
  };
  var XM_CORTO = { openai: 'OpenAI', anthropic: 'Claude', apple: 'Apple', ollama: 'Ollama', lmstudio: 'LM Studio', compat: 'API compatible' };
  function xmProv(id) { return ((XM.datos && XM.datos.proveedores) || []).filter(function (p) { return p.id === id; })[0] || null; }
  function xmNombreRol(rol) { var r = ((XM.datos && XM.datos.roles) || []).filter(function (x) { return x.rol === rol; })[0]; return r ? r.nombre : rol; }

  function cargarModelos() {
    if (XM.cargando) return;
    XM.cargando = true;
    var provs = $('xm-provs'), roles = $('xm-roles');
    provs.setAttribute('aria-busy', 'true'); roles.setAttribute('aria-busy', 'true');
    // Cargando: la forma de lo que viene (seis tarjetas, cuatro filas), para que nada salte al llegar.
    if (!XM.datos) {
      provs.innerHTML = [1, 2, 3, 4, 5, 6].map(function () { return '<div class="xm-prov xm-esq" aria-hidden="true"><i></i><i></i><i></i></div>'; }).join('');
      roles.innerHTML = [1, 2, 3, 4].map(function () { return '<div class="xm-rol xm-esq" aria-hidden="true"><i></i><i></i></div>'; }).join('');
    }
    Promise.all([api('/motores/proveedores'), api('/motores')]).then(function (r) {
      XM.cargando = false;
      var d = r[0], m = r[1];
      provs.removeAttribute('aria-busy'); roles.removeAttribute('aria-busy');
      if (!d || d.error) { xmError(d && d.error); return; }
      XM.datos = d;
      XM.motores = m && !m.error ? m : null;
      xmPintarAviso();
      xmPintarProveedores();
      xmPintarRoles(m && m.error);
    }).catch(function () { XM.cargando = false; provs.removeAttribute('aria-busy'); roles.removeAttribute('aria-busy'); xmError(); });
  }
  function xmError(porque) {
    $('xm-provs').innerHTML = '<div class="xm-vacio" role="alert"><b>No pude cargar los proveedores.</b><span>' +
      esc(porque || 'Revisa la conexión con el servidor.') + '</span><button class="btn sm" type="button" id="xm-otra-vez">Volver a intentar</button></div>';
    $('xm-roles').innerHTML = '';
    $('xm-otra-vez').onclick = cargarModelos;
  }

  function xmPintarAviso() {
    var pendiente = XM.reinicio || (XM.datos.proveedores || []).some(function (p) { return p.pendiente; });
    $('xm-aviso').classList.toggle('pendiente', pendiente);
    var puede = Boolean(XM.datos.puedeReiniciarse);
    $('xm-reiniciar').hidden = !(pendiente && puede);
    $('xm-aviso-sub').textContent = pendiente
      ? (puede ? 'Tienes cambios guardados que todavía no corren.' : 'Tienes cambios guardados que todavía no corren. Aquí nadie lo volvería a levantar: reinícialo tú desde el panel del alojamiento.')
      : 'Hasta entonces sigue contestando lo de ahora.';
  }
  $('xm-reiniciar').onclick = function () {
    var b = $('xm-reiniciar');
    b.disabled = true; b.textContent = 'Reiniciando…';
    // 🪤 El servidor se muere a propósito, así que la petición puede cortarse sin respuesta: eso no es un error.
    api('/config/restart', { method: 'POST' }).catch(function () {}).then(function () {
      setTimeout(function () {
        XM.reinicio = false; XM.pruebas = {}; XM.datos = null;
        b.disabled = false; b.textContent = 'Reiniciar ahora';
        cargarModelos();
        toast('Arriba otra vez, con lo nuevo.', null, { icono: 'check' });
      }, 6000);
    });
  };

  function xmTarjeta(p) {
    var est = XM_ESTADO[p.estado] || ['—', 'neutro'];
    var prueba = XM.pruebas[p.id];
    var donde = p.deMaquina ? 'En la máquina · sin costo por uso' : 'En la nube · cobra por uso';
    var marcas = [];
    if (p.respaldo) marcas.push('<span class="chip xm-chip-respaldo">Respaldo de todos los roles</span>');
    if (p.enUso && p.enUso.length) marcas.push('<span class="chip xm-chip-uso">Hace: ' + esc(p.enUso.map(xmNombreRol).join(', ')) + '</span>');
    var campos = '';
    if (p.id === 'compat') {
      campos += '<label class="xm-campo"><span>Nombre</span><input type="text" name="nombre" value="' + esc(p.nombrePropio || '') + '" placeholder="Por ejemplo, OpenRouter" maxlength="40" autocomplete="off" spellcheck="false"></label>';
    }
    if (p.url) {
      campos += '<label class="xm-campo"><span>Dirección</span><input type="url" name="url" value="' + esc(p.url.valor || '') + '" placeholder="' + esc(p.url.porDefecto || 'https://…/v1') + '" autocomplete="off" spellcheck="false" inputmode="url"></label>';
    }
    if (p.llave) {
      if (p.llave.puesta && !XM.cambiando[p.id]) {
        campos += '<div class="xm-campo xm-llave"><span>Llave</span><div class="xm-llave-fila"><code class="xm-pista">' + esc(p.llave.pista || 'puesta') + '</code>' +
          (p.llave.deLaCasa ? '<span class="xm-casa">la de la casa</span>' : '') +
          '<button class="btn sm" type="button" data-acc="cambiar">Cambiar llave</button>' +
          (p.llave.deLaCasa ? '' : (XM.quitando[p.id]
            ? '<button class="btn sm danger" type="button" data-acc="quitar-si">Sí, quitar la llave</button><button class="btn sm" type="button" data-acc="quitar-no">No</button>'
            : '<button class="btn sm" type="button" data-acc="quitar">Quitar</button>')) +
          '</div></div>';
      } else {
        var ph = p.llave.empiezaPor ? 'Pega la llave (empieza por ' + p.llave.empiezaPor + ')' : (p.llave.obligatoria ? 'Pega la llave' : 'Pega la llave, si la pide');
        campos += '<label class="xm-campo"><span>Llave' + (p.llave.obligatoria ? '' : ' <em>(opcional)</em>') + '</span><input type="password" name="llave" placeholder="' + esc(ph) + '" autocomplete="new-password" spellcheck="false"></label>';
      }
    }
    if (p.modelo) {
      if (p.modelo.editable) {
        var lista = prueba && prueba.modelos && prueba.modelos.length ? prueba.modelos : [];
        campos += '<label class="xm-campo"><span>Modelo</span><input type="text" name="modelo" value="' + esc(p.modelo.valor || '') + '" placeholder="' +
          esc(lista.length ? 'Elige uno de la lista' : 'Prueba la conexión para ver los que hay') + '" list="xm-dl-' + p.id + '" autocomplete="off" spellcheck="false"></label>' +
          '<datalist id="xm-dl-' + p.id + '">' + lista.map(function (m) { return '<option value="' + esc(m) + '"></option>'; }).join('') + '</datalist>';
      } else {
        campos += '<div class="xm-campo xm-dato"><span>Modelo</span><code>' + esc(p.modelo.valor || '—') + '</code></div>';
      }
    }
    var editable = Boolean(p.url || p.llave || (p.modelo && p.modelo.editable));
    var res = prueba ? xmTextoPrueba(prueba) : '';
    return '<article class="xm-prov" data-id="' + p.id + '" data-tono="' + est[1] + '" aria-labelledby="xm-n-' + p.id + '">' +
      '<header class="xm-prov-cab">' +
        '<span class="xm-glifo" aria-hidden="true"><i class="ic" data-ic="' + (p.deMaquina ? 'chip' : 'nube') + '"></i></span>' +
        '<div class="xm-prov-nom"><h3 id="xm-n-' + p.id + '">' + esc(p.nombre) + '</h3><span class="xm-donde">' + esc(donde) + '</span></div>' +
        '<span class="xm-estado" data-tono="' + est[1] + '"><i aria-hidden="true"></i>' + esc(est[0]) + '</span>' +
      '</header>' +
      '<p class="xm-que">' + esc(p.queEs) + '</p>' +
      (marcas.length ? '<div class="xm-marcas">' + marcas.join('') + '</div>' : '') +
      (p.porque ? '<p class="xm-porque">' + esc(p.porque) + '</p>' : '') +
      '<form class="xm-form" novalidate>' + campos +
        '<div class="xm-acc">' +
          (editable ? '<button class="btn primary sm" type="submit">Guardar</button>' : '') +
          '<button class="btn sm" type="button" data-acc="probar">Probar conexión</button>' +
          '<span class="xm-res" role="status" aria-live="polite">' + res + '</span>' +
        '</div>' +
      '</form>' +
    '</article>';
  }
  function xmTextoPrueba(r) {
    if (!r) return '';
    if (r.ok) return '<span class="xm-bien"><i class="ic" data-ic="check"></i>Contesta' + (r.modelos && r.modelos.length ? ' · ' + r.modelos.length + (r.modelos.length === 1 ? ' modelo' : ' modelos') : '') + '</span>';
    // Contesta pero falta algo (el modelo, uno de los roles): ámbar, no rojo. No está roto; está a medio conectar.
    return '<span class="' + (r.contesta ? 'xm-medio' : 'xm-mal') + '"><i class="ic" data-ic="alerta"></i>' + esc(r.porque || 'No contesta') + '</span>';
  }
  function xmPintarProveedores() {
    $('xm-provs').innerHTML = (XM.datos.proveedores || []).map(xmTarjeta).join('');
    iconos($('xm-provs'));
    $('xm-provs').querySelectorAll('.xm-prov').forEach(xmEnganchar);
  }
  /** Repinta UNA tarjeta, con un mensaje en su línea de estado si hace falta, y devuelve el foco adonde se pida. */
  function xmRepintar(id, mensaje, foco) {
    var vieja = $('xm-provs').querySelector('.xm-prov[data-id="' + id + '"]'), p = xmProv(id);
    if (!vieja || !p) return;
    var caja = document.createElement('div');
    caja.innerHTML = xmTarjeta(p);
    var nueva = caja.firstChild;
    vieja.replaceWith(nueva);
    if (mensaje !== undefined) nueva.querySelector('.xm-res').innerHTML = mensaje;
    iconos(nueva);
    xmEnganchar(nueva);
    var f = foco && nueva.querySelector(foco);
    if (f) f.focus();
  }
  function xmMensaje(caja, html) { caja.querySelector('.xm-res').innerHTML = html; iconos(caja.querySelector('.xm-res')); }
  function xmEnganchar(caja) {
    var id = caja.getAttribute('data-id'), form = caja.querySelector('form');
    form.onsubmit = function (e) {
      e.preventDefault();
      var p = xmProv(id), cuerpo = {}, campo;
      if ((campo = form.querySelector('[name=url]')) && campo.value.trim() !== (p.url.valor || '')) cuerpo.url = campo.value;
      if ((campo = form.querySelector('[name=modelo]')) && campo.value.trim() !== (p.modelo.valor || '')) cuerpo.modelo = campo.value;
      if ((campo = form.querySelector('[name=nombre]')) && campo.value.trim() !== (p.nombrePropio || '')) cuerpo.nombre = campo.value;
      if ((campo = form.querySelector('[name=llave]')) && campo.value.trim()) cuerpo.llave = campo.value;
      if (!Object.keys(cuerpo).length) { xmMensaje(caja, '<span class="xm-nada">No cambiaste nada.</span>'); return; }
      var boton = form.querySelector('[type=submit]');
      boton.disabled = true;
      xmMensaje(caja, cuerpo.llave ? 'Comprobando la llave…' : 'Guardando…');
      api('/motores/proveedores/' + id, { method: 'PUT', body: cuerpo }).then(function (r) {
        boton.disabled = false;
        // 🪤 Si falla, lo escrito se queda (dirección, modelo, nombre y la llave) para corregirlo: es trabajo de quien
        // lo pegó. Solo se va cuando se guardó.
        if (!r || r.error) { xmMensaje(caja, '<span class="xm-mal"><i class="ic" data-ic="alerta"></i>' + esc((r && r.error) || 'No se pudo guardar.') + '</span>'); return; }
        var llave = form.querySelector('[name=llave]'); if (llave) llave.value = '';
        XM.datos.proveedores = XM.datos.proveedores.map(function (x) { return x.id === id ? r.proveedor : x; });
        XM.cambiando[id] = false; delete XM.pruebas[id];
        XM.reinicio = XM.reinicio || Boolean(r.hayQueReiniciar);
        xmPintarAviso();
        xmRepintar(id, '<span class="xm-bien"><i class="ic" data-ic="check"></i>Guardado. Se aplica al reiniciar.</span>', '[data-acc=probar]');
        xmPintarRoles();
      }).catch(function () { boton.disabled = false; xmMensaje(caja, '<span class="xm-mal">Sin respuesta del servidor. Vuelve a intentar.</span>'); });
    };
    caja.querySelectorAll('[data-acc]').forEach(function (b) {
      b.onclick = function () {
        var acc = b.getAttribute('data-acc');
        if (acc === 'cambiar') { XM.cambiando[id] = true; XM.quitando[id] = false; xmRepintar(id, undefined, '[name=llave]'); return; }
        if (acc === 'quitar') { XM.quitando[id] = true; xmRepintar(id, undefined, '[data-acc=quitar-no]'); return; }
        if (acc === 'quitar-no') { XM.quitando[id] = false; xmRepintar(id, undefined, '[data-acc=quitar]'); return; }
        if (acc === 'quitar-si') {
          b.disabled = true;
          api('/motores/proveedores/' + id + '/llave', { method: 'DELETE' }).then(function (r) {
            XM.quitando[id] = false;
            if (!r || r.error) { xmRepintar(id, '<span class="xm-mal">' + esc((r && r.error) || 'No se pudo quitar.') + '</span>'); return; }
            XM.datos.proveedores = XM.datos.proveedores.map(function (x) { return x.id === id ? r.proveedor : x; });
            XM.reinicio = true; delete XM.pruebas[id];
            xmPintarAviso();
            xmRepintar(id, '<span class="xm-bien">Llave quitada. Se aplica al reiniciar.</span>', '[data-acc=probar]');
          });
          return;
        }
        if (acc === 'probar') {
          b.disabled = true;
          xmMensaje(caja, 'Probando…');
          api('/motores/proveedores/' + id + '/probar', { method: 'POST' }).then(function (r) {
            b.disabled = false;
            if (!r || r.error) { xmMensaje(caja, '<span class="xm-mal">' + esc((r && r.error) || 'No se pudo probar.') + '</span>'); return; }
            XM.pruebas[id] = r;
            // La lista de modelos llega aquí: el campo del modelo la ofrece para elegir en vez de escribir de memoria.
            var modelo = caja.querySelector('[name=modelo]');
            if (modelo && r.modelos && r.modelos.length) {
              var dl = $('xm-dl-' + id);
              if (dl) dl.innerHTML = r.modelos.map(function (m) { return '<option value="' + esc(m) + '"></option>'; }).join('');
              modelo.placeholder = 'Elige uno de la lista';
            }
            xmMensaje(caja, xmTextoPrueba(r));
          }).catch(function () { b.disabled = false; xmMensaje(caja, '<span class="xm-mal">Sin respuesta del servidor. Vuelve a intentar.</span>'); });
        }
      };
    });
  }

  // ---- Qué modelo hace cada cosa ----
  function xmModeloDe(motor, r) {
    var m = XM.motores, p = xmProv(motor);
    if (motor === 'openai') return { k: 'modelo', valor: r.modelo || '', ph: m.modeloGeneral || 'el general', editable: true };
    if (motor === 'anthropic') return { k: 'modeloClaude', valor: r.modeloClaude || '', ph: m.modeloClaudeGeneral || 'el general', editable: true };
    if (motor === 'apple') return { valor: '', ph: 'Apple tiene uno solo', editable: false };
    var fijo = p && p.modelo ? p.modelo.valor : '';
    return { valor: fijo, ph: fijo ? '' : 'Elígelo arriba, en ' + (XM_CORTO[motor] || motor), editable: false };
  }
  function xmOpciones(puesto) {
    return (XM.motores.asignables || []).map(function (mo) {
      var p = xmProv(mo), est = p ? XM_ESTADO[p.estado] : null;
      var nota = p && p.estado !== 'conectado' && est ? ' — ' + est[0].toLowerCase() : '';
      return '<option value="' + mo + '"' + (mo === puesto ? ' selected' : '') + '>' + esc((XM_CORTO[mo] || mo) + nota) + '</option>';
    }).join('');
  }
  function xmCampoModelo(rol, motor, r) {
    var c = xmModeloDe(motor, r);
    return '<input type="text" data-k="' + (c.k || '') + '" value="' + esc(c.valor) + '" placeholder="' + esc(c.ph) + '"' + (c.editable ? '' : ' disabled') +
      ' aria-label="Modelo de ' + esc(xmNombreRol(rol)) + '" autocomplete="off" spellcheck="false">';
  }
  function xmPintarRoles(fallo) {
    var caja = $('xm-roles');
    if (!XM.motores) {
      caja.innerHTML = '<div class="xm-vacio"><b>No pude leer qué hace cada rol.</b><span>' + esc(fallo || 'Vuelve a intentar en un momento.') + '</span></div>';
      return;
    }
    var m = XM.motores, meta = XM.datos.roles || [];
    caja.innerHTML =
      (m.reparto && m.reparto !== 'router'
        ? '<p class="xm-nota">Ahora <b>' + esc(XM_CORTO[m.reparto] || m.reparto) + '</b> hace todo (LLM_ENGINE). Al guardar, cada rol pasa a usar el suyo.</p>' : '') +
      m.roles.map(function (r) {
        var d = meta.filter(function (x) { return x.rol === r.rol; })[0] || { nombre: r.rol, queHace: '' };
        return '<div class="xm-rol" data-rol="' + r.rol + '">' +
          '<div class="xm-rol-que"><b>' + esc(d.nombre) + '</b><span>' + esc(d.queHace) + '</span>' +
            (d.cuidado ? '<span class="xm-cuidado"><i class="ic" data-ic="alerta"></i>' + esc(d.cuidado) + '</span>' : '') + '</div>' +
          '<label class="xm-campo"><span>Proveedor</span><select data-k="motor">' + xmOpciones(r.motor) + '</select></label>' +
          '<div class="xm-campo"><span aria-hidden="true">Modelo</span><span class="xm-modelo">' + xmCampoModelo(r.rol, r.motor, r) + '</span></div>' +
        '</div>';
      }).join('') +
      '<p class="xm-nota xm-todo-claude" id="xm-todo-claude" hidden><i class="ic" data-ic="alerta"></i>Con Claude en todos los roles no queda respaldo en la nube detrás: si Claude falla, solo contesta lo que haya en la máquina.</p>' +
      '<div class="xm-acc"><button class="btn primary" type="button" id="xm-guardar-roles">Guardar</button><span class="xm-res" id="xm-roles-res" role="status" aria-live="polite"></span></div>';
    iconos(caja);
    caja.querySelectorAll('.xm-rol').forEach(function (fila) {
      var sel = fila.querySelector('[data-k=motor]'), rol = fila.getAttribute('data-rol');
      sel.onchange = function () {
        var r = m.roles.filter(function (x) { return x.rol === rol; })[0];
        fila.querySelector('.xm-modelo').innerHTML = xmCampoModelo(rol, sel.value, r);
        xmTodoClaude();
      };
    });
    xmTodoClaude();
    $('xm-guardar-roles').onclick = xmGuardarRoles;
  }
  function xmTodoClaude() {
    var sels = Array.prototype.slice.call($('xm-roles').querySelectorAll('[data-k=motor]'));
    $('xm-todo-claude').hidden = !(sels.length && sels.every(function (s) { return s.value === 'anthropic'; }));
  }
  function xmGuardarRoles() {
    var m = XM.motores, cambios = [];
    $('xm-roles').querySelectorAll('.xm-rol').forEach(function (fila) {
      var rol = fila.getAttribute('data-rol'), r = m.roles.filter(function (x) { return x.rol === rol; })[0];
      var motor = fila.querySelector('[data-k=motor]').value, campo = fila.querySelector('.xm-modelo input');
      var c = { rol: rol };
      if (motor !== r.motor) c.motor = motor;
      if (campo && !campo.disabled && campo.getAttribute('data-k')) {
        var k = campo.getAttribute('data-k'), antes = k === 'modeloClaude' ? r.modeloClaude || '' : r.modelo || '';
        if (campo.value.trim() !== antes) c[k] = campo.value.trim();
      }
      // Solo lo que cambió: guardar sondea cada proveedor nombrado, y uno que no se tocó no tiene por qué frenar al resto.
      if (Object.keys(c).length > 1) cambios.push(c);
    });
    var res = $('xm-roles-res'), boton = $('xm-guardar-roles');
    var cuerpo = { roles: cambios };
    if (m.reparto && m.reparto !== 'router') cuerpo.reparto = 'router';
    if (!cambios.length && !cuerpo.reparto) { res.innerHTML = '<span class="xm-nada">No cambiaste nada.</span>'; return; }
    boton.disabled = true;
    res.textContent = 'Comprobando que cada proveedor conteste…';
    api('/motores', { method: 'PUT', body: cuerpo }).then(function (r) {
      boton.disabled = false;
      if (!r || r.error) { res.innerHTML = '<span class="xm-mal"><i class="ic" data-ic="alerta"></i>' + esc((r && r.error) || 'No se pudo guardar.') + '</span>'; iconos(res); return; }
      XM.reinicio = XM.reinicio || Boolean(r.hayQueReiniciar);
      xmPintarAviso();
      res.innerHTML = '<span class="xm-bien"><i class="ic" data-ic="check"></i>Guardado. Se aplica al reiniciar.</span>';
      iconos(res);
    }).catch(function () { boton.disabled = false; res.textContent = 'Sin respuesta del servidor. Vuelve a intentar.'; });
  }
  // Se carga al abrirse la pantalla. 🪤 Va por la clase `active` de la vista y no por go(): así entra igual desde el
  // engranaje, desde el panel de Configuración o desde el menú del celular, sin una línea más en el enrutador.
  (function vigilarModelos() {
    var vista = $('view-modelos');
    if (!vista || typeof MutationObserver === 'undefined') return;
    new MutationObserver(function () {
      if (vista.classList.contains('active')) cargarModelos();
    }).observe(vista, { attributes: true, attributeFilter: ['class'] });
  })();
  // (fin de XEN · Modelos de IA)

  // ===== XEN · Reglas y umbrales: el registro común (src/reglas.ts) y su pantalla en Configuración =====
  // Cada número que decide algo de negocio (cuándo es «caliente», cuántos días aguanta una cuenta clave, desde
  // cuántos tratos se marca «Aquí se quedan más»…) es una regla con su valor de fábrica, lo que trae el archivo del
  // cliente y lo que se cambie aquí. El tablero también pinta con algunas: las lee al arrancar (R) y, mientras no
  // han llegado, usa el valor de fábrica, que es el de siempre.
  function R(id, defecto) {
    var v = state.reglasValores && state.reglasValores[id];
    return v === undefined || v === null ? defecto : v;
  }
  function cargarReglasDelTablero() {
    if (!state.token && !PORLACONSOLA) return Promise.resolve();
    return api('/reglas/valores').then(function (v) {
      if (v && typeof v === 'object' && !v.error && !Array.isArray(v)) state.reglasValores = v;
    }).catch(function () { /* sin reglas, el tablero pinta con los valores de fábrica */ });
  }
  /** Arranca con las reglas ya leídas: así lo primero que se pinta usa los umbrales de este negocio. */
  function arrancarConReglas() {
    var listo = false;
    var seguir = function () { if (!listo) { listo = true; boot(); } };
    // Si la red tarda, no se espera más de un segundo y medio: se arranca con los de fábrica y llegan después.
    setTimeout(seguir, 1500);
    cargarReglasDelTablero().then(seguir, seguir);
  }

  TITULOS.reglas = 'Configuración';
  var XR = { datos: null, cargando: false, error: '', q: '', borrador: {}, errores: {}, guardando: false };
  var XR_FUENTE = { fabrica: ['De fábrica', 'neutro'], archivo: ['Del archivo del cliente', 'archivo'], tablero: ['Cambiada aquí', 'tablero'] };

  function xrTexto(r, v) {
    if (v === null || v === undefined) return '—';
    if (r.tipo === 'si-no') return v ? 'Sí' : 'No';
    if (r.tipo === 'lista') return (v || []).join(', ');
    if (r.tipo === 'opciones') { var o = (r.opciones || []).filter(function (x) { return x.valor === v; })[0]; return o ? o.etiqueta : String(v); }
    if (r.tipo === 'numero') return String(v).replace('.', ',') + (r.unidad ? ' ' + r.unidad : '');
    return String(v);
  }
  /** Lo que muestra el campo: lo escrito sin guardar, o el valor que manda hoy. */
  function xrComoTexto(r) {
    if (r.tipo === 'lista') return (r.valor || []).join('\n');
    if (r.tipo === 'si-no') return r.valor ? 'si' : 'no';
    return r.tipo === 'numero' ? String(r.valor).replace('.', ',') : String(r.valor);
  }
  function xrValorDelCampo(r) {
    return Object.prototype.hasOwnProperty.call(XR.borrador, r.id) ? XR.borrador[r.id] : xrComoTexto(r);
  }
  function xrIdDe(r) { return 'xr-c-' + r.id.replace(/\./g, '-'); }
  function xrCampo(r) {
    var id = xrIdDe(r), v = xrValorDelCampo(r), err = XR.errores[r.id];
    var aria = ' aria-describedby="' + id + '-ayuda' + (err ? ' ' + id + '-err' : '') + '"' + (err ? ' aria-invalid="true"' : '');
    var dato = ' data-xr="' + esc(r.id) + '" id="' + id + '"' + aria;
    var control;
    if (r.tipo === 'si-no') control = '<select' + dato + '><option value="si"' + (v === 'si' ? ' selected' : '') + '>Sí</option><option value="no"' + (v === 'no' ? ' selected' : '') + '>No</option></select>';
    else if (r.tipo === 'opciones') control = '<select' + dato + '>' + (r.opciones || []).map(function (o) { return '<option value="' + esc(o.valor) + '"' + (o.valor === v ? ' selected' : '') + '>' + esc(o.etiqueta) + '</option>'; }).join('') + '</select>';
    else if (r.tipo === 'lista') control = '<textarea rows="3"' + dato + ' placeholder="Uno por renglón">' + esc(v) + '</textarea>';
    else control = '<input type="text"' + (r.tipo === 'numero' ? ' inputmode="decimal"' : '') + dato + ' value="' + esc(v) + '" autocomplete="off">';
    return '<span class="xr-control' + (r.unidad ? ' con-unidad' : '') + '">' + control + (r.unidad ? '<span class="xr-unidad" aria-hidden="true">' + esc(r.unidad) + '</span>' : '') + '</span>';
  }
  function xrFila(r) {
    var id = xrIdDe(r), f = XR_FUENTE[r.fuente] || XR_FUENTE.fabrica, err = XR.errores[r.id];
    var cambiada = Object.prototype.hasOwnProperty.call(XR.borrador, r.id);
    return '<li class="xr-regla' + (cambiada ? ' cambiada' : '') + (err ? ' con-error' : '') + '" data-xr-fila="' + esc(r.id) + '">' +
      '<div class="xr-que"><label for="' + id + '">' + esc(r.etiqueta) + '</label>' +
        '<p id="' + id + '-ayuda">' + esc(r.ayuda) + '</p>' +
        '<p class="xr-de">De fábrica: <b>' + esc(xrTexto(r, r.defecto)) + '</b>' +
          (r.archivo !== null ? ' · en el archivo del cliente: <b>' + esc(xrTexto(r, r.archivo)) + '</b>' : '') +
          (r.aplica === 'al-reiniciar' ? ' · <span class="xr-reinicio">se aplica al reiniciar</span>' : '') + '</p>' +
        (r.archivoError ? '<p class="xr-aviso-archivo"><i class="ic" data-ic="alerta"></i>El archivo del cliente trae un valor que no vale (' + esc(r.archivoError) + '): se usa el de fábrica.</p>' : '') +
      '</div>' +
      '<div class="xr-como">' + xrCampo(r) +
        '<span class="xr-fuente ' + f[1] + '">' + esc(f[0]) + '</span>' +
        (r.fuente === 'tablero' && !cambiada ? '<button type="button" class="linkbtn xr-volver" data-xr-volver="' + esc(r.id) + '">' + (r.archivo !== null ? 'Volver al del archivo' : 'Volver al de fábrica') + '</button>' : '') +
        (err ? '<p class="xr-error" id="' + id + '-err" role="alert"><i class="ic" data-ic="alerta"></i>' + esc(err) + '</p>' : '') +
      '</div></li>';
  }
  function xrSinTildes(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function xrCoincide(r, q) {
    if (!q) return true;
    var t = xrSinTildes(r.etiqueta + ' ' + r.ayuda + ' ' + r.grupo + ' ' + r.id);
    return q.split(/\s+/).every(function (p) { return t.indexOf(p) >= 0; });
  }
  function xrBarra() {
    var n = Object.keys(XR.borrador).length;
    if (!$('xr-barra')) return;
    $('xr-barra').hidden = !n;
    $('xr-barra-t').textContent = n === 1 ? '1 cambio sin guardar' : n + ' cambios sin guardar';
    $('xr-guardar').disabled = XR.guardando;
  }
  function pintarReglas() {
    var caja = $('xr-reglas');
    if (!caja) return;
    if (XR.cargando && !XR.datos) {
      caja.setAttribute('aria-busy', 'true');
      caja.innerHTML = [1, 2, 3].map(function () { return '<section class="xr-grupo xr-esq" aria-hidden="true"><i></i><i></i><i></i></section>'; }).join('');
      return;
    }
    caja.removeAttribute('aria-busy');
    if (XR.error && !XR.datos) {
      caja.innerHTML = '<div class="xr-vacio" role="alert"><b>No se pudieron leer las reglas</b><span>' + esc(XR.error) + '</span><button type="button" class="btn" id="xr-reintentar">Volver a intentar</button></div>';
      $('xr-reintentar').onclick = function () { cargarReglas(); };
      return;
    }
    var d = XR.datos || { grupos: [], reglas: [], enOtroSitio: [] };
    var q = xrSinTildes(XR.q.trim());
    var visibles = d.reglas.filter(function (r) { return xrCoincide(r, q); });
    var conAviso = d.reglas.filter(function (r) { return r.archivoError; }).length;
    var propias = d.reglas.filter(function (r) { return r.fuente !== 'fabrica'; }).length;
    var html = '<p class="xr-resumen">' + d.reglas.length + ' reglas en ' + d.grupos.length + ' grupos · ' +
      (propias ? propias + (propias === 1 ? ' con un valor propio de este negocio' : ' con valor propio de este negocio') : 'todas con su valor de fábrica') +
      (conAviso ? ' · <span class="xr-aviso-archivo">' + conAviso + ' con un valor del archivo que no vale</span>' : '') + '</p>';
    if (!d.reglas.length) html += '<div class="xr-vacio"><b>Todavía no hay reglas registradas</b><span>Cuando un módulo registre las suyas, salen aquí.</span></div>';
    else if (!visibles.length) html += '<div class="xr-vacio"><b>Ninguna regla dice «' + esc(XR.q.trim()) + '»</b><span>Prueba con otra palabra: «días», «caliente», «cuenta clave»…</span><button type="button" class="btn" id="xr-limpiar">Ver todas</button></div>';
    else d.grupos.forEach(function (g) {
      var del = visibles.filter(function (r) { return r.grupo === g; });
      if (!del.length) return;
      var gid = 'xr-g-' + xrSinTildes(g).replace(/[^a-z0-9]+/g, '-');
      html += '<section class="xr-grupo" aria-labelledby="' + gid + '"><h2 id="' + gid + '">' + esc(g) + '<span class="xr-n">' + del.length + '</span></h2><ul>' + del.map(xrFila).join('') + '</ul></section>';
    });
    if ((d.enOtroSitio || []).length && !q) {
      html += '<section class="xr-grupo xr-otros" aria-labelledby="xr-otros-t"><h2 id="xr-otros-t">También se configura, en otro sitio</h2><ul>' + d.enOtroSitio.map(function (o) {
        return '<li><span class="xr-otro-que"><b>' + esc(o.etiqueta) + '</b><small>' + esc(o.grupo) + '</small></span>' + (o.vista ? '<button type="button" class="btn sm" data-xr-ir="' + esc(o.vista) + '">' + esc(o.donde) + '</button>' : '<code>' + esc(o.donde) + '</code>') + '</li>';
      }).join('') + '</ul></section>';
    }
    caja.innerHTML = html;
    iconos(caja);
    xrBarra();
    caja.querySelectorAll('[data-xr]').forEach(function (el) {
      var on = function () {
        var id = el.getAttribute('data-xr'), r = d.reglas.filter(function (x) { return x.id === id; })[0];
        if (!r) return;
        if (el.value === xrComoTexto(r)) delete XR.borrador[id]; else XR.borrador[id] = el.value;
        var fila = el.closest('[data-xr-fila]');
        if (fila) fila.classList.toggle('cambiada', Object.prototype.hasOwnProperty.call(XR.borrador, id));
        xrBarra();
      };
      el.addEventListener('input', on);
      el.addEventListener('change', on);
    });
    caja.querySelectorAll('[data-xr-volver]').forEach(function (b) {
      b.onclick = function () { var o = {}; o[b.getAttribute('data-xr-volver')] = null; xrGuardar(o, 'Listo: volvió al valor de antes'); };
    });
    caja.querySelectorAll('[data-xr-ir]').forEach(function (b) { b.onclick = function () { go(b.getAttribute('data-xr-ir')); }; });
    if ($('xr-limpiar')) $('xr-limpiar').onclick = function () { XR.q = ''; $('xr-q').value = ''; pintarReglas(); $('xr-q').focus(); };
  }
  function cargarReglas() {
    XR.cargando = true; XR.error = '';
    pintarReglas();
    return api('/reglas').then(function (d) {
      XR.cargando = false;
      if (!d || d.error || !Array.isArray(d.reglas)) { XR.error = (d && d.error) || 'El servidor no mandó las reglas.'; pintarReglas(); return; }
      XR.datos = d;
      pintarReglas();
    }).catch(function (e) {
      XR.cargando = false;
      XR.error = e && e.message === '401' ? 'Tu sesión venció.' : 'No hubo respuesta del servidor.';
      pintarReglas();
    });
  }
  /** Guarda todo o nada: si una no vale, no se guarda ninguna, lo escrito se queda y cada error va junto a su campo. */
  function xrGuardar(cambios, dice) {
    if (!XR.datos) return;
    XR.guardando = true; XR.errores = {};
    xrBarra();
    var enviar = {};
    Object.keys(cambios).forEach(function (id) {
      var v = cambios[id], r = XR.datos.reglas.filter(function (x) { return x.id === id; })[0];
      if (v !== null && r && r.tipo === 'si-no') v = v === 'si';
      if (v !== null && r && r.tipo === 'lista') v = String(v).split('\n');
      enviar[id] = v;
    });
    return api('/reglas', { method: 'PUT', body: { cambios: enviar } }).then(function (r) {
      XR.guardando = false;
      if (!r || r.error) {
        XR.errores = (r && r.errores) || {};
        if (!r || !r.errores) toast('No se pudo guardar: ' + ((r && r.error) || 'sin respuesta'));
        else toast(Object.keys(r.errores).length === 1 ? 'No se pudo guardar: hay una regla que no vale (no se guardó nada)' : 'No se pudo guardar: hay reglas que no valen (no se guardó nada)');
        pintarReglas();
        var primero = document.querySelector('#xr-reglas [aria-invalid="true"]');
        if (primero) primero.focus();
        return;
      }
      XR.borrador = {}; XR.datos = r;
      pintarReglas();
      cargarReglasDelTablero();
      toast(dice || (r.cambiadas.length === 1 ? 'Regla guardada: se aplica desde ya' : r.cambiadas.length + ' reglas guardadas: se aplican desde ya'), null, { icono: 'check' });
    }).catch(function () {
      XR.guardando = false;
      pintarReglas();
      toast('No se pudo guardar: no hubo respuesta del servidor. Tus cambios siguen aquí.');
    });
  }
  if ($('xr-q')) $('xr-q').addEventListener('input', function () { XR.q = $('xr-q').value; pintarReglas(); });
  if ($('xr-guardar')) $('xr-guardar').onclick = function () { xrGuardar(Object.assign({}, XR.borrador)); };
  if ($('xr-descartar')) $('xr-descartar').onclick = function () { XR.borrador = {}; XR.errores = {}; pintarReglas(); };
  alAbrir('reglas', function () { cargarReglas(); });
  // (fin de XEN · Reglas y umbrales)

  // Las reglas primero, después el tablero (ver arrancarConReglas).

  // Configuración › Agente › Modo agéntico (src/agentico/): con los clientes y el copiloto del equipo, cada uno con su
  // interruptor. Prenderlo es de quien administra (el candado no deja el PUT); a los demás se les dice cómo está.
  function agenticoPanel(a) {
    var g = a.agentico || {}, ag = esc(a.agent.name || 'Xen'), puede = !enCandado();
    var fila = function (cual, on, titulo, dice, falta) {
      return '<div class="agentico-fila"><div><b>' + titulo + '</b><span class="small muted">' + dice + '</span>' + (falta ? '<span class="small agentico-falta">' + falta + '</span>' : '') + '</div>' +
        (puede ? '<button class="btn sm' + (on ? '' : ' primary') + '" data-agentico="' + cual + '" aria-pressed="' + on + '">' + (on ? 'Apagar' : 'Prender') + '</button>' : '<span class="chip">' + (on ? 'Prendido' : 'Apagado') + '</span>') + '</div>';
    };
    return '<div class="panel" id="agentico-panel"><b>Modo agéntico</b>' +
      '<p class="small muted">' + ag + ' usa herramientas: consulta lo que necesita, hace lo seguro y propone lo demás. Cada paso queda en las trazas.</p>' +
      fila('clientes', g.clientes === true, 'Con los clientes', g.clientes
        ? 'En WhatsApp y el chat del sitio, ' + ag + ' consulta los tickets, ' + VOC.la + ' ' + VOC.cita + ' y los mantenimientos de quien escribe; abre un ticket cuando reporta una falla y pasa a una persona cuando hace falta. Cuesta algo más por mensaje.'
        : ag + ' contesta como siempre, sin herramientas.', g.clientesPueden === false ? 'Necesita OpenAI, Claude o una API compatible en el rol de responder (Modelos de IA).' : '') +
      fila('equipo', g.equipo !== false, 'Copiloto del equipo', g.equipo !== false
        ? 'El botón «Pregúntale a ' + ag + '» de arriba: consulta el CRM, crea tickets y notas, y propone lo demás para que lo apruebes.'
        : 'El botón de arriba avisa que está apagado.', g.copilotoPuede === false ? 'Necesita OpenAI, Claude o una API compatible (Modelos de IA).' : '') +
      '<p class="small muted">Hasta ' + R('agentico.pasos', 4) + ' pasos y ' + new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'USD' }).format(R('agentico.topeTurnoUsd', 0.1)) + ' por mensaje, aparte del tope del mes (Reglas y umbrales › Modo agéntico).</p>' +
      '<div class="small" role="status" id="agentico-msg"></div></div>';
  }
  function bindAgentico(a) {
    document.querySelectorAll('#agentico-panel [data-agentico]').forEach(function (b) {
      b.onclick = function () {
        var cual = b.getAttribute('data-agentico'), cuerpo = {};
        cuerpo[cual] = b.getAttribute('aria-pressed') !== 'true';
        b.disabled = true;
        api('/agent/agentico', { method: 'PUT', body: cuerpo }).then(function (r) {
          if (!r || r.error) { b.disabled = false; $('agentico-msg').textContent = 'No se pudo: ' + ((r && r.error) || 'sin respuesta'); return; }
          a.agentico = Object.assign({}, a.agentico, r.agentico);
          $('agentico-panel').outerHTML = agenticoPanel(a);
          bindAgentico(a);
          $('agentico-msg').textContent = cual === 'clientes' ? (r.agentico.clientes ? 'Prendido con los clientes.' : 'Apagado con los clientes.') : (r.agentico.equipo ? 'Copiloto prendido.' : 'Copiloto apagado.');
        }).catch(function () { b.disabled = false; $('agentico-msg').textContent = 'No se pudo: revisa la conexión.'; });
      };
    });
  }

  // ===== XEN · El copiloto del equipo (modo agéntico, src/agentico/equipo.ts) =====
  // Una conversación al lado del tablero: se le pregunta por el CRM y consulta, hace lo seguro (crear un ticket,
  // anotar) y propone lo demás. Cada propuesta trae la ruta de la API que la hace; aprobarla es llamar esa ruta, la
  // misma del botón de siempre, con sus validaciones y su candado. La conversación es de quien pregunta: vive en
  // este navegador (sessionStorage) y se manda entera en cada pregunta.
  var COP = { mensajes: [], ocupado: false, estado: null };
  try { COP.mensajes = JSON.parse(sessionStorage.getItem(LLAVE('copiloto')) || '[]') || []; } catch (e) { COP.mensajes = []; }
  function copGuardar() { try { sessionStorage.setItem(LLAVE('copiloto'), JSON.stringify(COP.mensajes.slice(-30))); } catch (e) {} }
  function copAgente() { return state.agentName || 'Xen'; }
  // Lo que escribe el modelo, sin HTML: párrafos, listas con guion y **negritas**. Todo pasa por esc() antes.
  function copTexto(t) {
    var html = '', lista = false;
    var negrita = function (s) { return s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>'); };
    String(t || '').split('\n').forEach(function (l) {
      var m = /^\s*(?:[-•*]|\d+[.)])\s+(.*)$/.exec(l);
      if (m) { if (!lista) { html += '<ul>'; lista = true; } html += '<li>' + negrita(esc(m[1])) + '</li>'; return; }
      if (lista) { html += '</ul>'; lista = false; }
      if (l.trim()) html += '<p>' + negrita(esc(l)) + '</p>';
    });
    return html + (lista ? '</ul>' : '');
  }
  // Lo que consultó (las de leer): para decir de dónde salió la respuesta. Lo que hizo ya sale como «hecho».
  var COP_HERR = { buscar_contactos: 'contactos', ver_contacto: 'una ficha', 'citas': VOC.citas, tickets: 'tickets', mantenimientos: 'mantenimientos', pendientes_de_hoy: 'lo pendiente', cupo_de_la_agenda: 'el cupo' };
  function copEnlace(e) {
    var que = e.tipo === 'ticket' ? 'Abrir ' + e.nombre : 'Ficha de ' + e.nombre;
    return '<button type="button" class="cop-enlace" data-tipo="' + esc(e.tipo) + '" data-eid="' + esc(e.id) + '">' + svgXen(e.tipo === 'ticket' ? 'ticket' : 'contacto') + '<span>' + esc(que) + '</span></button>';
  }
  function copMensaje(m, i) {
    if (m.rol === 'usuario') return '<div class="cop-msj yo"><p>' + esc(m.texto) + '</p></div>';
    if (m.error) return '<div class="cop-msj xen error" role="alert"><p><b>No pude contestar.</b> ' + esc(m.error) + '</p>' + (m.irAConfig ? '<button type="button" class="btn sm" data-cop-config>Ir a Configuración › Agente</button>' : '<button type="button" class="btn sm" data-cop-reintentar="' + i + '">Reintentar</button>') + '</div>';
    var hechos = (m.hechos || []).map(function (h) { return '<li class="cop-hecho">' + svgXen('check') + '<span>' + esc(h.resumen) + '</span>' + (h.enlace ? copEnlace(h.enlace) : '') + '</li>'; }).join('');
    var props = (m.propuestas || []).map(function (p, j) {
      var est = p.estado || 'pendiente';
      var pie = est === 'hecha' ? '<span class="cop-est ok">' + svgXen('check') + 'Hecho</span>'
        : est === 'descartada' ? '<span class="cop-est">Descartada</span>'
        : '<button type="button" class="btn sm primary" data-cop-hacer="' + i + ':' + j + '">' + (p.herramienta === 'mensaje_al_cliente' ? 'Enviar mensaje' : 'Hacerlo') + '</button><button type="button" class="btn sm" data-cop-descartar="' + i + ':' + j + '">Descartar</button>' + (p.error ? '<span class="cop-est mal" role="alert">' + esc(p.error) + '</span>' : '');
      return '<li class="cop-prop' + (est !== 'pendiente' ? ' ' + est : '') + '"><span class="cop-prop-t">' + svgXen('chispa') + '<span><b>Propuesto</b> · ' + esc(p.resumen) + '</span></span><span class="cop-prop-acc">' + pie + '</span></li>';
    }).join('');
    // Los enlaces de lo que la respuesta nombra (TK-0003, «Camilo Duarte»), no de todo lo que consultó: una búsqueda
    // de tickets trae seis, y seis botones debajo de una respuesta que habla de uno no ayudan a nadie.
    var enlaces = (m.enlaces || []).filter(function (e) { return e.nombre && String(m.texto || '').indexOf(e.nombre) >= 0 && !(m.hechos || []).concat(m.propuestas || []).some(function (h) { return h.enlace && h.enlace.id === e.id && h.enlace.tipo === e.tipo; }); }).slice(0, 4).map(copEnlace).join('');
    var consulto = (m.llamadas || []).filter(function (l) { return l.ok && COP_HERR[l.nombre]; }).map(function (l) { return COP_HERR[l.nombre]; });
    consulto = consulto.filter(function (x, k) { return consulto.indexOf(x) === k; });
    return '<div class="cop-msj xen">' + copTexto(m.texto) +
      (hechos ? '<ul class="cop-hechos">' + hechos + '</ul>' : '') +
      (props ? '<ul class="cop-props">' + props + '</ul>' : '') +
      (enlaces ? '<div class="cop-enlaces">' + enlaces + '</div>' : '') +
      (consulto.length || m.agotado ? '<p class="cop-meta">' + (consulto.length ? 'Consultó ' + esc(consulto.join(', ')) + '.' : '') + (m.agotado ? ' Contestó con lo que alcanzó a revisar.' : '') + '</p>' : '') + '</div>';
  }
  function copSugerencias() {
    var s = ['¿Qué tengo pendiente hoy?', '¿Qué tickets están vencidos o en riesgo?', '¿Qué ' + VOC.citas + ' hay esta semana?', '¿Quiénes son los prospectos calientes sin asignar?'];
    return '<div class="cop-vacio"><p><b>Pregúntale a ' + esc(copAgente()) + ' por tu CRM.</b> Consulta contactos, tickets, ' + esc(VOC.citas) + ' y mantenimientos; crea tickets y notas, y te propone lo demás para que lo apruebes.</p>' +
      '<div class="cop-sug">' + s.map(function (t) { return '<button type="button" class="cop-chip" data-cop-sug="' + esc(t) + '">' + esc(t) + '</button>'; }).join('') + '</div></div>';
  }
  function pintarCopiloto() {
    var hilo = $('cop-hilo');
    // 🪤 Repintar borra el botón que se acaba de tocar («Hacerlo», «Descartar»): el foco se iría al <body> y con él
    // Escape y el teclado. Si estaba en el hilo, vuelve al campo de la pregunta.
    var teniaFoco = hilo.contains(document.activeElement);
    if (COP.estado === 'apagado') {
      hilo.innerHTML = '<div class="cop-vacio"><p><b>El copiloto está apagado.</b> ' + (enCandado() ? 'Lo prende quien administra XENCRM.' : 'Se prende en Configuración › Agente.') + '</p>' + (enCandado() ? '' : '<button type="button" class="btn sm" data-cop-config>Ir a Configuración › Agente</button>') + '</div>';
    } else {
      hilo.innerHTML = (COP.mensajes.length ? COP.mensajes.map(copMensaje).join('') : copSugerencias()) +
        (COP.ocupado ? '<div class="cop-msj xen cargando" aria-busy="true"><span class="fx-esq fx-esq-linea" style="width:70%"></span><span class="fx-esq fx-esq-linea" style="width:90%"></span><span class="cop-meta">Consultando el CRM…</span></div>' : '');
    }
    $('cop-enviar').disabled = COP.ocupado || COP.estado === 'apagado';
    $('cop-texto').disabled = COP.estado === 'apagado';
    hilo.scrollTop = hilo.scrollHeight;
    if (teniaFoco && !$('cop-texto').disabled) $('cop-texto').focus();
    hilo.querySelectorAll('[data-cop-sug]').forEach(function (b) { b.onclick = function () { copPreguntar(b.getAttribute('data-cop-sug')); }; });
    hilo.querySelectorAll('[data-cop-config]').forEach(function (b) { b.onclick = function () { copCerrar(); go('agent'); }; });
    hilo.querySelectorAll('[data-cop-reintentar]').forEach(function (b) {
      b.onclick = function () {
        var i = Number(b.getAttribute('data-cop-reintentar'));
        COP.mensajes.splice(i, 1);
        copPedir();
      };
    });
    hilo.querySelectorAll('.cop-enlace').forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-eid');
        if (b.getAttribute('data-tipo') === 'ticket') abrirTicket(Number(id)); else abrirPerfil(id);
      };
    });
    hilo.querySelectorAll('[data-cop-hacer]').forEach(function (b) {
      b.onclick = function () {
        var ij = b.getAttribute('data-cop-hacer').split(':'), p = COP.mensajes[Number(ij[0])].propuestas[Number(ij[1])];
        b.disabled = true;
        // Aprobar es llamar la ruta que trae, la de siempre: valida, firma con tu nombre y respeta el candado.
        api('/' + p.ruta.ruta, { method: p.ruta.metodo, body: p.ruta.cuerpo || {} }).then(function (r) {
          if (r && r.error) { p.error = r.error; }
          else { p.estado = 'hecha'; delete p.error; toast('Hecho: ' + p.resumen); }
          copGuardar(); pintarCopiloto();
        }).catch(function () { p.error = 'No se pudo: revisa la conexión.'; copGuardar(); pintarCopiloto(); });
      };
    });
    hilo.querySelectorAll('[data-cop-descartar]').forEach(function (b) {
      b.onclick = function () { var ij = b.getAttribute('data-cop-descartar').split(':'); COP.mensajes[Number(ij[0])].propuestas[Number(ij[1])].estado = 'descartada'; copGuardar(); pintarCopiloto(); };
    });
  }
  function copPedir() {
    COP.ocupado = true; pintarCopiloto();
    var mensajes = COP.mensajes.filter(function (m) { return !m.error; }).map(function (m) { return { rol: m.rol, texto: m.texto || '' }; });
    fetch(BASE + '/admin/api/copiloto', { method: 'POST', headers: Object.assign({ 'content-type': 'application/json', 'x-admin-token': state.token }, state.name ? { 'x-xencrm-quien': encodeURIComponent(state.name) } : {}), body: JSON.stringify({ mensajes: mensajes }) })
      .then(function (res) {
        if (res.status === 401) { showLogin('Token inválido'); throw new Error('401'); }
        return res.json().then(function (r) { return { status: res.status, r: r }; });
      })
      .then(function (x) {
        COP.ocupado = false;
        if (x.status === 409 && /apagado/.test((x.r && x.r.error) || '')) { COP.estado = 'apagado'; pintarCopiloto(); return; }
        if (x.status >= 400 || !x.r || x.r.error) COP.mensajes.push({ rol: 'xen', error: (x.r && x.r.error) || 'El servidor no contestó.', irAConfig: x.status === 409 && /Modelos de IA/.test((x.r && x.r.error) || '') });
        else COP.mensajes.push({ rol: 'xen', texto: x.r.texto, hechos: x.r.hechos, propuestas: (x.r.propuestas || []).map(function (p) { return Object.assign({}, p, { estado: 'pendiente' }); }), enlaces: x.r.enlaces, llamadas: x.r.llamadas, agotado: x.r.agotado });
        copGuardar(); pintarCopiloto();
      })
      .catch(function (e) {
        COP.ocupado = false;
        if (String(e && e.message) !== '401') COP.mensajes.push({ rol: 'xen', error: 'Revisa la conexión y vuelve a intentar.' });
        pintarCopiloto();
      });
  }
  function copPreguntar(texto) {
    texto = String(texto || '').trim();
    if (!texto || COP.ocupado) return;
    COP.mensajes.push({ rol: 'usuario', texto: texto });
    $('cop-texto').value = '';
    copGuardar();
    copPedir();
  }
  function copAbrir() {
    var dlg = $('dlg-copiloto');
    $('cop-t').textContent = 'Pregúntale a ' + copAgente();
    if (!dlg.open) dlg.show();
    $('fx-copiloto').setAttribute('aria-expanded', 'true');
    COP.estado = null;
    pintarCopiloto();
    $('cop-texto').focus();
  }
  function copCerrar() {
    var dlg = $('dlg-copiloto');
    if (dlg.open) dlg.close();
    $('fx-copiloto').setAttribute('aria-expanded', 'false');
    $('fx-copiloto').focus();
  }
  $('fx-copiloto').onclick = function () { if ($('dlg-copiloto').open) copCerrar(); else copAbrir(); };
  $('cop-cerrar').onclick = copCerrar;
  $('cop-nueva').onclick = function () { if (COP.ocupado) return; COP.mensajes = []; copGuardar(); pintarCopiloto(); $('cop-texto').focus(); };
  $('cop-form').onsubmit = function (e) { e.preventDefault(); copPreguntar($('cop-texto').value); };
  // Enter pregunta; Mayúsculas+Enter, otra línea. Escape cierra (un <dialog> abierto con show() no lo hace solo).
  $('cop-texto').onkeydown = function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); copPreguntar($('cop-texto').value); } };
  // En el documento y no en el diálogo: si el foco quedó fuera (en el tablero de al lado), Escape igual lo cierra.
  // No si hay un modal encima (la ficha, un ticket): ese Escape es suyo.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !$('dlg-copiloto').open) return;
    var modal = false;
    try { modal = Boolean(document.querySelector('dialog:modal')); } catch (err) {}
    if (modal) return;
    e.preventDefault();
    copCerrar();
  });


  // ===== XEN · Los agentes del negocio (src/agentico/agentes.ts) =====
  // Uno o varios: quién atiende qué y por dónde, con su voz si atiende llamadas. Sin ninguno configurado atiende el
  // de siempre. Se guarda la lista entera (todo o nada) y el servidor dice qué campo no sirve.
  var AG = { datos: null, editando: null, error: null };
  // 🪤 Se arma al pintar, no al cargar: el vocabulario del negocio («Demos») llega después, con /me.
  var AG_AREAS = { ventas: 'Ventas', soporte: 'Soporte', informacion: 'Información' };
  Object.defineProperty(AG_AREAS, 'agenda', { enumerable: true, get: function () { return VOC.Citas; } });
  var AG_CANALES = { whatsapp: 'WhatsApp', web: 'Chat del sitio', voz: 'Voz (desde el chat)', telefono: 'Teléfono (SIP)' };
  function agSlug(nombre, lista) {
    var base = String(nombre || 'agente').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'agente';
    if (base.length < 2) base = 'agente-' + base;
    var id = base, n = 2;
    while (lista.some(function (a) { return a.id === id; })) id = base + '-' + n++;
    return id;
  }
  function agFicha(a, i, puede) {
    var chips = function (lista, nombres) { return lista.map(function (x) { return '<span class="chip">' + esc(nombres[x] || x) + '</span>'; }).join(''); };
    return '<li class="ag-fila' + (a.activo ? '' : ' inactivo') + '"><div class="ag-quien"><b>' + esc(a.nombre) + '</b>' + (a.activo ? '' : ' <span class="chip">Pausado</span>') +
      '<span class="ag-chips">' + chips(a.atiende, AG_AREAS) + '</span><span class="ag-chips">' + chips(a.canales, AG_CANALES) + ((a.canales.indexOf('voz') >= 0 || a.canales.indexOf('telefono') >= 0) && a.voz ? '<span class="small muted">voz «' + esc(a.voz.voz) + '» · ' + esc(a.voz.idioma) + '</span>' : '') + '</span>' +
      (a.instrucciones ? '<span class="small muted ag-instr">' + esc(a.instrucciones) + '</span>' : '') + '</div>' +
      (puede ? '<div class="ag-acc"><button type="button" class="btn sm" data-ag-editar="' + i + '">Editar</button><button type="button" class="btn sm" data-ag-quitar="' + i + '">Quitar</button></div>' : '') + '</li>';
  }
  function agFormulario(a) {
    var marcar = function (grupo, valores, nombres) {
      return Object.keys(nombres).map(function (k) { return '<label class="ag-op"><input type="checkbox" name="' + grupo + '" value="' + k + '"' + (valores.indexOf(k) >= 0 ? ' checked' : '') + '> ' + esc(nombres[k]) + '</label>'; }).join('');
    };
    var voces = (AG.datos.voces || ['eve']).map(function (v) { return '<option value="' + esc(v) + '"' + ((a.voz && a.voz.voz) === v ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('');
    var conVoz = a.canales.indexOf('voz') >= 0 || a.canales.indexOf('telefono') >= 0;
    var err = AG.error;
    var campo = function (nombre) { return err && err.campo && err.campo.split('.').pop() === nombre; };
    return '<form class="ag-form" id="ag-form" novalidate>' +
      '<label for="ag-nombre">Nombre</label><input id="ag-nombre" maxlength="40" autocomplete="off" value="' + esc(a.nombre) + '" placeholder="Sofía"' + (campo('nombre') ? ' aria-invalid="true" aria-describedby="ag-error"' : '') + '>' +
      '<fieldset><legend>Qué atiende</legend>' + marcar('atiende', a.atiende, AG_AREAS) + '</fieldset>' +
      '<fieldset><legend>Por dónde</legend>' + marcar('canales', a.canales, AG_CANALES) + '</fieldset>' +
      '<div class="ag-voz"' + (conVoz ? '' : ' hidden') + '><label for="ag-voz">Voz de Grok</label><select id="ag-voz">' + voces + '</select>' +
      '<label for="ag-idioma">Idioma de quien llama</label><input id="ag-idioma" maxlength="5" autocomplete="off" value="' + esc((a.voz && a.voz.idioma) || 'es-CO') + '" placeholder="es-CO"></div>' +
      '<label for="ag-instr">Instrucciones (opcional)</label><textarea id="ag-instr" rows="3" maxlength="1500" placeholder="Cómo atiende: el tono, qué ofrece primero, qué no hace…">' + esc(a.instrucciones || '') + '</textarea>' +
      '<label class="ag-op"><input type="checkbox" id="ag-activo"' + (a.activo ? ' checked' : '') + '> Activo</label>' +
      (err ? '<p class="ag-error" id="ag-error" role="alert" tabindex="-1">' + esc(err.error) + '</p>' : '') +
      '<div class="feed-row"><button type="submit" class="btn primary">Guardar agente</button><button type="button" class="btn" id="ag-cancelar">Cancelar</button></div></form>';
  }
  function agentesPanel() {
    var d = AG.datos;
    if (!d) return '<div class="panel" id="agentes-panel"><b>Agentes</b><span class="fx-esq fx-esq-linea" style="width:60%"></span></div>';
    var puede = !enCandado(), lista = d.agentes;
    var voz = d.voz || {};
    var estadoVoz = voz.ok ? '<p class="ag-voz-ok small">' + svgXen('check') + 'La voz está lista: ' + esc(voz.agente) + ' atiende llamadas desde la ventana de chat (botón «Hablar con ' + esc(voz.agente) + '»).</p>'
      : lista.some(function (a) { return a.canales.indexOf('voz') >= 0; }) ? '<p class="ag-voz-falta small">' + esc(voz.motivo || 'La voz no está disponible.') + '</p>' : '';
    var cuerpo = AG.editando !== null
      ? agFormulario(AG.editando.agente)
      : '<ul class="ag-lista">' + (lista.length ? lista.map(function (a, i) { return agFicha(a, i, puede); }).join('') : '<li class="ag-fila"><div class="ag-quien"><b>' + esc(d.principal.nombre) + '</b><span class="small muted">El de siempre: atiende todo por WhatsApp y el chat del sitio. Agrega agentes para repartir el trabajo o atender por voz.</span></div></li>') + '</ul>' +
        (puede ? '<div class="feed-row"><button type="button" class="btn" id="ag-agregar">Agregar un agente</button></div>' : '');
    return '<div class="panel" id="agentes-panel"><b>Agentes</b><p class="small muted">Quién atiende a tus clientes, qué y por dónde. Cada conversación queda con un agente; si el cliente cambia de tema a algo que atiende otro, lo toma ese y se presenta.</p>' + estadoVoz + cuerpo + '<div class="small" role="status" id="ag-msg"></div></div>';
  }
  function pintarAgentes() {
    if (!$('agentes-panel')) return;
    $('agentes-panel').outerHTML = agentesPanel();
    var lista = AG.datos ? AG.datos.agentes : [];
    if ($('ag-agregar')) $('ag-agregar').onclick = function () {
      // El primero hereda el nombre del de siempre: lo normal es partir de él y repartir.
      var nombre = lista.length ? '' : AG.datos.principal.nombre;
      AG.editando = { i: -1, agente: { id: '', nombre: nombre, activo: true, atiende: ['informacion'], canales: ['whatsapp', 'web'], instrucciones: '' } };
      AG.error = null; pintarAgentes(); $('ag-nombre').focus();
    };
    document.querySelectorAll('#agentes-panel [data-ag-editar]').forEach(function (b) {
      b.onclick = function () { var i = Number(b.getAttribute('data-ag-editar')); AG.editando = { i: i, agente: JSON.parse(JSON.stringify(lista[i])) }; AG.error = null; pintarAgentes(); $('ag-nombre').focus(); };
    });
    document.querySelectorAll('#agentes-panel [data-ag-quitar]').forEach(function (b) {
      b.onclick = function () {
        var i = Number(b.getAttribute('data-ag-quitar')), nueva = lista.filter(function (_, k) { return k !== i; });
        agGuardar(nueva, 'Quitado: ' + lista[i].nombre + '.' + (nueva.length ? '' : ' Vuelve a atender ' + AG.datos.principal.nombre + ', el de siempre.'));
      };
    });
    var form = $('ag-form');
    if (!form) return;
    // La voz y el idioma, para los que hablan: la llamada desde el chat y el teléfono.
    form.querySelectorAll('input[name="canales"]').forEach(function (c) { c.onchange = function () { form.querySelector('.ag-voz').hidden = !form.querySelector('input[name="canales"][value="voz"]:checked, input[name="canales"][value="telefono"]:checked'); }; });
    $('ag-cancelar').onclick = function () { AG.editando = null; AG.error = null; pintarAgentes(); };
    form.onsubmit = function (e) {
      e.preventDefault();
      var marcados = function (g) { return Array.prototype.map.call(form.querySelectorAll('input[name="' + g + '"]:checked'), function (x) { return x.value; }); };
      var ed = AG.editando, a = ed.agente;
      a.nombre = $('ag-nombre').value.trim();
      a.atiende = marcados('atiende');
      a.canales = marcados('canales');
      a.instrucciones = $('ag-instr').value;
      a.activo = $('ag-activo').checked;
      if (a.canales.indexOf('voz') >= 0 || a.canales.indexOf('telefono') >= 0) a.voz = { voz: $('ag-voz').value, idioma: $('ag-idioma').value.trim() || 'es-CO' }; else delete a.voz;
      if (!a.id) a.id = agSlug(a.nombre, lista);
      var nueva = lista.slice();
      if (ed.i < 0) nueva.push(a); else nueva[ed.i] = a;
      agGuardar(nueva, 'Guardado: ' + a.nombre + '.');
    };
  }
  function agGuardar(nueva, dice) {
    api('/agentes', { method: 'PUT', body: { agentes: nueva } }).then(function (r) {
      if (!r || r.error) {
        AG.error = r && r.error ? r : { error: 'No se pudo guardar.' };
        pintarAgentes();
        // El foco al campo que no sirve si se sabe cuál (el nombre); si no, al aviso, que se lee entero.
        var invalido = document.querySelector('#ag-form [aria-invalid="true"]');
        if (invalido) invalido.focus(); else if ($('ag-error')) $('ag-error').focus();
        return;
      }
      AG.datos.agentes = r.agentes; AG.datos.voz = r.voz; AG.editando = null; AG.error = null;
      pintarAgentes();
      $('ag-msg').textContent = dice;
      toast(dice);
    }).catch(function () { AG.error = { error: 'No se pudo guardar: revisa la conexión. Lo que escribiste sigue ahí.' }; pintarAgentes(); });
  }
  function cargarAgentes() {
    api('/agentes').then(function (d) { if (d && !d.error) { AG.datos = d; pintarAgentes(); } }).catch(function () { if ($('agentes-panel')) $('agentes-panel').innerHTML = '<b>Agentes</b><p class="small" role="alert">No se pudieron cargar los agentes. <button type="button" class="btn sm" id="ag-reintentar">Reintentar</button></p>'; if ($('ag-reintentar')) $('ag-reintentar').onclick = cargarAgentes; });
  }

  arrancarConReglas();
})();

// Los botones que solo cierran su diálogo (`data-cerrar="dlg-…"`). 🪤 Iban con `onclick` escrito en la página, y la
// CSP no deja correr nada escrito en línea que no traiga su huella: con ella puesta, «Ahora no» y «Cerrar» dejaban
// de hacer nada sin decir por qué.
document.addEventListener('click', function (e) {
  var b = e.target && e.target.closest && e.target.closest('[data-cerrar]');
  var dlg = b && document.getElementById(b.getAttribute('data-cerrar'));
  if (dlg && dlg.open) dlg.close();
});
