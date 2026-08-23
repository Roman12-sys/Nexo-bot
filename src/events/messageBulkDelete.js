import { Events, AuditLogEvent, PermissionFlagsBits } from 'discord.js';
import { createBulkDeleteLogEmbed } from '../utils/logEmbeds.js';
import { getGuildLogChannel } from '../utils/guildLogChannels.js';

const AUDIT_LOG_WINDOW_MS = 5000;

export const name = Events.MessageBulkDelete;
export const once = false;

export async function execute(messages, channel, client) {
  try {
    const guild = channel.guild;
    if (!guild) return;

    const me = guild.members.me;
    if (!me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) return;

    const auditLogs = await guild.fetchAuditLogs({ type: AuditLogEvent.MessageBulkDelete, limit: 5 });
    const entry = auditLogs.entries.find((e) => {
      const isSameChannel = e.target?.id === channel.id || e.extra?.channel?.id === channel.id;
      const isRecent = Date.now() - e.createdTimestamp < AUDIT_LOG_WINDOW_MS;
      return isSameChannel && isRecent;
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
