import { Events, AuditLogEvent } from 'discord.js';
import { createStickerLogEmbed } from '../utils/logEmbeds.js';
import { findExecutor } from '../utils/auditLog.js';
import { getGuildLogChannel } from '../utils/guildLogChannels.js';

export const name = Events.GuildStickerCreate;
export const once = false;

export async function execute(sticker, client) {
  try {
    const logChannel = await getGuildLogChannel(client, sticker.guild.id, 'activity');
    if (!logChannel) return;

    const entry = await findExecutor(sticker.guild, { type: AuditLogEvent.StickerCreate, targetId: sticker.id });

    await logChannel.send({
      embeds: [createStickerLogEmbed({ action: 'create', item: sticker, executor: entry?.executor || null })],
    });
  } catch (error) {
    console.error('❌ Error registrando el nuevo sticker:', error);
  }
}
