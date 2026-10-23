// Pruebas de la consola del super-admin (sin modelo): pnpm test:consola
// Los tickets salen solos del estado de cada instancia, el orden pone primero lo urgente de los clientes que más
// pesan, y el alta de un cliente es una acción del super-admin. Carpeta temporal: no toca los clientes de verdad.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = mkdtempSync(join(tmpdir(), 'aiva-consola-'));
process.env.AIVA_CLIENTES_DIR = base;
process.env.CONSOLA_TOKEN = 'token-de-prueba';
const { ticketsDe, ordenar, mountConsola } = await import('../consola.js');
const { crearCliente, leerIndice, tokenDe } = await import('../clientes.js');
const { Hono } = await import('hono');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};
const ref = (slug: string, prioridad: 'alta' | 'media' | 'baja') => ({ slug, nombre: slug, puerto: 3001, host: '', prioridad, desde: '2026-09-23' });

// --- los tickets salen del estado ---
const caido = ticketsDe(ref('uno', 'alta'), { arriba: false });
// El aviso es urgente, pero dice lo que se sabe (no la alcanzamos) y no lo que se teme (se cayó, se perdió
// todo): quien lo lee tiene que saber que las conversaciones siguen ahí.
check('un cliente que no contesta es lo más urgente', caido.length === 1 && caido[0]!.urgencia === 'alta' && /sin conexión/i.test(caido[0]!.titulo), JSON.stringify(caido));
check('y el aviso no suena a catástrofe', /guardad/i.test(caido[0]?.detalle ?? '') && !/no responde|apagada/i.test(caido[0]?.titulo ?? ''), caido[0]?.detalle ?? '');
check('y no inventa lo que no puede saber', caido.length === 1);

// Lo prometido y lo cumplido: si alguien lleva esperando más de lo que el negocio prometió, eso va arriba del
// todo. Es lo único de esta pantalla que se arregla ahora mismo, contestando.
const tarde = ticketsDe(ref('lento', 'alta'), { arriba: true, acuerdoMin: 15, peorEsperaMin: 48, esperandoAhora: 2 });
check('alguien esperando más de lo prometido es urgente', tarde.some((t) => t.urgencia === 'alta' && /48 min esperando/.test(t.titulo)), JSON.stringify(tarde.map((t) => t.titulo)));
check('y el aviso dice qué se prometió', /15/.test(tarde.find((t) => /esperando/.test(t.titulo))?.detalle ?? ''), JSON.stringify(tarde));
check('dentro de lo prometido, no molesta', ticketsDe(ref('ok', 'alta'), { arriba: true, acuerdoMin: 15, peorEsperaMin: 9, esperandoAhora: 1 }).length === 0);

const vivo = ticketsDe(ref('dos', 'media'), { arriba: true, publica: 'caida', whatsapp: 'esperando_qr', porVerificar: 2, esperanRespuesta: 3, citasSinResultado: 1 });
check('la dirección pública caída es urgente', vivo.some((t) => t.urgencia === 'alta' && /pública/.test(t.titulo)), JSON.stringify(vivo.map((t) => t.titulo)));
check('WhatsApp pidiendo código avisa', vivo.some((t) => /WhatsApp/.test(t.titulo)));
check('las preguntas sin responder avisan, con cuántas', vivo.some((t) => /2 preguntas sin responder/.test(t.titulo)), JSON.stringify(vivo.map((t) => t.titulo)));
check('los que esperan respuesta también', vivo.some((t) => /3 esperan respuesta/.test(t.titulo)));
check('las citas sin resultado son lo menos urgente', vivo.some((t) => t.urgencia === 'baja' && /cita sin resultado/.test(t.titulo)), JSON.stringify(vivo.map((t) => t.titulo)));

