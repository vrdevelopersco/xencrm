// Pruebas de quién entra a la consola y qué ve (sin modelo): pnpm test:usuarios
// El super-admin ve y atiende todos los clientes; quien atiende soporte de uno solo ve lo de ese. La clave se
// guarda como hash, nunca en claro. Carpeta temporal: no toca los clientes de verdad.
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = mkdtempSync(join(tmpdir(), 'aiva-usuarios-'));
process.env.AIVA_CLIENTES_DIR = base;
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
crearCliente({ nombre: 'HRC TECHNOLOGIES', slug: 'hrc', puerto: 39102, plantilla: 'soporte' });

// --- usuarios y claves ---
const ana = crearUsuario({ usuario: 'ana', nombre: 'Ana Soporte', clave: 'clave-larga-1', rol: 'agente', clientes: ['confia'] });
check('se crea quien atiende, con sus clientes', ana.rol === 'agente' && ana.clientes.join() === 'confia');
check('la clave nunca queda en claro', !readFileSync(join(base, 'usuarios.json'), 'utf8').includes('clave-larga-1'));
check('el archivo de usuarios no se lee desde afuera', (statSync(join(base, 'usuarios.json')).mode & 0o077) === 0);
check('entra con su clave', verificar('ana', 'clave-larga-1')?.nombre === 'Ana Soporte');
check('con otra clave, no', verificar('ana', 'otra-cosa-123') === null);
check('un usuario que no existe tampoco', verificar('nadie', 'clave-larga-1') === null);
check('la clave corta se rechaza', (() => { try { crearUsuario({ usuario: 'bob', clave: '123' }); return false; } catch { return true; } })());
check('no se repite el usuario', (() => { try { crearUsuario({ usuario: 'ana', clave: 'clave-larga-2' }); return false; } catch { return true; } })());

const jefe = crearUsuario({ usuario: 'jefe', nombre: 'Luis', clave: 'clave-larga-3', rol: 'super' });
check('un super-admin no se amarra a clientes', jefe.clientes.length === 0);
check('y alcanza a todos', alcanza(jefe, 'confia') && alcanza(jefe, 'hrc'));
check('quien atiende, solo a los suyos', alcanza(ana, 'confia') && !alcanza(ana, 'hrc'));

// --- sesiones ---
const s = abrirSesion(ana);
check('la sesión devuelve a quien entró', sesionDe(s)?.usuario === 'ana');
check('una sesión que no existe no vale', sesionDe('inventada') === null);
check('la sesión vence', sesionDe(s, Date.now() + 13 * 3600_000) === null); // y al vencer se borra
const s2 = abrirSesion(ana);
actualizarUsuario('ana', { clientes: ['confia', 'hrc'] });
check('si le cambian los clientes, la sesión lo ve al instante', sesionDe(s2)?.clientes.join() === 'confia,hrc', JSON.stringify(sesionDe(s2)));
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
  const { sesion } = (await entrar.json()) as { sesion: string };
  return app.request(`http://local${ruta}`, { ...init, headers: { 'x-consola-sesion': sesion, 'content-type': 'application/json', ...(init.headers ?? {}) } });
};
const maestra = (ruta: string, init: RequestInit = {}) =>
  app.request(`http://local${ruta}`, { ...init, headers: { 'x-consola-token': 'llave-maestra', 'content-type': 'application/json', ...(init.headers ?? {}) } });

