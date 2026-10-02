// Modo prueba: que aiva conteste solo a unos chats. pnpm test:prueba
//
// Esto es lo que más fácil puede arruinar un negocio de todo lo que hay en el CRM, y no por romperse: por
// quedarse encendido. Nada da error, nada se cae; simplemente los clientes escriben y nadie contesta, durante
// días, hasta que alguien se pregunta por qué bajaron las ventas. Casi todo lo de aquí abajo prueba que eso no
// pueda pasar.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'aiva-prueba-'));
const base = JSON.parse(readFileSync(new URL('../../aiva.config.example.json', import.meta.url), 'utf8')) as Record<string, unknown>;
writeFileSync(join(dir, 'aiva.config.json'), JSON.stringify(base));
process.env.AIVA_CONFIG = join(dir, 'aiva.config.json');
process.env.DB_PATH = join(dir, 'prueba.db');

const p = await import('../crm/modo-prueba.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};

// 🪤 Sin prueba en marcha, aiva le contesta a TODO EL MUNDO. Esta función corre en cada mensaje de cada cliente
// del sistema, use esto o no: si se equivocara hacia el otro lado, dejaría mudo a un negocio que nunca la tocó.
check('🪤 sin prueba, le contesta a cualquiera', p.puedeContestar('wa:573001234567@s.whatsapp.net') && p.puedeContestar('web:loquesea'));
check('y no hay ninguna activa', p.pruebaActiva() === null);

p.ponerPrueba(['300 123 4567'], 2, 'Luigi');
check('con prueba, le contesta al de la lista', p.puedeContestar('wa:573001234567@s.whatsapp.net'));
// 🪤 Por los dígitos y por el final. Quien monta una demostración escribe «300 123 4567»; lo que llega es
// `wa:573001234567@s.whatsapp.net`. Exigir que coincidan letra por letra dejaría a aiva muda en su propia demo,
// que es el peor momento posible para descubrirlo.
check('🪤 da igual cómo se escriba el número', p.puedeContestar('wa:3001234567@s.whatsapp.net') && p.puedeContestar('wa:573001234567@c.us'));
check('y a los demás, no', !p.puedeContestar('wa:573009999999@s.whatsapp.net'));
check('ni a uno que se le parece a medias', !p.puedeContestar('wa:573001234999@s.whatsapp.net'));

// 🪤 Lista vacía = APAGADO, nunca «no contestarle a nadie». Quien borra el último chat quiere volver a la
// normalidad; entenderlo al revés silencia el negocio entero con un gesto que parecía inofensivo.
p.quitarPrueba();
check('🪤 quitarla devuelve a la normalidad', p.puedeContestar('wa:573009999999@s.whatsapp.net') && p.pruebaActiva() === null);
let motivo = '';
try {
  p.ponerPrueba([], 2, 'x');
} catch (e) {
  motivo = (e as Error).message;
}
check('🪤 y una lista vacía ni se guarda', motivo.includes('a qué chats'), motivo || 'la guardó');
check('sigue contestándole a todos', p.puedeContestar('wa:573009999999@s.whatsapp.net'));

// 🪤 Caduca sola. Es la mitad del diseño: una demostración dura una tarde y quien la da está pensando en otra
// cosa cuando termina. No se apaga, se vence.
const corta = p.ponerPrueba(['300 123 4567'], 0.25, 'Luigi');
const dentro = corta.hasta - 60_000;
const despues = corta.hasta + 60_000;
check('mientras dura, solo el de la lista', p.puedeContestar('wa:573001234567@x', dentro) && !p.puedeContestar('wa:573009999999@x', dentro));
check('🪤 vencida, vuelve a contestarle a todos', p.puedeContestar('wa:573009999999@x', despues), 'se quedó encendida');
check('y deja de constar como activa', p.pruebaActiva(despues) === null);

// Un tope duro: ni poniendo un número absurdo dura más de lo permitido.
const larga = p.ponerPrueba(['300 123 4567'], 999, 'Luigi');
check('🪤 no puede durar más del tope', larga.hasta - Date.now() <= p.HORAS_MAXIMO * 3600_000 + 1000, String((larga.hasta - Date.now()) / 3600_000));
const diminuta = p.ponerPrueba(['300 123 4567'], -5, 'Luigi');
check('ni menos de nada', diminuta.hasta > Date.now());

// Un id de sesión web, que no es un número.
p.ponerPrueba(['demo-jurado-001'], 2, 'Luigi');
check('también vale un chat que no es un teléfono', p.puedeContestar('web:demo-jurado-001'));
check('y no se cuela otro parecido', !p.puedeContestar('web:demo-jurado-002'));

// Lo que se enseña en pantalla.
const activa = p.pruebaActiva()!;
check('dice cuánto le queda, en palabras', /h|min/.test(p.cuantoLeQueda(activa)), p.cuantoLeQueda(activa));
check('y quién la puso', activa.por === 'Luigi');

// Que el agente de verdad la consulte, y en el sitio correcto: antes del modelo, no después.
const agente = readFileSync(new URL('../agent/agent.ts', import.meta.url), 'utf8');
check('🪤 el agente la consulta', /if \(!puedeContestar\(msg\.userId\)\)/.test(agente), 'revisa el enganche en agent.ts');
// 🪤 Y antes del clasificador: un cliente que escribe durante la demostración no debe costar ni una llamada.
check('🪤 y antes de gastar en el modelo', agente.indexOf('puedeContestar(msg.userId)') < agente.indexOf('await classify('), 'quedó después del clasificador');
check('pero su mensaje sí se guarda', /puedeContestar[\s\S]{0,400}recordCustomerMessage/.test(agente), 'el de fuera de la prueba tiene que quedar en el CRM');

rmSync(dir, { recursive: true, force: true });
console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
