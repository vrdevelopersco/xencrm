/**
 * Los datos de una persona más allá del nombre y el teléfono: su correo, su WhatsApp si es otro número, su
 * Instagram, su Facebook y por dónde nos contactó. Y los datos del negocio que XENCRM va captando de la conversación
 * (`crm.fields`: en DUNOR la talla o las medidas, la ocasión, la fecha del evento…), que el equipo también corrige.
 *
 * Lo pidió DUNOR: «modificar contacto» solo dejaba nombre y teléfono, y un cliente que llega por Instagram no tiene
 * dónde dejar su usuario. Vale para todos los clientes: un correo o un Instagram no son cosa de una boutique.
 *
 * Todo vive en `data`, junto a lo que capta el análisis. Lo que escribe el equipo queda marcado en `data._amano` y
 * el análisis ya no lo toca (crm/analyzer.ts). 🪤 Sin esa marca, una corrección duraba hasta el análisis siguiente,
 * que volvía a sacar el dato viejo de la conversación y lo escribía encima. Borrar un dato también lo marca: si el
 * equipo lo quitó porque estaba mal, que no vuelva solo.
 */
import { business } from '../config.js';

// `enHistoria` es como sale en «Bryan corrigió correo, Instagram»: en minúscula, salvo los nombres propios.
export const CAMPOS_DE_CONTACTO = [
  { k: 'correo', etiqueta: 'Correo', enHistoria: 'correo' },
  { k: 'whatsapp', etiqueta: 'WhatsApp', enHistoria: 'WhatsApp' },
  { k: 'instagram', etiqueta: 'Instagram', enHistoria: 'Instagram' },
  { k: 'facebook', etiqueta: 'Facebook', enHistoria: 'Facebook' },
  { k: 'contacto_por', etiqueta: 'Nos contactó por', enHistoria: 'por dónde nos contactó' },
] as const;
const DE_CONTACTO = new Set<string>(CAMPOS_DE_CONTACTO.map((x) => x.k));

/** Lo que el equipo puede escribir en una ficha: lo de contacto y los datos que capta este negocio. */
export function camposEditables(): string[] {
  return [...DE_CONTACTO, ...business.crm.fields.map((f) => f.name).filter((n) => !DE_CONTACTO.has(n))];
}

/** El nombre de un campo como lo lee una persona: «Nos contactó por», «talla o medidas». */
export function etiquetaDeCampo(k: string): string {
  return CAMPOS_DE_CONTACTO.find((x) => x.k === k)?.etiqueta ?? k.replace(/_/g, ' ');
}

/** Un usuario de red escrito como sea —«@juan.p», el enlace del perfil, con espacios— queda en el usuario solo. */
function usuarioDeRed(v: string, dominio: RegExp): string {
  return v
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(dominio, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
    .replace(/^@/, '')
    .trim();
}

/** El valor limpio, o por qué no sirve. Vacío es «no lo sé» y quita el dato. */
export function normalizar(k: string, crudo: unknown): { valor: string } | { error: string } {
  const v = String(crudo ?? '').trim();
  if (!v) return { valor: '' };
  switch (k) {
    case 'correo': {
      const correo = v.toLowerCase();
      return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo) && correo.length <= 120 ? { valor: correo } : { error: `«${v}» no parece un correo` };
    }
    case 'instagram': {
      const u = usuarioDeRed(v, /^(www\.)?instagram\.com\//i);
      return /^[A-Za-z0-9._]{1,30}$/.test(u) ? { valor: u } : { error: `«${v}» no parece un usuario de Instagram` };
    }
    case 'facebook': {
      // 🪤 Un perfil sin usuario es `profile.php?id=…`: ahí lo que sobra al limpiar ES el perfil.
      const numerico = /profile\.php\?id=(\d+)/i.exec(v);
      if (numerico) return { valor: `profile.php?id=${numerico[1]}` };
      // En Facebook mucha gente solo sabe el nombre con que aparece: se acepta también, con espacios.
      const u = usuarioDeRed(v, /^((www|m|web)\.)?facebook\.com\//i);
      return u && u.length <= 100 ? { valor: u } : { error: `«${v}» no parece un perfil de Facebook` };
    }
    case 'whatsapp': {
      const digitos = v.replace(/\D/g, '');
      return digitos.length >= 7 && digitos.length <= 15 ? { valor: (v.trim().startsWith('+') ? '+' : '') + digitos } : { error: `«${v}» no parece un número de WhatsApp` };
    }
    case 'contacto_por': {
      const opcion = business.crm.contactoPor.find((o) => o.toLowerCase() === v.toLowerCase());
      return opcion ? { valor: opcion } : { error: `«${v}» no está entre las opciones de «Nos contactó por»` };
    }
    default:
      return v.length <= 300 ? { valor: v } : { error: `${etiquetaDeCampo(k)}: hasta 300 letras` };
  }
}

/**
 * Pone lo que escribió el equipo sobre `data`. Devuelve el `data` nuevo y qué campos cambiaron de verdad, o el
 * primer error (y entonces no cambia nada: un formulario se guarda entero o no se guarda).
 */
export function aplicarFicha(data: Record<string, unknown>, ficha: unknown): { data: Record<string, unknown>; cambiados: string[] } | { error: string } {
  if (!ficha || typeof ficha !== 'object') return { data, cambiados: [] };
  const editables = new Set(camposEditables());
  const nuevo: Record<string, unknown> = { ...data };
  const amano = new Set(Array.isArray(data._amano) ? (data._amano as unknown[]).map(String) : []);
  const cambiados: string[] = [];
  for (const [k, crudo] of Object.entries(ficha as Record<string, unknown>)) {
    if (!editables.has(k)) return { error: `«${k}» no es un dato de la ficha` };
    const r = normalizar(k, crudo);
    if ('error' in r) return r;
    const antes = String(data[k] ?? '');
    if (r.valor === antes) continue;
    if (r.valor) nuevo[k] = r.valor;
    else delete nuevo[k];
    amano.add(k);
    cambiados.push(CAMPOS_DE_CONTACTO.find((x) => x.k === k)?.enHistoria ?? etiquetaDeCampo(k));
  }
  if (amano.size) nuevo._amano = [...amano];
  return { data: nuevo, cambiados };
}

/** Los campos que el equipo escribió a mano: el análisis no los pisa. */
export function escritosAMano(data: Record<string, unknown>): Set<string> {
  return new Set(Array.isArray(data._amano) ? (data._amano as unknown[]).map(String) : []);
}
