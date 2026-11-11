// Respuestas rápidas: lo que se pregunta mucho, contestado una vez. pnpm test:rapidas
//
// Lo que se prueba aquí es sobre todo cuándo NO se usa una. Una respuesta rápida que acierta ahorra unos
// segundos; una que se equivoca le manda a un cliente una respuesta sobre algo que no preguntó, con la
// seguridad de una respuesta aprobada, y en modo «Contesta» eso sale sin que nadie lo mire. El valor está en
// que se calle cuando no está segura.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'xencrm-rapidas-'));
const base = JSON.parse(readFileSync(new URL('../../xencrm.config.example.json', import.meta.url), 'utf8')) as Record<string, unknown>;
writeFileSync(join(dir, 'xencrm.config.json'), JSON.stringify(base));
process.env.XENCRM_CONFIG = join(dir, 'xencrm.config.json');
process.env.DB_PATH = join(dir, 'prueba.db');

// Vectores de mentira, deterministas: aquí se prueba la DECISIÓN (cuándo sí y cuándo no), no la calidad de un
// modelo de embeddings. Dos textos se parecen si comparten palabras — basta para separar los casos.
const palabras = (t: string) => new Set(t.toLowerCase().replace(/[^\wáéíóúñ ]/g, '').split(/\s+/).filter(Boolean));
const VOCAB = ['solicitud', 'proceso', 'credito', 'desembolso', 'cedula', 'bloqueo', 'hola', 'precio', 'traje', 'cita', 'mio', 'va', 'como', 'cuanto'];
const vectorDe = (t: string) => {
  const p = palabras(t);
  return VOCAB.map((v) => (p.has(v) ? 1 : 0));
};
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};

