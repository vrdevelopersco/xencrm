// Pruebas de "deja te verifico eso" (sin modelo): pnpm test:verifications
// Usa una carpeta de información temporal: lo aprendido en la prueba no llega a la información real del cliente.
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { business } = await import('../config.js');
const { touchUser, getMessages } = await import('../agent/memory.js');
const { deleteContactsByPrefix } = await import('../crm/contacts.js');
const { answerVerification, dismissVerification, listVerifications, openVerification, saysWillVerify } = await import('../crm/verifications.js');
const { getDb } = await import('../rag/store.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};

// 1. ¿La respuesta promete verificar?
for (const [reply, want] of [
  [business.agent.verifyPhrase, true],
  ['Déjame verificarlo con el equipo y te cuento.', true],
  ['Eso no lo tengo confirmado por aquí, lo averiguo.', true],
  ['Sí, tenemos alquiler de esmoquin.', false],
  ['No manejamos vestidos de novia.', false],
] as const) check(`«${reply.slice(0, 45)}» → ${want ? 'promete verificar' : 'no'}`, saysWillVerify(reply) === want);

// 2. Abrir sin duplicar, responder, aprender y descartar
const knowledgeDir = business.sources.knowledgeDir;
business.sources.knowledgeDir = mkdtempSync(join(tmpdir(), 'aiva-kb-'));
touchUser('test:verif-1', 'cli', 'Prueba');
const a = openVerification('test:verif-1', '¿tienen wifi?', 'wifi');
const b = openVerification('test:verif-1', '¿Tienen WiFi?', 'wifi');
check('la misma pregunta no se duplica', a.id === b.id);
check('queda pendiente en la lista', listVerifications('pendiente').some((v) => v.id === a.id));
const done = await answerVerification(a.id, 'Sí, tenemos wifi gratis para los clientes durante la cita.', 'Laura', { learn: true });
check('respondida por Laura', done.status === 'respondida' && done.answeredBy === 'Laura');
const last = getMessages('test:verif-1', 5).at(-1);
check('el cliente recibe la respuesta como mensaje del equipo', last?.author === 'human' && last.by === 'Laura' && /wifi gratis/.test(last.content), JSON.stringify(last));
const file = join(business.sources.knowledgeDir, 'respuestas-del-equipo.md');
check('se agrega a la información del negocio', existsSync(file) && /## ¿tienen wifi\?\nSí, tenemos wifi gratis/.test(readFileSync(file, 'utf8')));
const indexed = getDb().prepare('SELECT id FROM docs WHERE id = ?').get(`kb:respuestas-del-equipo.md#v${a.id}`);
console.log(`  (índice: ${indexed ? 'indexada al instante' : 'sin Ollama, se indexa con pnpm ingest'})`);
let again = '';
try {
  await answerVerification(a.id, 'otra', 'Laura');
} catch (err) {
  again = (err as Error).message;
}
check('no se responde dos veces', /ya se cerró/.test(again));
check('el saludo no queda en la pregunta', openVerification('test:verif-1', 'buenas tardes, ¿tienen parqueadero?').question === '¿tienen parqueadero?');
const c = openVerification('test:verif-1', '¿aceptan mascotas?', 'mascotas');
check('descartar la cierra sin responder', dismissVerification(c.id)?.status === 'descartada' && getMessages('test:verif-1', 10).filter((m) => m.author === 'human').length === 1);

// 3. Ventana de 24 h de WhatsApp oficial
const { replyWindow, sendToContact } = await import('../crm/outbox.js');
const { appendMessage } = await import('../agent/memory.js');
const lastMessageAgo = (userId: string, hours: number) => {
  touchUser(userId, 'meta', 'Cliente Meta');
  appendMessage(userId, 'user', '¿tienen parqueadero?', 'info_tienda');
  getDb().prepare("UPDATE messages SET ts = ? WHERE user_id = ? AND role = 'user'").run(Date.now() - hours * 3600_000, userId);
};
lastMessageAgo('test:verif-meta-viejo', 25);
check('WhatsApp oficial, hace 25 h: ventana cerrada', !replyWindow('test:verif-meta-viejo').open && replyWindow('test:verif-meta-viejo').limited);
let windowError = '';
try {
  await sendToContact('test:verif-meta-viejo', 'Sí, tenemos parqueadero.', 'human', { by: 'Laura' });
} catch (err) {
  windowError = (err as Error).message;
}
check('no se envía y dice por qué', /más de 24 horas/.test(windowError) && /plantilla/.test(windowError), windowError);
check('no queda un mensaje "enviado" que Meta habría rechazado', getMessages('test:verif-meta-viejo', 10).every((m) => m.role === 'user'));
const late = openVerification('test:verif-meta-viejo', '¿tienen parqueadero?');
let lateError = '';
try {
  await answerVerification(late.id, 'Sí, tenemos.', 'Laura');
} catch (err) {
  lateError = (err as Error).message;
}
check('la verificación tardía sigue pendiente', /24 horas/.test(lateError) && listVerifications('pendiente').some((v) => v.id === late.id));
lastMessageAgo('test:verif-meta-reciente', 1);
const w = replyWindow('test:verif-meta-reciente');
check('WhatsApp oficial, hace 1 h: se puede responder (unas 23 h más)', w.open && Math.round(((w.closesAt ?? 0) - Date.now()) / 3600_000) === 23);
check('el chat web no tiene ventana', !replyWindow('test:verif-1').limited && replyWindow('test:verif-1').open);

// Limpieza: nada de la prueba queda en la base ni en el índice
getDb().prepare("DELETE FROM verifications WHERE user_id LIKE 'test:verif-%'").run();
getDb().prepare('DELETE FROM docs_fts WHERE id = ?').run(`kb:respuestas-del-equipo.md#v${a.id}`);
getDb().prepare('DELETE FROM docs WHERE id = ?').run(`kb:respuestas-del-equipo.md#v${a.id}`);
deleteContactsByPrefix('test:verif-');
business.sources.knowledgeDir = knowledgeDir;
console.log(`\n${fail ? `${fail} fallos` : 'todo ok'}`);
process.exit(fail ? 1 : 0);
