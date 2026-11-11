// API del tablero de administración (bandeja, pipeline, citas, análisis, agente, conocimiento) + eventos en vivo.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Hono } from 'hono';
import type { HttpBindings } from '@hono/node-server';
import { streamSSE } from 'hono/streaming';
import { business, env } from '../config.js';
import { engineStatus, roleLabel, ROLES } from '../llm/engines.js';
import { countDocs, getDb } from '../rag/store.js';
import { borrarNotaInterna, guardarNotaInterna, notasInternas } from '../rag/interno.js';
import { retratoDelNegocio } from '../rag/retrato.js';
import { cerrarPropuesta, ponerSugiereConPersona, propuestaDe, propuestasPendientes, sugiereConPersona, verPropuesta } from '../crm/propuestas.js';
import { genteDelGrupo } from '../crm/grupo-gente.js';
import { getMessages } from '../agent/memory.js';
import { addEvent, contactNumber, deleteContact, esDe, esPersona, rolDe, estaCerrada, getContact, listContacts, messageHit, listEvents, setArchived, setHumanMode, setResponsable, setStage, stats, updateContact, STAGES, STAGE_DEFS, STAGE_LABELS, type Stage } from '../crm/contacts.js';
import { analyzeContact, listAnalyses, temperature } from '../crm/analyzer.js';
import { availableSlots, bookAppointment, formatSlot, listAppointments, setReminder, updateAppointment } from '../crm/appointments.js';
import { llevaArchivos, reintentarMensaje, replyWindow, sendToContact, WINDOW_CLOSED } from '../crm/outbox.js';
import { appointmentsCsv, contactsCsv } from '../crm/export.js';
import { isSnoozed, snoozeFollowup } from '../crm/followup.js';
import { reminderTime, remindersBoard } from '../crm/reminders.js';
import { emitEvent, onEvent } from '../crm/events.js';
import { listNotifications, startNotifications } from '../crm/notifications.js';
import { usageSummary } from '../llm/usage.js';
import { entrar as entrarALaConversacion, salir as salirDeLaConversacion, quienesEstan } from '../crm/presencia.js';
import { actividadPorHora, citasPorDia, nuevasPorDia, semanaContraSemana } from '../crm/series.js';
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
import { apagarClaveDelCliente, claveDelCliente, CUIDADO, encenderClaveDelCliente, guardarMotores, motoresDe, ponerClaveDelCliente, quitarClaveDelCliente, ROL_NOMBRE, ROL_QUE_HACE } from '../motores.js';
import { esProveedor, guardarProveedor, probarProveedor, proveedores, quitarLlave } from '../proveedores.js';
import { ponerTope, presupuesto } from '../crm/presupuesto.js';
import { frenoDelCandado } from './candado.js';
import { aplicarFicha, camposEditables, CAMPOS_DE_CONTACTO } from '../crm/ficha.js';
import { DIAS_MAXIMO, DIAS_MINIMO, DIAS_SUGERIDOS, politica as politicaDeRetencion, ponerPolitica, ultimaPasada, vistaPrevia } from '../crm/retencion.js';
import { agendaDe } from '../crm/sedes.js';
import { turnoDe } from '../crm/turnos.js';
import { version } from '../version.js';
import { borrarDocumento, documentosDelNegocio, guardarCatalogo, guardarDocumento } from '../rag/documentos.js';
import { leerAdjunto } from '../crm/adjuntos.js';
import { cuantoOcupa as cuantoOcupanLosMedios, guardar as guardarMedio, rutaDe as rutaDeMedio, MAXIMO_BYTES, MIMES_ACEPTADOS } from '../crm/medios.js';
import { darDeAlta } from '../crm/alta.js';
import { borrarRespuestaRapida, buscarRespuestaRapida, guardarRespuestaRapida, respuestasRapidas } from '../crm/respuestas-rapidas.js';
import { temasDelMaterial } from '../crm/aprender-temas.js';
import { cuantoLeQueda, HORAS_MAXIMO, ponerPrueba, pruebaActiva, quitarPrueba } from '../crm/modo-prueba.js';
import { comoVa, gastoDeLaDemo, olvidarTodo } from '../crm/vivo.js';
import { olvidarPrecios, valorDe, valorDelEmbudo } from '../crm/valor.js';
import { calcularKpis, guardarMetas, KPIS, leerMetas, limpiarMetas } from '../crm/kpis.js';
import { historiaDelEmbudo } from '../crm/embudo.js';
import { enUnaFrase, historiaDe } from '../crm/historia.js';
import { feedUrls } from '../crm/calendar.js';
import { busyIntervals, busyStatus } from '../crm/busy.js';
import { recap } from '../crm/recap.js';
import { seguimientosPendientes, ventasDelPeriodo } from '../crm/resultados.js';
import { optimizacion } from '../crm/optimizacion.js';
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
import { pasosDeLaGuia } from '../crm/guia.js';
import { exportarAprendizaje, restaurarAprendizaje, revisarAprendizaje } from '../crm/aprendizaje.js';
import { chatsImportados, borrarImportado, decidirTema, expresionesCandidatas, guardarImportados, leerChatExportado, muestraDeEstilo, resumenImportado, temasFrecuentes, vocabularioDelNegocio, mensajesDeChat } from '../crm/historial.js';
import { ruleReading } from '../agent/teach.js';
import { indexProfile } from '../rag/profile-index.js';
import { exportDictionary, getDictionary, importDictionary } from '../agent/dictionary.js';
import { teachExpression } from '../agent/teach.js';
import { closeMisses, listMisses, noteMiss, MISS_KINDS, type MissKind } from '../crm/misses.js';
import { answerVerification, dismissVerification, listVerifications } from '../crm/verifications.js';
import { grupos as gruposDe, setGrupos, setModoCanal, setSoloEscucha, soloEscucha as soloEscuchaDe, type ChannelId } from './switches.js';
import type { Contact } from '../crm/contacts.js';
import { cabecerasDeSiempre, paginaConCsp, soloDesdeAqui } from '../cabeceras.js';
import { contextoDelPaso, proximoPaso } from '../crm/proximo.js';
import { guardarFijados, leerFijados, reemplazarEnFijados } from '../crm/fijados.js';
import { esCuentaClave, marcarCuentaClave, notaDeCuenta, panelKam } from '../crm/cuentas-clave.js';
import {
  cambiarActualizacion,
  cambiarMantenimiento,
  crearActualizacion,
  crearMantenimiento,
  cumplimiento as cumplimientoDeMantenimientos,
  marcarAvisado,
  panelMantenimientos,
  prepararAvisos,
  vistaPreviaDelAviso,
  type DatosAct,
  type DatosMant,
} from '../crm/mantenimientos.js';
import {
  guardarReglas,
  periodoDias as periodoDeMantenimientos,
  planesDelSla,
  programarEsDelEquipo,
  reglasConValor,
  VARIABLES_AVISO,
} from '../crm/mantenimientos-reglas.js';
import { sentimiento } from '../crm/sentimiento.js';
import { cambiarReglas, ponerRegla, regla, registro, valoresDeReglas } from '../reglas.js';
import { cambiarTicket, capasDe, configSla, crearTicket, FABRICA as SLA_DE_FABRICA, guardarConfigSla, listarTickets, olvidarConfigDelTablero, puede as puedeEnSla, reglasSla, slaDelPeriodo, verTicket, vistaDeConfig } from '../crm/tickets.js';

/**
 * Lo que el tablero enseña de cada contacto además de la ficha: temperatura, recap (hechos de la ficha + próxima
 * cita), cuánto vale (crm/valor.ts) y el próximo paso (crm/proximo.ts). Va en la lista y no se calcula en el
 * navegador porque el valor necesita el catálogo y el paso necesita citas y mensajes de todas las fichas.
 */
function forBoard<T extends Contact>(list: T[]) {
  const next = new Map<string, ReturnType<typeof listAppointments>[number]>();
  for (const a of listAppointments({ from: Date.now(), status: 'confirmada', limit: 5000 })) if (!next.has(a.userId)) next.set(a.userId, a);
  const ctx = contextoDelPaso();
  return list.map((x) => {
    const v = valorDe(x);
    return { ...x, temperature: temperature(x.score), recap: recap(x, next.get(x.id) ?? null), valor: v.valor, valorOrigen: v.origen, proximo: proximoPaso(x, ctx) };
  });
}

export const ADMIN_TOKEN = env.adminToken || randomBytes(12).toString('hex');

/**
 * Quién está haciendo esto, para la historia de la ficha. Lo dice la cabecera `x-xencrm-quien`: la consola la pone
 * con el nombre de la cuenta con que se entró (y tira la que mande el navegador), y el tablero abierto con el
 * token a secas manda el nombre con que responde. Si no hay ninguna, lo que venga en el cuerpo, y si no, «equipo».
 *
 * 🪤 Antes todo lo del tablero quedaba como «admin», y la historia decía «El equipo la pasó a Perdido»: con tres
 * personas atendiendo, eso no le sirve a nadie para saber a quién preguntar.
 */
export function quienHace(c: { req: { header(nombre: string): string | undefined } }, delCuerpo?: unknown, siNadie = 'equipo'): string {
  const h = c.req.header('x-xencrm-quien');
  if (h) {
    try {
      const n = decodeURIComponent(h).trim().slice(0, 40);
      if (n) return n;
    } catch {
      /* una cabecera mal escrita no tumba la petición: se usa lo siguiente */
    }
  }
  return String(delCuerpo ?? '').trim().slice(0, 40) || siNadie;
}