// El motor de embeddings se contesta a sí mismo: se intercepta la llamada de red, que es lo único que `embed`
// hace hacia fuera. Así la prueba no necesita Ollama ni clave de OpenAI y da lo mismo en cualquier máquina.
process.env.EMBED_ENGINE = 'ollama';
const fetchReal = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request, opciones?: RequestInit) => {
  const u = String(url);
  if (u.includes('/api/embed') || u.includes('/embeddings')) {
    const cuerpo = JSON.parse(String(opciones?.body ?? '{}')) as { input?: string | string[] };
    const textos = Array.isArray(cuerpo.input) ? cuerpo.input : [String(cuerpo.input ?? '')];
    return new Response(JSON.stringify({ embeddings: textos.map(vectorDe), data: textos.map((t, i) => ({ embedding: vectorDe(t), index: i })) }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  return fetchReal(url as never, opciones);
}) as typeof fetch;

const r = await import('../crm/respuestas-rapidas.js');
const { limpiarTemas } = await import('../crm/aprender-temas.js');

const falla = async (fn: () => Promise<unknown>): Promise<string> => {
  try {
    await fn();
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};

// ── Nada configurado ──
// 🪤 Sin ninguna lista no se pide ni un vector. Sin esta salida temprana, cada mensaje de cada negocio que no
// use esta función pagaría una llamada de embeddings para no encontrar nada.
check('🪤 sin respuestas listas, ni se intenta', (await r.buscarRespuestaRapida('como va mi solicitud')) === null);
check('y no hay ninguna lista', r.cuantasListas() === 0);

// ── Guardar ──
const uno = await r.guardarRespuestaRapida({
  tema: 'Estado de solicitud',
  ejemplos: ['quiero saber como va mi solicitud', 'en que va lo mio'],
  respuesta: 'Con gusto reviso. Me confirmas tu cedula.',
  estado: 'lista',
  origen: 'del historial',
});
check('se guarda y queda lista', uno.estado === 'lista' && r.cuantasListas() === 1);
check('el origen queda anotado', uno.origen === 'del historial');

// 🪤 Lista y vacía le mandaría a un cliente un mensaje en blanco con toda la confianza del mundo, y en
// «Contesta» eso sale sin que nadie lo vea.
check(
  '🪤 no se puede poner en uso sin respuesta escrita',
  (await falla(() => r.guardarRespuestaRapida({ tema: 'Vacía', ejemplos: ['algo'], respuesta: '', estado: 'lista' }))).includes('sin la respuesta'),
);
check('ni sin tema', (await falla(() => r.guardarRespuestaRapida({ tema: '  ', ejemplos: ['x'] }))).includes('tema'));
check('ni sin forma de reconocerla', (await falla(() => r.guardarRespuestaRapida({ tema: 'X', ejemplos: [] }))).includes('al menos una'));

// ── Reconocer ──
const acierto = await r.buscarRespuestaRapida('como va mi solicitud');
check('reconoce la pregunta de siempre', acierto?.respuesta.tema === 'Estado de solicitud', JSON.stringify(acierto));
check('y dice con qué forma casó', !!acierto?.comoLoPreguntan, JSON.stringify(acierto?.comoLoPreguntan));
// 🪤 Cada forma con SU vector, no un promedio por tema: el promedio de dos maneras distintas de preguntar cae
// en medio y no se parece a ninguna de las dos.
const otra = await r.buscarRespuestaRapida('en que va lo mio');
check('🪤 y reconoce también la otra forma', otra?.respuesta.tema === 'Estado de solicitud', JSON.stringify(otra));

// ── Cuándo NO ──
check('🪤 algo de otro tema no se reconoce', (await r.buscarRespuestaRapida('cuanto vale un traje')) === null);
check('un saludo suelto tampoco', (await r.buscarRespuestaRapida('hola')) === null);
// 🪤 Un mensaje largo es un caso, no una de las de siempre, y un caso no se contesta con plantilla.
check('🪤 un mensaje largo no se contesta con plantilla', (await r.buscarRespuestaRapida('como va mi solicitud ' + 'y además '.repeat(60))) === null);
check('y uno vacío tampoco', (await r.buscarRespuestaRapida('   ')) === null);

// Un borrador no se usa, por mucho que se parezca: es lo que separa «lo escribí» de «lo apruebo».
await r.guardarRespuestaRapida({ id: uno.id, tema: uno.tema, ejemplos: uno.ejemplos, respuesta: uno.respuesta, estado: 'borrador' });
check('🪤 un borrador NO se le manda a nadie', (await r.buscarRespuestaRapida('como va mi solicitud')) === null);
await r.guardarRespuestaRapida({ id: uno.id, tema: uno.tema, ejemplos: uno.ejemplos, respuesta: uno.respuesta, estado: 'lista' });
check('y al volver a ponerla en uso, otra vez sí', (await r.buscarRespuestaRapida('como va mi solicitud'))?.respuesta.id === uno.id);

r.anotarUso(uno.id);
check('se cuenta cuántas veces se usa', r.respuestaRapida(uno.id)?.veces === 1);
check('y se puede quitar', r.borrarRespuestaRapida(uno.id) && r.respuestasRapidas().length === 0);

// ── Lo que vuelve del modelo al leer un historial ──
// 🪤 De un historial salen TEMAS, nunca respuestas: «de qué preguntan» es un hecho observable y «qué se
// contesta» es una política del negocio que cambia. Aunque el modelo se salte la instrucción y mande una
// respuesta, aquí no se recoge.
const temas = limpiarTemas('```json\n{"temas":[{"tema":"Desembolso","ejemplos":["cuando me desembolsan","no me ha llegado"],"pista":"confirmar el plazo vigente","respuesta":"En 48 horas hábiles."}]}\n```');
check('lee el JSON aunque venga envuelto', temas.length === 1 && temas[0]!.tema === 'Desembolso');
check('🪤 y NO recoge la respuesta que colara el modelo', !('respuesta' in temas[0]!), JSON.stringify(temas[0]));
check('sí recoge la pista de qué hay que confirmar', temas[0]!.pista === 'confirmar el plazo vigente');
check('un tema sin ejemplos se descarta', limpiarTemas('{"temas":[{"tema":"X","ejemplos":[]}]}').length === 0);
check('y una respuesta que no es JSON no tumba nada', limpiarTemas('perdona, no pude') .length === 0);
check('un ejemplo de una letra no sirve para reconocer nada', limpiarTemas('{"temas":[{"tema":"A","ejemplos":["x"]}]}').length === 0);
check('los temas repetidos se juntan en uno', limpiarTemas('{"temas":[{"tema":"Desembolso","ejemplos":["cuando me pagan"]},{"tema":"desembolso","ejemplos":["cuando cae la plata"]}]}').length === 1);

globalThis.fetch = fetchReal;
rmSync(dir, { recursive: true, force: true });
console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
