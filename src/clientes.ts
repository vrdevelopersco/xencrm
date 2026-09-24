// Varios clientes en una misma máquina, cada uno con lo suyo aparte: su configuración, su base, su WhatsApp, su
// token y su dominio. Un proceso por cliente, no una base compartida: son negocios distintos (una boutique, una
// financiera, una litografía) y lo que no se mezcla no se puede filtrar.
//
//   pnpm cliente lista            qué clientes hay y si están respondiendo
//   pnpm cliente nuevo            da de alta uno (carpeta, token, puerto, dominio)
//   pnpm cliente pm2              escribe el ecosystem de pm2 con todos
//   pnpm cliente tunel            escribe el ingress de cloudflared (un dominio, un cliente por subdominio)
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

export interface ClienteRef {
  slug: string;
  nombre: string;
  puerto: number;
  /** Subdominio por el que entran sus clientes y su equipo. Vacío mientras no haya dominio. */
  host: string;
  /**
   * Dónde vive su instancia, si no es en esta máquina. Vacío = `http://localhost:<puerto>`, que es el caso normal
   * (un proceso por cliente aquí). Con una URL, la consola le habla por ahí: así los clientes pueden estar en una
   * plataforma de apps, cada uno con su dominio, y seguir operándose desde una sola pantalla.
   */
  base?: string;
  /** Para la consola: qué tan pendiente hay que estar de este cliente. */
  prioridad: 'alta' | 'media' | 'baja';
  desde: string;
  notas?: string;
}

/**
 * Cómo atiende el negocio: de aquí sale su embudo, si agenda citas y qué datos le interesa capturar. Es lo primero
 * que se pregunta al dar de alta un cliente, porque una boutique no trabaja como una financiera.
 */
export const PLANTILLAS = [
  {
    id: 'citas',
    nombre: 'Citas',
    ejemplo: 'Boutique, consultorio, taller: la conversación termina en una cita agendada.',
    embudo: 'Nuevo → Conversando → Interesado → Cita agendada → Vendido',
    archivo: 'plantillas/citas.json',
  },
  {
    id: 'soporte',
    nombre: 'Soporte',
    ejemplo: 'Financiera, servicios, posventa: llegan consultas y reclamos que hay que resolver.',
    embudo: 'Nuevo → En revisión → Con un asesor → Resuelto',
    archivo: 'plantillas/soporte.json',
  },
  {
    id: 'cotizacion',
    nombre: 'Cotización y producción',
    ejemplo: 'Impresión industrial, fabricación: se cotiza, se produce y se entrega.',
    embudo: 'Nuevo → Tomando datos → Cotizado → En producción → Entregado',
    archivo: 'plantillas/cotizacion.json',
  },
] as const;

export const archivoDePlantilla = (plantilla?: string): string => {
  if (!plantilla) return PLANTILLAS[0].archivo;
  const p = PLANTILLAS.find((x) => x.id === plantilla);
  return p ? p.archivo : plantilla; // también admite la ruta de una configuración que ya exista
};

const BASE = 'aiva.config.example.json';
const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
function mezclar(base: Record<string, unknown>, encima: Record<string, unknown>): Record<string, unknown> {
  const out = { ...base };
  for (const [k, v] of Object.entries(encima)) out[k] = esObjeto(v) && esObjeto(out[k]) ? mezclar(out[k], v) : v;
  return out;
}

/**
 * La configuración con la que arranca un cliente: la plantilla de cómo atiende (embudo, citas, datos que captura)
 * sobre la configuración de ejemplo, que trae lo que toda instancia necesita.
 */
export function configDePlantilla(plantilla?: string): Record<string, unknown> {
  const archivo = archivoDePlantilla(plantilla);
  if (!existsSync(archivo)) throw new Error(`no encuentro la plantilla ${archivo}`);
  const encima = JSON.parse(readFileSync(archivo, 'utf8')) as Record<string, unknown>;
  const base = existsSync(BASE) ? (JSON.parse(readFileSync(BASE, 'utf8')) as Record<string, unknown>) : {};
  // Una configuración completa (la de un cliente que ya existe) se usa tal cual.
  return PLANTILLAS.some((p) => p.archivo === archivo) ? mezclar(base, encima) : encima;
}

export const CLIENTES_DIR = process.env.AIVA_CLIENTES_DIR || 'clientes';
const INDEX = () => join(CLIENTES_DIR, 'index.json');
const PUERTO_BASE = 3001;

export function leerIndice(): ClienteRef[] {
  if (!existsSync(INDEX())) return [];
  const raw = JSON.parse(readFileSync(INDEX(), 'utf8')) as { clientes?: ClienteRef[] };
  return raw.clientes ?? [];
}

