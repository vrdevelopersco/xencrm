// Pruebas de las guardas contra inventos (sin modelo): pnpm test:guards
// Cifras que no están en la información y afirmaciones sin respaldo ("¿tienen wifi?" → "Sí, tenemos wifi").
import { ungroundedClaim, ungroundedNumbers } from '../agent/format.js';

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
check('negar lo que no está no es inventar', ungroundedClaim('¿venden zapatos?', 'No, por ahora no vendemos zapatos.', info), null);
check('"claro" de relleno antes de no confirmar', ungroundedClaim('¿tienen wifi?', 'Claro. Sobre el wifi, no lo tengo confirmado todavía.', info), null);
check('"puedes escribirnos" no afirma nada', ungroundedClaim('¿tienen wifi?', 'Puedes escribirnos al WhatsApp para averiguar lo del wifi.', info), null);
check('sin pregunta de "¿tienen…?" no aplica', ungroundedClaim('hola, buenas', 'Sí, cuéntame en qué te ayudo.', info), null);
check('solo palabras generales: no aplica', ungroundedClaim('¿tienen algo para mí?', 'Claro, tenemos opciones.', info), null);

// Cifras (la guarda que ya existía)
check('cifra inventada', ungroundedNumbers('El alquiler cuesta $350.000', info), ['350000']);
check('cifra respaldada', ungroundedNumbers('Queda en Barranquilla, calle 100', `${info} calle 100`), []);

console.log(`\n${fail ? `${fail} fallos` : 'todo ok'}`);
process.exit(fail ? 1 : 0);
