// Pruebas del perfil del negocio (sin modelo): pnpm test:profile
// Lo confirmado llega al bot (y manda sobre otra información); lo vacío queda por confirmar; se guarda con copia.
// Usa un archivo y una base temporales: no toca el perfil real del cliente.
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'aiva-perfil-'));
process.env.DB_PATH = join(dir, 'aiva.db');
const { business } = await import('../config.js');
const originalName = business.business.name;
business.profileFile = join(dir, 'profile.json');
const { loadProfile, saveProfile, pendingFields, profileText } = await import('../profile.js');
const { businessSheet } = await import('../rag/retriever.js');
const { profileDocs } = await import('../rag/profile-index.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   ${detail}`}`);
};

loadProfile();
check('sin perfil, todo queda por confirmar', pendingFields().includes('Dirección') && pendingFields().includes('Precios o rangos'), pendingFields().join(', '));
check('sin perfil, el nombre es el de la configuración', business.business.name === originalName);
check('sin perfil, el bot no recibe nada inventado', profileText() === '' && !businessSheet().text.includes('Perfil del negocio'));

const first = saveProfile({
  identity: { name: 'Sastrería Prueba' },
  service: { address: 'Calle 84 # 45-12, local 3', hours: 'Lunes a sábado, 10 a. m. a 7 p. m.', appointmentOnly: true },
  payments: { methods: 'Nequi, tarjeta y efectivo' },
  extras: [{ title: 'Tallas', text: 'De la 36 a la 52' }, { title: 'Zapatos', text: '' }],
  notes: { 'contact.whatsapp': 'Nota solo para el equipo' },
});
check('guardado: queda en el archivo', existsSync(business.profileFile) && JSON.parse(readFileSync(business.profileFile, 'utf8')).service.address === 'Calle 84 # 45-12, local 3');
check('el nombre del perfil pasa a la configuración en uso', business.business.name === 'Sastrería Prueba');
const t = profileText();
check('el bot recibe lo confirmado', /Dirección: Calle 84 # 45-12/.test(t) && /Tallas: De la 36 a la 52/.test(t) && /solo con cita previa: sí/.test(t), t);
check('lo vacío no se le dice al bot (ni las notas del equipo)', !/Zapatos/.test(t) && !/Nota solo para el equipo/.test(t) && !/Precios/.test(t), t);
check('lo vacío sigue por confirmar, incluidos los datos extra sin texto', pendingFields().includes('Zapatos') && pendingFields().includes('Precios o rangos') && !pendingFields().includes('Dirección'));
const sheet = businessSheet().text;
check('va en la información fija del prompt, marcado como lo que manda', /### Perfil del negocio \(confirmado por el negocio: si otra información lo contradice, vale esto\)\n- Nombre: Sastrería Prueba/.test(sheet), sheet.slice(0, 400));
check('y en la búsqueda, como su propia fuente', profileDocs()[0]?.meta.source === 'profile' && /Calle 84/.test(profileDocs()[0]?.content ?? ''));
check('la primera vez no hay copia', first.backup === null);

const second = saveProfile({ ...first.profile, identity: { ...first.profile.identity, name: '' } });
check('la segunda vez guarda copia del anterior', Boolean(second.backup && existsSync(second.backup)));
check('nombre vacío en el perfil: vuelve el de la configuración', business.business.name === originalName);

let message = '';
try {
  saveProfile({ ...second.profile, extras: [{ title: 'x', text: 'y' }] });
} catch (err) {
  message = (err as Error).message;
}
check('inválido: no se guarda y dice dónde', /extras › 0 › title/.test(message) && JSON.parse(readFileSync(business.profileFile, 'utf8')).extras[0].title === 'Tallas', message);

console.log(`\n${fail ? `${fail} fallos` : 'todo ok'}`);
process.exit(fail ? 1 : 0);
