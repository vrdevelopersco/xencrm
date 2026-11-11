// Pruebas del reporte de servicio (sin modelo): pnpm test:salud
//
// Esto contesta por una puerta SIN TOKEN y se lee justo cuando algo va mal. Así que tiene que cumplir dos
// cosas a la vez, y las dos se rompen en silencio: no puede enseñar nada que ayude a entrar, y no puede decir
// que todo va bien cuando no. Lo segundo es peor: un diagnóstico que inventa buenas noticias cierra la única
// pista que había.
import { mkdtempSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const base = mkdtempSync(join(tmpdir(), 'xencrm-salud-'));
process.env.DB_PATH = join(base, 'data', 'xencrm.db');
const { saludDelCliente } = await import('../salud.js');
const { registerSender } = await import('../crm/outbox.js');
const { touchUser, appendMessage } = await import('../agent/memory.js');
const { carpeta } = await import('../crm/medios.js');
const { getDb } = await import('../rag/store.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};
const MIN = 60_000;

// ---------- Sin nada montado: lo dice, no lo disimula ----------
const vacio = saludDelCliente();
check('🪤 sin un canal por donde entregar, avisa', vacio.avisos.some((a) => /ning[uú]n canal/i.test(a)), JSON.stringify(vacio.avisos));
check('y el veredicto es ese aviso, no «todo bien»', vacio.veredicto === vacio.avisos[0], vacio.veredicto);
check('dice de qué negocio habla', Boolean(vacio.negocio));

// ---------- 🪤 Lo que NO puede salir por una puerta sin token ----------
// Se mira el JSON entero como texto: da igual en qué campo se cuele, lo que importa es que no esté.
registerSender('whatsapp', async () => undefined, { medios: true });
touchUser('wa:573001112233@s.whatsapp.net', 'whatsapp', 'Arnulfo Domínguez');
appendMessage('wa:573001112233@s.whatsapp.net', 'user', 'mi cédula es 1032456789 y mi clave es Abc123', undefined, 'customer');
const crudo = JSON.stringify(saludDelCliente());
const prohibido: [string, string][] = [
  ['un número de teléfono', '573001112233'],
  ['el nombre de un cliente', 'Arnulfo'],
  ['nada de lo que escribió', 'cédula'],
  ['ni su clave', 'Abc123'],
  ['la llave de OpenAI', 'sk-'],
  ['ni rutas del servidor', base],
];
for (const [queEs, aguja] of prohibido) {
  check(`🪤 no se escapa ${queEs}`, !crudo.includes(aguja), `apareció «${aguja}» en el reporte`);
}
check('y el reporte no es enorme: esto se lee de un vistazo', crudo.length < 4000, `${crudo.length} caracteres`);

// ---------- Los canales ----------
const conCanal = saludDelCliente();
check('dice por dónde se entrega y quién lleva archivos', conCanal.canales.some((c) => c.id === 'whatsapp' && c.entrega && c.archivos), JSON.stringify(conCanal.canales));
check('ya no avisa de que no hay canales', !conCanal.avisos.some((a) => /ning[uú]n canal/i.test(a)));

// ---------- El tráfico, que es lo que distingue encendido de funcionando ----------
check('sabe cuándo entró el último mensaje', conCanal.trafico.ultimoEntranteHaceMin === 0, String(conCanal.trafico.ultimoEntranteHaceMin));
check('y que todavía no ha salido ninguno', conCanal.trafico.ultimoSalienteHaceMin === null, String(conCanal.trafico.ultimoSalienteHaceMin));
appendMessage('wa:573001112233@s.whatsapp.net', 'assistant', 'ya te ayudo', undefined, 'bot');
check('al contestar, también lo sabe', saludDelCliente().trafico.ultimoSalienteHaceMin === 0);
check('y cuenta los de hoy', saludDelCliente().trafico.mensajesHoy === 2, String(saludDelCliente().trafico.mensajesHoy));

// 🪤 La avería que NO da error: todo responde, nada falla, y simplemente no entra un mensaje desde hace días.
getDb().prepare('UPDATE messages SET ts = ?').run(Date.now() - 5 * 24 * 60 * MIN);
const callado = saludDelCliente();
check('🪤 un silencio de días se avisa, aunque nada esté fallando', callado.avisos.some((a) => /no entra un mensaje/i.test(a)), JSON.stringify(callado.avisos));
check('y dice cuántos días', /5 d[ií]as/.test(callado.avisos.find((a) => /no entra/.test(a)) ?? ''), callado.avisos.join(' | '));
// Un fin de semana no es una avería.
getDb().prepare('UPDATE messages SET ts = ?').run(Date.now() - 36 * 60 * MIN);
check('pero un día y medio no', !saludDelCliente().avisos.some((a) => /no entra un mensaje/i.test(a)));

// ---------- Los archivos ----------
const ok = saludDelCliente();
check('comprueba que se puede escribir donde van los archivos', ok.medios.carpetaEscribible);
// 🪤 No basta con que la carpeta exista: lo que falla en un alojamiento compartido es el permiso.
chmodSync(carpeta(), 0o500);
const sinPermiso = saludDelCliente();
chmodSync(carpeta(), 0o700);
check('🪤 una carpeta que existe pero no deja escribir se detecta', !sinPermiso.medios.carpetaEscribible && sinPermiso.avisos.some((a) => /no se puede escribir/i.test(a)), JSON.stringify(sinPermiso.medios));

// ---------- La base ----------
check('dice si la base contesta y cuánta gente hay', ok.base.responde && ok.base.contactos === 1, JSON.stringify(ok.base));

// ---------- Los motores ----------
check('enseña el estado de cada motor', ok.modelos.length >= 3 && ok.modelos.every((m) => typeof m.disponible === 'boolean'), JSON.stringify(ok.modelos));

console.log(fail ? `\n${fail} fallo(s)` : '\ntodo ok');
process.exit(fail ? 1 : 0);
