import { Events, AuditLogEvent } from 'discord.js';
import { createThreadLogEmbed } from '../utils/logEmbeds.js';
import { findExecutor } from '../utils/auditLog.js';
import { getGuildLogChannel } from '../utils/guildLogChannels.js';

export const name = Events.ThreadDelete;
export const once = false;

export async function execute(thread, client) {
  if (!thread.guild) return;

  try {
    const logChannel = await getGuildLogChannel(client, thread.guild.id, 'activity');
    if (!logChannel) return;

    const entry = await findExecutor(thread.guild, { type: AuditLogEvent.ThreadDelete, targetId: thread.id });

    await logChannel.send({
      embeds: [createThreadLogEmbed({ action: 'delete', thread, executor: entry?.executor || null })],
    });
  } catch (error) {
    console.error('❌ Error registrando la eliminación de un hilo:', error);
  }
}
