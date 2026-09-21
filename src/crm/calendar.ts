// Citas en formato iCalendar (RFC 5545), sin dependencias ni tokens de IA:
// - un enlace de suscripción con todas las citas, para verlas en Google Calendar, Outlook o Apple Calendar;
// - "agregar a mi calendario" para el cliente: Google, Outlook.com y archivo .ics (iPhone, Mac, Outlook).
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { business, env } from '../config.js';
import { accentOn, logoUrl, onBrand } from '../brand.js';
import { formatSlot, listAppointments, nextAppointmentFor, type Appointment } from './appointments.js';
import { recap } from './recap.js';
import { getContact } from './contacts.js';

// Firma de los enlaces: estable mientras no cambien CALENDAR_TOKEN / ADMIN_TOKEN (si ambos están vacíos, cambia al reiniciar).
const SECRET = env.calendarToken || env.adminToken || randomBytes(16).toString('hex');
const sign = (s: string) => createHmac('sha256', SECRET).update(s).digest('base64url');

/** Token del enlace de suscripción: CALENDAR_TOKEN o derivado del secreto. */
export const FEED_TOKEN = env.calendarToken || sign('feed').slice(0, 24);
export const appointmentSig = (id: number) => sign(`cita:${id}`).slice(0, 16);

export function validSig(id: number, sig: string): boolean {
  const a = Buffer.from(appointmentSig(id));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------- Formato ----------
const escapeText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
/** Líneas de máximo 75 bytes; las siguientes empiezan con un espacio (sin partir caracteres UTF-8). */
function foldLine(line: string): string {
  if (Buffer.byteLength(line) <= 75) return line;
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > 75) {
      out.push(cur);
      cur = ' ';
      bytes = 1;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join('\r\n');
}
const utc = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const host = () => {
  try {
    return env.publicUrl ? new URL(env.publicUrl).host : 'aiva.local';
  } catch {
    return 'aiva.local';
  }
};
export const customerTitle = (a: Appointment) => `${cap(a.service)} · ${business.business.name}`;

function vevent(a: Appointment, audience: 'team' | 'customer'): string[] {
  const lines = ['BEGIN:VEVENT', `UID:aiva-appt-${a.id}@${host()}`, `DTSTAMP:${utc(Date.now())}`, `DTSTART:${utc(a.startsAt)}`, `DTEND:${utc(a.endsAt)}`];
  if (audience === 'team') {
    // Para el equipo: quién viene y qué busca, con el enlace a la conversación.
    const c = getContact(a.userId);
    const who = a.contactName || c?.name || 'Cliente';
    const data = c ? Object.entries(c.data).filter(([k, v]) => typeof v === 'string' && v && !['booking', 'nombre'].includes(k)) : [];
    const details = [
      c?.phone ? `Teléfono: ${c.phone}` : '',
      c ? recap(c, nextAppointmentFor(c.id)) : '',
      c?.summary ?? '',
      ...data.map(([k, v]) => `${k.replace(/_/g, ' ')}: ${String(v)}`),
      a.notes,
      env.publicUrl ? `Conversación: ${env.publicUrl}/admin#c=${encodeURIComponent(a.userId)}` : '',
    ].filter(Boolean);
    lines.push(`SUMMARY:${escapeText(`${who} · ${a.service}`)}`);
    if (details.length) lines.push(`DESCRIPTION:${escapeText(details.join('\n'))}`);
  } else {
    lines.push(`SUMMARY:${escapeText(customerTitle(a))}`);
    lines.push(`DESCRIPTION:${escapeText(`Cualquier cambio: ${business.business.humanContact}`)}`);
  }
  if (a.location) lines.push(`LOCATION:${escapeText(a.location)}`);
  lines.push(`STATUS:${a.status === 'cancelada' ? 'CANCELLED' : 'CONFIRMED'}`, `SEQUENCE:${a.status === 'confirmada' ? 0 : 1}`);
  if (audience === 'customer' && a.status === 'confirmada') {
    for (const trigger of ['-P1D', '-PT2H']) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(customerTitle(a))}`, `TRIGGER:${trigger}`, 'END:VALARM');
    }
  }
  lines.push('END:VEVENT');
  return lines;
}

function vcalendar(name: string, events: string[][], extra: string[] = []): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//Aiva//${escapeText(business.business.name)}//ES`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
    `X-WR-TIMEZONE:${business.timezone}`,
    ...extra,
    ...events.flat(),
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

/** Todas las citas desde hace 60 días (las canceladas van como CANCELLED para que desaparezcan del calendario). */
export function appointmentsFeed(): string {
  const list = listAppointments({ from: Date.now() - 60 * 86400_000, limit: 5000 });
  // Apple respeta REFRESH-INTERVAL; Google refresca cuando quiere (horas), Outlook cada pocas horas.
  return vcalendar(`Citas · ${business.business.name}`, list.map((a) => vevent(a, 'team')), ['REFRESH-INTERVAL;VALUE=DURATION:PT15M', 'X-PUBLISHED-TTL:PT15M']);
}

/** Una cita para el calendario del cliente, con recordatorios un día y dos horas antes. */
export function appointmentIcs(a: Appointment): string {
  return vcalendar(business.business.name, [vevent(a, 'customer')]);
}

// ---------- Enlaces ----------
export function feedUrls(): { https: string; webcal: string; public: boolean } {
  const base = env.publicUrl || `http://localhost:${env.port}`;
  const https = `${base}/calendar/${FEED_TOKEN}.ics`;
  return { https, webcal: https.replace(/^https?:/, 'webcal:'), public: Boolean(env.publicUrl) };
}

export interface CustomerLinks {
  page: string;
  ics: string;
  google: string;
  outlook: string;
}

/** Enlaces para que el cliente guarde su cita; null sin PUBLIC_URL (un enlace a localhost no le sirve). */
export function customerLinks(a: Appointment, opts: { local?: boolean } = {}): CustomerLinks | null {
  if (!env.publicUrl && !opts.local) return null;
  const base = `${env.publicUrl || `http://localhost:${env.port}`}/cita/${a.id}/${appointmentSig(a.id)}`;
  const details = `Cualquier cambio: ${business.business.humanContact}`;
  const g = new URL('https://calendar.google.com/calendar/render');
  g.searchParams.set('action', 'TEMPLATE');
  g.searchParams.set('text', customerTitle(a));
  g.searchParams.set('dates', `${utc(a.startsAt)}/${utc(a.endsAt)}`);
  g.searchParams.set('ctz', business.timezone);
  g.searchParams.set('details', details);
  if (a.location) g.searchParams.set('location', a.location);
  const o = new URL('https://outlook.live.com/calendar/0/deeplink/compose');
  o.searchParams.set('path', '/calendar/action/compose');
  o.searchParams.set('rru', 'addevent');
  o.searchParams.set('subject', customerTitle(a));
  o.searchParams.set('startdt', new Date(a.startsAt).toISOString());
  o.searchParams.set('enddt', new Date(a.endsAt).toISOString());
  o.searchParams.set('body', details);
  if (a.location) o.searchParams.set('location', a.location);
  return { page: base, ics: `${base}.ics`, google: g.toString(), outlook: o.toString() };
}

const html = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/**
 * Página que abre el cliente desde WhatsApp: su cita y un botón por calendario.
 * Sigue el tema del sistema a propósito: es una utilidad de calendario, no una pieza de marca (aiva todavía no
 * tiene la piel de cada cliente). Cuando la tenga, esta página debe usarla fija, como toda superficie de marca.
 */
export function customerPage(a: Appointment): string {
  const links = customerLinks(a, { local: true })!;
  const ics = `${appointmentSig(a.id)}.ics`; // relativo: funciona detrás de cualquier túnel
  const cancelled = a.status === 'cancelada';
  const buttons = cancelled
    ? '<p class="note">Esta cita fue cancelada.</p>'
    : `<a class="btn primary" href="${html(links.google)}">Google Calendar</a>
    <a class="btn" href="${html(ics)}">iPhone o Mac (Apple Calendar)</a>
    <a class="btn" href="${html(ics)}">Outlook en el computador</a>
    <a class="btn" href="${html(links.outlook)}">Outlook.com</a>`;
  // La marca del cliente, con el contraste ajustado en claro y en oscuro.
  const color = business.brand.color;
  const light = onBrand(color);
  const dark = onBrand(accentOn(color, '#171a21', 3));
  const logo = logoUrl();
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${html(customerTitle(a))}</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--text:#111827;--muted:#4b5563;--brand:${light.bg};--on-brand:${light.text};--focus:${accentOn(color, '#ffffff', 3)};--line:#d6d9de}
@media (prefers-color-scheme:dark){:root{--bg:#0b0d12;--card:#171a21;--text:#e5e7eb;--muted:#aab2bf;--brand:${dark.bg};--on-brand:${dark.text};--focus:${accentOn(color, '#171a21', 3)};--line:#2a2f39}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:flex;justify-content:center;padding:24px 16px}
main{width:100%;max-width:420px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:24px}
h1{font-size:20px;margin:0 0 4px}.when{font-size:18px;font-weight:600;margin:16px 0 4px}.where,.note{color:var(--muted);margin:0 0 20px}
.btn{display:flex;align-items:center;justify-content:center;min-height:48px;margin-top:10px;border-radius:12px;border:1px solid var(--line);color:var(--text);text-decoration:none;font-weight:600}
.btn.primary{background:var(--brand);border-color:var(--brand);color:var(--on-brand)}
.btn:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
.logo{display:block;width:64px;height:64px;border-radius:50%;object-fit:cover;margin:0 0 12px;border:1px solid var(--line)}
</style></head><body><main>
${logo ? `<img class="logo" src="${html(logo)}" alt="">` : ''}
<h1>${html(business.business.name)}</h1>
<p class="where">${html(cap(a.service))}</p>
<p class="when">${html(cap(formatSlot(new Date(a.startsAt)))).replace(/ ([ap])\. m\./g, '&nbsp;$1.&nbsp;m.')}</p>
${a.location ? `<p class="where">${html(a.location)}</p>` : ''}
${buttons}
</main></body></html>`;
}
