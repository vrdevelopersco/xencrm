// Recalcular el puntaje de las fichas con los pesos de hoy, usando los análisis que ya están guardados: no llama al
// modelo, no cuesta nada y no toca la conversación. Sirve cuando se recalibran los pesos, para que las fichas
// viejas no queden en una escala distinta a las nuevas.
//
//   pnpm rescore            muestra el antes y el después, sin tocar nada
//   pnpm rescore --write    lo guarda
import { computeScore, temperature, type Signals } from './crm/analyzer.js';
import { listAppointments } from './crm/appointments.js';
import { listContacts, updateContact, type Contact } from './crm/contacts.js';
import { getDb } from './rag/store.js';

const write = process.argv.includes('--write');
const now = Date.now();
const withAppointment = new Set(listAppointments({ limit: 100000 }).map((a) => a.userId));
const contacts = listContacts({ limit: 100000 }).concat(listContacts({ archived: true, limit: 100000 }));

let changed = 0;
console.log('contacto                   etapa            antes  →  después   (hoy, con el silencio)');
for (const c of contacts) {
  const row = getDb().prepare('SELECT signals FROM analyses WHERE user_id = ? ORDER BY ts DESC LIMIT 1').get(c.id) as { signals: string } | undefined;
  if (!row) continue; // sin análisis no hay de dónde recalcular
  const s = JSON.parse(row.signals) as Signals;
  const { score, factors } = computeScore(c as Contact, s, { hasAppointment: withAppointment.has(c.id) });
  if (score === c.scoreBase) continue;
  changed++;
  const after = { ...c, scoreBase: score };
  const hoy = Math.max(0, score - (c.scoreBase - c.score)); // el mismo descuento por silencio que ya tenía
  console.log(
    (c.name ?? c.id).slice(0, 26).padEnd(26),
    c.stage.padEnd(15),
    String(c.scoreBase).padStart(5),
    ' → ',
    String(after.scoreBase).padStart(5),
    '  ' + String(hoy).padStart(3),
    temperature(hoy),
  );
  if (write) updateContact(c.id, { score, scoreFactors: factors }, { silent: true });
}

console.log(`\n${changed} ficha${changed === 1 ? '' : 's'} ${write ? 'actualizada' + (changed === 1 ? '' : 's') : 'cambiaría' + (changed === 1 ? '' : 'n')}${write ? '' : ' (corre con --write para guardarlo)'}.`);
if (write) console.log(`Fecha: ${new Date(now).toISOString()}`);
