/**
 * El candado del modo fácil: con el modo fácil puesto, quien no es super-admin ATIENDE —conversa, agenda, mueve
 * etapas, anota— y nada más. La configuración, los análisis, las exportaciones y borrar fichas quedan para quien
 * administra aiva, que es también el único que prende o apaga el modo.
 *
 * Lo pidió DUNOR: un aiva sencillo del que nadie de su lado se salga sin querer. Esconder los botones no bastaba
 * —esconder un botón no cierra nada—, así que la misma regla que pinta la pantalla se cumple aquí, en el servidor.
 *
 * El rol llega en `x-aiva-rol`, que pone la consola desde la sesión de quien entró (y tira lo que mande el
 * navegador). Sin esa cabecera no hay candado: es el token a secas, y ese token abre cualquier ruta igual.
 *
 * 🪤 Lo que se puede CAMBIAR es una lista cerrada de lo del día a día, no una lista de lo prohibido: así una ruta
 * de configuración que se añada mañana nace cerrada para el candado sin que nadie tenga que acordarse. Lo que se
 * puede LEER va al revés —todo menos lo avanzado—, porque el tablero lee mucho al arrancar y cerrar de más lo
 * dejaría en blanco.
 */

/** Lo del día a día que alguien con el candado sí puede cambiar. Rutas sin `/admin/api/` delante. */
const PUEDE_CAMBIAR: Array<[string, RegExp]> = [
  ['PUT', /^fijados$/],
  ['POST', /^contacts$/],
  ['POST', /^contacts\/leidas$/],
  ['PATCH', /^contacts\/[^/]+$/],
  ['POST', /^contacts\/[^/]+\/(archive|snooze|merge|notas|human|presencia|reply|adjunto)$/],
  ['DELETE', /^contacts\/[^/]+\/notas\/[^/]+$/],
  ['POST', /^contacts\/[^/]+\/mensajes\/[^/]+\/reintentar$/],
  ['POST', /^appointments$/],
  ['PATCH', /^appointments\/[^/]+$/],
  ['POST', /^appointments\/[^/]+\/reminded$/],
  // Lo que aiva le pregunta al equipo en Hoy, y lo que propone contestar cuando la conversación la lleva alguien.
  ['POST', /^verifications\/[^/]+\/(answer|dismiss)$/],
  ['POST', /^propuestas\/[^/]+\/(enviar|descartar)$/],
];

/**
 * Lo avanzado que no se lee con el candado: el consumo, las exportaciones, las trazas, lo que aprendió aiva.
 *
 * 🪤 Ventas, Seguimientos y Analítica (series, orígenes, tiempos) SÍ se leen. Al principio no —se veían como lo
 * avanzado—, pero DUNOR mandó el modo fácil que quería (Nexora) y esas tres están en su menú: son del día a día
 * de quien vende, no de quien administra aiva. Lo que sigue cerrado es la configuración y lo que cuesta.
 */
const NO_PUEDE_LEER = /^(usage|export|respaldo|historial|dictionary|presupuesto|retencion|motores|clave|turnos|prueba|vivo|backup|misses|avisos|public|importar)(\/|$)/;

const LEER = new Set(['GET', 'HEAD']);

/** Quién manda en el modo: el super-admin y el token a secas (sin rol). */
export function mandaEnElModo(rol: string | undefined): boolean {
  return !rol || rol === 'super';
}

/**
 * Por qué no, o null si puede. `ruta` sin `/admin/api/` delante y sin la consulta; `rol` el de `x-aiva-rol`.
 */
export function frenoDelCandado(ruta: string, metodo: string, rol: string | undefined, modo: 'facil' | 'completo'): string | null {
  if (mandaEnElModo(rol)) return null;
  const m = metodo.toUpperCase();
  // El modo lo cambia solo quien administra aiva, esté como esté: si no, el candado se abre desde adentro.
  if (/^tablero\/modo$/.test(ruta) && !LEER.has(m)) return 'el modo del tablero lo cambia quien administra aiva';
  if (modo !== 'facil') return null;
  if (LEER.has(m)) return NO_PUEDE_LEER.test(ruta) ? 'en el modo fácil eso lo ve quien administra aiva' : null;
  return PUEDE_CAMBIAR.some(([mm, re]) => mm === m && re.test(ruta)) ? null : 'en el modo fácil eso lo cambia quien administra aiva';
}
