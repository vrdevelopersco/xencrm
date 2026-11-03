// Pruebas de la ficha de cada persona y de la entrada directa al tablero, sin modelo: pnpm test:ficha
//
// DUNOR mandó un audio (2026-11-03): «modificar contacto» solo dejaba nombre y teléfono, y necesitan el correo, el
// WhatsApp, el Instagram, el Facebook y por dónde los contactó; y que al entrar aparezca el tablero, sin pasar por
// otra página. Aquí se prueba que se guarda bien, que el análisis no pisa lo que escribe el equipo, que se busca y se
// exporta, que el tablero lo enseña y lo deja corregir, y que quien lleva un solo cliente entra directo.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'aiva-ficha-')), 'aiva.db');
process.env.ADMIN_TOKEN = 'token-del-tablero-de-prueba-0123456789';
const { business } = await import('../config.js');
const { touchUser, appendMessage } = await import('../agent/memory.js');
const { getContact, listContacts, listEvents } = await import('../crm/contacts.js');
const { normalizar, aplicarFicha, camposEditables, escritosAMano } = await import('../crm/ficha.js');
const { contactsCsv } = await import('../crm/export.js');
const { Hono } = await import('hono');
const { mountAdmin } = await import('../channels/admin.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};
const valor = (k: string, v: unknown) => {
  const r = normalizar(k, v);
  return 'error' in r ? `ERROR: ${r.error}` : r.valor;
};

console.log('— Cada dato, limpio como se escriba');
check('el correo queda en minúscula', valor('correo', '  Juan.Perez@Gmail.COM ') === 'juan.perez@gmail.com', valor('correo', '  Juan.Perez@Gmail.COM '));
check('un correo sin arroba no es un correo', /^ERROR/.test(valor('correo', 'juanperez.gmail.com')));
check('el Instagram con @, con el enlace del perfil o con espacios queda en el usuario',
  valor('instagram', '@juan.p') === 'juan.p' && valor('instagram', 'https://www.instagram.com/juan.p/?hl=es') === 'juan.p' && valor('instagram', ' instagram.com/Juan_P ') === 'Juan_P');
check('un Instagram con espacios en medio no es un usuario', /^ERROR/.test(valor('instagram', 'juan perez')));
check('Facebook: el enlace queda en el usuario', valor('facebook', 'https://m.facebook.com/juan.perez.92') === 'juan.perez.92');
check('🪤 y un perfil sin usuario conserva su número (lo que sobra al limpiar ES el perfil)', valor('facebook', 'https://www.facebook.com/profile.php?id=100012345678') === 'profile.php?id=100012345678');
check('en Facebook también vale el nombre como aparece, con espacios', valor('facebook', 'Juan Pérez Gómez') === 'Juan Pérez Gómez');
check('el WhatsApp queda en dígitos, con su + si lo traía', valor('whatsapp', '+57 300 123-4567') === '+573001234567' && valor('whatsapp', '300 123 4567') === '3001234567');
check('un WhatsApp de cuatro dígitos no es un número', /^ERROR/.test(valor('whatsapp', '1234')));
check('«Nos contactó por» acepta las opciones del negocio, sin importar mayúsculas', valor('contacto_por', 'instagram') === 'Instagram');
check('y no inventa otras', /^ERROR/.test(valor('contacto_por', 'TikTok')));
check('vacío es «no lo sé», no un error', valor('correo', '  ') === '' && valor('instagram', '') === '');
check('un dato del negocio va hasta 300 letras', valor('talla_o_medidas', 'pecho 100') === 'pecho 100' && /^ERROR/.test(valor('talla_o_medidas', 'x'.repeat(301))));

console.log('— Lo que escribe el equipo queda marcado');
const r1 = aplicarFicha({ servicio: 'alquiler', correo: 'viejo@x.co' }, { correo: 'Nuevo@X.co', instagram: '@ana.c', facebook: '' });
check('se pone, y dice qué cambió en palabras de la historia', !('error' in r1) && r1.data.correo === 'nuevo@x.co' && r1.data.instagram === 'ana.c' && JSON.stringify(r1.cambiados) === '["correo","Instagram"]', JSON.stringify(r1));
check('lo que se escribió queda en _amano; lo que vino igual, no', !('error' in r1) && JSON.stringify([...escritosAMano(r1.data)].sort()) === '["correo","instagram"]', JSON.stringify(!('error' in r1) && r1.data._amano));
check('lo que no se tocó se queda', !('error' in r1) && r1.data.servicio === 'alquiler');
const r2 = aplicarFicha({ correo: 'mal@x.co' }, { correo: '' });
check('🪤 borrar un dato también lo marca: si estaba mal, que el análisis no lo vuelva a poner', !('error' in r2) && !('correo' in r2.data) && escritosAMano(r2.data).has('correo'));
check('un campo que no es de la ficha no entra', 'error' in aplicarFicha({}, { puntaje: 99 }));
check('🪤 con un error no se guarda nada: un formulario se guarda entero o no se guarda', 'error' in aplicarFicha({}, { instagram: '@bien', correo: 'mal' }));
check('se editan lo de contacto y lo que capta este negocio', ['correo', 'whatsapp', 'instagram', 'facebook', 'contacto_por', ...business.crm.fields.map((f) => f.name)].every((k) => camposEditables().includes(k)), camposEditables().join(', '));
const analizador = readFileSync(new URL('../crm/analyzer.ts', import.meta.url), 'utf8');
check('🪤 el análisis no pisa lo escrito a mano (si no, cada análisis deshacía la corrección)', /if \(v && !aMano\.has\(k\)\) data\[k\] = v;/.test(analizador) && /if \(rules\.correo && !aMano\.has\('correo'\)\) data\.correo = rules\.correo;/.test(analizador));

console.log('— El servidor');
const app = new Hono();
mountAdmin(app as never);
const T = { 'x-admin-token': process.env.ADMIN_TOKEN!, 'content-type': 'application/json', 'x-aiva-quien': 'Bryan' };
const pedir = (ruta: string, init: { method?: string; body?: unknown; rol?: string } = {}) =>
  app.request(`/admin/api${ruta}`, { method: init.method ?? 'GET', headers: init.rol ? { ...T, 'x-aiva-rol': init.rol } : T, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
const id = 'wa:573001234567@s.whatsapp.net', enc = encodeURIComponent(id);
touchUser(id, 'whatsapp', 'Andrés Peña');
appendMessage(id, 'user', 'hola, ¿tienen trajes para boda?', 'consulta');
const stats = (await (await pedir('/stats')).json()) as { ficha: { contacto: { k: string }[]; contactoPor: string[]; delNegocio: { k: string }[] } };
check('/stats dice qué se escribe en la ficha', stats.ficha.contacto.map((x) => x.k).join(',') === 'correo,whatsapp,instagram,facebook,contacto_por' && stats.ficha.contactoPor.includes('Instagram') && stats.ficha.delNegocio.length === business.crm.fields.length, JSON.stringify(stats.ficha));
const guarda = await pedir(`/contacts/${enc}`, { method: 'PATCH', body: { name: 'Andrés Peña', ficha: { correo: 'Andres@Correo.co', instagram: '@andres.p', contacto_por: 'instagram', [business.crm.fields[0]!.name]: 'lo que dijo' } } });
const guardado = getContact(id)!;
check('se guarda desde «Corregir datos»', guarda.status === 200 && guardado.data.correo === 'andres@correo.co' && guardado.data.instagram === 'andres.p' && guardado.data.contacto_por === 'Instagram' && guardado.data[business.crm.fields[0]!.name] === 'lo que dijo', JSON.stringify(guardado.data));
const editado = listEvents(id, 50).filter((e) => e.type === 'editado').at(-1)?.payload as { campos: string[]; by: string } | undefined;
check('y la historia dice quién y qué', editado?.by === 'Bryan' && ['correo', 'Instagram', 'por dónde nos contactó'].every((x) => editado.campos.includes(x)), JSON.stringify(editado));
const mal = await pedir(`/contacts/${enc}`, { method: 'PATCH', body: { name: 'Otro Nombre', ficha: { correo: 'sin-arroba' } } });
check('🪤 con un correo mal escrito no se guarda nada, ni el nombre del mismo formulario', mal.status === 400 && getContact(id)!.name === 'Andrés Peña' && /correo/.test(((await mal.json()) as { error: string }).error));
check('se busca por el Instagram', listContacts({ q: 'andres.p' }).some((c) => c.id === id) && listContacts({ q: 'andres@correo' }).some((c) => c.id === id));
const borra = await pedir(`/contacts/${enc}`, { method: 'PATCH', body: { ficha: { instagram: '' } } });
check('vaciar un campo lo quita', borra.status === 200 && !('instagram' in getContact(id)!.data));
const valorA = await pedir(`/contacts/${enc}`, { method: 'PATCH', body: { data: { valor: 500000 } } });
const sinValor = await pedir(`/contacts/${enc}`, { method: 'PATCH', body: { data: { valor: 0 } } });
check('el valor a mano se quita mandándolo en cero (la ficha completa ya no manda el `data` entero)', valorA.status === 200 && sinValor.status === 200 && !('valor' in getContact(id)!.data) && getContact(id)!.data.correo === 'andres@correo.co');
const alta = await pedir('/contacts', { method: 'POST', body: { name: 'Camila Ruiz', ficha: { instagram: 'https://instagram.com/cami.ruiz', correo: 'cami@ruiz.co', contacto_por: 'Instagram' } } });
const nueva = ((await alta.json()) as { contact: { id: string } }).contact;
check('«Nuevo contacto» también los guarda', alta.status === 201 && getContact(nueva.id)?.data.instagram === 'cami.ruiz' && getContact(nueva.id)?.data.contacto_por === 'Instagram');
const altaMal = await pedir('/contacts', { method: 'POST', body: { name: 'Fantasma', ficha: { correo: 'no-es-correo' } } });
check('y con un dato mal escrito no deja una ficha a medias', altaMal.status === 400 && !listContacts({ q: 'Fantasma' }).length);
check('el asesor con el candado puesto también los corrige (es atender)', (await pedir(`/contacts/${enc}`, { method: 'PATCH', body: { ficha: { facebook: 'Andrés Peña' } }, rol: 'asesor' })).status === 200);
const csv = contactsCsv().split('\r\n');
const cab = csv[0]!.split(';');
check('el Excel lleva las columnas nuevas al final, sin correr las de antes', cab[1] === 'Teléfono' && cab.slice(16).slice(0, 5).join(';') === 'Correo;WhatsApp;Instagram;Facebook;Nos contactó por', cab.slice(14).join(';'));
check('con sus valores', csv.some((l) => l.includes('andres@correo.co') && l.includes('Instagram')) && csv.some((l) => l.includes('cami.ruiz')));

console.log('— El tablero');
const js = readFileSync(new URL('../../public/admin.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../../public/admin.html', import.meta.url), 'utf8');
const funcion = (fuente: string, nombre: string): string => {
  const i = fuente.indexOf(`function ${nombre}(`);
  if (i < 0) throw new Error(`no está ${nombre}`);
  let n = 0;
  for (let j = fuente.indexOf('{', i); j < fuente.length; j++) {
    if (fuente[j] === '{') n++;
    else if (fuente[j] === '}' && --n === 0) return fuente.slice(i, j + 1);
  }
  throw new Error(`sin cerrar ${nombre}`);
};
type Ficha = { contactoHtml(c: object, fila: (k: string, h: string) => string): string; camposFichaHtml(c: object, p: string, o?: object): string; leerFicha(p: string): Record<string, string> };
const campos: Record<string, { value: string }> = {};
const tablero = new Function('state', '$',
  ['esc', 'etiquetaDato', 'fichaDelNegocio', 'contactoHtml', 'camposFichaHtml', 'idsDeFicha', 'leerFicha'].map((n) => funcion(js, n)).join('\n') +
  '\nvar TILDES = { ocasion: "ocasión" };\nreturn { contactoHtml: contactoHtml, camposFichaHtml: camposFichaHtml, leerFicha: leerFicha };',
)({ ficha: stats.ficha }, (id: string) => campos[id]) as Ficha;
const fila = (k: string, h: string) => `<dt>${k}</dt><dd>${h}</dd>`;
const vista = tablero.contactoHtml({ data: { correo: 'a@b.co', instagram: 'ana.c', facebook: 'Ana Castro', whatsapp: '+573001112233', contacto_por: 'Instagram' } }, fila);
check('la ficha enseña el correo para escribirle', vista.includes('<a href="mailto:a@b.co">a@b.co</a>'));
check('el Instagram con su @ y su enlace', vista.includes('href="https://instagram.com/ana.c">@ana.c</a>'));
check('el WhatsApp abre el chat', vista.includes('href="https://wa.me/573001112233"'));
check('un Facebook que es un nombre se enseña, sin enlace inventado', vista.includes('<dd>Ana Castro</dd>'));
check('y por dónde llegó', vista.includes('<dt>Nos contactó por</dt><dd>Instagram</dd>'));
check('lo que no tiene, no sale', tablero.contactoHtml({ data: { correo: 'a@b.co' } }, fila).split('<dt>').length === 2);
check('🪤 lo que escribió alguien no se cuela como HTML', !tablero.contactoHtml({ data: { facebook: '<img onerror=x>' } }, fila).includes('<img'));
const form = tablero.camposFichaHtml({ data: { correo: 'a@b.co', contacto_por: 'Facebook', [stats.ficha.delNegocio[0]!.k]: 'lo captado' } }, 'f-x-', { borrador: true });
check('«Corregir datos» trae correo, WhatsApp, Instagram, Facebook y por dónde llegó', ['correo', 'whatsapp', 'instagram', 'facebook'].every((k) => form.includes(`id="f-x-${k}" data-borrador`)) && /<select id="f-x-contacto_por">[\s\S]*<option selected>Facebook<\/option>/.test(form));
check('y lo que captó aiva, escrito y corregible', form.includes('Lo que contó') && form.includes(`id="f-x-${stats.ficha.delNegocio[0]!.k}" data-borrador value="lo captado"`));
check('el de «Nuevo contacto» trae solo lo de contacto, sin WhatsApp (el teléfono ya es su WhatsApp)', (() => { const n = tablero.camposFichaHtml({ data: {} }, 'nv-x-', { soloContacto: true, sin: { whatsapp: 1 } }); return n.includes('nv-x-instagram') && !n.includes('nv-x-whatsapp') && !n.includes('Lo que contó'); })());
campos['f-x-correo'] = { value: ' a@b.co ' }; campos['f-x-instagram'] = { value: '@ana' };
check('lo escrito se lee para guardarlo', JSON.stringify(tablero.leerFicha('f-x-')) === '{"correo":"a@b.co","instagram":"@ana"}', JSON.stringify(tablero.leerFicha('f-x-')));
check('las dos fichas y el alta mandan la ficha al guardar', /ficha: leerFicha\('f-x-'\)/.test(js) && /ficha: leerFicha\('pf-x-'\)/.test(js) && /ficha: leerFicha\('nv-x-'\)/.test(js));
check('lo de contacto no se repite en «Lo que contó»', (js.match(/motivo_perdida: 1 \}, DE_CONTACTO\)/g) ?? []).length === 2);
check('los dos lo enseñan, en los dos modos (sin solo-completo)', (js.match(/contactoHtml\(c, fila\) \+/g) ?? []).length === 2 && !/contactoHtml\(c, fila\)[^\n]*solo-completo/.test(js));
check('el alta tiene dónde pintarlos, dentro de su misma rejilla', /<div id="nv-ficha" style="display:contents"><\/div>/.test(html));
check('unas medidas largas se corrigen en dos renglones', tablero.camposFichaHtml({ data: { [stats.ficha.delNegocio[0]!.k]: 'Saco 40, pantalón 32, pecho 100 cm, largo de manga 64 cm' } }, 'f-x-').includes(`<textarea id="f-x-${stats.ficha.delNegocio[0]!.k}" rows="2"`));
check('sin teléfono, la lista de Clientes dice su @ o su correo', /c\.phone \|\| \(c\.data && c\.data\.instagram \? '@' \+ c\.data\.instagram : ''\) \|\| \(c\.data && c\.data\.correo\)/.test(js));

console.log('— Entrar directo al tablero');
const consolaHtml = readFileSync(new URL('../../public/consola.html', import.meta.url), 'utf8');
const directo = (d: object, hash = '') => new Function('location', funcion(consolaHtml, 'vaDirectoAlTablero') + '\nreturn vaDirectoAlTablero;')({ hash })(d) as boolean;
check('quien lleva un solo cliente entra directo a su tablero', directo({ super: false, usuario: { clientes: ['dunor'] } }));
check('quien lleva varios, a la consola', !directo({ super: false, usuario: { clientes: ['dunor', 'confia'] } }));
check('el super-admin, a la consola', !directo({ super: true, usuario: null }) && !directo({ super: true, usuario: { clientes: ['dunor'] } }));
check('🪤 y «Volver a la consola» (#consola) no lo devuelve al tablero', !directo({ super: false, usuario: { clientes: ['dunor'] } }, '#consola') && /location\.href = '\/consola#consola'/.test(js));
check('se va antes de pintar la consola, a la dirección del tablero', /if \(vaDirectoAlTablero\(d\)\) \{ location\.replace\('\/c\/' \+ encodeURIComponent\(d\.usuario\.clientes\[0\]\) \+ '\/admin'\); return; \}\s*pintarYo\(\);/.test(consolaHtml));
check('con un cliente, «Abrir tablero» se abre en la misma pestaña', /\(esSuper \|\| \(yo && \(yo\.clientes \|\| \[\]\)\.length > 1\) \? ' target="_blank"/.test(consolaHtml));
check('🪤 «Salir» desde el tablero cierra la sesión de la consola (antes solo llevaba a la portada)', /fetch\('\/api\/salir', \{ method: 'POST' \}\)/.test(js) && /location\.href = '\/consola';/.test(js));
const consola = readFileSync(new URL('../consola.ts', import.meta.url), 'utf8');
check('🪤 sin sesión, el tablero manda a /consola, no a la portada', /if \(!quien\) return c\.redirect\('\/consola', 302\);/.test(consola) && /app\.get\('\/consola', puerta\);/.test(consola));

console.log(fail ? `\n${fail} fallos` : '\ntodo ok');
process.exit(fail ? 1 : 0);
