// /sanciones se invoca a mano por staff de vez en cuando (no es un hot path como
// un evento de mensaje), así que hacer un fetch completo acá es seguro.
export async function getActiveTimeouts(guild) {
  await guild.members.fetch();
  const now = Date.now();

  return guild.members.cache.filter(
    (m) => m.communicationDisabledUntilTimestamp && m.communicationDisabledUntilTimestamp > now,
  );
}

// Busca, entre los miembros, quiénes tienen el rol de sanción (guild_config.punish_role_id)
export async function getPunishedMembers(guild, punishRoleId) {
  await guild.members.fetch();
  return guild.members.cache.filter((m) => m.roles.cache.has(punishRoleId));
}

// Los baneos NO se guardan en caché como los miembros, así que acá sí hace falta
// pedirle la lista a Discord.
export async function getBannedUsers(guild) {
  return guild.bans.fetch();
}
