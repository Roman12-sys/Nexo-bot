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
