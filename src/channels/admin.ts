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
import { contactNumber, deleteContact, estaCerrada, getContact, listContacts, messageHit, listEvents, setArchived, setHumanMode, setStage, stats, updateContact, STAGES, STAGE_DEFS, STAGE_LABELS, type Stage } from '../crm/contacts.js';
import { analyzeContact, listAnalyses, temperature } from '../crm/analyzer.js';
import { availableSlots, bookAppointment, formatSlot, listAppointments, setReminder, updateAppointment } from '../crm/appointments.js';
import { replyWindow, sendToContact, WINDOW_CLOSED } from '../crm/outbox.js';
import { appointmentsCsv, contactsCsv } from '../crm/export.js';
import { isSnoozed, snoozeFollowup } from '../crm/followup.js';
import { reminderTime, remindersBoard } from '../crm/reminders.js';
import { onEvent } from '../crm/events.js';
import { listNotifications, startNotifications } from '../crm/notifications.js';
import { usageSummary } from '../llm/usage.js';
import { entrar as entrarALaConversacion, salir as salirDeLaConversacion, quienesEstan } from '../crm/presencia.js';
import { actividadPorHora, nuevasPorDia, semanaContraSemana } from '../crm/series.js';
import { horarioDelNegocio, resumenTiempos } from '../crm/tiempos.js';
import { origenDe, porCampana } from '../crm/origen.js';
import { aQuienAvisar, loQueHayQueAvisar } from '../crm/vigilante.js';
import { conFirma, enviarSuelto } from '../crm/outbox.js';
import { getSetting, setSetting } from '../crm/settings.js';
import { accentOn, logoUrl } from '../brand.js';
import { runIngest } from '../rag/ingest.js';
import { archivoDemo, cargar as cargarDemo, cuantas as cuantasDemo, quitar as quitarDemo } from '../crm/demo.js';
import { cuantas as cuantasImportadas, importarChat, importarMensajes, quitar as quitarImportadas } from '../crm/importar.js';
import { armar as armarRespaldo, restaurar as restaurarRespaldo, revisar as revisarRespaldo } from '../crm/respaldo.js';
import { join, resolve } from 'node:path';
import { ajustesDe, ajustesEnDisco, alDia, comoSeLee, guardar as guardarAjustes, puedeReiniciarse, ZONAS_HORARIAS } from '../ajustes.js';
import { feedUrls } from '../crm/calendar.js';
import { busyIntervals, busyStatus } from '../crm/busy.js';
import { recap } from '../crm/recap.js';
import { channelCards, toggleChannel } from './registry.js';
import { diagnosticoDeSalida } from './salida.js';
// Solo el estado; lo que abre la sesión se carga dentro de los handlers que lo necesitan.
import { cierres } from './whatsapp-estado.js';
import { anotarEstadoPuente, recogerSalida, sinEntregar, type EstadoPuente } from './puente.js';
import { channelOn } from './switches.js';
import { handleMessage } from '../agent/agent.js';
import { saveMetaCredentials } from './meta-credentials.js';
import { checkPublicUrl, publicStatus } from './public-check.js';
import { backupNow, backupStatus } from '../rag/backup.js';
import { findDuplicates, keeperOf, mergeContacts } from '../crm/merge.js';
import { getProfile, pendingFields, PROFILE_FIELDS, saveProfile } from '../profile.js';
import { exportarAprendizaje, restaurarAprendizaje, revisarAprendizaje } from '../crm/aprendizaje.js';
import { chatsImportados, borrarImportado, decidirTema, expresionesCandidatas, guardarImportados, leerChatExportado, muestraDeEstilo, resumenImportado, temasFrecuentes, vocabularioDelNegocio, mensajesDeChat } from '../crm/historial.js';
import { ruleReading } from '../agent/teach.js';
import { indexProfile } from '../rag/profile-index.js';
import { exportDictionary, getDictionary, importDictionary } from '../agent/dictionary.js';
import { teachExpression } from '../agent/teach.js';
import { closeMisses, listMisses, noteMiss, MISS_KINDS, type MissKind } from '../crm/misses.js';
import { answerVerification, dismissVerification, listVerifications } from '../crm/verifications.js';
import { setSoloEscucha, soloEscucha as soloEscuchaDe, type ChannelId } from './switches.js';
import type { Contact } from '../crm/contacts.js';
import { cabecerasDeSiempre, soloDesdeAqui } from '../cabeceras.js';

/** Temperatura y recap (hechos de la ficha + próxima cita) para cada contacto que ve el tablero. */
function forBoard<T extends Contact>(list: T[]) {
  const next = new Map<string, ReturnType<typeof listAppointments>[number]>();
  for (const a of listAppointments({ from: Date.now(), status: 'confirmada', limit: 5000 })) if (!next.has(a.userId)) next.set(a.userId, a);
  return list.map((x) => ({ ...x, temperature: temperature(x.score), recap: recap(x, next.get(x.id) ?? null) }));
}

export const ADMIN_TOKEN = env.adminToken || randomBytes(12).toString('hex');

/** El nombre corto de este cliente, el mismo que usa el respaldo. */
const soyElCliente = (): string => (process.env.AIVA_SLUG ?? business.business.name).toLowerCase().replace(/[^a-z0-9]+/g, '-');

