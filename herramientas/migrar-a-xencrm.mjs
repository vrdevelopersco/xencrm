// Migra los archivos LOCALES de una instalación que se llamaba aiva a los nombres de XENCRM.
//
//   node herramientas/migrar-a-xencrm.mjs            dice qué haría, sin tocar nada
//   node herramientas/migrar-a-xencrm.mjs --aplicar  lo hace (con respaldo de cada archivo de texto que cambia)
//
// Por qué existe: XENCRM nació de una copia de aiva y el código ya dice xencrm en todo (XENCRM_*, xencrm.config.json,
// data/xencrm.db…). Lo que git no sigue —la .env, la carpeta clientes/, las bases, el lanzador de pm2, el sidecar
// compilado— seguía con los nombres viejos, y sin migrarlo el programa no encuentra su configuración ni sus datos.
//
// 🪤 Las copias de los clientes apuntaban a la carpeta de AIVA (DB_PATH=…/proyectos/aiva/clientes/dunor/data/aiva.db
// y WHATSAPP_AUTH_DIR=…/proyectos/aiva/…): arrancar la consola desde aquí escribía en las bases de aiva y usaba sus
// sesiones de WhatsApp. Esas rutas pasan a esta carpeta, que tiene su propia copia. Nunca se toca la carpeta de aiva.
//
// No cambia lo que es del negocio: el nombre que cada cliente le puso a su asistente, su conocimiento, su
// diccionario. Es idempotente: correrlo dos veces no hace nada la segunda.
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const aplicar = process.argv.includes('--aplicar');
const raiz = resolve(process.argv.find((a, i) => i > 1 && !a.startsWith('--')) ?? '.');
const carpetaAiva = join(dirname(raiz), 'aiva'); // la hermana de la que nació esta copia
const cambios = [];

const mover = (de, a) => {
  if (!existsSync(de)) return;
  if (existsSync(a)) { cambios.push(`  ya existe, no se pisa: ${a.replace(raiz + '/', '')}`); return; }
  cambios.push(`  ${de.replace(raiz + '/', '')} → ${basename(a)}`);
  if (aplicar) renameSync(de, a);
};
/** Una base y sus compañeros de SQLite (-wal, -shm) se mudan juntos, o la base queda a medias. */
const moverBase = (carpeta) => {
  for (const sufijo of ['', '-wal', '-shm']) mover(join(carpeta, 'aiva.db' + sufijo), join(carpeta, 'xencrm.db' + sufijo));
  const resp = join(carpeta, 'backups');
  if (existsSync(resp)) for (const f of readdirSync(resp)) if (/^aiva-.*\.db$/.test(f)) mover(join(resp, f), join(resp, f.replace(/^aiva-/, 'xencrm-')));
};
/** Un archivo de texto: se reescribe con su respaldo al lado («.antes-de-xencrm»), que git no sigue. */
const reescribir = (ruta, cambiar) => {
  if (!existsSync(ruta) || !statSync(ruta).isFile()) return;
  const antes = readFileSync(ruta, 'utf8');
  const despues = cambiar(antes);
  if (despues === antes) return;
  const claves = [...new Set((antes.match(/^[A-Z][A-Z0-9_]*(?==)/gm) ?? []).filter((k) => /AIVA/.test(k)))];
  cambios.push(`  ${ruta.replace(raiz + '/', '')}: ${claves.length ? 'variables ' + claves.join(', ') + ' → XENCRM_…' : 'nombres y rutas'}${/\/aiva\//.test(antes) ? ' · rutas a esta carpeta' : ''}`);
  if (aplicar) { copyFileSync(ruta, ruta + '.antes-de-xencrm'); writeFileSync(ruta, despues); }
};
/** En una .env: las variables AIVA_* y las rutas que apuntaban a la carpeta de aiva o a aiva.db. Los valores (llaves) no se tocan. */
const enEnv = (s) => s
  .replace(/^AIVA_/gm, 'XENCRM_')
  .replaceAll(carpetaAiva + '/', raiz + '/')
  .replace(/\baiva\.db\b/g, 'xencrm.db')
  .replace(/\baiva\.config\.json\b/g, 'xencrm.config.json');
/** El lanzador de pm2 (lo arma `pnpm cliente`): sus nombres, sus variables y sus rutas. */
const enLanzador = (s) => enEnv(s).replace(/\bAIVA_/g, 'XENCRM_').replace(/(['"`])aiva-/g, '$1xencrm-').replace(/\baiva\.(log|error\.log)\b/g, 'xencrm.$1').replace(/aiva-afm/g, 'xencrm-afm');

console.log(`${aplicar ? 'Migrando' : 'Lo que haría (corre con --aplicar para hacerlo)'}: ${raiz}`);
moverBase(join(raiz, 'data'));
for (const f of ['.env', 'conector.env', 'DUNORKEY.env']) reescribir(join(raiz, f), enEnv);
reescribir(join(raiz, 'ecosystem.config.cjs'), enLanzador);
mover(join(raiz, 'sidecar/bin/aiva-afm'), join(raiz, 'sidecar/bin/xencrm-afm'));
const clientes = join(raiz, 'clientes');
if (existsSync(clientes)) {
  for (const slug of readdirSync(clientes)) {
    const c = join(clientes, slug);
    if (!statSync(c).isDirectory()) continue;
    mover(join(c, 'aiva.config.json'), join(c, 'xencrm.config.json'));
    mover(join(c, 'aiva.log'), join(c, 'xencrm.log'));
    mover(join(c, 'aiva.error.log'), join(c, 'xencrm.error.log'));
    moverBase(join(c, 'data'));
    reescribir(join(c, '.env'), enEnv);
  }
}
console.log(cambios.length ? cambios.join('\n') : '  nada que migrar');
if (!aplicar && cambios.length) console.log('\nNada se tocó. Con --aplicar se hace, y cada archivo de texto deja su respaldo «.antes-de-xencrm».');
