// Pruebas de los tiempos de respuesta (sin modelo): pnpm test:tiempos
//
// Lo que se prueba de verdad es que el número no mienta, porque con este se va a juzgar a gente: si dice que el
// equipo tarda cuatro horas cuando en realidad el mensaje entró un sábado de noche, el número deja de mirarse y
// el acuerdo de servicio se vuelve papel.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'aiva-tiempos-'));
process.env.DB_PATH = join(dir, 'aiva.db');

const { esperas, msHabiles, resumenTiempos } = await import('../crm/tiempos.js');
const { getDb } = await import('../rag/store.js');
const { touchUser } = await import('../agent/memory.js');
const { business } = await import('../config.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};

const db = getDb();
const MIN = 60_000;
const escribe = (quien: string, ts: number, texto = 'hola') =>
  db.prepare("INSERT INTO messages (user_id, role, content, ts, author) VALUES (?, 'user', ?, ?, 'customer')").run(quien, texto, ts);
const contesta = (quien: string, ts: number, autor: 'bot' | 'human', por: string | null = null) =>
  db.prepare("INSERT INTO messages (user_id, role, content, ts, author, by) VALUES (?, 'assistant', 'listo', ?, ?, ?)").run(quien, ts, autor, por);

// El horario con el que se mide sale de la configuración del negocio.
const horario = { dias: business.appointments.days, franjas: business.appointments.hours };
console.log(`  (horario del negocio: días ${horario.dias.join(',')} · ${horario.franjas.map((f) => f.join('-')).join(' y ')})`);

// --- una espera simple ---
// Un martes a media mañana: dentro del horario, sin vueltas.
const martes10 = new Date('2026-09-22T15:00:00Z').getTime(); // 10:00 en Bogotá
touchUser('wa:uno', 'whatsapp', 'Cliente uno');
escribe('wa:uno', martes10);
contesta('wa:uno', martes10 + 8 * MIN, 'human', 'Marcela');

const e1 = esperas({ desde: martes10 - MIN, ahora: martes10 + 60 * MIN });
check('una pregunta y su respuesta son una espera', e1.length === 1, JSON.stringify(e1));
check('con el tiempo que se tardó', e1[0]!.ms === 8 * MIN, String(e1[0]?.ms));
check('y sabe quién contestó', e1[0]!.quien === 'persona' && e1[0]!.por === 'Marcela', JSON.stringify(e1[0]));

// --- varios mensajes seguidos son UNA espera ---
touchUser('wa:dos', 'whatsapp', 'Cliente dos');
escribe('wa:dos', martes10, 'hola');
escribe('wa:dos', martes10 + MIN, 'están?');
escribe('wa:dos', martes10 + 2 * MIN, '???');
contesta('wa:dos', martes10 + 15 * MIN, 'bot');
const e2 = esperas({ desde: martes10 - MIN, userId: 'wa:dos', ahora: martes10 + 60 * MIN });
check('🪤 cinco mensajes seguidos no son cinco esperas', e2.length === 1, JSON.stringify(e2.map((x) => x.ms)));
check('se cuenta desde el primero sin responder', e2[0]!.ms === 15 * MIN, String(e2[0]?.ms));
check('y queda dicho cuántas veces insistió', e2[0]!.mensajes === 3, String(e2[0]?.mensajes));
check('contestó Aiva', e2[0]!.quien === 'aiva' && e2[0]!.por === null);

// --- 🪤 el reloj se para fuera del horario ---
// Con un horario FIJO y no el del cliente de turno: si mañana alguien cambia su horario en el tablero, esta
// prueba no puede empezar a fallar por eso. Lunes a viernes, de 9 a 13 y de 14 a 18.
const deOficina = { dias: [1, 2, 3, 4, 5], franjas: [[9 * 60, 13 * 60], [14 * 60, 18 * 60]] as [number, number][] };
const sabadoNoche = new Date('2026-09-27T03:00:00Z').getTime(); // sábado 26, 22:00 en Bogotá
const lunesTemprano = new Date('2026-09-28T14:10:00Z').getTime(); // lunes 28, 09:10 en Bogotá
const corrido = lunesTemprano - sabadoNoche;
const habil = msHabiles(sabadoNoche, lunesTemprano, deOficina);
check('🪤 el fin de semana no cuenta como tiempo de espera', habil < corrido / 10, `corrido ${Math.round(corrido / MIN)} min, hábil ${Math.round(habil / MIN)} min`);
check('y lo que cuenta son los diez minutos desde que abrieron', Math.round(habil / MIN) === 10, `${Math.round(habil / MIN)} min`);

// Dentro de un mismo día laboral, hábil y corrido coinciden.
check('en horario, el tiempo hábil es el tiempo real', msHabiles(martes10, martes10 + 20 * MIN, deOficina) === 20 * MIN, String(msHabiles(martes10, martes10 + 20 * MIN, deOficina) / MIN));

// La pausa del mediodía tampoco cuenta: 12:50→13:00 y 14:00→14:10 son veinte minutos, no ochenta.
const martes1250 = new Date('2026-09-22T17:50:00Z').getTime(); // 12:50 en Bogotá
const martes1410 = new Date('2026-09-22T19:10:00Z').getTime(); // 14:10 en Bogotá
check('la pausa del mediodía tampoco cuenta', Math.round(msHabiles(martes1250, martes1410, deOficina) / MIN) === 20, `${Math.round(msHabiles(martes1250, martes1410, deOficina) / MIN)} min`);

// Y con el horario del negocio de verdad se usa el suyo, no el de oficina de nadie.
const cerrado = msHabiles(new Date('2026-09-22T02:00:00Z').getTime(), new Date('2026-09-22T05:00:00Z').getTime()); // 21:00→00:00 en Bogotá
check('fuera del horario del propio negocio, el reloj no corre', cerrado === 0, `${Math.round(cerrado / MIN)} min`);

// --- quien sigue esperando ---
touchUser('wa:tres', 'whatsapp', 'Cliente tres');
escribe('wa:tres', martes10 + 30 * MIN, '¿me ayudan?');
const ahora = martes10 + 90 * MIN;
const e3 = esperas({ desde: martes10 - MIN, userId: 'wa:tres', ahora });
check('quien escribió y nadie contestó sigue contando', e3.length === 1 && e3[0]!.hasta === null, JSON.stringify(e3));
check('y se sabe cuánto lleva', e3[0]!.ms === 60 * MIN, String(e3[0]?.ms));

// --- el resumen ---
const r = resumenTiempos({ desde: martes10 - MIN, acuerdoMin: 10, ahora });
check('cuenta las respondidas', r.respondidas === 2, String(r.respondidas));
check('separa a Aiva de las personas', r.porQuien.aiva.n === 1 && r.porQuien.persona.n === 1, JSON.stringify(r.porQuien));
check('nombra a quien contesta', r.personas.length === 1 && r.personas[0]!.nombre === 'Marcela', JSON.stringify(r.personas));
check('dice quién sigue esperando', r.esperando.length === 1 && r.esperando[0]!.userId === 'wa:tres', JSON.stringify(r.esperando.map((x) => x.userId)));
check('y cuántas pasaron del acuerdo', r.fueraDeAcuerdo === 1, `${r.fueraDeAcuerdo} (la de 15 min con acuerdo de 10)`);
check('la mediana sale de lo respondido', r.medianaMs >= 8 * MIN && r.medianaMs <= 15 * MIN, String(r.medianaMs / MIN));

// 🪤 Lo que el negocio manda sin que nadie pregunte (un recordatorio, un seguimiento) no es una respuesta y no
// puede contar como tiempo de atención: contaría cero y bajaría la media sin que nadie haya atendido a nadie.
touchUser('wa:cuatro', 'whatsapp', 'Cliente cuatro');
contesta('wa:cuatro', martes10, 'bot');
contesta('wa:cuatro', martes10 + MIN, 'human', 'Marcela');
const e4 = esperas({ desde: martes10 - MIN, userId: 'wa:cuatro', ahora });
check('🪤 escribir sin que pregunten no cuenta como respuesta', e4.length === 0, JSON.stringify(e4));

console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
