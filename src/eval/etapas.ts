// Pruebas del embudo por configuración (sin modelo): pnpm test:etapas
// Una financiera no trabaja como una boutique: aquí el negocio es de soporte (sin citas) y el CRM tiene que
// funcionar igual, porque el código no conoce los nombres de las etapas sino su papel. Config y base temporales.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'aiva-etapas-'));
// Un negocio de soporte, con la plantilla que se ofrece al dar de alta un cliente.
const { configDePlantilla } = await import('../clientes.js');
const plantilla = configDePlantilla('soporte');
(plantilla.business as Record<string, unknown>).name = 'Financiera del Caribe';
const configPath = join(dir, 'aiva.config.json');
writeFileSync(configPath, JSON.stringify(plantilla, null, 2));
process.env.AIVA_CONFIG = configPath;
process.env.DB_PATH = join(dir, 'aiva.db');

const { touchUser, appendMessage } = await import('../agent/memory.js');
const { getContact, updateContact, setStage, STAGES, STAGE_LABELS, primeraEtapa, etapaCon, rolDe, estaCerrada } = await import('../crm/contacts.js');
const { computeScore, temperature } = await import('../crm/analyzer.js');
const { silencePenalty } = await import('../crm/score.js');
const { business } = await import('../config.js');
const { getDb } = await import('../rag/store.js');
import type { Signals } from '../crm/analyzer.js';
import type { Contact } from '../crm/contacts.js';

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};

// --- el embudo es el del negocio ---
check('las etapas salen de la configuración', STAGES.join() === 'nuevo,en_revision,con_asesor,resuelto,sin_solucion', STAGES.join());
check('con sus nombres', STAGE_LABELS.con_asesor === 'Con un asesor' && STAGE_LABELS.resuelto === 'Resuelto', JSON.stringify(STAGE_LABELS));
check('la primera etapa es donde entra quien escribe', primeraEtapa() === 'nuevo');
check('este negocio no agenda citas', etapaCon('cita') === null && business.appointments.enabled === false);
check('lo ganado y lo perdido se saben por su papel', estaCerrada('resuelto') && estaCerrada('sin_solucion') && !estaCerrada('con_asesor'));
check('una etapa que no existe no rompe nada', rolDe('cita_agendada') === null);

// --- una ficha nueva entra en la primera etapa de ESTE embudo ---
touchUser('web:solicitud', 'web', 'Carmen');
appendMessage('web:solicitud', 'user', 'necesito saber por qué me cobraron dos veces', 'consulta');
check('quien escribe entra en "Nuevo", no en una etapa de otro negocio', getContact('web:solicitud')!.stage === 'nuevo', getContact('web:solicitud')!.stage);

// --- el análisis mueve por el papel, no por el nombre ---
const signals = (over: Partial<Signals> = {}): Signals => ({
  sentimiento: 'neutral', interes: 1, urgencia: 'baja', quiere_cita: false, pidio_precio: false, menciono_presupuesto: false,
  tiene_objecion: false, objecion: '', presupuesto: '', nombre: '', ciudad: '', telefono: '', resumen: '', ...over,
});
const { score } = computeScore(getContact('web:solicitud')! as Contact, signals({ interes: 3, urgencia: 'alta' }), { hasAppointment: false });
check('el puntaje se calcula igual', score > 0 && temperature(score).length > 0, String(score));

setStage('web:solicitud', 'con_asesor', { by: 'bot' });
check('se puede mover a una etapa de este embudo', getContact('web:solicitud')!.stage === 'con_asesor');

// --- el silencio pesa según el papel ---
const DAY = 86400_000;
check('en revisión, el silencio sí pesa', silencePenalty(Date.now() - 10 * DAY, 'con_asesor') === 25);
check('lo resuelto no se enfría', silencePenalty(Date.now() - 60 * DAY, 'resuelto') === 0);

// --- si cambia el embudo, las fichas viejas no se rompen ---
getDb().prepare('UPDATE users SET stage = ? WHERE id = ?').run('etapa_que_ya_no_existe', 'web:solicitud');
check('una etapa vieja cae a la primera del embudo', getContact('web:solicitud')!.stage === 'nuevo', getContact('web:solicitud')!.stage);

// --- los datos que captura también son los del negocio ---
check('captura lo de este negocio, no prendas ni ocasiones', business.crm.fields.map((f) => f.name).join() === 'solicitud,producto,radicado', business.crm.fields.map((f) => f.name).join());

updateContact('web:solicitud', { stage: 'resuelto' }, { silent: true });
check('una ficha resuelta queda cerrada', estaCerrada(getContact('web:solicitud')!.stage));

console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
