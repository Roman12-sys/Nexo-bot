// Estado AFK en memoria, por servidor+usuario — igual que guessSessions.js/
// giveTracker.js: es un estado casual/efímero, no amerita persistir en Supabase (si
// el bot se reinicia, se pierde el AFK activo, trade-off aceptable para esta feature).
const afkUsers = new Map(); // `${guildId}:${userId}` -> { reason, since }

function key(guildId, userId) {
  return `${guildId}:${userId}`;
}

export function setAfk(guildId, userId, reason) {
  afkUsers.set(key(guildId, userId), { reason, since: Date.now() });
}

export function getAfk(guildId, userId) {
  return afkUsers.get(key(guildId, userId)) || null;
}

export function clearAfk(guildId, userId) {
  const existed = afkUsers.has(key(guildId, userId));
  afkUsers.delete(key(guildId, userId));
  return existed;
}

// Limpieza real del Map (Fase 2A, 2026-08-31) — sin esto, un usuario que se pone AFK y
// después sale del server (o el bot deja de estar en ese guild) dejaba la entrada viva
// para siempre: nada la volvía a tocar, así que nunca se borraba sola. Se resuelve con
// los eventos que YA existen (guildMemberRemove, guildDelete) en vez de un TTL — no hace
// falta inventar expiración por tiempo cuando los eventos reales de Discord ya avisan
// exactamente cuándo una entrada dejó de tener sentido.
export function clearGuildAfk(guildId) {
  const prefix = `${guildId}:`;
  for (const mapKey of afkUsers.keys()) {
    if (mapKey.startsWith(prefix)) afkUsers.delete(mapKey);
  }
}
