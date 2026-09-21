import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { convert } from 'html-to-text';
import { business } from '../config.js';
import { embed } from '../llm/ollama.js';
import { countDocs, replaceDocs, type Doc } from './store.js';
import { profileDocs } from './profile-index.js';

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  currency?: string;
  category?: string;
  tags?: string[];
  url: string;
  inStock?: boolean;
  image?: string;
  /** Ficha técnica: pares clave/valor (medidas, material, luz, riego...). Se muestra cuando el cliente pide detalles. */
  specs?: Record<string, string | number | boolean>;
  [extra: string]: unknown;
}

// ---------- Productos ----------

export function loadProductsFile(path: string): Product[] {
  if (!existsSync(path)) {
    console.warn(`[ingest] no existe ${path}, se omite el catálogo`);
    return [];
  }
  const raw = readFileSync(path, 'utf8');
  if (extname(path).toLowerCase() === '.csv') return parseCsv(raw);
  const data = JSON.parse(raw) as Product[] | { products: Product[] };
  return Array.isArray(data) ? data : data.products;
}

function parseCsv(raw: string): Product[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!;
    if (inQuotes) {
      if (c === '"' && raw[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') inQuotes = false;
      else cell += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && raw[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [header, ...body] = rows;
  if (!header) return [];
  const idx = (k: string) => header.findIndex((h) => h.trim().toLowerCase() === k);
  return body
    .filter((r) => r.some((c) => c.trim()))
    .map((r, n) => {
      const get = (k: string) => (idx(k) >= 0 ? (r[idx(k)] ?? '').trim() : '');
      return {
        id: get('id') || String(n + 1),
        name: get('name') || get('nombre'),
        description: get('description') || get('descripcion'),
        price: Number(get('price') || get('precio') || 0),
        currency: get('currency') || undefined,
        category: get('category') || get('categoria') || undefined,
        tags: (get('tags') || get('etiquetas'))
          .split(/[;|]/)
          .map((t) => t.trim())
          .filter(Boolean),
        url: get('url') || get('link'),
        inStock: !/^(0|false|no)$/i.test(get('in_stock') || get('stock') || 'true'),
        image: get('image') || undefined,
      };
    });
}

/** Importa productos públicos de una tienda Shopify (/products.json). */
export async function fetchShopify(storeUrl: string): Promise<Product[]> {
  const base = storeUrl.replace(/\/$/, '');
  const out: Product[] = [];
  for (let page = 1; page <= 20; page++) {
    const res = await fetch(`${base}/products.json?limit=250&page=${page}`, { headers: { 'user-agent': 'aiva-ingest/0.1' } });
    if (!res.ok) throw new Error(`Shopify ${res.status} en ${base}/products.json`);
    const { products } = (await res.json()) as { products: Record<string, any>[] };
    if (!products?.length) break;
    for (const p of products) {
      const variant = p.variants?.[0] ?? {};
      out.push({
        id: String(p.id),
        name: p.title,
        description: convert(p.body_html ?? '', { wordwrap: false }).trim(),
        price: Number(variant.price ?? 0),
        category: p.product_type || undefined,
        tags: Array.isArray(p.tags) ? p.tags : String(p.tags ?? '').split(',').map((t: string) => t.trim()).filter(Boolean),
        url: `${base}/products/${p.handle}`,
        inStock: p.variants?.some((v: any) => v.available !== false) ?? true,
        image: p.images?.[0]?.src,
        variants: p.variants?.map((v: any) => ({ title: v.title, price: v.price, available: v.available })),
      });
    }
    if (products.length < 250) break;
  }
  return out;
}

export function productToDoc(p: Product): Doc {
  const currency = p.currency ?? business.business.currency;
  const variants = Array.isArray(p.variants)
    ? (p.variants as { title: string; price: string | number }[]).map((v) => `${v.title}: ${v.price}`).join(', ')
    : '';
  const specs = p.specs && Object.keys(p.specs).length ? Object.entries(p.specs).map(([k, v]) => `${k}: ${v}`).join('; ') : '';
  const content = [
    p.name,
    p.category ? `Categoría: ${p.category}` : '',
    p.description,
    specs ? `Ficha técnica: ${specs}` : '',
    p.tags?.length ? `Etiquetas: ${p.tags.join(', ')}` : '',
    `Precio: ${p.price} ${currency}`,
    variants ? `Variantes: ${variants}` : '',
    p.inStock === false ? 'Estado: agotado' : 'Estado: disponible',
  ]
    .filter(Boolean)
    .join('\n');
  return {
    id: `product:${p.id}`,
    kind: 'product',
    title: p.name,
    content,
    url: p.url,
    meta: {
      source: 'catalog',
      price: p.price,
      currency,
      category: p.category ?? null,
      tags: p.tags ?? [],
      inStock: p.inStock ?? true,
      image: p.image ?? null,
      description: p.description,
      specs: p.specs ?? null,
      variants: p.variants ?? null,
    },
  };
}

// ---------- Conocimiento (markdown) ----------

export function chunkText(text: string, opts: { size?: number; title: string; url?: string | null }): { title: string; content: string }[] {
  const size = opts.size ?? 700;
  const sections: { heading: string; body: string }[] = [];
  let current = { heading: '', body: '' };
  for (const line of text.split('\n')) {
    const m = /^#{1,3}\s+(.+)$/.exec(line);
    if (m) {
      if (current.body.trim()) sections.push(current);
      current = { heading: m[1]!.trim(), body: '' };
    } else current.body += line + '\n';
  }
  if (current.body.trim()) sections.push(current);

  const chunks: { title: string; content: string }[] = [];
  for (const sec of sections) {
    const title = sec.heading ? `${opts.title} › ${sec.heading}` : opts.title;
    const paras = sec.body
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    let buf = '';
    let lastPara = '';
    for (const p of paras) {
      if (buf && buf.length + p.length > size) {
        chunks.push({ title, content: buf.trim() });
        buf = lastPara.length < size / 3 ? lastPara + '\n\n' : ''; // solapamiento ligero
      }
      buf += p + '\n\n';
      lastPara = p;
    }
    if (buf.trim()) chunks.push({ title, content: buf.trim() });
  }
  return chunks;
}

export function loadKnowledgeDir(dir: string): Doc[] {
  if (!existsSync(dir)) {
    console.warn(`[ingest] no existe ${dir}, se omite la base de conocimiento`);
    return [];
  }
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(md|txt)$/i.test(f)) files.push(p);
    }
  };
  walk(dir);

  const docs: Doc[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const rel = relative(dir, file);
    const h1 = /^#\s+(.+)$/m.exec(text)?.[1]?.trim();
    const urlMatch = /^url:\s*(\S+)/m.exec(text)?.[1] ?? null; // opcional: línea "url: https://..." en el archivo
    const title = h1 ?? basename(file, extname(file)).replace(/[-_]/g, ' ');
    chunkText(text.replace(/^url:.*$/m, ''), { title }).forEach((c, i) =>
      docs.push({
        id: `kb:${rel}#${i}`,
        kind: 'knowledge',
        title: c.title,
        content: c.content,
        url: urlMatch,
        meta: { source: 'knowledge', file: rel },
      }),
    );
  }
  return docs;
}

// ---------- Sitio web (crawler simple de URLs explícitas) ----------

export async function crawlPages(urls: string[]): Promise<Doc[]> {
  const docs: Doc[] = [];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; aiva-ingest/0.1)' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() || url;
      const text = convert(html, {
        wordwrap: false,
        selectors: [
          { selector: 'a', options: { ignoreHref: true } },
          { selector: 'img', format: 'skip' },
          { selector: 'nav', format: 'skip' },
          { selector: 'header', format: 'skip' },
          { selector: 'footer', format: 'skip' },
          { selector: 'script', format: 'skip' },
          { selector: 'style', format: 'skip' },
          { selector: 'h1', format: 'heading', options: { uppercase: false } },
          { selector: 'h2', format: 'heading', options: { uppercase: false } },
          { selector: 'h3', format: 'heading', options: { uppercase: false } },
        ],
      })
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      const hash = createHash('sha1').update(url).digest('hex').slice(0, 10);
      chunkText(text, { title }).forEach((c, i) =>
        docs.push({
          id: `site:${hash}#${i}`,
          kind: 'knowledge',
          title: c.title,
          content: c.content,
          url,
          meta: { source: 'site', url },
        }),
      );
      console.log(`[ingest] ${url} -> ${text.length} chars`);
    } catch (err) {
      console.warn(`[ingest] no pude leer ${url}: ${(err as Error).message}`);
    }
  }
  return docs;
}

