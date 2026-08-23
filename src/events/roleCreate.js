import { Events, AuditLogEvent } from 'discord.js';
import { createRoleLogEmbed } from '../utils/logEmbeds.js';
import { findExecutor } from '../utils/auditLog.js';
import { getGuildLogChannel } from '../utils/guildLogChannels.js';

export const name = Events.GuildRoleCreate;
export const once = false;

export async function execute(role, client) {
  try {
    const logChannel = await getGuildLogChannel(client, role.guild.id, 'activity');
    if (!logChannel) return;

    const entry = await findExecutor(role.guild, { type: AuditLogEvent.RoleCreate, targetId: role.id });

    await logChannel.send({
      embeds: [createRoleLogEmbed({ action: 'create', role, executor: entry?.executor || null })],
    });
  } catch (error) {
    console.error('❌ Error registrando la creación de un rol:', error);
  }
}
