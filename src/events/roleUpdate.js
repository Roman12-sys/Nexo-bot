import { Events, AuditLogEvent } from 'discord.js';
import { createRoleLogEmbed } from '../utils/logEmbeds.js';
import { findExecutor } from '../utils/auditLog.js';
import { getGuildLogChannel } from '../utils/guildLogChannels.js';

function diffRole(oldRole, newRole) {
  const changes = [];
  if (oldRole.name !== newRole.name) changes.push(`Nombre: \`${oldRole.name}\` → \`${newRole.name}\``);
  if (oldRole.hexColor !== newRole.hexColor) changes.push(`Color: \`${oldRole.hexColor}\` → \`${newRole.hexColor}\``);
  if (oldRole.hoist !== newRole.hoist) changes.push(`Mostrar por separado: \`${oldRole.hoist}\` → \`${newRole.hoist}\``);
  if (oldRole.mentionable !== newRole.mentionable) {
    changes.push(`Mencionable: \`${oldRole.mentionable}\` → \`${newRole.mentionable}\``);
  }
  if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) changes.push('Permisos modificados');
  return changes;
}

export const name = Events.GuildRoleUpdate;
export const once = false;

export async function execute(oldRole, newRole, client) {
  try {
    const changes = diffRole(oldRole, newRole);
    if (changes.length === 0) return;

    const logChannel = await getGuildLogChannel(client, newRole.guild.id, 'activity');
    if (!logChannel) return;

    const entry = await findExecutor(newRole.guild, { type: AuditLogEvent.RoleUpdate, targetId: newRole.id });

    await logChannel.send({
      embeds: [createRoleLogEmbed({ action: 'update', role: newRole, executor: entry?.executor || null, changes })],
    });
  } catch (error) {
    console.error('❌ Error registrando la actualización de un rol:', error);
  }
}