export function guardarIndice(clientes: ClienteRef[]) {
  mkdirSync(CLIENTES_DIR, { recursive: true });
  const ordenados = [...clientes].sort((a, b) => a.slug.localeCompare(b.slug));
  writeFileSync(INDEX(), `${JSON.stringify({ clientes: ordenados }, null, 2)}\n`);
}

export const slugificar = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);

/** El siguiente puerto libre, contando los que ya están dados de alta. */
export function puertoLibre(clientes = leerIndice(), base = PUERTO_BASE): number {
  const usados = new Set(clientes.map((c) => c.puerto));
  let p = base;
  while (usados.has(p)) p++;
  return p;
}

/** La carpeta de un cliente y los archivos que le pertenecen. */
export function rutas(slug: string) {
  const dir = join(CLIENTES_DIR, slug);
  return {
    dir,
    config: join(dir, 'aiva.config.json'),
    env: join(dir, '.env'),
    data: join(dir, 'data'),
    db: join(dir, 'data', 'aiva.db'),
    auth: join(dir, 'auth'),
    diccionario: join(dir, 'dictionary.json'),
    perfil: join(dir, 'profile.json'),
  };
}

/**
 * El token del tablero de un cliente, para que la consola pueda preguntarle cómo va. Sale de su `.env`, o de una
 * variable de entorno `TOKEN_<SLUG>`: eso último es para las plataformas de apps, donde los secretos se ponen en
 * el panel y no en un archivo que viaje dentro del paquete.
 */
