// Pruebas de los mantenimientos y las actualizaciones, sin modelo: pnpm test:mantenimientos
// (La llena su agente.)
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};
check('existe', true);
process.exit(fail ? 1 : 0);
