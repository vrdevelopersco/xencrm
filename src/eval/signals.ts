// Pruebas de las señales que saca el código sin modelo: pnpm test:signals
import { formatPhone, isTrivial, parsePhone, ruleSignals, shortBudget } from '../crm/signals.js';
import { recap } from '../crm/recap.js';
import type { Contact } from '../crm/contacts.js';
import type { Appointment } from '../crm/appointments.js';

let fail = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   obtuvo ${JSON.stringify(got)} · esperaba ${JSON.stringify(want)}`}`);
};
const r = (t: string) => ruleSignals([t]);

check('celular con espacios', r('mi número es 321 610 5383').telefono, '+573216105383');
check('fijo de Barranquilla (60X)', parsePhone('llámenme al 605 360 1234'), '+576053601234');
check('internacional', parsePhone('+1 (305) 555-1234'), '+13055551234');
check('con 57 sin +', parsePhone('573001234567'), '+573001234567');
check('número incompleto no es teléfono', parsePhone('mi número es 300 123'), null);
check('una fecha no es teléfono', parsePhone('el 12/10/2026'), null);
check('formato para mostrar', formatPhone('+573001234567'), '300 123 4567');
// Otro país (México): el indicativo y los dígitos salen de aiva.config.json, no del código.
{
  const { business } = await import('../config.js');
  const before = { ...business.business };
  Object.assign(business.business, { phoneCountryCode: '52', phoneLocalDigits: 10 });
  check('México: número local', parsePhone('mi cel es 55 1234 5678'), '+525512345678');
  check('México: para mostrar', formatPhone('+525512345678'), '551 234 5678');
  check('México: un colombiano con + se acepta', parsePhone('+57 300 123 4567'), '+573001234567');
  Object.assign(business.business, before);
}
check('celular con +57', r('escríbeme al +57 300-123-4567').telefono, '+573001234567');
check('correo', r('mi correo es Andres.Pena@Gmail.com gracias').correo, 'andres.pena@gmail.com');
check('presupuesto en millones', r('Hola, me caso el 6 de diciembre, no quiero gastar más de 2 millones').presupuesto, 'no quiero gastar más de 2 millones');
check('presupuesto en mil', r('tengo como 800 mil para el traje').presupuesto, 'tengo como 800 mil para el traje');
check('presupuesto con signo', r('mi presupuesto es $1.500.000').presupuesto, 'mi presupuesto es $1.500.000');
check('presupuesto en palos', r('hasta 2 palos más o menos').presupuesto, 'hasta 2 palos más o menos');
check('preguntar un precio no es presupuesto', r('¿cuesta 2 millones?').presupuesto, undefined);
check('una fecha no es presupuesto', r('tengo boda el 12 de diciembre').presupuesto, undefined);
check('pidió precio', r('y cuánto cuesta el alquiler?').pidioPrecio, true);
check('no pidió precio', r('me caso en diciembre').pidioPrecio, false);
check('el más reciente gana', ruleSignals(['hasta 1 millón', 'bueno, hasta 2 millones']).presupuesto, 'hasta 2 millones');
check('decimales con coma', r('tengo 1,5 millones').presupuesto, 'tengo 1,5 millones');

const trivial = (content: string, intent: string | null = 'compra') => isTrivial({ content, intent });
check('paso de la cita', trivial('Andrés Peña', 'cita'), true);
check('"la 2" dentro del flujo de citas', trivial('la 2', 'cita'), true);
check('"la 2" fuera del flujo no es trivial (depende de lo que ofreció el bot)', trivial('La 2'), false);
check('mensaje largo que abre la cita no es trivial', trivial('Necesito un traje para este sábado, ¿me lo pueden tener mañana?', 'cita'), false);
check('"dale"', trivial('dale', 'saludo'), true);
check('"gracias!"', trivial('gracias!', 'saludo'), true);
check('agradecer con contenido no es trivial', trivial('Gracias por todo, el esmoquin quedó perfecto', 'saludo'), false);
check('pregunta de compra no es trivial', trivial('¿alquilan esmoquin?'), false);
check('mensaje en modo humano no es trivial', trivial('es para reclamar por un traje', 'humano'), false);

check('presupuesto corto con tope', shortBudget('no quiero gastar más de 2 millones'), 'hasta 2 millones');
check('presupuesto corto sin tope', shortBudget('tengo como 800 mil para el traje'), '800 mil');
check('presupuesto sin monto se recorta', shortBudget('lo que sea razonable, no tengo un número definido todavía'), 'lo que sea razonable, no tengo un…');

// Recap: los campos de DUNOR en el orden de aiva.config.json, sin repetir, con la cita y lo que lo frena.
const contact = (data: Record<string, unknown>) => ({ id: 'x', data } as unknown as Contact);
const appt = { startsAt: Date.UTC(2026, 8, 24, 15), status: 'confirmada' } as Appointment;
check(
  'recap completo',
  recap(contact({ servicio: 'diseño a la medida', prenda: 'traje', ocasion: 'boda (novio)', fecha_evento: '6 de diciembre', presupuesto: 'no quiero gastar más de 2 millones', ciudad: 'Barranquilla', objecion: 'le queda lejos' }), appt),
  'diseño a la medida · traje · boda (novio) · 6 de diciembre · hasta 2 millones · Barranquilla · cita jue, 24 de sept, 10:00 a. m. · lo frena: le queda lejos',
);
check('recap sin repetir (prenda dentro del servicio)', recap(contact({ servicio: 'alquiler de esmoquin', prenda: 'esmoquin' }), null), 'alquiler de esmoquin');
check('recap: número suelto lleva el nombre del campo', recap(contact({ talla_o_medidas: '40' }), null), 'talla o medidas: 40');
check('recap: agendando cita', recap(contact({ booking: { step: 'elegir' } }), null), 'agendando cita');
check('recap vacío', recap(contact({}), null), '');

console.log(`\n${fail ? `${fail} fallos` : 'todo ok'}`);
process.exit(fail ? 1 : 0);
