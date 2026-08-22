import { Events, AuditLogEvent } from 'discord.js';
import { createChannelLogEmbed } from '../utils/logEmbeds.js';
import { findExecutor } from '../utils/auditLog.js';
import { getGuildLogChannel } from '../utils/guildLogChannels.js';
import { handleChannelDeletedExternally } from '../utils/tempVoiceEngine.js';

export const name = Events.ChannelDelete;
export const once = false;

export async function execute(channel, client) {
  // Si alguien borra a mano una sala de voz temporal (en vez de dejar que se borre
  // sola al vaciarse), limpiamos su registro en Supabase. Corre siempre, independiente
  // del early-return de logging de abajo.
  await handleChannelDeletedExternally(channel).catch((error) => {
    console.error('❌ Error limpiando el registro de una sala de voz temporal borrada:', error);
  });

  if (!channel.guild) return;

  try {
    const logChannel = await getGuildLogChannel(client, channel.guild.id, 'activity');
    if (!logChannel) return;

    const entry = await findExecutor(channel.guild, { type: AuditLogEvent.ChannelDelete, targetId: channel.id });

    await logChannel.send({
      embeds: [createChannelLogEmbed({ action: 'delete', channel, executor: entry?.executor || null })],
    });
  } catch (error) {
    console.error('❌ Error registrando la eliminación de un canal:', error);
  }
}
