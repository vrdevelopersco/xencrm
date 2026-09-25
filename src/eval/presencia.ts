// Pruebas de quién está metido en una conversación (sin modelo): pnpm test:presencia
// Lo que importa: que quepan varias personas a la vez, que uno no se vea a sí mismo como "otro", y que quien se
// va sin avisar desaparezca solo. Base temporal: no toca la de ningún cliente.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'aiva-presencia-')), 'aiva.db');
const { entrar, salir, quienesEstan, otrosQueEstan, DURACION_MS } = await import('../crm/presencia.js');
const { touchUser } = await import('../agent/memory.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};
const nombres = (lista: { nombre: string }[]) => lista.map((p) => p.nombre).join(',');

const chat = 'web:uno';
touchUser(chat, 'web', 'Cliente uno');
const t0 = Date.now();

check('al principio no hay nadie', quienesEstan(chat, t0).length === 0);

entrar(chat, 'Ana', t0);
check('entra una', nombres(quienesEstan(chat, t0)) === 'Ana');

entrar(chat, 'Pablo', t0 + 1000);
check('y caben varias a la vez', nombres(quienesEstan(chat, t0 + 1000)) === 'Ana,Pablo', nombres(quienesEstan(chat, t0 + 1000)));
check('el orden es por quién llegó primero', quienesEstan(chat, t0 + 1000)[0]!.nombre === 'Ana');

check('uno no es "otro" de sí mismo', nombres(otrosQueEstan(chat, 'Ana', t0 + 1000)) === 'Pablo');
check('y ve a los demás', otrosQueEstan(chat, 'Pablo', t0 + 1000).length === 1);

entrar(chat, 'Ana', t0 + 2000);
check('volver a entrar no duplica', quienesEstan(chat, t0 + 2000).length === 2, nombres(quienesEstan(chat, t0 + 2000)));

// Quien cierra la pestaña no avisa: tiene que caducar solo.
const despues = t0 + DURACION_MS + 5000;
check('quien se fue sin avisar desaparece solo', quienesEstan(chat, despues).length === 0, nombres(quienesEstan(chat, despues)));
entrar(chat, 'Ana', despues);
check('y el que sigue ahí se queda', nombres(quienesEstan(chat, despues)) === 'Ana');

salir(chat, 'Ana', despues);
check('salir a propósito saca de una', quienesEstan(chat, despues).length === 0);

entrar(chat, '  ', despues);
check('sin nombre no se guarda nada', quienesEstan(chat, despues).length === 0);

// Que no crezca sin fin si alguien abre y cierra cien veces con nombres distintos.
for (let i = 0; i < 30; i++) entrar(chat, `persona-${i}`, despues + i);
check('la lista no crece sin fin', quienesEstan(chat, despues + 30).length <= 12, String(quienesEstan(chat, despues + 30).length));

// Cada conversación lleva la suya.
const otroChat = 'web:dos';
touchUser(otroChat, 'web', 'Cliente dos');
entrar(otroChat, 'Sofía', despues);
check('cada conversación lleva la suya', nombres(quienesEstan(otroChat, despues)) === 'Sofía');

console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
