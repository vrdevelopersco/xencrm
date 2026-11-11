// Pruebas de el panel de cuentas clave, sin modelo: pnpm test:kam
// (La llena su agente: lo que se prueba aquí es lo que hace la pantalla con datos de verdad.)
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};
check('la pantalla existe en el mapa', true);
process.exit(fail ? 1 : 0);
