// API del tablero de administración (bandeja, pipeline, citas, análisis, agente, conocimiento) + eventos en vivo.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Hono } from 'hono';
import type { HttpBindings } from '@hono/node-server';
import { streamSSE } from 'hono/streaming';
import { business, env } from '../config.js';
import { engineStatus, roleLabel } from '../llm/engines.js';
import { countDocs, getDb } from '../rag/store.js';
import { getMessages } from '../agent/memory.js';
import { getContact, listContacts, listEvents, setHumanMode, setStage, stats, updateContact, STAGES, STAGE_LABELS, type Stage } from '../crm/contacts.js';
import { analyzeContact, listAnalyses, temperature } from '../crm/analyzer.js';
import { availableSlots, bookAppointment, formatSlot, listAppointments, setReminder, updateAppointment } from '../crm/appointments.js';
import { replyWindow, sendToContact, WINDOW_CLOSED } from '../crm/outbox.js';
import { reminderTime, remindersBoard } from '../crm/reminders.js';
import { onEvent } from '../crm/events.js';
import { listNotifications, startNotifications } from '../crm/notifications.js';
import { usageSummary } from '../llm/usage.js';
import { feedUrls } from '../crm/calendar.js';
import { busyIntervals, busyStatus } from '../crm/busy.js';
import { recap } from '../crm/recap.js';
import { channelCards, toggleChannel } from './registry.js';
import { saveMetaCredentials } from './meta-credentials.js';
import { getProfile, pendingFields, PROFILE_FIELDS, saveProfile } from '../profile.js';
import { indexProfile } from '../rag/profile-index.js';
import { exportDictionary, getDictionary, importDictionary } from '../agent/dictionary.js';
import { teachExpression } from '../agent/teach.js';
import { closeMisses, listMisses, MISS_KINDS, type MissKind } from '../crm/misses.js';
import { answerVerification, dismissVerification, listVerifications } from '../crm/verifications.js';
import type { ChannelId } from './switches.js';
import type { Contact } from '../crm/contacts.js';

/** Temperatura y recap (hechos de la ficha + próxima cita) para cada contacto que ve el tablero. */
function forBoard<T extends Contact>(list: T[]) {
  const next = new Map<string, ReturnType<typeof listAppointments>[number]>();
  for (const a of listAppointments({ from: Date.now(), status: 'confirmada', limit: 5000 })) if (!next.has(a.userId)) next.set(a.userId, a);
  return list.map((x) => ({ ...x, temperature: temperature(x.score), recap: recap(x, next.get(x.id) ?? null) }));
}

export const ADMIN_TOKEN = env.adminToken || randomBytes(12).toString('hex');

