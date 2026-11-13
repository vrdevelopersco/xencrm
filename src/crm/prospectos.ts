// Ventas › Prospectos: quien dejó sus datos en el registro de la portada o de la puerta de la consola («Pruébalo con
// tu negocio»). Entra como una ficha más —con su WhatsApp, para que el equipo o el asistente le escriban— y además
// queda aquí, con su estado, hasta que alguien lo atienda: nuevo → contactado → en el embudo, o descartado.
//
// El registro público no llega directo: lo recibe la consola (POST /api/prospecto, con su freno y su trampa para
// bots) y lo pasa aquí por la ruta del tablero, con el token. Este módulo no sabe nada de la red.
//
// 🪤 Quien ya tenía ficha (escribió antes por WhatsApp, o se registra dos veces) NO se duplica: se usa su ficha, se
// le suman los datos nuevos que no tenía y, si estaba descartado, vuelve a «nuevo»: registrarse otra vez es pedir
// que lo atiendan.
import { getDb } from '../rag/store.js';
import { darDeAlta } from './alta.js';
import { addEvent, getContact, numeroNormalizado, rolDe, setStage, STAGE_DEFS, updateContact, type Contact } from './contacts.js';
import { emitEvent } from './events.js';
import { anotarOrigen } from './origen.js';

export const ESTADOS = ['nuevo', 'contactado', 'en_embudo', 'descartado'] as const;
export type EstadoProspecto = (typeof ESTADOS)[number];
export const DESDE = ['portada', 'consola'] as const;
export type Desde = (typeof DESDE)[number];
/** Lo que quiere resolver: las tres plantillas de XENCRM (citas, soporte, cotización). Vacío: no lo dijo. */
export const INTERESES = ['ventas', 'soporte', 'cotizacion'] as const;
export type Interes = (typeof INTERESES)[number] | '';

export interface Registro {
  nombre: string;
  /** Ya normalizado por quien lo recibió (la consola); aquí se vuelve a normalizar con el país de este negocio. */
  whatsapp: string;
  empresa?: string;
  interes?: string;
  desde?: string;
}

export interface Prospecto {
  id: string;
  nombre: string | null;
  telefono: string | null;
  empresa: string;
  interes: Interes;
  desde: Desde;
  estado: EstadoProspecto;
  /** Cuándo se registró (la primera vez) y cuándo volvió a hacerlo, si volvió. */
  creado: number;
  ultimoRegistro: number;
  /** Cuántas veces se registró. */
  veces: number;
  actualizado: number;
  /** Quién lo movió por última vez («formulario» si fue el registro). */
  por: string;
  /** La etapa de su ficha en el embudo y cuándo fue lo último de la conversación. */
  etapa: string;
  ultimoMensaje: number | null;
}

interface Fila {
  user_id: string;
  empresa: string;
  interes: string;
  desde: string;
  estado: string;
  creado: number;
  ultimo_registro: number;
  veces: number;
  actualizado: number;
  por: string;
}

const texto = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const esDe = <T extends readonly string[]>(lista: T, v: unknown): v is T[number] => (lista as readonly string[]).includes(String(v));

function vista(f: Fila, c: Contact | null): Prospecto {
  return {
    id: f.user_id,
    nombre: c?.name ?? null,
    telefono: c?.phone ?? null,
    empresa: f.empresa,
    interes: esDe(INTERESES, f.interes) ? f.interes : '',
    desde: esDe(DESDE, f.desde) ? f.desde : 'portada',
    estado: esDe(ESTADOS, f.estado) ? f.estado : 'nuevo',
    creado: f.creado,
    ultimoRegistro: f.ultimo_registro,
    veces: f.veces,
    actualizado: f.actualizado,
    por: f.por,
    etapa: c?.stage ?? '',
    ultimoMensaje: c?.lastMessageAt ?? null,
  };
}

const fila = (id: string) => getDb().prepare('SELECT * FROM prospectos WHERE user_id = ?').get(id) as unknown as Fila | undefined;

/**
 * Anota a quien se registró. Devuelve su prospecto y si ya existía (como ficha o como prospecto).
 * Lanza un Error con lo que falta si los datos no sirven: el nombre y un WhatsApp de verdad son obligatorios.
 */
