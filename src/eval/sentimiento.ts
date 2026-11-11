// Pruebas del sentimiento de Analítica, sin modelo: pnpm test:sentimiento
//
// El usuario pidió la pantalla de sentimiento «más organizada, con emojis (según interés, desinterés)» y el análisis
// por voz «en UI, por desarrollar». Aquí se prueba que la cuenta dice la verdad (crm/sentimiento.ts: interés, ánimo,
// su cruce, lo que frena y cómo cambió por día), que el candado deja leerla, que cada emoji va con su palabra y que lo
// de voz está apagado de verdad y no enseña ni una cifra.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'xencrm-sentimiento-')), 'xencrm.db');
process.env.ADMIN_TOKEN = 'token-del-tablero-de-prueba-0123456789';
const { getDb } = await import('../rag/store.js');
const { agregarSentimiento, claveDeObjecion, diaEnLaZona, sentimiento } = await import('../crm/sentimiento.js');
const { frenoDelCandado } = await import('../channels/candado.js');
const { Hono } = await import('hono');
const { mountAdmin } = await import('../channels/admin.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};
const DIA = 86400_000;
const ahora = Date.parse('2026-11-11T15:00:00-05:00');
const ZONA = 'America/Bogota';
const contacto = (id: string, o: Partial<{ sentiment: string | null; data: Record<string, unknown>; name: string; stage: string; summary: string }> = {}) => ({
  id, name: o.name ?? id, phone: null, channel: 'whatsapp', stage: o.stage ?? 'conversando', sentiment: o.sentiment ?? null, data: o.data ?? {}, summary: o.summary ?? null,
});
const analisis = (userId: string, ts: number, sentiment: string, signals: Record<string, unknown>) => ({ userId, ts, sentiment, signals: { sentimiento: sentiment, ...signals } });

console.log('— La cuenta: interés y ánimo, cada uno por su lado');
{
  const d = agregarSentimiento({
    now: ahora, zona: ZONA, dias: 30,
    contactos: [
      contacto('a', { sentiment: 'positivo' }),
      contacto('b', { sentiment: 'negativo' }),
      contacto('c', { sentiment: 'neutral' }),
      contacto('d'), // sin análisis y sin ánimo: no cuenta
      contacto('e', { sentiment: 'positivo', data: { interes: 1 } }), // a mano: manda sobre la señal
      contacto('f', { sentiment: 'neutral' }), // ánimo sin análisis guardado: sin dato de interés
    ],
    analisis: [
      analisis('a', ahora - 2 * DIA, 'neutral', { interes: 1 }),
      analisis('a', ahora - 3600_000, 'positivo', { interes: 3 }), // el último manda
      analisis('b', ahora - 7200_000, 'negativo', { interes: 3, tiene_objecion: true, objecion: 'No hay tiempo.' }),
      analisis('c', ahora - DIA, 'neutral', { interes: 0 }),
      analisis('e', ahora - DIA, 'positivo', { interes: 3 }),
      analisis('zz', ahora, 'positivo', { interes: 3 }), // de un contacto que no está (archivado o grupo): no cuenta
    ],
  });
  check('analizados y sin analizar: quien no tiene ni análisis ni ánimo va aparte', d.total === 6 && d.analizados === 5 && d.sinAnalizar === 1, JSON.stringify({ t: d.total, a: d.analizados, s: d.sinAnalizar }));
  check('el interés sale del último análisis', d.contactos.find((c) => c.id === 'a')?.interes === 3);
  check('🪤 lo que el equipo corrigió a mano manda sobre lo que dijo el análisis', d.contactos.find((c) => c.id === 'e')?.interes === 1);
  check('interés por nivel', d.interes[3] === 2 && d.interes[1] === 1 && d.interes[0] === 1 && d.interes[2] === 0, JSON.stringify(d.interes));
  check('quien no dejó dato de interés se cuenta como «sin dato», no como «sin interés»', d.interesSinDato === 1 && d.contactos.find((c) => c.id === 'f')?.interes === null);
  check('ánimo por nivel', d.animo.positivo === 2 && d.animo.neutral === 2 && d.animo.negativo === 1 && d.animoSinDato === 0, JSON.stringify(d.animo));
  check('🪤 el cruce ve a quien quiere comprar y está molesto (en una escala única se perdía)', d.cruce[3].negativo === 1 && d.cruce[3].positivo === 1 && d.cruce[1].positivo === 1, JSON.stringify(d.cruce));
  check('el cruce suma lo mismo que los que tienen los dos datos', Object.values(d.cruce).reduce((s, f) => s + f.positivo + f.neutral + f.negativo, 0) === 4);
  check('la lista va del análisis más reciente al más viejo', d.contactos[0]?.id === 'a' && d.contactos.at(-1)?.id === 'f', d.contactos.map((c) => c.id).join(','));
}

console.log('— Lo que frena: las objeciones que se repiten');
{
  check('la misma objeción dicha distinto es una sola', claveDeObjecion('No hay TIEMPO.') === claveDeObjecion('no hay tiempo') && claveDeObjecion('Está lejos') === claveDeObjecion('esta lejos'));
  const d = agregarSentimiento({
    now: ahora, zona: ZONA,
    contactos: [contacto('a', { sentiment: 'neutral' }), contacto('b', { sentiment: 'neutral' }), contacto('c', { sentiment: 'neutral', data: { objecion: 'Le parece caro' } }), contacto('d', { sentiment: 'neutral' })],
    analisis: [
      analisis('a', ahora - 10, 'neutral', { tiene_objecion: true, objecion: 'no hay tiempo' }),
      analisis('b', ahora - 20, 'neutral', { tiene_objecion: true, objecion: 'No hay tiempo.' }),
      analisis('c', ahora - 30, 'neutral', {}),
      analisis('d', ahora - 40, 'neutral', { tiene_objecion: false, objecion: 'algo que no frena' }),
    ],
  });
  check('cuenta cuántos la dijeron y quiénes', d.objeciones[0]?.n === 2 && d.objeciones[0]?.ids.sort().join(',') === 'a,b', JSON.stringify(d.objeciones));
  check('la que el equipo escribió en la ficha también cuenta', d.objeciones.some((o) => o.texto === 'Le parece caro' && o.n === 1));
  check('🪤 sin «tiene_objecion», un texto suelto en la señal no es una objeción', !d.objeciones.some((o) => o.texto.includes('no frena')));
}

console.log('— Cómo cambió: por día, en la zona del negocio');
{
  const d = agregarSentimiento({
    now: ahora, zona: ZONA, dias: 7,
    contactos: [contacto('a', { sentiment: 'positivo' }), contacto('b', { sentiment: 'negativo' })],
    analisis: [
      analisis('a', Date.parse('2026-11-11T09:00:00-05:00'), 'neutral', { interes: 1 }),
      analisis('a', Date.parse('2026-11-11T11:00:00-05:00'), 'positivo', { interes: 3 }), // mismo día: cuenta el último
      // 🪤 23:30 en Barranquilla ya es el día siguiente en Londres: cuenta en el día del negocio.
      analisis('b', Date.parse('2026-11-09T23:30:00-05:00'), 'negativo', { interes: 2 }),
      analisis('b', ahora - 30 * DIA, 'negativo', { interes: 2 }), // fuera de la ventana
    ],
  });
  check('una casilla por día, del más viejo a hoy', d.serie.length === 7 && d.serie.at(-1)?.dia === '2026-11-11' && d.serie[0]?.dia === '2026-11-05', d.serie.map((x) => x.dia).join(','));
  const hoy = d.serie.at(-1)!;
  check('🪤 quien escribió veinte veces en un día pesa una: su último análisis', hoy.positivo === 1 && hoy.neutral === 0 && hoy.interesMedio === 3, JSON.stringify(hoy));
  check('el día del negocio, no el del servidor', d.serie.find((x) => x.dia === '2026-11-09')?.negativo === 1 && d.serie.find((x) => x.dia === '2026-11-10')?.negativo === 0);
  check('los días sin análisis dicen cero y su interés medio es «sin dato», no cero', d.serie.filter((x) => !x.positivo && !x.neutral && !x.negativo).every((x) => x.interesMedio === null) && d.serie.filter((x) => x.interesMedio === null).length === 5);
  check('la ventana va de 7 a 90 días', agregarSentimiento({ contactos: [], analisis: [], dias: 2, now: ahora }).serie.length === 7 && agregarSentimiento({ contactos: [], analisis: [], dias: 400, now: ahora }).dias === 90);
  check('diaEnLaZona es el de crm/series (año-mes-día)', diaEnLaZona(Date.parse('2026-11-02T23:30:00-05:00'), ZONA) === '2026-11-02');
}

console.log('— Sin nada que contar, no se inventa nada');
{
  const d = agregarSentimiento({ now: ahora, zona: ZONA, contactos: [contacto('a'), contacto('b')], analisis: [] });
  check('cero analizados, todo en cero, ninguna objeción', d.analizados === 0 && d.sinAnalizar === 2 && Object.values(d.interes).every((n) => n === 0) && !d.objeciones.length && d.serie.every((x) => !x.positivo && !x.neutral && !x.negativo));
}

console.log('— La ruta, con la base de verdad');
const db = getDb();
const usuario = db.prepare('INSERT INTO users (id, channel, name, first_seen, last_seen, stage, sentiment, data, archived) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
const guarda = db.prepare('INSERT INTO analyses (user_id, ts, engine, sentiment, signals, score, factors) VALUES (?, ?, ?, ?, ?, 0, ?)');
const ya = Date.now();
usuario.run('wa:1@s.whatsapp.net', 'whatsapp', 'Ana', ya, ya, 'interesado', 'positivo', '{"interes":3}', 0);
usuario.run('wa:2@s.whatsapp.net', 'whatsapp', 'Beto', ya, ya, 'conversando', 'negativo', '{}', 0);
usuario.run('wa:3@s.whatsapp.net', 'whatsapp', 'Archivada', ya, ya, 'perdido', 'negativo', '{}', 1);
usuario.run('120363@g.us', 'whatsapp', 'Un grupo', ya, ya, 'nuevo', 'negativo', '{}', 0);
usuario.run('web:sin', 'web', null, ya, ya, 'nuevo', null, '{}', 0);
guarda.run('wa:1@s.whatsapp.net', ya - 60_000, 'prueba', 'positivo', JSON.stringify({ sentimiento: 'positivo', interes: 3 }), '[]');
guarda.run('wa:2@s.whatsapp.net', ya - 120_000, 'prueba', 'negativo', JSON.stringify({ sentimiento: 'negativo', interes: 2, tiene_objecion: true, objecion: 'queda lejos' }), '[]');
guarda.run('wa:3@s.whatsapp.net', ya - 120_000, 'prueba', 'negativo', JSON.stringify({ sentimiento: 'negativo', interes: 3 }), '[]');
// Un análisis viejo (fuera de la ventana) sigue contando como el último de su contacto.
guarda.run('wa:2@s.whatsapp.net', ya - 200 * DIA, 'prueba', 'neutral', JSON.stringify({ sentimiento: 'neutral', interes: 0 }), '[]');
{
  const d = sentimiento(30, ya);
  check('sin archivados ni grupos', d.total === 3 && d.analizados === 2 && d.sinAnalizar === 1, JSON.stringify({ t: d.total, a: d.analizados, s: d.sinAnalizar }));
  check('el último análisis de cada uno, aunque haya otros más viejos', d.contactos.find((c) => c.id === 'wa:2@s.whatsapp.net')?.interes === 2 && d.cruce[2].negativo === 1);
  check('la objeción del último análisis', d.objeciones[0]?.texto === 'queda lejos' && d.objeciones[0]?.n === 1);
}
const app = new Hono();
mountAdmin(app as never);
const T = { 'x-admin-token': process.env.ADMIN_TOKEN!, 'content-type': 'application/json' };
{
  const r = await app.request('/admin/api/sentimiento?dias=14', { headers: T });
  const d = (await r.json()) as { dias: number; analizados: number; serie: unknown[] };
  check('GET /admin/api/sentimiento responde con la cuenta', r.status === 200 && d.dias === 14 && d.analizados === 2 && d.serie.length === 14, JSON.stringify(d).slice(0, 200));
  check('y sin token, no', (await app.request('/admin/api/sentimiento')).status === 401);
}
check('es del que vende: el candado la deja leer (asesor y admin, en el modo fácil)', frenoDelCandado('sentimiento', 'GET', 'asesor', 'facil') === null && frenoDelCandado('sentimiento', 'GET', 'admin', 'facil') === null);
await app.request('/admin/api/tablero/modo', { method: 'PUT', headers: { ...T, 'x-xencrm-rol': 'super' }, body: JSON.stringify({ modo: 'facil' }) });
check('y el servidor la abre de verdad con el candado puesto', (await app.request('/admin/api/sentimiento', { headers: { ...T, 'x-xencrm-rol': 'asesor' } })).status === 200);

console.log('— La pantalla: cada emoji con su palabra, y la voz apagada de verdad');
const js = readFileSync(new URL('../../public/admin.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../../public/admin.html', import.meta.url), 'utf8');
const escala = (nombre: string) => {
  const m = new RegExp(`var ${nombre} = \\[([\\s\\S]*?)\\];`).exec(js)?.[1] ?? '';
  return [...m.matchAll(/k: ([^,]+), e: '([^']+)', lbl: '([^']+)', d: '([^']+)'/g)].map((x) => ({ k: x[1]!, e: x[2]!, lbl: x[3]!, d: x[4]! }));
};
const interes = escala('XA_INTERES'), animo = escala('XA_ANIMO');
check('el interés va de querer comprar a no tener interés: cuatro niveles, del 3 al 0', interes.map((x) => x.k).join(',') === '3,2,1,0', JSON.stringify(interes));
check('el ánimo: contento, neutral, molesto', animo.map((x) => x.k).join(',') === "'positivo','neutral','negativo'", JSON.stringify(animo));
check('cada nivel lleva emoji Y palabra Y para qué es (el emoji solo no lo lee igual todo el mundo)', [...interes, ...animo].every((x) => /\p{Extended_Pictographic}/u.test(x.e) && x.lbl.length > 3 && x.d.length > 8));
check('🪤 los emojis se pintan escondidos para el lector de pantalla (la palabra es lo que se lee)', /function xaE\(e\) \{ return '<span class="e" aria-hidden="true">' \+ e \+ '<\/span>'; \}/.test(js));
const anclaJs = js.slice(js.indexOf('// ===== XEN · Analítica y sentimiento'), js.indexOf('// (fin de XEN · Analítica y sentimiento)'));
check('lo nuevo vive en su ancla, y sin colores sueltos (todo por tokens)', anclaJs.length > 2000 && !/#[0-9a-fA-F]{3,6}\b/.test(anclaJs));
check('las pestañas son pestañas de verdad (tablist, tab, tabpanel, con a quién controlan)', /role="tablist"/.test(html) && /role="tab" id="xa-tab-resumen" aria-controls="xa-resumen"/.test(html) && /role="tab" id="xa-tab-sentimiento" aria-controls="xa-sentimiento"/.test(html) && /id="xa-sentimiento" class="xa-panel" role="tabpanel"/.test(html) && /id="xa-resumen" class="xa-panel" role="tabpanel"/.test(html));
check('y se mueven con las flechas', /\['ArrowLeft', 'ArrowRight', 'Home', 'End'\]/.test(anclaJs));
check('🪤 sin análisis, la pestaña explica de dónde sale el sentimiento (no enseña ceros como si fueran datos)', /Aún no hay sentimiento que contar/.test(anclaJs) && /Sale del análisis que la IA hace de cada conversación/.test(anclaJs));
check('si falla, lo dice y deja volver a intentar', /No se pudo cargar el sentimiento/.test(anclaJs) && /'Volver a intentar', 'reintentar'/.test(anclaJs));
check('la gráfica por día trae su tabla (para quien no ve el color)', /Ver como tabla/.test(anclaJs) && /xa-serie-tabla/.test(anclaJs));
const voz = html.slice(html.indexOf('<section class="panel xa-voz"'), html.indexOf('</section>', html.indexOf('<section class="panel xa-voz"')));
check('la voz dice «Por desarrollar», a la vista', voz.length > 500 && />Por desarrollar</.test(voz));
check('🪤 su interruptor está apagado de verdad (disabled y aria-disabled), no solo gris', /<input type="checkbox" id="xa-voz-medir" disabled aria-disabled="true"/.test(voz));
check('🪤 y no enseña ni una cifra: ni en el texto ni en la vista previa', !/\d/.test(voz.replace(/<[^>]+>/g, ' ')), voz.replace(/<[^>]+>/g, ' ').match(/[^.]*\d[^.]*/)?.[0] ?? '');
check('la vista previa se rotula como tal y sin datos', /Vista previa · sin datos/.test(voz) && /role="img" aria-label="Vista previa sin datos/.test(voz));
check('dice qué hará, qué hay y qué falta', /Lo que hará/.test(voz) && /Lo que ya hay/.test(voz) && /Lo que falta/.test(voz) && /se pasan a texto/.test(voz));
check('🪤 «Ver todos» no se ve sin filtro (.btn le gana a [hidden] si no se dice)', /:root\[data-piel="xen"\] #xa-lista-todos\[hidden\]\{display:none\}/.test(html));

console.log('— Lo de antes de Analítica, con colores de dato');
const nuevas = js.slice(js.indexOf('function pintarNuevas('), js.indexOf('function pintarHoras('));
const horas = js.slice(js.indexOf('function pintarHoras('), js.indexOf('}', js.indexOf('caja.innerHTML', js.indexOf('function pintarHoras('))));
check('🪤 los canales y el mapa de calor ya no usan el acento de los botones (un dato no cambia si cambia la marca)', !/var\(--brand\)|var\(--cita\)/.test(nuevas) && !/var\(--brand\)/.test(horas), nuevas.match(/var\(--(brand|cita)\)/)?.[0] ?? '');
check('el embudo pinta cada etapa por su papel', /'<div class="f" data-rol="' \+ esc\(rol\(k\) \|\| ''\) \+ '"/.test(js) && /\.funnel \.f\[data-rol=ganado\] \.bar i\{background:var\(--fx-verde\)\}/.test(html));
check('🪤 en el modo fácil no salen las tarjetas que llevan a un filtro que ahí no existe', /\(t\.f && FILTROS_COMPLETOS\.test\(t\.f\) \? ' solo-completo' : ''\)/.test(js));
check('🪤 Ventas: con ventas y ninguna con precio dice «Sin precios», no «$0» (cero diría que no valieron nada)', /tarjeta\(d\.total \? plata\(d\.total\) : d\.cuantas \? 'Sin precios' : plata\(0\)/.test(js));
check('el ánimo del Resumen es el mismo de la pestaña (y el puntaje promedio solo en el completo)', /XA\.puntaje = s\.avgScore;\s*pintarMiniSentimiento\(\);/.test(js) && /solo-completo">Puntaje promedio/.test(anclaJs));

console.log(fail ? `\n${fail} fallaron` : '\nTodo bien');
process.exit(fail ? 1 : 0);
