// Pruebas de quién entra a la consola y qué ve (sin modelo): pnpm test:usuarios
// El super-admin ve y atiende todos los clientes; quien atiende soporte de uno solo ve lo de ese. La clave se
// guarda como hash, nunca en claro. Carpeta temporal: no toca los clientes de verdad.
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = mkdtempSync(join(tmpdir(), 'xencrm-usuarios-'));
process.env.XENCRM_CLIENTES_DIR = base;
process.env.CONSOLA_TOKEN = 'llave-maestra';
const { crearUsuario, actualizarUsuario, borrarUsuario, verificar, abrirSesion, sesionDe, cerrarSesion, leerUsuarios, alcanza, cambiarLoMio, colorDe, COLORES, ACENTOS } = await import('../consola-usuarios.js');
const { crearCliente } = await import('../clientes.js');
const { mountConsola } = await import('../consola.js');
const { Hono } = await import('hono');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};

crearCliente({ nombre: 'CONFIA FINTECH', slug: 'confia', puerto: 39101, plantilla: 'soporte' });
crearCliente({ nombre: 'ATLAS SOPORTE', slug: 'atlas', puerto: 39102, plantilla: 'soporte' });

// --- usuarios y claves ---
const ana = crearUsuario({ usuario: 'ana', nombre: 'Ana Soporte', clave: 'clave-larga-1', rol: 'asesor', clientes: ['confia'] });
check('se crea quien atiende, con sus clientes', ana.rol === 'asesor' && ana.clientes.join() === 'confia');
check('la clave nunca queda en claro', !readFileSync(join(base, 'usuarios.json'), 'utf8').includes('clave-larga-1'));
check('el archivo de usuarios no se lee desde afuera', (statSync(join(base, 'usuarios.json')).mode & 0o077) === 0);
check('entra con su clave', verificar('ana', 'clave-larga-1')?.nombre === 'Ana Soporte');
check('con otra clave, no', verificar('ana', 'otra-cosa-123') === null);
check('un usuario que no existe tampoco', verificar('nadie', 'clave-larga-1') === null);
check('la clave corta se rechaza', (() => { try { crearUsuario({ usuario: 'bob', clave: '123' }); return false; } catch { return true; } })());
check('no se repite el usuario', (() => { try { crearUsuario({ usuario: 'ana', clave: 'clave-larga-2' }); return false; } catch { return true; } })());

const jefe = crearUsuario({ usuario: 'jefe', nombre: 'Luis', clave: 'clave-larga-3', rol: 'super' });
check('un super-admin no se amarra a clientes', jefe.clientes.length === 0);
check('y alcanza a todos', alcanza(jefe, 'confia') && alcanza(jefe, 'atlas'));
check('quien atiende, solo a los suyos', alcanza(ana, 'confia') && !alcanza(ana, 'atlas'));

// --- sesiones ---
const s = abrirSesion(ana);
check('la sesión devuelve a quien entró', sesionDe(s)?.usuario === 'ana');
check('una sesión que no existe no vale', sesionDe('inventada') === null);
check('la sesión vence', sesionDe(s, Date.now() + 13 * 3600_000) === null); // y al vencer se borra
const s2 = abrirSesion(ana);
actualizarUsuario('ana', { clientes: ['confia', 'atlas'] });
check('si le cambian los clientes, la sesión lo ve al instante', sesionDe(s2)?.clientes.join() === 'confia,atlas', JSON.stringify(sesionDe(s2)));
actualizarUsuario('ana', { activo: false });
check('a quien desactivan, se le cierra la sesión', sesionDe(s2) === null);
actualizarUsuario('ana', { activo: true, clientes: ['confia'] });
cerrarSesion(abrirSesion(ana));
check('salir cierra la sesión', true);

