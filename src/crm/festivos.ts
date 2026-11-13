/**
 * Los festivos, para que el calendario los anuncie. Calculados, sin red ni una tabla por año que alguien tenga que
 * acordarse de actualizar.
 *
 * Por ahora Colombia (Ley 51 de 1983, la «Ley Emiliani»): seis fechas fijas, siete que se corren al lunes siguiente
 * y cinco que dependen de la Pascua (dos fijas y tres corridas al lunes). Dieciocho al año.
 *
 * 🪤 Un festivo NO cierra la agenda por sí solo: lo anuncia. Hay negocios que abren los festivos, y que el asistente
 * dejara de ofrecer un día sin que nadie lo decidiera sería peor que ofrecerlo. Cerrar es un clic en el calendario
 * («Bloquear el día», crm/cierres.ts), y desde ahí el asistente deja de ofrecerlo.
 *
 * El país sale de `appointments.festivos` en xencrm.config.json («CO»; vacío para no anunciar ninguno). Si no se
 * dice, se deduce de la zona horaria: un negocio en America/Bogota tiene los de Colombia.
 */
import { business } from '../config.js';

export interface Festivo {
  /** YYYY-MM-DD, el día civil (sin hora ni zona). */
  fecha: string;
  nombre: string;
}

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const DIA = 86_400_000;

/** Domingo de Pascua (algoritmo anónimo gregoriano), en milisegundos UTC a medianoche. */
export function pascua(y: number): number {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(y, mes - 1, dia);
}

/** El mismo día si es lunes; si no, el lunes siguiente. */
function alLunes(t: number): number {
  const wd = new Date(t).getUTCDay();
  return wd === 1 ? t : t + ((8 - wd) % 7) * DIA;
}

/** Los dieciocho festivos de Colombia de ese año, en orden. */
export function festivosCO(y: number): Festivo[] {
  const fijo = (m: number, d: number) => Date.UTC(y, m - 1, d);
  const p = pascua(y);
  const lista: Array<[number, string]> = [
    [fijo(1, 1), 'Año Nuevo'],
    [alLunes(fijo(1, 6)), 'Reyes Magos'],
    [alLunes(fijo(3, 19)), 'San José'],
    [p - 3 * DIA, 'Jueves Santo'],
    [p - 2 * DIA, 'Viernes Santo'],
    [fijo(5, 1), 'Día del Trabajo'],
    [alLunes(p + 39 * DIA), 'Ascensión del Señor'],
    [alLunes(p + 60 * DIA), 'Corpus Christi'],
    [alLunes(p + 68 * DIA), 'Sagrado Corazón'],
    [alLunes(fijo(6, 29)), 'San Pedro y San Pablo'],
    [fijo(7, 20), 'Día de la Independencia'],
    [fijo(8, 7), 'Batalla de Boyacá'],
    [alLunes(fijo(8, 15)), 'Asunción de la Virgen'],
    [alLunes(fijo(10, 12)), 'Día de la Raza'],
    [alLunes(fijo(11, 1)), 'Todos los Santos'],
    [alLunes(fijo(11, 11)), 'Independencia de Cartagena'],
    [fijo(12, 8), 'Inmaculada Concepción'],
    [fijo(12, 25), 'Navidad'],
  ];
  return lista.sort((a, b) => a[0] - b[0]).map(([t, nombre]) => ({ fecha: iso(t), nombre }));
}

/** De qué país se anuncian los festivos: el de la configuración, o el que dice la zona horaria. '' = ninguno. */
export function paisDeFestivos(): string {
  const dicho = business.appointments.festivos;
  if (dicho !== undefined) return dicho.trim().toUpperCase();
  return business.timezone === 'America/Bogota' ? 'CO' : '';
}

/** Los festivos entre dos días (YYYY-MM-DD, ambos incluidos). Vacío si el negocio no anuncia festivos. */
export function festivosEntre(desde: string, hasta: string, pais = paisDeFestivos()): Festivo[] {
  if (pais !== 'CO' || desde > hasta) return [];
  const out: Festivo[] = [];
  for (let y = Number(desde.slice(0, 4)); y <= Number(hasta.slice(0, 4)); y++) {
    for (const f of festivosCO(y)) if (f.fecha >= desde && f.fecha <= hasta) out.push(f);
  }
  return out;
}
