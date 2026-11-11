// Pruebas de la historia comercial (sin modelo): pnpm test:historia
// Lo que se enseña en la ficha de una persona: si volvió, si vino a sus citas, si se le fue una venta. Todo se
// deduce de lo guardado, así que lo que se prueba aquí es que las deducciones no mientan — una ficha que dice
// «se le fue una venta» de quien acaba de comprar es peor que no decir nada. Base temporal.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'xencrm-historia-')), 'xencrm.db');
const { touchUser } = await import('../agent/memory.js');
const { bookAppointment, updateAppointment } = await import('../crm/appointments.js');
const { etapaCon, STAGE_DEFS } = await import('../crm/contacts.js');
const { historiaDe, enUnaFrase } = await import('../crm/historia.js');
const { getDb } = await import('../rag/store.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};

const DIA = 86400_000;
const ahora = Date.now();

// Mensajes con la fecha puesta a mano: appendMessage los sella con la hora de ahora y aquí hace falta simular
// semanas de conversación.
let n = 0;
const dijo = (userId: string, ts: number, quien: 'customer' | 'bot' = 'customer') => {
  touchUser(userId, 'whatsapp');
  getDb()
    .prepare('INSERT INTO messages (user_id, role, content, intent, ts, author, by) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(userId, quien === 'customer' ? 'user' : 'assistant', `mensaje ${++n}`, null, ts, quien, null);
};

// ── Quien no ha hecho nada ────────────────────────────────────────────────────
const nadie = historiaDe('wa:nuevo', { ahora });
check('de quien no ha escrito no se inventa nada', nadie.mensajes === 0 && nadie.desde === null && nadie.volvio === 0 && !nadie.amago, JSON.stringify(nadie));
check('y se dice así, no con un hueco', enUnaFrase(nadie) === 'sin historia todavía', enUnaFrase(nadie));

// ── Volver ────────────────────────────────────────────────────────────────────
// 🪤 Una conversación normal respira: se contesta al día siguiente, se deja algo para el lunes. Si esas pausas
// contaran como vueltas, el número diría «volvió 6 veces» de quien nunca se ha ido, y la ficha dejaría de servir
// justo para lo que se puso.
const seguido = 'wa:573001112233';
[12, 11, 9, 6, 2, 0].forEach((d) => dijo(seguido, ahora - d * DIA));
const hs = historiaDe(seguido, { ahora });
check('🪤 las pausas de una conversación normal no son vueltas', hs.volvio === 0, `volvio=${hs.volvio}`);
check('pero sí cuenta los mensajes y desde cuándo', hs.mensajes === 6 && hs.desde === ahora - 12 * DIA && hs.ultima === ahora, JSON.stringify(hs));
check('y lo dice en una frase', enUnaFrase(hs) === 'solo ha escrito', enUnaFrase(hs));

const vuelve = 'wa:573004445566';
[200, 199, 100, 99, 3].forEach((d) => dijo(vuelve, ahora - d * DIA));
const hv = historiaDe(vuelve, { ahora });
check('🪤 un silencio largo y luego escribe: eso sí es volver', hv.volvio === 2, `volvio=${hv.volvio}`);
check('y se cuenta en la frase', enUnaFrase(hv) === 'volvió 2 veces', enUnaFrase(hv));

// Lo que conteste XENCRM no es que el cliente haya vuelto.
const soloBot = 'wa:573007778899';
dijo(soloBot, ahora - 40 * DIA);
dijo(soloBot, ahora - 20 * DIA, 'bot');
dijo(soloBot, ahora - 1 * DIA, 'bot');
check('🪤 los mensajes de XENCRM no cuentan como que el cliente volvió', historiaDe(soloBot, { ahora }).volvio === 0 && historiaDe(soloBot, { ahora }).mensajes === 1, JSON.stringify(historiaDe(soloBot, { ahora })));

// ── Citas ─────────────────────────────────────────────────────────────────────
const conCita = 'wa:573001234567';
dijo(conCita, ahora - 30 * DIA);
const vino = bookAppointment(conCita, new Date(ahora - 20 * DIA));
const falto = bookAppointment(conCita, new Date(ahora - 10 * DIA));
updateAppointment(vino.id, { status: 'completada' });
updateAppointment(falto.id, { status: 'no_asistio' });
const hc = historiaDe(conCita, { ahora });
check('las citas se cuentan por lo que pasó en cada una', hc.citas.total === 2 && hc.citas.cumplidas === 1 && hc.citas.falto === 1 && hc.citas.proxima === null, JSON.stringify(hc.citas));
check('la frase lo dice sin que haya que leer números', enUnaFrase(hc) === 'vino a una cita · faltó a una cita', enUnaFrase(hc));

// ── El amago: lo que se enseña en rojo ────────────────────────────────────────
check('🪤 vino, no quedó nada por venir y no compró: se le fue', hc.amago, 'tendría que estar marcado');

// 🪤 La prueba que justifica el campo `etapa`: por fuera, quien compró se ve igual que quien se fue —cita
// cumplida y ninguna por venir—. Sin mirar la etapa, el mejor cliente sale con el letrero de venta perdida.
const ganada = etapaCon('ganado');
check('🪤 pero si ya compró, NO se le fue nada', ganada ? !historiaDe(conCita, { ahora, etapa: ganada }).amago : true, `etapa ganada: ${ganada}`);

// Y con una cita por delante tampoco: todavía no ha pasado nada.
const proxima = bookAppointment(conCita, new Date(ahora + 3 * DIA));
const hp = historiaDe(conCita, { ahora });
check('🪤 con cita por delante no se le ha ido nada todavía', !hp.amago && hp.citas.proxima === proxima.startsAt, JSON.stringify(hp.citas));
check('y la frase lo dice', enUnaFrase(hp).endsWith('tiene cita'), enUnaFrase(hp));

// Quien nunca tuvo cita no amagó: no llegó a haber interés que perder.
check('quien nunca tuvo cita no amagó', !historiaDe(seguido, { ahora }).amago);

// Una cita cancelada también deja el rastro: hubo intención y se cayó.
const cancelo = 'wa:573009990000';
dijo(cancelo, ahora - 15 * DIA);
updateAppointment(bookAppointment(cancelo, new Date(ahora - 5 * DIA)).id, { status: 'cancelada' });
const hx = historiaDe(cancelo, { ahora });
check('una cancelación también es un amago', hx.amago && hx.citas.canceladas === 1, JSON.stringify(hx.citas));
check('y se dice', enUnaFrase(hx) === 'canceló una', enUnaFrase(hx));

// ── Que no se caiga con etapas que no existen ─────────────────────────────────
check('una etapa desconocida no tumba el cálculo', historiaDe(conCita, { ahora, etapa: 'no-existe' }).citas.total === 3);
check('el negocio tiene etapas definidas', STAGE_DEFS.length > 0);

console.log(fail ? `\n${fail} fallo(s)` : '\ntodo ok');
process.exit(fail ? 1 : 0);
