// Pruebas de el ejemplo de XENCRM (XENTRIS LLC), sin modelo: pnpm test:ejemplo
// (La llena su agente.)
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};
check('existe', true);
process.exit(fail ? 1 : 0);
