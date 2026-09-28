// Pruebas de llevarse lo aprendido (sin modelo): pnpm test:aprendizaje
//
// Esto mueve entre servidores conversaciones reales de clientes finales, así que lo que se prueba de verdad es
// que se pueda llevar **sin** ellas, y que lo de un negocio no acabe dentro de otro sin que nadie lo decida.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'aiva-aprendizaje-'));
process.env.DB_PATH = join(dir, 'aiva.db');

const { exportarAprendizaje, restaurarAprendizaje, revisarAprendizaje, VERSION_APRENDIZAJE } = await import('../crm/aprendizaje.js');
const { guardarImportados, decidirTema, resumenImportado } = await import('../crm/historial.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};

const T = new Date('2026-09-20T15:00:00Z').getTime();
guardarImportados(
  [
    { chat: 'Marcela', autor: 'Marcela', role: 'user', content: '¿tienen esmoquin para grado?', ts: T },
    { chat: 'Marcela', autor: 'Camila', role: 'assistant', content: 'Claro que sí, con gusto. ¿Para qué talla?', ts: T + 60_000 },
    { chat: 'Jorge', autor: 'Jorge', role: 'user', content: '¿hacen arreglos el mismo día?', ts: T + 120_000 },
  ],
  'exportado',
);
decidirTema('esmoquin grado', 'aceptado', '¿Tienen esmoquin para grado?');

// --- llevarse todo ---
const todo = exportarAprendizaje({ slug: 'boutique', negocio: 'Boutique de prueba', hoy: new Date('2026-09-28T10:00:00Z') });
check('se lleva las conversaciones', todo.conConversaciones && todo.conversaciones.length === 3, JSON.stringify(todo.conversaciones.length));
check('y lo que alguien ya decidió', todo.temas.length === 1 && todo.temas[0]!.estado === 'aceptado', JSON.stringify(todo.temas));
check('dice de qué cliente salió y cuándo', todo.slug === 'boutique' && todo.fecha.startsWith('2026-09-28') && todo.version === VERSION_APRENDIZAJE);

// --- 🪤 llevarse solo lo aprendido, sin las charlas de nadie ---
const soloLoDecidido = exportarAprendizaje({ slug: 'boutique', negocio: 'Boutique de prueba', conConversaciones: false });
check('🪤 se puede llevar sin las conversaciones', soloLoDecidido.conversaciones.length === 0 && soloLoDecidido.conConversaciones === false);
check('y aun así lleva las decisiones', soloLoDecidido.temas.length === 1);
check('🪤 en ese archivo no va el nombre de ningún cliente final', !JSON.stringify(soloLoDecidido).includes('Marcela') && !JSON.stringify(soloLoDecidido).includes('Jorge'),
  JSON.stringify(soloLoDecidido).slice(0, 200));

// --- restaurar en una instancia nueva ---
// Se vacía lo aprendido para imitar un servidor recién montado: cambiar la ruta de la base no sirve, porque a
// estas alturas ya está abierta.
const { getDb } = await import('../rag/store.js');
getDb().exec('DELETE FROM import_messages; DELETE FROM import_temas;');
check('la instancia nueva empieza sin nada aprendido', resumenImportado().mensajes === 0);

const revisado = revisarAprendizaje(todo, 'boutique');
check('un archivo bueno pasa', !('error' in revisado) && revisado.conversaciones === 3 && revisado.temas === 1, JSON.stringify(revisado));
check('uno que no lo es, no', 'error' in revisarAprendizaje({ hola: 1 }, 'boutique'));
check('uno de otra versión, tampoco', 'error' in revisarAprendizaje({ ...todo, version: 99 }, 'boutique'));

// 🪤 Lo de un negocio no entra en otro sin que alguien lo decida.
const deOtro = revisarAprendizaje(todo, 'financiera');
check('🪤 el de otro cliente se avisa antes de meter nada', !('error' in deOtro) && deOtro.otroCliente === true);
check('y el del mismo pasa derecho', !('error' in revisado) && revisado.otroCliente === false);

// --- sumar, no reemplazar ---
const hecho = restaurarAprendizaje(todo);
check('mete lo que traía', hecho.conversaciones === 3 && hecho.temas === 1, JSON.stringify(hecho));
check('y queda en el historial de la instancia nueva', resumenImportado().mensajes === 3, String(resumenImportado().mensajes));
const otraVez = restaurarAprendizaje(todo);
check('🪤 restaurar dos veces no duplica nada', otraVez.conversaciones === 0 && resumenImportado().mensajes === 3, JSON.stringify(otraVez));
// Lo que más cuesta de recuperar no son las conversaciones, es el trabajo de quien ya miró tema por tema.
const decididos = getDb().prepare("SELECT clave, estado FROM import_temas").all() as { clave: string; estado: string }[];
check('y las decisiones viajaron con él', decididos.length === 1 && decididos[0]!.estado === 'aceptado', JSON.stringify(decididos));

console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
