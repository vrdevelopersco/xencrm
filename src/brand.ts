// La marca de cada cliente (color y logo) en lo que ve su gente. El color viene de su configuración y puede ser
// cualquiera: aquí se calcula con qué texto se lee encima y, si ninguno alcanza 4.5:1, se oscurece o aclara lo justo.
import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { business } from './config.js';

type RGB = [number, number, number];
const parse = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;
const toHex = (c: RGB) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const lum = (c: RGB) => {
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as RGB;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** Contraste WCAG entre dos colores hex. */
export function contrast(a: string, b: string): number {
  const [x, y] = [lum(parse(a)), lum(parse(b))].sort((m, n) => n - m) as [number, number];
  return (x + 0.05) / (y + 0.05);
}
const mix = (a: string, b: string, t: number) => {
  const [x, y] = [parse(a), parse(b)];
  return toHex(x.map((v, i) => v + (y[i]! - v) * t) as RGB);
};
const DARK = '#111827';
const LIGHT = '#ffffff';

/** Fondo de marca y el texto que va encima (blanco u oscuro), con 4.5:1 como mínimo. */
export function onBrand(color: string): { bg: string; text: string } {
  const text = contrast(color, LIGHT) >= contrast(color, DARK) ? LIGHT : DARK;
  let bg = color;
  // Si ni blanco ni oscuro alcanzan, el fondo se aleja del texto de a poco (oscurece bajo blanco, aclara bajo oscuro).
  for (let t = 0.05; contrast(bg, text) < 4.5 && t <= 1; t += 0.05) bg = mix(color, text === LIGHT ? '#000000' : LIGHT, t);
  return { bg, text };
}

/** El color de marca como texto o borde sobre un fondo dado (4.5 para texto, 3 para bordes y foco). */
export function accentOn(color: string, bg: string, min = 4.5): string {
  const toward = lum(parse(bg)) > 0.5 ? '#000000' : LIGHT;
  let c = color;
  for (let t = 0.05; contrast(c, bg) < min && t <= 1; t += 0.05) c = mix(color, toward, t);
  return c;
}

const LOGO_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

/** El logo como archivo local (para servirlo) o null si es una URL o no hay. */
export function localLogo(): { path: string; type: string } | null {
  const logo = business.brand.logo;
  if (!logo || /^https?:\/\//.test(logo)) return null;
  const path = resolve(logo);
  const type = LOGO_TYPES[extname(path).toLowerCase()];
  return type && existsSync(path) ? { path, type } : null;
}

/** Dirección del logo para una página servida por aiva (`base` = origen de aiva, para páginas de otros sitios). */
export function logoUrl(base = ''): string | null {
  const logo = business.brand.logo;
  if (!logo) return null;
  if (/^https:\/\//.test(logo)) return logo;
  return localLogo() ? `${base}/brand/logo` : null;
}

export function readLogo(): { body: Buffer; type: string } | null {
  const l = localLogo();
  return l ? { body: readFileSync(l.path), type: l.type } : null;
}
