import { Events, AuditLogEvent } from 'discord.js';
import { createEmojiLogEmbed } from '../utils/logEmbeds.js';
import { findExecutor } from '../utils/auditLog.js';
import { getGuildLogChannel } from '../utils/guildLogChannels.js';

export const name = Events.GuildEmojiUpdate;
export const once = false;

export async function execute(oldEmoji, newEmoji, client) {
  if (oldEmoji.name === newEmoji.name) return;

  try {
    const logChannel = await getGuildLogChannel(client, newEmoji.guild.id, 'activity');
    if (!logChannel) return;

    const entry = await findExecutor(newEmoji.guild, { type: AuditLogEvent.EmojiUpdate, targetId: newEmoji.id });

    await logChannel.send({
      embeds: [
        createEmojiLogEmbed({
          action: 'update',
          item: newEmoji,
          executor: entry?.executor || null,
        }),
      ],
    });
  } catch (error) {
    console.error('❌ Error registrando el renombre de un emoji:', error);
  }
}
