// Pruebas de aprender del historial de un cliente (sin modelo): pnpm test:historial
// Del historial salen las preguntas que le hacen y cómo atiende; los precios, horarios y políticas NO, porque
// cambian (docs/aprender-del-historial.md). Base temporal.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'aiva-historial-')), 'aiva.db');
const { guardarImportados, resumenImportado, temasFrecuentes, decidirTema, muestraDeEstilo, leerChatExportado, borrarImportado } = await import('../crm/historial.js');
const { allDocs } = await import('../rag/store.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};
const dia = (n: number) => new Date(2026, 5, n, 10, 0).getTime();

// Un historial como el de un negocio real: lo mismo preguntado muchas veces, con respuestas que ya envejecieron.
const historial = [
  { chat: 'Marta', autor: 'Marta', role: 'user' as const, content: '¿qué documentos necesito para abrir una cuenta?', ts: dia(1) },
  { chat: 'Marta', autor: 'Negocio', role: 'assistant' as const, content: 'Con gusto, Marta. Necesitas la cédula y un recibo reciente.', ts: dia(1) + 60000 },
  { chat: 'Pedro', autor: 'Pedro', role: 'user' as const, content: 'buenos días, ¿cuáles documentos necesito para abrir cuenta?', ts: dia(2) },
  { chat: 'Pedro', autor: 'Negocio', role: 'assistant' as const, content: 'Buenos días. Te cuento el paso a paso y te acompaño en el proceso.', ts: dia(2) + 60000 },
  { chat: 'Ana', autor: 'Ana', role: 'user' as const, content: '¿documentos para abrir una cuenta de ahorros?', ts: dia(3) },
  { chat: 'Ana', autor: 'Negocio', role: 'assistant' as const, content: 'El costo de manejo es de $12.500 mensuales.', ts: dia(3) + 60000 },
  { chat: 'Luis', autor: 'Luis', role: 'user' as const, content: '¿cuánto cobran por el crédito de libre inversión?', ts: dia(4) },
  { chat: 'Luis', autor: 'Negocio', role: 'assistant' as const, content: 'La tasa hoy está en 1,8% mensual.', ts: dia(4) + 60000 },
  { chat: 'Sara', autor: 'Sara', role: 'user' as const, content: '¿cuánto cobran de cuota por el crédito?', ts: dia(5) },
  { chat: 'Sara', autor: 'Negocio', role: 'assistant' as const, content: 'Claro que sí, te explico con calma y sin afanes.', ts: dia(5) + 60000 },
  { chat: 'Sara', autor: 'Sara', role: 'user' as const, content: 'gracias', ts: dia(5) + 120000 },
  { chat: 'Eva', autor: 'Eva', role: 'user' as const, content: 'hola', ts: dia(6) },
];
check('se guarda lo importado', guardarImportados(historial) === historial.length);
check('lo repetido no se duplica', guardarImportados(historial) === 0);

const r = resumenImportado();
check('el resumen dice cuánto hay y de cuándo', r.mensajes === 12 && r.chats === 6 && r.desde === dia(1) && r.delNegocio === 5, JSON.stringify(r));

// --- las preguntas ---
const temas = temasFrecuentes();
check('agrupa la misma pregunta dicha de distintas formas', temas.some((t) => /documentos/i.test(t.titulo) && t.veces === 3), JSON.stringify(temas.map((t) => [t.titulo, t.veces])));
check('y la otra pregunta por su lado', temas.some((t) => /cr[eé]dito/i.test(t.titulo) && t.veces === 2), JSON.stringify(temas.map((t) => t.titulo)));
check('un saludo no es un tema', !temas.some((t) => /^hola|^gracias/i.test(t.titulo)), JSON.stringify(temas.map((t) => t.titulo)));
check('lo más preguntado va primero', temas[0]!.veces >= temas[temas.length - 1]!.veces);
check('el título es la pregunta, corta y sin cifras sueltas', temas.every((t) => t.titulo.length <= 80 && !/\d{3,}/.test(t.titulo)), JSON.stringify(temas.map((t) => t.titulo)));
check('trae ejemplos para decidir', temas[0]!.ejemplos.length >= 2);
check('todos empiezan sin decidir', temas.every((t) => t.estado === 'nuevo'));

decidirTema(temas[0]!.clave, 'aceptado', temas[0]!.titulo);
check('lo aceptado queda marcado y no se vuelve a proponer en blanco', temasFrecuentes().find((t) => t.clave === temas[0]!.clave)?.estado === 'aceptado');
decidirTema(temas[1]!.clave, 'descartado', temas[1]!.titulo);
check('y lo descartado también', temasFrecuentes().find((t) => t.clave === temas[1]!.clave)?.estado === 'descartado');

// --- el estilo, sin un solo dato que pueda estar vencido ---
const estilo = muestraDeEstilo();
check('toma respuestas del negocio para el tono', estilo.some((e) => /te explico con calma/i.test(e)), JSON.stringify(estilo));
check('deja fuera la que trae un precio', !estilo.some((e) => /12\.500/.test(e)), JSON.stringify(estilo));
check('y la que trae una tasa', !estilo.some((e) => /1,8%/.test(e)), JSON.stringify(estilo));
check('ninguna muestra trae cifras', estilo.every((e) => !/\$\s?\d|\b\d[\d.,]{2,}\b/.test(e)), JSON.stringify(estilo));

// --- lo más importante: nada de esto entra a lo que el asistente sabe ---
check('el historial NO entra al índice de conocimiento', allDocs(['knowledge', 'product']).length === 0, String(allDocs(['knowledge', 'product']).length));

// --- cómo hablan sus clientes: lo que las reglas no entienden ---
const { expresionesCandidatas } = await import('../crm/historial.js');
guardarImportados([
  { chat: 'Rosa', autor: 'Rosa', role: 'user', content: '¿me pueden atender de hoy en quince?', ts: dia(7) },
  { chat: 'Tito', autor: 'Tito', role: 'user', content: 'paso de hoy en quince entonces', ts: dia(8) },
  { chat: 'Rosa', autor: 'Rosa', role: 'user', content: 'necesito un terno para el grado', ts: dia(9) },
  { chat: 'Tito', autor: 'Tito', role: 'user', content: '¿manejan terno azul?', ts: dia(10) },
  { chat: 'Rosa', autor: 'Rosa', role: 'user', content: '¿puedo ir mañana en la tarde?', ts: dia(11) },
]);
// "mañana en la tarde" sí lo entienden las reglas; "de hoy en quince", en esta prueba, no.
const entiende = (t: string) => /ma(ñ|n)ana en la tarde/i.test(t);
const candidatas = expresionesCandidatas({ conocidas: entiende, vocabulario: new Set(['grado', 'azul', 'traje']) });
check('propone la fecha que no entiende', candidatas.some((e) => e.kind === 'fecha' && /hoy en quince/i.test(e.texto)), JSON.stringify(candidatas));
check('con cuántas veces la dijeron', candidatas.find((e) => /hoy en quince/i.test(e.texto))?.veces === 2, JSON.stringify(candidatas.map((e) => [e.texto, e.veces])));
check('no propone la fecha que sí entiende', !candidatas.some((e) => /ma(ñ|n)ana en la tarde/i.test(e.texto) && e.kind === 'fecha'), JSON.stringify(candidatas));
check('propone la palabra del negocio que no conoce', candidatas.some((e) => e.kind === 'frase' && e.pista === 'terno'), JSON.stringify(candidatas));
check('no propone lo que el negocio ya conoce', !candidatas.some((e) => e.pista === 'grado' || e.pista === 'azul'), JSON.stringify(candidatas.map((e) => e.pista)));
// Una palabra suelta puede ser un error de dedo; una fecha que no se entiende vale aunque se diga una vez.
check('la fecha propuesta trae la frase exacta que hay que enseñar', candidatas.find((e) => e.kind === 'fecha')?.pista === 'de hoy en quince', JSON.stringify(candidatas.filter((e) => e.kind === 'fecha')));
check('ninguna palabra propuesta se dijo una sola vez', !candidatas.some((e) => e.kind === 'frase' && e.veces < 2), JSON.stringify(candidatas.map((e) => [e.kind, e.pista, e.veces])));

// --- leer un chat exportado de WhatsApp ---
const exportado = [
  '[12/03/24, 9:41:02 a. m.] Marta: buenos días, ¿tienen traje azul?',
  '[12/03/24, 9:42:10 a. m.] DUNOR Boutique: ¡Hola Marta! Sí, con gusto te muestro',
  '12/03/24, 9:43 a. m. - Marta: ¿y me lo ajustan?',
  'sí, para el sábado',
  '[12/03/24, 9:44:00 a. m.] DUNOR Boutique: <Multimedia omitido>',
  '[12/03/24, 9:45:00 a. m.] Marta: listo, gracias',
].join('\n');
const leidos = leerChatExportado(exportado, { delNegocio: ['DUNOR Boutique'], chat: 'Marta' });
check('lee el chat exportado', leidos.length === 4, JSON.stringify(leidos.map((m) => m.content)));
check('sabe quién es el negocio y quién el cliente', leidos[0]!.role === 'user' && leidos[1]!.role === 'assistant');
check('junta el mensaje partido en dos líneas', /me lo ajustan[\s\S]*s[ií], para el s[aá]bado/i.test(leidos[2]!.content), leidos[2]!.content);
check('descarta los avisos de WhatsApp', !leidos.some((m) => /multimedia/i.test(m.content)));
check('entiende la fecha y la hora', new Date(leidos[0]!.ts).getHours() === 9 && new Date(leidos[0]!.ts).getMonth() === 2);

const cuantos = resumenImportado().mensajes;
check('se puede borrar todo lo importado', borrarImportado() === cuantos && resumenImportado().mensajes === 0, String(cuantos));
check('y con eso se van las decisiones', temasFrecuentes().length === 0);

console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
