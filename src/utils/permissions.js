import { getGuildConfig } from './guildConfigStore.js';

// Chequeo de admin/staff compartido por todos los comandos de moderación.
// A diferencia de gNoX (roles fijos en .env), acá cada servidor configura los
// suyos con /setup y quedan en guild_config — por eso esto es async.
export async function isStaff(interaction) {
  const cfg = await getGuildConfig(interaction.guildId);
  const roles = interaction.member.roles.cache;
  return Boolean(
    (cfg.admin_role_id && roles.has(cfg.admin_role_id)) ||
      (cfg.moderator_role_id && roles.has(cfg.moderator_role_id)),
  );
}

// "¿Hay algún rol de staff configurado en absoluto?" — distinto de isStaff()
// (que chequea si ESTE usuario tiene uno de esos roles). Sirve para diferenciar
// "todavía no corriste /setup" de "no tenés el rol".
export async function isStaffConfigured(guildId) {
  const cfg = await getGuildConfig(guildId);
  return Boolean(cfg.admin_role_id || cfg.moderator_role_id);
}

// Valida que un moderador pueda aplicar una acción sobre "targetMember".
// Devuelve null si está todo bien, o un mensaje de error listo para responder si no.
// Bloquea: actuar sobre uno mismo, sobre el bot, o sobre alguien con rango igual/mayor
// (salvo que quien ejecuta el comando sea el dueño del servidor).
export function getModerationBlockReason(interaction, targetMember) {
  if (!targetMember) return null;

  if (targetMember.id === interaction.user.id) {
    return '❌ No podés aplicar esta acción sobre vos mismo.';
  }
  if (targetMember.id === interaction.client.user.id) {
    return '❌ No podés aplicar esta acción sobre el bot.';
  }

  const isOwner = interaction.guild.ownerId === interaction.user.id;
  if (!isOwner && targetMember.roles.highest.position >= interaction.member.roles.highest.position) {
    return '❌ No podés aplicar esta acción sobre alguien con tu mismo rango o superior.';
  }

  return null;
}