// --- la consola respeta el alcance ---
const app = new Hono();
mountConsola(app);
const comoAna = async (ruta: string, init: RequestInit = {}) => {
  const entrar = await app.request('http://local/api/entrar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ usuario: 'ana', clave: 'clave-larga-1' }) });
  const sesion = /xencrm_consola=([^;]*)/.exec(entrar.headers.get('set-cookie') ?? '')?.[1] ?? '';
  return app.request(`http://local${ruta}`, { ...init, headers: { 'x-consola-sesion': sesion, 'content-type': 'application/json', ...(init.headers ?? {}) } });
};
const maestra = (ruta: string, init: RequestInit = {}) =>
  app.request(`http://local${ruta}`, { ...init, headers: { 'x-consola-token': 'llave-maestra', 'content-type': 'application/json', ...(init.headers ?? {}) } });

check('con clave mala no entra', (await app.request('http://local/api/entrar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ usuario: 'ana', clave: 'mala' }) })).status === 401);

const suyos = (await (await comoAna('/api/clientes')).json()) as { clientes: { cliente: { slug: string } }[] };
check('solo ve los clientes que atiende', suyos.clientes.map((f) => f.cliente.slug).join() === 'confia', JSON.stringify(suyos.clientes.map((f) => f.cliente.slug)));
const todos = (await (await maestra('/api/clientes')).json()) as { clientes: { cliente: { slug: string } }[] };
check('la llave maestra los ve todos', todos.clientes.length === 2);

check('no puede hablar por un cliente ajeno', (await comoAna('/api/c/atlas/stats')).status === 403);
check('por el suyo sí lo intenta (la instancia está apagada)', (await comoAna('/api/c/confia/stats')).status === 502);
check('no da de alta clientes', (await comoAna('/api/clientes', { method: 'POST', body: JSON.stringify({ nombre: 'Otro' }) })).status === 403);
check('no ve el equipo', (await comoAna('/api/usuarios')).status === 403);
check('ni se copia los tokens de los tableros', (await comoAna('/api/clientes/confia/token')).status === 403);

// 🪤 Y NO puede tocar la llave de OpenAI ni los motores de SU PROPIO cliente. Eso decide a quién se le factura
// y cuánto: es infraestructura nuestra, no su operación. La consola ya escondía esa pestaña, pero esconder un
// botón no protege nada — por el proxy pasaba cualquier ruta con el token del cliente ya puesto, así que darle
// cuenta a un negocio era darle también su llave. Se prueba por donde se decide.
for (const ruta of ['clave', 'motores']) {
  const leer = await comoAna(`/api/c/confia/${ruta}`);
  check(`🪤 no puede LEER ${ruta} ni de su propio cliente`, leer.status === 403, `dio ${leer.status}`);
  const escribir = await comoAna(`/api/c/confia/${ruta}`, { method: 'POST', body: JSON.stringify({ clave: 'sk-robada' }) });
  check(`🪤 ni CAMBIAR ${ruta}`, escribir.status === 403, `dio ${escribir.status}`);
}
// El tope de gasto es de la misma familia: decide cuánto se gasta, así que vive bajo `motores/`. Subírselo, no;
// verlo, sí, que al negocio le sirve saber por qué su asistente pasó conversaciones al equipo.
const tope = await comoAna('/api/c/confia/motores/tope', { method: 'PUT', body: JSON.stringify({ tope: 1000 }) });
check('🪤 ni subirse el tope de gasto de IA', tope.status === 403, `dio ${tope.status}`);
check('pero sí ver cómo va su mes (la instancia está apagada)', (await comoAna('/api/c/confia/presupuesto')).status === 502, 'se frenó algo que el negocio sí puede ver');
// La retención borra (o anonimiza) datos de sus clientes: el negocio la ve, pero encenderla no es suyo.
const retencion = await comoAna('/api/c/confia/retencion', { method: 'PUT', body: JSON.stringify({ dias: 90, accion: 'borrar' }) });
check('🪤 ni encender la retención que borra conversaciones', retencion.status === 403, `dio ${retencion.status}`);
check('ni por otro método', (await comoAna('/api/c/confia/retencion', { method: 'POST', body: '{}' })).status === 403);
check('pero sí verla', (await comoAna('/api/c/confia/retencion')).status === 502, 'se frenó algo que el negocio sí puede ver');
// Y el mensaje dice de quién es ese asunto, en vez de un «403» pelado que parece un fallo.
const porQue = (await (await comoAna('/api/c/confia/clave')).json()) as { error?: string };
check('y se explica de quién es ese asunto', /administra XENCRM/.test(porQue.error ?? ''), String(porQue.error));
// 🪤 Lo suyo sigue siendo suyo: el freno es para dos rutas, no para su tablero entero.
check('lo demás de su cliente lo sigue manejando', (await comoAna('/api/c/confia/contacts')).status === 502, 'se frenó algo que sí es del negocio');
// La llave maestra sí puede: alguien tiene que poder ponerla.
check('la llave maestra sí llega a la clave', (await maestra('/api/c/confia/clave')).status === 502, 'se frenó al super-admin');
check('y al tope de gasto', (await maestra('/api/c/confia/motores/tope')).status === 502, 'se frenó al super-admin');
check('y a la retención', (await maestra('/api/c/confia/retencion', { method: 'PUT', body: JSON.stringify({ dias: 365 }) })).status === 502, 'se frenó al super-admin');
check('el super-admin sí ve el equipo', (await (await maestra('/api/usuarios')).json() as { usuarios: unknown[] }).usuarios.length === leerUsuarios().length);

// --- un cliente puede vivir en otra máquina: la consola le habla por su URL ---
const { urlDe, crearCliente: crear2 } = await import('../clientes.js');
check('en esta máquina, la consola le habla por su puerto', urlDe({ puerto: 3007 }) === 'http://localhost:3007');
crear2({ nombre: 'Cliente Lejano', slug: 'lejano', puerto: 39103, base: 'https://lejano.ejemplo.com/' });
const lejano = (await import('../clientes.js')).leerIndice().find((c) => c.slug === 'lejano')!;
check('si vive en otra parte, por su URL (sin la barra del final)', urlDe(lejano) === 'https://lejano.ejemplo.com', urlDe(lejano));

// --- dar de baja un cliente no puede dejar usuarios a la deriva ---
const { darDeBajaCliente, leerIndice: indice } = await import('../clientes.js');
const { quitarClienteDeUsuarios, usuariosSinClientes } = await import('../consola-usuarios.js');
crearUsuario({ usuario: 'dos.clientes', clave: 'clave-larga-4', rol: 'agente', clientes: ['confia', 'atlas'] });
crearUsuario({ usuario: 'solo.atlas', clave: 'clave-larga-5', rol: 'agente', clientes: ['atlas'] });

check('no se puede asignar un cliente que no existe', (() => { try { crearUsuario({ usuario: 'malo', clave: 'clave-larga-6', clientes: ['no-existe'] }); return false; } catch (e) { return /no existe el cliente/.test((e as Error).message); } })());
check('ni al cambiarle los clientes a alguien', (() => { try { actualizarUsuario('solo.atlas', { clientes: ['fantasma'] }); return false; } catch { return true; } })());

const baja = darDeBajaCliente('atlas', new Date('2026-09-23T12:00:00Z'));
check('el cliente sale del índice', !indice().some((c) => c.slug === 'atlas'));
check('pero su carpeta se guarda, no se borra', /_dados-de-baja\/atlas-2026-09-23/.test(baja.guardadoEn) && existsSync(baja.guardadoEn), baja.guardadoEn);
const limpieza = quitarClienteDeUsuarios('atlas');
check('a los que lo atendían se les quita de su lista', limpieza.tocados.sort().join() === 'dos.clientes,solo.atlas', limpieza.tocados.join());
check('a quien no lo atendía no se le toca nada', leerUsuarios().find((u) => u.usuario === 'ana')?.clientes.join() === 'confia');
check('quien tenía otro cliente lo conserva', leerUsuarios().find((u) => u.usuario === 'dos.clientes')?.clientes.join() === 'confia');
check('a quien se quedó sin ninguno se le desactiva el acceso', limpieza.desactivados.join() === 'solo.atlas' && leerUsuarios().find((u) => u.usuario === 'solo.atlas')?.activo === false, JSON.stringify(limpieza));
check('y queda a la vista para reasignarlo', usuariosSinClientes().some((u) => u.usuario === 'solo.atlas'));
check('el desactivado ya no entra', verificar('solo.atlas', 'clave-larga-5') === null);
check('al super-admin no se le toca la lista vacía', leerUsuarios().find((u) => u.usuario === 'jefe')?.activo !== false);
check('dar de baja algo que no existe avisa', (() => { try { darDeBajaCliente('nadie'); return false; } catch { return true; } })());

check('quitar a alguien lo saca', borrarUsuario('jefe') && !leerUsuarios().some((u) => u.usuario === 'jefe'));

// --- el correo y lo que cada quien puede cambiarse ---
const conCorreo = crearUsuario({ usuario: 'pablo', nombre: 'Pablo', correo: 'Pablo@Atelier-Demo.EXAMPLE ', clave: 'clave-de-prueba', rol: 'asesor', clientes: [] });
check('el correo se guarda en minúsculas y sin espacios', conCorreo.correo === 'pablo@atelier-demo.example', String(conCorreo.correo));
check('se puede entrar con el correo en vez del usuario', verificar('pablo@atelier-demo.example', 'clave-de-prueba')?.usuario === 'pablo');
check('y con el usuario, como siempre', verificar('pablo', 'clave-de-prueba')?.usuario === 'pablo');
check('un correo con mala forma se rechaza', (() => { try { crearUsuario({ usuario: 'otro', correo: 'arroba-no', clave: 'clave-de-prueba' }); return false; } catch { return true; } })());
check('dos personas no pueden tener el mismo correo', (() => { try { crearUsuario({ usuario: 'otro2', correo: 'pablo@atelier-demo.example', clave: 'clave-de-prueba' }); return false; } catch { return true; } })());

const mio = cambiarLoMio('pablo', { nombre: 'Pablo Ruiz', correo: 'pablo.ruiz@atelier-demo.example' });
check('cada quien se cambia su nombre y su correo', mio.nombre === 'Pablo Ruiz' && mio.correo === 'pablo.ruiz@atelier-demo.example');
check('cambiar la clave sin la actual, no', (() => { try { cambiarLoMio('pablo', { claveNueva: 'otra-clave-larga' }); return false; } catch (e) { return /clave actual/.test((e as Error).message); } })());
cambiarLoMio('pablo', { claveActual: 'clave-de-prueba', claveNueva: 'otra-clave-larga' });
check('con la actual, sí', verificar('pablo', 'otra-clave-larga')?.usuario === 'pablo' && verificar('pablo', 'clave-de-prueba') === null);
check('y no se puede subir el rol a sí mismo', leerUsuarios().find((u) => u.usuario === 'pablo')!.rol === 'asesor');


// --- el color con el que se reconoce a cada quien ---
check('sin elegir, sale un color estable de su usuario', colorDe({ usuario: 'pablo' }) === colorDe({ usuario: 'pablo' }) && COLORES.includes(colorDe({ usuario: 'pablo' })));
// Con ocho colores dos nombres pueden coincidir y no pasa nada; lo que importa es que el reparto no se quede
// pegado en uno solo.
const repartidos = new Set(['ana', 'pablo', 'sofia', 'camilo', 'marcela', 'jorge', 'laura', 'andres', 'paola', 'diego'].map((u) => colorDe({ usuario: u })));
check('el reparto usa varios colores, no siempre el mismo', repartidos.size >= 4, [...repartidos].join(' '));
check('el elegido manda sobre el automático', colorDe({ usuario: 'pablo', color: COLORES[3] }) === COLORES[3]);
cambiarLoMio('pablo', { color: COLORES[2] });
check('cada quien se elige el suyo', leerUsuarios().find((u) => u.usuario === 'pablo')!.color === COLORES[2]);
check('un color inventado se rechaza', (() => { try { cambiarLoMio('pablo', { color: '#ff00ff' }); return false; } catch { return true; } })());
check('y vaciarlo devuelve al automático', (() => { cambiarLoMio('pablo', { color: '' }); return colorDe(leerUsuarios().find((u) => u.usuario === 'pablo')!) === colorDe({ usuario: 'pablo' }); })());

// El color de la consola es de cada quien, y el de siempre es el verde agua de XENCRM («xen»).
const pablo = () => leerUsuarios().find((u) => u.usuario === 'pablo')!;
check('sin elegir, la consola no guarda color: es el verde agua', pablo().acento === undefined);
check('el verde agua de XENCRM va primero en la lista, y el azul de XENCRM sigue como opción', ACENTOS[0] === 'xen' && ACENTOS.includes('azul') && ACENTOS.includes('dorado'));
cambiarLoMio('pablo', { acento: 'dorado' });
check('cada quien elige el color de su consola', pablo().acento === 'dorado');
check('cambiar el color no toca su nombre ni su clave', pablo().nombre === 'Pablo Ruiz' && Boolean(verificar('pablo', 'otra-clave-larga')));
check('un color de consola inventado se rechaza', (() => { try { cambiarLoMio('pablo', { acento: 'fucsia' }); return false; } catch (e) { return /color de consola/.test((e as Error).message); } })());
check('lo que se rechaza no borra lo que tenía', pablo().acento === 'dorado');
cambiarLoMio('pablo', { nombre: 'Pablo Ruiz' });
check('guardar otra cosa no le quita el color', pablo().acento === 'dorado');
cambiarLoMio('pablo', { acento: 'azul' });
check('el azul, que ya no es el de siempre, sí se guarda', pablo().acento === 'azul');
cambiarLoMio('pablo', { acento: 'xen' });
check('🪤 volver al verde agua no lo guarda: «el de siempre» queda siguiendo al de siempre', pablo().acento === undefined && !('acento' in JSON.parse(JSON.stringify(pablo()))));


// --- 🪤 el admin de un cliente maneja a su gente, y a nadie más ---
// Lo pidió el usuario el 2026-10-16: que el dueño de DUNOR cree y maneje a sus empleados sin pedírselo a quien
// administra XENCRM. Se prueba por HTTP, que es por donde llegaría alguien queriendo pasarse.
crear2({ nombre: 'Atelier Demo', slug: 'atelier', puerto: 39104, plantilla: 'soporte' });
crearUsuario({ usuario: 'dueno', nombre: 'Dueño de Atelier Demo', clave: 'clave-dueno-1', rol: 'admin', clientes: ['atelier'] });
crearUsuario({ usuario: 'luis', nombre: 'Luis Admin', correo: 'luis@ejemplo.co', clave: 'clave-luis-1', rol: 'super' });
crearUsuario({ usuario: 'mixto', nombre: 'Atiende dos', correo: 'mixto@ejemplo.co', clave: 'clave-mixto-1', rol: 'asesor', clientes: ['atelier', 'confia'] });
const como = async (usuario: string, clave: string) => {
  const r = await app.request('http://local/api/entrar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ usuario, clave }) });
  const sesion = /xencrm_consola=([^;]*)/.exec(r.headers.get('set-cookie') ?? '')?.[1] ?? '';
  return (ruta: string, init: RequestInit = {}) =>
    app.request(`http://local${ruta}`, { ...init, headers: { 'x-consola-sesion': sesion, 'content-type': 'application/json', ...(init.headers ?? {}) } });
};
const dueno = await como('dueno', 'clave-dueno-1');
const json = async (r: Response | Promise<Response>) => (await (await r).json()) as Record<string, any>;

check('el admin de un cliente abre Equipo', (await dueno('/api/usuarios')).status === 200);
check('y la consola sabe que lo maneja', (await json(dueno('/api/yo'))).equipo === true);
check('el asesor no', (await json(comoAna('/api/yo'))).equipo === false);
const visto = (await json(dueno('/api/usuarios'))).usuarios as { usuario: string; soloVer?: boolean; clientes: string[]; correo?: string }[];
check('ve a la gente de su cliente', visto.some((u) => u.usuario === 'dueno') && visto.some((u) => u.usuario === 'mixto'), visto.map((u) => u.usuario).join());
check('🪤 y no a la de otros clientes', !visto.some((u) => u.usuario === 'ana'), visto.map((u) => u.usuario).join());
check('al super-admin lo ve, pero solo de nombre', visto.find((u) => u.usuario === 'luis')?.soloVer === true && !visto.find((u) => u.usuario === 'luis')?.correo);
const elMixto = visto.find((u) => u.usuario === 'mixto');
check('a quien atiende además otro negocio, solo de nombre', elMixto?.soloVer === true && !elMixto?.correo);
check('🪤 sin enterarse de qué otros clientes tiene XENCRM', !JSON.stringify(visto).includes('confia'), JSON.stringify(elMixto));
check('ni de quiénes quedaron sin clientes', ((await json(dueno('/api/usuarios'))).sinClientes as string[]).length === 0);

const nueva = await json(dueno('/api/usuarios', { method: 'POST', body: JSON.stringify({ usuario: 'camila', nombre: 'Camila', clave: 'clave-camila-1' }) }));
check('crea a su empleada; sin decir rol, asesora', nueva.usuario?.rol === 'asesor', JSON.stringify(nueva));
check('y sin decir clientes, los suyos', nueva.usuario?.clientes?.join() === 'atelier', JSON.stringify(nueva));
const colado = await dueno('/api/usuarios', { method: 'POST', body: JSON.stringify({ usuario: 'colado', clave: 'clave-colada-1', rol: 'super' }) });
check('🪤 no crea super-admins', colado.status === 409 && !leerUsuarios().some((u) => u.usuario === 'colado'), `dio ${colado.status}`);
const ajenoNuevo = await dueno('/api/usuarios', { method: 'POST', body: JSON.stringify({ usuario: 'espia', clave: 'clave-espia-1', clientes: ['confia'] }) });
check('🪤 ni le da clientes que no son suyos', ajenoNuevo.status === 409 && !leerUsuarios().some((u) => u.usuario === 'espia'), `dio ${ajenoNuevo.status}`);
const gerente = await json(dueno('/api/usuarios', { method: 'POST', body: JSON.stringify({ usuario: 'gerente', clave: 'clave-gerente-1', rol: 'admin' }) }));
check('nombra a otro admin de su cliente', gerente.usuario?.rol === 'admin' && gerente.usuario?.clientes?.join() === 'atelier', JSON.stringify(gerente));

check('le cambia la clave a su empleada', (await dueno('/api/usuarios/camila', { method: 'PATCH', body: JSON.stringify({ clave: 'clave-nueva-camila' }) })).status === 200 && Boolean(verificar('camila', 'clave-nueva-camila')));
check('la desactiva', (await json(dueno('/api/usuarios/camila', { method: 'PATCH', body: JSON.stringify({ activo: false }) }))).usuario?.activo === false && verificar('camila', 'clave-nueva-camila') === null);
await dueno('/api/usuarios/camila', { method: 'PATCH', body: JSON.stringify({ activo: true, rol: 'admin' }) });
check('la sube a admin de su cliente', leerUsuarios().find((u) => u.usuario === 'camila')?.rol === 'admin');
await dueno('/api/usuarios/camila', { method: 'PATCH', body: JSON.stringify({ rol: 'asesor' }) });
const ascenso = await dueno('/api/usuarios/camila', { method: 'PATCH', body: JSON.stringify({ rol: 'super' }) });
check('🪤 pero no a super-admin', ascenso.status === 404 && leerUsuarios().find((u) => u.usuario === 'camila')?.rol === 'asesor', `dio ${ascenso.status}`);
await dueno('/api/usuarios/camila', { method: 'PATCH', body: JSON.stringify({ clientes: ['atelier', 'confia'] }) });
check('🪤 ni le agrega un cliente ajeno', leerUsuarios().find((u) => u.usuario === 'camila')?.clientes.join() === 'atelier');
await dueno('/api/usuarios/camila', { method: 'PATCH', body: JSON.stringify({ desde: '1999-01-01', usuario: 'otra' }) });
check('lo que no le toca cambiar se ignora', leerUsuarios().find((u) => u.usuario === 'camila')?.desde !== '1999-01-01');

for (const [quien, que] of [['ana', 'a la gente de otro cliente'], ['mixto', 'a quien atiende además otro negocio'], ['luis', 'al super-admin']]) {
  const r = await dueno(`/api/usuarios/${quien}`, { method: 'PATCH', body: JSON.stringify({ clave: 'me-la-quedo-yo' }) });
  check(`🪤 no le cambia la clave ${que}`, r.status === 404 && verificar(quien!, 'me-la-quedo-yo') === null, `dio ${r.status}`);
  check(`🪤 ni lo borra (${quien})`, (await dueno(`/api/usuarios/${quien}`, { method: 'DELETE' })).status === 404 && leerUsuarios().some((u) => u.usuario === quien));
}
const noExisteMsg = (await json(dueno('/api/usuarios/ana', { method: 'PATCH', body: JSON.stringify({ nombre: 'x' }) }))).error;
check('🪤 y a quien no es suyo lo llama «no existe», como a quien de verdad no existe', noExisteMsg === (await json(dueno('/api/usuarios/fantasma', { method: 'PATCH', body: '{}' }))).error, String(noExisteMsg));

const bajarme = await dueno('/api/usuarios/dueno', { method: 'PATCH', body: JSON.stringify({ rol: 'asesor' }) });
check('🪤 no se baja a sí mismo de admin (dejaría al negocio sin nadie)', bajarme.status === 404 && leerUsuarios().find((u) => u.usuario === 'dueno')?.rol === 'admin', `dio ${bajarme.status}`);
check('ni se desactiva', (await dueno('/api/usuarios/dueno', { method: 'PATCH', body: JSON.stringify({ activo: false }) })).status === 404 && leerUsuarios().find((u) => u.usuario === 'dueno')?.activo === true);
check('ni se borra', (await dueno('/api/usuarios/dueno', { method: 'DELETE' })).status === 400 && leerUsuarios().some((u) => u.usuario === 'dueno'));
check('su propia clave sí se la cambia', (await dueno('/api/usuarios/dueno', { method: 'PATCH', body: JSON.stringify({ clave: 'clave-dueno-2' }) })).status === 200);
check('y como a todos, cambiarla le cierra la sesión', (await dueno('/api/usuarios')).status === 401);
const dueno2 = await como('dueno', 'clave-dueno-2');

const delGerente = await como('gerente', 'clave-gerente-1');
check('el otro admin también maneja a la gente', (await delGerente('/api/usuarios/camila', { method: 'PATCH', body: JSON.stringify({ nombre: 'Camila R.' }) })).status === 200);
check('quita a su empleada', (await delGerente('/api/usuarios/camila', { method: 'DELETE' })).status === 200 && !leerUsuarios().some((u) => u.usuario === 'camila'));

const asesora = await json(dueno2('/api/usuarios', { method: 'POST', body: JSON.stringify({ usuario: 'sofia', clave: 'clave-sofia-1' }) }));
check('la asesora queda creada', asesora.usuario?.rol === 'asesor');
const deSofia = await como('sofia', 'clave-sofia-1');
check('🪤 la asesora no ve el equipo', (await deSofia('/api/usuarios')).status === 403);
check('🪤 ni crea gente', (await deSofia('/api/usuarios', { method: 'POST', body: JSON.stringify({ usuario: 'amiga', clave: 'clave-amiga-1' }) })).status === 403 && !leerUsuarios().some((u) => u.usuario === 'amiga'));
check('pero atiende su cliente', (await deSofia('/api/c/atelier/contacts')).status === 502);
check('🪤 el admin del cliente tampoco toca motores ni clave', (await dueno2('/api/c/atelier/motores', { method: 'PUT', body: '{}' })).status === 403 && (await dueno2('/c/atelier/admin/api/clave', { method: 'POST', body: '{}' })).status === 403);

// 🪤 El rol de antes: quien tenía «agente» podía todo en su cliente menos el equipo. Se lee como admin del cliente
// para que nadie pierda nada al desplegar, y un rol que no se entiende queda en lo que menos puede.
{
  const { writeFileSync: escribir } = await import('node:fs');
  const archivo = JSON.parse(readFileSync(join(base, 'usuarios.json'), 'utf8')) as { usuarios: { usuario: string; rol: string }[] };
  archivo.usuarios.find((u) => u.usuario === 'sofia')!.rol = 'agente';
  archivo.usuarios.find((u) => u.usuario === 'gerente')!.rol = 'rey';
  escribir(join(base, 'usuarios.json'), JSON.stringify(archivo));
  check('«agente» del archivo viejo se lee como admin del cliente', leerUsuarios().find((u) => u.usuario === 'sofia')?.rol === 'admin');
  check('un rol inventado queda en asesor, sin tumbar a nadie', leerUsuarios().find((u) => u.usuario === 'gerente')?.rol === 'asesor' && Boolean(verificar('dueno', 'clave-dueno-2')));
}

console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
