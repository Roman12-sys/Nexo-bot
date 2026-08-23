import { Events, AuditLogEvent } from 'discord.js';
import { createStickerLogEmbed } from '../utils/logEmbeds.js';
import { findExecutor } from '../utils/auditLog.js';
import { getGuildLogChannel } from '../utils/guildLogChannels.js';

export const name = Events.GuildStickerUpdate;
export const once = false;

export async function execute(oldSticker, newSticker, client) {
  if (oldSticker.name === newSticker.name && oldSticker.description === newSticker.description) return;

  try {
    const logChannel = await getGuildLogChannel(client, newSticker.guild.id, 'activity');
    if (!logChannel) return;

    const entry = await findExecutor(newSticker.guild, {
      type: AuditLogEvent.StickerUpdate,
      targetId: newSticker.id,
    });

    await logChannel.send({
      embeds: [createStickerLogEmbed({ action: 'update', item: newSticker, executor: entry?.executor || null })],
    });
  } catch (error) {
    console.error('❌ Error registrando la actualización de un sticker:', error);
  }
}