// ---------- Embeddings + escritura ----------

async function embedDocs(docs: Doc[]): Promise<(Doc & { embedding: number[] })[]> {
  const out: (Doc & { embedding: number[] })[] = [];
  const BATCH = 16;
  for (let i = 0; i < docs.length; i += BATCH) {
    const batch = docs.slice(i, i + BATCH);
    const vectors = await embed(batch.map((d) => `${d.title}\n${d.content}`));
    batch.forEach((d, j) => out.push({ ...d, embedding: vectors[j]! }));
    process.stdout.write(`\r[ingest] embeddings ${Math.min(i + BATCH, docs.length)}/${docs.length}`);
  }
  if (docs.length) process.stdout.write('\n');
  return out;
}

export async function runIngest(opts: { only?: 'products' | 'knowledge' | 'site'; shopify?: string } = {}) {
  const src = business.sources;
  const t0 = Date.now();

  if (!opts.only || opts.only === 'products') {
    const shopify = opts.shopify ?? src.shopifyUrl;
    const products = shopify ? await fetchShopify(shopify) : loadProductsFile(src.productsFile);
    console.log(`[ingest] ${products.length} productos (${shopify ? 'shopify' : src.productsFile})`);
    replaceDocs('product', await embedDocs(products.map(productToDoc)));
  }
  if (!opts.only || opts.only === 'knowledge') {
    const kb = loadKnowledgeDir(src.knowledgeDir);
    console.log(`[ingest] ${kb.length} fragmentos de conocimiento (${src.knowledgeDir})`);
    replaceDocs('knowledge', await embedDocs(kb), 'knowledge');
    const profile = profileDocs(); // el perfil del tablero (Configuración › Perfil)
    replaceDocs('knowledge', await embedDocs(profile), 'profile');
    console.log(`[ingest] perfil del negocio: ${profile.length ? 'indexado' : 'vacío'}`);
  }
  if (!opts.only || opts.only === 'site') {
    if (src.sitePages.length) {
      const site = await crawlPages(src.sitePages);
      console.log(`[ingest] ${site.length} fragmentos del sitio (${src.sitePages.length} páginas)`);
      replaceDocs('knowledge', await embedDocs(site), 'site');
    } else if (opts.only === 'site') {
      console.log('[ingest] sources.sitePages está vacío en aiva.config.json');
    }
  }
  console.log(`[ingest] listo en ${((Date.now() - t0) / 1000).toFixed(1)}s ->`, countDocs());
}

// Ejecución directa: pnpm ingest [--only=products|knowledge|site] [--shopify=https://tienda.myshopify.com]
if (process.argv[1] && /ingest\.(ts|js)$/.test(process.argv[1])) {
  const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
  runIngest({ only: arg('only') as 'products' | 'knowledge' | 'site' | undefined, shopify: arg('shopify') }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
