// Recap de una línea armado solo con hechos de la ficha: qué busca, para cuándo, cuánto, la cita y qué lo frena.
// Sin modelo: se actualiza aunque el análisis no llame a la IA y nunca inventa. El resumen del modelo
// (una frase corta) queda para lo que los datos no dicen.
import { V } from '../vocabulario.js';
import { business } from '../config.js';
import type { Appointment } from './appointments.js';
import type { Contact } from './contacts.js';
import { clip, shortBudget } from './signals.js';

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

function shortDate(ms: number): string {
  return new Intl.DateTimeFormat('es-CO', { timeZone: business.timezone, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
    .format(new Date(ms))
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ');
}

/** "boda (novio) · 6 de diciembre · traje a la medida · hasta 2 millones · cita jue, 24 sept, 10:00 a. m." */
export function recap(c: Contact, nextAppointment: Appointment | null): string {
  const d = c.data;
  const parts: string[] = [];
  const add = (s: string) => {
    if (s && !parts.some((p) => p.toLowerCase().includes(s.toLowerCase()))) parts.push(s);
  };
  // Campos del cliente, en el orden de xencrm.config.json; un número suelto lleva su nombre ("talla o medidas: 40").
  for (const f of business.crm.fields) {
    const v = text(d[f.name]);
    if (v) add(/^\d+([.,]\d+)?$/.test(v) ? `${f.name.replace(/_/g, ' ')}: ${v}` : clip(v, 40));
  }
  if (text(d.presupuesto)) add(shortBudget(text(d.presupuesto)));
  if (text(d.ciudad)) add(text(d.ciudad));
  if (nextAppointment) add(`${V.cita} ${shortDate(nextAppointment.startsAt)}`);
  else if (d.booking) add(`agendando ${V.cita}`);
  if (text(d.objecion)) add(`lo frena: ${clip(text(d.objecion), 50)}`);
  return parts.join(' · ');
}
