// Pruebas del teléfono por SIP (3CX, Twilio, Telnyx…) con un agente de voz de Grok, sin red: pnpm test:telefono
//
// Un `fetch` de mentira hace de la API REST de xAI (colgar, transferir) y un Grok de mentira de la sesión de la
// llamada. Se prueba:
//  · la firma del aviso de xAI (Standard Webhooks): buena, alterada, vieja, repetida, con dos firmas, sin secreto;
//  · quién llama, de las cabeceras SIP (nombre y número, oculto, una extensión);
//  · cuándo está listo el teléfono y por qué no;
//  · una llamada entera: la ficha tel:+57…, la misma persona que su WhatsApp, la sesión para teléfono (sin formato de
//    audio, con colgar y sin pedir_cita), la transcripción, un ticket, la transferencia a la central y colgar;
//  · sin agente o sin cupo: se pasa al desvío o se cuelga;
//  · la ruta del aviso y la tarjeta del canal;
//  · lo mínimo de la vista.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { createHmac, randomBytes } from 'node:crypto';

const dir = mkdtempSync(join(tmpdir(), 'xencrm-telefono-'));
const base = JSON.parse(readFileSync(new URL('../../xencrm.config.example.json', import.meta.url), 'utf8')) as Record<string, unknown>;
writeFileSync(join(dir, 'xencrm.config.json'), JSON.stringify({ ...base, timezone: 'America/Bogota' }));
writeFileSync(join(dir, '.env'), '');
const SECRETO = `whsec_${randomBytes(24).toString('base64')}`;
Object.assign(process.env, {
  XENCRM_CONFIG: join(dir, 'xencrm.config.json'),
  XENCRM_ENV_FILE: join(dir, '.env'),
  DB_PATH: join(dir, 'xencrm.db'),
  WHATSAPP_ENABLED: 'false',
  ADMIN_TOKEN: 'token-del-tablero-de-prueba-0123456789',
  XAI_API_KEY: '',
  XAI_API_URL: 'http://xai.prueba/v1',
  XAI_SIP_SECRETO: '',
  XAI_SIP_DESVIO: '',
  PUBLIC_URL: 'https://crm.ejemplo.com',
  TOPE_USD_MES: '',
});

