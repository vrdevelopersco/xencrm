// Pruebas de llevarse los datos a una hoja de cálculo (sin modelo): pnpm test:export
// Contactos y citas en CSV: las columnas que el negocio necesita, sin los archivados y sin que una nota con
// comillas, punto y coma o saltos de línea dañe el archivo. Base temporal.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'aiva-export-')), 'aiva.db');
const { touchUser, appendMessage } = await import('../agent/memory.js');
const { updateContact, setArchived, setStage } = await import('../crm/contacts.js');
const { getDb } = await import('../rag/store.js');
const { contactsCsv, appointmentsCsv, stamp } = await import('../crm/export.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};

touchUser('wa:573001234567@s.whatsapp.net', 'whatsapp', 'Andrés Peña');
appendMessage('wa:573001234567@s.whatsapp.net', 'user', 'quiero un traje', 'consulta');
updateContact('wa:573001234567@s.whatsapp.net', {
  score: 78,
  data: { prenda: 'traje azul', ocasion: 'boda', fecha_evento: '6 de diciembre', ciudad: 'Barranquilla' },
  tags: ['novio', 'referido'],
  notes: 'Dijo: "me gusta el azul"; pidió precio\ny quedó de pensarlo',
  summary: 'Busca traje para su boda',
});
setStage('wa:573001234567@s.whatsapp.net', 'interesado', { by: 'bot' });

touchUser('web:spam', 'web', 'Spam');
setArchived('web:spam', true);

const csv = contactsCsv();
const lines = csv.split('\r\n').filter(Boolean);
const head = lines[0]!;
const andres = lines.find((l) => l.includes('Andrés'))!;

check('empieza con el BOM que Excel espera', csv.startsWith('﻿'));
check('encabezados en español y separados por ;', head.startsWith('﻿Nombre;Teléfono;Canal;Etapa;Puntaje;Temperatura;Qué busca'), head.slice(0, 80));
check('una fila por contacto, sin los archivados', lines.length === 2 && !csv.includes('Spam'), String(lines.length));
check('el teléfono sale de la dirección de WhatsApp, con +', andres.includes(';+573001234567;'), andres);
check('la etapa sale con su nombre, no con el código', andres.includes(';Interesado;'), andres);
check('lo capturado va en su columna', andres.includes(';traje azul;boda;6 de diciembre;'), andres);
check('la temperatura acompaña al puntaje', andres.includes(';78;caliente;'), andres);
check('las etiquetas van juntas en una celda', andres.includes(';novio, referido;'), andres);
check('una nota con comillas, ; y salto de línea no daña el archivo', andres.includes('"Dijo: ""me gusta el azul""; pidió precio\ny quedó de pensarlo"'), andres);
check('las fechas van legibles', /\d{2}\/\d{2}\/\d{4} \d{1,2}:\d{2} [ap]\. m\./.test(andres), andres);

// --- citas ---
const manana = Date.now() + 86400_000;
getDb()
  .prepare("INSERT INTO appointments (user_id, starts_at, ends_at, service, location, status, notes, created_at) VALUES (?, ?, ?, 'Cita privada', 'Barranquilla; centro', 'confirmada', '', ?)")
  .run('wa:573001234567@s.whatsapp.net', manana, manana + 3600_000, Date.now());
const citas = appointmentsCsv().split('\r\n').filter(Boolean);

check('encabezados de citas', citas[0]!.startsWith('﻿Fecha y hora;Cliente;Teléfono;Servicio;Estado'), citas[0]!.slice(0, 60));
check('una fila por cita, con el cliente y su teléfono', citas.length === 2 && citas[1]!.includes('Andrés Peña;+573001234567;Cita privada;Confirmada'), citas[1]);
check('un lugar con ; queda entre comillas', citas[1]!.includes('"Barranquilla; centro"'), citas[1]);
check('sin fecha no inventa nada', stamp(null) === '' && stamp(0) === '');

console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
