// Pruebas del intérprete de fechas y franjas (reglas, sin modelo): pnpm test:when
// "Hoy" fijo: lunes 21 de septiembre de 2026, 9:00 a. m. en Bogotá.
import { parseWhen } from '../crm/when.js';
import type { When } from '../crm/appointments.js';

const NOW = new Date('2026-09-21T14:00:00Z');
type Expect = Partial<Omit<When, 'dayLabel' | 'timeLabel'>> | null;

const CASES: [string, Expect][] = [
  ['el sábado en la tarde', { weekdays: [6], fromMin: 780, toMin: 1140, label: 'el sábado en la tarde' }],
  ['mañana después de las 5', { days: ['2026-09-22'], fromMin: 1020, label: 'mañana después de las 5:00 p. m.' }],
  ['mañana en la mañana', { days: ['2026-09-22'], fromMin: 0, toMin: 720 }],
  ['pasado mañana', { days: ['2026-09-23'], label: 'pasado mañana' }],
  ['hoy', { days: ['2026-09-21'], label: 'hoy' }],
  ['el 2 de octubre a las 4', { days: ['2026-10-02'], fromMin: 960, label: 'el viernes 2 de octubre a las 4:00 p. m.' }],
  ['viernes 2 de octubre', { days: ['2026-10-02'] }],
  ['octubre 15', { days: ['2026-10-15'] }],
  ['15/10', { days: ['2026-10-15'] }],
  ['el 15', { days: ['2026-10-15'] }],
  ['el 25', { days: ['2026-09-25'] }],
  ['el sábado 26', { days: ['2026-09-26'] }],
  ['el 12 de enero', { days: ['2027-01-12'] }],
  ['la otra semana temprano', { from: '2026-09-28', to: '2026-10-04', fromMin: 0, toMin: 720, label: 'la próxima semana en la mañana' }],
  ['el martes de la próxima semana', { weekdays: [2], from: '2026-09-28', to: '2026-10-04', label: 'el martes de la próxima semana' }],
  ['el otro jueves', { weekdays: [4], from: '2026-09-28', to: '2026-10-04' }],
  ['esta semana', { from: '2026-09-21', to: '2026-09-27' }],
  ['este fin de semana', { weekdays: [6, 0], label: 'el fin de semana' }],
  ['entre semana en la noche', { weekdays: [1, 2, 3, 4, 5], fromMin: 1080, label: 'entre semana en la noche' }],
  ['el lunes o el martes', { weekdays: [1, 2] }],
  ['entre las 3 y las 5', { fromMin: 900, toMin: 1020, label: 'entre las 3:00 p. m. y las 5:00 p. m.' }],
  ['de 10 a 12', { fromMin: 600, toMin: 720 }],
  ['antes de las 12', { toMin: 720, label: 'antes de las 12:00 p. m.' }],
  ['a las 10 de la mañana', { fromMin: 600 }],
  ['a las tres y media', { fromMin: 930, label: 'a las 3:30 p. m.' }],
  ['a la una', { fromMin: 780, label: 'a la 1:00 p. m.' }],
  ['tipo 4', { fromMin: 960 }],
  ['5pm', { fromMin: 1020 }],
  ['a las 17:30', { fromMin: 1050 }],
  ['mañana a las 11 am', { days: ['2026-09-22'], fromMin: 660 }],
  ['el jueves a las 6 de la tarde', { weekdays: [4], fromMin: 1080 }],
  ['a las 4 en la tarde', { fromMin: 960 }],
  ['al mediodía', { fromMin: 720, toMin: 810 }],
  ['Al medio dia', { fromMin: 720, toMin: 810, label: 'al mediodía' }],
  ['12m', { at: 720, label: 'a las 12:00 p. m.' }],
  ['a las 12 del día', { at: 720 }],
  ['la de las 3', { at: 900 }],
  ['las 4', { at: 960 }],
  ['la una', { at: 780 }],
  ['A las 12pm', { at: 720 }],
  ['tempranito', { fromMin: 0, toMin: 720 }],
  ['por la tardecita', { fromMin: 780, toMin: 1140 }],
  ['a última hora', { fromMin: 1020, label: 'a última hora' }],
  ['a primera hora el jueves', { weekdays: [4], toMin: 720 }],
  ['¿tienen espacio el sábado en la tarde?', { weekdays: [6], fromMin: 780 }],
  ['a la hora del almuerzo', { fromMin: 720, toMin: 840, label: 'a la hora del almuerzo' }],
  ['antes del almuerzo', { fromMin: 0, toMin: 720 }],
  ['después del almuerzo', { fromMin: 780, toMin: 1140 }],
  ['en ocho días', { days: ['2026-09-28'] }],
  ['de hoy en quince', { days: ['2026-10-05'] }],
  ['dentro de 3 días', { days: ['2026-09-24'] }],
  ['en dos semanas', { days: ['2026-10-05'] }],
  ['en ocho días en la tarde', { days: ['2026-09-28'], fromMin: 780 }],
  ['el otro fin de semana', { weekdays: [6, 0], from: '2026-09-28', to: '2026-10-04' }],
  // No son fechas
  ['Andrés Peña', null],
  ['quiero agendar una cita', null],
  ['cuánto cuesta el alquiler?', null],
  ['la tienda queda a 2 cuadras?', null],
  ['más tarde', null],
  ['la 2', null],
  ['voy a una boda', null],
  ['hace ocho días compré un traje', null],
  ['buenos días', null],
];

let fail = 0;
for (const [text, expect] of CASES) {
  const got = parseWhen(text, NOW);
  const problems: string[] = [];
  if (expect === null) {
    if (got) problems.push(`esperaba nada, obtuvo ${JSON.stringify(got)}`);
  } else if (!got) {
    problems.push('no entendió nada');
  } else {
    for (const [k, v] of Object.entries(expect)) {
      const g = (got as unknown as Record<string, unknown>)[k];
      if (JSON.stringify(g) !== JSON.stringify(v)) problems.push(`${k}: ${JSON.stringify(g)} ≠ ${JSON.stringify(v)}`);
    }
  }
  if (problems.length) fail++;
  console.log(`${problems.length ? '✗' : '✓'} ${text.padEnd(42)} ${got ? `→ ${got.label}` : '→ (nada)'}${problems.length ? `\n   ${problems.join('; ')}` : ''}`);
}
console.log(`\n${CASES.length - fail} ok · ${fail} fallos`);
process.exit(fail ? 1 : 0);
