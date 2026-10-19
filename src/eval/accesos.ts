// Pruebas de la bitácora de accesos de la consola (sin modelo): pnpm test:accesos
//
// El usuario le pasó su acceso a DUNOR y no había forma de saber si habían entrado: las sesiones y los fallos
// viven en memoria. Ahora cada ingreso, cada fallo, cada tablero abierto y cada cambio de cuenta queda en una
// línea, y /_salud la enseña con su token. Lo que se prueba: que se anota lo que pasa, que NINGUNA clave entra
// al archivo —tampoco la que alguien pega por error donde iba el usuario—, que no crece sin fin y que anotar
// nunca tumba el login. Carpeta temporal: no toca los clientes de verdad.
import { appendFileSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = mkdtempSync(join(tmpdir(), 'aiva-accesos-'));
process.env.AIVA_CLIENTES_DIR = base;
process.env.CONSOLA_TOKEN = 'llave-maestra-de-prueba';
const { anotarAcceso, leerAccesos, resumenPorUsuario, accesosParaSalud, tapado, navegadorDe, rutaAccesos } = await import('../accesos.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};

// ---------- El módulo, solo ----------
const suelto = mkdtempSync(join(tmpdir(), 'aiva-accesos-suelto-'));
const t = (min: number) => new Date(Date.UTC(2026, 9, 19, 15, min));
anotarAcceso(suelto, { tipo: 'fallo', usuario: 'dueno', motivo: 'clave equivocada' }, t(0));
anotarAcceso(suelto, { tipo: 'entro', usuario: 'dueno', rol: 'admin' }, t(1));
anotarAcceso(suelto, { tipo: 'tablero', usuario: 'dueno', cliente: 'dunor' }, t(2));
anotarAcceso(suelto, { tipo: 'fallo', usuario: 'dueno', motivo: 'clave equivocada' }, t(3));
anotarAcceso(suelto, { tipo: 'fallo', usuario: 'ab…(7)', motivo: 'usuario que no existe' }, t(4));
anotarAcceso(suelto, { tipo: 'cuenta', usuario: 'laura', por: 'dueno', que: 'creada · asesor · dunor' }, t(5));
const leidos = leerAccesos(suelto);
check('se anota una línea por cosa, en orden', leidos.length === 6 && leidos[0]?.tipo === 'fallo' && leidos[5]?.tipo === 'cuenta');
check('el archivo no se lee desde afuera', (statSync(rutaAccesos(suelto)).mode & 0o077) === 0);
const resumen = resumenPorUsuario(leidos);
const dueno = resumen.find((r) => r.usuario === 'dueno');
check('el resumen dice cuándo entró y cuántas veces', dueno?.ultimoIngreso === t(1).toISOString() && dueno?.ingresos === 1);
check('los fallos se cuentan desde su último ingreso, no desde siempre', dueno?.fallosDesdeUltimoIngreso === 1, JSON.stringify(dueno));
check('y dice cuándo abrió su tablero', dueno?.ultimoTablero === t(2).toISOString());
const fantasma = resumen.find((r) => r.usuario === 'ab…(7)');
check('quien nunca ha entrado sale sin ingreso y con sus fallos', fantasma?.ultimoIngreso === null && fantasma?.fallosDesdeUltimoIngreso === 1 && fantasma?.ultimoMotivo === 'usuario que no existe');
check('crearle la cuenta a alguien no cuenta como actividad suya', !resumen.some((r) => r.usuario === 'laura'));
check('lo más reciente, arriba', resumen[0]?.usuario === 'ab…(7)', resumen.map((r) => r.usuario).join());

const salud = accesosParaSalud(suelto, { n: 2 });
check('para /_salud: las últimas, de la más nueva a la más vieja', salud.ultimos.length === 2 && salud.ultimos[0]?.tipo === 'cuenta' && salud.total === 6);
check('y se filtra por persona (lo suyo y lo que hizo)', accesosParaSalud(suelto, { usuario: 'DUENO' }).total === 5);

appendFileSync(rutaAccesos(suelto), '{"cuando":"2026-10-19T15:06:00.000Z","tipo":"entro","usu\n');
check('una línea rota se salta y no tumba el resto', leerAccesos(suelto).length === 6);

check('lo escrito que no es de nadie se guarda tapado', tapado('MiClaveSecreta2026') === 'Mi…(18)' && tapado('') === '(vacío)');
check('el navegador se resume: Chrome en Windows',
  navegadorDe('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36') === 'Chrome · Windows');
check('Safari en iPhone',
  navegadorDe('Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1') === 'Safari · iPhone');
check('Edge no se confunde con Chrome',
  navegadorDe('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0') === 'Edge · Windows');
check('un programa se nombra como programa', navegadorDe('curl/8.7.1') === 'programa');

// No crece sin fin: con un tope pequeño, se queda con las últimas y la más nueva sigue ahí.
const grande = mkdtempSync(join(tmpdir(), 'aiva-accesos-grande-'));
for (let i = 0; i < 3000; i++) anotarAcceso(grande, { tipo: 'fallo', usuario: `u${i}`, motivo: 'clave equivocada' }, t(0), 60_000);
const quedan = leerAccesos(grande);
check('pasando el tope se recorta, sin perder lo último', statSync(rutaAccesos(grande)).size < 250_000 && quedan.length <= 2000 && quedan.at(-1)?.usuario === 'u2999', `${quedan.length} líneas`);

// Anotar nunca tumba nada: sin carpeta donde escribir, lo dice en el registro y sigue.
const errorDeSiempre = console.error;
let dicho = '';
console.error = (...a: unknown[]) => { dicho = a.join(' '); };
let lanzo = false;
try { anotarAcceso(join(base, 'no-existe', 'ni-esta'), { tipo: 'entro', usuario: 'x' }); } catch { lanzo = true; }
console.error = errorDeSiempre;
check('🪤 si no se puede escribir, no lanza: lo dice en el registro', !lanzo && /no pude anotar/.test(dicho), dicho);

// ---------- La consola, de verdad ----------
const { crearUsuario, actualizarUsuario } = await import('../consola-usuarios.js');
const { crearCliente } = await import('../clientes.js');
const { mountConsola } = await import('../consola.js');
const { Hono } = await import('hono');
crearCliente({ nombre: 'DUNOR Boutique', slug: 'dunor', puerto: 39301, plantilla: 'soporte' });
crearUsuario({ usuario: 'dueno', nombre: 'Dueño DUNOR', correo: 'dueno@dunor.co', clave: 'clave-del-dueno-1', rol: 'admin', clientes: ['dunor'] });
crearUsuario({ usuario: 'ida', nombre: 'Se fue', clave: 'clave-de-ida-1', rol: 'asesor', clientes: ['dunor'] });
actualizarUsuario('ida', { activo: false });
const app = new Hono();
mountConsola(app);
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const desde = (ip: string) => ({ 'content-type': 'application/json', 'x-forwarded-for': ip, 'user-agent': CHROME });
const entrar = (cuerpo: object, ip = '190.24.1.2') =>
  app.request('http://local/api/entrar', { method: 'POST', headers: desde(ip), body: JSON.stringify(cuerpo) });
const ultima = () => leerAccesos(base).at(-1);
const archivo = () => readFileSync(rutaAccesos(base), 'utf8');

const bien = await entrar({ usuario: 'dueno', clave: 'clave-del-dueno-1' });
const { sesion } = (await bien.json()) as { sesion: string };
check('entrar deja su línea: quién, con qué rol, desde dónde y con qué',
  bien.status === 200 && ultima()?.tipo === 'entro' && ultima()?.usuario === 'dueno' && ultima()?.rol === 'admin' && ultima()?.ip === '190.24.1.2' && ultima()?.navegador === 'Chrome · Windows',
  JSON.stringify(ultima()));
await entrar({ usuario: 'dueno@dunor.co', clave: 'clave-del-dueno-1' });
check('entrando con el correo, se anota su usuario', ultima()?.tipo === 'entro' && ultima()?.usuario === 'dueno');

await entrar({ usuario: 'dueno', clave: 'clave-que-no-es-9' }, '190.24.1.3');
check('con la clave mala: falló, por la clave', ultima()?.tipo === 'fallo' && ultima()?.usuario === 'dueno' && ultima()?.motivo === 'clave equivocada');
await entrar({ usuario: 'ida', clave: 'clave-de-ida-1' }, '190.24.1.4');
check('a quien desactivaron: falló, por eso', ultima()?.usuario === 'ida' && ultima()?.motivo === 'cuenta desactivada');
await entrar({ usuario: 'MiClaveSecreta2026', clave: 'x' }, '190.24.1.5');
check('🪤 lo escrito como usuario que no es de nadie va tapado: puede ser la clave pegada donde no era',
  ultima()?.usuario === 'mi…(18)' && ultima()?.motivo === 'usuario que no existe' && !/miclavesecreta2026/i.test(archivo()), JSON.stringify(ultima()));
check('🪤 ninguna clave entra al archivo, ni la buena ni la mala', !/clave-del-dueno-1|clave-que-no-es-9|clave-de-ida-1/.test(archivo()));

const maestraMala = await entrar({ maestra: 'no-es-la-llave' }, '190.24.1.6');
check('la llave maestra equivocada se nombra como tal', maestraMala.status === 401 && ultima()?.usuario === 'llave maestra' && ultima()?.motivo === 'llave maestra equivocada');
await entrar({ maestra: 'llave-maestra-de-prueba' }, '190.24.1.7');
check('y la buena también, sin confundirse con un usuario «maestra»', ultima()?.tipo === 'entro' && ultima()?.usuario === 'llave maestra');

const comoDueno = (ruta: string, init: RequestInit = {}) =>
  app.request(`http://local${ruta}`, { ...init, headers: { ...desde('190.24.1.2'), 'x-consola-sesion': sesion, ...(init.headers ?? {}) } });
const creada = await comoDueno('/api/usuarios', { method: 'POST', body: JSON.stringify({ usuario: 'laura', nombre: 'Laura', clave: 'clave-de-laura-1', rol: 'asesor', clientes: ['dunor'] }) });
check('crear una cuenta queda dicho: a quién, cómo y quién lo hizo',
  creada.status === 200 && ultima()?.tipo === 'cuenta' && ultima()?.usuario === 'laura' && ultima()?.por === 'dueno' && ultima()?.que === 'creada · asesor · dunor', JSON.stringify(ultima()));
await comoDueno('/api/usuarios/laura', { method: 'PATCH', body: JSON.stringify({ clave: 'otra-clave-de-laura' }) });
check('ponerle clave nueva se nombra, sin escribirla', ultima()?.que === 'clave nueva' && !/clave-de-laura-1|otra-clave-de-laura/.test(archivo()));
await comoDueno('/api/usuarios/laura', { method: 'PATCH', body: JSON.stringify({ rol: 'admin', activo: false }) });
check('el rol y si sigue activa, también', ultima()?.que === 'rol: admin · desactivada', ultima()?.que);
await comoDueno('/api/usuarios/laura', { method: 'DELETE' });
check('quitarla, también', ultima()?.que === 'quitada' && ultima()?.usuario === 'laura');
const rechazo = await comoDueno('/api/usuarios', { method: 'POST', body: JSON.stringify({ usuario: 'jefe2', clave: 'clave-larga-9', rol: 'super' }) });
check('lo que el servidor rechaza no se anota como hecho', rechazo.status !== 200 && ultima()?.que === 'quitada');

await comoDueno('/c/dunor/admin');
const tablero = leerAccesos(base).filter((e) => e.tipo === 'tablero');
check('abrir el tablero de su cliente se anota', tablero.length === 1 && tablero[0]?.usuario === 'dueno' && tablero[0]?.cliente === 'dunor', JSON.stringify(tablero));
await comoDueno('/c/dunor/admin/api/contacts');
check('pero no cada llamada de adentro: sería ruido', leerAccesos(base).filter((e) => e.tipo === 'tablero').length === 1);

await comoDueno('/api/yo', { method: 'PATCH', body: JSON.stringify({ claveActual: 'clave-del-dueno-1', claveNueva: 'clave-nueva-del-dueno' }) });
check('cambiarse la clave uno mismo queda, sin la clave', ultima()?.que === 'lo suyo: clave nueva' && ultima()?.por === 'dueno' && !/clave-nueva-del-dueno/.test(archivo()), JSON.stringify(ultima()));
const otra = (await (await entrar({ usuario: 'dueno', clave: 'clave-nueva-del-dueno' })).json()) as { sesion: string };
await app.request('http://local/api/salir', { method: 'POST', headers: { ...desde('190.24.1.2'), 'x-consola-sesion': otra.sesion } });
check('salir se anota', ultima()?.tipo === 'salio' && ultima()?.usuario === 'dueno');

// El freno va último: deja bloqueada esa dirección quince minutos.
let frenada = 0;
for (let i = 0; i < 30 && !frenada; i++) if ((await entrar({ usuario: 'dueno', clave: `mala-${i}-xxxxx` }, '10.9.9.9')).status === 429) frenada = i;
check('cuando el freno salta, se anota como frenado', frenada > 0 && ultima()?.tipo === 'frenado' && ultima()?.usuario === 'dueno', JSON.stringify(ultima()));
const enSalud = accesosParaSalud(base, { usuario: 'dueno' }).porUsuario.find((r) => r.usuario === 'dueno');
check('y el resumen lo cuenta como fallos después de su último ingreso', (enSalud?.fallosDesdeUltimoIngreso ?? 0) > 5, JSON.stringify(enSalud));

// ---------- El lanzador del paquete: el token de /_salud ----------
const fuente = readFileSync(new URL('../paquete.ts', import.meta.url), 'utf8');
const arranque = fuente.slice(fuente.indexOf('const ARRANQUE = String.raw`'), fuente.indexOf('`;', fuente.indexOf('const ARRANQUE = String.raw`')));
check('/_salud acepta el token por cabecera propia', /pide\.headers\['x-salud-token'\]/.test(arranque));
check('compara huellas en tiempo fijo, no el token tal cual', /timingSafeEqual\(createHash\('sha256'\)\.update\(token\)\.digest\(\), Buffer\.from\(huellaSalud, 'hex'\)\)/.test(arranque));
check('la bitácora solo sale con token', /if \(conToken\) cuerpo\.accesos = await bitacoraDeAccesos/.test(arranque));
check('al ZIP va la huella, no el token', /writeFileSync\(join\(dir, 'salud\.json'\), `\$\{JSON\.stringify\(\{ huella: createHash\('sha256'\)/.test(fuente) && !/salud\.json'\), [^\n]*tokenDeSalud \}/.test(fuente));
check('🪤 el token de esta máquina nunca se pisa al rearmar', /if \(existsSync\(ARCHIVO_TOKEN_SALUD\)\) \{[\s\S]{0,300}return t;/.test(fuente) && /mode: 0o600/.test(fuente.slice(fuente.indexOf('const tokenDeSalud'))));

console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
