// Pruebas de las guardas contra inventos (sin modelo): pnpm test:guards
// Cifras que no están en la información y afirmaciones sin respaldo ("¿tienen wifi?" → "Sí, tenemos wifi").
import { claimsBooked, touchesPending, ungroundedClaim, ungroundedDenial, ungroundedNumbers, unsupportedAnswer } from '../agent/format.js';

let fail = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   obtuvo ${JSON.stringify(got)} · esperaba ${JSON.stringify(want)}`}`);
};

// Información de ejemplo, como la que recibe el modelo en un turno
const info = `Eres Aiva, de DUNOR Boutique: alquiler premium de trajes, esmóquines y accesorios, diseño a la medida y asesoría de imagen.
## Información disponible
Traje azul noche: alquiler con ajustes incluidos. Esmoquin negro clásico. Aceptamos tarjeta de crédito y transferencia.
Atención solo con cita previa en Barranquilla.`;

// Afirmaciones sin respaldo
check('"Sí, tenemos wifi" sin que la información lo diga', ungroundedClaim('¿tienen wifi?', 'Sí, tenemos wifi en la boutique ✨', info), 'wifi');
check('"Claro, hay parqueadero" sin respaldo', ungroundedClaim('¿tienen parqueadero?', 'Claro, hay parqueadero para clientes.', info), 'parqueadero');
check('color que no está en el catálogo', ungroundedClaim('¿tienen trajes rosados?', '¡Claro! Tenemos trajes rosados para tu evento.', info), 'rosados');
check('"Sí," al inicio aunque luego remita al equipo', ungroundedClaim('¿aceptan mascotas en la boutique?', 'Sí, podemos ayudarte con eso. Para confirmártelo bien, escríbenos.', info), 'mascotas');
check('"contamos con" a mitad de frase', ungroundedClaim('¿hay zona de café?', 'En DUNOR contamos con zona de café mientras esperas.', info), 'zona cafe');
check('con respaldo: el traje azul sí está', ungroundedClaim('¿tienen trajes azules?', 'Sí, tenemos trajes azules, como el azul noche.', info), null);
check('con respaldo: tarjeta sí está', ungroundedClaim('¿aceptan tarjeta?', 'Sí, aceptamos tarjeta de crédito.', info), null);
check('honesto: "no te lo puedo confirmar"', ungroundedClaim('¿aceptan mascotas?', 'Por ahora no te lo puedo confirmar con seguridad.', info), null);
check('honesto: "eso no lo tengo confirmado"', ungroundedClaim('¿tienen wifi?', 'Eso no lo tengo confirmado por aquí 🙂 Lo averiguo con el equipo.', info), null);
check('negar no es afirmar (las negativas tienen su propia guarda, abajo)', ungroundedClaim('¿venden zapatos?', 'No, por ahora no vendemos zapatos.', info), null);
check('"claro" de relleno antes de no confirmar', ungroundedClaim('¿tienen wifi?', 'Claro. Sobre el wifi, no lo tengo confirmado todavía.', info), null);
check('"puedes escribirnos" no afirma nada', ungroundedClaim('¿tienen wifi?', 'Puedes escribirnos al WhatsApp para averiguar lo del wifi.', info), null);
check('sin pregunta de "¿tienen…?" no aplica', ungroundedClaim('hola, buenas', 'Sí, cuéntame en qué te ayudo.', info), null);
check('solo palabras generales: no aplica', ungroundedClaim('¿tienen algo para mí?', 'Claro, tenemos opciones.', info), null);

