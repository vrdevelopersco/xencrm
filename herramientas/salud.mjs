// Quién ha entrado a la consola de aiva, ya desplegada: pnpm salud [dominio] [--usuario x] [--n 50] [--seguir] [--json]
//
// Lee el token de ~/aiva-credenciales/salud-token.txt (lo crea `pnpm paquete`; al ZIP va solo su huella), le
// pide /_salud al servidor con él y pinta la bitácora de accesos en hora de Colombia. El token va en una cabecera,
// nunca en la dirección: lo que va en la dirección queda escrito en los registros de cualquier servidor de paso.
//
//   pnpm salud                          aiva.hrctechnologies.com, últimos 50 movimientos
//   pnpm salud --usuario dueno.dunor    solo lo de esa persona
//   pnpm salud --seguir                 se queda mirando y pinta lo nuevo cada 20 segundos
//   pnpm salud http://localhost:3500    un paquete levantado aquí para probarlo
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opcion = (nombre) => { const i = args.indexOf(`--${nombre}`); return i >= 0 ? args[i + 1] : undefined; };
const bandera = (nombre) => args.includes(`--${nombre}`);
const sueltos = args.filter((a, i) => !a.startsWith('--') && !['--usuario', '--n'].includes(args[i - 1]));
const destino = sueltos[0] || 'aiva.hrctechnologies.com';
const base = (/^https?:\/\//.test(destino) ? destino : `https://${destino}`).replace(/\/+$/, '');
const n = Math.min(Number(opcion('n')) || 50, 2000);
const usuario = opcion('usuario') || '';

const archivo = process.env.AIVA_SALUD_TOKEN_ARCHIVO || join(homedir(), 'aiva-credenciales', 'salud-token.txt');
let token = '';
try { token = readFileSync(archivo, 'utf8').trim(); } catch {
  console.error(`No encuentro el token en ${archivo}. Lo crea «pnpm paquete»; el paquete que esté subido tiene que haberse armado en esta máquina.`);
  process.exit(1);
}

const hora = (iso) => (iso ? new Date(iso).toLocaleString('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '—');
const hace = (iso) => {
  if (!iso) return '';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return min < 1 ? 'ahora' : min < 60 ? `hace ${min} min` : min < 48 * 60 ? `hace ${Math.round(min / 60)} h` : `hace ${Math.round(min / 1440)} días`;
};
const QUE = { entro: 'entró', fallo: 'falló', frenado: 'frenado', salio: 'salió', tablero: 'tablero', cuenta: 'cuenta' };
const ancho = (s, w) => String(s ?? '').padEnd(w).slice(0, w);

async function pedir() {
  const q = new URLSearchParams({ accesos: String(n) });
  if (usuario) q.set('usuario', usuario);
  const r = await fetch(`${base}/_salud?${q}`, { headers: { 'x-salud-token': token, 'user-agent': 'aiva-salud' } });
  if (!r.ok) throw new Error(`/_salud contestó ${r.status}`);
  return r.json();
}

const linea = (e) => {
  const detalle = e.tipo === 'fallo' || e.tipo === 'frenado' ? e.motivo
    : e.tipo === 'tablero' ? `abrió ${e.cliente}`
    : e.tipo === 'cuenta' ? `${e.que}${e.por && e.por !== e.usuario ? ` (por ${e.por})` : ''}`
    : e.rol ? `(${e.rol})` : '';
  return `  ${ancho(hora(e.cuando), 15)} ${ancho(QUE[e.tipo] || e.tipo, 8)} ${ancho(e.usuario, 20)} ${ancho(detalle, 44)} ${e.navegador || ''}${e.ip ? `  ${e.ip}` : ''}`;
};

const d = await pedir().catch((err) => { console.error(`No pude leer ${base}/_salud: ${err.message}`); process.exit(1); });
if (bandera('json')) { console.log(JSON.stringify(d, null, 2)); process.exit(0); }

console.log(`${base.replace(/^https?:\/\//, '')} · versión ${d.version} · ${d.papel} · arrancó ${hace(d.arrancado)}`);
console.log(`Veredicto: ${d.veredicto}\n`);
if (!d.accesos) {
  console.log('El servidor no reconoció el token, o el paquete subido es de antes de la bitácora (anterior a 2026-10-19).');
  process.exit(1);
}
if (d.accesos.error) { console.log(`La bitácora no se pudo leer allá: ${d.accesos.error}`); process.exit(1); }

const a = d.accesos;
console.log(`Quién ha entrado${usuario ? ` (${usuario})` : ''} · hora de Colombia · ${a.total} movimientos guardados`);
if (!a.porUsuario.length) console.log('  Nadie todavía: la bitácora empieza a contar desde que se subió este paquete.');
for (const u of a.porUsuario) {
  const partes = [u.ultimoIngreso ? `entró ${hora(u.ultimoIngreso)} (${hace(u.ultimoIngreso)}) · ${u.ingresos} ${u.ingresos === 1 ? 'vez' : 'veces'}` : 'nunca ha entrado'];
  if (u.fallosDesdeUltimoIngreso) partes.push(`${u.fallosDesdeUltimoIngreso} ${u.fallosDesdeUltimoIngreso === 1 ? 'fallo' : 'fallos'} ${u.ultimoIngreso ? 'después' : ''} (${u.ultimoMotivo}, ${hace(u.ultimoFallo)})`.replace('  ', ' '));
  if (u.ultimoTablero) partes.push(`abrió un tablero ${hace(u.ultimoTablero)}`);
  console.log(`  ${ancho(u.usuario, 20)} ${partes.join(' · ')}`);
}
console.log('\nÚltimos movimientos:');
for (const e of a.ultimos) console.log(linea(e));

if (bandera('seguir')) {
  let visto = a.ultimos[0]?.cuando || new Date().toISOString();
  console.log('\nMirando lo nuevo cada 20 segundos (Ctrl+C para salir)…');
  for (;;) {
    await new Promise((r) => setTimeout(r, 20_000));
    try {
      const nuevo = (await pedir()).accesos?.ultimos?.filter((e) => e.cuando > visto) || [];
      for (const e of nuevo.reverse()) console.log(linea(e));
      if (nuevo.length) visto = nuevo[nuevo.length - 1].cuando;
    } catch (err) {
      console.log(`  (no contestó: ${err.message}; sigo intentando)`);
    }
  }
}