type Cuerpo = Record<string, any>;
const rest: { url: string; cuerpo: Cuerpo }[] = [];
globalThis.fetch = (async (url: string | URL | Request, op?: RequestInit) => {
  const u = String(url);
  if (!u.startsWith('http://xai.prueba')) throw new Error(`la prueba no sale a la red: ${u}`);
  rest.push({ url: u, cuerpo: JSON.parse(String(op?.body ?? '{}')) as Cuerpo });
  return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;

const { env } = await import('../config.js');
const TEL = await import('../voz/telefono.js');
const VZ = await import('../voz/llamada.js');
const AG = await import('../agentico/agentes.js');
const { touchUser, getHistory } = await import('../agent/memory.js');
const { getContact, listEvents, updateContact, guardarNumero } = await import('../crm/contacts.js');
const { findDuplicates } = await import('../crm/merge.js');
const { listarTickets } = await import('../crm/tickets.js');
const { setChannelOn } = await import('../channels/switches.js');
const { channelCards } = await import('../channels/registry.js');
const { getDb } = await import('../rag/store.js');
const { app: web } = await import('../channels/web.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mutable = env as { xaiApiKey: string; xaiSipSecreto: string; xaiSipDesvio: string };
/** Firma como xAI: base64(HMAC-SHA256(secreto, «id.timestamp.cuerpo»)). */
const firmar = (id: string, ts: number, cuerpo: string, secreto = SECRETO) => `v1,${createHmac('sha256', Buffer.from(secreto.slice(6), 'base64')).update(`${id}.${ts}.${cuerpo}`).digest('base64')}`;

// ---------------------------------------------------------------------------------------------------------------
console.log('— La firma del aviso de xAI');
{
  const cuerpo = JSON.stringify({ type: 'realtime.call.incoming', data: { call_id: 'rtc_x' } });
  const ts = Math.floor(Date.now() / 1000);
  check('una firma buena pasa', TEL.avisoValido(cuerpo, { id: 'msg_1', ts: String(ts), firma: firmar('msg_1', ts, cuerpo) }, SECRETO));
  check('🪤 el mismo aviso dos veces no (un reintento o alguien que lo repite)', !TEL.avisoValido(cuerpo, { id: 'msg_1', ts: String(ts), firma: firmar('msg_1', ts, cuerpo) }, SECRETO));
  check('con el cuerpo cambiado, no', !TEL.avisoValido(cuerpo.replace('rtc_x', 'rtc_y'), { id: 'msg_2', ts: String(ts), firma: firmar('msg_2', ts, cuerpo) }, SECRETO));
  check('de hace más de cinco minutos, no', !TEL.avisoValido(cuerpo, { id: 'msg_3', ts: String(ts - 400), firma: firmar('msg_3', ts - 400, cuerpo) }, SECRETO));
  check('con dos firmas (cambio de secreto), basta con que una sea buena', TEL.avisoValido(cuerpo, { id: 'msg_4', ts: String(ts), firma: `v1,AAAA ${firmar('msg_4', ts, cuerpo)}` }, SECRETO));
  check('sin secreto configurado, nada pasa', !TEL.avisoValido(cuerpo, { id: 'msg_5', ts: String(ts), firma: firmar('msg_5', ts, cuerpo) }, ''));
  check('sin cabeceras, nada pasa', !TEL.avisoValido(cuerpo, { id: null, ts: null, firma: null }, SECRETO));
}

// ---------------------------------------------------------------------------------------------------------------
console.log('— Quién llama');
check('nombre y número del From', JSON.stringify(TEL.quienLlama([{ name: 'From', value: '"Ana Duarte" <sip:+573001234567@troncal.com>;tag=9a' }])) === '{"numero":"573001234567","nombre":"Ana Duarte"}');
check('con tel: también', TEL.quienLlama([{ name: 'from', value: '<tel:+573001234567>' }]).numero === '573001234567');
check('número oculto: sin número ni nombre', JSON.stringify(TEL.quienLlama([{ name: 'From', value: '"Anonymous" <sip:anonymous@anonymous.invalid>' }])) === '{"numero":null,"nombre":null}');
check('una extensión interna no es un número al que volver', TEL.quienLlama([{ name: 'From', value: '<sip:102@central.3cx.us>' }]).numero === null);

// ---------------------------------------------------------------------------------------------------------------
console.log('— Cuándo está listo');
check('sin la llave de xAI', /XAI_API_KEY/.test(TEL.telefonoListo().motivo ?? ''));
mutable.xaiApiKey = 'clave-de-xai-de-prueba';
check('sin el secreto de firma', /XAI_SIP_SECRETO/.test(TEL.telefonoListo().motivo ?? ''));
mutable.xaiSipSecreto = SECRETO;
check('sin un agente que atienda por teléfono', /Teléfono/.test(TEL.telefonoListo().motivo ?? ''));
const guardado = AG.guardarAgentes([
  { id: 'mateo', nombre: 'Mateo', atiende: ['ventas', 'informacion'], canales: ['whatsapp', 'web'] },
  { id: 'eve', nombre: 'Eve', atiende: ['soporte', 'informacion'], canales: ['telefono'] },
]);
check('(un agente con el canal Teléfono, con su voz de fábrica)', 'agentes' in guardado && guardado.agentes[1]!.voz?.voz === 'eve', JSON.stringify(guardado));
setChannelOn('telefono', false);
check('con el canal apagado', /apagado/.test(TEL.telefonoListo().motivo ?? ''));
setChannelOn('telefono', true);
check('listo', TEL.telefonoListo().ok && TEL.telefonoListo().agente === 'Eve');

// ---------------------------------------------------------------------------------------------------------------
console.log('— Una llamada entera');
class Falso extends EventEmitter {
  readyState = 1;
  enviados: string[] = [];
  send(d: string) { this.enviados.push(d); }
  close() { if (this.readyState !== 3) { this.readyState = 3; this.emit('close', 1000, Buffer.from('')); } }
  json() { return this.enviados.map((x) => JSON.parse(x) as Cuerpo); }
}
const grokDe = new Map<string, Falso>();
VZ.cambiarConexion((callId?: string) => {
  const g = new Falso();
  grokDe.set(callId ?? '', g);
  return g as never;
});
// La misma persona ya escribió por WhatsApp.
const WA = 'wa:573001234567@s.whatsapp.net';
touchUser(WA, 'whatsapp', 'Ana Duarte');
updateContact(WA, { summary: 'Reportó que la app de campo no sincroniza' }, { silent: true });
guardarNumero(WA, null);
mutable.xaiSipDesvio = 'sip:100@empresa.3cx.us';
{
  const r = await TEL.atenderLlamadaTelefonica('rtc_1', [{ name: 'From', value: '"Ana Duarte" <sip:+573001234567@troncal.com>;tag=1' }, { name: 'To', value: '<sip:+576015550000@sip.voice.x.ai>' }]);
  const grok = grokDe.get('rtc_1')!;
  check('se atiende: XENCRM se une a la llamada por su call_id', r === 'atendida' && Boolean(grok));
  grok.emit('open');
  const sesion = grok.json()[0]!;
  check('la sesión es de teléfono: sin formato de audio (lo pone la troncal), con el idioma', sesion.type === 'session.update' && !sesion.session.audio.input.format && !sesion.session.audio.output && sesion.session.audio.input.transcription.language_hint === 'es-CO');
  check('con colgar y las herramientas del agente, sin pedir_cita', sesion.session.tools.some((t: Cuerpo) => t.name === 'colgar') && sesion.session.tools.some((t: Cuerpo) => t.name === 'abrir_ticket') && !sesion.session.tools.some((t: Cuerpo) => t.name === 'pedir_cita'));
  check('🪤 omnicanal: el agente sabe quién llama y de qué habló por WhatsApp', /Llama Ana Duarte desde el \+573001234567\. Ya habló con nosotros por WhatsApp como Ana Duarte: Reportó que la app de campo no sincroniza/.test(sesion.session.instructions), sesion.session.instructions.match(/## Quién llama[^#]*/)?.[0]);
  check('por teléfono no se habla de «dejarlo en el chat»', sesion.session.instructions.includes('## Por teléfono') && !sesion.session.instructions.includes('chat de esta misma ventana'));
  check('y contesta él primero (response.create)', grok.json()[1]?.type === 'response.create');
  const ficha = getContact('tel:+573001234567');
  check('la ficha es tel:+57…, del canal teléfono, con su número', ficha?.channel === 'telefono' && ficha?.phone === '+573001234567' && ficha?.name === 'Ana Duarte');
  check('🪤 y el CRM la reconoce como la misma persona que su WhatsApp', findDuplicates('tel:+573001234567').some((d) => d.contact.id === WA));
  grok.emit('message', Buffer.from(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'sigue sin sincronizar la app' })));
  grok.emit('message', Buffer.from(JSON.stringify({ type: 'response.output_audio_transcript.done', transcript: 'Ya te abro el caso, Ana.' })));
  const h = getHistory('tel:+573001234567', 10).map((m) => `${m.role}:${m.content}`);
  check('lo dicho queda en la conversación de la llamada', h.includes('user:sigue sin sincronizar la app') && h.includes('assistant:Ya te abro el caso, Ana.'), h.join(' | '));
  grok.emit('message', Buffer.from(JSON.stringify({ type: 'response.function_call_arguments.done', call_id: 'f1', name: 'abrir_ticket', arguments: JSON.stringify({ asunto: 'La app de campo sigue sin sincronizar' }) })));
  grok.emit('message', Buffer.from(JSON.stringify({ type: 'response.done' })));
  await espera(30);
  const t = listarTickets({ contacto: 'tel:+573001234567', dias: 1 });
  check('un ticket abierto por teléfono, firmado por quien contestó', t.length === 1 && t[0]!.creadoPor === 'Eve (teléfono)', JSON.stringify(t.map((x) => x.creadoPor)));
  check('Grok recibe la respuesta y sigue (response.create)', grok.json().some((m) => m.type === 'conversation.item.create' && m.item.call_id === 'f1') && grok.json().filter((m) => m.type === 'response.create').length === 2);
  rest.length = 0;
  grok.emit('message', Buffer.from(JSON.stringify({ type: 'response.function_call_arguments.done', call_id: 'f2', name: 'pasar_a_persona', arguments: JSON.stringify({ motivo: 'Quiere hablar con soporte' }) })));
  grok.emit('message', Buffer.from(JSON.stringify({ type: 'response.done' })));
  await espera(30);
  check('pasar a una persona: la ficha queda con el equipo', getContact('tel:+573001234567')?.humanMode === true);
  await espera(3200);
  const refer = rest.find((x) => x.url.endsWith('/realtime/calls/rtc_1/refer'));
  check('🪤 y la llamada se transfiere a la central (SIP REFER al desvío), después de decir «te comunico»', refer?.cuerpo.target_uri === 'sip:100@empresa.3cx.us', JSON.stringify(rest));
  check('la llamada termina transferida: consumo en minutos y en la historia', grok.readyState === 3 && listEvents('tel:+573001234567', 50).some((e) => e.type === 'llamada' && e.payload.canal === 'telefono' && e.payload.motivo === 'transferida') && listEvents('tel:+573001234567', 50).some((e) => e.type === 'llamada_transferida'));
  const uso = getDb().prepare("SELECT engine, task FROM llm_usage WHERE user_id = 'tel:+573001234567'").get() as Cuerpo | undefined;
  check('el consumo es de xAI, en la tarea voz', uso?.engine === 'xai' && uso?.task === 'voz');
}
{
  rest.length = 0;
  await TEL.atenderLlamadaTelefonica('rtc_2', [{ name: 'From', value: '<sip:anonymous@anonymous.invalid>' }]);
  const grok = grokDe.get('rtc_2')!;
  grok.emit('open');
  check('número oculto: una ficha propia de esa llamada', getContact('tel:anonimo-rtc_2')?.channel === 'telefono');
  grok.emit('message', Buffer.from(JSON.stringify({ type: 'response.function_call_arguments.done', call_id: 'c1', name: 'colgar', arguments: '{}' })));
  grok.emit('message', Buffer.from(JSON.stringify({ type: 'response.done' })));
  await espera(30);
  grok.emit('message', Buffer.from(JSON.stringify({ type: 'response.done' }))); // la despedida
  await espera(3700);
  check('colgar: se despide y después se cuelga por la API', rest.some((x) => x.url.endsWith('/realtime/calls/rtc_2/hangup')) && grok.readyState === 3);
}

// ---------------------------------------------------------------------------------------------------------------
console.log('— Sin agente o sin cupo');
{
  for (const id of ['rtc_a', 'rtc_b', 'rtc_c']) await TEL.atenderLlamadaTelefonica(id, [{ name: 'From', value: '<sip:+573009990000@x>' }]);
  check('(tres a la vez, el cupo de la regla)', TEL.llamadasActivas() === 3);
  rest.length = 0;
  check('la cuarta se pasa al desvío', (await TEL.atenderLlamadaTelefonica('rtc_d', [])) === 'desviada' && rest.some((x) => x.url.endsWith('/rtc_d/refer')));
  for (const id of ['rtc_a', 'rtc_b', 'rtc_c']) grokDe.get(id)!.close();
  mutable.xaiSipDesvio = '';
  AG.guardarAgentes([{ id: 'mateo', nombre: 'Mateo', atiende: ['ventas', 'informacion'], canales: ['whatsapp', 'web'] }]);
  rest.length = 0;
  check('sin agente de teléfono ni desvío, se cuelga (una llamada que nadie contesta es peor)', (await TEL.atenderLlamadaTelefonica('rtc_e', [])) === 'colgada' && rest.some((x) => x.url.endsWith('/rtc_e/hangup')));
  AG.guardarAgentes([{ id: 'eve', nombre: 'Eve', atiende: ['soporte', 'informacion'], canales: ['telefono'] }]);
}

// ---------------------------------------------------------------------------------------------------------------
console.log('— La ruta del aviso y la tarjeta del canal');
{
  const cuerpo = JSON.stringify({ object: 'event', id: 'evt_1', type: 'realtime.call.incoming', created_at: 1, data: { call_id: 'rtc_ruta', sip_headers: [{ name: 'From', value: '<sip:+573005556677@x>' }] } });
  const ts = Math.floor(Date.now() / 1000);
  const mala = await web.request('/voz/sip', { method: 'POST', body: cuerpo, headers: { 'webhook-id': 'w1', 'webhook-timestamp': String(ts), 'webhook-signature': 'v1,AAAA' } });
  check('con la firma mala, 401 y no se toca la llamada', mala.status === 401 && !grokDe.has('rtc_ruta'));
  const buena = await web.request('/voz/sip', { method: 'POST', body: cuerpo, headers: { 'webhook-id': 'w2', 'webhook-timestamp': String(ts), 'webhook-signature': firmar('w2', ts, cuerpo) } });
  await espera(30);
  check('con la buena, 200 enseguida y XENCRM se une a la llamada', buena.status === 200 && grokDe.has('rtc_ruta'));
  grokDe.get('rtc_ruta')!.close();
  const otro = JSON.stringify({ type: 'realtime.call.ended', data: {} });
  check('otros avisos se reciben (200) y no hacen nada', (await web.request('/voz/sip', { method: 'POST', body: otro, headers: { 'webhook-id': 'w3', 'webhook-timestamp': String(ts), 'webhook-signature': firmar('w3', ts, otro) } })).status === 200);
  const tarjeta = channelCards().find((c) => c.id === 'telefono')!;
  check('la tarjeta del canal: lista, con el aviso y el destino SIP para copiar', tarjeta.state !== 'sin_configurar' && tarjeta.copy.some((x) => x.value === 'https://crm.ejemplo.com/voz/sip') && tarjeta.copy.some((x) => x.value.includes('sip.voice.x.ai')), JSON.stringify(tarjeta));
  mutable.xaiSipSecreto = '';
  const sin = channelCards().find((c) => c.id === 'telefono')!;
  check('sin configurar: los pasos para xAI, 3CX y otros proveedores, y el desvío', sin.state === 'sin_configurar' && sin.steps.some((s) => /3CX/.test(s)) && sin.steps.some((s) => /Twilio, Telnyx/.test(s)) && sin.steps.some((s) => /XAI_SIP_DESVIO/.test(s)));
  check('la llamada desde el chat también es un canal de la lista', channelCards().some((c) => c.id === 'voz'));
}

// ---------------------------------------------------------------------------------------------------------------
console.log('— Lo mínimo de la vista');
{
  const js = readFileSync(new URL('../../public/admin.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../../public/admin.html', import.meta.url), 'utf8');
  check('la Bandeja reconoce el teléfono (nombre e insignia)', js.includes("if (ch === 'telefono') return { k: 'tel', t: 'Teléfono', ic: 'telefono' };") && html.includes('.fx-canal-ins.fx-canal-tel{'));
  check('a una llamada no se le escribe: su otra conversación o su WhatsApp', js.includes('function avisoDeLlamada()') && js.includes("Abrir su conversación de ") && js.includes('https://wa.me/') && html.includes('.composer.sin-texto #reply'));
  check('el agente puede atender por teléfono', js.includes("telefono: 'Teléfono (SIP)'"));
}

console.log(fail ? `\n${fail} prueba(s) fallaron` : '\nTodo bien');
process.exit(fail ? 1 : 0);