// Negativas sin respaldo: un "no" deducido de que algo no aparece
check('"No, no vendemos zapatos" sin que la información los mencione', ungroundedDenial('¿venden zapatos?', 'No, por ahora no vendemos zapatos.', info), 'zapatos');
check('"no aceptamos mascotas" a mitad de frase', ungroundedDenial('¿aceptan mascotas en la boutique?', 'Por políticas de la tienda no aceptamos mascotas, pero te esperamos.', info), 'mascotas');
check('color que no está: "no tenemos rosados"', ungroundedDenial('¿tienen trajes rosados?', 'No tenemos trajes rosados, pero sí el azul noche.', info), 'rosados');
check('negar con respaldo: la información dice "solo con cita previa"', ungroundedDenial('¿se puede ir sin cita?', 'No, atendemos solo con cita previa.', info), null);
check('honesto: "no lo tengo confirmado, lo verifico"', ungroundedDenial('¿venden zapatos?', 'No lo tengo confirmado; lo verifico con el equipo y te cuento.', info), null);
check('honesto: la frase de verificación', ungroundedDenial('¿tienen parqueadero?', 'Deja te verifico eso con el equipo y te confirmo por aquí 🙂', info), null);
check('una respuesta que no niega no aplica', ungroundedDenial('¿venden zapatos?', 'Te cuento lo que manejamos: trajes y esmóquines.', info), null);
check('el "no" correcto pero deducido también se verifica la primera vez', ungroundedDenial('¿tienen vestidos para mujer?', 'No, solo manejamos moda masculina.', info), 'vestidos mujer');
check('cuando el equipo lo enseñó, ese "no" ya pasa', ungroundedDenial('¿tienen vestidos para mujer?', 'No, solo manejamos moda masculina.', `${info}\nPregunta de un cliente: ¿tienen vestidos para mujer?\nRespuesta del equipo: No, solo moda masculina.`), null);
const scope = 'Boutique de moda masculina: alquiler premium de trajes y esmóquines para hombres.';
check('negar por el alcance del negocio: "somos moda masculina" (está en su descripción)', ungroundedDenial('tienen vestidos de novia?', 'Hola. No, eso no lo vendemos: somos una boutique de moda masculina.', info, scope), null);
check('"moda masculina" se apoya en una descripción que dice "para hombres"', ungroundedDenial('tienen vestidos de novia?', 'No, eso no lo manejamos: nos especializamos en moda masculina.', info, 'Alquiler de trajes y esmóquines para hombres.'), null);
check('"X es una boutique de moda masculina" y "trabajamos moda masculina" también son alcance', [ungroundedDenial('¿tienen trajes para niño?', 'DUNOR es una boutique de moda masculina, y no tenemos trajes para niño.', info, scope), ungroundedDenial('¿tienen trajes para niño?', 'Trabajamos moda masculina para hombres, y no tenemos trajes para niño.', info, scope)], [null, null]);
check('"es una excelente opción" no es alcance', ungroundedDenial('¿venden zapatos?', 'No tenemos zapatos, pero el esmoquin es una excelente opción para bodas.', info, `${scope} Para bodas y grados.`), 'zapatos');
check('sin la descripción, ese mismo "no" se verifica', ungroundedDenial('tienen vestidos de novia?', 'Hola. No, eso no lo vendemos: somos una boutique de moda masculina.', info), 'vestidos novia');
check('un "no" a mitad del mensaje también cuenta', ungroundedDenial('¿venden zapatos?', 'Hola, soy Aiva de DUNOR. No, eso no lo manejamos.', info, scope), 'zapatos');
check('un alcance que no está en la descripción no respalda', ungroundedDenial('¿venden zapatos?', 'No, solo vendemos camisas.', info, scope), 'zapatos');
check('por confirmar en el perfil: "Zapatos"', touchesPending('¿venden zapatos?', ['Condiciones del alquiler', 'Zapatos']), 'Zapatos');
check('por confirmar: "tallas" toca "Tallas disponibles para alquiler"', touchesPending('¿qué tallas manejan?', ['Tallas disponibles para alquiler']), 'Tallas disponibles para alquiler');
check('lo que no toca nada pendiente', touchesPending('¿cuánto vale el traje azul?', ['Zapatos', 'Tallas disponibles para alquiler']), null);
check('lo que el negocio hace no activa un pendiente: "diseño a la medida" no es "Tiempos del diseño a la medida"', touchesPending('¿manejan alquiler y diseño a la medida para novios?', ['Tiempos del diseño a la medida', 'Condiciones del alquiler'], 'Alquiler premium de trajes, diseño a la medida y asesoría.'), null);
check('su palabra distintiva sí: "¿cuánto tiempo toma el diseño a la medida?"', touchesPending('¿cuánto tiempo toma el diseño a la medida?', ['Tiempos del diseño a la medida'], 'Alquiler premium de trajes, diseño a la medida y asesoría.'), 'Tiempos del diseño a la medida');
check('un "sí" o un "no" sin respaldo: los dos se detectan', [unsupportedAnswer('¿tienen wifi?', 'Sí, tenemos wifi.', info), unsupportedAnswer('¿tienen wifi?', 'No, no tenemos wifi.', info)], ['wifi', 'wifi']);

// Citas que no existen: "te esperamos en la cita" sin cita agendada
check('"Te esperamos en la cita privada" da por hecha una cita', claimsBooked('Perfecto, Arnulfo. Te esperamos en la cita privada; cualquier ajuste me escribes.'), true);
check('"tu cita quedó agendada" también', claimsBooked('¡Listo! Tu cita quedó agendada para el miércoles.'), true);
check('ofrecer agendar no es dar por hecha una cita', claimsBooked('Si quieres, te agendo una cita privada y te esperamos con gusto cuando puedas.'), false);
check('preguntar cuál horario tampoco', claimsBooked('¿Cuál de estos horarios te sirve para la cita?'), false);

// Cifras (la guarda que ya existía)
check('cifra inventada', ungroundedNumbers('El alquiler cuesta $350.000', info), ['350000']);
check('cifra respaldada', ungroundedNumbers('Queda en Barranquilla, calle 100', `${info} calle 100`), []);

console.log(`\n${fail ? `${fail} fallos` : 'todo ok'}`);
process.exit(fail ? 1 : 0);
