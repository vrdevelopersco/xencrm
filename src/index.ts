import { business, env } from './config.js';
import { probeEngines, roleLabel } from './llm/engines.js';
import { embedModelo } from './llm/embeddings.js';
import { startBusySync } from './crm/busy.js';
import { startReminders } from './crm/reminders.js';
import { startBackups } from './rag/backup.js';
import { apple } from './llm/apple.js';
import { countDocs, getDb } from './rag/store.js';

console.log(`\n🌱 ${business.agent.name} · asistente de ${business.business.name}`);
// El letrero dice lo que de verdad se está usando: con los roles en OpenAI, nombrar el modelo local y la URL de
// Ollama hacía creer que hacía falta tener Ollama al lado, y en un hosting de apps no lo hay.
const hayOllama = [env.lightEngine, env.heavyEngine, env.gateEngine, env.analysisEngine].includes('ollama') || env.embedEngine === 'ollama';
console.log(`   modelo: ${env.chatModel} · embeddings: ${embedModelo()}${hayOllama ? ` · ollama: ${env.ollamaUrl}` : ''}`);

getDb();
const engines = await probeEngines();
console.log(`   ollama: ${engines.ollama.available ? '✓' : '✗ ' + engines.ollama.reason}`);
console.log(`   apple:  ${engines.apple.available ? `✓ (${apple.info?.contextSize ?? '?'} tokens de contexto)` : '✗ ' + engines.apple.reason}`);
console.log(`   openai: ${engines.openai.available ? '✓' : '✗ ' + engines.openai.reason}`);
console.log(`   roles:  liviano ${roleLabel('light')} · pesado ${roleLabel('heavy')} · gate ${roleLabel('gate')} · análisis ${roleLabel('analysis')}`);
if (!engines.ollama.available && !engines.apple.available && !engines.openai.available) console.error('⚠️  Ningún motor disponible. Arranca Ollama, compila el sidecar (pnpm build:sidecar) o configura OPENAI_API_KEY.');
startBusySync();
startReminders();
startBackups();
if (business.appointments.enabled && business.appointments.reminder.enabled) console.log(`   recordatorios: el día antes a las ${business.appointments.reminder.at}`);
if (env.calendarBusyIcs.length) console.log(`   calendario: ${env.calendarBusyIcs.length} calendario(s) del dueño bloquean la agenda (se leen cada 5 min)`);

const docs = countDocs();
console.log(`   índice: ${docs.product ?? 0} productos, ${docs.knowledge ?? 0} fragmentos de info`);
if (!docs.product && !docs.knowledge) console.warn('⚠️  Índice vacío. Ejecuta `pnpm ingest` para cargar el catálogo y la info de la tienda.');

if (env.webEnabled) {
  const { startWeb } = await import('./channels/web.js');
  const { ADMIN_TOKEN } = await import('./channels/admin.js');
  await startWeb();
  // El token solo se muestra si se generó ahora (sin él no se podría entrar); el fijo de .env no va a los registros.
  if (env.adminToken) console.log(`[admin] token del tablero: el de ADMIN_TOKEN en .env (termina en …${ADMIN_TOKEN.slice(-4)})`);
  else console.log(`[admin] token del tablero: ${ADMIN_TOKEN}  (aleatorio; fija ADMIN_TOKEN en .env para que no cambie)`);
}
// WhatsApp por QR: lo decide el tablero (Canales) y, mientras nadie lo cambie, WHATSAPP_ENABLED.
const { channelOn } = await import('./channels/switches.js');
if (channelOn('whatsapp') && env.whatsappModo === 'local') {
  const { startWhatsApp } = await import('./channels/whatsapp.js');
  await startWhatsApp();
}
// Avisa al equipo por su propio WhatsApp cuando alguien lleva esperando más de lo prometido. Apagado hasta que
// alguien diga a quién avisar (Canales › Avisos).
const { empezarAVigilar } = await import('./crm/vigilante.js');
empezarAVigilar();

if (env.whatsappModo === 'puente') {
  // La sesión la tiene un conector en otra máquina (ver channels/puente.ts). Aquí solo se recibe lo que manda y
  // se le deja en el buzón lo que haya que enviar.
  const { registerSender } = await import('./crm/outbox.js');
  const { encolarSalida } = await import('./channels/puente.js');
  registerSender('whatsapp', async (userId, text) => encolarSalida(userId, text));
  console.log('[whatsapp] modo conector: la sesión la abre otra máquina y esto le sirve de buzón.');
}
if (!env.webEnabled && !channelOn('whatsapp')) {
  console.log('Ningún canal habilitado (WEB_ENABLED / WHATSAPP_ENABLED). Usa `pnpm chat` para probar en terminal.');
  process.exit(0);
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    console.log(`\n[aiva] ${sig}, cerrando...`);
    apple.stop();
    process.exit(0);
  });
}
