// Pruebas de la optimización de ventas, sin modelo: pnpm test:optimizacion
//
// Optimización de ventas (Rendimiento › Optimización de ventas) dice dónde se pierden ventas y qué hacer, con
// reglas fijas sobre los datos de verdad (crm/optimizacion.ts). Aquí se prueba que cada regla sale cuando debe y
// calla cuando no hay datos suficientes, que cada cifra lleva su base, que nada lo dice un modelo, que la ruta la
// lee también el candado, que /ventas y /seguimientos siguen contando igual después de mudar su cálculo, y que la
// pantalla tiene sus cinco estados.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const carpeta = mkdtempSync(join(tmpdir(), 'xencrm-optimizacion-'));
process.env.DB_PATH = join(carpeta, 'xencrm.db');
process.env.ADMIN_TOKEN = 'token-del-tablero-de-prueba-0123456789';
const { hallazgosDe, picoDeHoras, UMBRAL } = await import('../crm/optimizacion.js');
type Entradas = Parameters<typeof hallazgosDe>[0];
const { frenoDelCandado } = await import('../channels/candado.js');
const { getDb } = await import('../rag/store.js');
const { Hono } = await import('hono');
const { mountAdmin } = await import('../channels/admin.js');
const { cargar } = await import('../crm/demo.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};
const raiz = new URL('../../', import.meta.url);
const js = readFileSync(new URL('public/admin.js', raiz), 'utf8');
const html = readFileSync(new URL('public/admin.html', raiz), 'utf8');
const modulo = readFileSync(new URL('src/crm/optimizacion.ts', raiz), 'utf8');

/** Unas entradas en cero: ninguna regla tiene de qué hablar. */
const cero = (): Entradas => ({
  dias: 30,
  embudo: [{ rol: 'inicio', titulo: 'Nuevo', llegaron: 0 }, { rol: 'activo', titulo: 'Conversando', llegaron: 0 }, { rol: 'interes', titulo: 'Interesado', llegaron: 0 }, { rol: 'cita', titulo: 'Cita agendada', llegaron: 0 }, { rol: 'ganado', titulo: 'Vendido', llegaron: 0 }],
  perdidasDesde: [],
  entraron: 0,
  estancados: [],
  abiertos: 0,
  velocidad: { acuerdoMin: 15, rapidos: { ganados: 0, cerrados: 0 }, lentos: { ganados: 0, cerrados: 0 } },
  tiempos: { respondidas: 0, fueraDeAcuerdo: 0, acuerdoMin: 15 },
  horas: { total: 0, pico: null, fuera: null },
  canales: [],
  campana: null,
  perdidas: { cuantas: 0, sinMotivo: 0, motivos: [] },
  seguimientos: { cuantos: 0, calientes: 0 },
  objeciones: [],
  cuidar: 0,
  verificaciones: { pendientes: 0, enTratosVivos: 0 },
  precios: { abiertos: 0, conValor: 0, catalogoSinPrecios: false },
});
const con = (cambio: (e: Entradas) => void): Entradas => { const e = cero(); cambio(e); return e; };
const uno = (e: Entradas, id: string) => hallazgosDe(e).find((h) => h.id === id);
const estancado = (n: number, valor = 0, puntaje = 20) => ({ id: `wa:${n}`, nombre: `P${n}`, canal: 'whatsapp', etapa: 'interesado', titulo: 'Interesado', rol: 'interes', diasSinActividad: 9, enEtapaDesde: 0, quien: null, valor, puntaje, resumen: null });

console.log('— Sin datos, ninguna regla habla');
check('con todo en cero no sale ningún hallazgo', hallazgosDe(cero()).length === 0, JSON.stringify(hallazgosDe(cero())));

console.log('— Dónde se caen los tratos');
const embudo = (n: number[]) => con((e) => { e.embudo.forEach((x, i) => { x.llegaron = n[i]!; }); e.entraron = n[0]!; });
const caida = uno(embudo([10, 8, 6, 1, 1]), 'embudo-caida');
check('sale la etapa que menos deja pasar, con su base', caida?.cifra === '1 de 6' && /«Interesado»/.test(caida.titulo) && /«Cita agendada»/.test(caida.titulo), JSON.stringify(caida));
check('por debajo del 30 % es prioridad alta', caida?.prioridad === 'alta');
check('y qué hacer depende de la etapa donde se quedan (fijo, no generado)', caida?.queHacer.startsWith('Muestran interés pero no dan el siguiente paso') === true);
check('entre 30 % y 60 %, media', uno(embudo([10, 8, 6, 3, 2]), 'embudo-caida')?.prioridad === 'media');
check('si todas pasan del 60 %, no hay caída que contar', !uno(embudo([10, 8, 6, 5, 4]), 'embudo-caida'));
const poquitos = hallazgosDe(embudo([4, 3, 1, 0, 0]));
check(`🪤 con menos de ${UMBRAL.baseEmbudo} en una etapa no se juzga: sale «poca evidencia» y dice cuántos faltan`, !poquitos.some((h) => h.id === 'embudo-caida') && poquitos.find((h) => h.id === 'embudo-poca')?.evidencia === 'poca' && /hacen falta 5/.test(poquitos.find((h) => h.id === 'embudo-poca')!.base));
const conPerdidos = uno(con((e) => { e.embudo.forEach((x, i) => { x.llegaron = [10, 8, 6, 1, 1][i]!; }); e.entraron = 10; e.perdidasDesde = [{ titulo: 'Interesado', n: 3 }]; }), 'embudo-caida');
check('y dice cuántos se perdieron justo en esa etapa', /3 se perdieron justo ahí/.test(conPerdidos?.base ?? ''), conPerdidos?.base);

console.log('— Tratos estancados');
const est = uno(con((e) => { e.estancados = [estancado(1, 500000), estancado(2)]; e.abiertos = 9; }), 'estancados');
check('con su base: cuántos de los abiertos', est?.cifra === '2 de 9', est?.cifra);
check('si alguno vale algo (o está caliente), es prioridad alta', est?.prioridad === 'alta');
check('si ninguno tiene valor ni está caliente, media', uno(con((e) => { e.estancados = [estancado(1)]; e.abiertos = 3; }), 'estancados')?.prioridad === 'media');
check('el botón lleva a la lista de estancados de esta misma pantalla', est?.ir.vista === 'optimizacion' && est.ir.filtro === 'estancados');

console.log('— Velocidad de respuesta');
const vel = (r: [number, number], l: [number, number]) => con((e) => { e.velocidad.rapidos = { ganados: r[0], cerrados: r[1] }; e.velocidad.lentos = { ganados: l[0], cerrados: l[1] }; });
const v1 = uno(vel([4, 6], [1, 5]), 'velocidad');
check('con datos suficientes y diferencia de 10 puntos o más, sale con las dos bases', v1?.cifra === '4 de 6 · 1 de 5', v1?.cifra);
check('sin diferencia, no se inventa una', !uno(vel([3, 6], [3, 6]), 'velocidad'));
const vPoca = uno(vel([2, 3], [1, 2]), 'velocidad-poca');
check(`🪤 con menos de ${UMBRAL.cerradosVelocidad} cerrados lo dice («poca evidencia») en vez de concluir`, vPoca?.evidencia === 'poca' && vPoca.prioridad === 'baja' && !uno(vel([2, 3], [1, 2]), 'velocidad'));
check('con muchos rápidos pero pocos lentos, tampoco concluye', !uno(vel([8, 12], [0, 2]), 'velocidad') && Boolean(uno(vel([8, 12], [0, 2]), 'velocidad-poca')));
const sla = (resp: number, fuera: number) => uno(con((e) => { e.tiempos = { respondidas: resp, fueraDeAcuerdo: fuera, acuerdoMin: 15 }; }), 'acuerdo');
check('el acuerdo de servicio no se juzga con menos de 10 respuestas', !sla(9, 9));
check('con 20 % fuera del acuerdo, media; con 40 %, alta', sla(10, 2)?.prioridad === 'media' && sla(10, 4)?.prioridad === 'alta' && !sla(10, 1));

console.log('— Motivos, objeciones, precios');
const mot = (cuantas: number, sinMotivo: number, motivos: { motivo: string; n: number }[]) => hallazgosDe(con((e) => { e.perdidas = { cuantas, sinMotivo, motivos }; }));
check('con menos de 3 perdidos no se habla de motivos', !mot(2, 0, [{ motivo: 'Precio', n: 2 }]).some((h) => h.id === 'motivo'));
check('el motivo que más se repite, con su base', mot(5, 1, [{ motivo: 'Precio', n: 3 }, { motivo: 'Tiempo', n: 1 }]).find((h) => h.id === 'motivo')?.cifra === '3 de 5');
check('si la mitad o más no tiene motivo, eso es lo primero que hay que arreglar', mot(4, 2, []).some((h) => h.id === 'sin-motivo') && !mot(4, 1, []).some((h) => h.id === 'sin-motivo'));
check(`una objeción dicha una sola vez no «se repite»; ${UMBRAL.objecion} sí`, !uno(con((e) => { e.objeciones = [{ texto: 'caro', n: 1 }]; }), 'objecion') && uno(con((e) => { e.objeciones = [{ texto: 'caro', n: 2 }]; }), 'objecion')?.cifra === '2');
const sinPrecio = uno(con((e) => { e.precios = { abiertos: 6, conValor: 0, catalogoSinPrecios: true }; }), 'sin-precios');
check('sin un solo precio, lo dice (y no inventa una cifra en dinero)', sinPrecio?.cifra === '0 de 6' && !/\$/.test(JSON.stringify(sinPrecio)));
check('🪤 lo que se arregla en configuración va marcado: con el candado no se ofrece esa puerta', sinPrecio?.ir.soloAdmin === true && uno(con((e) => { e.objeciones = [{ texto: 'caro', n: 2 }]; }), 'objecion')?.ir.soloAdmin === true);

console.log('— Horas y canales');
const horas = (total: number, fuera: number | null) => uno(con((e) => { e.horas = { total, pico: { desde: 19, hasta: 22, n: 12 }, fuera }; }), 'horas');
check(`con menos de ${UMBRAL.mensajesHoras} mensajes no se habla de horas`, !horas(29, null));
check('sin horario declarado, solo el pico (baja)', horas(40, null)?.prioridad === 'baja' && /19:00 y las 22:00/.test(horas(40, null)!.titulo));
check('con 30 % o más fuera de horario, media; y el título no repite la cifra', horas(40, 25)?.prioridad === 'media' && horas(40, 25)?.cifra === '25 de 40' && !/25 de 40/.test(horas(40, 25)!.titulo));
check('el pico son las tres horas seguidas con más mensajes', JSON.stringify(picoDeHoras([8, 9, 10, 11, 12], [[1], [0], [5], [6], [2]])) === JSON.stringify({ desde: 10, hasta: 13, n: 13 }));
const canales = (a: [number, number], b: [number, number]) => uno(con((e) => { e.canales = [{ canal: 'whatsapp', nombre: 'WhatsApp', contactos: a[0], ganados: a[1] }, { canal: 'web', nombre: 'el chat del sitio', contactos: b[0], ganados: b[1] }]; }), 'canales');
check('dos canales con gente de sobra y 10 puntos de diferencia: dice cuál convierte más, con las dos bases', canales([12, 4], [10, 1])?.cifra === '4 de 12 · 1 de 10');
check(`con menos de ${UMBRAL.porCanal} contactos en un canal no se compara`, !canales([12, 4], [4, 0]));

console.log('— Orden, base y nada inventado');
const todo = hallazgosDe(con((e) => {
  e.embudo.forEach((x, i) => { x.llegaron = [10, 8, 6, 1, 1][i]!; }); e.entraron = 10;
  e.estancados = [estancado(1, 0, 70)]; e.abiertos = 5;
  e.seguimientos = { cuantos: 4, calientes: 0 };
  e.verificaciones = { pendientes: 2, enTratosVivos: 0 };
  e.velocidad.rapidos = { ganados: 1, cerrados: 2 };
  e.perdidas = { cuantas: 5, sinMotivo: 3, motivos: [{ motivo: 'Precio', n: 2 }] };
  e.horas = { total: 40, pico: { desde: 10, hasta: 13, n: 20 }, fuera: null };
}));
const rango = { alta: 0, media: 1, baja: 2 } as const;
check('alta, después media, después baja', todo.every((h, i) => !i || rango[todo[i - 1]!.prioridad] <= rango[h.prioridad]), todo.map((h) => h.prioridad).join(','));
check('dentro de la misma prioridad, lo de poca evidencia va al final', todo.filter((h) => h.prioridad === 'baja').map((h) => h.evidencia).join(',') === 'suficiente,poca', todo.map((h) => `${h.id}:${h.evidencia}`).join(','));
check('mismas entradas, mismo orden (sin azar)', JSON.stringify(todo) === JSON.stringify(hallazgosDe(con((e) => {
  e.embudo.forEach((x, i) => { x.llegaron = [10, 8, 6, 1, 1][i]!; }); e.entraron = 10;
  e.estancados = [estancado(1, 0, 70)]; e.abiertos = 5;
  e.seguimientos = { cuantos: 4, calientes: 0 };
  e.verificaciones = { pendientes: 2, enTratosVivos: 0 };
  e.velocidad.rapidos = { ganados: 1, cerrados: 2 };
  e.perdidas = { cuantas: 5, sinMotivo: 3, motivos: [{ motivo: 'Precio', n: 2 }] };
  e.horas = { total: 40, pico: { desde: 10, hasta: 13, n: 20 }, fuera: null };
}))));
check('cada hallazgo trae su cifra, su base, por qué importa, qué hacer y adónde ir', todo.every((h) => h.cifra && h.base && h.porQue && h.queHacer && h.ir.vista && h.ir.etiqueta));
check('🪤 ninguno trae «NaN», «undefined» ni «Infinity» (una división por cero se ve así)', !/NaN|undefined|Infinity/.test(JSON.stringify(todo)));
const vistas = [...new Set(todo.concat(hallazgosDe(con((e) => { e.precios = { abiertos: 1, conValor: 0, catalogoSinPrecios: false }; e.objeciones = [{ texto: 'x', n: 3 }]; e.cuidar = 1; }))).map((h) => h.ir.vista))];
check('cada botón lleva a una pantalla que existe', vistas.every((v) => html.includes(`id="view-${v}"`)), vistas.join(','));
check('🪤 sin modelo: el módulo no llama a ningún motor ni a la red', !/from '\.\.\/llm\//.test(modulo) && !/fetch\(/.test(modulo));

console.log('— La ruta, con datos de verdad');
const app = new Hono();
mountAdmin(app as never);
const T = { 'x-admin-token': process.env.ADMIN_TOKEN!, 'content-type': 'application/json' };
const pedir = async (ruta: string, extra: Record<string, string> = {}) => app.request(`/admin/api${ruta}`, { headers: { ...T, ...extra } });
const vacio = (await (await pedir('/optimizacion')).json()) as { sinDatos: boolean; hallazgos: unknown[]; estancados: unknown[] };
check('sin conversaciones: lo dice (sinDatos) y no saca conclusiones', vacio.sinDatos === true && vacio.hallazgos.length === 0 && vacio.estancados.length === 0);
const ahora = Date.now();
const persona = (id: string, name: string, stage: string, minutos: number, extra: Record<string, unknown> = {}) => ({
  id, name, stage, sentiment: 'neutral', lastMinutesAgo: minutos, unread: 0, summary: `${name} preguntó por un traje.`, data: { servicio: 'alquiler premium', ...((extra.data as object) ?? {}) },
  signals: { interes: 2, sentimiento: 'neutral', tiene_objecion: false, objecion: '' },
  messages: [{ role: 'user', text: 'Hola' }, { role: 'assistant', text: '¡Hola! ¿En qué te ayudo?' }],
  ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== 'data')),
});
const semilla = join(carpeta, 'semilla.json');
writeFileSync(semilla, JSON.stringify([
  persona('573000000001', 'Quieto Con Valor', 'interesado', 10 * 1440, { data: { valor: 800000 } }),
  persona('573000000002', 'Quieto Sin Valor', 'conversando', 9 * 1440),
  persona('573000000003', 'Quieto Con Cita', 'interesado', 12 * 1440, { appointmentInHours: 30 }),
  persona('573000000004', 'Quieto Pospuesto', 'interesado', 11 * 1440, { data: { pospuesto_hasta: ahora + 5 * 86400_000, pospuesto_desde: ahora - 60_000 } }),
  persona('573000000005', 'Reciente', 'interesado', 60),
  persona('573000000006', 'Ya Compró', 'vendido', 20 * 1440, { data: { valor: 500000 } }),
]));
cargar({ archivo: semilla });
const r = (await (await pedir('/optimizacion?dias=30')).json()) as { dias: number; sinDatos: boolean; estancados: { nombre: string; diasSinActividad: number; valor: number }[]; estancadosTotal: number; impacto: { estancados: { valor: number; conValor: number; cuantos: number } | null }; hallazgos: { id: string }[]; resumen: { hallazgos: number } };
const nombres = r.estancados.map((x) => x.nombre);
check('estancados: los abiertos quietos hace 7 días o más', nombres.includes('Quieto Con Valor') && nombres.includes('Quieto Sin Valor'), nombres.join(', '));
check('🪤 no cuenta al que tiene cita por delante, ni al que dejaron «por ahora», ni al reciente, ni al que ya compró', !nombres.some((n) => /Con Cita|Pospuesto|Reciente|Compró/.test(n)), nombres.join(', '));
check('primero el que vale más', nombres[0] === 'Quieto Con Valor');
check('cuántos días lleva quieto, en días enteros', r.estancados.every((x) => x.diasSinActividad >= 9 && Number.isInteger(x.diasSinActividad)));
check('el impacto suma solo lo que tiene precio, y dice de cuántos', r.impacto.estancados?.valor === 800000 && r.impacto.estancados.conValor === 1 && r.impacto.estancados.cuantos === 2, JSON.stringify(r.impacto));
check('y sale el hallazgo de los estancados', r.hallazgos.some((h) => h.id === 'estancados') && r.resumen.hallazgos === r.hallazgos.length);
const corto = (await (await pedir('/optimizacion?dias=1')).json()) as { dias: number };
const largo = (await (await pedir('/optimizacion?dias=99999')).json()) as { dias: number };
const raro = (await (await pedir('/optimizacion?dias=abc')).json()) as { dias: number };
check('el periodo se acota: de 7 a 365 días, y lo que no es número vale 30', corto.dias === 7 && largo.dias === 365 && raro.dias === 30, `${corto.dias} ${largo.dias} ${raro.dias}`);

