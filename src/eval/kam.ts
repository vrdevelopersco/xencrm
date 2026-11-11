// Pruebas del panel de cuentas clave (KAM), sin modelo: pnpm test:kam
//
// Lo delicado: que la salud se pueda explicar (cada «En riesgo» con su porqué, nunca una caja negra), que las
// candidatas salgan de reglas claras y no se marquen solas, que nada se invente (sin precio, «—»; sin análisis, sin
// ánimo), que el candado deje marcar a quien vende, y que borrar, unir o anonimizar una ficha se lleve la marca.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'xencrm-kam-')), 'xencrm.db');
process.env.ADMIN_TOKEN = 'token-del-tablero-de-prueba-0123456789';
const { touchUser, appendMessage } = await import('../agent/memory.js');
const { updateContact, setStage, setResponsable, etapaCon, deleteContact, getContact } = await import('../crm/contacts.js');
const kam = await import('../crm/cuentas-clave.js');
const { mergeContacts } = await import('../crm/merge.js');
const { anonimizar, borrarDelTodo } = await import('../crm/retencion.js');
const { getDb } = await import('../rag/store.js');
const { frenoDelCandado } = await import('../channels/candado.js');
const { Hono } = await import('hono');
const { mountAdmin } = await import('../channels/admin.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};
const DIA = 86400_000;
const now = Date.now();
const paso = (tipo: string, cuando: number | null = null) => ({ tipo: tipo as never, texto: '', urgente: false, cuando });
const base = { now, ultima: now - 2 * DIA, animo: 'neutral' as const, paso: paso('atiende'), responsable: 'Laura', etapaRol: 'activo', falto: 0, proximaCita: null };

console.log('— La salud se explica: reglas, no una caja negra');
const sana = kam.saludDe(base);
check('habló hace poco, tiene KAM y nada espera: Sana', sana.salud === 'sana', JSON.stringify(sana));
check('y «Sana» también dice por qué (no es un silencio)', sana.motivos.some((m) => m.nivel === 'bien' && /Habló hace 2 días/.test(m.texto)), JSON.stringify(sana.motivos));
const molesto = kam.saludDe({ ...base, animo: 'negativo' });
check('molesto en su último análisis: En riesgo, y lo dice', molesto.salud === 'riesgo' && molesto.motivos.some((m) => m.nivel === 'riesgo' && /Molesto/.test(m.texto)));
const sinRespuesta = kam.saludDe({ ...base, paso: paso('responder', now - 30 * 3600_000) });
check('escribió hace más de un día y nadie contestó: En riesgo', sinRespuesta.salud === 'riesgo' && sinRespuesta.motivos.some((m) => /nadie le ha contestado/.test(m.texto)), JSON.stringify(sinRespuesta.motivos));
const reciente = kam.saludDe({ ...base, paso: paso('responder', now - 2 * 3600_000) });
check('escribió hace dos horas: Atención (todavía no es riesgo)', reciente.salud === 'atencion' && reciente.motivos.some((m) => /falta contestarle/.test(m.texto)));
check('🪤 el silencio no se cuenta dos veces si ya espera respuesta', !reciente.motivos.some((m) => /sin hablar/.test(m.texto)));
check(`${kam.DIAS_ATENCION} días callada: Atención`, kam.saludDe({ ...base, ultima: now - (kam.DIAS_ATENCION + 1) * DIA }).salud === 'atencion');
check(`${kam.DIAS_RIESGO} días callada: En riesgo`, kam.saludDe({ ...base, ultima: now - (kam.DIAS_RIESGO + 1) * DIA }).salud === 'riesgo');
check('sin KAM: Atención, «Nadie la tiene asignada»', kam.saludDe({ ...base, responsable: null }).motivos.some((m) => m.nivel === 'atencion' && m.texto === 'Nadie la tiene asignada'));
check('«bot» o «equipo» no son un KAM', kam.saludDe({ ...base, responsable: 'equipo' }).salud === 'atencion');
check('el último trato perdido: En riesgo', kam.saludDe({ ...base, etapaRol: 'perdido' }).salud === 'riesgo');
check('faltó a una cita y no tiene otra: Atención', kam.saludDe({ ...base, falto: 1 }).motivos.some((m) => /Faltó a una cita/.test(m.texto)));
check('pero con otra cita por delante, no', !kam.saludDe({ ...base, falto: 1, proximaCita: now + DIA }).motivos.some((m) => /Faltó/.test(m.texto)));
const casos = [base, { ...base, animo: 'negativo' as const }, { ...base, responsable: null }, { ...base, ultima: null }, { ...base, ultima: now - 60 * DIA }, { ...base, paso: paso('persona') }];
check('🪤 ninguna salud distinta de Sana sale sin al menos un motivo de su nivel', casos.every((x) => {
  const s = kam.saludDe(x);
  return s.salud === 'sana' || s.motivos.some((m) => m.nivel === s.salud);
}));

console.log('— Las candidatas salen de reglas claras');
const cand = (x: Partial<Parameters<typeof kam.porQueCandidata>[0]>) => kam.porQueCandidata({ etapaRol: 'activo', volvio: 0, citasCumplidas: 0, proximaCita: null, scoreBase: 0, valor: 0, valorAlto: null, ...x });
check('compró y volvió', cand({ etapaRol: 'ganado', volvio: 1 }).join() === 'Compró y volvió');
check('ya compró', cand({ etapaRol: 'ganado' }).join() === 'Ya compró');
check('caliente y con cita', cand({ scoreBase: 70, proximaCita: now + DIA }).includes('Caliente y con cita'));
check('vino a su cita', cand({ citasCumplidas: 1 }).includes('Vino a su cita'));
check('un curioso sin nada de eso no es candidata', cand({ scoreBase: 20 }).length === 0);
check('🪤 un trato perdido no se propone', cand({ etapaRol: 'perdido', volvio: 3, citasCumplidas: 2 }).length === 0);
check('«de mayor valor» solo con al menos 4 precios (con menos sería azar)', kam.umbralDeValorAlto([100, 200, 300]) === null && kam.umbralDeValorAlto([100, 200, 300, 400]) === 400);
check('y sin precio no cuenta como de mayor valor', !cand({ valor: 0, valorAlto: 0 }).includes('Entre el 25 % de mayor valor'));

console.log('— Marcar, la nota y la base');
const id = (i: number) => `wa:5730100000${String(i).padStart(2, '0')}@s.whatsapp.net`;
for (let i = 1; i <= 9; i++) {
  touchUser(id(i), 'whatsapp', `Cliente ${i}`);
  appendMessage(id(i), 'user', 'hola, ¿tienen trajes?', 'consulta');
}
const ganado = etapaCon('ganado')!;
setStage(id(2), ganado, { by: 'Laura' });
setResponsable(id(1), 'Laura', 'Laura');
check('una ficha que no existe no se marca', (() => { try { kam.marcarCuentaClave('wa:nadie@s.whatsapp.net', true, 'Laura'); return false; } catch { return true; } })());
const k1 = kam.marcarCuentaClave(id(1), true, 'Laura', now - 5 * DIA);
check('marcar guarda quién y cuándo', k1?.por === 'Laura' && k1.desde === now - 5 * DIA);
kam.marcarCuentaClave(id(1), true, 'Pedro');
check('marcar dos veces no cambia quién la marcó', kam.esCuentaClave(id(1))?.por === 'Laura');
check('la nota sin ser cuenta clave se rechaza', (() => { try { kam.notaDeCuenta(id(3), 'algo', 'Laura'); return false; } catch { return true; } })());
check(`la nota va hasta ${kam.MAX_NOTA} letras`, (() => { try { kam.notaDeCuenta(id(1), 'x'.repeat(kam.MAX_NOTA + 1), 'Laura'); return false; } catch { return true; } })());
kam.notaDeCuenta(id(1), '  Boda en diciembre: trae a sus 4 padrinos.  ', 'Laura');
check('la nota se guarda limpia, con quién la escribió', kam.esCuentaClave(id(1))?.nota === 'Boda en diciembre: trae a sus 4 padrinos.' && kam.esCuentaClave(id(1))?.notaPor === 'Laura');
const eventos = getDb().prepare("SELECT payload FROM events WHERE user_id = ? AND type = 'cuenta_clave'").all(id(1)) as { payload: string }[];
check('la historia de la ficha lo cuenta una vez, con su nombre', eventos.length === 1 && JSON.parse(eventos[0]!.payload).by === 'Laura', JSON.stringify(eventos));

console.log('— El panel');
kam.marcarCuentaClave(id(2), true, 'Laura');
const p = kam.panelKam(now);
check('trae las dos cuentas', p.cuentas.length === 2 && p.cifras.cuentas === 2);
const c1 = p.cuentas.find((x) => x.id === id(1))!;
check('su KAM es el «Asignado a» de la ficha', c1.kam === 'Laura' && p.cuentas.find((x) => x.id === id(2))!.kam === null);
check('sin KAM se cuenta arriba', p.cifras.sinKam === 1);
check('🪤 sin precios, el valor es 0 (la pantalla dice «—»), nunca inventado', p.cuentas.every((x) => x.valor === 0) && p.cifras.valor === 0 && p.cifras.conValor === 0);
check('sin análisis no hay ánimo (null, no «neutral»)', c1.animo === null);
check('la que compró dice «vendido»', p.cuentas.find((x) => x.id === id(2))!.vendido === true);
check('cada cuenta trae su salud y sus motivos', p.cuentas.every((x) => ['sana', 'atencion', 'riesgo'].includes(x.salud) && x.motivos.length > 0));
check('lo que más preocupa va arriba', p.cuentas.every((x, i, l) => i === 0 || ({ riesgo: 0, atencion: 1, sana: 2 } as const)[l[i - 1]!.salud] <= ({ riesgo: 0, atencion: 1, sana: 2 } as const)[x.salud]));
check('el equipo para asignar sale de quienes ya llevan algo', p.equipo.includes('Laura'));
check('las candidatas no incluyen las que ya son cuenta clave', !p.candidatas.some((x) => x.id === id(1) || x.id === id(2)));
setStage(id(3), ganado, { by: 'Laura' });
check('una que compró sale como candidata, con su porqué', kam.panelKam(now).candidatas.some((x) => x.id === id(3) && x.motivos.includes('Ya compró')));
updateContact(id(4), { data: { valor: 900000 } }, { silent: true });
for (const [i, v] of [[5, 100000], [6, 200000], [7, 300000]] as const) updateContact(id(i), { data: { valor: v } }, { silent: true });
check('con 4 precios, la de mayor valor sale como candidata', kam.panelKam(now).candidatas.some((x) => x.id === id(4) && x.motivos.includes('Entre el 25 % de mayor valor')));
check('no se marcan solas: proponerlas no las vuelve cuenta clave', kam.esCuentaClave(id(3)) === null && kam.esCuentaClave(id(4)) === null);

console.log('— Borrar, unir y anonimizar se llevan la marca');
kam.marcarCuentaClave(id(5), true, 'Laura');
deleteContact(id(5));
check('borrar la ficha borra la marca', kam.esCuentaClave(id(5)) === null);
kam.marcarCuentaClave(id(6), true, 'Laura');
kam.notaDeCuenta(id(6), 'Plan de la otra ficha', 'Pedro');
mergeContacts(id(1), id(6), 'Laura');
check('🪤 unir dos cuentas clave no choca: queda una, con los dos planes', kam.esCuentaClave(id(6)) === null && /Boda en diciembre[\s\S]*Plan de la otra ficha/.test(kam.esCuentaClave(id(1))?.nota ?? ''), kam.esCuentaClave(id(1))?.nota);
kam.marcarCuentaClave(id(7), true, 'Laura');
mergeContacts(id(8), id(7), 'Laura');
check('si solo la que se va era cuenta clave, la que queda pasa a serlo', kam.esCuentaClave(id(8))?.por === 'Laura' && kam.esCuentaClave(id(7)) === null);
kam.notaDeCuenta(id(8), 'nota con datos de la persona', 'Laura');
const nuevo = anonimizar(id(8));
check('🪤 anonimizar se lleva la marca y su plan (es texto sobre la persona)', Boolean(nuevo) && !getDb().prepare('SELECT 1 FROM cuentas_clave WHERE user_id IN (?, ?)').get(id(8), nuevo!));
kam.marcarCuentaClave(id(9), true, 'Laura');
borrarDelTodo(id(9));
check('borrarla del todo también', kam.esCuentaClave(id(9)) === null);
check('y la tabla existe desde el arranque (si no, no se podría limpiar)', Boolean(getDb().prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cuentas_clave'").get()));

console.log('— Las rutas y el candado');
const app = new Hono();
mountAdmin(app as never);
const T = { 'x-admin-token': process.env.ADMIN_TOKEN!, 'content-type': 'application/json' };
const pedir = (ruta: string, init: RequestInit = {}) => app.request('/admin/api/' + ruta, { ...init, headers: { ...T, ...(init.headers ?? {}) } });
const r = await pedir('cuentas-clave');
const panel = (await r.json()) as { cuentas: { id: string }[]; candidatas: unknown[]; cifras: { cuentas: number }; moneda: string; umbrales: { diasAtencion: number } };
check('GET cuentas-clave trae el panel entero', r.status === 200 && Array.isArray(panel.cuentas) && Array.isArray(panel.candidatas) && typeof panel.cifras.cuentas === 'number' && Boolean(panel.moneda) && panel.umbrales.diasAtencion === kam.DIAS_ATENCION);
const ruta = `contacts/${encodeURIComponent(id(4))}/cuenta-clave`;
const m1 = await pedir(ruta, { method: 'PUT', body: JSON.stringify({ on: true }), headers: { 'x-xencrm-quien': 'Ana' } });
check('marcar por la ruta, con el nombre de quien lo hizo', m1.status === 200 && ((await m1.json()) as { cuenta: { por: string } }).cuenta.por === 'Ana');
const m2 = await pedir(ruta, { method: 'PUT', body: JSON.stringify({ nota: 'Llamarlo antes del 1 de diciembre' }) });
check('la nota por la ruta', m2.status === 200 && kam.esCuentaClave(id(4))?.nota === 'Llamarlo antes del 1 de diciembre');
const m3 = await pedir(ruta, { method: 'PUT', body: JSON.stringify({ nota: 'y'.repeat(kam.MAX_NOTA + 5) }) });
check('una nota muy larga se rechaza con 400 y la anterior se queda', m3.status === 400 && kam.esCuentaClave(id(4))?.nota === 'Llamarlo antes del 1 de diciembre');
check('sin qué cambiar, 400', (await pedir(ruta, { method: 'PUT', body: '{}' })).status === 400);
check('una ficha que no existe, 404', (await pedir('contacts/wa%3Anadie/cuenta-clave', { method: 'PUT', body: JSON.stringify({ on: true }) })).status === 404);
const det = (await (await pedir(`contacts/${encodeURIComponent(id(4))}`)).json()) as { cuentaClave: { por: string } | null };
check('la ficha dice si es cuenta clave', det.cuentaClave?.por === 'Ana');
const m4 = await pedir(ruta, { method: 'PUT', body: JSON.stringify({ on: false }) });
check('quitar la marca', m4.status === 200 && ((await m4.json()) as { cuenta: unknown }).cuenta === null && kam.esCuentaClave(id(4)) === null);
check('sin el token del tablero no se lee ni se marca', (await app.request('/admin/api/cuentas-clave')).status === 401 && (await app.request('/admin/api/' + ruta, { method: 'PUT', body: '{}' })).status === 401);
check('🪤 con el candado, el que vende lee el panel', frenoDelCandado('cuentas-clave', 'GET', 'asesor', 'facil') === null && frenoDelCandado('cuentas-clave', 'GET', 'admin', 'facil') === null);
check('🪤 y marca y escribe el plan (es del día a día, como asignar)', frenoDelCandado('contacts/x/cuenta-clave', 'PUT', 'asesor', 'facil') === null);
check('pero no cualquier ruta parecida: borrar sigue cerrado', frenoDelCandado('contacts/x/cuenta-clave', 'DELETE', 'asesor', 'facil') !== null);

console.log('— La pantalla');
const html = readFileSync(new URL('../../public/admin.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../../public/admin.js', import.meta.url), 'utf8');
const ancla = js.slice(js.indexOf('// ===== XEN · Panel KAM'), js.indexOf('// (fin de XEN · Panel KAM)'));
const css = html.slice(html.indexOf('/* ---------- XEN · Panel KAM'), html.indexOf('/* (fin de XEN · Panel KAM) */'));
check('la pantalla se carga sola al abrirse', /alAbrir\('kam'/.test(ancla));
check('lee el panel de su ruta', /api\('\/cuentas-clave'\)/.test(ancla));
check('🪤 sin valor dice «—», nunca «$0»', /'—'/.test(ancla) && !/'\$0'/.test(ancla));
check('la salud siempre con su palabra y su porqué a un toque', /Sana/.test(ancla) && /Atención/.test(ancla) && /En riesgo/.test(ancla) && /aria-expanded/.test(ancla));
check('el ánimo y el interés con emoji Y palabra (el emoji no se lee)', /aria-hidden="true">/.test(ancla) && /Contento/.test(ancla) && /Molesto/.test(ancla) && /Quiere comprar/.test(ancla));
check('el vacío explica qué es una cuenta clave', /qué es una cuenta clave|Una cuenta clave es/i.test(ancla));
check('🪤 la nota no se borra si guardar falla', /no se guardó/i.test(ancla));
check('la ficha tiene su botón de cuenta clave', /id="pf-clave"|'pf-clave'/.test(html + js));
check('todo el CSS va detrás de la piel', css.length > 500 && css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((r) => r.split('{')[0]!.trim()).filter((s) => s && !s.startsWith('@')).every((s) => s.split(',').every((x) => /^(:root\[data-piel="xen"\]|\.xk-)/.test(x.trim()) || /^\d|^from|^to/.test(x.trim()))));
check('🪤 ningún color suelto en la pantalla (todo sale de los tokens)', !/#[0-9a-fA-F]{3,6}\b/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')));

console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
void getContact;
process.exit(fail ? 1 : 0);