const tranquilo = ticketsDe(ref('tres', 'baja'), { arriba: true, publica: 'ok', whatsapp: 'conectado', porVerificar: 0, esperanRespuesta: 0, citasSinResultado: 0 });
check('un cliente al día no genera tickets', tranquilo.length === 0, JSON.stringify(tranquilo));
check('WhatsApp apagado a propósito no es un problema', ticketsDe(ref('x', 'media'), { arriba: true, whatsapp: 'apagado' }).length === 0);
// 🪤 La dirección pública: cada estado con lo que significa. Sin dirección configurada, o con una falla suelta que
// la instancia todavía no da por caída, no hay nada que atender.
const publica = (estado: string) => ticketsDe(ref('p', 'media'), { arriba: true, publica: estado }).map((t) => `${t.urgencia}:${t.titulo}`);
check('sin dirección pública configurada no es una alarma', publica('sin_url').length === 0, JSON.stringify(publica('sin_url')));
check('mientras revisa por primera vez, tampoco', publica('revisando').length === 0);
check('🪤 una falla suelta tampoco: la instancia necesita tres seguidas para darla por caída', publica('fallando').length === 0, JSON.stringify(publica('fallando')));
check('caída sí, y urgente', publica('caida').some((t) => t.startsWith('alta:') && /no contesta/.test(t)));
check('contestando desde otro servidor se dice así, no «no contesta»', publica('otro_servidor').some((t) => t.startsWith('alta:') && /otro servidor/.test(t)), JSON.stringify(publica('otro_servidor')));

// --- el orden es el de atención ---
const orden = ordenar([
  { cliente: ref('tranquilo-grande', 'alta'), tickets: [] },
  { cliente: ref('urgente-chico', 'baja'), tickets: [{ urgencia: 'alta', titulo: 'a', detalle: '' }] },
  { cliente: ref('urgente-grande', 'alta'), tickets: [{ urgencia: 'alta', titulo: 'b', detalle: '' }] },
  { cliente: ref('tibio-medio', 'media'), tickets: [{ urgencia: 'baja', titulo: 'c', detalle: '' }] },
]).map((f) => f.cliente.slug);
check('primero lo urgente del cliente que más pesa', orden[0] === 'urgente-grande', orden.join(' · '));
check('un cliente sin pendientes queda de último, aunque sea grande', orden[3] === 'tranquilo-grande', orden.join(' · '));

// --- el alta es del super-admin, por la API ---
const app = new Hono();
mountConsola(app);
const pedir = (ruta: string, init: RequestInit = {}) =>
  app.request(`http://local${ruta}`, { ...init, headers: { 'x-consola-token': 'token-de-prueba', 'content-type': 'application/json', ...(init.headers ?? {}) } });

check('sin token no se ve nada', (await app.request('http://local/api/clientes')).status === 401);

// Puertos altos a propósito: la prueba no debe chocar con instancias de verdad corriendo en esta máquina.
const alta = await pedir('/api/clientes', { method: 'POST', body: JSON.stringify({ nombre: 'Financiera del Caribe', prioridad: 'alta', puerto: 39001 }) });
const creado = (await alta.json()) as { cliente?: { slug: string; prioridad: string }; token?: string };
check('el super-admin da de alta un cliente', alta.status === 200 && creado.cliente?.slug === 'financiera-del-caribe' && Boolean(creado.token), JSON.stringify(creado).slice(0, 120));
check('y puede elegirle el puerto', (creado.cliente as unknown as { puerto: number } | undefined)?.puerto === 39001);
check('queda en el índice, con su prioridad', leerIndice().some((c) => c.slug === 'financiera-del-caribe' && c.prioridad === 'alta'));
check('el token que devuelve es el que quedó en su .env', creado.token === tokenDe('financiera-del-caribe'));

const repetido = await pedir('/api/clientes', { method: 'POST', body: JSON.stringify({ nombre: 'Financiera del Caribe', puerto: 39003 }) });
check('no deja crear dos veces el mismo', repetido.status === 409, String(repetido.status));

const sinNombre = await pedir('/api/clientes', { method: 'POST', body: JSON.stringify({}) });
check('sin nombre no crea nada', sinNombre.status === 400);
// Las sedes viajan hasta el alta: una mal escrita se rechaza con su motivo y no crea nada (bien escritas, ver test:clientes).
const sedeMala = await pedir('/api/clientes', { method: 'POST', body: JSON.stringify({ nombre: 'Óptica Visión', puerto: 39004, sedes: 'Sede Norte · Cra 1\n· sin nombre' }) });
const porQueSede = (await sedeMala.json()) as { error?: string };
check('las sedes llegan al alta: una sin nombre se avisa y no crea nada', sedeMala.status === 409 && /le falta el nombre/.test(porQueSede.error ?? '') && !leerIndice().some((c) => c.slug === 'optica-vision'), `${sedeMala.status} ${porQueSede.error}`);

