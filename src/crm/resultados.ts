// Lo que se vendió, lo que se perdió y a quién hay que escribirle: el mismo cálculo para las rutas /ventas y
// /seguimientos y para Optimización de ventas (crm/optimizacion.ts). Vivía dentro de cada ruta; salió aquí para
// que ninguna pantalla cuente distinto lo mismo.
import { contactNumber, estaCerrada, listContacts, listEvents, rolDe, type Stage } from './contacts.js';
import { valorDe, type ValorDe } from './valor.js';
import { listAppointments } from './appointments.js';
import { isSnoozed } from './followup.js';

export interface FilaDeVenta {
  id: string;
  nombre: string | null;
  phone: string | null;
  canal: string;
  cuando: number;
  valor: ValorDe;
  resumen: string | null;
}

export interface VentasDelPeriodo {
  dias: number;
  total: number;
  cuantas: number;
  sinPrecio: number;
  promedio: number;
  ventas: FilaDeVenta[];
  perdidas: { cuantas: number; sinMotivo: number; motivos: { motivo: string; n: number }[] };
}

/** Cuándo pasó una ficha a una etapa con ese papel (el primer evento que la llevó ahí), o null. */
/**
 * Cuándo pasó una ficha a ganado o a perdido: el ÚLTIMO evento de etapa que la llevó a ese papel. Una sola regla
 * para Ventas, Optimización y KPIs (antes cada uno la tenía escrita aparte). null si no hay evento: quien la usa
 * decide qué hacer (aquí y en KPIs, la última vez que se vio; el Embudo, en cambio, dice «no se sabe»).
 */
export function cuandoPasoA(id: string, rol: 'ganado' | 'perdido'): number | null {
  return listEvents(id, 200)
    .filter((e) => e.type === 'stage' && rolDe(String(e.payload.to ?? '') as Stage) === rol)
    .pop()?.ts ?? null;
}

/**
 * Ventas: quién compró, por cuánto y cuándo.
 *
 * 🪤 El «cuándo» sale del EVENTO que movió la ficha a ganado, no de la última vez que escribió. Son cosas
 * distintas y se notan en cuanto alguien mira un mes: quien compró en agosto y volvió a escribir ayer
 * aparecería como venta de ayer, y el mes cerraría mal.
 */
export function ventasDelPeriodo(dias: number, now = Date.now()): VentasDelPeriodo {
  const desde = now - dias * 86400_000;
  const todas = listContacts({ limit: 2000 }).filter((x) => !x.archived);
  const filas = todas
    .filter((x) => rolDe(x.stage) === 'ganado')
    .map((x) => {
      const cuando = cuandoPasoA(x.id, 'ganado') ?? x.lastSeen ?? x.firstSeen ?? 0;
      return { id: x.id, nombre: x.name, phone: contactNumber(x), canal: x.channel, cuando, valor: valorDe(x), resumen: x.summary };
    })
    .filter((v) => v.cuando >= desde)
    .sort((a, b) => b.cuando - a.cuando);
  const total = filas.reduce((a, v) => a + v.valor.valor, 0);
  // Las que se perdieron en el mismo periodo, y por qué. Las que no dicen motivo van aparte y se cuentan:
  // esconderlas haría creer que el precio es el problema cuando nadie dijo nada de la mayoría.
  const perdidas = todas
    .filter((x) => rolDe(x.stage) === 'perdido')
    .filter((x) => (cuandoPasoA(x.id, 'perdido') ?? x.lastSeen) >= desde);
  const porMotivo = new Map<string, number>();
  for (const x of perdidas) {
    const m = String(x.data.motivo_perdida ?? '').trim();
    if (m) porMotivo.set(m, (porMotivo.get(m) ?? 0) + 1);
  }
  return {
    dias,
    total,
    cuantas: filas.length,
    // 🪤 Cuántas no tienen precio se dice aparte: un total que calla eso parece el total de verdad.
    sinPrecio: filas.filter((v) => !v.valor.valor).length,
    promedio: filas.length ? total / filas.filter((v) => v.valor.valor).length || 0 : 0,
    ventas: filas.slice(0, 200),
    perdidas: {
      cuantas: perdidas.length,
      sinMotivo: perdidas.filter((x) => !String(x.data.motivo_perdida ?? '').trim()).length,
      // Empatados, por orden alfabético: si no, dos que pesan igual cambiarían de puesto cada vez que se abre.
      motivos: [...porMotivo].map(([motivo, n]) => ({ motivo, n })).sort((a, b) => b.n - a.n || a.motivo.localeCompare(b.motivo, 'es')),
    },
  };
}

export interface FilaDeSeguimiento {
  id: string;
  nombre: string | null;
  phone: string | null;
  canal: string;
  etapa: Stage;
  puntaje: number;
  callado: number;
  porque: string;
  resumen: string | null;
  valor: ValorDe;
}

/**
 * Seguimientos: a quién hay que escribirle y por qué.
 *
 * Es la misma lista que sale en Hoy, pero entera y con el motivo. En Hoy va recortada a veinte porque ahí
 * compite con todo lo demás; en la Lista de trabajo es lo único que hay que mirar.
 */
export function seguimientosPendientes(now = Date.now()): { cuantos: number; calientes: number; seguimientos: FilaDeSeguimiento[] } {
  const abiertos = listContacts({ limit: 2000 }).filter((x) => !x.archived && !estaCerrada(x.stage));
  const conCita = new Set(listAppointments({ from: now, status: 'confirmada', limit: 1000 }).map((a) => a.userId));
  const esperandoResultado = new Set(
    listAppointments({ from: now - 14 * 86400_000, to: now, status: 'confirmada', limit: 1000 })
      .filter((a) => a.endsAt < now)
      .map((a) => a.userId),
  );
  const filas = abiertos
    .filter((x) => !conCita.has(x.id) && !esperandoResultado.has(x.id) && (x.lastMessageAt ?? 0) < now - 24 * 3600_000 && !isSnoozed(x, now))
    .map((x) => {
      const callado = Math.round((now - (x.lastMessageAt ?? x.lastSeen ?? now)) / 86400_000);
      // El motivo en una frase: sin esto la lista es un montón de nombres y nadie sabe por cuál empezar.
      const porque = x.scoreBase >= 60 ? `Puntaje ${x.scoreBase} y lleva ${callado} día${callado === 1 ? '' : 's'} callado` : `Lleva ${callado} día${callado === 1 ? '' : 's'} sin escribir`;
      return { id: x.id, nombre: x.name, phone: contactNumber(x), canal: x.channel, etapa: x.stage, puntaje: x.scoreBase, callado, porque, resumen: x.summary, valor: valorDe(x) };
    })
    // Primero los que más valen la pena: puntaje alto y poco tiempo callados se enfrían rápido.
    .sort((a, b) => b.puntaje - a.puntaje || a.callado - b.callado);
  return { cuantos: filas.length, calientes: filas.filter((f) => f.puntaje >= 60).length, seguimientos: filas.slice(0, 200) };
}
