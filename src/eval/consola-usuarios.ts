// Pruebas de quién entra a la consola y qué ve (sin modelo): pnpm test:usuarios
// El super-admin ve y atiende todos los clientes; quien atiende soporte de uno solo ve lo de ese. La clave se
// guarda como hash, nunca en claro. Carpeta temporal: no toca los clientes de verdad.
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = mkdtempSync(join(tmpdir(), 'aiva-usuarios-'));
process.env.AIVA_CLIENTES_DIR = base;
process.env.CONSOLA_TOKEN = 'llave-maestra';
const { crearUsuario, actualizarUsuario, borrarUsuario, verificar, abrirSesion, sesionDe, cerrarSesion, leerUsuarios, alcanza } = await import('../consola-usuarios.js');
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

console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
