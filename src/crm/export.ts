// Sacar los datos del CRM a una hoja de cálculo: contactos y citas. Es del negocio, así que tiene que poder
// llevárselos cuando quiera. Separador ";" y BOM, que es lo que Excel en español abre bien de una vez.
import { listAppointments, tzParts } from './appointments.js';
import { contactNumber, listContacts, STAGE_LABELS, type Contact } from './contacts.js';
import { CAMPOS_DE_CONTACTO, camposEditables, etiquetaDeCampo } from './ficha.js';

const BOM = '﻿';

/** Una celda: comillas si trae separador, comillas o saltos de línea (y las comillas de adentro, dobles). */
function cell(v: unknown): string {
  const crudo = v === null || v === undefined ? '' : String(v);
  // 🪤 Excel ejecuta lo que empieza por = + - @, y estos nombres los escribe el cliente desde WhatsApp: un
  // prospecto que se ponga `=HYPERLINK(...)` de nombre se lleva la fila cuando el dueño abre el archivo. Un
  // apóstrofo delante lo deja como texto sin cambiar lo que se lee.
  // Ojo: un teléfono empieza por «+» y tiene que salir tal cual, así que solo se neutraliza lo que de verdad
  // parece una fórmula y no un número.
  const pareceFormula = /^[=@\t\r]/.test(crudo) || (/^[+\-]/.test(crudo) && !/^[+\-][\d\s().\-]*$/.test(crudo));
  const s = pareceFormula ? `'${crudo}` : crudo;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const row = (cells: unknown[]) => cells.map(cell).join(';');

/** "22/09/2026 3:20 p. m." en la zona del negocio; vacío si no hay fecha. */
export function stamp(ts: number | null | undefined): string {
  if (!ts) return '';
  const p = tzParts(new Date(ts));
  const h12 = p.hh % 12 === 0 ? 12 : p.hh % 12;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(p.d)}/${pad(p.m)}/${p.y} ${h12}:${pad(p.mm)} ${p.hh < 12 ? 'a. m.' : 'p. m.'}`;
}

const TEMP = (score: number) => (score >= 60 ? 'caliente' : score >= 30 ? 'tibio' : 'frío');
const data = (c: Contact, key: string) => {
  const v = c.data[key];
  return v === null || v === undefined ? '' : String(v);
};

/** Los contactos como hoja de cálculo (sin los archivados). */
export function contactsCsv(): string {
  // Al final, para no correrle las columnas a quien ya tenga una hoja armada sobre este archivo: lo de contacto de
  // la ficha (crm/ficha.ts) y los datos de este negocio que no estaban ya arriba (en DUNOR, las medidas).
  const yaArriba = new Set(['prenda', 'servicio', 'ocasion', 'fecha_evento', 'presupuesto', 'ciudad']);
  const extra = camposEditables().filter((k) => !yaArriba.has(k));
  const rotulo = (k: string) => {
    const e = CAMPOS_DE_CONTACTO.find((x) => x.k === k)?.etiqueta ?? etiquetaDeCampo(k);
    return e.charAt(0).toUpperCase() + e.slice(1);
  };
  const head = [
    'Nombre', 'Teléfono', 'Canal', 'Etapa', 'Puntaje', 'Temperatura', 'Qué busca', 'Ocasión', 'Fecha del evento',
    'Presupuesto', 'Ciudad', 'Etiquetas', 'Notas', 'Resumen', 'Primer contacto', 'Último mensaje', ...extra.map(rotulo),
  ];
  const lines = listContacts({ limit: 100000 }).map((c) =>
    row([
      c.name ?? '',
      contactNumber(c) ? `+${contactNumber(c)}` : (c.phone ?? ''),
      c.channel,
      STAGE_LABELS[c.stage] ?? c.stage,
      c.score,
      TEMP(c.score),
      data(c, 'prenda') || data(c, 'servicio'),
      data(c, 'ocasion'),
      data(c, 'fecha_evento'),
      data(c, 'presupuesto'),
      data(c, 'ciudad'),
      c.tags.join(', '),
      c.notes,
      c.summary ?? '',
      stamp(c.firstSeen),
      stamp(c.lastMessageAt),
      ...extra.map((k) => data(c, k)),
    ]),
  );
  return BOM + [row(head), ...lines].join('\r\n') + '\r\n';
}

const APPT_STATUS: Record<string, string> = {
  confirmada: 'Confirmada',
  cancelada: 'Cancelada',
  completada: 'Completada',
  no_asistio: 'No asistió',
};

/** Las citas como hoja de cálculo, de la más reciente a la más vieja. */
export function appointmentsCsv(): string {
  const head = ['Fecha y hora', 'Cliente', 'Teléfono', 'Servicio', 'Estado', 'Lugar', 'Recordatorio', 'Respuesta', 'Notas', 'Agendada'];
  const byId = new Map(listContacts({ limit: 100000 }).map((c) => [c.id, c]));
  const lines = listAppointments({ limit: 100000 })
    .slice()
    .sort((a, b) => b.startsAt - a.startsAt)
    .map((a) => {
      const c = byId.get(a.userId) ?? null;
      const number = c && contactNumber(c);
      return row([
        stamp(a.startsAt),
        a.contactName ?? c?.name ?? '',
        number ? `+${number}` : '',
        a.service,
        APPT_STATUS[a.status] ?? a.status,
        a.location ?? '',
        a.reminder?.status === 'enviado' ? 'Enviado' : a.reminder?.status === 'a_mano' ? 'A mano' : '',
        a.reply ?? '',
        a.notes,
        stamp(a.createdAt),
      ]);
    });
  return BOM + [row(head), ...lines].join('\r\n') + '\r\n';
}
