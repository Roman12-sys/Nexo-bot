import { Events, AuditLogEvent } from 'discord.js';
import { createEmojiLogEmbed } from '../utils/logEmbeds.js';
import { findExecutor } from '../utils/auditLog.js';
import { getGuildLogChannel } from '../utils/guildLogChannels.js';

export const name = Events.GuildEmojiDelete;
export const once = false;

export async function execute(emoji, client) {
  try {
    const logChannel = await getGuildLogChannel(client, emoji.guild.id, 'activity');
    if (!logChannel) return;

    const entry = await findExecutor(emoji.guild, { type: AuditLogEvent.EmojiDelete, targetId: emoji.id });

    await logChannel.send({
      embeds: [createEmojiLogEmbed({ action: 'delete', item: emoji, executor: entry?.executor || null })],
    });
  } catch (error) {
    console.error('❌ Error registrando la eliminación de un emoji:', error);
  }
}
