// Pruebas de la transcripción de notas de voz (sin llamar a OpenAI): pnpm test:transcribir
//
// Dos cosas que se rompen calladas y cuestan dinero: el tope de duración —que es lo único que impide que
// alguien mande media hora de audio— y que el gasto quede bien contado. La transcripción se cobra POR MINUTO,
// no por tokens, así que si se cuela en la tabla de tokens el informe de costos dice una cifra falsa justo
// donde se mira para decidir qué dejar encendido.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const base = mkdtempSync(join(tmpdir(), 'xencrm-transcribir-'));
process.env.DB_PATH = join(base, 'data', 'xencrm.db');
// 🪤 SIN llave, a propósito. Una prueba no sale a internet: no puede depender de que haya red, no puede
// costar dinero y no puede tardar lo que tarde OpenAI. Sin llave, transcribir() se planta antes del fetch, y
// eso deja comprobar todo lo que importa aquí —el tope y la cuenta— sin tocar la red ni una vez.
// 🪤 VACÍA, no borrada. Borrarla la deja «sin definir», y el cargador de .env rellena justo lo que no está
// definido: la llave de verdad del .env de la raíz entraba sola y esta prueba salía a internet con ella. Una
// cadena vacía SÍ está definida, así que nadie la pisa. Es la misma trampa que ya mordió en motores.ts.
process.env.OPENAI_API_KEY = '';
const { transcribir, TOPE_SEGUNDOS, MODELO } = await import('../llm/transcribir.js');
const { costUsd, usageSummary } = await import('../llm/usage.js');
const { getDb } = await import('../rag/store.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};

const audio = join(base, 'nota.ogg');
writeFileSync(audio, Buffer.alloc(40_000));

// ---------- El tope ----------
// 🪤 Un minuto, y se mira ANTES de gastar. Lo que llega al chat de un negocio son notas de diez o veinte
// segundos; un audio de diez minutos no es una pregunta y produce un muro que nadie va a leer.
check('🪤 el tope es un minuto', TOPE_SEGUNDOS === 60, String(TOPE_SEGUNDOS));
let error = '';
try {
  await transcribir(audio, { segundos: 300 });
} catch (err) {
  error = (err as Error).message;
}
check('🪤 una nota tipo pódcast no se transcribe', /tope/.test(error) && /300/.test(error), error || 'no se quejó');
check('y se rechaza por lo que DICE que dura, sin bajar ni llamar a nadie',
  (getDb().prepare("SELECT COUNT(*) n FROM llm_usage WHERE task = 'transcripcion'").get() as { n: number }).n === 0,
  'gastó una llamada antes de mirar el tope');
check('el error es del tipo que el canal sabe atrapar', error.length > 0);

// Justo en el límite ya no se queja del tope: se queja de lo siguiente (aquí, de que no hay llave).
let hastaDonde = '';
try {
  await transcribir(audio, { segundos: TOPE_SEGUNDOS });
} catch (err) {
  hastaDonde = (err as Error).message;
}
check('justo en el minuto sí se intenta', !/tope/.test(hastaDonde), hastaDonde);
check('y sin llave de OpenAI lo dice claro, sin salir a la red', /llave/.test(hastaDonde), hastaDonde);

// ---------- 🪤 El costo: por minuto, no por tokens ----------
check('🪤 la transcripción se cobra por minuto', costUsd('openai', 'gpt-4o-mini-transcribe', 0, 0, 0, 60) === 0.003,
  String(costUsd('openai', 'gpt-4o-mini-transcribe', 0, 0, 0, 60)));
check('media nota cuesta la mitad', Math.abs((costUsd('openai', 'gpt-4o-mini-transcribe', 0, 0, 0, 30) ?? 0) - 0.0015) < 1e-9);
// 🪤 Sin segundos la cuenta daría cero y el informe diría que transcribir es gratis.
check('🪤 un modelo por minuto sin segundos no cuesta cero por accidente', costUsd('openai', 'gpt-4o-mini-transcribe', 0, 0, 0, 0) === 0,
  'da otra cosa; el caso existe y hay que entenderlo');
check('y los modelos de siempre siguen contando por tokens', (costUsd('openai', 'gpt-5.4-mini', 1_000_000, 0, 0) ?? 0) === 0.75);
check('el modelo por defecto es el barato', MODELO === 'gpt-4o-mini-transcribe', MODELO);

// Lo que se apunta en el contador tiene que salir en el informe con su costo.
getDb()
  .prepare("INSERT INTO llm_usage (ts, user_id, task, engine, model, input_tokens, cached_tokens, output_tokens, reasoning_tokens, segundos, ms) VALUES (?, 'wa:1', 'transcripcion', 'openai', 'gpt-4o-mini-transcribe', 0, 0, 0, 0, 120, 900)")
  .run(Date.now());
const informe = usageSummary(Date.now() - 3600_000);
const fila = informe.rows.find((r) => r.task === 'transcripcion');
check('🪤 la transcripción aparece en el informe de gasto', Boolean(fila), JSON.stringify(informe.rows));
check('y con su costo de verdad: dos minutos', Math.abs(informe.totalUsd - 0.006) < 1e-9, String(informe.totalUsd));
check('no se marca como «sin precio»', !informe.unpriced);

console.log(fail ? `\n${fail} fallo(s)` : '\ntodo ok');
process.exit(fail ? 1 : 0);