const cambio = await pedir('/api/clientes/financiera-del-caribe', { method: 'PATCH', body: JSON.stringify({ prioridad: 'baja', notas: 'arranca en octubre' }) });
check('puede cambiarle la prioridad y dejarle una nota', cambio.status === 200 && leerIndice()[0]!.prioridad === 'baja' && leerIndice()[0]!.notas === 'arranca en octubre');
check('a un cliente que no existe, no', (await pedir('/api/clientes/nadie', { method: 'PATCH', body: '{}' })).status === 404);

// La consola no crea clientes por su cuenta: solo cuando se lo piden.
crearCliente({ nombre: 'Litografía Industrial', puerto: 39002 });
const lista = (await (await pedir('/api/clientes')).json()) as { clientes: { cliente: { slug: string } }[] };
check('lista los que hay, sin agregar ninguno', lista.clientes.length === 2, String(lista.clientes.length));
check('los apagados se ven como apagados', lista.clientes.every((f) => (f as unknown as { estado: { arriba: boolean } }).estado.arriba === false));

// --- una sola bandeja: lo de todos los clientes, y poder atenderlo desde aquí ---
const { pendientes } = await import('../consola.js');
check('sin instancias arriba, la bandeja queda vacía y no revienta', (await pendientes()).length === 0);

check('la consola habla por el cliente, poniendo su token', (await pedir('/api/c/financiera-del-caribe/stats')).status === 502, 'la instancia está apagada: 502, no 401');
check('por un cliente que no existe, no habla', (await pedir('/api/c/nadie/stats')).status === 404);
check('y sin el token de la consola, nada', (await app.request('http://local/api/c/financiera-del-caribe/stats')).status === 401);
check('la bandeja tampoco se ve sin token', (await app.request('http://local/api/pendientes')).status === 401);

