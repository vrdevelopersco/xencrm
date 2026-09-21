// Pruebas de la marca del cliente (sin modelo): pnpm test:brand
// Con cualquier color, el texto encima se lee (4.5:1) y el color como borde o foco se distingue (3:1), en claro y oscuro.
import { accentOn, contrast, onBrand } from '../brand.js';

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
let seed = 7;
const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const colors = ['#C5A47E', '#2f7d4f', '#ffd400', '#777777', '#ffffff', '#000000', '#0A0A0A', '#e11d48', ...Array.from({ length: 500 }, () => hex(Math.floor(rand() * 0xffffff)))];
const bad: string[] = [];
for (const c of colors) {
  const b = onBrand(c);
  const dark = onBrand(accentOn(c, '#171a21', 3));
  if (contrast(b.bg, b.text) < 4.5) bad.push(`${c} botón claro ${contrast(b.bg, b.text).toFixed(2)}`);
  if (contrast(dark.bg, dark.text) < 4.5) bad.push(`${c} botón oscuro ${contrast(dark.bg, dark.text).toFixed(2)}`);
  if (contrast(accentOn(c, '#ffffff'), '#ffffff') < 4.5) bad.push(`${c} texto sobre blanco`);
  if (contrast(accentOn(c, '#ffffff', 3), '#ffffff') < 3) bad.push(`${c} borde sobre blanco`);
  if (contrast(accentOn(c, '#171a21', 3), '#171a21') < 3) bad.push(`${c} borde sobre oscuro`);
}
check(`${colors.length} colores: el texto encima siempre se lee y el color como borde se distingue`, bad.length === 0, bad.slice(0, 5).join(' · '));
check('un color que ya se lee no se toca (#2f7d4f con blanco)', onBrand('#2f7d4f').bg === '#2f7d4f' && onBrand('#2f7d4f').text === '#ffffff');
check('el dorado de DUNOR lleva texto oscuro', onBrand('#C5A47E').text === '#111827' && onBrand('#C5A47E').bg === '#C5A47E');
console.log(`\n${fail ? `${fail} fallos` : 'todo ok'}`);
process.exit(fail ? 1 : 0);
