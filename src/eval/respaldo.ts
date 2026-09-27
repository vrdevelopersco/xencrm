// Pruebas del respaldo de configuración (sin modelo): pnpm test:respaldo
// Lo que importa: que no se lleve secretos ni rutas de otra máquina, que restaurar deje primero una copia de lo
// que había, que un respaldo de otro cliente no entre por descuido y que nada escriba fuera de su carpeta.
import { mkdirSync, mkdtempSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { armar, restaurar, revisar, VERSION } = await import('../crm/respaldo.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};

// Un cliente de mentira, con todo lo suyo.
const dir = mkdtempSync(join(tmpdir(), 'aiva-respaldo-'));
mkdirSync(join(dir, 'conocimiento'), { recursive: true });
mkdirSync(join(dir, 'catalogo'), { recursive: true });
const donde = {
  slug: 'boutique',
  nombre: 'Boutique de prueba',
  config: join(dir, 'aiva.config.json'),
  perfil: join(dir, 'profile.json'),
  diccionario: join(dir, 'dictionary.json'),
  catalogo: join(dir, 'catalogo', 'productos.json'),
  conocimiento: join(dir, 'conocimiento'),
};
writeFileSync(donde.config, JSON.stringify({
  business: { name: 'Boutique de prueba', description: 'Alquiler de trajes', siteUrl: 'https://ejemplo.co', humanContact: 'escríbenos' },
  agent: { name: 'Aiva', style: 'cálido' },
  brand: { color: '#C5A47E', logo: '/Users/alguien/su-maquina/marca/logo.png', favicon: 'https://ejemplo.co/fav.png' },
  dictionaryFile: '/Users/alguien/su-maquina/dictionary.json',
  profileFile: '/Users/alguien/su-maquina/profile.json',
  sources: { productsFile: '/Users/alguien/su-maquina/productos.json', knowledgeDir: '/Users/alguien/su-maquina/conocimiento' },
}));
writeFileSync(donde.perfil, JSON.stringify({ identity: { name: 'Boutique de prueba' }, service: { hours: 'L-S 10-7' } }));
writeFileSync(donde.diccionario, JSON.stringify({ terms: [{ term: 'terno', meaning: 'vestido de hombre' }] }));
writeFileSync(donde.catalogo, JSON.stringify([{ id: 1, name: 'Esmoquin' }]));
writeFileSync(join(donde.conocimiento, 'politicas.md'), '# Políticas\nSolo con cita.');

const r = armar(donde, new Date('2026-09-25T15:00:00Z'));
check('se lleva la configuración, el perfil, el diccionario y el catálogo', Boolean(r.config.business) && Boolean(r.perfil) && Boolean(r.diccionario) && Boolean(r.catalogo));
check('y los documentos de lo que sabe', r.conocimiento.length === 1 && r.conocimiento[0]!.nombre === 'politicas.md' && /Solo con cita/.test(r.conocimiento[0]!.texto));
check('dice de qué cliente salió y cuándo', r.slug === 'boutique' && r.negocio === 'Boutique de prueba' && r.fecha.startsWith('2026-09-25'));

// 🪤 Las rutas son de la máquina donde vive: en otra no significan nada.
const comoTexto = JSON.stringify(r);
check('no se lleva las rutas de esa máquina', !comoTexto.includes('/Users/alguien'), comoTexto.slice(0, 260));
check('de la marca guarda solo el nombre del archivo', (r.config.brand as Record<string, unknown>).logo === 'logo.png', JSON.stringify(r.config.brand));
check('y una URL https se guarda tal cual', (r.config.brand as Record<string, unknown>).favicon === 'https://ejemplo.co/fav.png');
check('ni ningún secreto', !/token|api[_-]?key|clave/i.test(comoTexto), comoTexto.slice(0, 200));

// --- restaurar ---
const otroDir = mkdtempSync(join(tmpdir(), 'aiva-restaurar-'));
mkdirSync(join(otroDir, 'conocimiento'), { recursive: true });
const destino = {
  slug: 'boutique',
  nombre: 'Otra cosa',
  config: join(otroDir, 'aiva.config.json'),
  perfil: join(otroDir, 'profile.json'),
  diccionario: join(otroDir, 'dictionary.json'),
  catalogo: join(otroDir, 'catalogo', 'productos.json'),
  conocimiento: join(otroDir, 'conocimiento'),
};
writeFileSync(destino.config, JSON.stringify({
  business: { name: 'Otra cosa', description: 'Otra cosa distinta', siteUrl: 'https://otra.co', humanContact: 'escríbenos' },
  agent: { name: 'Otra' },
  dictionaryFile: join(otroDir, 'dictionary.json'),
  profileFile: join(otroDir, 'profile.json'),
  sources: { productsFile: destino.catalogo, knowledgeDir: destino.conocimiento },
}));

const hecho = restaurar(destino, r, { carpetaCopias: join(otroDir, 'respaldos'), hoy: new Date('2026-09-26T10:00:00Z') });
const quedo = JSON.parse(readFileSync(destino.config, 'utf8')) as Record<string, any>;
check('restaurar trae la configuración del respaldo', quedo.business.name === 'Boutique de prueba' && quedo.agent.style === 'cálido');
check('🪤 pero conserva las rutas de ESTA máquina', quedo.dictionaryFile === join(otroDir, 'dictionary.json') && quedo.sources.knowledgeDir === destino.conocimiento, JSON.stringify(quedo.sources));
check('y la marca queda apuntando a la carpeta de este cliente', String(quedo.brand.logo).startsWith(otroDir) && String(quedo.brand.logo).endsWith('logo.png'), String(quedo.brand.logo));
check('trae el perfil, el diccionario y el catálogo', existsSync(destino.perfil) && existsSync(destino.diccionario) && existsSync(destino.catalogo));
check('y los documentos', existsSync(join(destino.conocimiento, 'politicas.md')));
check('deja copia de lo que había antes de pisarlo', existsSync(hecho.copiaEn) && JSON.parse(readFileSync(hecho.copiaEn, 'utf8')).config.business.name === 'Otra cosa', hecho.copiaEn);
check('cuenta qué escribió', hecho.escrito.length >= 4, hecho.escrito.join(', '));

// --- lo que no puede pasar ---
check('un archivo que no es un respaldo se rechaza', 'error' in revisar({ hola: 1 }, 'boutique'));
check('uno de otra versión, también', 'error' in revisar({ ...r, version: 99 }, 'boutique'));
const deOtro = revisar({ ...r, slug: 'financiera', negocio: 'Financiera' }, 'boutique');
check('uno de OTRO cliente se avisa antes de pisar nada', !('error' in deOtro) && deOtro.otroCliente === true);
check('y el del mismo cliente pasa derecho', !('error' in revisar(r, 'boutique')) && (revisar(r, 'boutique') as { otroCliente: boolean }).otroCliente === false);

// Un respaldo no puede escribir fuera de su carpeta.
const travieso = { ...r, conocimiento: [{ nombre: '../../fuera.md', texto: 'no debería estar aquí' }] };
restaurar(destino, travieso as typeof r, { carpetaCopias: join(otroDir, 'respaldos') });
check('un nombre con ../ no escribe fuera de la carpeta', !existsSync(join(otroDir, '..', 'fuera.md')) && readdirSync(destino.conocimiento).some((f) => f.includes('fuera.md')),
  readdirSync(destino.conocimiento).join(','));

// 🪤 Un respaldo con la configuración rota dejaría al cliente sin arrancar (y reiniciándose en bucle si hay un
// supervisor detrás). Tiene que rebotar ANTES de escribir nada.
const roto = { ...r, config: { ...r.config, business: { nombre: 'sin el campo que toca' } } };
let reboto = '';
try {
  restaurar(destino, roto as typeof r, { carpetaCopias: join(otroDir, 'respaldos') });
} catch (e) {
  reboto = (e as Error).message;
}
check('un respaldo que dejaría la configuración rota no se escribe', reboto.includes('no restauré nada'), reboto || 'no rebotó: lo escribió');
check('y lo que había sigue en su sitio', JSON.parse(readFileSync(destino.config, 'utf8')).business.name === 'Boutique de prueba',
  JSON.parse(readFileSync(destino.config, 'utf8')).business.name);

check('la versión del formato va dentro', VERSION === 1 && r.version === 1);

console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
