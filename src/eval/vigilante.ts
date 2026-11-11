// Pruebas del vigilante (sin modelo): pnpm test:vigilante
//
// Esto manda mensajes de verdad al teléfono de alguien, así que lo que se prueba es sobre todo cuándo NO debe
// mandar: un vigilante que molesta se apaga, y apagado no sirve para nada.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'xencrm-vigilante-'));
process.env.DB_PATH = join(dir, 'xencrm.db');

const { avisar, aQuienAvisar, loQueHayQueAvisar, olvidarAvisados } = await import('../crm/vigilante.js');
const { registerSender } = await import('../crm/outbox.js');
const { setSetting } = await import('../crm/settings.js');
const { getDb } = await import('../rag/store.js');
const { touchUser } = await import('../agent/memory.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};

// Un WhatsApp de mentira que anota a dónde se mandó qué.
const mandados: { a: string; texto: string }[] = [];
registerSender('whatsapp', async (userId, text) => {
  mandados.push({ a: userId, texto: text });
});

const db = getDb();
const MIN = 60_000;
// Un martes a media mañana, bien dentro de cualquier horario de atención.
const base = new Date('2026-09-22T16:00:00Z').getTime(); // 11:00 en Bogotá
const escribe = (quien: string, ts: number) =>
  db.prepare("INSERT INTO messages (user_id, role, content, ts, author) VALUES (?, 'user', '¿me ayudan?', ?, 'customer')").run(quien, ts);

touchUser('wa:573001112233@s.whatsapp.net', 'whatsapp', 'Marcela Ríos');
escribe('wa:573001112233@s.whatsapp.net', base);

// --- 🪤 sin decir a quién, no se manda nada ---
check('sin nadie a quién avisar, no hay a quién molestar', aQuienAvisar().length === 0);
check('y no sale ningún mensaje', (await avisar({ acuerdoMin: 15, ahora: base + 40 * MIN })) === 0 && mandados.length === 0, JSON.stringify(mandados));

// --- con alguien configurado ---
setSetting('avisos.whatsapp', ['+57 300 111 2233', '3009998877', 'no-es-un-numero']);
check('los números se limpian y los que no lo son se descartan', aQuienAvisar().length === 2, JSON.stringify(aQuienAvisar()));

// Todavía dentro de lo prometido: no se avisa.
check('dentro de lo acordado, silencio', (await avisar({ acuerdoMin: 60, ahora: base + 40 * MIN })) === 0 && mandados.length === 0);

// Pasado el acuerdo: sale el aviso.
const salieron = await avisar({ acuerdoMin: 15, ahora: base + 40 * MIN });
check('pasado lo acordado, avisa', salieron === 1, String(salieron));
check('a todos los números configurados', mandados.length === 2, JSON.stringify(mandados.map((m) => m.a)));
check('con el nombre, los minutos y lo prometido', /Marcela Ríos/.test(mandados[0]!.texto) && /40 min/.test(mandados[0]!.texto) && /15 min/.test(mandados[0]!.texto), mandados[0]?.texto ?? '');

// --- 🪤 no repetir ---
mandados.length = 0;
const otraVez = await avisar({ acuerdoMin: 15, ahora: base + 41 * MIN });
check('🪤 no vuelve a avisar de lo mismo cada minuto', otraVez === 0 && mandados.length === 0, JSON.stringify(mandados));

// --- cuando por fin le contestan, la marca se suelta ---
db.prepare("INSERT INTO messages (user_id, role, content, ts, author, by) VALUES (?, 'assistant', 'perdón la demora', ?, 'human', 'Camila')").run('wa:573001112233@s.whatsapp.net', base + 45 * MIN);
check('ya no hay nada que avisar', loQueHayQueAvisar({ acuerdoMin: 15, ahora: base + 50 * MIN }).length === 0);

// Y si vuelve a quedarse esperando, se avisa otra vez: la marca se soltó al responderle.
escribe('wa:573001112233@s.whatsapp.net', base + 60 * MIN);
mandados.length = 0;
const deNuevo = await avisar({ acuerdoMin: 15, ahora: base + 100 * MIN });
check('si vuelve a esperar de más, se avisa de nuevo', deNuevo === 1, String(deNuevo));

// --- 🪤 el freno de último recurso ---
olvidarAvisados();
mandados.length = 0;
for (let i = 0; i < 20; i++) {
  const id = `wa:5730011122${String(i).padStart(2, '0')}@s.whatsapp.net`;
  touchUser(id, 'whatsapp', `Cliente ${i}`);
  escribe(id, base);
}
const muchos = await avisar({ acuerdoMin: 15, ahora: base + 40 * MIN });
check('🪤 con veinte esperando, no manda veinte avisos seguidos', muchos <= 12, `mandó ${muchos}`);

console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
