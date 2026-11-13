// Pruebas del modo agéntico, sin modelo ni red: pnpm test:agentico
//
// Un `fetch` de mentira hace de OpenAI y de Claude: contesta lo que cada prueba quiere (pedir una herramienta, otra,
// contestar) y guarda lo que le llegó, para revisar el formato. Se prueba:
//  · los dos formatos de herramientas (Chat Completions y Messages API), ida y vuelta;
//  · el bucle: herramienta que no existe, datos que no sirven, tope de pasos y de gasto, lo mismo dos veces, lo
//    propuesto que no se ejecuta, el candado;
//  · el lado del cliente: el cliente lo pone el código, sus tickets y no los de otro, abrir un ticket (y no dos),
//    pasar a una persona, pedir una cita, y la guarda contra un ticket inventado;
//  · el asistente de verdad (handleMessage) con el modo prendido y apagado;
//  · el copiloto: consulta, hace lo seguro, propone lo demás con la ruta exacta, nunca le escribe a un cliente;
//    la ruta y su interruptor;
//  · lo mínimo de la vista.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'xencrm-agentico-'));
const base = JSON.parse(readFileSync(new URL('../../xencrm.config.example.json', import.meta.url), 'utf8')) as Record<string, unknown>;
writeFileSync(join(dir, 'xencrm.config.json'), JSON.stringify({ ...base, timezone: 'America/Bogota', appointments: { enabled: true, service: 'demo', location: 'videollamada', durationMin: 60, days: [1, 2, 3, 4, 5], hours: [['09:00', '12:00']], capacity: 2, minLeadHours: 0, maxDaysAhead: 60 } }));
writeFileSync(join(dir, '.env'), '');
Object.assign(process.env, {
  XENCRM_CONFIG: join(dir, 'xencrm.config.json'),
  XENCRM_ENV_FILE: join(dir, '.env'),
  DB_PATH: join(dir, 'xencrm.db'),
  WHATSAPP_ENABLED: 'false',
  ADMIN_TOKEN: 'token-del-tablero-de-prueba-0123456789',
  LLM_ENGINE: 'router',
  LIGHT_ENGINE: 'openai',
  HEAVY_ENGINE: 'openai',
  GATE_ENGINE: 'openai',
  ANALYSIS_ENGINE: 'openai',
  OPENAI_API_KEY: 'clave-de-prueba',
  OPENAI_BASE_URL: 'http://openai.prueba/v1',
  OPENAI_MODEL: 'gpt-4o-mini',
  ANTHROPIC_API_KEY: 'clave-de-claude-de-prueba',
  ANTHROPIC_BASE_URL: 'http://claude.prueba/v1',
  EMBED_ENGINE: 'ollama',
  OLLAMA_URL: 'http://ollama.prueba',
  TOPE_USD_MES: '',
});

