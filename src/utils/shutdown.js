// Shutdown limpio, compartido por el bot (src/index.js) y el dashboard
// (dashboard/server.js) — cada uno le pasa su propia función de cleanup (cerrar la
// conexión de gateway / cerrar el servidor HTTP). Sin esto, SIGTERM/SIGINT (lo que
// manda Railway en cada redeploy o al bajar un servicio) mataba el proceso de un
// hachazo, sin soltar la conexión de forma prolija.
//
// A propósito NO es un sistema de graceful shutdown complejo (sin cola de "trabajo en
// curso", sin drenar interacciones pendientes) — Fase 2A pidió explícitamente una
// solución chica y robusta, no más que eso. Tampoco contempla nada del sistema de
// música (sesiones de voz activas): va a eliminarse en un proyecto aparte, no tiene
// sentido diseñar shutdown pensando en conservarlas.
export function registerShutdown(signals, cleanup) {
  let shuttingDown = false;

  // Guardia contra doble ejecución: un SIGTERM seguido de un SIGINT casi al mismo
  // tiempo (o dos SIGTERM seguidos) no debe correr cleanup() dos veces.
  async function handleShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`🛑 Señal ${signal} recibida, cerrando de forma prolija...`);
    let code = 0;
    try {
      await cleanup(signal);
      console.log('✅ Shutdown completado.');
    } catch (error) {
      console.error(`❌ Error durante el shutdown (${signal}):`, error);
      code = 1;
    }
    process.exit(code);
  }

  for (const signal of signals) {
    process.on(signal, handleShutdown);
  }

  return handleShutdown;
}
