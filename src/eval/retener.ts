// Pruebas de la retención al cancelar (sin modelo): pnpm test:retener
//
// Esto no prueba que se salven citas: prueba que NO se acose. Las cuatro reglas de crm/retener.ts son fáciles
// de borrar sin querer —basta quitar una frase de un texto— y lo que se pierde cuando se borran no da error ni
// se ve en el tablero: se ve en la cara del cliente. Así que cada una tiene su prueba.
//
// Las cuatro: un solo intento; la salida escrita en cada mensaje; nunca se exige un motivo; y nunca se inventa
// urgencia. Base temporal.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'aiva-ret-')), 'aiva.db');
const { business } = await import('../config.js');
const { touchUser, appendMessage } = await import('../agent/memory.js');
const { getContact, updateContact } = await import('../crm/contacts.js');
const { getAppointment, zoned, tzParts } = await import('../crm/appointments.js');
const { bookingStep, startBooking } = await import('../crm/booking.js');
const { getDb } = await import('../rag/store.js');
const { motivoDeCancelar, diasParaElEvento, respuesta, preguntaQuePaso, DIAS_JUSTOS, yaSeIntento, anotarIntento } =
  await import('../crm/retener.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};
const HOUR = 3600_000;
const DIA = 24 * HOUR;
business.appointments.enabled = true;
business.appointments.days = [0, 1, 2, 3, 4, 5, 6]; // sin días cerrados: esta prueba no es del calendario

// ---------- 1. Leer el motivo ----------
const impedimentos = [
  'me salió un viaje de última hora',
  'me cambiaron el turno en el trabajo',
  'aplazaron la boda para marzo',
  'se me presentó algo, una emergencia familiar',
];
check('🪤 lo que se le cruzó a alguien se reconoce como impedimento', impedimentos.every((t) => motivoDeCancelar(t) === 'impedimento'),
  impedimentos.filter((t) => motivoDeCancelar(t) !== 'impedimento').join(' | '));

// 🪤 Lo serio va aparte de lo logístico, y ese es el punto. A quien se le cruzó un viaje se le ofrece el jueves
// y le sirve; a quien se le murió el papá, proponerle dos fechas de la otra semana es no haberlo escuchado.
const duros = ['me enfermé, tengo gripa', 'se me murió mi abuelo', 'tengo cirugía esa semana', 'estoy en el hospital'];
check('🪤 el duelo y la enfermedad van por su propio camino', duros.every((t) => motivoDeCancelar(t) === 'duro'),
  duros.filter((t) => motivoDeCancelar(t) !== 'duro').join(' | '));
const dudas = ['lo voy a pensar mejor', 'ya no lo necesito', 'está muy caro', 'encontré otro más económico', 'cambié de idea', 'no sé, tal vez después'];
// 🪤 «Está caro» es una percepción y se puede responder una vez. «No me alcanza» es un hecho, y a un hecho no se
// le rebate. Confundirlos es insistirle a alguien que acaba de decir que no tiene con qué.
const plata = ['es que no me alcanza', 'me quedé sin trabajo', 'no tengo plata ahorita', 'me despidieron'];
check('🪤 un problema de plata declarado NO es una duda que rebatir', plata.every((t) => motivoDeCancelar(t) === 'duro'),
  plata.filter((t) => motivoDeCancelar(t) !== 'duro').join(' | '));
check('y echarse para atrás se reconoce como duda', dudas.every((t) => motivoDeCancelar(t) === 'duda'),
  dudas.filter((t) => motivoDeCancelar(t) !== 'duda').join(' | '));

// 🪤 La regla 3. Quien no quiere dar explicaciones no tiene que darlas.
const basta = ['ya te dije que la cancelaras', 'no me insistas', 'solo cancélala', 'cancélala y ya', 'es personal', 'no quiero hablar de eso'];
check('🪤 «no me insistas» se entiende a la primera', basta.every((t) => motivoDeCancelar(t) === 'insiste'),
  basta.filter((t) => motivoDeCancelar(t) !== 'insiste').join(' | '));

// 🪤 La regla 1, en la función: con el intento gastado, da igual lo que diga.
check('🪤 si ya se le preguntó una vez, cualquier respuesta se respeta', motivoDeCancelar('lo voy a pensar', true) === 'insiste');

// ---------- 2. Las salidas ----------
const sinSalida = (t: string) => !/cancel/i.test(t);
const ops = ['el martes 10:00 a. m.', 'el miércoles 3:00 p. m.'];

// 🪤 La regla 2: cada mensaje dice cómo salirse. Un camino de salida que hay que adivinar no es un camino.
check('🪤 la primera pregunta ya dice cómo cancelar', !sinSalida(preguntaQuePaso('martes 10:00 a. m.')), preguntaQuePaso('x'));
// 🪤 Y nombra «ya no estoy seguro» como respuesta válida. Si solo se pregunta por el día, al que se arrepintió
// no le queda más que inventar una excusa o pelear.
check('🪤 y da permiso para decir que ya no quiere', /ya no est[aá]s tan seguro/i.test(preguntaQuePaso('martes')), preguntaQuePaso('martes'));
for (const m of ['impedimento', 'duda', null] as const) {
  const r = respuesta(m, { cita: 'martes', opciones: ops, diasEvento: null });
  check(`🪤 la respuesta a «${m ?? 'no se entendió'}» también dice cómo cancelar`, !sinSalida(r.texto), r.texto);
}

const aInsiste = respuesta('insiste', { cita: 'martes', opciones: ops, diasEvento: null });
check('a quien insiste se le cancela, no se le contesta nada', aInsiste.cancelar && !aInsiste.texto);

// ---------- 3. A quien le pasó algo NO se le insiste ----------
const aImpedimento = respuesta('impedimento', { cita: 'martes', opciones: ops, diasEvento: 10 });
check('🪤 a quien le pasó algo no se le vende nada', !/sin compromiso|no tienes que decidir|faltan \d+ días/i.test(aImpedimento.texto), aImpedimento.texto);
check('y no le gasta el intento: no se le insistió', !aImpedimento.gastaIntento);
check('se le ofrece mover con fechas concretas', ops.every((o) => aImpedimento.texto.includes(o)), aImpedimento.texto);

// 🪤 Lo serio, en cambio: ni fechas ni oferta. Su problema no es el día.
const aDuro = respuesta('duro', { cita: 'martes', opciones: ops, diasEvento: 15 });
check('🪤 a lo serio no se le pone fecha ni se le ofrece nada', !ops.some((o) => aDuro.texto.includes(o)) && !/faltan \d+ días|sin compromiso/i.test(aDuro.texto), aDuro.texto);
check('se le cancela de una, sin hacerlo pedirlo otra vez', aDuro.cancelar);
check('y la puerta queda abierta sin plazo', /cuando est[eé]s listo|sin af[aá]n/i.test(aDuro.texto), aDuro.texto);

// ---------- 4. Nunca se inventa urgencia ----------
// 🪤 La regla 4. Solo se puede nombrar el apuro cuando sabemos la fecha del evento y de verdad falta poco.
const sinFecha = respuesta('duda', { cita: 'martes', opciones: ops, diasEvento: null });
check('🪤 sin saber la fecha del evento, no hay prisa que meter', !/faltan|justo|tiempo/i.test(sinFecha.texto), sinFecha.texto);
const lejos = respuesta('duda', { cita: 'martes', opciones: ops, diasEvento: 200 });
check('con el evento lejos, tampoco', !/faltan \d+ días/.test(lejos.texto), lejos.texto);
const cerca = respuesta('duda', { cita: 'martes', opciones: ops, diasEvento: 20 });
check('pero si faltan 20 días para su boda, eso sí se le dice', /faltan 20 días/.test(cerca.texto), cerca.texto);
check('y es verdad, no una frase de presión', /confecci[oó]n|pruebas/.test(cerca.texto), cerca.texto);
check('el umbral es el que deja hacer una prenda a la medida', DIAS_JUSTOS >= 30 && DIAS_JUSTOS <= 60, String(DIAS_JUSTOS));

// La duda se trabaja bajando el riesgo, no subiendo la presión.
check('a la duda se le quita el compromiso, que es lo que frena', /sin compromiso|no tienes que decidir nada/i.test(cerca.texto), cerca.texto);
// 🪤 El miedo de un hombre en una boutique no es el precio: es que no le quede o verse disfrazado. Responder
// con plata es contestar una objeción que no hizo.
check('🪤 y se le responde al miedo real, no al precio', /te queda bien|franqueza/i.test(cerca.texto) && !/precio|barato|descuento|promoci[oó]n/i.test(cerca.texto), cerca.texto);

// ---------- 5. La fecha del evento solo cuenta si se entiende ----------
touchUser('wa:573001112233@s.whatsapp.net', 'whatsapp', 'Andrés');
const quien = 'wa:573001112233@s.whatsapp.net';
updateContact(quien, { data: { fecha_evento: 'en diciembre' } }, { silent: true });
check('🪤 una fecha a medias («en diciembre») no sirve para apurar a nadie', diasParaElEvento(getContact(quien)) === null, String(diasParaElEvento(getContact(quien))));
const enDosSemanas = new Date(Date.now() + 14 * DIA).toISOString().slice(0, 10);
updateContact(quien, { data: { fecha_evento: enDosSemanas } }, { silent: true });
check('una fecha de verdad sí', diasParaElEvento(getContact(quien)) === 14, String(diasParaElEvento(getContact(quien))));
updateContact(quien, { data: { fecha_evento: '2019-05-01' } }, { silent: true });
check('y una fecha que ya pasó no cuenta', diasParaElEvento(getContact(quien)) === null);

// ---------- 6. El flujo completo, con una cita de verdad ----------
const p = tzParts(new Date(Date.now() + 3 * DIA));
const T = zoned(p.y, p.m, p.d, 10, 0).getTime();
const citaDe = (userId: string) => {
  touchUser(userId, 'whatsapp', 'Cliente');
  appendMessage(userId, 'user', 'quiero una cita', 'cita');
  const r = getDb()
    .prepare('INSERT INTO appointments (user_id, starts_at, ends_at, service, location, status, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(userId, T, T + HOUR, 'cita de asesoría', 'la boutique', 'confirmada', '', Date.now() - 2 * DIA);
  return Number(r.lastInsertRowid);
};

// 6a. Se echó para atrás: se le pregunta y se le ofrece UNA vez.
const a = 'wa:573002223344@s.whatsapp.net';
const citaA = citaDe(a);
const p1 = await startBooking(a, 'quiero cancelar la cita');
check('🪤 no cancela de una: pregunta qué pasó', Boolean(p1 && /no te sirve ese d[ií]a|ya no est[aá]s tan seguro/i.test(p1)) && getAppointment(citaA)!.status === 'confirmada', String(p1));
// 🪤 Y no le dice que ya la canceló cuando no la ha cancelado: si no vuelve a escribir se queda con una cita
// viva que él cree muerta, y encima le llega el recordatorio.
check('🪤 y no le promete una cancelación que no hizo', Boolean(p1 && !/^claro,? lo cancelo|ya (?:la )?cancel[eé]|qued[oó] cancelada/i.test(p1)), String(p1));
check('y en esa misma pregunta dice cómo cancelar', Boolean(p1 && /cancel/i.test(p1)), String(p1));
const p2 = await bookingStep(a, 'es que lo voy a pensar mejor');
check('ante la duda, ofrece una vez sin compromiso', Boolean(p2 && /sin compromiso/i.test(p2)), String(p2));
check('la cita sigue en pie mientras tanto', getAppointment(citaA)!.status === 'confirmada');
const p3 = await bookingStep(a, 'no, cancélala');
check('🪤 y al segundo «cancélala» se cancela, sin volver a preguntar', getAppointment(citaA)!.status === 'cancelada', String(p3));
check('se despide sin reproche y deja la puerta abierta', Boolean(p3 && /cuando quieras/i.test(p3)) && !/seguro|de verdad|pi[eé]nsalo/i.test(String(p3)), String(p3));

// 6b. 🪤 La regla 1 de punta a punta: sobre LA MISMA cita no se pregunta dos veces.
//
// El intento se gasta por cita, no por persona: alguien que agenda otra vez dentro de tres meses es un
// compromiso nuevo y merece que se le pregunte una vez. Pero volver a la carga sobre la misma cita, después de
// que ya dijo que la pensaba, es exactamente lo que convierte el servicio en acoso.
const f = 'wa:573007778899@s.whatsapp.net';
const citaF = citaDe(f);
await startBooking(f, 'quiero cancelar la cita');
await bookingStep(f, 'lo voy a pensar');
check('el intento quedó anotado en su ficha', yaSeIntento(getContact(f), citaF));
const g1 = await bookingStep(f, 'déjala así entonces');
check('se queda con la cita si eso es lo que decide', Boolean(g1 && /te esperamos/i.test(g1)) && getAppointment(citaF)!.status === 'confirmada', String(g1));
const g2 = await startBooking(f, 'no, mejor cancélala');
// Pide una confirmación simple —protege de un «cancélala» escrito sin querer— pero NO vuelve a preguntar por
// qué ni a ofrecer nada: eso ya se gastó. Una confirmación de un toque no es fricción; insistir sí lo sería.
check('🪤 al volver sobre la MISMA cita ya no se le pregunta por qué', Boolean(g2 && /confirmas que cancelo/i.test(g2)) && !/pas[oó] algo|sin compromiso/i.test(String(g2)), String(g2));
const g3 = await bookingStep(f, 'sí');
check('y con un sí queda cancelada', getAppointment(citaF)!.status === 'cancelada', String(g3));

// 6c. Le pasó algo: ni una palabra de retención.
const b = 'wa:573003334455@s.whatsapp.net';
const citaB = citaDe(b);
await startBooking(b, 'necesito cancelar mi cita');
const r2 = await bookingStep(b, 'es que me enfermé, tengo gripa');
check('🪤 a quien se enfermó se le acompaña, no se le insiste', Boolean(r2 && /qu[eé] pena/i.test(r2)) && !/sin compromiso|faltan \d+ días/i.test(String(r2)), String(r2));
check('se le resuelve sin hacerlo pedirlo otra vez', getAppointment(citaB)!.status === 'cancelada');
// 🪤 Y con SU despedida, no con la de siempre: a quien se le murió alguien no se le contesta con la plantilla.
check('🪤 y con una despedida suya, sin plazo', Boolean(r2 && /cuando est[eé]s listo|sin af[aá]n/i.test(r2)), String(r2));

// 6d. «No me insistas» a la primera: se cancela en el acto.
const d = 'wa:573005556677@s.whatsapp.net';
const citaD = citaDe(d);
await startBooking(d, 'cancela la cita por favor');
const r4 = await bookingStep(d, 'no me insistas, solo cancélala');
check('🪤 «no me insistas» cancela en el acto, sin pedir confirmación', getAppointment(citaD)!.status === 'cancelada', String(r4));

// 6e. Quien en realidad quería moverla: se mueve, y no se le insiste nada.
const e = 'wa:573006667788@s.whatsapp.net';
const citaE = citaDe(e);
await startBooking(e, 'quiero cancelar la cita');
const r5 = await bookingStep(e, 'mejor pásala para el viernes');
check('quien quería moverla termina moviéndola, no cancelando', Boolean(r5 && /otro espacio|tengo/i.test(r5)) && getAppointment(citaE)!.status === 'confirmada', String(r5));

// ---------- 7. La marca del intento ----------
const marcado = anotarIntento({ otra: 'cosa' }, 77);
check('anotar el intento no borra lo que ya había en la ficha', marcado.otra === 'cosa');

console.log(fail ? `\n${fail} fallo(s)` : '\ntodo ok');
process.exit(fail ? 1 : 0);
