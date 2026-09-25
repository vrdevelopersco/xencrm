// Pruebas de los datos de demostración (sin modelo): pnpm test:demo
// Lo único que importa de verdad: que se puedan **quitar sin tocar lo de verdad**. Esto mete fichas falsas en la
// base de un cliente real, y un demo que deja basura dentro es peor que no hacer el demo.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'aiva-demo-'));
process.env.DB_PATH = join(dir, 'aiva.db');

const { cargar, quitar, cuantas, PREFIJO } = await import('../crm/demo.js');
const { getDb } = await import('../rag/store.js');
const { touchUser } = await import('../agent/memory.js');
const { listContacts } = await import('../crm/contacts.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};

const db = getDb();
const archivo = join(dir, 'seed.json');
writeFileSync(
  archivo,
  JSON.stringify([
    {
      id: '573001112233',
      name: 'Marcela de prueba',
      stage: 'interesado',
      sentiment: 'positivo',
      lastMinutesAgo: 30,
      unread: 2,
      summary: 'Busca vestido para grado.',
      data: { ciudad: 'Barranquilla' },
      signals: { interes: 8, quiere_cita: true },
      appointmentInHours: 26,
      messages: [
        { role: 'user', text: 'Hola, ¿tienen para grado?' },
        { role: 'assistant', text: 'Claro que sí, con gusto.' },
      ],
    },
    {
      id: '573004445566',
      name: 'Jorge de prueba',
      stage: 'nuevo',
      sentiment: null,
      lastMinutesAgo: 120,
      unread: 0,
      summary: null,
      data: {},
      signals: null,
      messages: [{ role: 'user', text: '¿A qué horas abren?' }],
    },
  ]),
);

// Una conversación DE VERDAD, que es la que no se puede tocar.
touchUser('web:cliente-de-verdad', 'web', 'Cliente real');
db.prepare("INSERT INTO messages (user_id, role, content, ts) VALUES (?, 'user', 'una pregunta real', ?)").run('web:cliente-de-verdad', Date.now());
const realesAntes = listContacts({ limit: 100 }).length;

check('al principio no hay ninguna de demostración', cuantas() === 0);

const cargadas = cargar({ archivo });
check('carga las del archivo', cargadas === 2 && cuantas() === 2, `cargadas ${cargadas}, hay ${cuantas()}`);
check('todas llevan el prefijo que las delata', listContacts({ limit: 100 }).filter((c) => c.id.startsWith(PREFIJO)).length === 2);
check('trae la ficha completa: etapa, puntaje y resumen', (() => {
  const m = listContacts({ limit: 100 }).find((c) => c.name === 'Marcela de prueba');
  return Boolean(m) && m!.stage === 'interesado' && m!.score > 0 && Boolean(m!.summary);
})(), JSON.stringify(listContacts({ limit: 100 }).find((c) => c.name === 'Marcela de prueba')));
check('y su cita', (db.prepare('SELECT COUNT(*) n FROM appointments').get() as { n: number }).n === 1);
check('con sus mensajes', (db.prepare('SELECT COUNT(*) n FROM messages WHERE user_id LIKE ?').get(`${PREFIJO}%`) as { n: number }).n === 3);

// Cargar dos veces no duplica: vuelve a empezar.
cargar({ archivo });
check('cargar dos veces no deja el tablero repetido', cuantas() === 2, String(cuantas()));

// 🪤 Lo que de verdad importa.
const quitadas = quitar();
check('quitar se lleva todas las de demostración', quitadas === 2 && cuantas() === 0, `quitadas ${quitadas}`);
check('y no toca la conversación real', listContacts({ limit: 100 }).length === realesAntes && Boolean(listContacts({ limit: 100 }).find((c) => c.id === 'web:cliente-de-verdad')));
check('tampoco sus mensajes', (db.prepare("SELECT COUNT(*) n FROM messages WHERE user_id = 'web:cliente-de-verdad'").get() as { n: number }).n === 1);
check('ni deja mensajes sueltos de las falsas', (db.prepare('SELECT COUNT(*) n FROM messages WHERE user_id LIKE ?').get(`${PREFIJO}%`) as { n: number }).n === 0);
check('ni citas huérfanas', (db.prepare('SELECT COUNT(*) n FROM appointments').get() as { n: number }).n === 0);
check('quitar cuando no hay nada no revienta', quitar() === 0);

console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
