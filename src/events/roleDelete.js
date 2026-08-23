import { Events, AuditLogEvent } from 'discord.js';
import { createRoleLogEmbed } from '../utils/logEmbeds.js';
import { findExecutor } from '../utils/auditLog.js';
import { getGuildLogChannel } from '../utils/guildLogChannels.js';

export const name = Events.GuildRoleDelete;
export const once = false;

export async function execute(role, client) {
  try {
    const logChannel = await getGuildLogChannel(client, role.guild.id, 'activity');
    if (!logChannel) return;

    const entry = await findExecutor(role.guild, { type: AuditLogEvent.RoleDelete, targetId: role.id });

    await logChannel.send({
      embeds: [createRoleLogEmbed({ action: 'delete', role, executor: entry?.executor || null })],
    });
  } catch (error) {
    console.error('❌ Error registrando la eliminación de un rol:', error);
  }
}
