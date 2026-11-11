// Lo de Servicio que no es de una ficha (mantenimientos programados y actualizaciones), para la demostración.
// Se lee de `servicio.json`, en la misma carpeta que la semilla; formato en docs/xencrm.md › «Servicio». Si el
// cliente no lo tiene, no se siembra nada: un negocio sin mantenimientos no tiene por qué fingir que los tiene.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { quitarDemo, sembrarDemo, type ServicioDemo } from './mantenimientos.js';

export function sembrarServicio(archivoSemilla: string, now: number): void {
  const archivo = join(dirname(archivoSemilla), 'servicio.json');
  if (!existsSync(archivo)) return;
  let datos: ServicioDemo;
  try {
    datos = JSON.parse(readFileSync(archivo, 'utf8')) as ServicioDemo;
  } catch (err) {
    console.error(`[servicio] ${archivo} no es JSON válido: ${(err as Error).message}`);
    return;
  }
  sembrarDemo(datos, now);
}

export function quitarServicioDemo(): void {
  quitarDemo();
}