const NOMBRE_DEL_CAMPO: Record<string, string> = { name: 'nombre', phone: 'teléfono', notes: 'nota fija', tags: 'etiquetas' };
/** Qué cambió de verdad entre la ficha y lo que se manda a guardar. Guardar sin tocar nada no deja rastro. */
function camposCambiados(antes: Contact, patch: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [k, nombre] of Object.entries(NOMBRE_DEL_CAMPO)) {
    if (!(k in patch)) continue;
    const a = JSON.stringify((antes as unknown as Record<string, unknown>)[k] ?? null);
    const b = JSON.stringify(patch[k] ?? null);
    if (a !== b) out.push(nombre);
  }
  if (patch.data && JSON.stringify((patch.data as Record<string, unknown>).valor ?? null) !== JSON.stringify(antes.data.valor ?? null)) out.push('valor');
  return out;
}

/** El modo del tablero para este cliente (ver PUT /admin/api/tablero/modo). Sin decir nada, completo: así estaba. */
const modoDelTablero = (): 'facil' | 'completo' => (getSetting<string>('tablero.modo', 'completo') === 'facil' ? 'facil' : 'completo');

/** El nombre corto de este cliente, el mismo que usa el respaldo. */
const soyElCliente = (): string => (process.env.XENCRM_SLUG ?? business.business.name).toLowerCase().replace(/[^a-z0-9]+/g, '-');

