// Datos de demostración desde la terminal. La lógica vive en crm/demo.ts, porque en un servidor no hay terminal
// y cargar y quitar tiene que poder hacerse también desde la consola.
//
//   pnpm seed          carga el archivo `seedFile` de aiva.config.json
//   pnpm seed --clear  borra solo los contactos sembrados (ids wa:seed-…)
import { archivoDemo, cargar, cuantas, quitar } from './crm/demo.js';

if (process.argv.includes('--clear')) {
  console.log(`✓ ${quitar()} contactos de demostración borrados`);
  process.exit(0);
}

const archivo = archivoDemo();
if (!archivo) {
  console.error('Este cliente no tiene datos de demostración: define "seedFile" en aiva.config.json.');
  process.exit(1);
}

const cuenta = cargar({ archivo });
console.log(`✓ ${cuenta} contactos de demostración cargados desde ${archivo} (${cuantas()} en la base). Quitar: pnpm seed --clear`);
