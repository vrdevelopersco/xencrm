// Si me quedo sin quien me levantó, me voy solo.
//
// 🪤 De aquí salió el peor fallo que hemos tenido en producción, y no se parecía en nada a su causa.
//
// El lanzador levanta un proceso por cliente. Cuando el alojamiento mata al lanzador sin avisar —lo hace: da
// tres segundos para arrancar y si no, lo fulmina—, los hijos no se enteran de nada: siguen vivos, agarrando
// sus puertos y, sobre todo, **con la sesión de WhatsApp del cliente abierta**. La versión que arranca después
// encuentra los puertos ocupados, se corre a otro tramo y levanta una segunda copia de todo. Y entonces dos
// procesos distintos abren el mismo número de WhatsApp:
//
//     [whatsapp] conectado como 57300…
//     [whatsapp] conexión cerrada (440: Stream Errored (conflict)) tras 3s, reconectando en 3s...
//
// …en bucle, para siempre, porque cada copia echa a la otra y la otra vuelve. Desde fuera no se ve un proceso
// de más: se ve WhatsApp «fallando». Y el registro de salud decía «Todo arriba», porque cada lanzador solo sabe
// de los suyos y los suyos estaban perfectamente. Pasó el 2026-09-29.
//
// La cura es que nadie sobreviva a su padre. En Linux, al morir el padre a los hijos los adopta `init` (pid 1),
// así que el cambio de `ppid` es la señal: barata, sin latido, sin archivo de por medio, y funciona también si
// al lanzador lo matan con SIGKILL, que es justo cuando no puede despedirse de nadie.
//
// Solo se vigila cuando hay lanzador (`AIVA_SUPERVISADO`): arrancado a mano, nadie se va a ningún sitio.

/** Vigila al lanzador y se va si desaparece. No hace nada si este proceso se arrancó a mano. */
export function irseSiQuedaHuerfano(despedirse?: () => void): void {
  if (process.env.AIVA_SUPERVISADO !== '1') return;
  const padre = process.ppid;
  const reloj = setInterval(() => {
    if (process.ppid === padre) return;
    clearInterval(reloj);
    console.error('[aiva] me quedé sin lanzador: me voy para no dejar agarrados el puerto ni WhatsApp.');
    try {
      despedirse?.();
    } catch {
      /* si no se puede cerrar bonito, se cierra igual */
    }
    process.exit(0);
  }, 3000);
  // Que esto no sea lo que mantiene vivo al proceso: si ya no queda nada más, que se pueda ir en paz.
  reloj.unref();
}
