// Pruebas del diccionario del negocio (sin modelo): pnpm test:dictionary
// Se aplica sin reiniciar, sumar no duplica, reemplazar deja copia y los errores se explican en palabras de persona.
// Usa un archivo temporal: no toca el diccionario real del cliente.
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { business } = await import('../config.js');
const { getDictionary, importDictionary, mergeDictionaries, useDictionary } = await import('../agent/dictionary.js');
const { ruleIntent } = await import('../agent/gate.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};
const original = getDictionary();
const originalFile = business.dictionaryFile;
business.dictionaryFile = join(mkdtempSync(join(tmpdir(), 'xencrm-dic-')), 'dictionary.json');

// 1. Se aplica al instante
check('antes: "¿tienen wifi?" no es un tema', ruleIntent('¿tienen wifi?')?.intent !== 'info_tienda');
useDictionary({ topics: [{ keywords: ['wifi', 'internet'], query: 'wifi para clientes' }], offerVerbs: [] });
const r = ruleIntent('¿tienen WiFi?');
check('después: "¿tienen WiFi?" lo resuelve el tema nuevo', r?.intent === 'info_tienda' && r.query.startsWith('wifi para clientes'), JSON.stringify(r));

// 2. Sumar no duplica
const merged = mergeDictionaries(
  { topics: [{ keywords: ['nequi'], query: 'Formas de pago' }], offerVerbs: ['alquilan'] },
  { topics: [{ keywords: ['Nequi', 'daviplata'], query: 'formas de pago' }, { keywords: ['wifi'], query: 'wifi' }], offerVerbs: ['Alquilan', 'venden'] },
);
check('sumar: junta palabras del mismo tema sin repetir', JSON.stringify(merged.topics[0]?.keywords) === '["nequi","daviplata"]', JSON.stringify(merged.topics));
check('sumar: agrega temas nuevos', merged.topics.length === 2);
check('sumar: verbos sin repetir', JSON.stringify(merged.offerVerbs) === '["alquilan","venden"]', JSON.stringify(merged.offerVerbs));

// 3. Importar a un archivo: reemplazar deja copia; sumar conserva lo que había
importDictionary({ topics: [{ keywords: ['parqueo'], query: 'parqueadero' }], offerVerbs: ['alquilan'] }, 'replace');
check('importar: escribe el archivo con la nota de ayuda', existsSync(business.dictionaryFile) && '_ayuda' in JSON.parse(readFileSync(business.dictionaryFile, 'utf8')));
const second = importDictionary({ topics: [{ keywords: ['wifi'], query: 'wifi' }], offerVerbs: [] }, 'merge');
check('sumar: conserva lo anterior y agrega lo nuevo', second.dictionary.topics.length === 2 && second.dictionary.offerVerbs[0] === 'alquilan', JSON.stringify(second.dictionary));
check('importar: guarda la versión anterior como copia', Boolean(second.backup && existsSync(second.backup)));
const third = importDictionary({ topics: [], offerVerbs: ['venden'] }, 'replace');
check('reemplazar: queda solo lo del archivo', third.dictionary.topics.length === 0 && third.dictionary.offerVerbs.join() === 'venden');

// 4. Errores en palabras de persona, sin tocar lo que había
let message = '';
try {
  importDictionary({ topics: [{ keywords: [], query: 'x' }], offerVerbs: 'alquilan' }, 'replace');
} catch (err) {
  message = (err as Error).message;
}
check('inválido: no se importa y dice dónde está el problema', /temas › 1 › palabras/.test(message) && /verbos/.test(message), message);
check('inválido: lo que había sigue igual', getDictionary().offerVerbs.join() === 'venden');

business.dictionaryFile = originalFile;
useDictionary(original);
console.log(`\n${fail ? `${fail} fallos` : 'todo ok'}`);
process.exit(fail ? 1 : 0);
