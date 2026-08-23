import { Events, AuditLogEvent } from 'discord.js';
import { createEmojiLogEmbed } from '../utils/logEmbeds.js';
import { findExecutor } from '../utils/auditLog.js';
import { getGuildLogChannel } from '../utils/guildLogChannels.js';

export const name = Events.GuildEmojiCreate;
export const once = false;

export async function execute(emoji, client) {
  try {
    const logChannel = await getGuildLogChannel(client, emoji.guild.id, 'activity');
    if (!logChannel) return;

    const entry = await findExecutor(emoji.guild, { type: AuditLogEvent.EmojiCreate, targetId: emoji.id });

    await logChannel.send({
      embeds: [createEmojiLogEmbed({ action: 'create', item: emoji, executor: entry?.executor || null })],
    });
  } catch (error) {
    console.error('❌ Error registrando el nuevo emoji:', error);
  }
}