export function mountAdmin(app: Hono<{ Bindings: HttpBindings }>) {
  startNotifications();
  // Las mismas de la consola: el tablero también se puede meter en un marco ajeno, y sus descargas (los CSV)
  // no deben interpretarse como otra cosa.
  app.use('/admin', cabecerasDeSiempre);
  app.use('/admin.js', cabecerasDeSiempre);
  app.use('/admin/api/*', cabecerasDeSiempre);
  app.use('/admin/api/*', soloDesdeAqui);
  app.get('/admin', (c) => paginaConCsp(c, readFileSync(new URL('../../public/admin.html', import.meta.url), 'utf8')));
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
  // El candado del modo fácil (channels/candado.ts). Después del token: sin token no se le dice a nadie qué hay.
  app.use('/admin/api/*', async (c, next) => {
    const ruta = c.req.path.replace(/^.*?\/admin\/api\//, '');
    const freno = frenoDelCandado(ruta, c.req.method, c.req.header('x-xencrm-rol'), modoDelTablero());
    if (freno) return c.json({ error: freno }, 403);
    await next();
  });

  app.get('/admin/api/me', (c) =>
    c.json({
      ok: true,
      business: business.business.name,
      agent: business.agent.name,
      // Lo que el negocio agenda («demo de producto», «cita de asesoría»): con eso se escriben los borradores. Vacío si
      // no agenda.
      agenda: business.appointments.enabled ? business.appointments.service : '',
      // Las palabras de la interfaz que son del negocio (xencrm.config.json › interfaz): el tablero no las escribe fijas.
      interfaz: { agenda: business.interfaz.agenda, bienvenida: business.interfaz.bienvenida, ejemplos: business.interfaz.ejemplos },
      // Para que el tablero se sienta del negocio: su logo y su color, no los de XENCRM.
      logo: logoUrl(),
      color: business.brand.color,
      // 🪤 El color de una marca casi nunca se lee como texto: el dorado de una boutique da 2.2:1 sobre papel.
      // Se manda ya ajustado al mínimo legible sobre cada fondo, en vez de dejar que la pantalla lo resuelva mal.
      colorClaro: accentOn(business.brand.color, '#f3f1ea'),
      colorOscuro: accentOn(business.brand.color, '#14120d'),
      // Para decir en qué sede es cada cita, en todo el tablero (crm/sedes.ts). Vacío: no tiene sedes.
      sedes: business.sedes.map((s) => ({ id: s.id, nombre: s.nombre })),
      // Qué código corre (src/version.ts): lo primero que hay que saber cuando algo cambió tras un despliegue.
      version: version().commit,
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
      // 🪤 Clientes y Prospectos piden 500, y esto los dejaba en las 200 de siempre sin decir nada: un negocio con
      // 300 fichas veía 200 y creía que eran todas.
      limit: Math.min(Math.max(Number(c.req.query('limit')) || 200, 1), 2000),
    });
    const board = forBoard(contacts);
    // Con búsqueda, cada fila trae el pedacito de conversación donde aparece lo buscado.
    return c.json(q ? board.map((b) => ({ ...b, hit: messageHit(b.id, q) })) : board);
  });

  /**
   * Los números de la barra lateral: cuántos prospectos abiertos, cuántas fichas, cuántos calientes y cuántas
   * lleva quien está mirando (`yo`, el nombre con el que responde). «Caliente» es lo mismo que en Hoy: abierto y
   * con 60 o más, con el descuento por silencio; si aquí contara distinto, la barra y Hoy no cuadrarían.
   */
  app.get('/admin/api/cuentas', (c) => {
    const yo = String(c.req.query('yo') ?? '').trim();
    const todos = listContacts({ limit: 5000 });
    const abiertos = todos.filter((x) => !estaCerrada(x.stage));
    return c.json({
      total: todos.length,
      abiertos: abiertos.length,
      calientes: abiertos.filter((x) => x.score >= regla<number>('puntaje.caliente')).length,
      mios: yo ? todos.filter((x) => esDe(x, yo)).length : 0,
    });
  });

  /**
   * Los fijados de quien mira, por el nombre con el que responde (crm/fijados.ts). En la base y no en el navegador,
   * para que lo sigan a otro computador.
   */
  app.get('/admin/api/fijados', (c) => c.json({ fijados: leerFijados(String(c.req.query('yo') ?? '')) }));
  app.put('/admin/api/fijados', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { yo?: string; ids?: unknown };
    try {
      return c.json({ fijados: guardarFijados(String(body.yo ?? ''), body.ids) });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  // Las cuentas clave (KAM): el panel entero (cuentas, salud con su porqué, candidatas) y marcar/quitar con su plan.
  // Ver crm/cuentas-clave.ts. Marcar es del día a día de quien vende: el candado lo deja (channels/candado.ts).
  app.get('/admin/api/cuentas-clave', (c) => c.json(panelKam()));
  app.put('/admin/api/contacts/:id/cuenta-clave', async (c) => {
    const id = c.req.param('id');
    const body = (await c.req.json().catch(() => ({}))) as { on?: unknown; nota?: unknown };
    if (!getContact(id)) return c.json({ error: 'esa ficha no existe' }, 404);
    if (body.on === undefined && body.nota === undefined) return c.json({ error: 'falta qué cambiar: on (marcar o quitar) o nota (el plan de cuenta)' }, 400);
    const por = quienHace(c);
    try {
      let cuenta = esCuentaClave(id);
      if (body.on !== undefined) cuenta = marcarCuentaClave(id, body.on === true, por);
      if (body.nota !== undefined) cuenta = notaDeCuenta(id, body.nota, por);
      return c.json({ cuenta });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  // Mantenimientos y actualizaciones (Servicio): lo que se va a tocar, a quién afecta y si se le avisó a tiempo.
  // Ver crm/mantenimientos.ts y sus reglas (crm/mantenimientos-reglas.ts). El aviso nunca sale solo: «preparar» lo
  // deja como propuesta en cada conversación. Preparar y marcar avisado es del día a día (el candado los deja);
  // programar y publicar, de quien diga la regla `mant.quienPrograma` (de fábrica, quien administra).
  const diasDe = (q: string | undefined) => (q === undefined ? periodoDeMantenimientos() : Math.min(365, Math.max(1, Number(q) || periodoDeMantenimientos())));
  /** Programar es de quien administra (el super-admin o el token a secas) salvo que la regla lo abra al equipo. */
  const frenoDeProgramar = (c: { req: { header(n: string): string | undefined } }): string | null => {
    const rol = c.req.header('x-xencrm-rol');
    return !rol || rol === 'super' || programarEsDelEquipo() ? null : 'programar mantenimientos y publicar actualizaciones es de quien administra XENCRM';
  };
  app.get('/admin/api/mantenimientos', (c) => c.json(panelMantenimientos(diasDe(c.req.query('dias')))));
  /** El cumplimiento del periodo, con la forma exacta que lee la pantalla SLA. */
  app.get('/admin/api/mantenimientos/cumplimiento', (c) => c.json(cumplimientoDeMantenimientos(diasDe(c.req.query('dias')))));
  /** La configuración (Configuración › Mantenimientos y actualizaciones): cada regla con su valor y de dónde sale. */
  app.get('/admin/api/mantenimientos/config', (c) => c.json({ reglas: reglasConValor(), variables: VARIABLES_AVISO, planesDelSla: Boolean(planesDelSla()) }));
  /** Guardar reglas: todo o nada; null en una la devuelve al archivo o a la fábrica. Solo quien administra (consola). */
  app.put('/admin/api/mantenimientos/config', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { valores?: Record<string, unknown> };
    const r = guardarReglas(body.valores ?? {});
    return 'error' in r ? c.json(r, 400) : c.json({ reglas: r.ok, variables: VARIABLES_AVISO, planesDelSla: Boolean(planesDelSla()) });
  });
  /** La vista previa de una plantilla del aviso, sin guardarla. */
  app.post('/admin/api/mantenimientos/config/vista-previa', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { plantilla?: unknown };
    const plantilla = String(body.plantilla ?? '').trim();
    if (!plantilla) return c.json({ error: 'la plantilla está vacía' }, 400);
    return c.json(vistaPreviaDelAviso(plantilla));
  });
  app.post('/admin/api/mantenimientos', async (c) => {
    const freno = frenoDeProgramar(c);
    if (freno) return c.json({ error: freno }, 403);
    const r = crearMantenimiento((await c.req.json().catch(() => ({}))) as DatosMant, quienHace(c));
    return 'error' in r ? c.json(r, 400) : c.json(r.ok, 201);
  });
  app.patch('/admin/api/mantenimientos/:id', async (c) => {
    const freno = frenoDeProgramar(c);
    if (freno) return c.json({ error: freno }, 403);
    const r = cambiarMantenimiento(Number(c.req.param('id')), (await c.req.json().catch(() => ({}))) as DatosMant, quienHace(c));
    if (!r) return c.json({ error: 'ese mantenimiento no existe' }, 404);
    return 'error' in r ? c.json(r, 400) : c.json(r.ok);
  });
  app.post('/admin/api/mantenimientos/:id/avisos/preparar', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { ids?: unknown };
    const soloIds = Array.isArray(body.ids) ? body.ids.map(String) : undefined;
    const r = prepararAvisos(Number(c.req.param('id')), { soloIds, por: quienHace(c) });
    return r ? c.json(r) : c.json({ error: 'ese mantenimiento no existe' }, 404);
  });
  app.post('/admin/api/mantenimientos/:id/avisos/:userId/avisado', async (c) => {
    const r = marcarAvisado(Number(c.req.param('id')), c.req.param('userId'), quienHace(c));
    if (!r) return c.json({ error: 'ese mantenimiento no existe' }, 404);
    return 'error' in r ? c.json(r, 400) : c.json({ ok: true });
  });
  app.post('/admin/api/actualizaciones', async (c) => {
    const freno = frenoDeProgramar(c);
    if (freno) return c.json({ error: freno }, 403);
    const r = crearActualizacion((await c.req.json().catch(() => ({}))) as DatosAct, quienHace(c));
    return 'error' in r ? c.json(r, 400) : c.json(r.ok, 201);
  });
  app.patch('/admin/api/actualizaciones/:id', async (c) => {
    const freno = frenoDeProgramar(c);
    if (freno) return c.json({ error: freno }, 403);
    const r = cambiarActualizacion(Number(c.req.param('id')), (await c.req.json().catch(() => ({}))) as DatosAct, quienHace(c));
    if (!r) return c.json({ error: 'esa actualización no existe' }, 404);
    return 'error' in r ? c.json(r, 400) : c.json(r.ok);
  });

  // Dar de alta a alguien a mano: el que llegó por el local, por una llamada o con una tarjeta. Lo delicado
  // —qué dirección se le pone para que no nazca duplicada— está en crm/alta.ts, con sus pruebas.
  app.post('/admin/api/contacts', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { name?: string; phone?: string; stage?: Stage; notes?: string; sede?: string; ficha?: Record<string, unknown> };
    try {
      const r = darDeAlta(body);
      return c.json(r, r.yaExistia ? 200 : 201);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.get('/admin/api/contacts/:id', (c) => {
    const id = c.req.param('id');
    const contact = getContact(id);
    if (!contact) return c.json({ error: 'no existe' }, 404);
    updateContact(id, { unread: 0 }, { silent: true });
    return c.json({
      contact: { ...forBoard([contact])[0], unread: 0 },
      messages: getMessages(id, 300),
      // Lo que ya estaba conversado antes de que XENCRM entrara. Solo lo anterior al primer mensaje que tenemos
      // en la conversación: en el empalme, lo de en medio saldría dos veces.
      antes: (() => {
        const vivos = getMessages(id, 300);
        const desde = vivos.length ? vivos[0]!.ts : Infinity;
        return mensajesDeChat(id).filter((m) => m.ts < desde);
      })(),
      analyses: listAnalyses(id, 10),
      events: listEvents(id, 200),
      appointments: listAppointments({ userId: id, limit: 20 }).map((a) => ({ ...a, label: formatSlot(new Date(a.startsAt)) })),
      replyWindow: replyWindow(id),
      propuesta: propuestaDe(id), // lo que XENCRM dejó listo aquí, si hay

      number: contactNumber(contact), // para escribirle o llamarlo desde el tablero
      presentes: quienesEstan(id), // quién más está metido aquí ahora mismo
      // Si por este canal se le pueden mandar archivos. El tablero esconde el botón cuando no.
      llevaArchivos: llevaArchivos(contact.channel),
      origen: origenDe(id), // por dónde llegó: sirve al atender y para saber qué anuncio trae clientes
      // Qué ha pasado con esta persona: si volvió, si vino a sus citas, si se le fue una venta. Ver crm/historia.ts.
      historia: (() => { const h = historiaDe(id, { etapa: contact.stage }); return { ...h, frase: enUnaFrase(h) }; })(),
      valor: valorDe(contact),
      cuentaClave: esCuentaClave(id), // si es cuenta clave (KAM): quién la marcó, desde cuándo y su plan
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
    const contact = setArchived(c.req.param('id'), body.on !== false, quienHace(c));
    return contact ? c.json({ contact }) : c.json({ error: 'no existe' }, 404);
  });
  app.delete('/admin/api/contacts/:id', (c) => {
    const id = c.req.param('id');
    if (!deleteContact(id)) return c.json({ error: 'no existe' }, 404);
    reemplazarEnFijados(id, null); // su identificador es su teléfono: no se queda guardado en los fijados de nadie
    return c.json({ ok: true });
  });

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
      const contact = mergeContacts(keep.id, drop.id, quienHace(c));
      reemplazarEnFijados(drop.id, keep.id); // quien la tenía fijada sigue teniéndola, ahora la que quedó
      return c.json({ contact, keptId: keep.id, droppedId: drop.id });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.patch('/admin/api/contacts/:id', async (c) => {
    const id = c.req.param('id');
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string; phone?: string; stage?: Stage; motivo?: string; notes?: string; tags?: string[]; data?: Record<string, unknown>; responsable?: string | null; ficha?: Record<string, unknown>;
    };
    const antes = getContact(id);
    if (!antes) return c.json({ error: 'no existe' }, 404);
    // La ficha (correo, Instagram, las medidas…) se revisa antes de tocar nada: un formulario con un correo mal
    // escrito no guarda la mitad y deja la otra mitad perdida.
    const ficha = body.ficha === undefined ? null : aplicarFicha(antes.data, body.ficha);
    if (ficha && 'error' in ficha) return c.json({ error: ficha.error }, 400);
    const por = quienHace(c);
    if (body.stage) {
      if (!STAGES.includes(body.stage)) return c.json({ error: 'etapa inválida' }, 400);
      setStage(id, body.stage, { locked: true, by: por, motivo: typeof body.motivo === 'string' ? body.motivo : null });
    }
    if (body.responsable !== undefined) setResponsable(id, body.responsable, por);
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name.trim() || null;
    if (body.phone !== undefined) patch.phone = body.phone.trim() || null;
    if (body.notes !== undefined) patch.notes = body.notes;
    if (Array.isArray(body.tags)) patch.tags = body.tags.map((t) => String(t).trim()).filter(Boolean);
    if (body.data && typeof body.data === 'object') {
      // 🪤 Se mezcla con lo que ya hubiera, no se reemplaza: `data` lleva más cosas que el valor —lo que puso el
      // análisis, el aplazamiento— y mandar el objeto entero desde una pantalla que solo edita un campo
      // borraría todo lo demás sin que nadie lo notara hasta echarlo en falta.
      const antes = (getContact(id)?.data ?? {}) as Record<string, unknown>;
      const junto: Record<string, unknown> = { ...antes, ...body.data };
      // Un valor vacío o cero no es «vale cero»: es «no lo sé», y eso se guarda quitando la clave para que
      // vuelva a mandar lo que diga el catálogo.
      const v = Number(junto.valor);
      if (!Number.isFinite(v) || v <= 0) delete junto.valor;
      patch.data = junto;
    }
    if (ficha?.cambiados.length) {
      const sobre = (patch.data as Record<string, unknown> | undefined) ?? antes.data;
      const conFicha = aplicarFicha(sobre, body.ficha);
      if (!('error' in conFicha)) patch.data = conFicha.data;
    }
    const contact = updateContact(id, patch);
    // 🪤 Lo que se corrige a mano queda en la historia con el nombre de quien lo hizo. La etapa y el responsable
    // ya dejan el suyo; esto cubre el resto. Sin los valores: cuál campo y quién, que es lo que se pregunta cuando
    // alguien dice «yo no le cambié el teléfono».
    const cambiados = [...camposCambiados(antes, patch), ...(ficha?.cambiados ?? [])];
    if (cambiados.length) addEvent(id, 'editado', { campos: cambiados, by: por });
    return c.json({ contact });
  });

  /**
   * Notas del equipo en la historia de la ficha: cada una con su fecha y quién la escribió. Van en `events` (tipo
   * `nota`) y no en `users.notes`, que es UNA nota fija que se sobrescribe entera: «Priya decide la compra» y,
   * tres días después, «pidió que la llamen el jueves» son dos cosas que pasaron, no una que se corrige.
   *
   * 🪤 La retención anonimiza dejando el `payload` de los eventos en `{}`: el texto de las notas se va con lo
   * demás, que es lo que tiene que pasar con lo que alguien escribió sobre una persona.
   */
  app.post('/admin/api/contacts/:id/notas', async (c) => {
    const id = c.req.param('id');
    const body = (await c.req.json().catch(() => ({}))) as { texto?: string; por?: string };
    if (!getContact(id)) return c.json({ error: 'no existe' }, 404);
    const texto = String(body.texto ?? '').trim();
    if (!texto) return c.json({ error: 'la nota está vacía' }, 400);
    if (texto.length > 2000) return c.json({ error: 'la nota va hasta 2.000 letras' }, 400);
    addEvent(id, 'nota', { texto, por: quienHace(c, body.por, 'el equipo') });
    emitEvent('contact', id, { nota: true });
    return c.json({ ok: true, events: listEvents(id, 200) }, 201);
  });

  // Solo se borran notas: el resto de la historia (etapas, citas, traspasos) es lo que pasó y no se edita.
  app.delete('/admin/api/contacts/:id/notas/:evento', (c) => {
    const id = c.req.param('id');
    const r = getDb().prepare("DELETE FROM events WHERE id = ? AND user_id = ? AND type = 'nota'").run(Number(c.req.param('evento')), id);
    if (!r.changes) return c.json({ error: 'esa nota no existe' }, 404);
    // La nota se va, pero que alguien la borró se queda: es lo único de la historia que se puede quitar.
    addEvent(id, 'nota_borrada', { by: quienHace(c) });
    emitEvent('contact', id, { nota: true });
    return c.json({ ok: true, events: listEvents(id, 200) });
  });

  // «Marcar todo como leído»: para el día que se atendió todo desde el teléfono y el tablero sigue en rojo.
  app.post('/admin/api/contacts/leidas', (c) => {
    const ids = (getDb().prepare('SELECT id FROM users WHERE unread > 0 AND archived = 0 LIMIT 2000').all() as { id: string }[]).map((r) => r.id);
    for (const id of ids) updateContact(id, { unread: 0 });
    return c.json({ ok: true, cuantas: ids.length });
  });

  app.post('/admin/api/contacts/:id/human', async (c) => {
    const id = c.req.param('id');
    const body = (await c.req.json().catch(() => ({}))) as { on?: boolean; a?: string };
    if (!getContact(id)) return c.json({ error: 'no existe' }, 404);
    // `a` es a quién se le entrega. Sin nombre queda «del equipo», que es lo que pasaba antes siempre y deja a
    // todos mirándose: una conversación entregada a nadie no la recoge nadie.
    const por = quienHace(c, undefined, 'admin');
    // 🪤 Sin `a` es quien aprieta «Tú» (o empieza a escribir): la toma él. Antes quedaba «admin», y la ficha decía
    // «admin está atendiendo» y «La lleva el equipo» cuando había una persona con nombre al teclado.
    const aQuien = String(body.a ?? '').trim().slice(0, 40) || por;
    let contact = setHumanMode(id, Boolean(body.on), aQuien);
    // Entregársela a alguien por su nombre lo deja a cargo del cliente, no solo de esta conversación. Y queda
    // quién se la entregó: «Laura tomó la conversación» no dice que fue Bryan quien se la pasó.
    if (body.on && esPersona(body.a)) {
      contact = setResponsable(id, aQuien, por) ?? contact;
      if (aQuien !== por) addEvent(id, 'entregada', { a: aQuien, by: por });
    }
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
      const r = await sendToContact(id, text, 'human', { by });
      if (r.fallo) return c.json({ error: `no salió: ${r.fallo}. Quedó marcado en la conversación para volver a intentarlo.`, fallo: r.fallo }, 502);
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: `${(err as Error).message}. Quedó marcado en la conversación para volver a intentarlo.`, fallo: (err as Error).message }, 500);
    }
  });

  // Volver a mandar un mensaje que quedó marcado como «no salió». Es el mismo mensaje: no se repite en la conversación.
  app.post('/admin/api/contacts/:id/mensajes/:mensaje/reintentar', async (c) => {
    const r = await reintentarMensaje(c.req.param('id'), Number(c.req.param('mensaje')));
    return r.ok ? c.json({ ok: true }) : c.json({ error: r.error }, 502);
  });

  /**
   * Responder con un archivo: la foto de un traje, el portafolio en PDF.
   *
   * Va aparte de `/reply` porque llega como formulario y no como JSON. El archivo se guarda primero —así queda
   * en la conversación aunque el envío falle— y después se entrega por el canal del cliente.
   */
  app.post('/admin/api/contacts/:id/adjunto', async (c) => {
    const id = c.req.param('id');
    const contact = getContact(id);
    if (!contact) return c.json({ error: 'no existe' }, 404);
    const form = await c.req.parseBody().catch(() => null);
    const archivo = form?.archivo;
    if (!archivo || typeof archivo !== 'object' || !('arrayBuffer' in archivo)) return c.json({ error: 'falta el archivo' }, 400);
    const f = archivo as File;
    const texto = String(form?.texto ?? '').trim();
    const by = String(form?.by ?? '').trim().slice(0, 40) || 'equipo';
    if (!replyWindow(id).open) return c.json({ error: WINDOW_CLOSED }, 409);
    // 🪤 Se mira que el canal sepa llevarlo ANTES de escribir el archivo. Guardándolo primero, cada intento por
    // un canal que no puede dejaba un archivo huérfano en el disco del cliente —nadie lo ve, nadie lo borra, y
    // en un alojamiento compartido eso se nota a los meses—.
    if (!llevaArchivos(contact.channel)) {
      return c.json({ error: `Por ${contact.channel} no puedo mandarle archivos todavía; solo por WhatsApp. El texto sí se puede.` }, 409);
    }
    let medio;
    try {
      medio = guardarMedio(new Uint8Array(await f.arrayBuffer()), { mime: f.type, nombre: f.name });
    } catch (err) {
      // Lo que rechaza el almacén lo rechaza por una razón que se puede leer: se la pasamos tal cual.
      return c.json({ error: (err as Error).message }, 400);
    }
    if (!contact.humanMode) setHumanMode(id, true, by); // mandar algo a mano toma el control, igual que responder
    try {
      const r = await sendToContact(id, texto, 'human', { by, medio });
      if (r.fallo) return c.json({ error: `no salió: ${r.fallo}. Quedó marcado en la conversación para volver a intentarlo.`, fallo: r.fallo, medio }, 502);
      return c.json({ ok: true, medio });
    } catch (err) {
      // 🪤 El archivo ya se guardó y el mensaje ya está en la conversación: NO se borra. Que el envío falle no
      // significa que no haya pasado nada — el equipo tiene que ver qué intentó mandar para poder reintentarlo.
      return c.json({ error: (err as Error).message, fallo: (err as Error).message, medio }, 500);
    }
  });

  /**
   * Bajar un archivo de la conversación.
   *
   * 🪤 Siempre como descarga y con `nosniff`. Servirlo para que se abra dentro del tablero significa que un
   * archivo que mandó un desconocido se ejecuta en el mismo dominio donde vive la sesión de quien atiende. El
   * tipo lo ponemos nosotros, nunca el que venía en el archivo.
   */
  app.get('/admin/api/medios/:mid', (c) => {
    const mid = c.req.param('mid');
    const ruta = rutaDeMedio(mid);
    if (!ruta) return c.json({ error: 'no existe' }, 404);
    const nombre = (c.req.query('nombre') || mid).replace(/[^\w.\- ]/g, '').slice(0, 120) || mid;
    return new Response(new Uint8Array(readFileSync(ruta)), {
      headers: {
        'content-type': 'application/octet-stream',
        'content-disposition': `attachment; filename="${nombre}"`,
        'x-content-type-options': 'nosniff',
        'cache-control': 'private, max-age=300',
      },
    });
  });

  /** Cuánto disco llevan los archivos de este cliente: para verlo antes de que sea un problema. */
  app.get('/admin/api/medios', (c) => c.json({ ...cuantoOcupanLosMedios(), maximoPorArchivo: MAXIMO_BYTES, tipos: MIMES_ACEPTADOS }));

  app.post('/admin/api/contacts/:id/analyze', async (c) => {
    const id = c.req.param('id');
    if (!getContact(id)) return c.json({ error: 'no existe' }, 404);
    await analyzeContact(id, { full: true });
    return c.json({ contact: getContact(id), analyses: listAnalyses(id, 1) });
  });

  /**
   * El embudo (Ventas › Embudo, y las vistas «este mes» de Tratos): hasta dónde llegó cada trato, desde qué etapa se
   * cayó si se perdió y cuándo se cerró, leído de la historia de cambios de etapa (crm/embudo.ts). Solo lectura,
   * sin modelo ni red: el tablero lo cruza con la lista de contactos y aplica ahí los filtros de cada quien.
   */
  app.get('/admin/api/embudo', (c) => c.json(historiaDelEmbudo()));

  /** Ventas: quién compró, por cuánto y cuándo, y lo que se perdió y por qué. El cálculo vive en crm/resultados.ts. */
  app.get('/admin/api/ventas', (c) => c.json(ventasDelPeriodo(Math.min(365, Math.max(1, Number(c.req.query('days') ?? 90))))));

  /** Seguimientos: a quién hay que escribirle y por qué (la Lista de trabajo). El cálculo vive en crm/resultados.ts. */
  app.get('/admin/api/seguimientos', (c) => c.json(seguimientosPendientes()));

  /**
   * Optimización de ventas: dónde se pierden ventas y qué hacer distinto. Reglas fijas sobre lo que ya calculan
   * ventas, seguimientos, tiempos, orígenes y sentimiento: sin modelo y sin red. Es del que vende, así que el
   * candado deja leerla (channels/candado.ts lee todo menos lo avanzado).
   */
  app.get('/admin/api/optimizacion', (c) => c.json(optimizacion(Number(c.req.query('dias') ?? 30) || 30)));

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
      'content-disposition': `attachment; filename="diccionario-${slug || 'xencrm'}.json"`,
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

  // La guía de inicio: qué falta para que el asistente atienda solo, paso por paso y con el motivo. Ver crm/guia.ts.
  // Sin modelo y sin red: se pide cada vez que alguien abre Hoy.
  app.get('/admin/api/guia', (c) => c.json({ pasos: pasosDeLaGuia(), agente: business.agent.name }));

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
   * desde la consola, que sirve este tablero— en vez de a mano en `xencrm.config.json`.
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
   * Qué motor hace cada cosa en este cliente. Se lee y se escribe su `.env`; ver `src/motores.ts` para por qué
   * no se aplica en caliente y por qué un motor que no esté disponible aquí no se guarda.
   */
  app.get('/admin/api/motores', (c) => c.json(motoresDe()));

  app.put('/admin/api/motores', async (c) => {
    try {
      const r = await guardarMotores(await c.req.json());
      return c.json({ ok: true, ...r });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'no pude guardar los motores' }, 400);
    }
  });

  /**
   * El tope de gasto de IA del mes (ver crm/presupuesto.ts). Verlo lo puede cualquiera que vea el tablero: al
   * negocio le sirve saber por qué su asistente pasó conversaciones al equipo.
   *
   * 🪤 Cambiarlo va bajo `motores/`, y no por casualidad: la consola reserva todo lo que empieza por `motores` y
   * `clave` a quien administra XENCRM. El tope decide cuánto se gasta, igual que los motores y la llave, y eso no es
   * de la operación del negocio. Se aplica al instante, sin reiniciar.
   */
  app.get('/admin/api/presupuesto', (c) => c.json(presupuesto()));

  /**
   * Un turno del asistente (crm/turnos.ts): por qué contestó lo que contestó, con qué modelo, qué guardas
   * saltaron, qué costó y con qué versión. Es lo que se abre desde «¿por qué?» en una respuesta.
   */
  app.get('/admin/api/turnos/:id', (c) => {
    const t = turnoDe(c.req.param('id'));
    return t ? c.json(t) : c.json({ error: 'ese turno no existe o ya pasaron 90 días' }, 404);
  });

  /**
   * La retención automática de conversaciones viejas (crm/retencion.ts). Verla lo puede cualquiera que vea el
   * tablero: el negocio tiene que saber qué pasa con las conversaciones de sus clientes. Con `?dias=` dice cuántas
   * tocaría con esos días, sin tocar nada: es lo que la consola enseña antes de guardar.
   *
   * 🪤 Cambiarla, solo quien administra xencrm: la consola deja pasar a `retencion` solo para leer. Borra datos de
   * clientes, y eso no se decide desde la operación del día.
   */
  const retencion = (dias?: number) => {
    const p = politicaDeRetencion();
    const d = dias && Number.isInteger(dias) && dias >= DIAS_MINIMO && dias <= DIAS_MAXIMO ? dias : (p?.dias ?? DIAS_SUGERIDOS);
    return { politica: p, ultima: ultimaPasada(), previa: vistaPrevia(d), minimo: DIAS_MINIMO, maximo: DIAS_MAXIMO, sugeridos: DIAS_SUGERIDOS };
  };
  app.get('/admin/api/retencion', (c) => c.json(retencion(Number(c.req.query('dias')) || undefined)));
  app.put('/admin/api/retencion', async (c) => {
    try {
      const b = (await c.req.json().catch(() => ({}))) as { dias?: number | string | null; accion?: string | null };
      ponerPolitica(b);
      return c.json(retencion());
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'no pude guardar la retención' }, 400);
    }
  });

  /**
   * Los proveedores de IA (src/proveedores.ts): conectar OpenAI, Claude, Apple, Ollama, LM Studio o una API
   * compatible desde Configuración › Modelos de IA.
   *
   * 🪤 Van bajo `motores/` a propósito, como el tope: la consola reserva `motores` a quien administra XENCRM (un asesor
   * no llega ni para leer) y el candado no deja leerlo. Y una llave NUNCA sale por aquí: solo si está puesta y una
   * pista. Lo guardado se aplica al reiniciar, y cada respuesta lo dice (`hayQueReiniciar`).
   */
  app.get('/admin/api/motores/proveedores', (c) =>
    c.json({
      proveedores: proveedores(),
      // Cómo se llama cada rol y qué hace, para elegir sin adivinar (los mismos textos de la consola).
      roles: ROLES.map((rol) => ({ rol, nombre: ROL_NOMBRE[rol], queHace: ROL_QUE_HACE[rol], ...(CUIDADO[rol] ? { cuidado: CUIDADO[rol] } : {}) })),
      puedeReiniciarse: motoresDe().puedeReiniciarse,
    }),
  );

  app.put('/admin/api/motores/proveedores/:id', async (c) => {
    const id = c.req.param('id');
    if (!esProveedor(id)) return c.json({ error: 'ese proveedor no existe' }, 404);
    try {
      const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const texto = (k: string) => (typeof b[k] === 'string' ? (b[k] as string) : undefined);
      return c.json({ ok: true, ...(await guardarProveedor(id, { llave: texto('llave'), url: texto('url'), modelo: texto('modelo'), nombre: texto('nombre') })) });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'no pude guardarlo' }, 400);
    }
  });

  app.delete('/admin/api/motores/proveedores/:id/llave', (c) => {
    const id = c.req.param('id');
    if (!esProveedor(id)) return c.json({ error: 'ese proveedor no existe' }, 404);
    try {
      return c.json({ ok: true, ...quitarLlave(id) });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'no pude quitarla' }, 400);
    }
  });

  // Prueba lo guardado sin gastar: pregunta qué modelos hay, no genera nada.
  app.post('/admin/api/motores/proveedores/:id/probar', async (c) => {
    const id = c.req.param('id');
    if (!esProveedor(id)) return c.json({ error: 'ese proveedor no existe' }, 404);
    return c.json(await probarProveedor(id));
  });

  /**
   * Las reglas y umbrales (src/reglas.ts): cada número que decide algo de negocio, con su valor de fábrica, lo que
   * trae el archivo del cliente, lo que se puso desde el tablero y cuál manda. Leerlas no es secreto (el tablero
   * pinta con ellas); cambiarlas es de quien administra XENCRM: el candado cierra el PUT (no está en su lista de lo
   * que se puede cambiar) y la consola se lo deja solo al super-admin (consola.ts, SOLO_SUPER_CAMBIA).
   */
  app.get('/admin/api/reglas', (c) => c.json(registro()));
  app.get('/admin/api/reglas/valores', (c) => c.json(valoresDeReglas()));
  app.put('/admin/api/reglas', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { cambios?: Record<string, unknown> };
    if (!body.cambios || typeof body.cambios !== 'object' || Array.isArray(body.cambios)) return c.json({ error: 'manda { cambios: { "<id>": valor } } (null vuelve al de fábrica)' }, 400);
    const r = cambiarReglas(body.cambios);
    if (!r.ok) return c.json({ error: 'hay reglas que no valen: no se guardó ninguna', errores: r.errores }, 400);
    return c.json({ ok: true, cambiadas: r.cambiadas, ...registro() });
  });

  app.put('/admin/api/motores/tope', async (c) => {
    try {
      const b = (await c.req.json().catch(() => ({}))) as { tope?: number | string | null };
      return c.json(ponerTope(b.tope ?? null));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'no pude guardar el tope' }, 400);
    }
  });

  /**
   * La clave de OpenAI de este cliente: la suya o la de la casa.
   *
   * 🪤 NUNCA devuelve la clave, ni la propia ni la de la casa: solo si la tiene y una pista para reconocerla.
   * Una clave que sale al navegador queda en el historial, en la caché y en cualquier captura de pantalla que
   * alguien haga del tablero.
   */
  app.get('/admin/api/clave', (c) => c.json(claveDelCliente()));

  app.post('/admin/api/clave', async (c) => {
    try {
      const b = (await c.req.json()) as { clave?: string; encender?: boolean; olvidar?: boolean };
      // Encender y apagar no piden la clave: ya está guardada. Es lo que hace falta para una demostración —se
      // enciende la del día, se apaga al terminar— sin volver a pegarla cada vez, que es como se pega mal.
      if (b.encender === true) return c.json(encenderClaveDelCliente());
      if (b.encender === false) return c.json(apagarClaveDelCliente());
      if (b.olvidar) return c.json(quitarClaveDelCliente());
      if (!b.clave) return c.json(apagarClaveDelCliente());
      return c.json(await ponerClaveDelCliente(String(b.clave)));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'no pude guardarla' }, 400);
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
   * Ver los grupos. Va aparte del interruptor del canal a propósito: encender el canal es una decisión de
   * negocio, y mirar los grupos es una decisión sobre los datos de gente que no eligió estar aquí. No se
   * mezclan en el mismo botón.
   */
  app.post('/admin/api/channels/:id/modo', async (c) => {
    const id = c.req.param('id') as ChannelId;
    if (!['web', 'whatsapp', 'meta', 'mcp'].includes(id)) return c.json({ error: 'canal desconocido' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { modo?: string };
    if (body.modo !== 'mira' && body.modo !== 'propone' && body.modo !== 'contesta') return c.json({ error: 'modo desconocido' }, 400);
    setModoCanal(id, body.modo);
    return c.json(channelCards());
  });

  /** Lo que XENCRM dejó listo y espera a una persona. */
  app.get('/admin/api/propuestas', (c) => c.json(propuestasPendientes()));

  /**
   * Mandar lo propuesto. 🪤 Si el texto viene igual, lo manda XENCRM (author bot): es suyo y del propio asistente
   * no se aprende nada. Si alguien lo corrigió, lo manda esa persona y sí entra al aprendizaje, porque eso —lo
   * que una persona escribió de verdad— es lo que enseña cómo atiende este negocio.
   */
  app.post('/admin/api/propuestas/:id/enviar', async (c) => {
    const p = verPropuesta(Number(c.req.param('id')));
    if (!p) return c.json({ error: 'esa propuesta ya no está' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { texto?: string; by?: string };
    const texto = (body.texto ?? p.texto).trim();
    if (!texto) return c.json({ error: 'no hay nada que mandar' }, 400);
    const corregida = texto !== p.texto.trim();
    const by = (body.by ?? '').trim();
    // 🪤 Un grupo no es un contacto —a propósito—, así que sendToContact no sirve ahí: revienta con «no
    // existe». Lo del grupo sale suelto, por el canal, sin ficha ni ventana de 24 horas que mirar.
    try {
      if (p.grupo) {
        const fue = await enviarSuelto('whatsapp', p.userId, texto);
        if (!fue) return c.json({ error: 'WhatsApp no está conectado ahora mismo' }, 400);
      } else {
        await sendToContact(p.userId, texto, corregida ? 'human' : 'bot', corregida ? { by } : {});
      }
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
    cerrarPropuesta(p.id, 'enviada', by);
    return c.json({ ok: true, corregida });
  });

  app.post('/admin/api/propuestas/:id/descartar', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { by?: string };
    return cerrarPropuesta(Number(c.req.param('id')), 'descartada', (body.by ?? '').trim())
      ? c.json({ ok: true })
      : c.json({ error: 'esa propuesta ya no está' }, 404);
  });

  app.post('/admin/api/channels/:id/grupos', async (c) => {
    const id = c.req.param('id') as ChannelId;
    if (id !== 'whatsapp') return c.json({ error: 'los grupos solo aplican a WhatsApp' }, 400);
    const body = (await c.req.json().catch(() => ({}))) as { grupos?: boolean };
    if (typeof body.grupos !== 'boolean') return c.json({ error: 'grupos requerido' }, 400);
    setGrupos(id, body.grupos);
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
  // Con ?sede=, los bloques que ocupan esa sede (los generales y los suyos); sin ella, todos.
  app.get('/admin/api/busy', (c) => c.json(busyIntervals(Number(c.req.query('from') ?? Date.now()), Number(c.req.query('to') ?? Date.now() + 7 * 86400_000), c.req.query('sede') || undefined)));

  app.get('/admin/api/slots', (c) => {
    const weekday = c.req.query('weekday') !== undefined ? Number(c.req.query('weekday')) : undefined;
    const count = Number(c.req.query('count') ?? 8);
    const sede = c.req.query('sede') || null;
    return c.json(availableSlots({ count, weekday, spreadDays: false, sede }).map((s) => ({ startsAt: s.startsAt.toISOString(), label: formatSlot(s.startsAt) })));
  });

  app.post('/admin/api/appointments', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { userId?: string; startsAt?: string; notes?: string; sede?: string };
    if (!body.userId || !body.startsAt) return c.json({ error: 'userId y startsAt requeridos' }, 400);
    if (!getContact(body.userId)) return c.json({ error: 'contacto no existe' }, 404);
    try {
      const appt = bookAppointment(body.userId, new Date(body.startsAt), { notes: body.notes ?? 'Agendada desde el tablero', by: quienHace(c), sede: body.sede || null, desdeElTablero: true });
      return c.json({ appointment: { ...appt, label: formatSlot(new Date(appt.startsAt)) } });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 409);
    }
  });

  app.patch('/admin/api/appointments/:id', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { status?: 'confirmada' | 'cancelada' | 'completada' | 'no_asistio'; notes?: string };
    const appt = updateAppointment(Number(c.req.param('id')), body, quienHace(c));
    if (!appt) return c.json({ error: 'no existe' }, 404);
    return c.json({ appointment: { ...appt, label: formatSlot(new Date(appt.startsAt)) } });
  });

  // Recordatorio hecho a mano (por WhatsApp desde el teléfono del negocio): sale de "Recordar a mano".
  app.post('/admin/api/appointments/:id/reminded', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { by?: string };
    const appt = setReminder(Number(c.req.param('id')), 'enviado', `A mano, por ${body.by?.toString().trim().slice(0, 40) || 'el equipo'}`);
    return appt ? c.json({ appointment: appt }) : c.json({ error: 'no existe' }, 404);
  });

  // La moneda va aquí porque el tablero la necesita desde el arranque para escribir cualquier valor.
  app.get('/admin/api/stats', (c) =>
    c.json({
      ...stats(), stageLabels: STAGE_LABELS, stages: STAGE_DEFS, moneda: business.business.currency, motivosPerdida: business.crm.motivosPerdida, modo: modoDelTablero(),
      // Lo que se puede escribir en la ficha de cada persona (crm/ficha.ts): lo de contacto y lo que capta este negocio.
      ficha: { contacto: CAMPOS_DE_CONTACTO, contactoPor: business.crm.contactoPor, delNegocio: business.crm.fields.filter((f) => camposEditables().includes(f.name) && !CAMPOS_DE_CONTACTO.some((x) => x.k === f.name)).map((f) => ({ k: f.name, ayuda: f.description })) },
    }),
  );

  /**
   * Cómo entra el equipo a este tablero: «fácil» (lo del día a día, sin puntajes ni motores) o «completo». Es del
   * cliente y lo cambia solo quien administra XENCRM (el candado de más arriba frena a los demás); con el modo fácil
   * puesto, nadie más se sale de él (channels/candado.ts).
   */
  app.put('/admin/api/tablero/modo', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { modo?: string };
    if (body.modo !== 'facil' && body.modo !== 'completo') return c.json({ error: 'el modo es «facil» o «completo»' }, 400);
    setSetting('tablero.modo', body.modo);
    return c.json({ modo: modoDelTablero() });
  });

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
    slug: (process.env.XENCRM_SLUG ?? business.business.name).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    nombre: business.business.name,
    config: resolve(process.env.XENCRM_CONFIG || 'xencrm.config.json'),
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
    const acuerdoMin = regla<number>('atencion.acuerdoMinutos');
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
    // La misma regla de Configuración › Reglas y umbrales (atencion.acuerdoMinutos, llave sla.minutos).
    ponerRegla('atencion.acuerdoMinutos', Math.round(minutos));
    return c.json({ ok: true, minutos: Math.round(minutos) });
  });

  /**
   * KPIs y metas (los objetivos de Dynamics 365): los números del periodo contra el periodo anterior igual de largo,
   * por persona lo que se puede atribuir, y cómo van las metas en la semana o el mes del calendario. Sin modelo y sin
   * red (crm/kpis.ts). Es del que vende: el candado lo deja leer.
   */
  app.get('/admin/api/kpis', (c) => c.json(calcularKpis({ dias: Number(c.req.query('dias') ?? 30) || 30, acuerdoMin: regla<number>('atencion.acuerdoMinutos') })));

  /**
   * Las metas. Leerlas es de todos (cada quien sabe a qué se apunta); ponerlas es de quien administra XENCRM: con el
   * candado esta ruta no está en la lista de lo que se puede cambiar, y por la consola solo la cambia el super-admin
   * (consola.ts, SOLO_SUPER_CAMBIA). Todo o nada: si una meta viene mal, no se guarda ninguna.
   */
  app.get('/admin/api/metas', (c) => c.json({ metas: leerMetas(), definiciones: KPIS }));
  app.put('/admin/api/metas', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { metas?: unknown };
    const r = limpiarMetas(body.metas);
    if ('error' in r) return c.json(r, 400);
    return c.json({ metas: guardarMetas(r.metas), definiciones: KPIS });
  });

  /**
   * Servicio › Tickets y SLA (crm/tickets.ts): lo que reportan los clientes, con el reloj del SLA de su plan. Sin
   * modelo ni red. Todo lo del negocio (planes, prioridades, tipos, estados, objetivos, reglas) sale de la
   * configuración en tres capas; quién puede abrir, mover y cambiar la configuración también (`permisos`), y se
   * decide aquí con el rol de la sesión (x-xencrm-rol, lo pone la consola; sin él es el token a secas).
   */
  const rolDe = (c: { req: { header(n: string): string | undefined } }) => c.req.header('x-xencrm-rol') || undefined;
  const NO_PUEDE = 'en este negocio eso lo hace quien administra; pídeselo';
  app.get('/admin/api/tickets', (c) => {
    const contacto = c.req.query('contacto');
    const dias = Number(c.req.query('dias') ?? 90) || 90;
    const cfg = configSla();
    return c.json({ tickets: listarTickets({ contacto: contacto || undefined, dias }), config: vistaDeConfig(cfg), puede: { crear: puedeEnSla(cfg.permisos.crear, rolDe(c)), mover: puedeEnSla(cfg.permisos.mover, rolDe(c)) }, ahora: Date.now() });
  });
  app.get('/admin/api/tickets/:id', (c) => {
    const t = verTicket(Number(c.req.param('id')));
    return t ? c.json(t) : c.json({ error: 'ese ticket no existe' }, 404);
  });
  app.post('/admin/api/tickets', async (c) => {
    if (!puedeEnSla(configSla().permisos.crear, rolDe(c))) return c.json({ error: NO_PUEDE }, 403);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    try {
      return c.json(crearTicket(body, quienHace(c, body.by)));
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });
  app.patch('/admin/api/tickets/:id', async (c) => {
    if (!puedeEnSla(configSla().permisos.mover, rolDe(c))) return c.json({ error: NO_PUEDE }, 403);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    try {
      return c.json(cambiarTicket(Number(c.req.param('id')), body, quienHace(c, body.by)));
    } catch (err) {
      const msg = (err as Error).message;
      return c.json({ error: msg }, msg === 'ese ticket no existe' ? 404 : 400);
    }
  });
  app.get('/admin/api/sla', (c) => c.json({ ...slaDelPeriodo(Number(c.req.query('dias') ?? 30) || 30), config: vistaDeConfig() }));
  /** Configuración › SLA y tickets: la que manda, de qué capa sale cada parte, la de fábrica y las reglas sueltas. */
  const configParaElTablero = (c: { req: { header(n: string): string | undefined } }) => {
    const cfg = configSla();
    const archivo = (business as { servicio?: { sla?: unknown } }).servicio?.sla;
    return { config: cfg, fabrica: SLA_DE_FABRICA, capas: capasDe(), reglas: reglasSla(cfg), tieneArchivo: Boolean(archivo), puedeEditar: puedeEnSla(cfg.permisos.politicas, rolDe(c)), jornadaMin: vistaDeConfig(cfg).jornadaMin };
  };
  app.get('/admin/api/sla/config', (c) => c.json(configParaElTablero(c)));
  app.put('/admin/api/sla/config', async (c) => {
    if (!puedeEnSla(configSla().permisos.politicas, rolDe(c))) return c.json({ error: NO_PUEDE }, 403);
    const body = (await c.req.json().catch(() => ({}))) as { estructura?: unknown; reglas?: Record<string, unknown> };
    const r = guardarConfigSla(body);
    if ('error' in r) return c.json(r, 400);
    return c.json(configParaElTablero(c));
  });
  /** Volver a lo del archivo del cliente (o a lo de fábrica): se borra solo lo que se cambió desde el tablero. */
  app.delete('/admin/api/sla/config', (c) => {
    if (!puedeEnSla(configSla().permisos.politicas, rolDe(c))) return c.json({ error: NO_PUEDE }, 403);
    olvidarConfigDelTablero();
    return c.json(configParaElTablero(c));
  });

  /** De dónde salió cada conversación y en qué terminó: el embudo por campaña. */
  app.get('/admin/api/origenes', (c) => {
    const dias = Math.min(365, Math.max(1, Number(c.req.query('dias') ?? 30) || 30));
    return c.json({ dias, ...porCampana({ desde: Date.now() - dias * 86400_000 }) });
  });

  /**
   * El sentimiento de la cartera (Analítica › Sentimiento): interés, ánimo, su cruce, las objeciones que se repiten
   * y cómo cambió por día. Solo cuenta lo que el análisis por turno ya guardó: sin modelo y sin red. Es del que
   * vende, así que el candado deja leerlo (channels/candado.ts lee todo menos lo avanzado).
   */
  app.get('/admin/api/sentimiento', (c) => c.json(sentimiento(Number(c.req.query('dias') ?? 30) || 30)));

  /**
   * A quién avisar cuando alguien lleva esperando de más. Es lo único que funciona con el navegador cerrado, y
   * por eso va por WhatsApp: es lo que la gente mira.
   */
  app.get('/admin/api/avisos', (c) => c.json({ numeros: aQuienAvisar(), acuerdoMin: regla<number>('atencion.acuerdoMinutos'), pendientes: loQueHayQueAvisar().length }));

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
      citas: citasPorDia(dias),
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
      listAppointments({ from: now - regla<number>('seg.diasEsperandoResultado') * 86400_000, to: now, status: 'confirmada', limit: 1000 })
        .filter((a) => a.endsAt < now)
        .map((a) => a.userId),
    );
    const citasHoy = listAppointments({ from: startOfDay.getTime(), to: endOfDay, status: 'confirmada' });
    return c.json({
      // Los cuatro números de arriba. Se calculan aquí y no en el navegador porque las listas de abajo van
      // recortadas a 20 por sitio: contar sobre ellas daría «20 calientes» en un negocio con cuarenta.
      resumen: {
        activas: open.length,
        nuevos: all.filter((x) => (x.firstSeen ?? 0) >= startOfDay.getTime()).length,
        calientes: open.filter((x) => x.score >= regla<number>('puntaje.caliente')).length,
        citasHoy: citasHoy.length,
      },
      // Lo que hay en el embudo, en dinero. Ver crm/valor.ts para de dónde sale y por qué 0 no es «no vale».
      embudo: valorDelEmbudo(),
      appointments: citasHoy.map((a) => ({ ...a, label: formatSlot(new Date(a.startsAt), { withDay: false }), remindAt: reminderTime(a.startsAt, a.sede) })),
      // Citas que ya pasaron y siguen "confirmadas": su resultado (vino, no vino, compró) es lo que calibra el puntaje.
      past: listAppointments({ from: now - regla<number>('seg.diasEsperandoResultado') * 86400_000, to: now, status: 'confirmada' })
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
        .filter((x) => x.scoreBase >= regla<number>('puntaje.caliente') && !withUpcoming.has(x.id) && !waitingOutcome.has(x.id) && (x.lastMessageAt ?? 0) < now - regla<number>('seg.horasSinSeguimiento') * 3600_000 && !isSnoozed(x, now))
        .slice(0, 20),
      upcoming: listAppointments({ from: endOfDay, to: endOfDay + 3 * 86400_000, status: 'confirmada' }).map((a) => ({ ...a, label: formatSlot(new Date(a.startsAt)), remindAt: reminderTime(a.startsAt, a.sede) })),
      // Lo que el bot no supo y prometió verificar: el cliente espera la respuesta del equipo.
      verifications: listVerifications('pendiente').map((v) => ({ ...v, window: replyWindow(v.userId) })),
      public: publicStatus(),
      // Lo que XENCRM dejó listo en un grupo: ahí no hay conversación en el tablero donde pueda aparecer, así que
      // su sitio es este. Las de una conversación normal salen dentro de ella.
      enGrupos: propuestasPendientes()
        .filter((p) => p.grupo)
        // Con quién habla: en un grupo no hay ficha que abrir, así que la gente va aquí o no va a ninguna parte.
        .map((p) => ({ ...p, gente: genteDelGrupo(p.userId.replace(/^wa:/, ''), 6) })),
    });
  });

  app.get('/admin/api/notifications', (c) => c.json(listNotifications(Number(c.req.query('limit') ?? 30))));

  app.get('/admin/api/agent', (c) =>
    c.json({
      business: business.business,
      agent: business.agent,
      appointments: business.appointments,
      // Las sedes, para escoger en cuál al agendar a mano y para filtrar el calendario (crm/sedes.ts).
      // Con su agenda ya resuelta (lo que no dicen, heredado): el calendario pinta abierto y cerrado con esto.
      sedes: business.sedes.map((s) => {
        const ag = agendaDe(s.id);
        return { id: s.id, nombre: s.nombre, direccion: s.direccion, days: ag.days, hours: ag.hours, capacity: ag.capacity };
      }),
      crmFields: business.crm.fields,
      timezone: business.timezone,
      engines: engineStatus(),
      roles: { mode: env.llmEngine, light: roleLabel('light'), heavy: roleLabel('heavy'), gate: roleLabel('gate'), analysis: roleLabel('analysis') },
      models: { chat: env.chatModel, embed: env.embedModel, openai: env.openaiModel },
      docs: countDocs(),
      publicUrl: env.publicUrl || `http://localhost:${env.port}`,
      // Si deja respuestas listas cuando la conversación la lleva una persona (crm/propuestas.ts).
      sugiereConPersona: sugiereConPersona(),
    }),
  );

  /**
   * Que XENCRM acompañe cuando la lleva una persona: lo que el cliente pregunte y XENCRM sepa, queda redactado encima
   * del cajón de quien atiende. Es del negocio, no de quien administra xencrm: cuesta una llamada al modelo por
   * mensaje mientras alguien la lleva, y eso lo decide quien paga.
   */
  app.put('/admin/api/agent/sugiere', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { on?: unknown };
    if (typeof body.on !== 'boolean') return c.json({ error: 'on requerido (true o false)' }, 400);
    ponerSugiereConPersona(body.on);
    return c.json({ ok: true, sugiereConPersona: sugiereConPersona() });
  });

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

  // ── Los documentos del negocio ────────────────────────────────────────────
  //
  // Cargarle conocimiento desde el tablero, que hasta ahora solo se podía haciendo ssh al servidor. Ver
  // `rag/documentos.ts` para por qué todo acaba en un archivo y no solo en la base.
  app.get('/admin/api/documentos', (c) => c.json({ documentos: documentosDelNegocio(), docs: countDocs() }));

  app.post('/admin/api/documentos', async (c) => {
    try {
      // Dos formas de llegar y una sola salida: un archivo que alguien sube, o un texto escrito a mano en el
      // tablero. Las dos acaban en el mismo `.md` en la carpeta del negocio.
      if ((c.req.header('content-type') ?? '').includes('multipart/form-data')) {
        const form = await c.req.parseBody({ all: true });
        const sueltos = form.archivo;
        const archivos = (Array.isArray(sueltos) ? sueltos : [sueltos]).filter((f): f is File => f instanceof File);
        if (!archivos.length) return c.json({ error: 'no llegó ningún archivo' }, 400);
        const hechos = [];
        const fallos: string[] = [];
        for (const f of archivos.slice(0, 10)) {
          try {
            // El mismo lector de la libreta: Word, Excel y texto, sin añadir dependencias. Y los mismos noes:
            // un ejecutable disfrazado de .docx no entra tampoco por aquí.
            const leido = leerAdjunto(f.name, new Uint8Array(await f.arrayBuffer()));
            hechos.push(await guardarDocumento(f.name, leido.texto));
          } catch (e) {
            fallos.push(e instanceof Error ? e.message : `no pude leer "${f.name}"`);
          }
        }
        if (!hechos.length) return c.json({ error: fallos.join('. ') || 'no pude leer nada' }, 400);
        return c.json({ ok: true, documentos: hechos, fallos, docs: countDocs() });
      }
      const body = (await c.req.json()) as { titulo?: string; contenido?: string };
      const hecho = await guardarDocumento(body.titulo ?? '', body.contenido ?? '', body.titulo ?? '');
      return c.json({ ok: true, documentos: [hecho], fallos: [], docs: countDocs() });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'no pude guardarlo' }, 400);
    }
  });

  app.delete('/admin/api/documentos/:archivo{.+}', async (c) => {
    try {
      const fue = await borrarDocumento(decodeURIComponent(c.req.param('archivo')));
      return fue ? c.json({ ok: true, docs: countDocs() }) : c.json({ error: 'ese documento ya no está' }, 404);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'no pude borrarlo' }, 400);
    }
  });

  // ── Modo prueba ───────────────────────────────────────────────────────────
  //
  // Para una demostración en vivo: que XENCRM conteste solo a unos chats y a nadie más. Ver `crm/modo-prueba.ts`
  // para por qué caduca sola y por qué una lista vacía significa apagado.
  app.get('/admin/api/prueba', (c) => {
    const p = pruebaActiva();
    return c.json(p ? { activa: true, ...p, queda: cuantoLeQueda(p), horasMaximo: HORAS_MAXIMO } : { activa: false, horasMaximo: HORAS_MAXIMO });
  });

  app.post('/admin/api/prueba', async (c) => {
    try {
      const b = (await c.req.json()) as { chats?: string[]; horas?: number; por?: string };
      if (b.chats === null || (Array.isArray(b.chats) && !b.chats.length)) {
        quitarPrueba();
        return c.json({ ok: true, activa: false });
      }
      const p = ponerPrueba(Array.isArray(b.chats) ? b.chats.map(String) : [], Number(b.horas), String(b.por ?? ''));
      return c.json({ ok: true, activa: true, ...p, queda: cuantoLeQueda(p) });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'no pude ponerla' }, 400);
    }
  });

  app.delete('/admin/api/prueba', (c) => {
    quitarPrueba();
    return c.json({ ok: true, activa: false });
  });

  // ── El monitor de una demostración en vivo ────────────────────────────────
  //
  // Lo que la conversación no dice: si cada respuesta salió del guion o la improvisó el modelo, cuánto tardó, si
  // el asistente acaba de admitir que no sabe algo. Ver `crm/vivo.ts`.
  app.get('/admin/api/vivo', (c) => {
    const p = pruebaActiva();
    return c.json({ ...comoVa(Number(c.req.query('turnos')) || 25), prueba: p ? { chats: p.chats, queda: cuantoLeQueda(p) } : null, gasto: gastoDeLaDemo() });
  });

  app.delete('/admin/api/vivo', (c) => {
    olvidarTodo();
    return c.json({ ok: true });
  });

  /** La pantalla del monitor. Va aparte del tablero a propósito: se mira en otro aparato mientras se presenta. */
  app.get('/admin/monitor', (c) =>
    paginaConCsp(c, readFileSync(new URL('../../public/monitor.html', import.meta.url), 'utf8').replaceAll('__NEGOCIO__', business.business.name)),
  );

  // ── Respuestas rápidas ────────────────────────────────────────────────────
  //
  // Lo que se pregunta mucho, contestado una vez. Sale como sugerencia o se manda sola según el modo del canal;
  // ver `crm/respuestas-rapidas.ts`.
  app.get('/admin/api/rapidas', (c) => c.json({ rapidas: respuestasRapidas() }));

  app.post('/admin/api/rapidas', async (c) => {
    try {
      const b = (await c.req.json()) as { id?: number; tema?: string; ejemplos?: string[]; respuesta?: string; estado?: 'borrador' | 'lista'; origen?: string };
      const r = await guardarRespuestaRapida({
        id: b.id,
        tema: b.tema ?? '',
        ejemplos: Array.isArray(b.ejemplos) ? b.ejemplos.map(String) : [],
        respuesta: b.respuesta,
        estado: b.estado,
        origen: b.origen,
      });
      return c.json({ ok: true, rapida: r });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'no pude guardarla' }, 400);
    }
  });

  app.delete('/admin/api/rapidas/:id', (c) =>
    borrarRespuestaRapida(Number(c.req.param('id'))) ? c.json({ ok: true }) : c.json({ error: 'esa ya no está' }, 404),
  );

  /**
   * Ensayar una pregunta: ¿saldría por el guion o se iría al modelo?
   *
   * 🪤 No le manda nada a nadie y no cuenta como uso. Es para antes de una demostración en vivo: teclear la
   * pregunta exacta que se le va a guiar al cliente y saber, ANTES de estar delante de la gente, si va a salir
   * la respuesta escrita —instantánea y sin posibilidad de inventar— o si va a pasar por el modelo, que tarda y
   * puede decir que no sabe. Descubrir eso en el escenario es el peor momento, y es exactamente cuando se
   * descubre si no hay forma de ensayarlo.
   */
  app.post('/admin/api/rapidas/probar', async (c) => {
    const texto = String(((await c.req.json().catch(() => ({}))) as { texto?: string }).texto ?? '').trim();
    if (!texto) return c.json({ error: 'escribe la pregunta' }, 400);
    const a = await buscarRespuestaRapida(texto);
    return a
      ? c.json({ acierta: true, tema: a.respuesta.tema, respuesta: a.respuesta.respuesta, comoLoPreguntan: a.comoLoPreguntan, parecido: Math.round(a.parecido * 100) })
      : c.json({ acierta: false });
  });

  /**
   * Leer material del historial y proponer temas.
   *
   * 🪤 Propone y NO guarda. Lo que vuelve es una lista para que una persona la mire: guardarlo directo
   * convertiría un documento que alguien dejó en una carpeta en configuración viva del asistente sin que nadie
   * lo hubiera aprobado. Y nunca trae respuestas, por lo mismo que explica `crm/aprender-temas.ts`.
   */
  app.post('/admin/api/rapidas/del-material', async (c) => {
    try {
      let texto = '';
      if ((c.req.header('content-type') ?? '').includes('multipart/form-data')) {
        const form = await c.req.parseBody();
        const f = form.archivo;
        if (!(f instanceof File)) return c.json({ error: 'no llegó ningún archivo' }, 400);
        texto = leerAdjunto(f.name, new Uint8Array(await f.arrayBuffer())).texto;
      } else {
        texto = String(((await c.req.json()) as { texto?: string }).texto ?? '');
      }
      return c.json({ temas: await temasDelMaterial(texto) });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'no pude leer ese material' }, 400);
    }
  });

  /** El catálogo de productos, que es la otra mitad: fichas con precio, no fragmentos de texto. */
  app.post('/admin/api/catalogo', async (c) => {
    try {
      const form = await c.req.parseBody();
      const f = form.archivo;
      if (!(f instanceof File)) return c.json({ error: 'no llegó ningún archivo' }, 400);
      const texto = new TextDecoder().decode(new Uint8Array(await f.arrayBuffer()));
      const productos = await guardarCatalogo(texto, /\.csv$/i.test(f.name));
      return c.json({ ok: true, productos, docs: countDocs() });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'no pude guardar el catálogo' }, 400);
    }
  });

  /**
   * Lo que XENCRM sabe del negocio y no le cuenta a nadie. Va por su propia puerta a propósito: mezclarlo con
   * `/knowledge` sería invitar a que algún día se sirvan juntos.
   */
  app.get('/admin/api/interno', (c) => c.json(notasInternas()));

  /**
   * Que XENCRM escriba lo que entendió del negocio. Devuelve un BORRADOR y no guarda nada: quien lo lea decide
   * qué es cierto. Un retrato equivocado guardado solo sería peor que no tener ninguno.
   */
  app.post('/admin/api/interno/retrato', async (c) => {
    try {
      return c.json(await retratoDelNegocio());
    } catch (err) {
      return c.json({ error: (err as Error).message }, 502);
    }
  });

  app.post('/admin/api/interno', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { id?: string; titulo?: string; contenido?: string };
    const contenido = (body.contenido ?? '').trim();
    if (!contenido) return c.json({ error: 'escribe algo' }, 400);
    return c.json(await guardarNotaInterna({ id: body.id, titulo: body.titulo ?? '', contenido }));
  });

  app.delete('/admin/api/interno/:id', (c) =>
    borrarNotaInterna(c.req.param('id')) ? c.json({ ok: true }) : c.json({ error: 'no existe' }, 404),
  );

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
