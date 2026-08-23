// Límite genérico de interacciones por usuario, a nivel de interactionCreate.js — no
// reemplaza los cooldowns propios de /daily, /work, etc. (esos son de negocio, "una vez
// cada 24hs"), esto es antiabuso a nivel proceso: nadie debería poder hacer 50 clicks o
// invocaciones de comando en 2 segundos, sin importar cuál sea. Mismo patrón en memoria
// que guessSessions.js/giveTracker.js — no amerita persistir en Supabase.
//
// Categorías separadas (cada usuario tiene un cupo independiente por categoría) para que
// jugar rápido a /8ball o mandar varios /hug seguidos no se coma el mismo cupo que
// necesita un /ban o un /clear real — antes competían por los mismos 10 cada 10s.
const LIMITS = {
  light: { max: 20, windowMs: 10 * 1000 }, // comandos de diversión/acción sin costo real
  default: { max: 10, windowMs: 10 * 1000 },
};

const hits = new Map(); // `${userId}:${category}` -> timestamps[] dentro de la ventana actual

// Devuelve true si la acción está permitida (y la registra); false si el usuario ya
// llegó al límite dentro de la ventana — en ese caso NO se registra un hit extra, así
// no extiende el bloqueo indefinidamente mientras siga insistiendo.
export function checkRateLimit(userId, category = 'default') {
  const { max, windowMs } = LIMITS[category] || LIMITS.default;
  const key = `${userId}:${category}`;
  const now = Date.now();
  const timestamps = (hits.get(key) || []).filter((t) => now - t < windowMs);

  if (timestamps.length >= max) {
    hits.set(key, timestamps);
    return false;
  }

  timestamps.push(now);
  hits.set(key, timestamps);
  return true;
}

// Barre entradas vencidas cada 5 minutos, mismo criterio que el resto de los stores en
// memoria del proyecto — sin esto, un usuario que interactuó una sola vez con el bot
// hace semanas queda ocupando una entrada en el Map para siempre.
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of hits) {
    const category = key.slice(key.lastIndexOf(':') + 1);
    const windowMs = (LIMITS[category] || LIMITS.default).windowMs;
    const fresh = timestamps.filter((t) => now - t < windowMs);
    if (fresh.length === 0) hits.delete(key);
    else hits.set(key, fresh);
  }
}, 5 * 60 * 1000).unref();