type Cuerpo = Record<string, any>;
const llegadas: { url: string; cuerpo: Cuerpo }[] = [];
/** Lo que contesta el modelo de mentira: una función de lo que le llegó. */
let contesta: (url: string, c: Cuerpo) => unknown = () => ({});
globalThis.fetch = (async (url: string | URL | Request, op?: RequestInit) => {
  const u = String(url);
  if (u.startsWith('http://ollama.prueba')) throw new Error('fetch failed: sin Ollama en la prueba');
  const cuerpo = JSON.parse(String(op?.body ?? '{}')) as Cuerpo;
  llegadas.push({ url: u, cuerpo });
  return new Response(JSON.stringify(contesta(u, cuerpo)), { status: 200, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;

/** Una respuesta de Chat Completions: texto, o herramientas pedidas. */
const oa = (texto: string | null, pide: { id?: string; nombre: string; args: unknown }[] = [], uso = { prompt_tokens: 1000, completion_tokens: 50 }) => ({
  choices: [{ finish_reason: pide.length ? 'tool_calls' : 'stop', message: { content: texto, ...(pide.length ? { tool_calls: pide.map((p, i) => ({ id: p.id ?? `call_${i}`, type: 'function', function: { name: p.nombre, arguments: JSON.stringify(p.args) } })) } : {}) } }],
  usage: uso,
});
/** Una respuesta de la Messages API. */
const cl = (texto: string, pide: { id?: string; nombre: string; args: unknown }[] = []) => ({
  stop_reason: pide.length ? 'tool_use' : 'end_turn',
  content: [...(texto ? [{ type: 'text', text: texto }] : []), ...pide.map((p, i) => ({ type: 'tool_use', id: p.id ?? `toolu_${i}`, name: p.nombre, input: p.args }))],
  usage: { input_tokens: 800, output_tokens: 40, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
});
/** Lo que el modelo recibió como resultados de herramientas en la última llamada (formato OpenAI). */
const resultadosOA = (c: Cuerpo): string[] => (c.messages as { role: string; content: string }[]).filter((m) => m.role === 'tool').map((m) => m.content);
/** Cuántas veces ya habló el modelo en esta conversación de herramientas (mensajes del asistente con herramientas). */
const vueltas = (c: Cuerpo) => (c.messages as { role: string; tool_calls?: unknown[] }[]).filter((m) => m.role === 'assistant' && m.tool_calls).length;

const H = await import('../llm/herramientas.js');
const N = await import('../agentico/nucleo.js');
const CLI = await import('../agentico/cliente.js');
const EQ = await import('../agentico/equipo.js');
const { z } = await import('zod');
const { touchUser } = await import('../agent/memory.js');
const { getContact, updateContact, listEvents, setHumanMode } = await import('../crm/contacts.js');
const { crearTicket, listarTickets } = await import('../crm/tickets.js');
const { handleMessage } = await import('../agent/agent.js');
const { frenoDelCandado } = await import('../channels/candado.js');
const { getDb } = await import('../rag/store.js');
const { Hono } = await import('hono');
const { mountAdmin } = await import('../channels/admin.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};
const cliente = (id: string, nombre: string, data: Record<string, unknown> = {}) => {
  touchUser(id, 'whatsapp', nombre);
  updateContact(id, { data }, { silent: true });
  return id;
};
const ANA = cliente('wa:573001110001@s.whatsapp.net', 'Ana Duarte', { empresa: 'Distribuidora Duarte' });
const OTRO = cliente('wa:573001110002@s.whatsapp.net', 'Pedro Gómez', { empresa: 'Café Aroma' });
const ctxCliente = (userId: string) => ({ lado: 'cliente' as const, userId, por: 'Xen (agente)', now: Date.now() });

// ---------------------------------------------------------------------------------------------------------------
console.log('— Los dos formatos de herramientas');
{
  const pasos: import('../llm/herramientas.js').Paso[] = [
    { rol: 'usuario', texto: 'hola' },
    { rol: 'asistente', texto: 'Hola, ¿en qué te ayudo?', llamadas: [] },
    { rol: 'usuario', texto: '¿cómo va mi ticket?' },
    { rol: 'asistente', texto: '', llamadas: [{ id: 'c1', nombre: 'mis_tickets', args: {}, crudo: '{}' }] },
    { rol: 'resultados', resultados: [{ id: 'c1', contenido: '{"tickets":[]}' }] },
  ];
  const o = H.paraOpenAI('SISTEMA', pasos) as Cuerpo[];
  check('OpenAI: el sistema primero, la llamada como tool_calls y el resultado como mensaje «tool» con su id', o[0]!.role === 'system' && o[4]!.tool_calls?.[0]?.function?.name === 'mis_tickets' && o[4]!.content === null && o[5]!.role === 'tool' && o[5]!.tool_call_id === 'c1', JSON.stringify(o.slice(3)));
  const c = H.paraClaudeConHerramientas(pasos) as Cuerpo[];
  check('Claude: lo conversado en texto, la llamada como tool_use y el resultado como tool_result del usuario', c[c.length - 2]!.role === 'assistant' && c[c.length - 2]!.content[0].type === 'tool_use' && c[c.length - 1]!.role === 'user' && c[c.length - 1]!.content[0].type === 'tool_result' && c[c.length - 1]!.content[0].tool_use_id === 'c1', JSON.stringify(c.slice(-2)));
  check('🪤 Claude: alternados y empezando por el usuario', c.every((m, i) => (i % 2 === 0 ? m.role === 'user' : m.role === 'assistant')), c.map((m) => m.role).join(','));
  const def = [{ nombre: 'mis_tickets', descripcion: 'x', parametros: { type: 'object', properties: {} } }];
  contesta = () => oa(null, [{ nombre: 'mis_tickets', args: {} }]);
  llegadas.length = 0;
  const r = await H.openaiConHerramientas({ sistema: 'S', pasos: [{ rol: 'usuario', texto: 'hola' }], herramientas: def, modelo: 'gpt-4o-mini' });
  check('OpenAI: las herramientas van como «function» y la respuesta trae la llamada leída', llegadas[0]!.cuerpo.tools[0].type === 'function' && llegadas[0]!.cuerpo.tools[0].function.name === 'mis_tickets' && r.llamadas[0]!.nombre === 'mis_tickets' && r.fin === 'herramientas');
  check('y lo que costó', typeof r.costoUsd === 'number' && r.costoUsd > 0, String(r.costoUsd));
  contesta = () => oa('listo');
  await H.openaiConHerramientas({ sistema: 'S', pasos: [{ rol: 'usuario', texto: 'hola' }], herramientas: def, sinHerramientas: true, modelo: 'gpt-4o-mini' });
  check('la última vuelta va con tool_choice «none»', llegadas[1]!.cuerpo.tool_choice === 'none');
  await H.openaiConHerramientas({ sistema: 'S', pasos: [{ rol: 'usuario', texto: 'hola' }], herramientas: [], modelo: 'gpt-4o-mini' });
  check('🪤 sin herramientas no se manda «tools: []» (Chat Completions lo rechaza)', !('tools' in llegadas[2]!.cuerpo));
  contesta = () => cl('', [{ nombre: 'mis_tickets', args: {} }]);
  const rc = await H.claudeConHerramientas({ sistema: 'S', pasos: [{ rol: 'usuario', texto: 'hola' }], herramientas: def, modelo: 'claude-haiku-5-5' });
  check('Claude: input_schema, la caché en lo fijo y la llamada leída', llegadas[3]!.cuerpo.tools[0].input_schema.type === 'object' && JSON.stringify(llegadas[3]!.cuerpo.system).includes('cache_control') && rc.llamadas[0]!.nombre === 'mis_tickets');
}

// ---------------------------------------------------------------------------------------------------------------
console.log('— El bucle');
{
  let ejecutadas = 0;
  const contar: import('../agentico/nucleo.js').Herramienta = { nombre: 'anotar', descripcion: 'anota', lado: 'cliente', efecto: 'seguro', args: z.object({ texto: z.string().min(2) }), ejecutar: () => (ejecutadas++, { datos: { ok: true } }) };
  const leer: import('../agentico/nucleo.js').Herramienta = { nombre: 'leer', descripcion: 'lee', lado: 'cliente', efecto: 'lectura', args: z.object({}), ejecutar: () => ({ datos: { dato: 'TK-0007 abierto' } }) };
  const corrida = (limites?: { pasos?: number; topeUsd?: number }) => N.correr({ motor: 'openai', sistema: 'S', pasos: [{ rol: 'usuario', texto: 'hola' }], herramientas: [contar, leer], ctx: ctxCliente(ANA), task: 'agente', limites });

  contesta = (_u, c) => (vueltas(c) === 0 ? oa(null, [{ nombre: 'borrar_todo', args: {} }]) : oa('ok'));
  let inf = await corrida();
  check('una herramienta que no existe se le dice al modelo, no revienta', inf.llamadas[0]!.ok === false && /No existe la herramienta «borrar_todo»/.test(inf.llamadas[0]!.respuesta) && inf.texto === 'ok');

  contesta = (_u, c) => (vueltas(c) === 0 ? oa(null, [{ nombre: 'anotar', args: { texto: 1 } }]) : oa('ok'));
  ejecutadas = 0;
  inf = await corrida();
  check('datos que no sirven no se ejecutan, y se dice por qué', ejecutadas === 0 && inf.llamadas[0]!.ok === false && /Los datos no sirven/.test(inf.llamadas[0]!.respuesta), inf.llamadas[0]?.respuesta);

  contesta = (_u, c) => (vueltas(c) === 0 ? oa(null, [{ id: 'a', nombre: 'anotar', args: { texto: 'hola' } }, { id: 'b', nombre: 'anotar', args: { texto: 'hola' } }]) : oa('ok'));
  ejecutadas = 0;
  inf = await corrida();
  check('lo mismo dos veces en un turno se hace una sola vez', ejecutadas === 1 && inf.llamadas.length === 2 && inf.llamadas.every((l) => l.ok), String(ejecutadas));

  contesta = (_u, c) => (c.tool_choice === 'none' ? oa('con lo que tengo') : oa(null, [{ nombre: 'leer', args: {} }]));
  llegadas.length = 0;
  inf = await corrida({ pasos: 3 });
  check('tope de pasos: tres vueltas con herramientas y una última sin ellas', inf.agotado === 'pasos' && inf.pasos === 4 && llegadas.length === 4 && llegadas[3]!.cuerpo.tool_choice === 'none' && inf.texto === 'con lo que tengo', JSON.stringify({ agotado: inf.agotado, pasos: inf.pasos }));
  check('lo que devolvieron las herramientas queda como evidencia', inf.evidencia.some((e) => e.includes('TK-0007')));

  llegadas.length = 0;
  inf = await corrida({ pasos: 8, topeUsd: 0.00001 });
  check('tope de gasto por turno: al pasarlo, contesta con lo que ya sabe', inf.agotado === 'costo' && llegadas.length === 2, JSON.stringify({ agotado: inf.agotado, llamadas: llegadas.length }));

  const equipo: import('../agentico/nucleo.js').Herramienta = { nombre: 'reglas', descripcion: 'cambia reglas', lado: 'equipo', efecto: 'seguro', args: z.object({}), ruta: () => ({ metodo: 'PUT', ruta: 'reglas' }), ejecutar: () => (ejecutadas++, { datos: { ok: true } }) };
  contesta = (_u, c) => (vueltas(c) === 0 ? oa(null, [{ nombre: 'reglas', args: {} }]) : oa('no pude'));
  ejecutadas = 0;
  inf = await N.correr({ motor: 'openai', sistema: 'S', pasos: [{ rol: 'usuario', texto: 'x' }], herramientas: [equipo], ctx: { lado: 'equipo', por: 'Laura (con Xen)', rol: 'asesor', modo: 'facil', now: Date.now() }, task: 'copiloto' });
  check('🪤 el candado decide con la ruta de la herramienta, como con el botón', ejecutadas === 0 && /No se puede: en el modo fácil eso lo cambia quien administra/.test(inf.llamadas[0]!.respuesta), inf.llamadas[0]?.respuesta);
  inf = await N.correr({ motor: 'openai', sistema: 'S', pasos: [{ rol: 'usuario', texto: 'x' }], herramientas: [equipo], ctx: { lado: 'cliente', userId: ANA, por: 'Xen', now: Date.now() }, task: 'agente' });
  check('una herramienta del equipo no existe para el agente del cliente', ejecutadas === 0 && /No existe la herramienta/.test(inf.llamadas[0]!.respuesta));
}

// ---------------------------------------------------------------------------------------------------------------
console.log('— Con los clientes');
{
  const props = CLI.HERRAMIENTAS_DEL_CLIENTE.flatMap((h) => Object.keys(((N.definicion(h).parametros as { properties?: object }).properties ?? {})));
  check('🪤 ninguna herramienta del cliente recibe a quién: el cliente lo pone el código', !props.some((p) => /contacto|cliente|user|^id$|telefono/i.test(p)), props.join(','));
  const herr = (n: string) => CLI.HERRAMIENTAS_DEL_CLIENTE.find((h) => h.nombre === n)! as Extract<import('../agentico/nucleo.js').Herramienta, { ejecutar: unknown }>;
  crearTicket({ contacto: OTRO, asunto: 'El POS no imprime facturas' }, 'Laura');
  const deAna = crearTicket({ contacto: ANA, asunto: 'No puedo entrar al portal' }, 'Laura');
  const suyos = (await herr('mis_tickets').ejecutar({}, ctxCliente(ANA))).datos as { tickets: { codigo: string; asunto: string }[] };
  check('mis_tickets trae los de este cliente y solo esos', suyos.tickets.length === 1 && suyos.tickets[0]!.codigo === deAna.codigo, JSON.stringify(suyos));
  const abierto = await herr('abrir_ticket').ejecutar({ asunto: 'La app de campo no sincroniza desde la 4.12', detalle: 'Desde el martes, a los tres técnicos' }, ctxCliente(ANA));
  const tk = (abierto.datos as { codigo: string }).codigo;
  const nuevo = listarTickets({ contacto: ANA, dias: 1 }).find((t) => t.codigo === tk);
  check('abrir_ticket lo abre a nombre de este cliente, firmado por el asistente', Boolean(nuevo) && nuevo!.creadoPor === 'Xen (agente)' && abierto.hecho?.herramienta === 'abrir_ticket', JSON.stringify(nuevo?.creadoPor));
  check('y lo que contó queda como nota en la ficha', listEvents(ANA, 100).some((e) => e.type === 'nota' && String(e.payload.texto).includes(`${tk} · Desde el martes`)));
  const otraVez = await herr('abrir_ticket').ejecutar({ asunto: 'Sigue sin sincronizar la app', detalle: '' }, ctxCliente(ANA));
  check('🪤 el mismo problema contado otra vez no abre otro: devuelve el que ya estaba', (otraVez.datos as { yaEstaba?: boolean; codigo: string }).yaEstaba === true && (otraVez.datos as { codigo: string }).codigo === tk && listarTickets({ contacto: ANA, dias: 1 }).length === 2);
  const persona = await herr('pasar_a_persona').ejecutar({ motivo: 'Está molesto por la demora' }, ctxCliente(OTRO));
  check('pasar_a_persona pone a una persona a cargo y termina el turno', persona.termina === 'persona' && getContact(OTRO)!.humanMode === true);
  setHumanMode(OTRO, false, 'Laura');
  check('pedir_cita le pasa la conversación al flujo de siempre', (await herr('pedir_cita').ejecutar({}, ctxCliente(ANA))).termina === 'cita');
  check('la guarda: un código que ninguna herramienta devolvió', CLI.ticketSinRespaldo('Listo, tu caso es el TK-0999.', { evidencia: [`{"codigo":"${tk}"}`], hechos: [] }) === 'TK-0999');
  check('la guarda: «te abrí un ticket» sin haberlo abierto', CLI.ticketSinRespaldo('Ya te abrí un ticket con el equipo.', { evidencia: [], hechos: [] }) === 'un ticket');
  check('la guarda deja pasar lo que sí se hizo', CLI.ticketSinRespaldo(`Te abrí el ticket ${tk}.`, { evidencia: [`{"abierto":true,"codigo":"${tk}"}`], hechos: [{ herramienta: 'abrir_ticket', resumen: '' }] }) === null);
}

// ---------------------------------------------------------------------------------------------------------------
console.log('— El asistente de verdad (handleMessage)');
{
  /** El modelo de mentira para un turno entero: clasifica, y en el turno con herramientas pide abrir un ticket. */
  const turnoCon = (texto: (codigo: string) => string) => (_u: string, c: Cuerpo) => {
    if (c.response_format) return oa(JSON.stringify({ intent: 'info_tienda', consulta_busqueda: 'soporte de la app' }));
    if (!c.tools) return oa('Lo dejo reportado al equipo y te escriben por aquí.');
    if (vueltas(c) === 0) return oa(null, [{ nombre: 'abrir_ticket', args: { asunto: 'El portal no carga los reportes' } }]);
    const codigo = /TK-\d{4}/.exec(resultadosOA(c).join(' '))?.[0] ?? 'TK-????';
    return oa(texto(codigo));
  };
  contesta = turnoCon((codigo) => `Listo, abrí el ticket ${codigo} y el equipo lo revisa hoy.`);
  N.ponerAgentico({ clientes: false });
  llegadas.length = 0;
  let r = await handleMessage({ userId: 'web:agente-1', channel: 'web', text: 'el portal no me carga los reportes desde ayer' });
  check('con el modo apagado, el asistente no ve herramientas', !llegadas.some((l) => l.cuerpo.tools) && !/agente/.test(r.route), r.route);

  N.ponerAgentico({ clientes: true });
  r = await handleMessage({ userId: 'web:agente-2', channel: 'web', text: 'el portal no me carga los reportes desde ayer' });
  const suyo = listarTickets({ contacto: 'web:agente-2', dias: 1 })[0];
  check('prendido: abre el ticket a nombre de quien escribe', Boolean(suyo) && suyo!.asunto === 'El portal no carga los reportes', JSON.stringify(suyo?.asunto));
  check('y le contesta con el código que devolvió la herramienta', Boolean(suyo) && r.text.includes(suyo!.codigo) && /agente \(abrir_ticket\)/.test(r.route), JSON.stringify({ text: r.text, route: r.route }));

  contesta = (_u, c) => {
    if (c.response_format) return oa(JSON.stringify({ intent: 'info_tienda', consulta_busqueda: 'soporte' }));
    if (!c.tools) return oa('Lo dejo reportado al equipo y te escriben por aquí.');
    return oa('Ya te abrí el ticket TK-0999, tranquilo.');
  };
  r = await handleMessage({ userId: 'web:agente-3', channel: 'web', text: 'la app no sincroniza' });
  check('🪤 si dice que abrió un ticket que nadie abrió, se rehace sin herramientas', !r.text.includes('TK-0999') && /sin inventar un ticket/.test(r.route) && listarTickets({ contacto: 'web:agente-3', dias: 1 }).length === 0, JSON.stringify({ text: r.text, route: r.route }));

  contesta = (_u, c) => {
    if (c.response_format) return oa(JSON.stringify({ intent: 'info_tienda', consulta_busqueda: 'demo' }));
    return oa(null, [{ nombre: 'pedir_cita', args: {} }]);
  };
  r = await handleMessage({ userId: 'web:agente-4', channel: 'web', text: 'quiero ver cómo funciona su software con alguien' });
  check('pedir_cita: contesta el flujo de citas, no el modelo', r.intent === 'cita' && /flujo de/.test(r.route), JSON.stringify({ text: r.text.slice(0, 80), route: r.route }));
  N.ponerAgentico({ clientes: false });
}

// ---------------------------------------------------------------------------------------------------------------
console.log('— El copiloto del equipo');
{
  const mensajesAntes = (getDb().prepare("SELECT COUNT(*) n FROM messages WHERE role = 'assistant'").get() as { n: number }).n;
  contesta = (_u, c) => {
    const v = vueltas(c);
    if (v === 0) return oa(null, [{ nombre: 'buscar_contactos', args: { texto: 'duarte' } }]);
    if (v === 1) return oa(null, [{ id: 'n', nombre: 'anotar_nota', args: { contactoId: ANA, texto: 'Pidió demo del módulo de rutas' } }, { id: 'e', nombre: 'mover_etapa', args: { contactoId: ANA, etapa: 'interesado' } }, { id: 'm', nombre: 'mensaje_al_cliente', args: { contactoId: ANA, texto: 'Hola Ana, ¿te sirve el jueves?' } }]);
    return oa('Anoté la nota y te dejé propuesto moverla a Interesado y el mensaje.');
  };
  const etapaAntes = getContact(ANA)!.stage;
  const r = await EQ.preguntarAlCopiloto({ mensajes: [{ rol: 'usuario', texto: 'anota que Duarte pidió demo de rutas y muévela a interesado' }], quien: 'Laura' });
  check('consulta y contesta', r.texto.startsWith('Anoté') && r.llamadas.map((l) => l.nombre).join() === 'buscar_contactos,anotar_nota,mover_etapa,mensaje_al_cliente', JSON.stringify(r.llamadas));
  check('lo seguro lo hace al momento, firmado «Laura (con Xen)»', r.hechos.some((h) => h.herramienta === 'anotar_nota') && listEvents(ANA, 200).some((e) => e.type === 'nota' && String(e.payload.por).startsWith('Laura (con ') && String(e.payload.texto).includes('rutas')));
  const mover = r.propuestas.find((p) => p.herramienta === 'mover_etapa');
  check('lo demás lo propone, con la ruta exacta que lo hace', Boolean(mover) && mover!.ruta.metodo === 'PATCH' && mover!.ruta.ruta === `contacts/${encodeURIComponent(ANA)}` && (mover!.ruta.cuerpo as { stage: string }).stage === 'interesado', JSON.stringify(mover));
  check('🪤 y propuesto no es hecho: la etapa no cambió', getContact(ANA)!.stage === etapaAntes);
  const msj = r.propuestas.find((p) => p.herramienta === 'mensaje_al_cliente');
  check('🪤 nunca le escribe a un cliente: el mensaje queda propuesto y no sale', Boolean(msj) && msj!.ruta.ruta.endsWith('/reply') && (getDb().prepare("SELECT COUNT(*) n FROM messages WHERE role = 'assistant'").get() as { n: number }).n === mensajesAntes);
  check('trae los enlaces para abrir la ficha', r.enlaces.some((e) => e.tipo === 'contacto' && e.id === ANA));
  const etapasValidas = (N.definicion(EQ.HERRAMIENTAS_DEL_EQUIPO.find((h) => h.nombre === 'mover_etapa')!).parametros as { properties: { etapa: { enum: string[] } } }).properties.etapa.enum;
  check('las etapas que puede proponer son las del negocio', etapasValidas.includes('interesado') && etapasValidas.length >= 3, etapasValidas.join(','));
}

// ---------------------------------------------------------------------------------------------------------------
console.log('— La ruta y el interruptor');
{
  const app = new Hono();
  mountAdmin(app as never);
  const HD = { 'x-admin-token': process.env.ADMIN_TOKEN!, 'content-type': 'application/json' };
  const pedir = (ruta: string, init: { method?: string; body?: unknown } = {}) => app.request(`/admin/api${ruta}`, { method: init.method ?? 'GET', headers: HD, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  const agente = (await (await pedir('/agent')).json()) as { agentico: { clientes: boolean; equipo: boolean; clientesPueden: boolean; copilotoPuede: boolean } };
  check('/agent dice cómo está el modo y si hay con qué', agente.agentico.clientes === false && agente.agentico.equipo === true && agente.agentico.clientesPueden && agente.agentico.copilotoPuede, JSON.stringify(agente.agentico));
  check('el interruptor se cambia', ((await (await pedir('/agent/agentico', { method: 'PUT', body: { clientes: true } })).json()) as { agentico: { clientes: boolean } }).agentico.clientes === true && N.agenticoConClientes());
  await pedir('/agent/agentico', { method: 'PUT', body: { clientes: false } });
  check('sin pregunta, 400', (await pedir('/copiloto', { method: 'POST', body: { mensajes: [] } })).status === 400);
  contesta = () => oa('Hoy no tienes nada pendiente.');
  const ok = await pedir('/copiloto', { method: 'POST', body: { mensajes: [{ rol: 'usuario', texto: '¿qué tengo pendiente?' }] } });
  check('POST /copiloto contesta', ok.status === 200 && ((await ok.json()) as { texto: string }).texto === 'Hoy no tienes nada pendiente.');
  await pedir('/agent/agentico', { method: 'PUT', body: { equipo: false } });
  check('apagado, el copiloto lo dice (409)', (await pedir('/copiloto', { method: 'POST', body: { mensajes: [{ rol: 'usuario', texto: 'hola' }] } })).status === 409);
  N.ponerAgentico({ equipo: true });
  check('el candado deja preguntarle al copiloto (lo que haga pide su propio permiso)', frenoDelCandado('copiloto', 'POST', 'asesor', 'facil') === null);
  check('🪤 pero prender el modo agéntico es de quien administra', frenoDelCandado('agent/agentico', 'PUT', 'asesor', 'facil') !== null);
}

// ---------------------------------------------------------------------------------------------------------------
console.log('— Lo mínimo de la vista');
{
  const html = readFileSync(new URL('../../public/admin.html', import.meta.url), 'utf8');
  const js = readFileSync(new URL('../../public/admin.js', import.meta.url), 'utf8');
  const bloque = js.slice(js.indexOf('// ===== XEN · El copiloto del equipo'), js.lastIndexOf('})();'));
  check('el botón de arriba abre el copiloto (un diálogo que no es modal: el tablero sigue usable)', /id="fx-copiloto" aria-haspopup="dialog" aria-controls="dlg-copiloto"/.test(html) && bloque.includes("if (!dlg.open) dlg.show();"));
  check('la conversación es un registro que se anuncia, y la pregunta tiene su etiqueta', /id="cop-hilo" role="log" aria-live="polite"/.test(html) && /<label class="sr-only" for="cop-texto">Tu pregunta<\/label>/.test(html));
  check('pregunta a /copiloto con la conversación entera, que vive en el navegador', bloque.includes("'/admin/api/copiloto'") && bloque.includes("sessionStorage.setItem(LLAVE('copiloto')"));
  check('🪤 aprobar es llamar la ruta que trae la propuesta, la de siempre', bloque.includes("api('/' + p.ruta.ruta, { method: p.ruta.metodo, body: p.ruta.cuerpo || {} })"));
  check('Escape lo cierra, salvo que haya un modal encima, y el foco vuelve al botón', bloque.includes("document.querySelector('dialog:modal')") && bloque.includes("$('fx-copiloto').focus();"));
  check('🪤 repintar no deja el foco en el <body>', bloque.includes('var teniaFoco = hilo.contains(document.activeElement);'));
  check('el panel del modo agéntico: prender es de quien administra', js.includes('function agenticoPanel(a)') && js.includes('puede = !enCandado()') && js.includes("api('/agent/agentico', { method: 'PUT'"));
  check('en el celular el copiloto ocupa la pantalla', html.includes(':root[data-piel="xen"] dialog.copiloto[open]{inset:0;width:100%;height:100dvh'));
}

console.log(fail ? `\n${fail} prueba(s) fallaron` : '\nTodo bien');
process.exit(fail ? 1 : 0);
