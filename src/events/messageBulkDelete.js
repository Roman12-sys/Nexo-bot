import { Events, AuditLogEvent } from 'discord.js';
import { createBulkDeleteLogEmbed } from '../utils/logEmbeds.js';
import { getGuildLogChannel } from '../utils/guildLogChannels.js';
import { findExecutor } from '../utils/auditLog.js';

export const name = Events.MessageBulkDelete;
export const once = false;

export async function execute(messages, channel, client) {
  try {
    const guild = channel.guild;
    if (!guild) return;

    const entry = await findExecutor(guild, {
      type: AuditLogEvent.MessageBulkDelete,
      filter: (e) => e.target?.id === channel.id || e.extra?.channel?.id === channel.id,
    });

    // Si no hay entrada, o si el ejecutor fue el propio bot (ej: ya registrado por /clear), no duplicar
    if (!entry || entry.executor?.id === client.user.id) return;

    const logChannel = await getGuildLogChannel(client, guild.id, 'activity');
    if (!logChannel) return;

    const embed = createBulkDeleteLogEmbed({
      cantidad: messages.size,
      channel,
      executor: entry.executor,
      viaComando: false,
    });

    await logChannel.send({ embeds: [embed] });
  } catch (error) {
    console.error('❌ Error registrando eliminación masiva de mensajes:', error);
  }
}
