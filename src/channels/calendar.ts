// Rutas públicas del calendario: el enlace de suscripción (secreto) y la página "agregar a mi calendario" de cada cita.
import type { Hono } from 'hono';
import type { HttpBindings } from '@hono/node-server';
import { business } from '../config.js';
import { getAppointment } from '../crm/appointments.js';
import { FEED_TOKEN, appointmentIcs, appointmentsFeed, customerPage, validSig } from '../crm/calendar.js';

const ICS_HEADERS = { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'no-cache' };

export function mountCalendar(app: Hono<{ Bindings: HttpBindings }>) {
  app.get('/calendar/:file', (c) => {
    if (c.req.param('file') !== `${FEED_TOKEN}.ics`) return c.text('no encontrado', 404);
    return c.body(appointmentsFeed(), 200, { ...ICS_HEADERS, 'content-disposition': 'inline; filename="citas.ics"' });
  });

  app.get('/cita/:id/:file', (c) => {
    const id = Number(c.req.param('id'));
    const file = c.req.param('file');
    const sig = file.replace(/\.ics$/, '');
    const appt = Number.isInteger(id) ? getAppointment(id) : null;
    if (!appt || !validSig(id, sig)) return c.text('no encontrado', 404);
    if (file.endsWith('.ics')) {
      const name = business.business.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      return c.body(appointmentIcs(appt), 200, { ...ICS_HEADERS, 'content-disposition': `attachment; filename="cita-${name || 'aiva'}.ics"` });
    }
    return c.html(customerPage(appt));
  });
}
