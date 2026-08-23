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

    // Cada sala de voz temporal (Join to Create) crea un canal por el bot — sin este
    // guard, cada una generaba un log sin contexto real (mismo criterio que
    // channelUpdate.js con /lock y /unlock).
    if (entry?.executor?.id === client.user.id) return;

    await logChannel.send({
      embeds: [createChannelLogEmbed({ action: 'create', channel, executor: entry?.executor || null })],
    });
  } catch (error) {
    console.error('❌ Error registrando la creación de un canal:', error);
  }
}