export function tokenDe(slug: string): string {
  const porEntorno = process.env[`TOKEN_${slug.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`];
  if (porEntorno) return porEntorno.trim();
  const env = rutas(slug).env;
  if (!existsSync(env)) return '';
  for (const line of readFileSync(env, 'utf8').split('\n')) {
    const m = /^ADMIN_TOKEN\s*=\s*(.*)$/.exec(line.trim());
    if (m) return m[1]!.replace(/^["']|["']$/g, '').trim();
  }
  return '';
}

/** A dónde le habla la consola: su URL si está en otra parte, o su puerto en esta máquina. */
export const urlDe = (c: Pick<ClienteRef, 'base' | 'puerto'>): string => (c.base ? c.base.replace(/\/$/, '') : `http://localhost:${c.puerto}`);

/** Cambia lo que el super-admin puede ajustar de un cliente: prioridad, dominio, notas y dónde vive. */
export function actualizarCliente(slug: string, cambios: Partial<Pick<ClienteRef, 'prioridad' | 'host' | 'notas' | 'nombre' | 'base'>>): ClienteRef {
  const clientes = leerIndice();
  const i = clientes.findIndex((c) => c.slug === slug);
  if (i === -1) throw new Error('ese cliente no existe');
  const actualizado = { ...clientes[i]!, ...cambios };
  clientes[i] = actualizado;
  guardarIndice(clientes);
  return actualizado;
}

/**
 * Da de alta un cliente: carpeta, configuración (copiada de una plantilla), token propio y su línea en el índice.
 * No arranca nada: eso lo hace pm2 con `pnpm cliente pm2`.
 */
export function crearCliente(opts: {
  nombre: string;
  slug?: string;
  /** "citas", "soporte", "cotizacion" o la ruta de una configuración que ya exista. */
  plantilla?: string;
  puerto?: number;
  host?: string;
  /** Si la instancia no corre en esta máquina: la URL donde responde. */
  base?: string;
  prioridad?: ClienteRef['prioridad'];
  hoy?: string;
}): { cliente: ClienteRef; token: string } {
  const clientes = leerIndice();
  const slug = slugificar(opts.slug || opts.nombre);
  if (!slug) throw new Error('el nombre no da para un identificador');
  if (clientes.some((c) => c.slug === slug)) throw new Error(`ya existe un cliente con el identificador "${slug}"`);
  const puerto = opts.puerto ?? puertoLibre(clientes);
  if (clientes.some((c) => c.puerto === puerto)) throw new Error(`el puerto ${puerto} ya lo usa otro cliente`);

  const r = rutas(slug);
  mkdirSync(r.data, { recursive: true });
  mkdirSync(r.auth, { recursive: true });

  const config = configDePlantilla(opts.plantilla);
  const negocio = (config.business ?? {}) as Record<string, unknown>;
  config.business = { ...negocio, name: opts.nombre };
  // Todo lo del cliente vive con el cliente: diccionario, perfil, catálogo y lo que sepa. Nada compartido con otro.
  config.dictionaryFile = resolve(r.diccionario);
  config.profileFile = resolve(r.perfil);
  const sources = { ...((config.sources ?? {}) as Record<string, unknown>) };
  sources.productsFile = resolve(join(r.dir, 'catalogo', 'productos.json'));
  sources.knowledgeDir = resolve(join(r.dir, 'conocimiento'));
  config.sources = sources;
  mkdirSync(join(r.dir, 'catalogo'), { recursive: true });
  mkdirSync(join(r.dir, 'conocimiento'), { recursive: true });
  writeFileSync(r.config, `${JSON.stringify(config, null, 2)}\n`);

  const token = randomBytes(24).toString('hex');
  const host = opts.host ?? '';
  const env = [
    `# ${opts.nombre} · lo que es de este cliente. Lo compartido (claves de OpenAI, Ollama) está en el .env de la raíz.`,
    `PORT=${puerto}`,
    `DB_PATH=${resolve(r.db)}`,
    `WHATSAPP_AUTH_DIR=${resolve(r.auth)}`,
    `ADMIN_TOKEN=${token}`,
    '# WhatsApp se enciende desde el tablero (Canales) cuando vayan a escanear el código.',
    'WHATSAPP_ENABLED=false',
    `PUBLIC_URL=${host ? `https://${host}` : ''}`,
    `ALLOWED_ORIGINS=*`,
    '',
  ].join('\n');
  writeFileSync(r.env, env, { mode: 0o600 });

  const cliente: ClienteRef = {
    slug,
    nombre: opts.nombre,
    puerto,
    host,
    ...(opts.base ? { base: opts.base.replace(/\/$/, '') } : {}),
    prioridad: opts.prioridad ?? 'media',
    desde: (opts.hoy ?? new Date().toISOString()).slice(0, 10),
  };
  guardarIndice([...clientes, cliente]);
  return { cliente, token };
}

/**
 * Da de baja un cliente: sale del índice y su carpeta se guarda en `clientes/_dados-de-baja/` con la fecha. **No
 * se borra nada**: ahí quedan su base, su configuración y su sesión de WhatsApp, por si hay que volver o por si
 * el cliente pide sus datos. Quien la borre de verdad, que lo haga a mano y sabiendo.
 *
 * Los usuarios que lo atendían se limpian aparte (`consola-usuarios.ts › quitarClienteDeUsuarios`): si no, quedan
 * apuntando a un cliente que ya no existe.
 */
export function darDeBajaCliente(slug: string, hoy = new Date()): { cliente: ClienteRef; guardadoEn: string } {
  const clientes = leerIndice();
  const cliente = clientes.find((c) => c.slug === slug);
  if (!cliente) throw new Error('ese cliente no existe');
  const r = rutas(slug);
  const destino = join(CLIENTES_DIR, '_dados-de-baja', `${slug}-${hoy.toISOString().slice(0, 10)}`);
  if (existsSync(r.dir)) {
    mkdirSync(join(CLIENTES_DIR, '_dados-de-baja'), { recursive: true });
    renameSync(r.dir, destino);
  }
  guardarIndice(clientes.filter((c) => c.slug !== slug));
  return { cliente, guardadoEn: destino };
}

/** El ecosystem de pm2: una app por cliente, con su configuración y su base. */
export function pm2Config(clientes = leerIndice()): string {
  const apps = clientes.map((c) => ({
    name: `aiva-${c.slug}`,
    script: 'node_modules/.bin/tsx',
    args: 'src/index.ts',
    cwd: resolve('.'),
    env: {
      AIVA_CONFIG: resolve(rutas(c.slug).config),
      AIVA_ENV_FILE: resolve(rutas(c.slug).env),
      NODE_ENV: 'production',
    },
    max_restarts: 10,
    restart_delay: 4000,
    out_file: resolve(join(rutas(c.slug).dir, 'aiva.log')),
    error_file: resolve(join(rutas(c.slug).dir, 'aiva.error.log')),
  }));
  return `// Generado por: pnpm cliente pm2 — no editar a mano.\nmodule.exports = { apps: ${JSON.stringify(apps, null, 2)} };\n`;
}

/** El ingress de cloudflared: un solo túnel, un subdominio por cliente. */
export function tunelConfig(clientes = leerIndice(), opts: { tunnel?: string } = {}): string {
  const conHost = clientes.filter((c) => c.host);
  const reglas = conHost.map((c) => `  - hostname: ${c.host}\n    service: http://localhost:${c.puerto}`).join('\n');
  return [
    '# Generado por: pnpm cliente tunel',
    `tunnel: ${opts.tunnel ?? 'aiva'}`,
    `credentials-file: ~/.cloudflared/${opts.tunnel ?? 'aiva'}.json`,
    '',
    'ingress:',
    reglas || '  # (ningún cliente tiene dominio todavía)',
    '  - service: http_status:404',
    '',
  ].join('\n');
}

// ---------- Línea de comandos ----------
async function main() {
  const [accion = 'lista'] = process.argv.slice(2);
  const clientes = leerIndice();

  if (accion === 'lista') {
    if (!clientes.length) return console.log('Todavía no hay clientes. Se da de alta uno con: pnpm cliente nuevo');
    console.log('\ncliente               puerto  prioridad  dominio                        estado');
    for (const c of clientes) {
      const estado = await fetch(`http://localhost:${c.puerto}/admin`, { signal: AbortSignal.timeout(1500) })
        .then((r) => (r.ok ? 'arriba' : `responde ${r.status}`))
        .catch(() => 'apagado');
      console.log(`${c.slug.padEnd(20)} ${String(c.puerto).padStart(6)}  ${c.prioridad.padEnd(9)}  ${(c.host || '—').padEnd(29)}  ${estado}`);
    }
    console.log(`\n${clientes.length} cliente${clientes.length === 1 ? '' : 's'}. El detalle de cada uno, en su tablero.`);
    return;
  }

  if (accion === 'base') {
    const [, slug, url] = process.argv.slice(2);
    if (!slug) {
      console.log('Uso: pnpm cliente base <slug> <url>   ·   pnpm cliente base <slug> aqui   (para volver a localhost)');
      return;
    }
    const cliente = actualizarCliente(slug, { base: !url || url === 'aqui' ? undefined : url });
    console.log(`${cliente.nombre}: la consola ahora le habla a ${cliente.base ?? `http://localhost:${cliente.puerto}`}`);
    return;
  }

  if (accion === 'pm2') {
    writeFileSync('ecosystem.config.cjs', pm2Config(clientes));
    console.log(`ecosystem.config.cjs con ${clientes.length} cliente${clientes.length === 1 ? '' : 's'}.`);
    console.log('Arrancar todo:  pm2 start ecosystem.config.cjs && pm2 save');
    console.log('Al prender el Mac:  pm2 startup   (una sola vez, dice qué pegar)');
    return;
  }

  if (accion === 'tunel') {
    const destino = join(CLIENTES_DIR, 'cloudflared.yml');
    mkdirSync(CLIENTES_DIR, { recursive: true });
    writeFileSync(destino, tunelConfig(clientes));
    console.log(`${destino} con ${clientes.filter((c) => c.host).length} dominio(s).`);
    console.log('Correr el túnel:  cloudflared tunnel --config ' + destino + ' run');
    return;
  }

  if (accion === 'nuevo') {
    const rl = createInterface({ input: stdin, output: stdout });
    const ask = async (q: string, def = '') => (await rl.question(`${q}${def ? ` [${def}]` : ''}: `)).trim() || def;
    console.log('\n🌱 Alta de un cliente\n');
    const nombre = await ask('Nombre del negocio');
    if (!nombre) {
      console.log('Sin nombre no puedo seguir.');
      rl.close();
      return;
    }
    const slug = slugificar(await ask('Identificador (para carpetas y subdominio)', slugificar(nombre)));
    const puerto = Number(await ask('Puerto', String(puertoLibre(clientes))));
    const host = await ask('Dominio (vacío si todavía no hay)', '');
    const prioridad = (await ask('Prioridad (alta/media/baja)', 'media')) as ClienteRef['prioridad'];
    console.log('\n¿Cómo atiende este negocio? De aquí sale su embudo y si agenda citas.');
    for (const p of PLANTILLAS) console.log(`  ${p.id.padEnd(11)} ${p.nombre} · ${p.ejemplo}\n${' '.repeat(14)}${p.embudo}`);
    const plantilla = await ask('\nPlantilla', PLANTILLAS[0].id);
    rl.close();

    const { cliente, token } = crearCliente({ nombre, slug, puerto, host, prioridad, plantilla });
    const r = rutas(cliente.slug);
    const elegida = PLANTILLAS.find((p) => p.id === plantilla);
    console.log(`\n✓ ${cliente.nombre} quedó en ${r.dir}${elegida ? ` · ${elegida.nombre}: ${elegida.embudo}` : ''}`);
    console.log(`  tablero: http://localhost:${cliente.puerto}/admin`);
    console.log(`  token:   ${token}  (también en ${r.env}, con permisos 600)`);
    console.log('\nFalta:');
    console.log(`  1. Ajustar ${r.config} con lo del negocio (o desde el tablero, en Perfil).`);
    console.log('  2. pnpm cliente pm2   y   pm2 start ecosystem.config.cjs');
    if (host) console.log('  3. pnpm cliente tunel   para que entre por ' + host);
    return;
  }

  console.log('Acciones: lista · nuevo · base · pm2 · tunel');
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
