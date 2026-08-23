import { Events, AuditLogEvent } from 'discord.js';
import { createChannelLogEmbed } from '../utils/logEmbeds.js';
import { findExecutor } from '../utils/auditLog.js';
import { getGuildLogChannel } from '../utils/guildLogChannels.js';

export const name = Events.ChannelCreate;
export const once = false;

export async function execute(channel, client) {
  if (!channel.guild) return;

  try {
    const logChannel = await getGuildLogChannel(client, channel.guild.id, 'activity');
    if (!logChannel) return;

    const entry = await findExecutor(channel.guild, { type: AuditLogEvent.ChannelCreate, targetId: channel.id });

    await logChannel.send({
      embeds: [createChannelLogEmbed({ action: 'create', channel, executor: entry?.executor || null })],
    });
  } catch (error) {
    console.error('❌ Error registrando la creación de un canal:', error);
  }
}
