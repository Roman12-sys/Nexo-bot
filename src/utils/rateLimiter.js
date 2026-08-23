// Límite genérico de interacciones por usuario, a nivel de interactionCreate.js — no
// reemplaza los cooldowns propios de /daily, /work, etc. (esos son de negocio, "una vez
// cada 24hs"), esto es antiabuso a nivel proceso: nadie debería poder hacer 50 clicks o
// invocaciones de comando en 2 segundos, sin importar cuál sea. Mismo patrón en memoria
// que guessSessions.js/giveTracker.js — no amerita persistir en Supabase.
const MAX_ACTIONS = 10;
const WINDOW_MS = 10 * 1000;

const hits = new Map(); // userId -> timestamps[] dentro de la ventana actual

// Devuelve true si la acción está permitida (y la registra); false si el usuario ya
// llegó al límite dentro de la ventana — en ese caso NO se registra un hit extra, así
// no extiende el bloqueo indefinidamente mientras siga insistiendo.
export function checkRateLimit(userId) {
  const now = Date.now();
  const timestamps = (hits.get(userId) || []).filter((t) => now - t < WINDOW_MS);

  if (timestamps.length >= MAX_ACTIONS) {
    hits.set(userId, timestamps);
    return false;
  }

  timestamps.push(now);
  hits.set(userId, timestamps);
  return true;
}

// Barre entradas vencidas cada 5 minutos, mismo criterio que el resto de los stores en
// memoria del proyecto — sin esto, un usuario que interactuó una sola vez con el bot
// hace semanas queda ocupando una entrada en el Map para siempre.
setInterval(() => {
  const now = Date.now();
  for (const [userId, timestamps] of hits) {
    const fresh = timestamps.filter((t) => now - t < WINDOW_MS);
    if (fresh.length === 0) hits.delete(userId);
    else hits.set(userId, fresh);
  }
}, 5 * 60 * 1000).unref();
