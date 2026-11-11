// Pruebas del puntaje y de cómo envejece (sin modelo): pnpm test:score
// El puntaje se calcula cuando llega un mensaje; si no envejeciera al leerlo, alguien que no habla hace dos
// semanas seguiría en 100 y "caliente". Aquí se comprueban los tramos del silencio, que la ficha conserve el
// puntaje de la conversación y que los pesos ordenen a los prospectos como se espera. Base temporal.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'xencrm-score-')), 'xencrm.db');
const { touchUser, appendMessage } = await import('../agent/memory.js');
const { getContact, updateContact, setStage, stats } = await import('../crm/contacts.js');
const { computeScore, temperature } = await import('../crm/analyzer.js');
const { silencePenalty, decayed } = await import('../crm/score.js');
const { getDb } = await import('../rag/store.js');
import type { Signals } from '../crm/analyzer.js';
import type { Contact } from '../crm/contacts.js';

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};
const DAY = 86400_000;
const now = Date.now();

const signals = (over: Partial<Signals> = {}): Signals => ({
  sentimiento: 'neutral',
  interes: 1,
  urgencia: 'baja',
  quiere_cita: false,
  pidio_precio: false,
  menciono_presupuesto: false,
  tiene_objecion: false,
  objecion: '',
  presupuesto: '',
  nombre: '',
  ciudad: '',
  telefono: '',
  resumen: '',
  ...over,
});
const ficha = (over: Partial<Contact> = {}) => ({ name: null, phone: null, messageCount: 2, ...over }) as Contact;
const puntaje = (s: Partial<Signals>, opts = { hasAppointment: false }, c: Partial<Contact> = {}) => computeScore(ficha(c), signals(s), opts).score;

// --- el silencio pesa ---
check('el que habló hoy no pierde nada', silencePenalty(now, 'interesado', now) === 0);
check('a los 3 días pierde 10', silencePenalty(now - 3.5 * DAY, 'interesado', now) === 10);
check('a la semana pierde 25', silencePenalty(now - 8 * DAY, 'interesado', now) === 25);
check('a las dos semanas pierde 40', silencePenalty(now - 20 * DAY, 'interesado', now) === 40);
check('con cita agendada el silencio es normal', silencePenalty(now - 20 * DAY, 'cita_agendada', now) === 0);
check('a quien ya compró tampoco se le descuenta', silencePenalty(now - 60 * DAY, 'vendido', now) === 0);

const viejo = decayed(80, [{ label: 'Pidió cita', points: 30 }], now - 12 * DAY, 'interesado', now);
check('el descuento queda a la vista, con el porqué', viejo.score === 55 && viejo.factors.at(-1)!.label === 'Sin hablar hace más de una semana' && viejo.factors.at(-1)!.points === -25, JSON.stringify(viejo.factors.at(-1)));
check('el tiempo se dice como se habla', [4, 9, 20, 60].map((d) => decayed(50, [], now - d * DAY, 'interesado', now).factors.at(-1)!.label).join(' · ') === 'Sin hablar hace 4 días · Sin hablar hace más de una semana · Sin hablar hace 2 semanas · Sin hablar hace más de un mes', [4, 9, 20, 60].map((d) => decayed(50, [], now - d * DAY, 'interesado', now).factors.at(-1)!.label).join(' · '));
check('sin silencio, los factores quedan como estaban', decayed(80, [], now, 'interesado', now).factors.length === 0);

// --- la ficha lo aplica al leerla ---
touchUser('web:sebastian', 'web', 'Sebastián');
appendMessage('web:sebastian', 'user', 'me interesa el traje azul', 'consulta');
updateContact('web:sebastian', { score: 65, scoreFactors: [{ label: 'Pidió cita', points: 30 }] }, { silent: true });
setStage('web:sebastian', 'interesado', { by: 'bot' });
getDb().prepare('UPDATE users SET last_message_at = ? WHERE id = ?').run(now - 12 * DAY, 'web:sebastian');

const seb = getContact('web:sebastian')!;
check('la ficha muestra el puntaje de hoy, no el de hace 12 días', seb.score === 40 && temperature(seb.score) === 'tibio', `${seb.score} ${temperature(seb.score)}`);
check('y conserva el de la conversación para retomarlo', seb.scoreBase === 65, String(seb.scoreBase));
check('el motivo aparece entre los factores', seb.scoreFactors.some((f) => /Sin hablar/.test(f.label)));
check('los calientes de hoy no lo cuentan', stats().hot === 0, String(stats().hot));

getDb().prepare('UPDATE users SET last_message_at = ? WHERE id = ?').run(now - 60 * 60_000, 'web:sebastian');
check('si vuelve a escribir, recupera su puntaje', getContact('web:sebastian')!.score === 65);
check('y vuelve a contar como caliente', stats().hot === 1);

// --- los pesos ordenan como se espera ---
const pidioCita = puntaje({ quiere_cita: true, interes: 3, urgencia: 'alta' });
const soloDatos = puntaje({ interes: 1, pidio_precio: true, nombre: 'Ana', ciudad: 'Barranquilla', telefono: '3001234567' }, { hasAppointment: false }, { name: 'Ana', phone: '+573001234567' });
check('pedir cita pesa más que dar los datos', pidioCita > soloDatos + 20, `${pidioCita} vs ${soloDatos}`);
check('quien pidió cita es caliente', temperature(pidioCita) === 'caliente', String(pidioCita));
check('quien solo dio datos no lo es', temperature(soloDatos) !== 'caliente', String(soloDatos));
check('tener cita agendada pesa más que pedirla', puntaje({ interes: 2 }, { hasAppointment: true }) > puntaje({ quiere_cita: true, interes: 2 }));
check('una objeción y el ánimo negativo bajan', puntaje({ interes: 2, tiene_objecion: true, sentimiento: 'negativo' }) < puntaje({ interes: 2 }));

// Datos capturados: el cuarto no vale lo mismo que el primero (antes eran 6 puntos cada uno, y saturaban el 100)
const unDato = puntaje({ interes: 2, prenda: 'traje' });
const cuatroDatos = puntaje({ interes: 2, prenda: 'traje', servicio: 'alquiler', ocasion: 'boda', fecha_evento: '6 de diciembre' });
check('saber qué quiere suma', unDato > puntaje({ interes: 2 }));
check('pero el cuarto dato suma menos que el primero', cuatroDatos - unDato < 3 * (unDato - puntaje({ interes: 2 })), `${unDato} → ${cuatroDatos}`);
check('el tope del 100 no se alcanza solo con datos', cuatroDatos < 60, String(cuatroDatos));

// El mejor caso posible sigue cabiendo en 100 sin recortar a todos en el techo
const elMejor = puntaje(
  { quiere_cita: true, interes: 3, urgencia: 'alta', pidio_precio: true, menciono_presupuesto: true, sentimiento: 'positivo', nombre: 'Ana', ciudad: 'Barranquilla', prenda: 'traje', servicio: 'alquiler', ocasion: 'boda', fecha_evento: 'diciembre' },
  { hasAppointment: true },
  { name: 'Ana', phone: '+573001234567', messageCount: 8 },
);
check('el mejor prospecto llega a 100', elMejor === 100, String(elMejor));
check('uno muy bueno pero sin cita queda por debajo', puntaje({ quiere_cita: true, interes: 3, urgencia: 'alta', prenda: 'traje' }, { hasAppointment: false }) < 100);

console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