// --- entrar una vez y abrir el tablero de un cliente desde aquí ---
// Es lo que evita repartir el token de cada cliente: la consola pone el token al pasar la petición, y lo único
// que viaja por el navegador es la sesión, en una galleta (una navegación no puede poner cabeceras).
const entrada = await app.request('http://local/api/entrar', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ maestra: 'token-de-prueba' }),
});
const galleta = entrada.headers.get('set-cookie') ?? '';
const sesionMaestra = (await entrada.json()) as { sesion?: string; usuario?: { rol?: string } };
check('con la llave maestra se abre sesión de super-admin', entrada.status === 200 && sesionMaestra.usuario?.rol === 'super', JSON.stringify(sesionMaestra).slice(0, 90));
check('y la sesión sale en una galleta, que no se puede leer desde el navegador', /aiva_consola=/.test(galleta) && /HttpOnly/i.test(galleta), galleta);
check('con una llave maestra equivocada, no', (await app.request('http://local/api/entrar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ maestra: 'otra' }) })).status === 401);

const conGalleta = (ruta: string) => app.request(`http://local${ruta}`, { headers: { cookie: `aiva_consola=${sesionMaestra.sesion}` } });
check('la galleta vale para la API', (await conGalleta('/api/yo')).status === 200);
check('el tablero de un cliente se abre desde la consola', (await conGalleta('/c/financiera-del-caribe/admin/api/me')).status === 502, 'la instancia está apagada: 502 quiere decir que pasó el control');
check('sin sesión, el tablero manda a la puerta', (await app.request('http://local/c/financiera-del-caribe/admin')).status === 302);
check('por la consola solo se llega al tablero, no a lo demás del cliente', (await conGalleta('/c/financiera-del-caribe/health')).status === 404, 'el chat del sitio de un cliente no se sirve desde aquí');

// Quien atiende a un cliente no entra al de otro, ni sabiéndose la dirección.
const { crearUsuario: nuevoUsuario, abrirSesion: abrir } = await import('../consola-usuarios.js');
nuevoUsuario({ usuario: 'ana', nombre: 'Ana', clave: 'clave-de-prueba', rol: 'asesor', clientes: ['financiera-del-caribe'] });
const sesionAna = abrir({ usuario: 'ana', nombre: 'Ana', rol: 'asesor', clientes: ['financiera-del-caribe'], activo: true, desde: '2026-09-25' });
const comoAna = (ruta: string) => app.request(`http://local${ruta}`, { headers: { cookie: `aiva_consola=${sesionAna}` } });
check('entra al tablero del cliente que atiende', (await comoAna('/c/financiera-del-caribe/admin/api/me')).status === 502);
check('y al de otro cliente, no', (await comoAna('/c/litografia-industrial/admin')).status === 403);
check('tampoco a su API', (await comoAna('/c/litografia-industrial/admin/api/contacts')).status === 403);

// --- lo que pasa por la consola llega al cliente tal cual ---
// Un cliente de mentira en el puerto de la financiera, que devuelve lo que le llegó: así se ve qué reenvía la consola.
const { createServer } = await import('node:http');
const eco = createServer((req, res) => {
  const trozos: Buffer[] = [];
  req.on('data', (t: Buffer) => trozos.push(t));
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ tipo: req.headers['content-type'] ?? '', quien: req.headers['x-aiva-quien'] ?? '', token: req.headers['x-admin-token'] ?? '', cuerpo: Buffer.concat(trozos).toString('base64') }));
  });
});
await new Promise<void>((listo) => eco.listen(39001, 'localhost', () => listo()));
type Eco = { tipo: string; quien: string; token: string; cuerpo: string };
// Una foto de mentira con los bytes que más se rompen al leerlos como texto: el cero, el 0xFF y una «ñ» suelta.
const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0xf1, 0x0d, 0x0a, 0x1a]);
const formulario = new FormData();
formulario.append('archivo', new Blob([bytes], { type: 'image/png' }), 'traje.png');
formulario.append('texto', 'Así queda el azul');
const envio = new Request('http://local/c/financiera-del-caribe/admin/api/contacts/web:1/adjunto', { method: 'POST', body: formulario, headers: { cookie: `aiva_consola=${sesionAna}`, 'x-aiva-quien': 'Otra Persona' } });
const tipoEnviado = envio.headers.get('content-type') ?? '';
const cuerpoEnviado = Buffer.from(await envio.clone().arrayBuffer()).toString('base64');
const llego = (await (await app.request(envio)).json()) as Eco;
check('🪤 un adjunto llega al cliente con sus bytes intactos', llego.cuerpo === cuerpoEnviado && cuerpoEnviado.length > 0, `${llego.cuerpo.length} contra ${cuerpoEnviado.length} caracteres en base64`);
check('🪤 y con su tipo y su separador, no como JSON', /^multipart\/form-data; boundary=/.test(llego.tipo) && llego.tipo === tipoEnviado, llego.tipo);
check('el token del cliente lo pone la consola', llego.token === tokenDe('financiera-del-caribe'));
check('quién hace las cosas sale de la cuenta, no de lo que mande el navegador', llego.quien === 'Ana', llego.quien);
const json = (await (await app.request('http://local/c/financiera-del-caribe/admin/api/contacts/web:1', { method: 'PATCH', headers: { cookie: `aiva_consola=${sesionAna}`, 'content-type': 'application/json' }, body: JSON.stringify({ stage: 'perdido', motivo: 'Precio' }) })).json()) as Eco;
check('lo de siempre (JSON) sigue llegando igual', json.tipo === 'application/json' && Buffer.from(json.cuerpo, 'base64').toString('utf8') === '{"stage":"perdido","motivo":"Precio"}', JSON.stringify(json));
const sinCuerpo = (await (await comoAna('/c/financiera-del-caribe/admin/api/stats')).json()) as Eco;
check('una consulta sin cuerpo no lleva tipo', sinCuerpo.tipo === '' && sinCuerpo.cuerpo === '', JSON.stringify(sinCuerpo));
const porLaApi = (await (await pedir('/api/c/financiera-del-caribe/contacts/web:1', { method: 'PATCH', body: '{"responsable":"Ana"}' })).json()) as Eco;
check('lo que cambia la consola por su API también lleva nombre', decodeURIComponent(porLaApi.quien) === 'Llave maestra', porLaApi.quien);
nuevoUsuario({ usuario: 'andres', nombre: 'Andrés Núñez', clave: 'clave-de-prueba', rol: 'asesor', clientes: ['financiera-del-caribe'] });
const sesionAndres = abrir({ usuario: 'andres', nombre: 'Andrés Núñez', rol: 'asesor', clientes: ['financiera-del-caribe'], activo: true, desde: '2026-10-23' });
const conTilde = (await (await app.request('http://local/c/financiera-del-caribe/admin/api/stats', { headers: { cookie: `aiva_consola=${sesionAndres}` } })).json()) as Eco;
check('🪤 un nombre con tildes viaja escapado (una cabecera solo lleva ASCII) y se lee entero', decodeURIComponent(conTilde.quien) === 'Andrés Núñez', conTilde.quien);
eco.close();

console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
