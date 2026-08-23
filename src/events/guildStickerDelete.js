import { Events, AuditLogEvent } from 'discord.js';
import { createStickerLogEmbed } from '../utils/logEmbeds.js';
import { findExecutor } from '../utils/auditLog.js';
import { getGuildLogChannel } from '../utils/guildLogChannels.js';

export const name = Events.GuildStickerDelete;
export const once = false;

export async function execute(sticker, client) {
  try {
    const logChannel = await getGuildLogChannel(client, sticker.guild.id, 'activity');
    if (!logChannel) return;

    const entry = await findExecutor(sticker.guild, { type: AuditLogEvent.StickerDelete, targetId: sticker.id });

    await logChannel.send({
      embeds: [createStickerLogEmbed({ action: 'delete', item: sticker, executor: entry?.executor || null })],
    });
  } catch (error) {
    console.error('❌ Error registrando la eliminación de un sticker:', error);
  }
}
