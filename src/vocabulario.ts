// Las palabras del negocio (xencrm.config.json › interfaz), para los textos que arma el servidor: los nombres de los
// KPIs, los hallazgos de Optimización, los motivos de la salud de una cuenta clave…
//
// 🪤 Lo que depende del negocio no se escribe fijo. «Citas agendadas» es de una boutique; XENTRIS agenda «demos» y
// un taller, «turnos». Es la misma regla que sigue el tablero con su VOC (public/admin.js): las dos tienen que decir lo
// mismo, así que se arman igual.
import { business } from './config.js';

export interface Vocabulario {
  cita: string;
  citas: string;
  Cita: string;
  Citas: string;
  masculino: boolean;
  la: string;
  La: string;
  las: string;
  una: string;
  Ninguna: string;
  otra: string;
  /** Hace concordar un adjetivo escrito en femenino con un nombre masculino: «agendada» → «agendado». */
  g: (femenino: string) => string;
}

const may = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

export function vocabularioDe(agenda: { singular: string; plural: string; masculino: boolean }): Vocabulario {
  const m = agenda.masculino;
  return {
    cita: agenda.singular,
    citas: agenda.plural,
    Cita: may(agenda.singular),
    Citas: may(agenda.plural),
    masculino: m,
    la: m ? 'el' : 'la',
    La: m ? 'El' : 'La',
    las: m ? 'los' : 'las',
    una: m ? 'un' : 'una',
    Ninguna: m ? 'Ningún' : 'Ninguna',
    otra: m ? 'otro' : 'otra',
    g: (f: string) => (m ? f.replace(/as$/, 'os').replace(/a$/, 'o') : f),
  };
}

/** El vocabulario del negocio en uso. */
export const V: Vocabulario = vocabularioDe(business.interfaz.agenda);
