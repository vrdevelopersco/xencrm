// Asistente de configuración de un cliente: pnpm onboard
// Crea aiva.config.json (desde un ejemplo o desde cero), carpetas de datos y las claves de .env que falten.
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { MAXIMO_SEDES, sedesDeTexto } from './sedes-texto.js';

const rl = createInterface({ input: stdin, output: stdout });
const ask = async (q: string, def = ''): Promise<string> => {
  const a = (await rl.question(`${q}${def ? ` [${def}]` : ''}: `)).trim();
  return a || def;
};
const yes = async (q: string, def = true): Promise<boolean> => {
  const a = (await ask(`${q} (s/n)`, def ? 's' : 'n')).toLowerCase();
  return a.startsWith('s') || a === 'y';
};
const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

console.log('\n🌱 Aiva · configuración de un cliente\n');
if (existsSync('aiva.config.json') && !(await yes('Ya existe aiva.config.json. ¿Lo reemplazo?', false))) {
  console.log('Sin cambios.');
  process.exit(0);
}

/** Color y logo del cliente para el chat del sitio y la página de la cita (el contraste se ajusta solo). */
async function askBrand(prev: { color?: string; logo?: string }): Promise<{ color: string; logo?: string }> {
  let color = '';
  while (!/^#[0-9a-fA-F]{6}$/.test(color)) color = await ask('Color de la marca (hex, como #C5A47E)', prev.color ?? '#2f7d4f');
  const logo = await ask('Logo (URL https o archivo png/jpg/svg; vacío si no hay)', prev.logo ?? '');
  return logo ? { color, logo } : { color };
}

const mode = await ask('¿Empezar desde un ejemplo (dunor | boutique | casa-verde) o desde cero (nuevo)?', 'nuevo');
let config: Record<string, unknown>;

if (mode === 'dunor' || mode === 'boutique' || mode === 'casa-verde') {
  config = JSON.parse(readFileSync(`examples/${mode}/aiva.config.json`, 'utf8'));
  const biz = config.business as Record<string, string>;
  biz.name = await ask('Nombre del negocio', biz.name);
  biz.description = await ask('Descripción corta (qué vende y a quién)', biz.description);
  biz.siteUrl = await ask('Sitio web', biz.siteUrl);
  biz.humanContact = await ask('Cómo contactar a una persona del equipo', biz.humanContact);
  (config.agent as Record<string, string>).name = await ask('Nombre del asistente', (config.agent as Record<string, string>).name);
  config.brand = await askBrand((config.brand as { color?: string; logo?: string } | undefined) ?? {});
  if (await yes('¿Copiar el catálogo y la información del ejemplo a data/ para editarlos?', true)) {
    mkdirSync('data', { recursive: true });
    cpSync(`examples/${mode}/catalog`, 'data/catalog', { recursive: true });
    cpSync(`examples/${mode}/knowledge`, 'data/knowledge', { recursive: true });
    cpSync(`examples/${mode}/scenarios.json`, 'data/scenarios.json');
    if (existsSync(`examples/${mode}/seed.json`)) {
      cpSync(`examples/${mode}/seed.json`, 'data/seed.json');
      config.seedFile = 'data/seed.json';
    }
    config.sources = { productsFile: 'data/catalog/products.json', knowledgeDir: 'data/knowledge', sitePages: [] };
    config.evalFile = 'data/scenarios.json';
  }
} else {
  const name = await ask('Nombre del negocio', 'Mi tienda');
  config = {
    business: {
      name,
      description: await ask('Descripción corta (qué vende y a quién)', 'Tienda online'),
      siteUrl: await ask('Sitio web', `https://${slug(name)}.com`),
      currency: await ask('Moneda', 'COP'),
      country: await ask('País', 'Colombia'),
      phoneCountryCode: await ask('Indicativo telefónico del país (sin +)', '57'),
      phoneLocalDigits: Number(await ask('Dígitos de un número local', '10')),
      humanContact: await ask('Cómo contactar a una persona del equipo', 'escríbenos por WhatsApp al número del negocio.'),
    },
    agent: {
      name: await ask('Nombre del asistente', 'Aiva'),
      style: await ask('Estilo de conversación', 'cálido, cercano, tutea, mensajes cortos tipo WhatsApp'),
      language: 'es',
    },
    sources: { productsFile: 'data/catalog/products.json', knowledgeDir: 'data/knowledge', sitePages: [] },
    brand: await askBrand({}),
    timezone: await ask('Zona horaria', 'America/Bogota'),
    appointments: { enabled: false },
    crm: { fields: [{ name: 'producto_interes', description: 'Producto o servicio que le interesa al cliente, si lo dijo' }] },
    evalFile: 'data/scenarios.json',
  };
  if (await yes('¿El negocio agenda citas (medidas, visitas, pruebas)?', false)) {
    const days = (await ask('Días de atención (0=dom … 6=sáb, separados por coma)', '1,2,3,4,5')).split(',').map((d) => Number(d.trim()));
    const hours = (await ask('Franjas horarias HH:MM-HH:MM separadas por coma', '09:00-13:00,14:00-18:00')).split(',').map((h) => h.trim().split('-') as [string, string]);
    config.appointments = {
      enabled: true,
      service: await ask('Nombre del servicio de la cita', 'cita'),
      location: await ask('Lugar (vacío si es virtual)', ''),
      durationMin: Number(await ask('Duración en minutos', '45')),
      days,
      hours,
      capacity: Number(await ask('Citas simultáneas', '1')),
      minLeadHours: Number(await ask('Antelación mínima en horas', '12')),
      maxDaysAhead: Number(await ask('Máximo de días hacia adelante', '21')),
    };
  }
  const fields = await ask('Datos a capturar en cada conversación (nombre_campo:descripción; separados por |)', 'producto_interes:Producto o servicio que le interesa');
  (config.crm as { fields: unknown[] }).fields = fields
    .split('|')
    .map((f) => f.split(':'))
    .filter((p) => p[0]?.trim())
    .map(([n, ...d]) => ({ name: slug(n!.trim()).replace(/-/g, '_'), description: d.join(':').trim() || n!.trim() }));
  mkdirSync('data/catalog', { recursive: true });
  mkdirSync('data/knowledge', { recursive: true });
  if (!existsSync('data/catalog/products.json')) {
    writeFileSync(
      'data/catalog/products.json',
      JSON.stringify(
        [{ id: 'p001', name: 'Producto de ejemplo', description: 'Descripción del producto.', price: 10000, category: 'General', tags: [], url: `${(config.business as { siteUrl: string }).siteUrl}/productos/ejemplo`, inStock: true, specs: { Medidas: '10 cm' } }],
        null,
        2,
      ),
    );
  }
  if (!existsSync('data/knowledge/sobre-nosotros.md')) writeFileSync('data/knowledge/sobre-nosotros.md', `# Sobre ${name}\n\nDescribe aquí el negocio, horarios, contacto, envíos, pagos y políticas. Un archivo .md por tema.\n`);
  if (!existsSync('data/scenarios.json')) writeFileSync('data/scenarios.json', JSON.stringify([{ name: 'saludo', turns: [{ text: 'hola', expect: { intent: 'saludo' } }] }], null, 2));
}

// Las sedes, solo si atiende en varios sitios con un mismo número. 🪤 Sin sedes (lo normal) no se escribe nada: el
// asistente no oye hablar de sedes en ninguna parte. Sus días y franjas propios se ponen después, en El negocio.
if (await yes('¿Atiende en varias sedes con el mismo número?', false)) {
  const lineas: string[] = [];
  for (let i = 1; i <= MAXIMO_SEDES; i++) {
    const linea = await ask(`Sede ${i} (Nombre · Dirección; vacío para terminar)`);
    if (!linea) break;
    lineas.push(linea);
  }
  try {
    const sedes = sedesDeTexto(lineas.join('\n'), (config.business as { name: string }).name);
    if (sedes.length) config.sedes = sedes;
  } catch (err) {
    console.log(`⚠️  ${(err as Error).message}. Las sedes se pueden poner después, en El negocio.`);
  }
}

writeFileSync('aiva.config.json', JSON.stringify(config, null, 2) + '\n');
console.log('\n✓ aiva.config.json escrito');

// ---------- .env ----------
const envPath = '.env';
const current = existsSync(envPath) ? readFileSync(envPath, 'utf8') : readFileSync('.env.example', 'utf8');
const lines = current.split('\n');
const setKey = (key: string, value: string) => {
  const i = lines.findIndex((l) => l.startsWith(`${key}=`));
  const line = `${key}=${value}`;
  if (i >= 0) lines[i] = line;
  else lines.push(line);
};
const get = (key: string) => lines.find((l) => l.startsWith(`${key}=`))?.split('=').slice(1).join('=').split('#')[0]?.trim() ?? '';

if (!get('ADMIN_TOKEN')) setKey('ADMIN_TOKEN', randomBytes(12).toString('hex'));
const channel = await ask('Canal de WhatsApp: baileys (QR con tu número) | meta (Cloud API oficial) | ninguno', get('META_PHONE_NUMBER_ID') ? 'meta' : 'baileys');
if (channel === 'meta') {
  setKey('WHATSAPP_ENABLED', 'false');
  setKey('META_ACCESS_TOKEN', await ask('META_ACCESS_TOKEN', get('META_ACCESS_TOKEN')));
  setKey('META_PHONE_NUMBER_ID', await ask('META_PHONE_NUMBER_ID', get('META_PHONE_NUMBER_ID')));
  setKey('META_VERIFY_TOKEN', await ask('META_VERIFY_TOKEN (invéntalo y regístralo en Meta)', get('META_VERIFY_TOKEN') || randomBytes(8).toString('hex')));
  setKey('META_APP_SECRET', await ask('META_APP_SECRET (opcional, valida firmas)', get('META_APP_SECRET')));
} else if (channel === 'ninguno') {
  setKey('WHATSAPP_ENABLED', 'false');
} else {
  setKey('WHATSAPP_ENABLED', 'true');
}
if (await yes('¿Usar OpenAI como motor pesado (recomendar, comparar, detalles)?', Boolean(get('OPENAI_API_KEY')))) {
  setKey('OPENAI_API_KEY', await ask('OPENAI_API_KEY', get('OPENAI_API_KEY')));
  setKey('OPENAI_MODEL', await ask('OPENAI_MODEL', get('OPENAI_MODEL') || 'gpt-4o-mini'));
  setKey('HEAVY_ENGINE', 'openai');
}
writeFileSync(envPath, lines.join('\n').replace(/\n{3,}/g, '\n\n'));
console.log('✓ .env actualizado (token del tablero: ' + get('ADMIN_TOKEN') + ')');

console.log(`
Siguientes pasos:
  pnpm ingest          # indexa catálogo e información
  pnpm test:scenarios  # verifica la batería del cliente
  pnpm dev             # arranca web + WhatsApp; tablero en /admin
`);
rl.close();
