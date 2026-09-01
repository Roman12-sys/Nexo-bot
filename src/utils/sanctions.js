import { Collection } from 'discord.js';

// QUÉ CAMBIÓ: guild.members.fetch() (sin argumentos) reemplazado por un loop paginado
// con guild.members.list(). El primero manda la lista completa por el GATEWAY (opcode 8,
// RequestGuildMembers, confirmado leyendo GuildMemberManager.js de discord.js) — Discord
// throttlea ESE mecanismo aparte del rate limit normal de REST, y es fácil agotarlo con
// uso repetido (staff activo en /sanciones o /roles, o varios servidores a la vez):
// tira GatewayRateLimitError con un retry_after de hasta ~30s, y la interacción termina
// en el catch genérico sin ninguna explicación útil para el staff. list() hace lo mismo
// por REST puro (GET /guilds/{id}/members, hasta 1000 por página), sujeto al rate limit
// normal de REST — mucho más generoso, y ya manejado en todo el resto del proyecto.
// Devuelve una Collection (mismo tipo que devolvía guild.members.cache antes) para no
// tener que tocar ningún caller.
// MOTIVO: error real en producción, 2026-09-01 — sanciones_punish reventó con
// GatewayRateLimitError por el fetch() de acá; roles.js tenía el mismo patrón.
export async function fetchAllMembers(guild) {
  const all = new Collection();
  let after;
  for (;;) {
    const page = await guild.members.list({ limit: 1000, after });
    for (const [id, member] of page) all.set(id, member);
    if (page.size < 1000) break;
    after = page.lastKey();
  }
  return all;
}

// /sanciones se invoca a mano por staff de vez en cuando (no es un hot path como
// un evento de mensaje), así que traer todos los miembros acá es seguro en cuanto a
// volumen — el problema real no era ESO, era el mecanismo (gateway vs REST) usado para
// traerlos. Ver fetchAllMembers.
export async function getActiveTimeouts(guild) {
  const members = await fetchAllMembers(guild);
  const now = Date.now();

  return members.filter(
    (m) => m.communicationDisabledUntilTimestamp && m.communicationDisabledUntilTimestamp > now,
  );
}

// Busca, entre los miembros, quiénes tienen el rol de sanción (guild_config.punish_role_id)
export async function getPunishedMembers(guild, punishRoleId) {
  const members = await fetchAllMembers(guild);
  return members.filter((m) => m.roles.cache.has(punishRoleId));
}

// Los baneos NO se guardan en caché como los miembros, así que acá sí hace falta
// pedirle la lista a Discord.
export async function getBannedUsers(guild) {
  return guild.bans.fetch();
}
