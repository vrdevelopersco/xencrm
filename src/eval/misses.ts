// Pruebas de "frases que no entendimos" y de las expresiones del diccionario (sin modelo): pnpm test:misses
// Lo que no se entendió se anota y agrupa; enseñarlo solo se guarda si con eso las reglas ya lo entienden.
// Usa un diccionario temporal: no toca el del cliente.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { business } = await import('../config.js');
const { expandExpressions, getDictionary, useDictionary } = await import('../agent/dictionary.js');
const { ruleIntent } = await import('../agent/gate.js');
const { teachExpression } = await import('../agent/teach.js');
const { touchUser } = await import('../agent/memory.js');
const { getContact, updateContact, deleteContactsByPrefix } = await import('../crm/contacts.js');
const { availableSlots } = await import('../crm/appointments.js');
const { bookingReading, bookingStep } = await import('../crm/booking.js');
const { closeMisses, listMisses, missKey, noteMiss } = await import('../crm/misses.js');
const { parseWhen } = await import('../crm/when.js');
const { getDb } = await import('../rag/store.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};
const original = getDictionary();
const originalFile = business.dictionaryFile;
business.dictionaryFile = join(mkdtempSync(join(tmpdir(), 'aiva-misses-')), 'dictionary.json');
const usageBefore = (getDb().prepare('SELECT COUNT(*) n FROM llm_usage').get() as { n: number }).n;
const empty = { topics: [], offerVerbs: [] };

// 1. Expresiones: se leen antes de las reglas
useDictionary(empty);
check('sin expresiones el texto no cambia', expandExpressions('Nos vemos al medio día 🙂') === 'Nos vemos al medio día 🙂');
check('antes: "a la hora del almuerzo" no es una hora', parseWhen('a la hora del almuerzo') === null && parseWhen('mañana a la hora del almuerzo')?.at === undefined);
useDictionary({ ...empty, expressions: [{ says: 'a la hora del almuerzo', means: 'a las 12' }, { says: 'de una', means: 'sí' }] });
const lunch = parseWhen('mañana a la hora del almuerzo');
check('después: "mañana a la hora del almuerzo" es mañana a las 12', lunch?.at === 720 && lunch.dayLabel === 'mañana', JSON.stringify(lunch));
check('sin importar tildes ni mayúsculas', parseWhen('A LA HORA DEL ALMUÉRZO')?.at === 720);
check('por palabras completas: "de una" no toca "de unas"', expandExpressions('de unas tallas') === 'de unas tallas');
check('"De una!" se lee como "sí!"', expandExpressions('De una!') === 'sí!', expandExpressions('De una!'));
check('antes: "cuadrar una vueltica" no lo resuelve una regla', ruleIntent('¿podemos cuadrar una vueltica?')?.intent !== 'cita');
useDictionary({ ...empty, expressions: [{ says: 'cuadrar una vueltica', means: 'agendar una cita' }] });
check('después: es un pedido de cita', ruleIntent('¿podemos cuadrar una vueltica?')?.intent === 'cita');
useDictionary(empty);
check('antes: en la cita "la que sea" no se entiende', bookingReading('la que sea') === null);
useDictionary({ ...empty, expressions: [{ says: 'la que sea', means: 'la primera' }] });
check('después: "la que sea" es la opción 1', bookingReading('la que sea') === 'la opción 1', String(bookingReading('la que sea')));

// 2. Se anotan y se agrupan
useDictionary(empty);
noteMiss('test:miss-1', 'fecha', 'A la hora del almuerzo', { reading: 'a las 12:00 p. m.', suggestion: 'a las 12:00 p. m.' });
noteMiss('test:miss-1', 'fecha', 'a la hora del almuerzo!'); // la misma del mismo cliente: cuenta una vez
noteMiss('test:miss-2', 'fecha', 'a la hora del almuérzo');
noteMiss('test:miss-2', 'frase', 'q más pues', { reading: 'un saludo', suggestion: 'hola' });
noteMiss('test:miss-2', 'cita', 'q más pues'); // la misma frase, otro diagnóstico: vale el primero
const mine = () => listMisses(500).filter((g) => g.userId.startsWith('test:miss-'));
const lunchGroup = mine().find((g) => g.key === missKey('a la hora del almuerzo'));
check('agrupa la misma frase con y sin tildes', lunchGroup?.count === 2 && lunchGroup.people === 2, JSON.stringify(lunchGroup));
check('la que más se repite va primero', mine()[0]?.key === missKey('a la hora del almuerzo'));
check('guarda lo que entendió el modelo', lunchGroup?.reading === 'a las 12:00 p. m.');
check('una frase del mismo cliente se anota una vez, con el primer diagnóstico', mine().filter((g) => g.key === 'q mas pues').map((g) => g.kind).join() === 'frase');

// 3. Enseñar: solo se guarda si las reglas ya la entienden
const wrongPart = teachExpression('fecha', lunchGroup!.key, 'hora de comer', 'a las 12');
check('si lo que dice no aparece en la frase, no se guarda y dice por qué', !wrongPart.ok && /no aparece/.test(wrongPart.ok ? '' : wrongPart.reason) && getDictionary().expressions.length === 0);
const useless = teachExpression('fecha', lunchGroup!.key, 'a la hora del almuerzo', 'cuando pueda');
check('si con eso las reglas siguen sin entender, no se guarda', !useless.ok && getDictionary().expressions.length === 0 && mine().some((g) => g.key === lunchGroup!.key));
const taught = teachExpression('fecha', lunchGroup!.key, 'a la hora del almuerzo', 'a las 12');
check('se enseña: dice cómo se entiende ahora', taught.ok && taught.reading === 'a las 12:00 p. m.', JSON.stringify(taught));
check('queda en el archivo del diccionario', JSON.parse(readFileSync(business.dictionaryFile, 'utf8')).expressions?.[0]?.says === 'a la hora del almuerzo');
check('y sale de la lista (las dos veces que se dijo)', taught.ok && taught.closed === 2 && !mine().some((g) => g.key === lunchGroup!.key));
closeMisses('frase', missKey('q más pues'), 'revisada');
check('"ya lo revisé" la saca de la lista', mine().length === 0);

// 4. En el flujo de la cita: una respuesta corta que no encaja se anota; enseñada, elige
const offered = availableSlots({ count: 3 }).map((s) => s.startsAt.toISOString());
const inFlow = async (userId: string, text: string) => {
  touchUser(userId, 'cli', 'Prueba');
  updateContact(userId, { name: 'Prueba', phone: '+573000000000', data: { booking: { step: 'elegir', offered } } }, { silent: true });
  return bookingStep(userId, text);
};
const out = await inFlow('test:miss-3', 'la que sea');
const flowMiss = mine().find((g) => g.kind === 'cita');
check('"la que sea" saca del flujo y queda anotada', out === null && flowMiss?.key === 'la que sea' && /eligiera/.test(flowMiss.reading ?? ''), JSON.stringify(flowMiss));
await inFlow('test:miss-4', '¿y cuánto vale el alquiler?');
await inFlow('test:miss-5', 'gracias');
check('las preguntas y las cortesías no se anotan', mine().filter((g) => g.kind === 'cita').length === 1);
const flowTaught = teachExpression('cita', 'la que sea', 'la que sea', 'la primera');
check('enseñada como "la primera"', flowTaught.ok && flowTaught.reading === 'la opción 1', JSON.stringify(flowTaught));
const reply = await inFlow('test:miss-6', 'La que sea');
check('ahora elige el primer horario', reply !== null && (getContact('test:miss-6')?.data.booking as { chosen?: string } | undefined)?.chosen === offered[0], reply ?? '(sin respuesta)');

const usageAfter = (getDb().prepare('SELECT COUNT(*) n FROM llm_usage').get() as { n: number }).n;
check('ninguna de estas pruebas llamó al modelo', usageAfter === usageBefore, `${usageAfter - usageBefore} llamadas`);

deleteContactsByPrefix('test:miss-');
business.dictionaryFile = originalFile;
useDictionary(original);
console.log(`\n${fail ? `${fail} fallos` : 'todo ok'}`);
process.exit(fail ? 1 : 0);