console.log('— /ventas y /seguimientos cuentan igual después de mudar su cálculo');
const ven = (await (await pedir('/ventas?days=90')).json()) as Record<string, unknown> & { ventas: { nombre: string }[]; perdidas: Record<string, unknown> };
check('/ventas trae lo de siempre', ['dias', 'total', 'cuantas', 'sinPrecio', 'promedio', 'ventas', 'perdidas'].every((k) => k in ven) && ven.cuantas === 1 && ven.total === 500000 && ['cuantas', 'sinMotivo', 'motivos'].every((k) => k in ven.perdidas), JSON.stringify(ven).slice(0, 300));
const seg = (await (await pedir('/seguimientos')).json()) as { cuantos: number; calientes: number; seguimientos: { nombre: string }[] };
check('/seguimientos trae lo de siempre (sin la cita ni el pospuesto)', seg.cuantos === seg.seguimientos.length && !seg.seguimientos.some((x) => /Con Cita|Pospuesto/.test(x.nombre)) && seg.seguimientos.some((x) => x.nombre === 'Quieto Con Valor'), JSON.stringify(seg.seguimientos.map((x) => x.nombre)));
check('los dos salen del mismo sitio que la optimización (crm/resultados.ts)', /ventasDelPeriodo\(/.test(modulo) && /seguimientosPendientes\(/.test(modulo));

console.log('— El candado la deja leer');
check('es lectura del que vende: el candado no la cierra', frenoDelCandado('optimizacion', 'GET', 'asesor', 'facil') === null);
await app.request('/admin/api/tablero/modo', { method: 'PUT', headers: { ...T, 'x-xencrm-rol': 'super' }, body: JSON.stringify({ modo: 'facil' }) });
check('y el servidor la abre de verdad a un asesor con el candado puesto', (await pedir('/optimizacion', { 'x-xencrm-rol': 'asesor' })).status === 200);
const consola = readFileSync(new URL('src/consola.ts', raiz), 'utf8');
const soloSuper = new RegExp(/const SOLO_SUPER = \/(.+)\/;/.exec(consola)?.[1] ?? 'x^');
check('ni la consola se la cierra a quien no es super-admin', !soloSuper.test('optimizacion'));
check('Optimización está en lo que lee la pantalla en test:facil', /optimizacion: \['optimizacion'\]/.test(readFileSync(new URL('src/eval/facil.ts', raiz), 'utf8')));

console.log('— La pantalla');
const inicio = js.indexOf('// ===== XEN · Optimización de ventas');
const pantalla = js.slice(inicio, js.indexOf('// (fin de XEN · Optimización de ventas)', inicio));
const estilos = html.slice(html.indexOf('/* ---------- XEN · Optimización de ventas'), html.indexOf('/* (fin de XEN · Optimización de ventas) */'));
check('se carga sola al abrirse (alAbrir), sin tocar go()', /alAbrir\('optimizacion', cargarOptimizacion\)/.test(pantalla));
check('cargando: la forma de lo que viene, escondida al lector de pantalla, y aria-busy', /xoEsqueleto\(\)/.test(pantalla) && /xo-esq" aria-hidden="true"/.test(pantalla) && /setAttribute\('aria-busy', 'true'\)/.test(pantalla));
check('error: dice qué pasó y deja volver a intentar', /No se pudo revisar dónde se pierden ventas/.test(pantalla) && /Volver a intentar/.test(pantalla) && /role="alert"/.test(pantalla));
check('vacío: explica qué necesita y adónde ir', /Todavía no hay de qué sacar conclusiones/.test(pantalla) && /Ir a la bandeja/.test(pantalla));
check('sin hallazgos con datos: lo dice, no deja la caja en blanco', /Nada que corregir con lo que hay/.test(pantalla));
check('la prioridad se dice con palabra (no solo con el color)', /Prioridad ' \+ p\.t/.test(pantalla) && /'Poca evidencia'|>Poca evidencia</.test(pantalla));
check('cada cifra va con su base en pantalla', /xo-cifra"><b>' \+ esc\(h\.cifra\) \+ '<\/b><span>' \+ esc\(h\.base\)/.test(pantalla));
check('el impacto solo cuando hay precio; sin precio, «Sin cifra» (nunca «$0»)', /Sin cifra/.test(pantalla) && !/'\$0|\$0'/.test(pantalla));
check('Retomar abre la conversación, como en la Lista de trabajo', /go\('inbox'\); openContact\(b\.getAttribute\('data-xo-retomar'\)\)/.test(pantalla));
check('🪤 con el candado no se ofrece una puerta a configuración', /ir\.soloAdmin && enCandado\(\)/.test(pantalla) && /Esto lo hace quien administra XENCRM/.test(pantalla));
check('🪤 «Ver los estancados» desplaza solo su caja (scrollIntoView movía el marco entero)', !/\.scrollIntoView\(/.test(pantalla) && /caja\.scrollTo\(/.test(pantalla));
check('🪤 no lleva el violeta de la IA: son reglas, no lo dice un modelo', !/var\(--fx-(ia|violeta)/.test(estilos) && !/fx-ia|fx-violeta/.test(pantalla));
check('respeta el movimiento reducido', /prefers-reduced-motion:reduce/.test(estilos));
check('en el celular la tabla de estancados se vuelve tarjetas y los botones miden 44 px', /max-width:700px/.test(estilos) && /data-th/.test(estilos) && /min-height:44px/.test(estilos));
check('el periodo: 7, 30 y 90 días, con aria-pressed', /id="xo-dias"/.test(html) && /data-d="7"[^>]*aria-pressed/.test(html) && /setAttribute\('aria-pressed'/.test(pantalla));

getDb().close();
process.exit(fail ? 1 : 0);
