// Pruebas de atribución (sin modelo): pnpm test:origen
//
// Con estos números se decide dónde poner el dinero de la publicidad, así que lo que se prueba es que no mientan
// a favor de nadie: que no se invente un origen donde no lo hay, y que lo que trajo a alguien no se pise después
// con lo último por donde volvió —que es como toda la atribución termina en «directo» y el anuncio que sí
// funcionaba parece que no sirvió—.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'xencrm-origen-'));
process.env.DB_PATH = join(dir, 'xencrm.db');

const { anotarOrigen, deLaUrl, deMeta, origenDe, porCampana } = await import('../crm/origen.js');
const { touchUser } = await import('../agent/memory.js');
const { updateContact, STAGE_DEFS } = await import('../crm/contacts.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};

// --- leer una dirección con campaña ---
const deCampana = deLaUrl('https://atelier-demo.example/trajes?utm_source=google&utm_medium=cpc&utm_campaign=grados-2026&utm_content=video-a&gclid=ABC123', 'https://www.google.com/');
check('saca la campaña de la dirección', deCampana?.fuente === 'google' && deCampana?.campana === 'grados-2026', JSON.stringify(deCampana));
check('y la pieza concreta', deCampana?.contenido === 'video-a', JSON.stringify(deCampana));
// 🪤 El gclid identifica el CLIC, no el anuncio: si agrupara, cada persona sería su propia campaña.
check('🪤 el identificador del clic se guarda aparte, no como anuncio', deCampana?.clic === 'ABC123' && deCampana?.anuncio === '', JSON.stringify(deCampana));
check('guarda la página sin los parámetros', deCampana?.url === 'https://atelier-demo.example/trajes', String(deCampana?.url));

// Sin campaña, lo que queda es quién lo mandó.
const deReferencia = deLaUrl('https://atelier-demo.example/', 'https://www.instagram.com/algo');
check('sin campaña, se anota quién lo mandó', deReferencia?.fuente === 'instagram.com' && deReferencia?.medio === 'referencia', JSON.stringify(deReferencia));

// 🪤 Y cuando no hay NADA, no se inventa nada.
check('🪤 quien llega directo no se inventa un origen', deLaUrl('https://atelier-demo.example/', '') === null);
check('una dirección que no lo es tampoco', deLaUrl('no soy una url', '') === null);

// --- lo que manda Meta con un anuncio de «enviar mensaje» ---
const anuncio = deMeta({ source_type: 'ad', source_id: '120445', headline: 'Alquiler de esmoquin desde…', source_url: 'https://fb.me/xyz', ctwa_clid: 'clid-789' });
check('lee el anuncio de Meta', anuncio?.fuente === 'meta' && anuncio?.medio === 'anuncio' && anuncio?.anuncio === '120445', JSON.stringify(anuncio));
check('y se queda con el titular que leyó', anuncio?.titular === 'Alquiler de esmoquin desde…', String(anuncio?.titular));
check('una publicación no es un anuncio', deMeta({ source_type: 'post', source_id: '99', headline: 'x' })?.medio === 'publicacion');
check('🪤 sin aviso de origen, nada', deMeta(undefined) === null && deMeta({}) === null);

// --- 🪤 se guarda el primero y no se pisa ---
touchUser('web:uno', 'web', 'Marcela');
check('la primera vez se anota', anotarOrigen('web:uno', deCampana) === true);
check('la segunda, no', anotarOrigen('web:uno', deLaUrl('https://atelier-demo.example/?utm_source=boletin&utm_campaign=junio', '')) === false);
check('🪤 y sigue siendo el que la trajo', origenDe('web:uno')?.campana === 'grados-2026', JSON.stringify(origenDe('web:uno')));

// --- el embudo por campaña ---
const cita = STAGE_DEFS.find((e) => e.rol === 'cita')?.id;
const ganado = STAGE_DEFS.find((e) => e.rol === 'ganado')?.id;
const meter = (id: string, campana: string, etapa?: string) => {
  touchUser(id, 'web', id);
  anotarOrigen(id, deLaUrl(`https://atelier-demo.example/?utm_source=google&utm_medium=cpc&utm_campaign=${campana}`, ''));
  if (etapa) updateContact(id, { stage: etapa as never }, { silent: true });
};
meter('web:dos', 'grados-2026', ganado);
meter('web:tres', 'grados-2026', cita);
meter('web:cuatro', 'bodas', undefined);
updateContact('web:uno', { stage: ganado as never }, { silent: true });
// Alguien que llegó sin campaña: entra en la cuenta de los que no se sabe de dónde salieron.
touchUser('wa:573001112233@s.whatsapp.net', 'whatsapp', 'Llegó directo');

const { campanas, sinOrigen } = porCampana();
const grados = campanas.find((c) => c.campana === 'grados-2026');
check('agrupa por campaña', Boolean(grados) && grados!.conversaciones === 3, JSON.stringify(campanas));
check('cuenta cuántas llegaron a cita y cuántas se ganaron', grados!.citas === 1 && grados!.ganadas === 2, JSON.stringify(grados));
check('y saca la conversión', grados!.conversion === 67, String(grados!.conversion));
check('la campaña con más conversaciones va primero', campanas[0]!.campana === 'grados-2026', campanas.map((c) => c.campana).join(','));
check('🪤 y dice cuántos llegaron sin saberse de dónde', sinOrigen === 1, `${sinOrigen} (el de WhatsApp directo)`);

// 🪤 Dos personas que pulsaron el MISMO anuncio son una fila con dos, no dos filas de uno. El aviso de Meta trae
// un identificador de clic distinto para cada una, y usarlo para agrupar convertiría a cada cliente en su propia
// campaña: la tabla se llenaría de filas de uno y no se podría decidir nada con ella.
const delAnuncio = { source_type: 'ad', source_id: '120445', headline: 'Alquila tu esmoquin', source_url: 'https://fb.me/xyz' };
touchUser('meta:1', 'whatsapp', 'Una');
anotarOrigen('meta:1', deMeta({ ...delAnuncio, ctwa_clid: 'clic-de-una' }));
touchUser('meta:2', 'whatsapp', 'Otra');
anotarOrigen('meta:2', deMeta({ ...delAnuncio, ctwa_clid: 'clic-de-otra' }));
const conMeta = porCampana().campanas.filter((c) => c.fuente === 'meta');
check('🪤 dos clics en el mismo anuncio son una sola fila', conMeta.length === 1 && conMeta[0]!.conversaciones === 2, JSON.stringify(conMeta));
check('y se reconoce por su titular', conMeta[0]!.titular === 'Alquila tu esmoquin', String(conMeta[0]?.titular));

console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