export function mountAdmin(app: Hono<{ Bindings: HttpBindings }>) {
  startNotifications();
  // Las mismas de la consola: el tablero también se puede meter en un marco ajeno, y sus descargas (los CSV)
  // no deben interpretarse como otra cosa.
  app.use('/admin', cabecerasDeSiempre);
  app.use('/admin.js', cabecerasDeSiempre);
  app.use('/admin/api/*', cabecerasDeSiempre);
  app.use('/admin/api/*', soloDesdeAqui);
  app.get('/admin', (c) => c.html(readFileSync(new URL('../../public/admin.html', import.meta.url), 'utf8')));
  app.get('/admin.js', (c) =>
    c.body(readFileSync(new URL('../../public/admin.js', import.meta.url), 'utf8'), 200, { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-cache' }),
  );

  app.use('/admin/api/*', async (c, next) => {
    // 🪤 El token por la dirección queda escrito en los registros de acceso del servidor, del túnel y de
    // cualquier proxy por delante. Se acepta SOLO en el flujo en vivo, que es lo único que no puede mandar
    // cabeceras (EventSource no las admite); todo lo demás va por cabecera o no entra.
    const porLaUrl = c.req.path.endsWith('/admin/api/stream') ? c.req.query('token') : undefined;
    const token = c.req.header('x-admin-token') ?? porLaUrl;
    if (token !== ADMIN_TOKEN) return c.json({ error: 'no autorizado' }, 401);
    await next();
  });

  app.get('/admin/api/me', (c) =>
    c.json({
      ok: true,
      business: business.business.name,
      agent: business.agent.name,
      // Para que el tablero se sienta del negocio: su logo y su color, no los de aiva.
      logo: logoUrl(),
      color: business.brand.color,
      // 🪤 El color de una marca casi nunca se lee como texto: el dorado de una boutique da 2.2:1 sobre papel.
      // Se manda ya ajustado al mínimo legible sobre cada fondo, en vez de dejar que la pantalla lo resuelva mal.
      colorClaro: accentOn(business.brand.color, '#f3f1ea'),
      colorOscuro: accentOn(business.brand.color, '#14120d'),
    }),
  );

  app.get('/admin/api/contacts', (c) => {
    const stage = c.req.query('stage') as Stage | undefined;
    const q = c.req.query('q') || undefined;
    const human = c.req.query('human');
    const contacts = listContacts({
      stage: stage && STAGES.includes(stage) ? stage : undefined,
      q,
      humanMode: human === undefined ? undefined : human === '1',
      archived: c.req.query('archived') === '1',
    });
    const board = forBoard(contacts);
    // Con búsqueda, cada fila trae el pedacito de conversación donde aparece lo buscado.
    return c.json(q ? board.map((b) => ({ ...b, hit: messageHit(b.id, q) })) : board);
  });

  app.get('/admin/api/contacts/:id', (c) => {
    const id = c.req.param('id');
    const contact = getContact(id);
    if (!contact) return c.json({ error: 'no existe' }, 404);
    updateContact(id, { unread: 0 }, { silent: true });
    return c.json({
      contact: { ...forBoard([contact])[0], unread: 0 },
      messages: getMessages(id, 300),
      // Lo que ya estaba conversado antes de que aiva entrara. Solo lo anterior al primer mensaje que tenemos
      // en la conversación: en el empalme, lo de en medio saldría dos veces.
      antes: (() => {
        const vivos = getMessages(id, 300);
        const desde = vivos.length ? vivos[0]!.ts : Infinity;
        return mensajesDeChat(id).filter((m) => m.ts < desde);
      })(),
      analyses: listAnalyses(id, 10),
      events: listEvents(id, 50),
      appointments: listAppointments({ userId: id, limit: 20 }).map((a) => ({ ...a, label: formatSlot(new Date(a.startsAt)) })),
      replyWindow: replyWindow(id),
      number: contactNumber(contact), // para escribirle o llamarlo desde el tablero
      presentes: quienesEstan(id), // quién más está metido aquí ahora mismo
      origen: origenDe(id), // por dónde llegó: sirve al atender y para saber qué anuncio trae clientes
    });
  });

  /**
   * Una mirada rápida a una conversación sin entrar en ella. Es igual que abrirla salvo en una cosa, y esa cosa
   * es todo el punto: **no la marca como leída**. Mirar para decidir si urge no es atender, y si el vistazo
   * borrara el «sin leer», la lista dejaría de decir la verdad sobre lo que falta por atender.
   */
  app.get('/admin/api/contacts/:id/vistazo', (c) => {
    const id = c.req.param('id');
    const contact = getContact(id);
    if (!contact) return c.json({ error: 'no existe' }, 404);
    return c.json({ contact: forBoard([contact])[0], messages: getMessages(id, 25) });
  });

  // Archivar (sale de las listas, vuelve si el cliente escribe) y borrar (no se deshace).
  app.post('/admin/api/contacts/:id/archive', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { on?: boolean };
    const contact = setArchived(c.req.param('id'), body.on !== false);
    return contact ? c.json({ contact }) : c.json({ error: 'no existe' }, 404);
  });
  app.delete('/admin/api/contacts/:id', (c) => (deleteContact(c.req.param('id')) ? c.json({ ok: true }) : c.json({ error: 'no existe' }, 404)));

  // Seguimiento pospuesto: sale de "Calientes sin seguimiento" hasta la fecha (por defecto, una semana).
  app.post('/admin/api/contacts/:id/snooze', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { days?: number };
    const done = snoozeFollowup(c.req.param('id'), body.days ?? 7);
    return done ? c.json(done) : c.json({ error: 'no existe' }, 404);
  });

  // Un mismo cliente por dos canales: fichas que parecen la misma persona, y unirlas en una sola.
  app.get('/admin/api/contacts/:id/duplicates', (c) => {
    const id = c.req.param('id');
    const me = getContact(id);
    if (!me) return c.json({ error: 'no existe' }, 404);
    return c.json(
      findDuplicates(id).map((d) => ({
        contact: { id: d.contact.id, channel: d.contact.channel, name: d.contact.name, lastMessageAt: d.contact.lastMessageAt, messageCount: d.contact.messageCount },
        reason: d.reason,
        keepId: keeperOf(me, d.contact).keep.id,
      })),
    );
  });
  app.post('/admin/api/contacts/:id/merge', async (c) => {
    const id = c.req.param('id');
    const body = (await c.req.json().catch(() => ({}))) as { with?: string };
    const me = getContact(id);
    const other = body.with ? getContact(body.with.toString()) : null;
    if (!me || !other) return c.json({ error: 'alguna de las dos fichas no existe' }, 404);
    try {
      const { keep, drop } = keeperOf(me, other);
      const contact = mergeContacts(keep.id, drop.id);
      return c.json({ contact, keptId: keep.id, droppedId: drop.id });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
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
    const body = (await c.req.json().catch(() => ({}))) as { on?: boolean; a?: string };
    if (!getContact(id)) return c.json({ error: 'no existe' }, 404);
    // `a` es a quién se le entrega. Sin nombre queda «del equipo», que es lo que pasaba antes siempre y deja a
    // todos mirándose: una conversación entregada a nadie no la recoge nadie.
    const aQuien = String(body.a ?? '').trim().slice(0, 40) || 'admin';
    const contact = setHumanMode(id, Boolean(body.on), aQuien);
    return c.json({ contact });
  });

  /**
   * Quién está metido en esta conversación ahora mismo. Se llama al abrirla y cada tanto mientras esté abierta;
   * con `salir` se sale a propósito. No bloquea a nadie: varias personas pueden atender a la vez, y esto es lo
   * que hace que se vean entre ellas en vez de pisarse.
   */
  app.post('/admin/api/contacts/:id/presencia', async (c) => {
    const id = c.req.param('id');
    if (!getContact(id)) return c.json({ error: 'no existe' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { by?: string; salir?: boolean };
    const quien = (body.by ?? '').trim();
    const presentes = body.salir ? salirDeLaConversacion(id, quien) : entrarALaConversacion(id, quien);
    return c.json({ presentes, otros: presentes.filter((p) => p.nombre !== quien) });
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

  /**
   * La configuración del negocio: nombre, asistente, marca, zona horaria y citas. Se edita aquí —y por lo tanto
   * desde la consola, que sirve este tablero— en vez de a mano en `aiva.config.json`.
   *
   * 🪤 Se lee al arrancar, así que guardar deja el archivo listo pero el proceso sigue con lo viejo hasta que
   * reinicie. Por eso se devuelve lo que corre, lo que está guardado y si hay quien lo levante al reiniciar.
   */
  app.get('/admin/api/config', (c) => {
    let guardado = null;
    try {
      guardado = ajustesEnDisco();
    } catch {
      /* el archivo quedó raro: se muestra lo que corre y ya */
    }
    return c.json({
      corriendo: ajustesDe(),
      guardado: guardado ?? ajustesDe(),
      alDia: alDia(),
      puedeReiniciarse: puedeReiniciarse(),
      zonas: ZONAS_HORARIAS,
    });
  });

  app.put('/admin/api/config', async (c) => {
    try {
      const r = guardarAjustes(await c.req.json());
      return c.json({ ok: true, ajustes: r.ajustes, hayQueReiniciar: r.hayQueReiniciar, puedeReiniciarse: puedeReiniciarse() });
    } catch (err) {
      return c.json({ error: comoSeLee(err) }, 400);
    }
  });

  /**
   * Reiniciar para que lo guardado se aplique. Solo donde hay quien lo vuelva a levantar (el arranque del paquete
   * o pm2): sin eso, salir dejaría al cliente sin atender a nadie.
   */
  app.post('/admin/api/config/restart', (c) => {
    if (!puedeReiniciarse()) return c.json({ error: 'aquí nadie lo volvería a levantar: reinícialo tú' }, 409);
    setTimeout(() => process.exit(0), 300); // le da tiempo a contestar
    return c.json({ ok: true });
  });

  /**
   * Lo que aprendimos de sus chats: el historial que trajo el cliente da **las preguntas** que le hacen y **cómo
   * atiende**, nunca los precios ni las políticas (docs/aprender-del-historial.md). Aceptar un tema lo manda al
   * Perfil como un dato *por confirmar*, para que el equipo escriba la respuesta de hoy.
   */
  app.get('/admin/api/historial', (c) =>
    c.json({
      resumen: resumenImportado(),
      temas: temasFrecuentes(),
      estilo: muestraDeEstilo(8),
      estiloActual: business.agent.style,
      expresiones: expresionesCandidatas({ conocidas: (t) => ruleReading('fecha', t) !== null, vocabulario: vocabularioDelNegocio() }),
    }),
  );

  /**
   * Las frases del historial que las reglas no entienden pasan a "Frases que no entendimos", donde ya existe el
   * camino para enseñarlas: alguien les pone el significado y solo se guardan si con eso el asistente ya entiende.
   */
  app.post('/admin/api/historial/expresiones', (c) => {
    const candidatas = expresionesCandidatas({ conocidas: (t) => ruleReading('fecha', t) !== null, vocabulario: vocabularioDelNegocio() });
    for (const e of candidatas) noteMiss('historial', e.kind, e.texto, { suggestion: e.pista ?? null });
    return c.json({ llevadas: candidatas.length, groups: listMisses() });
  });

  app.post('/admin/api/historial/tema', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { clave?: string; titulo?: string; estado?: 'aceptado' | 'descartado' };
    const titulo = body.titulo?.toString().trim().slice(0, 80);
    if (!body.clave || !titulo || !body.estado) return c.json({ error: 'falta el tema' }, 400);
    if (body.estado === 'aceptado') {
      const p = getProfile();
      if (!p.extras.some((x) => x.title.toLowerCase() === titulo.toLowerCase())) {
        // Entra sin texto: queda "por confirmar" y el asistente no lo supone hasta que el equipo lo llene.
        saveProfile({ ...p, extras: [...p.extras, { title: titulo, text: '' }] });
      }
    }
    decidirTema(body.clave, body.estado, titulo);
    return c.json({ temas: temasFrecuentes(), pending: pendingFields() });
  });

  // Importar un chat exportado de WhatsApp ("Exportar chat" da un .txt). Se lee y se guarda aparte; nada entra a
  // lo que el asistente sabe.
  app.post('/admin/api/historial/importar', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { texto?: string; delNegocio?: string[]; chat?: string };
    const texto = body.texto?.toString() ?? '';
    if (texto.trim().length < 20) return c.json({ error: 'Ese archivo viene vacío.' }, 400);
    const nombres = (body.delNegocio ?? []).map((s) => String(s).trim()).filter(Boolean);
    const mensajes = leerChatExportado(texto, { delNegocio: nombres.length ? nombres : [business.business.name], chat: body.chat });
    if (!mensajes.length) return c.json({ error: 'No reconocí el formato: debe ser el .txt de "Exportar chat" de WhatsApp.' }, 400);
    const nuevos = guardarImportados(mensajes, 'exportado');
    return c.json({ leidos: mensajes.length, nuevos, resumen: resumenImportado(), temas: temasFrecuentes() });
  });

  /**
   * Traer al tablero lo que se aprendió: cada chat del historial se vuelve una conversación con su ficha. Es
   * distinto de aprender —eso ya pasó—: esto es para que el equipo vea a su gente y pueda seguirles la pista.
   * Se puede deshacer: todo lo traído lleva el prefijo `wa:hist-` y se quita sin tocar nada real.
   */
  app.post('/admin/api/historial/al-tablero', (c) => {
    const chats = chatsImportados();
    if (!chats.length) return c.json({ error: 'todavía no hay historial que traer' }, 400);
    let fichas = 0;
    let mensajes = 0;
    for (const { chat, mensajes: lote } of chats) {
      // El nombre visible: cómo se llama quien escribe, y si no, su número.
      const suyo = lote.find((m) => m.role === 'user' && m.autor && !/^\d+$/.test(m.autor))?.autor;
      const nombre = suyo || chat.split('@')[0] || chat;
      try {
        const hecho = importarMensajes(lote, { nombre });
        fichas++;
        mensajes += hecho.mensajes;
      } catch {
        // Un chat sin nada legible no frena a los demás.
      }
    }
    return c.json({ ok: true, fichas, mensajes, enElTablero: cuantasImportadas() });
  });

  /**
   * Llevarse lo aprendido a otra instancia. Con `conversaciones=no` va solo lo decidido, que no lleva datos de
   * ningún cliente final: eso es lo que se puede mover sin pensárselo dos veces.
   */
  app.get('/admin/api/historial/exportar', (c) => {
    const conConversaciones = c.req.query('conversaciones') !== 'no';
    const datos = exportarAprendizaje({ slug: soyElCliente(), negocio: business.business.name, conConversaciones });
    const nombre = `aprendizaje-${soyElCliente()}-${new Date().toISOString().slice(0, 10)}${conConversaciones ? '' : '-sin-conversaciones'}.json`;
    return c.body(JSON.stringify(datos, null, 2), 200, {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${nombre}"`,
    });
  });

  app.post('/admin/api/historial/importar-aprendizaje', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { aprendizaje?: unknown; deOtroCliente?: boolean };
    const revisado = revisarAprendizaje(body.aprendizaje, soyElCliente());
    if ('error' in revisado) return c.json(revisado, 400);
    // 🪤 Lo de un negocio no entra en otro por descuido: hay que decir que sí a propósito.
    if (revisado.otroCliente && !body.deOtroCliente) {
      return c.json({
        error: `Ese aprendizaje es de «${revisado.aprendizaje.negocio}», no de este cliente. Cada negocio atiende como atiende; mezclarlos no da un asistente mejor. Si aun así lo quieres, vuelve a intentarlo confirmando.`,
        otroCliente: true,
        de: revisado.aprendizaje.negocio,
      }, 409);
    }
    const hecho = restaurarAprendizaje(revisado.aprendizaje);
    return c.json({ ok: true, ...hecho, resumen: resumenImportado() });
  });

  app.delete('/admin/api/historial', (c) => c.json({ borrados: borrarImportado() }));

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
  // Respaldo de la base: cuándo fue el último y "Respaldar ahora".
  // Llevarse los datos a una hoja de cálculo: son del negocio.
  app.get('/admin/api/export/:what', (c) => {
    const what = c.req.param('what');
    if (what !== 'contactos' && what !== 'citas') return c.json({ error: 'no existe' }, 404);
    const day = new Date().toISOString().slice(0, 10);
    return c.body(what === 'contactos' ? contactsCsv() : appointmentsCsv(), 200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${what}-${day}.csv"`,
    });
  });

  app.get('/admin/api/backup', (c) => c.json(backupStatus()));
  app.post('/admin/api/backup', (c) => {
    try {
      backupNow();
      return c.json(backupStatus());
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  // Dirección pública (el túnel): si responde, desde cuándo falla y por qué. "Revisar ahora" desde Canales.
  app.get('/admin/api/public', (c) => c.json(publicStatus()));
  app.post('/admin/api/public/check', async (c) => c.json(await checkPublicUrl()));

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

  /**
   * «Solo escuchar» de un canal: entra todo al CRM y contesta una persona. Se usa al enchufar el WhatsApp de un
   * negocio de verdad: primero se mira y se aprende, y se le da voz al asistente cuando el negocio lo diga.
   */
  app.post('/admin/api/channels/:id/escucha', async (c) => {
    const id = c.req.param('id') as ChannelId;
    if (!['web', 'whatsapp', 'meta', 'mcp'].includes(id)) return c.json({ error: 'canal desconocido' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { soloEscucha?: boolean };
    if (typeof body.soloEscucha !== 'boolean') return c.json({ error: 'soloEscucha requerido' }, 400);
    setSoloEscucha(id, body.soloEscucha);
    return c.json(channelCards());
  });

  /**
   * El pulso de WhatsApp de un vistazo: sirve para acompañar a alguien mientras vincula el número sin tener que
   * mirar cinco pantallas. Dice en qué punto va, si hay código esperando, cuántas conversaciones entraron y
   * cuánto historial lleva sincronizado.
   */
  app.get('/admin/api/whatsapp/pulso', (c) => {
    const wa = channelCards().find((x) => x.id === 'whatsapp');
    const desde = Date.now() - 86400_000;
    const db = getDb();
    const hoy = db.prepare("SELECT COUNT(*) n FROM messages WHERE ts > ? AND user_id LIKE 'wa:%'").get(desde) as { n: number };
    const gente = db.prepare("SELECT COUNT(DISTINCT user_id) n FROM messages WHERE ts > ? AND user_id LIKE 'wa:%'").get(desde) as { n: number };
    const ultimos = (db.prepare(
      "SELECT u.id, u.name, u.last_message_at, (SELECT content FROM messages WHERE user_id = u.id ORDER BY ts DESC LIMIT 1) ultimo FROM users u WHERE u.id LIKE 'wa:%' ORDER BY u.last_message_at DESC LIMIT 8",
    ).all() as { id: string; name: string | null; last_message_at: number | null; ultimo: string | null }[]).map((r) => ({
      quien: r.name || r.id.replace(/^wa:/, '').split('@')[0],
      cuando: r.last_message_at,
      ultimo: (r.ultimo ?? '').slice(0, 80),
    }));
    return c.json({
      estado: wa?.state ?? 'desconocido',
      detalle: wa?.detail ?? null,
      encendido: Boolean(wa?.on),
      soloEscucha: soloEscuchaDe('whatsapp'),
      esperandoCodigo: wa?.state === 'esperando_qr',
      conversaciones: (getDb().prepare("SELECT COUNT(*) n FROM users WHERE id LIKE 'wa:%'").get() as { n: number }).n,
      mensajes24h: hoy.n,
      personas24h: gente.n,
      historial: resumenImportado(),
      cierres,
      ultimos,
    });
  });

  /**
   * ¿Puede este servidor hablar con WhatsApp? Cuando el código QR no aparece, desde fuera no se distingue un
   * fallo del programa de una puerta cerrada en el alojamiento. Esto lo dice con datos.
   */
  app.get('/admin/api/whatsapp/salida', async (c) => c.json(await diagnosticoDeSalida()));

  /**
   * Desvincular y empezar de cero. Es la única forma de volver a recibir lo ya conversado, porque WhatsApp lo
   * manda solo al emparejar; y es también cómo se sale del atasco cuando cierran la sesión desde el teléfono.
   */
  /**
   * Traer más historial hacia atrás sin desvincular. Lo pedido llega después, solo, por el mismo camino que el
   * historial del emparejamiento.
   */
  app.post('/admin/api/whatsapp/mas-historial', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { porChat?: number; chats?: number };
    const porChat = Math.min(200, Math.max(10, Number(body.porChat) || 50));
    const cuantos = Math.min(100, Math.max(1, Number(body.chats) || 25));
    const { traerMasHistorial } = await import('./whatsapp.js');
    return c.json(await traerMasHistorial(porChat, cuantos));
  });

  app.post('/admin/api/whatsapp/desvincular', async (c) => {
    const { olvidarSesionWhatsApp } = await import('./whatsapp.js');
    await olvidarSesionWhatsApp();
    const body = (await c.req.json().catch(() => ({}))) as { volverAEncender?: boolean };
    if (body.volverAEncender !== false) await toggleChannel('whatsapp', true);
    return c.json(channelCards());
  });

  /**
   * El buzón del conector de WhatsApp (ver `channels/puente.ts`). Son tres llamadas y las hace siempre él, que
   * es quien puede: vive detrás del router de una casa y no tiene dirección a la que llamarle.
   */
  app.post('/admin/api/puente/estado', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { estado?: string; qr?: string; me?: string; error?: string };
    const estados = ['apagado', 'conectando', 'esperando_qr', 'conectado', 'sesion_cerrada'];
    if (!body.estado || !estados.includes(body.estado)) return c.json({ error: 'estado desconocido' }, 400);
    anotarEstadoPuente({ estado: body.estado as EstadoPuente['estado'], qr: body.qr, me: body.me, error: body.error });
    // De paso se le dice lo que necesita saber para actuar, y así el conector no consulta nada más.
    return c.json({ ok: true, debeEstarEncendido: channelOn('whatsapp'), soloEscucha: soloEscuchaDe('whatsapp'), traerHistorial: business.crm.stages.length > 0 && env.whatsappImportHistory, porEnviar: sinEntregar() });
  });

  app.post('/admin/api/puente/entrante', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { jid?: string; texto?: string; nombre?: string };
    const jid = String(body.jid ?? '').trim();
    const texto = String(body.texto ?? '').trim();
    if (!jid || !texto) return c.json({ error: 'falta el remitente o el texto' }, 400);
    if (texto.length > 4000) return c.json({ error: 'mensaje demasiado largo' }, 413);
    const respuesta = await handleMessage({
      userId: `wa:${jid}`,
      channel: 'whatsapp',
      text: texto,
      userName: body.nombre ? String(body.nombre).slice(0, 60) : null,
    });
    // Lo que el asistente conteste vuelve en la misma respuesta: el conector lo manda y se ahorra una vuelta.
    return c.json({ ok: true, responder: respuesta.silent || !respuesta.text ? null : conFirma(respuesta.text, 'bot', 'whatsapp') });
  });

  app.get('/admin/api/puente/salida', (c) => c.json({ mensajes: recogerSalida() }));

  /** Lo que ya estaba conversado, que el conector manda en tandas para que el negocio no empiece de cero. */
  app.post('/admin/api/puente/historial', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { mensajes?: { chat: string; autor: string; role: 'user' | 'assistant'; content: string; ts: number }[] };
    const lote = Array.isArray(body.mensajes) ? body.mensajes.slice(0, 2000) : [];
    if (!lote.length) return c.json({ nuevos: 0 });
    return c.json({ nuevos: guardarImportados(lote, 'whatsapp'), resumen: resumenImportado() });
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

  app.get('/admin/api/stats', (c) => c.json({ ...stats(), stageLabels: STAGE_LABELS, stages: STAGE_DEFS }));

  // Vista "Hoy": lo que un asesor debe atender primero, cada fila abre la conversación.
  /**
   * Las dos gráficas: de dónde llega la gente (nuevas por día y canal) y a qué horas escribe. Se calculan al
   * vuelo desde lo que ya está guardado; con miles de mensajes son milisegundos y no hay nada que mantener.
   */
  /**
   * Respaldo de la configuración: lo que costó construir, en un archivo. No lleva la base ni los secretos —ver
   * crm/respaldo.ts—, así que se puede guardar o mandar sin miedo.
   */
  const dondeVive = () => ({
    slug: (process.env.AIVA_SLUG ?? business.business.name).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    nombre: business.business.name,
    config: resolve(process.env.AIVA_CONFIG || 'aiva.config.json'),
    perfil: business.profileFile,
    diccionario: business.dictionaryFile,
    catalogo: business.sources.productsFile,
    conocimiento: business.sources.knowledgeDir,
  });

  app.get('/admin/api/respaldo', (c) => c.json(armarRespaldo(dondeVive())));

  app.post('/admin/api/respaldo', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { respaldo?: unknown; aunqueSeaDeOtro?: boolean };
    const donde = dondeVive();
    const revisado = revisarRespaldo(body.respaldo, donde.slug);
    if ('error' in revisado) return c.json({ error: revisado.error }, 400);
    if (revisado.otroCliente && !body.aunqueSeaDeOtro) {
      return c.json({ error: `ese respaldo es de "${revisado.respaldo.negocio}", no de este cliente`, otroCliente: true, de: revisado.respaldo.negocio }, 409);
    }
    try {
      const hecho = restaurarRespaldo(donde, revisado.respaldo, { carpetaCopias: resolve(join(donde.config, '..', 'respaldos')) });
      return c.json({ ok: true, ...hecho, hayQueReiniciar: true });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  /**
   * Volver a indexar el catálogo y lo que sabe el negocio. Hace falta después de restaurar un respaldo o de
   * cambiar archivos a mano: los documentos que no están indexados, para el asistente **no existen**.
   *
   * 🪤 Cuesta dinero: cada fragmento pasa por el modelo de vectores. Por eso es un botón, no algo automático.
   */
  /**
   * Conversaciones de demostración: para que un tablero recién montado no se vea desierto al mostrarlo.
   *
   * 🪤 Son datos falsos en la base de un cliente real. Lo importante es que se quitan exactamente: todo lo
   * sembrado lleva el prefijo `wa:seed-`, que ninguna conversación real puede tener.
   */
  app.get('/admin/api/demo', (c) =>
    c.json({
      cuantas: cuantasDemo(),
      hay: Boolean(archivoDemo()),
      // Para avisar antes de un demo: sin catálogo ni conocimiento indexados, el asistente dice "lo verifico" a
      // todo lo concreto y parece que no supiera nada.
      indice: countDocs(),
    }),
  );

  app.post('/admin/api/demo', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { on?: boolean };
    try {
      if (body.on === false) return c.json({ ok: true, quitadas: quitarDemo(), cuantas: cuantasDemo() });
      const cargadas = cargarDemo();
      return c.json({ ok: true, cargadas, cuantas: cuantasDemo() });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  /**
   * Traer un chat exportado de WhatsApp **como conversación** del tablero: el grupo de soporte de un cliente
   * queda con su ficha y su historial, no como un archivo que nadie vuelve a abrir.
   *
   * 🪤 Lo importado tapa credenciales antes de guardar (ver `crm/importar.ts`) y lleva el prefijo `wa:hist-`,
   * así que se quita exacto sin tocar una conversación real.
   */
  app.get('/admin/api/importar', (c) => c.json({ cuantas: cuantasImportadas() }));

  app.post('/admin/api/importar', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { on?: boolean; texto?: string; nombre?: string; delNegocio?: string[]; etapa?: string };
    if (body.on === false) return c.json({ ok: true, quitadas: quitarImportadas(), cuantas: cuantasImportadas() });
    const texto = String(body.texto ?? '');
    if (!texto.trim()) return c.json({ error: 'falta el archivo del chat' }, 400);
    if (texto.length > 8_000_000) return c.json({ error: 'ese archivo es demasiado grande' }, 413);
    try {
      const hecho = importarChat(texto, {
        nombre: String(body.nombre ?? '').trim() || 'Chat importado',
        delNegocio: Array.isArray(body.delNegocio) ? body.delNegocio.map(String) : [],
        etapa: body.etapa,
      });
      return c.json({ ok: true, ...hecho, cuantas: cuantasImportadas() });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.post('/admin/api/reindexar', async (c) => {
    const que = c.req.query('que');
    const only = que === 'products' || que === 'knowledge' || que === 'site' ? que : undefined;
    try {
      await runIngest(only ? { only } : {});
      return c.json({ ok: true, ...countDocs() });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  /**
   * Cuánto se tarda en contestar, y quién. De aquí sale el acuerdo de servicio: el objetivo se guarda por
   * cliente (no hay uno universal: una boutique y una financiera no prometen lo mismo) y se cambia en caliente,
   * sin reiniciar nada.
   */
  app.get('/admin/api/tiempos', (c) => {
    const dias = Math.min(90, Math.max(1, Number(c.req.query('dias') ?? 14) || 14));
    const acuerdoMin = getSetting('sla.minutos', 15);
    const r = resumenTiempos({ desde: Date.now() - dias * 86400_000, acuerdoMin });
    // Quien espera se enseña con su nombre y su canal: una lista de números no sirve para ir a atender a nadie.
    const esperando = r.esperando.map((e) => {
      const ficha = getContact(e.userId);
      return { ...e, nombre: ficha?.name || e.userId.replace(/^\w+:/, '').split('@')[0], canal: ficha?.channel ?? null };
    });
    return c.json({ dias, zona: business.timezone, horario: horarioDelNegocio(), ...r, esperando });
  });

  app.put('/admin/api/tiempos/acuerdo', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { minutos?: number };
    const minutos = Number(body.minutos);
    if (!Number.isFinite(minutos) || minutos < 1 || minutos > 10080) return c.json({ error: 'pon los minutos, entre 1 y una semana' }, 400);
    setSetting('sla.minutos', Math.round(minutos));
    return c.json({ ok: true, minutos: Math.round(minutos) });
  });

  /** De dónde salió cada conversación y en qué terminó: el embudo por campaña. */
  app.get('/admin/api/origenes', (c) => {
    const dias = Math.min(365, Math.max(1, Number(c.req.query('dias') ?? 30) || 30));
    return c.json({ dias, ...porCampana({ desde: Date.now() - dias * 86400_000 }) });
  });

  /**
   * A quién avisar cuando alguien lleva esperando de más. Es lo único que funciona con el navegador cerrado, y
   * por eso va por WhatsApp: es lo que la gente mira.
   */
  app.get('/admin/api/avisos', (c) => c.json({ numeros: aQuienAvisar(), acuerdoMin: getSetting('sla.minutos', 15), pendientes: loQueHayQueAvisar().length }));

  app.put('/admin/api/avisos', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { numeros?: unknown };
    const numeros = (Array.isArray(body.numeros) ? body.numeros : [])
      .map((n) => String(n).replace(/\D/g, ''))
      .filter((n) => n.length >= 8 && n.length <= 15)
      .slice(0, 5);
    setSetting('avisos.whatsapp', numeros);
    return c.json({ ok: true, numeros });
  });

  /** Mandar uno de prueba, para comprobar que llega antes de confiar en esto. */
  app.post('/admin/api/avisos/probar', async (c) => {
    const numeros = aQuienAvisar();
    if (!numeros.length) return c.json({ error: 'primero pon a quién avisar' }, 400);
    let entregados = 0;
    for (const n of numeros) {
      const ok =
        (await enviarSuelto('whatsapp', `wa:${n}@s.whatsapp.net`, `✅ Prueba de avisos de ${business.business.name}. Si lees esto, los avisos funcionan.`)) ||
        (await enviarSuelto('meta', `meta:${n}`, `✅ Prueba de avisos de ${business.business.name}. Si lees esto, los avisos funcionan.`));
      if (ok) entregados++;
    }
    return c.json({ ok: entregados > 0, entregados, de: numeros.length });
  });

  app.get('/admin/api/series', (c) => {
    const dias = Math.min(60, Math.max(7, Number(c.req.query('dias') ?? 14) || 14));
    return c.json({
      dias,
      zona: business.timezone,
      nuevas: nuevasPorDia(dias),
      actividad: actividadPorHora(dias),
      semana: semanaContraSemana(),
    });
  });

  app.get('/admin/api/today', (c) => {
    const now = Date.now();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = startOfDay.getTime() + 86400_000;
    const all = forBoard(listContacts({ limit: 1000 }));
    const lastFromCustomer = new Set(
      (getDb().prepare("SELECT user_id FROM messages m WHERE role = 'user' AND ts = (SELECT MAX(ts) FROM messages WHERE user_id = m.user_id)").all() as { user_id: string }[]).map((r) => r.user_id),
    );
    const open = all.filter((x) => !estaCerrada(x.stage)); // ganadas o perdidas no piden acción
    const withUpcoming = new Set(listAppointments({ from: now, status: 'confirmada', limit: 1000 }).map((a) => a.userId));
    // Cita que ya pasó y sigue sin resultado: esos están en "¿Cómo les fue?", no en "sin seguimiento".
    const waitingOutcome = new Set(
      listAppointments({ from: now - 14 * 86400_000, to: now, status: 'confirmada', limit: 1000 })
        .filter((a) => a.endsAt < now)
        .map((a) => a.userId),
    );
    return c.json({
      appointments: listAppointments({ from: startOfDay.getTime(), to: endOfDay, status: 'confirmada' }).map((a) => ({ ...a, label: formatSlot(new Date(a.startsAt), { withDay: false }), remindAt: reminderTime(a.startsAt) })),
      // Citas que ya pasaron y siguen "confirmadas": su resultado (vino, no vino, compró) es lo que calibra el puntaje.
      past: listAppointments({ from: now - 14 * 86400_000, to: now, status: 'confirmada' })
        .filter((a) => a.endsAt < now)
        .map((a) => ({ ...a, label: formatSlot(new Date(a.startsAt)) })),
      // Recordatorios que no se pudieron enviar solos: el texto y el número para hacerlo desde el teléfono.
      remind: remindersBoard(now).filter((a) => a.reminder?.status === 'a_mano'),
      // Esperan respuesta de una persona: la última palabra la tiene el cliente (bot en pausa o bot que no respondió).
      unanswered: open.filter((x) => lastFromCustomer.has(x.id)).slice(0, 20),
      unread: open.filter((x) => x.unread > 0 && !lastFromCustomer.has(x.id)).slice(0, 20),
      handoffs: open.filter((x) => x.humanMode).slice(0, 20),
      // Calientes abandonados: sin mensajes en 24 h, sin una cita ya agendada (esa ya es seguimiento) y sin
      // posponer (si el equipo dijo "por ahora no", la lista no lo repite).
      hot: open
        // scoreBase: el puntaje de la conversación, sin el descuento por silencio. Justamente los que fueron buenos
        // prospectos y se enfriaron por falta de seguimiento son los que hay que retomar.
        .filter((x) => x.scoreBase >= 60 && !withUpcoming.has(x.id) && !waitingOutcome.has(x.id) && (x.lastMessageAt ?? 0) < now - 24 * 3600_000 && !isSnoozed(x, now))
        .slice(0, 20),
      upcoming: listAppointments({ from: endOfDay, to: endOfDay + 3 * 86400_000, status: 'confirmada' }).map((a) => ({ ...a, label: formatSlot(new Date(a.startsAt)), remindAt: reminderTime(a.startsAt) })),
      // Lo que el bot no supo y prometió verificar: el cliente espera la respuesta del equipo.
      verifications: listVerifications('pendiente').map((v) => ({ ...v, window: replyWindow(v.userId) })),
      public: publicStatus(),
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