export function registrarProspecto(r: Registro, now = Date.now()): { prospecto: Prospecto; yaExistia: boolean } {
  const nombre = texto(r.nombre, 80);
  if (nombre.length < 2) throw new Error('falta el nombre');
  const numero = numeroNormalizado('', texto(r.whatsapp, 24) || null);
  if (!numero || numero.length < 10) throw new Error('falta un WhatsApp válido');
  const empresa = texto(r.empresa, 80);
  const interes: Interes = esDe(INTERESES, r.interes) ? r.interes : '';
  const desde: Desde = esDe(DESDE, r.desde) ? r.desde : 'portada';

  const alta = darDeAlta({ name: nombre, phone: numero });
  const id = alta.contact.id;
  // A una ficha que ya existía no se le cambia el nombre (puede tener uno mejor, puesto por el equipo); solo se le
  // suman los datos que no tenía.
  const datos = { ...(alta.contact.data ?? {}) } as Record<string, unknown>;
  let cambia = false;
  if (empresa && !datos.empresa) { datos.empresa = empresa; cambia = true; }
  if (interes && !datos.interes) { datos.interes = interes; cambia = true; }
  if (cambia) updateContact(id, { data: datos }, { silent: true });
  anotarOrigen(id, { fuente: 'formulario', medio: desde, campana: '', contenido: '', termino: '', anuncio: '', clic: '', titular: '', url: '', referente: '' }, now);

  const antes = fila(id);
  const db = getDb();
  if (antes) {
    const estado = antes.estado === 'descartado' ? 'nuevo' : antes.estado;
    db.prepare('UPDATE prospectos SET empresa = ?, interes = ?, estado = ?, ultimo_registro = ?, veces = veces + 1, actualizado = ?, por = ? WHERE user_id = ?')
      .run(antes.empresa || empresa, antes.interes || interes, estado, now, now, 'formulario', id);
  } else {
    db.prepare('INSERT INTO prospectos (user_id, empresa, interes, desde, estado, creado, ultimo_registro, veces, actualizado, por) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)')
      .run(id, empresa, interes, desde, 'nuevo', now, now, now, 'formulario');
  }
  addEvent(id, 'prospecto', { accion: antes ? 'volvio' : 'registro', desde, by: 'formulario' });
  emitEvent('contact', id, { prospecto: true });
  return { prospecto: vista(fila(id)!, getContact(id)), yaExistia: alta.yaExistia || Boolean(antes) };
}

/** Los prospectos, los más recientes arriba; con `estado`, solo los de ese. Y cuántos hay de cada estado. */
export function listarProspectos(opts: { estado?: string } = {}): { prospectos: Prospecto[]; cuentas: Record<EstadoProspecto, number> } {
  const db = getDb();
  const filas = db.prepare('SELECT * FROM prospectos ORDER BY ultimo_registro DESC LIMIT 1000').all() as unknown as Fila[];
  const todos = filas.map((f) => vista(f, getContact(f.user_id)));
  const cuentas = Object.fromEntries(ESTADOS.map((e) => [e, todos.filter((p) => p.estado === e).length])) as Record<EstadoProspecto, number>;
  const estado = String(opts.estado ?? '');
  return { prospectos: esDe(ESTADOS, estado) ? todos.filter((p) => p.estado === estado) : todos, cuentas };
}

/**
 * Lo mueve de estado. «Pasarlo al embudo» además lo saca de la etapa de entrada de su ficha a la primera etapa
 * activa: para eso se pasa, para que aparezca en Tratos con algo que hacer.
 */
export function cambiarProspecto(id: string, cambios: { estado?: unknown }, por: string, now = Date.now()): Prospecto {
  const f = fila(id);
  if (!f) throw new Error('ese prospecto no existe');
  if (!esDe(ESTADOS, cambios.estado)) throw new Error('ese estado no existe');
  const estado = cambios.estado;
  if (estado !== f.estado) {
    getDb().prepare('UPDATE prospectos SET estado = ?, actualizado = ?, por = ? WHERE user_id = ?').run(estado, now, por, id);
    addEvent(id, 'prospecto', { accion: 'estado', de: f.estado, a: estado, by: por });
    if (estado === 'en_embudo') {
      const c = getContact(id);
      const activa = STAGE_DEFS.find((s) => s.rol === 'activo');
      if (c && activa && rolDe(c.stage) === 'inicio') setStage(id, activa.id, { by: por });
    }
    emitEvent('contact', id, { prospecto: true });
  }
  return vista(fila(id)!, getContact(id));
}
