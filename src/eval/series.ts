// Pruebas de las dos gráficas (sin modelo): pnpm test:series
// Lo que importa: que los días y las horas se cuenten en la zona del negocio —no en la del servidor—, que los
// días sin nada salgan en cero (si no, la gráfica miente sobre la forma) y que comparar con cero no reviente.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'xencrm-series-')), 'xencrm.db');
process.env.TZ = 'Europe/London'; // el servidor en otra zona: es justo lo que no debe notarse
const { nuevasPorDia, actividadPorHora, semanaContraSemana } = await import('../crm/series.js');
const { getDb } = await import('../rag/store.js');
const { business } = await import('../config.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};

const db = getDb();
const DIA = 86400_000;
const ahora = Date.parse('2026-09-25T18:00:00Z'); // 13:00 en Bogotá
const nuevaConversacion = (id: string, canal: string, ts: number) =>
  db.prepare('INSERT INTO users (id, channel, stage, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)').run(id, canal, 'nuevo', ts, ts);
const mensajeDelCliente = (id: string, ts: number) =>
  db.prepare("INSERT INTO messages (user_id, role, content, ts) VALUES (?, 'user', 'hola', ?)").run(id, ts);

check('el negocio está en Bogotá y el servidor no', business.timezone === 'America/Bogota' && process.env.TZ === 'Europe/London');

// --- de dónde llega la gente ---
nuevaConversacion('wa:1', 'whatsapp', ahora - DIA);
nuevaConversacion('wa:2', 'whatsapp', ahora - DIA);
nuevaConversacion('web:1', 'web', ahora - DIA);
nuevaConversacion('wa:3', 'whatsapp', ahora); // hoy
const dias = nuevasPorDia(7, ahora);
check('devuelve un día por cada día pedido, en orden', dias.length === 7 && dias[6]!.dia > dias[0]!.dia, dias.map((d) => d.dia).join(' '));
check('parte por canal', dias[5]!.whatsapp === 2 && dias[5]!.web === 1 && dias[5]!.total === 3, JSON.stringify(dias[5]));
check('los días sin nada salen en cero, no se saltan', dias[0]!.total === 0 && dias[1]!.total === 0);
check('lo de hoy cuenta hoy', dias[6]!.total === 1, JSON.stringify(dias[6]));

// 🪤 Un mensaje de las 11 de la noche en Bogotá son las 4 a. m. del día siguiente en Londres: tiene que caer en
// el día de Bogotá, que es el del negocio.
const eslaNoche = Date.parse('2026-09-24T04:30:00Z'); // 23:30 del 23 en Bogotá
nuevaConversacion('wa:noche', 'whatsapp', eslaNoche);
const conNoche = nuevasPorDia(7, ahora);
check('la noche cuenta en el día del negocio, no en el del servidor', conNoche.find((d) => d.dia === '2026-09-23')!.total === 1,
  conNoche.map((d) => d.dia + ':' + d.total).join(' '));

// --- a qué horas escriben ---
// La hora local de Bogotá es UTC−5, así que la marca en UTC es la hora local + 5 (aunque pase de medianoche).
const enBogota = (dia: string, hora: number) => Date.parse(`${dia}T00:00:00Z`) + (hora + 5) * 3600_000;
for (const h of [14, 14, 15, 20]) mensajeDelCliente('wa:1', enBogota('2026-09-24', h));
const act = actividadPorHora(7, ahora);
check('la rejilla tiene una fila por hora y una columna por día', act.celdas.length === act.horas.length && act.celdas[0]!.length === 7);
check('cuenta los mensajes en la hora local del negocio', act.total === 4 && act.max === 2, 'total ' + act.total + ' max ' + act.max);
const filaDeLas14 = act.celdas[act.horas.indexOf(14)];
check('a las 2 de la tarde hay dos', Boolean(filaDeLas14) && filaDeLas14![act.dias.indexOf('2026-09-24')] === 2, JSON.stringify(act.horas));
check('no pinta la madrugada vacía', act.horas[0]! >= 12 && act.horas[act.horas.length - 1]! <= 21, act.horas.join(','));

// --- esta semana contra la anterior ---
const comp = semanaContraSemana(ahora);
check('compara conversaciones de esta semana con la pasada', comp.conversaciones.ahora === 5 && comp.conversaciones.antes === 0, JSON.stringify(comp.conversaciones));
check('sin semana anterior no inventa un porcentaje', comp.conversaciones.delta === null);
nuevaConversacion('wa:vieja', 'whatsapp', ahora - 10 * DIA);
const comp2 = semanaContraSemana(ahora);
check('con qué comparar, sale el porcentaje', comp2.conversaciones.antes === 1 && comp2.conversaciones.delta === 400, JSON.stringify(comp2.conversaciones));

// Con la base vacía no puede reventar: es lo que ve un cliente el primer día.
db.exec('DELETE FROM users; DELETE FROM messages');
const vacio = nuevasPorDia(7, ahora);
const actVacia = actividadPorHora(7, ahora);
check('con todo vacío devuelve la forma igual, en ceros', vacio.length === 7 && vacio.every((d) => d.total === 0) && actVacia.total === 0 && actVacia.horas.length > 0);

console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
