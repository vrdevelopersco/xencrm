// Perfil del negocio: lo que el dueño confirma de su negocio (dirección, horarios, pagos, precios, contacto…), editable
// desde el tablero (Configuración › Perfil). Vive en un archivo por cliente (xencrm.config.json > profileFile), como el
// diccionario. Lo vacío queda "por confirmar": el bot no lo supone y, si le preguntan, dice que lo verifica.
// Lo confirmado va en la información fija del prompt y en la búsqueda; si contradice otra información, vale el perfil.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { business } from './config.js';

const text = (max: number) => z.string().trim().max(max).default('');
export const ProfileSchema = z.object({
  identity: z.object({ name: text(80), description: text(300), siteUrl: text(200), city: text(80) }).prefault({}),
  contact: z.object({ whatsapp: text(40), phone: text(40), email: text(120), instagram: text(80), human: text(240) }).prefault({}),
  service: z.object({ address: text(200), hours: text(300), area: text(300), appointmentOnly: z.boolean().default(false) }).prefault({}),
  payments: z.object({ methods: text(300), deposit: text(300) }).prefault({}),
  prices: text(1500),
  policies: text(1500),
  /** Datos propios de cada negocio (tallas, tiempos, lo que venden o no). Con el texto vacío, quedan por confirmar. */
  extras: z.array(z.object({ title: z.string().trim().min(2).max(80), text: text(800) })).max(40).default([]),
  /** Notas para el equipo sobre lo que falta confirmar ("el sitio muestra un número y los botones otro"). No van al bot. */
  notes: z.record(z.string(), z.string().max(300)).default({}),
});
export type Profile = z.infer<typeof ProfileSchema>;

/** Los campos, en orden, con su etiqueta: el tablero arma el formulario con esto y el bot lee lo confirmado. */
export const PROFILE_FIELDS: { key: string; section: string; label: string; hint?: string; long?: boolean; bool?: boolean }[] = [
  { key: 'identity.name', section: 'Negocio', label: 'Nombre' },
  { key: 'identity.description', section: 'Negocio', label: 'Qué hace y para quién', long: true },
  { key: 'identity.siteUrl', section: 'Negocio', label: 'Sitio web' },
  { key: 'identity.city', section: 'Negocio', label: 'Ciudad' },
  { key: 'service.address', section: 'Dónde y cuándo', label: 'Dirección', hint: 'Si solo se da al confirmar la cita, escríbelo así.' },
  { key: 'service.hours', section: 'Dónde y cuándo', label: 'Horarios de atención', long: true },
  { key: 'service.area', section: 'Dónde y cuándo', label: 'Zona que atienden', hint: '¿Solo en la ciudad? ¿Envíos o atención fuera de ella?', long: true },
  { key: 'service.appointmentOnly', section: 'Dónde y cuándo', label: 'Atienden solo con cita previa', bool: true },
  { key: 'contact.whatsapp', section: 'Contacto', label: 'WhatsApp oficial' },
  { key: 'contact.phone', section: 'Contacto', label: 'Teléfono' },
  { key: 'contact.email', section: 'Contacto', label: 'Correo' },
  { key: 'contact.instagram', section: 'Contacto', label: 'Instagram' },
  { key: 'contact.human', section: 'Contacto', label: 'Cómo hablar con una persona', hint: 'Lo que el bot ofrece cuando piden un asesor.', long: true },
  { key: 'payments.methods', section: 'Pagos', label: 'Formas de pago', long: true },
  { key: 'payments.deposit', section: 'Pagos', label: 'Abono o anticipo', long: true },
  { key: 'prices', section: 'Precios', label: 'Precios o rangos', hint: 'Lo que el bot puede decir de precios. Vacío: dice que lo verifica.', long: true },
  { key: 'policies', section: 'Políticas', label: 'Condiciones y políticas', hint: 'Cambios, devoluciones, depósitos, entregas…', long: true },
];

const file = () => business.profileFile;
// Lo que traía xencrm.config.json: si el perfil deja un campo de identidad vacío, vale esto.
const configIdentity = { ...business.business };

let current: Profile | null = null;
export function getProfile(): Profile {
  current ??= existsSync(file()) ? ProfileSchema.parse(JSON.parse(readFileSync(file(), 'utf8'))) : ProfileSchema.parse({});
  return current;
}

const get = (p: Profile, key: string): unknown => key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], p);

/** Lo que falta confirmar, con su etiqueta (incluye los datos extra sin texto). */
export function pendingFields(p: Profile = getProfile()): string[] {
  return [
    ...PROFILE_FIELDS.filter((f) => !f.bool && !String(get(p, f.key) ?? '').trim()).map((f) => f.label),
    ...p.extras.filter((x) => !x.text.trim()).map((x) => x.title),
  ];
}

/** Los datos propios que el negocio dejó sin texto ("Zapatos"): si el cliente pregunta por ellos, se verifica. */
export function pendingTopics(p: Profile = getProfile()): string[] {
  return p.extras.filter((x) => !x.text.trim()).map((x) => x.title);
}

/** El nombre, la descripción, el sitio y el contacto humano del perfil pasan a la configuración en uso. */
export function applyProfile(p: Profile = getProfile()): void {
  Object.assign(business.business, {
    name: p.identity.name || configIdentity.name,
    description: p.identity.description || configIdentity.description,
    siteUrl: p.identity.siteUrl || configIdentity.siteUrl,
    humanContact: p.contact.human || configIdentity.humanContact,
  });
}

/** Lo confirmado, como texto para el bot. Vacío si no hay nada. */
export function profileText(p: Profile = getProfile()): string {
  const lines: string[] = [];
  for (const f of PROFILE_FIELDS) {
    const v = get(p, f.key);
    if (f.bool) {
      if (v) lines.push(`- ${f.label}: sí`);
    } else if (String(v ?? '').trim()) lines.push(`- ${f.label}: ${String(v).trim()}`);
  }
  for (const x of p.extras) if (x.text.trim()) lines.push(`- ${x.title}: ${x.text.trim()}`);
  return lines.join('\n');
}

/** Guarda (con copia del anterior en .anterior.json) y aplica al instante. Lanza con los errores si no es válido. */
export function saveProfile(raw: unknown): { profile: Profile; backup: string | null } {
  const parsed = ProfileSchema.safeParse(raw);
  if (!parsed.success) throw new Error(parsed.error.issues.slice(0, 6).map((i) => `${i.path.join(' › ') || 'perfil'}: ${i.message}`).join('\n'));
  let backup: string | null = null;
  if (existsSync(file())) {
    backup = file().replace(/\.json$/, '') + '.anterior.json';
    copyFileSync(file(), backup);
  }
  writeFileSync(file(), JSON.stringify(parsed.data, null, 2) + '\n');
  current = parsed.data;
  applyProfile(current);
  return { profile: current, backup };
}

/** Aplica lo del archivo al arrancar (y para pruebas: vuelve a leerlo). */
export function loadProfile(): Profile {
  current = null;
  const p = getProfile();
  applyProfile(p);
  return p;
}

// Al importarse (servidor, CLI, pruebas) el perfil del archivo ya queda aplicado a la configuración en uso.
applyProfile();
