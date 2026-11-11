// Pruebas de los tickets y el SLA, sin modelo: pnpm test:sla
// (La llena su agente.)
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};
check('existe', true);
process.exit(fail ? 1 : 0);
