// Mismo criterio que isStaff() en src/utils/permissions.js, pero a partir de datos REST
// crudos (roles: string[]) en vez de un GuildMember de discord.js — el dashboard no tiene
// caché de gateway, así que no hay un objeto member.roles.cache disponible acá.
export function isStaffFromRoles(cfg, roleIds) {
  if (!cfg || !roleIds) return false;
  return Boolean(
    (cfg.admin_role_id && roleIds.includes(cfg.admin_role_id)) ||
      (cfg.moderator_role_id && roleIds.includes(cfg.moderator_role_id)),
  );
}
