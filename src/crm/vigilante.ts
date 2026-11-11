// El que avisa cuando nadie está mirando.
//
// Todo lo demás del tablero depende de que alguien tenga la pestaña abierta: los avisos en pantalla, el sonido,
// la notificación del navegador. Si el equipo cierra el portátil a las seis, lo que entre después se queda ahí.
// Y con el asistente en «solo escuchar» —que es como se enchufa el WhatsApp de un negocio de verdad— eso
// significa que nadie contesta.
//
// Así que esto mira cada minuto quién lleva esperando más de lo que el negocio prometió y **sale a buscar a una
// persona** por donde sí la va a encontrar: su propio WhatsApp.
//
// Tres cosas que lo hacen soportable, porque un vigilante que molesta se apaga y entonces no sirve de nada:
//
//  1. **Apagado hasta que alguien diga a quién avisar.** Sin números configurados no manda nada.
//  2. 🪤 **Un aviso por espera, no uno por minuto.** Se anota a quién ya se avisó y no se repite hasta que esa
//     conversación se responda. Sin esto, una conversación olvidada un domingo manda cientos de mensajes.
//  3. **Respeta el horario.** El reloj de la espera ya no corre fuera de la jornada, así que tampoco suena de
//     madrugada por algo que entró de madrugada.
import { regla } from '../reglas.js';
import { business } from '../config.js';
import { getSetting } from './settings.js';
import { getContact } from './contacts.js';
import { enviarSuelto } from './outbox.js';
import { esperas } from './tiempos.js';
import { onEvent } from './events.js';

/** A quién avisar. Números en formato internacional sin signos, como los guarda WhatsApp. */
export const aQuienAvisar = (): string[] =>
  getSetting<string[]>('avisos.whatsapp', [])
    .map((n) => String(n).replace(/\D/g, ''))
    .filter((n) => n.length >= 8);

/** Ya avisados, para no repetir. Vive en memoria: si el proceso se reinicia, como mucho se avisa una vez más. */
const yaAvisados = new Set<string>();

/** Cuántos avisos van en la última hora, como freno de último recurso. */
let ultimaHora: { desde: number; n: number } = { desde: 0, n: 0 };
const TOPE_POR_HORA = 12; // el de fábrica: manda la regla vigilante.topePorHora

export interface Aviso {
  userId: string;
  nombre: string;
  minutos: number;
  texto: string;
}

/** Lo que habría que avisar ahora mismo, sin mandar nada. Separado para poder probarlo sin enviar. */
export function loQueHayQueAvisar(opts: { acuerdoMin?: number; ahora?: number } = {}): Aviso[] {
  const acuerdoMin = opts.acuerdoMin ?? regla<number>('atencion.acuerdoMinutos');
  const ahora = opts.ahora ?? Date.now();
  const abiertas = esperas({ desde: ahora - 7 * 86400_000, ahora }).filter((e) => e.hasta === null);
  const out: Aviso[] = [];
  for (const e of abiertas) {
    const minutos = Math.round(e.msHabiles / 60_000);
    if (minutos < acuerdoMin) continue;
    if (yaAvisados.has(e.userId)) continue;
    const ficha = getContact(e.userId);
    const nombre = ficha?.name || e.userId.replace(/^\w+:/, '').split('@')[0] || 'alguien';
    out.push({
      userId: e.userId,
      nombre,
      minutos,
      texto:
        `⏳ ${nombre} lleva ${minutos} min esperando respuesta en ${business.business.name}.` +
        (e.mensajes > 1 ? ` Escribió ${e.mensajes} veces.` : '') +
        ` Lo acordado son ${acuerdoMin} min.`,
    });
  }
  // A quien ya se respondió se le quita la marca, para que la próxima vez que espere vuelva a avisar.
  const esperandoAhora = new Set(abiertas.map((e) => e.userId));
  for (const id of yaAvisados) if (!esperandoAhora.has(id)) yaAvisados.delete(id);
  return out;
}

/** Manda los avisos pendientes. Devuelve cuántos salieron. */
export async function avisar(opts: { acuerdoMin?: number; ahora?: number } = {}): Promise<number> {
  const destinos = aQuienAvisar();
  if (!destinos.length) return 0;
  const ahora = opts.ahora ?? Date.now();
  if (ahora - ultimaHora.desde > 3600_000) ultimaHora = { desde: ahora, n: 0 };

  let salieron = 0;
  for (const aviso of loQueHayQueAvisar(opts)) {
    if (ultimaHora.n >= regla<number>('vigilante.topePorHora')) break; // algo va mal: mejor callarse que inundar a nadie
    let alguno = false;
    for (const numero of destinos) {
      // Por el canal que esté vivo. El del sitio web no sirve para esto: nadie tiene esa página abierta.
      const ok =
        (await enviarSuelto('whatsapp', `wa:${numero}@s.whatsapp.net`, aviso.texto)) ||
        (await enviarSuelto('meta', `meta:${numero}`, aviso.texto));
      alguno = alguno || ok;
    }
    if (alguno) {
      yaAvisados.add(aviso.userId);
      ultimaHora.n++;
      salieron++;
    }
  }
  return salieron;
}

let reloj: NodeJS.Timeout | null = null;

/**
 * El tope de gasto también sale a buscar a una persona: al 80 %, al 90 % y al 100 %, una vez cada uno por mes (eso
 * lo cuida crm/presupuesto.ts). Es el aviso que más importa recibir con el portátil cerrado: al 100 % lo que
 * necesita IA lo contesta el equipo, y si nadie se entera, nadie contesta.
 */
async function avisarDelPresupuesto(texto: string): Promise<number> {
  let salieron = 0;
  for (const numero of aQuienAvisar()) {
    const ok =
      (await enviarSuelto('whatsapp', `wa:${numero}@s.whatsapp.net`, `💸 ${texto}`)) ||
      (await enviarSuelto('meta', `meta:${numero}`, `💸 ${texto}`));
    if (ok) salieron++;
  }
  return salieron;
}

/** Arranca el vigilante. No hace nada mientras nadie haya dicho a quién avisar. */
export function empezarAVigilar(cadaMs = 60_000): void {
  if (reloj) return;
  onEvent((ev) => {
    if (ev.type === 'presupuesto') void avisarDelPresupuesto(String(ev.payload.texto ?? '')).catch(() => undefined);
  });
  reloj = setInterval(() => {
    void avisar().catch(() => undefined);
  }, cadaMs);
  reloj.unref();
}

/** Para las pruebas: olvidar a quién se avisó. */
export const olvidarAvisados = (): void => yaAvisados.clear();