check('con clave mala no entra', (await app.request('http://local/api/entrar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ usuario: 'ana', clave: 'mala' }) })).status === 401);

const suyos = (await (await comoAna('/api/clientes')).json()) as { clientes: { cliente: { slug: string } }[] };
check('solo ve los clientes que atiende', suyos.clientes.map((f) => f.cliente.slug).join() === 'confia', JSON.stringify(suyos.clientes.map((f) => f.cliente.slug)));
const todos = (await (await maestra('/api/clientes')).json()) as { clientes: { cliente: { slug: string } }[] };
check('la llave maestra los ve todos', todos.clientes.length === 2);

check('no puede hablar por un cliente ajeno', (await comoAna('/api/c/hrc/stats')).status === 403);
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
check('y se explica de quién es ese asunto', /administra aiva/.test(porQue.error ?? ''), String(porQue.error));
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
crear2({ nombre: 'Cliente Lejano', slug: 'lejano', puerto: 39103, base: 'https://lejano.hrctechnologies.com/' });
const lejano = (await import('../clientes.js')).leerIndice().find((c) => c.slug === 'lejano')!;
check('si vive en otra parte, por su URL (sin la barra del final)', urlDe(lejano) === 'https://lejano.hrctechnologies.com', urlDe(lejano));

// --- dar de baja un cliente no puede dejar usuarios a la deriva ---
const { darDeBajaCliente, leerIndice: indice } = await import('../clientes.js');
const { quitarClienteDeUsuarios, usuariosSinClientes } = await import('../consola-usuarios.js');
crearUsuario({ usuario: 'dos.clientes', clave: 'clave-larga-4', rol: 'agente', clientes: ['confia', 'hrc'] });
crearUsuario({ usuario: 'solo.hrc', clave: 'clave-larga-5', rol: 'agente', clientes: ['hrc'] });

check('no se puede asignar un cliente que no existe', (() => { try { crearUsuario({ usuario: 'malo', clave: 'clave-larga-6', clientes: ['no-existe'] }); return false; } catch (e) { return /no existe el cliente/.test((e as Error).message); } })());
check('ni al cambiarle los clientes a alguien', (() => { try { actualizarUsuario('solo.hrc', { clientes: ['fantasma'] }); return false; } catch { return true; } })());

const baja = darDeBajaCliente('hrc', new Date('2026-09-23T12:00:00Z'));
check('el cliente sale del índice', !indice().some((c) => c.slug === 'hrc'));
check('pero su carpeta se guarda, no se borra', /_dados-de-baja\/hrc-2026-09-23/.test(baja.guardadoEn) && existsSync(baja.guardadoEn), baja.guardadoEn);
const limpieza = quitarClienteDeUsuarios('hrc');
check('a los que lo atendían se les quita de su lista', limpieza.tocados.sort().join() === 'dos.clientes,solo.hrc', limpieza.tocados.join());
check('a quien no lo atendía no se le toca nada', leerUsuarios().find((u) => u.usuario === 'ana')?.clientes.join() === 'confia');
check('quien tenía otro cliente lo conserva', leerUsuarios().find((u) => u.usuario === 'dos.clientes')?.clientes.join() === 'confia');
check('a quien se quedó sin ninguno se le desactiva el acceso', limpieza.desactivados.join() === 'solo.hrc' && leerUsuarios().find((u) => u.usuario === 'solo.hrc')?.activo === false, JSON.stringify(limpieza));
check('y queda a la vista para reasignarlo', usuariosSinClientes().some((u) => u.usuario === 'solo.hrc'));
check('el desactivado ya no entra', verificar('solo.hrc', 'clave-larga-5') === null);
check('al super-admin no se le toca la lista vacía', leerUsuarios().find((u) => u.usuario === 'jefe')?.activo !== false);
check('dar de baja algo que no existe avisa', (() => { try { darDeBajaCliente('nadie'); return false; } catch { return true; } })());

check('quitar a alguien lo saca', borrarUsuario('jefe') && !leerUsuarios().some((u) => u.usuario === 'jefe'));

// --- el correo y lo que cada quien puede cambiarse ---
const conCorreo = crearUsuario({ usuario: 'pablo', nombre: 'Pablo', correo: 'Pablo@Dunor.CO ', clave: 'clave-de-prueba', rol: 'agente', clientes: [] });
check('el correo se guarda en minúsculas y sin espacios', conCorreo.correo === 'pablo@dunor.co', String(conCorreo.correo));
check('se puede entrar con el correo en vez del usuario', verificar('pablo@dunor.co', 'clave-de-prueba')?.usuario === 'pablo');
check('y con el usuario, como siempre', verificar('pablo', 'clave-de-prueba')?.usuario === 'pablo');
check('un correo con mala forma se rechaza', (() => { try { crearUsuario({ usuario: 'otro', correo: 'arroba-no', clave: 'clave-de-prueba' }); return false; } catch { return true; } })());
check('dos personas no pueden tener el mismo correo', (() => { try { crearUsuario({ usuario: 'otro2', correo: 'pablo@dunor.co', clave: 'clave-de-prueba' }); return false; } catch { return true; } })());

const mio = cambiarLoMio('pablo', { nombre: 'Pablo Ruiz', correo: 'pablo.ruiz@dunor.co' });
check('cada quien se cambia su nombre y su correo', mio.nombre === 'Pablo Ruiz' && mio.correo === 'pablo.ruiz@dunor.co');
check('cambiar la clave sin la actual, no', (() => { try { cambiarLoMio('pablo', { claveNueva: 'otra-clave-larga' }); return false; } catch (e) { return /clave actual/.test((e as Error).message); } })());
cambiarLoMio('pablo', { claveActual: 'clave-de-prueba', claveNueva: 'otra-clave-larga' });
check('con la actual, sí', verificar('pablo', 'otra-clave-larga')?.usuario === 'pablo' && verificar('pablo', 'clave-de-prueba') === null);
check('y no se puede subir el rol a sí mismo', leerUsuarios().find((u) => u.usuario === 'pablo')!.rol === 'agente');


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

// El color de la consola es de cada quien, y el de siempre es el azul.
const pablo = () => leerUsuarios().find((u) => u.usuario === 'pablo')!;
check('sin elegir, la consola no guarda color: es el azul', pablo().acento === undefined);
check('el azul va primero en la lista', ACENTOS[0] === 'azul' && ACENTOS.includes('dorado'));
cambiarLoMio('pablo', { acento: 'dorado' });
check('cada quien elige el color de su consola', pablo().acento === 'dorado');
check('cambiar el color no toca su nombre ni su clave', pablo().nombre === 'Pablo Ruiz' && Boolean(verificar('pablo', 'otra-clave-larga')));
check('un color de consola inventado se rechaza', (() => { try { cambiarLoMio('pablo', { acento: 'fucsia' }); return false; } catch (e) { return /color de consola/.test((e as Error).message); } })());
check('lo que se rechaza no borra lo que tenía', pablo().acento === 'dorado');
cambiarLoMio('pablo', { nombre: 'Pablo Ruiz' });
check('guardar otra cosa no le quita el color', pablo().acento === 'dorado');
cambiarLoMio('pablo', { acento: 'azul' });
check('🪤 volver al azul no lo guarda: «el de siempre» queda siguiendo al de siempre', pablo().acento === undefined && !('acento' in JSON.parse(JSON.stringify(pablo()))));


console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