export function mountAdmin(app: Hono<{ Bindings: HttpBindings }>) {
  startNotifications();
  app.get('/admin', (c) => c.html(readFileSync(new URL('../../public/admin.html', import.meta.url), 'utf8')));
  app.get('/admin.js', (c) =>
    c.body(readFileSync(new URL('../../public/admin.js', import.meta.url), 'utf8'), 200, { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-cache' }),
  );

  app.use('/admin/api/*', async (c, next) => {
    const token = c.req.header('x-admin-token') ?? c.req.query('token');
    if (token !== ADMIN_TOKEN) return c.json({ error: 'no autorizado' }, 401);
    await next();
  });

  app.get('/admin/api/me', (c) => c.json({ ok: true, business: business.business.name, agent: business.agent.name }));

  app.get('/admin/api/contacts', (c) => {
    const stage = c.req.query('stage') as Stage | undefined;
    const q = c.req.query('q') || undefined;
    const human = c.req.query('human');
    const contacts = listContacts({ stage: stage && STAGES.includes(stage) ? stage : undefined, q, humanMode: human === undefined ? undefined : human === '1' });
    return c.json(forBoard(contacts));
  });

  app.get('/admin/api/contacts/:id', (c) => {
    const id = c.req.param('id');
    const contact = getContact(id);
    if (!contact) return c.json({ error: 'no existe' }, 404);
    updateContact(id, { unread: 0 }, { silent: true });
    return c.json({
      contact: { ...forBoard([contact])[0], unread: 0 },
      messages: getMessages(id, 300),
      analyses: listAnalyses(id, 10),
      events: listEvents(id, 50),
      appointments: listAppointments({ userId: id, limit: 20 }).map((a) => ({ ...a, label: formatSlot(new Date(a.startsAt)) })),
      replyWindow: replyWindow(id),
    });
  });

  app.patch('/admin/api/contacts/:id', async (c) => {
    const id = c.req.param('id');
    const body = (await c.req.json().catch(() => ({}))) as { name?: string; phone?: string; stage?: Stage; notes?: string; tags?: string[] };
    if (!getContact(id)) return c.json({ error: 'no existe' }, 404);
    if (body.stage) {
      if (!STAGES.includes(body.stage)) return c.json({ error: 'etapa inválida' }, 400);
      setStage(id, body.stage, { locked: true, by: 'admin' });
    }
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name.trim() || null;
    if (body.phone !== undefined) patch.phone = body.phone.trim() || null;
    if (body.notes !== undefined) patch.notes = body.notes;
    if (Array.isArray(body.tags)) patch.tags = body.tags.map((t) => String(t).trim()).filter(Boolean);
    const contact = updateContact(id, patch);
    return c.json({ contact });
  });

  app.post('/admin/api/contacts/:id/human', async (c) => {
    const id = c.req.param('id');
    const body = (await c.req.json().catch(() => ({}))) as { on?: boolean };
    if (!getContact(id)) return c.json({ error: 'no existe' }, 404);
    const contact = setHumanMode(id, Boolean(body.on), 'admin');
    return c.json({ contact });
  });

  app.post('/admin/api/contacts/:id/reply', async (c) => {
    const id = c.req.param('id');
    const body = (await c.req.json().catch(() => ({}))) as { text?: string; by?: string };
    const text = body.text?.toString().trim();
    if (!text) return c.json({ error: 'text requerido' }, 400);
    const contact = getContact(id);
    if (!contact) return c.json({ error: 'no existe' }, 404);
    const by = body.by?.toString().trim().slice(0, 40) || 'equipo';
    if (!replyWindow(id).open) return c.json({ error: WINDOW_CLOSED }, 409); // antes de tomar el control
    if (!contact.humanMode) setHumanMode(id, true, by); // responder a mano toma el control
    try {
      await sendToContact(id, text, 'human', { by });
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.post('/admin/api/contacts/:id/analyze', async (c) => {
    const id = c.req.param('id');
    if (!getContact(id)) return c.json({ error: 'no existe' }, 404);
    await analyzeContact(id, { full: true });
    return c.json({ contact: getContact(id), analyses: listAnalyses(id, 1) });
  });

  app.get('/admin/api/appointments', (c) => {
    const from = c.req.query('from') ? Number(c.req.query('from')) : Date.now() - 86400_000;
    const to = c.req.query('to') ? Number(c.req.query('to')) : undefined;
    const status = c.req.query('status') || undefined;
    return c.json(listAppointments({ from, to, status, limit: 500 }).map((a) => ({ ...a, label: formatSlot(new Date(a.startsAt)) })));
  });

  // Consumo de los modelos (tokens y costo estimado) de los últimos N días.
  app.get('/admin/api/usage', (c) => c.json(usageSummary(Date.now() - Math.min(90, Number(c.req.query('days') ?? 7)) * 86400_000)));

  // "Deja te verifico eso": responder (le llega al cliente sin quitarle la conversación al bot) o descartar.
  app.post('/admin/api/verifications/:id/answer', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { answer?: string; by?: string; learn?: boolean };
    const answer = body.answer?.toString().trim();
    if (!answer) return c.json({ error: 'Escribe la respuesta para el cliente.' }, 400);
    try {
      const v = await answerVerification(Number(c.req.param('id')), answer, body.by?.toString().trim().slice(0, 40) || 'equipo', { learn: Boolean(body.learn) });
      return c.json({ verification: v });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });
  app.post('/admin/api/verifications/:id/dismiss', (c) => c.json({ verification: dismissVerification(Number(c.req.param('id'))) }));

  // Diccionario del negocio: ver, exportar e importar (sumar o reemplazar). Se aplica sin reiniciar.
  app.get('/admin/api/dictionary', (c) => c.json({ file: business.dictionaryFile, ...getDictionary() }));
  app.get('/admin/api/dictionary/export', (c) => {
    const slug = business.business.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return c.body(JSON.stringify(exportDictionary(), null, 2) + '\n', 200, {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="diccionario-${slug || 'aiva'}.json"`,
    });
  });
  app.post('/admin/api/dictionary/import', async (c) => {
    const raw = await c.req.text();
    if (raw.length > 300_000) return c.json({ errors: ['El archivo es demasiado grande (máximo 300 KB).'] }, 400);
    let body: { mode?: string; dictionary?: unknown };
    try {
      body = JSON.parse(raw);
    } catch {
      return c.json({ errors: ['El archivo no es un JSON válido.'] }, 400);
    }
    const mode = body.mode === 'replace' ? 'replace' : 'merge';
    try {
      const r = importDictionary(body.dictionary, mode);
      return c.json({ file: business.dictionaryFile, backup: r.backup, ...r.dictionary });
    } catch (err) {
      return c.json({ errors: (err as Error).message.split('\n') }, 400);
    }
  });

  // Perfil del negocio (Configuración › Perfil): lo confirmado va al bot; lo vacío queda por confirmar.
  app.get('/admin/api/profile', (c) =>
    c.json({ file: business.profileFile, profile: getProfile(), fields: PROFILE_FIELDS, pending: pendingFields(), agentName: business.agent.name, verifyPhrase: business.agent.verifyPhrase }),
  );
  app.post('/admin/api/profile', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { profile?: unknown };
    try {
      const r = saveProfile(body.profile);
      const indexed = await indexProfile();
      return c.json({ profile: r.profile, backup: r.backup, pending: pendingFields(r.profile), indexed });
    } catch (err) {
      return c.json({ errors: (err as Error).message.split('\n') }, 400);
    }
  });

  // Frases que no entendimos: se enseñan como expresiones del diccionario o se marcan como revisadas.
  app.get('/admin/api/misses', (c) => c.json({ groups: listMisses() }));
  const missBody = async (c: { req: { json: () => Promise<unknown> } }) => {
    const b = (await c.req.json().catch(() => ({}))) as { kind?: string; key?: string; says?: string; means?: string };
    const kind = MISS_KINDS.find((k) => k === b.kind);
    return kind && b.key ? { kind: kind as MissKind, key: b.key.toString(), says: b.says?.toString() ?? '', means: b.means?.toString() ?? '' } : null;
  };
  app.post('/admin/api/misses/review', async (c) => {
    const b = await missBody(c);
    if (!b) return c.json({ error: 'falta la frase' }, 400);
    return c.json({ closed: closeMisses(b.kind, b.key, 'revisada') });
  });
  app.post('/admin/api/misses/teach', async (c) => {
    const b = await missBody(c);
    if (!b) return c.json({ error: 'falta la frase' }, 400);
    if (!b.says.trim() || !b.means.trim()) return c.json({ ok: false, reason: 'Escribe qué dice el cliente y qué quiere decir.' }, 400);
    const r = teachExpression(b.kind, b.key, b.says, b.means);
    return c.json(r, r.ok ? 200 : 422);
  });

  // Canales: estado, actividad y qué falta; encender o apagar sin reiniciar.
  app.get('/admin/api/channels', (c) => c.json(channelCards()));
  // Credenciales de WhatsApp oficial: se verifican con Meta, van a .env y se aplican sin reiniciar.
  app.post('/admin/api/channels/meta/credentials', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const r = await saveMetaCredentials(body as never);
    return r.ok ? c.json({ ...r, cards: channelCards() }) : c.json(r, 400);
  });

  app.post('/admin/api/channels/:id', async (c) => {
    const id = c.req.param('id') as ChannelId;
    if (!['web', 'whatsapp', 'meta', 'mcp'].includes(id)) return c.json({ error: 'canal desconocido' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { on?: boolean };
    if (typeof body.on !== 'boolean') return c.json({ error: 'on requerido' }, 400);
    try {
      await toggleChannel(id, body.on);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
    return c.json(channelCards());
  });

  // Enlace de suscripción y estado de los calendarios del dueño que bloquean la agenda.
  app.get('/admin/api/calendar', (c) => c.json({ feed: feedUrls(), busy: busyStatus() }));
  app.get('/admin/api/busy', (c) => c.json(busyIntervals(Number(c.req.query('from') ?? Date.now()), Number(c.req.query('to') ?? Date.now() + 7 * 86400_000))));

  app.get('/admin/api/slots', (c) => {
    const weekday = c.req.query('weekday') !== undefined ? Number(c.req.query('weekday')) : undefined;
    const count = Number(c.req.query('count') ?? 8);
    return c.json(availableSlots({ count, weekday, spreadDays: false }).map((s) => ({ startsAt: s.startsAt.toISOString(), label: formatSlot(s.startsAt) })));
  });

  app.post('/admin/api/appointments', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { userId?: string; startsAt?: string; notes?: string };
    if (!body.userId || !body.startsAt) return c.json({ error: 'userId y startsAt requeridos' }, 400);
    if (!getContact(body.userId)) return c.json({ error: 'contacto no existe' }, 404);
    try {
      const appt = bookAppointment(body.userId, new Date(body.startsAt), { notes: body.notes ?? 'Agendada desde el tablero', by: 'admin' });
      return c.json({ appointment: { ...appt, label: formatSlot(new Date(appt.startsAt)) } });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 409);
    }
  });

  app.patch('/admin/api/appointments/:id', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { status?: 'confirmada' | 'cancelada' | 'completada' | 'no_asistio'; notes?: string };
    const appt = updateAppointment(Number(c.req.param('id')), body, 'admin');
    if (!appt) return c.json({ error: 'no existe' }, 404);
    return c.json({ appointment: { ...appt, label: formatSlot(new Date(appt.startsAt)) } });
  });

  // Recordatorio hecho a mano (por WhatsApp desde el teléfono del negocio): sale de "Recordar a mano".
  app.post('/admin/api/appointments/:id/reminded', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { by?: string };
    const appt = setReminder(Number(c.req.param('id')), 'enviado', `A mano, por ${body.by?.toString().trim().slice(0, 40) || 'el equipo'}`);
    return appt ? c.json({ appointment: appt }) : c.json({ error: 'no existe' }, 404);
  });

  app.get('/admin/api/stats', (c) => c.json({ ...stats(), stageLabels: STAGE_LABELS }));

  // Vista "Hoy": lo que un asesor debe atender primero, cada fila abre la conversación.
  app.get('/admin/api/today', (c) => {
    const now = Date.now();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = startOfDay.getTime() + 86400_000;
    const all = forBoard(listContacts({ limit: 1000 }));
    const lastFromCustomer = new Set(
      (getDb().prepare("SELECT user_id FROM messages m WHERE role = 'user' AND ts = (SELECT MAX(ts) FROM messages WHERE user_id = m.user_id)").all() as { user_id: string }[]).map((r) => r.user_id),
    );
    const open = all.filter((x) => !['vendido', 'perdido'].includes(x.stage)); // las cerradas no piden acción
    const withUpcoming = new Set(listAppointments({ from: now, status: 'confirmada', limit: 1000 }).map((a) => a.userId));
    return c.json({
      appointments: listAppointments({ from: startOfDay.getTime(), to: endOfDay, status: 'confirmada' }).map((a) => ({ ...a, label: formatSlot(new Date(a.startsAt), { withDay: false }), remindAt: reminderTime(a.startsAt) })),
      // Recordatorios que no se pudieron enviar solos: el texto y el número para hacerlo desde el teléfono.
      remind: remindersBoard(now).filter((a) => a.reminder?.status === 'a_mano'),
      // Esperan respuesta de una persona: la última palabra la tiene el cliente (bot en pausa o bot que no respondió).
      unanswered: open.filter((x) => lastFromCustomer.has(x.id)).slice(0, 20),
      unread: open.filter((x) => x.unread > 0 && !lastFromCustomer.has(x.id)).slice(0, 20),
      handoffs: open.filter((x) => x.humanMode).slice(0, 20),
      // Calientes abandonados: sin mensajes en 24 h y sin una cita ya agendada (esa ya es seguimiento).
      hot: open.filter((x) => x.score >= 60 && !withUpcoming.has(x.id) && (x.lastMessageAt ?? 0) < now - 24 * 3600_000).slice(0, 20),
      upcoming: listAppointments({ from: endOfDay, to: endOfDay + 3 * 86400_000, status: 'confirmada' }).map((a) => ({ ...a, label: formatSlot(new Date(a.startsAt)), remindAt: reminderTime(a.startsAt) })),
      // Lo que el bot no supo y prometió verificar: el cliente espera la respuesta del equipo.
      verifications: listVerifications('pendiente').map((v) => ({ ...v, window: replyWindow(v.userId) })),
    });
  });

  app.get('/admin/api/notifications', (c) => c.json(listNotifications(Number(c.req.query('limit') ?? 30))));

  app.get('/admin/api/agent', (c) =>
    c.json({
      business: business.business,
      agent: business.agent,
      appointments: business.appointments,
      crmFields: business.crm.fields,
      timezone: business.timezone,
      engines: engineStatus(),
      roles: { mode: env.llmEngine, light: roleLabel('light'), heavy: roleLabel('heavy'), gate: roleLabel('gate'), analysis: roleLabel('analysis') },
      models: { chat: env.chatModel, embed: env.embedModel, openai: env.openaiModel },
      docs: countDocs(),
      publicUrl: env.publicUrl || `http://localhost:${env.port}`,
    }),
  );

  app.get('/admin/api/knowledge', (c) => {
    const q = (c.req.query('q') || '').trim();
    const kind = c.req.query('kind') || 'knowledge';
    const rows = q
      ? (getDb()
          .prepare(`SELECT id, kind, title, content, url FROM docs WHERE kind = ? AND (title LIKE ? OR content LIKE ?) ORDER BY title LIMIT 100`)
          .all(kind, `%${q}%`, `%${q}%`) as { id: string; kind: string; title: string; content: string; url: string | null }[])
      : (getDb().prepare(`SELECT id, kind, title, content, url FROM docs WHERE kind = ? ORDER BY title LIMIT 200`).all(kind) as {
          id: string;
          kind: string;
          title: string;
          content: string;
          url: string | null;
        }[]);
    return c.json(rows);
  });

  app.get('/admin/api/stream', (c) =>
    streamSSE(c, async (stream) => {
      let closed = false;
      const off = onEvent((ev) => {
        if (closed) return;
        void stream.writeSSE({ event: ev.type, data: JSON.stringify(ev) }).catch(() => undefined);
      });
      stream.onAbort(() => {
        closed = true;
        off();
      });
      await stream.writeSSE({ event: 'hello', data: JSON.stringify({ ts: Date.now() }) });
      while (!closed) {
        await stream.sleep(25_000);
        if (!closed) await stream.writeSSE({ event: 'ping', data: '' }).catch(() => undefined);
      }
    }),
  );
}
